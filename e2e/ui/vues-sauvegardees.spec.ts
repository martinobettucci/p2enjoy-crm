// @verifies CRM-071 (docs/BACKLOG.md) — tranche T2 : les vues sauvegardées de la vue liste, sur la vraie pile — choisir une
//           vue, voir l'écart des filtres, enregistrer, mettre à jour, supprimer ; la vue de l'espace pour qui n'administre pas
// @verifies docs/SPEC-vues-import-export.md §2.3, §3 (décision 777) ; docs/DESIGN_SYSTEM.md §5.75, §5.59 ; docs/SPEC-seed.md
//           §32 (le jeu semé) ; CLAUDE.md §10 (la base tranche), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les vues de la preuve portent le préfixe `ZZ 071` et sont retirées à la fin, par la clé de service ; les deux vues du jeu
// ne sont jamais écrites.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-071'
const PREFIXE = 'ZZ 071'
const LISTE = '/tracks/studio-web/refonte/liste'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const NEGOCIATION = '5eed0000-0000-4000-8000-000000000063'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const vues = `${URL_API}/rest/v1/saved_views`

async function lireVue(requete: APIRequestContext, nom: string): Promise<{ id: string; owner_id: string; visibility: string; filters: unknown }[]> {
	const reponse = await requete.get(`${vues}?name=eq.${encodeURIComponent(nom)}&select=id,owner_id,visibility,filters`, {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as { id: string; owner_id: string; visibility: string; filters: unknown }[]
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(`${vues}?name=like.${encodeURIComponent(`${PREFIXE}*`)}`, { headers: enTetesService() })
})

test.describe('les vues sauvegardées de la vue liste (docs/DESIGN_SYSTEM.md §5.75)', () => {
	test('Driss choisit sa vue, voit l’écart, enregistre une vue à lui, puis la supprime', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(LISTE)
		const selecteur = page.getByRole('combobox', { name: 'Vue', exact: true })
		await expect(selecteur).toBeEnabled()
		await expect(selecteur.locator('optgroup')).toHaveCount(2)

		await selecteur.selectOption({ label: 'Mes négociations' })
		await expect(page).toHaveURL(new RegExp(`etape=${NEGOCIATION}`))
		await expect(page).toHaveURL(/vue=/)
		await expect(page.getByTestId('vue-ecart')).toHaveCount(0)
		await expect(page.getByTestId('ligne-card').first()).toBeVisible()
		await capturer(page, 'vues-choisie-1440', UNITE)

		// Un filtre de plus : la vue reste nommée, l'écart est dit, et la mise à jour est offerte.
		await page.getByTestId('filtre-recherche').fill('Lyon')
		await page.getByTestId('valider-recherche').click()
		await expect(page.getByTestId('vue-ecart')).toHaveText('Filtres modifiés depuis la vue')
		await expect(selecteur).toHaveValue(/[0-9a-f-]{36}/)
		await expect(page.getByTestId('vue-mettre-a-jour')).toBeVisible()
		await capturer(page, 'vues-ecart-1440', UNITE)

		// Enregistrer ces filtres comme une vue à soi.
		await page.getByTestId('vue-enregistrer').click()
		const panneau = page.getByTestId('panneau-vue')
		await expect(panneau.getByLabel('Nom de la vue')).toBeFocused()
		await panneau.getByLabel('Nom de la vue').fill(`${PREFIXE} Lyon en négociation`)
		await capturer(page, 'vues-panneau-1440', UNITE)
		await panneau.getByTestId('panneau-vue-valider').click()
		await expect(panneau).toHaveCount(0)
		await expect(page.getByRole('status', { name: 'Annonces des vues' })).toContainText(`${PREFIXE} Lyon en négociation`)
		const [enregistree] = await lireVue(request, `${PREFIXE} Lyon en négociation`)
		expect(enregistree).toMatchObject({ owner_id: DRISS, visibility: 'private', filters: { step_id: NEGOCIATION, search: 'Lyon', sort: 'next_action_at' } })
		await expect(page).toHaveURL(new RegExp(`vue=${enregistree!.id}`))
		await expect(page.getByTestId('vue-ecart')).toHaveCount(0)

		// La supprimer : la marque quitte l'adresse, les filtres restent, le focus va au sélecteur.
		await page.getByTestId('vue-supprimer').click()
		await expect(page.getByRole('status', { name: 'Annonces des vues' })).toContainText('supprimée')
		await expect(page).not.toHaveURL(/vue=/)
		await expect(page).toHaveURL(/q=Lyon/)
		await expect(selecteur).toBeFocused()
		expect(await lireVue(request, `${PREFIXE} Lyon en négociation`)).toEqual([])
	})

	test('Camille met à jour une vue de l’espace avec les filtres de l’écran', async ({ page, request }) => {
		const pose = await request.post(vues, {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: { channel_id: REFONTE, name: `${PREFIXE} Revue`, visibility: 'workspace', owner_id: '5eed0000-0000-4000-8000-000000000011', filters: {} },
		})
		expect(pose.status(), await pose.text()).toBe(201)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(LISTE)
		await page.getByRole('combobox', { name: 'Vue', exact: true }).selectOption({ label: `${PREFIXE} Revue` })
		await page.getByRole('columnheader', { name: /Montant/ }).getByRole('button').click()
		await expect(page.getByTestId('vue-ecart')).toBeVisible()
		await page.getByTestId('vue-mettre-a-jour').click()
		await expect(page.getByTestId('vue-ecart')).toHaveCount(0)
		await expect(page.getByRole('combobox', { name: 'Vue', exact: true })).toBeFocused()
		const [mise] = await lireVue(request, `${PREFIXE} Revue`)
		expect(mise!.filters).toEqual({ sort: 'amount' })
	})

	test('la lectrice : la vue de l’espace se choisit, ses commandes sont éteintes avec leur motif, et sa propre vue reste possible', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto(LISTE)
		const selecteur = page.getByRole('combobox', { name: 'Vue', exact: true })
		await expect(selecteur.locator('optgroup')).toHaveCount(1)
		await selecteur.selectOption({ label: 'Secteur public, par échéance' })
		await expect(page).toHaveURL(/etiquette=/)
		const supprimer = page.getByTestId('vue-supprimer')
		await expect(supprimer).toBeDisabled()
		await expect(supprimer).toHaveAttribute('title', 'Une vue de l’espace se modifie par ses administrateurs.')
		await expect(page.getByTestId('vue-modifier')).toBeDisabled()
		await expect(page.getByTestId('vue-enregistrer')).toBeEnabled()
		await page.getByTestId('vue-enregistrer').click()
		await expect(page.getByTestId('case-publier-vue')).toBeDisabled()
		await capturer(page, 'vues-lectrice-1440', UNITE)

		// Le palier étroit se prend sur une page rechargée à sa largeur, comme les autres preuves de palier : redimensionnée
		// en place, la coquille garde le tiroir de navigation en cours de transition.
		await page.keyboard.press('Escape')
		await page.setViewportSize({ width: 390, height: 900 })
		await page.reload()
		await expect(page.getByTestId('commandes-vues')).toBeVisible()
		await expect(page.getByRole('combobox', { name: 'Vue', exact: true })).toHaveValue(/[0-9a-f-]{36}/)
		const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
		expect(debordement, 'aucun défilement horizontal de page à 390 px').toBeLessThanOrEqual(0)
		const cadre = await page.getByTestId('commandes-vues').boundingBox()
		expect(cadre!.x + cadre!.width, 'les commandes tiennent dans la fenêtre').toBeLessThanOrEqual(390)
		await capturer(page, 'vues-lectrice-390', UNITE)
	})
})
