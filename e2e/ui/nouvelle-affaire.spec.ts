// @verifies CRM-095 (docs/BACKLOG.md) — tranche T2 : « Nouvelle affaire » sur la pile réelle, à la souris
//           et au clavier seul, depuis le board et la vue liste ; le refus de la lectrice
// @verifies docs/SPEC-cards.md §18.2 (l'affaire naît à l'étape INITIALE du workflow de son channel),
//           §18.3 (l'écran : commande, formulaire dans le flux, fiche ouverte, refus traduits), §18.5
// @verifies docs/DESIGN_SYSTEM.md §5.50 (Nouvelle affaire), §5.2 (l'action de la colonne initiale vide),
//           §7 (quatre paliers, aucun défilement horizontal de la page), §8 (clavier, focus rendu)
// @verifies CLAUDE.md §10 (le refus prouvé avec les droits réels de la lectrice), §15 (état déterministe,
//           effets en base vérifiés), §16 (captures observées)
//
// Tout part du SEED et de ses comptes réels, connectés par la vraie page du SSO. `studio-web / refonte`
// est retenu parce que sa colonne initiale est VIDE — mesuré le 2026-09-29 : deux affaires, aucune à
// `Prospection` — et que ses deux profils utiles y ont les droits attendus : le commercial y écrit, la
// lectrice y lit sans écrire (aucun droit fin ne les surcharge). Les affaires créées portent un préfixe
// et sont retirées après chaque scénario par la clé de service, dont le retrait est CONSTATÉ.

import {
	ERREUR_RESSOURCE_HTTP,
	autoriserErreursConsole,
	connecterAvecLeLabs,
	expect,
	test,
	type APIRequestContext,
	type Page,
} from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-095'
const BIZDEV = 'bizdev@p2enjoy.test'
const VIEWER = 'viewer@p2enjoy.test'
const REFONTE = { board: '/tracks/studio-web/refonte', liste: '/tracks/studio-web/refonte/liste' } as const
const PREFIXE = 'Sonde 095 UI'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE_SONDES = `title=like.${encodeURIComponent(`${PREFIXE}*`)}`

test.use({ viewport: { width: 1440, height: 900 } })

test.afterEach(async ({ request }) => {
	await request.delete(rest(`cards?${FILTRE_SONDES}`), { headers: enTetesService() })
	const restantes = await request.get(rest(`cards?select=id&${FILTRE_SONDES}`), { headers: enTetesService() })
	expect(await restantes.json(), 'aucune affaire de sonde ne doit rester dans le seed').toEqual([])
})

type AffaireLue = {
	readonly title: string
	readonly current_step_id: string
	readonly channels: { readonly slug: string } | null
	readonly workflow_steps: { readonly is_initial: boolean } | null
}

/** L'affaire telle que la base la porte, lue par la clé de service : l'effet réel du geste. */
async function lireAffaire(requete: APIRequestContext, idCard: string): Promise<AffaireLue | undefined> {
	const reponse = await requete.get(
		rest(
			`cards?id=eq.${idCard}&select=title,current_step_id,channels!cards_channel_id_workspace_id_fkey(slug),workflow_steps!cards_current_step_id_workflow_id_fkey(is_initial)`,
		),
		{ headers: enTetesService() },
	)
	expect(reponse.status()).toBe(200)
	return ((await reponse.json()) as AffaireLue[])[0]
}

/** L'identifiant de la fiche ouverte, lu dans l'adresse atteinte — jamais supposé. */
async function ficheOuverte(page: Page, titre: string): Promise<string> {
	await expect(page).toHaveURL(/\/tracks\/studio-web\/refonte\/cards\/[0-9a-f-]{36}$/)
	await expect(page.getByTestId('entete-card').getByRole('heading', { name: titre })).toBeVisible()
	return page.url().split('/').pop() ?? ''
}

/** Tabule jusqu'à l'élément voulu, au clavier seul ; échoue en le nommant s'il n'est pas atteint. */
async function tabulerJusqua(page: Page, idTest: string, maximum = 80): Promise<void> {
	for (let pas = 0; pas < maximum; pas += 1) {
		await page.keyboard.press('Tab')
		const courant = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? null)
		if (courant === idTest) return
	}
	throw new Error(`« ${idTest} » n'est pas atteint au clavier en ${maximum} tabulations`)
}

test.describe('Nouvelle affaire sur le seed (docs/SPEC-cards.md §18)', () => {
	test('à la souris, depuis la colonne initiale vide : la fiche s’ouvre, l’affaire est à l’étape INITIALE', async ({
		page,
		request,
	}) => {
		const titre = `${PREFIXE} — souris`
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(REFONTE.board)

		// Une seule colonne porte l'action : celle de l'étape initiale, vide (§5.2).
		const action = page.getByTestId('creer-affaire-colonne')
		await expect(action).toHaveCount(1)
		await expect(page.getByTestId('nouvelle-affaire')).toBeVisible()
		await capturer(page, 'nouvelle-affaire-board-xl-1440', UNITE)
		await action.click()

		const formulaire = page.getByTestId('formulaire-nouvelle-affaire')
		await expect(formulaire).toBeVisible()
		await expect(page.getByTestId('champ-titre-affaire')).toBeFocused()
		// La commande et le formulaire s'excluent (§5.50).
		await expect(page.getByTestId('nouvelle-affaire')).toHaveCount(0)
		await expect(action).toHaveCount(0)
		await expect(page.getByTestId('creer-affaire')).toBeDisabled()
		await page.getByTestId('champ-titre-affaire').fill(titre)
		await expect(page.getByTestId('creer-affaire')).toBeEnabled()
		await capturer(page, 'nouvelle-affaire-colonne-xl-1440', UNITE)
		await page.getByTestId('creer-affaire').click()

		const idCard = await ficheOuverte(page, titre)
		const affaire = await lireAffaire(request, idCard)
		expect(affaire?.title).toBe(titre)
		expect(affaire?.channels?.slug).toBe('refonte')
		expect(affaire?.workflow_steps?.is_initial, 'l’affaire naît à l’étape INITIALE').toBe(true)

		// De retour au board : la carte est dans la colonne de son étape, qui n'offre plus l'action.
		await page.goto(REFONTE.board)
		const colonne = page.locator(`[data-testid="colonne"][data-etape="${affaire?.current_step_id ?? ''}"]`)
		await expect(colonne.getByTestId('carte-card').filter({ hasText: titre })).toHaveCount(1)
		await expect(page.getByTestId('creer-affaire-colonne')).toHaveCount(0)
	})

	test('au clavier seul, depuis la vue liste : ouvrir, `Échap`, rouvrir, saisir, `Entrée` — la fiche s’ouvre', async ({
		page,
		request,
	}) => {
		const titre = `${PREFIXE} — clavier`
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(REFONTE.liste)
		await expect(page.getByTestId('tableau-liste')).toBeVisible()

		await tabulerJusqua(page, 'nouvelle-affaire')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('champ-titre-affaire')).toBeFocused()
		await page.keyboard.type('Brouillon')
		// `Échap` referme, et le focus revient à la commande — la ligne de départ du clavier (§5.50).
		await page.keyboard.press('Escape')
		await expect(page.getByTestId('formulaire-nouvelle-affaire')).toHaveCount(0)
		await expect(page.getByTestId('nouvelle-affaire')).toBeFocused()

		await page.keyboard.press('Enter')
		await expect(page.getByTestId('champ-titre-affaire')).toBeFocused()
		// Rouvert, le formulaire repart d'un champ vide : `Échap` a abandonné le brouillon.
		await expect(page.getByTestId('champ-titre-affaire')).toHaveValue('')
		await page.keyboard.type(titre)
		await page.keyboard.press('Enter')

		const idCard = await ficheOuverte(page, titre)
		expect((await lireAffaire(request, idCard))?.workflow_steps?.is_initial).toBe(true)
	})

	test('la lectrice voit la commande ; la base refuse, et le refus est écrit sans perdre la saisie', async ({
		page,
		request,
	}) => {
		const titre = `${PREFIXE} — lectrice`
		await connecterAvecLeLabs(page, VIEWER)
		await page.goto(REFONTE.board)

		// Rendue à TOUS les rôles (§5.50) : l'écran ne calcule aucun droit.
		await page.getByTestId('nouvelle-affaire').click()
		await page.getByTestId('champ-titre-affaire').fill(titre)
		await page.getByTestId('champ-titre-affaire').press('Enter')

		const refus = page.getByTestId('refus-nouvelle-affaire')
		await expect(refus).toHaveText("Vous ne pouvez pas créer d'affaire dans ce channel.")
		await expect(refus).toHaveAttribute('role', 'alert')
		await expect(page.getByTestId('champ-titre-affaire')).toHaveValue(titre)
		await expect(page.getByTestId('champ-titre-affaire')).toBeFocused()
		autoriserErreursConsole(page, [ERREUR_RESSOURCE_HTTP[403]])
		await capturer(page, 'nouvelle-affaire-refus-lectrice-xl-1440', UNITE)

		// Rien n'est écrit : le refus vient de la base, avec le jeton réel de la lectrice (CLAUDE.md §10).
		const ecrites = await request.get(rest(`cards?select=id&${FILTRE_SONDES}`), { headers: enTetesService() })
		expect(await ecrites.json()).toEqual([])
	})

	for (const palier of PALIERS) {
		test(`le formulaire au palier ${palier.nom} : dans le cadre, et la page ne défile pas de côté`, async ({
			page,
		}) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await connecterAvecLeLabs(page, BIZDEV)
			await page.goto(REFONTE.board)
			await page.getByTestId('nouvelle-affaire').click()
			const formulaire = page.getByTestId('formulaire-nouvelle-affaire')
			await expect(formulaire).toBeVisible()
			await page.getByTestId('champ-titre-affaire').fill('Refonte du portail client — lot 2')

			// Le cadre du formulaire, mesuré des DEUX côtés (docs/DESIGN_SYSTEM.md §5.43).
			const cadre = await formulaire.boundingBox()
			expect(cadre, 'le formulaire est rendu').not.toBeNull()
			expect(cadre?.x ?? -1).toBeGreaterThanOrEqual(0)
			expect((cadre?.x ?? 0) + (cadre?.width ?? 0)).toBeLessThanOrEqual(palier.largeur)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			await capturer(page, `nouvelle-affaire-formulaire-${palier.nom}`, UNITE)
		})
	}
})
