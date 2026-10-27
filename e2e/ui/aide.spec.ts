// @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : l'aide de la webapp, sur la pile réelle et le manuel publié
// @verifies CRM-117 tranche T3.0 — l'écran de l'inbox mène à son chapitre du plan public (docs/SPEC-manual.md §10 bis)
// @verifies docs/SPEC-manual.md §13 (les adresses, le panneau, le rendu, les états), §14 (lu avec la session), §16
//           (preuve E2E) ; docs/DESIGN_SYSTEM.md §5.69 (l'icône et son panneau, le sommaire, un chapitre), §5.43 (cadre
//           du panneau mesuré), §7 (aucun défilement horizontal), §8 (clavier) ; docs/JOURNAL.md décision 740 ;
//           CLAUDE.md §16 (vérification visuelle)
//
// Aucune réponse n'est substituée : le manuel est lu dans le bucket que le seed a publié, avec la session réelle. Les
// titres attendus sont lus dans le manuel construit du dépôt — le même que celui qui est publié (e2e/api/manuel.spec.ts
// M1 le prouve à l'octet).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-117'
const SOMMAIRE = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'manuel', 'construit', 'contents.json'), 'utf8')) as {
	chapters: Array<{ slug: string; title: string; sections: Array<{ anchor: string; title: string }> }>
}
const AFFAIRE = 'l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre'
const KANBAN = 'le-tableau-kanban-d-un-channel'
const chapitre = (slug: string) => {
	const trouve = SOMMAIRE.chapters.find((c) => c.slug === slug)
	if (trouve === undefined) throw new Error(`chapitre absent du manuel construit : ${slug}`)
	return trouve
}
const TITRE_KANBAN = chapitre(AFFAIRE).sections.find((s) => s.anchor === KANBAN)?.title ?? ''

const icone = (page: Page) => page.getByRole('button', { name: 'Aide', exact: true })
const panneau = (page: Page) => page.getByTestId('panneau-aide')

test.describe('l’aide, pour une session', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
	})

	test('depuis un board, le panneau mène à la section qui le décrit', async ({ page }) => {
		await page.goto('/tracks/conseil-ia/prospection')
		await icone(page).click()
		await expect(panneau(page)).toBeVisible()
		const ecran = panneau(page).getByRole('link', { name: TITRE_KANBAN })
		await expect(ecran).toBeFocused()
		await expect(panneau(page).getByRole('link', { name: 'Sommaire du manuel' })).toBeVisible()
		await capturer(page, 'panneau-aide-xl-1440', UNITE)

		await ecran.click()
		await expect(page).toHaveURL(new RegExp(`/aide/${AFFAIRE}#${KANBAN}$`))
		await expect(page.getByTestId('chapitre-aide')).toHaveAttribute('data-slug', AFFAIRE)
		await expect(page.getByRole('heading', { level: 1, name: chapitre(AFFAIRE).title })).toBeVisible()
		await expect(page.locator(`#${KANBAN}`)).toBeInViewport()
		// Le fil d'Ariane remonte au sommaire, et « Aide » touche le titre : un nom plus court que le plancher de `10ch`
		// garde sa largeur propre (§5.62). Mesuré : avec le plancher, 50 px séparaient « Aide / » du titre.
		const fil = page.getByRole('navigation', { name: "Fil d'Ariane" })
		await expect(fil.getByRole('link', { name: 'Aide' })).toHaveAttribute('href', '/aide')
		// Du bord droit du lien au titre : deux espacements de 8 px et le séparateur, moins de 32 px.
		const ancetre = await fil.getByRole('link', { name: 'Aide' }).boundingBox()
		const titre = await fil.getByRole('heading', { level: 1 }).boundingBox()
		expect((titre?.x ?? 0) - ((ancetre?.x ?? 0) + (ancetre?.width ?? 0)), 'écart entre « Aide » et le titre').toBeLessThan(32)
		await capturer(page, 'chapitre-section-xl-1440', UNITE)
	})

	test('au clavier : l’icône s’ouvre, le focus entre, Échap le rend à l’icône', async ({ page }) => {
		await page.goto('/inbox')
		await icone(page).focus()
		await page.keyboard.press('Enter')
		// L'inbox a son chapitre depuis le plan public (docs/SPEC-manual.md §10 bis) : le titre est lu dans ce chapitre.
		const inbox = chapitre('l-inbox-lire-trier-et-repondre').sections.find((s) => s.anchor === 'l-inbox-lire-et-trier-le-courrier-recu')
		expect(inbox, 'la section de l’inbox existe dans le manuel construit').toBeDefined()
		await expect(panneau(page).getByRole('link', { name: inbox?.title ?? '' })).toBeFocused()
		await page.keyboard.press('Tab')
		await expect(panneau(page).getByRole('link', { name: 'Sommaire du manuel' })).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(panneau(page)).toHaveCount(0)
		await expect(icone(page)).toBeFocused()
	})

	test('un écran sans chapitre n’offre que le sommaire', async ({ page }) => {
		await page.goto('/reglages')
		await icone(page).click()
		await expect(panneau(page).getByTestId('aide-ecran')).toHaveCount(0)
		await expect(panneau(page).getByRole('link', { name: 'Sommaire du manuel' })).toBeFocused()
	})

	test('un seul panneau de l’en-tête à la fois', async ({ page }) => {
		await page.goto('/inbox')
		await page.getByTestId('cloche-notifications').click()
		await expect(page.getByTestId('panneau-notifications')).toBeVisible()
		await icone(page).click()
		await expect(panneau(page)).toBeVisible()
		await expect(page.getByTestId('panneau-notifications')).toHaveCount(0)
		// Et au clavier, où aucun clic extérieur ne referme l'autre.
		await page.getByTestId('cloche-notifications').focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('panneau-notifications')).toBeVisible()
		await expect(panneau(page)).toHaveCount(0)
	})

	test('le sommaire liste chaque chapitre, et chaque lien mène à un chapitre qui se lit', async ({ page }) => {
		await page.goto('/aide')
		await expect(page.getByRole('heading', { level: 1, name: 'Aide' })).toBeVisible()
		await expect(page.getByTestId('chapitre-sommaire')).toHaveCount(SOMMAIRE.chapters.length)
		await capturer(page, 'sommaire-xl-1440', UNITE)
		for (const { slug, title } of SOMMAIRE.chapters) {
			await page.goto(`/aide/${slug}`)
			await expect(page.getByRole('heading', { level: 1, name: title }), slug).toBeVisible()
			await expect(page.getByText('Chapitre introuvable')).toHaveCount(0)
		}
	})

	test('chapitre précédent et suivant enchaînent le manuel', async ({ page }) => {
		const [premier, second] = SOMMAIRE.chapters
		await page.goto(`/aide/${premier?.slug}`)
		await expect(page.getByRole('link', { name: /^Chapitre précédent/ })).toHaveCount(0)
		await page.getByRole('link', { name: `Chapitre suivant : ${second?.title}` }).click()
		await expect(page).toHaveURL(new RegExp(`/aide/${second?.slug}$`))
		await expect(page.getByRole('link', { name: `Chapitre précédent : ${premier?.title}` })).toBeVisible()
	})

	test('un chapitre inconnu est introuvable, et mène au sommaire', async ({ page }) => {
		await page.goto('/aide/nulle-part')
		// Le titre le dit — jamais « Aide », qui est déjà l'ancêtre.
		await expect(page.getByRole('heading', { level: 1, name: 'Chapitre introuvable' })).toBeVisible()
		// Le stockage rend `400` pour un objet absent : la page le présente comme introuvable, jamais comme une panne.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await capturer(page, 'chapitre-introuvable-xl-1440', UNITE)
		await page.getByRole('link', { name: 'Sommaire du manuel' }).click()
		await expect(page).toHaveURL(/\/aide$/)
	})
})

test('la lectrice lit l’aide comme tout membre', async ({ page }) => {
	await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
	await page.goto(`/aide/${AFFAIRE}`)
	await expect(page.getByRole('heading', { level: 1, name: chapitre(AFFAIRE).title })).toBeVisible()
})

test('sans session, /aide mène à l’écran de connexion', async ({ page }) => {
	await page.goto(`/aide/${AFFAIRE}`)
	await expect(page.getByRole('button', { name: 'Se connecter avec LeLabs' })).toBeVisible()
	await expect(page.getByTestId('chapitre-aide')).toHaveCount(0)
})

// Un palier par scénario, la taille posée AVANT le premier rendu.
test.describe('paliers (§7, §5.43)', () => {
	for (const palier of PALIERS) {
		test(`palier ${palier.nom} : le panneau tient dans la fenêtre, un chapitre ne fait pas défiler la page`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
			await page.goto('/tracks/conseil-ia/prospection')
			await icone(page).click()
			const cadre = await panneau(page).boundingBox()
			expect(cadre, 'cadre du panneau').not.toBeNull()
			expect(cadre?.x ?? -1, 'bord gauche du panneau').toBeGreaterThanOrEqual(0)
			expect((cadre?.x ?? 0) + (cadre?.width ?? 0), 'bord droit du panneau').toBeLessThanOrEqual(palier.largeur)
			await capturer(page, `panneau-aide-${palier.nom}`, UNITE)

			await page.goto(`/aide/${AFFAIRE}`)
			await expect(page.getByTestId('chapitre-aide')).toBeVisible()
			const { defilement, largeur } = await page.evaluate(() => ({
				defilement: document.documentElement.scrollWidth,
				largeur: document.documentElement.clientWidth,
			}))
			expect(defilement, 'largeur défilable du document').toBeLessThanOrEqual(largeur)
			await capturer(page, `chapitre-${palier.nom}`, UNITE)
		})
	}
})
