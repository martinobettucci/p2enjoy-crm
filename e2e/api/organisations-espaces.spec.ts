// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.c : `organization_list` lit plusieurs espaces et `temps_valorise` rend
//           l'espace de chaque ligne, hors interface, avec les jetons réels — la portée de tous les espaces lus, des
//           espaces donnés, de l'espace donné (l'appel d'avant, celui de la webapp livrée et du connecteur) ; un espace non
//           lu ne rend rien ; l'anonyme est refusé
// @verifies docs/SPEC-espace-courant.md §16.8.1, §16.8.2 ; docs/SCHEMA.md « Migrations `0201` et `0202` » ;
//           docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
//
// L'ORACLE : les tables lues SOUS LE JETON DU PROFIL. La fonction ne rend ni plus ni moins que ce que la personne lit. Sur
// le seed (docs/SPEC-seed.md §54) : Camille (`admin@`) lit « P2Enjoy SAS » et « Studio Lumen », la lectrice le premier
// seul. Le fichier n'écrit rien.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const P2ENJOY = '5eed0000-0000-4000-8000-000000000001'
const PROFILS = { admin: 'admin@p2enjoy.test', viewer: 'viewer@p2enjoy.test' } as const
type Profil = keyof typeof PROFILS
const jetons: Record<Profil, string> = { admin: '', viewer: '' }
let lumen = ''

type Ligne = { id: string; name: string; workspace_id: string; total_count: number }
type Saisie = { track_id: string | null; workspace_id: string }

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
	const r = await appeler(request, 'organization_list', enTetesAuthentifies(jetons[profil]), { p_limit: 100, ...donnees })
	expect(r.status(), JSON.stringify(donnees)).toBe(200)
	return (await r.json()) as Ligne[]
}

const ids = (lignes: readonly { id: string }[]) => lignes.map((l) => l.id).sort()

test.beforeAll(async ({ request }) => {
	for (const p of Object.keys(PROFILS) as Profil[]) jetons[p] = await jetonDe(PROFILS[p])
	// L'identifiant de « Studio Lumen » n'est pas figé (décision 972) : il se lit par son slug, sous le jeton de Camille.
	const [espace] = await lire<{ id: string }>(request, 'workspaces?select=id&slug=eq.studio-lumen', jetons.admin)
	expect(espace, 'le seed §54 a son second espace').toBeTruthy()
	lumen = espace!.id
})

test.describe('`organization_list` sur plusieurs espaces (§16.8.1)', () => {
	test('sans espace donné : tout ce que la personne lit, chaque ligne avec son espace, le total sur la portée', async ({ request }) => {
		for (const profil of Object.keys(PROFILS) as Profil[]) {
			const oracle = await lire<{ id: string; workspace_id: string }>(request, 'organizations?select=id,workspace_id', jetons[profil])
			const lignes = await liste(request, profil)
			expect(ids(lignes), profil).toEqual(ids(oracle))
			const espaceDe = new Map(oracle.map((o) => [o.id, o.workspace_id]))
			for (const ligne of lignes) expect(ligne.workspace_id, `${profil} ${ligne.name}`).toBe(espaceDe.get(ligne.id))
			expect(lignes.every((l) => Number(l.total_count) === oracle.length), profil).toBe(true)
		}
		// Camille lit les deux espaces ; la lectrice, le premier seul.
		expect(new Set((await liste(request, 'admin')).map((l) => l.workspace_id))).toEqual(new Set([P2ENJOY, lumen]))
		expect(new Set((await liste(request, 'viewer')).map((l) => l.workspace_id))).toEqual(new Set([P2ENJOY]))
	})

	test('`p_workspace_ids` restreint ; `p_workspace_id` seul rend la liste d’avant ; le premier l’emporte', async ({ request }) => {
		const deLumen = await liste(request, 'admin', { p_workspace_ids: [lumen] })
		expect(deLumen.map((l) => l.name).sort()).toEqual(['Maison Arlo', 'Vertigo Conseil'])
		expect(deLumen.every((l) => l.workspace_id === lumen)).toBe(true)
		const oracleP2enjoy = await lire<{ id: string }>(request, `organizations?select=id&workspace_id=eq.${P2ENJOY}`, jetons.admin)
		expect(ids(await liste(request, 'admin', { p_workspace_id: P2ENJOY }))).toEqual(ids(oracleP2enjoy))
		expect(ids(await liste(request, 'admin', { p_workspace_id: P2ENJOY, p_workspace_ids: [lumen] }))).toEqual(ids(deLumen))
		// La pagination compte toute la portée, au-delà de la page.
		const page = await liste(request, 'admin', { p_limit: 2 })
		expect(page).toHaveLength(2)
		expect(Number(page[0]!.total_count)).toBe((await liste(request, 'admin')).length)
	})

	test('le refus : un espace non lu ne rend aucune ligne, sans erreur ; l’anonyme est refusé', async ({ request }) => {
		expect(await liste(request, 'viewer', { p_workspace_ids: [lumen] })).toEqual([])
		expect(await liste(request, 'viewer', { p_workspace_id: lumen })).toEqual([])
		const melange = await liste(request, 'viewer', { p_workspace_ids: [P2ENJOY, lumen] })
		expect(melange.length).toBeGreaterThan(0)
		expect(melange.every((l) => l.workspace_id === P2ENJOY)).toBe(true)
		const anonyme = await appeler(request, 'organization_list', enTetesAnonymes(), { p_workspace_ids: [P2ENJOY] })
		expect(anonyme.status()).toBe(401)
	})
})

test.describe('`temps_valorise` rend l’espace de chaque ligne (§16.8.2)', () => {
	const periode = { p_debut: '1900-01-01', p_fin: '9999-12-31' }

	test('chaque ligne porte l’espace de son track ; la saisie de « Studio Lumen » porte le sien', async ({ request }) => {
		const lignes = (await (await appeler(request, 'temps_valorise', enTetesAuthentifies(jetons.admin), periode)).json()) as Saisie[]
		const tracks = await lire<{ id: string; workspace_id: string }>(request, 'tracks?select=id,workspace_id', jetons.admin)
		const espaceDuTrack = new Map(tracks.map((t) => [t.id, t.workspace_id]))
		const avecTrack = lignes.filter((l) => l.track_id !== null)
		expect(avecTrack.length).toBeGreaterThan(0)
		for (const ligne of avecTrack) expect(ligne.workspace_id).toBe(espaceDuTrack.get(ligne.track_id!))
		expect(lignes.some((l) => l.workspace_id === lumen)).toBe(true)
		expect(lignes.some((l) => l.workspace_id === P2ENJOY)).toBe(true)
	})

	test('le refus : la lectrice d’un seul espace ne reçoit aucune ligne de l’autre', async ({ request }) => {
		const r = await appeler(request, 'temps_valorise', enTetesAuthentifies(jetons.viewer), periode)
		expect(r.status()).toBe(200)
		const lignes = (await r.json()) as Saisie[]
		expect(lignes.length).toBeGreaterThan(0)
		expect(lignes.every((l) => l.workspace_id === P2ENJOY)).toBe(true)
	})
})
