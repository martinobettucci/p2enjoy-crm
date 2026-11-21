// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — le slug de l'espace courant, la liste des espaces lus, et le crochet qui met
//       un chemin dans l'espace courant (docs/SPEC-espace-courant.md §15.2, §15.3)
// @spec CRM-157 (docs/BACKLOG.md) tranche T3 — `espaceLu` (docs/SPEC-onboarding.md §11.1)
// @spec CRM-094 (docs/BACKLOG.md) tranches T2 et T3 — l'espace courant et le rôle que la base y rend,
//       tenus une fois par la coquille (docs/SPEC-onboarding.md §10.2, §10.3)
// @spec CRM-092 (docs/BACKLOG.md) tranche T8 — `mon_role_espace`, le rôle que la base applique
// @spec CRM-093 (docs/BACKLOG.md) tranche T2 — les deux capacités de l'espace, rendues par la base sur sa ligne
//       (docs/SPEC-droits-interface.md §2.2, §4 ; docs/DESIGN_SYSTEM.md §5.59)
// @spec CLAUDE.md §10 — ce contexte décide d'un AFFICHAGE, jamais d'un droit : chaque geste garde son
//       refus serveur
//
// La coquille lit déjà l'espace courant — le premier rendu par `lireWorkspaces`, patron de
// `Carnet` et `Objectifs`. Elle y ajoute le rôle, et le rend à ses descendants : le guide de
// démarrage et sa pastille en ont besoin, et le relire dans chacun doublerait les requêtes.

import { createContext, useCallback, useContext, type ReactNode } from 'react'
import { useParams } from 'react-router'
import { CAPACITES_INCONNUES, type CapacitesEspace } from '../lib/capacites'
import type { Workspace } from '../lib/workspaces'
import { cheminEspace, estPageDEspace } from './chemins'

export type ContexteEspace = {
	/** L'espace courant, `null` tant qu'il n'est pas lu ou qu'il n'y en a aucun. */
	readonly idWorkspace: string | null
	/** Vrai seulement quand la base a rendu `admin` ; faux pendant la lecture et en cas d'échec. */
	readonly estAdmin: boolean
	/**
	 * Administrer et éditer l'espace, tels que la base les rend sur sa ligne (`CRM-093`). `en-lecture` pendant la
	 * lecture, `inconnue` sur un échec ou hors coquille — et `inconnue` n'éteint rien (§4 de la spécification).
	 */
	readonly capacites: CapacitesEspace
	/**
	 * `CRM-157` (docs/SPEC-onboarding.md §11.1) : faux tant que la coquille LIT les espaces — `idWorkspace` est alors nul
	 * sans dire « aucun espace ». Absent hors de la coquille (une preuve qui monte un écran seul) : lu.
	 */
	readonly espaceLu?: boolean
	/**
	 * `CRM-161` T2.a (§15.2) : le slug de l'espace courant, pour composer les liens des pages d'un espace. Absent hors
	 * coquille : les liens gardent alors leur ancienne adresse, que la redirection sert (§15.4).
	 */
	readonly slugEspace?: string | null
	/** `CRM-161` T2.a (§15.3) : les espaces lus, par nom — le slug de l'espace d'une ressource se lit ici. */
	readonly espaces?: readonly Workspace[]
}

/** Hors coquille — une preuve qui monte un composant seul —, aucun espace et aucun rôle. */
const Contexte = createContext<ContexteEspace>({ idWorkspace: null, estAdmin: false, capacites: CAPACITES_INCONNUES })

export function FournisseurEspace({
	valeur,
	children,
}: {
	/** Sans capacités — une preuve qui ne les exerce pas —, elles sont inconnues, et n'éteignent rien. */
	readonly valeur: Omit<ContexteEspace, 'capacites'> & { readonly capacites?: CapacitesEspace }
	readonly children: ReactNode
}) {
	const complet: ContexteEspace = { ...valeur, capacites: valeur.capacites ?? CAPACITES_INCONNUES }
	return <Contexte.Provider value={complet}>{children}</Contexte.Provider>
}

export function useContexteEspace(): ContexteEspace {
	return useContext(Contexte)
}

/**
 * `CRM-161` T2.a (§15.3) — met un chemin d'une page d'un espace (`/inbox`, `/reglages/etiquettes`, `/tracks/…`) dans
 * l'espace courant ; un chemin global (`/contacts`, `/objectifs`…) ou déjà préfixé reste tel quel. Sans espace connu, le chemin reste l'ancienne adresse, que la redirection résout (§15.4) : jamais un lien
 * vers un autre espace.
 */
export function useVersEspace(): (chemin: string) => string {
	// Un écran qui monte SA PROPRE coquille (la route d'un track, d'une affaire, des coûts d'un track) appelle ce crochet
	// hors du fournisseur : le slug est alors celui de l'adresse. Sans lui, sa navigation passerait par l'ancienne adresse,
	// et la redirection remonterait l'écran — l'annonce et le focus d'après le geste seraient perdus.
	const { slugEspace: slugContexte } = useContexteEspace()
	const { slugEspace: slugAdresse } = useParams()
	const slugEspace = slugContexte ?? slugAdresse ?? null
	return useCallback(
		(chemin: string) =>
			slugEspace === null || slugEspace === undefined || !estPageDEspace(chemin.split(/[?#]/)[0] ?? chemin)
				? chemin
				: cheminEspace(slugEspace, chemin),
		[slugEspace],
	)
}
