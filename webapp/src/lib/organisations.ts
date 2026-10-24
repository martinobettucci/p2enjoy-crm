// @spec CRM-114 (docs/BACKLOG.md) — tranche T2 : lister, créer et modifier les organisations de l'espace
// @spec docs/SPEC-organisations.md §2 (ce qui est livré), §3 (droits de la base, refus traduits par un dictionnaire
//       fermé) ; docs/DESIGN_SYSTEM.md §5.64 (le domaine mis en minuscules, un champ facultatif vidé efface la valeur)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; CLAUDE.md §10 — ce module ne décide aucun droit : il écrit dans
//       `organizations`, et les politiques `organizations_insertion_bizdev_admin` et `organizations_maj_bizdev_admin`
//       décident
//
// Ce module ne rend rien : il lit, écrit et traduit. La normalisation de la saisie et le classement des refus y sont
// vérifiables sans navigateur.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Une ligne de l'onglet « Organisations » : la fiche résumée et le nombre de contacts rattachés. */
export type OrganisationListee = {
	readonly id: string
	readonly name: string
	readonly domain: string | null
	readonly website: string | null
	readonly contacts: number
}

/**
 * Colonnes réellement demandées. Exportée pour que le test vérifie la requête émise.
 *
 * Le nombre de contacts est le COMPTE EMBARQUÉ de PostgREST (`contacts(count)`), lu sous la même RLS que la ligne :
 * une seule requête, et aucun contact n'est transféré pour être compté.
 */
export const COLONNES_ORGANISATION_LISTE = 'id, name, domain, website, contacts(count)'

type LigneBrute = {
	readonly id: string
	readonly name: string
	readonly domain: string | null
	readonly website: string | null
	readonly contacts: readonly { readonly count: number }[] | null
}

/** Lit les organisations de l'espace courant, par nom — le tri du serveur, total sur l'identifiant. */
export async function lireOrganisations(client: ClientCrm): Promise<EtatAsync<readonly OrganisationListee[]>> {
	try {
		const reponse = await client
			.from('organizations')
			.select(COLONNES_ORGANISATION_LISTE)
			.order('name')
			.order('id')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as unknown as readonly LigneBrute[]
		return pret(
			lignes.map((ligne) => ({
				id: ligne.id,
				name: ligne.name,
				domain: ligne.domain,
				website: ligne.website,
				contacts: ligne.contacts?.[0]?.count ?? 0,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Ce que le formulaire saisit : trois chaînes, normalisées avant l'envoi. */
export type SaisieOrganisation = {
	readonly nom: string
	readonly domaine: string
	readonly siteWeb: string
}

export const SAISIE_ORGANISATION_VIDE: SaisieOrganisation = { nom: '', domaine: '', siteWeb: '' }

/**
 * La saisie telle que la table la reçoit. Un champ facultatif blanc devient `null` — il est EFFACÉ, jamais enregistré
 * vide. Le domaine est mis en minuscules : la base refuse une majuscule par la forme (`organizations_domain_check`), et
 * la casse d'un domaine ne porte aucune information (docs/DESIGN_SYSTEM.md §5.64).
 */
export function normaliserSaisieOrganisation(saisie: SaisieOrganisation): {
	readonly name: string
	readonly domain: string | null
	readonly website: string | null
} {
	const domaine = saisie.domaine.trim().toLowerCase()
	const site = saisie.siteWeb.trim()
	return { name: saisie.nom.trim(), domain: domaine === '' ? null : domaine, website: site === '' ? null : site }
}

/** Les natures de refus, dictionnaire fermé (docs/SPEC-organisations.md §3). */
export type NatureRefusOrganisation =
	| 'nom-invalide'
	| 'domaine-invalide'
	| 'site-invalide'
	| 'domaine-pris'
	| 'interdit'
	| 'reseau'
	| 'inconnu'

/**
 * Classe un refus par ce que la base rend : le code, puis la contrainte nommée dans le message. Zéro ligne rendue par
 * une écriture est un refus de la politique — `interdit` —, jamais un succès.
 */
export function classerRefusOrganisation(
	statutHttp: number | undefined,
	code: string | undefined,
	message: string,
): NatureRefusOrganisation {
	if (code === '23505') return 'domaine-pris'
	if (code === '23514') {
		if (message.includes('organizations_name_check')) return 'nom-invalide'
		if (message.includes('organizations_domain_check')) return 'domaine-invalide'
		if (message.includes('organizations_website_check')) return 'site-invalide'
		return 'inconnu'
	}
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'interdit'
	if (statutHttp === undefined || statutHttp === 0) return 'reseau'
	return 'inconnu'
}

export type IssueOrganisation =
	| { readonly statut: 'enregistree'; readonly id: string }
	| { readonly statut: 'refus'; readonly nature: NatureRefusOrganisation }

type ReponseEcriture = {
	readonly data: unknown
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
}

function issue(reponse: ReponseEcriture): IssueOrganisation {
	if (reponse.error !== null) {
		return { statut: 'refus', nature: classerRefusOrganisation(reponse.status, reponse.error.code, reponse.error.message) }
	}
	const lignes = (reponse.data ?? []) as readonly { readonly id: string }[]
	const [ligne] = lignes
	return ligne === undefined ? { statut: 'refus', nature: 'interdit' } : { statut: 'enregistree', id: ligne.id }
}

const refusDeCause = (cause: unknown): IssueOrganisation => ({
	statut: 'refus',
	nature: classerRefusOrganisation(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
})

/** Crée une organisation dans l'espace ; rend son identifiant, pour ouvrir sa fiche. */
export async function creerOrganisation(
	client: ClientCrm,
	idWorkspace: string,
	saisie: SaisieOrganisation,
): Promise<IssueOrganisation> {
	try {
		return issue(
			await client
				.from('organizations')
				.insert({ workspace_id: idWorkspace, ...normaliserSaisieOrganisation(saisie) })
				.select('id'),
		)
	} catch (cause) {
		return refusDeCause(cause)
	}
}

/** Réécrit les trois champs d'une organisation ; un champ facultatif vidé est effacé. */
export async function modifierOrganisation(
	client: ClientCrm,
	idOrganisation: string,
	saisie: SaisieOrganisation,
): Promise<IssueOrganisation> {
	try {
		return issue(
			await client
				.from('organizations')
				.update(normaliserSaisieOrganisation(saisie))
				.eq('id', idOrganisation)
				.select('id'),
		)
	} catch (cause) {
		return refusDeCause(cause)
	}
}
