// @verifies CRM-111 (docs/BACKLOG.md) — tranche T7.1 : la fiche s'ouvre sur le rattachement du channel de l'adresse, et
//           une adresse sans rattachement lisible propose les rattachements lisibles
// @verifies docs/SPEC-rattachements.md §8.1 (décision 823, INC-065) ; docs/DESIGN_SYSTEM.md §5.81 ; CLAUDE.md §15, §16
//
// Une affaire JETABLE de `refonte` (track « Studio web »), posée par la clé de service avec un montant de 12 000, que
// l'administratrice rattache aussi à `grands-comptes` (track « Conseil & IA », fermé à la lectrice) par `attach_card` ; le
// second rattachement reçoit un montant de 4 321. Elle est retirée après chaque scénario.

import { randomUUID } from 'node:crypto'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
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
const fiche = (chemin: string) => `/tracks/${chemin}/cards/${affaire}`

test.use({ viewport: { width: 1440, height: 900 } })

let affaire = ''

async function poser(requete: APIRequestContext): Promise<void> {
	affaire = randomUUID()
	const pose = await posterAffaire(requete, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id: affaire, workspace_id: W, channel_id: REFONTE, workflow_id: WORKFLOW_GLOBAL,
			current_step_id: ETAPE_INITIALE, title: TITRE, amount: 12000,
		},
	})
	expect(pose.status(), await pose.text()).toBe(201)
	const rattache = await requete.post(rest('rpc/attach_card'), {
		headers: enTetesAuthentifies(await jetonDe(ADMIN)),
		data: { p_card: affaire, p_channel: GRANDS_COMPTES },
	})
	expect(rattache.status(), await rattache.text()).toBe(200)
	const montant = await requete.patch(rest(`card_placements?card_id=eq.${affaire}&channel_id=eq.${GRANDS_COMPTES}`), {
		headers: { ...enTetesService(), Prefer: 'return=minimal' },
		data: { amount: 4321 },
	})
	expect(montant.status(), await montant.text()).toBe(204)
}

test.afterEach(async ({ request }) => {
	if (affaire === '') return
	const retrait = await request.delete(rest(`cards?id=eq.${affaire}`), { headers: enTetesService() })
	expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
	affaire = ''
})

test('la fiche s’ouvre sur le rattachement de l’adresse, et une adresse sans rattachement propose les deux', async ({ page, request }) => {
	await poser(request)
	await connecterAvecLeLabs(page, ADMIN)

	// Chaque adresse ouvre SON rattachement : le montant de l'en-tête est le sien.
	await page.goto(fiche('studio-web/refonte'))
	await expect(page.getByTestId('entete-card-montant')).toContainText('12')
	await expect(page.getByTestId('entete-card-montant')).not.toContainText('4')
	await page.goto(fiche('conseil-ia/grands-comptes'))
	await expect(page.getByTestId('entete-card-montant')).toContainText('4')
	await expect(page.getByTestId('entete-card-montant')).toContainText('321')

	// Un channel où elle n'est pas rattachée : l'état le dit, et propose ses deux rattachements, dans l'ordre des tracks.
	await page.goto(fiche('studio-web/maintenance'))
	const ailleurs = page.getByTestId('affaire-ailleurs')
	await expect(page.getByText('Cette affaire n’est pas rattachée à ce channel')).toBeVisible()
	await expect(ailleurs.getByRole('link')).toHaveText(['Conseil & IA › Grands comptes', 'Studio web › Refonte de site'])
	await expect(page.getByTestId('entete-card')).toHaveCount(0)
	await capturer(page, 'fiche-ailleurs-xl-1440', UNITE)

	// Le lien ouvre la fiche à l'adresse du rattachement.
	await ailleurs.getByRole('link', { name: 'Studio web › Refonte de site' }).click()
	await expect(page).toHaveURL(new RegExp(`/tracks/studio-web/refonte/cards/${affaire}$`))
	await expect(page.getByTestId('entete-card-montant')).toContainText('12')

	// Palier 390 : les liens passent à la ligne, la page ne défile jamais en largeur.
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto(fiche('studio-web/maintenance'))
	await expect(ailleurs).toBeVisible()
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
	await capturer(page, 'fiche-ailleurs-sm-390', UNITE)
})

test('la lectrice, fermée à « Conseil & IA », ne voit à l’adresse de « Grands comptes » que le rattachement qu’elle lit', async ({ page, request }) => {
	await poser(request)
	await connecterAvecLeLabs(page, LECTRICE)
	await page.goto(fiche('conseil-ia/grands-comptes'))
	const ailleurs = page.getByTestId('affaire-ailleurs')
	await expect(ailleurs.getByRole('link')).toHaveText(['Studio web › Refonte de site'])
	await expect(page.getByText('Grands comptes', { exact: true })).toHaveCount(0)
	await capturer(page, 'fiche-ailleurs-lectrice-xl-1440', UNITE)
})
