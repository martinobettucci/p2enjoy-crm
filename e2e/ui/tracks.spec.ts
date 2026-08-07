// @verifies CRM-020 (docs/BACKLOG.md) — barre latérale des tracks, dans l'application réelle
// @verifies docs/SPEC-tracks.md §7 (ce que la barre latérale lit, et ce qu'elle affiche)
// @verifies docs/DESIGN_SYSTEM.md §4 (barre latérale), §5.8 (états), §7 (paliers)
// @verifies docs/SPEC-webapp.md §7 (états), §8 (responsive) ; CLAUDE.md §16 (vérification visuelle)
//
// Ces scénarios s'exécutent contre le **build de production** servi par `vite preview`, et contre
// la vraie API. Rien n'est simulé, sauf là où c'est explicitement dit — et alors c'est le
// **réseau** qui est manipulé, jamais un état interne de l'application.
//
// CE QUE CES SCÉNARIOS PROUVENT, ET CE QU'ILS NE PROUVENT PAS.
//
// Ils prouvent que la barre latérale interroge réellement `public.tracks`, et qu'elle affiche
// l'état que le backend lui rend. Le cas sans substitution de ce fichier exerce explicitement
// l'anonyme et son vide réel ; `e2e/ui/authentification.spec.ts` constate que les trois tracks du
// seed apparaissent après une connexion réelle.
//
// Le rendu chargé — pilules, couleurs, icônes, repli — est éprouvé par
// `webapp/src/app/SectionTracks.test.tsx`, qui monte le composant réel. C'est la seule preuve
// déterministe des variantes visuelles ; il complète le parcours connecté sans le remplacer.

import { expect, test } from '@playwright/test'
import { PALIERS, capturer } from './captures'

const ROUTE_TRACKS = '**/rest/v1/tracks*'

/** Trois tracks servis par le réseau, à la forme exacte de ce que PostgREST rend. */
const TRACKS_SERVIS = [
	{ id: 't-1', name: 'Conseil & IA', slug: 'conseil-ia', color: 'brand', icon: 'sparkles', position: 1 },
	{
		id: 't-2',
		name: 'Studio web',
		slug: 'studio-web',
		color: 'success',
		icon: 'layout-dashboard',
		position: 2,
	},
	{
		id: 't-3',
		name: 'Formation',
		slug: 'formation',
		color: 'accent',
		icon: 'graduation-cap',
		position: 3,
	},
	// `danger` et `neutral` ne sont dans aucun track du seed. Ils sont servis ici parce qu'un
	// jeton que rien ne rend n'est jamais mesuré : le contraste de `danger` était sous la barre
	// du §8 sans qu'aucune preuve ne le voie.
	{ id: 't-4', name: 'Litiges', slug: 'litiges', color: 'danger', icon: 'archive', position: 4 },
	{ id: 't-5', name: 'Divers', slug: 'divers', color: 'neutral', icon: 'folder', position: 5 },
]

/** Les cinq jetons, dans l'ordre où `TRACKS_SERVIS` les rend. */
const JETONS_SERVIS = ['brand', 'success', 'accent', 'danger', 'neutral'] as const

test.describe('la barre latérale interroge réellement `tracks`', () => {
	test('une requête part vers `/rest/v1/tracks`, filtrée et ordonnée', async ({ page }) => {
		// La preuve porte sur la requête **émise par l'application construite**, pas sur celle
		// qu'un test unitaire construit : c'est ce qui distingue « le code appelle » de
		// « l'application appelle ».
		await page.setViewportSize({ width: 1440, height: 900 })
		const requetes: string[] = []
		page.on('request', (requete) => {
			if (requete.url().includes('/rest/v1/tracks')) requetes.push(requete.url())
		})

		await page.goto('/')
		await expect(page.getByTestId('tracks-vides')).toBeVisible()

		expect(requetes.length).toBeGreaterThan(0)
		const url = new URL(requetes[0] as string)
		// docs/SPEC-tracks.md §4 : les tracks archivés sont masqués **côté serveur**.
		expect(url.searchParams.get('archived_at')).toBe('is.null')
		// docs/SPEC-tracks.md §3 : l'ordre est celui de `position`, puis du nom.
		expect(url.searchParams.get('order')).toBe('position.asc,name.asc')
		expect(url.searchParams.get('select')).toContain('color')
		expect(url.searchParams.get('select')).toContain('icon')
	})

	test('l’appelant anonyme n’obtient aucun track, et l’interface le dit', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.goto('/')

		// C'est le refus réel du backend, pas un état d'attente : `200` et `[]`.
		await expect(page.getByTestId('tracks-vides')).toBeVisible()
		await expect(page.getByTestId('tracks-vides')).toHaveText('Aucun track')
		await expect(page.getByTestId('entree-track')).toHaveCount(0)
		// Un refus par zéro ligne n'est **pas** une erreur : l'écran ne doit pas en afficher une.
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
		await expect(page.getByTestId('etat-refus')).toHaveCount(0)

		await capturer(page, 'tracks-vides-1440', 'CRM-020')
	})
})

test.describe('états provoqués sur le réseau (docs/DESIGN_SYSTEM.md §5.8)', () => {
	// Les lignes servies ici viennent du **réseau**, comme celles du serveur : ce qui est éprouvé
	// est le chemin complet — requête, désérialisation, rendu — et non un composant isolé. C'est
	// un moyen déterministe d'exercer chaque forme : il est nommé pour ce qu'il est, une réponse
	// substituée. La session réelle et les trois pilules du seed sont prouvées ailleurs.
	test('des tracks servis par le réseau apparaissent en pilules, avec leur icône', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.route(ROUTE_TRACKS, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(TRACKS_SERVIS),
			}),
		)
		await page.goto('/')

		const entrees = page.getByTestId('entree-track')
		await expect(entrees).toHaveCount(TRACKS_SERVIS.length)
		await expect(entrees.nth(0)).toContainText('Conseil & IA')
		await expect(entrees.nth(2)).toContainText('Formation')
		// L'ordre affiché est celui reçu : l'interface ne retrie pas ce que `position` a décidé.
		await expect(entrees.nth(0)).toHaveAttribute('data-slug', 'conseil-ia')
		await expect(entrees.nth(1)).toHaveAttribute('data-slug', 'studio-web')

		// docs/DESIGN_SYSTEM.md §5.6 : la couleur ne porte jamais seule l'information — chaque
		// pilule est précédée d'une icône.
		for (let rang = 0; rang < TRACKS_SERVIS.length; rang += 1) {
			await expect(entrees.nth(rang).locator('svg')).toHaveCount(1)
		}

		// Les fonds sont réellement distincts : les jetons ne sont pas retombés sur un défaut
		// commun, ce qu'une classe absente du CSS produit provoquerait en silence
		// (docs/DESIGN_SYSTEM.md §11).
		const fonds = await entrees.evaluateAll((elements) =>
			elements.map((element) => globalThis.getComputedStyle(element).backgroundColor),
		)
		expect(new Set(fonds).size).toBe(TRACKS_SERVIS.length)

		await capturer(page, 'tracks-charges-1440', 'CRM-020')
	})

	// LA PREUVE QUI MANQUAIT, ET QUI A TROUVÉ UN DÉFAUT RÉEL.
	//
	// `docs/DESIGN_SYSTEM.md` §8 exige un contraste AA de 4,5:1 « y compris pour les badges
	// colorés ». Rien ne le vérifiait : la conformité était **déclarée**, jamais mesurée. Or, avec
	// « texte à la couleur pleine » (§5.6), trois jetons sur cinq échouaient — `accent` à 1,45:1,
	// visible à l'œil et corrigé à ce titre, mais aussi `success` à 3,82:1 et `danger` à 3,29:1,
	// qui passaient inaperçus parce qu'ils restent lisibles sans être conformes.
	//
	// La mesure porte sur le rendu réel, et la conversion en octets sRGB est confiée au navigateur
	// — la couleur est **peinte** sur un canevas d'un pixel, puis relue. Analyser la chaîne rendue
	// par `getComputedStyle` serait faux : mesuré, Chromium rend les `color-mix` avec des canaux
	// de 0 à 1 (`color(srgb 0.91 …)`) et les couleurs littérales en octets (`rgb(35, 70, 140)`).
	test('chaque pilule tient le contraste AA de 4,5:1 (docs/DESIGN_SYSTEM.md §8)', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.route(ROUTE_TRACKS, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(TRACKS_SERVIS),
			}),
		)
		await page.goto('/')
		await expect(page.getByTestId('entree-track')).toHaveCount(TRACKS_SERVIS.length)

		const mesures = await page.getByTestId('entree-track').evaluateAll((elements) => {
			const canevas = document.createElement('canvas')
			canevas.width = 1
			canevas.height = 1
			const contexte = canevas.getContext('2d', { willReadFrequently: true })
			if (contexte === null) throw new Error('canevas 2d indisponible')

			const octets = (valeurCss: string): [number, number, number] => {
				contexte.clearRect(0, 0, 1, 1)
				contexte.fillStyle = valeurCss
				contexte.fillRect(0, 0, 1, 1)
				const donnees = contexte.getImageData(0, 0, 1, 1).data
				return [donnees[0] ?? 0, donnees[1] ?? 0, donnees[2] ?? 0]
			}
			const canal = (composante: number) => {
				const v = composante / 255
				return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
			}
			const luminance = ([r, g, b]: [number, number, number]) =>
				0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)

			return elements.map((element) => {
				const style = globalThis.getComputedStyle(element)
				const lTexte = luminance(octets(style.color))
				const lFond = luminance(octets(style.backgroundColor))
				const haut = Math.max(lTexte, lFond)
				const bas = Math.min(lTexte, lFond)
				return { slug: element.getAttribute('data-slug'), ratio: (haut + 0.05) / (bas + 0.05) }
			})
		})

		expect(mesures).toHaveLength(TRACKS_SERVIS.length)
		mesures.forEach((mesure, rang) => {
			expect(
				mesure.ratio,
				`jeton « ${JETONS_SERVIS[rang]} » (track ${mesure.slug}) : ` +
					`${mesure.ratio.toFixed(2)}:1, en dessous des 4,5:1 exigés par docs/DESIGN_SYSTEM.md §8`,
			).toBeGreaterThanOrEqual(4.5)
		})
	})

	test('le chargement des tracks montre des squelettes, jamais un spinner', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		// Retard réel de la réponse : l'état de chargement dure assez pour être observé.
		await page.route(ROUTE_TRACKS, async (route) => {
			await new Promise((resoudre) => setTimeout(resoudre, 2500))
			await route.continue()
		})
		await page.goto('/')

		await expect(page.getByTestId('squelette').first()).toBeVisible()
		await capturer(page, 'tracks-chargement-1440', 'CRM-020')
		await expect(page.getByTestId('tracks-vides')).toBeVisible({ timeout: 10_000 })
	})

	// Un échec du chargement des tracks ne doit pas être avalé par la barre latérale : elle n'a
	// pas la place de l'expliquer, donc la zone principale s'en charge (CLAUDE.md §18).
	test('un refus sur les tracks remonte dans la zone principale', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.route(ROUTE_TRACKS, (route) =>
			route.fulfill({
				status: 403,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'permission denied for table tracks' }),
			}),
		)
		await page.goto('/')

		await expect(page.getByTestId('etat-refus')).toBeVisible()
		await expect(page.getByTestId('etat-erreur')).toHaveCount(0)
		await capturer(page, 'tracks-refus-1440', 'CRM-020')
	})
})

test.describe('paliers responsive (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : les tracks tiennent dans la barre sans déborder la page`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.route(ROUTE_TRACKS, (route) =>
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(TRACKS_SERVIS),
				}),
			)
			await page.goto('/')

			// Sous le palier « colonne », la barre est un tiroir : il faut l'ouvrir pour la voir.
			if (palier.largeur < 1024) {
				await page.getByTestId('ouvrir-tiroir').click()
				await expect(page.getByTestId('barre-laterale')).toBeInViewport({ ratio: 0.99 })
			}

			await expect(page.getByTestId('entree-track')).toHaveCount(TRACKS_SERVIS.length)

			// docs/DESIGN_SYSTEM.md §7 : la page ne défile jamais horizontalement.
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement).toBeLessThanOrEqual(0)

			// Aucune pilule ne dépasse de la barre : au palier « colonne d'icônes », le libellé
			// est masqué visuellement, mais l'icône doit rester entièrement visible.
			const barre = await page.getByTestId('barre-laterale').boundingBox()
			const premiere = await page.getByTestId('entree-track').first().boundingBox()
			expect(premiere).not.toBeNull()
			expect((premiere?.x ?? 0) + (premiere?.width ?? 0)).toBeLessThanOrEqual(
				(barre?.x ?? 0) + (barre?.width ?? 0) + 1,
			)

			await capturer(page, `tracks-palier-${palier.nom}`, 'CRM-020')
		})
	}
})
