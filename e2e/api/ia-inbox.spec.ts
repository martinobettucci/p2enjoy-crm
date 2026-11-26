// @verifies CRM-166 (docs/BACKLOG.md) — tranche T1 : `POST /ia/inbox/plan`, par requête directe contre le simulateur et la vraie base — le plan
//           rendu sur des fils du seed (les gestes demandés, la clé inconnue et le fil inconnu rejetés et comptés), un fil que la personne
//           ne voit pas écarté, un espace qui n'est pas le sien refusé sans appel au modèle, les refus de forme, et l'assistant de
//           conception qui répond pendant un plan long (`inbox_lent`) sur sa propre voie
// @verifies docs/SPEC-ia.md §17.2 à §17.6, §17.9, §17.10 ; docs/SPEC-mail-subsystem.md §36.7 ; docs/JOURNAL.md décisions 994 et 997 ;
//           CLAUDE.md §10 (le refus vient de la base, vérifié avec les vrais identifiants)
//
// LE SIMULATEUR : l'en-tête `x-ia-simulateur` choisit le scénario `inbox` — une action par verbe lu dans la demande, plus un fil `f99` et une
// cible `p99` que la fonction doit rejeter. Les fils sont ceux du seed, lus par la base sous « Seulement moi » (un filtre explicite) : la
// preuve ne pose aucun mail.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAuthentifies, jetonDe } from './jetons'

const IA = `${URL_API}/functions/v1/ia`
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const ESPACE_ETRANGER = '5eed0000-0000-4000-8000-0000000000fe'
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })
const simule = (entetes: Record<string, string>, scenario: string) => ({ ...json(entetes), 'x-ia-simulateur': scenario })

type Fil = { workspace_id: string; thread_key: string }
type Issue = { issue: 'plan' | 'echec'; plans?: { thread_key: string; actions: { action: string; cible: { genre: string; id: string; libelle: string } | null; motif: string; confirmation: boolean }[] }[]; rejetees?: number; ecartes?: number; echec?: string }

async function lignes(reponse: import('@playwright/test').APIResponse): Promise<Record<string, unknown>[]> {
	expect(reponse.headers()['content-type']).toContain('application/x-ndjson')
	return (await reponse.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
}

/** Les fils de « Seulement moi » de la personne, lus par la base : de vrais fils du seed. */
async function filsDeLaPersonne(request: APIRequestContext, jeton: string, combien: number): Promise<Fil[]> {
	const reponse = await request.post(`${URL_API}/rest/v1/rpc/inbox_assistant_threads`, {
		headers: json(enTetesAuthentifies(jeton)),
		data: { p_scope: { workspace_id: ESPACE, folder: 'unclassified', only_me: true, snoozed: 'shown' } },
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
	const fils = (await reponse.json()) as Fil[]
	expect(fils.length, 'le seed donne à Driss au moins un fil non classé qui le concerne').toBeGreaterThanOrEqual(1)
	// D'autres preuves déplacent ou classent des fils du jeu (INC-342) : on prend jusqu'à `combien`, jamais moins d'un.
	return fils.slice(0, combien)
}

const portee = (fils: Fil[]) => ({ workspace_id: ESPACE, folder: 'unclassified', only_me: true, snoozed: 'shown', threads: fils })
const planDe = (request: APIRequestContext, jeton: string | null, corps: unknown, scenario = 'inbox') =>
	request.post(`${IA}/inbox/plan`, {
		headers: simule(jeton === null ? {} : enTetesAuthentifies(jeton), scenario),
		data: corps,
		timeout: 60_000,
	})

test.describe('POST /ia/inbox/plan', () => {
	test('un plan sur de vrais fils : les gestes demandés, résolus ; la clé et le fil inconnus rejetés et comptés', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const fils = await filsDeLaPersonne(request, jeton, 2)
		const reponse = await planDe(request, jeton, { scope: portee(fils), demande: 'Marque lu, mets en sommeil, pose la pastille Lead' })
		expect(reponse.status(), await reponse.text()).toBe(202)
		const flux = await lignes(reponse)
		expect(flux[0]).toEqual({ accepte: true, fils: fils.length })
		const issue = flux.at(-1) as unknown as Issue
		expect(issue.issue).toBe('plan')
		expect(issue.plans!.length).toBe(fils.length)
		const premier = issue.plans!.find((plan) => plan.thread_key === fils[0]!.thread_key)!
		expect(premier.actions.map((a) => a.action)).toEqual(['pose_pastille', 'lu', 'sommeil'])
		expect(premier.actions[0]!.cible).toMatchObject({ genre: 'pastille', libelle: 'Lead' })
		expect(premier.actions[2]!.cible).toMatchObject({ genre: 'duree', id: 'demain' })
		expect(premier.actions.every((a) => a.confirmation === false)).toBe(true)
		// La pastille `p99` du premier fil et le fil `f99` : rejetés par la fonction, comptés, jamais rendus.
		expect(issue.rejetees).toBe(2)
		expect(issue.ecartes).toBe(0)
		expect(JSON.stringify(issue)).not.toContain('p99')
	})

	test('les gestes à confirmation sont marqués ; une cible d’affaire, de membre ou de durée est résolue par la base', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const fils = await filsDeLaPersonne(request, jeton, 1)
		const reponse = await planDe(request, jeton, { scope: portee(fils), demande: 'Transfère, bloque, supprime partout' })
		const issue = (await lignes(reponse)).at(-1) as unknown as Issue
		const actions = issue.plans![0]!.actions
		expect(actions.map((a) => a.action)).toEqual(['transfere', 'bloque_expediteur', 'supprime_partout'])
		expect(actions[0]!.cible).toMatchObject({ genre: 'membre' })
		expect(actions.map((a) => a.confirmation)).toEqual([false, true, true])
	})

	test('un fil que la personne ne voit pas est écarté et compté, sans appel au modèle', async ({ request }) => {
		const driss = await jetonDe('bizdev@p2enjoy.test')
		const fils = await filsDeLaPersonne(request, driss, 1)
		const autre = await jetonDe('viewer@p2enjoy.test')
		const reponse = await planDe(request, autre, { scope: portee(fils), demande: 'Marque lu' })
		expect(reponse.status()).toBe(202)
		const flux = await lignes(reponse)
		expect(flux[0]).toEqual({ accepte: true, fils: 0 })
		expect(flux.at(-1)).toEqual({ issue: 'plan', plans: [], rejetees: 0, ecartes: 1 })
	})

	test('un espace qui n’est pas le sien : 403 ; sans jeton : 401', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const fils = await filsDeLaPersonne(request, jeton, 1)
		const etranger = { ...portee(fils), workspace_id: ESPACE_ETRANGER, threads: [{ workspace_id: ESPACE_ETRANGER, thread_key: fils[0]!.thread_key }] }
		expect((await planDe(request, jeton, { scope: etranger, demande: 'Marque lu' })).status()).toBe(403)
		expect((await planDe(request, null, { scope: portee(fils), demande: 'Marque lu' })).status()).toBe(401)
	})

	test('les refus de forme : demande vide ou trop longue, plus de 5 fils, aucun fil coché', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const fils = await filsDeLaPersonne(request, jeton, 1)
		expect((await planDe(request, jeton, { scope: portee(fils), demande: '  ' })).status()).toBe(400)
		expect((await planDe(request, jeton, { scope: portee(fils), demande: 'x'.repeat(1_001) })).status()).toBe(400)
		const six = Array.from({ length: 6 }, (_, n) => ({ workspace_id: ESPACE, thread_key: `fil-${n}` }))
		expect((await planDe(request, jeton, { scope: portee(six), demande: 'x' })).status()).toBe(400)
		expect((await planDe(request, jeton, { scope: { workspace_id: ESPACE, folder: 'unclassified', only_me: true }, demande: 'x' })).status()).toBe(400)
	})

	test('une réponse hors schéma est un échec nommé du lot, jamais un plan', async ({ request }) => {
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const fils = await filsDeLaPersonne(request, jeton, 1)
		const issue = (await lignes(await planDe(request, jeton, { scope: portee(fils), demande: 'Marque lu' }, 'inbox_invalide'))).at(-1)
		expect(issue).toEqual({ issue: 'echec', echec: 'reponse_invalide' })
	})

	test('pendant un plan long, l’assistant de conception répond : la voie `_ia-inbox` ne le bloque pas (CRM-163, §16.5)', async ({ request }) => {
		test.setTimeout(120_000)
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		const fils = await filsDeLaPersonne(request, jeton, 1)
		const admin = await jetonDe('admin@p2enjoy.test')
		// Le plan lent (4 s) est lancé sans être attendu ; l'état de l'assistant est demandé pendant qu'il tient sa voie.
		const lent = planDe(request, jeton, { scope: portee(fils), demande: 'Marque lu' }, 'inbox_lent')
		await new Promise((r) => setTimeout(r, 1_000))
		const debut = Date.now()
		const etat = await request.get(`${IA}/etat`, { headers: enTetesAuthentifies(admin), timeout: 30_000 })
		const duree = Date.now() - debut
		expect(etat.status(), `l'assistant répond pendant le plan (${duree} ms)`).toBe(200)
		expect(duree, 'sans attendre la fin du plan').toBeLessThan(3_500)
		const fin = (await lignes(await lent)).at(-1) as unknown as Issue
		expect(fin.issue).toBe('plan')
	})
})
