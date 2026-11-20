// @verifies CRM-159 (docs/BACKLOG.md) — tranche T2 : les pastilles cachées sur la vraie pile — les fils Spam masqués de la
//           liste, la mention « fils masqués » et son geste qui active la pastille (le focus sur sa bascule), « Lead » qui
//           ne montre pas le fil Spam et Lead, la bascule d'une cachée qui le dit, la case « Cacher ses mails dans
//           l'inbox » des réglages cochée puis décochée, la palette qui ne propose pas le mail masqué et mène à l'inbox,
//           pastille activée ; à la souris, au clavier, aux quatre paliers ; captures
// @verifies docs/SPEC-mail-subsystem.md §31.13.1 à §31.13.6, §31.13.9 ; docs/DESIGN_SYSTEM.md §5.111 ; décisions 957 et 958 ;
//           CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LES MAILS SONT PROPRES À LA PREUVE, posés par la clé de service dans « Refonte du site vitrine » (`…00c1`) et retirés à
// la fin par leur préfixe ; leurs pastilles sont posées par `set_message_label` sous le jeton de l'administratrice. Le mot
// de leur objet, tiré au hasard, ne répond qu'à eux dans la recherche. Le drapeau de « Lead », coché par la preuve des
// réglages, est rendu à sa valeur à la fin quoi qu'il arrive.

import { type APIRequestContext, type Page } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-159'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
const ADMIN = 'admin@p2enjoy.test'
const PREFIXE = '<tst-crm159-ui-'
const MOT = `quorvel${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 1000 } })

const ids: Record<string, string> = {}
const mails = { spam: '', spamLead: '', lead: '' }
const OBJETS = { spam: `Sonde ${MOT} un`, spamLead: `Sonde ${MOT} deux`, lead: `Sonde ${MOT} trois` }

async function poserMail(request: APIRequestContext, rang: number, objet: string): Promise<string> {
	const reponse = await request.post(rest('mail_messages'), {
		headers: json({ ...enTetesService(), Prefer: 'return=representation' }),
		data: {
			workspace_id: ESPACE,
			rfc822_message_id: `${PREFIXE}${MOT}-${rang}@sonde.test>`,
			card_id: CARD_C1,
			classification: 'manual',
			from_address: `contact-${rang}@sonde.test`,
			subject: objet,
			body_text: 'Preuve des fils masqués.',
			direction: 'inbound',
		},
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

async function remettreLead(request: APIRequestContext): Promise<void> {
	if (ids['Lead'] === undefined) return
	await request.patch(rest(`mail_labels?id=eq.${ids['Lead']}`), { headers: json(enTetesService()), data: { hidden: false } })
}

test.beforeAll(async ({ request }) => {
	await request.delete(rest(`mail_messages?rfc822_message_id=like.${encodeURIComponent(PREFIXE)}*`), { headers: enTetesService() })
	const reponse = await request.get(rest(`mail_labels?workspace_id=eq.${ESPACE}&select=id,name`), { headers: enTetesService() })
	for (const { id, name } of (await reponse.json()) as { id: string; name: string }[]) ids[name] = id
	await remettreLead(request)
	mails.spam = await poserMail(request, 1, OBJETS.spam)
	mails.spamLead = await poserMail(request, 2, OBJETS.spamLead)
	mails.lead = await poserMail(request, 3, OBJETS.lead)
	const camille = await jetonDe(ADMIN)
	for (const [message, label] of [
		[mails.spam, ids['Spam']],
		[mails.spamLead, ids['Spam']],
		[mails.spamLead, ids['Lead']],
		[mails.lead, ids['Lead']],
	] as const) {
		const pose = await request.post(rest('rpc/set_message_label'), {
			headers: json(enTetesAuthentifies(camille)),
			data: { p_message_id: message, p_label_id: label, p_applied: true },
		})
		expect(pose.status(), await pose.text()).toBe(204)
	}
})

test.afterAll(async ({ request }) => {
	await request.delete(rest(`mail_messages?rfc822_message_id=like.${encodeURIComponent(PREFIXE)}*`), { headers: enTetesService() })
	await remettreLead(request)
})

const liste = (page: Page) => page.getByTestId('inbox-panneau-liste')
const filtres = (page: Page) => liste(page).getByRole('group', { name: 'Filtrer par pastille' })
const ligne = (page: Page, objet: string) => liste(page).getByTestId('inbox-message').filter({ hasText: objet })
const mention = (page: Page) => liste(page).getByTestId('inbox-fils-masques')
const valeursAdresse = (page: Page) => new URL(page.url()).searchParams.getAll('pastille')

/** Le dossier « Refonte du site vitrine », ouvert par l'adresse du mail Lead : il y est visible. */
async function ouvrirLeDossier(page: Page, pastilles: readonly string[] = []): Promise<void> {
	const suite = pastilles.map((id) => `&pastille=${id}`).join('')
	await page.goto(`/inbox?courrier=tous&message=${mails.lead}${suite}`)
	await expect(ligne(page, OBJETS.lead)).toBeVisible()
}

/** Le compte de la base pour « Lead » dans le dossier, sous le jeton de l'administratrice (§31.13.5). */
async function filsMasquesParLead(page: Page): Promise<number> {
	const reponse = await page.request.post(rest('rpc/inbox_hidden_counts'), {
		headers: json(enTetesAuthentifies(await jetonDe(ADMIN))),
		data: { p_card_id: CARD_C1 },
	})
	const lignes = (await reponse.json()) as { label_id: string; thread_count: number }[]
	return lignes.find((l) => l.label_id === ids['Lead'])?.thread_count ?? 0
}

/** Attend la fin des transitions de couleur des bascules avant une capture (le patron de `CRM-155`). */
async function transitionsFinies(page: Page): Promise<void> {
	await filtres(page).evaluate((bloc) => Promise.all(bloc.getAnimations({ subtree: true }).map((a) => a.finished)))
}

test.describe('les pastilles cachées dans l’inbox (docs/DESIGN_SYSTEM.md §5.111)', () => {
	test('à la souris : les fils Spam sont masqués et comptés ; « Lead » ne montre pas le fil Spam et Lead ; la mention active Spam', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeDossier(page)
		await expect(ligne(page, OBJETS.spam)).toHaveCount(0)
		await expect(ligne(page, OBJETS.spamLead)).toHaveCount(0)
		const spam = mention(page).getByTestId('inbox-fils-masques-pastille').filter({ hasText: '(Spam)' })
		await expect(spam).toHaveText('2 fils masqués (Spam)')
		// La bascule d'une cachée le dit.
		await expect(filtres(page).getByRole('button', { name: 'Spam, pastille cachée', exact: true })).toBeVisible()
		await transitionsFinies(page)
		await capturer(page, 'fils-masques-xl-1440', UNITE)

		// « Lead » seule : le caché l'emporte, le fil Spam et Lead reste masqué ; la mention dit ce que Spam montrerait.
		await filtres(page).getByRole('button', { name: 'Lead', exact: true }).click()
		await expect(ligne(page, OBJETS.lead)).toBeVisible()
		await expect(ligne(page, OBJETS.spamLead)).toHaveCount(0)
		await expect(spam).toHaveText('2 fils masqués (Spam)')

		await spam.click()
		expect(valeursAdresse(page)).toEqual([ids['Lead'], ids['Spam']])
		await expect(ligne(page, OBJETS.spamLead)).toBeVisible()
		await expect(ligne(page, OBJETS.spam)).toBeVisible()
		const basculeSpam = filtres(page).getByRole('button', { name: 'Spam, pastille cachée', exact: true })
		await expect(basculeSpam).toHaveAttribute('aria-pressed', 'true')
		await expect(basculeSpam).toBeFocused()
		await expect(spam).toHaveCount(0)
		await transitionsFinies(page)
		await capturer(page, 'fils-montres-sous-spam-xl-1440', UNITE)
	})

	test('au clavier : la mention se joint par Tab, Entrée active la pastille, le focus passe à sa bascule', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeDossier(page)
		const spam = mention(page).getByTestId('inbox-fils-masques-pastille').filter({ hasText: '(Spam)' })
		await spam.focus()
		await expect(spam).toBeFocused()
		await page.keyboard.press('Enter')
		const basculeSpam = filtres(page).getByRole('button', { name: 'Spam, pastille cachée', exact: true })
		await expect(basculeSpam).toHaveAttribute('aria-pressed', 'true')
		await expect(basculeSpam).toBeFocused()
		await expect(ligne(page, OBJETS.spam)).toBeVisible()
		// `Espace` sur la bascule désactive Spam : les fils repartent masqués.
		await page.keyboard.press('Space')
		await expect(basculeSpam).toHaveAttribute('aria-pressed', 'false')
		await expect(ligne(page, OBJETS.spam)).toHaveCount(0)
	})

	test('les réglages : Spam dit « Cachée » ; cocher la case de Lead masque son fil, la décocher le rend', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/pastilles-mails')
		const lignes = page.getByTestId('ligne-pastille-mail')
		await expect(lignes.filter({ hasText: 'Spam' }).getByTestId('pastille-cachee')).toHaveText('Cachée')
		await expect(lignes.filter({ hasText: 'Lead' }).getByTestId('pastille-cachee')).toHaveCount(0)

		await page.getByRole('button', { name: 'Modifier la pastille Lead' }).click()
		const caseCachee = page.getByLabel('Cacher ses mails dans l’inbox')
		await expect(caseCachee).not.toBeChecked()
		// Au clavier : `Espace` coche la case native.
		await caseCachee.focus()
		await page.keyboard.press('Space')
		await expect(caseCachee).toBeChecked()
		await capturer(page, 'reglages-case-cachee-1440', UNITE)
		await page.getByTestId('pastille-enregistrer').click()
		await expect(lignes.filter({ hasText: 'Lead' }).getByTestId('pastille-cachee')).toHaveText('Cachée')

		// Le message reste ouvert par son adresse (§31.13.3) ; son fil, lui, a quitté la liste.
		await page.goto(`/inbox?courrier=tous&message=${mails.lead}`)
		await expect(page.getByTestId('inbox-message-ouvert')).toContainText(OBJETS.lead)
		await expect(ligne(page, OBJETS.lead)).toHaveCount(0)
		// Le compte est celui de la base : nos deux fils Lead, et ceux du seed dans le même dossier (« Demande de devis —
		// refonte » y porte Lead, docs/SPEC-seed.md §46).
		const attendus = await filsMasquesParLead(page)
		expect(attendus, 'au moins nos deux fils Lead').toBeGreaterThanOrEqual(2)
		await expect(mention(page).getByTestId('inbox-fils-masques-pastille').filter({ hasText: '(Lead)' })).toHaveText(
			`${attendus} fils masqués (Lead)`,
		)

		await page.goto('/reglages/pastilles-mails')
		await page.getByRole('button', { name: 'Modifier la pastille Lead' }).click()
		await page.getByLabel('Cacher ses mails dans l’inbox').click()
		await page.getByTestId('pastille-enregistrer').click()
		await expect(lignes.filter({ hasText: 'Lead' }).getByTestId('pastille-cachee')).toHaveCount(0)
		await ouvrirLeDossier(page)
	})

	test('la palette ne propose pas les mails masqués, le dit, et mène à l’inbox la pastille activée', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/')
		const champ = page.getByTestId('champ-recherche')
		await champ.fill(MOT)
		const panneau = page.getByTestId('panneau-recherche')
		await expect(panneau.getByTestId('liste-recherche')).toContainText(OBJETS.lead)
		await expect(panneau.getByTestId('liste-recherche')).not.toContainText(OBJETS.spam)
		const lien = panneau.getByTestId('recherche-mails-masques-lien')
		await expect(lien).toHaveText('2 mails masqués (Spam)')
		await capturer(page, 'palette-mails-masques-1440', UNITE)
		await lien.click()
		await expect(page).toHaveURL(new RegExp(`/inbox\\?pastille=${ids['Spam']}$`))
		await expect(panneau).toHaveCount(0)
	})

	test('les quatre paliers : la mention passe à la ligne, la page ne défile jamais de côté', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`/inbox?courrier=tous&message=${mails.lead}`)
			// Sous 1024 px, l'inbox est une pile : on remonte du message à la liste (le patron de `CRM-155`).
			await expect(page.getByTestId('inbox-message-ouvert')).toBeVisible()
			const retour = page.getByRole('button', { name: 'Retour aux messages' })
			if (await retour.isVisible()) await retour.click()
			await expect(ligne(page, OBJETS.lead)).toBeVisible()
			await mention(page).scrollIntoViewIfNeeded()
			await expect(mention(page)).toBeVisible()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await capturer(page, `fils-masques-${palier.nom}`, UNITE)
		}
	})
})
