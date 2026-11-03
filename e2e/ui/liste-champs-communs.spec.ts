// @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.a : les champs de l'affaire en colonnes de la vue liste, sur la pile réelle —
//           la case « Afficher dans la liste des affaires » cochée dans Réglages, relue en base ; la colonne et sa valeur dans la
//           liste ; la case refusée au type personne ; quatre paliers
// @verifies docs/SPEC-champs-communs.md §8 (précision T4.a) ; docs/DESIGN_SYSTEM.md §5.91, §7
// @verifies CLAUDE.md §15, §16 (captures observées)
//
// Le champ de sonde porte la clé `sonde-112-lc` ; sa valeur est posée sur une affaire du seed de « Grands comptes » par la clé
// de service, qui la retire ensuite avec le champ — retrait CONSTATÉ.

import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const AFFAIRE = '5eed0000-0000-4000-8000-0000000000c2'
const LISTE = '/tracks/conseil-ia/grands-comptes/liste'
const CLE = 'sonde-112-lc'
const LIBELLE = 'Budget client (sonde)'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function ranger(request: APIRequestContext): Promise<void> {
	for (const { id } of await lireService<{ id: string }>(request, `card_common_fields?select=id&key=like.${CLE}*`)) {
		await request.delete(rest(`card_common_field_values?field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `card_common_fields?select=id&key=like.${CLE}*`)).toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

/** Un champ montant posé par l'administratrice, NON listé, et sa valeur sur une affaire du seed. */
async function poser(request: APIRequestContext, liste: boolean): Promise<string> {
	const reponse = await request.post(rest('card_common_fields'), {
		headers: { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' },
		data: { workspace_id: ESPACE, key: CLE, label: LIBELLE, type: 'money', options: { currency: 'EUR' }, is_listed: liste },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [champ] = (await reponse.json()) as { id: string }[]
	const valeur = await request.post(rest('card_common_field_values'), {
		headers: enTetesService(),
		data: { card_id: AFFAIRE, field_id: champ?.id, workspace_id: ESPACE, value: 1500 },
	})
	expect(valeur.status(), await valeur.text()).toBe(201)
	return champ?.id ?? ''
}

test.describe('Les champs de l’affaire en colonnes (docs/DESIGN_SYSTEM.md §5.91)', () => {
	test.use({ viewport: { width: 1440, height: 900 } })

	test('cocher « Afficher dans la liste » dans Réglages fait paraître la colonne et sa valeur', async ({ page, request }) => {
		const id = await poser(request, false)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(LISTE)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		await expect(page.getByTestId('entete-commun')).toHaveCount(0)

		await page.goto('/reglages/champs')
		await page.locator(`[data-champ="${CLE}"]`).getByRole('button', { name: /Modifier le champ/ }).click()
		const caseListe = page.getByLabel('Afficher dans la liste des affaires')
		await expect(caseListe).not.toBeChecked()
		await caseListe.check()
		await capturer(page, 'liste-communs-case-xl-1440', UNITE)
		await page.getByRole('button', { name: 'Enregistrer' }).click()
		await expect(page.locator(`[data-champ="${CLE}"]`).getByTestId('champ-dans-la-liste')).toBeVisible()
		expect(await lireService(request, `card_common_fields?select=is_listed&id=eq.${id}`)).toEqual([{ is_listed: true }])

		await page.goto(LISTE)
		const entete = page.locator(`[data-testid="entete-commun"][data-champ="${CLE}"]`)
		await expect(entete).toHaveText(LIBELLE)
		const cellule = page.locator(`[data-testid="ligne-card"][data-card="${AFFAIRE}"] [data-testid="cellule-commune"][data-champ="${CLE}"]`)
		await expect(cellule).toHaveAttribute('title', '1 500 €')
		await cellule.scrollIntoViewIfNeeded()
		await capturer(page, 'liste-communs-colonne-xl-1440', UNITE)
	})

	test('un type personne ne s’affiche pas en colonne : la case est refusée, avec sa raison', async ({ page }) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/champs')
		await page.getByTestId('nouveau-champ-commun').click()
		await page.getByLabel('Type').selectOption('user')
		await expect(page.getByLabel('Afficher dans la liste des affaires')).toBeDisabled()
		await expect(page.getByText('Ce type de champ ne s’affiche pas en colonne.')).toBeVisible()
	})

	for (const palier of PALIERS) {
		test(`au palier ${palier.nom} : la liste défile dans son conteneur, la page jamais`, async ({ page, request }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await poser(request, true)
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(LISTE)
			await expect(page.locator(`[data-testid="entete-commun"][data-champ="${CLE}"]`)).toHaveCount(1)
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			await capturer(page, `liste-communs-${palier.nom}`, UNITE)
		})
	}
})
