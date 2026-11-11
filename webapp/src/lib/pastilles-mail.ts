// @spec CRM-141 (docs/BACKLOG.md) — tranche T3 : lire les pastilles des mails de l'espace, les écrire (administrateur),
//       les archiver ; classer les refus
// @spec CRM-141 (docs/BACKLOG.md) — tranche T4 : le catalogue de l'inbox, toutes les pastilles lisibles avec leur espace
//       (docs/SPEC-mail-subsystem.md §31.7)
// @spec docs/SPEC-mail-subsystem.md §31.2 (`mail_labels` : nom de 1 à 40, unique archivées comprises ; un des cinq jetons ;
//       un descriptif de 1 à 500), §31.3 (lecture par tout membre, écriture par l'administrateur), §31.7 (l'écran) ;
//       docs/DESIGN_SYSTEM.md §5.103 ; CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit, et la base tranche
//
// Ce module ne rend rien : il lit, écrit et classe les refus.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { CouleurNoeud } from './board'
import { COULEURS_ETIQUETTE, couleurEtiquette } from './etiquettes'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_PASTILLE_MAIL = 'id, workspace_id, name, color, description, archived_at'

/** Les cinq couleurs sont celles des étiquettes et des tracks : un seul jeu de jetons (§5.103, §5.68). */
export const COULEURS_PASTILLE_MAIL: readonly CouleurNoeud[] = COULEURS_ETIQUETTE

/** Les bornes de la base (§31.2), dites à l'écran avant l'envoi : jamais une garde qui double une contrainte. */
export const LONGUEUR_NOM_PASTILLE = 40
export const LONGUEUR_DESCRIPTIF_PASTILLE = 500

export type PastilleMailLue = {
	readonly id: string
	readonly workspace_id: string
	readonly name: string
	readonly color: string
	readonly description: string
	readonly archived_at: string | null
}

export type PastilleMail = {
	readonly id: string
	/** L'espace de la pastille : le panneau d'un message ne propose que celles de l'espace du message (`CRM-141` T4). */
	readonly idEspace: string
	readonly nom: string
	readonly couleur: CouleurNoeud
	readonly descriptif: string
	readonly archivee: boolean
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr', { sensitivity: 'base' })

/** Les actives d'abord, puis les archivées ; chaque groupe dans l'ordre du nom. */
export function projeterPastillesMail(lignes: readonly (PastilleMailLue | null | undefined)[]): readonly PastilleMail[] {
	return lignes
		.filter((l): l is PastilleMailLue => l !== null && l !== undefined)
		.map((l) => ({
			id: l.id,
			idEspace: l.workspace_id,
			nom: l.name,
			couleur: couleurEtiquette(l.color),
			descriptif: l.description,
			archivee: l.archived_at !== null,
		}))
		.sort((a, b) => Number(a.archivee) - Number(b.archivee) || compare(a.nom, b.nom) || compare(a.id, b.id))
}

/** Toutes les pastilles de l'espace, archivées comprises : la RLS les borne aux espaces dont on est membre. */
export async function lirePastillesMail(client: ClientCrm, idWorkspace: string): Promise<EtatAsync<readonly PastilleMail[]>> {
	try {
		const reponse = await client.from('mail_labels').select(COLONNES_PASTILLE_MAIL).eq('workspace_id', idWorkspace)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(projeterPastillesMail((reponse.data ?? []) as readonly PastilleMailLue[]))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * `CRM-141` T4 — le catalogue de l'inbox : TOUTES les pastilles lisibles, archivées comprises, de tous les espaces dont
 * on est membre (la RLS les borne). L'inbox montre le courrier de chacun d'eux, et une archivée reste affichée.
 */
export async function lireCataloguePastillesMail(client: ClientCrm): Promise<EtatAsync<ReadonlyMap<string, PastilleMail>>> {
	try {
		const reponse = await client.from('mail_labels').select(COLONNES_PASTILLE_MAIL)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const pastilles = projeterPastillesMail((reponse.data ?? []) as readonly PastilleMailLue[])
		return pret(new Map(pastilles.map((p) => [p.id, p])))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusPastilleMail =
	/** `23505` : une pastille — active ou archivée — porte déjà ce nom, à la casse près. */
	| 'nom-pris'
	/** `23514` : nom ou descriptif hors de ses bornes, couleur hors des cinq jetons. */
	| 'forme'
	/** `401`, `403`, `42501` : la liste est à l'administrateur de l'espace. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré, ou la ligne a disparu. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

export function classerRefusPastilleMail(
	statutHttp: number | undefined,
	code: string | undefined,
): NatureRefusPastilleMail {
	if (code === '23505') return 'nom-pris'
	if (code === '23514') return 'forme'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssuePastilleMail =
	| { readonly statut: 'applique' }
	| { readonly statut: 'refus'; readonly nature: NatureRefusPastilleMail }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseBrute>): Promise<IssuePastilleMail> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) return { statut: 'refus', nature: classerRefusPastilleMail(reponse.status, reponse.error.code) }
		if (Array.isArray(reponse.data) && reponse.data.length === 0) return { statut: 'refus', nature: 'sans-effet' }
		return { statut: 'applique' }
	} catch {
		return { statut: 'refus', nature: 'network' }
	}
}

export type SaisiePastilleMail = { readonly nom: string; readonly couleur: CouleurNoeud; readonly descriptif: string }

/** Crée une pastille. L'auteur et les dates sont posés par la base. */
export function creerPastilleMail(client: ClientCrm, idWorkspace: string, saisie: SaisiePastilleMail): Promise<IssuePastilleMail> {
	return executer(() =>
		client
			.from('mail_labels')
			.insert({
				workspace_id: idWorkspace,
				name: saisie.nom.trim(),
				color: saisie.couleur,
				description: saisie.descriptif.trim(),
			})
			.select('id'),
	)
}

export function modifierPastilleMail(client: ClientCrm, idPastille: string, saisie: SaisiePastilleMail): Promise<IssuePastilleMail> {
	return executer(() =>
		client
			.from('mail_labels')
			.update({ name: saisie.nom.trim(), color: saisie.couleur, description: saisie.descriptif.trim() })
			.eq('id', idPastille)
			.select('id'),
	)
}

/**
 * Archive ou désarchive (décision 926 : le geste « supprimer » des réglages est un archivage). Archivée, une pastille
 * n'est plus posée, ni par l'IA ni à la main ; elle reste affichée sur les mails qui la portent.
 */
export function archiverPastilleMail(
	client: ClientCrm,
	idPastille: string,
	archive: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<IssuePastilleMail> {
	return executer(() =>
		client
			.from('mail_labels')
			.update({ archived_at: archive ? maintenant() : null })
			.eq('id', idPastille)
			.select('id'),
	)
}
