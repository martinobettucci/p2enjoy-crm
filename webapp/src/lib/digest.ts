// @spec CRM-069 (docs/BACKLOG.md) — tranche T5 : le consentement au récapitulatif quotidien — le lire, le donner, le retirer
// @spec docs/SPEC-etiquettes-digest.md §5.1 (une ligne vaut consentement, pour soi seul, privée ; aucune ligne, aucun
//       email) ; docs/DESIGN_SYSTEM.md §5.74 ; CLAUDE.md §10, §11 (un consentement est une donnée persistée côté serveur)
//
// Ce module ne rend rien : il lit, écrit et classe les refus. La base pose la personne (l'appelant) et refuse un espace dont
// elle n'est pas membre.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

export type ConsentementDigest = {
	/** Le nom de l'espace, que la case porte (§5.74). */
	readonly espace: string
	readonly abonne: boolean
}

/** Le consentement de l'appelant pour l'espace courant, et le nom de l'espace. La RLS ne rend que sa propre ligne. */
export async function lireConsentementDigest(client: ClientCrm, idWorkspace: string): Promise<EtatAsync<ConsentementDigest>> {
	try {
		const [espace, abonnement] = await Promise.all([
			client.from('workspaces').select('name').eq('id', idWorkspace),
			client.from('digest_subscriptions').select('workspace_id').eq('workspace_id', idWorkspace),
		])
		const erreur = espace.error ?? abonnement.error
		if (erreur !== null) {
			return enErreur(classerErreur(espace.error !== null ? espace.status : abonnement.status, erreur.message))
		}
		const nom = (espace.data ?? [])[0]?.name ?? ''
		return pret({ espace: nom, abonne: (abonnement.data ?? []).length > 0 })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

export type IssueConsentement =
	| { readonly statut: 'applique'; readonly abonne: boolean }
	| { readonly statut: 'refus'; readonly nature: 'forbidden' | 'network' | 'unknown' }

/** Donne ou retire le consentement. Donner un consentement déjà donné, ou retirer un absent, rend l'état voulu. */
export async function ecrireConsentementDigest(
	client: ClientCrm,
	idWorkspace: string,
	abonne: boolean,
): Promise<IssueConsentement> {
	try {
		const reponse = abonne
			? await client.from('digest_subscriptions').insert({ workspace_id: idWorkspace } as never)
			: await client.from('digest_subscriptions').delete().eq('workspace_id', idWorkspace)
		if (reponse.error === null || reponse.error.code === '23505') return { statut: 'applique', abonne }
		if (reponse.error.code === '42501' || reponse.status === 401 || reponse.status === 403) {
			return { statut: 'refus', nature: 'forbidden' }
		}
		return { statut: 'refus', nature: reponse.status === 0 ? 'network' : 'unknown' }
	} catch {
		return { statut: 'refus', nature: 'network' }
	}
}
