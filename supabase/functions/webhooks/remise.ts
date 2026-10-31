// @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : un essai de remise
// @spec docs/SPEC-webhooks.md §5.1 (`POST` JSON, délai de 10 s, redirections non suivies, en-têtes), §5.2 (un 2xx réussit),
//       §6 (hôte vérifié avant chaque essai ; motifs courts, jamais le corps de la réponse)
//
// Module pur : `fetch`, la résolution et l'horloge sont injectés. Le résultat est un code HTTP, ou un motif de la liste
// fermée de `webhook_deliveries.last_error` — jamais un message brut.

import { type Resoudre, verifierHote } from './adresse.ts'
import { enteteSignature } from './signature.ts'

export const DELAI_REMISE_MS = 10_000
export const AGENT = 'P2Enjoy-CRM-Webhooks/1'

export type Motif = 'timeout' | 'connection_refused' | 'address_forbidden' | 'tls_error' | 'dns_error' | 'network_error'

/** Une remise prise par `claim_webhook_deliveries`. */
export type Remise = {
	readonly delivery_id: string
	readonly url: string
	readonly event: string
	readonly payload: unknown
	readonly secret: string
	readonly attempt: number
}

export type Resultat = { readonly statut: number; readonly motif: null } | { readonly statut: null; readonly motif: Motif }

export type Fetch = (url: string, init?: RequestInit & { client?: unknown }) => Promise<Response>

export type OutilsRemise = {
	readonly requete: Fetch
	readonly resoudre: Resoudre
	readonly autorises: ReadonlySet<string>
	readonly maintenantS: () => number
	readonly client?: unknown
	readonly delaiMs?: number
}

/** Le motif d'un échec réseau, lu au nom et au message de l'erreur, qui diffèrent d'un runtime à l'autre. */
export function motifDe(erreur: unknown): Motif {
	const nom = typeof erreur === 'object' && erreur !== null ? String((erreur as { name?: unknown }).name ?? '') : ''
	if (nom === 'TimeoutError' || nom === 'AbortError') return 'timeout'
	const message = String(erreur).toLowerCase()
	if (message.includes('connection refused')) return 'connection_refused'
	if (message.includes('certificate') || message.includes('tls') || message.includes('ssl')) return 'tls_error'
	if (message.includes('dns') || message.includes('failed to lookup') || message.includes('name or service not known'))
		return 'dns_error'
	if (message.includes('timed out')) return 'timeout'
	return 'network_error'
}

/** Un essai : l'hôte vérifié, la requête signée, le code rendu. Le corps de la réponse est lu puis jeté. */
export async function remettre(remise: Remise, outils: OutilsRemise): Promise<Resultat> {
	let hote: string
	try {
		const url = new URL(remise.url)
		if (url.protocol !== 'https:') return { statut: null, motif: 'address_forbidden' }
		hote = url.hostname
	} catch {
		return { statut: null, motif: 'address_forbidden' }
	}
	const verdict = await verifierHote(hote, outils.resoudre, outils.autorises)
	if (verdict !== 'ok') return { statut: null, motif: verdict }

	const corps = JSON.stringify(remise.payload)
	const horodatage = outils.maintenantS()
	try {
		const reponse = await outils.requete(remise.url, {
			method: 'POST',
			redirect: 'manual',
			signal: AbortSignal.timeout(outils.delaiMs ?? DELAI_REMISE_MS),
			headers: {
				'content-type': 'application/json',
				'user-agent': AGENT,
				'x-p2enjoy-event': remise.event,
				'x-p2enjoy-delivery': remise.delivery_id,
				'x-p2enjoy-signature': await enteteSignature(remise.secret, horodatage, corps),
			},
			body: corps,
			...(outils.client ? { client: outils.client } : {}),
		})
		await reponse.body?.cancel().catch(() => undefined)
		return { statut: reponse.status, motif: null }
	} catch (erreur) {
		return { statut: null, motif: motifDe(erreur) }
	}
}
