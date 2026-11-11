// @spec CRM-112 (docs/BACKLOG.md) — tranche T2.d.1 : les champs communs non archivés de l'espace, lus sous la RLS de
//       l'appelant et envoyés au modèle avec le catalogue (docs/SPEC-ia.md §6.1, décision 825)
// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : la fonction edge `ia`
// @spec docs/SPEC-ia.md §4 (architecture, concurrence, mode dégradé), §11.1 (la génération vit dans sa
//       requête : flux NDJSON, battement, issue en base — `oneshot` retire le worker après sa réponse),
//       §11.2 (qui écrit quoi), §11.3 (les routes et leurs réponses), §11.4 (verrou de 180 s, échec) ;
//       docs/JOURNAL.md décision 617
// @spec CRM-097 tranche T2.b — docs/SPEC-ia.md §12.1 (les défauts relus en base, jamais calculés ici), §12.6
//       (issue `sans_suite` ; revue sans consigne d'une suggestion sans révision ; défauts transmis à la revue) ;
//       docs/JOURNAL.md décision 618
// @spec CRM-097 tranche T3.b — docs/SPEC-ia.md §13.5 (les trois portées d'une modification, la composition
//       vivante relue avec le jeton de l'appelant AVANT la création, l'occupation et la portée au modèle, le
//       schéma d'une modification) ; docs/JOURNAL.md décision 620
// @spec CLAUDE.md §10 (le refus d'un non-administrateur vient de la base), §20 (journaux sans contenu)
// @spec CRM-141 (docs/BACKLOG.md) — tranche T2 : la route `POST /ia/pastilles/evaluer`, appelée par `pg_cron` avec le
//       secret que la base fait vérifier ; la passe bornée à 100 s, une évaluation à la fois, arrêtée au premier échec ;
//       le mode dégradé sans rien prendre (docs/SPEC-ia.md §15.4 ; docs/SPEC-mail-subsystem.md §31.5)
//
// Gestionnaire pur : la base, le modèle, l'horloge et le battement sont injectés. La base autorise
// l'appelant avec son propre jeton AVANT tout appel au modèle ; la génération se mène ensuite dans le flux
// de la réponse, et son issue s'écrit avec la clé de service, bornée à la suggestion autorisée.

import { cibleDe, type Cible, type ConfigurationIa } from './configuration.ts'
import {
	messagesDePremiereGeneration,
	messagesDeRevue,
	PORTEES_DE_MODIFICATION,
	type ContexteDeModification,
	type ChampCommun,
	type NoeudDuCatalogue,
	type PorteeDeModification,
} from './consignes.ts'
import type { EchecGeneration, Etat, Generation, Message } from './ollama.ts'
import { BUDGET_PASSE_MS, controlerSortie, demandeDePastilles, type MessageAEvaluer } from './pastilles.ts'
import { mettreEnForme, SCHEMA_MODIFICATION, SCHEMA_WORKFLOW, type Defaut, type Proposition } from './proposition.ts'

export const LONGUEUR_MAX = 4_000
/** Un verrou plus ancien est périmé : la fonction qui l'avait posé a disparu (docs/SPEC-ia.md §11.4). */
export const VERROU_PERIME_MS = 180_000

export type Suggestion = {
	readonly id: string
	readonly workspace_id: string
	/** Le workflow qu'elle fait évoluer ; `null` pour une création. */
	readonly workflow_id: string | null
	readonly portee: string
	readonly statut: string
	readonly demande: string
	readonly generation_depuis: string | null
	readonly created_by: string | null
}

export type ResultatCreation =
	| { readonly ok: true; readonly suggestion: Suggestion }
	| { readonly ok: false; readonly statut: 400 | 403 }

export type RevisionDuModele = {
	readonly suggestion_id: string
	readonly consigne: string
	readonly proposition: Proposition
	readonly modele: string
	readonly jetons_entree: number
	readonly jetons_sortie: number
	readonly duree_ms: number
	readonly created_by: string | null
}

export type DependancesIa = {
	readonly configuration: ConfigurationIa
	/** Avec le jeton de l'appelant : la RLS décide. */
	creerSuggestion(
		jeton: string,
		champs: { workspace_id: string; portee: string; demande: string; workflow_id?: string },
	): Promise<ResultatCreation>
	verrouiller(jeton: string, id: string, avantLe: string): Promise<Suggestion | null>
	lireSuggestion(jeton: string, id: string): Promise<Suggestion | null>
	/** La dernière révision lisible, et les défauts que la base y a écrits. */
	lireDerniereRevision(jeton: string, id: string): Promise<{ readonly proposition: unknown; readonly defauts: Defaut[] } | null>
	lireCatalogue(jeton: string, workspaceId: string): Promise<NoeudDuCatalogue[]>
	/** Avec le jeton de l'appelant : les champs communs NON archivés de l'espace (`CRM-112` T2.d.1, décision 825). */
	lireChampsCommuns(jeton: string, workspaceId: string): Promise<ChampCommun[]>
	/** Avec le jeton de l'appelant : la composition vivante au format d'une proposition, `null` si illisible. */
	lireComposition(jeton: string, workflowId: string): Promise<unknown | null>
	/** Avec le jeton de l'appelant : le nombre d'affaires par clé d'étape. */
	lireOccupation(jeton: string, workflowId: string): Promise<Record<string, number>>
	/**
	 * Avec la clé de service, sur la suggestion déjà autorisée. Rend le nombre de défauts que la BASE a écrits
	 * (docs/SPEC-ia.md §12.1), ou `ecrite: false` si elle a refusé la révision — suggestion décidée entre-temps.
	 */
	ecrireRevision(revision: RevisionDuModele): Promise<{ readonly ecrite: true; readonly defauts: number } | { readonly ecrite: false }>
	ecrireEchec(id: string, echec: EchecGeneration): Promise<void>
	lireEtat(cible: Cible | null, modele: string): Promise<Etat>
	generer(cible: Cible, messages: readonly Message[], schema: unknown): Promise<Generation>
	/** Intervalle du battement qui tient la connexion ouverte (docs/SPEC-ia.md §11.1). */
	readonly battementMs: number
	maintenantMs(): number
	journaliser(evenement: Record<string, unknown>): void
	/** `CRM-141` T2 — la base dit si le secret d'appel de la passe est le bon (`verify_label_dispatch`). */
	verifierDispatch(secret: string): Promise<boolean>
	/** Prend une évaluation due, sous la clé de service (`claim_label_evaluations`), ou `null` s'il n'y en a pas. */
	prendreEvaluation(): Promise<MessageAEvaluer | null>
	/** Clôt une évaluation : les pastilles rendues, ou l'échec nommé (`record_label_evaluation`). */
	cloreEvaluation(messageId: string, ids: readonly string[] | null, echec: EchecGeneration | null): Promise<void>
	/** Une génération bornée à 30 s, à température 0 (docs/SPEC-ia.md §15.2). */
	genererPastilles(cible: Cible, messages: readonly Message[], schema: unknown): Promise<Generation>
}

/** L'en-tête qui porte le secret d'appel de la passe des pastilles (`CRM-141` T2). */
export const EN_TETE_DISPATCH_PASTILLES = 'x-pastilles-dispatch'

/** Ce que rend une passe : des comptes, jamais un contenu (docs/SPEC-ia.md §15.4). */
export type BilanPasse = {
	readonly evalues: number
	readonly echecs: number
	readonly rejetees: number
	readonly raison?: string
}

/**
 * La passe des pastilles — `CRM-141` T2, docs/SPEC-ia.md §15.4. Rien n'est pris quand l'assistant est indisponible : les
 * messages restent en attente. Sinon, une évaluation à la fois, tant que le budget de 100 s n'est pas épuisé ; un échec
 * s'écrit sur son message et ARRÊTE la passe — l'espacement de la base reprend la main. Aucune nouvelle tentative ici.
 */
export async function passePastilles(d: DependancesIa, cible: Cible | null): Promise<BilanPasse> {
	if (cible === null) {
		d.journaliser({ evenement: 'passe_pastilles', raison: 'cle_absente' })
		return { evalues: 0, echecs: 0, rejetees: 0, raison: 'cle_absente' }
	}
	const etat = await d.lireEtat(cible, d.configuration.modele)
	if (!etat.disponible) {
		d.journaliser({ evenement: 'passe_pastilles', raison: etat.raison, simulee: cible.simulee })
		return { evalues: 0, echecs: 0, rejetees: 0, raison: etat.raison }
	}
	const debut = d.maintenantMs()
	let evalues = 0
	let echecs = 0
	let rejetees = 0
	while (d.maintenantMs() - debut < BUDGET_PASSE_MS) {
		const message = await d.prendreEvaluation()
		if (message === null) break
		// Un espace sans pastille active : rien à demander au modèle, le mail n'en porte aucune.
		if (message.labels.length === 0) {
			await d.cloreEvaluation(message.message_id, [], null)
			evalues += 1
			continue
		}
		const demande = demandeDePastilles(message)
		const generation = await d.genererPastilles(cible, demande.messages, demande.schema)
		const sortie = generation.ok ? controlerSortie(generation.contenu, demande.cles) : null
		if (sortie === null) {
			await d.cloreEvaluation(message.message_id, null, generation.ok ? 'reponse_invalide' : generation.echec)
			echecs += 1
			break
		}
		await d.cloreEvaluation(message.message_id, sortie.ids, null)
		evalues += 1
		rejetees += sortie.rejetees
	}
	d.journaliser({
		evenement: 'passe_pastilles',
		evalues,
		echecs,
		cles_rejetees: rejetees,
		duree_ms: Math.max(0, d.maintenantMs() - debut),
		simulee: cible.simulee,
	})
	return { evalues, echecs, rejetees }
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }
const repondre = (statut: number, corps: unknown, entetes: Record<string, string> = {}) =>
	new Response(JSON.stringify(corps), { status: statut, headers: { ...JSON_HEADERS, ...entetes } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function jetonDe(requete: Request): string | null {
	const entete = requete.headers.get('authorization') ?? ''
	const jeton = /^Bearer\s+(.+)$/i.exec(entete)?.[1]?.trim()
	return jeton && jeton !== '' ? jeton : null
}

async function lireCorps(requete: Request): Promise<Record<string, unknown> | null> {
	try {
		const corps: unknown = await requete.json()
		return typeof corps === 'object' && corps !== null && !Array.isArray(corps) ? (corps as Record<string, unknown>) : null
	} catch {
		return null
	}
}

const texteBorne = (valeur: unknown): string | null =>
	typeof valeur === 'string' && valeur.trim() !== '' && valeur.length <= LONGUEUR_MAX ? valeur : null

/** La dernière ligne du flux : l'issue, écrite aussi en base. `sans_suite` : la base a refusé la révision. */
export type Issue =
	| { readonly issue: 'revision'; readonly defauts: number }
	| { readonly issue: 'echec'; readonly echec: EchecGeneration }
	| { readonly issue: 'sans_suite' }

/**
 * La génération proprement dite. Son issue s'écrit en base — une révision du modèle, ou un échec nommé —,
 * le verrou est levé dans les deux cas, et elle est rendue au flux.
 */
async function generation(
	d: DependancesIa,
	cible: Cible,
	suggestion: Suggestion,
	consigne: string,
	messages: readonly Message[],
): Promise<Issue> {
	const issue = await d.generer(cible, messages, suggestion.workflow_id === null ? SCHEMA_WORKFLOW : SCHEMA_MODIFICATION)
	if (!issue.ok) {
		await d.ecrireEchec(suggestion.id, issue.echec)
		d.journaliser({ evenement: 'generation_echouee', code: issue.echec, simulee: cible.simulee })
		return { issue: 'echec', echec: issue.echec }
	}
	const controle = mettreEnForme(issue.contenu)
	if (!controle.ok) {
		await d.ecrireEchec(suggestion.id, 'reponse_invalide')
		d.journaliser({ evenement: 'generation_echouee', code: 'reponse_invalide', simulee: cible.simulee })
		return { issue: 'echec', echec: 'reponse_invalide' }
	}
	const ecrite = await d.ecrireRevision({
		suggestion_id: suggestion.id,
		consigne,
		proposition: controle.proposition,
		modele: d.configuration.modele,
		jetons_entree: issue.jetonsEntree,
		jetons_sortie: issue.jetonsSortie,
		duree_ms: issue.dureeMs,
		created_by: suggestion.created_by,
	})
	d.journaliser({
		evenement: ecrite.ecrite ? 'generation_ecrite' : 'generation_sans_suite',
		duree_ms: issue.dureeMs,
		jetons_entree: issue.jetonsEntree,
		jetons_sortie: issue.jetonsSortie,
		...(ecrite.ecrite ? { defauts: ecrite.defauts } : {}),
		simulee: cible.simulee,
	})
	return ecrite.ecrite ? { issue: 'revision', defauts: ecrite.defauts } : { issue: 'sans_suite' }
}

/**
 * Le flux NDJSON de la réponse (docs/SPEC-ia.md §11.1) : la première ligne part aussitôt, un battement
 * tient la connexion ouverte sous le délai de lecture de Kong, la dernière ligne porte l'issue.
 */
function flux(d: DependancesIa, premiere: Record<string, unknown>, travail: () => Promise<Issue>): Response {
	const encodeur = new TextEncoder()
	const corps = new ReadableStream<Uint8Array>({
		start(controleur) {
			const ecrire = (ligne: unknown) => {
				try {
					controleur.enqueue(encodeur.encode(`${JSON.stringify(ligne)}\n`))
				} catch {
					// Le client est parti : la génération se poursuit tant que le worker vit.
				}
			}
			ecrire(premiere)
			const battement = setInterval(() => ecrire({ attente: true }), d.battementMs)
			return travail()
				.then((issue) => ecrire(issue))
				.finally(() => {
					clearInterval(battement)
					try {
						controleur.close()
					} catch {
						// déjà fermé par le départ du client
					}
				})
		},
	})
	return new Response(corps, {
		status: 202,
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
	})
}

async function mener(
	d: DependancesIa,
	jeton: string,
	cible: Cible,
	suggestion: Suggestion,
	consigne: string,
	messagesSelon: (catalogue: readonly NoeudDuCatalogue[], champsCommuns: readonly ChampCommun[]) => readonly Message[],
): Promise<Response> {
	const catalogue = await d.lireCatalogue(jeton, suggestion.workspace_id)
	const champsCommuns = await d.lireChampsCommuns(jeton, suggestion.workspace_id)
	return flux(d, { suggestion_id: suggestion.id }, () =>
		generation(d, cible, suggestion, consigne, messagesSelon(catalogue, champsCommuns)).catch(async () => {
			await d.ecrireEchec(suggestion.id, 'serveur_injoignable')
			d.journaliser({ evenement: 'generation_echouee', code: 'erreur_interne' })
			return { issue: 'echec', echec: 'serveur_injoignable' } as const
		}),
	)
}

const estPorteeDeModification = (valeur: unknown): valeur is PorteeDeModification =>
	(PORTEES_DE_MODIFICATION as readonly unknown[]).includes(valeur)

/** Le contexte d'une modification : la composition déjà lue, l'occupation, la portée de la suggestion. */
async function contexteDe(
	d: DependancesIa,
	jeton: string,
	suggestion: Suggestion,
	composition: unknown,
): Promise<ContexteDeModification> {
	return {
		portee: suggestion.portee,
		composition,
		occupation: await d.lireOccupation(jeton, suggestion.workflow_id as string),
	}
}

export async function traiterIa(requete: Request, d: DependancesIa): Promise<Response> {
	const chemin = new URL(requete.url).pathname.split('/').filter(Boolean)
	// Le routeur principal transmet `/ia/…` : le premier segment est le nom de la fonction.
	const [, route, id, action] = chemin
	const cible = cibleDe(d.configuration, requete.headers)

	// `CRM-141` T2 : la passe des pastilles. Aucun navigateur ne l'appelle : `pg_cron`, sur le réseau interne, avec le
	// secret d'appel que la base vérifie (docs/SPEC-ia.md §15.4).
	if (route === 'pastilles' && id === 'evaluer' && chemin.length === 3) {
		if (requete.method !== 'POST') return repondre(405, { erreur: 'methode_refusee' }, { allow: 'POST' })
		const secret = requete.headers.get(EN_TETE_DISPATCH_PASTILLES)?.trim() ?? ''
		if (secret === '' || !(await d.verifierDispatch(secret))) return repondre(401, { erreur: 'dispatch_refuse' })
		return repondre(200, await passePastilles(d, cible))
	}

	if (route === 'etat' && id === undefined) {
		if (requete.method !== 'GET') return repondre(405, { erreur: 'methode_refusee' }, { allow: 'GET' })
		const etat = await d.lireEtat(cible, d.configuration.modele)
		return repondre(200, etat)
	}

	if (route === 'suggestions' && id === undefined) {
		if (requete.method !== 'POST') return repondre(405, { erreur: 'methode_refusee' }, { allow: 'POST' })
		const jeton = jetonDe(requete)
		if (jeton === null) return repondre(401, { erreur: 'session_requise' })
		const corps = await lireCorps(requete)
		const demande = texteBorne(corps?.demande)
		const espace = typeof corps?.workspace_id === 'string' && UUID.test(corps.workspace_id) ? corps.workspace_id : null
		if (demande === null || espace === null) return repondre(400, { erreur: 'demande_invalide' })
		// Créer : la portée `workflow`, sans cible. Modifier : une des trois portées, avec un workflow (§13.5).
		const portee = corps?.portee
		const workflowId = typeof corps?.workflow_id === 'string' && UUID.test(corps.workflow_id) ? corps.workflow_id : null
		const creer = portee === 'workflow' && (corps?.workflow_id === undefined || corps.workflow_id === null)
		const modifier = estPorteeDeModification(portee) && workflowId !== null
		if (!creer && !modifier) return repondre(400, { erreur: 'demande_invalide' })
		if (cible === null) return repondre(503, { erreur: 'assistant_indisponible', raison: 'cle_absente' })
		// La composition vivante est lue AVANT la création : un workflow illisible n'ouvre aucune suggestion.
		const composition = modifier ? await d.lireComposition(jeton, workflowId) : null
		if (modifier && composition === null) return repondre(404, { erreur: 'workflow_introuvable' })
		const creation = await d.creerSuggestion(jeton, {
			workspace_id: espace,
			portee: portee as string,
			demande,
			...(modifier ? { workflow_id: workflowId } : {}),
		})
		if (!creation.ok) {
			return creation.statut === 403 ? repondre(403, { erreur: 'refuse' }) : repondre(400, { erreur: 'demande_invalide' })
		}
		const contexte = modifier ? await contexteDe(d, jeton, creation.suggestion, composition) : null
		d.journaliser({ evenement: 'generation_lancee', route: 'suggestions', portee, simulee: cible.simulee })
		return await mener(d, jeton, cible, creation.suggestion, demande, (catalogue, champsCommuns) =>
			messagesDePremiereGeneration(demande, catalogue, contexte, champsCommuns),
		)
	}

	if (route === 'suggestions' && id !== undefined && action === 'revue' && chemin.length === 4) {
		if (requete.method !== 'POST') return repondre(405, { erreur: 'methode_refusee' }, { allow: 'POST' })
		if (!UUID.test(id)) return repondre(404, { erreur: 'suggestion_introuvable' })
		const jeton = jetonDe(requete)
		if (jeton === null) return repondre(401, { erreur: 'session_requise' })
		const corps = await lireCorps(requete)
		const consigne = texteBorne(corps?.consigne)
		// Sans consigne, la seule revue permise est la reprise d'une première génération échouée : la suggestion
		// n'a alors aucune révision, et c'est sa demande qui est rejouée (docs/SPEC-ia.md §12.6). Une consigne
		// présente mais vide ou trop longue reste un refus.
		if (consigne === null && corps?.consigne !== undefined) return repondre(400, { erreur: 'consigne_invalide' })
		if (cible === null) return repondre(503, { erreur: 'assistant_indisponible', raison: 'cle_absente' })
		if (consigne === null && (await d.lireDerniereRevision(jeton, id)) !== null) {
			return repondre(400, { erreur: 'consigne_invalide' })
		}

		const perime = new Date(d.maintenantMs() - VERROU_PERIME_MS).toISOString()
		const verrouillee = await d.verrouiller(jeton, id, perime)
		if (verrouillee === null) {
			// Pourquoi le verrou n'a pas été posé : relu avec le même jeton, sans rien révéler de plus.
			const lue = await d.lireSuggestion(jeton, id)
			if (lue === null) return repondre(404, { erreur: 'suggestion_introuvable' })
			if (lue.statut !== 'en_revue') return repondre(409, { erreur: 'suggestion_figee' })
			return repondre(409, { erreur: 'generation_en_cours' })
		}
		const derniere = await d.lireDerniereRevision(jeton, id)
		// Une modification : le workflow vivant est RELU au moment de la revue. Illisible alors que la suggestion
		// vient d'être verrouillée par un administrateur, il a été supprimé — et la suggestion avec lui (cascade).
		let contexte: ContexteDeModification | null = null
		if (verrouillee.workflow_id !== null) {
			const composition = await d.lireComposition(jeton, verrouillee.workflow_id)
			if (composition === null) return repondre(404, { erreur: 'suggestion_introuvable' })
			contexte = await contexteDe(d, jeton, verrouillee, composition)
		}
		d.journaliser({ evenement: 'generation_lancee', route: 'revue', portee: verrouillee.portee, simulee: cible.simulee })
		return await mener(d, jeton, cible, verrouillee, consigne ?? verrouillee.demande, (catalogue, champsCommuns) =>
			derniere === null
				? messagesDePremiereGeneration(
						consigne === null ? verrouillee.demande : `${verrouillee.demande}\n\n${consigne}`,
						catalogue,
						contexte,
						champsCommuns,
					)
				: messagesDeRevue(verrouillee.demande, derniere.proposition, derniere.defauts, consigne ?? '', catalogue, contexte, champsCommuns),
		)
	}

	return repondre(404, { erreur: 'route_inconnue' })
}
