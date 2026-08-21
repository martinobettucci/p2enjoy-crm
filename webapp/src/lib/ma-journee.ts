// @spec CRM-061 (docs/BACKLOG.md) — tranche 1 : composition et lecture de la vue « Ma journée »
// @spec docs/SPEC-cards.md §17.1 (ce que la vue est), §17.2 (l'adresse porte la portée),
//       §17.3 (la portée par défaut, choix nommé), §17.4 (ce que la vue lit, en UNE requête),
//       §17.5 (les trois sections et les deux bornes), §17.6 (ce que chaque ligne rend),
//       §17.7 (contrat d'API), §17.8 (états)
// @spec docs/SPEC-cards.md §5 (« active »), §16.12.1 (le prédicat d'exclusion du sommeil)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; docs/DESIGN_SYSTEM.md §5.36 (l'écran)
//
// Ce module ne rend rien : il **compose**, et il lit. La séparation est ce qui rend les règles du
// §17 vérifiables sans navigateur — la clôture de la portée, le calcul des bornes dans le fuseau du
// lecteur, le découpage en trois sections, l'ordre total, et la présence ou l'absence du filtre par
// responsable.
//
// Sans session, la lecture rend `200` et zéro ligne : la RLS ne consent rien à un anonyme, et c'est
// l'état vide ordinaire du §5.8, jamais un refus à mettre en scène. Le module ne bifurque jamais
// sur un rôle (`CLAUDE.md` §10).

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import {
	COLONNES_CARD_JOURNEE,
	SECTIONS_JOURNEE,
	bornesJournee,
	classerEcheance,
	type BornesJournee,
	type Portee,
	type SectionJournee,
} from './colonnes-ma-journee'
// Le filtre d'exclusion du sommeil n'est **pas** réécrit ici : il vit dans son module et cette vue
// l'importe (décision 167, §16.12.1). La même donnée lue deux fois finit par être lue de deux
// façons — et c'est exactement ce que la vue liste fait déjà.
import { filtreExclusionSommeil } from './filtre-sommeil'
import type { ClientCrm } from './supabase'

export {
	CLE_URL_PORTEE,
	COLONNES_CARD_JOURNEE,
	HORIZON_JOURS,
	PORTEE_PAR_DEFAUT,
	SECTIONS_JOURNEE,
	VALEUR_URL_PORTEE_TOUS,
	bornesJournee,
	classerEcheance,
	lirePortee,
	type BornesJournee,
	type Portee,
	type SectionJournee,
} from './colonnes-ma-journee'

/** Une ligne telle que PostgREST la rend, avant projection. */
type LigneJournee = {
	readonly id: string
	readonly title: string
	readonly next_action: string | null
	readonly next_action_at: string | null
	readonly channels: {
		readonly slug: string
		readonly name: string
		readonly tracks: { readonly slug: string; readonly name: string } | null
	} | null
}

/** Une affaire de la journée, telle que l'écran la rend (§17.6). */
export type AffaireDuJour = {
	readonly id: string
	readonly titre: string
	readonly prochaineAction: string | null
	/** L'échéance, déjà convertie : la classer demande un `Date`, l'afficher aussi. */
	readonly echeance: Date
	/** L'adresse de la fiche, ou `null` lorsque les slugs manquent (§17.4). */
	readonly adresse: string | null
	/**
	 * L'adresse du CHANNEL, ou `null` lorsque les slugs manquent.
	 *
	 * La pilule du §5.29 est un LIEN qui ouvre le channel — « ouverture du channel au clic ». Elle
	 * est réemployée « sans copie » (§17.6), et une pilule qui porterait son icône de sortie sans
	 * mener nulle part serait la commande morte que le §5.10 proscrit : l'icône promettrait une
	 * navigation qui n'existe pas.
	 */
	readonly adresseChannel: string | null
	readonly nomTrack: string | null
	readonly nomChannel: string | null
}

/** Les trois groupes, dans l'ordre de rendu. */
export type SectionsJournee = readonly {
	readonly section: SectionJournee
	readonly affaires: readonly AffaireDuJour[]
}[]

/**
 * L'adresse de la fiche d'une affaire, ou `null` lorsque ses slugs manquent.
 *
 * Une affaire dont le channel ou le track n'est pas rendu par la relation reste **listée** — la
 * masquer retrancherait une échéance de la journée —, mais sans lien : un lien vers une adresse
 * incomplète mènerait à un écran que l'utilisateur croirait cassé. C'est la règle du §5.32 du design
 * system, tenue sans changement.
 */
export function adresseAffaire(ligne: LigneJournee): string | null {
	const base = adresseChannel(ligne)
	return base === null ? null : `${base}/cards/${ligne.id}`
}

/**
 * L'adresse du channel de l'affaire, ou `null` lorsque ses slugs manquent.
 *
 * Elle est calculée ICI et non recomposée dans l'écran : les deux adresses partagent leur préfixe,
 * et deux compositions divergeraient au premier changement de route (décision 167).
 */
export function adresseChannel(ligne: LigneJournee): string | null {
	const slugChannel = ligne.channels?.slug
	const slugTrack = ligne.channels?.tracks?.slug
	if (slugChannel === undefined || slugTrack === undefined) return null
	return `/tracks/${slugTrack}/${slugChannel}`
}

/**
 * Projette une ligne rendue par PostgREST.
 *
 * Une ligne sans échéance est **écartée** plutôt que rangée dans une section par défaut : le filtre
 * `not.is.null` du §17.4 la refuse déjà au serveur, et lui inventer une place ici serait la valeur
 * par défaut trompeuse que `CLAUDE.md` §18 interdit. La fonction rend donc `null`, et l'appelant
 * l'ignore.
 */
export function projeterAffaire(ligne: LigneJournee): AffaireDuJour | null {
	if (ligne.next_action_at === null) return null
	const echeance = new Date(ligne.next_action_at)
	if (Number.isNaN(echeance.getTime())) return null
	return {
		id: ligne.id,
		titre: ligne.title,
		prochaineAction: ligne.next_action,
		echeance,
		adresse: adresseAffaire(ligne),
		adresseChannel: adresseChannel(ligne),
		nomTrack: ligne.channels?.tracks?.name ?? null,
		nomChannel: ligne.channels?.name ?? null,
	}
}

/**
 * Découpe les affaires en trois sections, dans l'ordre de rendu (§17.5).
 *
 * Le découpage se fait **à la composition**, jamais au serveur : trois requêtes d'intervalle
 * rendraient trois lectures là où une seule suffit, et le serveur ne connaît pas le fuseau du
 * lecteur. C'est le raisonnement du §16.15.5, où le masquage d'un fil endormi se fait « à la
 * composition, comme le board ».
 *
 * L'ordre **à l'intérieur** d'une section est celui du serveur, conservé tel quel : la lecture
 * ordonne déjà par échéance croissante, puis par titre, puis par identifiant (§17.4). Le rejouer ici
 * le ferait diverger le jour où la requête changera.
 */
export function decouperEnSections(
	affaires: readonly AffaireDuJour[],
	bornes: BornesJournee,
): SectionsJournee {
	return SECTIONS_JOURNEE.map((section) => ({
		section,
		affaires: affaires.filter((affaire) => classerEcheance(affaire.echeance, bornes) === section),
	}))
}

/**
 * Lit la journée en **une seule requête** (§17.4).
 *
 * `maintenant` est **injectable**, pour la raison du §16.11.1 : sans lui, aucune preuve ne pourrait
 * éprouver les deux côtés d'une borne sans dépendre de l'heure à laquelle elle s'exécute.
 *
 * `idUtilisateur` n'est employé que sous la portée « moi ». Sous « tous », aucun filtre par
 * responsable n'est envoyé — ce n'est pas une règle d'accès, c'est un rangement, et la RLS reste
 * seule juge de ce qui est lisible (§17.3).
 *
 * Aucun `count=exact` (§17.4) : il n'y a pas de pagination, donc pas de nombre de pages à calculer,
 * et le compte de chaque section est celui des lignes **rendues**. Demander un total que rien
 * n'affiche serait un `count(*)` gratuit à chaque ouverture.
 */
export async function lireJournee(
	client: ClientCrm,
	{
		portee,
		idUtilisateur,
		maintenant = new Date(),
	}: {
		readonly portee: Portee
		readonly idUtilisateur: string | null
		readonly maintenant?: Date
	},
): Promise<EtatAsync<readonly AffaireDuJour[]>> {
	// LA PORTÉE « MOI » SANS SESSION N'A PAS DE SUJET (§17.3). Envoyer `owner_id=eq.null` demanderait
	// les affaires sans responsable, ce qui n'est pas ce que l'écran promet ; ne rien envoyer
	// ouvrirait la portée que l'utilisateur n'a pas demandée. La lecture rend donc l'état vide, qui
	// est aussi ce que le backend consentirait — `200` et zéro ligne.
	const responsable = portee === 'moi' ? idUtilisateur : null
	if (portee === 'moi' && responsable === null) return pret([])
	try {
		const bornes = bornesJournee(maintenant)
		let requete = client
			.from('cards')
			.select(COLONNES_CARD_JOURNEE)
			.not('next_action_at', 'is', null)
			.lt('next_action_at', bornes.horizon.toISOString())
			.is('archived_at', null)
			.is('deleted_at', null)
			// Une affaire endormie **sort des vues par défaut** (§16.12.4), et une journée de travail
			// est une vue par défaut. Aucune bascule n'est offerte ici : endormir une affaire est
			// précisément le geste qui dit « pas aujourd'hui » (§17.4).
			.or(filtreExclusionSommeil(maintenant))
		if (responsable !== null) requete = requete.eq('owner_id', responsable)
		// L'ORDRE EST TOTAL (§17.4), leçon mesurée du §12.4 : sans le second et le troisième critère,
		// PostgreSQL ne promet aucun ordre entre deux échéances égales, et deux ouvertures de l'écran
		// n'afficheraient pas la même liste. `nullslast` n'est pas écrit — la colonne de tri est rendue
		// non nulle par le filtre ci-dessus, et l'écrire donnerait à croire qu'un cas nul existe.
		const reponse = await requete
			.order('next_action_at', { ascending: true })
			.order('title', { ascending: true })
			.order('id', { ascending: true })
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as readonly LigneJournee[]
		const affaires: AffaireDuJour[] = []
		for (const ligne of lignes) {
			const projetee = projeterAffaire(ligne)
			if (projetee !== null) affaires.push(projetee)
		}
		return pret(affaires)
	} catch (cause) {
		return enErreur(
			classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)),
		)
	}
}
