# Vues sauvegardées, import et export CSV — `CRM-071`

*Proposée le 2026-10-30, après l'arbitrage du responsable (décisions 774 et 775). **Validée telle quelle le 2026-10-30**
(décision 776) : les huit points du §9 sont acceptés, et le découpage du §8 aussi.*

## 1. Intention et frontière

Trois besoins, rangés dans la même unité par le backlog :

- **les vues sauvegardées** : retrouver en un geste un jeu de filtres de la vue liste d'un channel (« mes affaires en
  négociation », « le secteur public, par échéance »), pour soi ou, publiées par un administrateur, pour tout l'espace.
  Elles portent le **préréglage de revue** `CRM-P08`, refusé comme écran distinct ;
- **l'import CSV** : faire entrer d'un coup des **contacts**, des **organisations** et des **affaires** venus d'un tableur
  ou d'un autre outil, sans saisie ligne à ligne ;
- **l'export CSV** : sortir dans un tableur ce que montrent **la vue liste d'un channel** et **le carnet de contacts**.

**Hors périmètre** (décision 774) : les vues d'un autre écran que la vue liste (carnet, « Ma journée », board) ; l'export
des coûts, des recettes et du temps (`docs/SPEC-costs.md`, `docs/SPEC-recettes.md`, `docs/SPEC-temps.md` restent sans
export) ; la mise à jour d'objets existants par import ; tout format autre que CSV. Le connecteur MCP lit les vues, mais
n'importe ni n'exporte (décision 775).

## 2. Les vues sauvegardées en base

### 2.1 `public.saved_views`

| Colonne | Règle |
|---|---|
| `id` | `uuid`, PK |
| `workspace_id` | `uuid`, non nul ; posé depuis le channel par déclencheur |
| `channel_id` | `uuid`, non nul ; FK composite `(channel_id, workspace_id)` → `channels`, `on delete cascade` |
| `visibility` | `text`, non nul, `private` ou `workspace` |
| `owner_id` | `uuid`, FK `profiles` `on delete cascade` ; la personne pour une vue `private`, l'administrateur qui l'a publiée pour une vue `workspace` ; défaut `auth.uid()`, forcé à l'appelant par déclencheur |
| `name` | `text`, non nul, 1 à 60 caractères après `app.btrim_blancs` |
| `filters` | `jsonb`, non nul ; **clés fermées** (§2.2), vérifiées par `app.saved_view_filters_valid(jsonb)` |
| `created_at`, `updated_at` | `timestamptz` |

- **Unicité du nom**, sans casse : par `(channel_id, owner_id)` parmi les vues `private`, par `channel_id` parmi les vues
  `workspace`. Le refus est `23505`, rendu « Une vue porte déjà ce nom » par l'écran.
- **Aucun archivage** : une vue se supprime. Elle ne porte aucune donnée métier, et un retrait est réversible en la
  réenregistrant.

### 2.2 Ce qu'une vue mémorise

Exactement les paramètres de l'adresse de la vue liste (`webapp/src/lib/liste-cards.ts`, `CLES_URL`), **sauf la page**.
Les clés stockées sont **en anglais** (`docs/DAT.md` §12 bis, décision 658) ; l'écran les traduit vers les paramètres de
l'adresse, entre parenthèses (*précision de rédaction du 2026-10-30 : la première version listait les paramètres de
l'adresse eux-mêmes*) :

| Clé stockée (paramètre) | Valeur |
|---|---|
| `sort` (`tri`) | `title`, `amount`, `next_action_at` ou `created_at` |
| `direction` (`sens`) | `asc` ou `desc` |
| `step_id` (`etape`) | `uuid` d'une étape du workflow du channel |
| `label_id` (`etiquette`) | `uuid` d'une étiquette de l'espace |
| `search` (`q`) | texte, 200 caractères au plus |
| `snoozed` (`sommeil`) | `hidden` (défaut) ou `shown` (`visibles`) |

Une clé absente prend son défaut. **Ouvrir une vue, c'est naviguer vers l'adresse qu'elle compose** : la lecture tolérante
de l'adresse (`docs/SPEC-cards.md` §12.2) replie ce qui ne vaut plus (une étape retirée, une étiquette archivée), sans
erreur. Une vue ne contourne donc jamais un droit : elle ne fait que remplir des filtres, et la RLS des affaires décide de
ce qui paraît.

### 2.3 Qui lit, qui écrit — en base

| Geste | Règle (RLS) |
|---|---|
| lire une vue `private` | sa propriétaire seule |
| lire une vue `workspace` | tout membre de l'espace qui lit le channel (`app.can_read_channel`) |
| créer, renommer, modifier, supprimer une vue `private` | sa propriétaire, si elle lit le channel |
| créer, modifier, supprimer une vue `workspace` | un **administrateur de l'espace** |
| passer une vue de `private` à `workspace` | un administrateur, sur sa propre vue ; l'inverse n'existe pas (on supprime) |

Privilèges explicites (`revoke all` puis `grant`) : `select`, `insert (channel_id, visibility, name, filters)`,
`update (name, filters, visibility)`, `delete`. Aucun privilège pour `anon`.

## 3. Les vues sauvegardées à l'écran

Sur la **vue liste d'un channel** seulement, dans la barre de filtres :

- une liste **« Vues »** : « Mes vues », puis « Vues de l'espace », chacune par nom ; choisir une vue y navigue.
  **La vue choisie est portée par l'adresse** (`vue=<id>`, à côté des filtres) et reste nommée dans la liste ; si les
  filtres s'en écartent, l'écran le dit — « Filtres modifiés depuis la vue » — et offre **« Mettre à jour la vue »**.
  *Révisé le 2026-10-30 avant le code (décision 777)* : la première rédaction nommait la vue « tant que l'adresse
  correspond exactement à ses filtres », ce qui rendait la mise à jour inatteignable. Un `vue` inconnu ou illisible est
  ignoré, sans erreur (lecture tolérante de l'adresse) ;
- **« Enregistrer la vue »** : un nom, et, pour un administrateur, la case « Publier pour tout l'espace » ;
- sur une vue qu'on peut écrire : **« Modifier »** (le nom, et la publication d'une vue privée par un administrateur),
  **« Mettre à jour la vue »**, **« Supprimer »** (sans confirmation : elle se réenregistre).

Le design system reçoit une section (§5.75), les états de chargement, d'erreur, de refus et d'absence de vue y compris.

## 4. Les vues dans le connecteur MCP — famille `affaires`, action `consulter` (décision 775)

- **`crm_view_list(channel_id)`** : les vues que la personne lit sur ce channel, avec leur visibilité et leurs filtres
  traduits en clair (étape et étiquette par leur nom).
- **`crm_card_list`** gagne un paramètre **`view`** (nom ou identifiant) : ses filtres s'appliquent, puis ceux de l'appel
  les précisent. Une vue inconnue est refusée avant toute lecture, et le refus liste les vues possibles.

Aucune écriture de vue par le connecteur, aucune famille nouvelle, aucune migration de la matrice. Les outils s'inscrivent
au catalogue (`docs/SPEC-mcp.md` §9.2).

## 5. L'export CSV

### 5.1 Ce qui s'exporte

- **La vue liste d'un channel** : **toutes** les affaires que les filtres courants retiennent, pas seulement la page
  affichée ; les colonnes de l'écran (titre, étiquettes, responsable, étape, montant, devise, prochaine action, échéance)
  plus l'identifiant et l'adresse de la fiche.
- **Le carnet de contacts** : tous ses contacts, avec leur organisation ; un contact anonymisé sort tel qu'il est
  (« Contact anonymisé », sans coordonnées). *Précisé le 2026-10-30 avant le code de T4* : la première rédaction parlait
  des contacts « que la recherche courante retient », mais le carnet n'a pas de recherche (`docs/DESIGN_SYSTEM.md` §5.19) :
  l'export porte sur le carnet entier, ce que la personne lit.

### 5.2 Les droits et le journal

- Les lignes sont lues **sous la RLS de la personne** : l'export ne montre rien que l'écran ne montrerait.
- Deux fonctions `SECURITY INVOKER`, **`export_cards(p_channel uuid, p_filters jsonb)`** et
  **`export_contacts(p_workspace uuid)`**, rendent les lignes **et journalisent l'export** dans `audit_log`
  (famille `export`, actions `exported`, types `card_list` et `contact_list`, `details` : `{count, filters}`, jamais de
  contenu). L'écran formate le CSV ; le fichier n'est jamais stocké.
- *Précisé le 2026-10-30 avant le code de T4.* Les filtres de `export_cards` sont ceux d'une vue (§2.2), validés par la même
  fonction ; ils s'appliquent comme la vue liste — l'étape sur le rattachement, l'étiquette, la recherche plein texte
  `app.francais_sans_accent`, le sommeil, le tri, nuls en dernier, puis titre et identifiant. **Le journal** : une fonction
  `SECURITY INVOKER` ne peut pas appeler `app.audit_record`, fermée aux clients. Elle appelle **`app.audit_export`**,
  `SECURITY DEFINER`, exécutable par `authenticated` : PostgREST n'exposant pas le schéma `app`, seuls les deux exports
  l'atteignent ; elle vérifie que l'appelant est membre de l'espace et n'écrit que la famille `export`. Un channel
  illisible est refusé (`P0002 channel_not_found`), un espace dont on n'est pas membre aussi (`P0002 workspace_not_found`),
  des filtres hors forme (`22023 invalid_filters`), plus de 5 000 lignes (`22023 export_too_large`) — avant toute
  écriture du journal.
- Plafond : **5 000 lignes** par export ; au-delà, l'écran le dit et invite à filtrer.

### 5.3 Le format

UTF-8 **avec BOM**, séparateur **point-virgule**, fins de ligne CRLF, guillemets selon RFC 4180, dates en ISO 8601,
montants avec un point décimal. Une cellule qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot est
**préfixée d'une apostrophe** : un tableur ne l'exécutera pas comme formule (injection CSV). Nom du fichier :
`affaires-<channel>-<AAAA-MM-JJ>.csv`, `contacts-<AAAA-MM-JJ>.csv`.

## 6. L'import CSV

### 6.1 Le parcours, commun aux trois objets

1. **Le fichier** : CSV, 2 Mo et **1 000 lignes** au plus. L'encodage est lu en UTF-8, puis en Windows-1252 si l'UTF-8
   échoue (l'export par défaut d'Excel en français) ; le séparateur (`;` ou `,`) est détecté sur la ligne d'en-tête.
   Analyse locale, par un lecteur RFC 4180 écrit dans le projet (aucune dépendance) : le fichier ne quitte pas le
   navigateur.
2. **La correspondance des colonnes** : chaque colonne du fichier est associée à un champ, ou ignorée ; les en-têtes
   usuels sont reconnus d'office (« Nom », « Email », « Téléphone », « Organisation »…).
3. **La prévisualisation** : la base juge chaque ligne **sans rien écrire** (simulation, §6.5) et rend son issue :
   « sera créée », « doublon, ignorée », ou « refusée », avec le motif.
4. **La confirmation** : seules les lignes « sera créée » sont écrites, en une transaction.
5. **Le rapport** : les comptes, et la liste des lignes ignorées ou refusées, téléchargeable en CSV pour corriger et
   réimporter.

### 6.2 Contacts et organisations — depuis le carnet

- **Champs** : nom (obligatoire), email, téléphone, fonction, organisation (nom), domaine de l'organisation.
- **Doublons** : un contact dont l'email existe déjà dans l'espace (sans casse) est **ignoré, jamais écrasé** ; deux
  lignes du fichier au même email : la première seule.
- **Organisation** : retrouvée par son **domaine**, sinon par son **nom** sans casse ni blancs superflus ; **créée** si
  aucune ne correspond. Une organisation peut aussi s'importer seule (nom, domaine, site).
- `contacts.source` vaut **`import`** (valeur déjà prévue par la migration `0045`).
- **Qui** : business developer et administrateur, comme la création d'un contact (`docs/SPEC-contacts.md` §3).

### 6.3 Affaires — depuis la vue liste d'un channel

- **Champs** : titre (obligatoire), étape (par son nom), responsable (par l'email d'un membre), montant, devise, prochaine
  action, échéance, contact (par son email), probabilité.
- **Création** par le chemin de l'écran : `creer_affaire` pour l'affaire et son rattachement, puis les champs du
  rattachement. **L'étape nommée est posée directement** : un import est une création, pas un déplacement, et les
  conditions de transition ne s'appliquent pas (point du §9).
- **Refus par ligne** : étape inconnue du workflow du channel, responsable qui n'est pas membre de l'espace, contact
  introuvable, montant ou date illisibles.
- **Doublons** : une affaire du même titre, sans casse, déjà rattachée à ce channel, est **ignorée**.
- **Qui** : quiconque **écrit le channel** ; la RLS et `creer_affaire` en décident, ligne par ligne.
- Le fil de chaque affaire dit « Affaire créée » au nom de la personne, avec la mention « par import ».

### 6.4 Le journal

Chaque import confirmé écrit **une** entrée dans `audit_log` : famille nouvelle **`import`**, action `imported`, types
`contact`, `organization` ou `card`, `details` : `{created, skipped, refused}`. La liste fermée des familles gagne
`import` (migration).

### 6.5 Les fonctions

`import_contacts(p_workspace uuid, p_rows jsonb, p_dry_run boolean)` et
`import_cards(p_channel uuid, p_rows jsonb, p_dry_run boolean)`, `SECURITY INVOKER` : la RLS de la personne décide de
chaque écriture. Elles rendent une issue par ligne (`created`, `skipped`, `refused` avec un code anglais stable :
`duplicate_email`, `unknown_step`, `not_a_member`…). En simulation, chaque ligne est jugée dans un point de sauvegarde
annulé : la base applique les mêmes contraintes qu'à l'écriture, et rien ne reste.

## 7. Seed

- **Vues** : une vue personnelle de Driss sur « Refonte de site » (« Mes négociations ») ; une vue de l'espace publiée par
  Camille (« Secteur public, par échéance »), qui couvre `CRM-P08`.
- **Import** : un fichier de démonstration `supabase/seed/fichiers/contacts-salon.csv` (dix lignes, dont un doublon et une
  ligne refusée), importé **par la vraie fonction** sous le jeton de Driss ; ses contacts portent `source = import`, et le
  journal d'audit son entrée.
- **Export** : aucune donnée ; l'export se démontre sur le jeu existant.

## 8. Tranches

| Tranche | Contenu | Preuves |
|---|---|---|
| **T1** | `saved_views` en base | pgTAP, API (refus par requête directe : vue d'autrui, publication par un non-administrateur), types |
| **T2** | les vues à l'écran, seed, manuel | design system §5.75, unitaires, E2E, captures |
| **T3** | les vues dans le connecteur | pytest, intégration, E2E |
| **T4** | l'export : fonctions, journal, boutons de la liste et du carnet, manuel | pgTAP, unitaires (format, injection), API, E2E (le fichier téléchargé relu) |
| **T5** | l'import des contacts et des organisations : lecteur CSV, fonction, parcours, journal, seed, manuel | unitaires (lecteur : guillemets, BOM, Windows-1252), pgTAP, API, E2E |
| **T6** | l'import des affaires | pgTAP, API, E2E |

## 9. Points validés (décision 776)

1. **Vues de l'espace** : publiées par les seuls administrateurs ; lues par tout membre qui lit le channel ; aucune vue
   « par défaut » imposée.
2. **Doublons à l'import** : ignorés, **jamais écrasés** ; pas de mise à jour par import.
3. **Organisation d'un contact** : retrouvée par domaine puis par nom, **créée sinon**.
4. **Import d'affaires** : l'étape nommée posée directement, **sans les conditions de transition** ; responsable par l'email
   d'un membre ; affaire du même titre dans le channel ignorée.
5. **Écriture partielle** : à la confirmation, les lignes valides sont écrites et les autres rapportées, plutôt que « tout
   ou rien ».
6. **Bornes** : 1 000 lignes et 2 Mo par import ; 5 000 lignes par export.
7. **Journal** : chaque export et chaque import confirmé entrent dans `audit_log`, avec une famille nouvelle `import`.
8. **Format d'export** : UTF-8 avec BOM, point-virgule, apostrophe devant une cellule à risque de formule.
