// @spec CRM-111 (docs/BACKLOG.md) — tranche T2.4.5 : une preuve pose une affaire jetable comme le seed, l'affaire puis son
//       rattachement, par la clé de service (décisions 746 et 770) ; docs/SPEC-rattachements.md §3.2 (ce qui quitte
//       l'affaire), §12 ; docs/SPEC-test-harness.md §4.3
//
// LES COLONNES DE RATTACHEMENT ONT QUITTÉ `cards`. Une preuve qui posait une affaire en une requête — `POST /cards` avec
// son channel, son workflow et son étape — la pose désormais en deux : l'affaire, puis son rattachement. `posterAffaire`
// prend la charge d'avant telle quelle, la partage, et rend la réponse de l'affaire, de sorte que l'appelant lit comme
// avant `status()` et `json()`. Seule la clé de service le peut (décision 770) : un utilisateur crée par `creer_affaire`.

import { randomUUID } from 'node:crypto'
import type { APIRequestContext, APIResponse } from '@playwright/test'

/** Les colonnes que l'affaire ne porte plus (docs/SPEC-rattachements.md §3.2). */
export const COLONNES_RATTACHEMENT = [
	'channel_id',
	'workflow_id',
	'current_step_id',
	'position',
	'owner_id',
	'amount',
	'probability_override',
	'next_action',
	'next_action_at',
	'entered_step_at',
	'snoozed_until',
	'archived_at',
] as const

/** L'adresse du rattachement, depuis celle de l'affaire : seul le nom de la table change. */
function adresseRattachement(adresseAffaire: string): string {
	return adresseAffaire.replace(/\/cards(?=$|\?)/, '/card_placements').replace(/\?.*$/, '')
}

/**
 * Pose une affaire et son rattachement, comme le seed — ou plusieurs, d'un tableau. Sans colonne de rattachement dans la
 * charge, c'est un `POST /cards` ordinaire. Un rattachement refusé retire l'affaire posée, pour qu'aucune affaire orpheline ne reste en base.
 */
export async function posterAffaire(
	requete: APIRequestContext,
	adresse: string,
	options: { readonly headers: Record<string, string>; readonly data: unknown },
): Promise<APIResponse> {
	// Une charge qui n'est pas un objet passe telle quelle ; un tableau se partage ligne à ligne, en deux envois groupés.
	if (typeof options.data !== 'object' || options.data === null) return requete.post(adresse, options)
	const charges = (Array.isArray(options.data) ? options.data : [options.data]) as Record<string, unknown>[]
	const parts = charges.map((charge) => {
		const rattachement: Record<string, unknown> = {}
		const affaire: Record<string, unknown> = {}
		for (const [cle, valeur] of Object.entries(charge)) {
			if ((COLONNES_RATTACHEMENT as readonly string[]).includes(cle)) rattachement[cle] = valeur
			else affaire[cle] = valeur
		}
		return { affaire: { ...affaire, id: (affaire['id'] as string | undefined) ?? randomUUID() } as Record<string, unknown>, rattachement }
	})
	// Seule une adresse de `cards` se partage : les autres tables passent telles quelles, même si elles portent une
	// colonne du même nom (`channels.workflow_id`, `channels.position`).
	if (!/\/cards(?:$|\?)/.test(adresse) || parts.every((part) => Object.keys(part.rattachement).length === 0)) {
		return requete.post(adresse, options)
	}

	const reponse = await requete.post(adresse, {
		headers: { ...options.headers, Prefer: 'return=representation' },
		data: Array.isArray(options.data) ? parts.map((part) => part.affaire) : parts[0]!.affaire,
	})
	if (!reponse.ok()) return reponse
	const rattachements = parts.map((part) => ({
		...part.rattachement,
		card_id: part.affaire['id'],
		workspace_id: part.affaire['workspace_id'],
	}))
	const pose = await requete.post(adresseRattachement(adresse), {
		headers: { ...options.headers, Prefer: 'return=minimal' },
		data: Array.isArray(options.data) ? rattachements : rattachements[0],
	})
	if (!pose.ok()) {
		const ids = parts.map((part) => part.affaire['id']).join(',')
		await requete.delete(`${adresse.replace(/\?.*$/, '')}?id=in.(${ids})`, { headers: options.headers })
		return pose
	}
	return reponse
}

/**
 * La projection d'une affaire avec ses rattachements plongés : `ligneAffaire` la ramène à la ligne d'avant le retrait.
 * La clé étrangère est nommée, `cards` étant atteinte depuis `card_placements` par deux chemins.
 */
export const SELECT_LIGNE_AFFAIRE = 'select=*,card_placements!card_placements_card_fk(*)'

/**
 * L'affaire lue avec `SELECT_LIGNE_AFFAIRE`, ramenée à la ligne d'avant : ses colonnes, plus celles de son PLUS ANCIEN
 * rattachement — la « forme d'avant » (docs/SPEC-rattachements.md §3.2). L'identifiant reste celui de l'affaire.
 */
export function ligneAffaire<T = Record<string, unknown>>(lue: Record<string, unknown>): T {
	const { card_placements: rattachements, ...affaire } = lue as { card_placements: Record<string, unknown>[] }
	const [premier] = [...rattachements].sort((a, b) =>
		`${a['created_at']}${a['id']}` < `${b['created_at']}${b['id']}` ? -1 : 1,
	)
	const { id: _rattachement, card_id: _affaire, workspace_id: _espace, created_at: _cree, updated_at: _maj, created_by: _auteur, ...colonnes } =
		premier ?? {}
	return { ...affaire, ...colonnes } as T
}

/** Les affaires d'un filtre de `cards`, ramenées à la ligne d'avant (lecture avec les en-têtes fournis). */
export async function lireLignesAffaire<T = Record<string, unknown>>(
	requete: APIRequestContext,
	filtre: string,
	headers: Record<string, string>,
	base = '',
): Promise<T[]> {
	const reponse = await requete.get(`${base}/rest/v1/cards?${filtre}&${SELECT_LIGNE_AFFAIRE}`, { headers })
	if (reponse.status() !== 200) throw new Error(`lecture des affaires : ${reponse.status()} ${await reponse.text()}`)
	return ((await reponse.json()) as Record<string, unknown>[]).map((lue) => ligneAffaire<T>(lue))
}

/**
 * Réécrit une affaire et son rattachement d'un seul appel, comme le `PATCH /cards` d'avant : les colonnes de rattachement
 * vont aux rattachements de l'affaire, les autres à l'affaire. Le filtre est celui de l'affaire, `id=eq.…` ou `id=in.(…)`.
 * Rend la dernière réponse en échec, ou celle de l'affaire (ou du rattachement, si la charge ne touche que lui).
 */
export async function patcherAffaire(
	requete: APIRequestContext,
	adresse: string,
	options: { readonly headers: Record<string, string>; readonly data: Record<string, unknown> },
): Promise<APIResponse> {
	const rattachement: Record<string, unknown> = {}
	const affaire: Record<string, unknown> = {}
	for (const [cle, valeur] of Object.entries(options.data)) {
		if ((COLONNES_RATTACHEMENT as readonly string[]).includes(cle)) rattachement[cle] = valeur
		else affaire[cle] = valeur
	}
	const [chemin, filtre = ''] = adresse.split('?')
	if (!/\/cards$/.test(chemin ?? '') || !/(^|&)id=/.test(filtre)) throw new Error(`patcherAffaire : ${adresse}`)
	let reponse: APIResponse | undefined
	if (Object.keys(rattachement).length > 0) {
		reponse = await requete.patch(
			`${chemin!.replace(/\/cards$/, '/card_placements')}?${filtre.replace(/(^|&)id=/, '$1card_id=')}`,
			{ headers: options.headers, data: rattachement },
		)
		if (!reponse.ok()) return reponse
	}
	if (Object.keys(affaire).length > 0 || reponse === undefined) {
		reponse = await requete.patch(adresse, { headers: options.headers, data: affaire })
	}
	return reponse
}

/**
 * Supprime les affaires rattachées à un channel, comme le `DELETE /cards?channel_id=…` d'avant le retrait : une écriture
 * PostgREST ne filtre pas sur une ressource plongée, les identifiants sont donc lus d'abord sur les rattachements.
 */
export async function supprimerAffairesDuChannel(
	requete: APIRequestContext,
	channelId: string,
	headers: Record<string, string>,
	base = '',
): Promise<void> {
	const lus = await requete.get(`${base}/rest/v1/card_placements?channel_id=eq.${channelId}&select=card_id`, { headers })
	if (lus.status() !== 200) throw new Error(`lecture des rattachements : ${lus.status()} ${await lus.text()}`)
	const ids = [...new Set(((await lus.json()) as { card_id: string }[]).map((ligne) => ligne.card_id))]
	if (ids.length === 0) return
	const reponse = await requete.delete(`${base}/rest/v1/cards?id=in.(${ids.join(',')})`, { headers })
	if (!reponse.ok()) throw new Error(`suppression des affaires : ${reponse.status()} ${await reponse.text()}`)
}
