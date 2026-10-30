// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.2 : les images du chapitre 6, « Ma journée »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 6 ; docs/SPEC-cards.md §17 (les sections, la portée,
//       les deux vides)
//
// L'écran peuplé est celui de l'administratrice du seed. Ses deux vides ne se rencontrent que là où rien n'est lisible :
// le scénario les montre dans un espace neuf, monté puis démonté (`outils.ts`).

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, connecterAvecLeLabs, demonterEspaceNeuf, monterEspaceNeuf, type Compte } from './outils'

const CHAPITRE = 'ma-journee-ce-qui-est-en-retard-ce-qui-est-du-aujourd-hui'
const ESPACE = { id: 'e1170000-0000-4000-8000-0000000006a1', slug: 'espace-sans-echeance', nom: 'Nouvel espace' } as const

test('la journée de l’administratrice', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/ma-journee')
	const section = page.getByTestId('section-journee').first()
	await expect(section).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'ma-journee', cibles: [], pleinePage: true })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'ce-qu-une-ligne-montre',
		nom: 'une-ligne',
		cibles: [page.getByTestId('ligne-journee').first()],
	})
	await illustrer(page, { chapitre: CHAPITRE, section: 'mes-affaires-ou-tout-l-espace-de-travail', nom: 'portee', cibles: [page.getByTestId('portee-journee')] })
})

test.describe('dans un espace où rien n’est dû', () => {
	let compte: Compte | null = null
	test.beforeAll(async ({ request }) => {
		compte = await monterEspaceNeuf(request, ESPACE, { prenom: 'Claire', nom: 'Morel' })
	})
	test.afterAll(async ({ request }) => {
		await demonterEspaceNeuf(request, ESPACE, compte)
	})

	test('les deux vides', async ({ page }) => {
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await page.goto('/ma-journee')
		const vide = page.getByTestId('etat-vide')
		await expect(vide).toContainText('Aucune échéance dans votre journée')
		await illustrer(page, { chapitre: CHAPITRE, section: 'quand-il-n-y-a-rien', nom: 'vide-mes-affaires', cibles: [vide] })
		await page.getByTestId('elargir-portee').click()
		await expect(page.getByTestId('etat-vide')).toContainText('Aucune échéance dans les 7 prochains jours')
		await illustrer(page, { chapitre: CHAPITRE, section: 'quand-il-n-y-a-rien', nom: 'vide-tout-l-espace', cibles: [page.getByTestId('etat-vide')] })
	})
})
