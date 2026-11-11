// @verifies CRM-141 (docs/BACKLOG.md) — tranche T4 : les pastilles dans l'inbox sur la vraie pile — les pilules d'une ligne
//           de fil, le filtre « Pastille » porté par l'adresse et son état vide, le message ouvert (pastilles et origine,
//           état d'évaluation, « Réévaluer les pastilles », le panneau « Pastilles » et ses cases), à la souris et au
//           clavier, la lectrice refusée, et les quatre paliers
// @verifies docs/SPEC-mail-subsystem.md §31.4, §31.7 ; docs/DESIGN_SYSTEM.md §5.103, §5.102, §5.59 ; docs/SPEC-seed.md §46
//           (la correction à la main, Newsletter archivée et portée, Candidature spontanée en échec) ; CLAUDE.md §10, §16
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les gestes écrivent sur des MAILS PROPRES À LA PREUVE, posés par la clé de service et retirés à la fin. Les messages du
// seed ne sont que lus.

import { type APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, consommerTraceCadreIsole, expect, test } from './fixtures'

const UNITE = 'CRM-141'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
// « Formation Data & IA », que la lectrice lit.
const CARD_C7 = '5eed0000-0000-4000-8000-0000000000c7'
const MSGID_CORRIGE = '<seed-inbox-classe@p2enjoy.test>'
const MSGID_ECHEC = '<seed-inbox-non-classe@p2enjoy.test>'
const suffixe = Date.now().toString(36)
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

const crees: string[] = []

async function poserMail(request: APIRequestContext, objet: string, card = CARD_C1): Promise<string> {
	const reponse = await request.post(rest('mail_messages'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `<tst-crm141-ui-${suffixe}-${crees.length}@sonde.test>`,
			card_id: card,
			classification: 'manual',
			from_address: 'contact@sonde.test',
			subject: objet,
			body_text: 'Bonjour, une question sur votre offre.',
			direction: 'inbound',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const id = ((await reponse.json()) as { id: string }[])[0]!.id
	crees.push(id)
	return id
}

async function idDe(request: APIRequestContext, filtre: string): Promise<string> {
	const reponse = await request.get(rest(`mail_messages?select=id&${filtre}`), { headers: enTetesService() })
	const [ligne] = (await reponse.json()) as { id: string }[]
	expect(ligne?.id, `le seed porte ${filtre}`).toBeTruthy()
	return ligne?.id ?? ''
}

async function pastille(request: APIRequestContext, nom: string): Promise<string> {
	const reponse = await request.get(rest(`mail_labels?workspace_id=eq.${ESPACE}&name=eq.${encodeURIComponent(nom)}&select=id`), {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterAll(async ({ request }) => {
	for (const id of crees) await request.delete(rest(`mail_messages?id=eq.${id}`), { headers: enTetesService() })
})

test.describe('les pastilles dans l’inbox (docs/DESIGN_SYSTEM.md §5.103)', () => {
	test('la correction du seed : la ligne et le message ouvert disent les pastilles et leur origine', async ({ page, request }) => {
		const corrige = await idDe(request, `rfc822_message_id=eq.${encodeURIComponent(MSGID_CORRIGE)}`)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${corrige}`)
		const ouvert = page.getByTestId('inbox-message-ouvert')
		await expect(ouvert.getByRole('heading', { name: 'Demande de devis — refonte' })).toBeVisible()
		const ligne = ouvert.getByTestId('inbox-pastilles-message')
		// La main a posé Lead et retiré Devis / commande (docs/SPEC-seed.md §46) : seule Lead est posée.
		await expect(ligne.getByRole('img', { name: 'Lead, posée à la main' })).toBeVisible()
		await expect(ligne.getByText('Devis / commande')).toHaveCount(0)
		// La ligne du fil porte les pastilles de son dernier message.
		const liste = page.getByTestId('inbox-panneau-liste')
		await expect(liste.getByTestId('inbox-pastilles-ligne').first()).toBeVisible()

		const commande = ouvert.getByTestId('inbox-pastilles')
		await commande.click()
		const panneau = page.getByTestId('inbox-panneau-pastilles')
		await expect(panneau.getByTestId('inbox-case-pastille').filter({ hasText: 'Devis / commande' })).toContainText(
			'retirée à la main',
		)
		await expect(panneau.getByRole('checkbox', { name: /Lead/ })).toBeChecked()
		await capturer(page, 'pastilles-inbox-message-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(panneau).toHaveCount(0)
		await expect(commande).toBeFocused()
	})

	test('à la souris : poser une pastille, la base la signe à la main ; la confirmation d’« Effacer » et le panneau s’excluent', async ({
		page,
		request,
	}) => {
		const message = await poserMail(request, `ZZ 141 souris ${suffixe}`)
		const spam = await pastille(request, 'Spam')
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${message}`)
		const ouvert = page.getByTestId('inbox-message-ouvert')
		await ouvert.getByTestId('inbox-pastilles').click()
		const panneau = page.getByTestId('inbox-panneau-pastilles')
		await panneau.getByRole('checkbox', { name: /Spam/ }).click()
		await expect(panneau.getByRole('checkbox', { name: /Spam/ })).toBeChecked()
		await expect(page.getByText('Pastille « Spam » posée.')).toBeAttached()
		await expect(ouvert.getByTestId('inbox-pastilles-message').getByRole('img', { name: 'Spam, posée à la main' })).toBeVisible()
		const reponse = await request.get(rest(`mail_message_labels?message_id=eq.${message}&label_id=eq.${spam}&select=source,applied`), {
			headers: enTetesService(),
		})
		expect(await reponse.json()).toEqual([{ source: 'manual', applied: true }])

		await ouvert.getByTestId('inbox-effacer').click()
		await expect(panneau).toHaveCount(0)
		await ouvert.getByTestId('inbox-pastilles').click()
		await expect(page.getByRole('group', { name: 'Effacer ce message' })).toHaveCount(0)
		await expect(panneau).toBeVisible()
	})

	test('au clavier : « Réévaluer les pastilles », puis « Pastilles », Espace sur une case, Échap', async ({ page, request }) => {
		const message = await poserMail(request, `ZZ 141 clavier ${suffixe}`)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${message}`)
		const ouvert = page.getByTestId('inbox-message-ouvert')
		await ouvert.getByTestId('inbox-reevaluer-pastilles').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByText('Réévaluation demandée.')).toBeAttached()
		const etat = await request.get(rest(`mail_label_evaluations?message_id=eq.${message}&select=priority`), {
			headers: enTetesService(),
		})
		expect(await etat.json()).toEqual([{ priority: 0 }])

		const commande = ouvert.getByTestId('inbox-pastilles')
		await commande.focus()
		await page.keyboard.press('Enter')
		const premiere = page.getByTestId('inbox-panneau-pastilles').getByRole('checkbox').first()
		await expect(premiere).toBeFocused()
		await page.keyboard.press('Space')
		await expect(premiere).toBeChecked()
		await expect(page.getByText(/Pastille « .+ » posée\./)).toBeAttached()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('inbox-panneau-pastilles')).toHaveCount(0)
		await expect(commande).toBeFocused()
	})

	test('le filtre « Pastille » : l’adresse le porte, une archivée sans mail dans le dossier rend le vide qui l’efface', async ({
		page,
		request,
	}) => {
		const corrige = await idDe(request, `rfc822_message_id=eq.${encodeURIComponent(MSGID_CORRIGE)}`)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${corrige}`)
		const liste = page.getByTestId('inbox-panneau-liste')
		const filtre = liste.getByLabel('Pastille')
		await filtre.selectOption({ label: 'Devis / commande' })
		await expect(page).toHaveURL(/pastille=/)
		const lignes = liste.getByTestId('inbox-message')
		await expect(lignes.first()).toBeVisible()
		for (const ligne of await lignes.all()) await expect(ligne.getByTestId('inbox-pastilles-ligne')).toBeVisible()
		await capturer(page, 'pastilles-inbox-filtre-1440', UNITE)

		await filtre.selectOption({ label: 'Newsletter (archivée)' })
		await expect(liste.getByText('Aucun message ne porte la pastille « Newsletter » dans ce dossier.')).toBeVisible()
		await capturer(page, 'pastilles-inbox-filtre-vide-1440', UNITE)
		await liste.getByTestId('inbox-filtre-pastille-toutes').click()
		await expect(page).not.toHaveURL(/pastille=/)
		await expect(lignes.first()).toBeVisible()
	})

	test('le seed : l’échec d’évaluation dit en mots, et une archivée reste sur le mail qui la porte', async ({ page, request }) => {
		const echec = await idDe(request, `rfc822_message_id=eq.${encodeURIComponent(MSGID_ECHEC)}`)
		const invitation = await idDe(request, `subject=like.${encodeURIComponent('Invitation — journée partenaires*')}`)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${echec}`)
		const ouvert = page.getByTestId('inbox-message-ouvert')
		await expect(ouvert.getByTestId('inbox-pastilles-etat')).toHaveText("Les pastilles n'ont pas pu être évaluées")
		await capturer(page, 'pastilles-inbox-echec-1440', UNITE)
		await page.goto(`/inbox?courrier=tous&message=${invitation}`)
		await expect(
			ouvert.getByTestId('inbox-pastilles-message').getByRole('img', { name: 'Newsletter, pastille archivée, posée à la main' }),
		).toBeVisible()
		// Le corps HTML de l'invitation est servi dans le cadre isolé ; la trace de Playwright y fait naître ce message (CRM-140).
		consommerTraceCadreIsole(page)
	})

	test('la lectrice : « Réévaluer » éteinte, le panneau s’ouvre avec le motif, ses cases éteintes', async ({ page, request }) => {
		const message = await poserMail(request, `ZZ 141 lectrice ${suffixe}`, CARD_C7)
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto(`/inbox?courrier=tous&message=${message}`)
		const ouvert = page.getByTestId('inbox-message-ouvert')
		await expect(ouvert.getByTestId('inbox-reevaluer-pastilles')).toBeDisabled()
		await ouvert.getByTestId('inbox-pastilles').click()
		const panneau = page.getByTestId('inbox-panneau-pastilles')
		await expect(panneau.getByTestId('motif-lecture-seule')).toBeVisible()
		for (const caseACocher of await panneau.getByRole('checkbox').all()) await expect(caseACocher).toBeDisabled()
		await capturer(page, 'pastilles-inbox-lectrice-1440', UNITE)
	})

	test('les quatre paliers : les pilules passent à la ligne, la page ne défile jamais horizontalement', async ({ page, request }) => {
		const corrige = await idDe(request, `rfc822_message_id=eq.${encodeURIComponent(MSGID_CORRIGE)}`)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`/inbox?courrier=tous&message=${corrige}`)
			const ouvert = page.getByTestId('inbox-message-ouvert')
			await expect(ouvert.getByTestId('inbox-pastilles-message')).toBeVisible()
			await ouvert.getByTestId('inbox-pastilles').click()
			await expect(page.getByTestId('inbox-panneau-pastilles')).toBeVisible()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await capturer(page, `pastilles-inbox-message-${palier.nom}`, UNITE)
		}
		await page.setViewportSize({ width: 390, height: 780 })
		await page.getByRole('button', { name: 'Retour aux messages' }).click()
		const liste = page.getByTestId('inbox-panneau-liste')
		await expect(liste.getByLabel('Pastille')).toBeVisible()
		const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
		expect(debordement).toBeLessThanOrEqual(0)
		await capturer(page, 'pastilles-inbox-liste-sm-390', UNITE)
	})
})
