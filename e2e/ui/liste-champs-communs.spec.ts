// @verifies CRM-112 (docs/BACKLOG.md) — tranche T8 : l'attente porte sur la colonne de la sonde, l'espace seedé listant ses
//           propres champs (docs/SPEC-seed.md §38)
// @verifies CRM-112 (docs/BACKLOG.md) — tranche T4.a : les champs de l'affaire en colonnes de la vue liste, sur la pile réelle —
//           la case « Afficher dans la liste des affaires » cochée dans Réglages, relue en base ; la colonne et sa valeur dans la
//           liste ; la case refusée au type personne ; quatre paliers
// @verifies docs/SPEC-champs-communs.md §8 (précision T4.a) ; docs/DESIGN_SYSTEM.md §5.91, §7
// @verifies CLAUDE.md §15, §16 (captures observées)
//
// Le champ de sonde porte la clé `sonde-112-lc` ; sa valeur est posée par la clé de service sur une affaire de sonde de
// « Grands comptes », retirée ensuite avec le champ — retrait CONSTATÉ. *Révisé par la campagne de livraison* : posée d'abord
// sur une affaire du seed, la valeur laissait au fil de celle-ci ses `field_changed` (migration 0163), que le retrait de la
// valeur n'emporte pas ; l'affaire de sonde les emporte avec elle.

import { randomUUID } from 'node:crypto'
import { connecterAvecLeLabs, expect, test, type APIRequestContext } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { posterAffaire } from '../affaire'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CHANNEL = '5eed0000-0000-4000-8000-000000000032'
const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const TITRE = 'tst-crm112-lc'
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
	for (const { id } of await lireService<{ id: string }>(request, `cards?select=id&title=like.${TITRE}*`)) {
		await request.delete(rest(`card_common_field_values?card_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`cards?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `cards?select=id&title=like.${TITRE}*`)).toEqual([])
	for (const { id } of await lireService<{ id: string }>(request, `card_common_fields?select=id&key=like.${CLE}*`)) {
		await request.delete(rest(`card_common_field_values?field_id=eq.${id}`), { headers: enTetesService() })
		await request.delete(rest(`card_common_fields?id=eq.${id}`), { headers: enTetesService() })
	}
	expect(await lireService(request, `card_common_fields?select=id&key=like.${CLE}*`)).toEqual([])
}

test.beforeEach(async ({ request }) => ranger(request))
test.afterEach(async ({ request }) => ranger(request))

/** Une affaire de sonde, un champ montant posé par l'administratrice, et sa valeur sur l'affaire. */
async function poser(request: APIRequestContext, liste: boolean): Promise<{ readonly idChamp: string; readonly idCard: string }> {
	const idCard = randomUUID()
	const creation = await posterAffaire(request, rest('cards'), {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id: idCard, workspace_id: ESPACE, channel_id: CHANNEL, workflow_id: WORKFLOW, current_step_id: PROSPECTION, title: `${TITRE} ${idCard.slice(0, 8)}` },
	})
	expect(creation.status(), await creation.text()).toBe(201)
	const reponse = await request.post(rest('card_common_fields'), {
		headers: { ...enTetesAuthentifies(await jetonDe(ADMIN)), Prefer: 'return=representation' },
		data: { workspace_id: ESPACE, key: CLE, label: LIBELLE, type: 'money', options: { currency: 'EUR' }, is_listed: liste },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	const [champ] = (await reponse.json()) as { id: string }[]
	const valeur = await request.post(rest('card_common_field_values'), {
		headers: enTetesService(),
		data: { card_id: idCard, field_id: champ?.id, workspace_id: ESPACE, value: 1500 },
	})
	expect(valeur.status(), await valeur.text()).toBe(201)
	return { idChamp: champ?.id ?? '', idCard }
}

test.describe('Les champs de l’affaire en colonnes (docs/DESIGN_SYSTEM.md §5.91)', () => {
	test.use({ viewport: { width: 1440, height: 900 } })

	test('cocher « Afficher dans la liste » dans Réglages fait paraître la colonne et sa valeur', async ({ page, request }) => {
		const { idChamp: id, idCard } = await poser(request, false)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(LISTE)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()
		// `CRM-112` T8 : le seed liste ses propres champs (SIRET, Secteur, docs/SPEC-seed.md §38) ; seule la colonne de la
		// sonde est attendue absente avant la case.
		await expect(page.locator(`[data-testid="entete-commun"][data-champ="${CLE}"]`)).toHaveCount(0)

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
		const cellule = page.locator(`[data-testid="ligne-card"][data-card="${idCard}"] [data-testid="cellule-commune"][data-champ="${CLE}"]`)
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
