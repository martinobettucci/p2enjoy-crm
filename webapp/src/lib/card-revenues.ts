// @spec CRM-108 (docs/BACKLOG.md) — tranche T3 : ce que le bloc « Recettes » de la fiche et l'onglet « À saisir » de
//       l'écran « Rentabilité » lisent et écrivent
// @spec docs/SPEC-recettes.md §2.1 (une ligne : nature, prévu, réel dérivé, soldée ; sa devise est celle de l'affaire),
//       §2.3 (« nul n'est pas zéro »), §3 (lecture et écriture : celles de l'affaire), §6.1 (le bloc de la fiche, son
//       pied et sa mention), §6.4 (l'onglet « À saisir » : lignes non soldées, `recette_saisissable`, saisie en série)
// @spec docs/SCHEMA.md §9 sexies (migration `0095`)
// @spec CRM-111 T2.4.1 (docs/BACKLOG.md) — l'onglet « À saisir » situe l'affaire par son plus ancien rattachement (docs/SPEC-rattachements.md §5)
//
// CE MODULE N'INVENTE AUCUNE RÈGLE, comme `card-costs.ts` : la base tient le réel dérivé, la ligne soldée figée, la
// devise verrouillée et le droit d'écrire. Rien n'est anticipé pour décider si une requête part ; le refus reçu est
// traduit (`CLAUDE.md` §10). Les réels d'une ligne s'écrivent par `lib/reels-ligne.ts`, sorte « recette ».

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import { situerLigne, type AffaireParRattachements } from './rattachements'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Les lignes d'une affaire — §6.1
// ---------------------------------------------------------------------------------------------

export type LigneRecette = Pick<
	Database['public']['Tables']['card_revenues']['Row'],
	'id' | 'card_id' | 'label' | 'estimated_amount' | 'actual_amount' | 'settled_at' | 'position'
>

export const COLONNES_LIGNE_RECETTE = 'id, card_id, label, estimated_amount, actual_amount, settled_at, position'

/** Les lignes de recette d'une affaire, dans l'ordre du contrat (`position`, attribuée par la base). */
export async function lireRecettesCard(client: ClientCrm, idCard: string): Promise<EtatAsync<readonly LigneRecette[]>> {
	try {
		const reponse = await client
			.from('card_revenues')
			.select(COLONNES_LIGNE_RECETTE)
			.eq('card_id', idCard)
			.order('position')
			.order('created_at')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Le pied du bloc : le prévu, le réel connu, et ce que le réel ne dit pas — « n lignes sans recette réelle saisie,
 * pour m de prévu » (§6.1). UNE seule devise : celle de l'affaire (§2.4). `actual_amount` nul ne compte pas dans le réel.
 */
export type TotalRecettes = {
	readonly prevu: number
	readonly reel: number
	readonly sansReel: number
	readonly prevuSansReel: number
}

export function totaliserRecettes(lignes: readonly LigneRecette[]): TotalRecettes {
	return lignes.reduce<TotalRecettes>(
		(acc, l) => {
			const reel = l.actual_amount
			return {
				prevu: acc.prevu + l.estimated_amount,
				reel: acc.reel + (reel === null ? 0 : reel),
				sansReel: acc.sansReel + (reel === null ? 1 : 0),
				prevuSansReel: acc.prevuSansReel + (reel === null ? l.estimated_amount : 0),
			}
		},
		{ prevu: 0, reel: 0, sansReel: 0, prevuSansReel: 0 },
	)
}

// ---------------------------------------------------------------------------------------------
// Les refus
// ---------------------------------------------------------------------------------------------

export type NatureRefusRecette =
	/** `403`/`401` — `42501` : il faut écrire l'affaire (§3). */
	| 'forbidden'
	/** `23514` — une nature vide, ou une écriture directe de la recette réelle. */
	| 'forme-refusee'
	/** `22003` — un montant au-delà de `numeric(14,2)`. */
	| 'montant-hors-echelle'
	/** `23503` — l'affaire a disparu. */
	| 'reference-absente'
	| 'network'
	| 'unknown'

export type RefusRecette = { readonly nature: NatureRefusRecette; readonly detail: string }

/** Le code PostgreSQL d'abord, le statut HTTP ensuite, jamais le texte : un `CHECK` remonte aussi en erreur. */
export function classerRefusRecette(statutHttp: number | undefined, code: string | undefined, detail: string): RefusRecette {
	if (code === '23503') return { nature: 'reference-absente', detail }
	if (code === '22003') return { nature: 'montant-hors-echelle', detail }
	if (code === '23514' || code === '22P02') return { nature: 'forme-refusee', detail }
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/** `sans-effet` : `200` et zéro ligne — la clause `USING` a filtré sans lever ; ni un succès, ni une erreur. */
export type ResultatRecette =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusRecette }

async function executer(
	appel: () => PromiseLike<{ error: { code?: string; message: string } | null; status: number; data: unknown[] | null }>,
): Promise<ResultatRecette> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return { statut: 'refus', refus: classerRefusRecette(reponse.status, reponse.error.code, reponse.error.message) }
		}
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusRecette(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures d'une ligne
// ---------------------------------------------------------------------------------------------

export type SaisieLigneRecette = {
	readonly libelle: string
	readonly prevu: number
	// LE RÉEL N'EN FAIT PAS PARTIE : il est la somme des réels de la ligne, tenue par la base (§2.3).
}

/**
 * Crée une ligne. `position` et `created_by` sont posés par la base. `position` est NON NULLE SANS DÉFAUT — un
 * déclencheur l'attribue (`app.card_revenues_attribuer_position`) —, que le générateur de types tient pour obligatoire :
 * la même conversion que `creerBudget` (`budgets.ts`), pour la même raison.
 */
export function creerLigneRecette(client: ClientCrm, idCard: string, saisie: SaisieLigneRecette): Promise<ResultatRecette> {
	return executer(() =>
		client
			.from('card_revenues')
			.insert({
				card_id: idCard,
				label: saisie.libelle,
				estimated_amount: saisie.prevu,
				position: null,
			} as unknown as Database['public']['Tables']['card_revenues']['Insert'])
			.select('id'),
	)
}

export function modifierLigneRecette(client: ClientCrm, id: string, saisie: SaisieLigneRecette): Promise<ResultatRecette> {
	return executer(() =>
		client
			.from('card_revenues')
			.update({ label: saisie.libelle, estimated_amount: saisie.prevu })
			.eq('id', id)
			.select('id'),
	)
}

/** Supprime une ligne et, par la cascade, ses réels. */
export function supprimerLigneRecette(client: ClientCrm, id: string): Promise<ResultatRecette> {
	return executer(() => client.from('card_revenues').delete().eq('id', id).select('id'))
}

// ---------------------------------------------------------------------------------------------
// L'onglet « À saisir » — §6.4
// ---------------------------------------------------------------------------------------------

export type AffaireDeLaRecette = {
	readonly id: string
	readonly title: string
	readonly currency: string
	readonly archived_at: string | null
	readonly channels: {
		readonly slug: string
		readonly tracks: { readonly slug: string; readonly name: string } | null
	} | null
}

export type RecetteASaisir = Pick<
	Database['public']['Tables']['card_revenues']['Row'],
	'id' | 'label' | 'estimated_amount' | 'actual_amount' | 'created_at'
> & {
	/** Rendu par la base (colonne calculée `recette_saisissable`), jamais déduit d'un rôle. */
	readonly recette_saisissable: boolean | null
	readonly cards: AffaireDeLaRecette | null
}

// La relation vers `channels` est nommée par sa clé, `card_placements` portant deux clés vers elle (`card-costs.ts`).
// `CRM-111` T2.4.1 : l'archivage et le channel de l'affaire se lisent sur son plus ancien rattachement
// (docs/SPEC-rattachements.md §5), ramenés à la forme d'avant par `situerLigne`.
export const COLONNES_RECETTE_A_SAISIR =
	'id, label, estimated_amount, actual_amount, created_at, recette_saisissable, cards!inner(id, title, currency, card_placements!card_placements_card_fk(id, created_at, archived_at, channels!card_placements_channel_fk(slug, tracks(slug, name))))'

/** Une ligne telle que `COLONNES_RECETTE_A_SAISIR` la rend, avant `situerLigne`. */
type RecetteASaisirLue = Omit<RecetteASaisir, 'cards'> & {
	readonly cards: AffaireParRattachements<AffaireDeLaRecette> | null
}

/** Toutes les lignes non soldées que l'appelant lit, la plus ancienne d'abord ; une affaire à la corbeille est exclue. */
export async function lireRecettesASaisir(client: ClientCrm): Promise<EtatAsync<readonly RecetteASaisir[]>> {
	try {
		const reponse = await client
			.from('card_revenues')
			.select(COLONNES_RECETTE_A_SAISIR)
			.is('settled_at', null)
			.is('cards.deleted_at', null)
			.order('created_at')
			.order('label')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			(reponse.data as unknown as readonly RecetteASaisirLue[]).map((ligne) =>
				situerLigne<AffaireDeLaRecette, RecetteASaisirLue>(ligne),
			),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

export const recetteSaisissable = (ligne: RecetteASaisir): boolean => ligne.recette_saisissable === true

/** Jours révolus depuis la création de la ligne ; `null` si la date est illisible. Aucun seuil : il n'en existe pas. */
export function ancienneteRecette(ligne: RecetteASaisir, maintenant: Date): number | null {
	const cree = Date.parse(ligne.created_at)
	if (!Number.isFinite(cree)) return null
	const ecoule = maintenant.getTime() - cree
	return ecoule <= 0 ? 0 : Math.floor(ecoule / 86_400_000)
}

export type ResultatSaisieRecette =
	| { readonly statut: 'applique'; readonly reel: number }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusRecette }

/**
 * Ajoute une recette réelle à une ligne, puis relit la recette réelle de la ligne : c'est elle que la colonne « Déjà
 * saisi » affiche, et la base seule la calcule. Zéro est une valeur (§6.4).
 */
export async function enregistrerRecetteReelle(
	client: ClientCrm,
	id: string,
	montant: number,
	details: { readonly date: string | null; readonly libelle: string | null } = { date: null, libelle: null },
): Promise<ResultatSaisieRecette> {
	try {
		const ajout = await client
			.from('card_revenue_actuals')
			.insert({
				card_revenue_id: id,
				amount: montant,
				label: details.libelle === null || details.libelle.trim() === '' ? null : details.libelle.trim(),
				...(details.date === null || details.date === '' ? {} : { received_on: details.date }),
			})
			.select('id')
		if (ajout.error !== null) {
			return { statut: 'refus', refus: classerRefusRecette(ajout.status, ajout.error.code, ajout.error.message) }
		}
		if ((ajout.data?.length ?? 0) === 0) return { statut: 'sans-effet' }
		const relue = await client.from('card_revenues').select('actual_amount').eq('id', id)
		if (relue.error !== null) {
			return { statut: 'refus', refus: classerRefusRecette(relue.status, relue.error.code, relue.error.message) }
		}
		const somme = relue.data?.[0]?.actual_amount
		if (typeof somme !== 'number') return { statut: 'sans-effet' }
		return { statut: 'applique', reel: somme }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusRecette(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}
