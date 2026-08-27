// @spec CRM-065 (docs/BACKLOG.md) — tranche 2, sous-tranche 2a : le moteur d'appel de la palette
// @spec docs/SPEC-recherche.md §13.1 (une lecture puis au plus deux résolutions), §13.2 (la garde
//       d'ordre), §13.3 (le délai de frappe), §13.4 (la destination famille par famille),
//       §13.5 (le message mène à l'inbox, et son adresse porte le message), §13.6 (aucun rôle)
// @spec docs/SPEC-recherche.md §6.1 (les sept colonnes), §6.3 (SECURITY INVOKER), §6.7 (le
//       contrat), §11 M14 (la RPC ne rend aucune adresse), M15 (l'embarquement nommé),
//       M18 (le générateur déclare non nul ce qui est nullable)
// @spec docs/DESIGN_SYSTEM.md §5.46 (la surface qui l'appelle), §5.8 (états systématiques)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec docs/SPEC-types.md §4 (un type ne garantit jamais une valeur)
//
// CE MODULE NE REND RIEN : IL LIT. La séparation est ce qui rend la garde d'ordre, le délai de
// frappe, la résolution d'adresse et les cinq destinations vérifiables **sans navigateur** — c'est
// la frontière que `mentions.ts` et `notifications.ts` tiennent déjà, et le motif du découpage de
// la tranche 2 (§10.2).
//
// LE MODULE NE BIFURQUE JAMAIS SUR UN RÔLE (`CLAUDE.md` §10, §13.6). `recherche_globale` est
// `SECURITY INVOKER` : chacune des cinq tables applique sa propre politique, et le refus est **zéro
// ligne, jamais une erreur** (§1.3). Il n'y a donc aucun droit à calculer, aucune famille à masquer
// et aucun refus à mettre en scène. Une liste vide est l'état vide ordinaire du §5.8.
//
// LA RPC NE REND AUCUNE ADRESSE, ET C'EST LA MESURE QUI COMMANDE TOUT LE MODULE (§11, M14). Ses
// sept colonnes donnent un `objet` et un `id` ; `CHEMIN_CARD` demande trois segments variables, et
// l'`id` d'un commentaire est celui du commentaire. Deux familles sur cinq exigent donc une seconde
// lecture, **groupée** par `id=in.(…)` et jamais `N + 1` (M15).

import {
	cheminContact,
	cheminOrganisation,
	CHEMIN_INBOX,
} from '../app/chemins'
import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import {
	BORNE_PALETTE,
	COLONNES_ADRESSE_AFFAIRE,
	COLONNES_ADRESSE_COMMENTAIRE,
	PARAMETRE_MESSAGE,
} from './colonnes-recherche'
import type { ClientCrm } from './supabase'

export { BORNE_PALETTE, PARAMETRE_MESSAGE } from './colonnes-recherche'

/** Le délai de silence au clavier avant d'émettre, en millisecondes (§13.3). */
export const DELAI_FRAPPE_MS = 200

/**
 * Les cinq familles du §4, telles que le discriminant `objet` les nomme.
 *
 * ELLES SONT ÉNUMÉRÉES ICI PARCE QUE LE TYPE GÉNÉRÉ DIT SEULEMENT `string` (M18). Une sixième
 * valeur que la base rendrait un jour ne doit pas faire échouer la lecture : elle produit une ligne
 * **sans famille reconnue**, donc sans destination — la ligne sans lien du §13.4 —, jamais un
 * `undefined` à l'écran ni une exception.
 */
export const FAMILLES = ['affaire', 'contact', 'organisation', 'commentaire', 'message'] as const

export type FamilleRecherche = (typeof FAMILLES)[number]

/** Vrai lorsque `valeur` est l'une des cinq familles du contrat. */
export function estFamilleConnue(valeur: string): valeur is FamilleRecherche {
	return (FAMILLES as readonly string[]).includes(valeur)
}

/**
 * Une ligne telle que la RPC la rend (§6.1).
 *
 * `titre`, `sous_titre` ET `extrait` SONT LUS COMME NULLABLES, contre la déclaration du générateur
 * (M18) : le §6.1 les rend nullables par contrat, et la mesure M1 le confirme — `"extrait": null`
 * sur les trois familles courtes. Un type ne garantit jamais une valeur (`docs/SPEC-types.md`).
 */
export type LigneRecherche = {
	readonly objet: string
	readonly id: string
	readonly workspace_id: string
	readonly titre: string | null
	readonly sous_titre: string | null
	readonly extrait: string | null
	readonly rang: number
}

/** Un résultat tel que la palette le rend (§13.4, `docs/DESIGN_SYSTEM.md` §5.46). */
export type ResultatRecherche = {
	readonly id: string
	/** La famille, ou `null` lorsque la base a rendu un discriminant que le contrat ne nomme pas. */
	readonly famille: FamilleRecherche | null
	readonly titre: string | null
	readonly sousTitre: string | null
	readonly extrait: string | null
	/**
	 * L'adresse de l'objet, ou `null` quand elle ne se résout pas.
	 *
	 * UNE LIGNE SANS DESTINATION RESTE RENDUE, SANS LIEN (§13.4) : elle garde son titre, son
	 * sous-titre et son extrait. La masquer retrancherait un résultat de la liste qui existe pour
	 * les montrer ; lui donner une adresse incomplète mènerait à un écran que l'utilisateur croirait
	 * cassé — la règle du §5.37 et du §5.32 du design system.
	 */
	readonly adresse: string | null
}

/** Ce qu'une recherche aboutie rend à l'écran. */
export type ResultatsRecherche = {
	readonly resultats: readonly ResultatRecherche[]
	/**
	 * Vrai quand la liste est **pleine**, donc possiblement tronquée (§14.2).
	 *
	 * LA TRONCATURE EST ÉCRITE, JAMAIS LAISSÉE À DEVINER — la règle du §5.43 pour « les 20 plus
	 * récentes » et du §5.15 pour « 3 affaires listées sur 13 ».
	 */
	readonly tronque: boolean
}

/**
 * L'adresse d'une affaire, composée à partir des deux slugs.
 *
 * ELLE VIT ICI ET NON EN BASE, et M14 en donne le motif : ajouter une colonne d'adresse à la
 * fonction porterait dans le moteur de recherche une composition d'URL qui est une affaire de
 * webapp, et qui varierait le jour où une route changerait. La base rend des identifiants.
 */
function adresseAffaire(slugTrack: string, slugChannel: string, idCard: string): string {
	return `/tracks/${slugTrack}/${slugChannel}/cards/${idCard}`
}

/** La forme que la résolution d'une affaire rend, telle que PostgREST l'embarque (M15). */
type LigneAdresseAffaire = {
	readonly id: string
	readonly channels: {
		readonly slug: string
		readonly tracks: { readonly slug: string } | null
	} | null
}

/** La forme que la résolution d'un commentaire rend (M15). */
type LigneAdresseCommentaire = {
	readonly id: string
	readonly card_id: string | null
	readonly cards: LigneAdresseAffaire | null
}

/**
 * Compose l'adresse d'une affaire depuis sa ligne de résolution, ou `null`.
 *
 * TROIS ABSENCES SONT TRAITÉES DE LA MÊME FAÇON — pas de channel, pas de track, pas de slug —, et
 * c'est délibéré : elles produisent toutes une adresse **incomplète**, et le §13.4 ne connaît
 * qu'une seule réponse à cela, la ligne sans lien. Les distinguer à l'écran divulguerait ce que la
 * RLS ferme (`docs/SPEC-permissions-rls.md` §7).
 */
function adresseDepuisLigne(ligne: LigneAdresseAffaire | null | undefined): string | null {
	if (ligne === null || ligne === undefined) return null
	const slugChannel = ligne.channels?.slug
	const slugTrack = ligne.channels?.tracks?.slug
	if (slugChannel === undefined || slugTrack === undefined) return null
	return adresseAffaire(slugTrack, slugChannel, ligne.id)
}

/**
 * L'adresse d'un message dans l'inbox (§13.5).
 *
 * TROIS ISSUES ONT ÉTÉ PESÉES, ET CELLE-CI EST LA MOINS FAUSSE. Mener à l'affaire du message est
 * écarté par M16 — un message sur deux du seed n'en a pas, et on a cherché un **message** ; mener à
 * `/inbox` sans rien désigner ferait retrouver à la main ce que la palette venait de montrer.
 *
 * Le paramètre est **stable par contrat** et la sous-tranche 2c le fait honorer ; tant qu'elle
 * n'est pas livrée il est **inerte**, et l'écart est nommé plutôt que masqué.
 */
function adresseMessage(idMessage: string): string {
	return `${CHEMIN_INBOX}?${PARAMETRE_MESSAGE}=${encodeURIComponent(idMessage)}`
}

/**
 * Lit les lignes de la RPC, sans rien résoudre.
 *
 * LE TERME EST ENVOYÉ TEL QUEL (§14.2). Le §6.2 pose que la normalisation est « entièrement écrite
 * [en base] et ne dépend d'aucune saisie du client » ; en poser une seconde ici ferait deux
 * définitions du même découpage, qui divergeraient au premier ajustement.
 */
async function lireLignes(
	client: ClientCrm,
	terme: string,
	limite: number,
): Promise<EtatAsync<readonly LigneRecherche[]>> {
	try {
		const reponse = await client.rpc('recherche_globale', { p_terme: terme, p_limite: limite })
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		// Le générateur déclare trois colonnes non nulles à tort (M18) : la conversion passe par
		// `unknown` plutôt que d'affirmer une forme que la base ne garantit pas.
		return pret((reponse.data ?? []) as unknown as readonly LigneRecherche[])
	} catch (cause) {
		return enErreur(
			classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)),
		)
	}
}

/**
 * Résout les adresses des affaires citées, en **une** requête.
 *
 * ELLE EST OMISE QUAND LA FAMILLE EST ABSENTE (§13.1) : une frappe qui ne rend que des contacts
 * n'émet qu'une requête. Un échec de la résolution **n'est pas un échec de la recherche** : il rend
 * une table vide, donc des lignes sans lien (§13.4). Cacher les résultats parce que leur adresse
 * n'a pas pu être lue serait perdre ce que la recherche a trouvé.
 */
async function resoudreAffaires(
	client: ClientCrm,
	ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
	const adresses = new Map<string, string>()
	if (ids.length === 0) return adresses
	try {
		const reponse = await client.from('cards').select(COLONNES_ADRESSE_AFFAIRE).in('id', [...ids])
		if (reponse.error !== null) return adresses
		for (const ligne of (reponse.data ?? []) as unknown as readonly LigneAdresseAffaire[]) {
			const adresse = adresseDepuisLigne(ligne)
			if (adresse !== null) adresses.set(ligne.id, adresse)
		}
		return adresses
	} catch {
		return adresses
	}
}

/**
 * Résout les adresses des affaires **commentées**, en une requête.
 *
 * LA CLÉ DE LA TABLE RENDUE EST CELLE DU COMMENTAIRE, jamais celle de l'affaire : c'est le
 * commentaire que la palette liste, et c'est par son identifiant que la ligne se retrouve.
 */
async function resoudreCommentaires(
	client: ClientCrm,
	ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
	const adresses = new Map<string, string>()
	if (ids.length === 0) return adresses
	try {
		const reponse = await client
			.from('card_comments')
			.select(COLONNES_ADRESSE_COMMENTAIRE)
			.in('id', [...ids])
		if (reponse.error !== null) return adresses
		for (const ligne of (reponse.data ?? []) as unknown as readonly LigneAdresseCommentaire[]) {
			const adresse = adresseDepuisLigne(ligne.cards)
			if (adresse !== null) adresses.set(ligne.id, adresse)
		}
		return adresses
	} catch {
		return adresses
	}
}

/**
 * Assemble une ligne de la RPC et les adresses résolues en un résultat affichable.
 *
 * UNE FAMILLE INCONNUE NE FAIT PAS ÉCHOUER LA LIGNE : elle la rend sans destination, exactement
 * comme une adresse absente. Le §5.14 du design system tient déjà ce raisonnement pour un code
 * d'incident que le dictionnaire ne nomme pas — on ne devine jamais, et on n'affiche pas le code
 * brut.
 */
export function composerResultat(
	ligne: LigneRecherche,
	adressesAffaires: ReadonlyMap<string, string>,
	adressesCommentaires: ReadonlyMap<string, string>,
): ResultatRecherche {
	const famille = estFamilleConnue(ligne.objet) ? ligne.objet : null
	const adresse = ((): string | null => {
		switch (famille) {
			case 'affaire':
				return adressesAffaires.get(ligne.id) ?? null
			case 'commentaire':
				return adressesCommentaires.get(ligne.id) ?? null
			case 'contact':
				return cheminContact(ligne.id)
			case 'organisation':
				return cheminOrganisation(ligne.id)
			case 'message':
				return adresseMessage(ligne.id)
			default:
				return null
		}
	})()
	return {
		id: ligne.id,
		famille,
		titre: ligne.titre ?? null,
		sousTitre: ligne.sous_titre ?? null,
		extrait: ligne.extrait ?? null,
		adresse,
	}
}

/**
 * Une recherche complète : la RPC, puis au plus deux résolutions (§13.1).
 *
 * LES DEUX RÉSOLUTIONS SONT ÉMISES EN PARALLÈLE l'une de l'autre — elles ne se conditionnent pas —
 * et jamais avant que la RPC ait rendu : on ne sait pas quoi résoudre avant de savoir ce qui a été
 * trouvé.
 */
export async function rechercher(
	client: ClientCrm,
	terme: string,
	limite: number = BORNE_PALETTE,
): Promise<EtatAsync<ResultatsRecherche>> {
	const lignes = await lireLignes(client, terme, limite)
	if (lignes.statut !== 'pret') return lignes
	const idsAffaires = lignes.donnees.filter((l) => l.objet === 'affaire').map((l) => l.id)
	const idsCommentaires = lignes.donnees.filter((l) => l.objet === 'commentaire').map((l) => l.id)
	const [adressesAffaires, adressesCommentaires] = await Promise.all([
		resoudreAffaires(client, idsAffaires),
		resoudreCommentaires(client, idsCommentaires),
	])
	return pret({
		resultats: lignes.donnees.map((ligne) =>
			composerResultat(ligne, adressesAffaires, adressesCommentaires),
		),
		tronque: lignes.donnees.length >= limite,
	})
}

/**
 * Une recherche **rangée**, qui jette une réponse dépassée (§13.2).
 *
 * C'EST LA RÈGLE LA PLUS IMPORTANTE DU MODULE. Une palette émet une requête par frappe utile, et
 * rien ne garantit que la réponse à `refonte` arrive après celle de `refont` : deux requêtes
 * concurrentes reviennent dans l'ordre que le réseau décide. Sans garde, la liste afficherait le
 * résultat d'un terme que l'utilisateur a déjà dépassé — un état qu'il a vu et qui n'existe plus,
 * exactement ce que le §5.45 du design system proscrit pour une case cochée par anticipation.
 *
 * LE DÉLAI DE FRAPPE NE REMPLACE PAS CETTE GARDE (§13.3) : deux frappes séparées de plus de
 * `DELAI_FRAPPE_MS` émettent bien deux requêtes concurrentes. Une session qui retirerait le rang
 * « puisqu'il y a un délai » rouvrirait le défaut.
 */
export function creerSequenceur(): {
	readonly suivant: () => number
	readonly estCourant: (rang: number) => boolean
} {
	let dernier = 0
	return {
		suivant: () => {
			dernier += 1
			return dernier
		},
		estCourant: (rang: number) => rang === dernier,
	}
}
