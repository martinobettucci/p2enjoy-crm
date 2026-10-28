// @verifies CRM-069 (docs/BACKLOG.md) — tranche T2 : les étiquettes sur la vraie pile — Réglages ▸ Étiquettes, la carte du
//           board (trois pastilles et « +n »), la fiche et son panneau, le fil, le filtre de la vue liste, et les refus
// @verifies docs/SPEC-etiquettes-digest.md §2, §3 ; docs/DESIGN_SYSTEM.md §5.73, §5.59 ; docs/SPEC-seed.md §30 (le jeu
//           semé) ; CLAUDE.md §10 (refus par la base), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les gestes écrivent : les étiquettes de la preuve portent le préfixe `ZZ 069` et sont retirées à la fin. La pose se fait
// sur une affaire jetable du même préfixe, retirée à la fin avec son fil : le fil est en ajout seul, même pour la clé de
// service, et une pose sur une affaire du seed y laisserait ses lignes.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'
import { posterAffaire } from '../affaire'

const UNITE = 'CRM-069'
const PREFIXE = 'ZZ 069'
const REFONTE = '/tracks/studio-web/refonte'
const LYON = '5eed0000-0000-4000-8000-0000000000c4'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
// Le channel « Checklists » de Studio web, que Driss écrit, son workflow et son étape initiale (docs/SPEC-seed.md).
const CHANNEL_CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6841'
const WORKFLOW_CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6801'
const ETAPE_INITIALE = '5eed0000-0000-4000-8000-0000000c6811'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lire<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as T
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`labels?name=like.${encodeURIComponent(`${PREFIXE}*`)}`), { headers: enTetesService() })
	// L'affaire jetable : ses poses et son fil partent avec elle.
	await request.delete(rest(`cards?title=like.${encodeURIComponent(`${PREFIXE}*`)}`), { headers: enTetesService() })
})

test.describe('Réglages ▸ Étiquettes (docs/DESIGN_SYSTEM.md §5.73)', () => {
	test('l’administratrice lit le catalogue semé, pose une étiquette, voit un nom pris refusé, et l’archive', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/reglages')
		const entree = page.getByTestId('entree-etiquettes')
		await expect(entree).toHaveAttribute('href', '/reglages/etiquettes')
		await entree.click()
		const ecran = page.getByTestId('reglages-etiquettes')
		await expect(ecran.getByTestId('ligne-etiquette')).toHaveText([/Partenaire/, /Prioritaire/, /Secteur public/])
		await capturer(page, 'etiquettes-reglages-1440', UNITE)

		await page.getByTestId('nouvelle-etiquette').click()
		const fiche = page.getByTestId('fiche-etiquette')
		await expect(fiche.getByLabel('Nom')).toBeFocused()
		await fiche.getByLabel('Nom').fill(`${PREFIXE} Événementiel`)
		await fiche.getByRole('radio', { name: 'Jaune' }).check()
		await capturer(page, 'etiquettes-fiche-1440', UNITE)
		await fiche.getByTestId('etiquette-enregistrer').click()
		await expect(fiche).toHaveCount(0)
		const [posee] = await lire<{ id: string; color: string }[]>(request, `labels?name=eq.${encodeURIComponent(`${PREFIXE} Événementiel`)}&select=id,color`)
		expect(posee!.color).toBe('accent')

		// Un nom déjà pris, à la casse près : refusé par la base, la saisie gardée, le focus sur le nom.
		await page.getByRole('button', { name: `Modifier l’étiquette ${PREFIXE} Événementiel` }).click()
		await fiche.getByLabel('Nom').fill('prioritaire')
		await fiche.getByTestId('etiquette-enregistrer').click()
		await expect(fiche.getByRole('alert')).toContainText('porte déjà ce nom')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		await expect(fiche.getByLabel('Nom')).toBeFocused()
		await page.keyboard.press('Escape')

		await page.getByRole('button', { name: `Archiver l’étiquette ${PREFIXE} Événementiel` }).click()
		await expect(page.getByTestId('annonce-etiquettes')).toHaveText(`Étiquette « ${PREFIXE} Événementiel » archivée.`)
		await page.getByLabel('Afficher les archivées').check()
		await expect(ecran.getByTestId('ligne-etiquette').filter({ hasText: 'Salon 2025' })).toContainText('Archivée')

		await page.setViewportSize({ width: 390, height: 900 })
		await page.reload()
		await expect(page.getByTestId('ligne-etiquette').first()).toBeVisible()
		const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
		expect(debordement, 'aucun défilement horizontal de page à 390 px').toBeLessThanOrEqual(0)
		await capturer(page, 'etiquettes-reglages-390', UNITE)
	})
})

test.describe('les étiquettes des affaires (docs/DESIGN_SYSTEM.md §5.73)', () => {
	test('au board, la Ville de Lyon montre trois pastilles et « +1 », qui nomme la masquée', async ({ page }) => {
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(REFONTE)
		const carte = page.getByTestId('carte-card').filter({ hasText: 'Ville de Lyon' })
		await expect(carte.getByTestId('pastille-etiquette')).toHaveCount(3)
		const reste = carte.getByTestId('pastille-etiquettes-reste')
		await expect(reste).toHaveText('+1')
		await expect(reste).toHaveAttribute('aria-label', /1 autres étiquettes/)
		await carte.scrollIntoViewIfNeeded()
		await capturer(page, 'etiquettes-board-1440', UNITE)
	})

	test('le business developer pose une étiquette sur la fiche ; la base, la pastille et le fil le disent', async ({ page, request }) => {
		const creee = await posterAffaire(request, rest('cards'), {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				workspace_id: ESPACE,
				channel_id: CHANNEL_CHECKLISTS,
				workflow_id: WORKFLOW_CHECKLISTS,
				current_step_id: ETAPE_INITIALE,
				title: `${PREFIXE} Mutuelle Rhône`,
			},
		})
		expect(creee.status(), await creee.text()).toBe(201)
		const jetable = ((await creee.json()) as { id: string }[])[0]!.id
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(`/tracks/studio-web/checklists/cards/${jetable}`)
		const commande = page.getByTestId('entete-card-etiquettes')
		await commande.click()
		const panneau = page.getByTestId('entete-card-panneau-etiquettes')
		const partenaire = panneau.getByRole('checkbox', { name: 'Partenaire' })
		await expect(partenaire).toBeFocused()
		// L'archivée n'est pas proposée sur une affaire qui ne la porte pas.
		await expect(panneau.getByRole('checkbox', { name: /Salon 2025/ })).toHaveCount(0)
		// La case ne se coche qu'après la réponse de la base : un clic, puis l'état constaté.
		await partenaire.click()
		await expect(partenaire).toBeChecked()
		await expect(page.getByTestId('entete-card-etiquettes-pastilles')).toContainText('Partenaire')
		await capturer(page, 'etiquettes-fiche-panneau-1440', UNITE)
		const poses = await lire<{ created_by: string }[]>(request, `card_labels?card_id=eq.${jetable}&select=created_by`)
		expect(poses).toEqual([{ created_by: '5eed0000-0000-4000-8000-000000000012' }])
		await page.keyboard.press('Escape')
		await expect(commande).toBeFocused()
		await expect(page.getByText('Étiquette posée')).toBeVisible()
	})

	test('la vue liste filtre par « Secteur public », et l’adresse porte le filtre', async ({ page }) => {
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(`${REFONTE}/liste`)
		await page.getByLabel('Étiquette', { exact: true }).selectOption({ label: 'Secteur public' })
		await expect(page).toHaveURL(/etiquette=/)
		const lignes = page.getByTestId('ligne-card')
		await expect(lignes).toHaveCount(2)
		await expect(lignes.getByTestId('cellule-etiquettes').first()).toContainText('Secteur public')
		await capturer(page, 'etiquettes-liste-filtre-1440', UNITE)
	})

	test('la lectrice : la commande éteinte avec le motif de la fiche ; l’entrée des réglages est un texte', async ({ page }) => {
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto(`${REFONTE}/cards/${LYON}`)
		await expect(page.getByTestId('entete-card-etiquettes-pastilles').getByTestId('pastille-etiquette')).toHaveCount(4)
		await expect(page.getByTestId('entete-card-etiquettes')).toBeDisabled()
		await page.goto('/reglages')
		await expect(page.getByTestId('entree-etiquettes')).toHaveAttribute('aria-disabled', 'true')
	})
})
