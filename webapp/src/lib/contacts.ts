// @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, tranche 4 sous-tranches 4a, 4b
//       et 4c : ce que le carnet lit, ce que la fiche d'organisation lit, et ce que le bloc des
//       contacts d'une affaire lit ET ÉCRIT (le §12 porte ses propres commentaires plus bas)
// @spec docs/SPEC-contacts.md §10.3 (la lecture du carnet, mesurée), §10.4 (l'écran ne calcule
//       aucun droit), §10.7 (limites nommées : aucune pagination, aucun filtre)
// @spec docs/SPEC-contacts.md §11.3 (la lecture de la fiche, mesurée), §11.4 (trois absences
//       rendent le même écran, et la forme de l'identifiant est contrôlée d'abord),
//       §11.8 (limites nommées de la fiche)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne, jamais une erreur)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
// @spec docs/DESIGN_SYSTEM.md §5.19 (le carnet), §5.20 (la fiche d'organisation)
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

/**
 * Le libellé d'un contact dans une liste de choix — docs/SPEC-contacts.md §13.3,
 * docs/DESIGN_SYSTEM.md §5.21 et §5.22.
 *
 * L'ORGANISATION DISTINGUE DEUX HOMONYMES, et la composition reste une **donnée** : le nom d'un
 * contact et celui de son organisation sont tous deux des libellés métier, jamais des traductions
 * (docs/DESIGN_SYSTEM.md §10). Le tiret cadratin est celui du sélecteur de la sous-tranche 4c.
 *
 * EXTRAITE ICI par la sous-tranche 4d, où un second sélecteur — celui du formulaire — a besoin de
 * la même règle : écrite deux fois, elle divergerait au premier changement.
 */
export function libelleContactAvecOrganisation(contact: {
	readonly full_name: string
	readonly organisation: { readonly name: string } | null
}): string {
	return contact.organisation === null
		? contact.full_name
		: `${contact.full_name} — ${contact.organisation.name}`
}

// ----------------------------------------------------------------------------------------------
// Sous-tranche 4b — LA FICHE D'ORGANISATION (docs/SPEC-contacts.md §11)
// ----------------------------------------------------------------------------------------------

/**
 * Un contact tel que la fiche d'organisation l'affiche.
 *
 * `organization_id` n'y figure PAS, contrairement à `ContactDuCarnet` : sur cette surface, tous
 * les contacts appartiennent à l'organisation de la page — le répéter ligne à ligne ne dirait
 * rien (§11.5, le tableau a quatre colonnes et non cinq).
 */
export type ContactDeLOrganisation = Pick<
	Database['public']['Tables']['contacts']['Row'],
	'id' | 'full_name' | 'email' | 'phone' | 'role_title'
>

/**
 * Une organisation telle que sa fiche la rend : ce qui la caractérise, et ses contacts.
 *
 * `website` EST demandé, là où le carnet ne le demandait pas : c'est précisément la fiche qui
 * caractérise l'organisation (§11.3).
 */
export type FicheOrganisationLue = Pick<
	Database['public']['Tables']['organizations']['Row'],
	'id' | 'name' | 'domain' | 'website'
> & {
	readonly contacts: readonly ContactDeLOrganisation[]
}

/**
 * Colonnes réellement demandées par la fiche. Exportée pour que le test unitaire vérifie la
 * requête émise.
 *
 * **UNE seule requête, et l'embarquement est mesuré comme possible dans ce sens aussi** (§11.3).
 * Le §10.3 avait établi que `contacts → organizations` ne rend aucune ambiguïté `PGRST201` ; la
 * mesure du 2026-08-18 établit la même chose dans le sens inverse, la clé étrangère restant
 * unique. Une seconde requête serait ici un coût gratuit.
 */
export const COLONNES_FICHE_ORGANISATION =
	'id, name, domain, website, contacts(id, full_name, email, phone, role_title)'

/**
 * Tri des contacts EMBARQUÉS, demandé au serveur et non posé après coup (§11.3) — la règle du
 * §10.3 vaut pour une relation embarquée comme pour une table.
 *
 * **Le tri d'une relation embarquée ne se demande PAS comme celui d'une table, et c'est MESURÉ.**
 * `order('contacts(full_name)')` construit `order=contacts(full_name)`, que PostgREST refuse par
 * `PGRST108` : « 'contacts' is not an embedded resource in this request ». La forme correcte passe
 * par `referencedTable`, qui construit le `contacts.order=full_name` relevé au §11.3. Les deux
 * constantes sont donc exportées séparément, et le test unitaire vérifie le couple réellement
 * transmis plutôt qu'une chaîne recomposée.
 */
export const TRI_CONTACTS_FICHE = 'full_name'
export const TABLE_TRI_CONTACTS_FICHE = 'contacts'

/**
 * Forme d'un identifiant d'organisation, telle que PostgreSQL l'exige.
 *
 * MESURÉ le 2026-08-18 : un `id` qui n'est pas un uuid rend `400` et `22P02`,
 * `invalid input syntax for type uuid`. Classé par `classerErreur`, ce `400` tomberait sur l'état
 * d'ERREUR, dont l'action de reprise relancerait la même requête pour recevoir le même `400` —
 * **une commande morte** (docs/DESIGN_SYSTEM.md §5.10), sur une surface dont l'adresse est
 * directement éditable par l'utilisateur.
 *
 * Le contrôle porte sur la FORME seule (§11.4) : il ne prétend pas savoir si l'organisation
 * existe, ce que seul le backend peut dire.
 */
const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Vrai lorsque la chaîne a la forme d'un uuid. Exportée pour être éprouvée directement. */
export function estFormeUuid(valeur: string | undefined): valeur is string {
	return valeur !== undefined && FORME_UUID.test(valeur)
}

/** Forme brute rendue par PostgREST pour la fiche : `contacts` peut manquer, jamais être `null`. */
type LigneFicheBrute = Omit<FicheOrganisationLue, 'contacts'> & {
	readonly contacts?: readonly ContactDeLOrganisation[] | null
}

/**
 * L'organisation désignée par `idOrganisation`, avec ses contacts — ou `null` lorsqu'elle n'est
 * pas lisible.
 *
 * **`null` recouvre TROIS situations, et c'est délibéré** (§11.4) : l'organisation n'existe pas,
 * l'appelant n'a pas le droit de la lire, ou l'identifiant n'a pas la forme d'un uuid. MESURÉ :
 * les deux premières rendent toutes deux `200` et `[]` — les distinguer renseignerait un appelant
 * sans droit sur l'EXISTENCE d'une organisation (docs/SPEC-permissions-rls.md §7).
 *
 * Un identifiant mal formé **n'émet aucune requête** : la forme est contrôlée d'abord.
 *
 * Ne lève jamais : tout échec est rendu comme un état d'erreur classé sur le code HTTP réellement
 * reçu, jamais sur le texte du message.
 */
export async function lireFicheOrganisation(
	client: ClientCrm,
	idOrganisation: string | undefined,
): Promise<EtatAsync<FicheOrganisationLue | null>> {
	if (!estFormeUuid(idOrganisation)) return pret(null)
	try {
		const reponse = await client
			.from('organizations')
			.select(COLONNES_FICHE_ORGANISATION)
			.eq('id', idOrganisation)
			.order(TRI_CONTACTS_FICHE, { referencedTable: TABLE_TRI_CONTACTS_FICHE })
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LigneFicheBrute[]
		const premiere = lignes[0]
		if (premiere === undefined) return pret(null)
		// `contacts` absente et `contacts` nulle valent toutes deux « aucun contact » : une
		// organisation sans contact est un état LÉGITIME (§11.9, cas d), pas une anomalie.
		return pret({ ...premiere, contacts: premiere.contacts ?? [] })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ----------------------------------------------------------------------------------------------
// Sous-tranche 4c — LES CONTACTS D'UNE AFFAIRE (docs/SPEC-contacts.md §12)
// ----------------------------------------------------------------------------------------------
//
// @spec CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4c : le rattachement d'un contact à
//       une affaire, PREMIÈRE ÉCRITURE de la tranche
// @spec docs/SPEC-contacts.md §12.3 (la lecture, mesurée), §12.4 (les treize mesures
//       d'autorisation), §12.5 (le dictionnaire fermé des refus), §12.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.21 (le bloc)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE. Il lit et écrit `card_contacts` sous la RLS posée
// par la tranche 1 (migration 0045) : la lecture suit celle de la card (`app.can_read_card`),
// l'écriture son droit d'écriture (`app.can_write_card`) — jamais un rôle de workspace.

/**
 * L'organisation d'un contact rattaché : son nom, et l'identifiant qui mène à sa fiche (§11).
 *
 * `domain` n'y figure pas, contrairement à `OrganisationDuContact` : la ligne du bloc n'affiche
 * que le nom, et une requête ne rapporte que ce qui est affiché (§10.3).
 */
export type OrganisationDuContactRattache = Pick<
	Database['public']['Tables']['organizations']['Row'],
	'id' | 'name'
>

/**
 * Un contact rattaché à une affaire, tel que le bloc l'affiche.
 *
 * `role` est celui du RATTACHEMENT — le rôle du contact **dans cette affaire** —, à ne pas
 * confondre avec `role_title`, qui le qualifie dans son organisation. `role_title` n'est
 * délibérément PAS demandé (§12.3) : les afficher tous deux sur une ligne ferait lire deux
 * « rôles » contradictoires.
 */
export type ContactRattache = {
	readonly contactId: string
	readonly nom: string
	readonly role: string | null
	readonly organisation: OrganisationDuContactRattache | null
}

/**
 * Colonnes réellement demandées par le bloc. Exportée pour que le test unitaire vérifie la
 * requête émise.
 *
 * **L'EMBARQUEMENT TIENT SUR DEUX NIVEAUX**, et c'est mesuré (§12.3) : `card_contacts → contacts`
 * puis `contacts → organizations`, sans aucune ambiguïté `PGRST201`, chaque clé étrangère restant
 * unique dans son sens. Le §10.3 l'avait établi pour un niveau, le §11.3 pour l'autre sens.
 */
export const COLONNES_CONTACTS_AFFAIRE =
	'contact_id, role, contacts(id, full_name, organization_id, organizations(id, name))'

/**
 * Tri des rattachements, demandé au serveur.
 *
 * **IL SE DEMANDE AU PREMIER NIVEAU, ET C'EST UN ÉCART MESURÉ AVEC LE §11.3.** La fiche
 * d'organisation trie une relation **to-many** embarquée, que PostgREST n'accepte que par
 * `referencedTable`. Ici la relation est **to-one** — un rattachement désigne un contact et un
 * seul —, et `order=contacts(full_name)` est accepté : il trie les RATTACHEMENTS par le nom du
 * contact qu'ils désignent. Vérifié dans les deux sens sur deux lignes : le tri **agit**.
 */
export const TRI_CONTACTS_AFFAIRE = 'contacts(full_name)'

/** Forme brute rendue par PostgREST : la relation embarquée porte le nom de la table. */
type LigneRattachementBrute = {
	readonly contact_id: string
	readonly role: string | null
	readonly contacts:
		| (Pick<Database['public']['Tables']['contacts']['Row'], 'id' | 'full_name'> & {
				readonly organizations: OrganisationDuContactRattache | null
		  })
		| null
}

/**
 * Les contacts rattachés à une affaire, dans l'ordre de leur nom.
 *
 * Une ligne dont le contact embarqué est absent est **écartée** plutôt que rendue sans nom : la FK
 * composite l'interdit en base, et fabriquer une ligne anonyme afficherait une donnée que le
 * modèle ne produit pas.
 *
 * Ne lève jamais : tout échec est rendu comme un état d'erreur classé sur le code HTTP réellement
 * reçu, jamais sur le texte du message.
 */
export async function lireContactsDeLAffaire(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<readonly ContactRattache[]>> {
	try {
		const reponse = await client
			.from('card_contacts')
			.select(COLONNES_CONTACTS_AFFAIRE)
			.eq('card_id', idCard)
			.order(TRI_CONTACTS_AFFAIRE)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LigneRattachementBrute[]
		const rattaches: ContactRattache[] = []
		for (const ligne of lignes) {
			if (ligne.contacts === null) continue
			rattaches.push({
				contactId: ligne.contact_id,
				nom: ligne.contacts.full_name,
				role: ligne.role,
				organisation: ligne.contacts.organizations,
			})
		}
		return pret(rattaches)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les refus qu'un rattachement peut recevoir (§12.5).
 *
 * `deja-rattache` et `contact-inconnu` sont distingués parce qu'ils appellent des gestes
 * OPPOSÉS : le premier dit « choisissez-en un autre », geste immédiat sur ce même écran ; le
 * second dit que la liste affichée est périmée et qu'il faut la relire. Les confondre sous « une
 * erreur est survenue » serait la valeur par défaut trompeuse de `CLAUDE.md` §18 — et le code HTTP
 * ne les sépare pas, les DEUX rendant `409` (mesures 7 et 8 du §12.4).
 */
export type NatureRefusRattachement =
	| 'deja-rattache'
	| 'contact-inconnu'
	| 'forbidden'
	| 'network'
	| 'unknown'

export type RefusRattachement = {
	readonly nature: NatureRefusRattachement
	readonly detail: string
}

/** Violation d'unicité : la clé primaire `(card_id, contact_id)` est déjà prise. MESURÉ. */
export const CODE_DOUBLON = '23505'
/** Violation de clé étrangère : le contact n'existe pas dans ce workspace. MESURÉ. */
export const CODE_CONTACT_INCONNU = '23503'

/**
 * Classe un refus sur le CODE PostgreSQL d'abord, le code HTTP ensuite — la règle de
 * `classerRefusRestauration` (`corbeille.ts`), reprise sans exception.
 *
 * **L'ORDRE COMPTE, et il est mesuré** : `23505` et `23503` rendent tous deux `409`, et un
 * classement qui commencerait par le statut les confondrait.
 */
export function classerRefusRattachement(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusRattachement {
	if (code === CODE_DOUBLON) return { nature: 'deja-rattache', detail }
	if (code === CODE_CONTACT_INCONNU) return { nature: 'contact-inconnu', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/** Les deux issues d'un rattachement : PostgREST rend `201` et la ligne, ou refuse (§12.4). */
export type ResultatRattachement =
	| { readonly statut: 'appliquee' }
	| { readonly statut: 'refus'; readonly refus: RefusRattachement }

/**
 * Rattache un contact à une affaire, avec un rôle facultatif.
 *
 * **UN RÔLE VIDE VAUT `null`, JAMAIS `""`**, et c'est mesuré : la contrainte
 * `card_contacts_role_check` refuse la chaîne vide par `400` / `23514` (mesure 10 du §12.4).
 * Ce n'est PAS une garde de saisie doublant la base au sens du §5.3 ter du design system — la base
 * refuserait `''` —, c'est le choix de la valeur qui exprime « pas de rôle ». Le rôle est sinon
 * libre : ni contraint, ni normalisé, ni traduit (§2.3).
 *
 * `workspace_id` est TRANSMIS et non deviné : il vient de la card déjà chargée par l'écran, comme
 * les trois identifiants du formulaire (§4 bis.4 du composeur). La FK composite l'exige, et le
 * relire serait une requête pour une donnée en main.
 *
 * L'ÉCRAN N'ANTICIPE RIEN : il envoie, puis traduit ce qu'il reçoit. Décider d'avance qu'un
 * rattachement est impossible ferait porter à l'interface une garde qui vit dans la base
 * (`CLAUDE.md` §10).
 */
export async function rattacherContact(
	client: ClientCrm,
	rattachement: {
		readonly idWorkspace: string
		readonly idCard: string
		readonly idContact: string
		readonly role: string
	},
): Promise<ResultatRattachement> {
	const roleNettoye = rattachement.role.trim()
	try {
		const reponse = await client.from('card_contacts').insert({
			workspace_id: rattachement.idWorkspace,
			card_id: rattachement.idCard,
			contact_id: rattachement.idContact,
			role: roleNettoye === '' ? null : roleNettoye,
		})
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusRattachement(
					reponse.status,
					reponse.error.code,
					reponse.error.message,
				),
			}
		}
		return { statut: 'appliquee' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusRattachement(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

/**
 * Les TROIS issues d'un détachement (§12.4, conséquence 1).
 *
 * `sans-effet` n'est NI un succès NI une erreur, et c'est MESURÉ : la clause `USING` de
 * `card_contacts_suppression` filtre la ligne **avant** de supprimer, et PostgREST rend `200` et
 * zéro ligne. La lectrice qui détache un rattachement existant de `…0c4` reçoit `200` et `[]`, la
 * ligne relue **inchangée** — indistinguable d'une ligne déjà retirée par un tiers, et c'est
 * assumé (`docs/SPEC-permissions-rls.md` §7).
 */
export type ResultatDetachement =
	| { readonly statut: 'appliquee' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusRattachement }

/**
 * Détache un contact d'une affaire.
 *
 * `select('contact_id')` accompagne la suppression précisément pour que « zéro ligne touchée »
 * existe comme réponse : sans lui, PostgREST ne rend aucun corps et le refus silencieux de la
 * politique serait indistinguable d'un succès (patron de `mettreCardALaCorbeille`).
 */
export async function detacherContact(
	client: ClientCrm,
	idCard: string,
	idContact: string,
): Promise<ResultatDetachement> {
	try {
		const reponse = await client
			.from('card_contacts')
			.delete()
			.eq('card_id', idCard)
			.eq('contact_id', idContact)
			.select('contact_id')
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusRattachement(
					reponse.status,
					reponse.error.code,
					reponse.error.message,
				),
			}
		}
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'appliquee' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusRattachement(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Sous-tranche 4e — la CRÉATION d'un contact depuis le carnet
//
// @spec CRM-060 (docs/BACKLOG.md) — tranche 4, sous-tranche 4e
// @spec docs/SPEC-contacts.md §14.3 (les onze mesures d'écriture), §14.4 (dictionnaire fermé des
//       cinq refus), §14.5 (contrat de comportement), §14.7 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.23 (le formulaire de création dans le flux du carnet)
//
// AUCUNE POLITIQUE NOUVELLE : cette section n'exerce que `contacts_insertion`, posée par la
// migration 0045 et prouvée par la tranche 1. MESURÉ le 2026-08-18 : l'administratrice et le
// `business_developer` reçoivent `201` ; la lectrice reçoit `403` / `42501`.
// ---------------------------------------------------------------------------------------------

/** Le code d'une contrainte de forme violée — `full_name`, `email` ou `phone` (mesures 6 à 9). */
export const CODE_SAISIE_INVALIDE = '23514'

/**
 * Les cinq natures de refus d'une création, et rien d'autre : le dictionnaire est FERMÉ (§14.4).
 *
 * `detail` accompagne chaque nature pour le diagnostic — il n'est JAMAIS affiché tel quel, un
 * message de serveur n'étant pas un texte d'interface (`docs/DESIGN_SYSTEM.md` §10).
 */
export type RefusCreationContact = {
	readonly nature: 'interdit' | 'doublon' | 'organisation-inconnue' | 'saisie-invalide' | 'indisponible'
	readonly detail: string
}

/**
 * Classe un refus de création — LE CODE POSTGRESQL D'ABORD, le statut HTTP ensuite.
 *
 * **L'ordre n'est pas un détail, il est MESURÉ** (§14.3, mesures 5 et 10) : un email déjà porté
 * (`23505`) et une organisation inconnue (`23503`) rendent **tous deux `409`**. Classer par le
 * statut les confondrait, alors qu'ils appellent des gestes opposés — corriger l'email, ou relire
 * une liste d'organisations périmée. C'est le patron de `classerRefusRattachement` (§12.5).
 */
export function classerRefusCreation(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusCreationContact {
	if (code === CODE_DOUBLON) return { nature: 'doublon', detail }
	if (code === CODE_CONTACT_INCONNU) return { nature: 'organisation-inconnue', detail }
	if (code === CODE_SAISIE_INVALIDE) return { nature: 'saisie-invalide', detail }
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'interdit', detail }
	return { nature: 'indisponible', detail }
}

/** Ce que le formulaire du carnet saisit — les cinq colonnes que le tableau affiche (§14.1). */
export type SaisieContact = {
	readonly nom: string
	readonly idOrganisation: string
	readonly fonction: string
	readonly email: string
	readonly telephone: string
}

/** Les deux issues d'une création : la ligne créée, ou un refus traduit (§14.3). */
export type ResultatCreationContact =
	| { readonly statut: 'creee'; readonly contact: ContactDuCarnet }
	| { readonly statut: 'refus'; readonly refus: RefusCreationContact }

/**
 * UN FACULTATIF BLANC VAUT `null`, JAMAIS `''`, et c'est MESURÉ (§14.3, mesures 8 et 9) : les
 * contraintes `contacts_email_check` et `contacts_phone_check` refusent la chaîne vide par
 * `400` / `23514`. C'est la règle que `rattacherContact` applique déjà au rôle d'un rattachement,
 * partagée ici plutôt que réécrite.
 */
export function normaliserFacultatif(saisie: string): string | null {
	const nettoyee = saisie.trim()
	return nettoyee === '' ? null : nettoyee
}

/**
 * Crée un contact dans le workspace courant.
 *
 * `source` n'est PAS envoyé : la base pose `manual` par défaut, mesuré sur la ligne rendue. En
 * envoyer un ici figerait dans l'écran une valeur qui appartient au modèle (§2.2).
 *
 * `Prefer: return=representation` est obtenu par `.select(...)` : la ligne créée revient avec son
 * organisation embarquée, ce qui permet au carnet de l'insérer à sa place de tri **sans relire la
 * liste entière** (§14.5 cas e). Une relecture complète serait une seconde requête pour une donnée
 * déjà en main.
 *
 * L'ÉCRAN N'ANTICIPE AUCUN DROIT : il envoie, puis traduit ce qu'il reçoit (§14.6).
 * Ne lève jamais.
 */
export async function creerContact(
	client: ClientCrm,
	creation: { readonly idWorkspace: string; readonly saisie: SaisieContact },
): Promise<ResultatCreationContact> {
	const { saisie } = creation
	try {
		const reponse = await client
			.from('contacts')
			.insert({
				workspace_id: creation.idWorkspace,
				full_name: saisie.nom.trim(),
				organization_id: normaliserFacultatif(saisie.idOrganisation),
				role_title: normaliserFacultatif(saisie.fonction),
				email: normaliserFacultatif(saisie.email),
				phone: normaliserFacultatif(saisie.telephone),
			})
			.select(COLONNES_CONTACT_CARNET)
			.single()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusCreation(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		const { organizations, ...contact } = reponse.data as unknown as LigneBrute
		return { statut: 'creee', contact: { ...contact, organisation: organizations } }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusCreation(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

/**
 * Les organisations du workspace, pour le sélecteur du formulaire de création (§14.1).
 *
 * MESURÉ le 2026-08-18 : `GET /rest/v1/organizations?select=id,name&order=name` rend les trois
 * organisations du seed à l'administratrice comme à la lectrice — le nom d'une organisation est
 * une donnée d'équipe, comme le nom d'un collègue (§13.3).
 *
 * **Aucune requête nouvelle de forme n'est inventée** : c'est la lecture la plus étroite possible,
 * deux colonnes, et elle ne rapporte que ce que le sélecteur affiche (patron du §10.3). Le tri est
 * demandé au SERVEUR, jamais rejoué après coup.
 *
 * Ne lève jamais.
 */
export async function lireOrganisationsDuWorkspace(
	client: ClientCrm,
): Promise<EtatAsync<readonly OrganisationChoisissable[]>> {
	try {
		const reponse = await client.from('organizations').select(COLONNES_ORGANISATION_CHOIX).order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret((reponse.data ?? []) as unknown as readonly OrganisationChoisissable[])
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Une organisation telle que le sélecteur la propose : son nom, et l'identifiant à écrire. */
export type OrganisationChoisissable = Pick<
	Database['public']['Tables']['organizations']['Row'],
	'id' | 'name'
>

/** Colonnes demandées par le sélecteur. Exportée pour que le test vérifie la requête émise. */
export const COLONNES_ORGANISATION_CHOIX = 'id, name'
