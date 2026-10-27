// @spec CRM-117 (docs/BACKLOG.md) — tranche T3.1 : le contrat du recalcul des liens numérotés, pour les appelants typés
// @spec docs/SPEC-manual.md §10 bis (le numéro d'un lien suit sa cible)

export type Decalage = { readonly ligne: number; readonly avant: string; readonly apres: string }

export function renumeroter(source: string): { readonly texte: string; readonly decalages: readonly Decalage[] }
