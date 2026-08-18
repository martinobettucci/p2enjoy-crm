// @verifies CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4a
// @verifies docs/SPEC-contacts.md §10.2 (route de premier niveau et entrée de navigation),
//           §10.4 (la lectrice lit les contacts : la lecture est ouverte à tout membre),
//           §10.5 (données techniques, nom d'organisation en texte), §10.6 (cas a, b, c, g),
//           §10.7 (aucun geste, aucun lien vers une fiche qui n'existe pas)
// @verifies docs/DESIGN_SYSTEM.md §5.19 (cette surface), §5.9 (tableau), §7 (paliers) ;
//           CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, et la navigation passe par la BARRE LATÉRALE, jamais par un `goto` sur
// l'adresse — c'est l'entrée de navigation du §10.2 qui est en cause autant que l'écran.
//
// Les trois contacts exercés sont ceux du seed, et chacun porte un cas du §10.6 : Léo Marchand
// avec son organisation et son email, Sophie Dupont sans organisation ni fonction, Élise Fabre
// sans email. Le seed est rendu INTACT : cette suite ne fait que lire.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-060'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('carnet de contacts (docs/SPEC-contacts.md §10)', () => {
	test('la barre latérale mène au carnet, qui rend les trois contacts du seed', async ({ page }) => {
		await connecter(page, ADMIN)

		// Cas g du §10.6 : l'entrée existe dans la navigation transverse, et le geste est un CLIC
		// sur elle — pas une navigation directe, qui ne prouverait pas que l'entrée existe.
		await page.getByRole('link', { name: 'Contacts', exact: true }).first().click()
		await expect(page).toHaveURL(/\/contacts$/)
		await expect(page.getByRole('heading', { name: 'Contacts' })).toBeVisible()

		const tableau = page.getByTestId('tableau-contacts')
		await expect(tableau).toBeVisible()
		await expect(page.getByTestId('ligne-contact')).toHaveCount(3)

		// Les cinq colonnes du §10.5, dans leur ordre.
		await expect(tableau.getByRole('columnheader')).toHaveText([
			'Nom',
			'Organisation',
			'Fonction',
			'Email',
			'Téléphone',
		])

		// Cas a : Léo Marchand, son organisation et son email.
		const ligneLeo = page.getByTestId('ligne-contact').filter({ hasText: 'Léo Marchand' })
		await expect(ligneLeo).toContainText('Sogexia')
		await expect(ligneLeo).toContainText('Directeur achats')
		await expect(ligneLeo.locator('code')).toContainText('leo.marchand@sogexia.example')

		// §10.7 : le nom de l'organisation est un TEXTE, jamais un lien — la fiche d'organisation
		// est due par 4b, et un lien sans destination serait mort. Aucun `mailto:` non plus.
		await expect(ligneLeo.locator('a')).toHaveCount(0)

		await capturer(page, 'carnet-contacts-1440', UNITE)
	})

	test('une donnée absente laisse la cellule VIDE, jamais un tiret — cas b et c du §10.6', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/contacts')
		await expect(page.getByTestId('tableau-contacts')).toBeVisible()

		// Sophie Dupont : aucune organisation, aucune fonction. Les cellules sont VIDES — ni tiret,
		// ni « — », ni « non renseigné » (docs/DESIGN_SYSTEM.md §5.9).
		const cellulesSophie = page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Sophie Dupont' })
			.locator('td')
		await expect(cellulesSophie.nth(1)).toHaveText('')
		await expect(cellulesSophie.nth(2)).toHaveText('')

		// Élise Fabre : aucun email, mais un téléphone. La quatrième cellule est vide, la cinquième
		// porte sa donnée technique.
		const cellulesElise = page
			.getByTestId('ligne-contact')
			.filter({ hasText: 'Élise Fabre' })
			.locator('td')
		await expect(cellulesElise.nth(3)).toHaveText('')
		await expect(cellulesElise.nth(4)).toContainText('+33 6 12 34 56 78')
	})

	test('la lectrice lit le carnet : la lecture est ouverte à tout membre — §10.4', async ({
		page,
	}) => {
		// MESURÉ sur la pile réelle : la lectrice reçoit `200` et les trois lignes. L'écriture lui
		// est fermée en base (§3), mais cette sous-tranche n'en expose aucune — il n'y a donc AUCUN
		// geste à lui refuser, et l'écran est le même que celui de l'administratrice.
		await connecter(page, VIEWER)
		await page.goto('/contacts')
		await expect(page.getByTestId('ligne-contact')).toHaveCount(3)
		// §10.7 : aucun geste d'écriture n'est offert, à personne.
		await expect(page.getByRole('button', { name: /contact/i })).toHaveCount(0)
	})

	test('le carnet est atteignable au CLAVIER seul, et l’entrée courante s’annonce', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		const entree = page.getByRole('link', { name: 'Contacts', exact: true }).first()
		await entree.focus()
		await expect(entree).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/contacts$/)
		// L'entrée ouverte porte `aria-current="page"` : une sélection qui ne s'annonce qu'en teinte
		// n'existe pas pour un lecteur d'écran (docs/DESIGN_SYSTEM.md §8, §12.1).
		await expect(page.getByRole('link', { name: 'Contacts', exact: true }).first()).toHaveAttribute(
			'aria-current',
			'page',
		)
		await expect(page.getByTestId('tableau-contacts')).toBeVisible()
	})
})

// --- Paliers responsive (docs/DESIGN_SYSTEM.md §7) --------------------------------------------
//
// La taille de fenêtre est fixée AVANT le chargement — même patron que `etat-messagerie.spec.ts`
// et `board.spec.ts` : la coquille détermine son repli de barre latérale au montage.

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le carnet reste lisible et la page ne défile pas horizontalement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await page.goto('/contacts')
			await expect(page.getByTestId('tableau-contacts')).toBeVisible()

			// §7 : c'est le CONTENEUR du tableau qui défile, jamais la page — même garantie que le
			// board et la vue liste, portée par `.indique-debordement-x` (§12.6).
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(debordePage, 'la page ne doit jamais défiler horizontalement').toBe(false)

			await capturer(page, `carnet-contacts-${palier.nom}`, UNITE)
		})
	}
})

test('l’état vide du carnet est rendu SANS action — cas f du §10.6', async ({ page }) => {
	// Sans session, la RLS ne consent aucune ligne : `200` et `[]`, mesuré. C'est l'état vide
	// ordinaire, et il n'offre AUCUNE action — le carnet ne livre aucun geste de création (§10.7),
	// et un bouton vers nulle part serait une commande morte (docs/DESIGN_SYSTEM.md §5.16).
	await page.goto('/contacts')
	await expect(page.getByTestId('etat-vide')).toBeVisible()
	await capturer(page, 'carnet-contacts-vide-1440', UNITE)
})
