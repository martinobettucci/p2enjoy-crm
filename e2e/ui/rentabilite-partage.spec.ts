// @verifies CRM-111 (docs/BACKLOG.md) — tranches T5.1 et T5.2 : une affaire partagée dans « Rentabilité », à l'écran
// @verifies docs/DESIGN_SYSTEM.md §5.60 (« Une affaire partagée » : la pilule du §5.54, la mention sous le tableau, rien
//           dans le bloc de la fiche) ; docs/SPEC-recettes.md §6.3 ; docs/SPEC-rattachements.md §6 ; CLAUDE.md §15, §16
//
// Une affaire JETABLE de `refonte` (track « Studio web »), posée par la clé de service avec une ligne de recette, que
// l'administratrice rattache aussi à `maintenance` (même track) par `attach_card`. Elle est retirée après le scénario.

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
const MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'
const TITRE = 'Portail partagé des adhérents'
const PARTAGE = /^Affaire partagée : elle est rattachée à plusieurs channels/

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

let affaire = ''

test.afterEach(async ({ request }) => {
	if (affaire === '') return
	const retrait = await request.delete(rest(`cards?id=eq.${affaire}`), { headers: enTetesService() })
	expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
	affaire = ''
})

test('une affaire partagée paraît sous ses deux channels, marquée, et le sous-total du track la compte une fois', async ({ page, request }) => {
	affaire = randomUUID()
	const pose = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id: affaire, workspace_id: W, channel_id: REFONTE, workflow_id: WORKFLOW_GLOBAL, current_step_id: ETAPE_INITIALE, title: TITRE },
	})
	expect(pose.status(), await pose.text()).toBe(201)
	const recette = await request.post(rest('card_revenues'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
		data: { card_id: affaire, label: 'Acompte', estimated_amount: 12000 },
	})
	expect(recette.status(), await recette.text()).toBe(201)
	const rattache = await request.post(rest('rpc/attach_card'), {
		headers: enTetesAuthentifies(await jetonDe(ADMIN)),
		data: { p_card: affaire, p_channel: MAINTENANCE },
	})
	expect(rattache.status(), await rattache.text()).toBe(200)

	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/rentabilite?vue=prevu')
	const lignes = page.locator(`[data-testid="rentab-ligne-affaire"][data-card="${affaire}"]`)
	await expect(lignes).toHaveCount(2)
	for (const ligne of await lignes.all()) {
		await expect(ligne.getByRole('img', { name: PARTAGE })).toBeVisible()
		await expect(ligne).toContainText('12 000')
	}
	await expect(page.getByTestId('rentab-partagee-mention')).toHaveText(
		'Une affaire rattachée à plusieurs channels paraît sous chacun ; le sous-total d’un track et le total ne comptent ses montants qu’une fois.',
	)
	await lignes.first().scrollIntoViewIfNeeded()
	await capturer(page, 'rentabilite-partage-xl-1440', UNITE)

	// La fiche lit UNE affaire : son bloc « Rentabilité » rend ses montants une fois, sans marque ni mention.
	await page.goto(`/tracks/studio-web/refonte/cards/${affaire}`)
	const bloc = page.getByTestId('bloc-rentabilite-card')
	await expect(bloc).toBeVisible()
	await expect(bloc.getByTestId('temps-partagee')).toHaveCount(0)
	await expect(bloc).toContainText('12 000')
})
