// @spec CRM-064 (docs/BACKLOG.md) — tranche 3a : ce que la boîte de réception demande, et les
//       deux bornes qu'elle pose
// @spec docs/SPEC-notifications.md §24.1 (deux requêtes, et deux seulement), §24.2 (ce qui n'est
//       PAS demandé), §25.3 (le canal, son nom et son filtre), §26.1 (le compteur et sa borne
//       d'affichage), §26.5 (la borne de lecture, et le point ouvert n° 1 qu'elle traite)
// @spec docs/SPEC-types.md §4
//
// CE MODULE N'IMPORTE RIEN, ET C'EST TOUT SON OBJET.
//
// Les deux chaînes `select`, le nom et le filtre du canal, et les deux bornes doivent être exercés
// des **deux** côtés : par le test unitaire, qui vérifie la requête que le module de composition
// construit, et par la preuve d'API, qui vérifie que la pile réelle rend bien ce que ces chaînes
// demandent. Or la preuve d'API appartient à un autre projet TypeScript (`tsconfig.tools.json`),
// qui n'a ni `vite/client` ni les types du DOM : importer `notifications.ts` depuis `e2e/` ferait
// échouer la compilation sur `webapp/src/lib/supabase.ts`, que ce module-là atteint par son type
// de client.
//
// C'est le procédé de `colonnes-board.ts`, de `colonnes-liste.ts`, de `colonnes-ma-journee.ts` et
// de `colonnes-affaires-figees.ts` (décision 177), repris ici plutôt que réinventé : une seule
// déclaration, atteignable des deux côtés.

/**
 * Colonnes d'une notification, avec son affaire embarquée — la requête 1 du §24.1.
 *
 * L'affaire s'embarque par la clé étrangère **composite** `(subject_card_id, workspace_id)` vers
 * `cards (id, workspace_id)` : PostgREST la résout sans qu'on ait à la nommer, et **MESURÉ**
 * (§21, M5) elle rapporte le titre, le channel et le track en une seule requête.
 *
 * LES DEUX SLUGS SONT EMBARQUÉS PARCE QUE L'ADRESSE D'UNE AFFAIRE LES EXIGE TOUS LES DEUX —
 * `/tracks/:slugTrack/:slugChannel/cards/:idCard` — et qu'aucun des deux ne se déduit de l'autre.
 * C'est l'embarquement de `docs/SPEC-costs.md` §4.4 et de `colonnes-ma-journee.ts`, repris sans
 * changement.
 *
 * **`cards` NE PORTE AUCUNE COLONNE `slug`**, et c'est mesuré (M5 bis) : `cards(slug)` rend
 * `42703 column cards_1.slug does not exist`. Une affaire est désignée par son identifiant ; ce
 * sont son channel et son track qui portent des slugs.
 *
 * CE QUI N'EST PAS DEMANDÉ EST AUSSI UNE DÉCISION (§24.2) : ni `workspace_id`, que l'écran
 * n'affiche pas, ni `recipient_id` — la politique garantit déjà que c'est moi, et le redemander
 * laisserait croire qu'on pourrait lire celui d'un autre. Une requête ne rapporte que ce que
 * l'écran montre, règle que `COLONNES_COMMENTAIRE` tient depuis `CRM-043`.
 */
export const COLONNES_NOTIFICATION =
	'id, type, read_at, created_at, subject_card_id, payload, ' +
	'cards(id, title, channels!cards_channel_id_workspace_id_fkey(slug, name, tracks(slug, name)))'

/**
 * Colonnes d'un commentaire cité par une notification — la requête 2 du §24.1.
 *
 * L'auteur est embarqué par la clé étrangère de `card_comments`, exactement comme le fait
 * `COLONNES_COMMENTAIRE` pour le fil : nom et avatar arrivent dans la même requête, et **une seule
 * requête suffit pour toute la page** (§21, M8).
 *
 * `deleted_at` EST DEMANDÉE, ET SEULEMENT COMPARÉE. Le §13.4 rappelle qu'une suppression de
 * commentaire **vide réellement le corps** ; sans cette colonne, un corps vidé et un corps
 * réellement vide seraient indistinguables, et l'écran rendrait un extrait blanc au lieu de la
 * ligne dégradée du §24.3.
 *
 * LE `payload` N'EST PAS UNE CLÉ ÉTRANGÈRE, et c'est pourquoi il faut deux requêtes : le §13.4
 * refuse toute copie de contenu dans la charge utile, donc PostgREST ne peut pas embarquer le
 * commentaire faute de relation déclarée.
 */
export const COLONNES_COMMENTAIRE_MENTION =
	'id, body, deleted_at, author_id, ' +
	'auteur:profiles!card_comments_author_id_fkey(id, full_name, avatar_url)'

/**
 * Nombre maximal de notifications lues par le panneau (§26.5).
 *
 * CE N'EST PAS UNE PAGINATION : il n'y a ni page suivante, ni « voir tout », et l'écart est
 * **nommé** au §26.5 plutôt que comblé.
 *
 * Le motif est le point ouvert n° 1 du §18 — aucune notification ne se supprime ni n'expire, donc
 * une boîte croît indéfiniment. Une liste non bornée finirait par lire des milliers de lignes pour
 * en montrer dix. La borne est la réponse **la moins engageante** qui rende l'écran sûr : elle ne
 * détruit rien, elle ne décide d'aucune rétention, et elle tombe le jour où le responsable en
 * tranche une.
 *
 * Déclarée ici, et non recopiée dans les preuves : une borne écrite à deux endroits finit par être
 * écrite de deux façons — la leçon de `HORIZON_JOURS`.
 */
export const BORNE_LISTE = 20

/**
 * Au-delà de ce compte, la pastille de la cloche écrit « 99+ » (§26.1).
 *
 * ELLE BORNE LE DESSIN, JAMAIS LA MESURE. Le compteur lui-même compte **toutes** les non-lues, y
 * compris au-delà de `BORNE_LISTE` : un compteur qui s'arrêterait à vingt mentirait sur ce qui
 * reste à lire, et c'est précisément ce qu'une cloche existe pour dire.
 *
 * Le **nom accessible** de la cloche porte le compte exact, jamais la forme tronquée : c'est la
 * règle du §5.15 de `docs/DESIGN_SYSTEM.md` pour l'empreinte tronquée à douze caractères — l'œil
 * reçoit la forme, la technologie d'assistance reçoit la valeur.
 */
export const BORNE_COMPTEUR = 99

/**
 * Ce que la pastille dessine pour un compte donné.
 *
 * `null` quand il n'y a rien à dessiner : le compteur est **absent** à zéro, l'absence disant déjà
 * ce que « 0 » répéterait (§26.1). Un compte négatif, que rien ne produit, est traité comme zéro
 * plutôt que dessiné — l'écran ne rend jamais une valeur qu'il ne sait pas expliquer.
 */
export function formaterCompteur(compte: number): string | null {
	if (!Number.isFinite(compte) || compte <= 0) return null
	return compte > BORNE_COMPTEUR ? `${BORNE_COMPTEUR}+` : String(compte)
}

/**
 * Nom du canal de temps réel d'un destinataire (§25.3).
 *
 * IL PORTE L'IDENTIFIANT DU DESTINATAIRE, ET NON UN NOM FIXE. Deux sessions ouvertes dans le même
 * navigateur — deux onglets, deux comptes — s'abonneraient sinon au **même** canal, et le client
 * `supabase-js` réutilise un canal par son nom. C'est le procédé de `nomCanal(idCard)` de
 * `CRM-043`, transposé à l'objet qui varie ici.
 */
export const nomCanalNotifications = (idProfil: string): string => `notifications:${idProfil}`

/**
 * Filtre du canal : les événements d'un seul destinataire, jamais ceux de toute la table.
 *
 * IL N'EST PAS UNE GARDE D'ACCÈS, et l'écrire ici ne déporte aucune règle chez le client
 * (`CLAUDE.md` §10) : la garde est la politique `notifications_lecture`, que `realtime.apply_rls`
 * évalue pour chaque abonné quoi qu'il arrive. Le filtre est une **économie** — sans lui, le
 * serveur évaluerait la politique pour chaque ligne insérée dans toute la table avant de conclure
 * qu'elle ne me concerne pas.
 */
export const filtreCanalNotifications = (idProfil: string): string => `recipient_id=eq.${idProfil}`
