// @verifies CRM-043 (docs/BACKLOG.md) — le panneau de commentaires dans l'application réelle
// @verifies docs/SPEC-cards.md §13.4 (la pierre tombale garde sa place), §13.5 (mention
//           « modifié »), §13.6 (le refus vient du backend), §13.9 (recharger à l'abonnement),
//           §13.10 (ce que le panneau montre), §13.14 (preuves attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.10 (panneau de commentaires), §5.3 (deux colonnes),
//           §5.8 (états), §7 (paliers), §8 (accessibilité) ; CLAUDE.md §16 (vérification visuelle)
//
// Ces scénarios s'exécutent contre le **build de production** servi par `vite preview`, et contre
// la vraie API. Rien n'est simulé, sauf là où c'est explicitement dit — et alors c'est le
// **réseau** qui est manipulé, jamais un état interne de l'application
// (docs/DESIGN_SYSTEM.md §12.5).
//
// CE QU'ILS PROUVENT, ET CE QU'ILS NE PROUVENT PAS.
//
// Ils prouvent que le panneau existe sur la route de détail, qu'il interroge réellement
// `public.card_comments` avec le filtre de la card, et qu'il rend ce que le §13.10 décrit. Ils
// La publication réelle d'une administratrice connectée et le refus du `viewer` sont désormais
// prouvés sans substitution dans `e2e/ui/authentification.spec.ts`. Ce fichier conserve les états
// fins du panneau et les réponses substituées qui les rendent déterministes.

import { expect, test, type Page, type Route } from '@playwright/test'
import { PALIERS, capturer } from './captures'

const ROUTE_COMMENTAIRES = '**/rest/v1/card_comments*'
const ROUTE_VALEURS = '**/rest/v1/card_field_values*'
const ROUTE_CHAMPS = '**/rest/v1/form_fields*'
const ROUTE_REGLES = '**/rest/v1/form_field_rules*'
const ROUTE_ETAPES = '**/rest/v1/workflow_steps*'
const ROUTE_CARDS = '**/rest/v1/cards*'
const ROUTE_TRACKS = '**/rest/v1/tracks*'
const ROUTE_CHANNELS = '**/rest/v1/channels*'

/** Identifiants du seed, employés tels quels : l'adresse doit être une adresse réelle du produit. */
const CARD = '5eed0000-0000-4000-8000-0000000000c6'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'
const TRACK = { id: '5eed0000-0000-4000-8000-000000000023', slug: 'formation', nom: 'Formation' }
const CHANNEL = { id: '5eed0000-0000-4000-8000-000000000036', slug: 'inter-entreprises' }
const ADRESSE = `/tracks/${TRACK.slug}/${CHANNEL.slug}/cards/${CARD}`

const ETAPE = { id: 'etape-1', label: 'Prospection' }

const CARD_SERVIE = [
	{
		id: CARD,
		title: 'Piste entrante à qualifier',
		workflow_id: 'wf-1',
		workspace_id: WORKSPACE,
		current_step_id: ETAPE.id,
		email_local_part: 'c-t2dtpcjd',
	},
]

const ETAPE_SERVIE = [{ id: ETAPE.id, workflow_nodes_catalog: { label: ETAPE.label } }]
const CHAMPS_SERVIS = [
	{
		id: 'f-1',
		key: 'source',
		label: 'Source du lead',
		type: 'select',
		position: 1,
		options: { choices: [{ key: 'salon', label: 'Salon' }] },
		help_text: null,
		archived_at: null,
	},
]
const REGLES_SERVIES = [{ field_id: 'f-1', step_id: ETAPE.id, visibility: 'visible' }]
const VALEURS_SERVIES: unknown[] = []
const TRACK_SERVI = [
	{ id: TRACK.id, name: TRACK.nom, slug: TRACK.slug, color: 'accent', icon: 'graduation-cap', position: 3 },
]
const CHANNELS_SERVIS = [{ id: CHANNEL.id, name: 'Inter-entreprises', slug: CHANNEL.slug, position: 1 }]

/**
 * Trois commentaires servis, et chacun exerce un état du §13.10 : un vivant, un **modifié**, une
 * **pierre tombale** au corps vide. Leur forme est celle que PostgREST rend, colonnes comprises.
 */
const COMMENTAIRES_SERVIS = [
	{
		id: 'd1',
		card_id: CARD,
		author_id: '5eed0000-0000-4000-8000-000000000011',
		body: 'La DSI a confirmé le périmètre de la refonte : trois gabarits, pas cinq.',
		created_at: '2026-08-05T09:00:00+00:00',
		edited_at: null,
		deleted_at: null,
	},
	{
		id: 'd2',
		card_id: CARD,
		author_id: '5eed0000-0000-4000-8000-000000000012',
		body: 'Budget confirmé à 48 000 EUR hors maintenance, et hors reprise de contenu.',
		created_at: '2026-08-05T10:00:00+00:00',
		edited_at: '2026-08-05T10:30:00+00:00',
		deleted_at: null,
	},
	{
		id: 'd3',
		card_id: CARD,
		author_id: '5eed0000-0000-4000-8000-000000000012',
		body: '',
		created_at: '2026-08-05T11:00:00+00:00',
		edited_at: null,
		deleted_at: '2026-08-05T11:05:00+00:00',
	},
]

const servir = (corps: unknown) => (route: Route) =>
	route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) })

/**
 * Sert le chargement complet de l'écran.
 *
 * `card_comments` et `card_field_values` sont déclarées **avant** `cards` : le motif de
 * `ROUTE_CARDS` capturerait aussi les deux — il se termine par une étoile —, et la première route
 * déclarée l'emporte dans Playwright. Le piège avait déjà été rencontré par `CRM-037` ; il est
 * reconduit ici, à un nom près.
 */
async function servirEcran(page: Page, commentaires: unknown = COMMENTAIRES_SERVIS): Promise<void> {
	await page.route(ROUTE_COMMENTAIRES, servir(commentaires))
	await page.route(ROUTE_VALEURS, servir(VALEURS_SERVIES))
	await page.route(ROUTE_CHAMPS, servir(CHAMPS_SERVIS))
	await page.route(ROUTE_REGLES, servir(REGLES_SERVIES))
	await page.route(ROUTE_ETAPES, servir(ETAPE_SERVIE))
	await page.route(ROUTE_CARDS, servir(CARD_SERVIE))
	await page.route(ROUTE_CHANNELS, servir(CHANNELS_SERVIS))
	await page.route(ROUTE_TRACKS, servir(TRACK_SERVI))
}

// Le libellé de la région a changé avec `CRM-044` : la colonne de droite n'est plus le seul
// panneau de commentaires, c'est le FIL de l'affaire — le §5.10 du design system l'annonçait
// comme « la première voie d'un fil unifié ». Les scénarios ci-dessous restent ceux de `CRM-043`
// et portent sur les commentaires ; `e2e/ui/timeline.spec.ts` porte sur le fil.
const fil = (page: Page) => page.getByRole('region', { name: 'Fil de cette affaire' })

test.describe('le panneau interroge réellement `card_comments`', () => {
	// L'APPELANT ANONYME N'ATTEINT JAMAIS LE PANNEAU, et c'est mesuré ici plutôt qu'affirmé. Sans
	// aucune substitution et sans connexion, la route rend « card introuvable » — refus réel du
	// backend —, le panneau n'est donc pas monté, et AUCUNE requête ne part vers
	// `card_comments`. C'est ce que le premier scénario constate ; le second substitue la card, et
	// la seule chose qu'il ne substitue pas est précisément la requête qu'il observe.
	test('sans session, l’écran n’atteint pas le panneau : aucune requête ne part', async ({ page }) => {
		let vue = false
		page.on('request', (requete) => {
			if (requete.url().includes('/rest/v1/card_comments')) vue = true
		})
		await page.goto(ADRESSE)
		await expect(page.getByTestId('etat-vide')).toContainText('Card introuvable')
		expect(vue, 'aucun fil n’est demandé pour une card que l’appelant ne voit pas').toBe(false)
	})

	test('la card servie, la requête du fil part vers la VRAIE API, filtrée et ordonnée', async ({
		page,
	}) => {
		// Tout est substitué SAUF `card_comments` : la requête observée est celle que le produit
		// émet, et la réponse est celle que la pile rend réellement à un appelant anonyme.
		await page.route(ROUTE_VALEURS, servir(VALEURS_SERVIES))
		await page.route(ROUTE_CHAMPS, servir(CHAMPS_SERVIS))
		await page.route(ROUTE_REGLES, servir(REGLES_SERVIES))
		await page.route(ROUTE_ETAPES, servir(ETAPE_SERVIE))
		await page.route(ROUTE_CARDS, servir(CARD_SERVIE))
		await page.route(ROUTE_CHANNELS, servir(CHANNELS_SERVIS))
		await page.route(ROUTE_TRACKS, servir(TRACK_SERVI))

		const attendue = page.waitForResponse((reponse) =>
			reponse.url().includes('/rest/v1/card_comments?'),
		)
		await page.goto(ADRESSE)
		const reponse = await attendue
		const url = new URL(reponse.url())
		expect(url.searchParams.get('card_id'), 'le fil est celui d’UNE card').toBe(`eq.${CARD}`)
		// L'ordre est TOTAL, terminé par `id` : c'est la leçon de la sonde `sonde_l2` de `CRM-042`.
		expect(url.searchParams.get('order'), 'l’ordre est total (§13.10)').toBe('created_at.asc,id.asc')

		// Le refus de la RLS est ZÉRO LIGNE, jamais une erreur — et l'écran affiche donc son état
		// vide, non son état d'erreur.
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
		await expect(fil(page).getByTestId('etat-vide')).toBeVisible()
	})
})

test.describe('fil chargé (réponse réseau substituée, docs/DESIGN_SYSTEM.md §12.5)', () => {
	test('les trois états d’un commentaire sont rendus, dans l’ordre de la conversation', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirEcran(page)
		await page.goto(ADRESSE)

		const articles = fil(page).getByRole('article')
		await expect(articles).toHaveCount(3)
		// Ordre CROISSANT : le plus ancien en haut, le composeur en bas (§5.10).
		await expect(articles.nth(0)).toContainText('La DSI a confirmé')
		await expect(articles.nth(1)).toContainText('Budget confirmé')
		// La pierre tombale TIENT SA PLACE, réduite à sa mention : la masquer ferait disparaître un
		// tour de parole d'une conversation (§13.4).
		await expect(articles.nth(2)).toContainText('Commentaire supprimé')

		await capturer(page, 'fil-charge-1440', 'CRM-043')
	})

	test('la mention « modifié » porte sa date en infobulle, et n’apparaît que là où elle doit', async ({
		page,
	}) => {
		await servirEcran(page)
		await page.goto(ADRESSE)

		const modifies = fil(page).getByText('modifié', { exact: true })
		await expect(modifies).toHaveCount(1)
		await expect(modifies).toHaveAttribute('title', /Modifié le/)
	})

	// INC-014 : `profiles` n'est lisible par aucun jeton d'utilisateur. La règle du §12.5 du design
	// system s'applique — une donnée illisible n'est PAS rendue, plutôt que rendue vide.
	test('aucun nom ni identifiant d’auteur n’est affiché', async ({ page }) => {
		await servirEcran(page)
		await page.goto(ADRESSE)
		await expect(fil(page).getByRole('article').first()).toBeVisible()
		await expect(fil(page)).not.toContainText('5eed0000-0000-4000-8000-000000000011')
	})

	test('le fil vide le dit, plutôt que de rester muet', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirEcran(page, [])
		await page.goto(ADRESSE)
		await expect(fil(page).getByTestId('etat-vide')).toBeVisible()
		// Le vide d'un fil unifié ne parle plus des seuls commentaires : les deux sources sont
		// vides, et le §5.11 distingue ce cas de « aucun élément pour ces filtres ».
		await expect(fil(page).getByTestId('etat-vide')).toContainText('Aucun événement')
		await capturer(page, 'fil-vide-1440', 'CRM-043')
	})
})

test.describe('le composeur, et le refus qui vient du backend (§13.6)', () => {
	test('le composeur est TOUJOURS rendu, et sa publication est désactivée à vide', async ({
		page,
	}) => {
		await servirEcran(page, [])
		await page.goto(ADRESSE)
		const publier = page.getByRole('button', { name: 'Publier' })
		await expect(publier).toBeVisible()
		// L'interface ne calcule aucun droit : elle envoie, et traduit le refus (`CLAUDE.md` §10).
		await expect(publier).toBeDisabled()
	})

	test('un `403` du backend est affiché ET LE TEXTE SAISI EST CONSERVÉ', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirEcran(page, [])
		// Le refus est celui du **réseau**, à la forme exacte de ce que PostgREST rend à un appelant
		// sans droit d'écriture : `42501`. C'est la réponse que le `viewer` reçoit réellement, et
		// `e2e/api/commentaires.spec.ts` la mesure avec son jeton.
		await page.route(ROUTE_COMMENTAIRES, (route) => {
			if (route.request().method() === 'POST') {
				return route.fulfill({
					status: 403,
					contentType: 'application/json',
					body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy' }),
				})
			}
			return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
		})
		await page.goto(ADRESSE)

		const champ = page.getByLabel('Votre commentaire')
		await champ.fill('Un texte auquel je tiens')
		await page.getByRole('button', { name: 'Publier' }).click()

		await expect(page.getByRole('alert')).toContainText('Vous ne pouvez pas commenter')
		// Vider le champ ferait perdre à l'utilisateur un texte pour une erreur qui n'est pas la
		// sienne (§5.10).
		await expect(champ).toHaveValue('Un texte auquel je tiens')
		await capturer(page, 'refus-ecriture-1440', 'CRM-043')
	})

	test('la publication se fait au CLAVIER, sans aucune souris', async ({ page }) => {
		await servirEcran(page, [])
		const envoi = page.waitForRequest(
			(requete) => requete.method() === 'POST' && requete.url().includes('/rest/v1/card_comments'),
		)
		await page.goto(ADRESSE)

		await page.getByLabel('Votre commentaire').focus()
		await page.keyboard.type('Au clavier')
		await page.keyboard.press('Tab')
		await page.keyboard.press('Enter')

		const charge = JSON.parse((await envoi).postData() ?? '{}')
		expect(charge.body).toBe('Au clavier')
		// `author_id` n'est jamais envoyé : la colonne vaut `auth.uid()`, et la politique refuse
		// toute autre valeur (décision 196).
		expect(charge).not.toHaveProperty('author_id')
	})
})

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le panneau tient dans la page, sans débordement horizontal`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await servirEcran(page)
			await page.goto(ADRESSE)
			await expect(fil(page).getByRole('article').first()).toBeVisible()

			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBeLessThanOrEqual(0)

			await capturer(page, `panneau-${palier.nom}`, 'CRM-043')
		})
	}
})

test.describe('données longues (docs/DESIGN_SYSTEM.md §5.10)', () => {
	test('un commentaire très long est replié, et ne fait pas défiler la page', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await servirEcran(page, [
			{
				...COMMENTAIRES_SERVIS[0],
				body: `Motmotmotmotmotmotmotmotmotmotmot ${'très-long-mot-sans-espace-'.repeat(8)}fin.`,
			},
		])
		await page.goto(ADRESSE)
		await expect(fil(page).getByRole('article').first()).toBeVisible()

		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
		)
		expect(debordement, 'un mot sans espace ne pousse pas la page').toBeLessThanOrEqual(0)
		await capturer(page, 'commentaire-long-390', 'CRM-043')
	})
})
