// @spec CRM-161 (docs/BACKLOG.md) tranche T2.b — le menu des espaces : les non-lus de l'inbox de chaque espace
//       (`inbox_unread_by_workspace`), et l'adresse où mène le choix d'un espace (docs/SPEC-espace-courant.md §9, §15.6 ;
//       docs/SPEC-mail-subsystem.md §35.4 ; docs/DESIGN_SYSTEM.md §5.113)

import { useEffect, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'
import { SLUGS_RESERVES } from '../app/chemins'

/** Les non-lus de l'inbox de chaque espace de la personne, par identifiant d'espace. */
export type NonLusParEspace = ReadonlyMap<string, number>

export async function lireNonLusParEspace(client: ClientCrm): Promise<EtatAsync<NonLusParEspace>> {
	try {
		const reponse = await client.rpc('inbox_unread_by_workspace', {})
		if (reponse.error !== null) return enErreur(classerErreur(reponse.status, reponse.error.message))
		const lignes = (reponse.data ?? []) as readonly { workspace_id: string; unread_count: number }[]
		return pret(new Map(lignes.map((l) => [l.workspace_id, l.unread_count])))
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * Les non-lus de chaque espace, relus à chaque changement de `relecture` (l'adresse) : le menu est une aide, sa lecture ne
 * bloque rien (§5.113 : un échec ne rend aucune pastille).
 */
export function useNonLusParEspace(client: ClientCrm | null, actif: boolean, relecture: unknown): EtatAsync<NonLusParEspace> {
	const [etat, setEtat] = useState<EtatAsync<NonLusParEspace>>(enChargement)
	useEffect(() => {
		if (client === null || !actif) return
		let vivant = true
		void lireNonLusParEspace(client).then((lu) => {
			if (vivant) setEtat(lu)
		})
		return () => {
			vivant = false
		}
	}, [client, actif, relecture])
	return etat
}

/** Vrai si un autre espace que le courant a des non-lus : la pastille du bouton (§5.113). */
export function autreEspaceANonLus(nonLus: EtatAsync<NonLusParEspace>, idCourant: string | null): boolean {
	if (nonLus.statut !== 'pret') return false
	for (const [id, nombre] of nonLus.donnees) if (id !== idCourant && nombre > 0) return true
	return false
}

/**
 * L'adresse où mène le choix de l'espace `slugCible` depuis `chemin` (§9) : la même page quand elle existe dans tout espace —
 * l'inbox (sans le message ouvert, qui est d'un autre espace), un réglage — ; l'inbox depuis la page d'un objet (un track,
 * une affaire, ses coûts) ; `null` sur une page globale, où l'onglet change d'espace sans changer de page.
 */
export function adresseApresChoix(chemin: string, slugCible: string): string | null {
	const segments = chemin.split('/').filter((s) => s !== '')
	const [premier, page] = segments
	// Une page globale commence par un segment réservé (§15.1) : jamais un slug d'espace.
	if (premier === undefined || (SLUGS_RESERVES as readonly string[]).includes(premier)) return null
	if (page !== 'inbox' && page !== 'reglages' && page !== 'tracks') return null
	const espace = `/${encodeURIComponent(slugCible)}`
	if (page === 'reglages') return `${espace}/${segments.slice(1).join('/')}`
	return `${espace}/inbox`
}
