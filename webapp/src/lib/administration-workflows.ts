// @spec CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, première tranche
// @spec docs/SPEC-workflow-engine.md §7 bis.3 (ce que l'écran lit), §7 bis.4 (les six gestes),
//       §7 bis.5 (validation de forme), §7 bis.7 (ce que cette tranche ne livre pas)
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
