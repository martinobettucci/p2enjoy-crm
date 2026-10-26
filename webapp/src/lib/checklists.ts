// @spec CRM-068 (docs/BACKLOG.md) — tranche T3a : lire, cocher, ajouter et retirer les points de la checklist d'une affaire
// @spec docs/SPEC-checklists.md §2 (un point d'étape appartient au rattachement, un point libre à l'affaire), §3.2 (qui
//       écrit quoi : cocher tout point, ajouter et retirer un point libre ; l'heure et l'auteur posés par la base), §3.4
//       (les points exigés par une transition sortante), §4 (la fiche) ; docs/DESIGN_SYSTEM.md §5.70
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit dans la table, et les politiques décident
//
// Ce module ne rend rien : il **lit et écrit**. Le groupement par étape, l'ordre, les mentions d'exigence et la
// classification des refus y sont vérifiables sans navigateur.
//
// UNE SEULE LECTURE. Les points de l'affaire plongent leur point d'étape d'origine, l'étape qui le porte (nom par son
// nœud) et les transitions qui l'exigent, avec le nom de leur étape d'arrivée : tout ce que le bloc affiche vient de
// cette requête. Une exigence ne porte que sur un point de l'étape de DÉPART (§3.4, garanti par la base) : les
// transitions qui exigent un point sont donc toutes sortantes de son étape.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/** La borne de la base pour un libellé (`card_checklist_items_label_check`), reprise pour l'attribut du champ. */
export const LONGUEUR_MAX_POINT = 200

/**
 * Colonnes réellement demandées. Exportée pour que les tests éprouvent **la requête émise**.
 *
 * Les relations vers `profiles` sont nommées par leur contrainte : `card_checklist_items` en porte deux (`checked_by`,
 * `created_by`), et un plongement sans nom serait ambigu (`PGRST201`). L'étape d'arrivée d'une transition l'est aussi :
 * `workflow_transitions` désigne deux fois `workflow_steps`. Le littéral reste ENTIER (`formulaire.ts`, inférence).
 */
export const COLONNES_POINT_CHECKLIST =
	'id, placement_id, step_item_id, label, position, checked, checked_at, created_at, cocheur:profiles!card_checklist_items_checked_by_fkey(full_name), origine:workflow_step_checklist_items(step_id, etape:workflow_steps(position, label_override, workflow_nodes_catalog(label)), exigences:workflow_transition_required_checklist_items(transition:workflow_transitions(vers:workflow_steps!workflow_transitions_to_step_fkey(id, position, label_override, workflow_nodes_catalog(label)))))'

type EtapeNommee = {
	readonly position: number
	readonly label_override: string | null
	readonly workflow_nodes_catalog: { readonly label: string } | null
}

export type PointLu = {
	readonly id: string
	readonly placement_id: string | null
	readonly step_item_id: string | null
	readonly label: string
	readonly position: number
	readonly checked: boolean
	readonly checked_at: string | null
	readonly created_at: string
	readonly cocheur: { readonly full_name: string | null } | null
	readonly origine: {
		readonly step_id: string
		readonly etape: EtapeNommee | null
		readonly exigences:
			| readonly {
					readonly transition: { readonly vers: (EtapeNommee & { readonly id: string }) | null } | null
			  }[]
			| null
	} | null
}

export type PointAffiche = {
	readonly id: string
	readonly libelle: string
	readonly position: number
	readonly coche: boolean
	readonly cocheLe: string | null
	/** Le nom de qui a coché ; `null` quand la base ne le rend pas (compte supprimé, profil illisible). */
	readonly cochePar: string | null
	/** Vrai pour un point libre : lui seul se retire (§3.2). */
	readonly libre: boolean
	/** Les étapes vers lesquelles une transition exige ce point, dans l'ordre du workflow, sans doublon. */
	readonly exigePour: readonly string[]
}

/** Les points d'une étape d'origine, sous son nom ; `libelle` nul pour une étape supprimée depuis. */
export type GroupeEtape = {
	readonly idEtape: string | null
	readonly libelle: string | null
	readonly points: readonly PointAffiche[]
}

export type ChecklistAffichee = {
	/** Les points de l'étape où se trouve le rattachement, `null` si elle n'en porte aucun. */
	readonly etapeCourante: GroupeEtape | null
	/** Les points des étapes déjà traversées, et ceux dont l'étape a été supprimée, en dernier. */
	readonly etapesPassees: readonly GroupeEtape[]
	readonly libres: readonly PointAffiche[]
	readonly coches: number
	readonly total: number
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Le nom d'une étape : son libellé propre, sinon celui de son nœud (`board.ts`, même règle). */
export const nomEtape = (etape: EtapeNommee | null): string | null =>
	etape === null ? null : (etape.label_override ?? etape.workflow_nodes_catalog?.label ?? null)

/** Ordre stable d'une liste de points : la position, puis la création, puis l'identifiant. */
const ordonner = (points: readonly PointLu[]): readonly PointLu[] =>
	[...points].sort((a, b) =>
		a.position !== b.position
			? a.position - b.position
			: a.created_at !== b.created_at
				? compare(a.created_at, b.created_at)
				: compare(a.id, b.id),
	)

const afficher = (point: PointLu, courante: boolean): PointAffiche => {
	// Les mentions d'exigence ne valent que dans l'étape courante : celles d'une étape quittée parlent de transitions
	// qu'on ne franchira plus d'ici (docs/DESIGN_SYSTEM.md §5.70).
	const vers = courante
		? (point.origine?.exigences ?? [])
				.flatMap((e) => (e.transition?.vers == null ? [] : [e.transition.vers]))
				.sort((a, b) => a.position - b.position || compare(a.id, b.id))
		: []
	const exigePour: string[] = []
	for (const etape of vers) {
		const nom = nomEtape(etape)
		if (nom !== null && !exigePour.includes(nom)) exigePour.push(nom)
	}
	return {
		id: point.id,
		libelle: point.label,
		position: point.position,
		coche: point.checked,
		cocheLe: point.checked ? point.checked_at : null,
		cochePar: point.checked ? (point.cocheur?.full_name ?? null) : null,
		libre: point.placement_id === null,
		exigePour,
	}
}

/**
 * Projette les points lus pour UN rattachement : ses points d'étape, groupés par étape d'origine — l'étape courante
 * d'abord, puis les autres dans l'ordre du workflow, puis ceux dont l'étape a été supprimée —, et les points libres.
 *
 * Les points d'un AUTRE rattachement sont écartés : pendant la bascule de `CRM-111`, une affaire n'en a qu'un, et le
 * bloc lit celui de la fiche (`rattachements.ts`). Le compte porte sur tous les points affichés.
 */
export function projeterChecklist(
	lignes: readonly PointLu[],
	idRattachement: string | null,
	idEtapeCourante: string | null,
): ChecklistAffichee {
	const ordonnes = ordonner(lignes)
	const libres = ordonnes.filter((p) => p.placement_id === null).map((p) => afficher(p, false))
	const groupes = new Map<string | null, { position: number; libelle: string | null; points: PointAffiche[] }>()
	for (const point of ordonnes) {
		if (point.placement_id === null || point.placement_id !== idRattachement) continue
		const idEtape = point.origine?.step_id ?? null
		const groupe = groupes.get(idEtape) ?? {
			position: point.origine?.etape?.position ?? Number.POSITIVE_INFINITY,
			libelle: nomEtape(point.origine?.etape ?? null),
			points: [],
		}
		groupe.points.push(afficher(point, idEtape !== null && idEtape === idEtapeCourante))
		groupes.set(idEtape, groupe)
	}
	const versGroupe = (idEtape: string | null): GroupeEtape | null => {
		const groupe = groupes.get(idEtape)
		return groupe === undefined ? null : { idEtape, libelle: groupe.libelle, points: groupe.points }
	}
	const etapeCourante = idEtapeCourante === null ? null : versGroupe(idEtapeCourante)
	const etapesPassees = [...groupes.entries()]
		.filter(([idEtape]) => idEtape === null || idEtape !== idEtapeCourante)
		.sort(([, a], [, b]) => a.position - b.position)
		.flatMap(([idEtape]) => {
			const groupe = versGroupe(idEtape)
			return groupe === null ? [] : [groupe]
		})
	const tous = [...(etapeCourante?.points ?? []), ...etapesPassees.flatMap((g) => g.points), ...libres]
	return {
		etapeCourante,
		etapesPassees,
		libres,
		coches: tous.filter((p) => p.coche).length,
		total: tous.length,
	}
}

/** Lit les points d'une affaire — libres et de ses rattachements lisibles — et les projette pour un rattachement. */
export async function lireChecklist(
	client: ClientCrm,
	idCard: string,
	idRattachement: string | null,
	idEtapeCourante: string | null,
): Promise<EtatAsync<ChecklistAffichee>> {
	try {
		const reponse = await client.from('card_checklist_items').select(COLONNES_POINT_CHECKLIST).eq('card_id', idCard)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(projeterChecklist((reponse.data ?? []) as unknown as readonly PointLu[], idRattachement, idEtapeCourante))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusChecklist =
	/** `23514` sur `card_checklist_items_label_check` : libellé blanc ou de plus de 200 caractères. */
	| 'libelle'
	/** `401`, `403`, `42501` : l'affaire n'est pas ouverte en écriture à l'appelant. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré la ligne, ou elle a disparu ; rien n'a changé. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

/** Classe un refus par ce que la base rend : le code, puis le nom de la contrainte. Jamais la prose du serveur. */
export function classerRefusChecklist(
	statutHttp: number | undefined,
	code: string | undefined,
	message: string,
): NatureRefusChecklist {
	if (code === '23514') return message.includes('card_checklist_items_label_check') ? 'libelle' : 'unknown'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueChecklist = { readonly statut: 'applique' } | { readonly statut: 'refus'; readonly nature: NatureRefusChecklist }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

const issueDe = (reponse: ReponseBrute): IssueChecklist => {
	if (reponse.error !== null) {
		return { statut: 'refus', nature: classerRefusChecklist(reponse.status, reponse.error.code, reponse.error.message) }
	}
	// Un `200` sans ligne est le refus silencieux d'une politique (décision 70) : l'écran le dit au lieu d'un succès.
	return Array.isArray(reponse.data) && reponse.data.length === 0 ? { statut: 'refus', nature: 'sans-effet' } : { statut: 'applique' }
}

const issueDeCause = (cause: unknown): IssueChecklist => ({
	statut: 'refus',
	nature: classerRefusChecklist(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
})

/**
 * Coche ou décoche un point, libre ou d'étape. `checked_at` et `checked_by` ne sont PAS envoyés : fermés au client par
 * privilège de colonne, la base les pose (§3.2).
 */
export async function cocherPoint(client: ClientCrm, idPoint: string, coche: boolean): Promise<IssueChecklist> {
	try {
		return issueDe(await client.from('card_checklist_items').update({ checked: coche }).eq('id', idPoint).select('id'))
	} catch (cause) {
		return issueDeCause(cause)
	}
}

/**
 * Ajoute un point libre, en dernière position. Ni rattachement ni point d'origine : la politique d'insertion n'ouvre
 * que les points libres (§3.2). L'espace est envoyé — la clé composite vers l'affaire l'exige.
 */
export async function ajouterPointLibre(
	client: ClientCrm,
	idCard: string,
	idWorkspace: string,
	libelle: string,
	position: number,
): Promise<IssueChecklist> {
	try {
		const ligne: Database['public']['Tables']['card_checklist_items']['Insert'] = {
			card_id: idCard,
			workspace_id: idWorkspace,
			label: libelle.trim(),
			position,
		}
		return issueDe(await client.from('card_checklist_items').insert(ligne).select('id'))
	} catch (cause) {
		return issueDeCause(cause)
	}
}

/** Retire un point libre ; un point d'étape n'est jamais visé — la politique de suppression le filtrerait (§3.2). */
export async function retirerPointLibre(client: ClientCrm, idPoint: string): Promise<IssueChecklist> {
	try {
		return issueDe(await client.from('card_checklist_items').delete().eq('id', idPoint).select('id'))
	} catch (cause) {
		return issueDeCause(cause)
	}
}

/** La position d'un nouveau point libre : après le dernier point libre, 1 s'il n'y en a aucun. */
export const positionSuivante = (checklist: ChecklistAffichee): number =>
	Math.max(0, ...checklist.libres.map((p) => p.position)) + 1
