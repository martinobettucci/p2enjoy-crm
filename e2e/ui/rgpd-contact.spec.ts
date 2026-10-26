// @verifies CRM-072 (docs/BACKLOG.md) — tranche T3 : les gestes RGPD sur la fiche d'un contact, sur la pile réelle
// @verifies docs/SPEC-audit.md §7, §9 ; docs/DESIGN_SYSTEM.md §5.67 (zone en bas de fiche, export téléchargé, confirmation
//           dans le flux par le nom retapé, pilule « Anonymisé le … », « Modifier » éteint), §5.59 (commandes éteintes
//           pour qui n'administre pas, citant le motif) ; CLAUDE.md §16 (captures observées) ; décision 732
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LE SEED PORTE « Régis Anonyme » (`…a9`), DÉJÀ ANONYMISÉ PAR LES VRAIES FONCTIONS (docs/SPEC-seed.md §26). Le scénario
// qui anonymise à l'écran crée son propre contact par l'API, sous le jeton de Camille, et le supprime à la fin.

import { readFileSync } from 'node:fs'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { connecterAvecLeLabs, expect, test } from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-072'
const ANONYME = '/contacts/5eed0000-0000-4000-8000-0000000000a9'
const EPREUVE = 'a0d17000-0000-4000-8000-0000000000e2'
const NOM = 'Régis Épreuve écran'

test.describe('l’administratrice — Camille Aubert', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	})

	test('le contact anonymisé du seed : la pilule, « Modifier » éteint, la phrase datée, l’export qui reste', async ({ page }) => {
		await page.goto(ANONYME)
		await expect(page.getByTestId('pilule-contact-anonymise')).toContainText('Anonymisé le')
		const modifier = page.getByTestId('ouvrir-modification-contact')
		await expect(modifier).toBeDisabled()
		await expect(page.getByTestId('motif-contact-anonymise')).toHaveText('Un contact anonymisé ne se modifie plus.')
		const zone = page.getByTestId('zone-rgpd-contact')
		await expect(zone.getByTestId('contact-deja-anonymise')).toContainText('Ce contact a été anonymisé le')
		await expect(zone.getByRole('button', { name: 'Anonymiser ce contact' })).toHaveCount(0)

		const telechargement = page.waitForEvent('download')
		await zone.getByRole('button', { name: 'Exporter les données' }).click()
		const fichier = await telechargement
		expect(fichier.suggestedFilename()).toMatch(/^contact-5eed0000-\d{4}-\d{2}-\d{2}\.json$/)
		const contenu = JSON.parse(readFileSync(await fichier.path(), 'utf8')) as { format: string; contact: { full_name: string } }
		expect(contenu.format).toBe('p2enjoy-crm/contact-export/1')
		expect(contenu.contact.full_name).toBe('Contact anonymisé')
		await expect(zone.getByRole('status')).toContainText('Fichier téléchargé')
		await zone.scrollIntoViewIfNeeded()
		await capturer(page, 'rgpd-contact-anonymise-1440', UNITE)
	})

	test('anonymiser à l’écran : la confirmation exige le nom retapé, puis la fiche se fige', async ({ page, request }) => {
		await request.delete(`${URL_API}/rest/v1/contacts?id=eq.${EPREUVE}`, { headers: enTetesService() })
		const creation = await request.post(`${URL_API}/rest/v1/contacts`, {
			headers: { ...enTetesAuthentifies(await jetonDe('admin@p2enjoy.test')), 'Content-Type': 'application/json' },
			data: { id: EPREUVE, workspace_id: '5eed0000-0000-4000-8000-000000000001', full_name: NOM, email: 'regis.ecran@exemple.test' },
		})
		expect(creation.status(), await creation.text()).toBe(201)
		try {
			await page.goto(`/contacts/${EPREUVE}`)
			const zone = page.getByTestId('zone-rgpd-contact')
			await zone.getByRole('button', { name: 'Anonymiser ce contact' }).click()
			const confirmer = zone.getByRole('button', { name: 'Anonymiser définitivement' })
			await expect(confirmer).toBeDisabled()
			await expect(zone.getByLabel('Nom du contact')).toBeFocused()
			await zone.getByLabel('Nom du contact').fill(NOM)
			await expect(confirmer).toBeEnabled()
			await zone.scrollIntoViewIfNeeded()
			await capturer(page, 'rgpd-contact-confirmation-1440', UNITE)
			await confirmer.click()
			await expect(page.getByTestId('pilule-contact-anonymise')).toBeVisible()
			await expect(page.getByTestId('ouvrir-modification-contact')).toBeDisabled()
			await expect(page.getByTestId('caracteristiques-contact')).not.toContainText('regis.ecran@exemple.test')
		} finally {
			await request.delete(`${URL_API}/rest/v1/contacts?id=eq.${EPREUVE}`, { headers: enTetesService() })
		}
	})

	test('les quatre paliers : la zone tient dans la page, qui ne défile jamais horizontalement', async ({ page }) => {
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(ANONYME)
			const zone = page.getByTestId('zone-rgpd-contact')
			await zone.scrollIntoViewIfNeeded()
			await expect(zone).toBeVisible()
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
			expect(deborde, `la page ne défile pas horizontalement à ${palier.largeur} px`).toBe(false)
			await capturer(page, `rgpd-contact-${palier.nom}`, UNITE)
		}
	})
})

test.describe('la lectrice — Farida Nowak', () => {
	test('les deux commandes sont éteintes, lisibles, et citent le motif de l’administration', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto('/contacts/5eed0000-0000-4000-8000-000000000091')
		const zone = page.getByTestId('zone-rgpd-contact')
		const motif = zone.getByTestId('motif-rgpd-contact')
		await expect(motif).toBeVisible()
		const idMotif = await motif.getAttribute('id')
		for (const nom of ['Exporter les données', 'Anonymiser ce contact']) {
			const commande = zone.getByRole('button', { name: nom })
			await expect(commande).toBeDisabled()
			await expect(commande).toHaveAttribute('aria-describedby', idMotif ?? '')
		}
		await zone.scrollIntoViewIfNeeded()
		await capturer(page, 'rgpd-contact-lectrice-1440', UNITE)
	})
})
