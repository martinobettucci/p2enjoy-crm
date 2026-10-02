// @verifies CRM-097 (docs/BACKLOG.md) — tranche T2.b : corriger, accepter, abandonner, reprendre, sur la pile réelle
// @verifies docs/SPEC-ia.md §12.1 (les défauts écrits par la base, quoi que le client envoie), §12.2 (la correction
//           par PostgREST), §12.3 (l'acceptation par la RPC : le workflow relu, ses refus), §12.4 (l'abandon),
//           §12.6 (la revue sans consigne d'une suggestion sans révision) ; docs/JOURNAL.md décision 618
// @verifies CLAUDE.md §10 (le commercial et la lectrice refusés par la base, avec leurs jetons réels), §15 (effets
//           en base relus)
//
// Toutes les générations passent par le simulateur (en-tête `x-ia-simulateur`). Les suggestions portent un préfixe ;
// après chaque scénario, la clé de service retire les workflows qu'elles ont créés, les nœuds de catalogue que ces
// acceptations ont ajoutés, puis les suggestions — retrait CONSTATÉ.

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0]
const BIZDEV = COMPTES_SEED[1]
const VIEWER = COMPTES_SEED[2]
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const PREFIXE = 'Sonde 097 T2'
const IA = `${URL_API}/functions/v1/ia`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`
/** Les clés des nœuds que la proposition `valide` du simulateur ajoute au catalogue. */
const NOEUDS_SIMULES = ['prise-de-contact', 'maquette', 'gagne-web', 'perdu-web']

type Revision = { numero: number; origine: string; consigne: string | null; defauts: { code: string }[]; proposition: Record<string, unknown> }
type Suggestion = { id: string; statut: string; generation_depuis: string | null; derniere_erreur: string | null; workflow_cree_id: string | null }

const simule = (enTetes: Record<string, string>, scenario: string) => ({ ...enTetes, 'x-ia-simulateur': scenario })

async function lignesDuFlux(reponse: APIResponse): Promise<Record<string, unknown>[]> {
	expect(reponse.headers()['content-type']).toContain('application/x-ndjson')
	return (await reponse.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
}

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

/** Crée une suggestion par la vraie fonction et attend la fin de sa génération (le flux est lu jusqu'au bout). */
async function suggerer(requete: APIRequestContext, jeton: string, scenario: string, nom: string): Promise<string> {
	const reponse = await requete.post(`${IA}/suggestions`, {
		headers: simule(enTetesAuthentifies(jeton), scenario),
		data: { workspace_id: ESPACE, portee: 'workflow', demande: `${PREFIXE} — ${nom}` },
	})
	expect(reponse.status(), await reponse.text()).toBe(202)
	return (await lignesDuFlux(reponse))[0]?.suggestion_id as string
}

const suggestion = async (requete: APIRequestContext, id: string) =>
	(await lireService<Suggestion>(requete, `suggestions_ia?id=eq.${id}&select=id,statut,generation_depuis,derniere_erreur,workflow_cree_id`))[0] as Suggestion

const accepter = (requete: APIRequestContext, jeton: string, id: string) =>
	requete.post(rest('rpc/accepter_suggestion_ia'), { headers: enTetesAuthentifies(jeton), data: { p_suggestion: id } })

test.describe('L’assistant IA — corriger, accepter, abandonner (docs/SPEC-ia.md §12)', () => {
	test.afterEach(async ({ request }) => {
		const creees = await lireService<{ workflow_cree_id: string | null }>(request, `suggestions_ia?select=workflow_cree_id&${FILTRE}&workflow_cree_id=not.is.null`)
		for (const { workflow_cree_id } of creees) {
			const retrait = await request.delete(rest(`workflows?id=eq.${workflow_cree_id}`), { headers: enTetesService() })
			expect(retrait.status()).toBe(204)
		}
		await request.delete(rest(`workflow_nodes_catalog?workspace_id=eq.${ESPACE}&key=in.(${NOEUDS_SIMULES.join(',')})`), { headers: enTetesService() })
		await request.delete(rest(`suggestions_ia?${FILTRE}`), { headers: enTetesService() })
		expect(await lireService(request, `suggestions_ia?select=id&${FILTRE}`), 'aucune suggestion de sonde ne doit rester').toEqual([])
		expect(await lireService(request, `workflow_nodes_catalog?select=id&workspace_id=eq.${ESPACE}&key=in.(${NOEUDS_SIMULES.join(',')})`),
			'aucun nœud de sonde ne doit rester').toEqual([])
	})

	test('corriger : la base écrit les défauts de la correction ; le client ne les fournit pas ; une forme invalide est refusée', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const id = await suggerer(request, jeton, 'valide', 'corriger')
		const [premiere] = await lireService<Revision>(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=proposition`)
		const proposition = premiere?.proposition as { etapes: { noeud: string; initiale: boolean }[] }
		const fautive = { ...proposition, etapes: proposition.etapes.map((e) => ({ ...e, initiale: true })) }

		const correction = await request.post(rest('suggestions_ia_revisions?select=numero,origine,defauts'), {
			headers: { ...enTetesAuthentifies(jeton), prefer: 'return=representation' },
			data: { suggestion_id: id, origine: 'correction', proposition: fautive },
		})
		expect(correction.status(), await correction.text()).toBe(201)
		const [ecrite] = (await correction.json()) as Revision[]
		expect(ecrite?.numero).toBe(2)
		expect(ecrite?.defauts).toEqual([{ code: 'etape_initiale', chemin: 'etapes', valeurs: { nombre: 4 } }])

		const avecDefauts = await request.post(rest('suggestions_ia_revisions'), {
			headers: enTetesAuthentifies(jeton),
			data: { suggestion_id: id, origine: 'correction', proposition, defauts: [] },
		})
		expect(avecDefauts.status(), 'le client ne fournit pas les défauts').toBe(403)
		const malFormee = await request.post(rest('suggestions_ia_revisions'), {
			headers: enTetesAuthentifies(jeton),
			data: { suggestion_id: id, origine: 'correction', proposition: { version: 1, etapes: {} } },
		})
		expect([malFormee.status(), ((await malFormee.json()) as { code: string }).code]).toEqual([400, '22023'])
		expect((await lireService<Revision>(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=numero`)).length).toBe(2)
	})

	test('accepter : l’administratrice crée le workflow entier par la RPC ; relu, il est complet, et la suggestion le nomme', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const id = await suggerer(request, jeton, 'valide', 'accepter')
		const reponse = await accepter(request, jeton, id)
		expect(reponse.status(), await reponse.text()).toBe(200)
		const idWorkflow = (await reponse.json()) as string

		const [workflow] = await lireService<{ name: string; scope: string; is_default: boolean }>(request, `workflows?id=eq.${idWorkflow}&select=name,scope,is_default`)
		// L'espace du seed a déjà son workflow par défaut : le nouveau ne l'est pas.
		expect(workflow).toEqual({ name: "Cycle d'une agence web", scope: 'global', is_default: false })
		const etapes = await lireService<{ position: number; is_initial: boolean; workflow_nodes_catalog: { key: string; kind: string } }>(
			request, `workflow_steps?workflow_id=eq.${idWorkflow}&select=position,is_initial,workflow_nodes_catalog(key,kind)&order=position`)
		expect(etapes.map((e) => `${e.workflow_nodes_catalog.key}:${e.workflow_nodes_catalog.kind}:${e.is_initial}`)).toEqual([
			'prise-de-contact:open:true', 'maquette:open:false', 'gagne-web:won:false', 'perdu-web:lost:false',
		])
		expect((await lireService(request, `workflow_transitions?workflow_id=eq.${idWorkflow}&select=id`)).length).toBe(4)
		const champs = await lireService<{ key: string; type: string; options: unknown }>(request, `form_fields?workflow_id=eq.${idWorkflow}&select=key,type,options&order=position`)
		expect(champs).toEqual([
			{ key: 'budget', type: 'money', options: { currency: 'EUR' } },
			{ key: 'type-de-site', type: 'select', options: { choices: [{ key: 'vitrine', label: 'Vitrine' }, { key: 'e-commerce', label: 'E-commerce' }] } },
		])
		expect(await lireService(request, `form_field_rules?workflow_id=eq.${idWorkflow}&select=visibility`)).toEqual([{ visibility: 'required' }])
		expect(await suggestion(request, id)).toMatchObject({ statut: 'acceptee', workflow_cree_id: idWorkflow })

		const encore = await accepter(request, jeton, id)
		expect([encore.status(), ((await encore.json()) as { message: string }).message]).toEqual([400, 'suggestion figee'])
	})

	test('le commercial et la lectrice : la suggestion leur est introuvable (404), et rien n’est créé', async ({ request }) => {
		const id = await suggerer(request, await jetonDe(ADMIN.adresse), 'valide', 'refus')
		const avant = (await lireService(request, `workflows?select=id&workspace_id=eq.${ESPACE}`)).length
		for (const compte of [BIZDEV, VIEWER]) {
			const reponse = await accepter(request, await jetonDe(compte.adresse), id)
			expect([reponse.status(), ((await reponse.json()) as { message: string }).message], compte.role).toEqual([404, 'suggestion introuvable'])
		}
		expect((await lireService(request, `workflows?select=id&workspace_id=eq.${ESPACE}`)).length).toBe(avant)
		expect((await suggestion(request, id)).statut).toBe('en_revue')
	})

	test('une proposition incohérente n’est pas acceptée : la base la refuse et dit combien de défauts elle porte', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const id = await suggerer(request, jeton, 'incoherente', 'incoherente')
		const reponse = await accepter(request, jeton, id)
		expect(reponse.status()).toBe(400)
		expect(await reponse.json()).toMatchObject({ code: 'P0001', message: 'proposition non conforme', details: '2 defaut(s)' })
		expect((await suggestion(request, id)).statut).toBe('en_revue')
	})

	test('abandonner : le commercial est sans effet (zéro ligne) ; l’administratrice abandonne, et l’acceptation est refusée', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const id = await suggerer(request, jeton, 'valide', 'abandonner')
		const abandonner = async (j: string) =>
			request.patch(rest(`suggestions_ia?id=eq.${id}&select=id,statut`), {
				headers: { ...enTetesAuthentifies(j), prefer: 'return=representation' },
				data: { statut: 'abandonnee' },
			})
		const parLeCommercial = await abandonner(await jetonDe(BIZDEV.adresse))
		expect([parLeCommercial.status(), await parLeCommercial.json()]).toEqual([200, []])
		const parLAdministratrice = await abandonner(jeton)
		expect([parLAdministratrice.status(), await parLAdministratrice.json()]).toEqual([200, [{ id, statut: 'abandonnee' }]])
		const reponse = await accepter(request, jeton, id)
		expect([reponse.status(), ((await reponse.json()) as { message: string }).message]).toEqual([400, 'suggestion figee'])
	})

	test('reprendre une première génération échouée : une revue SANS consigne rejoue la demande', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const id = await suggerer(request, jeton, 'cle_refusee', 'reprendre')
		expect(await suggestion(request, id)).toMatchObject({ derniere_erreur: 'cle_refusee', generation_depuis: null })

		const reprise = await request.post(`${IA}/suggestions/${id}/revue`, { headers: simule(enTetesAuthentifies(jeton), 'valide'), data: {} })
		expect(reprise.status()).toBe(202)
		expect((await lignesDuFlux(reprise)).at(-1)).toEqual({ issue: 'revision', defauts: 0 })
		expect(await suggestion(request, id)).toMatchObject({ derniere_erreur: null, generation_depuis: null })
		const revisions = await lireService<Revision>(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=numero,origine,consigne`)
		expect(revisions).toEqual([{ numero: 1, origine: 'ia', consigne: `${PREFIXE} — reprendre` }])

		// Une révision existe désormais : sans consigne, la revue est refusée.
		const sansConsigne = await request.post(`${IA}/suggestions/${id}/revue`, { headers: simule(enTetesAuthentifies(jeton), 'valide'), data: {} })
		expect([sansConsigne.status(), await sansConsigne.json()]).toEqual([400, { erreur: 'consigne_invalide' }])
	})
})
