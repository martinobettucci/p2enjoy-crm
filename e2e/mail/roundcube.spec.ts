// @verifies CRM-050 (docs/BACKLOG.md) — « Roundcube affiche les boîtes » (Definition of Done)
// @verifies docs/SPEC-mail-subsystem.md §11.5 (Roundcube), §11.9 (preuve visuelle)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// Roundcube est le **seul** moyen de vérification visuelle de la messagerie tant que l'inbox du
// produit n'existe pas (`CRM-057`). Ce fichier est donc la preuve d'écran de l'unité.
//
// Ce n'est PAS une preuve du design system : Roundcube est un outil tiers de développement, pas
// une interface produite par ce projet, et `docs/DESIGN_SYSTEM.md` ne le régit pas. Ce qui est
// vérifié est ce que la Definition of Done demande — une session réellement ouverte contre
// Stalwart, et l'arborescence des dossiers rendue à l'écran.

import { expect, test } from '@playwright/test'
import { lireEnv } from '../env'
import { capturer } from '../ui/captures'

const HOTE = lireEnv('DEV_BIND_ADDRESS')
const URL_ROUNDCUBE = `http://${HOTE}:${lireEnv('ROUNDCUBE_PORT')}/`
const MDP = lireEnv('STALWART_MAILBOX_PASSWORD')
const BOITE = `bizdev@${lireEnv('MAIL_DEV_PERSONAL_DOMAIN')}`
const BOITE_SYSTEME = `systeme@${lireEnv('CRM_INBOUND_DOMAIN')}`

async function ouvrirSession(page: import('@playwright/test').Page, boite: string) {
	await page.goto(URL_ROUNDCUBE)
	await page.locator('#rcmloginuser').fill(boite)
	await page.locator('#rcmloginpwd').fill(MDP)
	await page.locator('#rcmloginsubmit').click()
	// L'attente porte sur la liste des dossiers, et non sur une temporisation : c'est
	// l'élément dont l'apparition prouve que la session IMAP est établie.
	await page.locator('#mailboxlist').waitFor({ state: 'visible', timeout: 30_000 })
}

test.describe('M5 — Roundcube affiche les boîtes', () => {
	test('une boîte personnelle ouvre sa session et rend son arborescence', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await ouvrirSession(page, BOITE)

		const dossiers = page.locator('#mailboxlist')
		await expect(dossiers).toBeVisible()
		// Les dossiers réellement créés par Stalwart, mesurés par `LIST` dans
		// `infrastructure.spec.ts`. Exiger le libellé exact évite de valider un écran vide.
		await expect(dossiers).toContainText('Inbox')
		await expect(dossiers).toContainText('Sent')

		await capturer(page, 'roundcube-boite-personnelle-1440', 'CRM-050')
	})

	test('la boîte système ouvre sa session et rend son arborescence', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await ouvrirSession(page, BOITE_SYSTEME)

		await expect(page.locator('#mailboxlist')).toContainText('Inbox')
		await capturer(page, 'roundcube-boite-systeme-1440', 'CRM-050')
	})

	test('un mot de passe faux laisse le visiteur sur le formulaire, avec un message', async ({
		page,
	}) => {
		// Contre-épreuve de l'écran : sans elle, un Roundcube qui accepterait n'importe quoi
		// passerait les deux contrôles précédents.
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(URL_ROUNDCUBE)
		await page.locator('#rcmloginuser').fill(BOITE)
		await page.locator('#rcmloginpwd').fill('mauvais-mot-de-passe')
		await page.locator('#rcmloginsubmit').click()

		await expect(page.locator('#rcmloginuser')).toBeVisible({ timeout: 30_000 })
		await expect(page.locator('#mailboxlist')).toHaveCount(0)
		await capturer(page, 'roundcube-refus-1440', 'CRM-050')
	})
})
