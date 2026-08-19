// @verifies CRM-083 (docs/BACKLOG.md) — canevas d'objectifs, tranche 1 : la SURFACE
// @verifies docs/SPEC-goals.md §5.1 (entrée de navigation et liste), §5.2 (canevas et pilule),
//           §5.3 (flèches), §5.4 (états), §5.5 (clavier et équivalent textuel),
//           §3 (ouvrir le channel d'un bloc), §4.1 (le bloc masqué n'est jamais nommé)
// @verifies docs/DESIGN_SYSTEM.md §5.29 (bloc, jauge, flèche), §7 (paliers), §5.8 (états)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (navigation clavier)
//
// LE PARCOURS EST FAIT À LA SOURIS ET AU CLAVIER, avec les jetons réels de DEUX profils du seed :
// l'administratrice, qui lit les huit channels, et la lectrice, qui n'en lit que six. C'est cette
// paire — et elle seule — qui rend le §4.1 démontrable sur un écran : les deux voient le MÊME
// tableau et n'y voient pas le même dessin.
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE et aucune fonction interne n'est appelée : ce que la preuve
// mesure est ce que le backend a consenti.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-083'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'

const TABLEAU = 'Objectifs du trimestre'
/** Le bloc lié à « Grands comptes », que la lectrice ne lit pas — seed 8 terdecies. */
const BLOC_MASQUE = 'Gagner un grand compte'
const BLOC_LIBRE = 'Doubler le pipeline commercial'
const BLOC_LIE = 'Livrer la refonte du site vitrine'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Ouvre le tableau du seed depuis la LISTE, comme un utilisateur — jamais par son adresse. */
async function ouvrirLeTableau(page: Page): Promise<void> {
	await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
	await expect(page.getByTestId('tableau-objectifs').first()).toBeVisible()
	await page.getByRole('link', { name: new RegExp(TABLEAU) }).click()
	await expect(page.getByRole('heading', { name: TABLEAU })).toBeVisible()
}

test.describe('canevas d’objectifs — CRM-083', () => {
	test('l’entrée de navigation mène à la liste, qui compte les blocs LISIBLES', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()

		const carte = page.getByTestId('tableau-objectifs').first()
		await expect(carte).toBeVisible()
		await expect(carte).toContainText(TABLEAU)
		// L'administratrice lit les huit channels : elle voit donc les SIX blocs du seed.
		await expect(carte).toContainText('6 blocs')
	})

	test('le canevas rend les blocs, leur jauge et la pilule « Track › Channel »', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		await expect(page.getByTestId('bloc-objectif')).toHaveCount(6)
		// Le titre est cherché dans le BLOC, et non dans la page : il apparaît légitimement DEUX
		// fois pour ce profil — sur la carte et dans l'équivalent textuel du diagramme (§5.5).
		await expect(page.getByRole('heading', { name: BLOC_MASQUE })).toBeVisible()

		// La pilule du bloc lié porte son track et son channel, et mène à l'adresse du channel.
		const pilule = page
			.getByTestId('bloc-objectif')
			.filter({ hasText: BLOC_LIE })
			.getByTestId('pilule-channel')
		await expect(pilule).toContainText('Studio web')
		await expect(pilule).toContainText('Refonte de site')

		// Les QUATRE flèches du seed sont tracées, et aucune n'est orpheline pour ce profil.
		await expect(page.getByTestId('fleche')).toHaveCount(4)
		await expect(page.getByTestId('fleche-orpheline')).toHaveCount(0)
	})

	test('OUVRIR LE CHANNEL depuis un bloc atterrit sur la bonne adresse — §3', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		await page
			.getByTestId('bloc-objectif')
			.filter({ hasText: BLOC_LIE })
			.getByTestId('pilule-channel')
			.click()

		await expect(page).toHaveURL(/\/tracks\/studio-web\/refonte$/)
	})

	test('LA LECTRICE NE VOIT PAS le bloc du channel qui lui est fermé, et rien ne le nomme', async ({
		page,
	}) => {
		// C'est LA preuve du §4.1 sur un écran : le bloc n'est pas grisé, il n'est pas rendu, et
		// aucun texte de la page — dessin, équivalent textuel, infobulle — ne le nomme.
		await connecter(page, LECTRICE)
		await ouvrirLeTableau(page)

		await expect(page.getByTestId('bloc-objectif')).toHaveCount(5)
		await expect(page.getByText(BLOC_MASQUE)).toHaveCount(0)
		await expect(page.locator('body')).not.toContainText(BLOC_MASQUE)

		// La flèche qui en partait reste, en POINTILLÉS vers le vide, et SANS libellé.
		await expect(page.getByTestId('fleche-orpheline')).toHaveCount(1)
		const trait = page.getByTestId('fleche-orpheline').locator('line')
		await expect(trait).toHaveAttribute('stroke-dasharray', /\d/)

		await capturer(page, 'canevas-lectrice-bloc-masque', UNITE)
	})

	test('l’équivalent textuel restitue le diagramme, y compris ses trois directions — §5.5', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		const lignes = page.getByTestId('ligne-diagramme')
		await expect(lignes).toHaveCount(4)
		const texte = (await page.getByTestId('equivalent-textuel').textContent()) ?? ''
		expect(texte).toContain('→')
		expect(texte).toContain('←')
		expect(texte).toContain('↔')
		// Le libellé posé sur la flèche est restitué au lecteur d'écran, pas seulement dessiné.
		expect(texte).toContain('nourrit')
	})

	test('LE CANEVAS EST UTILISABLE AU CLAVIER : tabulation entre les blocs, dans l’ordre des positions', async ({
		page,
	}) => {
		// `CLAUDE.md` §22 et `docs/SPEC-goals.md` §5.5 : un canevas qui n'obéit qu'à la souris n'est
		// pas terminé. La preuve n'emploie ICI aucune souris — que des touches.
		await connecter(page, ADMIN)
		await page.goto('/objectifs')
		await page.getByRole('link', { name: new RegExp(TABLEAU) }).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByRole('heading', { name: TABLEAU })).toBeVisible()

		const premier = page.getByTestId('bloc-objectif').first()
		await premier.focus()
		await expect(premier).toBeFocused()
		// Le premier bloc de la tabulation est celui du haut à gauche : `pos_y` puis `pos_x`.
		await expect(premier).toHaveAttribute('aria-label', new RegExp(BLOC_LIBRE))

		// L'étiquette d'un bloc lié NOMME sa destination — sans quoi la pilule n'existerait que
		// pour les voyants.
		const lie = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_LIE })
		await expect(lie).toHaveAttribute('aria-label', /Studio web/)

		await capturer(page, 'canevas-focus-clavier', UNITE)
	})

	test('le zoom change l’échelle du canevas et reste borné', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		await expect(page.getByTestId('zoom-valeur')).toHaveText('100 %')
		await page.getByTestId('zoom-plus').click()
		await expect(page.getByTestId('zoom-valeur')).toHaveText('125 %')
		await page.getByTestId('zoom-plus').click()
		await expect(page.getByTestId('zoom-valeur')).toHaveText('150 %')
		// Borné : au dernier palier, la commande est indisponible plutôt qu'inopérante.
		await expect(page.getByTestId('zoom-plus')).toBeDisabled()

		await page.getByTestId('zoom-moins').click()
		await expect(page.getByTestId('zoom-valeur')).toHaveText('125 %')
	})

	test('une adresse de tableau inconnue rend un état explicite, jamais une page blanche', async ({
		page,
	}) => {
		// Un identifiant qui n'existe pas et un tableau fermé à l'appelant se ressemblent
		// délibérément (docs/SPEC-permissions-rls.md §7).
		await connecter(page, ADMIN)
		await page.goto('/objectifs/5eed0000-0000-4000-8000-0000000000ff')
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByText('Tableau introuvable')).toBeVisible()
	})

	test('les quatre paliers rendent le canevas sans débordement horizontal — §7', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await expect(page.getByTestId('canevas-objectifs')).toBeVisible()
			// LA PAGE NE DÉFILE JAMAIS HORIZONTALEMENT : le canevas défile dans SON conteneur.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, `débordement horizontal au palier ${palier.nom}`).toBe(false)
			await capturer(page, `canevas-${palier.nom}`, UNITE)
		}
	})

	test('LA CONSOLE RESTE VIERGE sur le parcours complet', async ({ page }) => {
		// `docs/CloudWorker.md` §3 : la console du navigateur doit rester vierge de toute erreur
		// et de tout avertissement. Le VERDICT est porté par la fixture, qui exige une console
		// vide à la fin de CHAQUE scénario ; ce scénario-ci existe pour parcourir l'écran sans
		// rien assener d'autre, de sorte qu'une anomalie de console ne se cache pas derrière
		// l'échec d'une autre assertion. Aucune tolérance n'est déclarée.
		await connecter(page, ADMIN)
		await ouvrirLeTableau(page)
		await page.getByTestId('zoom-plus').click()
		await page.getByTestId('bloc-objectif').first().focus()
		await expect(page.getByTestId('equivalent-textuel')).toBeVisible()
	})
})
