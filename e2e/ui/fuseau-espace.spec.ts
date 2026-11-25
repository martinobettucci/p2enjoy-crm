// @verifies INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T2.c : Réglages ▸ Fuseau horaire sur la vraie pile — l'entrée de
//           l'index, le fuseau de l'espace lu et son heure, le réglage à la souris puis au clavier (constaté en base), la lectrice qui lit avec le champ et la
//           commande éteints et leur motif, les quatre paliers
// @verifies docs/SPEC-modeles-emails.md §8.6 bis, §8.6 ter ; docs/DESIGN_SYSTEM.md §5.117, §5.59 ; CLAUDE.md §10 (la règle est celle de la base), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les gestes ÉCRIVENT : ils se jouent sur un ESPACE DE SONDE, `sonde-216-ui`, posé par la clé de service avec Camille pour administratrice et Farida pour
// lectrice, et retiré avant et après chaque scénario ; le retrait est constaté. L'espace du seed et « Studio Lumen » ne sont jamais écrits (le refus par
// requête directe, avec les vrais jetons, est celui de `e2e/api/fuseau-espace.spec.ts`).

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'INC-216'
const SLUG = 'sonde-216-ui'
const CHEMIN = `/${SLUG}/reglages/fuseau-horaire`
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const FARIDA = '5eed0000-0000-4000-8000-000000000013'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const json = { 'Content-Type': 'application/json' }

async function purger(request: APIRequestContext): Promise<void> {
	await request.delete(rest(`workspaces?slug=eq.${SLUG}`), { headers: enTetesService() })
	const restants = await request.get(rest(`workspaces?slug=eq.${SLUG}&select=id`), { headers: enTetesService() })
	expect(await restants.json(), 'l’espace de sonde ne doit pas rester dans la base').toEqual([])
}

async function poserLaSonde(request: APIRequestContext): Promise<string> {
	await purger(request)
	const creation = await request.post(rest('workspaces'), {
		headers: { ...enTetesService(), ...json, Prefer: 'return=representation' },
		data: { name: 'Espace de sonde 216', slug: SLUG },
	})
	expect(creation.status(), await creation.text()).toBe(201)
	const [ligne] = (await creation.json()) as { id: string }[]
	const membres = await request.post(rest('workspace_members'), {
		headers: { ...enTetesService(), ...json },
		data: [
			{ workspace_id: ligne!.id, user_id: CAMILLE, role: 'admin' },
			{ workspace_id: ligne!.id, user_id: FARIDA, role: 'viewer' },
		],
	})
	expect(membres.status(), await membres.text()).toBe(201)
	return ligne!.id
}

async function fuseauEnBase(request: APIRequestContext, id: string): Promise<string> {
	const reponse = await request.get(rest(`workspaces?id=eq.${id}&select=timezone`), { headers: enTetesService() })
	return ((await reponse.json()) as { timezone: string }[])[0]!.timezone
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.describe('Réglages ▸ Fuseau horaire (docs/DESIGN_SYSTEM.md §5.117)', () => {
	let espace = ''
	test.beforeEach(async ({ request }) => {
		espace = await poserLaSonde(request)
	})
	test.afterEach(async ({ request }) => {
		await purger(request)
	})

	test('l’administratrice lit le fuseau par défaut, le règle à la souris, et la base le porte', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(`/${SLUG}/reglages`)
		const entree = page.getByTestId('entree-fuseau-espace')
		await expect(entree).toHaveAttribute('href', CHEMIN)
		await entree.click()
		await expect(page.getByRole('heading', { level: 1, name: 'Fuseau horaire de l’espace' })).toBeVisible()

		const champ = page.getByTestId('champ-fuseau')
		await expect(champ).toHaveValue('Europe/Paris')
		await expect(champ).toBeEnabled()
		await expect(page.getByLabel('Fuseau horaire')).toHaveAttribute('data-testid', 'champ-fuseau')
		await expect(page.getByTestId('heure-fuseau')).toContainText(/Il est \d\d:\d\d dans ce fuseau/)
		await expect(page.getByTestId('motif-lecture-seule')).toHaveCount(0)
		await capturer(page, 'fuseau-reglages-1440', UNITE)

		// Le choix : la liste est celle du navigateur, groupée par région ; le texte de l'heure suit le choix AVANT l'enregistrement.
		await champ.selectOption('Asia/Tokyo')
		await expect(page.getByTestId('heure-fuseau')).toContainText(/contre \d\d:\d\d dans votre navigateur \(écart : [+−]/)
		expect(await fuseauEnBase(request, espace), 'rien n’est écrit avant « Enregistrer »').toBe('Europe/Paris')
		await capturer(page, 'fuseau-choix-1440', UNITE)

		await page.getByTestId('enregistrer-fuseau').click()
		await expect(page.getByTestId('annonce-fuseau')).toHaveText('Fuseau enregistré : Asia/Tokyo.')
		expect(await fuseauEnBase(request, espace)).toBe('Asia/Tokyo')
		await expect(page.getByTestId('enregistrer-fuseau')).toBeFocused()

		// Rechargée, la page porte ce que la base porte.
		await page.reload()
		await expect(page.getByTestId('champ-fuseau')).toHaveValue('Asia/Tokyo')
	})

	test('au clavier : le champ et la commande s’atteignent par Tab, le choix se fait par préfixe, Entrée enregistre', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(CHEMIN)
		const champ = page.getByTestId('champ-fuseau')
		await expect(champ).toHaveValue('Europe/Paris')

		await champ.focus()
		await expect(champ).toBeFocused()
		// Un `select` natif choisit par préfixe : on tape le nom, on ne cherche pas dans une liste.
		await page.keyboard.type('Pacific/Auckland')
		await expect(champ).toHaveValue('Pacific/Auckland')
		// `Entrée` sur le champ n'envoie rien : un `select` n'a pas de soumission implicite.
		expect(await fuseauEnBase(request, espace)).toBe('Europe/Paris')

		await page.keyboard.press('Tab')
		await expect(page.getByTestId('enregistrer-fuseau')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('annonce-fuseau')).toHaveText('Fuseau enregistré : Pacific/Auckland.')
		expect(await fuseauEnBase(request, espace)).toBe('Pacific/Auckland')
		await expect(page.getByTestId('enregistrer-fuseau')).toBeFocused()
	})

	test('la lectrice lit le fuseau : le champ et la commande sont éteints, lisibles, et citent le motif', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto(CHEMIN)
		const champ = page.getByTestId('champ-fuseau')
		await expect(champ).toHaveValue('Europe/Paris')
		await expect(champ).toBeDisabled()
		await expect(page.getByTestId('enregistrer-fuseau')).toBeDisabled()
		const motif = page.getByTestId('motif-lecture-seule')
		await expect(motif).toBeVisible()
		const idMotif = await motif.getAttribute('id')
		await expect(page.getByTestId('enregistrer-fuseau')).toHaveAttribute('aria-describedby', idMotif ?? '')
		await capturer(page, 'fuseau-reglages-lecture-1440', UNITE)
		expect(await fuseauEnBase(request, espace), 'la lectrice n’a rien écrit').toBe('Europe/Paris')
	})

	test('les quatre paliers : aucun défilement horizontal, le champ et la commande restent atteignables', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const [largeur, hauteur] of [
			[1440, 1000],
			[1024, 900],
			[768, 1000],
			[390, 900],
		] as const) {
			await page.setViewportSize({ width: largeur, height: hauteur })
			await page.goto(CHEMIN)
			await expect(page.getByTestId('champ-fuseau')).toBeVisible()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal de page à ${largeur} px`).toBeLessThanOrEqual(0)
			const boite = await page.getByTestId('champ-fuseau').boundingBox()
			expect(boite!.x, `le champ ne sort pas à gauche à ${largeur} px`).toBeGreaterThanOrEqual(0)
			expect(boite!.x + boite!.width, `le champ ne sort pas à droite à ${largeur} px`).toBeLessThanOrEqual(largeur)
			const bouton = await page.getByTestId('enregistrer-fuseau').boundingBox()
			expect(bouton!.height, `la commande garde sa cible de 40 px à ${largeur} px`).toBeGreaterThanOrEqual(40)
			if (largeur !== 1440) await capturer(page, `fuseau-reglages-${largeur}`, UNITE)
		}
	})
})
