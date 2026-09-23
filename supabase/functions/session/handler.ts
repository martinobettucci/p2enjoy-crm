// @spec CRM-092 (docs/BACKLOG.md) — échangeur de session, client CONFIDENTIEL de LeLabs : trois gestes
// @spec docs/SPEC-session-sso.md §5.1 (gestes, origine), §5.2 (ouvrir), §5.3 (prolonger, fermer),
//       §5.4 (jeton interne), §5.5 (refus), §5.6 (poignée et cookie), §5.7 (échéance, journal), §6.1
// @spec docs/SSO-client-lelabs-crm.md ; docs/SSO.md (« Fermer une session » : rien n'est révoqué)
// @spec docs/JOURNAL.md décisions 584 (T3), 586 (arbitrage du responsable : client serveur), 587 (aucune
//       session : `204`, pas une erreur)
// @spec CLAUDE.md §10 (la règle d'accès est appliquée côté serveur), §20 (journal sans secret)
//
// Module pur : toute entrée-sortie passe par `DependancesSession`, ce qui rend chaque refus prouvable
// sans réseau. Le navigateur ne reçoit AUCUN jeton LeLabs : il remet un code et son vérificateur,
// l'échangeur les échange avec son secret, garde le jeton de rafraîchissement chiffré en base, et ne
// rend qu'un jeton interne et une poignée opaque en cookie `httpOnly`.

import { chiffrer, cleDeChiffrement, dechiffrer, empreinteDe } from './chiffrement.ts'
import { cookieDePoignee, cookieEfface, lirePoignee, origineSecurisee } from './cookie.ts'
import { signerHs256 } from './jws.ts'
import { Refus, STATUT_REFUS } from './refus.ts'
import { verifierJetonAcces, type Identite } from './verification.ts'

export type ConfigurationSession = {
	/** Émetteur EXACT attendu dans les jetons et dans la découverte (`SSO_OIDC_ISSUER`). */
	readonly emetteur: string
	/** Client confidentiel du CRM (`SSO_OIDC_CLIENT_ID`), seul `azp` accepté. */
	readonly clientId: string
	/** Secret de ce client (`SSO_OIDC_CLIENT_SECRET`), posé par l'administrateur du realm. */
	readonly clientSecret: string
	/** Clé de signature du jeton interne (`JWT_SECRET`), dont dérive aussi la clé de chiffrement. */
	readonly secretJwt: string
}

export type ReponseFormulaire = { readonly statut: number; readonly corps: unknown }

export type DependancesSession = {
	readonly configuration: ConfigurationSession | null
	/** Lit un document JSON chez LeLabs avant `echeance` (ms) ; LÈVE sur panne, délai ou réponse non 2xx. */
	readonly lireJson: (url: string, echeance: number) => Promise<unknown>
	/** Poste un formulaire au point de jeton avant `echeance` ; LÈVE sur panne ou délai, jamais sur un statut. */
	readonly posterFormulaire: (url: string, champs: Readonly<Record<string, string>>, echeance: number) => Promise<ReponseFormulaire>
	/** Appelle une fonction de la base par PostgREST avant `echeance` ; LÈVE si l'appel échoue. */
	readonly appelerBase: (fonction: string, arguments_: Readonly<Record<string, unknown>>, echeance: number) => Promise<unknown>
	readonly maintenantMs: () => number
	readonly tirerPoignee: () => string
	readonly journaliser: (evenement: Readonly<Record<string, unknown>>) => void
}

export const EMETTEUR_INTERNE = 'p2enjoy-crm/session'
/** Au plus 300 s, et jamais au-delà du jeton d'accès LeLabs (§5.4). */
export const DUREE_MAX_JETON_INTERNE = 300
/** Échéance d'un geste entier : la réponse part toujours avant les 10 s de temps mur d'un worker (§5.7). */
export const ECHEANCE_GESTE_MS = 8_000

const ALLOW = 'POST, OPTIONS'
const EN_TETES = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
const GESTES = ['ouvrir', 'prolonger', 'fermer'] as const
type Geste = (typeof GESTES)[number]

// --- Réponses ------------------------------------------------------------------------------------

function repondre(status: number, corps: Readonly<Record<string, unknown>> | null, cookie?: string): Response {
	const headers = new Headers(EN_TETES)
	if (cookie !== undefined) headers.set('set-cookie', cookie)
	if (status === 405) headers.set('allow', ALLOW)
	return new Response(corps === null ? null : JSON.stringify(corps), { status, headers })
}

/** Un refus, qui peut effacer le cookie : une poignée devenue inutile ne reste pas dans le navigateur. */
class RefusSession extends Refus {
	readonly effacerCookie: boolean
	constructor(refus: Refus, effacerCookie: boolean) {
		super(refus.code, refus.adresse)
		this.effacerCookie = effacerCookie
	}
}

function gesteDe(chemin: string): Geste | null {
	const segments = chemin.split('/').filter(Boolean)
	const dernier = segments.length === 2 && segments[0] === 'session' ? segments[1] : undefined
	return (GESTES as readonly string[]).includes(dernier ?? '') ? (dernier as Geste) : null
}

// --- Appels à LeLabs et à la base ----------------------------------------------------------------

function objet(valeur: unknown): Record<string, unknown> | null {
	return valeur !== null && typeof valeur === 'object' && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : null
}

/**
 * Un point d'entrée n'est suivi qu'en `https:`, ou en `http:` vers la boucle locale ou `*.localhost` —
 * le seul Keycloak de développement (§5.2, point 2).
 */
export function adresseAcceptable(valeur: unknown): valeur is string {
	if (typeof valeur !== 'string') return false
	let url: URL
	try {
		url = new URL(valeur)
	} catch {
		return false
	}
	if (url.protocol === 'https:') return true
	if (url.protocol !== 'http:') return false
	const hote = url.hostname
	return hote === 'localhost' || hote.endsWith('.localhost') || hote === '127.0.0.1' || hote === '[::1]'
}

type Decouverte = { readonly pointJeton: string; readonly jwksUri: string }

async function lireChezLeLabs(d: DependancesSession, url: string, echeance: number): Promise<Record<string, unknown>> {
	let document: unknown
	try {
		document = await d.lireJson(url, echeance)
	} catch {
		throw new Refus('sso_injoignable')
	}
	const o = objet(document)
	if (o === null) throw new Refus('sso_injoignable')
	return o
}

async function decouvrir(d: DependancesSession, c: ConfigurationSession, echeance: number): Promise<Decouverte> {
	const document = await lireChezLeLabs(d, `${c.emetteur}/.well-known/openid-configuration`, echeance)
	if (document.issuer !== c.emetteur || !adresseAcceptable(document.token_endpoint) || !adresseAcceptable(document.jwks_uri)) {
		throw new Refus('sso_injoignable')
	}
	return { pointJeton: document.token_endpoint, jwksUri: document.jwks_uri }
}

type JetonsObtenus = { readonly acces: string; readonly rafraichissement: string; readonly expireLe: string }

/**
 * Demande des jetons au point de jeton avec le secret. Un refus `4xx` de LeLabs devient `refus4xx` ;
 * une panne ou une réponse non conforme, `sso_injoignable`.
 */
async function demanderJetons(
	d: DependancesSession,
	pointJeton: string,
	champs: Readonly<Record<string, string>>,
	refus4xx: Refus,
	echeance: number,
): Promise<JetonsObtenus> {
	let reponse: ReponseFormulaire
	try {
		reponse = await d.posterFormulaire(pointJeton, champs, echeance)
	} catch {
		throw new Refus('sso_injoignable')
	}
	if (reponse.statut >= 400 && reponse.statut < 500) throw refus4xx
	if (reponse.statut !== 200) throw new Refus('sso_injoignable')
	const corps = objet(reponse.corps)
	const acces = corps?.access_token
	const rafraichissement = corps?.refresh_token
	const duree = corps?.refresh_expires_in
	if (typeof acces !== 'string' || acces === '' || typeof rafraichissement !== 'string' || rafraichissement === '') {
		throw new Refus('sso_injoignable')
	}
	// L'échéance d'inactivité est une donnée de LeLabs : sans elle, aucune n'est inventée.
	if (typeof duree !== 'number' || !(duree > 0)) throw new Refus('sso_injoignable')
	return { acces, rafraichissement, expireLe: new Date(d.maintenantMs() + duree * 1000).toISOString() }
}

async function appelerBase(d: DependancesSession, fonction: string, args: Readonly<Record<string, unknown>>, echeance: number): Promise<unknown> {
	try {
		return await d.appelerBase(fonction, args, echeance)
	} catch {
		throw new Refus('service_indisponible')
	}
}

// --- Jeton interne -------------------------------------------------------------------------------

async function reponseSession(d: DependancesSession, c: ConfigurationSession, identite: Identite, nomProfil: unknown, cookie?: string): Promise<Response> {
	const maintenant = Math.floor(d.maintenantMs() / 1000)
	const expireA = Math.min(identite.exp, maintenant + DUREE_MAX_JETON_INTERNE)
	const jeton = await signerHs256(
		{ iss: EMETTEUR_INTERNE, sub: identite.sub, aud: 'authenticated', role: 'authenticated', iat: maintenant, exp: expireA },
		c.secretJwt,
	)
	const nom = typeof nomProfil === 'string' && nomProfil !== '' ? nomProfil : identite.nom
	return repondre(200, { jeton, expire_a: expireA, identite: { id: identite.sub, adresse: identite.adresse, nom } }, cookie)
}

function contexteVerification(d: DependancesSession, c: ConfigurationSession, decouverte: Decouverte, echeance: number) {
	return {
		emetteur: c.emetteur,
		clientId: c.clientId,
		jwksUri: decouverte.jwksUri,
		lireCles: (url: string) => lireChezLeLabs(d, url, echeance),
		maintenant: Math.floor(d.maintenantMs() / 1000),
	}
}

// --- Les trois gestes ----------------------------------------------------------------------------

async function ouvrir(requete: Request, d: DependancesSession, c: ConfigurationSession, echeance: number, securise: boolean): Promise<Response> {
	// §5.2, point 1 — le corps.
	let corps: Record<string, unknown> | null
	try {
		corps = objet(await requete.json())
	} catch {
		throw new Refus('requete_invalide')
	}
	const code = corps?.code
	const verificateur = corps?.verificateur
	const redirectUri = corps?.redirect_uri
	if (typeof code !== 'string' || code === '' || typeof verificateur !== 'string' || verificateur === '') {
		throw new Refus('requete_invalide')
	}
	if (!adresseRetourAcceptable(redirectUri)) throw new Refus('requete_invalide')

	// §5.2, points 2 à 4 — découverte, échange du code AVEC LE SECRET, vérification du jeton.
	const decouverte = await decouvrir(d, c, echeance)
	const jetons = await demanderJetons(
		d,
		decouverte.pointJeton,
		{
			grant_type: 'authorization_code',
			client_id: c.clientId,
			client_secret: c.clientSecret,
			code,
			code_verifier: verificateur,
			redirect_uri: redirectUri,
		},
		new Refus('jeton_refuse'),
		echeance,
	)
	const identite = await verifierJetonAcces(jetons.acces, contexteVerification(d, c, decouverte, echeance))

	// §5.2, point 5 — admission et session serveur, en un seul appel.
	const poignee = d.tirerPoignee()
	const cle = await cleDeChiffrement(c.secretJwt)
	const admission = objet(
		await appelerBase(
			d,
			'ouvrir_session_serveur',
			{
				p_sub: identite.sub,
				p_email: identite.adresse,
				p_nom: identite.nom,
				p_empreinte: await empreinteDe(poignee),
				p_rafraichissement: await chiffrer(jetons.rafraichissement, cle),
				p_expire_le: jetons.expireLe,
			},
			echeance,
		),
	)
	if (admission === null || typeof admission.admis !== 'boolean') throw new Refus('service_indisponible')
	if (!admission.admis) throw new Refus('attente_espace', identite.adresse)

	return reponseSession(d, c, identite, admission.nom, cookieDePoignee(poignee, securise))
}

/** L'URL de retour : `http(s)`, terminée par `/auth/retour`. LeLabs la compare en outre au caractère près. */
function adresseRetourAcceptable(valeur: unknown): valeur is string {
	if (typeof valeur !== 'string') return false
	try {
		const url = new URL(valeur)
		return (url.protocol === 'https:' || url.protocol === 'http:') && url.pathname === '/auth/retour' && url.search === ''
	} catch {
		return false
	}
}

/**
 * Aucune session à prolonger — le cas normal d'un navigateur jamais connecté, et la restauration de
 * chaque page anonyme : `204`, sans corps, jamais une erreur (décision 587). Un navigateur journalise
 * toute réponse `4xx` en erreur de console ; en rendre une à chaque chargement anonyme ferait d'un
 * état normal une anomalie. Une poignée qui ne désigne plus rien voit son cookie effacé.
 */
function aucuneSession(effacer: boolean, securise: boolean): Response {
	return repondre(204, null, effacer ? cookieEfface(securise) : undefined)
}

async function prolonger(requete: Request, d: DependancesSession, c: ConfigurationSession, echeance: number, securise: boolean): Promise<Response> {
	const poignee = lirePoignee(requete.headers.get('cookie'))
	if (poignee === null) return aucuneSession(false, securise)
	const empreinte = await empreinteDe(poignee)

	// La poignée désigne-t-elle une session vivante ? Sinon le cookie ne sert plus à rien.
	const lignes = await appelerBase(d, 'lire_session_serveur', { p_empreinte: empreinte }, echeance)
	const session = Array.isArray(lignes) ? objet(lignes[0]) : null
	if (session === null || typeof session.sub !== 'string' || typeof session.rafraichissement !== 'string') {
		return aucuneSession(true, securise)
	}
	const cle = await cleDeChiffrement(c.secretJwt)
	const rafraichissement = await dechiffrer(session.rafraichissement, cle)
	const fermer = () => appelerBase(d, 'fermer_session_serveur', { p_empreinte: empreinte }, echeance)
	if (rafraichissement === null) {
		await fermer()
		return aucuneSession(true, securise)
	}

	// §5.3, point 3 — le rafraîchissement, AVEC LE SECRET. Un refus de LeLabs clôt la session.
	const decouverte = await decouvrir(d, c, echeance)
	let jetons: JetonsObtenus
	try {
		jetons = await demanderJetons(
			d,
			decouverte.pointJeton,
			{ grant_type: 'refresh_token', client_id: c.clientId, client_secret: c.clientSecret, refresh_token: rafraichissement },
			new Refus('session_expiree'),
			echeance,
		)
	} catch (erreur) {
		if (erreur instanceof Refus && erreur.code === 'session_expiree') {
			await fermer()
			throw new RefusSession(erreur, true)
		}
		throw erreur
	}

	// §5.3, point 4 — le nouveau jeton, vérifié ; son `sub` doit être celui de la session.
	let identite: Identite
	try {
		identite = await verifierJetonAcces(jetons.acces, contexteVerification(d, c, decouverte, echeance))
		if (identite.sub !== session.sub.toLowerCase()) throw new Refus('jeton_refuse')
	} catch (erreur) {
		if (erreur instanceof Refus && erreur.code !== 'sso_injoignable') {
			await fermer()
			throw new RefusSession(erreur, true)
		}
		throw erreur
	}

	// §5.3, point 5 — l'admission rejouée EN ENTIER ; non admise, la base supprime la session.
	const renouvellement = objet(
		await appelerBase(
			d,
			'renouveler_session_serveur',
			{
				p_empreinte: empreinte,
				p_sub: identite.sub,
				p_email: identite.adresse,
				p_nom: identite.nom,
				p_rafraichissement: await chiffrer(jetons.rafraichissement, cle),
				p_expire_le: jetons.expireLe,
			},
			echeance,
		),
	)
	if (renouvellement === null || typeof renouvellement.admis !== 'boolean') throw new Refus('service_indisponible')
	if (renouvellement.session === false) return aucuneSession(true, securise)
	if (!renouvellement.admis) throw new RefusSession(new Refus('attente_espace', identite.adresse), true)

	return reponseSession(d, c, identite, renouvellement.nom)
}

async function fermer(requete: Request, d: DependancesSession, echeance: number, securise: boolean): Promise<Response> {
	const poignee = lirePoignee(requete.headers.get('cookie'))
	// Le cookie est effacé dans tous les cas ; une suppression en échec est dite, elle n'est pas tue.
	if (poignee !== null) {
		try {
			await d.appelerBase('fermer_session_serveur', { p_empreinte: await empreinteDe(poignee) }, echeance)
		} catch {
			throw new RefusSession(new Refus('service_indisponible'), true)
		}
	}
	return repondre(204, null, cookieEfface(securise))
}

// --- Point d'entrée ------------------------------------------------------------------------------

const EVENEMENT_SUCCES: Readonly<Record<Geste, string>> = {
	ouvrir: 'session_ouverte',
	prolonger: 'session_prolongee',
	fermer: 'session_fermee',
}

export async function traiterSession(requete: Request, d: DependancesSession): Promise<Response> {
	if (requete.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: ALLOW } })
	const debut = d.maintenantMs()
	const echeance = debut + ECHEANCE_GESTE_MS
	const conclure = (evenement: string, code: string) =>
		d.journaliser({ event: evenement, code, duree_ms: d.maintenantMs() - debut })
	const securise = origineSecurisee(requete.headers.get('origin'))

	const geste = gesteDe(new URL(requete.url).pathname)
	// Un corps que le geste ne lit pas est consommé quand même : un flux abandonné peut retenir un
	// isolate jusqu'à sa borne murale (décision 286).
	if (geste !== 'ouvrir' || requete.method !== 'POST') await requete.arrayBuffer().catch(() => undefined)
	const refuser = (refus: Refus, effacer = false): Response => {
		conclure('session_refusee', refus.code)
		return repondre(STATUT_REFUS[refus.code], refus.corps(), effacer ? cookieEfface(securise) : undefined)
	}
	if (geste === null) return refuser(new Refus('geste_inconnu'))
	if (requete.method !== 'POST') return refuser(new Refus('methode'))
	if (d.configuration === null) {
		conclure('session_refusee', 'configuration_absente')
		return repondre(502, new Refus('service_indisponible').corps())
	}

	try {
		const reponse =
			geste === 'ouvrir'
				? await ouvrir(requete, d, d.configuration, echeance, securise)
				: geste === 'prolonger'
					? await prolonger(requete, d, d.configuration, echeance, securise)
					: await fermer(requete, d, echeance, securise)
		if (geste === 'prolonger' && reponse.status === 204) conclure('session_absente', 'aucune')
		else conclure(EVENEMENT_SUCCES[geste], 'ok')
		return reponse
	} catch (erreur) {
		if (erreur instanceof RefusSession) return refuser(erreur, erreur.effacerCookie)
		return refuser(erreur instanceof Refus ? erreur : new Refus('service_indisponible'))
	}
}
