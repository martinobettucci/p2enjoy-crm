// @verifies CRM-046 (docs/BACKLOG.md) — tranche 3 : la bascule de la pastille d'ancienneté est
//           démontrable sur la donnée permanente du jeu de démonstration
// @verifies docs/SPEC-seed.md §9.12 (la card en retard, son seuil et son contraste), §9.12.6
//           (contrat, lignes a à e et g), §9.12.7 points 4 et 5 (preuves exigées)
// @verifies docs/SPEC-workflow-engine.md §7.4 (la pastille d'ancienneté, neutre puis `danger`)
// @verifies docs/DESIGN_SYSTEM.md §5.1 (pastille d'ancienneté dans l'étape)
// @verifies CLAUDE.md §15 (E2E depuis un état déterministe, données seedées), §16 (capture
//           produite et observée)
//
// LA PREUVE QUE `e2e/ui/board.spec.ts` NE POUVAIT PAS FAIRE. Ce fichier-là sert la card `…0c3`
// vieillie de trente jours par une réponse réseau **substituée** — procédé endossé par
// `docs/DESIGN_SYSTEM.md` §12.5. Une substitution prouve que l'écran réagit à une réponse donnée ;
// elle ne prouve pas que le serveur rend celle-là, ni qu'un utilisateur du jeu de démonstration
// rencontre jamais le cas. C'était exactement l'écart que le §7.4 nommait et renvoyait à
// `CRM-046`.
//
// Ce fichier n'en pose aucune : le navigateur obtient son jeton par le formulaire réel, chaque
// requête part à la vraie API, et les trois états de la pastille sont lus sur les cards du seed.
//
// AUCUNE ÉCRITURE, AUCUNE FABRICATION. Le seed porte tout ce que ce fichier mesure ; il sort donc
// intact, sans `finally` de nettoyage.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { capturer } from './captures'

const ADMIN = 'admin@p2enjoy.test'
const ROUTE_BOARD = '/tracks/conseil-ia/grands-comptes'

/** La seule card que le seed pose EN RETARD : 30 jours pour un seuil de 14 (§9.12.1). */
const CARD_EN_RETARD = '5eed0000-0000-4000-8000-0000000000c3'
/** `Relance`, seuil de 7 jours, fraîche : la pastille est là, neutre (§9.12.6 e). */
const CARD_A_JOUR = '5eed0000-0000-4000-8000-0000000000c1'
/** `Livré`, sans seuil : aucune pastille, et en inventer un serait une règle que nul n'a prise. */
const CARD_SANS_SEUIL = '5eed0000-0000-4000-8000-0000000000cd'

const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'
const ETAPE_LIVRE = '5eed0000-0000-4000-8000-000000000066'

/** Connexion par le formulaire réel, au clavier — jamais un jeton posé à la main dans l'onglet. */
async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.press('ControlOrMeta+A')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

function carte(page: Page, idCard: string) {
	return page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)
}

test.describe('la pastille d’ancienneté, sur la donnée réelle du seed (§9.12)', () => {
	test('les trois états de la pastille sont rendus sur la donnée réelle, sans substitution', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await page.goto(ROUTE_BOARD)
		await expect(page.getByTestId('board')).toBeVisible()

		// 1. `…0c3` est à trente jours dans une étape dont le seuil est de quatorze : `danger`.
		const pastilleEnRetard = carte(page, CARD_EN_RETARD).getByTestId('anciennete')
		await expect(pastilleEnRetard).toBeVisible()
		await expect(pastilleEnRetard).toHaveAttribute('data-depassee', 'oui')
		// La durée est LUE, pas déduite : sans elle, une pastille `danger` sur une card d'un jour
		// passerait aussi. `30` est ce que le §9.12.6 ligne c pose.
		await expect(pastilleEnRetard).toContainText('30')

		// 2. `…0c1` vient d'entrer dans une étape de seuil 7 : la pastille est là, et neutre.
		const pastilleAJour = carte(page, CARD_A_JOUR).getByTestId('anciennete')
		await expect(pastilleAJour).toBeVisible()
		await expect(pastilleAJour).toHaveAttribute('data-depassee', 'non')

		// 3. `…0cd` occupe `Livré`, dont ni l'étape ni le nœud ne portent de seuil : AUCUNE
		// pastille. C'est la ligne g du contrat, et c'est ce qui distingue « pas de seuil » de
		// « seuil non atteint » — deux états qu'une pastille neutre confondrait.
		await expect(carte(page, CARD_SANS_SEUIL).getByTestId('anciennete')).toHaveCount(0)

		// 4. Les trois cards sont bien dans les trois colonnes attendues : sans cette ligne, les
		// trois assertions ci-dessus resteraient vraies d'un board qui aurait perdu ses colonnes.
		for (const [idCard, idEtape] of [
			[CARD_EN_RETARD, ETAPE_PROSPECTION],
			[CARD_A_JOUR, ETAPE_RELANCE],
			[CARD_SANS_SEUIL, ETAPE_LIVRE],
		] as const) {
			await expect(
				page.locator(`[data-testid="colonne"][data-etape="${idEtape}"] [data-card="${idCard}"]`),
			).toHaveCount(1)
		}

		// La première capture porte le CONTRASTE — `danger` à gauche, neutre à droite — parce que
		// `Prospection` et `Relance` sont voisines. `Livré` est la sixième colonne : à 1440 px, le
		// board la laisse hors champ, et une capture ne montrerait pas ce que l'assertion 3
		// mesure. Elle est donc amenée à l'écran pour la SECONDE capture, plutôt que d'écrire que
		// les trois états tiennent sur une image qui n'en porte que deux.
		await capturer(page, 'anciennete-contraste-1440', 'CRM-046')

		await page
			.locator(`[data-testid="colonne"][data-etape="${ETAPE_LIVRE}"]`)
			.scrollIntoViewIfNeeded()
		await expect(carte(page, CARD_SANS_SEUIL)).toBeVisible()
		await expect(carte(page, CARD_SANS_SEUIL).getByTestId('anciennete')).toHaveCount(0)
		await capturer(page, 'anciennete-sans-seuil-1440', 'CRM-046')
	})

	test('la bascule survit au repli mobile, où les colonnes s’empilent', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await connecter(page)
		await page.goto(ROUTE_BOARD)
		await expect(page.getByTestId('board')).toBeVisible()

		const pastille = carte(page, CARD_EN_RETARD).getByTestId('anciennete')
		await expect(pastille).toBeVisible()
		await expect(pastille).toHaveAttribute('data-depassee', 'oui')
		// La carte fait 288 px et la pastille voisine celle du sommeil : à 390 px, un dépassement
		// de largeur se voit ici avant de se voir sur une capture (§7.4 du moteur).
		const boite = await pastille.boundingBox()
		expect(boite, 'la pastille est rendue et mesurable').not.toBeNull()
		expect(boite?.x ?? 0).toBeGreaterThanOrEqual(0)
		expect((boite?.x ?? 0) + (boite?.width ?? 0)).toBeLessThanOrEqual(390)

		await capturer(page, 'anciennete-depassee-390', 'CRM-046')
	})
})

// CE QUE CE FICHIER NE PROUVE PAS, ET POURQUOI. Un scénario « un anonyme ne voit aucune pastille »
// a été écrit puis RETIRÉ avant d'être committé : MESURÉ, un visiteur non connecté n'atteint pas le
// board — il est renvoyé vers `/connexion` par la garde de `CRM-009` —, si bien que l'absence de
// pastille y serait vraie d'une page qui n'est pas le board. Le refus opposé à l'anonyme est prouvé
// là où il est : `e2e/ui/authentification.spec.ts` pour la redirection, `e2e/api/board.spec.ts` §B6
// pour les quatre lectures rendues vides. L'écrire ici aurait été une preuve sans objet.
