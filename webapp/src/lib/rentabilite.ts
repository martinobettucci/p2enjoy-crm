// @spec CRM-108 (docs/BACKLOG.md) — tranche T3 : la règle de rentabilité, appliquée aux sommes que la base rend
// @spec CRM-126 (docs/BACKLOG.md) — tranche T2 : une balance par devise dans un seul tableau (décision 810)
// @spec docs/SPEC-recettes.md §4.1 (les grandeurs : marge réelle, marge prévue, taux), §4.2 (la marge prévue soustrait le
//       personnel déjà valorisé), §4.3 (la marge partielle et ses trois causes), §4.4 (révision CRM-126 : les devises ne
//       s'additionnent jamais, la marge se calcule dans chaque devise, le taux est vide sur une ligne qui en mêle
//       plusieurs), §4.6 (le filtre d'état), §5 (les colonnes de `public.rentabilite_affaires`), §6.3 (un seul tableau,
//       l'arborescence track › channel › affaire, ses sous-totaux et son total en balance par devise)
// @spec docs/DESIGN_SYSTEM.md §5.60 (sous-totaux de track et de channel, total du tableau, une valeur par devise)
// @spec CRM-111 (docs/BACKLOG.md) — tranche T5.1 : une ligne par RATTACHEMENT × devise, `shared` ; un sous-total de
//       channel compte l'affaire sous chacun de ses channels, un sous-total de track et le total ne la comptent qu'une
//       fois ; le montant et l'état sont ceux du rattachement (docs/SPEC-rattachements.md §6, décision 643)
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

/** Une ligne de `public.rentabilite_affaires` : un rattachement × une devise (§5, `CRM-111` T5.1). */
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
	/** `CRM-111` T5.1 : l'affaire a plusieurs rattachements lisibles ; ses sommes sont rappelées sur chacun. */
	readonly partagee: boolean
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
			partagee: b.shared === true,
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

/** La rentabilité dans UNE devise. */
export type Rentabilite = {
	readonly recettes: number | null
	readonly couts: number | null
	readonly personnel: number | null
	/** `null` si rien n'est connu dans cette devise. */
	readonly marge: number | null
	/**
	 * En pourcentage à une décimale, vue « Réel » seulement ; `null` si les recettes réelles sont nulles ou inconnues, ou
	 * si la ligne mêle plusieurs devises — sa marge et ses recettes vivraient alors dans des devises différentes (§4.4).
	 */
	readonly taux: number | null
	/** `null` si la marge n'est pas partielle. */
	readonly partielle: CausesPartielle | null
}

/** Au centime, sans les restes binaires d'une soustraction de flottants (0,1 + 0,2). */
export const auCentime = (x: number): number => Math.round(x * 100) / 100

/**
 * La rentabilité d'une affaire ou d'un regroupement, dans une devise et une vue.
 *
 * - **marge** = recettes − coûts − personnel, chacun compté s'il est connu (§4.1), dans cette devise seule, toujours
 *   (§4.4) ; la vue « Prévu » soustrait le personnel DÉJÀ valorisé, le produit ne prévoyant pas le temps (§4.2) ;
 * - **taux** = marge réelle ÷ recettes réelles (§4.1), vide si `plusieursDevises` (§4.4) ;
 * - **partielle** : en vue « Réel », une ligne de recette ou de coût ouverte sans réel, ou du temps non valorisé ; en vue
 *   « Prévu », seul le temps non valorisé manque — les prévus sont toujours connus (§4.3).
 */
export function calculerRentabilite(m: Montants, vue: VueRentabilite, plusieursDevises: boolean): Rentabilite {
	const recettes = vue === 'reel' ? m.recettesReelles : m.recettesPrevues
	const couts = vue === 'reel' ? m.coutsReels : m.coutsPrevus
	const personnel = m.personnel
	const rienDeConnu = recettes === null && couts === null && personnel === null
	const marge = rienDeConnu ? null : auCentime((recettes ?? 0) - (couts ?? 0) - (personnel ?? 0))
	const taux =
		vue === 'reel' && !plusieursDevises && marge !== null && recettes !== null && recettes !== 0
			? Math.round((marge / recettes) * 1000) / 10
			: null
	const causes: CausesPartielle = {
		recettesSansReel: vue === 'reel' ? m.lignesRecetteSansReel : 0,
		coutsSansReel: vue === 'reel' ? m.lignesCoutSansReel : 0,
		minutesNonValorisees: m.minutesNonValorisees,
	}
	const partielle =
		causes.recettesSansReel > 0 || causes.coutsSansReel > 0 || causes.minutesNonValorisees > 0 ? causes : null
	return { recettes, couts, personnel, marge, taux, partielle }
}

/** Une devise et la rentabilité qui y est connue. */
export type BalanceDevise = { readonly devise: string; readonly rentabilite: Rentabilite }

/** La rentabilité d'une ligne du rapport — affaire, channel, track ou total —, en balance par devise (§4.4). */
export type RentabiliteLigne = {
	/** Une entrée par devise présente, dans l'ordre alphabétique des codes. */
	readonly parDevise: readonly BalanceDevise[]
	/** Vrai si la ligne est, ou contient, une affaire dont la base rend plusieurs devises : son taux est alors vide. */
	readonly plusieursDevises: boolean
	/** Les causes de toutes les devises : des comptes de lignes et de minutes, qui traversent les devises (§4.4). */
	readonly partielle: CausesPartielle | null
}

/** Les montants d'une affaire ou d'un regroupement, par devise. */
export type MontantsParDevise = ReadonlyMap<string, Montants>

/** La balance par devise d'une ligne, dans une vue. */
export function calculerLigne(montants: MontantsParDevise, vue: VueRentabilite, plusieursDevises: boolean): RentabiliteLigne {
	const devises = [...montants.keys()].sort()
	return {
		parDevise: devises.map((devise) => ({
			devise,
			rentabilite: calculerRentabilite(montants.get(devise) ?? MONTANTS_VIDES, vue, plusieursDevises),
		})),
		plusieursDevises,
		partielle: calculerRentabilite(sommerMontants([...montants.values()]), vue, plusieursDevises).partielle,
	}
}

/** Somme devise par devise : deux devises ne s'additionnent jamais (§4.4). */
export function sommerParDevise(liste: readonly MontantsParDevise[]): MontantsParDevise {
	const somme = new Map<string, Montants>()
	for (const m of liste) {
		for (const [devise, montants] of m) somme.set(devise, sommerMontants([somme.get(devise) ?? MONTANTS_VIDES, montants]))
	}
	return somme
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
	/** `CRM-111` T5.1 : le montant de chaque rattachement de l'affaire, par channel (§6 : le montant du rattachement). */
	readonly affaires: ReadonlyMap<
		string,
		{ readonly titre: string; readonly montants: ReadonlyMap<string, number | null>; readonly devise: string }
	>
}

export type AffaireDuRapport = {
	readonly cardId: string
	readonly titre: string
	readonly genre: GenreAffaire
	readonly archivee: boolean
	/** `CRM-111` T5.1 : l'affaire paraît aussi sous un autre channel ; un sous-total de track et le total la comptent une fois. */
	readonly partagee: boolean
	/** Le montant du rattachement, pour comparaison (§2.1), dans la devise de l'affaire. */
	readonly montant: { readonly valeur: number; readonly devise: string } | null
	readonly montants: MontantsParDevise
	readonly rentabilite: RentabiliteLigne
}

export type ChannelDuRapport = {
	readonly channelId: string
	readonly nom: string
	readonly slug: string
	readonly affaires: readonly AffaireDuRapport[]
	readonly sousTotal: RentabiliteLigne
}

export type TrackDuRapport = {
	readonly trackId: string
	readonly nom: string
	readonly slug: string
	readonly channels: readonly ChannelDuRapport[]
	readonly sousTotal: RentabiliteLigne
}

export type Rapport = {
	readonly tracks: readonly TrackDuRapport[]
	readonly total: RentabiliteLigne
	/** Les mentions sous le tableau (§6.3), toutes devises confondues : ce sont des lignes et des minutes, pas de l'argent. */
	readonly mentions: CausesPartielle
	readonly affaires: number
	/** `CRM-111` T5.2 : une ligne au moins est partagée ; la mention sous le tableau le dit (§5.60). */
	readonly partagee: boolean
}

const parRang = <T extends { readonly nom: string; readonly position: number }>(a: T, b: T): number =>
	a.position - b.position || a.nom.localeCompare(b.nom, 'fr')

/** La ligne d'un regroupement : ses balances par devise, mixte dès qu'une de ses affaires l'est (§4.4). */
const regrouper = (toutes: readonly AffaireDuRapport[], vue: VueRentabilite): RentabiliteLigne => {
	// `CRM-111` T5.1 : une affaire partagée paraît sous chacun de ses channels ; un regroupement qui la porte deux fois — un
	// track, le tableau — ne la compte qu'une fois. Ses sommes sont les mêmes sur chaque ligne : la première suffit.
	const vues = new Set<string>()
	const affaires = toutes.filter((a) => (vues.has(a.cardId) ? false : (vues.add(a.cardId), true)))
	return calculerLigne(
		sommerParDevise(affaires.map((a) => a.montants)),
		vue,
		affaires.some((a) => a.rentabilite.plusieursDevises),
	)
}

/**
 * Range les lignes en UN tableau, track › channel › affaire, avec ses sous-totaux et son total en balance par devise.
 *
 * - Une affaire paraît une fois, ses montants rangés par devise ; elle « mêle plusieurs devises » quand la base en rend
 *   plus d'une pour elle, et tout regroupement qui la contient aussi : leur taux est vide (§4.4).
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
	// Une affaire par chemin : la base rend une ligne par affaire et par devise, toutes sous le même chemin.
	const parAffaire = new Map<string, LigneRentabilite[]>()
	for (const l of lignes) {
		const cle = `${l.trackId}|${l.channelId}|${l.cardId}`
		parAffaire.set(cle, [...(parAffaire.get(cle) ?? []), l])
	}
	const affaires = [...parAffaire.values()].map((ls) => {
		const l = ls[0]!
		const a = noms.affaires.get(l.cardId)
		const montants: MontantsParDevise = new Map(ls.map((x) => [x.devise, x]))
		return {
			trackId: l.trackId,
			channelId: l.channelId,
			affaire: {
				cardId: l.cardId,
				titre: a?.titre ?? '',
				genre: l.genre,
				archivee: l.archivee,
				partagee: l.partagee,
				montant: (() => {
					const valeur = a?.montants.get(l.channelId) ?? null
					return a !== undefined && valeur !== null ? { valeur, devise: a.devise } : null
				})(),
				montants,
				rentabilite: calculerLigne(montants, vue, montants.size > 1),
			} satisfies AffaireDuRapport,
		}
	})

	const tracks = [...new Set(affaires.map((x) => x.trackId))]
		.map((trackId) => {
			const nommeT = noms.tracks.get(trackId)
			const duTrack = affaires.filter((x) => x.trackId === trackId)
			const channels = [...new Set(duTrack.map((x) => x.channelId))]
				.map((channelId) => {
					const nommeC = noms.channels.get(channelId)
					const duChannel = duTrack
						.filter((x) => x.channelId === channelId)
						.map((x) => x.affaire)
						.sort((x, y) => x.titre.localeCompare(y.titre, 'fr'))
					return {
						channelId,
						nom: nommeC?.nom ?? '',
						slug: nommeC?.slug ?? '',
						position: nommeC?.position ?? Number.MAX_SAFE_INTEGER,
						affaires: duChannel,
						sousTotal: regrouper(duChannel, vue),
					}
				})
				.sort(parRang)
				.map(({ position: _p, ...c }): ChannelDuRapport => c)
			return {
				trackId,
				nom: nommeT?.nom ?? '',
				slug: nommeT?.slug ?? '',
				position: nommeT?.position ?? Number.MAX_SAFE_INTEGER,
				channels,
				sousTotal: regrouper(channels.flatMap((c) => c.affaires), vue),
			}
		})
		.sort(parRang)
		.map(({ position: _p, ...t }): TrackDuRapport => t)

	// Les mentions comptent des lignes de recette et de coût, et des minutes : une affaire partagée une fois (`CRM-111`).
	const vues = new Set<string>()
	const somme = sommerMontants(
		lignes.filter((l) => {
			const cle = `${l.cardId}|${l.devise}`
			return vues.has(cle) ? false : (vues.add(cle), true)
		}),
	)
	return {
		tracks,
		total: regrouper(affaires.map((x) => x.affaire), vue),
		mentions: {
			recettesSansReel: somme.lignesRecetteSansReel,
			coutsSansReel: somme.lignesCoutSansReel,
			minutesNonValorisees: somme.minutesNonValorisees,
		},
		affaires: new Set(lignes.map((l) => l.cardId)).size,
		partagee: lignes.some((l) => l.partagee),
	}
}
