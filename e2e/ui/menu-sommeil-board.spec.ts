// @verifies CRM-081 (docs/BACKLOG.md) — tranche 2 d : le geste de sommeil depuis la carte du board
// @verifies docs/SPEC-cards.md §16.13.1 (le menu des actions, jamais éteint), §16.13.2 (les deux
//           visages et les quatre échéances usuelles), §16.13.3 (ce que la carte devient après le
//           geste), §16.13.4 (les refus, et la commande jamais éteinte d'avance),
//           §16.13.6 (ligne « E2E d'interface » et ligne « Visuel »)
// @verifies docs/DESIGN_SYSTEM.md §5.3 sexies (les deux sections, la mention, le menu qui reste
//           ouvert sur un refus), §8 (accessibilité)
// @verifies CLAUDE.md §16 (vérification visuelle), §10 (le refus se mesure avec le vrai profil)
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE : ces scénarios se connectent réellement, appellent les vrais
// `snooze_card` et `wake_card`, et lisent le résultat par la vraie route. C'est l'objet même de la
// preuve — la tranche 2 a laissait la fiche comme SEUL chemin, et un geste de board simulé ne
// dirait rien de ce que la base consent.
//
// LE SEED SORT INTACT. Le scénario qui endort une affaire la RÉVEILLE avant de finir, et il est
// écrit de sorte que le réveil ait lieu même s'il échoue en route (`finally`). Deux traces
// resteront dans le fil de l'affaire — un `snoozed`, un `woken` —, ce qui est le comportement
// voulu du trigger de table (§16.5) et non un effet de bord de la preuve : les suites qui comptent
// des événements comptent des ÉCARTS depuis la tranche 1, précisément pour cette raison.
//
// L'AFFAIRE COBAYE EST À UNE ÉTAPE TERMINALE, et ce n'est pas un hasard : MESURÉ le 2026-08-17,
// `Socle analytique — Vertuo` est à l'étape `Livré` de `grands-comptes` et n'a AUCUNE transition
// sortante. Son menu était donc éteint avant cette tranche, et elle n'avait aucun geste — alors
// qu'une affaire livrée est précisément celle qu'on range.

import { autoriserErreursConsole, ERREUR_RESSOURCE_HTTP, expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-081'
const ADMIN = 'admin@p2enjoy.test'
/** La lectrice : membre en LECTURE de `maintenance`, où elle voit les affaires sans y écrire. */
const LECTRICE = 'viewer@p2enjoy.test'

const BOARD_GRANDS_COMPTES = '/tracks/conseil-ia/grands-comptes'
/** `maintenance` est le channel que la lectrice lit sans y écrire (`e2e/api/snooze.spec.ts` n° 5). */
const BOARD_MAINTENANCE = '/tracks/studio-web/maintenance'

/** L'affaire d'étape terminale du seed : aucune transition sortante, donc aucun geste avant 2 d. */
const TERMINALE = {
	id: '5eed0000-0000-4000-8000-0000000000cd',
	titre: 'Socle analytique — Vertuo',
}

/** Une affaire d'étape terminale de `maintenance`, pour le refus opposé à la lectrice. */
const TERMINALE_LUE = 'Automatisation des sauvegardes — Duchamp'

const AFFICHER = 'Afficher les affaires en sommeil'

const carteDe = (page: Page, titre: string) =>
	page.locator('[data-testid="carte-card"]').filter({ hasText: titre })

async function connecter(page: Page, adresse: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(adresse)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/**
 * Réveille une affaire par la vraie route de l'interface, quel que soit l'état où le scénario
 * s'est arrêté. Le seed est un contrat maintenu (`CLAUDE.md` §8) : une preuve qui laisserait une
 * affaire endormie changerait ce que les suites suivantes mesurent.
 */
async function remettreEveillee(page: Page, titre: string): Promise<void> {
	await page.goto(`${BOARD_GRANDS_COMPTES}?sommeil=visibles`)
	const carte = carteDe(page, titre)
	if ((await carte.count()) === 0) return
	if ((await carte.getByTestId('pastille-sommeil').count()) === 0) return
	await carte.getByTestId('menu-transitions').click()
	await carte.getByTestId('carte-reveiller').click()
	await expect(carte.getByTestId('pastille-sommeil')).toHaveCount(0)
}

test.describe('le menu de la carte porte le geste (docs/SPEC-cards.md §16.13.1)', () => {
	// LE CAS QUI A IMPOSÉ LA RÈGLE : sans elle, ce menu serait éteint et ce scénario impossible.
	test('le menu d’une affaire sans transition sortante s’ouvre et porte les quatre échéances', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(BOARD_GRANDS_COMPTES)
		const carte = carteDe(page, TERMINALE.titre)
		await expect(carte).toHaveCount(1)

		const declencheur = carte.getByTestId('menu-transitions')
		await expect(declencheur).toBeEnabled()
		await declencheur.click()

		// La phrase du déplacement indisponible n'est pas perdue : elle est DANS le menu.
		await expect(carte.getByTestId('aucune-transition')).toHaveText(
			'Aucun déplacement déclaré depuis cette étape',
		)
		await expect(carte.getByTestId('liste-transitions')).toHaveCount(0)
		// Et le geste est là, avec ses quatre échéances rendues dès l'ouverture (§16.13.2).
		const gestes = carte.locator('[data-testid^="carte-sommeil-"]')
		await expect(gestes).toHaveCount(4)
		// LE MENU EST AMENÉ DANS LA VUE AVANT LA CAPTURE : un menu ouvert allonge la carte, et une
		// capture prise sans cela coupe les deux dernières échéances au bord de la fenêtre — elle ne
		// montrerait donc pas ce qu'elle prétend montrer (CLAUDE.md §16).
		await gestes.last().scrollIntoViewIfNeeded()
		await capturer(page, 'menu-sommeil-board-eveillee-1440', UNITE)
	})

	// LE PALIER ÉTROIT (docs/DESIGN_SYSTEM.md §7) : une carte fait 288 px à toute largeur, et c'est
	// là que le menu ouvert est le plus contraint. Aucun libellé ne doit déborder ni se tronquer.
	test('le menu ouvert tient dans la carte au palier étroit', async ({ page }) => {
		const etroit = PALIERS[PALIERS.length - 1]
		await connecter(page, ADMIN)
		await page.setViewportSize({ width: etroit.largeur, height: etroit.hauteur })
		await page.goto(BOARD_GRANDS_COMPTES)

		const carte = carteDe(page, TERMINALE.titre)
		await expect(carte).toHaveCount(1)
		await carte.getByTestId('menu-transitions').click()
		const gestes = carte.locator('[data-testid^="carte-sommeil-"]')
		await expect(gestes).toHaveCount(4)
		await gestes.last().scrollIntoViewIfNeeded()

		// La carte ne s'élargit pas pour loger le menu : elle reste à la largeur du §5.2 bis.
		const boite = await carte.boundingBox()
		expect(boite?.width).toBeLessThanOrEqual(288)
		await capturer(page, `menu-sommeil-board-eveillee-${etroit.nom}`, UNITE)
	})
})

test.describe('endormir depuis la carte range l’affaire (§16.13.3)', () => {
	test.afterEach(async ({ page }) => {
		await remettreEveillee(page, TERMINALE.titre)
	})

	test('l’affaire quitte le board, la bascule la retrouve marquée, et le réveil la ramène', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto(BOARD_GRANDS_COMPTES)

		// L'ATTENTE EST EXPLICITE AVANT TOUT COMPTAGE : `count()` ne réessaie pas, et le compter
		// avant que le board ait rendu mesurerait la vitesse du chargement, pas la colonne.
		const carte = carteDe(page, TERMINALE.titre)
		await expect(carte).toHaveCount(1)
		const colonne = page.locator('[data-testid="colonne"]').filter({ hasText: TERMINALE.titre })
		const avant = await colonne.locator('[data-testid="carte-card"]').count()
		expect(avant).toBeGreaterThan(0)

		await carte.getByTestId('menu-transitions').click()
		await carte.getByTestId('carte-sommeil-demain').click()

		// LA CARTE QUITTE LE BOARD, et c'est la propriété qui rend le geste utile : ranger une
		// affaire sans changer d'écran. Aucune substitution : c'est la base qui a écrit l'échéance,
		// et le filtre de composition qui en tire la conséquence.
		await expect(carteDe(page, TERMINALE.titre)).toHaveCount(0)
		await capturer(page, 'menu-sommeil-board-apres-geste-1440', UNITE)

		// Le compteur de la colonne annonce ce qu'elle MONTRE (§16.12.8).
		const colonneApres = page
			.locator('[data-testid="colonne"]')
			.filter({ hasText: 'Livré' })
			.first()
		expect(await colonneApres.locator('[data-testid="carte-card"]').count()).toBe(avant - 1)

		// Elle reste ATTEIGNABLE par la bascule, et elle y est marquée (§16.12.7).
		await page.getByRole('checkbox', { name: AFFICHER }).click()
		const retrouvee = carteDe(page, TERMINALE.titre)
		await expect(retrouvee).toHaveCount(1)
		await expect(retrouvee.getByTestId('pastille-sommeil')).toHaveCount(1)
		await capturer(page, 'menu-sommeil-board-endormie-1440', UNITE)

		// LE RÉVEIL N'EST OBSERVABLE QUE DEPUIS LE MODE `visibles` (§16.13.3) : en mode masqué, une
		// affaire endormie n'est pas rendue, donc son menu n'existe pas.
		await retrouvee.getByTestId('menu-transitions').click()
		await expect(retrouvee.getByTestId('liste-echeances')).toHaveCount(0)
		await capturer(page, 'menu-sommeil-board-reveiller-1440', UNITE)
		await retrouvee.getByTestId('carte-reveiller').click()
		await expect(retrouvee.getByTestId('pastille-sommeil')).toHaveCount(0)

		// ET CONTRE LA BASE, PAS CONTRE L'ÉTAT DE LA PAGE : le mode masqué la rend de nouveau.
		await page.goto(BOARD_GRANDS_COMPTES)
		await expect(carteDe(page, TERMINALE.titre)).toHaveCount(1)
	})
})

test.describe('le refus est mesuré avec le vrai profil (§16.13.4, CLAUDE.md §10)', () => {
	// LA COMMANDE N'EST JAMAIS ÉTEINTE D'AVANCE : la lectrice l'ouvre, appuie, et LIT le refus que
	// la base oppose. Éteindre le geste par supposition remplacerait un refus mesuré par une
	// devinette — et masquerait la disparition de la garde le jour où elle disparaîtrait.
	test('la lectrice obtient les quatre échéances, appuie, et lit le refus dans le menu', async ({
		page,
	}) => {
		await connecter(page, LECTRICE)
		await page.goto(BOARD_MAINTENANCE)

		const carte = carteDe(page, TERMINALE_LUE)
		await expect(carte).toHaveCount(1)
		await carte.getByTestId('menu-transitions').click()

		const gestes = carte.locator('[data-testid^="carte-sommeil-"]')
		await expect(gestes).toHaveCount(4)
		for (let rang = 0; rang < 4; rang += 1) await expect(gestes.nth(rang)).toBeEnabled()

		await carte.getByTestId('carte-sommeil-demain').click()

		// LA MENTION EST CELLE DE LA FICHE, mot pour mot : un même refus ne se formule pas de deux
		// façons selon l'écran d'où il a été demandé.
		const mention = carte.getByTestId('carte-sommeil-mention')
		await expect(mention).toHaveText('Vous ne pouvez pas modifier cette affaire.')
		await mention.scrollIntoViewIfNeeded()
		// LE MENU RESTE OUVERT : le refermer effacerait le message avant qu'il soit lu.
		await expect(carte.getByTestId('menu-carte')).toBeVisible()
		// LE `403` TRAVERSE LA CONSOLE, ET C'EST LA PREUVE QUE LE REFUS VIENT DU SERVEUR : la liste
		// est consommée ici, exactement, plutôt que filtrée globalement.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
		await capturer(page, 'menu-sommeil-board-refus-1440', UNITE)

		// Et rien n'a été écrit : l'affaire est toujours là, sans pastille, après rechargement.
		await page.reload()
		const apres = carteDe(page, TERMINALE_LUE)
		await expect(apres).toHaveCount(1)
		await expect(apres.getByTestId('pastille-sommeil')).toHaveCount(0)
	})
})
