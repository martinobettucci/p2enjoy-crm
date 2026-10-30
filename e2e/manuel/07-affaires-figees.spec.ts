// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.2 : les images du chapitre 7, « Les affaires figées »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 7 ; docs/SPEC-relances.md (le seuil, la relance
//       inscrite, l'écran)
//
// L'écran peuplé et la relance du fil sont ceux du seed. « Aucune affaire figée » se montre dans un espace neuf ;
// « Les affaires figées n'ont pas pu être chargées », par la lecture de la règle COUPÉE au niveau du réseau.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, connecterAvecLeLabs, demonterEspaceNeuf, monterEspaceNeuf, type Compte } from './outils'

const CHAPITRE = 'les-affaires-figees-ce-qui-dort-depuis-trop-longtemps'
const ESPACE = { id: 'e1170000-0000-4000-8000-0000000007a1', slug: 'espace-sans-figee', nom: 'Nouvel espace' } as const

test('l’écran, la barre latérale et une étape terminale', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/affaires-figees')
	await expect(page.getByTestId('ligne-figee').first()).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'affaires-figees', cibles: [], pleinePage: true })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: null,
		nom: 'barre-laterale',
		cibles: [page.getByRole('link', { name: 'Ma journée' }), page.getByRole('link', { name: 'Affaires figées' })],
	})
	await illustrer(page, { chapitre: CHAPITRE, section: 'ce-que-l-ecran-montre', nom: 'une-ligne', cibles: [page.getByTestId('ligne-figee').first()] })

	// « Perdu », étape terminale du seed : elle n'a pas de seuil qui fige.
	await page.goto('/tracks/conseil-ia/grands-comptes')
	const perdu = page.getByTestId('colonne').filter({ hasText: 'Perdu' }).first()
	await expect(perdu).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'ce-qu-etre-figee-veut-dire',
		nom: 'etape-perdu',
		cibles: [perdu.getByText('Perdu', { exact: true }).first()],
	})
})

test('la relance inscrite dans le fil de l’affaire', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/affaires-figees')
	await page.getByTestId('lien-affaire-figee').first().click()
	await expect(page).toHaveURL(/\/cards\//)
	// La ligne du fil, désignée par son détail : le panneau des séquences porte le même titre (`e2e/ui/affaires-figees.spec.ts`).
	const relance = page.locator('p', { hasText: /jours de retard, pour un seuil de/ }).last()
	await expect(relance).toContainText('Relance automatique')
	await illustrer(page, { chapitre: CHAPITRE, section: 'la-relance-inscrite-dans-l-affaire', nom: 'relance-dans-le-fil', cibles: [relance] })
})

test('une liste qui n’a pas pu être lue', async ({ page }) => {
	test.setTimeout(60_000)
	await connecterAvecLeLabs(page, ADMIN)
	await page.route('**/rest/v1/rpc/cards_figees*', (route) => route.abort('connectionrefused'))
	await page.goto('/affaires-figees')
	const erreur = page.getByTestId('etat-erreur')
	await expect(erreur).toContainText('Les affaires figées n’ont pas pu être chargées', { timeout: 30_000 })
	await illustrer(page, { chapitre: CHAPITRE, section: 'quand-il-n-y-a-rien', nom: 'chargement-impossible', cibles: [erreur] })
})

test.describe('dans un espace où rien ne dort', () => {
	let compte: Compte | null = null
	test.beforeAll(async ({ request }) => {
		compte = await monterEspaceNeuf(request, ESPACE, { prenom: 'Claire', nom: 'Morel' })
	})
	test.afterAll(async ({ request }) => {
		await demonterEspaceNeuf(request, ESPACE, compte)
	})

	test('aucune affaire figée', async ({ page }) => {
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await page.goto('/affaires-figees')
		const vide = page.getByTestId('etat-vide')
		await expect(vide).toContainText('Aucune affaire figée')
		await illustrer(page, { chapitre: CHAPITRE, section: 'quand-il-n-y-a-rien', nom: 'aucune-affaire-figee', cibles: [vide] })
	})
})
