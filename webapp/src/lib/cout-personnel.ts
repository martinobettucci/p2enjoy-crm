// @spec CRM-098 (docs/BACKLOG.md) — tranche T3 : le coût du personnel, versionné par date d'effet
// @spec docs/SPEC-temps.md §3.1 (une version ne se modifie pas ; pas de date passée sauf pour la première ; seule une
//       version programmée se retire ; la personne est membre de l'espace ou y a du temps saisi), §5.2 (administrateurs
//       seuls), §7.4 (Réglages ▸ « Coût du personnel ») ; docs/SCHEMA.md §9 quater « Migration `0087` »
//
// Les règles sont en base ; ce module lit, écrit et traduit les refus en mots que l'écran sait dire.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

export type VersionCout = {
	readonly id: string
	readonly profile_id: string
	readonly date_effet: string
	readonly cout_quart: number
	readonly devise: string
}

export type Personne = { readonly id: string; readonly nom: string }

export const COLONNES_VERSION = 'id, profile_id, date_effet, cout_quart, devise'

/** La version en vigueur un jour donné : la plus récente dont l'effet ne dépasse pas ce jour (§4). */
export function versionEnVigueur(versions: readonly VersionCout[], jour: string): VersionCout | null {
	return (
		versions
			.filter((v) => v.date_effet <= jour)
			.sort((a, b) => b.date_effet.localeCompare(a.date_effet))[0] ?? null
	)
}

/** La prochaine version programmée : la plus proche dont l'effet est postérieur au jour. */
export function prochaineVersion(versions: readonly VersionCout[], jour: string): VersionCout | null {
	return versions.filter((v) => v.date_effet > jour).sort((a, b) => a.date_effet.localeCompare(b.date_effet))[0] ?? null
}

/** Une version se retire tant qu'elle n'est pas en vigueur (§3.1) — l'écran le reflète, la base le tient. */
export const estProgrammee = (version: VersionCout, jour: string) => version.date_effet > jour

/**
 * Les personnes à qui un coût peut être donné : les membres de l'espace, et celles qui y ont déjà saisi du temps sans
 * ligne d'appartenance — un administrateur du domaine (`docs/SPEC-temps.md` §3.1). Rangées par nom.
 */
export async function lirePersonnes(client: ClientCrm, idWorkspace: string): Promise<EtatAsync<readonly Personne[]>> {
	try {
		const [membres, auteurs] = await Promise.all([
			client.from('workspace_members').select('user_id, profiles(id, full_name)').eq('workspace_id', idWorkspace),
			client.from('saisies_temps').select('profile_id, profiles!saisies_temps_profile_id_fkey(id, full_name)').eq('workspace_id', idWorkspace),
		])
		if (membres.error !== null) return enErreur(classerErreur(membres.status, membres.error.message))
		if (auteurs.error !== null) return enErreur(classerErreur(auteurs.status, auteurs.error.message))
		const parId = new Map<string, string>()
		for (const ligne of [...membres.data, ...auteurs.data]) {
			const profil = ligne.profiles
			if (profil !== null) parId.set(profil.id, profil.full_name)
		}
		return pret([...parId.entries()].map(([id, nom]) => ({ id, nom })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

export async function lireVersions(client: ClientCrm, idWorkspace: string): Promise<EtatAsync<readonly VersionCout[]>> {
	try {
		const reponse = await client
			.from('couts_personnel')
			.select(COLONNES_VERSION)
			.eq('workspace_id', idWorkspace)
			.order('date_effet', { ascending: false })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(reponse.data)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

export type MotifRefusVersion = 'retroactive' | 'en-vigueur' | 'doublon' | 'hors-espace' | 'forme' | 'droit' | 'reseau' | 'inconnu'

export type IssueVersion = { readonly ok: true } | { readonly ok: false; readonly motif: MotifRefusVersion }

/** Le refus, d'après ce que la base a dit : les messages des déclencheurs de `0087` sont le contrat. */
export function classerRefusVersion(statut: number | undefined, code: string | undefined, texte: string): MotifRefusVersion {
	if (texte.includes('version retroactive')) return 'retroactive'
	if (texte.includes('version en vigueur')) return 'en-vigueur'
	if (texte.includes('personne hors de l')) return 'hors-espace'
	if (code === '23505') return 'doublon'
	if (code === '23514' || code === '22P02' || code === '22003') return 'forme'
	if (code === '42501' || statut === 401 || statut === 403) return 'droit'
	if (statut === undefined || statut === 0) return 'reseau'
	return 'inconnu'
}

export type NouvelleVersion = {
	readonly idWorkspace: string
	readonly idPersonne: string
	readonly dateEffet: string
	readonly coutQuart: number
	readonly devise: string
}

export async function creerVersion(client: ClientCrm, version: NouvelleVersion): Promise<IssueVersion> {
	try {
		const reponse = await client
			.from('couts_personnel')
			.insert({
				workspace_id: version.idWorkspace,
				profile_id: version.idPersonne,
				date_effet: version.dateEffet,
				cout_quart: version.coutQuart,
				devise: version.devise,
			})
			.select('id')
		if (reponse.error !== null) {
			return { ok: false, motif: classerRefusVersion(reponse.status, reponse.error.code, reponse.error.message) }
		}
		return reponse.data.length === 1 ? { ok: true } : { ok: false, motif: 'droit' }
	} catch (cause) {
		return { ok: false, motif: classerRefusVersion(undefined, undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}

/** Retire une version programmée. Zéro ligne touchée est un refus (la RLS ne lève rien), jamais un succès. */
export async function supprimerVersion(client: ClientCrm, id: string): Promise<IssueVersion> {
	try {
		const reponse = await client.from('couts_personnel').delete().eq('id', id).select('id')
		if (reponse.error !== null) {
			return { ok: false, motif: classerRefusVersion(reponse.status, reponse.error.code, reponse.error.message) }
		}
		return reponse.data.length === 1 ? { ok: true } : { ok: false, motif: 'droit' }
	} catch (cause) {
		return { ok: false, motif: classerRefusVersion(undefined, undefined, cause instanceof Error ? cause.message : String(cause)) }
	}
}

// ---------------------------------------------------------------------------------------------
// @spec CRM-107 (docs/BACKLOG.md) — tranche T2 : le calcul du coût par quart depuis le coût mensuel
// @spec docs/SPEC-temps.md §7.4 bis (1 : les champs, vide vaut zéro sauf le salaire requis et les jours à 218 ;
//       2 : la formule et l'arrondi au centime ; 5 : les bornes, la virgule décimale) ; décision 631
// ---------------------------------------------------------------------------------------------

/** Les jours travaillés par an par défaut : le forfait jours des cadres (décision 631, arbitrage 1). */
export const JOURS_TRAVAILLES_PAR_AN = 218
const QUARTS_PAR_JOUR = 4
const MOIS_PAR_AN = 12

export type ChampCalcul = 'brut' | 'charges' | 'frais' | 'avantages' | 'jours'
export type EntreesCalcul = Readonly<Record<ChampCalcul, string>>
/** `format` : pas un nombre ; `borne` : hors de ses bornes ; `entier` : des jours non entiers. */
export type MotifCalcul = 'format' | 'borne' | 'entier'

export type ResultatCalcul =
	| { readonly statut: 'calcule'; readonly mensuel: number; readonly quart: number; readonly jours: number }
	/** Le salaire brut manque : rien à calculer, et rien de faux à dire. */
	| { readonly statut: 'incomplet' }
	| { readonly statut: 'invalide'; readonly erreurs: Readonly<Partial<Record<ChampCalcul, MotifCalcul>>> }

export const ENTREES_VIDES: EntreesCalcul = { brut: '', charges: '', frais: '', avantages: '', jours: String(JOURS_TRAVAILLES_PAR_AN) }

/** Au centime le plus proche ; `EPSILON` évite que 1,005 ne s'arrondisse à 1,00 par la représentation binaire. */
export const auCentime = (valeur: number) => Math.round((valeur + Number.EPSILON) * 100) / 100

/** Un nombre tapé à la française ou non : « 3 000,50 », « 3000.5 ». Vide rend `null`. */
function lireNombre(texte: string): number | null | 'format' {
	const brut = texte.replace(/[\s  ]/g, '').replace(',', '.')
	if (brut === '') return null
	if (!/^\d+(\.\d+)?$/.test(brut)) return 'format'
	return Number(brut)
}

/**
 * `coût mensuel complet = brut × (1 + charges ÷ 100) + frais + avantages` ;
 * `coût par quart = coût mensuel complet × 12 ÷ (jours × 4)`, arrondi au centime (§7.4 bis, point 2).
 */
export function calculerCoutQuart(entrees: EntreesCalcul): ResultatCalcul {
	const erreurs: Partial<Record<ChampCalcul, MotifCalcul>> = {}
	const lire = (champ: ChampCalcul, max?: number): number | null => {
		const valeur = lireNombre(entrees[champ])
		if (valeur === 'format') {
			erreurs[champ] = 'format'
			return null
		}
		if (valeur !== null && max !== undefined && valeur > max) erreurs[champ] = 'borne'
		return valeur
	}
	const brut = lire('brut')
	const charges = lire('charges', 100) ?? 0
	const frais = lire('frais') ?? 0
	const avantages = lire('avantages') ?? 0
	const jours = lire('jours', 366) ?? JOURS_TRAVAILLES_PAR_AN
	if (erreurs.jours === undefined && !Number.isInteger(jours)) erreurs.jours = 'entier'
	else if (erreurs.jours === undefined && jours < 1) erreurs.jours = 'borne'
	if (Object.keys(erreurs).length > 0) return { statut: 'invalide', erreurs }
	if (brut === null) return { statut: 'incomplet' }
	const mensuel = brut * (1 + charges / 100) + frais + avantages
	return {
		statut: 'calcule',
		mensuel: auCentime(mensuel),
		quart: auCentime((mensuel * MOIS_PAR_AN) / (jours * QUARTS_PAR_JOUR)),
		jours,
	}
}
