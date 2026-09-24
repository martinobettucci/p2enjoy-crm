// @spec CRM-091 (docs/BACKLOG.md) — aller PKCE de la webapp : découverte, transaction, jugement du retour
// @spec CRM-092 (docs/BACKLOG.md) — le SSO seule source d'identité : plus de nonce, plus d'id_token,
//       et plus aucun appel au point de jeton de LeLabs — le client confidentiel est l'échangeur
// @spec docs/SPEC-session-sso.md §4 (parcours), §8.1 (ce module, révisé), §9.2 (dictionnaire fermé)
// @spec docs/SPEC-auth.md §10.3 (transaction à usage unique, jugement du retour), §10.5 (stockage)
// @spec docs/SSO.md (découverte, portées) ; docs/SSO-client-lelabs-crm.md (PKCE S256)
// @spec docs/JOURNAL.md décision 586 (client serveur)
// @spec CLAUDE.md §10 (aucune autorisation décidée dans le navigateur), §11 (stockage d'onglet)
// @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.5, §9.2 — INC-249, décision 593 :
//       l'attente `attente_administrateur` (espace sans administrateur encore)
//
// Ce module ne rend rien et ne décide d'aucun droit. Il mène la partie navigateur du code
// d'autorisation avec PKCE jusqu'au code rendu par LeLabs. L'échangeur de session, côté serveur,
// échange ce code avec son secret, vérifie le jeton et décide de l'admission
// (docs/SPEC-session-sso.md §5) : aucun jeton LeLabs n'atteint le navigateur.

/** Configuration figée au build, comme `VITE_SUPABASE_*`. */
export type ConfigurationSso = {
	readonly emetteur: string
	readonly clientId: string
}

/**
 * Dictionnaire fermé des issues d'une connexion ou d'une session (docs/SPEC-session-sso.md §9.2).
 * Les quatre premières sont des REFUS ; les trois suivantes sont des ATTENTES, qui disent qu'un
 * geste d'autrui manque ; `configuration` dit que ce déploiement ne sait pas se connecter.
 */
export type NatureEchecSso =
	| 'sso_annule'
	| 'sso_echec'
	| 'reseau'
	| 'session_expiree'
	| 'adresse_non_verifiee'
	| 'attente_verification'
	| 'attente_espace'
	| 'attente_administrateur'
	| 'configuration'

// `attente_administrateur` : une attente en suspens, faute d'administrateur dans l'espace (INC-249,
// décision 593, docs/SPEC-session-sso.md §5.5).
export const NATURES_ATTENTE = ['adresse_non_verifiee', 'attente_verification', 'attente_espace', 'attente_administrateur'] as const
export type NatureAttente = (typeof NATURES_ATTENTE)[number]

export function estAttente(nature: NatureEchecSso): nature is NatureAttente {
	return (NATURES_ATTENTE as readonly string[]).includes(nature)
}

/** Échec d'une étape du parcours, porteur de sa seule nature — jamais du message du serveur. */
export class EchecSso extends Error {
	readonly nature: NatureEchecSso
	constructor(nature: NatureEchecSso) {
		super(nature)
		this.name = 'EchecSso'
		this.nature = nature
	}
}

/** Point d'autorisation lu dans la découverte, jamais recopié à la main (docs/SSO.md). */
export type Decouverte = {
	readonly autorisation: string
}

/**
 * Ce qui doit survivre à l'aller-retour vers LeLabs, et rien d'autre. Plus de nonce : aucun
 * `id_token` n'est lu, et PKCE protège le code (docs/SPEC-session-sso.md §4). Le vérificateur est
 * remis à l'échangeur avec le code, jamais au point de jeton par le navigateur.
 */
export type TransactionSso = {
	readonly state: string
	readonly verificateur: string
	readonly retour: string
	readonly redirectUri: string
	readonly expireA: number
}

export type StockageTransaction = {
	readonly getItem: (cle: string) => string | null
	readonly setItem: (cle: string, valeur: string) => void
	readonly removeItem: (cle: string) => void
}

export const CLE_TRANSACTION_SSO = 'p2enjoy-crm.sso.transaction'
export const DUREE_TRANSACTION_MS = 10 * 60 * 1000
export const CHEMIN_RETOUR_SSO = '/auth/retour'

// --- Configuration ------------------------------------------------------------------------------

/**
 * Rend `null` si l'une des deux valeurs manque : sans elles, ce déploiement ne sait pas se
 * connecter, et l'écran le dit au lieu d'offrir une commande morte (docs/SPEC-session-sso.md §9.1).
 */
export function lireConfigurationSso(env: ImportMetaEnv): ConfigurationSso | null {
	const emetteur = env.VITE_SSO_ISSUER
	const clientId = env.VITE_SSO_CLIENT_ID
	if (typeof emetteur !== 'string' || emetteur.trim() === '') return null
	if (typeof clientId !== 'string' || clientId.trim() === '') return null
	return { emetteur: emetteur.trim().replace(/\/+$/, ''), clientId: clientId.trim() }
}

export const configurationSso: ConfigurationSso | null = lireConfigurationSso(import.meta.env)

// --- Primitives cryptographiques -----------------------------------------------------------------

/** base64url sans remplissage, RFC 7636 §3. */
export function base64url(octets: Uint8Array): string {
	let binaire = ''
	for (const octet of octets) binaire += String.fromCharCode(octet)
	return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Valeur imprévisible, tirée par le générateur cryptographique du navigateur. */
export function aleatoire(octets: number): string {
	return base64url(crypto.getRandomValues(new Uint8Array(octets)))
}

/** Défi PKCE `S256` : `base64url(SHA-256(vérificateur))` (RFC 7636 §4.2). */
export async function defiPkce(verificateur: string): Promise<string> {
	return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verificateur))))
}

// --- Découverte ----------------------------------------------------------------------------------

type Fetch = typeof fetch

/**
 * Lit la découverte OIDC et exige que son `issuer` soit EXACTEMENT celui configuré : un émetteur
 * différent produirait des jetons que l'échangeur refuserait, et le dire ici évite un aller-retour.
 * Seul le point d'autorisation est retenu : le navigateur ne parle jamais au point de jeton.
 */
export async function lireDecouverte(configuration: ConfigurationSso, requete: Fetch = fetch): Promise<Decouverte> {
	let reponse: Response
	try {
		reponse = await requete(`${configuration.emetteur}/.well-known/openid-configuration`)
	} catch {
		throw new EchecSso('reseau')
	}
	if (!reponse.ok) throw new EchecSso(reponse.status >= 500 ? 'reseau' : 'sso_echec')
	let document: unknown
	try {
		document = await reponse.json()
	} catch {
		throw new EchecSso('sso_echec')
	}
	const d = document as Record<string, unknown> | null
	if (d === null || typeof d !== 'object' || d.issuer !== configuration.emetteur) throw new EchecSso('sso_echec')
	const autorisation = d.authorization_endpoint
	if (!urlHttp(autorisation)) throw new EchecSso('sso_echec')
	return { autorisation }
}

function urlHttp(valeur: unknown): valeur is string {
	if (typeof valeur !== 'string') return false
	try {
		const url = new URL(valeur)
		return url.protocol === 'https:' || url.protocol === 'http:'
	} catch {
		return false
	}
}

// --- Aller ---------------------------------------------------------------------------------------

export type PreparationSso = {
	readonly configuration: ConfigurationSso
	readonly decouverte: Decouverte
	/** Origine de la webapp, telle que la voit le navigateur (`window.location.origin`). */
	readonly origine: string
	/** Adresse interne à rouvrir après succès, déjà passée par `cheminRetour`. */
	readonly retour: string
	readonly stockage: StockageTransaction
	readonly maintenant?: number
}

/**
 * Tire le vérificateur et le `state`, enregistre la transaction, puis rend l'adresse
 * d'autorisation. Les portées se bornent à `openid email profile`, les seules que le fournisseur
 * accepte (docs/SSO.md).
 */
export async function preparerRedirection(p: PreparationSso): Promise<string> {
	const verificateur = aleatoire(32)
	const state = aleatoire(16)
	const redirectUri = `${p.origine}${CHEMIN_RETOUR_SSO}`
	const transaction: TransactionSso = {
		state,
		verificateur,
		retour: p.retour,
		redirectUri,
		expireA: (p.maintenant ?? Date.now()) + DUREE_TRANSACTION_MS,
	}
	p.stockage.setItem(CLE_TRANSACTION_SSO, JSON.stringify(transaction))

	const url = new URL(p.decouverte.autorisation)
	url.searchParams.set('client_id', p.configuration.clientId)
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('scope', 'openid email profile')
	url.searchParams.set('redirect_uri', redirectUri)
	url.searchParams.set('state', state)
	url.searchParams.set('code_challenge', await defiPkce(verificateur))
	url.searchParams.set('code_challenge_method', 'S256')
	return url.toString()
}

// --- Retour --------------------------------------------------------------------------------------

/**
 * Lit la transaction ET LA RETIRE : elle ne sert qu'une fois, succès ou échec.
 * Rend `null` si elle manque, est illisible, incomplète ou échue.
 */
export function consommerTransaction(stockage: StockageTransaction, maintenant = Date.now()): TransactionSso | null {
	const brut = stockage.getItem(CLE_TRANSACTION_SSO)
	stockage.removeItem(CLE_TRANSACTION_SSO)
	if (brut === null) return null
	let t: unknown
	try {
		t = JSON.parse(brut)
	} catch {
		return null
	}
	const x = t as Record<string, unknown> | null
	if (x === null || typeof x !== 'object') return null
	const champs = ['state', 'verificateur', 'retour', 'redirectUri'] as const
	if (!champs.every((champ) => typeof x[champ] === 'string' && x[champ] !== '')) return null
	if (typeof x.expireA !== 'number' || x.expireA <= maintenant) return null
	return x as unknown as TransactionSso
}

export type IssueRetour = { readonly ok: true; readonly code: string } | { readonly ok: false; readonly nature: NatureEchecSso }

/**
 * Juge l'adresse de retour AVANT tout échange. Un `state` différent n'est pas « notre » retour :
 * même une annulation n'est reconnue qu'accompagnée du bon `state`.
 */
export function jugerRetour(recherche: string, transaction: TransactionSso | null): IssueRetour {
	if (transaction === null) return { ok: false, nature: 'sso_echec' }
	const params = new URLSearchParams(recherche)
	if (params.get('state') !== transaction.state) return { ok: false, nature: 'sso_echec' }
	const erreur = params.get('error')
	if (erreur !== null) return { ok: false, nature: erreur === 'access_denied' ? 'sso_annule' : 'sso_echec' }
	const code = params.get('code')
	if (code === null || code === '') return { ok: false, nature: 'sso_echec' }
	return { ok: true, code }
}

/** Nature d'une erreur quelconque levée pendant le parcours. */
export function natureDe(erreur: unknown): NatureEchecSso {
	return erreur instanceof EchecSso ? erreur.nature : 'sso_echec'
}
