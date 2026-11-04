// @spec CRM-112 (docs/BACKLOG.md) — tranche T4.b : les filtres de la vue liste sur les champs de l'affaire — ce que l'adresse
//       porte (`c.<clé>`), ce qu'un filtre veut dire selon le type, la lecture tolérante, et le texte ramené à la forme de
//       `value_search`
// @spec CRM-112 (docs/BACKLOG.md) — tranche T4.d.2 : la forme structurée `common_fields` d'une vue et d'un export, traduite
//       depuis et vers l'adresse (docs/SPEC-champs-communs.md §8, précision T4.d ; décision 838)
// @spec docs/SPEC-champs-communs.md §8 (précision T4.b) ; docs/DESIGN_SYSTEM.md §5.92 ; docs/JOURNAL.md décision 831 ;
//       docs/SPEC-cards.md §12.2 (une adresse tapée à la main n'est pas une panne)
//
// Ce module ne lit ni n'écrit rien : il traduit l'adresse en filtres, et les filtres en adresse. La requête qui les applique
// vit dans `liste-cards.ts`, avec les autres filtres de la liste.

import { choixDuChamp, type ChampDeclarable } from './administration-workflows'

/** Le préfixe des paramètres d'adresse des filtres de champ : `c.siret=123`. La clé d'un champ ne change jamais (§3.1). */
export const PREFIXE_URL_COMMUN = 'c.'

function decoder(partie: string): string | null {
	try {
		return decodeURIComponent(partie)
	} catch {
		// Une séquence `%` mal formée tapée à la main : ce choix est ignoré, comme toute valeur illisible (§12.2).
		return null
	}
}

/** Le séparateur des deux bornes d'un intervalle : `1000..5000`, `1000..`, `..5000`. */
export const SEPARATEUR_BORNES = '..'

const FORME_CLE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const FORME_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Les types que T4.b filtre ; personne, contact et fichier sont la tranche T4.c. */
const TYPES_CONTIENT: ReadonlySet<string> = new Set(['text', 'textarea', 'email', 'phone', 'url'])
const TYPES_BORNES: ReadonlySet<string> = new Set(['number', 'money'])
const TYPES_DATES: ReadonlySet<string> = new Set(['date', 'datetime'])

/** Ce qu'un filtre retient, selon le type du champ (§8). */
export type FiltreCommun =
	| { readonly sorte: 'contient'; readonly texte: string }
	| { readonly sorte: 'choix'; readonly cles: readonly string[] }
	| { readonly sorte: 'bornes'; readonly de: number | null; readonly a: number | null }
	| { readonly sorte: 'dates'; readonly du: string | null; readonly au: string | null }
	| { readonly sorte: 'case'; readonly etat: 'oui' | 'non' | 'vide' }

/** Un filtre actif et le champ qu'il vise : ce que la requête de la liste applique. */
export type FiltreActif = { readonly champ: ChampDeclarable; readonly filtre: FiltreCommun }

/** La sorte de filtre d'un type, ou `null` : le type n'est pas filtré par T4.b. */
export function sorteDuType(type: string): FiltreCommun['sorte'] | null {
	if (TYPES_CONTIENT.has(type)) return 'contient'
	if (type === 'select' || type === 'multiselect') return 'choix'
	if (TYPES_BORNES.has(type)) return 'bornes'
	if (TYPES_DATES.has(type)) return 'dates'
	if (type === 'checkbox') return 'case'
	return null
}

/** Les champs que le panneau propose : actifs, d'un type filtré, dans l'ordre de la partie commune. Listés ou non (§8). */
export function champsFiltrables<C extends ChampDeclarable>(champs: readonly C[]): readonly C[] {
	return [...champs]
		.filter((c) => c.archived_at === null && sorteDuType(c.type) !== null)
		.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, 'fr'))
}

/** Les paramètres `c.<clé>` d'une adresse, bruts : une clé hors de forme ou une valeur vide est ignorée. */
export function lireFiltresBruts(recherche: URLSearchParams): Readonly<Record<string, string>> {
	const sortie: Record<string, string> = {}
	for (const [nom, valeur] of recherche) {
		if (!nom.startsWith(PREFIXE_URL_COMMUN)) continue
		const cle = nom.slice(PREFIXE_URL_COMMUN.length)
		const brut = valeur.trim()
		if (FORME_CLE.test(cle) && brut !== '') sortie[cle] = brut
	}
	return sortie
}

/** Les mêmes, réécrits dans l'ordre des clés : deux adresses qui filtrent la même chose s'écrivent pareil. */
export function ecrireFiltresBruts(sortie: URLSearchParams, bruts: Readonly<Record<string, string>> | undefined): void {
	for (const cle of Object.keys(bruts ?? {}).sort()) {
		const brut = bruts?.[cle]
		if (brut !== undefined && brut !== '') sortie.set(`${PREFIXE_URL_COMMUN}${cle}`, brut)
	}
}

/** Un nombre saisi : la virgule décimale française est acceptée ; `null` pour un champ vide, `NaN` pour un illisible. */
export function lireNombre(saisie: string): number | null {
	const propre = saisie.trim().replace(/\s/g, '').replace(',', '.')
	if (propre === '') return null
	return /^-?\d+(\.\d+)?$/.test(propre) ? Number(propre) : Number.NaN
}

function lireBornes<T>(brut: string, lire: (partie: string) => T | null | undefined): readonly [T | null, T | null] | null {
	const position = brut.indexOf(SEPARATEUR_BORNES)
	if (position < 0) return null
	const de = brut.slice(0, position)
	const a = brut.slice(position + SEPARATEUR_BORNES.length)
	const lu = [de === '' ? null : lire(de), a === '' ? null : lire(a)] as const
	if (lu[0] === undefined || lu[1] === undefined) return null
	if (lu[0] === null && lu[1] === null) return null
	return [lu[0], lu[1]]
}

/**
 * Le filtre qu'un paramètre brut dit pour un champ, ou `null` : rien d'appliquable. Une valeur illisible — un choix inconnu,
 * une borne qui n'est pas un nombre, une date hors de forme — est ignorée sans erreur, comme le reste de l'adresse (§12.2).
 */
export function interpreterFiltre(champ: ChampDeclarable, brut: string): FiltreCommun | null {
	switch (sorteDuType(champ.type)) {
		case 'contient':
			return brut.trim() === '' ? null : { sorte: 'contient', texte: brut.trim() }
		case 'choix': {
			const connus = new Set(choixDuChamp(champ).map((c) => c.key))
			// Une clé de choix est un texte libre (la base ne contraint que la valeur) : chacune est encodée, pour qu'une virgule
			// qu'elle porterait ne se confonde pas avec le séparateur.
			const cles = [...new Set(brut.split(',').map(decoder))].filter((cle): cle is string => cle !== null && connus.has(cle))
			return cles.length === 0 ? null : { sorte: 'choix', cles }
		}
		case 'bornes': {
			const bornes = lireBornes(brut, (partie) => {
				const n = lireNombre(partie)
				return n === null || Number.isNaN(n) ? undefined : n
			})
			return bornes === null ? null : { sorte: 'bornes', de: bornes[0], a: bornes[1] }
		}
		case 'dates': {
			const bornes = lireBornes(brut, (partie) => (FORME_DATE.test(partie) ? partie : undefined))
			return bornes === null ? null : { sorte: 'dates', du: bornes[0], au: bornes[1] }
		}
		case 'case':
			return brut === 'oui' || brut === 'non' || brut === 'vide' ? { sorte: 'case', etat: brut } : null
		default:
			return null
	}
}

/** Le paramètre brut d'un filtre ; `null` : le filtre est levé. */
export function formaterFiltre(filtre: FiltreCommun): string | null {
	switch (filtre.sorte) {
		case 'contient':
			return filtre.texte.trim() === '' ? null : filtre.texte.trim()
		case 'choix':
			return filtre.cles.length === 0 ? null : filtre.cles.map(encodeURIComponent).join(',')
		case 'bornes':
			return filtre.de === null && filtre.a === null ? null : `${filtre.de ?? ''}${SEPARATEUR_BORNES}${filtre.a ?? ''}`
		case 'dates':
			return filtre.du === null && filtre.au === null ? null : `${filtre.du ?? ''}${SEPARATEUR_BORNES}${filtre.au ?? ''}`
		case 'case':
			return filtre.etat
	}
}

/** Les filtres applicables : un paramètre dont le champ est inconnu, archivé ou d'un type non filtré est ignoré. */
export function filtresActifs(champs: readonly ChampDeclarable[], bruts: Readonly<Record<string, string>> | undefined): readonly FiltreActif[] {
	const sortie: FiltreActif[] = []
	for (const champ of champsFiltrables(champs)) {
		const brut = bruts?.[champ.key]
		if (brut === undefined) continue
		const filtre = interpreterFiltre(champ, brut)
		if (filtre !== null) sortie.push({ champ, filtre })
	}
	return sortie
}

/**
 * Le texte ramené à la forme de `value_search` (migration `0164`) : minuscules, sans accents. La base emploie
 * `unaccent` ; l'écran retire les diacritiques après décomposition — les deux s'accordent sur le français courant. Les
 * caractères spéciaux d'un `like` sont neutralisés : « 50 % » cherche « 50 % », pas « 50 » suivi de n'importe quoi.
 */
export function motifContient(texte: string): string {
	const sansAccents = texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
	return `%${sansAccents.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/** Minuit, heure de l'appareil, d'un jour `AAAA-MM-JJ`, décalé de `jours` : la borne d'un champ date et heure. */
export function minuitLocal(jour: string, jours = 0): string {
	const [annee, mois, quantieme] = jour.split('-').map(Number)
	return new Date(annee ?? 0, (mois ?? 1) - 1, (quantieme ?? 1) + jours).toISOString()
}

/**
 * Un opérande de la syntaxe `or=(…)` de PostgREST, entre guillemets : une virgule, une parenthèse ou un point dans une clé de
 * choix ne casse plus la liste. Les guillemets et barres obliques inverses sont échappés.
 */
export function operandeOu(valeur: string): string {
	return `"${valeur.replace(/[\\"]/g, (c) => `\\${c}`)}"`
}

// --- La forme structurée d'une vue et d'un export (`CRM-112` T4.d, décision 838) --------------------------------------

/** Un filtre de champ tel que la base le garde dans une vue (`common_fields`), en anglais (§8, précision T4.d). */
export type FiltreStructure =
	| { readonly contains: string }
	| { readonly any_of: readonly string[] }
	| { readonly min: number | null; readonly max: number | null }
	| { readonly from: string | null; readonly to: string | null }
	| { readonly is: 'yes' | 'no' | 'empty' }

const CASE_VERS_STRUCTURE = { oui: 'yes', non: 'no', vide: 'empty' } as const
const STRUCTURE_VERS_CASE = { yes: 'oui', no: 'non', empty: 'vide' } as const

/** La forme structurée d'un filtre. */
export function structureDe(filtre: FiltreCommun): FiltreStructure {
	switch (filtre.sorte) {
		case 'contient':
			return { contains: filtre.texte }
		case 'choix':
			return { any_of: filtre.cles }
		case 'bornes':
			return { min: filtre.de, max: filtre.a }
		case 'dates':
			return { from: filtre.du, to: filtre.au }
		case 'case':
			return { is: CASE_VERS_STRUCTURE[filtre.etat] }
	}
}

const estNombreOuNul = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v))
const estJourOuNul = (v: unknown): v is string | null => v === null || (typeof v === 'string' && FORME_DATE.test(v))

/** Le filtre qu'une forme structurée dit, ou `null` : une forme illisible est ignorée, comme l'adresse le fait (§12.2). */
export function filtreDeStructure(brut: unknown): FiltreCommun | null {
	if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return null
	const f = brut as Record<string, unknown>
	const cles = Object.keys(f)
	if (cles.length === 1 && typeof f['contains'] === 'string' && f['contains'].trim() !== '') return { sorte: 'contient', texte: f['contains'].trim() }
	if (cles.length === 1 && Array.isArray(f['any_of'])) {
		const choix = f['any_of'].filter((c): c is string => typeof c === 'string')
		return choix.length === 0 ? null : { sorte: 'choix', cles: choix }
	}
	if (cles.length === 1 && (f['is'] === 'yes' || f['is'] === 'no' || f['is'] === 'empty')) return { sorte: 'case', etat: STRUCTURE_VERS_CASE[f['is']] }
	if (cles.every((c) => c === 'min' || c === 'max')) {
		const de = f['min'] ?? null
		const a = f['max'] ?? null
		return estNombreOuNul(de) && estNombreOuNul(a) && (de !== null || a !== null) ? { sorte: 'bornes', de, a } : null
	}
	if (cles.every((c) => c === 'from' || c === 'to')) {
		const du = f['from'] ?? null
		const au = f['to'] ?? null
		return estJourOuNul(du) && estJourOuNul(au) && (du !== null || au !== null) ? { sorte: 'dates', du, au } : null
	}
	return null
}

/**
 * Les filtres de champ de l'adresse, sous la forme d'une vue. Il faut les champs : « btp,sante » est un choix ou un texte
 * selon le type. Un paramètre que les champs n'expliquent pas n'est pas gardé (`filtresActifs`).
 */
export function communsVersStructure(
	champs: readonly ChampDeclarable[],
	bruts: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, FiltreStructure>> {
	return Object.fromEntries(filtresActifs(champs, bruts).map(({ champ, filtre }) => [champ.key, structureDe(filtre)]))
}

/** Les filtres de champ d'une vue, rendus à l'adresse (`c.<clé>`) ; une forme illisible est ignorée. */
export function structureVersCommuns(structure: unknown): Readonly<Record<string, string>> {
	if (structure === null || typeof structure !== 'object' || Array.isArray(structure)) return {}
	const sortie: Record<string, string> = {}
	for (const [cle, brut] of Object.entries(structure as Record<string, unknown>)) {
		if (!FORME_CLE.test(cle)) continue
		const filtre = filtreDeStructure(brut)
		const valeur = filtre === null ? null : formaterFiltre(filtre)
		if (valeur !== null) sortie[cle] = valeur
	}
	return sortie
}

