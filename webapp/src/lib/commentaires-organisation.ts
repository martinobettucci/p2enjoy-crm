// @spec CRM-153 (docs/BACKLOG.md) — tranche T3 : le fil de commentaires d'une organisation — lire, publier, modifier,
//       supprimer, mentionner ; les catégories posées sur une organisation — lire, poser, retirer
// @spec docs/SPEC-organisations.md §9.1 (les poses : qui peut modifier l'organisation pose et retire ; une archivée ne se
//       pose plus, se retire), §9.2 (le fil, « comme celui d'une affaire » : mêmes refus, même pierre tombale, mentions
//       qui notifient ; aucun temps réel, la fiche relit après chaque geste), §9.3 (la fiche) ; docs/SCHEMA.md
//       « Migration `0188` » ; docs/DESIGN_SYSTEM.md §5.107, §5.10, §5.44
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il lit et écrit, la RLS et les déclencheurs de la 0188 tranchent
//
// Le fil d'une organisation a la forme exacte de celui d'une affaire : les fonctions de `commentaires.ts` et `mentions.ts`
// sont réemployées, leur table en paramètre ; seuls la lecture, la publication et les mentionnables sont propres ici.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import { projeterCategoriesOrganisations, type CategorieOrganisation, type CategorieOrganisationLue } from './categories-organisations'
import {
	classerRefusPublication,
	modifierCommentaire,
	projeterFil,
	supprimerCommentaire,
	type CommentaireAffiche,
	type CommentaireLu,
	type RefusPublication,
	type ResultatGeste,
} from './commentaires'
import { poserMentions, type IssueMention, type PersonneMentionnable } from './mentions'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées ; l'auteur embarqué par la clé de `author_id` (nom par défaut de PostgreSQL). */
export const COLONNES_COMMENTAIRE_ORGANISATION =
	'id, organization_id, author_id, body, created_at, edited_at, deleted_at, deleted_by, auteur:profiles!organization_comments_author_id_fkey(id, full_name, avatar_url)'

type LigneCommentaireOrganisation = Omit<CommentaireLu, 'card_id'> & { readonly organization_id: string }

/** Le fil, du plus ancien au plus récent, pierres tombales comprises (§5.10) — la projection de l'affaire, réemployée. */
export async function lireCommentairesOrganisation(
	client: ClientCrm,
	idOrganisation: string,
): Promise<EtatAsync<readonly CommentaireAffiche[]>> {
	try {
		const reponse = await client
			.from('organization_comments')
			.select(COLONNES_COMMENTAIRE_ORGANISATION)
			.eq('organization_id', idOrganisation)
			.order('created_at')
			.order('id')
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as unknown as readonly LigneCommentaireOrganisation[]
		// `projeterFil` ne lit pas la clé de l'objet commenté : la ligne d'une organisation s'y projette telle quelle.
		return pret(projeterFil(lignes.map((l) => ({ ...l, card_id: l.organization_id }))))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Publie un commentaire. L'auteur est l'appelant : la politique l'exige (`author_id = auth.uid()`), et la colonne prend
 * `auth.uid()` par défaut ; l'espace est posé par le déclencheur depuis l'organisation.
 */
export async function publierCommentaireOrganisation(
	client: ClientCrm,
	idOrganisation: string,
	corps: string,
): Promise<
	| { readonly statut: 'publie'; readonly idCommentaire: string | null }
	| { readonly statut: 'refus'; readonly refus: RefusPublication }
> {
	try {
		const reponse = await client
			.from('organization_comments')
			// L'espace n'est PAS envoyé : la 0188 n'accorde l'insertion que sur `organization_id`, `author_id` et `body`, et le
			// déclencheur le pose depuis l'organisation. Le type généré l'exige parce que le générateur ne voit pas les
			// déclencheurs (décision 200) : l'assertion porte sur le type, jamais sur la règle.
			.insert({ organization_id: idOrganisation, body: corps } as never)
			.select('id')
		if (reponse.error !== null) {
			return { statut: 'refus', refus: classerRefusPublication(reponse.status, reponse.error.code, reponse.error.message) }
		}
		return { statut: 'publie', idCommentaire: ((reponse.data ?? []) as readonly { id: string }[])[0]?.id ?? null }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusPublication(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

export const modifierCommentaireOrganisation = (client: ClientCrm, idCommentaire: string, corps: string): Promise<ResultatGeste> =>
	modifierCommentaire(client, idCommentaire, corps, 'organization_comments')

export const supprimerCommentaireOrganisation = (client: ClientCrm, idCommentaire: string): Promise<ResultatGeste> =>
	supprimerCommentaire(client, idCommentaire, 'organization_comments')

/**
 * Les personnes qu'un commentaire d'organisation peut mentionner : les membres de l'espace, qui tous lisent
 * l'organisation (§9.2), moins l'appelant. Aucune fonction dédiée : la base ne rend que les membres des espaces dont on
 * est membre, et le déclencheur des mentions refuse un destinataire qui ne lit pas l'organisation. Retirer l'appelant
 * n'est pas une règle d'accès — s'y mentionner ne notifie personne (§9.2) —, c'est la règle de forme du §5.44.
 * Un membre sans profil lisible est écarté : une case anonyme ne se coche pas.
 */
export async function lireMentionnablesOrganisation(
	client: ClientCrm,
	idWorkspace: string,
	idAppelant: string | null,
): Promise<EtatAsync<readonly PersonneMentionnable[]>> {
	try {
		const reponse = await client
			.from('workspace_members')
			.select('user_id, profiles(id, full_name, avatar_url)')
			.eq('workspace_id', idWorkspace)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as unknown as readonly {
			readonly user_id: string
			readonly profiles: { readonly id: string; readonly full_name: string | null; readonly avatar_url: string | null } | null
		}[]
		const personnes: PersonneMentionnable[] = []
		for (const ligne of lignes) {
			const profil = ligne.profiles
			if (profil === null || profil.full_name === null || profil.id === idAppelant) continue
			personnes.push({ id: profil.id, nom: profil.full_name, avatar: profil.avatar_url })
		}
		return pret(personnes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Pose les mentions d'un commentaire d'organisation, une par une : les issues de `mentions.ts`, réemployées. */
export const poserMentionsOrganisation = (
	client: ClientCrm,
	idCommentaire: string,
	idWorkspace: string,
	personnes: readonly PersonneMentionnable[],
): Promise<readonly IssueMention[]> => poserMentions(client, idCommentaire, idWorkspace, personnes, 'organization_comment_mentions')

// ---------------------------------------------------------------------------------------------
// Les catégories posées sur une organisation
// ---------------------------------------------------------------------------------------------

/** Les catégories d'une organisation, actives d'abord puis archivées, chacune dans l'ordre du nom. */
export async function lireCategoriesDeLOrganisation(
	client: ClientCrm,
	idOrganisation: string,
): Promise<EtatAsync<readonly CategorieOrganisation[]>> {
	try {
		const reponse = await client
			.from('organization_category_links')
			.select('categorie:organization_categories(id, name, color, archived_at)')
			.eq('organization_id', idOrganisation)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as unknown as readonly { readonly categorie: CategorieOrganisationLue | null }[]
		return pret(projeterCategoriesOrganisations(lignes.map((l) => l.categorie)))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

export type NatureRefusPose =
	/** `22023 category_archived` : une catégorie archivée ne se pose plus (§9.1). */
	| 'archivee'
	/** `23505` : la catégorie est déjà posée — un autre onglet, un collègue. */
	| 'deja-posee'
	/** `401`, `403`, `42501` : pose et retrait sont à qui peut modifier l'organisation. */
	| 'forbidden'
	/** `200` et zéro ligne : la politique a filtré le retrait, ou la pose avait disparu. */
	| 'sans-effet'
	| 'network'
	| 'unknown'

export function classerRefusPose(statutHttp: number | undefined, code: string | undefined, detail: string): NatureRefusPose {
	if (code === '22023' && detail.includes('category_archived')) return 'archivee'
	if (code === '23505') return 'deja-posee'
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssuePose = { readonly statut: 'applique' } | { readonly statut: 'refus'; readonly nature: NatureRefusPose }

/** Pose (`pose` vrai) ou retire une catégorie. L'espace, l'auteur et la date sont posés par le déclencheur. */
export async function poserCategorie(
	client: ClientCrm,
	idOrganisation: string,
	idCategorie: string,
	pose: boolean,
): Promise<IssuePose> {
	try {
		const reponse = pose
			? await client
					.from('organization_category_links')
					.insert({ organization_id: idOrganisation, category_id: idCategorie } as never) // espace posé par le déclencheur
					.select('category_id')
			: await client
					.from('organization_category_links')
					.delete()
					.eq('organization_id', idOrganisation)
					.eq('category_id', idCategorie)
					.select('category_id')
		if (reponse.error !== null) {
			const detail = `${reponse.error.message} ${(reponse.error as { details?: string | null }).details ?? ''}`
			return { statut: 'refus', nature: classerRefusPose(reponse.status, reponse.error.code, detail) }
		}
		if (Array.isArray(reponse.data) && reponse.data.length === 0) return { statut: 'refus', nature: 'sans-effet' }
		return { statut: 'applique' }
	} catch {
		return { statut: 'refus', nature: 'network' }
	}
}
