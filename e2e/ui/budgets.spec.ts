// @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 2 : parcours
//           d'interface de l'administration des budgets d'un track
// @verifies docs/SPEC-costs.md §2.1 (nom, devise, enveloppe facultative), §2.2 (une occurrence se
//           clôture indépendamment de son budget), §3.2 (seul un administrateur écrit), §4.1
//           (la table, l'interrupteur des clôturés, la clôture qui avertit), §4.7 (les états)
// @verifies docs/DESIGN_SYSTEM.md §5.9 (le patron de tableau), §5.13 (commandes toujours visibles,
//           confirmation dans le flux du document), §7 (paliers), §8 (accessibilité)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// LES GESTES SONT ÉPROUVÉS SUR DE VRAIS CLICS ET DE VRAIES FRAPPES, jamais par appel d'une fonction
// interne, et le parcours clavier atteint son focus par `Tab` — Chromium ne pose `:focus-visible`
// que sur un focus réellement atteint au clavier, et une capture prise après un `focus()`
// programmatique montrerait un bouton sans anneau (`docs/DESIGN_SYSTEM.md` §8).
//
// LE SCÉNARIO REND LE SEED À SON ÉTAT INITIAL. Il crée ses propres budgets sous des noms préfixés
// `E2E Budget`, qui n'entrent en collision avec aucun budget seedé, et les RETIRE en épilogue par la
// clé de service — règle de la décision 362 (INC-091, INC-099) : chaque preuve purge ce qu'elle a
// déposé, dans son propre `finally`, quel que soit son point d'échec. La purge d'entrée protège du
// `23505` que laisserait une exécution tuée avant son `finally`.
//
// POURQUOI LA PURGE SUPPRIME ALORS QUE LE PRODUIT NE SUPPRIME PAS. Un budget ne se supprime pas, il
// se clôture (`docs/SPEC-costs.md` §3.2), et aucune assertion de ce fichier n'exerce une suppression
// comme geste d'utilisateur. Clôturer ne suffirait pas ici : `supabase/tests/0048_budgets.test.sql`
// compte les budgets du seed, et un résidu clôturé reste une ligne.

import { expect, test, type Page } from './fixtures'
import type { Locator } from '@playwright/test'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-084'
const ADMIN = 'admin@p2enjoy.test'
/** Le business developer est membre du workspace SANS être administrateur : il lit les budgets et
 * ne les écrit pas (`docs/SPEC-costs.md` §3.2). C'est le refus que le §4.7 nomme « lecture seule ». */
const NON_ADMIN = 'bizdev@p2enjoy.test'

/**
 * « Studio web » est le track du seed qui porte les trois cas d'un coup : un budget récurrent à deux
 * occurrences dont une clôturée (« Publicité 2026 »), et un budget CLÔTURÉ (« Salon du web 2025 »).
 * Aucun autre scénario de ce fichier ne le modifie.
 */
const TRACK = 'Studio web'
const BUDGET_RECURRENT = 'Publicité 2026'
const BUDGET_CLOTURE = 'Salon du web 2025'

const CHEMIN_BUDGETS = `${URL_API}/rest/v1/budgets`

async function connecter(page: Page, email = ADMIN): Promise<void> {
	await page.goto('/connexion')
	await page.getByLabel('Adresse email').click()
	await page.keyboard.type(email)
	await page.keyboard.press('Tab')
	await page.keyboard.type(MOT_DE_PASSE_SEED)
	await page.keyboard.press('Enter')
	await expect(page.getByRole('button', { name: 'Se déconnecter' })).toBeVisible()
}

/** Ouvre l'administration de l'arborescence et déplie le track porteur des budgets. */
async function ouvrirBudgetsDuTrack(page: Page, nomTrack = TRACK): Promise<Locator> {
	await page.goto('/reglages/arborescence')
	await expect(page.getByRole('heading', { name: "Administration de l'arborescence" })).toBeVisible()
	await page.getByRole('button', { name: `Déplier ${nomTrack}` }).click()
	const bloc = page.getByRole('region', { name: `Budgets du track ${nomTrack}` })
	await expect(bloc).toBeVisible()
	return bloc
}

/** Les noms des budgets affichés, dans l'ORDRE DU DOM — donc l'ordre affiché. */
async function nomsAffiches(bloc: Locator): Promise<string[]> {
	const cellules = await bloc.getByRole('rowheader').all()
	const noms: string[] = []
	for (const cellule of cellules) noms.push(((await cellule.textContent()) ?? '').trim())
	return noms
}

/** Purge par nom avec la clé de service. */
async function supprimerParNom(
	request: import('@playwright/test').APIRequestContext,
	nom: string,
): Promise<void> {
	await request.delete(`${CHEMIN_BUDGETS}?name=eq.${encodeURIComponent(nom)}`, {
		headers: enTetesService(),
	})
}

/**
 * Avance le focus par `Tab` jusqu'à ce que `cible` devienne l'élément actif, ou échoue en le
 * nommant. Jamais de `focus()` programmatique — voir l'en-tête.
 */
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
// Ce que la table rend du seed
// -------------------------------------------------------------------------------------------

test.describe('la table des budgets du track (docs/SPEC-costs.md §4.1)', () => {
	test('elle rend le budget ouvert, masque le clôturé, et compte les occurrences OUVERTES', async ({
		page,
	}) => {
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)

		// Les budgets clôturés sont MASQUÉS PAR DÉFAUT (§4.1) : ils ne disparaissent pas de
		// l'historique, ils sortent du chemin.
		await expect(bloc.getByRole('rowheader', { name: BUDGET_RECURRENT })).toBeVisible()
		await expect(bloc.getByRole('rowheader', { name: BUDGET_CLOTURE })).toHaveCount(0)

		const ligne = bloc.getByRole('row', { name: new RegExp(BUDGET_RECURRENT) })
		await expect(ligne).toContainText('EUR')
		await expect(ligne).toContainText('Oui')
		await expect(ligne).toContainText('Ouvert')

		// LE COMPTE PORTE SUR L'OCCURRENCE, PAS SUR LE BUDGET (§2.2) : « Publicité 2026 » porte deux
		// occurrences seedées — « Janvier 2026 » CLÔTURÉE et « Février 2026 » ouverte —, donc UNE
		// seule ouverte. C'est la seule assertion de ce fichier qui distingue les deux clôtures, et
		// elle rougirait si le filtre portait sur le budget.
		await expect(ligne.getByTestId('cellule-occurrences')).toHaveText('1')
	})

	test("l'interrupteur révèle les budgets clôturés, avec leur état écrit en toutes lettres", async ({
		page,
	}) => {
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		await bloc.getByLabel('Afficher les budgets clôturés').check()

		const ligne = bloc.getByRole('row', { name: new RegExp(BUDGET_CLOTURE) })
		await expect(ligne).toBeVisible()
		// L'état est un MOT, jamais une teinte seule (`docs/DESIGN_SYSTEM.md` §1).
		await expect(ligne).toContainText('Clôturé')
		// Un budget clôturé garde une commande de RÉOUVERTURE, et perd celle de clôture : les deux
		// icônes sont distinctes, jamais la même retournée.
		await expect(
			ligne.getByRole('button', { name: `Rouvrir le budget ${BUDGET_CLOTURE}` }),
		).toBeVisible()
		await expect(
			ligne.getByRole('button', { name: `Clôturer le budget ${BUDGET_CLOTURE}` }),
		).toHaveCount(0)

		// La cellule des occurrences d'un budget SIMPLE reste vide (§5.9 : la cellule vide est
		// réservée à une donnée qui n'existe pas pour cette ligne). Un « 0 » y laisserait croire
		// qu'un budget non récurrent pourrait en porter.
		await expect(ligne.getByTestId('cellule-occurrences')).toHaveText('')
	})
})

// -------------------------------------------------------------------------------------------
// Les gestes d'un administrateur
// -------------------------------------------------------------------------------------------

test.describe("les gestes d'administration (docs/SPEC-costs.md §3.2, §4.1)", () => {
	test('un administrateur crée, modifie, clôture puis rouvre un budget', async ({
		page,
		request,
	}) => {
		const nom = 'E2E Budget Souris'
		const nomModifie = 'E2E Budget Souris Modifié'
		await supprimerParNom(request, nom)
		await supprimerParNom(request, nomModifie)

		try {
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)

			// --- Créer ---------------------------------------------------------------------------
			await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
			const creation = bloc.getByTestId('formulaire-budget')
			await expect(creation).toBeVisible()
			// Le focus entre dans le premier champ (§5.13).
			await expect(creation.getByLabel('Nom')).toBeFocused()
			await creation.getByLabel('Nom').fill(nom)
			// La devise est proposée à EUR, la convention du produit — et reste modifiable.
			await expect(creation.getByLabel('Devise')).toHaveValue('EUR')
			await creation.getByLabel('Enveloppe (facultative)').fill('4200')
			await creation.getByRole('button', { name: 'Créer' }).click()
			await expect(creation).toBeHidden()

			const ligne = bloc.getByRole('row', { name: new RegExp(nom) })
			await expect(ligne).toContainText('4200')
			await expect(ligne).toContainText('Non')
			await expect(ligne).toContainText('Ouvert')
			// Un budget créé sans récurrence n'a AUCUNE occurrence : cellule vide, pas « 0 ».
			await expect(ligne.getByTestId('cellule-occurrences')).toHaveText('')

			// --- Modifier ------------------------------------------------------------------------
			await bloc.getByRole('button', { name: `Modifier le budget ${nom}` }).click()
			const edition = bloc.getByTestId('formulaire-budget')
			await expect(edition.getByLabel('Nom')).toHaveValue(nom)
			await edition.getByLabel('Nom').fill(nomModifie)
			await edition.getByLabel('Devise').fill('CHF')
			// L'ENVELOPPE EST FACULTATIVE (§2.1) : la vider n'est pas « zéro décidé », c'est
			// « pas décidée ». La cellule redevient vide, elle n'affiche pas « 0 ».
			await edition.getByLabel('Enveloppe (facultative)').fill('')
			await edition.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(edition).toBeHidden()

			const ligneModifiee = bloc.getByRole('row', { name: new RegExp(nomModifie) })
			await expect(ligneModifiee).toContainText('CHF')
			await expect(ligneModifiee).not.toContainText('4200')

			// --- Clôturer ------------------------------------------------------------------------
			await bloc.getByRole('button', { name: `Clôturer le budget ${nomModifie}` }).click()
			const confirmation = bloc.getByTestId('confirmation-cloture-budget')
			await expect(confirmation).toContainText(`Clôturer le budget « ${nomModifie} » ?`)
			// LA CLÔTURE N'EST PAS SILENCIEUSE (§4.1) : la confirmation dit ce qu'elle fait des
			// lignes de coût. Le décompte lui-même arrive avec `CRM-085`, et la phrase le dit
			// plutôt que de laisser un blanc se lire comme un zéro.
			await expect(confirmation.getByTestId('cloture-sans-reel')).toBeVisible()
			// Elle n'EMPÊCHE rien : le bouton de confirmation reste actif, c'est une décision de
			// gestion.
			await expect(confirmation.getByRole('button', { name: 'Clôturer' })).toBeEnabled()
			await confirmation.getByRole('button', { name: 'Clôturer' }).click()
			await expect(confirmation).toBeHidden()
			// Il sort de la table, sans être supprimé.
			await expect(bloc.getByRole('rowheader', { name: nomModifie })).toHaveCount(0)

			// --- Rouvrir -------------------------------------------------------------------------
			await bloc.getByLabel('Afficher les budgets clôturés').check()
			await expect(bloc.getByRole('rowheader', { name: nomModifie })).toBeVisible()
			await bloc.getByRole('button', { name: `Rouvrir le budget ${nomModifie}` }).click()
			await expect
				.poll(async () =>
					bloc.getByRole('row', { name: new RegExp(nomModifie) }).first().textContent(),
				)
				.toContain('Ouvert')
		} finally {
			await supprimerParNom(request, nom)
			await supprimerParNom(request, nomModifie)
		}
	})

	test('le même parcours de création tient ENTIÈREMENT AU CLAVIER', async ({ page, request }) => {
		const nom = 'E2E Budget Clavier'
		await supprimerParNom(request, nom)

		try {
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)

			const commande = bloc.getByRole('button', { name: 'Nouveau budget' })
			await tabVers(page, commande)
			await page.keyboard.press('Enter')

			const creation = bloc.getByTestId('formulaire-budget')
			await expect(creation).toBeVisible()
			// Le focus est DÉJÀ dans le premier champ : aucun `Tab` n'a été pressé entre-temps.
			await expect(creation.getByLabel('Nom')).toBeFocused()
			await page.keyboard.type(nom)
			await page.keyboard.press('Enter')

			await expect(creation).toBeHidden()
			await expect(bloc.getByRole('rowheader', { name: nom })).toBeVisible()
		} finally {
			await supprimerParNom(request, nom)
		}
	})

	test('une saisie non numérique dans l’enveloppe est NOMMÉE, et retient l’envoi', async ({
		page,
	}) => {
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
		const creation = bloc.getByTestId('formulaire-budget')
		await creation.getByLabel('Nom').fill('E2E Budget Forme')
		await creation.getByLabel('Enveloppe (facultative)').fill('douze')

		await expect(creation.getByText('Ce montant n’est pas un nombre.')).toBeVisible()
		// Le bouton est ÉTEINT et reste lisible (§8) : la valeur est incomplète, ce n'est pas un
		// droit qui manque.
		await expect(creation.getByRole('button', { name: 'Créer' })).toBeDisabled()

		// Une devise hors motif est refusée de la même façon, par le `CHECK` recopié.
		await creation.getByLabel('Enveloppe (facultative)').fill('')
		await creation.getByLabel('Devise').fill('euro')
		await expect(creation.getByText('La devise s’écrit en trois lettres majuscules.')).toBeVisible()
		await expect(creation.getByRole('button', { name: 'Créer' })).toBeDisabled()
	})
})

// -------------------------------------------------------------------------------------------
// Le refus, MONTRÉ et non masqué
// -------------------------------------------------------------------------------------------

test.describe('ce que voit un membre non administrateur (docs/SPEC-costs.md §3.2, §4.7)', () => {
	test('il LIT les budgets, ses commandes restent visibles, et son écriture est REFUSÉE', async ({
		page,
		request,
	}) => {
		const nom = 'E2E Budget Refusé'
		await supprimerParNom(request, nom)
		try {
			await connecter(page, NON_ADMIN)
			const bloc = await ouvrirBudgetsDuTrack(page)

			// La lecture suit `app.can_read_track` (§3.1) : il voit les budgets du track.
			await expect(bloc.getByRole('rowheader', { name: BUDGET_RECURRENT })).toBeVisible()

			// AUCUN DROIT N'EST CALCULÉ DANS L'ÉCRAN : la commande n'est pas masquée sur la foi d'un
			// rôle lu au chargement — elle part, et le refus du backend est traduit.
			await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
			const creation = bloc.getByTestId('formulaire-budget')
			await creation.getByLabel('Nom').fill(nom)
			await creation.getByRole('button', { name: 'Créer' }).click()

			const refus = creation.getByTestId('budget-refus')
			await expect(refus).toBeVisible()
			await expect(refus).toContainText(
				'Seul un administrateur de cet espace de travail peut gérer les budgets.',
			)
			// Le formulaire RESTE ouvert : la saisie n'est pas perdue par un refus.
			await expect(creation.getByLabel('Nom')).toHaveValue(nom)
		} finally {
			await supprimerParNom(request, nom)
		}
	})
})

// -------------------------------------------------------------------------------------------
// Paliers responsive et captures — CLAUDE.md §16, docs/DESIGN_SYSTEM.md §7
// -------------------------------------------------------------------------------------------

test.describe('paliers responsive', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la table des budgets reste lisible`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)
			await expect(bloc.getByTestId('tableau-budgets')).toBeVisible()

			// La PAGE ne défile pas horizontalement : le débordement appartient au conteneur du
			// tableau, qui l'indique (§12.6).
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

			await bloc.getByTestId('tableau-budgets').scrollIntoViewIfNeeded()
			await capturer(page, `budgets-${palier.nom}`, UNITE)
		})
	}

	test('la confirmation de clôture est capturée, dans le flux du document', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		await bloc.getByRole('button', { name: `Clôturer le budget ${BUDGET_RECURRENT}` }).click()
		const confirmation = bloc.getByTestId('confirmation-cloture-budget')
		await expect(confirmation).toBeVisible()
		await confirmation.scrollIntoViewIfNeeded()
		await capturer(page, 'budgets-confirmation-cloture', UNITE)
		// Le scénario n'écrit RIEN : il annule, et le seed reste intact.
		await confirmation.getByRole('button', { name: 'Annuler' }).click()
		await expect(confirmation).toBeHidden()
	})

	test('le formulaire de création est capturé', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
		const creation = bloc.getByTestId('formulaire-budget')
		await expect(creation).toBeVisible()
		await creation.scrollIntoViewIfNeeded()
		await capturer(page, 'budgets-formulaire-creation', UNITE)
	})
})
