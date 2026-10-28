// @verifies CRM-068 (docs/BACKLOG.md) — tranche T3b : les checklists dans l'éditeur de workflows, sur la vraie pile
// @verifies docs/SPEC-checklists.md §3.1 (points d'une étape, archivage), §3.4 (exigence d'un point de l'étape de départ ;
//           un point archivé reste exigé), §4 (décision 759) ; docs/DESIGN_SYSTEM.md §5.70 bis ; CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// UN WORKFLOW JETABLE, et non celui du seed : les gestes de l'éditeur écrivent, et une preuve qui modifierait le
// workflow par défaut ou celui de la démonstration fausserait les autres specs de la même pile. Tout est retiré à la fin,
// par la clé de service.

import { randomUUID } from 'node:crypto'
import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { connecterAvecLeLabs, expect, test } from './fixtures'
import { capturer } from './captures'
import { posterAffaire } from '../affaire'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const NOEUD_PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOEUD_RELANCE = '5eed0000-0000-4000-8000-000000000042'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function inserer(requete: APIRequestContext, table: string, ligne: Record<string, unknown>): Promise<void> {
	const reponse = await posterAffaire(requete, rest(table), { headers: enTetesService(), data: ligne })
	expect(reponse.status(), `${table} : ${await reponse.text()}`).toBe(201)
}

async function lire<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as T
}

test.describe('l’éditeur des checklists (docs/DESIGN_SYSTEM.md §5.70 bis)', () => {
	test('ajouter, réordonner, renommer, exiger, archiver un point — la base porte chaque geste', async ({ page, request }) => {
		const ids = { workflow: randomUUID(), prospection: randomUUID(), relance: randomUUID(), transition: randomUUID() }
		const nom = `ZZ checklists ${ids.workflow.slice(0, 8)}`
		await inserer(request, 'workflows', { id: ids.workflow, workspace_id: ESPACE, name: nom, scope: 'global', is_default: false })
		try {
			await inserer(request, 'workflow_steps', { id: ids.prospection, workflow_id: ids.workflow, workspace_id: ESPACE, node_id: NOEUD_PROSPECTION, position: 1, is_initial: true })
			await inserer(request, 'workflow_steps', { id: ids.relance, workflow_id: ids.workflow, workspace_id: ESPACE, node_id: NOEUD_RELANCE, position: 2, is_initial: false })
			await inserer(request, 'workflow_transitions', { id: ids.transition, workflow_id: ids.workflow, workspace_id: ESPACE, from_step_id: ids.prospection, to_step_id: ids.relance, label: 'Relancer' })

			await page.setViewportSize({ width: 1440, height: 1100 })
			await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
			await page.goto('/reglages/workflows')
			await page.getByRole('button', { name: new RegExp(`^${nom}`) }).click()
			const bloc = page.getByTestId('bloc-checklists-etapes')
			const prospection = bloc.locator(`[data-testid="checklist-etape"][data-etape="${ids.prospection}"]`)
			await expect(prospection).toContainText('Aucun point pour cette étape.')

			// Deux points ajoutés, au clavier : le champ prend le focus, `Entrée` envoie.
			for (const libelle of ['Budget validé', 'Décideur identifié']) {
				await prospection.getByRole('button', { name: 'Ajouter un point à l’étape Prospection' }).click()
				const champ = page.getByLabel('Libellé du point')
				await expect(champ).toBeFocused()
				await champ.fill(libelle)
				await champ.press('Enter')
				await expect(prospection.getByTestId('checklist-point-etape').filter({ hasText: libelle })).toHaveCount(1)
			}
			const ordre = () => prospection.getByTestId('checklist-libelle-point').allTextContents()
			await expect.poll(async () => (await ordre()).map((t) => t.trim())).toEqual(['Budget validé', 'Décideur identifié'])

			// Réordonner : « Monter » le second ; la base porte la position, la liste relue suit.
			await prospection.getByRole('button', { name: 'Monter le point Décideur identifié' }).click()
			await expect.poll(async () => (await ordre())[0]).toContain('Décideur identifié')
			const points = await lire<{ label: string; position: number }[]>(request, `workflow_step_checklist_items?workflow_id=eq.${ids.workflow}&select=label,position&order=position`)
			expect(points.map((p) => p.label)).toEqual(['Décideur identifié', 'Budget validé'])

			// Renommer : le champ prérempli, la base renomme.
			await prospection.getByRole('button', { name: 'Renommer le point Budget validé' }).click()
			const renommage = page.getByLabel('Nouveau libellé')
			await expect(renommage).toHaveValue('Budget validé')
			await renommage.fill('Budget connu')
			await renommage.press('Enter')
			await expect(prospection).toContainText('Budget connu')

			// Exiger « Budget connu » pour Prospection → Relance : le sélecteur ne propose que les points de l'étape de départ.
			const arete = page.locator(`[data-testid="exigences-points"][data-transition="${ids.transition}"]`)
			await arete.getByTestId('exiger-point').click()
			const select = page.getByLabel('Point', { exact: true })
			await expect(select).toBeFocused()
			await expect(select.locator('option')).toHaveText(['Choisir un point…', 'Décideur identifié', 'Budget connu'])
			await select.selectOption({ label: 'Budget connu' })
			await page.getByRole('button', { name: 'Exiger', exact: true }).click()
			await expect(arete.getByTestId('exigence-point')).toHaveText(/Budget connu/)
			const exigences = await lire<unknown[]>(request, `workflow_transition_required_checklist_items?transition_id=eq.${ids.transition}&select=step_item_id`)
			expect(exigences).toHaveLength(1)
			await bloc.scrollIntoViewIfNeeded()
			await capturer(page, 'editeur-checklists-1440', 'CRM-068')

			// Archiver le point exigé : la pilule paraît, et l'exigence le dit — un point archivé reste exigé (§3.4).
			await prospection.getByRole('button', { name: 'Archiver le point Budget connu' }).click()
			await expect(prospection.locator('[data-archive="true"]')).toContainText('Archivé')
			await expect(arete.getByTestId('exigence-point')).toContainText('Toujours exigé')
			await arete.scrollIntoViewIfNeeded()
			await capturer(page, 'editeur-checklists-archive-exige-1440', 'CRM-068')

			// Ne plus l'exiger.
			await arete.getByRole('button', { name: /^Ne plus exiger le point Budget connu/ }).click()
			await expect(arete.getByTestId('exigences-points-aucun')).toBeVisible()
			expect(await lire<unknown[]>(request, `workflow_transition_required_checklist_items?transition_id=eq.${ids.transition}&select=step_item_id`)).toHaveLength(0)

			// À 390 px, rechargé : la page ne défile pas horizontalement.
			await page.setViewportSize({ width: 390, height: 900 })
			await page.reload()
			await page.getByRole('button', { name: new RegExp(`^${nom}`) }).click()
			await page.getByTestId('bloc-checklists-etapes').scrollIntoViewIfNeeded()
			// Le libellé tient sur sa ligne : il ne se coupe plus lettre à lettre sous les commandes (défaut vu en capture).
			const hauteur = await page.getByTestId('checklist-libelle-point').first().evaluate((n) => n.getBoundingClientRect().height)
			expect(hauteur, 'un libellé court tient sur une ligne à 390 px').toBeLessThan(40)
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'aucun défilement horizontal de page à 390 px').toBeLessThanOrEqual(0)
			await capturer(page, 'editeur-checklists-390', 'CRM-068')
		} finally {
			await request.delete(rest(`workflows?id=eq.${ids.workflow}`), { headers: enTetesService() })
		}
	})

	test('la lectrice voit les checklists des étapes, commandes éteintes et lisibles', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 1100 })
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto('/reglages/workflows')
		await page.getByRole('button', { name: /^Cycle commercial — checklists/ }).click()
		const bloc = page.getByTestId('bloc-checklists-etapes')
		await expect(bloc.getByTestId('checklist-point-etape')).toHaveCount(3)
		await expect(bloc.getByRole('button', { name: 'Ajouter un point à l’étape Prospection' })).toBeDisabled()
		await expect(bloc.getByRole('button', { name: 'Renommer le point Besoin confirmé' })).toBeDisabled()
		await expect(page.getByTestId('exiger-point').first()).toBeDisabled()
	})
})
