// @spec CRM-065 (docs/BACKLOG.md) — tranche 2, sous-tranche 2a : ce que la résolution demande
// @spec docs/SPEC-recherche.md §13.1 (une lecture, puis au plus deux résolutions),
//       §11 M15 (l'embarquement est ambigu, la relation est NOMMÉE), §14.2 (la borne d'affichage)
// @spec docs/SPEC-types.md §4
//
// CE MODULE N'IMPORTE RIEN, ET C'EST TOUT SON OBJET.
//
// Les deux chaînes `select` et la borne d'affichage doivent être exercées des **deux** côtés : par
// le test unitaire, qui vérifie la requête que `recherche.ts` construit, et par la preuve d'API,
// qui vérifie que la pile réelle rend bien ce que ces chaînes demandent. Or la preuve d'API
// appartient à un autre projet TypeScript (`tsconfig.tools.json`), qui n'a ni `vite/client` ni les
// types du DOM : importer `recherche.ts` depuis `e2e/` ferait échouer la compilation sur
// `webapp/src/lib/supabase.ts`, que ce module-là atteint par son type de client.
//
// C'est le procédé de `colonnes-notifications.ts` (décision 177), repris plutôt que réinventé :
// une seule déclaration, atteignable des deux côtés.

/**
 * La borne d'affichage de la palette — `p_limite` (§14.2).
 *
 * CE N'EST PAS LA BORNE DU CONTRAT. Celle-ci vaut **cinquante** et vit au serveur (§6.6), seule
 * place où une borne tienne : un client peut demander ce qu'il veut. Vingt est ce qu'une liste
 * ancrée à un en-tête peut montrer sans devenir un écran, et c'est le défaut de la fonction (§6.1).
 */
export const BORNE_PALETTE = 20

/**
 * Le nom du paramètre d'adresse qui désigne un message dans l'inbox (§13.5).
 *
 * ARRÊTÉ ICI, DANS LA SOUS-TRANCHE 2a, ET STABLE PAR CONTRAT. La sous-tranche 2c le fait honorer
 * par `RouteInbox` ; tant qu'elle n'est pas livrée il est **inerte**, et l'écart est nommé plutôt
 * que masqué (`docs/BACKLOG.md`).
 */
export const PARAMETRE_MESSAGE = 'message'

/**
 * Colonnes de la résolution d'adresse d'une AFFAIRE — l'étape 2 du §13.1.
 *
 * LA RELATION EST NOMMÉE, ET C'EST MESURÉ (§11, M15). `cards` porte **deux** clés étrangères vers
 * `channels` — `cards_channel_id_workflow_id_fkey` et `cards_channel_id_workspace_id_fkey` —, et
 * l'embarquement nu rend :
 *
 * ```
 * 300 {"code":"PGRST201","message":"Could not embed because more than one relationship was found
 *      for 'cards' and 'channels'"}
 * ```
 *
 * C'est la relation que `COLONNES_NOTIFICATION` nomme déjà depuis `CRM-064`, et la nommer deux
 * fois de la même façon vaut mieux que d'en choisir une autre : les deux lectures visent la même
 * adresse.
 *
 * LES DEUX SLUGS SONT DEMANDÉS PARCE QUE L'ADRESSE LES EXIGE TOUS LES DEUX —
 * `/tracks/:slugTrack/:slugChannel/cards/:idCard` — et qu'aucun des deux ne se déduit de l'autre.
 *
 * NI `title`, NI `name`, NI `workspace_id` : la RPC rend déjà le titre et le sous-titre (§6.4), et
 * les redemander ferait deux sources pour la même donnée, qui divergeraient le jour où l'une des
 * deux changerait. Une requête ne rapporte que ce qui manque.
 */
export const COLONNES_ADRESSE_AFFAIRE =
	'id, channels!cards_channel_id_workspace_id_fkey(slug, tracks(slug))'

/**
 * Colonnes de la résolution d'adresse d'un COMMENTAIRE — l'étape 3 du §13.1.
 *
 * La même forme, à un niveau de plus : l'`id` rendu par la RPC est celui du **commentaire** (§11,
 * M14), et c'est son affaire qu'il faut atteindre. `card_id` est demandé en plus de l'affaire
 * embarquée : il dit que le commentaire a bien une affaire, là où `cards` nul dirait seulement que
 * l'appelant ne la lit pas — deux faits distincts, que la ligne sans lien du §13.4 traite de la
 * même façon mais qu'on ne confond pas dans la donnée.
 */
export const COLONNES_ADRESSE_COMMENTAIRE =
	'id, card_id, cards(id, channels!cards_channel_id_workspace_id_fkey(slug, tracks(slug)))'
