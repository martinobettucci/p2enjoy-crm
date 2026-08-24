// @spec CRM-062 (docs/BACKLOG.md) — tranche 3c : l'écran qui liste les affaires figées
// @spec docs/SPEC-relances.md §10.5 (ce que l'écran lit, et pourquoi en DEUX requêtes),
//       §10.6 (aucune portée, et pourquoi), §10.7 (le regroupement et le classement),
//       §10.8 (ce que chaque ligne rend), §10.9 (les états), §10.11 (contrat d'API)
// @spec docs/SPEC-relances.md §2.1 (la règle a UNE déclaration, et elle est en base),
//       §3.1 (les dix colonnes rendues), §3.4 (l'ordre)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; docs/DESIGN_SYSTEM.md §5.37 (l'écran)
//
// Ce module ne rend rien : il **compose**, et il lit. La séparation est ce qui rend les règles du
// §10 vérifiables sans navigateur — le regroupement par dossier, l'ordre des groupes, la
// conservation de l'ordre serveur à l'intérieur d'un groupe, et le sort d'une affaire que la
// seconde lecture ne rapporte pas.
//
// L'ÉCRAN NE RECALCULE JAMAIS « FIGÉE ». La règle vit en base, dans `public.cards_figees()`, et
// c'est tout l'objet du §2.1 : un écran qui la recalculerait devrait télécharger tout le pipeline
// pour en écarter la quasi-totalité. Le module APPELLE la fonction, il ne la double pas — la moitié
// TypeScript de la règle, `webapp/src/lib/carte-figee.ts`, sert la pastille du board, qui qualifie
// une carte déjà téléchargée pour une autre raison.
//
// Sans session, la lecture rend `200` et zéro ligne : la RLS ne consent rien à un anonyme, et c'est
// l'état vide ordinaire du §5.8, jamais un refus à mettre en scène. Le module ne bifurque jamais
// sur un rôle (`CLAUDE.md` §10).

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { COLONNES_CARD_FIGEE } from './colonnes-affaires-figees'
import type { ClientCrm } from './supabase'

export { COLONNES_CARD_FIGEE } from './colonnes-affaires-figees'

/**
 * Une ligne telle que `public.cards_figees()` la rend — les dix colonnes du §3.1.
 *
 * Ni libellé d'étape, ni nom de dossier : la fonction refuse délibérément de les recopier, « une
 * fonction qui recopierait le libellé dirait demain ce qui était vrai aujourd'hui » (§3.1). C'est
 * la raison même de la seconde lecture.
 */
export type LigneFigeeLue = {
	readonly card_id: string
	readonly channel_id: string
	readonly title: string
	readonly step_id: string
	readonly seuil_jours: number
	readonly jours_dans_etape: number
	readonly retard_jours: number
}

/** Une ligne de la seconde lecture, telle que PostgREST la rend. */
type LigneCardLue = {
	readonly id: string
	readonly channels: {
		readonly slug: string
		readonly name: string
		readonly tracks: { readonly slug: string; readonly name: string } | null
	} | null
	readonly workflow_steps: {
		readonly label_override: string | null
		readonly workflow_nodes_catalog: { readonly label: string } | null
	} | null
}

/** Une affaire figée, telle que l'écran la rend (§10.8). */
export type AffaireFigee = {
	readonly id: string
	readonly titre: string
	readonly retardJours: number
	readonly seuilJours: number
	/** L'identifiant du dossier : c'est lui qui groupe (§10.7), jamais son nom, qui peut se répéter. */
	readonly idChannel: string
	/** L'adresse de la fiche, ou `null` lorsque la seconde lecture n'a pas rapporté ses slugs. */
	readonly adresse: string | null
	readonly adresseChannel: string | null
	readonly nomTrack: string | null
	readonly nomChannel: string | null
	/** Le libellé de l'étape, résolu comme `board.ts` le résout, ou `null` s'il manque. */
	readonly etape: string | null
}

/** Un groupe de l'écran : un dossier, et ses affaires dans l'ordre du serveur. */
export type GroupeFigees = {
	readonly idChannel: string
	readonly nomTrack: string | null
	readonly nomChannel: string | null
	readonly adresseChannel: string | null
	readonly affaires: readonly AffaireFigee[]
}

/**
 * Le libellé d'une étape : le sien s'il est posé, sinon celui de son nœud.
 *
 * C'est **exactement** la résolution de `resoudreEtape` dans `board.ts` — `label_override ?? label`
 * —, et elle est réemployée plutôt que réécrite : deux résolutions du même libellé divergeraient au
 * premier changement, et l'écran nommerait une étape autrement que le board qui la porte.
 */
export function libelleEtape(
	etape: LigneCardLue['workflow_steps'] | undefined,
): string | null {
	return etape?.label_override ?? etape?.workflow_nodes_catalog?.label ?? null
}

/**
 * L'adresse du dossier d'une affaire, ou `null` lorsque ses slugs manquent.
 *
 * Elle est calculée ICI et non recomposée dans l'écran : les deux adresses partagent leur préfixe,
 * et deux compositions divergeraient au premier changement de route (décision 167, procédé de
 * `ma-journee.ts`).
 */
export function adresseChannel(card: LigneCardLue | undefined): string | null {
	const slugChannel = card?.channels?.slug
	const slugTrack = card?.channels?.tracks?.slug
	if (slugChannel === undefined || slugTrack === undefined) return null
	return `/tracks/${slugTrack}/${slugChannel}`
}

/**
 * Apparie une ligne de la règle avec ce que la seconde lecture en a rapporté.
 *
 * UNE AFFAIRE ABSENTE DE LA SECONDE LECTURE RESTE LISTÉE (§10.5), avec son titre, son retard et son
 * seuil — que la première lecture rend déjà —, mais sans lien, sans pilule et sans nom d'étape. La
 * masquer retrancherait une affaire en retard de la liste qui existe pour les montrer ; lui donner
 * un lien vers une adresse incomplète mènerait à un écran que l'utilisateur croirait cassé
 * (`docs/DESIGN_SYSTEM.md` §5.32).
 *
 * Le cas n'est pas théorique : les deux lectures ne sont pas atomiques, et une affaire mise à la
 * corbeille entre elles disparaîtrait de la seconde.
 */
export function apparier(
	figee: LigneFigeeLue,
	cards: ReadonlyMap<string, LigneCardLue>,
): AffaireFigee {
	const card = cards.get(figee.card_id)
	const base = adresseChannel(card)
	return {
		id: figee.card_id,
		titre: figee.title,
		retardJours: figee.retard_jours,
		seuilJours: figee.seuil_jours,
		idChannel: figee.channel_id,
		adresse: base === null ? null : `${base}/cards/${figee.card_id}`,
		adresseChannel: base,
		nomTrack: card?.channels?.tracks?.name ?? null,
		nomChannel: card?.channels?.name ?? null,
		etape: libelleEtape(card?.workflow_steps),
	}
}

/**
 * Regroupe les affaires par **dossier**, dans l'ordre de leur première ligne (§10.7).
 *
 * PAR CHANNEL, ET NON PAR TRACK : le dossier est là où l'affaire vit, c'est lui que la pilule
 * « Track › Channel » nomme, et c'est le grain auquel on va agir. Un regroupement par track mettrait
 * deux dossiers distincts d'un même track dans le même bloc — cas que le jeu de démonstration exerce
 * réellement, `studio-web` portant `refonte` et `maintenance` (§10.2.1).
 *
 * L'ORDRE À L'INTÉRIEUR D'UN GROUPE EST CELUI DU SERVEUR, conservé tel quel : `retard_jours desc,
 * title asc` (§3.4). Le rejouer ici le ferait diverger le jour où la fonction changera — c'est la
 * règle que `decouperEnSections` tient déjà pour « Ma journée ».
 *
 * L'ORDRE DES GROUPES EST CELUI DE LEUR PREMIÈRE LIGNE, donc du plus gros retard de chaque groupe :
 * la suite d'entrée étant déjà triée par retard décroissant, l'ordre d'apparition SUFFIT et aucun
 * tri n'est refait. Un ordre alphabétique de dossier ferait descendre en bas d'écran celui qui est
 * le plus en retard, ce qui est exactement l'information que l'écran existe pour donner.
 */
export function regrouperParDossier(affaires: readonly AffaireFigee[]): readonly GroupeFigees[] {
	const groupes: GroupeFigees[] = []
	const rangs = new Map<string, number>()
	for (const affaire of affaires) {
		const rang = rangs.get(affaire.idChannel)
		if (rang === undefined) {
			rangs.set(affaire.idChannel, groupes.length)
			groupes.push({
				idChannel: affaire.idChannel,
				nomTrack: affaire.nomTrack,
				nomChannel: affaire.nomChannel,
				adresseChannel: affaire.adresseChannel,
				affaires: [affaire],
			})
			continue
		}
		const groupe = groupes[rang]
		if (groupe === undefined) continue
		groupes[rang] = { ...groupe, affaires: [...groupe.affaires, affaire] }
	}
	return groupes
}

/**
 * Lit les affaires figées de l'appelant, en DEUX requêtes — et le §10.5 dit pourquoi.
 *
 * MESURÉ le 2026-08-24 : `public.cards_figees()` rend un `TABLE(...)`, c'est-à-dire un type
 * composite anonyme et non un `SETOF public.cards`. PostgREST ne lui connaît donc aucune clé
 * étrangère, et `rpc/cards_figees?select=…,channels(slug)` rend `PGRST200`. La seconde lecture n'est
 * pas un pis-aller : c'est la conséquence assumée de deux décisions déjà prises — la règle est en
 * base (§2.1), et la fonction refuse de recopier un libellé (§3.1).
 *
 * ELLE EST BORNÉE AUX IDENTIFIANTS QUE LA RÈGLE A DÉJÀ FILTRÉS, jamais au pipeline entier : c'est
 * précisément ce que le §2.1 exigeait. Et elle applique la MÊME RLS que la première — un écran qui
 * obtiendrait les libellés d'une affaire dont la règle lui refuse la ligne divulguerait par la
 * bande (§10.11 ligne g).
 *
 * AUCUN SECOND APPEL QUAND LA PREMIÈRE LECTURE EST VIDE : demander `id=in.()` serait une requête
 * dont on connaît déjà la réponse.
 */
export async function lireAffairesFigees(
	client: ClientCrm,
): Promise<EtatAsync<readonly AffaireFigee[]>> {
	try {
		const regle = await client.rpc('cards_figees')
		if (regle.error !== null) {
			return enErreur(classerErreur(regle.status, regle.error.message))
		}
		// `regle.data` est typée par les types générés, qui portent les dix colonnes du §3.1 depuis
		// la régénération de cette tranche. Le passage par `unknown` est celui que le dépôt emploie
		// pour toute réponse PostgREST projetée : le type généré décrit ce que la base PEUT rendre,
		// jamais ce que cette lecture-ci demande (`docs/SPEC-types.md` §4).
		const figees = (regle.data ?? []) as unknown as readonly LigneFigeeLue[]
		if (figees.length === 0) return pret([])

		const libelles = await client
			.from('cards')
			.select(COLONNES_CARD_FIGEE)
			.in(
				'id',
				figees.map((ligne) => ligne.card_id),
			)
		// LA SECONDE LECTURE N'EST PAS BLOQUANTE, et c'est une décision. Son échec ne doit pas
		// effacer une liste d'affaires en retard que la règle a déjà rendue : l'écran vaut mieux
		// dégradé — titres, retards et seuils, sans lien ni pilule — que remplacé par une erreur.
		// C'est exactement le sort d'une affaire absente de cette lecture, généralisé à toutes.
		const cards = new Map<string, LigneCardLue>()
		if (libelles.error === null) {
			for (const card of (libelles.data ?? []) as unknown as readonly LigneCardLue[]) {
				cards.set(card.id, card)
			}
		}
		return pret(figees.map((ligne) => apparier(ligne, cards)))
	} catch (cause) {
		return enErreur(
			classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)),
		)
	}
}
