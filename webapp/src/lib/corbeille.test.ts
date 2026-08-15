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
	OPTIONS_COMPTE,
	compterEnfantsInaccessibles,
	composerEnumeration,
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
