// @verifies CRM-112 (docs/BACKLOG.md) — tranche T7 : le générateur ne doublonne pas un champ de l'affaire, sur la pile
//           réelle — le défaut `common_field` écrit par la base et traduit à l'écran, l'acceptation retenue, le champ
//           retiré puis la suggestion acceptée sans lui ; à la souris, au clavier, aux quatre paliers
// @verifies docs/SPEC-ia.md §14.11 (décision 851 : le scénario `champ_commun`, le défaut nommant le champ de l'affaire
//           par son libellé, bloquant) ; docs/DESIGN_SYSTEM.md §5.52 ter (la phrase du défaut), §5.52 (le bloc des
//           défauts, « Accepter » retenu), §7 (quatre paliers, aucun défilement horizontal), §8 (clavier)
// @verifies CLAUDE.md §15 (état déterministe, effets relus en base), §16 (captures observées)
//
// LE SERVEUR LLM N'EST JAMAIS APPELÉ (docs/SPEC-ia.md §8) : chaque requête de la page vers la fonction `ia` reçoit
// l'en-tête `x-ia-simulateur: champ_commun`. Le champ de l'affaire `siret` est posé par la clé de service s'il manque à
// l'espace, et retiré à la fin seulement s'il a été posé ici ; les suggestions de sonde et leurs workflows sont retirés
// après chaque scénario — retrait CONSTATÉ.

import { connecterAvecLeLabs, expect, test, type APIRequestContext, type Page } from './fixtures'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-112'
const ADMIN = 'admin@p2enjoy.test'
const EDITEUR = '/reglages/workflows'
const PREFIXE = 'Sonde 112 T7'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const NBSP = ' '

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`
const guillemets = (texte: string) => texte.replace(/« /g, `«${NBSP}`).replace(/ »/g, `${NBSP}»`)

test.use({ viewport: { width: 1440, height: 900 } })

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

/** Le champ de l'affaire `siret` de l'espace : son libellé, et son identifiant s'il a été posé par la preuve. */
let libelleSiret = 'SIRET'
let siretPose: string | null = null

test.beforeEach(async ({ request }) => {
	const existants = await lireService<{ id: string; label: string; archived_at: string | null }>(request,
		`card_common_fields?workspace_id=eq.${ESPACE}&key=eq.siret&select=id,label,archived_at`)
	if (existants.length === 0) {
		const creation = await request.post(rest('card_common_fields?select=id,label'), {
			headers: { ...enTetesService(), prefer: 'return=representation' },
			data: { workspace_id: ESPACE, key: 'siret', label: 'SIRET', type: 'text', options: {}, position: 9701 },
		})
		expect(creation.status(), await creation.text()).toBe(201)
		const [pose] = (await creation.json()) as { id: string; label: string }[]
		siretPose = pose?.id ?? null
		libelleSiret = pose?.label ?? 'SIRET'
	} else {
		expect(existants[0]?.archived_at, 'le champ siret de l’espace doit être actif').toBeNull()
		siretPose = null
		libelleSiret = existants[0]?.label ?? 'SIRET'
	}
})

test.afterEach(async ({ request }) => {
	const creees = await lireService<{ workflow_cree_id: string | null }>(request, `suggestions_ia?select=workflow_cree_id&${FILTRE}&workflow_cree_id=not.is.null`)
	for (const { workflow_cree_id } of creees) {
		expect((await request.delete(rest(`workflows?id=eq.${workflow_cree_id}`), { headers: enTetesService() })).status()).toBe(204)
	}
	await request.delete(rest(`suggestions_ia?${FILTRE}`), { headers: enTetesService() })
	expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`), 'aucune suggestion de sonde ne doit rester').toEqual([])
	if (siretPose !== null) {
		expect((await request.delete(rest(`card_common_fields?id=eq.${siretPose}`), { headers: enTetesService() })).status()).toBe(204)
		siretPose = null
	}
})

async function simuler(page: Page): Promise<void> {
	await page.route('**/functions/v1/ia/**', async (route) => {
		await route.continue({ headers: { ...route.request().headers(), 'x-ia-simulateur': 'champ_commun' } })
	})
}

async function tabulerJusqua(page: Page, nom: string, maximum = 160): Promise<void> {
	for (let pas = 0; pas < maximum; pas += 1) {
		await page.keyboard.press('Tab')
		const courant = await page.evaluate(() => {
			const element = document.activeElement as HTMLElement | null
			return element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? ''
		})
		if (courant === nom) return
	}
	throw new Error(`« ${nom} » n'est pas atteint au clavier en ${maximum} tabulations`)
}

const panneau = (page: Page) => page.getByTestId('ia-panneau')
const phrase = () =>
	guillemets(`Le champ « siret » reprend le champ de l’affaire « ${libelleSiret} », déjà porté par toute affaire de l’espace : retirez-le ou renommez-le.`)

async function demander(page: Page, demande: string): Promise<void> {
	await page.getByRole('button', { name: 'Créer avec l’IA' }).click()
	await page.getByLabel('Décrivez le workflow').fill(demande)
	await page.getByRole('button', { name: 'Générer la suggestion' }).click()
	await expect(panneau(page).getByRole('heading', { level: 2, name: 'Suggestion de l’IA' })).toBeFocused()
}

async function siretAbsentDuWorkflow(request: APIRequestContext): Promise<void> {
	const [suggestion] = await lireService<{ statut: string; workflow_cree_id: string }>(request, `suggestions_ia?select=statut,workflow_cree_id&${FILTRE}`)
	expect(suggestion?.statut).toBe('acceptee')
	expect(await lireService(request, `form_fields?workflow_id=eq.${suggestion?.workflow_cree_id}&key=eq.siret&select=id`)).toEqual([])
	expect(await lireService(request, `form_fields?workflow_id=eq.${suggestion?.workflow_cree_id}&key=eq.source&select=key`)).toEqual([{ key: 'source' }])
}

test.describe('Le générateur ne doublonne pas un champ de l’affaire (docs/SPEC-ia.md §14.11)', () => {
	test('à la souris : le défaut nomme le champ de l’affaire, « Accepter » est retenu ; « siret » retiré, la suggestion est acceptée', async ({ page, request }) => {
		await simuler(page)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		await demander(page, `${PREFIXE} — souris : un cycle de vente aux entreprises, avec leur SIRET.`)

		const defauts = page.getByTestId('ia-defauts')
		await expect(defauts.getByRole('heading')).toHaveText('1 défaut empêche l’acceptation')
		await expect(defauts.getByRole('listitem')).toHaveText([phrase()])
		await expect(page.getByRole('button', { name: 'Accepter et créer le workflow' })).toBeDisabled()
		await capturer(page, 'ia-champ-commun-defaut-xl-1440', UNITE)

		await page.getByRole('button', { name: 'Retirer le champ SIRET' }).click()
		await page.getByRole('button', { name: 'Enregistrer la correction' }).click()
		await expect(page.getByTestId('ia-defauts')).toHaveCount(0)
		await capturer(page, 'ia-champ-commun-corrigee-xl-1440', UNITE)
		await page.getByRole('button', { name: 'Accepter et créer le workflow' }).click()
		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)
		await siretAbsentDuWorkflow(request)
	})

	test('au clavier seul : retirer « siret », enregistrer, accepter', async ({ page, request }) => {
		await simuler(page)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(EDITEUR)
		await demander(page, `${PREFIXE} — clavier`)
		await expect(page.getByTestId('ia-defauts').getByRole('listitem')).toHaveText([phrase()])

		await tabulerJusqua(page, 'Retirer le champ SIRET')
		await page.keyboard.press('Enter')
		await tabulerJusqua(page, 'Enregistrer la correction')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('ia-defauts')).toHaveCount(0)
		await tabulerJusqua(page, 'Accepter et créer le workflow')
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('ia-panneau')).toHaveCount(0)
		await siretAbsentDuWorkflow(request)
	})

	for (const palier of PALIERS) {
		test(`le défaut au palier ${palier.nom} : dans le cadre, la page sans défilement de côté`, async ({ page }) => {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await simuler(page)
			await connecterAvecLeLabs(page, ADMIN)
			await page.goto(EDITEUR)
			await demander(page, `${PREFIXE} — palier ${palier.nom}`)
			const defauts = page.getByTestId('ia-defauts')
			await expect(defauts.getByRole('listitem')).toHaveText([phrase()])
			await defauts.scrollIntoViewIfNeeded()

			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, 'la page ne défile jamais horizontalement (§7)').toBeLessThanOrEqual(0)
			const boite = await defauts.boundingBox()
			expect(boite).not.toBeNull()
			expect(boite?.x ?? -1, 'le bloc des défauts commence dans le cadre').toBeGreaterThanOrEqual(0)
			expect((boite?.x ?? 0) + (boite?.width ?? 0), 'le bloc des défauts finit dans le cadre').toBeLessThanOrEqual(palier.largeur)
			await capturer(page, `ia-champ-commun-${palier.nom}`, UNITE)
		})
	}
})
