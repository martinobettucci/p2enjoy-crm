// @verifies CRM-041 (docs/BACKLOG.md) — les quatre lectures du board, hors interface
// @verifies CRM-022 (docs/BACKLOG.md) — l'identité du responsable embarquée dans chaque card
// @verifies docs/SPEC-workflow-engine.md §7.2 (ce que le board lit), §7.3 (composition des
//           colonnes), §7.4 (ce qu'une carte ne peut pas montrer), §7.14 (preuves attendues)
// @verifies docs/SPEC-permissions-rls.md §7 (preuves hors interface, jetons réels)
// @verifies docs/SPEC-cards.md §5 (« active » : ni archivée, ni en corbeille)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// LA QUESTION À LAQUELLE CE FICHIER RÉPOND. Le board compose ses colonnes à partir de quatre
// lectures (§7.2). La composition elle-même est éprouvée par `webapp/src/lib/board.test.ts`,
// **sur des données inventées**. Rien ne garantirait, sans ce fichier, que la pile réelle rende
// ces données-là : une colonne demandée qui n'existe pas, une jointure embarquée refusée, un
// filtre qui ne filtre pas — le test unitaire resterait vert.
//
// Les quatre lectures sont donc rejouées **par la vraie route, avec le jeton réel de
// l'administratrice**, et confrontées au seed mesuré. Puis les mêmes lectures sont opposées à
// l'anonyme, dont le `200` et le `[]` sont la cause de l'écran vide que les captures montrent.
//
// AUCUNE ÉCRITURE. Ce fichier ne déplace aucune card et ne pose aucune ligne : le contrat
// d'écriture de `move_card` est celui de `CRM-034`, éprouvé par `e2e/api/move-card.spec.ts`, et
// le rejouer ici serait une duplication sans valeur probante. Le seed sort intact.

import { expect, test } from '@playwright/test'
import { enTetesAnonymes, enTetesAuthentifies, jetonDe } from './jetons'

/** Identifiants du seed, mesurés en base le 2026-08-05 (docs/SPEC-seed.md). */
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const CHANNEL_GRANDS_COMPTES = '5eed0000-0000-4000-8000-000000000032'
const TRACK_CONSEIL_IA = '5eed0000-0000-4000-8000-000000000021'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'
/** Ajoutée par `CRM-046` : `…0cd` occupe « Livré », dont la seule card était archivée. */
const ETAPE_LIVRE = '5eed0000-0000-4000-8000-000000000066'
const CARD_ARCHIVEE = '5eed0000-0000-4000-8000-0000000000c8'
const CARD_CORBEILLE = '5eed0000-0000-4000-8000-0000000000c9'
/** Ajoutée par la tranche 3 de `CRM-046` : la seule card que le seed pose EN RETARD (§9.12.1). */
const CARD_EN_RETARD = '5eed0000-0000-4000-8000-0000000000c3'

/**
 * Les colonnes réellement demandées par la webapp, **recopiées depuis le module qu'elle
 * emploie**. Un test qui redéclarerait sa propre chaîne `select` prouverait qu'une requête
 * quelconque fonctionne, pas que celle du produit fonctionne.
 */
import {
	COLONNES_CARD_BOARD,
	COLONNES_CHAMP_LIBELLE,
	COLONNES_ETAPE,
	COLONNES_TRANSITION,
} from '../../webapp/src/lib/colonnes-board'

const ETAPES = '/rest/v1/workflow_steps'
const TRANSITIONS = '/rest/v1/workflow_transitions'
const CARDS = '/rest/v1/cards'
const CHAMPS = '/rest/v1/form_fields'
const PROFILS = '/rest/v1/profiles'

type EtapeLue = {
	id: string
	position: number
	label_override: string | null
	stale_after_days: number | null
	workflow_nodes_catalog: {
		label: string
		color: string
		kind: string
		default_stale_after_days: number | null
	} | null
}

type CardLue = {
	id: string
	title: string
	position: number
	amount: number | null
	currency: string
	next_action: string | null
	current_step_id: string
	entered_step_at: string
	email_local_part: string
	owner_id: string | null
	responsable: {
		id: string
		full_name: string
		avatar_url: string | null
	} | null
}

let jetonAdmin: string

test.beforeAll(async () => {
	jetonAdmin = await jetonDe('admin@p2enjoy.test')
})

test.describe('B1 — la lecture des étapes rend les colonnes du board (§7.2, lecture n° 1)', () => {
	test('les sept étapes du workflow standard, dans l’ordre de leur position', async ({ request }) => {
		const reponse = await request.get(
			`${ETAPES}?select=${encodeURIComponent(COLONNES_ETAPE)}&workflow_id=eq.${WORKFLOW_GLOBAL}&order=position`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const etapes = (await reponse.json()) as EtapeLue[]
		expect(etapes).toHaveLength(7)
		expect(etapes.map((etape) => etape.position)).toEqual([1, 2, 3, 4, 5, 6, 7])
	})

	// La jointure est EMBARQUÉE côté serveur : sans elle, le libellé, la couleur et le seuil par
	// défaut exigeraient une seconde requête et un appariement que la base fait mieux (§7.2).
	test('la jointure embarquée vers le catalogue est réellement consentie', async ({ request }) => {
		const reponse = await request.get(
			`${ETAPES}?select=${encodeURIComponent(COLONNES_ETAPE)}&workflow_id=eq.${WORKFLOW_GLOBAL}&order=position`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const etapes = (await reponse.json()) as EtapeLue[]
		expect(etapes.every((etape) => etape.workflow_nodes_catalog !== null)).toBe(true)
		expect(etapes[0]?.workflow_nodes_catalog?.label).toBe('Prospection')
	})

	// Les deux replis du §7.2 sont exercés par le seed lui-même, et non par un cas fabriqué.
	test('le seed exerce la surcharge de libellé ET son absence', async ({ request }) => {
		const reponse = await request.get(
			`${ETAPES}?select=${encodeURIComponent(COLONNES_ETAPE)}&workflow_id=eq.${WORKFLOW_GLOBAL}&order=position`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const etapes = (await reponse.json()) as EtapeLue[]
		const surchargees = etapes.filter((etape) => etape.label_override !== null)
		expect(surchargees).toHaveLength(1)
		expect(surchargees[0]?.label_override).toBe('Réalisation en cours')
		expect(surchargees[0]?.workflow_nodes_catalog?.label).toBe('Réalisation')
		expect(etapes.filter((etape) => etape.label_override === null)).toHaveLength(6)
	})

	test('le seed exerce le seuil de relance surchargé ET le seuil absent (§7.4)', async ({ request }) => {
		const reponse = await request.get(
			`${ETAPES}?select=${encodeURIComponent(COLONNES_ETAPE)}&workflow_id=eq.${WORKFLOW_GLOBAL}&order=position`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const etapes = (await reponse.json()) as EtapeLue[]
		expect(etapes.filter((etape) => etape.stale_after_days !== null)).toHaveLength(1)
		const sansSeuil = etapes.filter(
			(etape) =>
				etape.stale_after_days === null &&
				etape.workflow_nodes_catalog?.default_stale_after_days === null,
		)
		expect(sansSeuil.length).toBeGreaterThan(0)
	})

	// Une couleur hors des cinq jetons ferait rendre un liseré que le design system ne connaît
	// pas ; le repli existe, et cette assertion vérifie qu'il n'a rien à faire sur le seed.
	test('les couleurs rendues appartiennent aux cinq jetons du design system', async ({ request }) => {
		const reponse = await request.get(
			`${ETAPES}?select=${encodeURIComponent(COLONNES_ETAPE)}&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const etapes = (await reponse.json()) as EtapeLue[]
		const jetons = ['brand', 'success', 'accent', 'danger', 'neutral']
		for (const etape of etapes) {
			expect(jetons).toContain(etape.workflow_nodes_catalog?.color)
		}
	})
})

test.describe('B2 — la lecture des transitions rend les gestes atteignables (§7.2, lecture n° 2)', () => {
	test('les onze transitions du workflow standard', async ({ request }) => {
		const reponse = await request.get(
			`${TRANSITIONS}?select=${encodeURIComponent(COLONNES_TRANSITION)}&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const transitions = (await reponse.json()) as { from_step_id: string; require_comment: boolean }[]
		expect(transitions).toHaveLength(11)
	})

	// C'est la donnée qui rend le menu non vide, et c'est elle qui rend le §7.8 démontrable.
	test('cinq transitions exigent un motif, et le seed les porte en permanence', async ({ request }) => {
		const reponse = await request.get(
			`${TRANSITIONS}?select=${encodeURIComponent(COLONNES_TRANSITION)}&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const transitions = (await reponse.json()) as { require_comment: boolean }[]
		expect(transitions.filter((transition) => transition.require_comment)).toHaveLength(5)
	})

	// MESURÉ : `Livré` et `Perdu` n'ont aucune transition sortante. C'est ce qui rend le bouton
	// désactivé et lisible du §7.7 démontrable par une donnée permanente.
	test('deux étapes du seed n’ont aucune transition sortante', async ({ request }) => {
		const [reponseEtapes, reponseTransitions] = await Promise.all([
			request.get(`${ETAPES}?select=id&workflow_id=eq.${WORKFLOW_GLOBAL}`, {
				headers: enTetesAuthentifies(jetonAdmin),
			}),
			request.get(`${TRANSITIONS}?select=from_step_id&workflow_id=eq.${WORKFLOW_GLOBAL}`, {
				headers: enTetesAuthentifies(jetonAdmin),
			}),
		])
		const ids = ((await reponseEtapes.json()) as { id: string }[]).map((etape) => etape.id)
		const departs = new Set(
			((await reponseTransitions.json()) as { from_step_id: string }[]).map(
				(transition) => transition.from_step_id,
			),
		)
		expect(ids.filter((id) => !departs.has(id))).toHaveLength(2)
	})

	// `label` est nullable (§7.5) : le repli « Passer à <étape> » existe pour cette raison. Le
	// seed ne l'exerce pas — l'assertion FIGE ce fait, plutôt que de le laisser se perdre.
	test('le seed nomme toutes ses transitions, et le repli du §7.5 n’y est donc pas exercé', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${TRANSITIONS}?select=${encodeURIComponent(COLONNES_TRANSITION)}&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const transitions = (await reponse.json()) as { label: string | null }[]
		expect(transitions.filter((transition) => transition.label === null)).toHaveLength(0)
	})
})

test.describe('B3 — la lecture des cards rend le contenu des colonnes (§7.2, lecture n° 3)', () => {
	const requeteCards = `${CARDS}?select=${encodeURIComponent(COLONNES_CARD_BOARD)}&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&archived_at=is.null&deleted_at=is.null&order=position,title`

	// RÉVISÉ PAR `CRM-046` (décision 51) : `grands-comptes` portait TROIS cards actives, il en porte
	// QUATRE — `…0cd` y occupe l'étape « Livré », dont la seule card était archivée, donc invisible
	// de tout écran (docs/SPEC-seed.md §9.3).
	test('les quatre cards actives de `grands-comptes`, et elles seules', async ({ request }) => {
		const reponse = await request.get(requeteCards, { headers: enTetesAuthentifies(jetonAdmin) })
		expect(reponse.status()).toBe(200)
		const cards = (await reponse.json()) as CardLue[]
		expect(cards).toHaveLength(4)
	})

	// Les deux exclusions sont CÔTÉ SERVEUR : c'est la définition d'« active » de
	// docs/SPEC-cards.md §5, la même qu'emploie la première vérification de `move_card`. Sans
	// cette assertion, un filtre retiré passerait inaperçu — l'écran afficherait simplement deux
	// cards de plus.
	test('la card archivée et celle en corbeille sont exclues par le serveur', async ({ request }) => {
		const reponse = await request.get(requeteCards, { headers: enTetesAuthentifies(jetonAdmin) })
		const ids = ((await reponse.json()) as CardLue[]).map((card) => card.id)
		expect(ids).not.toContain(CARD_ARCHIVEE)
		expect(ids).not.toContain(CARD_CORBEILLE)

		// Contre-épreuve : sans les filtres, la même requête en rend SIX — quatre actives, plus
		// l'archivée et celle en corbeille. L'exclusion est donc bien l'effet des filtres, et non
		// celui d'une politique qui masquerait ces deux lignes.
		const sansFiltres = await request.get(
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect((await sansFiltres.json()) as { id: string }[]).toHaveLength(6)
	})

	// MESURÉ, ET RÉVISÉ PAR `CRM-046` : `grands-comptes` n'occupait que DEUX étapes sur sept, il en
	// occupe TROIS. Quatre colonnes vides restent la situation normale d'un channel — « aucun écran
	// vide » (docs/SPEC-seed.md §9.1) porte sur le CHANNEL, jamais sur chacune de ses colonnes —, et
	// c'est ce que la composition partant des étapes doit produire.
	test('les cards n’occupent que trois des sept étapes du workflow', async ({ request }) => {
		const reponse = await request.get(requeteCards, { headers: enTetesAuthentifies(jetonAdmin) })
		const cards = (await reponse.json()) as CardLue[]
		const etapes = new Set(cards.map((card) => card.current_step_id))
		expect([...etapes].sort()).toEqual([ETAPE_PROSPECTION, ETAPE_RELANCE, ETAPE_LIVRE].sort())
	})

	test('l’ordre est celui des colonnes : position, puis titre', async ({ request }) => {
		const reponse = await request.get(requeteCards, { headers: enTetesAuthentifies(jetonAdmin) })
		const cards = (await reponse.json()) as CardLue[]
		const relance = cards.filter((card) => card.current_step_id === ETAPE_RELANCE)
		expect(relance.map((card) => card.position)).toEqual([...relance.map((c) => c.position)].sort())
	})

	// Le seed porte des cards avec et sans montant : les deux branches du §7.4 sont exercées par
	// une donnée permanente, pas par un cas fabriqué.
	test('le seed exerce le montant renseigné ET son absence', async ({ request }) => {
		const toutes = await request.get(
			`${CARDS}?select=amount,currency&deleted_at=is.null&archived_at=is.null`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const cards = (await toutes.json()) as { amount: number | null; currency: string }[]
		expect(cards.filter((card) => card.amount === null).length).toBeGreaterThan(0)
		expect(cards.filter((card) => card.amount !== null).length).toBeGreaterThan(0)
		expect(new Set(cards.map((card) => card.currency)).size).toBeGreaterThan(1)
	})
})

test.describe('B4 — la lecture des libellés de champs sert les refus (§7.2, lecture n° 4)', () => {
	test('les champs du workflow sont lisibles, avec leur clé et leur libellé', async ({ request }) => {
		const reponse = await request.get(
			`${CHAMPS}?select=${encodeURIComponent(COLONNES_CHAMP_LIBELLE)}&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status()).toBe(200)
		const champs = (await reponse.json()) as { key: string; label: string }[]
		expect(champs.length).toBeGreaterThan(0)
		expect(champs.every((champ) => champ.label.trim() !== '')).toBe(true)
	})

	// LE POINT DE JONCTION. `move_card` rapporte les CLÉS manquantes dans son `DETAIL` (décision
	// 126) ; le board les traduit avec cette lecture. Si la clé que la garde nomme n'était pas
	// dans cette table, l'écran afficherait une clé brute là où le §7.10 promet un libellé.
	test('la clé que la garde rapporte dans son `DETAIL` a bien un libellé ici', async ({ request }) => {
		const reponse = await request.get(
			`${CHAMPS}?select=${encodeURIComponent(COLONNES_CHAMP_LIBELLE)}&workflow_id=eq.${WORKFLOW_GLOBAL}&key=eq.lien-proposition`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const champs = (await reponse.json()) as { key: string; label: string }[]
		expect(champs).toHaveLength(1)
		expect(champs[0]?.label).toBe('Lien vers la proposition')
	})
})

test.describe('B5 — les identités consenties au board sont mesurées (§7.4)', () => {
	// CRM-022 clôt INC-014 : tous les membres d'une même équipe lisent les profils de cette équipe.
	// La jointure embarquée doit donc rendre une identité exploitable, jamais un UUID brut.
	test('l’administratrice lit exactement les trois profils seedés et les responsables embarqués', async ({
		request,
	}) => {
		const reponse = await request.get(`${PROFILS}?select=id,full_name&order=id`, {
			headers: enTetesAuthentifies(jetonAdmin),
		})
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([
			{ id: '5eed0000-0000-4000-8000-000000000011', full_name: 'Camille Aubert' },
			{ id: '5eed0000-0000-4000-8000-000000000012', full_name: 'Driss Lemoine' },
			{ id: '5eed0000-0000-4000-8000-000000000013', full_name: 'Farida Nowak' },
		])

		const cards = await request.get(
			`${CARDS}?select=${encodeURIComponent(COLONNES_CARD_BOARD)}` +
				`&channel_id=eq.${CHANNEL_GRANDS_COMPTES}&owner_id=not.is.null`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const lignes = (await cards.json()) as CardLue[]
		expect(lignes.length).toBeGreaterThan(0)
		for (const card of lignes) {
			expect(card.responsable?.id).toBe(card.owner_id)
			expect(card.responsable?.full_name.trim()).not.toBe('')
			expect(card.responsable?.avatar_url).toMatch(/^\/avatars\/[a-z-]+\.svg$/)
		}
	})

	// SCÉNARIO RETOURNÉ — décision 51, et le motif est écrit ici plutôt que dans un journal.
	//
	// Il assérait « aucune card du seed n'atteint son seuil de relance » et bornait l'âge de
	// TOUTES les cards à cinq jours. Il figeait une ABSENCE, celle que la tranche 3 de `CRM-046`
	// comble (docs/SPEC-seed.md §9.12) : le seed pose désormais `…0c3` à trente jours d'une étape
	// dont le seuil est de quatorze. L'assertion n'est pas retirée — elle est retournée, et mesure
	// contre la vraie API les lignes *a* à *e* du contrat du §9.12.6.
	//
	// LE SEUIL EST RELU DEPUIS L'ÉTAPE ET SON NŒUD, jamais recopié : `stale_after_days` de l'étape
	// s'il existe, sinon `default_stale_after_days` du nœud. C'est la règle exacte que
	// `evaluerAnciennete` applique, et la seule façon que ce scénario reste vrai si le seuil du
	// catalogue change.
	test('une card du seed, et une seule, dépasse son seuil de relance', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=id,entered_step_at,workflow_steps!cards_current_step_id_workflow_id_fkey(stale_after_days,workflow_nodes_catalog(default_stale_after_days))&deleted_at=is.null&archived_at=is.null`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		expect(reponse.status(), await reponse.text()).toBe(200)
		const cards = (await reponse.json()) as {
			id: string
			entered_step_at: string
			workflow_steps: {
				stale_after_days: number | null
				workflow_nodes_catalog: { default_stale_after_days: number | null } | null
			} | null
		}[]
		expect(cards.length).toBeGreaterThan(0)

		const JOUR = 24 * 60 * 60 * 1000
		const avecSeuil = cards
			.map((card) => ({
				id: card.id,
				jours: Math.floor((Date.now() - new Date(card.entered_step_at).getTime()) / JOUR),
				seuil:
					card.workflow_steps?.stale_after_days ??
					card.workflow_steps?.workflow_nodes_catalog?.default_stale_after_days ??
					null,
			}))
			.filter((card): card is { id: string; jours: number; seuil: number } => card.seuil !== null)

		const auDela = avecSeuil.filter((card) => card.jours >= card.seuil)
		// Ligne *a* : exactement une, et ligne *b* : c'est celle que le §9.12.1 nomme.
		expect(auDela).toHaveLength(1)
		expect(auDela[0]?.id).toBe(CARD_EN_RETARD)
		// Ligne *c* : trente jours pleins, et pas trente et un — le seed la repose à chaque passage.
		expect(auDela[0]?.jours).toBe(30)
		// Ligne *d* : le seuil est celui du nœud `prospection`, non surchargé par l'étape.
		expect(auDela[0]?.seuil).toBe(14)
		// Ligne *e* : sans une card EN DEÇÀ, « au-delà » ne serait pas un contraste.
		expect(avecSeuil.filter((card) => card.jours < card.seuil).length).toBeGreaterThan(0)
	})

	// Ligne *d* de nouveau, mais lue à sa source : le scénario ci-dessus prouverait la même chose
	// si l'étape portait `14` en surcharge. Le §9.12.1 dit « hérité du nœud », et c'est mesurable.
	test('le seuil de la card en retard est hérité du nœud, non surchargé par l’étape', async ({
		request,
	}) => {
		const reponse = await request.get(
			`${ETAPES}?select=id,stale_after_days,workflow_nodes_catalog(default_stale_after_days)&id=eq.${ETAPE_PROSPECTION}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const [etape] = (await reponse.json()) as {
			stale_after_days: number | null
			workflow_nodes_catalog: { default_stale_after_days: number | null } | null
		}[]
		expect(etape?.stale_after_days).toBeNull()
		expect(etape?.workflow_nodes_catalog?.default_stale_after_days).toBe(14)
	})

	// Ligne *f* : la card ARCHIVÉE de « Livré » n'est pas vieillie. Sans cette ligne, un seed qui
	// vieillirait tout ce qu'il trouve passerait les deux scénarios ci-dessus — l'étape « Livré »
	// ne portant aucun seuil, ses cards ne sont comptées nulle part.
	test('aucune card archivée n’est vieillie par le seed', async ({ request }) => {
		const reponse = await request.get(
			`${CARDS}?select=id,entered_step_at&id=eq.${CARD_ARCHIVEE}`,
			{ headers: enTetesAuthentifies(jetonAdmin) },
		)
		const [card] = (await reponse.json()) as { entered_step_at: string }[]
		const JOUR = 24 * 60 * 60 * 1000
		expect(Math.floor((Date.now() - new Date(card.entered_step_at).getTime()) / JOUR)).toBe(0)
	})
})

test.describe('B6 — l’anonyme n’obtient aucune colonne, et c’est la cause de l’écran vide', () => {
	// Le refus est mesuré comme ZÉRO LIGNE, jamais comme une erreur
	// (docs/SPEC-permissions-rls.md §7). Les quatre lectures sont opposées à l'anonyme d'un seul
	// tenant : c'est l'ensemble qui rend le board inaffichable, pas l'une d'elles.
	for (const [nom, chemin] of [
		['étapes', `${ETAPES}?select=id&workflow_id=eq.${WORKFLOW_GLOBAL}`],
		['transitions', `${TRANSITIONS}?select=id&workflow_id=eq.${WORKFLOW_GLOBAL}`],
		['cards', `${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}`],
		['champs', `${CHAMPS}?select=key&workflow_id=eq.${WORKFLOW_GLOBAL}`],
	] as const) {
		test(`l’anonyme obtient 200 et zéro ligne sur les ${nom}`, async ({ request }) => {
			const reponse = await request.get(chemin, { headers: enTetesAnonymes() })
			expect(reponse.status()).toBe(200)
			expect((await reponse.json()) as unknown[]).toEqual([])
		})
	}

	// Condition de validité : sans elle, les quatre assertions ci-dessus seraient vertes que la
	// RLS refuse ou que les tables soient vides (docs/JOURNAL.md décision 50).
	test('les quatre tables sont pourtant non vides, vues par l’administratrice', async ({ request }) => {
		for (const chemin of [
			`${ETAPES}?select=id&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			`${TRANSITIONS}?select=id&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			`${CARDS}?select=id&channel_id=eq.${CHANNEL_GRANDS_COMPTES}`,
			`${CHAMPS}?select=key&workflow_id=eq.${WORKFLOW_GLOBAL}`,
		]) {
			const reponse = await request.get(chemin, { headers: enTetesAuthentifies(jetonAdmin) })
			expect(((await reponse.json()) as unknown[]).length).toBeGreaterThan(0)
		}
	})

	// Le track de l'adresse n'est pas résolu non plus : la route rend « track introuvable » AVANT
	// d'atteindre le board. C'est la raison pour laquelle aucune capture ne montre un board
	// chargé (§7.12).
	test('le track de l’adresse n’est pas même résolu pour un anonyme', async ({ request }) => {
		const reponse = await request.get(
			`/rest/v1/tracks?select=id&id=eq.${TRACK_CONSEIL_IA}&archived_at=is.null`,
			{ headers: enTetesAnonymes() },
		)
		expect(reponse.status()).toBe(200)
		expect((await reponse.json()) as unknown[]).toEqual([])
	})
})
