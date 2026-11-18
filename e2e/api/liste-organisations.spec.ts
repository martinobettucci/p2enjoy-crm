// @verifies CRM-152 (docs/BACKLOG.md) — tranche T1 : les tracks d'une organisation et la liste en base, hors interface,
//           avec les jetons réels des trois profils
// @verifies docs/SPEC-organisations.md §8.1 (un track par un contact lié à une affaire hors corbeille, placée par un
//           rattachement non archivé dans un channel puis un track ni archivés ni à la corbeille, sous la RLS de
//           l'appelant), §8.2 (`organization_list` : recherche, l'un des tracks, avec ou sans recettes, tri, pagination,
//           `total_count`, les deux refus 22023), §8.5 (les preuves API) ; docs/JOURNAL.md décisions 931 et 936
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel du profil)
//
// L'ORACLE : les tables lues SOUS LE JETON DU PROFIL, la règle refaite ici sans les fonctions. La fonction ne rend donc
// ni plus ni moins que ce que la personne lit. Le fichier n'écrit rien.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const FORMATION = '5eed0000-0000-4000-8000-000000000023'
const CONSEIL_IA = '5eed0000-0000-4000-8000-000000000021'

const PROFILS = {
	admin: 'admin@p2enjoy.test',
	bizdev: 'bizdev@p2enjoy.test',
	viewer: 'viewer@p2enjoy.test',
} as const
type Profil = keyof typeof PROFILS
const jetons: Record<Profil, string> = { admin: '', bizdev: '', viewer: '' }

type Ligne = {
	id: string
	name: string
	domain: string | null
	website: string | null
	contacts: number
	has_revenues: boolean
	total_count: number
}
type TrackDOrganisation = { organization_id: string; track_id: string; slug: string }

test.beforeAll(async () => {
	for (const p of Object.keys(PROFILS) as Profil[]) jetons[p] = await jetonDe(PROFILS[p])
})

async function lire<T>(request: APIRequestContext, chemin: string, jeton: string): Promise<T[]> {
	const r = await request.get(`${URL_API}/rest/v1/${chemin}`, { headers: enTetesAuthentifies(jeton) })
	expect(r.status(), chemin).toBe(200)
	return (await r.json()) as T[]
}

async function appeler(request: APIRequestContext, fonction: string, enTetes: Record<string, string>, donnees: object) {
	return request.post(`${URL_API}/rest/v1/rpc/${fonction}`, {
		headers: { ...enTetes, 'Content-Type': 'application/json' },
		data: donnees,
	})
}

async function liste(request: APIRequestContext, profil: Profil, donnees: object = {}): Promise<Ligne[]> {
	const r = await appeler(request, 'organization_list', enTetesAuthentifies(jetons[profil]), {
		p_workspace_id: ESPACE,
		p_limit: 100,
		...donnees,
	})
	expect(r.status(), JSON.stringify(donnees)).toBe(200)
	return (await r.json()) as Ligne[]
}

/** La règle du §8.1 et les grandeurs du §8.2, refaites sur les tables que lit le jeton du profil. */
async function oracle(request: APIRequestContext, jeton: string) {
	const [organisations, contacts, rattachements, affaires, placements, channels, tracks, recettes] = await Promise.all([
		lire<{ id: string; name: string; domain: string | null; website: string | null }>(
			request, `organizations?select=id,name,domain,website&workspace_id=eq.${ESPACE}`, jeton),
		lire<{ id: string; organization_id: string | null }>(request, 'contacts?select=id,organization_id', jeton),
		lire<{ card_id: string; contact_id: string }>(request, 'card_contacts?select=card_id,contact_id', jeton),
		lire<{ id: string }>(request, 'cards?select=id&deleted_at=is.null', jeton),
		lire<{ card_id: string; channel_id: string }>(request, 'card_placements?select=card_id,channel_id&archived_at=is.null', jeton),
		lire<{ id: string; track_id: string }>(request, 'channels?select=id,track_id&archived_at=is.null&deleted_at=is.null', jeton),
		lire<{ id: string; slug: string }>(request, 'tracks?select=id,slug&archived_at=is.null&deleted_at=is.null', jeton),
		lire<{ card_id: string }>(request, 'card_revenues?select=card_id', jeton),
	])
	const vivantes = new Set(affaires.map((a) => a.id))
	const trackDuChannel = new Map(channels.map((c) => [c.id, c.track_id]))
	const slugDuTrack = new Map(tracks.map((t) => [t.id, t.slug]))
	const avecRecette = new Set(recettes.map((r) => r.card_id))
	const organisationDe = new Map(contacts.map((c) => [c.id, c.organization_id]))
	const tracksDe = new Map<string, Set<string>>()
	const recettesDe = new Set<string>()
	for (const r of rattachements) {
		const o = organisationDe.get(r.contact_id)
		if (o == null || !vivantes.has(r.card_id)) continue
		if (avecRecette.has(r.card_id)) recettesDe.add(o)
		for (const p of placements.filter((x) => x.card_id === r.card_id)) {
			const t = trackDuChannel.get(p.channel_id)
			if (t === undefined || !slugDuTrack.has(t)) continue
			const ensemble = tracksDe.get(o) ?? new Set<string>()
			ensemble.add(slugDuTrack.get(t)!)
			tracksDe.set(o, ensemble)
		}
	}
	return organisations.map((o) => ({
		...o,
		contacts: contacts.filter((c) => c.organization_id === o.id).length,
		has_revenues: recettesDe.has(o.id),
		tracks: [...(tracksDe.get(o.id) ?? [])].sort().join(','),
	}))
}

const slugsParOrganisation = (lignes: TrackDOrganisation[]) => {
	const m = new Map<string, string[]>()
	for (const l of lignes) m.set(l.organization_id, [...(m.get(l.organization_id) ?? []), l.slug])
	return m
}

test.describe('les tracks et la liste des organisations, sous la RLS de l’appelant (§8.1, §8.2)', () => {
	for (const profil of Object.keys(PROFILS) as Profil[]) {
		test(`sous le jeton ${profil}, les tracks et la liste égalent l’oracle`, async ({ request }) => {
			const attendu = await oracle(request, jetons[profil])
			expect(attendu.length, 'l’oracle n’est pas vide').toBeGreaterThan(0)
			expect(attendu.some((o) => o.tracks !== ''), 'au moins une organisation a un track').toBe(true)

			const r = await appeler(request, 'organization_tracks', enTetesAuthentifies(jetons[profil]), {
				p_organization_ids: attendu.map((o) => o.id),
			})
			expect(r.status()).toBe(200)
			const tracks = slugsParOrganisation((await r.json()) as TrackDOrganisation[])
			for (const o of attendu) expect([...(tracks.get(o.id) ?? [])].sort().join(','), o.name).toBe(o.tracks)

			const lignes = await liste(request, profil)
			expect(lignes.map((l) => l.id).sort()).toEqual(attendu.map((o) => o.id).sort())
			for (const l of lignes) {
				const o = attendu.find((x) => x.id === l.id)!
				expect({ contacts: l.contacts, has_revenues: l.has_revenues, total_count: l.total_count }, o.name).toEqual({
					contacts: o.contacts,
					has_revenues: o.has_revenues,
					total_count: attendu.length,
				})
			}
		})
	}

	test('la lectrice voit moins que l’administratrice : Vertigo Conseil n’a pour elle que « formation »', async ({ request }) => {
		const [admin, viewer] = await Promise.all([oracle(request, jetons.admin), oracle(request, jetons.viewer)])
		const vertigo = (o: { name: string }) => o.name === 'Vertigo Conseil'
		expect(admin.find(vertigo)?.tracks).toBe('conseil-ia,formation')
		expect(viewer.find(vertigo)?.tracks).toBe('formation')
		const r = await liste(request, 'viewer', { p_track_ids: [CONSEIL_IA] })
		expect(r.map((l) => l.name)).not.toContain('Vertigo Conseil')
	})

	test('les filtres : la recherche, l’un des tracks, avec et sans recettes', async ({ request }) => {
		const attendu = await oracle(request, jetons.admin)
		const noms = (l: Ligne[]) => l.map((x) => x.name).sort()

		expect(noms(await liste(request, 'admin', { p_search: 'VERTIGO' }))).toEqual(['Vertigo Conseil'])
		expect(await liste(request, 'admin', { p_search: '%' })).toEqual([])
		expect(noms(await liste(request, 'admin', { p_search: '   ' }))).toEqual(noms(await liste(request, 'admin')))

		expect(noms(await liste(request, 'admin', { p_track_ids: [FORMATION] }))).toEqual(
			attendu.filter((o) => o.tracks.split(',').includes('formation')).map((o) => o.name).sort())
		expect(noms(await liste(request, 'admin', { p_track_ids: [FORMATION, CONSEIL_IA] }))).toEqual(
			attendu.filter((o) => /(^|,)(formation|conseil-ia)(,|$)/.test(o.tracks)).map((o) => o.name).sort())

		const avec = await liste(request, 'admin', { p_revenues: 'with' })
		const sans = await liste(request, 'admin', { p_revenues: 'without' })
		expect(avec.length, 'le seed démontre une organisation avec recettes').toBeGreaterThan(0)
		expect(noms(avec)).toEqual(attendu.filter((o) => o.has_revenues).map((o) => o.name).sort())
		expect(noms(sans)).toEqual(attendu.filter((o) => !o.has_revenues).map((o) => o.name).sort())
		expect(avec[0]!.total_count).toBe(avec.length)
	})

	test('le tri par contacts et la pagination : un ordre total, des pages sans répétition, le total au-delà de la page', async ({ request }) => {
		const toutes = await liste(request, 'admin', { p_sort: 'contacts', p_descending: true })
		for (let i = 1; i < toutes.length; i++) expect(toutes[i - 1]!.contacts).toBeGreaterThanOrEqual(toutes[i]!.contacts)
		const pages: Ligne[] = []
		for (let decalage = 0; decalage < toutes.length; decalage += 2) {
			const page = await liste(request, 'admin', { p_sort: 'contacts', p_descending: true, p_limit: 2, p_offset: decalage })
			expect(page.length).toBeLessThanOrEqual(2)
			expect(page.every((l) => l.total_count === toutes.length)).toBe(true)
			pages.push(...page)
		}
		expect(pages.map((l) => l.id)).toEqual(toutes.map((l) => l.id))
	})

	test('les refus : un filtre de recettes ou un tri inconnus (400), l’anonyme (401)', async ({ request }) => {
		const recettes = await appeler(request, 'organization_list', enTetesAuthentifies(jetons.admin), {
			p_workspace_id: ESPACE, p_revenues: 'peut-etre',
		})
		expect(recettes.status()).toBe(400)
		expect(((await recettes.json()) as { message: string }).message).toBe('invalid_revenues_filter')
		const tri = await appeler(request, 'organization_list', enTetesAuthentifies(jetons.admin), {
			p_workspace_id: ESPACE, p_sort: 'recettes',
		})
		expect(tri.status()).toBe(400)
		expect(((await tri.json()) as { message: string }).message).toBe('invalid_sort')
		for (const [fonction, donnees] of [
			['organization_list', { p_workspace_id: ESPACE }],
			['organization_tracks', { p_organization_ids: [] }],
		] as const) {
			const r = await appeler(request, fonction, enTetesAnonymes(), donnees)
			expect(r.status(), fonction).toBe(401)
		}
	})
})
