// @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : le client du serveur Ollama
// @verifies docs/SPEC-ia.md §3 (sortie structurée, température, borne ; refus `401`/`403` mesurés), §11.3
//           (raisons de l'état), §11.4 (codes d'échec : le dépassement de borne est prouvé ICI, borne injectée)

import { describe, expect, it } from 'vitest'
import type { Cible } from './configuration.ts'
import { TEMPERATURE, generer, lireEtat } from './ollama.ts'

const CIBLE: Cible = { hote: 'https://llm.example.test', cle: 'sk-secret', simulee: false }
const json = (statut: number, corps: unknown) =>
	new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })

describe('lireEtat', () => {
	it('sans cible : indisponible, clé absente — sans aucun appel', async () => {
		let appels = 0
		const etat = await lireEtat(null, 'gemma4:e2b', async () => (appels++, json(200, {})))
		expect(etat).toEqual({ disponible: false, raison: 'cle_absente', modele: 'gemma4:e2b' })
		expect(appels).toBe(0)
	})

	it('disponible quand le serveur sert le modèle ; la clé part en Bearer', async () => {
		let autorisation = ''
		const etat = await lireEtat(CIBLE, 'gemma4:e2b', async (_url, init) => {
			autorisation = new Headers(init?.headers).get('authorization') ?? ''
			return json(200, { models: [{ name: 'all-minilm:latest' }, { name: 'gemma4:e2b' }] })
		})
		expect(etat).toEqual({ disponible: true, modele: 'gemma4:e2b' })
		expect(autorisation).toBe('Bearer sk-secret')
	})

	it.each([
		[401, 'cle_refusee'],
		[403, 'cle_refusee'],
		[502, 'serveur_injoignable'],
	] as const)('HTTP %s : %s', async (statut, raison) => {
		expect(await lireEtat(CIBLE, 'gemma4:e2b', async () => json(statut, { error: 'origine non autorisée pour cette clé' }))).toEqual({
			disponible: false,
			raison,
			modele: 'gemma4:e2b',
		})
	})

	it('modèle non servi : modele_absent ; réseau coupé : serveur_injoignable', async () => {
		expect((await lireEtat(CIBLE, 'gemma4:e2b', async () => json(200, { models: [{ name: 'autre' }] }))).disponible).toBe(false)
		expect(await lireEtat(CIBLE, 'm', async () => json(200, { models: [] }))).toMatchObject({ raison: 'modele_absent' })
		expect(await lireEtat(CIBLE, 'm', async () => { throw new TypeError('fetch failed') })).toMatchObject({ raison: 'serveur_injoignable' })
	})
})

describe('generer', () => {
	it('envoie le modèle, le schéma en `format`, la température basse et `num_ctx` ; rend le JSON et les jetons', async () => {
		let corpsEnvoye: Record<string, unknown> = {}
		let instant = 1_000
		const issue = await generer(
			CIBLE, 'gemma4:e2b', 36_864, [{ role: 'user', content: 'Un cycle' }], { type: 'object' },
			async (_url, init) => {
				corpsEnvoye = JSON.parse(String(init?.body))
				instant += 32_500
				return json(200, { message: { content: '{"workflow":{"nom":"X"}}' }, prompt_eval_count: 537, eval_count: 668 })
			},
			() => instant,
		)
		expect(corpsEnvoye).toMatchObject({
			model: 'gemma4:e2b',
			stream: false,
			format: { type: 'object' },
			options: { num_ctx: 36_864, temperature: TEMPERATURE },
		})
		expect(issue).toEqual({ ok: true, contenu: { workflow: { nom: 'X' } }, jetonsEntree: 537, jetonsSortie: 668, dureeMs: 32_500 })
	})

	it('le dépassement de la borne est `delai_depasse` — borne injectée, aucune preuve n’attend deux minutes', async () => {
		const issue = await generer(
			CIBLE, 'm', 1, [], {},
			(_url, init) =>
				new Promise((_resoudre, rejeter) => {
					init?.signal?.addEventListener('abort', () => rejeter(init.signal?.reason))
				}),
			() => 0,
			20,
		)
		expect(issue).toEqual({ ok: false, echec: 'delai_depasse' })
	})

	it.each([
		['401', async () => json(401, { error: 'clé API manquante' }), 'cle_refusee'],
		['403', async () => json(403, { error: 'origine non autorisée pour cette clé' }), 'cle_refusee'],
		['500', async () => json(500, {}), 'serveur_injoignable'],
		['réseau', async () => { throw new TypeError('fetch failed') }, 'serveur_injoignable'],
		['contenu non JSON', async () => json(200, { message: { content: 'Voici votre workflow :' } }), 'reponse_invalide'],
		['message absent', async () => json(200, {}), 'reponse_invalide'],
	] as const)('%s : %s, sans jamais rendre le texte du serveur', async (_nom, reponse, echec) => {
		const issue = await generer(CIBLE, 'm', 1, [], {}, reponse as never)
		expect(issue).toEqual({ ok: false, echec })
	})
})
