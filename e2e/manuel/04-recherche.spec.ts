// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.1 : les images du chapitre 4, « Retrouver n'importe quoi : la recherche »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 4 ; docs/SPEC-recherche.md §12 (la palette), §13 (les
//       adresses des résultats)
//
// Les termes sont ceux de `e2e/ui/recherche.spec.ts` : « sogexia » trouve une affaire, une organisation et un commentaire
// du seed ; « candidature » trouve un message de l'inbox, qui n'est classé dans aucune affaire.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, connecterAvecLeLabs } from './outils'

const CHAPITRE = 'retrouver-n-importe-quoi-la-recherche'

test('le champ, la palette et ses résultats', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/conseil-ia/grands-comptes')
	const champ = page.getByTestId('champ-recherche')
	await expect(champ).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'l-ouvrir', nom: 'champ', cibles: [champ] })

	await page.keyboard.press('ControlOrMeta+k')
	await expect(champ).toBeFocused()
	await page.keyboard.type('sogexia')
	const panneau = page.getByTestId('panneau-recherche')
	await expect(page.getByTestId('resultat-recherche').first()).toBeVisible()
	await page.keyboard.press('ArrowDown')
	await illustrer(page, { chapitre: CHAPITRE, section: 'ce-qu-elle-cherche', nom: 'resultats', cibles: [champ, panneau] })
})

test('un message trouvé mène à l’inbox, dans « Non classés »', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/conseil-ia/grands-comptes')
	await expect(page.getByTestId('champ-recherche')).toBeVisible()
	await page.keyboard.press('ControlOrMeta+k')
	await expect(page.getByTestId('champ-recherche')).toBeFocused()
	await page.keyboard.type('candidature')
	await expect(page.getByTestId('resultat-recherche')).toHaveCount(1)
	await page.keyboard.press('Enter')
	await expect(page).toHaveURL(/\/inbox\?message=/)
	const dossier = page.getByRole('button', { name: /Non classés/ })
	await expect(dossier).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'la-parcourir-au-clavier-et-y-aller', nom: 'message-non-classe', cibles: [page.getByTestId('inbox-panneau-dossiers').getByRole('heading').first(), dossier] })
})
