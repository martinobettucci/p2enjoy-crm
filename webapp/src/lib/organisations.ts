// @spec CRM-114 (docs/BACKLOG.md) — tranche T2 : lister, créer et modifier les organisations de l'espace
// @spec docs/SPEC-organisations.md §2 (ce qui est livré), §3 (droits de la base, refus traduits par un dictionnaire
//       fermé) ; docs/DESIGN_SYSTEM.md §5.64 (le domaine mis en minuscules, un champ facultatif vidé efface la valeur)
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; CLAUDE.md §10 — ce module ne décide aucun droit : il écrit dans
//       `organizations`, et les politiques `organizations_insertion_bizdev_admin` et `organizations_maj_bizdev_admin`
//       décident
//
// Ce module ne rend rien : il lit, écrit et traduit. La normalisation de la saisie et le classement des refus y sont
// vérifiables sans navigateur.

import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

// @spec CRM-152 (docs/BACKLOG.md) — tranche T2 : la liste lue en base, page par page (`organization_list`), et les tracks de
//       chaque organisation (`organization_tracks`) ; les filtres et le tri lus et écrits dans l'adresse, le défaut jamais
//       écrit, une valeur inconnue repliée sur le défaut (docs/SPEC-organisations.md §8.1 à §8.3 ; décisions 931 et 936)

/** Un track d'une organisation, par ses contacts (docs/SPEC-organisations.md §8.1), dans l'ordre de la barre latérale. */
export type TrackDOrganisation = {
	readonly id: string
	readonly name: string
	readonly slug: string
	readonly color: string
	readonly icon: string
}

/** Une ligne de l'onglet « Organisations » : la fiche résumée, le nombre de contacts lus, les recettes et les tracks. */
export type OrganisationListee = {
	readonly id: string
	readonly name: string
	readonly domain: string | null
	readonly website: string | null
	readonly contacts: number
	readonly aRecettes: boolean
	readonly tracks: readonly TrackDOrganisation[]
}

export type FiltreRecettes = 'toutes' | 'avec' | 'sans'
export type TriOrganisations = 'nom' | 'contacts'
export type SensTriOrganisations = 'asc' | 'desc'

/** Ce que l'adresse de l'onglet porte (§8.3). La page chargée n'y vit pas. */
export type ParametresOrganisations = {
	readonly recherche: string
	readonly tracks: readonly string[]
	readonly recettes: FiltreRecettes
	readonly tri: TriOrganisations
	readonly sens: SensTriOrganisations
}

export const PARAMETRES_ORGANISATIONS_PAR_DEFAUT: ParametresOrganisations = {
	recherche: '',
	tracks: [],
	recettes: 'toutes',
	tri: 'nom',
	sens: 'asc',
}

/** Cinquante organisations, puis cinquante de plus à chaque « Afficher plus » (décision 936). */
export const TAILLE_PAGE_ORGANISATIONS = 50

/** Les clés de l'adresse — `/contacts/organisations?q=…&tracks=…&recettes=avec&tri=contacts&sens=desc`. */
export const CLES_ADRESSE_ORGANISATIONS = { recherche: 'q', tracks: 'tracks', recettes: 'recettes', tri: 'tri', sens: 'sens' } as const

const FORME_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lit l'adresse ; une valeur inconnue est repliée sur le défaut, un identifiant de track mal formé est ignoré. */
export function lireParametresOrganisations(adresse: URLSearchParams): ParametresOrganisations {
	const recettes = adresse.get(CLES_ADRESSE_ORGANISATIONS.recettes)
	const tri = adresse.get(CLES_ADRESSE_ORGANISATIONS.tri)
	const sens = adresse.get(CLES_ADRESSE_ORGANISATIONS.sens)
	const tracks = (adresse.get(CLES_ADRESSE_ORGANISATIONS.tracks) ?? '')
		.split(',')
		.map((id) => id.trim().toLowerCase())
		.filter((id, rang, tous) => FORME_UUID.test(id) && tous.indexOf(id) === rang)
	return {
		recherche: (adresse.get(CLES_ADRESSE_ORGANISATIONS.recherche) ?? '').trim(),
		tracks,
		recettes: recettes === 'avec' || recettes === 'sans' ? recettes : 'toutes',
		tri: tri === 'contacts' ? 'contacts' : 'nom',
		sens: sens === 'desc' ? 'desc' : 'asc',
	}
}

/**
 * Écrit les paramètres dans l'adresse, en gardant les clés qui ne sont pas les siennes ; LE DÉFAUT N'EST JAMAIS ÉCRIT :
 * l'adresse nue est la liste nue.
 */
export function ecrireParametresOrganisations(
	parametres: ParametresOrganisations,
	base: URLSearchParams = new URLSearchParams(),
): URLSearchParams {
	const adresse = new URLSearchParams(base)
	for (const cle of Object.values(CLES_ADRESSE_ORGANISATIONS)) adresse.delete(cle)
	const recherche = parametres.recherche.trim()
	if (recherche !== '') adresse.set(CLES_ADRESSE_ORGANISATIONS.recherche, recherche)
	if (parametres.tracks.length > 0) adresse.set(CLES_ADRESSE_ORGANISATIONS.tracks, parametres.tracks.join(','))
	if (parametres.recettes !== 'toutes') adresse.set(CLES_ADRESSE_ORGANISATIONS.recettes, parametres.recettes)
	if (parametres.tri !== 'nom') adresse.set(CLES_ADRESSE_ORGANISATIONS.tri, parametres.tri)
	if (parametres.sens !== 'asc') adresse.set(CLES_ADRESSE_ORGANISATIONS.sens, parametres.sens)
	return adresse
}

/** Un filtre est posé : « Effacer les filtres » paraît. Le tri n'est pas un filtre. */
export function filtresOrganisationsPoses(parametres: ParametresOrganisations): boolean {
	return parametres.recherche.trim() !== '' || parametres.tracks.length > 0 || parametres.recettes !== 'toutes'
}

/** Les paramètres sans leurs filtres, le tri gardé. */
export function sansFiltresOrganisations(parametres: ParametresOrganisations): ParametresOrganisations {
	return { ...PARAMETRES_ORGANISATIONS_PAR_DEFAUT, tri: parametres.tri, sens: parametres.sens }
}

const VALEUR_RECETTES: Record<FiltreRecettes, 'all' | 'with' | 'without'> = { toutes: 'all', avec: 'with', sans: 'without' }
const VALEUR_TRI: Record<TriOrganisations, 'name' | 'contacts'> = { nom: 'name', contacts: 'contacts' }

/** Les arguments de `organization_list` (docs/SPEC-organisations.md §8.2). Exportée pour que le test vérifie l'appel. */
export function argumentsListeOrganisations(
	idWorkspace: string,
	parametres: ParametresOrganisations,
	decalage: number,
	limite: number = TAILLE_PAGE_ORGANISATIONS,
) {
	const recherche = parametres.recherche.trim()
	return {
		p_workspace_id: idWorkspace,
		p_search: recherche === '' ? undefined : recherche,
		p_track_ids: parametres.tracks.length === 0 ? undefined : [...parametres.tracks],
		p_revenues: VALEUR_RECETTES[parametres.recettes],
		p_sort: VALEUR_TRI[parametres.tri],
		p_descending: parametres.sens === 'desc',
		p_limit: limite,
		p_offset: decalage,
	}
}

/** Une page de la liste et le total qui répond aux filtres, pour écrire « 50 sur 132 ». */
export type PageOrganisations = { readonly organisations: readonly OrganisationListee[]; readonly total: number }

type LigneListe = {
	readonly id: string
	readonly name: string
	readonly domain: string | null
	readonly website: string | null
	readonly contacts: number
	readonly has_revenues: boolean
	readonly total_count: number
}
type LigneTrack = { readonly organization_id: string; readonly track_id: string } & Omit<TrackDOrganisation, 'id'>

function erreurDeCause<T>(cause: unknown): EtatAsync<T> {
	return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
}

/** Les tracks de chaque organisation donnée, groupés et dans l'ordre que la base rend (celui de la barre latérale). */
async function lireTracksParOrganisation(
	client: ClientCrm,
	ids: readonly string[],
): Promise<EtatAsync<ReadonlyMap<string, readonly TrackDOrganisation[]>>> {
	if (ids.length === 0) return pret(new Map())
	const reponse = await client.rpc('organization_tracks', { p_organization_ids: [...ids] })
	if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
	const groupes = new Map<string, TrackDOrganisation[]>()
	for (const ligne of (reponse.data ?? []) as readonly LigneTrack[]) {
		const groupe = groupes.get(ligne.organization_id) ?? []
		groupe.push({ id: ligne.track_id, name: ligne.name, slug: ligne.slug, color: ligne.color, icon: ligne.icon })
		groupes.set(ligne.organization_id, groupe)
	}
	return pret(groupes)
}

/**
 * Lit une page de la liste, puis les tracks de ses organisations : DEUX APPELS, PAS UN PAR LIGNE. Le total est celui que
 * la base compte au-delà de la page ; une page vide le rend nul.
 */
export async function lirePageOrganisations(
	client: ClientCrm,
	idWorkspace: string,
	parametres: ParametresOrganisations,
	decalage: number,
): Promise<EtatAsync<PageOrganisations>> {
	try {
		const reponse = await client.rpc('organization_list', argumentsListeOrganisations(idWorkspace, parametres, decalage))
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as readonly LigneListe[]
		const tracks = await lireTracksParOrganisation(client, lignes.map((ligne) => ligne.id))
		if (tracks.statut === 'erreur') return enErreur(tracks.erreur)
		if (tracks.statut !== 'pret') return enChargement()
		return pret({
			organisations: lignes.map((ligne) => ({
				id: ligne.id,
				name: ligne.name,
				domain: ligne.domain,
				website: ligne.website,
				contacts: ligne.contacts,
				aRecettes: ligne.has_revenues,
				tracks: tracks.donnees.get(ligne.id) ?? [],
			})),
			total: lignes[0]?.total_count ?? 0,
		})
	} catch (cause) {
		return erreurDeCause(cause)
	}
}

/** Les tracks d'une seule organisation, pour sa fiche (§8.3). */
export async function lireTracksDOrganisation(
	client: ClientCrm,
	idOrganisation: string,
): Promise<EtatAsync<readonly TrackDOrganisation[]>> {
	try {
		const lu = await lireTracksParOrganisation(client, [idOrganisation])
		if (lu.statut !== 'pret') return lu.statut === 'erreur' ? enErreur(lu.erreur) : enChargement()
		return pret(lu.donnees.get(idOrganisation) ?? [])
	} catch (cause) {
		return erreurDeCause(cause)
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
