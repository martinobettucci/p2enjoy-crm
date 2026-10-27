// @spec CRM-118 (docs/BACKLOG.md) — tranche T1.b : changer le workflow d'un channel qui porte des affaires, depuis
//       l'arborescence (docs/SPEC-workflow-engine.md §7 quinquies.3 ; docs/JOURNAL.md décisions 758 et 760)
// @spec docs/SPEC-change-channel-workflow.md §1 (la signature), §2 (le mapping exhaustif, aucune source devinée), §3 (les
//       refus, dans l'ordre ; les affaires archivées et en corbeille comptent), §5 (la perte explicite des réponses)
// @spec docs/SPEC-rattachements.md §5 (l'occupation se lit sur les rattachements du channel)
//
// CE MODULE NE DÉCIDE RIEN : il lit ce que l'écran propose, compose le mapping tel que la fonction l'attend, appelle
// `change_channel_workflow` et traduit son refus. Aucune destination n'est devinée — une étape sans choix n'entre pas
// dans le mapping, et la fonction refuse alors `step_mapping_incomplete` (§2).

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Une étape occupée du workflow courant : son nom, et le nombre de rattachements du channel qui s'y trouvent. */
export type EtapeOccupee = {
	readonly id: string
	readonly nom: string
	readonly affaires: number
}

/** Un workflow vers lequel le channel peut passer (§4.12 : global, ou propre au track du channel). */
export type WorkflowCible = {
	readonly id: string
	readonly name: string
	readonly is_default: boolean
}

/** Une étape du workflow cible, proposée comme destination. */
export type EtapeCible = {
	readonly id: string
	readonly nom: string
}

type LigneRattachement = {
	readonly current_step_id: string
	readonly etape: {
		readonly label_override: string | null
		readonly noeud: { readonly label: string | null } | null
	} | null
}

const SELECTION_RATTACHEMENTS =
	'current_step_id, etape:workflow_steps!card_placements_step_fk(label_override, ' +
	'noeud:workflow_nodes_catalog!workflow_steps_node_id_workspace_id_fkey(label))'

/**
 * Les étapes occupées du channel, dans l'ordre de leur première apparition — TOUS les rattachements du channel, affaires
 * archivées et en corbeille comprises : la fonction les compte (`docs/SPEC-change-channel-workflow.md` §3), et l'écran
 * doit proposer exactement les sources qu'elle exige.
 */
export async function lireEtapesOccupees(
	client: ClientCrm,
	idChannel: string,
): Promise<EtatAsync<readonly EtapeOccupee[]>> {
	try {
		const reponse = await client.from('card_placements').select(SELECTION_RATTACHEMENTS).eq('channel_id', idChannel)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const comptes = new Map<string, EtapeOccupee>()
		for (const ligne of (reponse.data ?? []) as unknown as readonly LigneRattachement[]) {
			const avant = comptes.get(ligne.current_step_id)
			const nom = ligne.etape?.label_override ?? ligne.etape?.noeud?.label ?? ligne.current_step_id
			comptes.set(ligne.current_step_id, { id: ligne.current_step_id, nom, affaires: (avant?.affaires ?? 0) + 1 })
		}
		return pret([...comptes.values()])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les workflows affectables au channel, hors archivés et hors son workflow courant, le défaut en tête. */
export async function lireWorkflowsCibles(
	client: ClientCrm,
	idWorkspace: string,
	idTrack: string,
	idCourant: string,
): Promise<EtatAsync<readonly WorkflowCible[]>> {
	try {
		const reponse = await client
			.from('workflows')
			.select('id, name, is_default')
			.eq('workspace_id', idWorkspace)
			.is('archived_at', null)
			.neq('id', idCourant)
			.or(`scope.eq.global,and(scope.eq.track,track_id.eq.${idTrack})`)
			.order('is_default', { ascending: false })
			.order('name')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret((reponse.data ?? []) as readonly WorkflowCible[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Le nom du workflow courant du channel, que le titre du panneau nomme ; `null` s'il n'est pas lisible. */
export async function lireNomWorkflow(client: ClientCrm, idWorkflow: string): Promise<EtatAsync<string | null>> {
	try {
		const reponse = await client.from('workflows').select('name').eq('id', idWorkflow).maybeSingle()
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret((reponse.data as { readonly name: string } | null)?.name ?? null)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

type LigneEtape = {
	readonly id: string
	readonly label_override: string | null
	readonly noeud: { readonly label: string | null } | null
}

/** Les étapes du workflow cible, dans l'ordre du board. */
export async function lireEtapesCibles(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly EtapeCible[]>> {
	try {
		const reponse = await client
			.from('workflow_steps')
			.select('id, label_override, noeud:workflow_nodes_catalog!workflow_steps_node_id_workspace_id_fkey(label)')
			.eq('workflow_id', idWorkflow)
			.order('position')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			((reponse.data ?? []) as unknown as readonly LigneEtape[]).map((e) => ({
				id: e.id,
				nom: e.label_override ?? e.noeud?.label ?? e.id,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Une instruction du mapping, telle que la fonction l'attend (`docs/SPEC-change-channel-workflow.md` §2). */
export type Correspondance = { readonly from_step_id: string; readonly to_step_id: string }

/**
 * Le mapping depuis les choix de l'écran : une étape sans choix n'en produit AUCUNE — rien n'est deviné —, et l'ordre est
 * celui des étapes de départ, pour que deux compositions des mêmes choix soient égales.
 */
export function composerMapping(choix: ReadonlyMap<string, string>): readonly Correspondance[] {
	return [...choix.entries()]
		.filter(([, cible]) => cible !== '')
		.map(([depart, cible]) => ({ from_step_id: depart, to_step_id: cible }))
		.sort((a, b) => a.from_step_id.localeCompare(b.from_step_id))
}

/** Le mapping est-il prêt à partir ? Chaque étape occupée a une destination (§2, règle 1). */
export function mappingComplet(occupees: readonly EtapeOccupee[], choix: ReadonlyMap<string, string>): boolean {
	return occupees.every((etape) => (choix.get(etape.id) ?? '') !== '')
}

/** Les refus que l'écran sait dire, par un dictionnaire fermé ; le message brut n'atteint jamais l'écran. */
export type RefusChangement =
	| { readonly nature: 'perte'; readonly reponses: number }
	| {
			readonly nature:
				| 'meme-workflow'
				| 'mapping-incomplet'
				| 'mapping-invalide'
				| 'etape-hors-workflow'
				| 'workflow-introuvable'
				| 'workflow-incompatible'
				| 'channel-introuvable'
				| 'interdit'
				| 'reseau'
				| 'inconnu'
	  }

const MESSAGES: Readonly<Record<string, RefusChangement['nature']>> = {
	same_workflow: 'meme-workflow',
	step_mapping_incomplete: 'mapping-incomplet',
	step_mapping_duplicate: 'mapping-invalide',
	invalid_step_mapping: 'mapping-invalide',
	step_not_in_workflow: 'etape-hors-workflow',
	workflow_not_found: 'workflow-introuvable',
	workflow_not_compatible: 'workflow-incompatible',
	channel_not_found: 'channel-introuvable',
	forbidden: 'interdit',
}

/** Classe un refus de `change_channel_workflow` (`docs/SPEC-change-channel-workflow.md` §3, §5). */
export function classerRefusChangement(
	statut: number | undefined,
	code: string | undefined,
	message: string | undefined,
	detail: string | undefined,
): RefusChangement {
	if (message === 'field_values_would_be_lost') {
		const nombre = /\d+/.exec(detail ?? '')
		return { nature: 'perte', reponses: nombre === null ? 0 : Number(nombre[0]) }
	}
	const connu = message === undefined ? undefined : MESSAGES[message]
	if (connu !== undefined) return { nature: connu } as RefusChangement
	if (code === '42501' || statut === 401 || statut === 403) return { nature: 'interdit' }
	if (statut === undefined) return { nature: 'reseau' }
	return { nature: 'inconnu' }
}

export type ResultatChangement =
	| { readonly statut: 'applique'; readonly remappes: number }
	| { readonly statut: 'refus'; readonly refus: RefusChangement }

/** Change le workflow du channel, avec le mapping explicite et, seulement si la personne l'a accepté, la perte. */
export async function changerWorkflowChannel(
	client: ClientCrm,
	idChannel: string,
	idWorkflow: string,
	mapping: readonly Correspondance[],
	accepterPerte: boolean,
): Promise<ResultatChangement> {
	try {
		const reponse = await client.rpc('change_channel_workflow', {
			channel_id: idChannel,
			workflow_id: idWorkflow,
			step_mapping: mapping as unknown as never,
			discard_field_values: accepterPerte,
		})
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusChangement(
					reponse.status,
					reponse.error.code,
					reponse.error.message,
					reponse.error.details ?? undefined,
				),
			}
		}
		return { statut: 'applique', remappes: Array.isArray(reponse.data) ? reponse.data.length : 0 }
	} catch {
		return { statut: 'refus', refus: { nature: 'reseau' } }
	}
}
