// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.d : le plafond journalier compte tous les espaces de la personne, prouvé
//           par la route REST avec le jeton réel de Camille, administratrice de « P2Enjoy SAS » et de « Studio Lumen » —
//           la saisie du second espace refusée quand la journée est pleine par les deux, permise quand elle reste sous 420 ;
//           deux écritures CONCURRENTES, une par espace : une seule passe (le verrou ne porte plus l'espace) ; le refus garde
//           son message et ne dit ni minutes ni espace
// @verifies docs/SPEC-espace-courant.md §16.9.3 ; docs/SPEC-temps.md §2 ; docs/SCHEMA.md « Migration `0203` » ; décisions 981
//           et 989 ; CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec les vrais identifiants)
//
// Les preuves travaillent sur le 9 juillet 2025, hors de toute fenêtre du seed et du jour de `saisie-temps.spec.ts` ; chaque
// test retire ce qu'il a posé, par la clé de service.

import { expect, request as fabrique, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0]
const P2ENJOY = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const STUDIO = '5eed0000-0000-4000-8000-000000000022'
const JOUR = '2025-07-09'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const ecrire = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json', Prefer: 'return=representation' })

let lumen = ''
let productions = ''

const saisie = (espace: string, track: string, minutes: number) => ({
	workspace_id: espace,
	profile_id: CAMILLE,
	jour: JOUR,
	minutes,
	track_id: track,
	channel_id: null,
	card_id: null,
})

async function nettoyer(requete: APIRequestContext): Promise<void> {
	await requete.delete(rest(`saisies_temps?jour=eq.${JOUR}`), { headers: enTetesService() })
}

test.beforeAll(async ({ request }) => {
	// Les identifiants de « Studio Lumen » ne sont pas figés (décision 972) : lus par le slug, par la clé de service.
	const [espace] = (await (await request.get(rest('workspaces?select=id&slug=eq.studio-lumen'), { headers: enTetesService() })).json()) as { id: string }[]
	expect(espace, 'le seed §54 a son second espace').toBeTruthy()
	lumen = espace!.id
	const [track] = (await (await request.get(rest(`tracks?select=id&workspace_id=eq.${lumen}&slug=eq.productions`), { headers: enTetesService() })).json()) as { id: string }[]
	expect(track, 'le track « Productions » de « Studio Lumen »').toBeTruthy()
	productions = track!.id
})

test.describe('Le plafond journalier compte tous les espaces (docs/SPEC-espace-courant.md §16.9.3)', () => {
	test.beforeEach(async ({ request }) => nettoyer(request))
	test.afterEach(async ({ request }) => {
		await nettoyer(request)
		const restantes = await request.get(rest(`saisies_temps?select=id&jour=eq.${JOUR}`), { headers: enTetesService() })
		expect(await restantes.json(), 'aucune saisie de preuve ne doit rester').toEqual([])
	})

	test('le second espace est refusé quand la journée est pleine par les deux, permis sous 420 ; le refus ne dit ni minutes ni espace', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const premier = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(P2ENJOY, STUDIO, 300) })
		expect(premier.status(), await premier.text()).toBe(201)

		const trop = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(lumen, productions, 135) })
		expect(trop.status()).toBe(400)
		const refus = (await trop.json()) as { code: string; message: string; details: string | null }
		expect(refus.code).toBe('P0001')
		expect(refus.message).toBe('plafond journalier')
		// Décision 989 : ni les minutes déjà saisies, ni l'espace où elles le sont.
		expect(refus.details ?? '').toBe('la journée de cette personne dépasserait 420 minutes')
		expect(JSON.stringify(refus)).not.toMatch(/300|P2Enjoy|studio-lumen|5eed0000/)

		const juste = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(lumen, productions, 120) })
		expect(juste.status(), await juste.text()).toBe(201)
		const total = await request.get(rest(`saisies_temps?select=minutes&profile_id=eq.${CAMILLE}&jour=eq.${JOUR}`), { headers: enTetesService() })
		expect(((await total.json()) as { minutes: number }[]).reduce((s, l) => s + l.minutes, 0)).toBe(420)
	})

	test('deux écritures CONCURRENTES, une par espace : une seule des deux passe — le verrou ne porte plus l’espace', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		// DEUX CONTEXTES, donc deux connexions (voir `saisie-temps.spec.ts`) : 315 minutes chacune, chacune seule tiendrait dans
		// la journée, les deux ensemble non. Avec un verrou par espace, les deux passeraient.
		const [premier, second] = await Promise.all([fabrique.newContext(), fabrique.newContext()])
		const [a, b] = await Promise.all([
			premier.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(P2ENJOY, STUDIO, 315) }),
			second.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(lumen, productions, 315) }),
		])
		expect([a.status(), b.status()].sort()).toEqual([201, 400])
		const refusee = a.status() === 400 ? a : b
		expect(((await refusee.json()) as { message: string }).message).toBe('plafond journalier')
		const total = await request.get(rest(`saisies_temps?select=minutes&profile_id=eq.${CAMILLE}&jour=eq.${JOUR}`), { headers: enTetesService() })
		expect(((await total.json()) as { minutes: number }[]).reduce((s, l) => s + l.minutes, 0)).toBe(315)
		await Promise.all([premier.dispose(), second.dispose()])
	})

	test('augmenter la saisie d’un espace au-delà du total est refusé ; la réduire libère des minutes pour l’autre', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const a = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(P2ENJOY, STUDIO, 210) })
		const b = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: saisie(lumen, productions, 210) })
		expect([a.status(), b.status()]).toEqual([201, 201])
		const augmente = await request.patch(rest(`saisies_temps?profile_id=eq.${CAMILLE}&jour=eq.${JOUR}&workspace_id=eq.${lumen}`), { headers: ecrire(jeton), data: { minutes: 225 } })
		expect(augmente.status()).toBe(400)
		expect(((await augmente.json()) as { message: string }).message).toBe('plafond journalier')
		const reduit = await request.patch(rest(`saisies_temps?profile_id=eq.${CAMILLE}&jour=eq.${JOUR}&workspace_id=eq.${lumen}`), { headers: ecrire(jeton), data: { minutes: 105 } })
		expect(reduit.status(), await reduit.text()).toBe(200)
		const libere = await request.patch(rest(`saisies_temps?profile_id=eq.${CAMILLE}&jour=eq.${JOUR}&workspace_id=eq.${P2ENJOY}`), { headers: ecrire(jeton), data: { minutes: 315 } })
		expect(libere.status(), await libere.text()).toBe(200)
	})
})
