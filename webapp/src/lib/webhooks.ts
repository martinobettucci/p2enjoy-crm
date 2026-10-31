// @spec CRM-073 (docs/BACKLOG.md) — tranche T3 : lire les webhooks d'un espace et leur dernière remise, les créer, les
//       modifier, régénérer leur secret, les supprimer ; lire l'historique des remises et renvoyer une remise ; classer les refus
// @spec docs/SPEC-webhooks.md §3 (les neuf événements, pas de contact sous filtre de channel), §4.1, §4.2, §5.3, §7, §12 ;
//       docs/DESIGN_SYSTEM.md §5.79
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : la RLS de `webhook_endpoints` et les fonctions de la base
//       tranchent, et leurs refus sont classés ici
//
// Ce module ne rend rien : il lit, écrit et classe les refus.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Les neuf événements, dans l'ordre de l'écran (§3) : les affaires, puis les contacts. */
export const EVENEMENTS_AFFAIRE = [
	'card.created',
	'card.step_changed',
	'card.owner_changed',
	'card.archived',
	'card.trashed',
	'card.restored',
] as const
export const EVENEMENTS_CONTACT = ['contact.created', 'contact.updated', 'contact.deleted'] as const
export type EvenementWebhook = (typeof EVENEMENTS_AFFAIRE)[number] | (typeof EVENEMENTS_CONTACT)[number]
export const EVENEMENTS: readonly EvenementWebhook[] = [...EVENEMENTS_AFFAIRE, ...EVENEMENTS_CONTACT]

/** Les remises gardées par l'historique, les plus récentes d'abord (§5.79). */
export const LIMITE_HISTORIQUE = 50

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_WEBHOOK =
	'id, name, url, events, channel_id, enabled, created_at, derniere:webhook_deliveries(status, created_at)'
export const COLONNES_REMISE =
	'id, event, status, attempts, last_status_code, last_error, last_attempt_at, created_at, payload'

export type EtatRemise = 'pending' | 'delivered' | 'failed'
export type MotifRemise = 'timeout' | 'connection_refused' | 'address_forbidden' | 'tls_error' | 'dns_error' | 'network_error'

export type Webhook = {
	readonly id: string
	readonly nom: string
	readonly url: string
	/** L'hôte seul : l'adresse entière peut porter un jeton, et l'écran ne la montre pas en liste (§6, §5.79). */
	readonly hote: string
	readonly evenements: readonly EvenementWebhook[]
	readonly idChannel: string | null
	readonly actif: boolean
	readonly derniere: { readonly etat: EtatRemise; readonly le: string } | null
}

export type Remise = {
	readonly id: string
	readonly evenement: EvenementWebhook
	readonly etat: EtatRemise
	readonly essais: number
	readonly codeHttp: number | null
	readonly motif: MotifRemise | null
	readonly le: string
	readonly corps: unknown
}

type WebhookLu = {
	readonly id: string
	readonly name: string
	readonly url: string
	readonly events: readonly string[]
	readonly channel_id: string | null
	readonly enabled: boolean
	readonly created_at: string
	readonly derniere: readonly { readonly status: string; readonly created_at: string }[] | null
}

type RemiseLue = {
	readonly id: string
	readonly event: string
	readonly status: string
	readonly attempts: number
	readonly last_status_code: number | null
	readonly last_error: string | null
	readonly last_attempt_at: string | null
	readonly created_at: string
	readonly payload: unknown
}

const estEvenement = (valeur: string): valeur is EvenementWebhook => (EVENEMENTS as readonly string[]).includes(valeur)
const etatDe = (valeur: string): EtatRemise => (valeur === 'delivered' || valeur === 'failed' ? valeur : 'pending')
const MOTIFS: readonly MotifRemise[] = ['timeout', 'connection_refused', 'address_forbidden', 'tls_error', 'dns_error', 'network_error']

/** L'hôte d'une adresse ; une adresse illisible se rend telle quelle, la base ayant déjà imposé `https://`. */
export function hoteDe(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

export function projeterWebhook(ligne: WebhookLu): Webhook {
	const derniere = ligne.derniere?.[0]
	return {
		id: ligne.id,
		nom: ligne.name,
		url: ligne.url,
		hote: hoteDe(ligne.url),
		// L'ordre de l'écran, et non celui du tableau stocké ; une valeur inconnue est écartée.
		evenements: EVENEMENTS.filter((e) => ligne.events.includes(e)),
		idChannel: ligne.channel_id,
		actif: ligne.enabled,
		derniere: derniere === undefined ? null : { etat: etatDe(derniere.status), le: derniere.created_at },
	}
}

export function projeterRemise(ligne: RemiseLue): Remise | null {
	if (!estEvenement(ligne.event)) return null
	return {
		id: ligne.id,
		evenement: ligne.event,
		etat: etatDe(ligne.status),
		essais: ligne.attempts,
		codeHttp: ligne.last_status_code,
		motif: (MOTIFS as readonly string[]).includes(ligne.last_error ?? '') ? (ligne.last_error as MotifRemise) : null,
		le: ligne.created_at,
		corps: ligne.payload,
	}
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr', { sensitivity: 'base' })

/** Les webhooks de l'espace, par nom, chacun avec sa remise la plus récente. La RLS les borne à l'administrateur. */
export async function lireWebhooks(client: ClientCrm, idWorkspace: string): Promise<EtatAsync<readonly Webhook[]>> {
	try {
		const reponse = await client
			.from('webhook_endpoints')
			.select(COLONNES_WEBHOOK)
			.eq('workspace_id', idWorkspace)
			.order('created_at', { referencedTable: 'webhook_deliveries', ascending: false })
			.limit(1, { referencedTable: 'webhook_deliveries' })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			((reponse.data ?? []) as unknown as readonly WebhookLu[])
				.map(projeterWebhook)
				.sort((a, b) => compare(a.nom, b.nom) || compare(a.id, b.id)),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les 50 remises les plus récentes d'un webhook (§5.79). */
export async function lireRemises(client: ClientCrm, idWebhook: string): Promise<EtatAsync<readonly Remise[]>> {
	try {
		const reponse = await client
			.from('webhook_deliveries')
			.select(COLONNES_REMISE)
			.eq('endpoint_id', idWebhook)
			.order('created_at', { ascending: false })
			.order('id', { ascending: false })
			.limit(LIMITE_HISTORIQUE)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			((reponse.data ?? []) as unknown as readonly RemiseLue[])
				.map(projeterRemise)
				.filter((r): r is Remise => r !== null),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusWebhook =
	/** `23514` sur l'adresse : elle n'est pas en `https://`, ou trop longue. */
	| 'adresse'
	/** `23514` sur le nom : blanc ou de plus de 80 caractères. */
	| 'nom'
	/** `23514` sur les événements : aucun, un doublon, ou un événement de contact sous filtre de channel. */
	| 'evenements'
	/** `23503` : le channel n'est pas de l'espace, ou n'existe plus. */
	| 'channel'
	/** `P0001 delivery_pending` : une remise en attente se réessaie d'elle-même. */
	| 'en-attente'
	/** `P0001 webhook_disabled` : un webhook désactivé n'inscrit plus de remise. */
	| 'desactive'
	/** `401`, `403`, `42501` : réservé à l'administrateur de l'espace. */
	| 'forbidden'
	/** `P0002`, ou `200` et zéro ligne : le webhook ou la remise n'est plus lisible. */
	| 'introuvable'
	| 'network'
	| 'unknown'

export function classerRefusWebhook(statutHttp: number | undefined, code: string | undefined, message: string): NatureRefusWebhook {
	if (code === '23514') {
		if (message.includes('url_check')) return 'adresse'
		if (message.includes('name_check')) return 'nom'
		return 'evenements'
	}
	if (code === '23503') return 'channel'
	if (message === 'delivery_pending') return 'en-attente'
	if (message === 'webhook_disabled') return 'desactive'
	if (code === 'P0002' || message === 'webhook_not_found' || message === 'delivery_not_found') return 'introuvable'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueWebhook<T = undefined> =
	| { readonly statut: 'applique'; readonly valeur: T }
	| { readonly statut: 'refus'; readonly nature: NatureRefusWebhook }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer<T>(appel: () => PromiseLike<ReponseBrute>, lire: (data: unknown) => T | null): Promise<IssueWebhook<T>> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return { statut: 'refus', nature: classerRefusWebhook(reponse.status, reponse.error.code, reponse.error.message) }
		}
		const valeur = lire(reponse.data)
		return valeur === null ? { statut: 'refus', nature: 'introuvable' } : { statut: 'applique', valeur }
	} catch (cause) {
		return {
			statut: 'refus',
			nature: classerRefusWebhook(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

const uneLigne = (data: unknown): true | null => (Array.isArray(data) && data.length > 0 ? true : null)

export type SaisieWebhook = {
	readonly nom: string
	readonly url: string
	readonly evenements: readonly EvenementWebhook[]
	readonly idChannel: string | null
	readonly actif: boolean
}

/** Crée un webhook ; la base rend son identifiant et son secret, montré une seule fois (§4.1). */
export function creerWebhook(
	client: ClientCrm,
	idWorkspace: string,
	saisie: SaisieWebhook,
): Promise<IssueWebhook<{ readonly id: string; readonly secret: string }>> {
	return executer(
		() =>
			client.rpc('create_webhook_endpoint', {
				p_workspace: idWorkspace,
				p_name: saisie.nom,
				p_url: saisie.url.trim(),
				p_events: [...saisie.evenements],
				p_channel: saisie.idChannel ?? undefined,
				p_enabled: saisie.actif,
			}),
		(data) => {
			const ligne = Array.isArray(data) ? (data[0] as { id?: string; secret?: string } | undefined) : undefined
			return ligne?.id && ligne.secret ? { id: ligne.id, secret: ligne.secret } : null
		},
	)
}

/** Modifie un webhook sous la RLS ; zéro ligne rendue est un refus (`introuvable`), jamais un succès. */
export function modifierWebhook(client: ClientCrm, idWebhook: string, saisie: SaisieWebhook): Promise<IssueWebhook<true>> {
	return executer(
		() =>
			client
				.from('webhook_endpoints')
				.update({
					name: saisie.nom.trim(),
					url: saisie.url.trim(),
					events: [...saisie.evenements],
					channel_id: saisie.idChannel,
					enabled: saisie.actif,
				})
				.eq('id', idWebhook)
				.select('id'),
		uneLigne,
	)
}

export function supprimerWebhook(client: ClientCrm, idWebhook: string): Promise<IssueWebhook<true>> {
	return executer(() => client.from('webhook_endpoints').delete().eq('id', idWebhook).select('id'), uneLigne)
}

/** Régénère le secret ; le nouveau est rendu une seule fois, l'ancien cesse aussitôt de signer (§4.1). */
export function regenererSecret(client: ClientCrm, idWebhook: string): Promise<IssueWebhook<string>> {
	return executer(
		() => client.rpc('rotate_webhook_secret', { p_endpoint: idWebhook }),
		(data) => (typeof data === 'string' && data !== '' ? data : null),
	)
}

/** Renvoie une remise close : une nouvelle remise du même corps (§5.3). */
export function renvoyerRemise(client: ClientCrm, idRemise: string): Promise<IssueWebhook<string>> {
	return executer(
		() => client.rpc('redeliver_webhook', { p_delivery: idRemise }),
		(data) => (typeof data === 'string' && data !== '' ? data : null),
	)
}
