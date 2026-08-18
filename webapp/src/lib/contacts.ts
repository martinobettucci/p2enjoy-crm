// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranche 4a :
//       ce que le carnet de contacts lit
// @spec docs/SPEC-contacts.md §10.3 (la lecture, mesurée), §10.4 (l'écran ne calcule aucun droit),
//       §10.7 (limites nommées : aucune pagination, aucun filtre)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, jamais une erreur)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec docs/DESIGN_SYSTEM.md §5.19 (le carnet)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE. Il lit `contacts` sous la RLS posée par la tranche 1
// (migration 0045, docs/SPEC-contacts.md §3) : la lecture est ouverte à tout membre du workspace,
// et l'écriture — que ce module n'exerce pas — au `business_developer` et à l'`admin`.
//
// MESURÉ le 2026-08-18 avec les jetons réels des trois profils seedés : l'administratrice et la
// lectrice lisent les trois contacts du seed ; un appelant anonyme reçoit `200` et `[]`. C'est
// pourquoi l'écran n'a aucun état « refusé » à mettre en scène : le refus se manifeste par une
// liste vide, et c'est l'état vide ordinaire (§10.4).

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/**
 * L'organisation telle que le carnet a besoin de la connaître : son nom, et rien de plus dans
 * cette sous-tranche.
 *
 * `domain` est demandé bien qu'aucune colonne ne le rende : c'est lui qui distinguera deux
 * organisations homonymes le jour où la fiche d'organisation (4b) sera livrée, et le demander
 * maintenant évite une seconde forme de requête pour la même relation. `id` l'accompagne pour la
 * même raison — il sera la cible du lien de 4b, aujourd'hui absent (§10.7).
 */
export type OrganisationDuContact = Pick<
	Database['public']['Tables']['organizations']['Row'],
	'id' | 'name' | 'domain'
>

/**
 * Un contact tel que le carnet l'affiche, et rien de plus.
 *
 * `source` n'y figure pas : une requête ne rapporte que ce qui est affiché (patron de
 * `lireTracks`), et le carnet n'affiche pas la provenance d'un contact — `manual`, `email` et
 * `import` ne veulent rien dire pour un commercial tant qu'aucun import n'existe (§10.3).
 *
 * `organisation` est **nulle** lorsque le contact n'est rattaché à aucune organisation. MESURÉ :
 * PostgREST rend `"organizations": null` dans ce cas, jamais une clé absente — la distinction
 * compte, `undefined` obligerait l'écran à traiter deux absences différentes.
 */
export type ContactDuCarnet = Pick<
	Database['public']['Tables']['contacts']['Row'],
	'id' | 'full_name' | 'email' | 'phone' | 'role_title' | 'organization_id'
> & {
	readonly organisation: OrganisationDuContact | null
}

/**
 * Colonnes réellement demandées. Exportée pour que le test unitaire vérifie la requête émise.
 *
 * **L'organisation est EMBARQUÉE, et c'est mesuré comme possible ici** (§10.3) : `contacts` ne
 * porte qu'une seule clé étrangère vers `organizations`, si bien que `organizations(...)` ne rend
 * aucune ambiguïté `PGRST201` — le défaut qui a imposé deux lectures séparées à
 * `compterEnfantsInaccessibles` (`corbeille.ts`) et à `lireCardsClassables` (`inbox.ts`). Une
 * seconde requête serait ici un coût gratuit.
 */
export const COLONNES_CONTACT_CARNET =
	'id, full_name, email, phone, role_title, organization_id, organizations(id, name, domain)'

/** Colonne de tri : un carnet se parcourt par le nom affiché (§10.3). */
export const TRI_CARNET = 'full_name'

/**
 * Forme brute rendue par PostgREST : la relation embarquée y porte le nom de la **table**, que ce
 * module renomme en `organisation` pour que l'écran ne dépende pas du nom d'une table anglaise.
 */
type LigneBrute = Omit<ContactDuCarnet, 'organisation'> & {
	readonly organizations: OrganisationDuContact | null
}

/**
 * Les contacts du workspace visibles par l'appelant, dans l'ordre du serveur.
 *
 * Trois propriétés portées par la requête elle-même :
 *
 *   * **aucun filtre** — `contacts` ne porte ni `archived_at` ni `deleted_at` (§2.2) : le cycle de
 *     vie d'un contact est explicitement laissé à l'arbitrage du responsable (§6, point 1), et
 *     inventer ici un masquage poserait une règle que personne n'a prise ;
 *   * **`order=full_name` côté serveur**, jamais un tri après coup : l'écran ne retrie pas ce que
 *     la base a rangé, et la collation de la base range « Élise » avant « Léo » (mesuré) ;
 *   * **aucune limite ni pagination**, limite nommée au §10.7 — poser une pagination sur une
 *     lecture dont personne n'a mesuré le volume serait de l'optimisation sans mesure
 *     (`CLAUDE.md` §21).
 *
 * Ne lève jamais : tout échec est rendu comme un état d'erreur classé sur le code HTTP réellement
 * reçu, jamais sur le texte du message (voir `classerErreur`).
 */
export async function lireContactsDuCarnet(
	client: ClientCrm,
): Promise<EtatAsync<readonly ContactDuCarnet[]>> {
	try {
		const reponse = await client
			.from('contacts')
			.select(COLONNES_CONTACT_CARNET)
			.order(TRI_CARNET)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LigneBrute[]
		return pret(
			lignes.map(({ organizations, ...contact }) => ({
				...contact,
				organisation: organizations,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}
