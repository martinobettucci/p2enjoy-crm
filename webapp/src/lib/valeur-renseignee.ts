// @spec CRM-037 (docs/BACKLOG.md) — « renseigné », la définition que l'interface et la garde partagent
// @spec docs/SPEC-form-composer.md §4.3 (l'interface lit la même définition que la garde),
//       §6.6 (définition portée par `app.valeur_de_champ_est_vide`)
//
// Ce module est **délibérément seul dans son fichier**, sans React ni rien du DOM : il est importé
// par le rendu (`webapp/src/lib/formulaire.ts`), par son test unitaire, et par la preuve d'API
// `e2e/api/rendu-formulaire.spec.ts`, qui appartient à un autre projet TypeScript. Un tableau de
// cas recopié dans chaque appelant divergerait, et l'égalité qu'il sert à prouver ne vaudrait plus
// rien.

import type { Json } from './database.types'

/**
 * « Renseigné », au sens de `docs/SPEC-form-composer.md` §6.6, dont ce prédicat doit donner la
 * **même** lecture que `app.valeur_de_champ_est_vide(jsonb)` — faute de quoi l'interface
 * annoncerait passable une transition que la garde refuse (§4.3).
 *
 * Cinq façons d'être vide, et cinq seulement :
 *
 *   * aucune ligne (`undefined`) ;
 *   * `null` — SQL `NULL` comme `'null'::jsonb`, que PostgREST rend indistinguables (INC-054) ;
 *   * une chaîne vide, ou faite de seuls espaces ;
 *   * un tableau vide.
 *
 * Tout le reste est renseigné, **y compris `false`, `0` et `"0"`** : une case décochée est une
 * réponse, pas une absence de réponse. Un objet vide `{}` est renseigné lui aussi — le §6.6 ne le
 * range pas parmi les vides, et rien ne permet de décider à sa place.
 */
export function estRenseigne(valeur: Json | undefined): boolean {
	if (valeur === undefined || valeur === null) return false
	if (typeof valeur === 'string') return valeur.trim().length > 0
	if (Array.isArray(valeur)) return valeur.length > 0
	return true
}

/**
 * Un cas du tableau partagé du §4.3.
 *
 * `type` nomme un type de champ du §2.3 capable d'accueillir la valeur : la preuve d'API doit
 * écrire réellement la ligne, donc franchir la validation par type de `CRM-036`. Sans lui, la
 * moitié des cas seraient refusés à l'écriture et ne prouveraient rien de la lecture.
 */
export type CasRenseigne = {
	readonly nom: string
	readonly valeur: Json
	readonly renseigne: boolean
	readonly type: string
}

/**
 * Tableau de cas du §4.3, **partagé** entre le test unitaire du prédicat ci-dessus et la preuve
 * d'API qui écrit les mêmes valeurs dans de vraies lignes `card_field_values` puis demande à
 * `move_card` de trancher.
 *
 * `undefined` n'y figure pas : ce n'est pas une valeur `jsonb`, et aucune écriture ne peut le
 * produire. Il est exercé par le seul test unitaire, qui le nomme.
 */
export const CAS_RENSEIGNE: readonly CasRenseigne[] = [
	{ nom: 'null explicite', valeur: null, renseigne: false, type: 'text' },
	{ nom: 'chaîne vide', valeur: '', renseigne: false, type: 'text' },
	{ nom: 'chaîne d’espaces', valeur: '   ', renseigne: false, type: 'text' },
	{ nom: 'tableau vide', valeur: [], renseigne: false, type: 'multiselect' },
	{ nom: 'faux', valeur: false, renseigne: true, type: 'checkbox' },
	{ nom: 'vrai', valeur: true, renseigne: true, type: 'checkbox' },
	{ nom: 'zéro', valeur: 0, renseigne: true, type: 'number' },
	{ nom: 'zéro en chaîne', valeur: '0', renseigne: true, type: 'text' },
	{ nom: 'nombre ordinaire', valeur: 45000, renseigne: true, type: 'number' },
	{ nom: 'texte ordinaire', valeur: 'Salon', renseigne: true, type: 'text' },
	{ nom: 'texte entouré d’espaces', valeur: '  Salon  ', renseigne: true, type: 'text' },
	{ nom: 'tableau non vide', valeur: ['choix-a'], renseigne: true, type: 'multiselect' },
] as const
