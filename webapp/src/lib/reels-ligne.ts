// @spec CRM-099 (docs/BACKLOG.md) — tranche T2 : les réels d'une ligne de coût, et la case « Soldé »
// @spec docs/SPEC-costs.md §2.3 bis (plusieurs réels — montant, date du jour par défaut, libellé facultatif ; la ligne
//       soldée figée ; `actual_cost` dérivé, tenu par la base ; lecture et écriture : celles de la ligne) ;
//       docs/SCHEMA.md §9 quater « Migration `0088` » ; docs/DESIGN_SYSTEM.md §5.31 bis
//
// La base tient la somme, le zéro d'une ligne soldée sans réel, et le refus d'écrire sur une ligne soldée ; ce module
// envoie et rapporte. Chaque écriture rend ce que la base a retenu (`select`) : sans corps, « zéro ligne touchée »
// serait indistinguable d'un succès.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

export type Reel = {
	readonly id: string
	readonly amount: number
	readonly spent_on: string
	readonly label: string | null
}

export const COLONNES_REEL = 'id, amount, spent_on, label'

/** Les réels d'une ligne, par date de dépense puis par saisie. */
export async function lireReels(client: ClientCrm, idLigne: string): Promise<EtatAsync<readonly Reel[]>> {
	try {
		const reponse = await client
			.from('card_cost_actuals')
			.select(COLONNES_REEL)
			.eq('card_cost_id', idLigne)
			.order('spent_on')
			.order('created_at')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

export type MotifRefusReel = 'soldee' | 'forme' | 'montant-hors-echelle' | 'droit' | 'reseau' | 'inconnu'

export type IssueReel = { readonly ok: true } | { readonly ok: false; readonly motif: MotifRefusReel }

/** Le refus, d'après ce que la base a dit : le message du déclencheur de `0088` est le contrat. */
export function classerRefusReel(statut: number | undefined, code: string | undefined, texte: string): MotifRefusReel {
	if (texte.includes('ligne soldee')) return 'soldee'
	if (code === '22003') return 'montant-hors-echelle'
	if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') return 'forme'
	if (code === '42501' || statut === 401 || statut === 403) return 'droit'
	if (statut === undefined || statut === 0) return 'reseau'
	return 'inconnu'
}

async function executer(requete: () => PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null; status: number }>): Promise<IssueReel> {
	try {
		const reponse = await requete()
		if (reponse.error !== null) {
			return { ok: false, motif: classerRefusReel(reponse.status, reponse.error.code, reponse.error.message) }
		}
		// Zéro ligne touchée : la RLS a filtré sans lever — un refus, jamais un succès.
		return (reponse.data?.length ?? 0) === 1 ? { ok: true } : { ok: false, motif: 'droit' }
	} catch (cause) {
		return { ok: false, motif: classerRefusReel(undefined, undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}

export type SaisieReel = {
	readonly montant: number
	/** `null` : la date du jour, que la base pose par défaut. */
	readonly date: string | null
	/** `null` ou vide : sans libellé. */
	readonly libelle: string | null
}

const libelleOuNul = (libelle: string | null) => (libelle === null || libelle.trim() === '' ? null : libelle.trim())

export function ajouterReel(client: ClientCrm, idLigne: string, saisie: SaisieReel): Promise<IssueReel> {
	return executer(() =>
		client
			.from('card_cost_actuals')
			.insert({
				card_cost_id: idLigne,
				amount: saisie.montant,
				label: libelleOuNul(saisie.libelle),
				...(saisie.date === null ? {} : { spent_on: saisie.date }),
			})
			.select('id'),
	)
}

export function modifierReel(client: ClientCrm, id: string, saisie: SaisieReel): Promise<IssueReel> {
	return executer(() =>
		client
			.from('card_cost_actuals')
			.update({
				amount: saisie.montant,
				label: libelleOuNul(saisie.libelle),
				...(saisie.date === null ? {} : { spent_on: saisie.date }),
			})
			.eq('id', id)
			.select('id'),
	)
}

export function supprimerReel(client: ClientCrm, id: string): Promise<IssueReel> {
	return executer(() => client.from('card_cost_actuals').delete().eq('id', id).select('id'))
}

/**
 * Coche ou décoche « Soldé ». La valeur envoyée n'est qu'un drapeau : la base pose l'horodatage et l'auteur (§2.3 bis).
 * Rend le réel de la ligne retenu par la base — la somme, ou zéro pour une ligne soldée sans réel.
 */
export async function solderLigne(
	client: ClientCrm,
	idLigne: string,
	soldee: boolean,
): Promise<{ readonly ok: true; readonly reel: number | null } | { readonly ok: false; readonly motif: MotifRefusReel }> {
	try {
		const reponse = await client
			.from('card_costs')
			.update({ settled_at: soldee ? new Date().toISOString() : null })
			.eq('id', idLigne)
			.select('actual_cost')
		if (reponse.error !== null) {
			return { ok: false, motif: classerRefusReel(reponse.status, reponse.error.code, reponse.error.message) }
		}
		const ligne = reponse.data?.[0]
		if (ligne === undefined) return { ok: false, motif: 'droit' }
		return { ok: true, reel: ligne.actual_cost }
	} catch (cause) {
		return { ok: false, motif: classerRefusReel(undefined, undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}
