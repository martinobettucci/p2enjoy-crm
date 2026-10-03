// @verifies CRM-097 (docs/BACKLOG.md) — tranche T3.d : faire évoluer un workflow existant avec l'IA, sur la pile réelle,
//           à la souris et au clavier seul ; le refus « workflow modifié » ; le refus du commercial ; quatre paliers
// @verifies docs/SPEC-ia.md §13.6 (« Suggérer » en tête des blocs ; le panneau dans la colonne du workflow ; le
//           différentiel ; les affaires des étapes retirées ; accepter et l'annonce du point de retour), §13.4
//           (`PT409`, le point de retour publié), §13.5 (la demande ciblée) ; docs/SPEC-seed.md §16 bis
// @verifies docs/DESIGN_SYSTEM.md §5.53 (et ses précisions : focus rendu à « Suggérer », type d'un champ conservé en
//           texte), §7 (quatre paliers, aucun défilement horizontal de la page), §8 (clavier)
// @verifies CLAUDE.md §10 (le refus prouvé avec le jeton réel du commercial), §15 (état déterministe, effets relus en
//           base), §16 (captures observées)
//
// LE SERVEUR LLM N'EST JAMAIS APPELÉ (docs/SPEC-ia.md §8) : l'en-tête `x-ia-simulateur: modification` choisit le
// scénario qui retire la DEUXIÈME étape et ajoute « qualification-ia ». JAMAIS SUR LE WORKFLOW DU SEED, que toutes les
// autres preuves lisent : chaque scénario qui accepte compose un workflow jetable — prospection, négociation,
// signature, une affaire sur la négociation —, que la clé de service retire ensuite, avec le nœud « qualification-ia »
// qu'une acceptation ajoute au catalogue et les suggestions préfixées — retrait CONSTATÉ. La suggestion de
// modification du seed (§16 bis) n'est que RELUE, aux paliers.

import { randomUUID } from 'node:crypto'
import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	connecterAvecLeLabs,
	expect,
	test,
	type APIRequestContext,
	type Page,
} from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-097'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const EDITEUR = '/reglages/workflows'
const PREFIXE = 'Sonde 097 T3 UI'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const TRACK_SEED = '5eed0000-0000-4000-8000-000000000022'
const NOEUD_PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOEUD_NEGOCIATION = '5eed0000-0000-4000-8000-000000000043'
const NOEUD_SIGNATURE = '5eed0000-0000-4000-8000-000000000044'
const QUALIFICATION = 'qualification-ia'
const DEMANDE_SEED = 'Remplacer la relance par une qualification des besoins'
const NBSP = ' '
const guillemets = (texte: string) => `«${NBSP}${texte}${NBSP}»`

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`

test.use({ viewport: { width: 1440, height: 900 } })

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function inserer(requete: APIRequestContext, table: string, ligne: Record<string, unknown>): Promise<void> {
	const reponse = await requete.post(rest(table), { headers: enTetesService(), data: ligne })
	expect(reponse.status(), `${table} : ${await reponse.text()}`).toBe(201)
}

type Jetable = { workflow: string; nom: string; negociation: string; affaire: string; prospection: string }
const jetables: string[] = []

/** Le workflow jetable : prospection (initiale) → négociation → signature ; une affaire sur la négociation. */
async function workflowJetable(requete: APIRequestContext): Promise<Jetable> {
	const ids = { workflow: randomUUID(), prospection: randomUUID(), negociation: randomUUID(), signature: randomUUID(), channel: randomUUID(), affaire: randomUUID() }
	const nom = `${PREFIXE} ${ids.workflow.slice(0, 8)}`
	await inserer(requete, 'workflows', { id: ids.workflow, workspace_id: ESPACE, name: nom, scope: 'global', is_default: false })
	jetables.push(ids.workflow)
	for (const [id, noeud, position] of [
		[ids.prospection, NOEUD_PROSPECTION, 1], [ids.negociation, NOEUD_NEGOCIATION, 2], [ids.signature, NOEUD_SIGNATURE, 3],
	] as const) {
		await inserer(requete, 'workflow_steps', { id, workflow_id: ids.workflow, workspace_id: ESPACE, node_id: noeud, position, is_initial: position === 1 })
	}
	await inserer(requete, 'workflow_transitions', { workflow_id: ids.workflow, workspace_id: ESPACE, from_step_id: ids.prospection, to_step_id: ids.negociation, label: 'Négocier' })
	await inserer(requete, 'workflow_transitions', { workflow_id: ids.workflow, workspace_id: ESPACE, from_step_id: ids.negociation, to_step_id: ids.signature, label: 'Signer' })
	await inserer(requete, 'channels', {
		id: ids.channel, workspace_id: ESPACE, track_id: TRACK_SEED, name: `tst ia ui ${ids.channel}`, slug: `tst-ia-ui-${ids.channel}`, workflow_id: ids.workflow, position: 99,
	})
	await inserer(requete, 'cards', {
		id: ids.affaire, workspace_id: ESPACE, channel_id: ids.channel, workflow_id: ids.workflow, current_step_id: ids.negociation, title: 'tst ia ui affaire', position: 1,
	})
	return { workflow: ids.workflow, nom, negociation: ids.negociation, affaire: ids.affaire, prospection: ids.prospection }
}

test.afterEach(async ({ request }) => {
	for (const workflow of jetables.splice(0)) {
		await request.delete(rest(`cards?workflow_id=eq.${workflow}`), { headers: enTetesService() })
		await request.delete(rest(`channels?workflow_id=eq.${workflow}`), { headers: enTetesService() })
		expect((await request.delete(rest(`workflows?id=eq.${workflow}`), { headers: enTetesService() })).status()).toBe(204)
	}
	await request.delete(rest(`suggestions_ia?${FILTRE}`), { headers: enTetesService() })
	await request.delete(rest(`workflow_nodes_catalog?workspace_id=eq.${ESPACE}&key=eq.${QUALIFICATION}`), { headers: enTetesService() })
	expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`), 'aucune suggestion de sonde ne doit rester').toEqual([])
	expect(await lireService(request, `workflow_nodes_catalog?select=id&workspace_id=eq.${ESPACE}&key=eq.${QUALIFICATION}`)).toEqual([])
})

/** Ajoute l'en-tête du simulateur à toute requête de la page vers la fonction `ia`. */
async function simuler(page: Page): Promise<void> {
	await page.route('**/functions/v1/ia/**', async (route) => {
		await route.continue({ headers: { ...route.request().headers(), 'x-ia-simulateur': 'modification' } })
	})
}

/** Tabule jusqu'à l'élément dont le nom accessible est donné ; échoue en le nommant s'il n'est pas atteint. */
async function tabulerJusqua(page: Page, nom: string, maximum = 160): Promise<void> {
	for (let pas = 0; pas < maximum; pas += 1) {
		await page.keyboard.press('Tab')
		const courant = await page.evaluate(() => {
			const element = document.activeElement as HTMLElement | null
			return element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? ''
		})
		if (courant === nom) return
	}
	throw new Error(`« ${nom} » n'est pas atteint au clavier en ${maximum} tabulations`)
}

const panneau = (page: Page) => page.getByTestId('ia-panneau')
const suggerer = (bloc: 'étapes' | 'transitions' | 'champs', workflow: string) => `Suggérer des ${bloc} pour ${guillemets(workflow)}`

async function ouvrirLeWorkflow(page: Page, nom: string): Promise<void> {
	await page.goto(EDITEUR)
	const bouton = page.getByRole('navigation', { name: 'Choisir un workflow' }).getByRole('button', { name: new RegExp(`^${nom}`) })
	await bouton.click()
	await expect(bouton).toHaveAttribute('aria-current', 'true')
	await expect(page.getByTestId('ligne-etape')).toHaveCount(3)
}

test.describe('Faire évoluer un workflow avec l’IA (docs/SPEC-ia.md §13)', () => {
	test('à la souris : suggérer, relire ce qui change, choisir où vont les affaires, accepter — le point de retour est annoncé', async ({ page, request }) => {
		const w = await workflowJetable(request)
		await simuler(page)
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeWorkflow(page, w.nom)

		const commande = page.getByRole('button', { name: suggerer('étapes', w.nom) })
		await commande.click()
		await expect(commande).toHaveAttribute('aria-expanded', 'true')
		await expect(panneau(page).getByRole('heading', { level: 2 })).toHaveText(`Faire évoluer les étapes de ${guillemets(w.nom)}`)
		await expect(page.getByLabel('Décrivez ce qui doit changer')).toBeFocused()
		// Le workflow reste visible sous le panneau (§5.53).
		await expect(page.getByTestId('ligne-etape')).toHaveCount(3)
		await page.getByLabel('Décrivez ce qui doit changer').fill(`${PREFIXE} — souris : remplace la négociation par une qualification`)
		await capturer(page, 'ia-modification-demande-xl-1440', UNITE)
		await page.getByRole('button', { name: 'Générer la suggestion' }).click()

		// Relire : le défaut, ce qui change, et la négociation qui porte une affaire.
		await expect(page.getByTestId('ia-defauts').getByRole('listitem')).toHaveText([
			`Affaires sans destination : l’étape retirée ${guillemets('negociation')} en porte 1.`,
		])
		const differentiel = page.getByTestId('ia-differentiel')
		await expect(differentiel.getByTestId('ia-differentiel-etapes')).toContainText('AjoutéQualification')
		await expect(differentiel.getByTestId('ia-differentiel-etapes')).toContainText('RetiréNégociation')
		const remappage = page.getByTestId('ia-remappages')
		await expect(remappage.getByTestId('ia-remappage')).toContainText('Négociation1 affaire')
		const destination = remappage.getByLabel('Destination des affaires de Négociation')
		await expect(destination).toHaveValue('')
		const accepter = page.getByRole('button', { name: 'Accepter et faire évoluer le workflow' })
		await expect(accepter).toBeDisabled()
		await capturer(page, 'ia-modification-relue-xl-1440', UNITE)

		// Choisir : l'étape que la suggestion AJOUTE.
		await destination.selectOption(QUALIFICATION)
		await expect(page.getByTestId('ia-modifie')).toHaveText('Modifications non enregistrées')
		await expect(accepter).toBeEnabled()
		await capturer(page, 'ia-modification-destination-xl-1440', UNITE)
		await accepter.click()

		// Accepté : le panneau fermé, le graphe relu, le focus rendu à « Suggérer », le point de retour annoncé.
		await expect(panneau(page)).toHaveCount(0)
		await expect(page.getByTestId('ligne-etape')).toHaveCount(3)
		await expect(page.getByTestId('liste-etapes')).toContainText('Qualification')
		await expect(page.getByTestId('liste-etapes')).not.toContainText('Négociation')
		await expect(page.getByRole('button', { name: suggerer('étapes', w.nom) })).toBeFocused()
		await expect(page.getByRole('status').filter({ hasText: 'Point de retour : version' })).toHaveCount(1)
		await capturer(page, 'ia-modification-acceptee-xl-1440', UNITE)

		// Les effets réels, relus par la clé de service : l'affaire sur l'étape NOUVELLE, le point de retour publié.
		const [suggestion] = await lireService<{ statut: string; version_retour_id: string | null }>(request, `suggestions_ia?select=statut,version_retour_id&${FILTRE}`)
		expect(suggestion?.statut).toBe('acceptee')
		const [version] = await lireService<{ note: string | null }>(request, `workflow_versions?id=eq.${suggestion?.version_retour_id}&select=note`)
		expect(version?.note).toBe("Point de retour avant une suggestion de l'IA")
		const [affaire] = await lireService<{ current_step_id: string }>(request, `cards?id=eq.${w.affaire}&select=current_step_id`)
		const [etape] = await lireService<{ node: { key: string } }>(request, `workflow_steps?id=eq.${affaire?.current_step_id}&select=node:workflow_nodes_catalog(key)`)
		expect(etape?.node.key).toBe(QUALIFICATION)
	})

	test('au clavier seul : ouvrir, `Échap`, rouvrir, demander, choisir la destination, accepter — le focus suit chaque geste', async ({ page, request }) => {
		const w = await workflowJetable(request)
		await simuler(page)
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeWorkflow(page, w.nom)
		const nom = suggerer('transitions', w.nom)

		await tabulerJusqua(page, nom)
		await page.keyboard.press('Enter')
		await expect(page.getByLabel('Décrivez ce qui doit changer')).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(panneau(page)).toHaveCount(0)
		await expect(page.getByRole('button', { name: nom })).toBeFocused()

		await page.keyboard.press('Enter')
		await page.keyboard.type(`${PREFIXE} — clavier`)
		await page.keyboard.press('Tab')
		await expect(page.getByRole('button', { name: 'Générer la suggestion' })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(panneau(page).getByRole('heading', { level: 2 })).toBeFocused()

		await tabulerJusqua(page, 'Destination des affaires de Négociation')
		// Les options : « Aucune destination », puis les étapes de la cible dans leur ordre.
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('ArrowDown')
		await expect(page.getByLabel('Destination des affaires de Négociation')).toHaveValue(QUALIFICATION)
		await tabulerJusqua(page, 'Accepter et faire évoluer le workflow')
		await page.keyboard.press('Enter')
		await expect(panneau(page)).toHaveCount(0)
		await expect(page.getByRole('button', { name: nom })).toBeFocused()
		const [suggestion] = await lireService<{ statut: string }>(request, `suggestions_ia?select=statut&${FILTRE}`)
		expect(suggestion?.statut).toBe('acceptee')
	})

	test('le workflow change pendant la relecture : l’acceptation est refusée, et le refus dit le seul recours', async ({ page, request }) => {
		const w = await workflowJetable(request)
		await simuler(page)
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeWorkflow(page, w.nom)
		await page.getByRole('button', { name: suggerer('champs', w.nom) }).click()
		await page.getByLabel('Décrivez ce qui doit changer').fill(`${PREFIXE} — concurrence`)
		await page.getByRole('button', { name: 'Générer la suggestion' }).click()
		await page.getByTestId('ia-remappages').getByLabel('Destination des affaires de Négociation').selectOption(QUALIFICATION)

		// Un autre geste change le workflow entre-temps.
		const change = await request.patch(rest(`workflow_transitions?workflow_id=eq.${w.workflow}&from_step_id=eq.${w.prospection}`), {
			headers: enTetesService(),
			data: { label: 'Changé entre-temps' },
		})
		expect(change.status()).toBe(204)

		await page.getByRole('button', { name: 'Accepter et faire évoluer le workflow' }).click()
		const refus = page.getByTestId('ia-refus-barre')
		await expect(refus).toContainText('Le workflow a changé depuis cette suggestion : elle ne peut plus être acceptée.')
		await expect(refus).toHaveAttribute('role', 'alert')
		// MESURÉ : un `PT409` fait porter au statut HTTP le message de l'exception — « 409 (workflow modifie) » —, et non
		// le « Conflict » d'une violation de clé (`ERREUR_RESSOURCE_HTTP[409]`).
		autoriserErreursConsole(page, ['console.error: Failed to load resource: the server responded with a status of 409 (workflow modifie)'])
		await capturer(page, 'ia-modification-refus-409-xl-1440', UNITE)
		const [suggestion] = await lireService<{ statut: string }>(request, `suggestions_ia?select=statut&${FILTRE}`)
		expect(suggestion?.statut).toBe('en_revue')
	})

	test('le commercial voit « Suggérer » ; la base refuse, et le refus est écrit sous la demande', async ({ page, request }) => {
		const w = await workflowJetable(request)
		await simuler(page)
		await connecterAvecLeLabs(page, BIZDEV)
		await ouvrirLeWorkflow(page, w.nom)
		await expect(page.getByTestId('ia-suggestions-du-workflow')).toHaveCount(0)
		await page.getByRole('button', { name: suggerer('étapes', w.nom) }).click()
		await page.getByLabel('Décrivez ce qui doit changer').fill(`${PREFIXE} — commercial`)
		await page.getByRole('button', { name: 'Générer la suggestion' }).click()
		const refus = page.getByTestId('ia-refus-demande')
		await expect(refus).toHaveText('L’assistant est réservé aux administrateurs de l’espace de travail.')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
		expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`)).toEqual([])
	})

	for (const palier of PALIERS) {
		test(`la suggestion de modification du seed au palier ${palier.nom} : le panneau dans le cadre, la page sans défilement de côté`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await simuler(page)
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(EDITEUR)
			const liste = page.getByTestId('ia-suggestions-du-workflow')
			await expect(liste.getByRole('heading', { name: 'Suggestions de l’IA pour ce workflow' })).toBeVisible()
			await liste.getByRole('button', { name: new RegExp(DEMANDE_SEED) }).click()
			await expect(page.getByTestId('ia-remappages')).toBeVisible()

			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			for (const marqueur of ['ia-panneau', 'ia-differentiel', 'ia-remappages']) {
				const boite = await page.getByTestId(marqueur).boundingBox()
				expect(boite, marqueur).not.toBeNull()
				expect(boite?.x ?? -1, marqueur).toBeGreaterThanOrEqual(0)
				expect((boite?.x ?? 0) + (boite?.width ?? 0), marqueur).toBeLessThanOrEqual(palier.largeur)
			}
			await page.getByTestId('ia-differentiel').scrollIntoViewIfNeeded()
			await capturer(page, `ia-modification-${palier.nom}`, UNITE)
			await page.getByTestId('ia-remappages').scrollIntoViewIfNeeded()
			await capturer(page, `ia-modification-affaires-${palier.nom}`, UNITE)
			for (const nom of [suggerer('étapes', 'Cycle commercial standard'), suggerer('transitions', 'Cycle commercial standard')]) {
				const boite = await page.getByRole('button', { name: nom }).boundingBox()
				expect(boite, nom).not.toBeNull()
				expect((boite?.x ?? 0) + (boite?.width ?? 0), nom).toBeLessThanOrEqual(palier.largeur)
			}
		})
	}
})
