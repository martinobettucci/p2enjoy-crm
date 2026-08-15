// @spec CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première, deuxième,
//       troisième, quatrième et cinquième tranches
// @spec docs/SPEC-workflow-engine.md §7 bis.3 (ce que l'écran lit), §7 bis.4 (les six gestes),
//       §7 bis.5 (validation de forme), §7 bis.7 (ce que cette tranche ne livre pas),
//       §7 bis.9 (deuxième tranche : l'édition des transitions), §3.4 (modèle des arêtes),
//       §7 bis.10 (troisième tranche : l'édition des champs de formulaire),
//       §7 bis.11 (quatrième tranche : la grille champ × étape des règles de visibilité),
//       §7 bis.12 (cinquième tranche : les exigences propres à une transition)
// @spec docs/SPEC-transition-required-fields.md §1 (l'union des deux ensembles),
//       §2 (la table à deux colonnes), §4 (autorisations), §5.1 (la sixième garde de `move_card`)
// @spec docs/SPEC-form-composer.md §2.2 (modèle `form_fields`), §2.3 (les quinze types),
//       §2.4 (`options` et ce que la base n'y vérifie pas), §2.5 (la clé durable),
//       §2.6 (ordre des champs), §2.7 (autorisations, aucun privilège `DELETE`),
//       §3.1 (les trois visibilités et le défaut), §3.2 (modèle `form_field_rules`),
//       §5 (l'édition du formulaire en un seul écran)
// @spec docs/SPEC-workflow-engine.md §2.5 (probabilité et seuil : `0` n'est pas `NULL`),
//       §3.3 (modèle `workflow_steps` et ses contraintes), §3.5 (l'étape initiale),
//       §3.7 (écriture réservée à l'administrateur)
// @spec docs/SPEC-permissions-rls.md §4 (écriture réservée à l'administrateur)
// @spec docs/DESIGN_SYSTEM.md §5.8 (états systématiques)
//
// CE MODULE N'INVENTE AUCUNE RÈGLE, exactement comme celui de `CRM-075` dont il reprend le patron.
// Chaque refus traduit ici est déjà posé et mesuré par `CRM-030` ou `CRM-031` : l'écran envoie, la
// base tranche, et le module traduit le refus reçu (`CLAUDE.md` §10). La seule exception est la
// validation de FORME du §7 bis.5, qui n'économise qu'un aller-retour dont la réponse est connue
// d'avance et dont l'erreur reste rattrapée par la base.
//
// L'ORDONNANCEMENT N'EST PAS RÉÉCRIT. `calculerDeplacement`, `positionEntre` et `deplacementPossible`
// viennent de `CRM-075` : l'ordre d'une étape dans un workflow et celui d'un channel dans un track
// sont le même problème — une `position` `numeric` où l'on insère au milieu de deux voisines plutôt
// que de permuter deux lignes en deux écritures non atomiques.

import { classerRefusEcriture, type RefusEcriture } from './administration-arborescence'
import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'écran lit — docs/SPEC-workflow-engine.md §7 bis.3
// ---------------------------------------------------------------------------------------------

/** Un workflow tel que la liste de gauche le présente. */
export type WorkflowAdministrable = Pick<
	Database['public']['Tables']['workflows']['Row'],
	'id' | 'workspace_id' | 'name' | 'scope' | 'track_id' | 'is_default' | 'archived_at'
>

/** Le nœud du catalogue, tel qu'il est embarqué dans la lecture d'une étape. */
export type NoeudEmbarque = Pick<
	Database['public']['Tables']['workflow_nodes_catalog']['Row'],
	'id' | 'key' | 'label' | 'kind' | 'color' | 'default_probability' | 'default_stale_after_days'
>

/**
 * Une étape, avec son nœud.
 *
 * Le nœud est **embarqué** plutôt que relu : le libellé affiché est `label_override` s'il existe,
 * sinon celui du catalogue (§3.3, « une surcharge absente vaut prendre la valeur du catalogue »).
 * Deux lectures rendraient la même information en deux allers-retours, et rien ne garantirait
 * qu'elles décrivent le même instant.
 */
export type EtapeAdministrable = Pick<
	Database['public']['Tables']['workflow_steps']['Row'],
	| 'id'
	| 'workflow_id'
	| 'workspace_id'
	| 'node_id'
	| 'position'
	| 'label_override'
	| 'probability_override'
	| 'stale_after_days'
	| 'is_initial'
> & { readonly node: NoeudEmbarque | null }

/** Un nœud du catalogue, tel que le sélecteur d'ajout le présente. */
export type NoeudAjoutable = Pick<
	Database['public']['Tables']['workflow_nodes_catalog']['Row'],
	'id' | 'key' | 'label' | 'kind' | 'color' | 'position' | 'default_probability' | 'default_stale_after_days'
>

/** Colonnes réellement demandées. Exportées pour que les tests vérifient la requête émise. */
export const COLONNES_WORKFLOW_ADMIN = 'id, workspace_id, name, scope, track_id, is_default, archived_at'
export const COLONNES_NOEUD_EMBARQUE =
	'id, key, label, kind, color, default_probability, default_stale_after_days'
export const COLONNES_ETAPE_ADMIN =
	`id, workflow_id, workspace_id, node_id, position, label_override, probability_override, stale_after_days, is_initial, node:workflow_nodes_catalog!workflow_steps_node_id_workspace_id_fkey(${COLONNES_NOEUD_EMBARQUE})`
export const COLONNES_NOEUD_AJOUTABLE =
	'id, key, label, kind, color, position, default_probability, default_stale_after_days'

/**
 * Les workflows du workspace — lecture 1 du §7 bis.3.
 *
 * Aucun filtre de workspace n'est écrit : la RLS le borne déjà, et l'ajouter ferait croire que
 * l'interface protège quelque chose (`CLAUDE.md` §10). L'ordre place le workflow par défaut en
 * tête, ce qui est l'ordre dans lequel un administrateur pense à ses workflows.
 */
export async function lireWorkflowsAdministrables(
	client: ClientCrm,
	inclureArchives: boolean,
): Promise<EtatAsync<readonly WorkflowAdministrable[]>> {
	try {
		const base = client.from('workflows').select(COLONNES_WORKFLOW_ADMIN)
		const filtre = inclureArchives ? base : base.is('archived_at', null)
		const reponse = await filtre.order('is_default', { ascending: false }).order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as readonly WorkflowAdministrable[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les étapes d'un workflow, dans l'ordre du graphe — lecture 2 du §7 bis.3. */
export async function lireEtapes(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly EtapeAdministrable[]>> {
	try {
		const reponse = await client
			.from('workflow_steps')
			.select(COLONNES_ETAPE_ADMIN)
			.eq('workflow_id', idWorkflow)
			.order('position')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as unknown as readonly EtapeAdministrable[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Le catalogue actif — lecture 3 du §7 bis.3.
 *
 * Émise à l'ouverture du sélecteur d'ajout, jamais au chargement de l'écran : un catalogue que
 * personne ne consulte n'a pas à voyager. Les nœuds archivés sont exclus **côté serveur** — le §2.6
 * les retire du choix, et les rapporter pour les masquer ferait transiter ce que l'écran ne montre
 * pas.
 */
export async function lireCatalogueActif(
	client: ClientCrm,
): Promise<EtatAsync<readonly NoeudAjoutable[]>> {
	try {
		const reponse = await client
			.from('workflow_nodes_catalog')
			.select(COLONNES_NOEUD_AJOUTABLE)
			.is('archived_at', null)
			.order('position')
			.order('label')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as readonly NoeudAjoutable[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Composition — ce que l'écran calcule, et qui n'appartient à aucune requête
// ---------------------------------------------------------------------------------------------

/**
 * Le libellé d'une étape : la surcharge si elle existe, sinon celui du catalogue.
 *
 * `label_override` est `text` non vide après `btrim` **lorsqu'il est fourni** (§3.3) ; une chaîne
 * blanche ne peut donc pas venir de la base. Elle est tout de même traitée, parce qu'un état local
 * d'édition peut la produire avant d'être envoyée, et parce qu'un repli silencieux vaut mieux
 * qu'une étape sans nom à l'écran.
 *
 * Le nœud absent — `null` — n'est pas un cas théorique : c'est ce que rend l'embarquement si la
 * RLS du catalogue refusait la ligne. Le repli nomme alors la clé plutôt que d'afficher un vide.
 */
export function libelleEtape(etape: EtapeAdministrable): string {
	const surcharge = etape.label_override?.trim() ?? ''
	if (surcharge !== '') return surcharge
	const duCatalogue = etape.node?.label.trim() ?? ''
	if (duCatalogue !== '') return duCatalogue
	return etape.node?.key ?? etape.node_id
}

/**
 * Les nœuds encore ajoutables : le catalogue actif, moins ceux qu'une étape emploie déjà.
 *
 * L'unicité `(workflow_id, node_id)` du §3.3 refuserait l'insertion de toute façon ; ce filtre ne
 * la remplace pas, il évite d'offrir un choix dont on sait qu'il sera refusé. La différence est
 * celle que `CLAUDE.md` §10 pose entre une aide d'interface et une garde.
 */
export function noeudsAjoutables(
	catalogue: readonly NoeudAjoutable[],
	etapes: readonly EtapeAdministrable[],
): readonly NoeudAjoutable[] {
	const employes = new Set(etapes.map((etape) => etape.node_id))
	return catalogue.filter((noeud) => !employes.has(noeud.id))
}

// ---------------------------------------------------------------------------------------------
// Validation de forme — docs/SPEC-workflow-engine.md §7 bis.5
// ---------------------------------------------------------------------------------------------

/** Une surcharge de libellé fournie n'est pas vide après `btrim` (§3.3). */
export const libelleSurchargeConforme = (libelle: string): boolean => libelle.trim() !== ''

/**
 * `probability_override` est un `numeric(5,2)` de 0 à 100 (§3.3).
 *
 * `0` EST UNE VALEUR VALIDE, et c'est le cœur du §2.5 : une surcharge absente vaut « prendre la
 * valeur du catalogue », elle ne vaut pas zéro. Un test qui écrirait `if (!probabilite)` confondrait
 * les deux et ferait disparaître une probabilité nulle légitimement saisie.
 */
export const probabiliteConforme = (probabilite: number): boolean =>
	Number.isFinite(probabilite) && probabilite >= 0 && probabilite <= 100

/** `stale_after_days` est un entier strictement positif (§3.3). Zéro n'y est PAS valide. */
export const ancienneteConforme = (jours: number): boolean =>
	Number.isInteger(jours) && jours > 0

// ---------------------------------------------------------------------------------------------
// Les refus — docs/SPEC-workflow-engine.md §7 bis.4
// ---------------------------------------------------------------------------------------------

export type NatureRefusEtape =
	/** `403`/`401` — `42501`. Seul un administrateur du workspace écrit (§3.7). */
	| 'forbidden'
	/** `23505` — l'unicité `(workflow_id, node_id)` : ce nœud est déjà une étape de ce workflow. */
	| 'noeud-deja-employe'
	/** `23503` sur un retrait — `on delete restrict` : des cards occupent cette étape (§3.3). */
	| 'etape-occupee'
	/** `23503` hors retrait — le workflow ou le nœud a disparu, ou n'est pas dans ce workspace. */
	| 'reference-absente'
	/** `23514` — un `CHECK` de forme : libellé blanc, probabilité hors bornes, ancienneté nulle. */
	| 'forme-refusee'
	| 'network'
	| 'unknown'

export type RefusEtape = {
	readonly nature: NatureRefusEtape
	readonly detail: string
}

/** Les six gestes du §7 bis.4, dont un seul change la lecture d'un `23503`. */
export type GesteEtape = 'ajout' | 'deplacement' | 'surcharge' | 'initiale' | 'retrait'

/**
 * Classe un refus sur le **code PostgreSQL** d'abord, le **code HTTP** ensuite, jamais sur le texte
 * du message — la règle de `classerErreur`, reprise sans exception.
 *
 * LA CLASSIFICATION DE `CRM-075` EST RÉUTILISÉE, PUIS RENOMMÉE, plutôt que réécrite : les codes et
 * leur ordre de lecture sont les mêmes, seul le vocabulaire du refus change. Un `23505` est ici
 * l'unicité `(workflow_id, node_id)` et non celle d'un slug ; l'appeler `slug-pris` à l'écran
 * mentirait sur ce que l'administrateur vient de faire.
 *
 * LE MÊME `23503` DIT DEUX CHOSES OPPOSÉES SELON LE GESTE, et c'est la seule subtilité de cette
 * fonction. Sur un **retrait**, il vient du `on delete restrict` que les cards posent sur leur
 * étape : le refus est « cette étape est occupée », un fait métier que l'écran doit nommer
 * précisément. Sur les autres gestes, il vient d'une clé étrangère dont la cible a disparu. Rien
 * dans le code SQL ne les sépare — seul l'appelant sait lequel il a tenté.
 *
 * `workflow-hors-track` ne peut PAS être levé ici : cette contrainte nommée porte sur `channels`
 * (§4.12.3), pas sur `workflow_steps`. Elle est repliée sur `forme-refusee`, avec laquelle elle
 * partage déjà le SQLSTATE `23514`, plutôt que d'ouvrir dans ce module une nature que rien ne peut
 * produire.
 */
export function classerRefusEtape(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
	geste: GesteEtape,
): RefusEtape {
	const base: RefusEcriture = classerRefusEcriture(statutHttp, code, detail)
	switch (base.nature) {
		case 'slug-pris':
			return { nature: 'noeud-deja-employe', detail }
		case 'reference-absente':
			return { nature: geste === 'retrait' ? 'etape-occupee' : 'reference-absente', detail }
		case 'workflow-hors-track':
			return { nature: 'forme-refusee', detail }
		default:
			return { nature: base.nature, detail }
	}
}

/**
 * Résultat d'une écriture.
 *
 * `sans-effet` n'est ni un succès ni une erreur : le `USING` de la politique filtre la ligne avant
 * la mise à jour, PostgREST rend `200` et **zéro ligne**, et l'écran doit le dire. Le confondre
 * avec un succès afficherait une modification qui n'a pas eu lieu.
 */
export type ResultatEtape =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusEtape }

/** Enveloppe commune : aucune écriture de ce module ne lève, toutes rendent un résultat classé. */
async function executer(
	geste: GesteEtape,
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatEtape> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusEtape(reponse.status, reponse.error.code, reponse.error.message, geste),
			}
		}
		// `select()` accompagne chaque écriture précisément pour que ce comptage existe : sans lui,
		// PostgREST ne rend aucun corps et « zéro ligne touchée » serait indistinguable d'un succès.
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusEtape(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
				geste,
			),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Les six écritures — docs/SPEC-workflow-engine.md §7 bis.4
// ---------------------------------------------------------------------------------------------

export type AjoutEtape = {
	readonly idWorkflow: string
	readonly idWorkspace: string
	readonly idNoeud: string
}

/**
 * Ajoute une étape à un workflow, depuis un nœud du catalogue.
 *
 * `position` EST ENVOYÉE À `null`, comme à la création d'un track : le trigger `BEFORE INSERT` du
 * §3.3 attribue la position dans la portée du workflow lorsqu'elle est omise, et il reçoit `NULL`
 * que le client l'ait omise ou écrite. L'assertion de type est nécessaire parce que le générateur
 * de `CRM-006` **ne voit pas les triggers** : il lit une colonne `NOT NULL` sans défaut et la
 * déclare obligatoire. L'alternative serait de calculer `max + 1` dans le navigateur, c'est-à-dire
 * de recopier le trigger en moins fiable et en y ajoutant une course entre deux administrateurs.
 *
 * AUCUNE SURCHARGE N'EST POSÉE À L'AJOUT, et c'est le §2.5 appliqué : les trois colonnes restent
 * `NULL`, ce qui veut dire « prendre la valeur du catalogue ». Recopier `default_probability` dans
 * `probability_override` figerait la valeur du jour et romprait le lien avec le catalogue, sans que
 * rien à l'écran ne le montre.
 */
export async function ajouterEtape(client: ClientCrm, ajout: AjoutEtape): Promise<ResultatEtape> {
	return executer('ajout', () =>
		client
			.from('workflow_steps')
			.insert({
				workflow_id: ajout.idWorkflow,
				workspace_id: ajout.idWorkspace,
				node_id: ajout.idNoeud,
				position: null,
			} as unknown as Database['public']['Tables']['workflow_steps']['Insert'])
			.select('id'),
	)
}

/** Déplace une étape : une seule écriture, la position calculée par `calculerDeplacement`. */
export async function deplacerEtape(
	client: ClientCrm,
	idEtape: string,
	position: number,
): Promise<ResultatEtape> {
	return executer('deplacement', () =>
		client.from('workflow_steps').update({ position }).eq('id', idEtape).select('id'),
	)
}

/**
 * Les trois surcharges d'une étape, écrites ensemble.
 *
 * `null` EST UNE VALEUR ENVOYÉE, PAS UN CHAMP OMIS : c'est ainsi qu'une surcharge se retire, et le
 * §2.5 en fait un geste distinct de « surcharger à zéro ». Un module qui ometterait les clés nulles
 * rendrait le retrait impossible depuis l'écran.
 */
export type SurchargeEtape = {
	readonly libelle: string | null
	readonly probabilite: number | null
	readonly anciennete: number | null
}

export async function surchargerEtape(
	client: ClientCrm,
	idEtape: string,
	surcharge: SurchargeEtape,
): Promise<ResultatEtape> {
	return executer('surcharge', () =>
		client
			.from('workflow_steps')
			.update({
				label_override: surcharge.libelle,
				probability_override: surcharge.probabilite,
				stale_after_days: surcharge.anciennete,
			})
			.eq('id', idEtape)
			.select('id'),
	)
}

/**
 * Désigne l'étape initiale du workflow.
 *
 * DEUX ÉCRITURES, ET L'ORDRE COMPTE. Le §3.5 dit ce que la base peut garantir et ce qu'elle ne peut
 * pas : elle interdit deux étapes initiales par un index unique partiel, mais elle ne sait pas
 * transformer une désignation en permutation. Éteindre d'abord, allumer ensuite, est donc le seul
 * ordre qui ne heurte jamais l'index — l'inverse le heurterait le temps d'une écriture.
 *
 * Un échec entre les deux laisse le workflow SANS étape initiale, ce que la base tolère et que
 * l'écran montre. C'est un état visible et réparable en un geste ; l'état inverse — deux étapes
 * initiales — serait refusé par l'index et laisserait l'administrateur devant un refus qu'il n'a
 * pas provoqué. Le §3.5 nomme déjà cette asymétrie comme la limite de ce que la base garantit.
 */
export async function designerEtapeInitiale(
	client: ClientCrm,
	idWorkflow: string,
	idEtape: string,
): Promise<ResultatEtape> {
	const extinction = await executer('initiale', () =>
		client
			.from('workflow_steps')
			.update({ is_initial: false })
			.eq('workflow_id', idWorkflow)
			.eq('is_initial', true)
			.select('id'),
	)
	// `sans-effet` est ici un succès : aucune étape n'était initiale, il n'y avait rien à éteindre.
	if (extinction.statut === 'refus') return extinction
	return executer('initiale', () =>
		client.from('workflow_steps').update({ is_initial: true }).eq('id', idEtape).select('id'),
	)
}

/**
 * Retire une étape du workflow.
 *
 * Le refus d'une étape occupée par des cards n'est PAS anticipé : il vient du `on delete restrict`
 * du §3.3, et il est traduit par `classerRefusEtape`. Compter les cards avant de supprimer ferait
 * porter à l'interface une garde que la base tient déjà, et la course entre le compte et la
 * suppression rendrait ce compte faux.
 */
export async function retirerEtape(client: ClientCrm, idEtape: string): Promise<ResultatEtape> {
	return executer('retrait', () =>
		client.from('workflow_steps').delete().eq('id', idEtape).select('id'),
	)
}

// =============================================================================================
// DEUXIÈME TRANCHE — les arêtes du graphe
// @spec docs/SPEC-workflow-engine.md §7 bis.9 (l'édition des transitions), §7 bis.9.1 (lecture 4
//       et l'ordre composé), §7 bis.9.2 (les trois gestes), §7 bis.9.3 (les choix offerts),
//       §7 bis.9.4 (validation de forme), §7 bis.9.5 (les refus), §3.4 (modèle et contraintes)
// =============================================================================================
//
// AUCUNE MIGRATION N'ACCOMPAGNE CETTE TRANCHE : `workflow_transitions` existe depuis `CRM-031`
// avec ses quatre contraintes et ses politiques, et ce module ne fait que les employer.

/** Une arête, telle que le bloc des transitions la présente. */
export type TransitionAdministrable = Pick<
	Database['public']['Tables']['workflow_transitions']['Row'],
	'id' | 'workflow_id' | 'workspace_id' | 'from_step_id' | 'to_step_id' | 'label' | 'require_comment'
>

export const COLONNES_TRANSITION_ADMIN =
	'id, workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment'

/**
 * Les arêtes d'un workflow — lecture 4 du §7 bis.9.1.
 *
 * L'ORDRE DEMANDÉ EST CELUI DES IDENTIFIANTS, ET C'EST ASSUMÉ. PostgREST ordonne sur des colonnes
 * de la table, et `workflow_transitions` ne porte pas la position des étapes : demander l'ordre du
 * graphe ici est impossible sans embarquer les deux étapes et trier sur une ressource embarquée.
 * L'ordre servi est donc simplement **stable**, ce qui suffit à une requête ; l'ordre lisible est
 * composé par `grouperTransitions` depuis les étapes déjà lues.
 */
export async function lireTransitions(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly TransitionAdministrable[]>> {
	try {
		const reponse = await client
			.from('workflow_transitions')
			.select(COLONNES_TRANSITION_ADMIN)
			.eq('workflow_id', idWorkflow)
			.order('from_step_id')
			.order('to_step_id')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as readonly TransitionAdministrable[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les arêtes partant d'une étape, telles que l'écran les groupe. */
export type GroupeTransitions = {
	readonly etape: EtapeAdministrable
	readonly sorties: readonly TransitionAdministrable[]
}

/**
 * Groupe les arêtes par étape de départ, dans l'ordre du graphe — §7 bis.9.1.
 *
 * LES ÉTAPES SONT LA SOURCE DE L'ORDRE, PAS LES ARÊTES : la liste rendue suit `etapes`, qui arrive
 * déjà triée par `position`. Une étape sans sortie apparaît donc avec un groupe **vide** plutôt que
 * de disparaître — le §3.9 en livre deux, et un graphe qui masquerait ses culs-de-sac cacherait
 * précisément ce qu'un administrateur cherche.
 *
 * UNE ARÊTE DONT LE DÉPART N'EST PAS DANS LA LISTE EST ÉCARTÉE. Ce n'est pas défensif sans motif :
 * l'écran lit les étapes et les arêtes en deux requêtes, et une étape retirée par un autre
 * administrateur entre les deux rendrait une arête orpheline. La rattacher à un départ inconnu
 * afficherait une ligne que personne ne peut ni lire ni corriger ; la base, elle, a déjà supprimé
 * l'arête en cascade (§3.4) — l'écran ne fait que ne pas montrer un fantôme jusqu'au rechargement.
 */
export function grouperTransitions(
	etapes: readonly EtapeAdministrable[],
	transitions: readonly TransitionAdministrable[],
): readonly GroupeTransitions[] {
	const parDepart = new Map<string, TransitionAdministrable[]>()
	for (const transition of transitions) {
		const sorties = parDepart.get(transition.from_step_id)
		if (sorties === undefined) parDepart.set(transition.from_step_id, [transition])
		else sorties.push(transition)
	}
	const rang = new Map(etapes.map((etape, index) => [etape.id, index]))
	return etapes.map((etape) => ({
		etape,
		// Les sorties d'une étape suivent l'ordre du graphe de leur arrivée, par la même règle que
		// les groupes eux-mêmes. Une arrivée absente de la liste ne peut pas exister ici : sa
		// cascade l'aurait emportée, et l'ordre la placerait en fin plutôt que de la perdre.
		sorties: (parDepart.get(etape.id) ?? [])
			.slice()
			.sort(
				(gauche, droite) =>
					(rang.get(gauche.to_step_id) ?? Number.MAX_SAFE_INTEGER) -
					(rang.get(droite.to_step_id) ?? Number.MAX_SAFE_INTEGER),
			),
	}))
}

/**
 * Les arrivées encore déclarables depuis une étape — §7 bis.9.3.
 *
 * Deux retraits, et aucun n'est une garde : l'étape de départ elle-même, que le
 * `CHECK from_step_id <> to_step_id` refuserait, et les arrivées déjà déclarées, que l'unicité
 * `(workflow_id, from_step_id, to_step_id)` refuserait. Ils évitent d'offrir un choix dont la
 * réponse est connue d'avance (`CLAUDE.md` §10).
 */
export function arriveesPossibles(
	etapes: readonly EtapeAdministrable[],
	transitions: readonly TransitionAdministrable[],
	idDepart: string,
): readonly EtapeAdministrable[] {
	const deja = new Set(
		transitions
			.filter((transition) => transition.from_step_id === idDepart)
			.map((transition) => transition.to_step_id),
	)
	return etapes.filter((etape) => etape.id !== idDepart && !deja.has(etape.id))
}

/** Un libellé d'arête fourni n'est pas blanc (§3.4, `label is null or btrim(label) <> ''`). */
export const libelleTransitionConforme = (libelle: string): boolean => libelle.trim() !== ''

export type NatureRefusTransition =
	/** `403`/`401` — `42501`. Seul un administrateur du workspace écrit (§3.7). */
	| 'forbidden'
	/** `23505` — l'unicité `(workflow_id, from_step_id, to_step_id)` : l'arête existe déjà. */
	| 'arete-deja-declaree'
	/** `23503` — une des deux étapes n'existe plus, ou n'appartient pas à ce workflow. */
	| 'reference-absente'
	/** `23514` — réflexivité, ou libellé blanc. Les deux `CHECK` du §3.4 partagent ce code. */
	| 'forme-refusee'
	| 'network'
	| 'unknown'

export type RefusTransition = {
	readonly nature: NatureRefusTransition
	readonly detail: string
}

/**
 * Classe un refus d'écriture sur une arête.
 *
 * PAS DE PARAMÈTRE `geste`, ET C'EST LA DIFFÉRENCE AVEC `classerRefusEtape`. Là-bas, le même
 * `23503` disait deux choses opposées selon que l'on retirait une étape — `on delete restrict`
 * depuis les cards, « étape occupée » — ou que l'on écrivait ailleurs. Ici, **rien ne retient une
 * arête** : aucune colonne de `cards` ne désigne une transition, donc aucun retrait ne peut être
 * refusé pour occupation. Le `23503` redevient uniformément « une extrémité a disparu », et
 * introduire un paramètre pour distinguer des cas qui n'existent pas ferait croire à une règle de
 * plus (§7 bis.9.2).
 */
export function classerRefusTransition(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusTransition {
	const base: RefusEcriture = classerRefusEcriture(statutHttp, code, detail)
	switch (base.nature) {
		case 'slug-pris':
			return { nature: 'arete-deja-declaree', detail }
		case 'workflow-hors-track':
			return { nature: 'forme-refusee', detail }
		default:
			return { nature: base.nature, detail }
	}
}

export type ResultatTransition =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusTransition }

/** Enveloppe des écritures d'arête, jumelle de `executer` mais sur `RefusTransition`. */
async function executerTransition(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatTransition> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusTransition(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusTransition(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

export type DeclarationTransition = {
	readonly idWorkflow: string
	readonly idWorkspace: string
	readonly idDepart: string
	readonly idArrivee: string
	readonly libelle: string | null
	readonly motifExige: boolean
}

/**
 * Déclare une arête entre deux étapes du même workflow.
 *
 * `label` À `null` N'EST PAS UN CHAMP OMIS : le §3.4 le déclare facultatif, et « pas de libellé »
 * veut dire « l'interface d'une card affichera le libellé de l'étape d'arrivée » (§7). Envoyer `''`
 * heurterait le `CHECK` ; c'est la même règle que les surcharges du §7 bis.4.
 */
export async function declarerTransition(
	client: ClientCrm,
	declaration: DeclarationTransition,
): Promise<ResultatTransition> {
	return executerTransition(() =>
		client
			.from('workflow_transitions')
			.insert({
				workflow_id: declaration.idWorkflow,
				workspace_id: declaration.idWorkspace,
				from_step_id: declaration.idDepart,
				to_step_id: declaration.idArrivee,
				label: declaration.libelle,
				require_comment: declaration.motifExige,
			})
			.select('id'),
	)
}

/** Modifie le libellé et le motif exigé d'une arête. Les deux extrémités ne se modifient pas :
 * changer une extrémité est une autre arête, et l'écran la fait déclarer puis retirer plutôt que
 * de transformer silencieusement une porte en une autre. */
export async function modifierTransition(
	client: ClientCrm,
	idTransition: string,
	libelle: string | null,
	motifExige: boolean,
): Promise<ResultatTransition> {
	return executerTransition(() =>
		client
			.from('workflow_transitions')
			.update({ label: libelle, require_comment: motifExige })
			.eq('id', idTransition)
			.select('id'),
	)
}

/**
 * Retire une arête.
 *
 * Aucun refus métier n'est possible ici — voir `classerRefusTransition`. Le seul refus attendu est
 * celui de la politique du §3.7, et il est traduit comme les autres.
 */
export async function retirerTransition(
	client: ClientCrm,
	idTransition: string,
): Promise<ResultatTransition> {
	return executerTransition(() =>
		client.from('workflow_transitions').delete().eq('id', idTransition).select('id'),
	)
}

// =============================================================================================
// TROISIÈME TRANCHE — les champs du formulaire
// @spec docs/SPEC-workflow-engine.md §7 bis.10 (l'édition des champs), §7 bis.10.1 (lecture 5 et
//       les champs archivés rapportés), §7 bis.10.2 (les cinq gestes), §7 bis.10.3 (clé et type
//       non modifiables, et les mesures qui le motivent), §7 bis.10.4 (validation de forme et la
//       seule qui ne soit pas un raccourci), §7 bis.10.5 (les refus)
// @spec docs/SPEC-form-composer.md §2.2 (modèle `form_fields`), §2.3 (les quinze types),
//       §2.4 (ce qu'`options` doit porter), §2.5 (la clé durable), §2.6 (ordre des champs),
//       §2.7 (autorisations, et l'absence de privilège `DELETE`)
// =============================================================================================
//
// AUCUNE MIGRATION N'ACCOMPAGNE CETTE TRANCHE : `form_fields` existe depuis `CRM-035` avec ses six
// `CHECK` et ses politiques, et ce module ne fait que les employer.

/** Un champ, tel que le bloc du formulaire le présente. */
export type ChampAdministrable = Pick<
	Database['public']['Tables']['form_fields']['Row'],
	'id' | 'workflow_id' | 'workspace_id' | 'key' | 'label' | 'type' | 'options' | 'help_text' | 'position' | 'archived_at'
>

export const COLONNES_CHAMP_ADMIN =
	'id, workflow_id, workspace_id, key, label, type, options, help_text, position, archived_at'

/**
 * Les champs du formulaire d'un workflow — lecture 5 du §7 bis.10.1.
 *
 * LES CHAMPS ARCHIVÉS SONT RAPPORTÉS, à la différence du catalogue de `lireCatalogueActif` qui
 * exclut les siens côté serveur. Ce n'est pas une inconstance : un nœud archivé n'est plus
 * **ajoutable**, et cette lecture-là sert à offrir un choix ; un champ archivé, lui, est le seul
 * état que le produit connaisse pour « retiré » — MESURÉ, `DELETE /form_fields` rend `403`/`42501`
 * même à l'administratrice (§2.7). Le masquer rendrait la restauration inatteignable et ferait
 * croire à une suppression qui n'a pas eu lieu.
 */
export async function lireChamps(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly ChampAdministrable[]>> {
	try {
		const reponse = await client
			.from('form_fields')
			.select(COLONNES_CHAMP_ADMIN)
			.eq('workflow_id', idWorkflow)
			.order('position')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as readonly ChampAdministrable[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les types, et ce que chacun exige — docs/SPEC-form-composer.md §2.3 et §2.4
// ---------------------------------------------------------------------------------------------

/**
 * Les quinze types du §2.3, dans l'ordre où le sélecteur les propose.
 *
 * La liste est écrite ici plutôt que dérivée du type engendré : `form_fields.type` est un `text`
 * porteur d'un `CHECK`, et le générateur de `CRM-006` ne voit pas les `CHECK` — il déclare `string`.
 * Une liste tirée du type serait donc `string`, c'est-à-dire aucune liste. Elle est en revanche
 * éprouvée contre la base par la preuve d'écran et par le refus `23514` d'un type hors liste.
 */
export const TYPES_CHAMP = [
	'text',
	'textarea',
	'number',
	'money',
	'date',
	'datetime',
	'select',
	'multiselect',
	'checkbox',
	'url',
	'email',
	'phone',
	'user',
	'contact',
	'file',
] as const

export type TypeChamp = (typeof TYPES_CHAMP)[number]

/** Les deux types dont la base EXIGE une liste de choix non vide (§2.4). */
export const TYPES_A_CHOIX: readonly TypeChamp[] = ['select', 'multiselect']

/** Le seul type dont la base EXIGE une devise (§2.4). */
export const estTypeAChoix = (type: string): boolean => TYPES_A_CHOIX.includes(type as TypeChamp)
export const estTypeMonetaire = (type: string): boolean => type === 'money'

/** Une entrée de `options.choices`, telle que le §2.4 la décrit — `{key, label}`. */
export type ChoixChamp = {
	readonly key: string
	readonly label: string
}

/**
 * Les choix portés par un champ, lus depuis son `options` `jsonb`.
 *
 * `options` arrive typé `Json` : rien ne garantit sa forme côté TypeScript, et la base ne garantit
 * que « objet » et « `choices` est un tableau non vide » (§2.4). Les entrées malformées sont donc
 * ÉCARTÉES plutôt que rendues à moitié — une entrée sans clé ne peut désigner aucune valeur, et
 * l'afficher dans l'éditeur inviterait à la conserver.
 */
export function choixDuChamp(champ: ChampAdministrable): readonly ChoixChamp[] {
	const options = champ.options
	if (options === null || typeof options !== 'object' || Array.isArray(options)) return []
	const choix = (options as Record<string, unknown>).choices
	if (!Array.isArray(choix)) return []
	const retenus: ChoixChamp[] = []
	for (const entree of choix) {
		if (entree === null || typeof entree !== 'object' || Array.isArray(entree)) continue
		const cle = (entree as Record<string, unknown>).key
		const libelle = (entree as Record<string, unknown>).label
		if (typeof cle !== 'string' || cle.trim() === '') continue
		retenus.push({ key: cle, label: typeof libelle === 'string' ? libelle : cle })
	}
	return retenus
}

/** La devise portée par un champ `money` (§2.4), ou la chaîne vide si elle est absente. */
export function deviseDuChamp(champ: ChampAdministrable): string {
	const options = champ.options
	if (options === null || typeof options !== 'object' || Array.isArray(options)) return ''
	const devise = (options as Record<string, unknown>).currency
	return typeof devise === 'string' ? devise : ''
}

/**
 * Compose l'objet `options` à envoyer, selon le type.
 *
 * LES OPTIONS ÉTRANGÈRES AU TYPE NE SONT PAS RECOPIÉES, et c'est un choix : un champ passé de
 * `select` à autre chose n'emporte pas ses choix. Le cas ne peut pas naître de l'écran — le type
 * n'y est pas modifiable (§7 bis.10.3) — mais il peut naître d'une écriture d'API antérieure, et
 * réémettre des `choices` sur un champ `text` ferait persister par l'éditeur une donnée que
 * personne ne lit. `{}` est envoyé plutôt qu'omis, pour la même raison que le seed l'envoie : un
 * `PATCH` qui omettrait la clé laisserait en place ce qu'il prétend remplacer.
 */
export function composerOptions(
	type: string,
	choix: readonly ChoixChamp[],
	devise: string,
): Record<string, unknown> {
	if (estTypeAChoix(type)) {
		return { choices: choix.map((entree) => ({ key: entree.key.trim(), label: entree.label.trim() })) }
	}
	if (estTypeMonetaire(type)) return { currency: devise.trim().toUpperCase() }
	return {}
}

// ---------------------------------------------------------------------------------------------
// Validation de forme — docs/SPEC-workflow-engine.md §7 bis.10.4
// ---------------------------------------------------------------------------------------------

/** La clé d'un champ : minuscules, chiffres, tirets simples (§2.2, `form_fields_key_check`). */
const MOTIF_CLE_CHAMP = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const cleChampConforme = (cle: string): boolean => MOTIF_CLE_CHAMP.test(cle)

/** Le libellé d'un champ n'est pas vide après `btrim` (`form_fields_label_check`). */
export const libelleChampConforme = (libelle: string): boolean => libelle.trim() !== ''

/** L'aide est facultative, mais non blanche lorsqu'elle est fournie (`form_fields_help_text_check`). */
export const aideChampConforme = (aide: string): boolean => aide === '' || aide.trim() !== ''

/** La devise d'un champ `money` : trois majuscules (`form_fields_currency_check`). */
const MOTIF_DEVISE = /^[A-Z]{3}$/
export const deviseConforme = (devise: string): boolean => MOTIF_DEVISE.test(devise.trim().toUpperCase())

/**
 * Les choix d'un champ `select` ou `multiselect`.
 *
 * CE CONTRÔLE N'EST PAS UN RACCOURCI, et c'est le seul de tout cet éditeur dans ce cas. La base
 * exige un tableau `choices` **non vide** et rien de plus : MESURÉ le 2026-08-14, un `select`
 * portant DEUX choix de clé `a` est accepté en `201`. Le §2.4 l'annonçait — un `CHECK` ne déplie
 * pas un tableau `jsonb` —, de sorte que la forme `{key, label}` et l'unicité des clés ne sont
 * tenues que par cette fonction. Ce qu'elle ne couvre pas est écrit au §7 bis.10.4 : une écriture
 * directe par l'API reste possible, et seule la validation des valeurs en subira la conséquence.
 */
export type RefusChoix = 'aucun-choix' | 'cle-vide' | 'libelle-vide' | 'cle-dupliquee' | null

export function refusDesChoix(choix: readonly ChoixChamp[]): RefusChoix {
	if (choix.length === 0) return 'aucun-choix'
	const vues = new Set<string>()
	for (const entree of choix) {
		const cle = entree.key.trim()
		if (cle === '') return 'cle-vide'
		if (entree.label.trim() === '') return 'libelle-vide'
		if (vues.has(cle)) return 'cle-dupliquee'
		vues.add(cle)
	}
	return null
}

// ---------------------------------------------------------------------------------------------
// Les refus — docs/SPEC-workflow-engine.md §7 bis.10.5
// ---------------------------------------------------------------------------------------------

export type NatureRefusChamp =
	/** `403`/`401` — `42501`. Seul un administrateur du workspace écrit (§2.7). */
	| 'forbidden'
	/** `23505` — l'unicité `(workflow_id, key)` : cette clé est déjà prise dans ce workflow. */
	| 'cle-deja-prise'
	/** `23503` — le workflow a disparu, ou n'appartient pas à ce workspace. */
	| 'reference-absente'
	/** `23514` — six `CHECK` distincts : clé, libellé, aide, type, `options` objet, options du type. */
	| 'forme-refusee'
	| 'network'
	| 'unknown'

export type RefusChamp = {
	readonly nature: NatureRefusChamp
	readonly detail: string
}

/**
 * Classe un refus d'écriture sur un champ.
 *
 * PAS DE PARAMÈTRE `geste`, pour la raison exacte de `classerRefusTransition` : aucun retrait
 * n'existe ici — le privilège `DELETE` n'est pas accordé —, donc aucun `23503` ne peut vouloir dire
 * « occupé ». Il reste uniformément « le workflow a disparu » (§7 bis.10.5).
 */
export function classerRefusChamp(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusChamp {
	const base: RefusEcriture = classerRefusEcriture(statutHttp, code, detail)
	switch (base.nature) {
		case 'slug-pris':
			return { nature: 'cle-deja-prise', detail }
		case 'workflow-hors-track':
			return { nature: 'forme-refusee', detail }
		default:
			return { nature: base.nature, detail }
	}
}

export type ResultatChamp =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusChamp }

/** Enveloppe des écritures de champ, jumelle des deux précédentes sur `RefusChamp`. */
async function executerChamp(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatChamp> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusChamp(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusChamp(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Les cinq écritures — docs/SPEC-workflow-engine.md §7 bis.10.2
// ---------------------------------------------------------------------------------------------

export type DeclarationChamp = {
	readonly idWorkflow: string
	readonly idWorkspace: string
	readonly cle: string
	readonly libelle: string
	readonly type: string
	readonly aide: string | null
	readonly options: Record<string, unknown>
}

/**
 * Déclare un champ dans le formulaire d'un workflow.
 *
 * `position` EST OMISE, et non envoyée à `null` comme pour une étape. MESURÉ le 2026-08-14 : un
 * `POST` sans `position` rend `201` et une position en **fin** de formulaire — le trigger
 * `BEFORE INSERT` du §2.6 la calcule dans la portée du workflow. L'assertion de type est nécessaire
 * parce que le générateur de `CRM-006` ne voit pas les triggers et déclare la colonne obligatoire.
 *
 * `help_text` À `null` N'EST PAS UN CHAMP OMIS : « pas d'aide » est un état, et `''` serait refusé
 * par `form_fields_help_text_check` — même règle que les surcharges du §7 bis.4.
 */
export async function declarerChamp(
	client: ClientCrm,
	declaration: DeclarationChamp,
): Promise<ResultatChamp> {
	return executerChamp(() =>
		client
			.from('form_fields')
			.insert({
				workflow_id: declaration.idWorkflow,
				workspace_id: declaration.idWorkspace,
				key: declaration.cle,
				label: declaration.libelle,
				type: declaration.type,
				help_text: declaration.aide,
				options: declaration.options as Database['public']['Tables']['form_fields']['Insert']['options'],
			} as unknown as Database['public']['Tables']['form_fields']['Insert'])
			.select('id'),
	)
}

/**
 * Modifie un champ : son libellé, son aide et ses options.
 *
 * NI LA CLÉ NI LE TYPE, et les deux motifs sont mesurés au §7 bis.10.3. La base accepte pourtant de
 * modifier l'une comme l'autre — `200` dans les deux cas. La clé est l'identifiant durable que les
 * exports et les messages d'erreur citent (§2.5) ; le type, lui, laisse derrière lui des valeurs que
 * le produit refuse ensuite de réécrire, la validation ne revisitant aucune ligne existante. Un
 * changement de type est un plan de remappage, c'est-à-dire `CRM-078`.
 */
export async function modifierChamp(
	client: ClientCrm,
	idChamp: string,
	libelle: string,
	aide: string | null,
	options: Record<string, unknown>,
): Promise<ResultatChamp> {
	return executerChamp(() =>
		client
			.from('form_fields')
			.update({
				label: libelle,
				help_text: aide,
				options: options as Database['public']['Tables']['form_fields']['Update']['options'],
			})
			.eq('id', idChamp)
			.select('id'),
	)
}

/** Déplace un champ : une seule écriture, la position calculée par `calculerDeplacement`. */
export async function deplacerChamp(
	client: ClientCrm,
	idChamp: string,
	position: number,
): Promise<ResultatChamp> {
	return executerChamp(() =>
		client.from('form_fields').update({ position }).eq('id', idChamp).select('id'),
	)
}

/**
 * Archive un champ, ou le restaure.
 *
 * C'EST LE SEUL RETRAIT QUE LE PRODUIT CONNAISSE. MESURÉ : `DELETE /form_fields` rend `403` et
 * `42501` avec le jeton de l'administratrice, aucun privilège `DELETE` n'étant accordé (§2.7).
 * L'archivage retire le champ des formulaires **sans supprimer les valeurs déjà saisies**, et il se
 * défait par la même écriture avec `null` — un retrait réversible plutôt qu'une perte.
 *
 * L'instant est celui de l'appelant, non `now()` : PostgREST écrit ce qu'on lui envoie, et un
 * horodatage calculé côté client est ce que l'écran affichera de toute façon.
 */
export async function archiverChamp(
	client: ClientCrm,
	idChamp: string,
	instant: string | null,
): Promise<ResultatChamp> {
	return executerChamp(() =>
		client.from('form_fields').update({ archived_at: instant }).eq('id', idChamp).select('id'),
	)
}

// =============================================================================================
// QUATRIÈME TRANCHE — la grille champ × étape des règles de visibilité
// @spec docs/SPEC-workflow-engine.md §7 bis.11 (la grille), §7 bis.11.1 (lecture 6 et son ordre
//       d'identifiants), §7 bis.11.2 (la composition, qui ne part jamais des règles),
//       §7 bis.11.3 (les deux gestes, et pourquoi le réglage est un `upsert`),
//       §7 bis.11.4 (les quatre états d'une case), §7 bis.11.5 (les refus)
// @spec docs/SPEC-form-composer.md §3.1 (les trois visibilités et le défaut), §3.2 (modèle et clé
//       primaire composite), §3.3 (les trois clés composites, mesurées), §5 (l'édition en un seul
//       écran, et ce que l'archivage d'un champ fait de ses règles)
// =============================================================================================
//
// AUCUNE MIGRATION N'ACCOMPAGNE CETTE TRANCHE : `form_field_rules` existe depuis `CRM-035` avec son
// `CHECK` de visibilité, ses trois clés composites et ses quatre politiques.

/** Une règle de visibilité, telle que la grille la consomme. */
export type RegleAdministrable = Pick<
	Database['public']['Tables']['form_field_rules']['Row'],
	'field_id' | 'step_id' | 'visibility'
>

export const COLONNES_REGLE_ADMIN = 'field_id, step_id, visibility'

/**
 * Les règles de visibilité d'un workflow — lecture 6 du §7 bis.11.1.
 *
 * L'ORDRE DEMANDÉ EST CELUI DES IDENTIFIANTS, pour la raison exacte de `lireTransitions` : la table
 * ne porte ni la position d'un champ ni celle d'une étape, donc aucun ordre lisible ne peut être
 * demandé au serveur. La grille n'en a pas besoin — elle n'est jamais parcourue dans l'ordre des
 * règles, elle est **indexée** par le couple, et son ordre vient des deux listes déjà lues.
 */
export async function lireRegles(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly RegleAdministrable[]>> {
	try {
		const reponse = await client
			.from('form_field_rules')
			.select(COLONNES_REGLE_ADMIN)
			.eq('workflow_id', idWorkflow)
			.order('field_id')
			.order('step_id')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as readonly RegleAdministrable[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les trois visibilités du §3.1, dans l'ordre croissant d'exigence où la case les propose. */
export const VISIBILITES = ['hidden', 'visible', 'required'] as const

export type Visibilite = (typeof VISIBILITES)[number]

/**
 * L'état d'une case : une des trois visibilités, ou le **défaut**.
 *
 * QUATRE ÉTATS, PAS TROIS, et le §7 bis.11.4 en donne le motif : l'absence de règle vaut `visible`
 * (§3.1 du composeur), mais une règle `visible` explicite existe aussi — le seed en pose deux.
 * Replier l'une sur l'autre afficherait ces deux règles comme des absences, puis les supprimerait
 * au premier réglage voisin, c'est-à-dire effacerait une ligne que personne n'a désignée.
 */
export type EtatCase = Visibilite | 'defaut'

export type CaseGrille = {
	readonly etape: EtapeAdministrable
	readonly etat: EtatCase
}

export type LigneGrille = {
	readonly champ: ChampAdministrable
	readonly cases: readonly CaseGrille[]
}

/** La clé d'indexation d'un couple. Les identifiants sont des `uuid` : aucun ne contient ` `. */
const cleCouple = (idChamp: string, idEtape: string): string => `${idChamp} ${idEtape}`

/**
 * Compose la grille champ × étape — §7 bis.11.2.
 *
 * ELLE NE PART JAMAIS DES RÈGLES, et c'est la règle de lecture que le §3.1 du composeur pose pour
 * le rendu d'un formulaire, appliquée en deux dimensions : les lignes sont les champs, les colonnes
 * les étapes, et la règle n'est consultée qu'ensuite. MESURÉ sur le seed le 2026-08-15 : quinze
 * règles pour six champs actifs × sept étapes, soit **vingt-sept** couples sans règle — une
 * composition partant des règles perdrait les deux tiers de la grille.
 *
 * LES CHAMPS ARCHIVÉS SONT ÉCARTÉS DES LIGNES, à la différence de `lireChamps` qui les rapporte.
 * La liste des champs sert à en **restaurer** un ; la grille décrit ce qu'un formulaire montre, et
 * un champ archivé n'apparaît dans aucun formulaire (§5 du composeur). Ses règles ne sont pas
 * touchées — MESURÉ, la base en accepte même de nouvelles sur un champ archivé — et redeviennent
 * effectives dès sa restauration. L'écran dit combien de champs sont ainsi retirés.
 *
 * UNE RÈGLE ORPHELINE EST IGNORÉE plutôt que rendue : son champ ou son étape a disparu entre deux
 * lectures, la base l'a déjà emportée en cascade (§3.3 du composeur), et aucune case ne peut
 * l'accueillir.
 */
export function composerGrille(
	champs: readonly ChampAdministrable[],
	etapes: readonly EtapeAdministrable[],
	regles: readonly RegleAdministrable[],
): readonly LigneGrille[] {
	const parCouple = new Map<string, Visibilite>()
	for (const regle of regles) {
		parCouple.set(cleCouple(regle.field_id, regle.step_id), regle.visibility as Visibilite)
	}
	return champs
		.filter((champ) => champ.archived_at === null)
		.map((champ) => ({
			champ,
			cases: etapes.map((etape) => ({
				etape,
				etat: parCouple.get(cleCouple(champ.id, etape.id)) ?? ('defaut' as const),
			})),
		}))
}

export type NatureRefusRegle =
	/** `403`/`401` — `42501`. Seul un administrateur du workspace écrit (§3.7 du composeur). */
	| 'forbidden'
	/** `23503` — le champ ou l'étape a disparu, ou n'appartient pas à ce workflow. */
	| 'reference-absente'
	/** `23514` — le `CHECK` de visibilité, seule cause possible ici. */
	| 'forme-refusee'
	| 'network'
	| 'unknown'

export type RefusRegle = {
	readonly nature: NatureRefusRegle
	readonly detail: string
}

/**
 * Classe un refus d'écriture sur une règle.
 *
 * `23505` N'EST PAS TRADUIT EN REFUS MÉTIER, et c'est la différence avec les trois classifications
 * précédentes. Il ne peut naître que d'une insertion sans `resolution=merge-duplicates`, que
 * `reglerVisibilite` n'émet jamais — MESURÉ le 2026-08-15 : `409` / `23505` sur
 * `form_field_rules_pkey` dès que le couple existe. Lui donner une nature ferait croire à une règle
 * de plus, là où le §7 bis.11.3 explique précisément pourquoi l'écran ne peut pas le rencontrer. Il
 * est replié sur `unknown`, qui rend le message générique, et son détail reste lisible.
 */
export function classerRefusRegle(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusRegle {
	const base: RefusEcriture = classerRefusEcriture(statutHttp, code, detail)
	switch (base.nature) {
		case 'slug-pris':
			return { nature: 'unknown', detail }
		case 'workflow-hors-track':
			return { nature: 'forme-refusee', detail }
		default:
			return { nature: base.nature, detail }
	}
}

export type ResultatRegle =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusRegle }

/** Enveloppe des écritures de règle, jumelle des trois précédentes sur `RefusRegle`. */
async function executerRegle(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatRegle> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusRegle(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusRegle(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

export type ReglageCase = {
	readonly idChamp: string
	readonly idEtape: string
	readonly idWorkflow: string
	readonly idWorkspace: string
	readonly visibilite: Visibilite
}

/**
 * Règle une case sur une des trois visibilités — premier geste du §7 bis.11.3.
 *
 * C'EST UN `upsert`, PAS UN CHOIX ENTRE INSERTION ET MODIFICATION, et les quatre mesures du
 * 2026-08-15 le décident : `POST` d'un couple absent rend `201` ; le même `POST` avec
 * `resolution=merge-duplicates` rend `200` sur un couple existant ; **sans** cette résolution il
 * rend `409` / `23505` ; `PATCH` rend `200`. Un écran qui choisirait d'après ce qu'il a lu prendrait
 * donc le `409` dès qu'un autre administrateur a réglé la même case entre la lecture et le clic —
 * un refus que l'utilisateur n'a pas provoqué. L'`upsert` est la seule des quatre formes
 * indifférente à l'état lu, et la clé primaire `(field_id, step_id)` du §3.2 est ce qui le permet.
 *
 * `onConflict` EST ÉCRIT PLUTÔT QUE DÉDUIT : PostgREST retomberait sur la clé primaire, mais la
 * lire dans l'appel dit quel couple porte l'unicité sans avoir à ouvrir la migration.
 */
export async function reglerVisibilite(
	client: ClientCrm,
	reglage: ReglageCase,
): Promise<ResultatRegle> {
	return executerRegle(() =>
		client
			.from('form_field_rules')
			.upsert(
				{
					field_id: reglage.idChamp,
					step_id: reglage.idEtape,
					workflow_id: reglage.idWorkflow,
					workspace_id: reglage.idWorkspace,
					visibility: reglage.visibilite,
				},
				{ onConflict: 'field_id,step_id' },
			)
			.select('field_id'),
	)
}

/**
 * Rend une case au défaut, c'est-à-dire retire sa règle — second geste du §7 bis.11.3.
 *
 * C'EST LE SEUL `DELETE` DE TOUT CET ÉDITEUR DE FORMULAIRE. Un champ ne se supprime pas — aucun
 * privilège `DELETE` ne lui est accordé (§2.7 du composeur) —, une règle si : la décision 96 l'écrit
 * dans la migration, « une règle est la composition d'un formulaire, sans existence propre ».
 * MESURÉ : `200` et la ligne retirée avec le jeton de l'administratrice, `200` et `[]` avec celui du
 * `business_developer`, la règle restant alors intacte.
 */
export async function rendreAuDefaut(
	client: ClientCrm,
	idChamp: string,
	idEtape: string,
): Promise<ResultatRegle> {
	return executerRegle(() =>
		client
			.from('form_field_rules')
			.delete()
			.eq('field_id', idChamp)
			.eq('step_id', idEtape)
			.select('field_id'),
	)
}

// ---------------------------------------------------------------------------------------------
// Les exigences propres à une transition — docs/SPEC-workflow-engine.md §7 bis.12
// ---------------------------------------------------------------------------------------------
//
// @spec CRM-076 (docs/BACKLOG.md) — cinquième tranche : les exigences de transition
// @spec docs/SPEC-workflow-engine.md §7 bis.12 (lecture 7, union effective, deux gestes, refus)
// @spec docs/SPEC-transition-required-fields.md §1 (l'union des deux ensembles), §2 (la table à
//       deux colonnes, aucune valeur mutable), §4 (autorisations), §5.1 (`move_card`)
//
// AUCUNE MIGRATION N'ACCOMPAGNE CETTE TRANCHE : `workflow_transition_required_fields` existe depuis
// `CRM-018` avec sa clé primaire à deux colonnes, ses deux clés étrangères en cascade, ses trois
// triggers de cohérence et ses trois politiques.

/** Une exigence propre à une arête, telle que la lecture 7 la rend. */
export type ExigenceAdministrable = {
	readonly transition_id: string
	readonly field_id: string
}

export const COLONNES_EXIGENCE_ADMIN = 'transition_id, field_id'

/**
 * Les exigences propres aux arêtes d'un workflow — lecture 7 du §7 bis.12.1.
 *
 * LE FILTRE PASSE PAR UNE JOINTURE INTERNE, ET CE N'EST PAS UN CHOIX DE STYLE. La table n'a que
 * deux colonnes : `docs/SPEC-transition-required-fields.md` §2 explique pourquoi le workflow n'y est
 * délibérément pas dénormalisé — il se déduit des deux parents, et un trigger garantit leur égalité.
 * Il n'existe donc aucune colonne locale à filtrer. MESURÉ le 2026-08-15 : la lecture SANS filtre
 * rend les **deux** liaisons du seed, celle du workflow global et celle de sa copie dérivée ; la
 * jointure `workflow_transitions!inner` avec `transition.workflow_id=eq.…` rend `200` et la seule
 * liaison du workflow demandé. Sans elle, l'écran d'un workflow afficherait les exigences d'un
 * autre.
 *
 * La jointure est demandée en `select` mais **écartée du résultat** : elle ne sert qu'à filtrer, et
 * la rendre obligerait chaque appelant à ignorer une colonne qui ne dit rien de plus que le
 * paramètre déjà connu.
 */
export async function lireExigences(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly ExigenceAdministrable[]>> {
	try {
		const reponse = await client
			.from('workflow_transition_required_fields')
			.select(`${COLONNES_EXIGENCE_ADMIN}, transition:workflow_transitions!inner(workflow_id)`)
			.eq('transition.workflow_id', idWorkflow)
			.order('transition_id')
			.order('field_id')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lues = (reponse.data ?? []) as readonly { transition_id: string; field_id: string }[]
		return pret(
			lues.map((ligne) => ({ transition_id: ligne.transition_id, field_id: ligne.field_id })),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * L'origine d'une exigence effective — §7 bis.12.2.
 *
 * `regle` vient de la grille du §7 bis.11 : le champ porte `required` à l'étape d'ARRIVÉE de
 * l'arête. `transition` vient de la table de liaison. `les-deux` existe parce que la base accepte
 * parfaitement les deux et que `move_card` n'exige alors le champ qu'une fois : le taire ferait
 * croire à une exigence retirable là où la règle continuerait de l'imposer.
 */
export type OrigineExigence = 'regle' | 'transition' | 'les-deux'

export type ExigenceEffective = {
	readonly champ: ChampAdministrable
	readonly origine: OrigineExigence
}

/**
 * Les exigences EFFECTIVES d'une arête — l'union du §7 bis.12.2.
 *
 * CE N'EST PAS LA TABLE DE LIAISON, ET C'EST TOUT LE POINT DE CE BLOC. La sixième garde de
 * `move_card` (`docs/SPEC-transition-required-fields.md` §1 et §5.1) exige l'union des champs dont
 * la règle vaut `required` à l'étape d'arrivée ET des champs liés à la transition, restreinte aux
 * champs non archivés. Un écran qui n'aurait montré que la seconde moitié aurait écrit « aucune
 * exigence » là où l'étape d'arrivée en impose trois par règle, et fait déclarer des liaisons sans
 * effet observable.
 *
 * LES CHAMPS ARCHIVÉS SONT ÉCARTÉS, comme dans la garde elle-même (`f.archived_at is null`). MESURÉ
 * le 2026-08-15 : la base ACCEPTE une liaison vers un champ archivé — `201` —, mais elle ne produit
 * aucun effet. Elle n'est pas supprimée pour autant, et `exigencesSansEffet` la nomme.
 *
 * L'ordre est celui des champs, c'est-à-dire leur `position` : la table ne porte aucun ordre, et
 * celui du formulaire est le seul que l'administrateur ait déjà sous les yeux.
 */
export function exigencesEffectives(
	transition: TransitionAdministrable,
	champs: readonly ChampAdministrable[],
	regles: readonly RegleAdministrable[],
	exigences: readonly ExigenceAdministrable[],
): readonly ExigenceEffective[] {
	const parRegle = new Set(
		regles
			.filter((regle) => regle.step_id === transition.to_step_id && regle.visibility === 'required')
			.map((regle) => regle.field_id),
	)
	const parLiaison = new Set(
		exigences.filter((lien) => lien.transition_id === transition.id).map((lien) => lien.field_id),
	)
	const effectives: ExigenceEffective[] = []
	for (const champ of champs) {
		if (champ.archived_at !== null) continue
		const regle = parRegle.has(champ.id)
		const liaison = parLiaison.has(champ.id)
		if (!regle && !liaison) continue
		effectives.push({ champ, origine: regle && liaison ? 'les-deux' : regle ? 'regle' : 'transition' })
	}
	return effectives
}

/**
 * Les liaisons d'une arête qui ne produisent AUCUN effet — §7 bis.12.4.
 *
 * Une liaison vers un champ archivé reste en base et redevient effective à la restauration du champ,
 * exactement comme ses règles. La taire laisserait un administrateur croire qu'une exigence
 * s'applique. Une liaison dont le champ est introuvable dans la liste lue n'en fait pas partie : la
 * cascade l'a déjà emportée, ou une lecture plus récente l'a vue disparaître.
 */
export function exigencesSansEffet(
	transition: TransitionAdministrable,
	champs: readonly ChampAdministrable[],
	exigences: readonly ExigenceAdministrable[],
): readonly ChampAdministrable[] {
	const lies = new Set(
		exigences.filter((lien) => lien.transition_id === transition.id).map((lien) => lien.field_id),
	)
	return champs.filter((champ) => champ.archived_at !== null && lies.has(champ.id))
}

/**
 * Les champs qu'un administrateur peut encore lier à cette arête — §7 bis.12.4.
 *
 * DEUX EXCLUSIONS, ET AUCUNE N'EST COSMÉTIQUE : un champ archivé produirait une liaison sans effet
 * (MESURÉ, `201` puis ignorée par `move_card`), et un champ déjà lié serait refusé en `23505`
 * (MESURÉ). Proposer un choix dont on connaît le refus est une faute d'écran, pas une garantie.
 *
 * UN CHAMP DÉJÀ EXIGÉ PAR LA RÈGLE DE L'ÉTAPE D'ARRIVÉE RESTE PROPOSABLE, et c'est délibéré : la
 * règle peut changer, la liaison est un engagement propre à ce chemin, et la base accepte les deux.
 * L'écran dit ce que cette liaison ajoute — rien pour l'instant — plutôt que de trancher à la place
 * de l'administrateur.
 */
export function champsLiables(
	transition: TransitionAdministrable,
	champs: readonly ChampAdministrable[],
	exigences: readonly ExigenceAdministrable[],
): readonly ChampAdministrable[] {
	const lies = new Set(
		exigences.filter((lien) => lien.transition_id === transition.id).map((lien) => lien.field_id),
	)
	return champs.filter((champ) => champ.archived_at === null && !lies.has(champ.id))
}

export type NatureRefusExigence =
	/** `409` — `23505`. Un autre administrateur a déclaré la même exigence entre la lecture et le clic. */
	| 'deja-exige'
	/** `409` — `23503`. L'arête ou le champ a disparu entre deux lectures. */
	| 'reference-absente'
	/** `400` — `23514`, `required_field_workflow_mismatch`. Les deux parents ne partagent pas le workflow. */
	| 'workflow-different'
	/** `403`/`401` — `42501`. Seul un administrateur du workspace écrit (§4 de la spécification). */
	| 'forbidden'
	| 'network'
	| 'unknown'

export type RefusExigence = {
	readonly nature: NatureRefusExigence
	readonly detail: string
}

/**
 * Classe un refus d'écriture sur une exigence.
 *
 * `23505` EST ICI UN REFUS MÉTIER LISIBLE, à l'inverse exact du §7 bis.11.5 où il ne pouvait pas
 * apparaître. La grille réglait ses cases par `upsert` ; ce bloc ne le peut pas — MESURÉ le
 * 2026-08-15, `Prefer: resolution=merge-duplicates` rend `403`/`42501` faute du privilège `UPDATE`,
 * que `CRM-018` n'accorde délibérément pas. Le `23505` est donc l'issue normale d'une course, et
 * « déjà exigé » dit exactement ce que la base porte.
 *
 * `23514` A ICI UNE AUTRE CAUSE QUE DANS LES QUATRE CLASSIFICATIONS PRÉCÉDENTES, ET UNE SEULE : il
 * n'y a aucun `CHECK` de valeur sur cette table à deux colonnes, seulement les trois triggers de
 * cohérence, qui lèvent tous `required_field_workflow_mismatch`. MESURÉ le 2026-08-15 : `400` /
 * `required_field_workflow_mismatch` sur un champ du workflow dérivé lié à une arête globale.
 *
 * Les DEUX natures que `classerRefusEcriture` tire du `23514` sont donc repliées sur la même : ce
 * classement générique cherche le nom `workflow_hors_track`, qui appartient à une autre contrainte
 * et ne peut jamais apparaître ici. Laisser passer `forme-refusee` afficherait « la forme est
 * refusée » là où aucune forme n'est en cause, sur la seule table de l'éditeur qui n'a pas de
 * valeur à mettre en forme.
 */
export function classerRefusExigence(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusExigence {
	const base: RefusEcriture = classerRefusEcriture(statutHttp, code, detail)
	switch (base.nature) {
		case 'slug-pris':
			return { nature: 'deja-exige', detail }
		case 'workflow-hors-track':
		case 'forme-refusee':
			return { nature: 'workflow-different', detail }
		default:
			return { nature: base.nature, detail }
	}
}

export type ResultatExigence =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusExigence }

/** Enveloppe des écritures d'exigence, jumelle des quatre précédentes sur `RefusExigence`. */
async function executerExigence(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatExigence> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusExigence(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusExigence(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

/**
 * Exige un champ pour une transition — premier geste du §7 bis.12.3.
 *
 * C'EST UN `POST` SIMPLE, ET SURTOUT PAS UN `upsert`. La tranche précédente réglait ses cases par
 * `upsert` ; ici il est REFUSÉ, et pour une raison voulue : `CRM-018` n'accorde que `insert` et
 * `delete` à `authenticated`, parce que sa spécification §2 pose qu'aucune valeur n'est mutable —
 * « modifier une liaison signifie la supprimer puis en créer une autre ». Un `upsert` PostgREST a
 * besoin du privilège `UPDATE` pour sa branche de conflit. MESURÉ le 2026-08-15 :
 * `resolution=merge-duplicates` rend `403`/`42501` avec l'indice « GRANT UPDATE … », et `PATCH` le
 * même. Reprendre le patron voisin aurait produit un `403` incompréhensible sur le geste le plus
 * courant du bloc.
 *
 * AUCUN `workflow_id` NI `workspace_id` N'EST ENVOYÉ : la table n'en a pas (§2 de sa spécification),
 * et le trigger déduit le workflow des deux parents.
 */
export async function exigerChamp(
	client: ClientCrm,
	idTransition: string,
	idChamp: string,
): Promise<ResultatExigence> {
	return executerExigence(() =>
		client
			.from('workflow_transition_required_fields')
			.insert({ transition_id: idTransition, field_id: idChamp })
			.select('field_id'),
	)
}

/**
 * Retire une exigence propre à une transition — second geste du §7 bis.12.3.
 *
 * MESURÉ le 2026-08-15 : `200` et la ligne rendue avec le jeton de l'administratrice ; `200` et `[]`
 * avec celui du `business_developer`, la liaison seedée restant intacte ; `200` et `[]` AUSSI avec
 * le jeton de l'administratrice sur un couple inexistant. Les deux derniers sont indiscernables par
 * la réponse seule : `sans-effet` dit « rien n'a changé » sans prétendre savoir laquelle des deux
 * causes s'applique.
 */
export async function retirerExigence(
	client: ClientCrm,
	idTransition: string,
	idChamp: string,
): Promise<ResultatExigence> {
	return executerExigence(() =>
		client
			.from('workflow_transition_required_fields')
			.delete()
			.eq('transition_id', idTransition)
			.eq('field_id', idChamp)
			.select('field_id'),
	)
}

// ---------------------------------------------------------------------------------------------
// La prévisualisation des effets — docs/SPEC-workflow-engine.md §7 bis.13
// ---------------------------------------------------------------------------------------------
//
// @spec CRM-076 (docs/BACKLOG.md) — sixième tranche : la prévisualisation des effets
// @spec docs/SPEC-workflow-engine.md §7 bis.13.1 (les DEUX effets), §7 bis.13.2 (le compte est
//       fait par la base), §7 bis.13.3 (contrat et refus), §7 bis.13.4 (ce que l'écran en fait)
//
// RIEN N'EST COMPTÉ ICI. Le module APPELLE `previsualiser_exigence` et met en forme ce qu'elle
// rend. Recompter côté navigateur aurait dupliqué `app.valeur_de_champ_est_vide` — vingt-quatre
// points de code d'espaces —, exigé une lecture non bornée des affaires et de leurs valeurs, et
// annoncé un nombre que la RLS de l'appelant ne recouvre pas nécessairement (§7 bis.13.2).

/** Ce que la base rend pour un couple champ × cible, tel quel. */
export type EffetsExigence = {
	/** Affaires DÉJÀ à l'étape visée : leur fiche signalera un manque, sans les chasser (§5.7). */
	readonly surPlace: number
	/** Affaires qui ne pourraient plus entrer par un chemin menant à la cible. */
	readonly aLEntree: number
}

/**
 * Résultat d'une prévisualisation.
 *
 * `indisponible` N'EST PAS UNE ERREUR BLOQUANTE, et c'est une décision d'écran autant que de
 * module (§7 bis.13.4) : le compte est une aide à la décision, jamais une garde — la garde est
 * dans `move_card`. Un échec de prévisualisation laisse donc le geste possible, et l'écran écrit
 * que l'effet n'a pas pu être mesuré plutôt que d'inventer un zéro rassurant.
 */
export type ResultatPrevisualisation =
	| { readonly statut: 'mesure'; readonly effets: EffetsExigence }
	| { readonly statut: 'indisponible' }

/** Cible de la prévisualisation : une étape OU une transition, jamais les deux (§7 bis.13.3). */
export type CiblePrevisualisation =
	| { readonly genre: 'etape'; readonly idEtape: string }
	| { readonly genre: 'transition'; readonly idTransition: string }

/**
 * Demande à la base ce qu'une exigence ferait aux affaires en cours.
 *
 * L'APPEL EST FAIT AU MOMENT DU GESTE, jamais d'avance : quarante-deux cases de grille et une
 * dizaine d'arêtes feraient autant d'appels pour des gestes qui n'auront pas lieu (§7 bis.13.4).
 *
 * Les deux paramètres de cible sont exclusifs et la base le vérifie elle-même : le type
 * `CiblePrevisualisation` empêche l'erreur à la compilation, et `previsualisation_cible` la
 * rattraperait à l'exécution.
 */
export async function previsualiserExigence(
	client: ClientCrm | null,
	idChamp: string,
	cible: CiblePrevisualisation,
): Promise<ResultatPrevisualisation> {
	if (client === null) return { statut: 'indisponible' }
	try {
		const reponse = await client.rpc('previsualiser_exigence', {
			p_field_id: idChamp,
			...(cible.genre === 'etape'
				? { p_step_id: cible.idEtape }
				: { p_transition_id: cible.idTransition }),
		})
		if (reponse.error !== null) return { statut: 'indisponible' }
		// La fonction rend une ligne unique ; une réponse vide serait un contrat rompu, et le
		// module refuse alors d'affirmer un zéro qu'il n'a pas lu.
		const ligne = (reponse.data ?? [])[0]
		if (ligne === undefined) return { statut: 'indisponible' }
		return {
			statut: 'mesure',
			effets: { surPlace: Number(ligne.sur_place), aLEntree: Number(ligne.a_l_entree) },
		}
	} catch {
		return { statut: 'indisponible' }
	}
}

/**
 * Ce que l'écran doit dire d'une prévisualisation, sous forme de clé et de nombres.
 *
 * LA COMPOSITION EST ICI, ET PAS DANS LE COMPOSANT, pour une raison de preuve : les six cas —
 * indisponible, aucun effet, l'un des deux nombres seul, les deux — se prouvent alors sans monter
 * un arbre React. Le composant ne fait plus que traduire la clé rendue.
 *
 * ZÉRO SE DIT EN TOUTES LETTRES (§7 bis.13.4) : `aucun-effet` est une phrase, jamais l'absence de
 * phrase — un bloc muet se lirait comme un chargement qui n'a pas abouti.
 */
export type MessageEffets =
	| { readonly cle: 'indisponible' }
	| { readonly cle: 'aucun-effet' }
	| { readonly cle: 'sur-place'; readonly surPlace: number }
	| { readonly cle: 'a-l-entree'; readonly aLEntree: number }
	| { readonly cle: 'les-deux'; readonly surPlace: number; readonly aLEntree: number }

export function composerMessageEffets(resultat: ResultatPrevisualisation): MessageEffets {
	if (resultat.statut === 'indisponible') return { cle: 'indisponible' }
	const { surPlace, aLEntree } = resultat.effets
	if (surPlace === 0 && aLEntree === 0) return { cle: 'aucun-effet' }
	if (aLEntree === 0) return { cle: 'sur-place', surPlace }
	if (surPlace === 0) return { cle: 'a-l-entree', aLEntree }
	return { cle: 'les-deux', surPlace, aLEntree }
}
