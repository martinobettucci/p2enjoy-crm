// @spec CRM-161 (docs/BACKLOG.md) tranche T2.a — les preuves de bout en bout face à l'espace en tête du chemin
//       (docs/SPEC-espace-courant.md §8.1, §15.5)
//
// `ESPACE_SEED` est le slug de l'espace du seed (`docs/SPEC-seed.md` §1) : les `goto` des pages d'un espace y mènent. Une
// preuve qui pose son PROPRE espace garde l'ancienne adresse, que la redirection mène dans l'espace de sa ressource ou de
// l'onglet (§15.4) ; et ses attentes sur l'adresse emploient `dansUnEspace`, qui accepte le slug de n'importe quel espace.

export const ESPACE_SEED = 'p2enjoy'

const echapper = (texte: string): string => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** L'adresse d'une page d'un espace, sous le slug de n'importe quel espace : `toHaveURL(dansUnEspace('/inbox'))`. */
export function dansUnEspace(chemin: string): RegExp {
	return new RegExp(`/[a-z0-9][a-z0-9-]*${echapper(chemin)}$`)
}
