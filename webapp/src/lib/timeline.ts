// @spec CRM-044 (docs/BACKLOG.md) — lecture des événements et fusion du fil unifié
// @spec CRM-022 (docs/BACKLOG.md) — acteur embarqué et nommé quand il existe
// @spec docs/SPEC-cards.md §14.4 (les dix types), §14.6 (payloads, et les libellés absents),
//       §14.10 (interface : une requête par source, fusion en mémoire, filtre qui ne recharge pas)
// @spec docs/DESIGN_SYSTEM.md §5.11 (timeline unifiée), §5.10 (le fil des commentaires),
//       §5.8 (états systématiques)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone), §11 (stockage côté client)
// @spec docs/JOURNAL.md décisions 204 (`clock_timestamp()`), 208 (la clé `from` absente),
//       209 (le fil est unifié à la LECTURE)
//
// Ce module ne rend rien : il **lit et fusionne**. La séparation est ce qui rend l'ordre du fil,
// les familles de filtres et la résolution des libellés vérifiables **sans navigateur**.
//
// LA FUSION SE FAIT À LA LECTURE (décision 209). Un commentaire n'écrit aucun événement : le
// dupliquer produirait deux représentations d'un même fait, dont l'une — immuable — survivrait à la
// pierre tombale de l'autre. Les deux sources sont lues séparément, ce sont deux tables et deux
// politiques, puis rangées ensemble sur `(created_at, id)`.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { CommentaireAffiche } from './commentaires'
import type { Database } from './database.types'
import type { ProfilAffiche } from './identites'
import type { ClientCrm } from './supabase'

/**
 * Colonnes réellement demandées.
 *
 * `workspace_id` n'est pas demandée : c'est une dénormalisation que l'écran n'affiche pas.
 * L'acteur est embarqué par la FK. Une valeur nulle reste muette : elle peut désigner un geste de
 * service comme un compte détaché, et la timeline n'invente jamais lequel.
 */
export const COLONNES_EVENEMENT =
	'id, card_id, type, actor_id, payload, created_at, acteur:profiles!card_events_actor_id_fkey(id, full_name, avatar_url)'

export type EvenementLu = Pick<
	Database['public']['Tables']['card_events']['Row'],
	'id' | 'card_id' | 'type' | 'actor_id' | 'payload' | 'created_at'
> & {
	readonly acteur: ProfilAffiche | null
}

/** Les dix types que la base accepte (docs/SPEC-cards.md §14.4). */
export const TYPES_EVENEMENT = [
	'created',
	'moved',
	'channel_changed',
	'workflow_changed',
	'assigned',
	'archived',
	'unarchived',
	'trashed',
	'restored',
	'field_changed',
] as const

export type TypeEvenement = (typeof TYPES_EVENEMENT)[number]

/**
 * Les cinq familles de filtres du §5.11 — et pas dix.
 *
 * Huit bascules pour un fil de vingt-sept lignes seraient un contrôle plus gros que son objet. Les
 * six types du cycle de vie partagent une même question : « qu'est devenue cette affaire ? »
 */
export const FAMILLES = ['discussion', 'etapes', 'champs', 'organisation', 'cycle'] as const
export type Famille = (typeof FAMILLES)[number]

const FAMILLE_PAR_TYPE: Readonly<Record<TypeEvenement, Famille>> = {
	moved: 'etapes',
	field_changed: 'champs',
	created: 'cycle',
	channel_changed: 'organisation',
	workflow_changed: 'organisation',
	assigned: 'cycle',
	archived: 'cycle',
	unarchived: 'cycle',
	trashed: 'cycle',
	restored: 'cycle',
}

/**
 * Famille d'un type, avec un repli **documenté** vers `cycle`.
 *
 * La valeur vient du backend, et un type ne garantit jamais une valeur (`docs/SPEC-types.md`) : le
 * jour où `CRM-054` ajoutera `mail_received`, l'écran le rangera dans le cycle de vie plutôt que de
 * le faire disparaître du fil. Un événement inconnu doit rester **visible** — c'est une mémoire.
 */
export function familleDe(type: string): Famille {
	return FAMILLE_PAR_TYPE[type as TypeEvenement] ?? 'cycle'
}

/** Une ligne du fil unifié : une parole, ou un fait. */
export type LigneFil =
	| { readonly genre: 'commentaire'; readonly cle: string; readonly date: string; readonly commentaire: CommentaireAffiche }
	| {
			readonly genre: 'evenement'
			readonly cle: string
			readonly date: string
			readonly type: string
			readonly famille: Famille
			readonly payload: Record<string, unknown>
			readonly acteur: ProfilAffiche | null
	  }

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** Projette les événements lus, sans les trier : la fusion s'en charge. */
export function projeterEvenements(lignes: readonly EvenementLu[]): readonly LigneFil[] {
	return lignes.map((ligne) => ({
		genre: 'evenement' as const,
		cle: `e:${ligne.id}`,
		date: ligne.created_at,
		type: ligne.type,
		famille: familleDe(ligne.type),
		acteur: ligne.acteur ?? null,
		payload:
			ligne.payload !== null && typeof ligne.payload === 'object' && !Array.isArray(ligne.payload)
				? (ligne.payload as Record<string, unknown>)
				: {},
	}))
}

/**
 * Fusionne les deux sources dans l'ordre où l'histoire s'est écrite — **du plus ancien au plus
 * récent** (docs/DESIGN_SYSTEM.md §5.11).
 *
 * L'ordre est **TOTAL**, terminé par la clé, et il le doit deux fois plutôt qu'une : les deux
 * sources ont des identifiants indépendants, et un commentaire publié dans la même milliseconde
 * qu'un déplacement changerait de place d'un rechargement à l'autre. Le préfixe `c:` / `e:` rend
 * l'ordre déterministe **entre** les sources, ce que deux `uuid` ne feraient pas.
 *
 * L'ordre croissant est celui du §5.10, reconduit sans exception : un fil d'activité se lit
 * habituellement du plus récent au plus ancien, mais celui-ci contient une conversation.
 */
export function fusionnerFil(
	commentaires: readonly CommentaireAffiche[],
	evenements: readonly LigneFil[],
): readonly LigneFil[] {
	const lignes: LigneFil[] = [
		...commentaires.map((commentaire) => ({
			genre: 'commentaire' as const,
			cle: `c:${commentaire.id}`,
			date: commentaire.creeLe,
			commentaire,
		})),
		...evenements,
	]
	return lignes.sort((a, b) => (a.date === b.date ? compare(a.cle, b.cle) : compare(a.date, b.date)))
}

/** Famille d'une ligne, quelle que soit sa nature. */
export const familleDeLigne = (ligne: LigneFil): Famille =>
	ligne.genre === 'commentaire' ? 'discussion' : ligne.famille

/**
 * Compte les lignes par famille.
 *
 * IL COMPTE LA SOURCE, PAS LE FILTRE (docs/DESIGN_SYSTEM.md §5.11). Un compte qui suivrait le
 * filtre vaudrait toujours zéro sur une famille éteinte, et ne dirait plus rien.
 */
export function compterParFamille(lignes: readonly LigneFil[]): Readonly<Record<Famille, number>> {
	const comptes: Record<Famille, number> = {
		discussion: 0,
		etapes: 0,
		champs: 0,
		organisation: 0,
		cycle: 0,
	}
	for (const ligne of lignes) comptes[familleDeLigne(ligne)] += 1
	return comptes
}

/** Les libellés que le fil résout à la lecture, jamais lus dans un `payload` (§14.6). */
export type LibellesFil = {
	readonly etapes: ReadonlyMap<string, string>
	readonly champs: ReadonlyMap<string, string>
}

export type ComptesFamille = Readonly<Record<Famille, number>>
export type FamillesActives = ReadonlySet<Famille>
export type LigneEvenement = Extract<LigneFil, { genre: 'evenement' }>

/** Applique les filtres. **Une vue, jamais une requête** — rien n'est rechargé (§14.10). */
export function filtrer(
	lignes: readonly LigneFil[],
	actives: ReadonlySet<Famille>,
): readonly LigneFil[] {
	return lignes.filter((ligne) => actives.has(familleDeLigne(ligne)))
}

/**
 * Ce qu'une ligne d'événement affiche, une fois ses libellés résolus.
 *
 * `detail` est **absent** lorsque la résolution échoue, et ce n'est pas un oubli : le §5.11 exige
 * qu'un libellé non résolu ne devienne pas une phrase tronquée. L'écran montre alors le libellé
 * générique du type, sans détail, et **aucune phrase n'est construite par concaténation**.
 */
export type DetailEvenement = { readonly detail: string | null }

/**
 * Résout le détail d'un événement à partir des libellés **déjà chargés par la fiche**.
 *
 * Les libellés ne sont jamais lus dans le `payload` (§14.6) : une trace qui les recopierait dirait
 * demain ce qui était vrai hier. Ils sont résolus ici, à la lecture, et l'échec est un cas traité.
 */
export function resoudreDetail(ligne: LigneEvenement, libelles: LibellesFil): DetailEvenement {
	if (ligne.type === 'moved') {
		const depart = texte(ligne.payload['from_step_id'])
		const arrivee = texte(ligne.payload['to_step_id'])
		const de = depart === null ? undefined : libelles.etapes.get(depart)
		const vers = arrivee === null ? undefined : libelles.etapes.get(arrivee)
		// LES DEUX, OU AUCUN. Une flèche dont un seul côté porte un nom est une phrase tronquée.
		if (de === undefined || vers === undefined) return { detail: null }
		return { detail: `${de} → ${vers}` }
	}
	if (ligne.type === 'field_changed') {
		const champ = texte(ligne.payload['field_id'])
		const nom = champ === null ? undefined : libelles.champs.get(champ)
		return { detail: nom ?? null }
	}
	return { detail: null }
}

const texte = (valeur: unknown): string | null => (typeof valeur === 'string' ? valeur : null)

/** Lit les événements d'une card. */
export async function lireEvenements(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<readonly LigneFil[]>> {
	try {
		const reponse = await client
			.from('card_events')
			.select(COLONNES_EVENEMENT)
			.eq('card_id', idCard)
			.order('created_at')
			.order('id')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		return pret(projeterEvenements(reponse.data))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les étapes d'un workflow, pour résoudre les libellés de `moved`.
 *
 * UNE REQUÊTE DE PLUS, ET ELLE EST ASSUMÉE. La route de détail ne charge que l'étape **courante**
 * (`docs/SPEC-form-composer.md`) : sans cette lecture, un déplacement n'afficherait jamais son
 * détail, et le §5.11 du design system se replierait systématiquement sur le libellé générique —
 * ce qui est le cas prévu pour un échec, non un état normal. Les libellés ne sont jamais lus dans
 * le `payload` (§14.6) : une trace qui les recopierait dirait demain ce qui était vrai hier.
 *
 * L'échec de cette lecture n'est pas une erreur du fil : il rend une table vide, et chaque `moved`
 * se replie alors sur son libellé générique. Le fil reste lisible.
 */
export async function lireEtapesWorkflow(
	client: ClientCrm,
	idWorkflow: string,
): Promise<ReadonlyMap<string, string>> {
	try {
		// Le libellé d'une étape est celui de son NŒUD, jamais une colonne de `workflow_steps` —
		// le même chemin que `lireEtape` de `webapp/src/lib/formulaire.ts`, et pour la même raison.
		// `label_override` n'est pas lue : aucune unité n'en fait usage, et la lire ici inventerait
		// une règle de priorité que personne n'a écrite.
		const reponse = await client
			.from('workflow_steps')
			.select('id, workflow_nodes_catalog(label)')
			.eq('workflow_id', idWorkflow)
		if (reponse.error !== null) return new Map()
		const libelles = new Map<string, string>()
		for (const etape of reponse.data) {
			const noeud = etape.workflow_nodes_catalog
			if (noeud !== null) libelles.set(etape.id, noeud.label)
		}
		return libelles
	} catch {
		return new Map()
	}
}
