// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.1 : la table des rattachements, lue et refusée hors interface, avec
//           les jetons réels du seed
// @verifies docs/SPEC-rattachements.md §3.1 (la table), §4 (un rattachement se lit si son channel se lit), §14 (T2.1 :
//           `cards` reste le chemin d'écriture, son rattachement suit) ; docs/JOURNAL.md décision 705
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors interface)
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.0 : les colonnes fermées du rattachement le restent
//
// Tout part du SEED : chaque appelant voit exactement un rattachement par affaire qu'il lit, égal à elle ; la lectrice ne
// voit aucun rattachement d'un channel qui lui est fermé ; l'anonyme lit zéro ligne. PERSONNE n'écrit la table : ni le
// jeton de l'administratrice ni même la clé de service — c'est un refus de PRIVILÈGE (`403`, `42501`), et la ligne
// relue est inchangée. Une écriture de l'affaire par l'API, elle, est reportée dans son rattachement ; le scénario
// restitue la valeur seedée dans un `finally`.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0].adresse
const VIEWER = COMPTES_SEED[2].adresse

/** `grands-comptes`, du track « Conseil & IA » que le seed ferme à la lectrice (`docs/SPEC-seed.md` §2.11). */
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
/** `…0c4`, dans `refonte` : une affaire que la lectrice lit. */
const CARD_C4 = '5eed0000-0000-4000-8000-0000000000c4'

/** Les treize colonnes que l'affaire porte encore, et que son rattachement reprend (§3.1). */
const COLONNES = [
	'channel_id', 'workflow_id', 'current_step_id', 'position', 'owner_id', 'amount', 'probability_override',
	'next_action', 'next_action_at', 'entered_step_at', 'health_score', 'snoozed_until', 'archived_at',
] as const

type Ligne = Record<(typeof COLONNES)[number], unknown> & { id: string; card_id?: string }
type Erreur = { code: string; message: string }

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

/** Les affaires et les rattachements que l'appelant lit, chacun avec ses treize colonnes. */
async function lire(requete: APIRequestContext, enTetes: Record<string, string>) {
	const cartes = await requete.get(rest(`cards?select=id,${COLONNES.join(',')}`), { headers: enTetes })
	const rattachements = await requete.get(rest(`card_placements?select=id,card_id,${COLONNES.join(',')}`), {
		headers: enTetes,
	})
	expect(cartes.status(), 'lecture des affaires').toBe(200)
	expect(rattachements.status(), 'lecture des rattachements : jamais une erreur, au pire zéro ligne').toBe(200)
	return { cartes: (await cartes.json()) as Ligne[], rattachements: (await rattachements.json()) as Ligne[] }
}

/** Les écarts entre chaque affaire lue et son rattachement : vide quand le miroir est exact. */
function ecarts(cartes: Ligne[], rattachements: Ligne[]): string[] {
	const parCarte = new Map(rattachements.map((r) => [r.card_id, r]))
	const sortie: string[] = []
	for (const carte of cartes) {
		const r = parCarte.get(carte.id)
		if (r === undefined) {
			sortie.push(`${carte.id} : aucun rattachement`)
			continue
		}
		for (const colonne of COLONNES) {
			if (JSON.stringify(carte[colonne]) !== JSON.stringify(r[colonne])) {
				sortie.push(`${carte.id}.${colonne} : ${JSON.stringify(carte[colonne])} ≠ ${JSON.stringify(r[colonne])}`)
			}
		}
	}
	return sortie
}

test.describe('CRM-111 T2.1 — les rattachements, lus et refusés par l’API', () => {
	test('l’administratrice lit un rattachement par affaire, égal à elle', async ({ request }) => {
		const { cartes, rattachements } = await lire(request, enTetesAuthentifies(await jetonDe(ADMIN)))
		expect(cartes.length, 'le seed porte des affaires').toBeGreaterThan(0)
		expect(rattachements).toHaveLength(cartes.length)
		expect(ecarts(cartes, rattachements)).toEqual([])
	})

	test('la lectrice ne voit aucun rattachement d’un channel qui lui est fermé, et exactement ceux qu’elle lit', async ({
		request,
	}) => {
		const enTetes = enTetesAuthentifies(await jetonDe(VIEWER))
		const ferme = await request.get(rest(`card_placements?channel_id=eq.${CHANNEL_GRANDS_COMPTES}&select=id`), {
			headers: enTetes,
		})
		expect(ferme.status(), 'un refus de POLITIQUE : zéro ligne, pas une erreur').toBe(200)
		expect(await ferme.json(), 'existence comprise (décision 642)').toEqual([])

		const { cartes, rattachements } = await lire(request, enTetes)
		expect(cartes.map((c) => c.id), 'elle lit CARD_C4 : la vue n’est pas vide').toContain(CARD_C4)
		expect(rattachements).toHaveLength(cartes.length)
		expect(ecarts(cartes, rattachements)).toEqual([])
	})

	test('l’anonyme lit zéro ligne, sans erreur de privilège', async ({ request }) => {
		const reponse = await request.get(rest('card_placements?select=id'), { headers: enTetesAnonymes() })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	// RÉVISÉ PAR `CRM-111` T2.3.0 : l'administratrice écrit désormais les sept colonnes ouvertes du rattachement
	// (`e2e/api/rattachements-ecriture.spec.ts`) ; elle n'en écrit toujours pas l'ÉTAPE, qui passe par `move_card`. La clé
	// de service, elle, ne l'écrit toujours pas du tout.
	for (const [appelant, enTetes, modification] of [
		['l’administratrice', async () => enTetesAuthentifies(await jetonDe(ADMIN)), { current_step_id: CARD_C4 }],
		['la clé de service', async () => enTetesService(), { next_action: 'interdit' }],
	] as const) {
		test(`${appelant} ne crée ni ne retire un rattachement, et n’en écrit pas une colonne fermée`, async ({ request }) => {
			const h = await enTetes()
			const avant = await request.get(rest(`card_placements?card_id=eq.${CARD_C4}&select=id,next_action`), {
				headers: enTetesService(),
			})
			const [ligne] = (await avant.json()) as Ligne[]
			expect(ligne, 'CARD_C4 a son rattachement').toBeDefined()

			const essais = [
				request.patch(rest(`card_placements?card_id=eq.${CARD_C4}`), { headers: h, data: modification }),
				request.delete(rest(`card_placements?card_id=eq.${CARD_C4}`), { headers: h }),
				request.post(rest('card_placements'), { headers: h, data: { card_id: CARD_C4 } }),
			]
			for (const reponse of await Promise.all(essais)) {
				expect(reponse.status(), 'refus de PRIVILÈGE : une erreur, non un filtrage').toBe(403)
				expect(((await reponse.json()) as Erreur).code).toBe('42501')
			}

			const apres = await request.get(rest(`card_placements?card_id=eq.${CARD_C4}&select=id,next_action`), {
				headers: enTetesService(),
			})
			expect(await apres.json(), 'le rattachement relu est inchangé, et toujours là').toEqual([ligne])
		})
	}

	test('une écriture de l’affaire par l’API est reportée dans son rattachement', async ({ request }) => {
		const h = enTetesAuthentifies(await jetonDe(ADMIN))
		const initiale = await request.get(rest(`cards?id=eq.${CARD_C4}&select=next_action`), { headers: enTetesService() })
		const [carte] = (await initiale.json()) as { next_action: string | null }[]
		if (carte === undefined) throw new Error('CARD_C4 du seed : aucune ligne — le seed est-il appliqué ?')
		const seedee = carte.next_action
		try {
			const ecriture = await request.patch(rest(`cards?id=eq.${CARD_C4}`), {
				headers: h,
				data: { next_action: 'Sonde T2.1 — relancer' },
			})
			expect(ecriture.status()).toBe(204)
			const relu = await request.get(rest(`card_placements?card_id=eq.${CARD_C4}&select=next_action`), { headers: h })
			expect(await relu.json()).toEqual([{ next_action: 'Sonde T2.1 — relancer' }])
		} finally {
			const restitution = await request.patch(rest(`cards?id=eq.${CARD_C4}`), {
				headers: enTetesService(),
				data: { next_action: seedee },
			})
			expect(restitution.status(), 'la valeur seedée est restituée').toBe(204)
		}
		const final = await request.get(rest(`card_placements?card_id=eq.${CARD_C4}&select=next_action`), {
			headers: enTetesService(),
		})
		expect(await final.json(), 'le rattachement a suivi la restitution').toEqual([{ next_action: seedee }])
	})
})
