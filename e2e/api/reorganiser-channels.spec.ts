// @verifies CRM-154 (docs/BACKLOG.md) — tranche T2 : `public.reorder_channels` par la vraie route, avec les vrais jetons
// @verifies docs/SPEC-administration-arborescence.md §15.2 (les refus (a) à (d), l'appel annulé en entier, les
//           privilèges) ; docs/SCHEMA.md « Migration `0187` » ; docs/JOURNAL.md décisions 935 et 938
// @verifies CLAUDE.md §10 (une règle d'accès se prouve hors interface, avec les droits réels du profil)
//
// `supabase/tests/0175_reorganiser_channels.test.sql` prouve la règle EN BASE, sous des rôles endossés. Ce fichier
// prouve qu'elle tient PAR LA ROUTE : la fonction présente au cache de schéma, `anon` refusé par le privilège (`401`),
// le business developer et la lectrice refusés par la politique (`403`), chaque refus suivi d'une RELECTURE des
// positions.
//
// IL ÉCRIT, ET REND LE SEED INTACT : l'ordre de « Studio web » est reposé quoi qu'il arrive (`afterAll`), et le dernier
// test constate qu'il est celui du seed.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const CHANNELS = '/rest/v1/channels'
const RPC = '/rest/v1/rpc/reorder_channels'

/** « Studio web » et ses trois channels actifs du seed, dans leur ordre nominal. */
const TRACK_STUDIO_WEB = '5eed0000-0000-4000-8000-000000000022'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'
const CHECKLISTS = '5eed0000-0000-4000-8000-0000000c6841'
const ORDRE_DU_SEED = [REFONTE, MAINTENANCE, CHECKLISTS]

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

/** L'ordre réel des channels actifs du track, relu par la route sous le jeton de l'administratrice. */
async function ordreReel(requete: APIRequestContext): Promise<string[]> {
	const reponse = await requete.get(
		`${CHANNELS}?select=id&track_id=eq.${TRACK_STUDIO_WEB}&archived_at=is.null&deleted_at=is.null&order=position,name`,
		{ headers: enTetesAuthentifies(jetonAdmin) },
	)
	expect(reponse.status(), 'relecture des channels').toBe(200)
	return ((await reponse.json()) as { id: string }[]).map((ligne) => ligne.id)
}

function appeler(requete: APIRequestContext, entetes: Record<string, string>, ordre: readonly string[]) {
	return requete.post(RPC, {
		headers: { ...entetes, 'Content-Type': 'application/json' },
		data: { p_track_id: TRACK_STUDIO_WEB, p_channel_ids: ordre },
	})
}

test.afterAll(async ({ request }) => {
	await appeler(request, enTetesAuthentifies(jetonAdmin), ORDRE_DU_SEED)
})

test.describe('CRM-154 — `public.reorder_channels` par la route (§15.2)', () => {
	test('avant tout : l’ordre de « Studio web » est celui du seed', async ({ request }) => {
		expect(await ordreReel(request)).toEqual(ORDRE_DU_SEED)
	})

	test('un appelant ANONYME est refusé par le privilège : 401, ordre inchangé', async ({ request }) => {
		const reponse = await appeler(request, enTetesAnonymes(), [CHECKLISTS, REFONTE, MAINTENANCE])
		expect(reponse.status()).toBe(401)
		expect(await ordreReel(request)).toEqual(ORDRE_DU_SEED)
	})

	test('le BUSINESS DEVELOPER est refusé par la politique : 403 channel_reorder_forbidden, ordre inchangé', async ({
		request,
	}) => {
		const reponse = await appeler(request, enTetesAuthentifies(jetonBizdev), [CHECKLISTS, REFONTE, MAINTENANCE])
		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('42501')
		expect(corps.message).toBe('channel_reorder_forbidden')
		expect(await ordreReel(request)).toEqual(ORDRE_DU_SEED)
	})

	test('la LECTRICE est refusée : 403 channel_reorder_forbidden, ordre inchangé', async ({ request }) => {
		const reponse = await appeler(request, enTetesAuthentifies(jetonViewer), [CHECKLISTS, REFONTE, MAINTENANCE])
		expect(reponse.status()).toBe(403)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('42501')
		expect(corps.message).toBe('channel_reorder_forbidden')
		expect(await ordreReel(request)).toEqual(ORDRE_DU_SEED)
	})

	test('une liste INCOMPLÈTE est refusée : 400 channel_order_incomplete, ordre inchangé', async ({ request }) => {
		const reponse = await appeler(request, enTetesAuthentifies(jetonAdmin), [CHECKLISTS, REFONTE])
		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as { code: string; message: string }
		expect(corps.code).toBe('23514')
		expect(corps.message).toBe('channel_order_incomplete')
		expect(await ordreReel(request)).toEqual(ORDRE_DU_SEED)
	})

	test('l’ADMINISTRATRICE réordonne : 200 et 3, l’ordre relu est celui envoyé, puis l’ordre du seed revient', async ({
		request,
	}) => {
		const nouvel = [CHECKLISTS, REFONTE, MAINTENANCE]
		const aller = await appeler(request, enTetesAuthentifies(jetonAdmin), nouvel)
		expect(aller.status()).toBe(200)
		expect(await aller.json()).toBe(3)
		expect(await ordreReel(request)).toEqual(nouvel)

		const retour = await appeler(request, enTetesAuthentifies(jetonAdmin), ORDRE_DU_SEED)
		expect(retour.status()).toBe(200)
		expect(await ordreReel(request)).toEqual(ORDRE_DU_SEED)
	})
})
