// @verifies CRM-042 (docs/BACKLOG.md) — la vue liste d'un channel dans l'application réelle
// @verifies CRM-046 (docs/BACKLOG.md) — le volume et les données longues du jeu de démonstration
// @verifies docs/SPEC-seed.md §9.11 (le contrat du volume), §9.11.4 (la card aux données longues),
//           §9.11.7 (preuves n° 4 et n° 6)
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
// Le premier scénario n'emploie **aucune substitution** : il exerce explicitement l'anonyme, qui
// n'obtient rien et voit « track introuvable » — le refus réel du backend.
//
// Les suivants substituent les réponses réseau pour montrer ce que le §12 décrit : le tableau, le
// tri et son `aria-sort`, les deux filtres, la pagination et ses boutons désactivés, le `416`,
// l'état vide filtré et la bascule board ↔ liste. La connexion réelle, commune à ces lectures, est
// prouvée dans `e2e/ui/authentification.spec.ts`.
//
// LE DERNIER BLOC N'EN SUBSTITUE AUCUNE. Depuis que `CRM-046` a posé le volume et les données
// longues dans le seed (`docs/SPEC-seed.md` §9.11), les données longues et la seconde page se
// prouvent contre la BASE : connexion réelle au clavier, adresse réelle, aucune route posée.

import {
	autoriserErreursConsole,
	ERREUR_RESSOURCE_HTTP,
	expect,
	test,
	type Page,
	type Route,
} from './fixtures'
import { PALIERS, capturer } from './captures'
/** Le mot de passe commun des comptes du seed : la connexion des scénarios réels est la vraie. */
import { MOT_DE_PASSE_SEED } from '../api/jetons'

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

// La card aux données longues qui était SERVIE ici jusqu'au 2026-08-16 a disparu : le seed en
// porte désormais une vraie, `…d001`, et les deux scénarios de données longues l'exercent contre
// la pile réelle (`docs/SPEC-seed.md` §9.11.4). Une fixture qui ne sert plus rien n'est pas
// conservée « au cas où » : elle donnerait à croire qu'une substitution reste nécessaire.

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
	test('rend une ligne par affaire, avec ses six colonnes', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await ouvrir(page, ADRESSE)

		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		await expect(page.getByTestId('ligne-card')).toHaveCount(3)
		await expect(page.getByRole('columnheader')).toHaveCount(6)
		await expect(page.getByRole('columnheader', { name: 'Responsable' })).toBeVisible()
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

	// TITRE ET ATTENTE RÉVISÉS LE 2026-08-27, JAMAIS RETIRÉS (mécanisme de la décision 51) : la
	// décision 532 §2 ferme INC-230 et donne au produit UN seul vocabulaire de recherche. Ce que la
	// preuve établit ne change pas — la requête part à la SOUMISSION, jamais à la frappe —, mais la
	// configuration qu'elle fige est désormais celle de la colonne (migration 0069).
	test('la recherche part en `plfts(francais_sans_accent)` à la soumission, pas à la frappe', async ({ page }) => {
		const journal: Demande[] = []
		await ouvrir(page, ADRESSE, { journal })
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		const avant = journal.length

		await page.getByTestId('filtre-recherche').fill('refonte')
		expect(journal.length, 'aucune requête à la frappe').toBe(avant)

		await page.getByTestId('valider-recherche').click()
		await expect(page).toHaveURL(/q=refonte/)
		await expect
			.poll(() => journal[journal.length - 1]?.recherche)
			.toBe('plfts(francais_sans_accent).refonte')
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
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[416]])
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

// --- Données longues et SECONDE page, SANS AUCUNE SUBSTITUTION ---------------------------------
//
// CE BLOC A CHANGÉ DE NATURE LE 2026-08-16, ET IL FAUT DIRE POURQUOI.
//
// Jusque-là, les deux scénarios de données longues servaient une card FABRIQUÉE sur le réseau
// (`docs/DESIGN_SYSTEM.md` §12.5), parce que le seed n'en portait aucune — MESURÉ alors : 36
// caractères au plus. Le manque était nommé au §12.11 et renvoyé à `CRM-046`, qui l'a comblé :
// `docs/SPEC-seed.md` §9.11 pose vingt-six affaires dans « maintenance », dont `…d001` à 128
// caractères de titre et 134 de prochaine action — exactement les longueurs que la substitution
// servait, pour que ces captures montrent la même chose sans dépendre d'elle.
//
// Ces scénarios ne posent donc plus AUCUNE route : la connexion est réelle, au clavier, et chaque
// requête part à la vraie API. Ils prouvent ce qu'une substitution ne pouvait pas prouver — que la
// pile rend réellement cette donnée-là, et que l'écran la tient. La seconde page suit le même
// chemin : elle existe désormais en base, et se franchit par le vrai bouton.

test.describe('les données longues et la seconde page, contre la pile réelle', () => {
	/** Le channel de VOLUME du §9.11.1 : 27 cards actives, le seul du seed à avoir deux pages. */
	const ADRESSE_VOLUME = '/tracks/studio-web/maintenance/liste'
	/** La card aux données longues du §9.11.4. Son titre commence par « A » : première page. */
	const CARD_D001 = '5eed0000-0000-4000-8000-00000000d001'
	/** Mesurés en base, et non recopiés d'un souvenir (§9.11.7, preuve n° 3). */
	const LONGUEUR_TITRE = 128
	const LONGUEUR_ACTION = 134
	/** §9.11.2 : 27 actives, donc une première page pleine et une seconde de deux lignes. */
	const ACTIVES_MAINTENANCE = 27

	/** Connexion par le formulaire réel — jamais un jeton posé à la main dans l'onglet. */
	async function connecter(page: Page): Promise<void> {
		await page.goto('/connexion')
		await page.getByLabel('Adresse email').click()
		await page.keyboard.press('ControlOrMeta+A')
		await page.keyboard.type('admin@p2enjoy.test')
		await page.keyboard.press('Tab')
		await page.keyboard.press('ControlOrMeta+A')
		await page.keyboard.type(MOT_DE_PASSE_SEED)
		await page.keyboard.press('Enter')
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
	}

	test('une affaire au titre très long tient sur une ligne et ne fait pas défiler la page', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await page.goto(ADRESSE_VOLUME)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		const ligne = page.locator(`[data-testid="ligne-card"][data-card="${CARD_D001}"]`)
		await expect(ligne).toBeVisible()

		// La LONGUEUR est celle de la base, pas celle d'une fixture : elle est relue dans l'écran.
		const lien = ligne.getByRole('link').first()
		const titre = (await lien.getAttribute('title')) ?? ''
		expect(titre.length, 'le titre servi par la pile réelle').toBe(LONGUEUR_TITRE)
		// La valeur entière reste atteignable par l'attribut `title` : rien n'est perdu (§12.7).
		await expect(lien).toHaveAttribute('title', titre)

		const action = (await ligne.locator('td').nth(4).getAttribute('title')) ?? ''
		expect(action.length, 'la prochaine action servie par la pile réelle').toBe(LONGUEUR_ACTION)

		// Une seule ligne de texte : la hauteur de la cellule ne dépasse pas la cible de 40 px.
		const hauteur = await ligne
			.locator('td')
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
		await connecter(page)
		await page.goto(ADRESSE_VOLUME)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		await expect(
			page.locator(`[data-testid="ligne-card"][data-card="${CARD_D001}"]`),
		).toBeVisible()
		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(debordement).toBeLessThanOrEqual(0)
		await capturer(page, 'liste-donnees-longues-390', 'CRM-042')
	})

	// LA PREUVE QUE LA SUBSTITUTION NE POUVAIT PAS RENDRE : une seconde page réellement servie,
	// franchie par le bouton du produit, sur une donnée que la base porte (§9.11.7, preuve n° 4).
	test('la première page est PLEINE, et le bouton « suivante » mène à une seconde page réelle', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await page.goto(ADRESSE_VOLUME)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		await expect(page.getByTestId('ligne-card')).toHaveCount(LIGNES_PAR_PAGE)

		const suivante = page.getByTestId('page-suivante')
		await expect(suivante).toBeEnabled()
		await suivante.click()

		await expect(page).toHaveURL(new RegExp('page=2'))
		await expect(page.getByTestId('ligne-card')).toHaveCount(
			ACTIVES_MAINTENANCE - LIGNES_PAR_PAGE,
		)
		// Au bout de la plage, le produit refuse d'aller plus loin plutôt que d'appeler un `416`.
		await expect(page.getByTestId('page-suivante')).toBeDisabled()
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)

		await capturer(page, 'liste-seconde-page-1440', 'CRM-046')
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

// --- LE PARCOURS ENTIER, DE L'ACCUEIL À LA SECONDE PAGE, SANS UNE SEULE ADRESSE SAISIE ----------
//
// CE BLOC LÈVE L'ÉCART QUI MAINTENAIT `CRM-042` OUVERTE, et il faut dire ce qui manquait.
//
// L'unité prouvait le tri, les filtres et la pagination contre des réponses substituées ; elle
// prouvait les requêtes émises hors interface avec le jeton réel de l'administratrice ; et depuis
// le 2026-08-16 elle prouvait les données longues et la seconde page contre la pile réelle. Ce qui
// manquait était le CHAÎNAGE : aucun scénario ne partait de l'accueil pour ARRIVER à la liste par
// des gestes. Tous s'y rendaient en écrivant l'adresse, ce que l'utilisateur ne fait pas.
//
// L'écart invoquait INC-021 — « aucune unité ne porte l'écran de connexion ». Ce blocage a disparu
// le 2026-08-07 avec `CRM-009` ; la citation lui a survécu d'une semaine (INC-143). Rien
// n'empêchait donc plus cette preuve, sinon qu'elle n'avait pas été écrite.
//
// Ici : connexion au formulaire réel, puis accueil, puis la pilule du track, puis l'onglet du
// channel, puis la bascule de vue, puis le bouton de page suivante. Six gestes, aucune adresse.

test.describe('le parcours complet, à la souris et au clavier seuls', () => {
	/** Le track et le channel de VOLUME : 27 cards actives, seul channel du seed à deux pages. */
	const TRACK = 'studio-web'
	const CHANNEL_VOLUME = 'maintenance'
	const ACTIVES = 27

	async function connecter(page: Page): Promise<void> {
		await page.goto('/connexion')
		await page.getByLabel('Adresse email').click()
		await page.keyboard.press('ControlOrMeta+A')
		await page.keyboard.type('admin@p2enjoy.test')
		await page.keyboard.press('Tab')
		await page.keyboard.press('ControlOrMeta+A')
		await page.keyboard.type(MOT_DE_PASSE_SEED)
		await page.keyboard.press('Enter')
		await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
	}

	test('de l’accueil à la seconde page : six gestes, aucune adresse saisie', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)

		// 1. L'accueil. C'est le seul `goto` du scénario, et c'est la porte d'entrée du produit.
		await page.goto('/')

		// 2. La pilule du track, désignée par son adresse et non par son rang : le seed en porte
		//    plusieurs, et « la première » changerait de sens le jour où l'ordre changerait.
		const pilule = page.locator(`[data-testid="entree-track"][href="/tracks/${TRACK}"]`)
		await expect(pilule).toBeVisible()
		await pilule.click()
		await expect(page).toHaveURL(new RegExp(`/tracks/${TRACK}$`))

		// 3. L'onglet du channel de volume.
		const onglet = page.locator(`[data-testid="onglet-channel"][href*="${CHANNEL_VOLUME}"]`)
		await expect(onglet).toBeVisible()
		await onglet.click()
		await expect(page.getByTestId('board')).toBeVisible()

		// 4. La bascule vers la vue liste — l'écran que cette unité livre.
		await page.locator('[data-testid="lien-vue"][data-vue="liste"]').click()
		await expect(page).toHaveURL(new RegExp(`${CHANNEL_VOLUME}/liste$`))
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		// Le total vient de la PILE, pas d'une fixture : c'est ce que la base contient vraiment.
		await expect(page.getByTestId('total-liste')).toContainText(String(ACTIVES))
		await expect(page.getByTestId('rang-page')).toContainText('1')
		await expect(page.getByTestId('ligne-card')).toHaveCount(LIGNES_PAR_PAGE)
		await capturer(page, 'liste-parcours-page-1', 'CRM-042')

		// 5. La seconde page, franchie par le vrai bouton.
		await page.getByTestId('page-suivante').click()
		await expect(page).toHaveURL(/page=2/)
		await expect(page.getByTestId('rang-page')).toContainText('2')
		await expect(page.getByTestId('ligne-card')).toHaveCount(ACTIVES - LIGNES_PAR_PAGE)
		// La dernière page BORNE le parcours : le bouton reste visible, et devient inactif. Le
		// vérifier plutôt que le supposer — sur la capture, seule sa teinte le distingue, et une
		// teinte ne dit pas si le clic est refusé.
		await expect(page.getByTestId('page-suivante')).toBeDisabled()
		await capturer(page, 'liste-parcours-page-2', 'CRM-042')

		// 6. Et le retour, qui doit ramener la première page pleine.
		await page.getByTestId('page-precedente').click()
		await expect(page.getByTestId('rang-page')).toContainText('1')
		await expect(page.getByTestId('ligne-card')).toHaveCount(LIGNES_PAR_PAGE)
	})

	test('le même parcours AU CLAVIER SEUL, de l’accueil à la vue liste', async ({ page }) => {
		await connecter(page)
		await page.goto('/')

		// On avance à la tabulation jusqu'à la pilule du track : aucune souris, et l'élément
		// réellement focalisé est vérifié avant d'être activé.
		const pilule = page.locator(`[data-testid="entree-track"][href="/tracks/${TRACK}"]`)
		await page.locator('body').press('Tab')
		for (let saut = 0; saut < 60; saut += 1) {
			if (await pilule.evaluate((noeud) => noeud === document.activeElement)) break
			await page.keyboard.press('Tab')
		}
		await expect(pilule).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`/tracks/${TRACK}$`))

		const onglet = page.locator(`[data-testid="onglet-channel"][href*="${CHANNEL_VOLUME}"]`)
		for (let saut = 0; saut < 60; saut += 1) {
			if (await onglet.evaluate((noeud) => noeud === document.activeElement)) break
			await page.keyboard.press('Tab')
		}
		await expect(onglet).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('board')).toBeVisible()

		const bascule = page.locator('[data-testid="lien-vue"][data-vue="liste"]')
		for (let saut = 0; saut < 60; saut += 1) {
			if (await bascule.evaluate((noeud) => noeud === document.activeElement)) break
			await page.keyboard.press('Tab')
		}
		await expect(bascule).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
	})
})
