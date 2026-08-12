# Spécification — Channels

Unité de backlog : `CRM-021` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §2 (organisation), `docs/SPEC-permissions-rls.md` §4 (politiques),
`docs/SPEC-tracks.md` (le parent), `docs/DESIGN_SYSTEM.md` §4 (onglets), §12.1 (barre d'onglets),
§12.4 (pilules de track), `docs/SPEC-webapp.md` §5.2 (routes), §6.3 (ce que la coquille lit),
`docs/SPEC-seed.md` §2 (contrat du seed), `docs/manual.md`.

Cette spécification est écrite **après mesure** du comportement réel de la pile épinglée —
PostgreSQL `supabase/postgres:17.6.1.136`, PostgREST `v14.12`, GoTrue `v2.189.0` — et non de
mémoire. Les codes et les corps de réponse cités au §7 sont ceux qui ont été **observés** sur une
table sonde jetable, `public.sonde_channels`, créée puis détruite avant la rédaction, selon le même
procédé que `CRM-020` (`docs/JOURNAL.md`, décision 52).

---

## 1. Objet et périmètre

Le channel est le second niveau d'organisation. Il appartient à un track (`CRM-020`), porte un
workflow (`CRM-031`) et contient des cards (`CRM-040`). C'est l'objet que la **barre d'onglets**
liste, et celui auquel les droits fins de `channel_members` se rattachent.

### 1.1 Dans le périmètre

1. La table `public.channels`, conforme à `docs/SCHEMA.md` §2, aux réserves du §2.5 près.
2. L'**ordre** d'affichage des onglets : `position`, numérique, attribuée automatiquement **par
   track**.
3. L'**archivage** : `archived_at`, suppression douce et réversible.
4. La **cohérence du cloisonnement** : un channel ne peut pas déclarer un `workspace_id` différent
   de celui de son track. Garantie par une clé étrangère **composite**, §2.4.
5. Les **politiques RLS** : lecture par les membres du workspace, écriture réservée aux
   administrateurs, prouvées hors interface avec les jetons réels des trois profils seedés.
6. La **clé étrangère `channel_members.channel_id → channels.id`**, dernière moitié d'INC-010.
7. La **route d'un track** — `/tracks/:slug` — et la **barre d'onglets réelle**, qui remplace
   l'état vide temporaire de `CRM-007` (`docs/DESIGN_SYSTEM.md` §12.1).
8. Les **pilules de track deviennent des liens** : `CRM-020` les avait laissées inertes faute de
   destination (`docs/DESIGN_SYSTEM.md` §12.4). La destination existe désormais.
9. Le **seed** : des channels de démonstration dans les tracks du seed, dont un archivé.

### 1.2 Hors périmètre, et nommé comme tel

| Ce qui n'est pas livré | Pourquoi, et par qui |
|---|---|
| La **clé étrangère `workflow_id → workflows`**, et la contrainte `NOT NULL` que `docs/SCHEMA.md` §2 exige | La table `workflows` n'existe pas : elle est livrée par `CRM-031`, placée **après** `CRM-021` dans `docs/MASTER_PLAN.md` §2. Contradiction d'ordonnancement consignée en `docs/INCONSISTENCY_REPORT.md`, **INC-029**. Voir §2.5 |
| Le **trigger de cohérence `workflow_id`** — workflow `global` du workspace, ou `track` du track du channel | Explicitement rattaché à `CRM-033` par la Definition of Done de `CRM-021` (« plus le trigger de cohérence du workflow (`CRM-033`) **une fois disponible** ») |
| `app.can_read_channel` et `app.can_write_channel`, donc la restriction par droit fin | Deux des quatre fonctions différées par INC-013, dont l'arbitrage appartient au responsable et **reste ouvert**. La politique de lecture livrée ici s'arrête au **rôle de workspace** ; voir §6.3 et `docs/INCONSISTENCY_REPORT.md` **INC-030** |
| Toute **interface de création, de renommage, de réordonnancement ou d'archivage** d'un channel | Aucun écran d'administration n'est encore rattaché à cette unité. Le CRUD est livré et prouvé **par l'API**, ce que `CLAUDE.md` §10 exige de toute façon |
| Le **contenu** d'un channel — board, vue liste, cards | `CRM-040` à `CRM-042`. La route d'un track affiche ses onglets et l'état vide de la zone principale, pas un board fantôme |
| Le **glisser-déposer de réordonnancement** des onglets | Même motif que pour les tracks : réordonner, c'est écrire `position`. Une RPC atomique deviendra nécessaire avec `CRM-041` |

## 2. Modèle de données

### 2.1 Table `public.channels`

| Colonne | Type | Contraintes | Motif |
|---|---|---|---|
| `id` | `uuid` | PK, défaut `gen_random_uuid()` | Convention générale de `docs/SCHEMA.md` |
| `workspace_id` | `uuid` | non nul, FK `workspaces(id)` `ON DELETE CASCADE` | Cloisonnement. Dénormalisé, et **rendu véridique** par la clé composite du §2.4 |
| `track_id` | `uuid` | non nul | Parent. La clé étrangère est portée par la contrainte composite du §2.4, pas par une clé simple |
| `name` | `text` | non nul, non vide après `btrim` | Libellé affiché — une **donnée**, pas une traduction (`docs/DESIGN_SYSTEM.md` §10) |
| `slug` | `text` | non nul, `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`, **unique par track** | `docs/SCHEMA.md` §2 : « unique par track ». Deux tracks peuvent porter un channel `prospection` sans se gêner |
| `description` | `text` | | Facultative |
| `workflow_id` | `uuid` | **nullable, sans clé étrangère** — écart assumé, §2.5 | `docs/SCHEMA.md` §2 l'exige `non nul` avec FK. La table `workflows` n'existe pas encore : INC-029 |
| `position` | `numeric` | non nul, attribuée par trigger si omise, **portée du track** | §3 |
| `archived_at` | `timestamptz` | | §4 |
| `created_at` | `timestamptz` | non nul, défaut `now()` | Conventions générales de `docs/SCHEMA.md` |
| `updated_at` | `timestamptz` | non nul, défaut `now()`, maintenue par `app.set_updated_at()` | Idem |

**Ce que cette table ne porte pas, et pourquoi.** Ni `color`, ni `icon`. `docs/SCHEMA.md` §2 ne les
énumère pas pour `channels`, et rien ne les appelle : un onglet se distingue par son libellé et par
son état actif, pas par une couleur. `docs/DESIGN_SYSTEM.md` §1 réserve d'ailleurs la couleur de
donnée « aux tracks et aux nœuds de workflow » — les nommer tous les deux, et pas les channels,
n'est pas une omission mais une position.

### 2.2 `created_at` et `updated_at` : la seconde moitié d'INC-025

`docs/SCHEMA.md` §2 n'énumérait ces deux colonnes ni pour `tracks`, ni pour `channels`, alors que
ses « Conventions générales » les exigent de toute table. `CRM-020` a corrigé le tableau de
`tracks` et a **explicitement laissé** celui de `channels` à `CRM-021`, pour ne pas modifier la
spécification d'une unité non commencée (INC-025).

Cette unité livre les deux colonnes et met à jour le tableau de `channels` dans le même changement.
**INC-025 est refermée** : ses deux moitiés sont traitées.

### 2.3 La clé étrangère différée par INC-010 est rétablie — INC-010 se referme

`CRM-003` avait créé `public.channel_members` sans clé étrangère vers `channels`, la table
n'existant pas encore. `CRM-020` a posé celle de `track_members` ; celle-ci pose la seconde :

```sql
alter table public.channel_members
	add constraint channel_members_channel_id_fkey
	foreign key (channel_id) references public.channels (id) on delete cascade;
```

`ON DELETE CASCADE` : un droit fin n'a aucun sens sans son channel.

**Condition d'application, mesurée et non supposée** : `channel_members` est vide sur toute base du
projet — le seed n'y écrit rien (`docs/SPEC-seed.md` §2). Si une ligne orpheline existait, l'ajout
échouerait et **empêcherait le démarrage de la pile**, PostgREST attendant la terminaison réussie du
`migrations-runner`. La migration ne masque pas ce risque : elle le nomme, et
`docs/PROD_MIGRATIONS.md` §3 en fait un point de vérification avant application en production —
même traitement que `CRM-020` (décision 55).

**INC-010 est refermée par cette unité** : les deux clés étrangères différées sont posées.

### 2.4 Le cloisonnement est garanti par une clé étrangère **composite**

`docs/SCHEMA.md`, conventions générales : « Toute table métier porte `workspace_id`, y compris
lorsqu'il serait déductible par jointure : les politiques RLS restent ainsi simples et
indexables. » Une dénormalisation acceptée pour la RLS.

Le danger d'une dénormalisation est qu'elle **mente**. Si `channels.workspace_id` pouvait différer
du `workspace_id` du track désigné par `channels.track_id`, la politique de lecture — qui interroge
`channels.workspace_id` — cloisonnerait selon une valeur fausse. Le channel d'un track du workspace
A serait lisible par les membres de B, avec des politiques pourtant correctes. Aucune règle RLS ne
peut rattraper cela : elle ferait confiance à la donnée.

La contrainte est donc posée **en base**, et pas seulement espérée :

```sql
alter table public.tracks
	add constraint tracks_id_workspace_id_key unique (id, workspace_id);

alter table public.channels
	add constraint channels_track_id_workspace_id_fkey
	foreign key (track_id, workspace_id)
	references public.tracks (id, workspace_id) on delete cascade;
```

**Mesuré, et non déduit** — trois observations sur la sonde :

1. sans `unique (id, workspace_id)` sur `tracks`, la clé composite est refusée à la création :
   `there is no unique constraint matching given keys for referenced table "tracks"`. La contrainte
   d'unicité n'est donc pas décorative, elle est la condition de la garantie ;
2. avec elle, l'insertion d'un channel dont `workspace_id` ne correspond pas à celui de son track
   est refusée en `23503`, `Key (track_id, workspace_id)=(…) is not present in table "tracks"` ;
3. un `workspace_id` cohérent passe.

Cette contrainte **remplace** la clé étrangère simple `track_id → tracks(id)` : elle la contient.
Une seconde clé simple serait redondante et coûterait une vérification supplémentaire à chaque
écriture.

**Effet sur `tracks`, assumé et borné.** Cette unité ajoute une contrainte d'unicité à une table
livrée par `CRM-020`. L'ajout est **additif et idempotent** : `(id)` étant déjà la clé primaire,
`(id, workspace_id)` est unique par construction et ne peut refuser aucune ligne existante ni
future. Ce qu'il change est le **catalogue** — un index d'unicité supplémentaire —, ce que la suite
pgTAP de `CRM-020` observe. Si l'une de ses assertions énumère les contraintes de `tracks`, elle
deviendra rouge et sera étendue **dans le même changement**, jamais contournée (décision 51).

### 2.5 `workflow_id` : écart assumé, consigné, et figé par une assertion

`docs/SCHEMA.md` §2 décrit `channels.workflow_id` comme `uuid`, **`FK workflows`, non nul**. La
table `workflows` est livrée par `CRM-031`, que `docs/MASTER_PLAN.md` §2 place au chunk 3.b —
**après** `CRM-021`, qui est au 3.a. Mesuré : `to_regclass('public.workflows')` rend `NULL` sur la
base migrée du projet.

C'est une contradiction d'ordonnancement du même genre qu'INC-010 et INC-013, et elle est traitée
de la même façon : `CRM-021` livre **ce qui est démontrable aujourd'hui, et rien de plus**.

| Aspect | Livré ici | Différé, et par qui |
|---|---|---|
| La colonne `workflow_id uuid` | oui | — |
| La clé étrangère vers `workflows` | non | `CRM-031` — **livrée**, et composite |
| La contrainte `NOT NULL` | non | `CRM-031` s'y est refusée : elle change le contrat de création d'un channel. **`CRM-033`** |
| Le trigger de cohérence workflow ↔ track | non | `CRM-033`, comme la DoD de `CRM-021` le prévoit déjà |

**Mise à jour, `CRM-033`.** Les deux lignes différées sont soldées par cette unité, et le contrat de
création d'un channel change avec elles : **désigner un workflow devient obligatoire**, et le
workflow désigné doit être `global` ou rattaché au **track du channel**. Le §7 ci-dessous est
complété des lignes correspondantes, et le §8 décrit l'ordre nouveau du seed — le workflow par défaut
naît avant les channels, qui naissent donc rattachés. La règle, ses quatre portes mesurées et son
contrat d'API sont écrits dans `docs/SPEC-workflow-engine.md` §4.12, qui les porte pour les deux
tables concernées plutôt que de les répartir entre deux documents.

**Pourquoi livrer la colonne plutôt que l'omettre.** Trois raisons, et une seule aurait suffi :

1. la colonne fait partie de l'identité du channel dans `docs/SCHEMA.md` §2 ; l'omettre ferait
   diverger le dépôt de sa propre référence de schéma, alors que la livrer ne fait que différer
   deux contraintes ;
2. les types générés de `CRM-006` la porteront, et le code qui viendra la lire n'aura pas à être
   réécrit ;
3. le coût de reprise est **identique** dans les deux cas : qu'elle soit absente ou nulle, les
   lignes créées d'ici `CRM-031` devront être renseignées avant que `NOT NULL` puisse être posée.

**Ce qui protège l'écart.** Il n'est pas seulement commenté, il est **figé par des assertions** de
`supabase/tests/0005_channels.test.sql` : la suite constate que `workflow_id` est nullable, qu'elle
ne porte aucune clé étrangère, et que `public.workflows` n'existe pas. Le jour où `CRM-031` livrera
la table, ces trois assertions deviendront rouges et **forceront** la reprise de cette section — le
même procédé que la décision 51.

**Risque résiduel, nommé.** Un channel sans workflow n'a pas d'étapes, donc pas de board. Ce risque
est **borné à la fenêtre `CRM-021` → `CRM-031`** : les cards n'existent pas avant `CRM-040`, qui
vient après les deux. Aucun parcours utilisateur ne peut donc buter sur un channel sans workflow
dans cette fenêtre.

Consigné en `docs/INCONSISTENCY_REPORT.md`, **INC-029**, avec trois options d'arbitrage.

## 3. Ordre des onglets

`position` est un `numeric`, comme celle des tracks et des cards : un index fractionnaire permet
d'insérer un onglet entre deux autres sans renuméroter la barre entière.

**Attribution automatique, dans la portée du track** :

```sql
new.position := coalesce(
	new.position,
	(select coalesce(max(c.position), 0) + 1 from public.channels c
	  where c.track_id = new.track_id)
);
```

La portée est le **track**, non le workspace. Les onglets d'un track forment une barre à eux seuls ;
compter à l'échelle du workspace ferait dépendre la numérotation d'un track de l'activité d'un
autre, et produirait des barres commençant à 7 ou à 12 sans que rien ne l'explique.

**Mesuré sur la sonde** : trois insertions sans `position` — deux dans `conseil-ia`, une dans
`studio-web` — rendent `1`, `2` et `1`. La numérotation redémarre bien à chaque track.

**Ce que `CRM-020` a appris, et qui vaut ici.** Un trigger `BEFORE INSERT` reçoit `new.position` à
`NULL` que le client l'ait **omise** ou écrite explicitement : il ne peut pas distinguer les deux
cas. Écrire `position: null` à l'insertion équivaut donc à l'omettre, et place le channel en fin de
barre. La contrainte `NOT NULL` protège en revanche les mises à jour, que le trigger ne couvre pas.
Cette propriété est reprise telle quelle, sans être redécouverte (`docs/SPEC-tracks.md` §3).

L'ordre d'affichage est `position` croissante, puis `name` à position égale : deux channels de même
position ne doivent pas s'échanger d'un chargement à l'autre.

## 4. Archivage

`archived_at` non nul = channel archivé : **masqué, réversible**.

- La barre d'onglets n'affiche que les channels **non archivés** (`archived_at is null`).
- L'archivage et le désarchivage sont de simples `UPDATE`, donc réservés aux administrateurs.
- **La suppression physique n'est pas exposée** : `DELETE` n'est accordé ni à `anon` ni à
  `authenticated`. Le refus est mesuré au §7, ligne *i*. Même position que pour les tracks
  (`docs/SPEC-tracks.md` §4).

L'archivage d'un **track** ne masque pas explicitement ses channels : le track disparaît de la barre
latérale, donc sa route n'est plus atteignable depuis l'interface. Aucun `UPDATE` en cascade n'est
écrit — il rendrait le désarchivage du track ambigu, ne sachant plus lesquels de ses channels
étaient archivés avant lui.

## 5. Ce que la barre d'onglets lit

`docs/DESIGN_SYSTEM.md` §4 : « Onglets : les channels du track courant. » Le track courant est
désormais porté par la route.

```
GET /rest/v1/channels?select=id,name,slug,position,workflow_id&track_id=eq.<id>&archived_at=is.null&order=position,name
```

La requête est **filtrée côté serveur** sur `track_id` : rapporter les channels de tous les tracks
pour n'en afficher qu'une barre ferait transiter des lignes que l'écran ne montrera jamais.

**`workflow_id` a rejoint la sélection à `CRM-041`, et le motif de son absence a disparu avec la
donnée.** `CRM-021` l'écartait en écrivant qu'elle « est de surcroît nul partout jusqu'à `CRM-031`
(INC-029) — le demander donnerait l'illusion d'une donnée exploitable ». MESURÉ le 2026-08-05 : les
six channels du seed portent un workflow, et la colonne est `NOT NULL` depuis `CRM-033`. Le board
en a besoin pour composer ses colonnes (`docs/SPEC-workflow-engine.md` §7.2) ; il la lit **ici**,
dans la lecture déjà émise par la coquille, plutôt que par une seconde lecture des mêmes lignes.
C'est la règle du §5.4 ci-dessous, appliquée à une colonne au lieu d'une route.

### 5.1 La route d'un track

`/tracks/:slug`. Le slug, et non l'identifiant : `docs/SCHEMA.md` §2 le décrit comme
« identifiant d'URL stable », et une URL lisible se partage.

Le track est résolu par une requête sur son slug. Trois issues, toutes explicites
(`docs/DESIGN_SYSTEM.md` §5.8) :

| Situation | Écran |
|---|---|
| Track trouvé | Barre d'onglets de ses channels, titre de route = nom du track |
| Aucun track pour ce slug | État « track introuvable », avec un retour vers l'accueil |
| Échec de chargement | État d'erreur commun, avec reprise **réelle** (`docs/SPEC-webapp.md` §6.4) |

Le second cas n'est pas hypothétique : un appelant anonyme ou privé du track n'obtient aucune ligne.
C'est le refus réel du backend, mesuré au §7 ligne *b*. Depuis `CRM-011`, un membre peut ouvrir les
routes et channels que la même politique lui consent.

### 5.2 Les pilules de track deviennent des liens

`docs/DESIGN_SYSTEM.md` §12.4 posait, comme écart **temporaire** de `CRM-020` : « chaque pilule est
un élément de liste, non un lien […] Le lien arrivera avec la destination. » La destination est
livrée ici : l'écart est **refermé**, et le §12.4 mis à jour dans le même changement.

Chaque pilule devient un `NavLink` vers `/tracks/:slug`, conservant l'icône, la couleur douce et le
libellé du §5.5 bis. L'état actif emprunte à la navigation transverse existante et se signale par
autre chose que la couleur seule — `aria-current="page"` —, faute de quoi l'information reposerait
sur la seule couleur, ce que `docs/DESIGN_SYSTEM.md` §1 interdit.

### 5.3 La barre d'onglets obtient son patron ARIA réel

`docs/DESIGN_SYSTEM.md` §12.1 posait, comme écart **temporaire** de `CRM-007` : « Tant qu'aucun
channel n'existe (`CRM-021`), la barre d'onglets affiche son état vide au lieu d'un `tablist` sans
onglet […] Le patron ARIA complet arrive avec les onglets réels et leurs preuves. »

Les onglets réels arrivent ici. La barre devient une **navigation par liens**, non un `tablist` :

- un `tablist` décrit des panneaux qui s'échangent **dans la même page**, sans changer d'adresse ;
- nos onglets changent l'URL et le contenu principal — ce sont des liens de navigation, et les
  annoncer comme des onglets décrirait un comportement qui n'est pas celui du produit.

Le patron retenu est donc `nav` + liste de `NavLink`, avec `aria-current="page"` sur l'onglet
courant. Le §12.1 est mis à jour : l'écart temporaire devient une **position motivée**, ce qui n'est
pas la même chose qu'un écart refermé, et le document doit le dire.

Le **débordement horizontal** exigé par `docs/DESIGN_SYSTEM.md` §4 (« défilable, jamais tronqué
sans indication ») et §7 (« la page ne défile jamais horizontalement ») reste porté par le
conteneur, déjà en `overflow-x-auto` depuis `CRM-007`.

Lorsqu'un track n'a **aucun** channel, la barre affiche son état vide, comme aujourd'hui.

### 5.4 La barre d'onglets ne s'arrête pas à la route d'un track — `CRM-037`, 2026-08-05

Le §5 ci-dessus dit « le track courant est désormais porté par la route », et `CRM-021` n'avait
qu'une route porteuse : `/tracks/:slugTrack[/:slugChannel]`. Une seconde est arrivée depuis —
`/tracks/:slugTrack/:slugChannel/cards/:idCard` (`docs/SPEC-form-composer.md` §4.6) —, et elle
porte le même track courant.

**Règle générale, écrite ici parce qu'elle vaut pour toute route à venir :** toute route dont
l'adresse porte un `slugTrack` alimente la barre d'onglets par le chargeur de ce chapitre, et
aucune ne réécrit sa propre lecture des channels. Les routes transverses — Inbox, Ma journée,
Réglages — n'en portent pas et gardent l'état vide, qui n'est pas un cas d'erreur.

Le détail de ce que la coquille montre autour du formulaire d'une card, et de ce qu'elle fait d'un
échec de chargement, est écrit là où vit cet écran : `docs/SPEC-form-composer.md` §4.6 bis.

## 6. Autorisations

### 6.1 Règle

`docs/SPEC-permissions-rls.md` §4 : lecture par `app.can_read_channel`, écriture par `admin`.

| Opération | Autorisée à | Fonction |
|---|---|---|
| `SELECT` | tout membre du workspace | `app.is_workspace_member(workspace_id)` |
| `INSERT` | administrateur du workspace | `app.is_workspace_admin(workspace_id)` en `WITH CHECK` |
| `UPDATE` | administrateur du workspace | `app.is_workspace_admin(workspace_id)` en `USING` **et** en `WITH CHECK` |
| `DELETE` | personne, via l'API | aucun privilège accordé (§4) |

`WITH CHECK` sur l'`UPDATE` n'est pas une redondance : sans lui, un administrateur du workspace A
pourrait déplacer un channel vers le workspace B. Le refus est mesuré au §7, ligne *l*.

### 6.2 Privilèges de table

`SELECT` est accordé à `anon` **et** `authenticated`, comme sur `tracks` : un refus de lecture doit
se manifester par **zéro ligne** et non par une erreur de privilège
(`docs/SPEC-permissions-rls.md` §7, dernier paragraphe). `INSERT` et `UPDATE` vont à
`authenticated` seul, `service_role` conserve tout.

### 6.3 Les droits fins sont appliqués depuis `CRM-012`

La politique de lecture s'appuyait sur `app.is_workspace_member` : un
`channel_members.access = 'none'` ne masquait rien. C'était INC-030, jumelle d'INC-024 pour les
channels, figée par une assertion plutôt que commentée.

**`CRM-012` l'a soldée.** La lecture s'appuie désormais sur `app.can_read_channel`
(`docs/SPEC-permissions-rls.md` §3.3), et `app.can_write_channel` est livrée avec elle — elle
gouvernera l'écriture des tables filles à partir de `CRM-040`.

Un channel hérite du droit fin de **son track** : c'est la précédence channel → track → workspace
du §2.2 de `docs/SPEC-permissions-rls.md`. Deux conséquences mesurées, la seconde
contre-intuitive :

- un `track_members.access = 'none'` masque **tous** les channels de ce track, sans qu'aucune ligne
  `channel_members` ne soit nécessaire ;
- un `channel_members.access = 'member'` posé sous ce même track **rouvre** ce channel-là, et lui
  seul. « Le plus spécifique gagne » vaut dans les deux sens.

L'écriture n'est pas touchée : elle reste réservée à l'administrateur.

### 6.4 Ce que la clé composite apporte à la sécurité, et ce qu'elle n'apporte pas

Elle garantit que le `workspace_id` d'un channel est **celui de son track**. Elle ne remplace aucune
politique : un administrateur de A reste refusé sur les channels de B par la RLS, mesuré au §7
lignes *j* et *k*. Elle ferme un chemin que la RLS ne pouvait pas voir — une donnée dénormalisée
fausse —, elle n'en ouvre aucun.

## 7. Contrat d'API — mesuré

Observé sur la pile réellement démarrée, avec les jetons des trois comptes seedés obtenus par la
véritable route de connexion. `A` désigne le workspace du seed, `B` un second workspace créé pour la
mesure puis détruit.

| # | Appelant et opération | Code | Corps |
|---|---|---|---|
| b | `anon` lit les channels de A | `200` | `[]` — refus par zéro ligne |
| c | `admin` de A lit les channels de A | `200` | les lignes, dans l'ordre de `position` |
| d | `viewer` de A lit les channels de A | `200` | les mêmes lignes : lire n'exige pas d'écrire |
| e | `viewer` insère un channel dans A | `403` | `42501`, `new row violates row-level security policy` |
| f | `business_developer` insère un channel dans A | `403` | idem — l'organisation est une prérogative d'administration |
| g | `admin` de A insère un channel, sans `position` | `201` | la ligne, `position` attribuée automatiquement |
| h | `admin` réinsère le même `slug` dans le même track | `409` | `23505`, violation de l'unicité `(track_id, slug)` |
| i | `admin` supprime un channel | `403` | `42501`, `permission denied for table channels` |
| j | `admin` de A lit les channels de B | `200` | `[]` — **preuve de refus n° 3** au niveau des channels |
| k | `admin` de A insère un channel dans B | `403` | `42501` |
| l | `admin` de A déplace son channel vers B | `403` | `42501` — refus du `WITH CHECK` |
| m | `admin` de A archive son channel | `200` | `archived_at` renseignée |
| n | `admin` insère un `workspace_id` **incohérent** avec le track | `409` | `23503`, `violates foreign key constraint "channels_track_id_workspace_id_fkey"` — §2.4 |
| o | `admin` insère un `track_id` inexistant | `409` | `23503`, même contrainte |

**Deux constats associés, non corrigés et consignés :**

1. Le corps du refus *i* porte un `hint` de PostgREST indiquant la commande `GRANT` à exécuter.
   Comportement de PostgREST `v14.12`, déjà consigné en INC-026 pour `tracks` ; il se reproduit à
   l'identique sur `channels`, ce qui confirme sa **portée transverse** plutôt qu'un défaut de la
   table.
2. Les lignes *n* et *o* rendent **la même contrainte et le même code**. C'est attendu : la clé
   composite ne distingue pas « ce track n'existe pas » de « ce track n'est pas dans ce
   workspace ». Un appelant ne peut donc pas s'en servir pour deviner l'existence d'un track d'un
   autre workspace — propriété utile, et notée comme telle plutôt que subie.

## 8. Seed

`docs/SPEC-seed.md` §2 est étendu de channels dans les tracks actifs du seed, identifiants stables
`5eed0000-0000-4000-8000-0000000000 3x` :

| id | track | slug | nom | position | état |
|---|---|---|---|---|---|
| `…031` | `conseil-ia` | `prospection` | Prospection | 1 | actif |
| `…032` | `conseil-ia` | `grands-comptes` | Grands comptes | 2 | actif |
| `…033` | `conseil-ia` | `appels-offres` | Appels d'offres | 3 | **archivé** |
| `…034` | `studio-web` | `refonte` | Refonte de site | 1 | actif |
| `…035` | `studio-web` | `maintenance` | Maintenance | 2 | actif |
| `…036` | `formation` | `inter-entreprises` | Inter-entreprises | 1 | actif |

Motifs de ce choix, et non d'un autre :

- **trois tracks actifs sur quatre portent des channels** ; `formation` n'en porte qu'un, ce qui
  donne une barre à un seul onglet — un cas d'affichage réel, distinct de la barre vide ;
- le track archivé `pipeline-2024` n'en porte **aucun** : un track masqué n'a pas à démontrer une
  barre d'onglets ;
- `…033` est **archivé** pour que l'état le soit aussi côté channels, et non seulement documenté
  (`CLAUDE.md` §8, « couvrir les principaux états ») ;
- `prospection` existe dans `conseil-ia` **et** pourrait exister dans `studio-web` sans conflit :
  l'unicité est par track. Le seed ne le fait pas — il n'a pas à démontrer une absence de
  contrainte —, mais la suite pgTAP le prouve ;
- `workflow_id` était laissé **nul** partout jusqu'à `CRM-031` : c'était l'état réel du produit
  (§2.5), et le seed ne fabrique pas une donnée que le modèle ne sait pas encore produire
  (`CLAUDE.md` §8, « ne pas fabriquer artificiellement des traces »). **`CRM-031`** a rattaché les six
  channels au workflow par défaut par un `PATCH` de fin de section, la table existant enfin.
  **`CRM-033`** supprime ce `PATCH` : la contrainte `NOT NULL` impose que le workflow par défaut naisse
  **avant** les channels, qui le désignent donc à leur création. `prospection` fait exception et suit
  la copie de portée `track` posée sur son propre track par `CRM-032`, sans quoi le cas accepté le
  plus intéressant de la règle du §4.12 serait documenté sans être démontrable.

Ils sont créés par **l'API REST avec la clé de service**, comme le reste du seed
(`docs/SPEC-seed.md` §3, décision 32), et l'écriture est **convergente** :
`Prefer: resolution=merge-duplicates`.

## 9. Preuves attendues

| Preuve | Support |
|---|---|
| Structure, contraintes, clé composite, RLS, politiques, privilèges, triggers | `supabase/tests/0005_channels.test.sql` (pgTAP) |
| Ordre attribué par track, unicité par track, cohérence du `workspace_id` | idem |
| Écarts figés par des assertions : `workflow_id` nullable et sans FK, `workflows` absente, droit fin non appliqué | idem, §2.5 et §6.3 |
| Les quatorze lignes du §7, avec les jetons réels | `e2e/api/channels.spec.ts` (projet Playwright `api`) |
| Lecture, états, requête émise | `webapp/src/lib/channels.test.ts` |
| Barre d'onglets, route de track, pilules cliquables | `webapp/src/app/TabBar.test.tsx`, `e2e/ui/channels.spec.ts` |
| Rejeu complet et non-complaisance | `scripts/verify-channels.sh` |

Le harnais est **non complaisant** : il dégrade réellement le produit — politique d'écriture
relâchée, clé composite retirée, seed faussé — et exige que les preuves échouent, puis restaure et
constate le retour au vert.

## 10. Limites connues

1. ~~**`workflow_id` n'est ni obligatoire, ni référencée, ni cohérente** (§2.5, INC-029) — `CRM-031`
   et `CRM-033`.~~ **Levée** : la clé étrangère composite est posée par `CRM-031`, la contrainte
   `NOT NULL` et la cohérence workflow ↔ track par `CRM-033`
   (`docs/SPEC-workflow-engine.md` §4.12).
2. ~~**Aucune interface d'administration des channels** : ni création, ni renommage, ni
   réordonnancement, ni archivage depuis l'écran.~~ **Levée par `CRM-075`** (INC-086, arbitrage du
   2026-08-11, option 2) : « Réglages ▸ Arborescence » porte les cinq gestes pour un channel comme
   pour un track, plus le rattachement à son track et le choix de son workflow, prouvés au clavier
   et à la souris (`docs/SPEC-administration-arborescence.md`).
3. **Aucun channel visible dans l'interface**, pour la même raison : l'appelant est anonyme, et la
   route d'un track affiche donc son état « introuvable ».
4. **Les droits fins sont appliqués depuis `CRM-012`** (§6.3) — INC-030 close. Ce qui reste dû
   est `app.can_read_card`, différée jusqu'à `CRM-040`.
5. **Le réordonnancement des onglets n'a pas de RPC dédiée** : réordonner, c'est écrire `position`.
6. **Aucune limite de nombre de channels par track** n'est posée côté serveur. La barre défile.
7. **L'archivage d'un track ne cascade pas sur ses channels** (§4) : choix motivé, mais il signifie
   qu'un désarchivage de track fait réapparaître exactement les channels qui étaient visibles avant.
