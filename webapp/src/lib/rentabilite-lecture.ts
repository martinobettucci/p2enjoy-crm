// @spec CRM-108 (docs/BACKLOG.md) — tranche T3 : ce que l'écran « Rentabilité » et le bloc de la fiche lisent
// @spec docs/SPEC-recettes.md §5 (`public.rentabilite_affaires` : période, `p_card`, refus `42501` à qui n'administre pas),
//       §6.2 (le bloc de la fiche : absent sur `42501`), §6.3 (l'écran : la seconde lecture qui nomme et range)
// @spec CRM-111 T2.4.1 (docs/BACKLOG.md) — la seconde lecture nomme les channels des RATTACHEMENTS, et le montant est
//       celui du plus ancien (docs/SPEC-rattachements.md §5 et §6)
//
// Deux lectures, toutes deux sous la RLS de l'appelant : la fonction rend des SOMMES par affaire × devise ; la seconde
// lecture rend les NOMS (affaires, channels, tracks) et leur rang. La règle (marge, taux, partielle) est dans
// `rentabilite.ts`, sans requête.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { premierRattachement } from './rattachements'
import { lireLignesRentabilite, type LigneRentabilite, type Noms } from './rentabilite'
import type { ClientCrm } from './supabase'

export type PeriodeRentabilite = { readonly du: string | null; readonly au: string | null }

/**
 * La rentabilité sous le jeton de l'appelant. Un refus `42501` remonte en `403` : la nature `forbidden` de l'erreur est
 * alors le refus RÉSERVÉ AUX ADMINISTRATEURS — une capacité refusée par la base, jamais un rôle lu par l'écran.
 */
export async function lireRentabilite(
	client: ClientCrm,
	periode: PeriodeRentabilite,
	idCard: string | null = null,
): Promise<EtatAsync<{ readonly lignes: readonly LigneRentabilite[]; readonly ecartees: number }>> {
	try {
		const reponse = await client.rpc('rentabilite_affaires', {
			...(periode.du === null ? {} : { p_debut: periode.du }),
			...(periode.au === null ? {} : { p_fin: periode.au }),
			...(idCard === null ? {} : { p_card: idCard }),
		})
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(lireLignesRentabilite((reponse.data ?? []) as readonly Record<string, unknown>[]))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

type AffaireNommee = {
	readonly id: string
	readonly title: string
	readonly currency: string
	readonly card_placements: readonly {
		readonly id: string
		readonly created_at: string
		readonly amount: number | null
		readonly channels: {
			readonly id: string
			readonly name: string
			readonly slug: string
			readonly position: number
			readonly tracks: { readonly id: string; readonly name: string; readonly slug: string; readonly position: number } | null
		} | null
	}[]
}

/** Au plus cent identifiants par requête : une adresse `in.(…)` plus longue dépasserait ce que la passerelle accepte. */
export const TAILLE_LOT_NOMS = 100

/**
 * Les noms et les rangs des affaires du rapport, de leurs channels et de leurs tracks — une requête par lot de cent
 * affaires, aucune lecture d'arborescence entière. Une affaire que la lecture ne rend pas reste dans le rapport sous un
 * titre vide : la masquer retrancherait ses montants du total (`docs/DESIGN_SYSTEM.md` §5.37).
 *
 * `CRM-111` T2.4.1 : les channels sont ceux des RATTACHEMENTS — tous nommés, la fonction rendant le channel de chacun —,
 * et le montant de l'affaire est celui du plus ancien, la forme d'avant ; la ligne par rattachement vient avec le
 * contrat de `rentabilite_affaires` (docs/SPEC-rattachements.md §6).
 */
export async function lireNomsRentabilite(client: ClientCrm, idsCards: readonly string[]): Promise<EtatAsync<Noms>> {
	const tracks = new Map<string, { nom: string; position: number; slug: string }>()
	const channels = new Map<string, { nom: string; position: number; slug: string }>()
	const affaires = new Map<string, { titre: string; montant: number | null; devise: string }>()
	try {
		for (let i = 0; i < idsCards.length; i += TAILLE_LOT_NOMS) {
			const lot = idsCards.slice(i, i + TAILLE_LOT_NOMS)
			const reponse = await client
				.from('cards')
				.select(
					'id, title, currency, card_placements!card_placements_card_fk(id, created_at, amount, channels!card_placements_channel_fk(id, name, slug, position, tracks(id, name, slug, position)))',
				)
				.in('id', lot)
			if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
			for (const a of reponse.data as unknown as readonly AffaireNommee[]) {
				const montant = premierRattachement(a.card_placements)?.amount ?? null
				affaires.set(a.id, { titre: a.title, montant, devise: a.currency })
				for (const { channels: c } of a.card_placements) {
					if (c === null) continue
					channels.set(c.id, { nom: c.name, position: c.position, slug: c.slug })
					if (c.tracks !== null) tracks.set(c.tracks.id, { nom: c.tracks.name, position: c.tracks.position, slug: c.tracks.slug })
				}
			}
		}
		return pret({ tracks, channels, affaires })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}
