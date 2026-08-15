// @verifies CRM-079 (docs/BACKLOG.md) — guide de démarrage : le parcours d'interface
// @verifies docs/SPEC-onboarding.md §3.1 (les comptages mesurés, et l'écart du viewer),
//           §4.1 (le guide est toujours rendu à son adresse), §4.2 (les quatre cas de l'accueil),
//           §4.3 (l'entrée de l'index des réglages), §5 (interruption et reprise de session),
//           §6 (états), §6.3 (aucune étape désactivée), §7 (clavier), §8 (preuves attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.17 (cette surface), §7 (paliers)
// @verifies CLAUDE.md §10 (une règle se prouve sur la vraie base), §11 (rien hors de la session),
//           §16 (vérification visuelle)
//
// LE PARCOURS EST FAIT AU CLAVIER ET À LA SOURIS, sur la VRAIE base et avec le VRAI seed : aucune
// étape n'est accomplie par une réponse substituée. Les cinq étapes sont accomplies parce que le
// seed porte des tracks, des channels, des affaires et des boîtes — c'est ce que
// `docs/SPEC-onboarding.md` §8 exige.
//
// LA SEULE RÉPONSE SUBSTITUÉE DE CE FICHIER isole l'état « non mesurable » du §6.2, que rien dans
// le seed ne produit : elle fait échouer UNE des cinq mesures au niveau du réseau, et le scénario
// vérifie que les quatre autres restent lisibles. Elle est nommée ici comme le §12.5 du design
// system l'exige, et elle ne remplace aucun parcours connecté.
//
// AUCUNE ÉCRITURE : le guide lit et renvoie. La base est donc rendue intacte sans aucune remise en
// état — il n'y a rien à défaire.

import { expect, test, type Page } from './fixtures'
import { ERREUR_CONNEXION_REFUSEE, autoriserErreursConsole } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-079'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** La clé de la préférence de session, telle que `webapp/src/app/preferences.ts` la nomme. */
const CLE_MASQUE = 'p2enjoy.demarrage.masque'

async function connecter(page: Page, email: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

test.describe('CRM-079 — guide de démarrage', () => {
	test('l’accueil rend le guide, et le seed accomplit les cinq étapes pour l’administratrice', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/demarrage')

		// Les cinq étapes, dans une liste ORDONNÉE (§7).
		const guide = page.getByTestId('guide-demarrage')
		await expect(guide).toBeVisible()
		await expect(guide.locator('ol > li')).toHaveCount(5)

		// MESURÉ le 2026-08-15 : admin voit 1 workspace, 3 tracks, 6 channels, 14 affaires et
		// 3 boîtes. Les cinq étapes sont donc accomplies, et le compte l'écrit en toutes lettres.
		await expect(page.getByTestId('progression-demarrage')).toHaveText('5 étape(s) sur 5')
		for (const cle of ['espace', 'track', 'channel', 'affaire', 'messagerie']) {
			await expect(page.getByTestId(`etape-${cle}`)).toContainText('Fait')
		}

		await capturer(page, 'guide-accompli-1440', UNITE)
	})

	test('la lectrice voit la cinquième étape à faire : le guide dit ce qu’ELLE voit', async ({
		page,
	}) => {
		// C'est le fait 2 du §3.1, et il n'est pas un défaut : le comptage est borné par les droits
		// fins, et l'interface ne calcule aucun droit (`CLAUDE.md` §10). Trois boîtes existent ;
		// la lectrice n'en voit aucune.
		await connecter(page, VIEWER)
		await page.goto('/demarrage')

		await expect(page.getByTestId('progression-demarrage')).toHaveText('4 étape(s) sur 5')
		await expect(page.getByTestId('etape-messagerie')).toContainText('À faire')
		// La phrase d'absence n'accompagne QUE l'étape à faire : sur une étape accomplie, elle
		// contredirait « Fait » (défaut trouvé sur `guide-viewer-1440.jpg`).
		await expect(page.getByTestId('etape-messagerie')).toContainText(
			'Vous n’en voyez aucune pour le moment.',
		)
		await expect(page.getByTestId('etape-track')).not.toContainText('Vous n’en voyez aucun')

		// AUCUN lien n'est éteint pour autant : l'écran visé porte son propre refus (§6.3).
		await expect(page.getByTestId('lien-messagerie')).toHaveAttribute(
			'href',
			'/reglages/messagerie',
		)

		await capturer(page, 'guide-viewer-1440', UNITE)
	})

	test('une étape accomplie GARDE son lien, et il mène à l’écran réel', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/demarrage')

		await expect(page.getByTestId('etape-track')).toContainText('Fait')
		await page.getByTestId('lien-track').click()

		// L'écran d'arrivée est celui de `CRM-075`, réellement livré — aucun écran factice. Le titre
		// est nommé plutôt que cherché par son seul niveau : la barre latérale porte aussi un `h2`,
		// et une assertion de niveau seul dirait « un titre existe » sans dire lequel.
		await expect(page).toHaveURL(/\/reglages\/arborescence$/)
		await expect(
			page.getByRole('heading', { name: "Administration de l'arborescence" }),
		).toBeVisible()
	})

	test('le parcours se fait AU CLAVIER SEUL, du lien d’évitement au premier lien d’étape', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await page.goto('/demarrage')
		await expect(page.getByTestId('guide-demarrage')).toBeVisible()

		// On part du haut du document et on avance à la tabulation jusqu'au lien d'une étape :
		// aucune souris, et l'élément réellement focalisé est vérifié à l'arrivée.
		await page.locator('body').press('Tab')
		const cible = page.getByTestId('lien-track')
		for (let saut = 0; saut < 40; saut += 1) {
			if (await cible.evaluate((noeud) => noeud === document.activeElement)) break
			await page.keyboard.press('Tab')
		}
		await expect(cible).toBeFocused()

		// Et il s'active à la touche Entrée, pas seulement au clic.
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/reglages\/arborescence$/)
	})

	test('l’index des réglages porte le guide EN PREMIER, et y mène', async ({ page }) => {
		await connecter(page, ADMIN)
		await page.goto('/reglages')

		// Scopé à `main` : la barre latérale porte elle aussi des listes, et `ul > li` seul
		// désignerait sa première entrée de navigation.
		const premier = page.getByRole('main').locator('ul > li').first()
		await expect(premier).toContainText('Guide de démarrage')
		await premier.getByRole('link').click()
		await expect(page).toHaveURL(/\/demarrage$/)
		await expect(page.getByTestId('guide-demarrage')).toBeVisible()
	})

	test('masquer le guide le retire de l’accueil, et le laisse à son adresse', async ({ page }) => {
		// Le seed accomplit les cinq étapes pour l'administratrice : l'accueil rend donc déjà son
		// état vide. La lectrice, elle, garde une étape à faire — c'est chez elle que le masquage
		// s'observe (§4.2).
		await connecter(page, VIEWER)
		await page.goto('/')

		const guide = page.getByTestId('guide-demarrage')
		await expect(guide).toBeVisible()
		await capturer(page, 'accueil-guide-1440', UNITE)

		await page.getByTestId('masquer-guide').click()
		await expect(guide).toBeHidden()

		// Masqué ne veut pas dire perdu : le chemin de retour est offert, et il fonctionne.
		const retour = page.getByTestId('rouvrir-guide')
		await expect(retour).toBeVisible()
		await capturer(page, 'accueil-masque-1440', UNITE)
		await retour.click()
		await expect(page).toHaveURL(/\/demarrage$/)
		await expect(page.getByTestId('guide-demarrage')).toBeVisible()
	})

	test('le masquage SURVIT au rechargement de l’onglet — reprise de session', async ({ page }) => {
		await connecter(page, VIEWER)
		await page.goto('/')
		await page.getByTestId('masquer-guide').click()
		await expect(page.getByTestId('rouvrir-guide')).toBeVisible()

		await page.reload()

		// La préférence a survécu, et la progression a été RE-MESURÉE : elle n'est jamais restaurée
		// d'un cache (§5).
		await expect(page.getByTestId('rouvrir-guide')).toBeVisible()
		await expect(page.getByTestId('guide-demarrage')).toBeHidden()
	})

	test('la préférence vit en `sessionStorage`, et `localStorage` reste VIDE', async ({ page }) => {
		await connecter(page, VIEWER)
		await page.goto('/')
		await page.getByTestId('masquer-guide').click()
		await expect(page.getByTestId('rouvrir-guide')).toBeVisible()

		const stockage = await page.evaluate(
			(cle) => ({
				session: globalThis.sessionStorage.getItem(cle),
				tailleLocale: globalThis.localStorage.length,
			}),
			CLE_MASQUE,
		)
		expect(stockage.session).toBe('1')
		// `CLAUDE.md` §11 : aucune persistance au-delà de la session, aucun consentement à recueillir.
		expect(stockage.tailleLocale).toBe(0)
	})

	test('une mesure en échec est NOMMÉE, et les quatre autres restent lisibles', async ({ page }) => {
		test.setTimeout(90_000)
		await connecter(page, ADMIN)

		// Réponse substituée NOMMÉE (docs/DESIGN_SYSTEM.md §12.5) : elle isole l'état « non
		// mesurable » du §6.2, que le seed ne produit pas. Seule la mesure des tracks échoue, et
		// au niveau du RÉSEAU — la requête n'aboutit jamais.
		//
		// Le filtre porte sur la MÉTHODE et non sur la seule adresse : le comptage du guide est un
		// `HEAD`, là où la barre latérale émet un `GET` sur la même table. Un motif d'URL seul
		// abattait les deux — la coquille rendait alors son état d'erreur global, et le scénario
		// n'aurait plus rien mesuré du guide.
		//
		// LA PANNE EST UN ÉTAT, PAS UN QUOTA. `supabase-js` retente une panne de transport trois
		// fois après la tentative initiale (`coquille.spec.ts`, docs/JOURNAL.md décision 47), et le
		// serveur de développement monte l'application en mode strict, qui exécute l'effet deux
		// fois : le nombre exact de requêtes abattues n'est donc pas une constante à deviner.
		// Le scénario coupe le réseau, constate l'état, puis le RÉTABLIT avant la reprise — ce qui
		// prouve que la reprise relance un appel réseau, sans dépendre d'un compte.
		let echecs = 0
		let panne = true
		await page.route('**/rest/v1/tracks?select=id*', async (route) => {
			if (route.request().method() !== 'HEAD') return route.continue()
			if (panne) {
				echecs += 1
				await route.abort('connectionrefused')
				return
			}
			await route.continue()
		})
		await page.goto('/demarrage')

		const ligne = page.getByTestId('etape-track')
		await expect(ligne).toContainText('Cette étape n’a pas pu être vérifiée', { timeout: 30_000 })
		// Une panne se retente ; le lien n'est jamais éteint (§6.2).
		const reprise = ligne.getByRole('button', { name: 'Réessayer' })
		await expect(reprise).toBeVisible()
		await expect(page.getByTestId('lien-track')).toBeVisible()

		// Les quatre autres mesures ont abouti : un échec n'efface pas ce que le guide a mesuré.
		for (const cle of ['espace', 'channel', 'affaire', 'messagerie']) {
			await expect(page.getByTestId(`etape-${cle}`)).toContainText('Fait')
		}
		await expect(page.getByTestId('progression-demarrage')).toHaveText('4 étape(s) sur 5')

		await capturer(page, 'guide-non-mesurable-1440', UNITE)

		// On attend que les reprises automatiques de la bibliothèque soient TOUTES retombées avant
		// de compter : ce n'est pas une temporisation qui masquerait un défaut, c'est la condition
		// pour que la liste d'erreurs consommée juste après soit exactement celle des refus déjà
		// émis (§14, point 8). Le compte est LU, jamais supposé.
		let precedent = -1
		await expect
			.poll(() => {
				const stable = echecs === precedent
				precedent = echecs
				return stable
			}, { timeout: 30_000, intervals: [500] })
			.toBe(true)
		const refusEmis = echecs

		// Le réseau revient, et la reprise relance RÉELLEMENT les cinq mesures : elle ne recharge
		// pas la page (docs/SPEC-webapp.md §7).
		panne = false
		await reprise.click()
		await expect(ligne).toContainText('Fait', { timeout: 30_000 })
		await expect(page.getByTestId('progression-demarrage')).toHaveText('5 étape(s) sur 5')
		expect(echecs, 'aucune requête n’est abattue après le rétablissement').toBe(refusEmis)

		// Les refus réseau volontaires sont CONSOMMÉS par égalité sur le message exact, et APRÈS
		// vérification de leur effet visible — jamais par un filtre global.
		autoriserErreursConsole(page, Array(refusEmis).fill(ERREUR_CONNEXION_REFUSEE))
	})

	test('les quatre paliers, sans défilement horizontal de la page', async ({ page }) => {
		await connecter(page, VIEWER)

		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/demarrage')
			await expect(page.getByTestId('guide-demarrage')).toBeVisible()

			const deborde = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(deborde, `la page ne doit pas défiler horizontalement à ${palier.nom}`).toBe(false)

			await capturer(page, `guide-${palier.nom}`, UNITE)
		}
	})
})
