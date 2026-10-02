// @spec CRM-097 (docs/BACKLOG.md) — tranche T1 : le client du serveur Ollama
// @spec docs/SPEC-ia.md §3 (usage : sortie structurée, température basse, borne de 120 s, aucune
//       nouvelle tentative ; refus traduits), §11.3 (état : raisons `cle_refusee`, `serveur_injoignable`,
//       `modele_absent`), §11.4 (codes d'échec) ; docs/JOURNAL.md décision 617
//
// Module pur : `fetch` et les bornes sont injectés, ce qui rend chaque refus prouvable sans réseau. Aucun
// message brut du serveur ni du modèle ne ressort : seulement un code stable.

import type { Cible } from './configuration.ts'

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export const BORNE_ETAT_MS = 5_000
export const BORNE_GENERATION_MS = 120_000
export const TEMPERATURE = 0.2

export type RaisonIndisponible = 'cle_absente' | 'serveur_injoignable' | 'cle_refusee' | 'modele_absent'
export type EchecGeneration = 'delai_depasse' | 'serveur_injoignable' | 'cle_refusee' | 'reponse_invalide'

export type Etat =
	| { readonly disponible: true; readonly modele: string }
	| { readonly disponible: false; readonly raison: RaisonIndisponible; readonly modele: string }

export type Message = { readonly role: 'system' | 'user'; readonly content: string }

export type Generation =
	| {
			readonly ok: true
			readonly contenu: unknown
			readonly jetonsEntree: number
			readonly jetonsSortie: number
			readonly dureeMs: number
	  }
	| { readonly ok: false; readonly echec: EchecGeneration }

const entetes = (cible: Cible) => ({
	authorization: `Bearer ${cible.cle}`,
	'content-type': 'application/json',
	accept: 'application/json',
})

/**
 * Le dépassement de borne se reconnaît à son NOM, pas à sa classe : selon le runtime, l'erreur d'un
 * `AbortSignal.timeout` n'est pas une instance du même `DOMException` (mesuré sous Vitest et jsdom).
 */
const estDelai = (erreur: unknown) => {
	const nom = typeof erreur === 'object' && erreur !== null ? (erreur as { name?: unknown }).name : undefined
	return nom === 'TimeoutError' || nom === 'AbortError'
}

/** `401` : clé absente ; `403` : clé refusée pour cette origine (mesuré, docs/SPEC-ia.md §3). */
const estRefusDeCle = (statut: number) => statut === 401 || statut === 403

/** L'état : le serveur répond-il à cette clé, et sert-il le modèle configuré ? */
export async function lireEtat(
	cible: Cible | null,
	modele: string,
	requete: Fetch,
	borneMs = BORNE_ETAT_MS,
): Promise<Etat> {
	if (cible === null) return { disponible: false, raison: 'cle_absente', modele }
	try {
		const reponse = await requete(`${cible.hote}/api/tags`, {
			headers: entetes(cible),
			signal: AbortSignal.timeout(borneMs),
		})
		if (estRefusDeCle(reponse.status)) return { disponible: false, raison: 'cle_refusee', modele }
		if (!reponse.ok) return { disponible: false, raison: 'serveur_injoignable', modele }
		const corps = (await reponse.json()) as { models?: { name?: unknown }[] }
		const servis = Array.isArray(corps.models) ? corps.models.map((m) => m?.name) : []
		return servis.includes(modele)
			? { disponible: true, modele }
			: { disponible: false, raison: 'modele_absent', modele }
	} catch {
		return { disponible: false, raison: 'serveur_injoignable', modele }
	}
}

/**
 * Une génération à sortie STRUCTURÉE : le schéma JSON est passé en `format`, et le contenu rendu est
 * analysé ici. Un contenu qui n'est pas du JSON est une `reponse_invalide` — sa conformité au schéma du
 * produit est jugée ensuite, par `controlerProposition`.
 */
export async function generer(
	cible: Cible,
	modele: string,
	contexte: number,
	messages: readonly Message[],
	schema: unknown,
	requete: Fetch,
	maintenantMs: () => number = () => Date.now(),
	borneMs = BORNE_GENERATION_MS,
): Promise<Generation> {
	const debut = maintenantMs()
	let reponse: Response
	try {
		reponse = await requete(`${cible.hote}/api/chat`, {
			method: 'POST',
			headers: entetes(cible),
			body: JSON.stringify({
				model: modele,
				stream: false,
				format: schema,
				options: { num_ctx: contexte, temperature: TEMPERATURE },
				messages,
			}),
			signal: AbortSignal.timeout(borneMs),
		})
	} catch (erreur) {
		return { ok: false, echec: estDelai(erreur) ? 'delai_depasse' : 'serveur_injoignable' }
	}
	if (estRefusDeCle(reponse.status)) return { ok: false, echec: 'cle_refusee' }
	if (!reponse.ok) return { ok: false, echec: 'serveur_injoignable' }
	try {
		const corps = (await reponse.json()) as {
			message?: { content?: unknown }
			prompt_eval_count?: unknown
			eval_count?: unknown
		}
		const texte = corps.message?.content
		if (typeof texte !== 'string') return { ok: false, echec: 'reponse_invalide' }
		const contenu: unknown = JSON.parse(texte)
		const compte = (valeur: unknown) => (typeof valeur === 'number' && valeur >= 0 ? Math.round(valeur) : 0)
		return {
			ok: true,
			contenu,
			jetonsEntree: compte(corps.prompt_eval_count),
			jetonsSortie: compte(corps.eval_count),
			dureeMs: Math.max(0, maintenantMs() - debut),
		}
	} catch (erreur) {
		return { ok: false, echec: estDelai(erreur) ? 'delai_depasse' : 'reponse_invalide' }
	}
}
