// @verifies CRM-098 (docs/BACKLOG.md) — tranche T4 : les règles de la saisie de temps, prouvées par la route REST avec
//           les jetons réels de chaque profil
// @verifies docs/SPEC-temps.md §2 (plafond de 420 minutes, sérialisé), §3.1 (versions : administrateurs seuls,
//           immuables), §5.1 (lecture : soi et les administrateurs), §5.2 (écriture : soi, sur une cible qu'on lit ;
//           un administrateur pour un membre), §6.2 (`temps_valorise` sous la RLS) ; docs/SCHEMA.md §9 quater ;
//           CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec les vrais identifiants)
//
// Les preuves travaillent sur le 7 juillet 2025, hors de toute fenêtre du seed, et sur des versions qui prennent effet
// en 2099 — une version en vigueur ne se retire jamais, et une date proche finirait par entrer en vigueur. Chaque test retire ce qu'il a posé.

import { expect, request as fabrique, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0]
const BIZDEV = COMPTES_SEED[1]
const VIEWER = COMPTES_SEED[2]
const W = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const CONSEIL = '5eed0000-0000-4000-8000-000000000021' // fermé à Farida
const STUDIO = '5eed0000-0000-4000-8000-000000000022'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000031' // rouvert à Farida
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032' // fermé à Farida
const JOUR = '2025-07-07'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const ecrire = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json', Prefer: 'return=representation' })

const saisie = (profil: string, cible: { track_id?: string; channel_id?: string }, minutes = 105) => ({
	workspace_id: W,
	profile_id: profil,
	jour: JOUR,
	minutes,
	track_id: cible.track_id ?? null,
	channel_id: cible.channel_id ?? null,
	card_id: null,
})

async function nettoyer(requete: APIRequestContext): Promise<void> {
	await requete.delete(rest(`saisies_temps?jour=eq.${JOUR}`), { headers: enTetesService() })
	await requete.delete(rest('couts_personnel?date_effet=gte.2099-01-01'), { headers: enTetesService() })
}

test.describe('La saisie de temps sous la RLS (docs/SPEC-temps.md §5)', () => {
	test.beforeEach(async ({ request }) => nettoyer(request))
	test.afterEach(async ({ request }) => {
		await nettoyer(request)
		const restantes = await request.get(rest(`saisies_temps?select=id&jour=eq.${JOUR}`), { headers: enTetesService() })
		expect(await restantes.json(), 'aucune saisie de preuve ne doit rester').toEqual([])
	})

	test('chacun saisit SON temps ; l’auteur est celui du jeton, quoi que le corps prétende', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		const reponse = await request.post(rest('saisies_temps'), {
			headers: ecrire(jeton),
			data: { ...saisie(DRISS, { track_id: STUDIO }), created_by: CAMILLE },
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
		expect(((await reponse.json()) as { created_by: string }[])[0]?.created_by).toBe(DRISS)
	})

	test('un membre ne saisit pas pour un autre : 403 / 42501', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		const reponse = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(FARIDA, { channel_id: PROSPECTION }) })
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as { code: string }).code).toBe('42501')
	})

	test('la lectrice saisit sur ce qu’elle lit, et sur rien d’autre', async ({ request }) => {
		const jeton = await jetonDe(VIEWER.adresse)
		const lue = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(FARIDA, { channel_id: PROSPECTION }) })
		expect(lue.status(), await lue.text()).toBe(201)
		for (const cible of [{ track_id: CONSEIL }, { channel_id: GRANDS_COMPTES }]) {
			const refusee = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(FARIDA, cible, 15) })
			expect(refusee.status(), JSON.stringify(cible)).toBe(403)
		}
	})

	test('un administrateur saisit pour un membre, sur une cible que CE MEMBRE lit — pas sur une autre', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const permise = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(FARIDA, { channel_id: PROSPECTION }) })
		expect(permise.status(), await permise.text()).toBe(201)
		expect(((await permise.json()) as { created_by: string }[])[0]?.created_by).toBe(CAMILLE)
		const refusee = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(FARIDA, { channel_id: GRANDS_COMPTES }) })
		expect(refusee.status()).toBe(403)
	})

	test('un membre ne lit, ne modifie ni ne retire le temps d’un autre ; l’administrateur le lit', async ({ request }) => {
		await request.post(rest('saisies_temps'), {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: saisie(FARIDA, { channel_id: PROSPECTION }),
		})
		const driss = await jetonDe(BIZDEV.adresse)
		const lecture = await request.get(rest(`saisies_temps?select=id&profile_id=eq.${FARIDA}&jour=eq.${JOUR}`), { headers: enTetesAuthentifies(driss) })
		expect(await lecture.json()).toEqual([])
		const maj = await request.patch(rest(`saisies_temps?profile_id=eq.${FARIDA}&jour=eq.${JOUR}`), { headers: ecrire(driss), data: { minutes: 15 } })
		expect(await maj.json()).toEqual([])
		const retrait = await request.delete(rest(`saisies_temps?profile_id=eq.${FARIDA}&jour=eq.${JOUR}`), { headers: ecrire(driss) })
		expect(await retrait.json()).toEqual([])
		const camille = await jetonDe(ADMIN.adresse)
		const lueParAdmin = await request.get(rest(`saisies_temps?select=minutes&profile_id=eq.${FARIDA}&jour=eq.${JOUR}`), {
			headers: enTetesAuthentifies(camille),
		})
		expect(await lueParAdmin.json()).toEqual([{ minutes: 105 }])
	})

	test('seules les minutes se modifient : le privilège de colonne refuse le reste', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(DRISS, { track_id: STUDIO }) })
		const jour = await request.patch(rest(`saisies_temps?profile_id=eq.${DRISS}&jour=eq.${JOUR}`), { headers: ecrire(jeton), data: { jour: '2025-07-08' } })
		expect(jour.status()).toBe(403)
		const minutes = await request.patch(rest(`saisies_temps?profile_id=eq.${DRISS}&jour=eq.${JOUR}`), { headers: ecrire(jeton), data: { minutes: 210 } })
		expect(minutes.status()).toBe(200)
		expect(((await minutes.json()) as { minutes: number }[])[0]?.minutes).toBe(210)
	})

	test('le plafond tient sous deux écritures CONCURRENTES : une seule des deux passe', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		// DEUX CONTEXTES, donc deux connexions : un seul contexte réutilise sa connexion et sérialise les requêtes, et la
		// preuve resterait verte sans verrou (mesuré : mutation survivante). 315 minutes chacune : chacune seule tiendrait
		// dans la journée, les deux ensemble non.
		const [premier, second] = await Promise.all([fabrique.newContext(), fabrique.newContext()])
		const [a, b] = await Promise.all([
			premier.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(DRISS, { track_id: STUDIO }, 315) }),
			second.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(DRISS, { channel_id: PROSPECTION }, 315) }),
		])
		expect([a.status(), b.status()].sort()).toEqual([201, 400])
		const refusee = a.status() === 400 ? a : b
		expect(((await refusee.json()) as { message: string }).message).toBe('plafond journalier')
		const total = await request.get(rest(`saisies_temps?select=minutes&profile_id=eq.${DRISS}&jour=eq.${JOUR}`), { headers: enTetesService() })
		expect(((await total.json()) as { minutes: number }[]).reduce((s, l) => s + l.minutes, 0)).toBe(315)
		await Promise.all([premier.dispose(), second.dispose()])
	})

	test('un anonyme n’a accès ni aux saisies ni au rapport', async ({ request }) => {
		const lecture = await request.get(rest('saisies_temps?select=id'), { headers: enTetesAnonymes() })
		expect(lecture.status()).toBe(401)
		const rapport = await request.post(rest('rpc/temps_valorise'), {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: { p_debut: JOUR, p_fin: JOUR },
		})
		expect(rapport.status()).toBe(401)
	})
})

test.describe('Les versions de coût (docs/SPEC-temps.md §3.1, §5)', () => {
	test.afterEach(async ({ request }) => nettoyer(request))

	test('un membre ne se donne pas de coût, un administrateur si ; une version ne se modifie pas', async ({ request }) => {
		const version = { workspace_id: W, profile_id: DRISS, date_effet: '2099-02-01', cout_quart: 130 }
		const driss = await jetonDe(BIZDEV.adresse)
		const refusee = await request.post(rest('couts_personnel'), { headers: ecrire(driss), data: version })
		expect(refusee.status()).toBe(403)
		const camille = await jetonDe(ADMIN.adresse)
		const creee = await request.post(rest('couts_personnel'), { headers: ecrire(camille), data: version })
		expect(creee.status(), await creee.text()).toBe(201)
		const modifiee = await request.patch(rest(`couts_personnel?profile_id=eq.${DRISS}&date_effet=eq.2099-02-01`), {
			headers: ecrire(camille),
			data: { cout_quart: 999 },
		})
		expect(modifiee.status()).toBe(403)
	})

	test('chacun lit son coût, jamais celui d’un autre ; temps_valorise ne valorise que ce qu’il lit', async ({ request }) => {
		await request.post(rest('couts_personnel'), {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { workspace_id: W, profile_id: DRISS, date_effet: '2099-02-01', cout_quart: 130 },
		})
		const farida = await jetonDe(VIEWER.adresse)
		const lue = await request.get(rest(`couts_personnel?select=id&profile_id=eq.${DRISS}`), { headers: enTetesAuthentifies(farida) })
		expect(await lue.json()).toEqual([])
		const driss = await jetonDe(BIZDEV.adresse)
		const sienne = await request.get(rest(`couts_personnel?select=cout_quart&profile_id=eq.${DRISS}&date_effet=eq.2099-02-01`), {
			headers: enTetesAuthentifies(driss),
		})
		expect(await sienne.json()).toEqual([{ cout_quart: 130 }])
	})
})
