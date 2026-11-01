// @verifies CRM-111 (docs/BACKLOG.md) — tranche T3 : rattacher et retirer, par l'API, avec les jetons réels du seed
// @verifies docs/SPEC-rattachements.md §4 (« Rattacher », « Retirer », un rattachement illisible masqué, la partie
//           commune écrite par un channel), §5 (`attach_card`, `detach_card`, `attached`, `detached`) ;
//           docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors interface)
//
// Tout se joue sur une affaire JETABLE de `refonte`, posée par la clé de service et retirée en fin de fichier : le fil
// est en ajout seul, et des `attached` laissés sur une affaire du seed fausseraient les comptes d'autres preuves.
// L'administratrice la rattache à `grands-comptes` (fermé à la lectrice) puis à `maintenance` (que le business developer
// lit sans l'écrire) ; chaque refus est prouvé par la vraie route, puis constaté en base.

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { posterAffaire } from '../affaire'
import { COMPTES_SEED, URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0].adresse
const BIZDEV = COMPTES_SEED[1].adresse
const LECTRICE = COMPTES_SEED[2].adresse

const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const ETAPE_INITIALE = '5eed0000-0000-4000-8000-000000000061'
const GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const REFONTE = '5eed0000-0000-4000-8000-000000000034'
const MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
type Rattachement = { id: string; channel_id: string; current_step_id: string; archived_at: string | null }
type Refus = { code: string; message: string }

const AFFAIRE = randomUUID()

async function rattacher(requete: APIRequestContext, jeton: string, channel: string) {
	return requete.post(rest('rpc/attach_card'), {
		headers: enTetesAuthentifies(jeton),
		data: { p_card: AFFAIRE, p_channel: channel },
	})
}

async function rattachementsEnBase(requete: APIRequestContext): Promise<Rattachement[]> {
	const lus = await requete.get(rest(`card_placements?card_id=eq.${AFFAIRE}&select=id,channel_id,current_step_id,archived_at`), {
		headers: enTetesService(),
	})
	expect(lus.status()).toBe(200)
	return (await lus.json()) as Rattachement[]
}

test.describe.configure({ mode: 'serial' })

test.describe('CRM-111 T3 — rattacher et retirer par l’API', () => {
	test.beforeAll(async ({ request }) => {
		const pose = await posterAffaire(request, rest('cards'), {
			headers: { ...enTetesService(), Prefer: 'return=representation' },
			data: {
				id: AFFAIRE,
				workspace_id: ESPACE,
				channel_id: REFONTE,
				workflow_id: WORKFLOW_GLOBAL,
				current_step_id: ETAPE_INITIALE,
				title: 'Sonde T3 — rattacher et retirer',
			},
		})
		expect(pose.status(), await pose.text()).toBe(201)
	})

	test.afterAll(async ({ request }) => {
		const retrait = await request.delete(rest(`cards?id=eq.${AFFAIRE}`), { headers: enTetesService() })
		expect(retrait.status(), 'l’affaire jetable est retirée, son fil avec elle').toBe(204)
	})

	test('le business developer ne rattache pas à un channel qu’il lit sans l’écrire : 403, rien en base', async ({ request }) => {
		const reponse = await rattacher(request, await jetonDe(BIZDEV), MAINTENANCE)
		expect(reponse.status()).toBe(403)
		expect(((await reponse.json()) as Refus).message).toBe('forbidden')
		expect((await rattachementsEnBase(request)).map((r) => r.channel_id)).toEqual([REFONTE])
	})

	test('l’anonyme est refusé par le privilège', async ({ request }) => {
		const reponse = await request.post(rest('rpc/attach_card'), {
			headers: enTetesAnonymes(),
			data: { p_card: AFFAIRE, p_channel: GRANDS_COMPTES },
		})
		expect([401, 403]).toContain(reponse.status())
	})

	test('l’administratrice rattache à `grands-comptes`, à l’étape initiale, et le fil dit `attached`', async ({ request }) => {
		const reponse = await rattacher(request, await jetonDe(ADMIN), GRANDS_COMPTES)
		expect(reponse.status(), await reponse.text()).toBe(200)
		const pose = (await reponse.json()) as Rattachement
		expect(pose.channel_id).toBe(GRANDS_COMPTES)
		expect(pose.current_step_id).toBe(ETAPE_INITIALE)
		expect((await rattachementsEnBase(request)).map((r) => r.channel_id).sort()).toEqual([GRANDS_COMPTES, REFONTE].sort())

		const fil = await request.get(rest(`card_events?card_id=eq.${AFFAIRE}&type=eq.attached&select=placement_id`), {
			headers: enTetesService(),
		})
		expect(await fil.json()).toEqual([{ placement_id: pose.id }])

		const encore = await rattacher(request, await jetonDe(ADMIN), GRANDS_COMPTES)
		expect(encore.status()).toBe(400)
		expect(((await encore.json()) as Refus).message).toBe('already_attached')
	})

	test('la lectrice lit l’affaire par `refonte`, et ne voit pas son rattachement à `grands-comptes`', async ({ request }) => {
		const h = enTetesAuthentifies(await jetonDe(LECTRICE))
		const affaire = await request.get(rest(`cards?id=eq.${AFFAIRE}&select=id`), { headers: h })
		expect(await affaire.json()).toEqual([{ id: AFFAIRE }])
		const siens = await request.get(rest(`card_placements?card_id=eq.${AFFAIRE}&select=channel_id`), { headers: h })
		expect(siens.status(), 'un refus de POLITIQUE : un filtrage, non une erreur').toBe(200)
		expect(await siens.json(), 'le rattachement d’un channel fermé est masqué, existence comprise').toEqual([
			{ channel_id: REFONTE },
		])
	})

	test('le business developer écrit la partie commune par `refonte`, et pas le bloc de `maintenance`', async ({ request }) => {
		const admin = await rattacher(request, await jetonDe(ADMIN), MAINTENANCE)
		expect(admin.status(), await admin.text()).toBe(200)
		const h = { ...enTetesAuthentifies(await jetonDe(BIZDEV)), Prefer: 'return=representation' }

		const commune = await request.patch(rest(`cards?id=eq.${AFFAIRE}`), { headers: h, data: { description: 'Sonde T3' } })
		expect(commune.status(), await commune.text()).toBe(200)
		expect(await commune.json(), 'la partie commune s’écrit : un channel rattaché écrit suffit (§4)').toHaveLength(1)

		const bloc = await request.patch(rest(`card_placements?card_id=eq.${AFFAIRE}&channel_id=eq.${MAINTENANCE}`), {
			headers: h,
			data: { amount: 1 },
		})
		expect(bloc.status(), 'un refus de POLITIQUE : un filtrage, non une erreur').toBe(200)
		expect(await bloc.json(), 'le bloc de `maintenance`, qu’il ne fait que lire, ne s’écrit pas').toEqual([])
	})

	test('seule l’administratrice retire, jamais le dernier, et le fil dit `detached`', async ({ request }) => {
		const enBase = await rattachementsEnBase(request)
		const deMaintenance = enBase.find((r) => r.channel_id === MAINTENANCE)!
		const corps = { p_placement: deMaintenance.id }

		const parBizdev = await request.post(rest('rpc/detach_card'), {
			headers: enTetesAuthentifies(await jetonDe(BIZDEV)),
			data: corps,
		})
		expect(parBizdev.status()).toBe(403)
		expect((await rattachementsEnBase(request)).length, 'rien n’est retiré').toBe(3)

		const jetonAdmin = await jetonDe(ADMIN)
		for (const r of enBase.filter((r) => r.channel_id !== REFONTE)) {
			const retrait = await request.post(rest('rpc/detach_card'), {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { p_placement: r.id },
			})
			expect(retrait.status(), await retrait.text()).toBe(204)
		}
		expect((await rattachementsEnBase(request)).map((r) => r.channel_id)).toEqual([REFONTE])

		const fil = await request.get(rest(`card_events?card_id=eq.${AFFAIRE}&type=eq.detached&select=placement_id`), {
			headers: enTetesService(),
		})
		expect(((await fil.json()) as { placement_id: string }[]).map((e) => e.placement_id).sort()).toEqual(
			enBase.filter((r) => r.channel_id !== REFONTE).map((r) => r.id).sort(),
		)

		const dernier = (await rattachementsEnBase(request))[0]!
		const refus = await request.post(rest('rpc/detach_card'), {
			headers: enTetesAuthentifies(jetonAdmin),
			data: { p_placement: dernier.id },
		})
		expect(refus.status()).toBe(400)
		expect(((await refus.json()) as Refus).message).toBe('last_placement')
	})
})
