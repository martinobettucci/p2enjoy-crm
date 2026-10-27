// @verifies CRM-119 (docs/BACKLOG.md) — tranche T2 : un droit fin posé dans « Réglages ▸ Membres » change ce que le membre
//           voit, sans reconnexion, et « Hérité » le lui rend
// @verifies docs/SPEC-permissions-rls.md §7.5 (U1 « Aucun accès », U2 « Lecture », U3 « Hérité »), §2.2 (le plus
//           spécifique gagne) ; docs/SPEC-membres.md §3.3 (poser un droit, « Hérité » le supprime) ;
//           docs/SPEC-droits-interface.md §3 (la commande refusée reste montée, éteinte, et cite son motif) ;
//           CLAUDE.md §10 (le refus vérifié par une requête directe), §15 (effets backend), §16 (captures observées)
//
// Deux navigateurs ouverts en même temps : Camille, administratrice, pose le droit ; Driss, business developer, le subit.
// Le seed ne pose aucun droit de Driss sur « Grands comptes » : chaque scénario part de là, et la clé de service le
// constate à la fin.

import type { Browser, BrowserContext } from '@playwright/test'
import { connecterAvecLeLabs, expect, surveillerConsole, test, type APIRequestContext, type Page } from './fixtures'
import { capturer } from './captures'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'

const UNITE = 'CRM-119'
const DRISS = '5eed0000-0000-4000-8000-000000000012'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const CHANNEL = '/tracks/conseil-ia/grands-comptes'
const TRACK = '/tracks/conseil-ia'
const SOGEXIA = `${CHANNEL}/cards/5eed0000-0000-4000-8000-0000000000c2`
const TITRE = 'Affaire E2E droits fins croisés'
const MOTIF_LECTURE = /Vos droits ne vous permettent pas d’en modifier les affaires/

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const droitDeDriss = `channel_members?channel_id=eq.${GRANDS_COMPTES}&user_id=eq.${DRISS}`

test.use({ viewport: { width: 1440, height: 900 } })

async function droitEnBase(requete: APIRequestContext): Promise<string[]> {
	const reponse = await requete.get(rest(`${droitDeDriss}&select=access`), { headers: enTetesService() })
	expect(reponse.status()).toBe(200)
	return ((await reponse.json()) as { access: string }[]).map((ligne) => ligne.access)
}

async function nettoyer(requete: APIRequestContext): Promise<void> {
	await requete.delete(rest(droitDeDriss), { headers: enTetesService() })
	await requete.delete(rest(`cards?title=like.${encodeURIComponent(TITRE)}*`), { headers: enTetesService() })
}

test.beforeEach(async ({ request }) => {
	await nettoyer(request)
})
test.afterEach(async ({ request }) => {
	await nettoyer(request)
	expect(await droitEnBase(request), 'le seed ne pose aucun droit de Driss sur « Grands comptes »').toEqual([])
})

/** Le second navigateur, celui de Driss : sa console est surveillée comme celle de la page principale. */
async function ouvrirDriss(browser: Browser): Promise<{ contexte: BrowserContext; page: Page; anomalies: string[] }> {
	const contexte = await browser.newContext({ viewport: { width: 1440, height: 900 } })
	const page = await contexte.newPage()
	const anomalies = surveillerConsole(page)
	await connecterAvecLeLabs(page, 'bizdev@p2enjoy.test')
	return { contexte, page, anomalies }
}

/** Camille pose le droit de Driss sur « Grands comptes », au clavier, et l'écran le confirme. */
async function poser(camille: Page, valeur: 'none' | 'viewer' | 'herite', libelle: string): Promise<void> {
	const droits = camille.getByTestId('droits-fins')
	await expect(droits.getByLabel('Membre')).toHaveValue(DRISS)
	const champ = droits.getByLabel('Droit posé sur Grands comptes')
	await champ.focus()
	await champ.selectOption(valeur)
	await expect(droits.getByTestId('message-droits')).toHaveText(`Droit de Driss Lemoine sur « Grands comptes » : ${libelle}.`)
}

async function creerParLApi(requete: APIRequestContext, jeton: string): Promise<number> {
	const reponse = await requete.post(rest('rpc/creer_affaire'), {
		headers: enTetesAuthentifies(jeton),
		data: { p_channel: GRANDS_COMPTES, p_titre: `${TITRE} directe` },
	})
	return reponse.status()
}

async function affairesDirectes(requete: APIRequestContext): Promise<unknown[]> {
	const reponse = await requete.get(rest(`cards?title=eq.${encodeURIComponent(`${TITRE} directe`)}&select=id`), {
		headers: enTetesService(),
	})
	return (await reponse.json()) as unknown[]
}

test('Aucun accès, puis Lecture, puis Hérité : l’écran de Driss suit chaque droit que Camille pose, sans reconnexion', async ({
	page: camille,
	browser,
	request,
}) => {
	const driss = await ouvrirDriss(browser)
	try {
		// Avant : son rôle décide. Il lit Sogexia, et le channel lui offre « Nouvelle affaire ».
		await driss.page.goto(SOGEXIA)
		await expect(driss.page.getByTestId('entete-card').getByRole('heading', { name: 'Migration ERP Sogexia' })).toBeVisible()
		await driss.page.goto(CHANNEL)
		await expect(driss.page.getByTestId('nouvelle-affaire')).toBeEnabled()

		await connecterAvecLeLabs(camille, 'admin@p2enjoy.test')
		await camille.goto('/reglages/membres')

		// U1 — « Aucun accès ».
		await poser(camille, 'none', 'Aucun accès')
		expect(await droitEnBase(request)).toEqual(['none'])
		await driss.page.goto(SOGEXIA)
		await expect(driss.page.getByRole('heading', { name: 'Card introuvable' })).toBeVisible()
		await capturer(driss.page, 'driss-aucun-acces-fiche-1440', UNITE)
		await driss.page.goto(TRACK)
		await expect(driss.page.getByTestId('barre-onglets').getByRole('link', { name: 'Prospection' })).toBeVisible()
		await expect(driss.page.getByTestId('barre-onglets').getByRole('link', { name: 'Grands comptes' })).toHaveCount(0)
		await capturer(driss.page, 'driss-aucun-acces-track-1440', UNITE)

		// U2 — « Lecture » : la fiche se rouvre, la création s'éteint et cite son motif ; la base refuse la requête directe.
		await poser(camille, 'viewer', 'Lecture')
		expect(await droitEnBase(request)).toEqual(['viewer'])
		await driss.page.goto(SOGEXIA)
		await expect(driss.page.getByTestId('entete-card').getByRole('heading', { name: 'Migration ERP Sogexia' })).toBeVisible()
		await driss.page.goto(CHANNEL)
		await expect(driss.page.getByTestId('nouvelle-affaire')).toBeDisabled()
		await expect(driss.page.getByText(MOTIF_LECTURE)).toBeVisible()
		await capturer(driss.page, 'driss-lecture-channel-1440', UNITE)
		const jeton = await jetonDe('bizdev@p2enjoy.test')
		expect(await creerParLApi(request, jeton), 'la base refuse la création, quoi que montre l’écran').toBe(403)
		expect(await affairesDirectes(request)).toEqual([])

		// U3 — « Hérité » : la ligne est supprimée, et son rôle décide de nouveau.
		await poser(camille, 'herite', 'Hérité')
		expect(await droitEnBase(request)).toEqual([])
		await driss.page.goto(CHANNEL)
		await expect(driss.page.getByTestId('nouvelle-affaire')).toBeEnabled()
		await expect(driss.page.getByText(MOTIF_LECTURE)).toHaveCount(0)
		await capturer(driss.page, 'driss-herite-channel-1440', UNITE)

		expect(driss.anomalies, 'aucun warning, error ou pageerror dans le navigateur de Driss').toEqual([])
	} finally {
		await driss.contexte.close()
	}
})
