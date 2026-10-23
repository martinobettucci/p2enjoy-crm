// @verifies CRM-099 (docs/BACKLOG.md) — tranche T2 : les réels d'une ligne de coût, et la case « Soldé »
// @verifies docs/SPEC-costs.md §2.3 bis (ajouter, corriger, retirer un réel ; date du jour par défaut, libellé
//           facultatif ; soldé : un drapeau, l'horodatage et l'auteur posés par la base ; refus d'une ligne soldée)
// @verifies CRM-108 (docs/BACKLOG.md) — tranche T3 : les mêmes gestes sur une ligne de recette (docs/SPEC-recettes.md
//           §2.2, §2.3) — `card_revenue_actuals`, la date `received_on` lue sous le nom commun, `card_revenues`

import { describe, expect, it } from 'vitest'
import { ajouterReel, classerRefusReel, lireReels, modifierReel, solderLigne, supprimerReel } from './reels-ligne'
import type { ClientCrm } from './supabase'

type Reponse = { data: unknown[] | null; error: { message: string; code?: string } | null; status: number }
type Appel = { table: string; action: string; charge?: unknown; filtres: [string, unknown][]; colonnes?: string }

function espion(reponse: Reponse): { client: ClientCrm; appels: Appel[] } {
	const appels: Appel[] = []
	const client = {
		from: (table: string) => {
			const appel: Appel = { table, action: 'select', filtres: [] }
			appels.push(appel)
			const chaine: Record<string, unknown> = {}
			chaine.eq = (c: string, v: unknown) => {
				appel.filtres.push([c, v])
				return chaine
			}
			chaine.order = () => chaine
			chaine.select = (colonnes: string) => {
				appel.colonnes = colonnes
				return chaine
			}
			for (const nom of ['insert', 'update', 'delete']) {
				chaine[nom] = (charge?: unknown) => {
					appel.action = nom
					appel.charge = charge
					return chaine
				}
			}
			chaine.then = (ok: (r: Reponse) => unknown) => Promise.resolve(reponse).then(ok)
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, appels }
}

const UNE_LIGNE: Reponse = { data: [{ id: 'r1' }], error: null, status: 201 }

describe('les réels d’une ligne', () => {
	it('se lisent par leur ligne', async () => {
		const reel = { id: 'r1', amount: 40, spent_on: '2026-10-01', label: 'Facture 1' }
		const { client, appels } = espion({ data: [reel], error: null, status: 200 })
		expect(await lireReels(client, 'l1')).toEqual({ statut: 'pret', donnees: [reel] })
		expect(appels[0]?.filtres).toEqual([['card_cost_id', 'l1']])
	})

	it('un réel s’ajoute sans date — la base pose celle du jour — et sans libellé blanc', async () => {
		const { client, appels } = espion(UNE_LIGNE)
		expect(await ajouterReel(client, 'l1', { montant: -5, date: null, libelle: '   ' })).toEqual({ ok: true })
		expect(appels[0]).toMatchObject({ table: 'card_cost_actuals', action: 'insert', charge: { card_cost_id: 'l1', amount: -5, label: null } })
		expect(appels[0]?.charge).not.toHaveProperty('spent_on')
	})

	it('avec une date et un libellé, ils partent tels quels, le libellé rogné', async () => {
		const { client, appels } = espion(UNE_LIGNE)
		await ajouterReel(client, 'l1', { montant: 40, date: '2026-10-01', libelle: ' Facture 1 ' })
		expect(appels[0]?.charge).toEqual({ card_cost_id: 'l1', amount: 40, label: 'Facture 1', spent_on: '2026-10-01' })
	})

	it('un réel se corrige et se retire par son identifiant ; zéro ligne touchée est un refus', async () => {
		const corrige = espion(UNE_LIGNE)
		expect(await modifierReel(corrige.client, 'r1', { montant: 60, date: null, libelle: null })).toEqual({ ok: true })
		expect(corrige.appels[0]).toMatchObject({ action: 'update', filtres: [['id', 'r1']] })
		const retire = espion({ data: [], error: null, status: 200 })
		expect(await supprimerReel(retire.client, 'r1')).toEqual({ ok: false, motif: 'droit' })
	})

	it('le refus d’une ligne soldée est nommé', async () => {
		const { client } = espion({ data: null, error: { message: 'ligne soldee', code: 'P0001' }, status: 400 })
		expect(await ajouterReel(client, 'l1', { montant: 1, date: null, libelle: null })).toEqual({ ok: false, motif: 'soldee' })
	})
})

describe('« Soldé »', () => {
	it('envoie un drapeau, et rend le réel que la base retient — zéro pour une ligne soldée sans réel', async () => {
		const { client, appels } = espion({ data: [{ actual_cost: 0 }], error: null, status: 200 })
		expect(await solderLigne(client, 'l1', true)).toEqual({ ok: true, reel: 0 })
		expect(appels[0]).toMatchObject({ table: 'card_costs', action: 'update', filtres: [['id', 'l1']], colonnes: 'actual_cost' })
		expect(typeof (appels[0]?.charge as { settled_at: unknown }).settled_at).toBe('string')
	})

	it('décocher envoie `null`', async () => {
		const { client, appels } = espion({ data: [{ actual_cost: null }], error: null, status: 200 })
		expect(await solderLigne(client, 'l1', false)).toEqual({ ok: true, reel: null })
		expect(appels[0]?.charge).toEqual({ settled_at: null })
	})
})

describe('classer un refus', () => {
	it('par le message du déclencheur, puis par le code', () => {
		expect(classerRefusReel(400, 'P0001', 'ligne soldee')).toBe('soldee')
		expect(classerRefusReel(400, '22003', 'numeric field overflow')).toBe('montant-hors-echelle')
		expect(classerRefusReel(400, '23514', 'check')).toBe('forme')
		expect(classerRefusReel(403, '42501', 'rls')).toBe('droit')
		expect(classerRefusReel(undefined, undefined, 'Failed to fetch')).toBe('reseau')
		expect(classerRefusReel(500, 'XX000', 'boom')).toBe('inconnu')
	})
})

describe('la sorte « recette »', () => {
	it('lit les réels d’une ligne de recette, la date d’encaissement sous le nom commun', async () => {
		const { client, appels } = espion({ data: [], error: null, status: 200 })
		await lireReels(client, 'l9', 'recette')
		expect(appels[0]).toMatchObject({
			table: 'card_revenue_actuals',
			filtres: [['card_revenue_id', 'l9']],
			colonnes: 'id, amount, spent_on:received_on, label',
		})
	})

	it('écrit `received_on`, jamais `spent_on`, dans la table des recettes', async () => {
		const { client, appels } = espion(UNE_LIGNE)
		await ajouterReel(client, 'l9', { montant: 14000, date: '2026-03-15', libelle: 'Facture mars' }, 'recette')
		expect(appels[0]?.table).toBe('card_revenue_actuals')
		expect(appels[0]?.charge).toEqual({ card_revenue_id: 'l9', amount: 14000, label: 'Facture mars', received_on: '2026-03-15' })
		const corrige = espion(UNE_LIGNE)
		await modifierReel(corrige.client, 'r9', { montant: 1, date: '2026-03-16', libelle: null }, 'recette')
		expect(corrige.appels[0]).toMatchObject({ table: 'card_revenue_actuals', charge: { received_on: '2026-03-16' } })
		const retire = espion(UNE_LIGNE)
		await supprimerReel(retire.client, 'r9', 'recette')
		expect(retire.appels[0]).toMatchObject({ table: 'card_revenue_actuals', action: 'delete' })
	})

	it('solde une ligne de recette et rend son réel dérivé', async () => {
		const { client, appels } = espion({ data: [{ actual_amount: 0 }], error: null, status: 200 })
		expect(await solderLigne(client, 'l9', true, 'recette')).toEqual({ ok: true, reel: 0 })
		expect(appels[0]).toMatchObject({ table: 'card_revenues', action: 'update', colonnes: 'actual_amount' })
	})
})
