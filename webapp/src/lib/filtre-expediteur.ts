// @spec CRM-156 (docs/BACKLOG.md) — tranche T4 : le filtre par expéditeur de l'inbox — la clé d'adresse `expediteur`, sa
//       lecture qui ignore une valeur mal formée, et le motif de comparaison sans casse
// @spec docs/SPEC-mail-subsystem.md §32.9 ; docs/DESIGN_SYSTEM.md §5.109 bis
//
// Ce module ne rend rien. Le filtre RANGE, il n'autorise pas : la RLS reste seule juge de ce qui est lisible (`CLAUDE.md`
// §10), et la base applique la même comparaison — sans casse ni blancs — à la portée d'une action groupée (§32.2).

/** La clé d'adresse du filtre par expéditeur (§32.9). */
export const CLE_URL_EXPEDITEUR = 'expediteur'

/**
 * L'adresse du filtre, ou `null` : une valeur sans `@`, avec un blanc intérieur, ou vide, est ignorée — comme une pastille
 * mal formée (§31.7). L'adresse est rendue en minuscules : c'est ainsi que la base la compare.
 */
export function lireExpediteurFiltre(valeur: string | null | undefined): string | null {
	const adresse = (valeur ?? '').trim().toLowerCase()
	if (adresse === '' || !adresse.includes('@') || /\s/.test(adresse)) return null
	return adresse
}

/**
 * Le motif `ilike` qui retrouve EXACTEMENT l'adresse, sans casse : `%`, `_` et l'antislash sont échappés, pour qu'une
 * adresse qui en porte ne devienne pas un joker.
 */
export function motifExpediteur(adresse: string): string {
	return adresse.replace(/[\\%_]/g, (signe) => `\\${signe}`)
}
