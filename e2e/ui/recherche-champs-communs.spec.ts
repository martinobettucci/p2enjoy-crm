// @verifies CRM-112 (docs/BACKLOG.md) — tranche T6 : la palette trouve une affaire par un champ de l'affaire, et sa ligne
//           porte l'extrait « libellé : texte » ; la lectrice qui ne lit pas l'affaire ne la trouve pas
// @verifies docs/SPEC-champs-communs.md §10 (précision T6) ; docs/SPEC-recherche.md §6.5 ; docs/DESIGN_SYSTEM.md §5.46
//           (l'extrait : une ligne, en ellipse), §7 (les paliers) ; CLAUDE.md §16 (vérification visuelle)
//
// LE PARCOURS EST CELUI D'UN UTILISATEUR : connexion par la vraie page du SSO, raccourci, frappe. Le champ et sa valeur
// sont posés par la clé de service sur l'affaire `…00c1` (« Refonte du site vitrine », channel « Grands comptes », que la
// lectrice ne lit pas), puis effacés ; les deux événements du fil qu'ils laissent restent, le fil étant immuable
// (`e2e/api/recherche-champs-communs.spec.ts`).

import { URL_API, enTetesService } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test, type Page } from './fixtures'

const UNITE = 'CRM-112'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const AFFAIRE = '5eed0000-0000-4000-8000-0000000000c1'
const CLE = 'tst-t6-ui-siret'
const TERME = 'quorvex'
const EXTRAIT = 'Numéro SIRET de l’établissement principal : Quorvex 552 100 554 00017'

async function chercher(page: Page, terme: string): Promise<void> {
	await page.keyboard.press('ControlOrMeta+k')
	await expect(page.getByTestId('champ-recherche')).toBeFocused()
	await page.keyboard.type(terme)
}

test.describe.configure({ mode: 'serial' })

test.describe('La palette trouve une affaire par un champ de l’affaire (CRM-112 T6)', () => {
	test.beforeAll(async ({ request }) => {
		const champ = await request.post(`${URL_API}/rest/v1/card_common_fields`, {
			headers: { ...enTetesService(), prefer: 'return=representation' },
			data: { workspace_id: ESPACE, key: CLE, label: 'Numéro SIRET de l’établissement principal', type: 'text', options: {} },
		})
		expect(champ.status()).toBe(201)
		const [{ id }] = (await champ.json()) as { id: string }[]
		const valeur = await request.post(`${URL_API}/rest/v1/card_common_field_values`, {
			headers: { ...enTetesService(), prefer: 'return=minimal' },
			data: { card_id: AFFAIRE, field_id: id, workspace_id: ESPACE, value: 'Quorvex 552 100 554 00017' },
		})
		expect(valeur.status()).toBe(201)
	})

	test.afterAll(async ({ request }) => {
		await request.delete(`${URL_API}/rest/v1/card_common_fields?key=eq.${CLE}`, { headers: enTetesService() })
	})

	test('l’administratrice trouve l’affaire, et la ligne dit par quel champ', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		await chercher(page, TERME)
		const ligne = page.getByTestId('resultat-recherche')
		await expect(ligne).toHaveCount(1)
		await expect(ligne).toHaveAttribute('data-famille', 'affaire')
		await expect(ligne).toContainText('Refonte du site vitrine')
		await expect(ligne).toContainText(EXTRAIT)
		// `Entrée` mène à la fiche de l'affaire : la destination ne change pas parce qu'on l'a trouvée par un champ.
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`/cards/${AFFAIRE}$`))
	})

	test('la lectrice, qui ne lit pas l’affaire, ne la trouve pas : « aucun résultat », rien de nommé', async ({ page }) => {
		await connecterAvecLeLabs(page, 'viewer@p2enjoy.test')
		await chercher(page, TERME)
		await expect(page.getByTestId('recherche-vide')).toBeVisible()
		await expect(page.getByTestId('panneau-recherche')).not.toContainText('Quorvex')
	})

	test('aux quatre paliers, l’extrait tient sur une ligne et la page ne défile pas de côté', async ({ page }) => {
		await connecterAvecLeLabs(page, 'admin@p2enjoy.test')
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.reload()
			await expect(page.getByTestId('entete')).toBeVisible()
			await page.keyboard.press('ControlOrMeta+k')
			await page.getByTestId('champ-recherche').fill(TERME)
			const ligne = page.getByTestId('resultat-recherche')
			await expect(ligne).toContainText('Refonte du site vitrine')
			const extrait = ligne.getByText(EXTRAIT)
			await expect(extrait).toBeVisible()
			// L'extrait est un échantillon : une ligne, en ellipse (§5.46) — sa hauteur est celle d'une ligne de texte.
			const boite = await extrait.boundingBox()
			expect(boite!.height, palier.nom).toBeLessThan(24)
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
			expect(debordement, palier.nom).toBeLessThanOrEqual(0)
			await capturer(page, `recherche-par-champ-${palier.nom}`, UNITE)
		}
	})
})
