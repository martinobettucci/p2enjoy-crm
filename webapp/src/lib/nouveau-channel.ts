// @spec CRM-100 (docs/BACKLOG.md) — tranche T1 : les adresses de « Nouveau channel » et de l'aller-retour vers
//       l'éditeur de workflows
// @spec docs/SPEC-administration-arborescence.md §13.3 (le formulaire ouvert est un état de l'adresse), §13.4
//       (l'adresse de départ et le brouillon), §13.5 (`creer`, `track`, `workflow-cree`), §13.6 (au retour), §13.7
//       (validation de l'adresse de retour)
// @spec docs/JOURNAL.md décision 623 (le brouillon voyage dans l'adresse, jamais dans un stockage du navigateur)
// @spec CRM-116 (docs/BACKLOG.md) tranche T3 — la couleur voyage dans le brouillon comme le nom : sans elle, l'aller-retour
//       vers l'éditeur de workflows la perdrait (docs/SPEC-administration-arborescence.md §14.3 ; décision 729)
//
// UN MODULE SANS RENDU, ET C'EST VOULU. Trois écrans lisent et écrivent ces paramètres — la vue d'un track,
// l'arborescence et l'éditeur de workflows — et la barre d'onglets compose l'adresse d'ouverture : chacun
// réécrivant ses clés, le premier renommage les ferait diverger. Tout est ici, en fonctions pures, et prouvé par
// `nouveau-channel.test.ts`.

import { jetonCouleur } from '../app/presentation-tracks'
import { MOTIF_SLUG } from './administration-arborescence'

/** Le formulaire de création d'un channel ouvert : `1` dans la vue d'un track, l'id du track dans l'arborescence. */
export const PARAM_NOUVEAU_CHANNEL = 'nouveau-channel'

/** Valeur de `nouveau-channel` dans la vue d'un track, dont le track est celui de la route. */
export const VALEUR_NOUVEAU_CHANNEL_TRACK = '1'

/**
 * Le brouillon du formulaire. Le préfixe `nc-` évite toute collision avec les paramètres de la vue liste
 * (`page`, tri, filtres, sommeil) que l'adresse d'un track porte aussi (§13.4).
 */
export const PARAMS_BROUILLON = {
	nom: 'nc-nom',
	slug: 'nc-slug',
	description: 'nc-description',
	workflow: 'nc-workflow',
	couleur: 'nc-couleur',
} as const

/** Les paramètres de l'éditeur de workflows (§13.5). */
export const PARAM_CREER = 'creer'
export const PARAM_TRACK = 'track'
export const PARAM_RETOUR = 'retour'
export const PARAM_WORKFLOW_CREE = 'workflow-cree'

const CHEMIN_EDITEUR = '/reglages/workflows'
const CHEMIN_ARBORESCENCE = '/reglages/arborescence'

/** Le brouillon lu de l'adresse. Une clé absente vaut la chaîne vide ; le workflow absent vaut `null`. */
export type BrouillonChannel = {
	readonly nom: string
	readonly slug: string
	readonly description: string
	readonly idWorkflow: string | null
	/** `neutral` si absente ; une valeur hors des cinq jetons est ramenée à `neutral`, jamais envoyée telle quelle. */
	readonly couleur: string
}

/** Ce que le formulaire confie à l'aller-retour : la saisie courante, le slug seulement s'il a été SAISI. */
export type SaisiePortee = {
	readonly nom: string
	readonly slug: string
	readonly description: string
	readonly couleur: string
}

export function lireBrouillon(parametres: URLSearchParams): BrouillonChannel {
	const workflow = parametres.get(PARAMS_BROUILLON.workflow)
	return {
		nom: parametres.get(PARAMS_BROUILLON.nom) ?? '',
		slug: parametres.get(PARAMS_BROUILLON.slug) ?? '',
		description: parametres.get(PARAMS_BROUILLON.description) ?? '',
		idWorkflow: workflow === null || workflow === '' ? null : workflow,
		couleur: jetonCouleur(parametres.get(PARAMS_BROUILLON.couleur) ?? ''),
	}
}

/** Copie des paramètres, sans ceux du formulaire de channel ni de son brouillon (§13.6, dernière règle). */
export function sansNouveauChannel(parametres: URLSearchParams): URLSearchParams {
	const copie = new URLSearchParams(parametres)
	copie.delete(PARAM_NOUVEAU_CHANNEL)
	for (const cle of Object.values(PARAMS_BROUILLON)) copie.delete(cle)
	return copie
}

/** Ajoute le brouillon : une valeur vide n'est pas écrite (§13.4). */
function ecrireBrouillon(parametres: URLSearchParams, saisie: SaisiePortee): void {
	const valeurs: readonly (readonly [string, string])[] = [
		[PARAMS_BROUILLON.nom, saisie.nom],
		[PARAMS_BROUILLON.slug, saisie.slug],
		[PARAMS_BROUILLON.description, saisie.description],
		// Le défaut n'est pas écrit : l'adresse la plus courte reste celle du formulaire tel qu'il s'ouvre.
		[PARAMS_BROUILLON.couleur, saisie.couleur === 'neutral' ? '' : saisie.couleur],
	]
	for (const [cle, valeur] of valeurs) {
		if (valeur.trim() !== '') parametres.set(cle, valeur)
	}
}

const SLUG = MOTIF_SLUG.source.replace(/^\^/, '').replace(/\$$/, '')

/**
 * Les adresses de la vue d'un track : `/tracks/<track>`, `/tracks/<track>/<channel>`, `/tracks/<track>/<channel>/liste`.
 *
 * `couts` est EXCLU comme second segment : `/tracks/<track>/couts` est l'écran des coûts du track (`CRM-086`), que le
 * routeur préfère à un channel de ce slug, et qui ne rend pas le formulaire.
 */
const MOTIF_VUE_TRACK = new RegExp(`^/tracks/(${SLUG})(?:/(?!couts(?:/|$))(${SLUG})(?:/liste)?)?$`)

/** Vrai si le chemin est une vue de track, celle qui rend le formulaire de « Nouveau channel ». */
export function estVueTrack(chemin: string): boolean {
	return MOTIF_VUE_TRACK.test(chemin)
}

/**
 * L'adresse de la commande « Nouveau channel » de la barre d'onglets (§13.3).
 *
 * Sur une vue de track, l'adresse COURANTE, paramètres conservés — la vue liste garde sa page et ses filtres. Ailleurs
 * — l'écran des coûts, la fiche d'une affaire —, la racine du track, seule vue qui rende le formulaire.
 */
export function cheminOuvertureNouveauChannel(chemin: string, recherche: string, slugTrack: string): string {
	const surVueTrack = estVueTrack(chemin)
	const parametres = surVueTrack ? sansNouveauChannel(new URLSearchParams(recherche)) : new URLSearchParams()
	parametres.set(PARAM_NOUVEAU_CHANNEL, VALEUR_NOUVEAU_CHANNEL_TRACK)
	return `${surVueTrack ? chemin : `/tracks/${slugTrack}`}?${parametres.toString()}`
}

/** L'adresse d'origine depuis la vue d'un track : l'adresse courante, formulaire ouvert, brouillon compris (§13.4). */
export function origineDepuisTrack(chemin: string, recherche: string, saisie: SaisiePortee): string {
	const parametres = sansNouveauChannel(new URLSearchParams(recherche))
	parametres.set(PARAM_NOUVEAU_CHANNEL, VALEUR_NOUVEAU_CHANNEL_TRACK)
	ecrireBrouillon(parametres, saisie)
	return `${chemin}?${parametres.toString()}`
}

/** L'adresse d'origine depuis l'arborescence : le track nommé par son id, brouillon compris (§13.4). */
export function origineDepuisArborescence(idTrack: string, saisie: SaisiePortee): string {
	const parametres = new URLSearchParams()
	parametres.set(PARAM_NOUVEAU_CHANNEL, idTrack)
	ecrireBrouillon(parametres, saisie)
	return `${CHEMIN_ARBORESCENCE}?${parametres.toString()}`
}

/** L'adresse de « Nouveau workflow » : l'éditeur, création ouverte sur ce track, et le retour (§13.4). */
export function cheminEditeurNouveauWorkflow(idTrack: string, origine: string): string {
	const parametres = new URLSearchParams()
	parametres.set(PARAM_CREER, '1')
	parametres.set(PARAM_TRACK, idTrack)
	parametres.set(PARAM_RETOUR, origine)
	return `${CHEMIN_EDITEUR}?${parametres.toString()}`
}

/** Ce que l'éditeur lit de son adresse au montage (§13.5). */
export type DemandeCreation = { readonly ouvrir: boolean; readonly idTrack: string | null }

export function lireDemandeCreation(parametres: URLSearchParams): DemandeCreation {
	const idTrack = parametres.get(PARAM_TRACK)
	return {
		ouvrir: parametres.get(PARAM_CREER) === '1',
		idTrack: idTrack === null || idTrack === '' ? null : idTrack,
	}
}

/**
 * L'adresse de retour, VALIDÉE — §13.7. `null` si elle n'est pas retenue.
 *
 * Elle vient de l'adresse, donc de n'importe qui : un lien forgé ne doit pas faire de l'éditeur une redirection
 * ouverte. Elle n'est retenue que relative à l'origine, vers l'un des deux écrans hôtes, et portant
 * `nouveau-channel`. `URLSearchParams.get` la rend déjà décodée.
 */
export function lireRetour(valeur: string | null): string | null {
	if (valeur === null) return null
	// Un seul `/` en tête, aucun `\` — que le navigateur lit comme un `/` —, aucun caractère de contrôle. La liste
	// blanche des chemins, plus bas, écarte déjà `//hôte` : cette garde est une DÉFENSE EN PROFONDEUR, gardée pour
	// qu'un élargissement futur de la liste ne rouvre pas la redirection — mesuré : la retirer seule ne fait rougir
	// aucune preuve, et c'est attendu.
	if (!valeur.startsWith('/') || valeur.startsWith('//') || valeur.includes('\\')) return null
	if (/[\u0000-\u001f\u007f]/.test(valeur)) return null
	const separateur = valeur.indexOf('?')
	if (separateur === -1) return null
	const chemin = valeur.slice(0, separateur)
	const parametres = new URLSearchParams(valeur.slice(separateur + 1))
	if (!estVueTrack(chemin) && chemin !== CHEMIN_ARBORESCENCE) return null
	const ouverture = parametres.get(PARAM_NOUVEAU_CHANNEL)
	if (ouverture === null || ouverture === '') return null
	return valeur
}

/** Le lien « Revenir au nouveau channel » : le retour, et le workflow créé s'il y en a un (§13.5). */
export function cheminRetour(retour: string, idWorkflowCree: string | null): string {
	const separateur = retour.indexOf('?')
	const chemin = retour.slice(0, separateur)
	const parametres = new URLSearchParams(retour.slice(separateur + 1))
	parametres.delete(PARAMS_BROUILLON.workflow)
	if (idWorkflowCree !== null) parametres.set(PARAMS_BROUILLON.workflow, idWorkflowCree)
	return `${chemin}?${parametres.toString()}`
}
