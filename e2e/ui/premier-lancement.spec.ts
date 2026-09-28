// @verifies CRM-094 (docs/BACKLOG.md) — le premier lancement complet, à la souris et au clavier seuls
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

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { URL_API, enTetesService } from '../api/jetons'
import { creerCompteJetable, supprimerCompte } from '../api/keycloak-dev'
import { capturer } from './captures'

const UNITE = 'CRM-094'
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const ESPACE = { id: 'e0940000-0000-4000-8000-0000000000e1', slug: 'sonde-094-premier-lancement' } as const
const TRACK = { nom: 'Premier track', slug: 'premier-track' } as const
const CHANNEL = { nom: 'Premier channel', slug: 'premier-channel' } as const
const TABLEAU = 'Objectifs 2027'

type Compte = { readonly adresse: string; readonly sub: string }

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

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

/** Le premier track, le workflow de départ et le premier channel — par l'écran, comme le responsable. */
async function preparerLaStructure(page: Page): Promise<void> {
	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Nouveau track' }).click()
	const formTrack = page.getByTestId('formulaire-track')
	await formTrack.getByLabel('Nom').fill(TRACK.nom)
	await formTrack.getByRole('button', { name: 'Créer' }).click()
	await expect(formTrack).toBeHidden()

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

	test('un bloc d’objectif LIÉ au premier channel garde son lien, à l’écran et après rechargement', async ({
		page,
		request,
	}) => {
		test.setTimeout(150_000)
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await preparerLaStructure(page)

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

		// Et relu du serveur : la pilule « Track › Channel » sur le bloc, la sélection dans la fiche.
		await page.reload()
		const recharge = page.getByTestId('bloc-objectif').first()
		await expect(recharge).toContainText(TRACK.nom)
		await expect(recharge).toContainText(CHANNEL.nom)
		await recharge.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('champ-lien')).not.toHaveValue('')
		await capturer(page, 'premier-lancement-lien-relu-1440', UNITE)
	})
})
