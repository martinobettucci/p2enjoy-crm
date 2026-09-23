// @spec CRM-092 (docs/BACKLOG.md) — dictionnaire fermé des refus de l'échangeur de session
// @spec docs/SPEC-session-sso.md §5.5 (refus, dictionnaire fermé), §9.2 (ce que l'écran en fait)
// @spec docs/JOURNAL.md décision 586 (client serveur : trois gestes, sessions serveur), 587 (l'absence de
//       session n'est pas un refus : la prolongation rend `204`)
//
// Module pur. Un refus porte son CODE et, pour les trois attentes, l'adresse que l'écran nommera.
// Aucun autre détail ne sort : ni motif technique, ni message du fournisseur.

export type CodeRefus =
	| 'requete_invalide'
	| 'jeton_refuse'
	| 'session_expiree'
	| 'adresse_non_verifiee'
	| 'attente_verification'
	| 'attente_espace'
	| 'geste_inconnu'
	| 'methode'
	| 'sso_injoignable'
	| 'service_indisponible'

export const STATUT_REFUS: Readonly<Record<CodeRefus, number>> = {
	requete_invalide: 400,
	jeton_refuse: 401,
	session_expiree: 401,
	adresse_non_verifiee: 403,
	attente_verification: 403,
	attente_espace: 403,
	geste_inconnu: 404,
	methode: 405,
	sso_injoignable: 502,
	service_indisponible: 502,
}

const ATTENTES: ReadonlySet<CodeRefus> = new Set(['adresse_non_verifiee', 'attente_verification', 'attente_espace'])

export class Refus extends Error {
	readonly code: CodeRefus
	readonly adresse: string | null
	constructor(code: CodeRefus, adresse: string | null = null) {
		super(code)
		this.code = code
		this.adresse = adresse
	}

	/** Corps de la réponse : le code, plus l'adresse pour une attente, et rien d'autre. */
	corps(): Record<string, unknown> {
		return ATTENTES.has(this.code) ? { erreur: this.code, adresse: this.adresse } : { erreur: this.code }
	}
}
