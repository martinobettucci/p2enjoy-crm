// @verifies CRM-153 (docs/BACKLOG.md) — tranche T2 : Réglages ▸ Catégories d'organisations sur la vraie pile — l'entrée de
//           l'index, la création à la souris, le nom pris par une archivée, la modification au clavier, l'archivage et le
//           désarchivage SANS confirmation avec le focus rendu, la lectrice qui lit avec les commandes éteintes et le
//           motif, et les quatre paliers
// @verifies docs/SPEC-organisations.md §9.1, §9.3 ; docs/DESIGN_SYSTEM.md §5.107, §5.103, §5.73, §5.59, §5.29, §5.29 bis ;
//           CLAUDE.md §10 (le refus vient de la base), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// Le seed ne porte encore aucune catégorie (`CRM-153` T6) : la preuve pose les siennes, préfixées `ZZ 153`, et les retire à
// la fin par la clé de service — la suppression emporte leurs poses. Aucune donnée du seed n'est modifiée.
// *Révisé le 2026-11-21 (`CRM-161` T2.a, docs/SPEC-espace-courant.md §15.5, décision 51)* : les pages d'un espace sont sous
// le slug de l'espace (`/p2enjoy/…`) ; les adresses et leurs attentes suivent, sans changer ce que la preuve prouve.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { ERREUR_RESSOURCE_HTTP, autoriserErreursConsole, connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-153'
const PREFIXE = 'ZZ 153'
const CHEMIN = '/p2enjoy/reglages/categories-organisations'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lire<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as T
}

/** Pose une catégorie par la clé de service ; `archivee` la naît archivée (la base pose l'heure). */
async function poser(requete: APIRequestContext, nom: string, couleur: string, archivee = false): Promise<void> {
	const reponse = await requete.post(rest('organization_categories'), {
		headers: { ...enTetesService(), 'Content-Type': 'application/json' },
		data: { workspace_id: ESPACE, name: nom, color: couleur, ...(archivee ? { archived_at: new Date().toISOString() } : {}) },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	const reponse = await request.delete(rest(`organization_categories?name=like.${encodeURIComponent(`${PREFIXE}*`)}`), {
		headers: enTetesService(),
	})
	expect(reponse.status(), await reponse.text()).toBeLessThan(300)
})

test.describe('Réglages ▸ Catégories d’organisations (docs/DESIGN_SYSTEM.md §5.107)', () => {
	test('l’administratrice ouvre l’écran depuis l’index, crée une catégorie à la souris, et voit un nom d’archivée refusé', async ({
		page,
		request,
	}) => {
		await poser(request, `${PREFIXE} Ancien client`, 'neutral', true)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto('/p2enjoy/reglages')
		const entree = page.getByTestId('entree-categories-organisations')
		await expect(entree).toHaveAttribute('href', CHEMIN)
		await entree.click()
		await expect(page.getByRole('heading', { level: 1, name: "Catégories d'organisations" })).toBeVisible()
		const ecran = page.getByTestId('reglages-categories-organisations')

		await page.getByTestId('nouvelle-categorie').click()
		const fiche = page.getByTestId('fiche-categorie-organisation')
		await expect(fiche.getByTestId('categorie-nom')).toBeFocused()
		await fiche.getByTestId('categorie-nom').fill(`  ${PREFIXE} Partenaire `)
		await fiche.getByRole('radio', { name: 'Vert' }).check()
		await capturer(page, 'categories-reglages-fiche-1440', UNITE)
		await fiche.getByTestId('categorie-enregistrer').click()
		await expect(fiche).toHaveCount(0)
		await expect(page.getByTestId('annonce-categories')).toHaveText(`Catégorie « ${PREFIXE} Partenaire » enregistrée.`)
		await expect(page.getByTestId('nouvelle-categorie')).toBeFocused()
		const ligne = ecran.getByTestId('ligne-categorie-organisation').filter({ hasText: `${PREFIXE} Partenaire` })
		await expect(ligne.getByTestId('pastille-etiquette')).toHaveText(`${PREFIXE} Partenaire`)
		const [creee] = await lire<{ name: string; color: string; created_by: string; archived_at: string | null }[]>(
			request,
			`organization_categories?name=eq.${encodeURIComponent(`${PREFIXE} Partenaire`)}&select=name,color,created_by,archived_at`,
		)
		// Le nom est rogné, l'auteur est posé par la base : la fiche ne l'envoie pas.
		expect(creee).toEqual({ name: `${PREFIXE} Partenaire`, color: 'success', created_by: CAMILLE, archived_at: null })
		await capturer(page, 'categories-reglages-1440', UNITE)

		// Une archivée garde son nom : le refus vient de la base (23505) et nomme « Afficher les archivées ».
		await page.getByTestId('nouvelle-categorie').click()
		await fiche.getByTestId('categorie-nom').fill(`${PREFIXE} ANCIEN client`)
		await fiche.getByTestId('categorie-enregistrer').click()
		await expect(fiche.getByTestId('refus-categorie')).toContainText('« Afficher les archivées »')
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[409]])
		await expect(fiche.getByTestId('categorie-nom')).toHaveValue(`${PREFIXE} ANCIEN client`)
		await expect(fiche.getByTestId('categorie-nom')).toBeFocused()
		await capturer(page, 'categories-reglages-refus-1440', UNITE)
		await fiche.getByTestId('categorie-annuler').click()
		await expect(fiche).toHaveCount(0)
	})

	test('au clavier : modifier, archiver puis désarchiver sans confirmation, le focus toujours rendu', async ({ page, request }) => {
		await poser(request, `${PREFIXE} Client`, 'brand')
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await page.goto(CHEMIN)
		const ligne = page.getByTestId('ligne-categorie-organisation').filter({ hasText: `${PREFIXE} Client` })

		await ligne.getByRole('button', { name: `Modifier la catégorie ${PREFIXE} Client` }).focus()
		await page.keyboard.press('Enter')
		const fiche = page.getByTestId('fiche-categorie-organisation')
		await expect(fiche.getByTestId('categorie-nom')).toBeFocused()
		await page.keyboard.press('End')
		await page.keyboard.type(' grand compte')
		await page.keyboard.press('Tab')
		// Le sélecteur de couleur est un groupe de radios : la flèche passe de Bleu à Vert.
		await page.keyboard.press('ArrowRight')
		await page.keyboard.press('Tab')
		await expect(fiche.getByTestId('categorie-enregistrer')).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(fiche).toHaveCount(0)
		const modifiee = page.getByTestId('ligne-categorie-organisation').filter({ hasText: `${PREFIXE} Client grand compte` })
		const modifier = modifiee.getByRole('button', { name: `Modifier la catégorie ${PREFIXE} Client grand compte` })
		await expect(modifier).toBeFocused()
		const [ecrite] = await lire<{ color: string }[]>(
			request,
			`organization_categories?name=eq.${encodeURIComponent(`${PREFIXE} Client grand compte`)}&select=color`,
		)
		expect(ecrite!.color).toBe('success')

		// Archiver s'écrit aussitôt : aucune confirmation ; la ligne quitte la liste, le focus va à « Nouvelle catégorie ».
		await page.keyboard.press('Tab')
		await expect(modifiee.getByRole('button', { name: `Archiver la catégorie ${PREFIXE} Client grand compte` })).toBeFocused()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('confirmation-archivage')).toHaveCount(0)
		await expect(page.getByTestId('annonce-categories')).toHaveText(`Catégorie « ${PREFIXE} Client grand compte » archivée.`)
		await expect(modifiee).toHaveCount(0)
		await expect(page.getByTestId('nouvelle-categorie')).toBeFocused()

		await page.getByLabel('Afficher les archivées').check()
		const archivee = page.getByTestId('ligne-categorie-organisation').filter({ hasText: `${PREFIXE} Client grand compte` })
		await expect(archivee).toContainText('Archivée')
		await expect(archivee.getByRole('button', { name: /^Modifier/ })).toHaveCount(0)
		await capturer(page, 'categories-reglages-archivees-1440', UNITE)
		const desarchiver = archivee.getByRole('button', { name: `Désarchiver la catégorie ${PREFIXE} Client grand compte` })
		await desarchiver.focus()
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('annonce-categories')).toHaveText(
			`Catégorie « ${PREFIXE} Client grand compte » désarchivée.`,
		)
		await expect(archivee.getByRole('button', { name: `Archiver la catégorie ${PREFIXE} Client grand compte` })).toBeFocused()
		const [rendue] = await lire<{ archived_at: string | null }[]>(
			request,
			`organization_categories?name=eq.${encodeURIComponent(`${PREFIXE} Client grand compte`)}&select=archived_at`,
		)
		expect(rendue!.archived_at).toBeNull()
	})

	test('la lectrice lit l’écran depuis l’index ; ses commandes sont éteintes, avec le motif', async ({ page, request }) => {
		await poser(request, `${PREFIXE} Fournisseur`, 'accent')
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto('/p2enjoy/reglages')
		await expect(page.getByTestId('entree-categories-organisations')).toHaveAttribute('href', CHEMIN)
		await page.goto(CHEMIN)
		const ligne = page.getByTestId('ligne-categorie-organisation').filter({ hasText: `${PREFIXE} Fournisseur` })
		await expect(ligne.getByTestId('pastille-etiquette')).toHaveText(`${PREFIXE} Fournisseur`)
		const motif = page.getByTestId('motif-lecture-seule')
		await expect(motif).toBeVisible()
		const motifId = await motif.getAttribute('id')
		await expect(page.getByTestId('nouvelle-categorie')).toBeDisabled()
		await expect(page.getByTestId('nouvelle-categorie')).toHaveAttribute('aria-describedby', motifId!)
		await expect(ligne.getByRole('button', { name: `Modifier la catégorie ${PREFIXE} Fournisseur` })).toBeDisabled()
		await expect(ligne.getByRole('button', { name: `Archiver la catégorie ${PREFIXE} Fournisseur` })).toBeDisabled()
		await capturer(page, 'categories-reglages-lecture-1440', UNITE)
	})

	test('les quatre paliers : aucun défilement horizontal, les commandes restent atteignables', async ({ page, request }) => {
		await poser(request, `${PREFIXE} Partenaire technologique majeur`, 'brand')
		await poser(request, `${PREFIXE} Client`, 'success')
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const [largeur, hauteur] of [
			[1440, 1000],
			[1024, 900],
			[768, 1000],
			[390, 900],
		] as const) {
			await page.setViewportSize({ width: largeur, height: hauteur })
			await page.goto(CHEMIN)
			const longue = page.getByRole('button', { name: `Archiver la catégorie ${PREFIXE} Partenaire technologique majeur` })
			await expect(longue).toBeVisible()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal de page à ${largeur} px`).toBeLessThanOrEqual(0)
			const cadre = await longue.boundingBox()
			expect(cadre!.x + cadre!.width, `« Archiver » dans la fenêtre à ${largeur} px`).toBeLessThanOrEqual(largeur)
			// Deux lignes voisines ont la même hauteur intérieure — bordure exclue, la dernière n'en porte pas —, quelle que soit
			// la longueur du nom (§5.99, vu en capture à 390 px).
			const hauteurs = await page
				.getByTestId('ligne-categorie-organisation')
				.filter({ hasText: PREFIXE })
				.evaluateAll((lignes) => lignes.map((l) => l.clientHeight))
			expect(new Set(hauteurs).size, `lignes de même hauteur à ${largeur} px : ${hauteurs.join(', ')}`).toBe(1)
			if (largeur !== 1440) await capturer(page, `categories-reglages-${largeur}`, UNITE)
		}
		await page.getByTestId('nouvelle-categorie').click()
		await expect(page.getByTestId('fiche-categorie-organisation')).toBeVisible()
		await capturer(page, 'categories-reglages-fiche-390', UNITE)
	})
})
