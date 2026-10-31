// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.5 : les images des chapitres 32 et 33, « La plateforme » et « Le
//       connecteur MCP »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitres 32, 33 ; docs/SPEC-plateforme.md §7 (les onglets,
//       les espaces, les attentes, la suppression) ; docs/SPEC-mcp.md §6.1 (la matrice), §8 (la page d'accueil), §9 (le
//       journal des appels)
//
// Sabine Roux est la superadministratrice du seed. Ce que l'écran crée se défait par l'écran : l'espace « Atelier
// Lumière » naît, reçoit une attente « En suspens », puis est supprimé par sa propre confirmation ; un droit du
// connecteur accordé à Farida Nowak le temps d'une image lui est retiré par la même grille. L'épilogue retire l'espace
// par la clé de service si le test s'est arrêté avant.

import { expect, test } from '@playwright/test'
import { ORIGINE_MCP } from '../mcp/client'
import { illustrer } from './illustrer'
import { ADMIN, connecterAvecLeLabs, lireService, service } from './outils'

const PLATEFORME = 'la-plateforme-espaces-membres-et-superadministrateurs'
const CONNECTEUR = 'le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant'
const P = {
	ouvrir: 'ouvrir-la-plateforme',
	creer: 'creer-un-espace',
	membres: 'les-membres-d-un-espace',
	attentes: 'les-attentes',
	supprimer: 'modifier-ou-supprimer-un-espace',
	utilisateurs: 'les-utilisateurs',
	superadmins: 'les-superadministrateurs-et-le-journal',
} as const
const C = {
	droit: 'ce-que-l-assistant-a-le-droit-de-faire',
	ajouter: 'ajouter-le-connecteur-a-votre-assistant',
	accorder: 'accorder-des-droits-du-connecteur',
	journal: 'le-journal-des-appels',
	sait: 'ce-que-l-assistant-sait-faire',
} as const
const SABINE = 'plateforme@p2enjoy.test'
const SLUG = 'atelier-lumiere'

test.afterEach(async ({ request }) => {
	const restant = await lireService<{ id: string }[]>(request, `workspaces?slug=eq.${SLUG}&select=id`)
	for (const { id } of restant) {
		await service(request, 'delete', `workspace_invitations?workspace_id=eq.${id}`)
		await service(request, 'delete', `workspaces?id=eq.${id}`)
	}
})

test('ouvrir la plateforme, et ce qu’en voit une administratrice d’espace', async ({ page }) => {
	await connecterAvecLeLabs(page, SABINE)
	await page.goto('/plateforme/espaces')
	await expect(page.getByTestId('tableau-espaces')).toBeVisible()
	await illustrer(page, { chapitre: PLATEFORME, section: null, nom: 'plateforme', cibles: [], pleinePage: true })
	const nav = page.getByRole('navigation', { name: 'Navigation principale' })
	await illustrer(page, { chapitre: PLATEFORME, section: P.ouvrir, nom: 'entree', cibles: [nav.getByRole('link', { name: 'Réglages' }), page.getByTestId('entree-plateforme')] })
	await illustrer(page, {
		chapitre: PLATEFORME,
		section: P.ouvrir,
		nom: 'onglets',
		cibles: [page.getByRole('link', { name: 'Espaces', exact: true }), page.getByRole('link', { name: 'Journal', exact: true })],
	})

})

// Un autre compte, une autre page : la session de la superadministratrice ne se quitte pas au milieu d'un test.
test('la plateforme ouverte par une administratrice d’espace', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/plateforme/espaces')
	const refus = page.getByTestId('etat-refus')
	await expect(refus).toContainText('Accès réservé')
	await illustrer(page, { chapitre: PLATEFORME, section: P.ouvrir, nom: 'acces-reserve', cibles: [refus] })
})

test('un espace créé, une attente en suspens, puis l’espace supprimé', async ({ page }) => {
	await connecterAvecLeLabs(page, SABINE)
	await page.goto('/plateforme/espaces')
	const nouvel = page.getByRole('button', { name: 'Nouvel espace' })
	await illustrer(page, { chapitre: PLATEFORME, section: P.creer, nom: 'nouvel-espace', cibles: [nouvel] })
	await nouvel.click()
	const formulaire = page.getByTestId('formulaire-espace')
	await formulaire.getByLabel('Nom', { exact: true }).fill('Atelier Lumière')
	await formulaire.getByLabel('Identifiant court').fill(SLUG)
	await formulaire.getByLabel('Domaine entrant (facultatif)').fill('crm.atelier-lumiere.test')
	await illustrer(page, { chapitre: PLATEFORME, section: P.creer, nom: 'formulaire', cibles: [formulaire] })
	await formulaire.getByRole('button', { name: 'Créer' }).click()
	await expect(page).toHaveURL(new RegExp(`/plateforme/espaces/${SLUG}$`, 'u'))

	await page.getByTestId('inscrire-attente').click()
	const formAttente = page.getByTestId('formulaire-attente')
	await formAttente.getByLabel('Adresse').fill('lea.martin@atelier-lumiere.test')
	// Une attente qui n'est pas administratrice, dans un espace sans administrateur : elle reste « En suspens ».
	await formAttente.getByLabel('Rôle').selectOption('viewer')
	await formAttente.getByRole('button', { name: 'Inscrire', exact: true }).click()
	const attente = page.getByTestId('ligne-attente').first()
	await expect(attente).toContainText('En suspens')
	await illustrer(page, { chapitre: PLATEFORME, section: P.attentes, nom: 'en-suspens', cibles: [page.getByTestId('bandeau-sans-admin'), attente] })

	await page.goto('/plateforme/espaces')
	const ligne = page.getByTestId('ligne-espace').filter({ hasText: 'Atelier Lumière' })
	await expect(ligne).toContainText('Aucun administrateur')
	await illustrer(page, { chapitre: PLATEFORME, section: P.creer, nom: 'aucun-administrateur', cibles: [ligne] })
	await ligne.getByRole('link').first().click()
	await expect(page).toHaveURL(new RegExp(`/plateforme/espaces/${SLUG}$`, 'u'))
	await illustrer(page, { chapitre: PLATEFORME, section: P.supprimer, nom: 'modifier', cibles: [page.getByRole('button', { name: /^Modifier/ }).first()] })
	await page.getByTestId('supprimer-espace').click()
	await page.getByLabel(/Saisissez/u).fill(SLUG)
	const confirmer = page.getByRole('button', { name: 'Supprimer définitivement' })
	await illustrer(page, { chapitre: PLATEFORME, section: P.supprimer, nom: 'supprimer', cibles: [page.getByLabel(/Saisissez/u), confirmer] })
	await confirmer.click()
	await expect(page.getByTestId('espace-supprime')).toContainText('Atelier Lumière')
})

test('la fiche de l’espace du seed : membres, ajout, attentes', async ({ page }) => {
	await connecterAvecLeLabs(page, SABINE)
	await page.goto('/plateforme/espaces/p2enjoy')
	const membres = page.getByTestId('tableau-membres')
	await expect(membres).toBeVisible()
	await illustrer(page, { chapitre: PLATEFORME, section: P.membres, nom: 'membres', cibles: [membres] })
	await page.getByTestId('ajouter-membre').click()
	const formMembre = page.getByTestId('formulaire-membre')
	await formMembre.getByLabel('Personne', { exact: true }).fill('Sa')
	await illustrer(page, { chapitre: PLATEFORME, section: P.membres, nom: 'ajouter-un-membre', cibles: [formMembre] })
	await page.keyboard.press('Escape')
	const attentes = page.getByTestId('ligne-attente').first()
	await attentes.scrollIntoViewIfNeeded()
	await illustrer(page, { chapitre: PLATEFORME, section: P.attentes, nom: 'attentes', cibles: [page.getByTestId('inscrire-attente'), attentes] })
})

test('les utilisateurs, les superadministrateurs et le journal de la plateforme', async ({ page }) => {
	await connecterAvecLeLabs(page, SABINE)
	await page.goto('/plateforme/utilisateurs')
	await expect(page.getByTestId('ligne-utilisateur').first()).toBeVisible()
	await illustrer(page, { chapitre: PLATEFORME, section: P.utilisateurs, nom: 'utilisateurs', cibles: [page.getByLabel('Rechercher un utilisateur'), page.getByTestId('ligne-utilisateur').nth(3)] })
	const sansEspace = page.getByTestId('ligne-utilisateur').filter({ hasText: 'Aucun espace' }).first()
	if ((await sansEspace.count()) > 0) await illustrer(page, { chapitre: PLATEFORME, section: P.utilisateurs, nom: 'aucun-espace', cibles: [sansEspace] })

	await page.goto('/plateforme/superadmins')
	const superadmin = page.getByTestId('ligne-superadmin').first()
	await expect(superadmin).toBeVisible()
	await illustrer(page, { chapitre: PLATEFORME, section: P.superadmins, nom: 'superadministrateurs', cibles: [page.getByRole('button', { name: /^Accorder le drapeau/ }).first(), superadmin] })
	await page.goto('/plateforme/journal')
	const journal = page.getByTestId('tableau-journal')
	await expect(page.getByTestId('ligne-journal').first()).toBeVisible()
	await illustrer(page, { chapitre: PLATEFORME, section: P.superadmins, nom: 'journal', cibles: [journal.locator('thead'), page.getByTestId('ligne-journal').nth(4)] })
	const plus = page.getByRole('button', { name: 'Entrées plus anciennes' })
	if ((await plus.count()) > 0) await illustrer(page, { chapitre: PLATEFORME, section: P.superadmins, nom: 'entrees-plus-anciennes', cibles: [plus] })
})

test('le connecteur MCP : les comptes, la grille des droits, le journal des appels', async ({ page, request }) => {
	await connecterAvecLeLabs(page, SABINE)
	await page.goto('/plateforme/mcp')
	const comptes = page.getByTestId('tableau-comptes-mcp')
	await expect(comptes).toBeVisible()
	await illustrer(page, { chapitre: CONNECTEUR, section: null, nom: 'connecteur', cibles: [], pleinePage: true })
	await illustrer(page, { chapitre: CONNECTEUR, section: C.accorder, nom: 'comptes', cibles: [page.getByRole('tab', { name: 'Connecteur MCP' }).or(page.getByRole('link', { name: 'Connecteur MCP' })).first(), comptes] })
	await illustrer(page, { chapitre: CONNECTEUR, section: C.accorder, nom: 'accorder', cibles: [page.getByTestId('recherche-accorder')] })
	const appel = page.getByTestId('ligne-appel').first()
	if ((await appel.count()) > 0) {
		await appel.scrollIntoViewIfNeeded()
		await illustrer(page, { chapitre: CONNECTEUR, section: C.journal, nom: 'journal-des-appels', cibles: [page.getByTestId('filtre-issue'), appel] })
	}

	const [farida] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent('Farida Nowak')}&select=id`)
	await page.goto(`/plateforme/mcp/${farida!.id}`)
	const matrice = page.getByTestId('matrice-mcp')
	await expect(matrice).toBeVisible()
	await illustrer(page, { chapitre: CONNECTEUR, section: C.droit, nom: 'familles-et-actions', cibles: [matrice] })
	await illustrer(page, { chapitre: CONNECTEUR, section: C.sait, nom: 'familles', cibles: [matrice] })
	const fiche = page.getByTestId('fiche-mcp')
	await illustrer(page, { chapitre: CONNECTEUR, section: C.accorder, nom: 'fiche', cibles: [fiche.getByRole('heading', { level: 2 }), page.getByTestId('choix-espace-mcp')] })
	const caseAffaires = page.getByRole('checkbox', { name: 'Affaires : consulter' })
	const avant = await caseAffaires.isChecked()
	await caseAffaires.setChecked(!avant)
	await illustrer(page, { chapitre: CONNECTEUR, section: C.accorder, nom: 'modifications', cibles: [page.getByTestId('enregistrer-mcp').locator('..')] })
	await page.getByTestId('enregistrer-mcp').click()
	await expect(page.getByTestId('message-mcp')).toContainText('Droits enregistrés.')
	await illustrer(page, { chapitre: CONNECTEUR, section: C.accorder, nom: 'droits-enregistres', cibles: [page.getByTestId('message-mcp')] })
	// Le droit est rendu à son état du seed par la même grille.
	await caseAffaires.setChecked(avant)
	await page.getByTestId('enregistrer-mcp').click()
	await expect(caseAffaires).toBeChecked({ checked: avant })
})

test('la page d’accueil du connecteur', async ({ page }) => {
	await page.goto(`${ORIGINE_MCP}/`)
	const lien = page.getByRole('link', { name: 'Ouvrir la plateforme du CRM' })
	await expect(lien).toBeVisible()
	await illustrer(page, { chapitre: CONNECTEUR, section: C.ajouter, nom: 'page-d-accueil', cibles: [page.getByRole('button', { name: "Copier l'adresse du connecteur" }), lien] })
})
