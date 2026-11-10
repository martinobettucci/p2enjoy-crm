// @spec CRM-133 (docs/BACKLOG.md) — tranche T4 : l'image du champ de description d'un nœud, sur « Prospection » décrit par le
//       seed (manuel §19.3 ; docs/SPEC-seed.md §39 ; docs/DESIGN_SYSTEM.md §5.18)
// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.4 : les images des chapitres 19 à 22 — le catalogue de nœuds, la
//       corbeille, les membres et leurs droits, le journal d'audit
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitres 19, 20, 21, 22 ; docs/SPEC-workflow-engine.md (le
//       catalogue), docs/SPEC-corbeille.md, docs/SPEC-membres.md, docs/SPEC-audit.md
//
// Les écrans sont lus sur le seed. Ce qui s'écrit est défait dans le même scénario : un nœud créé puis archivé est
// retiré par la clé de service ; le rôle de Farida Nowak changé est rendu ; une attente inscrite est retirée par
// l'écran ; chaque confirmation est montrée puis annulée.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, BIZDEV, VIEWER, WORKSPACE_SEED, connecterAvecLeLabs, lireService, service } from './outils'

const CATALOGUE = 'le-catalogue-de-noeuds-le-vocabulaire-de-vos-workflows'
const CORBEILLE = 'la-corbeille-ce-qui-a-ete-retire-et-comment-le-rendre'
const MEMBRES = 'les-membres-de-votre-espace-qui-y-travaille-avec-quel-role'
const JOURNAL = 'le-journal-d-audit-ce-qui-s-est-fait-dans-votre-espace'

async function roleDe(request: APIRequestContext, nom: string, valeur: string): Promise<void> {
	const [membre] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent(nom)}&select=id`)
	if (membre === undefined) throw new Error(`${nom} est absente du seed`)
	await service(request, 'patch', `workspace_members?workspace_id=eq.${WORKSPACE_SEED}&user_id=eq.${membre.id}`, { role: valeur })
}

// Un espace garde toujours un administrateur (`last_workspace_admin`) : Camille d'abord, puis Farida.
test.afterEach(async ({ request }) => {
	await roleDe(request, 'Camille Aubert', 'admin')
	await roleDe(request, 'Farida Nowak', 'viewer')
})

const role = (page: Page, nom: string) => page.getByLabel(`Rôle de ${nom}`)
const message = (page: Page) => page.getByTestId('message-membres')

// Le journal d'abord : il se photographie sur la base fraîchement reconstruite, avant que les gestes des autres
// scénarios n'y laissent leurs lignes (le journal est en ajout seul).
test('le journal d’audit : les entrées, le filtre, une période vide', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages')
	await illustrer(page, { chapitre: JOURNAL, section: 'ouvrir-le-journal', nom: 'reglages', cibles: [page.getByRole('link', { name: /^Journal d’audit/ }), page.getByRole('link', { name: /^Membres/ })] })
	await page.goto('/reglages/membres')
	await illustrer(page, { chapitre: JOURNAL, section: 'ouvrir-le-journal', nom: 'membres', cibles: [page.getByRole('heading', { name: 'Membres', exact: true })] })
	await page.goto('/reglages/journal')
	const tableau = page.getByTestId('tableau-audit')
	await expect(page.getByTestId('ligne-audit').first()).toBeVisible()
	await illustrer(page, { chapitre: JOURNAL, section: null, nom: 'journal', cibles: [], pleinePage: true })
	// Le tableau entier dépasse 2 000 px : l'image garde son en-tête et ses premières lignes, puis la suite à part.
	await illustrer(page, { chapitre: JOURNAL, section: 'lire-une-entree', nom: 'entrees', cibles: [tableau.locator('thead'), page.getByTestId('ligne-audit').nth(5)] })
	const suite = page.getByRole('button', { name: 'Entrées plus anciennes' })
	if ((await suite.count()) > 0) {
		await illustrer(page, { chapitre: JOURNAL, section: 'lire-une-entree', nom: 'entrees-plus-anciennes', cibles: [suite] })
	}
	await page.goto('/reglages/journal?du=2020-01-01&au=2020-01-31')
	const vide = page.getByText('Aucun geste sur cette période').first()
	await expect(vide).toBeVisible()
	await page.getByLabel('Acteur').selectOption({ label: 'Système ou compte supprimé' })
	await illustrer(page, { chapitre: JOURNAL, section: 'filtrer', nom: 'periode-vide', cibles: [page.getByLabel('Famille'), page.getByLabel('Du'), page.getByLabel('Au'), vide] })
})

test('le journal d’audit : une entrée sans acteur', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/journal')
	// Les gestes du seed lui-même n'ont pas d'acteur ; « Entrées plus anciennes » les fait paraître.
	const systeme = page.getByTestId('ligne-audit').filter({ hasText: 'Système ou compte supprimé' }).first()
	for (let page_ = 0; page_ < 4 && (await systeme.count()) === 0; page_ += 1) await page.getByRole('button', { name: 'Entrées plus anciennes' }).click()
	await expect(systeme).toBeVisible()
	await illustrer(page, { chapitre: JOURNAL, section: 'lire-une-entree', nom: 'entree-sans-acteur', cibles: [systeme] })
})

test('le catalogue : la liste, un nœud créé puis archivé', async ({ page, request }) => {
	const cle = 'demonstration'
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/catalogue')
		const liste = page.getByTestId('liste-catalogue')
		await expect(page.getByTestId('ligne-noeud').first()).toBeVisible()
		await illustrer(page, { chapitre: CATALOGUE, section: null, nom: 'catalogue', cibles: [], pleinePage: true })
		await illustrer(page, { chapitre: CATALOGUE, section: 'ce-que-chaque-ligne-montre', nom: 'lignes', cibles: [liste] })

		await page.getByTestId('ouvrir-creation-noeud').click()
		const formulaire = page.getByTestId('formulaire-noeud')
		await formulaire.getByTestId('champ-libelle').fill('Démonstration')
		await illustrer(page, { chapitre: CATALOGUE, section: 'creer-un-noeud', nom: 'nouveau-noeud', cibles: [page.getByTestId('ouvrir-creation-noeud'), formulaire] })
		await formulaire.getByTestId('valider-noeud').click()
		const ligne = page.getByTestId('ligne-noeud').filter({ hasText: 'Démonstration' })
		await expect(ligne).toBeVisible()
		await illustrer(page, { chapitre: CATALOGUE, section: 'modifier-un-noeud', nom: 'modifier', cibles: [ligne] })
		await ligne.getByTestId('archiver-noeud').click()
		await page.getByTestId('confirmer-archivage').click()
		const afficher = page.getByLabel('Afficher les archivés')
		if ((await afficher.count()) > 0) await afficher.check()
		await expect(ligne.getByTestId('pilule-archive')).toBeVisible()
		await illustrer(page, { chapitre: CATALOGUE, section: 'archiver-un-noeud-et-le-retablir', nom: 'archive', cibles: [ligne] })
	} finally {
		await service(request, 'delete', `workflow_nodes_catalog?workspace_id=eq.${WORKSPACE_SEED}&key=eq.${cle}`)
	}
})

test('la corbeille : la liste, un refus de restauration, une dépense qui bloque', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/corbeille')
	const tableau = page.getByTestId('tableau-corbeille')
	await expect(page.getByTestId('ligne-corbeille').first()).toBeVisible()
	await illustrer(page, { chapitre: CORBEILLE, section: null, nom: 'corbeille', cibles: [], pleinePage: true })
	await illustrer(page, { chapitre: CORBEILLE, section: null, nom: 'tableau', cibles: [tableau] })

	const enfant = page.getByTestId('ligne-corbeille').filter({ hasText: 'Annexes 2023' })
	await enfant.getByTestId('bouton-restaurer').click()
	const refus = page.getByTestId('refus-restauration')
	await expect(refus).toBeVisible()
	await illustrer(page, { chapitre: CORBEILLE, section: 'restaurer', nom: 'parent-en-corbeille', cibles: [enfant, refus] })

	const bloque = page.getByTestId('ligne-corbeille').filter({ has: page.getByTestId('pilule-bloque') }).first()
	if ((await bloque.count()) > 0) {
		await illustrer(page, { chapitre: CORBEILLE, section: 'l-effacement-definitif', nom: 'bloque', cibles: [bloque] })
		const reaffecter = bloque.getByTestId('bouton-reaffecter')
		if ((await reaffecter.count()) > 0) {
			await reaffecter.click()
			const panneau = page.getByTestId('panneau-reaffectation')
			await expect(panneau).toBeVisible()
			await illustrer(page, { chapitre: CORBEILLE, section: 'l-effacement-definitif', nom: 'reaffecter', cibles: [panneau] })
			await page.keyboard.press('Escape')
		}
	}
})

// Un autre compte, une autre page : la session de l'administratrice ne se quitte pas au milieu d'un test.
test('la corbeille d’un membre qui n’administre pas l’espace', async ({ page }) => {
	await connecterAvecLeLabs(page, BIZDEV)
	await page.goto('/reglages/corbeille')
	const personnelle = page.getByTestId('corbeille-personnelle')
	await expect(personnelle).toBeVisible()
	await illustrer(page, { chapitre: CORBEILLE, section: null, nom: 'corbeille-personnelle', cibles: [personnelle] })
})

test('la corbeille : un rôle retiré pendant que la page est ouverte', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/corbeille')
	const ligne = page.getByTestId('ligne-corbeille').filter({ hasText: 'Legacy 2023' })
	await expect(ligne).toBeVisible()
	// Farida Nowak administre le temps du test : l'espace ne peut pas rester sans administrateur.
	await roleDe(request, 'Farida Nowak', 'admin')
	await roleDe(request, 'Camille Aubert', 'viewer')
	await ligne.getByTestId('bouton-restaurer').click()
	const refus = page.getByText('Rien n’a été restauré : cet objet n’est plus modifiable avec votre compte.').or(page.getByText("Rien n'a été restauré : cet objet n'est plus modifiable avec votre compte.")).first()
	await expect(refus).toBeVisible()
	await illustrer(page, { chapitre: CORBEILLE, section: 'restaurer', nom: 'plus-modifiable', cibles: [ligne, refus] })
})

test('les membres : la liste, un rôle changé puis rendu, le retrait annulé', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/membres')
	await expect(page.getByTestId('ligne-membre')).toHaveCount(3)
	await illustrer(page, { chapitre: MEMBRES, section: null, nom: 'membres', cibles: [], pleinePage: true })
	await page.goto('/reglages')
	await illustrer(page, { chapitre: MEMBRES, section: 'ouvrir-l-ecran', nom: 'reglages', cibles: [page.getByRole('link', { name: /^Arborescence : tracks et channels/ }), page.getByRole('link', { name: /^Membres : personnes et rôles/ })] })
	await page.goto('/reglages/membres')
	await expect(page.getByTestId('ligne-membre')).toHaveCount(3)
	try {
		await role(page, 'Farida Nowak').selectOption('business_developer')
		await expect(message(page)).toHaveText('Rôle de Farida Nowak modifié.')
		await illustrer(page, { chapitre: MEMBRES, section: 'changer-le-role-d-un-membre', nom: 'role-modifie', cibles: [role(page, 'Farida Nowak'), message(page)] })
	} finally {
		await role(page, 'Farida Nowak').selectOption('viewer')
		await expect(role(page, 'Farida Nowak')).toHaveValue('viewer')
	}
	await page.getByRole('button', { name: 'Retirer Driss Lemoine de l’espace' }).click()
	const confirmation = page.getByRole('group', { name: /Retirer Driss Lemoine de l’espace/ })
	await expect(confirmation).toBeVisible()
	await illustrer(page, { chapitre: MEMBRES, section: 'retirer-un-membre-de-l-espace', nom: 'retirer', cibles: [page.getByTestId('ligne-membre').filter({ hasText: 'Driss Lemoine' }), confirmation] })
	await confirmation.getByRole('button', { name: 'Annuler' }).click()
})

test('les attentes : inscrire, remplacer, retirer', async ({ page }) => {
	const adresse = 'jeanne.martin@p2enjoy.test'
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/membres')
	const section = page.getByRole('region', { name: 'Attentes' })
	const inscrire = async (valeur: string) => {
		await section.getByTestId('inscrire-attente').click()
		await section.getByLabel('Adresse').fill(adresse)
		await section.locator('select#attente-role').selectOption(valeur)
		await section.getByRole('button', { name: 'Inscrire', exact: true }).click()
	}
	await section.getByTestId('inscrire-attente').click()
	await section.getByLabel('Adresse').fill(adresse)
	await illustrer(page, { chapitre: MEMBRES, section: 'les-attentes-les-personnes-qu-on-attend', nom: 'inscrire', cibles: [section.getByRole('button', { name: 'Inscrire', exact: true }).locator('xpath=ancestor::form[1]')] })
	await page.keyboard.press('Escape')
	try {
		await inscrire('viewer')
		await expect(section.locator(`[data-email="${adresse}"]`)).toBeVisible()
		await inscrire('admin')
		await expect(section.getByTestId('message-attentes')).toContainText('remplacée')
		await illustrer(page, { chapitre: MEMBRES, section: 'les-attentes-les-personnes-qu-on-attend', nom: 'attentes', cibles: [section] })
	} finally {
		const retrait = section.getByRole('button', { name: `Retirer l’attente de ${adresse}` })
		if ((await retrait.count()) > 0) await retrait.click()
		await expect(section.locator(`[data-email="${adresse}"]`)).toHaveCount(0)
	}
})

test('les droits fins de Farida Nowak', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/membres')
	const droits = page.getByTestId('droits-fins')
	await droits.getByLabel('Membre').selectOption({ label: 'Farida Nowak' })
	await expect(droits.getByRole('row', { name: /^Grands comptes/ }).getByTestId('acces-effectif')).toHaveText('Aucun accès')
	// La grille dépasse la fenêtre de 900 px : elle est agrandie le temps de cette image (comme au chapitre 9).
	await page.setViewportSize({ width: 1440, height: 1400 })
	await illustrer(page, { chapitre: MEMBRES, section: 'les-droits-fins-restreindre-ou-rouvrir-un-track-ou-un-channel', nom: 'droits-fins', cibles: [droits] })
})

test('le journal d’audit vu par une lectrice', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await page.goto('/reglages/journal')
	const refus = page.getByText('Réservé aux administrateurs', { exact: true }).first()
	await expect(refus).toBeVisible()
	await illustrer(page, { chapitre: JOURNAL, section: 'ouvrir-le-journal', nom: 'reserve-aux-administrateurs', cibles: [refus.locator('xpath=ancestor::*[.//p][1]')] })
})

test('CRM-133 : la description d’un nœud, dans son formulaire', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/catalogue')
	await page.getByRole('button', { name: 'Modifier le nœud Prospection' }).click()
	const champ = page.getByTestId('champ-description-noeud')
	await expect(champ).toHaveValue(/Premier contact établi/)
	await champ.scrollIntoViewIfNeeded()
	// Le libellé qui enveloppe le champ et son aide : le bloc entier, et non le seul champ.
	await illustrer(page, { chapitre: CATALOGUE, section: 'modifier-un-noeud', nom: 'description-noeud', cibles: [champ.locator('xpath=..')] })
})
