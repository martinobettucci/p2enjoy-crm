// @verifies CRM-152 (docs/BACKLOG.md) — tranche T2 : rechercher, filtrer, trier et « Afficher plus » dans Contacts ▸
//           Organisations, la colonne « Tracks » et la ligne « Tracks » de la fiche, de bout en bout sur la pile réelle et le
//           seed, à la souris et au clavier
// @verifies docs/SPEC-organisations.md §8.1 (les tracks par les contacts, sous la RLS : la lectrice en voit moins), §8.2
//           (recherche, l'un des tracks, avec ou sans recettes, tri total), §8.3 (l'écran, l'adresse rechargée, « 50 sur
//           55 », la fiche) ; docs/DESIGN_SYSTEM.md §5.105, §5.9 (`aria-sort`), §7 (aucun défilement horizontal aux quatre
//           paliers) ; docs/JOURNAL.md décisions 931 et 936 ; CLAUDE.md §10 (la lectrice, par l'écran ; la requête directe
//           est `e2e/api/liste-organisations.spec.ts`), §16 (captures)
// @verifies CRM-153 (docs/BACKLOG.md) — tranche T4 : le bouton « Catégories » se place entre « Tracks » et « Recettes »
//           dans l'ordre de tabulation (docs/DESIGN_SYSTEM.md §5.107) ; révisé le 2026-11-19
//
// @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.c : RÉVISÉ le 2026-11-24 — Camille lit aussi « Studio Lumen » (deux
//           organisations, dont un homonyme de Vertigo Conseil, docs/SPEC-seed.md §54) : ses parcours ouvrent l'onglet
//           sur l'espace du seed, `?espaces=p2enjoy`, comme une personne de deux espaces isole le sien ; l'adresse écrite
//           garde ce paramètre en tête (docs/SPEC-espace-courant.md §16.8.3 ; docs/DESIGN_SYSTEM.md §5.115). Le contrat
//           prouvé ici, dans un espace, ne change pas ; la lectrice n'en lit qu'un et reste sans paramètre.
//
// LE SEED EST LU : Vertigo Conseil (Conseil & IA, Formation ; des recettes), Atelier Lumen et Sogexia (Conseil & IA), trois
// organisations à deux contacts, Comptoir Vasseur sans contact. « Afficher plus » demande plus de cinquante organisations :
// ce fichier en pose 55, préfixées, par la clé de service, et les retire avant et après.

import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'
import { CLE_SERVICE, URL_API } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-152'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const FORMATION = '5eed0000-0000-4000-8000-000000000023'
const PREFIXE = 'E2E Afficher plus'
/** `CRM-161` T3.c : l'onglet sur l'espace du seed, pour Camille qui en lit deux. */
const ORGANISATIONS = '/contacts/organisations?espaces=p2enjoy'
const SERVICE = { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}`, 'Content-Type': 'application/json' }

async function nettoyer(): Promise<void> {
	const r = await fetch(`${URL_API}/rest/v1/organizations?workspace_id=eq.${ESPACE}&name=like.${encodeURIComponent(PREFIXE)}*`, {
		method: 'DELETE',
		headers: SERVICE,
	})
	if (!r.ok) throw new Error(`nettoyage des organisations : ${r.status}`)
}

test.beforeAll(nettoyer)
// Après CHAQUE test : les 55 organisations de « Afficher plus » repousseraient sinon le seed au-delà de la première page.
test.afterEach(nettoyer)

const lignes = (page: Page) => page.getByTestId('ligne-organisation')
const noms = (page: Page) => lignes(page).getByTestId('lien-fiche-organisation')
const recherche = (page: Page) => page.getByRole('searchbox', { name: 'Rechercher' })
const boutonTracks = (page: Page) => page.getByTestId('ouvrir-filtre-tracks')
const recettes = (page: Page) => page.getByRole('combobox', { name: 'Recettes' })

async function sansDefilementHorizontal(page: Page): Promise<void> {
	const deborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(deborde, 'aucun défilement horizontal de la page').toBeLessThanOrEqual(0)
}

test.describe('Contacts ▸ Organisations : rechercher, filtrer, trier (docs/DESIGN_SYSTEM.md §5.105)', () => {
	test('à la souris : la colonne « Tracks », la recherche, un track, les recettes, effacer ; l’adresse rechargée', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(ORGANISATIONS)
		await expect(noms(page)).toHaveCount(7)
		await expect(page.getByTestId('compte-organisations')).toHaveText('7 sur 7')
		await expect(page.getByTestId('afficher-plus-organisations')).toHaveCount(0)
		const vertigo = lignes(page).filter({ hasText: 'Vertigo Conseil' })
		await expect(vertigo.getByTestId('cellule-tracks')).toHaveText('Conseil & IA · Formation')
		await expect(lignes(page).filter({ hasText: 'Comptoir Vasseur' }).getByTestId('cellule-tracks')).toHaveText('')
		await capturer(page, 'organisations-tracks-1440', UNITE)

		await recherche(page).fill('vert')
		await expect(noms(page)).toHaveText(['Vertigo Conseil'])
		await expect(page).toHaveURL(/\?espaces=p2enjoy&q=vert$/u)
		await page.getByTestId('effacer-filtres-organisations').click()
		await expect(noms(page)).toHaveCount(7)
		await expect(recherche(page)).toHaveValue('')

		await boutonTracks(page).click()
		await expect(boutonTracks(page)).toHaveAttribute('aria-expanded', 'true')
		await page.getByRole('checkbox', { name: 'Formation' }).check()
		await expect(boutonTracks(page)).toHaveText('Tracks (1)')
		await expect(noms(page)).toHaveText(['Vertigo Conseil'])
		await page.getByRole('checkbox', { name: 'Conseil & IA' }).check()
		await expect(noms(page)).toHaveText(['Atelier Lumen', 'Sogexia', 'Vertigo Conseil'])
		await capturer(page, 'organisations-panneau-tracks-1440', UNITE)

		await recettes(page).selectOption({ label: 'Sans recettes' })
		await expect(noms(page)).toHaveText(['Sogexia'])
		const adresse = new URL(page.url())
		expect(adresse.searchParams.get('recettes')).toBe('sans')
		expect(adresse.searchParams.get('tracks')?.split(',').sort()).toEqual(['5eed0000-0000-4000-8000-000000000021', FORMATION])

		// L'adresse rechargée rend la même liste et les mêmes contrôles.
		const avant = await noms(page).allTextContents()
		await page.reload()
		await expect(noms(page)).toHaveText(avant)
		await expect(boutonTracks(page)).toHaveText('Tracks (2)')
		await expect(recettes(page)).toHaveValue('sans')

		await page.getByTestId('effacer-filtres-organisations').click()
		await expect(page).toHaveURL(/\/contacts\/organisations\?espaces=p2enjoy$/u)
		await expect(noms(page)).toHaveCount(7)
	})

	test('le tri par « Contacts » : ascendant, puis descendant ; à égalité, le nom départage', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(ORGANISATIONS)
		const entete = page.getByRole('columnheader', { name: /Contacts/u })
		await expect(page.getByRole('columnheader', { name: /Nom/u })).toHaveAttribute('aria-sort', 'ascending')
		await entete.getByRole('button').click()
		await expect(entete).toHaveAttribute('aria-sort', 'ascending')
		await expect(noms(page).first()).toHaveText('Comptoir Vasseur')
		await entete.getByRole('button').click()
		await expect(entete).toHaveAttribute('aria-sort', 'descending')
		await expect(noms(page)).toHaveText([
			'Atelier Lumen', 'Sogexia', 'Vertigo Conseil', 'Studio Meunier', 'Ville d’Annecy', 'Comptoir Vasseur', 'Imprimerie Duval',
		].map((n) => n.replace('’', "'")))
		await expect(page).toHaveURL(/\?espaces=p2enjoy&tri=contacts&sens=desc$/u)
		await expect(page.getByRole('columnheader', { name: 'Réel sur prévu' }).getByRole('button')).toHaveCount(0)
	})

	test('au clavier : chercher, déplier « Tracks », cocher à l’espace, `Échap` rend le focus, choisir les recettes', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(ORGANISATIONS)
		await expect(noms(page)).toHaveCount(7)
		await recherche(page).focus()
		await page.keyboard.type('o')
		await expect(page).toHaveURL(/\?espaces=p2enjoy&q=o$/u)
		await page.keyboard.press('Tab')
		await expect(boutonTracks(page)).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('panneau-filtre-tracks')).toBeVisible()
		// Le panneau est dans le flux, sous la barre : le `Tab` suivant y entre après les commandes de la barre.
		await page.getByRole('checkbox', { name: 'Formation' }).focus()
		await page.keyboard.press('Space')
		await expect(boutonTracks(page)).toHaveText('Tracks (1)')
		await expect(noms(page)).toHaveText(['Vertigo Conseil'])
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('panneau-filtre-tracks')).toHaveCount(0)
		await expect(boutonTracks(page)).toBeFocused()
		// Révisé le 2026-11-19 (CRM-153 T4) : le seed §50 dote l'espace de catégories ; le bouton
		// « Catégories » paraît donc, après « Tracks » et avant « Recettes » (docs/DESIGN_SYSTEM.md §5.107).
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('ouvrir-filtre-categories')).toBeFocused()
		// Révisé le 2026-11-24 (CRM-161 T3.c) : à deux espaces lus, le bouton « Espace » suit « Catégories » (§5.115).
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('ouvrir-filtre-espaces')).toBeFocused()
		await page.keyboard.press('Tab')
		await expect(recettes(page)).toBeFocused()
		await recettes(page).selectOption('avec')
		await expect(noms(page)).toHaveText(['Vertigo Conseil'])
		await page.keyboard.press('Tab')
		await expect(page.getByTestId('effacer-filtres-organisations')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(noms(page)).toHaveCount(7)
	})

	test('« Afficher plus » : « 50 sur 55 », cinq de plus, puis le focus sur la première ajoutée', async ({ page }) => {
		const r = await fetch(`${URL_API}/rest/v1/organizations`, {
			method: 'POST',
			headers: SERVICE,
			body: JSON.stringify(Array.from({ length: 55 }, (_, i) => ({
				workspace_id: ESPACE, name: `${PREFIXE} ${String(i + 1).padStart(2, '0')}`,
			}))),
		})
		expect(r.status).toBe(201)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`${ORGANISATIONS}&q=${encodeURIComponent(PREFIXE)}`)
		await expect(noms(page)).toHaveCount(50)
		await expect(page.getByTestId('compte-organisations')).toHaveText('50 sur 55')
		const plus = page.getByTestId('afficher-plus-organisations')
		await plus.focus()
		await capturer(page, 'organisations-afficher-plus-1440', UNITE)
		await page.keyboard.press('Enter')
		await expect(noms(page)).toHaveCount(55)
		await expect(page.getByTestId('compte-organisations')).toHaveText('55 sur 55')
		await expect(plus).toHaveCount(0)
		await expect(page.getByRole('status', { name: 'Annonces de la liste des organisations' })).toHaveText('5 organisations de plus')
		await expect(page.getByRole('link', { name: `${PREFIXE} 51` })).toBeFocused()
	})

	test('la fiche porte « Tracks » : des pilules vers leur vue ; aucun, « Aucun track »', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(ORGANISATIONS)
		await noms(page).filter({ hasText: 'Vertigo Conseil' }).click()
		const ligne = page.getByTestId('tracks-organisation')
		await expect(ligne.getByTestId('pilule-track-organisation')).toHaveText(['Conseil & IA', 'Formation'])
		await capturer(page, 'organisation-fiche-tracks-1440', UNITE)
		await ligne.getByRole('link', { name: 'Formation' }).click()
		await expect(page).toHaveURL(/\/tracks\/formation$/u)
		await page.goto('/contacts/organisations/5eed0000-0000-4000-8000-000000000083')
		await expect(page.getByTestId('tracks-organisation')).toContainText('Aucun track')
	})

	test('la lectrice ne voit que les tracks des affaires qu’elle lit : Vertigo Conseil n’a pour elle que « Formation »', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto('/contacts/organisations')
		await expect(lignes(page).filter({ hasText: 'Vertigo Conseil' }).getByTestId('cellule-tracks')).toHaveText('Formation')
	})

	// RÉVISÉ par la décision 940 : le tableau débordait de son cadre dès 1440 px. Mesuré sur la liste ENTIÈRE, dont les
	// domaines et les sites les plus longs : jusqu'à 900 px, le tableau tient dans son cadre ; à 390 px, sous sa largeur
	// minimale, c'est le cadre qui défile (docs/DESIGN_SYSTEM.md §7, §12.6) — la page, jamais.
	test.describe('les paliers, et 1280 px', () => {
		for (const palier of [...PALIERS, { nom: 'xl-1280', largeur: 1280, hauteur: 720 }]) {
			test(`palier ${palier.nom} : la barre, le panneau et le tableau tiennent sans défilement horizontal`, async ({ page }) => {
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				await connecterAvecLeLabs(page, ADMIN)
				await page.goto(ORGANISATIONS)
				await expect(noms(page)).toHaveCount(7)
				const { cadre, tableau } = await page.getByTestId('tableau-organisations').evaluate((t) => ({
					cadre: (t.parentElement as HTMLElement).clientWidth,
					tableau: t.scrollWidth,
				}))
				if (palier.largeur >= 900) expect(tableau, `le tableau tient dans son cadre à ${palier.largeur} px`).toBeLessThanOrEqual(cadre)
				else expect(tableau, 'à 390 px, le cadre défile').toBeGreaterThan(cadre)
				await sansDefilementHorizontal(page)
				await capturer(page, `organisations-liste-${palier.nom}`, UNITE)
				await page.goto(`${ORGANISATIONS}&tracks=${FORMATION}`)
				await expect(noms(page)).toHaveText(['Vertigo Conseil'])
				await boutonTracks(page).click()
				await expect(page.getByTestId('panneau-filtre-tracks')).toBeVisible()
				await sansDefilementHorizontal(page)
				await capturer(page, `organisations-filtres-${palier.nom}`, UNITE)
			})
		}
	})
})
