// @spec CRM-071 (docs/BACKLOG.md) — tranche T2 : lire les vues sauvegardées d'un channel, les écrire, traduire leurs filtres
//       vers les paramètres de la vue liste et dire quand ceux-ci s'en écartent ; classer les refus
// @spec docs/SPEC-vues-import-export.md §2.2 (les clés stockées, en anglais), §2.3 (qui écrit : la base tranche), §3 (la vue
//       choisie portée par l'adresse, décision 777) ; docs/DESIGN_SYSTEM.md §5.75
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit, et la base tranche ; ses refus sont classés ici
//
// Ce module ne rend rien : il lit, écrit, traduit et classe les refus.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database, Json } from './database.types'
import { MODE_SOMMEIL_PAR_DEFAUT } from './filtre-sommeil'
import { PARAMETRES_PAR_DEFAUT, TRIS, TRI_PAR_DEFAUT, type CleTri, type ParametresListe } from './liste-cards'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_VUE = 'id, name, visibility, filters'

/** Les filtres tels que la base les garde : six clés fermées, en anglais (§2.2), une clé absente valant son défaut. */
export type FiltresVue = {
	readonly sort?: CleTri
	readonly direction?: 'asc' | 'desc'
	readonly step_id?: string
	readonly label_id?: string
	readonly search?: string
	readonly snoozed?: 'hidden' | 'shown'
}

export type VueSauvegardee = {
	readonly id: string
	readonly nom: string
	/** `privee` : celle de la personne, la seule que la base lui rende ; `espace` : publiée par un administrateur. */
	readonly visibilite: 'privee' | 'espace'
	readonly filtres: FiltresVue
}

type LigneVue = { readonly id: string; readonly name: string; readonly visibility: string; readonly filters: unknown }

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const compare = (a: string, b: string): number => a.localeCompare(b, 'fr', { sensitivity: 'base' })

/** Relit des filtres venus du réseau, en repliant ce que la contrainte de la base aurait dû refuser. */
export function lireFiltres(brut: unknown): FiltresVue {
	if (brut === null || typeof brut !== 'object' || Array.isArray(brut)) return {}
	const f = brut as Record<string, unknown>
	const tri = TRIS.find((candidat) => candidat.cle === f['sort'])?.cle
	return {
		...(tri === undefined ? {} : { sort: tri }),
		...(f['direction'] === 'asc' || f['direction'] === 'desc' ? { direction: f['direction'] } : {}),
		...(typeof f['step_id'] === 'string' && FORME_UUID.test(f['step_id']) ? { step_id: f['step_id'] } : {}),
		...(typeof f['label_id'] === 'string' && FORME_UUID.test(f['label_id']) ? { label_id: f['label_id'] } : {}),
		...(typeof f['search'] === 'string' && f['search'].trim() !== '' ? { search: f['search'].trim() } : {}),
		...(f['snoozed'] === 'hidden' || f['snoozed'] === 'shown' ? { snoozed: f['snoozed'] } : {}),
	}
}

/**
 * Les filtres d'une vue, depuis les paramètres de la liste. Comme `ecrireParametres`, une valeur par défaut n'est pas
 * écrite : deux vues qui montrent la même chose portent les mêmes filtres. La page n'en fait jamais partie.
 */
export function filtresDepuisParametres(parametres: ParametresListe): FiltresVue {
	const sensParDefaut = TRIS.find((candidat) => candidat.cle === parametres.tri)?.sensParDefaut ?? 'asc'
	return {
		...(parametres.tri === TRI_PAR_DEFAUT ? {} : { sort: parametres.tri }),
		...(parametres.sens === sensParDefaut ? {} : { direction: parametres.sens }),
		...(parametres.etape === null ? {} : { step_id: parametres.etape }),
		...(parametres.etiquette === null || parametres.etiquette === undefined ? {} : { label_id: parametres.etiquette }),
		...(parametres.recherche === '' ? {} : { search: parametres.recherche }),
		...(parametres.sommeil === MODE_SOMMEIL_PAR_DEFAUT ? {} : { snoozed: 'shown' as const }),
	}
}

/** Les paramètres de la liste qu'une vue compose : ses filtres, la première page, et la vue choisie (décision 777). */
export function parametresDepuisVue(vue: VueSauvegardee): ParametresListe {
	const f = vue.filtres
	const tri = f.sort ?? TRI_PAR_DEFAUT
	const sensParDefaut = TRIS.find((candidat) => candidat.cle === tri)?.sensParDefaut ?? PARAMETRES_PAR_DEFAUT.sens
	return {
		tri,
		sens: f.direction ?? sensParDefaut,
		etape: f.step_id ?? null,
		etiquette: f.label_id ?? null,
		recherche: f.search ?? '',
		page: 1,
		sommeil: f.snoozed === 'shown' ? 'visibles' : MODE_SOMMEIL_PAR_DEFAUT,
		vue: vue.id,
	}
}

/** Les paramètres courants s'écartent-ils de la vue ? La page n'y compte pas : changer de page ne modifie pas une vue. */
export function filtresEcartes(parametres: ParametresListe, vue: VueSauvegardee): boolean {
	const courants = filtresDepuisParametres(parametres)
	const cles = ['sort', 'direction', 'step_id', 'label_id', 'search', 'snoozed'] as const
	return cles.some((cle) => courants[cle] !== vue.filtres[cle])
}

/** Les vues du channel que la base rend à la personne — les siennes et celles de l'espace —, chacune par nom. */
export async function lireVues(client: ClientCrm, idChannel: string): Promise<EtatAsync<readonly VueSauvegardee[]>> {
	try {
		const reponse = await client.from('saved_views').select(COLONNES_VUE).eq('channel_id', idChannel)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const vues = ((reponse.data ?? []) as readonly LigneVue[])
			.map((l): VueSauvegardee => ({
				id: l.id,
				nom: l.name,
				visibilite: l.visibility === 'workspace' ? 'espace' : 'privee',
				filtres: lireFiltres(l.filters),
			}))
			.sort((a, b) => compare(a.nom, b.nom) || compare(a.id, b.id))
		return pret(vues)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusVue =
	/** `23505` : une vue porte déjà ce nom, à la casse et aux blancs près. */
	| 'nom-pris'
	/** `23514` : nom blanc ou de plus de 60 caractères, ou filtres hors des six clés. */
	| 'forme'
	/** `22023 saved_view_cannot_be_unpublished` : une vue publiée ne redevient pas privée. */
	| 'depublication'
	/** `401`, `403`, `42501` : publier ou écrire une vue de l'espace est réservé aux administrateurs. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré, ou la vue a disparu. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

export function classerRefusVue(statutHttp: number | undefined, code: string | undefined, message: string): NatureRefusVue {
	if (code === '23505') return 'nom-pris'
	if (code === '23514') return 'forme'
	if (message === 'saved_view_cannot_be_unpublished') return 'depublication'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueVue =
	| { readonly statut: 'applique'; readonly id: string }
	| { readonly statut: 'refus'; readonly nature: NatureRefusVue }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseBrute>): Promise<IssueVue> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return { statut: 'refus', nature: classerRefusVue(reponse.status, reponse.error.code, reponse.error.message) }
		}
		const lignes = Array.isArray(reponse.data) ? (reponse.data as readonly { readonly id?: unknown }[]) : []
		const id = lignes[0]?.id
		if (typeof id !== 'string') return { statut: 'refus', nature: 'sans-effet' }
		return { statut: 'applique', id }
	} catch (cause) {
		return { statut: 'refus', nature: classerRefusVue(undefined, undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}

/** Enregistre une vue : la personne et l'espace sont posés par la base (`app.saved_views_avant`, migration 0135). */
export function enregistrerVue(
	client: ClientCrm,
	idChannel: string,
	saisie: { readonly nom: string; readonly publier: boolean; readonly filtres: FiltresVue },
): Promise<IssueVue> {
	return executer(() =>
		client
			.from('saved_views')
			// Le générateur exige `workspace_id` et `owner_id`, que la base pose et que le privilège de colonne refuse au client.
			.insert({
				channel_id: idChannel,
				name: saisie.nom.trim(),
				visibility: saisie.publier ? 'workspace' : 'private',
				filters: saisie.filtres as Json,
			} as unknown as Database['public']['Tables']['saved_views']['Insert'])
			.select('id'),
	)
}

/** Modifie le nom, et publie une vue privée pour l'espace si `publier` est vrai (§2.3 : jamais l'inverse). */
export function modifierVue(
	client: ClientCrm,
	idVue: string,
	saisie: { readonly nom: string; readonly publier: boolean },
): Promise<IssueVue> {
	return executer(() =>
		client
			.from('saved_views')
			.update({ name: saisie.nom.trim(), ...(saisie.publier ? { visibility: 'workspace' } : {}) })
			.eq('id', idVue)
			.select('id'),
	)
}

/** Remplace les filtres d'une vue par ceux de l'écran. */
export function mettreAJourVue(client: ClientCrm, idVue: string, filtres: FiltresVue): Promise<IssueVue> {
	return executer(() => client.from('saved_views').update({ filters: filtres as Json }).eq('id', idVue).select('id'))
}

export function supprimerVue(client: ClientCrm, idVue: string): Promise<IssueVue> {
	return executer(() => client.from('saved_views').delete().eq('id', idVue).select('id'))
}
