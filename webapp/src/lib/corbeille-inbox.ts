// @spec CRM-138 (docs/BACKLOG.md) — tranche T3 : la corbeille de l'inbox côté webapp — effacer le message ouvert
//       (`delete_message`, la case « boîte mail » en option), lire la corbeille visible (`trashed_messages`), restaurer
//       (`restore_message`), l'état des déplacements IMAP en toutes lettres, et le dictionnaire fermé des refus
// @spec docs/SPEC-mail-subsystem.md §29.1 (ce que voit la personne, précisé avant le code de T3), §29.3, §29.4, §29.5
//       (les trois états du déplacement) ; docs/DESIGN_SYSTEM.md §5.102 ; docs/JOURNAL.md décisions 878, 917 et 921
//
// CE MODULE N'OUVRE AUCUNE RÈGLE. Qui peut effacer, ce que la corbeille montre et qui peut restaurer sont décidés par les
// trois fonctions de la base (`0180`) ; la case « boîte mail » suit la colonne calculée `mailbox_trash_permitted` (`0181`),
// lue avec le message ouvert. L'écran appuie et traduit le refus.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { OBJET_ABSENT } from './inbox'
import type { ClientCrm } from './supabase'

/** La valeur de la clé `corbeille` dans l'adresse quand le dossier est ouvert (§5.102). */
export const PARAMETRE_CORBEILLE = 'corbeille'
export const VALEUR_CORBEILLE = 'oui'

/** La valeur d'adresse lue défensivement : seule `oui` ouvre la corbeille. */
export const corbeilleDepuisAdresse = (valeur: string | null): boolean => valeur === VALEUR_CORBEILLE

/** L'état agrégé des déplacements IMAP d'un message effacé (§29.5). */
export type EtatDeplacement = 'aucun' | 'fait' | 'attente' | 'echec'

/** Les motifs d'un déplacement impossible, écrits par `mail-sync` (`corbeille.py`) ; tout autre code est « inconnu ». */
export type MotifDeplacement =
	| 'no_trash_folder'
	| 'move_unsupported'
	| 'account_not_found'
	| 'auth_failed'
	| 'timeout'
	| 'tls_failed'
	| 'connection_failed'
	| 'inconnu'

const MOTIFS: readonly MotifDeplacement[] = [
	'no_trash_folder',
	'move_unsupported',
	'account_not_found',
	'auth_failed',
	'timeout',
	'tls_failed',
	'connection_failed',
]

/** Un code de la base, ramené au dictionnaire fermé : jamais le code brut à l'écran. */
export function classerMotifDeplacement(code: string | null): MotifDeplacement | null {
	if (code === null || code.trim() === '') return null
	return MOTIFS.find((motif) => motif === code) ?? 'inconnu'
}

/** Un message de la corbeille, tel que la liste le montre (§5.102). */
export type MessageEnCorbeille = {
	readonly id: string
	readonly objet: string
	readonly expediteur: string
	readonly cardId: string | null
	readonly effaceLe: string
	/** Le nom de qui l'a effacé ; `null` quand le profil est détaché — l'écran écrit « Auteur inconnu ». */
	readonly effacePar: string | null
	/** La date d'effacement définitif ; `null` quand la base ne l'a pas rendue — l'écran écrit « Inconnue ». */
	readonly purgeLe: string | null
	readonly deplacement: EtatDeplacement
	readonly motifDeplacement: MotifDeplacement | null
}

/** La ligne rendue par `trashed_messages` (`0180`), réduite à ce que l'écran lit. */
export type LigneCorbeille = {
	readonly message_id: string
	readonly subject: string | null
	readonly from_address: string
	readonly from_name: string | null
	readonly card_id: string | null
	readonly deleted_at: string
	readonly deleted_by_name: string | null
	readonly purge_at: string | null
	readonly moves_pending: number | null
	readonly moves_done: number | null
	readonly moves_failed: number | null
	readonly last_move_error: string | null
}

/**
 * L'état agrégé, quand un message figurait dans plusieurs boîtes : un échec se dit d'abord — il est le seul qui ne se
 * résoudra pas seul —, puis l'attente, puis le fait. Sans aucun déplacement demandé, rien n'est écrit.
 */
export function etatDeplacement(ligne: Pick<LigneCorbeille, 'moves_pending' | 'moves_done' | 'moves_failed'>): EtatDeplacement {
	if ((ligne.moves_failed ?? 0) > 0) return 'echec'
	if ((ligne.moves_pending ?? 0) > 0) return 'attente'
	if ((ligne.moves_done ?? 0) > 0) return 'fait'
	return 'aucun'
}

export function projeterCorbeille(ligne: LigneCorbeille): MessageEnCorbeille {
	const deplacement = etatDeplacement(ligne)
	const nom = ligne.from_name?.trim() ?? ''
	return {
		id: ligne.message_id,
		objet: ligne.subject !== null && ligne.subject.trim() !== '' ? ligne.subject : OBJET_ABSENT,
		expediteur: nom !== '' ? `${nom} <${ligne.from_address}>` : ligne.from_address,
		cardId: ligne.card_id,
		effaceLe: ligne.deleted_at,
		effacePar: ligne.deleted_by_name?.trim() ? ligne.deleted_by_name.trim() : null,
		purgeLe: ligne.purge_at,
		deplacement,
		motifDeplacement: deplacement === 'echec' ? (classerMotifDeplacement(ligne.last_move_error) ?? 'inconnu') : null,
	}
}

/** La corbeille visible de la personne dans l'espace (§29.4) : les siens, ou tout l'espace pour qui l'administre. */
export async function lireCorbeilleMessages(
	client: ClientCrm | null,
	idWorkspace: string,
): Promise<EtatAsync<readonly MessageEnCorbeille[]>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration absente'))
	try {
		const reponse = await client.rpc('trashed_messages', { p_workspace_id: idWorkspace })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as readonly LigneCorbeille[]
		return pret([...lignes].sort((a, b) => b.deleted_at.localeCompare(a.deleted_at)).map(projeterCorbeille))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// =================================================================================================
// Les deux gestes et leurs refus — §29.3, §29.4
// =================================================================================================

/** Le dictionnaire fermé des refus (§5.102) : introuvable, refusé, aucune boîte inscriptible, réseau, inconnu. */
export type RefusCorbeille = 'introuvable' | 'refuse' | 'aucune_boite' | 'reseau' | 'inconnu'

const REFUS_PAR_MESSAGE: Readonly<Record<string, RefusCorbeille>> = {
	message_not_found: 'introuvable',
	forbidden: 'refuse',
	not_authenticated: 'refuse',
	no_writable_mailbox: 'aucune_boite',
}

export function classerRefusCorbeille(statutHttp: number | undefined, message: string): RefusCorbeille {
	const connu = REFUS_PAR_MESSAGE[message]
	if (connu !== undefined) return connu
	if (statutHttp === 404) return 'introuvable'
	if (statutHttp === 401 || statutHttp === 403) return 'refuse'
	// Le client rend un statut nul quand la requête n'a pas atteint le serveur.
	if (statutHttp === 0) return 'reseau'
	return 'inconnu'
}

async function appeler(
	client: ClientCrm | null,
	geste: (
		client: ClientCrm,
	) => PromiseLike<{ readonly error: { readonly message: string } | null; readonly status: number }>,
): Promise<RefusCorbeille | null> {
	if (client === null) return 'inconnu'
	try {
		const reponse = await geste(client)
		return reponse.error === null ? null : classerRefusCorbeille(reponse.status, reponse.error.message)
	} catch {
		return 'reseau'
	}
}

/** Efface le message ouvert, et avec `aussiBoite` demande son déplacement dans la corbeille de ses boîtes (§29.3). */
export const effacerMessage = (client: ClientCrm | null, idMessage: string, aussiBoite: boolean) =>
	appeler(client, (c) => c.rpc('delete_message', { p_message_id: idMessage, p_also_mailbox: aussiBoite }))

/** Restaure un message de la corbeille visible (§29.4). */
export const restaurerMessage = (client: ClientCrm | null, idMessage: string) =>
	appeler(client, (c) => c.rpc('restore_message', { p_message_id: idMessage }))
