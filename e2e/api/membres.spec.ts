// @verifies CRM-070 (docs/BACKLOG.md) — tranche T1 : l'accès effectif d'un membre, lu par la route REST avec les jetons
//           réels ; la fonction est réservée à l'administrateur de l'espace
// @verifies docs/SPEC-membres.md §3.3, §5 point 1 ; docs/SPEC-permissions-rls.md §2.2, §3.3 bis ; CLAUDE.md §10 (le refus
//           prouvé par une requête directe, avec les vrais jetons des profils)
// @verifies CRM-070 (docs/BACKLOG.md) — tranche T3 : les attentes, lues, inscrites, remplacées et retirées par la route
//           REST ; docs/SPEC-membres.md §3.2, §5 point 3 ; docs/SCHEMA.md §9 bis.8 quinquies
//
// La suite pgTAP `0088` prouve la fonction en base ; ce fichier prouve ce que PostgREST en rend à chaque profil du seed,
// hors interface : l'administratrice lit, le business developer et la lectrice sont refusés, l'anonyme aussi.

import { expect, test } from '@playwright/test'
import { CLE_ANONYME, COMPTES_SEED, URL_API, enTetesAuthentifies, jetonDe } from './jetons'

const [ADMIN, BIZDEV, VIEWER] = COMPTES_SEED
const RPC = `${URL_API}/rest/v1/rpc/acces_effectif_membre`
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const CONSEIL_IA = '5eed0000-0000-4000-8000-000000000021'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'

type Ligne = {
	objet: 'track' | 'channel'
	id: string
	acces_pose: string | null
	acces_effectif: 'none' | 'read' | 'write'
	lisible_par_un_channel: boolean | null
}

test.describe('l’accès effectif d’un membre (docs/SPEC-membres.md §3.3)', () => {
	test('l’administratrice lit les droits posés et l’accès effectif de la lectrice', async ({ request }) => {
		const reponse = await request.post(RPC, {
			headers: { ...enTetesAuthentifies(await jetonDe(ADMIN.adresse)), 'Content-Type': 'application/json' },
			data: { p_ws: ESPACE, p_user: FARIDA },
		})
		expect(reponse.status(), await reponse.text()).toBe(200)
		const lignes = (await reponse.json()) as Ligne[]
		const de = (id: string) => lignes.find((ligne) => ligne.id === id)
		expect(de(CONSEIL_IA)).toMatchObject({ objet: 'track', acces_pose: 'none', acces_effectif: 'none', lisible_par_un_channel: true })
		expect(de(PROSPECTION)).toMatchObject({ objet: 'channel', acces_pose: 'member', acces_effectif: 'write' })
		expect(de(GRANDS_COMPTES)).toMatchObject({ objet: 'channel', acces_pose: null, acces_effectif: 'none' })
	})

	for (const compte of [BIZDEV, VIEWER]) {
		test(`${compte.role} : refusé, avec son jeton réel — il n’administre pas l’espace`, async ({ request }) => {
			const reponse = await request.post(RPC, {
				headers: { ...enTetesAuthentifies(await jetonDe(compte.adresse)), 'Content-Type': 'application/json' },
				data: { p_ws: ESPACE, p_user: FARIDA },
			})
			expect(reponse.status(), await reponse.text()).toBe(403)
			expect(((await reponse.json()) as { message: string }).message).toBe('reserve_aux_administrateurs')
		})
	}

	test('l’anonyme est refusé, sans rien apprendre', async ({ request }) => {
		const reponse = await request.post(RPC, {
			headers: { apikey: CLE_ANONYME, Authorization: `Bearer ${CLE_ANONYME}`, 'Content-Type': 'application/json' },
			data: { p_ws: ESPACE, p_user: FARIDA },
		})
		expect([401, 403], await reponse.text()).toContain(reponse.status())
	})
})

const ATTENTES = `${URL_API}/rest/v1/workspace_invitations`
const INSCRIRE = `${URL_API}/rest/v1/rpc/inscrire_attente`
const ATTENDU = 'attendu@p2enjoy.test'

test.describe('les attentes de l’espace (docs/SPEC-membres.md §3.2)', () => {
	test('l’administratrice inscrit, remplace et retire, sans toucher l’attente du seed', async ({ request }) => {
		const entetes = { ...enTetesAuthentifies(await jetonDe(ADMIN.adresse)), 'Content-Type': 'application/json' }
		const inscrire = (email: string, role: string) =>
			request.post(INSCRIRE, { headers: entetes, data: { p_ws: ESPACE, p_email: email, p_role: role } })
		try {
			const neuve = await inscrire(' Api-Membres@P2Enjoy.test', 'viewer')
			expect(neuve.status(), await neuve.text()).toBe(200)
			expect(await neuve.json()).toBeNull()
			const remplacee = await inscrire('api-membres@p2enjoy.test', 'business_developer')
			expect(remplacee.status(), await remplacee.text()).toBe(200)
			expect(await remplacee.json()).toBe('viewer')

			const lues = await request.get(`${ATTENTES}?workspace_id=eq.${ESPACE}&select=email,role&order=email`, { headers: entetes })
			expect(await lues.json()).toEqual([
				{ email: 'api-membres@p2enjoy.test', role: 'business_developer' },
				{ email: ATTENDU, role: 'viewer' },
			])

			const invalide = await inscrire('sans-arobase', 'viewer')
			expect(invalide.status()).toBe(400)
			expect(((await invalide.json()) as { message: string }).message).toBe('adresse_invalide')
		} finally {
			const retrait = await request.delete(`${ATTENTES}?workspace_id=eq.${ESPACE}&email=eq.api-membres@p2enjoy.test`, {
				headers: { ...entetes, Prefer: 'return=representation' },
			})
			expect(((await retrait.json()) as unknown[]).length).toBe(1)
		}
	})

	for (const compte of [BIZDEV, VIEWER]) {
		test(`${compte.role} : ne lit aucune attente, n’en inscrit ni n’en retire`, async ({ request }) => {
			const entetes = { ...enTetesAuthentifies(await jetonDe(compte.adresse)), 'Content-Type': 'application/json' }
			const lues = await request.get(`${ATTENTES}?workspace_id=eq.${ESPACE}`, { headers: entetes })
			expect(await lues.json()).toEqual([])
			const inscription = await request.post(INSCRIRE, {
				headers: entetes,
				data: { p_ws: ESPACE, p_email: ATTENDU, p_role: 'admin' },
			})
			expect(inscription.status(), await inscription.text()).toBe(403)
			expect(((await inscription.json()) as { message: string }).message).toBe('reserve_aux_administrateurs')
			const retrait = await request.delete(`${ATTENTES}?workspace_id=eq.${ESPACE}&email=eq.${ATTENDU}`, {
				headers: { ...entetes, Prefer: 'return=representation' },
			})
			expect(await retrait.json()).toEqual([])
		})
	}
})
