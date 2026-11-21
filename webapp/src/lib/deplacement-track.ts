// @spec CRM-162 (docs/BACKLOG.md) — tranche T3 : l'adresse d'un track déplacé, résolue par `track_current_address` et
//       réécrite vers l'espace d'arrivée (docs/SPEC-deplacement-track.md §12 ; docs/SPEC-espace-courant.md §8.2)
// @spec CRM-162 (docs/BACKLOG.md) — tranche T2 : ce que l'écran du déplacement d'un track lit et envoie — les tracks d'un
//       espace (`plateforme_tracks`), l'aperçu chiffré (`track_move_preview`), le déplacement confirmé par le nom
//       (`move_track`) et ses refus, classés par un dictionnaire fermé
// @spec docs/SPEC-deplacement-track.md §4, §5, §6, §13 ; docs/DESIGN_SYSTEM.md §5.112 ; CLAUDE.md §10 — ce module ne décide
//       AUCUN droit : il envoie, et la base tranche (super-administrateur seul)
//
// Ce module ne rend rien : il lit, envoie et classe. La forme rendue par la base est lue défensivement — un champ absent
// devient une valeur vide, jamais un `undefined` affiché (docs/SPEC-types.md §4).

import { useEffect, useState } from 'react'
import { classerErreur, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

export type TrackEspace = {
	readonly id: string
	readonly nom: string
	readonly slug: string
	readonly channels: number
	readonly affaires: number
	readonly corbeille: boolean
}

/** Les refus du §4, dans l'ordre où l'écran les liste. Un code inconnu n'est jamais affiché brut. */
export const CODES_REFUS_DEPLACEMENT = [
	'same_workspace',
	'track_trashed',
	'homonym_track',
	'shared_card',
	'non_member',
	'armed_sequence',
	'queued_send',
	'pending_draft',
	'field_type_conflict',
	'daily_cap_exceeded',
] as const
export type CodeRefusDeplacement = (typeof CODES_REFUS_DEPLACEMENT)[number]

/** Un refus et sa liste ; chaque élément est déjà réduit à ce que l'écran nomme. */
export type RefusDeplacement = { readonly code: CodeRefusDeplacement; readonly elements: readonly string[] }

/** Les familles de référentiels du §7, dans l'ordre où l'aperçu les dit. */
export const FAMILLES_REFERENTIELS = [
	'workflow',
	'node',
	'common_field',
	'label',
	'contact',
	'organization',
	'mail_label',
	'sequence',
	'template',
] as const
export type FamilleReferentiel = (typeof FAMILLES_REFERENTIELS)[number]

export type Referentiel = { readonly famille: FamilleReferentiel; readonly reutilises: readonly string[]; readonly crees: readonly string[] }

export type Montant = { readonly devise: string; readonly montant: number }

export type Apercu = {
	readonly track: { readonly id: string; readonly nom: string }
	readonly depart: { readonly id: string; readonly nom: string }
	readonly arrivee: { readonly id: string; readonly nom: string; readonly slug: string; readonly domaine: string | null }
	readonly comptes: {
		readonly channels: number
		readonly affaires: number
		readonly mails: number
		readonly pieces: number
		readonly commentaires: number
		readonly saisies: number
		readonly minutes: number
		readonly budgets: number
		readonly couts: number
		readonly recettes: number
		readonly webhooks: number
	}
	readonly referentiels: readonly Referentiel[]
	readonly valeurDepart: readonly Montant[]
	readonly valeurArrivee: readonly Montant[]
	readonly sansCout: readonly string[]
	readonly doublons: readonly string[]
	readonly refus: readonly RefusDeplacement[]
}

const objet = (v: unknown): Readonly<Record<string, unknown>> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const liste = (v: unknown): readonly unknown[] => (Array.isArray(v) ? v : [])
const texte = (v: unknown): string => (typeof v === 'string' ? v : '')
const nombre = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : 0)

/** Ce que chaque refus nomme de ses éléments (§4). */
function elementDeRefus(code: CodeRefusDeplacement, brut: unknown): string {
	const e = objet(brut)
	switch (code) {
		case 'homonym_track':
			return texte(e['name'])
		case 'shared_card':
			return `${texte(e['title'])} — ${liste(e['other_tracks']).map(texte).join(', ')}`
		case 'non_member':
			return texte(e['name'])
		case 'armed_sequence':
			return `${texte(e['title'])} — ${texte(e['sequence'])}`
		case 'queued_send':
		case 'pending_draft':
			return `${texte(e['title'])} — ${texte(e['subject'])}`
		case 'field_type_conflict':
			return `${texte(e['field'])} (${texte(e['type'])} → ${texte(e['target_type'])})`
		case 'daily_cap_exceeded':
			return `${texte(e['name'])} — ${texte(e['day'])} — ${nombre(e['minutes'])} min`
		case 'same_workspace':
		case 'track_trashed':
			return ''
	}
}

/** Lit la liste des refus rendue par la base ; un code inconnu est écarté. */
export function lireRefus(brut: unknown): readonly RefusDeplacement[] {
	return liste(brut).flatMap((r) => {
		const code = texte(objet(r)['code'])
		if (!(CODES_REFUS_DEPLACEMENT as readonly string[]).includes(code)) return []
		const c = code as CodeRefusDeplacement
		return [{ code: c, elements: liste(objet(r)['items']).map((e) => elementDeRefus(c, e)).filter((e) => e !== '') }]
	})
}

const montants = (v: unknown): readonly Montant[] =>
	liste(v).map((m) => ({ devise: texte(objet(m)['currency']), montant: nombre(objet(m)['amount']) }))

/** Projette l'aperçu rendu par `track_move_preview` (§5). */
export function projeterApercu(brut: unknown): Apercu {
	const a = objet(brut)
	const c = objet(a['counts'])
	const couts = objet(a['costs'])
	const refs = objet(a['referentials'])
	return {
		track: { id: texte(objet(a['track'])['id']), nom: texte(objet(a['track'])['name']) },
		depart: { id: texte(objet(a['from'])['id']), nom: texte(objet(a['from'])['name']) },
		arrivee: {
			id: texte(objet(a['to'])['id']),
			nom: texte(objet(a['to'])['name']),
			slug: texte(objet(a['to'])['slug']),
			domaine: texte(objet(a['to'])['inbound_domain']) || null,
		},
		comptes: {
			channels: nombre(c['channels']),
			affaires: nombre(c['cards']),
			mails: nombre(c['messages']),
			pieces: nombre(c['attachments']),
			commentaires: nombre(c['comments']),
			saisies: nombre(c['time_entries']),
			minutes: nombre(couts['minutes']),
			budgets: nombre(c['budgets']),
			couts: nombre(c['costs']),
			recettes: nombre(c['revenues']),
			webhooks: nombre(c['webhooks']),
		},
		referentiels: FAMILLES_REFERENTIELS.flatMap((famille) => {
			const f = objet(refs[famille])
			const reutilises = liste(f['reused']).map((r) => texte(objet(r)['source']))
			const crees = liste(f['created']).map((r) => texte(objet(r)['target']))
			return reutilises.length === 0 && crees.length === 0 ? [] : [{ famille, reutilises, crees }]
		}),
		valeurDepart: montants(couts['from']),
		valeurArrivee: montants(couts['to']),
		sansCout: liste(couts['without_cost']).map((p) => texte(objet(p)['name'])),
		doublons: liste(a['duplicates']).map((d) => texte(objet(d)['subject'])),
		refus: lireRefus(a['refusals']),
	}
}

type ReponseRpc = {
	readonly data: unknown
	readonly error: { readonly message: string; readonly code?: string; readonly details?: string | null } | null
	readonly status: number
}

async function appeler(client: ClientCrm, fonction: string, args: Record<string, unknown>): Promise<ReponseRpc> {
	const rpc = client.rpc as unknown as (nom: string, a: Record<string, unknown>) => PromiseLike<ReponseRpc>
	return await rpc.call(client, fonction, args)
}

/** Les tracks d'un espace, pour le super-administrateur (§13). */
export async function lireTracksEspace(client: ClientCrm, idEspace: string): Promise<EtatAsync<readonly TrackEspace[]>> {
	try {
		const reponse = await appeler(client, 'plateforme_tracks', { p_ws: idEspace })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(
			liste(reponse.data).map((l) => {
				const t = objet(l)
				return {
					id: texte(t['id']),
					nom: texte(t['name']),
					slug: texte(t['slug']),
					channels: nombre(t['channels']),
					affaires: nombre(t['cards']),
					corbeille: t['trashed'] === true,
				}
			}),
		)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

export async function lireApercu(client: ClientCrm, idTrack: string, idEspace: string): Promise<EtatAsync<Apercu>> {
	try {
		const reponse = await appeler(client, 'track_move_preview', { p_track_id: idTrack, p_target_workspace_id: idEspace })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		return pret(projeterApercu(reponse.data))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** L'issue d'un déplacement (§6) : fait, ou refusé avec sa nature et, pour `refuse`, la liste recalculée par la base. */
export type IssueDeplacement =
	| { readonly statut: 'deplace'; readonly affaires: number; readonly channels: number }
	| { readonly statut: 'refuse'; readonly refus: readonly RefusDeplacement[] }
	| { readonly statut: 'echec'; readonly nature: 'confirmation' | 'forbidden' | 'introuvable' | 'network' | 'unknown' }

export async function deplacerTrack(
	client: ClientCrm,
	idTrack: string,
	idEspace: string,
	nomSaisi: string,
): Promise<IssueDeplacement> {
	try {
		const reponse = await appeler(client, 'move_track', { p_track_id: idTrack, p_target_workspace_id: idEspace, p_confirm_name: nomSaisi })
		if (reponse.error === null) {
			const b = objet(reponse.data)
			return { statut: 'deplace', affaires: nombre(b['cards']), channels: nombre(b['channels']) }
		}
		const message = reponse.error.message
		if (message === 'track_move_refused') {
			let details: unknown = []
			try {
				details = JSON.parse(reponse.error.details ?? '[]')
			} catch {
				details = []
			}
			return { statut: 'refuse', refus: lireRefus(details) }
		}
		if (message === 'confirmation_mismatch') return { statut: 'echec', nature: 'confirmation' }
		if (reponse.status === 401 || reponse.status === 403) return { statut: 'echec', nature: 'forbidden' }
		if (reponse.status === 404) return { statut: 'echec', nature: 'introuvable' }
		if (reponse.status === 0) return { statut: 'echec', nature: 'network' }
		return { statut: 'echec', nature: 'unknown' }
	} catch {
		return { statut: 'echec', nature: 'network' }
	}
}

/**
 * La confirmation n'est ouverte qu'à la saisie du nom du track, aux blancs des bords près — la règle de la base
 * (`app.btrim_blancs`) : c'est l'état de la confirmation, pas un droit (docs/DESIGN_SYSTEM.md §5.112).
 */
export function confirmationDeplacementValide(saisie: string, nom: string): boolean {
	return nom.trim() !== '' && saisie.trim() === nom.trim()
}

/** L'adresse actuelle d'un track déplacé : le slug de son espace et le sien (§12). */
export type AdresseTrack = { readonly espace: string; readonly track: string }

/**
 * Lit l'adresse actuelle du track que désignait `(slugEspace, slugTrack)` avant un déplacement (§12) — `null` s'il n'a pas
 * été déplacé depuis cet espace, ou si l'appelant ne le lit plus : la RLS du track tranche, et la route dit alors
 * « introuvable » sans rien révéler.
 */
export async function lireAdresseActuelleTrack(
	client: ClientCrm,
	slugEspace: string,
	slugTrack: string,
): Promise<EtatAsync<AdresseTrack | null>> {
	try {
		const reponse = await appeler(client, 'track_current_address', { p_workspace_slug: slugEspace, p_track_slug: slugTrack })
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const ligne = objet(liste(reponse.data)[0])
		const espace = texte(ligne['workspace_slug'])
		const track = texte(ligne['track_slug'])
		return pret(espace === '' || track === '' ? null : { espace, track })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Réécrit un chemin `/<espace>/tracks/<track>[/…]` vers l'adresse actuelle du track ; la suite — le channel, la vue
 * liste, les coûts — est gardée : un channel garde son adresse courte sous son track (§12). `null` si le chemin ne désigne
 * pas ce track dans cet espace.
 */
export function cheminApresDeplacement(chemin: string, depart: AdresseTrack, arrivee: AdresseTrack): string | null {
	const prefixe = `/${encodeURIComponent(depart.espace)}/tracks/${encodeURIComponent(depart.track)}`
	if (chemin !== prefixe && !chemin.startsWith(`${prefixe}/`)) return null
	return `/${encodeURIComponent(arrivee.espace)}/tracks/${encodeURIComponent(arrivee.track)}${chemin.slice(prefixe.length)}`
}

/** Où en est la résolution de l'adresse d'un track introuvable dans l'espace de l'adresse. */
export type ResolutionTrack =
	| { readonly statut: 'inactive' }
	| { readonly statut: 'recherche' }
	| { readonly statut: 'deplace'; readonly adresse: AdresseTrack }
	| { readonly statut: 'introuvable' }

/**
 * Le track d'une adresse est introuvable dans son espace (`introuvable` vrai) : a-t-il été déplacé ? La lecture n'est faite
 * que dans ce cas, une fois par adresse. Une erreur de lecture vaut « introuvable » : l'écran garde son état d'erreur
 * d'adresse, et rien n'est inventé.
 */
export function useResolutionTrack(
	client: ClientCrm | null,
	slugEspace: string | undefined,
	slugTrack: string | undefined,
	introuvable: boolean,
): ResolutionTrack {
	const [resolution, setResolution] = useState<ResolutionTrack>({ statut: 'inactive' })
	useEffect(() => {
		if (!introuvable || client === null || slugEspace === undefined || slugTrack === undefined) {
			setResolution({ statut: 'inactive' })
			return
		}
		let vivant = true
		setResolution({ statut: 'recherche' })
		void lireAdresseActuelleTrack(client, slugEspace, slugTrack).then((etat) => {
			if (!vivant) return
			setResolution(etat.statut === 'pret' && etat.donnees !== null ? { statut: 'deplace', adresse: etat.donnees } : { statut: 'introuvable' })
		})
		return () => {
			vivant = false
		}
	}, [client, slugEspace, slugTrack, introuvable])
	return resolution
}
