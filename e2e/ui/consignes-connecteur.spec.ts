// @verifies CRM-165 (docs/BACKLOG.md) — tranche T3 : le bloc « Consignes aux assistants » sur la vraie pile — le texte du
//           seed et son auteur, le bloc avant le journal des appels, l'écriture à la souris (constatée en base, normalisée,
//           le geste au journal de la plateforme sans le texte), le compteur, l'annonce, l'écriture et le socle déplié au
//           clavier, les quatre paliers sans défilement horizontal, et l'administratrice d'espace qui n'y entre pas
// @verifies docs/SPEC-mcp.md §18.3, §18.5, §18.7 ; docs/DESIGN_SYSTEM.md §5.114 ; docs/SPEC-seed.md §56 ; CLAUDE.md §10 (le
//           refus vient de la base), §16 (captures)
//
// Les gestes écrivent : le texte d'origine (celui du seed) est relu avant, et rendu à la fin par la vraie fonction, sous le
// jeton de Sabine.

import { execFileSync } from 'node:child_process'
import { conteneur } from '../conteneur'
import { URL_API, enTetesAuthentifies, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'

const UNITE = 'CRM-165'
const SABINE = 'plateforme@p2enjoy.test'
const rpc = (nom: string) => `${URL_API}/rest/v1/rpc/${nom}`

const sql = (requete: string): string =>
	execFileSync('docker', ['exec', conteneur('db'), 'psql', '-U', 'postgres', '-d', 'postgres', '-qtAc', requete], {
		encoding: 'utf8',
	}).trim()

async function sansDefilementHorizontal(page: Page, contexte: string): Promise<void> {
	const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debord, `${contexte} : la page ne défile jamais horizontalement (§7)`).toBeLessThanOrEqual(0)
}

async function poser(request: APIRequestContext, texte: string): Promise<void> {
	const reponse = await request.post(rpc('platform_set_connector_instructions'), {
		headers: { ...enTetesAuthentifies(await jetonDe(SABINE)), 'Content-Type': 'application/json' },
		data: { p_body: texte },
	})
	expect(reponse.status(), await reponse.text()).toBe(204)
}

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 900 } })

let texteDOrigine = ''

test.beforeAll(() => {
	texteDOrigine = sql('select body from public.connector_instructions')
	expect(texteDOrigine, 'le seed fait écrire les consignes par Sabine (docs/SPEC-seed.md §56)').toMatch(/^Avant de créer une affaire/)
})

test.afterAll(async ({ request }) => {
	await poser(request, texteDOrigine)
})

test.describe('Plateforme ▸ Connecteur MCP ▸ Consignes aux assistants (docs/DESIGN_SYSTEM.md §5.114)', () => {
	test('à la souris : le texte du seed, puis un texte écrit, normalisé en base et inscrit au journal sans son contenu', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE)
		await page.goto('/plateforme/mcp')
		const bloc = page.getByTestId('consignes-connecteur')
		const champ = bloc.getByRole('textbox', { name: 'Consignes de la plateforme' })
		await expect(champ).toHaveValue(texteDOrigine)
		await expect(bloc.getByTestId('consignes-auteur')).toHaveText(/^Modifiées par Sabine .+ le /)
		// La place : après « Accorder des droits », avant le journal des appels.
		const titres = await page.getByTestId('plateforme-mcp').locator('h2').allTextContents()
		expect(titres.indexOf('Consignes aux assistants')).toBe(titres.indexOf('Journal des appels') - 1)
		await capturer(page, 'consignes-seed-xl-1440', UNITE)

		const lignesAvant = Number(sql("select count(*) from public.plateforme_journal where geste = 'connector_instructions_set'"))
		await champ.fill('  Preuve CRM-165 : citez toujours l’affaire concernée.\r\n')
		await expect(bloc.getByTestId('consignes-compteur')).toHaveText(/^5\d \/ 4\s000 caractères$/)
		await bloc.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(bloc.getByTestId('annonce-consignes')).toHaveText(
			'Consignes enregistrées. Elles valent à la prochaine connexion d’un assistant.',
		)
		await expect(champ).toHaveValue('Preuve CRM-165 : citez toujours l’affaire concernée.')
		await expect(bloc.getByTestId('consignes-auteur')).toHaveText(/^Modifiées par Sabine .+ le /)
		await capturer(page, 'consignes-enregistrees-xl-1440', UNITE)

		// En base : le texte normalisé, son autrice ; au journal, une ligne de plus, les longueurs et jamais le texte.
		expect(sql("select body || '|' || updated_by from public.connector_instructions")).toBe(
			'Preuve CRM-165 : citez toujours l’affaire concernée.|5eed0000-0000-4000-8000-000000000018',
		)
		expect(Number(sql("select count(*) from public.plateforme_journal where geste = 'connector_instructions_set'"))).toBe(lignesAvant + 1)
		const cible = sql("select cible::text from public.plateforme_journal where geste = 'connector_instructions_set' order by id desc limit 1")
		expect(JSON.parse(cible)).toEqual({ length_before: texteDOrigine.length, length_after: 52 })

		// Le journal de la plateforme le dit en mots.
		await page.goto('/plateforme/journal')
		const ligne = page.getByTestId('ligne-journal').first()
		await expect(ligne).toContainText('Consignes du connecteur modifiées')
		await expect(ligne).toContainText('52 caractères')
		await expect(ligne).not.toContainText('Preuve CRM-165')
	})

	test('au clavier : écrire, enregistrer, puis déplier les consignes fixes', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE)
		await page.goto('/plateforme/mcp')
		const bloc = page.getByTestId('consignes-connecteur')
		const champ = bloc.getByRole('textbox', { name: 'Consignes de la plateforme' })
		await expect(champ).toBeVisible()
		await champ.focus()
		await page.keyboard.press('ControlOrMeta+a')
		await page.keyboard.type('Preuve clavier.')
		await page.keyboard.press('Tab')
		await expect(bloc.getByRole('button', { name: 'Enregistrer' })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(bloc.getByTestId('annonce-consignes')).toHaveText(/^Consignes enregistrées\./)
		expect(sql('select body from public.connector_instructions')).toBe('Preuve clavier.')

		// Le socle : replié par défaut, déplié par `Entrée` sur son résumé ; le texte publié par le service `mcp`.
		const socle = bloc.getByTestId('consignes-socle')
		await expect(socle).not.toHaveAttribute('open')
		const resume = socle.locator('summary')
		await resume.focus()
		await expect(resume).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(socle).toHaveAttribute('open', '')
		await expect(socle.locator('pre')).toHaveText(sql('select base from public.connector_instructions'))
		await expect(socle).toContainText(/Publiées par le connecteur le /)
		await capturer(page, 'consignes-socle-deplie-xl-1440', UNITE)
	})

	test('les quatre paliers, sans défilement horizontal, le socle déplié', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/plateforme/mcp')
			const bloc = page.getByTestId('consignes-connecteur')
			await expect(bloc.getByTestId('consignes-texte')).toBeVisible()
			await bloc.getByTestId('consignes-socle').locator('summary').click()
			await expect(bloc.getByTestId('consignes-socle').locator('pre')).toBeVisible()
			await sansDefilementHorizontal(page, `consignes ${palier.nom}`)
			await bloc.scrollIntoViewIfNeeded()
			await capturer(page, `consignes-${palier.nom}`, UNITE)
		}
	})

	test('une administratrice d’espace n’y entre pas : l’écran refuse, sans lire les consignes', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/plateforme/mcp')
		await expect(page.getByTestId('etat-refus')).toContainText('réservée aux superadministrateurs')
		await expect(page.getByTestId('consignes-connecteur')).toHaveCount(0)
	})
})
