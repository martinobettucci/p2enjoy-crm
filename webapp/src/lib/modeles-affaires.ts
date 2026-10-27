// @spec CRM-068 (docs/BACKLOG.md) — tranche T4b1 : lire, poser, modifier et archiver les modèles d'affaires ; enregistrer une
//       affaire comme modèle
// @spec docs/SPEC-checklists.md §3.5 (la table, écriture administrateur, lecture membre), §3.6 (`save_card_as_template`),
//       §4 ; docs/DESIGN_SYSTEM.md §5.71
// @spec CRM-068 (docs/BACKLOG.md) — tranche T4b2 : les questions du workflow d'un modèle et la composition de ses
//       réponses (docs/DESIGN_SYSTEM.md §5.71 bis, décision 766)
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit, et la base tranche ; ses refus sont classés ici
//
// Ce module ne rend rien : il lit, écrit et classe les refus. Les réponses d'un modèle (`field_values`) ne sont ENVOYÉES
// que lorsque la fiche a lu les questions du workflow (T4b2) : sans elles, le modèle garde les siennes.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { Json } from './database.types'
import { COLONNES_CHAMP, normaliserSaisie, type ChampFormulaire } from './formulaire'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_MODELE =
	'id, workflow_id, name, title, description, amount, currency, field_values, checklist, archived_at, created_at'

export type ModeleLu = Pick<
	Database['public']['Tables']['card_templates']['Row'],
	| 'id'
	| 'workflow_id'
	| 'name'
	| 'title'
	| 'description'
	| 'amount'
	| 'currency'
	| 'field_values'
	| 'checklist'
	| 'archived_at'
	| 'created_at'
>

export type ModeleAffaire = {
	readonly id: string
	readonly idWorkflow: string
	readonly nom: string
	readonly titre: string | null
	readonly description: string | null
	readonly montant: number | null
	readonly devise: string
	/** Le nombre de réponses reprises — leur saisie arrive avec T4b2 ; elles sont reportées telles quelles. */
	readonly nombreReponses: number
	readonly reponses: Json
	readonly points: readonly string[]
	readonly archive: boolean
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr', { sensitivity: 'base' })

/** Projette les modèles lus, triés par nom ; une liste de points mal formée se lit vide plutôt que d'inventer un libellé. */
export function projeterModeles(lignes: readonly ModeleLu[]): readonly ModeleAffaire[] {
	return lignes
		.map((ligne) => ({
			id: ligne.id,
			idWorkflow: ligne.workflow_id,
			nom: ligne.name,
			titre: ligne.title,
			description: ligne.description,
			montant: ligne.amount,
			devise: ligne.currency,
			nombreReponses:
				ligne.field_values !== null && typeof ligne.field_values === 'object' && !Array.isArray(ligne.field_values)
					? Object.keys(ligne.field_values).length
					: 0,
			reponses: ligne.field_values,
			points: Array.isArray(ligne.checklist) ? ligne.checklist.filter((p): p is string => typeof p === 'string') : [],
			archive: ligne.archived_at !== null,
		}))
		.sort((a, b) => compare(a.nom, b.nom) || compare(a.id, b.id))
}

/** Lit les modèles de l'espace — d'un seul workflow quand il est donné —, archivés compris si demandé. */
export async function lireModeles(
	client: ClientCrm,
	options: { readonly idWorkflow?: string; readonly archives?: boolean } = {},
): Promise<EtatAsync<readonly ModeleAffaire[]>> {
	try {
		let requete = client.from('card_templates').select(COLONNES_MODELE)
		if (options.idWorkflow !== undefined) requete = requete.eq('workflow_id', options.idWorkflow)
		if (options.archives !== true) requete = requete.is('archived_at', null)
		const reponse = await requete
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(projeterModeles((reponse.data ?? []) as readonly ModeleLu[]))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les modèles proposés à la création d'une affaire dans un channel : ceux, non archivés, du workflow du channel.
 *
 * Deux lectures, le channel puis ses modèles : PostgREST ne filtre pas une table par la colonne d'une autre qu'elle
 * n'embarque pas. Une panne rend une liste VIDE — le `select` n'est alors pas rendu (§5.71) et l'affaire naît sans
 * modèle, comme avant T4b1 : la création ne dépend pas de cette lecture.
 */
export async function lireModelesDuChannel(client: ClientCrm | null, idChannel: string): Promise<readonly ModeleAffaire[]> {
	if (client === null) return []
	try {
		const channel = await client.from('channels').select('workflow_id').eq('id', idChannel).maybeSingle()
		if (channel.error !== null || channel.data === null) return []
		const lus = await lireModeles(client, { idWorkflow: channel.data.workflow_id })
		return lus.statut === 'pret' ? lus.donnees : []
	} catch {
		return []
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusModele =
	/** `23505` : un modèle non archivé porte déjà ce nom, à la casse près. */
	| 'nom-pris'
	/** `23514` : nom blanc ou trop long, titre trop long, devise mal formée. */
	| 'forme'
	/** `22023` `template_checklist_invalid` : un point blanc ou de plus de 200 caractères. */
	| 'point'
	/** `22023` `template_field_unknown` ou `invalid_field_value` : une réponse que la base refuse. */
	| 'reponse'
	/** `401`, `403`, `42501` : seul l'administrateur de l'espace écrit un modèle. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré, ou le modèle a disparu. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

export function classerRefusModele(statutHttp: number | undefined, code: string | undefined, message: string): NatureRefusModele {
	if (code === '23505') return 'nom-pris'
	if (code === '23514') return 'forme'
	if (message === 'template_checklist_invalid') return 'point'
	if (message === 'template_field_unknown' || message === 'invalid_field_value') return 'reponse'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueModele =
	| { readonly statut: 'applique'; readonly id: string | null }
	| { readonly statut: 'refus'; readonly nature: NatureRefusModele }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseBrute>): Promise<IssueModele> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return { statut: 'refus', nature: classerRefusModele(reponse.status, reponse.error.code, reponse.error.message) }
		}
		if (Array.isArray(reponse.data)) {
			if (reponse.data.length === 0) return { statut: 'refus', nature: 'sans-effet' }
			const premier = reponse.data[0] as { id?: unknown }
			return { statut: 'applique', id: typeof premier.id === 'string' ? premier.id : null }
		}
		return { statut: 'applique', id: typeof reponse.data === 'string' ? reponse.data : null }
	} catch (cause) {
		return {
			statut: 'refus',
			nature: classerRefusModele(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

/** Ce que la fiche d'un modèle écrit. Les réponses ne s'y saisissent pas encore (T4b2) : elles sont reportées. */
export type SaisieModele = {
	readonly nom: string
	readonly titre: string
	readonly description: string
	/** Le montant tel que saisi : vide vaut « aucun » ; la base juge le nombre. */
	readonly montant: string
	readonly devise: string
	readonly points: readonly string[]
	/** `CRM-068` T4b2 : les réponses composées (`composerReponses`) ; absentes, la colonne n'est pas envoyée. */
	readonly reponses?: Readonly<Record<string, Json>>
}

// ---------------------------------------------------------------------------------------------
// Les réponses d'un modèle — T4b2, docs/DESIGN_SYSTEM.md §5.71 bis
// ---------------------------------------------------------------------------------------------

/** Les types qui désignent ce qui appartient à UNE affaire : ils ne se répondent pas dans un modèle (§5.71 bis). */
export const TYPES_SANS_SAISIE: ReadonlySet<string> = new Set(['contact', 'user', 'file'])

/** Ce qu'un contrôle de la fiche porte : du texte, une case, ou les clés d'une liste multiple. */
export type SaisieReponse = string | boolean | readonly string[]

/** Les questions du workflow, archivées comprises — elles disent quelles réponses sont conservées sans saisie. */
export async function lireQuestionsModele(
	client: ClientCrm,
	idWorkflow: string,
): Promise<EtatAsync<readonly ChampFormulaire[]>> {
	try {
		const reponse = await client.from('form_fields').select(COLONNES_CHAMP).eq('workflow_id', idWorkflow).order('position')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret((reponse.data ?? []) as readonly ChampFormulaire[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les questions qui se répondent dans la fiche : non archivées, et d'un type qui ne désigne pas une affaire. */
export function questionsSaisissables(champs: readonly ChampFormulaire[]): readonly ChampFormulaire[] {
	return champs.filter((c) => c.archived_at === null && !TYPES_SANS_SAISIE.has(c.type))
}

const objet = (valeur: Json | undefined): Readonly<Record<string, Json>> =>
	valeur !== null && valeur !== undefined && typeof valeur === 'object' && !Array.isArray(valeur)
		? (valeur as Record<string, Json>)
		: {}

/** L'état initial des contrôles, d'après les réponses du modèle. */
export function saisiesDepuisReponses(
	champs: readonly ChampFormulaire[],
	reponses: Json | undefined,
): Readonly<Record<string, SaisieReponse>> {
	const lues = objet(reponses)
	const saisies: Record<string, SaisieReponse> = {}
	for (const champ of questionsSaisissables(champs)) {
		const valeur = lues[champ.key]
		if (champ.type === 'checkbox') saisies[champ.key] = valeur === true
		else if (champ.type === 'multiselect')
			saisies[champ.key] = Array.isArray(valeur) ? valeur.filter((v): v is string => typeof v === 'string') : []
		else saisies[champ.key] = valeur === null || valeur === undefined ? '' : typeof valeur === 'string' ? valeur : String(valeur)
	}
	return saisies
}

/**
 * Les réponses à envoyer : celles du modèle, où chaque question saisissable prend la valeur de son contrôle. Vide — et case
 * décochée — vaut « sans réponse » : la clé est retirée (§5.71 bis). Les autres clés — questions archivées, `contact`,
 * `user`, `file` — sont reportées telles quelles.
 */
export function composerReponses(
	champs: readonly ChampFormulaire[],
	existantes: Json | undefined,
	saisies: Readonly<Record<string, SaisieReponse>>,
): Readonly<Record<string, Json>> {
	const reponses: Record<string, Json> = { ...objet(existantes) }
	for (const champ of questionsSaisissables(champs)) {
		const saisie = saisies[champ.key]
		const valeur = saisie === undefined ? null : normaliserSaisie(champ.type, saisie)
		if (valeur === null || valeur === false) delete reponses[champ.key]
		else reponses[champ.key] = valeur
	}
	return reponses
}

/** Le nombre de réponses conservées sans saisie : questions archivées ou inconnues (§5.71 bis). */
export function reponsesConserveesArchivees(champs: readonly ChampFormulaire[], reponses: Json | undefined): number {
	const actives = new Set(champs.filter((c) => c.archived_at === null).map((c) => c.key))
	return Object.keys(objet(reponses)).filter((cle) => !actives.has(cle)).length
}

/** Un montant saisi : vide vaut `null`, un nombre décimal à virgule ou à point est envoyé ; le reste est refusé avant envoi. */
export function lireMontant(texte: string): { readonly ok: true; readonly valeur: number | null } | { readonly ok: false } {
	const net = texte.trim().replace(/\s/g, '').replace(',', '.')
	if (net === '') return { ok: true, valeur: null }
	if (!/^-?\d+(\.\d{1,2})?$/.test(net)) return { ok: false }
	return { ok: true, valeur: Number(net) }
}

const colonnes = (saisie: SaisieModele, montant: number | null) => ({
	name: saisie.nom.trim(),
	title: saisie.titre.trim() === '' ? null : saisie.titre.trim(),
	description: saisie.description.trim() === '' ? null : saisie.description,
	amount: montant,
	currency: saisie.devise.trim().toUpperCase(),
	checklist: saisie.points.map((p) => p.trim()).filter((p) => p !== ''),
	...(saisie.reponses === undefined ? {} : { field_values: saisie.reponses as Json }),
})

/** Pose un modèle pour un workflow. L'auteur et les dates sont posés par la base. */
export function poserModele(
	client: ClientCrm,
	cible: { readonly idWorkspace: string; readonly idWorkflow: string },
	saisie: SaisieModele,
	montant: number | null,
): Promise<IssueModele> {
	return executer(() =>
		client
			.from('card_templates')
			.insert({ workspace_id: cible.idWorkspace, workflow_id: cible.idWorkflow, ...colonnes(saisie, montant) })
			.select('id'),
	)
}

/** Modifie un modèle ; son workflow ne change pas — ses réponses répondent aux questions de ce workflow. */
export function modifierModele(client: ClientCrm, idModele: string, saisie: SaisieModele, montant: number | null): Promise<IssueModele> {
	return executer(() => client.from('card_templates').update(colonnes(saisie, montant)).eq('id', idModele).select('id'))
}

/** Archive ou désarchive un modèle : archivé, il n'est plus proposé à la création, et son nom est libéré. */
export function archiverModele(
	client: ClientCrm,
	idModele: string,
	archive: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<IssueModele> {
	return executer(() =>
		client
			.from('card_templates')
			.update({ archived_at: archive ? maintenant() : null })
			.eq('id', idModele)
			.select('id'),
	)
}

export type NatureRefusEnregistrement = 'reserve' | 'nom-pris' | 'forme' | 'introuvable' | 'network' | 'unknown'

/** « Enregistrer comme modèle » : la base reprend titre, description, montant, réponses et libellés des points. */
export async function enregistrerCommeModele(
	client: ClientCrm,
	idRattachement: string,
	nom: string,
): Promise<{ readonly statut: 'applique'; readonly id: string } | { readonly statut: 'refus'; readonly nature: NatureRefusEnregistrement }> {
	try {
		const reponse = await client.rpc('save_card_as_template', { p_placement: idRattachement, p_name: nom })
		if (reponse.error === null) {
			return typeof reponse.data === 'string' ? { statut: 'applique', id: reponse.data } : { statut: 'refus', nature: 'unknown' }
		}
		if (reponse.error.message === 'reserved_to_admins' || reponse.status === 401 || reponse.status === 403) {
			return { statut: 'refus', nature: 'reserve' }
		}
		if (reponse.error.code === '23505') return { statut: 'refus', nature: 'nom-pris' }
		if (reponse.error.code === '23514') return { statut: 'refus', nature: 'forme' }
		if (reponse.error.message === 'placement_not_found') return { statut: 'refus', nature: 'introuvable' }
		return { statut: 'refus', nature: reponse.status === 0 ? 'network' : 'unknown' }
	} catch {
		return { statut: 'refus', nature: 'network' }
	}
}
