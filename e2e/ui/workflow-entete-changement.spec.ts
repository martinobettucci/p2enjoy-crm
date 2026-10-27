// @verifies CRM-118 (docs/BACKLOG.md) — tranche T1.b : les écrans — l'en-tête du workflow choisi dans l'éditeur, et
//           « Changer de workflow » sur la ligne d'un channel de l'arborescence
// @verifies docs/SPEC-workflow-engine.md §7 quinquies.2 (renommer, définir par défaut, copier, archiver refusé puis
//           accepté, rétablir, « Afficher les archivés »), §7 quinquies.3 (le mapping explicite, la perte consentie,
//           l'affaire relue à sa destination au board), §7 quinquies.5 (preuves E2E, quatre paliers) ;
//           docs/DESIGN_SYSTEM.md §5.72, §5.59 (la lectrice voit les commandes éteintes) ; CLAUDE.md §16 (captures)
//
// LES DONNÉES DE LA PREUVE SONT POSÉES ET RETIRÉES PAR LA CLÉ DE SERVICE — workflows, channel, affaire et réponse,
// préfixés « E2E T1.b » —, et tout ce que l'écran a écrit est rangé ou rendu dans `afterEach` : le défaut du seed
// d'abord, que d'autres preuves attendent.

import { randomUUID } from 'node:crypto'
import { autoriserErreursConsole, connecterAvecLeLabs, ERREUR_RESSOURCE_HTTP, expect, test, type APIRequestContext } from './fixtures'
import { capturer, PALIERS } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-118'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const ADMIN = 'admin@p2enjoy.test'
const LECTRICE = 'viewer@p2enjoy.test'
const DEFAUT_SEED = '5eed0000-0000-4000-8000-000000000051'
const NOM_DEFAUT_SEED = 'Cycle commercial standard'
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const NOEUDS = {
	prospection: '5eed0000-0000-4000-8000-000000000041',
	relance: '5eed0000-0000-4000-8000-000000000042',
	negociation: '5eed0000-0000-4000-8000-000000000043',
	qualification: '5eed0000-0000-4000-8000-000000000048',
}

/** Les identifiants fixes de la preuve : une exécution interrompue laisse une trace que la suivante écrase. */
const IDS = {
	libre: 'e1180000-0000-4000-8000-0000000000b1',
	ancien: 'e1180000-0000-4000-8000-0000000000b2',
	nouveau: 'e1180000-0000-4000-8000-0000000000b3',
	ancienProspection: 'e1180000-0000-4000-8000-0000000000c1',
	ancienRelance: 'e1180000-0000-4000-8000-0000000000c2',
	nouveauQualification: 'e1180000-0000-4000-8000-0000000000c3',
	nouveauNegociation: 'e1180000-0000-4000-8000-0000000000c4',
	champ: 'e1180000-0000-4000-8000-0000000000d1',
	channel: 'e1180000-0000-4000-8000-0000000000e1',
}
const NOM_LIBRE = 'E2E T1.b libre'
const NOM_RENOMME = 'E2E T1.b renommé'
const NOM_COPIE = 'E2E T1.b copie'
const NOM_ANCIEN = 'E2E T1.b ancien'
const NOM_NOUVEAU = 'E2E T1.b nouveau'
const NOM_CHANNEL = 'E2E T1.b channel'
const SLUG_CHANNEL = 'e2e-t1b-channel'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const service = { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' }

async function poser(request: APIRequestContext, table: string, lignes: unknown): Promise<unknown[]> {
	const reponse = await request.post(rest(table), { headers: service, data: lignes })
	expect(reponse.status(), `${table} : ${await reponse.text()}`).toBe(201)
	return (await reponse.json()) as unknown[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	// Le défaut du seed d'abord : la garde refuse d'archiver un défaut, et d'autres preuves l'attendent.
	await request.patch(rest(`workflows?workspace_id=eq.${ESPACE}&is_default=is.true&id=neq.${DEFAUT_SEED}`), {
		headers: service,
		data: { is_default: false },
	})
	await request.patch(rest(`workflows?id=eq.${DEFAUT_SEED}`), { headers: service, data: { is_default: true } })
	const cartes = await request.get(rest(`cards?channel_id=eq.${IDS.channel}&select=id`), { headers: service })
	for (const { id } of (await cartes.json()) as { id: string }[]) {
		await request.delete(rest(`card_field_values?card_id=eq.${id}`), { headers: service })
		await request.delete(rest(`cards?id=eq.${id}`), { headers: service })
	}
	await request.delete(rest(`channels?id=eq.${IDS.channel}`), { headers: service })
	await request.delete(rest(`workflows?id=in.(${IDS.libre},${IDS.ancien},${IDS.nouveau})`), { headers: service })
	await request.delete(rest(`workflows?workspace_id=eq.${ESPACE}&name=eq.${encodeURIComponent(NOM_COPIE)}`), { headers: service })
}

test.use({ viewport: { width: 1440, height: 900 } })
test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

test.describe('l’en-tête du workflow choisi (§7 quinquies.2)', () => {
	test('renommer, définir par défaut, archiver refusé puis accepté, rétablir, copier vers un track', async ({ page, request }) => {
		await poser(request, 'workflows', [{ id: IDS.libre, workspace_id: ESPACE, name: NOM_LIBRE, scope: 'global' }])
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/workflows')
		const liste = page.getByRole('navigation', { name: 'Choisir un workflow' })
		const entete = page.getByTestId('entete-workflow')

		// Le défaut est choisi d'office ; l'archiver est refusé, car des channels l'emploient.
		await expect(entete.getByRole('heading', { level: 2 })).toHaveText(NOM_DEFAUT_SEED)
		await expect(entete).toContainText('Par défaut')
		await capturer(page, 'entete-workflow-defaut-1440', UNITE)
		await entete.getByRole('button', { name: `Archiver le workflow ${NOM_DEFAUT_SEED}` }).click()
		await expect(page.getByTestId('entete-workflow-archivage')).toContainText(`Archiver le workflow « ${NOM_DEFAUT_SEED} » ?`)
		await capturer(page, 'entete-workflow-archivage-1440', UNITE)
		await page.getByTestId('entete-workflow-archivage').getByRole('button', { name: 'Archiver' }).click()
		await expect(page.getByTestId('entete-workflow-refus')).toContainText(
			/channels? emploi(e|ent) encore ce workflow : change.* de workflow depuis l’arborescence d’abord\./,
		)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await capturer(page, 'entete-workflow-refus-employe-1440', UNITE)
		await page.keyboard.press('Escape')

		// Renommer le workflow libre : le champ prérempli, le nom relu dans le titre et dans la liste.
		await liste.getByRole('button', { name: new RegExp(NOM_LIBRE) }).click()
		await expect(entete.getByRole('heading', { level: 2 })).toHaveText(NOM_LIBRE)
		await entete.getByRole('button', { name: `Renommer le workflow ${NOM_LIBRE}` }).click()
		const champ = page.getByLabel('Nom du workflow')
		await expect(champ).toBeFocused()
		await expect(champ).toHaveValue(NOM_LIBRE)
		await capturer(page, 'entete-workflow-renommage-1440', UNITE)
		await champ.fill(NOM_RENOMME)
		await page.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(entete.getByRole('heading', { level: 2 })).toHaveText(NOM_RENOMME)
		await expect(liste.getByRole('button', { name: new RegExp(NOM_RENOMME) })).toBeVisible()

		// Le définir par défaut : la pilule paraît, la commande disparaît, le défaut du seed s'éteint en base.
		await entete.getByRole('button', { name: `Définir le workflow ${NOM_RENOMME} par défaut` }).click()
		await expect(entete).toContainText('Par défaut')
		await expect(entete.getByRole('button', { name: `Définir le workflow ${NOM_RENOMME} par défaut` })).toHaveCount(0)
		const defauts = await request.get(rest(`workflows?workspace_id=eq.${ESPACE}&is_default=is.true&select=id`), { headers: service })
		expect(await defauts.json()).toEqual([{ id: IDS.libre }])

		// Défaut, il ne s'archive pas — et le refus nomme son recours.
		await entete.getByRole('button', { name: `Archiver le workflow ${NOM_RENOMME}` }).click()
		await page.getByTestId('entete-workflow-archivage').getByRole('button', { name: 'Archiver' }).click()
		await expect(page.getByTestId('entete-workflow-refus')).toHaveText(
			'C’est le workflow par défaut : désignez un autre workflow par défaut d’abord.',
		)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await page.getByTestId('entete-workflow-archivage').getByRole('button', { name: 'Annuler' }).click()

		// Le défaut rendu au seed depuis son propre en-tête ; le workflow libre s'archive alors.
		await liste.getByRole('button', { name: new RegExp(NOM_DEFAUT_SEED) }).click()
		await entete.getByRole('button', { name: `Définir le workflow ${NOM_DEFAUT_SEED} par défaut` }).click()
		await expect(entete).toContainText('Par défaut')
		await liste.getByRole('button', { name: new RegExp(NOM_RENOMME) }).click()
		await entete.getByRole('button', { name: `Archiver le workflow ${NOM_RENOMME}` }).click()
		await page.getByTestId('entete-workflow-archivage').getByRole('button', { name: 'Archiver' }).click()
		await expect(page.getByRole('status').filter({ hasText: `Le workflow « ${NOM_RENOMME} » est archivé.` })).toHaveCount(1)
		await expect(liste.getByRole('button', { name: new RegExp(NOM_RENOMME) })).toHaveCount(0)

		// « Afficher les archivés » le retrouve, avec sa mention ; « Rétablir » le rend.
		await liste.getByLabel('Afficher les archivés').check()
		const archive = liste.getByRole('button', { name: new RegExp(NOM_RENOMME) })
		await expect(archive).toContainText('Archivé')
		await archive.click()
		await expect(entete).toContainText('Archivé')
		await expect(entete.getByRole('button', { name: `Copier le workflow ${NOM_RENOMME} vers un track` })).toHaveCount(0)
		await capturer(page, 'entete-workflow-archive-1440', UNITE)
		await entete.getByRole('button', { name: `Rétablir le workflow ${NOM_RENOMME}` }).click()
		await expect(entete.getByRole('button', { name: `Archiver le workflow ${NOM_RENOMME}` })).toBeVisible()
		await expect(archive).not.toContainText('Archivé')

		// Copier vers un track : la copie devient le workflow choisi, propre au track.
		await entete.getByRole('button', { name: `Copier le workflow ${NOM_RENOMME} vers un track` }).click()
		const copie = page.getByTestId('entete-workflow-copie')
		await expect(copie.getByLabel('Track')).toBeFocused()
		await expect(copie.getByRole('button', { name: 'Copier' })).toBeDisabled()
		await copie.getByLabel('Track').selectOption({ label: 'Conseil & IA' })
		await copie.getByLabel('Nom de la copie').fill(NOM_COPIE)
		await capturer(page, 'entete-workflow-copie-1440', UNITE)
		await copie.getByRole('button', { name: 'Copier' }).click()
		await expect(entete.getByRole('heading', { level: 2 })).toHaveText(NOM_COPIE)
		await expect(entete).toContainText('Conseil & IA')
		await expect(entete.getByRole('button', { name: `Définir le workflow ${NOM_COPIE} par défaut` })).toHaveCount(0)
	})

	test('l’en-tête aux quatre paliers', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/reglages/workflows')
			await expect(page.getByTestId('entete-workflow').getByRole('heading', { level: 2 })).toHaveText(NOM_DEFAUT_SEED)
			await page.getByTestId('entete-workflow').scrollIntoViewIfNeeded()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
			expect(debordement, `aucun défilement horizontal de la page à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await capturer(page, `entete-workflow-palier-${palier.nom}`, UNITE)
		}
	})
})

/** Un channel occupé : l'ancien workflow à deux étapes et un champ, une affaire à « Relance » qui y a répondu. */
async function poserChannelOccupe(request: APIRequestContext): Promise<{ idCard: string; titre: string }> {
	await poser(request, 'workflows', [
		{ id: IDS.ancien, workspace_id: ESPACE, name: NOM_ANCIEN, scope: 'global' },
		{ id: IDS.nouveau, workspace_id: ESPACE, name: NOM_NOUVEAU, scope: 'global' },
	])
	await poser(request, 'workflow_steps', [
		{ id: IDS.ancienProspection, workflow_id: IDS.ancien, workspace_id: ESPACE, node_id: NOEUDS.prospection, position: 1, is_initial: true },
		{ id: IDS.ancienRelance, workflow_id: IDS.ancien, workspace_id: ESPACE, node_id: NOEUDS.relance, position: 2, is_initial: false },
		{ id: IDS.nouveauQualification, workflow_id: IDS.nouveau, workspace_id: ESPACE, node_id: NOEUDS.qualification, position: 1, is_initial: true },
		{ id: IDS.nouveauNegociation, workflow_id: IDS.nouveau, workspace_id: ESPACE, node_id: NOEUDS.negociation, position: 2, is_initial: false },
	])
	await poser(request, 'form_fields', [
		{ id: IDS.champ, workflow_id: IDS.ancien, workspace_id: ESPACE, key: 'e2e-t1b-budget', label: 'Budget annoncé', type: 'text', position: 1 },
	])
	await poser(request, 'channels', [
		{ id: IDS.channel, workspace_id: ESPACE, track_id: TRACK_CONSEIL, workflow_id: IDS.ancien, name: NOM_CHANNEL, slug: SLUG_CHANNEL },
	])
	const idCard = randomUUID()
	const titre = `E2E T1.b affaire ${idCard.slice(0, 8)}`
	await poser(request, 'cards', [
		{ id: idCard, workspace_id: ESPACE, channel_id: IDS.channel, workflow_id: IDS.ancien, current_step_id: IDS.ancienRelance, title: titre },
	])
	const rattachements = await request.get(rest(`card_placements?card_id=eq.${idCard}&select=id`), { headers: service })
	const [rattachement] = (await rattachements.json()) as { id: string }[]
	expect(rattachement, 'le rattachement miroir de l’affaire').toBeDefined()
	await poser(request, 'card_field_values', [
		{ card_id: idCard, field_id: IDS.champ, workflow_id: IDS.ancien, workspace_id: ESPACE, placement_id: rattachement!.id, value: '40 k€' },
	])
	return { idCard, titre }
}

test.describe('changer le workflow d’un channel (§7 quinquies.3)', () => {
	test('un channel occupé change de workflow, la perte consentie, et l’affaire paraît à sa destination au board', async ({ page, request }) => {
		const { idCard, titre } = await poserChannelOccupe(request)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/arborescence')
		await page.getByRole('button', { name: 'Déplier Conseil & IA' }).click()
		const commande = page.getByRole('button', { name: `Changer le workflow du channel ${NOM_CHANNEL}` })
		await commande.click()
		const panneau = page.getByTestId('panneau-changement-workflow')
		await expect(panneau).toContainText(`« ${NOM_CHANNEL} » suit aujourd’hui « ${NOM_ANCIEN} »`)
		await expect(panneau).toContainText('Relance')
		await expect(panneau).toContainText('1 affaire')
		const envoyer = panneau.getByRole('button', { name: 'Changer de workflow' })
		await expect(envoyer).toBeDisabled()

		await panneau.getByLabel('Nouveau workflow').selectOption({ label: NOM_NOUVEAU })
		const destination = panneau.getByLabel(/des affaires de « Relance »/)
		await expect(destination).toHaveValue('')
		await expect(envoyer).toBeDisabled()
		await destination.selectOption({ label: 'Négociation' })
		await capturer(page, 'changement-workflow-panneau-1440', UNITE)
		await envoyer.click()

		// La base mesure la perte ; l'écran la dit, et attend le consentement.
		const perte = page.getByTestId('changement-workflow-perte')
		await expect(perte).toContainText('1 réponse de formulaire serait perdue')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await expect(envoyer).toBeDisabled()
		await capturer(page, 'changement-workflow-perte-1440', UNITE)
		await perte.getByLabel('J’accepte de perdre ces réponses').check()
		await envoyer.click()
		await expect(page.getByRole('status').filter({ hasText: `Le channel « ${NOM_CHANNEL} » suit désormais « ${NOM_NOUVEAU} ».` })).toHaveCount(1)
		await expect(panneau).toHaveCount(0)
		await expect(commande).toBeFocused()

		const relu = await request.get(rest(`channels?id=eq.${IDS.channel}&select=workflow_id`), { headers: service })
		expect(await relu.json()).toEqual([{ workflow_id: IDS.nouveau }])

		await page.goto(`/tracks/conseil-ia/${SLUG_CHANNEL}`)
		await expect(page.locator(`[data-testid="colonne"][data-etape="${IDS.nouveauNegociation}"] [data-card="${idCard}"]`)).toHaveCount(1)
		await expect(page.locator(`[data-testid="carte-card"][data-card="${idCard}"]`)).toContainText(titre)
		await capturer(page, 'changement-workflow-board-1440', UNITE)
	})

	test('le panneau aux quatre paliers', async ({ page, request }) => {
		await poserChannelOccupe(request)
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto('/reglages/arborescence')
			await page.getByRole('button', { name: 'Déplier Conseil & IA' }).click()
			await page.getByRole('button', { name: `Changer le workflow du channel ${NOM_CHANNEL}` }).click()
			const panneau = page.getByTestId('panneau-changement-workflow')
			await panneau.getByLabel('Nouveau workflow').selectOption({ label: NOM_NOUVEAU })
			await expect(panneau.getByRole('option', { name: 'Négociation' })).toHaveCount(1)
			await panneau.scrollIntoViewIfNeeded()
			const boite = await panneau.boundingBox()
			expect(boite, 'le panneau est rendu').not.toBeNull()
			expect(boite!.width, `le panneau tient dans la fenêtre à ${palier.largeur} px`).toBeLessThanOrEqual(palier.largeur)
			await capturer(page, `changement-workflow-palier-${palier.nom}`, UNITE)
		}
	})
})

test('la lectrice voit les commandes de l’en-tête et du channel éteintes, avec le motif', async ({ page }) => {
	await connecterAvecLeLabs(page, LECTRICE)
	await page.goto('/reglages/workflows')
	const entete = page.getByTestId('entete-workflow')
	await expect(entete.getByRole('heading', { level: 2 })).toHaveText(NOM_DEFAUT_SEED)
	for (const bouton of await entete.getByRole('button').all()) await expect(bouton).toBeDisabled()
	await expect(entete.getByRole('button', { name: `Renommer le workflow ${NOM_DEFAUT_SEED}` })).toHaveAttribute(
		'aria-describedby',
		'workflows-lecture-seule',
	)
	await capturer(page, 'entete-workflow-lectrice-1440', UNITE)
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Déplier Conseil & IA' }).click()
	// Un channel que la lectrice lit — « Prospection », du seed : la commande est montée, éteinte, et cite le motif.
	const commande = page.getByRole('button', { name: 'Changer le workflow du channel Prospection' })
	await expect(commande).toBeDisabled()
	await expect(commande).toHaveAttribute('aria-describedby', 'arborescence-lecture-seule')
})
