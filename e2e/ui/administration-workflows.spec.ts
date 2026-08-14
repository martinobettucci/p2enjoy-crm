// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, parcours d'interface
// @verifies docs/SPEC-workflow-engine.md §7 bis.2 (adresse depuis l'index des réglages),
//           §7 bis.9 (les arêtes : déclaration, modification, retrait sur la vraie base, refus
//           d'unicité constaté par une course réelle), §7 bis.9.1 (groupement et culs-de-sac),
//           §7 bis.9.3 (les arrivées offertes),
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
			// PREUVE RESSERRÉE, ET LA RÈGLE A CHANGÉ : depuis le §7 bis.9.6, le bloc des transitions
			// nomme ses groupes par le libellé de l'étape de départ, donc ce libellé apparaît deux
			// fois dans le document. L'assertion vise la liste des étapes — ce qu'elle éprouve, la
			// surcharge affichée après enregistrement, est inchangé.
			await expect(
				page.getByTestId('liste-etapes').getByText('E2E Surchargée'),
			).toBeVisible()
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

// -------------------------------------------------------------------------------------------
// Les arêtes du graphe — docs/SPEC-workflow-engine.md §7 bis.9
// -------------------------------------------------------------------------------------------
//
// LE SEED N'EST PAS AMPUTÉ ICI NON PLUS, et la contrainte est plus douce que pour les étapes : une
// arête se DÉCLARE puis se RETIRE, et la table retrouve exactement son état. Les preuves visent
// donc une paire d'étapes seedées qu'AUCUNE arête ne relie — `Prospection → Négociation`, mesurée
// absente du graphe du §3.9 —, et leur `finally` supprime par la paire, quel que soit le point
// d'échec.
//
// Le refus d'unicité n'est PAS simulé : un second administrateur déclare l'arête par la clé de
// service pendant que le formulaire est ouvert, puis l'écran envoie la sienne. C'est la course
// réelle que le §7 bis.9.3 annonce — le filtre des arrivées offertes est une aide, pas une garde —,
// et elle rend le vrai `23505` de la base.

const ETAPE_NEGOCIATION = '5eed0000-0000-4000-8000-000000000063'
const CHEMIN_TRANSITIONS = `${URL_API}/rest/v1/workflow_transitions`

/** L'arête `Prospection → Négociation` en base, ou `null` : la confirmation d'un geste d'écran. */
async function areteDePreuve(
	request: APIRequestContext,
): Promise<{ id: string; label: string | null; require_comment: boolean } | null> {
	const reponse = await request.get(
		`${CHEMIN_TRANSITIONS}?select=id,label,require_comment&from_step_id=eq.${ETAPE_INITIALE_SEED}&to_step_id=eq.${ETAPE_NEGOCIATION}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as readonly {
		id: string
		label: string | null
		require_comment: boolean
	}[]
	return lignes[0] ?? null
}

/** Rend le graphe seedé à son état : l'arête de la preuve n'existe plus (INC-099). */
async function purgerArete(request: APIRequestContext): Promise<void> {
	await request.delete(
		`${CHEMIN_TRANSITIONS}?from_step_id=eq.${ETAPE_INITIALE_SEED}&to_step_id=eq.${ETAPE_NEGOCIATION}`,
		{ headers: enTetesService() },
	)
}

test.describe('les trois gestes sur une arête (§7 bis.9.2)', () => {
	test('un administrateur déclare, modifie et retire une transition à la souris', async ({
		page,
		request,
	}) => {
		await purgerArete(request)
		try {
			await connecter(page)
			await ouvrirEditeur(page)

			// Le graphe seedé est rendu groupé par étape de départ, culs-de-sac compris (§7 bis.9.1).
			await expect(page.getByTestId('ligne-transition')).toHaveCount(11)
			await expect(page.getByTestId('etape-sans-sortie')).toHaveCount(2)

			// --- Déclarer --------------------------------------------------------------------
			await page.getByRole('button', { name: 'Déclarer une transition' }).click()
			const formulaire = page.getByTestId('formulaire-transition')
			await expect(formulaire).toBeVisible()
			await formulaire.getByLabel('Étape de départ').selectOption({ label: 'Prospection' })
			// Les deux arrivées déjà déclarées depuis Prospection — Relance et Perdu — ne sont pas
			// offertes, et Prospection non plus : le §7 bis.9.3, constaté sur le graphe réel.
			const arrivees = formulaire.getByLabel('Étape d’arrivée')
			await expect(arrivees.locator('option')).toHaveCount(4)
			await expect(arrivees.locator('option', { hasText: 'Relance' })).toHaveCount(0)
			await arrivees.selectOption({ label: 'Négociation' })
			await formulaire.getByLabel('Libellé du bouton').fill('E2E Négocier directement')
			await formulaire.getByLabel('Exiger un motif').check()
			await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(formulaire).toBeHidden()
			await expect(page.getByTestId('ligne-transition')).toHaveCount(12)
			// Confirmé EN BASE, pas seulement à l'écran.
			expect(await areteDePreuve(request)).toMatchObject({
				label: 'E2E Négocier directement',
				require_comment: true,
			})

			// --- Modifier : vider le libellé le remet à `null`, le motif retombe --------------
			await page
				.getByRole('button', { name: 'Modifier la transition Prospection vers Négociation' })
				.click()
			const edition = page.getByTestId('formulaire-transition-edition')
			await expect(edition).toBeVisible()
			await edition.getByLabel('Libellé du bouton').fill('')
			await edition.getByLabel('Exiger un motif').uncheck()
			await edition.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(edition).toBeHidden()
			expect(await areteDePreuve(request)).toMatchObject({ label: null, require_comment: false })

			// --- Retirer : confirmation, puis la base ne porte plus l'arête -------------------
			await page
				.getByRole('button', { name: 'Retirer la transition Prospection vers Négociation' })
				.click()
			const confirmation = page.getByTestId('confirmation-retrait-transition')
			await expect(confirmation).toContainText('Retirer la transition Prospection vers Négociation ?')
			await confirmation.getByRole('button', { name: 'Retirer la transition' }).click()
			await expect(confirmation).toBeHidden()
			await expect(page.getByTestId('ligne-transition')).toHaveCount(11)
			expect(await areteDePreuve(request)).toBeNull()
		} finally {
			await purgerArete(request)
		}
	})

	test('une arête déclarée entre-temps par un autre administrateur est refusée par la base', async ({
		page,
		request,
	}) => {
		await purgerArete(request)
		try {
			await connecter(page)
			await ouvrirEditeur(page)

			await page.getByRole('button', { name: 'Déclarer une transition' }).click()
			const formulaire = page.getByTestId('formulaire-transition')
			await formulaire.getByLabel('Étape de départ').selectOption({ label: 'Prospection' })
			await formulaire.getByLabel('Étape d’arrivée').selectOption({ label: 'Négociation' })

			// LE SECOND ADMINISTRATEUR, PENDANT QUE LE FORMULAIRE EST OUVERT. Le filtre des arrivées
			// offertes a été calculé avant : l'unicité de la base est la seule garde qui reste.
			const concurrent = await request.post(CHEMIN_TRANSITIONS, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					workflow_id: WORKFLOW_DEFAUT,
					workspace_id: WORKSPACE,
					from_step_id: ETAPE_INITIALE_SEED,
					to_step_id: ETAPE_NEGOCIATION,
				},
			})
			expect(concurrent.status(), 'déclaration concurrente par la clé de service').toBe(201)

			await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(formulaire.getByTestId('workflows-refus')).toContainText(
				'Cette transition est déjà déclarée.',
			)
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])

			// Une seule arête existe : le refus n'a rien écrit, et l'écran n'a rien inventé.
			const lecture = await request.get(
				`${CHEMIN_TRANSITIONS}?select=id&from_step_id=eq.${ETAPE_INITIALE_SEED}&to_step_id=eq.${ETAPE_NEGOCIATION}`,
				{ headers: enTetesService() },
			)
			expect(((await lecture.json()) as unknown[]).length).toBe(1)
		} finally {
			await purgerArete(request)
		}
	})

	test('les trois gestes se mènent au clavier seul', async ({ page, request }) => {
		await purgerArete(request)
		try {
			await connecter(page)
			await ouvrirEditeur(page)

			await tabVers(page, page.getByRole('button', { name: 'Déclarer une transition' }))
			await page.keyboard.press('Enter')
			const formulaire = page.getByTestId('formulaire-transition')
			// Le focus entre DANS le formulaire à l'ouverture (docs/DESIGN_SYSTEM.md §5.13).
			await expect(formulaire.getByLabel('Étape de départ')).toBeFocused()
			await formulaire.getByLabel('Étape de départ').selectOption({ label: 'Prospection' })
			await formulaire.getByLabel('Étape d’arrivée').selectOption({ label: 'Négociation' })
			await tabVers(page, formulaire.getByLabel('Libellé du bouton'))
			await page.keyboard.type('E2E Clavier')
			await tabVers(page, formulaire.getByRole('button', { name: 'Enregistrer' }))
			await page.keyboard.press('Enter')
			await expect(formulaire).toBeHidden()
			expect(await areteDePreuve(request)).toMatchObject({ label: 'E2E Clavier' })

			await tabVers(
				page,
				page.getByRole('button', { name: 'Modifier la transition Prospection vers Négociation' }),
			)
			await page.keyboard.press('Enter')
			const edition = page.getByTestId('formulaire-transition-edition')
			await expect(edition.getByLabel('Libellé du bouton')).toBeFocused()
			await page.keyboard.press('End')
			await page.keyboard.type(' modifié')
			// `Enter` soumet depuis un champ : le formulaire est un vrai `form`.
			await page.keyboard.press('Enter')
			await expect(edition).toBeHidden()
			expect(await areteDePreuve(request)).toMatchObject({ label: 'E2E Clavier modifié' })

			await tabVers(
				page,
				page.getByRole('button', { name: 'Retirer la transition Prospection vers Négociation' }),
			)
			await page.keyboard.press('Enter')
			const confirmation = page.getByTestId('confirmation-retrait-transition')
			// Le focus est posé sur la confirmation à l'ouverture : `Enter` confirme.
			await expect(confirmation.getByRole('button', { name: 'Retirer la transition' })).toBeFocused()
			await page.keyboard.press('Enter')
			await expect(confirmation).toBeHidden()
			expect(await areteDePreuve(request)).toBeNull()
		} finally {
			await purgerArete(request)
		}
	})

	test('le formulaire de déclaration ouvert est capturé, et le graphe aux quatre paliers', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)
		await page.getByTestId('groupes-transitions').scrollIntoViewIfNeeded()
		await capturer(page, 'workflows-transitions-1440', UNITE)
		await page.getByRole('button', { name: 'Déclarer une transition' }).click()
		await expect(page.getByTestId('formulaire-transition')).toBeVisible()
		await capturer(page, 'workflows-transitions-formulaire-1440', UNITE)
	})

	for (const palier of PALIERS) {
		test(`${palier.nom} : le bloc des transitions reste lisible, sans débordement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			await ouvrirEditeur(page)
			await page.getByTestId('groupes-transitions').scrollIntoViewIfNeeded()
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
			await capturer(page, `workflows-transitions-${palier.nom}`, UNITE)
		})
	}
})

// =============================================================================================
// TROISIÈME TRANCHE — les champs du formulaire
// @verifies docs/SPEC-workflow-engine.md §7 bis.10 (l'édition des champs), §7 bis.10.1 (lecture 5,
//           archivés compris), §7 bis.10.2 (les cinq gestes sur la vraie base), §7 bis.10.3 (clé et
//           type figés après la déclaration), §7 bis.10.4 (validation de forme, dont l'unicité des
//           clés de choix), §7 bis.10.5 (refus d'une clé déjà prise, constaté et non simulé),
//           §7 bis.10.8 (preuves attendues)
// @verifies docs/SPEC-form-composer.md §2.4 (options), §2.6 (ordre), §2.7 (aucune suppression)
// =============================================================================================
//
// MÊME DISCIPLINE QUE LES DEUX PREMIÈRES TRANCHES : chaque geste est joué par l'écran, puis
// confirmé EN BASE par la clé de service. Les champs de preuve portent la clé préfixée `e2e-wf-`
// et sont purgés dans le `finally` — le seed retrouve exactement ses sept champs.
//
// LE CHAMP ARCHIVÉ N'EST PAS CRÉÉ PAR LA PREUVE : le seed en pose un, `budget-previsionnel`, et
// l'archivage se joue sur un champ de preuve pour ne pas déplacer l'état seedé.

const CHEMIN_CHAMPS = `${URL_API}/rest/v1/form_fields`

/** L'état d'un champ en base, lu par sa clé — la confirmation d'un geste d'écran. */
async function champEnBase(
	request: APIRequestContext,
	cle: string,
): Promise<{
	id: string
	key: string
	label: string
	type: string
	options: Record<string, unknown>
	help_text: string | null
	position: number
	archived_at: string | null
} | null> {
	const reponse = await request.get(
		`${CHEMIN_CHAMPS}?select=id,key,label,type,options,help_text,position,archived_at&workflow_id=eq.${WORKFLOW_DEFAUT}&key=eq.${cle}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as readonly {
		id: string
		key: string
		label: string
		type: string
		options: Record<string, unknown>
		help_text: string | null
		position: number
		archived_at: string | null
	}[]
	return lignes[0] ?? null
}

/** Purge les champs de preuve, valeurs comprises : le seed doit retrouver ses sept champs. */
async function purgerChamps(request: APIRequestContext): Promise<void> {
	const lecture = await request.get(
		`${CHEMIN_CHAMPS}?select=id&workflow_id=eq.${WORKFLOW_DEFAUT}&key=like.e2e-wf-*`,
		{ headers: enTetesService() },
	)
	const lignes = (await lecture.json()) as readonly { id: string }[]
	for (const ligne of lignes) {
		await request.delete(`${URL_API}/rest/v1/card_field_values?field_id=eq.${ligne.id}`, {
			headers: enTetesService(),
		})
		await request.delete(`${CHEMIN_CHAMPS}?id=eq.${ligne.id}`, { headers: enTetesService() })
	}
}

/** Amène le bloc des champs à l'écran — il est le troisième, sous les étapes et les arêtes. */
async function ouvrirBlocChamps(page: Page): Promise<void> {
	await page.getByTestId('liste-champs').scrollIntoViewIfNeeded()
	// Le seed pose sept champs, dont un archivé : c'est le contrat du §7 bis.10.8.
	await expect(page.getByTestId('ligne-champ')).toHaveCount(7)
	await expect(page.getByTestId('champ-archive')).toHaveCount(1)
}

test.describe('les cinq gestes sur les champs, à la souris (§7 bis.10.2)', () => {
	test('un administrateur déclare, modifie, réordonne, archive et restaure un champ', async ({
		page,
		request,
	}) => {
		await purgerChamps(request)
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirBlocChamps(page)

			// --- Déclarer -------------------------------------------------------------------------
			await page.getByRole('button', { name: 'Déclarer un champ' }).click()
			const formulaire = page.getByTestId('formulaire-champ')
			await expect(formulaire).toBeVisible()
			await formulaire.getByLabel('Clé').fill('e2e-wf-souris')
			await formulaire.getByLabel('Libellé').fill('E2E Champ Souris')
			await formulaire.getByLabel('Type').selectOption('number')
			await formulaire.getByLabel('Texte d’aide').fill('Posé par la preuve.')
			await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(formulaire).toBeHidden()
			await expect(page.getByTestId('ligne-champ')).toHaveCount(8)
			// Le trigger a placé le champ EN FIN de formulaire : position 8, après les sept seedés.
			const declare = await champEnBase(request, 'e2e-wf-souris')
			expect(declare).toMatchObject({
				label: 'E2E Champ Souris',
				type: 'number',
				help_text: 'Posé par la preuve.',
				options: {},
				archived_at: null,
			})
			expect(declare?.position).toBeGreaterThan(7)

			// --- Modifier : le libellé et l'aide, jamais la clé ni le type (§7 bis.10.3) -----------
			await page.getByRole('button', { name: 'Modifier le champ E2E Champ Souris' }).click()
			const edition = page.getByTestId('formulaire-champ')
			await expect(edition).toBeVisible()
			// La clé et le type sont AFFICHÉS et non saisissables : deux textes qui disent pourquoi.
			await expect(edition.getByTestId('champ-cle-figee')).toContainText('e2e-wf-souris')
			await expect(edition.getByTestId('champ-type-fige')).toContainText('Nombre')
			await expect(edition.getByLabel('Clé')).toHaveCount(0)
			await expect(edition.getByLabel('Type')).toHaveCount(0)
			await edition.getByLabel('Libellé').fill('E2E Champ Modifié')
			await edition.getByLabel('Texte d’aide').fill('')
			await edition.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(edition).toBeHidden()
			// L'aide vidée est écrite à `null`, et la clé comme le type sont intacts EN BASE.
			expect(await champEnBase(request, 'e2e-wf-souris')).toMatchObject({
				label: 'E2E Champ Modifié',
				type: 'number',
				help_text: null,
			})

			// --- Réordonner ------------------------------------------------------------------------
			const avant = await champEnBase(request, 'e2e-wf-souris')
			await page.getByRole('button', { name: 'Monter E2E Champ Modifié' }).click()
			await expect(page.getByTestId('liste-champs')).toBeVisible()
			await expect
				.poll(async () => (await champEnBase(request, 'e2e-wf-souris'))?.position)
				.toBeLessThan(avant?.position ?? 0)

			// --- Archiver, confirmation comprise ---------------------------------------------------
			await page.getByRole('button', { name: 'Archiver le champ E2E Champ Modifié' }).click()
			const confirmation = page.getByTestId('confirmation-archivage-champ')
			await expect(confirmation).toBeVisible()
			// La confirmation seule ne modifie rien : l'archivage n'a pas encore eu lieu.
			expect((await champEnBase(request, 'e2e-wf-souris'))?.archived_at).toBeNull()
			await confirmation.getByRole('button', { name: 'Archiver' }).click()
			await expect(confirmation).toBeHidden()
			await expect
				.poll(async () => (await champEnBase(request, 'e2e-wf-souris'))?.archived_at)
				.not.toBeNull()
			// L'archivé reste dans la liste, nommé : c'est ce que la lecture 5 exige (§7 bis.10.1).
			await expect(page.getByTestId('champ-archive')).toHaveCount(2)

			// --- Restaurer -------------------------------------------------------------------------
			await page.getByRole('button', { name: 'Restaurer le champ E2E Champ Modifié' }).click()
			await expect
				.poll(async () => (await champEnBase(request, 'e2e-wf-souris'))?.archived_at)
				.toBeNull()
			await expect(page.getByTestId('champ-archive')).toHaveCount(1)
		} finally {
			await purgerChamps(request)
		}
	})

	test('un champ à choix se déclare avec ses choix, et deux clés identiques sont refusées AVANT l’envoi', async ({
		page,
		request,
	}) => {
		await purgerChamps(request)
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirBlocChamps(page)

			await page.getByRole('button', { name: 'Déclarer un champ' }).click()
			const formulaire = page.getByTestId('formulaire-champ')
			await formulaire.getByLabel('Clé').fill('e2e-wf-choix')
			await formulaire.getByLabel('Libellé').fill('E2E Origine')
			await formulaire.getByLabel('Type').selectOption('select')
			await expect(formulaire.getByTestId('editeur-choix')).toBeVisible()
			await formulaire.getByRole('button', { name: 'Ajouter un choix' }).click()
			await formulaire.getByRole('button', { name: 'Ajouter un choix' }).click()
			const cles = formulaire.getByLabel('Clé du choix')
			const libelles = formulaire.getByLabel('Libellé du choix')
			await cles.nth(0).fill('salon')
			await libelles.nth(0).fill('Salon')
			await cles.nth(1).fill('salon')
			await libelles.nth(1).fill('Salon bis')

			// LA BASE ACCEPTERAIT CES DEUX CHOIX — mesuré `201` le 2026-08-14. L'écran est la seule
			// garantie, et il refuse avant l'envoi (§7 bis.10.4).
			await expect(
				formulaire.getByText(
					'Deux choix portent la même clé : les réponses seraient impossibles à distinguer.',
				),
			).toBeVisible()
			await expect(formulaire.getByRole('button', { name: 'Enregistrer' })).toBeDisabled()
			expect(await champEnBase(request, 'e2e-wf-choix')).toBeNull()

			await cles.nth(1).fill('site')
			await libelles.nth(1).fill('Site web')
			await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(formulaire).toBeHidden()
			const declare = await champEnBase(request, 'e2e-wf-choix')
			expect(declare?.options).toEqual({
				choices: [
					{ key: 'salon', label: 'Salon' },
					{ key: 'site', label: 'Site web' },
				],
			})
		} finally {
			await purgerChamps(request)
		}
	})

	test('le refus d’une clé déjà prise vient de la base, et rien n’est créé', async ({
		page,
		request,
	}) => {
		// `budget` est une clé SEEDÉE : le refus est celui de l'unicité `(workflow_id, key)`, obtenu
		// sans rien modifier — un refus ne touche à aucune ligne, c'est le seul geste de ces preuves
		// autorisé à viser une clé du seed.
		await connecter(page)
		await ouvrirEditeur(page)
		await ouvrirBlocChamps(page)

		await page.getByRole('button', { name: 'Déclarer un champ' }).click()
		const formulaire = page.getByTestId('formulaire-champ')
		await formulaire.getByLabel('Clé').fill('budget')
		await formulaire.getByLabel('Libellé').fill('E2E Doublon')
		await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(formulaire.getByText('Cette clé est déjà prise dans ce workflow.')).toBeVisible()
		// Le `409` de l'unicité traverse la console : il est consommé ici, nommément, parce que le
		// scénario vient de le provoquer ET de vérifier que l'écran l'explique (décision 248).
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		// Le seed est intact : sept champs, et `budget` porte toujours son libellé seedé.
		await expect(page.getByTestId('ligne-champ')).toHaveCount(7)
		expect(await champEnBase(request, 'budget')).toMatchObject({ label: 'Budget estimé' })
	})
})

test.describe('les champs au clavier seul (§7 bis.10.6, docs/DESIGN_SYSTEM.md §8)', () => {
	test('déclaration, modification et archivage se mènent sans souris', async ({ page, request }) => {
		await purgerChamps(request)
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirBlocChamps(page)

			await tabVers(page, page.getByRole('button', { name: 'Déclarer un champ' }))
			await page.keyboard.press('Enter')
			const formulaire = page.getByTestId('formulaire-champ')
			// Le focus entre dans le premier champ modifiable — la clé, à la déclaration.
			await expect(formulaire.getByLabel('Clé')).toBeFocused()
			await page.keyboard.type('e2e-wf-clavier')
			await tabVers(page, formulaire.getByLabel('Libellé'))
			await page.keyboard.type('E2E Champ Clavier')
			await tabVers(page, formulaire.getByRole('button', { name: 'Enregistrer' }))
			await page.keyboard.press('Enter')
			await expect(formulaire).toBeHidden()
			expect(await champEnBase(request, 'e2e-wf-clavier')).toMatchObject({
				label: 'E2E Champ Clavier',
				type: 'text',
			})

			await tabVers(page, page.getByRole('button', { name: 'Modifier le champ E2E Champ Clavier' }))
			await page.keyboard.press('Enter')
			const edition = page.getByTestId('formulaire-champ')
			// À l'édition, le focus entre dans le LIBELLÉ : la clé n'y est plus qu'un texte.
			await expect(edition.getByLabel('Libellé')).toBeFocused()
			await page.keyboard.press('End')
			await page.keyboard.type(' modifié')
			await page.keyboard.press('Enter')
			await expect(edition).toBeHidden()
			expect(await champEnBase(request, 'e2e-wf-clavier')).toMatchObject({
				label: 'E2E Champ Clavier modifié',
			})

			await tabVers(
				page,
				page.getByRole('button', { name: 'Archiver le champ E2E Champ Clavier modifié' }),
			)
			await page.keyboard.press('Enter')
			const confirmation = page.getByTestId('confirmation-archivage-champ')
			await expect(confirmation.getByRole('button', { name: 'Archiver' })).toBeFocused()
			await page.keyboard.press('Enter')
			await expect(confirmation).toBeHidden()
			await expect
				.poll(async () => (await champEnBase(request, 'e2e-wf-clavier'))?.archived_at)
				.not.toBeNull()
		} finally {
			await purgerChamps(request)
		}
	})
})

test.describe('captures du bloc des champs (CLAUDE.md §16)', () => {
	test('le formulaire de déclaration ouvert est capturé, avec le champ archivé du seed', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)
		await ouvrirBlocChamps(page)
		await capturer(page, 'workflows-champs-1440', UNITE)
		await page.getByRole('button', { name: 'Déclarer un champ' }).click()
		const formulaire = page.getByTestId('formulaire-champ')
		await expect(formulaire).toBeVisible()
		await formulaire.getByLabel('Type').selectOption('select')
		await formulaire.getByRole('button', { name: 'Ajouter un choix' }).click()
		await capturer(page, 'workflows-champs-formulaire-1440', UNITE)
	})

	for (const palier of PALIERS) {
		test(`${palier.nom} : le bloc des champs reste lisible, sans débordement`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirBlocChamps(page)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
			await capturer(page, `workflows-champs-${palier.nom}`, UNITE)
		})
	}
})
