// @verifies CRM-071 (docs/BACKLOG.md) — tranche T2 : la traduction des filtres d'une vue, l'écart des filtres courants, la
//           lecture et les écritures des vues, le classement des refus
// @verifies docs/SPEC-vues-import-export.md §2.2 (six clés en anglais, une valeur par défaut non écrite, la page jamais),
//           §2.3 (les refus de la base : nom pris, forme, dépublication, droit, zéro ligne), §3 (décision 777)

import { describe, expect, it } from 'vitest'
import { PARAMETRES_PAR_DEFAUT, type ParametresListe } from './liste-cards'
import type { ClientCrm } from './supabase'
import {
	classerRefusVue,
	enregistrerVue,
	filtresDepuisParametres,
	filtresEcartes,
	lireFiltres,
	lireVues,
	parametresDepuisVue,
	supprimerVue,
	type VueSauvegardee,
} from './vues-sauvegardees'

const ETAPE = '5eed0000-0000-4000-8000-000000000a01'
const ETIQUETTE = '5eed0000-0000-4000-8000-000000000b01'
const VUE: VueSauvegardee = {
	id: '5eed0000-0000-4000-8000-000000000c01',
	nom: 'Mes négociations',
	visibilite: 'privee',
	filtres: { sort: 'next_action_at', step_id: ETAPE, snoozed: 'shown' },
}

describe('les filtres d’une vue (§2.2)', () => {
	it('écrit les seuls filtres qui s’écartent du défaut, jamais la page ni la vue choisie', () => {
		expect(filtresDepuisParametres(PARAMETRES_PAR_DEFAUT)).toEqual({})
		const parametres: ParametresListe = {
			tri: 'amount',
			sens: 'asc',
			etape: ETAPE,
			etiquette: ETIQUETTE,
			recherche: 'lyon',
			page: 4,
			sommeil: 'visibles',
			vue: VUE.id,
		}
		expect(filtresDepuisParametres(parametres)).toEqual({
			sort: 'amount',
			direction: 'asc',
			step_id: ETAPE,
			label_id: ETIQUETTE,
			search: 'lyon',
			snoozed: 'shown',
		})
	})

	it('compose les paramètres d’une vue : ses filtres, la première page, la vue choisie', () => {
		expect(parametresDepuisVue(VUE)).toEqual({
			tri: 'next_action_at',
			sens: 'asc',
			etape: ETAPE,
			etiquette: null,
			recherche: '',
			page: 1,
			sommeil: 'visibles',
			vue: VUE.id,
		})
	})

	it('un aller-retour vue → paramètres → filtres rend les mêmes filtres', () => {
		expect(filtresDepuisParametres(parametresDepuisVue(VUE))).toEqual(VUE.filtres)
	})

	it('relit des filtres venus du réseau en repliant ce qui n’est pas de la forme attendue', () => {
		expect(lireFiltres({ sort: 'health', step_id: 'pas-un-uuid', search: '  ', snoozed: 'peut-etre', page: 2 })).toEqual({})
		expect(lireFiltres(null)).toEqual({})
		expect(lireFiltres(['sort'])).toEqual({})
		expect(lireFiltres({ direction: 'desc', search: ' lyon ' })).toEqual({ direction: 'desc', search: 'lyon' })
	})
})

describe('l’écart des filtres courants (§3, décision 777)', () => {
	it('aucun écart sur les paramètres que la vue compose, même à une autre page', () => {
		expect(filtresEcartes(parametresDepuisVue(VUE), VUE)).toBe(false)
		expect(filtresEcartes({ ...parametresDepuisVue(VUE), page: 3 }, VUE)).toBe(false)
	})

	it('un filtre de plus, de moins ou changé est un écart', () => {
		const base = parametresDepuisVue(VUE)
		expect(filtresEcartes({ ...base, recherche: 'lyon' }, VUE)).toBe(true)
		expect(filtresEcartes({ ...base, etape: null }, VUE)).toBe(true)
		expect(filtresEcartes({ ...base, sens: 'desc' }, VUE)).toBe(true)
		expect(filtresEcartes({ ...base, sommeil: 'masquees' }, VUE)).toBe(true)
	})
})

describe('le classement des refus (§2.3)', () => {
	it('nomme chaque refus de la base, et ne prend jamais une panne pour un droit', () => {
		expect(classerRefusVue(409, '23505', 'duplicate key value')).toBe('nom-pris')
		expect(classerRefusVue(400, '23514', 'violates check constraint')).toBe('forme')
		expect(classerRefusVue(400, '22023', 'saved_view_cannot_be_unpublished')).toBe('depublication')
		expect(classerRefusVue(403, '42501', 'new row violates row-level security policy')).toBe('forbidden')
		expect(classerRefusVue(401, undefined, 'JWT expired')).toBe('forbidden')
		expect(classerRefusVue(undefined, undefined, 'Failed to fetch')).toBe('network')
		expect(classerRefusVue(500, 'XX000', 'boom')).toBe('unknown')
	})
})

/** Un faux client qui rend une réponse fixée et garde l'appel émis. */
function client(reponse: { data: unknown; error: unknown; status: number }) {
	const appels: { table: string; methode: string; valeur?: unknown; filtres: unknown[][] }[] = []
	const faux = {
		from: (table: string) => {
			const appel: { table: string; methode: string; valeur?: unknown; filtres: unknown[][] } = { table, methode: 'select', filtres: [] }
			appels.push(appel)
			const maillon: Record<string, unknown> = {}
			maillon.select = () => maillon
			maillon.eq = (...args: unknown[]) => {
				appel.filtres.push(args)
				return maillon
			}
			for (const methode of ['insert', 'update', 'delete']) {
				maillon[methode] = (valeur?: unknown) => {
					appel.methode = methode
					appel.valeur = valeur
					return maillon
				}
			}
			maillon.then = (resoudre: (r: unknown) => unknown) => resoudre(reponse)
			return maillon
		},
	} as unknown as ClientCrm
	return { client: faux, appels }
}

describe('la lecture et les écritures', () => {
	it('lit les vues du channel, les nomme et les range par nom', async () => {
		const { client: c, appels } = client({
			data: [
				{ id: 'b', name: 'Revue du lundi', visibility: 'workspace', filters: { sort: 'amount' } },
				{ id: 'a', name: 'mes négociations', visibility: 'private', filters: {} },
			],
			error: null,
			status: 200,
		})
		const lu = await lireVues(c, 'channel-1')
		expect(appels[0]).toMatchObject({ table: 'saved_views', filtres: [['channel_id', 'channel-1']] })
		expect(lu).toEqual({
			statut: 'pret',
			donnees: [
				{ id: 'a', nom: 'mes négociations', visibilite: 'privee', filtres: {} },
				{ id: 'b', nom: 'Revue du lundi', visibilite: 'espace', filtres: { sort: 'amount' } },
			],
		})
	})

	it('enregistre une vue sans envoyer ni la personne ni l’espace, et rend son identifiant', async () => {
		const { client: c, appels } = client({ data: [{ id: 'nouvelle' }], error: null, status: 201 })
		const issue = await enregistrerVue(c, 'channel-1', { nom: '  Revue  ', publier: true, filtres: { sort: 'amount' } })
		expect(issue).toEqual({ statut: 'applique', id: 'nouvelle' })
		expect(appels[0]!.valeur).toEqual({ channel_id: 'channel-1', name: 'Revue', visibility: 'workspace', filters: { sort: 'amount' } })
	})

	it('une suppression filtrée par la politique rend « sans effet », jamais un succès', async () => {
		const { client: c } = client({ data: [], error: null, status: 200 })
		expect(await supprimerVue(c, 'vue-1')).toEqual({ statut: 'refus', nature: 'sans-effet' })
	})

	it('un refus de la base est classé', async () => {
		const { client: c } = client({ data: null, error: { code: '23505', message: 'duplicate key value' }, status: 409 })
		expect(await enregistrerVue(c, 'channel-1', { nom: 'Revue', publier: false, filtres: {} })).toEqual({
			statut: 'refus',
			nature: 'nom-pris',
		})
	})
})
