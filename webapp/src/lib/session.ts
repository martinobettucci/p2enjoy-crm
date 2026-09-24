// @spec CRM-092 (docs/BACKLOG.md) — les trois gestes de la webapp vers l'échangeur de session
// @spec docs/SPEC-session-sso.md §5.1 (gestes, chemin relatif, `apikey`), §5.4 (réponse de succès),
//       §5.5 (refus, dictionnaire fermé), §8.2 (ce module), §8.3 (rien n'est stocké), §9.2
// @spec docs/JOURNAL.md décisions 586 (client serveur : le cookie de la poignée est de même origine),
//       587 (aucune session : la prolongation rend `204`, jamais une erreur)
// @spec CLAUDE.md §10 (aucune autorisation décidée dans le navigateur), §11 (aucun stockage)
// @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.5, §9.2 — INC-249, décision 593 :
//       l'attente `attente_administrateur` (espace sans administrateur encore)
//
// Ce module ne rend rien, ne stocke rien et ne décide d'aucun droit. Il porte `ouvrir`, `prolonger`
// et `fermer` vers l'échangeur par un chemin RELATIF — la même origine que la webapp, où Caddy en
// production et le relais de Vite en développement font suivre vers Kong (§8.6) —, et classe chaque
// réponse vers le dictionnaire du §9.2. La poignée voyage dans un cookie `httpOnly` qu'aucun script
// ne lit : `credentials: 'same-origin'` suffit à ce que le navigateur la joigne.

import type { NatureEchecSso } from './sso'

export const CHEMIN_ECHANGEUR = '/functions/v1/session'

/** Identité rendue par l'échangeur ; elle nomme la session, elle n'ouvre aucun droit. */
export type IdentiteSession = {
	readonly id: string
	readonly email: string
	readonly nom: string
}

/** Session du CRM : le jeton interne (§5.4), gardé en mémoire seulement (§8.3). */
export type SessionInterne = {
	readonly jeton: string
	/** Échéance du jeton interne, en secondes depuis l'époque Unix, à l'horloge du SERVEUR. */
	readonly expireA: number
	/**
	 * Durée de vie du jeton, `exp − iat`, en secondes. Le rafraîchissement se programme sur elle, à
	 * compter de la réception : l'horloge du poste peut être décalée de celle du serveur, et une
	 * échéance absolue lue à une horloge en avance ferait prolonger en boucle.
	 */
	readonly dureeS: number
	readonly identite: IdentiteSession
}

/**
 * Issue d'un geste. `session_absente` n'est pas un refus à dire : c'est un navigateur sans session —
 * la prolongation rend `204` (décision 587) —, que l'application rend anonyme sans message (§8.4).
 */
export type NatureEchecSession = NatureEchecSso | 'session_absente'

export type IssueGeste =
	| { readonly ok: true; readonly session: SessionInterne }
	| { readonly ok: false; readonly nature: NatureEchecSession; readonly adresse?: string }

export type IssueFermeture = { readonly ok: true } | { readonly ok: false; readonly nature: 'reseau' }

export type Echangeur = {
	ouvrir(code: string, verificateur: string, redirectUri: string): Promise<IssueGeste>
	prolonger(): Promise<IssueGeste>
	fermer(): Promise<IssueFermeture>
}

type Fetch = typeof fetch

const ATTENTES = ['adresse_non_verifiee', 'attente_verification', 'attente_espace', 'attente_administrateur'] as const

function objet(valeur: unknown): Record<string, unknown> | null {
	return valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null
}

/** `iat` du jeton interne, LU et non vérifié : la vérification appartient à la pile de données. */
function emisA(jeton: string): number | null {
	const charge = jeton.split('.')[1]
	if (charge === undefined || charge === '') return null
	try {
		const base64 = charge.replace(/-/g, '+').replace(/_/g, '/')
		const valeur = objet(JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))))?.iat
		return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null
	} catch {
		return null
	}
}

/** Une réponse `200` n'est une session que si elle porte le corps exact du §5.4, et un jeton daté. */
export function lireSession(corps: unknown): SessionInterne | null {
	const c = objet(corps)
	const identite = objet(c?.identite)
	if (c === null || identite === null) return null
	const { jeton, expire_a: expireA } = c
	const { id, adresse, nom } = identite
	if (typeof jeton !== 'string' || jeton === '') return null
	if (typeof expireA !== 'number' || !Number.isFinite(expireA)) return null
	if (typeof id !== 'string' || id === '' || typeof adresse !== 'string' || typeof nom !== 'string') return null
	const iat = emisA(jeton)
	if (iat === null || expireA < iat) return null
	return { jeton, expireA, dureeS: expireA - iat, identite: { id, email: adresse, nom } }
}

/**
 * Classe un refus de l'échangeur (§5.5) vers le dictionnaire de l'écran (§9.2). Seul le code est lu,
 * jamais un message ; l'adresse ne l'est que pour les trois attentes, qui la nomment toujours.
 *
 * Un `jeton_refuse` à l'ouverture est un échec de la connexion ; à la prolongation, il dit que la
 * session LeLabs ne rend plus un jeton conforme : l'échangeur l'a close, elle a pris fin.
 */
export function classerRefus(geste: 'ouvrir' | 'prolonger', statut: number, corps: unknown): IssueGeste {
	const c = objet(corps)
	const erreur = c?.erreur
	if ((ATTENTES as readonly unknown[]).includes(erreur)) {
		// Une attente nomme toujours l'adresse (§5.5) ; sans elle, la réponse n'est pas conforme.
		const adresse = c?.adresse
		return typeof adresse === 'string' && adresse !== ''
			? { ok: false, nature: erreur as NatureEchecSso, adresse }
			: { ok: false, nature: 'sso_echec' }
	}
	switch (erreur) {
		case 'session_expiree':
			return { ok: false, nature: 'session_expiree' }
		case 'jeton_refuse':
			return { ok: false, nature: geste === 'ouvrir' ? 'sso_echec' : 'session_expiree' }
		case 'sso_injoignable':
		case 'service_indisponible':
			return { ok: false, nature: 'reseau' }
		default:
			return { ok: false, nature: statut >= 500 ? 'reseau' : 'sso_echec' }
	}
}

export function creerEchangeur({ cleAnonyme, requete = fetch }: { readonly cleAnonyme: string; readonly requete?: Fetch }): Echangeur {
	const appeler = (geste: 'ouvrir' | 'prolonger' | 'fermer', corps?: Readonly<Record<string, string>>) =>
		requete(`${CHEMIN_ECHANGEUR}/${geste}`, {
			method: 'POST',
			credentials: 'same-origin',
			cache: 'no-store',
			headers: corps === undefined ? { apikey: cleAnonyme } : { apikey: cleAnonyme, 'content-type': 'application/json' },
			...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
		})

	const geste = async (nom: 'ouvrir' | 'prolonger', corps?: Readonly<Record<string, string>>): Promise<IssueGeste> => {
		let reponse: Response
		try {
			reponse = await appeler(nom, corps)
		} catch {
			return { ok: false, nature: 'reseau' }
		}
		let document: unknown = null
		try {
			document = await reponse.json()
		} catch {
			document = null
		}
		if (nom === 'prolonger' && reponse.status === 204) return { ok: false, nature: 'session_absente' }
		if (reponse.status === 200) {
			const session = lireSession(document)
			return session === null ? { ok: false, nature: 'sso_echec' } : { ok: true, session }
		}
		return classerRefus(nom, reponse.status, document)
	}

	return {
		ouvrir: (code, verificateur, redirectUri) => geste('ouvrir', { code, verificateur, redirect_uri: redirectUri }),
		prolonger: () => geste('prolonger'),
		async fermer() {
			try {
				const reponse = await appeler('fermer')
				await reponse.arrayBuffer().catch(() => undefined)
				return reponse.status === 204 ? { ok: true } : { ok: false, nature: 'reseau' }
			} catch {
				return { ok: false, nature: 'reseau' }
			}
		},
	}
}
