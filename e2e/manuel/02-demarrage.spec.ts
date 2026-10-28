// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.1 : les images du chapitre 2, « Le guide de démarrage »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 2 ; docs/SPEC-onboarding.md §8 ter (l'espace neuf,
//       son montage et son démontage), §10 (le guide flottant)
//
// Le guide ne se voit à l'œuvre que dans un espace NEUF : le seed accomplit ses six étapes. Le scénario monte donc un
// espace vide et son administrateur, comme `e2e/ui/guide-flottant.spec.ts` (le workspace et l'attente par la clé de
// service, le compte dans le Keycloak de développement, l'appartenance par la vraie connexion), fait naître le track, le
// workflow et le channel PAR L'ÉCRAN, puis démonte tout et constate que la base est rendue à son unique espace seedé.
//
// Deux états ne paraissent qu'un instant ou qu'en panne. « Création… » : la vraie requête est RETENUE le temps de
// l'image. « Cette étape n'a pas pu être vérifiée » : une mesure est coupée au niveau du réseau, sur le compte du seed,
// comme `e2e/ui/demarrage.spec.ts` le fait — un état reproductible, et nommé ici.

import { expect, test, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, connecterAvecLeLabs, demonterEspaceNeuf, immobile, monterEspaceNeuf, retenir, type Compte } from './outils'

const CHAPITRE = 'le-guide-de-demarrage-par-ou-commencer'
const ESPACE = { id: 'e1170000-0000-4000-8000-0000000000a1', slug: 'nouvel-espace', nom: 'Nouvel espace' } as const
const TRACK = 'Conseil'

const pastille = (page: Page) => page.getByTestId('pastille-guide-flottant')
const panneau = (page: Page) => page.getByTestId('panneau-guide-flottant')

test.describe.configure({ mode: 'serial' })

test.describe('dans un espace neuf', () => {
	let compte: Compte | null = null
	test.beforeAll(async ({ request }) => {
		compte = await monterEspaceNeuf(request, ESPACE, { prenom: 'Claire', nom: 'Morel' })
	})
	test.afterAll(async ({ request }) => {
		await demonterEspaceNeuf(request, ESPACE, compte)
	})

	test('de l’accueil au workflow de départ', async ({ page }) => {
		test.setTimeout(150_000)
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)

		// L'accueil d'un espace neuf : le guide, une étape sur six.
		await page.goto('/')
		await expect(page.getByTestId('progression-demarrage')).toHaveText('1 étape(s) sur 6')
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'accueil-espace-neuf', cibles: [], pleinePage: true })

		// Le masquer, et le lien qui le rouvre.
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'le-masquer-et-le-retrouver',
			nom: 'masquer-le-guide',
			cibles: [page.getByTestId('masquer-guide')],
		})

		// Le premier track naît par l'écran ; la pastille suit l'administratrice, deux étapes sur six.
		await page.getByTestId('lien-track').click()
		await expect(page).toHaveURL(/\/reglages\/arborescence$/)
		await page.getByRole('button', { name: 'Nouveau track' }).click()
		const formTrack = page.getByTestId('formulaire-track')
		await formTrack.getByLabel('Nom').fill(TRACK)
		await formTrack.getByRole('button', { name: 'Créer' }).click()
		await expect(formTrack).toBeHidden()
		// La pastille se re-mesure au changement de page, pas à une création dans la page.
		await page.reload()
		await expect(pastille(page)).toHaveAccessibleName('Démarrage · 2 sur 6')
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'le-guide-flottant-des-administrateurs',
			nom: 'pastille',
			cibles: [pastille(page)],
		})
		await pastille(page).click()
		await expect(panneau(page)).toBeVisible()
		await immobile(page, 'panneau-guide-flottant')
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'le-guide-flottant-des-administrateurs',
			nom: 'panneau-ouvert',
			cibles: [panneau(page), pastille(page)],
		})
		await panneau(page).getByTestId('reduire-guide-flottant').click()
		await expect(panneau(page)).toHaveCount(0)

		// Sans workflow, le formulaire « Nouveau channel » le dit, et mène à l'éditeur.
		await page.getByRole('button', { name: `Déplier ${TRACK}` }).click()
		await page.getByRole('button', { name: 'Nouveau channel' }).click()
		const formChannel = page.getByTestId('formulaire-channel')
		await expect(formChannel.getByTestId('admin-sans-workflow')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'channel-sans-workflow', cibles: [formChannel] })
		await formChannel.getByRole('button', { name: 'Annuler' }).click()

		// Le workflow de départ, depuis l'accueil : le bouton, « Création… », puis l'étape faite.
		await page.goto('/')
		const etape = page.getByTestId('etape-workflow')
		const bouton = page.getByTestId('creer-workflow-depart')
		await expect(bouton).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: 'le-workflow-de-depart-en-un-geste', nom: 'bouton-workflow-de-depart', cibles: [etape] })
		const creation = retenir()
		await page.route('**/rest/v1/rpc/creer_workflow_de_depart', async (route) => {
			await creation.attendre
			await route.continue()
		})
		await bouton.click()
		await expect(bouton).toHaveText('Création…')
		await illustrer(page, { chapitre: CHAPITRE, section: 'le-workflow-de-depart-en-un-geste', nom: 'creation-en-cours', cibles: [etape] })
		creation.liberer()
		await expect(etape).toContainText('Fait')
		await expect(page.getByTestId('progression-demarrage')).toHaveText('3 étape(s) sur 6')
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'l-etat-d-une-etape-est-mesure-jamais-memorise',
			nom: 'progression',
			cibles: [page.getByTestId('progression-demarrage'), page.getByTestId('etape-track'), etape],
		})

		// Le formulaire « Nouveau channel » propose désormais le workflow posé.
		await page.goto('/reglages/arborescence')
		await page.getByRole('button', { name: `Déplier ${TRACK}` }).click()
		await page.getByRole('button', { name: 'Nouveau channel' }).click()
		await expect(formChannel.getByLabel('Workflow')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: 'le-workflow-de-depart-en-un-geste', nom: 'channel-avec-workflow', cibles: [formChannel] })
		await formChannel.getByRole('button', { name: 'Annuler' }).click()
	})
})

test('une étape qui n’a pas pu être mesurée', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.route('**/rest/v1/tracks?select=id*', async (route) => {
		const requete = route.request()
		if (requete.method() === 'GET' && /count=exact/.test(requete.headers()['prefer'] ?? '')) return route.abort('connectionrefused')
		return route.continue()
	})
	await page.goto('/demarrage')
	const ligne = page.getByTestId('etape-track')
	await expect(ligne).toContainText('Cette étape n’a pas pu être vérifiée', { timeout: 30_000 })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'ce-que-le-guide-dit-exactement-et-ce-qu-il-ne-dit-pas',
		nom: 'etape-non-verifiee',
		cibles: [ligne],
	})
})
