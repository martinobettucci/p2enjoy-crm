// @verifies CRM-097 (docs/BACKLOG.md) — tranche T2.d : créer un workflow avec l'IA, sur la pile réelle, à la souris et
//           au clavier seul ; corriger, faire revoir, accepter, abandonner ; le refus du commercial ; quatre paliers
// @verifies docs/SPEC-ia.md §12.5 (le parcours), §12.6 (reprise sans consigne), §12.7 (refus traduits), §12.8 (le
//           seed : une suggestion en revue) ; §2 (rien n'est créé avant « Accepter »)
// @verifies docs/DESIGN_SYSTEM.md §5.52 (le panneau, l'attente, les défauts, la barre de gestes, la confirmation,
//           le focus), §7 (quatre paliers, aucun défilement horizontal de la page), §8 (clavier)
// @verifies CLAUDE.md §10 (le refus prouvé avec le jeton réel du commercial), §15 (état déterministe, effets en base
//           relus), §16 (captures observées)
//
// LE SERVEUR LLM N'EST JAMAIS APPELÉ (docs/SPEC-ia.md §8) : chaque requête de la page vers la fonction `ia` reçoit
// l'en-tête `x-ia-simulateur`, qui choisit le scénario du simulateur — instrumentation du seul développement
// (§11.6). La génération peut être RETENUE par la preuve, le temps d'observer l'attente : aucune temporisation.
// Les suggestions créées portent un préfixe ; après chaque scénario, la clé de service retire les workflows
// qu'elles ont créés, les nœuds de catalogue ajoutés, puis les suggestions — retrait CONSTATÉ. La suggestion du
// seed n'est jamais décidée.

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
const PREFIXE = 'Sonde 097 UI'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const NOEUDS_SIMULES = ['prise-de-contact', 'maquette', 'gagne-web', 'perdu-web']
const DEMANDE_SEED = 'Un cycle pour une agence web : prise de contact, maquette et devis'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`

test.use({ viewport: { width: 1440, height: 900 } })

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

test.afterEach(async ({ request }) => {
	const creees = await lireService<{ workflow_cree_id: string | null }>(request, `suggestions_ia?select=workflow_cree_id&${FILTRE}&workflow_cree_id=not.is.null`)
	for (const { workflow_cree_id } of creees) {
		expect((await request.delete(rest(`workflows?id=eq.${workflow_cree_id}`), { headers: enTetesService() })).status()).toBe(204)
	}
	await request.delete(rest(`workflow_nodes_catalog?workspace_id=eq.${ESPACE}&key=in.(${NOEUDS_SIMULES.join(',')})`), { headers: enTetesService() })
	await request.delete(rest(`suggestions_ia?${FILTRE}`), { headers: enTetesService() })
	expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`), 'aucune suggestion de sonde ne doit rester').toEqual([])
	expect(await lireService(request, `workflow_nodes_catalog?select=id&workspace_id=eq.${ESPACE}&key=in.(${NOEUDS_SIMULES.join(',')})`)).toEqual([])
})

type Simulateur = { scenario: string; retenir: Promise<void> | null }

/**
 * Ajoute l'en-tête du simulateur à toute requête de la page vers la fonction `ia`. `retenir`, quand il est posé,
 * suspend la GÉNÉRATION (pas l'état de l'assistant) jusqu'à ce que la preuve la libère.
 */
async function simuler(page: Page, simulateur: Simulateur): Promise<void> {
	await page.route('**/functions/v1/ia/**', async (route) => {
		const requete = route.request()
		if (requete.method() === 'POST' && simulateur.retenir !== null) await simulateur.retenir
		await route.continue({ headers: { ...requete.headers(), 'x-ia-simulateur': simulateur.scenario } })
	})
}

/** Tabule jusqu'à l'élément dont le nom accessible est donné ; échoue en le nommant s'il n'est pas atteint. */
async function tabulerJusqua(page: Page, nom: string, maximum = 120): Promise<void> {
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

async function demander(page: Page, demande: string): Promise<void> {
	await page.getByRole('button', { name: 'Créer avec l’IA' }).click()
	await page.getByLabel('Décrivez le workflow').fill(demande)
	await page.getByRole('button', { name: 'Générer la suggestion' }).click()
}

test.describe('Créer un workflow avec l’IA (docs/SPEC-ia.md §12)', () => {
	test('à la souris : demander, attendre, relire, corriger, enregistrer, accepter — le workflow créé est choisi', async ({ page, request }) => {
		let liberer = () => {}
		const simulateur: Simulateur = { scenario: 'valide', retenir: new Promise<void>((r) => (liberer = r)) }
		await simuler(page, simulateur)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)

		// Le seed porte une suggestion en revue, sous la liste des workflows (docs/SPEC-seed.md §16).
		const liste = page.getByTestId('ia-suggestions-en-revue')
		await expect(liste.getByRole('heading', { name: 'Suggestions de l’IA en revue' })).toBeVisible()
		await expect(liste.getByRole('button', { name: new RegExp(DEMANDE_SEED) })).toBeVisible()

		await page.getByRole('button', { name: 'Créer avec l’IA' }).click()
		await expect(page.getByLabel('Décrivez le workflow')).toBeFocused()
		await page.getByLabel('Décrivez le workflow').fill(`${PREFIXE} — souris : un cycle pour une agence web, avec un budget.`)
		await capturer(page, 'ia-demande-xl-1440', UNITE)
		await page.getByRole('button', { name: 'Générer la suggestion' }).click()

		// L'attente, retenue le temps de l'observer (§5.52, §6).
		await expect(panneau(page).getByRole('status')).toHaveText('L’assistant prépare une proposition — environ une demi-minute.')
		await expect(page.getByTestId('ia-attente')).toContainText('Temps écoulé')
		await capturer(page, 'ia-attente-xl-1440', UNITE)
		simulateur.retenir = null
		liberer()

		await expect(panneau(page).getByRole('heading', { level: 2, name: 'Suggestion de l’IA' })).toBeFocused()
		await expect(page.getByTestId('ia-etape')).toHaveCount(4)
		await expect(page.getByTestId('ia-defauts')).toHaveCount(0)
		await expect(page.getByRole('status').filter({ hasText: 'Suggestion prête, sans défaut.' })).toHaveCount(1)
		await capturer(page, 'ia-suggestion-xl-1440', UNITE)

		// Rien n'est créé avant « Accepter » (§2).
		const avant = (await lireService(request, `workflows?select=id&workspace_id=eq.${ESPACE}`)).length

		// Corriger : le nom, et retirer une étape — la cascade est annoncée.
		const nom = `${PREFIXE} — Agence web corrigée`
		await page.getByLabel('Nom du workflow').fill(nom)
		await page.getByRole('button', { name: 'Retirer l’étape Maquette et devis' }).click()
		await expect(page.getByTestId('ia-etape')).toHaveCount(3)
		await expect(page.getByTestId('ia-modifie')).toHaveText('Modifications non enregistrées')
		await page.getByRole('button', { name: 'Enregistrer la correction' }).click()
		await expect(page.getByTestId('ia-modifie')).toHaveCount(0)
		await expect(page.getByTestId('ia-historique')).toContainText('Historique — 2 révisions')
		expect((await lireService(request, `workflows?select=id&workspace_id=eq.${ESPACE}`)).length).toBe(avant)

		await page.getByRole('button', { name: 'Accepter et créer le workflow' }).click()
		const choisi = page.getByRole('navigation', { name: 'Choisir un workflow' }).getByRole('button', { name: new RegExp(nom) })
		await expect(choisi).toHaveAttribute('aria-current', 'true')
		await expect(choisi).toBeFocused()
		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)
		await expect(page.getByTestId('ligne-etape')).toHaveCount(3)
		await capturer(page, 'ia-acceptee-xl-1440', UNITE)

		// L'effet réel, relu en base par la clé de service.
		const [suggestion] = await lireService<{ statut: string; workflow_cree_id: string }>(request, `suggestions_ia?select=statut,workflow_cree_id&${FILTRE}`)
		expect(suggestion?.statut).toBe('acceptee')
		const [workflow] = await lireService<{ name: string }>(request, `workflows?id=eq.${suggestion?.workflow_cree_id}&select=name`)
		expect(workflow?.name).toBe(nom)
		expect((await lireService(request, `workflow_steps?workflow_id=eq.${suggestion?.workflow_cree_id}&select=id`)).length).toBe(3)
	})

	test('au clavier seul : ouvrir, `Échap`, rouvrir, demander, puis accepter — le focus suit chaque geste', async ({ page, request }) => {
		await simuler(page, { scenario: 'valide', retenir: null })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		await expect(page.getByRole('button', { name: 'Créer avec l’IA' })).toBeVisible()

		await tabulerJusqua(page, 'Créer avec l’IA')
		await page.keyboard.press('Enter')
		await expect(page.getByLabel('Décrivez le workflow')).toBeFocused()
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Créer avec l’IA' })).toBeFocused()

		await page.keyboard.press('Enter')
		await page.keyboard.type(`${PREFIXE} — clavier`)
		await page.keyboard.press('Tab') // vers « Générer la suggestion »
		await expect(page.getByRole('button', { name: 'Générer la suggestion' })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(panneau(page).getByRole('heading', { level: 2, name: 'Suggestion de l’IA' })).toBeFocused()

		await tabulerJusqua(page, 'Accepter et créer le workflow')
		await page.keyboard.press('Enter')
		const choisi = page.getByRole('navigation', { name: 'Choisir un workflow' }).getByRole('button', { name: /Cycle d'une agence web/ })
		await expect(choisi).toBeFocused()
		const [suggestion] = await lireService<{ statut: string }>(request, `suggestions_ia?select=statut&${FILTRE}`)
		expect(suggestion?.statut).toBe('acceptee')
	})

	test('une proposition incohérente : ses défauts en tête, « Accepter » retenu ; corrigée à la main, elle s’accepte', async ({ page, request }) => {
		await simuler(page, { scenario: 'incoherente', retenir: null })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		await demander(page, `${PREFIXE} — incohérente`)

		const defauts = page.getByTestId('ia-defauts')
		await expect(defauts.getByRole('heading')).toHaveText('2 défauts empêchent l’acceptation')
		await expect(defauts.getByRole('listitem')).toHaveText([
			'Il faut exactement une étape initiale ; la proposition en a 2.',
			// Les guillemets des textes nouveaux encadrent leur clé d'espaces INSÉCABLES (docs/DESIGN_SYSTEM.md §5.51).
			'La transition «\u00a0gagne-web\u00a0» vers «\u00a0relance\u00a0» touche une étape absente.',
		])
		const accepter = page.getByRole('button', { name: 'Accepter et créer le workflow' })
		await expect(accepter).toBeDisabled()
		await expect(page.getByText('Corrigez les défauts, à la main ou par une revue, avant d’accepter.')).toBeVisible()
		await capturer(page, 'ia-defauts-xl-1440', UNITE)

		// Deux étapes initiales : aucun radio n'est coché (§5.52) ; en choisir un corrige le défaut.
		await expect(page.getByRole('radio', { checked: true })).toHaveCount(0)
		await page.getByRole('radio', { name: 'Étape initiale : Prise de contact' }).check()
		await page.getByRole('button', { name: 'Retirer la transition de Gagné vers Relance' }).click()
		await page.getByRole('button', { name: 'Enregistrer la correction' }).click()
		await expect(page.getByTestId('ia-defauts')).toHaveCount(0)
		await expect(accepter).toBeEnabled()
		await accepter.click()
		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)
		const [suggestion] = await lireService<{ statut: string }>(request, `suggestions_ia?select=statut&${FILTRE}`)
		expect(suggestion?.statut).toBe('acceptee')
	})

	test('faire revoir avec une consigne : une révision de l’IA s’ajoute à l’historique', async ({ page }) => {
		await simuler(page, { scenario: 'valide', retenir: null })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		await demander(page, `${PREFIXE} — revue`)
		await expect(page.getByTestId('ia-etape')).toHaveCount(4)
		await expect(page.getByRole('button', { name: 'Revoir avec l’IA' })).toBeDisabled()
		await page.getByLabel('Consigne pour l’IA').fill('Ajoute une étape de relance avant la maquette')
		await page.getByRole('button', { name: 'Revoir avec l’IA' }).click()
		await expect(page.getByTestId('ia-historique')).toContainText('Historique — 2 révisions')
		await expect(page.getByLabel('Consigne pour l’IA')).toHaveValue('')
		await page.getByTestId('ia-historique').locator('summary').click()
		await expect(page.getByTestId('ia-historique')).toContainText('Ajoute une étape de relance avant la maquette')
		await capturer(page, 'ia-historique-xl-1440', UNITE)
	})

	test('abandonner : la confirmation nomme la demande ; confirmée, la suggestion quitte la liste et rien n’est créé', async ({ page, request }) => {
		await simuler(page, { scenario: 'valide', retenir: null })
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		await demander(page, `${PREFIXE} — abandon`)
		await expect(page.getByTestId('ia-etape')).toHaveCount(4)
		const avant = (await lireService(request, `workflows?select=id&workspace_id=eq.${ESPACE}`)).length

		await page.getByRole('button', { name: 'Abandonner la suggestion' }).click()
		const confirmation = page.getByTestId('ia-confirmation-abandon')
		await expect(confirmation).toContainText(`${PREFIXE} — abandon`)
		await expect(confirmation.getByRole('button', { name: 'Abandonner', exact: true })).toBeFocused()
		await capturer(page, 'ia-abandon-xl-1440', UNITE)
		await confirmation.getByRole('button', { name: 'Abandonner', exact: true }).click()

		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Créer avec l’IA' })).toBeFocused()
		await expect(page.getByTestId('ia-suggestions-en-revue').getByRole('button', { name: new RegExp(`${PREFIXE} — abandon`) })).toHaveCount(0)
		const [suggestion] = await lireService<{ statut: string }>(request, `suggestions_ia?select=statut&${FILTRE}`)
		expect(suggestion?.statut).toBe('abandonnee')
		expect((await lireService(request, `workflows?select=id&workspace_id=eq.${ESPACE}`)).length).toBe(avant)
	})

	test('une première génération échouée se dit, et « Réessayer » la reprend sans consigne', async ({ page }) => {
		const simulateur: Simulateur = { scenario: 'cle_refusee', retenir: null }
		await simuler(page, simulateur)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		await demander(page, `${PREFIXE} — échec`)
		await expect(panneau(page)).toContainText('L’assistant est mal configuré : son serveur refuse sa clé.')
		await capturer(page, 'ia-echec-xl-1440', UNITE)
		simulateur.scenario = 'valide'
		await page.getByRole('button', { name: 'Réessayer' }).click()
		await expect(page.getByTestId('ia-etape')).toHaveCount(4)
	})

	test('le commercial voit la commande ; la base refuse, et le refus est écrit sous la demande — aucune liste ne lui est montrée', async ({ page, request }) => {
		await simuler(page, { scenario: 'valide', retenir: null })
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(EDITEUR)
		await expect(page.getByRole('button', { name: 'Créer avec l’IA' })).toBeVisible()
		// La RLS ne lui rend aucune suggestion, pas même celle du seed : l'écran ne nomme pas ce qu'il ne montre pas.
		await expect(page.getByTestId('ia-suggestions-en-revue')).toHaveCount(0)

		await demander(page, `${PREFIXE} — commercial`)
		const refus = page.getByTestId('ia-refus-demande')
		await expect(refus).toHaveText('L’assistant est réservé aux administrateurs de l’espace de travail.')
		await expect(refus).toHaveAttribute('role', 'alert')
		await expect(page.getByLabel('Décrivez le workflow')).toHaveValue(`${PREFIXE} — commercial`)
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
		await capturer(page, 'ia-refus-commercial-xl-1440', UNITE)
		expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`)).toEqual([])
	})

	for (const palier of PALIERS) {
		test(`la suggestion du seed au palier ${palier.nom} : le panneau dans le cadre, la page sans défilement de côté`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await simuler(page, { scenario: 'valide', retenir: null })
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(EDITEUR)
			await page.getByTestId('ia-suggestions-en-revue').getByRole('button', { name: new RegExp(DEMANDE_SEED) }).click()
			await expect(page.getByTestId('ia-etape')).toHaveCount(4)

			const cadre = await panneau(page).boundingBox()
			expect(cadre, 'le panneau est rendu').not.toBeNull()
			expect(cadre?.x ?? -1).toBeGreaterThanOrEqual(0)
			expect((cadre?.x ?? 0) + (cadre?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			await panneau(page).scrollIntoViewIfNeeded()
			await capturer(page, `ia-panneau-${palier.nom}`, UNITE)

			// Le bas du panneau : champs, consigne et barre de gestes, eux aussi dans le cadre.
			const accepter = page.getByRole('button', { name: 'Accepter et créer le workflow' })
			await accepter.scrollIntoViewIfNeeded()
			for (const nom of ['Accepter et créer le workflow', 'Abandonner la suggestion', 'Revoir avec l’IA']) {
				const boite = await page.getByRole('button', { name: nom }).boundingBox()
				expect(boite, nom).not.toBeNull()
				expect((boite?.x ?? 0) + (boite?.width ?? 0), nom).toBeLessThanOrEqual(palier.largeur)
			}
			await capturer(page, `ia-panneau-gestes-${palier.nom}`, UNITE)
		})
	}
})
