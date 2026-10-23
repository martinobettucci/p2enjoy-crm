// @spec CRM-098 (docs/BACKLOG.md) — tranche T2 : la matrice de la semaine, sans rendu
// @spec docs/SPEC-temps.md §2 (unités : minutes, quart de 105, journée de 420, heures au quart d'heure), §6.1 (la
//       semaine du lundi au dimanche, la précédente pour reprendre les lignes), §6.3 (le mode d'une journée est une
//       lecture des valeurs), §7.2 (lignes : tracks, channels, affaires ; colonnes ; pied) ;
//       docs/DESIGN_SYSTEM.md §5.54 (cellule : 0 à 4 quarts ou 0 à 7 h au pas de 0,25 ; vide vaut zéro)
// @spec CRM-106 (docs/BACKLOG.md) — tranche T2 : `modesDesJours` et `remplacerDansSaisies`, partagés par la matrice et
//       la bande de la fiche d'une affaire ; docs/SPEC-temps.md §7.6 (points 2 et 4 : une valeur remplace, le mode
//       d'un jour se lit sur toutes ses saisies) ; docs/DESIGN_SYSTEM.md §5.54 bis
//
// Module pur : il ne lit rien et n'écrit rien. Les dates sont des chaînes ISO `AAAA-MM-JJ` et leur arithmétique se
// fait en UTC, pour qu'aucun fuseau ni changement d'heure ne déplace un jour.

export const MINUTES_QUART = 105
export const MINUTES_JOURNEE = 420
export const QUARTS_JOURNEE = 4
export const PAS_MINUTES = 15

export type ModeJour = 'quarts' | 'heures'

/** §6.3 : une journée est « en quarts » si toutes ses saisies tombent sur un quart, « en heures » sinon. */
export function modeDuJour(minutes: readonly number[]): ModeJour {
	return minutes.every((m) => m % MINUTES_QUART === 0) ? 'quarts' : 'heures'
}

export type LectureSaisie =
	| { readonly ok: true; readonly minutes: number }
	| { readonly ok: false; readonly motif: 'format' | 'pas' | 'borne' }

/**
 * Ce que l'on tape dans une cellule, en minutes. Vide vaut zéro (§5.54). En quarts : un entier de 0 à 4. En heures :
 * un nombre de 0 à 7, virgule ou point, au quart d'heure — « 1,5 », « 0.25 », « 7 ».
 */
export function lireSaisie(texte: string, mode: ModeJour): LectureSaisie {
	const brut = texte.trim().replace(',', '.')
	if (brut === '') return { ok: true, minutes: 0 }
	if (!/^\d+(\.\d+)?$/.test(brut)) return { ok: false, motif: 'format' }
	const valeur = Number(brut)
	if (mode === 'quarts') {
		if (!Number.isInteger(valeur)) return { ok: false, motif: 'pas' }
		if (valeur > QUARTS_JOURNEE) return { ok: false, motif: 'borne' }
		return { ok: true, minutes: valeur * MINUTES_QUART }
	}
	const minutes = Math.round(valeur * 60)
	if (Math.abs(minutes - valeur * 60) > 1e-9 || minutes % PAS_MINUTES !== 0) return { ok: false, motif: 'pas' }
	if (minutes > MINUTES_JOURNEE) return { ok: false, motif: 'borne' }
	return { ok: true, minutes }
}

/** La valeur à placer dans le champ : vide pour zéro, des quarts entiers, ou des heures à virgule (« 1,75 »). */
export function valeurDeChamp(minutes: number, mode: ModeJour): string {
	if (minutes === 0) return ''
	if (mode === 'quarts' && minutes % MINUTES_QUART === 0) return String(minutes / MINUTES_QUART)
	return String(minutes / 60).replace('.', ',')
}

export type Duree = { readonly jours: number; readonly heures: number; readonly minutes: number }

/** Une durée en heures et minutes, sans jours (« 6 h 30 »). */
export function enHeures(minutes: number): Duree {
	return { jours: 0, heures: Math.floor(minutes / 60), minutes: minutes % 60 }
}

/** Une durée en jours de 7 heures, heures et minutes (« 1 j 3 h 30 »). */
export function enJours(minutes: number): Duree {
	const jours = Math.floor(minutes / MINUTES_JOURNEE)
	const reste = minutes - jours * MINUTES_JOURNEE
	return { jours, heures: Math.floor(reste / 60), minutes: reste % 60 }
}

// ---------------------------------------------------------------------------------------------
// La semaine
// ---------------------------------------------------------------------------------------------

const enDate = (iso: string) => new Date(`${iso}T00:00:00Z`)
const enIso = (date: Date) => date.toISOString().slice(0, 10)

export function decalerJours(iso: string, jours: number): string {
	const date = enDate(iso)
	date.setUTCDate(date.getUTCDate() + jours)
	return enIso(date)
}

/** Le lundi de la semaine d'un jour donné (§6.1 : la semaine va du lundi au dimanche). */
export function lundiDe(iso: string): string {
	const jourSemaine = (enDate(iso).getUTCDay() + 6) % 7 // lundi = 0 … dimanche = 6
	return decalerJours(iso, -jourSemaine)
}

/** Le jour local d'un instant, en ISO : « aujourd'hui » est celui de la personne qui saisit. */
export function jourLocal(instant: Date): string {
	const mois = String(instant.getMonth() + 1).padStart(2, '0')
	const jour = String(instant.getDate()).padStart(2, '0')
	return `${instant.getFullYear()}-${mois}-${jour}`
}

export function joursDeLaSemaine(lundi: string): readonly string[] {
	return Array.from({ length: 7 }, (_, i) => decalerJours(lundi, i))
}

// ---------------------------------------------------------------------------------------------
// Les cibles et les lignes
// ---------------------------------------------------------------------------------------------

export type GenreCible = 'track' | 'channel' | 'card'

export type Saisie = {
	readonly id: string
	readonly jour: string
	readonly minutes: number
	readonly track_id: string | null
	readonly channel_id: string | null
	readonly card_id: string | null
}

export type Cible = { readonly genre: GenreCible; readonly id: string }

export function cibleDe(saisie: Pick<Saisie, 'track_id' | 'channel_id' | 'card_id'>): Cible {
	if (saisie.card_id !== null) return { genre: 'card', id: saisie.card_id }
	if (saisie.channel_id !== null) return { genre: 'channel', id: saisie.channel_id }
	if (saisie.track_id !== null) return { genre: 'track', id: saisie.track_id }
	throw new Error('saisie sans cible')
}

export const cleCible = (cible: Cible) => `${cible.genre}:${cible.id}`

export type ArbreTrack = {
	readonly id: string
	readonly name: string
	readonly channels: readonly { readonly id: string; readonly name: string }[]
}

export type Affaire = { readonly id: string; readonly title: string; readonly channel_id: string }

export type LigneMatrice = {
	readonly cle: string
	readonly cible: Cible
	readonly libelle: string
	/** 0 : track ; 1 : channel ; 2 : affaire (§5.54, retraits). */
	readonly niveau: 0 | 1 | 2
}

/**
 * Les lignes de la matrice (§7.2) : chaque track lisible, suivi de ses channels, et sous chaque channel les affaires
 * à montrer — celles qui portent du temps cette semaine ou la précédente (reprises d'office, point 6) et celles qu'on
 * vient d'ajouter —, par titre. Une affaire dont le channel n'est pas dans l'arbre (archivé, ou plus lisible) n'est
 * jamais perdue : elle vient en fin de matrice, pour que son temps reste visible et corrigeable.
 */
export function lignesMatrice(
	arbre: readonly ArbreTrack[],
	affaires: readonly Affaire[],
	idsAffairesAMontrer: ReadonlySet<string>,
): readonly LigneMatrice[] {
	const montrees = affaires
		.filter((a) => idsAffairesAMontrer.has(a.id))
		.slice()
		.sort((a, b) => a.title.localeCompare(b.title, 'fr'))
	const lignes: LigneMatrice[] = []
	const placees = new Set<string>()
	for (const track of arbre) {
		lignes.push({ cle: cleCible({ genre: 'track', id: track.id }), cible: { genre: 'track', id: track.id }, libelle: track.name, niveau: 0 })
		for (const channel of track.channels) {
			lignes.push({
				cle: cleCible({ genre: 'channel', id: channel.id }),
				cible: { genre: 'channel', id: channel.id },
				libelle: channel.name,
				niveau: 1,
			})
			for (const affaire of montrees.filter((a) => a.channel_id === channel.id)) {
				lignes.push({ cle: cleCible({ genre: 'card', id: affaire.id }), cible: { genre: 'card', id: affaire.id }, libelle: affaire.title, niveau: 2 })
				placees.add(affaire.id)
			}
		}
	}
	for (const affaire of montrees.filter((a) => !placees.has(a.id))) {
		lignes.push({ cle: cleCible({ genre: 'card', id: affaire.id }), cible: { genre: 'card', id: affaire.id }, libelle: affaire.title, niveau: 2 })
	}
	return lignes
}

/** Les affaires reprises d'office : celles qui portent du temps dans les saisies données (§7.2, point 6). */
export function affairesDesSaisies(saisies: readonly Saisie[]): ReadonlySet<string> {
	return new Set(saisies.flatMap((s) => (s.card_id === null ? [] : [s.card_id])))
}

/** Les minutes d'une cellule : celles de la saisie de cette cible ce jour-là, ou zéro. */
export function minutesCellule(saisies: readonly Saisie[], cle: string, jour: string): number {
	return saisies.find((s) => s.jour === jour && cleCible(cibleDe(s)) === cle)?.minutes ?? 0
}

export function totalJour(saisies: readonly Saisie[], jour: string): number {
	return saisies.filter((s) => s.jour === jour).reduce((somme, s) => somme + s.minutes, 0)
}

export function totalLigne(saisies: readonly Saisie[], cle: string, jours: readonly string[]): number {
	return saisies.filter((s) => jours.includes(s.jour) && cleCible(cibleDe(s)) === cle).reduce((somme, s) => somme + s.minutes, 0)
}

/**
 * Ce qu'une nouvelle valeur ferait au jour : la somme des AUTRES cellules du jour plus la valeur. L'écran ne refuse
 * rien lui-même (la base tient le plafond) ; il annonce seulement, avant l'envoi, qu'une valeur dépasserait la journée.
 */
export function depasseLaJournee(saisies: readonly Saisie[], cle: string, jour: string, minutes: number): boolean {
	return totalJour(saisies, jour) - minutesCellule(saisies, cle, jour) + minutes > MINUTES_JOURNEE
}

/**
 * Le mode de chaque jour : « en heures » si la case du jour est cochée, sinon ce que disent TOUTES les saisies du jour
 * (§6.3) — et non celles d'une seule ligne : la bande de la fiche d'une affaire lit le jour comme la matrice (§7.6).
 */
export function modesDesJours(
	saisies: readonly Saisie[],
	jours: readonly string[],
	heuresForcees: ReadonlySet<string>,
): Readonly<Record<string, ModeJour>> {
	return Object.fromEntries(
		jours.map((jour) => [jour, heuresForcees.has(jour) ? 'heures' : modeDuJour(saisies.filter((s) => s.jour === jour).map((s) => s.minutes))]),
	)
}

/**
 * Les saisies après une écriture acceptée : la cellule (cible × jour) ne porte plus que la ligne retenue par la base,
 * ou rien quand elle a été remise à zéro. Une valeur REMPLACE, elle ne s'additionne pas (§3.2, §7.6 point 2).
 */
export function remplacerDansSaisies(
	saisies: readonly Saisie[],
	ancienne: Saisie | null,
	nouvelle: Saisie | null,
	cle: string,
	jour: string,
): readonly Saisie[] {
	const autres = saisies.filter((s) => !(s.jour === jour && cleCible(cibleDe(s)) === cle) && s.id !== ancienne?.id)
	return nouvelle === null ? autres : [...autres, nouvelle]
}
