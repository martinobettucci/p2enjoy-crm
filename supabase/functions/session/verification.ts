// @spec CRM-092 (docs/BACKLOG.md) — vérification du jeton d'accès LeLabs et admission côté jeton
// @spec docs/SPEC-session-sso.md §5.2 (point 4 : forme, algorithme, clés, signature, revendications ;
//       point 5 : adresse vérifiée, présence de `verified`), §6.1 (règle d'admission)
// @spec docs/SSO-client-lelabs-crm.md (« À vérifier côté application ») ; docs/SSO.md (rôles)
// @spec docs/JOURNAL.md décisions 578 (K3), 579 (A2), 580 (K14), 584 (T3), 586 (client serveur)
// @spec CRM-092 (docs/BACKLOG.md) — tranche T8 ; docs/SPEC-session-sso.md §6.1 bis (point 1) ;
//       docs/JOURNAL.md décision 597 — la PRÉSENCE d'`admin`, règle du domaine, est rapportée
//
// Module pur, repris de T3 sans changement de règle : le client serveur reçoit le jeton directement
// de LeLabs, mais le vérifie quand même — c'est la même fonction, et elle ne coûte qu'une lecture de
// clés. L'ordre compte : aucun algorithme refusé ne déclenche de lecture de clé, et rien de ce qui
// suit n'est tenté sur un jeton dont la signature n'a pas été établie.

import { algorithmeAccepte, cleCompatible, lireJws, verifierSignature } from './jws.ts'
import { Refus } from './refus.ts'

export const ROLE_REQUIS = 'verified'
/** Le rôle de realm qui vaut administrateur du CRM d'office — règle du domaine, décision 597. */
export const ROLE_ADMIN_DOMAINE = 'admin'
/** Tolérance d'un `iat` dans le futur, pour une horloge de fournisseur légèrement en avance. */
export const AVANCE_IAT_TOLEREE = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type Identite = {
	readonly sub: string
	readonly adresse: string
	readonly nom: string
	/** Échéance du jeton d'accès LeLabs, en secondes. */
	readonly exp: number
	/**
	 * `admin` est présent dans les rôles du realm (§6.1 bis). Ce n'est PAS une admission : `verified`
	 * reste exigé, et ce drapeau ne fait que suivre l'identité jusqu'à la base et au jeton interne.
	 */
	readonly adminLelabs: boolean
}

export type ContexteVerification = {
	readonly emetteur: string
	readonly clientId: string
	readonly jwksUri: string
	/** Lit le jeu de clés ; LÈVE un `Refus('sso_injoignable')` si LeLabs ne répond pas. */
	readonly lireCles: (url: string) => Promise<Record<string, unknown>>
	/** Instant présent, en secondes. */
	readonly maintenant: number
}

function nomDesRevendications(charge: Readonly<Record<string, unknown>>): string {
	if (typeof charge.name === 'string' && charge.name.trim() !== '') return charge.name
	const parties = [charge.given_name, charge.family_name].filter((p): p is string => typeof p === 'string' && p.trim() !== '')
	return parties.join(' ')
}

/**
 * Rend l'identité d'un jeton d'accès vérifié et admissible côté jeton, ou lève le refus nommé :
 * `jeton_refuse`, `adresse_non_verifiee`, `attente_verification`, `sso_injoignable`.
 */
export async function verifierJetonAcces(jeton: string, c: ContexteVerification): Promise<Identite> {
	const jws = lireJws(jeton)
	if (jws === null) throw new Refus('jeton_refuse')

	// L'algorithme AVANT toute lecture de clé : aucun jeton symétrique n'est essayé.
	const alg = jws.entete.alg
	if (!algorithmeAccepte(alg)) throw new Refus('jeton_refuse')
	const kid = jws.entete.kid
	if (typeof kid !== 'string' || kid === '') throw new Refus('jeton_refuse')

	// Les clés, relues à chaque geste : aucune n'est épinglée ni gardée.
	const jwks = await c.lireCles(c.jwksUri)
	if (!Array.isArray(jwks.keys)) throw new Refus('sso_injoignable')
	const cle = (jwks.keys as unknown[]).find(
		(k): k is Record<string, unknown> =>
			k !== null && typeof k === 'object' && (k as Record<string, unknown>).kid === kid && cleCompatible(alg, k as Record<string, unknown>),
	)
	if (cle === undefined) throw new Refus('jeton_refuse')
	if (!(await verifierSignature(alg, cle, jws.signe, jws.signature))) throw new Refus('jeton_refuse')

	// Les revendications ; jamais `aud` (K14).
	const r = jws.charge
	if (r.iss !== c.emetteur) throw new Refus('jeton_refuse')
	if (r.azp !== c.clientId) throw new Refus('jeton_refuse')
	if (r.typ !== 'Bearer') throw new Refus('jeton_refuse')
	if (typeof r.exp !== 'number' || !(r.exp > c.maintenant)) throw new Refus('jeton_refuse')
	if (r.iat !== undefined && (typeof r.iat !== 'number' || r.iat > c.maintenant + AVANCE_IAT_TOLEREE)) {
		throw new Refus('jeton_refuse')
	}
	if (typeof r.sub !== 'string' || !UUID.test(r.sub)) throw new Refus('jeton_refuse')

	// L'admission côté jeton (§6.1) : adresse vérifiée, puis PRÉSENCE de `verified`.
	const adresse = typeof r.email === 'string' && r.email.trim() !== '' ? r.email.trim().toLowerCase() : null
	if (adresse === null || r.email_verified !== true) throw new Refus('adresse_non_verifiee', adresse)
	const roles = (r.realm_access as Record<string, unknown> | undefined)?.roles
	if (!Array.isArray(roles) || !roles.includes(ROLE_REQUIS)) throw new Refus('attente_verification', adresse)

	// LA PRÉSENCE d'`admin`, jamais le nombre ni l'ordre : le tableau porte aussi les rôles techniques
	// par défaut du realm (K14). Relue à chaque geste, depuis le jeton qui vient d'être vérifié.
	return {
		sub: r.sub.toLowerCase(),
		adresse,
		nom: nomDesRevendications(r),
		exp: r.exp,
		adminLelabs: roles.includes(ROLE_ADMIN_DOMAINE),
	}
}
