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

import { createContext, useContext, type ReactNode } from 'react'
import { CAPACITES_INCONNUES, type CapacitesEspace } from '../lib/capacites'

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
