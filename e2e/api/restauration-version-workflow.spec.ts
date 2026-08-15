// @verifies CRM-078 (docs/BACKLOG.md) — versionnement des workflows, quatrième tranche :
//           l'application transactionnelle du plan et son retour arrière
// @verifies docs/SPEC-workflow-engine.md §7 ter.13.10 (contrat d'API, lignes a à r),
//           §7 ter.13.2 (le plan est rejoué dans la transaction), §7 ter.13.3 (ce que la
//           restauration touche), §7 ter.13.4 (les champs ne sont jamais supprimés),
//           §7 ter.13.5 (le point de retour publié), §7 ter.13.6 (le geste et ses huit refus),
//           §7 ter.13.8 (ce que la fonction rend), §7 ter.13.9 (autorisations)
// @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 3 au niveau des versions)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// trois profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé :
// cette tranche ne livre aucun écran (`docs/SPEC-workflow-engine.md` §7 ter.13.11).
//
// Ils reprennent une à une les dix-huit lignes du tableau du §7 ter.13.10.
//
// CE QUE CES PREUVES DOIVENT ATTRAPER, ET QUE LA SUITE pgTAP NE PEUT PAS :
//
//   * le `401` de l'anonyme, et non un `403`. Le privilège refuse avant la vérification 1, PostgREST
//     traitant l'absence de droit d'un appelant non authentifié comme une invitation à
//     s'authentifier (§4.4). En pgTAP, un `set role` ne peut pas produire cette distinction ;
//   * le `409` de la concurrence optimiste. La suite pgTAP éprouve son `SQLSTATE` `P0001`, mais le
//     CODE HTTP dépend de la table de correspondance de PostgREST, et lui seul dit à un écran que la
//     demande était valide et que c'est le monde qui a bougé (§7 ter.13.6, vérification 5) ;
//   * le fait que `step_overrides` et `expected_live_fingerprint`, tous deux FACULTATIFS, traversent
//     réellement PostgREST. Une RPC dont un argument facultatif ne serait pas franchissable par le
//     client serait verte en pgTAP et inutilisable par un écran.
//
// OÙ CHAQUE LIGNE SE JOUE, ET POURQUOI (§7 ter.13.10, précision du 2026-08-15). Restaurer PUBLIE un
// point de retour, et une version est immuable. La ligne a — la seule qui n'écrit rien — se joue
// donc sur la VRAIE version du seed, ce qui est précisément sa valeur probante. Toute ligne qui
// écrit se joue sur un workflow jetable, supprimé dans un `finally` : sans cela le harnais laisserait
// deux versions de plus au workflow par défaut du seed à chaque exécution.

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace du seed socle (`docs/SPEC-seed.md` §2). */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
/** Un track du seed, hôte des channels jetables. */
const TRACK_SEED = '5eed0000-0000-4000-8000-000000000022'
/** Le workflow par défaut du seed et sa version publiée par le seed lui-même (§7 ter.8). */
const WORKFLOW_SEED = '5eed0000-0000-4000-8000-000000000051'

const RPC_RESTAURER = '/rest/v1/rpc/restore_workflow_version'
const RPC_PUBLIER = '/rest/v1/rpc/publish_workflow_version'
const VERSIONS = '/rest/v1/workflow_versions'
const WF = '/rest/v1/workflows'
const STEPS = '/rest/v1/workflow_steps'
const TRANSITIONS = '/rest/v1/workflow_transitions'
const CHAMPS = '/rest/v1/form_fields'
const CHANNELS = '/rest/v1/channels'
const CARDS = '/rest/v1/cards'
const EVENEMENTS = '/rest/v1/card_events'
const WORKSPACES = '/rest/v1/workspaces'

/** Trois nœuds actifs du catalogue seedé, employés pour composer un workflow de preuve. */
const NOEUD_PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOEUD_NEGOCIATION = '5eed0000-0000-4000-8000-000000000043'
const NOEUD_SIGNATURE = '5eed0000-0000-4000-8000-000000000044'

/** La forme rendue par la RPC (§7 ter.13.8). */
type Restauration = {
	version: {
		version_id: string
		version_number: number
		workflow_id: string
		composition_fingerprint: string
	}
	rollback_version: { version_id: string; version_number: number; published: boolean }
	cards: { remapped: number }
	steps: { created: number; deleted: number; updated: number }
	transitions: { created: number; deleted: number; updated: number }
	fields: { created: number; unarchived: number; archived: number; updated: number }
	rules: { created: number; deleted: number; updated: number }
	required_fields: { created: number; deleted: number }
	fingerprint_after: string
	matches_version: boolean
}

/**
 * La forme d'erreur de PostgREST. La clé est `details` au PLURIEL — le `detail` du `raise` de
 * PostgreSQL y arrive sous ce nom, et lire `detail` rendrait `undefined` sur une erreur pourtant
 * bien remplie.
 */
type Refus = { code: string; message: string; details?: string | null }

/** Crée un workflow jetable par la clé de service et rend son identifiant. */
async function workflowJetable(api: APIRequestContext, nom: string): Promise<string> {
	const id = randomUUID()
	const reponse = await api.post(WF, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: { id, workspace_id: WORKSPACE_SEED, name: nom, scope: 'global', is_default: false },
	})
	expect(reponse.status(), `création du workflow jetable « ${nom} »`).toBe(201)
	return id
}

/** Ajoute une étape au workflow jetable, par la clé de service, et rend son identifiant. */
async function etapeJetable(
	api: APIRequestContext,
	workflowId: string,
	noeudId: string,
	position: number,
	initiale = false,
	libelle: string | null = null,
	id: string = randomUUID(),
): Promise<string> {
	const reponse = await api.post(STEPS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id,
			workflow_id: workflowId,
			workspace_id: WORKSPACE_SEED,
			node_id: noeudId,
			position,
			is_initial: initiale,
			label_override: libelle,
		},
	})
	expect(reponse.status(), 'création de l’étape jetable').toBe(201)
	return id
}

/** Ajoute une arête entre deux étapes du workflow jetable, et rend son identifiant. */
async function areteJetable(
	api: APIRequestContext,
	workflowId: string,
	depuis: string,
	vers: string,
	id: string = randomUUID(),
): Promise<string> {
	const reponse = await api.post(TRANSITIONS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id,
			workflow_id: workflowId,
			workspace_id: WORKSPACE_SEED,
			from_step_id: depuis,
			to_step_id: vers,
		},
	})
	expect(reponse.status(), 'création de l’arête jetable').toBe(201)
	return id
}

/** Crée un channel jetable porté par le workflow jetable. */
async function channelJetable(api: APIRequestContext, workflowId: string): Promise<string> {
	const id = randomUUID()
	const reponse = await api.post(CHANNELS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id,
			workspace_id: WORKSPACE_SEED,
			track_id: TRACK_SEED,
			name: `tst restauration ${id}`,
			slug: `tst-restauration-${id}`,
			workflow_id: workflowId,
			position: 99,
		},
	})
	expect(reponse.status(), 'création du channel jetable').toBe(201)
	return id
}

/** Crée une affaire jetable posée sur l'étape donnée. */
async function cardJetable(
	api: APIRequestContext,
	channelId: string,
	workflowId: string,
	etapeId: string,
	titre: string,
): Promise<string> {
	const id = randomUUID()
	const reponse = await api.post(CARDS, {
		headers: { ...enTetesService(), Prefer: 'return=representation' },
		data: {
			id,
			workspace_id: WORKSPACE_SEED,
			channel_id: channelId,
			workflow_id: workflowId,
			current_step_id: etapeId,
			title: titre,
			position: 1,
		},
	})
	expect(reponse.status(), `création de l’affaire « ${titre} »`).toBe(201)
	return id
}

/** Publie une version par la VRAIE RPC, avec le jeton de l'administratrice (§7 ter.8). */
async function publier(api: APIRequestContext, jeton: string, workflowId: string): Promise<string> {
	const reponse = await api.post(RPC_PUBLIER, {
		headers: enTetesAuthentifies(jeton),
		data: { target_workflow_id: workflowId },
	})
	expect(reponse.status(), 'publication d’une version de preuve').toBe(200)
	return ((await reponse.json()) as { id: string }).id
}

/** La restauration, jouée par le profil donné. */
async function restaurer(
	api: APIRequestContext,
	jeton: string,
	versionId: string,
	corps: Record<string, unknown> = {},
) {
	return api.post(RPC_RESTAURER, {
		headers: enTetesAuthentifies(jeton),
		data: { target_version_id: versionId, ...corps },
	})
}

/** Lit une version en base avec la clé de service : la RLS ne masque alors plus rien. */
async function versionEnBase(
	api: APIRequestContext,
	versionId: string,
): Promise<{ id: string; version_number: number; composition_fingerprint: string } | undefined> {
	const reponse = await api.get(
		`${VERSIONS}?id=eq.${versionId}&select=id,version_number,composition_fingerprint`,
		{ headers: enTetesService() },
	)
	expect(reponse.status()).toBe(200)
	return (
		(await reponse.json()) as {
			id: string
			version_number: number
			composition_fingerprint: string
		}[]
	)[0]
}

/** Supprime le workflow jetable et son channel : la cascade emporte étapes, versions et affaires. */
async function rendreLaBase(
	api: APIRequestContext,
	workflowId: string,
	channelId?: string,
): Promise<void> {
	if (channelId) {
		await api.delete(`${CARDS}?channel_id=eq.${channelId}`, { headers: enTetesService() })
		await api.delete(`${CHANNELS}?id=eq.${channelId}`, { headers: enTetesService() })
	}
	await api.delete(`${WF}?id=eq.${workflowId}`, { headers: enTetesService() })
}

/**
 * Une fixture complète : un workflow à deux étapes reliées par une arête, un channel, une affaire
 * sur l'étape d'arrivée, et une version de référence publiée par la VRAIE RPC qui décrit exactement
 * cette structure.
 */
async function fixture(api: APIRequestContext, jeton: string, nom: string) {
	const workflow = await workflowJetable(api, `Restauration — ${nom} ${randomUUID()}`)
	const depart = await etapeJetable(api, workflow, NOEUD_PROSPECTION, 1, true, 'Départ')
	const arrivee = await etapeJetable(api, workflow, NOEUD_NEGOCIATION, 2, false, 'Arrivée')
	const arete = await areteJetable(api, workflow, depart, arrivee)
	const channel = await channelJetable(api, workflow)
	const affaire = await cardJetable(api, channel, workflow, arrivee, 'tst restauration affaire')
	const version = await publier(api, jeton, workflow)
	return { workflow, depart, arrivee, arete, channel, affaire, version }
}

test.describe('N1 — le cas qui n’écrit rien, sur la structure RÉELLE du seed (ligne a)', () => {
	test('ligne a — structure vivante inchangée : aucun compteur, aucun point de retour publié', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const versions = await request.get(
			`${VERSIONS}?workflow_id=eq.${WORKFLOW_SEED}&order=version_number.desc&limit=1`,
			{ headers: enTetesAuthentifies(jeton) },
		)
		expect(versions.status()).toBe(200)
		const publiees = (await versions.json()) as { id: string }[]
		// `toHaveLength` et non une simple vérité : le seed DOIT publier une version du workflow par
		// défaut (§7 ter.8), et sans elle cette ligne ne prouverait rien tout en restant verte.
		expect(publiees, 'le seed publie une version du workflow par défaut (§7 ter.8)').toHaveLength(1)
		const version = publiees[0] as { id: string }

		const nombreAvant = await request.get(
			`${VERSIONS}?workflow_id=eq.${WORKFLOW_SEED}&select=id`,
			{ headers: enTetesService() },
		)
		expect(nombreAvant.status()).toBe(200)
		const avant = ((await nombreAvant.json()) as unknown[]).length

		const reponse = await restaurer(request, jeton, version.id)
		expect(reponse.status()).toBe(200)
		const bilan = (await reponse.json()) as Restauration

		// TOUS LES COMPTEURS À ZÉRO : restaurer une structure déjà conforme n'écrit rien. Une valeur
		// non nulle signalerait que la fonction réécrit ce qui n'a pas bougé.
		expect(bilan.steps).toEqual({ created: 0, deleted: 0, updated: 0 })
		expect(bilan.transitions).toEqual({ created: 0, deleted: 0, updated: 0 })
		expect(bilan.fields).toEqual({ created: 0, unarchived: 0, archived: 0, updated: 0 })
		expect(bilan.rules).toEqual({ created: 0, deleted: 0, updated: 0 })
		expect(bilan.required_fields).toEqual({ created: 0, deleted: 0 })
		expect(bilan.cards.remapped).toBe(0)
		// LE POINT DE RETOUR N'EST PAS PUBLIÉ : la dernière version joue déjà ce rôle, et c'est la
		// vérification 5 du §7 ter.5 qui l'assure, non une garde propre à la restauration.
		expect(bilan.rollback_version.published).toBe(false)
		expect(bilan.rollback_version.version_id).toBe(version.id)
		expect(bilan.matches_version).toBe(true)
		expect(bilan.fingerprint_after).toBe(bilan.version.composition_fingerprint)

		// ET LA PREUVE NE LAISSE AUCUNE TRACE : le nombre de versions du seed est inchangé. Sans ce
		// contrôle, la ligne resterait verte tout en faisant dériver le seed à chaque exécution.
		const nombreApres = await request.get(`${VERSIONS}?workflow_id=eq.${WORKFLOW_SEED}&select=id`, {
			headers: enTetesService(),
		})
		expect(nombreApres.status()).toBe(200)
		expect(((await nombreApres.json()) as unknown[]).length).toBe(avant)
	})
})

test.describe('N2 — l’écriture, l’empreinte et le retour arrière (lignes b, c, d)', () => {
	test('lignes b, c, d — l’étape ajoutée est retirée, l’empreinte revient, et le retour arrière la rend', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'lignes bcd')
		try {
			// Une étape et une arête ajoutées APRÈS la version de référence. L'arête part de l'étape
			// d'arrivée vers l'étape neuve : sa disparition sera donc une CASCADE de la suppression de
			// l'étape, ce que la ligne b doit constater.
			const idEtapeNeuve = randomUUID()
			const idAreteNeuve = randomUUID()
			await etapeJetable(
				request,
				f.workflow,
				NOEUD_SIGNATURE,
				3,
				false,
				'Née après',
				idEtapeNeuve,
			)
			await areteJetable(request, f.workflow, f.arrivee, idEtapeNeuve, idAreteNeuve)

			// ── ligne b ────────────────────────────────────────────────────────────────────────────
			const reponseB = await restaurer(request, jeton, f.version)
			expect(reponseB.status()).toBe(200)
			const b = (await reponseB.json()) as Restauration

			expect(b.steps.deleted).toBe(1)
			expect(b.steps.created).toBe(0)
			// `transitions.deleted` VAUT ZÉRO, ET C'EST LE CONTRAT (§7 ter.13.8). L'arête a bel et bien
			// disparu — la ligne d le montrera en la faisant revenir —, mais elle est partie en cascade
			// avec son étape. Chaque compteur dit ce que SON instruction a écrit, et rien d'autre :
			// compter la cascade ferait lire deux suppressions là où l'administrateur n'en a demandé
			// qu'une.
			expect(b.transitions.deleted).toBe(0)
			// LE POINT DE RETOUR EST PUBLIÉ, lui : la structure vivante avait divergé, donc la dernière
			// version ne la photographiait plus.
			expect(b.rollback_version.published).toBe(true)
			expect(b.rollback_version.version_id).not.toBe(f.version)
			expect(b.matches_version).toBe(true)

			// L'étape et l'arête sont RELUES ABSENTES en base : le bilan rendu ne suffit pas.
			const etapeApresB = await request.get(`${STEPS}?id=eq.${idEtapeNeuve}&select=id`, {
				headers: enTetesService(),
			})
			expect(((await etapeApresB.json()) as unknown[]).length).toBe(0)
			const areteApresB = await request.get(`${TRANSITIONS}?id=eq.${idAreteNeuve}&select=id`, {
				headers: enTetesService(),
			})
			expect(((await areteApresB.json()) as unknown[]).length).toBe(0)

			// ── ligne c ────────────────────────────────────────────────────────────────────────────
			// L'EMPREINTE VIVANTE, MESURÉE PAR UN CHEMIN INDÉPENDANT. Comparer `fingerprint_after` à
			// `composition_fingerprint` ne prouverait rien de plus que `matches_version`, qui est
			// calculé à partir de lui. `publish_workflow_version` recalcule l'empreinte par son propre
			// chemin ; la ligne créée est relue EN BASE avec la clé de service.
			const republiee = await publier(request, jeton, f.workflow)
			const enBase = await versionEnBase(request, republiee)
			const reference = await versionEnBase(request, f.version)
			expect(enBase?.composition_fingerprint).toBe(reference?.composition_fingerprint)

			// ── ligne d ────────────────────────────────────────────────────────────────────────────
			// LE RETOUR ARRIÈRE EST LA RESTAURATION ELLE-MÊME, appliquée au point de retour publié
			// en b. C'est le même code, éprouvé par les mêmes preuves (§7 ter.13.5).
			const reponseD = await restaurer(request, jeton, b.rollback_version.version_id)
			expect(reponseD.status()).toBe(200)
			const d = (await reponseD.json()) as Restauration
			expect(d.steps.created).toBe(1)
			expect(d.transitions.created).toBe(1)

			// LES IDENTIFIANTS D'ORIGINE, et non des lignes équivalentes : une version conserve les
			// identifiants, et une restauration qui en engendrerait de neufs romprait tout ce qui
			// désigne une étape par le sien.
			const etapeApresD = await request.get(`${STEPS}?id=eq.${idEtapeNeuve}&select=id,label_override`, {
				headers: enTetesService(),
			})
			const etapes = (await etapeApresD.json()) as { id: string; label_override: string }[]
			expect(etapes).toHaveLength(1)
			expect(etapes[0]?.label_override).toBe('Née après')
			const areteApresD = await request.get(
				`${TRANSITIONS}?id=eq.${idAreteNeuve}&select=id,from_step_id,to_step_id`,
				{ headers: enTetesService() },
			)
			const aretes = (await areteApresD.json()) as {
				id: string
				from_step_id: string
				to_step_id: string
			}[]
			expect(aretes).toHaveLength(1)
			expect(aretes[0]?.from_step_id).toBe(f.arrivee)
			expect(aretes[0]?.to_step_id).toBe(idEtapeNeuve)
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N3 — le plan rejoué, son refus et son instruction (lignes e, f, g)', () => {
	test('lignes e, f, g — une affaire bloque, l’instruction la déplace, et le trigger l’inscrit', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'lignes efg')
		try {
			// Une étape née après la version, sur laquelle DEUX affaires sont posées. Restaurer la
			// version la retirerait : le plan rejoué ne saura pas où mettre ces affaires.
			const neuve = await etapeJetable(request, f.workflow, NOEUD_SIGNATURE, 3, false, 'Née après')
			const premiere = await cardJetable(
				request,
				f.channel,
				f.workflow,
				neuve,
				'tst restauration bloquée 1',
			)
			const seconde = await cardJetable(
				request,
				f.channel,
				f.workflow,
				neuve,
				'tst restauration bloquée 2',
			)

			// ── ligne e ────────────────────────────────────────────────────────────────────────────
			// LE PLAN EST REJOUÉ DANS LA TRANSACTION, ET SON VERDICT FAIT AUTORITÉ (§7 ter.13.2).
			const reponseE = await restaurer(request, jeton, f.version)
			expect(reponseE.status()).toBe(400)
			const e = (await reponseE.json()) as Refus
			expect(e.code).toBe('P0001')
			expect(e.message).toBe('plan non applicable')
			// Le `detail` NOMME ce qu'il faut corriger : un refus qui dirait seulement « plan non
			// applicable » obligerait l'appelant à redemander le plan (§7 ter.13.6, vérification 7).
			expect(e.details ?? '').toContain('Née après')
			expect(e.details ?? '').toContain('2 affaire(s) sans destination')

			// LE REFUS N'A RIEN ÉCRIT : l'affaire est relue sur son étape d'origine. Un refus qui
			// laisse une trace n'est pas un refus.
			const apresRefus = await request.get(`${CARDS}?id=eq.${premiere}&select=current_step_id`, {
				headers: enTetesService(),
			})
			expect(((await apresRefus.json()) as { current_step_id: string }[])[0]?.current_step_id).toBe(
				neuve,
			)

			// ── ligne f ────────────────────────────────────────────────────────────────────────────
			const reponseF = await restaurer(request, jeton, f.version, {
				step_overrides: [{ from_step_id: neuve, to_step_id: f.depart }],
			})
			expect(reponseF.status()).toBe(200)
			const bilanF = (await reponseF.json()) as Restauration
			expect(bilanF.cards.remapped).toBe(2)

			// RELU EN BASE, et non déduit du compteur : les deux affaires sont sur l'étape nommée par
			// l'instruction, et sur aucune autre.
			const deplacees = await request.get(
				`${CARDS}?id=in.(${premiere},${seconde})&select=id,current_step_id`,
				{ headers: enTetesService() },
			)
			const lignes = (await deplacees.json()) as { id: string; current_step_id: string }[]
			expect(lignes).toHaveLength(2)
			for (const ligne of lignes) {
				expect(ligne.current_step_id).toBe(f.depart)
			}

			// ── ligne g ────────────────────────────────────────────────────────────────────────────
			// L'ÉVÉNEMENT EST ÉCRIT PAR LE TRIGGER, PAS PAR LA FONCTION. La restauration ne pose aucun
			// événement elle-même : si le déplacement passe par le vrai chemin d'écriture, la timeline
			// s'alimente d'elle-même. Un événement manquant dirait que les affaires ont été déplacées
			// par un chemin dérobé.
			for (const carte of [premiere, seconde]) {
				const fil = await request.get(
					`${EVENEMENTS}?card_id=eq.${carte}&type=eq.moved&select=id,type`,
					{ headers: enTetesService() },
				)
				expect(fil.status()).toBe(200)
				expect(
					((await fil.json()) as unknown[]).length,
					`un événement « moved » pour l’affaire ${carte}`,
				).toBe(1)
			}
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N4 — le champ surnuméraire est ARCHIVÉ, jamais supprimé (ligne h)', () => {
	test('ligne h — un champ né après la version est archivé, et il existe toujours', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne h')
		try {
			const champ = randomUUID()
			const creation = await request.post(CHAMPS, {
				headers: { ...enTetesService(), Prefer: 'return=representation' },
				data: {
					id: champ,
					workflow_id: f.workflow,
					workspace_id: WORKSPACE_SEED,
					// MESURÉ : `form_fields_key_check` impose le kebab-case `^[a-z0-9]+(-[a-z0-9]+)*$`
					// (migration 9). Une clé à tirets bas est refusée en `23514`.
					key: `tst-restauration-${champ.slice(0, 8)}`,
					label: 'Champ né après la version',
					type: 'text',
					options: {},
					position: 999,
				},
			})
			expect(creation.status()).toBe(201)

			const reponse = await restaurer(request, jeton, f.version)
			expect(reponse.status()).toBe(200)
			const bilan = (await reponse.json()) as Restauration
			expect(bilan.fields.archived).toBe(1)
			expect(bilan.fields.created).toBe(0)

			// LE CHAMP EXISTE TOUJOURS, AVEC SON `archived_at`. MESURÉ : `form_fields` ne porte AUCUNE
			// politique `delete` et `authenticated` n'a que `select`, `insert`, `update` — supprimer un
			// champ n'existe pas dans ce produit, et le supprimer ici détruirait les saisies de
			// `card_field_values` qu'aucune version ne conserve (§7 ter.13.4).
			const relu = await request.get(`${CHAMPS}?id=eq.${champ}&select=id,archived_at`, {
				headers: enTetesService(),
			})
			const champs = (await relu.json()) as { id: string; archived_at: string | null }[]
			expect(champs, 'le champ surnuméraire n’est jamais supprimé').toHaveLength(1)
			expect(champs[0]?.archived_at).not.toBeNull()

			// `matches_version` EST FAUX SANS QU'AUCUNE ERREUR N'AIT EU LIEU : le champ archivé reste
			// dans le document avec son `archived_at`. Rendre ce booléen plutôt que de prétendre à
			// l'égalité est la seule réponse honnête (§7 ter.13.8).
			expect(bilan.matches_version).toBe(false)
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N5 — la concurrence optimiste, et son code HTTP (lignes i, j)', () => {
	test('ligne i — une empreinte périmée rend 409, et non 400', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne i')
		try {
			await etapeJetable(request, f.workflow, NOEUD_SIGNATURE, 3, false, 'Née après')

			const reponse = await restaurer(request, jeton, f.version, {
				expected_live_fingerprint: 'a'.repeat(64),
			})
			// LE `409` EST LE CODE JUSTE, ET C'EST CE QUE pgTAP NE PEUT PAS ATTRAPER : la demande était
			// valide, c'est l'état du monde qui a changé sous elle. Un `400` laisserait croire à une
			// erreur de l'appelant (§7 ter.13.6, vérification 5).
			expect(reponse.status()).toBe(409)
			const corps = (await reponse.json()) as Refus
			// LE `SQLSTATE` EST `PT409`, ET C'EST CE HARNAIS QUI L'A IMPOSÉ. La première rédaction de
			// la fonction levait `P0001` comme ses sept autres refus, et rendait donc `400` : mesuré
			// ici, puisque pgTAP ne voit jamais un code HTTP. Seul un `SQLSTATE` de la forme
			// `PT<statut>` fait choisir son code à une fonction, et c'est le `409` que la
			// spécification argumente (§7 ter.13.6).
			expect(corps.code).toBe('PT409')
			expect(corps.message).toBe('structure modifiee depuis le plan')
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})

	test('ligne j — l’empreinte exacte laisse passer, l’argument facultatif traversant PostgREST', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne j')
		try {
			// L'empreinte vivante EXACTE est celle de la version de référence, la structure n'ayant pas
			// bougé depuis sa publication. Elle est relue en base avec la clé de service plutôt que
			// reprise d'une réponse : la ligne éprouve le passage de l'argument, pas la mémoire du test.
			const reference = await versionEnBase(request, f.version)
			expect(reference?.composition_fingerprint).toBeTruthy()

			const reponse = await restaurer(request, jeton, f.version, {
				expected_live_fingerprint: reference?.composition_fingerprint,
			})
			expect(reponse.status()).toBe(200)
			const bilan = (await reponse.json()) as Restauration
			expect(bilan.matches_version).toBe(true)
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N6 — les refus du plan, REMONTÉS TELS QUELS (lignes k, l)', () => {
	test('ligne k — `step_overrides` qui n’est pas un tableau rend « remappage invalide »', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne k')
		try {
			const reponse = await restaurer(request, jeton, f.version, {
				step_overrides: { a: 1 },
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as Refus
			expect(corps.code).toBe('P0001')
			// LE REFUS DU PLAN, MOT POUR MOT. La règle de remappage n'est écrite qu'une fois : si la
			// restauration reformulait ce message, il existerait deux formulations d'une même règle, et
			// elles divergeraient (§7 ter.13.2).
			expect(corps.message).toBe('remappage invalide')
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})

	test('ligne l — une cible absente de la version rend le refus du plan', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne l')
		try {
			const neuve = await etapeJetable(request, f.workflow, NOEUD_SIGNATURE, 3, false, 'Née après')
			const reponse = await restaurer(request, jeton, f.version, {
				step_overrides: [{ from_step_id: neuve, to_step_id: neuve }],
			})
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as Refus
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('cible de remappage absente de la version')
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})
})

test.describe('N7 — les refus d’autorisation et d’existence (lignes m, n, o, p, q, r)', () => {
	for (const [ligne, compte] of [
		['m', COMPTES_SEED[1]],
		['n', COMPTES_SEED[2]],
	] as const) {
		test(`ligne ${ligne} — un ${compte.role} est refusé : restaurer ÉCRIT la structure du channel`, async ({
			request,
		}) => {
			const jetonAdmin = await jetonDe(COMPTES_SEED[0].adresse)
			const jeton = await jetonDe(compte.adresse)
			const f = await fixture(request, jetonAdmin, `ligne ${ligne}`)
			try {
				const reponse = await restaurer(request, jeton, f.version)
				expect(reponse.status()).toBe(403)
				const corps = (await reponse.json()) as Refus
				expect(corps.code).toBe('42501')
				// LE MÊME MESSAGE POUR LES DEUX PROFILS : la restauration n'est pas un oracle de droits
				// fins. Un message différencié apprendrait à un `viewer` ce qu'un `business_developer`
				// peut faire.
				expect(corps.message).toBe('restauration reservee aux administrateurs')

				// LE REFUS N'A RIEN ÉCRIT : aucune version n'a été publiée au passage. Sans ce contrôle,
				// un refus qui aurait d'abord posé son point de retour resterait vert.
				const versions = await request.get(
					`${VERSIONS}?workflow_id=eq.${f.workflow}&select=id`,
					{ headers: enTetesService() },
				)
				expect(((await versions.json()) as unknown[]).length).toBe(1)
			} finally {
				await rendreLaBase(request, f.workflow, f.channel)
			}
		})
	}

	test('ligne o — une version inexistante rend « version introuvable »', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await restaurer(request, jeton, randomUUID())
		expect(reponse.status()).toBe(400)
		const corps = (await reponse.json()) as Refus
		expect(corps.code).toBe('P0001')
		expect(corps.message).toBe('version introuvable')
	})

	test('ligne p — une version d’un AUTRE workspace rend le même message — refus n° 3', async ({
		request,
	}) => {
		// Sans ce second workspace RÉEL, le refus serait vrai par simple absence et ne prouverait rien
		// (décision 50). La version y est réellement posée, et son existence est constatée avec la clé
		// de service avant que l'administratrice ne s'y heurte.
		//
		// CETTE LIGNE ÉPROUVE LA VÉRIFICATION 2 ÉCRITE À LA MAIN. Sous `security definer`, la RLS ne
		// masque plus les versions d'autrui : sans `app.is_workspace_member`, l'appel tomberait sur le
		// refus d'administration et la fonction deviendrait l'oracle d'existence que tout ce chapitre
		// refuse d'être (§7 ter.13.6).
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const workspaceEtranger = randomUUID()
		const workflowEtranger = randomUUID()
		const versionEtrangere = randomUUID()
		try {
			expect(
				(
					await request.post(WORKSPACES, {
						headers: enTetesService(),
						data: {
							id: workspaceEtranger,
							name: `Ailleurs ${randomUUID()}`,
							slug: `ailleurs-${workspaceEtranger}`,
						},
					})
				).status(),
			).toBe(201)
			expect(
				(
					await request.post(WF, {
						headers: enTetesService(),
						data: {
							id: workflowEtranger,
							workspace_id: workspaceEtranger,
							name: 'Workflow d’ailleurs',
							scope: 'global',
							is_default: false,
						},
					})
				).status(),
			).toBe(201)
			expect(
				(
					await request.post(VERSIONS, {
						headers: enTetesService(),
						data: {
							id: versionEtrangere,
							workspace_id: workspaceEtranger,
							workflow_id: workflowEtranger,
							version_number: 1,
							composition: { workflow: { id: workflowEtranger }, steps: [] },
							composition_fingerprint: 'a'.repeat(64),
						},
					})
				).status(),
			).toBe(201)
			// L'EXISTENCE EST CONSTATÉE : le refus qui suit porte sur une ligne qui existe vraiment.
			expect(await versionEnBase(request, versionEtrangere)).toBeTruthy()

			const reponse = await restaurer(request, jeton, versionEtrangere)
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as Refus
			expect(corps.code).toBe('P0001')
			expect(corps.message).toBe('version introuvable')
		} finally {
			await request.delete(`${WORKSPACES}?id=eq.${workspaceEtranger}`, {
				headers: enTetesService(),
			})
		}
	})

	test('ligne q — un workflow archivé refuse la restauration, là où le plan l’acceptait', async ({
		request,
	}) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const f = await fixture(request, jeton, 'ligne q')
		try {
			const archivage = await request.patch(`${WF}?id=eq.${f.workflow}`, {
				headers: enTetesService(),
				data: { archived_at: new Date().toISOString() },
			})
			expect(archivage.status()).toBe(204)

			const reponse = await restaurer(request, jeton, f.version)
			expect(reponse.status()).toBe(400)
			const corps = (await reponse.json()) as Refus
			expect(corps.code).toBe('P0001')
			// LE REFUS EST ICI, ET PAS DANS LE PLAN. Planifier ne fait que lire, et le §7 ter.12.4
			// refuse d'interdire à un administrateur de REGARDER ce qu'une restauration ferait.
			// Restaurer écrit : réécrire en silence un workflow sorti du service n'a pas de sens.
			expect(corps.message).toBe('workflow archive')
		} finally {
			await rendreLaBase(request, f.workflow, f.channel)
		}
	})

	test('ligne r — un appel anonyme obtient 401, le privilège refusant avant la vérification 1', async ({
		request,
	}) => {
		const reponse = await request.post(RPC_RESTAURER, {
			headers: enTetesAnonymes(),
			data: { target_version_id: randomUUID() },
		})
		expect(reponse.status()).toBe(401)
	})
})
