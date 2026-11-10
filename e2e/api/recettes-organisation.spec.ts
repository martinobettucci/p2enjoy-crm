// @verifies CRM-146 (docs/BACKLOG.md) — tranche T2 : le prévisionnel et le réel d'une organisation, hors interface, avec
//           les jetons réels
// @verifies docs/SPEC-recettes.md §12.1 (une affaire compte par ses contacts rattachés, une fois, pour chacune de leurs
//           organisations, hors corbeille), §12.2 (les grandeurs, le réel nul s'il n'est pas connu), §12.3
//           (`organization_revenue_totals` sous la RLS de l'appelant : les sommes égales à un oracle, `p_organization_id`,
//           une organisation inconnue rend zéro ligne, l'anonyme refusé), §12.10 (les preuves API)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel du profil)
//
// L'ORACLE : les tables lues par la clé de service, restreintes aux affaires que le PROFIL lit sous son propre jeton —
// la RLS de `cards` dit lesquelles, le calcul est refait ici, sans la fonction.
//
// IL POSE SES PROPRES RATTACHEMENTS ET LES RETIRE, comme `recettes.spec.ts` : par la vraie route, `POST card_contacts`
// sous le jeton de l'administratrice, sans dédoublonnage (un rattachement déjà présent, du seed §41 par exemple, est
// gardé et jamais retiré). Les affaires et les recettes du seed sont lues, jamais écrites. Les cas couverts : deux
// contacts d'une organisation sur la même affaire (comptée une fois), deux devises, une affaire partagée entre deux
// organisations, et une affaire que la lectrice ne lit pas (…0cd).

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const FONCTION = '/rest/v1/rpc/organization_revenue_totals'
const INCONNUE = '00000000-0000-4000-8000-0000000146ff'
/** « Socle analytique — Vertuo », EUR — la lectrice ne la lit pas. */
const CARD_VERTUO = '5eed0000-0000-4000-8000-0000000000cd'
/** « Formation Data & IA — promo 2026 », CHF — la lectrice la lit. */
const CARD_FORMATION = '5eed0000-0000-4000-8000-0000000000c7'
const RATTACHEMENTS: readonly (readonly [string, string])[] = [
	['Marc Lefort', CARD_VERTUO],
	['Nadia Benali', CARD_VERTUO],
	['Nadia Benali', CARD_FORMATION],
	['Thomas Garnier', CARD_VERTUO],
]
/** Les rattachements que ce fichier a créés, et lui seul retire. */
const crees: { card_id: string; contact_id: string }[] = []

type Total = {
	organization_id: string
	currency: string
	estimated_total: number
	actual_total: number | null
	cards: number
	shared_cards: number
	revenue_lines: number
	lines_without_actual: number
}

const jetons: Record<'admin' | 'viewer', string> = { admin: '', viewer: '' }

async function lire<T>(request: APIRequestContext, chemin: string, enTetes: Record<string, string>): Promise<T[]> {
	const r = await request.get(`${URL_API}/rest/v1/${chemin}`, { headers: enTetes })
	expect(r.status(), chemin).toBe(200)
	return (await r.json()) as T[]
}

test.beforeAll(async ({ request }) => {
	jetons.admin = await jetonDe('admin@p2enjoy.test')
	jetons.viewer = await jetonDe('viewer@p2enjoy.test')
	const contacts = await lire<{ id: string; full_name: string; workspace_id: string }>(
		request,
		'contacts?select=id,full_name,workspace_id',
		enTetesService(),
	)
	for (const [nom, card] of RATTACHEMENTS) {
		const contact = contacts.find((c) => c.full_name === nom)
		expect(contact, `le contact ${nom} du seed`).toBeDefined()
		const r = await request.post(`${URL_API}/rest/v1/card_contacts`, {
			headers: {
				...enTetesAuthentifies(jetons.admin),
				'Content-Type': 'application/json',
				Prefer: 'resolution=ignore-duplicates,return=representation',
			},
			data: { workspace_id: contact!.workspace_id, card_id: card, contact_id: contact!.id },
		})
		expect(r.status(), `rattacher ${nom}`).toBe(201)
		if (((await r.json()) as unknown[]).length === 1) crees.push({ card_id: card, contact_id: contact!.id })
	}
})

test.afterAll(async ({ request }) => {
	for (const c of crees) {
		const r = await request.delete(`${URL_API}/rest/v1/card_contacts?card_id=eq.${c.card_id}&contact_id=eq.${c.contact_id}`, {
			headers: enTetesAuthentifies(jetons.admin),
		})
		expect(r.status()).toBeLessThan(300)
	}
})

const centimes = (v: number) => Math.round(v * 100) / 100
const tri = (a: Total, b: Total) =>
	a.organization_id === b.organization_id ? (a.currency < b.currency ? -1 : 1) : a.organization_id < b.organization_id ? -1 : 1

/** Le calcul du §12.1 et du §12.2, refait sur les tables, pour les affaires que lit le jeton donné. */
async function oracle(request: APIRequestContext, jeton: string): Promise<Total[]> {
	const lisibles = new Set(
		(await lire<{ id: string }>(request, 'cards?select=id&deleted_at=is.null', enTetesAuthentifies(jeton))).map((c) => c.id),
	)
	const service = enTetesService()
	const [contacts, rattachements, affaires, lignes] = await Promise.all([
		lire<{ id: string; organization_id: string | null }>(request, 'contacts?select=id,organization_id', service),
		lire<{ card_id: string; contact_id: string }>(request, 'card_contacts?select=card_id,contact_id', service),
		lire<{ id: string; currency: string; deleted_at: string | null }>(request, 'cards?select=id,currency,deleted_at', service),
		lire<{ id: string; card_id: string; estimated_amount: number; actual_amount: number | null; settled_at: string | null }>(
			request,
			'card_revenues?select=id,card_id,estimated_amount,actual_amount,settled_at',
			service,
		),
	])
	const organisationDe = new Map(contacts.map((c) => [c.id, c.organization_id]))
	const affaire = new Map(affaires.map((a) => [a.id, a]))
	// Les organisations de chaque affaire lisible et hors corbeille, chacune une fois.
	const organisationsDe = new Map<string, Set<string>>()
	for (const r of rattachements) {
		const o = organisationDe.get(r.contact_id)
		const a = affaire.get(r.card_id)
		if (o == null || a === undefined || a.deleted_at !== null || !lisibles.has(a.id)) continue
		const ensemble = organisationsDe.get(a.id) ?? new Set<string>()
		ensemble.add(o)
		organisationsDe.set(a.id, ensemble)
	}
	const totaux = new Map<string, Total & { _cartes: Set<string>; _partagees: Set<string>; _reelConnu: boolean }>()
	for (const l of lignes) {
		const organisations = organisationsDe.get(l.card_id)
		if (organisations === undefined) continue
		const devise = affaire.get(l.card_id)!.currency
		for (const o of organisations) {
			const cle = `${o}|${devise}`
			const t = totaux.get(cle) ?? {
				organization_id: o, currency: devise, estimated_total: 0, actual_total: 0, cards: 0, shared_cards: 0,
				revenue_lines: 0, lines_without_actual: 0, _cartes: new Set(), _partagees: new Set(), _reelConnu: false,
			}
			t.estimated_total += Number(l.estimated_amount)
			if (l.actual_amount !== null) {
				t.actual_total = (t.actual_total ?? 0) + Number(l.actual_amount)
				t._reelConnu = true
			}
			t.revenue_lines += 1
			if (l.settled_at === null && l.actual_amount === null) t.lines_without_actual += 1
			t._cartes.add(l.card_id)
			if (organisations.size > 1) t._partagees.add(l.card_id)
			totaux.set(cle, t)
		}
	}
	return [...totaux.values()]
		.map(({ _cartes, _partagees, _reelConnu, ...t }) => ({
			...t,
			estimated_total: centimes(t.estimated_total),
			actual_total: _reelConnu ? centimes(t.actual_total ?? 0) : null,
			cards: _cartes.size,
			shared_cards: _partagees.size,
		}))
		.sort(tri)
}

async function appeler(request: APIRequestContext, enTetes: Record<string, string>, donnees: Record<string, string> = {}) {
	return request.post(`${URL_API}${FONCTION}`, { headers: { ...enTetes, 'Content-Type': 'application/json' }, data: donnees })
}

const normaliser = (lignes: Total[]): Total[] =>
	lignes
		.map((l) => ({
			...l,
			estimated_total: Number(l.estimated_total),
			actual_total: l.actual_total === null ? null : Number(l.actual_total),
		}))
		.sort(tri)

test.describe('le prévu et le réel d’une organisation, sous la RLS de l’appelant (§12.3)', () => {
	for (const profil of ['admin', 'viewer'] as const) {
		test(`sous le jeton ${profil === 'admin' ? 'de l’administratrice' : 'de la lectrice'}, les sommes égalent l’oracle`, async ({ request }) => {
			const attendu = await oracle(request, jetons[profil])
			// Le témoin : un oracle vide ne prouverait rien.
			expect(attendu.length, 'l’oracle n’est pas vide').toBeGreaterThan(0)
			const r = await appeler(request, enTetesAuthentifies(jetons[profil]))
			expect(r.status()).toBe(200)
			expect(normaliser((await r.json()) as Total[])).toEqual(attendu)
		})
	}

	test('les cas posés : une fois malgré deux contacts, deux devises, partagée ; la lectrice lit moins', async ({ request }) => {
		const r = await appeler(request, enTetesAuthentifies(jetons.admin))
		const totaux = normaliser((await r.json()) as Total[])
		const contacts = await lire<{ full_name: string; organization_id: string }>(request, 'contacts?select=full_name,organization_id', enTetesService())
		const vertigo = contacts.find((c) => c.full_name === 'Marc Lefort')!.organization_id
		const lumen = contacts.find((c) => c.full_name === 'Thomas Garnier')!.organization_id
		const de = (o: string, devise: string) => totaux.find((t) => t.organization_id === o && t.currency === devise)
		// …0cd compte UNE fois pour Vertigo malgré Marc et Nadia, et elle est partagée avec Atelier Lumen.
		expect(de(vertigo, 'EUR')).toMatchObject({ estimated_total: 210000, actual_total: 163000, cards: 1, shared_cards: 1, revenue_lines: 2 })
		expect(de(vertigo, 'CHF')).toMatchObject({ estimated_total: 28000, actual_total: 14000, cards: 1, shared_cards: 0 })
		expect(de(lumen, 'EUR')).toMatchObject({ estimated_total: 210000, cards: 1, shared_cards: 1 })
		// La lectrice ne lit pas …0cd : ni Vertigo en EUR, ni Atelier Lumen ; Vertigo en CHF reste.
		const lu = normaliser((await (await appeler(request, enTetesAuthentifies(jetons.viewer))).json()) as Total[])
		expect(lu.find((t) => t.organization_id === vertigo && t.currency === 'EUR')).toBeUndefined()
		expect(lu.find((t) => t.organization_id === lumen)).toBeUndefined()
		expect(lu.find((t) => t.organization_id === vertigo && t.currency === 'CHF')).toMatchObject({ cards: 1 })
	})

	test('`p_organization_id` restreint à une organisation ; une organisation inconnue rend zéro ligne', async ({ request }) => {
		const attendu = await oracle(request, jetons.admin)
		const premiere = attendu[0]!.organization_id
		const r = await appeler(request, enTetesAuthentifies(jetons.admin), { p_organization_id: premiere })
		expect(r.status()).toBe(200)
		expect(normaliser((await r.json()) as Total[])).toEqual(attendu.filter((l) => l.organization_id === premiere))
		const inconnue = await appeler(request, enTetesAuthentifies(jetons.admin), { p_organization_id: INCONNUE })
		expect(inconnue.status()).toBe(200)
		expect(await inconnue.json()).toEqual([])
	})

	test('l’anonyme est refusé par le privilège', async ({ request }) => {
		const r = await appeler(request, enTetesAnonymes())
		expect(r.status()).toBe(401)
	})
})
