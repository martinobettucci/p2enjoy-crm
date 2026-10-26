// @spec CRM-072 (docs/BACKLOG.md) — tranche T3 : le volet RGPD d'un contact, export et anonymisation
// @spec docs/SPEC-audit.md §7.1 (`export_contact` : un objet versionné, jamais stocké), §7.2 (`anonymize_contact` : le
//       nom retapé, les refus), §9 (le fichier proposé au téléchargement) ; docs/DESIGN_SYSTEM.md §5.67 (dictionnaire
//       fermé des refus) ; docs/JOURNAL.md décisions 725, 726 et 732
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : les deux fonctions sont gardées en base, et l'écran traduit
//       ce qu'elles refusent

import type { Json } from './database.types'
import type { ClientCrm } from './supabase'

/** Les refus des deux gestes, chacun nommé (`docs/DESIGN_SYSTEM.md` §5.67) ; le message du serveur n'atteint jamais l'écran. */
export type MotifRefusRgpd = 'reserve' | 'introuvable' | 'confirmation' | 'deja-anonymise' | 'reseau' | 'inconnu'

type ErreurPostgrest = { readonly code?: string; readonly message?: string } | null

/** Le motif d'un refus, lu sur le code de la base, puis sur le statut HTTP. */
export function motifRefusRgpd(erreur: ErreurPostgrest, statut: number | undefined): MotifRefusRgpd {
	const code = erreur?.code
	const message = erreur?.message ?? ''
	if (code === '42501' || statut === 401 || statut === 403) return 'reserve'
	if (code === 'P0002') return 'introuvable'
	if (code === '22023' || message.includes('confirmation_mismatch')) return 'confirmation'
	if (message.includes('contact_anonymized')) return 'deja-anonymise'
	if (statut === undefined || statut === 0) return 'reseau'
	return 'inconnu'
}

export type IssueRgpd = { readonly ok: true } | { readonly ok: false; readonly motif: MotifRefusRgpd }

/** L'export d'un contact : l'objet rendu par la base, tel quel. Rien n'est stocké. */
export async function exporterContact(
	client: ClientCrm,
	idContact: string,
): Promise<{ readonly ok: true; readonly donnees: Json } | { readonly ok: false; readonly motif: MotifRefusRgpd }> {
	try {
		const reponse = await client.rpc('export_contact', { p_contact: idContact })
		if (reponse.error !== null) return { ok: false, motif: motifRefusRgpd(reponse.error, reponse.status) }
		return { ok: true, donnees: reponse.data }
	} catch {
		return { ok: false, motif: 'reseau' }
	}
}

/** L'anonymisation, confirmée par le nom retapé ; la base compare, l'écran ne compare que pour éteindre son bouton. */
export async function anonymiserContact(client: ClientCrm, idContact: string, confirmation: string): Promise<IssueRgpd> {
	try {
		const reponse = await client.rpc('anonymize_contact', { p_contact: idContact, p_confirmation: confirmation })
		if (reponse.error !== null) return { ok: false, motif: motifRefusRgpd(reponse.error, reponse.status) }
		return { ok: true }
	} catch {
		return { ok: false, motif: 'reseau' }
	}
}

/** Le nom du fichier : `contact-<8 premiers caractères>-<AAAA-MM-JJ>.json`, au jour local (§5.67). */
export function nomFichierExport(idContact: string, maintenant: Date): string {
	const jour = [
		String(maintenant.getFullYear()),
		String(maintenant.getMonth() + 1).padStart(2, '0'),
		String(maintenant.getDate()).padStart(2, '0'),
	].join('-')
	return `contact-${idContact.slice(0, 8)}-${jour}.json`
}

/** Le contenu du fichier : l'objet de la base, indenté pour être lu par une personne. */
export function contenuFichierExport(donnees: Json): string {
	return `${JSON.stringify(donnees, null, 2)}\n`
}
