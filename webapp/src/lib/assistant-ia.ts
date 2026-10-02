// @spec CRM-097 (docs/BACKLOG.md) — tranche T2.c : ce que l'écran de l'assistant IA lit, envoie et refuse
// @spec docs/SPEC-ia.md §11.1 (le flux NDJSON : l'identifiant d'abord, un battement, l'issue en dernier), §11.3 et
//       §12.6 (les routes de la fonction `ia` et leurs réponses), §12.2 (corriger par PostgREST), §12.3 (accepter
//       par la RPC et ses refus), §12.4 (abandonner), §12.5 (l'écran), §12.7 (les refus traduits)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone : une panne n'est jamais un succès) ; CLAUDE.md §10
//
// Ce module ne rend rien : il appelle et CLASSE. Les refus sont classés ici, à un seul endroit, et l'écran les
// traduit. Aucune règle n'y vit : qui peut demander, corriger, accepter ou abandonner, la base en décide ; un
// non-administrateur reçoit son refus réel, jamais une commande éteinte d'avance.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { PropositionIa } from './brouillon-ia'
import { normaliser } from './brouillon-ia'
import type { Database } from './database.types'
import { cleAnonymeCrm, porteurJeton, urlApiCrm, type ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Les données
// ---------------------------------------------------------------------------------------------

/** Un défaut tel que la base l'écrit (docs/SPEC-ia.md §12.1). */
export type DefautIa = { readonly code: string; readonly chemin: string; readonly valeurs: Readonly<Record<string, unknown>> }

export type EchecGeneration = 'delai_depasse' | 'serveur_injoignable' | 'cle_refusee' | 'reponse_invalide'

export type SuggestionEnRevue = {
	readonly id: string
	readonly demande: string
	readonly created_at: string
	readonly generation_depuis: string | null
	readonly derniere_erreur: EchecGeneration | null
}

export type SuggestionIa = SuggestionEnRevue & {
	readonly statut: 'en_revue' | 'acceptee' | 'abandonnee'
	readonly workflow_cree_id: string | null
}

export type RevisionIa = {
	readonly id: string
	readonly numero: number
	readonly origine: 'ia' | 'correction'
	readonly consigne: string | null
	readonly proposition: PropositionIa
	readonly defauts: readonly DefautIa[]
	readonly modele: string | null
	readonly created_at: string
}

/** Une suggestion et ses révisions, la plus récente d'abord. */
export type SuggestionLue = { readonly suggestion: SuggestionIa; readonly revisions: readonly RevisionIa[] }

export const COLONNES_SUGGESTION = 'id, demande, statut, created_at, generation_depuis, derniere_erreur, workflow_cree_id'
export const COLONNES_REVISION = 'id, numero, origine, consigne, proposition, defauts, modele, created_at'

/** Un verrou de génération plus ancien est périmé : la fonction qui l'avait posé a disparu (§11.4). */
export const VERROU_PERIME_MS = 180_000

/** Une génération est en vol si son verrou est posé et frais. */
export function generationEnVol(suggestion: Pick<SuggestionEnRevue, 'generation_depuis'>, maintenantMs: number): boolean {
	if (suggestion.generation_depuis === null) return false
	const depuis = Date.parse(suggestion.generation_depuis)
	return Number.isFinite(depuis) && maintenantMs - depuis < VERROU_PERIME_MS
}

// ---------------------------------------------------------------------------------------------
// Les lectures, sous la RLS : un non-administrateur ne lit rien, et l'écran ne rend alors rien
// ---------------------------------------------------------------------------------------------

/** Les suggestions de création de workflow encore en revue, les plus récentes d'abord (§12.5). */
export async function lireSuggestionsEnRevue(client: ClientCrm): Promise<EtatAsync<readonly SuggestionEnRevue[]>> {
	try {
		const reponse = await client
			.from('suggestions_ia')
			.select('id, demande, created_at, generation_depuis, derniere_erreur')
			.eq('statut', 'en_revue')
			.eq('portee', 'workflow')
			.order('created_at', { ascending: false })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(reponse.data as readonly SuggestionEnRevue[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Une suggestion et son historique. `null` : elle n'est pas (ou plus) lisible. */
export async function lireSuggestion(client: ClientCrm, id: string): Promise<EtatAsync<SuggestionLue | null>> {
	try {
		const [suggestion, revisions] = await Promise.all([
			client.from('suggestions_ia').select(COLONNES_SUGGESTION).eq('id', id).maybeSingle(),
			client.from('suggestions_ia_revisions').select(COLONNES_REVISION).eq('suggestion_id', id).order('numero', { ascending: false }),
		])
		if (suggestion.error !== null) return enErreur(classerErreur(suggestion.status, suggestion.error.message))
		if (revisions.error !== null) return enErreur(classerErreur(revisions.status, revisions.error.message))
		if (suggestion.data === null) return pret(null)
		return pret({
			suggestion: suggestion.data as SuggestionIa,
			revisions: revisions.data as unknown as readonly RevisionIa[],
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// La fonction `ia` : l'état, et les deux générations, lues comme un flux
// ---------------------------------------------------------------------------------------------

/** Ce qu'il faut pour appeler la fonction sans `supabase-js` : son adresse, la clé anonyme, le jeton de session. */
export type AccesAssistant = {
	readonly url: string
	readonly cleAnonyme: string
	readonly jeton: () => string | null
	readonly requete?: (url: string, init?: RequestInit) => Promise<Response>
}

export const accesAssistantCrm: AccesAssistant | null =
	urlApiCrm === null || cleAnonymeCrm === null ? null : { url: urlApiCrm, cleAnonyme: cleAnonymeCrm, jeton: () => porteurJeton.lire() }

export type RaisonIndisponible = 'cle_absente' | 'serveur_injoignable' | 'cle_refusee' | 'modele_absent'
export type EtatAssistant = { readonly disponible: boolean; readonly raison?: RaisonIndisponible; readonly modele: string }

const enTetes = (acces: AccesAssistant): Record<string, string> => {
	const jeton = acces.jeton()
	return {
		apikey: acces.cleAnonyme,
		'content-type': 'application/json',
		...(jeton === null ? {} : { authorization: `Bearer ${jeton}` }),
	}
}
const appeler = (acces: AccesAssistant, chemin: string, init: RequestInit) =>
	(acces.requete ?? fetch)(`${acces.url.replace(/\/+$/, '')}/functions/v1/ia/${chemin}`, init)

/** L'état de l'assistant (`GET /ia/etat`) ; `null` si la fonction ne répond pas. */
export async function lireEtatAssistant(acces: AccesAssistant): Promise<EtatAssistant | null> {
	try {
		const reponse = await appeler(acces, 'etat', { headers: enTetes(acces) })
		if (!reponse.ok) return null
		const corps = (await reponse.json()) as Partial<EtatAssistant>
		return typeof corps.disponible === 'boolean' && typeof corps.modele === 'string' ? (corps as EtatAssistant) : null
	} catch {
		return null
	}
}

export type IssueFlux =
	| { readonly issue: 'revision'; readonly defauts: number }
	| { readonly issue: 'echec'; readonly echec: EchecGeneration }
	| { readonly issue: 'sans_suite' }

export type RefusGeneration =
	| 'demande_invalide'
	| 'consigne_invalide'
	| 'session'
	| 'refuse'
	| 'indisponible'
	| 'introuvable'
	| 'figee'
	| 'en_cours'
	| 'reseau'
	| 'inconnu'

/**
 * L'issue d'une génération. `fini` porte `issue: null` quand le flux s'est fermé sans la dire — connexion
 * coupée : l'écran relit alors la suggestion, seule source de vérité (§11.1).
 */
export type ResultatGeneration =
	| { readonly statut: 'fini'; readonly suggestionId: string; readonly issue: IssueFlux | null }
	| { readonly statut: 'refus'; readonly refus: RefusGeneration; readonly raison?: RaisonIndisponible }

/** Lit un flux NDJSON jusqu'au bout ; la première ligne porteuse d'un identifiant est signalée aussitôt. */
export async function lireFlux(
	reponse: Response,
	surIdentifiant: (id: string) => void,
): Promise<{ readonly suggestionId: string | null; readonly issue: IssueFlux | null }> {
	let suggestionId: string | null = null
	let issue: IssueFlux | null = null
	const traiter = (ligne: string) => {
		if (ligne.trim() === '') return
		let objet: Record<string, unknown>
		try {
			objet = JSON.parse(ligne) as Record<string, unknown>
		} catch {
			return
		}
		if (typeof objet.suggestion_id === 'string' && suggestionId === null) {
			suggestionId = objet.suggestion_id
			surIdentifiant(objet.suggestion_id)
		} else if (objet.issue === 'revision' && typeof objet.defauts === 'number') {
			issue = { issue: 'revision', defauts: objet.defauts }
		} else if (objet.issue === 'echec' && typeof objet.echec === 'string') {
			issue = { issue: 'echec', echec: objet.echec as EchecGeneration }
		} else if (objet.issue === 'sans_suite') {
			issue = { issue: 'sans_suite' }
		}
	}
	const lecteur = reponse.body?.getReader()
	if (lecteur === undefined) {
		;(await reponse.text()).split('\n').forEach(traiter)
		return { suggestionId, issue }
	}
	const decodeur = new TextDecoder()
	let reste = ''
	try {
		for (let morceau = await lecteur.read(); !morceau.done; morceau = await lecteur.read()) {
			reste += decodeur.decode(morceau.value, { stream: true })
			const lignes = reste.split('\n')
			reste = lignes.pop() ?? ''
			lignes.forEach(traiter)
		}
	} catch {
		// Le flux coupé en route : ce qui a été lu reste vrai, l'issue manquera et l'écran relira.
	}
	traiter(reste)
	return { suggestionId, issue }
}

async function refusDe(reponse: Response): Promise<{ refus: RefusGeneration; raison?: RaisonIndisponible }> {
	let corps: { erreur?: string; raison?: RaisonIndisponible } = {}
	try {
		corps = (await reponse.json()) as typeof corps
	} catch {
		// un corps illisible ne change pas le statut
	}
	switch (reponse.status) {
		case 400:
			return { refus: corps.erreur === 'consigne_invalide' ? 'consigne_invalide' : 'demande_invalide' }
		case 401:
			return { refus: 'session' }
		case 403:
			return { refus: 'refuse' }
		case 404:
			return { refus: 'introuvable' }
		case 409:
			return { refus: corps.erreur === 'suggestion_figee' ? 'figee' : 'en_cours' }
		case 503:
			return corps.raison === undefined ? { refus: 'indisponible' } : { refus: 'indisponible', raison: corps.raison }
		default:
			return { refus: 'inconnu' }
	}
}

async function generer(
	acces: AccesAssistant,
	chemin: string,
	corps: unknown,
	surIdentifiant: (id: string) => void,
	idConnu: string | null,
): Promise<ResultatGeneration> {
	let reponse: Response
	try {
		reponse = await appeler(acces, chemin, { method: 'POST', headers: enTetes(acces), body: JSON.stringify(corps) })
	} catch {
		return { statut: 'refus', refus: 'reseau' }
	}
	if (reponse.status !== 202) return { statut: 'refus', ...(await refusDe(reponse)) }
	const lu = await lireFlux(reponse, surIdentifiant)
	const suggestionId = lu.suggestionId ?? idConnu
	return suggestionId === null ? { statut: 'refus', refus: 'inconnu' } : { statut: 'fini', suggestionId, issue: lu.issue }
}

/** Crée une suggestion de workflow et mène sa première génération (`POST /ia/suggestions`). */
export function genererSuggestion(
	acces: AccesAssistant,
	idWorkspace: string,
	demande: string,
	surIdentifiant: (id: string) => void,
): Promise<ResultatGeneration> {
	return generer(acces, 'suggestions', { workspace_id: idWorkspace, portee: 'workflow', demande }, surIdentifiant, null)
}

/**
 * Revoit une suggestion (`POST /ia/suggestions/:id/revue`). Sans consigne, c'est la reprise d'une première
 * génération échouée : le corps ne porte alors pas de consigne du tout (§12.6).
 */
export function revoirSuggestion(acces: AccesAssistant, id: string, consigne: string | null): Promise<ResultatGeneration> {
	return generer(acces, `suggestions/${id}/revue`, consigne === null ? {} : { consigne }, () => {}, id)
}

// ---------------------------------------------------------------------------------------------
// Corriger, accepter, abandonner — par PostgREST, sous la RLS et les gestes de la base
// ---------------------------------------------------------------------------------------------

export type RefusCorrection = 'refuse' | 'introuvable' | 'figee' | 'en_cours' | 'mal_formee' | 'panne'
export type ResultatCorrection =
	| { readonly ok: true; readonly revision: RevisionIa }
	| { readonly ok: false; readonly refus: RefusCorrection }

/** Écrit une révision `correction` : la proposition entière ; la base en calcule les défauts (§12.2). */
export async function enregistrerCorrection(client: ClientCrm, id: string, proposition: PropositionIa): Promise<ResultatCorrection> {
	try {
		const reponse = await client
			.from('suggestions_ia_revisions')
			// `numero` et `workspace_id` sont écrits par le trigger, et le client n'a AUCUN privilège sur eux ; le
			// générateur les voit pourtant obligatoires (ce qui lui échappe, `database.types.test-d.ts`). Même
			// conversion que `administration-arborescence.ts` pour un `position` posé par la base.
			.insert({ suggestion_id: id, origine: 'correction', proposition: normaliser(proposition) } as unknown as Database['public']['Tables']['suggestions_ia_revisions']['Insert'])
			.select(COLONNES_REVISION)
			.single()
		if (reponse.error === null) return { ok: true, revision: reponse.data as unknown as RevisionIa }
		const { code, message } = reponse.error
		if (code === '42501') return { ok: false, refus: 'refuse' }
		if (code === 'PT404') return { ok: false, refus: 'introuvable' }
		if (code === '22023') return { ok: false, refus: 'mal_formee' }
		if (code === 'P0001' && message === 'suggestion figee') return { ok: false, refus: 'figee' }
		if (code === 'P0001' && message === 'generation en cours') return { ok: false, refus: 'en_cours' }
		return { ok: false, refus: 'panne' }
	} catch {
		return { ok: false, refus: 'panne' }
	}
}

export type RefusAcceptation =
	| 'session'
	| 'introuvable'
	| 'figee'
	| 'portee'
	| 'en_cours'
	| 'aucune_revision'
	| 'non_conforme'
	| 'panne'
export type ResultatAcceptation =
	| { readonly ok: true; readonly idWorkflow: string }
	| { readonly ok: false; readonly refus: RefusAcceptation; readonly defauts?: number }

const FORME_IDENTIFIANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const REFUS_ACCEPTATION: Readonly<Record<string, RefusAcceptation>> = {
	'suggestion figee': 'figee',
	'portee non livree': 'portee',
	'generation en cours': 'en_cours',
	'aucune revision': 'aucune_revision',
	'proposition non conforme': 'non_conforme',
}

/** Accepte une suggestion (`public.accepter_suggestion_ia`, §12.3) : rend le workflow créé. */
export async function accepterSuggestion(client: ClientCrm, id: string): Promise<ResultatAcceptation> {
	try {
		const reponse = await client.rpc('accepter_suggestion_ia', { p_suggestion: id })
		if (reponse.error === null) {
			return typeof reponse.data === 'string' && FORME_IDENTIFIANT.test(reponse.data)
				? { ok: true, idWorkflow: reponse.data }
				: { ok: false, refus: 'panne' }
		}
		const { code, message, details } = reponse.error
		if (code === '42501') return { ok: false, refus: 'session' }
		if (code === 'PT404') return { ok: false, refus: 'introuvable' }
		const refus = code === 'P0001' ? REFUS_ACCEPTATION[message] : undefined
		if (refus === 'non_conforme') {
			const nombre = Number.parseInt(details ?? '', 10)
			return Number.isFinite(nombre) ? { ok: false, refus, defauts: nombre } : { ok: false, refus }
		}
		return { ok: false, refus: refus ?? 'panne' }
	} catch {
		return { ok: false, refus: 'panne' }
	}
}

export type ResultatAbandon = { readonly ok: true } | { readonly ok: false; readonly refus: 'sans_effet' | 'figee' | 'panne' }

/**
 * Abandonne une suggestion (§12.4). Zéro ligne rendue est l'issue « sans effet » — suggestion illisible ou non
 * administrée — : l'annoncer comme un abandon serait annoncer ce qui n'a pas eu lieu.
 */
export async function abandonnerSuggestion(client: ClientCrm, id: string): Promise<ResultatAbandon> {
	try {
		const reponse = await client.from('suggestions_ia').update({ statut: 'abandonnee' }).eq('id', id).select('id')
		if (reponse.error === null) return reponse.data.length === 1 ? { ok: true } : { ok: false, refus: 'sans_effet' }
		if (reponse.error.code === 'P0001' && reponse.error.message === 'suggestion figee') return { ok: false, refus: 'figee' }
		return { ok: false, refus: 'panne' }
	} catch {
		return { ok: false, refus: 'panne' }
	}
}

/**
 * Un horodatage en donnée technique — date et heure courtes (docs/DESIGN_SYSTEM.md §2) —, ou `null` pour une
 * valeur que `Date` ne sait pas lire : jamais « Invalid Date » à l'écran (règle de `entete-card.ts`).
 */
export function formaterHorodatage(valeur: string, style: 'date-heure' | 'heure' = 'date-heure', locale = 'fr-FR'): string | null {
	const date = new Date(valeur)
	if (Number.isNaN(date.getTime())) return null
	return new Intl.DateTimeFormat(locale, style === 'heure' ? { timeStyle: 'short' } : { dateStyle: 'short', timeStyle: 'short' }).format(date)
}
