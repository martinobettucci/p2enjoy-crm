// @verifies CRM-077 (docs/BACKLOG.md) — corbeille : l'énumération des enfants rendus inaccessibles
// @verifies docs/SPEC-corbeille.md §3.3 (l'énumération remplace la descente), §3.5 (ce qu'elle
//           compte, la forme des lectures, la composition), §5 (ligne « Unitaire »)
// @verifies CLAUDE.md §23 (aucune phrase construite par concaténation)
//
// Comme `mail-etat.test.ts`, ce fichier éprouve la requête RÉELLEMENT émise et pas seulement la
// valeur rendue : les trois règles de comptage du §3.5 sont portées par les filtres eux-mêmes, si
// bien qu'un filtre absent ferait compter autre chose sans qu'aucune valeur ne change de forme.
//
// DEUX ASSERTIONS SONT ÉCRITES « EN NÉGATIF », et ce sont les plus utiles : aucune lecture ne filtre
// `archived_at`, parce qu'un enfant archivé DOIT être compté (§3.5). Une régression qui ajouterait ce
// filtre par symétrie avec les listes rendrait l'énumération muette sur ce que le geste immobilise,
// et rien d'autre ne le dirait.

import { describe, expect, it } from 'vitest'
import {
	COLONNE_ENFANT,
	NOM_REFUS_PARENT,
	OPTIONS_COMPTE,
	classerRefusRestauration,
	compterEnfantsInaccessibles,
	composerEnumeration,
	lireCorbeille,
	restaurer,
	trierParRetraitDecroissant,
} from './corbeille'
import type { ClientCrm } from './supabase'

const TRACK = '5eed0000-0000-4000-8000-000000000025'
const CHANNEL = '5eed0000-0000-4000-8000-000000000037'

type ReponseLignes = { data: { id: string }[] | null; error: { message: string } | null; status: number }
type ReponseCompte = { count: number | null; error: { message: string } | null; status: number }

type Appel = {
	table: string
	colonnes: string
	options: unknown
	filtres: [string, string, unknown][]
}

/**
 * Transport espion : il enregistre chaque appel — table, colonnes, options de comptage et filtres —
 * et rend les réponses fournies dans l'ordre où elles sont demandées.
 *
 * La chaîne rendue est **thenable** : `compterEnfantsInaccessibles` attend la requête sans appeler
 * de méthode terminale, exactement comme `supabase-js` le permet.
 */
function espion(reponses: readonly (ReponseLignes | ReponseCompte)[]): {
	client: ClientCrm
	appels: Appel[]
} {
	const appels: Appel[] = []
	let rang = 0
	const client = {
		from: (table: string) => ({
			select: (colonnes: string, options?: unknown) => {
				const appel: Appel = { table, colonnes, options, filtres: [] }
				appels.push(appel)
				const reponse = reponses[rang++]
				const chaine = {
					eq: (colonne: string, valeur: unknown) => {
						appel.filtres.push(['eq', colonne, valeur])
						return chaine
					},
					in: (colonne: string, valeur: unknown) => {
						appel.filtres.push(['in', colonne, valeur])
						return chaine
					},
					is: (colonne: string, valeur: unknown) => {
						appel.filtres.push(['is', colonne, valeur])
						return chaine
					},
					then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, appels }
}

function clientQuiLeve(cause: unknown): ClientCrm {
	const exploser = () => {
		throw cause
	}
	return { from: () => ({ select: exploser }) } as unknown as ClientCrm
}

// ---------------------------------------------------------------------------------------------
// L'énumération d'un track — deux lectures (§3.5)
// ---------------------------------------------------------------------------------------------

describe('compterEnfantsInaccessibles, cible track', () => {
	it('lit les channels puis compte leurs affaires, et rend les deux nombres (§3.5)', async () => {
		const { client, appels } = espion([
			{ data: [{ id: 'ch-1' }, { id: 'ch-2' }], error: null, status: 200 },
			{ count: 7, error: null, status: 200 },
		])
		const resultat = await compterEnfantsInaccessibles(client, { type: 'track', id: TRACK })

		expect(appels).toHaveLength(2)
		expect(appels[0]).toMatchObject({
			table: 'channels',
			colonnes: COLONNE_ENFANT,
			options: undefined,
			filtres: [
				['eq', 'track_id', TRACK],
				['is', 'deleted_at', null],
			],
		})
		expect(appels[1]).toMatchObject({
			table: 'cards',
			colonnes: COLONNE_ENFANT,
			options: OPTIONS_COMPTE,
			filtres: [
				['in', 'channel_id', ['ch-1', 'ch-2']],
				['is', 'deleted_at', null],
			],
		})
		// Le nombre de channels est la LONGUEUR de la première lecture : aucune requête de plus.
		expect(resultat).toEqual({ statut: 'pret', donnees: { channels: 2, cards: 7 } })
	})

	it("n'émet AUCUN filtre sur `archived_at` : un enfant archivé est compté (§3.5)", async () => {
		const { client, appels } = espion([
			{ data: [{ id: 'ch-1' }], error: null, status: 200 },
			{ count: 1, error: null, status: 200 },
		])
		await compterEnfantsInaccessibles(client, { type: 'track', id: TRACK })
		for (const appel of appels) {
			expect(appel.filtres.map(([, colonne]) => colonne)).not.toContain('archived_at')
		}
	})

	it('ne compte AUCUNE affaire lorsque le track ne porte aucun channel, sans seconde requête', async () => {
		const { client, appels } = espion([{ data: [], error: null, status: 200 }])
		const resultat = await compterEnfantsInaccessibles(client, { type: 'track', id: TRACK })
		expect(appels).toHaveLength(1)
		expect(resultat).toEqual({ statut: 'pret', donnees: { channels: 0, cards: 0 } })
	})

	it('classe en `forbidden` un refus sur la lecture des channels', async () => {
		const { client } = espion([{ data: null, error: { message: 'denied' }, status: 403 }])
		const resultat = await compterEnfantsInaccessibles(client, { type: 'track', id: TRACK })
		expect(resultat).toEqual({
			statut: 'erreur',
			erreur: { nature: 'forbidden', detail: 'denied' },
		})
	})

	it('classe en `forbidden` un refus sur le comptage des affaires', async () => {
		const { client } = espion([
			{ data: [{ id: 'ch-1' }], error: null, status: 200 },
			{ count: null, error: { message: 'denied' }, status: 403 },
		])
		const resultat = await compterEnfantsInaccessibles(client, { type: 'track', id: TRACK })
		expect(resultat).toEqual({
			statut: 'erreur',
			erreur: { nature: 'forbidden', detail: 'denied' },
		})
	})

	it('traite une réponse aboutie SANS `count` comme une erreur, jamais comme un zéro', async () => {
		const { client } = espion([
			{ data: [{ id: 'ch-1' }], error: null, status: 200 },
			{ count: null, error: null, status: 200 },
		])
		const resultat = await compterEnfantsInaccessibles(client, { type: 'track', id: TRACK })
		expect(resultat.statut).toBe('erreur')
		if (resultat.statut === 'erreur') {
			expect(resultat.erreur.nature).toBe('network')
			expect(resultat.erreur.detail).toContain('count absent')
		}
	})

	it('rend une erreur de transport plutôt que de laisser une exception remonter', async () => {
		const resultat = await compterEnfantsInaccessibles(clientQuiLeve(new Error('offline')), {
			type: 'track',
			id: TRACK,
		})
		expect(resultat).toEqual({
			statut: 'erreur',
			erreur: { nature: 'network', detail: 'offline' },
		})
	})
})

// ---------------------------------------------------------------------------------------------
// L'énumération d'un channel — une seule lecture (§3.5)
// ---------------------------------------------------------------------------------------------

describe('compterEnfantsInaccessibles, cible channel', () => {
	it('compte les affaires du channel, et lui seul', async () => {
		const { client, appels } = espion([{ count: 3, error: null, status: 200 }])
		const resultat = await compterEnfantsInaccessibles(client, { type: 'channel', id: CHANNEL })
		expect(appels).toHaveLength(1)
		expect(appels[0]).toMatchObject({
			table: 'cards',
			colonnes: COLONNE_ENFANT,
			options: OPTIONS_COMPTE,
			filtres: [
				['eq', 'channel_id', CHANNEL],
				['is', 'deleted_at', null],
			],
		})
		// Un channel ne porte pas de channel : le champ vaut 0, il n'est pas absent.
		expect(resultat).toEqual({ statut: 'pret', donnees: { channels: 0, cards: 3 } })
	})

	it('rend un compte nul tel quel : zéro affaire est un fait, pas une erreur', async () => {
		const { client } = espion([{ count: 0, error: null, status: 200 }])
		const resultat = await compterEnfantsInaccessibles(client, { type: 'channel', id: CHANNEL })
		expect(resultat).toEqual({ statut: 'pret', donnees: { channels: 0, cards: 0 } })
	})
})

// ---------------------------------------------------------------------------------------------
// La composition — §3.5
// ---------------------------------------------------------------------------------------------

describe('composerEnumeration', () => {
	it('ordonne les channels avant les affaires, du plus englobant au plus fin', () => {
		expect(composerEnumeration({ channels: 3, cards: 27 })).toEqual([
			{ type: 'channels', compte: 3 },
			{ type: 'cards', compte: 27 },
		])
	})

	it('omet la ligne dont le compte est nul : « 0 channel » n’apprend rien', () => {
		expect(composerEnumeration({ channels: 0, cards: 4 })).toEqual([{ type: 'cards', compte: 4 }])
		expect(composerEnumeration({ channels: 2, cards: 0 })).toEqual([
			{ type: 'channels', compte: 2 },
		])
	})

	it('rend AUCUNE ligne quand rien ne devient inaccessible : l’écran dit sa propre phrase (§4)', () => {
		expect(composerEnumeration({ channels: 0, cards: 0 })).toEqual([])
	})
})

// ---------------------------------------------------------------------------------------------
// Ce que l'écran LIT — §4.2, §4.3
// ---------------------------------------------------------------------------------------------
//
// @verifies docs/SPEC-corbeille.md §4.2 (les trois lectures et le nom de contrainte obligatoire),
//           §4.3 (l'auteur inconnu), §4.5 (les trois issues de la restauration)
//
// L'ASSERTION LA PLUS UTILE DE CE BLOC EST CELLE QUI LIT LES COLONNES. Le nom de la contrainte
// (`profiles!tracks_deleted_by_fkey`) n'est pas un détail de style : sans lui, PostgREST rend `300`
// et `PGRST201` — MESURÉ sur les trois tables (§4.2). Une régression qui « simplifierait » la requête
// en `profiles(full_name)` casserait l'écran à l'exécution, et seule cette assertion le dirait avant.

type ReponseCorbeille = {
	data: Record<string, unknown>[] | null
	error: { message: string; code?: string } | null
	status: number
}

type AppelLecture = {
	table: string
	colonnes: string
	filtres: [string, string, unknown][]
	tris: [string, unknown][]
}

/** Transport espion pour `lireCorbeille` : il enregistre `not`, `order` et les colonnes demandées. */
function espionLecture(parTable: Readonly<Record<string, ReponseCorbeille>>): {
	client: ClientCrm
	appels: AppelLecture[]
} {
	const appels: AppelLecture[] = []
	const client = {
		from: (table: string) => ({
			select: (colonnes: string) => {
				const appel: AppelLecture = { table, colonnes, filtres: [], tris: [] }
				appels.push(appel)
				const chaine = {
					not: (colonne: string, operateur: string, valeur: unknown) => {
						appel.filtres.push([operateur, colonne, valeur])
						return chaine
					},
					order: (colonne: string, options?: unknown) => {
						appel.tris.push([colonne, options])
						return chaine
					},
					then: (resoudre: (valeur: unknown) => unknown) =>
						Promise.resolve(parTable[table]).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, appels }
}

const VIDE: ReponseCorbeille = { data: [], error: null, status: 200 }

describe('lireCorbeille', () => {
	it('émet TROIS lectures nommant la contrainte, filtrées et triées côté serveur (§4.2)', async () => {
		const { client, appels } = espionLecture({ tracks: VIDE, channels: VIDE, cards: VIDE })
		await lireCorbeille(client)

		expect(appels.map((appel) => appel.table)).toEqual(['tracks', 'channels', 'cards'])
		for (const appel of appels) {
			// Le filtre et le tri sont CÔTÉ SERVEUR : rapporter toute la table pour n'en garder
			// qu'une part ferait transiter ce que l'écran ne montre pas.
			expect(appel.filtres).toEqual([['is', 'deleted_at', null]])
			expect(appel.tris).toEqual([['deleted_at', { ascending: false }]])
			// SANS LE NOM DE LA CONTRAINTE, PostgREST rend 300 / PGRST201 — MESURÉ (§4.2).
			expect(appel.colonnes).toContain('deleted_by_fkey')
			expect(appel.colonnes).toMatch(/auteur:profiles!\w+_deleted_by_fkey\(full_name\)/)
		}
		// `cards` porte `title` là où les deux autres portent `name` : les colonnes ne sont pas
		// factorisables, et l'assertion fige les deux écritures.
		expect(appels[2]?.colonnes).toContain('title')
		expect(appels[0]?.colonnes).toContain('name')
	})

	it("rend `null` pour un auteur non enregistré, et ne fabrique aucun texte (§4.3)", async () => {
		const { client } = espionLecture({
			tracks: VIDE,
			channels: VIDE,
			cards: {
				// Le cas RÉEL du seed : `Saisie erronée`, née en corbeille sous la clé de service,
				// dont `deleted_by` est nul et figé par le trigger (docs/SPEC-seed.md §10.2).
				data: [{ id: 'c-9', title: 'Saisie erronée', deleted_at: '2026-04-02T11:00:00Z', auteur: null }],
				error: null,
				status: 200,
			},
		})
		const resultat = await lireCorbeille(client)
		expect(resultat).toEqual({
			statut: 'pret',
			donnees: [
				{ type: 'card', id: 'c-9', nom: 'Saisie erronée', retireLe: '2026-04-02T11:00:00Z', retirePar: null },
			],
		})
	})

	it('fusionne les trois tables du plus récemment retiré au plus ancien (§4.2, §7)', async () => {
		const { client } = espionLecture({
			tracks: {
				data: [{ id: 't-1', name: 'Legacy', deleted_at: '2026-07-20T14:30:00Z', auteur: { full_name: 'Camille' } }],
				error: null,
				status: 200,
			},
			channels: {
				data: [{ id: 'ch-1', name: 'Annexes', deleted_at: '2026-08-01T09:00:00Z', auteur: { full_name: 'Camille' } }],
				error: null,
				status: 200,
			},
			cards: {
				data: [{ id: 'c-9', title: 'Saisie', deleted_at: '2026-04-02T11:00:00Z', auteur: null }],
				error: null,
				status: 200,
			},
		})
		const resultat = await lireCorbeille(client)
		expect(resultat.statut).toBe('pret')
		if (resultat.statut !== 'pret') return
		expect(resultat.donnees.map((entree) => entree.id)).toEqual(['ch-1', 't-1', 'c-9'])
		expect(resultat.donnees[0]?.retirePar).toBe('Camille')
	})

	it("met l'écran en erreur si UNE SEULE lecture échoue, sans afficher les autres (§4.2)", async () => {
		const { client } = espionLecture({
			tracks: VIDE,
			channels: { data: null, error: { message: 'refusé' }, status: 403 },
			cards: {
				data: [{ id: 'c-9', title: 'Saisie', deleted_at: '2026-04-02T11:00:00Z', auteur: null }],
				error: null,
				status: 200,
			},
		})
		const resultat = await lireCorbeille(client)
		// Rendre les deux autres tables afficherait une corbeille AMPUTÉE que rien ne signalerait —
		// la « valeur par défaut trompeuse » de CLAUDE.md §18.
		expect(resultat).toEqual({ statut: 'erreur', erreur: { nature: 'forbidden', detail: 'refusé' } })
	})
})

describe('trierParRetraitDecroissant', () => {
	it('départage deux objets retirés au même instant par un ordre STABLE (§4.2)', () => {
		const memeInstant = '2026-07-20T14:30:00Z'
		const entrees = [
			{ type: 'card' as const, id: 'c-1', nom: 'C', retireLe: memeInstant, retirePar: null },
			{ type: 'track' as const, id: 't-1', nom: 'T', retireLe: memeInstant, retirePar: null },
			{ type: 'channel' as const, id: 'ch-1', nom: 'H', retireLe: memeInstant, retirePar: null },
		]
		// Un ordre instable ferait sauter les lignes sous le curseur sans qu'aucune donnée n'ait
		// changé : le tri est donc total, jamais partiel.
		expect(trierParRetraitDecroissant(entrees).map((entree) => entree.id)).toEqual(['t-1', 'ch-1', 'c-1'])
		expect(trierParRetraitDecroissant([...entrees].reverse()).map((entree) => entree.id)).toEqual([
			't-1',
			'ch-1',
			'c-1',
		])
	})
})

// ---------------------------------------------------------------------------------------------
// La restauration et ses TROIS issues — §4.5
// ---------------------------------------------------------------------------------------------

type AppelEcriture = { table: string; charge: unknown; filtres: [string, unknown][] }

function espionEcriture(reponse: ReponseCorbeille): { client: ClientCrm; appels: AppelEcriture[] } {
	const appels: AppelEcriture[] = []
	const client = {
		from: (table: string) => ({
			update: (charge: unknown) => {
				const appel: AppelEcriture = { table, charge, filtres: [] }
				appels.push(appel)
				const chaine = {
					eq: (colonne: string, valeur: unknown) => {
						appel.filtres.push([colonne, valeur])
						return chaine
					},
					select: () => chaine,
					then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, appels }
}

describe('restaurer', () => {
	it("n'écrit QUE `deleted_at`, sur le seul objet visé, et demande la ligne (§3.4, §4.5)", async () => {
		const { client, appels } = espionEcriture({ data: [{ id: 't-1' }], error: null, status: 200 })
		const resultat = await restaurer(client, 'track', 't-1')

		expect(appels).toEqual([{ table: 'tracks', charge: { deleted_at: null }, filtres: [['id', 't-1']] }])
		// `deleted_by` N'EST PAS écrite : le trigger de `0037` l'efface à la restauration, et la
		// colonne est fermée au client par le privilège.
		expect(Object.keys(appels[0]?.charge as object)).toEqual(['deleted_at'])
		expect(resultat).toEqual({ statut: 'appliquee' })
	})

	it('rend `sans-effet` sur `200` et zéro ligne — ni succès ni erreur (§4.5, décision 70)', async () => {
		const { client } = espionEcriture({ data: [], error: null, status: 200 })
		// MESURÉ : la lectrice qui tente de restaurer le track `…025` reçoit exactement cela, et le
		// track reste en corbeille. L'annoncer comme un succès afficherait une restauration qui n'a
		// pas eu lieu.
		expect(await restaurer(client, 'track', 't-1')).toEqual({ statut: 'sans-effet' })
	})

	it('nomme le refus de la garde, et le distingue du refus de droit (§4.5)', async () => {
		const { client } = espionEcriture({
			data: null,
			error: { code: 'P0001', message: 'parent_en_corbeille' },
			status: 400,
		})
		expect(await restaurer(client, 'channel', 'ch-1')).toEqual({
			statut: 'refus',
			refus: { nature: 'parent-en-corbeille', detail: 'parent_en_corbeille' },
		})
	})
})

describe('classerRefusRestauration', () => {
	it('exige le NOM de l’exception avec le code, `P0001` étant générique (§4.5)', () => {
		// `P0001` est le SQLSTATE de tout `raise exception` : le code seul ne dit pas QUELLE règle a
		// refusé, et le prendre pour la garde attribuerait à celle-ci n'importe quel refus applicatif.
		expect(classerRefusRestauration(400, 'P0001', NOM_REFUS_PARENT).nature).toBe('parent-en-corbeille')
		expect(classerRefusRestauration(400, 'P0001', 'quota_journalier_depasse').nature).toBe('unknown')
	})

	it('classe sur le code HTTP quand aucun code PostgreSQL ne tranche', () => {
		expect(classerRefusRestauration(403, undefined, 'refusé').nature).toBe('forbidden')
		expect(classerRefusRestauration(401, undefined, 'refusé').nature).toBe('forbidden')
		expect(classerRefusRestauration(undefined, undefined, 'coupure').nature).toBe('network')
		expect(classerRefusRestauration(500, undefined, 'panne').nature).toBe('unknown')
	})
})
