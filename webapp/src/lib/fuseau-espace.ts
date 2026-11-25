// @spec INC-216 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-216 ») — tranche T2.a : la couche de l'écran du fuseau de
//       l'espace — lire `workspaces.timezone`, le régler par `workspace_set_timezone`, classer les refus, grouper les fuseaux
//       du navigateur par région, dire l'heure qu'il est dans un fuseau
// @spec docs/SPEC-modeles-emails.md §8.6 bis (la règle et qui règle), §8.6 ter (l'écran : ce qu'il lit, écrit et refuse) ;
//       docs/DESIGN_SYSTEM.md §5.117 ; docs/SCHEMA.md `workspaces.timezone` ; docs/JOURNAL.md décisions 992, 996 et 1000
// @spec CLAUDE.md §10 — ce module ne décide AUCUN droit : il écrit par la fonction, et la base tranche ; son refus est traduit
//
// Ce module ne rend rien : il lit, écrit, classe les refus et calcule.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Colonnes réellement demandées. Exportées pour que les tests éprouvent la requête émise. */
export const COLONNES_FUSEAU = 'id, timezone'

/** Le fuseau que la base donne à un espace neuf (docs/SPEC-modeles-emails.md §8.6 bis). */
export const FUSEAU_PAR_DEFAUT = 'Europe/Paris'

/** L'espace de travail et son fuseau, tels que la requête les rend. */
type LigneFuseau = { readonly id: string; readonly timezone: string }

/** Le fuseau de l'espace : une requête, sous la RLS. Un espace que la RLS masque se lit comme une erreur, jamais comme un fuseau deviné. */
export async function lireFuseauEspace(client: ClientCrm, idWorkspace: string): Promise<EtatAsync<string>> {
	try {
		const reponse = await client.from('workspaces').select(COLONNES_FUSEAU).eq('id', idWorkspace)
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const [ligne] = (reponse.data ?? []) as readonly LigneFuseau[]
		if (ligne === undefined) return enErreur(classerErreur(404, 'espace introuvable ou illisible'))
		return pret(ligne.timezone)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

// ---------------------------------------------------------------------------------------------
// L'écriture, et ses refus — dictionnaire fermé
// ---------------------------------------------------------------------------------------------

export type NatureRefusFuseau =
	/** `42501`, `401`, `403` : seul l'administrateur de l'espace règle le fuseau (un espace étranger rend le même refus). */
	| 'forbidden'
	/** `22023` : la base ne connaît pas ce nom de fuseau (`invalid_timezone`). */
	| 'fuseau-inconnu'
	| 'network'
	| 'unknown'

export function classerRefusFuseau(statutHttp: number | undefined, code: string | undefined): NatureRefusFuseau {
	if (code === '42501' || statutHttp === 401 || statutHttp === 403) return 'forbidden'
	if (code === '22023') return 'fuseau-inconnu'
	if (statutHttp === undefined || statutHttp === 0) return 'network'
	return 'unknown'
}

export type IssueFuseau = { readonly statut: 'applique' } | { readonly statut: 'refus'; readonly nature: NatureRefusFuseau }

/** Règle le fuseau par `workspace_set_timezone`, jamais par un `update` direct : la règle est celle de la fonction. */
export async function reglerFuseauEspace(client: ClientCrm, idWorkspace: string, fuseau: string): Promise<IssueFuseau> {
	try {
		const reponse = await client.rpc('workspace_set_timezone', { p_workspace_id: idWorkspace, p_timezone: fuseau })
		if (reponse.error !== null) return { statut: 'refus', nature: classerRefusFuseau(reponse.status, reponse.error.code) }
		return { statut: 'applique' }
	} catch {
		return { statut: 'refus', nature: 'network' }
	}
}

// ---------------------------------------------------------------------------------------------
// Les fuseaux que le navigateur connaît, groupés par région
// ---------------------------------------------------------------------------------------------

/** Les régions de la base IANA, dans l'ordre où l'écran les range (docs/SPEC-modeles-emails.md §8.6 ter). */
export const REGIONS_FUSEAU = [
	'Africa',
	'America',
	'Antarctica',
	'Arctic',
	'Asia',
	'Atlantic',
	'Australia',
	'Europe',
	'Indian',
	'Pacific',
] as const

export type RegionFuseau = (typeof REGIONS_FUSEAU)[number]

export type GroupeFuseaux = {
	/** La région IANA, ou `null` pour le groupe de ce qui n'en a pas (« UTC »). */
	readonly region: RegionFuseau | null
	readonly fuseaux: readonly string[]
}

const compare = (a: string, b: string): number => a.localeCompare(b, 'en', { sensitivity: 'base' })

/**
 * Les noms IANA que le navigateur sait formater. Rien n'est recopié dans l'écran : la liste vient de la plateforme, et la base reste
 * juge d'un nom qu'elle ne connaîtrait pas (`invalid_timezone`). **La liste ne porte que les noms CANONIQUES** : `America/Toronto`, jamais l'alias `America/Montreal` que la base accepte et que le seed donne à « Studio Lumen » (mesuré le 2026-11-25). Un navigateur sans `Intl.supportedValuesOf` rend une liste vide :
 * l'écran garde alors le seul fuseau courant, il n'invente pas de liste.
 */
export function fuseauxDuNavigateur(): readonly string[] {
	const intl = Intl as unknown as { supportedValuesOf?: (cle: string) => string[] }
	try {
		return intl.supportedValuesOf?.('timeZone') ?? []
	} catch {
		return []
	}
}

/**
 * Groupe les noms par région et les range. **Le fuseau courant est toujours présent**, même absent de la liste : sans son option, le
 * champ afficherait un autre fuseau comme s'il avait été choisi — la « valeur par défaut trompeuse » de `CLAUDE.md` §18. `UTC` est
 * ajouté, hors de tout groupe, parce que les listes du navigateur ne le portent pas toujours. Une région inconnue de la liste fermée
 * tombe dans le groupe sans région : rien n'est perdu.
 */
export function grouperFuseaux(noms: readonly string[], courant: string): readonly GroupeFuseaux[] {
	const tous = new Set<string>([...noms, 'UTC', courant])
	const parRegion = new Map<RegionFuseau, string[]>()
	const sansRegion: string[] = []
	for (const nom of tous) {
		const tete = nom.split('/')[0] as string
		const region = (REGIONS_FUSEAU as readonly string[]).includes(tete) && nom.includes('/') ? (tete as RegionFuseau) : null
		if (region === null) sansRegion.push(nom)
		else parRegion.set(region, [...(parRegion.get(region) ?? []), nom])
	}
	const groupes: GroupeFuseaux[] = REGIONS_FUSEAU.filter((r) => parRegion.has(r)).map((region) => ({
		region,
		fuseaux: (parRegion.get(region) ?? []).sort(compare),
	}))
	if (sansRegion.length > 0) groupes.push({ region: null, fuseaux: sansRegion.sort(compare) })
	return groupes
}

// ---------------------------------------------------------------------------------------------
// L'heure dans un fuseau
// ---------------------------------------------------------------------------------------------

/** Les composantes de l'instant dans un fuseau, ou `null` si le navigateur ne sait pas formater ce nom. */
function composantes(instant: Date, fuseau: string): Record<string, number> | null {
	try {
		const parties = new Intl.DateTimeFormat('en-GB', {
			timeZone: fuseau,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
		}).formatToParts(instant)
		const valeurs: Record<string, number> = {}
		for (const partie of parties) if (partie.type !== 'literal') valeurs[partie.type] = Number(partie.value)
		return valeurs
	} catch {
		return null
	}
}

/** `HH:MM` à l'instant donné dans le fuseau, ou `null` : une heure inventée serait pire que pas d'heure. */
export function heureDansFuseau(instant: Date, fuseau: string): string | null {
	const c = composantes(instant, fuseau)
	if (c === null || c.hour === undefined || c.minute === undefined) return null
	return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`
}

/** Le décalage à l'UTC du fuseau, en minutes, à cet instant (heure d'été comprise) ; `null` si le nom est illisible. */
export function decalageDuFuseau(instant: Date, fuseau: string): number | null {
	const c = composantes(instant, fuseau)
	if (c === null) return null
	const { year, month, day, hour, minute, second } = c
	if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined || second === undefined) return null
	const commeUtc = Date.UTC(year, month - 1, day, hour, minute, second)
	return Math.round((commeUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000)
}

/**
 * L'écart, en minutes, entre le fuseau et le navigateur de la personne : positif quand le fuseau est en avance. `null` si le nom est
 * illisible. C'est ce que l'écran dit sous le champ pour que le réglage se vérifie d'un regard.
 */
export function ecartAvecNavigateur(instant: Date, fuseau: string): number | null {
	const decalage = decalageDuFuseau(instant, fuseau)
	if (decalage === null) return null
	return decalage - -instant.getTimezoneOffset()
}
