// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.5 : les images des chapitres 30 et 31, « L'entonnoir de conversion » et
//       « Le prévisionnel pondéré et le taux de conversion »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitres 30, 31 ; docs/SPEC-analytique.md §5 (la portée et
//       les droits), §7.3 (les deux mentions), §8 bis (les nœuds sans affaire), §11.2 (une devise par tableau)
//
// L'écran ne fait que lire : tout se photographie sur le seed. Trois états n'y existent pas et sont posés : un espace
// vide et son administratrice (montés puis démontés, comme au chapitre 7), un channel sans affaire (posé puis retiré
// par la clé de service), et les deux réponses d'échec de la lecture — refus et panne —, que la page reçoit à la place
// de celle du serveur pour la seule requête de l'entonnoir.

import { expect, test } from '@playwright/test'
import { illustrer } from './illustrer'
import { ADMIN, WORKFLOW_GLOBAL, WORKSPACE_SEED, connecterAvecLeLabs, demonterEspaceNeuf, detruireAffaire, monterEspaceNeuf, poserAffaire, service, type Compte } from './outils'

const ENTONNOIR = 'l-entonnoir-de-conversion-ou-se-tiennent-vos-affaires'
const PREVISIONNEL = 'le-previsionnel-pondere-et-le-taux-de-conversion'
const S = {
	portee: 'choisir-la-portee-tout-l-espace-un-track-un-channel',
	montre: 'ce-que-l-ecran-montre',
	entrent: 'quelles-affaires-y-entrent-et-lesquelles-n-y-entrent-pas',
	probabilite: 'la-probabilite-d-une-affaire-trois-niveaux-et-le-plus-precis-gagne',
	vos: 'vos-nombres-sont-les-votres-et-ils-peuvent-differer-de-ceux-d-un-collegue',
	devises: 'les-devises-ne-se-melangent-jamais',
	rien: 'ce-que-l-ecran-ecrit-quand-il-n-y-a-rien-a-montrer',
	pondere: 'le-previsionnel-pondere',
	taux: 'le-taux-de-conversion-des-affaires-decidees',
} as const
const ESPACE_VIDE = { id: 'e1300000-0000-4000-8000-0000000000f1', slug: 'atelier-manuel-30', nom: 'Atelier Morel' }
const CHANNEL_VIDE = 'e1300000-0000-4000-8000-0000000000c1'
const TRACK_FORMATION = '5eed0000-0000-4000-8000-000000000023'

const AFFAIRE_LIVREE = 'e1300000-0000-4000-8000-0000000000d1'
const ETAPE_LIVRE = '5eed0000-0000-4000-8000-000000000066'

test.afterEach(async ({ request }) => {
	await detruireAffaire(request, AFFAIRE_LIVREE)
	await service(request, 'delete', `channels?id=eq.${CHANNEL_VIDE}`)
})


test('l’entonnoir de tout l’espace : deux devises, le genre, le prévisionnel et le taux', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/pilotage')
	await expect(page.getByRole('heading', { name: 'Entonnoir en CHF' })).toBeVisible()
	await illustrer(page, { chapitre: ENTONNOIR, section: null, nom: 'pilotage', cibles: [], pleinePage: true })
	const nav = page.getByRole('navigation', { name: 'Navigation principale' })
	await illustrer(page, { chapitre: ENTONNOIR, section: null, nom: 'barre-laterale', cibles: [nav.getByRole('link', { name: 'Coûts' }), nav.getByRole('link', { name: 'Rentabilité' })] })

	const eur = page.getByRole('region', { name: 'Entonnoir en EUR' })
	await illustrer(page, { chapitre: ENTONNOIR, section: S.montre, nom: 'entonnoir', cibles: [eur.getByRole('table')] })
	await illustrer(page, { chapitre: ENTONNOIR, section: S.entrent, nom: 'genre', cibles: [eur.getByRole('columnheader', { name: 'Genre' }), eur.getByRole('row', { name: /Livré/ })] })
	await illustrer(page, { chapitre: ENTONNOIR, section: S.probabilite, nom: 'affaires-et-montants', cibles: [eur.getByRole('columnheader', { name: 'Affaires' }), eur.getByRole('row').nth(2)] })
	const portee = page.getByTestId('pilotage-portee')
	await illustrer(page, { chapitre: ENTONNOIR, section: S.vos, nom: 'portee-de-tout-l-espace', cibles: [portee] })
	await illustrer(page, { chapitre: ENTONNOIR, section: S.devises, nom: 'deux-devises', cibles: [page.getByRole('heading', { name: 'Entonnoir en EUR' }), page.getByRole('heading', { name: 'Entonnoir en CHF' })] })

	await illustrer(page, { chapitre: PREVISIONNEL, section: null, nom: 'pilotage', cibles: [], pleinePage: true })
	await illustrer(page, { chapitre: PREVISIONNEL, section: S.pondere, nom: 'pondere', cibles: [page.getByText('Prévisionnel pondéré', { exact: true }), page.getByTestId('pilotage-pondere')] })
	await illustrer(page, { chapitre: PREVISIONNEL, section: S.pondere, nom: 'genre', cibles: [eur.getByRole('columnheader', { name: 'Genre' }), eur.getByRole('row', { name: /Livré/ })] })
	await illustrer(page, { chapitre: PREVISIONNEL, section: S.taux, nom: 'taux', cibles: [page.getByText('Taux de conversion des affaires décidées', { exact: true }), page.getByTestId('pilotage-taux-detail')] })
})

test('la portée d’un track : le sélecteur, la phrase qui la nomme, les étapes sans affaire', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/pilotage?track=studio-web')
	const selecteur = page.getByTestId('pilotage-selecteur-portee')
	await expect(selecteur).toBeVisible()
	await illustrer(page, { chapitre: ENTONNOIR, section: S.portee, nom: 'portee', cibles: [selecteur] })
	await illustrer(page, { chapitre: ENTONNOIR, section: S.vos, nom: 'portee-d-un-track', cibles: [page.getByTestId('pilotage-portee')] })
	const vides = page.getByTestId('pilotage-noeuds-vides')
	await expect(vides).toBeVisible()
	await illustrer(page, { chapitre: ENTONNOIR, section: S.montre, nom: 'etapes-sans-affaire', cibles: [vides] })

	// Tous les channels du seed portent des affaires : un channel vide est posé le temps de l'image, puis retiré.
	await service(request, 'post', 'channels', [
		{ id: CHANNEL_VIDE, workspace_id: WORKSPACE_SEED, track_id: TRACK_FORMATION, workflow_id: WORKFLOW_GLOBAL, name: 'Ateliers', slug: 'ateliers-manuel' },
	])
	await page.goto('/pilotage?track=formation&channel=ateliers-manuel')
	const vide = page.getByText('Aucune affaire active dans cette portée').first()
	await expect(vide).toBeVisible()
	await illustrer(page, { chapitre: ENTONNOIR, section: S.portee, nom: 'portee-sans-affaire', cibles: [page.getByTestId('pilotage-selecteur-portee'), vide] })
})

test('une portée sans affaire décidée, puis une portée sans affaire ouverte', async ({ page, request }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/pilotage?track=conseil-ia&channel=prospection')
	const decidee = page.getByText('Aucune affaire décidée à ce jour.')
	await expect(decidee).toBeVisible()
	await illustrer(page, { chapitre: PREVISIONNEL, section: S.taux, nom: 'aucune-affaire-decidee', cibles: [page.getByText('Taux de conversion des affaires décidées', { exact: true }), decidee] })

	// Aucune portée du seed n'a que des affaires décidées : un channel jetable reçoit une affaire livrée, puis part.
	await service(request, 'post', 'channels', [
		{ id: CHANNEL_VIDE, workspace_id: WORKSPACE_SEED, track_id: TRACK_FORMATION, workflow_id: WORKFLOW_GLOBAL, name: 'Ateliers', slug: 'ateliers-manuel' },
	])
	await poserAffaire(request, { id: AFFAIRE_LIVREE, titre: 'Atelier IA — Lycée Lumière', channel: CHANNEL_VIDE, workflow: WORKFLOW_GLOBAL, etape: ETAPE_LIVRE })
	await page.goto('/pilotage?track=formation&channel=ateliers-manuel')
	const ouverte = page.getByText('Aucune affaire ouverte à ce jour.')
	await expect(ouverte).toBeVisible()
	await illustrer(page, { chapitre: PREVISIONNEL, section: S.pondere, nom: 'aucune-affaire-ouverte', cibles: [page.getByText('Prévisionnel pondéré', { exact: true }), ouverte] })
})

test('la lecture refusée, puis en panne', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	let statut = 403
	await page.route('**/rest/v1/rpc/**', async (route) => {
		if (!/pilotage|funnel|entonnoir/i.test(route.request().url())) return route.continue()
		await route.fulfill({ status: statut, contentType: 'application/json', body: JSON.stringify({ code: statut === 403 ? '42501' : 'XX000', message: 'refus' }) })
	})
	await page.goto('/pilotage')
	const refus = page.getByText('Lecture refusée').first()
	await expect(refus).toBeVisible()
	await illustrer(page, { chapitre: ENTONNOIR, section: S.rien, nom: 'lecture-refusee', cibles: [refus.locator('xpath=ancestor::*[.//p][1]')] })
	statut = 500
	await page.goto('/pilotage')
	const erreur = page.getByTestId('etat-erreur')
	await expect(erreur).toContainText('L’entonnoir n’a pas pu être lu')
	await illustrer(page, { chapitre: ENTONNOIR, section: S.rien, nom: 'lecture-impossible', cibles: [erreur] })
})

test.describe('dans un espace sans affaire', () => {
	let compte: Compte | null = null
	test.beforeAll(async ({ request }) => {
		compte = await monterEspaceNeuf(request, ESPACE_VIDE, { prenom: 'Claire', nom: 'Morel' })
	})
	test.afterAll(async ({ request }) => {
		await demonterEspaceNeuf(request, ESPACE_VIDE, compte)
	})

	test('aucune affaire active, aucune ouverte, aucune décidée', async ({ page }) => {
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await page.goto('/pilotage')
		const vide = page.getByText('Aucune affaire active', { exact: true }).first()
		await expect(vide).toBeVisible()
		await illustrer(page, { chapitre: ENTONNOIR, section: S.rien, nom: 'aucune-affaire-active', cibles: [vide.locator('xpath=ancestor::*[.//p][1]')] })
	})
})
