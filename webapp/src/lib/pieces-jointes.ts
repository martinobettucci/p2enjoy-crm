// @spec CRM-074 (docs/BACKLOG.md) — tranche T3 : l'aperçu des pièces jointes — ce qui s'aperçoit, la lecture du fichier
//       par le client de stockage, celle du texte extrait, les pièces d'une affaire pour son fil ; la portée couvre tout le
//       module
// @spec docs/SPEC-pieces-jointes.md §3 (le texte, ses statuts), §5 (l'écran), §5.2 révisé par la décision 791, §7 (la RLS
//       de la pièce, la politique de stockage 0029) ; docs/DESIGN_SYSTEM.md §5.80
//
// @spec CRM-143 (docs/BACKLOG.md) — tranche T4 : l'état d'une pièce non analysée (`etatPiece`), la confirmation du risque
//       (`confirmerPieceNonAnalysee`) et son dictionnaire de refus ; docs/SPEC-pieces-jointes.md §17.3, §17.4 ;
//       docs/DESIGN_SYSTEM.md §5.95
//
// AUCUN DROIT N'EST CALCULÉ ICI. Le fichier est lu sous la session, par la politique de stockage de la migration `0029`
// (pièce saine, message lisible) ; le texte, sous la RLS de la pièce. Ce module décide seulement si un « Aperçu » a un
// objet (docs/DESIGN_SYSTEM.md §5.21 : une commande vouée au refus ne se rend pas).

import { COLONNES_PIECE, pieceDepuisLigne, type PieceJointe } from './inbox'
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
			.select(`message_id, ${COLONNES_PIECE}`)
			.in('message_id', [...idsMessages])
			.order('filename')
		if (reponse.error !== null) return new Map()
		const parMessage = new Map<string, PieceJointe[]>()
		for (const ligne of reponse.data) {
			const liste = parMessage.get(ligne.message_id) ?? []
			liste.push(pieceDepuisLigne(ligne))
			parMessage.set(ligne.message_id, liste)
		}
		return parMessage
	} catch {
		return new Map()
	}
}

// =================================================================================================
// CRM-143 T4 — la pièce non analysée, et sa confirmation (docs/SPEC-pieces-jointes.md §17.3, §17.4)
// =================================================================================================

/**
 * Le délai au-delà duquel une pièce encore `pending` est NON ANALYSÉE, et non plus « en cours » — la règle de la base,
 * `app.piece_non_analysee` (migration `0173`), recopiée ici pour la seule forme de l'écran : c'est la base qui juge.
 */
export const DELAI_ANALYSE_MINUTES = 15

/** Ce que l'écran dit d'une pièce : son état, et pour une pièce non analysée, pourquoi. */
export type EtatPiece =
	| { readonly etat: 'saine' }
	| { readonly etat: 'infectee' }
	| { readonly etat: 'en_cours' }
	| { readonly etat: 'non_analysee'; readonly cause: 'antivirus_indisponible' | 'analyse_en_attente' }
	| { readonly etat: 'trop_volumineuse' }
	| { readonly etat: 'inconnue' }

/** Les champs d'une pièce dont son état dépend. */
export type PieceAnalysee = {
	readonly statutAnalyse: string
	readonly raisonNonAnalyse: string | null
	readonly recueLe: string
}

/**
 * L'état d'une pièce (§17.4). UN REPLI NE GLISSE JAMAIS DU CÔTÉ PERMISSIF : un statut inconnu, un `skipped` sans raison
 * ou une date illisible rendent `inconnue`, qui n'a aucune commande.
 */
export function etatPiece(piece: PieceAnalysee, maintenant: Date = new Date()): EtatPiece {
	switch (piece.statutAnalyse) {
		case 'clean':
			return { etat: 'saine' }
		case 'infected':
			return { etat: 'infectee' }
		case 'skipped':
			if (piece.raisonNonAnalyse === 'scanner_unavailable') return { etat: 'non_analysee', cause: 'antivirus_indisponible' }
			if (piece.raisonNonAnalyse === 'too_large') return { etat: 'trop_volumineuse' }
			return { etat: 'inconnue' }
		case 'pending': {
			const recue = Date.parse(piece.recueLe)
			if (Number.isNaN(recue)) return { etat: 'inconnue' }
			return maintenant.getTime() - recue > DELAI_ANALYSE_MINUTES * 60_000
				? { etat: 'non_analysee', cause: 'analyse_en_attente' }
				: { etat: 'en_cours' }
		}
		default:
			return { etat: 'inconnue' }
	}
}

/** Les refus de la confirmation, par un dictionnaire fermé (§17.4) : le message du serveur n'atteint jamais l'écran. */
export type RefusConfirmation = 'introuvable' | 'infectee' | 'en_cours' | 'non_conservee' | 'reseau' | 'inconnu'

/** Classe le refus de `acknowledge_unscanned_attachment` par son code, que la base écrit dans le message. */
export function classerRefusConfirmation(message: string | undefined): RefusConfirmation {
	const texte = message ?? ''
	if (texte.includes('attachment_not_found')) return 'introuvable'
	if (texte.includes('attachment_infected')) return 'infectee'
	if (texte.includes('attachment_scanning')) return 'en_cours'
	if (texte.includes('attachment_not_stored')) return 'non_conservee'
	return 'inconnu'
}

export type IssueConfirmation = { readonly ok: true } | { readonly ok: false; readonly refus: RefusConfirmation }

/**
 * Pose la confirmation de la personne, sous sa session (§17.3). Une pièce devenue saine entre-temps (`attachment_clean`)
 * n'a plus rien à confirmer : elle se télécharge, et c'est une issue réussie.
 */
export async function confirmerPieceNonAnalysee(client: ClientCrm | null, idPiece: string): Promise<IssueConfirmation> {
	if (client === null) return { ok: false, refus: 'inconnu' }
	try {
		const reponse = await client.rpc('acknowledge_unscanned_attachment', { p_attachment_id: idPiece })
		if (reponse.error === null) return { ok: true }
		if (reponse.error.message.includes('attachment_clean')) return { ok: true }
		return { ok: false, refus: classerRefusConfirmation(reponse.error.message) }
	} catch {
		return { ok: false, refus: 'reseau' }
	}
}
