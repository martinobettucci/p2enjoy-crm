// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.2 : les tables filles désignent le rattachement, prouvé par l'API avec
//           les jetons réels du seed
// @verifies docs/SPEC-rattachements.md §3.3 (valeurs par rattachement), §4 (lire une affaire, c'est lire un de ses
//           rattachements), §5 (timeline, décision 670) ; docs/JOURNAL.md décision 705
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors interface)
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.6 : la clé des valeurs est `(placement_id, field_id)` (docs/SPEC-rattachements.md §3.3)
//
// Une valeur écrite SANS rattachement — `upsert` sur la clé `(placement_id, field_id)` depuis T2.3.6 — en reçoit un,
// celui de son affaire ; l'événement `field_changed` qu'elle produit le désigne aussi ; la création, événement de
// l'affaire, n'en désigne aucun. L'affaire est jetable, créée par `creer_affaire` et retirée par la clé de service. La
// lectrice, enfin, ne lit ni l'affaire du seed ni la timeline d'un channel qui lui est fermé.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0].adresse
const VIEWER = COMPTES_SEED[2].adresse

/** `grands-comptes`, du track que le seed ferme à la lectrice (`docs/SPEC-seed.md` §2.11), et `…0c1`, qui y vit. */
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const CARD_C1 = '5eed0000-0000-4000-8000-0000000000c1'

type Ligne = Record<string, unknown>

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

async function lignes(requete: APIRequestContext, chemin: string, enTetes: Record<string, string>): Promise<Ligne[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetes })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as Ligne[]
}

/** Le rattachement de l'affaire, lu avec la clé de service : la référence, jamais la preuve d'un refus. */
async function rattachementDe(requete: APIRequestContext, idCard: string): Promise<string> {
	const [ligne] = await lignes(requete, `card_placements?card_id=eq.${idCard}&select=id`, enTetesService())
	if (ligne === undefined) throw new Error(`${idCard} : aucun rattachement — la migration 0108 est-elle appliquée ?`)
	return ligne['id'] as string
}

test.describe('CRM-111 T2.2 — les tables filles désignent le rattachement', () => {
	test('une valeur écrite comme l’écrit la webapp reçoit le rattachement de son affaire, et son événement aussi', async ({
		request,
	}) => {
		const h = enTetesAuthentifies(await jetonDe(ADMIN))
		// Une affaire JETABLE, créée par le vrai geste : la timeline d'une affaire du seed est immuable, et une sonde y
		// laisserait ses événements. Sa suppression par la clé de service emporte valeurs et événements en cascade.
		const creation = await request.post(rest('rpc/creer_affaire'), {
			headers: h,
			data: { p_channel: CHANNEL_GRANDS_COMPTES, p_titre: 'Sonde T2.2 — valeur par l’API' },
		})
		expect(creation.status(), await creation.text()).toBe(200)
		const idCard = (await creation.json()) as string
		try {
			const [carte] = await lignes(request, `cards?id=eq.${idCard}&select=workflow_id,workspace_id`, h)
			if (carte === undefined) throw new Error('l’affaire créée ne se relit pas')
			const [champ] = await lignes(
				request,
				`form_fields?workflow_id=eq.${carte['workflow_id'] as string}&type=eq.textarea&archived_at=is.null&select=id&order=id&limit=1`,
				h,
			)
			if (champ === undefined) throw new Error('aucun champ « textarea » dans le workflow de `grands-comptes`')
			const attendu = await rattachementDe(request, idCard)

			const ecriture = await request.post(rest('card_field_values?on_conflict=placement_id,field_id'), {
				headers: { ...h, Prefer: 'resolution=merge-duplicates,return=representation' },
				data: {
					card_id: idCard,
					field_id: champ['id'],
					workflow_id: carte['workflow_id'],
					workspace_id: carte['workspace_id'],
					value: 'Sonde T2.2 — par l’API',
				},
			})
			expect(ecriture.status(), await ecriture.text()).toBe(201)
			const [valeur] = (await ecriture.json()) as Ligne[]
			expect(valeur?.['placement_id'], 'le rattachement est posé par la base, non par l’appelant').toBe(attendu)

			const [evenement] = await lignes(
				request,
				`card_events?card_id=eq.${idCard}&type=eq.field_changed&select=placement_id&order=created_at.desc,id.desc&limit=1`,
				h,
			)
			expect(evenement?.['placement_id'], '`field_changed` désigne le même rattachement').toBe(attendu)
			const crees = await lignes(request, `card_events?card_id=eq.${idCard}&type=eq.created&select=placement_id`, h)
			expect(crees, 'la création, événement de l’affaire, n’en désigne aucun').toEqual([{ placement_id: null }])
		} finally {
			const retrait = await request.delete(rest(`cards?id=eq.${idCard}`), { headers: enTetesService() })
			expect(retrait.status(), 'l’affaire jetable est retirée').toBe(204)
		}
	})

	test('la lectrice ne lit ni l’affaire ni la timeline d’un channel qui lui est fermé', async ({ request }) => {
		const h = enTetesAuthentifies(await jetonDe(VIEWER))
		expect(await lignes(request, `cards?id=eq.${CARD_C1}&select=id`, h)).toEqual([])
		expect(await lignes(request, `card_events?card_id=eq.${CARD_C1}&select=id`, h)).toEqual([])
		expect(await lignes(request, `card_field_values?card_id=eq.${CARD_C1}&select=field_id`, h)).toEqual([])
	})
})
