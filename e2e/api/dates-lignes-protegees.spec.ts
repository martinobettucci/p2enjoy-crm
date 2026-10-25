// @verifies CRM-013 (docs/BACKLOG.md) — colonnes protégées, tranche INC-238 : la date de naissance d'une ligne de coût et
//           d'une ligne de recette, hors interface
// @verifies docs/SPEC-permissions-rls.md §4.4.7 (contrat d'API, lignes a à i), §4.3 (le mécanisme) ;
//           docs/INCONSISTENCY_REPORT.md INC-238 (mesure M6 : `201`, date conservée) ; docs/SPEC-costs.md §2.1 bis
//           (l'ancienneté et son seuil) ; docs/SPEC-recettes.md §6.4 ; docs/SPEC-seed.md §2.3 (comptes), §17 (lignes de
//           coût du seed) ; CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Les jetons sont ceux des profils du seed, obtenus par la véritable route de connexion. La clé de service ne prouve
// AUCUN refus (décision 50) : elle constate l'absence d'une ligne refusée, prouve la ligne h — le chemin du seed — et
// nettoie. Chaque refus est un refus de PRIVILÈGE, qui lève `403` / `42501` avant toute politique : il se constate au
// code ET à la relecture, la ligne n'étant ni créée ni modifiée.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const COUTS = '/rest/v1/card_costs'
const RECETTES = '/rest/v1/card_revenues'

/** Données du seed (`docs/SPEC-seed.md` §17, §21) : l'affaire C7, son budget ouvert, et une ligne de chaque sorte. */
const CARD_C7 = '5eed0000-0000-4000-8000-0000000000c7'
const CARD_C4 = '5eed0000-0000-4000-8000-0000000000c4'
const BUDGET_C1 = '5eed0000-0000-4000-8000-0000000000c1'
const COUT_PUBLICITE = '5eed0000-0000-4000-8000-0000000000e1'

/** Libellé des sondes : tout ce qu'il porte est retiré en fin de fichier, par la clé de service. */
const SONDE = 'Sonde INC-238'
const NAISSANCE_CHOISIE = '2026-05-01T09:00:00+00:00'

type Ligne = { id: string; label: string; created_at: string; updated_at: string }
type Erreur = { code: string; message: string }

let jetonAdmin: string
let jetonBizdev: string

async function contexte(
	playwright: { request: { newContext: (o: { extraHTTPHeaders: Record<string, string> }) => Promise<APIRequestContext> } },
	enTetes: Record<string, string>,
): Promise<APIRequestContext> {
	return playwright.request.newContext({ extraHTTPHeaders: { ...enTetes, Prefer: 'return=representation' } })
}

/** Les lignes d'une table qui portent le libellé de sonde, lues par la clé de service : ce qui a réellement été écrit. */
async function sondes(service: APIRequestContext, table: string): Promise<Ligne[]> {
	const reponse = await service.get(`${table}?label=like.${encodeURIComponent(SONDE)}*&select=id,label,created_at,updated_at`)
	expect(reponse.status()).toBe(200)
	return (await reponse.json()) as Ligne[]
}

async function refusDePrivilege(reponse: Awaited<ReturnType<APIRequestContext['post']>>, table: string): Promise<void> {
	expect(reponse.status(), 'refus de PRIVILÈGE : une erreur, et non un filtrage silencieux').toBe(403)
	const erreur = (await reponse.json()) as Erreur
	expect(erreur.code).toBe('42501')
	expect(erreur.message).toBe(`permission denied for table ${table}`)
}

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
})

test.afterAll(async ({ playwright }) => {
	const service = await contexte(playwright, enTetesService())
	try {
		await service.delete(`${COUTS}?label=like.${encodeURIComponent(SONDE)}*`)
		await service.delete(`${RECETTES}?label=like.${encodeURIComponent(SONDE)}*`)
	} finally {
		await service.dispose()
	}
})

test.describe('CRM-013, INC-238 — la naissance d’une ligne ne se choisit plus', () => {
	test('a — `admin` crée une ligne de coût qui choisit sa naissance : refusée, et rien n’est créé', async ({ playwright }) => {
		const admin = await contexte(playwright, enTetesAuthentifies(jetonAdmin))
		const service = await contexte(playwright, enTetesService())
		try {
			const reponse = await admin.post(COUTS, {
				data: { card_id: CARD_C7, budget_id: BUDGET_C1, label: `${SONDE} a`, estimated_cost: 1, created_at: NAISSANCE_CHOISIE },
			})
			await refusDePrivilege(reponse, 'card_costs')
			expect((await sondes(service, COUTS)).filter((l) => l.label === `${SONDE} a`), 'aucune ligne créée').toEqual([])
		} finally {
			await admin.dispose()
			await service.dispose()
		}
	})

	test('b et f — `admin` réécrit la naissance ou la mise à jour d’une ligne existante : refusé, ligne inchangée', async ({
		playwright,
	}) => {
		const admin = await contexte(playwright, enTetesAuthentifies(jetonAdmin))
		let avant: Ligne[] | undefined
		try {
			avant = (await (await admin.get(`${COUTS}?id=eq.${COUT_PUBLICITE}&select=id,label,created_at,updated_at`)).json()) as Ligne[]
			expect(avant, 'la ligne « Publicité » du seed doit exister').toHaveLength(1)

			await refusDePrivilege(await admin.patch(`${COUTS}?id=eq.${COUT_PUBLICITE}`, { data: { created_at: NAISSANCE_CHOISIE } }), 'card_costs')
			await refusDePrivilege(
				await admin.patch(`${COUTS}?id=eq.${COUT_PUBLICITE}`, { data: { updated_at: NAISSANCE_CHOISIE } }),
				'card_costs',
			)
			// Le refus porte sur l'instruction ENTIÈRE : une colonne ouverte envoyée avec une colonne fermée n'est pas écrite.
			await refusDePrivilege(
				await admin.patch(`${COUTS}?id=eq.${COUT_PUBLICITE}`, { data: { label: `${SONDE} jamais écrit`, created_at: NAISSANCE_CHOISIE } }),
				'card_costs',
			)

			const apres = (await (await admin.get(`${COUTS}?id=eq.${COUT_PUBLICITE}&select=id,label,created_at,updated_at`)).json()) as Ligne[]
			expect(apres, 'la ligne relue est identique, dates et libellé').toEqual(avant)
		} finally {
			// Si la règle tombait, la ligne du seed serait réécrite : elle est rendue à son état relu, sans quoi
			// `budgets.spec.ts` verrait « Publicité » en retard pour la mauvaise raison (mesuré le 2026-10-25).
			// Aucune écriture quand la ligne est intacte : le cas nominal ne touche pas au seed.
			if (avant !== undefined && avant[0] !== undefined) {
				const service = await contexte(playwright, enTetesService())
				const relue = (await (await service.get(`${COUTS}?id=eq.${COUT_PUBLICITE}&select=id,label,created_at,updated_at`)).json()) as Ligne[]
				if (JSON.stringify(relue) !== JSON.stringify(avant)) {
					const { label, created_at } = avant[0]
					await service.patch(`${COUTS}?id=eq.${COUT_PUBLICITE}`, { data: { label, created_at } })
				}
				await service.dispose()
			}
			await admin.dispose()
		}
	})

	test('f — ni sa date de mise à jour à la création', async ({ playwright }) => {
		const admin = await contexte(playwright, enTetesAuthentifies(jetonAdmin))
		try {
			await refusDePrivilege(
				await admin.post(COUTS, {
					data: { card_id: CARD_C7, budget_id: BUDGET_C1, label: `${SONDE} f`, estimated_cost: 1, updated_at: NAISSANCE_CHOISIE },
				}),
				'card_costs',
			)
		} finally {
			await admin.dispose()
		}
	})

	test('c et g — une ligne de recette qui choisit sa naissance est refusée, à l’administratrice comme au business developer', async ({
		playwright,
	}) => {
		const admin = await contexte(playwright, enTetesAuthentifies(jetonAdmin))
		const bizdev = await contexte(playwright, enTetesAuthentifies(jetonBizdev))
		const service = await contexte(playwright, enTetesService())
		try {
			await refusDePrivilege(
				await admin.post(RECETTES, { data: { card_id: CARD_C7, label: `${SONDE} c`, estimated_amount: 1, created_at: NAISSANCE_CHOISIE } }),
				'card_revenues',
			)
			// C4 est une affaire que Driss écrit : le seed y pose ses deux lots sous son jeton (§21).
			await refusDePrivilege(
				await bizdev.post(RECETTES, { data: { card_id: CARD_C4, label: `${SONDE} g`, estimated_amount: 1, created_at: NAISSANCE_CHOISIE } }),
				'card_revenues',
			)
			expect(await sondes(service, RECETTES), 'aucune ligne de recette créée').toEqual([])
		} finally {
			await admin.dispose()
			await bizdev.dispose()
			await service.dispose()
		}
	})

	test('d et e — sans ces colonnes, la ligne se crée datée par la base, et ses colonnes ouvertes s’écrivent', async ({
		playwright,
	}) => {
		const admin = await contexte(playwright, enTetesAuthentifies(jetonAdmin))
		try {
			const debut = Date.now()
			const cree = await admin.post(COUTS, { data: { card_id: CARD_C7, budget_id: BUDGET_C1, label: `${SONDE} d`, estimated_cost: 1 } })
			// CONTRE-ÉPREUVE : sans elle, tous les refus ci-dessus seraient verts même si la migration avait tout fermé.
			expect(cree.status(), 'une ligne ordinaire se crée toujours').toBe(201)
			const ligne = ((await cree.json()) as Ligne[])[0]
			expect(ligne, 'la ligne créée est rendue').toBeDefined()
			expect(Math.abs(Date.parse(ligne!.created_at) - debut), 'elle naît à l’heure de la base').toBeLessThan(60_000)

			const modifie = await admin.patch(`${COUTS}?id=eq.${ligne!.id}`, { data: { label: `${SONDE} e` } })
			expect(modifie.status(), 'le libellé reste modifiable').toBe(200)
			expect(((await modifie.json()) as Ligne[])[0]?.label).toBe(`${SONDE} e`)

			const recette = await admin.post(RECETTES, { data: { card_id: CARD_C7, label: `${SONDE} d recette`, estimated_amount: 1 } })
			expect(recette.status(), 'une ligne de recette ordinaire se crée toujours').toBe(201)
		} finally {
			await admin.dispose()
		}
	})

	test('h — la clé de service choisit encore la naissance : c’est le chemin du seed', async ({ playwright }) => {
		const service = await contexte(playwright, enTetesService())
		try {
			const cree = await service.post(COUTS, {
				data: { card_id: CARD_C7, budget_id: BUDGET_C1, label: `${SONDE} h`, estimated_cost: 1, created_at: NAISSANCE_CHOISIE },
			})
			expect(cree.status()).toBe(201)
			expect(((await cree.json()) as Ligne[])[0]?.created_at, 'la date choisie est conservée').toBe(NAISSANCE_CHOISIE)
		} finally {
			await service.dispose()
		}
	})

	test('i — un appelant anonyme est refusé sans session', async ({ playwright }) => {
		const anonyme = await contexte(playwright, enTetesAnonymes())
		const service = await contexte(playwright, enTetesService())
		try {
			const reponse = await anonyme.post(COUTS, {
				data: { card_id: CARD_C7, budget_id: BUDGET_C1, label: `${SONDE} i`, estimated_cost: 1, created_at: NAISSANCE_CHOISIE },
			})
			expect(reponse.status()).toBe(401)
			expect((await sondes(service, COUTS)).filter((l) => l.label === `${SONDE} i`)).toEqual([])
		} finally {
			await anonyme.dispose()
			await service.dispose()
		}
	})
})
