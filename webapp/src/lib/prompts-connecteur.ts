// @spec CRM-149 (docs/BACKLOG.md) — tranche T3 : lire les prompts du connecteur de l'espace, les ajouter, les modifier et les
//       supprimer (administrateur) ; classer les refus
// @spec docs/SPEC-mcp.md §17.2 (`mcp_prompts` : identifiant de 2 à 40 en minuscules, chiffres et tirets, unique dans
//       l'espace ; titre de 1 à 80, description de 1 à 300, texte de 1 à 8 000), §17.3 (lecture par tout membre, écriture
//       par l'administrateur ; supprimer détruit), §17.7 (l'écran) ; docs/DESIGN_SYSTEM.md §5.104 ; CLAUDE.md §10 — ce
//       module ne décide AUCUN droit : il écrit, et la base tranche
//
// Ce module ne rend rien : il lit, écrit et classe les refus.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_PROMPT = 'id, workspace_id, key, title, description, body'

/** Les bornes de la base (§17.2), dites à l'écran par `maxLength` : jamais une garde qui double une contrainte. */
export const LONGUEUR_CLE_PROMPT = 40
export const LONGUEUR_TITRE_PROMPT = 80
export const LONGUEUR_DESCRIPTION_PROMPT = 300
export const LONGUEUR_TEXTE_PROMPT = 8000

export type PromptLu = {
	readonly id: string
	readonly workspace_id: string
	readonly key: string
	readonly title: string
	readonly description: string
	readonly body: string
}

export type PromptConnecteur = {
	readonly id: string
	readonly cle: string
	readonly titre: string
	readonly description: string
	readonly texte: string
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'fr', { sensitivity: 'base' })

/** Dans l'ordre du titre, puis de l'identifiant (§5.104). */
export function projeterPrompts(lignes: readonly (PromptLu | null | undefined)[]): readonly PromptConnecteur[] {
	return lignes
		.filter((l): l is PromptLu => l !== null && l !== undefined)
		.map((l) => ({ id: l.id, cle: l.key, titre: l.title, description: l.description, texte: l.body }))
		.sort((a, b) => compare(a.titre, b.titre) || compare(a.cle, b.cle))
}

/** Les prompts de l'espace : la RLS les borne aux espaces dont on est membre. */
export async function lirePrompts(client: ClientCrm, idWorkspace: string): Promise<EtatAsync<readonly PromptConnecteur[]>> {
	try {
		const reponse = await client.from('mcp_prompts').select(COLONNES_PROMPT).eq('workspace_id', idWorkspace)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(projeterPrompts((reponse.data ?? []) as readonly PromptLu[]))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures, et leurs refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusPrompt =
	/** `23505` : un prompt de l'espace porte déjà cet identifiant. */
	| 'cle-prise'
	/** `23514` : identifiant hors forme, titre, description ou texte hors de leurs bornes. */
	| 'forme'
	/** `401`, `403`, `42501` : les prompts sont à l'administrateur de l'espace. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré, ou la ligne a disparu. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

export function classerRefusPrompt(statutHttp: number | undefined, code: string | undefined): NatureRefusPrompt {
	if (code === '23505') return 'cle-prise'
	if (code === '23514') return 'forme'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssuePrompt = { readonly statut: 'applique' } | { readonly statut: 'refus'; readonly nature: NatureRefusPrompt }

type ReponseBrute = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

async function executer(appel: () => PromiseLike<ReponseBrute>): Promise<IssuePrompt> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) return { statut: 'refus', nature: classerRefusPrompt(reponse.status, reponse.error.code) }
		if (Array.isArray(reponse.data) && reponse.data.length === 0) return { statut: 'refus', nature: 'sans-effet' }
		return { statut: 'applique' }
	} catch {
		return { statut: 'refus', nature: 'network' }
	}
}

export type SaisiePrompt = {
	readonly cle: string
	readonly titre: string
	readonly description: string
	readonly texte: string
}

/** Ce que la base reçoit : les champs resserrés, comme ses contraintes les attendent (§17.2). */
function colonnes(saisie: SaisiePrompt) {
	return {
		key: saisie.cle.trim(),
		title: saisie.titre.trim(),
		description: saisie.description.trim(),
		body: saisie.texte.trim(),
	}
}

/** Ajoute un prompt. L'auteur et les dates sont posés par la base. */
export function ajouterPrompt(client: ClientCrm, idWorkspace: string, saisie: SaisiePrompt): Promise<IssuePrompt> {
	return executer(() =>
		client
			.from('mcp_prompts')
			.insert({ workspace_id: idWorkspace, ...colonnes(saisie) })
			.select('id'),
	)
}

export function modifierPrompt(client: ClientCrm, idPrompt: string, saisie: SaisiePrompt): Promise<IssuePrompt> {
	return executer(() => client.from('mcp_prompts').update(colonnes(saisie)).eq('id', idPrompt).select('id'))
}

/** Supprime un prompt : il est détruit, rien ne le référence (décision 930). */
export function supprimerPrompt(client: ClientCrm, idPrompt: string): Promise<IssuePrompt> {
	return executer(() => client.from('mcp_prompts').delete().eq('id', idPrompt).select('id'))
}
