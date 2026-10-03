// @verifies CRM-097 (docs/BACKLOG.md) — tranche T3.b : suggérer dans un workflow existant, sur la pile réelle
// @verifies docs/SPEC-ia.md §13.1 (la cible entière, `remappages`), §13.2 (la composition vivante, lue avec le jeton
//           de l'appelant), §13.3 (`remappage_requis`), §13.4 (accepter par le cœur de la restauration : point de
//           retour, affaires remappées vers une étape NOUVELLE, `PT409`), §13.5 (portées, cible, revue d'une
//           modification) ; docs/SPEC-workflow-engine.md §7 ter.13 (le point de retour se restaure) ; décision 620
// @verifies CLAUDE.md §10 (le commercial et la lectrice refusés par la base, avec leurs jetons réels), §15 (effets
//           en base relus)
//
// Toutes les générations passent par le simulateur (scénario `modification` : la deuxième étape retirée, l'étape
// « qualification-ia » ajoutée, aucun remappage). JAMAIS sur le workflow du seed : chaque scénario compose un workflow
// jetable — trois étapes, deux arêtes, un channel, une affaire sur la deuxième étape —, que la clé de service retire
// ensuite, avec le nœud « qualification-ia » qu'une acceptation ajoute au catalogue — retrait CONSTATÉ.

import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0]
const BIZDEV = COMPTES_SEED[1]
const VIEWER = COMPTES_SEED[2]
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const TRACK_SEED = '5eed0000-0000-4000-8000-000000000022'
const NOEUD_PROSPECTION = '5eed0000-0000-4000-8000-000000000041'
const NOEUD_NEGOCIATION = '5eed0000-0000-4000-8000-000000000043'
const NOEUD_SIGNATURE = '5eed0000-0000-4000-8000-000000000044'
const PREFIXE = 'Sonde 097 T3'
const QUALIFICATION = 'qualification-ia'
const IA = `${URL_API}/functions/v1/ia`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`

type Defaut = { code: string; chemin: string; valeurs: Record<string, unknown> }
type Revision = { numero: number; origine: string; defauts: Defaut[]; proposition: Record<string, unknown> & { etapes: { noeud: string }[] } }
type Suggestion = { id: string; workflow_id: string | null; portee: string; statut: string; empreinte_initiale: string | null; version_retour_id: string | null }

const simule = (enTetes: Record<string, string>) => ({ ...enTetes, 'x-ia-simulateur': 'modification' })

async function lignesDuFlux(reponse: APIResponse): Promise<Record<string, unknown>[]> {
	expect(reponse.headers()['content-type']).toContain('application/x-ndjson')
	return (await reponse.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
}

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function inserer(requete: APIRequestContext, table: string, ligne: Record<string, unknown>): Promise<void> {
	const reponse = await requete.post(rest(table), { headers: enTetesService(), data: ligne })
	expect(reponse.status(), `${table} : ${await reponse.text()}`).toBe(201)
}

/** Le workflow jetable : prospection (initiale) → négociation → signature ; une affaire sur la négociation. */
async function workflowJetable(requete: APIRequestContext) {
	const w = {
		workflow: randomUUID(), prospection: randomUUID(), negociation: randomUUID(), signature: randomUUID(),
		channel: randomUUID(), affaire: randomUUID(),
	}
	await inserer(requete, 'workflows', { id: w.workflow, workspace_id: ESPACE, name: `${PREFIXE} ${w.workflow}`, scope: 'global', is_default: false })
	for (const [id, noeud, position] of [
		[w.prospection, NOEUD_PROSPECTION, 1], [w.negociation, NOEUD_NEGOCIATION, 2], [w.signature, NOEUD_SIGNATURE, 3],
	] as const) {
		await inserer(requete, 'workflow_steps', { id, workflow_id: w.workflow, workspace_id: ESPACE, node_id: noeud, position, is_initial: position === 1 })
	}
	await inserer(requete, 'workflow_transitions', { workflow_id: w.workflow, workspace_id: ESPACE, from_step_id: w.prospection, to_step_id: w.negociation })
	await inserer(requete, 'workflow_transitions', { workflow_id: w.workflow, workspace_id: ESPACE, from_step_id: w.negociation, to_step_id: w.signature })
	await inserer(requete, 'channels', {
		id: w.channel, workspace_id: ESPACE, track_id: TRACK_SEED, name: `tst ia ${w.channel}`, slug: `tst-ia-${w.channel}`, workflow_id: w.workflow, position: 99,
	})
	await inserer(requete, 'cards', {
		id: w.affaire, workspace_id: ESPACE, channel_id: w.channel, workflow_id: w.workflow, current_step_id: w.negociation, title: 'tst ia affaire', position: 1,
	})
	return w
}

async function suggerer(requete: APIRequestContext, jeton: string, workflowId: string, nom: string, portee = 'etapes') {
	return requete.post(`${IA}/suggestions`, {
		headers: simule(enTetesAuthentifies(jeton)),
		data: { workspace_id: ESPACE, portee, workflow_id: workflowId, demande: `${PREFIXE} — ${nom}` },
	})
}

async function suggererJusquauBout(requete: APIRequestContext, jeton: string, workflowId: string, nom: string): Promise<string> {
	const reponse = await suggerer(requete, jeton, workflowId, nom)
	expect(reponse.status(), await reponse.text()).toBe(202)
	const lignes = await lignesDuFlux(reponse)
	expect(lignes.at(-1)).toMatchObject({ issue: 'revision' })
	return lignes[0]?.suggestion_id as string
}

const derniere = async (requete: APIRequestContext, id: string) =>
	(await lireService<Revision>(requete, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=numero,origine,defauts,proposition&order=numero.desc&limit=1`))[0] as Revision

const accepter = (requete: APIRequestContext, jeton: string, id: string) =>
	requete.post(rest('rpc/accepter_suggestion_ia'), { headers: enTetesAuthentifies(jeton), data: { p_suggestion: id } })

async function corriger(requete: APIRequestContext, jeton: string, id: string, proposition: unknown): Promise<Defaut[]> {
	const reponse = await requete.post(rest('suggestions_ia_revisions?select=defauts'), {
		headers: { ...enTetesAuthentifies(jeton), prefer: 'return=representation' },
		data: { suggestion_id: id, origine: 'correction', proposition },
	})
	expect(reponse.status(), await reponse.text()).toBe(201)
	return ((await reponse.json()) as { defauts: Defaut[] }[])[0]?.defauts ?? []
}

const etapesVivantes = async (requete: APIRequestContext, workflowId: string) =>
	(await lireService<{ id: string; position: number; node: { key: string } }>(
		requete, `workflow_steps?workflow_id=eq.${workflowId}&select=id,position,node:workflow_nodes_catalog(key)&order=position`,
	)).map((e) => ({ id: e.id, cle: e.node.key }))

test.describe('L’assistant IA — faire évoluer un workflow existant (docs/SPEC-ia.md §13)', () => {
	const jetables: string[] = []

	test.afterEach(async ({ request }) => {
		for (const workflow of jetables.splice(0)) {
			await request.delete(rest(`cards?workflow_id=eq.${workflow}`), { headers: enTetesService() })
			await request.delete(rest(`channels?workflow_id=eq.${workflow}`), { headers: enTetesService() })
			const retrait = await request.delete(rest(`workflows?id=eq.${workflow}`), { headers: enTetesService() })
			expect(retrait.status()).toBe(204)
		}
		await request.delete(rest(`suggestions_ia?${FILTRE}`), { headers: enTetesService() })
		await request.delete(rest(`workflow_nodes_catalog?workspace_id=eq.${ESPACE}&key=eq.${QUALIFICATION}`), { headers: enTetesService() })
		expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`), 'aucune suggestion de sonde ne doit rester').toEqual([])
		expect(await lireService(request, `workflow_nodes_catalog?select=id&workspace_id=eq.${ESPACE}&key=eq.${QUALIFICATION}`),
			'aucun nœud de sonde ne doit rester').toEqual([])
	})

	test('suggérer, remapper, accepter, puis restaurer le point de retour — l’affaire suit chaque geste', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const w = await workflowJetable(request)
		jetables.push(w.workflow)

		// Suggérer : la suggestion naît SUR ce workflow, son empreinte relevée par la base.
		const id = await suggererJusquauBout(request, jeton, w.workflow, 'remplacer la négociation')
		const [creee] = await lireService<Suggestion>(request, `suggestions_ia?id=eq.${id}&select=id,workflow_id,portee,statut,empreinte_initiale,version_retour_id`)
		expect(creee).toMatchObject({ workflow_id: w.workflow, portee: 'etapes', statut: 'en_revue' })
		expect(creee?.empreinte_initiale).toMatch(/^[0-9a-f]{64}$/)

		// La révision du modèle : la cible entière, la négociation retirée, et la base attend une destination.
		const premiere = await derniere(request, id)
		expect(premiere.origine).toBe('ia')
		expect(premiere.proposition.etapes.map((e) => e.noeud)).toEqual(['prospection', QUALIFICATION, 'signature'])
		expect(premiere.proposition.remappages).toEqual([])
		expect(premiere.defauts).toEqual([{ code: 'remappage_requis', chemin: 'remappages', valeurs: { cle: 'negociation', affaires: 1 } }])

		// Accepter avec un défaut : refusé, rien n'a bougé.
		const refus = await accepter(request, jeton, id)
		expect(refus.status()).toBe(400)
		expect((await refus.json()).message).toBe('proposition non conforme')

		// Corriger : la destination choisie — l'étape que la suggestion AJOUTE.
		const defauts = await corriger(request, jeton, id, { ...premiere.proposition, remappages: [{ de: 'negociation', vers: QUALIFICATION }] })
		expect(defauts).toEqual([])

		const acceptation = await accepter(request, jeton, id)
		expect(acceptation.status(), await acceptation.text()).toBe(200)
		expect(await acceptation.json()).toBe(w.workflow)
		const apres = await etapesVivantes(request, w.workflow)
		expect(apres.map((e) => e.cle)).toEqual(['prospection', QUALIFICATION, 'signature'])
		const qualification = apres.find((e) => e.cle === QUALIFICATION)?.id
		const [affaire] = await lireService<{ current_step_id: string }>(request, `cards?id=eq.${w.affaire}&select=current_step_id`)
		expect(affaire?.current_step_id, 'l’affaire est sur l’étape NOUVELLE').toBe(qualification)
		const [decidee] = await lireService<Suggestion>(request, `suggestions_ia?id=eq.${id}&select=id,workflow_id,portee,statut,empreinte_initiale,version_retour_id`)
		expect(decidee?.statut).toBe('acceptee')
		expect(decidee?.version_retour_id).toMatch(/^[0-9a-f-]{36}$/)

		// Le point de retour se restaure par la VRAIE RPC : la négociation revient, avec son identifiant.
		const restauration = await request.post(rest('rpc/restore_workflow_version'), {
			headers: enTetesAuthentifies(jeton),
			data: { target_version_id: decidee?.version_retour_id, step_overrides: [{ from_step_id: qualification, to_step_id: w.negociation }] },
		})
		expect(restauration.status(), await restauration.text()).toBe(200)
		expect((await etapesVivantes(request, w.workflow)).map((e) => e.cle)).toEqual(['prospection', 'negociation', 'signature'])
		const [revenue] = await lireService<{ current_step_id: string }>(request, `cards?id=eq.${w.affaire}&select=current_step_id`)
		expect(revenue?.current_step_id).toBe(w.negociation)
	})

	test('une revue d’une modification relit le workflow vivant ; la consigne est gardée', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const w = await workflowJetable(request)
		jetables.push(w.workflow)
		const id = await suggererJusquauBout(request, jeton, w.workflow, 'revue')
		const revue = await request.post(`${IA}/suggestions/${id}/revue`, {
			headers: simule(enTetesAuthentifies(jeton)),
			data: { consigne: 'Garde la signature' },
		})
		expect(revue.status()).toBe(202)
		expect((await lignesDuFlux(revue)).at(-1)).toMatchObject({ issue: 'revision' })
		const revisions = await lireService<{ numero: number; origine: string; consigne: string }>(
			request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=numero,origine,consigne&order=numero`,
		)
		expect(revisions.map((r) => [r.origine, r.consigne])).toEqual([['ia', `${PREFIXE} — revue`], ['ia', 'Garde la signature']])
		// Le simulateur dérive sa cible du workflow vivant : la seconde révision le prouve reçu.
		expect((await derniere(request, id)).proposition.etapes.map((e) => e.noeud)).toEqual(['prospection', QUALIFICATION, 'signature'])
	})

	test('le workflow a bougé depuis la suggestion : 409 « workflow modifie », rien n’est appliqué', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const w = await workflowJetable(request)
		jetables.push(w.workflow)
		const id = await suggererJusquauBout(request, jeton, w.workflow, 'concurrence')
		await corriger(request, jeton, id, { ...(await derniere(request, id)).proposition, remappages: [{ de: 'negociation', vers: QUALIFICATION }] })
		const change = await request.patch(rest(`workflow_transitions?workflow_id=eq.${w.workflow}&from_step_id=eq.${w.prospection}`), {
			headers: enTetesService(),
			data: { label: 'Changé entre-temps' },
		})
		expect(change.status()).toBe(204)
		const refus = await accepter(request, jeton, id)
		expect(refus.status()).toBe(409)
		expect((await refus.json()).message).toBe('workflow modifie')
		expect((await etapesVivantes(request, w.workflow)).map((e) => e.cle)).toEqual(['prospection', 'negociation', 'signature'])
	})

	test('le commercial et la lectrice sont refusés PAR LA BASE (403) ; rien n’est créé', async ({ request }) => {
		const w = await workflowJetable(request)
		jetables.push(w.workflow)
		for (const compte of [BIZDEV, VIEWER]) {
			const reponse = await suggerer(request, await jetonDe(compte.adresse), w.workflow, `refus ${compte.adresse}`)
			expect(reponse.status(), compte.adresse).toBe(403)
		}
		expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`)).toEqual([])
	})

	test('un workflow introuvable : 404 sans suggestion ; une portée ciblée sans workflow : 400', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const introuvable = await suggerer(request, jeton, randomUUID(), 'introuvable')
		expect([introuvable.status(), await introuvable.json()]).toEqual([404, { erreur: 'workflow_introuvable' }])
		const sansCible = await request.post(`${IA}/suggestions`, {
			headers: simule(enTetesAuthentifies(jeton)),
			data: { workspace_id: ESPACE, portee: 'champs', demande: `${PREFIXE} — sans cible` },
		})
		expect([sansCible.status(), await sansCible.json()]).toEqual([400, { erreur: 'demande_invalide' }])
		expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`)).toEqual([])
	})
})
