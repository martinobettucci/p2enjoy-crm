// @spec CRM-079 (docs/BACKLOG.md) — guide de démarrage : la mesure des cinq étapes
// @spec docs/SPEC-onboarding.md §2 (la progression est une mesure, jamais un drapeau),
//       §3 (les cinq étapes et leurs filtres), §3.1 (ce qui a été mesuré), §3.2 (cinq comptages,
//       une seule décision), §6.2 (les trois états d'une étape)
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

/** Les cinq étapes, dans l'ordre où elles se lisent (docs/SPEC-onboarding.md §3). */
export const CLES_ETAPES_DEMARRAGE = ['espace', 'track', 'channel', 'affaire', 'messagerie'] as const

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
 * Les cinq mesures, émises **en parallèle** et rendues indépendantes (docs/SPEC-onboarding.md §3.2).
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

/** État initial : cinq chargements. Il évite un rendu où `etapes` serait vide, donc « accompli ». */
export const PROGRESSION_INITIALE: ProgressionDemarrage = {
	etapes: CLES_ETAPES_DEMARRAGE.map(() => enChargement<EtapeDemarrage>()),
}

/**
 * Charge la progression et expose un rechargement **réel** : la reprise proposée par une ligne en
 * erreur relance les cinq mesures, elle ne recharge pas la page (docs/SPEC-webapp.md §7).
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
