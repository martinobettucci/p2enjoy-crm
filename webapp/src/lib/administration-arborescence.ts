// @spec CRM-075 (docs/BACKLOG.md) — administration des tracks et des channels
// @spec docs/SPEC-administration-arborescence.md §2 (ce que la base garantit déjà), §5 (créer et
//       renommer), §6 (réordonner et archiver), §7 (les channels), §8 (validation de forme),
//       §9 (les refus)
// @spec docs/SPEC-tracks.md §3 (ordre et trigger), §4 (archivage), §6 (contrat d'API mesuré)
// @spec docs/SPEC-channels.md §3 (ordre par track), §4 (archivage), §7 (contrat d'API mesuré)
// @spec docs/SPEC-workflow-engine.md §4.12 (contrainte d'affectation d'un workflow)
// @spec docs/SPEC-permissions-rls.md §4 (écriture réservée à l'administrateur)
//
// CE MODULE N'INVENTE AUCUNE RÈGLE. C'est la contrainte la plus forte de `CRM-075`, et elle est
// vérifiable ligne à ligne : chaque refus traduit ici est déjà posé et mesuré par `CRM-020`,
// `CRM-021` ou `CRM-033`. Rien n'est anticipé pour décider si une requête part — l'écran envoie,
// puis traduit le refus reçu (docs/SPEC-administration-arborescence.md §2, CLAUDE.md §10).
//
// La seule exception est la validation de FORME du §8, qui n'économise qu'un aller-retour dont la
// réponse est connue d'avance, et dont l'erreur reste rattrapée par le refus de la base.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'écran lit
// ---------------------------------------------------------------------------------------------

/**
 * Un track tel que l'administration a besoin de le connaître.
 *
 * Elle en demande **plus** que la barre latérale (`webapp/src/lib/tracks.ts`) : `description`,
 * parce qu'elle l'édite, et `archived_at`, parce qu'elle distingue une ligne archivée d'une ligne
 * active. Les deux modules ne sont donc pas fusionnés — une requête ne rapporte que ce qui est
 * affiché, et la barre latérale n'affiche ni l'une ni l'autre.
 */
export type TrackAdministrable = Pick<
	Database['public']['Tables']['tracks']['Row'],
	'id' | 'workspace_id' | 'name' | 'slug' | 'description' | 'color' | 'icon' | 'position' | 'archived_at'
>

/** Un channel tel que l'administration a besoin de le connaître. */
export type ChannelAdministrable = Pick<
	Database['public']['Tables']['channels']['Row'],
	'id' | 'workspace_id' | 'track_id' | 'name' | 'slug' | 'description' | 'workflow_id' | 'position' | 'archived_at'
>

/** Un workflow affectable à un channel, tel que le sélecteur de `§7.2` le présente. */
export type WorkflowAffectable = Pick<
	Database['public']['Tables']['workflows']['Row'],
	'id' | 'name' | 'scope' | 'is_default'
>

/** Colonnes réellement demandées. Exportées pour que les tests vérifient la requête émise. */
export const COLONNES_TRACK_ADMIN =
	'id, workspace_id, name, slug, description, color, icon, position, archived_at'
export const COLONNES_CHANNEL_ADMIN =
	'id, workspace_id, track_id, name, slug, description, workflow_id, position, archived_at'
export const COLONNES_WORKFLOW_AFFECTABLE = 'id, name, scope, is_default'

/**
 * Les tracks d'un workspace, dans l'ordre de la barre latérale.
 *
 * `inclureArchives` retire le filtre `archived_at=is.null` — c'est la case du §6.4, éteinte par
 * défaut. Le filtre reste **côté serveur** dans les deux cas : lire toutes les lignes pour en
 * masquer la moitié dans le navigateur ferait transiter ce que l'écran ne montre pas.
 *
 * L'ordre reprend celui de `docs/SPEC-tracks.md` §3 — `position` puis `name` — sans quoi
 * l'administration classerait les tracks autrement que la barre latérale qu'elle configure.
 */
export async function lireTracksAdministrables(
	client: ClientCrm,
	inclureArchives: boolean,
): Promise<EtatAsync<readonly TrackAdministrable[]>> {
	try {
		const base = client.from('tracks').select(COLONNES_TRACK_ADMIN)
		const filtre = inclureArchives ? base : base.is('archived_at', null)
		const reponse = await filtre.order('position').order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les channels d'un **seul** track, dans l'ordre de sa barre d'onglets.
 *
 * Le filtre `track_id` est côté serveur, et le chargement n'a lieu qu'au dépliage de ce track
 * (docs/SPEC-administration-arborescence.md §3.2) : charger les channels des quatre tracks à
 * l'ouverture ferait transiter des lignes que l'écran ne montre pas.
 */
export async function lireChannelsAdministrables(
	client: ClientCrm,
	trackId: string,
	inclureArchives: boolean,
): Promise<EtatAsync<readonly ChannelAdministrable[]>> {
	try {
		const base = client.from('channels').select(COLONNES_CHANNEL_ADMIN).eq('track_id', trackId)
		const filtre = inclureArchives ? base : base.is('archived_at', null)
		const reponse = await filtre.order('position').order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les workflows affectables à un channel de ce track — et **exactement** ceux-là.
 *
 * La règle est celle de `docs/SPEC-workflow-engine.md` §4.12.2 : un workflow `global` du workspace,
 * ou un workflow `track` rattaché au track du channel. Elle est portée par le filtre, côté serveur,
 * plutôt que par un tri en mémoire : proposer un workflow que le trigger refusera ensuite serait
 * offrir un choix voué au `23514`.
 *
 * Le workflow par défaut est rendu **en tête** (`is_default.desc`), ce qui est une aide de lecture.
 * Il n'est pas présélectionné pour autant : « le défaut silencieux transformerait une omission du
 * client en un choix qu'il n'a pas fait » (§4.12.5), et cela vaut d'un formulaire comme d'une
 * colonne.
 */
export function filtreWorkflowsAffectables(trackId: string): string {
	return `scope.eq.global,and(scope.eq.track,track_id.eq.${trackId})`
}

export async function lireWorkflowsAffectables(
	client: ClientCrm,
	workspaceId: string,
	trackId: string,
): Promise<EtatAsync<readonly WorkflowAffectable[]>> {
	try {
		const reponse = await client
			.from('workflows')
			.select(COLONNES_WORKFLOW_AFFECTABLE)
			.eq('workspace_id', workspaceId)
			.or(filtreWorkflowsAffectables(trackId))
			.order('is_default', { ascending: false })
			.order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Validation de forme — §8
// ---------------------------------------------------------------------------------------------

/**
 * Motif d'un slug, **copié de la contrainte de la base** — `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`
 * (docs/SPEC-tracks.md §2.1, docs/SPEC-channels.md §2.1).
 *
 * Il est exporté pour que le test unitaire compare les deux écritures. Ce n'est pas la règle : la
 * règle est le `CHECK`, et le `23514` reste traité par `classerRefusEcriture`. Une borne
 * d'interface qui prétendrait remplacer une contrainte serait exactement le contrôle d'interface
 * que `CLAUDE.md` §10 refuse de considérer comme une règle — même position que `LONGUEUR_MAX_CORPS`
 * dans `webapp/src/lib/commentaires.ts`.
 */
export const MOTIF_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const slugConforme = (slug: string): boolean => MOTIF_SLUG.test(slug)

/** `btrim(name) <> ''`, la contrainte de la base, lue depuis l'interface. */
export const nomConforme = (nom: string): boolean => nom.trim() !== ''

/**
 * Propose un slug à partir d'un nom. **Commodité, jamais garantie** (§5.1).
 *
 * `normalize('NFD')` sépare les diacritiques latines de leur lettre, que la plage `̀-ͯ`
 * retire ensuite : « Conseil & IA » donne `conseil-ia`, « Réseau » donne `reseau`. Ce qui n'est pas
 * décomposable — une écriture non latine — n'est pas translittéré, et c'est assumé : inventer une
 * romanisation produirait un identifiant que personne ne reconnaîtrait.
 *
 * Lorsqu'il ne reste aucun caractère exploitable, la proposition est **vide** et le champ reste à
 * remplir. L'écran ne fabrique pas un slug de son cru : un `track-1` silencieux serait un choix
 * qu'aucun utilisateur n'a fait.
 */
export function proposerSlug(nom: string): string {
	return nom
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
}

// ---------------------------------------------------------------------------------------------
// Réordonnancement — §6.2
// ---------------------------------------------------------------------------------------------

/** Ce qu'un objet doit exposer pour être réordonné : sa position, et rien d'autre. */
export type Ordonnable = { readonly id: string; readonly position: number }

export type Sens = 'monter' | 'descendre'

/**
 * Résultat du calcul d'un déplacement.
 *
 * `impossible` n'est **pas** une erreur : c'est le refus motivé du §6.2, lorsque l'arithmétique ne
 * peut pas produire une position qui change réellement l'ordre affiché. L'écran le nomme au lieu
 * d'écrire une valeur sans effet, ce que `CLAUDE.md` §18 proscrit sous le nom de « valeur par
 * défaut trompeuse ».
 */
export type Deplacement =
	| { readonly statut: 'calcule'; readonly position: number }
	| { readonly statut: 'impossible'; readonly cause: CauseImpossible }

export type CauseImpossible =
	/** L'objet est déjà à l'extrémité visée. La commande est désactivée, ce cas la double. */
	| 'extremite'
	/**
	 * Les deux voisines portent la même position, ou la première position est nulle ou négative :
	 * le milieu leur est égal, et l'écriture ne changerait rien à l'ordre affiché. Un renumérotage
	 * atomique lèverait le cas ; aucune unité ne le porte
	 * (docs/SPEC-administration-arborescence.md §11, limite 2).
	 */
	| 'positions-indistinctes'

/**
 * Calcule la **nouvelle position** de l'objet déplacé — une seule écriture, jamais une permutation.
 *
 * Une permutation coûterait deux `UPDATE` non atomiques dont le second peut échouer, laissant la
 * liste dans un état que personne n'a voulu. Le milieu de deux voisines n'écrit qu'une ligne, et un
 * refus laisse la liste **exactement** dans son état d'origine. C'est l'usage pour lequel
 * `position` est un `numeric` et non un entier (docs/SPEC-tracks.md §3).
 *
 * La liste reçue est celle que l'écran affiche, donc déjà triée par `position` puis par `name`
 * comme le serveur l'a rendue. Le calcul ne re-trie pas : il ferait alors porter à l'interface une
 * décision d'ordre qui appartient à la requête.
 */
export function calculerDeplacement(
	liste: readonly Ordonnable[],
	id: string,
	sens: Sens,
): Deplacement {
	const rang = liste.findIndex((element) => element.id === id)
	if (rang === -1) return { statut: 'impossible', cause: 'extremite' }

	// Les voisines sont lues par un accès **gardé** : `noUncheckedIndexedAccess` rend le type
	// `Ordonnable | undefined`, et c'est exact — un rang hors bornes n'a pas de voisine. Chaque
	// absence est traduite en `extremite` plutôt qu'écartée par une assertion, qui ferait taire le
	// compilateur sur le seul cas où ce calcul peut se tromper.
	const positionAu = (index: number): number | undefined => liste[index]?.position

	if (sens === 'monter') {
		// Monter d'un cran, c'est passer AVANT la ligne précédente : la borne haute est la position
		// de cette précédente, la borne basse celle d'avant elle lorsqu'elle existe.
		const precedente = positionAu(rang - 1)
		if (rang === 0 || precedente === undefined) return { statut: 'impossible', cause: 'extremite' }
		const avantPrecedente = positionAu(rang - 2)
		if (avantPrecedente === undefined) return positionAvant(precedente)
		return positionEntre(avantPrecedente, precedente)
	}

	const suivante = positionAu(rang + 1)
	if (suivante === undefined) return { statut: 'impossible', cause: 'extremite' }
	const apresSuivante = positionAu(rang + 2)
	// Descendre en queue de liste : aucune borne haute, la position suivante suffit. `+ 1` reprend
	// l'incrément du trigger d'insertion (docs/SPEC-tracks.md §3), plutôt qu'un pas inventé.
	if (apresSuivante === undefined) return { statut: 'calcule', position: suivante + 1 }
	return positionEntre(suivante, apresSuivante)
}

/**
 * Milieu strict de deux positions.
 *
 * La vérification porte sur le **résultat**, non sur les entrées : c'est elle qui attrape à la fois
 * l'égalité des bornes et l'épuisement de la précision flottante après une cinquantaine
 * d'insertions au même point (§11, limite 3). Tester `avant === apres` laisserait passer le second
 * cas, où les bornes diffèrent mais leur milieu est égal à l'une d'elles.
 */
export function positionEntre(avant: number, apres: number): Deplacement {
	const milieu = (avant + apres) / 2
	if (!(milieu > avant && milieu < apres)) {
		return { statut: 'impossible', cause: 'positions-indistinctes' }
	}
	return { statut: 'calcule', position: milieu }
}

/**
 * Position strictement inférieure à la première de la liste.
 *
 * `premiere / 2` ne convient que si la première position est **strictement positive** : pour `0` le
 * milieu vaut `0`, et pour une position négative la division la fait remonter. La base autorise ces
 * deux valeurs — `position` est un `numeric` sans contrainte de signe —, elles sont donc traitées
 * même si le seed n'en produit aucune.
 */
export function positionAvant(premiere: number): Deplacement {
	if (premiere <= 0) return { statut: 'impossible', cause: 'positions-indistinctes' }
	return { statut: 'calcule', position: premiere / 2 }
}

/** Une commande de réordonnancement est-elle atteignable ? Sert à la désactiver, pas à la masquer. */
export function deplacementPossible(
	liste: readonly Ordonnable[],
	id: string,
	sens: Sens,
): boolean {
	return calculerDeplacement(liste, id, sens).statut === 'calcule'
}

// ---------------------------------------------------------------------------------------------
// Les refus — §9
// ---------------------------------------------------------------------------------------------

/**
 * Les refus qu'une écriture d'arborescence peut recevoir, tels que l'écran doit les présenter.
 *
 * Chacun appelle un geste différent de l'utilisateur, et les confondre sous « une erreur est
 * survenue » serait la valeur par défaut trompeuse de `CLAUDE.md` §18.
 */
export type NatureRefusEcriture =
	/** `403`/`401` — `42501`. Seul un administrateur du workspace écrit (docs/SPEC-tracks.md §5.1). */
	| 'forbidden'
	/** `23505` — l'unicité du slug, par workspace pour un track, par track pour un channel. */
	| 'slug-pris'
	/** `23514` `workflow_hors_track` — docs/SPEC-workflow-engine.md §4.12.3. */
	| 'workflow-hors-track'
	/** `23514` — un `CHECK` de forme : nom vide, slug malformé, couleur ou icône hors contrainte. */
	| 'forme-refusee'
	/** `23503` — clé étrangère : le track a disparu, ou n'est pas dans ce workspace (§2.4). */
	| 'reference-absente'
	| 'network'
	| 'unknown'

export type RefusEcriture = {
	readonly nature: NatureRefusEcriture
	readonly detail: string
}

/**
 * Classe un refus d'écriture sur le **code PostgreSQL** d'abord, le **code HTTP** ensuite, et
 * jamais sur le texte du message — la règle de `classerErreur` (`webapp/src/lib/async.ts`),
 * reprise sans exception.
 *
 * L'ordre compte. `23514` couvre deux refus très différents : la contrainte d'affectation d'un
 * workflow, qui lève l'exception nommée `workflow_hors_track` (docs/SPEC-workflow-engine.md
 * §4.12.3), et les `CHECK` de forme. Ils partagent le SQLSTATE **à dessein** — « un client qui trie
 * ses erreurs par famille le range alors avec `channels_name_check` », dit le §4.12.3 —, et seul le
 * nom de la contrainte les sépare.
 *
 * C'EST LA SEULE INSPECTION DE TEXTE DE CE MODULE, et elle porte sur un **nom de contrainte**, pas
 * sur une phrase : un nom est stable, il est écrit dans la migration, et pgTAP le vérifie. Le
 * message qui l'entoure, lui, dépend de la version de PostgreSQL.
 */
export const NOM_CONTRAINTE_WORKFLOW = 'workflow_hors_track'

export function classerRefusEcriture(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusEcriture {
	if (code === '23505') return { nature: 'slug-pris', detail }
	if (code === '23503') return { nature: 'reference-absente', detail }
	if (code === '23514') {
		return detail.includes(NOM_CONTRAINTE_WORKFLOW)
			? { nature: 'workflow-hors-track', detail }
			: { nature: 'forme-refusee', detail }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/**
 * Résultat d'une écriture.
 *
 * `sans-effet` n'est ni un succès ni une erreur : le `USING` de la politique filtre la ligne avant
 * la mise à jour, PostgREST rend `200` et **zéro ligne**, et l'écran doit le dire. Le confondre
 * avec un succès afficherait une modification qui n'a pas eu lieu — le défaut que `ResultatGeste`
 * traite déjà pour les commentaires (`webapp/src/lib/commentaires.ts`, docs/SPEC-cards.md §13.8).
 */
export type ResultatEcriture =
	| { readonly statut: 'applique' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusEcriture }

/** Enveloppe commune : aucune écriture de ce module ne lève, toutes rendent un résultat classé. */
async function executer(
	appel: () => PromiseLike<{
		error: { code?: string; message: string } | null
		status: number
		data: unknown[] | null
	}>,
): Promise<ResultatEcriture> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusEcriture(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		// `select()` accompagne chaque écriture précisément pour que ce comptage existe : sans lui,
		// PostgREST ne rend aucun corps et « zéro ligne touchée » serait indistinguable d'un succès.
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusEcriture(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Les écritures
// ---------------------------------------------------------------------------------------------

export type CreationTrack = {
	readonly idWorkspace: string
	readonly nom: string
	readonly slug: string
	readonly couleur: string
	readonly icone: string
	readonly description: string
}

/**
 * Crée un track.
 *
 * `position` EST ENVOYÉE À `null`, et c'est mesuré plutôt que supposé. `docs/SPEC-tracks.md` §3 :
 * « un trigger `BEFORE INSERT` reçoit `new.position` à `NULL` que le client l'ait **omise** ou
 * écrite explicitement : il ne peut pas distinguer les deux cas. Écrire `position: null` à
 * l'insertion équivaut donc à l'omettre, et le trigger place le track en fin de liste. »
 *
 * L'assertion de type est nécessaire parce que le générateur de `CRM-006` **ne voit pas les
 * triggers** : il lit une colonne `NOT NULL` sans défaut de colonne et la déclare obligatoire. Le
 * cas est le même que `workspace_id` à la publication d'un commentaire (`commentaires.ts`), et il
 * est écrit ici au lieu d'être tu — l'alternative serait de calculer `max + 1` dans le navigateur,
 * c'est-à-dire de recopier le trigger en moins fiable et en y ajoutant une course entre deux
 * administrateurs.
 *
 * `description` vide est envoyée à `null` : la colonne est facultative, et une chaîne vide y serait
 * une valeur, distincte de l'absence, que rien ne distinguerait à l'écran.
 */
export async function creerTrack(
	client: ClientCrm,
	creation: CreationTrack,
): Promise<ResultatEcriture> {
	return executer(() =>
		client
			.from('tracks')
			.insert({
				workspace_id: creation.idWorkspace,
				name: creation.nom,
				slug: creation.slug,
				color: creation.couleur,
				icon: creation.icone,
				description: creation.description.trim() === '' ? null : creation.description,
				position: null,
			} as unknown as Database['public']['Tables']['tracks']['Insert'])
			.select('id'),
	)
}

export type ModificationTrack = {
	readonly nom: string
	readonly couleur: string
	readonly icone: string
	readonly description: string
}

/**
 * Renomme un track — nom, couleur, icône et description.
 *
 * `slug` n'y figure pas, et ce n'est pas la base qui le refuse : elle l'accepte, et la preuve d'API
 * le mesure. C'est l'écran qui ne l'expose pas, parce que `/tracks/:slug` est l'adresse qu'un
 * utilisateur partage et qu'aucune redirection n'existe pour rattraper un lien rompu
 * (docs/SPEC-administration-arborescence.md §5.3). La distinction entre « la base refuse » et
 * « l'écran ne propose pas » est celle que `CLAUDE.md` §10 impose de tenir.
 */
export async function modifierTrack(
	client: ClientCrm,
	id: string,
	modification: ModificationTrack,
): Promise<ResultatEcriture> {
	return executer(() =>
		client
			.from('tracks')
			.update({
				name: modification.nom,
				color: modification.couleur,
				icon: modification.icone,
				description: modification.description.trim() === '' ? null : modification.description,
			})
			.eq('id', id)
			.select('id'),
	)
}

/** Écrit la position calculée par `calculerDeplacement`. Une ligne, une écriture. */
export async function deplacerTrack(
	client: ClientCrm,
	id: string,
	position: number,
): Promise<ResultatEcriture> {
	return executer(() => client.from('tracks').update({ position }).eq('id', id).select('id'))
}

/**
 * Archive ou désarchive un track.
 *
 * L'horodatage est celui du **client**, faute d'un défaut de colonne ou d'une RPC qui le prendrait
 * du serveur. C'est une approximation, et elle est nommée : `archived_at` sert à masquer, jamais à
 * ordonner ni à mesurer une durée — aucune règle du produit ne dépend de sa valeur exacte, seule
 * sa nullité compte (docs/SPEC-tracks.md §4). Le jour où une rétention en dépendra (`CRM-077`),
 * elle devra venir du serveur.
 */
export async function archiverTrack(
	client: ClientCrm,
	id: string,
	archive: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<ResultatEcriture> {
	return executer(() =>
		client
			.from('tracks')
			.update({ archived_at: archive ? maintenant() : null })
			.eq('id', id)
			.select('id'),
	)
}

export type CreationChannel = {
	readonly idWorkspace: string
	readonly idTrack: string
	readonly idWorkflow: string
	readonly nom: string
	readonly slug: string
	readonly description: string
}

/**
 * Crée un channel.
 *
 * `workspace_id` est celui **du track déplié**, jamais une valeur saisie : la clé étrangère
 * composite `channels_track_id_workspace_id_fkey` refuse toute autre combinaison en `23503`
 * (docs/SPEC-channels.md §2.4), refus traduit en `reference-absente`.
 *
 * `workflow_id` est obligatoire depuis `CRM-033`, et aucun défaut n'est appliqué ici : le champ
 * vient du sélecteur du §7.2, alimenté par `lireWorkflowsAffectables`. Si l'appelant en désigne un
 * autre, le trigger lève `workflow_hors_track` et le refus est traduit.
 *
 * `position` suit exactement le même raisonnement que pour un track, dans la portée du track
 * (docs/SPEC-channels.md §3).
 */
export async function creerChannel(
	client: ClientCrm,
	creation: CreationChannel,
): Promise<ResultatEcriture> {
	return executer(() =>
		client
			.from('channels')
			.insert({
				workspace_id: creation.idWorkspace,
				track_id: creation.idTrack,
				workflow_id: creation.idWorkflow,
				name: creation.nom,
				slug: creation.slug,
				description: creation.description.trim() === '' ? null : creation.description,
				position: null,
			} as unknown as Database['public']['Tables']['channels']['Insert'])
			.select('id'),
	)
}

export type ModificationChannel = {
	readonly nom: string
	readonly description: string
	readonly idWorkflow: string
}

/**
 * Renomme un channel et, le cas échéant, change son workflow.
 *
 * Changer le workflow d'un channel existant est la **porte 1** du §4.12.1 — celle que le trigger
 * sur `channels` garde. L'écran l'expose parce que l'énoncé de `CRM-075` le demande explicitement
 * (« plus son rattachement à un track et son **workflow** ») ; le refus reste celui du trigger.
 */
export async function modifierChannel(
	client: ClientCrm,
	id: string,
	modification: ModificationChannel,
): Promise<ResultatEcriture> {
	return executer(() =>
		client
			.from('channels')
			.update({
				name: modification.nom,
				description: modification.description.trim() === '' ? null : modification.description,
				workflow_id: modification.idWorkflow,
			})
			.eq('id', id)
			.select('id'),
	)
}

export async function deplacerChannel(
	client: ClientCrm,
	id: string,
	position: number,
): Promise<ResultatEcriture> {
	return executer(() => client.from('channels').update({ position }).eq('id', id).select('id'))
}

export async function archiverChannel(
	client: ClientCrm,
	id: string,
	archive: boolean,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<ResultatEcriture> {
	return executer(() =>
		client
			.from('channels')
			.update({ archived_at: archive ? maintenant() : null })
			.eq('id', id)
			.select('id'),
	)
}
