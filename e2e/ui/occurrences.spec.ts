// @verifies CRM-084 (docs/BACKLOG.md) — budgets, occurrences et clôture, TRANCHE 3c : parcours
//           d'interface de la sous-surface de gestion des occurrences
// @verifies docs/SPEC-costs.md §2.2 (aucune génération automatique, périodes facultatives, clôture
//           indépendante du budget), §3.2 (seul un administrateur écrit), §4.1 bis (la sous-surface,
//           ses cinq gestes, son dictionnaire fermé de refus)
// @verifies docs/DESIGN_SYSTEM.md §5.47 (la forme de la sous-surface), §5.13 (commandes toujours
//           visibles, formulaires et confirmation dans le flux du document), §7 (paliers),
//           §8 (accessibilité)
// @verifies CLAUDE.md §16 (vérification visuelle), §22 (accessibilité clavier)
//
// CE QUE CE FICHIER PROUVE, ET QUE RIEN D'AUTRE NE PROUVE. `occurrences.spec.ts` du projet `api`
// mesure le contrat de la base ; `PanneauOccurrences.test.tsx` mesure le montage sur un client
// factice. Ni l'un ni l'autre ne dit qu'un utilisateur ATTEINT cette sous-surface depuis l'écran
// d'administration et qu'un budget récurrent créé à l'écran peut enfin recevoir une occurrence —
// c'est-à-dire le trou que la tranche bouche.
//
// LES GESTES SONT ÉPROUVÉS SUR DE VRAIS CLICS ET DE VRAIES FRAPPES, jamais par appel d'une fonction
// interne, et le parcours clavier atteint son focus par `Tab` — Chromium ne pose `:focus-visible`
// que sur un focus réellement atteint au clavier.
//
// LE SCÉNARIO REND LE SEED À SON ÉTAT INITIAL. Il crée son PROPRE budget récurrent, sous un nom
// préfixé `E2E Occurrences`, et le retire en épilogue par la clé de service — `on delete cascade`
// emporte ses occurrences. Les deux occurrences seedées de « Publicité 2026 » sont LUES et jamais
// écrites : elles sont le contrat que `CRM-085` et `CRM-086` mesurent.

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	expect,
	test,
	type Page,
} from './fixtures'
import type { Locator } from '@playwright/test'
import { MOT_DE_PASSE_SEED, URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-084'
const ADMIN = 'admin@p2enjoy.test'

/** « Studio web » porte le seul budget récurrent du seed, à deux occurrences dont une clôturée. */
const TRACK = 'Studio web'
const BUDGET_RECURRENT_SEED = 'Publicité 2026'
/** Budget NON récurrent du seed : sa cellule d'occurrences reste un texte inerte. */
const BUDGET_SIMPLE_SEED = 'Salon du web 2025'

const NOM_ESSAI = 'E2E Occurrences — budget récurrent'
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
async function ouvrirBudgetsDuTrack(page: Page): Promise<Locator> {
	await page.goto('/reglages/arborescence')
	await expect(page.getByRole('heading', { name: "Administration de l'arborescence" })).toBeVisible()
	await page.getByRole('button', { name: `Déplier ${TRACK}` }).click()
	const bloc = page.getByRole('region', { name: `Budgets du track ${TRACK}` })
	await expect(bloc).toBeVisible()
	return bloc
}

/** Déplie les occurrences d'un budget en cliquant la cellule qui les COMPTE (§5.47). */
async function deplierOccurrences(bloc: Locator, nomBudget: string): Promise<Locator> {
	await bloc.getByRole('button', { name: new RegExp(`^Occurrences du budget ${nomBudget}`) }).click()
	const panneau = bloc.page().getByRole('region', { name: `Occurrences du budget ${nomBudget}` })
	await expect(panneau).toBeVisible()
	return panneau
}

/** Purge par nom avec la clé de service ; `on delete cascade` emporte les occurrences. */
async function supprimerParNom(
	request: import('@playwright/test').APIRequestContext,
	nom: string,
): Promise<void> {
	await request.delete(`${CHEMIN_BUDGETS}?name=eq.${encodeURIComponent(nom)}`, {
		headers: enTetesService(),
	})
}

async function tabVers(page: Page, cible: Locator, max = 200): Promise<void> {
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
// Ce que la sous-surface rend du seed
// -------------------------------------------------------------------------------------------

test.describe('la sous-surface, sur le seed', () => {
	test('la cellule qui COMPTE les occurrences est celle qui les ouvre (§5.47)', async ({ page }) => {
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		const commande = bloc.getByRole('button', {
			name: new RegExp(`^Occurrences du budget ${BUDGET_RECURRENT_SEED}`),
		})
		// Elle porte `aria-expanded`, distinct de tout autre élément interactif de la ligne (§5.13).
		await expect(commande).toHaveAttribute('aria-expanded', 'false')
		await commande.click()
		await expect(commande).toHaveAttribute('aria-expanded', 'true')

		const panneau = page.getByRole('region', {
			name: `Occurrences du budget ${BUDGET_RECURRENT_SEED}`,
		})
		await expect(panneau).toBeVisible()
		// Elle NOMME le budget dont elle parle : détachée de la ligne, elle vit sous la table.
		await expect(panneau.getByText(`Occurrences de « ${BUDGET_RECURRENT_SEED} »`)).toBeVisible()
	})

	test('un budget NON récurrent n’offre AUCUNE commande : le trigger la refuserait', async ({
		page,
	}) => {
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		// L'interrupteur du §4.1 fait apparaître le budget clôturé, qui est non récurrent.
		await bloc.getByTestId('budgets-afficher-clotures').check()
		await expect(bloc.getByText(BUDGET_SIMPLE_SEED)).toBeVisible()
		await expect(
			bloc.getByRole('button', { name: new RegExp(`^Occurrences du budget ${BUDGET_SIMPLE_SEED}`) }),
		).toHaveCount(0)
	})

	test('les occurrences CLOSES ne sont pas masquées, contrairement aux budgets (§4.1 bis.1)', async ({
		page,
	}) => {
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		const panneau = await deplierOccurrences(bloc, BUDGET_RECURRENT_SEED)

		await expect(panneau.getByTestId('ligne-occurrence')).toHaveCount(2)
		await expect(panneau.getByText('Janvier 2026')).toBeVisible()
		await expect(panneau.getByText('Février 2026')).toBeVisible()

		// L'état est un MOT, pas une teinte (§1) — et les deux valeurs sont présentes en même temps.
		const etats = await panneau.getByTestId('occurrence-etat').allTextContents()
		expect(etats.sort()).toEqual(['Clôturée', 'Ouverte'])
	})

	test('la ligne close garde MODIFIER, et offre ROUVRIR plutôt que CLÔTURER', async ({ page }) => {
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		const panneau = await deplierOccurrences(bloc, BUDGET_RECURRENT_SEED)

		await expect(
			panneau.getByRole('button', { name: 'Modifier l’occurrence Janvier 2026' }),
		).toBeVisible()
		await expect(
			panneau.getByRole('button', { name: 'Rouvrir l’occurrence Janvier 2026' }),
		).toBeVisible()
		await expect(
			panneau.getByRole('button', { name: 'Clôturer l’occurrence Janvier 2026' }),
		).toHaveCount(0)
	})

	test('M11 — retirer une occurrence référencée est REFUSÉ, et l’écran nomme la clôture', async ({
		page,
	}) => {
		// « Janvier 2026 » porte une ligne de `card_costs`. Le refus vient de la clé étrangère, et le
		// dictionnaire du §4.1 bis.4 le traduit en nommant le geste de remplacement.
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		const panneau = await deplierOccurrences(bloc, BUDGET_RECURRENT_SEED)

		await panneau.getByRole('button', { name: 'Retirer l’occurrence Janvier 2026' }).click()
		const confirmation = panneau.getByTestId('confirmation-retrait-occurrence')
		await expect(confirmation).toBeVisible()
		await confirmation.getByRole('button', { name: 'Retirer', exact: true }).click()

		await expect(panneau.getByTestId('occurrence-refus')).toContainText(
			'Cette occurrence porte des lignes de coût',
		)
		// LE SEED SORT INTACT : la ligne est toujours là. L'assertion est bornée à la LISTE, et non
		// au panneau entier : la confirmation reste ouverte — un refus n'efface pas le geste en
		// cours — et sa question porte elle aussi le libellé de l'occurrence.
		await expect(
			panneau.getByTestId('liste-occurrences').getByText('Janvier 2026'),
		).toBeVisible()

		// LE `409` EST CONSOMMÉ, ET IL EST LE SUJET DU SCÉNARIO. PostgREST le rend sur la violation
		// de clé étrangère que ce test PROVOQUE ; le navigateur le journalise comme toute réponse
		// non-2xx. L'écran le présente comme le refus métier qu'il est, et la console reste vierge
		// de tout ce que le scénario n'a pas demandé.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
	})
})

// -------------------------------------------------------------------------------------------
// Le trou que la tranche bouche
// -------------------------------------------------------------------------------------------

test.describe('un budget récurrent créé à l’écran devient utilisable', () => {
	test('il naît SANS occurrence, en reçoit une, et le compte de la table suit', async ({
		page,
		request,
	}) => {
		await supprimerParNom(request, NOM_ESSAI)
		try {
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)

			// 1. Le budget récurrent est créé par le VRAI geste de l'écran.
			await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
			const formulaireBudget = bloc.getByTestId('formulaire-budget')
			await formulaireBudget.getByLabel('Nom').fill(NOM_ESSAI)
			await formulaireBudget.getByLabel('Budget récurrent (porte des occurrences)').check()
			await formulaireBudget.getByRole('button', { name: 'Créer' }).click()
			await expect(formulaireBudget).toBeHidden()
			await expect(bloc.getByText(NOM_ESSAI)).toBeVisible()

			// 2. IL NAÎT SANS OCCURRENCE, et l'état vide le DIT plutôt que de rester blanc — c'est
			//    précisément le trou : sans occurrence, aucune ligne de coût ne peut lui être
			//    rattachée (§2.2), et rien ne le disait avant cette tranche.
			const panneau = await deplierOccurrences(bloc, NOM_ESSAI)
			await expect(panneau.getByTestId('occurrences-vide')).toContainText(
				'aucune ligne de coût ne peut lui être rattachée',
			)

			// 3. Une occurrence est ouverte par le vrai geste, avec ses trois attributs facultatifs.
			await panneau.getByRole('button', { name: 'Ouvrir une occurrence' }).click()
			const formulaire = panneau.getByTestId('formulaire-occurrence')
			await formulaire.getByLabel('Libellé').fill('Janvier 2027')
			await formulaire.getByLabel('Début de période (facultatif)').fill('2027-01-01')
			await formulaire.getByLabel('Fin de période (facultative)').fill('2027-01-31')
			await formulaire.getByLabel('Enveloppe (facultative)').fill('1500')
			await formulaire.getByRole('button', { name: 'Créer' }).click()

			await expect(formulaire).toBeHidden()
			await expect(panneau.getByTestId('ligne-occurrence')).toHaveCount(1)
			await expect(panneau.getByText('Janvier 2027')).toBeVisible()
			await expect(panneau.getByTestId('occurrence-periode')).toContainText('2027-01-01')
			await expect(panneau.getByTestId('occurrence-enveloppe')).toContainText('1500')

			// 4. LE COMPTE DE LA TABLE SUIT, et la sous-surface reste ouverte. Sans le
			//    rafraîchissement dédié, la colonne du §4.1 afficherait encore « 0 » — l'écran
			//    dirait deux choses contradictoires au même instant — ou la sous-surface serait
			//    démontée sous les doigts.
			await expect(
				bloc.getByRole('button', { name: new RegExp(`^Occurrences du budget ${NOM_ESSAI} : 1`) }),
			).toBeVisible()
			await expect(panneau).toBeVisible()

			// 5. La clôture n'a AUCUNE confirmation : elle se défait d'un clic (§4.1 bis.3).
			await panneau.getByRole('button', { name: 'Clôturer l’occurrence Janvier 2027' }).click()
			await expect(panneau.getByTestId('occurrence-etat')).toHaveText('Clôturée')
			await expect(panneau.getByTestId('confirmation-retrait-occurrence')).toHaveCount(0)
			// Elle reste visible — les closes ne sont pas masquées — et le compte du budget retombe.
			await expect(panneau.getByText('Janvier 2027')).toBeVisible()
			await expect(
				bloc.getByRole('button', { name: new RegExp(`^Occurrences du budget ${NOM_ESSAI} : 0`) }),
			).toBeVisible()

			// 6. Le retrait, lui, est confirmé — et il aboutit, la ligne ne référençant rien.
			await panneau.getByRole('button', { name: 'Retirer l’occurrence Janvier 2027' }).click()
			const confirmation = panneau.getByTestId('confirmation-retrait-occurrence')
			await expect(confirmation).toBeVisible()
			await confirmation.getByRole('button', { name: 'Retirer', exact: true }).click()
			await expect(panneau.getByTestId('occurrences-vide')).toBeVisible()
		} finally {
			await supprimerParNom(request, NOM_ESSAI)
		}
	})

	test('le parcours se mène au CLAVIER seul, et le focus entre dans le premier champ', async ({
		page,
		request,
	}) => {
		await supprimerParNom(request, NOM_ESSAI)
		try {
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)
			await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
			const formulaireBudget = bloc.getByTestId('formulaire-budget')
			await formulaireBudget.getByLabel('Nom').fill(NOM_ESSAI)
			await formulaireBudget.getByLabel('Budget récurrent (porte des occurrences)').check()
			await formulaireBudget.getByRole('button', { name: 'Créer' }).click()
			await expect(formulaireBudget).toBeHidden()

			// Le dépliage est atteint par `Tab` puis activé par `Entrée`.
			const commande = bloc.getByRole('button', {
				name: new RegExp(`^Occurrences du budget ${NOM_ESSAI}`),
			})
			await tabVers(page, commande)
			await page.keyboard.press('Enter')
			const panneau = page.getByRole('region', { name: `Occurrences du budget ${NOM_ESSAI}` })
			await expect(panneau).toBeVisible()

			// Ouvrir le formulaire déplace le focus dans son PREMIER champ (§5.13).
			const ouvrir = panneau.getByRole('button', { name: 'Ouvrir une occurrence' })
			await tabVers(page, ouvrir)
			await page.keyboard.press('Enter')
			const libelle = panneau.getByLabel('Libellé')
			await expect(libelle).toBeFocused()

			// La saisie et la validation se font sans souris.
			await page.keyboard.type('Février 2027')
			await page.keyboard.press('Enter')
			await expect(panneau.getByText('Février 2027')).toBeVisible()
		} finally {
			await supprimerParNom(request, NOM_ESSAI)
		}
	})

	test('un libellé déjà pris est refusé, et le refus est rendu DANS le formulaire (§5.13)', async ({
		page,
		request,
	}) => {
		await supprimerParNom(request, NOM_ESSAI)
		try {
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)
			await bloc.getByRole('button', { name: 'Nouveau budget' }).click()
			const formulaireBudget = bloc.getByTestId('formulaire-budget')
			await formulaireBudget.getByLabel('Nom').fill(NOM_ESSAI)
			await formulaireBudget.getByLabel('Budget récurrent (porte des occurrences)').check()
			await formulaireBudget.getByRole('button', { name: 'Créer' }).click()
			await expect(formulaireBudget).toBeHidden()

			const panneau = await deplierOccurrences(bloc, NOM_ESSAI)
			for (const essai of ['Mars 2027', 'Mars 2027']) {
				await panneau.getByRole('button', { name: 'Ouvrir une occurrence' }).click()
				const formulaire = panneau.getByTestId('formulaire-occurrence')
				await formulaire.getByLabel('Libellé').fill(essai)
				await formulaire.getByRole('button', { name: 'Créer' }).click()
			}

			const formulaire = panneau.getByTestId('formulaire-occurrence')
			// Le refus est lu PRÈS du champ qui l'a causé, et le formulaire reste ouvert : un refus
			// n'efface pas la saisie.
			await expect(formulaire.getByTestId('occurrence-refus')).toContainText(
				'porte déjà une occurrence de ce libellé',
			)
			await expect(formulaire.getByLabel('Libellé')).toHaveValue('Mars 2027')

			// Le `409` du doublon est consommé, pour la même raison qu'au scénario M11 : il est le
			// sujet du test, et non une anomalie résiduelle.
			autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		} finally {
			await supprimerParNom(request, NOM_ESSAI)
		}
	})
})

// -------------------------------------------------------------------------------------------
// Paliers responsive et captures — CLAUDE.md §16, docs/DESIGN_SYSTEM.md §7
// -------------------------------------------------------------------------------------------

test.describe('paliers responsive', () => {
	for (const palier of PALIERS) {
		test(`${palier.nom} : la sous-surface des occurrences reste lisible`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecter(page)
			const bloc = await ouvrirBudgetsDuTrack(page)
			const panneau = await deplierOccurrences(bloc, BUDGET_RECURRENT_SEED)
			await expect(panneau.getByTestId('liste-occurrences')).toBeVisible()

			// La PAGE ne défile pas horizontalement : le débordement appartient au conteneur du
			// tableau, qui l'indique (§12.6).
			const debordePage = await page.evaluate(
				() => document.documentElement.scrollWidth > document.documentElement.clientWidth,
			)
			expect(debordePage, 'la page ne défile pas horizontalement').toBe(false)

			// L'ASSERTION PORTE SUR LA SOUS-SURFACE ELLE-MÊME, et pas seulement sur la page. Le
			// défaut trouvé par l'œil à 390 px était un conteneur INTERNE qui défilait, que
			// l'assertion de page ci-dessus ne voit pas : le libellé — la donnée qui NOMME la ligne
			// — sortait du cadre, et la capture montrait période, montant et état sans lui. La preuve
			// nomme donc le coupable par sa coordonnée, plutôt que de dire « ça déborde ».
			const cadre = await panneau.getByTestId('liste-occurrences').boundingBox()
			expect(cadre, 'la liste des occurrences a un cadre mesurable').not.toBeNull()
			expect(cadre!.x, 'le bord gauche de la liste reste dans la fenêtre').toBeGreaterThanOrEqual(0)

			// L'ASSERTION NE PORTE PAS SUR LE BORD DROIT, et l'omission est motivée plutôt que tue.
			// MESURÉ : le conteneur qui défile est celui de l'arborescence, dont la boîte de contenu
			// vaut 846 px à 390 px de fenêtre — c'est le débordement indiqué du §12.6, que la table
			// des budgets présente déjà et que cette tranche n'introduit pas. Exiger ici que le bord
			// droit tienne dans la fenêtre tiendrait la sous-surface à un standard plus strict que
			// l'écran qui l'accueille, et serait inatteignable sans réécrire celui-ci. Ce qui compte,
			// et ce que l'œil a trouvé en défaut, est que RIEN D'IMPORTANT NE SORTE À GAUCHE.

			// Le libellé de chaque occurrence est VISIBLE, et pas seulement présent dans le document.
			for (const libelle of ['Janvier 2026', 'Février 2026']) {
				await expect(panneau.getByTestId('liste-occurrences').getByText(libelle)).toBeVisible()
			}

			await panneau.scrollIntoViewIfNeeded()
			await capturer(page, `occurrences-${palier.nom}`, UNITE)
		})
	}

	test('le formulaire d’ouverture est capturé, dans le flux du document', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		const panneau = await deplierOccurrences(bloc, BUDGET_RECURRENT_SEED)
		await panneau.getByRole('button', { name: 'Ouvrir une occurrence' }).click()
		const formulaire = panneau.getByTestId('formulaire-occurrence')
		await expect(formulaire).toBeVisible()
		await formulaire.scrollIntoViewIfNeeded()
		await capturer(page, 'occurrences-formulaire-ouverture', UNITE)
		// Le scénario n'écrit RIEN : il annule, et le seed reste intact.
		await formulaire.getByRole('button', { name: 'Annuler' }).click()
		await expect(formulaire).toBeHidden()
	})

	test('la confirmation de retrait est capturée', async ({ page }) => {
		await page.setViewportSize({ width: 1440, height: 900 })
		await connecter(page)
		const bloc = await ouvrirBudgetsDuTrack(page)
		const panneau = await deplierOccurrences(bloc, BUDGET_RECURRENT_SEED)
		await panneau.getByRole('button', { name: 'Retirer l’occurrence Février 2026' }).click()
		const confirmation = panneau.getByTestId('confirmation-retrait-occurrence')
		await expect(confirmation).toBeVisible()
		await confirmation.scrollIntoViewIfNeeded()
		await capturer(page, 'occurrences-confirmation-retrait', UNITE)
		// Le scénario n'écrit RIEN : il annule, et le seed reste intact.
		await confirmation.getByRole('button', { name: 'Annuler' }).click()
		await expect(confirmation).toBeHidden()
	})
})
