// @verifies CRM-157 (docs/BACKLOG.md) — tranche T1 : sans domaine d'adresses d'affaire, l'envoi et la mise en file d'un
//           mail préparé sont refusés par leur nom, `workspace_reply_domain_missing`, sous les vrais jetons de Camille,
//           dans un espace jetable ; rien n'est écrit dans la file ; le mail préparé reste en attente
// @verifies docs/SPEC-mail-subsystem.md §33.2, §33.6, §33.7 (preuve d'API) ; CLAUDE.md §10, §15
//
// L'armement d'une relance et le job sont prouvés par pgTAP (`supabase/tests/0179_domaine_absent_envoi.test.sql`) : armer
// exige une affaire figée depuis des jours, ce qu'un espace monté à la seconde n'a pas.

import { expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'
import { CAMILLE, ESPACE_SANS_DOMAINE, demonterEspaceSansDomaine, monterEspaceSansDomaine, type MontageSansDomaine } from './espace-sans-domaine'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.describe.configure({ mode: 'serial' })

let montage: MontageSansDomaine | null = null

test.beforeAll(async ({ request }) => {
	montage = await monterEspaceSansDomaine(request)
})
test.afterAll(async ({ request }) => {
	await demonterEspaceSansDomaine(request)
})

test('l’envoi est refusé par le nom du domaine absent, et rien n’entre dans la file', async ({ request }) => {
	if (montage === null) throw new Error('montage absent')
	const camille = { ...enTetesAuthentifies(await jetonDe(CAMILLE.adresse)), 'Content-Type': 'application/json' }
	const envoi = await request.post(rest('rpc/queue_outbound_email'), {
		headers: camille,
		data: {
			p_card_id: montage.idAffaire,
			p_identity_id: montage.idIdentite,
			p_to: ['client@exterieur.test'],
			p_subject: 'Proposition',
			p_body_text: 'Bonjour, voici notre proposition.',
		},
	})
	expect(envoi.status(), await envoi.text()).toBe(400)
	const corps = (await envoi.json()) as { code: string; message: string }
	expect(corps).toMatchObject({ code: '23514', message: 'workspace_reply_domain_missing' })

	const file = await request.get(rest(`mail_outbox?workspace_id=eq.${ESPACE_SANS_DOMAINE.id}&select=id`), {
		headers: enTetesService(),
	})
	expect(await file.json(), 'aucune ligne dans la file d’envoi').toEqual([])
})

test('la mise en file d’un mail préparé porte le même refus, et le mail reste en attente', async ({ request }) => {
	if (montage === null) throw new Error('montage absent')
	const camille = { ...enTetesAuthentifies(await jetonDe(CAMILLE.adresse)), 'Content-Type': 'application/json' }
	const prepare = await request.post(rest('rpc/prepare_email'), {
		headers: camille,
		data: { p_card_id: montage.idAffaire, p_to: ['client@exterieur.test'], p_body_text: 'Préparé pour la preuve.' },
	})
	expect(prepare.status(), await prepare.text()).toBe(200)
	const idBrouillon = (await prepare.json()) as string

	const envoi = await request.post(rest('rpc/send_email_draft'), {
		headers: camille,
		data: {
			p_draft_id: idBrouillon,
			p_identity_id: montage.idIdentite,
			p_to: ['client@exterieur.test'],
			p_body_text: 'Préparé pour la preuve, relu.',
		},
	})
	expect(envoi.status(), await envoi.text()).toBe(400)
	expect(await envoi.json()).toMatchObject({ code: '23514', message: 'workspace_reply_domain_missing' })

	const brouillon = await request.get(rest(`mail_drafts?id=eq.${idBrouillon}&select=status`), { headers: enTetesService() })
	expect(await brouillon.json()).toEqual([{ status: 'pending' }])
})
