// @verifies CRM-108 (docs/BACKLOG.md) — tranche T3 : ce que le bloc « Recettes » et l'onglet « À saisir » lisent et écrivent
// @verifies docs/SPEC-recettes.md §2.3 (le réel n'est jamais envoyé, nul n'est pas zéro dans le pied), §3 (refus classés
//           par code), §5 (`rentabilite_affaires` : période et affaire passées seulement si données ; refus 42501 →
//           `forbidden`), §6.1, §6.4 (lignes non soldées hors corbeille ; recette réelle relue après l'ajout)

import { describe, expect, it } from 'vitest'
import {
	ancienneteRecette,
	classerRefusRecette,
	creerLigneRecette,
	enregistrerRecetteReelle,
	lireRecettesASaisir,
	modifierLigneRecette,
	totaliserRecettes,
	type LigneRecette,
	type RecetteASaisir,
} from './card-revenues'
import { lireNomsRentabilite, lireRentabilite, TAILLE_LOT_NOMS } from './rentabilite-lecture'
import type { ClientCrm } from './supabase'

type Appel = { table: string; action: string; charge?: unknown; filtres: [string, string, unknown][] }

function espion(reponses: unknown[], rpc?: unknown) {
	const appels: Appel[] = []
	const rpcs: { nom: string; args: unknown }[] = []
	let i = 0
	const client = {
		rpc: (nom: string, args: unknown) => {
			rpcs.push({ nom, args })
			return Promise.resolve(rpc)
		},
		from: (table: string) => {
			const appel: Appel = { table, action: 'select', filtres: [] }
			appels.push(appel)
			const chaine: Record<string, unknown> = {}
			for (const op of ['eq', 'is', 'in']) {
				chaine[op] = (c: string, v: unknown) => {
					appel.filtres.push([op, c, v])
					return chaine
				}
			}
			chaine.order = () => chaine
			chaine.select = () => chaine
			for (const nom of ['insert', 'update', 'delete']) {
				chaine[nom] = (c?: unknown) => {
					appel.action = nom
					appel.charge = c
					return chaine
				}
			}
			chaine.then = (ok: (r: unknown) => unknown) => Promise.resolve(reponses[i++]).then(ok)
			return chaine
		},
	}
	return { client: client as unknown as ClientCrm, appels, rpcs }
}

const OK = (data: unknown[]) => ({ data, error: null, status: 200 })

describe('les lignes de recette', () => {
	it('une ligne naît sans réel : la base le tient (§2.3)', async () => {
		const { client, appels } = espion([OK([{ id: 'r1' }])])
		expect(await creerLigneRecette(client, 'c1', { libelle: 'Acompte', prevu: 6000 })).toEqual({ statut: 'applique' })
		expect(appels[0]?.charge).not.toHaveProperty('actual_amount')
		const m = espion([OK([])])
		expect(await modifierLigneRecette(m.client, 'r1', { libelle: 'Solde', prevu: 1 })).toEqual({ statut: 'sans-effet' })
	})

	it('le pied compte le réel connu, et nomme les lignes sans réel — nul n’est pas zéro', () => {
		const l = (estimated_amount: number, actual_amount: number | null): LigneRecette => ({
			id: 'x', card_id: 'c', label: 'x', estimated_amount, actual_amount, settled_at: null, position: 1,
		})
		expect(totaliserRecettes([l(6000, 6000), l(14000, null), l(500, 0)])).toEqual({
			prevu: 20500, reel: 6000, sansReel: 1, prevuSansReel: 14000,
		})
	})

	it('classe les refus par code, puis par statut', () => {
		expect(classerRefusRecette(400, '23514', 'reel derive').nature).toBe('forme-refusee')
		expect(classerRefusRecette(400, '22003', '').nature).toBe('montant-hors-echelle')
		expect(classerRefusRecette(403, '42501', '').nature).toBe('forbidden')
		expect(classerRefusRecette(undefined, undefined, '').nature).toBe('network')
	})
})

describe('l’onglet « À saisir »', () => {
	it('lit les lignes non soldées, hors corbeille', async () => {
		const { client, appels } = espion([OK([])])
		await lireRecettesASaisir(client)
		expect(appels[0]?.filtres).toEqual([
			['is', 'settled_at', null],
			['is', 'cards.deleted_at', null],
		])
	})

	it('ajoute la recette réelle puis relit celle de la ligne, que la base calcule', async () => {
		const { client, appels } = espion([OK([{ id: 'a1' }]), OK([{ actual_amount: 4500 }])])
		expect(await enregistrerRecetteReelle(client, 'r1', 0)).toEqual({ statut: 'applique', reel: 4500 })
		expect(appels[0]).toMatchObject({ table: 'card_revenue_actuals', charge: { card_revenue_id: 'r1', amount: 0, label: null } })
		expect(appels[1]).toMatchObject({ table: 'card_revenues', filtres: [['eq', 'id', 'r1']] })
	})

	it('l’ancienneté compte des jours révolus, et ne devine rien d’une date illisible', () => {
		const ligne = { created_at: '2026-10-01T00:00:00Z' } as RecetteASaisir
		expect(ancienneteRecette(ligne, new Date('2026-10-23T12:00:00Z'))).toBe(22)
		expect(ancienneteRecette({ created_at: 'n’importe' } as RecetteASaisir, new Date())).toBe(null)
	})
})

describe('la lecture de la rentabilité', () => {
	it('n’envoie la période et l’affaire que si elles sont données', async () => {
		const { client, rpcs } = espion([], OK([]))
		await lireRentabilite(client, { du: null, au: '2026-03-31' }, 'c1')
		expect(rpcs[0]).toEqual({ nom: 'rentabilite_affaires', args: { p_fin: '2026-03-31', p_card: 'c1' } })
	})

	it('rend le refus 42501 en `forbidden` : l’écran le lit comme « réservé aux administrateurs »', async () => {
		const { client } = espion([], { data: null, error: { message: 'rentabilite_reservee' }, status: 403 })
		const lu = await lireRentabilite(client, { du: null, au: null })
		expect(lu.statut === 'erreur' && lu.erreur.nature).toBe('forbidden')
	})

	it('lit les noms par lots de cent affaires', async () => {
		const ids = Array.from({ length: TAILLE_LOT_NOMS + 1 }, (_, i) => `c${i}`)
		const { client, appels } = espion([OK([]), OK([])])
		await lireNomsRentabilite(client, ids)
		expect(appels).toHaveLength(2)
		expect((appels[0]?.filtres[0]?.[2] as string[]).length).toBe(TAILLE_LOT_NOMS)
	})
})
