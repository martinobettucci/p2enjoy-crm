// @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
//       TRANCHE 4, SOUS-TRANCHE 4c : L'ÉCRAN
// @spec docs/SPEC-modeles-emails.md §13.4 (où l'écran vit), §13.5 (la liste), §13.5 bis
//       (l'embarquement ambigu, mesuré), §13.6 (la fiche et ses paliers), §13.7 (le dictionnaire
//       fermé des refus de l'écran des séquences), §13.8 (l'armement depuis l'affaire et son
//       dictionnaire), §13.9 (la confirmation de suppression d'un modèle, révisée)
// @spec docs/SPEC-modeles-emails.md §11.5 (ce que la base refuse), §11.8 (contrat d'API des deux
//       tables), §12.11 (contrat d'API de l'armement), §13.3 (la RPC de réordonnancement),
//       §13.10 (son contrat d'API)
// @spec docs/DESIGN_SYSTEM.md §5.41 (l'écran des séquences), §5.42 (le bloc d'armement)
// @spec docs/SPEC-permissions-rls.md §7 (le refus est ZÉRO LIGNE, jamais une erreur)
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE ET N'AJOUTE AUCUNE RÈGLE. Il lit et écrit `mail_sequences` et
// `mail_sequence_steps` sous la RLS de la migration `0059`, lit `mail_templates` sous celle de la
// `0055`, appelle `public.reordonner_paliers_sequence` (`0062`), et
// `public.armer_sequence_relance` / `public.interrompre_sequence_relance` (`0060`).
//
// IL NE REND JAMAIS LE MESSAGE DU SERVEUR (§13.7). Un refus est CLASSÉ en une issue d'un
// dictionnaire fermé, sur des identifiants STABLES — les noms de contrainte, versionnés par la
// migration `0059` —, jamais sur de la prose. C'est la discipline de `modeles-emails.ts` et de
// `mail-identites.ts`, reprise sans changement.
//
// LE ZÉRO-LIGNE EST UNE ISSUE À PART ENTIÈRE, ET C'EST LA PLUS IMPORTANTE DE TOUTES. La lectrice
// qui écrit reçoit `200` et `[]` sur un `PATCH`, `204` sur un `DELETE` qui n'efface rien, et `0`
// de la RPC de réordonnancement — MESURÉ dans les trois cas. Aucun de ces trois-là n'est un
// succès, et les confondre annoncerait une écriture qui n'a pas eu lieu.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// Ce que l'écran des séquences lit — §13.5, §13.5 bis
// ---------------------------------------------------------------------------------------------

/** Une séquence telle que la liste et la fiche ont besoin de la connaître — §13.5. */
export type SequenceRelance = {
	readonly id: string
	readonly workspace_id: string
	readonly name: string
	/** Le nombre de paliers, rendu par le comptage EMBARQUÉ du §13.5 bis. */
	readonly paliers: number
}

/**
 * Composition de la lecture des séquences.
 *
 * LA RELATION EST NOMMÉE, ET UNE MESURE L'IMPOSE (§13.5 bis). `mail_sequence_steps` porte DEUX
 * clés étrangères vers `mail_sequences` — la simple et la composite du §11.5 point n —, et
 * PostgREST refuse alors d'embarquer : `300` / `PGRST201`. La clé nommée est la SIMPLE, celle que
 * le produit exprime ; la composite est un garde-fou, et la nommer ici ferait croire qu'elle est
 * consultable.
 *
 * `created_by` en est ABSENTE : la colonne est une trace, jamais un droit (§11.3), aucune politique
 * ne la lit, et l'écran ne la montre pas. `created_at` et `updated_at` aussi : la liste du §5.41 ne
 * porte aucune date.
 *
 * LA COMPOSITION EST UN GABARIT `as const` : `supabase-js` type la réponse à partir du LITTÉRAL
 * passé à `select`, et une concaténation élargirait le type à `string`.
 */
export const COLONNES_SEQUENCE =
	'id, workspace_id, name, mail_sequence_steps!mail_sequence_steps_sequence_id_fkey(count)' as const

/** Forme brute que PostgREST rend pour un comptage embarqué : un tableau d'un objet. */
type LigneSequence = {
	readonly id: string
	readonly workspace_id: string
	readonly name: string
	readonly mail_sequence_steps: readonly { readonly count: number }[] | null
}

/**
 * Le nombre de paliers, extrait de la forme que PostgREST rend.
 *
 * ELLE EST ÉCRITE À PART ET EXPORTÉE parce qu'elle est la seule chose de cette lecture qui puisse
 * SILENCIEUSEMENT devenir fausse : un cache de schéma périmé rend l'embarquement absent, et
 * `[0].count` sur `undefined` ferait planter l'écran (`docs/SPEC-types.md`). Zéro est le repli
 * juste — une séquence dont on ne sait pas compter les paliers n'en a aucun de PROUVÉ —, et il est
 * indiscernable d'une cadence réellement vide, ce qui est acceptable : les deux se soldent par le
 * même refus `sequence_empty` à l'armement.
 */
export function compterPaliers(embarque: readonly { readonly count: number }[] | null): number {
	return embarque?.[0]?.count ?? 0
}

/**
 * Les séquences visibles par l'appelant, triées par nom.
 *
 * LE TRI SUIT LA TÊTE DE LIGNE (§13.5) : le nom est la clé,
 * `mail_sequences_workspace_name_key` le rendant unique par workspace sur sa forme normalisée.
 *
 * La RLS de `0059` fait tout le tri des droits : tout membre du workspace LIT, y compris la
 * lectrice (§11.7). Un appelant anonyme reçoit `200` et zéro ligne — un filtrage, jamais une
 * erreur (§11.8 ligne 1).
 */
export async function lireSequences(
	client: ClientCrm,
): Promise<EtatAsync<readonly SequenceRelance[]>> {
	try {
		const reponse = await client.from('mail_sequences').select(COLONNES_SEQUENCE).order('name')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LigneSequence[]
		return pret(
			lignes.map((ligne) => ({
				id: ligne.id,
				workspace_id: ligne.workspace_id,
				name: ligne.name,
				paliers: compterPaliers(ligne.mail_sequence_steps),
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Un palier tel que la fiche a besoin de le connaître — §13.6. */
export type PalierSequence = {
	readonly id: string
	readonly position: number
	readonly delai_jours: number
	readonly template_id: string
	/** Le nom du modèle, ou `null` si l'embarquement ne l'a pas rendu. */
	readonly modele: string | null
}

/**
 * Composition de la lecture des paliers.
 *
 * MÊME DÉSAMBIGUÏSATION QU'AU-DESSUS, et pour la même mesure (§13.5 bis) : `template_id` porte deux
 * clés étrangères vers `mail_templates`, et l'embarquement anonyme rend `300`.
 */
export const COLONNES_PALIER =
	'id, position, delai_jours, template_id, mail_templates!mail_sequence_steps_template_id_fkey(name)' as const

type LignePalier = {
	readonly id: string
	readonly position: number
	readonly delai_jours: number
	readonly template_id: string
	readonly mail_templates: { readonly name: string } | null
}

/**
 * Les paliers d'une séquence, TRIÉS PAR POSITION.
 *
 * LE TRI N'EST PAS UN CONFORT : la position EST l'ordre (§13.6), et une liste rendue dans l'ordre
 * d'insertion ferait afficher une cadence fausse. C'est aussi ce tri qui produit le tableau envoyé
 * à la RPC de réordonnancement, laquelle exige l'ensemble EXACT des paliers (§13.3 refus c).
 */
export async function lirePaliers(
	client: ClientCrm,
	idSequence: string,
): Promise<EtatAsync<readonly PalierSequence[]>> {
	try {
		const reponse = await client
			.from('mail_sequence_steps')
			.select(COLONNES_PALIER)
			.eq('sequence_id', idSequence)
			.order('position')
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LignePalier[]
		return pret(
			lignes.map((ligne) => ({
				id: ligne.id,
				position: ligne.position,
				delai_jours: ligne.delai_jours,
				template_id: ligne.template_id,
				modele: ligne.mail_templates?.name ?? null,
			})),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// Le dictionnaire fermé des refus de l'écran des séquences — §13.7
// ---------------------------------------------------------------------------------------------

export type IssueEcritureSequence =
	/** `201` sur une création, `200` sur une modification : la ligne est rendue. */
	| 'enregistre'
	/** `403`, `42501` : la lectrice n'insère pas (§11.8 ligne 7). */
	| 'refus'
	/**
	 * `200` et `[]` sur un `PATCH`, `204` sans ligne sur un `DELETE`, ou `0` rendu par la RPC. La
	 * politique ne consent pas, et la base ne lève AUCUNE erreur (§11.8 lignes 8 et 9). L'écran le
	 * dit en toutes lettres plutôt que d'annoncer un succès qui n'a pas eu lieu.
	 */
	| 'zero-ligne'
	/** `400`, `23514`, `mail_sequences_name_borne` (§11.5 a, b). */
	| 'nom-borne'
	/** `409`, `23505`, `mail_sequences_workspace_name_key` (§11.5 c). */
	| 'nom-pris'
	/** `400`, `23514`, `mail_sequence_steps_delai_borne` (§11.5 i). */
	| 'delai-borne'
	/** `400`, `23514`, `mail_sequence_steps_position_borne` (§11.5 e). */
	| 'position-borne'
	/** `409`, `23505`, `mail_sequence_steps_sequence_position_key` (§11.5 f). */
	| 'position-prise'
	/** `400`, `23514`, l'un des trois refus de la RPC du §13.3. */
	| 'ordre-invalide'
	/** `409`, `23503`, `card_sequence_enrollments_sequence_fk` — une séquence ARMÉE (§12.11 ligne 16). */
	| 'sequence-armee'
	/** `409`, `23503`, `mail_sequence_steps_template_id_fkey` — le modèle a disparu (§11.5 j). */
	| 'modele-introuvable'
	/** `401` : la session n'existe plus. */
	| 'session-expiree'
	/** Aucune réponse : la requête n'a jamais abouti. */
	| 'reseau'
	/** Tout le reste. L'interface ne prétend pas savoir, et ne recopie pas le serveur. */
	| 'inconnu'

/**
 * Classe une réponse d'écriture en une issue du dictionnaire fermé — §13.7.
 *
 * ON CLASSE SUR DES IDENTIFIANTS STABLES, JAMAIS SUR DE LA PROSE : les noms de contrainte sont des
 * identifiants du schéma, versionnés par la migration `0059`, et `e2e/api/sequences-relance.spec.ts`
 * comme `e2e/api/reordonnancement-paliers.spec.ts` les mesurent dans le message rendu par
 * PostgREST.
 *
 * L'ORDRE DES TESTS A ÉTÉ VÉRIFIÉ, PAS SUPPOSÉ. `mail_sequences` n'est PAS un préfixe de
 * `mail_sequence_steps` — après `mail_sequence` vient `_` et non `s` —, si bien que les deux
 * familles ne se capturent pas l'une l'autre. Le §9.8 avait payé le piège inverse sur
 * `mail_templates_subject_variables` / `mail_templates_subject_borne`, et le point est écrit pour
 * qu'un lecteur pressé n'ajoute pas la précaution au mauvais endroit.
 *
 * LES TROIS REFUS DE LA RPC SONT FONDUS EN UNE SEULE ISSUE, et c'est délibéré : `paliers_requis`,
 * `paliers_dupliques` et `paliers_incomplets` décrivent tous les trois un ordre que l'écran a
 * composé lui-même, donc un état d'écran devenu faux. Le geste que l'utilisateur doit poser est le
 * même dans les trois cas — recharger —, et les distinguer lui offrirait un choix qu'il n'a pas.
 */
export function classerEcritureSequence(
	statutHttp: number | undefined,
	message: string | null,
): IssueEcritureSequence {
	if (statutHttp === undefined || statutHttp === 0) return 'reseau'
	if (message === null) {
		return statutHttp >= 200 && statutHttp < 300 ? 'enregistre' : 'inconnu'
	}
	if (message.includes('mail_sequences_name_borne')) return 'nom-borne'
	if (message.includes('mail_sequences_workspace_name_key')) return 'nom-pris'
	if (message.includes('mail_sequence_steps_delai_borne')) return 'delai-borne'
	if (message.includes('mail_sequence_steps_position_borne')) return 'position-borne'
	if (message.includes('mail_sequence_steps_sequence_position_key')) return 'position-prise'
	if (message.includes('mail_sequence_steps_template_id_fkey')) return 'modele-introuvable'
	if (message.includes('card_sequence_enrollments_sequence_fk')) return 'sequence-armee'
	if (
		message.includes('paliers_requis') ||
		message.includes('paliers_dupliques') ||
		message.includes('paliers_incomplets')
	) {
		return 'ordre-invalide'
	}
	if (statutHttp === 401) return 'session-expiree'
	if (statutHttp === 403) return 'refus'
	return 'inconnu'
}

// ---------------------------------------------------------------------------------------------
// Ce que l'écran des séquences écrit — §13.6
// ---------------------------------------------------------------------------------------------

/**
 * La saisie de la fiche d'une séquence.
 *
 * `idSequence` vaut `null` pour une création. Le nom part **tel quel** vers la base, sans `trim` ni
 * garde : `app.btrim_blancs` est appliqué par la contrainte (§11.3), et normaliser ici doublerait
 * une règle de la base — ce que le §5.3 ter interdit.
 */
export type SaisieSequence = {
	readonly idWorkspace: string
	readonly idSequence: string | null
	readonly nom: string
}

export type ResultatEcritureSequence =
	| { readonly issue: 'enregistre'; readonly sequence: { readonly id: string; readonly name: string } }
	| { readonly issue: Exclude<IssueEcritureSequence, 'enregistre'> }

/**
 * Le corps envoyé à la base — `workspace_id` seulement à la création.
 *
 * Le renvoyer sur un `PATCH` proposerait de déplacer une séquence d'un workspace à l'autre, geste
 * qu'aucune spécification ne prend et que la clause `with check` refuserait par zéro ligne — un
 * refus qui se lirait comme un défaut. C'est la règle de `corpsEcritureModele`, reprise.
 */
export function corpsEcritureSequence(saisie: SaisieSequence): Record<string, string> {
	const corps: Record<string, string> = { name: saisie.nom }
	if (saisie.idSequence === null) corps['workspace_id'] = saisie.idWorkspace
	return corps
}

/**
 * Écrit une séquence — création ou modification, selon que `idSequence` est nul.
 *
 * LA LIGNE ÉCRITE EST RELUE PAR `select()` : c'est le seul moyen de distinguer un `PATCH` consenti
 * d'un `PATCH` que la politique a laissé passer sans rien écrire. Sans `select()`, PostgREST rend
 * `204` dans les deux cas.
 */
export async function enregistrerSequence(
	client: ClientCrm,
	saisie: SaisieSequence,
): Promise<ResultatEcritureSequence> {
	try {
		const corps = corpsEcritureSequence(saisie)
		const reponse =
			saisie.idSequence === null
				? await client.from('mail_sequences').insert(corps as never).select('id, name')
				: await client
						.from('mail_sequences')
						.update(corps as never)
						.eq('id', saisie.idSequence)
						.select('id, name')
		const issue = classerEcritureSequence(
			reponse.status,
			reponse.error === null ? null : reponse.error.message,
		)
		if (issue !== 'enregistre') return { issue }
		const premiere = (reponse.data ?? [])[0]
		if (premiere === undefined) return { issue: 'zero-ligne' }
		return { issue: 'enregistre', sequence: premiere }
	} catch (cause) {
		void cause
		return { issue: 'reseau' }
	}
}

/** Les issues d'une suppression — §13.6, et le `sequence-armee` que le §12.11 ligne 16 a mesuré. */
export type IssueSuppressionSequence =
	| 'supprime'
	| 'zero-ligne'
	| 'sequence-armee'
	| 'refus'
	| 'session-expiree'
	| 'reseau'
	| 'inconnu'

/**
 * Supprime une séquence — §13.6.
 *
 * `select()` EST INDISPENSABLE ICI, et pour la raison mesurée au §11.8 ligne 9 : la lectrice qui
 * confirme reçoit `204` et **la ligne est toujours là**. Sans relecture des lignes supprimées,
 * l'écran annoncerait une suppression que la base a refusée en silence.
 */
export async function supprimerSequence(
	client: ClientCrm,
	idSequence: string,
): Promise<IssueSuppressionSequence> {
	try {
		const reponse = await client.from('mail_sequences').delete().eq('id', idSequence).select('id')
		if (reponse.error !== null) {
			const issue = classerEcritureSequence(reponse.status, reponse.error.message)
			if (
				issue === 'sequence-armee' ||
				issue === 'refus' ||
				issue === 'session-expiree' ||
				issue === 'reseau'
			) {
				return issue
			}
			return 'inconnu'
		}
		return (reponse.data ?? []).length === 0 ? 'zero-ligne' : 'supprime'
	} catch (cause) {
		void cause
		return 'reseau'
	}
}

/** La saisie d'un palier — le modèle et le délai ; la position n'est jamais saisie (§13.6). */
export type SaisiePalier = {
	readonly idWorkspace: string
	readonly idSequence: string
	readonly idModele: string
	/** Tel que le champ le porte : une CHAÎNE, convertie ici et jamais dans le composant. */
	readonly delai: string
}

/**
 * Le rang du palier ajouté — `max(position) + 1`, calculé depuis la donnée DÉJÀ LUE.
 *
 * AUCUNE REQUÊTE DE PLUS (§13.6) : la fiche a déjà la liste des paliers sous les yeux. Sur une
 * liste vide, le rang est `1` — la borne basse de `mail_sequence_steps_position_borne`.
 *
 * DEUX ONGLETS OUVERTS PEUVENT PROPOSER LE MÊME RANG, et ce n'est pas masqué : la base refuse alors
 * en `23505`, refus classé `position-prise` et traduit. C'est le comportement voulu — deviner un
 * rang libre en relisant ne supprimerait pas la course, il la déplacerait.
 */
export function rangSuivant(paliers: readonly { readonly position: number }[]): number {
	return paliers.reduce((maximum, palier) => Math.max(maximum, palier.position), 0) + 1
}

/**
 * Le corps d'un palier ajouté.
 *
 * `delai_jours` EST CONVERTI ICI, ET UNE VALEUR NON NUMÉRIQUE PART EN `NaN` PLUTÔT QUE D'ÊTRE
 * CORRIGÉE : le champ est un `input[type=number]`, dont la valeur vide rend la chaîne vide. La
 * garde vit dans la base — `mail_sequence_steps_delai_borne` —, et poser ici un repli à `1` ferait
 * enregistrer un délai que personne n'a saisi (§5.3 ter, `CLAUDE.md` §18).
 */
export function corpsEcriturePalier(
	saisie: SaisiePalier,
	position: number,
): Record<string, string | number> {
	return {
		workspace_id: saisie.idWorkspace,
		sequence_id: saisie.idSequence,
		position,
		delai_jours: Number(saisie.delai),
		template_id: saisie.idModele,
	}
}

/** Ajoute un palier à une séquence — §13.6. */
export async function ajouterPalier(
	client: ClientCrm,
	saisie: SaisiePalier,
	position: number,
): Promise<IssueEcritureSequence> {
	try {
		const reponse = await client
			.from('mail_sequence_steps')
			.insert(corpsEcriturePalier(saisie, position) as never)
			.select('id')
		const issue = classerEcritureSequence(
			reponse.status,
			reponse.error === null ? null : reponse.error.message,
		)
		if (issue !== 'enregistre') return issue
		return (reponse.data ?? []).length === 0 ? 'zero-ligne' : 'enregistre'
	} catch (cause) {
		void cause
		return 'reseau'
	}
}

/**
 * Retire un palier — §13.6, sans confirmation et le motif y est écrit.
 *
 * MÊME RELECTURE QUE POUR LA SÉQUENCE : `204` ne dit pas qu'une ligne est partie.
 */
export async function retirerPalier(
	client: ClientCrm,
	idPalier: string,
): Promise<IssueEcritureSequence> {
	try {
		const reponse = await client.from('mail_sequence_steps').delete().eq('id', idPalier).select('id')
		if (reponse.error !== null) {
			return classerEcritureSequence(reponse.status, reponse.error.message)
		}
		return (reponse.data ?? []).length === 0 ? 'zero-ligne' : 'enregistre'
	} catch (cause) {
		void cause
		return 'reseau'
	}
}

// ---------------------------------------------------------------------------------------------
// Le réordonnancement — §13.2, §13.3
// ---------------------------------------------------------------------------------------------

/**
 * L'ordre obtenu en déplaçant un palier d'un cran, dans un sens ou dans l'autre.
 *
 * ELLE REND UN ORDRE COMPLET, ET C'EST CE QUE LA RPC ATTEND (§13.2) : le tableau doit être
 * EXACTEMENT l'ensemble des paliers de la séquence, faute de quoi elle refuse en
 * `paliers_incomplets`. Une fonction qui rendrait « les deux qui bougent » obligerait l'appelant à
 * recomposer le reste, et c'est là qu'un palier se perdrait.
 *
 * UN DÉPLACEMENT HORS BORNES REND L'ORDRE INCHANGÉ, jamais une exception : le premier palier ne
 * monte pas, le dernier ne descend pas, et les commandes correspondantes sont MONTÉES ET
 * DÉSACTIVÉES par l'écran (§5.41). Ce repli est la seconde garde — l'écran peut être contourné, la
 * base ne doit pas recevoir un ordre absurde.
 */
export function ordreApresDeplacement(
	paliers: readonly { readonly id: string }[],
	idPalier: string,
	sens: 'monter' | 'descendre',
): readonly string[] {
	const ordre = paliers.map((palier) => palier.id)
	const depart = ordre.indexOf(idPalier)
	if (depart === -1) return ordre
	const arrivee = sens === 'monter' ? depart - 1 : depart + 1
	if (arrivee < 0 || arrivee >= ordre.length) return ordre
	const permute = [...ordre]
	const porte = permute[depart]
	const remplace = permute[arrivee]
	if (porte === undefined || remplace === undefined) return ordre
	permute[depart] = remplace
	permute[arrivee] = porte
	return permute
}

/** Ce que le réordonnancement rend — §13.3. */
export type IssueReordonnancement = 'reordonne' | Exclude<IssueEcritureSequence, 'enregistre'>

/**
 * Repose l'ordre des paliers d'une séquence — §13.3.
 *
 * `0` N'EST PAS UN SUCCÈS, et c'est la seule chose que cette fonction ajoute au classement : la RPC
 * rend `200` et `0` lorsque la politique ne consent pas (MESURÉ sur la lectrice, §13.10 ligne 4).
 * Un `200` lu comme un succès annoncerait un réordonnancement qui n'a pas eu lieu.
 */
export async function reordonnerPaliers(
	client: ClientCrm,
	idSequence: string,
	ordre: readonly string[],
): Promise<IssueReordonnancement> {
	try {
		const reponse = await client.rpc('reordonner_paliers_sequence', {
			p_sequence_id: idSequence,
			p_paliers: ordre as string[],
		})
		if (reponse.error !== null) {
			const issue = classerEcritureSequence(reponse.status, reponse.error.message)
			return issue === 'enregistre' ? 'inconnu' : issue
		}
		return (reponse.data ?? 0) === 0 ? 'zero-ligne' : 'reordonne'
	} catch (cause) {
		void cause
		return 'reseau'
	}
}

// ---------------------------------------------------------------------------------------------
// L'armement depuis l'affaire — §13.8
// ---------------------------------------------------------------------------------------------

/** L'inscription active d'une affaire, telle que le bloc a besoin de la connaître — §13.8. */
export type InscriptionSequence = {
	readonly id: string
	readonly sequence: string | null
	readonly identite: string | null
	readonly adresse: string | null
	readonly armed_at: string
	readonly last_position: number | null
	readonly last_sent_at: string | null
}

/**
 * Composition de la lecture d'une inscription.
 *
 * LES DEUX EMBARQUEMENTS SONT NON AMBIGUS, contrairement à ceux du §13.5 bis : `sequence_id` et
 * `identity_id` ne portent chacun qu'UNE clé étrangère (§12.3). MESURÉ le 2026-08-26 — la lecture
 * rend `200` et la ligne complète, sans qu'aucune relation n'ait à être nommée.
 */
export const COLONNES_INSCRIPTION =
	'id, armed_at, last_position, last_sent_at, mail_sequences(name), mail_outbound_identities(label, from_address)' as const

type LigneInscription = {
	readonly id: string
	readonly armed_at: string
	readonly last_position: number | null
	readonly last_sent_at: string | null
	readonly mail_sequences: { readonly name: string } | null
	readonly mail_outbound_identities: {
		readonly label: string
		readonly from_address: string
	} | null
}

/**
 * L'inscription ACTIVE d'une affaire, ou `null` s'il n'y en a aucune — §13.8.
 *
 * LES INSCRIPTIONS FERMÉES SONT ÉCARTÉES PAR LE FILTRE, ET NON PAR L'ÉCRAN : une inscription est
 * une TRACE (§12.10), la table en porte autant que l'affaire a connu de cadences, et l'index unique
 * PARTIEL du §12.3 garantit qu'il y en a au plus UNE active. `maybeSingle` serait donc juste ;
 * `limit(1)` est retenu parce qu'il rend `[]` plutôt qu'une erreur si l'invariant venait à tomber —
 * l'écran montrerait alors le geste plutôt qu'un écran cassé.
 */
export async function lireInscriptionActive(
	client: ClientCrm,
	idCard: string,
): Promise<EtatAsync<InscriptionSequence | null>> {
	try {
		const reponse = await client
			.from('card_sequence_enrollments')
			.select(COLONNES_INSCRIPTION)
			.eq('card_id', idCard)
			.eq('status', 'active')
			.limit(1)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly LigneInscription[]
		const premiere = lignes[0]
		if (premiere === undefined) return pret(null)
		return pret({
			id: premiere.id,
			sequence: premiere.mail_sequences?.name ?? null,
			identite: premiere.mail_outbound_identities?.label ?? null,
			adresse: premiere.mail_outbound_identities?.from_address ?? null,
			armed_at: premiere.armed_at,
			last_position: premiere.last_position,
			last_sent_at: premiere.last_sent_at,
		})
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Le dictionnaire fermé des refus de l'armement — §13.8, chaque ligne mesurée le 2026-08-26. */
export type IssueArmement =
	| 'arme'
	/** `409`, `23505`, `enrollment_exists` — refus (h) du §12.4. */
	| 'deja-armee'
	/** `400`, `23514`, `card_not_stalled` — refus (f). */
	| 'non-figee'
	/** `400`, `23514`, `sequence_empty` — refus (d). */
	| 'sequence-vide'
	/** `400`, `23514`, `sequence_not_available` — refus (c). */
	| 'sequence-indisponible'
	/** `400`, `23514`, `card_not_available` — refus (g). */
	| 'adresse-absente'
	/** `403`, `42501`, `identity_not_available` — refus (e). */
	| 'identite-refusee'
	/** `403`, `42501`, `forbidden` — refus (b). */
	| 'refus'
	| 'session-expiree'
	| 'reseau'
	| 'inconnu'

/**
 * Classe un refus d'armement — §13.8.
 *
 * `identity_not_available` EST DISTINGUÉ DE `forbidden`, ET CE N'EST PAS UN RAFFINEMENT. Les deux
 * rendent `403` / `42501`, mais ils demandent deux gestes différents — choisir une autre adresse,
 * ou demander un droit. Les confondre sous « une erreur est survenue » serait la valeur par défaut
 * trompeuse que `CLAUDE.md` §18 proscrit ; c'est exactement la distinction que `classerRefusEnvoi`
 * fait déjà pour le quota (`CRM-058`).
 *
 * LES MESSAGES SONT ICI DES IDENTIFIANTS, PAS DE LA PROSE : `armer_sequence_relance` lève ses huit
 * refus avec un `message` qui est un nom — `card_not_stalled`, `sequence_empty` —, versionné par la
 * migration `0060` et mesuré par `e2e/api/armement-sequences.spec.ts`.
 */
export function classerArmement(
	statutHttp: number | undefined,
	message: string | null,
): IssueArmement {
	if (statutHttp === undefined || statutHttp === 0) return 'reseau'
	if (message === null) {
		return statutHttp >= 200 && statutHttp < 300 ? 'arme' : 'inconnu'
	}
	if (message.includes('enrollment_exists')) return 'deja-armee'
	if (message.includes('card_not_stalled')) return 'non-figee'
	if (message.includes('sequence_empty')) return 'sequence-vide'
	if (message.includes('sequence_not_available')) return 'sequence-indisponible'
	if (message.includes('card_not_available')) return 'adresse-absente'
	if (message.includes('identity_not_available')) return 'identite-refusee'
	if (message.includes('forbidden')) return 'refus'
	if (statutHttp === 401) return 'session-expiree'
	if (statutHttp === 403) return 'refus'
	return 'inconnu'
}

/**
 * Arme une séquence sur une affaire — §13.8.
 *
 * L'ÉCRAN NE VÉRIFIE PAS QUE L'AFFAIRE EST FIGÉE, et c'est la décision du §13.8 :
 * `public.cards_figees()` porte cette définition, une seule fois, et la recopier ici en créerait une
 * seconde. Le rédacteur arme, la base refuse en `card_not_stalled`, et le refus est traduit.
 */
export async function armerSequence(
	client: ClientCrm,
	idCard: string,
	idSequence: string,
	idIdentite: string,
): Promise<IssueArmement> {
	try {
		const reponse = await client.rpc('armer_sequence_relance', {
			p_card_id: idCard,
			p_sequence_id: idSequence,
			p_identity_id: idIdentite,
		})
		return classerArmement(
			reponse.status,
			reponse.error === null ? null : reponse.error.message,
		)
	} catch (cause) {
		void cause
		return 'reseau'
	}
}

/** Ce que l'interruption rend — `interrompue` n'est conclu qu'APRÈS relecture (§13.8). */
export type IssueInterruption = 'interrompue' | 'sans-effet' | 'refus' | 'session-expiree' | 'reseau' | 'inconnu'

/**
 * Interrompt une inscription — §13.8.
 *
 * `204` NE DIT PAS QU'UNE LIGNE A ÉTÉ FERMÉE. `interrompre_sequence_relance` est IDEMPOTENTE
 * (§12.4) : fermer une inscription déjà fermée ne lève rien et n'écrit rien, et le même `204`
 * couvre les deux cas. C'est pourquoi cette fonction ne conclut PAS au succès et laisse l'appelant
 * RELIRE — la règle du §9.7, appliquée à une RPC plutôt qu'à un `DELETE`.
 *
 * Elle rend donc `interrompue` au sens de « l'appel n'a rien levé », et l'écran ne l'annonce
 * qu'après avoir constaté que l'inscription active a disparu.
 */
export async function interrompreSequence(
	client: ClientCrm,
	idInscription: string,
): Promise<IssueInterruption> {
	try {
		const reponse = await client.rpc('interrompre_sequence_relance', {
			p_enrollment_id: idInscription,
		})
		if (reponse.error === null) return 'interrompue'
		const message = reponse.error.message
		if (message.includes('forbidden')) return 'refus'
		if (reponse.status === 401) return 'session-expiree'
		if (reponse.status === 403) return 'refus'
		return 'inconnu'
	} catch (cause) {
		void cause
		return 'reseau'
	}
}

/**
 * Le texte d'un palier dans la liste de la fiche — « J+3 · Relance sans réponse ».
 *
 * LE DÉLAI EST RELATIF, ET LE `J+` LE DIT SANS MENTIR : il se compte depuis le palier PRÉCÉDENT, et
 * le premier depuis l'armement (§11.4). Un décalage absolu — « J+10 » pour le second palier —
 * serait dérivable, mais il ferait lire une date que la cadence ne garantit pas : elle GLISSE sur
 * l'envoi réel (§12.5).
 *
 * UN MODÈLE DONT LE NOM MANQUE NE REND NI TIRET NI « non renseigné » — règle de la cellule vide du
 * §5.9. Le cas ne se produit que si l'embarquement n'a rien rendu, la clé étrangère étant `not
 * null`.
 */
export function libellePalier(palier: PalierSequence): string {
	return palier.modele === null
		? `J+${palier.delai_jours}`
		: `J+${palier.delai_jours} · ${palier.modele}`
}
