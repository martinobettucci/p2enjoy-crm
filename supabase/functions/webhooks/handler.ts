// @spec CRM-073 (docs/BACKLOG.md) — tranche T2 : un passage de remise
// @spec docs/SPEC-webhooks.md §2 (la fonction remet, la base décide ; réveillée par `pg_cron` avec un secret d'appel),
//       §5.2 (au plus 50 remises par passage), §6 (journaux sans adresse, corps, secret ni signature), §12 ;
//       docs/SPEC-edge-functions.md §2 bis (aucune fonction ne rend `204`)
//
// `POST /webhooks/remettre`, et rien d'autre. Sans le bon secret d'appel, `401` avant toute lecture. Les remises prises
// partent en parallèle ; chaque résultat est rendu à la base, qui décide de l'état et du prochain essai.

import { type OutilsRemise, type Remise, type Resultat, remettre } from './remise.ts'

export const LIMITE_PASSAGE = 50

export type DependancesWebhooks = {
	readonly verifierAppel: (secret: string) => Promise<boolean>
	readonly prendre: (limite: number) => Promise<Remise[]>
	readonly inscrire: (remise: string, resultat: Resultat) => Promise<void>
	readonly outils: () => Promise<OutilsRemise>
	readonly journal: (ligne: Record<string, unknown>) => void
}

const json = (statut: number, corps: unknown) =>
	new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })

export async function traiterWebhooks(requete: Request, dependances: DependancesWebhooks): Promise<Response> {
	const chemin = new URL(requete.url).pathname.replace(/\/+$/, '')
	if (!chemin.endsWith('/remettre')) return json(404, { error: 'not_found' })
	if (requete.method !== 'POST') return json(405, { error: 'method_not_allowed' })
	const secret = requete.headers.get('x-webhooks-dispatch') ?? ''
	if (!secret || !(await dependances.verifierAppel(secret))) return json(401, { error: 'unauthorized' })

	const debut = Date.now()
	const remises = await dependances.prendre(LIMITE_PASSAGE)
	const outils = remises.length > 0 ? await dependances.outils() : null
	const resultats = await Promise.all(
		remises.map(async (remise) => {
			const resultat = await remettre(remise, outils as OutilsRemise)
			await dependances.inscrire(remise.delivery_id, resultat)
			return resultat
		}),
	)
	const reussies = resultats.filter((r) => r.statut !== null && r.statut >= 200 && r.statut <= 299).length
	const bilan = { prises: remises.length, reussies, echouees: remises.length - reussies }
	dependances.journal({ fonction: 'webhooks', ...bilan, duree_ms: Date.now() - debut })
	return json(200, bilan)
}
