// @verifies CRM-111 (docs/BACKLOG.md) — tranche T7.5 : la pastille « aussi rattachée à N » sur le board et dans la vue
//           liste, l'infobulle qui nomme les autres channels au focus clavier, et rien pour qui ne lit pas l'autre channel
// @verifies docs/SPEC-rattachements.md §8 ; docs/DESIGN_SYSTEM.md §5.85, §5.58 ; CLAUDE.md §15, §16
//
// Une affaire JETABLE de `refonte` (track « Studio web »), posée par la clé de service, que l'administratrice rattache
// aussi à `grands-comptes` (track « Conseil & IA », fermé à la lectrice) par `attach_card`. Retirée après chaque scénario.

import { randomUUID } from 'node:crypto'
import { connecterAvecLeLabs, expect, test } from './fixtures'
import { capturer } from './captures'
import { posterAffaire } from '../affaire'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-111'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const W = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_INITIALE = '5eed0000-0000-4000-8000-000000000061'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const TITRE = 'Portail partagé des adhérents'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

let affaire = ''

test.beforeEach(async ({ request }) => {
	affaire = randomUUID()
	const pose = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id: affaire, workspace_id: W, channel_id: REFONTE, workflow_id: WORKFLOW_GLOBAL, current_step_id: ETAPE_INITIALE, title: TITRE },
	})
	expect(pose.status(), await pose.text()).toBe(201)
	const rattache = await request.post(rest('rpc/attach_card'), {
		headers: enTetesAuthentifies(await jetonDe(ADMIN)),
		data: { p_card: affaire, p_channel: GRANDS_COMPTES },
	})
	expect(rattache.status(), await rattache.text()).toBe(200)
})

test.afterEach(async ({ request }) => {
	const retrait = await request.delete(rest(`cards?id=eq.${affaire}`), { headers: enTetesService() })
	expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
})

test('sur le board, la carte porte « +1 », et le focus clavier nomme l’autre channel', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/studio-web/refonte')
	const carte = page.locator(`[data-testid="carte-card"][data-card="${affaire}"]`)
	const pastille = carte.getByTestId('pastille-aussi-rattachee')
	await expect(pastille).toHaveText('+1')
	await expect(pastille).toHaveAccessibleName('Aussi rattachée à 1 autre channel')
	await pastille.focus()
	await page.keyboard.press('Shift+Tab')
	await page.keyboard.press('Tab')
	await expect(pastille).toBeFocused()
	await expect(page.getByTestId('infobulle')).toContainText('Aussi rattachée à')
	await expect(page.getByTestId('infobulle')).toContainText('Conseil & IA › Grands comptes')
	await carte.scrollIntoViewIfNeeded()
	await capturer(page, 'board-aussi-rattachee-xl-1440', UNITE)

	// Le board de l'autre channel montre la même affaire, avec l'autre chemin.
	await page.goto('/tracks/conseil-ia/grands-comptes')
	const ailleurs = page.locator(`[data-testid="carte-card"][data-card="${affaire}"]`).getByTestId('pastille-aussi-rattachee')
	await expect(ailleurs).toHaveText('+1')

	// Palier 390 : la carte garde sa largeur, la pastille passe à la ligne avec les autres.
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/tracks/studio-web/refonte')
	await expect(pastille).toBeVisible()
	await carte.scrollIntoViewIfNeeded()
	await capturer(page, 'board-aussi-rattachee-sm-390', UNITE)
})

test('dans la vue liste, la cellule « Affaire » porte la pastille sans changer la hauteur de la ligne', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/studio-web/refonte/liste')
	const ligne = page.locator(`[data-testid="ligne-card"][data-card="${affaire}"]`)
	await expect(ligne.getByTestId('pastille-aussi-rattachee')).toHaveText('+1')
	// Une ligne du seed sans pastille : la comparaison a lieu, elle n'est pas conditionnelle.
	const autre = page.getByTestId('ligne-card').filter({ hasNot: page.getByTestId('pastille-aussi-rattachee') }).first()
	await expect(autre).toBeVisible()
	expect(Math.round((await ligne.boundingBox())!.height)).toBe(Math.round((await autre.boundingBox())!.height))
	await capturer(page, 'liste-aussi-rattachee-xl-1440', UNITE)
})

test('la lectrice, qui ne lit pas « Grands comptes », ne voit aucune pastille : rien ne lui révèle l’autre rattachement', async ({ page }) => {
	await connecterAvecLeLabs(page, LECTRICE)
	await page.goto('/tracks/studio-web/refonte')
	const carte = page.locator(`[data-testid="carte-card"][data-card="${affaire}"]`)
	await expect(carte).toBeVisible()
	await expect(carte.getByTestId('pastille-aussi-rattachee')).toHaveCount(0)
})
