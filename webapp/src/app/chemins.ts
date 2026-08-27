// @spec CRM-079 (docs/BACKLOG.md) — adresses des surfaces atteintes hors de `ROUTES`
// @spec CRM-086 (docs/BACKLOG.md) — adresse de l'écran de coûts d'un track (docs/SPEC-costs.md §4.0)
// @spec CRM-062 (docs/BACKLOG.md) — adresse de l'écran des affaires figées (docs/SPEC-relances.md §10.4)
// @spec docs/SPEC-onboarding.md §4.1 (une adresse propre), §4.3 (entrée dans l'index des réglages)
// @spec docs/SPEC-webapp.md §5.2 (routes) ; docs/SPEC-administration-arborescence.md §3.1 ;
//       docs/SPEC-mail-subsystem.md §20.11.1 ; docs/SPEC-corbeille.md §4.1 ;
//       docs/SPEC-workflow-engine.md §7 bis.2
//
// POURQUOI CE MODULE EXISTE, et il n'existait pas avant `CRM-079`. Ces adresses vivaient dans
// `routes.tsx`, qui rend aussi les écrans. Le guide de démarrage RENVOIE vers deux d'entre elles ;
// l'importer depuis `routes.tsx` aurait créé un cycle `routes → GuideDemarrage → routes`, que
// `CLAUDE.md` §3 interdit. Les constantes descendent donc dans un module sans rendu, dont
// `routes.tsx` les RÉEXPORTE : aucun appelant existant n'est modifié.

/** Adresse de l'inbox globale — `CRM-057`. */
export const CHEMIN_INBOX = '/inbox' as const

/**
 * Carnet de contacts — `CRM-060`, `docs/SPEC-contacts.md` §10.2.
 *
 * Une route de PREMIER NIVEAU, et non une section de `/reglages` : un contact est le matériau
 * quotidien d'un commercial, au même titre qu'une affaire — ce que le §3 de la spécification a
 * déjà tranché en base en ouvrant son écriture au `business_developer`, là où les tracks, les
 * channels et les workflows restent à l'`admin`. Les cinq surfaces de `/reglages` administrent la
 * structure du workspace ; le carnet n'administre rien, il travaille.
 */
export const CHEMIN_CONTACTS = '/contacts' as const

/**
 * Ma journée — `CRM-061`, `docs/SPEC-cards.md` §17.2.
 *
 * Une route de PREMIER NIVEAU, portée par une entrée de la barre latérale que
 * `docs/DESIGN_SYSTEM.md` §4 déclare **depuis `CRM-000`**. Elle existait déjà comme adresse et
 * rendait un état vide inconditionnel depuis `CRM-007` ; elle est ici **nommée** pour cesser d'être
 * une chaîne littérale recopiée, comme les six autres avant elle.
 *
 * Elle RESTE dans `ROUTES` : son titre est une clé de traduction et son contenu ne dépend d'aucun
 * paramètre de chemin. Seule la **portée** vit dans la chaîne de requête (`?qui=tous`), qui n'entre
 * pas dans la table des routes.
 */
export const CHEMIN_MA_JOURNEE = '/ma-journee' as const

/**
 * Fiche d'organisation — `CRM-060` tranche 4b, `docs/SPEC-contacts.md` §11.2.
 *
 * Une route de DÉTAIL sous le carnet, et non une route de premier niveau `/organisations/:id` :
 * une adresse de premier niveau suppose une surface d'entrée qui la peuple, et il n'existe aucune
 * liste d'organisations (§11.8). Le carnet est cette entrée — on atteint une organisation par un
 * de ses contacts.
 *
 * Elle ne figure PAS dans `ROUTES`, exactement comme `CHEMIN_CARD` et `CHEMIN_LISTE` : son titre
 * est le nom de l'organisation, donc une donnée, et son contenu dépend d'un paramètre d'URL. La
 * couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` reste ainsi inchangée.
 *
 * L'organisation est désignée par son IDENTIFIANT : `organizations` ne porte aucun slug, et
 * `domain` ne peut pas en tenir lieu — il est nul pour une organisation sur deux du seed, et une
 * adresse qui n'existe que pour la moitié des lignes n'est pas une adresse.
 */
export const CHEMIN_ORGANISATION = '/contacts/organisations/:idOrganisation' as const

/** Adresse concrète de la fiche d'une organisation donnée. */
export const cheminOrganisation = (idOrganisation: string) =>
	`/contacts/organisations/${idOrganisation}`

/**
 * Fiche d'un contact — `CRM-060` tranche 4f, `docs/SPEC-contacts.md` §15.2.
 *
 * Une route de DÉTAIL sous le carnet, pour le motif exact de `CHEMIN_ORGANISATION` : le carnet est
 * la surface d'entrée qui la peuple.
 *
 * **Aucune collision avec `CHEMIN_ORGANISATION`, et ce n'est pas une chance mais une propriété du
 * chemin** : la fiche d'organisation porte TROIS segments, celle du contact DEUX. Un patron à deux
 * segments ne peut pas apparier une adresse qui en a trois, quel que soit le classement des routes.
 * Le contact garde donc l'adresse la plus courte, qui est celle de l'objet de première classe.
 *
 * Elle ne figure PAS dans `ROUTES` : son titre est le nom du contact, donc une donnée, et son
 * contenu dépend d'un paramètre d'URL. Le contact est désigné par son IDENTIFIANT — `contacts` ne
 * porte aucun slug, et l'email ne peut pas en tenir lieu : il est nul pour Élise Fabre.
 */
export const CHEMIN_CONTACT = '/contacts/:idContact' as const

/** Adresse concrète de la fiche d'un contact donné. */
export const cheminContact = (idContact: string) => `/contacts/${idContact}`

/** Administration de l'arborescence — `CRM-075`. */
export const CHEMIN_ADMIN_ARBORESCENCE = '/reglages/arborescence' as const

/** Éditeur de workflows — `CRM-076`. */
export const CHEMIN_ADMIN_WORKFLOWS = '/reglages/workflows' as const

/** Administration du catalogue de nœuds — `CRM-030`, `docs/SPEC-workflow-engine.md` §2 bis.2. */
export const CHEMIN_ADMIN_CATALOGUE = '/reglages/catalogue' as const

/**
 * Configuration des comptes entrants — `CRM-088`, `docs/SPEC-mail-subsystem.md` §21.2.
 *
 * Une SIXIÈME section de réglages, distincte de `CHEMIN_ETAT_MESSAGERIE` : l'une configure, l'autre
 * supervise. Les fondre en une seule adresse ferait porter à un écran de lecture des gestes
 * d'écriture, et le §5.14 du design system a explicitement borné cet écran-là à la lecture.
 */
export const CHEMIN_ADMIN_COMPTES_MAIL = '/reglages/comptes-mail' as const

/**
 * Configuration des identités sortantes — `CRM-089`, `docs/SPEC-mail-subsystem.md` §22.2.
 *
 * Une SEPTIÈME section de réglages, et la jumelle de `CHEMIN_ADMIN_COMPTES_MAIL` : l'une configure
 * ce qu'on reçoit, l'autre ce qu'on expédie. Les deux tables sont distinctes, leurs fonctions
 * d'écriture aussi, et les fondre en une adresse ferait porter à un écran deux objets métier.
 */
export const CHEMIN_ADMIN_IDENTITES_MAIL = '/reglages/identites-mail' as const

/**
 * Administration des modèles d'emails — `CRM-063`, `docs/SPEC-modeles-emails.md` §9.1.
 *
 * Une HUITIÈME section de réglages, et la troisième de la famille « messagerie » qui écrive après
 * `CHEMIN_ADMIN_COMPTES_MAIL` — ce qu'on reçoit — et `CHEMIN_ADMIN_IDENTITES_MAIL` — ce qu'on
 * expédie. Celle-ci porte le TEXTE qui sera expédié. Elle vient après les identités et avant
 * l'état de la messagerie, et l'ordre a une raison : on déclare l'expéditeur avant d'écrire le
 * texte qu'il expédiera, et on configure avant de superviser.
 */
export const CHEMIN_ADMIN_MODELES_MAIL = '/reglages/modeles-emails' as const

/**
 * Administration des séquences de relance — `CRM-063`, `docs/SPEC-modeles-emails.md` §13.4.
 *
 * Une NEUVIÈME section de réglages, et la quatrième de la famille « messagerie » qui écrive. Elle
 * vient après `CHEMIN_ADMIN_MODELES_MAIL` — le texte — et avant `CHEMIN_ETAT_MESSAGERIE`, et
 * l'ordre suit celui que le §9.1 a posé : on déclare l'expéditeur, puis le texte, puis la CADENCE
 * qui enchaîne les textes ; et on configure avant de superviser.
 */
export const CHEMIN_ADMIN_SEQUENCES_MAIL = '/reglages/sequences-relance' as const

/** État de la messagerie — `CRM-059`. */
export const CHEMIN_ETAT_MESSAGERIE = '/reglages/messagerie' as const

/** Corbeille — `CRM-077`. */
export const CHEMIN_CORBEILLE = '/reglages/corbeille' as const

/**
 * Préférences de notification — `CRM-064` tranche 4, `docs/DESIGN_SYSTEM.md` §5.45.
 *
 * **La PREMIÈRE section PERSONNELLE de `/reglages`.** Les autres administrent l'instance ; celle-ci
 * règle le compte de qui la regarde, et les trois profils l'ouvrent. Elle reste sous `/reglages`
 * plutôt qu'au premier niveau : c'est bien un réglage, et le raisonnement qui a sorti le carnet et
 * les objectifs des réglages — « ils n'administrent rien, ils portent le travail » — ne s'applique
 * pas ici, une préférence ne portant aucun travail.
 */
export const CHEMIN_REGLAGES_NOTIFICATIONS = '/reglages/notifications' as const

/**
 * Objectifs — `CRM-083`, `docs/SPEC-goals.md` §5.1.
 *
 * Une route de PREMIER NIVEAU, « au même niveau que la messagerie » comme la spécification
 * l'écrit, et non une section de `/reglages` : un tableau d'objectifs n'administre rien, il porte
 * le travail — le même raisonnement exactement que celui qui a placé le carnet de contacts hors
 * des réglages.
 */
export const CHEMIN_OBJECTIFS = '/objectifs' as const

/**
 * Canevas d'un tableau donné — `docs/SPEC-goals.md` §5.2.
 *
 * Le tableau est désigné par son IDENTIFIANT : `goal_boards` ne porte aucun slug, et son `name`
 * ne peut pas en tenir lieu — il est libre, renommable, et unique seulement après normalisation.
 *
 * Cette adresse ne figure PAS dans `ROUTES` : son titre est le nom du tableau, donc une donnée,
 * et son contenu dépend d'un paramètre d'URL. La couverture exacte `ROUTES` ⇄
 * `ENTREES_TRANSVERSES` reste ainsi inchangée.
 */
export const CHEMIN_OBJECTIFS_TABLEAU = '/objectifs/:idTableau' as const

/** Adresse concrète du canevas d'un tableau donné. */
export const cheminTableauObjectifs = (idTableau: string) => `/objectifs/${idTableau}`

/**
 * Affaires figées — `CRM-062` tranche 3c, `docs/SPEC-relances.md` §10.4.
 *
 * Une route de PREMIER NIVEAU, et non une section de `/reglages` : c'est le raisonnement qui a déjà
 * placé le carnet, les objectifs, les coûts et « Ma journée » hors des réglages — **une liste
 * d'affaires en retard n'administre rien, elle porte le travail**.
 *
 * Elle RESTE dans `ROUTES` : son titre est une clé de traduction et son contenu ne dépend d'aucun
 * paramètre d'adresse. La couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` que `routes.test.tsx`
 * tient reste donc vraie, avec une entrée de plus **des deux côtés**.
 *
 * AUCUNE PORTÉE DANS LA CHAÎNE DE REQUÊTE, contrairement à `/ma-journee` : `public.cards_figees()`
 * ne prend aucun argument et rend « ce que l'appelant peut lire », sans autre dimension (§10.6). Un
 * filtre d'écran ferait de la webapp le juge d'un rangement que la base ne connaît pas.
 */
export const CHEMIN_AFFAIRES_FIGEES = '/affaires-figees' as const

/** Guide de démarrage — `CRM-079`, `docs/SPEC-onboarding.md` §4.1. */
export const CHEMIN_DEMARRAGE = '/demarrage' as const

/**
 * Écran de coûts d'un track — `CRM-086`, `docs/SPEC-costs.md` §4.0 et §4.2.
 *
 * L'adresse est ARRÊTÉE par le §4.0, écrit avant le code : les §4.2, §4.3 et §4.5 décrivaient le
 * contenu des trois écrans sans jamais nommer leur adresse.
 *
 * Elle ne figure PAS dans `ROUTES`, exactement comme `CHEMIN_CARD`, `CHEMIN_LISTE` et
 * `CHEMIN_OBJECTIFS_TABLEAU` : son titre est le nom du track, donc une **donnée**, et son contenu
 * dépend d'un paramètre d'adresse. La couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` reste
 * ainsi inchangée.
 *
 * **AUCUNE COLLISION AVEC `/tracks/:slugTrack/:slugChannel`, ET CE N'EST PAS UNE CHANCE.** React
 * Router classe ses routes par spécificité et non par ordre de déclaration : un segment littéral
 * l'emporte toujours sur un segment dynamique de même rang. Un channel dont le slug vaudrait
 * `couts` serait donc masqué par cet écran — c'est le prix du segment littéral, et il est le même
 * que celui déjà payé par `/tracks/:slugTrack/:slugChannel/liste` depuis `CRM-042`.
 */
export const CHEMIN_COUTS_TRACK = '/tracks/:slugTrack/couts' as const

/** Adresse concrète de l'écran de coûts d'un track donné. */
export const cheminCoutsTrack = (slugTrack: string) => `/tracks/${slugTrack}/couts`

/**
 * Écran de détail d'un budget — `CRM-086`, `docs/SPEC-costs.md` §4.0 et §4.3.
 *
 * Elle ne figure PAS dans `ROUTES`, pour le motif de `CHEMIN_COUTS_TRACK` : son titre est le nom du
 * budget, donc une **donnée**, et son contenu dépend de deux paramètres d'adresse.
 *
 * **LE BUDGET EST DÉSIGNÉ PAR SON IDENTIFIANT, JAMAIS PAR SON NOM, et le §4.0 en donne la raison
 * exacte** : le §2.1 pose que l'unicité du nom ne porte que sur les budgets **non clôturés**, si
 * bien que deux budgets « Salon 2025 » — l'un clos, l'autre ouvert — coexistent légitimement sur un
 * même track. Un slug dérivé du nom ne désignerait alors plus rien.
 *
 * **AUCUNE COLLISION AVEC `CHEMIN_COUTS_TRACK`**, et ce n'est pas une chance : le détail porte
 * QUATRE segments, l'écran du track TROIS. Un patron à trois segments ne peut pas apparier une
 * adresse qui en a quatre, quel que soit le classement des routes — c'est la propriété déjà
 * retenue pour distinguer `CHEMIN_CONTACT` de `CHEMIN_ORGANISATION`.
 */
export const CHEMIN_COUTS_BUDGET = '/tracks/:slugTrack/couts/:idBudget' as const

/** Adresse concrète de l'écran de détail d'un budget donné. */
export const cheminCoutsBudget = (slugTrack: string, idBudget: string) =>
	`/tracks/${slugTrack}/couts/${idBudget}`

/**
 * Cumul des coûts du workspace — `CRM-086`, `docs/SPEC-costs.md` §4.0 et §4.5.
 *
 * **C'est la SEULE des trois adresses de coûts qui figure dans `ROUTES`**, et le §4.0 en donne la
 * raison : son titre est une clé de traduction et non une donnée, et son contenu ne dépend d'aucun
 * paramètre d'adresse. Les deux autres nomment un track ou un budget, et suivent donc le patron de
 * `CHEMIN_CARD`.
 *
 * **Une route de PREMIER NIVEAU, et non une section de `/reglages`** : c'est le raisonnement exact
 * qui a placé le carnet de contacts (`CHEMIN_CONTACTS`) et les objectifs (`CHEMIN_OBJECTIFS`) hors
 * des réglages — un histogramme de coûts n'administre rien, il porte le travail. Elle rejoint donc
 * les entrées transverses de la barre latérale (`webapp/src/app/navigation.ts`), et la couverture
 * exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` est tenue par une assertion de `routes.test.tsx`.
 */
export const CHEMIN_COUTS_WORKSPACE = '/couts' as const
