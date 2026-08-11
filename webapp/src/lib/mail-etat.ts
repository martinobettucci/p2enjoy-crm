// @spec CRM-059 (docs/BACKLOG.md) — écran d'état de la messagerie
// @spec docs/SPEC-mail-subsystem.md §20.7 (les faits montrés), §20.11 (l'écran, ce qu'il lit)
// @spec docs/DESIGN_SYSTEM.md §5.14 (cette surface)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE (§20.11.2) : il lit `mail_inbound_accounts` sous la
// RLS posée par `CRM-052` (migration 0022) et deux comptages sur `mail_outbox` sous la RLS posée
// par `CRM-058` (migration 0030). Un membre ordinaire n'y voit que ce que ces politiques lui
// laissent déjà voir ailleurs ; rien n'est recalculé ni élargi ici.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'écran lit
// ---------------------------------------------------------------------------------------------

/** Un compte entrant tel que l'écran d'état a besoin de le connaître — §20.11.3. */
export type CompteMailEtat = Pick<
	Database['public']['Tables']['mail_inbound_accounts']['Row'],
	'id' | 'label' | 'last_sync_at' | 'status' | 'last_error'
>

/** Colonnes réellement demandées. Exportées pour que les tests vérifient la requête émise. */
export const COLONNES_COMPTE_MAIL_ETAT = 'id, label, last_sync_at, status, last_error'

/**
 * Les comptes entrants visibles par l'appelant, triés par boîte.
 *
 * Aucun filtre d'archivage : `mail_inbound_accounts` n'en porte pas (§13.2 de
 * `docs/SPEC-mail-subsystem.md`). La RLS de `0022` fait tout le tri — administrateur : tous les
 * comptes du workspace ; membre ordinaire : le sien s'il en possède un ; sans droit, la table
 * rend simplement zéro ligne (§20.11.2).
 */
export async function lireComptesMailEtat(
	client: ClientCrm,
): Promise<EtatAsync<readonly CompteMailEtat[]>> {
	try {
		const reponse = await client
			.from('mail_inbound_accounts')
			.select(COLONNES_COMPTE_MAIL_ETAT)
			.order('label')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les deux chiffres de la file sortante que le §20.7 exige — §20.11.5. */
export type CompteursFileSortante = {
	readonly enAttente: number
	readonly echecsDefinitifs: number
}

/**
 * Compte la file sortante visible par l'appelant : « en attente » (`queued` ou `sending`),
 * « échec définitif » (`failed`). Deux requêtes `head: true`, jamais les lignes elles-mêmes —
 * l'écran affiche un chiffre, pas un tableau des envois (§20.11.7).
 *
 * La RLS de `0030` filtre par `app.can_read_card` : un membre ordinaire ne compte donc que la
 * file des cards qu'il peut lire, portée déjà tenue par `CRM-057` et non inventée ici.
 */
export async function lireCompteursFileSortante(
	client: ClientCrm,
): Promise<EtatAsync<CompteursFileSortante>> {
	try {
		const [enAttente, echecs] = await Promise.all([
			client
				.from('mail_outbox')
				.select('id', { count: 'exact', head: true })
				.in('status', ['queued', 'sending']),
			client.from('mail_outbox').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
		])
		if (enAttente.error !== null) {
			return enErreur(classerErreur(enAttente.status, enAttente.error.message))
		}
		if (echecs.error !== null) {
			return enErreur(classerErreur(echecs.status, echecs.error.message))
		}
		if (enAttente.count === null || echecs.count === null) {
			// Réponse aboutie sans compte porté : un `count` absent n'est pas une file vide, c'est
			// un contrat rompu — même position que `lirePageCards` (`liste-cards.ts`).
			return enErreur(classerErreur(undefined, 'count absent alors que la réponse a abouti'))
		}
		return pret({ enAttente: enAttente.count, echecsDefinitifs: echecs.count })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Le dictionnaire fermé des six codes d'incident — §20.11.4
// ---------------------------------------------------------------------------------------------

/** Les six codes que la contrainte `mail_inbound_accounts_erreur_code` (migration 0022) admet. */
export const CODES_INCIDENT_MAIL = [
	'auth_failed',
	'host_unreachable',
	'connection_refused',
	'tls_failed',
	'timeout',
	'protocol_error',
] as const

export type CodeIncidentMail = (typeof CODES_INCIDENT_MAIL)[number]

/** Un septième code serait un défaut de la contrainte, pas un texte à deviner côté client. */
export function estCodeIncidentConnu(code: string): code is CodeIncidentMail {
	return (CODES_INCIDENT_MAIL as readonly string[]).includes(code)
}
