// @verifies CRM-100 (docs/BACKLOG.md) tranche T2 — « Nouveau channel » depuis la vue d'un track, et l'aller-retour
//           vers l'éditeur de workflows, sur la pile réelle
// @verifies docs/SPEC-administration-arborescence.md §13.3 (la commande de la barre d'onglets, le formulaire sur
//           place, le board du channel créé et son onglet focalisé, `Échap`), §13.4 et §13.5 (l'éditeur ouvert sur la
//           création, portée pré-réglée, le bandeau, le workflow créé inscrit), §13.6 (le retour prérempli, dans la vue
//           du track ET dans l'arborescence), §13.8 (rendu à tous les rôles, la base refuse, l'écran traduit)
// @verifies docs/DESIGN_SYSTEM.md §5.55 (la commande, le formulaire, le bandeau), §7 (quatre paliers, aucun
//           défilement horizontal de la page), §8 (clavier seul, focus rendu)
// @verifies CLAUDE.md §10 (le refus prouvé avec les droits réels d'un commercial), §15 (état déterministe, effets
//           confirmés en base), §16 (captures observées)
// @verifies CRM-093 (docs/BACKLOG.md) — le scénario du refus révisé : la commande refusée est éteinte avec son motif (docs/SPEC-droits-
//           interface.md §3, §5 ; docs/DESIGN_SYSTEM.md §5.59)
//
// Tout part du SEED et de ses comptes réels, connectés par la vraie page du SSO. Le track « Formation » est retenu :
// un seul channel, et un seul workflow affectable — le global par défaut —, mesuré le 2026-10-11. Les channels et
// workflows créés portent un préfixe propre et sont retirés après chaque scénario par la clé de service (les étapes
// et les versions d'un workflow suivent en cascade), retrait CONSTATÉ par une relecture.

import {
	connecterAvecLeLabs,
	expect,
	test,
	type APIRequestContext,
	type Page,
} from './fixtures'
import type { Locator } from '@playwright/test'
import { PALIERS, capturer } from './captures'
import { URL_API, enTetesService } from '../api/jetons'

const UNITE = 'CRM-100'
const ADMIN = 'admin@p2enjoy.test'
const BIZDEV = 'bizdev@p2enjoy.test'
const TRACK = { id: '5eed0000-0000-4000-8000-000000000023', slug: 'formation', nom: 'Formation' } as const
const BOARD_EXISTANT = '/tracks/formation/inter-entreprises'
const WORKFLOW_DEFAUT = 'Cycle commercial standard (par défaut)'
const PREFIXE_SLUG = 'sonde-100'
const PREFIXE_NOM = 'Sonde 100'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE_CHANNELS = `slug=like.${PREFIXE_SLUG}*`
const FILTRE_WORKFLOWS = `name=like.${encodeURIComponent(`${PREFIXE_NOM}*`)}`

test.use({ viewport: { width: 1440, height: 900 } })

async function purger(request: APIRequestContext): Promise<void> {
	// Les channels d'abord : ils désignent les workflows, que la base refuserait sinon de retirer.
	await request.delete(rest(`channels?${FILTRE_CHANNELS}`), { headers: enTetesService() })
	await request.delete(rest(`workflows?${FILTRE_WORKFLOWS}`), { headers: enTetesService() })
}

test.beforeEach(async ({ request }) => purger(request))

test.afterEach(async ({ request }) => {
	await purger(request)
	const channels = await request.get(rest(`channels?select=id&${FILTRE_CHANNELS}`), { headers: enTetesService() })
	const workflows = await request.get(rest(`workflows?select=id&${FILTRE_WORKFLOWS}`), { headers: enTetesService() })
	expect(await channels.json(), 'aucun channel de sonde ne doit rester dans le seed').toEqual([])
	expect(await workflows.json(), 'aucun workflow de sonde ne doit rester dans le seed').toEqual([])
})

type ChannelLu = { readonly track_id: string; readonly workflow_id: string; readonly name: string }

/** Le channel tel que la base le porte, lu par la clé de service : l'effet réel du geste d'écran. */
async function channelEnBase(request: APIRequestContext, slug: string): Promise<ChannelLu | undefined> {
	const reponse = await request.get(rest(`channels?slug=eq.${slug}&select=track_id,workflow_id,name`), {
		headers: enTetesService(),
	})
	expect(reponse.status()).toBe(200)
	return ((await reponse.json()) as ChannelLu[])[0]
}

async function workflowEnBase(
	request: APIRequestContext,
	nom: string,
): Promise<{ id: string; scope: string; track_id: string | null; etapes: number } | undefined> {
	const reponse = await request.get(
		rest(`workflows?name=eq.${encodeURIComponent(nom)}&select=id,scope,track_id,workflow_steps(count)`),
		{ headers: enTetesService() },
	)
	const lignes = (await reponse.json()) as {
		id: string
		scope: string
		track_id: string | null
		workflow_steps: { count: number }[]
	}[]
	const ligne = lignes[0]
	return ligne === undefined ? undefined : { ...ligne, etapes: ligne.workflow_steps[0]?.count ?? 0 }
}

/**
 * Avance le focus par `Tab` jusqu'à `cible`, ou échoue en la nommant. Jamais de `focus()` programmatique : seul un
 * focus atteint au clavier porte `:focus-visible` (patron de `administration-arborescence.spec.ts`).
 */
async function tabVers(page: Page, cible: Locator, max = 120): Promise<void> {
	for (let tentative = 0; tentative < max; tentative++) {
		if (await cible.evaluate((element: Element) => element === document.activeElement).catch(() => false)) return
		await page.keyboard.press('Tab')
	}
	await expect(cible).toBeFocused()
}

const commande = (page: Page) => page.getByTestId('barre-onglets').getByTestId('commande-nouveau-channel')

test.describe('CRM-100 — « Nouveau channel » depuis la vue du track', () => {
	test('à la souris : la commande ouvre le formulaire sur place, et la création ouvre le board du channel', async ({
		page,
		request,
	}) => {
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(BOARD_EXISTANT)
		await expect(page.getByTestId('colonne').first()).toBeVisible()

		await commande(page).click()
		await expect(page).toHaveURL(`${BOARD_EXISTANT}?nouveau-channel=1`)
		const formulaire = page.getByTestId('formulaire-channel')
		await expect(formulaire.getByLabel('Nom')).toBeFocused()
		// La commande quitte la barre pendant la saisie ; le board reste rendu dessous (§5.55).
		await expect(commande(page)).toHaveCount(0)
		await expect(page.getByTestId('colonne').first()).toBeVisible()

		await formulaire.getByLabel('Nom').fill(`${PREFIXE_NOM} souris`)
		await expect(formulaire.getByLabel('Slug')).toHaveValue(`${PREFIXE_SLUG}-souris`)
		// Aucun défaut présélectionné (§7.2) : « Créer » attend le choix.
		await expect(formulaire.getByRole('button', { name: 'Créer' })).toBeDisabled()
		await formulaire.getByLabel('Workflow').selectOption({ label: WORKFLOW_DEFAUT })
		await capturer(page, 'nouveau-channel-formulaire-xl-1440', UNITE)
		await formulaire.getByRole('button', { name: 'Créer' }).click()

		await expect(page).toHaveURL(`/tracks/${TRACK.slug}/${PREFIXE_SLUG}-souris`)
		const onglet = page.getByTestId('onglet-channel').filter({ hasText: `${PREFIXE_NOM} souris` })
		await expect(onglet).toHaveAttribute('aria-current', 'page')
		await expect(onglet).toBeFocused()
		await expect(formulaire).toHaveCount(0)
		await expect(page.getByTestId('region-annonces').filter({ hasText: 'créé' })).toHaveCount(1)
		await expect(commande(page)).toBeVisible()
		await capturer(page, 'nouveau-channel-board-cree-xl-1440', UNITE)

		expect(await channelEnBase(request, `${PREFIXE_SLUG}-souris`)).toEqual({
			track_id: TRACK.id,
			workflow_id: '5eed0000-0000-4000-8000-000000000051',
			name: `${PREFIXE_NOM} souris`,
		})
	})

	test('au clavier seul : `Échap` rend le focus à la commande ; l’aller-retour crée un workflow à une étape, et le channel le suit', async ({
		page,
		request,
	}) => {
		test.setTimeout(120_000)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto(`/tracks/${TRACK.slug}`)

		// Ouvrir, puis refermer par `Échap` : le focus revient à la commande, différé d'un rendu.
		await tabVers(page, commande(page))
		await page.keyboard.press('Enter')
		const formulaire = page.getByTestId('formulaire-channel')
		await expect(formulaire.getByLabel('Nom')).toBeFocused()
		await page.keyboard.type('Brouillon jeté')
		await page.keyboard.press('Escape')
		await expect(formulaire).toHaveCount(0)
		await expect(page).toHaveURL(`/tracks/${TRACK.slug}`)
		await expect(commande(page)).toBeFocused()

		// Rouvrir, saisir, et partir vers l'éditeur par « Nouveau workflow ».
		await page.keyboard.press('Enter')
		await expect(formulaire.getByLabel('Nom')).toBeFocused()
		await page.keyboard.type(`${PREFIXE_NOM} clavier`)
		await tabVers(page, formulaire.getByRole('link', { name: 'Nouveau workflow' }))
		await page.keyboard.press('Enter')

		await expect(page).toHaveURL(/\/reglages\/workflows\?retour=/)
		const bandeau = page.getByTestId('bandeau-retour-channel')
		await expect(bandeau).toContainText('Vous créez un channel')
		const creation = page.getByTestId('workflows-formulaire-creation')
		await expect(creation.getByLabel('Nom')).toBeFocused()
		await expect(creation.getByLabel('Portée')).toHaveValue('track')
		await expect(creation.getByLabel('Track')).toHaveValue(TRACK.id)
		await capturer(page, 'nouveau-channel-editeur-bandeau-xl-1440', UNITE)
		await page.keyboard.type(`${PREFIXE_NOM} workflow clavier`)
		await tabVers(page, creation.getByRole('button', { name: 'Créer' }))
		await page.keyboard.press('Enter')
		await expect(creation).toHaveCount(0)
		await expect(bandeau).toContainText(`${PREFIXE_NOM} workflow clavier`)
		await expect(page).toHaveURL(/workflow-cree=/)

		// Composer : une étape, au clavier.
		await tabVers(page, page.getByRole('button', { name: 'Ajouter une étape' }))
		await page.keyboard.press('Enter')
		const selecteur = page.getByTestId('selecteur-ajout')
		await tabVers(page, selecteur.getByRole('button', { name: /^Ajouter Prospection/ }))
		await page.keyboard.press('Enter')
		await expect(page.getByTestId('ligne-etape')).toHaveCount(1)

		const workflow = await workflowEnBase(request, `${PREFIXE_NOM} workflow clavier`)
		expect(workflow).toMatchObject({ scope: 'track', track_id: TRACK.id, etapes: 1 })

		// Revenir : le formulaire rouvert, prérempli, le workflow créé choisi.
		await tabVers(page, bandeau.getByRole('link', { name: 'Revenir au nouveau channel' }))
		await page.keyboard.press('Enter')
		await expect(page).toHaveURL(new RegExp(`^[^?]*/tracks/${TRACK.slug}\\?`))
		await expect(formulaire.getByLabel('Nom')).toHaveValue(`${PREFIXE_NOM} clavier`)
		await expect(formulaire.getByLabel('Slug')).toHaveValue(`${PREFIXE_SLUG}-clavier`)
		await expect(formulaire.getByLabel('Workflow')).toHaveValue(workflow?.id ?? 'absent')
		await capturer(page, 'nouveau-channel-retour-prerempli-xl-1440', UNITE)
		await tabVers(page, formulaire.getByRole('button', { name: 'Créer' }))
		await page.keyboard.press('Enter')

		await expect(page).toHaveURL(`/tracks/${TRACK.slug}/${PREFIXE_SLUG}-clavier`)
		await expect(page.getByTestId('onglet-channel').filter({ hasText: `${PREFIXE_NOM} clavier` })).toBeFocused()
		// Le board suit le workflow composé : une colonne, la seule étape.
		await expect(page.getByTestId('colonne')).toHaveCount(1)
		expect(await channelEnBase(request, `${PREFIXE_SLUG}-clavier`)).toEqual({
			track_id: TRACK.id,
			workflow_id: workflow?.id,
			name: `${PREFIXE_NOM} clavier`,
		})
	})

	test('depuis l’arborescence : le retour rouvre le formulaire du même track, prérempli, et la création le referme', async ({
		page,
		request,
	}) => {
		test.setTimeout(120_000)
		await connecterAvecLeLabs(page, ADMIN)
		await page.goto('/reglages/arborescence')
		await page.getByRole('button', { name: `Déplier ${TRACK.nom}` }).click()
		await page.getByRole('button', { name: 'Nouveau channel' }).click()
		const formulaire = page.getByTestId('formulaire-channel')
		await formulaire.getByLabel('Nom').fill(`${PREFIXE_NOM} arborescence`)
		await formulaire.getByLabel('Description').fill('Accords cadre')
		await formulaire.getByRole('link', { name: 'Nouveau workflow' }).click()

		const creation = page.getByTestId('workflows-formulaire-creation')
		// « Global » reste un choix légitime : la portée pré-réglée se change.
		await creation.getByLabel('Portée').selectOption('global')
		await creation.getByLabel('Nom').fill(`${PREFIXE_NOM} workflow global`)
		await creation.getByRole('button', { name: 'Créer' }).click()
		await expect(page.getByTestId('bandeau-retour-channel')).toContainText(`${PREFIXE_NOM} workflow global`)
		await page.getByTestId('bandeau-retour-channel').getByRole('link', { name: 'Revenir au nouveau channel' }).click()

		await expect(page).toHaveURL(/\/reglages\/arborescence\?nouveau-channel=/)
		await expect(page.getByRole('button', { name: `Replier ${TRACK.nom}` })).toBeVisible()
		await expect(formulaire.getByLabel('Nom')).toHaveValue(`${PREFIXE_NOM} arborescence`)
		await expect(formulaire.getByLabel('Description')).toHaveValue('Accords cadre')
		const workflow = await workflowEnBase(request, `${PREFIXE_NOM} workflow global`)
		await expect(formulaire.getByLabel('Workflow')).toHaveValue(workflow?.id ?? 'absent')
		await formulaire.getByRole('button', { name: 'Créer' }).click()

		await expect(page).toHaveURL('/reglages/arborescence')
		await expect(page.getByRole('list', { name: `Channels du track ${TRACK.nom}` })).toContainText(
			`${PREFIXE_NOM} arborescence`,
		)
		expect(await channelEnBase(request, `${PREFIXE_SLUG}-arborescence`)).toEqual({
			track_id: TRACK.id,
			workflow_id: workflow?.id,
			name: `${PREFIXE_NOM} arborescence`,
		})
	})

	test('un commercial voit « Nouveau channel » en TEXTE inactif, qui porte le motif de l’administration (CRM-093)', async ({
		page,
		request,
	}) => {
		await connecterAvecLeLabs(page, BIZDEV)
		await page.goto(`/tracks/${TRACK.slug}`)
		// RÉVISÉ PAR `CRM-093` (docs/DESIGN_SYSTEM.md §5.59, écart borné de la barre d'onglets) : la capacité
		// d'administrer est rendue par la base ; refusée, le lien devient un texte à la même place, qui porte son motif
		// en description accessible et en infobulle native. Le `403` reste prouvé hors interface
		// (`e2e/api/nouveau-channel.spec.ts`).
		const texte = commande(page)
		await expect(texte).toBeVisible()
		await expect(texte).toHaveAttribute('aria-disabled', 'true')
		expect(await texte.evaluate((element) => element.tagName)).toBe('SPAN')
		await expect(texte).toHaveAttribute('title', /réservées aux administrateurs/)
		// Pendant la lecture de la capacité, la commande est éteinte SANS motif (§4) : attendre le motif, c'est attendre
		// l'état lu.
		await expect(texte).toHaveAttribute('aria-describedby', /.+/)
		const motif = page.locator(`[id="${await texte.getAttribute('aria-describedby')}"]`)
		await expect(motif).toContainText('réservées aux administrateurs')
		await texte.click()
		await expect(page.getByTestId('formulaire-channel')).toHaveCount(0)
		await capturer(page, 'nouveau-channel-refus-commercial-xl-1440', UNITE)
		expect(await channelEnBase(request, `${PREFIXE_SLUG}-refus`)).toBeUndefined()
	})

	test('aux quatre paliers : la commande, le formulaire et le bandeau tiennent sans défilement horizontal de la page', async ({
		page,
	}) => {
		test.setTimeout(120_000)
		await connecterAvecLeLabs(page, ADMIN)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await page.goto(BOARD_EXISTANT)
			await expect(commande(page)).toBeAttached()
			await capturer(page, `nouveau-channel-barre-${palier.nom}`, UNITE)
			await commande(page).evaluate((element: HTMLElement) => element.click())
			await page.getByTestId('formulaire-channel').getByLabel('Nom').fill(`${PREFIXE_NOM} palier`)
			await capturer(page, `nouveau-channel-formulaire-${palier.nom}`, UNITE)
			const debordement = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordement, `aucun défilement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)

			await page.getByTestId('formulaire-channel').getByRole('link', { name: 'Nouveau workflow' }).click()
			await expect(page.getByTestId('bandeau-retour-channel')).toBeVisible()
			await capturer(page, `nouveau-channel-editeur-bandeau-${palier.nom}`, UNITE)
			const debordementEditeur = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
			)
			expect(debordementEditeur, `éditeur : aucun défilement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
		}
	})
})
