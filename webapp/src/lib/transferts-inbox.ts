// @spec CRM-156 (docs/BACKLOG.md) — tranche T4 : le transfert d'un mail à un membre, côté écran — lire les transferts d'un
//       message, transférer, retirer, et traduire les refus ; les expéditeurs bloqués (lire, compter l'effet, bloquer,
//       débloquer) ; les expéditeurs inconnus d'une sélection et la création de leurs contacts
// @spec docs/SPEC-mail-subsystem.md §32.7, §32.8, §32.10 ; docs/DESIGN_SYSTEM.md §5.109 bis ; docs/JOURNAL.md décisions 945
//       et 947
//
// AUCUN DROIT N'EST APPLIQUÉ ICI (`CLAUDE.md` §10) : la base ouvre la lecture d'un transfert, réserve le blocage à
// l'administrateur, et juge chaque contact créé. L'écran lit, appelle et traduit.

import { classerErreur, enErreur, pret, type EtatAsync, type ErreurDonnees } from './async'
import { descriptionPortee, type PorteeGroupee } from './actions-groupees'
import type { ClientCrm } from './supabase'

// =================================================================================================
// Le transfert — §32.7
// =================================================================================================

/** Un transfert lu sur le message ouvert. */
export type TransfertLu = {
	readonly destinataireId: string
	/** `null` quand le profil n'est pas lisible : l'écran écrit « Compte supprimé » (§5.10). */
	readonly destinataireNom: string | null
	readonly auteurId: string | null
	readonly auteurNom: string | null
	readonly le: string
}

/** Le dictionnaire fermé des refus d'un transfert ou de son retrait. */
export type RefusTransfert = 'introuvable' | 'interdit' | 'pas_membre' | 'soi_meme' | 'reseau' | 'inconnu'

export function classerRefusTransfert(statut: number | undefined, message: string): RefusTransfert {
	if (message.includes('recipient_not_member')) return 'pas_membre'
	if (message.includes('self_transfer')) return 'soi_meme'
	if (message.includes('message_not_found') || message.includes('transfer_not_found') || statut === 404) return 'introuvable'
	if (message.includes('forbidden') || statut === 401 || statut === 403) return 'interdit'
	if (statut === 0 || statut === undefined) return 'reseau'
	return 'inconnu'
}

type ProfilEmbarque = { readonly full_name: string } | null

/** Les transferts d'un message que la personne voit — la base ne rend que ceux d'un message qu'elle lit (§32.7). */
export async function lireTransferts(client: ClientCrm | null, idMessage: string): Promise<EtatAsync<readonly TransfertLu[]>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration absente'))
	try {
		const reponse = await client
			.from('mail_message_transfers')
			.select(
				'recipient_id, transferred_by, created_at, destinataire:profiles!mail_message_transfers_recipient_id_fkey(full_name), auteur:profiles!mail_message_transfers_transferred_by_fkey(full_name)',
			)
			.eq('message_id', idMessage)
			.order('created_at', { ascending: true })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			reponse.data.map((ligne) => ({
				destinataireId: ligne.recipient_id,
				destinataireNom: (ligne.destinataire as ProfilEmbarque)?.full_name ?? null,
				auteurId: ligne.transferred_by,
				auteurNom: (ligne.auteur as ProfilEmbarque)?.full_name ?? null,
				le: ligne.created_at,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

async function appeler(
	client: ClientCrm | null,
	geste: (client: ClientCrm) => PromiseLike<{ readonly error: { readonly message: string } | null; readonly status: number }>,
): Promise<RefusTransfert | null> {
	if (client === null) return 'inconnu'
	try {
		const reponse = await geste(client)
		return reponse.error === null ? null : classerRefusTransfert(reponse.status, reponse.error.message)
	} catch {
		return 'reseau'
	}
}

/** Transfère un message à un membre (§32.7) : aucun envoi, une écriture en base. */
export const transfererMessage = (client: ClientCrm | null, idMessage: string, idMembre: string) =>
	appeler(client, (c) => c.rpc('transfer_message', { p_message_id: idMessage, p_recipient_id: idMembre }))

/** Retire un transfert — permis à son auteur et à son destinataire (§32.7). */
export const retirerTransfert = (client: ClientCrm | null, idMessage: string, idMembre: string) =>
	appeler(client, (c) => c.rpc('remove_message_transfer', { p_message_id: idMessage, p_recipient_id: idMembre }))

// =================================================================================================
// Le blocage d'un expéditeur — §32.8
// =================================================================================================

/** Le nombre de mails reçus de l'adresse, hors corbeille : celui que la double confirmation annonce. */
export async function compterImpactBlocage(
	client: ClientCrm | null,
	idEspace: string,
	adresse: string,
): Promise<EtatAsync<number>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration absente'))
	try {
		const reponse = await client.rpc('blocked_sender_impact', { p_workspace_id: idEspace, p_address: adresse })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(reponse.data ?? 0)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Bloque l'adresse pour tout l'espace ; rend le nombre de mails mis à la corbeille, ou l'erreur. */
export async function bloquerExpediteur(
	client: ClientCrm | null,
	idEspace: string,
	adresse: string,
): Promise<{ readonly corbeille: number } | ErreurDonnees> {
	if (client === null) return classerErreur(undefined, 'configuration absente')
	try {
		const reponse = await client.rpc('block_sender', { p_workspace_id: idEspace, p_address: adresse })
		if (reponse.error !== null) return classerErreur(reponse.status, reponse.error.message)
		const donnees = (reponse.data ?? {}) as { readonly trashed?: number }
		return { corbeille: donnees.trashed ?? 0 }
	} catch (cause) {
		return classerErreur(undefined, cause instanceof Error ? cause.message : String(cause))
	}
}

/** Un expéditeur bloqué, tel que Réglages ▸ Expéditeurs bloqués le liste. */
export type ExpediteurBloque = {
	readonly adresse: string
	readonly bloquePar: string | null
	readonly le: string
}

export async function lireExpediteursBloques(
	client: ClientCrm | null,
	idEspace: string,
): Promise<EtatAsync<readonly ExpediteurBloque[]>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration absente'))
	try {
		const reponse = await client
			.from('mail_blocked_senders')
			.select('address, created_at, auteur:profiles!mail_blocked_senders_blocked_by_fkey(full_name)')
			.eq('workspace_id', idEspace)
			.order('address')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			reponse.data.map((ligne) => ({
				adresse: ligne.address,
				bloquePar: (ligne.auteur as ProfilEmbarque)?.full_name ?? null,
				le: ligne.created_at,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Débloque l'adresse : ses prochains mails arrivent de nouveau ; ceux en corbeille y restent (§32.8). */
export async function debloquerExpediteur(
	client: ClientCrm | null,
	idEspace: string,
	adresse: string,
): Promise<ErreurDonnees | null> {
	if (client === null) return classerErreur(undefined, 'configuration absente')
	try {
		const reponse = await client.rpc('unblock_sender', { p_workspace_id: idEspace, p_address: adresse })
		return reponse.error === null ? null : classerErreur(reponse.status, reponse.error.message)
	} catch (cause) {
		return classerErreur(undefined, cause instanceof Error ? cause.message : String(cause))
	}
}

// =================================================================================================
// Les contacts depuis les expéditeurs inconnus — §32.10
// =================================================================================================

/** Un expéditeur inconnu de la sélection, avec le nom et l'organisation proposés. */
export type ExpediteurInconnu = {
	readonly idEspace: string
	readonly adresse: string
	readonly nom: string
	readonly organisation: string | null
	readonly mails: number
}

export async function lireExpediteursInconnus(
	client: ClientCrm | null,
	portee: PorteeGroupee,
): Promise<EtatAsync<readonly ExpediteurInconnu[]>> {
	if (client === null) return enErreur(classerErreur(undefined, 'configuration absente'))
	try {
		const reponse = await client.rpc('inbox_bulk_unknown_senders', { p_scope: descriptionPortee(portee) })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			(reponse.data ?? []).map((ligne) => ({
				idEspace: ligne.workspace_id,
				adresse: ligne.address,
				nom: ligne.suggested_name,
				organisation: ligne.suggested_organization_name,
				mails: ligne.message_count,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Une ligne à créer, telle que la personne l'a vérifiée. */
export type ContactAVerifier = {
	readonly idEspace: string
	readonly adresse: string
	readonly nom: string
	readonly organisation: string
}

/** L'issue d'une ligne, rendue par `import_contacts` (`docs/SPEC-vues-import-export.md` §6.2 bis). */
export type IssueContact = {
	readonly adresse: string
	readonly issue: 'created' | 'skipped' | 'refused'
	readonly code: string | null
}

/**
 * Crée les contacts par le chemin de l'import (`import_contacts`, `p_source = 'email'`), un appel par espace. Les droits,
 * les doublons et les refus sont ceux de l'import ; l'écran ne juge rien.
 */
export async function creerContacts(
	client: ClientCrm | null,
	lignes: readonly ContactAVerifier[],
): Promise<readonly IssueContact[] | ErreurDonnees> {
	if (client === null) return classerErreur(undefined, 'configuration absente')
	const issues: IssueContact[] = []
	const parEspace = new Map<string, ContactAVerifier[]>()
	for (const ligne of lignes) parEspace.set(ligne.idEspace, [...(parEspace.get(ligne.idEspace) ?? []), ligne])
	try {
		for (const [idEspace, groupe] of parEspace) {
			const reponse = await client.rpc('import_contacts', {
				p_workspace: idEspace,
				p_rows: groupe.map((ligne) => ({
					full_name: ligne.nom,
					email: ligne.adresse,
					organization_name: ligne.organisation.trim() === '' ? null : ligne.organisation,
				})),
				p_dry_run: false,
				p_source: 'email',
			})
			if (reponse.error !== null) return classerErreur(reponse.status, reponse.error.message)
			for (const resultat of reponse.data ?? []) {
				const ligne = groupe[resultat.line - 1]
				issues.push({
					adresse: ligne?.adresse ?? '',
					issue: resultat.outcome as IssueContact['issue'],
					code: resultat.code,
				})
			}
		}
		return issues
	} catch (cause) {
		return classerErreur(undefined, cause instanceof Error ? cause.message : String(cause))
	}
}
