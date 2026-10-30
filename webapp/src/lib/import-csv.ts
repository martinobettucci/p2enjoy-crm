// @spec CRM-071 (docs/BACKLOG.md) — tranche T5 : l'import CSV du carnet — lire le fichier dans le navigateur (encodage,
//       séparateur, guillemets), reconnaître les colonnes, composer les lignes, appeler `import_contacts`, écrire le rapport
// @spec docs/SPEC-vues-import-export.md §6.1 (le fichier : 2 Mo, 1 000 lignes, UTF-8 sinon Windows-1252, `;` ou `,`, en-têtes
//       usuels reconnus, lecture locale sans dépendance), §6.2, §6.2 bis (codes d'issue), §6.5 ; docs/DESIGN_SYSTEM.md §5.77
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit ni aucun doublon : la base juge chaque ligne
//
// Ce module ne rend rien : il lit, compose, appelle et écrit le rapport. Le fichier ne quitte pas le navigateur ; seules les
// lignes composées partent, vers la fonction qui les juge.

import { t, type CleTraduction } from '../i18n'
import type { Json } from './database.types'
import { documentCsv } from './export-csv'
import type { ClientCrm } from './supabase'

export const POIDS_MAX = 2 * 1024 * 1024
export const LIGNES_MAX = 1000

/** UTF-8 d'abord ; s'il échoue, Windows-1252 — l'export par défaut d'Excel en français (§6.1). Le BOM est retiré. */
export function decoderFichier(octets: ArrayBuffer): string {
	let texte: string
	try {
		texte = new TextDecoder('utf-8', { fatal: true }).decode(octets)
	} catch {
		texte = new TextDecoder('windows-1252').decode(octets)
	}
	return texte.startsWith('﻿') ? texte.slice(1) : texte
}

/** Le séparateur, lu sur la ligne d'en-tête hors guillemets : le point-virgule s'il y en a autant ou plus que de virgules. */
export function detecterSeparateur(texte: string): ';' | ',' {
	let pointsVirgules = 0
	let virgules = 0
	let entreGuillemets = false
	for (const caractere of texte) {
		if (caractere === '"') entreGuillemets = !entreGuillemets
		else if (!entreGuillemets && (caractere === '\n' || caractere === '\r')) break
		else if (!entreGuillemets && caractere === ';') pointsVirgules += 1
		else if (!entreGuillemets && caractere === ',') virgules += 1
	}
	return pointsVirgules >= virgules ? ';' : ','
}

/** Un lecteur RFC 4180 : guillemets, guillemets doublés, séparateurs et fins de ligne dans une cellule, CRLF ou LF. */
export function lireCsv(texte: string, separateur: ';' | ',' = detecterSeparateur(texte)): string[][] {
	const rangees: string[][] = []
	let rangee: string[] = []
	let cellule = ''
	let entreGuillemets = false
	for (let i = 0; i < texte.length; i += 1) {
		const c = texte[i]!
		if (entreGuillemets) {
			if (c === '"' && texte[i + 1] === '"') {
				cellule += '"'
				i += 1
			} else if (c === '"') {
				entreGuillemets = false
			} else {
				cellule += c
			}
		} else if (c === '"') {
			entreGuillemets = true
		} else if (c === separateur) {
			rangee.push(cellule)
			cellule = ''
		} else if (c === '\n' || c === '\r') {
			if (c === '\r' && texte[i + 1] === '\n') i += 1
			rangee.push(cellule)
			rangees.push(rangee)
			rangee = []
			cellule = ''
		} else {
			cellule += c
		}
	}
	if (cellule !== '' || rangee.length > 0) {
		rangee.push(cellule)
		rangees.push(rangee)
	}
	// Une rangée entièrement vide — une ligne blanche, la fin d'un fichier — n'est pas une ligne.
	return rangees.filter((r) => r.some((v) => v.trim() !== ''))
}

export type Champ =
	| 'ignorer'
	| 'full_name'
	| 'email'
	| 'phone'
	| 'role_title'
	| 'organization_name'
	| 'organization_domain'
	| 'organization_website'

export const CHAMPS: readonly Champ[] = [
	'ignorer',
	'full_name',
	'email',
	'phone',
	'role_title',
	'organization_name',
	'organization_domain',
	'organization_website',
]

const sansAccent = (texte: string) => texte.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

const EN_TETES_USUELS: Readonly<Record<string, Champ>> = {
	nom: 'full_name',
	'nom complet': 'full_name',
	'nom et prenom': 'full_name',
	contact: 'full_name',
	name: 'full_name',
	'full name': 'full_name',
	email: 'email',
	'e-mail': 'email',
	mail: 'email',
	courriel: 'email',
	'adresse email': 'email',
	telephone: 'phone',
	tel: 'phone',
	portable: 'phone',
	mobile: 'phone',
	phone: 'phone',
	fonction: 'role_title',
	poste: 'role_title',
	titre: 'role_title',
	role: 'role_title',
	'job title': 'role_title',
	organisation: 'organization_name',
	societe: 'organization_name',
	entreprise: 'organization_name',
	company: 'organization_name',
	organization: 'organization_name',
	domaine: 'organization_domain',
	"domaine de l'organisation": 'organization_domain',
	'domaine de l’organisation': 'organization_domain',
	domain: 'organization_domain',
	site: 'organization_website',
	'site web': 'organization_website',
	"site de l'organisation": 'organization_website',
	'site de l’organisation': 'organization_website',
	website: 'organization_website',
}

/** Le champ qu'un en-tête usuel désigne, sans tenir compte des accents ni de la casse ; inconnu : ignoré. */
export function reconnaitreEnTete(enTete: string): Champ {
	return EN_TETES_USUELS[sansAccent(enTete)] ?? 'ignorer'
}

/** Une correspondance n'en associe chaque champ qu'à une colonne : la première l'emporte, les suivantes sont ignorées. */
export function correspondanceInitiale(enTetes: readonly string[]): Champ[] {
	const vus = new Set<Champ>()
	return enTetes.map((enTete) => {
		const champ = reconnaitreEnTete(enTete)
		if (champ === 'ignorer' || vus.has(champ)) return 'ignorer'
		vus.add(champ)
		return champ
	})
}

/** La correspondance peut-elle produire une ligne ? Il faut un nom de contact ou un nom d'organisation (§6.2 bis). */
export function correspondanceUtile(correspondance: readonly Champ[]): boolean {
	return correspondance.includes('full_name') || correspondance.includes('organization_name')
}

export type LigneImport = Partial<Record<Exclude<Champ, 'ignorer'>, string>>

/** Les lignes envoyées à la base : une clé par champ associé, la valeur telle que le fichier la porte. */
export function lignesPourImport(donnees: readonly (readonly string[])[], correspondance: readonly Champ[]): LigneImport[] {
	return donnees.map((rangee) => {
		const ligne: LigneImport = {}
		correspondance.forEach((champ, index) => {
			if (champ !== 'ignorer') ligne[champ] = rangee[index] ?? ''
		})
		return ligne
	})
}

// ---------------------------------------------------------------------------------------------
// L'appel, et ses refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type CodeIssue =
	| 'duplicate_email'
	| 'duplicate_organization'
	| 'name_required'
	| 'invalid_email'
	| 'invalid_domain'
	| 'invalid_website'
	| 'forbidden'
	| 'unknown'

export type IssueLigne = {
	readonly line: number
	readonly outcome: 'created' | 'skipped' | 'refused'
	readonly code: CodeIssue | null
	readonly organization_created: boolean
}

export const MOTIFS: Readonly<Record<CodeIssue, CleTraduction>> = {
	duplicate_email: 'import.motif.duplicate_email',
	duplicate_organization: 'import.motif.duplicate_organization',
	name_required: 'import.motif.name_required',
	invalid_email: 'import.motif.invalid_email',
	invalid_domain: 'import.motif.invalid_domain',
	invalid_website: 'import.motif.invalid_website',
	forbidden: 'import.motif.forbidden',
	unknown: 'import.motif.unknown',
}

/** Un code inconnu de l'écran se lit `unknown` : la base l'a refusé, l'écran ne devine pas pourquoi. */
export function motifDe(code: string | null): CleTraduction | null {
	if (code === null) return null
	return MOTIFS[code as CodeIssue] ?? MOTIFS.unknown
}

export type NatureRefusImport = 'trop-grand' | 'introuvable' | 'network' | 'unknown'

export function classerRefusImport(statutHttp: number | undefined, message: string): NatureRefusImport {
	if (message === 'import_too_large') return 'trop-grand'
	if (message === 'workspace_not_found') return 'introuvable'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueImport = { readonly statut: 'juge'; readonly issues: readonly IssueLigne[] } | { readonly statut: 'refus'; readonly nature: NatureRefusImport }

/** Fait juger les lignes par la base : en simulation, rien ne reste ; confirmé, les lignes valides sont écrites (§6.1). */
export async function importerContacts(
	client: ClientCrm,
	idWorkspace: string,
	lignes: readonly LigneImport[],
	simulation: boolean,
): Promise<IssueImport> {
	try {
		const reponse = await client.rpc('import_contacts', {
			p_workspace: idWorkspace,
			p_rows: lignes as unknown as Json,
			p_dry_run: simulation,
		})
		if (reponse.error !== null) return { statut: 'refus', nature: classerRefusImport(reponse.status, reponse.error.message) }
		return { statut: 'juge', issues: (Array.isArray(reponse.data) ? reponse.data : []) as readonly IssueLigne[] }
	} catch (cause) {
		return { statut: 'refus', nature: classerRefusImport(undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}

export type Comptes = { readonly crees: number; readonly ignores: number; readonly refuses: number; readonly organisations: number }

export function compter(issues: readonly IssueLigne[]): Comptes {
	return {
		crees: issues.filter((i) => i.outcome === 'created').length,
		ignores: issues.filter((i) => i.outcome === 'skipped').length,
		refuses: issues.filter((i) => i.outcome === 'refused').length,
		organisations: issues.filter((i) => i.organization_created).length,
	}
}

/**
 * Le rapport : les lignes ignorées et refusées, telles que le fichier les portait, suivies de leur rang et de leur motif —
 * à corriger et réimporter (§6.1, étape 5).
 */
export function rapportCsv(enTetes: readonly string[], donnees: readonly (readonly string[])[], issues: readonly IssueLigne[]): string {
	const lignes = issues
		.filter((issue) => issue.outcome !== 'created')
		.map((issue) => {
			const motif = motifDe(issue.code)
			return [...(donnees[issue.line - 1] ?? []), String(issue.line), motif === null ? '' : t(motif)]
		})
	return documentCsv([...enTetes, t('import.rapport.ligne'), t('import.rapport.motif')], lignes)
}
