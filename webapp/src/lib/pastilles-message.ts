// @spec CRM-141 (docs/BACKLOG.md) — tranche T4 : les pastilles d'un mail dans l'inbox — lire ce qu'un message porte, son
//       origine et son état d'évaluation ; poser ou retirer une pastille à la main ; demander une réévaluation ; classer les
//       refus ; résoudre les pastilles posées d'une ligne de liste
// @spec docs/SPEC-mail-subsystem.md §31.2 (`mail_message_labels`, `mail_label_evaluations`), §31.4 (`set_message_label`,
//       `request_label_evaluation` et leurs refus nommés), §31.7 (l'écran) ; docs/DESIGN_SYSTEM.md §5.103 ;
//       docs/JOURNAL.md décision 926 ; CLAUDE.md §10 — ce module ne décide AUCUN droit : il demande, et la base tranche
//
// Ce module ne rend rien : il lit, écrit et classe.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { PastilleMail } from './pastilles-mail'
import type { ClientCrm } from './supabase'

/** L'origine d'une ligne : posée par l'évaluation, ou choisie à la main — qui l'emporte toujours (§31.4). */
export type OriginePastille = 'llm' | 'manual'

/** Une ligne de `mail_message_labels` : une pastille posée ou, à la main seulement, retirée. */
export type PoseDeMessage = {
	readonly idPastille: string
	readonly origine: OriginePastille
	readonly appliquee: boolean
}

/** L'état de la file pour ce message ; `null` pour un message qui n'y est pas — un mail envoyé. */
export type EtatEvaluation = 'pending' | 'done' | 'failed' | null

export type PastillesDuMessage = {
	readonly poses: readonly PoseDeMessage[]
	readonly evaluation: EtatEvaluation
}

const ETATS: readonly string[] = ['pending', 'done', 'failed']

/** Projette les lignes lues ; une origine ou un état inconnus ne sont jamais devinés. */
export function projeterPastillesDuMessage(
	lignes: readonly { readonly label_id: string; readonly source: string; readonly applied: boolean }[],
	etat: string | null,
): PastillesDuMessage {
	return {
		poses: lignes
			.filter((l) => l.source === 'llm' || l.source === 'manual')
			.map((l) => ({ idPastille: l.label_id, origine: l.source as OriginePastille, appliquee: l.applied })),
		evaluation: etat !== null && ETATS.includes(etat) ? (etat as EtatEvaluation) : null,
	}
}

/** Les pastilles d'un message, posées ou retirées, et l'état de son évaluation : deux lectures, que la RLS borne. */
export async function lirePastillesDuMessage(
	client: ClientCrm,
	idMessage: string,
): Promise<EtatAsync<PastillesDuMessage>> {
	try {
		const [poses, evaluation] = await Promise.all([
			client.from('mail_message_labels').select('label_id, source, applied').eq('message_id', idMessage),
			client.from('mail_label_evaluations').select('state').eq('message_id', idMessage).limit(1),
		])
		if (poses.error !== null) return enErreur(classerErreur(poses.status, poses.error.message))
		if (evaluation.error !== null) return enErreur(classerErreur(evaluation.status, evaluation.error.message))
		return pret(projeterPastillesDuMessage(poses.data ?? [], evaluation.data?.[0]?.state ?? null))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les gestes, et leurs refus — dictionnaire fermé (§31.4)
// ---------------------------------------------------------------------------------------------

export type NatureRefusGestePastille =
	/** `404 message_not_found` : inconnu, en corbeille ou illisible — indiscernables. */
	| 'message-introuvable'
	/** `42501` ou `403` : l'appelant n'édite pas l'espace du message. */
	| 'forbidden'
	/** `404 label_not_found` : la pastille n'existe plus, ou n'est pas de cet espace. */
	| 'pastille-introuvable'
	/** `label_archived` : une archivée ne se pose plus. */
	| 'pastille-archivee'
	/** `outbound_message` : un mail envoyé n'est pas évalué. */
	| 'mail-envoye'
	| 'network'
	| 'unknown'

export function classerRefusGestePastille(
	statutHttp: number | undefined,
	code: string | undefined,
	message: string | undefined,
): NatureRefusGestePastille {
	if (message === 'message_not_found') return 'message-introuvable'
	if (message === 'label_not_found') return 'pastille-introuvable'
	if (message === 'label_archived') return 'pastille-archivee'
	if (message === 'outbound_message') return 'mail-envoye'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueGestePastille =
	| { readonly statut: 'applique' }
	| { readonly statut: 'refus'; readonly nature: NatureRefusGestePastille }

type ReponseRpc = {
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseRpc>): Promise<IssueGestePastille> {
	try {
		const reponse = await appel()
		if (reponse.error === null) return { statut: 'applique' }
		return {
			statut: 'refus',
			nature: classerRefusGestePastille(reponse.status, reponse.error.code, reponse.error.message),
		}
	} catch {
		return { statut: 'refus', nature: 'network' }
	}
}

/** Pose (`appliquee`) ou retire une pastille — toujours un choix manuel, que la réévaluation ne défait pas. */
export function poserPastilleMessage(
	client: ClientCrm,
	idMessage: string,
	idPastille: string,
	appliquee: boolean,
): Promise<IssueGestePastille> {
	return executer(() =>
		client.rpc('set_message_label', { p_message_id: idMessage, p_label_id: idPastille, p_applied: appliquee }),
	)
}

/** « Réévaluer les pastilles » : le message repasse en attente, en tête de file. Aucun choix manuel n'est retiré. */
export function demanderReevaluation(client: ClientCrm, idMessage: string): Promise<IssueGestePastille> {
	return executer(() => client.rpc('request_label_evaluation', { p_message_id: idMessage }))
}

// ---------------------------------------------------------------------------------------------
// La liste des mails
// ---------------------------------------------------------------------------------------------

/** Les identifiants des pastilles POSÉES d'une ligne de liste — une ligne retirée à la main n'en est pas. */
export function idsPosees(
	lignes: readonly { readonly label_id: string; readonly applied: boolean }[] | null | undefined,
): readonly string[] {
	return (lignes ?? []).filter((l) => l.applied).map((l) => l.label_id)
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr', { sensitivity: 'base' })

/**
 * Les pastilles d'identifiants donnés, dans l'ordre du nom (§5.103). Une pastille absente du catalogue lu — d'un espace
 * qu'on ne lit plus — est omise : l'écran ne montre jamais une pilule sans nom.
 */
export function resoudrePastilles(
	ids: readonly string[],
	catalogue: ReadonlyMap<string, PastilleMail>,
): readonly PastilleMail[] {
	return ids
		.map((id) => catalogue.get(id))
		.filter((p): p is PastilleMail => p !== undefined)
		.sort((a, b) => compare(a.nom, b.nom) || compare(a.id, b.id))
}
