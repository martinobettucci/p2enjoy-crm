// @verifies CRM-042 (docs/BACKLOG.md) — composition de la vue liste : tri, filtres, pagination
// @verifies CRM-022 (docs/BACKLOG.md) — relation responsable embarquée
// @verifies docs/SPEC-cards.md §12.2 (repli des paramètres d'adresse), §12.3 (ce que la liste
//           lit, et le total exact), §12.4 (clôture des tris, ordre TOTAL, `nullslast`),
//           §12.5 (filtres côté serveur, `plfts` et non `ilike`), §12.6 (pagination et `416`)
// @verifies docs/SPEC-cards.md §5 (« active ») ; docs/SPEC-permissions-rls.md §7 (zéro ligne)
//
// Ce fichier éprouve **la requête réellement émise** autant que la valeur rendue. Motif repris de
// `board.test.ts` : plusieurs exigences du §12 sont portées par la requête elle-même — les deux
// filtres d'activité, le filtre d'étape, la recherche plein texte, l'ordre total, la plage — et un
// test qui n'observerait que la réponse les laisserait disparaître sans bruit.
//
// La composition, elle, est éprouvée **sans navigateur** : c'est tout l'objet de la séparation
// entre `liste-cards.ts` et `ListeCards.tsx`.

import { describe, expect, it } from 'vitest'
import {
	CLES_URL,
	CODE_PAGE_INEXISTANTE,
	COLONNES_CARD_LISTE,
	LIGNES_PAR_PAGE,
	PARAMETRES_PAR_DEFAUT,
	TRIS,
	TRI_PAR_DEFAUT,
	bornerPage,
	classerReponsePage,
	ecrireParametres,
	lireParametres,
	lirePageCards,
	nombreDePages,
	ordreDe,
	plageDe,
	type CardListe,
	type CleTri,
	type ParametresListe,
	type ReponseLue,
} from './liste-cards'
import type { ClientCrm } from './supabase'

const CHANNEL = '5eed0000-0000-4000-8000-000000000032'
const ETAPE = '5eed0000-0000-4000-8000-000000000062'

function parametres(partiel: Partial<ParametresListe> = {}): ParametresListe {
	return { ...PARAMETRES_PAR_DEFAUT, ...partiel }
}

function card(partiel: Partial<CardListe> & Pick<CardListe, 'id'>): CardListe {
	return {
		title: partiel.id,
		amount: null,
		currency: 'EUR',
		next_action: null,
		next_action_at: null,
		current_step_id: ETAPE,
		// Défaut du jeu d'essai : une affaire qui n'a jamais dormi (`CRM-081` tranche 2 b).
		snoozed_until: null,
		owner_id: null,
		responsable: null,
		...partiel,
	}
}

// --- Le tri (§12.4) --------------------------------------------------------------------------

describe('le tri de la vue liste (§12.4)', () => {
	it('offre exactement quatre clés, et la liste est close', () => {
		expect(TRIS.map((tri) => tri.cle)).toEqual(['title', 'amount', 'next_action_at', 'created_at'])
	})

	// Le sens par défaut n'est pas uniforme : on cherche la plus grosse affaire, mais l'échéance
	// la plus proche. Une inversion ici passerait inaperçue à l'écran.
	it('donne à chaque clé le sens que la spécification lui attribue', () => {
		expect(Object.fromEntries(TRIS.map((tri) => [tri.cle, tri.sensParDefaut]))).toEqual({
			title: 'asc',
			amount: 'desc',
			next_action_at: 'asc',
			created_at: 'desc',
		})
	})

	// LA règle de l'unité. Sans `id`, une marche paginée perd des lignes : MESURÉ sur la sonde
	// `sonde_l2`, 20 lignes rendues dont 17 distinctes (décision 185).
	it('termine TOUJOURS par `id`, la clé primaire, ce qui rend l’ordre total', () => {
		for (const tri of TRIS) {
			for (const sens of ['asc', 'desc'] as const) {
				const ordre = ordreDe(tri.cle, sens)
				const dernier = ordre[ordre.length - 1]
				expect(dernier?.colonne).toBe('id')
				expect(dernier?.ascendant).toBe(true)
			}
		}
	})

	it('intercale `title` pour les tris qui ne portent pas sur lui, et pas pour celui qui y porte', () => {
		expect(ordreDe('amount', 'desc').map((critere) => critere.colonne)).toEqual([
			'amount',
			'title',
			'id',
		])
		expect(ordreDe('title', 'asc').map((critere) => critere.colonne)).toEqual(['title', 'id'])
	})

	it('n’émet jamais deux fois la même colonne', () => {
		for (const tri of TRIS) {
			const colonnes = ordreDe(tri.cle, 'asc').map((critere) => critere.colonne)
			expect(new Set(colonnes).size).toBe(colonnes.length)
		}
	})

	// Sans `nullslast`, `order=amount.desc` ferait remonter en tête les affaires SANS montant.
	it('range les valeurs absentes en dernier, dans les deux sens', () => {
		for (const sens of ['asc', 'desc'] as const) {
			for (const critere of ordreDe('amount', sens)) {
				expect(critere.nullsFirst).toBe(false)
			}
		}
	})

	it('porte le sens demandé sur la clé principale, et sur elle seule', () => {
		const ordre = ordreDe('next_action_at', 'desc')
		expect(ordre[0]).toEqual({ colonne: 'next_action_at', ascendant: false, nullsFirst: false })
		expect(ordre.slice(1).every((critere) => critere.ascendant)).toBe(true)
	})
})

// --- Les paramètres d'adresse (§12.2) --------------------------------------------------------

describe('les paramètres d’adresse (§12.2)', () => {
	it('rend les défauts sur une adresse nue', () => {
		expect(lireParametres(new URLSearchParams())).toEqual(PARAMETRES_PAR_DEFAUT)
	})

	// TÉMOIN RÉVISÉ, `CRM-081` tranche 2 b : cette assertion figeait l'ensemble des paramètres à
	// CINQ champs. Le sommeil en ajoute un sixième (§16.12.4), et un `toEqual` exhaustif devient
	// rouge par arbitrage, non par défaut. Le champ est donc nommé avec sa valeur attendue — son
	// DÉFAUT, l'adresse d'essai ne portant pas `sommeil` —, ce qui garde la propriété que
	// l'assertion éprouvait : rien d'autre que ce qui est écrit n'entre dans les paramètres.
	it('lit un tri, un sens, une étape, une recherche et un rang de page', () => {
		const lus = lireParametres(
			new URLSearchParams({ tri: 'amount', sens: 'asc', etape: ETAPE, q: 'refonte', page: '3' }),
		)
		expect(lus).toEqual({
			tri: 'amount',
			sens: 'asc',
			etape: ETAPE,
			recherche: 'refonte',
			page: 3,
			sommeil: 'masquees',
		})
	})

	// LA clôture : un `tri=` inconnu ne devient jamais un `order=` envoyé à PostgREST (§12.2).
	it('replie une clé de tri inconnue sur le défaut, sans erreur', () => {
		const lus = lireParametres(new URLSearchParams({ tri: 'couleur_préférée' }))
		expect(lus.tri).toBe(TRI_PAR_DEFAUT)
		expect(ordreDe(lus.tri, lus.sens).map((critere) => critere.colonne)).not.toContain(
			'couleur_préférée',
		)
	})

	it('replie un sens inconnu sur celui de la clé demandée, non sur « asc » aveuglément', () => {
		expect(lireParametres(new URLSearchParams({ tri: 'amount', sens: 'ascendant' })).sens).toBe('desc')
		expect(lireParametres(new URLSearchParams({ tri: 'title', sens: 'ascendant' })).sens).toBe('asc')
	})

	// La FORME de l'étape est vérifiée avant d'entrer dans un `eq.` : un `current_step_id=eq.zzz`
	// rendrait `400`, et la différence entre un `200` et un `400` renseigne un appelant.
	it('ignore une étape qui n’a pas la forme d’un UUID', () => {
		expect(lireParametres(new URLSearchParams({ etape: 'zzz' })).etape).toBeNull()
		expect(lireParametres(new URLSearchParams({ etape: "1'; drop table cards --" })).etape).toBeNull()
		expect(lireParametres(new URLSearchParams({ etape: ETAPE })).etape).toBe(ETAPE)
	})

	it('replie un rang de page absurde sur 1', () => {
		for (const page of ['0', '-4', 'trois', '', 'NaN']) {
			expect(lireParametres(new URLSearchParams({ page })).page).toBe(1)
		}
	})

	it('découpe les espaces d’une recherche, et une recherche d’espaces vaut aucune recherche', () => {
		expect(lireParametres(new URLSearchParams({ q: '  refonte  ' })).recherche).toBe('refonte')
		expect(lireParametres(new URLSearchParams({ q: '   ' })).recherche).toBe('')
	})

	it('omet de l’adresse tout ce qui vaut son défaut', () => {
		expect(ecrireParametres(PARAMETRES_PAR_DEFAUT).toString()).toBe('')
		expect(ecrireParametres(parametres({ tri: 'amount', sens: 'desc' })).toString()).toBe(
			'tri=amount',
		)
	})

	it('écrit un sens qui n’est pas celui par défaut de sa clé', () => {
		const ecrit = ecrireParametres(parametres({ tri: 'amount', sens: 'asc' }))
		expect(ecrit.get(CLES_URL.tri)).toBe('amount')
		expect(ecrit.get(CLES_URL.sens)).toBe('asc')
	})

	// Aller-retour : ce qui est écrit doit se relire à l'identique, sans quoi un rechargement
	// changerait l'écran (§12.2).
	it('relit à l’identique ce qu’il a écrit', () => {
		const cas: ParametresListe[] = [
			PARAMETRES_PAR_DEFAUT,
			parametres({ tri: 'amount', sens: 'asc', page: 4 }),
			parametres({ tri: 'created_at', sens: 'desc', etape: ETAPE, recherche: 'audit' }),
			parametres({ tri: 'next_action_at', sens: 'desc', page: 12 }),
		]
		for (const attendu of cas) {
			expect(lireParametres(ecrireParametres(attendu))).toEqual(attendu)
		}
	})
})

// --- La pagination (§12.6) -------------------------------------------------------------------

describe('la pagination (§12.6)', () => {
	it('compte les pages, et n’en compte jamais zéro', () => {
		expect(nombreDePages(0)).toBe(1)
		expect(nombreDePages(1)).toBe(1)
		expect(nombreDePages(LIGNES_PAR_PAGE)).toBe(1)
		expect(nombreDePages(LIGNES_PAR_PAGE + 1)).toBe(2)
		expect(nombreDePages(LIGNES_PAR_PAGE * 3)).toBe(3)
	})

	it('découpe la plage `Range` d’une page, bornes incluses', () => {
		expect(plageDe(1)).toEqual({ de: 0, a: LIGNES_PAR_PAGE - 1 })
		expect(plageDe(2)).toEqual({ de: LIGNES_PAR_PAGE, a: 2 * LIGNES_PAR_PAGE - 1 })
		expect(plageDe(4)).toEqual({ de: 3 * LIGNES_PAR_PAGE, a: 4 * LIGNES_PAR_PAGE - 1 })
	})

	// Règle 1 du §12.6 : sans elle, `page=99` part chercher une page que la première réponse
	// suffisait à écarter, et rend le `416`.
	it('borne un rang de page par le total connu', () => {
		expect(bornerPage(99, 3)).toBe(1)
		expect(bornerPage(99, LIGNES_PAR_PAGE * 2 + 1)).toBe(3)
		expect(bornerPage(2, LIGNES_PAR_PAGE + 1)).toBe(2)
	})

	// Borner par un total qu'on n'a pas reviendrait à inventer une valeur par défaut (§18).
	it('ne borne rien tant qu’aucun total n’a été rapporté', () => {
		expect(bornerPage(99, null)).toBe(99)
	})

	it('ramène toujours au plancher, quel que soit le total', () => {
		expect(bornerPage(0, null)).toBe(1)
		expect(bornerPage(-3, 100)).toBe(1)
		expect(bornerPage(Number.NaN, 100)).toBe(1)
	})
})

// --- La classification d'une réponse (§12.6, règle 2) ----------------------------------------

describe('la classification d’une réponse de page (§12.6)', () => {
	const page: ReponseLue = { statut: 206, erreur: null, donnees: [card({ id: 'c1' })], total: 3 }

	it('rend la page et son total lorsque la réponse aboutit', () => {
		const etat = classerReponsePage(page)
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees).toEqual({ nature: 'page', cards: [card({ id: 'c1' })], total: 3 })
	})

	// MESURÉ : `.range(4, 28)` sur trois lignes rend `416`, `PGRST103`, `count: null`, `data: null`.
	// Le classer parmi les erreurs afficherait « Chargement impossible » (décision 186).
	it('reconnaît le `416` de PostgREST et le nomme, au lieu d’en faire une erreur', () => {
		const etat = classerReponsePage({
			statut: 416,
			erreur: { code: CODE_PAGE_INEXISTANTE, message: 'Requested range not satisfiable' },
			donnees: null,
			total: null,
		})
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees.nature).toBe('page_inexistante')
	})

	// Il est reconnu par son CODE, jamais par le texte du message, qui dépend de la version.
	it('n’absorbe pas un autre refus, même s’il porte un message ressemblant', () => {
		const etat = classerReponsePage({
			statut: 400,
			erreur: { code: 'PGRST100', message: 'Requested range not satisfiable' },
			donnees: null,
			total: null,
		})
		expect(etat.statut).toBe('erreur')
	})

	it('classe un refus explicite du backend en `forbidden`', () => {
		const etat = classerReponsePage({
			statut: 403,
			erreur: { code: '42501', message: 'permission denied' },
			donnees: null,
			total: null,
		})
		expect(etat.statut).toBe('erreur')
		if (etat.statut !== 'erreur') return
		expect(etat.erreur.nature).toBe('forbidden')
	})

	// Un total absent n'est pas un total de zéro : afficher « aucune affaire » parce qu'on n'a pas
	// su compter serait la valeur par défaut trompeuse que CLAUDE.md §18 proscrit.
	it('refuse de transformer un total manquant en zéro', () => {
		const etat = classerReponsePage({ statut: 200, erreur: null, donnees: [], total: null })
		expect(etat.statut).toBe('erreur')
	})

	// Le refus par RLS rend `200` et zéro ligne : c'est un état VIDE, pas une erreur (§12.9).
	it('rend une page vide, et non une erreur, sur le refus par défaut de la RLS', () => {
		const etat = classerReponsePage({ statut: 200, erreur: null, donnees: [], total: 0 })
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees).toEqual({ nature: 'page', cards: [], total: 0 })
	})
})

// --- La requête réellement émise (§12.3, §12.5) ----------------------------------------------

type Appel = {
	table?: string
	colonnes?: string
	options?: { count?: string }
	egalites: [string, unknown][]
	nuls: string[]
	tris: [string, { ascending?: boolean; nullsFirst?: boolean }][]
	recherches: [string, string, { config?: string; type?: string }][]
	/**
	 * Les filtres `or=` envoyés — le filtre d'exclusion du sommeil, et lui seul aujourd'hui
	 * (`CRM-081` tranche 2 b, docs/SPEC-cards.md §16.12.1).
	 *
	 * SON ABSENCE DE CE JEU D'ESSAI A LAISSÉ HUIT TESTS ROUGES. La chaîne factice ne portait aucun
	 * `or`, et le mode par défaut de la vue liste en émet un à chaque lecture : les huit tests qui
	 * observent la requête tombaient sur `chaine.or is not a function` avant leur assertion. Une
	 * chaîne factice doit porter TOUTE méthode que le module appelle, sans quoi elle ne mesure plus
	 * le module mais elle-même.
	 */
	ou: string[]
	plage?: [number, number]
}

type Reponse = {
	data: unknown[] | null
	error: { code?: string; message: string } | null
	status: number
	count: number | null
}

/** Client factice qui **enregistre** la requête construite, puis rend la réponse voulue. */
function clientEspion(reponse: Reponse): { client: ClientCrm; appel: Appel } {
	const appel: Appel = { egalites: [], nuls: [], tris: [], recherches: [], ou: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.egalites.push([colonne, valeur])
			return chaine
		},
		or: (filtre: string) => {
			appel.ou.push(filtre)
			return chaine
		},
		is: (colonne: string) => {
			appel.nuls.push(colonne)
			return chaine
		},
		order: (colonne: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) => {
			appel.tris.push([colonne, options])
			return chaine
		},
		textSearch: (colonne: string, termes: string, options: { config?: string; type?: string } = {}) => {
			appel.recherches.push([colonne, termes, options])
			return chaine
		},
		range: (de: number, a: number) => {
			appel.plage = [de, a]
			return Promise.resolve(reponse)
		},
	}
	const client = {
		from: (table: string) => {
			appel.table = table
			return {
				select: (colonnes: string, options?: { count?: string }) => {
					appel.colonnes = colonnes
					appel.options = options
					return chaine
				},
			}
		},
	} as unknown as ClientCrm
	return { client, appel }
}

const OK: Reponse = { data: [], error: null, status: 200, count: 0 }

describe('la lecture d’une page (§12.3)', () => {
	it('demande les colonnes du §12.7, et pas une de plus', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres() })
		expect(appel.table).toBe('cards')
		expect(appel.colonnes).toBe(COLONNES_CARD_LISTE)
	})

	it('embarque le responsable et ne demande aucune colonne non affichée', () => {
		expect(COLONNES_CARD_LISTE).toContain('owner_id')
		expect(COLONNES_CARD_LISTE).toContain('responsable:profiles!cards_owner_id_fkey')
		for (const absente of ['position', 'description', 'health_score']) {
			expect(COLONNES_CARD_LISTE).not.toContain(absente)
		}
	})

	// MESURÉ : `count=planned` rend 1 là où la table en porte 3 (décision 187).
	it('demande un total EXACT, jamais estimé', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres() })
		expect(appel.options?.count).toBe('exact')
	})

	// La définition d'« active » du §5, la même qu'emploie la première vérification de `move_card`.
	it('exclut les cards archivées et en corbeille, côté SERVEUR', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres() })
		expect(appel.egalites).toContainEqual(['channel_id', CHANNEL])
		expect(appel.nuls).toEqual(['archived_at', 'deleted_at'])
	})

	it('envoie l’ordre TOTAL du §12.4, dans l’ordre', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, {
			channelId: CHANNEL,
			parametres: parametres({ tri: 'amount', sens: 'desc' }),
		})
		expect(appel.tris).toEqual([
			['amount', { ascending: false, nullsFirst: false }],
			['title', { ascending: true, nullsFirst: false }],
			['id', { ascending: true, nullsFirst: false }],
		])
	})

	it('n’envoie aucun filtre d’étape lorsque l’adresse n’en porte pas', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres() })
		expect(appel.egalites.map(([colonne]) => colonne)).not.toContain('current_step_id')
	})

	it('filtre par étape côté serveur lorsque l’adresse en porte une', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, {
			channelId: CHANNEL,
			parametres: parametres({ etape: ETAPE }),
		})
		expect(appel.egalites).toContainEqual(['current_step_id', ETAPE])
	})

	// `plfts` et non `ilike` : `search_tsv` est une colonne générée indexée en GIN (§2.7), qu'un
	// `ilike '%…%'` ne peut pas employer.
	//
	// ASSERTION RÉVISÉE LE 2026-08-27, JAMAIS RETIRÉE (mécanisme de la décision 51). Motif :
	// l'arbitrage de la décision 532 §2, qui ferme INC-230 — le produit n'a plus qu'UN vocabulaire
	// de recherche, `francais_sans_accent`, et la vue liste l'emploie comme la palette.
	//
	// CE QU'ELLE PROTÈGE EST L'ACCORD ENTRE LA REQUÊTE ET LA COLONNE (migration 0069). Désaccordées,
	// elles ne produisent AUCUNE erreur — ni au typage, ni à l'exécution : seulement une recherche
	// qui ne trouve plus rien, en silence. C'est le mode de défaillance que ce test existe pour
	// rendre bruyant.
	it('cherche dans `search_tsv`, en configuration `francais_sans_accent` EXPLICITE', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, {
			channelId: CHANNEL,
			parametres: parametres({ recherche: 'refonte' }),
		})
		expect(appel.recherches).toEqual([
			['search_tsv', 'refonte', { config: 'francais_sans_accent', type: 'plain' }],
		])
	})

	it('n’émet aucune recherche lorsque l’adresse n’en porte pas', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres() })
		expect(appel.recherches).toEqual([])
	})

	it('demande la plage de la page courante', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres({ page: 3 }) })
		expect(appel.plage).toEqual([2 * LIGNES_PAR_PAGE, 3 * LIGNES_PAR_PAGE - 1])
	})

	it('rend la page et son total lorsque la pile répond', async () => {
		const { client } = clientEspion({
			data: [card({ id: 'c1' }), card({ id: 'c2' })],
			error: null,
			status: 206,
			count: 42,
		})
		const etat = await lirePageCards(client, { channelId: CHANNEL, parametres: parametres() })
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret' || etat.donnees.nature !== 'page') return
		expect(etat.donnees.total).toBe(42)
		expect(etat.donnees.cards).toHaveLength(2)
	})

	it('nomme la page inexistante lorsque la pile rend son `416`', async () => {
		const { client } = clientEspion({
			data: null,
			error: { code: CODE_PAGE_INEXISTANTE, message: 'Requested range not satisfiable' },
			status: 416,
			count: null,
		})
		const etat = await lirePageCards(client, { channelId: CHANNEL, parametres: parametres({ page: 9 }) })
		expect(etat.statut).toBe('pret')
		if (etat.statut !== 'pret') return
		expect(etat.donnees.nature).toBe('page_inexistante')
	})

	// Une exception du transport n'est pas une page vide : elle est une erreur réseau.
	it('classe une exception du transport en erreur réseau', async () => {
		const client = {
			from: () => {
				throw new Error('réseau coupé')
			},
		} as unknown as ClientCrm
		const etat = await lirePageCards(client, { channelId: CHANNEL, parametres: parametres() })
		expect(etat.statut).toBe('erreur')
		if (etat.statut !== 'erreur') return
		expect(etat.erreur.nature).toBe('network')
	})

	// Le pas de pagination est déclaré UNE fois : une preuve qui le recopierait resterait verte
	// après un changement de valeur (§12.6).
	it('tient son pas de pagination du module, jamais d’une constante recopiée', () => {
		expect(LIGNES_PAR_PAGE).toBeGreaterThan(0)
		expect(plageDe(2).de).toBe(LIGNES_PAR_PAGE)
	})

	it('accepte chacune des quatre clés de tri sans en refuser aucune', async () => {
		for (const tri of TRIS) {
			const { client, appel } = clientEspion(OK)
			await lirePageCards(client, {
				channelId: CHANNEL,
				parametres: parametres({ tri: tri.cle as CleTri, sens: tri.sensParDefaut }),
			})
			expect(appel.tris[0]?.[0]).toBe(tri.cle)
		}
	})
})

// --- Le sommeil : le cinquième paramètre et son filtre (`CRM-081` tranche 2 b) ------------------
//
// @verifies CRM-081 (docs/BACKLOG.md) — tranche 2 b : le filtre de la vue liste
// @verifies docs/SPEC-cards.md §16.12.1 (le prédicat d'exclusion et sa forme), §16.12.2 (l'instant
//           est envoyé comme VALEUR), §16.12.3 (la liste filtre au SERVEUR, avant la plage),
//           §16.12.4 (le paramètre d'adresse, son défaut et sa clôture)

describe('le paramètre `sommeil` dans l’adresse (§16.12.4)', () => {
	it('vaut « masquées » sur une adresse nue : c’est la Definition of Done elle-même', () => {
		expect(lireParametres(new URLSearchParams()).sommeil).toBe('masquees')
		expect(PARAMETRES_PAR_DEFAUT.sommeil).toBe('masquees')
	})

	it('lit « visibles » lorsque l’adresse le demande', () => {
		expect(lireParametres(new URLSearchParams('sommeil=visibles')).sommeil).toBe('visibles')
	})

	// La clôture, comme celle des tris : une valeur inconnue ne doit jamais faire apparaître des
	// affaires qu'on croyait rangées, même par une faute de frappe dans une adresse partagée.
	it('replie sur le défaut TOUTE valeur inconnue, y compris une casse différente', () => {
		for (const valeur of ['', 'masquees', 'Visibles', 'VISIBLES', 'oui', 'true', '1', 'visible']) {
			expect(lireParametres(new URLSearchParams(`sommeil=${valeur}`)).sommeil).toBe('masquees')
		}
	})

	it('n’écrit JAMAIS le défaut dans l’adresse : la vue par défaut reste la plus courte', () => {
		expect(ecrireParametres(parametres()).has(CLES_URL.sommeil)).toBe(false)
		expect(ecrireParametres(parametres({ sommeil: 'masquees' })).toString()).toBe('')
	})

	it('écrit « visibles », et fait l’aller-retour sans se perdre', () => {
		const ecrite = ecrireParametres(parametres({ sommeil: 'visibles' }))
		expect(ecrite.get(CLES_URL.sommeil)).toBe('visibles')
		expect(lireParametres(ecrite).sommeil).toBe('visibles')
	})

	it('cohabite avec les quatre autres paramètres sans en écraser un', () => {
		const ecrite = ecrireParametres(
			parametres({ tri: 'amount', sens: 'desc', etape: ETAPE, recherche: 'vallier', page: 3, sommeil: 'visibles' }),
		)
		const relue = lireParametres(ecrite)
		expect(relue.sommeil).toBe('visibles')
		expect(relue.tri).toBe('amount')
		expect(relue.etape).toBe(ETAPE)
		expect(relue.recherche).toBe('vallier')
		expect(relue.page).toBe(3)
	})
})

describe('le filtre du sommeil dans la requête de page (§16.12.1, §16.12.3)', () => {
	const INSTANT = new Date('2026-08-17T10:00:00.000Z')

	it('exclut les affaires en sommeil par défaut, côté SERVEUR', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres(), maintenant: INSTANT })
		expect(appel.ou).toEqual(['snoozed_until.is.null,snoozed_until.lte.2026-08-17T10:00:00.000Z'])
	})

	// LE FILTRE PART AVANT LA PLAGE, et c'est la règle du §12.5 : appliqué après la pagination, il ne
	// verrait que les 25 lignes rapportées et le total annoncerait des pages qui n'existent pas.
	// La chaîne factice ne rend la réponse que sur `range` : un `or` enregistré prouve donc qu'il a
	// été construit avant elle.
	it('envoie le filtre AVANT la plage, jamais après', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres(), maintenant: INSTANT })
		expect(appel.ou).toHaveLength(1)
		expect(appel.plage).toEqual([0, LIGNES_PAR_PAGE - 1])
	})

	it('n’envoie AUCUN filtre de sommeil en mode « visibles »', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, {
			channelId: CHANNEL,
			parametres: parametres({ sommeil: 'visibles' }),
			maintenant: INSTANT,
		})
		expect(appel.ou).toEqual([])
	})

	// « nulle OU échue », jamais `not.gt` : une colonne NULLE ne satisfait aucune comparaison, et
	// `not.gt` écarterait toutes les affaires qui n'ont jamais dormi — l'immense majorité.
	it('écrit « nulle OU échue » et non une négation de comparaison', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres(), maintenant: INSTANT })
		expect(appel.ou[0]).toContain('snoozed_until.is.null')
		expect(appel.ou[0]).toContain('snoozed_until.lte.')
		expect(appel.ou[0]).not.toContain('not.gt')
	})

	// L'instant est une VALEUR (§16.12.2) : PostgREST n'évalue aucune fonction dans un filtre, et
	// `lte.now()` comparerait à la chaîne « now() ».
	it('envoie l’instant comme valeur ISO, jamais un appel de fonction', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, { channelId: CHANNEL, parametres: parametres(), maintenant: INSTANT })
		expect(appel.ou[0]).not.toContain('now()')
		expect(appel.ou[0]?.endsWith(INSTANT.toISOString())).toBe(true)
	})

	it('cohabite avec le filtre d’étape et la recherche, sans se substituer à eux', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, {
			channelId: CHANNEL,
			parametres: parametres({ etape: ETAPE, recherche: 'vallier' }),
			maintenant: INSTANT,
		})
		expect(appel.ou).toHaveLength(1)
		expect(appel.egalites).toContainEqual(['current_step_id', ETAPE])
		expect(appel.recherches).toHaveLength(1)
	})

	// La colonne doit être RAPPORTÉE, non pour le filtre — il est au serveur — mais pour la marque
	// des lignes rendues visibles (§16.12.7).
	it('demande `snoozed_until`, dont la pastille compacte a besoin', () => {
		expect(COLONNES_CARD_LISTE).toContain('snoozed_until')
	})
})
