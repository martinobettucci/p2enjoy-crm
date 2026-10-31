// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.4 : les images du chapitre 17, « Administrer l'arborescence : tracks et
//       channels »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 17 ; docs/SPEC-administration-arborescence.md (les
//       gestes, les refus §9, le changement de workflow d'un channel)
//
// L'arborescence est celle du seed, et rien n'y est créé par l'écran : le slug pris et le rôle retiré en cours de page
// sont des refus du serveur. Le changement de workflow se montre sur un channel posé par la clé de service — deux
// workflows, une affaire qui a répondu à une question — et s'arrête au décompte des réponses perdues, que le serveur
// mesure sans rien changer ; tout est retiré après le test, et le rôle de l'administratrice rendu.

import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, WORKSPACE_SEED, connecterAvecLeLabs, detruireAffaire, lireService, poserAffaire, service } from './outils'

const CHAPITRE = 'administrer-l-arborescence-tracks-et-channels'
const TRACK = 'un-track'
const CHANNEL = 'un-channel'
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const NOEUDS = {
	prospection: '5eed0000-0000-4000-8000-000000000041',
	relance: '5eed0000-0000-4000-8000-000000000042',
	negociation: '5eed0000-0000-4000-8000-000000000043',
	qualification: '5eed0000-0000-4000-8000-000000000048',
}
// Des identifiants fixes : une exécution interrompue laisse des lignes que l'épilogue de la suivante retire.
const IDS = {
	ancien: 'e1170000-0000-4000-8000-0000000000a1',
	nouveau: 'e1170000-0000-4000-8000-0000000000a2',
	ancienProspection: 'e1170000-0000-4000-8000-0000000000b1',
	ancienRelance: 'e1170000-0000-4000-8000-0000000000b2',
	nouveauQualification: 'e1170000-0000-4000-8000-0000000000b3',
	nouveauNegociation: 'e1170000-0000-4000-8000-0000000000b4',
	champ: 'e1170000-0000-4000-8000-0000000000c1',
	channel: 'e1170000-0000-4000-8000-0000000000d1',
	affaire: 'e1170000-0000-4000-8000-0000000000e1',
}
const NOM_CHANNEL = 'Partenariats'

const deplier = (page: Page, track: string) => page.getByRole('button', { name: `Déplier ${track}` })

async function idMembre(request: APIRequestContext, nom: string): Promise<string> {
	const [membre] = await lireService<{ id: string }[]>(request, `profiles?full_name=eq.${encodeURIComponent(nom)}&select=id`)
	if (membre === undefined) throw new Error(`${nom} est absente du seed`)
	return membre.id
}

const roleDe = async (request: APIRequestContext, nom: string, role: string) =>
	service(request, 'patch', `workspace_members?workspace_id=eq.${WORKSPACE_SEED}&user_id=eq.${await idMembre(request, nom)}`, { role })

// L'ordre compte : un espace garde toujours un administrateur (`last_workspace_admin`).
async function ranger(request: APIRequestContext): Promise<void> {
	await roleDe(request, 'Camille Aubert', 'admin')
	await roleDe(request, 'Farida Nowak', 'viewer')
	await detruireAffaire(request, IDS.affaire)
	await service(request, 'delete', `channels?id=eq.${IDS.channel}`)
	await service(request, 'delete', `workflows?id=in.(${IDS.ancien},${IDS.nouveau})`)
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

test('l’index des réglages et l’arborescence', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: null,
		nom: 'sections-de-reglages',
		cibles: [page.getByRole('heading', { name: 'Sections de réglages' }), page.getByRole('link', { name: /^Arborescence : tracks et channels/ })],
	})
	await page.goto('/reglages/arborescence')
	await expect(deplier(page, 'Conseil & IA')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'arborescence', cibles: [], pleinePage: true })
})

test('un rôle retiré pendant que la page est ouverte : le serveur refuse', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Nouveau track' }).click()
	const formulaire = page.getByTestId('formulaire-track')
	await formulaire.getByLabel('Nom').fill('Partenaires')
	// Farida Nowak administre le temps du test : l'espace ne peut pas rester sans administrateur.
	await roleDe(request, 'Farida Nowak', 'admin')
	await roleDe(request, 'Camille Aubert', 'viewer')
	await formulaire.getByRole('button', { name: 'Créer' }).click()
	const refus = formulaire.getByRole('alert')
	await expect(refus).toContainText("Seul un administrateur de cet espace de travail peut modifier l'arborescence.")
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'refus-role', cibles: [formulaire] })
})

test('un track : le slug pris, la couleur, les archivés, la restauration', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Nouveau track' }).click()
	const formulaire = page.getByTestId('formulaire-track')
	await formulaire.getByLabel('Nom').fill('Formation')
	await formulaire.getByLabel('Slug').fill('formation')
	await formulaire.getByRole('radio', { name: /Vert/ }).check()
	await formulaire.getByRole('button', { name: 'Créer' }).click()
	await expect(formulaire.getByRole('alert')).toContainText('Ce slug est déjà utilisé.')
	await illustrer(page, { chapitre: CHAPITRE, section: TRACK, nom: 'nouveau-track', cibles: [page.getByRole('button', { name: 'Nouveau track' }), formulaire] })
	await formulaire.getByRole('button', { name: 'Annuler' }).click()

	const afficher = page.getByLabel('Afficher les archivés')
	await afficher.check()
	const archive = page.getByRole('button', { name: /^Désarchiver / }).first()
	await expect(archive).toBeVisible()
	const ligne = page.locator('li').filter({ has: archive }).first()
	await illustrer(page, { chapitre: CHAPITRE, section: TRACK, nom: 'afficher-les-archives', cibles: [afficher, ligne] })

	await page.goto('/reglages/corbeille')
	const restaurer = page.getByTestId('ligne-corbeille').first()
	await expect(restaurer.getByTestId('bouton-restaurer')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: TRACK, nom: 'restaurer', cibles: [restaurer] })
})

test('un channel : le formulaire, le workflow à créer', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/arborescence')
	await deplier(page, 'Formation').click()
	await page.getByRole('button', { name: 'Nouveau channel' }).first().click()
	const formulaire = page.getByTestId('formulaire-channel')
	await formulaire.getByLabel('Nom').fill('Ateliers')
	await expect(formulaire.getByRole('button', { name: 'Créer' })).toBeDisabled()
	await illustrer(page, { chapitre: CHAPITRE, section: CHANNEL, nom: 'nouveau-channel', cibles: [formulaire] })

	// Le lien « Nouveau workflow » ouvre l'éditeur, son formulaire de création déjà ouvert ; rien n'est créé.
	await formulaire.getByRole('link', { name: 'Nouveau workflow' }).click()
	// La portée vient réglée sur ce track ; « Global » se choisit dans la même liste.
	const portee = page.getByLabel('Portée')
	await portee.selectOption('global')
	const retour = page.getByRole('link', { name: /Revenir au nouveau channel/ }).or(page.getByRole('button', { name: /Revenir au nouveau channel/ }))
	await illustrer(page, { chapitre: CHAPITRE, section: CHANNEL, nom: 'nouveau-workflow', cibles: [retour.first(), portee] })
})

test('changer le workflow d’un channel qui porte une affaire', async ({ page, request }) => {
	await service(request, 'post', 'workflows', [
		{ id: IDS.ancien, workspace_id: WORKSPACE_SEED, name: 'Partenariat', scope: 'global' },
		{ id: IDS.nouveau, workspace_id: WORKSPACE_SEED, name: 'Partenariat court', scope: 'global' },
	])
	await service(request, 'post', 'workflow_steps', [
		{ id: IDS.ancienProspection, workflow_id: IDS.ancien, workspace_id: WORKSPACE_SEED, node_id: NOEUDS.prospection, position: 1, is_initial: true },
		{ id: IDS.ancienRelance, workflow_id: IDS.ancien, workspace_id: WORKSPACE_SEED, node_id: NOEUDS.relance, position: 2, is_initial: false },
		{ id: IDS.nouveauQualification, workflow_id: IDS.nouveau, workspace_id: WORKSPACE_SEED, node_id: NOEUDS.qualification, position: 1, is_initial: true },
		{ id: IDS.nouveauNegociation, workflow_id: IDS.nouveau, workspace_id: WORKSPACE_SEED, node_id: NOEUDS.negociation, position: 2, is_initial: false },
	])
	await service(request, 'post', 'form_fields', [
		{ id: IDS.champ, workflow_id: IDS.ancien, workspace_id: WORKSPACE_SEED, key: 'budget-partenaire', label: 'Budget annoncé', type: 'text', position: 1 },
	])
	await service(request, 'post', 'channels', [
		{ id: IDS.channel, workspace_id: WORKSPACE_SEED, track_id: TRACK_CONSEIL, workflow_id: IDS.ancien, name: NOM_CHANNEL, slug: 'partenariats' },
	])
	await poserAffaire(request, { id: IDS.affaire, titre: 'Partenariat Lumen Data', channel: IDS.channel, workflow: IDS.ancien, etape: IDS.ancienRelance })
	const [rattachement] = await lireService<{ id: string }[]>(request, `card_placements?card_id=eq.${IDS.affaire}&select=id`)
	await service(request, 'post', 'card_field_values', [
		{ card_id: IDS.affaire, field_id: IDS.champ, workflow_id: IDS.ancien, workspace_id: WORKSPACE_SEED, placement_id: rattachement!.id, value: '40 k€' },
	])

	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/reglages/arborescence')
	await deplier(page, 'Conseil & IA').click()
	const commande = page.getByRole('button', { name: `Changer le workflow du channel ${NOM_CHANNEL}` })
	await commande.click()
	const panneau = page.getByTestId('panneau-changement-workflow')
	await panneau.getByLabel('Nouveau workflow').selectOption({ label: 'Partenariat court' })
	await panneau.getByLabel(/des affaires de « Relance »/).selectOption({ label: 'Négociation' })
	await illustrer(page, { chapitre: CHAPITRE, section: CHANNEL, nom: 'changer-de-workflow', cibles: [commande, panneau] })
	await panneau.getByRole('button', { name: 'Changer de workflow' }).click()
	// Le serveur mesure la perte et ne change rien tant qu'elle n'est pas acceptée.
	const perte = page.getByTestId('changement-workflow-perte')
	await expect(perte).toContainText('1 réponse de formulaire serait perdue')
	await illustrer(page, { chapitre: CHAPITRE, section: CHANNEL, nom: 'reponses-perdues', cibles: [perte] })
	const [suivi] = await lireService<{ workflow_id: string }[]>(request, `channels?id=eq.${IDS.channel}&select=workflow_id`)
	expect(suivi?.workflow_id, 'rien n’a changé sans le consentement').toBe(IDS.ancien)
})
