// @spec CRM-007 (docs/BACKLOG.md) — contrat asynchrone commun à tous les chargements
// @spec docs/SPEC-webapp.md §6.4 (contrat asynchrone), §7 (états systématiques)
// @spec docs/DESIGN_SYSTEM.md §5.8 (états systématiques)
//
// Un seul type somme décrit tout chargement. Le rendu d'un état est **exhaustif** : le
// compilateur refuse un cas non traité, ce qui rend impossible l'oubli d'un état — l'oubli
// étant précisément le défaut que docs/DESIGN_SYSTEM.md §5.8 cherche à interdire.
//
// Aucune valeur par défaut ne masque une erreur (CLAUDE.md §18) : il n'existe pas d'état
// « prêt avec un tableau vide parce que ça a échoué ». Un échec est un échec.

/** Nature d'un échec de chargement, telle que l'interface doit la présenter. */
export type NatureErreur =
	/** Le backend a répondu, et a refusé. L'interface explique, elle ne réessaie pas seule. */
	| 'forbidden'
	/** Le backend n'a pas répondu. Réessayer a un sens. */
	| 'network'
	/** Tout le reste. L'interface ne prétend pas savoir. */
	| 'unknown'

export type ErreurDonnees = {
	readonly nature: NatureErreur
	/** Message technique, destiné au diagnostic — jamais affiché tel quel à l'utilisateur. */
	readonly detail: string
}

export type EtatAsync<T> =
	| { readonly statut: 'chargement' }
	| { readonly statut: 'pret'; readonly donnees: T }
	| { readonly statut: 'erreur'; readonly erreur: ErreurDonnees }

export const enChargement = <T,>(): EtatAsync<T> => ({ statut: 'chargement' })

export const pret = <T,>(donnees: T): EtatAsync<T> => ({ statut: 'pret', donnees })

export const enErreur = <T,>(erreur: ErreurDonnees): EtatAsync<T> => ({ statut: 'erreur', erreur })

/**
 * Classe une réponse en échec à partir de ce que le transport a réellement observé.
 *
 * Le code HTTP est la seule source fiable : `403` et `401` sont des refus explicites du
 * backend, tandis qu'une réponse **sans code** signifie que la requête n'a jamais abouti.
 * On ne devine jamais à partir du texte du message, qui dépend de la bibliothèque et de la
 * version du navigateur.
 *
 * Un refus par RLS ne passe **pas** par ici : la politique de refus par défaut rend `200` et
 * zéro ligne (docs/SPEC-permissions-rls.md, docs/SPEC-webapp.md §6.3). C'est donc un état
 * *vide*, pas un état d'erreur — et c'est exactement ce que l'interface doit montrer.
 */
export function classerErreur(statutHttp: number | undefined, detail: string): ErreurDonnees {
	if (statutHttp === 401 || statutHttp === 403) return { nature: 'forbidden', detail }
	if (statutHttp === undefined || statutHttp === 0) return { nature: 'network', detail }
	return { nature: 'unknown', detail }
}
