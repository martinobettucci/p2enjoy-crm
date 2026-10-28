// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.1 : les images du chapitre 3, « Naviguer : barre latérale, onglets, états »
// @spec docs/SPEC-manual.md §11.1, §11.2, §13 (l'aide, ses états) ; docs/manual.md chapitre 3
// @spec docs/DESIGN_SYSTEM.md §5.12 (la coquille), §5.62 (le fil d'Ariane), §5.69 (l'aide)
//
// Trois écrans exigent un état que le seed ne porte pas, et le scénario le pose puis le retire, par la clé de service :
// un track sans channel, puis, dans ce même track, un channel dont le workflow n'a aucune étape. « Chargement
// impossible » et « Le manuel n'a pas pu être chargé » naissent d'une lecture COUPÉE au niveau du réseau — l'état est
// reproductible, la réponse n'est jamais inventée. « Accès refusé » relève des exceptions (docs/SPEC-manual.md §11.3) :
// les droits du seed se lisent par l'absence, jamais par ce refus.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, AFFAIRE_SOGEXIA, VIEWER, WORKSPACE_SEED, connecterAvecLeLabs, immobile, service } from './outils'

const CHAPITRE = 'naviguer-barre-laterale-onglets-etats'
const BOARD = '/tracks/conseil-ia/grands-comptes'

const POSE = {
	track: 'e1170000-0000-4000-8000-0000000003a1',
	workflow: 'e1170000-0000-4000-8000-0000000003b1',
	channel: 'e1170000-0000-4000-8000-0000000003c1',
} as const

async function retirerPose(requete: APIRequestContext): Promise<void> {
	await service(requete, 'delete', `channels?id=eq.${POSE.channel}`)
	await service(requete, 'delete', `workflows?id=eq.${POSE.workflow}`)
	await service(requete, 'delete', `tracks?id=eq.${POSE.track}`)
}

test('la disposition de l’écran, l’en-tête et la barre latérale', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(BOARD)
	await expect(page.getByTestId('carte-card').first()).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'un-board', cibles: [], pleinePage: true })

	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-disposition-de-l-ecran',
		nom: 'en-tete',
		cibles: [
			page.getByPlaceholder('Rechercher…'),
			page.getByTestId('bouton-aide'),
			page.getByTestId('cloche-notifications'),
			page.getByRole('button', { name: 'Se déconnecter' }),
		],
	})
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-barre-laterale-et-la-section-tracks',
		nom: 'barre-laterale',
		// La barre entière dépasse la fenêtre : ses entrées, de « Board » au dernier track.
		cibles: [page.getByRole('link', { name: 'Board', exact: true }), page.locator('[data-testid="entree-track"]').last()],
	})
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'les-onglets-d-un-track',
		nom: 'barre-d-onglets',
		cibles: [page.getByTestId('commande-nouveau-channel'), page.getByTestId('onglet-couts-track')],
	})

	// Hors d'un track, la barre d'onglets n'a rien à montrer.
	await page.goto('/inbox')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-disposition-de-l-ecran',
		nom: 'aucun-channel',
		cibles: [page.getByText('Aucun channel', { exact: true })],
	})
})

test('le fil d’Ariane, sur un ordinateur et sur un téléphone', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(AFFAIRE_SOGEXIA)
	const fil = page.getByTestId('fil-ariane')
	await expect(fil).toContainText('Migration ERP Sogexia')
	await illustrer(page, { chapitre: CHAPITRE, section: 'le-fil-d-ariane-savoir-ou-vous-etes', nom: 'fil-d-ariane', cibles: [fil] })

	await page.setViewportSize({ width: 390, height: 844 })
	await expect(page.getByTestId('fil-ariane-repli')).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'le-fil-d-ariane-savoir-ou-vous-etes', nom: 'fil-d-ariane-telephone', cibles: [fil] })
})

test('un track sans channel, un workflow sans étape, un track introuvable', async ({ page, request }) => {
	test.setTimeout(90_000)
	await retirerPose(request)
	try {
		await service(request, 'post', 'tracks', [
			{ id: POSE.track, workspace_id: WORKSPACE_SEED, name: 'Événements', slug: 'evenements', position: 90 },
		])
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/tracks/evenements')
		const vide = page.getByTestId('etat-vide')
		await expect(vide).toContainText('Aucun channel dans ce track')
		await illustrer(page, { chapitre: CHAPITRE, section: 'les-onglets-d-un-track', nom: 'track-sans-channel', cibles: [vide] })

		await service(request, 'post', 'workflows', [
			{ id: POSE.workflow, workspace_id: WORKSPACE_SEED, name: 'Événementiel', scope: 'global' },
		])
		await service(request, 'post', 'channels', [
			{
				id: POSE.channel,
				workspace_id: WORKSPACE_SEED,
				track_id: POSE.track,
				workflow_id: POSE.workflow,
				name: 'Salons',
				slug: 'salons',
				position: 1,
			},
		])
		await page.goto('/tracks/evenements/salons')
		const sansEtape = page.getByText('Ce workflow ne déclare aucune étape', { exact: true })
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'les-onglets-d-un-track',
			nom: 'workflow-sans-etape',
			cibles: [sansEtape.locator('..')],
		})
	} finally {
		await retirerPose(request)
	}
	await page.goto('/tracks/ce-track-nexiste-pas')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'les-onglets-d-un-track',
		nom: 'track-introuvable',
		cibles: [page.getByText('Track introuvable', { exact: true })],
	})
})

test('la description au survol, et le champ qui la saisit', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(BOARD)
	const pilule = page.locator('[data-testid="entree-track"][data-slug="conseil-ia"]')
	await pilule.hover()
	const bulle = page.getByTestId('infobulle')
	await expect(bulle).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-description-d-un-track-d-un-channel-ou-d-une-affaire-au-survol',
		nom: 'infobulle',
		cibles: [pilule, bulle],
	})

	await page.goto('/reglages/arborescence')
	await page.getByRole('button', { name: 'Modifier Conseil & IA' }).click()
	const formulaire = page.getByTestId('formulaire-track')
	await expect(formulaire.getByLabel('Description')).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-description-d-un-track-d-un-channel-ou-d-une-affaire-au-survol',
		nom: 'champ-description',
		cibles: [formulaire.getByLabel('Description'), formulaire.getByText('Description', { exact: true })],
	})
})

test('au clavier : « Aller au contenu »', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(BOARD)
	await expect(page.getByTestId('carte-card').first()).toBeVisible()
	// Le lien paraît à la première tabulation ; il reçoit ici ce même focus.
	const evitement = page.getByRole('link', { name: 'Aller au contenu' })
	await evitement.focus()
	await expect(evitement).toBeFocused()
	await illustrer(page, { chapitre: CHAPITRE, section: 'naviguer-au-clavier', nom: 'aller-au-contenu', cibles: [evitement] })
})

test('l’aide : le panneau, un chapitre, ses états', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(BOARD)
	await page.getByTestId('bouton-aide').click()
	await expect(page.getByTestId('panneau-aide')).toBeVisible()
	await immobile(page, 'panneau-aide')
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'l-aide-le-manuel-depuis-n-importe-quel-ecran',
		nom: 'panneau-aide',
		cibles: [page.getByTestId('bouton-aide'), page.getByTestId('panneau-aide')],
	})

	await page.goto(`/aide/${CHAPITRE}`)
	const sommaire = page.getByRole('navigation', { name: 'Dans ce chapitre' })
	await expect(sommaire).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'l-aide-le-manuel-depuis-n-importe-quel-ecran',
		nom: 'un-chapitre',
		cibles: [page.getByRole('heading', { level: 1 }), sommaire],
	})

	await page.goto('/aide/ce-chapitre-n-existe-pas')
	await expect(page.getByRole('heading', { level: 1, name: 'Chapitre introuvable' })).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'l-aide-le-manuel-depuis-n-importe-quel-ecran',
		nom: 'chapitre-introuvable',
		cibles: [page.getByRole('heading', { level: 1, name: 'Chapitre introuvable' }), page.getByText('Ce chapitre n’existe pas, ou plus, dans le manuel.')],
	})

	await page.route('**/storage/v1/object/**/contents.json*', (route) => route.abort('connectionrefused'))
	await page.goto('/aide')
	const erreur = page.getByTestId('etat-erreur')
	await expect(erreur).toContainText('Le manuel n’a pas pu être chargé', { timeout: 30_000 })
	await illustrer(page, { chapitre: CHAPITRE, section: 'l-aide-le-manuel-depuis-n-importe-quel-ecran', nom: 'manuel-indisponible', cibles: [erreur] })
})

test('l’aide : une illustration large, en taille réelle', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/aide/se-connecter-et-se-deconnecter')
	const lien = page.getByRole('link', { name: /^Voir en taille réelle/ }).first()
	await expect(lien).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'l-aide-le-manuel-depuis-n-importe-quel-ecran',
		nom: 'voir-en-taille-reelle',
		cibles: [lien],
	})
})

test('quand quelque chose ne va pas : la panne', async ({ page }) => {
	test.setTimeout(60_000)
	await connecterAvecLeLabs(page, ADMIN)
	await page.route(
		(url) => url.pathname.endsWith('/rest/v1/workspaces') && url.searchParams.get('order') === 'name.asc',
		(route) => route.abort('connectionrefused'),
	)
	await page.goto('/')
	const erreur = page.getByTestId('etat-erreur')
	await expect(erreur).toBeVisible({ timeout: 30_000 })
	await illustrer(page, { chapitre: CHAPITRE, section: 'quand-quelque-chose-ne-va-pas', nom: 'chargement-impossible', cibles: [erreur] })
	await page.unrouteAll()
})

test('les commandes grisées d’une lectrice', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	// « Grands comptes » est fermé à Farida Nowak par un droit fin du seed ; « Refonte » lui est ouvert en lecture.
	await page.goto('/tracks/studio-web/refonte')
	const bandeau = page.getByRole('status').filter({ hasText: /^Vous consultez/ }).first()
	await expect(bandeau).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'les-commandes-grisees-ce-que-votre-role-vous-laisse-faire',
		nom: 'bandeau-lecture',
		cibles: [bandeau],
	})

	await page.goto('/reglages')
	const entree = page.getByText('Coût du personnel', { exact: true }).first()
	await expect(entree).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'les-commandes-grisees-ce-que-votre-role-vous-laisse-faire',
		nom: 'reglages-lectrice',
		cibles: [entree.locator('xpath=ancestor::li[1]')],
	})
})
