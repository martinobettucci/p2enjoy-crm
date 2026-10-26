// @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : la lecture du manuel dans le bucket `manual`
// @spec docs/SPEC-manual.md §13.3 (des blocs, jamais du HTML), §14 (lu avec la session, par le stockage), §15 (le format
//       construit) ; docs/DAT.md §3.7 quater, §12 bis (un code français n'en traduit pas le contrat anglais) ;
//       docs/JOURNAL.md décisions 750 et 751
//
// Le manuel n'est lisible qu'avec une session : le client de la coquille porte le jeton, et le stockage n'a de politique
// que pour `authenticated` (docs/SPEC-manual.md §14.1). Ce module lit, il ne décide rien : un refus, une absence et une
// panne sont rendus tels que le transport les observe.

import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/** Le bucket du manuel — un contrat, en anglais (docs/DAT.md §12 bis). */
export const BUCKET_MANUEL = 'manual'

// ------------------------------------------------------------------------------------------------
// Le contrat du manuel construit (docs/SPEC-manual.md §15). Ses clés sont celles du fichier, en anglais.
// ------------------------------------------------------------------------------------------------

export type CibleDeLien = { readonly chapter: string; readonly anchor?: string }

export type EnLigne =
	| { readonly type: 'text'; readonly text: string }
	| { readonly type: 'code'; readonly text: string }
	| { readonly type: 'break' }
	| { readonly type: 'strong' | 'emphasis' | 'deleted'; readonly content: readonly EnLigne[] }
	| { readonly type: 'link'; readonly content: readonly EnLigne[]; readonly target: CibleDeLien }
	| { readonly type: 'link'; readonly content: readonly EnLigne[]; readonly href: string; readonly external: true }

export type Bloc =
	| { readonly type: 'heading'; readonly level: number; readonly anchor: string | null; readonly content: readonly EnLigne[] }
	| { readonly type: 'paragraph'; readonly content: readonly EnLigne[] }
	| { readonly type: 'list'; readonly ordered: boolean; readonly start: number | null; readonly items: readonly (readonly Bloc[])[] }
	| { readonly type: 'note'; readonly blocks: readonly Bloc[] }
	| {
			readonly type: 'table'
			readonly align: readonly ('left' | 'center' | 'right' | null)[]
			readonly header: readonly (readonly EnLigne[])[]
			readonly rows: readonly (readonly (readonly EnLigne[])[])[]
	  }
	| { readonly type: 'codeblock'; readonly text: string }
	| { readonly type: 'rule' }
	| {
			readonly type: 'image'
			readonly src: string
			readonly alt: string
			readonly width: number | null
			readonly height: number | null
	  }

export type SectionDuSommaire = { readonly anchor: string; readonly title: string }
export type ChapitreDuSommaire = { readonly slug: string; readonly title: string; readonly sections: readonly SectionDuSommaire[] }
export type Sommaire = { readonly introduction: readonly Bloc[]; readonly chapters: readonly ChapitreDuSommaire[] }
export type Chapitre = { readonly slug: string; readonly title: string; readonly blocks: readonly Bloc[] }

/** La forme d'un identifiant de chapitre ou d'image, vérifiée avant toute requête : aucune traversée de chemin. */
const IDENTIFIANT = /^[a-z0-9-]+$/
const IMAGE = /^[a-z0-9-]+\/[a-z0-9-]+\.jpg$/

/** Le statut HTTP d'une erreur du stockage, s'il en porte un : le seul critère fiable (async.ts). */
function statutDe(erreur: unknown): number | undefined {
	const brut = (erreur as { status?: unknown; statusCode?: unknown } | null) ?? null
	const statut = Number(brut?.status ?? brut?.statusCode)
	return Number.isFinite(statut) && statut > 0 ? statut : undefined
}

/**
 * Le stockage rend `400` ou `404` pour un objet que la politique ne laisse pas voir comme pour un objet absent : les
 * deux sont « introuvable », jamais une panne — et ne pas les distinguer ne divulgue rien.
 */
const estIntrouvable = (statut: number | undefined) => statut === 400 || statut === 404

async function lireJson(client: ClientCrm, chemin: string): Promise<EtatAsync<unknown | null>> {
	try {
		const { data, error } = await client.storage.from(BUCKET_MANUEL).download(chemin)
		if (error !== null) {
			const statut = statutDe(error)
			if (estIntrouvable(statut)) return pret(null)
			return enErreur(classerErreur(statut, error.message))
		}
		return pret(JSON.parse(await data.text()) as unknown)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Le sommaire du manuel. Absent, c'est une erreur : un manuel publié a toujours un sommaire (§13.4). */
export async function lireSommaire(client: ClientCrm): Promise<EtatAsync<Sommaire>> {
	const etat = await lireJson(client, 'contents.json')
	if (etat.statut !== 'pret') return etat
	if (etat.donnees === null) return enErreur({ nature: 'unknown', detail: 'manuel non publié : contents.json absent' })
	return pret(etat.donnees as Sommaire)
}

/** Un chapitre, ou `null` s'il est introuvable — identifiant hors de forme compris, sans requête. */
export async function lireChapitre(client: ClientCrm, slug: string): Promise<EtatAsync<Chapitre | null>> {
	if (!IDENTIFIANT.test(slug)) return pret(null)
	const etat = await lireJson(client, `chapters/${slug}.json`)
	if (etat.statut !== 'pret') return etat
	return pret(etat.donnees === null ? null : (etat.donnees as Chapitre))
}

/** Une image du manuel, en `Blob` : un `<img src>` ne porterait pas la session (§14.2). `null` si indisponible. */
export async function lireImage(client: ClientCrm, src: string): Promise<Blob | null> {
	if (!IMAGE.test(src)) return null
	try {
		const { data, error } = await client.storage.from(BUCKET_MANUEL).download(`images/${src}`)
		return error === null ? data : null
	} catch {
		return null
	}
}
