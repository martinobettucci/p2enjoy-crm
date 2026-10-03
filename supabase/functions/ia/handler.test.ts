// @verifies CRM-097 (docs/BACKLOG.md) — tranche T1 : la fonction edge `ia`
// @verifies docs/SPEC-ia.md §4 (mode dégradé), §11.1 (la génération vit dans sa requête : flux NDJSON,
//           première ligne aussitôt, battement, issue), §11.2 (la base autorise AVANT tout appel au
//           modèle), §11.3 (routes et réponses), §11.4 (verrou, échec nommé) ; CLAUDE.md §20 (journaux
//           sans contenu ni secret)
// @verifies CRM-097 tranche T2.b — docs/SPEC-ia.md §12.1 (la fonction n'envoie aucun défaut : elle relit ceux que la
//           base a écrits), §12.6 (issue `sans_suite` ; revue sans consigne d'une suggestion sans révision ; les
//           défauts de la base transmis à la revue) ; décision 618
// @verifies CRM-097 tranche T3.b — docs/SPEC-ia.md §13.5 (portées et cible ; composition vivante lue AVANT la création,
//           avec le jeton de l'appelant ; occupation et portée au modèle, relues à la revue ; schéma d'une
//           modification ; journal sans contenu) ; décision 620

import { describe, expect, it } from 'vitest'
import { lireConfiguration } from './configuration.ts'
import type { DependancesIa, RevisionDuModele, Suggestion } from './handler.ts'
import { traiterIa } from './handler.ts'
import type { Generation, Message } from './ollama.ts'
import { SCHEMA_MODIFICATION, SCHEMA_WORKFLOW, type Defaut } from './proposition.ts'

const ESPACE = '0c970000-0000-4000-8000-0000000000e1'
const ID = '0c970000-0000-4000-8000-0000000000a1'
const ADM = '0c970000-0000-4000-8000-000000000011'
const WF = '0c970000-0000-4000-8000-0000000000f1'
const DEMANDE = 'Un cycle de vente pour une agence web — confidentiel'

const SUGGESTION: Suggestion = {
	id: ID, workspace_id: ESPACE, workflow_id: null, portee: 'workflow', statut: 'en_revue', demande: DEMANDE,
	generation_depuis: null, created_by: ADM,
}
const MODIFICATION: Suggestion = { ...SUGGESTION, workflow_id: WF, portee: 'etapes' }

/** La composition vivante telle que la base la rend (docs/SPEC-ia.md §13.2) ; son champ porte un libellé témoin. */
const VIVANTE = {
	version: 1,
	workflow: { nom: 'Pipeline' },
	noeuds: [],
	etapes: [{ noeud: 'prospection', initiale: true }, { noeud: 'relance', initiale: false }],
	transitions: [{ de: 'prospection', vers: 'relance', libelle: '', commentaire_requis: false }],
	champs: [{ cle: 'budget', libelle: 'Budget témoin', type: 'money', choix: null, devise: 'EUR', aide: null }],
	regles: [],
	exigences: [],
}

const VALIDE = {
	workflow: { nom: 'Refonte' },
	noeuds: [{ cle: 'contact', libelle: 'Contact', nature: 'open', probabilite: 10 }],
	etapes: [{ noeud: 'contact', initiale: true }],
	transitions: [], champs: [], regles: [], exigences: [],
}

type Banc = {
	d: DependancesIa
	revisions: RevisionDuModele[]
	echecs: string[]
	journal: string[]
	appelsModele: Message[][]
	schemas: unknown[]
	creations: number
	champsCreation: Record<string, unknown>[]
	/** L'ordre des lectures et écritures de la base, pour prouver ce qui précède quoi. */
	ordre: string[]
	liberer: () => void
}

function banc(options: {
	cle?: string | null
	creation?: 'ok' | 403 | 400
	verrou?: Suggestion | null
	lue?: Suggestion | null
	derniere?: { proposition: unknown; defauts: Defaut[] }
	/** Ce que la base rend à l'écriture d'une révision : le nombre de défauts qu'ELLE a calculés, ou un refus. */
	ecriture?: { ecrite: true; defauts: number } | { ecrite: false }
	generation?: Generation
	/** Retient la génération jusqu'à `liberer()` : le flux devient observable en route. */
	retenir?: boolean
	battementMs?: number
	/** Ce que rend `proposition_du_workflow` ; `null` : workflow illisible. */
	composition?: unknown | null
	creee?: Suggestion
} = {}): Banc {
	let liberer = () => {}
	const retenue = new Promise<void>((resoudre) => (liberer = resoudre))
	const b: Banc = {
		d: undefined as never, revisions: [], echecs: [], journal: [], appelsModele: [], schemas: [], creations: 0,
		champsCreation: [], ordre: [], liberer: () => liberer(),
	}
	const configuration = lireConfiguration((nom) =>
		({ OLLAMA_HOST: 'https://llm.example.test', OLLAMA_API_KEY: options.cle === undefined ? 'sk-secret-du-serveur' : options.cle ?? undefined })[nom] ?? undefined,
	)
	b.d = {
		configuration,
		async creerSuggestion(_jeton, champs) {
			b.creations++
			b.champsCreation.push(champs)
			b.ordre.push('creation')
			const c = options.creation ?? 'ok'
			return c === 'ok' ? { ok: true, suggestion: options.creee ?? SUGGESTION } : { ok: false, statut: c }
		},
		verrouiller: async () => (options.verrou === undefined ? SUGGESTION : options.verrou),
		lireSuggestion: async () => options.lue ?? null,
		lireDerniereRevision: async () => options.derniere ?? null,
		lireCatalogue: async () => [{ cle: 'relance', libelle: 'Relance', nature: 'open' }],
		lireComposition: async (jeton, workflowId) => (
			b.ordre.push(`composition:${workflowId}:${jeton}`), options.composition === undefined ? VIVANTE : options.composition
		),
		lireOccupation: async (jeton, workflowId) => (b.ordre.push(`occupation:${workflowId}:${jeton}`), { prospection: 11, relance: 9 }),
		ecrireRevision: async (r) => (b.revisions.push(r), options.ecriture ?? { ecrite: true, defauts: 0 }),
		ecrireEchec: async (_id, e) => void b.echecs.push(e),
		lireEtat: async (cible, modele) => (cible === null ? { disponible: false, raison: 'cle_absente', modele } : { disponible: true, modele }),
		async generer(_cible, messages, schema) {
			b.appelsModele.push([...messages])
			b.schemas.push(schema)
			if (options.retenir) await retenue
			return options.generation ?? { ok: true, contenu: VALIDE, jetonsEntree: 537, jetonsSortie: 668, dureeMs: 32_500 }
		},
		battementMs: options.battementMs ?? 60_000,
		maintenantMs: () => Date.parse('2026-10-02T12:00:00Z'),
		journaliser: (e) => void b.journal.push(JSON.stringify(e)),
	}
	return b
}

const appel = (b: Banc, methode: string, chemin: string, corps?: unknown, jeton: string | null = 'jeton-de-l-appelant') =>
	traiterIa(
		new Request(`http://functions/${chemin}`, {
			method: methode,
			headers: { 'content-type': 'application/json', ...(jeton === null ? {} : { authorization: `Bearer ${jeton}` }) },
			...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
		}),
		b.d,
	)
const creer = (b: Banc, corps: unknown = { workspace_id: ESPACE, portee: 'workflow', demande: DEMANDE }, jeton?: string | null) =>
	appel(b, 'POST', 'ia/suggestions', corps, jeton)
const revoir = (b: Banc, consigne: unknown = 'Ajoute une étape de relance') =>
	appel(b, 'POST', `ia/suggestions/${ID}/revue`, { consigne })

/** Les lignes NDJSON du flux, lu jusqu'à sa fin — c'est-à-dire jusqu'à la fin de la génération. */
async function lignes(reponse: Response): Promise<Record<string, unknown>[]> {
	expect(reponse.headers.get('content-type')).toContain('application/x-ndjson')
	return (await reponse.text()).split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Record<string, unknown>)
}

describe('GET /ia/etat', () => {
	it('dit l’état de l’assistant ; sans clé : indisponible, clé absente', async () => {
		expect(await (await appel(banc(), 'GET', 'ia/etat')).json()).toEqual({ disponible: true, modele: 'gemma4:e2b' })
		expect(await (await appel(banc({ cle: null }), 'GET', 'ia/etat')).json()).toMatchObject({ disponible: false, raison: 'cle_absente' })
	})

	it('toute autre méthode : 405 ; route inconnue : 404', async () => {
		expect((await appel(banc(), 'POST', 'ia/etat')).status).toBe(405)
		expect((await appel(banc(), 'GET', 'ia/ailleurs')).status).toBe(404)
	})
})

describe('POST /ia/suggestions — le flux', () => {
	it('202 ; la première ligne part PENDANT la génération, la dernière porte l’issue, écrite aussi en base', async () => {
		const b = banc({ retenir: true })
		const reponse = await creer(b)
		expect(reponse.status).toBe(202)
		const lecteur = reponse.body!.getReader()
		const premiere = JSON.parse(new TextDecoder().decode((await lecteur.read()).value).trim())
		expect(premiere).toEqual({ suggestion_id: ID })
		expect(b.revisions).toHaveLength(0) // la génération est retenue : rien d'écrit encore
		b.liberer()
		let reste = ''
		for (let morceau = await lecteur.read(); !morceau.done; morceau = await lecteur.read()) reste += new TextDecoder().decode(morceau.value)
		expect(JSON.parse(reste.trim())).toEqual({ issue: 'revision', defauts: 0 })
		expect(b.revisions).toHaveLength(1)
		expect(b.revisions[0]).toMatchObject({
			suggestion_id: ID, consigne: DEMANDE, modele: 'gemma4:e2b',
			jetons_entree: 537, jetons_sortie: 668, duree_ms: 32_500, created_by: ADM,
		})
		expect(b.revisions[0]?.proposition.version).toBe(1)
		// La fonction n'envoie AUCUN défaut : la base les calcule (docs/SPEC-ia.md §12.1).
		expect(b.revisions[0]).not.toHaveProperty('defauts')
	})

	it('un battement `{"attente": true}` tient la connexion tant que la génération dure', async () => {
		const b = banc({ retenir: true, battementMs: 5 })
		const flux = lignes(await creer(b))
		await new Promise((resoudre) => setTimeout(resoudre, 30))
		b.liberer()
		const tout = await flux
		expect(tout[0]).toEqual({ suggestion_id: ID })
		expect(tout.filter((l) => l.attente === true).length).toBeGreaterThan(0)
		expect(tout.at(-1)).toEqual({ issue: 'revision', defauts: 0 })
	})

	it('la demande et le catalogue de l’espace partent au modèle — rien d’autre', async () => {
		const b = banc()
		await lignes(await creer(b))
		const envoye = JSON.stringify(b.appelsModele[0])
		expect(envoye).toContain(DEMANDE)
		expect(envoye).toContain('relance — Relance (open)')
	})

	it('le REFUS DE LA BASE (non-administrateur) rend 403, et le modèle n’est jamais appelé', async () => {
		const b = banc({ creation: 403 })
		expect((await creer(b)).status).toBe(403)
		expect(b.appelsModele).toHaveLength(0)
	})

	it('sans clé : 503 assistant indisponible, sans rien créer', async () => {
		const b = banc({ cle: null })
		const reponse = await creer(b)
		expect(reponse.status).toBe(503)
		expect(await reponse.json()).toEqual({ erreur: 'assistant_indisponible', raison: 'cle_absente' })
		expect(b.creations).toBe(0)
	})

	it.each([
		['sans session', undefined, null, 401],
		['demande vide', { workspace_id: ESPACE, portee: 'workflow', demande: '  ' }, undefined, 400],
		['demande de plus de 4 000 caractères', { workspace_id: ESPACE, portee: 'workflow', demande: 'a'.repeat(4001) }, undefined, 400],
		['espace qui n’est pas un identifiant', { workspace_id: 'mon-espace', portee: 'workflow', demande: 'x' }, undefined, 400],
		['portée inconnue', { workspace_id: ESPACE, portee: 'tout', demande: 'x' }, undefined, 400],
		['portée ciblée SANS workflow', { workspace_id: ESPACE, portee: 'etapes', demande: 'x' }, undefined, 400],
		['portée ciblée, workflow qui n’est pas un identifiant', { workspace_id: ESPACE, portee: 'champs', workflow_id: 'pipeline', demande: 'x' }, undefined, 400],
		['portée `workflow` AVEC un workflow', { workspace_id: ESPACE, portee: 'workflow', workflow_id: WF, demande: 'x' }, undefined, 400],
	] as const)('%s : %s', async (_nom, corps, jeton, statut) => {
		const b = banc()
		const reponse = await creer(b, corps ?? { workspace_id: ESPACE, portee: 'workflow', demande: 'x' }, jeton)
		expect(reponse.status).toBe(statut)
		if (statut === 400) expect(await reponse.json()).toEqual({ erreur: 'demande_invalide' })
		expect(b.creations).toBe(0)
		expect(b.ordre).toEqual([])
	})

	it('une CRÉATION : le schéma sans `remappages`, aucun workflow vivant lu ni envoyé', async () => {
		const b = banc()
		await lignes(await creer(b))
		expect(b.schemas).toEqual([SCHEMA_WORKFLOW])
		expect(b.ordre).toEqual(['creation'])
		expect(JSON.stringify(b.appelsModele[0])).not.toContain('Le workflow actuel')
		expect(b.champsCreation[0]).toEqual({ workspace_id: ESPACE, portee: 'workflow', demande: DEMANDE })
	})

	it.each([
		['un échec du serveur', { ok: false, echec: 'cle_refusee' } as Generation, 'cle_refusee'],
		['le dépassement de la borne', { ok: false, echec: 'delai_depasse' } as Generation, 'delai_depasse'],
		['une sortie hors forme', { ok: true, contenu: 'Voici', jetonsEntree: 1, jetonsSortie: 1, dureeMs: 1 } as Generation, 'reponse_invalide'],
	])('%s s’écrit comme échec nommé, sans révision, et le flux le dit', async (_nom, generation, echec) => {
		const b = banc({ generation })
		const tout = await lignes(await creer(b))
		expect(tout.at(-1)).toEqual({ issue: 'echec', echec })
		expect(b.echecs).toEqual([echec])
		expect(b.revisions).toHaveLength(0)
	})

	it('une proposition incohérente est conservée telle quelle, et le flux porte le nombre de défauts que la BASE a écrits', async () => {
		const b = banc({
			generation: {
				ok: true,
				contenu: { ...VALIDE, etapes: [{ noeud: 'contact', initiale: false }] },
				jetonsEntree: 1, jetonsSortie: 1, dureeMs: 1,
			},
			ecriture: { ecrite: true, defauts: 1 },
		})
		expect((await lignes(await creer(b))).at(-1)).toEqual({ issue: 'revision', defauts: 1 })
		expect(b.revisions[0]?.proposition.etapes).toEqual([{ noeud: 'contact', initiale: false }])
	})

	it('une révision que la base refuse — suggestion abandonnée pendant la génération — rend `sans_suite`', async () => {
		const b = banc({ ecriture: { ecrite: false } })
		expect((await lignes(await creer(b))).at(-1)).toEqual({ issue: 'sans_suite' })
		expect(b.journal.some((l) => l.includes('generation_sans_suite'))).toBe(true)
	})

	it('AUCUN journal ni aucune ligne du flux ne porte la demande, la consigne ou la clé', async () => {
		const b = banc()
		const flux = JSON.stringify([...(await lignes(await creer(b))), ...(await lignes(await revoir(b, 'Ajoute une relance — secrète')))])
		const tout = `${b.journal.join('\n')}\n${flux}`
		expect(tout).not.toContain('confidentiel')
		expect(tout).not.toContain('secrète')
		expect(tout).not.toContain('sk-secret-du-serveur')
		expect(b.journal.length).toBeGreaterThan(0)
	})
})

describe('POST /ia/suggestions/:id/revue', () => {
	it('202 ; le modèle reçoit la DERNIÈRE révision — corrigée à la main —, les défauts de la base, et la consigne', async () => {
		const corrigee = { ...VALIDE, workflow: { nom: 'Refonte corrigée à la main' } }
		const b = banc({ derniere: { proposition: corrigee, defauts: [{ code: 'noeud_inutilise', chemin: 'noeuds[1]', valeurs: { cle: 'oublie' } }] } })
		const reponse = await revoir(b)
		expect(reponse.status).toBe(202)
		expect((await lignes(reponse)).at(-1)).toEqual({ issue: 'revision', defauts: 0 })
		const envoye = JSON.stringify(b.appelsModele[0])
		expect(envoye).toContain('Refonte corrigée à la main')
		expect(envoye).toContain('Ajoute une étape de relance')
		expect(envoye).toContain('noeud_inutilise')
		expect(envoye).toContain('oublie')
		expect(b.revisions[0]?.consigne).toBe('Ajoute une étape de relance')
	})

	it('sans consigne, une suggestion SANS révision rejoue sa demande — la reprise d’une première génération échouée', async () => {
		const b = banc()
		const reponse = await appel(b, 'POST', `ia/suggestions/${ID}/revue`, {})
		expect(reponse.status).toBe(202)
		expect((await lignes(reponse)).at(-1)).toEqual({ issue: 'revision', defauts: 0 })
		expect(JSON.stringify(b.appelsModele[0])).toContain(DEMANDE)
		expect(b.revisions[0]?.consigne).toBe(DEMANDE)
	})

	it('sans consigne, une suggestion qui a déjà une révision est refusée (400), sans appel au modèle', async () => {
		const b = banc({ derniere: { proposition: VALIDE, defauts: [] } })
		const reponse = await appel(b, 'POST', `ia/suggestions/${ID}/revue`, {})
		expect([reponse.status, await reponse.json()]).toEqual([400, { erreur: 'consigne_invalide' }])
		expect(b.appelsModele).toHaveLength(0)
	})

	it('verrou refusé : 404 si la suggestion est illisible, 409 si elle est figée, 409 si une génération est en vol', async () => {
		expect((await revoir(banc({ verrou: null, lue: null }))).status).toBe(404)
		const figee = await revoir(banc({ verrou: null, lue: { ...SUGGESTION, statut: 'abandonnee' } }))
		expect([figee.status, await figee.json()]).toEqual([409, { erreur: 'suggestion_figee' }])
		const occupee = await revoir(banc({ verrou: null, lue: SUGGESTION }))
		expect([occupee.status, await occupee.json()]).toEqual([409, { erreur: 'generation_en_cours' }])
	})

	it('identifiant invalide : 404 sans toucher la base ; consigne vide : 400', async () => {
		const b = banc()
		expect((await appel(b, 'POST', 'ia/suggestions/pas-un-uuid/revue', { consigne: 'x' })).status).toBe(404)
		expect((await revoir(b, '')).status).toBe(400)
		expect(b.appelsModele).toHaveLength(0)
	})
})

describe('T3.b — faire évoluer un workflow existant (docs/SPEC-ia.md §13.5)', () => {
	const modifier = (b: Banc, portee = 'etapes', jeton?: string | null) =>
		creer(b, { workspace_id: ESPACE, portee, workflow_id: WF, demande: DEMANDE }, jeton)

	it.each(['etapes', 'transitions', 'champs'])('portée « %s » avec un workflow : 202, la suggestion naît sur ce workflow', async (portee) => {
		const b = banc({ creee: { ...MODIFICATION, portee } })
		const reponse = await modifier(b, portee)
		expect(reponse.status).toBe(202)
		expect((await lignes(reponse)).at(-1)).toEqual({ issue: 'revision', defauts: 0 })
		expect(b.champsCreation[0]).toEqual({ workspace_id: ESPACE, portee, demande: DEMANDE, workflow_id: WF })
		expect(b.schemas).toEqual([SCHEMA_MODIFICATION])
	})

	it('la composition est lue AVANT la création, puis l’occupation — toutes deux avec le jeton de l’appelant', async () => {
		const b = banc({ creee: MODIFICATION })
		await lignes(await modifier(b))
		expect(b.ordre).toEqual([`composition:${WF}:jeton-de-l-appelant`, 'creation', `occupation:${WF}:jeton-de-l-appelant`])
	})

	it('le modèle reçoit les règles de modification, le workflow vivant, l’occupation, la portée — puis la demande', async () => {
		const b = banc({ creee: MODIFICATION })
		await lignes(await modifier(b))
		const [systeme, contexte, demande] = b.appelsModele[0] ?? []
		expect(systeme?.content).toContain('Tu fais évoluer un workflow EXISTANT')
		expect(systeme?.content).toContain('relance — Relance (open)')
		expect(contexte?.content).toContain(JSON.stringify(VIVANTE))
		expect(contexte?.content).toContain('{"prospection":11,"relance":9}')
		expect(contexte?.content).toContain('Ne fais évoluer que les étapes')
		expect(demande).toEqual({ role: 'user', content: DEMANDE })
	})

	it.each([
		['transitions', 'Ne fais évoluer que les transitions'],
		['champs', 'Ne fais évoluer que les champs'],
	])('la portée « %s » oriente le modèle par sa phrase', async (portee, phrase) => {
		const b = banc({ creee: { ...MODIFICATION, portee } })
		await lignes(await modifier(b, portee))
		expect(b.appelsModele[0]?.[1]?.content).toContain(phrase)
	})

	it('un workflow ILLISIBLE : 404 workflow_introuvable, aucune suggestion créée, le modèle jamais appelé', async () => {
		const b = banc({ composition: null })
		const reponse = await modifier(b)
		expect([reponse.status, await reponse.json()]).toEqual([404, { erreur: 'workflow_introuvable' }])
		expect(b.creations).toBe(0)
		expect(b.appelsModele).toHaveLength(0)
	})

	it('le REFUS DE LA BASE (non-administrateur) rend 403 : ni occupation lue, ni modèle appelé', async () => {
		const b = banc({ creation: 403 })
		expect((await modifier(b)).status).toBe(403)
		expect(b.ordre).toEqual([`composition:${WF}:jeton-de-l-appelant`, 'creation'])
		expect(b.appelsModele).toHaveLength(0)
	})

	it('sans clé : 503 AVANT toute lecture de la base', async () => {
		const b = banc({ cle: null })
		expect((await modifier(b)).status).toBe(503)
		expect(b.ordre).toEqual([])
	})

	it('une REVUE d’une modification relit le workflow vivant et l’envoie avant la dernière révision', async () => {
		const corrigee = { ...VIVANTE, remappages: [{ de: 'relance', vers: 'prospection' }] }
		const b = banc({ verrou: MODIFICATION, derniere: { proposition: corrigee, defauts: [] } })
		await lignes(await revoir(b, 'Garde la relance'))
		expect(b.ordre).toEqual([`composition:${WF}:jeton-de-l-appelant`, `occupation:${WF}:jeton-de-l-appelant`])
		const messages = b.appelsModele[0] ?? []
		expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'user', 'user'])
		expect(messages[1]?.content).toContain('Le workflow actuel (JSON) :')
		expect(messages[3]?.content).toContain('"remappages":[{"de":"relance","vers":"prospection"}]')
		expect(messages[3]?.content).toContain('Garde la relance')
		expect(b.schemas).toEqual([SCHEMA_MODIFICATION])
	})

	it('la reprise sans consigne d’une modification sans révision rejoue la demande, avec le workflow vivant', async () => {
		const b = banc({ verrou: MODIFICATION })
		await lignes(await appel(b, 'POST', `ia/suggestions/${ID}/revue`, {}))
		expect(b.appelsModele[0]?.[1]?.content).toContain('Le workflow actuel (JSON) :')
		expect(b.appelsModele[0]?.[2]).toEqual({ role: 'user', content: DEMANDE })
	})

	it('une revue dont le workflow est devenu illisible — supprimé, la suggestion avec lui — rend 404', async () => {
		const b = banc({ verrou: MODIFICATION, composition: null })
		const reponse = await revoir(b)
		expect([reponse.status, await reponse.json()]).toEqual([404, { erreur: 'suggestion_introuvable' }])
		expect(b.appelsModele).toHaveLength(0)
	})

	it('une suggestion `workflow` AVEC une cible (écrite hors de la fonction) : le contexte part, sans phrase de portée', async () => {
		const b = banc({ verrou: { ...MODIFICATION, portee: 'workflow' }, derniere: { proposition: VIVANTE, defauts: [] } })
		await lignes(await revoir(b))
		const contexte = b.appelsModele[0]?.[1]?.content ?? ''
		expect(contexte).toContain('Le workflow actuel (JSON) :')
		expect(contexte).not.toContain('Ne fais évoluer que')
	})

	it('le journal porte la portée, jamais la composition ni la demande', async () => {
		const b = banc({ creee: MODIFICATION })
		await lignes(await modifier(b))
		const journal = b.journal.join('\n')
		expect(journal).toContain('"portee":"etapes"')
		expect(journal).not.toContain('Budget témoin')
		expect(journal).not.toContain('confidentiel')
	})
})
