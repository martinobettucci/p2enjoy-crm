// @spec CRM-074 (docs/BACKLOG.md) — tranche T3 : l'aperçu des pièces jointes — ce qui s'aperçoit, la lecture du fichier
//       par le client de stockage, celle du texte extrait, les pièces d'une affaire pour son fil ; la portée couvre tout le
//       module
// @spec docs/SPEC-pieces-jointes.md §3 (le texte, ses statuts), §5 (l'écran), §5.2 révisé par la décision 791, §7 (la RLS
//       de la pièce, la politique de stockage 0029) ; docs/DESIGN_SYSTEM.md §5.80
//
// AUCUN DROIT N'EST CALCULÉ ICI. Le fichier est lu sous la session, par la politique de stockage de la migration `0029`
// (pièce saine, message lisible) ; le texte, sous la RLS de la pièce. Ce module décide seulement si un « Aperçu » a un
// objet (docs/DESIGN_SYSTEM.md §5.21 : une commande vouée au refus ne se rend pas).

import type { PieceJointe } from './inbox'
import type { ClientCrm } from './supabase'

/** La borne de l'aperçu (§5.2) : au-delà, le téléchargement seul. */
export const APERCU_MAX_OCTETS = 25 * 1024 * 1024

const TYPES_IMAGE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const TYPES_TEXTE = new Set([
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	'application/vnd.oasis.opendocument.text',
	'application/vnd.oasis.opendocument.spreadsheet',
])
const TYPES_GENERIQUES = new Set(['application/zip', 'application/x-zip-compressed', 'application/octet-stream'])

/** Ce que l'aperçu montre : une image, un PDF et son texte, ou le seul texte d'un fichier Office. */
export type FormeApercu = 'image' | 'pdf' | 'texte'

const typeDe = (piece: Pick<PieceJointe, 'type'>): string => piece.type.split(';', 1)[0]!.trim().toLowerCase()

/**
 * La forme de l'aperçu d'une pièce, ou `null` quand « Aperçu » n'a pas d'objet : pièce non saine, trop grande, ou d'un type
 * que le produit ne montre pas. Pour un type générique, l'extension du nom décide, comme en base
 * (`app.attachment_text_eligible`, migration `0141`).
 */
export function formeApercu(piece: Pick<PieceJointe, 'type' | 'nom' | 'taille' | 'statutAnalyse'>): FormeApercu | null {
	if (piece.statutAnalyse !== 'clean' || piece.taille > APERCU_MAX_OCTETS) return null
	const type = typeDe(piece)
	if (TYPES_IMAGE.has(type)) return 'image'
	if (type === 'application/pdf') return 'pdf'
	if (TYPES_TEXTE.has(type)) return 'texte'
	if (TYPES_GENERIQUES.has(type)) {
		const nom = piece.nom.toLowerCase()
		if (nom.endsWith('.pdf')) return 'pdf'
		if (/\.(docx|xlsx|odt|ods)$/.test(nom)) return 'texte'
	}
	return null
}

/** Le type d'une adresse locale : FORCÉ par l'écran à la forme montrée, jamais repris du fichier (§5.2). */
export function typeForce(forme: FormeApercu, piece: Pick<PieceJointe, 'type'>): string {
	if (forme === 'pdf') return 'application/pdf'
	if (forme === 'image') return typeDe(piece)
	return 'text/plain'
}

/** Le fichier, lu sous la session par le client de stockage ; `null` sur un refus ou une panne. */
export async function lireFichierPiece(client: ClientCrm | null, chemin: string): Promise<Blob | null> {
	if (client === null) return null
	try {
		const reponse = await client.storage.from('mail-attachments').download(chemin)
		return reponse.error === null && reponse.data !== null ? reponse.data : null
	} catch {
		return null
	}
}

export type StatutTexte = 'pending' | 'extracted' | 'empty' | 'unsupported' | 'failed'

export type TextePiece =
	| { readonly statut: 'extracted'; readonly texte: string; readonly tronque: boolean }
	| { readonly statut: Exclude<StatutTexte, 'extracted'> }

const STATUTS_TEXTE: ReadonlySet<string> = new Set(['pending', 'extracted', 'empty', 'unsupported', 'failed'])

/**
 * Le texte extrait d'une pièce, sous sa RLS. `null` sur une panne ou une pièce illisible. Une pièce sans statut — qui ne
 * devrait pas porter « Aperçu » de texte — se lit comme « en cours » : jamais une valeur inventée.
 */
export async function lireTextePiece(client: ClientCrm | null, idPiece: string): Promise<TextePiece | null> {
	if (client === null) return null
	try {
		const reponse = await client
			.from('mail_attachments')
			.select('text_status, extracted_text, text_truncated')
			.eq('id', idPiece)
			.maybeSingle()
		if (reponse.error !== null || reponse.data === null) return null
		const { text_status: statut, extracted_text: texte, text_truncated: tronque } = reponse.data
		if (statut === 'extracted' && typeof texte === 'string') return { statut, texte, tronque: tronque === true }
		if (statut !== null && STATUTS_TEXTE.has(statut) && statut !== 'extracted') {
			return { statut: statut as Exclude<StatutTexte, 'extracted'> }
		}
		return { statut: 'pending' }
	} catch {
		return null
	}
}

/**
 * Les pièces des courriers d'une affaire, par message, pour son fil (§5.1, décision 789) — une seule lecture, filtrée sur
 * les MESSAGES de l'affaire, sous la RLS de la pièce. Une panne rend une carte vide : le fil reste, sans ses pièces.
 *
 * PAR LES MESSAGES : le fil est fait de messages, et c'est le message qui dit où il est rangé. `mail_attachments.card_id`
 * est exact depuis la migration `0142` (INC-326, décision 795), mais le fil n'en dépend pas.
 */
export async function lirePiecesDesMessages(
	client: ClientCrm | null,
	idsMessages: readonly string[],
): Promise<ReadonlyMap<string, readonly PieceJointe[]>> {
	if (client === null || idsMessages.length === 0) return new Map()
	try {
		const reponse = await client
			.from('mail_attachments')
			.select('id, message_id, filename, mime_type, size_bytes, storage_path, av_status')
			.in('message_id', [...idsMessages])
			.order('filename')
		if (reponse.error !== null) return new Map()
		const parMessage = new Map<string, PieceJointe[]>()
		for (const ligne of reponse.data) {
			const liste = parMessage.get(ligne.message_id) ?? []
			liste.push({
				id: ligne.id,
				nom: ligne.filename,
				type: ligne.mime_type,
				taille: ligne.size_bytes,
				chemin: ligne.storage_path,
				statutAnalyse: ligne.av_status,
			})
			parMessage.set(ligne.message_id, liste)
		}
		return parMessage
	} catch {
		return new Map()
	}
}
