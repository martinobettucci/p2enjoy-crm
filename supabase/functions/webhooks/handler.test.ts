// @verifies CRM-073 (docs/BACKLOG.md) — tranche T2 : un passage de remise
// @verifies docs/SPEC-webhooks.md §2 (le secret d'appel vérifié avant toute lecture ; chaque résultat rendu à la base),
//           §5.2 (50 remises au plus par passage), §6 (le journal ne porte ni adresse, ni corps, ni secret) ;
//           docs/SPEC-edge-functions.md §2 bis (aucun `204`)

import { describe, expect, it } from 'vitest'
import { type DependancesWebhooks, LIMITE_PASSAGE, traiterWebhooks } from './handler.ts'
import type { Remise, Resultat } from './remise.ts'

const remise = (n: number, url = `https://recepteur.example/${n}`): Remise => ({
	delivery_id: `d-${n}`,
	url,
	event: 'card.created',
	payload: { id: `e-${n}` },
	secret: `whsec_${String(n).repeat(64).slice(0, 64)}`,
	attempt: 1,
})

function dependances(remises: Remise[], statut = 200, bonSecret = 's3cret') {
	const inscrits: [string, Resultat][] = []
	const journal: Record<string, unknown>[] = []
	let limite = 0
	const deps: DependancesWebhooks = {
		verifierAppel: async (s) => s === bonSecret,
		prendre: async (l) => ((limite = l), remises),
		inscrire: async (id, r) => void inscrits.push([id, r]),
		outils: async () => ({
			requete: async (url) => new Response(null, { status: url.endsWith('/2') ? 500 : statut }),
			resoudre: async () => ['93.184.216.34'],
			autorises: new Set(),
			maintenantS: () => 1,
		}),
		journal: (l) => void journal.push(l),
	}
	return { deps, inscrits, journal, limite: () => limite }
}

const appel = (methode = 'POST', secret: string | null = 's3cret', chemin = '/webhooks/remettre') =>
	new Request(`http://functions:9000${chemin}`, { method: methode, headers: secret ? { 'x-webhooks-dispatch': secret } : {} })

describe('traiterWebhooks', () => {
	it('sans le bon secret d’appel : 401, sans prendre aucune remise', async () => {
		for (const secret of [null, 'faux']) {
			const { deps, limite } = dependances([remise(1)])
			const reponse = await traiterWebhooks(appel('POST', secret), deps)
			expect(reponse.status).toBe(401)
			expect(limite()).toBe(0)
		}
	})

	it('un autre chemin rend 404, une autre méthode 405 — jamais 204', async () => {
		const { deps } = dependances([])
		expect((await traiterWebhooks(appel('POST', 's3cret', '/webhooks/autre'), deps)).status).toBe(404)
		expect((await traiterWebhooks(appel('GET'), deps)).status).toBe(405)
	})

	it('prend au plus 50 remises, rend chaque résultat à la base, et fait le bilan', async () => {
		const { deps, inscrits, journal, limite } = dependances([remise(1), remise(2), remise(3, 'https://10.0.0.1/x')])
		const reponse = await traiterWebhooks(appel(), deps)
		expect(limite()).toBe(LIMITE_PASSAGE)
		expect(LIMITE_PASSAGE).toBe(50)
		expect(reponse.status).toBe(200)
		expect(await reponse.json()).toEqual({ prises: 3, reussies: 1, echouees: 2 })
		expect(Object.fromEntries(inscrits)).toEqual({
			'd-1': { statut: 200, motif: null },
			'd-2': { statut: 500, motif: null },
			'd-3': { statut: null, motif: 'address_forbidden' },
		})
		const texte = JSON.stringify(journal)
		expect(texte).not.toMatch(/recepteur\.example|whsec_|e-1/)
	})

	it('rien à remettre : 200 et un bilan nul', async () => {
		const { deps } = dependances([])
		expect(await (await traiterWebhooks(appel(), deps)).json()).toEqual({ prises: 0, reussies: 0, echouees: 0 })
	})
})
