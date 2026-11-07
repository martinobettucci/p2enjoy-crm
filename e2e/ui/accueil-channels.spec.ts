// @verifies CRM-129 (docs/BACKLOG.md) — l'accueil, guide fini ou masqué : l'état neutre « Choisissez un channel » à qui
//           lit des channels, l'état vide « Aucun board à afficher » à qui n'en lit aucun ; souris et clavier ; captures
//           aux quatre paliers
// @verifies docs/SPEC-onboarding.md §4.2 (précision du 2026-11-06, décisions 858 et 859), §8 ter (l'espace neuf, monté
//           et démonté par la preuve) ; docs/DESIGN_SYSTEM.md §5.17 (« l'accueil ne prétend pas une absence qu'il n'a
//           pas mesurée »), §7 (quatre paliers, aucun défilement horizontal)
// @verifies CRM-131 (docs/BACKLOG.md) — hors d'un track, la barre d'onglets : « Ouvrez un track pour voir ses channels » à
//           qui lit des channels, « Aucun channel » à qui n'en lit aucun ; souris et clavier ; captures aux quatre
//           paliers ; docs/SPEC-channels.md §5.5, docs/DESIGN_SYSTEM.md §4, décision 868
// @verifies CLAUDE.md §10 (la présence se mesure sous les vrais droits du compte), §15 (état déterministe), §16 (captures)
//
// AUCUNE RÉPONSE N'EST SUBSTITUÉE : l'état neutre paraît parce que le seed porte des channels que l'administratrice et
// la lectrice lisent, l'état vide parce que l'espace neuf n'en porte aucun. L'espace neuf suit le montage de
// `demarrage.spec.ts` (§8 ter) sous un identifiant à lui, et la preuve le détruit en constatant la base rendue à son
// unique workspace seedé. Le seed n'est pas modifié.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { URL_API, enTetesService } from '../api/jetons'
import { creerCompteJetable, supprimerCompte } from '../api/keycloak-dev'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-129'
const UNITE_BARRE = 'CRM-131'
const BARRE_NEUTRE = 'Ouvrez un track pour voir ses channels'
const BARRE_VIDE = 'Aucun channel'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const ESPACE_SANS_CHANNEL = { id: '5eed0000-0000-4000-8000-0000000000f2', slug: 'espace-sans-channel' } as const
const CLE_MASQUE = 'p2enjoy.demarrage.masque'

const TITRE_NEUTRE = 'Choisissez un channel'
const CORPS_NEUTRE = "Un board affiche les affaires d'un channel. Ouvrez un track dans la barre latérale, puis l'un de ses channels."
const TITRE_VIDE = 'Aucun board à afficher'
const PHRASE_ABSENCE = "Aucun channel n'est disponible dans cet espace de travail."

type Compte = { readonly adresse: string; readonly sub: string }

async function monterEspaceSansChannel(requete: APIRequestContext): Promise<Compte> {
	const compte = await creerCompteJetable('sans-channel', 'Sans', 'Channel')
	const workspace = await requete.post(`${URL_API}/rest/v1/workspaces`, {
		headers: enTetesService(),
		data: [{ ...ESPACE_SANS_CHANNEL, name: 'Espace sans channel', inbound_domain: 'sans-channel.p2enjoy.test' }],
	})
	expect(workspace.status(), 'le workspace sans channel doit être créé').toBe(201)
	const attente = await requete.post(`${URL_API}/rest/v1/workspace_invitations`, {
		headers: enTetesService(),
		data: [{ workspace_id: ESPACE_SANS_CHANNEL.id, email: compte.adresse, role: 'admin' }],
	})
	expect(attente.status(), 'le compte doit être attendu comme admin de son espace').toBe(201)
	return compte
}

async function demonterEspaceSansChannel(requete: APIRequestContext, compte: Compte | null): Promise<void> {
	await requete.delete(`${URL_API}/rest/v1/workspaces?id=eq.${ESPACE_SANS_CHANNEL.id}`, { headers: enTetesService() })
	if (compte !== null) {
		await requete.delete(`${URL_API}/rest/v1/profiles?id=eq.${compte.sub}`, { headers: enTetesService() })
		await supprimerCompte(compte.sub)
	}
	const restants = await requete.get(`${URL_API}/rest/v1/workspaces?select=id`, { headers: enTetesService() })
	expect(restants.status()).toBe(200)
	expect((await restants.json()) as { id: string }[], 'la base doit être rendue à son unique workspace seedé').toEqual([
		{ id: WORKSPACE_SEED },
	])
}

/** Avance au clavier jusqu'à l'élément désigné : la preuve n'appuie que sur Tab, jamais sur un `focus()`. */
async function tabulerJusqua(page: Page, testId: string): Promise<void> {
	for (let pas = 0; pas < 80; pas += 1) {
		await page.keyboard.press('Tab')
		const atteint = await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, testId)
		if (atteint) return
	}
	throw new Error(`« ${testId} » n'est pas atteignable au clavier`)
}

async function sansDefilementDeCote(page: Page, palier: string): Promise<void> {
	const deborde = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
	expect(deborde, `la page ne doit pas défiler horizontalement à ${palier}`).toBe(false)
}

/** Avance au clavier jusqu'au lien dont le texte est `nom`. */
async function tabulerJusquauLien(page: Page, nom: string): Promise<void> {
	for (let pas = 0; pas < 80; pas += 1) {
		await page.keyboard.press('Tab')
		const atteint = await page.evaluate(
			(n) => document.activeElement?.tagName === 'A' && document.activeElement.textContent?.trim() === n,
			nom,
		)
		if (atteint) return
	}
	throw new Error(`le lien « ${nom} » n'est pas atteignable au clavier`)
}

async function attendreBarreNeutre(page: Page): Promise<void> {
	const barre = page.getByTestId('barre-onglets')
	await expect(barre.getByTestId('onglets-choisir')).toHaveText(BARRE_NEUTRE)
	await expect(barre.getByTestId('onglets-vides')).toHaveCount(0)
	await expect(barre.getByText(BARRE_VIDE, { exact: true })).toHaveCount(0)
}

async function attendreNeutre(page: Page): Promise<void> {
	const neutre = page.getByTestId('accueil-choisir')
	await expect(neutre).toBeVisible()
	await expect(neutre.getByRole('heading', { level: 2 })).toHaveText(TITRE_NEUTRE)
	await expect(neutre).toContainText(CORPS_NEUTRE)
	await expect(page.getByTestId('etat-vide')).toHaveCount(0)
	await expect(page.getByText(PHRASE_ABSENCE)).toHaveCount(0)
}

test.describe('CRM-129 — l’accueil ne prétend plus une absence de channel', () => {
	test('l’administratrice, six étapes faites, lit l’état neutre aux quatre paliers, sans lien de retour', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/')
			await attendreNeutre(page)
			await expect(page.getByTestId('rouvrir-guide')).toHaveCount(0)
			await sansDefilementDeCote(page, palier.nom)
			await capturer(page, `accueil-neutre-${palier.nom}`, UNITE)
		}
	})

	test('la lectrice masque le guide À LA SOURIS : l’état neutre, et le chemin de retour', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/')
		await expect(page.getByTestId('guide-demarrage')).toBeVisible()
		await page.getByTestId('masquer-guide').click()
		await expect(page.getByTestId('guide-demarrage')).toBeHidden()
		await attendreNeutre(page)
		await capturer(page, 'accueil-neutre-masque-xl-1440', UNITE)
		await page.getByTestId('rouvrir-guide').click()
		await expect(page).toHaveURL(/\/demarrage$/)
		await expect(page.getByTestId('guide-demarrage')).toBeVisible()
	})

	test('la lectrice masque le guide AU CLAVIER SEUL, puis le rouvre au clavier', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/')
		await expect(page.getByTestId('guide-demarrage')).toBeVisible()
		await tabulerJusqua(page, 'masquer-guide')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('guide-demarrage')).toBeHidden()
		await attendreNeutre(page)
		await tabulerJusqua(page, 'rouvrir-guide')
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/demarrage$/)
	})

	test('un compte qui ne lit AUCUN channel : l’état vide, à la souris puis au clavier, aux quatre paliers', async ({
		page,
		request,
	}) => {
		test.setTimeout(120_000)
		let compte: Compte | null = null
		try {
			compte = await monterEspaceSansChannel(request)
			await connecterAvecLeLabs(page, compte.adresse)
			await page.goto('/')
			await expect(page.getByTestId('etape-channel')).toContainText('À faire')

			// À la souris.
			await page.getByTestId('masquer-guide').click()
			const vide = page.getByTestId('etat-vide')
			await expect(vide).toBeVisible()
			await expect(vide.getByRole('heading', { level: 2 })).toHaveText(TITRE_VIDE)
			await expect(vide).toContainText(PHRASE_ABSENCE)
			await expect(page.getByTestId('accueil-choisir')).toHaveCount(0)
			await expect(vide.getByTestId('rouvrir-guide')).toBeVisible()

			for (const palier of PALIERS) {
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				await page.goto('/')
				await expect(page.getByTestId('etat-vide')).toContainText(PHRASE_ABSENCE)
				await sansDefilementDeCote(page, palier.nom)
				await capturer(page, `accueil-vide-sans-channel-${palier.nom}`, UNITE)
			}

			// Au clavier : la préférence de la session est levée, le guide revient, et la touche le masque.
			await page.setViewportSize({ width: 1440, height: 900 })
			await page.evaluate((cle) => sessionStorage.removeItem(cle), CLE_MASQUE)
			await page.goto('/')
			await expect(page.getByTestId('guide-demarrage')).toBeVisible()
			await tabulerJusqua(page, 'masquer-guide')
			await page.keyboard.press('Enter')
			await expect(page.getByTestId('etat-vide')).toContainText(PHRASE_ABSENCE)
			await expect(page.getByTestId('accueil-choisir')).toHaveCount(0)
		} finally {
			await demonterEspaceSansChannel(request, compte)
		}
	})
})

test.describe('CRM-131 — hors d’un track, la barre ne prétend plus une absence', () => {
	test('l’administratrice : texte neutre sur l’accueil et l’Inbox, les onglets dans un track, aux quatre paliers', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/inbox')
			await attendreBarreNeutre(page)
			await sansDefilementDeCote(page, palier.nom)
			await capturer(page, `barre-neutre-${palier.nom}`, UNITE_BARRE)
		}
	})

	test('À LA SOURIS : de l’Inbox à un track, puis retour — la barre dit vrai à chaque étape', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/')
		await attendreBarreNeutre(page)
		await page.getByRole('link', { name: 'Inbox', exact: true }).click()
		await expect(page).toHaveURL(/\/inbox$/)
		await attendreBarreNeutre(page)
		await page.getByTestId('entree-track').filter({ hasText: 'Conseil & IA' }).click()
		await expect(page.getByTestId('onglet-channel').first()).toBeVisible()
		await expect(page.getByTestId('onglets-choisir')).toHaveCount(0)
		await page.getByRole('link', { name: 'Inbox', exact: true }).click()
		await attendreBarreNeutre(page)
	})

	test('AU CLAVIER SEUL : la lectrice atteint l’Inbox, et la barre porte le texte neutre', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/contacts')
		await attendreBarreNeutre(page)
		await tabulerJusquauLien(page, 'Inbox')
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/\/inbox$/)
		await attendreBarreNeutre(page)
	})

	test('un compte qui ne lit AUCUN channel : « Aucun channel », à la souris puis au clavier, aux quatre paliers', async ({
		page,
		request,
	}) => {
		test.setTimeout(120_000)
		let compte: Compte | null = null
		try {
			compte = await monterEspaceSansChannel(request)
			await connecterAvecLeLabs(page, compte.adresse)
			await page.setViewportSize({ width: 1440, height: 900 })
			await page.goto('/')
			const barre = page.getByTestId('barre-onglets')
			await expect(barre.getByTestId('onglets-vides')).toHaveText(BARRE_VIDE)
			await expect(barre.getByTestId('onglets-choisir')).toHaveCount(0)

			// À la souris.
			await page.getByRole('link', { name: 'Contacts', exact: true }).click()
			await expect(page).toHaveURL(/\/contacts$/)
			await expect(barre.getByTestId('onglets-vides')).toHaveText(BARRE_VIDE)
			// Au clavier.
			await tabulerJusquauLien(page, 'Inbox')
			await page.keyboard.press('Enter')
			await expect(page).toHaveURL(/\/inbox$/)
			await expect(barre.getByTestId('onglets-vides')).toHaveText(BARRE_VIDE)
			await expect(barre.getByTestId('onglets-choisir')).toHaveCount(0)

			for (const palier of PALIERS) {
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				await page.goto('/inbox')
				await expect(page.getByTestId('barre-onglets').getByTestId('onglets-vides')).toHaveText(BARRE_VIDE)
				await sansDefilementDeCote(page, palier.nom)
				await capturer(page, `barre-vide-sans-channel-${palier.nom}`, UNITE_BARRE)
			}
		} finally {
			await demonterEspaceSansChannel(request, compte)
		}
	})
})
