// @spec CRM-037 (docs/BACKLOG.md) — composition du formulaire conditionnel d'une étape
// @spec docs/SPEC-form-composer.md §4.1 (composition), §4.2 (trois destinations),
//       §4.3 (« renseigné »), §4.4 (champ exigé), §3.1 (défaut « visible »), §5 (archivage)
// @spec docs/SPEC-permissions-rls.md §4 (lecture par les membres du workspace)
// @spec docs/SPEC-webapp.md §6.3 (ce que la coquille lit), §6.4 (contrat asynchrone)
//
// Ce module ne rend rien : il **compose**. La séparation n'est pas un goût d'architecture — elle
// est ce qui rend la règle du §4.1 vérifiable sans navigateur, et ce qui permet au tableau de cas
// du §4.3 d'être exercé par un test unitaire d'un côté et par une preuve d'API de l'autre.
//
// La webapp étant un appelant **anonyme** faute d'écran de connexion (INC-021), les requêtes
// ci-dessous rendent `200` et `[]` : l'écran affiche donc « card introuvable », qui est le refus
// réel du backend et non un défaut d'interface. Le rendu chargé se prouve par test unitaire du
// composant réel et en substituant la réponse réseau (docs/DESIGN_SYSTEM.md §12.5).

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database, Json } from './database.types'
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
export const COLONNES_CARD_FORMULAIRE = 'id, title, workflow_id, current_step_id, email_local_part'

/** L'étape courante, telle que la mention « requis pour passer à <étape> » a besoin de la nommer. */
export type EtapeCourante = {
	readonly id: string
	readonly label: string
}

/** La card portant le formulaire, telle que l'écran a besoin de la connaître. */
export type CardOuverte = Pick<
	Database['public']['Tables']['cards']['Row'],
	'id' | 'title' | 'workflow_id' | 'current_step_id' | 'email_local_part'
>

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
}: {
	readonly champs: readonly ChampFormulaire[]
	readonly regles: readonly RegleVisibilite[]
	readonly valeurs: readonly ValeurChamp[]
	readonly etape: EtapeCourante
}): ModeleFormulaire {
	const parChamp = new Map<string, Json>()
	for (const valeur of valeurs) parChamp.set(valeur.field_id, valeur.value)

	const visibilites = new Map<string, Visibilite>()
	for (const regle of regles) {
		if (regle.step_id !== etape.id) continue
		visibilites.set(regle.field_id, lireVisibilite(regle.visibility))
	}

	const ordonnes = [...champs].sort((a, b) => a.position - b.position)
	const actifs: ChampResolu[] = []
	const autres: ChampResolu[] = []

	for (const champ of ordonnes) {
		const visibilite = visibilites.get(champ.id) ?? VISIBILITE_PAR_DEFAUT
		const valeur = parChamp.has(champ.id) ? parChamp.get(champ.id) : undefined
		const renseigne = estRenseigne(valeur ?? undefined)
		const archive = champ.archived_at !== null

		// Un champ archivé ne revient jamais dans le formulaire, quelle que soit sa règle (§5) :
		// exiger ou proposer un champ que l'archivage a retiré serait une impasse d'interface.
		if (archive || visibilite === 'hidden') {
			// Sans valeur, il n'y a rien à conserver : un champ masqué et vide n'a pas de place
			// dans la section repliée, qui existe pour ne perdre **aucune donnée saisie** (§4.2).
			if (renseigne) {
				autres.push({ champ, visibilite, valeur, renseigne, manquant: false })
			}
			continue
		}

		const manquant = visibilite === 'required' && !renseigne
		actifs.push({ champ, visibilite, valeur, renseigne, manquant })
	}

	return {
		etape,
		champs: actifs,
		autresEtapes: autres,
		clesManquantes: actifs.filter((resolu) => resolu.manquant).map((resolu) => resolu.champ.key),
	}
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
					}),
				}),
			)
		})()
	}, [client, idCard, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger }
}
