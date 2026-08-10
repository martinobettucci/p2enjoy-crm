// @verifies CRM-022 (docs/BACKLOG.md) — identités, profils et memberships sûrs
// @verifies docs/SPEC-identite.md §5 (RLS), §6 (mutations), §7 (dernier admin), §10 (preuves)
// @verifies CLAUDE.md §10 — les refus passent par de vrais JWT obtenus auprès de GoTrue

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAuthentifies, enTetesService, jetonDe, MOT_DE_PASSE_SEED } from './jetons'

const WS_SEED = '5eed0000-0000-4000-8000-000000000001'
const U_ADMIN = '5eed0000-0000-4000-8000-000000000011'
const U_BIZDEV = '5eed0000-0000-4000-8000-000000000012'
const U_VIEWER = '5eed0000-0000-4000-8000-000000000013'

const WS_B = '02200000-0000-4000-8000-00000000e2e1'
const EMAIL_B = 'crm022-api@p2enjoy.test'

type Erreur = { readonly code?: string; readonly message?: string }
type Profil = {
	readonly id: string
	readonly full_name: string
	readonly avatar_url: string | null
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

async function lire<T>(
	request: APIRequestContext,
	chemin: string,
	jeton: string,
): Promise<readonly T[]> {
	const reponse = await request.get(chemin, { headers: enTetesAuthentifies(jeton) })
	expect(reponse.status(), `${chemin} : ${await reponse.text()}`).toBe(200)
	return (await reponse.json()) as readonly T[]
}

async function supprimerCompteDePreuve(request: APIRequestContext, id?: string): Promise<void> {
	if (id !== undefined) {
		await request.delete(`/auth/v1/admin/users/${id}`, { headers: enTetesService() })
		return
	}
	const liste = await request.get('/auth/v1/admin/users?page=1&per_page=200', {
		headers: enTetesService(),
	})
	if (!liste.ok()) return
	const corps = (await liste.json()) as { readonly users?: readonly { id: string; email?: string }[] }
	const ancien = corps.users?.find((utilisateur) => utilisateur.email === EMAIL_B)
	if (ancien !== undefined) {
		await request.delete(`/auth/v1/admin/users/${ancien.id}`, { headers: enTetesService() })
	}
}

test('les trois rôles lisent exactement les trois identités consenties du seed', async ({ request }) => {
	for (const jeton of [jetonAdmin, jetonBizdev, jetonViewer]) {
		const profils = await lire<Profil>(
			request,
			'/rest/v1/profiles?select=id,full_name,avatar_url&order=id',
			jeton,
		)
		expect(profils).toEqual([
			{
				id: U_ADMIN,
				full_name: 'Camille Aubert',
				avatar_url: '/avatars/camille-aubert.svg',
			},
			{
				id: U_BIZDEV,
				full_name: 'Driss Lemoine',
				avatar_url: '/avatars/driss-lemoine.svg',
			},
			{
				id: U_VIEWER,
				full_name: 'Farida Nowak',
				avatar_url: '/avatars/farida-nowak.svg',
			},
		])
		expect(
			await lire(request, `/rest/v1/workspaces?select=id&id=eq.${WS_SEED}`, jeton),
		).toHaveLength(1)
		expect(
			await lire(request, `/rest/v1/workspace_members?select=user_id&workspace_id=eq.${WS_SEED}`, jeton),
		).toHaveLength(3)
	}
})

test('un utilisateur modifie son profil normalisé, mais ni celui d’un collègue ni `locale`', async ({
	request,
}) => {
	const propre = await request.patch(`/rest/v1/profiles?id=eq.${U_ADMIN}`, {
		headers: {
			...enTetesAuthentifies(jetonAdmin),
			'Content-Type': 'application/json',
			Prefer: 'return=representation',
		},
		data: { full_name: '  Camille Aubert  ' },
	})
	expect(propre.status()).toBe(200)
	expect((await propre.json()) as readonly Profil[]).toMatchObject([
		{ id: U_ADMIN, full_name: 'Camille Aubert' },
	])

	const collegue = await request.patch(`/rest/v1/profiles?id=eq.${U_BIZDEV}`, {
		headers: {
			...enTetesAuthentifies(jetonAdmin),
			'Content-Type': 'application/json',
			Prefer: 'return=representation',
		},
		data: { full_name: 'Usurpation' },
	})
	expect(collegue.status()).toBe(200)
	expect(await collegue.json()).toEqual([])
	expect(
		await lire<Profil>(request, `/rest/v1/profiles?select=id,full_name,avatar_url&id=eq.${U_BIZDEV}`, jetonAdmin),
	).toMatchObject([{ full_name: 'Driss Lemoine' }])

	const locale = await request.patch(`/rest/v1/profiles?id=eq.${U_ADMIN}`, {
		headers: { ...enTetesAuthentifies(jetonAdmin), 'Content-Type': 'application/json' },
		data: { locale: 'en' },
	})
	expect(locale.status()).toBe(403)
	expect((await locale.json()) as Erreur).toMatchObject({ code: '42501' })
})

test('seul l’admin change un rôle, et l’état initial est restauré', async ({ request }) => {
	const filtre = `workspace_id=eq.${WS_SEED}&user_id=eq.${U_VIEWER}`
	const modifier = async (jeton: string, role: string) =>
		request.patch(`/rest/v1/workspace_members?${filtre}`, {
			headers: {
				...enTetesAuthentifies(jeton),
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
			data: { role },
		})

	try {
		const admin = await modifier(jetonAdmin, 'business_developer')
		expect(admin.status()).toBe(200)
		expect(await admin.json()).toMatchObject([{ role: 'business_developer' }])

		for (const jeton of [jetonBizdev, jetonViewer]) {
			const refusee = await modifier(jeton, 'admin')
			expect(refusee.status()).toBe(200)
			expect(await refusee.json()).toEqual([])
		}
	} finally {
		const restauree = await modifier(jetonAdmin, 'viewer')
		expect(restauree.status()).toBe(200)
	}
	const relue = await lire<{ role: string }>(
		request,
		`/rest/v1/workspace_members?select=role&${filtre}`,
		jetonAdmin,
	)
	expect(relue).toEqual([{ role: 'viewer' }])
})

test('un second workspace créé par les vraies routes reste invisible dans les deux directions', async ({
	request,
}) => {
	let utilisateurB: string | undefined
	await request.delete(`/rest/v1/workspaces?id=eq.${WS_B}`, { headers: enTetesService() })
	await supprimerCompteDePreuve(request)
	try {
		const compte = await request.post('/auth/v1/admin/users', {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: {
				email: EMAIL_B,
				password: MOT_DE_PASSE_SEED,
				email_confirm: true,
				user_metadata: {
					full_name: 'Élodie Espace B',
					avatar_url: '/avatars/camille-aubert.svg',
				},
			},
		})
		expect(compte.status(), await compte.text()).toBe(200)
		utilisateurB = ((await compte.json()) as { id: string }).id

		const workspace = await request.post('/rest/v1/workspaces', {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { id: WS_B, name: 'Espace de preuve CRM-022', slug: 'preuve-crm-022-e2e' },
		})
		expect(workspace.status(), await workspace.text()).toBe(201)
		const membership = await request.post('/rest/v1/workspace_members', {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { workspace_id: WS_B, user_id: utilisateurB, role: 'admin' },
		})
		expect(membership.status(), await membership.text()).toBe(201)

		const jetonB = await jetonDe(EMAIL_B)
		expect(await lire(request, `/rest/v1/workspaces?select=id&id=eq.${WS_B}`, jetonAdmin)).toEqual([])
		expect(await lire(request, `/rest/v1/profiles?select=id&id=eq.${utilisateurB}`, jetonAdmin)).toEqual(
			[],
		)
		expect(
			await lire(request, `/rest/v1/workspace_members?select=user_id&workspace_id=eq.${WS_B}`, jetonAdmin),
		).toEqual([])

		expect(await lire(request, '/rest/v1/profiles?select=id,full_name,avatar_url', jetonB)).toMatchObject([
			{ id: utilisateurB, full_name: 'Élodie Espace B' },
		])
		expect(await lire(request, '/rest/v1/workspaces?select=id', jetonB)).toEqual([{ id: WS_B }])
		expect(await lire(request, '/rest/v1/workspace_members?select=user_id', jetonB)).toEqual([
			{ user_id: utilisateurB },
		])
		expect(await lire(request, `/rest/v1/profiles?select=id&id=eq.${U_ADMIN}`, jetonB)).toEqual([])
	} finally {
		await request.delete(`/rest/v1/workspaces?id=eq.${WS_B}`, { headers: enTetesService() })
		await supprimerCompteDePreuve(request, utilisateurB)
	}
})

test('les relations PostgREST embarquent responsable, auteur et acteur sans lecture supplémentaire', async ({
	request,
}) => {
	const cartes = await lire<{
		owner_id: string | null
		responsable: Profil | null
	}>(
		request,
		'/rest/v1/cards?select=owner_id,responsable:profiles!cards_owner_id_fkey(id,full_name,avatar_url)&owner_id=not.is.null&limit=1',
		jetonAdmin,
	)
	expect(cartes[0]?.responsable?.id).toBe(cartes[0]?.owner_id)
	expect(cartes[0]?.responsable?.full_name).toBeTruthy()

	const commentaires = await lire<{
		author_id: string | null
		auteur: Profil | null
	}>(
		request,
		'/rest/v1/card_comments?select=author_id,auteur:profiles!card_comments_author_id_fkey(id,full_name,avatar_url)&author_id=not.is.null&limit=1',
		jetonAdmin,
	)
	expect(commentaires[0]?.auteur?.id).toBe(commentaires[0]?.author_id)

	const evenements = await lire<{
		actor_id: string | null
		acteur: Profil | null
	}>(
		request,
		'/rest/v1/card_events?select=actor_id,acteur:profiles!card_events_actor_id_fkey(id,full_name,avatar_url)&actor_id=not.is.null&limit=1',
		jetonAdmin,
	)
	expect(evenements[0]?.acteur?.id).toBe(evenements[0]?.actor_id)
})
