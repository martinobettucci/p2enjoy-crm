// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, parcours d'interface
// @verifies docs/SPEC-workflow-engine.md §7 bis.2 (adresse depuis l'index des réglages),
//           §7 bis.3 (catalogue lu à l'ouverture du sélecteur), §7 bis.4 (les six gestes sur la
//           vraie base, refus d'une étape occupée constaté et non simulé), §7 bis.6 (états,
//           paliers, clavier), §2.5 (`0` n'est pas `NULL`), §3.5 (désignation de l'initiale)
// @verifies docs/DESIGN_SYSTEM.md §7 (paliers), §8 (accessibilité clavier)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// LES GESTES SONT PROUVÉS SUR LA VRAIE BASE, ET CHACUN Y EST CONFIRMÉ APRÈS COUP par une lecture
// de service — l'écran peut mentir, la table non. La discipline est celle
// d'`administration-arborescence.spec.ts` : souris d'abord, clavier ensuite, focus atteint par
// `Tab` et jamais par `focus()`.
//
// LE SEED N'EST JAMAIS MODIFIÉ, et c'est la contrainte qui dessine ces scénarios. Les deux
// workflows seedés emploient les sept nœuds actifs du catalogue : il n'existe donc AUCUN nœud
// ajoutable au départ, et retirer une étape seedée amputerait le seed. Chaque scénario crée donc
// SON nœud de catalogue par la clé de service, sous une clé préfixée `e2e-wf-`, l'ajoute comme
// étape PAR L'ÉCRAN, exerce les autres gestes sur cette étape-là, la retire PAR L'ÉCRAN, et purge
// nœud et étape dans son `finally` (règle d'INC-099 : chaque preuve rend la table dans l'état où
// elle l'a trouvée). La désignation de l'étape initiale, qui déplace un booléen seedé, est jouée
// dans les DEUX sens par l'écran, et le `finally` réimpose l'état seedé par la clé de service.
//
// Le refus d'une étape occupée est constaté sur une étape seedée — « Prospection » porte quatre
// cards — parce qu'un refus ne modifie rien : c'est le seul geste de ces preuves autorisé à viser
// une ligne seedée.

import { expect, test, type Page } from './fixtures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole } from './fixtures'
import type { APIRequestContext, Locator } from '@playwright/test'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-076'
const ADMIN = 'admin@p2enjoy.test'

/** Identifiants STABLES du seed (docs/SPEC-seed.md) : le workflow global par défaut, son étape
 * initiale seedée, et le workspace unique. */
const WORKFLOW_DEFAUT = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_INITIALE_SEED = '5eed0000-0000-4000-8000-000000000061'
const WORKSPACE = '5eed0000-0000-4000-8000-000000000001'

const CHEMIN_CATALOGUE = `${URL_API}/rest/v1/workflow_nodes_catalog`
const CHEMIN_ETAPES = `${URL_API}/rest/v1/workflow_steps`

async function connecter(page: Page): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(ADMIN)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Crée le nœud de catalogue PROPRE à la preuve, par la clé de service, et rend son identifiant. */
async function creerNoeudDePreuve(
	request: APIRequestContext,
	cle: string,
	libelle: string,
): Promise<string> {
	const reponse = await request.post(CHEMIN_CATALOGUE, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { workspace_id: WORKSPACE, key: cle, label: libelle, kind: 'open', color: 'neutral' },
	})
	expect(reponse.status(), 'création du nœud de preuve').toBe(201)
	const lignes = (await reponse.json()) as readonly { id: string }[]
	const id = lignes[0]?.id
	expect(id).toBeTruthy()
	return id as string
}

/** Purge étape puis nœud par la clé de la preuve, et réimpose l'étape initiale seedée (INC-099). */
async function purger(request: APIRequestContext, cle: string): Promise<void> {
	const lecture = await request.get(`${CHEMIN_CATALOGUE}?select=id&key=eq.${cle}`, {
		headers: enTetesService(),
	})
	const lignes = (await lecture.json()) as readonly { id: string }[]
	for (const ligne of lignes) {
		await request.delete(`${CHEMIN_ETAPES}?node_id=eq.${ligne.id}`, { headers: enTetesService() })
	}
	await request.delete(`${CHEMIN_CATALOGUE}?key=eq.${cle}`, { headers: enTetesService() })
	// L'état seedé de l'initiale est réimposé quel que soit le point d'échec du scénario.
	await request.patch(`${CHEMIN_ETAPES}?workflow_id=eq.${WORKFLOW_DEFAUT}&is_initial=eq.true`, {
		headers: enTetesService(),
		data: { is_initial: false },
	})
	await request.patch(`${CHEMIN_ETAPES}?id=eq.${ETAPE_INITIALE_SEED}`, {
		headers: enTetesService(),
		data: { is_initial: true },
	})
}

/** L'état d'une étape en base, lu par la clé de service — la confirmation d'un geste d'écran. */
async function etapeEnBase(
	request: APIRequestContext,
	idNoeud: string,
): Promise<{
	label_override: string | null
	probability_override: number | null
	stale_after_days: number | null
	is_initial: boolean
} | null> {
	const reponse = await request.get(
		`${CHEMIN_ETAPES}?select=label_override,probability_override,stale_after_days,is_initial&node_id=eq.${idNoeud}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as readonly {
		label_override: string | null
		probability_override: number | null
		stale_after_days: number | null
		is_initial: boolean
	}[]
	return lignes[0] ?? null
}

async function ouvrirEditeur(page: Page): Promise<void> {
	await page.goto('/reglages')
	await page.getByRole('link', { name: /Workflows : étapes et composition/ }).click()
	await expect(page).toHaveURL(/\/reglages\/workflows$/)
	await expect(page.getByRole('heading', { name: 'Éditeur de workflows' })).toBeVisible()
	// Le défaut est choisi d'office, ses sept étapes seedées sont rendues dans l'ordre du graphe.
	await expect(page.getByRole('button', { name: /Cycle commercial standard/ })).toHaveAttribute(
		'aria-current',
		'true',
	)
	await expect(page.getByTestId('ligne-etape')).toHaveCount(7)
}

/** Avance le focus par `Tab` jusqu'à `cible` — jamais de `focus()` programmatique (§8). */
async function tabVers(page: Page, cible: Locator, max = 120): Promise<void> {
	for (let tentative = 0; tentative < max; tentative++) {
		if (
			await cible
				.evaluate((element: Element) => element === document.activeElement)
				.catch(() => false)
		) {
			return
		}
		await page.keyboard.press('Tab')
	}
	await expect(cible).toBeFocused()
}

// -------------------------------------------------------------------------------------------
// À la souris
// -------------------------------------------------------------------------------------------

test.describe('les six gestes, à la souris (docs/SPEC-workflow-engine.md §7 bis.4)', () => {
	test('un administrateur ajoute, surcharge, réordonne, désigne, rétablit et retire une étape', async ({
		page,
		request,
	}) => {
		const cle = 'e2e-wf-souris'
		const libelle = 'E2E Étape Souris'
		await purger(request, cle)
		const idNoeud = await creerNoeudDePreuve(request, cle, libelle)

		try {
			await connecter(page)
			await ouvrirEditeur(page)

			// --- Ajouter -------------------------------------------------------------------------
			// Le catalogue n'est lu qu'à l'ouverture du sélecteur (§7 bis.3) : seul le nœud de la
			// preuve est proposable, les sept nœuds actifs seedés étant déjà employés.
			await page.getByRole('button', { name: 'Ajouter une étape' }).click()
			const selecteur = page.getByTestId('selecteur-ajout')
			await expect(selecteur).toBeVisible()
			await expect(selecteur.getByRole('button', { name: /^Ajouter Prospection/ })).toHaveCount(0)
			await selecteur.getByRole('button', { name: `Ajouter ${libelle}` }).click()
			await expect(selecteur).toBeHidden()
			await expect(page.getByTestId('ligne-etape')).toHaveCount(8)
			// Le trigger a placé l'étape en fin de liste, sans surcharge : confirmé EN BASE.
			const ajoutee = await etapeEnBase(request, idNoeud)
			expect(ajoutee).toMatchObject({
				label_override: null,
				probability_override: null,
				stale_after_days: null,
				is_initial: false,
			})

			// --- Surcharger, `0` compris (§2.5) --------------------------------------------------
			await page.getByRole('button', { name: `Surcharger ${libelle}` }).click()
			const formulaire = page.getByTestId('formulaire-surcharge')
			await expect(formulaire).toBeVisible()
			await formulaire.getByLabel('Libellé surchargé').fill('E2E Surchargée')
			await formulaire.getByLabel('Probabilité (%)').fill('0')
			await formulaire.getByLabel('Seuil de relance (jours)').fill('3')
			await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(formulaire).toBeHidden()
			await expect(page.getByText('E2E Surchargée')).toBeVisible()
			// `0` est une SURCHARGE en base, pas une absence — le cœur du §2.5.
			expect(await etapeEnBase(request, idNoeud)).toMatchObject({
				label_override: 'E2E Surchargée',
				probability_override: 0,
				stale_after_days: 3,
			})

			// --- Retirer une surcharge : vider le champ envoie `null` ----------------------------
			await page.getByRole('button', { name: 'Surcharger E2E Surchargée' }).click()
			await formulaire.getByLabel('Seuil de relance (jours)').fill('')
			await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(formulaire).toBeHidden()
			expect(await etapeEnBase(request, idNoeud)).toMatchObject({
				probability_override: 0,
				stale_after_days: null,
			})

			// --- Réordonner : une seule écriture, l'ordre affiché change -------------------------
			await page.getByRole('button', { name: 'Monter E2E Surchargée' }).click()
			const lignes = page.getByTestId('ligne-etape')
			await expect(lignes.nth(6)).toContainText('E2E Surchargée')
			await expect(lignes.nth(7)).toContainText('Perdu')

			// --- Désigner l'initiale, puis rétablir (§3.5) ---------------------------------------
			await page.getByRole('button', { name: 'Désigner E2E Surchargée comme étape initiale' }).click()
			await expect(
				lignes.nth(6).getByText('Étape initiale', { exact: true }),
			).toBeVisible()
			expect(await etapeEnBase(request, idNoeud)).toMatchObject({ is_initial: true })
			// Le geste inverse, par l'écran aussi : le seed reprend son étape initiale.
			await page.getByRole('button', { name: 'Désigner Prospection comme étape initiale' }).click()
			await expect(lignes.nth(0).getByText('Étape initiale', { exact: true })).toBeVisible()
			expect(await etapeEnBase(request, idNoeud)).toMatchObject({ is_initial: false })

			// --- Retirer : confirmation, puis la base ne porte plus l'étape ----------------------
			await page.getByRole('button', { name: 'Retirer E2E Surchargée' }).click()
			const confirmation = page.getByTestId('confirmation-retrait')
			await expect(confirmation).toContainText('Retirer l’étape « E2E Surchargée » ?')
			await confirmation.getByRole('button', { name: 'Retirer' }).click()
			await expect(confirmation).toBeHidden()
			await expect(page.getByTestId('ligne-etape')).toHaveCount(7)
			expect(await etapeEnBase(request, idNoeud)).toBeNull()
		} finally {
			await purger(request, cle)
		}
	})

	test('retirer une étape occupée par des cards est refusé par la base, et l’écran nomme le refus', async ({
		page,
		request,
	}) => {
		await connecter(page)
		await ouvrirEditeur(page)

		// « Prospection » porte quatre cards seedées : le `on delete restrict` du §3.3 refuse.
		await page.getByRole('button', { name: 'Retirer Prospection' }).click()
		const confirmation = page.getByTestId('confirmation-retrait')
		await confirmation.getByRole('button', { name: 'Retirer' }).click()
		const refus = page.getByTestId('workflows-refus')
		await expect(refus).toContainText('porte des affaires')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])

		// Rien n'a bougé : ni à l'écran, ni en base.
		await confirmation.getByRole('button', { name: 'Annuler' }).click()
		await expect(page.getByTestId('ligne-etape')).toHaveCount(7)
		const lecture = await request.get(
			`${CHEMIN_ETAPES}?select=id&workflow_id=eq.${WORKFLOW_DEFAUT}`,
			{ headers: enTetesService() },
		)
		expect(((await lecture.json()) as unknown[]).length).toBe(7)
	})
})

// -------------------------------------------------------------------------------------------
// Au clavier
// -------------------------------------------------------------------------------------------

test.describe('les mêmes gestes, au clavier (docs/DESIGN_SYSTEM.md §8, CLAUDE.md §22)', () => {
	test('un administrateur ajoute, surcharge et retire une étape sans toucher la souris', async ({
		page,
		request,
	}) => {
		const cle = 'e2e-wf-clavier'
		const libelle = 'E2E Étape Clavier'
		await purger(request, cle)
		const idNoeud = await creerNoeudDePreuve(request, cle, libelle)

		try {
			await connecter(page)
			await ouvrirEditeur(page)

			// --- Ajouter -------------------------------------------------------------------------
			await tabVers(page, page.getByRole('button', { name: 'Ajouter une étape' }))
			await page.keyboard.press('Enter')
			const selecteur = page.getByTestId('selecteur-ajout')
			await expect(selecteur).toBeVisible()
			await tabVers(page, selecteur.getByRole('button', { name: `Ajouter ${libelle}` }))
			await page.keyboard.press('Enter')
			await expect(page.getByTestId('ligne-etape')).toHaveCount(8)

			// --- Surcharger — le focus entre DANS le formulaire à l'ouverture (§5.13) ------------
			await tabVers(page, page.getByRole('button', { name: `Surcharger ${libelle}` }))
			await page.keyboard.press('Enter')
			const formulaire = page.getByTestId('formulaire-surcharge')
			await expect(formulaire.getByLabel('Libellé surchargé')).toBeFocused()
			await page.keyboard.type('E2E Clavier Surchargée')
			await page.keyboard.press('Tab')
			await page.keyboard.type('40')
			// `Enter` soumet depuis un champ : le formulaire est un vrai `form`.
			await page.keyboard.press('Enter')
			await expect(formulaire).toBeHidden()
			expect(await etapeEnBase(request, idNoeud)).toMatchObject({
				label_override: 'E2E Clavier Surchargée',
				probability_override: 40,
			})

			// --- Retirer -------------------------------------------------------------------------
			await tabVers(page, page.getByRole('button', { name: 'Retirer E2E Clavier Surchargée' }))
			await page.keyboard.press('Enter')
			const confirmation = page.getByTestId('confirmation-retrait')
			// Le focus est posé sur la confirmation à l'ouverture : `Enter` confirme.
			await expect(confirmation.getByRole('button', { name: 'Retirer' })).toBeFocused()
			await page.keyboard.press('Enter')
			await expect(confirmation).toBeHidden()
			await expect(page.getByTestId('ligne-etape')).toHaveCount(7)
			expect(await etapeEnBase(request, idNoeud)).toBeNull()
		} finally {
			await purger(request, cle)
		}
	})
})

// -------------------------------------------------------------------------------------------
// Paliers responsive et captures — docs/DESIGN_SYSTEM.md §7, CLAUDE.md §16
// -------------------------------------------------------------------------------------------

test.describe('paliers responsive et captures', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : l'éditeur reste lisible, sans débordement horizontal`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			await ouvrirEditeur(page)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
			await capturer(page, `workflows-${palier.nom}`, UNITE)
		})
	}

	test('le sélecteur d’ajout ouvert et le refus d’une étape occupée sont capturés', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)
		await page.getByRole('button', { name: 'Ajouter une étape' }).click()
		await expect(page.getByTestId('selecteur-ajout')).toBeVisible()
		// Les sept nœuds actifs sont employés : l'état « tout est employé » est l'état réel du seed.
		await expect(
			page.getByText('Tous les nœuds actifs du catalogue sont déjà des étapes de ce workflow.'),
		).toBeVisible()
		await capturer(page, 'workflows-selecteur-1440', UNITE)
		await page.getByRole('button', { name: 'Annuler' }).click()

		await page.getByRole('button', { name: 'Retirer Prospection' }).click()
		await page.getByTestId('confirmation-retrait').getByRole('button', { name: 'Retirer' }).click()
		await expect(page.getByTestId('workflows-refus')).toBeVisible()
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		await capturer(page, 'workflows-refus-occupee-1440', UNITE)
	})
})
