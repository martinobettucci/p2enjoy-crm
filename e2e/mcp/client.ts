// @spec CRM-102 (docs/BACKLOG.md) — tranche T3 : le client MCP des preuves de bout en bout
// @spec docs/SPEC-mcp.md §3.1 (découverte, enregistrement dynamique, PKCE, échange du code), §12 (un vrai client MCP
//       inscrit les comptes) ; repris d'`e2e/mcp.ts` d'Evoliz (p2enjoy-evoliz, révision 80a3e27) — écarts : l'origine
//       lue dans `.env` (`MCP_DEV_PORT`), le protocole négocié tel que le serveur le rend.
//
// Ce que fait un client MCP autour du navigateur : découverte à partir du `401`, enregistrement dynamique, autorisation
// PKCE, échange du code, puis requêtes JSON-RPC sur `/mcp` en Streamable HTTP. Le navigateur, lui, ne fait que le
// consentement et la connexion au SSO : c'est le partage des rôles d'un vrai client (Claude Code, ChatGPT…).

import { createHash, randomBytes } from 'node:crypto'
import { lireEnv } from '../env'

export const ORIGINE_MCP = `http://localhost:${lireEnv('MCP_DEV_PORT')}`
/** Adresse de retour d'un client de bureau : la boucle locale, que la liste blanche accepte (§3.4). */
export const RETOUR_CLIENT = 'http://127.0.0.1:9999/callback'

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export interface Autorisation {
	readonly clientId: string
	readonly verificateur: string
	readonly etat: string
	readonly url: string
	readonly pointJeton: string
}

interface Decouverte {
	readonly authorization_endpoint: string
	readonly token_endpoint: string
	readonly registration_endpoint: string
}

/** Découverte, comme un client MCP : `401`, métadonnées de la ressource, puis du serveur d'autorisation. */
export async function decouvrir(): Promise<Decouverte> {
	const refus = await fetch(`${ORIGINE_MCP}/mcp`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
	})
	if (refus.status !== 401) throw new Error(`/mcp sans jeton : ${refus.status}, 401 attendu`)
	const defi = refus.headers.get('www-authenticate') ?? ''
	const metadonnees = /resource_metadata="([^"]+)"/.exec(defi)?.[1]
	if (!metadonnees) throw new Error(`WWW-Authenticate sans resource_metadata : ${defi}`)
	const ressource = (await (await fetch(metadonnees)).json()) as { resource: string; authorization_servers: string[] }
	if (ressource.resource !== `${ORIGINE_MCP}/mcp`) throw new Error(`ressource annoncée : ${ressource.resource}`)
	const emetteur = (ressource.authorization_servers[0] ?? '').replace(/\/$/, '')
	return (await (await fetch(`${emetteur}/.well-known/oauth-authorization-server`)).json()) as Decouverte
}

/** Enregistre un client et compose l'adresse d'autorisation que le navigateur ouvrira. */
export async function preparerAutorisation(nomClient = 'Preuve de bout en bout du CRM'): Promise<Autorisation> {
	const points = await decouvrir()
	const inscription = await fetch(points.registration_endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_name: nomClient,
			redirect_uris: [RETOUR_CLIENT],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
		}),
	})
	if (!inscription.ok) throw new Error(`enregistrement refusé : ${inscription.status} ${await inscription.text()}`)
	const { client_id: clientId } = (await inscription.json()) as { client_id: string }
	const verificateur = b64url(randomBytes(48))
	const defi = b64url(createHash('sha256').update(verificateur).digest())
	const etat = b64url(randomBytes(16))
	const url =
		`${points.authorization_endpoint}?` +
		new URLSearchParams({
			response_type: 'code',
			client_id: clientId,
			redirect_uri: RETOUR_CLIENT,
			code_challenge: defi,
			code_challenge_method: 'S256',
			state: etat,
			resource: `${ORIGINE_MCP}/mcp`,
		}).toString()
	return { clientId, verificateur, etat, url, pointJeton: points.token_endpoint }
}

export interface Jetons {
	readonly access_token: string
	readonly refresh_token?: string
	readonly expires_in: number
}

export async function echangerCode(a: Autorisation, code: string): Promise<Jetons> {
	const reponse = await fetch(a.pointJeton, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code,
			redirect_uri: RETOUR_CLIENT,
			client_id: a.clientId,
			code_verifier: a.verificateur,
		}),
	})
	if (!reponse.ok) throw new Error(`échange refusé : ${reponse.status} ${await reponse.text()}`)
	return (await reponse.json()) as Jetons
}

/** Une session MCP en Streamable HTTP : réponses JSON, ou flux SSE d'un seul message. */
export class SessionMcp {
	private session: string | undefined
	private id = 0
	private version = '2025-11-25'

	constructor(private readonly jeton: string) {}

	private entetes(): Record<string, string> {
		return {
			'Content-Type': 'application/json',
			Accept: 'application/json, text/event-stream',
			Authorization: `Bearer ${this.jeton}`,
			'MCP-Protocol-Version': this.version,
			...(this.session ? { 'Mcp-Session-Id': this.session } : {}),
		}
	}

	/** Le `result` JSON-RPC, tel que le serveur le rend : les assertions en lisent la forme. */
	async appeler(methode: string, params: Record<string, unknown> = {}): Promise<any> {
		const reponse = await fetch(`${ORIGINE_MCP}/mcp`, {
			method: 'POST',
			headers: this.entetes(),
			body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method: methode, params }),
		})
		if (!reponse.ok) throw new Error(`${methode} : HTTP ${reponse.status} ${await reponse.text()}`)
		this.session = reponse.headers.get('mcp-session-id') ?? this.session
		const texte = await reponse.text()
		const json = reponse.headers.get('content-type')?.includes('text/event-stream')
			? JSON.parse(texte.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? '{}')
			: JSON.parse(texte)
		if (json.error) throw new Error(`${methode} : ${JSON.stringify(json.error)}`)
		return json.result
	}

	async ouvrir(): Promise<void> {
		const resultat = await this.appeler('initialize', {
			protocolVersion: this.version,
			capabilities: {},
			clientInfo: { name: 'e2e-crm', version: '0.1.0' },
		})
		this.version = resultat.protocolVersion ?? this.version
		await fetch(`${ORIGINE_MCP}/mcp`, {
			method: 'POST',
			headers: this.entetes(),
			body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
		})
	}
}
