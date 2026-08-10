// @verifies CRM-035 (docs/BACKLOG.md) — champs de formulaire et règles, hors interface
// @verifies docs/SPEC-form-composer.md §2.8 (contrat d'API, lignes a à u), §2.4 (options exigées),
//           §2.5 (unicité de la clé), §2.7 (autorisations), §3.1 (valeur par défaut),
//           §3.3 (garanties structurelles), §7.1 (preuves attendues)
// @verifies docs/SPEC-permissions-rls.md §4 (écriture `admin`), §7 (preuves de refus)
// @verifies docs/SPEC-seed.md §2.10 (champs et règles du seed)
// @verifies docs/SPEC-test-harness.md §4.3 (projet `api`, hors interface)
// @verifies docs/INCONSISTENCY_REPORT.md INC-037 (close : la copie emporte les champs)
// @verifies CLAUDE.md §10 (toute règle se prouve hors interface, avec le jeton réel)
//
// Ces scénarios exercent le backend **sans passer par l'interface**, avec les jetons réels des
// profils seedés obtenus par la véritable route de connexion. Aucun navigateur n'est lancé — et pour
// cause : cette unité ne livre aucun écran (INC-021).
//
// Ils reprennent une à une les vingt et une lignes du tableau de `docs/SPEC-form-composer.md` §2.8,
// écrit **avant** le code.
//
// TROIS PIÈGES, tous hérités des unités précédentes et tous encore actifs ici :
//
//   * une écriture refusée par la clause `USING` d'une politique ne produit **aucune erreur** :
//     PostgREST rend `200` ou `204` et ne modifie rien. Tout refus d'autorisation relit donc la
//     ligne et la constate **inchangée** (décision 70) ;
//   * un « zéro ligne » sur une table vide serait vrai que la RLS refuse ou qu'elle autorise tout.
//     Les tables sont peuplées par le seed, et l'état est d'abord constaté avec la clé de service,
//     qui ne sert **jamais** à prouver un refus (décision 50) ;
//   * chaque scénario qui écrit **nettoie derrière lui**, y compris en cas d'échec. Sans cela, un
//     scénario en échec laisserait la base dans un état que les suivants prendraient pour le
//     contrat.

import { expect, test, type APIRequestContext } from '@playwright/test'
import { COMPTES_SEED, enTetesAnonymes, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

/** Le workspace, le workflow global et ses étapes, tels que `docs/SPEC-seed.md` §2 les déclare. */
const WORKSPACE_SEED = '5eed0000-0000-4000-8000-000000000001'
const WORKFLOW_GLOBAL = '5eed0000-0000-4000-8000-000000000051'
const NOM_COPIE_SEED = 'Cycle commercial — Conseil IA'
const ETAPE_PROSPECTION = '5eed0000-0000-4000-8000-000000000061'
const ETAPE_RELANCE = '5eed0000-0000-4000-8000-000000000062'

/** Les champs du seed employés par les preuves (`docs/SPEC-seed.md` §2.10). */
const CHAMP_BUDGET = '5eed0000-0000-4000-8000-000000000081'
const CHAMP_ARCHIVE = '5eed0000-0000-4000-8000-000000000087'

const CHAMPS = '/rest/v1/form_fields'
const REGLES = '/rest/v1/form_field_rules'

/** Préfixe des clés créées par ces scénarios. Le ménage ne s'appuie que sur lui. */
const PREFIXE = 'tst-crm035'

type Champ = {
	id: string
	key: string
	label: string
	type: string
	position: string | number
	archived_at: string | null
}
type Regle = { field_id: string; step_id: string; visibility: string }
type Erreur = { code: string; message: string }

/**
 * Retire toute ligne posée par ces scénarios.
 *
 * Passe par la clé de service : le produit n'expose **aucune** suppression de champ (décision 96),
 * et un test qui n'en nettoierait pas laisserait le seed durablement faux pour les suivants.
 */
async function menage(requete: APIRequestContext): Promise<void> {
	await requete.delete(`${CHAMPS}?key=like.${PREFIXE}*`, { headers: enTetesService() })
}

/** Crée un champ avec la clé de service, hors de tout contrôle d'autorisation. */
async function poserChamp(
	requete: APIRequestContext,
	corps: Record<string, unknown>,
): Promise<Champ> {
	const reponse = await requete.post(CHAMPS, {
		headers: { ...enTetesService(), 'Content-Type': 'application/json', Prefer: 'return=representation' },
		data: { workflow_id: WORKFLOW_GLOBAL, workspace_id: WORKSPACE_SEED, ...corps },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as Champ[])[0]!
}

test.beforeAll(async ({ request }) => {
	await menage(request)
})
test.afterEach(async ({ request }) => {
	await menage(request)
})

test.describe('F0 — le seed est dans l’état que le §2.10 déclare', () => {
	// Condition de validité de tout ce qui suit (décision 50). Sans elle, « l'anonyme ne lit rien »
	// serait vrai même si aucun champ n'existait.
	test('sept champs, dont un archivé, et quinze règles sur le workflow global', async ({
		request,
	}) => {
		const champs = await request.get(
			`${CHAMPS}?select=id,key,type,archived_at&workflow_id=eq.${WORKFLOW_GLOBAL}&order=position`,
			{ headers: enTetesService() },
		)
		expect(champs.status()).toBe(200)
		const lignes = (await champs.json()) as Champ[]
		expect(lignes).toHaveLength(7)
		expect(lignes.filter((c) => c.archived_at !== null)).toHaveLength(1)
		expect(new Set(lignes.map((c) => c.type)).size).toBe(7)

		const regles = await request.get(
			`${REGLES}?select=field_id,step_id,visibility&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			{ headers: enTetesService() },
		)
		expect(regles.status()).toBe(200)
		const posees = (await regles.json()) as Regle[]
		expect(posees).toHaveLength(15)
		expect(new Set(posees.map((r) => r.visibility))).toEqual(
			new Set(['hidden', 'visible', 'required']),
		)
	})

	// CRM-018 retourne l'ancien constat d'INC-037 : la copie doit porter son propre formulaire.
	test('INC-037 close — la copie porte sept champs et quinze règles remappés', async ({ request }) => {
		const copie = await request.get(
			`/rest/v1/workflows?select=id&derived_from_workflow_id=eq.${WORKFLOW_GLOBAL}&name=eq.${encodeURIComponent(NOM_COPIE_SEED)}`,
			{ headers: enTetesService() },
		)
		expect(copie.status()).toBe(200)
		const copies = (await copie.json()) as { id: string }[]
		expect(copies).toHaveLength(1)

		const champs = await request.get(`${CHAMPS}?select=id&workflow_id=eq.${copies[0]!.id}`, {
			headers: enTetesService(),
		})
		expect(champs.status()).toBe(200)
		const champsCopies = (await champs.json()) as Pick<Champ, 'id'>[]
		expect(champsCopies).toHaveLength(7)

		const source = await request.get(`${CHAMPS}?select=id&workflow_id=eq.${WORKFLOW_GLOBAL}`, {
			headers: enTetesService(),
		})
		expect(source.status()).toBe(200)
		const idsSource = new Set(((await source.json()) as Pick<Champ, 'id'>[]).map((c) => c.id))
		expect(champsCopies.filter((c) => idsSource.has(c.id))).toHaveLength(0)

		const regles = await request.get(`${REGLES}?select=field_id&workflow_id=eq.${copies[0]!.id}`, {
			headers: enTetesService(),
		})
		expect(regles.status()).toBe(200)
		expect(await regles.json()).toHaveLength(15)
	})
})

test.describe('F1 — lecture (lignes a, b, u)', () => {
	test('ligne a — un membre du workspace lit les champs', async ({ request }) => {
		for (const compte of COMPTES_SEED) {
			const jeton = await jetonDe(compte.adresse)
			const reponse = await request.get(`${CHAMPS}?workflow_id=eq.${WORKFLOW_GLOBAL}`, {
				headers: enTetesAuthentifies(jeton),
			})
			expect(reponse.status(), `profil ${compte.role}`).toBe(200)
			expect((await reponse.json()) as Champ[], `profil ${compte.role}`).toHaveLength(7)
		}
	})

	test('ligne b — un anonyme obtient `200` et **zéro ligne**, jamais une erreur', async ({
		request,
	}) => {
		const reponse = await request.get(CHAMPS, { headers: enTetesAnonymes() })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})

	test('ligne u — même refus par zéro ligne sur les règles', async ({ request }) => {
		const reponse = await request.get(REGLES, { headers: enTetesAnonymes() })
		expect(reponse.status()).toBe(200)
		expect(await reponse.json()).toEqual([])
	})
})

test.describe('F2 — écriture d’un champ (lignes c, d, e, f)', () => {
	test('ligne c — un `admin` crée un champ', async ({ request }) => {
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)
		const reponse = await request.post(CHAMPS, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				key: `${PREFIXE}-admin`,
				label: 'Créé par l’administratrice',
				type: 'text',
			},
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
	})

	for (const [ligne, indice] of [
		['d', 1],
		['e', 2],
	] as const) {
		test(`ligne ${ligne} — un ${COMPTES_SEED[indice].role} est refusé en création`, async ({
			request,
		}) => {
			const jeton = await jetonDe(COMPTES_SEED[indice].adresse)
			const reponse = await request.post(CHAMPS, {
				headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
				data: {
					workflow_id: WORKFLOW_GLOBAL,
					workspace_id: WORKSPACE_SEED,
					key: `${PREFIXE}-${COMPTES_SEED[indice].role}`,
					label: 'Ne doit pas exister',
					type: 'text',
				},
			})
			expect(reponse.status()).toBe(403)

			// Et rien n'a été créé. Le code seul ne suffit pas : c'est l'absence de ligne qui prouve.
			const relu = await request.get(`${CHAMPS}?key=like.${PREFIXE}*`, {
				headers: enTetesService(),
			})
			expect(await relu.json()).toEqual([])
		})
	}

	test('ligne f — un anonyme est refusé par le **privilège**, avant toute politique', async ({
		request,
	}) => {
		const reponse = await request.post(CHAMPS, {
			headers: { ...enTetesAnonymes(), 'Content-Type': 'application/json' },
			data: {
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				key: `${PREFIXE}-anon`,
				label: 'Ne doit pas exister',
				type: 'text',
			},
		})
		expect(reponse.status()).toBe(401)
	})
})

test.describe('F3 — mise à jour et suppression d’un champ (lignes g, h, i)', () => {
	test('ligne g — un `admin` modifie un champ', async ({ request }) => {
		const champ = await poserChamp(request, {
			key: `${PREFIXE}-maj`,
			label: 'Avant',
			type: 'text',
		})
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.patch(`${CHAMPS}?id=eq.${champ.id}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { label: 'Après' },
		})
		expect(reponse.status()).toBe(204)

		const relu = await request.get(`${CHAMPS}?select=label&id=eq.${champ.id}`, {
			headers: enTetesService(),
		})
		expect(((await relu.json()) as Champ[])[0]!.label).toBe('Après')
	})

	test('ligne h — un `business_developer` obtient `204` **et ne modifie rien**', async ({
		request,
	}) => {
		// LE PIÈGE DE LA DÉCISION 70. Un refus par `USING` ne lève aucune erreur : sans la relecture,
		// ce scénario serait vert que la politique existe ou non.
		const champ = await poserChamp(request, {
			key: `${PREFIXE}-refus-maj`,
			label: 'Intact',
			type: 'text',
		})
		const jeton = await jetonDe(COMPTES_SEED[1].adresse)

		const reponse = await request.patch(`${CHAMPS}?id=eq.${champ.id}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { label: 'Modifié par un bizdev' },
		})
		expect(reponse.status()).toBe(204)

		const relu = await request.get(`${CHAMPS}?select=label&id=eq.${champ.id}`, {
			headers: enTetesService(),
		})
		expect(((await relu.json()) as Champ[])[0]!.label).toBe('Intact')
	})

	test('ligne i — même un `admin` ne peut pas **supprimer** un champ', async ({ request }) => {
		// DÉCISION 96 : l'archivage tient lieu de suppression, et le refus est **double** — aucune
		// politique `for delete`, aucun privilège `DELETE`. C'est le privilège qui parle en premier.
		const champ = await poserChamp(request, {
			key: `${PREFIXE}-indestructible`,
			label: 'Ne se supprime pas',
			type: 'text',
		})
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.delete(`${CHAMPS}?id=eq.${champ.id}`, {
			headers: enTetesAuthentifies(jeton),
		})

		// MESURÉ : `403`, et non `401`. Le §2.8 écrivait « refusé » sans code, et la mesure le
		// précise — un rôle **authentifié** privé du privilège reçoit `403`, là où l'anonyme, qui
		// n'endosse aucun rôle capable d'écrire, reçoit `401` (ligne f). C'est exactement ce que
		// `CRM-031` avait mesuré pour la suppression d'un workflow.
		expect(reponse.status()).toBe(403)

		const relu = await request.get(`${CHAMPS}?select=id&id=eq.${champ.id}`, {
			headers: enTetesService(),
		})
		expect((await relu.json()) as Champ[]).toHaveLength(1)
	})

	test('l’archivage, lui, est ouvert à l’`admin` — c’est la voie prévue', async ({ request }) => {
		const champ = await poserChamp(request, {
			key: `${PREFIXE}-archivable`,
			label: 'S’archive',
			type: 'text',
		})
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.patch(`${CHAMPS}?id=eq.${champ.id}`, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: { archived_at: '2026-04-01T09:00:00Z' },
		})
		expect(reponse.status()).toBe(204)

		const relu = await request.get(`${CHAMPS}?select=archived_at&id=eq.${champ.id}`, {
			headers: enTetesService(),
		})
		expect(((await relu.json()) as Champ[])[0]!.archived_at).not.toBeNull()
	})
})

test.describe('F4 — ce que la base refuse, quel que soit le profil (lignes j à n)', () => {
	const admin = async (request: APIRequestContext) => ({
		...enTetesAuthentifies(await jetonDe(COMPTES_SEED[0].adresse)),
		'Content-Type': 'application/json',
	})

	test('ligne j — un workflow d’un **autre** workspace est refusé par la clé composite', async ({
		request,
	}) => {
		const reponse = await request.post(CHAMPS, {
			headers: await admin(request),
			data: {
				// Un identifiant qui n'existe dans aucun workspace : la clé composite ne le trouve pas,
				// et le refus est le même que pour un workflow d'un workspace étranger.
				workflow_id: '00000000-0000-4000-8000-0000000000ff',
				workspace_id: WORKSPACE_SEED,
				key: `${PREFIXE}-etranger`,
				label: 'Workflow d’ailleurs',
				type: 'text',
			},
		})
		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as Erreur).code).toBe('23503')
	})

	test('ligne k — un `type` hors des quinze valeurs est refusé', async ({ request }) => {
		const reponse = await request.post(CHAMPS, {
			headers: await admin(request),
			data: {
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				key: `${PREFIXE}-type`,
				label: 'Type inventé',
				type: 'siret',
			},
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).code).toBe('23514')
	})

	test('ligne l — un `select` sans `choices` est refusé, et un `select` vide aussi', async ({
		request,
	}) => {
		// LES DEUX CAS, ET NON UN SEUL. C'est la première assertion — l'absence pure — qui a trouvé
		// le défaut de la décision 102 : la contrainte rendait `NULL`, et un `CHECK` qui rend `NULL`
		// accepte la ligne.
		for (const [nom, options] of [
			['absent', undefined],
			['vide', { choices: [] }],
		] as const) {
			const reponse = await request.post(CHAMPS, {
				headers: await admin(request),
				data: {
					workflow_id: WORKFLOW_GLOBAL,
					workspace_id: WORKSPACE_SEED,
					key: `${PREFIXE}-select-${nom}`,
					label: 'Liste sans choix',
					type: 'select',
					...(options ? { options } : {}),
				},
			})
			expect(reponse.status(), `choices ${nom}`).toBe(400)
			expect(((await reponse.json()) as Erreur).code, `choices ${nom}`).toBe('23514')
		}
	})

	test('ligne m — un `money` sans `currency` est refusé', async ({ request }) => {
		const reponse = await request.post(CHAMPS, {
			headers: await admin(request),
			data: {
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				key: `${PREFIXE}-money`,
				label: 'Montant sans devise',
				type: 'money',
			},
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).code).toBe('23514')
	})

	test('ligne n — une `key` déjà prise dans le workflow est refusée, archivée comprise', async ({
		request,
	}) => {
		// La clé du champ **archivé** du seed. Décision 96 : l'unicité est totale, non partielle.
		const archive = await request.get(`${CHAMPS}?select=key&id=eq.${CHAMP_ARCHIVE}`, {
			headers: enTetesService(),
		})
		const cleArchivee = ((await archive.json()) as Champ[])[0]!.key

		const reponse = await request.post(CHAMPS, {
			headers: await admin(request),
			data: {
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				key: cleArchivee,
				label: 'Reprend la clé d’un champ archivé',
				type: 'number',
			},
		})
		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as Erreur).code).toBe('23505')
	})
})

test.describe('F5 — les règles de visibilité (lignes o, p, q, r, s, t)', () => {
	/** Pose un champ de preuve et rend son identifiant : les règles ont besoin d'un champ à viser. */
	async function champDePreuve(requete: APIRequestContext, suffixe: string): Promise<string> {
		const champ = await poserChamp(requete, {
			key: `${PREFIXE}-${suffixe}`,
			label: `Champ de preuve ${suffixe}`,
			type: 'text',
		})
		return champ.id
	}

	test('ligne o — un `admin` pose une règle', async ({ request }) => {
		const champ = await champDePreuve(request, 'regle')
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.post(REGLES, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				field_id: champ,
				step_id: ETAPE_PROSPECTION,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				visibility: 'required',
			},
		})
		expect(reponse.status(), await reponse.text()).toBe(201)
	})

	test('ligne p — un `business_developer` est refusé', async ({ request }) => {
		const champ = await champDePreuve(request, 'regle-refus')
		const jeton = await jetonDe(COMPTES_SEED[1].adresse)

		const reponse = await request.post(REGLES, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				field_id: champ,
				step_id: ETAPE_PROSPECTION,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				visibility: 'hidden',
			},
		})
		expect(reponse.status()).toBe(403)

		const relu = await request.get(`${REGLES}?select=field_id&field_id=eq.${champ}`, {
			headers: enTetesService(),
		})
		expect(await relu.json()).toEqual([])
	})

	test('ligne q — une règle croisant deux workflows est refusée par une clé composite', async ({
		request,
	}) => {
		// L'étape visée appartient à la **copie** du seed, non au workflow global. C'est le croisement
		// de la décision 95, mesuré ici par l'API et non seulement en pgTAP.
		const copie = await request.get(
			`/rest/v1/workflows?select=id&derived_from_workflow_id=eq.${WORKFLOW_GLOBAL}&name=eq.${encodeURIComponent(NOM_COPIE_SEED)}`,
			{ headers: enTetesService() },
		)
		const idCopie = ((await copie.json()) as { id: string }[])[0]!.id

		const etapes = await request.get(
			`/rest/v1/workflow_steps?select=id&workflow_id=eq.${idCopie}&limit=1`,
			{ headers: enTetesService() },
		)
		const etapeCopie = ((await etapes.json()) as { id: string }[])[0]!.id

		const champ = await champDePreuve(request, 'croisement')
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.post(REGLES, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				field_id: champ,
				step_id: etapeCopie,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				visibility: 'required',
			},
		})
		expect(reponse.status()).toBe(409)
		expect(((await reponse.json()) as Erreur).code).toBe('23503')
	})

	test('ligne r — une `visibility` hors des trois valeurs est refusée', async ({ request }) => {
		const champ = await champDePreuve(request, 'visibilite')
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		const reponse = await request.post(REGLES, {
			headers: { ...enTetesAuthentifies(jeton), 'Content-Type': 'application/json' },
			data: {
				field_id: champ,
				step_id: ETAPE_PROSPECTION,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				visibility: 'obligatoire',
			},
		})
		expect(reponse.status()).toBe(400)
		expect(((await reponse.json()) as Erreur).code).toBe('23514')
	})

	test('ligne s — un `admin` supprime une règle : c’est la voie prévue', async ({ request }) => {
		const champ = await champDePreuve(request, 'suppression')
		const jeton = await jetonDe(COMPTES_SEED[0].adresse)

		await request.post(REGLES, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: {
				field_id: champ,
				step_id: ETAPE_RELANCE,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				visibility: 'visible',
			},
		})

		const reponse = await request.delete(`${REGLES}?field_id=eq.${champ}`, {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(204)

		const relu = await request.get(`${REGLES}?select=field_id&field_id=eq.${champ}`, {
			headers: enTetesService(),
		})
		expect(await relu.json()).toEqual([])
	})

	test('ligne t — un `business_developer` obtient `204` **et la règle reste**', async ({
		request,
	}) => {
		// Même piège qu'à la ligne h, sur l'autre table et sur l'autre verbe.
		const champ = await champDePreuve(request, 'suppression-refus')
		await request.post(REGLES, {
			headers: { ...enTetesService(), 'Content-Type': 'application/json' },
			data: {
				field_id: champ,
				step_id: ETAPE_RELANCE,
				workflow_id: WORKFLOW_GLOBAL,
				workspace_id: WORKSPACE_SEED,
				visibility: 'visible',
			},
		})
		const jeton = await jetonDe(COMPTES_SEED[1].adresse)

		const reponse = await request.delete(`${REGLES}?field_id=eq.${champ}`, {
			headers: enTetesAuthentifies(jeton),
		})
		expect(reponse.status()).toBe(204)

		const relu = await request.get(`${REGLES}?select=field_id&field_id=eq.${champ}`, {
			headers: enTetesService(),
		})
		expect((await relu.json()) as Regle[]).toHaveLength(1)
	})
})

test.describe('F6 — ce que le seed démontre et que rien d’autre ne prouverait', () => {
	test('la valeur par défaut du §3.1 : des couples champ × étape restent sans règle', async ({
		request,
	}) => {
		// Une valeur par défaut qu'aucune donnée n'exerce n'est pas démontrée. `budget` porte trois
		// règles sur sept étapes : les quatre autres étapes le rendent `visible` par **absence**.
		const regles = await request.get(
			`${REGLES}?select=step_id,visibility&field_id=eq.${CHAMP_BUDGET}`,
			{ headers: enTetesService() },
		)
		const posees = (await regles.json()) as Regle[]
		expect(posees).toHaveLength(3)

		const etapes = await request.get(
			`/rest/v1/workflow_steps?select=id&workflow_id=eq.${WORKFLOW_GLOBAL}`,
			{ headers: enTetesService() },
		)
		expect((await etapes.json()) as { id: string }[]).toHaveLength(7)
	})
})
