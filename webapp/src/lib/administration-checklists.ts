// @spec CRM-068 (docs/BACKLOG.md) — tranche T3b : les checklists dans l'éditeur de workflows — les points d'une étape
//       (ajouter, renommer, réordonner, archiver) et les points exigés par une transition (exiger, ne plus exiger)
// @spec docs/SPEC-checklists.md §3.1 (les points d'une étape, réservés à l'administrateur ; un point archivé n'est plus
//       ajouté), §3.4 (une exigence porte sur un point de l'étape de DÉPART), §4 (l'éditeur, décision 759) ;
//       docs/DESIGN_SYSTEM.md §5.70 bis
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit dans les tables, et les politiques décident
//
// Ce module ne rend rien : il lit, écrit et classe les refus. L'ordre d'un point dans son étape reprend l'arithmétique de
// `CRM-075` (`calculerDeplacement`), sans la réécrire : une `position` `numeric` où l'on insère au milieu de deux
// voisines, plutôt que de permuter deux lignes en deux écritures non atomiques.

import { calculerDeplacement, type Deplacement, type Sens } from './administration-arborescence'
import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/** La borne de la base pour un libellé (`workflow_step_checklist_items_label_check`). */
export const LONGUEUR_MAX_POINT_ETAPE = 200

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_POINT_ETAPE = 'id, step_id, label, position, archived_at, created_at'
/** Une exigence, bornée au workflow par son arête : `!inner` fait du filtre sur l'arête un filtre des exigences. */
export const COLONNES_EXIGENCE_POINT = 'transition_id, step_item_id, transition:workflow_transitions!inner(workflow_id)'

export type PointEtape = Pick<
	Database['public']['Tables']['workflow_step_checklist_items']['Row'],
	'id' | 'step_id' | 'label' | 'position' | 'archived_at' | 'created_at'
>

export type ExigencePoint = { readonly idTransition: string; readonly idPoint: string }

export type ChecklistsWorkflow = {
	readonly points: readonly PointEtape[]
	readonly exigences: readonly ExigencePoint[]
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Les points d'une étape, dans l'ordre de l'étape : la position, puis la création, puis l'identifiant. */
export function pointsDeLEtape(points: readonly PointEtape[], idEtape: string): readonly PointEtape[] {
	return points
		.filter((point) => point.step_id === idEtape)
		.sort((a, b) =>
			a.position !== b.position
				? a.position - b.position
				: a.created_at !== b.created_at
					? compare(a.created_at, b.created_at)
					: compare(a.id, b.id),
		)
}

/** Les points exigés par une transition, dans l'ordre de leur étape ; archivés compris — ils restent exigés (§3.4). */
export function pointsExiges(
	checklists: ChecklistsWorkflow,
	idTransition: string,
	idEtapeDepart: string,
): readonly PointEtape[] {
	const exiges = new Set(checklists.exigences.filter((e) => e.idTransition === idTransition).map((e) => e.idPoint))
	return pointsDeLEtape(checklists.points, idEtapeDepart).filter((point) => exiges.has(point.id))
}

/**
 * Les points qu'« Exiger un point » propose : ceux de l'étape de DÉPART, non archivés, pas encore exigés. Ce n'est pas
 * une garde de droit, c'est le refus d'une cible vouée au refus — la base refuse un point d'une autre étape (§3.4).
 */
export function pointsExigeables(
	checklists: ChecklistsWorkflow,
	idTransition: string,
	idEtapeDepart: string,
): readonly PointEtape[] {
	const exiges = new Set(pointsExiges(checklists, idTransition, idEtapeDepart).map((point) => point.id))
	return pointsDeLEtape(checklists.points, idEtapeDepart).filter(
		(point) => point.archived_at === null && !exiges.has(point.id),
	)
}

/** La position d'un point ajouté : après le dernier de l'étape, archivés compris — ils occupent leur place (§5.18). */
export const positionNouveauPoint = (points: readonly PointEtape[], idEtape: string): number =>
	Math.max(0, ...pointsDeLEtape(points, idEtape).map((point) => point.position)) + 1

/** Le déplacement d'un point parmi les points NON archivés de son étape : un point archivé ne se déplace pas (§5.18). */
export function deplacementPoint(points: readonly PointEtape[], point: PointEtape, sens: Sens): Deplacement {
	const actifs = pointsDeLEtape(points, point.step_id).filter((p) => p.archived_at === null)
	return calculerDeplacement(actifs, point.id, sens)
}

/** Lit les points des étapes d'un workflow et les exigences de ses transitions, ensemble : ils décrivent le même instant. */
export async function lireChecklistsWorkflow(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<ChecklistsWorkflow>> {
	try {
		const [points, exigences] = await Promise.all([
			client.from('workflow_step_checklist_items').select(COLONNES_POINT_ETAPE).eq('workflow_id', idWorkflow),
			client
				.from('workflow_transition_required_checklist_items')
				.select(COLONNES_EXIGENCE_POINT)
				.eq('transition.workflow_id', idWorkflow),
		])
		if (points.error !== null) return enErreur(classerErreur(points.status, points.error.message))
		if (exigences.error !== null) return enErreur(classerErreur(exigences.status, exigences.error.message))
		return pret({
			points: (points.data ?? []) as readonly PointEtape[],
			exigences: ((exigences.data ?? []) as readonly { transition_id: string; step_item_id: string }[]).map((e) => ({
				idTransition: e.transition_id,
				idPoint: e.step_item_id,
			})),
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusChecklistsWorkflow =
	/** `23514` sur `workflow_step_checklist_items_label_check` : libellé blanc ou de plus de 200 caractères. */
	| 'libelle'
	/** `22023` `checklist_item_not_from_source_step` : le point n'est pas de l'étape de départ (§3.4). */
	| 'hors-etape'
	/** `23505` : la transition exige déjà ce point. */
	| 'deja-exige'
	/** `401`, `403`, `42501` : seul l'administrateur de l'espace écrit (§3.1). */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré la ligne, ou elle a disparu ; rien n'a changé. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

/** Classe un refus par le code, puis par le nom de la contrainte ou le symbole levé. Jamais la prose du serveur. */
export function classerRefusChecklistsWorkflow(
	statutHttp: number | undefined,
	code: string | undefined,
	message: string,
): NatureRefusChecklistsWorkflow {
	if (code === '23514') return message.includes('workflow_step_checklist_items_label_check') ? 'libelle' : 'unknown'
	if (code === '22023') return message === 'checklist_item_not_from_source_step' ? 'hors-etape' : 'unknown'
	if (code === '23505') return 'deja-exige'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueChecklistsWorkflow =
	| { readonly statut: 'applique' }
	| { readonly statut: 'refus'; readonly nature: NatureRefusChecklistsWorkflow }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseBrute>): Promise<IssueChecklistsWorkflow> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				nature: classerRefusChecklistsWorkflow(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		// Un `200` sans ligne est le refus silencieux d'une politique (décision 70) : l'écran le dit au lieu d'un succès.
		return Array.isArray(reponse.data) && reponse.data.length === 0
			? { statut: 'refus', nature: 'sans-effet' }
			: { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			nature: classerRefusChecklistsWorkflow(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

/** Ajoute un point à une étape. L'auteur et les dates sont posés par la base. */
export function ajouterPointEtape(
	client: ClientCrm,
	cible: { readonly idWorkspace: string; readonly idWorkflow: string; readonly idEtape: string },
	libelle: string,
	position: number,
): Promise<IssueChecklistsWorkflow> {
	const ligne: Database['public']['Tables']['workflow_step_checklist_items']['Insert'] = {
		workspace_id: cible.idWorkspace,
		workflow_id: cible.idWorkflow,
		step_id: cible.idEtape,
		label: libelle.trim(),
		position,
	}
	return executer(() => client.from('workflow_step_checklist_items').insert(ligne).select('id'))
}

/** Renomme un point d'étape. Les points déjà copiés sur les affaires gardent leur libellé (§3.2). */
export function renommerPointEtape(client: ClientCrm, idPoint: string, libelle: string): Promise<IssueChecklistsWorkflow> {
	return executer(() =>
		client.from('workflow_step_checklist_items').update({ label: libelle.trim() }).eq('id', idPoint).select('id'),
	)
}

/** Place un point à une position calculée par `deplacementPoint`. */
export function placerPointEtape(client: ClientCrm, idPoint: string, position: number): Promise<IssueChecklistsWorkflow> {
	return executer(() =>
		client.from('workflow_step_checklist_items').update({ position }).eq('id', idPoint).select('id'),
	)
}

/** Archive ou désarchive un point : archivé, il n'est plus ajouté aux affaires qui entrent dans l'étape (§3.1). */
export function archiverPointEtape(
	client: ClientCrm,
	idPoint: string,
	archive: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<IssueChecklistsWorkflow> {
	return executer(() =>
		client
			.from('workflow_step_checklist_items')
			.update({ archived_at: archive ? maintenant() : null })
			.eq('id', idPoint)
			.select('id'),
	)
}

/** Une transition exige désormais ce point. La base refuse un point d'une autre étape que celle de départ (§3.4). */
export function exigerPoint(client: ClientCrm, idTransition: string, idPoint: string): Promise<IssueChecklistsWorkflow> {
	return executer(() =>
		client
			.from('workflow_transition_required_checklist_items')
			.insert({ transition_id: idTransition, step_item_id: idPoint })
			.select('transition_id'),
	)
}

/** La transition n'exige plus ce point. */
export function nePlusExigerPoint(client: ClientCrm, idTransition: string, idPoint: string): Promise<IssueChecklistsWorkflow> {
	return executer(() =>
		client
			.from('workflow_transition_required_checklist_items')
			.delete()
			.eq('transition_id', idTransition)
			.eq('step_item_id', idPoint)
			.select('transition_id'),
	)
}
