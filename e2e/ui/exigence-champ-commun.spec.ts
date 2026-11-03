// @verifies CRM-112 (docs/BACKLOG.md) — tranche T3.b : exiger un champ commun dans l'éditeur de workflows, sur la pile réelle —
//           le choix en deux groupes, l'aperçu des effets mesuré par la base, l'exigence posée puis retirée (relues en
//           base), la ligne et sa pilule ; la lectrice refusée par une écriture directe ; quatre paliers
// @verifies docs/SPEC-champs-communs.md §5 et §7 (précisions T3.b) ; docs/DESIGN_SYSTEM.md §5.87, §7, §8
// @verifies CLAUDE.md §10 (le refus prouvé avec le jeton réel de la lectrice), §15, §16 (captures observées)
//
// Le champ de sonde porte la clé `sonde-112-ex` ; la transition « Prospection → Relance » (`…0071`) du workflow par défaut
// est du seed. Après chaque scénario, la clé de service retire l'exigence puis le champ — retrait CONSTATÉ.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const TRANSITION = '5eed0000-0000-4000-8000-000000000071'
const CLE = 'sonde-112-ex'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	const champs = await lireService<{ id: string }>(request, `card_common_fields?select=id&key=eq.${CLE}`)
	for (const { id } of champs) {
		await request.delete(rest(`workflow_transition_required_common_fields?common_field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `card_common_fields?select=id&key=eq.${CLE}`)).toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

/** Le champ commun de sonde, posé par l'administratrice avec son jeton. */
async function poserChamp(request: APIRequestContext): Promise<string> {
	const reponse = await request.post(rest('card_common_fields'), {
		headers: { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' },
		data: { workspace_id: ESPACE, key: CLE, label: 'SIRET (sonde)', type: 'text' },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [champ] = (await reponse.json()) as { id: string }[]
	return champ?.id ?? ''
}

async function ouvrirEditeur(page: Page): Promise<void> {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/workflows')
	await page.getByRole('navigation', { name: 'Choisir un workflow' }).getByRole('button', { name: /^Cycle commercial standard/ }).click()
}

const arete = (page: Page) => page.locator(`[data-testid="transition-exigences"][data-transition="${TRANSITION}"]`)

test.describe('Exiger un champ commun (docs/DESIGN_SYSTEM.md §5.87)', () => {
	test.use({ viewport: { width: 1440, height: 900 } })

	test('choisir le champ de l’affaire, lire son effet, l’exiger, puis ne plus l’exiger — relu en base', async ({ page, request }) => {
		const idChamp = await poserChamp(request)
		await ouvrirEditeur(page)
		await arete(page).scrollIntoViewIfNeeded()
		await arete(page).getByRole('button', { name: 'Exiger un champ' }).click()
		const formulaire = page.getByTestId('formulaire-exigence')
		const choix = formulaire.getByRole('combobox')
		await expect(choix.locator('optgroup')).toHaveCount(2)
		await choix.selectOption(`c:${idChamp}`)

		// L'effet est MESURÉ par la base : les affaires du seed à l'étape « Prospection », sans valeur commune.
		const attendu = await (async () => {
			const placements = await lireService<{ card_id: string }>(
				request,
				`card_placements?select=card_id&current_step_id=eq.5eed0000-0000-4000-8000-000000000061&archived_at=is.null`,
			)
			return new Set(placements.map((p) => p.card_id)).size
		})()
		await expect(formulaire.getByTestId('effets-exigence')).toContainText(String(attendu))
		await capturer(page, 'exigence-commune-choix-xl-1440', UNITE)

		await formulaire.getByRole('button', { name: 'Exiger ce champ' }).click()
		const ligne = arete(page).locator('[data-testid="ligne-exigence"][data-commun="oui"]')
		await expect(ligne).toContainText('SIRET (sonde)')
		await expect(ligne).toContainText('Champ de l’affaire')
		expect(
			await lireService(request, `workflow_transition_required_common_fields?select=transition_id&common_field_id=eq.${idChamp}`),
		).toEqual([{ transition_id: TRANSITION }])
		await capturer(page, 'exigence-commune-ligne-xl-1440', UNITE)

		// Ne plus l'exiger, au clavier.
		await ligne.getByRole('button').focus()
		await page.keyboard.press('Enter')
		const confirmation = page.getByTestId('confirmation-retrait-exigence')
		await expect(confirmation).toContainText('SIRET (sonde)')
		await confirmation.getByRole('button', { name: 'Ne plus exiger' }).click()
		await expect(ligne).toHaveCount(0)
		expect(await lireService(request, `workflow_transition_required_common_fields?select=transition_id&common_field_id=eq.${idChamp}`)).toEqual([])
	})

	test('la lectrice ne peut pas exiger un champ commun : la base refuse l’écriture directe', async ({ request }) => {
		const idChamp = await poserChamp(request)
		const reponse = await request.post(rest('workflow_transition_required_common_fields'), {
			headers: enTetesAuthentifies(await jetonDe(LECTRICE)),
			data: { transition_id: TRANSITION, common_field_id: idChamp },
		})
		expect(reponse.status(), 'la RLS refuse l’exigence à la lectrice').toBe(403)
		expect(await lireService(request, `workflow_transition_required_common_fields?select=transition_id&common_field_id=eq.${idChamp}`)).toEqual([])
	})

	for (const palier of PALIERS) {
		test(`au palier ${palier.nom} : la ligne commune et le formulaire dans le cadre, sans défilement de côté`, async ({ page, request }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			const idChamp = await poserChamp(request)
			const pose = await request.post(rest('workflow_transition_required_common_fields'), {
				headers: enTetesAuthentifies(await jetonDe(ADMIN)),
				data: { transition_id: TRANSITION, common_field_id: idChamp },
			})
			expect(pose.status(), await pose.text()).toBe(201)
			await ouvrirEditeur(page)
			const ligne = arete(page).locator('[data-testid="ligne-exigence"][data-commun="oui"]')
			await ligne.scrollIntoViewIfNeeded()
			const boite = await ligne.boundingBox()
			expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			await capturer(page, `exigence-commune-${palier.nom}`, UNITE)
		})
	}
})
