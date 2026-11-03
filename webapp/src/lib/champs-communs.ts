// @spec CRM-112 (docs/BACKLOG.md) — tranche T3.a : lire et écrire les champs communs d'un espace — déclarer, modifier,
//       réordonner, archiver et restaurer ; classer les refus
// @spec docs/SPEC-champs-communs.md §3.2 (la définition ; ni la clé ni le type ne se modifient, faute de privilège de
//       colonne), §4 (lecture par les membres, écriture par l'administrateur), §6 (`common_field_in_use`, qui nomme les
//       transitions), §7 ; docs/DESIGN_SYSTEM.md §5.86
// @spec CRM-112 tranche T3.c — docs/SPEC-champs-communs.md §3.3 (une valeur par affaire), §7 (précision T3.c : écrire par
//       mise à jour puis insertion ; la partie commune et ses champs exigés) ; docs/DESIGN_SYSTEM.md §5.88
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit, et la base tranche ; ses refus sont classés ici
//
// Ce module ne rend rien : il lit, écrit et classe les refus. Les colonnes sont celles des éléments de l'éditeur de
// champs (`ChampDeclarable`), réemployés par l'écran.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ChampDeclarable } from './administration-workflows'
import type { Json } from './database.types'
import { classerRefusValeur, type ChampResolu, type ResultatEcriture } from './formulaire'
import { estRenseigne } from './valeur-renseignee'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_CHAMP_COMMUN = 'id, key, label, type, options, help_text, position, archived_at'

/** Les champs communs de l'espace, archivés compris, dans l'ordre de la partie commune (`position`). */
export async function lireChampsCommunsEspace(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<readonly ChampDeclarable[]>> {
	try {
		const reponse = await client
			.from('card_common_fields')
			.select(COLONNES_CHAMP_COMMUN)
			.eq('workspace_id', idWorkspace)
			.order('position')
			.order('label')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(reponse.data as readonly ChampDeclarable[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusChampCommun =
	/** `23505` : un champ de l'espace porte déjà cette clé, archivés compris. */
	| 'cle-prise'
	/** `23514` : une forme que la base refuse — clé, libellé, aide, choix, devise. */
	| 'forme'
	/** `P0001 common_field_in_use` : le champ est exigé par des transitions, que `detail` nomme. */
	| 'employe'
	/** `401`, `403`, `42501` : les définitions sont à l'administrateur. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré, ou la ligne a disparu. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

export type RefusChampCommun = {
	readonly nature: NatureRefusChampCommun
	/** Pour `employe`, la liste des transitions telle que la base l'écrit — une donnée, jamais traduite. */
	readonly detail: string | null
}

export function classerRefusChampCommun(
	statutHttp: number | undefined,
	erreur: { readonly code?: string; readonly message: string; readonly details?: string | null },
): RefusChampCommun {
	if (erreur.message === 'common_field_in_use') return { nature: 'employe', detail: erreur.details ?? null }
	if (erreur.code === '23505') return { nature: 'cle-prise', detail: null }
	if (erreur.code === '23514') return { nature: 'forme', detail: null }
	if (erreur.code === '42501' || statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail: null }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail: null }
	return { nature: 'unknown', detail: null }
}

export type IssueChampCommun = { readonly statut: 'applique' } | { readonly statut: 'refus'; readonly refus: RefusChampCommun }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string; readonly details?: string | null } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseBrute>): Promise<IssueChampCommun> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) return { statut: 'refus', refus: classerRefusChampCommun(reponse.status, reponse.error) }
		if (Array.isArray(reponse.data) && reponse.data.length === 0) return { statut: 'refus', refus: { nature: 'sans-effet', detail: null } }
		return { statut: 'applique' }
	} catch (cause) {
		return { statut: 'refus', refus: classerRefusChampCommun(undefined, { message: cause instanceof Error ? cause.message : String(cause) }) }
	}
}

type Options = Database['public']['Tables']['card_common_fields']['Insert']['options']

export type DeclarationChampCommun = {
	readonly cle: string
	readonly libelle: string
	readonly type: string
	readonly aide: string | null
	readonly options: Record<string, unknown>
}

/** Déclare un champ commun. La position est posée par la base, en fin de liste (`0152`). */
export function declarerChampCommun(
	client: ClientCrm,
	idWorkspace: string,
	declaration: DeclarationChampCommun,
): Promise<IssueChampCommun> {
	return executer(() =>
		client
			.from('card_common_fields')
			// La position est posée par le déclencheur : le type généré l'exige, le privilège la permet, l'écran l'omet.
			.insert({
				workspace_id: idWorkspace,
				key: declaration.cle,
				label: declaration.libelle,
				type: declaration.type,
				help_text: declaration.aide,
				options: declaration.options as Options,
			} as unknown as Database['public']['Tables']['card_common_fields']['Insert'])
			.select('id'),
	)
}

/** Modifie le libellé, l'aide et les options. Ni la clé ni le type : la base n'en accorde pas le privilège (§3.2). */
export function modifierChampCommun(
	client: ClientCrm,
	idChamp: string,
	modification: { readonly libelle: string; readonly aide: string | null; readonly options: Record<string, unknown> },
): Promise<IssueChampCommun> {
	return executer(() =>
		client
			.from('card_common_fields')
			.update({ label: modification.libelle, help_text: modification.aide, options: modification.options as Options })
			.eq('id', idChamp)
			.select('id'),
	)
}

/** Une seule écriture : la position calculée entre ses voisines (`calculerDeplacement`). */
export function deplacerChampCommun(client: ClientCrm, idChamp: string, position: number): Promise<IssueChampCommun> {
	return executer(() => client.from('card_common_fields').update({ position }).eq('id', idChamp).select('id'))
}

/** Archive (un instant) ou restaure (`null`). L'archivage d'un champ exigé est refusé et nommé (§6). */
export function archiverChampCommun(client: ClientCrm, idChamp: string, instant: string | null): Promise<IssueChampCommun> {
	return executer(() => client.from('card_common_fields').update({ archived_at: instant }).eq('id', idChamp).select('id'))
}

// ---------------------------------------------------------------------------------------------
// La partie commune de la fiche — `CRM-112` T3.c, docs/SPEC-champs-communs.md §7, docs/DESIGN_SYSTEM.md §5.88
// ---------------------------------------------------------------------------------------------

export type ValeurCommune = { readonly field_id: string; readonly value: Json | null }

/** Les valeurs communes d'une affaire, sous la RLS : l'appelant ne les lit que s'il lit l'affaire (§4). */
export async function lireValeursCommunes(client: ClientCrm, idCard: string): Promise<EtatAsync<readonly ValeurCommune[]>> {
	try {
		const reponse = await client.from('card_common_field_values').select('field_id, value').eq('card_id', idCard)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(reponse.data as readonly ValeurCommune[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

export type EcritureValeurCommune = {
	readonly idCard: string
	readonly idChamp: string
	readonly idWorkspace: string
	readonly valeur: Json
}

/**
 * Écrit la valeur commune d'une affaire : une MISE À JOUR de sa ligne si elle existe, une INSERTION sinon. Pas d'`upsert` :
 * PostgREST y réécrit toutes les colonnes envoyées, et le privilège de colonne n'accorde la mise à jour que de `value`
 * (docs/SPEC-champs-communs.md §7). Une insertion concurrente refusée en `23505` — la ligne est née entre-temps — est
 * reprise en mise à jour.
 */
export async function ecrireValeurCommune(client: ClientCrm, ecriture: EcritureValeurCommune): Promise<ResultatEcriture> {
	const mettreAJour = () =>
		client
			.from('card_common_field_values')
			.update({ value: ecriture.valeur })
			.eq('card_id', ecriture.idCard)
			.eq('field_id', ecriture.idChamp)
			.select('field_id')
	try {
		const misAJour = await mettreAJour()
		if (misAJour.error !== null) return { statut: 'refus', refus: classerRefusValeur(misAJour.status, misAJour.error.message) }
		if ((misAJour.data ?? []).length > 0) return { statut: 'enregistree' }
		const insere = await client
			.from('card_common_field_values')
			.insert({ card_id: ecriture.idCard, field_id: ecriture.idChamp, workspace_id: ecriture.idWorkspace, value: ecriture.valeur })
			.select('field_id')
		if (insere.error === null) return { statut: 'enregistree' }
		if (insere.error.code === '23505') {
			const reprise = await mettreAJour()
			if (reprise.error === null && (reprise.data ?? []).length > 0) return { statut: 'enregistree' }
			if (reprise.error !== null) return { statut: 'refus', refus: classerRefusValeur(reprise.status, reprise.error.message) }
		}
		return { statut: 'refus', refus: classerRefusValeur(insere.status, insere.error.message) }
	} catch (cause) {
		return { statut: 'refus', refus: classerRefusValeur(undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}

/** La partie commune, prête à rendre : les champs actifs, puis les archivés qui portent une valeur (§5.88). */
export type PartieCommune = {
	readonly actifs: readonly ChampResolu[]
	readonly archives: readonly ChampResolu[]
	/** Les clés communes demandées par un déplacement refusé, dans l'ordre de la partie commune. */
	readonly clesExigeesRetenues: readonly string[]
}

/**
 * Compose la partie commune d'une affaire. Un champ commun n'a pas d'étape : sa visibilité est toujours `visible`, il
 * n'est jamais « manquant » à l'étape ; seul un déplacement refusé le demande (`exiges`). Une clé demandée qui n'est pas
 * un champ actif est ignorée, comme au formulaire (`docs/SPEC-form-composer.md` §4 ter.7).
 */
export function composerPartieCommune(
	champs: readonly ChampDeclarable[],
	valeurs: readonly ValeurCommune[],
	clesExigees: readonly string[],
): PartieCommune {
	const parChamp = new Map(valeurs.map((v) => [v.field_id, v.value]))
	const ordonnes = [...champs].sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, 'fr'))
	const resoudre = (champ: ChampDeclarable): ChampResolu => {
		const valeur = parChamp.has(champ.id) ? (parChamp.get(champ.id) ?? null) : undefined
		return {
			champ,
			visibilite: 'visible',
			valeur,
			renseigne: estRenseigne(valeur ?? undefined),
			manquant: false,
			exigeParDeplacement: champ.archived_at === null && clesExigees.includes(champ.key),
		}
	}
	const actifs = ordonnes.filter((champ) => champ.archived_at === null).map(resoudre)
	const archives = ordonnes.filter((champ) => champ.archived_at !== null).map(resoudre).filter((resolu) => resolu.renseigne)
	return { actifs, archives, clesExigeesRetenues: actifs.filter((r) => r.exigeParDeplacement).map((r) => r.champ.key) }
}
