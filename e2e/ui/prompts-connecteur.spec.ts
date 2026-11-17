// @verifies CRM-149 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Prompts du connecteur sur la vraie pile — l'entrée de
//           l'index, les cinq défauts dans l'ordre du titre, l'ajout à la souris (constaté en base, auteur compris), un
//           identifiant pris refusé sous les champs, la modification et la suppression confirmée au clavier, `Échap` qui
//           renonce, la lectrice qui lit avec les commandes éteintes et leur motif, et les quatre paliers
// @verifies docs/SPEC-mcp.md §17.3, §17.4, §17.7 ; docs/DESIGN_SYSTEM.md §5.104, §5.59 ; CLAUDE.md §10 (le refus vient de
//           la base), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les gestes écrivent : les prompts de la preuve portent l'identifiant `zz-149-…` et sont retirés à la fin par la clé de
// service. Aucun prompt par défaut n'est modifié.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-149'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CHEMIN = '/reglages/prompts-connecteur'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
/** Les cinq défauts (docs/SPEC-mcp.md §17.4), dans l'ordre de leur titre. */
const DEFAUTS = ['creer-une-affaire', 'enregistrer-une-recette-reelle', 'faire-avancer', 'faire-le-point', 'retrouver-une-affaire']

async function lire<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as T
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`mcp_prompts?key=like.zz-149-*`), { headers: enTetesService() })
})

test.describe('Réglages ▸ Prompts du connecteur (docs/DESIGN_SYSTEM.md §5.104)', () => {
	test('l’administratrice lit les défauts, ajoute un prompt à la souris, et voit un identifiant pris refusé', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/reglages')
		const entree = page.getByTestId('entree-prompts-connecteur')
		await expect(entree).toHaveAttribute('href', CHEMIN)
		await entree.click()
		await expect(page.getByRole('heading', { level: 1, name: 'Prompts du connecteur' })).toBeVisible()
		const lignes = page.getByTestId('ligne-prompt')
		await expect(lignes.first()).toBeVisible()
		const cles = await lignes.evaluateAll((noeuds) => noeuds.map((n) => n.getAttribute('data-prompt')))
		expect(cles.filter((c) => DEFAUTS.includes(c ?? ''))).toEqual(DEFAUTS)
		await expect(lignes.filter({ hasText: 'faire-le-point' }).getByTestId('description-prompt')).toContainText('Résume une affaire')
		await capturer(page, 'prompts-reglages-1440', UNITE)

		await page.getByTestId('nouveau-prompt').click()
		const fiche = page.getByTestId('fiche-prompt')
		await expect(fiche.getByTestId('prompt-titre')).toBeFocused()
		await fiche.getByTestId('prompt-titre').fill('Préparer une relance')
		await fiche.getByTestId('prompt-cle').fill('zz-149-relance')
		await fiche.getByTestId('prompt-description').fill('Prépare un mail de relance pour une affaire sans réponse.')
		await fiche
			.getByTestId('prompt-texte')
			.fill('Je veux relancer une affaire.\n1. Retrouve-la avec crm_search.\n2. Lis ses mails avec crm_card_mail_list.')
		await capturer(page, 'prompts-fiche-1440', UNITE)
		await fiche.getByTestId('prompt-enregistrer').click()
		await expect(fiche).toHaveCount(0)
		await expect(page.getByTestId('annonce-prompts')).toHaveText('Prompt « Préparer une relance » enregistré.')
		await expect(lignes.filter({ hasText: 'zz-149-relance' })).toContainText('Préparer une relance')
		const [cree] = await lire<{ title: string; body: string; created_by: string }[]>(
			request,
			`mcp_prompts?workspace_id=eq.${ESPACE}&key=eq.zz-149-relance&select=title,body,created_by`,
		)
		expect(cree).toEqual({
			title: 'Préparer une relance',
			body: 'Je veux relancer une affaire.\n1. Retrouve-la avec crm_search.\n2. Lis ses mails avec crm_card_mail_list.',
			created_by: '5eed0000-0000-4000-8000-000000000011',
		})

		// Un identifiant pris : la base refuse (`23505`), l'écran le dit sous les champs et garde la saisie.
		await page.getByTestId('nouveau-prompt').click()
		await fiche.getByTestId('prompt-titre').fill('Doublon')
		await fiche.getByTestId('prompt-cle').fill('faire-le-point')
		await fiche.getByTestId('prompt-description').fill('Doublon.')
		await fiche.getByTestId('prompt-texte').fill('Doublon.')
		await fiche.getByTestId('prompt-enregistrer').click()
		await expect(fiche.getByTestId('refus-prompt')).toHaveText('Un prompt de cet espace porte déjà cet identifiant.')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		await expect(fiche.getByTestId('prompt-cle')).toHaveValue('faire-le-point')
		await capturer(page, 'prompts-fiche-refus-1440', UNITE)
		await fiche.getByTestId('prompt-annuler').click()
		await expect(fiche).toHaveCount(0)
	})

	test('au clavier : modifier, supprimer avec confirmation, Échap qui renonce, puis confirmer', async ({ page, request }) => {
		const creation = await request.post(rest('mcp_prompts'), {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: { workspace_id: ESPACE, key: 'zz-149-clavier', title: 'Prompt au clavier', description: 'Avant.', body: 'Texte.' },
		})
		expect(creation.status(), await creation.text()).toBe(201)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(CHEMIN)
		const ligne = page.getByTestId('ligne-prompt').filter({ hasText: 'zz-149-clavier' })

		const modifier = ligne.getByRole('button', { name: 'Modifier le prompt Prompt au clavier' })
		await modifier.focus()
		await page.keyboard.press('Enter')
		const fiche = page.getByTestId('fiche-prompt')
		await expect(fiche.getByTestId('prompt-titre')).toBeFocused()
		await page.keyboard.press('Tab')
		await expect(fiche.getByTestId('prompt-cle')).toBeFocused()
		await page.keyboard.press('Tab')
		await expect(fiche.getByTestId('prompt-description')).toBeFocused()
		await page.keyboard.press('ControlOrMeta+a')
		await page.keyboard.type('Après.')
		await page.keyboard.press('Tab')
		await expect(fiche.getByTestId('prompt-texte')).toBeFocused()
		await page.keyboard.press('End')
		await page.keyboard.type(' Ajouté au clavier.')
		await fiche.getByTestId('prompt-enregistrer').focus()
		await page.keyboard.press('Enter')
		await expect(fiche).toHaveCount(0)
		await expect(modifier).toBeFocused()
		const [modifie] = await lire<{ description: string; body: string; updated_by: string }[]>(
			request,
			`mcp_prompts?key=eq.zz-149-clavier&select=description,body,updated_by`,
		)
		expect(modifie).toEqual({ description: 'Après.', body: 'Texte. Ajouté au clavier.', updated_by: '5eed0000-0000-4000-8000-000000000011' })

		const supprimer = ligne.getByRole('button', { name: 'Supprimer le prompt Prompt au clavier' })
		await supprimer.focus()
		await page.keyboard.press('Enter')
		const confirmation = ligne.getByTestId('confirmation-archivage')
		await expect(confirmation).toContainText('Il ne se restaure pas.')
		await expect(confirmation.getByRole('button', { name: 'Supprimer' })).toBeFocused()
		await capturer(page, 'prompts-suppression-confirmation-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(confirmation).toHaveCount(0)
		await expect(supprimer).toBeFocused()
		await page.keyboard.press('Enter')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('annonce-prompts')).toHaveText('Prompt « Prompt au clavier » supprimé.')
		await expect(ligne).toHaveCount(0)
		await expect(page.getByTestId('nouveau-prompt')).toBeFocused()
		expect(await lire<unknown[]>(request, 'mcp_prompts?key=eq.zz-149-clavier&select=id')).toEqual([])
	})

	test('la lectrice lit la liste ; ses commandes sont éteintes avec le motif', async ({ page }) => {
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto('/reglages')
		await expect(page.getByTestId('entree-prompts-connecteur')).toHaveAttribute('href', CHEMIN)
		await page.goto(CHEMIN)
		await expect(page.getByTestId('ligne-prompt').filter({ hasText: 'faire-le-point' })).toBeVisible()
		await expect(page.getByTestId('motif-lecture-seule')).toBeVisible()
		await expect(page.getByTestId('nouveau-prompt')).toBeDisabled()
		await expect(page.getByRole('button', { name: 'Modifier le prompt Faire le point sur une affaire' })).toBeDisabled()
		await expect(page.getByRole('button', { name: 'Supprimer le prompt Faire le point sur une affaire' })).toBeDisabled()
		await capturer(page, 'prompts-reglages-lecture-1440', UNITE)
	})

	test('les quatre paliers : aucun défilement horizontal, les commandes restent atteignables', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const [largeur, hauteur] of [
			[1440, 1000],
			[1024, 900],
			[768, 1000],
			[390, 900],
		] as const) {
			await page.setViewportSize({ width: largeur, height: hauteur })
			await page.goto(CHEMIN)
			await expect(page.getByTestId('ligne-prompt').first()).toBeVisible()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal de page à ${largeur} px`).toBeLessThanOrEqual(0)
			await expect(page.getByRole('button', { name: 'Supprimer le prompt Faire le point sur une affaire' })).toBeVisible()
			if (largeur !== 1440) await capturer(page, `prompts-reglages-${largeur}`, UNITE)
		}
		await page.getByRole('button', { name: 'Modifier le prompt Créer une affaire complète' }).click()
		await expect(page.getByTestId('fiche-prompt')).toBeVisible()
		await capturer(page, 'prompts-fiche-390', UNITE)
	})
})
