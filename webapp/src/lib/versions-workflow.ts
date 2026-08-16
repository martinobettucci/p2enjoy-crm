// @spec CRM-078 (docs/BACKLOG.md) — cinquième tranche : les écrans du versionnement
// @spec docs/SPEC-workflow-engine.md §7 ter.14.3 (lecture 8 et son profil embarqué),
//       §7 ter.14.4 (les quatre gestes), §7 ter.14.5 (les instructions portent sur les étapes
//       retirées), §7 ter.14.6 (nommer un élément sans l'inventer), §7 ter.14.7 (dictionnaire
//       fermé des refus), §7 ter.14.8 (ce que la tranche ne livre pas)
// @spec docs/SPEC-workflow-engine.md §7 ter.3 (modèle des versions), §7 ter.5 (publication et ses
//       cinq refus), §7 ter.11.3 et §7 ter.11.4 (comparaison, sa forme et ses quatre refus),
//       §7 ter.12.4, §7 ter.12.6 et §7 ter.12.7 (plan, sa forme, sa borne et ses huit refus),
//       §7 ter.13.6 et §7 ter.13.8 (restauration, ses refus et sa forme)
// @spec docs/SCHEMA.md §9 (fonctions publiques) ; docs/DESIGN_SYSTEM.md §5.15 (bloc des versions)
//
// RIEN N'EST CALCULÉ ICI. Le module lit `workflow_versions` et APPELLE les quatre fonctions ; il
// met en forme ce qu'elles rendent. Recalculer un diff ou un plan dans le navigateur serait une
// seconde formulation d'une règle qui n'existe qu'en base, et le plan y serait de surcroît borné
// par ce que la RLS de l'appelant consent à lire (§7 ter.12.4).
//
// AUCUN DROIT N'EST CALCULÉ ICI non plus : les quatre gestes partent, et le refus du backend est
// classé puis traduit par l'écran (CLAUDE.md §10).

import type { Json } from './database.types'
import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Lecture 8 — la liste des versions
// ---------------------------------------------------------------------------------------------

/**
 * Colonnes de la lecture 8 (§7 ter.14.3).
 *
 * Le profil est **embarqué** en nommant explicitement la clé étrangère : sans ce nommage,
 * PostgREST rend `300`, `profiles` étant atteignable par plusieurs chemins (règle déjà mesurée par
 * `CRM-077`, `docs/DESIGN_SYSTEM.md` §5.16).
 *
 * `composition` est lue avec la ligne : le §7 ter.14.5 y prend les étapes proposées comme
 * destination de remappage, seul endroit où une étape que la base ne porte plus est encore nommée.
 */
export const COLONNES_VERSION =
	'id, version_number, note, published_at, composition_fingerprint, composition, ' +
	'auteur:profiles!workflow_versions_published_by_fkey(full_name)'

export type VersionWorkflow = {
	readonly id: string
	readonly version_number: number
	readonly note: string | null
	readonly published_at: string
	readonly composition_fingerprint: string
	/** Nom complet du publiant, ou `null` — profil supprimé, ou publication par la clé de service. */
	readonly auteur: string | null
	/** Le document conservé, tel quel (§7 ter.2). */
	readonly composition: Json
}

type LigneVersion = {
	readonly id: string
	readonly version_number: number
	readonly note: string | null
	readonly published_at: string
	readonly composition_fingerprint: string
	readonly composition: Json
	readonly auteur: { readonly full_name: string | null } | null
}

/** Lit les versions d'un workflow, la plus récente d'abord (§7 ter.14.3). */
export async function lireVersions(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly VersionWorkflow[]>> {
	try {
		const reponse = await client
			.from('workflow_versions')
			.select(COLONNES_VERSION)
			.eq('workflow_id', idWorkflow)
			.order('version_number', { ascending: false })
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lues = (reponse.data ?? []) as unknown as readonly LigneVersion[]
		// Les colonnes sont NORMALISÉES et non recopiées : le type décrit ce que PostgREST rend,
		// il ne le garantit pas (`docs/SPEC-types.md`). Une ligne amputée d'une colonne rendrait
		// `undefined` à l'écran, ce que ce module s'interdit partout ailleurs.
		return pret(
			lues.map((ligne) => ({
				id: texte(ligne.id) ?? '',
				version_number: nombre(ligne.version_number),
				note: texte(ligne.note),
				published_at: texte(ligne.published_at) ?? '',
				composition_fingerprint: texte(ligne.composition_fingerprint) ?? '',
				auteur: texte(ligne.auteur?.full_name),
				composition: ligne.composition ?? null,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les deux versions proposées d'office à la comparaison (§7 ter.14.4).
 *
 * Cible = la plus récente, base = la précédente. **Une seule version rend deux fois la même**, ce
 * que le §7 ter.11.3 accepte explicitement et qui rend `identical` : le refuser obligerait l'écran
 * à tester l'égalité avant d'appeler, exactement ce que la fonction dispense de faire.
 */
export function choixParDefaut(versions: readonly VersionWorkflow[]): {
	readonly base: string | null
	readonly cible: string | null
} {
	const cible = versions[0]
	if (cible === undefined) return { base: null, cible: null }
	const base = versions[1] ?? cible
	return { base: base.id, cible: cible.id }
}

// ---------------------------------------------------------------------------------------------
// Les refus, dictionnaire fermé — §7 ter.14.7
// ---------------------------------------------------------------------------------------------

/**
 * Ce que l'écran a le droit de dire d'un refus.
 *
 * `generique` est le repli, et il est **obligatoire** : afficher le message brut de la base ferait
 * lire à un humain un texte d'API, et le `detail` nomme des identifiants (§7 ter.13.6).
 */
export type RefusVersion =
	| 'composition-inchangee'
	| 'workflow-archive'
	| 'introuvable'
	| 'administrateurs'
	| 'workflows-differents'
	| 'plan-non-applicable'
	| 'structure-modifiee'
	| 'remappage-refuse'
	| 'limite-invalide'
	| 'generique'

/** Les messages exacts que les quatre fonctions lèvent, sans accent, tels que la base les écrit. */
const MESSAGES: Readonly<Record<string, RefusVersion>> = {
	'composition inchangee': 'composition-inchangee',
	'workflow archive': 'workflow-archive',
	'workflow introuvable': 'introuvable',
	'version introuvable': 'introuvable',
	'publication reservee aux administrateurs': 'administrateurs',
	'plan reserve aux administrateurs': 'administrateurs',
	'restauration reservee aux administrateurs': 'administrateurs',
	'versions de workflows differents': 'workflows-differents',
	'plan non applicable': 'plan-non-applicable',
	'structure modifiee depuis le plan': 'structure-modifiee',
	'remappage invalide': 'remappage-refuse',
	'remappage ambigu': 'remappage-refuse',
	'origine de remappage inconnue': 'remappage-refuse',
	'cible de remappage absente de la version': 'remappage-refuse',
	'limite invalide': 'limite-invalide',
	'authentification requise': 'administrateurs',
	'noeud de catalogue introuvable': 'generique',
}

/**
 * Classe un refus par son message, jamais par son code.
 *
 * Le `SQLSTATE` ne suffirait pas : sept refus de la restauration partagent `P0001` et ne disent
 * pas la même chose. Le message est comparé après `btrim` et en minuscules — la base les écrit
 * sans accent et en minuscules, et une comparaison stricte casserait au premier espace de trop.
 */
export function classerRefusVersion(message: string | null | undefined): RefusVersion {
	if (message === null || message === undefined) return 'generique'
	return MESSAGES[message.trim().toLowerCase()] ?? 'generique'
}

/** Issue d'un geste : le document rendu, ou le refus classé. */
export type Issue<T> =
	| { readonly statut: 'ok'; readonly donnees: T }
	| { readonly statut: 'refus'; readonly refus: RefusVersion }

/** Enveloppe commune aux quatre appels : un refus est classé, jamais propagé brut. */
async function appeler<T>(
	// `PromiseLike` et non `Promise` : le constructeur de requête de `supabase-js` est un
	// « thenable » qui n'émet la requête qu'à l'`await`, et n'expose ni `catch` ni `finally`.
	appel: () => PromiseLike<{
		data: unknown
		error: { message: string } | null
	}>,
	lire: (brut: unknown) => T | null,
): Promise<Issue<T>> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return { statut: 'refus', refus: classerRefusVersion(reponse.error.message) }
		}
		const donnees = lire(reponse.data)
		// Un document que le module ne sait pas lire n'est pas un succès muet : la base a bien
		// répondu, mais l'écran n'a rien à montrer, et le dire vaut mieux que rendre un objet vide.
		if (donnees === null) return { statut: 'refus', refus: 'generique' }
		return { statut: 'ok', donnees }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusVersion(cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Lecture défensive du `jsonb` rendu
// ---------------------------------------------------------------------------------------------
//
// Les trois gestes rendent un `jsonb` typé `Json` : le compilateur n'en garantit aucune clé. Ces
// accesseurs ne lèvent jamais et ne rendent jamais `undefined` — `docs/DESIGN_SYSTEM.md` §5.11 :
// aucun `undefined` n'atteint l'écran.

function objet(valeur: unknown): Readonly<Record<string, unknown>> | null {
	if (typeof valeur !== 'object' || valeur === null || Array.isArray(valeur)) return null
	return valeur as Readonly<Record<string, unknown>>
}

function tableau(valeur: unknown): readonly unknown[] {
	return Array.isArray(valeur) ? valeur : []
}

function nombre(valeur: unknown): number {
	return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : 0
}

function texte(valeur: unknown): string | null {
	if (typeof valeur !== 'string') return null
	const propre = valeur.trim()
	return propre === '' ? null : propre
}

function booleen(valeur: unknown): boolean {
	return valeur === true
}

// ---------------------------------------------------------------------------------------------
// Publier — §7 ter.5
// ---------------------------------------------------------------------------------------------

/**
 * Publie la composition vivante en version.
 *
 * La note n'est **pas** validée par l'écran : la base la `btrim`e et enregistre `NULL` si elle est
 * vide (§7 ter.5), donc il n'y a aucune réponse connue d'avance à économiser (§7 bis.5). Elle
 * n'est transmise que lorsqu'elle porte quelque chose : omettre et passer `null` sont équivalents
 * pour la fonction, mais l'omission dit mieux ce que l'écran sait.
 */
export async function publierVersion(
	client: ClientCrm,
	idWorkflow: string,
	note: string,
): Promise<Issue<{ readonly version_number: number }>> {
	const propre = note.trim()
	return appeler(
		() =>
			client.rpc('publish_workflow_version', {
				target_workflow_id: idWorkflow,
				...(propre === '' ? {} : { note: propre }),
			}),
		(brut) => {
			const ligne = objet(brut)
			if (ligne === null) return null
			return { version_number: nombre(ligne['version_number']) }
		},
	)
}

// ---------------------------------------------------------------------------------------------
// Comparer — §7 ter.11.3, §7 ter.11.4, §7 ter.14.6
// ---------------------------------------------------------------------------------------------

/** Les six collections du document de comparaison, dans l'ordre où l'écran les rend. */
export const COLLECTIONS = [
	'workflow',
	'steps',
	'transitions',
	'fields',
	'rules',
	'required_fields',
] as const

export type CleCollection = (typeof COLLECTIONS)[number]

/**
 * Le nom affiché d'un élément (§7 ter.14.6).
 *
 * `identifiants` est le dernier repli, et il est rendu en `code` par l'écran : mieux vaut un
 * identifiant qu'une phrase à trou.
 */
export type NomElement =
	| { readonly genre: 'libelle'; readonly texte: string }
	| { readonly genre: 'renomme'; readonly avant: string; readonly apres: string }
	| { readonly genre: 'identifiants'; readonly valeurs: readonly string[] }

export type AttributModifie = {
	readonly nom: string
	readonly avant: string | null
	readonly apres: string | null
}

export type ElementCompare = {
	readonly genre: 'ajout' | 'retrait' | 'modification'
	readonly cle: string
	readonly nom: NomElement
	/** Vide pour un ajout et un retrait ; au moins un attribut pour une modification. */
	readonly attributs: readonly AttributModifie[]
}

export type CollectionCompare = {
	readonly cle: CleCollection
	readonly elements: readonly ElementCompare[]
}

export type BorneComparaison = {
	readonly version_id: string
	readonly version_number: number
	readonly published_at: string | null
	readonly composition_fingerprint: string | null
}

export type Comparaison = {
	readonly base: BorneComparaison
	readonly cible: BorneComparaison
	readonly identique: boolean
	readonly resume: {
		readonly ajouts: number
		readonly retraits: number
		readonly modifications: number
	}
	readonly collections: readonly CollectionCompare[]
}

/**
 * Les clés du document qui portent un libellé lisible, par ordre de préférence.
 *
 * `node_key` A ÉTÉ AJOUTÉE EN DERNIER, ET C'EST UNE RÉVISION MOTIVÉE — mécanisme de la décision 51,
 * `docs/SPEC-workflow-engine.md` §4 quater.5. La comparaison copie ↔ source rend un document
 * NATURALISÉ dont les étapes ne portent ni `node_label` ni `key`, mais `node_key` : une étape
 * présente dans la source et absente de la copie — donc introuvable dans la structure vivante de
 * cette dernière — se rendait par un UUID brut alors que le document portait `"prospection"`.
 *
 * La place en FIN de liste est ce qui rend le changement sûr pour `CRM-078` : elle n'est consultée
 * que là où toutes les autres ont échoué, c'est-à-dire là où le nommage rendait déjà des
 * identifiants bruts. Elle ne peut donc que remplacer un UUID par une clé lisible, jamais changer un
 * libellé déjà juste.
 */
const CLES_LIBELLE = ['label_override', 'node_label', 'label', 'name', 'title', 'key', 'node_key'] as const

/** Les attributs dont le changement RENOMME l'élément, et permet donc de le nommer (§7 ter.14.6). */
const ATTRIBUTS_LIBELLE = new Set<string>(['label_override', 'node_label', 'label', 'name', 'title'])

function libelleDuDocument(element: Readonly<Record<string, unknown>> | null): string | null {
	if (element === null) return null
	for (const cle of CLES_LIBELLE) {
		const valeur = texte(element[cle])
		if (valeur !== null) return valeur
	}
	return null
}

function valeursIdentite(identite: Readonly<Record<string, unknown>> | null): readonly string[] {
	if (identite === null) return []
	return Object.keys(identite)
		.sort()
		.map((cle) => texte(identite[cle]) ?? String(identite[cle]))
}

/**
 * Nomme un élément selon les quatre replis du §7 ter.14.6.
 *
 * `structure` porte les libellés déjà chargés par l'éditeur — étapes et champs vivants. Elle est
 * le TROISIÈME repli, jamais le premier : le document rendu par la fonction est la seule source
 * qui nomme ce que la base ne porte plus.
 */
export function nommerElement(
	element: Readonly<Record<string, unknown>> | null,
	identite: Readonly<Record<string, unknown>> | null,
	attributs: readonly AttributModifie[],
	structure: ReadonlyMap<string, string>,
): NomElement {
	const duDocument = libelleDuDocument(element)
	if (duDocument !== null) return { genre: 'libelle', texte: duDocument }

	const renommage = attributs.find((attribut) => ATTRIBUTS_LIBELLE.has(attribut.nom))
	if (renommage !== undefined && (renommage.avant !== null || renommage.apres !== null)) {
		return {
			genre: 'renomme',
			avant: renommage.avant ?? '',
			apres: renommage.apres ?? '',
		}
	}

	const valeurs = valeursIdentite(identite)
	// Une identité SIMPLE se résout sur la structure vivante ; une identité COMPOSÉE — une règle,
	// un champ requis — ne se résout pas en un nom, et rend ses identifiants plutôt qu'une phrase
	// à trou (§7 ter.14.6).
	if (valeurs.length === 1) {
		const vivant = structure.get(valeurs[0] as string)
		if (vivant !== undefined) return { genre: 'libelle', texte: vivant }
	}
	return { genre: 'identifiants', valeurs }
}

function lireAttributs(brut: unknown): readonly AttributModifie[] {
	return tableau(brut)
		.map((entree) => {
			const attribut = objet(entree)
			if (attribut === null) return null
			const nom = texte(attribut['name'])
			if (nom === null) return null
			return {
				nom,
				avant: rendreValeur(attribut['before']),
				apres: rendreValeur(attribut['after']),
			}
		})
		.filter((attribut): attribut is AttributModifie => attribut !== null)
}

/**
 * Rend une valeur d'attribut en texte, ou `null` lorsqu'elle est absente.
 *
 * `null` et `"null"` ne se confondent pas : le premier est rendu « aucune valeur » par l'écran
 * (`docs/DESIGN_SYSTEM.md` §5.15), le second est une chaîne que quelqu'un a saisie.
 */
export function rendreValeur(valeur: unknown): string | null {
	if (valeur === null || valeur === undefined) return null
	if (typeof valeur === 'string') return valeur
	if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur)
	return JSON.stringify(valeur)
}

function lireBorne(brut: unknown): BorneComparaison | null {
	const borne = objet(brut)
	if (borne === null) return null
	const identifiant = texte(borne['version_id'])
	if (identifiant === null) return null
	return {
		version_id: identifiant,
		version_number: nombre(borne['version_number']),
		published_at: texte(borne['published_at']),
		composition_fingerprint: texte(borne['composition_fingerprint']),
	}
}

/**
 * Met en forme le `changes` d'un document de comparaison, quelles que soient ses collections.
 *
 * ELLE EST PARTAGÉE PAR LES DEUX COMPARAISONS DU PRODUIT, et c'est délibéré : celle des versions
 * (§7 ter.11.4) et celle de la copie ↔ sa source (§4 ter.6) rendent EXACTEMENT la même forme de
 * `changes` — mesuré, `docs/SPEC-workflow-engine.md` §4 quater.5 — et n'en diffèrent que par leurs
 * bornes et par la liste de leurs collections. Deux mises en forme seraient deux occasions de
 * diverger, exactement le défaut que l'extraction d'`app.composition_collection_diff` a corrigé
 * côté base (§4 ter.4).
 *
 * `modified` NE PORTE PAS `element`, et le nommage en dépend : la mesure du §4 quater.5 le montre —
 * une modification porte `identity` et `attributes`, jamais `element`. `nommerElement` reçoit donc
 * `null` et se rabat sur le renommage lisible, puis sur la structure vivante, puis sur les
 * identifiants.
 */
export function composerCollections<C extends string>(
	changements: Readonly<Record<string, unknown>> | null,
	collections: readonly C[],
	structure: ReadonlyMap<string, string>,
): readonly { readonly cle: C; readonly elements: readonly ElementCompare[] }[] {
	return collections.map((cle) => {
		const collection = objet(changements?.[cle])
		const elements: ElementCompare[] = []
		for (const [genre, source] of [
			['ajout', 'added'],
			['retrait', 'removed'],
			['modification', 'modified'],
		] as const) {
			for (const [rang, entree] of tableau(collection?.[source]).entries()) {
				const element = objet(entree)
				if (element === null) continue
				const identite = objet(element['identity'])
				const attributs = genre === 'modification' ? lireAttributs(element['attributes']) : []
				elements.push({
					genre,
					cle: `${cle}-${genre}-${valeursIdentite(identite).join('-') || String(rang)}`,
					nom: nommerElement(objet(element['element']), identite, attributs, structure),
					attributs,
				})
			}
		}
		return { cle, elements }
	})
}

/** Met en forme le document rendu par `compare_workflow_versions` (§7 ter.11.4). */
export function composerComparaison(
	brut: unknown,
	structure: ReadonlyMap<string, string>,
): Comparaison | null {
	const document = objet(brut)
	if (document === null) return null
	const base = lireBorne(document['base'])
	const cible = lireBorne(document['target'])
	if (base === null || cible === null) return null
	const resume = objet(document['summary'])
	const changements = objet(document['changes'])

	const collections = composerCollections(changements, COLLECTIONS, structure)

	return {
		base,
		cible,
		identique: booleen(document['identical']),
		resume: {
			ajouts: nombre(resume?.['added']),
			retraits: nombre(resume?.['removed']),
			modifications: nombre(resume?.['modified']),
		},
		collections,
	}
}

/** Compare deux versions. L'orientation est celle des arguments (§7 ter.11.3). */
export async function comparerVersions(
	client: ClientCrm,
	idBase: string,
	idCible: string,
	structure: ReadonlyMap<string, string>,
): Promise<Issue<Comparaison>> {
	return appeler(
		() =>
			client.rpc('compare_workflow_versions', {
				base_version_id: idBase,
				target_version_id: idCible,
			}),
		(brut) => composerComparaison(brut, structure),
	)
}

// ---------------------------------------------------------------------------------------------
// Planifier — §7 ter.12.6, §7 ter.14.5
// ---------------------------------------------------------------------------------------------

export type EtapeRetiree = {
	readonly step_id: string
	readonly label: string | null
	readonly cards_total: number
	readonly cards_unresolved: number
	readonly target_step_id: string | null
}

export type EtapeRetablie = {
	readonly step_id: string
	readonly label: string | null
}

export type AffairePlan = {
	readonly card_id: string
	readonly title: string | null
	readonly state: 'active' | 'archived' | 'deleted'
	readonly current_step_id: string | null
	readonly target_step_id: string | null
	readonly resolution: 'unchanged' | 'remapped' | 'unresolved'
}

export type PlanRemappage = {
	readonly version: {
		readonly version_id: string
		readonly version_number: number
		readonly workflow_id: string | null
	}
	readonly applicable: boolean
	readonly resume: {
		readonly total: number
		readonly inchangees: number
		readonly remappees: number
		readonly nonResolues: number
		readonly etapesRetirees: number
		readonly etapesRetablies: number
	}
	readonly retirees: readonly EtapeRetiree[]
	readonly retablies: readonly EtapeRetablie[]
	readonly affaires: {
		readonly total: number
		readonly rendues: number
		readonly tronquee: boolean
		readonly items: readonly AffairePlan[]
	}
}

const ETATS_AFFAIRE = new Set(['active', 'archived', 'deleted'])
const RESOLUTIONS = new Set(['unchanged', 'remapped', 'unresolved'])

/** Met en forme le document rendu par `plan_card_remapping` (§7 ter.12.6). */
export function composerPlan(brut: unknown): PlanRemappage | null {
	const document = objet(brut)
	if (document === null) return null
	const version = objet(document['version'])
	const identifiant = texte(version?.['version_id'])
	if (identifiant === null) return null
	const resume = objet(document['summary'])
	const etapes = objet(document['steps'])
	const affaires = objet(document['cards'])

	return {
		version: {
			version_id: identifiant,
			version_number: nombre(version?.['version_number']),
			workflow_id: texte(version?.['workflow_id']),
		},
		applicable: booleen(document['ready']),
		resume: {
			total: nombre(resume?.['cards_total']),
			inchangees: nombre(resume?.['cards_unchanged']),
			remappees: nombre(resume?.['cards_remapped']),
			nonResolues: nombre(resume?.['cards_unresolved']),
			etapesRetirees: nombre(resume?.['steps_removed']),
			etapesRetablies: nombre(resume?.['steps_restored']),
		},
		retirees: tableau(etapes?.['removed'])
			.map((entree) => {
				const etape = objet(entree)
				const cle = texte(etape?.['step_id'])
				if (cle === null) return null
				return {
					step_id: cle,
					label: texte(etape?.['label']),
					cards_total: nombre(etape?.['cards_total']),
					cards_unresolved: nombre(etape?.['cards_unresolved']),
					target_step_id: texte(etape?.['target_step_id']),
				}
			})
			.filter((etape): etape is EtapeRetiree => etape !== null),
		retablies: tableau(etapes?.['restored'])
			.map((entree) => {
				const etape = objet(entree)
				const cle = texte(etape?.['step_id'])
				if (cle === null) return null
				return { step_id: cle, label: texte(etape?.['label']) }
			})
			.filter((etape): etape is EtapeRetablie => etape !== null),
		affaires: {
			total: nombre(affaires?.['total']),
			rendues: nombre(affaires?.['returned']),
			tronquee: booleen(affaires?.['truncated']),
			// L'ordre vient de la base et place les blocages en tête (§7 ter.12.7) : l'écran ne
			// retrie pas, sous peine de reléguer au-delà de la coupure ce qui empêche d'appliquer.
			items: tableau(affaires?.['items'])
				.map((entree) => {
					const affaire = objet(entree)
					const cle = texte(affaire?.['card_id'])
					if (cle === null) return null
					const etat = texte(affaire?.['state'])
					const resolution = texte(affaire?.['resolution'])
					return {
						card_id: cle,
						title: texte(affaire?.['title']),
						state: (etat !== null && ETATS_AFFAIRE.has(etat) ? etat : 'active') as
							AffairePlan['state'],
						current_step_id: texte(affaire?.['current_step_id']),
						target_step_id: texte(affaire?.['target_step_id']),
						resolution: (resolution !== null && RESOLUTIONS.has(resolution)
							? resolution
							: 'unresolved') as AffairePlan['resolution'],
					}
				})
				.filter((affaire): affaire is AffairePlan => affaire !== null),
		},
	}
}

/** Une instruction de remappage, telle que les deux fonctions l'attendent (§7 ter.12.3). */
export type Instruction = {
	readonly from_step_id: string
	readonly to_step_id: string
}

/**
 * Compose les instructions depuis les choix de l'écran.
 *
 * Une étape sans choix n'en produit AUCUNE : elle reste `unresolved`, et le produit dit « je ne
 * sais pas » plutôt que de choisir à la place de l'administrateur (§7 ter.14.5). Les instructions
 * sont ordonnées par `from_step_id` pour que deux compositions des mêmes choix soient égales — une
 * requête qui changerait d'ordre à chaque rendu rendrait toute preuve instable.
 */
export function composerInstructions(
	choix: ReadonlyMap<string, string>,
): readonly Instruction[] {
	return [...choix.entries()]
		.filter(([, cible]) => cible !== '')
		.map(([depart, cible]) => ({ from_step_id: depart, to_step_id: cible }))
		.sort((gauche, droite) => gauche.from_step_id.localeCompare(droite.from_step_id))
}

/**
 * Les étapes d'une version, telles que le document les conserve (§7 ter.14.5).
 *
 * C'est la seule liste dans laquelle une destination de remappage peut être choisie : la
 * vérification 8 du §7 ter.12.4 refuse toute `to_step_id` absente de la version.
 */
export function etapesDeLaVersion(
	version: VersionWorkflow | null,
): readonly { readonly id: string; readonly libelle: string }[] {
	const document = objet(version?.composition)
	return tableau(document?.['steps'])
		.map((entree) => {
			const etape = objet(entree)
			const identifiant = texte(etape?.['id'])
			if (identifiant === null) return null
			const libelle = texte(etape?.['label_override']) ?? texte(etape?.['node_label'])
			return { id: identifiant, libelle: libelle ?? identifiant }
		})
		.filter((etape): etape is { id: string; libelle: string } => etape !== null)
}

/** Demande le plan de remappage d'une version, avec les instructions déjà saisies. */
export async function planifierRemappage(
	client: ClientCrm,
	idVersion: string,
	instructions: readonly Instruction[],
): Promise<Issue<PlanRemappage>> {
	return appeler(
		() =>
			client.rpc('plan_card_remapping', {
				target_version_id: idVersion,
				// `card_limit` n'est pas transmis : le défaut de 200 est celui de la fonction, et
				// l'écran n'offre pas de le régler (§7 ter.14.4).
				...(instructions.length === 0
					? {}
					: { step_overrides: instructions as unknown as Json }),
			}),
		composerPlan,
	)
}

// ---------------------------------------------------------------------------------------------
// Restaurer — §7 ter.13.6, §7 ter.13.8
// ---------------------------------------------------------------------------------------------

export type Restauration = {
	readonly version: { readonly version_number: number }
	readonly pointDeRetour: {
		readonly version_number: number
		/** Vrai si CET appel l'a publié ; faux si une version jouait déjà ce rôle (§7 ter.13.5). */
		readonly publie: boolean
	}
	readonly affairesDeplacees: number
	readonly etapes: { readonly creees: number; readonly supprimees: number; readonly majes: number }
	readonly champs: {
		readonly crees: number
		readonly desarchives: number
		readonly archives: number
		readonly majes: number
	}
	/** Faux sans qu'aucune erreur n'ait eu lieu : l'identité n'est pas restaurée (§7 ter.13.8). */
	readonly conformeALaVersion: boolean
}

/** Met en forme le document rendu par `restore_workflow_version` (§7 ter.13.8). */
export function composerRestauration(brut: unknown): Restauration | null {
	const document = objet(brut)
	if (document === null) return null
	const version = objet(document['version'])
	if (texte(version?.['version_id']) === null) return null
	const retour = objet(document['rollback_version'])
	const etapes = objet(document['steps'])
	const champs = objet(document['fields'])

	return {
		version: { version_number: nombre(version?.['version_number']) },
		pointDeRetour: {
			version_number: nombre(retour?.['version_number']),
			publie: booleen(retour?.['published']),
		},
		affairesDeplacees: nombre(objet(document['cards'])?.['remapped']),
		etapes: {
			creees: nombre(etapes?.['created']),
			supprimees: nombre(etapes?.['deleted']),
			majes: nombre(etapes?.['updated']),
		},
		champs: {
			crees: nombre(champs?.['created']),
			desarchives: nombre(champs?.['unarchived']),
			archives: nombre(champs?.['archived']),
			majes: nombre(champs?.['updated']),
		},
		conformeALaVersion: booleen(document['matches_version']),
	}
}

/**
 * Restaure une version, avec les instructions saisies sur les étapes retirées.
 *
 * `expected_live_fingerprint` n'est PAS transmis, et le motif est mesuré : aucune RPC publique ne
 * rend l'empreinte vivante d'un workflow (§7 ter.13.10, ligne c ; §7 ter.14.8). La garde n'est pas
 * perdue pour autant — la fonction rejoue le plan dans sa propre transaction (§7 ter.13.2).
 */
export async function restaurerVersion(
	client: ClientCrm,
	idVersion: string,
	instructions: readonly Instruction[],
): Promise<Issue<Restauration>> {
	return appeler(
		() =>
			client.rpc('restore_workflow_version', {
				target_version_id: idVersion,
				...(instructions.length === 0
					? {}
					: { step_overrides: instructions as unknown as Json }),
			}),
		composerRestauration,
	)
}
