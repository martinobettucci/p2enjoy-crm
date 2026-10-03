// @verifies CRM-097 (docs/BACKLOG.md) — tranche T2.c : ce que l'écran de l'assistant lit, envoie et refuse
// @verifies docs/SPEC-ia.md §11.1 (le flux : identifiant aussitôt, battement ignoré, issue en dernier ; flux coupé),
//           §12.6 (revue sans consigne : un corps SANS consigne), §12.2, §12.3, §12.4, §12.7 (chaque refus classé)
// @verifies docs/SPEC-webapp.md §6.4 (une panne n'est jamais un succès)
// @verifies CRM-097 tranche T3.c — docs/SPEC-ia.md §13.5 (portée et cible envoyées ; `workflow_introuvable`), §13.2 (la
//           composition vivante et l'occupation), §13.4 (`PT409` « workflow modifie », « workflow archive », le point
//           de retour), §13.6 (les suggestions d'un workflow) ; décision 620

import { describe, expect, it } from 'vitest'
import {
	abandonnerSuggestion,
	accepterSuggestion,
	enregistrerCorrection,
	formaterHorodatage,
	generationEnVol,
	genererSuggestion,
	lireEtatAssistant,
	lireFlux,
	lireNumeroVersion,
	lireSuggestionsDuWorkflow,
	lireWorkflowVivant,
	revoirSuggestion,
	type AccesAssistant,
} from './assistant-ia'
import type { PropositionIa } from './brouillon-ia'
import type { ClientCrm } from './supabase'

const ID = '0c970000-0000-4000-8000-0000000000a1'
const WF = '0c970000-0000-4000-8000-0000000000b1'

/** Une réponse dont le corps arrive en MORCEAUX arbitraires, comme sur le réseau. */
function flux(morceaux: readonly string[], statut = 202): Response {
	const encodeur = new TextEncoder()
	return new Response(
		new ReadableStream<Uint8Array>({
			start(controleur) {
				for (const morceau of morceaux) controleur.enqueue(encodeur.encode(morceau))
				controleur.close()
			},
		}),
		{ status: statut, headers: { 'content-type': 'application/x-ndjson' } },
	)
}

function acces(reponse: Response | Error): { acces: AccesAssistant; appels: { url: string; init?: RequestInit }[] } {
	const appels: { url: string; init?: RequestInit }[] = []
	return {
		appels,
		acces: {
			url: 'http://api.test/',
			cleAnonyme: 'cle-anonyme',
			jeton: () => 'jeton-session',
			requete: async (url, init) => {
				appels.push({ url, ...(init === undefined ? {} : { init }) })
				if (reponse instanceof Error) throw reponse
				return reponse
			},
		},
	}
}

describe('lireFlux', () => {
	it('signale l’identifiant dès sa ligne, ignore le battement, rend l’issue — même coupés au milieu d’une ligne', async () => {
		const vus: string[] = []
		const lu = await lireFlux(flux([`{"suggestion_id":"${ID}"}\n{"atte`, 'nte":true}\n', '{"issue":"revision","defauts":2}']), (id) => vus.push(id))
		expect(vus).toEqual([ID])
		expect(lu).toEqual({ suggestionId: ID, issue: { issue: 'revision', defauts: 2 } })
	})

	it('un flux fermé sans issue rend `issue: null` — l’écran relira la suggestion', async () => {
		expect(await lireFlux(flux([`{"suggestion_id":"${ID}"}\n{"attente":true}\n`]), () => {})).toEqual({ suggestionId: ID, issue: null })
	})

	it('les issues `echec` et `sans_suite`', async () => {
		expect((await lireFlux(flux(['{"issue":"echec","echec":"delai_depasse"}\n']), () => {})).issue).toEqual({ issue: 'echec', echec: 'delai_depasse' })
		expect((await lireFlux(flux(['{"issue":"sans_suite"}\n']), () => {})).issue).toEqual({ issue: 'sans_suite' })
	})
})

describe('genererSuggestion et revoirSuggestion', () => {
	it('202 : la demande part avec le jeton de session et la clé anonyme ; l’issue revient', async () => {
		const { acces: a, appels } = acces(flux([`{"suggestion_id":"${ID}"}\n`, '{"issue":"revision","defauts":0}\n']))
		const vus: string[] = []
		expect(await genererSuggestion(a, 'ws-1', 'Un cycle', (id) => vus.push(id))).toEqual({
			statut: 'fini', suggestionId: ID, issue: { issue: 'revision', defauts: 0 },
		})
		expect(vus).toEqual([ID])
		expect(appels[0]?.url).toBe('http://api.test/functions/v1/ia/suggestions')
		expect(appels[0]?.init?.headers).toMatchObject({ apikey: 'cle-anonyme', authorization: 'Bearer jeton-session' })
		expect(JSON.parse(String(appels[0]?.init?.body))).toEqual({ workspace_id: 'ws-1', portee: 'workflow', demande: 'Un cycle' })
	})

	it.each([
		[400, { erreur: 'demande_invalide' }, { refus: 'demande_invalide' }],
		[401, { erreur: 'session_requise' }, { refus: 'session' }],
		[403, { erreur: 'refuse' }, { refus: 'refuse' }],
		[503, { erreur: 'assistant_indisponible', raison: 'cle_absente' }, { refus: 'indisponible', raison: 'cle_absente' }],
		[500, {}, { refus: 'inconnu' }],
	])('%i : refus classé', async (statut, corps, attendu) => {
		const { acces: a } = acces(new Response(JSON.stringify(corps), { status: statut }))
		expect(await genererSuggestion(a, 'ws-1', 'x', () => {})).toEqual({ statut: 'refus', ...attendu })
	})

	it('le réseau qui lâche est `reseau`, jamais un succès', async () => {
		const { acces: a } = acces(new TypeError('Failed to fetch'))
		expect(await genererSuggestion(a, 'ws-1', 'x', () => {})).toEqual({ statut: 'refus', refus: 'reseau' })
	})

	it('une revue SANS consigne envoie un corps sans consigne — la reprise d’une première génération (§12.6)', async () => {
		const { acces: a, appels } = acces(flux(['{"issue":"revision","defauts":1}\n']))
		expect(await revoirSuggestion(a, ID, null)).toEqual({ statut: 'fini', suggestionId: ID, issue: { issue: 'revision', defauts: 1 } })
		expect(appels[0]?.url).toBe(`http://api.test/functions/v1/ia/suggestions/${ID}/revue`)
		expect(JSON.parse(String(appels[0]?.init?.body))).toEqual({})
	})

	it.each([
		[{ erreur: 'suggestion_figee' }, 'figee'],
		[{ erreur: 'generation_en_cours' }, 'en_cours'],
	])('409 %j : %s', async (corps, refus) => {
		const { acces: a } = acces(new Response(JSON.stringify(corps), { status: 409 }))
		expect(await revoirSuggestion(a, ID, 'Encore')).toEqual({ statut: 'refus', refus })
	})

	it('l’état de l’assistant ; une réponse illisible rend `null`', async () => {
		expect(await lireEtatAssistant(acces(new Response('{"disponible":false,"raison":"cle_refusee","modele":"gemma4:e2b"}')).acces)).toEqual({
			disponible: false, raison: 'cle_refusee', modele: 'gemma4:e2b',
		})
		expect(await lireEtatAssistant(acces(new Response('nope', { status: 502 })).acces)).toBeNull()
	})
})

/** Un client dont chaque appel rend la réponse donnée, et qui retient ce qu'on lui a envoyé. */
function client(reponse: { data: unknown; error: { code: string; message: string; details?: string } | null }) {
	const envois: unknown[] = []
	const chaine: Record<string, unknown> = {}
	for (const m of ['select', 'eq', 'single']) chaine[m] = () => chaine
	chaine['then'] = (resoudre: (v: unknown) => unknown) => Promise.resolve(reponse).then(resoudre)
	const fauxClient = {
		from: () => ({
			insert: (charge: unknown) => (envois.push(charge), chaine),
			update: (charge: unknown) => (envois.push(charge), chaine),
		}),
		rpc: (nom: string, params: unknown) => (envois.push({ nom, params }), Promise.resolve(reponse)),
	}
	return { client: fauxClient as unknown as ClientCrm, envois }
}

const PROPOSITION = {
	version: 1, workflow: { nom: 'x' }, noeuds: [], etapes: [], transitions: [], champs: [], regles: [], exigences: [],
} as PropositionIa

describe('corriger, accepter, abandonner', () => {
	it('la correction envoie la proposition entière, origine `correction`, SANS défauts — la base les calcule', async () => {
		const revision = { id: 'r', numero: 2, origine: 'correction', consigne: null, proposition: PROPOSITION, defauts: [], modele: null, created_at: '' }
		const { client: c, envois } = client({ data: revision, error: null })
		expect(await enregistrerCorrection(c, ID, PROPOSITION)).toEqual({ ok: true, revision })
		expect(envois[0]).toEqual({ suggestion_id: ID, origine: 'correction', proposition: PROPOSITION })
	})

	it.each([
		[{ code: '42501', message: 'permission denied' }, 'refuse'],
		[{ code: 'PT404', message: 'suggestion introuvable' }, 'introuvable'],
		[{ code: '22023', message: 'proposition mal formee' }, 'mal_formee'],
		[{ code: 'P0001', message: 'suggestion figee' }, 'figee'],
		[{ code: 'P0001', message: 'generation en cours' }, 'en_cours'],
		[{ code: 'XX000', message: '?' }, 'panne'],
	])('correction refusée %j : %s', async (error, refus) => {
		expect(await enregistrerCorrection(client({ data: null, error }).client, ID, PROPOSITION)).toEqual({ ok: false, refus })
	})

	it('accepter rend le workflow créé ; une réponse sans identifiant est une panne', async () => {
		const { client: c, envois } = client({ data: WF, error: null })
		expect(await accepterSuggestion(c, ID)).toEqual({ ok: true, idWorkflow: WF })
		expect(envois[0]).toEqual({ nom: 'accepter_suggestion_ia', params: { p_suggestion: ID } })
		expect(await accepterSuggestion(client({ data: null, error: null }).client, ID)).toEqual({ ok: false, refus: 'panne' })
	})

	it.each([
		[{ code: '42501', message: 'authentification requise' }, { refus: 'session' }],
		[{ code: 'PT404', message: 'suggestion introuvable' }, { refus: 'introuvable' }],
		[{ code: 'P0001', message: 'suggestion figee' }, { refus: 'figee' }],
		[{ code: 'P0001', message: 'portee non livree' }, { refus: 'panne' }],
		[{ code: 'P0001', message: 'generation en cours' }, { refus: 'en_cours' }],
		[{ code: 'P0001', message: 'aucune revision' }, { refus: 'aucune_revision' }],
		[{ code: 'P0001', message: 'proposition non conforme', details: '2 defaut(s)' }, { refus: 'non_conforme', defauts: 2 }],
		[{ code: 'P0001', message: 'autre chose' }, { refus: 'panne' }],
	])('acceptation refusée %j', async (error, attendu) => {
		expect(await accepterSuggestion(client({ data: null, error }).client, ID)).toEqual({ ok: false, ...attendu })
	})

	it('abandonner : une ligne est un abandon, zéro ligne est SANS EFFET, figée est dite', async () => {
		const { client: c, envois } = client({ data: [{ id: ID }], error: null })
		expect(await abandonnerSuggestion(c, ID)).toEqual({ ok: true })
		expect(envois[0]).toEqual({ statut: 'abandonnee' })
		expect(await abandonnerSuggestion(client({ data: [], error: null }).client, ID)).toEqual({ ok: false, refus: 'sans_effet' })
		expect(await abandonnerSuggestion(client({ data: null, error: { code: 'P0001', message: 'suggestion figee' } }).client, ID)).toEqual({ ok: false, refus: 'figee' })
	})
})

describe('petites règles', () => {
	it('une génération est en vol si son verrou a moins de 180 s', () => {
		const maintenant = Date.parse('2026-10-02T12:00:00Z')
		expect(generationEnVol({ generation_depuis: null }, maintenant)).toBe(false)
		expect(generationEnVol({ generation_depuis: '2026-10-02T11:58:30Z' }, maintenant)).toBe(true)
		expect(generationEnVol({ generation_depuis: '2026-10-02T11:56:00Z' }, maintenant)).toBe(false)
	})

	it('un horodatage illisible rend `null`, jamais « Invalid Date »', () => {
		expect(formaterHorodatage('pas une date')).toBeNull()
		expect(formaterHorodatage('2026-10-02T12:05:00Z', 'heure')).toMatch(/\d{2}:\d{2}/)
	})
})

describe('T3.c — faire évoluer un workflow existant', () => {
	it('une demande ciblée envoie sa portée et le workflow', async () => {
		const { acces: a, appels } = acces(flux([`{"suggestion_id":"${ID}"}\n`, '{"issue":"revision","defauts":1}\n']))
		await genererSuggestion(a, 'ws-1', 'Ajoute une qualification', () => {}, { portee: 'etapes', idWorkflow: WF })
		expect(JSON.parse(String(appels[0]?.init?.body))).toEqual({
			workspace_id: 'ws-1', portee: 'etapes', workflow_id: WF, demande: 'Ajoute une qualification',
		})
	})

	it('404 `workflow_introuvable` est distinct d’une suggestion introuvable', async () => {
		const { acces: a } = acces(new Response('{"erreur":"workflow_introuvable"}', { status: 404 }))
		expect(await genererSuggestion(a, 'ws-1', 'x', () => {}, { portee: 'champs', idWorkflow: WF })).toEqual({
			statut: 'refus', refus: 'workflow_introuvable',
		})
		const { acces: b } = acces(new Response('{"erreur":"suggestion_introuvable"}', { status: 404 }))
		expect(await revoirSuggestion(b, ID, 'x')).toEqual({ statut: 'refus', refus: 'introuvable' })
	})

	it.each([
		[{ code: 'PT409', message: 'workflow modifie' }, 'workflow_modifie'],
		[{ code: 'P0001', message: 'workflow archive' }, 'workflow_archive'],
	])('acceptation d’une modification refusée %j : %s', async (error, refus) => {
		expect(await accepterSuggestion(client({ data: null, error }).client, ID)).toEqual({ ok: false, refus })
	})

	/** Un client dont `rpc` et les lectures rendent ce qu'on leur donne, par nom. */
	function clientLectures(reponses: Record<string, { data: unknown; error: { message: string } | null; status?: number }>) {
		const filtres: unknown[][] = []
		const chaine = (nom: string) => {
			const c: Record<string, unknown> = {}
			for (const m of ['select', 'eq', 'is', 'order', 'maybeSingle']) c[m] = (...args: unknown[]) => (filtres.push([m, ...args]), c)
			c['then'] = (resoudre: (v: unknown) => unknown) => Promise.resolve(reponses[nom]).then(resoudre)
			return c
		}
		return {
			filtres,
			client: { from: (table: string) => chaine(table), rpc: (nom: string) => Promise.resolve(reponses[nom]) } as unknown as ClientCrm,
		}
	}

	it('le workflow vivant : sa composition et son occupation ; une occupation non numérique est écartée', async () => {
		const { client: c } = clientLectures({
			proposition_du_workflow: { data: { ...PROPOSITION, workflow: { nom: 'Pipeline' } }, error: null },
			occupation_du_workflow: { data: { relance: 9, perdu: 'x' }, error: null },
		})
		expect(await lireWorkflowVivant(c, WF)).toEqual({
			statut: 'pret',
			donnees: { composition: { ...PROPOSITION, workflow: { nom: 'Pipeline' } }, occupation: { relance: 9 } },
		})
	})

	it('un workflow illisible rend `null` ; une erreur reste une erreur, jamais un vide', async () => {
		const illisible = clientLectures({
			proposition_du_workflow: { data: null, error: null },
			occupation_du_workflow: { data: {}, error: null },
		})
		expect(await lireWorkflowVivant(illisible.client, WF)).toEqual({ statut: 'pret', donnees: null })
		const panne = clientLectures({
			proposition_du_workflow: { data: null, error: { message: 'boom' }, status: 500 },
			occupation_du_workflow: { data: {}, error: null },
		})
		expect((await lireWorkflowVivant(panne.client, WF)).statut).toBe('erreur')
	})

	it('les suggestions d’un workflow : en revue, de CE workflow', async () => {
		const { client: c, filtres } = clientLectures({ suggestions_ia: { data: [], error: null } })
		expect(await lireSuggestionsDuWorkflow(c, WF)).toEqual({ statut: 'pret', donnees: [] })
		expect(filtres).toContainEqual(['eq', 'statut', 'en_revue'])
		expect(filtres).toContainEqual(['eq', 'workflow_id', WF])
	})

	it('le numéro du point de retour ; illisible, `null`', async () => {
		expect(await lireNumeroVersion(clientLectures({ workflow_versions: { data: { version_number: 4 }, error: null } }).client, 'v')).toBe(4)
		expect(await lireNumeroVersion(clientLectures({ workflow_versions: { data: null, error: null } }).client, 'v')).toBeNull()
	})
})
