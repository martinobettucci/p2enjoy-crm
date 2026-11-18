// @verifies CRM-153 (docs/BACKLOG.md) — tranche T1 : les catégories d'une organisation et son fil de commentaires, hors
//           interface, avec les jetons réels des trois profils
// @verifies docs/SPEC-organisations.md §9.1 (le catalogue réservé à l'administrateur, l'archivage sans suppression, la pose
//           par le business developer et l'administrateur, le refus d'une catégorie archivée, `p_category_ids`), §9.2 (le
//           fil comme celui d'une affaire : la lectrice lit sans écrire, la modération limitée, la pierre tombale ; les
//           mentions et la notification), §9.5 (les preuves API) ; docs/SPEC-notifications.md §51 ; décisions 932 et 939
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel du profil)
//
// Les écritures sont nommées « E2E 0188 » et retirées par la clé de service après chaque test : le seed ne change pas.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const SOGEXIA = '5eed0000-0000-4000-8000-000000000081'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const PREFIXE = 'E2E 0188'

const PROFILS = {
	admin: 'admin@p2enjoy.test',
	bizdev: 'bizdev@p2enjoy.test',
	viewer: 'viewer@p2enjoy.test',
} as const
type Profil = keyof typeof PROFILS
const jetons: Record<Profil, string> = { admin: '', bizdev: '', viewer: '' }

test.beforeAll(async () => {
	for (const p of Object.keys(PROFILS) as Profil[]) jetons[p] = await jetonDe(PROFILS[p])
})

const commentairesCrees: string[] = []

/** Retire, par la clé de service, tout ce que la preuve a écrit : commentaires (mentions et notifications en cascade),
 *  poses, puis catégories. */
async function nettoyer(request: APIRequestContext) {
	const service = enTetesService()
	// Une pierre tombale a perdu son corps : les commentaires se retrouvent par l'identifiant retenu à leur création.
	const ids = commentairesCrees.splice(0)
	if (ids.length > 0) {
		await request.delete(`${URL_API}/rest/v1/notifications?payload->>comment_id=in.(${ids.join(',')})`, { headers: service })
		await request.delete(`${URL_API}/rest/v1/organization_comments?id=in.(${ids.join(',')})`, { headers: service })
	}
	const c = await request.get(
		`${URL_API}/rest/v1/organization_categories?select=id&name=like.${encodeURIComponent(PREFIXE)}*`, { headers: service })
	const categories = ((await c.json()) as { id: string }[]).map((x) => x.id)
	if (categories.length > 0) {
		await request.delete(`${URL_API}/rest/v1/organization_category_links?category_id=in.(${categories.join(',')})`,
			{ headers: service })
		await request.delete(`${URL_API}/rest/v1/organization_categories?id=in.(${categories.join(',')})`, { headers: service })
	}
}

test.afterEach(async ({ request }) => nettoyer(request))

function enTetes(profil: Profil, retour = true): Record<string, string> {
	return {
		...enTetesAuthentifies(jetons[profil]),
		'Content-Type': 'application/json',
		...(retour ? { Prefer: 'return=representation' } : {}),
	}
}

/** Le premier élément d'une réponse, ou un échec qui le dit : une liste vide n'est jamais lue comme `undefined`. */
function premier<T>(liste: readonly T[]): T {
	const tete = liste[0]
	if (tete === undefined) throw new Error('réponse vide : une ligne était attendue')
	return tete
}

async function vertigo(request: APIRequestContext): Promise<string> {
	const r = await request.get(`${URL_API}/rest/v1/organizations?select=id&name=eq.Vertigo%20Conseil`,
		{ headers: enTetesAuthentifies(jetons.admin) })
	return premier((await r.json()) as { id: string }[]).id
}

async function creerCategorie(request: APIRequestContext, nom: string, profil: Profil = 'admin') {
	return request.post(`${URL_API}/rest/v1/organization_categories`, {
		headers: enTetes(profil), data: { workspace_id: ESPACE, name: nom, color: 'brand' },
	})
}

async function poser(request: APIRequestContext, profil: Profil, organisation: string, categorie: string) {
	return request.post(`${URL_API}/rest/v1/organization_category_links`, {
		headers: enTetes(profil), data: { organization_id: organisation, category_id: categorie },
	})
}

async function commenter(request: APIRequestContext, profil: Profil, organisation: string, corps: string) {
	const r = await request.post(`${URL_API}/rest/v1/organization_comments`, {
		headers: enTetes(profil), data: { organization_id: organisation, body: `${PREFIXE} ${corps}` },
	})
	if (r.status() === 201) commentairesCrees.push(...((await r.json()) as { id: string }[]).map((c) => c.id))
	return r
}

test('le catalogue : l\'administratrice crée et archive ; le business developer et la lectrice ne le touchent pas', async ({ request }) => {
	const cree = await creerCategorie(request, `${PREFIXE} Partenaire`)
	expect(cree.status()).toBe(201)
	const categorie = premier((await cree.json()) as { id: string; created_by: string }[])
	expect(categorie.created_by).toBe(CAMILLE)

	expect((await creerCategorie(request, `${PREFIXE} partenaire`)).status(), 'unique sans casse').toBe(409)
	for (const profil of ['bizdev', 'viewer'] as const) {
		expect((await creerCategorie(request, `${PREFIXE} ${profil}`, profil)).status(), profil).toBe(403)
		const maj = await request.patch(`${URL_API}/rest/v1/organization_categories?id=eq.${categorie.id}`, {
			headers: enTetes(profil), data: { name: `${PREFIXE} renommée` },
		})
		expect((await maj.json()) as unknown[], `${profil} ne renomme pas`).toHaveLength(0)
		const lu = await request.get(`${URL_API}/rest/v1/organization_categories?id=eq.${categorie.id}`,
			{ headers: enTetesAuthentifies(jetons[profil]) })
		expect((await lu.json()) as unknown[], `${profil} lit le catalogue`).toHaveLength(1)
	}
	const anonyme = await request.get(`${URL_API}/rest/v1/organization_categories?select=id`, { headers: enTetesAnonymes() })
	expect([200, 401]).toContain(anonyme.status())
	if (anonyme.status() === 200) expect((await anonyme.json()) as unknown[]).toHaveLength(0)

	const archive = await request.patch(`${URL_API}/rest/v1/organization_categories?id=eq.${categorie.id}`, {
		headers: enTetes('admin'), data: { archived_at: '2000-01-01T00:00:00Z' },
	})
	const archivee = premier((await archive.json()) as { archived_at: string }[])
	expect(new Date(archivee.archived_at).getFullYear(), 'l\'heure d\'archivage est celle de la base').toBeGreaterThan(2000)
	const supprime = await request.delete(`${URL_API}/rest/v1/organization_categories?id=eq.${categorie.id}`,
		{ headers: enTetes('admin') })
	expect(supprime.status(), 'aucune suppression physique').toBe(403)
})

test('la pose : le business developer pose et retire, la lectrice non ; une archivée ne se pose plus mais filtre', async ({ request }) => {
	const organisation = await vertigo(request)
	const active = premier((await (await creerCategorie(request, `${PREFIXE} Active`)).json()) as { id: string }[])
	const ancienne = premier((await (await creerCategorie(request, `${PREFIXE} Ancienne`)).json()) as { id: string }[])

	expect((await poser(request, 'viewer', organisation, active.id)).status(), 'la lectrice ne pose pas').toBe(403)
	expect((await poser(request, 'bizdev', organisation, active.id)).status()).toBe(201)
	expect((await poser(request, 'admin', SOGEXIA, ancienne.id)).status()).toBe(201)
	await request.patch(`${URL_API}/rest/v1/organization_categories?id=eq.${ancienne.id}`, {
		headers: enTetes('admin'), data: { archived_at: new Date().toISOString() },
	})
	const refus = await poser(request, 'bizdev', organisation, ancienne.id)
	expect(refus.status()).toBe(400)
	expect(((await refus.json()) as { message: string }).message).toBe('category_archived')

	// Le filtre de la liste, archivées comprises, pour les trois profils ; un appel nommé sans le paramètre garde son sens.
	for (const profil of Object.keys(PROFILS) as Profil[]) {
		const r = await request.post(`${URL_API}/rest/v1/rpc/organization_list`, {
			headers: enTetes(profil, false),
			data: { p_workspace_id: ESPACE, p_limit: 100, p_category_ids: [active.id, ancienne.id] },
		})
		expect(r.status(), profil).toBe(200)
		expect(((await r.json()) as { name: string }[]).map((o) => o.name).sort(), profil).toEqual(['Sogexia', 'Vertigo Conseil'])
		const sans = await request.post(`${URL_API}/rest/v1/rpc/organization_list`, {
			headers: enTetes(profil, false), data: { p_workspace_id: ESPACE, p_limit: 1 },
		})
		expect(sans.status(), `${profil} sans p_category_ids`).toBe(200)
	}

	const parLectrice = await request.delete(
		`${URL_API}/rest/v1/organization_category_links?organization_id=eq.${SOGEXIA}&category_id=eq.${ancienne.id}`,
		{ headers: enTetes('viewer') })
	expect((await parLectrice.json()) as unknown[], 'la lectrice ne retire pas').toHaveLength(0)
	const retire = await request.delete(
		`${URL_API}/rest/v1/organization_category_links?organization_id=eq.${SOGEXIA}&category_id=eq.${ancienne.id}`,
		{ headers: enTetes('bizdev') })
	expect((await retire.json()) as unknown[], 'une archivée se retire').toHaveLength(1)
})

test('le fil : commenter, mentionner, notifier ; la lectrice lit sans écrire ; la modération ne fait que supprimer', async ({ request }) => {
	const organisation = await vertigo(request)

	expect((await commenter(request, 'viewer', organisation, 'par la lectrice')).status()).toBe(403)
	const signe = await request.post(`${URL_API}/rest/v1/organization_comments`, {
		headers: enTetes('bizdev'), data: { organization_id: organisation, author_id: CAMILLE, body: `${PREFIXE} signé` },
	})
	expect(signe.status(), 'personne ne signe pour un autre').toBe(403)

	const r = await commenter(request, 'bizdev', organisation, 'Point avec la direction')
	expect(r.status()).toBe(201)
	const commentaire = premier((await r.json()) as { id: string; author_id: string; workspace_id: string }[])
	expect([commentaire.author_id, commentaire.workspace_id]).toEqual([DRISS, ESPACE])

	const mention = await request.post(`${URL_API}/rest/v1/organization_comment_mentions`, {
		headers: enTetes('bizdev'), data: [{ comment_id: commentaire.id, profile_id: FARIDA }, { comment_id: commentaire.id, profile_id: DRISS }],
	})
	expect(mention.status()).toBe(201)
	const parAdmin = await request.post(`${URL_API}/rest/v1/organization_comment_mentions`, {
		headers: enTetes('admin'), data: { comment_id: commentaire.id, profile_id: CAMILLE },
	})
	expect(parAdmin.status(), 'seul l\'auteur pose ses mentions').toBe(403)

	// La notification de la lectrice : sujet l'organisation, lue et marquée par elle seule ; l'auteur n'en reçoit aucune.
	const boite = async (profil: Profil) => (await (await request.get(
		`${URL_API}/rest/v1/notifications?select=id,type,subject_card_id,subject_organization_id,payload&payload->>comment_id=eq.${commentaire.id}`,
		{ headers: enTetesAuthentifies(jetons[profil]) })).json()) as {
		id: string; type: string; subject_card_id: string | null; subject_organization_id: string; payload: { author_id: string }
	}[]
	const notification = premier(await boite('viewer'))
	expect(notification).toMatchObject({ type: 'mention', subject_card_id: null, subject_organization_id: organisation,
		payload: { author_id: DRISS } })
	expect(await boite('bizdev'), 'l\'auteur qui se mentionne n\'est pas notifié').toHaveLength(0)
	const marque = await request.patch(`${URL_API}/rest/v1/notifications?id=eq.${notification.id}`, {
		headers: enTetes('viewer'), data: { read_at: new Date().toISOString() },
	})
	expect((await marque.json()) as unknown[]).toHaveLength(1)

	const lu = await request.get(`${URL_API}/rest/v1/organization_comments?id=eq.${commentaire.id}`,
		{ headers: enTetesAuthentifies(jetons.viewer) })
	expect((await lu.json()) as unknown[], 'la lectrice lit le fil').toHaveLength(1)

	const reecrit = await request.patch(`${URL_API}/rest/v1/organization_comments?id=eq.${commentaire.id}`, {
		headers: enTetes('admin'), data: { body: `${PREFIXE} réécrit` },
	})
	expect(reecrit.status()).toBe(400)
	expect(((await reecrit.json()) as { message: string }).message).toBe('comment_moderation_limitee')
	const modere = await request.patch(`${URL_API}/rest/v1/organization_comments?id=eq.${commentaire.id}`, {
		headers: enTetes('admin'), data: { deleted_at: new Date().toISOString() },
	})
	const tombe = premier((await modere.json()) as { body: string; deleted_by: string }[])
	expect(tombe).toMatchObject({ body: '', deleted_by: CAMILLE })
	const apres = await request.patch(`${URL_API}/rest/v1/organization_comments?id=eq.${commentaire.id}`, {
		headers: enTetes('bizdev'), data: { body: `${PREFIXE} ressuscité` },
	})
	expect(((await apres.json()) as { message: string }).message).toBe('comment_deleted')
})
