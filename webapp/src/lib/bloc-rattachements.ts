// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.2 : archiver et désarchiver un rattachement depuis le bloc
//       « Rattachements » de la fiche (docs/SPEC-rattachements.md §5 « Archiver, désarchiver », §8.1 ; décision 823)
// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.3 : rattacher l'affaire à un channel — les channels offerts, `attach_card`
//       et le dictionnaire fermé de ses refus (docs/SPEC-rattachements.md §5 « Rattacher » ; docs/DESIGN_SYSTEM.md §5.83)
// @spec CRM-111 (docs/BACKLOG.md) — tranche T7.4 : retirer un rattachement — `detach_card` et ses refus
//       (docs/SPEC-rattachements.md §4, §5 « Retirer », décision 643 ; docs/DESIGN_SYSTEM.md §5.84)
// @spec docs/DESIGN_SYSTEM.md §5.82 (le geste, sans confirmation, refus dans la ligne) ;
//       docs/SPEC-rattachements.md §4 (le droit : écrire le channel du rattachement, tenu par `card_placements_update`)
//
// CE MODULE N'OUVRE AUCUNE RÈGLE. Il écrit la seule colonne `archived_at` du rattachement, sous la politique
// `card_placements_update` et le privilège de colonne de `authenticated` ; le déclencheur `card_placements_write_events`
// inscrit `archived` ou `unarchived` au fil. Un refus de politique rend `200` et zéro ligne : la requête relit donc la
// ligne écrite, sans quoi un refus passerait pour un succès (décision 70).

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { classerEcritureEntete, type IssueEcritureEntete } from './entete-card'
import type { ClientCrm } from './supabase'

/** Ce que l'écran distingue d'un archivage : réussi, refusé par la base, ou en panne. */
export type IssueArchivage = 'enregistree' | 'refusee' | 'reseau'

/** Ramène l'issue d'une écriture au trio du bloc : tout ce qui n'est pas un succès ni une panne est un refus. */
export function issueArchivage(issue: IssueEcritureEntete): IssueArchivage {
	if (issue === 'enregistree') return 'enregistree'
	if (issue === 'reseau') return 'reseau'
	return 'refusee'
}

/** Archive (`archiver = true`) ou désarchive un rattachement. L'horodatage est celui du client, comme pour un nœud. */
export async function archiverRattachement(
	client: ClientCrm,
	idRattachement: string,
	archiver: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<IssueArchivage> {
	try {
		const reponse = await client
			.from('card_placements')
			.update({ archived_at: archiver ? maintenant() : null })
			.eq('id', idRattachement)
			.select('id')
		const code = reponse.error === null ? null : (reponse.error.code ?? '')
		return issueArchivage(classerEcritureEntete(reponse.status, code, reponse.data?.length ?? 0))
	} catch {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre : c'est une panne, dite comme telle.
		return 'reseau'
	}
}

/** Un channel auquel l'affaire peut être rattachée : son identifiant et son chemin (§5.83). */
export type ChannelRattachable = {
	readonly id: string
	readonly slugTrack: string
	readonly slugChannel: string
	readonly track: string
	readonly channel: string
}

type LigneChannelRattachable = {
	readonly id: string
	readonly slug: string
	readonly name: string
	readonly ecriture_permise: unknown
	readonly tracks: {
		readonly slug: string
		readonly name: string
		readonly archived_at: string | null
		readonly deleted_at: string | null
	} | null
}

/**
 * Les channels offerts par « Rattacher à un channel » (§5.83) : ceux de l'espace, ouverts (ni le channel ni son track
 * archivé ou à la corbeille), que la base dit modifiables (`ecriture_permise`), et auxquels l'affaire n'est pas déjà
 * rattachée (`exclus` : les channels de ses rattachements lisibles, archivés compris). Dans l'ordre des tracks puis des
 * channels. C'est une COMMODITÉ de choix : `attach_card` tient la règle, et refuse ce que la liste aurait laissé passer.
 */
export async function lireChannelsRattachables(
	client: ClientCrm,
	idWorkspace: string,
	exclus: ReadonlySet<string>,
): Promise<EtatAsync<readonly ChannelRattachable[]>> {
	try {
		const reponse = await client
			.from('channels')
			.select('id, slug, name, ecriture_permise, tracks(slug, name, archived_at, deleted_at)')
			.eq('workspace_id', idWorkspace)
			.is('archived_at', null)
			.is('deleted_at', null)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LigneChannelRattachable[]
		const offerts: ChannelRattachable[] = []
		for (const ligne of lignes) {
			const track = ligne.tracks
			if (track === null || track.archived_at !== null || track.deleted_at !== null) continue
			if (ligne.ecriture_permise !== true || exclus.has(ligne.id)) continue
			offerts.push({ id: ligne.id, slugTrack: track.slug, slugChannel: ligne.slug, track: track.name, channel: ligne.name })
		}
		return pret(
			offerts.sort((a, b) => a.track.localeCompare(b.track, 'fr') || a.channel.localeCompare(b.channel, 'fr')),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les refus de `attach_card` (migration 0148), chacun avec sa phrase (§5.83). */
export type RefusRattachement =
	| 'channel-introuvable'
	| 'channel-ferme'
	| 'interdit'
	| 'deja-rattachee'
	| 'sans-etape-initiale'
	| 'affaire-introuvable'
	| 'reseau'

/** Rattache l'affaire au channel. La base tient toutes les règles ; l'écran traduit son refus. */
export async function rattacherAffaire(
	client: ClientCrm,
	idCard: string,
	idChannel: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly refus: RefusRattachement }> {
	try {
		// Sans choix, l'identifiant part nul : la base rend `channel_not_found`, traduit — aucune garde ici (§5.3 ter).
		const reponse = await client.rpc('attach_card', { p_card: idCard, p_channel: (idChannel === '' ? null : idChannel) as string })
		if (reponse.error === null) return { ok: true }
		return { ok: false, refus: refusRattachement(reponse.status, reponse.error.code ?? null, reponse.error.message) }
	} catch {
		return { ok: false, refus: 'reseau' }
	}
}

/** Classe un refus d'`attach_card` par son code et son symbole ; l'inconnu se lit comme une panne, à réessayer. */
export function refusRattachement(statut: number | undefined, code: string | null, message: string): RefusRattachement {
	if (statut === undefined || statut === 0) return 'reseau'
	if (code === '42501') return 'interdit'
	if (code === '22023' || message === 'step_not_initial') return 'sans-etape-initiale'
	if (message === 'channel_not_found') return 'channel-introuvable'
	if (message === 'channel_closed') return 'channel-ferme'
	if (message === 'already_attached') return 'deja-rattachee'
	if (message === 'card_not_found') return 'affaire-introuvable'
	return 'reseau'
}

/** Les refus de `detach_card` (migration 0148), chacun avec sa phrase (§5.84). */
export type RefusRetrait = 'interdit' | 'dernier' | 'introuvable' | 'reseau'

/**
 * Retire un rattachement. La confirmation a NOMMÉ la perte des réponses de son formulaire (§5.84) : le geste la consent,
 * et `discard_field_values` part à vrai — la doctrine de `move_card_to_channel` (décision 216), dont la base exige
 * l'aveu explicite.
 */
export async function retirerRattachement(
	client: ClientCrm,
	idRattachement: string,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly refus: RefusRetrait }> {
	try {
		const reponse = await client.rpc('detach_card', { p_placement: idRattachement, discard_field_values: true })
		if (reponse.error === null) return { ok: true }
		return { ok: false, refus: refusRetrait(reponse.status, reponse.error.code ?? null, reponse.error.message) }
	} catch {
		return { ok: false, refus: 'reseau' }
	}
}

/** Classe un refus de `detach_card` par son code et son symbole ; l'inconnu se lit comme une panne, à réessayer. */
export function refusRetrait(statut: number | undefined, code: string | null, message: string): RefusRetrait {
	if (statut === undefined || statut === 0) return 'reseau'
	if (code === '42501') return 'interdit'
	if (message === 'last_placement') return 'dernier'
	if (message === 'card_not_found') return 'introuvable'
	return 'reseau'
}

