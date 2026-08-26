// @verifies CRM-064 (docs/BACKLOG.md) — tranche 3a : la cloche et le panneau, sur session réelle
// @verifies docs/SPEC-notifications.md §23.1 (la place dans l'en-tête), §23.2 (ni modale ni
//           route), §24.3 (ce que la ligne rend), §26.1 (le compteur), §26.4 (le marquage et ses
//           deux sens), §26.7 (les états, et l'absence de cloche sans session), §31
// @verifies docs/DESIGN_SYSTEM.md §5.43 (cette surface), §7 (les quatre paliers), §8 (clavier) ;
//           CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, comme un utilisateur réel : aucune fonction
// interne n'est appelée, aucune réponse n'est substituée, et le navigateur obtient son jeton par
// le formulaire réel puis parle à la vraie API.
//
// LES DEUX NOTIFICATIONS EXERCÉES SONT CELLES DU SEED, et le jeu de démonstration les rend
// probantes sans qu'aucune donnée ne soit fabriquée : Camille et Driss en portent chacun UNE, avec
// deux auteurs différents, et Farida n'en porte AUCUNE. La boîte de chacun est donc distincte de
// celle de l'autre, et l'état vide s'exerce sur un profil réel.
//
// LE SEED SORT INTACT : le seul geste d'écriture de cette suite — marquer lu — est DÉFAIT dans le
// même scénario, et une dernière assertion le constate.

import { expect, test, type Page } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-064'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
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

test.describe('La cloche et son compteur (docs/SPEC-notifications.md §26.1)', () => {
	// SANS SESSION, LA CLOCHE N'EST PAS RENDUE (§26.7). Une cloche offerte à un anonyme
	// annoncerait une boîte qu'aucune session ne peut remplir.
	test('aucune cloche pour un visiteur anonyme', async ({ page }) => {
		// LA RACINE, ET NON `/connexion` : l'écran de connexion est une surface AUTONOME, sans
		// coquille ni en-tête (`docs/DESIGN_SYSTEM.md` §5.12), si bien qu'y chercher l'absence de
		// cloche ne prouverait rien — rien n'y est rendu. Défaut trouvé en exécutant la preuve, et
		// c'était la PREUVE qui était fausse, jamais le produit.
		await page.goto('/')
		await expect(page.getByTestId('entete')).toBeVisible()
		// L'en-tête anonyme rend « Se connecter » à la place de l'identité (§5.12) : c'est le
		// témoin qui rend l'absence de cloche probante, et non un écran simplement vide.
		await expect(page.getByRole('link', { name: 'Se connecter' })).toBeVisible()
		await expect(page.getByTestId('cloche-notifications')).toHaveCount(0)
	})

	// LE NOM ACCESSIBLE PORTE LE COMPTE EXACT, accordé par clé : « 1 non lue », jamais
	// « 1 non lues » (§10 du design system).
	test('la cloche de Driss annonce sa seule non-lue, et son compteur la dessine', async ({
		page,
	}) => {
		await connecter(page, BIZDEV)
		const cloche = page.getByTestId('cloche-notifications')
		await expect(cloche).toBeVisible()
		await expect(cloche).toHaveAccessibleName('Notifications — 1 non lue')
		await expect(page.getByTestId('compteur-notifications')).toHaveText('1')
	})

	// LA BOÎTE DE FARIDA EST VIDE, ET C'EST UN PROFIL RÉEL DU SEED : l'état vide s'exerce sans
	// aucune donnée fabriquée (§28). Le compteur est ABSENT à zéro, l'absence disant déjà ce que
	// « 0 » répéterait.
	test('la cloche de Farida n’a AUCUN compteur, et son panneau dit que l’état est sain', async ({
		page,
	}) => {
		await connecter(page, VIEWER)
		const cloche = page.getByTestId('cloche-notifications')
		await expect(cloche).toBeVisible()
		await expect(cloche).toHaveAccessibleName('Notifications — aucune non lue')
		await expect(page.getByTestId('compteur-notifications')).toHaveCount(0)

		await cloche.click()
		const vide = page.getByTestId('notifications-vide')
		await expect(vide).toBeVisible()
		await expect(vide).toContainText('Aucune notification.')
		// L'ÉTAT VIDE N'OFFRE AUCUNE ACTION (§26.7) : il n'y a rien à faire d'une boîte vide.
		await expect(vide.getByRole('button')).toHaveCount(0)

		await page.setViewportSize({ width: 1440, height: 900 })
		await capturer(page, 'notifications-vide-xl-1440', UNITE)
	})
})

test.describe('Le panneau et sa ligne (docs/SPEC-notifications.md §23.2, §24.3)', () => {
	test('la ligne nomme l’auteur, porte l’extrait, l’affaire en lien et sa pilule', async ({
		page,
	}) => {
		await connecter(page, BIZDEV)
		await page.getByTestId('cloche-notifications').click()

		const panneau = page.getByTestId('panneau-notifications')
		await expect(panneau).toBeVisible()
		// LE PANNEAU N'EST PAS UNE ROUTE (§23.2) : l'adresse ne bouge pas, et l'écran courant reste
		// derrière lui. C'est tout le motif du choix.
		await expect(page).not.toHaveURL(/notifications/)

		const ligne = page.getByTestId('notification').first()
		await expect(ligne).toContainText('Camille Aubert vous a mentionné')
		await expect(page.getByTestId('notification-extrait').first()).toContainText(
			'La DSI a confirmé le périmètre',
		)
		// L'ÉTAT DE LECTURE SE REND PAR LA FORME (§26.2) : la ligne du seed est non lue.
		await expect(ligne).toHaveAttribute('data-lue', 'non')

		const lien = page.getByTestId('notification-lien').first()
		await expect(lien).toHaveAccessibleName('Ouvrir Refonte du site vitrine')
		await expect(page.getByTestId('notification-pilule').first()).toHaveAccessibleName(
			'Ouvrir Conseil & IA › Grands comptes',
		)
		// AUCUNE TRONCATURE sur une boîte d'une ligne : elle ne s'écrit que lorsque la lecture
		// atteint sa borne (§26.5).
		await expect(page.getByTestId('notifications-tronquee')).toHaveCount(0)
	})

	// LE LIEN MÈNE RÉELLEMENT À L'AFFAIRE, et il NE MARQUE RIEN (§26.4) : suivre un lien et
	// marquer lu sont deux gestes.
	test('le lien ouvre l’affaire, et ne marque PAS la notification', async ({ page }) => {
		await connecter(page, BIZDEV)
		await page.getByTestId('cloche-notifications').click()
		await page.getByTestId('notification-lien').first().click()

		await expect(page).toHaveURL(/\/tracks\/conseil-ia\/grands-comptes\/cards\//)
		// LE COMPTEUR N'A PAS BOUGÉ : la notification est toujours non lue.
		await expect(page.getByTestId('compteur-notifications')).toHaveText('1')
	})

	// LE PANNEAU SE FERME PAR ÉCHAP, EN RENDANT LE FOCUS À LA CLOCHE (§5.43, §5.29 tranche 2 g).
	test('Échap referme le panneau et rend le focus à la cloche', async ({ page }) => {
		await connecter(page, ADMIN)
		const cloche = page.getByTestId('cloche-notifications')
		await cloche.click()
		await expect(page.getByTestId('panneau-notifications')).toBeVisible()
		await expect(cloche).toHaveAttribute('aria-expanded', 'true')

		await page.keyboard.press('Escape')
		await expect(page.getByTestId('panneau-notifications')).toHaveCount(0)
		await expect(cloche).toBeFocused()
		await expect(cloche).toHaveAttribute('aria-expanded', 'false')
	})

	// LA CLOCHE S'ATTEINT ET S'OUVRE AU CLAVIER SEUL : le §8 ne connaît aucune exception à la
	// parité souris / clavier.
	test('la cloche s’ouvre au clavier, et le focus entre dans le panneau', async ({ page }) => {
		await connecter(page, ADMIN)
		const cloche = page.getByTestId('cloche-notifications')
		await cloche.focus()
		await page.keyboard.press('Enter')
		const panneau = page.getByTestId('panneau-notifications')
		await expect(panneau).toBeVisible()
		// LE FOCUS ENTRE DANS LE PANNEAU (§5.13) : sans cela, le premier `Tab` sortirait de
		// l'en-tête sans jamais traverser la liste.
		await expect(panneau).toBeFocused()
	})
})

test.describe('Le marquage, dans les deux sens (docs/SPEC-notifications.md §26.4)', () => {
	// LE GESTE EST DÉFAIT DANS LE MÊME SCÉNARIO : le seed sort intact (§28). C'est aussi ce qui
	// éprouve le SECOND sens, qui n'est pas un ornement — on ouvre une notification par mégarde.
	test('marquer lu éteint le compteur, marquer non lu le ramène', async ({ page }) => {
		await connecter(page, ADMIN)
		const cloche = page.getByTestId('cloche-notifications')
		await expect(page.getByTestId('compteur-notifications')).toHaveText('1')
		await cloche.click()

		const ligne = page.getByTestId('notification').first()
		await expect(ligne).toHaveAttribute('data-lue', 'non')

		await page.getByRole('button', { name: 'Marquer comme lue' }).click()
		await expect(ligne).toHaveAttribute('data-lue', 'oui')
		// LE COMPTEUR DISPARAÎT À ZÉRO (§26.1), et le nom accessible suit.
		await expect(page.getByTestId('compteur-notifications')).toHaveCount(0)
		await expect(cloche).toHaveAccessibleName('Notifications — aucune non lue')
		// SUR UN SUCCÈS, AUCUN MESSAGE : la ligne porte son nouvel état, et elle EST la
		// confirmation (§5.7 ter du design system).
		await expect(page.getByTestId('message-marquage')).toHaveCount(0)

		await capturer(page, 'notifications-panneau-lue-xl-1440', UNITE)

		// LE SECOND SENS, ET LE SEED EST RENDU INTACT.
		await page.getByRole('button', { name: 'Marquer comme non lue' }).click()
		await expect(ligne).toHaveAttribute('data-lue', 'non')
		await expect(page.getByTestId('compteur-notifications')).toHaveText('1')
		await expect(cloche).toHaveAccessibleName('Notifications — 1 non lue')
	})
})

test.describe('Vérification visuelle aux quatre paliers (docs/DESIGN_SYSTEM.md §7)', () => {
	// LES CAPTURES SONT PRODUITES DEPUIS L'APPLICATION RÉELLEMENT EXÉCUTÉE (`CLAUDE.md` §16), et
	// elles sont OBSERVÉES. La page ne défile jamais horizontalement, à aucun palier (§7).
	for (const palier of PALIERS) {
		test(`le panneau tient au palier ${palier.nom}, sans débordement horizontal`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, BIZDEV)
			await page.getByTestId('cloche-notifications').click()
			await expect(page.getByTestId('panneau-notifications')).toBeVisible()
			await expect(page.getByTestId('notification').first()).toBeVisible()

			await capturer(page, `notifications-panneau-${palier.nom}`, UNITE)

			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, `la page déborde horizontalement au palier ${palier.nom}`).toBe(false)

			// LE PANNEAU EST ENTIÈREMENT DANS LA FENÊTRE, DES DEUX CÔTÉS, et cette assertion est née
			// d'un défaut que la précédente NE VOYAIT PAS : `scrollWidth > clientWidth` ne mesure
			// qu'un débordement à DROITE. À 390 px, le panneau ancré sur la cloche sortait par la
			// GAUCHE — coordonnée négative, aucun défilement engendré, preuve verte et écran faux.
			// Le défaut a été trouvé en REGARDANT la capture (`CLAUDE.md` §16) ; l'assertion le fige.
			const cadre = await page.getByTestId('panneau-notifications').boundingBox()
			expect(cadre, 'le panneau n’a pas de cadre mesurable').not.toBeNull()
			expect(cadre?.x ?? -1, `le panneau sort par la gauche au palier ${palier.nom}`).toBeGreaterThanOrEqual(0)
			expect(
				(cadre?.x ?? 0) + (cadre?.width ?? 0),
				`le panneau sort par la droite au palier ${palier.nom}`,
			).toBeLessThanOrEqual(palier.largeur)
		})
	}
})
