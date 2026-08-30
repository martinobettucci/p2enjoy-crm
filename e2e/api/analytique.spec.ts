// @verifies CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
//           TRANCHE 2 a : l'agrégat descend en base ; TRANCHE 2 c : le seed exerce la résolution
// @verifies docs/SPEC-analytique.md §6 (les quinze lignes du contrat d'API), §9 (les deux
//           surcharges que le seed porte, ligne *q*), §5.1 (les quatorze colonnes rendues, le
//           libellé du catalogue, l'arrondi), §5.3 (`security invoker` : deux appelants, deux
//           totaux), §5.4 (`anon` refusé par le PRIVILÈGE), §3 (résolution à trois niveaux),
//           §4 (les deux exclusions, et l'inclusion du sommeil), §7.2 (le prévisionnel)
// @verifies docs/SCHEMA.md §9 bis.11 (contrat de `public.entonnoir_conversion`)
// @verifies docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur ;
//           preuves n° 4 et n° 11)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. `supabase/tests/0068_entonnoir_conversion.test.sql`
// prouve la règle **en base**, sous des rôles endossés. Rien n'y garantit que la pile la rende par
// la vraie route : une fonction absente du cache de schéma rendrait `404 / PGRST202`, un privilège
// mal posé rendrait `200 []` là où le contrat annonce `401`, et la suite pgTAP resterait verte dans
// les deux cas. C'est exactement le défaut que la première écriture de la migration 53 portait, et
// que seule la mesure par l'API a trouvé.
//
// DEUX SCÉNARIOS ÉCRIVENT, ET ILS RESTAURENT. Les lignes *m* et *n* du §6 posent une surcharge de
// probabilité puis la retirent dans un `finally` INCONDITIONNEL, et la dernière lecture le
// CONSTATE plutôt que de le supposer : une preuve rend le produit dans l'état où elle l'a pris
// (`docs/JOURNAL.md` décision 501). Tous les autres scénarios sont en lecture seule.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const RPC = '/rest/v1/rpc/entonnoir_conversion'
const RPC_FIGEES = '/rest/v1/rpc/cards_figees'
const CARDS = '/rest/v1/cards'
const ETAPES = '/rest/v1/workflow_steps'

/** Channels du seed — `docs/SPEC-seed.md` §2.6. */
const CH_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const CH_PROSPECTION = '5eed0000-0000-4000-8000-000000000031'
const CH_INTER_ENTREPRISES = '5eed0000-0000-4000-8000-000000000036'
const CH_MAINTENANCE = '5eed0000-0000-4000-8000-000000000035'
/** Les deux channels de la ligne *q* : le premier porte l'affaire SURCHARGÉE, le second non. */
const CH_DOSSIERS_2023 = '5eed0000-0000-4000-8000-000000000037'
const CH_REFONTE = '5eed0000-0000-4000-8000-000000000034'

/**
 * « Cadrage data — Groupe Vallier » : 38 000,00 EUR, SEULE affaire de `conseil-ia/prospection` au
 * nœud `prospection`, et **encore endormie**. Son isolement est ce qui rend les lignes *k*, *m* et
 * *n* lisibles : le pondéré de sa ligne est exactement sa probabilité effective appliquée à son
 * montant, sans qu'aucune autre affaire ne s'y mêle.
 */
const CADRAGE_DATA = '5eed0000-0000-4000-8000-0000000000ca'

/**
 * L'entonnoir attendu, REPLIÉ PAR NŒUD ET PAR DEVISE — `docs/SPEC-analytique.md` M6.
 *
 * La fonction rend un grain plus fin, par channel ; ce tableau est la vue que l'écran montrera, et
 * il est ce que la ligne *c* du contrat exige. L'assertion porte sur la SUITE ENTIÈRE plutôt que sur
 * un échantillon : un nœud oublié ou une devise fusionnée la ferait rougir.
 */
const ENTONNOIR_REPLIE = [
	{ cle: 'prospection', devise: 'EUR', affaires: 11, sansMontant: 1, montant: 294200, pondere: 29420 },
	{ cle: 'relance', devise: 'CHF', affaires: 1, sansMontant: 0, montant: 47000, pondere: 9400 },
	{ cle: 'relance', devise: 'EUR', affaires: 8, sansMontant: 0, montant: 284350, pondere: 56870 },
	{ cle: 'negociation', devise: 'EUR', affaires: 9, sansMontant: 0, montant: 366850, pondere: 230752.5 },
	{ cle: 'signature', devise: 'CHF', affaires: 1, sansMontant: 0, montant: 28000, pondere: 25200 },
	{ cle: 'realisation', devise: 'EUR', affaires: 1, sansMontant: 0, montant: 64000, pondere: 64000 },
	{ cle: 'livre', devise: 'EUR', affaires: 7, sansMontant: 0, montant: 311000, pondere: 311000 },
	{ cle: 'perdu', devise: 'EUR', affaires: 1, sansMontant: 0, montant: 31000, pondere: 0 },
] as const

/** Les quatorze colonnes du §5.1, énumérées pour que l'assertion porte sur le CONTRAT. */
const COLONNES = [
	'workspace_id',
	'track_id',
	'channel_id',
	'node_id',
	'node_key',
	'node_label',
	'node_kind',
	'node_position',
	'currency',
	'affaires',
	'affaires_sans_montant',
	'affaires_sans_probabilite',
	'montant',
	'montant_pondere',
] as const

type LigneEntonnoir = {
	workspace_id: string
	track_id: string
	channel_id: string
	node_id: string
	node_key: string
	node_label: string
	node_kind: 'open' | 'won' | 'lost'
	node_position: number
	currency: string
	affaires: number
	affaires_sans_montant: number
	affaires_sans_probabilite: number
	montant: number
	montant_pondere: number
}

/** Le repli par `(node_key, currency)` que l'écran fera, écrit une fois et employé partout. */
function replier(lignes: readonly LigneEntonnoir[]) {
	const cumul = new Map<
		string,
		{ cle: string; devise: string; position: number; affaires: number; sansMontant: number; montant: number; pondere: number }
	>()
	for (const ligne of lignes) {
		const clef = `${ligne.node_key} ${ligne.currency}`
		const courant = cumul.get(clef) ?? {
			cle: ligne.node_key,
			devise: ligne.currency,
			position: ligne.node_position,
			affaires: 0,
			sansMontant: 0,
			montant: 0,
			pondere: 0,
		}
		courant.affaires += ligne.affaires
		courant.sansMontant += ligne.affaires_sans_montant
		courant.montant += ligne.montant
		courant.pondere += ligne.montant_pondere
		cumul.set(clef, courant)
	}
	return [...cumul.values()].sort(
		(a, b) => a.position - b.position || a.devise.localeCompare(b.devise),
	)
}

/** Le prévisionnel du §7.2 : les seules lignes `open`, par devise. */
function previsionnel(lignes: readonly LigneEntonnoir[]): Record<string, number> {
	const total: Record<string, number> = {}
	for (const ligne of lignes.filter((l) => l.node_kind === 'open')) {
		total[ligne.currency] = (total[ligne.currency] ?? 0) + ligne.montant_pondere
	}
	return total
}

const total = (lignes: readonly LigneEntonnoir[]) =>
	lignes.reduce((somme, ligne) => somme + ligne.affaires, 0)

let jetonAdmin: string
let jetonBizdev: string
let jetonViewer: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
	jetonBizdev = await jetonDe('bizdev@p2enjoy.test')
	jetonViewer = await jetonDe('viewer@p2enjoy.test')
})

test.describe("l'entonnoir de conversion, par la vraie route (docs/SPEC-analytique.md §6)", () => {
	test('a — l’anonyme est refusé par le PRIVILÈGE : `401` et `42501`, jamais un tableau vide', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, { headers: enTetesAnonymes(), data: {} })
		// `pg_default_acl` fait naître toute fonction de `public` avec `anon=X` : sans révocation
		// NOMINATIVE, la réponse serait `200` et `[]`. La migration 53 a payé ce point de sûreté, et
		// cette assertion est ce qui l'empêche de repasser.
		expect(reponse.status()).toBe(401)
		expect(((await reponse.json()) as { code?: string }).code).toBe('42501')
	})

	test('b — l’administratrice obtient `200`, seize lignes et trente-neuf affaires', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		expect(lignes).toHaveLength(16)
		expect(total(lignes)).toBe(39)
		// Les quatorze colonnes, ni plus ni moins, et sur CHAQUE ligne.
		for (const ligne of lignes) {
			expect(Object.keys(ligne).sort()).toEqual([...COLONNES].sort())
		}
	})

	test('c — repliées par nœud et par devise, les seize lignes rendent les huit de M6', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		const replie = replier(lignes)
		expect(replie.map((l) => `${l.cle}/${l.devise}`)).toEqual(
			ENTONNOIR_REPLIE.map((l) => `${l.cle}/${l.devise}`),
		)
		for (const [rang, attendu] of ENTONNOIR_REPLIE.entries()) {
			expect(replie[rang]?.affaires).toBe(attendu.affaires)
			expect(replie[rang]?.sansMontant).toBe(attendu.sansMontant)
			expect(replie[rang]?.montant).toBeCloseTo(attendu.montant, 2)
			expect(replie[rang]?.pondere).toBeCloseTo(attendu.pondere, 2)
		}
		// Le prévisionnel du §7.2 — les seules lignes `open`. Une affaire gagnée n'est plus une
		// prévision, une affaire perdue vaut zéro.
		expect(previsionnel(lignes).EUR).toBeCloseTo(381042.5, 2)
		expect(previsionnel(lignes).CHF).toBeCloseTo(34600, 2)
	})

	test('d — l’ordre est celui du §5.1, et deux appels rendent la MÊME suite', async ({ request }) => {
		const lire = async () =>
			(await (
				await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
			).json()) as LigneEntonnoir[]
		const premier = await lire()
		const second = await lire()
		// L'ordre déclaré : position du nœud, puis devise, puis channel. Sans le troisième critère,
		// deux channels au même nœud et à la même devise pourraient permuter d'un appel à l'autre.
		//
		// Le tri de référence compare la POSITION comme un nombre : un tri lexicographique sur une
		// clef concaténée rangerait « 10 » avant « 2 » et serait vert par accident tant que le
		// catalogue compte moins de dix nœuds.
		const clef = (l: LigneEntonnoir) => [l.node_position, l.currency, l.channel_id].join('|')
		const attendu = [...premier].sort(
			(a, b) =>
				a.node_position - b.node_position ||
				a.currency.localeCompare(b.currency) ||
				a.channel_id.localeCompare(b.channel_id),
		)
		expect(premier.map(clef)).toEqual(attendu.map(clef))
		expect(second.map(clef)).toEqual(premier.map(clef))
	})

	test('e — le business developer obtient les mêmes trente-neuf affaires', async ({ request }) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonBizdev), data: {} })
		expect(reponse.status()).toBe(200)
		expect(total((await reponse.json()) as LigneEntonnoir[])).toBe(39)
	})

	test('f — la lectrice obtient TREIZE lignes et TRENTE-CINQ affaires, et son prévisionnel diffère', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonViewer), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		expect(lignes).toHaveLength(13)
		expect(total(lignes)).toBe(35)
		// AUCUNE ligne du channel qui lui est fermé.
		expect(lignes.filter((l) => l.channel_id === CH_GRANDS_COMPTES)).toHaveLength(0)
		// Trois lignes repliées diffèrent, et quatre sont IDENTIQUES : c'est la forme exacte de la
		// divergence, et l'asserter en bloc empêcherait de voir qu'une seule d'entre elles a bougé.
		const replie = new Map(replier(lignes).map((l) => [`${l.cle}/${l.devise}`, l]))
		expect(replie.get('prospection/EUR')?.affaires).toBe(10)
		expect(replie.get('relance/EUR')?.affaires).toBe(6)
		expect(replie.get('livre/EUR')?.affaires).toBe(6)
		expect(replie.get('negociation/EUR')?.affaires).toBe(9)
		expect(replie.get('signature/CHF')?.affaires).toBe(1)
		expect(replie.get('realisation/EUR')?.affaires).toBe(1)
		expect(replie.get('perdu/EUR')?.affaires).toBe(1)
		// LE PRÉVISIONNEL N'EST PAS LE MÊME, ET C'EST CORRECT. Un total est une divulgation : celui
		// qui inclurait les affaires de `grands-comptes` les révélerait par soustraction.
		expect(previsionnel(lignes).EUR).toBeCloseTo(344892.5, 2)
		expect(previsionnel(lignes).CHF).toBeCloseTo(34600, 2)
	})

	test('g — son refus est ZÉRO LIGNE, jamais une erreur : `200` et non `403`', async ({ request }) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonViewer), data: {} })
		expect(reponse.status()).toBe(200)
	})

	test('h — contre-épreuve par la clé de service : les lignes qu’elle ne voit pas EXISTENT', async ({
		request,
	}) => {
		// Sans cette contre-épreuve, « la lectrice en voit 35 » serait vrai aussi d'une base qui n'en
		// porterait que 35 (`docs/JOURNAL.md` décision 50). La clé de service ne prouve jamais un
		// refus ; elle établit que le sujet du refus existe.
		const reponse = await request.post(RPC, { headers: enTetesService(), data: {} })
		expect(reponse.status()).toBe(200)
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		expect(total(lignes)).toBe(39)
		expect(lignes.filter((l) => l.channel_id === CH_GRANDS_COMPTES).length).toBeGreaterThan(0)
	})

	test('i — un montant absent n’est PAS compté comme zéro, et il est compté à part', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		// « Piste entrante à qualifier », seule affaire de `inter-entreprises` au nœud `prospection`,
		// n'a pas de montant. Sa probabilité, elle, est connue : 10 %.
		const sansMontant = lignes.find(
			(l) => l.channel_id === CH_INTER_ENTREPRISES && l.node_key === 'prospection',
		)
		expect(sansMontant?.affaires).toBe(1)
		expect(sansMontant?.affaires_sans_montant).toBe(1)
		expect(sansMontant?.affaires_sans_probabilite).toBe(0)
		expect(sansMontant?.montant).toBeCloseTo(0, 2)
		expect(sansMontant?.montant_pondere).toBeCloseTo(0, 2)
		// Repliée, la ligne `prospection`/EUR porte donc onze affaires POUR 294 200,00 — le montant
		// manquant n'a pas été compté, et l'affaire l'a été.
		const replie = replier(lignes).find((l) => l.cle === 'prospection' && l.devise === 'EUR')
		expect(replie?.affaires).toBe(11)
		expect(replie?.sansMontant).toBe(1)
		expect(replie?.montant).toBeCloseTo(294200, 2)
	})

	test('j — ni l’affaire en corbeille ni l’archivée ne sont comptées', async ({ request }) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		// `grands-comptes` porte six affaires, dont une supprimée au nœud `prospection` et une
		// archivée au nœud `livre` : l'entonnoir doit en compter QUATRE.
		expect(
			lignes
				.filter((l) => l.channel_id === CH_GRANDS_COMPTES)
				.reduce((somme, l) => somme + l.affaires, 0),
		).toBe(4)
		// Et le total du workspace vaut 39, jamais 41.
		const parService = await request.post(RPC, { headers: enTetesService(), data: {} })
		expect(total((await parService.json()) as LigneEntonnoir[])).toBe(39)
	})

	test('k — l’affaire EN SOMMEIL compte, et `cards_figees` ne la rend pas', async ({ request }) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		const ligne = lignes.find(
			(l) => l.channel_id === CH_PROSPECTION && l.node_key === 'prospection',
		)
		expect(ligne?.affaires).toBe(1)
		expect(ligne?.montant).toBeCloseTo(38000, 2)
		// LA CONTRE-ÉPREUVE : sans elle, l'assertion ci-dessus serait vraie même si les deux règles
		// étaient identiques. Le sommeil dit « ne me réveille pas », jamais « cette affaire n'est
		// plus au portefeuille » — les affaires figées l'écartent à bon droit, l'entonnoir non.
		const figees = await request.post(RPC_FIGEES, {
			headers: enTetesAuthentifies(jetonAdmin),
			data: {},
		})
		const cartes = (await figees.json()) as { card_id: string }[]
		expect(cartes.some((c) => c.card_id === CADRAGE_DATA)).toBe(false)
	})

	test('l — une probabilité qui VAUT zéro n’est pas une probabilité ABSENTE', async ({ request }) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		const perdu = lignes.find((l) => l.node_key === 'perdu')
		expect(perdu?.node_kind).toBe('lost')
		// Le pondéré est nul, et `affaires_sans_probabilite` vaut ZÉRO : les deux cas se ressemblent
		// dans le résultat et diffèrent dans la donnée.
		expect(perdu?.montant_pondere).toBeCloseTo(0, 2)
		expect(perdu?.affaires_sans_probabilite).toBe(0)
		expect(perdu?.montant).toBeCloseTo(31000, 2)
	})

	test('m — la surcharge de l’ÉTAPE l’emporte sur le catalogue, puis elle est restaurée', async ({
		request,
	}) => {
		const carte = await request.get(
			`${CARDS}?id=eq.${CADRAGE_DATA}&select=current_step_id`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const etape = ((await carte.json()) as { current_step_id: string }[])[0]?.current_step_id
		expect(etape).toBeDefined()

		const lireLigne = async () => {
			const reponse = await request.post(RPC, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: {},
			})
			return ((await reponse.json()) as LigneEntonnoir[]).find(
				(l) => l.channel_id === CH_PROSPECTION && l.node_key === 'prospection',
			)
		}

		// Le catalogue seul : 38 000,00 × 10 %.
		expect((await lireLigne())?.montant_pondere).toBeCloseTo(3800, 2)

		try {
			const ecriture = await request.patch(`${ETAPES}?id=eq.${etape}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { probability_override: 25 },
			})
			expect([200, 204]).toContain(ecriture.status())
			expect((await lireLigne())?.montant_pondere).toBeCloseTo(9500, 2)
		} finally {
			// RESTAURATION INCONDITIONNELLE : une preuve rend le produit dans l'état où elle l'a pris.
			await request.patch(`${ETAPES}?id=eq.${etape}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { probability_override: null },
			})
		}
		// ET LE CONSTAT, plutôt que la supposition.
		expect((await lireLigne())?.montant_pondere).toBeCloseTo(3800, 2)
	})

	test('n — la surcharge de l’AFFAIRE l’emporte sur celle de l’étape, puis elle est restaurée', async ({
		request,
	}) => {
		const carte = await request.get(
			`${CARDS}?id=eq.${CADRAGE_DATA}&select=current_step_id`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const etape = ((await carte.json()) as { current_step_id: string }[])[0]?.current_step_id

		const lireLigne = async () => {
			const reponse = await request.post(RPC, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: {},
			})
			return ((await reponse.json()) as LigneEntonnoir[]).find(
				(l) => l.channel_id === CH_PROSPECTION && l.node_key === 'prospection',
			)
		}

		try {
			await request.patch(`${ETAPES}?id=eq.${etape}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { probability_override: 25 },
			})
			const ecriture = await request.patch(`${CARDS}?id=eq.${CADRAGE_DATA}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { probability_override: 75 },
			})
			expect([200, 204]).toContain(ecriture.status())
			// 38 000,00 × 75 % — l'affaire l'emporte sur l'étape, qui l'emportait sur le catalogue.
			expect((await lireLigne())?.montant_pondere).toBeCloseTo(28500, 2)
		} finally {
			await request.patch(`${CARDS}?id=eq.${CADRAGE_DATA}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { probability_override: null },
			})
			await request.patch(`${ETAPES}?id=eq.${etape}`, {
				headers: enTetesAuthentifies(jetonAdmin),
				data: { probability_override: null },
			})
		}
		expect((await lireLigne())?.montant_pondere).toBeCloseTo(3800, 2)
	})

	test('o — le libellé rendu est celui du CATALOGUE, jamais celui de l’étape', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		// Les DEUX workflows du seed renomment cette étape « Réalisation en cours ».
		const realisation = lignes.filter((l) => l.node_key === 'realisation')
		expect(realisation.length).toBeGreaterThan(0)
		for (const ligne of realisation) {
			expect(ligne.node_label).toBe('Réalisation')
		}
	})

	test('p — deux devises au même nœud rendent DEUX lignes, jamais une somme', async ({
		request,
	}) => {
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]
		const relanceMaintenance = lignes
			.filter((l) => l.channel_id === CH_MAINTENANCE && l.node_key === 'relance')
			.map((l) => l.currency)
			.sort()
		expect(relanceMaintenance).toEqual(['CHF', 'EUR'])
		// Aucune ligne vide n'est émise : un nœud sans affaire se tait.
		expect(lignes.filter((l) => l.affaires === 0)).toHaveLength(0)
	})

	test('q — les TROIS niveaux sont exercés par le SEED, sans qu’aucune preuve n’écrive', async ({
		request,
	}) => {
		// LIGNE *q*, AJOUTÉE PAR LA TRANCHE 2 c — `docs/SPEC-analytique.md` §9. Les lignes *m* et *n*
		// posent leurs surcharges puis les retirent : elles prouvent la RÈGLE. Celle-ci ne touche
		// à rien et lit ce que le seed a posé — la preuve que les données de développement
		// exercent la résolution, ce que `CLAUDE.md` §8 exige d'une règle métier neuve.
		const reponse = await request.post(RPC, { headers: enTetesAuthentifies(jetonAdmin), data: {} })
		const lignes = (await reponse.json()) as LigneEntonnoir[]

		// NIVEAU 1, l'affaire : « Reprise du dossier Marchand », SEULE de son channel à ce nœud —
		// 22 000,00 × 30 %. Le catalogue rendrait 11 000,00, l'étape 14 300,00.
		const marchand = lignes.find(
			(l) => l.channel_id === CH_DOSSIERS_2023 && l.node_key === 'negociation',
		)
		expect(marchand?.affaires).toBe(1)
		expect(marchand?.montant_pondere).toBeCloseTo(6600, 2)

		// NIVEAU 2, l'étape : une affaire de la MÊME étape, SANS surcharge propre — 72 000,00 × 65 %.
		// Sans elle, « 30 % » pourrait aussi bien être une valeur appliquée à tout le nœud.
		const lyon = lignes.find((l) => l.channel_id === CH_REFONTE && l.node_key === 'negociation')
		expect(lyon?.affaires).toBe(1)
		expect(lyon?.montant_pondere).toBeCloseTo(46800, 2)

		// Et le nœud entier : 230 752,50, et non 183 425,00 — le total qu'il vaudrait si le
		// catalogue l'emportait partout.
		const negociation = lignes
			.filter((l) => l.node_key === 'negociation')
			.reduce((somme, l) => somme + Number(l.montant_pondere), 0)
		expect(negociation).toBeCloseTo(230752.5, 2)
	})
})
