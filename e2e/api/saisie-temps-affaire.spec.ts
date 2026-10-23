// @verifies CRM-106 (docs/BACKLOG.md) — tranche T3 : la saisie sur une affaire, prouvée par la route REST avec les
//           jetons réels — le chemin exact qu'emprunte la bande de la fiche
// @verifies docs/SPEC-temps.md §7.6 (2 : une valeur remplace, zéro retire ; 3 : son temps seulement ; 10 : aucune règle
//           nouvelle — `app.saisie_temps_permise` exige que la personne lise l'affaire), §5.2, §3.2 ; décision 630 ;
//           CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec les vrais identifiants)
//
// Les preuves travaillent sur le 14 juillet 2025, hors de toute fenêtre du seed et des autres preuves du temps, et
// retirent ce qu'elles ont posé.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const BIZDEV = COMPTES_SEED[1]
const VIEWER = COMPTES_SEED[2]
const W = '5eed0000-0000-4000-8000-000000000001'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const MGEN = '5eed0000-0000-4000-8000-0000000000cc' // Studio web › Refonte de site
const NORDIS = '5eed0000-0000-4000-8000-0000000000cb' // Conseil & IA › Prospection, rouvert à Farida
const VITRINE = '5eed0000-0000-4000-8000-0000000000c1' // Conseil & IA › Grands comptes, fermé à Farida
const JOUR = '2025-07-14'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const ecrire = (jeton: string) => ({ ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json', Prefer: 'return=representation' })
const surAffaire = (profil: string, carte: string, minutes = 105) => ({
	workspace_id: W,
	profile_id: profil,
	jour: JOUR,
	minutes,
	track_id: null,
	channel_id: null,
	card_id: carte,
})

async function nettoyer(requete: APIRequestContext): Promise<void> {
	await requete.delete(rest(`saisies_temps?jour=eq.${JOUR}`), { headers: enTetesService() })
}

test.describe('La saisie sur une affaire sous la RLS (docs/SPEC-temps.md §7.6)', () => {
	test.beforeEach(async ({ request }) => nettoyer(request))
	test.afterEach(async ({ request }) => {
		await nettoyer(request)
		const restantes = await request.get(rest(`saisies_temps?select=id&jour=eq.${JOUR}`), { headers: enTetesService() })
		expect(await restantes.json(), 'aucune saisie de preuve ne doit rester').toEqual([])
	})

	test('un membre qui lit l’affaire y saisit, remplace sa valeur, puis la retire', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		const creee = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: surAffaire(DRISS, MGEN) })
		expect(creee.status(), await creee.text()).toBe(201)
		const [ligne] = (await creee.json()) as { id: string; card_id: string; created_by: string }[]
		expect(ligne?.card_id).toBe(MGEN)
		expect(ligne?.created_by).toBe(DRISS)

		// La cellule EST la ligne : une seconde insertion pour le même jour et la même affaire est refusée (§3.2) …
		const doublon = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: surAffaire(DRISS, MGEN, 210) })
		expect(doublon.status()).toBe(409)
		// … et c'est la mise à jour des minutes qui remplace (§7.6, point 2).
		const remplacee = await request.patch(rest(`saisies_temps?id=eq.${ligne?.id}`), { headers: ecrire(jeton), data: { minutes: 315 } })
		expect(remplacee.status(), await remplacee.text()).toBe(200)
		expect(((await remplacee.json()) as { minutes: number }[])[0]?.minutes).toBe(315)

		const retiree = await request.delete(rest(`saisies_temps?id=eq.${ligne?.id}`), { headers: ecrire(jeton) })
		expect(retiree.status(), await retiree.text()).toBe(200)
		expect(await retiree.json()).toHaveLength(1)
	})

	test('la lectrice saisit sur l’affaire qu’elle lit, et est refusée sur celle qu’elle ne lit pas', async ({ request }) => {
		const jeton = await jetonDe(VIEWER.adresse)
		const lue = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: surAffaire(FARIDA, NORDIS) })
		expect(lue.status(), await lue.text()).toBe(201)

		const refusee = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: surAffaire(FARIDA, VITRINE, 15) })
		expect(refusee.status()).toBe(403)
		expect(((await refusee.json()) as { code: string }).code).toBe('42501')
		const posees = await request.get(rest(`saisies_temps?select=card_id&jour=eq.${JOUR}&profile_id=eq.${FARIDA}`), { headers: enTetesService() })
		expect(await posees.json(), 'seule l’affaire lue porte du temps').toEqual([{ card_id: NORDIS }])
	})

	test('un membre ne saisit pas sur une affaire pour un collègue', async ({ request }) => {
		const jeton = await jetonDe(BIZDEV.adresse)
		const reponse = await request.post(rest('saisies_temps'), { headers: ecrire(jeton), data: surAffaire(FARIDA, NORDIS) })
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as { code: string }).code).toBe('42501')
	})
})
