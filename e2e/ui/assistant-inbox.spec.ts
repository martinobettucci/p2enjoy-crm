// @verifies CRM-166 (docs/BACKLOG.md) — tranche T2 : l'assistant de l'inbox sur la vraie pile — la bulle, la demande, le plan lu fil par fil, accepter
//           et refuser (l'effet relu en base), « Tout accepter » qui laisse l'action irréversible à valider, la confirmation de suppression, le blocage de
//           l'expéditeur, l'annulation d'une demande lente, l'état sans IA, le clavier, et les quatre paliers
// @verifies docs/DESIGN_SYSTEM.md §5.116 ; docs/SPEC-mail-subsystem.md §36.1 à §36.9 ; docs/SPEC-ia.md §17.6, §17.8, §17.9 ; docs/JOURNAL.md décisions 994
//           et 997 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LE SERVEUR LLM N'EST JAMAIS APPELÉ (docs/SPEC-ia.md §8) : l'en-tête `x-ia-simulateur` choisit le scénario du simulateur local, qui calcule le plan
// DE LA DEMANDE écrite (« lu », « sommeil », « supprime partout », « bloque »…). Les mails sont PROPRES À LA PREUVE, non classés, dans la boîte de
// Camille (l'administratrice), posés par la clé de service et retirés à la fin par préfixe ; les expéditeurs bloqués par la preuve sont débloqués.

import { type APIRequestContext, type Page } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-166'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const suffixe = Date.now().toString(36)
const PREFIXE = `<tst-crm166-ui-${suffixe}`
const NEUTRE = `sonde-neutre-${suffixe}@sonde.test`
const BLOQUE = `sonde-bloque-${suffixe}@sonde.test`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 1000 } })

const mails: string[] = []
let scenario = 'inbox'

async function poserMail(request: APIRequestContext, boite: string, rang: number, expediteur: string): Promise<string> {
	const reponse = await request.post(rest('mail_messages?select=id'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `${PREFIXE}-${rang}@sonde.test>`,
			classification: 'unclassified',
			from_address: expediteur,
			to_addresses: ['admin@p2enjoy.test'],
			subject: `ZZ 166 ${rang} ${suffixe}`,
			body_text: 'Preuve de l’assistant de l’inbox.',
			direction: 'inbound',
			received_at: new Date(Date.now() - rang * 60_000).toISOString(),
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const id = ((await reponse.json()) as { id: string }[])[0]!.id
	const occurrence = await request.post(rest('mail_message_occurrences'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { message_id: id, account_id: boite, folder: 'INBOX', uid: 166_500 + rang + (Date.now() % 1000) },
	})
	expect(occurrence.status(), await occurrence.text()).toBe(201)
	return id
}

test.beforeAll(async ({ request }) => {
	const [boite] = (await (
		await request.get(rest(`mail_inbound_accounts?select=id&owner_id=eq.${CAMILLE}&limit=1`), { headers: enTetesService() })
	).json()) as { id: string }[]
	// 0 et 1 : accepter l'un, refuser l'autre ; 2 et 3 : « Tout accepter » puis une suppression confirmée ; 4 et 5 : l'expéditeur à bloquer ;
	// 6 : la demande lente et le clavier ; 7 : les paliers.
	for (let rang = 0; rang < 8; rang += 1) mails.push(await poserMail(request, boite!.id, rang, rang === 4 || rang === 5 ? BLOQUE : NEUTRE))
})

test.afterAll(async ({ request }) => {
	const service = { headers: enTetesService() }
	await request.delete(rest(`mail_blocked_senders?workspace_id=eq.${ESPACE}&address=eq.${encodeURIComponent(BLOQUE)}`), service)
	await request.delete(rest(`mail_messages?rfc822_message_id=like.${encodeURIComponent(`${PREFIXE}*`)}`), service)
})

test.beforeEach(async ({ page }) => {
	scenario = 'inbox'
	// L'en-tête qui choisit le scénario du simulateur — instrumentation du seul développement (docs/SPEC-ia.md §11.6).
	await page.route('**/functions/v1/ia/**', async (route) => {
		await route.continue({ headers: { ...route.request().headers(), 'x-ia-simulateur': scenario } })
	})
})

const liste = (page: Page) => page.getByTestId('inbox-panneau-liste')
const ligne = (page: Page, rang: number) =>
	liste(page).locator('li').filter({ has: page.getByTestId('inbox-message').filter({ hasText: `ZZ 166 ${rang} ${suffixe}` }) })
const caseDe = (page: Page, rang: number) => ligne(page, rang).getByTestId('inbox-case-fil')
const ligneDePlan = (page: Page, rang: number) => page.getByTestId('assistant-fil').filter({ hasText: `ZZ 166 ${rang} ${suffixe}` })
const panneau = (page: Page) => page.getByTestId('assistant-panneau')

async function enBase(request: APIRequestContext, chemin: string): Promise<{ id: string }[]> {
	const reponse = await request.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as { id: string }[]
}
const lues = (request: APIRequestContext, ids: readonly string[]) =>
	enBase(request, `mail_message_reads?user_id=eq.${CAMILLE}&message_id=in.(${ids.join(',')})&select=id:message_id`)

async function ouvrirLInbox(page: Page, rang = 7) {
	await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	await page.goto(`/p2enjoy/inbox?courrier=tous&message=${mails[rang]}`)
	await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
	// Sous 1024 px, l'inbox est une pile : on remonte du message à la liste.
	const retour = page.getByRole('button', { name: 'Retour aux messages' })
	if (await retour.isVisible()) await retour.click()
	await expect(ligne(page, rang)).toBeVisible()
}

async function demander(page: Page, texte: string) {
	await page.getByTestId('assistant-demande').fill(texte)
	await page.getByTestId('assistant-envoyer').click()
}

test.describe('la bulle et le plan (docs/DESIGN_SYSTEM.md §5.116)', () => {
	test('à la souris : la bulle sans sélection, puis deux fils cochés, la demande, le plan ; accepter l’un, refuser l’autre', async ({ page, request }) => {
		await ouvrirLInbox(page)
		const bulle = page.getByTestId('assistant-bulle')
		await expect(bulle).toBeVisible()
		await expect(bulle).toHaveAttribute('aria-label', 'Assistant IA')
		await capturer(page, 'bulle-fermee-1440', UNITE)

		// Sans fil coché : le motif est dit, le champ est éteint (jamais masqué).
		await bulle.click()
		await expect(page.getByTestId('assistant-sans-selection')).toContainText('Cochez des mails')
		await expect(page.getByTestId('assistant-demande')).toBeDisabled()
		await capturer(page, 'panneau-sans-selection-1440', UNITE)

		// Le panneau ne bloque pas la page : on coche derrière lui.
		await caseDe(page, 0).check()
		await caseDe(page, 1).check()
		await expect(page.getByTestId('assistant-selection')).toHaveText('2 fils choisis')
		await expect(page.getByTestId('assistant-demande')).toBeEnabled()
		await page.getByTestId('assistant-demande').fill('Marque lu et mets en sommeil')
		await capturer(page, 'panneau-pret-1440', UNITE)
		await page.getByTestId('assistant-envoyer').click()

		await expect(page.getByTestId('assistant-fil')).toHaveCount(2)
		await expect(ligneDePlan(page, 0).getByTestId('assistant-action')).toHaveCount(2)
		await expect(ligneDePlan(page, 0)).toContainText('Marquer comme lu')
		await expect(ligneDePlan(page, 0)).toContainText('Mettre en sommeil')
		// La pastille et le fil que le modèle invente sont rejetés et comptés, jamais rendus.
		await expect(page.getByTestId('assistant-ecarts')).toContainText('2 actions ignorées')
		await capturer(page, 'plan-arrive-1440', UNITE)

		await ligneDePlan(page, 0).getByTestId('assistant-accepter').click()
		await expect(ligneDePlan(page, 0).getByTestId('assistant-etat')).toContainText('Appliqué (2 actions)')
		await expect.poll(async () => (await lues(request, [mails[0]!])).length).toBe(1)
		// Le plan ne se réordonne pas : la ligne appliquée garde sa place.
		await expect(page.getByTestId('assistant-fil').first()).toContainText(`ZZ 166 0 ${suffixe}`)
		await capturer(page, 'plan-fil-applique-1440', UNITE)

		await ligneDePlan(page, 1).getByTestId('assistant-refuser').click()
		await expect(ligneDePlan(page, 1).getByTestId('assistant-etat')).toContainText('Refusé')
		expect((await lues(request, [mails[1]!])).length).toBe(0)
	})

	test('« Tout accepter » : la confirmation dit les nombres, l’action irréversible reste à valider, puis sa confirmation applique la suppression', async ({
		page,
		request,
	}) => {
		await ouvrirLInbox(page)
		await caseDe(page, 2).check()
		await caseDe(page, 3).check()
		await page.getByTestId('assistant-bulle').click()
		await demander(page, 'Marque lu et supprime partout')
		await expect(page.getByTestId('assistant-fil')).toHaveCount(2)
		await expect(ligneDePlan(page, 2)).toContainText('irréversible')

		await page.getByTestId('assistant-tout-accepter').click()
		const confirmation = page.getByTestId('assistant-tout-confirmation')
		await expect(confirmation).toContainText('2 actions seront appliquées sur 2 mails')
		await expect(confirmation).toContainText('2 actions irréversibles restent à valider une à une')
		await capturer(page, 'tout-accepter-confirmation-1440', UNITE)
		await page.getByTestId('assistant-tout-appliquer').click()
		await expect(ligneDePlan(page, 2)).toHaveAttribute('data-etat', 'partiel')
		await expect(ligneDePlan(page, 3)).toHaveAttribute('data-etat', 'partiel')
		await expect.poll(async () => (await lues(request, [mails[2]!, mails[3]!])).length).toBe(2)
		// Rien n'est supprimé : l'action irréversible reste proposée.
		expect((await enBase(request, `mail_messages?id=in.(${mails[2]},${mails[3]})&deleted_at=not.is.null&select=id`)).length).toBe(0)

		await ligneDePlan(page, 2).getByTestId('assistant-accepter').click()
		const suppression = ligneDePlan(page, 2).getByTestId('assistant-confirmation')
		await expect(suppression).toContainText('partout')
		await capturer(page, 'confirmation-suppression-1440', UNITE)
		await suppression.getByTestId('assistant-confirmer').click()
		await expect(ligneDePlan(page, 2)).toHaveAttribute('data-etat', 'applique')
		await expect.poll(async () => (await enBase(request, `mail_messages?id=eq.${mails[2]}&deleted_at=not.is.null&select=id`)).length).toBe(1)
		expect((await enBase(request, `mail_messages?id=eq.${mails[3]}&deleted_at=not.is.null&select=id`)).length).toBe(0)

		// Décliner la confirmation d'un autre fil le laisse partiel.
		await ligneDePlan(page, 3).getByTestId('assistant-accepter').click()
		await ligneDePlan(page, 3).getByTestId('assistant-confirmation').getByRole('button', { name: 'Annuler' }).click()
		await expect(ligneDePlan(page, 3)).toHaveAttribute('data-etat', 'partiel')
		expect((await enBase(request, `mail_messages?id=eq.${mails[3]}&deleted_at=not.is.null&select=id`)).length).toBe(0)
	})

	test('le blocage de l’expéditeur : le nombre de messages, la seconde confirmation, puis le blocage lu en base', async ({ page, request }) => {
		await ouvrirLInbox(page, 4)
		await caseDe(page, 4).check()
		await page.getByTestId('assistant-bulle').click()
		await demander(page, 'Bloque')
		await expect(page.getByTestId('assistant-fil')).toHaveCount(1)
		await ligneDePlan(page, 4).getByTestId('assistant-accepter').click()
		await expect(page.getByTestId('assistant-blocage-impact')).toContainText('2')
		await capturer(page, 'confirmation-blocage-1440', UNITE)
		await page.getByTestId('assistant-blocage-continuer').click()
		await page.getByTestId('assistant-confirmer').click()
		await expect(ligneDePlan(page, 4)).toHaveAttribute('data-etat', 'applique')
		expect(
			(await enBase(request, `mail_blocked_senders?workspace_id=eq.${ESPACE}&address=eq.${encodeURIComponent(BLOQUE)}&select=id:address`)).length,
		).toBe(1)
	})

	test('une demande lente s’annule ; le plan lu avant reste lisible ; l’état sans IA est dit', async ({ page }) => {
		scenario = 'inbox_lent'
		await ouvrirLInbox(page, 6)
		await caseDe(page, 6).check()
		await page.getByTestId('assistant-bulle').click()
		await demander(page, 'Marque lu')
		await expect(page.getByTestId('assistant-progression')).toContainText('Lot 1 sur 1')
		await expect(page.getByTestId('assistant-bulle')).toHaveAttribute('aria-label', 'Assistant IA, demande en cours')
		await capturer(page, 'demande-en-cours-1440', UNITE)
		await page.getByTestId('assistant-annuler').click()
		await expect(page.getByTestId('assistant-progression')).toHaveCount(0)
		await expect(page.getByTestId('assistant-fil')).toHaveCount(0)
		await expect(page.getByTestId('assistant-envoyer')).toBeEnabled()
	})

	test('sans IA : la raison est dite, sans champ ni bouton', async ({ page }) => {
		await page.route('**/functions/v1/ia/etat', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ disponible: false, raison: 'serveur_injoignable', modele: 'x' }) }),
		)
		await ouvrirLInbox(page)
		await page.getByTestId('assistant-bulle').click()
		await expect(page.getByTestId('assistant-etat-indisponible')).toContainText('son serveur ne répond pas')
		await expect(page.getByTestId('assistant-demande')).toHaveCount(0)
		await expect(page.getByTestId('assistant-envoyer')).toHaveCount(0)
		await capturer(page, 'panneau-sans-ia-1440', UNITE)
	})

	test('au clavier : la bulle, Entrée, le champ, Ctrl+Entrée, Tab jusqu’à « Accepter », Entrée ; Échap rend le focus à la bulle', async ({ page }) => {
		await ouvrirLInbox(page, 6)
		await caseDe(page, 6).check()
		const bulle = page.getByTestId('assistant-bulle')
		await bulle.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('assistant-demande')).toBeFocused()
		await page.keyboard.type('Marque lu')
		await page.keyboard.press('Control+Enter')
		await expect(ligneDePlan(page, 6)).toBeVisible()
		const accepter = ligneDePlan(page, 6).getByTestId('assistant-accepter')
		for (let essai = 0; essai < 12 && !(await accepter.evaluate((el) => el === document.activeElement)); essai += 1) await page.keyboard.press('Tab')
		await expect(accepter).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(ligneDePlan(page, 6)).toHaveAttribute('data-etat', 'applique')
		// Le focus n'est pas perdu quand le bouton quitte la ligne.
		await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).not.toBe('BODY')
		await page.keyboard.press('Escape')
		await expect(panneau(page)).toHaveCount(0)
		await expect(bulle).toBeFocused()
	})
})

test.describe('les quatre paliers (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`le panneau et son plan ne débordent pas — ${palier.nom}`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await ouvrirLInbox(page, 7)
			await caseDe(page, 7).check()
			await page.getByTestId('assistant-bulle').click()
			await demander(page, 'Marque lu et supprime partout')
			await expect(ligneDePlan(page, 7)).toBeVisible()
			await capturer(page, `assistant-plan-${palier.nom}`, UNITE)
			const mesures = await page.evaluate(() => {
				const p = document.querySelector('[data-testid="assistant-panneau"]')!.getBoundingClientRect()
				return { page: document.documentElement.scrollWidth - window.innerWidth, droite: p.right - window.innerWidth, gauche: p.left, haut: p.top }
			})
			expect(mesures.page).toBeLessThanOrEqual(0)
			expect(mesures.droite).toBeLessThanOrEqual(0)
			expect(mesures.gauche).toBeGreaterThanOrEqual(0)
			expect(mesures.haut).toBeGreaterThanOrEqual(0)
		})
	}
})
