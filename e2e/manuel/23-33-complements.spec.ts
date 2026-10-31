// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.5 : les images qui complètent les chapitres 23 à 33 — les refus, les
//       états vides, les commandes photographiées avant leur clic, les issues du journal des appels
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitres 23 à 33 ; docs/SPEC-costs.md, docs/SPEC-temps.md,
//       docs/SPEC-recettes.md, docs/SPEC-plateforme.md §7, docs/SPEC-mcp.md §9
//
// Rien du seed ne change. Ce que l'écran écrit est défait : le réel saisi pour montrer « Enregistré » est retiré par la
// clé de service, avec le track et l'espace posés pour montrer un écran vide. Les refus du serveur sont obtenus par un
// rôle retiré pendant que la page est ouverte (Farida Nowak administre le temps du test, l'espace gardant toujours un
// administrateur), ou par une saisie que le serveur refuse sans rien écrire.

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import {
	ADMIN,
	BIZDEV,
	VIEWER,
	WORKSPACE_SEED,
	connecterAvecLeLabs,
	demonterEspaceNeuf,
	lireService,
	monterEspaceNeuf,
	service,
	type Compte,
} from './outils'

const BUDGETS = 'les-budgets-d-un-track'
const COUTS_TRACK = 'les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense'
const DETAIL = 'le-detail-d-un-budget-occurrence-par-occurrence-ligne-par-ligne'
const CUMUL = 'les-couts-de-tout-l-espace-de-travail-un-cumul-par-track'
const A_SAISIR = 'l-onglet-a-saisir-renseigner-les-couts-reels-a-la-suite'
const TEMPS = 'le-temps-passe-et-le-cout-du-personnel'
const RECETTES = 'les-recettes-d-une-affaire-et-sa-rentabilite'
const PLATEFORME = 'la-plateforme-espaces-membres-et-superadministrateurs'
const CONNECTEUR = 'le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant'
const ETATS = 'les-etats-que-vous-pouvez-rencontrer'
const FICHE = '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4'
const BUDGET_RECURRENT = '5eed0000-0000-4000-8000-0000000000c2'
const BUDGET_CLOTURE = '5eed0000-0000-4000-8000-0000000000c3'
const TRACK_VIDE = { id: 'e1230000-0000-4000-8000-0000000000a1', slug: 'partenariats-manuel' }
const BUDGET_VIDE = 'e1230000-0000-4000-8000-0000000000b1'
const ESPACE_VIDE = { id: 'e1230000-0000-4000-8000-0000000000f1', slug: 'atelier-manuel-26', nom: 'Atelier Morel' }
const SABINE = 'plateforme@p2enjoy.test'

/** Une image qui ne se prend que si l'état existe : l'absence se lit dans `verify-manual`, qui la nomme. */
async function si(cible: Locator, faire: () => Promise<unknown>): Promise<void> {
	if ((await cible.count()) > 0) await faire()
}

async function roleDe(request: APIRequestContext, nom: string, role: string): Promise<void> {
	const [membre] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent(nom)}&select=id`)
	if (membre === undefined) throw new Error(`${nom} est absente du seed`)
	await service(request, 'patch', `workspace_members?workspace_id=eq.${WORKSPACE_SEED}&user_id=eq.${membre.id}`, { role })
}

const debut = new Date().toISOString()
test.afterEach(async ({ request }) => {
	await roleDe(request, 'Camille Aubert', 'admin')
	await roleDe(request, 'Farida Nowak', 'viewer')
	await service(request, 'delete', `card_cost_actuals?created_at=gte.${encodeURIComponent(debut)}`)
	await service(request, 'delete', `budgets?id=eq.${BUDGET_VIDE}`)
	await service(request, 'delete', `tracks?id=eq.${TRACK_VIDE.id}`)
})

async function ouvrirBudgets(page: Page): Promise<Locator> {
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Déplier Studio web' }).click()
	const bloc = page.getByRole('region', { name: 'Budgets du track Studio web' })
	await expect(bloc).toBeVisible()
	return bloc
}

test('les budgets : où ils vivent, les occurrences, deux refus du serveur', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages')
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'reglages', cibles: [page.getByRole('link', { name: /^Arborescence : tracks et channels/ })] })
	await page.goto('/tracks/studio-web/couts')
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'onglets-des-couts', cibles: [page.getByTestId('onglet-couts-track'), page.getByTestId('onglet-couts-saisir')] })
	await illustrer(page, { chapitre: BUDGETS, section: 'les-occurrences-d-un-budget-recurrent', nom: 'onglet-a-saisir', cibles: [page.getByTestId('onglet-couts-saisir')] })

	const bloc = await ouvrirBudgets(page)
	await illustrer(page, {
		chapitre: BUDGETS,
		section: 'les-occurrences-d-un-budget-recurrent',
		nom: 'colonne-occurrences',
		cibles: [bloc.getByRole('heading', { name: 'Budgets' }).or(bloc.getByText('Budgets', { exact: true })).first(), bloc.getByRole('columnheader', { name: 'Occurrences ouvertes' })],
	})
	await bloc.getByRole('button', { name: /^Occurrences du budget Publicité 2026/ }).click()
	const occurrences = page.getByRole('region', { name: 'Occurrences du budget Publicité 2026' })
	await expect(occurrences).toBeVisible()
	await illustrer(page, { chapitre: BUDGETS, section: 'les-occurrences-d-un-budget-recurrent', nom: 'occurrences-du-budget', cibles: [occurrences] })

	// Rendre non récurrent un budget qui porte des occurrences : le serveur refuse, rien ne change.
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Déplier Studio web' }).click()
	const bloc2 = page.getByRole('region', { name: 'Budgets du track Studio web' })
	await bloc2.getByRole('button', { name: /^Modifier le budget Publicité 2026/ }).click()
	const edition = bloc2.getByTestId('formulaire-budget')
	await edition.getByLabel('Budget récurrent (porte des occurrences)').uncheck()
	await edition.getByRole('button', { name: /Enregistrer|Modifier/ }).first().click()
	const refus = edition.getByText('Ce budget porte des occurrences : supprimez-les avant de le rendre non récurrent.')
	await expect(refus).toBeVisible()
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'refus-non-recurrent', cibles: [edition] })
	await edition.getByRole('button', { name: 'Annuler' }).click()

	// Le rôle retiré pendant que le formulaire est ouvert.
	await bloc2.getByRole('button', { name: 'Nouveau budget' }).click()
	const formulaire = bloc2.getByTestId('formulaire-budget')
	await formulaire.getByLabel('Nom').fill('Salon du web 2027')
	await roleDe(request, 'Farida Nowak', 'admin')
	await roleDe(request, 'Camille Aubert', 'viewer')
	await formulaire.getByRole('button', { name: 'Créer' }).click()
	await expect(formulaire.getByText('Seul un administrateur de cet espace de travail peut gérer les budgets.')).toBeVisible()
	await illustrer(page, { chapitre: BUDGETS, section: null, nom: 'refus-role', cibles: [formulaire] })
})

test('les coûts d’un track : sans budget, sans dépense, refusés', async ({ page, request }) => {
	await service(request, 'post', 'tracks', [{ id: TRACK_VIDE.id, workspace_id: WORKSPACE_SEED, name: 'Partenariats', slug: TRACK_VIDE.slug }])
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/tracks/${TRACK_VIDE.slug}/couts`)
	const sansBudget = page.getByText('Aucun budget sur ce track').first()
	await expect(sansBudget).toBeVisible()
	await illustrer(page, { chapitre: COUTS_TRACK, section: ETATS, nom: 'aucun-budget', cibles: [sansBudget.locator('xpath=ancestor::*[.//p][1]')] })
	// Un budget sans dépense sur ce track : l'écran des coûts, l'onglet « À saisir » et le détail le disent.
	await service(request, 'post', 'budgets', [{ id: BUDGET_VIDE, track_id: TRACK_VIDE.id, name: 'Salon partenaires', currency: 'EUR' }])
	await page.goto(`/tracks/${TRACK_VIDE.slug}/couts`)
	const sansDepense = page.getByText('Aucune dépense rattachée.').first()
	await expect(sansDepense).toBeVisible()
	await illustrer(page, { chapitre: COUTS_TRACK, section: ETATS, nom: 'aucune-depense', cibles: [sansDepense] })
	await page.goto(`/tracks/${TRACK_VIDE.slug}/couts?onglet=saisir`)
	const tout = page.getByText('Tous les coûts réels sont saisis').first()
	await expect(tout).toBeVisible()
	await illustrer(page, { chapitre: A_SAISIR, section: 'ce-que-l-ecran-ecrit-quand-quelque-chose-ne-va-pas', nom: 'tout-est-saisi', cibles: [tout.locator('xpath=ancestor::*[.//p][1]')] })
	await page.goto(`/tracks/${TRACK_VIDE.slug}/couts/${BUDGET_VIDE}`)
	const detailVide = page.getByText('Aucune dépense rattachée.').first()
	await expect(detailVide).toBeVisible()
	await illustrer(page, { chapitre: DETAIL, section: ETATS, nom: 'aucune-depense', cibles: [detailVide] })
})

test('les coûts d’un track fermé à une lectrice', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await page.goto('/tracks/conseil-ia/couts')
	const refus = page.getByText('Accès refusé').first()
	await si(refus, () => illustrer(page, { chapitre: COUTS_TRACK, section: ETATS, nom: 'acces-refuse', cibles: [refus.locator('xpath=ancestor::*[.//p][1]')] }))
})

test('le détail d’un budget : récurrent, clôturé, sans dépense', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`/tracks/studio-web/couts/${BUDGET_RECURRENT}`)
	const filtre = page.getByLabel('Filtrer par occurrence')
	await expect(filtre).toBeVisible()
	await illustrer(page, { chapitre: DETAIL, section: null, nom: 'budget-recurrent', cibles: [page.getByRole('heading', { level: 1 }), page.getByRole('table').first()] })
	await illustrer(page, { chapitre: DETAIL, section: 'filtrer-par-occurrence', nom: 'filtrer', cibles: [filtre] })
	const sans = filtre.locator('option', { hasText: 'Sans occurrence' })
	await si(sans, async () => {
		await filtre.selectOption({ label: 'Sans occurrence' })
		await illustrer(page, { chapitre: DETAIL, section: null, nom: 'sans-occurrence', cibles: [filtre] })
	})
	const options = await filtre.locator('option').allTextContents()
	for (const option of options.slice(1)) {
		await filtre.selectOption({ label: option })
		const rien = page.getByText('Aucune dépense sur cette occurrence.')
		if ((await rien.count()) > 0) {
			await illustrer(page, { chapitre: DETAIL, section: ETATS, nom: 'aucune-depense-sur-l-occurrence', cibles: [filtre, rien] })
			break
		}
	}
	const auteur = page.getByRole('columnheader', { name: 'Auteur' })
	await filtre.selectOption({ index: 0 })
	await si(auteur, () => illustrer(page, { chapitre: DETAIL, section: ETATS, nom: 'auteur', cibles: [auteur, page.getByRole('row').nth(1)] }))
	const inconnu = page.getByText('Auteur inconnu').first()
	await si(inconnu, () => illustrer(page, { chapitre: DETAIL, section: ETATS, nom: 'auteur-inconnu', cibles: [inconnu.locator('xpath=ancestor::tr[1]')] }))

	await page.goto(`/tracks/studio-web/couts/${BUDGET_CLOTURE}`)
	const cloture = page.getByText(/^Budget clôturé —/).first()
	await expect(cloture).toBeVisible()
	await illustrer(page, { chapitre: DETAIL, section: ETATS, nom: 'budget-cloture', cibles: [cloture] })
})

test.describe('dans un espace sans budget', () => {
	let compte: Compte | null = null
	test.beforeAll(async ({ request }) => {
		compte = await monterEspaceNeuf(request, ESPACE_VIDE, { prenom: 'Claire', nom: 'Morel' })
	})
	test.afterAll(async ({ request }) => {
		await demonterEspaceNeuf(request, ESPACE_VIDE, compte)
	})
	test('aucun budget ouvert', async ({ page }) => {
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await page.goto('/couts')
		const vide = page.getByText('Aucun budget ouvert').first()
		await expect(vide).toBeVisible()
		await illustrer(page, { chapitre: CUMUL, section: 'ce-que-l-ecran-ecrit-quand-il-n-y-a-rien-a-montrer', nom: 'aucun-budget-ouvert', cibles: [vide.locator('xpath=ancestor::*[.//p][1]')] })
	})
})

test('l’onglet « À saisir » : le libellé, un réel enregistré, un track tout saisi, une ligne soldée', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/studio-web/couts?onglet=saisir')
	const ligne = page.getByTestId('couts-a-saisir-ligne').first()
	await expect(ligne).toBeVisible()
	const libelle = ligne.getByPlaceholder('Facture n° 42')
	if ((await libelle.count()) === 0) await ligne.getByRole('button').first().click()
	await si(page.getByPlaceholder('Facture n° 42'), () =>
		illustrer(page, { chapitre: A_SAISIR, section: 'saisir-au-clavier', nom: 'libelle', cibles: [page.getByPlaceholder('Facture n° 42').first()] }),
	)
	await ligne.getByTestId('couts-a-saisir-champ').fill('12')
	await ligne.getByTestId('couts-a-saisir-champ').press('Enter')
	const enregistre = ligne.getByTestId('couts-a-saisir-enregistre')
	await expect(enregistre).toBeVisible()
	await illustrer(page, { chapitre: A_SAISIR, section: 'saisir-au-clavier', nom: 'enregistre', cibles: [ligne] })
	await illustrer(page, { chapitre: A_SAISIR, section: 'ce-que-l-ecran-ecrit-quand-quelque-chose-ne-va-pas', nom: 'enregistre-la-marque', cibles: [enregistre] })


	await page.goto(FICHE)
	const bloc = page.getByTestId('bloc-couts-card')
	const bascules = bloc.getByTestId('cout-reels-bascule')
	for (let i = 0; i < (await bascules.count()); i += 1) {
		await bascules.nth(i).click()
		const soldee = bloc.getByText(/^Ligne soldée — décochez/).first()
		if ((await soldee.count()) > 0) {
			await illustrer(page, { chapitre: A_SAISIR, section: 'les-reels-d-une-ligne-dans-la-fiche-d-une-affaire', nom: 'ligne-soldee', cibles: [soldee.locator('xpath=ancestor::*[.//li or .//table][1]')] })
			break
		}
	}
	const sansLibelle = bloc.getByText('Sans libellé').first()
	await si(sansLibelle, () => illustrer(page, { chapitre: A_SAISIR, section: 'les-reels-d-une-ligne-dans-la-fiche-d-une-affaire', nom: 'sans-libelle', cibles: [sansLibelle.locator('xpath=ancestor::li[1]').or(sansLibelle).first()] }))
})

test('le temps : ajouter une affaire, une journée trop longue, le rapport de l’équipe, une nouvelle version', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/temps')
	await expect(page.getByTestId('temps-matrice')).toBeVisible()
	await illustrer(page, { chapitre: TEMPS, section: 'saisir-sa-semaine', nom: 'cette-semaine', cibles: [page.getByRole('button', { name: 'Semaine précédente' }), page.getByRole('button', { name: 'Semaine suivante' })] })
	await page.getByRole('button', { name: 'Semaine précédente' }).click()
	await illustrer(page, { chapitre: TEMPS, section: 'saisir-sa-semaine', nom: 'revenir-a-cette-semaine', cibles: [page.getByRole('button', { name: 'Cette semaine' })] })
	await page.getByRole('button', { name: 'Cette semaine' }).click()
	const ajouter = page.getByRole('combobox', { name: 'Ajouter une affaire' })
	// La semaine se relit après « Cette semaine » : la liste est reprise par `illustrer`, qui retente une cible détachée.
	await expect(ajouter).toBeVisible()
	await illustrer(page, { chapitre: TEMPS, section: 'saisir-sa-semaine', nom: 'ajouter-une-affaire', cibles: [ajouter] })
	// Un jour déjà plein (4 quarts, soit 7 heures) : un quart de plus sur une autre ligne est refusé par le serveur.
	const plein = page.getByTestId('temps-matrice').locator('input:not([type=checkbox])').filter({ has: page.locator('xpath=self::*[@value="4"]') }).first()
	const jour = ((await plein.getAttribute('aria-label')) ?? '').split(', ').slice(1).join(', ')
	const cellule = page.getByLabel(`Formation, ${jour}`, { exact: true })
	await cellule.fill('1')
	await cellule.press('Tab')
	const trop = page.getByText('Cette valeur dépasserait la journée de 7 heures.').first()
	await si(trop, () => illustrer(page, { chapitre: TEMPS, section: 'saisir-sa-semaine', nom: 'journee-trop-longue', cibles: [trop] }))
	await cellule.fill('')
	await cellule.press('Escape')

	await page.goto('/temps?onglet=rapport')
	const personne = page.getByTestId('temps-rapport-personne')
	await personne.selectOption({ label: 'Toute l’équipe' }).catch(() => personne.selectOption({ index: 1 }))
	const rapport = page.getByTestId('temps-rapport')
	await expect(rapport.getByText('Chargement en cours')).toHaveCount(0)
	await illustrer(page, { chapitre: TEMPS, section: 'le-rapport-mensuel', nom: 'toute-l-equipe', cibles: [personne, rapport] })

	await page.goto('/reglages/cout-personnel')
	// Farida Nowak, dernière de la liste, n'a aucun coût : sa nouvelle version est ouverte, puis abandonnée.
	await page.getByTestId('cout-personnel').getByRole('button', { name: 'Nouvelle version' }).last().click()
	const calculer = page.getByRole('button', { name: 'Calculer depuis le coût mensuel' })
	await illustrer(page, { chapitre: TEMPS, section: 'regler-le-cout-du-personnel', nom: 'calculer', cibles: [page.getByText('Coût par quart', { exact: true }).first(), calculer] })
	await calculer.click()
	const calcul = page.getByRole('group', { name: 'Calcul du coût par quart' })
	await expect(calcul).toBeVisible()
	await illustrer(page, { chapitre: TEMPS, section: 'regler-le-cout-du-personnel', nom: 'nouvelle-version', cibles: [page.getByLabel('Coût par quart', { exact: true }), page.getByRole('button', { name: 'Enregistrer la version' })] })
	await illustrer(page, { chapitre: TEMPS, section: 'regler-le-cout-du-personnel', nom: 'calcul', cibles: [calcul] })
	await page.keyboard.press('Escape')

	await page.goto('/tracks/studio-web/couts')
	const personnel = page.getByText('Coût du personnel', { exact: true }).first()
	await personnel.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: TEMPS, section: 'le-cout-du-personnel-a-cote-des-couts', nom: 'personnel-du-track', cibles: [personnel, page.getByTestId('personnel-ligne').first()] })
	await page.goto(FICHE)
	const temps = page.getByTestId('temps-card')
	await illustrer(page, { chapitre: TEMPS, section: 'le-cout-du-personnel-a-cote-des-couts', nom: 'temps-de-l-affaire', cibles: [temps] })
	await temps.getByRole('button', { name: /semaine précédente/i }).first().click()
	await si(temps.getByRole('button', { name: 'Cette semaine' }), () =>
		illustrer(page, { chapitre: TEMPS, section: 'saisir-son-temps-depuis-la-fiche-d-une-affaire', nom: 'cette-semaine-dans-la-fiche', cibles: [temps.getByRole('button', { name: 'Cette semaine' })] }),
	)
})

test('les recettes et la rentabilité : le réel d’une recette, l’écran, l’onglet « À saisir »', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(FICHE)
	const recettes = page.getByTestId('bloc-recettes-card')
	await recettes.getByTestId('recette-reels-bascule').first().click()
	await illustrer(page, { chapitre: RECETTES, section: 'saisir-les-recettes-dans-la-fiche', nom: 'reel-d-une-recette', cibles: [recettes] })
	await illustrer(page, { chapitre: RECETTES, section: 'saisir-les-recettes-dans-la-fiche', nom: 'couts-de-l-affaire', cibles: [page.getByTestId('bloc-couts-card').getByRole('heading').first()] })
	await illustrer(page, { chapitre: RECETTES, section: 'la-rentabilite-d-une-affaire', nom: 'temps-passe', cibles: [page.getByTestId('temps-card').getByRole('heading').first()] })

	await page.goto('/rentabilite')
	const nav = page.getByRole('navigation', { name: 'Navigation principale' })
	await illustrer(page, { chapitre: RECETTES, section: 'l-ecran-rentabilite', nom: 'barre-laterale', cibles: [nav.getByRole('link', { name: 'Pilotage' }), nav.getByRole('link', { name: 'Rentabilité' })] })
	const plusieurs = page.getByText('Non calculable — plusieurs devises').first()
	await si(plusieurs, () => illustrer(page, { chapitre: RECETTES, section: 'la-rentabilite-d-une-affaire', nom: 'plusieurs-devises', cibles: [plusieurs.locator('xpath=ancestor::tr[1]')] }))
	const onglet = page.getByRole('tab', { name: /À saisir/ }).or(page.getByRole('link', { name: /À saisir/ })).first()
	await illustrer(page, { chapitre: RECETTES, section: 'l-onglet-a-saisir', nom: 'onglet-a-saisir', cibles: [onglet] })
	await onglet.click()
	const entete = page.getByRole('columnheader', { name: 'Une recette de plus' })
	await si(entete, () => illustrer(page, { chapitre: RECETTES, section: 'l-onglet-a-saisir', nom: 'colonnes', cibles: [entete, page.getByRole('columnheader', { name: 'Soldé' })] }))
})

test('la rentabilité vue par une lectrice', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await page.goto('/rentabilite')
	const refus = page.getByText('Réservé aux administrateurs', { exact: true }).first()
	await expect(refus).toBeVisible()
	await illustrer(page, { chapitre: RECETTES, section: 'l-ecran-rentabilite', nom: 'reserve-aux-administrateurs', cibles: [refus.locator('xpath=ancestor::*[.//p][1]')] })
})

test('la plateforme et le connecteur : les commandes, les issues du journal des appels', async ({ page, request }) => {
	await connecterAvecLeLabs(page, SABINE)
	await page.goto('/plateforme/espaces/p2enjoy')
	const supprimer = page.getByTestId('supprimer-espace')
	await supprimer.evaluate((e) => e.scrollIntoView({ block: 'center' }))
	await illustrer(page, { chapitre: PLATEFORME, section: 'modifier-ou-supprimer-un-espace', nom: 'supprimer-l-espace', cibles: [supprimer] })
	await page.goto('/plateforme/utilisateurs')
	const ligne = page.getByTestId('ligne-utilisateur').filter({ hasText: 'Farida Nowak' })
	await illustrer(page, { chapitre: PLATEFORME, section: 'les-utilisateurs', nom: 'rechercher', cibles: [page.getByText('Rechercher un utilisateur', { exact: true }).first(), page.getByLabel('Rechercher un utilisateur')] })
	await illustrer(page, { chapitre: CONNECTEUR, section: 'accorder-des-droits-du-connecteur', nom: 'droits-du-connecteur', cibles: [ligne] })

	const [farida] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent('Farida Nowak')}&select=id`)
	await page.goto(`/plateforme/mcp/${farida!.id}`)
	const matrice = page.getByTestId('matrice-mcp')
	await illustrer(page, { chapitre: CONNECTEUR, section: 'accorder-des-droits-du-connecteur', nom: 'grille', cibles: [matrice] })

	await page.goto('/plateforme/mcp')
	const filtre = page.getByTestId('filtre-issue')
	await filtre.scrollIntoViewIfNeeded()
	for (const [issue, nom] of [
		['Refusé par la matrice', 'issue-matrice'],
		['Refusé par le CRM', 'issue-crm'],
		['Erreur', 'issue-erreur'],
		['Réponse trop volumineuse', 'issue-volumineuse'],
	] as const) {
		await filtre.selectOption({ label: issue })
		await illustrer(page, { chapitre: CONNECTEUR, section: 'le-journal-des-appels', nom, cibles: [filtre] })
	}
})

test('« Nouvelle affaire », que l’assistant sait aussi poser', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/tracks/studio-web/refonte')
	await illustrer(page, { chapitre: CONNECTEUR, section: 'ce-que-l-assistant-sait-faire', nom: 'nouvelle-affaire', cibles: [page.getByTestId('nouvelle-affaire')] })
})

test('le coût du personnel vu par un membre : « Votre temps »', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/tracks/studio-web/couts')
	const votre = page.getByText('Votre temps', { exact: true }).first()
	await si(votre, () => illustrer(page, { chapitre: TEMPS, section: 'le-cout-du-personnel-a-cote-des-couts', nom: 'votre-temps', cibles: [votre] }))
})
