// @spec CRM-136 (docs/BACKLOG.md) — tranche T3 : le succès d'un test porte les dossiers de la boîte, s'ils sont rendus
//       (docs/SPEC-mail-subsystem.md §25.3, §25.5)
// @spec CRM-127 (docs/BACKLOG.md) — tranche T4 : ce que le bouton « Tester la connexion » envoie, et ce qu'il comprend
// @spec docs/SPEC-mail-subsystem.md §23.4 (la fonction edge `mail-connection-test` et ses codes), §23.5 (le verdict et
//       les refus traduits, jamais le code brut) ; docs/SPEC-webapp.md §6.4 (une panne n'est jamais un succès) ;
//       CLAUDE.md §10 (le droit est décidé par la base, l'écran ne calcule rien)
//
// Module sans React : l'écran appelle `testerConnexion`, puis relit la liste. Le verdict rendu ici ne remplace jamais la
// pilule : il dit ce qui vient de se passer, la pilule dit ce que la base retient.

import { cleAnonymeCrm, porteurJeton, urlApiCrm } from './supabase'

export type CibleTest = 'inbound' | 'outbound'

/** Les six codes de `mail_inbound_accounts_erreur_code` (§13.7), les seuls qu'un verdict puisse porter. */
export const CODES_INCIDENT = [
	'auth_failed',
	'host_unreachable',
	'connection_refused',
	'tls_failed',
	'timeout',
	'protocol_error',
] as const
export type CodeIncident = (typeof CODES_INCIDENT)[number]

export function estCodeIncident(code: unknown): code is CodeIncident {
	return typeof code === 'string' && (CODES_INCIDENT as readonly string[]).includes(code)
}

/** Ce que l'écran sait dire après un test (§23.5). */
export type IssueTest =
	/** `CRM-136` (§25.3) : `dossiers`, les dossiers sélectionnables d'une boîte entrante, quand la fonction les rend. */
	| { readonly type: 'reussi'; readonly dossiers?: readonly string[] }
	| { readonly type: 'echoue'; readonly incident: CodeIncident | null }
	| { readonly type: 'refuse'; readonly motif: MotifRefusTest }

export type MotifRefusTest = 'trop_tot' | 'introuvable' | 'desactivee' | 'secret_absent' | 'session' | 'service'

export type AccesTest = {
	readonly url: string
	readonly cleAnonyme: string
	readonly jeton: () => string | null
	readonly requete?: (url: string, init?: RequestInit) => Promise<Response>
}

export const accesTestCrm: AccesTest | null =
	urlApiCrm === null || cleAnonymeCrm === null ? null : { url: urlApiCrm, cleAnonyme: cleAnonymeCrm, jeton: () => porteurJeton.lire() }

/** Les codes HTTP de la fonction (§23.4), et ce que chacun veut dire pour l'écran. */
const MOTIFS: Readonly<Record<number, MotifRefusTest>> = {
	401: 'session',
	404: 'introuvable',
	429: 'trop_tot',
}

/** Traduit la réponse de la fonction en issue d'écran. Une réponse inattendue est une panne, jamais un succès. */
export async function issueDepuisReponse(reponse: Response): Promise<IssueTest> {
	let corps: Record<string, unknown> = {}
	try {
		corps = (await reponse.json()) as Record<string, unknown>
	} catch {
		return { type: 'refuse', motif: 'service' }
	}
	if (reponse.status === 200) {
		if (corps.status === 'ok') {
			const noms = corps.folder_names
			// Une liste mal formée n'est pas une liste : l'issue reste un succès, sans dossiers (§25.3).
			return Array.isArray(noms) && noms.every((nom) => typeof nom === 'string')
				? { type: 'reussi', dossiers: noms as string[] }
				: { type: 'reussi' }
		}
		if (corps.status === 'error') return { type: 'echoue', incident: estCodeIncident(corps.error) ? corps.error : null }
		return { type: 'refuse', motif: 'service' }
	}
	if (reponse.status === 409) {
		return { type: 'refuse', motif: corps.error === 'disabled' ? 'desactivee' : corps.error === 'secret_missing' ? 'secret_absent' : 'service' }
	}
	return { type: 'refuse', motif: MOTIFS[reponse.status] ?? 'service' }
}

/** `POST /functions/v1/mail-connection-test` (§23.4). Ne lève jamais : une panne réseau est le motif `service`. */
export async function testerConnexion(acces: AccesTest | null, cible: CibleTest, id: string): Promise<IssueTest> {
	if (acces === null) return { type: 'refuse', motif: 'service' }
	const jeton = acces.jeton()
	if (jeton === null) return { type: 'refuse', motif: 'session' }
	try {
		const reponse = await (acces.requete ?? fetch)(`${acces.url.replace(/\/+$/, '')}/functions/v1/mail-connection-test`, {
			method: 'POST',
			headers: { apikey: acces.cleAnonyme, authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
			body: JSON.stringify({ target: cible, id }),
		})
		return await issueDepuisReponse(reponse)
	} catch {
		return { type: 'refuse', motif: 'service' }
	}
}
