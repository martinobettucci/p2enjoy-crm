// @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : les dépendances réelles de la fonction `webhooks`
// @spec docs/SPEC-webhooks.md §2 (la base par PostgREST, sous la clé de service : `verify_webhook_dispatch`,
//       `claim_webhook_deliveries`, `record_webhook_attempt`), §6 (`WEBHOOKS_ALLOWED_HOSTS`), §8 et §12 (en développement,
//       l'autorité du récepteur local lue à `WEBHOOKS_DEV_CA_URL`)
//
// Aucune connexion directe à PostgreSQL : la fonction parle à la base comme un client de la clé de service. Elle ne lit
// aucun fichier — le runtime le lui interdit —, d'où l'autorité de développement servie par le récepteur lui-même.

import type { DependancesWebhooks } from './handler.ts'
import type { Fetch, Remise } from './remise.ts'
import type { Resoudre } from './adresse.ts'

type LireEnv = (nom: string) => string | undefined

/** Un appel à la base ne retient jamais le passage plus de 10 s. */
export const DELAI_BASE_MS = 10_000

export type Runtime = {
	readonly resoudre: Resoudre
	readonly creerClient: (autorites: string[]) => unknown
}

/** Les hôtes autorisés malgré tout : développement seulement, la production ne pose pas la variable. */
export function hotesAutorises(valeur: string | undefined): Set<string> {
	return new Set(
		(valeur ?? '')
			.split(',')
			.map((h) => h.trim().toLowerCase())
			.filter(Boolean),
	)
}

export function creerDependances(
	lire: LireEnv,
	runtime: Runtime,
	requete: Fetch = fetch,
	ecrireJournal: (ligne: string) => void = (ligne) => console.info(ligne),
): DependancesWebhooks {
	const urlApi = lire('SUPABASE_URL')?.replace(/\/+$/, '') ?? ''
	const cleService = lire('SUPABASE_SERVICE_ROLE_KEY') ?? ''
	const autorises = hotesAutorises(lire('WEBHOOKS_ALLOWED_HOSTS'))
	const urlAutorite = lire('WEBHOOKS_DEV_CA_URL') ?? ''

	const rpc = async (nom: string, corps: unknown): Promise<Response> =>
		requete(`${urlApi}/rest/v1/rpc/${nom}`, {
			method: 'POST',
			headers: {
				apikey: cleService,
				authorization: `Bearer ${cleService}`,
				'content-type': 'application/json',
				accept: 'application/json',
			},
			body: JSON.stringify(corps),
			signal: AbortSignal.timeout(DELAI_BASE_MS),
		})

	return {
		async verifierAppel(secret) {
			const reponse = await rpc('verify_webhook_dispatch', { p_secret: secret })
			return reponse.ok && (await reponse.json()) === true
		},
		async prendre(limite) {
			const reponse = await rpc('claim_webhook_deliveries', { p_limit: limite })
			if (!reponse.ok) throw new Error(`claim_webhook_deliveries ${reponse.status}`)
			const corps: unknown = await reponse.json()
			return Array.isArray(corps) ? (corps as Remise[]) : []
		},
		async inscrire(remise, resultat) {
			const reponse = await rpc('record_webhook_attempt', {
				p_delivery: remise,
				p_status_code: resultat.statut,
				p_error: resultat.motif,
			})
			await reponse.body?.cancel().catch(() => undefined)
		},
		async outils() {
			let client: unknown
			if (urlAutorite) {
				// Développement : l'autorité du récepteur local, lue chez lui, sur le réseau interne de la pile.
				try {
					const reponse = await requete(urlAutorite, { signal: AbortSignal.timeout(DELAI_BASE_MS) })
					if (reponse.ok) client = runtime.creerClient([await reponse.text()])
				} catch {
					client = undefined
				}
			}
			return {
				requete,
				resoudre: runtime.resoudre,
				autorises,
				maintenantS: () => Math.floor(Date.now() / 1000),
				...(client ? { client } : {}),
			}
		},
		journal: (ligne) => ecrireJournal(JSON.stringify(ligne)),
	}
}
