// @spec CRM-093 (docs/BACKLOG.md) — tranche T3 : le refus d'un bloc, transmis à chacune de ses commandes
// @spec docs/SPEC-droits-interface.md §3 (un motif par bloc, chaque commande y renvoie), §4 ; docs/DESIGN_SYSTEM.md §5.59
//
// Un écran d'administration porte des dizaines de commandes réparties dans des sous-composants. Leur faire passer le
// refus de main en main ajouterait une propriété à chacun, pour une information qui vaut pour tout le bloc. Le bloc la
// FOURNIT donc une fois, avec le motif qu'il rend en tête, et chaque commande la LIT. Hors de tout fournisseur, rien
// n'est refusé : une commande montée seule — une preuve, un autre écran — reste offerte.

import { createContext, useContext, type ReactNode } from 'react'
import type { ProprietesCommande } from '../../lib/capacites'

const Contexte = createContext<ProprietesCommande>({})

export function FournisseurRefus({ valeur, children }: { readonly valeur: ProprietesCommande; readonly children: ReactNode }) {
	return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>
}

/**
 * Les propriétés à poser sur une commande du bloc : celles du refus, fusionnées avec une désactivation qui n'a rien à
 * voir avec le droit — une extrémité de liste, un envoi en vol —, que le refus ne doit jamais effacer.
 */
export function useRefus(desactiveeParAilleurs = false): ProprietesCommande {
	const refus = useContext(Contexte)
	const disabled = refus.disabled === true || desactiveeParAilleurs
	return {
		...(disabled ? { disabled: true } : {}),
		...(refus['aria-describedby'] === undefined ? {} : { 'aria-describedby': refus['aria-describedby'] }),
	}
}
