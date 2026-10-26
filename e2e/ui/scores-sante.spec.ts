// @verifies CRM-066 (docs/BACKLOG.md) — tranche 4 : les deux scores de santé sur la carte du board et sur la fiche
// @verifies docs/SPEC-analytique.md §13.4, §13.6 ; docs/DESIGN_SYSTEM.md §5.65 (pastilles, palier écrit, détail, aucune
//           pastille pour une affaire décidée), §7 (paliers d'écran) ; docs/JOURNAL.md décisions 723 et 724 ;
//           CLAUDE.md §16 (vérification visuelle)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// LE SEED SUFFIT, ET IL EST LU, PAS ÉCRIT : « Audit sécurité applicative » est en danger pour la dynamique (étape
// figée, action en retard, dernier contact ancien de 40 jours — docs/SPEC-seed.md §24) ; « Socle analytique — Vertuo »
// est gagnée, donc sans score. Aucun scénario n'écrit.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-066'
const BOARD = '/tracks/conseil-ia/grands-comptes'
const FICHE_AUDIT = `${BOARD}/cards/5eed0000-0000-4000-8000-0000000000c3`

/** La carte du board — l'élément qui porte `data-card`, non la colonne qui l'englobe. */
async function carte(page: Page, titre: string) {
	return page.locator('[data-card]').filter({ has: page.getByRole('link', { name: titre, exact: true }) })
}

test.describe('les scores de santé (docs/SPEC-analytique.md §13)', () => {
	test('la carte du board porte ses deux pastilles, le palier écrit dans leur nom ; une affaire gagnée n’en porte aucune', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(BOARD)
		const audit = await carte(page, 'Audit sécurité applicative')
		await expect(audit.getByTestId('score-dynamique')).toHaveAttribute('data-palier', 'danger')
		await expect(audit.getByRole('img', { name: /^Dynamique \d+ sur 100, en danger$/ })).toBeVisible()
		await expect(audit.getByRole('img', { name: /^Santé \d+ sur 100, (sain|à surveiller|en danger)$/ })).toBeVisible()

		const gagnee = await carte(page, 'Socle analytique — Vertuo')
		await expect(gagnee).toBeVisible()
		await expect(gagnee.getByTestId('scores-sante-carte')).toHaveCount(0)
		await audit.scrollIntoViewIfNeeded()
		await capturer(page, 'scores-sante-board-1440', UNITE)
	})

	test('la fiche écrit chaque score, son palier et son détail', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(FICHE_AUDIT)
		const bloc = page.getByTestId('bloc-sante')
		await expect(bloc.getByRole('heading', { name: 'Santé de l’affaire' })).toBeVisible()
		const dynamique = bloc.getByTestId('sante-dynamique')
		await expect(dynamique.getByText('en danger', { exact: true })).toBeVisible()
		const penalites = dynamique.getByRole('list', { name: 'Détail de la dynamique' })
		await expect(penalites.getByText(/^Étape figée depuis \d+ jours \(seuil \d+\)$/)).toBeVisible()
		await expect(penalites.getByText(/^Prochaine action en retard de \d+ jours$/)).toBeVisible()
		await expect(penalites.getByText(/^Aucun contact depuis \d+ jours$/)).toBeVisible()
		await expect(penalites.getByText('−30')).toHaveCount(2)
		await expect(penalites.getByText('−25')).toBeVisible()

		const signaux = bloc.getByRole('list', { name: 'Détail de la santé commerciale' })
		await expect(signaux.getByRole('listitem')).toHaveCount(4)
		await expect(signaux.getByText('Probabilité de l’étape')).toBeVisible()
		await expect(signaux.getByText(/^\d+\/100, poids 40 %$/)).toBeVisible()
		await bloc.scrollIntoViewIfNeeded()
		await capturer(page, 'scores-sante-fiche-1440', UNITE)
	})

	test('les quatre paliers d’écran : les pastilles tiennent dans la carte, le bloc dans la fiche', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(BOARD)
			const audit = await carte(page, 'Audit sécurité applicative')
			const scores = audit.getByTestId('scores-sante-carte')
			await scores.scrollIntoViewIfNeeded()
			const boiteCarte = await audit.boundingBox()
			const boiteScores = await scores.boundingBox()
			expect(boiteScores!.x + boiteScores!.width).toBeLessThanOrEqual(boiteCarte!.x + boiteCarte!.width + 1)
			await capturer(page, `scores-sante-board-${palier.nom}`, UNITE)

			await page.goto(FICHE_AUDIT)
			const bloc = page.getByTestId('bloc-sante')
			await bloc.scrollIntoViewIfNeeded()
			await expect(bloc).toBeVisible()
			await capturer(page, `scores-sante-fiche-${palier.nom}`, UNITE)
		}
	})
})
