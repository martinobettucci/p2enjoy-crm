// @spec CRM-030 (docs/BACKLOG.md) — administration du catalogue de nœuds : ce que l'écran lit et
//       écrit
// @spec docs/SPEC-workflow-engine.md §2 bis.3 (la lecture unique, archivés compris), §2 bis.4 (les
//       quatre gestes), §2 bis.5 (les cinq refus mesurés), §2 bis.6 (validation de forme)
// @spec docs/SPEC-workflow-engine.md §2 ter.1 (le réordonnancement est une écriture d'une colonne),
//       §2 ter.4 (son contrat d'API mesuré), §2 ter.5 (ses refus, aucun nouveau)
// @spec docs/SPEC-workflow-engine.md §2.3 (la clé stable), §2.5 (probabilité et seuil, `0` ≠ `NULL`),
//       §2.6 (la garde d'archivage), §2.7 (autorisations)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec CLAUDE.md §10 (la règle est backend, l'écran traduit le refus qu'il reçoit)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE. Il lit et écrit `workflow_nodes_catalog` sous les
// trois politiques de `CRM-030`, inchangées depuis la migration 5 : lecture par tout membre du
// workspace, écriture réservée à l'administrateur.
//
// IL NE RECOPIE AUCUNE RÈGLE DE LA BASE. Les quatre validations de forme du §2 bis.6 sont des
// économies d'aller-retour, et chacune reste rattrapée par une contrainte : `key_check`,
// `label_check`, `default_probability_check`, `default_stale_after_days_check`.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { classerRefusEcriture, type RefusEcriture } from './administration-arborescence'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/**
 * Un nœud du catalogue, tel que l'écran d'administration le montre.
 *
 * `archived_at` EN FAIT PARTIE, contrairement à `NoeudAjoutable` de `administration-workflows.ts`
 * qui ne lit que le catalogue actif : le sélecteur d'ajout d'une étape ne doit pas proposer un nœud
 * retiré, mais l'écran d'où l'on RESTAURE ce nœud doit le montrer (§2 bis.3).
 */
export type NoeudCatalogue = Pick<
	Database['public']['Tables']['workflow_nodes_catalog']['Row'],
	| 'id'
	| 'workspace_id'
	| 'key'
	| 'label'
	| 'kind'
	| 'color'
	| 'default_probability'
	| 'default_stale_after_days'
	| 'position'
	| 'archived_at'
>

/** Colonnes réellement demandées. Exportée pour que les tests vérifient la requête émise. */
export const COLONNES_NOEUD =
	'id, workspace_id, key, label, kind, color, default_probability, default_stale_after_days, position, archived_at'

/**
 * Les trois types d'un nœud, et les cinq jetons de couleur.
 *
 * Ces listes sont celles des `CHECK` de la migration 5 (§2.2). Elles sont écrites ici pour PEUPLER
 * DEUX LISTES DÉROULANTES, jamais pour valider : une valeur hors liste ne peut pas être choisie
 * dans un `select`, et si elle l'était par un autre chemin, c'est la contrainte qui la refuserait.
 */
export const TYPES_NOEUD = ['open', 'won', 'lost'] as const
export const COULEURS_NOEUD = ['brand', 'success', 'accent', 'danger', 'neutral'] as const

export type TypeNoeud = (typeof TYPES_NOEUD)[number]
export type CouleurNoeud = (typeof COULEURS_NOEUD)[number]

/**
 * Lit le catalogue entier du workspace, actifs et archivés (§2 bis.3).
 *
 * AUCUN FILTRE DE WORKSPACE N'EST ÉCRIT : la politique de lecture borne déjà au workspace de
 * l'appelant (§2.7), et ajouter un `eq('workspace_id', …)` ferait croire que l'écran tient la règle.
 * Un appelant anonyme obtient `200` et zéro ligne, jamais une erreur — c'est ce que
 * `docs/SPEC-permissions-rls.md` §7 exige.
 *
 * L'ordre est `position` puis `label`, celui du §2 bis.3 : deux nœuds peuvent partager une position
 * — rien ne l'interdit en base —, et sans second critère leur ordre relatif changerait d'une lecture
 * à l'autre, ce qui ferait sauter des lignes sous les yeux de l'administrateur.
 */
export async function lireCatalogueAdministrable(
	client: ClientCrm,
): Promise<EtatAsync<readonly NoeudCatalogue[]>> {
	try {
		const reponse = await client
			.from('workflow_nodes_catalog')
			.select(COLONNES_NOEUD)
			.order('position', { ascending: true })
			.order('label', { ascending: true })
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data as readonly NoeudCatalogue[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les refus — §2 bis.5
// ---------------------------------------------------------------------------------------------

/**
 * Le refus propre à cet écran, celui qu'aucun autre ne reçoit : la garde d'archivage du §2.6.
 *
 * MESURÉ le 2026-08-16 : `403`, `42501`, message
 * `node_occupied : 4 card(s) active(s) se trouvent encore sur ce nœud`.
 *
 * IL PARTAGE SON SQLSTATE AVEC LE REFUS DE LA RLS, et c'est tout le problème. `classerRefusEcriture`
 * range les deux sous `forbidden` — ce qui est exact du point de vue du code —, alors qu'ils
 * appellent deux gestes opposés : l'un se rattrape en déplaçant des affaires, l'autre ne se rattrape
 * pas du tout. Les confondre serait la « valeur par défaut trompeuse » de `CLAUDE.md` §18.
 *
 * LA DISTINCTION SE FAIT SUR LE MESSAGE, et c'est le seul endroit du produit où le texte d'une
 * exception est lu. `administration-arborescence.ts` le refuse pour les `CHECK` et lit un nom de
 * contrainte à la place ; ici il n'y a pas de contrainte à nommer — l'exception est levée par un
 * trigger, et `node_occupied` est l'identifiant que la migration 11 lui donne. Le contrôle porte
 * donc sur ce jeton, pas sur la phrase française qui le suit, et une suite d'API le fige.
 */
export const JETON_NOEUD_OCCUPE = 'node_occupied'

export type NatureRefusCatalogue =
	/** La garde du §2.6 : des affaires actives occupent encore ce nœud. Rattrapable. */
	| 'noeud-occupe'
	/** `403`/`401` sans le jeton ci-dessus : la RLS. Seul un administrateur écrit (§2.7). */
	| 'forbidden'
	/** `23505` — la clé est déjà prise dans ce workspace (§2.3). */
	| 'cle-prise'
	/** `23514` — un `CHECK` de forme : clé malformée, libellé vide, borne dépassée (§2.3, §2.5). */
	| 'forme-refusee'
	/** `23503` — clé étrangère : le workspace a disparu. */
	| 'reference-absente'
	| 'network'
	| 'unknown'

export type RefusCatalogue = {
	readonly nature: NatureRefusCatalogue
	readonly detail: string
	/**
	 * Le nombre d'affaires actives, quand le refus est `noeud-occupe` et que le message le porte.
	 *
	 * `null` quand il ne le porte pas : l'écran écrit alors sa phrase sans compte plutôt que
	 * d'afficher un zéro, qui se lirait comme « aucune affaire » — exactement le refus qui n'aurait
	 * alors pas eu lieu.
	 */
	readonly affairesActives: number | null
}

/**
 * Extrait le compte d'affaires du message de la garde.
 *
 * Le motif est ancré sur le jeton et sur le premier nombre qui le suit ; il ne dépend ni de la
 * ponctuation, ni du reste de la phrase. Un message sans nombre rend `null`, pas `0`.
 */
export function compterAffairesOccupantes(message: string): number | null {
	const trouve = new RegExp(`${JETON_NOEUD_OCCUPE}\\D*(\\d+)`).exec(message)
	if (trouve === null) return null
	const compte = Number(trouve[1])
	return Number.isFinite(compte) ? compte : null
}

/**
 * Classe un refus d'écriture du catalogue.
 *
 * La garde est examinée AVANT tout le reste, et sur le message : un `42501` portant `node_occupied`
 * n'est pas un refus de droit. Tout le reste est délégué à `classerRefusEcriture` de `CRM-075`
 * plutôt que réécrit — les codes `23505`, `23514`, `23503` et les deux cas de transport y sont déjà
 * classés, et deux tables de correspondance auraient divergé.
 */
export function classerRefusCatalogue(
	statutHttp: number | undefined,
	code: string | undefined,
	message: string,
): RefusCatalogue {
	if (message.includes(JETON_NOEUD_OCCUPE)) {
		return {
			nature: 'noeud-occupe',
			detail: message,
			affairesActives: compterAffairesOccupantes(message),
		}
	}
	const refus: RefusEcriture = classerRefusEcriture(statutHttp, code, message)
	// `slug-pris` est le nom que `CRM-075` donne au `23505` ; ici la colonne unique est `key`, et le
	// mot change avec elle. `workflow-hors-track` ne peut pas survenir sur cette table — aucune de
	// ses contraintes ne porte ce nom —, et il est rabattu sur la forme refusée, qui est ce qu'un
	// `23514` est ici.
	const nature: NatureRefusCatalogue =
		refus.nature === 'slug-pris'
			? 'cle-prise'
			: refus.nature === 'workflow-hors-track'
				? 'forme-refusee'
				: refus.nature
	return { nature, detail: refus.detail, affairesActives: null }
}

/**
 * Résultat d'une écriture.
 *
 * `sans-effet` est repris de `CRM-075` sans changement de sens : le `USING` de la politique filtre
 * la ligne, PostgREST rend `200` et zéro ligne, et l'écran doit le dire au lieu d'afficher une
 * modification qui n'a pas eu lieu. MESURÉ sur cette table le 2026-08-16 avec le jeton du viewer
 * (§2 bis.5, dernière ligne).
 */
export type ResultatCatalogue =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusCatalogue }

/** Enveloppe commune : aucune écriture de ce module ne lève, toutes rendent un résultat classé. */
async function executer(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatCatalogue> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusCatalogue(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		// `select()` accompagne chaque écriture précisément pour que ce comptage existe : sans lui,
		// PostgREST ne rend aucun corps et « zéro ligne touchée » serait indistinguable d'un succès.
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusCatalogue(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Validation de forme — §2 bis.6
// ---------------------------------------------------------------------------------------------

/**
 * Une saisie numérique facultative, telle que le champ la rend.
 *
 * `vide` N'EST PAS `0`, et c'est la règle du §2.5 : un nœud peut ne pas se prononcer, ce qui diffère
 * de se prononcer à zéro — `perdu` vaut réellement `0 %`. Un `Number('')` valant `0`, une lecture
 * naïve du champ détruirait la distinction en silence, en base comme à l'œil.
 */
export type SaisieNumerique =
	| { readonly statut: 'vide' }
	| { readonly statut: 'valeur'; readonly valeur: number }
	| { readonly statut: 'illisible' }

export function lireSaisieNumerique(saisie: string): SaisieNumerique {
	const nettoyee = saisie.trim()
	if (nettoyee === '') return { statut: 'vide' }
	const valeur = Number(nettoyee)
	if (!Number.isFinite(valeur)) return { statut: 'illisible' }
	return { statut: 'valeur', valeur }
}

/** `0 ≤ x ≤ 100` — la contrainte `default_probability_check` (§2.5), lue depuis l'interface. */
export function probabiliteConforme(saisie: SaisieNumerique): boolean {
	if (saisie.statut === 'vide') return true
	if (saisie.statut === 'illisible') return false
	return saisie.valeur >= 0 && saisie.valeur <= 100
}

/**
 * `x > 0` — la contrainte `default_stale_after_days_check` (§2.5).
 *
 * L'entier est exigé ici alors que la base ne l'exige pas : la colonne est un `integer`, et une
 * valeur fractionnaire y serait refusée par le TYPE, avec un message qui ne dirait rien de la règle.
 * L'écran le dit avant l'aller-retour ; il ne remplace aucune garde.
 */
export function seuilRelanceConforme(saisie: SaisieNumerique): boolean {
	if (saisie.statut === 'vide') return true
	if (saisie.statut === 'illisible') return false
	return Number.isInteger(saisie.valeur) && saisie.valeur > 0
}

/** La valeur envoyée à la base : `null` pour une saisie vide, jamais `0` (§2.5). */
export function valeurNumeriqueEnvoyee(saisie: SaisieNumerique): number | null {
	return saisie.statut === 'valeur' ? saisie.valeur : null
}

// ---------------------------------------------------------------------------------------------
// Les écritures — §2 bis.4
// ---------------------------------------------------------------------------------------------

export type CreationNoeud = {
	readonly idWorkspace: string
	readonly cle: string
	readonly libelle: string
	readonly type: TypeNoeud
	readonly couleur: CouleurNoeud
	readonly probabilite: SaisieNumerique
	readonly seuilRelance: SaisieNumerique
}

/**
 * Crée un nœud.
 *
 * `position` EST ENVOYÉE À `null`, exactement comme `creerTrack` : le §2.4 pose qu'un trigger
 * `BEFORE INSERT` reçoit `new.position` à `NULL` que le client l'ait omise ou écrite, et qu'il place
 * alors le nœud en fin de liste de son workspace. L'assertion de type est nécessaire parce que le
 * générateur de `CRM-006` ne voit pas les triggers et déclare la colonne obligatoire — troisième
 * occurrence d'INC-027, figée par une assertion de type depuis `CRM-030`.
 */
export async function creerNoeud(
	client: ClientCrm,
	creation: CreationNoeud,
): Promise<ResultatCatalogue> {
	return executer(() =>
		client
			.from('workflow_nodes_catalog')
			.insert({
				workspace_id: creation.idWorkspace,
				key: creation.cle.trim(),
				label: creation.libelle.trim(),
				kind: creation.type,
				color: creation.couleur,
				default_probability: valeurNumeriqueEnvoyee(creation.probabilite),
				default_stale_after_days: valeurNumeriqueEnvoyee(creation.seuilRelance),
				position: null,
			} as unknown as Database['public']['Tables']['workflow_nodes_catalog']['Insert'])
			.select('id'),
	)
}

export type ModificationNoeud = {
	readonly libelle: string
	readonly type: TypeNoeud
	readonly couleur: CouleurNoeud
	readonly probabilite: SaisieNumerique
	readonly seuilRelance: SaisieNumerique
}

/**
 * Modifie un nœud — libellé, type, couleur et les deux valeurs par défaut.
 *
 * `key` N'Y FIGURE PAS, et ce n'est pas la base qui le refuse : elle l'accepte. C'est l'écran qui ne
 * l'expose pas, parce que le §2.1 fonde la comparabilité analytique sur cette clé — la renommer
 * réécrirait silencieusement l'histoire des cards passées par ce nœud. Même distinction que le slug
 * d'un track dans `modifierTrack` : « la base refuse » et « l'écran ne propose pas » ne se
 * confondent jamais (`CLAUDE.md` §10).
 */
export async function modifierNoeud(
	client: ClientCrm,
	id: string,
	modification: ModificationNoeud,
): Promise<ResultatCatalogue> {
	return executer(() =>
		client
			.from('workflow_nodes_catalog')
			.update({
				label: modification.libelle.trim(),
				kind: modification.type,
				color: modification.couleur,
				default_probability: valeurNumeriqueEnvoyee(modification.probabilite),
				default_stale_after_days: valeurNumeriqueEnvoyee(modification.seuilRelance),
			})
			.eq('id', id)
			.select('id'),
	)
}

/**
 * Archive un nœud, ou le désarchive.
 *
 * UNE SEULE FONCTION POUR LES DEUX SENS, alors que l'écran en fait deux commandes distinctes
 * (`docs/DESIGN_SYSTEM.md` §5.18) : c'est la même écriture sur la même colonne, et la seule
 * différence est la valeur. La garde du §2.6, elle, ne s'applique qu'à l'archivage — le désarchivage
 * n'est jamais refusé, et rien ici ne le prétend.
 *
 * L'horodatage vient du CLIENT, comme la mise à la corbeille d'une affaire (`docs/SPEC-corbeille.md`
 * §4 ter.6) : la colonne n'a pas de défaut et aucun trigger ne la renseigne.
 */
export async function archiverNoeud(
	client: ClientCrm,
	id: string,
	archive: boolean,
): Promise<ResultatCatalogue> {
	return executer(() =>
		client
			.from('workflow_nodes_catalog')
			.update({ archived_at: archive ? new Date().toISOString() : null })
			.eq('id', id)
			.select('id'),
	)
}

/**
 * Déplace un nœud : écrit la position que `calculerDeplacement` de `CRM-075` a calculée (§2 ter.2).
 *
 * UNE COLONNE, UNE LIGNE, UNE ÉCRITURE. La liste entière n'est jamais renumérotée : `position` est
 * une `numeric` précisément pour qu'un nœud s'insère entre deux autres sans toucher aux voisins
 * (§2.4). Le calcul n'est pas fait ici — il est fait par l'appelant, sur la liste AFFICHÉE, et cette
 * fonction ne connaît que son résultat.
 *
 * ELLE NE PEUT PAS RECEVOIR `node_occupied`, ET RIEN ICI NE L'EXCLUT. La garde du §2.6 est un
 * trigger `BEFORE UPDATE` sur toute la table, mais elle ne se déclenche qu'au passage d'`archived_at`
 * de `NULL` à une valeur. **Mesuré le 2026-08-16** (§2 ter.4 b) : déplacer `prospection`, que le seed
 * occupe de quatre affaires actives, rend `200`. Le classement reste malgré tout celui de
 * `classerRefusCatalogue`, qui garde ce cas : écarter d'avance un refus que la base pourrait un jour
 * rendre serait un contrôle d'interface (`CLAUDE.md` §10).
 *
 * Un `viewer` reçoit `200` et zéro ligne — le `USING` de la politique filtre la ligne —, ce que
 * `executer` traduit en `sans-effet` (§2 ter.4 c). Jamais un succès.
 */
export async function deplacerNoeud(
	client: ClientCrm,
	id: string,
	position: number,
): Promise<ResultatCatalogue> {
	return executer(() =>
		client.from('workflow_nodes_catalog').update({ position }).eq('id', id).select('id'),
	)
}
