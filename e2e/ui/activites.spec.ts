// @verifies CRM-067 (docs/BACKLOG.md) — tranche T3 : le bloc « Activités » et le fil, de bout en bout, sur la pile réelle
//           et le seed (docs/SPEC-seed.md §23)
// @verifies docs/SPEC-activites.md §4 (le bloc, le formulaire, corriger et retirer selon les droits ; la troisième source
//           du fil), §5 (états et refus), §3 (droits d'un commentaire : l'auteur corrige, l'administratrice retire) ;
//           docs/DESIGN_SYSTEM.md §5.63 (ce bloc), §5.59 (commandes éteintes avec le motif), §7 (aucun défilement
//           horizontal), §8 (clavier) ; CLAUDE.md §16 (captures)
//
// Les activités du seed sont LUES, jamais modifiées : la consignation et le retrait sont exercés sur une activité que ce
// fichier crée et retire lui-même, puis efface par la clé de service — le filet de fin de fichier. Les refus de la base
// aux jetons réels sont prouvés par `e2e/api/activites.spec.ts`.

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	connecterAvecLeLabs,
	expect,
	test,
	type Page,
} from './fixtures'
import { CLE_SERVICE, URL_API } from '../api/jetons'
import { PALIERS, capturer } from './captures'

const UNITE = 'CRM-067'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'

/** « Migration ERP Sogexia » : les trois activités du seed (docs/SPEC-seed.md §23.1). */
const SOGEXIA = {
	id: '5eed0000-0000-4000-8000-0000000000c2',
	adresse: '/tracks/conseil-ia/grands-comptes/cards/5eed0000-0000-4000-8000-0000000000c2',
}
/** « Refonte intranet Ville de Lyon » : la lectrice la lit sans l'écrire, et le seed n'y pose aucune activité. */
const REFONTE = '/tracks/studio-web/refonte/cards/5eed0000-0000-4000-8000-0000000000c4'
/** « Assistant IA support — Nordis » : la visio de Farida. */
const NORDIS = '/tracks/conseil-ia/prospection/cards/5eed0000-0000-4000-8000-0000000000cb'
const IDS_SEED = [
	'5eed0000-0000-4000-8000-0000000a0c01',
	'5eed0000-0000-4000-8000-0000000a0c02',
	'5eed0000-0000-4000-8000-0000000a0c03',
	'5eed0000-0000-4000-8000-0000000a0c04',
]
const PREFIXE = 'E2E CRM-067'

const bloc = (page: Page) => page.getByTestId('bloc-activites-card')
const lignes = (page: Page) => bloc(page).getByTestId('ligne-activite')
const fil = (page: Page) => page.getByRole('region', { name: 'Fil de cette affaire' })
const filtres = (page: Page) => page.getByRole('group', { name: 'Filtres du fil' })

/** Ce que ce fichier a pu laisser sur les deux affaires qu'il écrit : tout, sauf les activités du seed. */
async function nettoyer(): Promise<void> {
	for (const card of [SOGEXIA.id, '5eed0000-0000-4000-8000-0000000000cb']) {
		const reponse = await fetch(
			`${URL_API}/rest/v1/card_activities?card_id=eq.${card}&id=not.in.(${IDS_SEED.join(',')})`,
			{ method: 'DELETE', headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` } },
		)
		if (!reponse.ok) throw new Error(`nettoyage des activités : ${reponse.status} ${await reponse.text()}`)
	}
}

// AVANT ET APRÈS : un passage interrompu ne doit pas fausser le suivant, qui compte les lignes du seed.
test.beforeAll(nettoyer)
test.afterAll(nettoyer)

test.describe('le bloc « Activités » (docs/DESIGN_SYSTEM.md §5.63)', () => {
	test('les activités du seed, la plus récente en tête, et les commandes de l’auteur seulement', async ({ page }) => {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(SOGEXIA.adresse)
		await expect(lignes(page)).toHaveCount(3)

		// 17/10 retirée par la modération, 16/10 la réunion de Camille, 14/10 l'appel de Driss, corrigé.
		await expect(lignes(page).nth(0)).toContainText('Activité retirée par la modération')
		await expect(lignes(page).nth(0)).not.toContainText('Relance tarifaire')
		await expect(lignes(page).nth(1).getByTestId('sujet-activite')).toHaveText('Atelier de cadrage du lot 1')
		await expect(lignes(page).nth(1)).toContainText('Réunion')
		await expect(lignes(page).nth(1)).toContainText('90 min')
		await expect(lignes(page).nth(1)).toContainText('par Camille Aubert')
		await expect(lignes(page).nth(1).getByTestId('participants-activite')).toHaveText(/Léo Marchand/)
		const appel = lignes(page).nth(2)
		await expect(appel.getByTestId('sujet-activite')).toHaveText('Appel de qualification')
		await expect(appel).toContainText('modifiée')

		// Le compte rendu est replié, et se déplie au clavier.
		const compteRendu = appel.getByTestId('compte-rendu-activite')
		await expect(compteRendu).toBeHidden()
		await appel.getByText('Compte rendu', { exact: true }).focus()
		await page.keyboard.press('Enter')
		await expect(compteRendu).toContainText('Budget validé par la DAF.')

		// Driss corrige et retire SA ligne ; la réunion de Camille et la pierre tombale ne lui offrent rien.
		await expect(appel.getByTestId('actions-activite').getByRole('button')).toHaveText(['Corriger', 'Retirer'])
		await expect(lignes(page).nth(1).getByTestId('actions-activite')).toHaveCount(0)
		await expect(lignes(page).nth(0).getByTestId('actions-activite')).toHaveCount(0)

		await bloc(page).scrollIntoViewIfNeeded()
		await capturer(page, 'activites-bloc-1440', UNITE)
	})

	test('le bloc vit juste après les contacts et avant les recettes', async ({ page }) => {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(SOGEXIA.adresse)
		await expect(bloc(page)).toBeVisible()
		const positions = await page.evaluate(() => {
			const y = (selecteur: string) =>
				document.querySelector(selecteur)?.getBoundingClientRect().top ?? Number.NaN
			return {
				contacts: y('[data-testid="bloc-contacts-card"]'),
				activites: y('[data-testid="bloc-activites-card"]'),
				recettes: y('[data-testid="bloc-recettes-card"]'),
			}
		})
		expect(positions.contacts).toBeLessThan(positions.activites)
		expect(positions.activites).toBeLessThan(positions.recettes)
	})

	test('le fil montre les trois activités à leur date, et la bascule « Activités » les compte', async ({ page }) => {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(SOGEXIA.adresse)
		await expect(filtres(page).getByRole('button', { name: /Activités/ })).toContainText('3')
		await expect(fil(page).getByTestId('activite-fil')).toHaveCount(3)
		await expect(fil(page).getByTestId('activite-fil').filter({ hasText: 'Atelier de cadrage du lot 1' })).toContainText('Réunion')
		await expect(fil(page).getByTestId('activite-fil').filter({ hasText: 'Activité retirée' })).toHaveCount(1)

		await filtres(page).getByRole('button', { name: /Activités/ }).click()
		await expect(fil(page).getByTestId('activite-fil')).toHaveCount(0)
		await filtres(page).getByRole('button', { name: /Activités/ }).click()
		await fil(page).getByTestId('activite-fil').first().scrollIntoViewIfNeeded()
		await capturer(page, 'activites-fil-1440', UNITE)
	})
})

test.describe('consigner, corriger, retirer — au clavier, sur la pile réelle', () => {
	test('Driss consigne une réunion, la corrige, puis la retire ; la base et le fil le constatent', async ({ page }) => {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(SOGEXIA.adresse)
		await expect(lignes(page)).toHaveCount(3)

		await bloc(page).getByTestId('consigner-activite').click()
		const formulaire = bloc(page).getByTestId('formulaire-activite')
		await expect(formulaire.getByRole('radio', { name: 'Appel' })).toBeFocused()
		await page.keyboard.press('ArrowRight')
		await expect(formulaire.getByRole('radio', { name: 'Réunion' })).toBeChecked()
		await formulaire.getByLabel('Durée (minutes)').fill('20')
		await formulaire.getByLabel('Sujet').fill(`${PREFIXE} point d'avancement`)
		await formulaire.getByLabel('Compte rendu', { exact: true }).fill('Lot 1 en recette.\nLot 2 à chiffrer.')
		await formulaire.getByRole('checkbox', { name: 'Léo Marchand' }).check()
		await bloc(page).scrollIntoViewIfNeeded()
		await capturer(page, 'activites-formulaire-1440', UNITE)
		await formulaire.getByTestId('envoyer-activite').click()

		await expect(formulaire).toHaveCount(0)
		await expect(bloc(page).getByTestId('consigner-activite')).toBeFocused()
		await expect(lignes(page)).toHaveCount(4)
		const neuve = lignes(page).first()
		await expect(neuve.getByTestId('sujet-activite')).toHaveText(`${PREFIXE} point d'avancement`)
		await expect(neuve.getByTestId('participants-activite')).toHaveText('Avec Léo Marchand')
		await expect(fil(page).getByTestId('activite-fil').filter({ hasText: PREFIXE })).toHaveCount(1)
		await expect(filtres(page).getByRole('button', { name: /Activités/ })).toContainText('4')

		// L'EFFET EN BASE, relu par la clé de service : l'auteur et l'espace sont ceux que la base a posés.
		const relue = await fetch(
			`${URL_API}/rest/v1/card_activities?select=id,author_id,workspace_id,type,duration_minutes,participants:card_activity_participants(contact_id)&subject=eq.${encodeURIComponent(`${PREFIXE} point d'avancement`)}`,
			{ headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` } },
		)
		const [ligne] = (await relue.json()) as {
			id: string
			author_id: string
			workspace_id: string
			type: string
			duration_minutes: number
			participants: { contact_id: string }[]
		}[]
		expect(ligne).toMatchObject({
			author_id: '5eed0000-0000-4000-8000-000000000012',
			workspace_id: '5eed0000-0000-4000-8000-000000000001',
			type: 'meeting',
			duration_minutes: 20,
			participants: [{ contact_id: '5eed0000-0000-4000-8000-000000000091' }],
		})

		// Corriger : le formulaire remplace la ligne, prérempli ; retirer Léo et changer la durée.
		await neuve.getByRole('button', { name: /Corriger l’activité/ }).click()
		const correction = bloc(page).getByTestId('formulaire-activite')
		await expect(correction.getByLabel('Sujet')).toHaveValue(`${PREFIXE} point d'avancement`)
		await correction.getByRole('checkbox', { name: 'Léo Marchand' }).uncheck()
		await correction.getByLabel('Durée (minutes)').fill('25')
		await correction.getByTestId('envoyer-activite').click()
		await expect(correction).toHaveCount(0)
		await expect(lignes(page).first()).toContainText('25 min')
		await expect(lignes(page).first()).toContainText('modifiée')
		await expect(lignes(page).first().getByTestId('participants-activite')).toHaveCount(0)

		// Retirer : confirmation sur la ligne, focus sur le bouton destructif.
		await lignes(page).first().getByRole('button', { name: /Retirer l’activité/ }).click()
		const confirmation = bloc(page).getByTestId('confirmation-retrait-activite')
		await expect(confirmation.getByTestId('confirmer-retrait-activite')).toBeFocused()
		await capturer(page, 'activites-retrait-1440', UNITE)
		await page.keyboard.press('Enter')
		await expect(lignes(page).first().getByTestId('activite-retiree')).toHaveText('Activité retirée')
		await expect(page.getByRole('status', { name: 'Annonces des activités' })).toHaveText('Activité retirée')
		await expect(fil(page).getByTestId('activite-fil').filter({ hasText: PREFIXE })).toHaveCount(0)
		// La pierre tombale part tout de suite : les captures de palier, plus bas, ne montrent que le seed.
		await nettoyer()
	})

	test('une date future est refusée DANS le formulaire, la saisie conservée, et rien n’est écrit', async ({ page }) => {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(SOGEXIA.adresse)
		await bloc(page).getByTestId('consigner-activite').click()
		const formulaire = bloc(page).getByTestId('formulaire-activite')
		const demain = new Date(Date.now() + 86_400_000)
		const champ = `${demain.getFullYear()}-${String(demain.getMonth() + 1).padStart(2, '0')}-${String(demain.getDate()).padStart(2, '0')}T10:00`
		await formulaire.getByLabel('Date et heure').fill(champ)
		await formulaire.getByLabel('Sujet').fill(`${PREFIXE} futur`)
		await formulaire.getByTestId('envoyer-activite').click()
		await expect(formulaire.getByTestId('refus-activite')).toHaveText(
			'La date est dans le futur : une activité consignée a déjà eu lieu.',
		)
		await expect(formulaire.getByLabel('Sujet')).toHaveValue(`${PREFIXE} futur`)
		// Le `400` du trigger est le refus que l'écran vient de traduire ; aucune autre anomalie n'est tolérée.
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[400]])
		await page.keyboard.press('Escape')
		await expect(bloc(page).getByTestId('consigner-activite')).toBeFocused()
		// RIEN N'EST ÉCRIT, relu en base — plutôt qu'un compte de lignes, qui dépendrait de l'ordre d'exécution.
		const relue = await fetch(
			`${URL_API}/rest/v1/card_activities?select=id&subject=eq.${encodeURIComponent(`${PREFIXE} futur`)}`,
			{ headers: { apikey: CLE_SERVICE, Authorization: `Bearer ${CLE_SERVICE}` } },
		)
		expect(await relue.json()).toEqual([])
		await expect(lignes(page).filter({ hasText: `${PREFIXE} futur` })).toHaveCount(0)
	})
})

test.describe('les droits, vus de l’écran (docs/SPEC-activites.md §3, docs/DESIGN_SYSTEM.md §5.59)', () => {
	test('l’administratrice ne reçoit que « Retirer » sur l’activité de Driss, avec le texte de la modération', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(SOGEXIA.adresse)
		const appel = lignes(page).filter({ hasText: 'Appel de qualification' })
		await expect(appel.getByTestId('actions-activite').getByRole('button')).toHaveText(['Retirer'])
		// Sa propre réunion lui offre les deux gestes de l'auteur.
		await expect(
			lignes(page).filter({ hasText: 'Atelier de cadrage du lot 1' }).getByTestId('actions-activite').getByRole('button'),
		).toHaveText(['Corriger', 'Retirer'])
		await appel.getByRole('button', { name: /Retirer l’activité/ }).click()
		await expect(bloc(page).getByTestId('confirmation-retrait-activite')).toContainText(
			'Cette activité a été consignée par Driss',
		)
		await capturer(page, 'activites-moderation-1440', UNITE)
		await bloc(page).getByRole('button', { name: 'Annuler' }).click()
		await expect(appel.getByRole('button', { name: /Retirer l’activité/ })).toBeFocused()
	})

	test('la lectrice, sur une affaire qu’elle ne peut que lire : état vide et commande éteinte, avec le motif', async ({
		page,
	}) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto(REFONTE)
		await expect(bloc(page).getByTestId('activites-vide')).toHaveText('Aucune activité consignée sur cette affaire.')
		const commande = bloc(page).getByTestId('consigner-activite')
		await expect(commande).toBeDisabled()
		const motif = await commande.getAttribute('aria-describedby')
		expect(motif).not.toBeNull()
		await expect(page.locator(`[id="${motif}"]`)).toBeVisible()
		await bloc(page).scrollIntoViewIfNeeded()
		await capturer(page, 'activites-lectrice-1440', UNITE)
	})

	test('la lectrice retrouve sa visio là où son channel lui est rouvert, avec ses gestes d’autrice', async ({ page }) => {
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto(NORDIS)
		const visio = lignes(page).filter({ hasText: "Démonstration de l'assistant" })
		await expect(visio).toContainText('Visio')
		await expect(visio).toContainText('45 min')
		await expect(visio.getByTestId('actions-activite').getByRole('button')).toHaveText(['Corriger', 'Retirer'])
		await expect(bloc(page).getByTestId('consigner-activite')).toBeEnabled()
	})
})

test.describe('les paliers (docs/DESIGN_SYSTEM.md §7)', () => {
	for (const palier of PALIERS) {
		test(`aucun défilement horizontal, bloc et formulaire ouverts — ${palier.nom}`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, BIZDEV)
			await page.goto(SOGEXIA.adresse)
			await expect(lignes(page)).toHaveCount(3)
			await bloc(page).scrollIntoViewIfNeeded()
			await capturer(page, `activites-${palier.nom}`, UNITE)
			await bloc(page).getByTestId('consigner-activite').click()
			await expect(bloc(page).getByTestId('formulaire-activite')).toBeVisible()
			await bloc(page).getByTestId('formulaire-activite').scrollIntoViewIfNeeded()
			await capturer(page, `activites-formulaire-${palier.nom}`, UNITE)
			const debord = await page.evaluate(() => ({
				page: document.documentElement.scrollWidth - window.innerWidth,
				bloc: (() => {
					const cadre = document.querySelector('[data-testid="bloc-activites-card"]')?.getBoundingClientRect()
					return cadre === undefined ? Number.NaN : cadre.right - window.innerWidth
				})(),
			}))
			expect(debord.page).toBeLessThanOrEqual(0)
			expect(debord.bloc).toBeLessThanOrEqual(0)
		})
	}
})
