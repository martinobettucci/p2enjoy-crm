// @spec CRM-011 (docs/BACKLOG.md) — contrat client de connexion et de déconnexion
// @spec docs/SPEC-auth.md §9.1 (navigation), §9.3 (erreurs), §9.4 (déconnexion)
// @spec docs/DESIGN_SYSTEM.md §5.8 (états explicites), §5.12 (connexion)
//
// Ce module ne rend rien. Il réduit les erreurs de GoTrue à trois états que l'écran sait
// expliquer sans exposer le message du serveur ni distinguer une adresse inconnue d'un mauvais
// mot de passe.

export type NatureEchecConnexion = 'identifiants' | 'reseau' | 'configuration'

export type ErreurAuthentification = {
	readonly message?: string
	readonly status?: number
	readonly code?: string
}

/**
 * Classe une erreur sans jamais rendre son message brut à l'utilisateur.
 *
 * Une réponse 5xx et une absence de statut sont des indisponibilités. Les refus 4xx — y compris
 * `invalid_credentials` pour une adresse inconnue comme pour un mauvais mot de passe — partagent
 * volontairement le même état.
 */
export function classerEchecConnexion(erreur: ErreurAuthentification): NatureEchecConnexion {
	if (erreur.code === 'configuration_missing') return 'configuration'
	if (erreur.status !== undefined && erreur.status >= 500) return 'reseau'
	if (erreur.status === 0) return 'reseau'
	if (erreur.status === undefined) {
		const message = erreur.message?.toLocaleLowerCase('en') ?? ''
		if (/fetch|network|timeout|connexion|connection/.test(message)) return 'reseau'
	}
	return 'identifiants'
}

/** Une adresse de retour ne quitte jamais l'origine ni la racine de l'application. */
export function cheminRetour(valeur: unknown): string {
	if (typeof valeur !== 'string') return '/'
	if (!valeur.startsWith('/') || valeur.startsWith('//')) return '/'
	return valeur === '/connexion' || valeur.startsWith('/connexion?') ? '/' : valeur
}
