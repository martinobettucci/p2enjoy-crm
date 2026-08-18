// @verifies CRM-078 (docs/BACKLOG.md) — cinquième tranche : le module de données des écrans
// @verifies docs/SPEC-workflow-engine.md §7 ter.14.3 (lecture 8, ses colonnes et son ordre),
//           §7 ter.14.4 (les quatre gestes, et ce qui n'est PAS transmis),
//           §7 ter.14.5 (les instructions portent sur les étapes retirées, aucune n'est devinée),
//           §7 ter.14.6 (les quatre replis du nommage), §7 ter.14.7 (dictionnaire fermé des refus),
//           §7 ter.14.8 (aucune concurrence optimiste depuis l'écran)
// @verifies docs/SPEC-workflow-engine.md §7 ter.11.4 (forme de la comparaison),
//           §7 ter.12.6 et §7 ter.12.7 (forme du plan, ordre et troncature),
//           §7 ter.13.8 (forme de la restauration)
//
// PLUSIEURS ASSERTIONS SONT ÉCRITES « EN NÉGATIF », et ce sont les plus utiles : ni `card_limit`
// ni `expected_live_fingerprint` ne doivent partir, et une étape sans instruction ne doit produire
// AUCUNE instruction. Une régression qui ajouterait l'un de ces trois éléments par symétrie avec
// le contrat d'API ne changerait la forme d'aucune valeur rendue, et rien d'autre ne le dirait.
//
// Les documents éprouvés ici sont ceux MESURÉS sur la pile seedée le 2026-08-15 : la version du
// seed, son plan à treize affaires, et la comparaison d'une version à elle-même.

import { describe, expect, it } from 'vitest'
import {
	COLONNES_VERSION,
	choixParDefaut,
	classerRefusVersion,
	comparerVersions,
	composerComparaison,
	composerInstructions,
	composerPlan,
	composerRestauration,
	etapesDeLaVersion,
	lireVersions,
	nommerElement,
	planifierRemappage,
	publierVersion,
	rendreValeur,
	restaurerVersion,
	type VersionWorkflow,
} from './versions-workflow'
import type { ClientCrm } from './supabase'

const WORKFLOW = '5eed0000-0000-4000-8000-000000000051'
const VERSION = '08699af3-5a90-4a78-9b09-af9e05782496'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_QUALIFICATION = '5eed0000-0000-4000-8000-000000000062'
const CHAMP_BUDGET = '5eed0000-0000-4000-8000-000000000081'

type Reponse = { data: unknown; error: { message: string } | null; status: number }

type AppelLecture = {
	table: string
	colonnes: string
	filtres: [string, string, unknown][]
	ordres: [string, unknown][]
}

/** Transport espion de la lecture 8 : il retient colonnes, filtres et ordre réellement émis. */
function espionLecture(reponse: Reponse): { client: ClientCrm; appels: AppelLecture[] } {
	const appels: AppelLecture[] = []
	const client = {
		from: (table: string) => ({
			select: (colonnes: string) => {
				const appel: AppelLecture = { table, colonnes, filtres: [], ordres: [] }
				appels.push(appel)
				const chaine = {
					eq: (colonne: string, valeur: unknown) => {
						appel.filtres.push(['eq', colonne, valeur])
						return chaine
					},
					order: (colonne: string, options: unknown) => {
						appel.ordres.push([colonne, options])
						return chaine
					},
					then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
				}
				return chaine
			},
		}),
	} as unknown as ClientCrm
	return { client, appels }
}

/** Transport espion des quatre RPC : il retient le nom appelé et les arguments transmis. */
function espionRpc(reponse: Reponse): {
	client: ClientCrm
	appels: { nom: string; params: Record<string, unknown> }[]
} {
	const appels: { nom: string; params: Record<string, unknown> }[] = []
	const client = {
		rpc: (nom: string, params: Record<string, unknown>) => {
			appels.push({ nom, params })
			return {
				then: (resoudre: (valeur: unknown) => unknown) => Promise.resolve(reponse).then(resoudre),
			}
		},
	} as unknown as ClientCrm
	return { client, appels }
}

const ok = (data: unknown): Reponse => ({ data, error: null, status: 200 })
const refuse = (message: string): Reponse => ({ data: null, error: { message }, status: 400 })

// ---------------------------------------------------------------------------------------------
// Lecture 8 — §7 ter.14.3
// ---------------------------------------------------------------------------------------------

describe('lireVersions (§7 ter.14.3)', () => {
	it('filtre sur le workflow et ordonne par numéro DÉCROISSANT, profil embarqué', async () => {
		const { client, appels } = espionLecture(ok([]))
		await lireVersions(client, WORKFLOW)

		expect(appels).toHaveLength(1)
		expect(appels[0]).toMatchObject({
			table: 'workflow_versions',
			colonnes: COLONNES_VERSION,
			filtres: [['eq', 'workflow_id', WORKFLOW]],
			ordres: [['version_number', { ascending: false }]],
		})
		// Le nommage explicite de la clé étrangère n'est pas un détail de style : sans lui,
		// PostgREST rend `300`, `profiles` étant atteignable par plusieurs chemins.
		expect(COLONNES_VERSION).toContain('profiles!workflow_versions_published_by_fkey')
		// La composition est lue avec la ligne : le §7 ter.14.5 y prend les destinations offertes.
		expect(COLONNES_VERSION).toContain('composition')
	})

	it('compose la ligne mesurée du seed, auteur embarqué compris', async () => {
		const { client } = espionLecture(
			ok([
				{
					id: VERSION,
					version_number: 1,
					note: 'Composition de référence livrée par le seed',
					published_at: '2026-08-15T16:15:49.405617+00:00',
					composition_fingerprint:
						'5ae889f8427111c0faf96a64edffaf98210deda1a37d5e1ec79b16fa1bb42725',
					composition: { steps: [] },
					auteur: { full_name: 'Camille Aubert' },
				},
			]),
		)
		const lues = await lireVersions(client, WORKFLOW)

		expect(lues.statut).toBe('pret')
		if (lues.statut !== 'pret') return
		expect(lues.donnees[0]).toMatchObject({
			id: VERSION,
			version_number: 1,
			auteur: 'Camille Aubert',
		})
	})

	it('rend `null` — jamais `undefined` — pour un auteur détaché ou absent', async () => {
		const { client } = espionLecture(
			ok([
				{ id: 'v-1', version_number: 2, note: null, published_at: 'x', composition_fingerprint: 'y', composition: null, auteur: null },
				// Une ligne AMPUTÉE de ses colonnes : le type décrit ce que PostgREST rend, il ne le
				// garantit pas. Aucune valeur `undefined` ne doit sortir du module.
				{ id: 'v-2' },
			]),
		)
		const lues = await lireVersions(client, WORKFLOW)

		expect(lues.statut).toBe('pret')
		if (lues.statut !== 'pret') return
		expect(lues.donnees[0]?.auteur).toBeNull()
		expect(lues.donnees[1]).toEqual({
			id: 'v-2',
			version_number: 0,
			note: null,
			published_at: '',
			composition_fingerprint: '',
			auteur: null,
			composition: null,
		})
	})

	it('rend une erreur classée, et non un tableau vide, quand la lecture est refusée', async () => {
		const { client } = espionLecture({ data: null, error: { message: 'refus' }, status: 403 })
		const lues = await lireVersions(client, WORKFLOW)

		expect(lues.statut).toBe('erreur')
		if (lues.statut !== 'erreur') return
		expect(lues.erreur.nature).toBe('forbidden')
	})
})

describe('choixParDefaut (§7 ter.14.4)', () => {
	const version = (id: string, numero: number): VersionWorkflow => ({
		id,
		version_number: numero,
		note: null,
		published_at: '',
		composition_fingerprint: '',
		auteur: null,
		composition: null,
	})

	it('cible la plus récente et prend la précédente en base', () => {
		expect(choixParDefaut([version('v-3', 3), version('v-2', 2), version('v-1', 1)])).toEqual({
			base: 'v-2',
			cible: 'v-3',
		})
	})

	it('désigne DEUX FOIS la même version quand il n’en existe qu’une', () => {
		// Le §7 ter.11.3 accepte explicitement ce cas et rend `identical` : le refuser obligerait
		// l'écran à tester l'égalité avant d'appeler.
		expect(choixParDefaut([version('v-1', 1)])).toEqual({ base: 'v-1', cible: 'v-1' })
	})

	it('ne choisit rien quand le workflow n’a aucune version', () => {
		expect(choixParDefaut([])).toEqual({ base: null, cible: null })
	})
})

// ---------------------------------------------------------------------------------------------
// Les refus — §7 ter.14.7
// ---------------------------------------------------------------------------------------------

describe('classerRefusVersion (§7 ter.14.7)', () => {
	it.each([
		['composition inchangee', 'composition-inchangee'],
		['workflow archive', 'workflow-archive'],
		['workflow introuvable', 'introuvable'],
		['version introuvable', 'introuvable'],
		['publication reservee aux administrateurs', 'administrateurs'],
		['plan reserve aux administrateurs', 'administrateurs'],
		['restauration reservee aux administrateurs', 'administrateurs'],
		['versions de workflows differents', 'workflows-differents'],
		['plan non applicable', 'plan-non-applicable'],
		['structure modifiee depuis le plan', 'structure-modifiee'],
		['remappage invalide', 'remappage-refuse'],
		['remappage ambigu', 'remappage-refuse'],
		['origine de remappage inconnue', 'remappage-refuse'],
		['cible de remappage absente de la version', 'remappage-refuse'],
		['limite invalide', 'limite-invalide'],
	])('classe « %s »', (message, attendu) => {
		expect(classerRefusVersion(message)).toBe(attendu)
	})

	it('se replie sur `generique` plutôt que d’exposer un message inconnu', () => {
		expect(classerRefusVersion('duplicate key value violates unique constraint')).toBe('generique')
		expect(classerRefusVersion(null)).toBe('generique')
		expect(classerRefusVersion(undefined)).toBe('generique')
	})

	it('tolère les espaces et la casse, la base écrivant ses messages sans accent', () => {
		expect(classerRefusVersion('  Composition Inchangee  ')).toBe('composition-inchangee')
	})
})

// ---------------------------------------------------------------------------------------------
// Publier — §7 ter.14.4
// ---------------------------------------------------------------------------------------------

describe('publierVersion (§7 ter.5, §7 ter.14.4)', () => {
	it('transmet la note nettoyée, et rend le numéro obtenu', async () => {
		const { client, appels } = espionRpc(ok({ id: VERSION, version_number: 2 }))
		const issue = await publierVersion(client, WORKFLOW, '  Avant refonte  ')

		expect(appels[0]).toEqual({
			nom: 'publish_workflow_version',
			params: { target_workflow_id: WORKFLOW, note: 'Avant refonte' },
		})
		expect(issue).toEqual({ statut: 'ok', donnees: { version_number: 2 } })
	})

	it('OMET la note vide au lieu de transmettre une chaîne blanche', async () => {
		const { client, appels } = espionRpc(ok({ id: VERSION, version_number: 1 }))
		await publierVersion(client, WORKFLOW, '   ')

		expect(appels[0]?.params).toEqual({ target_workflow_id: WORKFLOW })
	})

	it('classe le refus « composition inchangee » plutôt que de le laisser passer', async () => {
		const { client } = espionRpc(refuse('composition inchangee'))
		expect(await publierVersion(client, WORKFLOW, '')).toEqual({
			statut: 'refus',
			refus: 'composition-inchangee',
		})
	})
})

// ---------------------------------------------------------------------------------------------
// Comparer et nommer — §7 ter.11.4, §7 ter.14.6
// ---------------------------------------------------------------------------------------------

const COMPARAISON_IDENTIQUE = {
	base: { version_id: VERSION, version_number: 1, published_at: 'x', composition_fingerprint: 'f' },
	target: { version_id: VERSION, version_number: 1, published_at: 'x', composition_fingerprint: 'f' },
	identical: true,
	summary: { added: 0, removed: 0, modified: 0 },
	changes: {
		workflow: { modified: [] },
		steps: { added: [], removed: [], modified: [] },
		transitions: { added: [], removed: [], modified: [] },
		fields: { added: [], removed: [], modified: [] },
		rules: { added: [], removed: [], modified: [] },
		required_fields: { added: [], removed: [], modified: [] },
	},
}

describe('composerComparaison (§7 ter.11.4)', () => {
	it('rend six collections vides et `identique` sur la comparaison mesurée d’une version à elle-même', () => {
		const rendue = composerComparaison(COMPARAISON_IDENTIQUE, new Map())
		expect(rendue).not.toBeNull()
		expect(rendue?.identique).toBe(true)
		expect(rendue?.collections).toHaveLength(6)
		expect(rendue?.collections.every((collection) => collection.elements.length === 0)).toBe(true)
	})

	it('range chaque élément sous son genre, et porte les attributs d’une modification', () => {
		const rendue = composerComparaison(
			{
				...COMPARAISON_IDENTIQUE,
				identical: false,
				summary: { added: 1, removed: 1, modified: 1 },
				changes: {
					...COMPARAISON_IDENTIQUE.changes,
					steps: {
						added: [
							{ identity: { id: 'e-neuve' }, element: { id: 'e-neuve', node_label: 'Cadrage' } },
						],
						removed: [
							{ identity: { id: 'e-partie' }, element: { id: 'e-partie', node_label: 'Relance' } },
						],
						modified: [
							{
								identity: { id: ETAPE_PROSPECTION },
								attributes: [{ name: 'node_label', before: 'Prospection', after: 'Détection' }],
							},
						],
					},
				},
			},
			new Map(),
		)
		const etapes = rendue?.collections.find((collection) => collection.cle === 'steps')

		expect(etapes?.elements.map((element) => element.genre)).toEqual([
			'ajout',
			'retrait',
			'modification',
		])
		expect(etapes?.elements[2]?.attributs).toEqual([
			{ nom: 'node_label', avant: 'Prospection', apres: 'Détection' },
		])
	})

	it('refuse un document illisible plutôt que d’en inventer un vide', () => {
		expect(composerComparaison(null, new Map())).toBeNull()
		expect(composerComparaison({ base: {}, target: {} }, new Map())).toBeNull()
	})
})

describe('nommerElement — les quatre replis (§7 ter.14.6)', () => {
	it('1. prend le libellé du DOCUMENT rendu, seul endroit qui nomme ce que la base ne porte plus', () => {
		expect(
			nommerElement(
				{ id: ETAPE_PROSPECTION, node_label: 'Prospection', label_override: 'Détection' },
				{ id: ETAPE_PROSPECTION },
				[],
				new Map(),
			),
		).toEqual({ genre: 'libelle', texte: 'Détection' })
	})

	it('2. nomme une modification par l’attribut de libellé, avant et après', () => {
		expect(
			nommerElement(
				null,
				{ id: ETAPE_PROSPECTION },
				[{ nom: 'label', avant: 'Relancer', apres: 'Recontacter' }],
				new Map(),
			),
		).toEqual({ genre: 'renomme', avant: 'Relancer', apres: 'Recontacter' })
	})

	it('3. se replie sur la structure VIVANTE quand l’identité est simple', () => {
		expect(
			nommerElement(
				null,
				{ id: ETAPE_QUALIFICATION },
				[{ nom: 'position', avant: '1', apres: '2' }],
				new Map([[ETAPE_QUALIFICATION, 'Qualification']]),
			),
		).toEqual({ genre: 'libelle', texte: 'Qualification' })
	})

	it('4. rend les identifiants d’une identité COMPOSÉE, jamais une phrase à trou', () => {
		// Une règle est identifiée par le couple `(field_id, step_id)` : aucun nom ne s'en déduit,
		// et le §7 ter.14.6 exige les identifiants plutôt qu'une phrase incomplète.
		expect(
			nommerElement(
				null,
				{ field_id: CHAMP_BUDGET, step_id: ETAPE_PROSPECTION },
				[],
				new Map([[CHAMP_BUDGET, 'Budget estimé']]),
			),
		).toEqual({ genre: 'identifiants', valeurs: [CHAMP_BUDGET, ETAPE_PROSPECTION] })
	})
})

describe('rendreValeur (§7 ter.14.6)', () => {
	it('distingue l’absence de valeur de la chaîne « null »', () => {
		expect(rendreValeur(null)).toBeNull()
		expect(rendreValeur(undefined)).toBeNull()
		expect(rendreValeur('null')).toBe('null')
		expect(rendreValeur(0)).toBe('0')
		expect(rendreValeur(false)).toBe('false')
	})
})

describe('comparerVersions (§7 ter.11.3)', () => {
	it('transmet les deux versions dans l’ORDRE reçu — l’orientation appartient à l’appelant', async () => {
		const { client, appels } = espionRpc(ok(COMPARAISON_IDENTIQUE))
		await comparerVersions(client, 'v-1', 'v-2', new Map())

		expect(appels[0]).toEqual({
			nom: 'compare_workflow_versions',
			params: { base_version_id: 'v-1', target_version_id: 'v-2' },
		})
	})

	it('classe le refus de deux versions étrangères l’une à l’autre', async () => {
		const { client } = espionRpc(refuse('versions de workflows differents'))
		expect(await comparerVersions(client, 'v-1', 'v-2', new Map())).toEqual({
			statut: 'refus',
			refus: 'workflows-differents',
		})
	})
})

// ---------------------------------------------------------------------------------------------
// Planifier — §7 ter.12.6, §7 ter.12.7, §7 ter.14.5
// ---------------------------------------------------------------------------------------------

/** Le plan MESURÉ sur la pile seedée, `card_limit` à 3 sur treize affaires. */
const PLAN_MESURE = {
	version: {
		version_id: VERSION,
		version_number: 1,
		workflow_id: WORKFLOW,
		published_at: '2026-08-15T16:15:49.405617+00:00',
		composition_fingerprint: 'f',
	},
	ready: true,
	summary: {
		cards_total: 13,
		cards_unchanged: 13,
		cards_remapped: 0,
		cards_unresolved: 0,
		steps_removed: 0,
		steps_restored: 0,
	},
	steps: { removed: [], restored: [] },
	cards: {
		total: 13,
		returned: 3,
		truncated: true,
		limit: 3,
		items: [
			{
				card_id: '5eed0000-0000-4000-8000-0000000000c3',
				title: 'Audit sécurité applicative',
				state: 'active',
				channel_id: '5eed0000-0000-4000-8000-000000000032',
				current_step_id: ETAPE_PROSPECTION,
				target_step_id: ETAPE_PROSPECTION,
				resolution: 'unchanged',
			},
		],
	},
}

describe('composerPlan (§7 ter.12.6)', () => {
	it('rend les compteurs de la TOTALITÉ et la troncature de la page', () => {
		const plan = composerPlan(PLAN_MESURE)
		expect(plan?.resume).toEqual({
			total: 13,
			inchangees: 13,
			remappees: 0,
			nonResolues: 0,
			etapesRetirees: 0,
			etapesRetablies: 0,
		})
		expect(plan?.affaires).toMatchObject({ total: 13, rendues: 3, tronquee: true })
		expect(plan?.applicable).toBe(true)
	})

	it('conserve l’ORDRE rendu par la base, qui place les blocages en tête (§7 ter.12.7)', () => {
		const plan = composerPlan({
			...PLAN_MESURE,
			ready: false,
			cards: {
				...PLAN_MESURE.cards,
				items: [
					{ card_id: 'c-1', title: 'Bloquée', state: 'active', current_step_id: 'e', target_step_id: null, resolution: 'unresolved' },
					{ card_id: 'c-2', title: 'Remappée', state: 'archived', current_step_id: 'e', target_step_id: 'f', resolution: 'remapped' },
					{ card_id: 'c-3', title: 'Inchangée', state: 'deleted', current_step_id: 'f', target_step_id: 'f', resolution: 'unchanged' },
				],
			},
		})
		expect(plan?.affaires.items.map((affaire) => affaire.card_id)).toEqual(['c-1', 'c-2', 'c-3'])
		expect(plan?.affaires.items.map((affaire) => affaire.state)).toEqual([
			'active',
			'archived',
			'deleted',
		])
		expect(plan?.applicable).toBe(false)
	})

	it('rend les étapes retirées avec leur libellé et leur compte de blocages', () => {
		const plan = composerPlan({
			...PLAN_MESURE,
			ready: false,
			summary: { ...PLAN_MESURE.summary, cards_unresolved: 2, steps_removed: 1 },
			steps: {
				removed: [
					{
						step_id: ETAPE_QUALIFICATION,
						label: 'Qualification',
						cards_total: 2,
						cards_unresolved: 2,
						target_step_id: null,
					},
				],
				restored: [{ step_id: 'e-revenue', label: 'Cadrage' }],
			},
		})
		expect(plan?.retirees[0]).toEqual({
			step_id: ETAPE_QUALIFICATION,
			label: 'Qualification',
			cards_total: 2,
			cards_unresolved: 2,
			target_step_id: null,
		})
		expect(plan?.retablies).toEqual([{ step_id: 'e-revenue', label: 'Cadrage' }])
	})
})

describe('composerInstructions (§7 ter.14.5)', () => {
	it('n’engendre AUCUNE instruction pour une étape laissée sans choix', () => {
		expect(
			composerInstructions(
				new Map([
					[ETAPE_QUALIFICATION, ''],
					[ETAPE_PROSPECTION, ETAPE_QUALIFICATION],
				]),
			),
		).toEqual([{ from_step_id: ETAPE_PROSPECTION, to_step_id: ETAPE_QUALIFICATION }])
	})

	it('rend un ordre STABLE, deux compositions des mêmes choix étant égales', () => {
		const gauche = composerInstructions(
			new Map([
				['b', 'x'],
				['a', 'y'],
			]),
		)
		const droite = composerInstructions(
			new Map([
				['a', 'y'],
				['b', 'x'],
			]),
		)
		expect(gauche).toEqual(droite)
		expect(gauche.map((instruction) => instruction.from_step_id)).toEqual(['a', 'b'])
	})
})

describe('etapesDeLaVersion (§7 ter.14.5)', () => {
	const version = (composition: unknown): VersionWorkflow => ({
		id: VERSION,
		version_number: 1,
		note: null,
		published_at: '',
		composition_fingerprint: '',
		auteur: null,
		composition: composition as VersionWorkflow['composition'],
	})

	it('prend la surcharge de libellé, puis celui du catalogue — la forme mesurée du document', () => {
		expect(
			etapesDeLaVersion(
				version({
					steps: [
						{ id: ETAPE_PROSPECTION, node_label: 'Prospection', label_override: null },
						{ id: ETAPE_QUALIFICATION, node_label: 'Qualification', label_override: 'Tri' },
					],
				}),
			),
		).toEqual([
			{ id: ETAPE_PROSPECTION, libelle: 'Prospection' },
			{ id: ETAPE_QUALIFICATION, libelle: 'Tri' },
		])
	})

	it('rend l’identifiant plutôt qu’un vide quand l’étape n’a aucun libellé', () => {
		expect(etapesDeLaVersion(version({ steps: [{ id: 'e-nue' }] }))).toEqual([
			{ id: 'e-nue', libelle: 'e-nue' },
		])
	})

	it('rend une liste vide sur une version absente ou un document illisible', () => {
		expect(etapesDeLaVersion(null)).toEqual([])
		expect(etapesDeLaVersion(version('pas un objet'))).toEqual([])
	})
})

describe('planifierRemappage (§7 ter.14.4)', () => {
	it('ne transmet PAS `card_limit` : le défaut de 200 est celui de la fonction', async () => {
		const { client, appels } = espionRpc(ok(PLAN_MESURE))
		await planifierRemappage(client, VERSION, [])

		expect(appels[0]).toEqual({
			nom: 'plan_card_remapping',
			params: { target_version_id: VERSION },
		})
	})

	it('transmet les instructions quand il y en a', async () => {
		const { client, appels } = espionRpc(ok(PLAN_MESURE))
		await planifierRemappage(client, VERSION, [
			{ from_step_id: ETAPE_PROSPECTION, to_step_id: ETAPE_QUALIFICATION },
		])

		expect(appels[0]?.params['step_overrides']).toEqual([
			{ from_step_id: ETAPE_PROSPECTION, to_step_id: ETAPE_QUALIFICATION },
		])
	})

	it('classe le refus d’une origine de remappage inconnue', async () => {
		const { client } = espionRpc(refuse('origine de remappage inconnue'))
		expect(await planifierRemappage(client, VERSION, [])).toEqual({
			statut: 'refus',
			refus: 'remappage-refuse',
		})
	})
})

// ---------------------------------------------------------------------------------------------
// Restaurer — §7 ter.13.8, §7 ter.14.8
// ---------------------------------------------------------------------------------------------

describe('composerRestauration (§7 ter.13.8)', () => {
	it('rend les compteurs, le point de retour et sa publication', () => {
		const rendue = composerRestauration({
			version: { version_id: VERSION, version_number: 1, workflow_id: WORKFLOW, composition_fingerprint: 'f' },
			rollback_version: { version_id: 'v-retour', version_number: 3, published: true },
			cards: { remapped: 2 },
			steps: { created: 1, deleted: 1, updated: 4 },
			transitions: { created: 0, deleted: 0, updated: 0 },
			fields: { created: 0, unarchived: 1, archived: 1, updated: 2 },
			rules: { created: 0, deleted: 0, updated: 0 },
			required_fields: { created: 0, deleted: 0 },
			fingerprint_after: 'g',
			matches_version: false,
		})

		expect(rendue).toEqual({
			version: { version_number: 1 },
			pointDeRetour: { version_number: 3, publie: true },
			affairesDeplacees: 2,
			etapes: { creees: 1, supprimees: 1, majes: 4 },
			champs: { crees: 0, desarchives: 1, archives: 1, majes: 2 },
			conformeALaVersion: false,
		})
	})

	it('dit qu’une version jouait DÉJÀ le rôle de point de retour', () => {
		const rendue = composerRestauration({
			version: { version_id: VERSION, version_number: 1 },
			rollback_version: { version_id: 'v-2', version_number: 2, published: false },
			cards: { remapped: 0 },
			matches_version: true,
		})
		expect(rendue?.pointDeRetour).toEqual({ version_number: 2, publie: false })
		expect(rendue?.conformeALaVersion).toBe(true)
	})
})

describe('restaurerVersion (§7 ter.14.8)', () => {
	it('ne transmet PAS `expected_live_fingerprint` — aucune RPC publique ne rend l’empreinte vivante', async () => {
		const { client, appels } = espionRpc(
			ok({ version: { version_id: VERSION, version_number: 1 }, matches_version: true }),
		)
		await restaurerVersion(client, VERSION, [])

		expect(appels[0]).toEqual({
			nom: 'restore_workflow_version',
			params: { target_version_id: VERSION },
		})
		expect(appels[0]?.params).not.toHaveProperty('expected_live_fingerprint')
	})

	it('classe le refus d’un plan non applicable, remonté par la vérification 7', async () => {
		const { client } = espionRpc(refuse('plan non applicable'))
		expect(await restaurerVersion(client, VERSION, [])).toEqual({
			statut: 'refus',
			refus: 'plan-non-applicable',
		})
	})

	it('classe une exception du transport comme un refus, jamais comme un succès muet', async () => {
		const client = {
			rpc: () => {
				throw new Error('Failed to fetch')
			},
		} as unknown as ClientCrm
		expect(await restaurerVersion(client, VERSION, [])).toEqual({
			statut: 'refus',
			refus: 'generique',
		})
	})
})
