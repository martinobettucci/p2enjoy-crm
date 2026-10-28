// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.0 : un rattachement s'écrit par l'API si son channel s'écrit, et
//           l'affaire suit ; la timeline n'écrit qu'un événement ; tranche T2.3.2 : ces colonnes sont fermées sur `cards`
// @verifies docs/SPEC-rattachements.md §4 (écrire un rattachement, c'est écrire son channel), §5 (timeline), §14 ;
//           docs/JOURNAL.md décision 705
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors interface)
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.4.5 : les colonnes ont quitté l'affaire (migration 0134) ; le
//           rattachement est la seule ligne écrite, et nommer une colonne retirée sur `cards` est refusé
//           (docs/SPEC-rattachements.md §3.2)
//
// Avec les jetons réels du seed : le business developer écrit le rattachement d'une affaire de `refonte`, qu'il écrit ; sur Maintenance, où il n'est que `viewer`, son écriture ne touche rien — un refus de POLITIQUE,
// qui filtre sans erreur. Archiver un rattachement écrit UN événement `archived`, qui le désigne. Les écritures sur une
// affaire du seed sont restituées dans un `finally` ; l'archivage se joue sur une affaire jetable, retirée ensuite.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0].adresse
const BIZDEV = COMPTES_SEED[1].adresse

/** `…0c4`, dans `refonte`, que le business developer écrit ; `…0c5`, dans Maintenance, qu'il lit sans l'écrire. */
const CARD_C4 = '5eed0000-0000-4000-8000-0000000000c4'
const CARD_C5 = '5eed0000-0000-4000-8000-0000000000c5'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'

type Ligne = Record<string, unknown>

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lire(requete: APIRequestContext, chemin: string): Promise<Ligne[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as Ligne[]
}

/** La prochaine action de l'affaire, celle de son rattachement (`CRM-111` T2.4.5 : l'affaire ne la porte plus). */
async function prochaineAction(requete: APIRequestContext, idCard: string): Promise<unknown> {
	const [rattachement] = await lire(requete, `card_placements?card_id=eq.${idCard}&select=next_action`)
	if (rattachement === undefined) throw new Error(`${idCard} : le seed est-il appliqué ?`)
	return rattachement['next_action']
}

test.describe('CRM-111 T2.3.0 — écrire un rattachement par l’API', () => {
	test('le business developer écrit le rattachement d’un channel qu’il écrit', async ({ request }) => {
		const h = enTetesAuthentifies(await jetonDe(BIZDEV))
		const origine = await prochaineAction(request, CARD_C4)
		try {
			const reponse = await request.patch(rest(`card_placements?card_id=eq.${CARD_C4}`), {
				headers: { ...h, Prefer: 'return=representation' },
				data: { next_action: 'Sonde T2.3.0 — rappeler' },
			})
			expect(reponse.status(), await reponse.text()).toBe(200)
			expect(await reponse.json(), 'une ligne écrite').toHaveLength(1)
			expect(await prochaineAction(request, CARD_C4)).toBe('Sonde T2.3.0 — rappeler')
		} finally {
			const restitution = await request.patch(rest(`card_placements?card_id=eq.${CARD_C4}`), {
				headers: enTetesService(),
				data: { next_action: origine },
			})
			expect(restitution.status(), 'la valeur seedée est restituée').toBe(204)
		}
		expect(await prochaineAction(request, CARD_C4)).toEqual(origine)
	})

	test('sur un channel qu’il lit sans l’écrire, son écriture ne touche rien, sans erreur', async ({ request }) => {
		const h = enTetesAuthentifies(await jetonDe(BIZDEV))
		const origine = await prochaineAction(request, CARD_C5)
		const reponse = await request.patch(rest(`card_placements?card_id=eq.${CARD_C5}`), {
			headers: { ...h, Prefer: 'return=representation' },
			data: { next_action: 'interdit' },
		})
		expect(reponse.status(), 'refus de POLITIQUE : un filtrage, non une erreur').toBe(200)
		expect(await reponse.json(), 'aucune ligne écrite').toEqual([])
		expect(await prochaineAction(request, CARD_C5), 'le rattachement n’a pas changé').toEqual(origine)
	})

	// RÉVISÉ PAR `CRM-111` T2.4.5 (décision 51) : fermées par privilège depuis T2.3.2, les sept colonnes sont désormais
	// RETIRÉES de l'affaire ; le refus n'est plus celui du privilège (`403` / `42501`) mais celui du schéma (`400` /
	// `PGRST204`), avant toute écriture.
	test('T2.4.5 — les sept colonnes de rattachement ont quitté l’affaire : un refus du schéma, la ligne intacte', async ({
		request,
	}) => {
		const h = enTetesAuthentifies(await jetonDe(ADMIN))
		const origine = await prochaineAction(request, CARD_C4)
		for (const charge of [
			{ next_action: 'interdit' },
			{ owner_id: null },
			{ amount: 1 },
			{ probability_override: 10 },
			{ next_action_at: null },
			{ position: 1 },
			{ archived_at: new Date().toISOString() },
		]) {
			const reponse = await request.patch(rest(`cards?id=eq.${CARD_C4}`), { headers: h, data: charge })
			expect(reponse.status(), `${Object.keys(charge)[0]} : refus du SCHÉMA, non un filtrage`).toBe(400)
			expect(((await reponse.json()) as { code: string }).code).toBe('PGRST204')
		}
		expect(await prochaineAction(request, CARD_C4), 'rien n’a changé').toEqual(origine)
	})

	test('archiver un rattachement écrit UN événement `archived`, qui le désigne', async ({ request }) => {
		const h = enTetesAuthentifies(await jetonDe(ADMIN))
		const creation = await request.post(rest('rpc/creer_affaire'), {
			headers: h,
			data: { p_channel: CHANNEL_GRANDS_COMPTES, p_titre: 'Sonde T2.3.0 — archivage par l’API' },
		})
		expect(creation.status(), await creation.text()).toBe(200)
		const idCard = (await creation.json()) as string
		try {
			const [rattachement] = await lire(request, `card_placements?card_id=eq.${idCard}&select=id`)
			const archivage = await request.patch(rest(`card_placements?card_id=eq.${idCard}`), {
				headers: h,
				data: { archived_at: new Date().toISOString() },
			})
			expect(archivage.status(), await archivage.text()).toBe(204)
			const evenements = await lire(
				request,
				`card_events?card_id=eq.${idCard}&type=neq.created&select=type,placement_id&order=created_at,id`,
			)
			expect(evenements).toEqual([{ type: 'archived', placement_id: rattachement?.['id'] }])
			const [relu] = await lire(request, `card_placements?card_id=eq.${idCard}&select=archived_at`)
			expect(relu?.['archived_at'], 'le rattachement est archivé').not.toBeNull()
		} finally {
			const retrait = await request.delete(rest(`cards?id=eq.${idCard}`), { headers: enTetesService() })
			expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
		}
	})
})
