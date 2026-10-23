// @verifies CRM-067 (docs/BACKLOG.md) — tranche T1 : les activités d'une affaire par la route REST, avec les jetons
//           réels des profils du seed
// @verifies docs/SPEC-activites.md §2 (date jamais future), §3 (politiques d'un commentaire, modération bornée au
//           retrait, pierre tombale, participants pris dans l'affaire) ; CLAUDE.md §10 (le refus prouvé par une requête
//           directe, hors interface)
//
// La suite pgTAP `0091` prouve la base ; ce fichier prouve ce que PostgREST en rend à chaque profil. Chaque scénario
// retire, par la clé de service, ce qu'il a créé : le seed n'en garde rien.

import { expect, test } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const [ADMIN, BIZDEV, VIEWER] = COMPTES_SEED
const ACTIVITES = `${URL_API}/rest/v1/card_activities`
const PARTICIPANTS = `${URL_API}/rest/v1/card_activity_participants`
const PROSPECTION = '5eed0000-0000-4000-8000-0000000000ca' // « Cadrage data », channel rouvert en écriture à la lectrice
const REFONTE = '5eed0000-0000-4000-8000-0000000000c4' // contact …092 lié ; lecture seule pour la lectrice
const MAINTENANCE = '5eed0000-0000-4000-8000-00000000d005' // restreint en lecture pour le business developer
const CONTACT_LIE = '5eed0000-0000-4000-8000-000000000092'
const CONTACT_ETRANGER = '5eed0000-0000-4000-8000-000000000091'
const PREFIXE = 'API CRM-067'

type Activite = { id: string; subject: string; body: string | null; author_id: string; deleted_at: string | null; edited_at: string | null }

async function entetes(adresse: string) {
	return { ...enTetesAuthentifies(await jetonDe(adresse)), 'Content-Type': 'application/json', Prefer: 'return=representation' }
}

test.afterEach(async ({ request }) => {
	await request.delete(`${ACTIVITES}?subject=like.${encodeURIComponent(PREFIXE)}*`, { headers: enTetesService() })
	await request.delete(`${ACTIVITES}?deleted_at=not.is.null&card_id=in.(${PROSPECTION},${REFONTE})`, { headers: enTetesService() })
})

test.describe('les activités d’une affaire (docs/SPEC-activites.md §3)', () => {
	test('la lectrice consigne là où elle écrit, et pas ailleurs ; une date future est refusée', async ({ request }) => {
		const h = await entetes(VIEWER.adresse)
		const ok = await request.post(ACTIVITES, {
			headers: h,
			data: { card_id: PROSPECTION, type: 'call', occurred_at: new Date(Date.now() - 3600_000).toISOString(), subject: `${PREFIXE} appel` },
		})
		expect(ok.status(), await ok.text()).toBe(201)
		const [cree] = (await ok.json()) as Activite[]
		expect(cree?.author_id).toBe('5eed0000-0000-4000-8000-000000000013')

		const refus = await request.post(ACTIVITES, {
			headers: h,
			data: { card_id: REFONTE, type: 'call', occurred_at: new Date().toISOString(), subject: `${PREFIXE} refusé` },
		})
		expect(refus.status(), await refus.text()).toBe(403)

		const futur = await request.post(ACTIVITES, {
			headers: h,
			data: { card_id: PROSPECTION, type: 'visio', occurred_at: new Date(Date.now() + 86_400_000).toISOString(), subject: `${PREFIXE} futur` },
		})
		expect(futur.status()).toBe(400)
		expect(((await futur.json()) as { message: string }).message).toBe('activity_in_future')
	})

	test('le business developer est refusé sur « Maintenance », restreint en lecture', async ({ request }) => {
		const refus = await request.post(ACTIVITES, {
			headers: await entetes(BIZDEV.adresse),
			data: { card_id: MAINTENANCE, type: 'meeting', occurred_at: new Date().toISOString(), subject: `${PREFIXE} maintenance` },
		})
		expect(refus.status(), await refus.text()).toBe(403)
	})

	test('l’auteur corrige ; un non-auteur ne corrige rien ; l’administratrice retire sans réécrire ; la pierre tombale reste', async ({ request }) => {
		const bizdev = await entetes(BIZDEV.adresse)
		const creation = await request.post(ACTIVITES, {
			headers: bizdev,
			data: { card_id: REFONTE, type: 'meeting', occurred_at: new Date().toISOString(), duration_minutes: 45, subject: `${PREFIXE} cadrage` },
		})
		expect(creation.status(), await creation.text()).toBe(201)
		const [activite] = (await creation.json()) as Activite[]
		const cible = `${ACTIVITES}?id=eq.${activite?.id}`

		const correction = await request.patch(cible, { headers: bizdev, data: { body: 'Compte rendu' } })
		expect(((await correction.json()) as Activite[])[0]?.edited_at).not.toBeNull()

		const tiers = await request.patch(cible, { headers: await entetes(VIEWER.adresse), data: { subject: 'Réécrit' } })
		expect(await tiers.json()).toEqual([])

		const admin = await entetes(ADMIN.adresse)
		const reecriture = await request.patch(cible, { headers: admin, data: { subject: 'Modéré' } })
		expect(((await reecriture.json()) as { message: string }).message).toBe('activity_moderation_limited')
		const retrait = await request.patch(cible, { headers: admin, data: { deleted_at: new Date().toISOString() } })
		const [tombe] = (await retrait.json()) as Activite[]
		expect(tombe).toMatchObject({ subject: '', body: null })
		expect(tombe?.deleted_at).not.toBeNull()

		const suppression = await request.delete(cible, { headers: bizdev })
		expect(suppression.status()).toBe(403)
	})

	test('un participant doit être un contact lié à l’affaire ou un membre de l’espace', async ({ request }) => {
		const bizdev = await entetes(BIZDEV.adresse)
		const creation = await request.post(ACTIVITES, {
			headers: bizdev,
			data: { card_id: REFONTE, type: 'visio', occurred_at: new Date().toISOString(), subject: `${PREFIXE} démo` },
		})
		const [activite] = (await creation.json()) as Activite[]
		const lie = await request.post(PARTICIPANTS, { headers: bizdev, data: { activity_id: activite?.id, contact_id: CONTACT_LIE } })
		expect(lie.status(), await lie.text()).toBe(201)
		const membre = await request.post(PARTICIPANTS, {
			headers: bizdev,
			data: { activity_id: activite?.id, profile_id: '5eed0000-0000-4000-8000-000000000011' },
		})
		expect(membre.status(), await membre.text()).toBe(201)
		const etranger = await request.post(PARTICIPANTS, { headers: bizdev, data: { activity_id: activite?.id, contact_id: CONTACT_ETRANGER } })
		expect(etranger.status()).toBe(400)
		expect(((await etranger.json()) as { message: string }).message).toBe('participant_outside_card')
	})
})
