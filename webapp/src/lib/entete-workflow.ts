// @spec CRM-118 (docs/BACKLOG.md) — tranche T1.b : les gestes d'en-tête du workflow choisi dans l'éditeur — renommer,
//       définir par défaut, copier vers un track, archiver, rétablir (docs/SPEC-workflow-engine.md §7 quinquies.1 et
//       §7 quinquies.2 ; docs/JOURNAL.md décisions 758 et 760)
// @spec docs/SPEC-workflow-engine.md §4.2 et §4.3 (`copy_workflow_to_track`, ses refus) ; docs/SCHEMA.md « Migration
//       `0130` » (`set_default_workflow`, la garde d'archivage)
//
// CE MODULE NE DÉCIDE RIEN : chaque geste est l'écriture ou la fonction que la base expose, et son refus est traduit par
// un dictionnaire fermé. Le message brut de la base n'atteint jamais l'écran.

import type { ClientCrm } from './supabase'

/** Ce que l'écran sait dire d'un refus d'en-tête. */
export type RefusEnTete =
	| { readonly nature: 'employe'; readonly channels: number }
	| {
			readonly nature:
				| 'par-defaut'
				| 'non-global'
				| 'archive'
				| 'nom-vide'
				| 'track-introuvable'
				| 'introuvable'
				| 'interdit'
				| 'reseau'
				| 'inconnu'
	  }

export type ResultatEnTete<T = null> =
	| { readonly statut: 'applique'; readonly valeur: T }
	| { readonly statut: 'sans-effet' }
	| { readonly statut: 'refus'; readonly refus: RefusEnTete }

/** Classe un refus par son message, puis par son code (`docs/SCHEMA.md` « Migration `0130` », §4.3). */
export function classerRefusEnTete(
	statut: number | undefined,
	code: string | undefined,
	message: string | undefined,
): RefusEnTete {
	const texte = (message ?? '').trim()
	const employe = /^workflow_in_use\D*(\d+)/.exec(texte)
	if (employe !== null) return { nature: 'employe', channels: Number(employe[1]) }
	if (texte === 'workflow_is_default') return { nature: 'par-defaut' }
	if (texte === 'workflow non global' || texte === 'workflow_not_global') return { nature: 'non-global' }
	if (texte === 'workflow archive') return { nature: 'archive' }
	if (texte === 'track_not_found') return { nature: 'track-introuvable' }
	if (texte === 'workflow introuvable' || texte === 'workflow_not_found') return { nature: 'introuvable' }
	if (texte.includes('workflows_name_check')) return { nature: 'nom-vide' }
	if (code === '42501' || statut === 401 || statut === 403) return { nature: 'interdit' }
	if (statut === undefined) return { nature: 'reseau' }
	return { nature: 'inconnu' }
}

type ReponseEcriture = {
	readonly error: { readonly code?: string; readonly message: string } | null
	readonly status: number
	readonly data: unknown
}

async function ecrire<T>(
	appel: () => PromiseLike<ReponseEcriture>,
	lire: (donnees: unknown) => T | null,
): Promise<ResultatEnTete<T>> {
	try {
		const reponse = await appel()
		if (reponse.error !== null) {
			return { statut: 'refus', refus: classerRefusEnTete(reponse.status, reponse.error.code, reponse.error.message) }
		}
		const valeur = lire(reponse.data)
		// Zéro ligne : la clause `USING` a filtré en silence — ni un succès, ni une erreur (§5.3 ter du design system).
		return valeur === null ? { statut: 'sans-effet' } : { statut: 'applique', valeur }
	} catch {
		return { statut: 'refus', refus: { nature: 'reseau' } }
	}
}

const uneLigne = (donnees: unknown): null | true =>
	Array.isArray(donnees) && donnees.length === 1 ? true : null

/** Renomme le workflow : le nom `trim`é, comme à la création (§3 bis.4). */
export function renommerWorkflow(client: ClientCrm, idWorkflow: string, nom: string): Promise<ResultatEnTete<true>> {
	return ecrire(() => client.from('workflows').update({ name: nom.trim() }).eq('id', idWorkflow).select('id'), uneLigne)
}

/** Désigne le workflow par défaut de son espace, par la fonction atomique de la migration `0130`. */
export function definirParDefaut(client: ClientCrm, idWorkflow: string): Promise<ResultatEnTete<true>> {
	return ecrire(() => client.rpc('set_default_workflow', { p_workflow: idWorkflow }), (donnees) =>
		donnees === null || donnees === undefined ? null : true,
	)
}

/** Archive le workflow (la garde de la base peut refuser), ou le rétablit (jamais refusé par la garde). */
export function archiverWorkflow(
	client: ClientCrm,
	idWorkflow: string,
	archiver: boolean,
): Promise<ResultatEnTete<true>> {
	return ecrire(
		() =>
			client
				.from('workflows')
				.update({ archived_at: archiver ? new Date().toISOString() : null })
				.eq('id', idWorkflow)
				.select('id'),
		uneLigne,
	)
}

/** Copie un workflow global vers un track ; rend l'identifiant de la copie (§4.2). Le nom est facultatif. */
export function copierVersTrack(
	client: ClientCrm,
	idWorkflow: string,
	idTrack: string,
	nom: string,
): Promise<ResultatEnTete<string>> {
	const propre = nom.trim()
	return ecrire(
		() =>
			client.rpc('copy_workflow_to_track', {
				workflow_id: idWorkflow,
				track_id: idTrack,
				...(propre === '' ? {} : { new_name: propre }),
			}),
		(donnees) => (typeof donnees === 'string' && donnees !== '' ? donnees : null),
	)
}
