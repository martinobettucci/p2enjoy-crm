// @spec CRM-108 (docs/BACKLOG.md) — tranche T3 : la règle de rentabilité, appliquée aux sommes que la base rend
// @spec docs/SPEC-recettes.md §4.1 (les grandeurs : marge réelle, marge prévue, taux), §4.2 (la marge prévue soustrait le
//       personnel déjà valorisé), §4.3 (la marge partielle et ses trois causes), §4.4 (les devises ne s'additionnent
//       jamais : une affaire à plusieurs devises a une marge « non calculable »), §4.6 (le filtre d'état), §5 (les
//       colonnes de `public.rentabilite_affaires`), §6.3 (l'arborescence track › channel › affaire, ses sous-totaux)
// @spec docs/DESIGN_SYSTEM.md §5.60 (sous-totaux de track et de channel, total du tableau, un tableau par devise)
//
// MODULE SANS RENDU ET SANS REQUÊTE. La base rend des sommes et des comptes (§5) ; ce module en tire la marge, le taux et
// le caractère partiel, et range les affaires. Le connecteur applique la même règle en Python
// (`mcp/crm_mcp/rentabilite.py`) : les deux sont prouvés par les mêmes cas.
//
// « NUL N'EST PAS ZÉRO » TRAVERSE TOUT LE MODULE. Une recette ou un coût réel inconnu vaut `null`, jamais 0, et une somme
// de valeurs toutes inconnues reste `null`. Seule la marge les combine — en ne comptant que ce qui est connu — et c'est
// précisément pourquoi elle porte la marque « partielle » (§4.3).

/** Le genre du nœud de l'étape courante (`workflow_nodes_catalog.kind`). */
export type GenreAffaire = 'open' | 'won' | 'lost'

/** Une ligne de `public.rentabilite_affaires` : une affaire × une devise (§5). */
export type LigneRentabilite = {
	readonly workspaceId: string
	readonly trackId: string
	readonly channelId: string
	readonly cardId: string
	readonly genre: GenreAffaire
	readonly archivee: boolean
	readonly devise: string
	readonly recettesPrevues: number | null
	readonly recettesReelles: number | null
	readonly lignesRecette: number
	readonly lignesRecetteSansReel: number
	readonly coutsPrevus: number | null
	readonly coutsReels: number | null
	readonly lignesCout: number
	readonly lignesCoutSansReel: number
	readonly personnel: number | null
	readonly minutes: number
	readonly minutesNonValorisees: number
}

const nombreOuNul = (v: unknown): number | null => {
	if (v === null || v === undefined) return null
	const n = typeof v === 'number' ? v : Number(v)
	return Number.isFinite(n) ? n : null
}
const entier = (v: unknown): number => nombreOuNul(v) ?? 0
const genreConnu = (v: unknown): v is GenreAffaire => v === 'open' || v === 'won' || v === 'lost'

/**
 * Convertit une ligne brute de la fonction. Une ligne dont un identifiant, la devise ou le genre manque est écartée et
 * comptée : c'est une réponse non conforme, qu'on ne devine pas (`docs/SPEC-types.md`).
 */
export function lireLignesRentabilite(brutes: readonly Record<string, unknown>[]): {
	readonly lignes: readonly LigneRentabilite[]
	readonly ecartees: number
} {
	const lignes: LigneRentabilite[] = []
	let ecartees = 0
	for (const b of brutes) {
		const ids = [b.workspace_id, b.track_id, b.channel_id, b.card_id, b.currency]
		if (ids.some((v) => typeof v !== 'string' || v === '') || !genreConnu(b.node_kind)) {
			ecartees += 1
			continue
		}
		lignes.push({
			workspaceId: b.workspace_id as string,
			trackId: b.track_id as string,
			channelId: b.channel_id as string,
			cardId: b.card_id as string,
			genre: b.node_kind,
			archivee: b.archivee === true,
			devise: b.currency as string,
			recettesPrevues: nombreOuNul(b.recettes_prevues),
			recettesReelles: nombreOuNul(b.recettes_reelles),
			lignesRecette: entier(b.lignes_recette),
			lignesRecetteSansReel: entier(b.lignes_recette_sans_reel),
			coutsPrevus: nombreOuNul(b.couts_prevus),
			coutsReels: nombreOuNul(b.couts_reels),
			lignesCout: entier(b.lignes_cout),
			lignesCoutSansReel: entier(b.lignes_cout_sans_reel),
			personnel: nombreOuNul(b.personnel),
			minutes: entier(b.minutes),
			minutesNonValorisees: entier(b.minutes_non_valorisees),
		})
	}
	return { lignes, ecartees }
}

// ---------------------------------------------------------------------------------------------
// La règle — §4.1 à §4.4
// ---------------------------------------------------------------------------------------------

/** Les sommes d'une affaire, ou d'un regroupement, dans une devise. */
export type Montants = Pick<
	LigneRentabilite,
	| 'recettesPrevues'
	| 'recettesReelles'
	| 'lignesRecette'
	| 'lignesRecetteSansReel'
	| 'coutsPrevus'
	| 'coutsReels'
	| 'lignesCout'
	| 'lignesCoutSansReel'
	| 'personnel'
	| 'minutes'
	| 'minutesNonValorisees'
>

/** « Réel » ou « Prévu » : deux vues nommées de l'écran (§6.3). */
export type VueRentabilite = 'reel' | 'prevu'

/** Ce qui rend une marge partielle (§4.3) ; chaque compte nul est une cause absente. */
export type CausesPartielle = {
	readonly recettesSansReel: number
	readonly coutsSansReel: number
	readonly minutesNonValorisees: number
}

export type Rentabilite = {
	readonly recettes: number | null
	readonly couts: number | null
	readonly personnel: number | null
	/** `null` si rien n'est connu, ou si l'affaire mêle plusieurs devises (`calculable` faux). */
	readonly marge: number | null
	/** En pourcentage à une décimale, vue « Réel » seulement ; `null` si les recettes réelles sont nulles ou inconnues. */
	readonly taux: number | null
	readonly calculable: boolean
	/** `null` si la marge n'est pas partielle. */
	readonly partielle: CausesPartielle | null
}

/** Au centime, sans les restes binaires d'une soustraction de flottants (0,1 + 0,2). */
export const auCentime = (x: number): number => Math.round(x * 100) / 100

/**
 * La rentabilité d'une affaire ou d'un regroupement, dans une devise et une vue.
 *
 * - **marge** = recettes − coûts − personnel, chacun compté s'il est connu (§4.1) ; la vue « Prévu » soustrait le
 *   personnel DÉJÀ valorisé, le produit ne prévoyant pas le temps (§4.2) ;
 * - **taux** = marge réelle ÷ recettes réelles (§4.1) ;
 * - **partielle** : en vue « Réel », une ligne de recette ou de coût ouverte sans réel, ou du temps non valorisé ; en vue
 *   « Prévu », seul le temps non valorisé manque — les prévus sont toujours connus (§4.3).
 */
export function calculerRentabilite(m: Montants, vue: VueRentabilite, calculable: boolean): Rentabilite {
	const recettes = vue === 'reel' ? m.recettesReelles : m.recettesPrevues
	const couts = vue === 'reel' ? m.coutsReels : m.coutsPrevus
	const personnel = m.personnel
	const rienDeConnu = recettes === null && couts === null && personnel === null
	const marge =
		!calculable || rienDeConnu ? null : auCentime((recettes ?? 0) - (couts ?? 0) - (personnel ?? 0))
	const taux =
		vue === 'reel' && marge !== null && recettes !== null && recettes !== 0
			? Math.round((marge / recettes) * 1000) / 10
			: null
	const causes: CausesPartielle = {
		recettesSansReel: vue === 'reel' ? m.lignesRecetteSansReel : 0,
		coutsSansReel: vue === 'reel' ? m.lignesCoutSansReel : 0,
		minutesNonValorisees: m.minutesNonValorisees,
	}
	const partielle =
		causes.recettesSansReel > 0 || causes.coutsSansReel > 0 || causes.minutesNonValorisees > 0 ? causes : null
	return { recettes, couts, personnel, marge, taux, calculable, partielle }
}

/** La somme de deux valeurs possiblement inconnues : inconnue seulement si les deux le sont. */
const ajouter = (a: number | null, b: number | null): number | null =>
	a === null && b === null ? null : auCentime((a ?? 0) + (b ?? 0))

export const MONTANTS_VIDES: Montants = {
	recettesPrevues: null,
	recettesReelles: null,
	lignesRecette: 0,
	lignesRecetteSansReel: 0,
	coutsPrevus: null,
	coutsReels: null,
	lignesCout: 0,
	lignesCoutSansReel: 0,
	personnel: null,
	minutes: 0,
	minutesNonValorisees: 0,
}

export function sommerMontants(liste: readonly Montants[]): Montants {
	return liste.reduce<Montants>(
		(acc, m) => ({
			recettesPrevues: ajouter(acc.recettesPrevues, m.recettesPrevues),
			recettesReelles: ajouter(acc.recettesReelles, m.recettesReelles),
			lignesRecette: acc.lignesRecette + m.lignesRecette,
			lignesRecetteSansReel: acc.lignesRecetteSansReel + m.lignesRecetteSansReel,
			coutsPrevus: ajouter(acc.coutsPrevus, m.coutsPrevus),
			coutsReels: ajouter(acc.coutsReels, m.coutsReels),
			lignesCout: acc.lignesCout + m.lignesCout,
			lignesCoutSansReel: acc.lignesCoutSansReel + m.lignesCoutSansReel,
			personnel: ajouter(acc.personnel, m.personnel),
			minutes: acc.minutes + m.minutes,
			minutesNonValorisees: acc.minutesNonValorisees + m.minutesNonValorisees,
		}),
		MONTANTS_VIDES,
	)
}

// ---------------------------------------------------------------------------------------------
// Le filtre d'état — §4.6
// ---------------------------------------------------------------------------------------------

export const ETATS_RAPPORT = ['toutes', 'gagnees', 'en-cours', 'perdues'] as const
export type EtatRapport = (typeof ETATS_RAPPORT)[number]

const GENRE_DE_L_ETAT: Readonly<Record<Exclude<EtatRapport, 'toutes'>, GenreAffaire>> = {
	gagnees: 'won',
	'en-cours': 'open',
	perdues: 'lost',
}

/** Une valeur d'adresse inconnue replie sur « toutes », le défaut (§4.6). */
export const lireEtatRapport = (v: string | null): EtatRapport =>
	(ETATS_RAPPORT as readonly string[]).includes(v ?? '') ? (v as EtatRapport) : 'toutes'

export const lireVueRapport = (v: string | null): VueRentabilite => (v === 'prevu' ? 'prevu' : 'reel')

export const retenirEtat = (lignes: readonly LigneRentabilite[], etat: EtatRapport): readonly LigneRentabilite[] =>
	etat === 'toutes' ? lignes : lignes.filter((l) => l.genre === GENRE_DE_L_ETAT[etat])

// ---------------------------------------------------------------------------------------------
// L'arborescence — §6.3
// ---------------------------------------------------------------------------------------------

/** Ce que la seconde lecture rend pour nommer et ranger (tracks, channels, affaires lus sous la RLS). */
export type Noms = {
	readonly tracks: ReadonlyMap<string, { readonly nom: string; readonly position: number; readonly slug: string }>
	readonly channels: ReadonlyMap<string, { readonly nom: string; readonly position: number; readonly slug: string }>
	readonly affaires: ReadonlyMap<string, { readonly titre: string; readonly montant: number | null; readonly devise: string }>
}

export type AffaireDuRapport = {
	readonly cardId: string
	readonly titre: string
	readonly genre: GenreAffaire
	readonly archivee: boolean
	/** Le montant de l'affaire, pour comparaison (§2.1) ; seulement dans le tableau de SA devise. */
	readonly montant: number | null
	readonly montants: Montants
	readonly rentabilite: Rentabilite
	/** Les autres devises de l'affaire, quand elle en mêle plusieurs (§4.4). */
	readonly autresDevises: readonly string[]
}

export type ChannelDuRapport = {
	readonly channelId: string
	readonly nom: string
	readonly slug: string
	readonly affaires: readonly AffaireDuRapport[]
	readonly sousTotal: Rentabilite
}

export type TrackDuRapport = {
	readonly trackId: string
	readonly nom: string
	readonly slug: string
	readonly channels: readonly ChannelDuRapport[]
	readonly sousTotal: Rentabilite
}

export type TableauDevise = {
	readonly devise: string
	readonly tracks: readonly TrackDuRapport[]
	readonly total: Rentabilite
}

export type Rapport = {
	readonly tableaux: readonly TableauDevise[]
	/** Les mentions sous les tableaux (§6.3), toutes devises confondues : ce sont des lignes et des minutes, pas de l'argent. */
	readonly mentions: CausesPartielle
	readonly affaires: number
}

const parRang = <T extends { readonly nom: string; readonly position: number }>(a: T, b: T): number =>
	a.position - b.position || a.nom.localeCompare(b.nom, 'fr')

/**
 * Range les lignes en un tableau par devise, chacun en track › channel › affaire avec ses sous-totaux.
 *
 * - Les devises suivent l'ordre alphabétique, EUR et CHF ne se mêlant jamais (§4.4).
 * - Un sous-total n'est **calculable** que si aucune de ses affaires ne mêle plusieurs devises : la somme de ses
 *   montants reste juste, mais une marge qui inclurait la moitié d'une affaire facturée ailleurs serait fausse.
 * - Un track ou un channel que la seconde lecture n'a pas nommé garde sa place, sous un nom vide, plutôt que de
 *   retrancher ses affaires du total (`docs/DESIGN_SYSTEM.md` §5.37).
 */
export function construireRapport(
	toutes: readonly LigneRentabilite[],
	etat: EtatRapport,
	vue: VueRentabilite,
	noms: Noms,
): Rapport {
	const lignes = retenirEtat(toutes, etat)
	const devisesDeLAffaire = new Map<string, Set<string>>()
	for (const l of lignes) {
		const s = devisesDeLAffaire.get(l.cardId) ?? new Set<string>()
		s.add(l.devise)
		devisesDeLAffaire.set(l.cardId, s)
	}
	const calculable = (cardId: string): boolean => (devisesDeLAffaire.get(cardId)?.size ?? 0) <= 1

	const devises = [...new Set(lignes.map((l) => l.devise))].sort()
	const tableaux = devises.map((devise): TableauDevise => {
		const deLaDevise = lignes.filter((l) => l.devise === devise)
		const trackIds = [...new Set(deLaDevise.map((l) => l.trackId))]
		const tracks = trackIds
			.map((trackId) => {
				const nommeT = noms.tracks.get(trackId)
				const duTrack = deLaDevise.filter((l) => l.trackId === trackId)
				const channels = [...new Set(duTrack.map((l) => l.channelId))]
					.map((channelId) => {
						const nommeC = noms.channels.get(channelId)
						const affaires = duTrack
							.filter((l) => l.channelId === channelId)
							.map((l): AffaireDuRapport => {
								const a = noms.affaires.get(l.cardId)
								return {
									cardId: l.cardId,
									titre: a?.titre ?? '',
									genre: l.genre,
									archivee: l.archivee,
									montant: a !== undefined && a.devise === devise ? a.montant : null,
									montants: l,
									rentabilite: calculerRentabilite(l, vue, calculable(l.cardId)),
									autresDevises: [...(devisesDeLAffaire.get(l.cardId) ?? [])].filter((d) => d !== devise).sort(),
								}
							})
							.sort((x, y) => x.titre.localeCompare(y.titre, 'fr'))
						return {
							channelId,
							nom: nommeC?.nom ?? '',
							slug: nommeC?.slug ?? '',
							position: nommeC?.position ?? Number.MAX_SAFE_INTEGER,
							affaires,
							sousTotal: calculerRentabilite(
								sommerMontants(affaires.map((a) => a.montants)),
								vue,
								affaires.every((a) => a.rentabilite.calculable),
							),
						}
					})
					.sort(parRang)
					.map(({ position: _p, ...c }): ChannelDuRapport => c)
				const toutesAffaires = channels.flatMap((c) => c.affaires)
				return {
					trackId,
					nom: nommeT?.nom ?? '',
					slug: nommeT?.slug ?? '',
					position: nommeT?.position ?? Number.MAX_SAFE_INTEGER,
					channels,
					sousTotal: calculerRentabilite(
						sommerMontants(toutesAffaires.map((a) => a.montants)),
						vue,
						toutesAffaires.every((a) => a.rentabilite.calculable),
					),
				}
			})
			.sort(parRang)
			.map(({ position: _p, ...t }): TrackDuRapport => t)
		const toutesAffaires = tracks.flatMap((t) => t.channels.flatMap((c) => c.affaires))
		return {
			devise,
			tracks,
			total: calculerRentabilite(
				sommerMontants(toutesAffaires.map((a) => a.montants)),
				vue,
				toutesAffaires.every((a) => a.rentabilite.calculable),
			),
		}
	})

	const somme = sommerMontants(lignes)
	return {
		tableaux,
		mentions: {
			recettesSansReel: somme.lignesRecetteSansReel,
			coutsSansReel: somme.lignesCoutSansReel,
			minutesNonValorisees: somme.minutesNonValorisees,
		},
		affaires: devisesDeLAffaire.size,
	}
}
