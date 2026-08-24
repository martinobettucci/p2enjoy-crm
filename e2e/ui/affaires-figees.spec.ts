// @verifies CRM-062 (docs/BACKLOG.md) — tranche 3c : l'écran des affaires figées, sur session réelle
// @verifies docs/SPEC-relances.md §10.2.1 (les quatre affaires du jeu, et ce que chaque profil en
//           lit), §10.4 (l'adresse et l'entrée de navigation), §10.7 (regroupement et classement),
//           §10.8 (ce que chaque ligne rend), §10.9 (les états), §10.12 (preuves attendues)
// @verifies docs/SPEC-relances.md §10.3.1 (la relance NOMMÉE dans le fil d'une affaire)
// @verifies docs/DESIGN_SYSTEM.md §5.37 (cette surface), §7 (les quatre paliers) ;
//           CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée, et la navigation passe par la BARRE
// LATÉRALE — c'est l'entrée du §10.4 qui est en cause autant que l'écran.
//
// LES AFFAIRES EXERCÉES SONT CELLES DU SEED, et chacune porte une ligne du §10.2.1 : quatre pour
// l'administratrice, TROIS pour la lectrice. Le refus se mesure comme un trou dans une liste
// peuplée, jamais comme un écran vide.
//
// LE SEED SORT INTACT : cette suite ne fait que lire.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-062'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** Les quatre affaires figées du §10.2.1, dans l'ordre du §3.4. */
const AFFAIRES = [
	{ titre: 'Refonte intranet Ville de Lyon', retard: '35', seuil: '5', dossier: 'Refonte' },
	{ titre: 'Contrat TMA 2026 — Mairie de Vaulx', retard: '18', seuil: '7', dossier: 'Maintenance' },
	{ titre: 'Audit sécurité applicative', retard: '16', seuil: '14', dossier: 'Grands comptes' },
	{ titre: 'Reprise du dossier Marchand', retard: '7', seuil: '5', dossier: 'Dossiers 2023' },
] as const

/** Celle que la lectrice NE voit pas : son track « Conseil & IA » lui est fermé (`CRM-012`). */
const FERMEE_A_LA_LECTRICE = 'Audit sécurité applicative'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('« Affaires figées » (docs/SPEC-relances.md §10)', () => {
	test('la barre latérale mène à l’écran, et les quatre affaires du seed y sont', async ({
		page,
	}) => {
		await connecter(page, ADMIN)

		// LE GESTE EST UN CLIC SUR L'ENTRÉE, pas une navigation directe : c'est l'entrée elle-même
		// qui est en cause, et elle n'existait pas avant cette tranche (§10.4).
		await page.getByRole('link', { name: 'Affaires figées', exact: true }).first().click()
		await expect(page).toHaveURL(/\/affaires-figees$/)
		await expect(page.getByRole('heading', { name: 'Affaires figées' })).toBeVisible()

		const lignes = page.getByTestId('ligne-figee')
		await expect(lignes).toHaveCount(AFFAIRES.length)
		// L'ORDRE ENTIER, et pas seulement le compte : c'est le classement par retard que l'écran
		// existe pour donner (§10.7).
		for (const [rang, affaire] of AFFAIRES.entries()) {
			await expect(lignes.nth(rang)).toContainText(affaire.titre)
		}
	})

	test('les quatre dossiers sont des groupes distincts, et un track en porte DEUX', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/affaires-figees')
		const groupes = page.getByTestId('groupe-figees')
		await expect(groupes).toHaveCount(4)
		// LE SEUL CAS QUI PROUVE QUE LE REGROUPEMENT PORTE SUR LE DOSSIER ET NON SUR LE TRACK :
		// `Refonte` et `Maintenance` appartiennent au MÊME track « Studio web » (§10.2.1 point 2).
		// Un regroupement par track les fondrait en un bloc, et cette assertion le verrait.
		await expect(groupes.nth(0)).toContainText('Refonte')
		await expect(groupes.nth(1)).toContainText('Maintenance')
		// Le compte de chaque groupe est ÉCRIT, jamais laissé à deviner (§10.7).
		await expect(page.getByTestId('compte-groupe').first()).toHaveText('(1)')
	})

	test('le retard porte la teinte de danger, la ligne ne la porte pas, et le seuil l’accompagne', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/affaires-figees')
		const retard = page.getByTestId('retard-figee').first()
		await expect(retard).toBeVisible()
		// LA TEINTE PORTE SUR LE RETARD (§10.8) : une affaire figée est un travail à faire, pas une
		// erreur, et le §1 est tenu par l'unité et le seuil écrits en clair.
		await expect(retard).toHaveClass(/bg-danger-soft/)
		await expect(retard).toHaveText(`${AFFAIRES[0].retard}j`)
		await expect(page.getByTestId('ligne-figee').first()).not.toHaveClass(/bg-danger/)
		// UN RETARD SANS SON SEUIL N'A PAS D'ÉCHELLE, et le seuil VARIE d'une ligne à l'autre.
		await expect(page.getByTestId('seuil-figee').first()).toHaveText(`seuil ${AFFAIRES[0].seuil} j`)
		await expect(page.getByTestId('seuil-figee').nth(2)).toHaveText(`seuil ${AFFAIRES[2].seuil} j`)
	})

	test('le titre mène à la fiche, et la pilule ouvre le dossier', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/affaires-figees')
		// Le titre EST le libellé du lien : deux liens portant le même libellé générique seraient
		// indiscernables au lecteur d'écran (§10.8).
		await page.getByTestId('lien-affaire-figee').first().click()
		await expect(page).toHaveURL(/\/tracks\/[^/]+\/[^/]+\/cards\//)
		await expect(page.getByText(AFFAIRES[0].titre).first()).toBeVisible()

		await page.goBack()
		// LA PILULE EST UN LIEN ENTIER, destination comprise (§5.29) : son icône promettrait sinon
		// une navigation qui n'existe pas — la commande morte que le §5.10 proscrit.
		const pilule = page.getByTestId('pilule-situation').first()
		await expect(pilule).toHaveAttribute('aria-label', /^Ouvrir .+ › .+$/)
		await pilule.click()
		await expect(page).toHaveURL(/\/tracks\/[^/]+\/[^/]+$/)
	})

	// LE REFUS EST UN TROU DANS UNE LISTE PEUPLÉE, ET C'EST LA PREUVE LA PLUS FORTE DE CETTE SUITE.
	// Avant la tranche 3a la lectrice obtenait un écran VIDE, qu'un écran cassé aurait rendu tout
	// aussi vert. Elle en voit trois sur quatre, et l'écran ne nomme nulle part la quatrième.
	test('la lectrice voit TROIS des quatre, et l’écran ne nomme jamais celle qu’il cache', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto('/affaires-figees')
		await expect(page.getByTestId('ligne-figee')).toHaveCount(3)
		await expect(page.getByText(FERMEE_A_LA_LECTRICE)).toHaveCount(0)
		// L'ÉCRAN NE NOMME JAMAIS CE QU'IL NE MONTRE PAS (§10.9, `docs/SPEC-permissions-rls.md` §7) :
		// aucune phrase ne dit qu'une affaire est masquée, ce qui divulguerait par la bande.
		await expect(page.getByText(/masqué/i)).toHaveCount(0)
		// Les trois autres sont là, et dans l'ordre : le refus n'a pas désordonné la liste.
		const lignes = page.getByTestId('ligne-figee')
		await expect(lignes.nth(0)).toContainText(AFFAIRES[0].titre)
		await expect(lignes.nth(1)).toContainText(AFFAIRES[1].titre)
		await expect(lignes.nth(2)).toContainText(AFFAIRES[3].titre)
	})

	// LA RELANCE EST LISIBLE DANS LE FIL — sous-tranche 3b, INC-207. Avant elle, cette ligne se
	// rendait « Événement », et le §9.1 promettait « un fait que l'utilisateur rencontre en ouvrant
	// la timeline de son affaire ».
	test('le fil de l’affaire figée NOMME sa relance, avec son retard et son seuil', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/affaires-figees')
		await page.getByTestId('lien-affaire-figee').first().click()
		await expect(page).toHaveURL(/\/cards\//)
		const relance = page.getByText('Relance automatique').first()
		await expect(relance).toBeVisible()
		// LA LIGNE EST AMENÉE DANS LE CHAMP AVANT LA CAPTURE, et c'est un défaut trouvé EN
		// REGARDANT (`CLAUDE.md` §16). La capture est prise sans `fullPage`, et le fil d'une
		// affaire déjà riche pousse la relance sous la ligne de flottaison : l'image montrait
		// l'écran, pas ce qu'elle prétend prouver. Une capture qui ne porte pas son sujet n'est pas
		// une vérification visuelle.
		await relance.scrollIntoViewIfNeeded()
		// LE DÉTAIL COMPOSE LES DEUX CLÉS DU `payload`, par une clé de traduction et jamais par
		// concaténation (§10.3.1). Les deux nombres sont ceux de la première affaire du jeu.
		await expect(
			page.getByText(
				`${AFFAIRES[0].retard} jours de retard, pour un seuil de ${AFFAIRES[0].seuil} jours`,
			),
		).toBeVisible()
		await capturer(page, 'relance-dans-le-fil-1440', UNITE)
	})

	test('la console reste VIERGE sur le parcours complet', async ({ page }) => {
		const bruits: string[] = []
		page.on('console', (message) => {
			if (message.type() === 'error' || message.type() === 'warning') bruits.push(message.text())
		})
		page.on('pageerror', (erreur) => bruits.push(erreur.message))
		await connecter(page, ADMIN)
		await page.getByRole('link', { name: 'Affaires figées', exact: true }).first().click()
		await expect(page.getByTestId('ligne-figee')).toHaveCount(AFFAIRES.length)
		await page.getByTestId('pilule-situation').first().click()
		await expect(page).toHaveURL(/\/tracks\//)
		expect(bruits, `console non vierge : ${bruits.join(' | ')}`).toEqual([])
	})

	// LES QUATRE PALIERS DU §7, PRODUITS DEPUIS L'APPLICATION RÉELLEMENT EXÉCUTÉE et observés
	// (`CLAUDE.md` §16). La page ne défile JAMAIS horizontalement, à aucun palier.
	test('les quatre paliers : captures produites, et aucun débordement horizontal', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/affaires-figees')
			await expect(page.getByTestId('ligne-figee')).toHaveCount(AFFAIRES.length)
			const deborde = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(deborde, `débordement horizontal à ${palier.nom}`).toBe(false)
			await capturer(page, `affaires-figees-${palier.nom}`, UNITE)
		}
	})

	// L'ÉTAT VIDE NE SE DÉMONTRE PAS SUR LE SEED, qui porte quatre affaires figées par contrat.
	// Il est donc éprouvé sur une réponse SUBSTITUÉE — procédé endossé par `docs/DESIGN_SYSTEM.md`
	// §12.5, qui l'admet « pour isoler un état rare », et NOMMÉ ici comme il l'exige. Le parcours
	// connecté correspondant est celui des scénarios ci-dessus, qu'il ne remplace pas.
	test('l’état vide dit que l’état est SAIN, et n’offre aucune action', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.route('**/rest/v1/rpc/cards_figees*', async (route) => {
			await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
		})
		await page.goto('/affaires-figees')
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByText('Aucune affaire figée')).toBeVisible()
		// AUCUNE ACTION : il n'y a rien à faire d'une liste vide, et un bouton y serait un chemin
		// vers nulle part (§10.9, l'écart assumé au §5.8 que la corbeille prend déjà).
		await expect(page.getByTestId('etat-vide').getByRole('button')).toHaveCount(0)
		await expect(page.getByTestId('etat-vide').getByRole('link')).toHaveCount(0)
		await capturer(page, 'affaires-figees-vide-1440', UNITE)
	})
})
