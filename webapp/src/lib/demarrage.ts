// @spec CRM-079 (docs/BACKLOG.md) — guide de démarrage : la mesure des étapes
// @spec docs/SPEC-onboarding.md §2 (la progression est une mesure, jamais un drapeau),
//       §3 (les étapes et leurs filtres), §3.1 (ce qui a été mesuré), §3.2 (des comptages
//       indépendants, une seule décision), §6.2 (les trois états d'une étape)
// @spec CRM-094 (docs/BACKLOG.md) tranche T2 — docs/SPEC-onboarding.md §10.1 (six étapes, le workflow
//       avant le channel), §10.3 (le geste « Créer le workflow de départ », et le signal qui fait se
//       relire les écrans ouverts) ; docs/SPEC-workflow-engine.md §7 quater ; docs/JOURNAL.md décisions
//       606 et 607
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone) ; docs/DESIGN_SYSTEM.md §5.17
//
// CE MODULE N'OUVRE AUCUNE POLITIQUE NOUVELLE. Chaque table est comptée sous la politique qui la
// régit déjà — `tracks` (CRM-020), `channels` (CRM-021), `cards` (CRM-040), `workspaces` (CRM-022),
// `mail_inbound_accounts` (CRM-052). Rien n'est recalculé ni élargi ici.
//
// Conséquence MESURÉE le 2026-08-15 et assumée (docs/SPEC-onboarding.md §3.1) : un comptage n'est
// pas un inventaire, c'est ce que l'appelant peut voir. Le `viewer` seedé compte 5 channels et
// 9 affaires là où la base en porte 6 et 14. L'écran écrit donc ce que l'appelant voit, jamais ce
// qui existe.

import { useCallback, useEffect, useRef, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { Database } from './database.types'
import type { ClientCrm } from './supabase'

/**
 * Les tables interrogeables, telles que le SCHÉMA les déclare — jamais une chaîne libre. Une table
 * inexistante glissée dans `FILTRES_ETAPES_DEMARRAGE` ne compile pas : c'est la garde que
 * `docs/SPEC-webapp.md` §14.1 attend des types générés par `CRM-006`.
 */
type TableLisible = keyof Database['public']['Tables']

/**
 * Les six étapes, dans l'ordre où elles se lisent (docs/SPEC-onboarding.md §3, §10.1). Le workflow
 * précède le channel depuis `CRM-094` : un channel en exige un, et un espace neuf n'en a aucun.
 */
export const CLES_ETAPES_DEMARRAGE = ['espace', 'track', 'workflow', 'channel', 'affaire', 'messagerie'] as const

export type CleEtapeDemarrage = (typeof CLES_ETAPES_DEMARRAGE)[number]

/**
 * Une étape mesurée. `compte` est ce que l'appelant voit ; l'étape est accomplie dès la première
 * ligne. On conserve le compte plutôt qu'un booléen : c'est la donnée mesurée, et un booléen
 * calculé ici obligerait à remesurer pour répondre à « combien ».
 */
export type EtapeDemarrage = {
	readonly cle: CleEtapeDemarrage
	readonly compte: number
}

export type ProgressionDemarrage = {
	/** Un état par étape : quatre mesures abouties et une refusée doivent laisser lire les quatre. */
	readonly etapes: readonly EtatAsync<EtapeDemarrage>[]
}

/**
 * Les filtres de chaque comptage, **repris des lectures existantes** et non réinventés :
 * `webapp/src/lib/tracks.ts` pose déjà qu'un track archivé est masqué et qu'un track en corbeille
 * est retiré. Une étape qui compterait un objet en corbeille se dirait accomplie par un objet que
 * l'écran ne montre nulle part (docs/SPEC-onboarding.md §3).
 *
 * Exportée pour que le test unitaire vérifie la requête réellement émise, comme `COLONNES_TRACK`.
 */
export const FILTRES_ETAPES_DEMARRAGE: Readonly<
	Record<CleEtapeDemarrage, { readonly table: TableLisible; readonly nuls: readonly string[] }>
> = {
	espace: { table: 'workspaces', nuls: [] },
	track: { table: 'tracks', nuls: ['archived_at', 'deleted_at'] },
	// Un workflow s'archive et n'a pas de corbeille ; archivé, aucun channel ne peut plus le choisir.
	workflow: { table: 'workflows', nuls: ['archived_at'] },
	channel: { table: 'channels', nuls: ['archived_at', 'deleted_at'] },
	affaire: { table: 'cards', nuls: ['deleted_at'] },
	messagerie: { table: 'mail_inbound_accounts', nuls: [] },
}

/**
 * Compte une étape. `head: true` : l'écran affiche un état, pas une liste — rapporter les lignes
 * ferait transiter une charge utile que rien ne rend.
 *
 * Une réponse aboutie dont le `count` est absent est un **contrat rompu**, pas une absence : elle
 * est rendue en erreur, exactement comme `lireCompteursFileSortante` (`mail-etat.ts`). Un zéro
 * inventé ici afficherait « à faire » sur une étape peut-être accomplie — la valeur par défaut
 * trompeuse que `CLAUDE.md` §18 interdit.
 */
export async function mesurerEtape(
	client: ClientCrm,
	cle: CleEtapeDemarrage,
): Promise<EtatAsync<EtapeDemarrage>> {
	const filtre = FILTRES_ETAPES_DEMARRAGE[cle]
	try {
		let requete = client.from(filtre.table).select('id', { count: 'exact', head: true })
		for (const colonne of filtre.nuls) {
			requete = requete.is(colonne, null)
		}
		const reponse = await requete
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		if (reponse.count === null) {
			return enErreur(classerErreur(undefined, 'count absent alors que la réponse a abouti'))
		}
		return pret({ cle, compte: reponse.count })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les mesures, émises **en parallèle** et rendues indépendantes (docs/SPEC-onboarding.md §3.2).
 *
 * Aucune n'est conditionnée à la précédente : subordonner la mesure d'un channel à l'existence d'un
 * track ferait passer un refus de lecture pour une absence, et l'écran n'aurait plus rien à dire de
 * l'étape qu'il n'a pas mesurée.
 */
export async function mesurerDemarrage(client: ClientCrm): Promise<ProgressionDemarrage> {
	const etapes = await Promise.all(CLES_ETAPES_DEMARRAGE.map((cle) => mesurerEtape(client, cle)))
	return { etapes }
}

/** Une étape est accomplie dès la première ligne visible — docs/SPEC-onboarding.md §6.2. */
export function estAccomplie(etat: EtatAsync<EtapeDemarrage>): boolean {
	return etat.statut === 'pret' && etat.donnees.compte >= 1
}

/**
 * Le compte des étapes accomplies, et le total. Une étape en erreur n'est **pas** comptée comme
 * accomplie ni retirée du total : elle reste une étape du parcours, simplement non vérifiée.
 */
export function compterAccomplies(progression: ProgressionDemarrage): {
	readonly accomplies: number
	readonly total: number
} {
	return {
		accomplies: progression.etapes.filter(estAccomplie).length,
		total: progression.etapes.length,
	}
}

/**
 * Vrai lorsqu'il reste au moins une étape à faire — et donc que `/` doit rendre le guide plutôt que
 * son état vide (docs/SPEC-onboarding.md §4.2).
 *
 * Une étape **non mesurable** compte comme restant à faire : le guide ne peut pas se retirer en
 * affirmant un accomplissement qu'il n'a pas constaté.
 */
export function resteUneEtape(progression: ProgressionDemarrage): boolean {
	return progression.etapes.some((etat) => !estAccomplie(etat))
}

/** Vrai tant qu'une mesure est en vol : `/` rend alors les squelettes, jamais l'état vide (§4.2). */
export function mesureEnCours(progression: ProgressionDemarrage): boolean {
	return progression.etapes.some((etat) => etat.statut === 'chargement')
}

/** État initial : un chargement par étape. Il évite un rendu où `etapes` serait vide, donc « accompli ». */
export const PROGRESSION_INITIALE: ProgressionDemarrage = {
	etapes: CLES_ETAPES_DEMARRAGE.map(() => enChargement<EtapeDemarrage>()),
}

/**
 * Charge la progression et expose un rechargement **réel** : la reprise proposée par une ligne en
 * erreur relance toutes les mesures, elle ne recharge pas la page (docs/SPEC-webapp.md §7).
 *
 * Même garde que `useTracks` contre les réponses périmées : une réponse arrivée après le démontage
 * n'écrit pas, et une réponse plus ancienne n'écrase pas une plus récente.
 */
export function useDemarrage(client: ClientCrm | null): {
	readonly progression: ProgressionDemarrage
	readonly recharger: () => void
} {
	const [progression, setProgression] = useState<ProgressionDemarrage>(PROGRESSION_INITIALE)
	const [tentative, setTentative] = useState(0)
	const courant = useRef(0)

	useEffect(() => {
		if (client === null) return
		const rang = ++courant.current
		setProgression(PROGRESSION_INITIALE)
		void mesurerDemarrage(client).then((resultat) => {
			if (rang === courant.current) setProgression(resultat)
		})
	}, [client, tentative])

	const recharger = useCallback(() => {
		setTentative((precedente) => precedente + 1)
	}, [])

	return { progression, recharger }
}

// ---------------------------------------------------------------------------------------------
// Le workflow de départ — `CRM-094` (docs/SPEC-workflow-engine.md §7 quater)
// ---------------------------------------------------------------------------------------------

/**
 * L'issue du geste, et chacune se dit sur la ligne de l'étape (docs/SPEC-onboarding.md §10.3).
 *
 * Le refus est lu sur le `code` SQL, jamais sur une phrase — sauf la clé du nœud archivé, que seule
 * la phrase porte et que l'écran doit nommer pour dire QUOI restaurer.
 */
export type IssueWorkflowDepart =
	| { readonly ok: true }
	| { readonly ok: false; readonly raison: 'existant' }
	| { readonly ok: false; readonly raison: 'reserve' | 'panne' }
	| { readonly ok: false; readonly raison: 'noeud-archive'; readonly cle: string }

const MOTIF_NOEUD_ARCHIVE = /^noeud archive : ([a-z0-9-]+)$/

/**
 * L'événement d'interface émis quand la base porte un workflow que les écrans ouverts ignorent
 * peut-être (docs/SPEC-onboarding.md §10.3, « les écrans ouverts se relisent »).
 *
 * Le geste se fait depuis le panneau flottant, PAR-DESSUS l'écran courant — l'éditeur de workflows, le
 * catalogue, l'arborescence et son formulaire de channel. Ces écrans ont lu à leur montage : sans ce
 * signal, ils continueraient d'affirmer qu'aucun workflow n'existe sous l'étape qui vient de passer à
 * « Fait ». Chacun se relit lui-même, sans être remonté : une saisie en cours survit.
 */
export const EVENEMENT_WORKFLOW_DEPART = 'p2enjoy:workflow-de-depart'

/** Abonne un écran au signal ; `relire` doit être stable (`useCallback`), comme toute dépendance d'effet. */
export function useApresWorkflowDeDepart(relire: () => void): void {
	useEffect(() => {
		globalThis.addEventListener(EVENEMENT_WORKFLOW_DEPART, relire)
		return () => globalThis.removeEventListener(EVENEMENT_WORKFLOW_DEPART, relire)
	}, [relire])
}

/**
 * Pose le workflow de départ de l'espace. Ne lève jamais.
 *
 * Aucune règle n'est jugée ici : la base décide, et `SECURITY INVOKER` y fait jouer la RLS des tables
 * écrites (`CLAUDE.md` §10). Une panne n'est jamais présentée comme un succès (`CLAUDE.md` §18).
 *
 * Le signal part sur un succès ET sur `existant` : dans les deux cas, la base porte un workflow que
 * l'écran ouvert sous le panneau n'a peut-être pas lu — posé à l'instant, ou par un collègue.
 */
export async function creerWorkflowDeDepart(client: ClientCrm, idWorkspace: string): Promise<IssueWorkflowDepart> {
	const issue = await appelerWorkflowDeDepart(client, idWorkspace)
	if (issue.ok || issue.raison === 'existant') globalThis.dispatchEvent(new Event(EVENEMENT_WORKFLOW_DEPART))
	return issue
}

async function appelerWorkflowDeDepart(client: ClientCrm, idWorkspace: string): Promise<IssueWorkflowDepart> {
	try {
		const reponse = await client.rpc('creer_workflow_de_depart', { p_workspace: idWorkspace })
		if (reponse.error === null) return { ok: true }
		if (reponse.error.code === '42501') return { ok: false, raison: 'reserve' }
		if (reponse.error.code === 'P0001') {
			if (reponse.error.message === 'workflow existant') return { ok: false, raison: 'existant' }
			const archive = MOTIF_NOEUD_ARCHIVE.exec(reponse.error.message)
			if (archive?.[1] !== undefined) return { ok: false, raison: 'noeud-archive', cle: archive[1] }
		}
		return { ok: false, raison: 'panne' }
	} catch {
		return { ok: false, raison: 'panne' }
	}
}

