// @verifies CRM-161 (docs/BACKLOG.md) — tranche T2.b : le menu des espaces sur la vraie pile — pour une personne de deux espaces,
//           le premier niveau du fil devient un menu ; sa pastille dit qu'un autre espace a des non-lus, chaque ligne dit les
//           siens ; au clavier, ↓ ouvre, ↓ parcourt, Entrée choisit : la même page dans l'autre espace, la bascule annoncée ; à
//           la souris depuis une page globale, l'onglet change d'espace sans changer de page ; sous `md`, la section
//           « Espaces » du repli ; aux quatre paliers
// @verifies docs/DESIGN_SYSTEM.md §5.113, §5.62, §7 ; docs/SPEC-espace-courant.md §9, §15.6 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// La preuve pose, sous la clé de service, un espace jetable (« Sonde 161 menu ») dont Camille est administratrice, sa boîte
// système et un mail non classé non lu ; elle le supprime à la fin, et la cascade emporte le reste.

import type { APIRequestContext, Page } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { ESPACE_SEED } from '../espace'
import { capturer, PALIERS } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-161'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const SONDE = { id: 'e1610000-0000-4000-8000-0000000000d1', nom: 'Sonde 161 menu', slug: 'sonde-161-menu' } as const
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const JSON_SERVICE = () => ({ ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' })

async function retirerSonde(request: APIRequestContext): Promise<void> {
	const reponse = await request.delete(rest(`workspaces?id=eq.${SONDE.id}`), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBeLessThan(300)
}

async function poser(request: APIRequestContext, table: string, ligne: Record<string, unknown>): Promise<string> {
	const reponse = await request.post(rest(`${table}?select=id`), { headers: JSON_SERVICE(), data: ligne })
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { id: string }[])[0]?.id ?? ''
}

async function poserSonde(request: APIRequestContext): Promise<void> {
	await retirerSonde(request)
	await poser(request, 'workspaces', { id: SONDE.id, name: SONDE.nom, slug: SONDE.slug })
	const membre = await request.post(rest('workspace_members'), {
		headers: JSON_SERVICE(),
		data: { workspace_id: SONDE.id, user_id: CAMILLE, role: 'admin' },
	})
	expect(membre.status(), await membre.text()).toBe(201)
	const boite = await poser(request, 'mail_inbound_accounts', {
		workspace_id: SONDE.id,
		owner_id: null,
		label: 'Boîte système de la sonde 161',
		imap_host: 'imap.sonde-161-menu.test',
		imap_port: 143,
		imap_username: 'systeme@sonde-161-menu.test',
	})
	const message = await poser(request, 'mail_messages', {
		workspace_id: SONDE.id,
		rfc822_message_id: '<menu-161@sonde-161-menu.test>',
		classification: 'unclassified',
		direction: 'inbound',
		from_address: 'tiers161@exemple.test',
		to_addresses: ['systeme@sonde-161-menu.test'],
		subject: 'Un mail non lu de la sonde 161',
		received_at: new Date().toISOString(),
	})
	const occurrence = await request.post(rest('mail_message_occurrences'), {
		headers: JSON_SERVICE(),
		data: { message_id: message, account_id: boite, folder: 'INBOX', uid: 161_201 },
	})
	expect(occurrence.status(), await occurrence.text()).toBe(201)
}

const bouton = (page: Page) => page.getByRole('button', { name: /^Changer d’espace — / })

test.describe('Le menu des espaces (docs/DESIGN_SYSTEM.md §5.113)', () => {
	test.beforeEach(async ({ request }) => {
		await poserSonde(request)
	})
	test.afterEach(async ({ request }) => {
		await retirerSonde(request)
	})

	test('au clavier : la pastille, les comptes, le choix qui garde la page, la bascule annoncée', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/${ESPACE_SEED}/reglages/etiquettes`)
		await expect(bouton(page)).toHaveAccessibleName('Changer d’espace — P2Enjoy SAS — des messages non lus dans un autre espace')
		await expect(page.getByTestId('pastille-autre-espace')).toBeVisible()

		await bouton(page).focus()
		await page.keyboard.press('ArrowDown')
		const menu = page.getByRole('menu', { name: 'Vos espaces' })
		await expect(menu).toBeVisible()
		await expect(menu.getByRole('menuitemradio', { name: 'P2Enjoy SAS', exact: false }).first()).toBeFocused()
		await expect(menu.getByRole('menuitemradio', { name: `${SONDE.nom} — 1 message non lu` })).toBeVisible()
		await capturer(page, 'menu-espaces-ouvert-1440', UNITE)

		await page.keyboard.press('ArrowDown')
		await expect(menu.getByRole('menuitemradio', { name: new RegExp(SONDE.nom) })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`/${SONDE.slug}/reglages/etiquettes$`))
		await expect(page.getByTestId('region-annonces')).toContainText(`Vous êtes passé dans l’espace ${SONDE.nom}.`)
		// L'espace du seed a ses non-lus : depuis la sonde, la pastille dit « ailleurs ».
		await expect(bouton(page)).toHaveAccessibleName(`Changer d’espace — ${SONDE.nom} — des messages non lus dans un autre espace`)
	})

	test('à la souris, depuis une page globale : l’onglet change d’espace sans changer de page', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/contacts')
		await bouton(page).click()
		await page.getByRole('menuitemradio', { name: new RegExp(SONDE.nom) }).click()
		await expect(page).toHaveURL(/\/contacts$/)
		// L'espace du seed a ses non-lus : depuis la sonde, la pastille dit « ailleurs ».
		await expect(bouton(page)).toHaveAccessibleName(`Changer d’espace — ${SONDE.nom} — des messages non lus dans un autre espace`)
		// L'entrée « Inbox » de la barre mène maintenant dans l'espace choisi.
		await expect(page.getByRole('navigation').getByRole('link', { name: 'Inbox' }).first()).toHaveAttribute('href', `/${SONDE.slug}/inbox`)
	})

	test('aux quatre paliers ; sous `md`, la section « Espaces » du repli', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`/${ESPACE_SEED}/inbox`)
			if (palier.largeur >= 768) {
				await bouton(page).click()
				await expect(page.getByRole('menu', { name: 'Vos espaces' })).toBeVisible()
			} else {
				await page.getByTestId('fil-ariane-repli').click()
				await expect(page.getByTestId('section-espaces-repli')).toBeVisible()
			}
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(deborde, `la page ne défile pas de côté à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await capturer(page, `menu-espaces-${palier.nom}`, UNITE)
			await page.keyboard.press('Escape')
		}
	})
})
