// @verifies CRM-044 (docs/BACKLOG.md) — la timeline unifiée, contre le build de production
// @verifies docs/SPEC-cards.md §14.10 (ce que le fil unifié montre), §14.6 (aucun libellé dans le
//           `payload`), §14.14 (preuves attendues)
// @verifies docs/DESIGN_SYSTEM.md §5.11 (timeline unifiée), §5.10 (le fil des commentaires),
//           §5.8 (états systématiques), §7 (paliers), §8 (accessibilité), §12.5 (réponses
//           substituées)
// @verifies CLAUDE.md §11 (aucune persistance côté client), §16 (vérification visuelle)
//
// CE QUE CE FICHIER PROUVE SANS AUCUNE SUBSTITUTION : qu'un appelant anonyme n'obtient aucune
// card, et qu'aucune requête d'événements ne part alors — l'écran ne devine rien.
//
// CE QU'IL PROUVE CONTRE DES RÉPONSES SUBSTITUÉES, ET LE DIT : le fil chargé, ses filtres et ses
// deux vides. La webapp est un appelant **anonyme** faute d'écran de connexion (INC-021) : la RLS
// rend `200` et `[]`, et le fil ne se remplit jamais en conditions réelles. Le procédé est celui
// endossé par docs/DESIGN_SYSTEM.md §12.5. Le contrat de lecture, lui, est prouvé **hors
// interface** par `e2e/api/timeline.spec.ts` avec les jetons réels des trois comptes.

import { expect, test, type Page, type Route } from '@playwright/test'
import { PALIERS, capturer } from './captures'

const ROUTE_EVENEMENTS = '**/rest/v1/card_events*'
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

const ETAPE_PROSPECTION = { id: 'etape-1', label: 'Prospection' }
const ETAPE_RELANCE = { id: 'etape-2', label: 'Relance' }

const CARD_SERVIE = [
	{
		id: CARD,
		title: 'Piste entrante à qualifier',
		workflow_id: 'wf-1',
		workspace_id: WORKSPACE,
		current_step_id: ETAPE_PROSPECTION.id,
		email_local_part: 'c-t2dtpcjd',
	},
]

/** Les deux étapes du workflow, servies comme PostgREST les rend : le libellé vient du NŒUD. */
const ETAPES_SERVIES = [
	{ id: ETAPE_PROSPECTION.id, workflow_nodes_catalog: { label: ETAPE_PROSPECTION.label } },
	{ id: ETAPE_RELANCE.id, workflow_nodes_catalog: { label: ETAPE_RELANCE.label } },
]

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
const REGLES_SERVIES = [{ field_id: 'f-1', step_id: ETAPE_PROSPECTION.id, visibility: 'visible' }]
const VALEURS_SERVIES: unknown[] = []
const TRACK_SERVI = [
	{ id: TRACK.id, name: TRACK.nom, slug: TRACK.slug, color: 'accent', icon: 'graduation-cap', position: 3 },
]
const CHANNELS_SERVIS = [{ id: CHANNEL.id, name: 'Inter-entreprises', slug: CHANNEL.slug, position: 1 }]

/**
 * Un commentaire et quatre événements, un par famille et un type par forme de `payload`.
 *
 * `field_changed` porte `field_id` **sans** clé `from` : c'est la forme d'une valeur qui naît
 * (décision 208). `moved` porte les deux étapes, et **aucun libellé** — le fil les résout
 * (§14.6). L'horodatage de chaque ligne place le commentaire au milieu du fil, ce qui prouve la
 * fusion plutôt que la simple concaténation de deux listes.
 */
const EVENEMENTS_SERVIS = [
	{
		id: 'ev-1',
		card_id: CARD,
		type: 'created',
		actor_id: null,
		payload: { title: 'Piste entrante à qualifier', step_id: ETAPE_PROSPECTION.id },
		created_at: '2026-08-05T08:00:00+00:00',
	},
	{
		id: 'ev-2',
		card_id: CARD,
		type: 'field_changed',
		actor_id: '5eed0000-0000-4000-8000-000000000011',
		payload: { field_id: 'f-1', to: 'salon' },
		created_at: '2026-08-05T09:00:00+00:00',
	},
	{
		id: 'ev-3',
		card_id: CARD,
		type: 'moved',
		actor_id: '5eed0000-0000-4000-8000-000000000011',
		payload: { from_step_id: ETAPE_PROSPECTION.id, to_step_id: ETAPE_RELANCE.id },
		created_at: '2026-08-05T11:00:00+00:00',
	},
	{
		id: 'ev-4',
		card_id: CARD,
		type: 'assigned',
		actor_id: '5eed0000-0000-4000-8000-000000000011',
		payload: { from_owner_id: null, to_owner_id: '5eed0000-0000-4000-8000-000000000012' },
		created_at: '2026-08-05T12:00:00+00:00',
	},
]

const COMMENTAIRES_SERVIS = [
	{
		id: 'd1',
		card_id: CARD,
		author_id: '5eed0000-0000-4000-8000-000000000011',
		body: 'La DSI a confirmé le périmètre de la refonte : trois gabarits, pas cinq.',
		created_at: '2026-08-05T10:00:00+00:00',
		edited_at: null,
		deleted_at: null,
	},
]

const servir = (corps: unknown) => (route: Route) =>
	route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corps) })

/**
 * Sert le chargement complet de l'écran.
 *
 * `card_events`, `card_comments` et `card_field_values` sont déclarées **avant** `cards` : le
 * motif de `ROUTE_CARDS` capturerait aussi les trois — il se termine par une étoile —, et la
 * première route déclarée l'emporte dans Playwright. Le piège avait été rencontré par `CRM-037`
 * puis par `CRM-043` ; il est reconduit ici, à un nom près.
 */
async function servirEcran(
	page: Page,
	{
		evenements = EVENEMENTS_SERVIS as unknown,
		commentaires = COMMENTAIRES_SERVIS as unknown,
	} = {},
): Promise<void> {
	await page.route(ROUTE_EVENEMENTS, servir(evenements))
	await page.route(ROUTE_COMMENTAIRES, servir(commentaires))
	await page.route(ROUTE_VALEURS, servir(VALEURS_SERVIES))
	await page.route(ROUTE_CHAMPS, servir(CHAMPS_SERVIS))
	await page.route(ROUTE_REGLES, servir(REGLES_SERVIES))
	await page.route(ROUTE_ETAPES, servir(ETAPES_SERVIES))
	await page.route(ROUTE_CARDS, servir(CARD_SERVIE))
	await page.route(ROUTE_CHANNELS, servir(CHANNELS_SERVIS))
	await page.route(ROUTE_TRACKS, servir(TRACK_SERVI))
}

const fil = (page: Page) => page.getByRole('region', { name: 'Fil de cette affaire' })
const filtres = (page: Page) => page.getByRole('group', { name: 'Filtres du fil' })

test.describe('sans aucune substitution : l’appelant anonyme (INC-021)', () => {
	test('n’obtient aucune affaire, et aucune requête d’événements ne part', async ({ page }) => {
		const requetes: string[] = []
		page.on('request', (requete) => {
			if (requete.url().includes('/rest/v1/card_events')) requetes.push(requete.url())
		})

		await page.goto(ADRESSE)
		await expect(page.getByTestId('etat-vide')).toBeVisible()

		// La card n'existe pas pour un anonyme : le panneau n'est jamais monté, donc rien n'est
		// demandé. Une requête émise ici signalerait un écran qui devine ce qu'il n'a pas lu.
		expect(requetes, 'une requête d’événements est partie sans card').toHaveLength(0)
	})
})

test.describe('le fil unifié (réponses substituées, docs/DESIGN_SYSTEM.md §12.5)', () => {
	test('range les faits et la parole dans un seul fil, du plus ancien au plus récent', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirEcran(page)
		await page.goto(ADRESSE)

		const lignes = fil(page).getByRole('listitem')
		await expect(lignes).toHaveCount(5)
		await expect(lignes.nth(0)).toContainText('Affaire créée')
		await expect(lignes.nth(1)).toContainText('Champ renseigné')
		// La parole est AU MILIEU des faits : c'est une fusion, non deux listes accolées.
		await expect(lignes.nth(2)).toContainText('La DSI a confirmé')
		await expect(lignes.nth(3)).toContainText('Étape franchie')
		await expect(lignes.nth(4)).toContainText('Responsable modifié')

		await capturer(page, 'fil-unifie-1440', 'CRM-044')
	})

	test('résout les libellés à la lecture, et ne les prend jamais dans le payload', async ({
		page,
	}) => {
		await servirEcran(page)
		await page.goto(ADRESSE)

		await expect(fil(page)).toContainText('Prospection → Relance')
		await expect(fil(page)).toContainText('Source du lead')
	})

	test('n’affiche aucun identifiant d’acteur (INC-014)', async ({ page }) => {
		await servirEcran(page)
		await page.goto(ADRESSE)

		await expect(fil(page).getByRole('listitem').first()).toBeVisible()
		await expect(fil(page)).not.toContainText('5eed0000-0000-4000-8000-000000000011')
	})
})

test.describe('les filtres (docs/DESIGN_SYSTEM.md §5.11)', () => {
	test('quatre bascules, toutes actives, dont le compte suit la SOURCE', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirEcran(page)
		await page.goto(ADRESSE)

		const bascules = filtres(page).getByRole('button')
		await expect(bascules).toHaveCount(4)
		for (let rang = 0; rang < 4; rang += 1) {
			await expect(bascules.nth(rang)).toHaveAttribute('aria-pressed', 'true')
		}
		await expect(filtres(page).getByRole('button', { name: /Discussion/ })).toContainText('1')
		await expect(filtres(page).getByRole('button', { name: /Cycle de vie/ })).toContainText('2')
	})

	// CE SCÉNARIO NE COMPTE PAS LES REQUÊTES, ET LE MOTIF A ÉTÉ MESURÉ (décision 211). Il le
	// faisait, et il a échoué : une requête d'événements part bien après le clic, mais elle n'est
	// PAS causée par lui — le fil des commentaires se relit lorsque l'abonnement temps réel se
	// termine en erreur, et la lecture des événements est chaînée à la sienne (§14.13, point 5).
	// Compter des requêtes ici mesurerait donc une course, non le filtre. La preuve que filtrer ne
	// relit rien est DÉTERMINISTE et vit dans `webapp/src/app/PanneauTimeline.test.tsx`, où le
	// nombre de lectures émises est observé sur le composant réel. Ce qui est mesuré ici est ce que
	// l'utilisateur voit : le fil se réduit **sans repasser par un état de chargement**.
	test('éteindre une famille la masque, et le compte ne bouge pas', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirEcran(page)
		await page.goto(ADRESSE)
		await expect(fil(page).getByRole('listitem')).toHaveCount(5)

		await filtres(page).getByRole('button', { name: /Discussion/ }).click()

		// Aucun état de chargement entre les deux : la liste est réduite dans le même rendu. Si le
		// filtre relançait une requête, le fil disparaîtrait le temps de la réponse.
		await expect(fil(page).getByRole('listitem')).toHaveCount(4)
		await expect(fil(page)).not.toContainText('La DSI a confirmé')
		await expect(filtres(page).getByRole('button', { name: /Discussion/ })).toContainText('1')
		await expect(
			filtres(page).getByRole('button', { name: /Discussion/ }),
		).toHaveAttribute('aria-pressed', 'false')

		await capturer(page, 'fil-filtre-1440', 'CRM-044')
	})

	test('les bascules sont atteignables et actionnables au clavier (§8)', async ({ page }) => {
		await servirEcran(page)
		await page.goto(ADRESSE)
		await expect(fil(page).getByRole('listitem')).toHaveCount(5)

		const bascule = filtres(page).getByRole('button', { name: /Étapes/ })
		await bascule.focus()
		await page.keyboard.press('Enter')
		await expect(bascule).toHaveAttribute('aria-pressed', 'false')
		await expect(fil(page)).not.toContainText('Étape franchie')
	})

	test('éteindre TOUTES les familles dit qu’on filtre, pas que l’affaire est vide', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirEcran(page)
		await page.goto(ADRESSE)
		await expect(fil(page).getByRole('listitem')).toHaveCount(5)

		for (const nom of [/Discussion/, /Étapes/, /Champs/, /Cycle de vie/]) {
			await filtres(page).getByRole('button', { name: nom }).click()
		}

		await expect(fil(page).getByTestId('etat-vide')).toContainText('Aucun élément pour ces filtres')
		await capturer(page, 'fil-tout-filtre-1440', 'CRM-044')
	})

	test('un fil réellement vide le dit autrement', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await servirEcran(page, { evenements: [], commentaires: [] })
		await page.goto(ADRESSE)

		await expect(fil(page).getByTestId('etat-vide')).toContainText('Aucun événement')
		await capturer(page, 'fil-vide-1440', 'CRM-044')
	})

	// `CLAUDE.md` §11 : l'état d'un filtre n'est pas nécessaire au fonctionnement. Il repart
	// complet à chaque ouverture, ce qui est aussi la seule valeur qui ne cache jamais rien.
	test('aucune préférence n’est écrite sur l’appareil', async ({ page }) => {
		await servirEcran(page)
		await page.goto(ADRESSE)
		await expect(fil(page).getByRole('listitem')).toHaveCount(5)

		await filtres(page).getByRole('button', { name: /Étapes/ }).click()

		const stockage = await page.evaluate(() => ({
			local: window.localStorage.length,
			session: window.sessionStorage.length,
		}))
		expect(stockage).toEqual({ local: 0, session: 0 })

		await page.reload()
		await expect(filtres(page).getByRole('button', { name: /Étapes/ })).toHaveAttribute(
			'aria-pressed',
			'true',
		)
	})
})

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le fil tient dans la page, sans débordement horizontal`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await servirEcran(page)
			await page.goto(ADRESSE)
			await expect(fil(page).getByRole('listitem').first()).toBeVisible()

			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBeLessThanOrEqual(0)

			await capturer(page, `fil-${palier.nom}`, 'CRM-044')
		})
	}
})
