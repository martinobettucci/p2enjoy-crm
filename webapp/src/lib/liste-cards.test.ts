// @verifies CRM-042 (docs/BACKLOG.md) — composition de la vue liste : tri, filtres, pagination
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

	it('lit un tri, un sens, une étape, une recherche et un rang de page', () => {
		const lus = lireParametres(
			new URLSearchParams({ tri: 'amount', sens: 'asc', etape: ETAPE, q: 'refonte', page: '3' }),
		)
		expect(lus).toEqual({ tri: 'amount', sens: 'asc', etape: ETAPE, recherche: 'refonte', page: 3 })
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
	const appel: Appel = { egalites: [], nuls: [], tris: [], recherches: [] }
	const chaine = {
		eq: (colonne: string, valeur: unknown) => {
			appel.egalites.push([colonne, valeur])
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

	// `owner_id` transporterait une donnée que rien n'affiche : le nom d'un responsable n'est
	// lisible par personne (INC-014), et la colonne « Responsable » n'est pas rendue (§12.3).
	it('ne demande ni `owner_id`, ni `position`, ni `description`', () => {
		for (const absente of ['owner_id', 'position', 'description', 'health_score']) {
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
	it('cherche dans `search_tsv`, en configuration `french` EXPLICITE', async () => {
		const { client, appel } = clientEspion(OK)
		await lirePageCards(client, {
			channelId: CHANNEL,
			parametres: parametres({ recherche: 'refonte' }),
		})
		expect(appel.recherches).toEqual([
			['search_tsv', 'refonte', { config: 'french', type: 'plain' }],
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
