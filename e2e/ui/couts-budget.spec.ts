// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 4 : le parcours d'interface de
//           l'écran de détail d'un budget
// @verifies docs/SPEC-costs.md §4.0 (l'adresse `/tracks/:slugTrack/couts/:idBudget`, le budget
//           désigné par son IDENTIFIANT), §4.3 (une paire de barres PAR OCCURRENCE, la liste des
//           lignes filtrable par occurrence, l'accès à l'affaire), §4.4 (la mention des réels
//           manquants), §4.7 (les états), §2.3 (un budget clos garde ses lignes lisibles)
// @verifies docs/SPEC-permissions-rls.md §7 (inexistant, refusé et mal formé rendent le même écran)
// @verifies docs/DESIGN_SYSTEM.md §5.9 (cellule sans valeur VIDE, en-têtes de colonne), §5.30 (le
//           tableau équivalent est la version accessible du graphique), §5.8 (états), §7 (les
//           quatre paliers), §8 (clavier)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// CE FICHIER NE MODIFIE RIEN. L'écran du §4.3 est en lecture seule ; aucun scénario ne pose ni ne
// retire de ligne, et aucun épilogue de purge n'est donc nécessaire (décision 362 : la purge
// accompagne l'écriture, pas la lecture). `apply-seed.sh` compte QUATRE lignes de `card_costs` et
// `supabase/tests/0049_card_costs.test.sql` s'appuie sur ce compte.
//
// LA MESURE QUE CE FICHIER EXISTE POUR TENIR, ET QU'AUCUNE PREUVE UNITAIRE NE PEUT POSER : le
// budget récurrent « Publicité 2026 » rend UNE paire de barres sur l'écran du §4.2 — 1000 estimé,
// 880 réel, toutes occurrences confondues — et DEUX ici, une par occurrence : « Janvier 2026 »
// 900/880 et « Février 2026 » 100 sans réel. C'est le même jeu de données lu par deux écrans, et
// c'est exactement ce que la Definition of Done de `CRM-086` demande de vérifier « sur le même jeu
// de données ». Une régression qui replierait le détail sur l'agrégat, ou l'inverse, ne se voit
// qu'en comparant les deux.
//
// LES ASSERTIONS PORTENT SUR LE TABLEAU ÉQUIVALENT, ET NON SUR LES BARRES — le §5.30 fait du
// tableau la version accessible du graphique, lequel est `aria-hidden` à dessein.

import { autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-086'
const ADMIN = 'admin@p2enjoy.test'
/**
 * La lectrice. Le seed lui pose `track_members.access = 'none'` sur « Conseil & IA » : le budget
 * « Prospection sortante » lui est donc FERMÉ, et son écran de détail doit rendre « Budget
 * introuvable » — le même écran qu'un identifiant inconnu (`docs/SPEC-permissions-rls.md` §7).
 */
const VIEWER = 'viewer@p2enjoy.test'

// Les identifiants du seed sont STABLES, et c'est ce qui rend ces adresses écrivables ici : le §4.0
// désigne un budget par son identifiant précisément parce que son nom ne l'identifie pas — deux
// budgets homonymes coexistent dès que l'un est clos (§2.1).
const ID_RECURRENT = '5eed0000-0000-4000-8000-0000000000c2'
const ID_CLOTURE = '5eed0000-0000-4000-8000-0000000000c3'
const ID_SANS_LIGNE = '5eed0000-0000-4000-8000-0000000000c4'
const ID_FERME_A_LA_LECTRICE = '5eed0000-0000-4000-8000-0000000000c1'
const ID_INCONNU = '5eed0000-0000-4000-8000-00000000ffff'

const DETAIL_RECURRENT = `/tracks/studio-web/couts/${ID_RECURRENT}`
const DETAIL_CLOTURE = `/tracks/studio-web/couts/${ID_CLOTURE}`
const DETAIL_SANS_LIGNE = `/tracks/formation/couts/${ID_SANS_LIGNE}`
const DETAIL_FERME = `/tracks/conseil-ia/couts/${ID_FERME_A_LA_LECTRICE}`

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Le tableau équivalent de l'histogramme — §5.30. */
const tableauBarres = (page: Page) => page.getByRole('table', { name: /Équivalent textuel/ })

/** La table des lignes de coût — §4.3. */
const tableauLignes = (page: Page) => page.getByRole('table', { name: /Lignes de coût rattachées/ })

test.describe('CRM-086 — détail d’un budget (docs/SPEC-costs.md §4.3)', () => {
	test('S1 — UNE PAIRE DE BARRES PAR OCCURRENCE, là où l’écran du track n’en rend qu’une', async ({
		page,
	}) => {
		await connecter(page)

		// D'abord l'écran du §4.2, pour établir l'agrégat sur le MÊME jeu de données.
		await page.goto('/tracks/studio-web/couts')
		const agregat = tableauBarres(page).getByRole('row', { name: /Publicité 2026/ })
		await expect(agregat).toHaveCount(1)

		// Le nom du budget est un LIEN vers son détail : sans lui, cette adresse ne s'ouvrirait
		// d'aucun geste. Il est atteint depuis le tableau, jamais depuis la barre `aria-hidden`.
		await page.getByRole('link', { name: 'Voir le détail du budget Publicité 2026' }).click()
		await expect(page).toHaveURL(new RegExp(`${ID_RECURRENT}$`))

		// DEUX paires ici, une par occurrence, dans l'ordre des périodes : janvier avant février.
		const janvier = tableauBarres(page).getByRole('row', { name: /Janvier 2026/ })
		const fevrier = tableauBarres(page).getByRole('row', { name: /Février 2026/ })
		await expect(janvier).toHaveCount(1)
		await expect(fevrier).toHaveCount(1)
		await expect(janvier.getByRole('cell').nth(0)).toContainText('900')
		await expect(janvier.getByRole('cell').nth(1)).toContainText('880')
		await expect(fevrier.getByRole('cell').nth(0)).toContainText('100')
		// La quatrième colonne porte le COMPTE des lignes sans réel : février en porte une.
		await expect(fevrier.getByRole('cell').nth(2)).toHaveText('1')

		// Le total du détail est CELUI de l'agrégat du track : 1000 / 880. S'ils divergeaient, l'un
		// des deux écrans mentirait sur le même jeu de données.
		const total = tableauBarres(page).getByRole('row', { name: /Total/ })
		await expect(total.getByRole('cell').nth(0)).toContainText('000')
		await expect(total.getByRole('cell').nth(1)).toContainText('880')

		// La mention OBLIGATOIRE du §4.4, avec le même compte que sur l'écran du track.
		await expect(page.getByText(/1 ligne\(s\) sans coût réel saisi/)).toBeVisible()
	})

	test('S2 — la liste nomme l’affaire, la nature, l’estimé, le réel et l’auteur (§4.3)', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(DETAIL_RECURRENT)

		const lignes = tableauLignes(page)
		for (const colonne of ['Affaire', 'Nature', 'Prévisionnel', 'Réel', 'Auteur']) {
			await expect(lignes.getByRole('columnheader', { name: colonne })).toBeVisible()
		}

		// La ligne « Achat d'espace » porte son réel ; « Publicité » ne l'a pas, et sa cellule reste
		// VIDE — ni tiret, ni « non renseigné », ni zéro (§5.9, §2.3). C'est la principale façon dont
		// cet écran pourrait mentir : un `0 €` transformerait un retard de saisie en économie.
		const achat = lignes.getByRole('row', { name: /Achat d’espace|Achat d'espace/ })
		await expect(achat.getByRole('cell').nth(1)).toContainText('900')
		await expect(achat.getByRole('cell').nth(2)).toContainText('880')

		const publicite = lignes.getByRole('row', { name: /Publicité/ })
		await expect(publicite.getByRole('cell').nth(1)).toContainText('100')
		await expect(publicite.getByRole('cell').nth(2)).toHaveText('')

		// L'auteur des lignes du seed est l'administrateur : le nom est rendu, jamais un identifiant.
		await expect(lignes.getByText('Camille Aubert').first()).toBeVisible()
	})

	test('S3 — le titre de l’affaire mène à sa fiche, atteint au CLAVIER', async ({ page }) => {
		await connecter(page)
		await page.goto(DETAIL_RECURRENT)

		const affaire = tableauLignes(page)
			.getByRole('link', { name: /Refonte intranet Ville de Lyon/ })
			.first()
		await expect(affaire).toBeVisible()

		// Le focus est atteint par `Tab`, jamais par `focus()` : Chromium ne pose `:focus-visible`
		// que sur un focus réellement atteint au clavier (§8).
		await page.keyboard.press('Tab')
		for (
			let pas = 0;
			pas < 60 && !(await affaire.evaluate((n) => n === document.activeElement));
			pas++
		) {
			await page.keyboard.press('Tab')
		}
		await expect(affaire).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/cards\//)
	})

	test('S4 — le filtre par occurrence retient la liste, et NE MASQUE PAS les barres', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(DETAIL_RECURRENT)

		const filtre = page.getByLabel('Filtrer par occurrence')
		await expect(filtre).toBeVisible()
		await expect(tableauLignes(page).getByRole('row')).toHaveCount(3) // en-tête + deux lignes

		await filtre.selectOption({ label: 'Janvier 2026' })
		await expect(tableauLignes(page).getByRole('row')).toHaveCount(2)
		await expect(tableauLignes(page).getByText('Publicité')).toHaveCount(0)

		// L'histogramme reste celui du budget entier : le §4.3 rend la LISTE filtrable, jamais le
		// graphique — masquer une paire ferait perdre la comparaison entre occurrences, qui est
		// l'objet même de cet écran.
		await expect(tableauBarres(page).getByRole('row', { name: /Février 2026/ })).toHaveCount(1)

		// L'option vide LÈVE le filtre, comme l'option vide d'un champ le vide (§5.22).
		await filtre.selectOption({ label: 'Toutes les occurrences' })
		await expect(tableauLignes(page).getByRole('row')).toHaveCount(3)
	})

	test('S5 — un budget CLÔTURÉ garde ses lignes lisibles, et le dit (§2.3)', async ({ page }) => {
		await connecter(page)
		await page.goto(DETAIL_CLOTURE)

		// L'écran du §4.2 ne le liste PAS — c'est une règle d'écran —, mais son adresse répond, et
		// c'est ce que ce scénario établit : « clôturer n'efface pas l'histoire ».
		await expect(page.getByText(/Budget clôturé/)).toBeVisible()
		await expect(tableauLignes(page).getByRole('row', { name: /Production/ })).toHaveCount(1)
		// Un budget non récurrent rend une seule paire de barres, et n'offre AUCUN filtre.
		await expect(page.getByLabel('Filtrer par occurrence')).toHaveCount(0)
	})

	test('S6 — un budget SANS ligne rend ses deux barres nulles et sa phrase (§4.7)', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(DETAIL_SANS_LIGNE)

		await expect(page.getByText('Aucune dépense rattachée.')).toBeVisible()
		await expect(page.getByText('Aucune dépense rattachée à ce budget.')).toBeVisible()
		// La devise vient du BUDGET et non de la card (§2.3) : « Suisse romande » est en francs.
		await expect(page.getByRole('region', { name: /CHF/ })).toBeVisible()
		// Aucune mention du §4.4 : il n'y a aucune ligne, donc aucune ligne sans réel.
		await expect(page.getByText(/sans coût réel saisi/)).toHaveCount(0)
	})

	test('S7 — REFUSÉ, INCONNU ET MAL FORMÉ RENDENT LE MÊME ÉCRAN', async ({ page }) => {
		// La règle du §7 de `docs/SPEC-permissions-rls.md`. Les distinguer renseignerait un appelant
		// sans droit sur l'EXISTENCE d'un budget — et le nom « Prospection sortante » ne doit
		// apparaître nulle part, pas plus que son enveloppe.
		await connecter(page, VIEWER)

		await page.goto(DETAIL_FERME)
		await expect(page.getByText('Budget introuvable')).toBeVisible()
		await expect(page.getByText('Prospection sortante')).toHaveCount(0)
		await expect(page.getByText('12 000')).toHaveCount(0)

		await page.goto(`/tracks/studio-web/couts/${ID_INCONNU}`)
		await expect(page.getByText('Budget introuvable')).toBeVisible()

		await page.goto('/tracks/studio-web/couts/salon-2025')
		await expect(page.getByText('Budget introuvable')).toBeVisible()

		// Le retour mène aux coûts du track, jamais à la racine.
		await page.getByRole('link', { name: 'Revenir aux coûts du track' }).click()
		await expect(page).toHaveURL(/\/tracks\/studio-web\/couts$/)
	})

	test('S7 bis — l’ADMINISTRATRICE ouvre le même budget, et il est là', async ({ page }) => {
		// La contre-épreuve de S7, et sans elle S7 ne prouverait rien : « Budget introuvable » serait
		// indistinguable d'un budget réellement supprimé. Même adresse, autre profil.
		await connecter(page)
		await page.goto(DETAIL_FERME)
		await expect(page.getByText('Budget introuvable')).toHaveCount(0)
		await expect(tableauLignes(page).getByRole('row', { name: /Prospection terrain/ })).toHaveCount(
			1,
		)
	})

	test('S8 — captures aux quatre paliers, page jamais défilante horizontalement (§7)', async ({
		page,
	}) => {
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(DETAIL_RECURRENT)
			await expect(tableauBarres(page).getByRole('row', { name: /Janvier 2026/ })).toHaveCount(1)
			// « La page ne défile jamais horizontalement » (§7) : le graphique et les deux tableaux
			// débordent dans LEUR conteneur, que `contain: paint` empêche de propager sa largeur
			// intrinsèque jusqu'à la racine — le défaut mesuré à la décision 474.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(
				debordement,
				`aucun défilement horizontal de page à ${palier.nom}`,
			).toBeLessThanOrEqual(0)
			await capturer(page, `couts-budget-${palier.nom}`, UNITE)
		}
		// Aucune erreur console n'est attendue : la liste vide est le verdict.
		autoriserErreursConsole(page, [])
	})
})
