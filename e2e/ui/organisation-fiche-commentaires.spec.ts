// @verifies CRM-153 (docs/BACKLOG.md) — tranche T3 : la fiche d'une organisation sur la vraie pile — la ligne « Catégories »,
//           son panneau au clavier (poser, retirer une archivée, `Échap`) ; le fil de commentaires — publier en mentionnant
//           à la souris, la notification qui nomme l'organisation et mène au commentaire, la correction par l'auteur, la
//           modération par l'administratrice ; la lectrice qui lit, commandes éteintes avec le motif ; les quatre paliers
// @verifies docs/SPEC-organisations.md §9.1 à §9.3 ; docs/DESIGN_SYSTEM.md §5.107, §5.10, §5.44, §5.43, §5.59, §5.73 ;
//           CLAUDE.md §10 (le refus vient de la base), §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// La preuve vise Studio Meunier, que le seed ne garnit d'aucun commentaire ni d'aucune catégorie. Elle pose ses catégories,
// préfixées `ZZ 153`, et ses commentaires, puis les retire à la fin par la clé de service — commentaires, mentions et
// notifications qu'ils ont produites compris. Aucune donnée du seed n'est modifiée.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-153'
const PREFIXE = 'ZZ 153'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const MEUNIER = '5eed0000-0000-4000-8000-000000000082'
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const FICHE = `/contacts/organisations/${MEUNIER}`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const JSON_SERVICE = () => ({ ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' })

async function lire<T>(requete: APIRequestContext, chemin: string): Promise<T> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), await reponse.text()).toBe(200)
	return (await reponse.json()) as T
}

async function poserCategorie(requete: APIRequestContext, nom: string, couleur: string): Promise<string> {
	const reponse = await requete.post(rest('organization_categories'), {
		headers: JSON_SERVICE(),
		data: { workspace_id: ESPACE, name: nom, color: couleur },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	const commentaires = await lire<{ id: string }[]>(request, `organization_comments?organization_id=eq.${MEUNIER}&select=id`)
	if (commentaires.length > 0) {
		const ids = commentaires.map((c) => c.id).join(',')
		await request.delete(rest(`notifications?payload->>comment_id=in.(${ids})`), { headers: enTetesService() })
		await request.delete(rest(`organization_comments?organization_id=eq.${MEUNIER}`), { headers: enTetesService() })
	}
	const reponse = await request.delete(rest(`organization_categories?name=like.${encodeURIComponent(`${PREFIXE}*`)}`), {
		headers: enTetesService(),
	})
	expect(reponse.status(), await reponse.text()).toBeLessThan(300)
})

test.describe('La fiche d’une organisation : catégories et commentaires (docs/DESIGN_SYSTEM.md §5.107)', () => {
	test('au clavier, le business developer pose une catégorie et retire une archivée ; Échap rend le focus', async ({ page, request }) => {
		await poserCategorie(request, `${PREFIXE} Client`, 'brand')
		const ancien = await poserCategorie(request, `${PREFIXE} Ancien client`, 'neutral')
		// Posée avant son archivage : une archivée ne se pose plus, mais reste sur qui la porte (§9.1).
		const pose = await request.post(rest('organization_category_links'), {
			headers: JSON_SERVICE(),
			data: { organization_id: MEUNIER, category_id: ancien },
		})
		expect(pose.status(), await pose.text()).toBe(201)
		const archivage = await request.patch(rest(`organization_categories?id=eq.${ancien}`), {
			headers: JSON_SERVICE(),
			data: { archived_at: new Date().toISOString() },
		})
		expect(archivage.status(), await archivage.text()).toBe(200)

		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(FICHE)
		const ligne = page.getByTestId('categories-organisation')
		await expect(ligne.getByTestId('pilules-categories-organisation').getByTestId('pastille-etiquette')).toHaveText([
			`${PREFIXE} Ancien client`,
		])
		await expect(ligne.getByRole('img', { name: `${PREFIXE} Ancien client, catégorie archivée` })).toBeVisible()

		const commande = page.getByTestId('commande-categories-organisation')
		await commande.focus()
		await page.keyboard.press('Enter')
		const panneau = page.getByTestId('panneau-categories-organisation')
		const caseClient = panneau.getByRole('checkbox', { name: `${PREFIXE} Client` })
		const caseAncien = panneau.getByRole('checkbox', { name: new RegExp(`${PREFIXE} Ancien client`) })
		await expect(caseAncien).toBeChecked()
		await expect(caseAncien).toBeEnabled()
		await caseClient.focus()
		await page.keyboard.press('Space')
		await expect(ligne.getByTestId('pilules-categories-organisation').getByTestId('pastille-etiquette')).toHaveText([
			`${PREFIXE} Client`,
			`${PREFIXE} Ancien client`,
		])
		await caseAncien.focus()
		await page.keyboard.press('Space')
		await expect(caseAncien).toHaveCount(0)
		await capturer(page, 'fiche-categories-panneau-1440', UNITE)
		const poses = await lire<{ category_id: string; created_by: string }[]>(
			request,
			`organization_category_links?organization_id=eq.${MEUNIER}&select=category_id,created_by`,
		)
		expect(poses).toHaveLength(1)
		expect(poses[0]!.created_by).toBe(DRISS)
		await page.keyboard.press('Escape')
		await expect(panneau).toHaveCount(0)
		await expect(commande).toBeFocused()
	})

	test('Driss commente en mentionnant Camille ; Camille suit la notification, modère ; Driss corrige le sien', async ({ browser, page, request }) => {
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(FICHE)
		const bloc = page.getByTestId('commentaires-organisation')
		await expect(bloc.getByTestId('commentaires-organisation-vide')).toBeVisible()
		await bloc.getByTestId('composeur-commentaire-organisation').fill('Studio Meunier rappelle jeudi pour le devis.')
		await bloc.getByRole('button', { name: 'Mentionner' }).click()
		await bloc.getByRole('checkbox', { name: 'Camille Aubert' }).check()
		await expect(bloc.getByRole('checkbox', { name: 'Driss Lemoine' })).toHaveCount(0)
		await capturer(page, 'fiche-commentaires-composeur-1440', UNITE)
		await bloc.getByTestId('publier-commentaire-organisation').click()
		await expect(bloc.getByTestId('commentaire')).toHaveCount(1)
		await expect(bloc.getByTestId('composeur-commentaire-organisation')).toHaveValue('')
		await expect(bloc.getByTestId('composeur-commentaire-organisation')).toBeFocused()
		await bloc.getByTestId('composeur-commentaire-organisation').fill('Et le devis est parti.')
		await bloc.getByTestId('publier-commentaire-organisation').click()
		await expect(bloc.getByTestId('commentaire')).toHaveCount(2)
		const [premier] = await lire<{ id: string; author_id: string; workspace_id: string }[]>(
			request,
			`organization_comments?organization_id=eq.${MEUNIER}&select=id,author_id,workspace_id&order=created_at`,
		)
		expect(premier).toMatchObject({ author_id: DRISS, workspace_id: ESPACE })
		const mentions = await lire<{ profile_id: string }[]>(request, `organization_comment_mentions?comment_id=eq.${premier!.id}&select=profile_id`)
		expect(mentions).toEqual([{ profile_id: CAMILLE }])

		// Driss corrige le second au clavier : « modifié » paraît.
		const second = bloc.getByTestId('commentaire').nth(1)
		await second.hover()
		await second.getByRole('button', { name: 'Modifier' }).focus()
		await page.keyboard.press('Enter')
		await page.keyboard.type(' Relance le 25.')
		await second.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(second).toContainText('Et le devis est parti. Relance le 25.')
		await expect(second).toContainText('modifié')

		// Camille reçoit la notification, qui nomme l'organisation et mène au commentaire, focalisé.
		const contexte = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
		const camille = await contexte.newPage()
		await connecterAvecLeLabs(camille, 'admin@p2enjoy.test')
		await camille.goto('/')
		await camille.getByRole('button', { name: /Notifications/ }).click()
		const ligne = camille.getByTestId('notification').filter({ hasText: 'Studio Meunier' }).first()
		await expect(ligne).toContainText('Driss Lemoine vous a mentionné à propos de Studio Meunier')
		await capturer(camille, 'notification-organisation-1440', UNITE)
		await ligne.getByTestId('notification-lien').click()
		await expect(camille).toHaveURL(new RegExp(`/contacts/organisations/${MEUNIER}#commentaire-${premier!.id}$`))
		const vise = camille.locator(`#commentaire-${premier!.id}`)
		await expect(vise).toBeFocused()

		// Camille administre : sur le commentaire de Driss, le seul geste est « Supprimer », et la pierre tombale le dit.
		await vise.hover()
		await expect(vise.getByRole('button', { name: 'Modifier' })).toHaveCount(0)
		await vise.getByRole('button', { name: 'Supprimer' }).click()
		await vise.getByTestId('confirmation-moderation').getByRole('button').first().click()
		await expect(vise).toContainText('Commentaire retiré par la modération')
		await capturer(camille, 'fiche-commentaires-moderation-1440', UNITE)
		const [retire] = await lire<{ body: string; deleted_by: string }[]>(
			request,
			`organization_comments?id=eq.${premier!.id}&select=body,deleted_by`,
		)
		expect(retire).toEqual({ body: '', deleted_by: CAMILLE })
		await contexte.close()
	})

	test('la lectrice lit le fil et les catégories ; le composeur et la commande sont éteints, avec le motif', async ({ page, request }) => {
		const publication = await request.post(rest('organization_comments'), {
			headers: JSON_SERVICE(),
			data: { organization_id: MEUNIER, workspace_id: ESPACE, author_id: DRISS, body: 'Un mot pour l’équipe.' },
		})
		expect(publication.status(), await publication.text()).toBe(201)
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await page.goto(FICHE)
		const bloc = page.getByTestId('commentaires-organisation')
		await expect(bloc.getByTestId('commentaire')).toContainText('Un mot pour l’équipe.')
		const motif = page.getByTestId('motif-lecture-seule').first()
		await expect(motif).toBeVisible()
		const idMotif = await motif.getAttribute('id')
		await expect(bloc.getByTestId('composeur-commentaire-organisation')).toBeDisabled()
		await expect(bloc.getByTestId('composeur-commentaire-organisation')).toHaveAttribute('aria-describedby', idMotif!)
		await expect(page.getByTestId('commande-categories-organisation')).toBeDisabled()
		await capturer(page, 'fiche-organisation-lecture-1440', UNITE)
	})

	test('les quatre paliers : aucun défilement horizontal, le fil et les catégories restent atteignables', async ({ page, request }) => {
		const client = await poserCategorie(request, `${PREFIXE} Client historique de longue date`, 'success')
		await request.post(rest('organization_category_links'), { headers: JSON_SERVICE(), data: { organization_id: MEUNIER, category_id: client } })
		await request.post(rest('organization_comments'), {
			headers: JSON_SERVICE(),
			data: {
				organization_id: MEUNIER,
				workspace_id: ESPACE,
				author_id: DRISS,
				body: 'Un commentaire assez long pour passer à la ligne sur un téléphone, et vérifier que la page ne défile pas de côté.',
			},
		})
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const [largeur, hauteur] of [
			[1440, 1000],
			[1024, 900],
			[768, 1000],
			[390, 900],
		] as const) {
			await page.setViewportSize({ width: largeur, height: hauteur })
			await page.goto(FICHE)
			await expect(page.getByTestId('commentaire')).toHaveCount(1)
			await expect(page.getByTestId('pilules-categories-organisation').getByTestId('pastille-etiquette')).toHaveCount(1)
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal de page à ${largeur} px`).toBeLessThanOrEqual(0)
			await page.getByTestId('commentaires-organisation').scrollIntoViewIfNeeded()
			await capturer(page, `fiche-organisation-${largeur}`, UNITE)
		}
	})
})
