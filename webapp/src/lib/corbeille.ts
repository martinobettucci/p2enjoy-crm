// @spec CRM-077 (docs/BACKLOG.md) — corbeille et restauration : l'énumération des enfants rendus
//       inaccessibles (cinquième tranche), ce que l'écran lit et écrit (sixième tranche), puis le
//       GESTE de mise à la corbeille d'une AFFAIRE (huitième tranche)
// @spec docs/SPEC-corbeille.md §3.3 (l'énumération remplace la descente de l'horodatage), §3.4 (la
//       restauration refuse plutôt que de deviner), §3.5 (ce qu'elle compte exactement, la forme des
//       lectures, la composition), §4.2 (les trois lectures de l'écran), §4.3 (l'auteur inconnu),
//       §4.5 (les trois issues de la restauration), §4 ter.3 (les trois issues du geste d'une
//       affaire), §4 ter.4 (le fil enregistre le geste), §4 ter.6 (l'horodatage du client)
// @spec docs/SPEC-permissions-rls.md §7 (un refus de lecture est zéro ligne)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE. Il lit `channels` sous la RLS de `CRM-021` et compte
// `cards` sous celle de `CRM-040` : ce qu'il rend est donc ce que l'appelant peut déjà lire
// ailleurs. MESURÉ le 2026-08-15 sur le track `conseil-ia` du seed — l'administratrice lit 3
// channels et 7 affaires, la lectrice 1 channel et 2 affaires. C'est voulu, et le §3.5 en tire la
// seule interdiction qui compte : ce nombre n'est pas une garantie d'exhaustivité.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/**
 * L'objet dont on énumère les enfants.
 *
 * Le type est une somme plutôt qu'une paire `(table, id)` : les deux cas ne comptent pas les mêmes
 * enfants (§3.5), et un appelant qui se tromperait de table ne compilerait pas.
 */
export type CibleEnumeration =
	| { readonly type: 'track'; readonly id: string }
	| { readonly type: 'channel'; readonly id: string }

/**
 * Ce que l'énumération rapporte, par type d'enfant.
 *
 * `channels` vaut toujours `0` pour un channel : il n'en porte pas. Le champ reste présent plutôt
 * que rendu optionnel, pour que la composition traite les deux cibles sans se demander de quoi elle
 * parle.
 */
export type EnumerationEnfants = {
	readonly channels: number
	readonly cards: number
}

/** Colonne réellement demandée. Exportée pour que les tests vérifient la requête émise. */
export const COLONNE_ENFANT = 'id'

/** Le compte vient du serveur, jamais des lignes rapportées (§3.5). */
export const OPTIONS_COMPTE = { count: 'exact', head: true } as const

/**
 * Une réponse aboutie sans `count` est un contrat rompu, pas une corbeille vide — même position que
 * `lireCompteursFileSortante` (`mail-etat.ts`) et `lirePageCards` (`liste-cards.ts`). Rendre `0`
 * ferait dire à l'écran « rien ne sera perdu » sur une réponse qu'on n'a pas comprise.
 */
const COMPTE_ABSENT = 'count absent alors que la réponse a abouti'

/**
 * Compte les enfants qu'une mise à la corbeille rendrait inaccessibles, ou que la corbeille retient
 * déjà — c'est le même compte, et donc la même requête, pour l'écran de confirmation d'un geste et
 * pour l'entrée d'un parent déjà retiré (§3.5, §4).
 *
 * Trois règles portées par les requêtes elles-mêmes :
 *
 *   * `deleted_at=is.null` sur les enfants — un enfant DÉJÀ en corbeille n'est pas compté : il ne
 *     *devient* pas inaccessible, il l'est, et il porte sa propre entrée où il se restaure
 *     séparément ;
 *   * aucun filtre sur `archived_at` — un enfant archivé EST compté, parce que l'archivage est
 *     réversible et que le désarchivage est livré : ce retour attendu est exactement ce que la mise
 *     à la corbeille du parent immobilise ;
 *   * les affaires sont comptées sur les channels retenus par la première lecture, donc jamais
 *     celles d'un channel lui-même en corbeille : elles sont retenues un cran plus bas, et
 *     restaurer le track ne les rendrait pas.
 *
 * DEUX LECTURES PLUTÔT QU'UNE JOINTURE EMBARQUÉE, ET C'EST MESURÉ : `cards` porte deux clés
 * étrangères composites vers `channels` (`cards_channel_id_workflow_id_fkey` et
 * `cards_channel_id_workspace_id_fkey`), et `select=id,channels!inner(id)` rend `300` / `PGRST201`.
 * Lever l'ambiguïté demanderait d'écrire un nom de contrainte dans la requête d'un écran, ce que
 * `lireCardsClassables` (`inbox.ts`) a déjà refusé pour cette relation. Le nombre de channels est la
 * longueur de la première lecture : il ne coûte aucune requête de plus.
 */
export async function compterEnfantsInaccessibles(
	client: ClientCrm,
	cible: CibleEnumeration,
): Promise<EtatAsync<EnumerationEnfants>> {
	try {
		if (cible.type === 'channel') {
			const cards = await client
				.from('cards')
				.select(COLONNE_ENFANT, OPTIONS_COMPTE)
				.eq('channel_id', cible.id)
				.is('deleted_at', null)
			if (cards.error !== null) {
				return enErreur(classerErreur(cards.status, cards.error.message))
			}
			if (cards.count === null) return enErreur(classerErreur(undefined, COMPTE_ABSENT))
			return pret({ channels: 0, cards: cards.count })
		}

		const channels = await client
			.from('channels')
			.select(COLONNE_ENFANT)
			.eq('track_id', cible.id)
			.is('deleted_at', null)
		if (channels.error !== null) {
			return enErreur(classerErreur(channels.status, channels.error.message))
		}
		const identifiants = channels.data.map((ligne) => ligne.id)
		// AUCUNE SECONDE LECTURE SANS CHANNEL. MESURÉ : `channel_id=in.()` rend `200` et `*/0`, donc
		// ce n'est pas un piège qu'on évite — c'est une requête dont la réponse est connue d'avance,
		// comme `useContenuTrack` n'interroge pas `channels` pour un track absent.
		if (identifiants.length === 0) return pret({ channels: 0, cards: 0 })

		const cards = await client
			.from('cards')
			.select(COLONNE_ENFANT, OPTIONS_COMPTE)
			.in('channel_id', identifiants)
			.is('deleted_at', null)
		if (cards.error !== null) {
			return enErreur(classerErreur(cards.status, cards.error.message))
		}
		if (cards.count === null) return enErreur(classerErreur(undefined, COMPTE_ABSENT))
		return pret({ channels: identifiants.length, cards: cards.count })
	} catch (cause) {
		// `supabase-js` peut relancer une panne de transport plutôt que la rendre : un échec réseau
		// ne doit pas remonter comme une exception non traitée jusqu'à React.
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Une ligne de l'énumération telle que l'écran l'affiche : un type d'enfant et son compte.
 *
 * La composition ne rend AUCUN texte : le catalogue vit dans `webapp/src/i18n`, qu'aucun module de
 * `lib/` n'importe. Le choix du singulier ou du pluriel appartient donc à l'écran, qui le fait sur
 * ce compte avec deux clés distinctes — jamais par une phrase concaténée (`CLAUDE.md` §23).
 */
export type LigneEnumeration =
	| { readonly type: 'channels'; readonly compte: number }
	| { readonly type: 'cards'; readonly compte: number }

/**
 * Compose l'énumération : les channels d'abord, les affaires ensuite — du plus englobant au plus
 * fin —, et **toute ligne dont le compte est nul est omise** : « 0 channel » n'apprend rien et se
 * lit deux fois pour comprendre qu'il n'y a rien (§3.5).
 *
 * Une énumération entièrement vide rend **aucune ligne**, et non une ligne à zéro : l'écran dit
 * alors sa propre phrase d'état vide (§4), un tableau sans ligne n'étant pas un état vide.
 */
export function composerEnumeration(enumeration: EnumerationEnfants): readonly LigneEnumeration[] {
	const lignes: LigneEnumeration[] = []
	if (enumeration.channels > 0) lignes.push({ type: 'channels', compte: enumeration.channels })
	if (enumeration.cards > 0) lignes.push({ type: 'cards', compte: enumeration.cards })
	return lignes
}

// ---------------------------------------------------------------------------------------------
// Ce que l'écran LIT — §4.2, §4.3
// ---------------------------------------------------------------------------------------------

/**
 * Le type d'un objet retiré. Une somme fermée : l'écran en dérive le libellé, la table à écrire et
 * la présence ou non d'une énumération, et un type ajouté sans traiter ces trois points ne
 * compilerait pas.
 */
export type TypeObjetCorbeille = 'track' | 'channel' | 'card'

/** Les trois tables, dans l'ordre où l'écran les lit. Exportée pour que les tests l'énumèrent. */
export const TABLES_CORBEILLE = {
	track: 'tracks',
	channel: 'channels',
	card: 'cards',
} as const satisfies Readonly<Record<TypeObjetCorbeille, string>>

/**
 * Une entrée de la corbeille, telle que l'écran l'affiche.
 *
 * `retirePar` est `null` quand l'audit ne porte aucun auteur, et ce n'est PAS une anomalie : un
 * objet mis à la corbeille par la clé de service naît sans `deleted_by` — elle ne porte aucune
 * revendication `sub`, et le trigger de `0037` fige ensuite la valeur (docs/SPEC-seed.md §10.2) —,
 * et `on delete set null` détache l'audit d'un profil supprimé (INC-076). MESURÉ sur le seed : la
 * card `Saisie erronée` est dans ce cas. L'écran le NOMME (§4.3) ; ce module ne choisit pas le
 * texte, il rapporte le fait.
 */
export type EntreeCorbeille = {
	readonly type: TypeObjetCorbeille
	readonly id: string
	readonly nom: string
	readonly retireLe: string
	readonly retirePar: string | null
}

/**
 * Colonnes réellement demandées, une écriture par table. Exportées pour que les tests comparent la
 * requête émise à celle qui est spécifiée.
 *
 * LE NOM DE LA CONTRAINTE EST OBLIGATOIRE, ET C'EST MESURÉ. `select=id,profiles(id)` rend `300` et
 * `PGRST201` sur les TROIS tables (§4.2) : sur `cards` parce que trois clés étrangères visent
 * `profiles`, sur `tracks` et `channels` parce que la relation plusieurs-à-plusieurs des tables
 * d'appartenance concurrence la seule clé `deleted_by`. Nommer la contrainte est la convention déjà
 * établie du produit pour désigner un profil embarqué — `colonnes-board.ts`, `colonnes-liste.ts` et
 * `commentaires.ts` l'écrivent de même.
 *
 * `cards` porte `title` là où les deux autres portent `name` : les colonnes ne sont donc pas
 * factorisables, et les trois écritures restent séparées plutôt que composées par concaténation.
 */
export const COLONNES_CORBEILLE = {
	track: 'id, name, deleted_at, auteur:profiles!tracks_deleted_by_fkey(full_name)',
	channel: 'id, name, deleted_at, auteur:profiles!channels_deleted_by_fkey(full_name)',
	card: 'id, title, deleted_at, auteur:profiles!cards_deleted_by_fkey(full_name)',
} as const satisfies Readonly<Record<TypeObjetCorbeille, string>>

/** Forme d'une ligne rapportée, quelle que soit la table. */
type LigneCorbeille = {
	readonly id: string
	readonly name?: string | null
	readonly title?: string | null
	readonly deleted_at: string | null
	readonly auteur: { readonly full_name: string } | null
}

/**
 * Lit une table, et rend ses entrées.
 *
 * `deleted_at` est filtré `not.is.null` CÔTÉ SERVEUR, et l'ordre est celui du serveur lui aussi :
 * rapporter toute la table pour n'en garder qu'une part ferait transiter ce que l'écran ne montre
 * pas, et trier en mémoire ce que `order` sait faire déplacerait une décision d'ordre hors de la
 * requête (même position que `lireTracksAdministrables`).
 *
 * Une ligne dont `deleted_at` est nul est **écartée** plutôt que rendue avec une date vide : elle
 * n'est pas dans la corbeille, et la colonne est déclarée nullable par le type généré. Le cas est
 * impossible sous le filtre ; le traiter coûte une ligne et évite d'afficher une entrée sans date.
 */
async function lireTable(
	client: ClientCrm,
	type: TypeObjetCorbeille,
): Promise<EtatAsync<readonly EntreeCorbeille[]>> {
	const reponse = await client
		.from(TABLES_CORBEILLE[type])
		.select(COLONNES_CORBEILLE[type])
		.not('deleted_at', 'is', null)
		.order('deleted_at', { ascending: false })
	if (reponse.error !== null) {
		return enErreur(classerErreur(reponse.status, reponse.error.message))
	}
	const entrees: EntreeCorbeille[] = []
	for (const ligne of reponse.data as unknown as readonly LigneCorbeille[]) {
		if (ligne.deleted_at === null) continue
		entrees.push({
			type,
			id: ligne.id,
			nom: ligne.title ?? ligne.name ?? '',
			retireLe: ligne.deleted_at,
			retirePar: ligne.auteur?.full_name ?? null,
		})
	}
	return pret(entrees)
}

/**
 * Toutes les entrées de la corbeille, les plus récemment retirées d'abord.
 *
 * TROIS LECTURES CONCURRENTES, ET UNE FUSION EN MÉMOIRE. Chaque lecture est ordonnée par le serveur ;
 * leur fusion ne l'est pas, `deleted_at` étant porté par chaque ligne. Le tri est donc exact, et il
 * porte sur ce qui a déjà été rapporté — la limite est nommée au §7 de la spécification, avec la
 * pagination qu'elle appellera le jour où une rétention bornera le volume.
 *
 * UNE SEULE LECTURE EN ÉCHEC SUFFIT À METTRE L'ÉCRAN EN ERREUR. Rendre les deux autres tables
 * afficherait une corbeille amputée que rien ne signalerait — la « valeur par défaut trompeuse » de
 * `CLAUDE.md` §18. Un refus de LECTURE, lui, ne passe pas par là : il rend zéro ligne et non une
 * erreur (docs/SPEC-permissions-rls.md §7), et c'est bien une corbeille vide pour cet appelant.
 */
export async function lireCorbeille(
	client: ClientCrm,
): Promise<EtatAsync<readonly EntreeCorbeille[]>> {
	try {
		const lectures = await Promise.all([
			lireTable(client, 'track'),
			lireTable(client, 'channel'),
			lireTable(client, 'card'),
		])
		const entrees: EntreeCorbeille[] = []
		for (const lecture of lectures) {
			if (lecture.statut === 'erreur') return enErreur(lecture.erreur)
			if (lecture.statut !== 'pret') continue
			entrees.push(...lecture.donnees)
		}
		return pret(trierParRetraitDecroissant(entrees))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Trie les entrées de la plus récemment retirée à la plus ancienne.
 *
 * Le tri est fait sur la CHAÎNE ISO 8601 rendue par PostgreSQL, dont l'ordre lexicographique est
 * l'ordre chronologique tant que le fuseau est le même — ce qu'il est, `timestamptz` étant toujours
 * rendu en UTC par PostgREST. À date égale, le type départage, pour que deux objets retirés dans le
 * même geste ne changent pas de place d'un chargement à l'autre : un ordre instable ferait sauter
 * les lignes sous le curseur sans qu'aucune donnée n'ait changé.
 */
export function trierParRetraitDecroissant(
	entrees: readonly EntreeCorbeille[],
): readonly EntreeCorbeille[] {
	const ORDRE: Readonly<Record<TypeObjetCorbeille, number>> = { track: 0, channel: 1, card: 2 }
	return [...entrees].sort((gauche, droite) => {
		if (gauche.retireLe !== droite.retireLe) return gauche.retireLe < droite.retireLe ? 1 : -1
		if (gauche.type !== droite.type) return ORDRE[gauche.type] - ORDRE[droite.type]
		return gauche.id < droite.id ? -1 : gauche.id > droite.id ? 1 : 0
	})
}

// ---------------------------------------------------------------------------------------------
// Ce que l'écran ÉCRIT — §3.4, §4.5
// ---------------------------------------------------------------------------------------------

/**
 * Nom de l'exception levée par la garde de `0038`, tel qu'il est écrit dans la migration.
 *
 * C'est la SEULE inspection de texte de ce module, et elle porte sur un nom d'exception — stable,
 * écrit dans la migration, et vérifié par `throws_ok` dans `0036_corbeille_restauration.test.sql`.
 * Le `details` qui l'accompagne, lui, est une phrase : il sert au diagnostic, jamais à l'affichage.
 * Même position que `NOM_CONTRAINTE_WORKFLOW` dans `administration-arborescence.ts`.
 */
export const NOM_REFUS_PARENT = 'parent_en_corbeille'

/**
 * Les refus qu'une restauration peut recevoir.
 *
 * `parent-en-corbeille` est distingué de `forbidden` parce que les deux appellent des gestes
 * OPPOSÉS : le premier dit « restaurez d'abord le parent », geste que l'utilisateur peut faire
 * séance tenante sur ce même écran ; le second dit qu'il n'en a pas le droit. Les confondre sous
 * « une erreur est survenue » serait la valeur par défaut trompeuse de `CLAUDE.md` §18.
 */
export type NatureRefusRestauration = 'parent-en-corbeille' | 'forbidden' | 'network' | 'unknown'

export type RefusRestauration = {
	readonly nature: NatureRefusRestauration
	readonly detail: string
}

/**
 * Classe un refus sur le CODE PostgreSQL d'abord, le code HTTP ensuite — la règle de `classerErreur`,
 * reprise sans exception.
 *
 * MESURÉ le 2026-08-15 avec le jeton réel de l'administratrice : restaurer le channel `…038`, dont
 * le track est en corbeille, rend `400` et `{"code":"P0001","message":"parent_en_corbeille"}`.
 * `P0001` est le SQLSTATE générique de `raise exception` : il ne suffit pas à lui seul à identifier
 * la garde, et le nom de l'exception est donc vérifié avec lui.
 */
export function classerRefusRestauration(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusRestauration {
	if (code === 'P0001' && detail.includes(NOM_REFUS_PARENT)) {
		return { nature: 'parent-en-corbeille', detail }
	}
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/**
 * Les trois issues d'une restauration (§4.5).
 *
 * `sans-effet` n'est NI un succès NI une erreur, et c'est mesuré : la clause `USING` de la politique
 * filtre la ligne avant la mise à jour, PostgREST rend `200` et zéro ligne (décision 70), et rien
 * n'a changé. MESURÉ : la lectrice qui tente de restaurer le track `…025` reçoit `200` et `[]`, et
 * le track est relu **toujours en corbeille**. La confondre avec un succès annoncerait une
 * restauration qui n'a pas eu lieu.
 */
export type ResultatRestauration =
	| { readonly statut: 'appliquee' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusRestauration }

/**
 * Restaure un objet : `deleted_at` à `NULL`, sur ce seul objet (§3.4).
 *
 * `deleted_by` N'EST PAS ÉCRITE ICI, et ce n'est pas un oubli : le trigger de `0037` l'efface à la
 * restauration — « supprimé par X » sur un objet vivant serait un mensonge de plus, pas une trace de
 * plus —, et la colonne est de toute façon fermée au client par le privilège.
 *
 * L'écran N'ANTICIPE RIEN : il envoie, puis traduit ce qu'il reçoit. Décider d'avance qu'une
 * restauration est impossible ferait porter à l'interface une garde qui vit dans la base
 * (`CLAUDE.md` §10) — et l'écran se tromperait dès qu'un autre utilisateur aurait restauré le parent
 * entre le chargement de la liste et le clic.
 *
 * `select('id')` accompagne l'écriture précisément pour que « zéro ligne touchée » existe comme
 * réponse : sans lui, PostgREST ne rend aucun corps et le refus de droit serait indistinguable d'un
 * succès.
 */
export async function restaurer(
	client: ClientCrm,
	type: TypeObjetCorbeille,
	id: string,
): Promise<ResultatRestauration> {
	try {
		const reponse = await client
			.from(TABLES_CORBEILLE[type])
			.update({ deleted_at: null })
			.eq('id', id)
			.select('id')
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusRestauration(
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
			refus: classerRefusRestauration(
				undefined,
				undefined,
				cause instanceof Error ? cause.message : String(cause),
			),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Le GESTE de mise à la corbeille d'une AFFAIRE — §4 ter
// ---------------------------------------------------------------------------------------------
//
// POURQUOI ICI, ET NON DANS LE MODULE DE L'ÉCRAN. Le geste d'un track et d'un channel vit dans
// `administration-arborescence.ts`, parce que l'écran qui le porte est celui de l'arborescence et
// qu'il partage son enveloppe d'écriture. Une affaire n'a pas d'écran d'administration : sa surface
// est sa route de détail (§4 ter.1), dont le module — `formulaire.ts` — compose un formulaire et
// n'écrit rien. Le geste rejoint donc le domaine auquel il appartient, la corbeille, à côté de la
// restauration qui l'annule. L'asymétrie est nommée plutôt que tue.
//
// LA CHARGE NE CONTIENT QUE `deleted_at`, comme au §4 bis.5 : `deleted_by` est fermée au client par
// le privilège de colonne de `0037`, et l'y ajouter ferait refuser TOUTE l'écriture en `42501`.
//
// LE FIL N'EST PAS ÉCRIT ICI NON PLUS, et c'est MESURÉ (§4 ter.4) : le trigger de `0016`, dans sa
// forme de `0020`, fait naître un événement `trashed` portant l'acteur. Un événement posé par le
// client serait une trace que rien ne garantit.

/**
 * Les refus qu'un geste de mise à la corbeille peut recevoir.
 *
 * `parent-en-corbeille` n'y figure PAS, et c'est un fait du modèle plutôt qu'un oubli : la garde de
 * `0038` juge une **restauration**, jamais un retrait. Offrir une nature qui ne peut pas survenir
 * obligerait chaque appelant à traiter une branche morte.
 */
export type NatureRefusGeste = 'forbidden' | 'network' | 'unknown'

export type RefusGeste = {
	readonly nature: NatureRefusGeste
	readonly detail: string
}

/**
 * Classe un refus du geste sur le code HTTP.
 *
 * Aucun code PostgreSQL n'est inspecté, contrairement à `classerRefusRestauration` : le geste ne
 * traverse ni garde nommée ni contrainte de forme — il écrit une colonne nullable sous la seule
 * politique `cards_maj`, dont le refus est soit un `401`/`403`, soit `200` et zéro ligne (§4 ter.3).
 */
export function classerRefusGeste(statutHttp: number | undefined, detail: string): RefusGeste {
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}

/**
 * Les trois issues du geste (§4 ter.3), MESURÉES avec les jetons réels sur l'affaire
 * `Migration ERP Sogexia` :
 *
 *   * l'administratrice ET le business developer obtiennent `200` et la ligne, `deleted_by` posée
 *     par le trigger — le geste d'une affaire n'est PAS un geste d'administration, `cards_maj`
 *     portant sur `app.can_write_channel` et non sur un rôle ;
 *   * la lectrice obtient `200` et `[]`, la ligne relue INCHANGÉE — quatrième occurrence de la
 *     décision 70 dans cette unité.
 */
export type ResultatGesteCorbeille =
	| { readonly statut: 'appliquee' }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusGeste }

/**
 * Met une affaire à la corbeille : `deleted_at` horodatée, sur cette seule ligne.
 *
 * L'HORODATAGE EST CELUI DU CLIENT (§4 ter.6, §4 bis.4) : le poser côté serveur remplacerait la date
 * fixe des objets en corbeille du seed par l'instant du rejeu, et la reproductibilité du jeu de
 * démonstration tomberait avec elle (`CLAUDE.md` §8). L'injection de `maintenant` existe pour que la
 * preuve unitaire lise la charge émise, jamais pour déplacer la décision.
 *
 * `select('id')` accompagne l'écriture pour que « zéro ligne touchée » existe comme réponse : sans
 * lui, PostgREST ne rend aucun corps et le refus silencieux d'une politique serait indistinguable
 * d'un succès.
 */
export async function mettreCardALaCorbeille(
	client: ClientCrm,
	id: string,
	maintenant: () => string = () => new Date().toISOString(),
): Promise<ResultatGesteCorbeille> {
	try {
		const reponse = await client
			.from('cards')
			.update({ deleted_at: maintenant() })
			.eq('id', id)
			.select('id')
		if (reponse.error !== null) {
			return { statut: 'refus', refus: classerRefusGeste(reponse.status, reponse.error.message) }
		}
		if (reponse.data !== null && reponse.data.length === 0) return { statut: 'sans-effet' }
		return { statut: 'appliquee' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusGeste(undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}
