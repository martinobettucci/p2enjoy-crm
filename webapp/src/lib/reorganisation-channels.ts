// @spec CRM-154 (docs/BACKLOG.md) — tranche T3 : réorganiser les channels d'un track par `public.reorder_channels`
// @spec docs/SPEC-administration-arborescence.md §15.2 (un ordre, pas des positions ; les refus), §15.3 (l'arborescence
//       l'emploie ; l'adresse `?track=`), §15.4 (la barre d'onglets, tranche T4) ; docs/JOURNAL.md décisions 935 et 938
//
// Module pur, hors l'appel : il calcule des ORDRES (des listes d'identifiants), jamais des positions — la base les
// transcrit (§15.2). Il ne décide aucun droit : la politique `channels_maj_admin` tient la règle (`CLAUDE.md` §10).

import {
	classerRefusEcriture,
	type Deplacement,
	type Ordonnable,
	type RefusEcriture,
	type ResultatEcriture,
	type Sens,
} from './administration-arborescence'
import type { ClientCrm } from './supabase'

// ---------------------------------------------------------------------------------------------
// L'adresse `?track=` de l'arborescence — §15.3
// ---------------------------------------------------------------------------------------------

/** Le paramètre qui ouvre l'arborescence sur un track. */
export const PARAM_TRACK = 'track'

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** L'identifiant du track demandé, s'il a la forme d'un `uuid` ; `null` sinon — rien d'autre n'est cru. */
export function lireTrackDemande(parametres: URLSearchParams): string | null {
	const valeur = parametres.get(PARAM_TRACK)
	return valeur !== null && FORME_UUID.test(valeur) ? valeur.toLowerCase() : null
}

/** Les paramètres sans `track` : il quitte l'adresse une fois appliqué, ou s'il ne désigne rien (§15.3). */
export function sansTrackDemande(parametres: URLSearchParams): URLSearchParams {
	const copie = new URLSearchParams(parametres)
	copie.delete(PARAM_TRACK)
	return copie
}

/** Le lien « Réorganiser » de la barre d'onglets (§15.4) : l'arborescence, ouverte sur ce track. */
export function cheminReorganiser(idTrack: string): string {
	return `/reglages/arborescence?${new URLSearchParams({ [PARAM_TRACK]: idTrack }).toString()}`
}

// ---------------------------------------------------------------------------------------------
// L'ordre après un déplacement — §15.3, §15.4
// ---------------------------------------------------------------------------------------------

/**
 * L'ordre après avoir déplacé `id` de `rang` à `cible` (rangs comptés depuis 0), ou `null` si rien ne change : `id`
 * absent, ou posé à sa place. La cible hors bornes est ramenée aux extrémités.
 */
export function ordreApresPose(ids: readonly string[], id: string, cible: number): readonly string[] | null {
	const rang = ids.indexOf(id)
	if (rang === -1) return null
	const borne = Math.max(0, Math.min(ids.length - 1, cible))
	if (borne === rang) return null
	const sans = ids.filter((candidat) => candidat !== id)
	return [...sans.slice(0, borne), id, ...sans.slice(borne)]
}

/** L'ordre après « Monter » ou « Descendre » d'un cran, ou `null` à l'extrémité visée. */
export function ordreApresDeplacement(ids: readonly string[], id: string, sens: Sens): readonly string[] | null {
	const rang = ids.indexOf(id)
	if (rang === -1) return null
	return ordreApresPose(ids, id, sens === 'monter' ? rang - 1 : rang + 1)
}

/**
 * La disponibilité de « Monter » et « Descendre » sur un CHANNEL, dans la forme de `calculerDeplacement` : seule
 * l'extrémité l'éteint. Les positions égales ou nulles ne bloquent plus — la fonction renumérote de 1 à n (§15.3, la
 * limite 2 du §11 levée pour les channels). `position` porte le rang visé, que l'écran n'écrit pas.
 */
export function deplacementParOrdre(liste: readonly Ordonnable[], id: string, sens: Sens): Deplacement {
	const ids = liste.map((element) => element.id)
	const ordre = ordreApresDeplacement(ids, id, sens)
	if (ordre === null) return { statut: 'impossible', cause: 'extremite' }
	return { statut: 'calcule', position: ordre.indexOf(id) + 1 }
}

// ---------------------------------------------------------------------------------------------
// L'appel et ses refus — §15.2
// ---------------------------------------------------------------------------------------------

/** Le nom du refus (c) : la liste n'est plus celle des channels actifs du track — l'écran relit. */
export const REFUS_ORDRE_PERIME = 'channel_order_incomplete'

/**
 * Classe un refus de `reorder_channels`. `channel_order_incomplete` est reconnu À SON NOM, comme `workflow_hors_track`
 * l'est déjà (un nom écrit dans la migration et vérifié par pgTAP, jamais une phrase) ; le reste suit
 * `classerRefusEcriture` : `42501` par la route est un `403`, donc `forbidden`.
 */
export function classerRefusReorganisation(
	statutHttp: number | undefined,
	code: string | undefined,
	detail: string,
): RefusEcriture {
	if (code === '23514' && detail.includes(REFUS_ORDRE_PERIME)) return { nature: 'ordre-perime', detail }
	return classerRefusEcriture(statutHttp, code, detail)
}

/** Pose l'ordre des channels actifs d'un track. Ne lève jamais : rend un résultat classé. */
export async function reorganiserChannels(
	client: ClientCrm,
	idTrack: string,
	ordre: readonly string[],
): Promise<ResultatEcriture> {
	try {
		const reponse = await client.rpc('reorder_channels', { p_track_id: idTrack, p_channel_ids: [...ordre] })
		if (reponse.error !== null) {
			return {
				statut: 'refus',
				refus: classerRefusReorganisation(reponse.status, reponse.error.code, reponse.error.message),
			}
		}
		return { statut: 'applique' }
	} catch (cause) {
		return {
			statut: 'refus',
			refus: classerRefusReorganisation(undefined, undefined, cause instanceof Error ? cause.message : String(cause)),
		}
	}
}

// ---------------------------------------------------------------------------------------------
// La barre d'onglets — tranche T4, §15.4
// ---------------------------------------------------------------------------------------------
// @spec CRM-154 (docs/BACKLOG.md) tranche T4 — le mode déplacement au clavier et le rang de pose d'un glisser
//       (docs/SPEC-administration-arborescence.md §15.4 ; docs/DESIGN_SYSTEM.md §5.106 ; décision 938)

/** Un onglet saisi au clavier : l'ordre de départ, à rétablir sur « annuler », et l'ordre courant, à l'écran seulement. */
export type Saisie = {
	readonly id: string
	readonly depart: readonly string[]
	readonly ordre: readonly string[]
}

/** `Espace` ou `Entrée` sur la poignée : l'onglet est saisi, rien n'a encore bougé. */
export function saisir(ordre: readonly string[], id: string): Saisie {
	return { id, depart: ordre, ordre }
}

/** Un pas : `←` (-1), `→` (+1), `Début`, `Fin`. Aux bornes, l'ordre ne change pas. */
export function deplacerSaisie(saisie: Saisie, pas: -1 | 1 | 'debut' | 'fin'): Saisie {
	const rang = saisie.ordre.indexOf(saisie.id)
	const cible = pas === 'debut' ? 0 : pas === 'fin' ? saisie.ordre.length - 1 : rang + pas
	const ordre = ordreApresPose(saisie.ordre, saisie.id, cible)
	return ordre === null ? saisie : { ...saisie, ordre }
}

/** Le rang de l'onglet saisi, compté depuis 1 — ce que l'annonce dit. */
export function rangSaisi(saisie: Saisie): number {
	return saisie.ordre.indexOf(saisie.id) + 1
}

/** `Entrée` ou `Espace` : l'ordre à envoyer, ou `null` si l'onglet est revenu à sa place — rien n'est envoyé. */
export function ordreAPoser(saisie: Saisie): readonly string[] | null {
	const identique =
		saisie.ordre.length === saisie.depart.length && saisie.ordre.every((id, rang) => id === saisie.depart[rang])
	return identique ? null : saisie.ordre
}

/**
 * Le rang où poser `id` quand le repère d'insertion est AVANT l'onglet de rang `insertion` (0 à n, n étant « après le
 * dernier ») : un repère placé après la position d'origine compte l'onglet tiré, qui quitte sa place.
 */
export function rangDePose(ids: readonly string[], id: string, insertion: number): number {
	const rang = ids.indexOf(id)
	return rang !== -1 && insertion > rang ? insertion - 1 : insertion
}

/** Le repère d'insertion d'un survol : avant l'onglet survolé, ou après lui si le pointeur en passe le milieu. */
export function insertionAuSurvol(rangSurvole: number, xPointeur: number, gauche: number, largeur: number): number {
	return xPointeur > gauche + largeur / 2 ? rangSurvole + 1 : rangSurvole
}
