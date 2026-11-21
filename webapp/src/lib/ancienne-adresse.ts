// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — les anciennes adresses, sans espace, résolues vers l'espace de leur ressource,
//       sinon vers l'espace courant de l'onglet (docs/SPEC-espace-courant.md §8.2, §15.4 ; docs/JOURNAL.md décision 967)
//
// UNE ANCIENNE ADRESSE NE DEVINE JAMAIS UN ESPACE QU'ELLE NE PEUT PAS LIRE. Chaque ressource est lue sous la RLS de la
// personne : un message, un mail préparé, une affaire qu'elle ne lit pas n'a pas d'espace, et l'adresse va dans l'espace
// courant, où l'écran dira « introuvable » comme il l'aurait dit avant.

import type { ClientCrm } from './supabase'
import type { Workspace } from './workspaces'

/** Les trois familles d'anciennes adresses (§15.4) ; `null` pour une adresse qui n'en est pas une. */
export type AncienneAdresse =
	| { readonly genre: 'inbox'; readonly idMessage: string | null; readonly idBrouillon: string | null }
	| { readonly genre: 'affaire'; readonly idCard: string }
	| { readonly genre: 'track'; readonly slugTrack: string }
	| { readonly genre: 'reglages' }

/** Reconnaît une ancienne adresse à son chemin et à ses paramètres. */
export function reconnaitre(chemin: string, recherche: string): AncienneAdresse | null {
	const segments = chemin.split('/').filter((s) => s !== '')
	const premier = segments[0]
	if (premier === 'inbox' && segments.length === 1) {
		const parametres = new URLSearchParams(recherche)
		return { genre: 'inbox', idMessage: parametres.get('message'), idBrouillon: parametres.get('brouillon') }
	}
	if (premier === 'reglages') return { genre: 'reglages' }
	if (premier === 'tracks' && segments[1] !== undefined) {
		// `/tracks/:t/:c/cards/:id` : l'affaire nomme son espace.
		if (segments[3] === 'cards' && segments[4] !== undefined) return { genre: 'affaire', idCard: segments[4] }
		return { genre: 'track', slugTrack: decodeURIComponent(segments[1]) }
	}
	return null
}

/** L'espace de la ligne `id` de `table`, sous la RLS ; `null` si elle n'est pas lisible ou en cas d'échec. */
async function espaceDe(client: ClientCrm, table: 'mail_messages' | 'mail_drafts' | 'cards', id: string): Promise<string | null> {
	try {
		const reponse = await client.from(table).select('workspace_id').eq('id', id).limit(1)
		if (reponse.error !== null) return null
		const ligne = (reponse.data as readonly { workspace_id: string }[] | null)?.[0]
		return ligne?.workspace_id ?? null
	} catch {
		// Une panne de transport ne doit pas empêcher la redirection : l'adresse va alors dans l'espace courant, où l'écran
		// lira à son tour la ressource et dira son propre échec.
		return null
	}
}

/** Les espaces, par nom, dont un track lisible porte ce slug. */
async function espacesDuTrack(client: ClientCrm, slugTrack: string): Promise<readonly string[]> {
	try {
		const reponse = await client.from('tracks').select('workspace_id').eq('slug', slugTrack).is('deleted_at', null)
		if (reponse.error !== null) return []
		return ((reponse.data as readonly { workspace_id: string }[] | null) ?? []).map((l) => l.workspace_id)
	} catch {
		return []
	}
}

/**
 * Le slug de l'espace où mener une ancienne adresse (§15.4) : celui de sa ressource quand elle en nomme une et qu'elle est
 * lisible ; pour un track, le premier espace par nom qui en porte un de ce slug ; sinon l'espace de repli — l'espace
 * courant de l'onglet, ou le premier par nom.
 */
export async function espaceDeLAncienneAdresse(
	client: ClientCrm,
	adresse: AncienneAdresse,
	espaces: readonly Workspace[],
	slugRepli: string,
): Promise<string> {
	const slugDe = (idWorkspace: string | null) => espaces.find((w) => w.id === idWorkspace)?.slug ?? null
	switch (adresse.genre) {
		case 'inbox': {
			if (adresse.idMessage !== null) return slugDe(await espaceDe(client, 'mail_messages', adresse.idMessage)) ?? slugRepli
			if (adresse.idBrouillon !== null) return slugDe(await espaceDe(client, 'mail_drafts', adresse.idBrouillon)) ?? slugRepli
			return slugRepli
		}
		case 'affaire':
			return slugDe(await espaceDe(client, 'cards', adresse.idCard)) ?? slugRepli
		case 'track': {
			const porteurs = new Set(await espacesDuTrack(client, adresse.slugTrack))
			return espaces.find((w) => porteurs.has(w.id))?.slug ?? slugRepli
		}
		case 'reglages':
			return slugRepli
	}
}
