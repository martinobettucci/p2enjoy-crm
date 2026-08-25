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

// ----------------------------------------------------------------------------------------------
// Sous-tranche 4f — LA FICHE D'UN CONTACT (docs/SPEC-contacts.md §15)
// ----------------------------------------------------------------------------------------------
//
// @spec CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4f : la fiche d'un contact, et
//       l'HISTORIQUE TRANSVERSE que la Definition of Done de l'unité nomme
// @spec docs/SPEC-contacts.md §15.3 (la lecture, et les quatre mesures qui l'ont décidée),
//       §15.4 (les sept mesures d'autorisation, et les droits fins qui traversent l'embarquement),
//       §15.8 (limites nommées), §15.9 (contrat de comportement)
// @spec docs/DESIGN_SYSTEM.md §5.24 (la fiche de contact)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE. Il lit sous la RLS de la migration 0045 et sous les
// droits fins de `cards` posés par CRM-012 — la lecture d'un contact est ouverte à tout membre, et
// celle d'une affaire suit `app.can_read_card`.

/** L'organisation d'un contact, telle que sa fiche la nomme et l'adresse (§15.3). */
export type OrganisationDeLaFiche = Pick<
	Database['public']['Tables']['organizations']['Row'],
	'id' | 'name' | 'domain'
>

/**
 * Une affaire d'un contact, telle que la fiche la rend : son titre, son état, son adresse et le
 * rôle que le contact y tient.
 *
 * `adresse` est CALCULÉE ici et non lue : `/tracks/:slugTrack/:slugChannel/cards/:idCard` exige les
 * slugs du track et du channel, que l'embarquement du §15.3 rapporte dans la même requête. C'est ce
 * que `lireCheminCard` (`inbox.ts`) obtenait en TROIS requêtes en cascade, faute d'avoir levé
 * l'ambiguïté `PGRST201` que le §15.3 désigne.
 *
 * `archivee` est la seule donnée de cycle de vie rendue : une affaire archivée reste une affaire
 * réelle, et l'historique d'un contact est précisément ce que cette page sert — la taire mentirait
 * sur le passé. Une affaire à la CORBEILLE, elle, n'arrive jamais jusqu'ici : le serveur l'écarte
 * (§15.3).
 */
export type AffaireDuContact = {
	readonly idCard: string
	readonly titre: string
	readonly role: string | null
	readonly archivee: boolean
	readonly adresse: string
}

/** Un contact tel que sa fiche le rend : ce qui le caractérise, et ses affaires. */
export type FicheContactLue = Pick<
	Database['public']['Tables']['contacts']['Row'],
	'id' | 'full_name' | 'email' | 'phone' | 'role_title' | 'organization_id' | 'workspace_id'
> & {
	readonly organisation: OrganisationDeLaFiche | null
	readonly affaires: readonly AffaireDuContact[]
}

/**
 * Colonnes demandées par la fiche. Exportée pour que le test unitaire vérifie la requête émise.
 *
 * **L'EMBARQUEMENT `cards → channels` EST AMBIGU, ET IL SE DÉSIGNE AU LIEU DE SE CONTOURNER.**
 * MESURÉ le 2026-08-19 : la forme naïve `cards(channels(...))` est refusée par `PGRST201` — deux
 * relations existent, `cards_channel_id_workflow_id_fkey` et `cards_channel_id_workspace_id_fkey`.
 * La clé retenue est celle du CLOISONNEMENT, `(channel_id, workspace_id)` : c'est elle qui dit à
 * quel channel une affaire appartient, le workflow n'étant qu'une propriété partagée. La chaîne à
 * quatre niveaux `contacts → card_contacts → cards → channels → tracks` tient alors en UNE requête.
 *
 * **`cards!inner` n'est pas décoratif** : combiné au filtre `deleted_at=is.null` du §15.3, il
 * RETIRE la ligne de rattachement entière. Sans `!inner`, PostgREST rendrait `cards: null` et
 * l'écran devrait filtrer une donnée que le serveur sait déjà écarter (mesuré).
 *
 * **`workspace_id` A ÉTÉ AJOUTÉ PAR LA SOUS-TRANCHE 4h** (§17.5), et c'est une colonne de plus
 * dans une requête DÉJÀ ÉMISE, contre une requête entière si on la relisait. La clé composite de
 * `card_contacts` l'exige au rattachement, et le §12.5 a posé qu'elle est TRANSMISE et non devinée :
 * là-bas la source était la card déjà chargée, ici c'est le contact. MESURÉ (§17.4, mesures 13 et
 * 14) : la colonne est lisible par l'administratrice COMME par la lectrice — l'ajouter ne referme
 * la fiche pour personne.
 */
export const COLONNES_FICHE_CONTACT =
	'id, full_name, email, phone, role_title, organization_id, workspace_id, ' +
	'organizations(id, name, domain), ' +
	'card_contacts(role, cards!inner(id, title, archived_at, ' +
	'channels!cards_channel_id_workspace_id_fkey(slug, tracks(slug))))'

/**
 * Filtre qui écarte les affaires de la CORBEILLE, exporté pour que le test vérifie qu'il est posé.
 *
 * Une affaire supprimée apparaît sans lui — mesuré sur « Saisie erronée ». La lister offrirait un
 * lien vers une affaire dont la corbeille est la surface propriétaire (`CRM-077`).
 */
export const CHEMIN_FILTRE_CORBEILLE = 'card_contacts.cards.deleted_at'

/**
 * Tri des rattachements embarqués, demandé au SERVEUR (§15.3).
 *
 * La relation `card_contacts → cards` est **to-one**, si bien que `order=cards(title)` est accepté
 * — l'écart mesuré au §12.3 entre une relation to-one et une relation to-many vaut ici aussi. Le
 * tri AGIT, vérifié dans les deux sens sur deux rattachements sondes : ascendant rend
 * `["Audit sécurité applicative", "Contrat cadre 2025"]`, descendant l'inverse.
 */
export const TRI_AFFAIRES_FICHE = 'cards(title)'
export const TABLE_TRI_AFFAIRES_FICHE = 'card_contacts'

/** Forme brute d'un rattachement tel que PostgREST le rend, avant renommage. */
type RattachementBrut = {
	readonly role: string | null
	readonly cards: {
		readonly id: string
		readonly title: string
		readonly archived_at: string | null
		readonly channels: { readonly slug: string; readonly tracks: { readonly slug: string } | null } | null
	} | null
}

/** Forme brute de la fiche : les deux relations embarquées peuvent manquer ou être nulles. */
type LigneFicheContactBrute = Omit<FicheContactLue, 'organisation' | 'affaires'> & {
	readonly organizations?: OrganisationDeLaFiche | null
	readonly card_contacts?: readonly RattachementBrut[] | null
}

/**
 * Adresse d'une affaire dans l'application, ou `null` lorsque ses slugs manquent.
 *
 * Exportée pour être éprouvée directement. Rendre `null` plutôt qu'une adresse partielle est la
 * règle de `lireCheminCard` : un lien vers `/tracks/undefined/...` mènerait à un écran que
 * l'utilisateur croirait cassé, là où une ligne sans lien dit seulement que l'affaire n'est pas
 * adressable pour cet appelant.
 */
export function adresseAffaire(rattachement: RattachementBrut): string | null {
	const card = rattachement.cards
	const slugChannel = card?.channels?.slug
	const slugTrack = card?.channels?.tracks?.slug
	if (card === null || card === undefined || slugChannel === undefined || slugTrack === undefined) {
		return null
	}
	return `/tracks/${slugTrack}/${slugChannel}/cards/${card.id}`
}

/**
 * Le contact désigné par `idContact`, avec son organisation et ses affaires — ou `null` lorsqu'il
 * n'est pas lisible.
 *
 * **`null` recouvre TROIS situations, et c'est délibéré** (§15.4) : le contact n'existe pas,
 * l'appelant n'a pas le droit de le lire, ou l'identifiant n'a pas la forme d'un uuid. MESURÉ : les
 * deux premières rendent toutes deux `200` et `[]` — les distinguer renseignerait un appelant sans
 * droit sur l'EXISTENCE d'un contact (docs/SPEC-permissions-rls.md §7). Un identifiant mal formé
 * n'émet AUCUNE requête, `estFormeUuid` contrôlant la forme d'abord — le contrôle est celui du
 * §11.4, PARTAGÉ et non réécrit.
 *
 * **L'écran ne calcule aucun droit sur les affaires**, et il n'a pas à le faire : MESURÉ, les
 * droits fins de `cards` traversent l'embarquement. La lectrice, à qui le track « Conseil IA » est
 * fermé, reçoit `card_contacts: []` sur la fiche de Léo — la ligne est RETIRÉE, non rendue avec une
 * affaire nulle — et l'affaire de Sophie sur la sienne (§15.4, cas 6 et 7).
 *
 * Ne lève jamais : tout échec est rendu comme un état d'erreur classé sur le code HTTP réellement
 * reçu, jamais sur le texte du message.
 */
export async function lireFicheContact(
	client: ClientCrm,
	idContact: string | undefined,
): Promise<EtatAsync<FicheContactLue | null>> {
	if (!estFormeUuid(idContact)) return pret(null)
	try {
		const reponse = await client
			.from('contacts')
			.select(COLONNES_FICHE_CONTACT)
			.eq('id', idContact)
			.is(CHEMIN_FILTRE_CORBEILLE, null)
			.order(TRI_AFFAIRES_FICHE, { referencedTable: TABLE_TRI_AFFAIRES_FICHE })
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LigneFicheContactBrute[]
		const premiere = lignes[0]
		if (premiere === undefined) return pret(null)
		const affaires: AffaireDuContact[] = []
		for (const rattachement of premiere.card_contacts ?? []) {
			const adresse = adresseAffaire(rattachement)
			const card = rattachement.cards
			// Une affaire dont les slugs manquent n'est pas listée : elle ne serait ni adressable
			// ni utile, et la rendre sans lien inventerait une ligne morte. Le cas ne se produit
			// pas sous la RLS mesurée — `cards!inner` garantit la card — mais le type le porte, et
			// le nier par un `!` serait une supposition non mesurée.
			if (card === null || card === undefined || adresse === null) continue
			affaires.push({
				idCard: card.id,
				titre: card.title,
				role: rattachement.role,
				archivee: card.archived_at !== null,
				adresse,
			})
		}
		return pret({
			id: premiere.id,
			full_name: premiere.full_name,
			email: premiere.email,
			phone: premiere.phone,
			role_title: premiere.role_title,
			organization_id: premiere.organization_id,
			// Porté depuis la sous-tranche 4h (§17.5) : la clé composite de `card_contacts` l'exige
			// au rattachement, et le §12.5 a posé qu'elle est TRANSMISE et non devinée.
			workspace_id: premiere.workspace_id,
			// `organizations` absente et `organizations` nulle valent toutes deux « aucune
			// organisation » : un contact sans organisation est un état LÉGITIME (§15.9, cas b).
			organisation: premiere.organizations ?? null,
			affaires,
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// @spec CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4g : la MODIFICATION d'un contact
//       depuis sa fiche
// @spec docs/SPEC-contacts.md §16.3 (les vingt et une mesures d'écriture), §16.4 (dictionnaire
//       FERMÉ des six refus), §16.7 (ce que la fiche fait de la ligne rendue),
//       §16.8 (limites nommées), §16.9 (contrat de comportement)
// @spec docs/DESIGN_SYSTEM.md §5.25 (le formulaire de modification dans le flux de la fiche)
//
// AUCUNE POLITIQUE NOUVELLE : cette section n'exerce que `contacts_maj_bizdev_admin`, posée par la
// migration 0045 et prouvée par la tranche 1.
//
// LE REFUS D'AUTORISATION EST SILENCIEUX ICI, ET C'EST CE QUI SÉPARE 4g DE 4e. La politique
// d'INSERTION rejette par un `403` explicite (§14.3, mesure 4) ; la politique de MISE À JOUR porte
// une clause `USING` qui rend la ligne INVISIBLE à l'écriture, si bien que PostgREST ne trouve rien
// à modifier et rend `200` avec un tableau VIDE (§16.3, mesures 3 et 19). Une écriture sans effet
// DOIT donc être dite : sans cela, la lectrice verrait son formulaire se refermer sur une
// modification qui n'a jamais eu lieu.
// ---------------------------------------------------------------------------------------------

/**
 * Les six natures de refus d'une modification : les cinq de la création, plus `sans-effet`.
 *
 * `sans-effet` n'est PAS une erreur, et c'est pourquoi elle ne peut pas venir de
 * `classerRefusCreation` : elle se décide sur l'ABSENCE de ligne rendue, avant tout classement.
 */
export type RefusModificationContact = {
	readonly nature: RefusCreationContact['nature'] | 'sans-effet'
	readonly detail: string
}

/** Les deux issues d'une modification : la ligne modifiée, ou un refus traduit (§16.3). */
export type ResultatModificationContact =
	| { readonly statut: 'modifiee'; readonly contact: ContactDuCarnet }
	| { readonly statut: 'refus'; readonly refus: RefusModificationContact }

/**
 * Modifie un contact existant du workspace courant.
 *
 * **LES CINQ COLONNES PARTENT D'UN BLOC, et ce n'est pas une facilité : c'est MESURÉ** (§16.3,
 * mesures 16 à 18). L'unicité partielle sur `lower(email)` ne s'oppose PAS à la ligne elle-même,
 * même en changeant la casse — une ligne qui reprend son propre email reçoit `200`. Un envoi
 * différentiel serait donc une complication dont la mesure montre qu'elle n'achète rien, et il
 * ouvrirait un chemin — « aucun champ n'a changé » — qu'aucune règle ne demande.
 *
 * `workspace_id` n'est JAMAIS envoyé : il n'est pas modifiable depuis cet écran, et l'envoyer
 * n'ouvrirait qu'un refus (mesure 13). `source` non plus : elle appartient au modèle (§16.8).
 *
 * `.maybeSingle()` et non `.single()` : zéro ligne est ici un RÉSULTAT ATTENDU — le refus
 * silencieux —, et `.single()` le déguiserait en erreur `PGRST116`, c'est-à-dire en panne.
 *
 * L'ÉCRAN N'ANTICIPE AUCUN DROIT : il envoie, puis traduit ce qu'il reçoit (§16.6).
 * Ne lève jamais.
 */
export async function modifierContact(
	client: ClientCrm,
	modification: { readonly idContact: string; readonly saisie: SaisieContact },
): Promise<ResultatModificationContact> {
	const { saisie } = modification
	try {
		const reponse = await client
			.from('contacts')
			.update({
				full_name: saisie.nom.trim(),
				organization_id: normaliserFacultatif(saisie.idOrganisation),
				role_title: normaliserFacultatif(saisie.fonction),
				email: normaliserFacultatif(saisie.email),
				phone: normaliserFacultatif(saisie.telephone),
			})
			.eq('id', modification.idContact)
			.select(COLONNES_CONTACT_CARNET)
			.maybeSingle()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusCreation(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		// ZÉRO LIGNE, ET AUCUNE ERREUR (§16.3, mesures 3, 12 et 19). Trois situations aboutissent
		// ici et sont INDISTINGUABLES par construction : l'appelant n'a pas le droit d'écrire, le
		// contact a disparu entre l'ouverture de la fiche et l'envoi, ou la ligne est devenue
		// invisible. Une relecture ne les séparerait pas davantage — celle d'un contact refusé rend
		// zéro ligne, comme celle d'un contact supprimé. Un seul message les couvre (§16.4).
		if (reponse.data === null || reponse.data === undefined) {
			return { statut: 'refus', refus: { nature: 'sans-effet', detail: 'aucune ligne modifiée' } }
		}
		const { organizations, ...contact } = reponse.data as unknown as LigneBrute
		return { statut: 'modifiee', contact: { ...contact, organisation: organizations } }
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

// =================================================================================================
// SOUS-TRANCHE 4h — LES AFFAIRES RATTACHABLES À UN CONTACT
// =================================================================================================
//
// @spec CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4h : le rattachement d'une affaire
//       depuis la fiche d'un contact
// @spec docs/SPEC-contacts.md §17.3 (ce que le sélecteur lit, et les trois mesures qui l'ont
//       décidé), §17.4 (les huit mesures d'autorisation), §17.5 (ce que le formulaire envoie),
//       §17.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.26 (le geste de rattachement de la fiche de contact)
//
// CE BLOC N'OUVRE AUCUNE POLITIQUE NOUVELLE et n'ajoute AUCUNE fonction d'écriture : le geste
// appelle `rattacherContact` (§12), inchangée. Écrire un second `POST` sur la même table ferait
// diverger deux contrats au premier champ ajouté (§17.5).

/** Une affaire telle que le sélecteur du rattachement l'offre (§17.3). */
export type AffaireRattachable = {
	readonly id: string
	readonly titre: string
	/** Une affaire ARCHIVÉE est offerte, et son option le DIT (§17.3, mesure 6). */
	readonly archivee: boolean
}

/**
 * Colonnes demandées par le sélecteur. Exportée pour que le test unitaire vérifie la requête émise.
 *
 * **NI LE TRACK NI LE CHANNEL NE SONT DEMANDÉS, et ce n'est pas un oubli.** Le §15.3 les lit parce
 * que la fiche doit construire l'ADRESSE de chaque affaire ; un sélecteur n'a aucune adresse à
 * construire, il envoie un identifiant. Les demander imposerait la levée d'ambiguïté `PGRST201` du
 * §15.3 pour une donnée que rien n'afficherait — et le §10.3 a déjà posé qu'une requête ne rapporte
 * que ce qui est affiché.
 */
export const COLONNES_AFFAIRE_RATTACHABLE = 'id, title, archived_at'

/**
 * Filtre qui écarte les affaires de la CORBEILLE, exporté pour que le test vérifie qu'il est posé.
 *
 * **LA BASE N'Y EST POUR RIEN, ET C'EST MESURÉ** (§17.3, mesure 7) : elle ACCEPTE le rattachement
 * d'un contact à une affaire supprimée — `201`, et la ligne. C'est la FICHE qui ne l'affichera
 * jamais, le §15.3 ayant mesuré que le serveur écarte les affaires en corbeille de sa lecture. Un
 * rattachement posé sur l'une d'elles serait donc invisible immédiatement après avoir été créé :
 * l'utilisateur agirait, la liste ne bougerait pas, et rien ne dirait pourquoi. C'est le refus
 * d'une commande dont le résultat est indiscernable d'une panne.
 */
export const FILTRE_CORBEILLE_AFFAIRE = 'deleted_at'

/** Tri demandé au SERVEUR. Le tri AGIT, vérifié dans les deux sens (§17.3, mesure 18). */
export const TRI_AFFAIRES_RATTACHABLES = 'title'

/**
 * Borne du sélecteur, reprise SANS CHANGEMENT de `CARDS_CLASSABLES_MAX` (`inbox.ts`) et pour son
 * motif exact : une liste déroulante de plusieurs milliers d'entrées n'est plus un choix, c'est un
 * labyrinthe. Le workspace seedé en compte quarante (mesure 15). Au-delà, c'est une recherche
 * qu'il faudra livrer, pas une liste plus longue (§17.8, `CLAUDE.md` §21).
 */
export const AFFAIRES_RATTACHABLES_MAX = 200

/** Forme brute d'une affaire telle que PostgREST la rend, avant renommage. */
type LigneAffaireRattachableBrute = {
	readonly id: string
	readonly title: string
	readonly archived_at: string | null
}

/**
 * Les affaires auxquelles un contact peut être rattaché, dans l'ordre de leur titre.
 *
 * **ELLE LIT LE DROIT DE LECTURE, ET LE DIT** — la règle que `lireCardsClassables` (`inbox.ts`) a
 * déjà écrite : la RLS de `cards` gouverne la lecture, et rien dans PostgREST ne permet de demander
 * « celles où je peux écrire » sans une fonction dédiée. Une affaire offerte peut donc être refusée
 * par `card_contacts_insertion`, et ce refus est présenté TEL QUEL (§17.4, mesure 9). Filtrer ici
 * sur une supposition serait pire : l'écran cacherait des affaires légitimes sans jamais l'avouer.
 *
 * Ne lève jamais : tout échec est rendu comme un état d'erreur classé sur le code HTTP réellement
 * reçu, jamais sur le texte du message.
 */
export async function lireAffairesRattachables(
	client: ClientCrm,
): Promise<EtatAsync<readonly AffaireRattachable[]>> {
	try {
		const reponse = await client
			.from('cards')
			.select(COLONNES_AFFAIRE_RATTACHABLE)
			.is(FILTRE_CORBEILLE_AFFAIRE, null)
			.order(TRI_AFFAIRES_RATTACHABLES)
			.limit(AFFAIRES_RATTACHABLES_MAX)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LigneAffaireRattachableBrute[]
		return pret(
			lignes.map((ligne) => ({
				id: ligne.id,
				titre: ligne.title,
				archivee: ligne.archived_at !== null,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// =================================================================================================
// SOUS-TRANCHE 4j — LA MODIFICATION DU RÔLE D'UN RATTACHEMENT POSÉ
// =================================================================================================
//
// @spec CRM-060 (docs/BACKLOG.md) — tranche 4 sous-tranche 4j : la modification du rôle d'un
//       rattachement, depuis la fiche d'un contact
// @spec docs/SPEC-contacts.md §19.2 (une fonction NOUVELLE, et `role` SEUL dans le corps),
//       §19.3 (les quinze mesures, et les quatre qui décident), §19.5 (dictionnaire FERMÉ des
//       refus), §19.8 (limites nommées)
// @spec docs/DESIGN_SYSTEM.md §5.28 (le geste qui l'exerce)
// @spec docs/SPEC-permissions-rls.md §7 (un refus silencieux est zéro ligne, jamais une erreur)
//
// C'EST LE PREMIER `UPDATE` DU PRODUIT SUR `card_contacts`. La politique `card_contacts_maj` existe
// depuis la migration `0045` et aucun écran ne l'avait exercée — le §12.8, puis le §17.8, puis le
// §18.8 l'ont nommé trois fois. AUCUNE MIGRATION : ni colonne, ni politique, ni privilège ne bouge.

/**
 * Les natures de refus d'une modification de rôle : les cinq de `NatureRefusRattachement`, plus
 * `saisie-invalide`.
 *
 * **`saisie-invalide` EST ATTEIGNABLE EN BASE ET NULLE PART AILLEURS SUR CETTE FICHE, ET C'EST
 * MESURÉ DEUX FOIS** (§19.3, mesures 8 et 10) : la chaîne vide comme la chaîne blanche violent
 * `card_contacts_role_check` (`role is null or btrim(role) <> ''`) par `400` / `23514`. La fonction
 * ci-dessous ne l'émet jamais — elle normalise —, mais l'issue existe : la taire reviendrait à
 * affirmer qu'une réponse de la base est impossible alors que seule la forme de l'appel l'empêche.
 */
export type NatureRefusRole = NatureRefusRattachement | 'saisie-invalide'

export type RefusRole = {
	readonly nature: NatureRefusRole
	readonly detail: string
}

/**
 * Classe un refus de modification de rôle : `classerRefusRattachement`, plus la saisie invalide.
 *
 * **L'ORDRE COMPTE, comme au §12.5** : `23514` est éprouvé AVANT le statut, `400` couvrant aussi
 * bien la contrainte de forme que l'identifiant mal formé de la mesure 11 — un classement qui
 * commencerait par le statut les confondrait sous `unknown`.
 */
export function classerRefusRole(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusRole {
	if (code === CODE_SAISIE_INVALIDE) return { nature: 'saisie-invalide', detail }
	return classerRefusRattachement(statutHttp, code, detail)
}

/**
 * Les TROIS issues d'une modification de rôle (§19.3, mesure 2).
 *
 * `sans-effet` n'est NI un succès NI une erreur, et c'est la même cause structurelle qu'au
 * détachement : la clause `USING` de `card_contacts_maj` rend la ligne **invisible à l'écriture**,
 * et PostgREST rend `200` avec zéro ligne, SANS erreur, sur une ligne qui EXISTE et qui reste en
 * base avec son rôle. MESURÉ sur la ligne du seed `c4 → Sophie` avec le jeton de la lectrice.
 *
 * `modifiee` porte le rôle **tel que la base l'a enregistré**, et non tel que l'appelant l'a tapé :
 * c'est la ligne rendue qui fait foi, et c'est elle que la fiche affiche (§19.6).
 */
export type ResultatModificationRole =
	| { readonly statut: 'modifiee'; readonly role: string | null }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusRole }

/** Les colonnes que la mise à jour redemande : le rôle seul suffit à la fiche (§19.6). */
export const COLONNES_ROLE_RATTACHEMENT = 'role'

/**
 * Modifie le rôle d'un rattachement existant.
 *
 * **LE CORPS NE PORTE QUE `role`, ET C'EST LA MESURE 12 QUI L'IMPOSE** (§19.2). Un `PATCH` portant
 * `card_id` **DÉPLACE** le rattachement : `200`, la ligne rendue sur la nouvelle affaire, et plus
 * rien sur l'ancienne. Ce n'est pas une faille — la clause `USING` filtre sur l'ancienne affaire et
 * `WITH CHECK` sur la nouvelle, si bien que le déplacement suppose le droit d'écrire les deux —,
 * c'est une capacité réelle que cet écran n'exerce pas (§19.8). Envoyer les clés « pour être
 * complet » ouvrirait un déplacement silencieux au premier champ ajouté à un formulaire.
 *
 * **UN RÔLE BLANC VAUT `null`, JAMAIS `''` NI `'   '`**, et c'est mesuré deux fois (mesures 8
 * et 10). `normaliserFacultatif` porte déjà cette règle pour la création ; elle est partagée ici
 * plutôt que réécrite. Ce n'est PAS une garde de saisie doublant la base (§5.3 ter) : la base
 * refuserait ces deux valeurs, et `null` est celle qu'elle accepte pour dire « pas de rôle ».
 *
 * **VIDER LE CHAMP EFFACE LE RÔLE, et c'est un GESTE** (mesure 9) : `null` est accepté et la ligne
 * le rend. Au rattachement, un rôle vide *valait* `null` faute d'alternative ; ici l'utilisateur
 * retire une donnée sans détruire le rattachement.
 *
 * `.maybeSingle()` et non `.single()` : zéro ligne est un RÉSULTAT ATTENDU — le refus silencieux —,
 * et `.single()` le déguiserait en erreur `PGRST116`, c'est-à-dire en panne. Règle de
 * `modifierContact` (§16), reprise sans changement.
 *
 * L'ÉCRAN N'ANTICIPE AUCUN DROIT : il envoie, puis traduit ce qu'il reçoit (§19.6). MESURÉ, la
 * lectrice RÉUSSIT ce geste sur une affaire et reçoit le silence sur une autre, toutes deux
 * lisibles par elle (mesures 2 et 7). Ne lève jamais.
 */
export async function modifierRoleRattachement(
	client: ClientCrm,
	idCard: string,
	idContact: string,
	role: string,
): Promise<ResultatModificationRole> {
	try {
		const reponse = await client
			.from('card_contacts')
			.update({ role: normaliserFacultatif(role) })
			.eq('card_id', idCard)
			.eq('contact_id', idContact)
			.select(COLONNES_ROLE_RATTACHEMENT)
			.maybeSingle()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusRole(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		// ZÉRO LIGNE, ET AUCUNE ERREUR (§19.3, mesures 2 et 3). Deux situations aboutissent ici et
		// sont INDISTINGUABLES par construction : l'appelant n'a pas le droit d'écrire cette affaire,
		// ou le rattachement a disparu entre l'affichage de la fiche et l'envoi. Prétendre les séparer
		// renseignerait un appelant sans droit sur l'état de l'affaire
		// (`docs/SPEC-permissions-rls.md` §7). Un SEUL message les couvre.
		if (reponse.data === null || reponse.data === undefined) return { statut: 'sans-effet' }
		return { statut: 'modifiee', role: (reponse.data as { role: string | null }).role }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusRole(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

// =================================================================================================
// Les NOMS des contacts cités par le fil d'une affaire — CRM-060 tranche 5, §19.5
// =================================================================================================

/**
 * Rend, pour les identifiants demandés, le nom complet de chaque contact LISIBLE par l'appelant.
 *
 * POURQUOI UNE LECTURE À PART, ET NON `lireContactsDeLAffaire`. Un événement `contact_unlinked`
 * cite un contact qui n'est justement PLUS rattaché : la lecture du bloc de la fiche ne le rend
 * pas, et le fil resterait sans nom là où il en a le plus besoin — au moment du détachement.
 *
 * LA CARTE EST INCOMPLÈTE PLUTÔT QUE FAUSSE. Un contact supprimé, ou qu'une politique masque, n'a
 * simplement pas d'entrée : le fil retombe alors sur son libellé sans détail (§19.5), et n'invente
 * ni « inconnu », ni identifiant brut. La mémoire ne ment pas, elle se tait — c'est la règle déjà
 * suivie par les messages classés (`CRM-057` §18.6).
 */
export async function lireNomsDeContacts(
	client: ClientCrm | null,
	identifiants: readonly string[],
): Promise<ReadonlyMap<string, string>> {
	if (client === null || identifiants.length === 0) return new Map()
	try {
		const reponse = await client
			.from('contacts')
			.select('id,full_name')
			.in('id', [...new Set(identifiants)])
		if (reponse.error !== null) return new Map()
		return new Map(reponse.data.map((ligne) => [ligne.id, ligne.full_name]))
	} catch {
		return new Map()
	}
}
