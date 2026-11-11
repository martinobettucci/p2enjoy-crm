// @verifies CRM-141 (docs/BACKLOG.md) — tranche T3 : Réglages ▸ Pastilles des mails sur la vraie pile — l'entrée de
//           l'index, la liste semée et ses descriptifs, la création à la souris, la modification et l'archivage confirmé au
//           clavier, le désarchivage, le nom pris par une archivée, le business developer qui lit avec les commandes
//           éteintes, et les quatre paliers
// @verifies docs/SPEC-mail-subsystem.md §31.3, §31.7 ; docs/DESIGN_SYSTEM.md §5.103, §5.29 bis, §5.59 ; docs/SPEC-seed.md
//           §46 (les neuf défauts, Newsletter archivée) ; CLAUDE.md §10 (le refus vient de la base), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Les gestes écrivent : les pastilles de la preuve portent le préfixe `ZZ 141` et sont retirées à la fin par la clé de
// service. Aucune pastille du seed n'est modifiée.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-141'
const PREFIXE = 'ZZ 141'
const CHEMIN = '/reglages/pastilles-mails'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const ACTIVES_SEMEES = [
	'Administratif',
	'Devis / commande',
	'Facture / paiement',
	'Lead',
	'Partenariat',
	'Recrutement',
	'Spam',
	'Support client',
]

async function lire<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as T
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`mail_labels?name=like.${encodeURIComponent(`${PREFIXE}*`)}`), { headers: enTetesService() })
})

test.describe('Réglages ▸ Pastilles des mails (docs/DESIGN_SYSTEM.md §5.103)', () => {
	test('l’administratrice lit la liste semée, crée une pastille à la souris, et voit un nom d’archivée refusé', async ({ page, request }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/reglages')
		const entree = page.getByTestId('entree-pastilles-mail')
		await expect(entree).toHaveAttribute('href', CHEMIN)
		await entree.click()
		const ecran = page.getByTestId('reglages-pastilles-mail')
		await expect(page.getByRole('heading', { level: 1, name: 'Pastilles des mails' })).toBeVisible()
		const lignes = ecran.getByTestId('ligne-pastille-mail')
		await expect(lignes.getByTestId('pastille-etiquette')).toHaveText(ACTIVES_SEMEES)
		await expect(lignes.filter({ hasText: 'Spam' }).getByTestId('descriptif-pastille-mail')).not.toBeEmpty()
		await capturer(page, 'pastilles-reglages-1440', UNITE)

		await page.getByTestId('nouvelle-pastille').click()
		const fiche = page.getByTestId('fiche-pastille-mail')
		await expect(fiche.getByTestId('pastille-nom')).toBeFocused()
		await fiche.getByTestId('pastille-nom').fill(`${PREFIXE} Youtube`)
		await fiche.getByRole('radio', { name: 'Rouge' }).check()
		await fiche.getByTestId('pastille-descriptif').fill('Toute demande qui concerne la chaîne Youtube de l’agence.')
		await capturer(page, 'pastilles-fiche-1440', UNITE)
		await fiche.getByTestId('pastille-enregistrer').click()
		await expect(fiche).toHaveCount(0)
		await expect(page.getByTestId('annonce-pastilles')).toHaveText(`Pastille « ${PREFIXE} Youtube » enregistrée.`)
		const [creee] = await lire<{ color: string; description: string; created_by: string }[]>(
			request,
			`mail_labels?name=eq.${encodeURIComponent(`${PREFIXE} Youtube`)}&select=color,description,created_by`,
		)
		expect(creee).toEqual({
			color: 'danger',
			description: 'Toute demande qui concerne la chaîne Youtube de l’agence.',
			created_by: '5eed0000-0000-4000-8000-000000000011',
		})

		// « Newsletter » est archivée par le seed : son nom reste pris, et le refus dit où la trouver.
		await page.getByTestId('nouvelle-pastille').click()
		await fiche.getByTestId('pastille-nom').fill('newsletter')
		await fiche.getByTestId('pastille-descriptif').fill('Doublon.')
		await fiche.getByTestId('pastille-enregistrer').click()
		await expect(fiche.getByTestId('refus-pastille-mail')).toContainText('Afficher les archivées')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		await expect(fiche.getByTestId('pastille-nom')).toHaveValue('newsletter')
		await capturer(page, 'pastilles-fiche-refus-1440', UNITE)
		await fiche.getByTestId('pastille-annuler').click()
		await expect(fiche).toHaveCount(0)
	})

	test('au clavier : modifier, archiver avec confirmation, Échap qui renonce, puis désarchiver', async ({ page, request }) => {
		const creation = await request.post(rest('mail_labels'), {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: {
				workspace_id: '5eed0000-0000-4000-8000-000000000001',
				name: `${PREFIXE} Presse`,
				color: 'brand',
				description: 'Les journalistes qui écrivent à l’agence.',
			},
		})
		expect(creation.status(), await creation.text()).toBe(201)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(CHEMIN)
		const ligne = page.getByTestId('ligne-pastille-mail').filter({ hasText: `${PREFIXE} Presse` })

		await ligne.getByRole('button', { name: `Modifier la pastille ${PREFIXE} Presse` }).focus()
		await page.keyboard.press('Enter')
		const fiche = page.getByTestId('fiche-pastille-mail')
		await expect(fiche.getByTestId('pastille-nom')).toBeFocused()
		await page.keyboard.press('Tab')
		// Le sélecteur de couleur est un groupe de radios : les flèches changent la couleur.
		await page.keyboard.press('ArrowRight')
		await fiche.getByTestId('pastille-descriptif').focus()
		await page.keyboard.press('End')
		await page.keyboard.type(' Et les blogs.')
		await fiche.getByTestId('pastille-enregistrer').focus()
		await page.keyboard.press('Enter')
		await expect(fiche).toHaveCount(0)
		const [modifiee] = await lire<{ color: string; description: string }[]>(
			request,
			`mail_labels?name=eq.${encodeURIComponent(`${PREFIXE} Presse`)}&select=color,description`,
		)
		expect(modifiee!.description).toBe('Les journalistes qui écrivent à l’agence. Et les blogs.')
		expect(modifiee!.color).not.toBe('brand')

		const archiver = ligne.getByRole('button', { name: `Archiver la pastille ${PREFIXE} Presse` })
		await archiver.focus()
		await page.keyboard.press('Enter')
		const confirmation = ligne.getByTestId('confirmation-archivage')
		await expect(confirmation).toContainText('Les mails qui la portent la garderont')
		await capturer(page, 'pastilles-archivage-confirmation-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(confirmation).toHaveCount(0)
		await expect(archiver).toBeFocused()
		await page.keyboard.press('Enter')
		await ligne.getByTestId('confirmation-archivage').getByRole('button', { name: 'Archiver' }).click()
		await expect(page.getByTestId('annonce-pastilles')).toHaveText(`Pastille « ${PREFIXE} Presse » archivée.`)
		await expect(ligne).toHaveCount(0)

		await page.getByLabel('Afficher les archivées').check()
		const archivee = page.getByTestId('ligne-pastille-mail').filter({ hasText: `${PREFIXE} Presse` })
		await expect(archivee).toContainText('Archivée')
		await expect(page.getByTestId('ligne-pastille-mail').filter({ hasText: 'Newsletter' })).toContainText('Archivée')
		await archivee.scrollIntoViewIfNeeded()
		await capturer(page, 'pastilles-archivees-1440', UNITE)
		await archivee.getByRole('button', { name: `Désarchiver la pastille ${PREFIXE} Presse` }).click()
		await expect(page.getByTestId('annonce-pastilles')).toHaveText(`Pastille « ${PREFIXE} Presse » désarchivée.`)
		const [rendue] = await lire<{ archived_at: string | null }[]>(
			request,
			`mail_labels?name=eq.${encodeURIComponent(`${PREFIXE} Presse`)}&select=archived_at`,
		)
		expect(rendue!.archived_at).toBeNull()
	})

	test('le business developer lit la liste ; ses commandes sont éteintes avec le motif', async ({ page }) => {
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto('/reglages')
		await expect(page.getByTestId('entree-pastilles-mail')).toHaveAttribute('href', CHEMIN)
		await page.goto(CHEMIN)
		await expect(page.getByTestId('ligne-pastille-mail').getByTestId('pastille-etiquette')).toHaveText(ACTIVES_SEMEES)
		const motif = page.getByTestId('motif-lecture-seule')
		await expect(motif).toBeVisible()
		await expect(page.getByTestId('nouvelle-pastille')).toBeDisabled()
		await expect(page.getByRole('button', { name: 'Modifier la pastille Spam' })).toBeDisabled()
		await expect(page.getByRole('button', { name: 'Archiver la pastille Spam' })).toBeDisabled()
		await capturer(page, 'pastilles-reglages-lecture-1440', UNITE)
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
			await expect(page.getByTestId('ligne-pastille-mail').first()).toBeVisible()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal de page à ${largeur} px`).toBeLessThanOrEqual(0)
			await expect(page.getByRole('button', { name: 'Archiver la pastille Spam' })).toBeVisible()
			if (largeur !== 1440) await capturer(page, `pastilles-reglages-${largeur}`, UNITE)
		}
		await page.getByTestId('nouvelle-pastille').click()
		await expect(page.getByTestId('fiche-pastille-mail')).toBeVisible()
		await capturer(page, 'pastilles-fiche-390', UNITE)
	})
})
