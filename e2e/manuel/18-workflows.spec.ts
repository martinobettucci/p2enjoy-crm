// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.4 : les images du chapitre 18, « Composer un workflow : ses étapes, ses
//       transitions et son formulaire »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 18 ; docs/SPEC-workflow-engine.md (l'éditeur, ses
//       blocs, les versions) ; docs/SPEC-ia.md §11.6 (le simulateur), §12 (créer avec l'IA), §13 (faire évoluer) ;
//       docs/SPEC-checklists.md ; docs/SPEC-modeles-affaires.md
// @spec CRM-112 (docs/BACKLOG.md) tranche T2.d.3 — l'image « champs-communs » de la section « Créer un workflow avec
//       l'IA » : docs/SPEC-ia.md §6.1, §12.5 ; docs/DESIGN_SYSTEM.md §5.52 ter ; décision 825
//
// Les workflows du seed sont lus, jamais modifiés : chaque formulaire ouvert est annulé, et les refus montrés sont ceux du
// serveur (clé prise, transition déjà déclarée, rôle retiré en cours de page). Ce que l'écran crée — un workflow vide, un
// workflow jetable que l'IA fait évoluer, les suggestions — porte un nom propre au scénario et est retiré par la clé de
// service après chaque test. Les points de checklist et les modèles archivés le temps d'une image sont désarchivés par
// l'écran. Le serveur d'IA n'est jamais appelé : l'en-tête `x-ia-simulateur` choisit le scénario du simulateur.

import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import {
	ADMIN,
	WORKSPACE_SEED,
	connecterAvecLeLabs,
	demonterEspaceNeuf,
	lireService,
	monterEspaceNeuf,
	poserAffaire,
	service,
	type Compte,
} from './outils'

const CHAPITRE = 'composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire'
const S = {
	creer: 'creer-un-workflow',
	ia: 'creer-un-workflow-avec-l-ia',
	evoluer: 'faire-evoluer-un-workflow-avec-l-ia',
	choisir: 'choisir-un-workflow',
	etapes: 'les-etapes',
	transitions: 'les-transitions',
	questions: 'les-questions-du-formulaire',
	visibilite: 'la-visibilite-des-questions-etape-par-etape',
	exigences: 'ce-qu-il-faut-avoir-rempli-pour-emprunter-un-chemin',
	checklists: 'les-checklists-des-etapes-et-les-points-qu-un-chemin-exige',
	effets: 'ce-qu-une-exigence-fera-aux-affaires-en-cours',
	versions: 'garder-une-photographie-d-un-workflow-et-y-revenir',
	modeles: 'preparer-des-modeles-d-affaires',
} as const

const EDITEUR = '/reglages/workflows'
const DEFAUT = 'Cycle commercial standard'
const CHECKLISTS_WF = 'Cycle commercial — checklists'
const NOM_VIDE = 'Accompagnement client'
const NOM_JETABLE = 'Prospection partenaires'
// Les demandes faites à l'IA : leur texte désigne les suggestions que l'épilogue retire.
const DEMANDE_CREATION = 'Un cycle pour une agence web : prise de contact, maquette et devis, avec le budget du client.'
const DEMANDE_CATALOGUE = 'Un cycle de ventes accompagnées, qui reprend la prospection du catalogue.'
const DEMANDE_ECHEC = 'Un cycle de formation inter-entreprises, de la demande à la convention.'
const DEMANDE_EVOLUTION = 'Remplace la deuxième étape par une qualification des besoins.'
const DEMANDE_CHAMPS_COMMUNS = 'Un cycle de devis qui exige le numéro de TVA avant la signature.'
const DEMANDES = [DEMANDE_CREATION, DEMANDE_CATALOGUE, DEMANDE_ECHEC, DEMANDE_EVOLUTION, DEMANDE_CHAMPS_COMMUNS]
// Deux champs communs propres à l'image, jamais ceux du seed (docs/SPEC-champs-communs.md §13) : le retrait les vise
// par leur clé, qui ne doit rien emporter d'autre.
const CHAMPS_COMMUNS = ['numero-tva-manuel', 'ancien-code-client-manuel']

const TRACK_STUDIO = '5eed0000-0000-4000-8000-000000000022'
const NOEUDS = {
	prospection: '5eed0000-0000-4000-8000-000000000041',
	negociation: '5eed0000-0000-4000-8000-000000000043',
	signature: '5eed0000-0000-4000-8000-000000000044',
}
const JETABLE = {
	workflow: 'e1180000-0000-4000-8000-0000000001a1',
	prospection: 'e1180000-0000-4000-8000-0000000001b1',
	negociation: 'e1180000-0000-4000-8000-0000000001b2',
	signature: 'e1180000-0000-4000-8000-0000000001b3',
	channel: 'e1180000-0000-4000-8000-0000000001c1',
	affaire: 'e1180000-0000-4000-8000-0000000001d1',
}
const ETAPES_DEFAUT = { prospection: '5eed0000-0000-4000-8000-000000000061', negociation: '5eed0000-0000-4000-8000-000000000063' }
const TRANSITION_RELANCER = '5eed0000-0000-4000-8000-000000000071'
const TRANSITION_DOUBLON = 'e1180000-0000-4000-8000-0000000001e1'
const CHECKLISTS = '/tracks/studio-web/checklists'
const REFONTE = '/tracks/studio-web/refonte'
const ETAPE_NEGOCIATION_CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6813'
const ESPACE_VIDE = { id: 'e1180000-0000-4000-8000-0000000000f1', slug: 'atelier-manuel-18', nom: 'Atelier Morel' }

const liste = (page: Page) => page.getByRole('navigation', { name: 'Choisir un workflow' })
const entete = (page: Page) => page.getByTestId('entete-workflow')
const panneauIa = (page: Page) => page.getByTestId('ia-panneau')

async function simuler(page: Page, scenario: string): Promise<void> {
	await page.route('**/functions/v1/ia/**', async (route) => {
		await route.continue({ headers: { ...route.request().headers(), 'x-ia-simulateur': scenario } })
	})
}

/** Amène une cible au milieu de la fenêtre : collée au bord, sa boîte déborde d'une fraction de pixel. */
async function centrer(cible: Locator): Promise<void> {
	await cible.evaluate((element) => element.scrollIntoView({ block: 'center' }))
}

async function ouvrir(page: Page, nom: string): Promise<void> {
	await page.goto(EDITEUR)
	const bouton = liste(page).getByRole('button', { name: new RegExp(`^${nom}`) })
	await bouton.click()
	await expect(bouton).toHaveAttribute('aria-current', 'true')
}

async function roleDe(request: APIRequestContext, nom: string, role: string): Promise<void> {
	const [membre] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent(nom)}&select=id`)
	if (membre === undefined) throw new Error(`${nom} est absente du seed`)
	await service(request, 'patch', `workspace_members?workspace_id=eq.${WORKSPACE_SEED}&user_id=eq.${membre.id}`, { role })
}

// L'épilogue : un espace garde toujours un administrateur (`last_workspace_admin`), d'où l'ordre des deux rôles.
async function ranger(request: APIRequestContext): Promise<void> {
	await roleDe(request, 'Camille Aubert', 'admin')
	await roleDe(request, 'Farida Nowak', 'viewer')
	for (const demande of DEMANDES) {
		const creees = await lireService<{ workflow_cree_id: string | null }[]>(
			request,
			`suggestions_ia?demande=eq.${encodeURIComponent(demande)}&select=workflow_cree_id`,
		)
		for (const { workflow_cree_id } of creees) if (workflow_cree_id !== null) await service(request, 'delete', `workflows?id=eq.${workflow_cree_id}`)
		await service(request, 'delete', `suggestions_ia?demande=eq.${encodeURIComponent(demande)}`)
	}
	await service(request, 'delete', `cards?id=eq.${JETABLE.affaire}`)
	await service(request, 'delete', `channels?id=eq.${JETABLE.channel}`)
	await service(request, 'delete', `workflows?id=eq.${JETABLE.workflow}`)
	await service(request, 'delete', `workflows?workspace_id=eq.${WORKSPACE_SEED}&name=eq.${encodeURIComponent(NOM_VIDE)}`)
	await service(request, 'delete', `workflow_transitions?id=eq.${TRANSITION_DOUBLON}`)
	await service(request, 'delete', `workflow_nodes_catalog?workspace_id=eq.${WORKSPACE_SEED}&key=eq.qualification-ia`)
	await service(request, 'delete', `card_common_fields?workspace_id=eq.${WORKSPACE_SEED}&key=in.(${CHAMPS_COMMUNS.join(',')})`)
	// Le seed n'archive aucun point de checklist : celui qu'une image a archivé est rendu, même si le test a échoué.
	await service(request, 'patch', `workflow_step_checklist_items?workspace_id=eq.${WORKSPACE_SEED}&archived_at=not.is.null`, { archived_at: null })
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

test('l’éditeur, et un rôle retiré pendant que la page est ouverte', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages')
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'reglages', cibles: [page.getByRole('link', { name: /^Workflows : étapes et composition/ })] })
	await ouvrir(page, DEFAUT)
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'editeur', cibles: [], pleinePage: true })

	// Un geste de composition — déclarer une question — sur le workflow par défaut, refusé par le serveur.
	await page.getByRole('button', { name: 'Déclarer un champ' }).click()
	const formulaire = page.getByTestId('formulaire-champ')
	await formulaire.getByLabel('Clé').fill('canal-acquisition')
	await formulaire.getByLabel('Libellé').fill('Canal d’acquisition')
	// Farida Nowak administre le temps du test : l'espace ne peut pas rester sans administrateur.
	await roleDe(request, 'Farida Nowak', 'admin')
	await roleDe(request, 'Camille Aubert', 'viewer')
	await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
	await expect(formulaire.getByText('Seul un administrateur de cet espace de travail peut composer un workflow.')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'refus-role', cibles: [formulaire] })
})

test('créer un workflow vide, le renommer, l’archiver, et l’en-tête du défaut', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrir(page, DEFAUT)
	await illustrer(page, { chapitre: CHAPITRE, section: S.choisir, nom: 'en-tete', cibles: [entete(page)] })

	const nouveau = page.getByRole('button', { name: 'Nouveau workflow', exact: true })
	await nouveau.click()
	const formulaire = page.getByTestId('workflows-formulaire-creation')
	await formulaire.getByLabel('Nom').fill(NOM_VIDE)
	await formulaire.getByLabel('Portée').selectOption('track')
	await illustrer(page, { chapitre: CHAPITRE, section: S.creer, nom: 'propre-a-un-track', cibles: [formulaire] })
	await formulaire.getByLabel('Portée').selectOption('global')
	// Le bouton cède la place au formulaire : l'image pleine page de l'introduction le montre.
	await illustrer(page, { chapitre: CHAPITRE, section: S.creer, nom: 'nouveau-workflow', cibles: [formulaire] })
	await formulaire.getByRole('button', { name: 'Créer' }).click()
	await expect(entete(page).getByRole('heading', { level: 2 })).toHaveText(NOM_VIDE)
	const vide = page.getByText('Ce workflow n’a aucune étape.').or(page.getByText("Ce workflow n'a aucune étape.")).first()
	await expect(vide).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.creer, nom: 'workflow-vide', cibles: [entete(page), vide] })

	await entete(page).getByRole('button', { name: `Renommer le workflow ${NOM_VIDE}` }).click()
	const champ = page.getByLabel('Nom du workflow')
	await expect(champ).toBeFocused()
	await illustrer(page, { chapitre: CHAPITRE, section: S.choisir, nom: 'renommer', cibles: [entete(page)] })
	await page.keyboard.press('Escape')

	await entete(page).getByRole('button', { name: `Archiver le workflow ${NOM_VIDE}` }).click()
	await page.getByTestId('entete-workflow-archivage').getByRole('button', { name: 'Archiver' }).click()
	await liste(page).getByLabel('Afficher les archivés').check()
	const archive = liste(page).getByRole('button', { name: new RegExp(`^${NOM_VIDE}`) })
	await expect(archive).toContainText('Archivé')
	await illustrer(page, { chapitre: CHAPITRE, section: S.choisir, nom: 'afficher-les-archives', cibles: [liste(page).getByLabel('Afficher les archivés'), archive] })

	// « Changer de workflow » vit sur la ligne d'un channel, dans l'arborescence : le panneau est ouvert, puis fermé.
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Déplier Conseil & IA' }).click()
	await page.getByRole('button', { name: 'Changer le workflow du channel Prospection' }).click()
	const panneau = page.getByTestId('panneau-changement-workflow')
	await expect(panneau).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.choisir, nom: 'changer-de-workflow', cibles: [panneau] })
	await panneau.getByRole('button', { name: 'Annuler' }).click()

	// Arrivé depuis le formulaire d'un channel : le bandeau « Vous créez un channel ».
	await page.getByRole('button', { name: 'Déplier Formation' }).click()
	await page.getByRole('button', { name: 'Nouveau channel' }).first().click()
	await page.getByTestId('formulaire-channel').getByRole('link', { name: 'Nouveau workflow' }).click()
	const bandeau = page.getByText('Vous créez un channel', { exact: false }).first()
	await expect(bandeau).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.creer, nom: 'vous-creez-un-channel', cibles: [bandeau, page.getByTestId('workflows-formulaire-creation')] })
})

test.describe('dans un espace sans workflow', () => {
	let compte: Compte | null = null
	test.beforeAll(async ({ request }) => {
		compte = await monterEspaceNeuf(request, ESPACE_VIDE, { prenom: 'Claire', nom: 'Morel' })
	})
	test.afterAll(async ({ request }) => {
		await demonterEspaceNeuf(request, ESPACE_VIDE, compte)
	})

	test('aucun workflow', async ({ page }) => {
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await page.goto(EDITEUR)
		const vide = page.getByText('Aucun workflow dans cet espace de travail').first()
		await expect(vide).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.creer, nom: 'aucun-workflow', cibles: [vide.locator('xpath=ancestor::*[.//button][1]')] })
	})
})

test('créer un workflow avec l’IA : demander, relire, corriger, abandonner', async ({ page }) => {
	await simuler(page, 'valide')
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(EDITEUR)
	// Une étape qui garde le nom donné par une suggestion porte la mention « Libellé surchargé » : le seed en a une.
	const surchargee = page.getByTestId('ligne-etape').filter({ hasText: 'Libellé surchargé' }).first()
	await surchargee.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'libelle-surcharge', cibles: [surchargee] })
	const enRevue = page.getByTestId('ia-suggestions-en-revue')
	await expect(enRevue).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'suggestions-en-revue', cibles: [enRevue] })

	const creer = page.getByRole('button', { name: 'Créer avec l’IA' })
	await creer.click()
	await page.getByLabel('Décrivez le workflow').fill(DEMANDE_CREATION)
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'demander', cibles: [page.getByRole('button', { name: 'Nouveau workflow', exact: true }), creer, panneauIa(page)] })
	await page.getByRole('button', { name: 'Générer la suggestion' }).click()
	await expect(panneauIa(page).getByRole('heading', { level: 2, name: 'Suggestion de l’IA' })).toBeVisible()
	const premiere = page.getByTestId('ia-etape').first()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'relire', cibles: [panneauIa(page).getByText(/^Suggestion — rien n.est créé avant/).first(), premiere] })

	await premiere.getByLabel(/Nom de l.étape/).fill('Premier échange')
	await expect(page.getByTestId('ia-modifie')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'corriger', cibles: [premiere] })
	const gestes = page.getByRole('button', { name: 'Accepter et créer le workflow' }).locator('..')
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'gestes', cibles: [page.getByRole('button', { name: 'Revoir avec l’IA' }), gestes] })
	await page.getByRole('button', { name: 'Rétablir' }).click()

	await page.getByRole('button', { name: 'Abandonner la suggestion' }).click()
	const confirmation = page.getByRole('group', { name: 'Abandonner la suggestion' })
	await expect(confirmation).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'abandonner', cibles: [confirmation] })
	await confirmation.getByRole('button', { name: 'Abandonner', exact: true }).click()
	await expect(panneauIa(page)).toHaveCount(0)
})

test('créer avec l’IA : les champs communs exigés', async ({ page, request }) => {
	// Les champs de l'espace et la révision sont posés par la clé de service : la révision prend le chemin d'une
	// correction (docs/SPEC-ia.md §12.2), et la base en calcule les défauts comme pour toute autre.
	const [actif, archive] = CHAMPS_COMMUNS
	await service(request, 'post', 'card_common_fields', [
		{ workspace_id: WORKSPACE_SEED, key: actif, label: 'Numéro de TVA', type: 'text', archived_at: null },
		{ workspace_id: WORKSPACE_SEED, key: archive, label: 'Ancien code client', type: 'text', archived_at: new Date().toISOString() },
	])
	const id = 'e1120000-0000-4000-8000-0000000000a1'
	await service(request, 'post', 'suggestions_ia', { id, workspace_id: WORKSPACE_SEED, portee: 'workflow', demande: DEMANDE_CHAMPS_COMMUNS })
	await service(request, 'post', 'suggestions_ia_revisions', {
		suggestion_id: id,
		origine: 'correction',
		proposition: {
			version: 1,
			workflow: { nom: 'Devis avec TVA' },
			noeuds: [
				{ cle: 'demande-de-devis', libelle: 'Demande de devis', nature: 'open', probabilite: 20 },
				{ cle: 'devis-envoye', libelle: 'Devis envoyé', nature: 'open', probabilite: 50 },
				{ cle: 'devis-signe', libelle: 'Devis signé', nature: 'won', probabilite: 100 },
			],
			etapes: [
				{ noeud: 'demande-de-devis', initiale: true, label: null, probability: null },
				{ noeud: 'devis-envoye', initiale: false, label: null, probability: null },
				{ noeud: 'devis-signe', initiale: false, label: null, probability: null },
			],
			transitions: [
				{ de: 'demande-de-devis', vers: 'devis-envoye', libelle: 'Envoyer le devis', commentaire_requis: false },
				{ de: 'devis-envoye', vers: 'devis-signe', libelle: 'Signer', commentaire_requis: false },
			],
			champs: [],
			regles: [],
			exigences: [],
			exigences_communes: [
				{ de: 'devis-envoye', vers: 'devis-signe', champ: actif },
				{ de: 'devis-envoye', vers: 'devis-signe', champ: archive },
			],
		},
	})
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(EDITEUR)
	await page.getByTestId('ia-suggestions-en-revue').getByRole('button', { name: new RegExp(DEMANDE_CHAMPS_COMMUNS) }).click()
	const section = page.getByTestId('ia-exigences-communes')
	await expect(section.getByTestId('ia-exigence-commune')).toHaveCount(2)
	await expect(section).toContainText('Numéro de TVA')
	await centrer(section)
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'champs-communs', cibles: [section] })
})

test('créer avec l’IA : un nœud du catalogue redéclaré, un champ « montant », un échec, un refus', async ({ page, request }) => {
	await simuler(page, 'catalogue')
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(EDITEUR)
	await page.getByRole('button', { name: 'Créer avec l’IA' }).click()
	await page.getByLabel('Décrivez le workflow').fill(DEMANDE_CATALOGUE)
	await page.getByRole('button', { name: 'Générer la suggestion' }).click()
	const defauts = page.getByTestId('ia-defauts')
	await expect(defauts).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'defauts', cibles: [defauts] })
	const utiliser = page.getByRole('button', { name: 'Utiliser le nœud du catalogue' }).first()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'utiliser-le-noeud-du-catalogue', cibles: [utiliser.locator('xpath=ancestor::*[@data-testid="ia-etape"][1]').or(utiliser).first()] })
	const montant = panneauIa(page).locator('select').filter({ has: page.locator('option:checked', { hasText: 'Montant' }) }).first()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'champ-montant', cibles: [montant.locator('xpath=ancestor::li[1]')] })
	await utiliser.click()
	await expect(page.getByTestId('ia-modifie')).toBeVisible()
	await page.keyboard.press('Escape')

	// Un échec de génération : la suggestion le dit, et « Réessayer » relance la même demande.
	await page.unrouteAll({ behavior: 'wait' })
	await simuler(page, 'invalide')
	await page.goto(EDITEUR)
	await page.getByRole('button', { name: 'Créer avec l’IA' }).click()
	await page.getByLabel('Décrivez le workflow').fill(DEMANDE_ECHEC)
	await page.getByRole('button', { name: 'Générer la suggestion' }).click()
	const reessayer = page.getByRole('button', { name: 'Réessayer' }).first()
	await expect(reessayer).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'echec', cibles: [reessayer.locator('xpath=ancestor::*[self::section or self::li or @data-testid][1]')] })
	await page.keyboard.press('Escape')

	// Le refus du serveur : l'administratrice perd son rôle pendant que le panneau est ouvert.
	await page.unrouteAll({ behavior: 'wait' })
	await simuler(page, 'valide')
	await page.goto(EDITEUR)
	await page.getByRole('button', { name: 'Créer avec l’IA' }).click()
	await page.getByLabel('Décrivez le workflow').fill(DEMANDE_CREATION)
	await roleDe(request, 'Farida Nowak', 'admin')
	await roleDe(request, 'Camille Aubert', 'viewer')
	await page.getByRole('button', { name: 'Générer la suggestion' }).click()
	const refus = panneauIa(page).getByText('L’assistant est réservé aux administrateurs de l’espace de travail.')
	await expect(refus).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.ia, nom: 'refus', cibles: [panneauIa(page)] })
})

test('faire évoluer un workflow avec l’IA, jusqu’au point de retour', async ({ page, request }) => {
	await service(request, 'post', 'workflows', [{ id: JETABLE.workflow, workspace_id: WORKSPACE_SEED, name: NOM_JETABLE, scope: 'global', is_default: false }])
	await service(request, 'post', 'workflow_steps', [
		{ id: JETABLE.prospection, workflow_id: JETABLE.workflow, workspace_id: WORKSPACE_SEED, node_id: NOEUDS.prospection, position: 1, is_initial: true },
		{ id: JETABLE.negociation, workflow_id: JETABLE.workflow, workspace_id: WORKSPACE_SEED, node_id: NOEUDS.negociation, position: 2, is_initial: false },
		{ id: JETABLE.signature, workflow_id: JETABLE.workflow, workspace_id: WORKSPACE_SEED, node_id: NOEUDS.signature, position: 3, is_initial: false },
	])
	await service(request, 'post', 'workflow_transitions', [
		{ workflow_id: JETABLE.workflow, workspace_id: WORKSPACE_SEED, from_step_id: JETABLE.prospection, to_step_id: JETABLE.negociation, label: 'Négocier' },
		{ workflow_id: JETABLE.workflow, workspace_id: WORKSPACE_SEED, from_step_id: JETABLE.negociation, to_step_id: JETABLE.signature, label: 'Signer' },
	])
	await service(request, 'post', 'channels', [
		{ id: JETABLE.channel, workspace_id: WORKSPACE_SEED, track_id: TRACK_STUDIO, workflow_id: JETABLE.workflow, name: 'Partenaires', slug: 'partenaires-manuel' },
	])
	await poserAffaire(request, { id: JETABLE.affaire, titre: 'Partenariat Orbis', channel: JETABLE.channel, workflow: JETABLE.workflow, etape: JETABLE.negociation })

	await simuler(page, 'modification')
	await connecterAvecLeLabs(page, ADMIN)
	// Les suggestions du seed pour son workflow par défaut, et la demande telle que le manuel la cite.
	await ouvrir(page, DEFAUT)
	const duWorkflow = page.getByTestId('ia-suggestions-du-workflow')
	await expect(duWorkflow).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.evoluer, nom: 'suggestions-du-workflow', cibles: [duWorkflow] })
	const suggerer = page.getByRole('button', { name: /^Suggérer des étapes pour/ })
	await suggerer.click()
	await page.getByLabel('Décrivez ce qui doit changer').fill(DEMANDE_EVOLUTION)
	await illustrer(page, { chapitre: CHAPITRE, section: S.evoluer, nom: 'decrire-ce-qui-doit-changer', cibles: [suggerer, panneauIa(page)] })
	await page.keyboard.press('Escape')

	await ouvrir(page, NOM_JETABLE)
	await page.getByRole('button', { name: /^Suggérer des étapes pour/ }).click()
	await page.getByLabel('Décrivez ce qui doit changer').fill(DEMANDE_EVOLUTION)
	await page.getByRole('button', { name: 'Générer la suggestion' }).click()
	const differentiel = page.getByTestId('ia-differentiel')
	await expect(differentiel).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.evoluer, nom: 'ce-qui-change', cibles: [differentiel] })
	const remappages = page.getByTestId('ia-remappages')
	await centrer(remappages)
	await illustrer(page, { chapitre: CHAPITRE, section: S.evoluer, nom: 'ou-vont-les-affaires', cibles: [remappages] })
	await illustrer(page, { chapitre: CHAPITRE, section: S.evoluer, nom: 'accepter', cibles: [page.getByRole('button', { name: 'Accepter et faire évoluer le workflow' }).locator('..')] })
	await remappages.getByLabel(/^Destination des affaires de/).selectOption('qualification-ia')
	await page.getByRole('button', { name: 'Accepter et faire évoluer le workflow' }).click()
	const retour = page.getByRole('status').filter({ hasText: 'Point de retour : version' })
	await expect(retour).toHaveCount(1)
	const versions = page.getByTestId('tableau-versions')
	// L'annonce du point de retour est faite aux lecteurs d'écran ; l'écran montre les étapes devenues, et la version.
	await illustrer(page, { chapitre: CHAPITRE, section: S.evoluer, nom: 'apres-evolution', cibles: [page.getByTestId('liste-etapes')] })
	await centrer(versions)
	await illustrer(page, { chapitre: CHAPITRE, section: S.evoluer, nom: 'point-de-retour-dans-les-versions', cibles: [page.getByRole('heading', { name: 'Versions', exact: true }), versions] })
	await illustrer(page, { chapitre: CHAPITRE, section: S.versions, nom: 'versions', cibles: [page.getByRole('heading', { name: 'Versions', exact: true }), versions] })
})

test('les étapes, les transitions, les questions et leur visibilité', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrir(page, DEFAUT)
	const etapes = page.getByTestId('liste-etapes')
	await expect(page.getByTestId('ligne-etape').first()).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.etapes, nom: 'etapes', cibles: [etapes.locator('xpath=ancestor::section[1]').getByRole('heading').first(), page.getByTestId('ligne-etape').nth(2)] })
	const ajouter = page.getByRole('button', { name: 'Ajouter une étape' })
	await illustrer(page, { chapitre: CHAPITRE, section: S.etapes, nom: 'ajouter-une-etape', cibles: [page.getByTestId('ligne-etape').last(), ajouter] })

	// Les transitions : « Motif exigé » sur les sorties vers Perdu, puis une déclaration doublée par un autre poste.
	const motif = page.getByTestId('ligne-transition').filter({ hasText: 'Motif exigé' }).first()
	await motif.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.transitions, nom: 'transitions', cibles: [page.getByRole('heading', { name: 'Transitions déclarées' }), motif] })
	const declarer = page.getByRole('button', { name: 'Déclarer une transition' })
	await declarer.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.transitions, nom: 'declarer-une-transition', cibles: [page.getByText('Aucune sortie : les cards s’y arrêtent.').last(), declarer] })
	await declarer.click()
	const transition = page.getByTestId('formulaire-transition')
	await transition.getByLabel('Étape de départ').selectOption({ label: 'Prospection' })
	await transition.getByLabel('Étape d’arrivée').selectOption({ label: 'Négociation' })
	await service(request, 'post', 'workflow_transitions', [
		{ id: TRANSITION_DOUBLON, workflow_id: '5eed0000-0000-4000-8000-000000000051', workspace_id: WORKSPACE_SEED, from_step_id: ETAPES_DEFAUT.prospection, to_step_id: ETAPES_DEFAUT.negociation },
	])
	await transition.getByRole('button', { name: 'Enregistrer' }).click()
	await expect(transition.getByText('Cette transition est déjà déclarée.')).toBeVisible()
	await centrer(transition)
	await illustrer(page, { chapitre: CHAPITRE, section: S.transitions, nom: 'deja-declaree', cibles: [transition] })
	await service(request, 'delete', `workflow_transitions?id=eq.${TRANSITION_DOUBLON}`)
	await page.goto(EDITEUR)

	// Les questions : la clé prise, les types à choix, le montant, la question archivée.
	const champs = page.getByRole('heading', { name: 'Champs du formulaire' })
	await champs.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.questions, nom: 'champs-du-formulaire', cibles: [champs, page.getByTestId('ligne-champ').first()] })
	const declarerChamp = page.getByRole('button', { name: 'Déclarer un champ' })
	await declarerChamp.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.questions, nom: 'declarer-un-champ', cibles: [page.getByTestId('ligne-champ').last(), declarerChamp] })
	await declarerChamp.click()
	const champ = page.getByTestId('formulaire-champ')
	await champ.getByLabel('Clé').fill('budget')
	await champ.getByLabel('Libellé').fill('Budget du client')
	await champ.getByRole('button', { name: 'Enregistrer' }).click()
	await expect(champ.getByText('Cette clé est déjà prise dans ce workflow.')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.questions, nom: 'cle-prise', cibles: [page.getByRole('heading', { name: 'Champs du formulaire' }), champ] })
	await champ.getByLabel('Type').selectOption({ label: 'Choix unique' })
	await illustrer(page, { chapitre: CHAPITRE, section: S.questions, nom: 'choix-unique', cibles: [champ] })
	await champ.getByLabel('Type').selectOption({ label: 'Choix multiple' })
	await illustrer(page, { chapitre: CHAPITRE, section: S.questions, nom: 'choix-multiple', cibles: [champ.getByLabel('Type')] })
	await champ.getByLabel('Type').selectOption({ label: 'Montant' })
	await illustrer(page, { chapitre: CHAPITRE, section: S.questions, nom: 'montant', cibles: [champ] })
	await champ.getByRole('button', { name: 'Annuler' }).click()
	const archive = page.getByTestId('ligne-champ').filter({ has: page.getByTestId('champ-archive') }).first()
	await archive.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.questions, nom: 'question-archivee', cibles: [archive] })

	// La grille : ses états, puis la confirmation d'une exigence, annulée.
	const grille = page.getByTestId('grille-visibilites')
	await grille.scrollIntoViewIfNeeded()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: S.visibilite,
		nom: 'grille',
		cibles: [page.getByRole('heading', { name: 'Visibilité des champs, étape par étape' }), page.getByTestId('ligne-grille').nth(3)],
	})
	await illustrer(page, { chapitre: CHAPITRE, section: S.exigences, nom: 'regle-exigee', cibles: [page.getByTestId('ligne-grille').first()] })
	await illustrer(page, { chapitre: CHAPITRE, section: S.effets, nom: 'etats-d-une-case', cibles: [page.getByTestId('ligne-grille').nth(1), page.getByTestId('ligne-grille').nth(3)] })
	const caseLibre = page.getByTestId('case-visibilite').filter({ has: page.locator('option:checked', { hasText: 'Par défaut' }) }).first()
	await caseLibre.locator('select').or(caseLibre).first().selectOption({ label: 'Exigé' })
	const confirmation = page.getByTestId('confirmation-exigence-case')
	await expect(page.getByTestId('effets-case')).toBeVisible()
	await centrer(confirmation)
	await illustrer(page, { chapitre: CHAPITRE, section: S.effets, nom: 'exiger-une-case', cibles: [confirmation] })
	await confirmation.getByRole('button', { name: 'Annuler' }).click()
	await expect(confirmation).toHaveCount(0)

	// Les exigences d'un chemin, et la mesure d'une exigence nouvelle, annulée.
	const bloc = page.locator(`[data-testid="transition-exigences"][data-transition="${TRANSITION_RELANCER}"]`)
	await bloc.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.exigences, nom: 'exigences', cibles: [page.getByRole('heading', { name: 'Champs exigés pour franchir une transition' }), bloc] })
	await illustrer(page, { chapitre: CHAPITRE, section: S.effets, nom: 'exiger-un-champ-bouton', cibles: [bloc.getByRole('button', { name: 'Exiger un champ' })] })
	await bloc.getByRole('button', { name: 'Exiger un champ' }).click()
	const exigence = page.getByTestId('formulaire-exigence')
	await exigence.getByLabel('Champ à exiger').selectOption({ index: 1 })
	await expect(page.getByTestId('effets-exigence')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.effets, nom: 'exiger-un-champ', cibles: [exigence] })
	await exigence.getByRole('button', { name: 'Annuler' }).click()
})

test('les checklists d’un workflow, les points qu’un chemin exige, et le refus du tableau', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrir(page, CHECKLISTS_WF)
	const bloc = page.getByTestId('bloc-checklists-etapes')
	await bloc.scrollIntoViewIfNeeded()
	const ajouterPoint = bloc.getByRole('button', { name: 'Ajouter un point à l’étape Prospection' })
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklists, nom: 'ajouter-un-point', cibles: [ajouterPoint] })
	await ajouterPoint.click()
	await bloc.getByLabel('Libellé du point').fill('Budget validé')
	const premiere = bloc.getByTestId('checklist-point-etape').first()
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklists, nom: 'checklists', cibles: [page.getByRole('heading', { name: 'Checklists des étapes' }), premiere] })
	await page.keyboard.press('Escape')

	// Un point exigé par un chemin, archivé le temps d'une image, puis rétabli.
	const exigerPoint = page.getByRole('button', { name: /^Exiger un point/ }).first()
	await exigerPoint.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklists, nom: 'exiger-un-point', cibles: [exigerPoint] })
	const exiges = page.getByTestId('exigence-point').first()
	await exiges.scrollIntoViewIfNeeded()
	const chemin = exiges.locator('xpath=ancestor::*[@data-testid="transition-exigences"][1]')
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklists, nom: 'points-exiges', cibles: [chemin] })
	const libelle = (await exiges.getByTestId('checklist-libelle-point').or(exiges).first().innerText()).split('\n')[0]!.trim()
	await bloc.getByRole('button', { name: `Archiver le point ${libelle}` }).click()
	const archive = bloc.getByRole('button', { name: `Désarchiver le point ${libelle}` })
	await expect(archive).toBeVisible()
	await centrer(archive)
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklists, nom: 'point-archive', cibles: [archive.locator('xpath=ancestor::li[1]')] })
	const toujours = page.getByText('Toujours exigé : retirez l’exigence pour ne plus bloquer cette transition.').first()
	await toujours.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklists, nom: 'toujours-exige', cibles: [toujours.locator('xpath=ancestor::li[1]')] })
	await archive.click()
	await expect(bloc.getByRole('button', { name: `Archiver le point ${libelle}` })).toBeVisible()

	// Le tableau refuse un déplacement faute de points cochés, et nomme les points.
	await page.goto(CHECKLISTS)
	await page
		.getByTestId('carte-card')
		.filter({ hasText: 'Atelier prompt — Lycée Vauban' })
		.dragTo(page.locator(`[data-testid="colonne"][data-etape="${ETAPE_NEGOCIATION_CHECKLISTS}"]`))
	const bandeau = page.getByTestId('refus-deplacement')
	await expect(bandeau.getByRole('link', { name: 'Cocher ces points' })).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklists, nom: 'cocher-ces-points', cibles: [bandeau] })
	await bandeau.getByRole('link', { name: 'Cocher ces points' }).click()
	const checklist = page.getByTestId('bloc-checklist-card')
	await expect(checklist).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.checklists, nom: 'checklist-de-l-affaire', cibles: [checklist] })
})

test('les modèles d’affaires', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/modeles-affaires')
	const ligne = page.getByTestId('ligne-modele-affaire').first()
	await expect(ligne).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.modeles, nom: 'modeles', cibles: [page.getByTestId('nouveau-modele-affaire'), ligne] })

	await page.getByTestId('nouveau-modele-affaire').click()
	const fiche = page.getByTestId('fiche-modele-affaire')
	await fiche.getByTestId('modele-ajouter-point').click()
	await fiche.getByLabel('Point 1', { exact: true }).fill('Planning validé')
	// La fiche dépasse la fenêtre de 900 px : elle est agrandie le temps de cette image (comme au chapitre 9).
	await page.setViewportSize({ width: 1440, height: 1400 })
	await illustrer(page, { chapitre: CHAPITRE, section: S.modeles, nom: 'nouveau-modele', cibles: [fiche] })
	await page.setViewportSize({ width: 1440, height: 900 })
	await fiche.getByRole('button', { name: 'Annuler' }).click()

	// Le seed porte un modèle archivé, « Atelier découverte (2025) » : il paraît avec la case, et se désarchive.
	await page.getByLabel('Afficher les archivés').check()
	const archivee = page.getByTestId('ligne-modele-affaire').filter({ hasText: 'Archivé' }).first()
	await expect(archivee).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.modeles, nom: 'modele-archive', cibles: [page.getByLabel('Afficher les archivés'), archivee] })

	// « Refonte de site » suit le workflow du modèle « Audit flash » du seed.
	await page.goto(REFONTE)
	const nouvelle = page.getByTestId('nouvelle-affaire')
	await illustrer(page, { chapitre: CHAPITRE, section: S.modeles, nom: 'nouvelle-affaire', cibles: [nouvelle] })
	await nouvelle.click()
	const choix = page.getByLabel('Modèle', { exact: true })
	await choix.selectOption({ label: 'Audit flash' })
	await illustrer(page, { chapitre: CHAPITRE, section: S.modeles, nom: 'choisir-un-modele', cibles: [choix, page.getByTestId('champ-titre-affaire')] })
	await page.keyboard.press('Escape')

	await page.goto(`${REFONTE}/cards/5eed0000-0000-4000-8000-0000000000c4`)
	const enregistrer = page.getByTestId('entete-card-enregistrer-modele')
	await expect(enregistrer).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.modeles, nom: 'enregistrer-comme-modele', cibles: [page.getByRole('button', { name: 'Mettre cette affaire en sommeil' }), enregistrer] })
})
