// @verifies CRM-113 (docs/BACKLOG.md) — tranche T1 : le libellé et la probabilité d'une étape, et les champs natifs,
//           sur la pile réelle, aux jetons réels
// @verifies docs/SPEC-ia.md §14.3 (l'étape porte `libelle` et `probabilite` ; surcharge posée ou `null` à
//           l'acceptation), §14.4 (la composition vivante rend les noms effectifs), §14.5 (`native_field` écrit par la
//           base sur une correction, bloquant l'acceptation), §14.8 (preuves d'API) ; docs/JOURNAL.md décision 677
// @verifies CRM-113 tranche T2 — docs/SPEC-ia.md §14.6 (le scénario `catalogue` du simulateur : ses deux défauts écrits
//           par la base ; le libellé et la probabilité de l'étape gardés par la mise en forme de la fonction)
// @verifies CLAUDE.md §10 (le commercial ne corrige pas une suggestion, avec son jeton réel), §15 (effets relus en base)
//
// La suggestion naît par la vraie fonction et le simulateur (scénario `valide`) ; les corrections passent par
// PostgREST comme celles de l'écran. Après chaque scénario, la clé de service retire le workflow créé, les nœuds que
// l'acceptation a ajoutés au catalogue, puis les suggestions — retrait CONSTATÉ.

import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { COMPTES_SEED, URL_API, enTetesAuthentifies, enTetesService, jetonDe } from './jetons'

const ADMIN = COMPTES_SEED[0]
const BIZDEV = COMPTES_SEED[1]
const ESPACE = '5eed0000-0000-4000-8000-000000000001'
const PREFIXE = 'Sonde 113 T1'
const IA = `${URL_API}/functions/v1/ia`
const rest = (chemin: string) => `${URL_API}/rest/v1/${chemin}`
const FILTRE = `demande=like.${encodeURIComponent(`${PREFIXE}*`)}`
/** Les clés des nœuds que la proposition `valide` du simulateur ajoute au catalogue. */
const NOEUDS_SIMULES = ['prise-de-contact', 'maquette', 'gagne-web', 'perdu-web']

type Noeud = { cle: string; libelle: string; probabilite: number }
type Etape = { noeud: string; initiale: boolean; libelle?: string | null; probabilite?: number | null }
type Champ = { cle: string; libelle: string; type: string; choix: string[] | null; devise: string | null; aide: string | null }
type Proposition = { noeuds: Noeud[]; etapes: Etape[]; champs: Champ[]; [cle: string]: unknown }
type Revision = { numero: number; defauts: { code: string; chemin: string; valeurs: Record<string, unknown> }[] }

async function lireService<T>(requete: APIRequestContext, chemin: string): Promise<T[]> {
	const reponse = await requete.get(rest(chemin), { headers: enTetesService() })
	expect(reponse.status(), chemin).toBe(200)
	return (await reponse.json()) as T[]
}

async function lignesDuFlux(reponse: APIResponse): Promise<Record<string, unknown>[]> {
	return (await reponse.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
}

/** Crée une suggestion par la vraie fonction et le simulateur, et rend son identifiant et sa première proposition. */
async function suggerer(requete: APIRequestContext, jeton: string, nom: string, scenario = 'valide'): Promise<{ id: string; proposition: Proposition }> {
	const reponse = await requete.post(`${IA}/suggestions`, {
		headers: { ...enTetesAuthentifies(jeton), 'x-ia-simulateur': scenario },
		data: { workspace_id: ESPACE, portee: 'workflow', demande: `${PREFIXE} — ${nom}` },
	})
	expect(reponse.status(), await reponse.text()).toBe(202)
	const id = (await lignesDuFlux(reponse))[0]?.suggestion_id as string
	const [premiere] = await lireService<{ proposition: Proposition }>(requete, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=proposition`)
	return { id, proposition: premiere?.proposition as Proposition }
}

const corriger = (requete: APIRequestContext, jeton: string, id: string, proposition: Proposition) =>
	requete.post(rest('suggestions_ia_revisions?select=numero,defauts'), {
		headers: { ...enTetesAuthentifies(jeton), prefer: 'return=representation' },
		data: { suggestion_id: id, origine: 'correction', proposition },
	})

const accepter = (requete: APIRequestContext, jeton: string, id: string) =>
	requete.post(rest('rpc/accepter_suggestion_ia'), { headers: enTetesAuthentifies(jeton), data: { p_suggestion: id } })

test.describe('Le générateur connaît l’affaire et le catalogue — la base (docs/SPEC-ia.md §14)', () => {
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

	test('un champ « montant » proposé est relevé par la base (native_field) et bloque l’acceptation', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const { id, proposition } = await suggerer(request, jeton, 'champ natif')
		const avecMontant: Proposition = {
			...proposition,
			champs: [...proposition.champs, { cle: 'montant', libelle: 'Montant', type: 'money', choix: null, devise: 'EUR', aide: null }],
		}
		const reponse = await corriger(request, jeton, id, avecMontant)
		expect(reponse.status(), await reponse.text()).toBe(201)
		const [ecrite] = (await reponse.json()) as Revision[]
		expect(ecrite?.defauts).toEqual([
			{ code: 'native_field', chemin: `champs[${proposition.champs.length}]`, valeurs: { cle: 'montant', native: 'amount' } },
		])
		const refus = await accepter(request, jeton, id)
		expect(refus.status()).toBe(400)
		expect(await refus.json()).toMatchObject({ code: 'P0001', message: 'proposition non conforme', details: '1 defaut(s)' })
	})

	test('le libellé et la probabilité d’une étape deviennent ses surcharges ; égaux au nœud, ils ne surchargent rien', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const { id, proposition } = await suggerer(request, jeton, 'surcharges')
		const noeudDe = (cle: string) => proposition.noeuds.find((n) => n.cle === cle) as Noeud
		const [premiere, seconde] = proposition.etapes as [Etape, Etape]
		const corrigee: Proposition = {
			...proposition,
			etapes: [
				{ ...premiere, libelle: 'Premier échange', probabilite: 15 },
				{ ...seconde, libelle: noeudDe(seconde.noeud).libelle, probabilite: noeudDe(seconde.noeud).probabilite },
				...proposition.etapes.slice(2),
			],
		}

		// Le commercial, avec son jeton réel : la base refuse sa correction. La RLS lui cache la suggestion, et le
		// déclencheur des révisions la dit introuvable — indiscernable d'une suggestion qui n'existe pas (§12.3).
		const parLeCommercial = await corriger(request, await jetonDe(BIZDEV.adresse), id, corrigee)
		expect([parLeCommercial.status(), ((await parLeCommercial.json()) as { message: string }).message]).toEqual([404, 'suggestion introuvable'])
		expect((await lireService(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=numero`)).length).toBe(1)

		const reponse = await corriger(request, jeton, id, corrigee)
		expect(reponse.status(), await reponse.text()).toBe(201)
		expect(((await reponse.json()) as Revision[])[0]?.defauts).toEqual([])
		const acceptation = await accepter(request, jeton, id)
		expect(acceptation.status(), await acceptation.text()).toBe(200)
		const idWorkflow = (await acceptation.json()) as string

		const etapes = await lireService<{ label_override: string | null; probability_override: number | null; workflow_nodes_catalog: { key: string } }>(
			request, `workflow_steps?workflow_id=eq.${idWorkflow}&select=label_override,probability_override,workflow_nodes_catalog(key)&order=position`)
		expect(etapes.slice(0, 2)).toEqual([
			{ label_override: 'Premier échange', probability_override: 15, workflow_nodes_catalog: { key: premiere.noeud } },
			{ label_override: null, probability_override: null, workflow_nodes_catalog: { key: seconde.noeud } },
		])

		// La composition vivante, lue par l'administratrice : le nom et la probabilité effectifs de chaque étape.
		const vivante = await request.post(rest('rpc/proposition_du_workflow'), { headers: enTetesAuthentifies(jeton), data: { p_workflow: idWorkflow } })
		expect(vivante.status()).toBe(200)
		const etapesVivantes = ((await vivante.json()) as Proposition).etapes
		expect(etapesVivantes.slice(0, 2)).toEqual([
			{ noeud: premiere.noeud, initiale: premiere.initiale, libelle: 'Premier échange', probabilite: 15 },
			{ noeud: seconde.noeud, initiale: seconde.initiale, libelle: noeudDe(seconde.noeud).libelle, probabilite: noeudDe(seconde.noeud).probabilite },
		])
	})

	test('T2 — le scénario `catalogue` : la base écrit ses deux défauts, et l’étape garde son nom et sa probabilité', async ({ request }) => {
		const jeton = await jetonDe(ADMIN.adresse)
		const { id, proposition } = await suggerer(request, jeton, 'catalogue', 'catalogue')
		const [revision] = await lireService<Revision>(request, `suggestions_ia_revisions?suggestion_id=eq.${id}&select=numero,defauts`)
		expect(revision?.defauts).toEqual([
			{ code: 'noeud_deja_au_catalogue', chemin: 'noeuds[0]', valeurs: { cle: 'negociation' } },
			{ code: 'native_field', chemin: 'champs[0]', valeurs: { cle: 'montant', native: 'amount' } },
		])
		// La mise en forme de la fonction a gardé le nom et la probabilité de l'étape, et `null` là où le nœud convient.
		expect(proposition.etapes.slice(0, 2)).toEqual([
			{ noeud: 'prospection', initiale: true, libelle: 'Premier contact', probabilite: 15 },
			{ noeud: 'negociation', initiale: false, libelle: null, probabilite: null },
		])
		const refus = await accepter(request, jeton, id)
		expect(await refus.json()).toMatchObject({ code: 'P0001', message: 'proposition non conforme', details: '2 defaut(s)' })
	})
})
