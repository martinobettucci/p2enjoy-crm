// @verifies CRM-071 (docs/BACKLOG.md) — tranche T4 : l'export CSV sur la vraie pile — le fichier téléchargé est relu : son
//           encodage, son séparateur, ses lignes, celles que l'écran montre ; le carnet entier
// @verifies docs/SPEC-vues-import-export.md §5.1, §5.3 ; docs/DESIGN_SYSTEM.md §5.76 ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO

import { readFile } from 'node:fs/promises'
import type { Download, Page } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-071'

test.use({ viewport: { width: 1440, height: 1000 } })

async function telecharger(page: Page, commande: string): Promise<{ telechargement: Download; contenu: string }> {
	const attente = page.waitForEvent('download')
	await page.getByTestId(commande).click()
	const telechargement = await attente
	const chemin = await telechargement.path()
	return { telechargement, contenu: await readFile(chemin, 'utf8') }
}

test('la vue liste filtrée s’exporte telle qu’elle est montrée, en UTF-8 avec BOM et point-virgule', async ({ page }) => {
	await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
	await page.goto('/tracks/studio-web/refonte/liste')
	await page.getByRole('combobox', { name: 'Vue', exact: true }).selectOption({ label: 'Secteur public, par échéance' })
	const lignes = page.getByTestId('ligne-card')
	await expect(lignes.first()).toBeVisible()
	const titresALEcran = await lignes.evaluateAll((elements) =>
		elements.map((e) => (e.querySelector('a')?.getAttribute('title') ?? e.querySelector('a')?.textContent ?? '').trim()),
	)
	const commande = page.getByRole('button', { name: /^Exporter en CSV les affaires de/ })
	await expect(commande).toBeVisible()

	const { telechargement, contenu } = await telecharger(page, 'exporter-affaires')
	expect(telechargement.suggestedFilename()).toMatch(/^affaires-refonte-\d{4}-\d{2}-\d{2}\.csv$/)
	expect(contenu.startsWith('﻿')).toBe(true)
	const rangees = contenu.slice(1).split('\r\n').filter((r) => r !== '')
	expect(rangees[0]).toBe('Identifiant;Affaire;Étiquettes;Responsable;Étape;Montant;Devise;Prochaine action;Échéance;Adresse de la fiche')
	// Les mêmes affaires, dans le même ordre, que la liste ; l'adresse de chacune ouvre sa fiche.
	expect(rangees.slice(1).map((r) => r.split(';')[1])).toEqual(titresALEcran)
	expect(rangees[1]).toMatch(/;http:\/\/[^;]+\/tracks\/studio-web\/refonte\/cards\/[0-9a-f-]{36}$/)
	await expect(page.getByRole('status', { name: 'Annonces de l’export' })).toContainText(telechargement.suggestedFilename())
	await capturer(page, 'export-liste-1440', UNITE)
})

test('le carnet s’exporte entier', async ({ page, request }) => {
	await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
	await page.goto('/contacts')
	const compte = await request.get(`${URL_API}/rest/v1/contacts?workspace_id=eq.5eed0000-0000-4000-8000-000000000001&select=id`, {
		headers: enTetesService(),
	})
	const nombre = ((await compte.json()) as unknown[]).length
	const { telechargement, contenu } = await telecharger(page, 'exporter-contacts')
	expect(telechargement.suggestedFilename()).toMatch(/^contacts-\d{4}-\d{2}-\d{2}\.csv$/)
	const rangees = contenu.slice(1).split('\r\n').filter((r) => r !== '')
	expect(rangees[0]).toBe('Identifiant;Nom;Email;Téléphone;Fonction;Organisation;Domaine de l’organisation;Créé le;Anonymisé le')
	expect(rangees.length - 1).toBe(nombre)
	await capturer(page, 'export-carnet-1440', UNITE)

	await page.setViewportSize({ width: 390, height: 900 })
	await page.reload()
	await expect(page.getByTestId('exporter-contacts')).toBeVisible()
	const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debordement, 'aucun défilement horizontal de page à 390 px').toBeLessThanOrEqual(0)
	await capturer(page, 'export-carnet-390', UNITE)
})
