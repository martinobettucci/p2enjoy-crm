// @spec CRM-037 (docs/BACKLOG.md) — composition du formulaire conditionnel d'une étape, et la
//       saisie depuis la fiche
// @spec docs/SPEC-form-composer.md §4.1 (composition), §4.2 (trois destinations),
//       §4.3 (« renseigné »), §4.4 (champ exigé), §3.1 (défaut « visible »), §5 (archivage),
//       §4 bis.2 (un champ, une écriture), §4 bis.4 (ce qui est écrit et sa normalisation),
//       §4 bis.5 (vider), §4 bis.7 (dictionnaire fermé des refus), §4 bis.8 (mise à jour en place),
//       §4 bis.10 (contrat d'API mesuré), §6.9 (autorisations)
// @spec docs/SPEC-permissions-rls.md §4 (lecture par les membres du workspace)
// @spec docs/SPEC-webapp.md §6.3 (ce que la coquille lit), §6.4 (contrat asynchrone)
//
// Ce module ne rend rien : il **compose**. La séparation n'est pas un goût d'architecture — elle
// est ce qui rend la règle du §4.1 vérifiable sans navigateur, et ce qui permet au tableau de cas
// du §4.3 d'être exercé par un test unitaire d'un côté et par une preuve d'API de l'autre.
//
// Sans session, les requêtes rendent `200` et `[]` et l'écran affiche « card introuvable » : c'est
// le refus réel du backend. Avec la session restaurée par `CRM-009`, le même chargeur rend le
// formulaire réellement consenti ; aucune branche d'autorisation ne vit ici.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database, Json } from './database.types'
import type { ProfilAffiche } from './identites'
import type { ClientCrm } from './supabase'
import { estRenseigne } from './valeur-renseignee'

// Réexportés pour que le rendu et ses preuves n'aient qu'une seule porte d'entrée, alors que la
// définition elle-même vit dans un module sans React — la preuve d'API appartient à un autre
// projet TypeScript et ne peut pas importer un module du DOM (docs/SPEC-form-composer.md §4.3).
export { CAS_RENSEIGNE, estRenseigne, type CasRenseigne } from './valeur-renseignee'

/** Les trois visibilités de `docs/SPEC-form-composer.md` §3.1. */
export type Visibilite = 'hidden' | 'visible' | 'required'

/** Visibilité d'un couple champ × étape **en l'absence de règle** (§3.1). */
export const VISIBILITE_PAR_DEFAUT: Visibilite = 'visible'

/**
 * Ce que le rendu a besoin de savoir d'un champ, et rien de plus.
 *
 * `workspace_id`, `created_at` et `updated_at` ne sont pas demandés : une requête ne rapporte que
 * ce que l'écran montre. `archived_at` l'est, parce que le §4.2 en fait une **destination** —
 * un champ archivé qui porte une valeur reste consultable dans la section repliée (§5).
 */
export type ChampFormulaire = Pick<
	Database['public']['Tables']['form_fields']['Row'],
	'id' | 'key' | 'label' | 'type' | 'position' | 'options' | 'help_text' | 'archived_at'
>

export type RegleVisibilite = Pick<
	Database['public']['Tables']['form_field_rules']['Row'],
	'field_id' | 'step_id' | 'visibility'
>

export type ValeurChamp = Pick<
	Database['public']['Tables']['card_field_values']['Row'],
	'field_id' | 'value'
>

/** Colonnes réellement demandées. Exportées pour que les tests unitaires vérifient la requête. */
export const COLONNES_CHAMP = 'id, key, label, type, position, options, help_text, archived_at'
export const COLONNES_REGLE = 'field_id, step_id, visibility'
export const COLONNES_VALEUR = 'field_id, value'
// `workspace_id` est demandée depuis `CRM-043` : le panneau de commentaires doit l'envoyer à
// l'insertion, le générateur de types déclarant la colonne obligatoire faute de voir le trigger
// qui la dérive (docs/JOURNAL.md décision 200). L'écran ne l'affiche pas.
//
// LES CINQ COLONNES ET LES DEUX RELATIONS DE L'EN-TÊTE — CRM-040, docs/SPEC-cards.md §15.3. Elles
// élargissent CE `select` plutôt que d'en émettre un second : la fiche lit déjà sa card, et une
// requête de plus pour une donnée de la même ligne serait un aller-retour gratuit.
//
// La relation du responsable est nommée par sa CONTRAINTE, et ce n'est pas une préférence de
// style. MESURÉ, un `profiles(full_name)` nu est refusé en `PGRST201` : trois clés étrangères de
// `cards` désignent `profiles` — `owner_id`, `created_by`, `deleted_by` —, et PostgREST refuse de
// choisir. Celle du workspace n'est pas ambiguë et s'écrit donc simplement.
//
// ELLE EST ÉCRITE D'UN SEUL TENANT, et ce n'est pas un choix de mise en forme : une concaténation
// `'a' + 'b'` rend le type `string`, et `supabase-js` cesse alors d'inférer la forme de la réponse
// — MESURÉ, `lireCard` retombait sur `GenericStringError`. Le littéral doit rester entier.
export const COLONNES_CARD_FORMULAIRE =
	'id, title, workflow_id, workspace_id, current_step_id, email_local_part, amount, currency, next_action, next_action_at, archived_at, snoozed_until, profiles!cards_owner_id_fkey(id, full_name, avatar_url), workspaces(inbound_domain)'

/** L'étape courante, telle que la mention « requis pour passer à <étape> » a besoin de la nommer. */
export type EtapeCourante = {
	readonly id: string
	readonly label: string
}

/**
 * La card portant le formulaire, telle que l'écran a besoin de la connaître.
 *
 * Les deux relations embarquées ne sont pas des colonnes de `Row` : elles sont **jointes** par le
 * `select` ci-dessus, et se déclarent donc à part. Chacune vaut `null` pour une raison qui lui est
 * propre — pas de responsable pour la première, workspace non consenti pour la seconde
 * (docs/SPEC-cards.md §15.3) —, et l'en-tête traite les deux cas.
 *
 * `inbound_domain` est NULLABLE en base, fait relevé par le compilateur et non supposé : un
 * workspace sans domaine entrant est un état licite, et l'adresse d'une card n'est alors pas
 * composable. C'est la troisième raison, avec le refus et l'absence, de ne rendre aucune adresse.
 */
export type CardOuverte = Pick<
	Database['public']['Tables']['cards']['Row'],
	| 'id'
	| 'title'
	| 'workflow_id'
	| 'workspace_id'
	| 'current_step_id'
	| 'email_local_part'
	| 'amount'
	| 'currency'
	| 'next_action'
	| 'next_action_at'
	| 'archived_at'
	// Lue depuis `CRM-081` tranche 2 a : la pastille de sommeil et le geste de réveil en dépendent
	// (docs/SPEC-cards.md §16.11). Elle reste FERMÉE en écriture — seuls `snooze_card` et
	// `wake_card` la déplacent (§16.7) —, et la lire ici n'ouvre donc aucun chemin d'écriture.
	| 'snoozed_until'
> & {
	readonly profiles: ProfilAffiche | null
	readonly workspaces: { readonly inbound_domain: string | null } | null
}

/**
 * Un champ **résolu** pour l'étape courante : ce que le composant rend, sans avoir à recroiser
 * quoi que ce soit. Le composant n'a aucune règle à appliquer — c'est tout l'objet de ce module.
 */
export type ChampResolu = {
	readonly champ: ChampFormulaire
	readonly visibilite: Visibilite
	/** `undefined` : aucune ligne. `null` : une ligne, vidée explicitement (§4.3, INC-054). */
	readonly valeur: Json | undefined
	readonly renseigne: boolean
	/** Exigé pour entrer dans l'étape courante, et donc **manquant** s'il n'est pas renseigné. */
	readonly manquant: boolean
	/**
	 * Nommé par le refus d'un déplacement, et rendu saisissable pour cette raison (§4 ter.4).
	 *
	 * C'est une propriété du **chemin d'arrivée**, jamais de la donnée : le même champ, ouvert
	 * sans `exiges` dans l'adresse, ne la porte pas.
	 */
	readonly exigeParDeplacement: boolean
}

/**
 * Le formulaire d'une étape, prêt à rendre.
 *
 * Trois listes disjointes, et non une liste et des drapeaux : le §4.2 décrit trois destinations,
 * et une répartition explicite empêche un composant de se tromper de règle d'affichage.
 */
export type ModeleFormulaire = {
	readonly etape: EtapeCourante
	/** Champs `visible` ou `required`, actifs, ordonnés par `position` (§4.1). */
	readonly champs: readonly ChampResolu[]
	/** Section repliée « Informations d'autres étapes » : `hidden` ou archivé, **et** renseigné. */
	readonly autresEtapes: readonly ChampResolu[]
	/** Clés des champs exigés et non renseignés, ordonnées par `position` (§4.4). */
	readonly clesManquantes: readonly string[]
	/**
	 * Clés RETENUES parmi celles que l'adresse portait, dans l'ordre du formulaire (§4 ter.3).
	 *
	 * Elle diffère de ce que l'adresse portait : une clé inconnue ou archivée est **ignorée**
	 * (§4 ter.7). C'est cette liste, et non celle de l'adresse, qui désigne « le premier champ »
	 * du défilement — sans quoi une adresse bricolée ferait viser un champ que rien ne rend.
	 */
	readonly clesExigeesRetenues: readonly string[]
}

/**
 * Compose le formulaire d'une étape, selon `docs/SPEC-form-composer.md` §4.1.
 *
 * L'algorithme part des **champs**, jamais des règles : le §3.1 pose que l'absence de règle vaut
 * `visible`, et une lecture par les règles perdrait tous les champs par défaut. MESURÉ sur le
 * seed : à l'étape `Prospection`, cinq règles pour six champs actifs — un champ sans règle, qui
 * doit apparaître.
 *
 * Les valeurs sont indexées une fois plutôt que cherchées par champ : la recherche linéaire dans
 * une liste de valeurs rendrait la composition quadratique sans rien apporter de lisible.
 */
export function composerFormulaire({
	champs,
	regles,
	valeurs,
	etape,
	clesExigees = [],
}: {
	readonly champs: readonly ChampFormulaire[]
	readonly regles: readonly RegleVisibilite[]
	readonly valeurs: readonly ValeurChamp[]
	readonly etape: EtapeCourante
	/** Clés nommées par le refus d'un déplacement, telles que l'adresse les porte (§4 ter.2). */
	readonly clesExigees?: readonly string[]
}): ModeleFormulaire {
	const parChamp = new Map<string, Json>()
	for (const valeur of valeurs) parChamp.set(valeur.field_id, valeur.value)

	const visibilites = new Map<string, Visibilite>()
	for (const regle of regles) {
		if (regle.step_id !== etape.id) continue
		visibilites.set(regle.field_id, lireVisibilite(regle.visibility))
	}

	const exigees = new Set(clesExigees)
	const ordonnes = [...champs].sort((a, b) => a.position - b.position)
	const actifs: ChampResolu[] = []
	const autres: ChampResolu[] = []

	for (const champ of ordonnes) {
		const visibilite = visibilites.get(champ.id) ?? VISIBILITE_PAR_DEFAUT
		const valeur = parChamp.has(champ.id) ? parChamp.get(champ.id) : undefined
		const renseigne = estRenseigne(valeur ?? undefined)
		const archive = champ.archived_at !== null
		// LA QUATRIÈME DESTINATION DU §4 ter.4, et elle est imposée par une mesure : sur le seed,
		// `motif-perte` est `hidden` à l'étape de départ dans DIX des dix-neuf couples
		// (affaire, transition) refusables, et un champ `hidden` non renseigné n'est rendu NULLE
		// PART par les trois destinations du §4.2. Sans cette règle, le refus nommerait un champ
		// que la fiche ne montre pas, et marquer une affaire perdue serait impossible.
		//
		// L'archivage garde sa primauté (§5, §4 ter.4) : la garde exclut déjà les champs archivés,
		// une clé archivée ne peut donc venir que d'une adresse écrite à la main.
		const exigeParDeplacement = !archive && exigees.has(champ.key)

		// Un champ archivé ne revient jamais dans le formulaire, quelle que soit sa règle (§5) :
		// exiger ou proposer un champ que l'archivage a retiré serait une impasse d'interface.
		if (archive || (visibilite === 'hidden' && !exigeParDeplacement)) {
			// Sans valeur, il n'y a rien à conserver : un champ masqué et vide n'a pas de place
			// dans la section repliée, qui existe pour ne perdre **aucune donnée saisie** (§4.2).
			if (renseigne) {
				autres.push({ champ, visibilite, valeur, renseigne, manquant: false, exigeParDeplacement: false })
			}
			continue
		}

		// `manquant` reste la lecture du §4.4 — exigé par l'étape COURANTE et vide —, et n'absorbe
		// pas l'exigence du déplacement : les deux mentions sont distinctes et coexistent (§4 ter.5).
		const manquant = visibilite === 'required' && !renseigne
		actifs.push({ champ, visibilite, valeur, renseigne, manquant, exigeParDeplacement })
	}

	return {
		etape,
		champs: actifs,
		autresEtapes: autres,
		clesManquantes: actifs.filter((resolu) => resolu.manquant).map((resolu) => resolu.champ.key),
		// Ordonnée par le formulaire, non par l'adresse : les deux ordres coïncident par
		// construction (§4 ter.3), et se fier à celui de l'adresse ferait dépendre le défilement
		// d'une chaîne que l'utilisateur peut réécrire.
		clesExigeesRetenues: actifs
			.filter((resolu) => resolu.exigeParDeplacement)
			.map((resolu) => resolu.champ.key),
	}
}

/**
 * Les clés portées par `?exiges=` de l'adresse (§4 ter.2), nettoyées.
 *
 * Séparateur `,`, espaces retirés, entrées vides écartées, doublons réduits — une adresse est un
 * texte que l'utilisateur peut réécrire, et le module ne suppose jamais qu'elle est bien formée.
 * Ce qui reste n'est PAS validé ici : c'est la composition qui écarte les clés inconnues et
 * archivées (§4 ter.7), parce qu'elle seule connaît les champs.
 */
export function lireClesExigees(brut: string | null | undefined): readonly string[] {
	if (brut === null || brut === undefined) return []
	const retenues: string[] = []
	for (const entree of brut.split(',')) {
		const cle = entree.trim()
		if (cle.length === 0 || retenues.includes(cle)) continue
		retenues.push(cle)
	}
	return retenues
}

/**
 * `visibility` arrive du backend en `text` : le type généré ne garantit aucune valeur
 * (`docs/SPEC-types.md`). Une valeur inconnue se replie sur le défaut du §3.1 plutôt que de faire
 * disparaître un champ — un repli qui **montre** vaut mieux qu'un repli qui masque.
 */
function lireVisibilite(brute: string): Visibilite {
	return brute === 'hidden' || brute === 'required' ? brute : VISIBILITE_PAR_DEFAUT
}

/** Ce que la route de détail d'une card a chargé. */
export type ContenuCard = {
	readonly card: CardOuverte | null
	readonly modele: ModeleFormulaire | null
}

/**
 * Lit une card par son identifiant.
 *
 * `card: null` **n'est pas une erreur** : c'est la réponse du backend à un appelant qui n'a pas le
 * droit de la voir comme à un identifiant qui n'existe pas. Les deux se ressemblent, et c'est
 * voulu — les distinguer renseignerait un appelant sans droit sur l'existence d'une card
 * (docs/SPEC-permissions-rls.md §7).
 */
export async function lireCard(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<CardOuverte | null>> {
	try {
		const reponse = await client
			.from('cards')
			.select(COLONNES_CARD_FORMULAIRE)
			.eq('id', idCard)
			.is('deleted_at', null)
			.limit(1)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data[0] ?? null)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Lit l'étape courante d'une card, avec le libellé de son nœud — c'est ce libellé que la mention
 * « requis pour passer à <étape> » nomme (§4.4), et non l'identifiant de l'étape.
 */
export async function lireEtape(
	client: ClientCrm,
	idEtape: string,
): Promise<EtatAsync<EtapeCourante | null>> {
	try {
		const reponse = await client
			.from('workflow_steps')
			.select('id, workflow_nodes_catalog(label)')
			.eq('id', idEtape)
			.limit(1)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const ligne = reponse.data[0]
		if (ligne === undefined) return pret(null)
		const noeud = ligne.workflow_nodes_catalog
		return pret({ id: ligne.id, label: noeud === null ? '' : noeud.label })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les champs d'un workflow, **archivés compris**.
 *
 * Le filtre `archived_at=is.null` des tracks et des channels serait faux ici : le §4.2 range un
 * champ archivé porteur d'une valeur dans la section repliée, et un filtre côté serveur le rendrait
 * inatteignable. C'est la composition qui écarte les champs archivés du formulaire, pas la requête.
 */
export async function lireChamps(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly ChampFormulaire[]>> {
	try {
		const reponse = await client
			.from('form_fields')
			.select(COLONNES_CHAMP)
			.eq('workflow_id', idWorkflow)
			.order('position')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les règles de visibilité de l'étape courante, et d'elle seule. */
export async function lireRegles(
	client: ClientCrm,
	idEtape: string,
): Promise<EtatAsync<readonly RegleVisibilite[]>> {
	try {
		const reponse = await client.from('form_field_rules').select(COLONNES_REGLE).eq('step_id', idEtape)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les valeurs saisies sur la card, tous champs confondus — la section repliée en a besoin. */
export async function lireValeurs(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<readonly ValeurChamp[]>> {
	try {
		const reponse = await client.from('card_field_values').select(COLONNES_VALEUR).eq('card_id', idCard)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Charge le contenu de la route de détail d'une card : la card, puis son étape, ses champs, ses
 * règles et ses valeurs.
 *
 * La première requête est **seule** tant que la card n'est pas connue : interroger `form_fields`
 * avec un `workflow_id` qu'on n'a pas n'aurait aucun sens, et émettre une requête dont on sait
 * qu'elle rendra `[]` est une requête de trop. Les trois suivantes sont en revanche **parallèles** :
 * elles ne dépendent que de la card, jamais l'une de l'autre.
 */
export function useContenuCard(
	client: ClientCrm | null,
	idCard: string | undefined,
	/**
	 * Clés nommées par le refus d'un déplacement (§4 ter.2), telles que l'adresse les porte.
	 *
	 * Elle entre dans la **composition**, jamais dans une requête : les champs sont déjà tous lus
	 * pour le workflow, et un filtre serveur de plus ne rapporterait rien de neuf.
	 */
	clesExigees: readonly string[] = [],
): {
	readonly etat: EtatAsync<ContenuCard>
	readonly recharger: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<ContenuCard>>(enChargement)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — l'identifiant change d'une card à l'autre.
	const courant = useRef(0)

	useEffect(() => {
		if (client === null || idCard === undefined) return
		const rang = ++courant.current
		setEtat(enChargement)
		void (async () => {
			const resultatCard = await lireCard(client, idCard)
			if (rang !== courant.current) return
			if (resultatCard.statut !== 'pret') {
				setEtat(resultatCard)
				return
			}
			const card = resultatCard.donnees
			if (card === null) {
				setEtat(pret({ card: null, modele: null }))
				return
			}
			const [resultatEtape, resultatChamps, resultatRegles, resultatValeurs] = await Promise.all([
				lireEtape(client, card.current_step_id),
				lireChamps(client, card.workflow_id),
				lireRegles(client, card.current_step_id),
				lireValeurs(client, card.id),
			])
			if (rang !== courant.current) return
			for (const resultat of [resultatEtape, resultatChamps, resultatRegles, resultatValeurs]) {
				if (resultat.statut === 'erreur') {
					setEtat(enErreur(resultat.erreur))
					return
				}
			}
			if (resultatEtape.statut !== 'pret' || resultatEtape.donnees === null) {
				// La card existe, son étape non : le backend a consenti l'une et refusé l'autre.
				// L'écran le dit par son état vide plutôt que d'inventer une étape sans nom.
				setEtat(pret({ card, modele: null }))
				return
			}
			if (resultatChamps.statut !== 'pret' || resultatRegles.statut !== 'pret') return
			if (resultatValeurs.statut !== 'pret') return
			setEtat(
				pret({
					card,
					modele: composerFormulaire({
						champs: resultatChamps.donnees,
						regles: resultatRegles.donnees,
						valeurs: resultatValeurs.donnees,
						etape: resultatEtape.donnees,
						clesExigees,
					}),
				}),
			)
		})()
		// `clesExigees` est reconstruite à chaque rendu par la lecture de l'adresse : la dépendance
		// porte donc sur sa forme TEXTUELLE, faute de quoi l'effet se rejouerait sans fin.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [client, idCard, tentative, clesExigees.join(',')])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger }
}

// ---------------------------------------------------------------------------------------------
// La saisie depuis la fiche — docs/SPEC-form-composer.md §4 bis
// ---------------------------------------------------------------------------------------------
//
// AUCUNE MIGRATION N'ACCOMPAGNE CETTE TRANCHE : `card_field_values`, ses trois politiques et son
// trigger de validation existent depuis `CRM-036`. Ce qui manquait était le **chemin** vers eux
// (§4 bis, décision 334, INC-088).

/**
 * Normalise une saisie d'écran en la valeur `jsonb` que le trigger de `CRM-036` attend (§4 bis.4).
 *
 * Un contrôle HTML ne rend que du texte, et `app.card_field_values_valider` refuse une chaîne là où
 * le type déclare un nombre ou un booléen — MESURÉ : `money` recevant `"douze mille"` rend `400`,
 * `P0001`, `invalid_field_value`. La conversion vit donc ici, une seule fois, et non dans le JSX.
 *
 * **Aucun `trim`, et c'est une décision (§4 bis.4).** Le §6.6 fait d'une chaîne de blancs une valeur
 * **vide au sens de « renseigné »** ; c'est une règle de lecture, pas d'écriture. Rogner à
 * l'écriture ferait diverger ce que l'utilisateur voit de ce que la base porte, et effacerait une
 * indentation dans une zone de texte. La base accepte la chaîne, `estRenseigne` la dit vide, et
 * l'écran marque le champ manquant : les trois lectures restent cohérentes.
 *
 * La case à cocher n'a **pas** d'état vide : décochée, elle vaut `false`, qui est une réponse
 * (§6.6). Toutes les autres saisies vides valent `null`, que le trigger accepte pour tous les types
 * — MESURÉ, `200` (§4 bis.5).
 */
export function normaliserSaisie(type: string, saisie: string | boolean | readonly string[]): Json {
	if (typeof saisie === 'boolean') return saisie
	if (Array.isArray(saisie)) return saisie.length === 0 ? null : [...saisie]
	const texte = saisie as string
	if (texte === '') return null
	if (type === 'number' || type === 'money') {
		const nombre = Number(texte)
		// Un `input type="number"` ne laisse pas produire une saisie non convertible : cette branche
		// protège les types repliés sur `text` (docs/SPEC-types.md) plutôt que de renvoyer un `NaN`,
		// que `JSON.stringify` transformerait silencieusement en `null` — donc en « vidé ».
		return Number.isFinite(nombre) ? nombre : texte
	}
	return texte
}

/**
 * Deux valeurs sont-elles la **même réponse** ? — la condition du §4 bis.3.
 *
 * `undefined` — aucune ligne — et `null` — une ligne vidée explicitement — sont ici **égaux** : ce
 * sont deux façons de n'avoir pas répondu (§6.6), et les distinguer ferait naître une ligne au
 * simple passage du focus sur un champ resté vide. Une écriture qui ne change rien ne doit produire
 * ni requête, ni événement `field_changed` dans le fil de `CRM-044`.
 *
 * La comparaison passe par `JSON.stringify` : les valeurs sont du `jsonb`, donc des arbres, et une
 * égalité de référence ne dirait rien d'un tableau de clés reconstruit à chaque rendu.
 */
export function memeValeur(avant: Json | undefined, apres: Json): boolean {
	return JSON.stringify(avant === undefined ? null : avant) === JSON.stringify(apres)
}

/** Nature d'un refus d'écriture de valeur — dictionnaire fermé du §4 bis.7. */
export type NatureRefusValeur =
	/** `400`, `P0001`, `invalid_field_value` : le trigger de `CRM-036` a refusé la valeur. */
	| 'invalid'
	/** `403`, `42501` : la politique d'écriture de `card_field_values` a refusé l'appelant. */
	| 'forbidden'
	/** Aucune réponse : la requête n'a jamais abouti. */
	| 'network'
	/** Tout le reste. L'interface ne prétend pas savoir. */
	| 'unknown'

export type RefusValeur = {
	readonly nature: NatureRefusValeur
	/** Message technique, destiné au diagnostic — jamais affiché tel quel (`CLAUDE.md` §20). */
	readonly detail: string
}

/**
 * Le message que `app.card_field_values_valider` lève pour toute valeur non conforme au type.
 *
 * Il est comparé au `message`, jamais au `details` : le premier est un identifiant stable écrit dans
 * la migration `0013`, le second est une phrase qui nomme le champ et peut changer sans préavis.
 */
export const MESSAGE_VALEUR_INVALIDE = 'invalid_field_value'

/**
 * Classe un refus d'écriture sur le code HTTP et le message d'erreur, jamais sur le texte libre.
 *
 * MESURÉ le 2026-08-16 avec les jetons réels (§4 bis.10) : `viewer` écrivant sur une card qu'il
 * **voit** rend `403` / `42501` ; `money` recevant une chaîne rend `400` / `P0001` /
 * `invalid_field_value`.
 */
export function classerRefusValeur(
	statutHttp: number | undefined,
	message: string,
): RefusValeur {
	if (statutHttp === 400 && message === MESSAGE_VALEUR_INVALIDE) {
		return { nature: 'invalid', detail: message }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail: message }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail: message }
	return { nature: 'unknown', detail: message }
}

export type ResultatEcriture =
	| { readonly statut: 'enregistree' }
	| { readonly statut: 'refus'; readonly refus: RefusValeur }

/** Ce qu'une écriture de valeur a besoin de connaître, et rien de plus. */
export type EcritureValeur = {
	readonly idCard: string
	readonly idChamp: string
	readonly idWorkflow: string
	readonly idWorkspace: string
	readonly valeur: Json
}

export const COLONNES_ECRITURE_VALEUR = 'card_id, field_id, workflow_id, workspace_id, value'

/**
 * Écrit la valeur d'un champ sur une card — le geste du §4 bis.
 *
 * C'EST UN `upsert`, PAS UN CHOIX ENTRE INSERTION ET MODIFICATION, et la mesure décide : `POST` d'un
 * couple absent rend `201`, le même `POST` avec `resolution=merge-duplicates` rend `200` sur un
 * couple existant. Un écran qui choisirait d'après ce qu'il a lu prendrait un `409` dès qu'une autre
 * écriture a eu lieu entre le chargement et la saisie — un refus que l'utilisateur n'a pas provoqué.
 * C'est le même motif qu'au §7 bis.11.3 de `docs/SPEC-workflow-engine.md`, et `onConflict` est écrit
 * plutôt que déduit pour que la clé qui porte l'unicité se lise dans l'appel.
 *
 * `workflow_id` et `workspace_id` viennent de la card **déjà chargée** (§4.6) : les relire serait
 * une requête pour une donnée en main.
 *
 * `updated_by` n'est PAS écrit (§4 bis.4). MESURÉ : le rôle `authenticated` porte le privilège sur
 * cette colonne et aucun trigger ne la dérive, mais la renseigner depuis le client serait une
 * déclaration et non une preuve. La trace faisant foi vient du serveur — `card_events` et son
 * `actor_id`, posé à partir de la session réelle.
 *
 * `select` accompagne l'écriture pour que le refus d'une politique se lise : sans lui, PostgREST ne
 * rend aucun corps.
 */
export async function ecrireValeur(
	client: ClientCrm,
	ecriture: EcritureValeur,
): Promise<ResultatEcriture> {
	try {
		const reponse = await client
			.from('card_field_values')
			.upsert(
				{
					card_id: ecriture.idCard,
					field_id: ecriture.idChamp,
					workflow_id: ecriture.idWorkflow,
					workspace_id: ecriture.idWorkspace,
					value: ecriture.valeur,
				},
				{ onConflict: 'card_id,field_id' },
			)
			.select('field_id')
		if (reponse.error !== null) {
			return { statut: 'refus', refus: classerRefusValeur(reponse.status, reponse.error.message) }
		}
		return { statut: 'enregistree' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusValeur(undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

/**
 * Rejoue la résolution d'un champ après une écriture confirmée — §4 bis.8.
 *
 * `renseigne` et `manquant` sont recalculés par le **même** prédicat que la composition, et non
 * recopiés : deux lectures de « renseigné » finiraient par diverger, ce que le §4.3 interdit
 * précisément. La visibilité, elle, ne dépend pas de la valeur et ne bouge donc pas.
 *
 * Aucun rechargement complet : il rejouerait cinq requêtes pour une donnée déjà connue et ferait
 * clignoter la colonne entière.
 */
export function resoudreApresEcriture(resolu: ChampResolu, valeur: Json): ChampResolu {
	const renseigne = estRenseigne(valeur ?? undefined)
	return {
		champ: resolu.champ,
		visibilite: resolu.visibilite,
		valeur,
		renseigne,
		manquant: resolu.visibilite === 'required' && !renseigne,
		// L'exigence du déplacement vient du CHEMIN D'ARRIVÉE, pas de la valeur (§4 ter.4) : la
		// renseigner ne l'annule pas. L'effacer ferait disparaître la mise en évidence sous les
		// doigts de celui qui vient de saisir, et l'écran cesserait de dire pourquoi il l'a menée là.
		exigeParDeplacement: resolu.exigeParDeplacement,
	}
}

/**
 * Remplace un champ du formulaire de l'étape courante par sa version résolue après écriture, et
 * recalcule les clés manquantes du modèle (§4.4).
 *
 * La **section repliée** n'est pas touchée : elle ne porte que des champs que l'étape courante ne
 * montre pas, et aucun d'eux n'est modifiable (§4 bis.1).
 */
export function appliquerEcriture(
	modele: ModeleFormulaire,
	idChamp: string,
	valeur: Json,
): ModeleFormulaire {
	const champs = modele.champs.map((resolu) =>
		resolu.champ.id === idChamp ? resoudreApresEcriture(resolu, valeur) : resolu,
	)
	return {
		etape: modele.etape,
		champs,
		autresEtapes: modele.autresEtapes,
		clesManquantes: champs.filter((resolu) => resolu.manquant).map((resolu) => resolu.champ.key),
		// Inchangée par une écriture : elle décrit ce que l'adresse a demandé, pas ce qui est saisi.
		clesExigeesRetenues: modele.clesExigeesRetenues,
	}
}
