// @verifies CRM-101 (docs/BACKLOG.md) — tranche T4 : l'écran de la plateforme, sur la pile réelle
// @verifies docs/SPEC-plateforme.md §7 (accès, onglets, fiche, suppression), §6 (effets constatés en base), §8 (seed :
//           Sabine Plateforme amorcée par sa connexion) ; docs/DESIGN_SYSTEM.md §5.56, §7 (quatre paliers, aucun
//           défilement horizontal de la page), §8 (clavier seul, focus rendu)
// @verifies CLAUDE.md §10 (le refus d'une administratrice d'espace, avec ses droits réels), §15 (état déterministe,
//           effets confirmés en base), §16 (captures observées)
//
// Tout part du SEED et de ses comptes réels, connectés par la vraie page du SSO. Les espaces créés portent le préfixe
// `sonde-101` et sont retirés avant et après chaque scénario par la clé de service ; le retrait est CONSTATÉ. L'espace
// seedé n'est jamais modifié : les captures de sa fiche sont des lectures.

import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-101'
const SABINE = 'plateforme@p2enjoy.test'
const CAMILLE = 'admin@p2enjoy.test'
const PREFIXE = 'sonde-101'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function purger(request: APIRequestContext): Promise<void> {
	await request.delete(rest(`workspaces?slug=like.${PREFIXE}*`), { headers: enTetesService() })
	const restants = await request.get(rest(`workspaces?select=slug&slug=like.${PREFIXE}*`), { headers: enTetesService() })
	expect(await restants.json(), 'aucun espace de sonde ne doit rester dans le seed').toEqual([])
}

test.beforeEach(async ({ request }) => purger(request))
test.afterEach(async ({ request }) => purger(request))

async function espaceEnBase(request: APIRequestContext, slug: string) {
	const reponse = await request.get(rest(`workspaces?slug=eq.${slug}&select=id,name,inbound_domain,workspace_members(user_id,role)`), {
		headers: enTetesService(),
	})
	return ((await reponse.json()) as { id: string; name: string; inbound_domain: string | null; workspace_members: { user_id: string; role: string }[] }[])[0]
}

async function sansDefilementHorizontal(page: Page, contexte: string): Promise<void> {
	const debord = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
	expect(debord, `${contexte} : la page ne défile jamais horizontalement (§7)`).toBeLessThanOrEqual(0)
}

test.describe('La plateforme (docs/DESIGN_SYSTEM.md §5.56)', () => {
	test('à la souris : créer un espace, lui donner un administrateur, gérer une attente, le supprimer', async ({ page, request }) => {
		await connecterAvecLeLabs(page, SABINE)
		const entree = page.getByTestId('entree-plateforme')
		await expect(entree).toBeVisible()
		await entree.click()
		await expect(page).toHaveURL(/\/plateforme\/espaces$/u)
		await expect(page.getByTestId('ligne-espace').filter({ hasText: 'p2enjoy' })).toBeVisible()

		await page.getByRole('button', { name: 'Nouvel espace' }).click()
		const formulaire = page.getByTestId('formulaire-espace')
		await formulaire.getByLabel('Nom', { exact: true }).fill('Sonde 101 souris')
		await formulaire.getByLabel('Identifiant court').fill(`${PREFIXE}-souris`)
		await formulaire.getByLabel('Domaine entrant (facultatif)').fill('Crm.Sonde-101.TEST')
		await formulaire.getByRole('button', { name: 'Créer' }).click()
		await expect(page).toHaveURL(new RegExp(`/plateforme/espaces/${PREFIXE}-souris$`, 'u'))
		await expect(page.getByTestId('bandeau-sans-admin')).toBeVisible()
		expect((await espaceEnBase(request, `${PREFIXE}-souris`))?.inbound_domain).toBe('crm.sonde-101.test')

		await page.getByTestId('ajouter-membre').click()
		const formMembre = page.getByTestId('formulaire-membre')
		await formMembre.getByLabel('Personne', { exact: true }).fill('Driss')
		await formMembre.getByTestId('choix-personne').selectOption({ label: 'Driss Lemoine' })
		await formMembre.getByLabel('Rôle').selectOption('admin')
		await formMembre.getByRole('button', { name: 'Ajouter', exact: true }).click()
		await expect(page.getByTestId('message-membres')).toContainText('Driss Lemoine a été ajouté')
		await expect(page.getByTestId('bandeau-sans-admin')).toBeHidden()
		expect((await espaceEnBase(request, `${PREFIXE}-souris`))?.workspace_members).toEqual([
			{ user_id: '5eed0000-0000-4000-8000-000000000012', role: 'admin' },
		])

		// Le dernier administrateur ne se rétrograde pas : la base refuse, l'écran le dit sous le tableau.
		await page.getByLabel('Rôle de Driss Lemoine').selectOption('viewer')
		await expect(page.getByTestId('message-membres')).toContainText('au moins un administrateur')
		await expect(page.getByLabel('Rôle de Driss Lemoine')).toHaveValue('admin')
		// Le refus est un `400` de PostgREST, que le navigateur journalise : c'est celui que ce scénario vient de vérifier.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])

		await page.getByTestId('inscrire-attente').click()
		const formAttente = page.getByTestId('formulaire-attente')
		await formAttente.getByLabel('Adresse').fill('Lea@Sonde-101.TEST')
		await formAttente.getByRole('button', { name: 'Inscrire', exact: true }).click()
		await expect(page.getByTestId('ligne-attente')).toHaveAttribute('data-email', 'lea@sonde-101.test')
		await capturer(page, 'plateforme-fiche-peuplee-xl-1440', UNITE)
		await page.getByRole('button', { name: 'Retirer l’attente de lea@sonde-101.test' }).click()
		await expect(page.getByTestId('message-attentes')).toContainText('retirée')
		await expect(page.getByTestId('attentes-vide')).toBeVisible()

		await page.getByTestId('supprimer-espace').click()
		const confirmer = page.getByRole('button', { name: 'Supprimer définitivement' })
		await expect(confirmer).toBeDisabled()
		await page.getByLabel(/Saisissez/u).fill(`${PREFIXE}-souris`)
		await capturer(page, 'plateforme-suppression-xl-1440', UNITE)
		await confirmer.click()
		await expect(page).toHaveURL(/\/plateforme\/espaces$/u)
		await expect(page.getByTestId('espace-supprime')).toContainText('Sonde 101 souris')
		expect(await espaceEnBase(request, `${PREFIXE}-souris`)).toBeUndefined()

		await page.getByRole('link', { name: 'Journal' }).click()
		await expect(page.getByTestId('ligne-journal').first()).toHaveAttribute('data-geste', 'espace_supprime')
	})

	test('au clavier seul : créer, refermer par Échap avec le focus rendu, supprimer', async ({ page, request }) => {
		await connecterAvecLeLabs(page, SABINE)
		await page.goto('/plateforme/espaces')
		const nouvel = page.getByRole('button', { name: 'Nouvel espace' })
		await nouvel.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByLabel('Nom', { exact: true })).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(nouvel).toBeFocused()

		await page.keyboard.press('Enter')
		await page.keyboard.type('Sonde 101 clavier')
		await page.keyboard.press('Tab')
		await page.keyboard.type(`${PREFIXE}-clavier`)
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`/plateforme/espaces/${PREFIXE}-clavier$`, 'u'))
		expect((await espaceEnBase(request, `${PREFIXE}-clavier`))?.name).toBe('Sonde 101 clavier')

		const supprimer = page.getByTestId('supprimer-espace')
		await supprimer.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByLabel(/Saisissez/u)).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(supprimer).toBeFocused()
		await page.keyboard.press('Enter')
		await page.keyboard.type(`${PREFIXE}-clavier`)
		await page.keyboard.press('Tab')
		await expect(page.getByRole('button', { name: 'Supprimer définitivement' })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('espace-supprime')).toBeVisible()
		expect(await espaceEnBase(request, `${PREFIXE}-clavier`)).toBeUndefined()
	})

	test('une administratrice d’espace ne voit pas l’entrée, et l’adresse ouverte lui rend le refus', async ({ page }) => {
		await connecterAvecLeLabs(page, CAMILLE)
		await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Réglages' })).toBeVisible()
		await expect(page.getByTestId('entree-plateforme')).toHaveCount(0)
		await page.goto('/plateforme/espaces')
		await expect(page.getByTestId('etat-refus')).toContainText('réservée aux superadministrateurs')
		await capturer(page, 'plateforme-refus-xl-1440', UNITE)
	})

	test('les trois onglets et la fiche de l’espace seedé, aux quatre paliers, sans défilement horizontal', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/plateforme/espaces')
			await expect(page.getByTestId('tableau-espaces')).toBeVisible()
			await capturer(page, `plateforme-espaces-${palier.nom}`, UNITE)
			await sansDefilementHorizontal(page, `espaces ${palier.nom}`)

			await page.goto('/plateforme/espaces/p2enjoy')
			await expect(page.getByTestId('tableau-membres')).toBeVisible()
			await expect(page.getByTestId('ligne-attente')).toHaveAttribute('data-email', 'attendu@p2enjoy.test')
			await capturer(page, `plateforme-fiche-${palier.nom}`, UNITE)
			await sansDefilementHorizontal(page, `fiche ${palier.nom}`)

			await page.goto('/plateforme/superadmins')
			await expect(page.getByTestId('ligne-superadmin').filter({ hasText: 'Sabine Plateforme' })).toContainText('Amorçage')
			await capturer(page, `plateforme-superadmins-${palier.nom}`, UNITE)
			await sansDefilementHorizontal(page, `superadministrateurs ${palier.nom}`)

			await page.goto('/plateforme/journal')
			await expect(page.getByTestId('tableau-journal')).toBeVisible()
			await capturer(page, `plateforme-journal-${palier.nom}`, UNITE)
			await sansDefilementHorizontal(page, `journal ${palier.nom}`)
		}
	})
})
