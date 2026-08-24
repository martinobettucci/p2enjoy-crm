// @verifies CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHE 1
// @verifies docs/SPEC-relances.md §4 (les dix lignes du contrat d'API), §3.1 (les dix colonnes
//           rendues), §3.3 (anon refusé par le PRIVILÈGE, pas par une politique), §3.4 (l'ordre),
//           §5 (ce que le seed rend à chaque profil)
// @verifies docs/SPEC-seed.md §9.12.6 (l'unique card du seed au-delà de son seuil)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur ;
//           preuves n° 4 et n° 11)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0051_cards_figees.test.sql` prouve la
// règle **en base**, sous des rôles endossés. Rien n'y garantit que la pile la rende par la vraie
// route : une fonction absente du cache de schéma rendrait `404 / PGRST202`, un privilège mal posé
// rendrait `200 []` là où le contrat annonce `401`, et la suite pgTAP resterait verte dans les deux
// cas. C'est précisément le défaut que la première écriture de la migration 53 portait, et que la
// mesure par l'API a trouvé.
//
// AUCUNE ÉCRITURE. Ce fichier ne pose, ne modifie ni ne retire aucune ligne : la fonction est en
// lecture seule, et le seed porte déjà l'unique affaire figée dont le contrat a besoin. Une dernière
// lecture le constate plutôt que de le supposer.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

const RPC = '/rest/v1/rpc/cards_figees'

/** Identifiants du seed — `docs/SPEC-seed.md` §2.3, §9.12.1 et `docs/SPEC-cards.md` §9. */
const CAMILLE = '5eed0000-0000-4000-8000-000000000011'
/** « Audit sécurité applicative » : l'unique affaire du seed au-delà de son seuil (§9.12.1). */
const CARD_FIGEE = '5eed0000-0000-4000-8000-0000000000c3'
/** Le channel « Grands comptes », fermé à la lectrice par un droit fin de `CRM-012`. */
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'

/**
 * Les dix colonnes du §3.1, énumérées ici pour que l'assertion porte sur le **contrat** et non sur
 * ce que la réponse contient par hasard. Une colonne retirée de la fonction ferait rougir la ligne
 * *c* ; une colonne ajoutée sans révision de la spécification aussi.
 */
const COLONNES = [
	'card_id',
	'workspace_id',
	'channel_id',
	'title',
	'owner_id',
	'step_id',
	'entered_step_at',
	'seuil_jours',
	'jours_dans_etape',
	'retard_jours',
] as const

type LigneFigee = {
	card_id: string
	workspace_id: string
	channel_id: string
	title: string
	owner_id: string | null
	step_id: string
	entered_step_at: string
	seuil_jours: number
	jours_dans_etape: number
	retard_jours: number
}

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test.describe('les affaires figées, par la vraie route (docs/SPEC-relances.md §4)', () => {
	test('a — l’administratrice obtient `200` et l’unique affaire figée du seed', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {},
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneFigee[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.card_id).toBe(CARD_FIGEE)
	})

	test('b — les trois grandeurs de la ligne sont celles du §9.12 du seed, et elles sont cohérentes entre elles', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {},
		})
		const [ligne] = (await reponse.json()) as LigneFigee[]
		expect(ligne).toBeDefined()
		// Le seuil est celui du NŒUD `prospection`, l'étape n'en surchargeant aucun (§9.12.6 ligne d).
		expect(ligne?.seuil_jours).toBe(14)
		// LE SEED POSE TRENTE JOURS, ET LA BORNE N'EST PAS RECOPIÉE : la date est relative à
		// l'instant d'application (§9.12.4), donc une preuve qui figerait « exactement 30 » serait
		// fausse dès le lendemain d'un seed non réappliqué.
		expect(ligne?.jours_dans_etape).toBeGreaterThanOrEqual(30)
		// `retard_jours` n'est pas une donnée de plus : c'est la différence des deux autres, et
		// l'assertion l'éprouve plutôt que de la supposer.
		expect(ligne?.retard_jours).toBe((ligne?.jours_dans_etape ?? 0) - (ligne?.seuil_jours ?? 0))
		expect(ligne?.retard_jours).toBeGreaterThanOrEqual(0)
	})

	test('c — les dix colonnes du contrat sont rendues, et aucun libellé d’étape ne l’est', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {},
		})
		const [ligne] = (await reponse.json()) as LigneFigee[]
		expect(ligne).toBeDefined()
		for (const colonne of COLONNES) {
			expect(Object.hasOwn(ligne as object, colonne)).toBe(true)
		}
		// AUCUNE COLONNE DE PLUS (§3.1) : la fonction ne recopie NI le libellé de l'étape, NI celui
		// du nœud. Une trace qui les porterait dirait demain ce qui était vrai aujourd'hui —
		// c'est la règle de `card_events` (`docs/SPEC-cards.md` §14.6), et elle vaut ici.
		expect(Object.keys(ligne as object).sort()).toEqual([...COLONNES].sort())
		expect(ligne?.title).toBe('Audit sécurité applicative')
		expect(ligne?.channel_id).toBe(CHANNEL_GRANDS_COMPTES)
		expect(ligne?.owner_id).toBe(CAMILLE)
	})

	test('d — le business developer obtient la même affaire : le track lui est ouvert', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, {
			headers: enTetesAuthentifies(jetonBizdev),
			data: {},
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneFigee[]
		expect(lignes.map((ligne) => ligne.card_id)).toEqual([CARD_FIGEE])
	})

	test('e — la lectrice obtient `200` et `[]` : zéro ligne, jamais une erreur — preuve n° 4', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, {
			headers: enTetesAuthentifies(jetonViewer),
			data: {},
		})
		// LE REFUS EST UN TABLEAU VIDE. Le track « Grands comptes » lui est fermé par un droit fin
		// de `CRM-012`, et la fonction n'ajoute aucune règle : c'est `app.can_read_card` qui écarte
		// la ligne, à travers `security invoker`.
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('f — l’anonyme est refusé par le PRIVILÈGE : `401` et `42501`, pas un tableau vide', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, { headers: enTetesAnonymes(), data: {} })
		// C'EST LA LIGNE QUI A TROUVÉ UN DÉFAUT RÉEL (§3.3). La première écriture de la migration 53
		// ne révoquait que `public` ; `pg_default_acl` ayant accordé `execute` à `anon` NOMMÉMENT à
		// la création, l'appelant anonyme obtenait `200 []`. Une preuve écrite d'après le SQL plutôt
		// que d'après la pile serait passée à côté.
		expect(reponse.status()).toBe(401)
		expect(((await reponse.json()) as { code?: string }).code).toBe('42501')
	})

	test('g — la même route en `GET` rend la même ligne : la fonction est `stable`', async ({
		request,
	}) => {
		// PostgREST n'expose en lecture que les fonctions non volatiles. Cette ligne était une
		// PRÉDICTION annonçant `404`, corrigée par la mesure et non par un test relâché (§4).
		const reponse = await request.get(RPC, { headers: enTetesAuthentifies(jetonAdmin) })
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneFigee[]
		expect(lignes.map((ligne) => ligne.card_id)).toEqual([CARD_FIGEE])
	})

	test('h — la projection s’applique à la sortie de la fonction', async ({ request }) => {
		const reponse = await request.get(`${RPC}?select=card_id,retard_jours`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as Partial<LigneFigee>[]
		expect(lignes).toHaveLength(1)
		expect(Object.keys(lignes[0] as object).sort()).toEqual(['card_id', 'retard_jours'])
	})

	test('i — un filtre porte sur les colonnes de sortie, et il est appliqué APRÈS la fonction', async ({
		request,
	}) => {
		// Le retard mesuré est de seize jours : au-dessus de vingt, la seule ligne disparaît. Les
		// deux appels tiennent l'assertion des deux côtés — un filtre ignoré rendrait la ligne dans
		// les deux cas, et l'assertion ne dirait rien.
		const [au_dessus, en_dessous] = await Promise.all([
			request.get(`${RPC}?retard_jours=gt.100`, { headers: enTetesAuthentifies(jetonAdmin) }),
			request.get(`${RPC}?retard_jours=gte.1`, { headers: enTetesAuthentifies(jetonAdmin) }),
		])
		expect(au_dessus.status()).toBe(200)
		expect(await au_dessus.json()).toEqual([])
		expect(en_dessous.status()).toBe(200)
		expect(((await en_dessous.json()) as LigneFigee[]).map((l) => l.card_id)).toEqual([CARD_FIGEE])
	})

	test('j — contre-épreuve de la ligne *e* : c’est bien la RLS, et non la fonction, qui refuse', async ({
		request,
	}) => {
		// Sans cette ligne, « la lectrice voit zéro affaire figée » resterait ambigu : une fonction
		// qui ne rendrait JAMAIS rien à personne passerait aussi. La même card, demandée par la
		// table, lui est refusée de la même façon — zéro ligne.
		const reponse = await request.get(`/rest/v1/cards?id=eq.${CARD_FIGEE}&select=id`, {
			headers: enTetesAuthentifies(jetonViewer),
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])

		// Et l'administratrice, elle, la lit : la card existe, seule la lectrice ne la voit pas.
		const parAdmin = await request.get(`/rest/v1/cards?id=eq.${CARD_FIGEE}&select=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(((await parAdmin.json()) as { id: string }[]).map((l) => l.id)).toEqual([CARD_FIGEE])
	})

	test('le seed sort intact : aucune de ces lectures n’a écrit', async ({ request }) => {
		const reponse = await request.post(RPC, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {},
		})
		const lignes = (await reponse.json()) as LigneFigee[]
		expect(lignes).toHaveLength(1)
		expect(lignes[0]?.card_id).toBe(CARD_FIGEE)
		expect(lignes[0]?.seuil_jours).toBe(14)
	})
})
