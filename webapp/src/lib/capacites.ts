// @spec CRM-093 (docs/BACKLOG.md) — tranche T2 : la capacité d'écriture lue par l'interface, et ce qu'elle fait d'une
//       commande
// @spec docs/SPEC-droits-interface.md §2 (les trois faits, tous rendus par la base), §2.1 et §2.2 (les colonnes
//       calculées), §3 (le rendu d'une commande refusée), §4 (les états)
// @spec docs/DESIGN_SYSTEM.md §5.29 ter (la frontière : une capacité rendue par la base s'éteint, un rôle lu jamais),
//       §5.59 ; CLAUDE.md §10 — ce module décide d'un AFFICHAGE, jamais d'un droit : chaque geste garde son refus serveur
//
// Une capacité se lit sur une LIGNE que la base rend — l'espace, le channel, l'affaire —, par une colonne calculée par
// les fonctions mêmes de la RLS (migrations 91 et 92). Ce module ne déduit RIEN d'un rôle.

import { useEffect, useState } from 'react'
import { classerErreur, enChargement, enErreur, pret, type EtatAsync } from './async'
import type { ClientCrm } from './supabase'

/**
 * Les quatre états d'une capacité, et ce que chacun fait d'une commande (§4 de la spécification).
 *
 * - `permise` : la commande est offerte.
 * - `refusee` : la commande est montée, désactivée, et cite son motif.
 * - `en-lecture` : la commande est désactivée SANS motif — aucun texte de refus ne s'affiche avant d'être su.
 * - `inconnue` : la lecture a échoué, ou la colonne n'est pas rendue (cache de schéma périmé). La commande reste
 *   OFFERTE : l'aide d'interface s'efface, le serveur refusera si besoin, et un défaut de lecture ne prive personne
 *   de ses gestes.
 */
export type Capacite = 'permise' | 'refusee' | 'en-lecture' | 'inconnue'

/**
 * La capacité d'une valeur de colonne calculée. Seul `false` refuse ; `true` permet ; tout le reste — `null`,
 * `undefined`, une valeur qui n'est pas un booléen — est inconnu. Un type ne garantit jamais une valeur rendue
 * (`docs/SPEC-types.md`), et c'est ici le sens juste du doute : ne pas éteindre.
 */
export function capaciteDe(valeur: unknown): Capacite {
	if (valeur === true) return 'permise'
	if (valeur === false) return 'refusee'
	return 'inconnue'
}

/** La capacité portée par un état asynchrone de booléen. */
export function capaciteDeLEtat(etat: EtatAsync<boolean | null>): Capacite {
	if (etat.statut === 'chargement') return 'en-lecture'
	if (etat.statut === 'erreur') return 'inconnue'
	return capaciteDe(etat.donnees)
}

/** Ce qu'une commande reçoit : désactivée et citant son motif, désactivée pendant la lecture, ou rien. */
export type ProprietesCommande = {
	readonly disabled?: boolean
	readonly 'aria-describedby'?: string
}

/**
 * Les propriétés d'une commande selon sa capacité. `idMotif` est l'identifiant du motif rendu UNE fois en tête du bloc
 * (§3 : un motif par bloc, chaque commande y renvoie). `desactiveeParAilleurs` garde une désactivation qui n'a rien à
 * voir avec le droit — un envoi en vol, un champ requis vide —, sans que la capacité l'efface.
 */
export function proprietesCommande(
	capacite: Capacite,
	idMotif: string,
	desactiveeParAilleurs = false,
): ProprietesCommande {
	if (capacite === 'refusee') return { disabled: true, 'aria-describedby': idMotif }
	if (capacite === 'en-lecture') return { disabled: true }
	return desactiveeParAilleurs ? { disabled: true } : {}
}

/** Le motif n'est rendu que pour une capacité refusée : jamais pendant la lecture, jamais sur un doute. */
export function motifVisible(capacite: Capacite): boolean {
	return capacite === 'refusee'
}

/** Les deux capacités de l'espace (§2.2). */
export type CapacitesEspace = { readonly administration: Capacite; readonly edition: Capacite }

/** Hors coquille, ou avant que l'espace ne soit connu : rien n'est su, rien n'est éteint. */
export const CAPACITES_INCONNUES: CapacitesEspace = { administration: 'inconnue', edition: 'inconnue' }

type LigneCapacites = { readonly administration_permise: unknown; readonly edition_permise: unknown }

/**
 * Lit les deux capacités de l'espace sur SA ligne. Une requête à part de `lireWorkspaces`, et c'est délibéré : une
 * colonne absente — cache de schéma périmé — rendrait la lecture en erreur, et l'aide d'interface ne doit jamais faire
 * tomber la coquille (§4).
 */
export async function lireCapacitesEspace(
	client: ClientCrm,
	idWorkspace: string,
): Promise<EtatAsync<CapacitesEspace>> {
	try {
		const reponse = await client
			.from('workspaces')
			.select('administration_permise, edition_permise')
			.eq('id', idWorkspace)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const [ligne] = (reponse.data ?? []) as unknown as readonly LigneCapacites[]
		// Aucune ligne : l'espace n'est pas lisible — rien n'est su, rien n'est éteint (la page entière le dira).
		if (ligne === undefined) return pret(CAPACITES_INCONNUES)
		return pret({ administration: capaciteDe(ligne.administration_permise), edition: capaciteDe(ligne.edition_permise) })
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** Les capacités de l'espace, au sens du §4 : `en-lecture` pendant la lecture, `inconnue` sur un échec. */
export function capacitesDeLEtat(etat: EtatAsync<CapacitesEspace>): CapacitesEspace {
	if (etat.statut === 'chargement') return { administration: 'en-lecture', edition: 'en-lecture' }
	if (etat.statut === 'erreur') return CAPACITES_INCONNUES
	return etat.donnees
}

/**
 * Le crochet de la coquille. Comme `useRoleWorkspace`, il n'expose AUCUNE reprise : une capacité illisible ne rend pas
 * l'écran indisponible, elle laisse les commandes offertes.
 *
 * L'ÉTAT LU EST LIÉ À L'ESPACE QU'IL DÉCRIT (INC-281) : tant que l'espace courant n'a pas sa réponse, la capacité est
 * `en-lecture`, jamais celle de l'espace précédent.
 */
export function useCapacitesEspace(client: ClientCrm | null, idWorkspace: string | null): CapacitesEspace {
	const [lu, setLu] = useState<{ readonly cle: string | null; readonly etat: EtatAsync<CapacitesEspace> }>({
		cle: null,
		etat: enChargement(),
	})
	const cle = client === null || idWorkspace === null ? null : idWorkspace

	useEffect(() => {
		if (client === null || idWorkspace === null) return
		let vivant = true
		void lireCapacitesEspace(client, idWorkspace).then((resultat) => {
			if (vivant) setLu({ cle: idWorkspace, etat: resultat })
		})
		return () => {
			vivant = false
		}
	}, [client, idWorkspace])

	// Hors session, ou avant que l'espace ne soit connu : rien n'est su, rien n'est éteint.
	if (cle === null) return CAPACITES_INCONNUES
	return capacitesDeLEtat(lu.cle === cle ? lu.etat : enChargement())
}

/** Les deux tables dont une ligne porte `ecriture_permise` — migration 91 (§2.1). */
export type TableEcrivable = 'cards' | 'channels'

/**
 * Lit la capacité d'écrire sur UNE affaire ou UN channel, par sa colonne calculée. Une requête à part de la lecture
 * de l'écran, pour la raison de `lireCapacitesEspace` : une colonne absente ne doit faire tomber que l'aide
 * d'interface. Aucune ligne rendue — l'objet n'est pas lisible — : rien n'est su, rien n'est éteint.
 */
export async function lireEcriturePermise(
	client: ClientCrm,
	table: TableEcrivable,
	id: string,
): Promise<EtatAsync<boolean | null>> {
	try {
		const reponse = await client.from(table).select('ecriture_permise').eq('id', id)
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const [ligne] = (reponse.data ?? []) as unknown as readonly { readonly ecriture_permise: unknown }[]
		const valeur = ligne?.ecriture_permise
		return pret(typeof valeur === 'boolean' ? valeur : null)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/**
 * La capacité d'écrire sur une affaire ou un channel, relue quand `tentative` change — après un geste refusé, par
 * exemple (§4 : « le refus est traduit, et les droits sont relus »).
 *
 * L'ÉTAT LU EST LIÉ À LA LIGNE ET À LA TENTATIVE QU'IL DÉCRIT (INC-281). Un état non lié laissait, au rendu même où un
 * identifiant arrivait, l'état de l'identifiant précédent : l'« inconnue » de l'absence — commandes offertes, focus posé
 * sur un champ qui s'éteignait un instant plus tard — ou la capacité d'une autre affaire. Tant que la clé courante n'a
 * pas sa réponse, la capacité est `en-lecture`.
 */
export function useEcriturePermise(
	client: ClientCrm | null,
	table: TableEcrivable,
	id: string | null | undefined,
	tentative = 0,
): Capacite {
	const [lu, setLu] = useState<{ readonly cle: string | null; readonly etat: EtatAsync<boolean | null> }>({
		cle: null,
		etat: enChargement(),
	})
	const cle = client === null || id === null || id === undefined ? null : `${table}:${id}:${tentative}`

	useEffect(() => {
		if (client === null || id === null || id === undefined) return
		let vivant = true
		const cleLue = `${table}:${id}:${tentative}`
		void lireEcriturePermise(client, table, id).then((resultat) => {
			if (vivant) setLu({ cle: cleLue, etat: resultat })
		})
		return () => {
			vivant = false
		}
	}, [client, table, id, tentative])

	// Aucune ligne désignée : rien n'est su, rien n'est éteint.
	if (cle === null) return 'inconnue'
	return capaciteDeLEtat(lu.cle === cle ? lu.etat : enChargement())
}

/**
 * Lit la capacité d'écrire sur PLUSIEURS lignes d'une table, en une requête — la corbeille la demande pour toutes ses
 * affaires (`docs/SPEC-droits-interface.md` §5, « La corbeille, précisée »). Une ligne non rendue reste absente du
 * dictionnaire : inconnue, donc offerte.
 */
export async function lireEcrituresPermises(
	client: ClientCrm,
	table: TableEcrivable,
	ids: readonly string[],
): Promise<EtatAsync<Readonly<Record<string, boolean>>>> {
	if (ids.length === 0) return pret({})
	try {
		const reponse = await client.from(table).select('id, ecriture_permise').in('id', [...ids])
		if (reponse.error !== null) {
			return enErreur(classerErreur(reponse.status, reponse.error.message))
		}
		const lignes = (reponse.data ?? []) as unknown as readonly { readonly id: string; readonly ecriture_permise: unknown }[]
		const capacites: Record<string, boolean> = {}
		for (const ligne of lignes) {
			if (typeof ligne.ecriture_permise === 'boolean') capacites[ligne.id] = ligne.ecriture_permise
		}
		return pret(capacites)
	} catch (cause) {
		return enErreur(classerErreur(undefined, cause instanceof Error ? cause.message : String(cause)))
	}
}

/** La capacité d'une ligne dans l'état d'une lecture groupée, au sens du §4. */
export function capaciteDansLEtat(etat: EtatAsync<Readonly<Record<string, boolean>>>, id: string): Capacite {
	if (etat.statut === 'chargement') return 'en-lecture'
	if (etat.statut === 'erreur') return 'inconnue'
	return capaciteDe(etat.donnees[id])
}

/**
 * La capacité d'écrire une boîte entrante ou une identité sortante. La SIENNE est personnelle — famille P, jamais
 * éteinte ; la boîte système (`owner_id` nul) et celles des autres relèvent de l'administration de l'espace — la règle
 * exacte d'`upsert_mail_inbound_account` et d'`upsert_mail_outbound_identity` (migrations 22, 33, 58 :
 * `forbidden` si l'appelant n'administre pas et vise une autre boîte que la sienne). Spécification §5, ligne
 * « Comptes entrants, identités mail ».
 */
export function capaciteDeBoiteMail(
	idProprietaire: string | null,
	idSession: string | null,
	administration: Capacite,
): Capacite {
	return idProprietaire !== null && idProprietaire === idSession ? 'permise' : administration
}
