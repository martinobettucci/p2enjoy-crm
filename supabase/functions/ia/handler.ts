// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : la fonction edge `ia`
// @spec docs/SPEC-ia.md §4 (architecture, concurrence, mode dégradé), §11.1 (la génération vit dans sa
//       requête : flux NDJSON, battement, issue en base — `oneshot` retire le worker après sa réponse),
//       §11.2 (qui écrit quoi), §11.3 (les routes et leurs réponses), §11.4 (verrou de 180 s, échec) ;
//       docs/JOURNAL.md décision 617
// @spec CRM-097 tranche T2.b — docs/SPEC-ia.md §12.1 (les défauts relus en base, jamais calculés ici), §12.6
//       (issue `sans_suite` ; revue sans consigne d'une suggestion sans révision ; défauts transmis à la revue) ;
//       docs/JOURNAL.md décision 618
// @spec CLAUDE.md §10 (le refus d'un non-administrateur vient de la base), §20 (journaux sans contenu)
//
// Gestionnaire pur : la base, le modèle, l'horloge et le battement sont injectés. La base autorise
// l'appelant avec son propre jeton AVANT tout appel au modèle ; la génération se mène ensuite dans le flux
// de la réponse, et son issue s'écrit avec la clé de service, bornée à la suggestion autorisée.

import { cibleDe, type Cible, type ConfigurationIa } from './configuration.ts'
import { messagesDeCreation, messagesDeRevue, type NoeudDuCatalogue } from './consignes.ts'
import type { EchecGeneration, Etat, Generation, Message } from './ollama.ts'
import { mettreEnForme, SCHEMA_WORKFLOW, type Defaut, type Proposition } from './proposition.ts'

export const LONGUEUR_MAX = 4_000
/** Un verrou plus ancien est périmé : la fonction qui l'avait posé a disparu (docs/SPEC-ia.md §11.4). */
export const VERROU_PERIME_MS = 180_000

export type Suggestion = {
	readonly id: string
	readonly workspace_id: string
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
	creerSuggestion(jeton: string, champs: { workspace_id: string; portee: string; demande: string }): Promise<ResultatCreation>
	verrouiller(jeton: string, id: string, avantLe: string): Promise<Suggestion | null>
	lireSuggestion(jeton: string, id: string): Promise<Suggestion | null>
	/** La dernière révision lisible, et les défauts que la base y a écrits. */
	lireDerniereRevision(jeton: string, id: string): Promise<{ readonly proposition: unknown; readonly defauts: Defaut[] } | null>
	lireCatalogue(jeton: string, workspaceId: string): Promise<NoeudDuCatalogue[]>
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
	const issue = await d.generer(cible, messages, SCHEMA_WORKFLOW)
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
	messagesSelon: (catalogue: readonly NoeudDuCatalogue[]) => readonly Message[],
): Promise<Response> {
	const catalogue = await d.lireCatalogue(jeton, suggestion.workspace_id)
	return flux(d, { suggestion_id: suggestion.id }, () =>
		generation(d, cible, suggestion, consigne, messagesSelon(catalogue)).catch(async () => {
			await d.ecrireEchec(suggestion.id, 'serveur_injoignable')
			d.journaliser({ evenement: 'generation_echouee', code: 'erreur_interne' })
			return { issue: 'echec', echec: 'serveur_injoignable' } as const
		}),
	)
}

export async function traiterIa(requete: Request, d: DependancesIa): Promise<Response> {
	const chemin = new URL(requete.url).pathname.split('/').filter(Boolean)
	// Le routeur principal transmet `/ia/…` : le premier segment est le nom de la fonction.
	const [, route, id, action] = chemin
	const cible = cibleDe(d.configuration, requete.headers)

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
		// T1 livre la génération d'un workflow complet ; les portées ciblées viennent avec T3.
		if (corps?.portee !== 'workflow') return repondre(400, { erreur: 'portee_non_livree' })
		if (cible === null) return repondre(503, { erreur: 'assistant_indisponible', raison: 'cle_absente' })
		const creation = await d.creerSuggestion(jeton, { workspace_id: espace, portee: 'workflow', demande })
		if (!creation.ok) {
			return creation.statut === 403 ? repondre(403, { erreur: 'refuse' }) : repondre(400, { erreur: 'demande_invalide' })
		}
		d.journaliser({ evenement: 'generation_lancee', route: 'suggestions', simulee: cible.simulee })
		return await mener(d, jeton, cible, creation.suggestion, demande, (catalogue) => messagesDeCreation(demande, catalogue))
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
		d.journaliser({ evenement: 'generation_lancee', route: 'revue', simulee: cible.simulee })
		return await mener(d, jeton, cible, verrouillee, consigne ?? verrouillee.demande, (catalogue) =>
			derniere === null
				? messagesDeCreation(consigne === null ? verrouillee.demande : `${verrouillee.demande}\n\n${consigne}`, catalogue)
				: messagesDeRevue(verrouillee.demande, derniere.proposition, derniere.defauts, consigne ?? '', catalogue),
		)
	}

	return repondre(404, { erreur: 'route_inconnue' })
}
