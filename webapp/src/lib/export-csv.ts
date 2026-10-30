// @spec CRM-071 (docs/BACKLOG.md) — tranche T4 : l'export CSV — appeler les deux fonctions d'export, écrire le fichier et
//       le proposer au téléchargement ; classer les refus
// @spec docs/SPEC-vues-import-export.md §5.1 (les colonnes), §5.2 (le plafond et les refus nommés), §5.3 (UTF-8 avec BOM,
//       point-virgule, CRLF, guillemets RFC 4180, ISO 8601, point décimal, apostrophe devant une cellule à risque de
//       formule, noms de fichier) ; docs/DESIGN_SYSTEM.md §5.76
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : la base ne rend que ce que la personne lit
//
// Ce module ne rend rien : il appelle, écrit le fichier et classe les refus. Le fichier n'est jamais stocké.

import { t } from '../i18n'
import type { Json } from './database.types'
import type { ClientCrm } from './supabase'
import type { FiltresVue } from './vues-sauvegardees'

/** Une valeur de cellule telle qu'un export la reçoit de la base. */
export type ValeurCellule = string | number | null | undefined

/**
 * Une cellule du fichier : une valeur absente est vide ; une valeur qui commence par `=`, `+`, `-`, `@`, une tabulation ou
 * un retour chariot est préfixée d'une apostrophe, pour qu'un tableur ne l'exécute pas comme une formule (§5.3) ; elle est
 * mise entre guillemets dès qu'elle porte le séparateur, un guillemet ou une fin de ligne, ses guillemets doublés.
 */
export function celluleCsv(valeur: ValeurCellule): string {
	if (valeur === null || valeur === undefined) return ''
	let texte = typeof valeur === 'number' ? String(valeur) : valeur
	if (typeof valeur === 'string' && /^[=+\-@\t\r]/.test(texte)) texte = `'${texte}`
	return /[";\r\n]/.test(texte) ? `"${texte.replaceAll('"', '""')}"` : texte
}

/** Le fichier : un BOM pour qu'Excel lise l'UTF-8, des lignes séparées par CRLF, la dernière comprise. */
export function documentCsv(entetes: readonly string[], lignes: readonly (readonly ValeurCellule[])[]): string {
	const rangees = [entetes, ...lignes].map((ligne) => ligne.map(celluleCsv).join(';'))
	return `﻿${rangees.map((rangee) => `${rangee}\r\n`).join('')}`
}

/** La date locale du jour, `AAAA-MM-JJ`, pour le nom du fichier. */
export function dateDuJour(maintenant: Date = new Date()): string {
	const deux = (n: number) => String(n).padStart(2, '0')
	return `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}`
}

export type LigneExportAffaire = {
	readonly card_id: string
	readonly title: string
	readonly labels: string | null
	readonly owner_name: string | null
	readonly step_label: string | null
	readonly amount: number | null
	readonly currency: string | null
	readonly next_action: string | null
	readonly next_action_at: string | null
	readonly track_slug: string
	readonly channel_slug: string
}

export type LigneExportContact = {
	readonly contact_id: string
	readonly full_name: string
	readonly email: string | null
	readonly phone: string | null
	readonly role_title: string | null
	readonly organization_name: string | null
	readonly organization_domain: string | null
	readonly created_at: string
	readonly anonymized_at: string | null
}

/** Les affaires en CSV : les colonnes de l'écran, plus l'identifiant et l'adresse de la fiche (§5.1). */
export function csvAffaires(lignes: readonly LigneExportAffaire[], origine: string): string {
	return documentCsv(
		[
			t('export.colonne.id'),
			t('export.colonne.affaire'),
			t('export.colonne.etiquettes'),
			t('export.colonne.responsable'),
			t('export.colonne.etape'),
			t('export.colonne.montant'),
			t('export.colonne.devise'),
			t('export.colonne.action'),
			t('export.colonne.echeance'),
			t('export.colonne.adresse'),
		],
		lignes.map((l) => [
			l.card_id,
			l.title,
			l.labels,
			l.owner_name,
			l.step_label,
			l.amount,
			l.currency,
			l.next_action,
			l.next_action_at,
			`${origine}/tracks/${l.track_slug}/${l.channel_slug}/cards/${l.card_id}`,
		]),
	)
}

/** Le carnet en CSV : un contact anonymisé sort tel qu'il est, sans coordonnées (§5.1). */
export function csvContacts(lignes: readonly LigneExportContact[]): string {
	return documentCsv(
		[
			t('export.colonne.id'),
			t('export.colonne.nom'),
			t('export.colonne.email'),
			t('export.colonne.telephone'),
			t('export.colonne.fonction'),
			t('export.colonne.organisation'),
			t('export.colonne.domaine'),
			t('export.colonne.creeLe'),
			t('export.colonne.anonymiseLe'),
		],
		lignes.map((l) => [
			l.contact_id,
			l.full_name,
			l.email,
			l.phone,
			l.role_title,
			l.organization_name,
			l.organization_domain,
			l.created_at,
			l.anonymized_at,
		]),
	)
}

// ---------------------------------------------------------------------------------------------
// Les appels, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusExport =
	/** `22023 export_too_large` : plus de 5 000 lignes. */
	| 'trop-grand'
	/** `P0002` : le channel ou l'espace n'existe pas pour la personne. */
	| 'introuvable'
	| 'network'
	| 'unknown'

export function classerRefusExport(statutHttp: number | undefined, message: string): NatureRefusExport {
	if (message === 'export_too_large') return 'trop-grand'
	if (message === 'channel_not_found' || message === 'workspace_not_found') return 'introuvable'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueExport<L> = { readonly statut: 'pret'; readonly lignes: readonly L[] } | { readonly statut: 'refus'; readonly nature: NatureRefusExport }

type ReponseRpc = { readonly data: unknown; readonly error: { readonly message: string } | null; readonly status: number }

async function appeler<L>(appel: () => PromiseLike<ReponseRpc>): Promise<IssueExport<L>> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) return { statut: 'refus', nature: classerRefusExport(reponse.status, reponse.error.message) }
		return { statut: 'pret', lignes: (Array.isArray(reponse.data) ? reponse.data : []) as readonly L[] }
	} catch (cause) {
		return { statut: 'refus', nature: classerRefusExport(undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}

/** Les affaires du channel que les filtres de l'écran retiennent, toutes pages confondues, dans l'ordre de la liste. */
export function exporterAffaires(client: ClientCrm, idChannel: string, filtres: FiltresVue): Promise<IssueExport<LigneExportAffaire>> {
	return appeler(() => client.rpc('export_cards', { p_channel: idChannel, p_filters: filtres as Json }))
}

export function exporterContacts(client: ClientCrm, idWorkspace: string): Promise<IssueExport<LigneExportContact>> {
	return appeler(() => client.rpc('export_contacts', { p_workspace: idWorkspace }))
}

/** Propose le fichier au téléchargement, construit dans le navigateur : rien n'est stocké. */
export function telecharger(nom: string, contenu: string): void {
	const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }))
	const lien = document.createElement('a')
	lien.href = url
	lien.download = nom
	document.body.append(lien)
	lien.click()
	lien.remove()
	URL.revokeObjectURL(url)
}
