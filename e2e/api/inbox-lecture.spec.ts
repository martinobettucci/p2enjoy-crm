// @verifies CRM-057 (docs/BACKLOG.md) — tranche 2 : lu / non lu, contrat d'API hors interface
// @verifies docs/SPEC-mail-subsystem.md §18 bis.2 (l'état est personnel, le total gardé), §18 bis.3 (la table fermée à
//           l'écriture directe, `mark_messages_read` et sa discrétion, `mark_message_unread`, `is_read`, `unread_count`) ;
//           docs/SPEC-permissions-rls.md §7 ; CLAUDE.md §10 ; docs/JOURNAL.md décisions 715 et 716
//
// TOUT SE MESURE HORS INTERFACE, avec les vrais jetons de deux profils obtenus par la route de connexion : Camille
// (admin), qui voit les quatre messages du seed, et Driss (business developer), qui ne voit que les deux classés.
//
// L'ÉTAT DE DÉPART EST POSÉ, PUIS RENDU : les lectures des deux profils sur les messages du seed sont relevées par la clé
// de service avant la série et réécrites telles quelles après. Les tests ne dépendent donc ni de ce que le seed a lu
// (docs/SPEC-seed.md §2.19), ni de ce qu'une session d'écran a ouvert entre-temps.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const MSGID = {
	classe: '<seed-inbox-classe@p2enjoy.test>',
	reponse: '<seed-inbox-reponse@p2enjoy.test>',
	nonClasse: '<seed-inbox-non-classe@p2enjoy.test>',
} as const

type Lecture = { message_id: string; user_id: string; read_at: string }

const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

async function identifiants(request: APIRequestContext): Promise<Record<keyof typeof MSGID, string>> {
	const sortie = {} as Record<keyof typeof MSGID, string>
	for (const [nom, msgid] of Object.entries(MSGID) as [keyof typeof MSGID, string][]) {
		const reponse = await request.get(
			`${URL_API}/rest/v1/mail_messages?select=id&rfc822_message_id=eq.${encodeURIComponent(msgid)}`,
			{ headers: enTetesService() },
		)
		expect(reponse.status(), await reponse.text()).toBe(200)
		const [ligne] = (await reponse.json()) as { id: string }[]
		expect(ligne, `le message ${msgid} du seed existe`).toBeDefined()
		sortie[nom] = ligne!.id
	}
	return sortie
}

async function estLu(request: APIRequestContext, entetes: Record<string, string>, id: string): Promise<boolean | null> {
	const reponse = await request.get(`${URL_API}/rest/v1/mail_messages?select=is_read&id=eq.${id}`, { headers: entetes })
	expect(reponse.status(), await reponse.text()).toBe(200)
	const [ligne] = (await reponse.json()) as { is_read: boolean }[]
	return ligne === undefined ? null : ligne.is_read
}

async function marquer(request: APIRequestContext, entetes: Record<string, string>, ids: readonly string[]) {
	return request.post(`${URL_API}/rest/v1/rpc/mark_messages_read`, {
		headers: json(entetes),
		data: { p_message_ids: ids },
	})
}

test.describe.serial('lu / non lu — hors interface (§18 bis)', () => {
	let ids: Record<keyof typeof MSGID, string>
	let avant: Lecture[] = []
	let admin: Record<string, string>
	let driss: Record<string, string>
	const filtre = () =>
		`user_id=in.(${ADMIN},${DRISS})&message_id=in.(${Object.values(ids).join(',')})`

	test.beforeAll(async ({ request }) => {
		ids = await identifiants(request)
		admin = enTetesAuthentifies(await jetonDe('admin@p2enjoy.test'))
		driss = enTetesAuthentifies(await jetonDe('bizdev@p2enjoy.test'))
		const releve = await request.get(`${URL_API}/rest/v1/mail_message_reads?select=*&${filtre()}`, {
			headers: enTetesService(),
		})
		expect(releve.status(), await releve.text()).toBe(200)
		avant = (await releve.json()) as Lecture[]
		const vidage = await request.delete(`${URL_API}/rest/v1/mail_message_reads?${filtre()}`, { headers: enTetesService() })
		expect(vidage.status(), await vidage.text()).toBe(204)
	})

	test.afterAll(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/mail_message_reads?${filtre()}`, { headers: enTetesService() })
		if (avant.length > 0) {
			const remise = await request.post(`${URL_API}/rest/v1/mail_message_reads`, {
				headers: json(enTetesService()),
				data: avant,
			})
			expect(remise.status(), await remise.text()).toBe(201)
		}
	})

	test('TÉMOIN : au départ, les messages du seed sont non lus pour les deux profils, et Driss voit le classé', async ({ request }) => {
		expect(await estLu(request, admin, ids.classe)).toBe(false)
		expect(await estLu(request, admin, ids.nonClasse)).toBe(false)
		// Sans ce témoin, le « false » de Driss plus bas serait vrai aussi d'un message qu'il ne voit pas.
		expect(await estLu(request, driss, ids.classe)).toBe(false)
	})

	test('Camille marque lu le fil : deux messages, et SON état seul change', async ({ request }) => {
		const reponse = await marquer(request, admin, [ids.classe, ids.reponse])
		expect(reponse.status(), await reponse.text()).toBe(200)
		expect(await reponse.json()).toBe(2)
		expect(await estLu(request, admin, ids.classe)).toBe(true)
		expect(await estLu(request, admin, ids.reponse)).toBe(true)
		// L'ÉTAT EST PERSONNEL (§18 bis.2 point 1) : ce que Camille a lu reste non lu pour Driss.
		expect(await estLu(request, driss, ids.classe)).toBe(false)
	})

	test('le compte des non lus suit l’appelant, et le total reste (décision 716)', async ({ request }) => {
		type Ligne = { card_id: string | null; nombre: number; unread_count: number }
		const lire = async (entetes: Record<string, string>) => {
			const reponse = await request.post(`${URL_API}/rest/v1/rpc/inbox_arborescence`, { headers: json(entetes), data: {} })
			expect(reponse.status(), await reponse.text()).toBe(200)
			return ((await reponse.json()) as Ligne[]).filter((ligne) => ligne.card_id !== null)
		}
		const deCamille = await lire(admin)
		const deDriss = await lire(driss)
		const somme = (lignes: Ligne[], cle: 'nombre' | 'unread_count') => lignes.reduce((s, l) => s + Number(l[cle]), 0)
		expect(somme(deCamille, 'nombre')).toBe(somme(deDriss, 'nombre'))
		expect(somme(deCamille, 'unread_count')).toBe(somme(deDriss, 'unread_count') - 2)
	})

	test('Driss ne lit AUCUNE lecture de Camille', async ({ request }) => {
		const reponse = await request.get(`${URL_API}/rest/v1/mail_message_reads?select=user_id`, { headers: driss })
		expect(reponse.status(), await reponse.text()).toBe(200)
		const lignes = (await reponse.json()) as { user_id: string }[]
		expect(lignes.filter((ligne) => ligne.user_id !== DRISS)).toEqual([])
	})

	test('Driss ne marque pas un message qu’il ne voit pas : zéro, sans erreur, et rien en base', async ({ request }) => {
		const reponse = await marquer(request, driss, [ids.nonClasse])
		expect(reponse.status(), await reponse.text()).toBe(200)
		expect(await reponse.json()).toBe(0)
		const constat = await request.get(
			`${URL_API}/rest/v1/mail_message_reads?select=user_id&user_id=eq.${DRISS}&message_id=eq.${ids.nonClasse}`,
			{ headers: enTetesService() },
		)
		expect((await constat.json()) as unknown[]).toEqual([])
	})

	test('l’insertion directe dans la table est REFUSÉE, même pour soi', async ({ request }) => {
		const reponse = await request.post(`${URL_API}/rest/v1/mail_message_reads`, {
			headers: json(driss),
			data: { message_id: ids.classe, user_id: DRISS },
		})
		expect([401, 403]).toContain(reponse.status())
		expect(((await reponse.json()) as { code?: string }).code).toBe('42501')
	})

	test('remettre non lu rend vrai une fois, puis faux', async ({ request }) => {
		const appel = () =>
			request.post(`${URL_API}/rest/v1/rpc/mark_message_unread`, {
				headers: json(admin),
				data: { p_message_id: ids.reponse },
			})
		const premier = await appel()
		expect(premier.status(), await premier.text()).toBe(200)
		expect(await premier.json()).toBe(true)
		expect(await estLu(request, admin, ids.reponse)).toBe(false)
		expect(await (await appel()).json()).toBe(false)
	})

	test('plus de 200 identifiants : refus nommé', async ({ request }) => {
		const trop = Array.from({ length: 201 }, () => crypto.randomUUID())
		const reponse = await marquer(request, admin, trop)
		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect([corps.code, corps.message]).toEqual(['22023', 'too_many_messages'])
	})

	test('l’anonyme ne peut ni marquer, ni lire les lectures', async ({ request }) => {
		const marque = await marquer(request, enTetesAnonymes(), [ids.classe])
		expect([401, 403, 404]).toContain(marque.status())
		const lecture = await request.get(`${URL_API}/rest/v1/mail_message_reads?select=user_id`, {
			headers: enTetesAnonymes(),
		})
		expect([401, 403]).toContain(lecture.status())
	})
})
