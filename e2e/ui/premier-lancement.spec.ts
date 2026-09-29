// @verifies CRM-094 (docs/BACKLOG.md) — le premier lancement complet, à la souris et au clavier seuls
// @verifies INC-255, décision 609 — ce qu'on écrit sur un bloc posé ou une flèche tracée pendant la visite
//           s'affiche aussitôt : lien, titre, direction (docs/DESIGN_SYSTEM.md §5.28, §5.29)
// @verifies CRM-095 (docs/BACKLOG.md) — tranche T3 : le guide mène au board du premier channel, où
//           « Nouvelle affaire » crée la première affaire, au clavier seul (docs/SPEC-onboarding.md §10.7 ;
//           docs/SPEC-cards.md §18.3, §18.4, §18.5 ; docs/DESIGN_SYSTEM.md §5.50, §7) ; tranche T2 bis :
//           les états vides « aucun channel » et « aucune étape » nomment le geste et mènent à l'écran qui
//           le fait (INC-258, décision 611 ; docs/SPEC-cards.md §18.4 bis ; docs/DESIGN_SYSTEM.md §5.51)
// @verifies docs/SPEC-onboarding.md §10 (le guide et le workflow de départ) ; docs/SPEC-goals.md §3
//           (lier un bloc à un channel), §5.5 (la fiche d'un bloc) ; docs/DESIGN_SYSTEM.md §5.29
// @verifies CLAUDE.md §15 (un parcours E2E part d'un état déterministe et vérifie les résultats
//           visibles et les effets en base), §16 (vérification visuelle)
// @verifies CRM-092 (docs/BACKLOG.md) — connexion par la vraie page du SSO (`connecterAvecLeLabs`)
//
// POURQUOI CE FICHIER. Le responsable a relevé en production, le 2026-09-28, deux défauts que chaque
// preuve partielle laissait passer : aucune affaire ne se crée depuis l'interface, et le lien d'un bloc
// d'objectif vers un channel « ne persiste pas ». Chacune des preuves existantes part du SEED, où les
// objets existent déjà ; aucune ne rejouait le parcours d'un administrateur qui part de RIEN et fait
// tout lui-même, écran après écran. Ce fichier le fait, sans aucune écriture de service hors du
// montage de l'espace et de son démontage.
//
// LES SCÉNARIOS SE SUIVENT DANS UN MÊME ESPACE NEUF, et c'est voulu : chacun reprend là où le précédent
// laisse l'espace, comme le ferait l'administrateur — le track avant le channel, le channel avant
// l'affaire. En série, un scénario en échec retient les suivants plutôt que de les faire échouer à tort.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { URL_API, enTetesService } from '../api/jetons'
import { creerCompteJetable, supprimerCompte } from '../api/keycloak-dev'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-094'
const UNITE_AFFAIRE = 'CRM-095'
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const ESPACE = { id: 'e0940000-0000-4000-8000-0000000000e1', slug: 'sonde-094-premier-lancement' } as const
const TRACK = { nom: 'Premier track', slug: 'premier-track' } as const
const CHANNEL = { nom: 'Premier channel', slug: 'premier-channel' } as const
const TABLEAU = 'Objectifs 2027'
const BLOC_A = 'Signer dix affaires'
const AFFAIRE = 'Première affaire — Atelier Mercier'
const WORKFLOW_VIDE = 'Workflow en brouillon'
const CHANNEL_SANS_ETAPE = 'Channel sans étape'

type Compte = { readonly adresse: string; readonly sub: string }

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

test.use({ viewport: { width: 1440, height: 900 } })

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), `lecture de service ${chemin}`).toBe(200)
	return (await reponse.json()) as T
}

/** Supprime ce que l'espace porte, dans l'ordre que les `RESTRICT` imposent (voir guide-flottant.spec.ts). */
async function viderEspace(requete: APIRequestContext): Promise<void> {
	const filtre = `workspace_id=eq.${ESPACE.id}`
	// Les tableaux d'objectifs emportent blocs et liens (`ON DELETE CASCADE`) ; un bloc qui vise un
	// channel le relâche à sa suppression (`SET NULL`) — l'ordre ne bute donc que sur les deux `RESTRICT`
	// de la structure.
	for (const table of ['goal_boards', 'cards', 'channels', 'tracks', 'workflows', 'workflow_nodes_catalog']) {
		await requete.delete(rest(`${table}?${filtre}`), { headers: enTetesService() })
	}
	await requete.delete(rest(`workspaces?id=eq.${ESPACE.id}`), { headers: enTetesService() })
}

async function monter(requete: APIRequestContext): Promise<Compte> {
	await viderEspace(requete)
	const compte = await creerCompteJetable('lancement', 'Premier', 'Lancement')
	const workspace = await requete.post(rest('workspaces'), {
		headers: enTetesService(),
		data: [{ id: ESPACE.id, name: 'Sonde 094 — premier lancement', slug: ESPACE.slug }],
	})
	expect(workspace.status(), `l'espace neuf doit être créé : ${await workspace.text()}`).toBe(201)
	const attente = await requete.post(rest('workspace_invitations'), {
		headers: enTetesService(),
		data: [{ workspace_id: ESPACE.id, email: compte.adresse, role: 'admin' }],
	})
	expect(attente.status(), 'le compte doit être attendu comme administrateur de son espace').toBe(201)
	return compte
}

async function demonter(requete: APIRequestContext, compte: Compte | null): Promise<void> {
	await viderEspace(requete)
	if (compte !== null) {
		const profil = await requete.delete(rest(`profiles?id=eq.${compte.sub}`), { headers: enTetesService() })
		expect(profil.status(), 'le profil du compte jetable doit être supprimé').toBe(204)
		await supprimerCompte(compte.sub)
	}
	expect(
		await lireService<{ id: string }[]>(requete, 'workspaces?select=id'),
		'la base doit être rendue à son unique workspace seedé (CRM-005)',
	).toEqual([{ id: WORKSPACE_SEED }])
}

/** Tabule jusqu'à l'élément voulu, au clavier seul ; échoue en le nommant s'il n'est pas atteint. */
async function tabulerJusqua(page: Page, idTest: string, maximum = 80): Promise<void> {
	for (let pas = 0; pas < maximum; pas += 1) {
		await page.keyboard.press('Tab')
		const courant = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)
		if (courant === idTest) return
	}
	throw new Error(`« ${idTest} » n'est pas atteint au clavier en ${maximum} tabulations`)
}

/** Le premier track, par l'écran de l'arborescence — comme le responsable. */
async function creerLePremierTrack(page: Page): Promise<void> {
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Nouveau track' }).click()
	const formTrack = page.getByTestId('formulaire-track')
	await formTrack.getByLabel('Nom').fill(TRACK.nom)
	await formTrack.getByRole('button', { name: 'Créer' }).click()
	await expect(formTrack).toBeHidden()
}

/** Le workflow de départ depuis la pastille du guide, puis le premier channel — par l'écran. */
async function poserWorkflowEtPremierChannel(page: Page): Promise<void> {
	await page.getByTestId('pastille-guide-flottant').click()
	await page.getByTestId('panneau-guide-flottant').getByTestId('creer-workflow-depart').click()
	await expect(page.getByTestId('panneau-guide-flottant').getByTestId('etape-workflow')).toContainText('Fait')
	await page.getByTestId('panneau-guide-flottant').getByTestId('reduire-guide-flottant').click()

	await page.getByRole('button', { name: `Déplier ${TRACK.nom}` }).click()
	await page.getByRole('button', { name: 'Nouveau channel' }).click()
	const formChannel = page.getByTestId('formulaire-channel')
	await formChannel.getByLabel('Nom').fill(CHANNEL.nom)
	await formChannel.getByLabel('Workflow').selectOption({ label: 'Cycle commercial (par défaut)' })
	await formChannel.getByRole('button', { name: 'Créer' }).click()
	await expect(formChannel).toBeHidden()
}

test.describe.configure({ mode: 'serial' })

test.describe('le premier lancement complet, à la souris et au clavier', () => {
	let compte: Compte | null = null

	test.beforeAll(async ({ request }) => {
		compte = await monter(request)
	})
	test.afterAll(async ({ request }) => {
		await demonter(request, compte)
	})

	test('le premier track, ouvert avant son premier channel, dit où le créer et y mène (INC-258)', async ({
		page,
	}) => {
		test.setTimeout(120_000)
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await creerLePremierTrack(page)

		// Ouvert depuis la barre latérale, comme le ferait l'administrateur qui vient de le créer.
		await page.getByTestId('entree-track').filter({ hasText: TRACK.nom }).click()
		await expect(page).toHaveURL(`/tracks/${TRACK.slug}`)
		const vide = page.getByTestId('etat-vide')
		await expect(vide).toContainText('Aucun channel dans ce track')
		await expect(vide).toContainText(
			"Un channel se crée avec « Nouveau channel », dans l'administration de l'arborescence.",
		)
		await expect(vide).not.toContainText("par l'API")
		await capturer(page, 'premier-lancement-track-sans-channel-xl-1440', UNITE_AFFAIRE)
		await vide.getByRole('link', { name: "Ouvrir l'arborescence" }).click()
		await expect(page).toHaveURL('/reglages/arborescence')

		await poserWorkflowEtPremierChannel(page)
	})

	test('le guide mène au board du premier channel, où « Nouvelle affaire » crée la première affaire, au clavier', async ({
		page,
		request,
	}) => {
		test.setTimeout(120_000)
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)

		// L'accueil rend le guide DANS la page — la pastille flottante s'y efface (docs/DESIGN_SYSTEM.md
		// §5.49) : l'étape « affaire » mène désormais au board du premier channel (§10.7).
		const lien = page.getByTestId('guide-demarrage').getByTestId('lien-affaire')
		await expect(lien).toHaveText('Ouvrir le board et créer l’affaire')
		await page.getByTestId('guide-demarrage').getByTestId('etape-affaire').scrollIntoViewIfNeeded()
		await capturer(page, 'premier-lancement-guide-affaire-xl-1440', UNITE_AFFAIRE)
		await lien.click()
		await expect(page).toHaveURL(`/tracks/${TRACK.slug}/${CHANNEL.slug}`)

		// Le board d'un channel sans affaire dit où la créer — et le bouton est là, au-dessus des colonnes.
		await expect(page.getByTestId('etat-vide')).toContainText(
			'Créez la première avec « Nouvelle affaire », au-dessus des colonnes',
		)
		await expect(page.getByTestId('creer-affaire-colonne')).toHaveCount(1)

		// Les quatre paliers, le formulaire ouvert sur le board vide, chacun RENDU À SA TAILLE : redimensionner
		// une page déjà rendue ne montre pas ce qu'un écran de cette taille affiche. La page ne défile jamais
		// de côté (§7). Chaque formulaire est refermé par `Échap` : rien n'est créé ici.
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.reload()
			await page.getByTestId('nouvelle-affaire').click()
			await page.getByTestId('champ-titre-affaire').fill(AFFAIRE)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, `aucun défilement horizontal au palier ${palier.nom}`).toBeLessThanOrEqual(0)
			await capturer(page, `premier-lancement-nouvelle-affaire-${palier.nom}`, UNITE_AFFAIRE)
			await page.keyboard.press('Escape')
			await expect(page.getByTestId('formulaire-nouvelle-affaire')).toHaveCount(0)
		}
		await page.setViewportSize({ width: 1440, height: 900 })
		await page.reload()

		// Au clavier seul : la commande de la barre, `Entrée`, le titre, `Entrée`.
		await tabulerJusqua(page, 'nouvelle-affaire')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('champ-titre-affaire')).toBeFocused()
		await page.keyboard.type(AFFAIRE)
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`/tracks/${TRACK.slug}/${CHANNEL.slug}/cards/[0-9a-f-]{36}$`))
		await expect(page.getByTestId('entete-card').getByRole('heading', { name: AFFAIRE })).toBeVisible()

		// En base : l'affaire est dans l'espace neuf, à l'étape INITIALE du workflow de départ.
		const affaires = await lireService<{ title: string; workflow_steps: { is_initial: boolean } | null }[]>(
			request,
			`cards?workspace_id=eq.${ESPACE.id}&select=title,workflow_steps!cards_current_step_id_workflow_id_fkey(is_initial)`,
		)
		expect(affaires).toEqual([{ title: AFFAIRE, workflow_steps: { is_initial: true } }])

		// Le guide la compte : cinq étapes sur six, seule la messagerie reste.
		await expect(page.getByTestId('pastille-guide-flottant')).toContainText('5 sur 6')
		await capturer(page, 'premier-lancement-fiche-premiere-affaire-xl-1440', UNITE_AFFAIRE)
	})

	test('un workflow sans étape : le board du channel qui le porte dit où les ajouter, et y mène (INC-258)', async ({
		page,
	}) => {
		test.setTimeout(120_000)
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)

		// Un workflow créé dans l'éditeur naît sans étape (docs/SPEC-workflow-engine.md §3 bis).
		await page.goto('/reglages/workflows')
		await page.getByRole('button', { name: 'Nouveau workflow' }).click()
		const formWorkflow = page.getByTestId('workflows-formulaire-creation')
		await formWorkflow.getByLabel('Nom').fill(WORKFLOW_VIDE)
		await formWorkflow.getByRole('button', { name: 'Créer' }).click()
		await expect(formWorkflow).toBeHidden()

		// Un channel posé sur ce workflow, par l'arborescence.
		await page.goto('/reglages/arborescence')
		await page.getByRole('button', { name: `Déplier ${TRACK.nom}` }).click()
		await page.getByRole('button', { name: 'Nouveau channel' }).click()
		const formChannel = page.getByTestId('formulaire-channel')
		await formChannel.getByLabel('Nom').fill(CHANNEL_SANS_ETAPE)
		await formChannel.getByLabel('Workflow').selectOption({ label: WORKFLOW_VIDE })
		await formChannel.getByRole('button', { name: 'Créer' }).click()
		await expect(formChannel).toBeHidden()

		// Son board, atteint par la barre latérale puis l'onglet du channel.
		await page.getByTestId('entree-track').filter({ hasText: TRACK.nom }).click()
		await page.getByRole('link', { name: CHANNEL_SANS_ETAPE }).click()
		const vide = page.getByTestId('etat-vide')
		await expect(vide).toContainText('Ce workflow ne déclare aucune étape')
		await expect(vide).toContainText("Les étapes d'un workflow s'ajoutent dans l'éditeur de workflows.")
		await expect(vide).not.toContainText("par l'API")
		await capturer(page, 'premier-lancement-workflow-sans-etape-xl-1440', UNITE_AFFAIRE)
		await vide.getByRole('link', { name: "Ouvrir l'éditeur de workflows" }).click()
		await expect(page).toHaveURL('/reglages/workflows')
	})

	test('un bloc d’objectif LIÉ au premier channel garde son lien, à l’écran et après rechargement', async ({
		page,
		request,
	}) => {
		test.setTimeout(150_000)
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)

		// Le tableau d'objectifs, créé par l'écran.
		await page.getByRole('link', { name: 'Objectifs', exact: true }).first().click()
		await page.getByTestId('creer-tableau').click()
		await expect(page.getByTestId('formulaire-creation-tableau')).toBeVisible()
		await page.keyboard.type(TABLEAU)
		await page.getByTestId('valider-tableau').click()
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Tableau créé')
		// La ligne d'un tableau EST son lien (`Objectifs.tsx`).
		await page.getByTestId('tableau-objectifs').filter({ hasText: TABLEAU }).click()
		await expect(page.getByRole('heading', { name: TABLEAU })).toBeVisible()

		// Un bloc posé au clavier, puis sa fiche.
		// Un tableau vide porte la commande deux fois — en-tête et état vide (docs/DESIGN_SYSTEM.md §5.29).
		await page.getByTestId('poser-bloc').first().click()
		await expect(page.getByTestId('repere-pose')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')
		const bloc = page.getByTestId('bloc-objectif').first()
		await bloc.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('fiche-bloc')).toBeVisible()

		// LE GESTE DU DÉFAUT : viser le premier channel.
		const selecteur = page.getByTestId('champ-lien')
		await expect(selecteur.locator('option', { hasText: CHANNEL.nom })).toHaveCount(1)
		// L'option porte le nom du channel ; son track est l'intitulé de son `optgroup` (§5.29).
		await expect(selecteur.locator('optgroup', { hasText: CHANNEL.nom })).toHaveAttribute('label', TRACK.nom)
		await selecteur.selectOption({ label: CHANNEL.nom })
		await expect(page.getByTestId('etat-lien')).toHaveText('Enregistré')
		await capturer(page, 'premier-lancement-lien-pose-1440', UNITE)
		// La sélection reste affichée après l'écriture — c'est la moitié du défaut relevé.
		await expect(selecteur).not.toHaveValue('')

		// En base : le lien est posé.
		const blocs = await lireService<{ channel_id: string | null }[]>(
			request,
			`goal_blocks?select=channel_id,goal_boards!inner(workspace_id)&goal_boards.workspace_id=eq.${ESPACE.id}`,
		)
		expect(blocs.map((ligne) => ligne.channel_id === null)).toEqual([false])

		// Sur le canevas, SANS rechargement : la pilule « Track › Channel » paraît sur le bloc posé.
		await expect(bloc).toContainText(TRACK.nom)
		await expect(bloc).toContainText(CHANNEL.nom)

		// Le TITRE écrit sur ce bloc neuf le renomme aussitôt — même défaut, même correction (INC-255).
		const titre = page.getByTestId('champ-titre')
		await titre.fill(BLOC_A)
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('etat-titre')).toHaveText('Enregistré')
		await expect(page.getByTestId('bloc-objectif').filter({ hasText: BLOC_A })).toHaveCount(1)
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('fiche-bloc')).toHaveCount(0)

		// Un second bloc, décalé au clavier, puis une FLÈCHE tracée de l'un à l'autre : `Espace` sur le
		// départ, `Entrée` sur l'arrivée (docs/SPEC-goals.md §5.5).
		await page.getByTestId('poser-bloc').first().click()
		for (let pas = 0; pas < 48; pas += 1) await page.keyboard.press('ArrowRight')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('bloc-objectif')).toHaveCount(2)
		await page.getByTestId('bloc-objectif').filter({ hasText: BLOC_A }).focus()
		await page.keyboard.press('Space')
		await page.getByTestId('bloc-objectif').filter({ hasText: 'Nouvel objectif' }).focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Flèche tracée')

		// Sa direction corrigée s'affiche aussitôt — la flèche tracée pendant la visite suit la ligne rendue.
		const direction = page.getByTestId('direction-fleche').first()
		await expect(direction).toHaveValue('forward')
		await direction.selectOption('both')
		await expect(page.getByTestId('mention-ecriture')).toHaveText('Enregistré')
		await expect(direction).toHaveValue('both')
		await capturer(page, 'premier-lancement-canevas-1440', UNITE)

		// Et tout est relu du serveur : lien, titre, flèche et sa direction.
		await page.reload()
		const recharge = page.getByTestId('bloc-objectif').filter({ hasText: BLOC_A })
		await expect(recharge).toContainText(TRACK.nom)
		await expect(recharge).toContainText(CHANNEL.nom)
		await expect(page.getByTestId('direction-fleche').first()).toHaveValue('both')
		await recharge.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('champ-lien')).not.toHaveValue('')
		await capturer(page, 'premier-lancement-lien-relu-1440', UNITE)
	})
})
