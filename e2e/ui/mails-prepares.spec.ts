// @verifies CRM-128 (docs/BACKLOG.md) — tranche T4 : l'entrée « Mails préparés » de l'inbox, la liste, la relecture dans
//           le formulaire d'envoi prérempli, la mise en file du contenu RELU (constatée en base), « Écarter » et sa
//           confirmation, l'adresse `/inbox?brouillon=<id>`, l'encadré de la fiche, la personne seule
// @verifies docs/SPEC-mails-prepares.md §3.4, §3.5, §6 ; docs/DESIGN_SYSTEM.md §5.90 ; décision 829 ; CLAUDE.md §15, §16
// @verifies CRM-143 (docs/BACKLOG.md) — tranche T4 : la relecture précharge les pièces du mail préparé ; une pièce retirée
//           n'est pas effacée du stockage, et la file ne porte que celles qui restent (docs/SPEC-pieces-jointes.md §17.6,
//           §17.9 ; docs/DESIGN_SYSTEM.md §5.95)
//
// LES MAILS PRÉPARÉS SONT POSÉS PAR LA VRAIE FONCTION, `prepare_email`, sous le jeton de session de l'administratrice
// (origine `web`) ; la préparation par le connecteur est prouvée par l'intégration de T3. Chaque scénario retire ce qu'il
// a posé : ses mails préparés et les envois que la relecture a mis en file.
// @verifies CRM-139 (docs/BACKLOG.md) — l'inbox s'ouvre ici case « Seulement moi » décochée, `courrier=tous` : le sujet de ces
//           preuves est ailleurs (docs/SPEC-mail-subsystem.md §27.5)

import { connecterAvecLeLabs, expect, test } from './fixtures'
import { capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-128'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const AFFAIRE = '5eed0000-0000-4000-8000-0000000000c1'
const CHEMIN_AFFAIRE = '/tracks/conseil-ia/grands-comptes/cards/' + AFFAIRE
const MARQUE = 'E2E CRM-128'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

/** La première ligne d'une lecture, qui doit exister : l'absence fait échouer la preuve en le disant. */
function premiere<T>(lignes: readonly T[]): T {
	const ligne = lignes[0]
	if (ligne === undefined) throw new Error('aucune ligne lue')
	return ligne
}

test.use({ viewport: { width: 1440, height: 900 } })

async function preparer(
	request: import('@playwright/test').APIRequestContext,
	objet: string,
	extra: Record<string, unknown> = {},
): Promise<string> {
	const reponse = await request.post(rest('rpc/prepare_email'), {
		headers: enTetesAuthentifies(await jetonDe(ADMIN)),
		data: {
			p_card_id: AFFAIRE,
			p_to: ['client@exterieur.test'],
			p_subject: objet,
			p_body_text: `${MARQUE} — corps préparé.`,
			...extra,
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as string
}

test.afterEach(async ({ request }) => {
	await request.delete(rest(`mail_outbox?body_text=like.${encodeURIComponent(MARQUE)}*`), { headers: enTetesService() })
	await request.delete(rest(`mail_drafts?body_text=like.${encodeURIComponent(MARQUE)}*`), { headers: enTetesService() })
})

test('l’entrée « Mails préparés » mène à la relecture, et le contenu RELU part en file', async ({ page, request }) => {
	const id = await preparer(request, 'Proposition à relire', { p_cc: ['copie@exterieur.test'] })
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/inbox?courrier=tous')
	const entree = page.getByTestId('inbox-mails-prepares')
	await expect(entree).toBeVisible()
	await expect(entree).toHaveAccessibleName(/Mails préparés : \d+ en attente de relecture/)
	await entree.click()
	const ligne = page.locator(`[data-testid="inbox-mail-prepare"][data-mail="${id}"]`)
	await expect(ligne).toContainText('Proposition à relire')
	await expect(ligne).toContainText('Préparé dans le CRM')
	await ligne.click()
	const relecture = page.getByTestId('inbox-relecture')
	await expect(relecture.getByRole('note')).toContainText('Ce mail n’est pas envoyé.')
	await expect(relecture.getByLabel('Copie', { exact: true })).toHaveValue('copie@exterieur.test')
	await expect(relecture.getByLabel('Objet')).toHaveValue('Proposition à relire')
	await capturer(page, 'inbox-relecture-xl-1440', UNITE)

	await relecture.getByLabel('Message').fill(`${MARQUE} — corps relu par la personne.`)
	await relecture.getByTestId('envoi-valider').click()
	await expect(page.getByTestId(`inbox-mail-prepare`).filter({ hasText: 'Proposition à relire' })).toHaveCount(0)

	// CONSTATÉ EN BASE : le mail préparé est envoyé, et la file porte le corps RELU, pas le corps préparé.
	const brouillon = await request.get(rest(`mail_drafts?id=eq.${id}&select=status,outbox_id`), { headers: enTetesService() })
	const etat = premiere((await brouillon.json()) as { status: string; outbox_id: string }[])
	expect(etat.status).toBe('sent')
	const file = await request.get(rest(`mail_outbox?id=eq.${etat.outbox_id}&select=body_text,cc_addrs,card_id`), {
		headers: enTetesService(),
	})
	const envoi = premiere((await file.json()) as { body_text: string; cc_addrs: string[]; card_id: string }[])
	expect(envoi.body_text).toContain('corps relu par la personne')
	expect(envoi.cc_addrs).toEqual(['copie@exterieur.test'])
	expect(envoi.card_id).toBe(AFFAIRE)
})

test('« Écarter » confirme dans le flux, au clavier, et le mail ne part jamais', async ({ page, request }) => {
	const id = await preparer(request, 'À écarter')
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/inbox?brouillon=${id}`)
	// L'ADRESSE EST UNE DESTINATION : elle ouvre la relecture, puis se retire.
	await expect(page.getByTestId('inbox-relecture').getByLabel('Objet')).toHaveValue('À écarter')
	await expect(page).not.toHaveURL(/brouillon=/)
	await page.getByTestId('mail-prepare-ecarter').focus()
	await page.keyboard.press('Enter')
	await expect(page.getByTestId('mail-prepare-ecarter-confirmer')).toBeFocused()
	await capturer(page, 'inbox-ecarter-confirmation-xl-1440', UNITE)
	await page.keyboard.press('Enter')
	await expect(page.getByTestId('inbox-relecture')).toHaveCount(0)
	const brouillon = await request.get(rest(`mail_drafts?id=eq.${id}&select=status`), { headers: enTetesService() })
	expect(premiere((await brouillon.json()) as { status: string }[]).status).toBe('discarded')
	const file = await request.get(rest(`mail_outbox?body_text=like.${encodeURIComponent(MARQUE)}*&select=id`), {
		headers: enTetesService(),
	})
	expect(await file.json()).toEqual([])
})

test('l’adresse d’un mail qui n’est plus en attente, ou d’autrui, dit la même phrase', async ({ page, request }) => {
	const id = await preparer(request, 'Écarté avant le clic')
	const ecart = await request.post(rest('rpc/discard_email_draft'), {
		headers: enTetesAuthentifies(await jetonDe(ADMIN)),
		data: { p_draft_id: id },
	})
	expect(ecart.status()).toBe(204)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/inbox?brouillon=${id}`)
	await expect(page.getByTestId('inbox-relecture-plus-en-attente')).toContainText('n’est plus en attente')

	// Driss ne voit pas le mail préparé de Camille : la même phrase, et aucune entrée.
	const autre = await preparer(request, 'Le mail de Camille')
	await page.context().clearCookies()
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto(`/inbox?brouillon=${autre}`)
	await expect(page.getByTestId('inbox-relecture-plus-en-attente')).toBeVisible()
	await expect(page.getByTestId('inbox-mails-prepares')).toHaveCount(0)
})

test('la fiche de l’affaire porte l’encadré, et son lien ouvre la relecture', async ({ page, request }) => {
	await preparer(request, 'Depuis la fiche')
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(CHEMIN_AFFAIRE)
	const encadre = page.getByTestId('fiche-mail-prepare').filter({ hasText: 'Depuis la fiche' })
	await expect(encadre).toContainText('Mail préparé, à relire')
	await encadre.scrollIntoViewIfNeeded()
	await capturer(page, 'fiche-mail-prepare-xl-1440', UNITE)
	await encadre.getByRole('link', { name: /Relire et envoyer/ }).click()
	await expect(page.getByTestId('inbox-relecture').getByLabel('Objet')).toHaveValue('Depuis la fiche')
})

test('aux paliers de 900 et 1100 px, la relecture tient sans défilement horizontal', async ({ page, request }) => {
	const id = await preparer(request, 'Paliers intermédiaires')
	await connecterAvecLeLabs(page, ADMIN)
	for (const largeur of [900, 1100]) {
		await page.setViewportSize({ width: largeur, height: 900 })
		await page.goto(`/inbox?brouillon=${id}`)
		await expect(page.getByTestId('inbox-relecture')).toBeVisible()
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(largeur)
		await capturer(page, `inbox-relecture-${largeur === 900 ? 'md' : 'lg'}-${largeur}`, UNITE)
	}
})

test('à 390 px, la pile mène de l’entrée à la relecture sans défilement horizontal', async ({ page, request }) => {
	await preparer(request, 'Sur mobile')
	await page.setViewportSize({ width: 390, height: 844 })
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/inbox?courrier=tous')
	await page.getByTestId('inbox-mails-prepares').click()
	await page.getByTestId('inbox-mail-prepare').filter({ hasText: 'Sur mobile' }).click()
	const relecture = page.getByTestId('inbox-relecture')
	await expect(relecture).toBeVisible()
	const largeur = await page.evaluate(() => document.documentElement.scrollWidth)
	expect(largeur).toBeLessThanOrEqual(390)
	await capturer(page, 'inbox-relecture-sm-390', UNITE)
})

// `CRM-143` T4 : les pièces d'un mail préparé, déposées par la personne sous son jeton comme le connecteur le fait, puis
// citées par `prepare_email`, sont préchargées dans la relecture (docs/SPEC-pieces-jointes.md §17.6).
test('la relecture précharge les pièces du mail préparé ; en retirer une ne l’efface pas, et la file porte les autres', async ({
	page,
	request,
}) => {
	const jeton = await jetonDe(ADMIN)
	const [profil] = (await (
		await request.get(rest(`profiles?select=id&email=eq.${encodeURIComponent(ADMIN)}`), { headers: enTetesService() })
	).json()) as { id: string }[]
	expect(profil, 'le profil de l’administratrice').toBeDefined()
	const chemins = ['devis.pdf', 'annexe.txt'].map(
		(nom) => `5eed0000-0000-4000-8000-000000000001/${profil!.id}/${crypto.randomUUID()}/${nom}`,
	)
	try {
		for (const chemin of chemins) {
			const depot = await request.post(`${URL_API}/storage/v1/object/mail-outbound-attachments/${chemin}`, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/octet-stream' },
				data: Buffer.from(`${MARQUE} ${chemin}`),
			})
			expect([200, 201], await depot.text()).toContain(depot.status())
		}
		const id = await preparer(request, 'Proposition avec pièces', { p_attachments: chemins })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/inbox?brouillon=${id}`)
		const relecture = page.getByTestId('inbox-relecture')
		const pieces = relecture.getByTestId('envoi-piece')
		await expect(pieces).toHaveCount(2)
		await expect(pieces.filter({ hasText: 'devis.pdf' })).toHaveAttribute('data-etat', 'pret')
		await capturer(page, 'relecture-pieces-xl-1440', 'CRM-143')

		await relecture.getByRole('button', { name: 'Retirer annexe.txt' }).click()
		await expect(pieces).toHaveCount(1)
		// RETIRÉE DU FORMULAIRE, PAS DU STOCKAGE : le mail préparé la cite encore tant qu'il n'est pas envoyé.
		const encore = await request.get(`${URL_API}/storage/v1/object/mail-outbound-attachments/${chemins[1]}`, {
			headers: enTetesService(),
		})
		expect(encore.status()).toBe(200)

		await relecture.getByTestId('envoi-valider').click()
		await expect(page.getByTestId('inbox-mail-prepare').filter({ hasText: 'Proposition avec pièces' })).toHaveCount(0)
		const brouillon = await request.get(rest(`mail_drafts?id=eq.${id}&select=status,outbox_id`), { headers: enTetesService() })
		const { status, outbox_id } = premiere((await brouillon.json()) as { status: string; outbox_id: string }[])
		expect(status).toBe('sent')
		const file = await request.get(rest(`mail_outbox?id=eq.${outbox_id}&select=attachments`), { headers: enTetesService() })
		const { attachments } = premiere((await file.json()) as { attachments: { path: string }[] }[])
		expect(attachments.map((piece) => piece.path)).toEqual([chemins[0]])
	} finally {
		await request.delete(`${URL_API}/storage/v1/object/mail-outbound-attachments`, {
			headers: enTetesService(),
			data: { prefixes: chemins },
		})
	}
})
