// @spec CRM-061 (docs/BACKLOG.md) — tranche 1 : ce que « Ma journée » demande, et comment elle
//       découpe ce qu'elle reçoit
// @spec docs/SPEC-cards.md §17.2 (l'adresse porte la portée), §17.3 (la portée par défaut),
//       §17.4 (ce que la vue lit), §17.5 (les trois sections et les deux bornes)
// @spec docs/SPEC-types.md §4
//
// CE MODULE N'IMPORTE QUE `filtre-sommeil`, ET C'EST TOUT SON OBJET.
//
// La chaîne `select`, l'horizon et le découpage en sections doivent être exercés des **deux**
// côtés : par le test unitaire, qui vérifie la requête que le module de composition construit, et
// par la preuve d'API, qui vérifie que la pile réelle rend bien ce que ces filtres demandent. Or la
// preuve d'API appartient à un autre projet TypeScript (`tsconfig.tools.json`), qui n'a ni
// `vite/client` ni les types du DOM : importer `ma-journee.ts` depuis `e2e/` ferait échouer la
// compilation sur `webapp/src/lib/supabase.ts`, que ce module-là atteint par son type de client.
//
// C'est le procédé de `colonnes-board.ts`, de `colonnes-liste.ts` et de `filtre-sommeil.ts`
// (décision 177), repris ici plutôt que réinventé : une seule déclaration, atteignable des deux
// côtés. `filtre-sommeil.ts` n'importe rien lui-même, et `e2e/` l'atteint déjà.

/**
 * Colonnes d'une ligne de « Ma journée ».
 *
 * Les deux slugs sont embarqués parce que l'adresse d'une affaire les EXIGE tous les deux —
 * `/tracks/:slugTrack/:slugChannel/cards/:idCard` — et qu'aucun des deux ne se déduit de l'autre.
 * C'est l'embarquement retenu par `docs/SPEC-costs.md` §4.4, repris sans changement.
 *
 * Les deux `name` servent la pilule « Track › Channel » (`docs/DESIGN_SYSTEM.md` §5.29), qui situe
 * l'affaire sans la nommer.
 *
 * Ce qui n'est PAS demandé est aussi une décision : ni `amount`, ni `owner_id`, ni le responsable
 * embarqué, ni `current_step_id`. Cette vue range par le **temps** et non par le graphe (§17.1), et
 * une requête ne rapporte que ce qui est affiché (§17.4).
 */
export const COLONNES_CARD_JOURNEE =
	'id, title, next_action, next_action_at, channels!cards_channel_id_workspace_id_fkey(slug, name, tracks(slug, name))'

/**
 * L'horizon de la section « À venir », en jours.
 *
 * Valeur **fixée, non configurable**, exactement comme les 25 lignes par page du §12.6. Une vue qui
 * montrerait les échéances d'octobre en août ne serait plus une **journée**, ce serait la vue liste
 * triée par échéance, qui existe déjà. C'est aussi ce qui **borne la lecture**, et donc ce qui rend
 * la pagination inutile (§17.4, §17.5).
 *
 * Déclaré ici, et non recopié dans les preuves : un horizon écrit à deux endroits finit par être
 * écrit de deux façons.
 */
export const HORIZON_JOURS = 7

/** Les deux portées. La liste est **close** : rien d'autre n'entre dans l'adresse (§17.2). */
export type Portee = 'moi' | 'tous'

/**
 * Le défaut, et c'est le choix nommé du §17.3 : celui qui ouvre l'écran voit **sa** journée.
 *
 * Le choix est **réversible** — il tient dans cette constante et dans la valeur d'adresse
 * ci-dessous. Le motif est écrit au §17.3 : le prédicat sélectif de cette requête est l'intervalle
 * d'échéance, pas le responsable, donc l'index `cards_workspace_next_action_idx` déclaré par
 * `CRM-040` sert exactement cette lecture quelle que soit la portée.
 */
export const PORTEE_PAR_DEFAUT: Portee = 'moi'

/** Le nom du paramètre dans l'adresse, déclaré une fois : l'écran et les preuves l'importent. */
export const CLE_URL_PORTEE = 'qui'

/**
 * La seule valeur qui s'écrit dans l'adresse.
 *
 * Le défaut n'y est jamais écrit (§12.2, §17.2) : une adresse portant `?qui=moi` ne dirait rien de
 * plus que l'adresse nue, et la vue par défaut doit rester l'adresse la plus courte.
 */
export const VALEUR_URL_PORTEE_TOUS = 'tous'

/**
 * Lit la portée d'une valeur d'adresse, en repliant **tout** ce qui n'est pas reconnu.
 *
 * La clôture est celle des tris du §12.2 et du mode de sommeil du §16.12.4 : une valeur inconnue ne
 * doit jamais atteindre la requête, et une adresse tapée à la main n'est pas une panne — l'écran
 * n'affiche **aucune erreur** (§17.2).
 */
export function lirePortee(valeur: string | null | undefined): Portee {
	return valeur === VALEUR_URL_PORTEE_TOUS ? 'tous' : PORTEE_PAR_DEFAUT
}

/** Les trois sections, dans l'ordre où l'écran les rend (§17.5). */
export type SectionJournee = 'retard' | 'aujourdhui' | 'avenir'

/** Les trois sections dans leur ordre de rendu, déclaré une fois. */
export const SECTIONS_JOURNEE: readonly SectionJournee[] = ['retard', 'aujourdhui', 'avenir']

export type BornesJournee = {
	/** Début du jour courant, dans le fuseau du **lecteur**. */
	readonly debutJour: Date
	/** Début du lendemain, dans le même fuseau. */
	readonly debutLendemain: Date
	/** Début du huitième jour : borne **exclusive** de la lecture (§17.5). */
	readonly horizon: Date
}

/**
 * Les deux bornes qui découpent la journée, et la troisième qui borne la lecture.
 *
 * ELLES SONT CALCULÉES DANS LE FUSEAU DU LECTEUR, jamais en UTC ni dans celui du serveur : la
 * journée d'un utilisateur est celle de sa montre. C'est la même règle que l'instant du filtre de
 * sommeil (§16.12.2), et pour le même motif — ce n'est pas un contrôle d'accès déporté chez le
 * client (`CLAUDE.md` §10), c'est un **rangement**. La RLS reste seule juge de ce qui est lisible.
 *
 * `setHours(0, 0, 0, 0)` opère en heure locale, et l'arithmétique de jours passe par
 * `setDate(getDate() + n)`, qui traverse correctement les changements d'heure — `+ 86400000` ne le
 * ferait pas, un jour d'été durant vingt-trois ou vingt-cinq heures.
 */
export function bornesJournee(maintenant: Date): BornesJournee {
	const debutJour = new Date(maintenant.getTime())
	debutJour.setHours(0, 0, 0, 0)
	const debutLendemain = new Date(debutJour.getTime())
	debutLendemain.setDate(debutLendemain.getDate() + 1)
	const horizon = new Date(debutJour.getTime())
	horizon.setDate(horizon.getDate() + HORIZON_JOURS + 1)
	return { debutJour, debutLendemain, horizon }
}

/**
 * La section d'une échéance, ou `null` lorsqu'elle est hors de la lecture.
 *
 * « En retard » n'a **aucune borne inférieure** (§17.5) : une échéance oubliée depuis trois mois est
 * précisément celle qu'il faut voir. `null` ne survient donc que pour une échéance **au-delà** de
 * l'horizon — cas que le filtre du §17.4 écarte déjà au serveur, et que cette fonction tranche une
 * seconde fois pour que le découpage reste juste si la requête venait à changer.
 */
export function classerEcheance(echeance: Date, bornes: BornesJournee): SectionJournee | null {
	if (echeance.getTime() < bornes.debutJour.getTime()) return 'retard'
	if (echeance.getTime() < bornes.debutLendemain.getTime()) return 'aujourdhui'
	if (echeance.getTime() < bornes.horizon.getTime()) return 'avenir'
	return null
}
