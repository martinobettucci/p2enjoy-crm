// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.2b : les images du chapitre 9, « L'affaire » — le tableau, la liste, le fil
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 9 (sections 9.10 à 9.13)
// @spec docs/SPEC-cards.md (le board, la vue liste, le sommeil), docs/SPEC-cards.md §14 (la timeline unifiée et ses filtres)
//
// Le tableau et la liste sont ceux de « Grands comptes », du seed. L'affaire créée par « Nouvelle affaire » et celle
// qu'on endort sont détruites à la fin ; un channel sans affaire est posé puis retiré par la clé de service.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { illustrer } from './illustrer'
import { ADMIN, WORKSPACE_SEED, connecterAvecLeLabs, detruireAffaire, lireService, poserAffaire, retablirLeSeed, retenir, service } from './outils'

const CHAPITRE = 'l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre'
const S = {
	board: 'le-tableau-kanban-d-un-channel',
	liste: 'la-vue-liste-d-un-channel',
	fil: 'l-historique-et-la-discussion-d-une-affaire',
	sommeil: 'mettre-une-affaire-en-sommeil-et-la-retrouver',
	corbeille: 'mettre-une-affaire-a-la-corbeille',
} as const

const GRANDS_COMPTES = '/tracks/conseil-ia/grands-comptes'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_SIGNATURE = '5eed0000-0000-4000-8000-000000000064'
const TRACK_CONSEIL = '5eed0000-0000-4000-8000-000000000021'
const CHANNEL_VIDE = 'e1170000-0000-4000-8000-0000000009c1'


// Les affaires jetables sont retirées même quand un test dépasse son délai.
test.afterEach(async ({ request }) => retablirLeSeed(request, ['Diagnostic data Ormeau', 'Renouvellement Ostrea']))

test('le tableau : sa barre, la création d’une affaire', async ({ page, request }) => {
	const titre = 'Diagnostic data Ormeau'
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(GRANDS_COMPTES)
		await expect(page.getByTestId('carte-card').first()).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.board, nom: 'barre-du-tableau', cibles: [page.getByTestId('barre-board')] })

		// « Nouvelle affaire » cède sa place au formulaire : le bouton d'abord, puis le formulaire.
		await illustrer(page, { chapitre: CHAPITRE, section: S.board, nom: 'nouvelle-affaire', cibles: [page.getByTestId('nouvelle-affaire')] })
		await page.getByTestId('nouvelle-affaire').click()
		const formulaire = page.getByTestId('formulaire-nouvelle-affaire')
		await expect(formulaire).toBeVisible()
		await expect(page.getByTestId('select-modele-affaire')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.board, nom: 'formulaire-nouvelle-affaire', cibles: [formulaire] })
		await page.getByTestId('champ-titre-affaire').fill(titre)
		const creation = retenir()
		await page.route('**/rest/v1/rpc/creer_affaire', async (route) => {
			await creation.attendre
			await route.continue()
		})
		await page.getByTestId('creer-affaire').click()
		await expect(page.getByTestId('creer-affaire')).toHaveText('Création…')
		await illustrer(page, { chapitre: CHAPITRE, section: S.board, nom: 'creation-en-cours', cibles: [formulaire] })
		creation.liberer()
		// Une fois créée, l'affaire s'ouvre sur sa fiche.
		await expect(page.getByRole('heading', { level: 1, name: titre })).toBeVisible()
	} finally {
		const creees = await lireService<{ id: string }[]>(request, `cards?title=eq.${encodeURIComponent(titre)}&select=id`)
		for (const { id } of creees) await detruireAffaire(request, id)
	}

	await page.goto('/tracks/ce-track-nexiste-pas/grands-comptes')
	const introuvable = page.getByText('Track introuvable', { exact: true }).first()
	await expect(introuvable).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.board, nom: 'track-introuvable', cibles: [introuvable] })
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'track-introuvable-liste', cibles: [introuvable] })
})

test('la vue liste : le compte, la pagination, les vides', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto(`${GRANDS_COMPTES}/liste`)
	await expect(page.getByTestId('ligne-card').first()).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'vue-liste', cibles: [page.getByTestId('barre-liste'), page.getByTestId('tableau-liste')] })
	const pagination = page.getByTestId('pagination-liste')
	if ((await pagination.count()) > 0) await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'pagination', cibles: [pagination] })

	await page.getByTestId('filtre-recherche').fill('zzz introuvable')
	await page.getByTestId('valider-recherche').click()
	const vide = page.getByTestId('etat-vide')
	await expect(vide).toContainText('Aucune affaire ne correspond')
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'aucune-affaire-ne-correspond', cibles: [page.getByTestId('filtres-liste'), vide] })

	await page.goto(`${GRANDS_COMPTES}/liste?page=99`)
	const disparue = page.getByText("Cette page n'existe plus").first()
	await expect(disparue).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'page-disparue', cibles: [disparue] })

	await service(request, 'delete', `channels?id=eq.${CHANNEL_VIDE}`)
	await service(request, 'post', 'channels', [
		{ id: CHANNEL_VIDE, workspace_id: WORKSPACE_SEED, track_id: TRACK_CONSEIL, workflow_id: WORKFLOW_GLOBAL, name: 'Partenariats', slug: 'partenariats', position: 90 },
	])
	try {
		await page.goto('/tracks/conseil-ia/partenariats/liste')
		const aucune = page.getByTestId('etat-vide')
		// Les affaires en sommeil sont masquées par défaut : le channel vide le dit d'abord ainsi.
		await expect(aucune).toContainText('Aucune affaire éveillée dans ce channel')
		await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'aucune-affaire-eveillee', cibles: [aucune] })
		const bascule = page.getByLabel('Afficher les affaires en sommeil')
		await bascule.click()
		await expect(bascule).toBeChecked()
		await expect(aucune).toContainText('Aucune affaire dans ce channel')
		await illustrer(page, { chapitre: CHAPITRE, section: S.liste, nom: 'channel-vide', cibles: [aucune] })
	} finally {
		await service(request, 'delete', `channels?id=eq.${CHANNEL_VIDE}`)
	}
})

test('le sommeil, le fil et ses filtres', async ({ page, request }) => {
	test.setTimeout(120_000)
	const id = randomUUID()
	const titre = 'Renouvellement Ostrea'
	await poserAffaire(request, { id, titre, channel: CHANNEL_GRANDS_COMPTES, workflow: WORKFLOW_GLOBAL, etape: ETAPE_SIGNATURE })
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`${GRANDS_COMPTES}/cards/${id}`)
		await expect(page.getByTestId('entete-card')).toBeVisible()
		const vide = page.getByText('Aucun événement pour le moment').first()
		if ((await vide.count()) > 0) await illustrer(page, { chapitre: CHAPITRE, section: S.fil, nom: 'fil-vide', cibles: [vide] })
		await illustrer(page, { chapitre: CHAPITRE, section: S.fil, nom: 'mentionner', cibles: [page.getByRole('button', { name: /^Mentionner/ })] })

		await page.getByTestId('entete-card-endormir').click()
		const panneau = page.getByTestId('entete-card-panneau-sommeil')
		await expect(panneau).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: S.sommeil, nom: 'panneau-sommeil', cibles: [panneau] })
		// Une échéance usuelle part aussitôt ; « Mettre en sommeil » sans date saisie est refusé (« Une échéance est nécessaire. »).
		await panneau.getByRole('button').first().click()
		const badge = page.getByTestId('entete-card-sommeil')
		await expect(badge).toContainText('En sommeil jusqu’au')
		await illustrer(page, { chapitre: CHAPITRE, section: S.sommeil, nom: 'en-sommeil', cibles: [page.getByTestId('entete-card').getByRole('heading', { level: 2 }), badge] })

		await page.goto(GRANDS_COMPTES)
		const bascule = page.getByLabel('Afficher les affaires en sommeil')
		await bascule.click()
		await expect(bascule).toBeChecked()
		await expect(page.getByTestId('carte-card').filter({ hasText: titre })).toBeVisible()
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: S.sommeil,
			nom: 'afficher-les-affaires-en-sommeil',
			cibles: [bascule, page.getByTestId('carte-card').filter({ hasText: titre })],
		})
		await illustrer(page, { chapitre: CHAPITRE, section: S.board, nom: 'barre-sommeil-board', cibles: [page.getByTestId('barre-sommeil-board')] })
		await page.goto(`${GRANDS_COMPTES}/liste`)
		await illustrer(page, { chapitre: CHAPITRE, section: S.sommeil, nom: 'compte-de-la-liste', cibles: [page.getByTestId('total-liste')] })
	} finally {
		await detruireAffaire(request, id)
	}

	// Le fil d'une affaire riche, filtré.
	await page.goto('/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c2')
	await page.getByRole('group', { name: 'Filtres du fil' }).getByRole('button', { name: /^Cycle de vie/ }).click()
	await illustrer(page, { chapitre: CHAPITRE, section: S.corbeille, nom: 'cycle-de-vie', cibles: [page.getByRole('group', { name: 'Filtres du fil' }).getByRole('button', { name: /^Cycle de vie/ })] })
	const aucun = page.getByText('Aucun élément pour ces filtres').first()
	if ((await aucun.count()) > 0) await illustrer(page, { chapitre: CHAPITRE, section: S.fil, nom: 'aucun-element', cibles: [aucun] })
})
