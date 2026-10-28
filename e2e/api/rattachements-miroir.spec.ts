// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.1 : la table des rattachements, lue et refusée hors interface, avec
//           les jetons réels du seed
// @verifies docs/SPEC-rattachements.md §3.1 (la table), §4 (un rattachement se lit si son channel se lit), §14 (T2.1 :
//           `cards` reste le chemin d'écriture, son rattachement suit) ; docs/JOURNAL.md décision 705
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`) ; CLAUDE.md §10 (règle d'accès prouvée hors interface)
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3.0 : les colonnes fermées du rattachement le restent
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.4.3 : la clé de service insère pour le seed, ne retire rien, et
//           n'écrit pas ce que la base tient seule (docs/SPEC-rattachements.md §12, décision 746)
// @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.4.5 : les colonnes ont QUITTÉ l'affaire (migration 0134) ; il n'y a
//           plus de miroir à éprouver, mais une affaire lue a exactement un rattachement lisible tant que
//           `card_placements_one_per_card_idx` tient (T3), et une requête qui nomme une colonne retirée est refusée
//           (docs/SPEC-rattachements.md §3.1, §3.2)
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

/** Les treize colonnes du rattachement, que l'affaire ne porte plus depuis la migration 0134 (§3.2). */
const COLONNES = [
	'channel_id', 'workflow_id', 'current_step_id', 'position', 'owner_id', 'amount', 'probability_override',
	'next_action', 'next_action_at', 'entered_step_at', 'health_score', 'snoozed_until', 'archived_at',
] as const

type Ligne = Record<(typeof COLONNES)[number], unknown> & { id: string; card_id?: string }
type Erreur = { code: string; message: string }

const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`

/** Les affaires et les rattachements que l'appelant lit, ceux-ci avec leurs treize colonnes. */
async function lire(requete: APIRequestContext, enTetes: Record<string, string>) {
	const cartes = await requete.get(rest('cards?select=id'), { headers: enTetes })
	const rattachements = await requete.get(rest(`card_placements?select=id,card_id,${COLONNES.join(',')}`), {
		headers: enTetes,
	})
	expect(cartes.status(), 'lecture des affaires').toBe(200)
	expect(rattachements.status(), 'lecture des rattachements : jamais une erreur, au pire zéro ligne').toBe(200)
	return { cartes: (await cartes.json()) as Ligne[], rattachements: (await rattachements.json()) as Ligne[] }
}

/**
 * Les écarts entre les affaires lues et leurs rattachements lus : vide quand chaque affaire a exactement un rattachement
 * lisible, porteur d'un channel, et qu'aucun rattachement lisible ne désigne une affaire illisible.
 */
function ecarts(cartes: Ligne[], rattachements: Ligne[]): string[] {
	const sortie: string[] = []
	const lues = new Set(cartes.map((carte) => carte.id))
	for (const carte of cartes) {
		const siens = rattachements.filter((r) => r.card_id === carte.id)
		if (siens.length !== 1) sortie.push(`${carte.id} : ${siens.length} rattachement(s)`)
		else if (siens[0]!.channel_id === null) sortie.push(`${carte.id} : rattachement sans channel`)
	}
	for (const r of rattachements) if (!lues.has(r.card_id!)) sortie.push(`${r.id} : affaire ${r.card_id} illisible`)
	return sortie
}

test.describe('CRM-111 T2.1 — les rattachements, lus et refusés par l’API', () => {
	test('l’administratrice lit un rattachement par affaire', async ({ request }) => {
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
	// RÉVISÉ PAR `CRM-111` T2.4.3 (migration 124, décision 746) : la clé de service INSÈRE un rattachement et met à jour
	// les colonnes que le seed pose — `supabase/tests/0116_seed_ecrit_les_rattachements.test.sql` le prouve. Elle ne retire
	// toujours rien, et n'écrit pas ce que la base tient seule (`created_at`) ; son essai d'insertion n'est plus un refus de
	// privilège, et n'est donc plus tenté ici.
	for (const [appelant, enTetes, modification, insertionRefusee] of [
		['l’administratrice', async () => enTetesAuthentifies(await jetonDe(ADMIN)), { current_step_id: CARD_C4 }, true],
		['la clé de service', async () => enTetesService(), { created_at: '2020-01-01T00:00:00Z' }, false],
	] as const) {
		const titre = insertionRefusee
			? `${appelant} ne crée ni ne retire un rattachement, et n’en écrit pas une colonne fermée`
			: `${appelant} ne retire aucun rattachement, et n’en écrit pas une colonne que la base tient seule`
		test(titre, async ({ request }) => {
			const h = await enTetes()
			const avant = await request.get(rest(`card_placements?card_id=eq.${CARD_C4}&select=id,next_action`), {
				headers: enTetesService(),
			})
			const [ligne] = (await avant.json()) as Ligne[]
			expect(ligne, 'CARD_C4 a son rattachement').toBeDefined()

			const essais = [
				request.patch(rest(`card_placements?card_id=eq.${CARD_C4}`), { headers: h, data: modification }),
				request.delete(rest(`card_placements?card_id=eq.${CARD_C4}`), { headers: h }),
				...(insertionRefusee ? [request.post(rest('card_placements'), { headers: h, data: { card_id: CARD_C4 } })] : []),
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

	// RÉVISÉ PAR `CRM-111` T2.4.5 (décision 51) : ce scénario éprouvait le MIROIR — une écriture de l'affaire par la clé de
	// service reportée dans son rattachement. La migration 0134 a retiré les colonnes de l'affaire : il n'y a plus rien à
	// reporter, et la preuve devient celle du retrait, pour tout appelant, clé de service comprise.
	for (const colonne of COLONNES) {
		test(`\`${colonne}\` a quitté l’affaire : la lire ou l’écrire sur \`cards\` est refusé`, async ({ request }) => {
			const h = enTetesService()
			const lecture = await request.get(rest(`cards?id=eq.${CARD_C4}&select=id,${colonne}`), { headers: h })
			expect(lecture.status(), await lecture.text()).toBe(400)
			expect(((await lecture.json()) as Erreur).code).toBe('42703')

			const ecriture = await request.patch(rest(`cards?id=eq.${CARD_C4}`), { headers: h, data: { [colonne]: null } })
			expect(ecriture.status(), await ecriture.text()).toBe(400)
			expect(((await ecriture.json()) as Erreur).code).toBe('PGRST204')
		})
	}
})
