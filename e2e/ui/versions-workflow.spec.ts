// @verifies CRM-078 (docs/BACKLOG.md) — cinquième tranche : les écrans du versionnement
// @verifies docs/SPEC-workflow-engine.md §7 ter.14.3 (la liste des versions et son auteur),
//           §7 ter.14.4 (les quatre gestes), §7 ter.14.7 (les refus traduits),
//           §7 ter.14.9 (ligne « Interface » et ligne « Visuel »)
// @verifies docs/DESIGN_SYSTEM.md §5.15 (bloc des versions), §7 (quatre paliers, aucun défilement
//           horizontal de page), §5.9 (tableau sémantique)
// @verifies CLAUDE.md §10 (une règle d'accès se prouve avec les droits réels du profil)
//
// AUCUN SCÉNARIO DE CE FICHIER N'ÉCRIT DANS LE SEED, et c'est une contrainte de forme, pas une
// prudence : publier ajouterait une version au workflow par défaut à **chaque** exécution, et une
// version est immuable, sans politique de suppression pour `authenticated` (§7 ter.4). Les deux
// gestes d'écriture éprouvés ici sont donc éprouvés par leur REFUS — `composition inchangee` pour
// l'administratrice, le refus d'administration pour la lectrice —, et un refus ne laisse aucune
// trace. La restauration, qui publie un point de retour, n'est pas jouée par ces preuves : le
// §7 ter.14.9 ne l'inscrit pas à la ligne « Interface », et son contrat est déjà éprouvé hors
// interface par `e2e/api/restauration-version-workflow.spec.ts`.

import { expect, test, type Page } from './fixtures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole } from './fixtures'
import { MOT_DE_PASSE_SEED } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-078'
const ADMIN = 'admin@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

async function connecter(page: Page, adresse: string): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(adresse)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

async function ouvrirEditeur(page: Page): Promise<void> {
	await page.goto('/reglages')
	await page.getByRole('link', { name: /Workflows : étapes et composition/ }).click()
	await expect(page).toHaveURL(/\/reglages\/workflows$/)
	await expect(page.getByRole('heading', { name: 'Éditeur de workflows' })).toBeVisible()
}

test.describe('la liste des versions (§7 ter.14.3)', () => {
	test('rend la version du seed, son numéro, sa note et son auteur nommé', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirEditeur(page)

		const tableau = page.getByTestId('tableau-versions')
		await expect(tableau).toBeVisible()
		// MESURÉ sur la pile seedée : le workflow par défaut porte UNE version, publiée par
		// l'administratrice au nom complet résolu — aucun `uuid` n'atteint l'écran (`CRM-022`).
		await expect(tableau.locator('tbody tr')).toHaveCount(1)
		await expect(tableau).toContainText('Camille Aubert')
		await expect(tableau).toContainText('Composition de référence livrée par le seed')
	})

	test('le workflow DÉRIVÉ n’a aucune version, et l’écran le dit en toutes lettres', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirEditeur(page)
		// Le second workflow du seed est la copie dérivée (§4.10) : elle n'a jamais été publiée.
		await page.getByRole('button', { name: /Cycle commercial — Conseil IA/ }).click()

		await expect(page.getByTestId('versions-vide')).toBeVisible()
		await expect(page.getByTestId('tableau-versions')).toHaveCount(0)
	})
})

test.describe('les gestes (§7 ter.14.4)', () => {
	test('publier une composition inchangée est REFUSÉ, et le refus est affiché', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirEditeur(page)

		// La composition vivante est celle que la version du seed a photographiée : la
		// vérification 5 du §7 ter.5 refuse. Ce geste n'écrit donc rien, ce que la seconde
		// assertion constate en relisant le nombre de lignes du tableau.
		await page.getByTestId('publier-version').click()
		await expect(page.getByTestId('refus-publication')).toBeVisible()
		await expect(page.getByTestId('refus-publication')).toContainText(
			"La composition n'a pas changé",
		)
		await expect(page.getByTestId('tableau-versions').locator('tbody tr')).toHaveCount(1)
		// Le refus voyage en `400` : PostgREST rend ce statut pour tout `P0001` (§7 ter.13.6).
		// Le navigateur le journalise, et le scénario CONSOMME exactement cette erreur — la
		// console reste vierge de tout ce qu'il n'a pas provoqué.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
	})

	test('comparer la version du seed à elle-même rend « identique », sans dérouler six vides', async ({
		page,
	}) => {
		await connecter(page, ADMIN)
		await ouvrirEditeur(page)

		// Une seule version existe : les deux listes la désignent d'office (§7 ter.14.4), ce que
		// le §7 ter.11.3 accepte explicitement.
		await page.getByTestId('comparer-versions').click()
		await expect(page.getByTestId('comparaison-identique')).toBeVisible()
		await expect(page.getByTestId('comparaison-collections')).toHaveCount(0)
	})

	test('le plan rend les trente-neuf affaires du workflow, et se dit applicable', async ({ page }) => {
		await connecter(page, ADMIN)
		await ouvrirEditeur(page)

		await page.getByTestId('planifier-restauration').click()
		const plan = page.getByTestId('plan-remappage')
		await expect(plan).toBeVisible()
		// MESURÉ : trente-neuf affaires depuis `CRM-046` tranche 2 (`docs/SPEC-seed.md` §9.11),
		// toutes inchangées, aucune étape retirée — la structure vivante est celle de la version.
		// Le verdict vient de la base, jamais d'un calcul d'écran, et le compte suit la donnée.
		await expect(plan).toContainText('39 affaire(s)')
		await expect(page.getByTestId('plan-verdict')).toContainText('Plus aucune affaire')
		await expect(page.getByTestId('etapes-retirees')).toHaveCount(0)
		// La troncature est écrite dans les deux cas : ici, la liste est entière.
		await expect(page.getByTestId('plan-troncature')).toContainText('39 affaire(s) listées')
	})
})

test.describe('le refus opposé à la lectrice, avec ses droits réels (CLAUDE.md §10)', () => {
	test('la commande est OFFERTE à la lectrice, et c’est la base qui refuse', async ({ page }) => {
		await connecter(page, VIEWER)
		await ouvrirEditeur(page)

		// Aucun droit n'est calculé par l'écran : la commande est rendue pour tout le monde
		// (§7 ter.14.1). Le refus est celui de la vérification 3 du §7 ter.5, avec le jeton réel
		// de la lectrice — il n'est ni simulé, ni deviné.
		const commande = page.getByTestId('publier-version')
		await expect(commande).toBeEnabled()
		await commande.click()
		await expect(page.getByTestId('refus-publication')).toContainText(
			'réservé aux administrateurs',
		)
		// `42501` voyage en `403` (§7 ter.6) : le refus est celui de la base, pas de l'écran.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
	})
})

test.describe('captures aux quatre paliers (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : le bloc des versions reste lisible, sans débordement`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page, ADMIN)
			await ouvrirEditeur(page)
			await page.getByTestId('planifier-restauration').click()
			await expect(page.getByTestId('plan-remappage')).toBeVisible()
			await page.getByTestId('tableau-versions').scrollIntoViewIfNeeded()

			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement').toBe(false)
			await capturer(page, `workflows-versions-${palier.nom}`, UNITE)

			// Le plan est capturé À PART : il vit au bas du bloc, et une seule capture par palier
			// ne montrerait jamais ses compteurs, sa liste d'affaires ni sa commande de
			// restauration — c'est-à-dire l'essentiel de ce que la tranche livre.
			await page.getByTestId('plan-verdict').scrollIntoViewIfNeeded()
			await capturer(page, `workflows-plan-${palier.nom}`, UNITE)
		})
	}
})
