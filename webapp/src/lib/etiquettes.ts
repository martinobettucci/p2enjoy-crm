// @spec CRM-069 (docs/BACKLOG.md) — tranche T2 : lire le catalogue d'étiquettes, l'écrire (administrateur), poser et retirer
//       une étiquette sur une affaire ; classer les refus
// @spec docs/SPEC-etiquettes-digest.md §2.1 (le catalogue), §2.2 (la pose : `22023 label_archived`, zéro ligne = refus),
//       §3 (les écrans) ; docs/DESIGN_SYSTEM.md §5.73
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit, et la base tranche ; ses refus sont classés ici
//
// Ce module ne rend rien : il lit, écrit et classe les refus.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { CouleurNoeud } from './board'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_ETIQUETTE = 'id, name, color, archived_at'
/** Les étiquettes d'une affaire, plongées depuis `cards` par la lecture qui l'affiche (board, fiche, liste). */
export const COLONNES_ETIQUETTES_AFFAIRE = `etiquettes:card_labels(etiquette:labels(${COLONNES_ETIQUETTE}))`

export const COULEURS_ETIQUETTE: readonly CouleurNoeud[] = ['brand', 'success', 'accent', 'danger', 'neutral']

export type EtiquetteLue = {
	readonly id: string
	readonly name: string
	readonly color: string
	readonly archived_at: string | null
}

export type Etiquette = {
	readonly id: string
	readonly nom: string
	readonly couleur: CouleurNoeud
	readonly archivee: boolean
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr', { sensitivity: 'base' })

/** Une couleur hors de la palette se lit `neutral` : la base la refuse, mais un type ne garantit jamais une valeur. */
export function couleurEtiquette(couleur: string): CouleurNoeud {
	return (COULEURS_ETIQUETTE as readonly string[]).includes(couleur) ? (couleur as CouleurNoeud) : 'neutral'
}

export function projeterEtiquettes(lignes: readonly (EtiquetteLue | null | undefined)[]): readonly Etiquette[] {
	return lignes
		.filter((l): l is EtiquetteLue => l !== null && l !== undefined)
		.map((l) => ({ id: l.id, nom: l.name, couleur: couleurEtiquette(l.color), archivee: l.archived_at !== null }))
		.sort((a, b) => compare(a.nom, b.nom) || compare(a.id, b.id))
}

/** Les étiquettes d'une affaire, depuis son plongement `etiquettes:card_labels(etiquette:labels(…))`. */
export function etiquettesDeLAffaire(
	plongement: readonly { readonly etiquette: EtiquetteLue | null }[] | null | undefined,
): readonly Etiquette[] {
	return projeterEtiquettes((plongement ?? []).map((p) => p.etiquette))
}

/** Le catalogue de l'espace courant — la RLS le borne aux espaces dont on est membre —, archivées comprises si demandé. */
export async function lireEtiquettes(
	client: ClientCrm,
	options: { readonly archives?: boolean } = {},
): Promise<EtatAsync<readonly Etiquette[]>> {
	try {
		const base = client.from('labels').select(COLONNES_ETIQUETTE)
		const reponse = await (options.archives === true ? base : base.is('archived_at', null))
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(projeterEtiquettes((reponse.data ?? []) as readonly EtiquetteLue[]))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusEtiquette =
	/** `23505` : une étiquette non archivée porte déjà ce nom, à la casse près. */
	| 'nom-pris'
	/** `23514` : nom blanc ou de plus de 40 caractères. */
	| 'forme'
	/** `22023 label_archived` : une étiquette archivée n'est plus posée. */
	| 'archivee'
	/** `401`, `403`, `42501` : le catalogue est à l'administrateur, la pose à qui écrit l'affaire. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré, ou la ligne a disparu. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

export function classerRefusEtiquette(statutHttp: number | undefined, code: string | undefined, message: string): NatureRefusEtiquette {
	if (code === '23505' && message.includes('card_labels_pkey')) return 'sans-effet'
	if (code === '23505') return 'nom-pris'
	if (code === '23514') return 'forme'
	if (message === 'label_archived') return 'archivee'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueEtiquette =
	| { readonly statut: 'applique' }
	| { readonly statut: 'refus'; readonly nature: NatureRefusEtiquette }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseBrute>): Promise<IssueEtiquette> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return { statut: 'refus', nature: classerRefusEtiquette(reponse.status, reponse.error.code, reponse.error.message) }
		}
		if (Array.isArray(reponse.data) && reponse.data.length === 0) return { statut: 'refus', nature: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			nature: classerRefusEtiquette(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

export type SaisieEtiquette = { readonly nom: string; readonly couleur: CouleurNoeud }

/** Pose une étiquette au catalogue. L'auteur et les dates sont posés par la base. */
export function poserEtiquette(client: ClientCrm, idWorkspace: string, saisie: SaisieEtiquette): Promise<IssueEtiquette> {
	return executer(() =>
		client
			.from('labels')
			.insert({ workspace_id: idWorkspace, name: saisie.nom.trim(), color: saisie.couleur })
			.select('id'),
	)
}

export function modifierEtiquette(client: ClientCrm, idEtiquette: string, saisie: SaisieEtiquette): Promise<IssueEtiquette> {
	return executer(() =>
		client.from('labels').update({ name: saisie.nom.trim(), color: saisie.couleur }).eq('id', idEtiquette).select('id'),
	)
}

/** Archive ou désarchive : archivée, elle n'est plus proposée, et son nom est libéré. */
export function archiverEtiquette(
	client: ClientCrm,
	idEtiquette: string,
	archive: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<IssueEtiquette> {
	return executer(() =>
		client
			.from('labels')
			.update({ archived_at: archive ? maintenant() : null })
			.eq('id', idEtiquette)
			.select('id'),
	)
}

/** Pose ou retire une étiquette sur une affaire. L'espace et l'auteur sont posés par la base (§2.2). */
export function basculerEtiquetteAffaire(
	client: ClientCrm,
	idCard: string,
	idEtiquette: string,
	posee: boolean,
): Promise<IssueEtiquette> {
	return executer(() =>
		posee
			? client
					.from('card_labels')
					// Le générateur exige `workspace_id`, que la base pose depuis l'affaire et que le privilège de colonne refuse
					// au client (`app.card_labels_avant`, migration 0132) : la ligne envoyée n'a que l'affaire et l'étiquette.
					.insert({ card_id: idCard, label_id: idEtiquette } as unknown as Database['public']['Tables']['card_labels']['Insert'])
					.select('card_id')
			: client.from('card_labels').delete().eq('card_id', idCard).eq('label_id', idEtiquette).select('card_id'),
	)
}
