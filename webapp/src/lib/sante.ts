// @spec CRM-066 (docs/BACKLOG.md) — tranche 4 : les deux scores de santé d'une affaire, lus et nommés pour l'écran
// @spec docs/SPEC-analytique.md §13.2 (les pénalités), §13.3 (les signaux, le signal inconnu), §13.5 (l'objet rendu par
//       la base), §13.6 (l'écran) ; docs/DESIGN_SYSTEM.md §5.65 ; docs/JOURNAL.md décisions 708, 723 et 724
//
// CE MODULE NE CALCULE RIEN : les deux scores sont des colonnes calculées de la base (`health_momentum`,
// `health_commercial`). Il VÉRIFIE la forme de ce qu'elle rend — une colonne `jsonb` n'a pas de type —, et donne à chaque
// palier, pénalité et signal sa clé de traduction. Une forme inattendue rend `null` : l'écran n'affiche alors aucun score
// plutôt qu'un nombre qu'il aurait deviné.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { CleTraduction } from '../i18n'
import type { ClientCrm } from './supabase'

export type Palier = 'healthy' | 'watch' | 'danger'

export type Penalite = {
	readonly code: string
	readonly points: number
	readonly jours: number | null
	readonly seuil: number | null
}

export type Signal = {
	readonly code: string
	readonly poids: number
	/** `null` : le signal est inconnu, et son poids a été réparti sur les autres (§13.3). */
	readonly note: number | null
}

export type ScoreDynamique = { readonly score: number; readonly palier: Palier; readonly penalites: readonly Penalite[] }
export type ScoreCommercial = { readonly score: number; readonly palier: Palier; readonly signaux: readonly Signal[] }

const PALIERS: readonly Palier[] = ['healthy', 'watch', 'danger']

const nombre = (valeur: unknown): number | null => (typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null)
const objet = (valeur: unknown): Record<string, unknown> | null =>
	typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null

function socle(brut: unknown): { o: Record<string, unknown>; score: number; palier: Palier } | null {
	const o = objet(brut)
	if (o === null) return null
	const score = nombre(o.score)
	const palier = o.tier
	if (score === null || typeof palier !== 'string' || !PALIERS.includes(palier as Palier)) return null
	return { o, score, palier: palier as Palier }
}

/** La dynamique telle que la base la rend, ou `null` — affaire décidée, ou forme inattendue. */
export function lireDynamique(brut: unknown): ScoreDynamique | null {
	const base = socle(brut)
	if (base === null || !Array.isArray(base.o.penalties)) return null
	const penalites: Penalite[] = []
	for (const element of base.o.penalties) {
		const p = objet(element)
		const points = nombre(p?.points)
		if (p === null || typeof p.code !== 'string' || points === null) return null
		penalites.push({ code: p.code, points, jours: nombre(p.days), seuil: nombre(p.threshold) })
	}
	return { score: base.score, palier: base.palier, penalites }
}

/** La santé commerciale telle que la base la rend, ou `null`. */
export function lireCommerciale(brut: unknown): ScoreCommercial | null {
	const base = socle(brut)
	if (base === null || !Array.isArray(base.o.signals)) return null
	const signaux: Signal[] = []
	for (const element of base.o.signals) {
		const s = objet(element)
		const poids = nombre(s?.weight)
		if (s === null || typeof s.code !== 'string' || poids === null) return null
		signaux.push({ code: s.code, poids, note: nombre(s.value) })
	}
	return { score: base.score, palier: base.palier, signaux }
}

/** Le palier en toutes lettres — le §1 du design system : jamais la seule couleur. */
export const CLE_PALIER: Readonly<Record<Palier, CleTraduction>> = {
	healthy: 'health.tier.healthy',
	watch: 'health.tier.watch',
	danger: 'health.tier.danger',
}

/** Les classes de la pastille, le couple « doux / sur-doux » de la teinte du palier (§5.65). */
export const CLASSES_PALIER: Readonly<Record<Palier, string>> = {
	healthy: 'bg-success-soft text-success-on-soft',
	watch: 'bg-accent-soft text-accent-on-soft',
	danger: 'bg-danger-soft text-danger-on-soft',
}

/** Le libellé d'une pénalité. Un code inconnu de cet écran garde son code : il est écrit, jamais tu. */
export const CLE_PENALITE: Readonly<Record<string, CleTraduction>> = {
	stale_step: 'health.penalty.stale_step',
	next_action_overdue: 'health.penalty.next_action_overdue',
	next_action_missing: 'health.penalty.next_action_missing',
	no_contact_14: 'health.penalty.no_contact_14',
	no_contact_30: 'health.penalty.no_contact_30',
}

export const CLE_SIGNAL: Readonly<Record<string, CleTraduction>> = {
	probability: 'health.signal.probability',
	contact_freshness: 'health.signal.contact_freshness',
	next_action_timeliness: 'health.signal.next_action_timeliness',
	step_age: 'health.signal.step_age',
}

export type ScoresAffaire = {
	readonly dynamique: ScoreDynamique | null
	readonly commerciale: ScoreCommercial | null
}

/** Les deux scores d'une affaire, pour la fiche. La RLS décide : une affaire illisible rend un refus classé. */
export async function lireScoresAffaire(client: ClientCrm | null, idCard: string): Promise<EtatAsync<ScoresAffaire>> {
	if (client === null) return enErreur({ nature: 'unknown', detail: 'configuration_absente' })
	try {
		const reponse = await client.from('cards').select('health_momentum, health_commercial').eq('id', idCard).limit(1)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const ligne = reponse.data[0]
		if (ligne === undefined) return enErreur({ nature: 'forbidden', detail: 'card_invisible' })
		return pret({ dynamique: lireDynamique(ligne.health_momentum), commerciale: lireCommerciale(ligne.health_commercial) })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}
