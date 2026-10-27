// @verifies CRM-118 (docs/BACKLOG.md) — tranche T1.b : `set_default_workflow` et la garde d'archivage d'un workflow, par
//           requête directe aux vrais jetons, hors interface
// @verifies docs/SPEC-workflow-engine.md §7 quinquies.1 (l'ordre des refus, le défaut global seulement, l'atomicité ; la
//           garde : workflow employé, workflow par défaut, rétablissement libre), §7 quinquies.5 (preuves API) ;
//           docs/SCHEMA.md « Migration `0130` » ; docs/JOURNAL.md décisions 758 et 760
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel du profil)
//
// LES WORKFLOWS DE LA PREUVE SONT POSÉS ET RETIRÉS PAR LA CLÉ DE SERVICE, aux identifiants fixes `e1180000-…` : une
// exécution interrompue laisse une trace reconnaissable que la suivante écrase. La clé de service ne prouve JAMAIS un
// refus (décision 50) : elle pose, constate et range. Tout geste qui déplace le défaut du seed le rend dans un `finally`
// — d'autres preuves comptent sur lui.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
/** Le workflow par défaut du seed, employé par ses channels. */
const DEFAUT_SEED = '5eed0000-0000-4000-8000-000000000051'
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'

const LIBRE_A = 'e1180000-0000-4000-8000-0000000000a1'
const LIBRE_B = 'e1180000-0000-4000-8000-0000000000a2'
const DU_TRACK = 'e1180000-0000-4000-8000-0000000000a3'

const WF = '/rest/v1/workflows'
const RPC = '/rest/v1/rpc/set_default_workflow'

const [ADMIN, BIZDEV, LECTRICE] = COMPTES_SEED

type Workflow = { id: string; is_default: boolean; archived_at: string | null }

async function lire(requete: APIRequestContext, id: string): Promise<Workflow> {
	const reponse = await requete.get(`${WF}?id=eq.${id}&select=id,is_default,archived_at`, { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	const lignes = (await reponse.json()) as Workflow[]
	expect(lignes, `le workflow ${id} doit exister`).toHaveLength(1)
	return lignes[0]!
}

async function definir(requete: APIRequestContext, enTetes: Record<string, string>, id: string) {
	const reponse = await requete.post(RPC, {
		headers: { ...enTetes, 'Content-Type': 'application/json' },
		data: { p_workflow: id },
	})
	return { statut: reponse.status(), corps: (await reponse.json()) as Record<string, unknown> }
}

async function archiver(requete: APIRequestContext, enTetes: Record<string, string>, id: string, archive: boolean) {
	const reponse = await requete.patch(`${WF}?id=eq.${id}`, {
		headers: { ...enTetes, 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: { archived_at: archive ? new Date().toISOString() : null },
	})
	return { statut: reponse.status(), corps: (await reponse.json()) as unknown }
}

/** Rend le défaut au seed, par la fonction elle-même et le jeton réel de l'administratrice. */
async function rendreLeDefaut(requete: APIRequestContext) {
	const { statut } = await definir(requete, enTetesAuthentifies(await jetonDe(ADMIN.adresse)), DEFAUT_SEED)
	expect(statut, 'le défaut du seed doit être rendu').toBe(200)
	expect((await lire(requete, DEFAUT_SEED)).is_default).toBe(true)
}

async function nombreDeDefauts(requete: APIRequestContext): Promise<number> {
	const reponse = await requete.get(`${WF}?workspace_id=eq.${WORKSPACE_SEED}&is_default=is.true&select=id`, {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as unknown[]).length
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request }) => {
	await request.delete(`${WF}?id=in.(${LIBRE_A},${LIBRE_B},${DU_TRACK})`, { headers: enTetesService() })
	const pose = await request.post(WF, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: [
			{ id: LIBRE_A, workspace_id: WORKSPACE_SEED, name: 'Preuve T1.b — libre A', scope: 'global', track_id: null },
			{ id: LIBRE_B, workspace_id: WORKSPACE_SEED, name: 'Preuve T1.b — libre B', scope: 'global', track_id: null },
			{ id: DU_TRACK, workspace_id: WORKSPACE_SEED, name: 'Preuve T1.b — du track', scope: 'track', track_id: TRACK_CONSEIL },
		],
	})
	expect(pose.status(), await pose.text()).toBe(201)
})

test.afterAll(async ({ request }) => {
	if (!(await lire(request, DEFAUT_SEED)).is_default) await rendreLeDefaut(request)
	const menage = await request.delete(`${WF}?id=in.(${LIBRE_A},${LIBRE_B},${DU_TRACK})`, { headers: enTetesService() })
	expect(menage.status()).toBeLessThan(300)
})

test.describe('D — set_default_workflow', () => {
	test('D1 — l’anonyme, la lectrice et le business developer sont refusés, et rien ne bouge', async ({ request }) => {
		expect((await definir(request, enTetesAnonymes(), LIBRE_A)).statut).toBe(401)
		for (const compte of [LECTRICE, BIZDEV]) {
			const { statut, corps } = await definir(request, enTetesAuthentifies(await jetonDe(compte.adresse)), LIBRE_A)
			expect(statut, compte.role).toBe(403)
			expect(corps).toMatchObject({ code: '42501', message: 'reserve aux administrateurs' })
		}
		expect((await lire(request, LIBRE_A)).is_default).toBe(false)
		expect((await lire(request, DEFAUT_SEED)).is_default).toBe(true)
	})

	test('D2 — un workflow propre à un track ne devient pas le défaut ; un inconnu est introuvable', async ({ request }) => {
		const admin = enTetesAuthentifies(await jetonDe(ADMIN.adresse))
		const duTrack = await definir(request, admin, DU_TRACK)
		expect(duTrack.statut).toBe(400)
		expect(duTrack.corps).toMatchObject({ code: 'P0001', message: 'workflow non global' })
		const inconnu = await definir(request, admin, '00000000-0000-4000-8000-000000000000')
		expect(inconnu.corps).toMatchObject({ code: 'P0002', message: 'workflow introuvable' })
		expect((await lire(request, DEFAUT_SEED)).is_default).toBe(true)
	})

	test('D3 — l’administratrice désigne un défaut en une transaction : un seul défaut, l’ancien éteint', async ({ request }) => {
		const admin = enTetesAuthentifies(await jetonDe(ADMIN.adresse))
		try {
			const { statut, corps } = await definir(request, admin, LIBRE_A)
			expect(statut).toBe(200)
			expect(corps).toMatchObject({ id: LIBRE_A, is_default: true })
			expect((await lire(request, DEFAUT_SEED)).is_default).toBe(false)
			expect(await nombreDeDefauts(request)).toBe(1)
			// Redésigner le défaut en place rend la ligne, sans erreur.
			expect((await definir(request, admin, LIBRE_A)).statut).toBe(200)
		} finally {
			await rendreLeDefaut(request)
		}
		expect(await nombreDeDefauts(request)).toBe(1)
	})
})

test.describe('G — la garde d’archivage', () => {
	test('G1 — un workflow employé par des channels ne s’archive pas, et le refus en donne le nombre', async ({ request }) => {
		const admin = enTetesAuthentifies(await jetonDe(ADMIN.adresse))
		const { statut, corps } = await archiver(request, admin, DEFAUT_SEED, true)
		expect(statut).toBe(400)
		expect(corps).toMatchObject({ code: 'P0001' })
		expect((corps as { message: string }).message).toMatch(/^workflow_in_use : \d+ channel\(s\)$/)
		expect((await lire(request, DEFAUT_SEED)).archived_at).toBeNull()
	})

	test('G2 — le workflow par défaut ne s’archive pas', async ({ request }) => {
		const admin = enTetesAuthentifies(await jetonDe(ADMIN.adresse))
		try {
			expect((await definir(request, admin, LIBRE_A)).statut).toBe(200)
			const { statut, corps } = await archiver(request, admin, LIBRE_A, true)
			expect(statut).toBe(400)
			expect(corps).toMatchObject({ code: 'P0001', message: 'workflow_is_default' })
			expect((await lire(request, LIBRE_A)).archived_at).toBeNull()
		} finally {
			await rendreLeDefaut(request)
		}
	})

	test('G3 — un workflow libre s’archive, ne devient plus le défaut, et se rétablit sans refus', async ({ request }) => {
		const admin = enTetesAuthentifies(await jetonDe(ADMIN.adresse))
		const archive = await archiver(request, admin, LIBRE_B, true)
		expect(archive.statut).toBe(200)
		expect(archive.corps).toHaveLength(1)
		expect((await lire(request, LIBRE_B)).archived_at).not.toBeNull()
		expect((await definir(request, admin, LIBRE_B)).corps).toMatchObject({ code: 'P0001', message: 'workflow archive' })
		const retabli = await archiver(request, admin, LIBRE_B, false)
		expect(retabli.statut).toBe(200)
		expect(retabli.corps).toHaveLength(1)
		expect((await lire(request, LIBRE_B)).archived_at).toBeNull()
	})

	test('G4 — la lectrice n’archive pas : zéro ligne, rien n’a bougé', async ({ request }) => {
		const lectrice = enTetesAuthentifies(await jetonDe(LECTRICE.adresse))
		const { statut, corps } = await archiver(request, lectrice, LIBRE_B, true)
		expect(statut).toBe(200)
		expect(corps).toEqual([])
		expect((await lire(request, LIBRE_B)).archived_at).toBeNull()
	})
})
