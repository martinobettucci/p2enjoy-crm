// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 3 : le parcours d'interface de
//           l'écran de coûts d'un track
// @verifies docs/SPEC-costs.md §4.0 (l'adresse `/tracks/:slugTrack/couts`), §4.2 (deux barres par
//           budget, un budget RÉCURRENT agrégé toutes occurrences confondues, un budget CLÔTURÉ
//           qui n'y figure pas), §4.4 (« n lignes sans coût réel saisi, pour m € de
//           prévisionnel »), §4.5 (les devises ne se mélangent pas), §4.7 (les états)
// @verifies docs/DESIGN_SYSTEM.md §4 (l'entrée transverse de la barre d'onglets), §5.30 (le
//           graphique est `aria-hidden`, le tableau est sa version accessible ; la légende nomme
//           les séries), §5.8 (états), §7 (les quatre paliers), §8 (clavier), §12.1
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// CE FICHIER NE MODIFIE RIEN, ET C'EST UNE CONTRAINTE DURE. `apply-seed.sh` compte les lignes de
// `card_costs` — QUATRE — et `supabase/tests/0049_card_costs.test.sql` s'appuie sur ce compte.
// L'écran du §4.2 est en lecture seule ; aucun scénario ne pose ni ne retire de ligne, et aucun
// épilogue de purge n'est donc nécessaire (règle de la décision 362 : la purge accompagne
// l'écriture, pas la lecture).
//
// LES ASSERTIONS PORTENT SUR LE TABLEAU ÉQUIVALENT, ET NON SUR LES BARRES. Le §5.30 fait du
// tableau la version accessible du graphique, lequel est `aria-hidden` à dessein. Interroger les
// barres laisserait le tableau disparaître sans bruit, et avec lui la seule lecture qui reste
// juste si la couleur ne passe pas.
//
// LES DEUX MESURES QUE CE FICHIER EXISTE POUR TENIR, et qu'aucune preuve unitaire ne peut poser :
//
//   1. **le budget récurrent est AGRÉGÉ.** « Publicité 2026 » porte deux occurrences — « Janvier
//      2026 » et « Février 2026 » —, chacune avec sa ligne. Le §4.2 exige UNE seule paire de
//      barres pour lui sur cet écran, et c'est le §4.3 qui le détaillera par occurrence. Deux
//      lignes dans le tableau seraient l'écran du §4.3 rendu à l'adresse du §4.2 ;
//   2. **le budget CLÔTURÉ n'y figure pas.** « Salon du web 2025 » est clos et porte 350 estimé /
//      375 réel. Sa présence ferait passer le total du track de 1000/880 à 1350/1255 : l'absence
//      se mesure donc sur le total, et pas seulement sur l'absence d'une ligne.

import { autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-086'
const ADMIN = 'admin@p2enjoy.test'
/**
 * La lectrice. Le seed lui pose `track_members.access = 'none'` sur « Conseil & IA », et c'est le
 * couple que `card-costs.spec.ts` exerce déjà.
 *
 * **CE QUE LA MESURE A CORRIGÉ, ET LA PREUVE EN SORT PLUS FORTE.** Ce scénario attendait d'abord
 * « Track introuvable » sur ce track. C'est FAUX, et l'exécution l'a montré : le track lui-même
 * reste listé et son nom titre la route — il est visible de tout membre de l'espace de travail —,
 * tandis que ses BUDGETS lui sont fermés, la politique du §3.1 exigeant `app.can_read_track`.
 * L'écran rend donc « Aucun budget sur ce track », et c'est exactement la propriété du §4.5 : le
 * profil restreint voit MOINS, et l'écran ne lui annonce aucun manque — un écran qui écrirait
 * « un budget vous est masqué » divulguerait par la bande ce que la RLS ferme.
 */
const VIEWER = 'viewer@p2enjoy.test'

const COUTS_STUDIO = '/tracks/studio-web/couts'
const COUTS_FORMATION = '/tracks/formation/couts'
const COUTS_CONSEIL = '/tracks/conseil-ia/couts'

const BUDGET_RECURRENT = 'Publicité 2026'
const BUDGET_CLOTURE = 'Salon du web 2025'
const BUDGET_SANS_LIGNE = 'Suisse romande'

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** La ligne du tableau équivalent d'un budget donné — §5.30. */
const ligneBudget = (page: Page, nom: string) => page.getByRole('row', { name: new RegExp(nom) })

test.describe('CRM-086 — écran de coûts du track (docs/SPEC-costs.md §4.2)', () => {
	test('S1 — un budget récurrent est AGRÉGÉ, un budget clôturé n’y figure pas', async ({ page }) => {
		await connecter(page)
		await page.goto(COUTS_STUDIO)

		// Une seule paire de barres pour le budget récurrent, toutes occurrences confondues : 100 +
		// 900 d'estimé, 880 de réel, et la ligne « Publicité » qui n'a pas de réel.
		const recurrent = ligneBudget(page, BUDGET_RECURRENT)
		await expect(recurrent).toHaveCount(1)
		const cellules = recurrent.getByRole('cell')
		await expect(cellules.nth(0)).toContainText('1')
		await expect(cellules.nth(0)).toContainText('000')
		await expect(cellules.nth(1)).toContainText('880')
		// La quatrième colonne porte le COMPTE des lignes sans réel — le nombre que le badge de
		// l'onglet « À saisir » devra rendre à l'identique (§4.8).
		await expect(cellules.nth(2)).toHaveText('1')

		// Le budget CLÔTURÉ est absent, et le total le prouve : 1000/880 et non 1350/1255.
		await expect(page.getByText(BUDGET_CLOTURE)).toHaveCount(0)
		const total = page.getByRole('row', { name: /Total/ })
		await expect(total.getByRole('cell').nth(0)).toContainText('000')
		await expect(total.getByRole('cell').nth(1)).toContainText('880')

		// La mention OBLIGATOIRE du §4.4, avec son compte ET son montant.
		await expect(page.getByText(/1 ligne\(s\) sans coût réel saisi/)).toBeVisible()
		await expect(page.getByText(/pour 100/)).toBeVisible()
	})

	test('S2 — la légende nomme les séries, et le graphique est `aria-hidden` (§5.30)', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(COUTS_STUDIO)

		// La couleur ne porte jamais seule l'information : les trois séries sont nommées.
		await expect(page.getByText('Prévisionnel', { exact: true })).toHaveCount(2)
		await expect(page.getByText('Réel dépassant le prévisionnel')).toBeVisible()

		// Le graphique n'est pas exposé : c'est le tableau qui est la version accessible, et les
		// exposer tous les deux ferait énoncer deux fois la même série.
		await expect(page.getByRole('table')).toHaveCount(1)
		await expect(page.locator('[aria-hidden="true"]').first()).toBeAttached()
	})

	test('S3 — l’entrée « Coûts » de la barre d’onglets mène ici, atteinte au CLAVIER', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto('/tracks/studio-web')

		const couts = page.getByTestId('onglet-couts-track')
		await expect(couts).toBeVisible()
		// Le focus est atteint par `Tab`, jamais par `focus()` : Chromium ne pose `:focus-visible`
		// que sur un focus réellement atteint au clavier (§8).
		await page.keyboard.press('Tab')
		for (let pas = 0; pas < 30 && !(await couts.evaluate((n) => n === document.activeElement)); pas++) {
			await page.keyboard.press('Tab')
		}
		await expect(couts).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`${COUTS_STUDIO}$`))
		// L'entrée courante se signale par `aria-current`, pas seulement par la couleur (§1).
		await expect(page.getByTestId('onglet-couts-track')).toHaveAttribute('aria-current', 'page')
	})

	test('S4 — un budget SANS ligne rend deux barres nulles et sa phrase (§4.7)', async ({ page }) => {
		await connecter(page)
		await page.goto(COUTS_FORMATION)

		// « Suisse romande » est en CHF et ne porte aucune ligne : il est rendu, à zéro, avec la
		// phrase du §4.7 — deux barres nulles sans texte se lisent comme un défaut d'affichage.
		await expect(ligneBudget(page, BUDGET_SANS_LIGNE)).toHaveCount(1)
		await expect(page.getByText('Aucune dépense rattachée.')).toBeVisible()
		// La devise du track est le franc : le §4.5 interdit de mêler les devises sur un axe, et
		// c'est l'étiquette qui le dit ici.
		await expect(page.getByRole('region', { name: /CHF/ })).toBeVisible()
		// Aucune mention du §4.4 : il n'y a aucune ligne, donc aucune ligne sans réel. L'afficher à
		// zéro transformerait une bonne nouvelle en avertissement permanent.
		await expect(page.getByText(/sans coût réel saisi/)).toHaveCount(0)
	})

	test('S5 — LE TOTAL DE LA LECTRICE EST CELUI QUE LA RLS LUI CONSENT (§4.5)', async ({ page }) => {
		await connecter(page, VIEWER)

		// Track dont les budgets lui sont ouverts : l'écran est rendu, en lecture seule — aucune
		// commande d'écriture n'existe sur cette surface, ni pour elle ni pour un administrateur
		// (§4.7, « lecture seule »).
		await page.goto(COUTS_FORMATION)
		await expect(ligneBudget(page, BUDGET_SANS_LIGNE)).toHaveCount(1)
		await expect(page.getByRole('button', { name: /Créer|Ajouter|Modifier/ })).toHaveCount(0)

		// Track dont les budgets lui sont FERMÉS. L'écran rend l'état « aucun budget », le budget
		// n'est nommé nulle part, et son montant n'apparaît pas davantage : un total juste au
		// centime près qui divulguerait par soustraction l'existence d'un budget fermé serait un
		// défaut d'autorisation, pas un défaut d'affichage.
		await page.goto(COUTS_CONSEIL)
		await expect(page.getByText('Aucun budget sur ce track')).toBeVisible()
		await expect(page.getByText('Prospection sortante')).toHaveCount(0)
		await expect(page.getByText('800')).toHaveCount(0)
	})

	test('S5 bis — l’administrateur voit sur CE MÊME track le budget que la lectrice ne voit pas', async ({
		page,
	}) => {
		// La contre-épreuve de S5, et sans elle S5 ne prouverait rien : « aucun budget » serait
		// indistinguable d'un track qui n'en porte réellement aucun. Le même écran, le même track,
		// un autre profil, et le budget est là.
		await connecter(page)
		await page.goto(COUTS_CONSEIL)
		await expect(ligneBudget(page, 'Prospection sortante')).toHaveCount(1)
		await expect(page.getByText('Aucun budget sur ce track')).toHaveCount(0)
	})

	test('S6 — captures aux quatre paliers, page jamais défilante horizontalement (§7)', async ({
		page,
	}) => {
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(COUTS_STUDIO)
			await expect(ligneBudget(page, BUDGET_RECURRENT)).toHaveCount(1)
			// « La page ne défile jamais horizontalement » (§7) : le graphique et le tableau
			// débordent dans LEUR conteneur, que `contain: paint` empêche de propager sa largeur
			// intrinsèque jusqu'à la racine — c'est le défaut mesuré à la décision 474.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, `aucun défilement horizontal de page à ${palier.nom}`).toBeLessThanOrEqual(0)
			await capturer(page, `couts-track-${palier.nom}`, UNITE)
		}
		// Aucune erreur console n'est attendue : la liste vide est le verdict (§3 du prompt).
		autoriserErreursConsole(page, [])
	})
})
