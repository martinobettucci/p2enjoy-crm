// @verifies CRM-162 (docs/BACKLOG.md) — tranche T2 : déplacer un track sur la vraie pile — le bloc « Tracks » de la fiche
//           d'un espace, l'aperçu après le choix de l'arrivée, les refus listés sans commande, la saisie du nom qui ouvre
//           « Déplacer le track », l'issue, le track à l'arrivée, le journal de la plateforme, l'historique de l'affaire ; à
//           la souris, au clavier, aux quatre paliers ; captures
// @verifies docs/SPEC-deplacement-track.md §4, §5, §6, §10, §13 ; docs/DESIGN_SYSTEM.md §5.112 ; CLAUDE.md §16 (captures)
// @verifies CRM-162 (docs/BACKLOG.md) — tranche T3 : l'ancienne adresse d'un track déplacé mène à l'actuelle, channel compris,
//           sans entrée d'historique ; qui ne lit pas le track à l'arrivée reste sur « introuvable »
//           (docs/SPEC-deplacement-track.md §12 ; docs/SPEC-espace-courant.md §8.2 ; CLAUDE.md §10)
// @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §13 — connexion par la vraie page du SSO
//
// TOUT EST PROPRE À LA PREUVE (le patron de `e2e/api/deplacement-track.spec.ts`) : un espace d'arrivée créé par la fonction de
// la plateforme, sans membre d'abord — d'où un refus —, puis Camille administratrice ; un track « Sonde 162 écran » dans
// l'espace du seed, un channel, une affaire créée par Camille. Le track revient à son espace et tout est retiré à la fin.

import { type APIRequestContext, type Page } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from '../api/jetons'
import { PALIERS, capturer } from './captures'
import { connecterAvecLeLabs, expect, test } from './fixtures'

const UNITE = 'CRM-162'
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = { adresse: 'admin@p2enjoy.test', id: '5eed0000-0000-4000-8000-000000000011' } as const
const SABINE = 'plateforme@p2enjoy.test'
const DRISS = 'bizdev@p2enjoy.test'
const WORKFLOW_PAR_DEFAUT = '5eed0000-0000-4000-8000-000000000051'
const SLUG_ARRIVEE = 'sonde-162-ecran'
const NOM_ARRIVEE = 'Sonde 162 — écran'
const NOM_TRACK = 'Sonde 162 écran'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

test.describe.configure({ mode: 'serial' })
test.use({ viewport: { width: 1440, height: 1000 } })

let arrivee = ''
let track = ''
let affaire = ''

const rpc = (request: APIRequestContext, jeton: string, nom: string, corps: object) =>
	request.post(rest(`rpc/${nom}`), { headers: json(enTetesAuthentifies(jeton)), data: corps })

async function nettoyer(request: APIRequestContext): Promise<void> {
	const sabine = await jetonDe(SABINE)
	const tracks = await request.get(rest(`tracks?name=eq.${encodeURIComponent(NOM_TRACK)}&select=id,workspace_id`), { headers: enTetesService() })
	for (const t of (await tracks.json()) as { id: string; workspace_id: string }[]) {
		if (t.workspace_id !== ESPACE) await rpc(request, sabine, 'move_track', { p_track_id: t.id, p_target_workspace_id: ESPACE, p_confirm_name: NOM_TRACK })
		const canaux = (await (await request.get(rest(`channels?track_id=eq.${t.id}&select=id`), { headers: enTetesService() })).json()) as { id: string }[]
		if (canaux.length > 0) {
			const pl = await request.get(rest(`card_placements?channel_id=in.(${canaux.map((c) => c.id).join(',')})&select=card_id`), { headers: enTetesService() })
			const cartes = ((await pl.json()) as { card_id: string }[]).map((l) => l.card_id)
			if (cartes.length > 0) await request.delete(rest(`cards?id=in.(${cartes.join(',')})`), { headers: enTetesService() })
		}
		await request.delete(rest(`channels?track_id=eq.${t.id}`), { headers: enTetesService() })
		await request.delete(rest(`tracks?id=eq.${t.id}`), { headers: enTetesService() })
	}
	const [espace] = (await (await request.get(rest(`workspaces?slug=eq.${SLUG_ARRIVEE}&select=id`), { headers: enTetesService() })).json()) as { id: string }[]
	if (espace !== undefined) await rpc(request, sabine, 'plateforme_supprimer_espace', { p_id: espace.id, p_slug_confirme: SLUG_ARRIVEE })
}

test.beforeAll(async ({ request }) => {
	await nettoyer(request)
	const sabine = await jetonDe(SABINE)
	const creation = await rpc(request, sabine, 'plateforme_creer_espace', { p_nom: NOM_ARRIVEE, p_slug: SLUG_ARRIVEE, p_domaine_entrant: null })
	expect(creation.ok(), await creation.text()).toBe(true)
	arrivee = ((await (await request.get(rest(`workspaces?slug=eq.${SLUG_ARRIVEE}&select=id`), { headers: enTetesService() })).json()) as { id: string }[])[0]!.id
	const service = json({ ...enTetesService(), Prefer: 'return=representation' })
	const t = await request.post(rest('tracks'), { headers: service, data: { workspace_id: ESPACE, name: NOM_TRACK, slug: 'sonde-162-ecran', position: 91 } })
	expect(t.status(), await t.text()).toBe(201)
	track = ((await t.json()) as { id: string }[])[0]!.id
	const c = await request.post(rest('channels'), {
		headers: service,
		data: { workspace_id: ESPACE, track_id: track, name: 'Sonde écran', slug: 'sonde-ecran', workflow_id: WORKFLOW_PAR_DEFAUT, position: 1 },
	})
	expect(c.status(), await c.text()).toBe(201)
	const idChannel = ((await c.json()) as { id: string }[])[0]!.id
	const a = await rpc(request, await jetonDe(CAMILLE.adresse), 'creer_affaire', { p_channel: idChannel, p_titre: 'Sonde 162 — affaire écran' })
	expect(a.status(), await a.text()).toBe(200)
	affaire = (await a.json()) as string
})

test.afterAll(async ({ request }) => {
	await nettoyer(request)
})

const ligneTrack = (page: Page) => page.getByTestId('ligne-track').filter({ hasText: NOM_TRACK })
const bloc = (page: Page) => page.getByTestId('bloc-deplacement')

async function ouvrirLeDeplacement(page: Page): Promise<void> {
	await page.goto('/plateforme/espaces/p2enjoy')
	await expect(ligneTrack(page)).toBeVisible()
	await ligneTrack(page).getByRole('button', { name: `Déplacer le track ${NOM_TRACK} vers un autre espace` }).click()
	await expect(bloc(page)).toBeVisible()
	await bloc(page).getByLabel('Espace d’arrivée').selectOption({ label: NOM_ARRIVEE })
	await expect(bloc(page).getByTestId('apercu-deplacement')).toBeVisible()
}

test.describe('déplacer un track vers un autre espace (docs/DESIGN_SYSTEM.md §5.112)', () => {
	test('les refus : Camille n’est pas membre de l’arrivée ; listée, et aucune commande de déplacement', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE)
		await ouvrirLeDeplacement(page)
		const refus = bloc(page).getByTestId('refus-deplacement')
		await expect(refus).toContainText(`Personnes qui ne sont pas membres de ${NOM_ARRIVEE}`)
		await expect(refus).toContainText('Camille Aubert')
		await expect(bloc(page).getByTestId('confirmer-deplacement')).toHaveCount(0)
		await bloc(page).scrollIntoViewIfNeeded()
		await capturer(page, 'deplacement-refus-1440', UNITE)
	})

	test('à la souris : l’aperçu chiffré, la saisie du nom, le déplacement, le track à l’arrivée', async ({ page, request }) => {
		const membre = await rpc(request, await jetonDe(SABINE), 'plateforme_poser_membre', { p_ws: arrivee, p_user: CAMILLE.id, p_role: 'admin' })
		expect(membre.ok(), await membre.text()).toBe(true)
		await connecterAvecLeLabs(page, SABINE)
		await ouvrirLeDeplacement(page)
		await expect(bloc(page).getByTestId('compte-affaires')).toHaveText('1')
		await expect(bloc(page).getByTestId('adresses-sans-domaine')).toBeVisible()
		const confirmer = bloc(page).getByTestId('confirmer-deplacement')
		await expect(confirmer).toBeDisabled()
		await bloc(page).getByTestId('saisie-nom-track').fill(NOM_TRACK)
		await expect(confirmer).toBeEnabled()
		await bloc(page).scrollIntoViewIfNeeded()
		await capturer(page, 'deplacement-apercu-1440', UNITE)
		await confirmer.click()
		const message = page.getByTestId('message-tracks')
		await expect(message).toContainText(`Track « ${NOM_TRACK} » déplacé vers ${NOM_ARRIVEE}.`)
		await expect(ligneTrack(page)).toHaveCount(0)
		await capturer(page, 'deplacement-fait-1440', UNITE)

		// Le message mène à la fiche de l'espace d'arrivée, où le track est listé.
		await message.getByRole('link', { name: `Ouvrir la fiche de ${NOM_ARRIVEE}` }).click()
		await expect(page).toHaveURL(new RegExp(`/plateforme/espaces/${SLUG_ARRIVEE}$`))
		await expect(ligneTrack(page)).toBeVisible()
	})

	test('le journal de la plateforme dit le geste', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE)
		await page.goto('/plateforme/journal')
		const ligne = page.getByTestId('ligne-journal').filter({ hasText: NOM_TRACK }).first()
		await expect(ligne).toContainText('Track déplacé')
		await expect(ligne).toContainText(`« ${NOM_TRACK} » : P2Enjoy SAS → ${NOM_ARRIVEE}`)
	})

	test('l’historique de l’affaire dit le déplacement', async ({ page }) => {
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		await page.goto(`/tracks/sonde-162-ecran/sonde-ecran/cards/${affaire}`)
		await expect(page.getByText('Déplacée avec son track')).toBeVisible()
	})

	test('l’ancienne adresse du track mène à l’actuelle, channel compris, sans entrée d’historique', async ({ page }) => {
		await connecterAvecLeLabs(page, CAMILLE.adresse)
		const avant = await page.evaluate(() => window.history.length)
		await page.goto('/p2enjoy/tracks/sonde-162-ecran/sonde-ecran?vue=board')
		await expect(page).toHaveURL(new RegExp(`/${SLUG_ARRIVEE}/tracks/sonde-162-ecran/sonde-ecran\\?vue=board$`))
		await expect(page.getByText('Sonde 162 — affaire écran')).toBeVisible()
		// `replace` : la visite ajoute une entrée, la redirection aucune — « Précédent » ne ramène pas à l'ancienne adresse.
		expect(await page.evaluate(() => window.history.length)).toBe(avant + 1)
	})

	test('qui n’est pas membre de l’arrivée reste sur « introuvable » : l’adresse actuelle ne lui est pas révélée', async ({ page }) => {
		await connecterAvecLeLabs(page, DRISS)
		await page.goto('/p2enjoy/tracks/sonde-162-ecran')
		await expect(page.getByText('Track introuvable')).toBeVisible()
		await expect(page).toHaveURL(/\/p2enjoy\/tracks\/sonde-162-ecran$/)
	})

	test('au clavier : Tab jusqu’à la commande, Entrée l’ouvre, Échap referme et rend le focus', async ({ page, request }) => {
		// Le track revient au départ pour être de nouveau déplaçable depuis la fiche du seed.
		const retour = await rpc(request, await jetonDe(SABINE), 'move_track', { p_track_id: track, p_target_workspace_id: ESPACE, p_confirm_name: NOM_TRACK })
		expect(retour.status(), await retour.text()).toBe(200)
		await connecterAvecLeLabs(page, SABINE)
		await page.goto('/plateforme/espaces/p2enjoy')
		const commande = ligneTrack(page).getByRole('button', { name: `Déplacer le track ${NOM_TRACK} vers un autre espace` })
		await commande.focus()
		await page.keyboard.press('Enter')
		const choix = bloc(page).getByLabel('Espace d’arrivée')
		await expect(choix).toBeFocused()
		await choix.selectOption({ label: NOM_ARRIVEE })
		await bloc(page).getByTestId('saisie-nom-track').focus()
		await page.keyboard.type(NOM_TRACK)
		await expect(bloc(page).getByTestId('confirmer-deplacement')).toBeEnabled()
		await page.keyboard.press('Escape')
		await expect(bloc(page)).toHaveCount(0)
		await expect(commande).toBeFocused()
	})

	test('les quatre paliers : l’aperçu passe à la ligne, la page ne défile jamais de côté', async ({ page }) => {
		await connecterAvecLeLabs(page, SABINE)
		for (const palier of PALIERS) {
			await page.setViewportSize({ width: palier.largeur, height: palier.hauteur })
			await ouvrirLeDeplacement(page)
			await bloc(page).scrollIntoViewIfNeeded()
			const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
			expect(debordement, `aucun défilement horizontal à ${palier.largeur} px`).toBeLessThanOrEqual(0)
			await capturer(page, `deplacement-apercu-${palier.nom}`, UNITE)
		}
	})
})
