// @verifies CRM-042 (docs/BACKLOG.md) — la vue liste d'un channel dans l'application réelle
// @verifies docs/SPEC-cards.md §12.2 (l'adresse porte tout), §12.4 (tri), §12.5 (filtres),
//           §12.6 (pagination et `416`), §12.7 (tableau et densité), §12.8 (accessibilité),
//           §12.9 (états), §12.11 (données longues), §12.12 (preuves attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.9 (tableau de données), §7 (paliers), §8 (accessibilité),
//           §12.1 (navigation par liens), §12.5 (réponses substituées), §12.6 (débordement)
// @verifies CLAUDE.md §16 (vérification visuelle)
//
// Ces scénarios s'exécutent contre le **build de production** servi par `vite preview`, et contre
// la vraie API. Rien n'est simulé, sauf là où c'est explicitement dit — et alors c'est le
// **réseau** qui est manipulé, jamais un état interne de l'application (§12.5).
//
// CE QU'ILS PROUVENT, ET CE QU'ILS NE PROUVENT PAS.
//
// Le premier scénario n'emploie **aucune substitution** : l'anonyme demande réellement le track de
// l'adresse `/liste`, n'obtient rien, et la route rend « track introuvable » — le refus réel du
// backend, mesuré par `e2e/api/liste-cards.spec.ts`. La liste ne s'affiche donc jamais en
// conditions réelles.
//
// Les suivants substituent les réponses réseau pour montrer ce que le §12 décrit : le tableau, le
// tri et son `aria-sort`, les deux filtres, la pagination et ses boutons désactivés, le `416`,
// l'état vide filtré, la bascule board ↔ liste, et le comportement avec des **données longues**
// que le seed ne porte pas (§12.11, point 3). Ils **ne prouvent pas** qu'un utilisateur connecté
// trie et pagine de bout en bout : cela suppose une session, et c'est INC-021.

import { expect, test, type Page, type Route } from '@playwright/test'
import { PALIERS, capturer } from './captures'

const ROUTE_CARDS = '**/rest/v1/cards*'
const ROUTE_ETAPES = '**/rest/v1/workflow_steps*'
const ROUTE_TRACKS = '**/rest/v1/tracks*'
const ROUTE_CHANNELS = '**/rest/v1/channels*'
const ROUTE_WORKSPACES = '**/rest/v1/workspaces*'

/** Identifiants du seed, employés tels quels : l'adresse doit être une adresse réelle du produit. */
const TRACK = { id: '5eed0000-0000-4000-8000-000000000021', slug: 'conseil-ia', nom: 'Conseil IA' }
const CHANNEL = { id: '5eed0000-0000-4000-8000-000000000032', slug: 'grands-comptes' }
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const BASE = `/tracks/${TRACK.slug}/${CHANNEL.slug}`
const ADRESSE = `${BASE}/liste`

/**
 * L'ordre TOTAL que le produit émet réellement pour un tri par titre.
 *
 * `nullslast` figure sur **chaque** critère, `id` compris : le module pose une seule règle plutôt
 * qu'une exception pour les colonnes `NOT NULL`, où la clause est sans effet. La chaîne est
 * recopiée depuis ce que la requête porte, non depuis ce qu'on croit qu'elle porte.
 */
const ORDRE_TITRE = 'title.asc.nullslast,id.asc.nullslast'

const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const RELANCE = '5eed0000-0000-4000-8000-000000000062'
const NEGOCIATION = '5eed0000-0000-4000-8000-000000000063'
const PERDU = '5eed0000-0000-4000-8000-000000000067'

const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'
const CARD_C2 = '5eed0000-0000-4000-8000-0000000000c2'
const CARD_C3 = '5eed0000-0000-4000-8000-0000000000c3'

/** Le pas de pagination du produit, importé et non recopié (décision 177). */
import { LIGNES_PAR_PAGE } from '../../webapp/src/lib/colonnes-liste'

const ETAPES_SERVIES = [
	{
		id: PROSPECTION,
		position: 1,
		label_override: null,
		stale_after_days: null,
		workflow_nodes_catalog: {
			label: 'Prospection',
			color: 'neutral',
			kind: 'open',
			default_stale_after_days: 14,
		},
	},
	{
		id: RELANCE,
		position: 2,
		label_override: null,
		stale_after_days: null,
		workflow_nodes_catalog: {
			label: 'Relance',
			color: 'accent',
			kind: 'open',
			default_stale_after_days: 7,
		},
	},
	{
		id: NEGOCIATION,
		position: 3,
		label_override: null,
		stale_after_days: 5,
		workflow_nodes_catalog: {
			label: 'Négociation',
			color: 'brand',
			kind: 'open',
			default_stale_after_days: 10,
		},
	},
	{
		id: PERDU,
		position: 7,
		label_override: null,
		stale_after_days: null,
		workflow_nodes_catalog: {
			label: 'Perdu',
			color: 'danger',
			kind: 'lost',
			default_stale_after_days: null,
		},
	},
]

/** Les trois cards actives de `grands-comptes`, telles que le seed les porte (mesuré). */
const CARDS_SERVIES = [
	{
		id: CARD_C3,
		title: 'Audit sécurité applicative',
		amount: 15500,
		currency: 'EUR',
		next_action: 'Premier appel de qualification',
		next_action_at: '2026-08-07T14:00:00+00:00',
		current_step_id: PROSPECTION,
	},
	{
		id: CARD_C2,
		title: 'Migration ERP Sogexia',
		amount: 125000,
		currency: 'EUR',
		next_action: 'Obtenir le cadrage technique',
		next_action_at: '2026-08-20T09:00:00+00:00',
		current_step_id: RELANCE,
	},
	{
		id: CARD_C1,
		title: 'Refonte du site vitrine',
		amount: 48000,
		currency: 'EUR',
		next_action: 'Relancer la DSI après la démo',
		next_action_at: '2026-08-12T09:00:00+00:00',
		current_step_id: RELANCE,
	},
]

/**
 * Une affaire aux **données longues**, que le seed ne porte pas.
 *
 * MESURÉ : le titre le plus long du seed fait 34 caractères, la prochaine action 34 également. La
 * Definition of Done exige un « comportement avec données longues vérifié en capture » : la
 * donnée est donc **servie**, le fait est nommé, et le manque appartient à `CRM-046` (§12.11).
 */
const CARD_LONGUE = {
	id: '5eed0000-0000-4000-8000-0000000000cf',
	title:
		'Refonte complète du système d’information commercial et migration des données historiques vers la nouvelle plateforme européenne',
	amount: 1234567,
	currency: 'EUR',
	next_action:
		'Obtenir la validation du comité d’investissement, puis planifier l’atelier de cadrage technique avec les quatre directions concernées',
	next_action_at: '2026-12-31T09:00:00+00:00',
	current_step_id: NEGOCIATION,
}

const TRACK_SERVI = [
	{ id: TRACK.id, name: TRACK.nom, slug: TRACK.slug, color: 'brand', icon: 'folder', position: 1 },
]

const WORKSPACES_SERVIS = [
	{ id: '5eed0000-0000-4000-8000-000000000001', name: 'P2Enjoy', slug: 'p2enjoy' },
]

/** Deux channels : avec un seul onglet, l'onglet courant serait « courant » par accident. */
const CHANNELS_SERVIS = [
	{ id: CHANNEL.id, name: 'Grands comptes', slug: CHANNEL.slug, position: 1, workflow_id: WORKFLOW },
	{ id: 'ch-2', name: 'Appels d’offres', slug: 'appels-offres', position: 2, workflow_id: WORKFLOW },
]

const servir = (corps: unknown) => (route: Route) =>
	route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) })

/**
 * Ce qu'une requête de page a réellement demandé, tel que l'écran l'a construit.
 *
 * `plage` est lue dans les paramètres `offset` et `limit`, et **non** dans un en-tête `Range` —
 * DÉFAUT DE LA SPÉCIFICATION, TROUVÉ EN EXÉCUTANT : le §12.6 annonçait un en-tête, et
 * `postgrest-js` en émet deux paramètres de requête. Le comportement de PostgREST est identique,
 * mesuré jusqu'au `416` près, mais une preuve qui aurait cherché l'en-tête serait restée aveugle.
 * Le §12.6 est corrigé dans le même changement (décision 189).
 */
type Demande = {
	ordre: string | null
	plage: string | null
	prefer: string | null
	etape: string | null
	recherche: string | null
}

/**
 * Les en-têtes sans lesquels le total n'arrive jamais jusqu'au client.
 *
 * DÉFAUT RÉEL DE FIXTURE, TROUVÉ EN EXÉCUTANT : servir `Content-Range` ne suffit pas. La page et
 * l'API sont sur deux origines distinctes, et un navigateur ne laisse lire d'une réponse
 * cross-origin que les en-têtes qu'`Access-Control-Expose-Headers` désigne. Sans lui,
 * `supabase-js` rendait `count: null` — et l'écran affichait « Chargement impossible », ce qui est
 * exactement le comportement voulu face à un total manquant (§12.6). La fixture était fautive, pas
 * le produit : PostgREST expose bien cet en-tête.
 */
const ENTETES_PAGE = {
	'access-control-allow-origin': '*',
	'access-control-expose-headers': 'content-range, content-location',
}

/**
 * Sert la page de cards, en **enregistrant** la requête et en rendant le `Content-Range` de
 * PostgREST — c'est ce que `supabase-js` lit pour en tirer son `count`. Une fixture qui
 * l'omettrait ferait croire à un total absent, et l'écran afficherait son état d'erreur.
 */
function servirPage(
	page: Page,
	{
		lignes,
		total,
		statut = 206,
		journal,
	}: {
		lignes: unknown[]
		total: number
		statut?: number
		journal?: Demande[]
	},
): Promise<unknown> {
	return page.route(ROUTE_CARDS, (route) => {
		const url = new URL(route.request().url())
		journal?.push({
			ordre: url.searchParams.get('order'),
			plage: `${url.searchParams.get('offset') ?? ''}+${url.searchParams.get('limit') ?? ''}`,
			prefer: route.request().headers()['prefer'] ?? null,
			etape: url.searchParams.get('current_step_id'),
			recherche: url.searchParams.get('search_tsv'),
		})
		if (statut === 416) {
			void route.fulfill({
				status: 416,
				contentType: 'application/json',
				headers: { ...ENTETES_PAGE, 'content-range': `*/${total}` },
				body: JSON.stringify({
					code: 'PGRST103',
					message: 'Requested range not satisfiable',
					details: null,
					hint: null,
				}),
			})
			return
		}
		const de = lignes.length === 0 ? '*' : `0-${lignes.length - 1}`
		void route.fulfill({
			status: statut,
			contentType: 'application/json',
			headers: { ...ENTETES_PAGE, 'content-range': `${de}/${total}` },
			body: JSON.stringify(lignes),
		})
	})
}

/** Sert les quatre autres réponses du chargement, à la forme exacte de ce que PostgREST rend. */
async function servirContexte(page: Page): Promise<void> {
	await page.route(ROUTE_ETAPES, servir(ETAPES_SERVIES))
	await page.route(ROUTE_CHANNELS, servir(CHANNELS_SERVIS))
	await page.route(ROUTE_TRACKS, servir(TRACK_SERVI))
	await page.route(ROUTE_WORKSPACES, servir(WORKSPACES_SERVIS))
}

async function ouvrir(
	page: Page,
	adresse: string,
	options: { lignes?: unknown[]; total?: number; statut?: number; journal?: Demande[] } = {},
): Promise<void> {
	await servirPage(page, {
		lignes: options.lignes ?? CARDS_SERVIES,
		total: options.total ?? CARDS_SERVIES.length,
		...(options.statut === undefined ? {} : { statut: options.statut }),
		...(options.journal === undefined ? {} : { journal: options.journal }),
	})
	await servirContexte(page)
	await page.goto(adresse)
}

// --- Sans aucune substitution -----------------------------------------------------------------

test.describe('la route de la vue liste, sans aucune substitution', () => {
	test('l’anonyme demande réellement le track de l’adresse et n’obtient aucune liste', async ({
		page,
	}) => {
		const attendue = page.waitForRequest(
			(requete) => requete.url().includes('/rest/v1/tracks?') && requete.url().includes('slug='),
		)
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto(ADRESSE)

		const url = new URL((await attendue).url())
		expect(url.searchParams.get('slug')).toBe(`eq.${TRACK.slug}`)
		expect(url.searchParams.get('archived_at')).toBe('is.null')

		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByTestId('tableau-liste')).toHaveCount(0)
		await capturer(page, 'liste-anonyme-1440', 'CRM-042')
	})
})

// --- Le tableau (§12.7) -----------------------------------------------------------------------

test.describe('le tableau (§12.7)', () => {
	test('rend une ligne par affaire, avec ses cinq colonnes', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await ouvrir(page, ADRESSE)

		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		await expect(page.getByTestId('ligne-card')).toHaveCount(3)
		await expect(page.getByRole('columnheader')).toHaveCount(5)
		await expect(page.getByRole('link', { name: 'Refonte du site vitrine' })).toHaveAttribute(
			'href',
			`${BASE}/cards/${CARD_C1}`,
		)
		await capturer(page, 'liste-chargee-1440', 'CRM-042')
	})

	test('affiche le total des affaires', async ({ page }) => {
		await ouvrir(page, ADRESSE, { total: 42 })
		await expect(page.getByTestId('total-liste')).toContainText('42')
	})

	// Le §12.6 du design system l'annonçait nommément pour la vue liste.
	test('porte l’indication de débordement horizontal, et la page ne défile pas', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await ouvrir(page, ADRESSE)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		const conteneur = page.getByTestId('tableau-liste').locator('xpath=..')
		await expect(conteneur).toHaveClass(/indique-debordement-x/)
		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(debordement, 'la page ne défile jamais horizontalement').toBeLessThanOrEqual(0)
	})
})

// --- Le tri (§12.4) ---------------------------------------------------------------------------

test.describe('le tri (§12.4)', () => {
	test('demande l’ordre TOTAL, terminé par `id`', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, ADRESSE, { journal })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		expect(journal.length).toBeGreaterThan(0)
		expect(journal[0]?.ordre).toBe(ORDRE_TITRE)
	})

	test('demande un total exact, et la plage de la première page', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, ADRESSE, { journal })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		expect(journal[0]?.prefer).toContain('count=exact')
		expect(journal[0]?.plage).toBe(`0+${LIGNES_PAR_PAGE}`)
	})

	test('un clic sur une colonne change le tri, l’adresse ET la requête', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, ADRESSE, { journal })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		await page.locator('[data-testid="entete-triable"][data-cle="amount"] [data-testid="tri"]').click()

		await expect(page).toHaveURL(/tri=amount/)
		await expect(
			page.locator('[data-testid="entete-triable"][data-cle="amount"]'),
		).toHaveAttribute('aria-sort', 'descending')
		await expect
			.poll(() => journal[journal.length - 1]?.ordre)
			.toBe('amount.desc.nullslast,title.asc.nullslast,id.asc.nullslast')
		await capturer(page, 'liste-tri-montant-1440', 'CRM-042')
	})

	test('un second clic sur la même colonne inverse le sens', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, ADRESSE, { journal })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		const bouton = page.locator('[data-testid="entete-triable"][data-cle="amount"] [data-testid="tri"]')
		await bouton.click()
		await expect(page).toHaveURL(/tri=amount/)
		await bouton.click()
		await expect(page).toHaveURL(/sens=asc/)
		await expect
			.poll(() => journal[journal.length - 1]?.ordre)
			.toBe('amount.asc.nullslast,title.asc.nullslast,id.asc.nullslast')
	})

	// Le tri est atteignable sans souris : c'est un bouton d'en-tête, pas un geste de pointeur.
	test('le tri se déclenche au clavier, sans aucune souris', async ({ page }) => {
		await ouvrir(page, ADRESSE)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		const bouton = page.locator('[data-testid="entete-triable"][data-cle="next_action_at"] [data-testid="tri"]')
		await bouton.focus()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(/tri=next_action_at/)
	})

	// LA clôture du §12.2 : une clé inventée ne devient jamais un `order=` envoyé à l'API.
	test('une clé de tri inventée dans l’adresse ne part JAMAIS vers l’API', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, `${ADRESSE}?tri=couleur_preferee&sens=zzz`, { journal })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		expect(journal[0]?.ordre).toBe(ORDRE_TITRE)
		expect(journal[0]?.ordre).not.toContain('couleur_preferee')
		// Et l'écran ne montre aucune erreur : une adresse tapée à la main n'est pas une panne.
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
	})
})

// --- Les filtres (§12.5) ----------------------------------------------------------------------

test.describe('les filtres (§12.5)', () => {
	test('le filtre par étape part vers l’API et s’inscrit dans l’adresse', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, ADRESSE, { journal })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		await page.getByTestId('filtre-etape').selectOption(RELANCE)
		await expect(page).toHaveURL(new RegExp(`etape=${RELANCE}`))
		await expect.poll(() => journal[journal.length - 1]?.etape).toBe(`eq.${RELANCE}`)
	})

	test('la recherche part en `plfts(french)` à la soumission, pas à la frappe', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, ADRESSE, { journal })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		const avant = journal.length

		await page.getByTestId('filtre-recherche').fill('refonte')
		expect(journal.length, 'aucune requête à la frappe').toBe(avant)

		await page.getByTestId('valider-recherche').click()
		await expect(page).toHaveURL(/q=refonte/)
		await expect.poll(() => journal[journal.length - 1]?.recherche).toBe('plfts(french).refonte')
	})

	// Deux états vides distincts : un filtre trop étroit appelle son retrait (§12.9).
	test('un filtre sans résultat rend l’état vide FILTRÉ, avec son action', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await ouvrir(page, `${ADRESSE}?q=zzzintrouvable`, { lignes: [], total: 0 })

		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByTestId('effacer-filtres-vide')).toBeVisible()
		await capturer(page, 'liste-filtre-sans-resultat-1440', 'CRM-042')

		await page.getByTestId('effacer-filtres-vide').click()
		await expect(page).not.toHaveURL(/q=/)
	})

	test('un channel sans affaire rend l’état vide SANS action d’effacement', async ({ page }) => {
		await ouvrir(page, ADRESSE, { lignes: [], total: 0 })
		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByTestId('effacer-filtres-vide')).toHaveCount(0)
	})
})

// --- La pagination (§12.6) --------------------------------------------------------------------

test.describe('la pagination (§12.6)', () => {
	const beaucoup = (nombre: number) =>
		Array.from({ length: Math.min(nombre, LIGNES_PAR_PAGE) }, (_, rang) => ({
			id: `5eed0000-0000-4000-8000-0000000${String(rang).padStart(5, '0')}`,
			title: `Affaire ${rang + 1}`,
			amount: (rang + 1) * 1000,
			currency: 'EUR',
			next_action: 'Relancer',
			next_action_at: '2026-09-01T09:00:00+00:00',
			current_step_id: RELANCE,
		}))

	test('désactive le bouton précédent sur la première page, sans le masquer', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await ouvrir(page, ADRESSE, { lignes: beaucoup(LIGNES_PAR_PAGE), total: LIGNES_PAR_PAGE * 3 })
		await expect(page.getByTestId('page-precedente')).toBeDisabled()
		await expect(page.getByTestId('page-suivante')).toBeEnabled()
		await expect(page.getByTestId('rang-page')).toContainText('1')
		await capturer(page, 'liste-pagination-1440', 'CRM-042')
	})

	test('la page suivante demande la plage suivante et s’inscrit dans l’adresse', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, ADRESSE, {
			lignes: beaucoup(LIGNES_PAR_PAGE),
			total: LIGNES_PAR_PAGE * 3,
			journal,
		})
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		await page.getByTestId('page-suivante').click()
		await expect(page).toHaveURL(/page=2/)
		await expect
			.poll(() => journal[journal.length - 1]?.plage)
			.toBe(`${LIGNES_PAR_PAGE}+${LIGNES_PAR_PAGE}`)
	})

	test('une adresse ouverte directement sur la page 2 y ouvre bien la page 2', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, `${ADRESSE}?page=2`, {
			lignes: beaucoup(LIGNES_PAR_PAGE),
			total: LIGNES_PAR_PAGE * 3,
			journal,
		})
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		expect(journal[0]?.plage).toBe(`${LIGNES_PAR_PAGE}+${LIGNES_PAR_PAGE}`)
		await expect(page.getByTestId('rang-page')).toContainText('2')
	})

	// Règle 1 du §12.6 : le rang est borné par le total connu.
	test('une adresse portant un rang hors bornes retombe sur la première page', async ({ page }) => {
		await ouvrir(page, `${ADRESSE}?page=99`, { lignes: CARDS_SERVIES, total: CARDS_SERVIES.length })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		await expect(page.getByTestId('rang-page')).toContainText('1')
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
	})

	// Règle 2 du §12.6 : le `416` est nommé pour lui-même, jamais présenté comme une panne.
	test('un `416` rend « cette page n’existe plus », et non « Chargement impossible »', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await ouvrir(page, `${ADRESSE}?page=4`, { lignes: [], total: 3, statut: 416 })

		await expect(page.getByTestId('etat-vide')).toBeVisible()
		await expect(page.getByTestId('retour-premiere-page')).toBeVisible()
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
		await capturer(page, 'liste-page-inexistante-1440', 'CRM-042')
	})
})

// --- La bascule board ↔ liste (§12.8) ----------------------------------------------------------

test.describe('la bascule entre les deux vues (§12.8)', () => {
	test('mène du board à la liste et retour, en changeant l’adresse', async ({ page }) => {
		await ouvrir(page, BASE)
		await expect(page.getByTestId('board')).toBeVisible()
		await expect(
			page.locator('[data-testid="lien-vue"][data-vue="board"]'),
		).toHaveAttribute('aria-current', 'page')

		await page.locator('[data-testid="lien-vue"][data-vue="liste"]').click()
		await expect(page).toHaveURL(new RegExp(`${CHANNEL.slug}/liste$`))
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		await expect(
			page.locator('[data-testid="lien-vue"][data-vue="liste"]'),
		).toHaveAttribute('aria-current', 'page')

		await page.locator('[data-testid="lien-vue"][data-vue="board"]').click()
		await expect(page.getByTestId('board')).toBeVisible()
	})

	// Des liens, non un `tablist` (docs/DESIGN_SYSTEM.md §12.1).
	test('la bascule est une paire de liens, non un `tablist`', async ({ page }) => {
		await ouvrir(page, ADRESSE)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		await expect(page.locator('[role="tablist"]')).toHaveCount(0)
		await expect(page.getByTestId('lien-vue')).toHaveCount(2)
	})
})

// --- Données longues (Definition of Done) ------------------------------------------------------

test.describe('le comportement avec des données longues', () => {
	// La Definition of Done l'exige nommément. Le seed ne porte rien de tel — MESURÉ, 34 caractères
	// au plus —, la donnée est donc servie et le manque est nommé (§12.11, point 3).
	test('une affaire au titre très long tient sur une ligne et ne fait pas défiler la page', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await ouvrir(page, ADRESSE, {
			lignes: [CARD_LONGUE, ...CARDS_SERVIES],
			total: CARDS_SERVIES.length + 1,
		})
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		// La valeur entière reste atteignable par l'attribut `title` : rien n'est perdu (§12.7).
		const lien = page.getByRole('link', { name: CARD_LONGUE.title })
		await expect(lien).toHaveAttribute('title', CARD_LONGUE.title)

		// Une seule ligne de texte : la hauteur de la cellule ne dépasse pas la cible de 40 px.
		const hauteur = await page
			.locator(`[data-testid="ligne-card"][data-card="${CARD_LONGUE.id}"] td`)
			.first()
			.evaluate((cellule) => cellule.getBoundingClientRect().height)
		expect(hauteur, 'une ligne de tableau reste à une ligne de texte').toBeLessThanOrEqual(48)

		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(debordement).toBeLessThanOrEqual(0)

		await capturer(page, 'liste-donnees-longues-1440', 'CRM-042')
	})

	test('les données longues tiennent aussi au plus petit palier', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await ouvrir(page, ADRESSE, {
			lignes: [CARD_LONGUE, ...CARDS_SERVIES],
			total: CARDS_SERVIES.length + 1,
		})
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(debordement).toBeLessThanOrEqual(0)
		await capturer(page, 'liste-donnees-longues-390', 'CRM-042')
	})
})

// --- Les quatre paliers (docs/DESIGN_SYSTEM.md §7) ---------------------------------------------

test.describe('paliers responsive', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la liste tient, et la page ne défile jamais horizontalement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await ouvrir(page, ADRESSE)
			await expect(page.getByTestId('tableau-liste')).toBeVisible()
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement).toBeLessThanOrEqual(0)
			await capturer(page, `liste-${palier.nom}`, 'CRM-042')
		})
	}
})
