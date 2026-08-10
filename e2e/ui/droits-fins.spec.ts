// @verifies CRM-012 (docs/BACKLOG.md) — droits fins par track et channel, vus à l'écran
// @verifies docs/SPEC-permissions-rls.md §3.3 à §3.5 (« le plus spécifique gagne »), §4.1, §4.2
// @verifies docs/SPEC-tracks.md §7 (ce que la barre latérale lit) ; docs/SPEC-channels.md §5
// @verifies docs/DESIGN_SYSTEM.md §7 (paliers), §8 (clavier) ; CLAUDE.md §16 (vérification visuelle)
//
// CE QUE CES SCÉNARIOS PROUVENT.
//
// `CRM-012` était livrée et prouvée en base et par l'API, mais elle butait sur INC-021 : sans
// écran de connexion, la webapp restait un appelant anonyme, à qui un droit fin est invisible
// puisqu'il n'a déjà aucun accès. INC-021 est close depuis `CRM-009`, et la preuve manquante
// devient possible : deux personnes réelles se connectent, au clavier et à la souris, et voient
// **deux barres latérales différentes** produites par la même base et le même build.
//
// La matrice est celle du seed, et elle n'est pas fabriquée pour l'occasion :
//
//   Camille Aubert  administratrice  track « Conseil & IA » : access = none
//   Farida Nowak    lectrice         track « Conseil & IA » : access = none
//                                    channel « Prospection » : access = member
//
// Camille voit tout — « un administrateur n'est jamais restreint ». Farida ne voit pas le track,
// et c'est le refus le plus spécifique qui l'emporte sur son appartenance au workspace.
//
// CE QU'ILS NE PROUVENT PAS. Ils ne rejouent pas la matrice complète : c'est l'objet de
// `supabase/tests/0011_droits_fins.test.sql` (71 assertions) et de `e2e/api/droits-fins.spec.ts`
// (15 scénarios), qui l'éprouvent hors interface, comme `CLAUDE.md` §10 l'exige. Ce fichier
// prouve que l'écran **obéit** à cette matrice, pas qu'elle est complète.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const RESTREINT = 'Conseil & IA'

// « Pipeline 2024 » n'y figure pas, et ce n'est pas un oubli : le track est archivé dans le seed,
// et la barre latérale n'affiche que les tracks actifs (docs/SPEC-tracks.md §7). Le confondre avec
// un track fermé par un droit fin ferait passer une preuve pour deux règles différentes.
const VISIBLES_DE_TOUS = ['Studio web', 'Formation'] as const

/** Connexion réelle, au clavier seul : aucune session n'est injectée. */
async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

function tracksDeLaBarre(page: Page) {
	return page.getByTestId('barre-laterale').getByRole('link')
}

test('Farida ne voit pas le track qui lui est fermé, et le vide n’est pas une erreur', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecter(page, 'viewer@p2enjoy.test')

	// Le track fermé est absent de la barre. Ce n'est pas un masquage d'interface : le backend
	// ne l'a jamais rendu, et l'écran ne peut donc pas l'afficher.
	await expect(tracksDeLaBarre(page).filter({ hasText: RESTREINT })).toHaveCount(0)
	for (const visible of VISIBLES_DE_TOUS) {
		await expect(tracksDeLaBarre(page).filter({ hasText: visible })).toHaveCount(1)
	}

	await capturer(page, 'droits-fins-lectrice-1440', 'CRM-012')
})

test('Camille porte le même refus et voit pourtant tout : un administrateur n’est jamais restreint', async ({
	page,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecter(page, 'admin@p2enjoy.test')

	// La ligne `access = none` de Camille existe bel et bien dans le seed : c'est ce qui rend
	// cette capture démonstrative plutôt que tautologique.
	await expect(tracksDeLaBarre(page).filter({ hasText: RESTREINT })).toHaveCount(1)
	for (const visible of VISIBLES_DE_TOUS) {
		await expect(tracksDeLaBarre(page).filter({ hasText: visible })).toHaveCount(1)
	}

	await capturer(page, 'droits-fins-administratrice-1440', 'CRM-012')
})

test('le track fermé reste fermé quand Farida en saisit l’adresse directement', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecter(page, 'viewer@p2enjoy.test')

	// Contourner la navigation ne contourne pas la règle : la route est atteinte, et le backend
	// rend zéro ligne. L'écran nomme l'absence au lieu de rendre une page blanche.
	await page.goto('/tracks/conseil-ia')

	await expect(page.getByText('Track introuvable')).toBeVisible()
	await expect(page.getByText(RESTREINT, { exact: true })).toHaveCount(0)

	await capturer(page, 'droits-fins-adresse-directe-1440', 'CRM-012')
})

// Un palier par scénario, chacun sur une page neuve : la taille est posée AVANT le premier rendu,
// comme pour une personne qui ouvre l'application sur son écran. Redimensionner une page déjà
// rendue éprouverait un `resize`, pas un palier.
test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la lectrice ne voit toujours pas le track fermé`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, 'viewer@p2enjoy.test')

			// Sous 1024 px la barre est un tiroir : il faut l'ouvrir pour la voir.
			if (palier.largeur < 1024) {
				await page.getByTestId('ouvrir-tiroir').click()
				await expect(page.getByTestId('barre-laterale')).toBeInViewport({ ratio: 0.99 })
			}

			await expect(tracksDeLaBarre(page).filter({ hasText: RESTREINT })).toHaveCount(0)
			await expect(tracksDeLaBarre(page).filter({ hasText: 'Studio web' })).toHaveCount(1)

			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBeLessThanOrEqual(0)

			await capturer(page, `droits-fins-lectrice-${palier.nom}`, 'CRM-012')
		})
	}
})
