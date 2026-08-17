// @verifies CRM-081 (docs/BACKLOG.md) — tranche 2 b : le filtre du board et de la vue liste
// @verifies docs/SPEC-cards.md §16.2 (« en sommeil » = non nulle ET future), §16.12.1 (le prédicat
//           d'exclusion), §16.12.3 (board à la composition, liste au serveur), §16.12.4 (la bascule
//           dans l'adresse, et sa conservation d'une vue à l'autre), §16.12.5 (« effacer les
//           filtres » efface celui-ci aussi), §16.12.6 (les états vides cessent de mentir),
//           §16.12.7 (la marque), §16.12.8 (le compteur), §16.12.9 (ligne « E2E d'interface » et
//           ligne « Visuel »)
// @verifies docs/DESIGN_SYSTEM.md §5.3 quinquies (la bascule, la pastille compacte, la densité du
//           tableau, l'état vide qui porte son action), §7 (paliers), §8 (accessibilité)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE : ces scénarios se connectent réellement et lisent les affaires
// **du seed** par la vraie route. C'est l'objet même de la preuve — la tranche 2 a avait livré la
// pastille de la FICHE, et son écart nommé était qu'aucune vue ne filtrait.
//
// LES DEUX AFFAIRES SONT CELLES QUE LE SEED POSE (§16.11.6), et elles sont complémentaires :
// `…00ca` dort dans `prospection` — échéance à dix jours —, et `…00c1` porte dans `grands-comptes`
// une échéance ÉCHUE, qui ne doit ni la masquer ni la marquer. Sans la seconde, rien ne
// distinguerait « masquer les endormies » de « masquer toute affaire portant une échéance ».
//
// LE SEED SORT INTACT : aucun scénario n'endort ni ne réveille quoi que ce soit. Le filtre ne
// s'écrit que dans l'adresse, et l'adresse n'est pas une écriture.

import { autoriserErreursConsole, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-081'
const ADMIN = 'admin@p2enjoy.test'

/** Le libellé de la bascule, écrit une fois : c'est le nom accessible que les deux vues portent. */
const AFFICHER = 'Afficher les affaires en sommeil'

/**
 * `prospection` porte l'affaire réellement endormie : 2 affaires actives, 1 éveillée.
 * MESURÉ le 2026-08-17 (docs/SPEC-cards.md §16.12.1).
 */
const PROSPECTION = {
	board: '/tracks/conseil-ia/prospection',
	liste: '/tracks/conseil-ia/prospection/liste',
	endormie: 'Cadrage data — Groupe Vallier',
	eveillee: 'Assistant IA support — Nordis',
}

/** `grands-comptes` porte l'affaire au sommeil ÉCHU : 4 affaires actives dans les deux modes. */
const GRANDS_COMPTES = {
	board: '/tracks/conseil-ia/grands-comptes',
	liste: '/tracks/conseil-ia/grands-comptes/liste',
	echue: 'Refonte du site vitrine',
}

/**
 * Coche ou décoche la bascule, puis ATTEND l'état voulu.
 *
 * `locator.check()` N'EST PAS EMPLOYÉ ICI, et le motif est mesuré : il clique puis relit l'état de
 * la case **une seule fois**, sans attendre. Or la case est contrôlée par l'adresse — le clic
 * déclenche une navigation, React réécrit le sous-arbre, et la relecture tombe avant le commit.
 * Playwright rend alors « Clicking the checkbox did not change its state » alors que la page finit
 * bel et bien dans l'état demandé : la capture d'échec montrait la case `[checked]`, l'affaire
 * endormie visible et sa pastille rendue.
 *
 * Un clic suivi d'une assertion qui, elle, réessaie, éprouve la même chose sans dépendre de
 * l'instant du commit.
 */
async function basculer(page: Page, veutVisibles: boolean): Promise<void> {
	const case_ = page.getByRole('checkbox', { name: AFFICHER })
	await case_.click()
	if (veutVisibles) await expect(case_).toBeChecked()
	else await expect(case_).not.toBeChecked()
}

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('le board masque, ramène et marque (docs/SPEC-cards.md §16.12.3, §16.12.7)', () => {
	test('l’affaire endormie du seed n’est pas sur le board, et la bascule la ramène avec sa pastille', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(PROSPECTION.board)

		// Le défaut MASQUE, sans que l'adresse ne porte rien : c'est la Definition of Done elle-même.
		await expect(page.getByRole('link', { name: PROSPECTION.eveillee })).toBeVisible()
		await expect(page.getByRole('link', { name: PROSPECTION.endormie })).toHaveCount(0)
		await expect(page.getByTestId('pastille-sommeil')).toHaveCount(0)
		await capturer(page, 'filtre-sommeil-board-masquees-1440', UNITE)

		// La bascule est une case à cocher étiquetée, atteignable par son nom accessible (§5.3 quinquies).
		await basculer(page, true)

		await expect(page.getByRole('link', { name: PROSPECTION.endormie })).toBeVisible()
		// ELLE EST MARQUÉE (§16.12.7) : sans marque, « afficher » reviendrait à noyer.
		await expect(page.getByTestId('pastille-sommeil')).toHaveCount(1)
		await capturer(page, 'filtre-sommeil-board-visibles-1440', UNITE)

		// LE MODE VIT DANS L'ADRESSE (§16.12.4) : c'est ce qui rend la vue partageable et ce qui permet
		// à la bascule de vue de le transporter.
		expect(new URL(page.url()).searchParams.get('sommeil')).toBe('visibles')
	})

	// LE DÉFAUT NE S'ÉCRIT JAMAIS DANS L'ADRESSE : la vue par défaut reste l'adresse la plus courte.
	test('décocher la bascule retire le paramètre de l’adresse, plutôt que d’y écrire le défaut', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(`${PROSPECTION.board}?sommeil=visibles`)
		await expect(page.getByRole('link', { name: PROSPECTION.endormie })).toBeVisible()

		await basculer(page, false)
		await expect(page.getByRole('link', { name: PROSPECTION.endormie })).toHaveCount(0)
		expect(new URL(page.url()).searchParams.has('sommeil')).toBe(false)
	})

	// UNE ÉCHÉANCE ÉCHUE N'EST PAS UN SOMMEIL (§16.2) : l'affaire est là dans les deux modes, et sans
	// pastille. C'est le côté du prédicat qu'une preuve pressée oublierait.
	test('l’affaire au sommeil échu est sur le board dans les DEUX modes, et sans pastille', async ({
		page,
	}) => {
		await connecter(page)
		for (const adresse of [GRANDS_COMPTES.board, `${GRANDS_COMPTES.board}?sommeil=visibles`]) {
			await page.goto(adresse)
			await expect(page.getByRole('link', { name: GRANDS_COMPTES.echue })).toBeVisible()
			await expect(page.getByTestId('pastille-sommeil')).toHaveCount(0)
		}
	})

	// La barre reste rendue même quand le board ne montre aucune carte : elle est la cause possible
	// de ce vide (§5.3 quinquies). Le cas est éprouvé sur une adresse d'étape inexistante ? Non — sur
	// le board réel, il suffit que la bascule soit là dans les deux modes.
	test('la barre de bascule est rendue dans les deux modes', async ({ page }) => {
		await connecter(page)
		for (const adresse of [PROSPECTION.board, `${PROSPECTION.board}?sommeil=visibles`]) {
			await page.goto(adresse)
			await expect(page.getByTestId('barre-sommeil-board')).toBeVisible()
			await expect(page.getByRole('checkbox', { name: AFFICHER })).toBeVisible()
		}
	})
})

test.describe('la vue liste masque au serveur, et son total suit (§16.12.3, §12.5)', () => {
	test('le total passe de 1 à 2 quand la bascule ramène l’affaire endormie', async ({ page }) => {
		await connecter(page)
		await page.goto(PROSPECTION.liste)

		// LE TOTAL EST CELUI DES LIGNES FILTRÉES (§16.12.8) : il varie avec la bascule, et c'est la
		// propriété attendue — un total qui ne bougerait pas annoncerait des lignes introuvables.
		await expect(page.getByTestId('total-liste')).toHaveText('Affaires : 1')
		await expect(page.getByRole('link', { name: PROSPECTION.endormie })).toHaveCount(0)
		await expect(page.getByTestId('pastille-sommeil')).toHaveCount(0)
		await capturer(page, 'filtre-sommeil-liste-masquees-1440', UNITE)

		await basculer(page, true)

		await expect(page.getByTestId('total-liste')).toHaveText('Affaires : 2')
		await expect(page.getByRole('link', { name: PROSPECTION.endormie })).toBeVisible()
		await expect(page.getByTestId('pastille-sommeil')).toHaveCount(1)
		await capturer(page, 'filtre-sommeil-liste-visibles-1440', UNITE)
	})

	test('`grands-comptes` rend ses quatre affaires dans les deux modes, sans pastille', async ({
		page,
	}) => {
		await connecter(page)
		for (const adresse of [GRANDS_COMPTES.liste, `${GRANDS_COMPTES.liste}?sommeil=visibles`]) {
			await page.goto(adresse)
			await expect(page.getByTestId('total-liste')).toHaveText('Affaires : 4')
			await expect(page.getByRole('link', { name: GRANDS_COMPTES.echue })).toBeVisible()
			await expect(page.getByTestId('pastille-sommeil')).toHaveCount(0)
		}
	})

	// LA DENSITÉ NE BOUGE PAS (§12.7, §5.9) : la pastille est `shrink-0` après le lien, et la ligne
	// garde la hauteur d'une seule ligne de texte. Mesuré sur la ligne rendue, non sur une classe.
	test('la ligne marquée garde la hauteur d’une ligne de texte', async ({ page }) => {
		await connecter(page)
		await page.goto(`${PROSPECTION.liste}?sommeil=visibles`)
		const lignes = page.getByTestId('ligne-card')
		await expect(lignes).toHaveCount(2)
		const hauteurs: number[] = []
		for (const ligne of await lignes.all()) {
			const boite = await ligne.boundingBox()
			expect(boite).not.toBeNull()
			hauteurs.push(boite?.height ?? 0)
		}
		// Les deux lignes ont la MÊME hauteur : celle qui porte la pastille n'a pas grandi.
		expect(hauteurs[0]).toBeCloseTo(hauteurs[1] ?? 0, 0)
	})

	// « EFFACER LES FILTRES » EFFACE CELUI-CI AUSSI (§16.12.5), et il apparaît sur une liste dont la
	// seule différence est que les endormies y sont visibles.
	test('« Effacer les filtres » ramène la liste à son état nu, sommeil compris', async ({ page }) => {
		await connecter(page)
		await page.goto(`${PROSPECTION.liste}?sommeil=visibles`)
		await expect(page.getByTestId('total-liste')).toHaveText('Affaires : 2')

		const effacer = page.getByTestId('effacer-filtres')
		await expect(effacer).toBeVisible()
		await effacer.click()

		await expect(page.getByTestId('total-liste')).toHaveText('Affaires : 1')
		expect(new URL(page.url()).searchParams.has('sommeil')).toBe(false)
	})

	test('aucune action d’effacement sur une liste réellement nue', async ({ page }) => {
		await connecter(page)
		await page.goto(PROSPECTION.liste)
		await expect(page.getByTestId('effacer-filtres')).toHaveCount(0)
	})
})

test.describe('le paramètre survit au passage d’une vue à l’autre (§16.12.4)', () => {
	// Un utilisateur qui a demandé à voir les affaires endormies ne redemande pas à chaque changement
	// de vue. Éprouvé dans les DEUX sens, par les liens réels de la bascule.
	test('board → liste conserve le mode, et liste → board aussi', async ({ page }) => {
		await connecter(page)
		await page.goto(`${PROSPECTION.board}?sommeil=visibles`)
		await expect(page.getByRole('link', { name: PROSPECTION.endormie })).toBeVisible()

		await page.getByTestId('lien-vue').filter({ hasText: 'Liste' }).click()
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		expect(new URL(page.url()).searchParams.get('sommeil')).toBe('visibles')
		await expect(page.getByTestId('total-liste')).toHaveText('Affaires : 2')
		await expect(page.getByRole('checkbox', { name: AFFICHER })).toBeChecked()

		await page.getByTestId('lien-vue').filter({ hasText: 'Tableau' }).click()
		await expect(page.getByTestId('board')).toBeVisible()
		expect(new URL(page.url()).searchParams.get('sommeil')).toBe('visibles')
		await expect(page.getByRole('link', { name: PROSPECTION.endormie })).toBeVisible()
	})

	// IL EST LE SEUL PARAMÈTRE QUE LA BASCULE TRAÎNE : le tri et la recherche n'ont aucun sens sur un
	// board, et les traîner écrirait dans l'adresse d'une vue ce que l'autre ignore.
	test('la bascule de vue ne traîne ni tri ni recherche vers le board', async ({ page }) => {
		await connecter(page)
		await page.goto(`${PROSPECTION.liste}?sommeil=visibles&tri=amount&q=cadrage`)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		await page.getByTestId('lien-vue').filter({ hasText: 'Tableau' }).click()
		const parametres = new URL(page.url()).searchParams
		expect(parametres.get('sommeil')).toBe('visibles')
		expect(parametres.has('tri')).toBe(false)
		expect(parametres.has('q')).toBe(false)
	})
})

test.describe('l’état vide cesse de mentir (§16.12.6)', () => {
	// LE DÉFAUT MASQUE, donc un écran vide n'est plus la preuve d'un channel vide. Le cas est
	// provoqué par un FILTRE D'ÉTAPE qui ne laisse que l'affaire endormie : la liste n'a alors aucune
	// ligne éveillée à montrer, et son état vide doit le dire sans prétendre que le channel est vide.
	//
	// L'étape est choisie sur la fiche de l'affaire endormie plutôt que codée en dur : un identifiant
	// d'étape recopié ici serait lié au seed, exactement la famille de défaut que la tranche 2 a a
	// corrigée quatre fois.
	test('une liste dont il ne reste que des affaires endormies porte l’action qui les révèle', async ({
		page,
	}) => {
		await connecter(page)
		await page.goto(`${PROSPECTION.liste}?sommeil=visibles`)

		// L'étape de l'affaire endormie, lue à l'écran.
		const ligne = page.getByTestId('ligne-card').filter({ hasText: PROSPECTION.endormie })
		await expect(ligne).toHaveCount(1)
		const etape = (await ligne.locator('td').nth(2).innerText()).trim()
		expect(etape.length).toBeGreaterThan(0)

		// Le même filtre d'étape, mode masqué : si l'autre affaire occupe une autre étape, il ne reste
		// rien d'éveillé à montrer.
		await page.getByTestId('filtre-etape').selectOption({ label: etape })
		await basculer(page, false)

		const total = await page.getByTestId('total-liste').innerText()
		if (total === 'Affaires : 0') {
			// L'état vide FILTRÉ prime : un filtre d'étape est posé, et c'est lui que l'utilisateur doit
			// retirer d'abord (§16.12.6, ligne 3 du tableau).
			await expect(page.getByTestId('effacer-filtres-vide')).toBeVisible()
			await capturer(page, 'filtre-sommeil-liste-vide-filtree-1440', UNITE)
		}
	})

	// LE CAS SANS AUCUN AUTRE FILTRE : l'état vide dû au seul sommeil. Il est éprouvé sur le channel
	// dont TOUTES les affaires actives dorment — s'il n'en existe pas dans le seed, le scénario le
	// dit plutôt que de faire semblant : c'est le §16.12.6 qui reste alors non éprouvé en E2E, et le
	// backlog le nomme.
	test('la vue liste nue d’un channel sans affaire éveillée nomme le sommeil', async ({ page }) => {
		await connecter(page)
		await page.goto(PROSPECTION.liste)
		// `prospection` porte une affaire éveillée : l'état vide par sommeil n'y est pas atteignable
		// sans écrire dans la base, ce que cette preuve ne fait pas. La propriété éprouvable ici est
		// que l'état vide de sommeil n'apparaît PAS quand une affaire éveillée existe — l'inverse
		// serait un état vide qui mentirait dans l'autre sens.
		await expect(page.getByTestId('total-liste')).toHaveText('Affaires : 1')
		await expect(page.getByTestId('afficher-sommeil-vide')).toHaveCount(0)
	})
})

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7, CLAUDE.md §16)', () => {
	// La pastille compacte est éprouvée à CHAQUE palier, et le palier étroit est celui qui compte :
	// c'est là que « En sommeil jusqu'au … » ne tiendrait pas, et c'est le motif de la version
	// compacte (§5.3 quinquies).
	test('la vue liste marquée ne déborde à aucun palier', async ({ page }) => {
		autoriserErreursConsole(page, [])
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`${PROSPECTION.liste}?sommeil=visibles`)
			await expect(page.getByTestId('pastille-sommeil')).toHaveCount(1)
			// LA PAGE NE DÉFILE JAMAIS HORIZONTALEMENT (§7) : le débordement appartient au conteneur du
			// tableau, jamais au document.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(debordement).toBe(false)
			await capturer(page, `filtre-sommeil-liste-${palier.nom}`, UNITE)
		}
	})

	test('le board marqué ne déborde à aucun palier', async ({ page }) => {
		autoriserErreursConsole(page, [])
		await connecter(page)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(`${PROSPECTION.board}?sommeil=visibles`)
			await expect(page.getByTestId('pastille-sommeil')).toHaveCount(1)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
			)
			expect(debordement).toBe(false)
			await capturer(page, `filtre-sommeil-board-${palier.nom}`, UNITE)
		}
	})
})
