// @verifies CRM-162 (docs/BACKLOG.md) — tranche T1 : déplacer un track entier d'un espace à un autre, sur la vraie base
//           et sous les vrais jetons — l'aperçu et le déplacement réservés au super-administrateur (l'administratrice des
//           deux espaces refusée par requête directe), l'aperçu chiffré sans refus, la confirmation par le nom, le
//           déplacement, la redirection de l'ancienne adresse du track, et le déplacement inverse
// @verifies docs/SPEC-deplacement-track.md §2, §5, §6, §11, §12, §15 (preuve d'API) ; CLAUDE.md §10, §15
//
// TOUT EST PROPRE À LA PREUVE : un espace d'arrivée créé par la fonction de la plateforme sous le jeton de la
// super-administratrice, un track « Sonde 162 » dans l'espace du seed (un channel au workflow par défaut, une affaire créée
// par Camille par le vrai chemin). Le track revient à son espace avant la fin ; l'espace jetable est supprimé par la
// fonction de la plateforme. Les affaires du seed ne sont jamais déplacées.

import { type APIRequestContext, expect, test } from '@playwright/test'
import { URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const CAMILLE = { adresse: 'admin@p2enjoy.test', id: '5eed0000-0000-4000-8000-000000000011' } as const
const SABINE = 'plateforme@p2enjoy.test'
const WORKFLOW_PAR_DEFAUT = '5eed0000-0000-4000-8000-000000000051'
const SLUG_ARRIVEE = 'sonde-162-api'
const NOM_TRACK = 'Sonde 162'
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const json = (entetes: Record<string, string>) => ({ ...entetes, 'Content-Type': 'application/json' })

test.describe.configure({ mode: 'serial' })

let arrivee = ''
let track = ''

async function rpc(request: APIRequestContext, jeton: string, nom: string, corps: object) {
	return request.post(rest(`rpc/${nom}`), { headers: json(enTetesAuthentifies(jeton)), data: corps })
}

async function espaceDuTrack(request: APIRequestContext): Promise<string> {
	const reponse = await request.get(rest(`tracks?id=eq.${track}&select=workspace_id`), { headers: enTetesService() })
	return ((await reponse.json()) as { workspace_id: string }[])[0]!.workspace_id
}

async function nettoyer(request: APIRequestContext): Promise<void> {
	const sabine = await jetonDe(SABINE)
	const existant = await request.get(rest(`workspaces?slug=eq.${SLUG_ARRIVEE}&select=id`), { headers: enTetesService() })
	const [espace] = (await existant.json()) as { id: string }[]
	const tracks = await request.get(rest(`tracks?name=eq.${encodeURIComponent(NOM_TRACK)}&select=id,workspace_id`), {
		headers: enTetesService(),
	})
	for (const t of (await tracks.json()) as { id: string; workspace_id: string }[]) {
		// Un track resté à l'arrivée après un échec revient d'abord : la suppression de l'espace ne l'emporte jamais.
		if (t.workspace_id !== ESPACE) await rpc(request, sabine, 'move_track', { p_track_id: t.id, p_target_workspace_id: ESPACE, p_confirm_name: NOM_TRACK })
		await request.delete(rest(`cards?id=in.(${await cartesDuTrack(request, t.id)})`), { headers: enTetesService() })
		await request.delete(rest(`channels?track_id=eq.${t.id}`), { headers: enTetesService() })
		await request.delete(rest(`tracks?id=eq.${t.id}`), { headers: enTetesService() })
	}
	if (espace !== undefined) {
		const suppression = await rpc(request, sabine, 'plateforme_supprimer_espace', { p_id: espace.id, p_slug_confirme: SLUG_ARRIVEE })
		expect(suppression.ok(), await suppression.text()).toBe(true)
	}
}

async function cartesDuTrack(request: APIRequestContext, idTrack: string): Promise<string> {
	const canaux = await request.get(rest(`channels?track_id=eq.${idTrack}&select=id`), { headers: enTetesService() })
	const idsCanaux = ((await canaux.json()) as { id: string }[]).map((c) => c.id)
	if (idsCanaux.length === 0) return '00000000-0000-0000-0000-000000000000'
	const reponse = await request.get(rest(`card_placements?channel_id=in.(${idsCanaux.join(',')})&select=card_id`), {
		headers: enTetesService(),
	})
	const ids = ((await reponse.json()) as { card_id: string }[]).map((l) => l.card_id)
	return ids.length === 0 ? '00000000-0000-0000-0000-000000000000' : ids.join(',')
}

test.beforeAll(async ({ request }) => {
	await nettoyer(request)
	const sabine = await jetonDe(SABINE)
	const creation = await rpc(request, sabine, 'plateforme_creer_espace', { p_nom: 'Sonde 162 — arrivée', p_slug: SLUG_ARRIVEE, p_domaine_entrant: null })
	expect(creation.ok(), await creation.text()).toBe(true)
	const lu = await request.get(rest(`workspaces?slug=eq.${SLUG_ARRIVEE}&select=id`), { headers: enTetesService() })
	arrivee = ((await lu.json()) as { id: string }[])[0]!.id
	const membre = await rpc(request, sabine, 'plateforme_poser_membre', { p_ws: arrivee, p_user: CAMILLE.id, p_role: 'admin' })
	expect(membre.ok(), await membre.text()).toBe(true)

	const service = json({ ...enTetesService(), Prefer: 'return=representation' })
	const t = await request.post(rest('tracks'), { headers: service, data: { workspace_id: ESPACE, name: NOM_TRACK, slug: 'sonde-162', position: 90 } })
	expect(t.status(), await t.text()).toBe(201)
	track = ((await t.json()) as { id: string }[])[0]!.id
	const c = await request.post(rest('channels'), {
		headers: service,
		data: { workspace_id: ESPACE, track_id: track, name: 'Sonde', slug: 'sonde', workflow_id: WORKFLOW_PAR_DEFAUT, position: 1 },
	})
	expect(c.status(), await c.text()).toBe(201)
	const idChannel = ((await c.json()) as { id: string }[])[0]!.id
	const affaire = await rpc(request, await jetonDe(CAMILLE.adresse), 'creer_affaire', { p_channel: idChannel, p_titre: 'Sonde 162 — affaire' })
	expect(affaire.status(), await affaire.text()).toBe(200)
})

test.afterAll(async ({ request }) => {
	await nettoyer(request)
})

test('l’administratrice des deux espaces ne prévisualise ni ne déplace : super-administrateur seul', async ({ request }) => {
	const camille = await jetonDe(CAMILLE.adresse)
	const apercu = await rpc(request, camille, 'track_move_preview', { p_track_id: track, p_target_workspace_id: arrivee })
	expect(apercu.status(), await apercu.text()).toBe(403)
	const deplacement = await rpc(request, camille, 'move_track', { p_track_id: track, p_target_workspace_id: arrivee, p_confirm_name: NOM_TRACK })
	expect(deplacement.status(), await deplacement.text()).toBe(403)
	expect(await espaceDuTrack(request)).toBe(ESPACE)
})

test('l’aperçu chiffré : une affaire, aucun refus, le workflow apparié', async ({ request }) => {
	const apercu = await rpc(request, await jetonDe(SABINE), 'track_move_preview', { p_track_id: track, p_target_workspace_id: arrivee })
	expect(apercu.status(), await apercu.text()).toBe(200)
	const corps = (await apercu.json()) as {
		counts: { channels: number; cards: number }
		refusals: unknown[]
		referentials: Record<string, { reused: unknown[]; created: unknown[] }>
		to: { slug: string }
	}
	expect(corps.counts).toMatchObject({ channels: 1, cards: 1 })
	expect(corps.refusals).toEqual([])
	expect(corps.to.slug).toBe(SLUG_ARRIVEE)
	expect(Object.keys(corps.referentials)).toContain('workflow')
})

test('la confirmation par le nom : un nom qui diffère refuse, et rien ne bouge', async ({ request }) => {
	const reponse = await rpc(request, await jetonDe(SABINE), 'move_track', {
		p_track_id: track,
		p_target_workspace_id: arrivee,
		p_confirm_name: 'sonde 162',
	})
	expect(reponse.status(), await reponse.text()).toBe(400)
	expect(await reponse.json()).toMatchObject({ code: '22023', message: 'confirmation_mismatch' })
	expect(await espaceDuTrack(request)).toBe(ESPACE)
})

test('le déplacement, la redirection de l’ancienne adresse, puis le déplacement inverse', async ({ request }) => {
	const sabine = await jetonDe(SABINE)
	const aller = await rpc(request, sabine, 'move_track', { p_track_id: track, p_target_workspace_id: arrivee, p_confirm_name: NOM_TRACK })
	expect(aller.status(), await aller.text()).toBe(200)
	expect(await aller.json()).toMatchObject({ cards: 1, channels: 1, from: ESPACE, to: arrivee })
	expect(await espaceDuTrack(request)).toBe(arrivee)

	const adresse = await rpc(request, await jetonDe(CAMILLE.adresse), 'track_current_address', {
		p_workspace_slug: 'p2enjoy',
		p_track_slug: 'sonde-162',
	})
	expect(adresse.status(), await adresse.text()).toBe(200)
	expect(await adresse.json()).toEqual([{ workspace_slug: SLUG_ARRIVEE, track_slug: 'sonde-162' }])

	const retour = await rpc(request, sabine, 'move_track', { p_track_id: track, p_target_workspace_id: ESPACE, p_confirm_name: NOM_TRACK })
	expect(retour.status(), await retour.text()).toBe(200)
	expect(await espaceDuTrack(request)).toBe(ESPACE)
})
