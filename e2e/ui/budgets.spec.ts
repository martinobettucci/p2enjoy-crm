// @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 2 : parcours
//           d'interface de l'administration des budgets d'un track
// @verifies CRM-086 (docs/BACKLOG.md) — un point de SA Definition of Done vit ici, et nulle part
//           ailleurs : « la clôture d'un budget portant des réels non saisis avertit et COMPTE
//           (§4.1) ; prouvé à l'écran, et prouvé qu'elle n'est pas empêchée ». Le geste appartient à
//           l'administration des budgets, donc sa preuve aussi — la loger dans les écrans de coûts
//           ferait éprouver un geste depuis un écran qui ne le porte pas.
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

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, expect, test, type Page } from './fixtures'
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

	test('la clôture d’un budget portant des réels non saisis les COMPTE, et n’est pas empêchée', async ({
		page,
		request,
	}) => {
		// LA PREUVE QUE LA Definition of Done DE `CRM-086` RÉCLAME, et que le scénario précédent ne
		// pouvait pas porter : il clôture un budget qu'il vient de créer, donc SANS aucune ligne de
		// coût, et lit la phrase « aucune ligne […] n'attend son coût réel ». Le §4.1 exige l'autre
		// cas — celui où des réels manquent —, qui est le seul où l'avertissement a un objet.
		//
		// LE BUDGET ET SA LIGNE SONT CRÉÉS POUR CE SCÉNARIO, jamais empruntés au seed : clôturer
		// « Publicité 2026 » le ferait sortir des écrans de coûts, et une exécution tuée avant son
		// `finally` laisserait quatre preuves d'autres fichiers rouges sans que leur cause soit
		// lisible.
		const nom = 'E2E Budget Clôture Comptée'
		const LIGNE = 'E2E Cout Cloture'
		/** « Portail adhérents — MGEN Loire » : une affaire du seed, dont aucune preuve ne compte les lignes. */
		const CARD = '5eed0000-0000-4000-8000-0000000000cc'
		const CHEMIN_COUTS = `${URL_API}/rest/v1/card_costs`

		const purger = async () => {
			await request.delete(`${CHEMIN_COUTS}?label=eq.${encodeURIComponent(LIGNE)}`, {
				headers: enTetesService(),
			})
			await supprimerParNom(request, nom)
		}
		await purger()

		try {
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)

			// --- Le budget, par le VRAI geste du produit ------------------------------------------
			await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
			const creation = bloc.getByTestId('formulaire-budget')
			await creation.getByLabel('Nom').fill(nom)
			await creation.getByRole('button', { name: 'Créer' }).click()
			await expect(creation).toBeHidden()
			await expect(bloc.getByRole('rowheader', { name: nom })).toBeVisible()

			// --- La ligne sans coût réel, par la clé de service -------------------------------------
			// Elle n'est PAS posée par l'interface : la fiche d'affaire est la surface de `CRM-085`, et
			// la traverser ici ferait dépendre cette preuve d'un écran qu'elle n'éprouve pas.
			const budgets = await request.get(
				`${CHEMIN_BUDGETS}?name=eq.${encodeURIComponent(nom)}&select=id`,
				{ headers: enTetesService() },
			)
			expect(budgets.status(), 'le budget créé doit être lisible par la clé de service').toBe(200)
			const idBudget = ((await budgets.json()) as readonly { id: string }[])[0]?.id
			expect(idBudget, 'le budget créé doit porter un identifiant').toBeTruthy()

			const pose = await request.post(CHEMIN_COUTS, {
				headers: { ...enTetesService(), 'Content-Type': 'application/json' },
				data: { card_id: CARD, budget_id: idBudget, label: LIGNE, estimated_cost: 42 },
			})
			expect(pose.status(), 'la ligne sans coût réel doit être posée').toBeLessThan(300)

			// --- La clôture AVERTIT ET COMPTE -------------------------------------------------------
			await page.reload()
			const bloc2 = await ouvrirBudgetsDuTrack(page)
			await bloc2.getByRole('button', { name: `Clôturer le budget ${nom}` }).click()
			const confirmation = bloc2.getByTestId('confirmation-cloture-budget')
			// LE NOMBRE EST ÉCRIT, et c'est tout l'objet de cette preuve : « ce budget porte n lignes
			// sans coût réel ; elles resteront saisissables après la clôture ». Un blanc, ou la phrase
			// du cas nul, se lirait comme « rien à saisir » sur un budget qui en porte.
			await expect(confirmation.getByTestId('cloture-sans-reel')).toContainText('1 ligne(s)');
			await expect(confirmation.getByTestId('cloture-sans-reel')).toContainText(
				'resteront saisissables après la clôture',
			)
			// ELLE N'EST PAS EMPÊCHÉE — c'est une décision de gestion, pas une garde (§4.1).
			const bouton = confirmation.getByRole('button', { name: 'Clôturer' })
			await expect(bouton).toBeEnabled()
			await bouton.click()
			await expect(confirmation).toBeHidden()
			await expect(bloc2.getByRole('rowheader', { name: nom })).toHaveCount(0)

			// --- ET LA LIGNE RESTE SAISISSABLE APRÈS LA CLÔTURE -------------------------------------
			// La phrase de l'avertissement n'est pas une promesse en l'air : elle est mesurée sur
			// l'onglet « À saisir » du §4.8, qui liste les lignes des budgets CLOS et rend leur champ
			// actif. Sans cette dernière assertion, l'écran pourrait promettre ce que le produit ne
			// tient pas.
			await page.goto('/tracks/studio-web/couts?onglet=saisir')
			const ligne = page.getByTestId('couts-a-saisir-ligne').filter({ hasText: LIGNE })
			await expect(ligne).toHaveCount(1)
			await expect(ligne.getByTestId('couts-a-saisir-clos')).toBeVisible()
			await expect(ligne.getByTestId('couts-a-saisir-champ')).toBeEnabled()
		} finally {
			await purger()
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

	test('LE SEUIL D’ANCIENNETÉ se pose, se relit, et s’EFFACE (§2.1 bis, arbitrage d’INC-183)', async ({
		page,
		request,
	}) => {
		// LE GESTE QUE LA TRANCHE 4 AJOUTE, éprouvé de bout en bout sur un budget créé par l'écran.
		// L'effacement est la moitié qui compte : un formulaire qui rouvrirait vide, ou un envoi qui
		// omettrait la colonne quand le champ l'est, rendrait INEFFAÇABLE un seuil posé par erreur —
		// l'écran n'offre aucun autre geste pour l'ôter.
		const nom = 'E2E Budget Seuil'
		await supprimerParNom(request, nom)

		try {
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)

			await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
			const creation = bloc.getByTestId('formulaire-budget')
			await creation.getByLabel('Nom').fill(nom)
			await creation.getByLabel('Seuil d’ancienneté (facultatif)').fill('45')
			await creation.getByRole('button', { name: 'Créer' }).click()
			await expect(creation).toBeHidden()

			// LE SEUIL N'EST DANS AUCUNE COLONNE DE LA TABLE, et c'est écrit au §4.1 : le §5.9
			// réserve les colonnes à ce qu'on compare d'une ligne à l'autre, et un seuil se règle une
			// fois puis s'oublie. Il se relit donc au formulaire, qui est le seul endroit qui le
			// porte — et c'est aussi ce qui rend la relecture ci-dessous nécessaire.
			await bloc.getByRole('button', { name: `Modifier le budget ${nom}` }).click()
			const edition = bloc.getByTestId('formulaire-budget')
			await expect(edition.getByLabel('Seuil d’ancienneté (facultatif)')).toHaveValue('45')

			// --- L'EFFACEMENT, contre la base et non contre le formulaire -------------------------
			await edition.getByLabel('Seuil d’ancienneté (facultatif)').fill('')
			await edition.getByRole('button', { name: 'Enregistrer' }).click()
			await expect(edition).toBeHidden()

			await bloc.getByRole('button', { name: `Modifier le budget ${nom}` }).click()
			await expect(
				bloc.getByTestId('formulaire-budget').getByLabel('Seuil d’ancienneté (facultatif)'),
			).toHaveValue('')

			// ET LA BASE LE DIT AUSSI. Le formulaire pourrait rendre un champ vide sur une colonne
			// restée à 45 : seule la relecture par l'API établit que le nul a bien été écrit.
			const relecture = await request.get(
				`${URL_API}/rest/v1/budgets?name=eq.${encodeURIComponent(nom)}&select=stale_after_days`,
				{ headers: enTetesService() },
			)
			expect((await relecture.json())[0].stale_after_days).toBeNull()
		} finally {
			await supprimerParNom(request, nom)
		}
	})

	test('un seuil de ZÉRO est NOMMÉ sur son champ, et retient l’envoi', async ({ page }) => {
		// La base l'oppose aussi — `budgets_stale_check`, mesuré `400`/`23514` par
		// `e2e/api/budgets.spec.ts` —, et ce contrôle d'interface ne la remplace pas
		// (`CLAUDE.md` §10) : il évite l'aller-retour, il ne tient pas la règle.
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
		const creation = bloc.getByTestId('formulaire-budget')
		await creation.getByLabel('Nom').fill('E2E Budget Seuil Zéro')
		await creation.getByLabel('Seuil d’ancienneté (facultatif)').fill('0')

		await expect(
			creation.getByText('Le seuil s’écrit en jours entiers, à partir de 1.'),
		).toBeVisible()
		await expect(creation.getByRole('button', { name: 'Créer' })).toBeDisabled()

		// UN FRACTIONNAIRE EST REFUSÉ AUSSI, plutôt qu'arrondi en silence : l'ancienneté se compte en
		// jours révolus, et un arrondi changerait la décision sans le dire (`CLAUDE.md` §18).
		await creation.getByLabel('Seuil d’ancienneté (facultatif)').fill('2.5')
		await expect(creation.getByRole('button', { name: 'Créer' })).toBeDisabled()

		// Et le champ VIDE n'est pas une erreur : c'est « aucun seuil décidé ».
		await creation.getByLabel('Seuil d’ancienneté (facultatif)').fill('')
		await expect(creation.getByRole('button', { name: 'Créer' })).toBeEnabled()
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

			// LE `403` EST LE SUJET DE CE SCÉNARIO, pas une anomalie : Chromium journalise tout
			// chargement de ressource en échec, et l'écran vient d'en rendre le refus lisible à
			// l'utilisateur. Il est consommé NOMMÉMENT — statut, nombre et ordre exacts —, jamais
			// filtré globalement, de sorte qu'un second refus inattendu ferait toujours rougir le
			// verdict final.
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
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
