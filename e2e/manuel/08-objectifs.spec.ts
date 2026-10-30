// @spec CRM-117 (docs/BACKLOG.md) — tranche T4.2 : les images du chapitre 8, « Les objectifs : le tableau blanc »
// @spec docs/SPEC-manual.md §11.1, §11.2 ; docs/manual.md chapitre 8 ; docs/SPEC-goals.md §3 (le canevas), §5 (la liste,
//       les tableaux archivés), §5.7 (la lecture seule)
//
// Les tableaux, les blocs et les flèches sont ceux du seed (« Objectifs du trimestre », « Objectifs 2025 (clos) »,
// archivé). Le bloc que le scénario pose pour montrer sa fiche, il le supprime par l'écran — c'est la section 8.5. Deux
// états demandent une pose par la clé de service, retirée ensuite : un bloc visant le channel à la corbeille du seed
// (« Lien perdu »), et l'espace neuf des vides.

import { expect, test, type Page } from '@playwright/test'
import { illustrer } from './illustrer'
import {
	ADMIN,
	VIEWER,
	connecterAvecLeLabs,
	demonterEspaceNeuf,
	immobile,
	lireService,
	monterEspaceNeuf,
	service,
	type Compte,
} from './outils'

const CHAPITRE = 'les-objectifs-le-tableau-blanc-de-l-equipe'
const TABLEAU = 'Objectifs du trimestre'
const ESPACE = { id: 'e1170000-0000-4000-8000-0000000008a1', slug: 'espace-sans-objectif', nom: 'Nouvel espace' } as const
const BLOC_PERDU = 'e1170000-0000-4000-8000-0000000008b1'

async function ouvrirLeTableau(page: Page): Promise<void> {
	await page.goto('/objectifs')
	await page.getByRole('link', { name: new RegExp(TABLEAU) }).click()
	await expect(page.getByRole('heading', { name: TABLEAU })).toBeVisible()
	await expect(page.getByTestId('bloc-objectif').first()).toBeVisible()
}

test('la liste des tableaux, et les archivés', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/objectifs')
	const premier = page.getByTestId('tableau-objectifs').first()
	await expect(premier).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-liste-des-tableaux',
		nom: 'liste',
		cibles: [page.getByRole('heading', { name: 'Tableaux d’objectifs' }), page.getByTestId('creer-tableau'), premier, page.getByTestId('afficher-archives-tableaux')],
	})
	await page.getByTestId('afficher-archives-tableaux').check()
	const archive = page.getByTestId('tableau-objectifs-archive').first()
	await expect(archive).toContainText('Archivé')
	await illustrer(page, { chapitre: CHAPITRE, section: 'la-liste-des-tableaux', nom: 'tableau-archive', cibles: [archive, page.getByTestId('desarchiver-tableau').first()] })
	await page.getByTestId('afficher-archives-tableaux').uncheck()
})

test('une lectrice qui tente de créer un tableau', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await page.goto('/objectifs')
	await page.getByTestId('creer-tableau').click()
	await page.getByTestId('champ-nom-tableau').fill('Objectifs de l’équipe')
	await page.getByTestId('valider-tableau').click()
	const refus = page.getByText('Vous ne pouvez pas administrer les tableaux de cet espace de travail.')
	await expect(refus).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'la-liste-des-tableaux',
		nom: 'refus-de-creation',
		cibles: [page.getByTestId('champ-nom-tableau'), page.getByTestId('valider-tableau'), refus],
	})
	await page.getByTestId('annuler-tableau').click()
})

test('le canevas, ses commandes et ses liens', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrirLeTableau(page)
	await illustrer(page, { chapitre: CHAPITRE, section: null, nom: 'canevas', cibles: [], pleinePage: true })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'le-canevas',
		nom: 'commandes-du-canevas',
		cibles: [page.getByRole('link', { name: 'Retour aux tableaux' }), page.getByTestId('zoom-moins'), page.getByTestId('zoom-valeur'), page.getByTestId('zoom-plus')],
	})
	const blocLie = page.getByTestId('bloc-objectif').filter({ has: page.getByTestId('pilule-channel') }).first()
	await illustrer(page, { chapitre: CHAPITRE, section: 'le-canevas', nom: 'un-bloc', cibles: [blocLie] })
	const liens = page.getByTestId('equivalent-textuel')
	await illustrer(page, { chapitre: CHAPITRE, section: 'le-canevas', nom: 'liens-du-diagramme', cibles: [liens] })
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'tracer-et-supprimer-une-fleche',
		nom: 'tracer-une-fleche',
		cibles: [page.getByTestId('tracer-fleche'), liens.getByTestId('ligne-diagramme').first()],
	})
})

test('poser un bloc, le nommer, puis le supprimer', async ({ page, request }) => {
	const titre = 'Ouvrir un bureau à Lyon'
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeTableau(page)
		const blocs = await page.getByTestId('bloc-objectif').count()
		await page.getByTestId('poser-bloc').click()
		await expect(page.getByTestId('repere-pose')).toBeVisible()
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'poser-deplacer-et-modifier-un-bloc',
			nom: 'poser-un-bloc',
			cibles: [page.getByTestId('poser-bloc'), page.getByTestId('pose-consigne')],
		})
		await page.keyboard.press('Enter')
		const fiche = page.getByTestId('fiche-bloc')
		await expect(fiche).toBeVisible()
		await page.getByTestId('champ-titre').fill(titre)
		await page.getByTestId('champ-titre').press('Tab')
		const enregistre = fiche.getByText('Enregistré', { exact: true }).first()
		await expect(enregistre).toBeVisible()
		await immobile(page, 'fiche-bloc')
		// La fiche entière dépasse la fenêtre : son en-tête, le titre et l'état d'enregistrement suffisent au passage.
		await illustrer(page, {
			chapitre: CHAPITRE,
			section: 'poser-deplacer-et-modifier-un-bloc',
			nom: 'fiche-du-bloc',
			cibles: [fiche.getByTestId('fermer-fiche'), page.getByTestId('champ-titre'), enregistre],
		})

		await illustrer(page, { chapitre: CHAPITRE, section: 'supprimer-un-bloc', nom: 'commande-supprimer', cibles: [page.getByTestId('supprimer-bloc')] })
		await page.getByTestId('supprimer-bloc').click()
		const confirmation = page.getByTestId('confirmation-suppression-bloc')
		await expect(confirmation).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: 'supprimer-un-bloc', nom: 'supprimer-le-bloc', cibles: [confirmation] })
		await page.getByTestId('confirmer-suppression-bloc').click()
		await expect(page.getByTestId('bloc-objectif')).toHaveCount(blocs)
	} finally {
		// Un échec en chemin laisserait le bloc sur le tableau du seed.
		await service(request, 'delete', `goal_blocks?title=eq.${encodeURIComponent(titre)}`)
	}
})

test('la fiche d’un bloc qui vise un channel', async ({ page }) => {
	await connecterAvecLeLabs(page, ADMIN)
	await ouvrirLeTableau(page)
	const blocLie = page.getByTestId('bloc-objectif').filter({ has: page.getByTestId('pilule-channel') }).first()
	await blocLie.focus()
	await page.keyboard.press('Enter')
	const fiche = page.getByTestId('fiche-bloc')
	await expect(fiche.getByTestId('retirer-lien')).toBeVisible()
	await illustrer(page, {
		chapitre: CHAPITRE,
		section: 'poser-deplacer-et-modifier-un-bloc',
		nom: 'channel-vise',
		// « Fermer la fiche », en tête de fiche, est loin du lien : il paraît sur l'image `fiche-du-bloc`.
		cibles: [fiche.getByTestId('champ-lien'), fiche.getByTestId('retirer-lien')],
	})
	await page.keyboard.press('Escape')
})

test('la lectrice : un bloc qu’elle ne lit pas, et la lecture seule', async ({ page }) => {
	await connecterAvecLeLabs(page, VIEWER)
	await ouvrirLeTableau(page)
	const horsDePortee = page.getByTestId('ligne-diagramme').filter({ hasText: 'extrémité hors de portée' }).first()
	await expect(horsDePortee).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'le-canevas', nom: 'extremite-hors-de-portee', cibles: [horsDePortee] })
	await illustrer(page, { chapitre: CHAPITRE, section: 'qui-peut-ecrire', nom: 'lecture-seule', cibles: [page.getByTestId('canevas-lecture-seule')] })
})

test('un bloc dont le channel est à la corbeille', async ({ page, request }) => {
	const [tableau] = await lireService<{ id: string }[]>(request, `goal_boards?name=eq.${encodeURIComponent(TABLEAU)}&select=id`)
	const [corbeille] = await lireService<{ id: string }[]>(request, 'channels?deleted_at=not.is.null&select=id&limit=1')
	if (tableau === undefined || corbeille === undefined) throw new Error('le seed des objectifs ou de la corbeille est absent')
	await service(request, 'delete', `goal_blocks?id=eq.${BLOC_PERDU}`)
	await service(request, 'post', 'goal_blocks', [
		{ id: BLOC_PERDU, board_id: tableau.id, title: 'Relancer les anciens clients', channel_id: corbeille.id, pos_x: 40, pos_y: 520, width: 240, height: 120 },
	])
	try {
		await connecterAvecLeLabs(page, ADMIN)
		await ouvrirLeTableau(page)
		const bloc = page.getByTestId('bloc-objectif').filter({ hasText: 'Relancer les anciens clients' })
		await expect(bloc.getByTestId('lien-perdu')).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: 'le-canevas', nom: 'lien-perdu', cibles: [bloc] })
	} finally {
		await service(request, 'delete', `goal_blocks?id=eq.${BLOC_PERDU}`)
	}
})

test('des tableaux qui n’ont pas pu être chargés, une adresse inconnue', async ({ page }) => {
	test.setTimeout(60_000)
	await connecterAvecLeLabs(page, ADMIN)
	await page.goto('/objectifs/5eed0000-0000-4000-8000-0000000000ff')
	const introuvable = page.getByText('Tableau introuvable', { exact: true }).first()
	await expect(introuvable).toBeVisible()
	await illustrer(page, { chapitre: CHAPITRE, section: 'quand-il-n-y-a-rien', nom: 'tableau-introuvable', cibles: [introuvable] })

	await page.route('**/rest/v1/goal_boards?*', (route) => route.abort('connectionrefused'))
	await page.goto('/objectifs')
	const erreur = page.getByTestId('etat-erreur')
	await expect(erreur).toBeVisible({ timeout: 30_000 })
	await illustrer(page, { chapitre: CHAPITRE, section: 'quand-il-n-y-a-rien', nom: 'chargement-impossible', cibles: [erreur] })
})

test.describe('dans un espace sans objectif', () => {
	let compte: Compte | null = null
	test.beforeAll(async ({ request }) => {
		compte = await monterEspaceNeuf(request, ESPACE, { prenom: 'Claire', nom: 'Morel' })
	})
	test.afterAll(async ({ request }) => {
		await service(request, 'delete', `goal_boards?workspace_id=eq.${ESPACE.id}`)
		await demonterEspaceNeuf(request, ESPACE, compte)
	})

	test('aucun tableau, puis un tableau sans objectif', async ({ page }) => {
		if (compte === null) throw new Error('montage absent')
		await connecterAvecLeLabs(page, compte.adresse)
		await page.goto('/objectifs')
		const vide = page.getByTestId('etat-vide')
		await expect(vide).toContainText('Aucun tableau d’objectifs')
		await illustrer(page, { chapitre: CHAPITRE, section: 'quand-il-n-y-a-rien', nom: 'aucun-tableau', cibles: [vide, page.getByTestId('creer-tableau')] })

		await page.getByTestId('creer-tableau').click()
		await page.getByTestId('champ-nom-tableau').fill('Objectifs de l’année')
		await page.getByTestId('valider-tableau').click()
		await page.getByRole('link', { name: /Objectifs de l’année/ }).click()
		const sansObjectif = page.getByText('Aucun objectif sur ce tableau').first()
		await expect(sansObjectif).toBeVisible()
		await illustrer(page, { chapitre: CHAPITRE, section: 'quand-il-n-y-a-rien', nom: 'aucun-objectif', cibles: [sansObjectif] })
	})
})
