// @verifies CRM-153 (docs/BACKLOG.md) — tranche T4 : la liste des organisations sur la vraie pile — les catégories sous le
//           nom (trois au plus, puis « +n »), le filtre « Catégories » au clavier (cocher filtre aussitôt, l'adresse
//           `categories=`, l'archivée qui filtre encore, `Échap`), l'adresse rechargée, et le tableau qui tient dans son cadre
//           de 900 à 1440 px — 1280 compris (décision 940) —, aux quatre paliers
// @verifies docs/SPEC-organisations.md §9.1, §9.3 ; docs/DESIGN_SYSTEM.md §5.107, §5.105, §7, §12.6 ; décision 942 ;
//           CLAUDE.md §16 (captures)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// La preuve pose ses catégories, préfixées `ZZ 153`, sur deux organisations du seed, et les retire à la fin par la clé de
// service — la suppression emporte leurs poses. Aucune donnée du seed n'est modifiée.

import type { APIRequestContext } from '@playwright/test'
import { URL_API, enTetesService } from '../api/jetons'
import { capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-153'
const PREFIXE = 'ZZ 153'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const SOGEXIA = '5eed0000-0000-4000-8000-000000000081'
const MEUNIER = '5eed0000-0000-4000-8000-000000000082'
const LISTE = '/contacts/organisations'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const JSON_SERVICE = () => ({ ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' })

async function poserCategorie(requete: APIRequestContext, nom: string, couleur: string): Promise<string> {
	const reponse = await requete.post(rest('organization_categories'), {
		headers: JSON_SERVICE(),
		data: { workspace_id: ESPACE, name: nom, color: couleur },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { id: string }[])[0]!.id
}

async function lier(requete: APIRequestContext, organisation: string, categorie: string): Promise<void> {
	const reponse = await requete.post(rest('organization_category_links'), {
		headers: JSON_SERVICE(),
		data: { organization_id: organisation, category_id: categorie },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
}

/** Quatre catégories actives sur Sogexia, dont une archivée ensuite ; une sur Studio Meunier. */
async function semer(requete: APIRequestContext): Promise<{ client: string; ancien: string }> {
	const client = await poserCategorie(requete, `${PREFIXE} Client`, 'brand')
	const fournisseur = await poserCategorie(requete, `${PREFIXE} Fournisseur`, 'accent')
	const partenaire = await poserCategorie(requete, `${PREFIXE} Partenaire`, 'success')
	const ancien = await poserCategorie(requete, `${PREFIXE} Ancien client`, 'neutral')
	for (const categorie of [client, fournisseur, partenaire, ancien]) await lier(requete, SOGEXIA, categorie)
	await lier(requete, MEUNIER, client)
	const archivage = await requete.patch(rest(`organization_categories?id=eq.${ancien}`), {
		headers: JSON_SERVICE(),
		data: { archived_at: new Date().toISOString() },
	})
	expect(archivage.status(), await archivage.text()).toBe(200)
	return { client, ancien }
}

test.use({ viewport: { width: 1440, height: 1000 } })

test.afterEach(async ({ request }) => {
	const reponse = await request.delete(rest(`organization_categories?name=like.${encodeURIComponent(`${PREFIXE}*`)}`), {
		headers: enTetesService(),
	})
	expect(reponse.status(), await reponse.text()).toBeLessThan(300)
})

test.describe('Les catégories dans la liste des organisations (docs/DESIGN_SYSTEM.md §5.107)', () => {
	test('sous le nom, trois pilules puis « +1 » ; au clavier, le filtre ne garde que les organisations qui portent la catégorie', async ({
		page,
		request,
	}) => {
		const { client, ancien } = await semer(request)
		await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
		await page.goto(LISTE)
		const sogexia = page.getByTestId('ligne-organisation').filter({ hasText: 'Sogexia' })
		const sousNom = sogexia.getByTestId('categories-sous-nom')
		// L'ordre du catalogue : actives par nom, puis l'archivée — masquée derrière « +1 ».
		await expect(sousNom.getByTestId('pastille-etiquette')).toHaveText([`${PREFIXE} Client`, `${PREFIXE} Fournisseur`, `${PREFIXE} Partenaire`])
		await expect(sousNom.getByTestId('pastille-etiquettes-reste')).toHaveAttribute('aria-label', `Une autre catégorie : ${PREFIXE} Ancien client`)
		await capturer(page, 'liste-categories-sous-nom-1440', UNITE)

		const bouton = page.getByTestId('ouvrir-filtre-categories')
		await bouton.focus()
		await page.keyboard.press('Enter')
		const panneau = page.getByTestId('panneau-filtre-categories')
		const caseClient = panneau.getByRole('checkbox', { name: `${PREFIXE} Client` })
		await caseClient.focus()
		await page.keyboard.press('Space')
		await expect(bouton).toHaveText('Catégories (1)')
		await expect(page).toHaveURL(new RegExp(`categories=${client}`))
		await expect(page.getByTestId('ligne-organisation')).toHaveCount(2)
		await expect(page.getByTestId('ligne-organisation').getByTestId('lien-fiche-organisation')).toHaveText(['Sogexia', 'Studio Meunier'])
		await capturer(page, 'liste-filtre-categories-1440', UNITE)
		await page.keyboard.press('Escape')
		await expect(panneau).toHaveCount(0)
		await expect(bouton).toBeFocused()

		// L'archivée filtre encore : on retrouve les organisations d'une catégorie qu'on vient d'archiver (§9.1).
		await page.goto(`${LISTE}?categories=${ancien}`)
		await expect(page.getByTestId('ligne-organisation').getByTestId('lien-fiche-organisation')).toHaveText(['Sogexia'])
		await page.getByTestId('ouvrir-filtre-categories').click()
		await expect(page.getByTestId('panneau-filtre-categories').getByRole('checkbox', { name: `${PREFIXE} Ancien client (archivée)` })).toBeChecked()
	})

	test('les paliers, et 1280 px : le tableau tient dans son cadre de 900 à 1440 px ; à 390 px, le cadre défile, jamais la page', async ({
		page,
		request,
	}) => {
		await semer(request)
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const [largeur, hauteur] of [
			[1440, 1000],
			[1280, 720],
			[1024, 900],
			[900, 900],
			[390, 900],
		] as const) {
			await page.setViewportSize({ width: largeur, height: hauteur })
			await page.goto(LISTE)
			await expect(page.getByTestId('ligne-organisation').filter({ hasText: 'Sogexia' }).getByTestId('categories-sous-nom')).toBeVisible()
			const deborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(deborde, `la page ne défile pas de côté à ${largeur} px`).toBeLessThanOrEqual(0)
			const { cadre, tableau } = await page.getByTestId('tableau-organisations').evaluate((t) => ({
				cadre: (t.parentElement as HTMLElement).clientWidth,
				tableau: t.scrollWidth,
			}))
			if (largeur >= 900) expect(tableau, `le tableau tient dans son cadre à ${largeur} px`).toBeLessThanOrEqual(cadre)
			else expect(tableau, 'à 390 px, le cadre défile').toBeGreaterThan(cadre)
			await capturer(page, `liste-categories-${largeur}`, UNITE)
		}
	})
})
