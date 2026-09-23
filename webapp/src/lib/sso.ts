// @spec CRM-091 (docs/BACKLOG.md) — client OIDC public de la webapp : PKCE, transaction, échange
// @spec docs/SPEC-auth.md §10.1 (principe), §10.2 (configuration), §10.3 (parcours), §10.4 (refus),
//       §10.5 (stockage sur l'appareil)
// @spec docs/JOURNAL.md décision 568 (mesures M1 à M11) ; docs/SSO.md (contrat du fournisseur)
// @spec CLAUDE.md §10 (aucune autorisation décidée dans le navigateur), §11 (stockage d'onglet)
//
// Ce module ne rend rien et ne décide d'aucun droit. Il mène la partie navigateur du code
// d'autorisation avec PKCE — que GoTrue ne sait pas mener lui-même (M1) — jusqu'à obtenir un
// `id_token`, que l'appelant remet aussitôt à GoTrue. C'est GoTrue, côté serveur, qui vérifie la
// signature, l'émetteur, l'audience et le nonce, puis décide de la session (§10.6).
//
// Les jetons de Keycloak ne sont jamais écrits : seul l'`id_token` est lu dans la réponse du point
// d'échange, et il ne vit que le temps d'un appel.

/** Configuration figée au build, comme `VITE_SUPABASE_*` (§10.2). */
export type ConfigurationSso = {
	readonly emetteur: string
	readonly clientId: string
}

/** Dictionnaire fermé des refus (§10.4). `reseau` est partagé avec la connexion par mot de passe. */
export type NatureEchecSso = 'sso_annule' | 'sso_sans_compte' | 'reseau' | 'sso_echec'

/** Échec d'une étape du parcours, porteur de sa seule nature — jamais du message du serveur. */
export class EchecSso extends Error {
	readonly nature: NatureEchecSso
	constructor(nature: NatureEchecSso) {
		super(nature)
		this.name = 'EchecSso'
		this.nature = nature
	}
}

/** Points d'entrée lus dans la découverte, jamais recopiés à la main (docs/SSO.md). */
export type Decouverte = {
	readonly autorisation: string
	readonly jeton: string
}

/**
 * Ce qui doit survivre à l'aller-retour vers Keycloak, et rien d'autre (§10.5).
 * Le point d'échange y est retenu pour que le retour n'ait pas à relire la découverte.
 */
export type TransactionSso = {
	readonly state: string
	readonly verificateur: string
	readonly nonce: string
	readonly retour: string
	readonly redirectUri: string
	readonly pointJeton: string
	readonly expireA: number
}

export type StockageTransaction = {
	readonly getItem: (cle: string) => string | null
	readonly setItem: (cle: string, valeur: string) => void
	readonly removeItem: (cle: string) => void
}

export const CLE_TRANSACTION_SSO = 'p2enjoy-crm.sso.transaction'
export const DUREE_TRANSACTION_MS = 10 * 60 * 1000
export const CHEMIN_RETOUR_SSO = '/auth/retour'

// --- Configuration ------------------------------------------------------------------------------

/**
 * Rend `null` si l'une des deux valeurs manque : le bouton n'est alors pas rendu, et l'écran de
 * connexion reste celui du §9, sans commande morte (§10.2).
 */
export function lireConfigurationSso(env: ImportMetaEnv): ConfigurationSso | null {
	const emetteur = env.VITE_SSO_ISSUER
	const clientId = env.VITE_SSO_CLIENT_ID
	if (typeof emetteur !== 'string' || emetteur.trim() === '') return null
	if (typeof clientId !== 'string' || clientId.trim() === '') return null
	return { emetteur: emetteur.trim().replace(/\/+$/, ''), clientId: clientId.trim() }
}

export const configurationSso: ConfigurationSso | null = lireConfigurationSso(import.meta.env)

// --- Primitives cryptographiques -----------------------------------------------------------------

/** base64url sans remplissage, RFC 7636 §3. */
export function base64url(octets: Uint8Array): string {
	let binaire = ''
	for (const octet of octets) binaire += String.fromCharCode(octet)
	return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Valeur imprévisible, tirée par le générateur cryptographique du navigateur. */
export function aleatoire(octets: number): string {
	return base64url(crypto.getRandomValues(new Uint8Array(octets)))
}

async function sha256(texte: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texte)))
}

/** Défi PKCE `S256` : `base64url(SHA-256(vérificateur))` (RFC 7636 §4.2). */
export async function defiPkce(verificateur: string): Promise<string> {
	return base64url(await sha256(verificateur))
}

/**
 * Nonce ENVOYÉ à Keycloak : `hex(SHA-256(nonce brut))`. Le nonce REMIS à GoTrue est le brut, que
 * GoTrue hache à son tour pour le comparer au jeton (M7).
 */
export async function nonceHache(nonceBrut: string): Promise<string> {
	return Array.from(await sha256(nonceBrut), (octet) => octet.toString(16).padStart(2, '0')).join('')
}

// --- Découverte ----------------------------------------------------------------------------------

type Fetch = typeof fetch

/**
 * Lit la découverte OIDC et exige que son `issuer` soit EXACTEMENT celui configuré : un émetteur
 * différent produirait des jetons que GoTrue refuserait, et le dire ici évite un aller-retour.
 */
export async function lireDecouverte(configuration: ConfigurationSso, requete: Fetch = fetch): Promise<Decouverte> {
	let reponse: Response
	try {
		reponse = await requete(`${configuration.emetteur}/.well-known/openid-configuration`)
	} catch {
		throw new EchecSso('reseau')
	}
	if (!reponse.ok) throw new EchecSso(reponse.status >= 500 ? 'reseau' : 'sso_echec')
	let document: unknown
	try {
		document = await reponse.json()
	} catch {
		throw new EchecSso('sso_echec')
	}
	const d = document as Record<string, unknown> | null
	if (d === null || typeof d !== 'object' || d.issuer !== configuration.emetteur) throw new EchecSso('sso_echec')
	const autorisation = d.authorization_endpoint
	const jeton = d.token_endpoint
	if (!urlHttp(autorisation) || !urlHttp(jeton)) throw new EchecSso('sso_echec')
	return { autorisation, jeton }
}

function urlHttp(valeur: unknown): valeur is string {
	if (typeof valeur !== 'string') return false
	try {
		const url = new URL(valeur)
		return url.protocol === 'https:' || url.protocol === 'http:'
	} catch {
		return false
	}
}

// --- Aller ---------------------------------------------------------------------------------------

export type PreparationSso = {
	readonly configuration: ConfigurationSso
	readonly decouverte: Decouverte
	/** Origine de la webapp, telle que la voit le navigateur (`window.location.origin`). */
	readonly origine: string
	/** Adresse interne à rouvrir après succès, déjà passée par `cheminRetour`. */
	readonly retour: string
	readonly stockage: StockageTransaction
	readonly maintenant?: number
}

/**
 * Tire le vérificateur, le `state` et le nonce, enregistre la transaction, puis rend l'adresse
 * d'autorisation. Les portées se bornent à `openid email profile`, les seules que le fournisseur
 * accepte (docs/SSO.md).
 */
export async function preparerRedirection(p: PreparationSso): Promise<string> {
	const verificateur = aleatoire(32)
	const state = aleatoire(16)
	const nonce = aleatoire(16)
	const redirectUri = `${p.origine}${CHEMIN_RETOUR_SSO}`
	const transaction: TransactionSso = {
		state,
		verificateur,
		nonce,
		retour: p.retour,
		redirectUri,
		pointJeton: p.decouverte.jeton,
		expireA: (p.maintenant ?? Date.now()) + DUREE_TRANSACTION_MS,
	}
	p.stockage.setItem(CLE_TRANSACTION_SSO, JSON.stringify(transaction))

	const url = new URL(p.decouverte.autorisation)
	url.searchParams.set('client_id', p.configuration.clientId)
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('scope', 'openid email profile')
	url.searchParams.set('redirect_uri', redirectUri)
	url.searchParams.set('state', state)
	url.searchParams.set('nonce', await nonceHache(nonce))
	url.searchParams.set('code_challenge', await defiPkce(verificateur))
	url.searchParams.set('code_challenge_method', 'S256')
	return url.toString()
}

// --- Retour --------------------------------------------------------------------------------------

/**
 * Lit la transaction ET LA RETIRE : elle ne sert qu'une fois, succès ou échec (§10.3, point 5).
 * Rend `null` si elle manque, est illisible, incomplète ou échue.
 */
export function consommerTransaction(stockage: StockageTransaction, maintenant = Date.now()): TransactionSso | null {
	const brut = stockage.getItem(CLE_TRANSACTION_SSO)
	stockage.removeItem(CLE_TRANSACTION_SSO)
	if (brut === null) return null
	let t: unknown
	try {
		t = JSON.parse(brut)
	} catch {
		return null
	}
	const x = t as Record<string, unknown> | null
	if (x === null || typeof x !== 'object') return null
	const champs = ['state', 'verificateur', 'nonce', 'retour', 'redirectUri', 'pointJeton'] as const
	if (!champs.every((champ) => typeof x[champ] === 'string' && x[champ] !== '')) return null
	if (typeof x.expireA !== 'number' || x.expireA <= maintenant) return null
	return x as unknown as TransactionSso
}

export type IssueRetour = { readonly ok: true; readonly code: string } | { readonly ok: false; readonly nature: NatureEchecSso }

/**
 * Juge l'adresse de retour AVANT tout échange. Un `state` différent n'est pas « notre » retour :
 * même une annulation n'est reconnue qu'accompagnée du bon `state`.
 */
export function jugerRetour(recherche: string, transaction: TransactionSso | null): IssueRetour {
	if (transaction === null) return { ok: false, nature: 'sso_echec' }
	const params = new URLSearchParams(recherche)
	if (params.get('state') !== transaction.state) return { ok: false, nature: 'sso_echec' }
	const erreur = params.get('error')
	if (erreur !== null) return { ok: false, nature: erreur === 'access_denied' ? 'sso_annule' : 'sso_echec' }
	const code = params.get('code')
	if (code === null || code === '') return { ok: false, nature: 'sso_echec' }
	return { ok: true, code }
}

/**
 * Échange le code chez Keycloak, en client public, avec le vérificateur. Seul l'`id_token` est lu ;
 * le jeton d'accès et le jeton de rafraîchissement de Keycloak sont ignorés (§10.3, point 6).
 */
export async function echangerCode(
	configuration: ConfigurationSso,
	transaction: TransactionSso,
	code: string,
	requete: Fetch = fetch,
): Promise<string> {
	const corps = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: configuration.clientId,
		code,
		redirect_uri: transaction.redirectUri,
		code_verifier: transaction.verificateur,
	})
	let reponse: Response
	try {
		reponse = await requete(transaction.pointJeton, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: corps.toString(),
		})
	} catch {
		throw new EchecSso('reseau')
	}
	if (!reponse.ok) throw new EchecSso(reponse.status >= 500 ? 'reseau' : 'sso_echec')
	let document: unknown
	try {
		document = await reponse.json()
	} catch {
		throw new EchecSso('sso_echec')
	}
	const idToken = (document as Record<string, unknown> | null)?.id_token
	if (typeof idToken !== 'string' || idToken === '') throw new EchecSso('sso_echec')
	return idToken
}

export type ErreurGoTrue = {
	readonly message?: string
	readonly status?: number
	readonly code?: string
}

/**
 * Classe le refus de GoTrue à l'échange d'`id_token`. `signup_disabled` couvre les deux causes
 * mesurées — aucun compte CRM (M3), adresse non vérifiée (M5) — que GoTrue ne distingue pas, et
 * que l'écran ne devine donc pas.
 */
export function classerEchecGoTrue(erreur: ErreurGoTrue): NatureEchecSso {
	if (erreur.code === 'signup_disabled') return 'sso_sans_compte'
	if (erreur.status !== undefined && (erreur.status >= 500 || erreur.status === 0)) return 'reseau'
	if (erreur.status === undefined) {
		const message = erreur.message?.toLocaleLowerCase('en') ?? ''
		if (/fetch|network|timeout|connexion|connection/.test(message)) return 'reseau'
	}
	return 'sso_echec'
}

/** Nature d'une erreur quelconque levée pendant le parcours. */
export function natureDe(erreur: unknown): NatureEchecSso {
	return erreur instanceof EchecSso ? erreur.nature : 'sso_echec'
}
