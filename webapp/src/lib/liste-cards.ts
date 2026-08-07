// @spec CRM-042 (docs/BACKLOG.md) — composition de la vue liste : tri, filtres, pagination
// @spec docs/SPEC-cards.md §12.2 (l'adresse porte tout), §12.3 (ce que la liste lit),
//       §12.4 (le tri, et pourquoi il doit être TOTAL), §12.5 (les filtres),
//       §12.6 (la pagination et le `416`), §12.9 (états systématiques)
// @spec docs/SPEC-cards.md §2.7 (recherche plein texte), §5 (« active »)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; docs/DESIGN_SYSTEM.md §5.9 (tableau)
//
// Ce module ne rend rien : il **compose**, et il lit. La séparation est ce qui rend les règles du
// §12 vérifiables sans navigateur — la clôture des tris, l'ordre total, le repli des paramètres
// d'adresse, le bornage du rang de page, le découpage en pages, la classification du `416`.
//
// Sans session, la lecture rend `200` et un total de zéro ; avec la session restaurée par
// `CRM-011`, elle rend les lignes consenties par la RLS. Le module ne bifurque jamais sur un rôle.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
// La lecture des étapes n'est **pas** réécrite ici : elle vit dans le module du board et la liste
// l'importe (décision 188). La même donnée lue deux fois finit par être lue de deux façons.
import { lireEtapes, resoudreEtape, type EtapeBoard } from './board'
import { CODE_PAGE_INEXISTANTE, COLONNES_CARD_LISTE, LIGNES_PAR_PAGE } from './colonnes-liste'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

export { CODE_PAGE_INEXISTANTE, COLONNES_CARD_LISTE, LIGNES_PAR_PAGE } from './colonnes-liste'

// --- Le tri (§12.4) --------------------------------------------------------------------------

/** Les quatre clés de tri offertes. La liste est **close** : rien d'autre ne devient un `order=`. */
export type CleTri = 'title' | 'amount' | 'next_action_at' | 'created_at'

export type SensTri = 'asc' | 'desc'

/**
 * Chaque tri avec le sens qu'il prend lorsque l'adresse n'en nomme aucun.
 *
 * Le sens par défaut n'est pas uniforme, et ce n'est pas une inconséquence : on cherche la **plus
 * grosse** affaire et la **plus récente**, mais l'échéance la **plus proche** et le titre par le
 * début de l'alphabet.
 */
export const TRIS: readonly { readonly cle: CleTri; readonly sensParDefaut: SensTri }[] = [
	{ cle: 'title', sensParDefaut: 'asc' },
	{ cle: 'amount', sensParDefaut: 'desc' },
	{ cle: 'next_action_at', sensParDefaut: 'asc' },
	{ cle: 'created_at', sensParDefaut: 'desc' },
]

export const TRI_PAR_DEFAUT: CleTri = 'title'

/** Une colonne de l'ordre envoyé à PostgREST, telle que `supabase-js` la demande. */
export type OrdreColonne = {
	readonly colonne: string
	readonly ascendant: boolean
	/** Toujours `false` : une valeur absente n'est jamais la plus grosse affaire du channel. */
	readonly nullsFirst: false
}

/**
 * L'ordre **total** d'une page (§12.4).
 *
 * MESURÉ sur la sonde `sonde_l2` — 200 000 lignes de clé de tri égale, quatre pages de cinq — :
 * un `order by cle` rend **20 lignes dont 17 distinctes**, quand `order by cle, id` en rend 20 sur
 * 20. Trois lignes rendues deux fois, donc trois lignes que la marche n'a jamais montrées, sans
 * que rien ne le signale : chaque page était pleine et le total était juste.
 *
 * `id` est la clé primaire, donc unique : il rend l'ordre indépendant du plan choisi. `title`
 * s'intercale pour les trois tris qui ne portent pas sur lui, afin que deux affaires de même
 * montant se rangent par un critère que l'utilisateur **voit**, plutôt que par un identifiant
 * qu'il ne voit pas.
 */
export function ordreDe(tri: CleTri, sens: SensTri): readonly OrdreColonne[] {
	const principal: OrdreColonne = { colonne: tri, ascendant: sens === 'asc', nullsFirst: false }
	const departage: readonly OrdreColonne[] =
		tri === 'title'
			? [{ colonne: 'id', ascendant: true, nullsFirst: false }]
			: [
					{ colonne: 'title', ascendant: true, nullsFirst: false },
					{ colonne: 'id', ascendant: true, nullsFirst: false },
				]
	return [principal, ...departage]
}

// --- Les paramètres d'adresse (§12.2) --------------------------------------------------------

export type ParametresListe = {
	readonly tri: CleTri
	readonly sens: SensTri
	/** Identifiant d'étape, ou `null` : aucun filtre par étape. */
	readonly etape: string | null
	/** Termes de recherche, déjà découpés des espaces. Chaîne vide : aucune recherche. */
	readonly recherche: string
	/** Rang de page, **au moins 1**. Le bornage par le total est fait à part (§12.6). */
	readonly page: number
}

export const PARAMETRES_PAR_DEFAUT: ParametresListe = {
	tri: TRI_PAR_DEFAUT,
	sens: 'asc',
	etape: null,
	recherche: '',
	page: 1,
}

/** Les noms des paramètres dans l'adresse. Déclarés une fois : les preuves les importent. */
export const CLES_URL = {
	tri: 'tri',
	sens: 'sens',
	etape: 'etape',
	recherche: 'q',
	page: 'page',
} as const

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Lit les paramètres d'une adresse, en repliant **tout** ce qui n'est pas reconnu (§12.2).
 *
 * Une adresse tapée à la main n'est pas une panne : un paramètre absent, inconnu ou hors bornes
 * prend son défaut, et l'écran n'affiche aucune erreur.
 *
 * La clôture n'est pas décorative. Sans elle, `?tri=couleur_préférée` deviendrait un
 * `order=couleur_préférée` envoyé à PostgREST. Ce n'est pas une faille de droit — la RLS juge les
 * lignes, pas les colonnes demandées — mais un appelant sonderait l'existence d'une colonne par la
 * différence entre un `200` et un `400`. Idem pour l'étape, dont la **forme** est vérifiée avant
 * d'entrer dans un `eq.`.
 */
export function lireParametres(recherche: URLSearchParams): ParametresListe {
	const triDemande = recherche.get(CLES_URL.tri)
	const connu = TRIS.find((candidat) => candidat.cle === triDemande)
	const tri = connu?.cle ?? TRI_PAR_DEFAUT
	const sensDemande = recherche.get(CLES_URL.sens)
	const sens: SensTri =
		sensDemande === 'asc' || sensDemande === 'desc'
			? sensDemande
			: (connu?.sensParDefaut ?? PARAMETRES_PAR_DEFAUT.sens)
	const etapeDemandee = recherche.get(CLES_URL.etape)
	const pageDemandee = Number.parseInt(recherche.get(CLES_URL.page) ?? '', 10)
	return {
		tri,
		sens,
		etape: etapeDemandee !== null && FORME_UUID.test(etapeDemandee) ? etapeDemandee : null,
		recherche: (recherche.get(CLES_URL.recherche) ?? '').trim(),
		page: Number.isFinite(pageDemandee) && pageDemandee >= 1 ? pageDemandee : 1,
	}
}

/**
 * Écrit des paramètres en chaîne de requête, en **omettant** ceux qui valent leur défaut.
 *
 * Une adresse qui porterait `?tri=title&sens=asc&page=1` sur la vue par défaut serait illisible et
 * ne dirait rien de plus que l'adresse nue.
 */
export function ecrireParametres(parametres: ParametresListe): URLSearchParams {
	const sortie = new URLSearchParams()
	const sensParDefaut =
		TRIS.find((candidat) => candidat.cle === parametres.tri)?.sensParDefaut ?? 'asc'
	if (parametres.tri !== TRI_PAR_DEFAUT) sortie.set(CLES_URL.tri, parametres.tri)
	if (parametres.sens !== sensParDefaut) sortie.set(CLES_URL.sens, parametres.sens)
	if (parametres.etape !== null) sortie.set(CLES_URL.etape, parametres.etape)
	if (parametres.recherche !== '') sortie.set(CLES_URL.recherche, parametres.recherche)
	if (parametres.page > 1) sortie.set(CLES_URL.page, String(parametres.page))
	return sortie
}

// --- La pagination (§12.6) -------------------------------------------------------------------

/** Nombre de pages d'un total. **Au moins une** : un channel vide a une page, vide. */
export function nombreDePages(total: number): number {
	return Math.max(1, Math.ceil(total / LIGNES_PAR_PAGE))
}

/**
 * Ramène un rang de page dans les bornes connues (§12.6, règle 1).
 *
 * Tant qu'aucun total n'a été rapporté — première lecture —, seul le plancher s'applique : borner
 * par un total qu'on n'a pas reviendrait à inventer une valeur par défaut.
 */
export function bornerPage(page: number, total: number | null): number {
	if (!Number.isFinite(page)) return 1
	const entier = Math.max(1, Math.floor(page))
	if (total === null) return entier
	return Math.min(entier, nombreDePages(total))
}

/** La plage `Range` d'une page, bornes **incluses**, telle que `supabase-js` l'attend. */
export function plageDe(page: number): { readonly de: number; readonly a: number } {
	const rang = Math.max(1, Math.floor(page))
	const de = (rang - 1) * LIGNES_PAR_PAGE
	return { de, a: de + LIGNES_PAR_PAGE - 1 }
}

// --- La lecture (§12.3) ----------------------------------------------------------------------

export type CardListe = Pick<
	Database['public']['Tables']['cards']['Row'],
	'id' | 'title' | 'amount' | 'currency' | 'next_action' | 'next_action_at' | 'current_step_id'
>

/**
 * Ce qu'une lecture aboutie rend.
 *
 * Le `416` n'est **pas** replié dans l'état d'erreur : il est une réponse légitime à une question
 * qui ne l'est plus — « la page 4 » d'une liste qui n'en a plus que trois. Le classer parmi les
 * erreurs afficherait « Chargement impossible » à un utilisateur dont la seule faute est d'avoir
 * gardé son onglet ouvert pendant qu'une affaire était archivée ailleurs (§12.6, règle 2).
 *
 * Il n'est pas absorbé pour autant : il porte son propre nom, l'écran le dit, et il propose le
 * retour à la première page. Toute **autre** erreur reste une erreur.
 */
export type ContenuListe =
	| {
			readonly nature: 'page'
			readonly cards: readonly CardListe[]
			/** Total des lignes **filtrées**, pas du channel entier (§12.5). */
			readonly total: number
	  }
	| { readonly nature: 'page_inexistante' }

/** Ce qu'une réponse de `supabase-js` porte, réduit à ce dont la classification a besoin. */
export type ReponseLue = {
	readonly statut: number
	readonly erreur: { readonly code?: string | null; readonly message: string } | null
	readonly donnees: readonly CardListe[] | null
	readonly total: number | null
}

/**
 * Classe une réponse de page, et **n'absorbe aucune erreur**.
 *
 * Un `count` absent alors que la réponse a abouti est traité comme un échec inconnu plutôt que
 * comme un total de zéro : afficher « aucune affaire » parce qu'on n'a pas su compter serait la
 * valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
 */
export function classerReponsePage(reponse: ReponseLue): EtatAsync<ContenuListe> {
	if (reponse.erreur !== null) {
		if (reponse.erreur.code === CODE_PAGE_INEXISTANTE) return pret({ nature: 'page_inexistante' })
		return enErreur(classerErreur(reponse.statut, reponse.erreur.message))
	}
	if (reponse.donnees === null || reponse.total === null) {
		return enErreur(
			classerErreur(reponse.statut, 'réponse sans lignes ni total alors qu’aucune erreur n’est rendue'),
		)
	}
	return pret({ nature: 'page', cards: reponse.donnees, total: reponse.total })
}

/**
 * Lit une page de cards d'un channel : la requête n° 2 du §12.3.
 *
 * **Tout est côté serveur** — filtres d'activité, filtre d'étape, recherche, ordre, plage. Un
 * filtre appliqué après la pagination ne verrait que les lignes déjà rapportées : une affaire de
 * la page 3 ne sortirait jamais d'une recherche (§12.5).
 *
 * Le total vient du **même appel**, par `count: 'exact'`. MESURÉ : `count: 'planned'` rend `1` là
 * où la table en porte `3` — une pagination bâtie sur une estimation afficherait un nombre de
 * pages qui n'existe pas (décision 187).
 */
export async function lirePageCards(
	client: ClientCrm,
	{
		channelId,
		parametres,
	}: { readonly channelId: string; readonly parametres: ParametresListe },
): Promise<EtatAsync<ContenuListe>> {
	try {
		let requete = client
			.from('cards')
			.select(COLONNES_CARD_LISTE, { count: 'exact' })
			.eq('channel_id', channelId)
			.is('archived_at', null)
			.is('deleted_at', null)
		if (parametres.etape !== null) requete = requete.eq('current_step_id', parametres.etape)
		if (parametres.recherche !== '') {
			// `plfts` et non `ilike` : `search_tsv` est une colonne générée `STORED` indexée en GIN
			// (docs/SPEC-cards.md §2.7), qu'un `ilike '%…%'` ne peut pas employer. La configuration
			// `french` est **explicite**, comme dans la définition de la colonne : implicite, elle
			// dépendrait de `default_text_search_config`, paramètre de session.
			requete = requete.textSearch('search_tsv', parametres.recherche, {
				config: 'french',
				type: 'plain',
			})
		}
		for (const critere of ordreDe(parametres.tri, parametres.sens)) {
			requete = requete.order(critere.colonne, {
				ascending: critere.ascendant,
				nullsFirst: critere.nullsFirst,
			})
		}
		const plage = plageDe(parametres.page)
		const reponse = await requete.range(plage.de, plage.a)
		return classerReponsePage({
			statut: reponse.status,
			erreur:
				reponse.error === null
					? null
					: { code: reponse.error.code, message: reponse.error.message },
			donnees: reponse.data as readonly CardListe[] | null,
			total: reponse.count,
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Charge la page courante, et **retient le dernier total connu**.
 *
 * Le total survit à la lecture suivante parce qu'il sert à borner le rang demandé (§12.6) : sans
 * lui, une adresse portant `page=99` partirait chercher une page que la première réponse aurait
 * suffi à écarter.
 */
export function usePageCards(
	client: ClientCrm | null,
	channelId: string | undefined,
	parametres: ParametresListe,
): {
	readonly etat: EtatAsync<ContenuListe>
	readonly total: number | null
	readonly recharger: () => void
} {
	const [etat, setEtat] = useState<EtatAsync<ContenuListe>>(enChargement)
	const [total, setTotal] = useState<number | null>(null)
	const [tentative, setTentative] = useState(0)
	// Une réponse arrivée après le démontage ne doit pas écrire dans un composant démonté, ni une
	// réponse périmée écraser une réponse plus récente — le tri et la page changent au clic.
	const courant = useRef(0)

	const { tri, sens, etape, recherche, page } = parametres

	useEffect(() => {
		if (client === null || channelId === undefined) return
		const rang = ++courant.current
		setEtat(enChargement)
		void (async () => {
			const resultat = await lirePageCards(client, {
				channelId,
				parametres: { tri, sens, etape, recherche, page },
			})
			if (rang !== courant.current) return
			if (resultat.statut === 'pret' && resultat.donnees.nature === 'page') {
				setTotal(resultat.donnees.total)
			}
			setEtat(resultat)
		})()
	}, [client, channelId, tri, sens, etape, recherche, page, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, total, recharger }
}

/**
 * Les étapes du workflow du channel : la requête n° 1 du §12.3.
 *
 * Elles servent **deux** choses : le libellé et la couleur de l'étape de chaque ligne, et les choix
 * du filtre par étape — toutes les étapes, y compris celles qu'aucune card n'occupe (§12.5).
 *
 * La lecture est celle du board, importée et non réécrite (décision 188).
 */
export function useEtapesChannel(
	client: ClientCrm | null,
	workflowId: string | undefined,
): { readonly etat: EtatAsync<readonly EtapeBoard[]>; readonly recharger: () => void } {
	const [etat, setEtat] = useState<EtatAsync<readonly EtapeBoard[]>>(enChargement)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)

	useEffect(() => {
		if (client === null || workflowId === undefined) return
		const rang = ++courant.current
		setEtat(enChargement)
		void (async () => {
			const resultat = await lireEtapes(client, workflowId)
			if (rang !== courant.current) return
			if (resultat.statut !== 'pret') {
				setEtat(resultat)
				return
			}
			setEtat(pret(resultat.donnees.map(resoudreEtape)))
		})()
	}, [client, workflowId, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { etat, recharger }
}
