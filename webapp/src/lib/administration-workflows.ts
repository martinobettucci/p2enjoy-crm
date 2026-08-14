// @spec CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première et deuxième
//       tranches
// @spec docs/SPEC-workflow-engine.md §7 bis.3 (ce que l'écran lit), §7 bis.4 (les six gestes),
//       §7 bis.5 (validation de forme), §7 bis.7 (ce que cette tranche ne livre pas),
//       §7 bis.9 (deuxième tranche : l'édition des transitions), §3.4 (modèle des arêtes)
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
