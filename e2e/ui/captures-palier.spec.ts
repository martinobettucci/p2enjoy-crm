// @verifies INC-237 (docs/INCONSISTENCY_REPORT.md), Tri du lot des intermittents d'interface (docs/BACKLOG.md) — `capturer` n'est jamais
//           prise pendant la transition de la barre latérale après un redimensionnement (docs/SPEC-captures.md ; docs/DESIGN_SYSTEM.md §11)
//
// La transition de la barre latérale est ALLONGÉE à trois secondes : sans l'attente de `capturer`, la barre recouvre encore le contenu
// quand la capture rend la main ; avec elle, elle est hors écran. Aucune temporisation : l'attente porte sur les animations en cours.

import { connecterAvecLeLabs, expect, test } from './fixtures'
import { capturer } from './captures'

test('une capture prise juste après le passage au palier tiroir attend la fin de la transition de la barre latérale', async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 })
	await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	await expect(page.getByTestId('barre-laterale')).toBeVisible()
	await page.addStyleTag({ content: '[data-testid="barre-laterale"] { transition-duration: 3s !important; }' })
	await page.setViewportSize({ width: 390, height: 800 })
	await capturer(page, 'barre-laterale-apres-redimensionnement-sm-390', 'INC-237')
	const [barre, contenu] = await Promise.all([page.getByTestId('barre-laterale').boundingBox(), page.locator('main').boundingBox()])
	const recouvrement = (barre === null ? 0 : barre.x + barre.width) - (contenu?.x ?? 0)
	expect(recouvrement, `la barre latérale recouvre encore le contenu de ${recouvrement} px à la fin de la capture`).toBeLessThanOrEqual(0.5)
})
