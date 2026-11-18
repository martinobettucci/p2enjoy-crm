// @spec CRM-156 (docs/BACKLOG.md) — tranche T3 : les actions groupées de l'inbox, côté écran — la description de la portée
//       envoyée à la base, le compte avant d'agir, l'action enchaînée par paquets, le compte rendu additionné et ses refus
// @spec docs/SPEC-mail-subsystem.md §32.2 (la description), §32.3 (le filtre explicite), §32.4 (compter), §32.5 (agir),
//       §32.5 bis (les paquets, le curseur, l'échec d'un paquet) ; docs/DESIGN_SYSTEM.md §5.109 ; docs/JOURNAL.md
//       décisions 944, 946 et 949
//
// Ce module ne rend rien : il DÉCRIT et APPELLE. Aucun droit n'y est appliqué — la base calcule la portée parmi ce que la
// personne voit, refuse « tout le filtre » sans filtre explicite, et passe chaque message par sa fonction unitaire
// (`CLAUDE.md` §10). L'écran n'offre « Tout sélectionner » que sous un filtre explicite : c'est une aide, pas la règle.

import { classerErreur, enErreur, pret, type EtatAsync, type ErreurDonnees } from './async'
import type { Json } from './database.types'
import type { ClientCrm } from './supabase'

/** Un fil coché : le couple `(workspace, clé de fil)`, jamais la clé seule (docs/SPEC-cards.md §16.15.3). */
export type FilCoche = { readonly workspaceId: string; readonly cleFil: string }

/** Le dossier de la portée : « Non classés », une affaire, ou la corbeille (§32.2). */
export type DossierGroupe =
	| { readonly genre: 'non-classes' }
	| { readonly genre: 'card'; readonly cardId: string }
	| { readonly genre: 'corbeille' }

/** Ce que la sélection désigne, tel que l'écran le connaît (§32.2). */
export type PorteeGroupee = {
	readonly dossier: DossierGroupe
	/** « Seulement moi » APPLIQUÉ (§27.4) : la case cochée ET une identité personnelle. */
	readonly seulementMoi: boolean
	/** Les pastilles du filtre rapide (`CRM-155`, le OU de la décision 943). */
	readonly pastilles: readonly string[]
	/** Le filtre par expéditeur (§32.9, T4) ; `null` sans filtre. */
	readonly expediteur: string | null
	/** Le mode de sommeil de la liste : les fils endormis sont-ils montrés ? */
	readonly sommeilVisible: boolean
	/** Les fils cochés, ou `null` pour TOUT LE FILTRE. */
	readonly fils: readonly FilCoche[] | null
	/** Dans la corbeille, les messages cochés. */
	readonly messages?: readonly string[]
}

/** Le filtre explicite qui ouvre « Tout sélectionner » (§32.3) — le dossier et le sommeil n'en sont pas. */
export const aUnFiltreExplicite = (portee: Pick<PorteeGroupee, 'seulementMoi' | 'pastilles' | 'expediteur'>): boolean =>
	portee.seulementMoi || portee.pastilles.length > 0 || (portee.expediteur !== null && portee.expediteur.trim() !== '')

/** La description JSON que la base lit (`p_scope`, §32.2), avec le curseur du paquet quand il y en a un (§32.5 bis). */
export function descriptionPortee(portee: PorteeGroupee, apres: Json | null = null): { [cle: string]: Json } {
	const dossier = portee.dossier
	const description: { [cle: string]: Json } = {
		folder: dossier.genre === 'non-classes' ? 'unclassified' : dossier.genre === 'card' ? 'card' : 'trash',
		only_me: portee.seulementMoi,
		label_ids: [...portee.pastilles],
		snoozed: portee.sommeilVisible ? 'shown' : 'hidden',
		threads: portee.fils === null ? null : portee.fils.map((fil) => ({ workspace_id: fil.workspaceId, thread_key: fil.cleFil })),
	}
	if (dossier.genre === 'card') description['card_id'] = dossier.cardId
	if (portee.expediteur !== null && portee.expediteur.trim() !== '') description['sender'] = portee.expediteur.trim()
	if (dossier.genre === 'corbeille') description['message_ids'] = [...(portee.messages ?? [])]
	if (apres !== null) description['after'] = apres
	return description
}

// =================================================================================================
// Les actions — §32.5
// =================================================================================================

/** Une action groupée et son argument. */
export type ActionGroupee =
	| { readonly genre: 'mark_read' }
	| { readonly genre: 'mark_unread' }
	| { readonly genre: 'snooze'; readonly jusqua: string }
	| { readonly genre: 'wake' }
	| { readonly genre: 'classify'; readonly cardId: string }
	| { readonly genre: 'unclassify' }
	| { readonly genre: 'set_label'; readonly pastille: string; readonly posee: boolean }
	| { readonly genre: 'request_label_evaluation' }
	| { readonly genre: 'delete'; readonly partout: boolean }
	| { readonly genre: 'restore' }

/** Le nom de l'action pour la base, et son argument (`p_action`, `p_argument`). */
export function appelAction(action: ActionGroupee): { readonly p_action: string; readonly p_argument: { [cle: string]: Json } } {
	switch (action.genre) {
		case 'snooze':
			return { p_action: 'snooze', p_argument: { until: action.jusqua } }
		case 'classify':
			return { p_action: 'classify', p_argument: { card_id: action.cardId } }
		case 'set_label':
			return { p_action: 'set_label', p_argument: { label_id: action.pastille, applied: action.posee } }
		case 'delete':
			return { p_action: 'delete', p_argument: { also_mailbox: action.partout } }
		default:
			return { p_action: action.genre, p_argument: {} }
	}
}

/** Le sommeil porte sur des FILS, les autres actions sur des messages (§32.5) : ce que « fait » compte. */
export const actionParFil = (action: ActionGroupee): boolean => action.genre === 'snooze' || action.genre === 'wake'

// =================================================================================================
// Compter — §32.4
// =================================================================================================

export type ComptePortee = { readonly fils: number; readonly messages: number }

/** Le compte de la portée, lu en base au moment de confirmer — jamais un compte de la page. */
export async function compterPortee(client: ClientCrm | null, portee: PorteeGroupee): Promise<EtatAsync<ComptePortee>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration absente'))
	try {
		const reponse = await client.rpc('inbox_bulk_count', { p_scope: descriptionPortee(portee) })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const ligne = reponse.data?.[0]
		return pret({ fils: ligne?.thread_count ?? 0, messages: ligne?.message_count ?? 0 })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// =================================================================================================
// Agir par paquets — §32.5 bis
// =================================================================================================

/** Le compte rendu, additionné sur les paquets. */
export type CompteRendu = {
	readonly fils: number
	readonly messages: number
	readonly faits: number
	/** Les refus nommés : code de la base → nombre. */
	readonly refus: Readonly<Record<string, number>>
	/** Le paquet en échec, s'il y en a eu un : les précédents restent faits (§32.5 bis). */
	readonly interruption: ErreurDonnees | null
}

/** La forme rendue par `inbox_bulk_apply` pour un paquet. */
type Paquet = {
	readonly threads?: number
	readonly messages?: number
	readonly done?: number
	readonly refused?: Readonly<Record<string, number>>
	readonly next?: Json | null
}

/** Additionne un paquet au compte rendu. */
export function additionner(total: CompteRendu, paquet: Paquet): CompteRendu {
	const refus: Record<string, number> = { ...total.refus }
	for (const [code, nombre] of Object.entries(paquet.refused ?? {})) refus[code] = (refus[code] ?? 0) + nombre
	return {
		fils: total.fils + (paquet.threads ?? 0),
		messages: total.messages + (paquet.messages ?? 0),
		faits: total.faits + (paquet.done ?? 0),
		refus,
		interruption: total.interruption,
	}
}

export const COMPTE_RENDU_VIDE: CompteRendu = { fils: 0, messages: 0, faits: 0, refus: {}, interruption: null }

/**
 * Applique l'action à la portée, paquet après paquet, jusqu'à `next` nul (§32.5 bis). `onPaquet` reçoit le compte rendu
 * après chaque paquet — c'est la progression. Un paquet en échec arrête la suite : les précédents sont faits, et le compte
 * rendu le dit par `interruption`.
 *
 * LA BORNE DE SÛRETÉ — 10 000 paquets, soit vingt millions de messages — n'est pas un plafond de produit (décision 946) :
 * elle empêche seulement une base qui rendrait toujours le même curseur de faire tourner l'écran sans fin.
 */
export async function appliquerParPaquets(
	client: ClientCrm | null,
	portee: PorteeGroupee,
	action: ActionGroupee,
	onPaquet: (courant: CompteRendu) => void = () => undefined,
): Promise<CompteRendu> {
	let total = COMPTE_RENDU_VIDE
	if (client === null) return { ...total, interruption: classerErreur(undefined, 'configuration absente') }
	const { p_action, p_argument } = appelAction(action)
	let apres: Json | null = null
	for (let tour = 0; tour < 10_000; tour += 1) {
		try {
			const reponse = await client.rpc('inbox_bulk_apply', {
				p_scope: descriptionPortee(portee, apres),
				p_action,
				p_argument,
			})
			if (reponse.error !== null) {
				return { ...total, interruption: classerErreur(reponse.status, reponse.error.message) }
			}
			const paquet = (reponse.data ?? {}) as Paquet
			total = additionner(total, paquet)
			onPaquet(total)
			if (paquet.next === null || paquet.next === undefined) return total
			if (JSON.stringify(paquet.next) === JSON.stringify(apres)) return total
			apres = paquet.next
		} catch (cause) {
			return { ...total, interruption: classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)) }
		}
	}
	return total
}

/** Le nombre total de refus d'un compte rendu. */
export const nombreRefus = (compte: CompteRendu): number => Object.values(compte.refus).reduce((a, b) => a + b, 0)
