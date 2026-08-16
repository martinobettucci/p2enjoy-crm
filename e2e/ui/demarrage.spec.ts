// @verifies CRM-079 (docs/BACKLOG.md) — guide de démarrage : le parcours d'interface
// @verifies docs/SPEC-onboarding.md §3.1 (les comptages mesurés, et l'écart du viewer),
//           §4.1 (le guide est toujours rendu à son adresse), §4.2 (les quatre cas de l'accueil),
//           §4.3 (l'entrée de l'index des réglages), §5 (interruption et reprise de session),
//           §6 (états), §6.3 (aucune étape désactivée), §7 (clavier), §8 (preuves attendues),
//           §8 ter (le cas « espace de travail neuf », son montage et son démontage)
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

import { expect, test, type APIRequestContext, type Page } from './fixtures'
import { ERREUR_CONNEXION_REFUSEE, autoriserErreursConsole } from './fixtures'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-079'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/**
 * L'espace de travail neuf du §8 ter, fabriqué par la preuve et détruit par elle.
 *
 * IL N'EST PAS SEEDÉ, et c'est une décision écrite : `CRM-005` pose « un workspace », et le
 * contrôle n° 1 de `scripts/verify-seed.sh` échoue sur tout second workspace en base. La preuve
 * suit donc le second terme de `docs/SPEC-seed.md` §8 — « continuer de fabriquer ses propres
 * comptes » —, chemin déjà emprunté par `scripts/verify-authz.sh`.
 */
const ESPACE_NEUF = {
	id: '5eed0000-0000-4000-8000-0000000000f1',
	slug: 'espace-neuf',
	adresse: 'neuf@p2enjoy.test',
} as const

/** L'identifiant du workspace du seed socle, celui qui doit rester SEUL après le démontage. */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'

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

/**
 * Monte l'espace vide et son compte, et rend l'identifiant du compte pour le démontage.
 *
 * Les deux lignes sont écrites avec la CLÉ DE SERVICE, qui contourne la RLS : aucun écran ne crée
 * de workspace (`docs/SPEC-seed.md` §8, INC-015), et le montage est donc une opération
 * d'exploitation, nommée comme telle plutôt que déguisée en parcours utilisateur (§8 ter.3).
 * Les cinq comptages que la preuve observe ensuite sont, eux, émis par l'application avec le
 * JETON RÉEL du compte, sous les politiques inchangées.
 */
async function monterEspaceNeuf(requete: APIRequestContext): Promise<string> {
	const compte = await requete.post(`${URL_API}/auth/v1/admin/users`, {
		headers: enTetesService(),
		data: { email: ESPACE_NEUF.adresse, password: MOT_DE_PASSE_SEED, email_confirm: true },
	})
	expect(compte.status(), 'le compte de l’espace neuf doit être créé').toBe(200)
	const idCompte = ((await compte.json()) as { id: string }).id

	const workspace = await requete.post(`${URL_API}/rest/v1/workspaces`, {
		headers: enTetesService(),
		data: [
			{
				id: ESPACE_NEUF.id,
				name: 'Espace neuf',
				slug: ESPACE_NEUF.slug,
				inbound_domain: 'neuf.p2enjoy.test',
			},
		],
	})
	expect(workspace.status(), 'le workspace vide doit être créé').toBe(201)

	const appartenance = await requete.post(`${URL_API}/rest/v1/workspace_members`, {
		headers: enTetesService(),
		data: [{ workspace_id: ESPACE_NEUF.id, user_id: idCompte, role: 'admin' }],
	})
	expect(appartenance.status(), 'le compte doit être admin de son espace').toBe(201)

	return idCompte
}

/**
 * Démonte l'espace neuf, et CONSTATE que la base est rendue à son état seedé.
 *
 * Supprimer le workspace **cascade** sur son appartenance — mesuré le 2026-08-16 —, et supprimer
 * le compte cascade sur son profil. Le dernier contrôle n'est pas décoratif : sans lui, une preuve
 * qui laisserait son espace derrière elle ferait échouer le contrôle n° 1 de
 * `scripts/verify-seed.sh` dans une autre suite, à un endroit où plus rien ne dirait pourquoi.
 */
async function demonterEspaceNeuf(requete: APIRequestContext, idCompte: string): Promise<void> {
	await requete.delete(`${URL_API}/rest/v1/workspaces?id=eq.${ESPACE_NEUF.id}`, {
		headers: enTetesService(),
	})
	if (idCompte !== '') {
		await requete.delete(`${URL_API}/auth/v1/admin/users/${idCompte}`, {
			headers: enTetesService(),
		})
	}

	const restants = await requete.get(`${URL_API}/rest/v1/workspaces?select=id`, {
		headers: enTetesService(),
	})
	expect(restants.status()).toBe(200)
	expect(
		(await restants.json()) as { id: string }[],
		'la base doit être rendue à son unique workspace seedé (CRM-005)',
	).toEqual([{ id: WORKSPACE_SEED }])
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

	test('un ESPACE DE TRAVAIL NEUF rend l’écran du vrai premier lancement', async ({
		page,
		request,
	}) => {
		// C'est le §8 ter, et c'est l'état pour lequel le guide a été écrit (§1) : jusqu'ici aucune
		// preuve d'interface ne le montrait. Le seed accomplit les cinq étapes pour
		// l'administratrice, et la lectrice n'en laisse voir qu'une à faire — pour un motif, ses
		// droits fins, qui n'est pas celui d'un espace vide.
		//
		// AUCUNE RÉPONSE N'EST SUBSTITUÉE : les quatre étapes sont à faire parce que l'espace ne
		// porte réellement rien, ce que le §8 exige.
		let idCompte = ''
		try {
			idCompte = await monterEspaceNeuf(request)
			await connecter(page, ESPACE_NEUF.adresse)

			// L'ACCUEIL, et non `/demarrage` : c'est là qu'arrive un compte qui vient de se
			// connecter, et le §4.2 veut le guide tant qu'il reste une étape à faire.
			await page.goto('/')
			const guide = page.getByTestId('guide-demarrage')
			await expect(guide).toBeVisible()

			// MESURÉ le 2026-08-16 (§8 ter.1) : 1 workspace, et zéro track, channel, affaire et
			// boîte. Une seule étape est accomplie, et c'est la connexion qui l'accomplit (§3).
			await expect(page.getByTestId('progression-demarrage')).toHaveText('1 étape(s) sur 5')
			await expect(page.getByTestId('etape-espace')).toContainText('Fait')

			// Les quatre autres sont À FAIRE, et non « non mesurable » : la cinquième mesure rend
			// `200` et zéro pour une session ouverte, là où le `401` du §3.1 est celui de la clé
			// ANONYME. C'est la distinction du §6.2, et rien ne l'éprouvait.
			for (const cle of ['track', 'channel', 'affaire', 'messagerie']) {
				const ligne = page.getByTestId(`etape-${cle}`)
				await expect(ligne).toContainText('À faire')
				await expect(ligne).not.toContainText('Cette étape n’a pas pu être vérifiée')
			}

			// Chaque ligne à faire dit ce que l'appelant VOIT, jamais ce qui existe (§3.1, fait 1).
			await expect(page.getByTestId('etape-track')).toContainText(
				'Vous n’en voyez aucun pour le moment.',
			)
			await expect(page.getByTestId('etape-affaire')).toContainText(
				'Vous n’en voyez aucune pour le moment.',
			)

			// Aucun lien n'est éteint, pas même sur un espace où rien n'existe encore (§6.3) : ce
			// sont précisément les écrans qui font sortir de cet état.
			await expect(page.getByTestId('lien-track')).toHaveAttribute(
				'href',
				'/reglages/arborescence',
			)
			await capturer(page, 'guide-espace-neuf-1440', UNITE)

			// Et le guide reste relançable à son adresse propre, dans le même état (§4.1).
			await page.goto('/demarrage')
			await expect(page.getByTestId('progression-demarrage')).toHaveText('1 étape(s) sur 5')
		} finally {
			await demonterEspaceNeuf(request, idCompte)
		}
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
