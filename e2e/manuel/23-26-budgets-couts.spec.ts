// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.5 : les images des chapitres 23 à 26 — les budgets d'un track, ses coûts,
//       le détail d'un budget, les coûts de tout l'espace
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitres 23 à 26 ; docs/SPEC-costs.md (les budgets, les
//       occurrences, la clôture — CRM-084 ; les écrans de coûts — CRM-086 ; l'onglet « À saisir »)
//
// Les budgets, les occurrences et les dépenses sont ceux du seed — le track « Studio web » et son budget clôturé
// « Salon du web 2025 ». Aucun budget n'est créé ni clôturé : les formulaires et les confirmations sont montrés puis
// annulés.

import { expect, test, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, VIEWER, connecterAvecLeLabs } from './outils'

const BUDGETS = 'les-budgets-d-un-track'
const COUTS_TRACK = 'les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense'
const DETAIL = 'le-detail-d-un-budget-occurrence-par-occurrence-ligne-par-ligne'
const CUMUL = 'les-couts-de-tout-l-espace-de-travail-un-cumul-par-track'

async function ouvrirBudgets(page: Page) {
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Déplier Studio web' }).click()
	const bloc = page.getByRole('region', { name: 'Budgets du track Studio web' })
	await expect(bloc).toBeVisible()
	return bloc
}

test('les budgets d’un track : la liste, les clôturés, la création, la clôture', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	const bloc = await ouvrirBudgets(page)
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'budgets-du-track', cibles: [bloc.getByTestId('tableau-budgets')] })
	const occurrences = bloc.getByTestId('cellule-occurrences').first()
	if ((await occurrences.count()) > 0)
		await illustrer(page, { chapitre: BUDGETS, section: 'les-occurrences-d-un-budget-recurrent', nom: 'occurrences', cibles: [occurrences.locator('xpath=ancestor::tr[1]')] })
	await bloc.getByLabel('Afficher les budgets clôturés').check()
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'budgets-clotures', cibles: [bloc.getByLabel('Afficher les budgets clôturés'), bloc.getByTestId('tableau-budgets')] })
	await bloc.getByLabel('Afficher les budgets clôturés').uncheck()

	// Le bouton cède la place au formulaire : il se photographie avant le clic.
	const nouveau = bloc.getByRole('button', { name: 'Nouveau budget' })
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'bouton-nouveau-budget', cibles: [nouveau] })
	await nouveau.click()
	const formulaire = bloc.getByTestId('formulaire-budget')
	await expect(formulaire).toBeVisible()
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'nouveau-budget', cibles: [formulaire] })
	await formulaire.getByRole('button', { name: 'Annuler' }).click()

	const cloturer = bloc.getByRole('button', { name: /^Clôturer le budget / }).first()
	await cloturer.click()
	const confirmation = bloc.getByTestId('confirmation-cloture-budget')
	await expect(confirmation).toBeVisible()
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'cloturer', cibles: [confirmation] })
	await confirmation.getByRole('button', { name: 'Annuler' }).click()
})

test('les coûts d’un track, et leurs états', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/studio-web/couts')
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
	await illustrer(page, { chapitre: COUTS_TRACK, section: null, nom: 'couts-du-track', cibles: [], pleinePage: true })
	const onglets = page.getByRole('tablist').or(page.getByRole('navigation', { name: /Coûts/ })).first()
	if ((await onglets.count()) > 0)
		await illustrer(page, { chapitre: COUTS_TRACK, section: 'deux-onglets-et-le-second-est-celui-ou-l-on-saisit', nom: 'onglets', cibles: [onglets] })
	const phrase = page.getByText(/ligne\(s\) sans coût réel saisi, pour/).first()
	if ((await phrase.count()) > 0)
		await illustrer(page, { chapitre: COUTS_TRACK, section: 'la-phrase-sous-le-graphique-et-pourquoi-elle-compte', nom: 'phrase', cibles: [phrase] })
	await illustrer(page, { chapitre: COUTS_TRACK, section: 'ce-que-cet-ecran-ne-fait-pas', nom: 'onglet-couts', cibles: [page.getByTestId('onglet-couts-track')] })

	await page.goto('/tracks/formation/couts')
	const vide = page.getByTestId('etat-vide').first()
	if ((await vide.count()) > 0) await illustrer(page, { chapitre: COUTS_TRACK, section: 'les-etats-que-vous-pouvez-rencontrer', nom: 'sans-budget', cibles: [vide] })
	await page.goto('/tracks/ce-track-nexiste-pas/couts')
	const introuvable = page.getByText('Track introuvable', { exact: true }).first()
	await expect(introuvable).toBeVisible()
	await illustrer(page, { chapitre: COUTS_TRACK, section: 'les-etats-que-vous-pouvez-rencontrer', nom: 'track-introuvable', cibles: [introuvable] })
})

test('le détail d’un budget, et ses états', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/studio-web/couts/5eed0000-0000-4000-8000-0000000000c2')
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
	await illustrer(page, { chapitre: DETAIL, section: null, nom: 'detail', cibles: [], pleinePage: true })
	// Le filtre et le budget clôturé : `e2e/manuel/23-33-complements.spec.ts`.
	await page.goto('/tracks/studio-web/couts/00000000-0000-4000-8000-000000000000')
	const introuvable = page.getByText('Budget introuvable', { exact: true }).first()
	await expect(introuvable).toBeVisible()
	await illustrer(page, { chapitre: DETAIL, section: 'les-etats-que-vous-pouvez-rencontrer', nom: 'budget-introuvable', cibles: [introuvable, page.getByRole('link', { name: 'Revenir aux coûts du track' })] })
})

test('les coûts de tout l’espace', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/couts')
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
	await illustrer(page, { chapitre: CUMUL, section: null, nom: 'cumul', cibles: [], pleinePage: true })
	await illustrer(page, {
		chapitre: CUMUL,
		section: null,
		nom: 'barre-laterale',
		cibles: [page.getByRole('link', { name: 'Objectifs', exact: true }), page.getByRole('link', { name: 'Coûts', exact: true }).first(), page.getByRole('link', { name: 'Pilotage', exact: true })],
	})
	for (const devise of ['EUR', 'CHF']) {
		const titre = page.getByRole('heading', { name: `Coûts en ${devise}` })
		if ((await titre.count()) > 0)
			await illustrer(page, { chapitre: CUMUL, section: 'les-devises-ne-se-melangent-jamais', nom: `couts-en-${devise.toLowerCase()}`, cibles: [titre] })
	}
})

// Un autre compte, une autre page : la session de l'administratrice ne se quitte pas au milieu d'un test.
test('les coûts de tout l’espace, vus par une lectrice', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await page.goto('/couts')
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
	// L'écran dépasse la fenêtre de 900 px : elle est agrandie le temps de cette image (comme au chapitre 9).
	await page.setViewportSize({ width: 1440, height: 1400 })
	await illustrer(page, { chapitre: CUMUL, section: 'ce-que-l-ecran-ecrit-quand-il-n-y-a-rien-a-montrer', nom: 'lectrice', cibles: [page.locator('main')] })
})
