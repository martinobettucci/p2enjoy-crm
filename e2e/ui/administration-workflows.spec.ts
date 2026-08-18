// @verifies CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, parcours d'interface
// @verifies docs/SPEC-workflow-engine.md §7 bis.2 (adresse depuis l'index des réglages),
//           §7 bis.9 (les arêtes : déclaration, modification, retrait sur la vraie base, refus
//           d'unicité constaté par une course réelle), §7 bis.9.1 (groupement et culs-de-sac),
//           §7 bis.9.3 (les arrivées offertes),
//           §7 bis.12 (cinquième tranche : les exigences propres à une transition),
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

/**
 * Avance le focus par `Tab` jusqu'à `cible` — jamais de `focus()` programmatique (§8).
 *
 * LE PLAFOND EST PASSÉ DE 120 À 260 LE 2026-08-15, ET C'EST UNE PREUVE RÉVISÉE, PAS UN
 * CONTOURNEMENT. La quatrième tranche ajoute la grille du §7 bis.11 sous les trois blocs
 * précédents : six champs actifs × sept étapes, soit **quarante-deux** listes déroulantes de plus
 * dans l'ordre de tabulation du document. Le parcours complet est donc plus long qu'avant, et trois
 * preuves clavier antérieures — étape, arête, champ — épuisaient leurs 120 pressions avant de
 * revenir sur leur cible lorsqu'elles repartaient du milieu du cycle.
 *
 * Ce qui a changé est l'écran, pas la règle : chaque cible reste atteignable au clavier SEUL, sans
 * piège de focus et sans ordre inversé, ce que ces preuves continuent de vérifier. Le plafond n'est
 * qu'une garde contre une boucle infinie ; le rabaisser ferait échouer une preuve exacte, et le
 * supprimer laisserait une preuve fausse tourner sans fin.
 */
async function tabVers(page: Page, cible: Locator, max = 260): Promise<void> {
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
		// PREUVE RÉVISÉE PAR LA CINQUIÈME TRANCHE, pour la raison EXACTE du parcours clavier des
		// champs, et avec la même mesure : le cinquième bloc du §7 bis.12 allonge le tour du
		// document, et ce parcours en fait deux. MESURÉ le 2026-08-15 en instrumentant `tabVers` :
		// 35 + 1 + 159 + 161 = 356 pressions, 27,8 s à vide — donc sous les 30 s par défaut lorsque
		// le scénario est seul, et AU-DESSUS pendant la campagne complète. Un délai qui ne tient que
		// si le scénario est joué seul n'est pas un délai. Aucune assertion n'est touchée.
		test.setTimeout(120_000)
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
		// PREUVE RÉVISÉE PAR LA CINQUIÈME TRANCHE — même cause, même mesure. MESURÉ le 2026-08-15 :
		// 58 + 2 + 2 + 132 + 153 = 347 pressions, 28,7 s à vide, au-dessus des 30 s sous la charge de
		// la campagne complète. Aucune assertion n'est touchée.
		test.setTimeout(120_000)
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
// et sont purgés dans le `finally` — le seed retrouve exactement ses NEUF champs (sept jusqu'à la
// sous-tranche 4d de `CRM-060`, docs/SPEC-contacts.md §13.6).
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

/** Purge les champs de preuve, valeurs comprises : le seed doit retrouver ses neuf champs. */
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
	// Le seed pose NEUF champs, dont un archivé : c'est le contrat du §7 bis.10.8, révisé par la
	// sous-tranche 4d de `CRM-060` qui ajoute `contact-principal` et `referent-technique`.
	await expect(page.getByTestId('ligne-champ')).toHaveCount(9)
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
		// Le seed est intact : neuf champs, et `budget` porte toujours son libellé seedé.
		await expect(page.getByTestId('ligne-champ')).toHaveCount(9)
		expect(await champEnBase(request, 'budget')).toMatchObject({ label: 'Budget estimé' })
	})
})

test.describe('les champs au clavier seul (§7 bis.10.6, docs/DESIGN_SYSTEM.md §8)', () => {
	test('déclaration, modification et archivage se mènent sans souris', async ({ page, request }) => {
		// PREUVE RÉVISÉE PAR LA CINQUIÈME TRANCHE, NON AFFAIBLIE — la règle prouvée est inchangée,
		// seul son COÛT a changé. Le §7 bis.12 ajoute un cinquième bloc, et avec lui une douzaine de
		// commandes « Exiger un champ » à l'ordre de tabulation du document. Ce parcours revient
		// deux fois en arrière dans la page — vers la ligne du champ, puis vers sa commande
		// d'archivage —, et une tabulation qui recule doit faire le tour du document.
		//
		// MESURÉ le 2026-08-15, en instrumentant `tabVers` : le parcours coûte désormais
		// 85 + 1 + 3 + 160 + 161 = 410 pressions, dont 161 pour la plus longue — le plafond de 260
		// tient donc largement, et ce n'est PAS lui qui manquait. C'est la DURÉE : 37 s mesurées
		// contre les 30 s du délai par défaut de Playwright, si bien que le scénario expirait au
		// milieu de son parcours et que son `finally` ne purgeait plus rien — six scénarios suivants
		// tombaient alors sur son résidu.
		//
		// Le délai est donc porté à celui du serveur de la configuration, et aucune assertion n'est
		// retirée, relâchée ni contournée.
		test.setTimeout(120_000)
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

// =============================================================================================
// QUATRIÈME TRANCHE — la grille champ × étape des règles de visibilité
// @verifies docs/SPEC-workflow-engine.md §7 bis.11 (la grille), §7 bis.11.2 (les champs archivés
//           écartés, les cases par défaut), §7 bis.11.3 (l'`upsert` et la suppression),
//           §7 bis.11.4 (les quatre états, `visible` explicite non replié), §7 bis.11.6 (le vrai
//           `table`, et son défilement propre), §7 bis.11.8 (preuves attendues)
// @verifies docs/SPEC-form-composer.md §3.1 (l'absence de règle vaut `visible`), §5
// =============================================================================================
//
// LE SEED N'EST JAMAIS MODIFIÉ, et la règle est ici plus stricte qu'ailleurs : le seed **compte**
// ses quinze règles avant de reconstruire la copie du workflow. Chaque scénario règle donc les
// cases d'un champ QUI LUI APPARTIENT — clé préfixée `e2e-wf-` —, et son `finally` supprime ce
// champ : la cascade `ON DELETE CASCADE` de `form_field_rules` (§3.3 du composeur) emporte ses
// règles avec lui, et le seed retrouve exactement ses quinze.

const CHEMIN_REGLES = `${URL_API}/rest/v1/form_field_rules`

/** L'étape seedée `Perdu`, dernière du graphe, et `Prospection`, la première. */
const ETAPE_PERDU = '5eed0000-0000-4000-8000-000000000067'

/** La visibilité d'un couple en base, ou `null` si aucune règle ne le porte — la confirmation. */
async function regleEnBase(
	request: APIRequestContext,
	idChamp: string,
	idEtape: string,
): Promise<string | null> {
	const reponse = await request.get(
		`${CHEMIN_REGLES}?select=visibility&field_id=eq.${idChamp}&step_id=eq.${idEtape}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as readonly { visibility: string }[]
	return lignes[0]?.visibility ?? null
}

/** Crée le champ PROPRE à la preuve par la clé de service, et rend son identifiant. */
async function creerChampDePreuve(request: APIRequestContext, cle: string, libelle: string): Promise<string> {
	const reponse = await request.post(CHEMIN_CHAMPS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			workflow_id: WORKFLOW_DEFAUT,
			workspace_id: WORKSPACE,
			key: cle,
			label: libelle,
			type: 'text',
			options: {},
		},
	})
	expect(reponse.status(), 'création du champ de preuve').toBe(201)
	const lignes = (await reponse.json()) as readonly { id: string }[]
	const id = lignes[0]?.id
	expect(id).toBeTruthy()
	return id as string
}

/** Amène la grille à l'écran — quatrième bloc, sous les champs. */
async function ouvrirGrille(page: Page): Promise<void> {
	await page.getByTestId('grille-visibilites').scrollIntoViewIfNeeded()
	await expect(page.getByTestId('grille-visibilites')).toBeVisible()
}

/**
 * Confirme la pose d'une exigence depuis la grille — sixième tranche, §7 bis.13.4.
 *
 * ELLE ATTEND D'ABORD LA MESURE : cliquer avant que la prévisualisation ne soit rendue prouverait
 * seulement que le bouton existe, et laisserait passer une confirmation muette.
 */
async function confirmerExigence(page: Page): Promise<void> {
	await expect(page.getByTestId('confirmation-exigence-case')).toBeVisible()
	await expect(page.getByTestId('effets-case')).toBeVisible()
	await page.getByRole('button', { name: 'Exiger ce champ' }).click()
	await expect(page.getByTestId('confirmation-exigence-case')).toHaveCount(0)
}

/** La case d'un couple, désignée par la clé du champ et l'identifiant de l'étape. */
function caseDe(page: Page, cleChamp: string, idEtape: string): Locator {
	return page.locator(`[data-testid="case-visibilite"][data-champ="${cleChamp}"][data-etape="${idEtape}"]`)
}

test.describe('la grille champ × étape sur la vraie base (§7 bis.11)', () => {
	test('la grille montre les six champs actifs, les sept étapes, et les règles seedées', async ({
		page,
	}) => {
		await connecter(page)
		await ouvrirEditeur(page)
		await ouvrirGrille(page)

		// Six lignes, pas sept : le champ archivé du seed — `budget-previsionnel` — est écarté
		// (§7 bis.11.2), et la note le dit au lieu de laisser chercher une ligne absente.
		await expect(page.getByTestId('ligne-grille')).toHaveCount(6)
		await expect(page.getByTestId('grille-note-archives')).toContainText('Un champ archivé')
		await expect(page.getByTestId('case-visibilite')).toHaveCount(42)

		// Les trois états seedés, lus à l'écran : `hidden`, `required`, et le `visible` EXPLICITE
		// que le §7 bis.11.4 interdit de replier sur le défaut.
		await expect(caseDe(page, 'budget', '5eed0000-0000-4000-8000-000000000061')).toHaveValue('hidden')
		await expect(caseDe(page, 'budget', '5eed0000-0000-4000-8000-000000000063')).toHaveValue('required')
		await expect(caseDe(page, 'source', '5eed0000-0000-4000-8000-000000000062')).toHaveValue('visible')
		// Et un couple que le seed laisse sans règle : la case vaut le défaut.
		await expect(caseDe(page, 'source', '5eed0000-0000-4000-8000-000000000063')).toHaveValue('defaut')
	})

	test('un administrateur règle une case, la change, puis la rend au défaut', async ({
		page,
		request,
	}) => {
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-grille', 'E2E Grille Souris')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirGrille(page)

			const cellule = caseDe(page, 'e2e-wf-grille', ETAPE_PERDU)
			await expect(cellule).toHaveValue('defaut')
			expect(await regleEnBase(request, idChamp, ETAPE_PERDU)).toBeNull()

			// --- Régler : la règle n'existe pas encore, l'`upsert` insère ---------------------------
			// PREUVE RÉVISÉE PAR LA SIXIÈME TRANCHE, NON CONTOURNÉE (décision 390) : « Exigé » est le
			// seul des quatre états qui puisse bloquer une affaire, et il passe désormais par une
			// confirmation portant la prévisualisation (§7 bis.13.4). La règle prouvée — l'`upsert`
			// insère puis modifie le même couple — est inchangée ; seul le geste gagne une étape.
			await cellule.selectOption('required')
			await confirmerExigence(page)
			await expect
				.poll(async () => regleEnBase(request, idChamp, ETAPE_PERDU))
				.toBe('required')
			await expect(cellule).toHaveValue('required')

			// --- Changer : le MÊME geste sur un couple existant, que seul l'`upsert` accepte --------
			// Une insertion simple rendrait ici `409` / `23505` — mesuré le 2026-08-15 (§7 bis.11.3).
			await cellule.selectOption('hidden')
			await expect.poll(async () => regleEnBase(request, idChamp, ETAPE_PERDU)).toBe('hidden')

			// --- Rendre au défaut : la ligne DISPARAÎT, ce que l'affichage seul ne prouverait pas ---
			await cellule.selectOption('defaut')
			await expect.poll(async () => regleEnBase(request, idChamp, ETAPE_PERDU)).toBeNull()
			await expect(cellule).toHaveValue('defaut')
		} finally {
			await purgerChamps(request)
		}
	})

	test('les deux gestes se mènent au clavier seul', async ({ page, request }) => {
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-grille-clavier', 'E2E Grille Clavier')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirGrille(page)

			const cellule = caseDe(page, 'e2e-wf-grille-clavier', ETAPE_PERDU)
			await tabVers(page, cellule)
			await cellule.selectOption('required')
			// RÉVISÉE PAR LA SIXIÈME TRANCHE : la confirmation reçoit le focus, donc « Entrée »
			// suffit — le parcours reste mené au clavier SEUL, ce que cette preuve existe pour dire.
			await expect(page.getByRole('button', { name: 'Exiger ce champ' })).toBeFocused()
			await page.keyboard.press('Enter')
			await expect.poll(async () => regleEnBase(request, idChamp, ETAPE_PERDU)).toBe('required')

			await tabVers(page, cellule)
			await cellule.selectOption('defaut')
			await expect.poll(async () => regleEnBase(request, idChamp, ETAPE_PERDU)).toBeNull()
		} finally {
			await purgerChamps(request)
		}
	})

	test('le seed retrouve ses quinze règles après le passage des preuves', async ({ request }) => {
		// La cascade de `form_field_rules` emporte les règles d'un champ supprimé (§3.3 du composeur) :
		// c'est ce que ce contrôle vérifie, et non l'écran. Le seed compte ses règles avant de
		// reconstruire la copie du workflow — un résidu le ferait échouer à la prochaine application.
		const reponse = await request.get(
			`${CHEMIN_REGLES}?select=field_id&workflow_id=eq.${WORKFLOW_DEFAUT}`,
			{ headers: enTetesService() },
		)
		const lignes = (await reponse.json()) as readonly unknown[]
		expect(lignes).toHaveLength(15)
	})
})

test.describe('captures de la grille (CLAUDE.md §16)', () => {
	test('la grille est capturée, une case ouverte sur ses quatre états', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)
		await ouvrirGrille(page)
		await capturer(page, 'workflows-grille-1440', UNITE)
	})

	for (const palier of PALIERS) {
		test(`${palier.nom} : la grille défile dans son conteneur, la page non`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirGrille(page)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
			// §7 du design system : le tableau, LUI, défile — sept étapes ne tiennent pas sous 768 px.
			await capturer(page, `workflows-grille-${palier.nom}`, UNITE)
		})
	}
})

// =============================================================================================
// CINQUIÈME TRANCHE — les exigences propres à une transition
// @verifies docs/SPEC-workflow-engine.md §7 bis.12 (les exigences de transition), §7 bis.12.2
//           (l'union effective et ses origines, dont celle qui ne se retire pas ici),
//           §7 bis.12.3 (le `POST` simple, l'`upsert` étant refusé par la base),
//           §7 bis.12.4 (les choix écartés), §7 bis.12.5 (les refus), §7 bis.12.6 (disposition,
//           clavier), §7 bis.12.8 (preuves attendues)
// @verifies docs/SPEC-transition-required-fields.md §1 (l'union des deux ensembles), §5.1 (la
//           sixième garde de `move_card`)
// =============================================================================================
//
// LE SEED N'EST JAMAIS MODIFIÉ. Il porte DEUX liaisons — une globale et une dérivée — et les
// recompte à chaque application. Chaque scénario exige donc un champ QUI LUI APPARTIENT, préfixé
// `e2e-wf-`, sur une arête seedée ; son `finally` supprime le champ, et la cascade
// `ON DELETE CASCADE` de `workflow_transition_required_fields` emporte la liaison avec lui.

const CHEMIN_EXIGENCES = `${URL_API}/rest/v1/workflow_transition_required_fields`

/** L'arête seedée `Relancer` (Prospection → Relance), que le seed laisse SANS aucune exigence. */
const TRANSITION_RELANCER = '5eed0000-0000-4000-8000-000000000071'
const NOM_RELANCER = 'Transition Prospection vers Relance'

/** L'arête seedée `Démarrer la réalisation`, seule à porter une exigence dans le seed. */
const TRANSITION_REALISATION = '5eed0000-0000-4000-8000-000000000074'

/** Une liaison existe-t-elle en base ? La confirmation d'un geste d'écran, l'écran pouvant mentir. */
async function exigenceEnBase(
	request: APIRequestContext,
	idTransition: string,
	idChamp: string,
): Promise<boolean> {
	const reponse = await request.get(
		`${CHEMIN_EXIGENCES}?select=field_id&transition_id=eq.${idTransition}&field_id=eq.${idChamp}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as readonly unknown[]
	return lignes.length > 0
}

/** Amène le bloc des exigences à l'écran — cinquième bloc, sous la grille. */
async function ouvrirExigences(page: Page): Promise<void> {
	await page.getByTestId('liste-exigences').scrollIntoViewIfNeeded()
	await expect(page.getByTestId('liste-exigences')).toBeVisible()
}

/** Le bloc d'une arête, désigné par son identifiant. */
function blocExigences(page: Page, idTransition: string): Locator {
	return page.locator(`[data-testid="transition-exigences"][data-transition="${idTransition}"]`)
}

test.describe('les exigences de transition sur la vraie base (§7 bis.12)', () => {
	test('les exigences seedées sont rendues avec leur origine, règle comprise', async ({ page }) => {
		await connecter(page)
		await ouvrirEditeur(page)
		await ouvrirExigences(page)

		// Les onze arêtes du seed ont chacune leur bloc.
		await expect(page.getByTestId('transition-exigences')).toHaveCount(11)

		// `Démarrer la réalisation` porte la SEULE liaison explicite du workflow global — mesurée le
		// 2026-08-15 —, et l'étape d'arrivée `Réalisation` ne porte aucune règle `required` : son
		// unique exigence vient donc de la transition.
		const realisation = blocExigences(page, TRANSITION_REALISATION)
		const lienProposition = realisation.locator('[data-testid="ligne-exigence"][data-champ="lien-proposition"]')
		await expect(lienProposition).toHaveAttribute('data-origine', 'transition')

		// `Relancer` arrive sur `Relance`, que le seed laisse sans aucune règle `required` : aucune
		// exigence, et l'écran le DIT au lieu de laisser une liste vide.
		await expect(
			blocExigences(page, TRANSITION_RELANCER).getByTestId('transition-sans-exigence'),
		).toBeVisible()

		// L'union du §7 bis.12.2, prouvée sur une arête que le seed n'a pas liée : `Passer en
		// signature` arrive sur `Signature`, où TROIS champs portent `required` — mesuré. Aucune
		// liaison ne les déclare, et pourtant `move_card` les exige.
		const signature = blocExigences(page, '5eed0000-0000-4000-8000-000000000073')
		await expect(signature.getByTestId('ligne-exigence')).toHaveCount(3)
		for (const origine of await signature
			.getByTestId('ligne-exigence')
			.evaluateAll((lignes) => lignes.map((ligne) => ligne.getAttribute('data-origine')))) {
			expect(origine, 'une exigence venue de la seule règle').toBe('regle')
		}
	})

	test('une exigence venue d’une règle n’offre AUCUNE commande de retrait', async ({ page }) => {
		// Un `DELETE` sur une ligne qui n'existe pas rendrait `200` et zéro ligne, l'exigence restant
		// imposée par la sixième garde. L'écran renvoie à la grille plutôt que de le promettre.
		await connecter(page)
		await ouvrirEditeur(page)
		await ouvrirExigences(page)
		const signature = blocExigences(page, '5eed0000-0000-4000-8000-000000000073')
		const premiere = signature.getByTestId('ligne-exigence').first()
		await expect(premiere.getByRole('button')).toHaveCount(0)
		// La phrase qui renvoie à la grille est rendue UNE fois pour les trois exigences de cette
		// arête : répétée par ligne, elle apparaissait trois fois d'affilée (capture du 2026-08-15).
		await expect(signature.getByTestId('exigences-note-regle')).toHaveCount(1)
	})

	test('un administrateur exige un champ puis ne l’exige plus, à la souris', async ({
		page,
		request,
	}) => {
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-exigence', 'E2E Exigence Souris')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirExigences(page)

			const bloc = blocExigences(page, TRANSITION_RELANCER)
			expect(await exigenceEnBase(request, TRANSITION_RELANCER, idChamp)).toBe(false)

			// --- Exiger : un `POST` SIMPLE, l'`upsert` étant refusé faute de privilège `UPDATE` ----
			await bloc.getByRole('button', { name: 'Exiger un champ' }).click()
			const formulaire = page.getByTestId('formulaire-exigence')
			await formulaire.getByLabel('Champ à exiger').selectOption({ label: 'E2E Exigence Souris' })
			await formulaire.getByRole('button', { name: 'Exiger ce champ' }).click()
			await expect
				.poll(async () => exigenceEnBase(request, TRANSITION_RELANCER, idChamp))
				.toBe(true)

			// L'exigence apparaît, et son origine est bien la TRANSITION, pas une règle.
			const ligne = bloc.locator('[data-testid="ligne-exigence"][data-champ="e2e-wf-exigence"]')
			await expect(ligne).toHaveAttribute('data-origine', 'transition')

			// --- Ne plus exiger : la ligne DISPARAÎT de la base, ce que l'affichage ne prouve pas ---
			await ligne.getByRole('button').click()
			await page
				.getByTestId('confirmation-retrait-exigence')
				.getByRole('button', { name: 'Ne plus exiger' })
				.click()
			await expect
				.poll(async () => exigenceEnBase(request, TRANSITION_RELANCER, idChamp))
				.toBe(false)
			await expect(ligne).toHaveCount(0)
		} finally {
			await purgerChamps(request)
		}
	})

	test('un champ déjà exigé n’est plus proposé, et le champ archivé du seed jamais', async ({
		page,
		request,
	}) => {
		// §7 bis.12.4 : le premier serait refusé en `23505`, le second produirait une liaison sans
		// effet — les deux mesurés le 2026-08-15.
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-choix', 'E2E Exigence Choix')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirExigences(page)

			const bloc = blocExigences(page, TRANSITION_RELANCER)
			await bloc.getByRole('button', { name: 'Exiger un champ' }).click()
			const liste = page.getByTestId('formulaire-exigence').getByLabel('Champ à exiger')
			const avant = await liste.locator('option').allTextContents()
			expect(avant, 'le champ de preuve est proposé').toContain('E2E Exigence Choix')
			expect(avant, 'le champ ARCHIVÉ du seed ne l’est jamais').not.toContain(
				'Budget prévisionnel',
			)

			await liste.selectOption({ label: 'E2E Exigence Choix' })
			await page.getByTestId('formulaire-exigence').getByRole('button', { name: 'Exiger ce champ' }).click()
			await expect.poll(async () => exigenceEnBase(request, TRANSITION_RELANCER, idChamp)).toBe(true)

			// Rouvert, le formulaire ne propose plus le champ qui vient d'être lié.
			await bloc.getByRole('button', { name: 'Exiger un champ' }).click()
			const apres = await page
				.getByTestId('formulaire-exigence')
				.getByLabel('Champ à exiger')
				.locator('option')
				.allTextContents()
			expect(apres).not.toContain('E2E Exigence Choix')
		} finally {
			await purgerChamps(request)
		}
	})

	test('une exigence déclarée entre-temps par un autre administrateur est refusée par la base', async ({
		page,
		request,
	}) => {
		// LE REFUS EST OBTENU PAR UNE COURSE RÉELLE, jamais simulé : la clé de service déclare la
		// même liaison pendant que le formulaire est ouvert. C'est exactement le `23505` que
		// l'`upsert` de la quatrième tranche évitait et que celle-ci ne PEUT PAS éviter (§7 bis.12.3).
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-course', 'E2E Exigence Course')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirExigences(page)

			const bloc = blocExigences(page, TRANSITION_RELANCER)
			await bloc.getByRole('button', { name: 'Exiger un champ' }).click()
			const formulaire = page.getByTestId('formulaire-exigence')
			await formulaire.getByLabel('Champ à exiger').selectOption({ label: 'E2E Exigence Course' })

			// Le second administrateur passe devant.
			const course = await request.post(CHEMIN_EXIGENCES, {
				headers: enTetesService(),
				data: { transition_id: TRANSITION_RELANCER, field_id: idChamp },
			})
			expect(course.status(), 'la course est réellement gagnée par l’autre écriture').toBe(201)

			await formulaire.getByRole('button', { name: 'Exiger ce champ' }).click()
			await expect(page.getByTestId('workflows-refus')).toContainText('déjà exigé')
			// Le `409` est le refus ATTENDU de cette course, et non une anomalie : il est déclaré
			// comme dans le scénario jumeau des arêtes, jamais toléré globalement.
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])

			// L'écran RECHARGE malgré le refus : l'état voulu est celui que la base porte déjà, et le
			// laisser invisible rendrait le refus incompréhensible (§7 bis.12.3).
			await expect(
				bloc.locator('[data-testid="ligne-exigence"][data-champ="e2e-wf-course"]'),
			).toBeVisible()
			expect(await exigenceEnBase(request, TRANSITION_RELANCER, idChamp)).toBe(true)
		} finally {
			await purgerChamps(request)
		}
	})

	test('les deux gestes se mènent au clavier seul', async ({ page, request }) => {
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-exig-clavier', 'E2E Exigence Clavier')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirExigences(page)

			const bloc = blocExigences(page, TRANSITION_RELANCER)
			const ouvrir = bloc.getByRole('button', { name: 'Exiger un champ' })
			await tabVers(page, ouvrir)
			await page.keyboard.press('Enter')

			const formulaire = page.getByTestId('formulaire-exigence')
			// Le focus entre dans la liste à l'ouverture (§7 bis.12.6).
			await expect(formulaire.getByLabel('Champ à exiger')).toBeFocused()
			await formulaire.getByLabel('Champ à exiger').selectOption({ label: 'E2E Exigence Clavier' })
			const exiger = formulaire.getByRole('button', { name: 'Exiger ce champ' })
			await tabVers(page, exiger)
			await page.keyboard.press('Enter')
			await expect.poll(async () => exigenceEnBase(request, TRANSITION_RELANCER, idChamp)).toBe(true)

			const ligne = bloc.locator('[data-testid="ligne-exigence"][data-champ="e2e-wf-exig-clavier"]')
			await tabVers(page, ligne.getByRole('button'))
			await page.keyboard.press('Enter')
			const confirmer = page
				.getByTestId('confirmation-retrait-exigence')
				.getByRole('button', { name: 'Ne plus exiger' })
			await tabVers(page, confirmer)
			await page.keyboard.press('Enter')
			await expect.poll(async () => exigenceEnBase(request, TRANSITION_RELANCER, idChamp)).toBe(false)
		} finally {
			await purgerChamps(request)
		}
	})

	test('une liaison vers un champ archivé est NOMMÉE sans effet, et n’est pas supprimée', async ({
		page,
		request,
	}) => {
		// MESURÉ le 2026-08-15 : la base ACCEPTE la liaison (`201`), mais `move_card` filtre
		// `archived_at is null` — elle ne produit aucun effet (§7 bis.12.4).
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-archive', 'E2E Exigence Archivée')
		try {
			const pose = await request.post(CHEMIN_EXIGENCES, {
				headers: enTetesService(),
				data: { transition_id: TRANSITION_RELANCER, field_id: idChamp },
			})
			expect(pose.status()).toBe(201)
			const archivage = await request.patch(`${CHEMIN_CHAMPS}?id=eq.${idChamp}`, {
				headers: enTetesService(),
				data: { archived_at: '2026-08-15T10:00:00Z' },
			})
			expect(archivage.status()).toBe(204)

			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirExigences(page)

			const bloc = blocExigences(page, TRANSITION_RELANCER)
			// Elle n'est PAS comptée comme exigence effective…
			await expect(
				bloc.locator('[data-testid="ligne-exigence"][data-champ="e2e-wf-archive"]'),
			).toHaveCount(0)
			// … et elle est nommée plutôt que tue.
			await expect(bloc.getByTestId('exigences-sans-effet')).toContainText('sans effet')
			// La liaison reste en base : elle redevient effective à la restauration du champ.
			expect(await exigenceEnBase(request, TRANSITION_RELANCER, idChamp)).toBe(true)
		} finally {
			await purgerChamps(request)
		}
	})

	test('le seed retrouve ses deux liaisons après le passage des preuves', async ({ request }) => {
		// La cascade emporte les liaisons d'un champ supprimé : c'est ce que ce contrôle vérifie, et
		// non l'écran. Un résidu ferait échouer la prochaine application du seed.
		const reponse = await request.get(`${CHEMIN_EXIGENCES}?select=field_id`, {
			headers: enTetesService(),
		})
		const lignes = (await reponse.json()) as readonly unknown[]
		expect(lignes).toHaveLength(2)
	})
})

// ---------------------------------------------------------------------------------------------
// §7 bis.13 — La prévisualisation des effets, sur la vraie base
// ---------------------------------------------------------------------------------------------
//
// LES NOMBRES ATTENDUS SONT MESURÉS, PAS DEVINÉS. Un champ créé par la preuve n'a de valeur sur
// AUCUNE affaire : toute affaire lui est donc « vide », et les comptes sont ceux des affaires du
// seed. MESURÉ sur la pile le 2026-08-15 pour l'étape `Perdu` : **1** affaire sur place et **9** à
// l'entrée ; pour l'arête `Prospection → Relance` : **4**.
//
// CES NOMBRES SONT LIÉS AU SEED, et c'est voulu : ils tomberaient si le seed changeait, et c'est
// précisément ce qu'une preuve de prévisualisation doit détecter. Une assertion qui se serait
// contentée de « un nombre est affiché » aurait été verte sur un compte faux.

test.describe('la prévisualisation des effets sur la vraie base (§7 bis.13)', () => {
	test('régler une case sur « Exigé » N’ÉCRIT RIEN, et annonce les deux effets mesurés', async ({
		page,
		request,
	}) => {
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-previs', 'E2E Prévisualisation')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirGrille(page)

			const cellule = caseDe(page, 'e2e-wf-previs', ETAPE_PERDU)
			await cellule.selectOption('required')

			// La confirmation porte les DEUX nombres — un seul aurait annoncé « aucun effet » sur les
			// étapes où l'autre effet existe (§7 bis.13.1).
			const effets = page.getByTestId('effets-case')
			await expect(effets).toContainText('1 affaire est déjà à cette étape')
			// DIX DEPUIS LA CINQUIÈME TRANCHE DE `CRM-077` : l'affaire `…0cf` du seed occupe
			// `Négociation` (docs/SPEC-seed.md §10.4 bis), d'où part une arête vers `Perdu`. Le
			// compte mesuré grandit d'une unité parce que le jeu de démonstration porte une affaire
			// de plus, et non parce que la règle a changé.
			// TRENTE DEPUIS `CRM-046` TRANCHE 2 (`docs/SPEC-seed.md` §9.11) : les vingt-six
			// cards de volume vivent sur des étapes d'où partent des arêtes vers `Perdu`. Le
			// compte suit la donnée, la propriété — deux nombres annoncés, non un seul — est
			// intacte.
			await expect(effets).toContainText('30 affaires ne pourront plus entrer')

			// RIEN N'EST ÉCRIT tant que la confirmation n'est pas acceptée : c'est la propriété que
			// l'écran seul ne prouverait pas, et la base la tranche.
			expect(await regleEnBase(request, idChamp, ETAPE_PERDU)).toBeNull()
			// La case montre le choix en cours, pas l'état enregistré.
			await expect(cellule).toHaveValue('required')
		} finally {
			await purgerChamps(request)
		}
	})

	test('renoncer rend la case à sa valeur enregistrée, et la base reste intacte', async ({
		page,
		request,
	}) => {
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-renonce', 'E2E Renoncement')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirGrille(page)

			const cellule = caseDe(page, 'e2e-wf-renonce', ETAPE_PERDU)
			await cellule.selectOption('required')
			await expect(page.getByTestId('confirmation-exigence-case')).toBeVisible()
			await page.getByRole('button', { name: 'Annuler' }).click()

			await expect(page.getByTestId('confirmation-exigence-case')).toHaveCount(0)
			await expect(cellule).toHaveValue('defaut')
			// L'ABSENCE DE LIGNE est la seule preuve du renoncement : l'affichage, lui, pourrait mentir.
			expect(await regleEnBase(request, idChamp, ETAPE_PERDU)).toBeNull()
		} finally {
			await purgerChamps(request)
		}
	})

	test('le formulaire d’exigence d’une transition annonce son compte, mesuré sur le chemin', async ({
		page,
		request,
	}) => {
		await purgerChamps(request)
		await creerChampDePreuve(request, 'e2e-wf-previs-arete', 'E2E Prévisualisation Arête')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirExigences(page)

			await blocExigences(page, TRANSITION_RELANCER)
				.getByRole('button', { name: 'Exiger un champ' })
				.click()
			const formulaire = page.getByTestId('formulaire-exigence')
			await expect(formulaire).toBeVisible()
			await formulaire.getByLabel('Champ à exiger').selectOption({ label: 'E2E Prévisualisation Arête' })

			// La phrase d'une TRANSITION parle du chemin, pas de l'étape : une exigence d'arête ne
			// bloque que ce chemin-là (§7 bis.13.4).
			const effets = page.getByTestId('effets-exigence')
			await expect(effets).toContainText('11 affaires ne pourront plus emprunter ce chemin')
		} finally {
			await purgerChamps(request)
		}
	})

	test('une exigence sans effet le DIT en toutes lettres, jamais par un silence', async ({
		page,
		request,
	}) => {
		// `Prospection` est l'étape initiale : AUCUNE arête n'y mène, donc rien à l'entrée. Et le
		// champ de preuve est posé sur une étape que le seed laisse vide d'affaires — `Signature`
		// n'en porte aucune —, donc rien sur place non plus. MESURÉ le 2026-08-15.
		await purgerChamps(request)
		await creerChampDePreuve(request, 'e2e-wf-sans-effet', 'E2E Sans Effet')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirGrille(page)

			const cellule = caseDe(page, 'e2e-wf-sans-effet', ETAPE_INITIALE_SEED)
			await cellule.selectOption('required')
			const effets = page.getByTestId('effets-case')
			// `Prospection` porte ONZE affaires depuis `CRM-046` §9.11 : elles sont « sur place »,
			// et rien à l'entrée — l'étape initiale n'a aucune arête entrante.
			await expect(effets).toContainText('11 affaires sont déjà à cette étape')
			await expect(effets).not.toContainText('ne pourront plus entrer')
		} finally {
			await purgerChamps(request)
		}
	})

	test('confirmer écrit la règle, et le seed retrouve ses quinze règles après purge', async ({
		page,
		request,
	}) => {
		await purgerChamps(request)
		const idChamp = await creerChampDePreuve(request, 'e2e-wf-confirme', 'E2E Confirmation')
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirGrille(page)

			const cellule = caseDe(page, 'e2e-wf-confirme', ETAPE_PERDU)
			await cellule.selectOption('required')
			await confirmerExigence(page)
			await expect.poll(async () => regleEnBase(request, idChamp, ETAPE_PERDU)).toBe('required')
		} finally {
			await purgerChamps(request)
		}
		// La cascade emporte la règle avec le champ : le seed doit retrouver ses quinze.
		const reponse = await request.get(
			`${CHEMIN_REGLES}?select=field_id&workflow_id=eq.${WORKFLOW_DEFAUT}`,
			{ headers: enTetesService() },
		)
		expect((await reponse.json()) as readonly unknown[]).toHaveLength(15)
	})
})

test.describe('captures de la prévisualisation (CLAUDE.md §16)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la confirmation d’une exigence reste lisible, sans débordement`, async ({
			page,
			request,
		}) => {
			await purgerChamps(request)
			await creerChampDePreuve(request, 'e2e-wf-capture-previs', 'E2E Capture Prévisualisation')
			try {
				await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
				await connecter(page)
				await ouvrirEditeur(page)
				await ouvrirGrille(page)
				await caseDe(page, 'e2e-wf-capture-previs', ETAPE_PERDU).selectOption('required')
				await expect(page.getByTestId('effets-case')).toBeVisible()
				const debordement = await page.evaluate(
					() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
				)
				expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
				await capturer(page, `workflows-previsualisation-${palier.nom}`, UNITE)
			} finally {
				await purgerChamps(request)
			}
		})
	}
})

test.describe('captures des exigences de transition (CLAUDE.md §16)', () => {
	test('le formulaire d’ajout ouvert est capturé', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)
		await ouvrirExigences(page)
		await blocExigences(page, TRANSITION_RELANCER)
			.getByRole('button', { name: 'Exiger un champ' })
			.click()
		await expect(page.getByTestId('formulaire-exigence')).toBeVisible()
		await capturer(page, 'workflows-exigences-formulaire-1440', UNITE)
	})

	for (const palier of PALIERS) {
		test(`${palier.nom} : le bloc des exigences reste lisible, sans débordement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			await ouvrirEditeur(page)
			await ouvrirExigences(page)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
			await capturer(page, `workflows-exigences-${palier.nom}`, UNITE)
		})
	}
})

// ---------------------------------------------------------------------------------------------
// La création d'un workflow — CRM-031, docs/SPEC-workflow-engine.md §3 bis
// ---------------------------------------------------------------------------------------------
//
// @verifies CRM-031 (docs/BACKLOG.md) — création d'un workflow depuis l'éditeur d'administration
// @verifies docs/SPEC-workflow-engine.md §3 bis.2 (où le geste se trouve), §3 bis.3 (les trois
//           champs et la lecture 4), §3 bis.4 (validation de forme), §3 bis.6 (les trois effets
//           d'un succès), §3 bis.8 (preuves attendues, niveaux interface et visuel), §3.5 (le
//           brouillon : un workflow neuf n'a aucune étape)
// @verifies docs/DESIGN_SYSTEM.md §5.15 (le sélecteur de track absent, la liste relue), §7
//           (paliers), §8 (accessibilité clavier)
//
// LE GESTE EST JOUÉ DEUX FOIS — à la souris, puis entièrement au clavier —, et la ligne créée est
// CONFIRMÉE EN BASE par une lecture de service : l'écran peut mentir, la table non.
//
// CHAQUE SCÉNARIO PURGE CE QU'IL A DÉPOSÉ, dans son `finally`, sous un nom préfixé
// `e2e-workflow-` (règle d'INC-099 et décision 362). Sans cette purge, deux workflows résiduels
// rendraient rouges les assertions de compte de `supabase/tests/0007_workflows.test.sql` et la
// première assertion de `W0` de `e2e/api/workflows.spec.ts`, qui comptent ce que le seed pose.

const CHEMIN_WORKFLOWS = `${URL_API}/rest/v1/workflows`
const NOM_CREE = 'e2e-workflow-cree'
const NOM_CREE_CLAVIER = 'e2e-workflow-clavier'

/** Lit le workflow créé par son nom, avec la clé de service — la confirmation du geste d'écran. */
async function workflowEnBase(
	request: APIRequestContext,
	nom: string,
): Promise<{ id: string; scope: string; track_id: string | null; is_default: boolean } | null> {
	const reponse = await request.get(
		`${CHEMIN_WORKFLOWS}?select=id,scope,track_id,is_default&name=eq.${encodeURIComponent(nom)}`,
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as readonly {
		id: string
		scope: string
		track_id: string | null
		is_default: boolean
	}[]
	return lignes[0] ?? null
}

async function purgerWorkflow(request: APIRequestContext, nom: string): Promise<void> {
	await request.delete(`${CHEMIN_WORKFLOWS}?name=eq.${encodeURIComponent(nom)}`, {
		headers: enTetesService(),
	})
}

test.describe('CRM-031 — créer un workflow depuis l’éditeur (§3 bis)', () => {
	test('à la souris : le workflow est créé, choisi, et son bloc d’étapes est VIDE', async ({
		page,
		request,
	}) => {
		try {
			await connecter(page)
			await ouvrirEditeur(page)

			await page.getByRole('button', { name: 'Nouveau workflow' }).click()
			const formulaire = page.getByTestId('workflows-formulaire-creation')
			await expect(formulaire).toBeVisible()
			// Le sélecteur de track est ABSENT sous la portée globale, non grisé (§5.15).
			await expect(formulaire.getByLabel('Track')).toHaveCount(0)

			await formulaire.getByLabel('Nom').fill(NOM_CREE)
			await formulaire.getByRole('button', { name: 'Créer' }).click()

			// Effet 1 et 2 du §3 bis.6 : la liste est relue, et le workflow créé devient le choisi.
			await expect(formulaire).toBeHidden()
			await expect(page.getByRole('button', { name: new RegExp(NOM_CREE) })).toHaveAttribute(
				'aria-current',
				'true',
			)
			// Le brouillon du §3.5, MONTRÉ plutôt que raconté : il naît sans aucune étape.
			await expect(page.getByText("Ce workflow n'a aucune étape.")).toBeVisible()

			const enBase = await workflowEnBase(request, NOM_CREE)
			expect(enBase, 'la ligne existe réellement en base').not.toBeNull()
			expect(enBase?.scope).toBe('global')
			expect(enBase?.track_id).toBeNull()
			expect(enBase?.is_default).toBe(false)

			await capturer(page, 'workflows-creation-succes-1440', 'CRM-031')
		} finally {
			await purgerWorkflow(request, NOM_CREE)
		}
	})

	test('la portée « Propre à un track » fait APPARAÎTRE le sélecteur, et le track part avec', async ({
		page,
		request,
	}) => {
		try {
			await connecter(page)
			await ouvrirEditeur(page)
			await page.getByRole('button', { name: 'Nouveau workflow' }).click()
			const formulaire = page.getByTestId('workflows-formulaire-creation')

			await formulaire.getByLabel('Nom').fill(NOM_CREE)
			await expect(formulaire.getByLabel('Track')).toHaveCount(0)
			await formulaire.getByLabel('Portée').selectOption('track')
			const track = formulaire.getByLabel('Track')
			await expect(track).toBeVisible()

			// La commande reste éteinte tant qu'aucun track n'est choisi — §3 bis.4, seconde condition.
			await expect(formulaire.getByRole('button', { name: 'Créer' })).toBeDisabled()
			await capturer(page, 'workflows-creation-portee-track-1440', 'CRM-031')

			await track.selectOption({ label: 'Conseil & IA' })
			await expect(formulaire.getByRole('button', { name: 'Créer' })).toBeEnabled()
			await formulaire.getByRole('button', { name: 'Créer' }).click()

			await expect(formulaire).toBeHidden()
			const enBase = await workflowEnBase(request, NOM_CREE)
			expect(enBase?.scope).toBe('track')
			expect(enBase?.track_id).toBe('5eed0000-0000-4000-8000-000000000021')
		} finally {
			await purgerWorkflow(request, NOM_CREE)
		}
	})

	test('entièrement au clavier : focus atteint par Tab, jamais par focus()', async ({
		page,
		request,
	}) => {
		try {
			await connecter(page)
			await ouvrirEditeur(page)

			const commande = page.getByRole('button', { name: 'Nouveau workflow' })
			await tabVers(page, commande)
			await page.keyboard.press('Enter')

			const formulaire = page.getByTestId('workflows-formulaire-creation')
			await expect(formulaire).toBeVisible()
			// Le focus ENTRE dans le premier champ à l'ouverture (§3 bis.7) : la frappe suivante y
			// va sans qu'aucun `Tab` ne soit nécessaire, et c'est ce que cette ligne mesure.
			await expect(formulaire.getByLabel('Nom')).toBeFocused()
			await page.keyboard.type(NOM_CREE_CLAVIER)

			await tabVers(page, formulaire.getByRole('button', { name: 'Créer' }))
			await page.keyboard.press('Enter')

			await expect(formulaire).toBeHidden()
			const enBase = await workflowEnBase(request, NOM_CREE_CLAVIER)
			expect(enBase, 'la ligne créée au clavier existe en base').not.toBeNull()
		} finally {
			await purgerWorkflow(request, NOM_CREE_CLAVIER)
		}
	})

	for (const palier of PALIERS) {
		test(`${palier.nom} : le formulaire de création tient, sans débordement`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			await ouvrirEditeur(page)
			await page.getByRole('button', { name: 'Nouveau workflow' }).click()
			await expect(page.getByTestId('workflows-formulaire-creation')).toBeVisible()
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
			await capturer(page, `workflows-creation-${palier.nom}`, 'CRM-031')
		})
	}
})

// -------------------------------------------------------------------------------------------
// La mention de divergence — `CRM-032`, docs/SPEC-workflow-engine.md §4 bis
// @verifies CRM-032 (docs/BACKLOG.md) — mention de divergence visible dans l'interface
// @verifies docs/SPEC-workflow-engine.md §4 bis.2 (où elle est, et le cas normal muet),
//           §4 bis.4 (les trois phrases), §4 bis.8 (preuves attendues, niveaux E2E et visuel),
//           §4.6 (le verdict vient de l'empreinte de composition)
// @verifies docs/DESIGN_SYSTEM.md §5.15 (la mention de divergence)
// -------------------------------------------------------------------------------------------
//
// LA DIVERGENCE EST PROVOQUÉE POUR DE VRAI, PUIS DÉFAITE. Le seed livre une copie **à jour** — sa
// mention dit donc « la source n'a pas changé ». Pour éprouver l'autre état, la preuve modifie la
// SOURCE par la clé de service, recharge l'écran, constate la phrase, puis restaure exactement la
// valeur d'origine et vérifie que le signal s'éteint. C'est la règle d'INC-099 : la preuve rend la
// table dans l'état où elle l'a trouvée. Et c'est aussi ce qui rend la réversibilité du signal
// observable, fait mesuré au §4 bis.4.

const COPIE_SEED = 'Cycle commercial — Conseil IA'
const CHEMIN_DERIVATIONS = `${URL_API}/rest/v1/workflow_derivations`

/** Choisit un workflow dans la liste de gauche et attend que son graphe soit rendu. */
async function choisirWorkflow(page: Page, nom: string): Promise<void> {
	await page.getByRole('button', { name: new RegExp(nom) }).click()
	await expect(page.getByRole('button', { name: new RegExp(nom) })).toHaveAttribute(
		'aria-current',
		'true',
	)
	await expect(page.getByTestId('ligne-etape').first()).toBeVisible()
}

test.describe('la mention de divergence (§4 bis)', () => {
	test('la copie du seed porte son origine, le workflow source n’en porte aucune', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)

		// Le workflow par défaut n'est la copie de personne : AUCUNE mention, pas même un vide nommé.
		await expect(page.getByTestId('mention-divergence')).toHaveCount(0)
		await expect(page.getByTestId('mention-divergence-erreur')).toHaveCount(0)

		await choisirWorkflow(page, COPIE_SEED)
		const mention = page.getByTestId('mention-divergence')
		await expect(mention).toBeVisible()
		await expect(mention).toContainText('Ce workflow dérive de « Cycle commercial standard ».')
		await expect(mention).toContainText("La source n'a pas changé depuis la copie du")
		await expect(mention).toHaveAttribute('data-divergente', 'non')
		await capturer(page, 'divergence-a-jour-1440', 'CRM-032')
	})

	test('modifier la source allume la mention, la restaurer l’éteint', async ({ page, request }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)
		await choisirWorkflow(page, COPIE_SEED)
		await expect(page.getByTestId('mention-divergence')).toHaveAttribute('data-divergente', 'non')

		try {
			// La SOURCE est modifiée, jamais la copie : c'est le sens même du signal.
			const mutation = await request.patch(`${CHEMIN_ETAPES}?id=eq.${ETAPE_INITIALE_SEED}`, {
				headers: enTetesService(),
				data: { label_override: 'Sonde de divergence' },
			})
			expect(mutation.status(), 'surcharge posée sur une étape de la source').toBe(204)

			await page.reload()
			await choisirWorkflow(page, COPIE_SEED)
			const mention = page.getByTestId('mention-divergence')
			await expect(mention).toHaveAttribute('data-divergente', 'oui')
			await expect(mention).toContainText('La source a changé depuis la copie du')
			await expect(mention).toContainText('ne sont pas reportées automatiquement')
			// GARDE-FOU RÉVISÉ le 2026-08-16, mécanisme de la décision 51. Cette ligne exigeait
			// ZÉRO bouton, et elle avait raison quand elle a été écrite : aucune fonction ne savait
			// alors comparer une copie à sa source vivante. `compare_workflow_with_source` est
			// livrée depuis le §4 ter, et son geste d'interface au §4 quater. Ce qui reste vérifié
			// est la partie qui n'en a jamais dépendu : aucune commande d'ÉCRITURE, aucun lien.
			await expect(mention.getByRole('button')).toHaveCount(1)
			await expect(mention.getByTestId('comparer-source')).toBeVisible()
			await expect(mention.getByRole('link')).toHaveCount(0)
			await capturer(page, 'divergence-signalee-1440', 'CRM-032')
		} finally {
			const restauration = await request.patch(`${CHEMIN_ETAPES}?id=eq.${ETAPE_INITIALE_SEED}`, {
				headers: enTetesService(),
				data: { label_override: null },
			})
			expect(restauration.status(), 'la source est rendue à son état seedé').toBe(204)
		}

		// L'empreinte redevient identique : le signal s'éteint, et l'écran le montre (§4 bis.4).
		const apres = await request.get(
			`${CHEMIN_DERIVATIONS}?select=source_modified_since_copy&name=eq.${encodeURIComponent(COPIE_SEED)}`,
			{ headers: enTetesService() },
		)
		expect(apres.status()).toBe(200)
		expect((await apres.json())[0]?.source_modified_since_copy).toBe(false)
		await page.reload()
		await choisirWorkflow(page, COPIE_SEED)
		await expect(page.getByTestId('mention-divergence')).toHaveAttribute('data-divergente', 'non')
	})

	test('la mention tient au palier étroit, sans débordement', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await connecter(page)
		await ouvrirEditeur(page)
		await choisirWorkflow(page, COPIE_SEED)
		await expect(page.getByTestId('mention-divergence')).toBeVisible()
		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
		)
		expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
		await capturer(page, 'divergence-a-jour-390', 'CRM-032')
	})
})

// -------------------------------------------------------------------------------------------
// Le geste « comparer à la source » — `CRM-032`, docs/SPEC-workflow-engine.md §4 quater
// @verifies CRM-032 (docs/BACKLOG.md) — geste d'interface de la comparaison copie ↔ source
// @verifies docs/SPEC-workflow-engine.md §4 quater.2 (où le geste se trouve, et l'absence de
//           commande sur un workflow sans origine), §4 quater.3 (lecture 10 sur pression),
//           §4 quater.4 (les trois états, les cinq collections, l'en-tête écrit),
//           §4 quater.9 (preuves attendues, niveaux E2E et visuel)
// @verifies docs/DESIGN_SYSTEM.md §5.15 (la commande vit dans la mention), §7 (paliers)
// -------------------------------------------------------------------------------------------
//
// L'ÉCART EST PROVOQUÉ POUR DE VRAI, PUIS DÉFAIT, comme celui de la mention. Le seed livre une
// copie IDENTIQUE à sa source — la comparaison rend donc « identique », ce qui est le cas normal et
// ne prouverait rien seul. La preuve dégrade ensuite **la copie** par la clé de service, recompare
// par l'écran, constate l'écart NOMMÉ avec son attribut et ses deux valeurs, puis restaure
// exactement la valeur d'origine et constate le retour à l'identique. Règle d'INC-099 : la table
// est rendue dans l'état où elle a été trouvée.
//
// LA COPIE EST DÉGRADÉE ICI, ET NON LA SOURCE — c'est la différence avec la preuve de la mention
// juste au-dessus, et elle est voulue : le §4 ter.7 pose que les deux questions sont distinctes.
// Dégrader la copie laisse `source_modified_since_copy` à `false` et fait pourtant diverger la
// comparaison, ce qui éprouve la règle du §4 quater.2 — la commande est offerte même quand la
// mention dit que la source n'a pas changé.

test.describe('le geste « comparer à la source » (§4 quater)', () => {
	/** L'étape de la COPIE dont la position sera dégradée, retrouvée par son lignage. */
	async function etapeDeLaCopie(
		request: APIRequestContext,
	): Promise<{ id: string; position: number }> {
		const copies = await request.get(
			`${URL_API}/rest/v1/workflows?select=id&name=eq.${encodeURIComponent(COPIE_SEED)}`,
			{ headers: enTetesService() },
		)
		expect(copies.status()).toBe(200)
		const idCopie = (await copies.json())[0]?.id as string
		expect(idCopie, 'la copie du seed est présente').toBeTruthy()

		const etapes = await request.get(
			`${CHEMIN_ETAPES}?select=id,position&workflow_id=eq.${idCopie}&order=position&limit=1`,
			{ headers: enTetesService() },
		)
		expect(etapes.status()).toBe(200)
		const premiere = (await etapes.json())[0] as { id: string; position: number }
		expect(premiere, 'la copie porte au moins une étape').toBeTruthy()
		return premiere
	}

	test('la copie du seed se compare à sa source et se déclare identique', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)

		// Le workflow par défaut n'est la copie de personne : AUCUNE commande (§4 quater.2). C'est ce
		// qui rend le refus n° 3 du §4 ter.5 inatteignable depuis l'écran.
		await expect(page.getByTestId('comparer-source')).toHaveCount(0)

		await choisirWorkflow(page, COPIE_SEED)
		const bouton = page.getByTestId('comparer-source')
		await expect(bouton).toBeVisible()
		// La commande vit DANS la mention, et n'ouvre pas de bloc à elle (§4 quater.2).
		await expect(page.getByTestId('mention-divergence').getByTestId('comparer-source')).toBeVisible()

		await bouton.click()
		await expect(page.getByTestId('comparaison-source-identique')).toContainText(
			'Cette copie est identique à sa source.',
		)
		// Identique : les cinq collections ne sont pas déroulées, il n'y a rien à parcourir.
		await expect(page.getByTestId('comparaison-source-collections')).toHaveCount(0)
		// L'en-tête non comparé est ÉCRIT, jamais tu (§4 quater.4).
		await expect(page.getByTestId('comparaison-source-entete')).toContainText(
			'Le nom, la portée et le track ne sont pas comparés',
		)
		await capturer(page, 'comparaison-source-identique-1440', 'CRM-032')
	})

	test('dégrader la copie fait apparaître l’écart nommé, le restaurer le fait disparaître', async ({
		page,
		request,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		const etape = await etapeDeLaCopie(request)

		await connecter(page)
		await ouvrirEditeur(page)
		await choisirWorkflow(page, COPIE_SEED)
		await page.getByTestId('comparer-source').click()
		await expect(page.getByTestId('comparaison-source-identique')).toBeVisible()

		try {
			const mutation = await request.patch(`${CHEMIN_ETAPES}?id=eq.${etape.id}`, {
				headers: enTetesService(),
				data: { position: 42 },
			})
			expect(mutation.status(), 'la position est déplacée dans la COPIE').toBe(204)

			await page.reload()
			await choisirWorkflow(page, COPIE_SEED)
			// La mention dit toujours que la SOURCE n'a pas changé — et pourtant la copie diverge.
			// C'est exactement le cas que le §4 quater.2 refuse de cacher.
			await expect(page.getByTestId('mention-divergence')).toHaveAttribute(
				'data-divergente',
				'non',
			)

			await page.getByTestId('comparer-source').click()
			const resultat = page.getByTestId('comparaison-source-resultat')
			await expect(resultat).toBeVisible()
			await expect(page.getByTestId('comparaison-source-resume')).toContainText('1 modification(s)')

			// L'écart est NOMMÉ : la collection, l'attribut, et les deux valeurs.
			const collections = page.getByTestId('comparaison-source-collections')
			await expect(collections).toContainText('Étapes')
			await expect(collections).toContainText('position')
			await expect(collections).toContainText('42')
			// L'en-tête n'est jamais une collection rendue (§4 ter.3).
			await expect(collections.getByRole('heading', { name: 'Workflow', exact: true })).toHaveCount(0)
			await capturer(page, 'comparaison-source-divergente-1440', 'CRM-032')
		} finally {
			const restauration = await request.patch(`${CHEMIN_ETAPES}?id=eq.${etape.id}`, {
				headers: enTetesService(),
				data: { position: etape.position },
			})
			expect(restauration.status(), 'la copie est rendue à son état seedé').toBe(204)
		}

		// Restaurée, la copie redevient identique : l'écart n'était pas une fatalité d'affichage.
		await page.reload()
		await choisirWorkflow(page, COPIE_SEED)
		await page.getByTestId('comparer-source').click()
		await expect(page.getByTestId('comparaison-source-identique')).toBeVisible()
	})

	test('un geste de l’éditeur EFFACE le résultat, qui décrirait sinon un état périmé', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		await ouvrirEditeur(page)
		await choisirWorkflow(page, COPIE_SEED)
		await page.getByTestId('comparer-source').click()
		await expect(page.getByTestId('comparaison-source-identique')).toBeVisible()

		// Changer de workflow suffit : le résultat ne décrit plus le workflow affiché.
		//
		// LE CHOIX EST SCOPÉ À LA LISTE DE GAUCHE, et ce n'est pas un détail de sélecteur : depuis
		// le §4 quater, l'`aria-label` de la commande nomme la SOURCE (« Comparer ce workflow à sa
		// source « Cycle commercial standard » »), de sorte qu'un sélecteur global sur ce nom
		// désigne désormais deux boutons. Le scoper dit ce que la preuve veut réellement presser.
		await page
			.getByRole('navigation')
			.getByRole('button', { name: /Cycle commercial standard/ })
			.click()
		await expect(page.getByTestId('comparaison-source-identique')).toHaveCount(0)
	})

	test('le résultat tient au palier étroit, sans débordement', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 780 })
		await connecter(page)
		await ouvrirEditeur(page)
		await choisirWorkflow(page, COPIE_SEED)
		await page.getByTestId('comparer-source').click()
		await expect(page.getByTestId('comparaison-source-identique')).toBeVisible()
		const debordement = await page.evaluate(
			() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
		)
		expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
		await capturer(page, 'comparaison-source-identique-390', 'CRM-032')
	})
})
