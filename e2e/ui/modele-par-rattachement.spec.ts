// @verifies CRM-111 (docs/BACKLOG.md) — tranche T6.2 : la prévisualisation d'un modèle choisit le rattachement, à l'écran
// @verifies docs/SPEC-modeles-emails.md §15.4 (le sélecteur « Rattachement » dès deux rattachements, sans option vide,
//           ouvert sur le plus ancien ; absent à un seul), §15.5 (preuves E2E) ; docs/DESIGN_SYSTEM.md §5.39 (révision
//           `CRM-111`) ; docs/SPEC-rattachements.md §7 ; CLAUDE.md §15, §16
//
// Une affaire JETABLE de `refonte` (track « Studio web »), posée par la clé de service avec un montant de 12 000, que
// l'administratrice rattache aussi à `grands-comptes` (track « Conseil & IA ») par `attach_card` ; le second
// rattachement reçoit un montant de 4 321. Le modèle « Relance sans réponse » du seed cite `card.amount`. Elle est
// retirée après le scénario.

import { randomUUID } from 'node:crypto'
import { connecterAvecLeLabs, expect, test } from './fixtures'
import { capturer } from './captures'
import { posterAffaire } from '../affaire'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-111'
const ADMIN = 'admin@p2enjoy.test'
const W = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_INITIALE = '5eed0000-0000-4000-8000-000000000061'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const MODELE_RELANCE = 'Relance sans réponse'
const TITRE = 'Portail partagé des adhérents'
/** Une affaire du seed à UN seul rattachement. */
const AFFAIRE_SIMPLE = 'Migration ERP Sogexia'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

let affaire = ''

test.afterEach(async ({ request }) => {
	if (affaire === '') return
	const retrait = await request.delete(rest(`cards?id=eq.${affaire}`), { headers: enTetesService() })
	expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
	affaire = ''
})

test('la prévisualisation rend le rattachement choisi d’une affaire partagée, et n’offre rien à choisir pour un seul', async ({ page, request }) => {
	affaire = randomUUID()
	const pose = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id: affaire, workspace_id: W, channel_id: REFONTE, workflow_id: WORKFLOW_GLOBAL,
			current_step_id: ETAPE_INITIALE, title: TITRE, amount: 12000,
		},
	})
	expect(pose.status(), await pose.text()).toBe(201)
	const rattache = await request.post(rest('rpc/attach_card'), {
		headers: enTetesAuthentifies(await jetonDe(ADMIN)),
		data: { p_card: affaire, p_channel: GRANDS_COMPTES },
	})
	expect(rattache.status(), await rattache.text()).toBe(200)
	const montant = await request.patch(rest(`card_placements?card_id=eq.${affaire}&channel_id=eq.${GRANDS_COMPTES}`), {
		headers: { ...enTetesService(), Prefer: 'return=minimal' },
		data: { amount: 4321 },
	})
	expect(montant.status(), await montant.text()).toBe(204)

	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/modeles-emails')
	await page.getByTestId('ligne-modele-email').filter({ hasText: MODELE_RELANCE }).getByTestId('previsualiser-modele').click()
	await expect(page.getByTestId('previsualisation-modele')).toBeVisible()
	const rattachement = page.getByTestId('champ-rattachement-previsualisation')

	// Une affaire à un seul rattachement : rien à choisir, aucun sélecteur.
	await page.getByTestId('champ-affaire-previsualisation').selectOption({ label: AFFAIRE_SIMPLE })
	await page.getByTestId('lancer-previsualisation').click()
	await expect(page.getByTestId('rendu-objet')).toHaveText(`Où en est ${AFFAIRE_SIMPLE} ?`)
	await expect(rattachement).toHaveCount(0)

	// L'affaire partagée : le sélecteur paraît, sans option vide, ouvert sur le plus ancien.
	await page.getByTestId('champ-affaire-previsualisation').selectOption({ label: TITRE })
	await expect(rattachement).toBeVisible()
	await expect(rattachement.locator('option')).toHaveText(['Studio web › Refonte de site', 'Conseil & IA › Grands comptes'])
	await expect(rattachement.locator('option:checked')).toHaveText('Studio web › Refonte de site')
	await page.getByTestId('lancer-previsualisation').click()
	await expect(page.getByTestId('rendu-corps')).toContainText('(12000.00 EUR)')

	// Au clavier : le sélecteur suit celui de l'affaire dans l'ordre du focus, et le choix part au rendu.
	await page.getByTestId('champ-affaire-previsualisation').focus()
	await page.keyboard.press('Tab')
	await expect(rattachement).toBeFocused()
	await rattachement.selectOption({ label: 'Conseil & IA › Grands comptes' })
	await page.getByTestId('lancer-previsualisation').click()
	await expect(page.getByTestId('rendu-corps')).toContainText('(4321.00 EUR)')
	await page.getByTestId('previsualisation-modele').scrollIntoViewIfNeeded()
	await capturer(page, 'modele-rattachement-xl-1440', UNITE)

	// Palier 390 : la rangée des sélecteurs passe à la ligne, la page ne défile jamais en largeur. Le palier se prend à
	// l'ouverture de l'écran : redimensionnée sur place, la coquille gardait le tiroir ouvert (vu sur la capture, §5.54).
	await page.setViewportSize({ width: 390, height: 844 })
	await page.reload()
	await expect(page.getByRole('dialog')).toHaveCount(0)
	await page.getByTestId('ligne-modele-email').filter({ hasText: MODELE_RELANCE }).getByTestId('previsualiser-modele').click()
	await page.getByTestId('champ-affaire-previsualisation').selectOption({ label: TITRE })
	await expect(rattachement).toBeVisible()
	await rattachement.selectOption({ label: 'Conseil & IA › Grands comptes' })
	await page.getByTestId('lancer-previsualisation').click()
	await expect(page.getByTestId('rendu-corps')).toContainText('(4321.00 EUR)')
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
	await rattachement.scrollIntoViewIfNeeded()
	await capturer(page, 'modele-rattachement-sm-390', UNITE)
})
