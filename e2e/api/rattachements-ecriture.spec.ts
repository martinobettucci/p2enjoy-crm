// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.0 : un rattachement s'écrit par l'API si son channel s'écrit, et
//           l'affaire suit ; la timeline n'écrit qu'un événement
// @verifies docs/SPEC-rattachements.md §4 (écrire un rattachement, c'est écrire son channel), §5 (timeline), §14 ;
//           docs/JOURNAL.md décision 705
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors interface)
//
// Avec les jetons réels du seed : le business developer écrit le rattachement d'une affaire de `refonte`, qu'il écrit,
// et l'affaire suit ; sur Maintenance, où il n'est que `viewer`, son écriture ne touche rien — un refus de POLITIQUE,
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

async function prochaineAction(requete: APIRequestContext, idCard: string): Promise<{ affaire: unknown; rattachement: unknown }> {
	const [carte] = await lire(requete, `cards?id=eq.${idCard}&select=next_action`)
	const [rattachement] = await lire(requete, `card_placements?card_id=eq.${idCard}&select=next_action`)
	if (carte === undefined || rattachement === undefined) throw new Error(`${idCard} : le seed est-il appliqué ?`)
	return { affaire: carte['next_action'], rattachement: rattachement['next_action'] }
}

test.describe('CRM-111 T2.3.0 — écrire un rattachement par l’API', () => {
	test('le business developer écrit le rattachement d’un channel qu’il écrit, et l’affaire suit', async ({ request }) => {
		const h = enTetesAuthentifies(await jetonDe(BIZDEV))
		const origine = await prochaineAction(request, CARD_C4)
		try {
			const reponse = await request.patch(rest(`card_placements?card_id=eq.${CARD_C4}`), {
				headers: { ...h, Prefer: 'return=representation' },
				data: { next_action: 'Sonde T2.3.0 — rappeler' },
			})
			expect(reponse.status(), await reponse.text()).toBe(200)
			expect(await reponse.json(), 'une ligne écrite').toHaveLength(1)
			expect(await prochaineAction(request, CARD_C4), 'le miroir inverse a reporté l’écriture sur l’affaire').toEqual({
				affaire: 'Sonde T2.3.0 — rappeler',
				rattachement: 'Sonde T2.3.0 — rappeler',
			})
		} finally {
			const restitution = await request.patch(rest(`cards?id=eq.${CARD_C4}`), {
				headers: enTetesService(),
				data: { next_action: origine.affaire },
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
		expect(await prochaineAction(request, CARD_C5), 'ni le rattachement ni l’affaire n’ont changé').toEqual(origine)
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
			const [carte] = await lire(request, `cards?id=eq.${idCard}&select=archived_at`)
			expect(carte?.['archived_at'], 'l’affaire est archivée par le miroir inverse').not.toBeNull()
		} finally {
			const retrait = await request.delete(rest(`cards?id=eq.${idCard}`), { headers: enTetesService() })
			expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
		}
	})
})
