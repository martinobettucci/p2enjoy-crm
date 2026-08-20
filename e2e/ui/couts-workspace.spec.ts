// @verifies CRM-086 (docs/BACKLOG.md) — écrans de coûts, TRANCHE 5 : le parcours d'interface du
//           cumul des coûts du workspace
// @verifies docs/SPEC-costs.md §4.0 (l'adresse `/couts`, seule des trois à figurer dans `ROUTES`),
//           §4.5 (un groupe de barres par TRACK, cumul calculé APRÈS la RLS, un histogramme par
//           devise présente), §4.4 (« n lignes sans coût réel saisi, pour m € de prévisionnel »),
//           §4.7 (les états)
// @verifies docs/DESIGN_SYSTEM.md §4 (l'entrée transverse de la barre latérale), §5.33 (cet
//           écran), §5.30 (le graphique est `aria-hidden`, le tableau est sa version accessible ;
//           le lien vit dans le tableau), §5.8 (états), §7 (les quatre paliers), §8 (clavier)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// CE FICHIER NE MODIFIE RIEN, ET C'EST UNE CONTRAINTE DURE — la règle de `couts-track.spec.ts` et
// de `couts-budget.spec.ts`, reprise sans changement. `apply-seed.sh` compte les lignes de
// `card_costs` — QUATRE — et `supabase/tests/0049_card_costs.test.sql` s'appuie sur ce compte.
// L'écran du §4.5 est en lecture seule ; aucun scénario ne pose ni ne retire de ligne, et aucun
// épilogue de purge n'est donc nécessaire (décision 362 : la purge accompagne l'écriture).
//
// LES ASSERTIONS PORTENT SUR LE TABLEAU ÉQUIVALENT, ET NON SUR LES BARRES (§5.30) : le graphique
// est `aria-hidden` à dessein, et interroger les barres laisserait le tableau disparaître sans
// bruit — avec lui la seule lecture qui reste juste si la couleur ne passe pas.
//
// LA MESURE QUE CE FICHIER EXISTE POUR TENIR, ET QU'AUCUNE PREUVE UNITAIRE NE PEUT POSER : la
// Definition of Done de `CRM-086` demande que « le cumul du workspace soit mesuré APRÈS RLS — une
// preuve montre que le total d'un profil restreint diffère de celui d'un administrateur, et que la
// différence est exactement le budget qu'il ne lit pas ». `S4` et `S5` sont ce couple, et les
// nombres ci-dessous sont MESURÉS sur la pile réelle le 2026-08-20, avec les deux jetons :
//
//   * l'administrateur lit TROIS budgets ouverts — « Prospection sortante » (EUR, 800 estimé, sans
//     réel) sur « Conseil & IA », « Publicité 2026 » (EUR, 1000 estimé / 880 réel) sur « Studio
//     web », « Suisse romande » (CHF, aucune ligne) sur « Formation ». Total EUR : 1800 / 880 ;
//   * la lectrice lit les DEUX derniers seulement : le seed lui pose `track_members.access = 'none'`
//     sur « Conseil & IA », et la politique de `budgets` exige `app.can_read_track` (§3.1). Le
//     TRACK reste listé — il est visible de tout membre —, mais il ne porte plus aucune barre,
//     faute de budget lisible. Total EUR : 1000 / 880 ;
//   * la différence vaut donc 800, exactement l'estimé du budget qu'elle ne lit pas. C'est le
//     comportement VOULU : un total juste au centime près qui divulguerait par soustraction
//     l'existence d'un budget fermé serait un défaut d'autorisation, pas un défaut d'affichage.

import { autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-086'
const ADMIN = 'admin@p2enjoy.test'
/** La lectrice : `track_members.access = 'none'` sur « Conseil & IA » (seed, §8 quaterdecies). */
const VIEWER = 'viewer@p2enjoy.test'

const CUMUL = '/couts'

const TRACK_FERME_A_LA_LECTRICE = 'Conseil & IA'
const TRACK_OUVERT = 'Studio web'
const TRACK_EN_FRANCS = 'Formation'
const BUDGET_FERME_A_LA_LECTRICE = 'Prospection sortante'

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** La ligne du tableau équivalent d'un track donné — §5.30. */
const ligneTrack = (page: Page, nom: string) => page.getByRole('row', { name: new RegExp(nom) })

/** Le total d'un histogramme de devise : la ligne de pied de SON tableau. */
const totalDe = (page: Page, devise: string) =>
	page.getByRole('region', { name: new RegExp(devise) }).getByRole('row', { name: /Total/ })

test.describe('CRM-086 — cumul des coûts du workspace (docs/SPEC-costs.md §4.5)', () => {
	test('S1 — un groupe de barres PAR TRACK, cumulant ses budgets ouverts', async ({ page }) => {
		await connecter(page)
		await page.goto(CUMUL)

		// Deux tracks portent des budgets en euros ; le troisième est en francs et vit dans son
		// propre histogramme (S2). « Conseil & IA » vaut 800 d'estimé et aucun réel ; « Studio web »
		// cumule les deux occurrences de « Publicité 2026 » — 100 + 900 — en UNE paire de barres.
		const conseil = ligneTrack(page, TRACK_FERME_A_LA_LECTRICE)
		await expect(conseil).toHaveCount(1)
		await expect(conseil.getByRole('cell').nth(0)).toContainText('800')

		const studio = ligneTrack(page, TRACK_OUVERT)
		await expect(studio).toHaveCount(1)
		await expect(studio.getByRole('cell').nth(0)).toContainText('000')
		await expect(studio.getByRole('cell').nth(1)).toContainText('880')
		// La quatrième colonne porte le COMPTE des lignes sans réel — le nombre que le badge de
		// l'onglet « À saisir » devra rendre à l'identique (§4.8).
		await expect(studio.getByRole('cell').nth(2)).toHaveText('1')

		// Le budget CLÔTURÉ « Salon du web 2025 » n'entre dans aucun cumul, et le total le prouve :
		// 1800 et non 2150. Son absence se mesure sur le total, jamais sur l'absence d'une ligne —
		// aucune ligne ne porte le nom d'un budget sur cet écran.
		const total = totalDe(page, 'EUR')
		await expect(total.getByRole('cell').nth(0)).toContainText('800')
		await expect(total.getByRole('cell').nth(1)).toContainText('880')

		// La mention OBLIGATOIRE du §4.4, avec son compte ET son montant : deux lignes sans réel —
		// « Publicité » (100) et « Prospection terrain » (800) —, pour 900 de prévisionnel.
		await expect(page.getByText(/2 ligne\(s\) sans coût réel saisi/)).toBeVisible()
		await expect(page.getByText(/pour 900/)).toBeVisible()
	})

	test('S2 — UN histogramme PAR DEVISE, et le franc n’est jamais mêlé à l’euro (§4.5)', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(CUMUL)

		// Deux régions étiquetées, deux tableaux : « les devises ne se mélangent pas », et un axe
		// unique placerait des francs et des euros sur la même échelle.
		await expect(page.getByRole('region', { name: /EUR/ })).toBeVisible()
		await expect(page.getByRole('region', { name: /CHF/ })).toBeVisible()
		await expect(page.getByRole('table')).toHaveCount(2)
		// ET CHAQUE HISTOGRAMME PORTE SON TITRE VISIBLE — défaut trouvé en regardant une capture
		// (`CLAUDE.md` §16) : cet écran est la première surface du produit où deux histogrammes
		// s'empilent réellement, et rien à l'œil ne disait que le second comptait des francs.
		await expect(page.getByRole('heading', { name: 'Coûts en EUR' })).toBeVisible()
		await expect(page.getByRole('heading', { name: 'Coûts en CHF' })).toBeVisible()

		// « Formation » n'a de barres que dans l'histogramme en francs, et son budget n'y porte
		// aucune ligne : le §4.7 exige deux barres nulles ET la phrase.
		const francs = page.getByRole('region', { name: /CHF/ })
		await expect(francs.getByRole('row', { name: new RegExp(TRACK_EN_FRANCS) })).toHaveCount(1)
		await expect(francs.getByText('Aucune dépense rattachée.')).toBeVisible()
		// Aucune mention du §4.4 dans cette devise : aucune ligne, donc aucune ligne sans réel.
		await expect(francs.getByText(/sans coût réel saisi/)).toHaveCount(0)
	})

	test('S3 — l’entrée « Coûts » de la barre latérale mène ici, atteinte au CLAVIER', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto('/')

		// La barre latérale est un `aside` « Barre latérale » qui porte une `nav` « Navigation
		// principale » (§4, §8 : un point de repère sans nom serait indiscernable) ; c'est cette
		// dernière qui énumère les entrées transverses.
		const entree = page
			.getByRole('navigation', { name: 'Navigation principale' })
			.getByRole('link', { name: 'Coûts' })
		await expect(entree).toBeVisible()
		// Le focus est atteint par `Tab`, jamais par `focus()` : Chromium ne pose `:focus-visible`
		// que sur un focus réellement atteint au clavier (§8).
		await page.keyboard.press('Tab')
		for (
			let pas = 0;
			pas < 40 && !(await entree.evaluate((n) => n === document.activeElement));
			pas++
		) {
			await page.keyboard.press('Tab')
		}
		await expect(entree).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`${CUMUL}$`))
		// L'entrée courante se signale par `aria-current`, pas seulement par la couleur (§1).
		await expect(entree).toHaveAttribute('aria-current', 'page')
	})

	test('S3 bis — le libellé d’un track MÈNE à ses coûts, depuis le tableau et non la barre', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(CUMUL)

		// Sans ce lien, cet écran serait une impasse : on y lirait qu'un track dépense sans aucun
		// moyen d'aller voir QUELS budgets. Il vit dans le tableau équivalent, jamais sur la barre
		// que le §5.30 rend `aria-hidden` — une cible interactive y serait perdue au clavier.
		const lien = page.getByRole('link', { name: `Voir les coûts du track ${TRACK_OUVERT}` })
		await expect(lien).toBeVisible()
		await lien.click()
		await expect(page).toHaveURL(/\/tracks\/studio-web\/couts$/)
		// L'écran d'arrivée est bien celui du §4.2 : une paire de barres PAR BUDGET, et non par track.
		await expect(page.getByRole('row', { name: /Publicité 2026/ })).toHaveCount(1)
	})

	test('S4 — LE TOTAL DE LA LECTRICE DIFFÈRE DE CELUI DE L’ADMINISTRATEUR (§4.5)', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		await page.goto(CUMUL)

		// Le track lui reste listé partout ailleurs dans le produit — il est visible de tout membre
		// de l'espace de travail —, mais il ne porte ici AUCUNE barre : ses budgets lui sont fermés,
		// et un track sans budget lisible n'a pas de paire de barres.
		await expect(ligneTrack(page, TRACK_FERME_A_LA_LECTRICE)).toHaveCount(0)
		await expect(page.getByText(BUDGET_FERME_A_LA_LECTRICE)).toHaveCount(0)
		// Ni son nom, ni son montant : le total ne le divulgue pas davantage par soustraction.
		await expect(page.getByText('800')).toHaveCount(0)

		// Son total en euros est celui du seul track dont elle lit les budgets — 1000 / 880.
		const total = totalDe(page, 'EUR')
		await expect(total.getByRole('cell').nth(0)).toContainText('000')
		await expect(total.getByRole('cell').nth(1)).toContainText('880')
		// Et sa mention du §4.4 ne compte qu'UNE ligne sans réel, là où l'administrateur en compte
		// deux : le compte suit la lecture, il n'est jamais absolu.
		await expect(page.getByText(/1 ligne\(s\) sans coût réel saisi/)).toBeVisible()
		await expect(page.getByText(/pour 100/)).toBeVisible()

		// L'écran DIT que son cumul est borné à ce qu'elle lit. Sans cette phrase, l'écart avec le
		// total d'un collègue se lirait comme une erreur de calcul.
		await expect(page.getByText(/ne porte que sur les budgets ouverts des tracks que vous/)).toBeVisible()
	})

	test('S5 — LA CONTRE-ÉPREUVE : l’administrateur lit 800 de plus, exactement le budget fermé', async ({
		page,
	}) => {
		// Sans elle, `S4` ne prouverait rien : un total de 1000 serait indistinguable d'un workspace
		// qui ne porte que ce budget-là. Le même écran, les mêmes données, un autre profil.
		await connecter(page)
		await page.goto(CUMUL)

		await expect(ligneTrack(page, TRACK_FERME_A_LA_LECTRICE)).toHaveCount(1)
		const total = totalDe(page, 'EUR')
		await expect(total.getByRole('cell').nth(0)).toContainText('800')
		// La DIFFÉRENCE est mesurée, et pas seulement la présence d'une ligne de plus : 1800 − 1000
		// vaut 800, l'estimé de « Prospection sortante » et rien d'autre. C'est ce que la Definition
		// of Done demande de prouver, et une preuve qui n'observerait que le nombre de lignes ne
		// dirait pas si le cumul a été calculé avant ou après la RLS.
		const estime = await total.getByRole('cell').nth(0).innerText()
		const chiffres = Number(estime.replace(/[^0-9]/g, ''))
		expect(chiffres, 'le total de l’administrateur vaut 1800 €').toBe(1800)
		// Le compte des lignes sans réel suit la même règle : deux pour lui, une pour elle.
		await expect(total.getByRole('cell').nth(2)).toHaveText('2')
	})

	test('S6 — captures aux quatre paliers, page jamais défilante horizontalement (§7)', async ({
		page,
	}) => {
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(CUMUL)
			await expect(ligneTrack(page, TRACK_OUVERT)).toHaveCount(1)
			// « La page ne défile jamais horizontalement » (§7) : le graphique et le tableau
			// débordent dans LEUR conteneur, que `contain: paint` empêche de propager sa largeur
			// intrinsèque jusqu'à la racine — le défaut mesuré à la décision 474.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, `aucun défilement horizontal de page à ${palier.nom}`).toBeLessThanOrEqual(
				0,
			)
			await capturer(page, `couts-workspace-${palier.nom}`, UNITE)
		}
		// Aucune erreur console n'est attendue : la liste vide est le verdict (§3 du prompt).
		autoriserErreursConsole(page, [])
	})
})
