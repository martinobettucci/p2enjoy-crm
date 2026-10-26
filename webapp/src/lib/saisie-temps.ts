// @spec CRM-098 (docs/BACKLOG.md) — tranche T2 : lire et écrire le temps de la semaine
// @spec docs/SPEC-temps.md §3.2 (une ligne par personne × jour × cible ; zéro supprime la ligne ; seules les minutes
//       changent), §5 (les refus viennent de la base : plafond, droit), §6.1 (la semaine et la précédente ; tracks et
//       channels non archivés ; recherche d'affaire par titre), §7.2 (« Saisir pour ») ; docs/SCHEMA.md §9 quater
//       « Migration `0087` » ; docs/DESIGN_SYSTEM.md §5.7 ter (le champ qui s'enregistre seul), §5.54
// @spec CRM-111 (docs/BACKLOG.md) — tranche T2.4.1 : le channel d'une affaire est celui de son plus ancien rattachement ;
//       la recherche ne propose que les affaires dont un rattachement est actif (docs/SPEC-rattachements.md §6)
//
// Aucune règle n'est rejouée ici : la base tient le plafond, la cible lisible et qui écrit pour qui. Ce module envoie,
// et traduit la réponse en une issue que l'écran sait dire.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { premierRattachement } from './rattachements'
import type { ClientCrm } from './supabase'
import type { Affaire, ArbreTrack, Cible, Saisie } from './temps'

export const COLONNES_SAISIE = 'id, jour, minutes, track_id, channel_id, card_id'
export const COLONNES_ARBRE = 'id, name, position, channels(id, name, position)'
// `CRM-111` T2.4.1 : le channel est celui du rattachement ; la recherche emploie `!inner` pour filtrer sur lui.
export const COLONNES_AFFAIRE = 'id, title, card_placements!card_placements_card_fk!inner(id, channel_id, created_at)'
/** La recherche d'affaire rend au plus ce nombre de propositions : une liste plus longue ne se parcourt pas. */
export const BORNE_RECHERCHE_AFFAIRE = 10

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** Les tracks lisibles et non archivés, chacun avec ses channels non archivés, dans l'ordre de l'arborescence. */
export async function lireArbreTemps(client: ClientCrm): Promise<EtatAsync<readonly ArbreTrack[]>> {
	try {
		const reponse = await client
			.from('tracks')
			.select(COLONNES_ARBRE)
			.is('archived_at', null)
			.is('channels.archived_at', null)
			.order('position')
			.order('name')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			reponse.data.map((track) => ({
				id: track.id,
				name: track.name,
				channels: [...(track.channels ?? [])]
					.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'fr'))
					.map((c) => ({ id: c.id, name: c.name })),
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, message(cause)))
	}
}

/**
 * Le temps d'une personne entre deux jours inclus — la semaine affichée ET la précédente, dont les affaires sont
 * reprises d'office. La RLS ne rend que le temps de l'appelant, ou celui de chacun à un administrateur.
 */
export async function lireSaisies(
	client: ClientCrm,
	idWorkspace: string,
	idPersonne: string,
	debut: string,
	fin: string,
): Promise<EtatAsync<readonly Saisie[]>> {
	try {
		const reponse = await client
			.from('saisies_temps')
			.select(COLONNES_SAISIE)
			.eq('workspace_id', idWorkspace)
			.eq('profile_id', idPersonne)
			.gte('jour', debut)
			.lte('jour', fin)
			.order('jour')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, message(cause)))
	}
}

/**
 * Les affaires lues, situées par le channel de leur plus ancien rattachement (`CRM-111` T2.4.1). Une affaire dont
 * aucun rattachement n'est lisible n'a pas de place dans l'arbre : elle est écartée — ce qui n'arrive pas tant qu'une
 * affaire n'a qu'un rattachement, la règle de lecture de l'affaire étant celle de son rattachement.
 */
export function affairesSituees(
	lignes: readonly {
		readonly id: string
		readonly title: string
		readonly card_placements: readonly { readonly id: string; readonly channel_id: string; readonly created_at: string }[]
	}[],
): readonly Affaire[] {
	const situees: Affaire[] = []
	for (const ligne of lignes) {
		const rattachement = premierRattachement(ligne.card_placements)
		if (rattachement !== null) situees.push({ id: ligne.id, title: ligne.title, channel_id: rattachement.channel_id })
	}
	return situees
}

/** Les affaires nommées par leurs identifiants — celles que portent les saisies. Aucune requête pour une liste vide. */
export async function lireAffaires(client: ClientCrm, ids: readonly string[]): Promise<EtatAsync<readonly Affaire[]>> {
	if (ids.length === 0) return pret([])
	try {
		const reponse = await client.from('cards').select(COLONNES_AFFAIRE).in('id', [...ids])
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(affairesSituees(reponse.data))
	} catch (cause) {
		return enErreur(classerErreur(undefined, message(cause)))
	}
}

/**
 * Les affaires actives dont le titre contient le terme, par titre. Les jokers de `ilike` tapés par l'utilisateur sont
 * neutralisés : « 100% » cherche « 100% », pas « 100 » suivi de n'importe quoi.
 */
export async function chercherAffaires(client: ClientCrm, terme: string): Promise<EtatAsync<readonly Affaire[]>> {
	const nettoye = terme.trim()
	if (nettoye === '') return pret([])
	const motif = `%${nettoye.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
	try {
		const reponse = await client
			.from('cards')
			.select(COLONNES_AFFAIRE)
			.ilike('title', motif)
			// `CRM-111` T2.4.1 : une affaire active, c'est un rattachement actif (`!inner` sur les seuls non archivés).
			.is('card_placements.archived_at', null)
			.is('deleted_at', null)
			.order('title')
			.limit(BORNE_RECHERCHE_AFFAIRE)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(affairesSituees(reponse.data))
	} catch (cause) {
		return enErreur(classerErreur(undefined, message(cause)))
	}
}

export type MotifRefusTemps = 'plafond' | 'droit' | 'conflit' | 'reseau' | 'inconnu'

export type IssueEcriture =
	/** `saisie` est la ligne retenue par la base, ou `null` quand la cellule a été remise à zéro. */
	| { readonly statut: 'applique'; readonly saisie: Saisie | null }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly motif: MotifRefusTemps }

/**
 * Le refus, d'après ce que la base a réellement dit. Le plafond est le seul refus métier, et son message est le
 * contrat de la migration (`raise exception 'plafond journalier'`). `23505` : une autre fenêtre a créé la même
 * cellule entre-temps — relire suffit.
 */
export function classerRefusTemps(statut: number | undefined, code: string | undefined, texte: string): MotifRefusTemps {
	if (texte.includes('plafond journalier')) return 'plafond'
	if (code === '42501' || statut === 401 || statut === 403) return 'droit'
	if (code === '23505') return 'conflit'
	if (statut === undefined || statut === 0) return 'reseau'
	return 'inconnu'
}

export type Ecriture = {
	readonly idWorkspace: string
	readonly idPersonne: string
	readonly jour: string
	readonly cible: Cible
	readonly minutes: number
	/** La saisie qui occupe déjà la cellule, s'il y en a une. */
	readonly existante: Saisie | null
}

/**
 * Enregistre une cellule : zéro supprime la ligne (§3.2 : aucune ligne à zéro n'existe), une cellule occupée change
 * ses seules minutes, une cellule vide reçoit une ligne. Chaque écriture rend la ligne retenue (`select`) : sans corps,
 * « zéro ligne touchée » serait indistinguable d'un succès.
 */
export async function ecrireCellule(client: ClientCrm, ecriture: Ecriture): Promise<IssueEcriture> {
	const { existante, minutes } = ecriture
	try {
		if (existante === null && minutes === 0) return { statut: 'applique', saisie: null }
		const requete =
			existante === null
				? client
						.from('saisies_temps')
						.insert({
							workspace_id: ecriture.idWorkspace,
							profile_id: ecriture.idPersonne,
							jour: ecriture.jour,
							minutes,
							track_id: ecriture.cible.genre === 'track' ? ecriture.cible.id : null,
							channel_id: ecriture.cible.genre === 'channel' ? ecriture.cible.id : null,
							card_id: ecriture.cible.genre === 'card' ? ecriture.cible.id : null,
						})
						.select(COLONNES_SAISIE)
				: minutes === 0
					? client.from('saisies_temps').delete().eq('id', existante.id).select(COLONNES_SAISIE)
					: client.from('saisies_temps').update({ minutes }).eq('id', existante.id).select(COLONNES_SAISIE)
		const reponse = await requete
		if (reponse.error !== null) {
			return { statut: 'refus', motif: classerRefusTemps(reponse.status, reponse.error.code, reponse.error.message) }
		}
		const ligne = reponse.data?.[0]
		if (ligne === undefined) return { statut: 'sans-effet' }
		return { statut: 'applique', saisie: minutes === 0 ? null : ligne }
	} catch (cause) {
		return { statut: 'refus', motif: classerRefusTemps(undefined, undefined, message(cause)) }
	}
}
