// @spec CRM-098 (docs/BACKLOG.md) — tranche T3 : le rapport mensuel et la série « Personnel », sans rendu
// @spec docs/SPEC-temps.md §4 (montant `null` sans version : « non valorisé », jamais zéro ; les devises ne s'additionnent
//       pas), §6.2 (`public.temps_valorise` : une ligne par personne × cible × devise, chemin complet), §7.3 (le rapport
//       mensuel : une ligne par cible, totaux, une section par personne pour « Toute l'équipe »), §7.5 (la série
//       « Personnel » du track par channel, et de l'affaire) ; docs/DESIGN_SYSTEM.md §5.54
//
// La base calcule et filtre (RLS, versions lisibles) ; ce module regroupe ce qu'elle rend. Aucun montant n'est déduit,
// aucun `null` n'est changé en zéro.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/**
 * Une ligne de `temps_valorise`. Les types générés la disent entièrement non nulle, ce que la fonction ne garantit
 * pas : le chemin d'une saisie directe sur un track n'a ni channel ni affaire, et un montant sans version lisible est
 * `null`, sa devise aussi.
 */
export type LigneValorisee = {
	readonly profile_id: string
	readonly track_id: string | null
	readonly channel_id: string | null
	readonly card_id: string | null
	readonly minutes: number
	readonly montant: number | null
	readonly devise: string | null
}

export type Filtre = { readonly profil?: string; readonly track?: string; readonly affaire?: string }

/** Le premier et le dernier jour d'un mois `AAAA-MM`. */
export function bornesDuMois(mois: string): { readonly debut: string; readonly fin: string } {
	const [an, numero] = mois.split('-').map(Number) as [number, number]
	const dernier = new Date(Date.UTC(an, numero, 0)).getUTCDate()
	return { debut: `${mois}-01`, fin: `${mois}-${String(dernier).padStart(2, '0')}` }
}

/** Toute la durée : la fiche d'une affaire cumule son temps depuis le premier jour. */
export const TOUTE_LA_DUREE = { debut: '1900-01-01', fin: '9999-12-31' } as const

export async function lireTempsValorise(
	client: ClientCrm,
	debut: string,
	fin: string,
	filtre: Filtre = {},
): Promise<EtatAsync<readonly LigneValorisee[]>> {
	try {
		const reponse = await client.rpc('temps_valorise', {
			p_debut: debut,
			p_fin: fin,
			...(filtre.profil === undefined ? {} : { p_profile: filtre.profil }),
			...(filtre.track === undefined ? {} : { p_track: filtre.track }),
			...(filtre.affaire === undefined ? {} : { p_card: filtre.affaire }),
		})
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret((reponse.data ?? []) as unknown as readonly LigneValorisee[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Des montants par devise ; une part sans version est comptée à part, en minutes, jamais en zéro. */
export type Cumul = {
	readonly minutes: number
	readonly montants: Readonly<Record<string, number>>
	readonly minutesNonValorisees: number
}

const CUMUL_VIDE: Cumul = { minutes: 0, montants: {}, minutesNonValorisees: 0 }

export function cumuler(lignes: readonly Pick<LigneValorisee, 'minutes' | 'montant' | 'devise'>[]): Cumul {
	return lignes.reduce<Cumul>((cumul, ligne) => {
		if (ligne.montant === null || ligne.devise === null) {
			return { ...cumul, minutes: cumul.minutes + ligne.minutes, minutesNonValorisees: cumul.minutesNonValorisees + ligne.minutes }
		}
		const montants = { ...cumul.montants, [ligne.devise]: arrondi((cumul.montants[ligne.devise] ?? 0) + ligne.montant) }
		return { ...cumul, minutes: cumul.minutes + ligne.minutes, montants }
	}, CUMUL_VIDE)
}

const arrondi = (montant: number) => Math.round(montant * 100) / 100

/** Une cible du rapport : son chemin, et le cumul de son temps DIRECT (ses enfants ont leurs propres lignes). */
export type LigneRapport = {
	readonly cle: string
	readonly track_id: string | null
	readonly channel_id: string | null
	readonly card_id: string | null
	readonly niveau: 0 | 1 | 2
	readonly cumul: Cumul
}

export type SectionRapport = { readonly profil: string; readonly lignes: readonly LigneRapport[]; readonly total: Cumul }

const cleChemin = (l: Pick<LigneValorisee, 'track_id' | 'channel_id' | 'card_id'>) =>
	`${l.track_id ?? '-'}/${l.channel_id ?? '-'}/${l.card_id ?? '-'}`

/**
 * Le rapport (§7.3) : une section par personne, et dans chacune une ligne par cible — les parts valorisées et non
 * valorisées d'une même cible réunies —, dans l'ordre du chemin. Les noms sont donnés par l'appelant pour l'ordre :
 * la base ne rend que des identifiants.
 */
export function composerRapport(
	lignes: readonly LigneValorisee[],
	nom: (genre: 'track' | 'channel' | 'card', id: string) => string,
): readonly SectionRapport[] {
	const parProfil = new Map<string, LigneValorisee[]>()
	for (const ligne of lignes) parProfil.set(ligne.profile_id, [...(parProfil.get(ligne.profile_id) ?? []), ligne])
	return [...parProfil.entries()].map(([profil, siennes]) => {
		const parChemin = new Map<string, LigneValorisee[]>()
		for (const l of siennes) parChemin.set(cleChemin(l), [...(parChemin.get(cleChemin(l)) ?? []), l])
		const rapport = [...parChemin.values()].map((groupe): LigneRapport => {
			const premiere = groupe[0]!
			return {
				cle: cleChemin(premiere),
				track_id: premiere.track_id,
				channel_id: premiere.channel_id,
				card_id: premiere.card_id,
				niveau: premiere.card_id !== null ? 2 : premiere.channel_id !== null ? 1 : 0,
				cumul: cumuler(groupe),
			}
		})
		const tri = (l: LigneRapport) => [
			l.track_id === null ? '￿' : nom('track', l.track_id),
			l.channel_id === null ? '' : nom('channel', l.channel_id),
			l.card_id === null ? '' : nom('card', l.card_id),
		]
		rapport.sort((a, b) => {
			const [ta, tb] = [tri(a), tri(b)]
			for (let i = 0; i < 3; i++) {
				const ordre = ta[i]!.localeCompare(tb[i]!, 'fr')
				if (ordre !== 0) return ordre
			}
			return 0
		})
		return { profil, lignes: rapport, total: cumuler(siennes) }
	})
}

/**
 * La série « Personnel » d'un track (§7.5) : un cumul par channel — le temps du channel, de ses affaires —, et une
 * ligne pour le temps saisi sur le track lui-même (`channel` nul). Ordre : le track d'abord, puis les channels.
 */
export function parChannel(lignes: readonly LigneValorisee[]): readonly { readonly channel_id: string | null; readonly cumul: Cumul }[] {
	const groupes = new Map<string | null, LigneValorisee[]>()
	for (const l of lignes) groupes.set(l.channel_id, [...(groupes.get(l.channel_id) ?? []), l])
	return [...groupes.entries()]
		.sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : 0))
		.map(([channel_id, groupe]) => ({ channel_id, cumul: cumuler(groupe) }))
}

/** Les identifiants à nommer, par sorte : la base ne rend que des identifiants. */
export function idsANommer(lignes: readonly LigneValorisee[]): {
	readonly tracks: readonly string[]
	readonly channels: readonly string[]
	readonly cards: readonly string[]
	readonly profils: readonly string[]
} {
	const unique = (valeurs: readonly (string | null)[]) => [...new Set(valeurs.filter((v): v is string => v !== null))]
	return {
		tracks: unique(lignes.map((l) => l.track_id)),
		channels: unique(lignes.map((l) => l.channel_id)),
		cards: unique(lignes.map((l) => l.card_id)),
		profils: unique(lignes.map((l) => l.profile_id)),
	}
}

export type Noms = {
	readonly tracks: ReadonlyMap<string, string>
	readonly channels: ReadonlyMap<string, string>
	readonly cards: ReadonlyMap<string, string>
	readonly profils: ReadonlyMap<string, string>
}

/**
 * Les noms des cibles et des personnes, archivés compris : un mois passé peut porter du temps sur un channel archivé
 * depuis. Une cible illisible reste sans nom, et l'écran le dit, plutôt que d'inventer un libellé. Aucune requête pour
 * une sorte vide.
 */
export async function lireNoms(client: ClientCrm, ids: ReturnType<typeof idsANommer>): Promise<EtatAsync<Noms>> {
	try {
		const vide = Promise.resolve({ data: [] as { id: string; nom: string }[], error: null, status: 200 })
		const [tracks, channels, cards, profils] = await Promise.all([
			ids.tracks.length === 0 ? vide : client.from('tracks').select('id, nom:name').in('id', [...ids.tracks]),
			ids.channels.length === 0 ? vide : client.from('channels').select('id, nom:name').in('id', [...ids.channels]),
			ids.cards.length === 0 ? vide : client.from('cards').select('id, nom:title').in('id', [...ids.cards]),
			ids.profils.length === 0 ? vide : client.from('profiles').select('id, nom:full_name').in('id', [...ids.profils]),
		])
		for (const reponse of [tracks, channels, cards, profils]) {
			if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const carte = (reponse: { data: { id: string; nom: string }[] | null }) =>
			new Map((reponse.data ?? []).map((ligne) => [ligne.id, ligne.nom] as const))
		return pret({ tracks: carte(tracks), channels: carte(channels), cards: carte(cards), profils: carte(profils) })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}
