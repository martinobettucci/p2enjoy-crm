# Spécification — Tracks

Unité de backlog : `CRM-020` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §2 (organisation), `docs/SPEC-permissions-rls.md` §4 (politiques),
`docs/DESIGN_SYSTEM.md` §1 (couleurs de données), §4 (barre latérale), §5.6 (pilules),
`docs/SPEC-webapp.md` §6.3 (ce que la coquille lit), `docs/SPEC-seed.md` §2 (contrat du seed),
`docs/manual.md`.

Cette spécification est écrite **après mesure** du comportement réel de la pile épinglée —
PostgreSQL `supabase/postgres:17.6.1.136`, PostgREST `v14.12`, GoTrue `v2.189.0` — et non de
mémoire. Les codes et les corps de réponse cités au §6 sont ceux qui ont été **observés** sur une
table sonde jetable, créée puis détruite avant la rédaction (`docs/JOURNAL.md`, décision 52).

---

## 1. Objet et périmètre

Le track est le premier niveau d'organisation à l'intérieur d'un workspace. Il regroupe des
channels (`CRM-021`), qui portent eux-mêmes des cards (`CRM-040`). C'est l'objet que la barre
latérale liste, et celui auquel les droits fins de `track_members` se rattachent.

### 1.1 Dans le périmètre

1. La table `public.tracks`, conforme à `docs/SCHEMA.md` §2.
2. L'**ordre** d'affichage : `position`, numérique, attribuée automatiquement à la création.
3. L'**archivage** : `archived_at`, suppression douce et réversible.
4. Les **politiques RLS** : lecture par les membres du workspace, écriture réservée aux
   administrateurs, prouvées hors interface avec les jetons réels des trois profils seedés.
5. La **section « Tracks » de la barre latérale**, qui lit désormais `public.tracks` au lieu de se
   rabattre sur `public.workspaces`.
6. Le **seed** : quatre tracks de démonstration, dont un archivé.

### 1.2 Hors périmètre, et nommé comme tel

| Ce qui n'est pas livré | Pourquoi, et par qui |
|---|---|
| `app.can_read_track` et la restriction par droit fin | Dépend de la résolution `track_members` → `CRM-012`. La politique de lecture livrée ici s'arrête au **rôle de workspace** ; voir §5.3 et `docs/INCONSISTENCY_REPORT.md` INC-013 et INC-024 |
| Toute **interface de création, de renommage, de réordonnancement ou d'archivage** | Aucun écran d'administration n'est encore rattaché à cette unité. Le CRUD est livré et prouvé **par l'API**, ce que `CLAUDE.md` §10 exige de toute façon |
| L'**ouverture** d'un track (route, onglets) | Un track s'ouvre sur ses channels, livrés par `CRM-021`. Une route sans contenu serait une commande morte |
| La **clé étrangère** `track_members.track_id → tracks.id` | Rétablie par cette unité : voir §2.3. C'est le seul point d'INC-010 que `CRM-020` referme |
| Les **couleurs libres** | `docs/DESIGN_SYSTEM.md` §1 : une couleur de donnée est un **nom de jeton**, jamais un hexadécimal. Contrainte `CHECK`, §2.2 |

## 2. Modèle de données

### 2.1 Table `public.tracks`

| Colonne | Type | Contraintes | Motif |
|---|---|---|---|
| `id` | `uuid` | PK, défaut `gen_random_uuid()` | Convention générale de `docs/SCHEMA.md` |
| `workspace_id` | `uuid` | non nul, FK `workspaces(id)` `ON DELETE CASCADE` | Cloisonnement ; la cascade suit la suppression d'un workspace |
| `name` | `text` | non nul, non vide après `btrim` | Libellé affiché — une **donnée**, pas une traduction (`docs/DESIGN_SYSTEM.md` §10) |
| `slug` | `text` | non nul, `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`, unique par workspace | Identifiant d'URL stable, unique **par workspace** et non globalement (`docs/SCHEMA.md` §2) |
| `description` | `text` | | Facultative |
| `color` | `text` | non nul, défaut `'neutral'`, `CHECK (color IN ('brand','success','accent','danger','neutral'))` | §2.2 |
| `icon` | `text` | non nul, défaut `'folder'`, `CHECK (icon ~ '^[a-z][a-z0-9-]*$')` | Nom d'icône Lucide en kebab-case ; §2.4 |
| `position` | `numeric` | non nul, attribuée par trigger si omise | §3 |
| `archived_at` | `timestamptz` | | §4 |
| `deleted_at` | `timestamptz` | | **Corbeille** — `CRM-077`, `docs/SPEC-corbeille.md` §3.1. INDÉPENDANTE d'`archived_at` : archiver n'est pas supprimer |
| `deleted_by` | `uuid` | FK `profiles` `ON DELETE SET NULL`, **fermée au client** | Qui a mis à la corbeille. Écrite par trigger et refusée au client PAR LE PRIVILÈGE : `UPDATE` est accordé colonne par colonne et l'exclut |
| `created_at` | `timestamptz` | non nul, défaut `now()` | Conventions générales de `docs/SCHEMA.md` |
| `updated_at` | `timestamptz` | non nul, défaut `now()`, maintenue par `app.set_updated_at()` | Idem |

**Écart assumé et consigné.** `docs/SCHEMA.md` §2 n'énumérait ni `created_at` ni `updated_at` pour
`tracks`, alors que ses « Conventions générales » les exigent de toute table. Les deux colonnes sont
livrées, et `docs/SCHEMA.md` §2 est mis à jour **dans le même changement** : l'omission était une
lacune du tableau, non une décision. Consignée en `docs/INCONSISTENCY_REPORT.md`, INC-025.

### 2.2 `color` est un nom de jeton, pas une couleur

`docs/DESIGN_SYSTEM.md` §1, « Couleurs de données » : « Les tracks et les nœuds de workflow portent
une couleur, choisie parmi les jetons ci-dessus et stockée sous forme de **nom de jeton**
(`brand`, `success`, `accent`, `danger`, `neutral`), jamais d'hexadécimal libre. »

La contrainte `CHECK` traduit cette règle **en base**, où elle est opposable, plutôt que dans un
composant, où un appel d'API la contournerait. Le défaut est `neutral` et non `brand` : le bleu
primaire est réservé par le §1 aux actions primaires, aux liens et au **track actif** ; un track
qui n'a pas choisi sa couleur ne doit pas revendiquer celle de l'état actif.

Corollaire d'interface : « Une couleur ne porte jamais seule une information » (§1). La pilule de
track affiche donc toujours son **icône** et son libellé, jamais la seule couleur.

### 2.3 La clé étrangère différée par INC-010 est rétablie

`CRM-003` avait créé `public.track_members` sans clé étrangère vers `tracks`, la table n'existant
pas encore (`docs/INCONSISTENCY_REPORT.md`, INC-010). Cette unité la pose :

```sql
alter table public.track_members
	add constraint track_members_track_id_fkey
	foreign key (track_id) references public.tracks (id) on delete cascade;
```

`ON DELETE CASCADE` : un droit fin n'a aucun sens sans son track. La contrainte est ajoutée de
façon idempotente — le `migrations-runner` rejoue le répertoire à chaque démarrage
(`docs/SCHEMA.md`, conventions générales).

**Condition d'application, mesurée et non supposée** : `track_members` est vide sur toute base du
projet (le seed n'y écrit rien, `docs/SPEC-seed.md` §2). Si une ligne orpheline existait, l'ajout de
la contrainte échouerait et **empêcherait le démarrage de la pile**. La migration ne masque pas ce
risque : elle le nomme dans son commentaire, et `docs/PROD_MIGRATIONS.md` en fait un point de
vérification avant application en production.

### 2.4 `icon`

Nom d'icône Lucide, en kebab-case (`folder`, `graduation-cap`, `layout-dashboard`). La contrainte
`CHECK` vérifie la **forme**, pas l'existence : la liste des icônes de Lucide change d'une version
à l'autre, et une contrainte énumérative en base deviendrait fausse au premier `npm update` sans
qu'aucune migration ne le signale.

L'existence est donc traitée **dans l'interface**, par un catalogue explicite
(`webapp/src/app/icones-tracks.ts`) et un repli documenté vers `Folder`. Un nom inconnu produit une
icône neutre, jamais un écran vide ni une exception.

## 3. Ordre

`position` est un `numeric`, non un entier : `docs/SCHEMA.md` §5 emploie déjà un « index
fractionnaire » pour le glisser-déposer des cards, et le même choix ici permettra d'insérer un
track entre deux autres sans renuméroter toute la liste.

**Attribution automatique.** Un client qui omet `position` obtient la position suivante dans son
workspace :

```sql
new.position := coalesce(
	new.position,
	(select coalesce(max(t.position), 0) + 1 from public.tracks t
	  where t.workspace_id = new.workspace_id)
);
```

Le trigger est `BEFORE INSERT`. **Mesuré** : un trigger `BEFORE INSERT` renseigne bien une colonne
`NOT NULL` *avant* que la contrainte ne soit vérifiée — deux insertions successives sans `position`
ont rendu `1` puis `2`. La colonne peut donc rester `NOT NULL` sans défaut de colonne.

**Correction apportée par la première exécution de la suite pgTAP.** Cette section affirmait
d'abord qu'un client ne pourrait pas écrire `NULL` explicitement. **C'est faux**, et l'assertion
correspondante a échoué : un trigger `BEFORE INSERT` reçoit `new.position` à `NULL` dans les deux
cas et **ne peut pas distinguer** l'omission de la négation. Écrire `position: null` à l'insertion
équivaut donc à l'omettre, et le trigger place le track en fin de liste.

C'est la spécification qui a été corrigée, non l'assertion ajustée. La protection subsiste après la
création : le trigger ne couvrant que l'insertion, un `UPDATE ... SET position = NULL` se heurte
bien à la contrainte `NOT NULL` (`23502`), ce que la suite vérifie séparément.

L'ordre d'affichage est `position` croissante, puis `name` à position égale : deux tracks de même
position ne doivent pas s'échanger d'un chargement à l'autre.

## 4. Archivage

`archived_at` non nul = track archivé : **masqué, réversible** (`docs/SCHEMA.md`, conventions
générales).

- La barre latérale n'affiche que les tracks **non archivés** (`archived_at is null`).
- L'archivage et le désarchivage sont de simples `UPDATE`, donc soumis à la politique d'écriture :
  réservés aux administrateurs du workspace.
- **La suppression physique n'est pas exposée.** `DELETE` n'est accordé ni à `anon` ni à
  `authenticated` : la suppression du produit est l'archivage, et « la suppression physique est
  réservée aux purges RGPD » (`docs/SCHEMA.md`, conventions générales). Le refus est mesuré au §6,
  ligne *i*.

## 5. Autorisations

### 5.1 Règle

`docs/SPEC-permissions-rls.md` §4 : lecture par `app.can_read_track`, écriture par `admin`.

| Opération | Autorisée à | Fonction |
|---|---|---|
| `SELECT` | tout membre du workspace | `app.is_workspace_member(workspace_id)` |
| `INSERT` | administrateur du workspace | `app.is_workspace_admin(workspace_id)` en `WITH CHECK` |
| `UPDATE` | administrateur du workspace | `app.is_workspace_admin(workspace_id)` en `USING` **et** en `WITH CHECK` |
| `DELETE` | personne, via l'API | aucun privilège accordé (§4) |

`WITH CHECK` sur l'`UPDATE` n'est pas une redondance : sans lui, un administrateur du workspace A
pourrait **déplacer** un track vers le workspace B, où il n'a aucun droit. Le refus est mesuré au
§6, ligne *l*.

### 5.2 Privilèges de table

`SELECT` est accordé à `anon` **et** `authenticated`, comme sur les tables du socle : un refus de
lecture doit se manifester par **zéro ligne** et non par une erreur de privilège
(`docs/SPEC-permissions-rls.md` §7, dernier paragraphe). `INSERT` et `UPDATE` vont à
`authenticated` seul, `service_role` conserve tout.

### 5.3 Les droits fins sont appliqués depuis `CRM-012`

La politique de lecture s'appuyait sur `app.is_workspace_member` et s'arrêtait au rôle de
workspace : un `track_members.access = 'none'` ne masquait rien. C'était l'écart INC-024, figé par
une assertion plutôt que commenté.

**`CRM-012` l'a soldé.** La lecture s'appuie désormais sur `app.can_read_track`
(`docs/SPEC-permissions-rls.md` §3.3), qui applique les droits fins. Le tableau du §5.1 devient :

| Opération | Autorisée à | Fonction |
|---|---|---|
| `SELECT` | tout membre du workspace **dont le droit fin ne l'écarte pas** | `app.can_read_track(id)` |
| `INSERT` / `UPDATE` | administrateur du workspace | `app.is_workspace_admin(workspace_id)`, inchangé |

MESURÉ : le viewer du seed, porteur d'un `access = 'none'` sur « Conseil & IA », voit trois tracks
au lieu de quatre ; l'administratrice, porteuse du **même** droit fin, en voit quatre. L'assertion
qui figeait l'écart est devenue rouge comme prévu et a été **révisée**, non retirée
(`docs/JOURNAL.md` décision 51, huitième occurrence).

L'écriture n'est pas touchée : elle reste réservée à l'administrateur, qu'un droit fin ne restreint
jamais.

## 6. Contrat d'API — mesuré

Observé sur la pile réellement démarrée, avec les jetons des trois comptes seedés obtenus par la
véritable route de connexion. `A` désigne le workspace du seed, `B` un second workspace créé pour
la mesure.

| # | Appelant et opération | Code | Corps |
|---|---|---|---|
| b | `anon` lit les tracks de A | `200` | `[]` — refus par zéro ligne |
| c | `admin` de A lit les tracks de A | `200` | les lignes, dans l'ordre de `position` |
| d | `viewer` de A lit les tracks de A | `200` | les mêmes lignes : lire n'exige pas d'écrire |
| e | `viewer` insère un track dans A | `403` | `42501`, `new row violates row-level security policy` |
| f | `business_developer` insère un track dans A | `403` | idem — l'organisation est une prérogative d'administration |
| g | `admin` de A insère un track dans A, sans `position` | `201` | la ligne, `position` attribuée automatiquement |
| h | `admin` réinsère le même `slug` dans A | `409` | `23505`, violation de l'unicité `(workspace_id, slug)` |
| i | `admin` supprime un track | `403` | `42501`, `permission denied for table tracks` |
| j | `admin` de A lit les tracks de B | `200` | `[]` — **preuve de refus n° 3** au niveau des tracks |
| k | `admin` de A insère un track dans B | `403` | `42501` |
| l | `admin` de A déplace son track vers B | `403` | `42501` — refus du `WITH CHECK` |
| m | `admin` de A archive son track | `200` | `archived_at` renseignée |

**Constat associé, non corrigé et consigné** : le corps du refus *i* porte un `hint` de PostgREST
qui indique la commande `GRANT` à exécuter pour lever le refus. C'est le comportement de
PostgREST `v14.12`, non un choix du produit. Le fait est nommé en `docs/INCONSISTENCY_REPORT.md`,
INC-026 : il ne divulgue aucun secret, mais il renseigne un appelant sur la forme du schéma.

## 7. Ce que la barre latérale lit

La section « Tracks » de `docs/DESIGN_SYSTEM.md` §4 lisait `public.workspaces` faute de mieux
(`CRM-007`, `docs/SPEC-webapp.md` §6.3). Elle lit désormais :

```
GET /rest/v1/tracks?select=id,name,slug,color,icon,position&archived_at=is.null&order=position,name
```

Les quatre états de `docs/DESIGN_SYSTEM.md` §5.8 restent traités par le contrat asynchrone commun
(`docs/SPEC-webapp.md` §6.4) : chargement en squelettes, vide, erreur avec reprise réelle, refus.

**Ce que l'écran affiche aujourd'hui, et pourquoi.** Sans session, la lecture rend `200` et `[]` :
la barre latérale montre son état vide réel. Depuis `CRM-009`, la session est
restaurée avant cette lecture et un membre voit les tracks que la RLS lui consent. La preuve
connectée constate les trois tracks du seed, sans réponse substituée.

### 7.1 Rendu d'une pilule de track

`docs/DESIGN_SYSTEM.md` §5.6 : `rounded-full`, fond de la couleur à 10–15 %, texte à la couleur
pleine, **précédé d'une icône**. La correspondance jeton → classes est unique et centralisée ;
`neutral` emploie les neutres existants (`--color-hover`, `--color-text-2`) plutôt qu'un nouveau
jeton, le design system n'en déclarant pas de « neutre doux ».

Les tracks ne sont **pas** cliquables à ce stade : ils s'ouvrent sur leurs channels, livrés par
`CRM-021`. Une pilule cliquable menant à une route vide serait une commande morte
(`docs/DESIGN_SYSTEM.md` §8, « les états désactivés expliquent pourquoi l'action est
indisponible »).

## 8. Seed

`docs/SPEC-seed.md` §2 est étendu de quatre tracks dans le workspace du seed, identifiants stables
`5eed0000-0000-4000-8000-0000000000 2x` :

| id | slug | nom | couleur | icône | position | état |
|---|---|---|---|---|---|---|
| `…021` | `conseil-ia` | Conseil & IA | `brand` | `sparkles` | 1 | actif |
| `…022` | `studio-web` | Studio web | `success` | `layout-dashboard` | 2 | actif |
| `…023` | `formation` | Formation | `accent` | `graduation-cap` | 3 | actif |
| `…024` | `pipeline-2024` | Pipeline 2024 | `neutral` | `archive` | 4 | **archivé** |

Le quatrième existe pour que l'état « archivé » soit démontrable, et non seulement documenté
(`CLAUDE.md` §8 : « couvrir les principaux états »). Les quatre couleurs couvrent quatre des cinq
jetons ; `danger` est laissé libre, aucune activité ne se décrivant honnêtement comme « en
danger » par défaut.

Ils sont créés par **l'API REST avec la clé de service**, comme le workspace et les appartenances
du seed socle (`docs/SPEC-seed.md` §3, décision 32), et l'écriture est **convergente** :
`Prefer: resolution=merge-duplicates`.

## 9. Preuves attendues

| Preuve | Support |
|---|---|
| Structure, contraintes, RLS, politiques, privilèges, triggers | `supabase/tests/0004_tracks.test.sql` (pgTAP) |
| Ordre attribué, unicité par workspace, couleur contrainte | idem |
| Écart de droit fin figé par une assertion | idem, §5.3 |
| Les douze lignes du §6, avec les jetons réels | `e2e/api/tracks.spec.ts` (projet Playwright `api`) |
| Lecture, états et rendu de la pilule | `webapp/src/lib/tracks.test.ts`, `webapp/src/app/SectionTracks.test.tsx` |
| Barre latérale réelle, quatre paliers, captures | `e2e/ui/tracks.spec.ts` |
| Rejeu complet et non-complaisance | `scripts/verify-tracks.sh` |

Le harnais est **non complaisant** : il dégrade réellement le produit — politique d'écriture
relâchée, contrainte de couleur retirée, seed faussé — et exige que les preuves échouent, puis
restaure et constate le retour au vert.

## 10. Limites connues

1. ~~Aucune interface d'administration des tracks~~ — **livrée par `CRM-075`** (INC-086, arbitrage
   du 2026-08-11, option 2) : « Réglages ▸ Arborescence » porte créer, renommer, réordonner,
   archiver et désarchiver, prouvés au clavier et à la souris
   (`docs/SPEC-administration-arborescence.md`). Cette limite est conservée barrée, comme trace de
   ce qui a été vrai, plutôt que retirée en silence.
2. **Aucun track visible dans l'interface**, pour la même raison : l'appelant est anonyme.
3. **Les droits fins ne sont pas appliqués** (§5.3, INC-024) — `CRM-012`.
4. **Le réordonnancement n'a pas de RPC dédiée** : réordonner, c'est écrire `position`. Une
   opération atomique de réordonnancement de liste deviendra nécessaire avec le glisser-déposer,
   qui relève de `CRM-041`.
5. **Aucune limite de nombre de tracks par workspace** n'est posée. La barre latérale défile ; une
   pagination n'aurait pas de sens à cette échelle, mais rien ne borne le nombre côté serveur.
6. **`icon` n'est pas validé contre Lucide** en base (§2.4). Un nom inexistant est accepté puis
   replié sur `Folder` par l'interface.
