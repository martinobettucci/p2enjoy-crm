// @spec CRM-109 (docs/BACKLOG.md) — tranche T3 : la trace du dernier refus d'admission d'une attente, telle que la base la
//       rend — à l'administrateur de l'espace par `admission_refus`, au superadministrateur par `plateforme_attentes`
// @spec docs/SPEC-refus-admission.md §2 (trois motifs), §3 (90 jours au plus, filtrés par la base), §5 (ce qu'on en voit)
//
// Ce module ne lit rien : il valide la forme rendue par l'une ou l'autre lecture. Un motif hors des trois est un défaut
// de la contrainte de la base, pas une valeur à deviner : la trace est alors tenue pour absente.

export type MotifRefusAdmission = 'adresse_non_verifiee' | 'attente_verification' | 'attente_administrateur'

export type RefusAdmission = {
	readonly motif: MotifRefusAdmission
	readonly premier: string
	readonly dernier: string
	readonly nombre: number
}

const MOTIFS: ReadonlySet<string> = new Set(['adresse_non_verifiee', 'attente_verification', 'attente_administrateur'])

/** La trace, ou `null` quand la base n'en rend pas — aucune tentative refusée dans les 90 derniers jours. */
export function refusAdmissionDe(motif: unknown, premier: unknown, dernier: unknown, nombre: unknown): RefusAdmission | null {
	if (typeof motif !== 'string' || !MOTIFS.has(motif)) return null
	if (typeof premier !== 'string' || typeof dernier !== 'string') return null
	if (typeof nombre !== 'number' || !Number.isInteger(nombre) || nombre < 1) return null
	return { motif: motif as MotifRefusAdmission, premier, dernier, nombre }
}
