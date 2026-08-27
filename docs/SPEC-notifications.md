# Mentions et notifications — `CRM-064`

Document écrit **avant la première ligne de code** de `CRM-064` (`CLAUDE.md` §5), et **après
mesure sur la pile de développement debout et seedée**, le 2026-08-26. Les neuf mesures du §2 sont
reproductibles ; aucune ligne de ce document ne vient d'un souvenir.

`CRM-064` est énoncée au backlog en une ligne — « @mentions, notifications temps réel et
préférences » —, et **aucun document du dépôt ne la décrivait**. Trois lieux la nommaient sans la
spécifier : le §5 de `docs/SCHEMA.md`, qui livre la colonne `card_comments.mentions` en la disant
« destinataires de notification » ; le §13.1 de `docs/SPEC-cards.md`, qui l'écarte du périmètre de
`CRM-043` ; et le commentaire de la colonne, posé par la migration `0015`. Ce document est la
spécification qui manquait.

---

## 1. Objet, périmètre et découpage

### 1.1 Ce que l'unité est

Trois objets, et ils dépendent l'un de l'autre dans cet ordre :

1. **la mention** — le fait, porté par la base, qu'un commentaire désigne nommément une personne ;
2. **la notification** — la conséquence de ce fait pour la personne désignée : quelque chose à
   lire, un état lu/non lu, une surface où le voir ;
3. **les préférences** — ce que chacun consent à recevoir.

### 1.2 Découpage en tranches, et son motif

L'unité ne tient pas dans une session. Elle est menée par tranches, chacune spécifiée, livrée,
prouvée et poussée avant la suivante — le découpage retenu par `CRM-063`, `CRM-077` et `CRM-081`.

| Tranche | Objet | Ce qu'elle livre |
|---|---|---|
| **1** | **La mention en base** | La relation, son intégrité référentielle, sa règle d'éligibilité, ses politiques, ses privilèges, son contrat d'API et son seed. **Aucune surface.** |
| 2 | La notification | Table `public.notifications`, sa production à partir d'une mention, l'état lu / non lu, RLS et contrat d'API. |
| 3 | La surface et le temps réel | Le composeur qui pose une mention, la liste des notifications, le compteur, l'abonnement Realtime. **Découpée en deux sous-tranches au §22.1** — `3a` la réception, `3b` l'émission. |
| 4 | Les préférences | Ce que chacun reçoit, et par quel canal. |

**Ce document spécifie intégralement la tranche 1.** Les tranches 2 à 4 y sont nommées pour que le
périmètre de la 1 soit lisible, et elles seront spécifiées à leur tour, avant leur code.

> **ÉTAT DU DOCUMENT AU 2026-08-26.** La tranche 1 est spécifiée aux §2 à §11, la tranche 2 aux
> §12 à §20, et la **sous-tranche 3a** aux §21 à §31. La sous-tranche 3b est **énoncée** au §30 —
> le contrat qu'elle devra tenir — et reste à spécifier avant son code. La tranche 4 n'est pas
> commencée.

### 1.3 Ce que la tranche 1 n'est pas

Chaque absence est **figée par une assertion**, jamais compensée par une preuve de substitution :

- **aucune notification.** La table `notifications` n'existe pas et n'est pas créée ici. Poser
  une mention ne prévient personne : elle est un fait, pas encore un message ;
- **aucune surface.** Ni composeur, ni saisie, ni affichage. Le §13.10 de `docs/SPEC-cards.md`
  décrit le panneau de commentaires ; la tranche 1 n'y touche pas ;
- **aucune syntaxe `@`.** Le corps d'un commentaire n'est **pas analysé**. Rien, ici, ne lit le
  texte pour en déduire des destinataires : le §4.4 dit pourquoi, et la mesure M2 en donne la
  raison exacte ;
- **aucun temps réel propre.** `card_comment_mentions` n'est pas publiée. Le §7.3 dit pourquoi ;
- **aucune préférence.**

---

## 2. Les neuf mesures, prises avant d'écrire

Toutes relevées le 2026-08-26 sur la pile de développement, migrations `0001` à `0062` appliquées
et `supabase/seed/apply-seed.sh` passé. Les sondes créées l'ont été puis **détruites** ; l'état du
seed a été **relu après** (M9) pour établir qu'aucune n'a survécu.

**M1 — la colonne existe et n'est alimentée par rien.**

```
select count(*), count(*) filter (where mentions <> '{}') from public.card_comments;
=> 5 commentaires, 0 portant une mention
```

**M2 — un profil n'a AUCUN identifiant court.** `public.profiles` porte `id`, `full_name`,
`avatar_url`, `locale`, `created_at`, `updated_at`. Ni `handle`, ni `username`, ni adresse.
Les trois profils du seed sont « Camille Aubert », « Driss Lemoine », « Farida Nowak ».
**Conséquence directe** : `@Camille` ne désigne personne de façon univoque, et deux homonymes le
rendraient ambigu. Analyser le corps pour en déduire des destinataires supposerait d'inventer un
identifiant court, c'est-à-dire une décision de produit qu'aucun document ne porte. Le §4.4 en tire
la règle.

**M3 — `card_comments` ne porte qu'une seule contrainte d'unicité.**

```
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.card_comments'::regclass and contype in ('p','u');
=> card_comments_pkey | PRIMARY KEY (id)
```

**M4 — la clé étrangère composite n'est donc PAS exprimable aujourd'hui.** Sonde créée puis
annulée :

```
create table sonde_m16 (comment_id uuid, workspace_id uuid,
  foreign key (comment_id, workspace_id) references public.card_comments (id, workspace_id));
ERROR:  there is no unique constraint matching given keys for referenced table "card_comments"
```

C'est **exactement** l'erreur mesurée par la décision 124 sur `cards`, et par la migration `0015`
§1 sur le couple `(id, workspace_id)` de la même table. Le geste est le même, refait pour l'autre
couple.

**M5 — la matrice d'accès effectif du seed, calculée par la règle elle-même.**

| Profil | `grands-comptes` | `maintenance` | `prospection` | `appels-offres` |
|---|---|---|---|---|
| Camille Aubert (`admin`) | write | write | write | write |
| Driss Lemoine (`business_developer`) | write | **read** | write | write |
| Farida Nowak (`viewer`) | **none** | read | **write** | **none** |

**M6 — les trois cards commentées, et leur channel.**

| Card | Titre | Channel | Track |
|---|---|---|---|
| `…0c1` | Refonte du site vitrine | `grands-comptes` | `conseil-ia` |
| `…0c4` | Refonte intranet Ville de Lyon | `refonte` | `studio-web` |
| `…0c5` | Support niveau 2 — Atelier Meunier | `maintenance` | `studio-web` |

**Le croisement de M5 et M6 donne le cas de refus, et il est déjà dans le seed** : Farida est
`none` sur `grands-comptes`, où vit `…0c1`. Mesuré par l'API avec son jeton réel :

```
GET /rest/v1/cards?id=eq.…0c1  => 200 []
GET /rest/v1/cards?id=eq.…0c5  => 200 [ { "title": "Support niveau 2 — Atelier Meunier" } ]
```

**M7 — la colonne `mentions` est FERMÉE en mise à jour, et c'est un privilège de colonne.**

```
PATCH /rest/v1/card_comments?id=eq.…0d1  {"mentions":["…012"]}
=> 403 / 42501 — permission denied for table card_comments
```

**M8 — mais elle est GRANDE OUVERTE à l'insertion, et c'est le fait qui décide la tranche.** Le
privilège `INSERT` de `card_comments` est **de table** (migration `0015` §7, décision 140). Deux
sondes, envoyées avec le jeton réel de l'administratrice, ont été **acceptées** :

```
POST /rest/v1/card_comments
  {"card_id":"…0c5","body":"sonde M13","mentions":["00000000-0000-4000-8000-00000000dead"]}
=> 201, mentions = {00000000-0000-4000-8000-00000000dead}
```

L'identifiant ne désigne **aucun profil**. Rien ne l'a refusé : un `uuid[]` ne porte aucune clé
étrangère — c'est INC-033, relevée par `CRM-035` et close pour `require_fields` par `CRM-018`.

```
POST /rest/v1/card_comments
  {"card_id":"…0c1","body":"sonde M14","mentions":["…013"]}
=> 201, mentions = {5eed0000-0000-4000-8000-000000000013}
```

L'identifiant désigne Farida, **qui ne lit pas cette card** (M5, M6). Rien ne l'a refusé non plus.

**M9 — les deux sondes ont été détruites, et l'état du seed relu.**

```
delete from public.card_comments where body like 'sonde M1%';  => DELETE 2
select count(*), count(*) filter (where mentions <> '{}') from public.card_comments;
=> 5, 0
```

---

## 3. Ce que les mesures établissent, et la décision qui en découle

M8 établit deux trous, et ils ne sont pas de même nature :

1. **aucune intégrité référentielle.** Un identifiant qui ne désigne personne est accepté. C'est
   INC-033, mot pour mot, et le remède retenu par `CRM-018` pour le même défaut sur
   `workflow_transitions.require_fields` est une **table de liaison** portant de vraies clés
   étrangères (décision 262, migration `0019`) ;
2. **aucune règle d'éligibilité.** Mentionner quelqu'un qui ne peut pas lire l'affaire est accepté.
   Ce trou-là n'est pas refermé par une clé étrangère : il demande une règle, et la règle est une
   règle d'**accès** — donc elle vit côté base (`CLAUDE.md` §10).

**DÉCISION DE LA TRANCHE 1, et elle suit un précédent du dépôt plutôt qu'une invention** : la
mention devient une **relation**, `public.card_comment_mentions`, et `card_comments.mentions` est
**retirée** par la même migration. Deux porteurs du même fait divergeraient au premier écart ;
`CRM-018` a tranché ainsi, et le §7 dit ce que le retrait coûte et comment il est rendu sûr.

---

## 4. Modèle : `public.card_comment_mentions`

### 4.1 Colonnes

| Colonne | Type | Contrainte |
|---|---|---|
| `comment_id` | `uuid` | non nul, partie de la clé primaire |
| `profile_id` | `uuid` | non nul, partie de la clé primaire |
| `workspace_id` | `uuid` | non nul, **dérivée** par trigger, jamais décidée par le client |
| `created_at` | `timestamptz` | non nul, posée par le trigger, jamais par le client |

**Clé primaire `(comment_id, profile_id)`.** Elle porte la règle « on ne mentionne pas deux fois la
même personne dans le même commentaire » sans qu'aucun code n'ait à la vérifier, et remplace le
`distinct` qu'un `uuid[]` n'a jamais su exiger.

**Aucune colonne `id` de substitution.** La ligne n'a pas d'existence propre : elle est le fait que
ces deux-là sont liés. Une clé technique n'ajouterait qu'une seconde façon de désigner la même
chose.

**Aucune colonne `updated_at`.** Une mention ne se modifie pas : elle est posée ou retirée. C'est
le même écart aux « Conventions générales » de `docs/SCHEMA.md` que celui assumé par `CRM-043` pour
`card_comments`, et pour la même raison — INC-025.

### 4.2 Trois clés étrangères, et ce que chacune rend impossible

| Clé | Cible | `ON DELETE` | Ce qu'elle rend impossible |
|---|---|---|---|
| `(comment_id, workspace_id)` | `card_comments (id, workspace_id)` | `CASCADE` | Une mention orpheline, et une mention dont le workspace diffère de celui de son commentaire |
| `profile_id` | `profiles (id)` | `CASCADE` | **Une mention désignant un compte qui n'existe pas** — le trou de M8, première moitié |
| `workspace_id` | `workspaces (id)` | `CASCADE` | Une mention hors de tout espace |

La première **exige** l'unicité `(id, workspace_id)` sur `card_comments`, que M3 et M4 montrent
absente. La migration l'ajoute d'abord, exactement comme `0015` §1 l'a ajoutée sur `cards`. **Elle
ne change aucun comportement** : `id` étant déjà clé primaire, le couple était déjà unique ; elle
rend seulement la relation exprimable.

`ON DELETE CASCADE` sur `profile_id`, et non `SET NULL` : la colonne est **partie de la clé
primaire**, donc non nulle par construction. La conséquence est nommée plutôt que subie —
**supprimer un compte efface ses mentions**, là où `card_comments.author_id` conserve le commentaire
avec son repli « Compte supprimé » (`CRM-022`, INC-014). Les deux traitements diffèrent parce que
les deux faits diffèrent : un commentaire écrit reste un propos tenu ; une mention adressée à un
compte disparu n'adresse plus rien à personne.

### 4.3 Index

La clé primaire `(comment_id, profile_id)` sert la lecture « qui est mentionné dans ce commentaire ».
Un index `(profile_id, created_at desc)` sert la lecture inverse — « qu'est-ce qui me mentionne » —,
qui est **la** lecture de la tranche 2. Il est posé ici, avec la table qu'il indexe, plutôt que
rattaché après coup à une tranche qui ne crée pas la table.

### 4.4 Le corps du commentaire n'est PAS analysé, et c'est une décision

M2 mesure qu'un profil n'a aucun identifiant court. Trois conséquences, et la troisième décide :

1. `@Camille` ne désigne personne de façon univoque ;
2. deux homonymes rendraient la déduction ambiguë, et le seed n'en porte pas — donc une preuve
   bâtie sur l'analyse du corps serait verte sur un jeu qui ne l'éprouve pas ;
3. inventer un identifiant court est **une décision de produit**, pas une mesure. L'écrire ici
   serait écrire une spécification à la place du responsable.

**Le client envoie donc les identifiants**, et la base juge. La forme que prend la mention dans le
texte — un `@Nom` ordinaire, sans balisage — appartient à la tranche 3, qui livre le composeur ;
elle n'a **aucun effet** sur la relation, et c'est précisément ce qui rend la tranche 1 stable si
la tranche 3 change d'avis sur la syntaxe.

---

## 5. La règle d'éligibilité, et pourquoi elle n'est écrite qu'une fois

### 5.1 L'énoncé

> Un profil ne peut être mentionné dans un commentaire que s'il a un accès effectif **différent de
> `none`** sur le channel de la card que ce commentaire porte.

C'est « il peut lire l'affaire », dit dans les termes de `app.resolve_access`. Mentionner quelqu'un
qui ne peut pas ouvrir l'affaire lui adresserait, en tranche 2, une notification vers un écran qui
lui répondrait « rien à voir ici ». Le refus vit **en base** et non dans l'écran : ce qui empêche
réellement un geste doit valoir aussi pour une API, un script ou une intégration (`CLAUDE.md` §10).

### 5.2 Le problème que cette règle pose, et il est réel

Les onze fonctions d'autorisation du schéma `app` jugent **l'appelant** : toutes lisent
`auth.uid()`, directement ou par `app.workspace_role`. Aucune ne sait répondre à « *cette
personne-là* peut-elle lire cette card ». La règle d'éligibilité, elle, porte sur un **tiers**.

### 5.3 La décision de forme : DÉLÉGATION, jamais seconde écriture

Deux voies s'offraient, et la seconde est retenue :

- **écrire un prédicat neuf** qui relit `workspace_members`, `track_members` et `channel_members`
  pour le profil visé. **Refusée** : ce serait une **seconde écriture de la règle d'accès**, et
  deux écritures de la même règle divergent au premier niveau de droit ajouté. C'est exactement ce
  que la décision de `CRM-063` tranche 4c a refusé pour la RPC de réordonnancement ;
- **généraliser la chaîne existante par un paramètre**, et faire des fonctions actuelles des
  **délégations d'une ligne**. **Retenue.**

La chaîne devient :

```
app.can_read_card_pour(card, profil)
  └─ app.can_read_channel_pour(channel, profil)
       └─ app.resolve_channel_access_pour(ws, track, channel, profil)
            ├─ app.workspace_role_pour(ws, profil)
            └─ app.resolve_access(role, acces_track, acces_channel)   ← LA RÈGLE, inchangée
```

et chacune des quatre fonctions existantes est réécrite en une ligne :

```sql
app.workspace_role(ws)                     := app.workspace_role_pour(ws, (select auth.uid()))
app.resolve_channel_access(ws, track, ch)  := app.resolve_channel_access_pour(ws, track, ch, (select auth.uid()))
app.can_read_channel(ch)                   := app.can_read_channel_pour(ch, (select auth.uid()))
app.can_read_card(card)                    := app.can_read_card_pour(card, (select auth.uid()))
```

**`app.resolve_access` n'est pas touchée.** C'est elle qui porte la règle — « le plus spécifique
gagne », `admin` toujours en écriture, `NULL` distinct de `'none'` — et elle est déjà pure et
paramétrée. La généralisation ne fait que lui apporter les mêmes entrées pour quelqu'un d'autre.

**`app.resolve_track_access` et `app.can_write_channel` ne sont PAS généralisées.** L'éligibilité
porte sur la lecture d'une card, jamais sur un track seul ni sur l'écriture. Les généraliser
« pendant qu'on y est » élargirait la surface de sécurité modifiée sans qu'aucune ligne du produit
les appelle (`CLAUDE.md` §1).

### 5.4 Ce que cette réécriture doit prouver, et non affirmer

Les quatre délégations sont **équivalentes par construction** — `f(x) := f_pour(x, auth.uid())` —,
mais « par construction » n'est pas une preuve. Les suites pgTAP `0002_fonctions_autorisation` et
`0011_droits_fins` éprouvent déjà ces quatre fonctions sous des comptes réels ; **elles doivent
rester vertes sans être modifiées**, et c'est la preuve de non-régression retenue. Une seule
assertion révisée y serait un signal, pas un détail.

### 5.5 `security definer`, et le refus de discrétion qu'il impose

`app.can_read_card_pour` est `security definer`, `search_path` vide, propriétaire `postgres` —
comme les onze autres. Sans cela, elle lirait `workspace_members` sous la RLS de l'appelant et
rendrait « non » pour toute personne dont l'appelant ne voit pas l'appartenance : la règle
dépendrait de qui la pose.

**La conséquence est une divulgation, et elle est bornée.** La fonction répond « oui » ou « non »
sur un tiers.

> **CETTE LIGNE A ÉTÉ TROUVÉE FAUSSE PAR LA PREUVE, ET ELLE EST RÉVISÉE PLUTÔT QUE RÉÉCRITE
> (décision 522).** Elle annonçait que la fonction ne serait accordée **ni** à `anon` **ni** à
> `authenticated`, au motif que « le trigger du §6 n'est atteint que par un client authentifié ».
> Le raisonnement se contredisait lui-même : le trigger du §6 est **`SECURITY INVOKER`**, donc il
> exécute la fonction **précisément sous ce rôle**. MESURÉ — les quatre premières lignes du §8
> rendaient `403` / `42501` `permission denied for function can_read_card_pour`, là où trois
> attendaient un refus **métier** et une un succès. Un refus de privilège qui masque la règle
> n'est pas la règle.

**La fonction est donc accordée à `authenticated`**, et **la divulgation que le refus voulait
éviter n'a aucun canal** — mesuré, et non supposé : PostgREST expose `public, storage,
graphql_public`, jamais `app`. Un appel direct rend `404` / `PGRST202`, exactement comme
`app.relancer_cards_figees` l'a établi pour `CRM-062`. Le privilège sert l'exécution **en base**
sous le trigger, et rien d'autre.

**`anon` reste exclu**, et cette moitié-là du raisonnement tenait : il ne détient aucun privilège
`INSERT` sur la table (§7.2), donc le trigger ne s'exécute jamais sous son rôle. Lui accorder
l'exécution n'ouvrirait aucun chemin et élargirait la surface sans contrepartie.

**Les trois autres variantes `_pour` restent refusées aux deux rôles clients** : elles ne sont
atteintes que **depuis** `app.can_read_card_pour`, qui est `security definer` de propriétaire
`postgres` — donc exécutées sous `postgres`, et non sous l'appelant. Le contrat du §8 le vérifie
plutôt que de le supposer : si l'une d'elles avait eu besoin d'un privilège, la ligne *a*
rougirait sur son nom.

---

## 6. Le trigger, et ses trois refus

`app.card_comment_mentions_avant_insertion()`, `BEFORE INSERT`, **`SECURITY INVOKER`**.

`SECURITY INVOKER` est un choix de **discrétion**, et c'est celui de `app.card_comments_avant_insertion`
(migration `0015` §4.1). En `SECURITY DEFINER`, la recherche du commentaire ignorerait la RLS : un
appelant distinguerait alors un commentaire qui ne lui est pas ouvert d'un commentaire inexistant.
En `SECURITY INVOKER`, les deux rendent le même refus.

Dans l'ordre, et l'ordre compte :

| # | Condition | Refus | `errcode` |
|---|---|---|---|
| 1 | Aucun commentaire lisible ne porte `comment_id` | `comment_not_found` | `P0001` |
| 2 | Le commentaire est une pierre tombale (`deleted_at is not null`) | `comment_deleted` | `P0001` |
| 3 | `app.can_read_card_pour(card, profile_id)` est faux | `mention_destinataire_sans_acces` | `P0001` |

**Le refus 1 avant le 3**, parce que le 3 a besoin de la card, qui vient du commentaire.

**Le refus 2 réemploie le vocabulaire existant.** `comment_deleted` est déjà rendu par le trigger de
mise à jour de `card_comments` (migration `0015` §4.2) pour dire « ce commentaire ne reçoit plus
rien ». Mentionner quelqu'un dans une pierre tombale vidée de son corps serait l'adresser à un
propos détruit. Un second vocable pour le même fait ferait diverger deux dictionnaires de refus.

**Le refus 3 ne dit PAS qui.** Il nomme la règle, jamais la personne ni son niveau d'accès : le
message d'un refus ne doit pas devenir un moyen de sonder les droits d'autrui.

**Le trigger dérive `workspace_id` et pose `created_at`**, quelle que soit la valeur envoyée — le
mécanisme de la décision 95, déjà appliqué à `card_comments`. La clé étrangère composite du §4.2
rend l'incohérence impossible **même par la clé de service**, qui contourne la RLS mais pas les
contraintes.

**Aucun trigger de mise à jour**, parce qu'aucune mise à jour n'est ouverte (§7.2).

---

## 7. Autorisations, privilèges, et le retrait de la colonne

### 7.1 Politiques

RLS activée dans la migration qui crée la table (`docs/SCHEMA.md`, conventions générales).

| Politique | Rôles | Prédicat |
|---|---|---|
| `card_comment_mentions_lecture` (`SELECT`) | `anon`, `authenticated` | `app.can_read_card(app.card_du_commentaire(comment_id))` — qui lit l'affaire lit ses mentions |
| `card_comment_mentions_insertion` (`INSERT`) | `authenticated` | `app.can_write_card(app.card_du_commentaire(comment_id))` **et** le commentaire est celui de l'appelant |
| `card_comment_mentions_suppression` (`DELETE`) | `authenticated` | idem insertion |

**Accordée à `anon` en lecture**, pour la raison du §3.2 de `docs/SPEC-permissions-rls.md` : sans
le privilège, un anonyme recevrait une **erreur** là où le comportement exigé est **zéro ligne**.
`auth.uid()` étant nul, le prédicat est faux.

**`app.card_du_commentaire(comment uuid)`** est une fonction `stable`, `security definer`,
`search_path` vide, qui rend `card_id`. Elle existe pour que les trois politiques n'aient pas
chacune leur sous-requête sur `card_comments` — trois écritures de la même lecture.

**Une mention se retire, elle ne se modifie pas.** Aucune politique `UPDATE`, et aucun privilège
`UPDATE` : le refus est **DOUBLE**, comme pour la suppression de `card_comments` (§6.4 de la
migration `0015`, décision 96). Modifier `profile_id` reviendrait à changer le destinataire d'une
mention déjà posée, ce qui n'est pas une correction mais une substitution.

**La suppression est ouverte à l'auteur du commentaire**, et à lui seul. Retirer une mention est la
correction d'une erreur de frappe ; c'est la même règle que l'édition du corps (`card_comments_maj`),
et elle est portée par le même prédicat.

### 7.2 Privilèges

```sql
revoke all on public.card_comment_mentions from anon, authenticated;
grant select                 on public.card_comment_mentions to anon;
grant select, insert, delete on public.card_comment_mentions to authenticated;
grant all privileges         on public.card_comment_mentions to service_role;
```

Le `revoke` est écrit **avant** les `grant` : l'image Supabase pose un `ALTER DEFAULT PRIVILEGES IN
SCHEMA public` qui accorde tout, nommément, à `anon` et `authenticated` sur toute table nouvelle
(décision 134). Sans lui, le « refus double » du §7.1 n'existerait pas. C'est aussi le point de
sûreté que la migration `0053` a payé pour l'avoir oublié sur une **fonction** (`CRM-062`).

Aucun privilège `UPDATE`, à personne sauf `service_role`.

### 7.3 La table n'est PAS publiée au temps réel

`card_comments` l'est depuis la décision 195, parce que le panneau de commentaires s'y abonne. Rien
ne s'abonne aux mentions : la surface est la tranche 3, et la notification qu'elle affichera est la
tranche 2. Publier une table que personne n'écoute serait poser une surface d'autorisation sans
preuve — le temps réel évalue la politique `SELECT` de chaque abonné, et c'est une propriété qui se
prouve, pas qui s'ajoute par précaution.

### 7.4 Le retrait de `card_comments.mentions`

**Il est sûr, et M1 le mesure** : la colonne est vide sur toute la base — 0 ligne sur 5. Aucune
donnée n'est perdue, et la migration **le vérifie elle-même avant d'agir** : si une seule ligne
portait une mention, elle s'arrêterait en nommant la cause plutôt que de détruire ce qu'elle ne
sait pas transposer. C'est la garde qu'a posée `0019` avant de retirer `require_fields`.

**Trois porteurs suivent dans le même changement :**

- `app.card_comments_avant_maj()` — sa dernière autorité est la migration `0035` — compare
  `new.mentions` à `old.mentions` parmi les colonnes gelées. La comparaison **disparaît avec la
  colonne**, et la fonction est réécrite sans elle, motif écrit dans la migration ;
- le `grant update (body, deleted_at)` de `0015` §7 n'énumère pas `mentions` : rien à faire, et
  c'est dit plutôt que supposé ;
- `docs/SCHEMA.md` §5 retire la ligne du tableau et renvoie ici.

**Les preuves qui figeaient l'absence sont RÉVISÉES, jamais retirées** (mécanisme de la décision
51). Toute assertion pgTAP ou tout contrôle de harnais qui exigeait la présence de la colonne, ou
qui constatait qu'elle n'était alimentée par rien, devient rouge à ce changement : c'est ce pour
quoi elle a été écrite. Chacune est réécrite pour mesurer le **nouvel** état, avec son motif dans
le fichier.

---

## 8. Contrat d'API, ligne à ligne

Mesuré avec les jetons réels des trois comptes du seed. `A` = Camille (`admin`), `B` = Driss
(`business_developer`), `V` = Farida (`viewer`). Card `…0c5` vit dans `maintenance` : `A` y écrit,
`B` et `V` y lisent (M5, M6). Card `…0c1` vit dans `grands-comptes` : `V` n'y a **aucun** accès.

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| a | `A` | `POST /card_comment_mentions` sur son commentaire de `…0c5`, `profile_id` = `B` | `201` |
| b | `A` | même appel, rejoué à l'identique | `409` / `23505` — la clé primaire refuse le doublon |
| c | `A` | `POST` sur son commentaire de `…0c1`, `profile_id` = `V` | `400` / `P0001` `mention_destinataire_sans_acces` |
| d | `A` | `POST` avec `profile_id` = `00000000-…-dead` | `400` / `P0001` `mention_destinataire_sans_acces` |
| e | `A` | `POST` avec `comment_id` inconnu | `400` / `P0001` `comment_not_found` |
| f | `A` | `POST` sur le commentaire tombale `…0d4` | `400` / `P0001` `comment_deleted` |
| g | `B` | `POST` sur un commentaire dont `A` est l'auteur | `403` / `42501` — la politique refuse |
| h | `V` | `POST` sur **son propre** commentaire `…0d5` (`…0c5`) | `403` / `42501` — elle y est `read`, non `write` |
| h bis | `V` | `POST` sur `…0d1`, commentaire qu'elle ne peut pas lire | `400` / `P0001` `comment_not_found` |
| i | `V` | `GET /card_comment_mentions` de `…0c1` | `200` **`[]`** — refus par zéro ligne, jamais par erreur |
| j | `V` | `GET /card_comment_mentions` de `…0c5` | `200`, les lignes posées |
| k | anonyme | `GET /card_comment_mentions` | `200` **`[]`** |
| l | `A` | `PATCH /card_comment_mentions` | `403` / `42501` — aucun privilège `UPDATE` |
| m | `A` | `DELETE` sa propre mention | `204`, et la relecture rend zéro ligne |
| n | `B` | `DELETE` la mention posée par `A` | `204` **sans effet** — la politique filtre, aucune ligne touchée ; relu en base |
| o | `A` | `POST /card_comments` avec un champ `mentions` | `400` / `PGRST204` — la colonne n'existe plus |

**Chaque refus est relu en base avec la clé de service** : un refus qui laisse une trace n'est pas
un refus.

**La ligne *o* est la contre-épreuve du §7.4.** Sans elle, le retrait de la colonne ne serait
prouvé que par l'absence d'erreur ailleurs.

### 8.1 Deux lignes que la mesure a corrigées, et ce qu'elles apprennent

Les quinze lignes ont été exécutées le 2026-08-26 contre la migration réelle. Treize ont rendu ce
qui était écrit. **Deux ne l'ont pas fait, et aucune des deux n'est un défaut du produit** : c'est
la prédiction qui était fausse, et elle est **révisée par la mesure** plutôt que le code plié pour
lui obéir.

**Ligne *d* — la clé étrangère ne parle pas la première.** Il était écrit `409` / `23503`.
Mesuré : `400` / `P0001` `mention_destinataire_sans_acces`. La cause est l'ordre d'exécution — le
trigger est `BEFORE INSERT`, donc il s'exécute **avant** la vérification de la clé étrangère —, et
`app.can_read_card_pour` rend `false` pour un identifiant qui ne désigne aucun profil, comme pour
un profil sans accès.

**Le comportement obtenu est MEILLEUR que celui qui était prévu**, et c'est ce qui décide de ne
rien changer : le refus **ne dit pas si le profil existe**. Un `23503` l'aurait dit. Le §6 exige
que le refus « ne dise pas qui » ; l'ordre des barrières le lui donne gratuitement.

**La clé étrangère reste une barrière réelle, et cela se prouve plutôt que se supposer.** Elle est
la **seconde**, invisible depuis l'API tant que la première tient. La suite pgTAP l'éprouve en
désactivant le trigger sous le propriétaire, puis en constatant le `23503` : sans cette assertion,
rien ne distinguerait une clé étrangère posée d'une clé étrangère oubliée.

**Ligne *h* — deux refus différents selon la card, et c'est la discrétion du §6 en action.** La
ligne écrite visait un commentaire de `…0c5`, que `V` **peut** lire : elle rend bien `403` /
`42501`, la politique refusant son droit `read` là où il faut `write`. Mais la même requête sur
`…0d1` — commentaire d'une card **fermée** pour elle — rend `400` / `P0001` `comment_not_found`,
parce que le trigger `SECURITY INVOKER` ne voit pas ce que la RLS lui cache. **C'est exactement la
propriété que le §6 recherchait** : un commentaire fermé et un commentaire inexistant rendent le
même refus. Elle devient la ligne *h bis*, éprouvée pour elle-même.

---

## 9. Ce que le seed livre

Le seed est un **contrat maintenu** (`CLAUDE.md` §8), et il doit démontrer la fonctionnalité, pas
seulement la peupler.

**Deux mentions, et le choix de leurs destinataires est ce qui prouve quelque chose :**

1. sur le commentaire `…0d1` de la card `…0c1` (`grands-comptes`), écrit par Camille : mention de
   **Driss**. Driss y est `write` ; Farida y est `none` et **ne peut donc pas y être mentionnée** —
   la ligne que le seed ne pose pas est aussi porteuse que celle qu'il pose ;
2. sur le commentaire `…0d2` de la même card, écrit par **Driss** : mention de **Camille**. Second
   auteur, second destinataire, et surtout **second jeton** : la règle est exercée deux fois par
   deux personnes différentes plutôt qu'une fois par la seule administratrice.

> **LE SECOND CHOIX A ÉTÉ CORRIGÉ PAR LA MESURE.** Il visait d'abord le commentaire `…0d5` de la
> card `…0c5`, écrit par Farida — un autre track, un autre channel. **Mesuré : refusé, `403` /
> `42501`**, et c'est la ligne *h* du §8. Farida n'est que `read` sur `maintenance` : elle y a un
> commentaire au seed **parce que la clé de service l'y a posé**, mais elle ne peut pas le
> compléter avec son propre jeton, `card_comment_mentions_insertion` exigeant le droit d'**écriture
> courant** (INC-071). Le seed ne peut donc pas poser cette mention par le vrai chemin — et le
> poser par la clé de service ne prouverait rien (`CLAUDE.md` §8). Le cas est reporté sur `…0d2`.
>
> **L'écart qui en résulte est nommé plutôt que masqué** : les deux mentions du seed vivent sur la
> **même card**. Un jeu qui les répartirait sur deux channels serait meilleur ; il exigerait qu'un
> membre en écriture ait un commentaire ailleurs qu'en `grands-comptes`, ce que le seed courant ne
> porte pas et qu'ajouter ici ferait varier le compte de commentaires — figé par six preuves
> depuis `CRM-043`. Point ouvert n° 5 du §10.

**Le seed écrit ces deux mentions par le VRAI chemin** — un `POST` sur la relation avec le jeton
réel de l'auteur du commentaire —, jamais par un `insert` de fixture sous la clé de service
(`CLAUDE.md` §8). Une fixture prouverait que la table accepte des lignes ; le vrai chemin prouve
que la règle les accepte.

**Convergent** : deux passages laissent deux mentions, et c'est la clé primaire `(comment_id,
profile_id)` qui l'assure, pas une garde propre au seed.

---

## 10. Points ouverts, nommés et non tranchés ici

1. **Le compte supprimé perd ses mentions** (§4.2). C'est la conséquence d'une clé primaire, et
   elle est écrite plutôt que découverte. Si la tranche 2 veut conserver la trace d'une
   notification adressée à un compte parti, elle devra la porter elle-même.
2. **Aucun identifiant court de profil** (M2). Tant qu'il n'existe pas, aucune analyse du corps
   n'est défendable. C'est une décision de produit ; elle n'est pas prise ici.
3. **Une mention survit à la perte d'accès.** La règle est vérifiée **à la pose**, jamais
   ensuite : un destinataire dont le droit retombe à `none` reste mentionné. La relire à chaque
   lecture coûterait une évaluation d'accès par ligne, et **la politique de lecture le couvre
   déjà** — qui ne lit plus l'affaire ne lit plus ses mentions. La tranche 2 devra décider ce
   qu'il advient de la **notification** déjà produite ; ce n'est pas la même question.
4. **Aucune mention d'un groupe, d'un rôle ou d'un channel entier.** Rien ne le demande, et
   l'inventer créerait un destinataire qui n'est pas une personne.
5. **Les deux mentions du seed vivent sur la même card** (§9). Les répartir sur deux channels
   exigerait qu'un membre en écriture ait un commentaire ailleurs qu'en `grands-comptes` ; en
   ajouter un ferait varier le compte de commentaires, figé par six preuves depuis `CRM-043`.
   L'écart est nommé, et il appartient à une reprise du seed, pas à cette tranche.

---

## 11. Preuves attendues de la tranche 1

| Niveau | Preuves |
|---|---|
| pgTAP | Forme de la table, unicité ajoutée à `card_comments`, les trois clés étrangères dans les deux sens, les trois refus du trigger, la dérivation de `workspace_id` et de `created_at`, les trois politiques et **l'absence** de la quatrième, les privilèges y compris l'absence d'`UPDATE`, la **non-appartenance** à la publication, l'absence de `card_comments.mentions`, les cinq fonctions du §5.3, et la conformité du seed |
| API | Les quinze lignes du §8 avec les jetons réels des trois profils, chaque refus **relu en base** |
| Non-régression | `0002_fonctions_autorisation.test.sql` et `0011_droits_fins.test.sql` **verts sans modification** (§5.4) |
| Harnais | `scripts/verify-mentions.sh`, non complaisant, éprouvé par dégradations réelles et restauration constatée |
| Seed | Les deux mentions du §9, posées par le vrai chemin, et le passage convergent |
| E2E d'interface | **Aucun**, et l'écart est nommé : la tranche 1 ne livre aucune surface (§1.3) |

---
---

# TRANCHE 2 — LA NOTIFICATION

Chapitres écrits le **2026-08-26**, **avant la première ligne de code** de la tranche 2
(`CLAUDE.md` §5), et **après mesure sur la pile de développement debout et seedée** — migrations
`0001` à `0063` appliquées, `supabase/seed/apply-seed.sh` passé. Les sondes du §12 ont été créées
puis **annulées** ou **détruites**, et l'état du seed a été **relu après** (M15) pour établir
qu'aucune n'a survécu.

Le §1.2 nomme cette tranche en une ligne — « table `public.notifications`, sa production à partir
d'une mention, l'état lu / non lu, RLS et contrat d'API ». Aucun chapitre ne la décrivait. Ces
chapitres sont la spécification qui manquait.

---

## 12. Les huit mesures de la tranche 2, prises avant d'écrire

**M1 — aucune des trois tables du §8 de `docs/SCHEMA.md` n'existe.**

```
select to_regclass('public.notifications'), to_regclass('public.notification_preferences'),
       to_regclass('public.card_watchers');
=> NULL, NULL, NULL
```

Le §8 de `docs/SCHEMA.md` les annonce en une ligne chacune — « destinataire, type, charge utile,
date de lecture » — sans les décrire. La tranche 2 livre **la première**, et elle seule.

**M2 — les deux mentions du seed, et où elles vivent.**

| Commentaire | Auteur | Mentionné | Card | Channel |
|---|---|---|---|---|
| `…0d1` | Camille (`admin`) | **Driss** | `…0c1` | `grands-comptes` |
| `…0d2` | **Driss** | Camille | `…0c1` | `grands-comptes` |

Les deux vivent sur la **même card**, et c'est l'écart nommé au point ouvert n° 5 du §10. La
tranche 2 en hérite : les deux notifications qu'elle produira vivront elles aussi sur cette card.

**M3 — une seule table est publiée au temps réel.**

```
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
=> card_comments
```

**M4 — les cinq commentaires du seed, dont la pierre tombale `…0d4`.** Trois sur `…0c1`, un sur
`…0c4` (retiré par la modération), un sur `…0c5` écrit par la lectrice.

**M5 — L'AUTO-MENTION EST ACCEPTÉE, ET C'EST LE FAIT QUI DÉCIDE LE §14.3.** Sonde envoyée avec le
jeton réel de l'administratrice, sur **son propre** commentaire `…0d3` :

```
POST /rest/v1/card_comment_mentions {"comment_id":"…0d3","profile_id":"…011"}
=> 201, {"comment_id":"…0d3","profile_id":"…011","workspace_id":"…001","created_at":"…"}
```

Rien ne l'a refusée, et **c'est correct** : la règle d'éligibilité du §5.1 demande que le
destinataire puisse lire l'affaire, et l'auteur le peut nécessairement. La tranche 1 n'a jamais
prétendu interdire ce cas. Il n'en reste pas moins que la notification qui en découlerait dirait à
Camille que Camille l'a mentionnée. Le §14.3 en tire la règle. **La sonde a été détruite**
(`DELETE` → `204`), et M15 le constate.

**M6 — la sonde détruite, le seed rendu intact** : deux mentions, `…0d1 → …012` et `…0d2 → …011`.

**M7 — UNE MENTION SURVIT À LA PIERRE TOMBALE DE SON COMMENTAIRE, ET LE CORPS EST VIDÉ.** Sonde en
transaction **annulée** :

```
insert into card_comment_mentions (…0d3, …012, …001);           => 1 mention
update card_comments set deleted_at = now() where id = …0d3;
select count(*), body = '' from …                                => 1 mention, corps vide = true
rollback;
```

La suppression d'un commentaire est **douce** — `deleted_at` et un corps réellement vidé
(décision 193) — et elle n'emporte pas les mentions. **C'est le fait qui décide du §13.4** : un
instantané du texte placé dans la charge utile survivrait à l'effacement de ce texte, et la
suppression d'un commentaire cesserait d'être une suppression.

**M8 — les compteurs figés que la tranche va faire bouger.**

```
select count(*) from pg_policies where schemaname = 'public';  => 119
select count(*) from pg_tables   where schemaname = 'public';  => 41
```

Le premier est figé par `supabase/tests/0016_preuves_refus.test.sql`, révisé de 116 à 119 par la
tranche 1. Il sera révisé, jamais retiré (mécanisme de la décision 51).

**M9 et M10 — LE TRIGGER PRODUCTEUR NE PEUT PAS ÊTRE `SECURITY INVOKER`, ET C'EST MESURÉ.** Deux
sondes symétriques, toutes deux en transaction **annulée**, une table `sonde` fermée à
`authenticated` par `revoke all`, un trigger `AFTER INSERT` sur `card_comment_mentions` qui y
écrit, l'insertion faite sous `set local role authenticated` avec le `sub` de Camille :

```
trigger SECURITY INVOKER  => REFUS : 42501 / permission denied for table sonde_m11
trigger SECURITY DEFINER  => INSERTION ACCEPTÉE
```

Le §14.1 en tire la divergence avec la tranche 1 — dont le trigger est `SECURITY INVOKER` par
**discrétion** —, et le motif de cette divergence.

**M11 — LE PRIVILÈGE DE COLONNE FERME TOUT LE RESTE, ET LE REFUS EST UN `42501`.** `card_comments`
porte `grant update (body, deleted_at)`. Mesuré avec le jeton réel de l'administratrice :

```
PATCH /rest/v1/card_comments?id=eq.…0d1 {"card_id":"…0c5"}
=> 403 / 42501 — permission denied for table card_comments
PATCH /rest/v1/card_comments?id=eq.…0d1 {"colonne_inexistante":"x"}
=> 400 / PGRST204 — Could not find the 'colonne_inexistante' column
```

Le §15.2 s'appuie dessus : `grant update (read_at)` suffit à figer toutes les autres colonnes, et
le refus est un refus de **privilège**, pas un refus silencieux.

**M12 — l'état du seed relu après toutes les sondes** : `card_comments` = **5**,
`card_comment_mentions` = **2**. Aucune sonde n'a survécu.

---

## 13. Modèle : `public.notifications`

### 13.1 Ce que la tranche 2 est, et ce qu'elle n'est pas

Elle livre **un message adressé à une personne**, produit par un fait, et l'état de sa lecture.
Chaque absence est figée par une assertion, jamais compensée :

- **aucune surface.** Ni liste, ni compteur, ni cloche. La tranche 3 les livre ;
- **aucun temps réel.** La table n'est pas publiée — §16.3, même motif que le §7.3 ;
- **aucune préférence.** Ce que chacun consent à recevoir est la tranche 4 ;
- **aucun canal sortant.** Ni email, ni digest, ni webhook. La notification vit en base et rien
  ne l'en fait sortir ;
- **aucune suppression par le destinataire** — §15.4, et le motif y est écrit ;
- **aucune source autre que la mention.** Une seule valeur de `type`, et le §13.3 dit pourquoi
  la colonne existe malgré cela.

### 13.2 Colonnes

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | clé primaire, `gen_random_uuid()` |
| `workspace_id` | `uuid` | non nul, **dérivé** par le trigger, jamais décidé par le client |
| `recipient_id` | `uuid` | non nul, la personne à qui le message s'adresse |
| `type` | `text` | non nul, `check (type in ('mention'))` |
| `subject_card_id` | `uuid` | **nullable** — l'affaire dont le message parle, quand il en parle d'une |
| `payload` | `jsonb` | non nul, `default '{}'` |
| `read_at` | `timestamptz` | **nullable** — nul tant que le message n'est pas lu |
| `created_at` | `timestamptz` | non nul, posé par le trigger |

**UNE CLÉ PRIMAIRE TECHNIQUE, ET C'EST L'INVERSE DE LA MENTION.** Le §4.1 refuse une colonne `id`
à `card_comment_mentions` parce qu'une mention **est** le fait que deux entités sont liées. Une
notification n'est pas un fait : c'est un **message**, une chose qui a sa propre existence, qu'on
lit, qu'on marque, qu'on compte. Deux messages identiques adressés à la même personne à deux
instants sont deux messages. La clé technique dit cela ; une clé naturelle prétendrait le
contraire.

**Aucune colonne `updated_at`.** `read_at` est la seule mutation ouverte, et elle porte sa propre
date. Une seconde date ne dirait rien de plus. Même écart assumé aux conventions générales de
`docs/SCHEMA.md` que `card_comments` et `card_comment_mentions` (INC-025).

### 13.3 `type`, et pourquoi la colonne existe alors qu'elle n'a qu'une valeur

La tranche 2 ne produit qu'une source. Une colonne à une seule valeur ressemble à de
l'anticipation, et `CLAUDE.md` §1 l'interdit — mais ce n'est pas ce qu'elle est ici : **elle est la
garde qui empêche d'écrire un type inventé.** Sans elle, la tranche 4 ajouterait sa source en
écrivant ce qu'elle veut dans la charge utile, et deux lecteurs interpréteraient différemment la
même ligne.

Le `check` est **fermé sur `'mention'`**, et il est convergent : une tranche ultérieure qui ajoute
une source **remplace la contrainte** par le mécanisme `app.migration_00xx_converger_contrainte`
déjà employé par la migration `0063`. Écrire aujourd'hui `check (type in ('mention', 'assignation',
'echeance'))` pour des sources qui n'existent pas serait, cela, de l'anticipation : la contrainte
autoriserait des lignes que rien ne produit et qu'aucune preuve n'éprouve.

### 13.4 La charge utile ne porte AUCUN CONTENU, et M7 le décide

`payload` porte **de quoi désigner, jamais de quoi lire** :

```json
{ "comment_id": "…0d1", "author_id": "…011" }
```

Ni le corps du commentaire, ni le titre de la card, ni le nom de l'auteur. L'écran de la tranche 3
les relira **à travers les politiques existantes**, au moment où il affiche.

**LE MOTIF EST MESURÉ, ET IL N'EST PAS UNE PRÉFÉRENCE DE STYLE.** M7 établit que la suppression
d'un commentaire est **douce** et qu'elle **vide réellement le corps** (décision 193), tandis que
la mention survit. Un instantané du texte placé ici survivrait donc à l'effacement de ce texte :
un propos retiré resterait lisible dans la notification de celui qui y était nommé, et la
suppression d'un commentaire **cesserait d'être une suppression**. Le même raisonnement vaut pour
le titre d'une card renommée, ou pour le nom d'un compte supprimé — que `CRM-022` remplace par
« Compte supprimé » partout ailleurs.

**Ce que cela coûte est nommé** : l'écran de la tranche 3 fera une lecture par notification
affichée, là où une charge utile dénormalisée en aurait fait zéro. C'est un coût de lecture, payé
pour que la notification ne devienne jamais une copie divergente du produit. Si la mesure montre
un jour que ce coût est réel, la réponse sera une **vue** ou une jointure `select=…`, jamais une
copie.

### 13.5 `subject_card_id`, et ce qu'elle porte

**Elle n'est pas une redondance du `payload`** : elle est la colonne sur laquelle la **politique de
lecture** s'appuie (§16.1). Une politique ne peut pas raisonnablement extraire un `uuid` d'un
`jsonb` pour le passer à une fonction d'accès — elle serait illisible, non indexable, et sensible à
une charge utile mal formée.

**Nullable, et c'est délibéré.** Une notification de mention parle toujours d'une affaire ; une
notification future — un digest, une invitation, un message d'exploitation — peut n'en désigner
aucune. Le §16.1 traite les deux cas explicitement plutôt que d'exiger une card fictive.

`ON DELETE CASCADE` vers `cards` : une affaire supprimée n'a plus de notification qui la désigne.

### 13.6 Trois clés étrangères

| Clé | Cible | `ON DELETE` | Ce qu'elle rend impossible |
|---|---|---|---|
| `recipient_id` | `profiles (id)` | `CASCADE` | Un message adressé à un compte qui n'existe pas |
| `workspace_id` | `workspaces (id)` | `CASCADE` | Un message hors de tout espace |
| `(subject_card_id, workspace_id)` | `cards (id, workspace_id)` | `CASCADE` | Un message dont l'affaire vit dans un **autre** espace que lui |

La troisième est **composite**, et pour la raison du §4.2 : elle interdit l'incohérence **même par
la clé de service**, qui contourne la RLS mais pas les contraintes. `cards` porte déjà
`UNIQUE (id, workspace_id)` — posée par la migration `0015` §1 —, donc rien à ajouter ici.

Une clé étrangère composite acceptant `NULL` dans une de ses colonnes n'est **pas** vérifiée par
défaut (`MATCH SIMPLE`) : une notification sans card passe, et c'est exactement ce que le §13.5
demande.

**AUCUNE CLÉ ÉTRANGÈRE VERS LA MENTION**, et c'est une décision, pas un oubli. Le §14.4 la porte.

### 13.7 Index

| Index | Ce qu'il sert |
|---|---|
| `(recipient_id, created_at desc)` | « mes notifications, les plus récentes d'abord » — la liste de la tranche 3 |
| `(recipient_id) where read_at is null` | **le compteur de non-lues**, qui est le geste le plus fréquent d'une cloche |

Le second est **partiel**, et c'est ce qui le rend petit : il n'indexe que les lignes non lues,
c'est-à-dire une fraction qui décroît avec l'usage, là où un index total croîtrait indéfiniment
pour servir une question qui ne porte que sur la queue.

---

## 14. La production : de la mention au message

### 14.1 `SECURITY DEFINER`, et pourquoi la tranche 2 diverge de la tranche 1

`app.notifications_apres_mention()`, **`AFTER INSERT`** sur `public.card_comment_mentions`,
**`SECURITY DEFINER`**, propriétaire `postgres`, `search_path` vide.

Le §6 fait le choix **inverse** pour le trigger de la mention : `SECURITY INVOKER`, par
**discrétion**, pour qu'un commentaire fermé et un commentaire inexistant rendent le même refus.
La divergence n'est pas une inconstance ; les deux triggers ne font pas la même chose :

- celui de la tranche 1 **lit pour juger**. Ce qu'il ne voit pas doit lui rester caché, sinon le
  refus devient un moyen de sonder ;
- celui de la tranche 2 **écrit pour le compte d'un tiers**. Le destinataire n'a demandé rien, et
  l'appelant n'a aucun droit sur la boîte de quelqu'un d'autre.

**ET CE N'EST PAS UN RAISONNEMENT, C'EST UNE MESURE.** M9 et M10 :

```
trigger SECURITY INVOKER  => 42501 / permission denied for table  (l'insertion échoue)
trigger SECURITY DEFINER  => insertion acceptée
```

En `SECURITY INVOKER`, le trigger s'exécute sous `authenticated`, qui n'a **aucun privilège
`INSERT`** sur `notifications` (§15.2) — et il ne doit pas en avoir, sinon un client pourrait
s'écrire des messages. La production serait donc refusée, et **la pose d'une mention échouerait
avec elle**, le trigger étant dans la même transaction.

### 14.2 `AFTER`, jamais `BEFORE`

Le trigger de la tranche 1 est `BEFORE INSERT` parce qu'il **modifie la ligne** — il dérive
`workspace_id` et pose `created_at`. Celui-ci ne touche pas la mention : il en **conséquence** une
autre ligne. Le faire en `BEFORE` produirait la notification avant que la mention ne soit
réellement acquise — avant, notamment, que les clés étrangères du §4.2 n'aient parlé.

Il rend `null`, comme tout trigger `AFTER … FOR EACH ROW`.

### 14.3 UNE AUTO-MENTION NE PRODUIT AUCUNE NOTIFICATION

> Quand le profil mentionné est **l'auteur du commentaire**, le trigger n'écrit rien et sort.

**Le cas est réel, et M5 le mesure** : l'auto-mention est acceptée par la tranche 1, avec le jeton
réel, sur son propre commentaire. Ce n'est pas un défaut — la règle d'éligibilité demande que le
destinataire puisse lire l'affaire, et l'auteur le peut toujours.

Mais une notification n'est pas un fait, c'est un **message**, et se prévenir soi-même de ce qu'on
vient d'écrire n'est pas une information : c'est du bruit dans la seule liste où le bruit se paie
en confiance. Une cloche qui sonne pour ce qu'on vient de taper cesse d'être lue.

**LA COMPARAISON PORTE SUR `author_id`, JAMAIS SUR `auth.uid()`**, et la différence est mesurable.
La politique `card_comment_mentions_insertion` exige déjà que l'appelant **soit** l'auteur, si bien
que les deux coïncident **par la vraie route**. Mais la clé de service contourne la RLS — pas les
triggers — et `auth.uid()` y est **nul** : un trigger qui comparerait à `auth.uid()` produirait,
sous la clé de service, une notification que la vraie route n'aurait pas produite. Le seed et les
harnais empruntent ce chemin ; la règle doit valoir des deux côtés.

**La mention, elle, reste posée.** La tranche 1 n'est pas rejugée : le fait est enregistré, seul le
message ne l'est pas. Une assertion le figera — auto-mention = **une** ligne dans
`card_comment_mentions`, **zéro** dans `notifications`.

### 14.4 AUCUNE CLÉ ÉTRANGÈRE VERS LA MENTION — le point ouvert n° 3 est tranché ici

Le §10, point 3, laissait à cette tranche la question : « la tranche 2 devra décider ce qu'il
advient de la **notification** déjà produite ». Elle est tranchée, et en deux temps.

**1. Retirer une mention n'efface PAS la notification.** Il n'y a donc ni clé étrangère vers
`card_comment_mentions`, ni `ON DELETE CASCADE` depuis elle.

Le §7.1 dit ce qu'est le retrait d'une mention : « la correction d'une erreur de frappe ». Une
notification, elle, est un **message déjà délivré** — possiblement déjà lu. L'effacer
rétroactivement réécrirait le passé du destinataire : il aurait vu quelque chose dont il ne
resterait aucune trace, et il n'aurait aucun moyen de savoir s'il a rêvé. Le dépôt tranche déjà
ainsi ailleurs : `card_comments` conserve le propos d'un compte supprimé derrière « Compte
supprimé » (`CRM-022`, INC-014), parce qu'un propos tenu reste tenu.

**Le prix est nommé** : une mention posée par erreur puis retirée laisse une notification. Le
destinataire cliquera, et trouvera une affaire où son nom n'apparaît plus. C'est le comportement de
tous les produits qui délivrent des messages, et il est **honnête** — l'autre choix ne l'est pas.

**2. Mais la notification n'échappe pas à la règle d'accès**, et c'est le §16.1 qui l'assure : sa
lecture est conditionnée à `app.can_read_card(subject_card_id)`. Un destinataire dont le droit
retombe à `none` **cesse de voir** la notification, sans qu'aucune ligne ne soit détruite — et la
revoit si le droit revient. C'est exactement le traitement que le §10 point 3 avait retenu pour la
mention elle-même : « la politique de lecture le couvre déjà ».

### 14.5 Ce que le trigger écrit, ligne à ligne

```
recipient_id     := new.profile_id
workspace_id     := new.workspace_id          -- déjà dérivé et vérifié par la tranche 1
subject_card_id  := la card du commentaire
type             := 'mention'
payload          := jsonb_build_object('comment_id', new.comment_id, 'author_id', <auteur>)
created_at       := now()
read_at          := null
```

**`workspace_id` est repris de la mention, jamais relu.** La tranche 1 l'a dérivé du commentaire et
la clé composite du §4.2 le tient ; le relire ouvrirait la possibilité qu'il diverge.

**AUCUNE CONVERGENCE, ET C'EST DÉLIBÉRÉ.** Poser deux fois la même mention est impossible — la
clé primaire `(comment_id, profile_id)` du §4.1 le refuse —, donc le trigger ne peut pas s'exécuter
deux fois pour le même fait. Retirer une mention puis la reposer produit, elle, **une seconde
notification**, et c'est correct : c'est un second geste, à un second instant.

### 14.6 Ce que le trigger ne fait PAS

- **il ne juge rien.** L'éligibilité a été jugée par le trigger `BEFORE` de la tranche 1 ; la
  rejuger serait la seconde écriture que le §5.3 refuse ;
- **il ne lit aucune préférence.** Il n'y en a pas — tranche 4 ;
- **il n'envoie rien.** Aucun email, aucun `pg_net`, aucune sortie hors de la base ;
- **il ne notifie personne d'autre** que le mentionné : ni l'auteur, ni les membres du channel.
  Les abonnements (`card_watchers`, §5 de `docs/SCHEMA.md`) n'existent pas (M1).

---

## 15. Ce que le destinataire peut faire, et ce qu'il ne peut pas

### 15.1 Le seul geste ouvert est `read_at`

Marquer lu, et **marquer non lu**. Les deux sens, parce qu'un état à deux valeurs qu'on ne peut
parcourir que dans un sens n'est pas un état : c'est un compteur. Rien ne rend le retour dangereux,
et le geste est courant — on ouvre une notification par mégarde et on la remet de côté.

**LA DATE EST POSÉE PAR LA BASE, JAMAIS PAR LE CLIENT.** Un trigger `BEFORE UPDATE` remplace toute
valeur non nulle envoyée par `now()`. C'est le mécanisme de la décision 95, déjà appliqué au
`created_at` de la mention (§6) : une date antidatée fausserait l'ordre de lecture et rendrait le
compteur de non-lues incohérent avec ce que l'écran affiche. Envoyer `null` reste `null` — c'est le
« marquer non lu ».

### 15.2 Privilèges

```sql
revoke all on public.notifications from anon, authenticated;

grant select              on public.notifications to anon;
grant select              on public.notifications to authenticated;
grant update (read_at)    on public.notifications to authenticated;
grant all privileges      on public.notifications to service_role;
```

Le `revoke` est écrit **avant** les `grant`, et c'est la décision 134 : l'image Supabase pose un
`ALTER DEFAULT PRIVILEGES IN SCHEMA public` qui accorde tout, nommément, à `anon` et
`authenticated` sur toute table nouvelle. Sans lui, il n'y aurait ni refus d'insertion, ni refus de
suppression, ni colonnes figées.

**`grant update (read_at)` seul fige toutes les autres colonnes**, et M11 le mesure : un `PATCH`
sur une colonne non accordée rend `403` / `42501` — un refus de **privilège**, pas un silence.
`type`, `payload`, `recipient_id`, `subject_card_id`, `workspace_id` et `created_at` sont donc
fermés sans qu'aucune politique n'ait à s'en occuper.

**`anon` reçoit `SELECT`**, pour la raison du §3.2 de `docs/SPEC-permissions-rls.md` : sans le
privilège, un anonyme recevrait une **erreur** là où le comportement exigé est **zéro ligne**.
`auth.uid()` étant nul, le prédicat du §16.1 est faux.

### 15.3 AUCUNE INSERTION PAR UN CLIENT — refus DOUBLE

Une notification se **produit**, elle ne se demande pas. Le seul chemin est le trigger du §14.

Le refus est **double**, comme celui du §7.1 pour la mise à jour d'une mention : aucun privilège
`INSERT` (§15.2) **et** aucune politique `INSERT`. Sans les deux, on ne saurait pas lequel refuse,
et la dégradation du harnais ne pourrait pas éprouver la seconde barrière en relâchant la première.

Sans ce refus, un client s'écrirait des messages — ou, bien pire, en écrirait à quelqu'un d'autre.

### 15.4 AUCUNE SUPPRESSION, et le motif est écrit

Ni privilège `DELETE`, ni politique `DELETE`. Un destinataire ne peut pas effacer une notification.

**Ce n'est pas une omission**, et ce n'est pas non plus la bonne réponse définitive : c'est le
périmètre. Vider une liste est une décision de **rétention** — au bout de combien de temps ? avec
quel effet sur le compteur ? avec ou sans archive ? — qu'aucune mesure ne donne et qu'aucun
document du dépôt ne porte. L'inventer ici serait écrire une spécification à la place du
responsable (`CLAUDE.md` §1).

**Point ouvert n° 6 du §18.** La tranche 3, qui livre la liste, sera la première à en avoir un
besoin concret.

---

## 16. Autorisations

### 16.1 La politique de lecture, et sa seconde condition

| Politique | Rôles | Prédicat |
|---|---|---|
| `notifications_lecture` (`SELECT`) | `anon`, `authenticated` | `recipient_id = (select auth.uid())` **et** (`subject_card_id is null` **ou** `app.can_read_card(subject_card_id)`) |
| `notifications_marquage` (`UPDATE`) | `authenticated` | même prédicat, en `USING` **et** en `WITH CHECK` |

**La première condition est celle qu'on attend** : mes notifications sont à moi. Personne d'autre —
ni un collègue, ni un administrateur du workspace. La boîte de quelqu'un n'est pas une donnée
d'exploitation.

**LA SECONDE EST CELLE QUI TRANCHE LE POINT OUVERT N° 3** (§14.4). Elle délègue à
`app.can_read_card`, qui **existe déjà** et que la tranche 1 vient de généraliser : la règle
d'accès n'a **toujours qu'une seule écriture**. Écrire ici un prédicat qui relirait
`channel_members` serait exactement la seconde écriture que le §5.3 a refusée.

**Le `is null` traite le cas d'une notification sans affaire** — aucune aujourd'hui, mais la
colonne est nullable (§13.5) — plutôt que de le laisser tomber dans un `NULL` que le moteur
interpréterait comme faux. Une notification qui ne parle d'aucune card est lisible par son seul
destinataire, et c'est la bonne réponse.

**`WITH CHECK` autant que `USING` sur l'`UPDATE`** : sans lui, un destinataire pourrait faire
sortir une ligne de son propre périmètre. Le privilège de colonne (§15.2) le rend déjà impossible
puisque `recipient_id` n'est pas modifiable ; le `WITH CHECK` est la **seconde** barrière, et le
dépôt en pose systématiquement deux.

### 16.2 Aucune politique `INSERT`, aucune politique `DELETE`

§15.3 et §15.4. Leur **absence** est figée par une assertion pgTAP qui compte les politiques de la
table et les nomme : sans cela, une politique ajoutée par mégarde passerait inaperçue.

### 16.3 La table n'est PAS publiée au temps réel

Même motif qu'au §7.3, et il tient toujours : rien ne s'y abonne. La cloche, la liste et
l'abonnement `Realtime` sont la tranche 3, qui **publiera la table dans le même changement que
l'écran qui l'écoute**. Publier une table que personne n'écoute serait poser une surface
d'autorisation sans preuve — le temps réel évalue la politique `SELECT` de chaque abonné, et c'est
une propriété qui se prouve, pas qui s'ajoute par précaution.

L'absence est **figée** par une assertion (M3 en donne la ligne de base : seule `card_comments` est
publiée).

---

## 17. Contrat d'API, ligne à ligne

`A` = Camille (`admin`), `B` = Driss (`business_developer`), `V` = Farida (`viewer`). Le seed livre
**deux** notifications (§19) : `N1` adressée à Driss, `N2` adressée à Camille, toutes deux sur la
card `…0c1` (`grands-comptes`), fermée à Farida (M5 de la tranche 1).

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| a | `B` | `GET /notifications` | `200`, **`N1` seule** — pas `N2`, qui ne lui est pas adressée |
| b | `A` | `GET /notifications` | `200`, **`N2` seule** |
| c | `V` | `GET /notifications` | `200` **`[]`** — aucune ne lui est adressée |
| d | anonyme | `GET /notifications` | `200` **`[]`** — zéro ligne, jamais une erreur |
| e | `A` | `POST /notifications` (message à soi-même) | `403` / `42501` — aucun privilège `INSERT` |
| f | `A` | `POST /notifications` avec `recipient_id` = `B` | `403` / `42501` — le même refus, et c'est le geste dangereux |
| g | `B` | `PATCH N1 {"read_at":"…"}` | `204`, et la relecture rend une date **du jour**, non celle envoyée |
| h | `B` | `PATCH N1 {"read_at":null}` | `204`, et la relecture rend `null` — marquer non lu |
| i | `A` | `PATCH N1 {"read_at":"…"}` — la notification **de `B`** | `204` **sans effet** — la politique filtre ; relu en base |
| j | `B` | `PATCH N1 {"payload":{"x":1}}` | `403` / `42501` — colonne non accordée |
| k | `B` | `PATCH N1 {"recipient_id":"…011"}` | `403` / `42501` — le destinataire n'est pas modifiable |
| l | `B` | `DELETE N1` | `403` / `42501` — aucun privilège `DELETE` |
| m | `B` | `GET /notifications?select=id&read_at=is.null` | `200`, le compteur de non-lues, cohérent avec *g* et *h* |
| n | `A` | `POST` d'une mention sur son commentaire, `profile_id` = `B` | `201`, **et une notification apparaît** pour `B` — relue avec la clé de service |
| o | `A` | `POST` d'une **auto-mention** | `201`, **et AUCUNE notification** — §14.3, relu avec la clé de service |
| p | `A` | `DELETE` de la mention posée en *n* | `204`, **et la notification demeure** — §14.4, relue en base |

**Chaque refus est relu en base avec la clé de service** : un refus qui laisse une trace n'est pas
un refus. Chaque ligne posée est retirée, et une dernière lecture le **constate** (décision 501).

**Les lignes *n*, *o* et *p* sont le cœur du contrat** : elles éprouvent la **production**, qui est
l'objet de la tranche. Les autres éprouvent la boîte ; celles-ci éprouvent ce qui la remplit.

**La ligne *i* n'est pas un doublon de la ligne *a*.** La lecture refuse par zéro ligne ; l'écriture
refuse par un `USING` qui filtre. Un `204` sans effet et un `403` sont deux comportements
différents, et le second serait un défaut ici : PostgREST rend `204` quand aucune ligne ne
correspond, et c'est le refus **discret** que le dépôt attend d'un `UPDATE` (précédent : la ligne
*n* du §8).

---

## 18. Points ouverts, nommés et non tranchés ici

1. **La rétention.** Aucune notification ne se supprime ni n'expire (§15.4). Une boîte croît
   indéfiniment. La tranche 3, qui livre la liste, sera la première à en souffrir.
2. **Le regroupement.** Dix mentions sur la même card produisent dix messages. Les regrouper est
   une décision d'écran autant que de modèle ; elle appartient à la tranche 3.
3. **Les préférences ne sont pas lues** (§14.6). Le trigger produit pour tout le monde. La
   tranche 4 devra décider si une préférence filtre **à la production** ou **à la lecture** — et
   les deux ne se valent pas : la première perd l'information, la seconde la garde.
4. **Aucune notification pour l'auteur d'un commentaire auquel on répond**, ni pour les membres
   du channel. `card_watchers` n'existe pas (M1) et son périmètre est un choix produit.
5. **Les deux notifications du seed vivent sur la même card**, parce que les deux mentions y
   vivent (M2, et point ouvert n° 5 du §10). L'écart est hérité, non créé.
6. **`notification_preferences` reste à spécifier** (tranche 4), et `audit_log` — `CRM-072` — reste
   une unité qui n'existe pas.

---

## 19. Ce que le seed livre

**Rien de neuf, et c'est le fait le plus intéressant de cette section.** Le seed pose déjà deux
mentions par le vrai chemin (§9). Le trigger du §14 étant `AFTER INSERT`, ces deux `POST`
**produisent** deux notifications sans qu'une seule ligne ne soit ajoutée au seed.

C'est la meilleure démonstration possible de la tranche : le seed ne fabrique pas de notification,
il en **provoque** — exactement ce que `CLAUDE.md` §8 exige (« ne pas fabriquer artificiellement
des traces censées représenter l'exécution d'un processus réel »).

| Notification | Destinataire | Produite par | Card |
|---|---|---|---|
| `N1` | Driss | la mention de Camille sur `…0d1` | `…0c1` |
| `N2` | Camille | la mention de Driss sur `…0d2` | `…0c1` |

**Le seed gagne néanmoins une GARDE**, et elle n'est pas décorative : elle **mesure** que les deux
notifications existent, qu'elles sont **non lues**, et que **Farida n'en porte aucune**. Si le
trigger cessait de produire, le seed passerait sans rien dire ; la garde le fait échouer.

> **CETTE SECTION A ÉTÉ TROUVÉE FAUSSE PAR LA MESURE, ET ELLE EST RÉVISÉE PLUTÔT QUE RÉÉCRITE**
> (mécanisme de la décision 51, et de la révision du §5.5 par la décision 522). Elle annonçait que
> les deux notifications naîtraient « sans qu'une seule ligne ne soit ajoutée au seed ». MESURÉ le
> 2026-08-26, sur la base où les deux mentions **préexistaient** : **zéro notification**, et un
> second passage n'en produit aucune.
>
> **La cause est la convergence elle-même.** `resolution=ignore-duplicates` fait rendre à PostgREST
> un `on conflict do nothing` : sur une mention déjà posée, **aucune ligne n'est insérée**, donc le
> trigger `AFTER INSERT` **ne s'exécute pas**. La prédiction n'était vraie que sur une base neuve —
> c'est-à-dire dans le seul cas que je n'avais pas mesuré.
>
> **Le seed doit converger dans les deux cas** (`CLAUDE.md` §8) : base neuve, base déjà seedée, et
> base seedée **avant** la migration `0064` comme après. Cette dernière est le cas réel de toute
> pile de développement existante.

**LE GESTE RETENU RESTE LE VRAI CHEMIN, ET IL EST CONDITIONNEL.** Quand la notification attendue
**manque**, l'auteur **retire** sa mention puis la **repose**, avec son propre jeton. Les deux
gestes sont ouverts à l'auteur — `card_comment_mentions_suppression` et
`card_comment_mentions_insertion` portent le **même** prédicat —, donc rien n'emprunte de
raccourci ni de clé de service. Et la reprise produit la notification, le §14.5 le disant en toutes
lettres : « retirer une mention puis la reposer produit une seconde notification, et c'est correct
— c'est un second geste, à un second instant ».

**Convergent parce que CONDITIONNEL** : quand la notification est déjà là, **rien n'est touché**.
Sans la condition, chaque passage en produirait une de plus. Mesuré sur deux passages consécutifs :
le second annonce « déjà produite : rien à faire » pour les deux, et le compte reste **deux**.

**Ce que cette section apprend, au-delà du seed.** Une production par trigger `AFTER INSERT` et un
seed convergent sont en **tension** : le premier a besoin qu'une ligne soit réellement insérée, le
second existe pour éviter de la réinsérer. Toute tranche ultérieure qui produira par trigger
rencontrera la même tension, et devra la traiter par l'état plutôt que par le geste.

---

## 20. Preuves attendues de la tranche 2

| Niveau | Preuves |
|---|---|
| pgTAP | Forme de la table, les trois clés étrangères dans les deux sens, le `check` de `type`, les deux index, la production par le trigger, **l'auto-mention qui ne produit rien** (§14.3), la **survivance** de la notification au retrait de sa mention (§14.4), la date de lecture **imposée par la base** (§15.1), les deux politiques et **l'absence** des deux autres (§16.2), les privilèges y compris l'absence d'`INSERT` et de `DELETE` et la **restriction de colonne** sur `UPDATE`, la **non-appartenance** à la publication (§16.3), et la conformité du seed |
| API | Les seize lignes du §17 avec les jetons réels des trois profils, chaque refus **relu en base** |
| Non-régression | `0061_mentions_commentaires.test.sql` et `e2e/api/mentions.spec.ts` **verts sans modification** : la tranche 2 ajoute une conséquence à la pose d'une mention, elle n'en change pas la règle. Une seule assertion révisée y serait un signal, pas un détail |
| Harnais | `scripts/verify-notifications.sh`, non complaisant, éprouvé par dégradations réelles et restauration constatée |
| Seed | Les deux notifications du §19, **produites** et non posées, et le passage convergent |
| E2E d'interface | **Aucun**, et l'écart est nommé : la tranche 2 ne livre aucune surface (§13.1) |

---
---

# TRANCHE 3 — LA SURFACE ET LE TEMPS RÉEL

Chapitres écrits le **2026-08-26**, **avant la première ligne de code** de la tranche 3
(`CLAUDE.md` §5), et **après mesure sur la pile de développement debout et seedée** — migrations
`0001` à `0064` appliquées, `supabase/seed/apply-seed.sh` passé. Les treize mesures du §21 ont été
prises avec les jetons réels des trois profils ; celles qui écrivent ont été **remises dans l'état
où elles ont trouvé le produit**, et l'état du seed relu après (M9 bis).

Le §1.2 nomme cette tranche en une ligne — « le composeur qui pose une mention, la liste des
notifications, le compteur, l'abonnement Realtime ». Aucun chapitre ne la décrivait. Ces chapitres
sont la spécification qui manquait.

**C'est la PREMIÈRE SURFACE de `CRM-064`.** Les deux tranches précédentes ont livré une règle
d'accès, une table et une production que **personne ne peut voir**. Le §13.1 l'a écrit deux fois :
« un chapitre sur une notification que personne ne peut voir décrirait un geste que personne ne
peut faire ». La tranche 3 est celle qui rend le geste possible — et c'est donc elle qui écrit le
chapitre de `docs/manual.md`.

---

## 21. Les treize mesures de la tranche 3, prises avant d'écrire

Toutes relevées le 2026-08-26 sur la pile de développement, migrations `0001` à `0064` appliquées
et seed passé, avec les jetons réels obtenus par `POST /auth/v1/token?grant_type=password`.
`A` = Camille (`admin`), `B` = Driss (`business_developer`), `V` = Farida (`viewer`).

**M1 — la boîte de `B` porte exactement une notification, non lue.**

```
GET /rest/v1/notifications?select=*   (jeton de B)
=> 200, une ligne :
   id             2163edb1-3e29-4df1-8512-98003467ffc2
   workspace_id   …0001
   recipient_id   …012              (Driss)
   type           "mention"
   subject_card_id …0c1
   payload        { "author_id": "…011", "comment_id": "…0d1" }
   read_at        null
   created_at     2026-08-26T16:25:30.556393+00:00
```

**M2 — la boîte de `A` porte l'autre, et une seule.** `recipient_id` = `…011`, `payload.author_id`
= `…012`, `payload.comment_id` = `…0d2`, `read_at` nul.

**M3 — la boîte de `V` est VIDE, et c'est `200 []`, jamais une erreur.** Le refus se mesure comme
une liste vide, exactement comme la tranche 1 le demandait pour les mentions.

**M4 — le compteur de non-lues se lit en une requête SANS CORPS.**

```
HEAD /rest/v1/notifications?select=id&read_at=is.null    Prefer: count=exact   (jeton de B)
=> 200, en-tête « Content-Range: 0-0/1 »
```

Le nombre est **dans l'en-tête**, et aucune ligne ne traverse le réseau. C'est la lecture qu'une
cloche fait le plus souvent, et c'est la moins chère que la pile sache rendre.

**M5 — l'AFFAIRE s'embarque par la clé étrangère composite, en une seule requête.**

```
GET /rest/v1/notifications?select=id,subject_card_id,
      cards(id,title,channels!cards_channel_id_workspace_id_fkey(slug,name,tracks(slug,name)))
=> 200 : cards.title = « Refonte du site vitrine »,
         channels.slug = « grands-comptes », tracks.slug = « conseil-ia »
```

Les deux slugs arrivent avec le titre. L'adresse d'une affaire les **exige tous les deux**
(`/tracks/:slugTrack/:slugChannel/cards/:idCard`), et aucun ne se déduit de l'autre : c'est
l'embarquement de `docs/SPEC-costs.md` §4.4 et de `colonnes-ma-journee.ts`, repris sans changement.

**M5 bis — `cards` ne porte AUCUNE colonne `slug`.** `select=…,cards(slug)` rend
`42703 column cards_1.slug does not exist`. Une affaire est désignée par son identifiant ; ce sont
son channel et son track qui portent des slugs.

**M6 — le destinataire LIT le profil de l'auteur qui l'a mentionné.**

```
GET /rest/v1/profiles?select=id,full_name,avatar_url&id=eq.…011   (jeton de B)
=> 200 : « Camille Aubert », « /avatars/camille-aubert.svg »
```

**M7 — le destinataire LIT le commentaire qui le mentionne.**

```
GET /rest/v1/card_comments?select=id,body,created_at,deleted_at,author_id&id=eq.…0d1  (jeton de B)
=> 200 : « La DSI a confirmé le périmètre de la refonte : trois gabarits, pas cinq. »
```

Les deux lectures que le §13.4 a rendues nécessaires en refusant toute copie dans le `payload`
**aboutissent réellement**, sous la RLS courante et sans privilège particulier.

**M8 — UNE SEULE REQUÊTE SUFFIT POUR TOUS LES COMMENTAIRES CITÉS, AUTEUR EMBARQUÉ, ET C'EST LA
MESURE QUI CORRIGE UNE PRÉDICTION DU §13.4.**

```
GET /rest/v1/card_comments?select=id,body,deleted_at,author_id,
      auteur:profiles!card_comments_author_id_fkey(id,full_name,avatar_url)
    &id=in.(…0d1,…0d2)                                            (jeton de B)
=> 200, deux lignes, chacune portant son auteur complet
```

Le §13.4 écrivait : « l'écran de la tranche 3 fera **une lecture par notification affichée** ». La
mesure dit autre chose : `id=in.(…)` groupe **toute la page** en une requête, et la relation
`card_comments → profiles` embarque l'auteur au passage. Le coût réel est de **deux requêtes pour
la liste entière** — les notifications avec leur affaire, puis les commentaires avec leurs auteurs
—, et non de `N + 1`. Le §13.4 est **révisé sur place** au §26.3, jamais réécrit.

**M9 — un identifiant INCONNU dans `id=in.(…)` ne fait pas échouer la lecture groupée.**

```
GET /rest/v1/card_comments?select=id&id=in.(…0d1,00000000-0000-4000-8000-000000000000)
=> 200
```

Il rend simplement une ligne de moins. C'est ce qui rend la lecture groupée sûre quand un
commentaire a été **détruit** ou est devenu illisible entre-temps.

**M9 bis — l'état du seed après les mesures : deux notifications, toutes deux non lues.** Les deux
écritures de M10 et M11 ont été **remises** dans leur état de départ.

**M10 — la date de lecture est imposée par la base, et une date antidatée ne survit pas.**

```
PATCH /rest/v1/notifications?id=eq.<N1>  {"read_at":"2016-01-01T00:00:00Z"}   (jeton de B)
=> 204, puis relecture : read_at = 2026-08-26T16:28:05.960975+00:00
```

**M11 — le retour à « non lu » fonctionne, et `null` reste `null`.**

```
PATCH … {"read_at":null}  => 204, relecture : read_at = null
```

Les deux sens du §15.1 sont donc réellement ouverts à l'écran.

**M12 — l'ordre `created_at.desc` est celui que le serveur sait rendre**, et l'index
`(recipient_id, created_at desc)` du §13.7 le sert exactement.

**M13 — SEULE `public.card_comments` est publiée au temps réel.**

```
select schemaname||'.'||tablename from pg_publication_tables where pubname='supabase_realtime';
=> public.card_comments
```

C'est la ligne de base que le §16.3 a figée par une assertion. La tranche 3 est celle qui la
**change**, et qui doit donc réviser cette assertion — dans le même changement que l'écran qui
écoute, jamais avant.

---

## 22. Ce que la tranche 3 est, et ce qu'elle n'est pas

Elle livre **la boîte de réception**, et le geste qui la remplit. Chaque absence est figée par une
assertion ou par un énoncé, jamais compensée :

- **aucune préférence.** Ce que chacun consent à recevoir est la tranche 4 (§18, point 3) ;
- **aucune rétention.** Rien ne supprime, rien n'expire. Le point ouvert n° 1 du §18 est
  **rencontré** ici pour la première fois, et il est traité par une **borne de lecture**, jamais
  par une suppression que personne n'a spécifiée (§26.5) ;
- **aucun regroupement.** Dix mentions sur la même affaire rendent dix lignes. Le point ouvert
  n° 2 reste ouvert, et le §26.6 dit pourquoi il n'est pas tranché ici ;
- **aucun canal sortant.** Ni email, ni digest, ni notification du navigateur ;
- **aucune analyse du corps d'un commentaire.** Le §4.4 tient sans changement : la syntaxe `@`
  n'existe pas, et le composeur de la sous-tranche 3b pose des mentions par un **sélecteur**, pas
  en lisant du texte.

### 22.1 Découpage en deux sous-tranches, et son motif

La tranche 3 porte deux surfaces qui ne dépendent pas l'une de l'autre : celle qui **reçoit** et
celle qui **envoie**. Le seed livre déjà deux notifications (§19), donc la première se prouve
**immédiatement** et de bout en bout ; la seconde produit ce que la première montre.

| Sous-tranche | Objet | Ce qu'elle livre |
|---|---|---|
| **3a** | **La réception** | La publication au temps réel, le module de lecture, la cloche et son compteur, le panneau de liste, le marquage lu / non lu, l'abonnement. |
| 3b | L'émission | Le sélecteur de personnes du composeur de commentaires, qui pose une mention par le vrai chemin de la tranche 1. |

**Ce document spécifie intégralement la sous-tranche 3a**, et énonce au §30 le contrat que 3b
devra tenir. Le découpage est celui que `CRM-060` a employé pour ses dix sous-tranches, et il est
pris ici pour le motif que le §0 de `docs/CloudWorker.md` impose : une session interrompue doit
laisser derrière elle une surface **entière et prouvée**, pas deux moitiés.

---

## 23. Où la surface vit, et pourquoi là

### 23.1 La cloche est dans l'EN-TÊTE, pas dans la barre latérale

`docs/DESIGN_SYSTEM.md` §4 décrit l'en-tête comme portant « fil d'Ariane · recherche · Cmd+K ·
profil » et la barre latérale comme portant les **destinations** — Inbox, Contacts, Objectifs,
Coûts, Ma journée, Réglages. Une notification n'est pas une destination : c'est un **état de
l'utilisateur courant**, au même titre que son identité de session, qui vit déjà dans l'en-tête
(§5.12).

Deux conséquences que ce choix assume :

- **la cloche est visible depuis TOUS les écrans**, l'en-tête étant rendu par la coquille. Une
  entrée de barre latérale l'aurait été aussi, mais elle aurait fait passer la boîte pour un
  septième écran de travail, à côté du carnet et de « Ma journée » ;
- **elle vit à côté de l'identité de session**, avant l'action de déconnexion. L'ordre de l'en-tête
  devient : fil d'Ariane, contexte d'espace de travail, **cloche**, identité, déconnexion. Ce qui
  concerne *ce que le produit a à me dire* précède ce qui concerne *qui je suis*, et le geste qui
  **sort** du produit ferme la ligne.

### 23.2 La liste est un PANNEAU sous la cloche, jamais une route, jamais une modale

**Jamais une modale**, et ce n'est pas une préférence : `docs/DESIGN_SYSTEM.md` §5 n'en déclare
aucune, et `CRM-043` puis `CRM-075` ont tranché ce cas deux fois — « une surface qui recouvre
l'écran demanderait un piège de focus, une gestion d'`Échap` et le voile `--color-veil`, trois
mécanismes qu'aucune unité n'a spécifiés ».

**Jamais une route non plus**, et c'est l'écart avec le carnet (§5.19) et « Ma journée » (§5.36).
Le critère est celui que `docs/DESIGN_SYSTEM.md` §5.33 emploie pour ranger une adresse : une route
sert une surface **où l'on va travailler**. On ne va pas travailler dans sa boîte de notifications
— on y jette un œil, on l'ouvre, on suit un lien, et l'on retourne à ce qu'on faisait. Une route
ferait **perdre l'écran courant** à chaque coup d'œil, et obligerait à revenir.

**Le panneau est donc ancré à la cloche, dans le flux du document**, et il se referme par `Échap`,
par un clic hors de lui, et par la cloche elle-même. C'est le patron du §5.3 quater — « le panneau
remplace la commande, il ne s'y ajoute pas » —, à ceci près que la cloche **reste rendue** : elle
est l'ancre visuelle du panneau et porte `aria-expanded`.

### 23.3 Ce que le panneau n'a PAS

- **aucun filtre**, ni « non lues seulement », ni par affaire. La liste est courte par
  construction (§26.5), et un filtre sur une liste de dix lignes est un contrôle sans objet — la
  règle du §5.11 pour la barre de filtres du fil ;
- **aucune pagination**, et l'écart est nommé au §26.5 avec la condition de sa reprise ;
- **aucun « tout marquer comme lu »**. Le geste est tentant et il est **écarté par mesure** : il
  écrirait `read_at` sur N lignes en un `PATCH` dont la clause `USING` filtre en silence, et le
  §5.40 de `docs/DESIGN_SYSTEM.md` exige alors qu'un « sans effet » **partiel** soit dit — or un
  `PATCH` de masse ne dit pas *lesquelles* n'ont pas bougé. Livrer un geste dont on ne sait pas
  rendre compte serait la simulation de succès que `CLAUDE.md` §18 interdit. Le point est nommé
  au §29, point 3.

---

## 24. Le modèle de lecture : ce que l'écran demande

### 24.1 Deux requêtes, et deux seulement

**Requête 1 — les notifications, avec leur affaire embarquée** (M5) :

```
select=id,type,read_at,created_at,subject_card_id,payload,
       cards(id,title,channels!cards_channel_id_workspace_id_fkey(slug,name,tracks(slug,name)))
&order=created_at.desc
&limit=<BORNE_LISTE>
```

**Requête 2 — les commentaires cités, avec leur auteur embarqué** (M8), émise **seulement si** la
première a rapporté au moins un `payload.comment_id` :

```
select=id,body,deleted_at,author_id,auteur:profiles!card_comments_author_id_fkey(id,full_name,avatar_url)
&id=in.(<les identifiants distincts de la page>)
```

**LE `payload` N'EST PAS UNE CLÉ ÉTRANGÈRE, ET C'EST POURQUOI IL FAUT DEUX REQUÊTES.** Le §13.4
refuse toute copie de contenu dans la charge utile ; la contrepartie est que PostgREST ne peut pas
embarquer le commentaire, faute de relation déclarée. La lecture groupée est la réponse la moins
chère que la pile sache rendre, et M8 la mesure.

**AUCUNE TROISIÈME REQUÊTE POUR LE COMPTEUR quand le panneau est ouvert** : le compteur se déduit
des lignes rendues. Le `HEAD` de M4 sert la cloche **fermée**, où il n'y a rien d'autre à lire.

### 24.2 Ce qui n'est PAS demandé, et c'est une décision

Ni `workspace_id` — l'écran ne l'affiche pas —, ni `recipient_id` — la politique garantit déjà que
c'est moi, et le redemander laisserait croire qu'on pourrait lire celui d'un autre. Une requête ne
rapporte que ce que l'écran montre : c'est la règle que `COLONNES_COMMENTAIRE` tient depuis
`CRM-043`.

### 24.3 Trois lignes possibles, et l'écran les distingue

| Cas | Ce que la lecture rend | Ce que la ligne montre |
|---|---|---|
| **complet** | la notification, son affaire, son commentaire et son auteur | l'auteur, l'extrait, l'affaire, la date, le lien |
| **commentaire illisible ou détruit** | la notification et son affaire ; **aucune** ligne dans la requête 2 (M9) | l'affaire, la date, le lien — **aucun extrait, aucun auteur** |
| **affaire illisible** | ne peut pas arriver | — |

**Le troisième cas est impossible, et c'est une propriété de la politique, pas une chance** : le
prédicat du §16.1 exige `app.can_read_card(subject_card_id)`. Une notification dont l'affaire est
devenue illisible **sort de la liste entière** ; l'écran n'a donc jamais à rendre une ligne dont
l'affaire manque, et il ne prévoit **aucun** rendu pour ce cas. Écrire un repli pour un état que la
base rend impossible enseignerait qu'il peut arriver.

**Le second, lui, arrive réellement** : le §14.4 conserve la notification quand la mention est
retirée, et le §13.4 rappelle qu'une suppression de commentaire **vide réellement le corps**. La
ligne dégradée est donc le rendu normal d'un propos retiré, et elle ne dit **ni** que le
commentaire a été supprimé, **ni** qu'il est illisible : les deux causes sont indistinguables à
l'écran, exactement comme le §5.40 de `docs/DESIGN_SYSTEM.md` l'exige d'un zéro-ligne.

---

## 25. Le temps réel

### 25.1 La table est publiée, DANS LE MÊME CHANGEMENT que l'écran qui l'écoute

Le §16.3 posait l'absence de publication et disait la condition de sa levée : « la tranche 3
publiera la table dans le même changement que l'écran qui l'écoute ». La condition est remplie, et
la levée se fait **par livraison**, jamais par précaution.

La migration `0065` ajoute `public.notifications` à `supabase_realtime`, **idempotente** comme
celle de `card_comments` (`0015` §8) : le `migrations-runner` rejoue le répertoire à chaque
démarrage, et `alter publication … add table` rend `42710` sur une table déjà publiée.

`REPLICA IDENTITY` reste à sa valeur par défaut — la clé primaire. Elle suffit : aucune suppression
n'est exposée (§15.4), et le marquage lu est un `UPDATE` dont la ligne d'arrivée est lisible par
son destinataire.

**LE TEMPS RÉEL EST UNE SURFACE D'AUTORISATION.** `realtime.apply_rls` évalue la politique `SELECT`
de la table pour le rôle et les revendications de **chaque** abonné : un membre qui n'est pas le
destinataire ne reçoit **rien**, et un destinataire dont le droit sur l'affaire retombe cesse de
recevoir. C'est une propriété qui se **prouve** — le contrat d'API du §27 l'exerce comme telle —,
et c'est la raison pour laquelle publier une table que personne n'écoute était refusé.

### 25.2 Les deux règles de l'abonnement sont celles de `CRM-043`, reprises SANS changement

`useFilCommentaires` les a établies et mesurées (décisions 195 et 201) ; les recopier autrement ici
en ferait diverger une.

1. **La lecture est déclenchée par l'abonnement, jamais avant.** Charger puis s'abonner laisse une
   fenêtre dont la largeur n'est connue de personne ; s'abonner puis charger la referme, au prix
   d'une lecture. `SUBSCRIBED`, `CHANNEL_ERROR` et `TIMED_OUT` déclenchent tous les trois la
   lecture : une cloche muette serait pire qu'une cloche qui ne se met pas à jour toute seule.

2. **Le flux DÉCLENCHE la lecture, il ne la remplace pas.** Un événement ne porte pas la boîte : il
   dit qu'elle a changé. C'est une requête de plus par événement, et c'est le prix de trois choses
   qu'aucune fusion locale ne donnerait — l'ordre total est celui du serveur, un événement perdu ou
   dupliqué ne laisse aucune trace, et la lecture applique la **RLS courante** plutôt que celle du
   moment de l'abonnement.

### 25.3 Le canal, son nom et son filtre

```
nom     : « notifications:<identifiant du destinataire> »
filtre  : « recipient_id=eq.<identifiant du destinataire> »
table   : public.notifications, événement « * »
```

**Le filtre porte sur le destinataire, et il n'est PAS une garde d'accès.** La politique du §16.1
est la garde, et elle est évaluée par `realtime.apply_rls` quoi qu'il arrive. Le filtre est une
**économie** : sans lui, le serveur évaluerait la politique pour chaque ligne insérée dans toute la
table avant de conclure qu'elle ne me concerne pas.

**Le nom porte l'identifiant du destinataire**, et non un nom fixe : deux sessions ouvertes dans le
même navigateur — deux onglets, deux comptes — s'abonneraient sinon au **même** canal, et le
client `supabase-js` réutilise un canal par son nom. C'est le procédé de `nomCanal(idCard)` de
`CRM-043`, transposé à l'objet qui varie ici.

**AUCUN ABONNEMENT SANS SESSION.** Le hook ne s'abonne pas tant que l'identifiant du destinataire
est inconnu : un anonyme n'a aucune notification (M3), et ouvrir un canal pour ne rien recevoir
coûterait une connexion permanente à chaque visiteur de l'écran de connexion.

---

## 26. Ce que l'écran rend, règle par règle

Les règles **visuelles** vivent dans `docs/DESIGN_SYSTEM.md` §5.43, écrit dans le même changement.
Ce chapitre dit ce que l'écran **lit, calcule et refuse de deviner**.

### 26.1 Le compteur

**Il compte les non-lues, jamais le total.** Une cloche portant « 12 » sur douze messages tous lus
ne dirait rien qui vaille d'être affiché.

**Il est ABSENT tant que le compte n'est pas connu**, et pas seulement à zéro. C'est la règle que
`docs/DESIGN_SYSTEM.md` §5.31 a posée pour le badge de l'onglet « À saisir » : pendant la lecture,
un badge « 0 » affirmerait que tout est lu alors que rien n'a été lu — la valeur par défaut
trompeuse que `CLAUDE.md` §18 interdit.

**Il est absent à zéro**, pour la même règle : l'absence dit déjà ce que « 0 » répéterait.

**Il est BORNÉ à l'affichage, et la borne est dite.** Au-delà de `BORNE_COMPTEUR` (99), la cloche
écrit « 99+ ». Ce n'est pas une troncature silencieuse : le nom accessible de la cloche porte le
**compte exact**, et c'est lui que le lecteur d'écran annonce. Un badge à quatre chiffres
déformerait la cloche, et un compte exact que personne ne lit à l'œil ne vaut pas cette déformation.

### 26.2 L'ordre de la liste

**Le plus récent en haut, sans exception**, et c'est l'INVERSE du fil de commentaires (§5.10 du
design system, ordre chronologique croissant). L'écart est **voulu** et il est écrit ici pour qu'on
ne l'aligne pas par habitude : une conversation se lit dans le sens où elle s'est tenue, une boîte
de réception se lit en commençant par ce qui vient d'arriver.

**Les non-lues ne remontent PAS en tête.** Un second critère de tri ferait **sauter** une ligne
d'un endroit à l'autre au moment exact où l'on vient de la marquer lue — et l'utilisateur perdrait
de vue ce qu'il vient de toucher. L'état de lecture se rend par la **forme** (§5.43), jamais par la
place.

### 26.3 La ligne ne porte AUCUNE copie, et le §13.4 est révisé sur son COÛT

Le contenu affiché — le nom de l'auteur, l'extrait du propos, le titre de l'affaire — est **relu à
travers les politiques existantes**, jamais pris dans le `payload`. Le §13.4 tient sans changement
sur le fond.

> **RÉVISION DU §13.4 PAR LA MESURE, 2026-08-26** (mécanisme de la décision 51). Il annonçait « une
> lecture par notification affichée, là où une charge utile dénormalisée en aurait fait zéro ».
> **MESURÉ (M8)** : `id=in.(…)` groupe toute la page en **une** requête, et la relation
> `card_comments → profiles` y embarque l'auteur. Le coût réel est de **deux requêtes pour la liste
> entière**, et non de `N + 1`. Ce que le §13.4 décidait — aucune copie — est **inchangé** ; seule
> son estimation de coût était fausse, et elle l'était **en défaveur** de la décision prise. La
> conclusion qu'il tirait n'en est que plus solide.

**L'extrait est BORNÉ à l'affichage, jamais à la lecture.** La requête rapporte le corps entier ; la
ligne en montre les premiers caractères. Borner au serveur exigerait une vue ou une fonction, donc
une **seconde** écriture de ce que l'écran montre, pour économiser des octets que personne n'a
mesurés (`CLAUDE.md` §21).

### 26.4 Le geste de lecture

**Marquer lu et marquer non lu, les deux sens** (§15.1). Le second n'est pas un ornement : on ouvre
une notification par mégarde, et une boîte dont on ne peut pas remettre un message de côté n'est
pas une boîte.

**LE CLIC SUR LA LIGNE NE MARQUE RIEN.** Suivre un lien et marquer lu sont deux gestes, et les
fondre ferait disparaître le compteur d'une notification qu'on a seulement effleurée en visant
autre chose. Le marquage est **son propre bouton**, sur la ligne. C'est la distinction que le §5.13
du design system tient depuis la première surface d'administration — « une ligne entièrement
cliquable rendrait ambiguë la cible d'un clic qui porte déjà plusieurs commandes ».

**LES TROIS ISSUES, ET LA TROISIÈME DOIT ÊTRE DITE.** Un `PATCH` est filtré par la clause `USING`
de `notifications_marquage` : le serveur rend `204` **sans erreur** et sans avoir rien changé
(ligne *i* du §17, mesurée). L'écran écrit alors « aucune notification n'a été modifiée », **relit**
la liste, et n'affirme **ni** le refus **ni** la disparition — les deux étant indistinguables. C'est
la règle des §5.25, §5.27, §5.28 et §5.40 du design system, retrouvée ici pour la même cause
structurelle.

**AUCUNE COMMANDE N'EST ÉTEINTE D'AVANCE**, quel que soit le rôle (§5.3, §5.13, §5.16, §5.21,
§5.27, sans exception). L'écran n'a d'ailleurs aucun droit à calculer : la seule ligne qu'il rend
est déjà la sienne.

**LE MARQUAGE EST OPTIMISTE À L'ÉCRAN ? NON.** La ligne ne change qu'après la réponse du serveur.
Le §5.3 sexies a déjà tranché ce cas pour la mise en sommeil, et pour le même motif : le geste
change le **compteur**, c'est-à-dire une valeur visible ailleurs sur l'écran, et une annulation
ferait clignoter deux endroits à la fois.

### 26.5 La borne de lecture, et le point ouvert n° 1 qu'elle traite SANS le trancher

La liste lit **au plus `BORNE_LISTE` lignes** (20), les plus récentes. Ce n'est pas une pagination :
il n'y a ni page suivante, ni « voir tout », et l'écart est **nommé** plutôt que comblé.

**Le motif est le point ouvert n° 1 du §18** — aucune notification ne se supprime ni n'expire, donc
une boîte croît indéfiniment. Une liste non bornée finirait par lire des milliers de lignes pour en
montrer dix. La borne est la réponse **la moins engageante** qui rende l'écran sûr : elle ne détruit
rien, elle ne décide d'aucune rétention, et elle tombe le jour où le responsable en tranche une.

**LE COMPTEUR, LUI, N'EST PAS BORNÉ PAR CETTE VALEUR** : il compte **toutes** les non-lues (M4),
pas seulement celles de la page. Un compteur qui s'arrêterait à vingt mentirait sur ce qui reste à
lire, et c'est précisément ce qu'une cloche existe pour dire. La borne d'**affichage** du §26.1
(« 99+ ») est autre chose : elle borne le dessin, pas la mesure.

**Ce que la borne coûte est dit à l'écran** : lorsque la liste est pleine, le panneau écrit en
toutes lettres qu'il montre les plus récentes. Une troncature silencieuse se lirait comme une boîte
complète.

### 26.6 Le regroupement n'est PAS livré, et le motif est écrit

Le point ouvert n° 2 du §18 — dix mentions sur la même affaire rendent dix messages — reste
**ouvert**. Regrouper demanderait de décider ce que devient l'état de lecture d'un groupe (lu si
toutes ? si une ?), quel extrait le groupe porte, et ce que le compteur compte. Trois décisions de
produit qu'aucune mesure ne donne, et que le seed n'exerce pas : ses deux notifications ont deux
auteurs différents sur la même affaire. L'inventer ici serait écrire une spécification à la place du
responsable (`CLAUDE.md` §1).

### 26.7 Les quatre états, et le vide qui n'en est pas un

Les quatre états du §5.8 du design system sont traités : chargement, erreur avec reprise **qui
relit réellement**, liste vide, et l'absence de session.

**L'ÉTAT VIDE N'OFFRE AUCUNE ACTION**, et c'est l'écart au §5.8 que la corbeille (§5.16), le carnet
(§5.19) et les affaires figées (§5.37) prennent déjà. Il n'y a rien à faire d'une boîte vide, et un
bouton y serait un chemin vers nulle part. **Le message dit que l'état est SAIN** — « aucune
notification » n'est pas un manque.

**SANS SESSION, LA CLOCHE N'EST PAS RENDUE.** C'est l'écart avec le reste de l'en-tête, qui rend
« Se connecter » à sa place (§5.12). Une cloche vide offerte à un anonyme annoncerait une boîte
qu'aucune session ne peut remplir, et son compteur serait un zéro permanent.

---

## 27. Contrat d'API de la sous-tranche 3a, ligne à ligne

Les seize lignes du §17 restent **vraies et vertes sans modification** : la tranche 3 ne change
aucune règle de la table. Les lignes ci-dessous sont **celles que la tranche 3 ajoute**, et elles
portent toutes sur ce que la publication au temps réel change ou ne change pas.

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| q | — | `select … from pg_publication_tables where pubname='supabase_realtime'` | `public.notifications` **y figure** — la ligne de base de M13 est changée par la migration `0065` |
| r | `B` | `GET /notifications?select=…,cards(id,title,channels(slug,name,tracks(slug,name)))` | `200`, une ligne, l'affaire et **les deux slugs** embarqués (M5) |
| s | `B` | `HEAD /notifications?select=id&read_at=is.null` avec `Prefer: count=exact` | `200`, en-tête `Content-Range` portant le compte (M4) |
| t | `B` | `GET /card_comments?select=…,auteur:profiles!…(…)&id=in.(…0d1,<inconnu>)` | `200`, **une** ligne avec son auteur — l'identifiant inconnu ne fait pas échouer (M8, M9) |
| u | `V` | abonnement `Realtime` à `notifications`, filtre `recipient_id=eq.<Farida>` | l'abonnement **s'établit**, et **aucun événement** n'est reçu quand une notification naît pour un autre |
| v | `B` | abonnement `Realtime`, filtre `recipient_id=eq.<Driss>` ; puis `A` pose une mention sur `B` | **un événement `INSERT` est reçu**, et la relecture rend la nouvelle notification |
| w | anonyme | abonnement `Realtime` à `notifications` | aucun événement — `auth.uid()` est nul, le prédicat du §16.1 est faux |

**Les lignes *u*, *v* et *w* sont le cœur du contrat de cette tranche** : elles éprouvent le temps
réel **comme une surface d'autorisation**, ce qu'aucune preuve du dépôt ne fait encore pour cette
table. Les autres éprouvent la lecture que l'écran émet.

**Chaque ligne posée est retirée, et une dernière lecture le constate** (décision 501). L'état du
seed après la suite est celui d'avant : deux notifications, toutes deux non lues.

---

## 28. Ce que le seed livre, et ce qu'il ne change pas

**Rien de neuf, et cette fois c'est mesuré avant d'être écrit** (la leçon du §19). Le seed pose déjà
deux notifications par le vrai chemin ; la tranche 3 ne pose aucune ligne et n'en retire aucune.

Sa **garde** existante — deux notifications, toutes deux non lues, aucune pour la lectrice — reste
vraie sans modification. Aucune garde n'est ajoutée : la tranche 3 ne livre aucune donnée, elle
livre une surface qui montre celles qui existent.

**Ce que le seed exerce déjà pour cette surface, et qui n'est pas une chance** : les deux
notifications ont **deux destinataires différents** et **deux auteurs différents**, si bien que la
cloche de Camille et celle de Driss montrent chacune une ligne, et une seule — et que la preuve
d'interface peut vérifier que ni l'une ni l'autre ne voit celle de l'autre. Farida, elle, ouvre une
boîte **vide**, ce qui exerce l'état vide du §26.7 sans aucune donnée fabriquée.

---

## 29. Points ouverts, nommés et non tranchés ici

1. **La rétention** (point n° 1 du §18) est **rencontrée** mais non tranchée : la borne de lecture
   du §26.5 rend l'écran sûr sans décider quoi que ce soit. Le responsable doit trancher au bout de
   combien de temps une notification disparaît, et avec quel effet sur le compteur.
2. **Le regroupement** (point n° 2 du §18) reste ouvert — §26.6.
3. **« Tout marquer comme lu » n'est pas livré** — §23.3. Le geste demande de savoir rendre compte
   d'un `PATCH` de masse dont la clause `USING` filtre en silence, et le dépôt n'a aucun précédent
   pour ce cas. Il appartient à une tranche ultérieure, ou à un arbitrage.
4. **Aucune préférence** (point n° 3 du §18) : la tranche 4.
5. **Aucune notification du navigateur**, ni son, ni titre d'onglet modifié. Trois mécanismes qui
   demandent un consentement explicite (`CLAUDE.md` §11) et qu'aucun document ne porte.
6. **Le compteur ne se met pas à jour lorsque la boîte change dans un AUTRE onglet du même
   navigateur.** Chaque onglet tient son propre abonnement, donc il se met bien à jour ; mais rien
   ne partage l'état entre onglets, et deux onglets peuvent afficher deux comptes pendant le temps
   d'un aller-retour. L'écart est **nommé** plutôt que comblé par un `BroadcastChannel` que
   personne n'a spécifié.

---

## 30. Le contrat que la sous-tranche 3b devra tenir

Écrit ici pour que le périmètre de 3a soit lisible, et **à compléter avant son code**, jamais après.

- **Le composeur pose une mention par le VRAI chemin de la tranche 1** : un `POST` sur
  `card_comment_mentions` avec le jeton de l'auteur, après la publication du commentaire. Aucune
  analyse du corps (§4.4), aucun raccourci par la clé de service.
- **La mention se pose APRÈS le commentaire, et c'est une contrainte du modèle** : la clé primaire
  est `(comment_id, profile_id)`, donc le commentaire doit exister. Les deux écritures ne sont pas
  atomiques, et 3b devra dire ce que l'écran fait quand la seconde échoue — un commentaire publié
  sans sa mention est le cas à traiter, pas à taire.
- **Le sélecteur n'offre que des personnes ÉLIGIBLES au sens du §5.1**, et le refus reste
  **traduit** : l'écran ne calcule aucun droit, il envoie et traduit le refus (§5.22 du design
  system, sans exception).
- **`docs/manual.md` gagne son chapitre avec 3a**, pas avec 3b : c'est 3a qui livre la surface, et
  un manuel décrivant un geste dont personne ne voit l'effet ne décrirait rien.

---

## 31. Preuves attendues de la sous-tranche 3a

| Niveau | Preuves |
|---|---|
| pgTAP | L'**appartenance** de `public.notifications` à `supabase_realtime` — assertion **révisée**, jamais retirée (§16.3, M13) —, et la non-régression des quarante-deux assertions de `0062` |
| Unitaire | La chaîne `select` réellement émise par les deux requêtes du §24.1, le nom et le filtre du canal (§25.3), le découpage des trois cas de ligne du §24.3, la borne du compteur (§26.1), la borne de lecture (§26.5), et les trois issues du marquage (§26.4) |
| API | Les sept lignes du §27, dont **trois abonnements `Realtime` réels** avec les jetons des trois profils, chaque refus mesuré comme une **absence d'événement** et non comme une erreur |
| Non-régression | `0062_notifications.test.sql` et `e2e/api/notifications.spec.ts` verts **sans autre modification que l'assertion de publication** ; `0061` et `e2e/api/mentions.spec.ts` verts **sans aucune** |
| E2E d'interface | Le parcours complet des trois profils : la cloche et son compteur, l'ouverture du panneau, la ligne et son lien, le marquage lu puis non lu, la boîte vide de Farida, l'absence de cloche pour l'anonyme, `Échap` et le retour du focus |
| Visuel | Captures aux quatre paliers, panneau ouvert et fermé, boîte peuplée et boîte vide, **observées** conformément à `CLAUDE.md` §16. Console **vierge** |
| Harnais | `scripts/verify-notifications-surface.sh`, non complaisant, éprouvé par dégradations réelles et restauration constatée |

---

# SOUS-TRANCHE 3B — L'ÉMISSION

## 32. Les neuf mesures de la sous-tranche 3b, prises avant d'écrire

Toutes relevées le 2026-08-26 sur la pile de développement, migrations `0001` à `0065` appliquées et
seed passé, avec les jetons réels obtenus par `POST /auth/v1/token?grant_type=password`.
`A` = Camille (`admin`), `B` = Driss (`business_developer`), `V` = Farida (`viewer`).

**Toutes les sondes écrites ci-dessous ont été DÉTRUITES, et l'état du seed relu après** : cinq
commentaires, deux mentions, deux notifications — exactement l'état d'avant (`CLAUDE.md` §9).

**M1 — l'éligibilité du §5.1, mesurée profil par profil et card par card**, directement sur
`app.can_read_card_pour` :

```
card …0c1 (channel « Grands comptes »)   Camille t   Driss t   Farida f
card …0c4 (channel « Refonte de site »)  Camille t   Driss t   Farida t
card …0c5 (channel « Maintenance »)      Camille t   Driss t   Farida t
```

C'est le fait qui rend la preuve de 3b stricte, et il existe **déjà dans le seed** : la même
personne est éligible sur une affaire et ne l'est pas sur une autre. Un sélecteur qui offrirait
partout la même liste serait faux sur `…0c1`, et seulement là.

**M2 — les trois membres du workspace sont lisibles par les TROIS profils**, `viewer` compris :

```
GET /rest/v1/workspace_members?select=user_id,profiles(full_name)   (jetons A, B, V)
=> 200, trois lignes pour chacun : Camille Aubert, Driss Lemoine, Farida Nowak
```

`lireMembresAffectables` (`entete-card.ts`, `CRM-060`) rend donc **exactement cette liste**. Elle
est le bon universel — le nom d'un collègue est une donnée d'équipe —, mais elle **n'est pas** la
liste des personnes mentionnables : elle ignore l'éligibilité, qui dépend de l'affaire.

**M3 — la conséquence, mesurée et non supposée** : une mention posée sur `…0d1` (card `…0c1`) pour
Farida, avec le jeton réel de Camille qui en est l'auteur, est **refusée** :

```
POST /rest/v1/card_comment_mentions   (jeton de A)
{ comment_id: …0d1, profile_id: …013, workspace_id: …0001 }
=> 400  { "code": "P0001",
          "message": "mention_destinataire_sans_acces",
          "details": "Une mention ne désigne que quelqu'un qui peut lire cette affaire." }
```

Un sélecteur alimenté par M2 proposerait donc un nom que le backend refuse — la commande morte que
le §5.10 du design system interdit.

**M4 — la politique d'insertion refuse la mention posée sur le commentaire d'AUTRUI**, et le refus
n'a pas la même forme que M3 :

```
POST /rest/v1/card_comment_mentions   (jeton de A, sur …0d2 qui est le commentaire de B)
{ comment_id: …0d2, profile_id: …012, workspace_id: …0001 }
=> 403  { "code": "42501",
          "message": "new row violates row-level security policy for table \"card_comment_mentions\"" }
```

Le trigger du §6 juge le **destinataire** ; la politique du §7.1 juge l'**auteur**. Deux refus, deux
codes, deux causes — et l'écran ne doit pas les confondre.

**M5 — UN `POST` GROUPÉ EST TOUT OU RIEN, ET C'EST LA MESURE QUI DÉCIDE LA FORME DE L'ÉMISSION.**
Deux mentions envoyées dans un seul tableau, la première éligible et la seconde non :

```
POST /rest/v1/card_comment_mentions   (jeton de A)
[ { comment_id: <sonde>, profile_id: …012 },      ← Driss, éligible
  { comment_id: <sonde>, profile_id: …013 } ]     ← Farida, inéligible sur cette card
=> 400  P0001 mention_destinataire_sans_acces
   état relu : AUCUNE mention posée, pas même celle de Driss
```

Une seule entrée périmée fait donc perdre **toutes** les mentions du commentaire, et le refus ne dit
**pas laquelle** est en cause. Le §35 en tire sa décision.

**M6 — deux `POST` SÉPARÉS rendent un résultat PARTIEL, et chacun est nommé** :

```
POST … profile_id=…012   => 201
POST … profile_id=…013   => 400  P0001 mention_destinataire_sans_acces
état relu : une mention, celle de Driss
```

C'est le cas que le §30 demandait de traiter plutôt que de taire.

**M7 — la liste des personnes mentionnables se calcule EN BASE, et la sonde le mesure.** La fonction
candidate du §34, créée dans une transaction **annulée**, exécutée sous le rôle `authenticated` avec
les revendications réelles :

```
sous Camille, card …0c1  =>  Driss Lemoine                      (une ligne)
sous Camille, card …0c5  =>  Driss Lemoine, Farida Nowak        (deux lignes)
sous Farida,  card …0c5  =>  Camille Aubert, Driss Lemoine      (deux lignes)
```

Farida est absente de la première liste par l'éligibilité, et l'appelant est absent des trois par la
règle du §34.3.

**M8 — LE REFUS DE LECTURE DE CETTE FONCTION EST ZÉRO LIGNE, JAMAIS UNE ERREUR.** Même sonde, sous
Farida, sur la card `…0c1` qu'elle ne lit pas :

```
sous Farida, card …0c1  =>  0 ligne
```

C'est la forme exigée par la preuve de refus n° 4 de `docs/SPEC-permissions-rls.md` §7, et celle que
`public.cards_figees` a établie pour une RPC de lecture (`CRM-062`).

**M9 — la notification naît bien de la mention posée par ce chemin.** La sonde de M6 a produit une
notification pour Driss, dont le `payload.comment_id` désignait le commentaire sonde ; elle a été
détruite avec lui, et le compte est revenu à deux.

---

## 33. Ce que la sous-tranche 3b est, et ce qu'elle n'est pas

Elle livre **le geste qui remplit la boîte** : choisir, dans le composeur de commentaires, les
personnes que ce commentaire mentionne, et poser ces mentions par le vrai chemin de la tranche 1.

Chaque absence est figée par un énoncé, jamais compensée :

- **aucune syntaxe `@`.** Le §4.4 tient sans changement : rien ne lit le corps d'un commentaire. Le
  choix se fait par un **sélecteur**, et l'auteur voit qui il mentionne avant d'envoyer ;
- **aucune mention posée après coup.** Le sélecteur appartient au composeur, pas à la ligne d'un
  commentaire déjà publié. Corriger les mentions d'un commentaire existant demanderait une surface
  d'édition que le §7.1 ouvre en base (`DELETE` est accordé à l'auteur) mais qu'aucun document ne
  décrit ; c'est le point ouvert n° 1 du §39 ;
- **aucun retrait de mention depuis l'écran**, pour la même raison ;
- **aucune préférence** : la tranche 4 ;
- **aucune recherche dans le sélecteur.** Le nombre de membres d'un workspace n'est pas mesuré ;
  c'est le raisonnement du §5.22 du design system, repris sans changement, et le point ouvert n° 2.

---

## 34. D'où vient la liste du sélecteur : `public.mentionnables`

### 34.1 Le problème, et il est le même qu'au §5.2

Le §30 pose deux exigences qui se contredisent en apparence : **le sélecteur n'offre que des
personnes éligibles**, et **l'écran ne calcule aucun droit** (`CLAUDE.md` §10, §5.22 du design
system). M2 et M3 mesurent la contradiction : la seule liste que l'écran sait lire aujourd'hui —
les membres du workspace — contient un nom que le backend refuse.

Deux voies s'offraient, et la seconde est retenue :

- **filtrer dans l'écran** en relisant `track_members` et `channel_members`. **Refusée** : ce serait
  la **seconde écriture de la règle d'accès** que le §5.3 a refusée en base, réécrite cette fois en
  TypeScript — donc divergente au premier niveau de droit ajouté, et invérifiable hors navigateur ;
- **demander la liste au backend**, qui porte déjà la règle. **Retenue.**

### 34.2 La forme : une RPC de lecture, `SECURITY INVOKER`

```sql
public.mentionnables(card_id uuid)
  returns table (profile_id uuid, full_name text, avatar_url text)
  language sql  stable  security invoker  set search_path to ''
```

Elle rend les membres du workspace de l'affaire pour lesquels `app.can_read_card_pour(card, profil)`
est vrai, ordonnés par nom.

**`SECURITY INVOKER`, et c'est le point même de la fonction** — la forme de `public.cards_figees`
(`CRM-062` §3.2). En `SECURITY DEFINER`, elle répondrait pour `postgres`, qui traverse toute la RLS,
et rendrait la liste des membres d'un workspace que l'appelant n'atteint pas : une fuite, pas une
commodité. En `INVOKER`, la lecture de `public.cards` applique la RLS de l'appelant, si bien qu'une
affaire qui ne lui est pas ouverte rend **zéro ligne** — mesuré en M8.

**`app.can_read_card_pour` reste la SEULE écriture de la règle.** La fonction ne juge rien : elle
l'appelle pour chaque membre. C'est la chaîne que la tranche 1 a généralisée (§5.3), employée ici
pour la première fois par une surface.

**`stable` et non `volatile`** : PostgREST n'expose en `GET` que les fonctions non volatiles, et
l'écran lit cette liste, il ne la modifie pas.

**`workspace_members` est l'universel, et le §5.1 le justifie** : l'accès effectif se résout depuis
le rôle de workspace, puis les surcharges de track et de channel. Une personne absente de
`workspace_members` n'a aucun rôle, donc aucun accès — la joindre par une autre table ajouterait un
chemin que `app.resolve_access` ne connaît pas.

### 34.3 L'APPELANT NE FIGURE PAS DANS SA PROPRE LISTE

Le §14.3 a mesuré qu'une auto-mention est **acceptée** par la tranche 1 et ne produit **aucune**
notification. Offrir son propre nom dans le sélecteur serait donc offrir un geste voué au néant :
la mention serait posée, et personne ne serait prévenu — exactement la commande morte que le §5.10
du design system refuse, et le raisonnement qu'`estAdminWorkspace` tient déjà dans `PanneauTimeline`.

L'exclusion est **en base**, dans la fonction, et non dans l'écran : une seule écriture, et elle est
prouvable par le contrat d'API.

**La conséquence sous la clé de service est nommée** : `auth.uid()` y est nul, donc personne n'est
exclu et la fonction rend tous les membres éligibles. Le seed et les harnais, qui empruntent cette
clé, le savent ; c'est la même limite que le §14.3 a nommée pour le trigger.

### 34.4 Privilèges

```sql
revoke all on function public.mentionnables(uuid) from public, anon;
grant execute on function public.mentionnables(uuid) to authenticated, service_role;
```

`anon` est révoqué **nommément**, et c'est la leçon payée par la migration `0053` : `pg_default_acl`
accorde `execute` à `anon` sur toute fonction neuve de `public`, et `revoke … from public` ne lui
retire rien, `public` étant le pseudo-rôle. Un appelant anonyme est donc refusé **par le privilège**,
avant toute politique — et c'est plus strict qu'une liste vide.

**Le cache de schéma de PostgREST est notifié dans la migration**, comme en `0053` : une fonction
neuve reste invisible jusqu'au rechargement, et le `migrations-runner` rejoue le répertoire sur une
pile déjà chaude.

---

## 35. LES DEUX ÉCRITURES NE SONT PAS ATOMIQUES, ET VOICI CE QUE L'ÉCRAN FAIT

C'est le point que le §30 laissait ouvert, et il est tranché ici par la mesure.

### 35.1 La mesure qui décide : le `POST` groupé est tout ou rien

M5 est sans ambiguïté : deux mentions dans un seul tableau, une seule inéligible, et **aucune** n'est
posée. Le refus ne dit pas laquelle est en cause. Un sélecteur peut se périmer entre sa lecture et
l'envoi — un droit retiré pendant la rédaction suffit —, si bien que le cas n'est pas théorique.

### 35.2 UN `POST` PAR MENTION, SÉQUENTIEL

L'écran envoie donc **une requête par personne**, dans l'ordre du sélecteur, et retient l'issue de
chacune. M6 mesure ce que cela rend : la mention éligible passe, l'autre est refusée, et l'écran
sait **laquelle**.

Le coût est nommé : `N` requêtes au lieu d'une, pour un `N` que le §33 ne borne pas. Il est payé pour
que le refus soit **attribuable** — un refus qui ne nomme personne ne se corrige pas.

**Aucune parallélisation.** Les requêtes sont séquentielles : elles écrivent toutes sur la même clé
primaire composite, et un ordre stable rend le compte rendu lisible.

### 35.3 LE COMMENTAIRE PUBLIÉ N'EST JAMAIS RETIRÉ

Quand une mention échoue, le commentaire reste publié. Le supprimer pour « défaire » l'envoi
détruirait un propos que son auteur a réellement tenu, au motif d'une erreur qui ne le concerne pas
— et la suppression est une **pierre tombale définitive** (§13.4 de `docs/SPEC-cards.md`), pas une
annulation. Le dépôt tranche déjà ainsi au §14.4 pour la notification d'une mention retirée : ce qui
est délivré ne se réécrit pas.

### 35.4 Ce que l'écran dit, et ce qu'il ne dit pas

Trois issues, et aucune n'est confondue avec une autre — c'est la règle des trois issues du geste
d'auteur (`PanneauTimeline`, §13.8 ligne *j*), transposée :

| Issue | Ce que l'écran rend |
|---|---|
| Le commentaire et **toutes** les mentions sont posés | L'annonce ordinaire de publication, le brouillon vidé, le sélecteur remis à zéro |
| Le commentaire est publié, **une ou plusieurs** mentions refusées | Une alerte qui **nomme les personnes** non mentionnées et la cause traduite. Le brouillon EST vidé — le commentaire existe —, le sélecteur ne garde que les personnes refusées |
| Le **commentaire** est refusé | Le comportement actuel, inchangé : le texte est conservé, aucune mention n'est tentée |

**Le sélecteur ne garde que les personnes refusées**, et c'est délibéré : les mentions réussies sont
posées, les reproposer inviterait à un doublon que la clé primaire refuserait. Ce qui reste coché est
exactement ce qui reste à faire — mais **sur un autre commentaire**, l'ancien étant déjà publié.

**La cause est traduite, jamais devinée** : `mention_destinataire_sans_acces` devient « cette
personne ne peut pas lire cette affaire » ; `42501` devient le refus d'autorisation ordinaire ;
`comment_deleted` et `comment_not_found` gardent les libellés que le fil emploie déjà. L'écran
n'invente aucun message pour un code qu'il ne connaît pas : il rend le refus générique du §5.8.

---

## 36. Ce que l'écran rend, règle par règle

`docs/DESIGN_SYSTEM.md` §5.44 en porte l'apparence ; ce chapitre porte les règles.

### 36.1 Le sélecteur vit DANS le composeur, sous la zone de saisie

Il appartient au formulaire qui publie : ce qu'il choisit part avec le commentaire, et disparaît
avec lui. Le poser ailleurs — dans l'en-tête du panneau, par exemple — le ferait passer pour un
filtre du fil.

### 36.2 CE N'EST PAS UN `select`, ET L'ÉCART AVEC LE §5.22 EST MOTIVÉ

Le §5.22 retient un `select` natif parce que le choix y est **unique**. Ici il est **multiple** : un
commentaire peut mentionner plusieurs personnes. Un `<select multiple>` natif est le contrôle que
les plateformes rendent le plus mal — sélection à la souris destructrice, rendu illisible sur
mobile —, et le §8 exige mieux.

Le sélecteur est donc un **`fieldset` de cases à cocher**, une par personne éligible. Aucune
dépendance nouvelle, le clavier de la plateforme, le focus visible du §8, et l'état de chaque choix
lisible d'un coup d'œil.

### 36.3 La liste n'est lue QU'À L'OUVERTURE DU SÉLECTEUR

Jamais au chargement de la fiche. C'est la règle de `lireMembresAffectables` (§15 bis.6 de
`docs/SPEC-cards.md`), et pour le même motif : la plupart des visites d'une affaire ne mentionnent
personne, et une requête émise sur chaque ouverture d'écran serait gratuite sur les neuf dixièmes.

### 36.4 Les quatre états de la liste

- **chargement** : le sélecteur est ouvert, `aria-busy`, et ne porte aucune case ;
- **erreur** : la mention d'erreur du §5.8 et son **action de reprise**, qui relit la liste ;
- **vide** : « personne d'autre ne peut lire cette affaire », sans action. C'est un état réel — une
  affaire dont l'appelant est le seul lecteur —, pas un repli.

  > **CE CAS N'EXISTE DANS AUCUNE AFFAIRE DU SEED, ET C'EST MESURÉ, PAS SUPPOSÉ.** La requête qui
  > compte les personnes éligibles de chaque couple (affaire, lecteur) rend **1 au minimum** partout :
  > l'administratrice lit toutes les affaires, si bien qu'un non-administrateur a toujours au moins
  > elle, et elle a toujours au moins le `business_developer`. L'état vide est donc éprouvé par la
  > **suite unitaire** et non par le parcours d'interface. L'écart est nommé au point ouvert n° 5 du
  > §39 plutôt que comblé par une donnée fabriquée ;
  >
  > **RÉVISÉ LE 2026-08-27 — LA PREMIÈRE PHRASE RESTE VRAIE, LA CONCLUSION NE L'EST PLUS.** Aucune
  > affaire du seed n'exerce cet état, et le seed n'est toujours pas étendu. Mais il n'était pas
  > mesuré qu'un chemin déterministe **hors seed** puisse l'exercer : il le peut, et le §50 en écrit
  > le contrat. Le parcours d'interface éprouve donc désormais l'état vide sur une affaire réelle,
  > par la vraie API et la vraie session, sans qu'aucune donnée soit fabriquée dans le seed ;
- **peuplé** : les cases, dans l'ordre rendu par la fonction.

**Aucun rendu n'est prévu pour « la liste contient l'appelant »** : le §34.3 le rend impossible en
base, et écrire un repli pour un état que la base interdit enseignerait qu'il peut arriver — la
règle du §24.3.

### 36.5 Le compte des personnes choisies est rendu, et il est la seule donnée dérivée

La commande qui ouvre le sélecteur porte le nombre de personnes cochées. Sans lui, un auteur qui
replie le sélecteur ne sait plus qui son commentaire mentionne.

### 36.6 Ce que le sélecteur ne fait PAS

Il ne **désactive** pas le bouton de publication, il n'exige aucun choix, et il ne modifie pas le
corps du commentaire. Mentionner est facultatif ; le composeur reste ce qu'il était.

---

## 37. Contrat d'API de la sous-tranche 3b, ligne à ligne

Les seize lignes du §17 et les sept du §27 restent **vraies et vertes sans modification** : 3b ne
change aucune règle des deux tables. Les lignes ci-dessous portent sur la fonction neuve et sur la
séquence d'émission.

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| x | anonyme | `POST /rpc/mentionnables` | `401` / `42501` — refusé **par le privilège** (§34.4) |
| y | `A` | `POST /rpc/mentionnables { card_id: …0c1 }` | `200`, **une** ligne : Driss. Farida absente par l'éligibilité, Camille absente par le §34.3 |
| z | `A` | `POST /rpc/mentionnables { card_id: …0c5 }` | `200`, **deux** lignes : Driss, Farida — la même personne, éligible ici et pas là (M1) |
| aa | `V` | `POST /rpc/mentionnables { card_id: …0c1 }` | `200` et **zéro ligne** — la card ne lui est pas ouverte, et le refus n'est pas une erreur (M8) |
| ab | `V` | `POST /rpc/mentionnables { card_id: …0c5 }` | `200`, deux lignes : Camille, Driss — la lectrice y est éligible, et n'est pas dans sa propre liste |
| ac | `A` | `POST /rpc/mentionnables { card_id: <uuid inconnu> }` | `200` et **zéro ligne** — une affaire inexistante et une affaire fermée rendent le même résultat (discrétion, §6) |
| ad | `A` | commentaire sonde sur `…0c1`, puis `POST` de la mention de Driss | `201`, et **une notification** naît pour Driss (§14) |
| ae | `A` | sur le même commentaire, `POST` de la mention de Farida | `400` / `P0001` `mention_destinataire_sans_acces`, et la mention de Driss **reste posée** (M6) |
| af | `A` | les deux mentions dans **un seul** `POST` | `400`, et **aucune** mention posée — la mesure M5, figée pour qu'un changement de PostgREST ne passe pas inaperçu |
| ag | `B` | `POST` d'une mention sur `…0d1`, commentaire de `A` | `403` / `42501` — la politique juge l'auteur (M4) |

**Chaque ligne posée est retirée, et une dernière lecture le constate** (décision 501) : cinq
commentaires, deux mentions, deux notifications.

---

## 38. Ce que le seed livre, et ce qu'il ne change pas

**Rien de neuf, et c'est mesuré avant d'être écrit** (la leçon du §19). Le seed pose déjà deux
mentions par le vrai chemin (§9) et les deux notifications qu'elles produisent. 3b ne pose aucune
ligne et n'en retire aucune : elle livre le geste qui les aurait produites.

**Ce que le seed exerce déjà pour cette surface, et qui n'est pas une chance** : Farida est éligible
sur `…0c5` et ne l'est pas sur `…0c1` (M1). La preuve d'interface peut donc ouvrir le sélecteur sur
deux affaires et constater que **la même personne** y est offerte puis absente, sans aucune donnée
fabriquée.

---

## 39. Points ouverts, nommés et non tranchés ici

1. **Les mentions d'un commentaire déjà publié ne se corrigent pas depuis l'écran.** La base ouvre
   `DELETE` à l'auteur (§7.1) ; aucune surface ne l'emploie. Ajouter, retirer et rendre les mentions
   d'une ligne du fil est une surface entière, qu'aucun document ne décrit.
2. **Le sélecteur n'a ni recherche ni pagination**, et le nombre de membres d'un workspace n'est
   toujours pas mesuré — même écart qu'au §5.22 du design system, nommé plutôt que comblé.
3. **Le fil ne montre pas qui un commentaire mentionne.** Les mentions sont lisibles par qui lit
   l'affaire (§7.1), mais la ligne du fil ne les rend pas. C'est la contrepartie du §33 : 3b livre
   l'émission, pas l'affichage rétrospectif.
4. **~~L'état vide du sélecteur n'est pas exerçable sur le seed.~~ TRANCHÉ LE 2026-08-27, ET LE
   CONTRAT EST AU §50.** Le constat de départ tenait : aucun couple (affaire, lecteur) du seed ne
   laisse l'appelant seul (§36.4, mesuré). Mais les deux issues envisagées ici — une affaire dont
   l'administratrice serait exclue, ou un quatrième profil — n'étaient pas les seules : **une
   troisième voie existe, et elle ne touche pas au jeu de démonstration.** Un second espace de
   travail **jetable**, posé et détruit par la clé de service, laisse son unique membre seul lecteur
   de sa propre affaire. Le seed n'est ni étendu ni modifié, et l'état vide est éprouvé par le
   parcours d'interface sur une affaire réelle.
5. **Les points ouverts du §29 restent ouverts sans changement** : rétention, regroupement, « tout
   marquer comme lu », préférences, notifications du navigateur, partage entre onglets.

---

## 40. Preuves attendues de la sous-tranche 3b

| Niveau | Preuves |
|---|---|
| pgTAP | L'existence, la volatilité, le `security invoker`, le `search_path` vide et l'**ACL** de `public.mentionnables` — `anon` révoqué nommément —, et la non-régression des assertions de `0061` et `0062` |
| Unitaire | La chaîne réellement émise par la lecture de la liste, le découpage des trois issues du §35.4, la classification des refus du §35.4, l'ordre séquentiel des `POST` et le fait que le commentaire publié n'est jamais retiré |
| API | Les dix lignes du §37, dont la ligne *af* qui **fige la mesure M5** |
| Non-régression | `0061`, `0062`, `e2e/api/mentions.spec.ts`, `e2e/api/notifications.spec.ts` et `e2e/api/notifications-surface.spec.ts` verts **sans aucune modification** |
| E2E d'interface | Le parcours complet : ouvrir le sélecteur sur `…0c1` et n'y trouver que Driss, l'ouvrir sur `…0c5` et y trouver Farida, cocher, publier, et **voir la notification arriver dans la cloche du destinataire** ; le refus nommé ; l'état vide ; le clavier de bout en bout |
| Visuel | Captures aux quatre paliers, sélecteur replié et déplié, liste peuplée et liste vide, alerte de refus, **observées** conformément à `CLAUDE.md` §16. Console **vierge** |
| Harnais | `scripts/verify-mentions-composeur.sh`, non complaisant, éprouvé par dégradations réelles et restauration constatée |

---

## 41. Les treize mesures de la tranche 4, prises avant d'écrire

*Prises le 2026-08-27 sur la pile debout et seedée, avec les jetons réels des trois profils obtenus
par la véritable route de connexion. Toutes les sondes qui écrivent ont été **détruites**, et l'état
du seed **relu après** : cinq commentaires, deux mentions, deux notifications, aucune table ni
fonction `sonde_*` résiduelle. Les identifiants sont ceux du seed (`docs/SPEC-seed.md` §4).*

| # | Ce qui a été mesuré | Résultat |
|---|---|---|
| **M1** | Ce que le seed livre — `GET /rest/v1/notifications` sous la clé de service | **Deux** notifications, toutes deux `read_at is null`, toutes deux sur `…0c1` |
| **M2** | Le compteur de non-lues par la vraie route, jeton par jeton | Camille **1**, Driss **1**, Farida **0** (`Content-Range: */0`) |
| **M3** | `public.notification_preferences` existe-t-elle ? | **Non** — `404` / `PGRST205`, « Could not find the table … in the schema cache » |
| **M4** | `app.notifications_apres_mention()` lit-elle une préférence ? | **Non** — aucune occurrence de `pref` dans sa définition. Le §14.6 est donc exact et reste exact |
| **M5** | Les privilèges par défaut de l'image Supabase sur `public` | `anon` **et** `authenticated` reçoivent `arwdDxtm` sur toute table neuve — la décision 134 tient toujours |
| **M6** | Où vit aujourd'hui une préférence personnelle | `profiles.locale`, sur une table dont la politique `profiles_lecture_equipe` ouvre la lecture à **toute l'équipe** |
| **M7** | Driss lit-il le profil de Camille ? | **Oui** — `200`, la ligne entière, `locale` comprise. Et il lit **les trois** profils |
| **M8** | Filtrage **à la lecture** : une politique de `notifications` qui délègue à une fonction lisant une table de préférences | Driss, qui a coupé `'mention'` : liste **`[]`**, compteur **`*/0`**. Camille, qui ne l'a pas coupée : sa ligne, compteur **`0-0/1`**. **La ligne coupée existe toujours en base** (clé de service) |
| **M9** | Sous cette même politique dégradée, le `PATCH read_at` du destinataire coupé | **`204`, et `read_at` reste `null`** — zéro ligne touchée. Le même `PATCH` par Camille, **non** coupée, rend `204` et une date **posée par la base**. La cause est que PostgREST écrit son `UPDATE` avec `RETURNING`, que la politique `SELECT` filtre |
| **M10** | L'**upsert** PostgREST (`Prefer: resolution=merge-duplicates`) sur une table dont `authenticated` n'a que `insert (…)` et `update (in_app)` | **`403` / `42501`** — « permission denied for table ». Un second `POST` **sans** `merge-duplicates` rend **`409` / `23505`**. Le `PATCH` de `in_app` rend `204` ; celui d'`updated_at`, **`403`** ; le `POST` pour **autrui**, `403` / `42501` **RLS** ; un `type` inventé, **`400` / `23514`** ; le `DELETE`, `403` |
| **M11** | Une **RPC** `security definer` faisant le même upsert, la table étant fermée en écriture | **`200`** deux fois de suite sur la même clé, **un seul aller-retour** ; l'**anonyme** reçoit `401` / `42501` ; le `PATCH` direct reçoit alors `403` |
| **M12** | Combien d'espaces de travail, et combien d'appartenances par profil | **Un** espace ; **une** appartenance pour chacun des trois profils. La mesure ne donne donc pas la réponse du §43.3, qui doit être motivée |
| **M13** | Les tables publiées au temps réel | `public.card_comments` et `public.notifications`, et elles seules — la ligne de base du §46.4 |

---

## 42. Ce que la tranche 4 est, et ce qu'elle n'est pas

Elle livre **la décision de chacun sur ce qu'il reçoit**, opposable côté backend, et l'écran qui la
porte. Chaque absence est figée par une assertion, jamais compensée :

- **aucun canal sortant, et le §42.1 en fait une décision** plutôt qu'une omission ;
- **aucune préférence d'autrui** : ni lue, ni écrite, ni même dont l'existence soit observable ;
- **aucune préférence par espace de travail** — §43.3 ;
- **aucune rétention, aucun regroupement** : les points ouverts n° 1 et n° 2 du §18 restent ouverts,
  et cette tranche ne les tranche pas ;
- **aucune notification produite pour une source autre que la mention.** Le `check` de `type` reste
  fermé sur `'mention'` (§13.3), des deux côtés.

### 42.1 « ET PAR QUEL CANAL » : IL N'Y EN A QU'UN, ET C'EST MESURÉ

Le §8 de `docs/SCHEMA.md` annonçait `notification_preferences` comme « canal souhaité par type :
in-app, email immédiat, digest ». **Deux de ces trois canaux n'existent pas**, et le §13.1 l'écrit
déjà : « aucun canal sortant. Ni email, ni digest, ni webhook. La notification vit en base et rien
ne l'en fait sortir. » M4 le confirme du côté du producteur : le trigger n'envoie rien.

Livrer une case « recevoir par email » que rien ne lirait serait une **commande morte** — ce que le
§5.10 du design system interdit —, et une promesse fausse faite à l'utilisateur : il croirait avoir
demandé un email qui n'arrivera jamais. Livrer une colonne `channel` à une seule valeur serait
l'anticipation que `CLAUDE.md` §1 interdit, et l'argument du §13.3 ne la sauve pas : `type` est une
**garde** contre un type inventé, alors qu'un canal à une valeur ne garde rien — la seule valeur
possible est déjà la seule qui existe.

**La préférence porte donc sur ce qui existe** : recevoir, ou ne pas recevoir, en application. La
ligne du §8 de `docs/SCHEMA.md` est **révisée** dans le même changement pour dire ce que la table
fait réellement, et le jour où un canal sortant existera, il amènera sa colonne avec la migration
qui le livre — pas avant.

---

## 43. Modèle : `public.notification_preferences`

### 43.1 UNE TABLE, ET NON UNE COLONNE DE `profiles` — M6 ET M7 LE DÉCIDENT

Le réflexe est de poser un booléen à côté de `profiles.locale`, qui est déjà une préférence
personnelle. **M7 l'interdit** : `profiles_lecture_equipe` ouvre la lecture de la ligne entière à
tout membre du workspace, et la mesure le confirme par la vraie route — Driss lit les trois profils.
Une colonne posée là **publierait à toute l'équipe** que quelqu'un a coupé ses notifications.

Ce n'est pas une donnée d'équipe. C'est une décision personnelle, du même ordre que la boîte
elle-même, dont le §16.1 dit qu'elle n'est « pas une donnée d'exploitation ». Une table séparée,
dont la politique de lecture exige `profile_id = auth.uid()`, la garde privée — et rend son
**existence même** inobservable par un tiers.

### 43.2 Colonnes

| Colonne | Type | Contrainte |
|---|---|---|
| `profile_id` | `uuid` | non nul, `profiles (id)` en `CASCADE` |
| `type` | `text` | non nul, `check (type in ('mention'))` — **la même garde fermée qu'au §13.3** |
| `in_app` | `boolean` | non nul, `default true` |
| `updated_at` | `timestamptz` | non nul, **posé par la base**, jamais par le client |

**CLÉ PRIMAIRE `(profile_id, type)`, NATURELLE, ET C'EST L'INVERSE DE `notifications`.** Le §13.2
donne une clé technique à la notification parce qu'un message *a sa propre existence*. Une
préférence n'en a aucune : elle **est** le fait qu'une personne a décidé quelque chose au sujet
d'un type. Deux décisions de la même personne sur le même type ne sont pas deux préférences, c'est
la seconde qui vaut. La clé naturelle dit cela ; une clé technique autoriserait deux lignes
contradictoires que rien ne départagerait. C'est exactement le raisonnement du §4.1 pour la mention.

**Aucune colonne `created_at`.** La date qui compte est celle de la **dernière** décision, et
`updated_at` la porte. Savoir quand quelqu'un a exprimé sa première préférence n'éclaire aucune
règle et n'est demandé par aucun écran. Même écart assumé aux conventions de `docs/SCHEMA.md` que
`card_comments` (INC-025), et il est nommé plutôt que subi.

**`updated_at` est posé par un trigger `BEFORE`**, mécanisme de la décision 95, déjà employé pour
le `created_at` de la mention (§6) et le `read_at` de la notification (§15.1). M10 mesure que le
privilège de colonne refuse déjà le `PATCH` d'`updated_at` par `403` ; le trigger est la **seconde**
barrière, celle qui tient aussi pour la clé de service, qui contourne la RLS mais pas les triggers.

### 43.3 AUCUN `workspace_id`, et c'est une décision

M12 mesure un seul espace de travail dans le seed, et chacun des trois profils n'y a qu'une
appartenance : la mesure ne **donne** donc pas la réponse, et il faut la motiver.

Une préférence de notification est une décision sur **soi** — « je ne veux pas être dérangé » —, non
sur un contexte de travail. La découper par espace créerait, pour chaque personne, autant de
décisions que d'espaces, dont aucune n'aurait de valeur par défaut évidente, et poserait
immédiatement la question de ce qu'un nouvel espace hérite. Rien dans le produit ne demande cette
finesse aujourd'hui.

**Le coût est nommé** : le jour où une personne appartiendra à deux espaces et voudra couper l'un
sans l'autre, la table devra gagner une colonne et sa clé primaire changer. C'est une migration
franche, pas une impasse — et elle sera écrite quand le besoin sera mesuré, pas avant.

### 43.4 L'ABSENCE DE LIGNE VAUT CONSENTEMENT, ET LE DÉFAUT EST « JE REÇOIS »

Il n'y a **aucune ligne** pour personne tant que personne n'a rien décidé. Une préférence absente se
lit `true`, par un `coalesce` explicite écrit dans la fonction du §45.1.

C'est ce qui rend la tranche **non destructrice** : elle est déployable sur une base existante sans
qu'aucune notification cesse d'arriver, et un compte créé demain reçoit sans qu'aucun code ait à
lui fabriquer une ligne. L'alternative — une ligne par personne et par type, posée par un trigger
sur `profiles` — multiplierait les lignes, exigerait une migration de rattrapage, et ferait dépendre
le fonctionnement du produit de la réussite de ce rattrapage.

**Ce n'est pas un consentement au sens du RGPD** (`CLAUDE.md` §11) : une notification interne
adressée à un membre de l'équipe qui a été nommément mentionné est **strictement nécessaire au
fonctionnement demandé**, catégorie 1 du §11. La préférence est un **confort**, et son défaut est
donc légitimement « actif ». Aucune donnée n'est stockée sur l'appareil : la décision vit en base.

---

## 44. LA DÉCISION QUE LE §18, POINT 3, LAISSAIT OUVERTE : À LA LECTURE, PAS À LA PRODUCTION

Le §18 posait la question sans la trancher : « la tranche 4 devra décider si une préférence filtre
**à la production** ou **à la lecture** — et les deux ne se valent pas : la première perd
l'information, la seconde la garde. »

**La réponse est : à la lecture.** Quatre raisons, dont trois sont mesurées.

**1. La production ne juge rien, et le §14.6 en fait une propriété.** Le trigger « ne juge rien.
L'éligibilité a été jugée par le trigger `BEFORE` de la tranche 1 ; la rejuger serait la seconde
écriture que le §5.3 refuse. » Lui faire lire une préférence en ferait un juge, et un juge
`SECURITY DEFINER` qui décide en silence de ne pas écrire une ligne — la forme la plus difficile à
diagnostiquer qui soit : rien ne distingue « la préférence a filtré » de « le trigger a échoué ».

**2. Une décision révocable ne doit pas détruire.** Couper les mentions puis les rétablir doit
rendre l'état d'avant. Filtrée à la production, la coupure **efface** définitivement ce qui s'est
passé pendant ; filtrée à la lecture, elle le **masque**, et M8 le mesure des deux côtés : la liste
de Driss est vide et son compteur nul, **et sa ligne est toujours en base** sous la clé de service.
Une préférence est un réglage d'affichage, pas une politique de rétention — c'est le point ouvert
n° 1, et il reste ouvert.

**3. La règle n'a qu'une seule écriture, et elle couvre TROIS surfaces d'un coup.** La liste, le
compteur et le **temps réel** lisent tous `public.notifications` sous la politique
`notifications_lecture`. Étendre cette politique les couvre les trois : M8 mesure la liste et le
compteur, et le §16.3 établit déjà que « le temps réel évalue la politique `SELECT` de chaque
abonné ». Filtrer à la production aurait couvert les trois aussi, mais filtrer **dans l'écran** —
la troisième voie, jamais retenue — en aurait couvert une et demie, et aurait été la seconde
écriture en TypeScript que le §34.1 a déjà refusée pour le sélecteur.

**4. Le coût est nommé, et il est réel.** Les lignes d'une personne qui a coupé **s'accumulent sans
être lues**. C'est le point ouvert n° 1 — la rétention — rendu plus pressant, non résolu. Il est
consigné comme tel au §48 plutôt que traité par une décision que rien ne fonde.

### 44.1 LA CONSÉQUENCE QUE M9 MESURE, ET ELLE N'EST PAS UNE ANOMALIE

Une notification masquée par la préférence **ne peut plus être marquée lue** : M9 mesure `204` et
`read_at` inchangé, là où la même route rend `204` et une date pour un destinataire non coupé. La
cause est mécanique et vaut pour toute la pile : PostgREST écrit son `UPDATE` avec `RETURNING`, que
la politique `SELECT` filtre.

**C'est la forme de refus que ce dépôt emploie partout** : la Definition of Done de `CRM-064`
demande que « le refus de lecture se mesure comme **zéro ligne** et non comme une erreur ». Une
ligne qu'on ne voit pas est une ligne qu'on ne marque pas, et l'écran ne propose jamais ce geste
puisqu'il ne rend jamais la ligne. Le comportement est **figé par une assertion** du §47 plutôt que
laissé à la surprise d'une session future.

---

## 45. La lecture de la préférence, et l'unique écriture de la règle

### 45.1 `app.notification_consentie(uuid, text)`

```sql
create or replace function app.notification_consentie(p_destinataire uuid, p_type text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select coalesce(
		(select np.in_app
		   from public.notification_preferences np
		  where np.profile_id = p_destinataire
		    and np.type       = p_type),
		true);
$$;
```

**`SECURITY INVOKER`, et c'est l'écart avec le §14.1 comme c'était celui du §34.2.** La fonction est
appelée depuis la politique de `notifications`, dont la première condition exige déjà
`recipient_id = auth.uid()` : la seule ligne de préférence qu'elle lit est donc **celle de
l'appelant**, que la politique du §46.1 lui ouvre. En `DEFINER`, elle deviendrait un **oracle** —
appelable directement avec n'importe quel `uuid`, elle dirait si un tiers a coupé ses notifications.
C'est précisément la « refus de discrétion » que le §5.5 avait pesée, et ici rien ne l'impose.

**`stable`, jamais `immutable`** : elle lit une table.

**`search_path` vide et noms pleinement qualifiés**, comme les onze fonctions du schéma `app`.

**Le `coalesce` porte le §43.4**, et il est **explicite** plutôt que laissé au moteur : sans lui, la
sous-requête rendrait `NULL` pour une préférence absente, et `NULL and …` se comporte comme faux
dans une politique — c'est-à-dire que **l'absence de décision couperait tout**, exactement l'inverse
du défaut voulu. C'est le piège que le §16.1 avait déjà désamorcé pour `subject_card_id is null`.

### 45.2 La politique du §16.1 gagne une TROISIÈME condition

```
recipient_id = (select auth.uid())
and (subject_card_id is null or app.can_read_card(subject_card_id))
and app.notification_consentie(recipient_id, type)
```

La politique `notifications_marquage` (`UPDATE`) **n'est pas touchée**, et le §44.1 dit pourquoi
elle n'a pas besoin de l'être : le filtre du `SELECT` la couvre déjà, par `RETURNING`. L'y recopier
serait une seconde écriture de la même règle, sans effet observable.

**Le privilège d'exécution est accordé à `authenticated`**, et c'est la leçon de la décision 522 :
la politique s'évalue **sous le rôle de l'appelant**, et une fonction sans `EXECUTE` ferait rendre
`403 / 42501` là où le contrat attend des lignes — sans qu'aucune suite pgTAP, qui s'exécute sous le
propriétaire, ne le voie.

---

## 46. Autorisations, privilèges, et l'unique chemin d'écriture

### 46.1 Politiques

| Politique | Commande | Rôles | Prédicat |
|---|---|---|---|
| `notification_preferences_lecture` | `SELECT` | `anon`, `authenticated` | `profile_id = (select auth.uid())` |

**Une seule politique, et c'est la conséquence du §46.3.** Aucune politique `INSERT`, `UPDATE` ou
`DELETE` : la table est fermée en écriture à tout client, et la RPC du §46.3 est le seul chemin.
Leur **absence** est figée par une assertion qui compte les politiques et les nomme.

**`anon` reçoit la lecture**, pour la raison du §15.2 : sans le privilège, un anonyme recevrait une
**erreur** là où le comportement exigé est **zéro ligne**. `auth.uid()` étant nul, le prédicat est
faux.

### 46.2 Privilèges

```sql
revoke all on public.notification_preferences from anon, authenticated;

grant select         on public.notification_preferences to anon;
grant select         on public.notification_preferences to authenticated;
grant all privileges on public.notification_preferences to service_role;
```

Le `revoke` est écrit **avant** les `grant`, décision 134, et M5 le remesure : l'image accorde
`arwdDxtm` à `anon` et `authenticated` sur toute table neuve. Sans lui, il n'y aurait ni refus
d'insertion, ni refus de suppression, ni chemin d'écriture unique.

**Aucun privilège d'écriture, d'aucune sorte.** Le refus est **double** — ni privilège, ni politique
—, comme au §15.3 : sans les deux, on ne saurait pas lequel refuse, et la dégradation du harnais ne
pourrait pas éprouver la seconde barrière en relâchant la première.

### 46.3 `public.definir_preference_notification(text, boolean)` — LE SEUL CHEMIN, ET M10 LE DÉCIDE

**L'écriture directe a été mesurée, et sa forme naturelle est refusée.** Une préférence est un
réglage qu'on pose sans savoir s'il existe déjà : l'`upsert` PostgREST est la forme évidente. M10
mesure qu'elle rend **`403` / `42501`** dès lors que `authenticated` n'a que `insert (…)` et
`update (in_app)` — PostgREST exige l'`UPDATE` **de table** pour un `ON CONFLICT DO UPDATE`. Il ne
reste alors que deux voies :

- **ouvrir l'`UPDATE` de table** — ce qui rendrait `profile_id`, `type` et `updated_at` modifiables
  par le client, c'est-à-dire défaire exactement ce que le privilège de colonne protégeait ;
- **écrire en deux appels** — un `PATCH`, puis un `POST` s'il n'a touché aucune ligne. M10 mesure la
  seconde forme : un `POST` répété rend **`409` / `23505`**. Deux allers-retours, un code d'erreur
  à interpréter comme un succès conditionnel, et une fenêtre entre les deux.

**La troisième voie est la bonne, et le dépôt la pratique déjà** : une RPC `SECURITY DEFINER`, seul
chemin d'écriture d'une table fermée. C'est exactement la forme de `public.snooze_thread` et
`public.wake_thread` pour `mail_thread_snoozes` (`docs/SCHEMA.md` §7). M11 la mesure : **`200` deux
fois de suite sur la même clé, en un seul aller-retour**, l'anonyme refusé par `401` / `42501`, et
le `PATCH` direct refusé par `403`.

```sql
create or replace function public.definir_preference_notification(
	p_type   text,
	p_in_app boolean
)
returns public.notification_preferences
language plpgsql
security definer
set search_path = ''
as $$ … $$;
```

| Propriété | Valeur | Motif |
|---|---|---|
| Schéma | `public` | PostgREST n'expose que `public`, `storage`, `graphql_public` (§5.5) |
| Sécurité | `SECURITY DEFINER`, propriétaire `postgres` | La table est fermée en écriture à `authenticated` ; en `INVOKER`, l'insertion rendrait `42501`, exactement M9/M10 de la tranche 2 |
| `search_path` | vide | Comme les onze fonctions du schéma `app` |
| ACL | `revoke all from public, anon` **nommément**, puis `grant execute to authenticated, service_role` | Le §34.4 l'a établi : une propriété de sécurité qui n'existe que par omission ne se relit pas |

**LE DESTINATAIRE N'EST PAS UN PARAMÈTRE**, et c'est ce qui rend l'écriture d'autrui *impossible*
plutôt que *refusée*. La fonction lit `auth.uid()` elle-même. Aucun appelant ne peut désigner
quelqu'un d'autre : il n'y a pas de champ pour le dire. M10 mesure que la politique aurait refusé
un `profile_id` étranger par `403` / `42501` ; ne pas offrir le paramètre est la barrière d'avant,
celle qui ne dépend d'aucune politique.

**SANS SESSION, UN REFUS NOMMÉ.** `auth.uid()` nul — l'anonyme, ou la clé de service, qui contourne
la RLS mais n'a pas d'identité — lève `preference_sans_session` (`P0001`). Écrire une ligne pour
`null` serait refusé par la contrainte de non-nullité, mais avec un message qui ne dit rien ; et la
clé de service **doit** être refusée ici, car elle est le chemin du seed et des harnais.

**UN TYPE INCONNU EST REFUSÉ NOMMÉMENT, ET LA CONTRAINTE RESTE.** La fonction lève
`preference_type_inconnu` (`P0001`) avant d'écrire. M10 et M11 mesurent que, sans elle, le refus
vient du `check` avec `23514` et un message qui **recopie la ligne fautive** — illisible pour un
écran. Le `check` du §43.2 n'est pas retiré pour autant : c'est le **refus double** du §46.2, et
c'est lui qui tient pour la clé de service.

**IDEMPOTENTE PAR CONSTRUCTION** : `on conflict (profile_id, type) do update`. Poser deux fois la
même décision rend deux fois la même ligne, et `updated_at` avance — ce qui est exact : c'est bien
une seconde décision, au même sens que le §14.5 dit d'une mention reposée qu'elle est un second
geste.

**Elle rend la LIGNE**, jamais `void` : l'écran affiche l'état que la base a réellement retenu, et
non celui qu'il croyait envoyer. C'est ce qui empêche une case de rester cochée sur un écran alors
que la base dit l'inverse.

### 46.4 La table n'est PAS publiée au temps réel

Même motif qu'aux §7.3 et §16.3, et il tient : rien ne s'y abonne. Une préférence change là où on la
change, et l'écran qui la change connaît déjà sa réponse — la RPC la lui rend (§46.3). L'absence est
**figée** par une assertion, la ligne de base étant `public.card_comments` et `public.notifications`
(M13).

---

## 47. Contrat d'API de la tranche 4, ligne à ligne

`A` = Camille (`admin`), `B` = Driss (`business_developer`), `V` = Farida (`viewer`). Le seed livre
**deux** notifications, `N1` adressée à Driss et `N2` à Camille, toutes deux non lues et toutes deux
sur `…0c1` (M1, M2). **Le seed ne livre aucune préférence** (§48 bis).

| # | Appelant | Requête | Attendu |
|---|---|---|---|
| *a* | `B` | `POST /rest/v1/rpc/definir_preference_notification {"p_type":"mention","p_in_app":false}` | `200`, la ligne : `profile_id` = Driss, `type` = `mention`, `in_app` = `false`, `updated_at` posé par la base |
| *b* | `B` | `GET /rest/v1/notifications?select=id` | `200`, **`[]`** — sa notification est masquée (M8) |
| *c* | `B` | `GET /rest/v1/notifications?select=id&read_at=is.null` avec `count=exact` | `Content-Range: */0` — le compteur suit |
| *d* | service | `GET /rest/v1/notifications?recipient_id=eq.<Driss>` | **La ligne est toujours là.** Le filtrage masque, il ne détruit pas (§44, raison 2) |
| *e* | `A` | `GET /rest/v1/notifications?select=id` | `200`, **une** ligne — la préférence de Driss ne touche pas Camille |
| *f* | `B` | `PATCH /rest/v1/notifications?id=eq.<N1> {"read_at":"…"}` | `204`, **et `read_at` reste `null`** en base — le comportement de M9, figé |
| *g* | `B` | `POST … {"p_type":"mention","p_in_app":true}` | `200`, `in_app` = `true` ; puis `GET /notifications` rend **de nouveau** sa ligne, non lue |
| *h* | `B` | `GET /rest/v1/notification_preferences?select=*` | `200`, **une** ligne, la sienne |
| *i* | `A` | `GET /rest/v1/notification_preferences?select=*` | `200`, **`[]`** — l'existence même de la préférence de Driss est inobservable (§43.1) |
| *j* | anonyme | `GET /rest/v1/notification_preferences?select=*` | `200`, **`[]`** — zéro ligne, jamais une erreur |
| *k* | anonyme | `POST /rest/v1/rpc/definir_preference_notification` | `401` / `42501` — refus de **privilège** (M11) |
| *l* | `B` | `PATCH /rest/v1/notification_preferences?… {"in_app":true}` | `403` / `42501` — l'écriture directe est fermée (M11) |
| *m* | `B` | `POST /rest/v1/notification_preferences {…}` | `403` / `42501` — refus de privilège, et **aucune politique `INSERT`** derrière (§46.2) |
| *n* | `B` | `DELETE /rest/v1/notification_preferences?…` | `403` / `42501` |
| *o* | `B` | `POST … {"p_type":"echeance","p_in_app":false}` | `400` / `P0001` `preference_type_inconnu` — nommé, et **non** le `23514` brut de M10 |
| *p* | service | `POST /rest/v1/rpc/definir_preference_notification` | `400` / `P0001` `preference_sans_session` — la clé de service n'a pas d'identité (§46.3) |
| *q* | `V` | `POST … {"p_type":"mention","p_in_app":false}` puis `GET /notifications` | `200` puis `[]` — Farida n'a **aucune** notification, coupée ou non : la préférence ne fabrique pas d'erreur sur une boîte vide |

**Chaque ligne posée par ce contrat est retirée**, et une dernière lecture le **constate** — décision
501 : une preuve qui laisse ses sondes en base fait rougir la suivante. Ici la remise en état est
la **suppression** des lignes de préférence par la clé de service, qui seule en a le privilège, et
le §43.4 la rend exacte : sans ligne, le défaut est « je reçois », c'est-à-dire l'état d'avant.

---

## 48. Points ouverts, nommés et non tranchés ici

1. **La rétention devient pressante, et reste ouverte** (§44, raison 4). Les notifications d'une
   personne qui a coupé s'accumulent sans être lues. C'est le point ouvert n° 1 du §18, aggravé par
   cette tranche et non résolu par elle.
2. **Aucune préférence par espace de travail** (§43.3). Le jour où quelqu'un appartiendra à deux
   espaces, la table devra gagner une colonne et sa clé primaire changer.
3. **Aucun canal sortant, donc aucune préférence de canal** (§42.1). Le §8 de `docs/SCHEMA.md` est
   révisé pour cesser d'en promettre trois.
4. **Une notification masquée ne peut pas être marquée lue** (§44.1, M9). Le comportement est figé
   par la ligne *f* du contrat plutôt que découvert par surprise.
5. **Le regroupement, « tout marquer comme lu », les notifications du navigateur et le partage entre
   onglets** restent ouverts sans changement (§29, §39).
6. **`audit_log` (`CRM-072`) et `api_tokens` (`CRM-073`) n'existent toujours pas**, et onze unités
   leur renvoient. Le périmètre reste un choix produit qu'aucune mesure ne donne.

### 48 bis. Ce que le seed livre, et ce qu'il ne change pas

**Le seed ne pose AUCUNE préférence**, et c'est une décision plutôt qu'un oubli. Le §43.4 fait de
l'absence de ligne le défaut « je reçois » : poser trois lignes `in_app = true` serait poser trois
lignes qui ne changent rien, et un écran qui les rendrait ne montrerait pas l'état par défaut réel
d'un compte neuf — c'est-à-dire l'état que **tout le monde** a en production.

**M1 et M2 restent donc vrais après cette tranche** : deux notifications, non lues, Camille 1,
Driss 1, Farida 0. Aucune preuve existante n'a à changer, et c'est la non-régression attendue.

**L'écart est nommé** : l'état « j'ai coupé » n'est pas exerçable depuis le seed seul. Il l'est par
le parcours d'interface, qui le **pose lui-même** et le remet — ce qui est plus probant qu'une donnée
seedée, puisque le geste éprouvé est celui de l'utilisateur.

---

## 49. Preuves attendues de la tranche 4

| Niveau | Preuves |
|---|---|
| pgTAP | La table, ses colonnes, sa clé primaire naturelle, sa clé étrangère `CASCADE`, le `check` fermé ; l'**unique** politique et l'absence nommée des trois autres ; l'ACL de la table et celle des **deux** fonctions — `anon` révoqué nommément ; le `stable`, le `security invoker` et le `search_path` vide de `app.notification_consentie` ; le `security definer` de la RPC ; que la politique de `notifications` **délègue** à la fonction au lieu de recopier son prédicat ; le trigger de date ; et la non-régression de `0061`, `0062` et `0063` **sans une modification** |
| Unitaire | Le défaut « absente = je reçois », les deux refus nommés, la bascule de la case et l'état que l'écran retient de la ligne rendue |
| API | Les dix-sept lignes du §47, chaque refus **relu en base** avec la clé de service, et l'état du seed **constaté** après |
| Non-régression | `e2e/api/notifications.spec.ts` et `e2e/api/notifications-surface.spec.ts` verts **sans aucune modification** — c'est ce que le §48 bis rend attendu |
| E2E d'interface | Le parcours complet : couper depuis l'écran, **voir le compteur de la cloche tomber**, rétablir, **le voir revenir** ; le clavier de bout en bout ; console **vierge** |
| Visuel | Captures aux quatre paliers, case cochée et décochée, cloche avant et après, **observées** conformément à `CLAUDE.md` §16 |
| Harnais | `scripts/verify-preferences-notifications.sh`, non complaisant, éprouvé par dégradations réelles **des deux niveaux** — base et surface — et restauration constatée, la base **rendue** comme au §34.4 |

---

## 50. L'ÉTAT VIDE DU SÉLECTEUR EST EXERÇABLE — le point ouvert n° 4 du §39 est tranché

*Écrit le 2026-08-27, **après mesure** sur la pile debout et seedée, avec les jetons réels obtenus
par la véritable route de connexion. Toutes les sondes ont été **détruites**, et l'état du seed relu
après : un espace de travail, cinq commentaires, deux mentions, deux notifications, aucune
préférence — l'état exact du §48 bis.*

Le §40 promettait « l'état vide » parmi les preuves d'interface de la sous-tranche 3b, et le §39
point 4 l'a différé faute d'issue mesurée. Cette section livre l'issue et son contrat. Elle
n'ajoute **aucune règle** au produit : `public.mentionnables`, sa politique et l'écran du §36 sont
inchangés. Ce qui change est qu'une promesse de preuve, jusqu'ici tenue par la seule suite unitaire,
devient un parcours réel.

### 50.1 Les huit mesures, prises avant d'écrire

| # | Ce qui a été mesuré | Résultat |
|---|---|---|
| **MA1** | Ligne de base — `rpc/mentionnables` sur `…0c5` avec le jeton de Driss | **Deux** lignes : Camille Aubert, Farida Nowak |
| **MA2** | Combien d'espaces de travail, et combien d'appartenances pour Driss | **Un** espace (`p2enjoy`) ; **une** appartenance, `business_developer` |
| **MA3** | Poser par la clé de service un SECOND espace et la chaîne complète d'une card — `workspaces`, `workspace_members`, `tracks`, `workflows`, `workflow_nodes_catalog`, `workflow_steps`, `channels`, `cards` | **Huit `201`**. Aucune politique n'est contournée : la clé de service est déjà le seul chemin de création d'un espace (`CRM-012`), et `e2e/api/preuves-refus.spec.ts` fait de même depuis `CRM-014` |
| **MA4** | Driss, unique membre de ce second espace, lit-il sa card, et que rend `rpc/mentionnables` dessus ? | La card : **`200`, une ligne**. La liste : **`200 []`** |
| **MA5** | L'administratrice du seed — **non** membre — lit-elle cette card ? | **`200 []`**. La sonde est invisible aux profils des autres suites |
| **MA6** | L'écran, session réelle de Driss, sélecteur ouvert sur cette card | La liste rend « Personne d'autre ne peut lire cette affaire. », **zéro case à cocher**, **zéro bouton** dans le `fieldset` |
| **MA7** | La sonde **laissée en base**, campagne `e2e:ui` complète | `e2e/ui/demarrage.spec.ts` § « un ESPACE DE TRAVAIL NEUF … » devient **ROUGE** : « la base doit être rendue à son unique workspace seedé (CRM-005) », deux espaces au lieu d'un |
| **MA8** | L'état du dépôt après destruction de la sonde | Un espace, cinq commentaires, deux mentions, deux notifications, zéro préférence — identique à MA1 du §41 |

### 50.2 La troisième voie, et pourquoi le §39 point 4 ne l'avait pas vue

Le point 4 raisonnait **à l'intérieur du seed** : y créer l'état vide demandait soit d'exclure
l'administratrice d'une affaire — ce que son rôle interdit —, soit d'ajouter un quatrième profil,
donc de trancher le jeu de démonstration. Les deux conclusions sont justes.

Ce qu'il ne considérait pas est qu'**une preuve n'est pas obligée de vivre dans le seed**.
`CLAUDE.md` §15 le dit en toutes lettres : lorsqu'un comportement n'est pas directement observable,
on crée un **chemin déterministe** — une donnée seedée, mais aussi un conteneur jetable ou un
événement contrôlé. Le dépôt pratique déjà ce chemin : `CRM-014` fabrique et détruit un second
espace pour la preuve de refus n° 3, `CRM-083` pose et détruit son propre tableau. La sous-tranche
3b n'avait pas à inventer une convention, seulement à employer la sienne.

**MA4 établit que l'état vide n'est pas un cas de repli mais une conséquence de la règle** : un
espace à un seul membre laisse ce membre seul lecteur de ses affaires, et `app.can_read_card_pour`
n'a plus personne à rendre. C'est l'état d'un compte réel le jour de son premier espace de travail —
donc l'état que le §36.4 décrit depuis l'origine.

### 50.3 Ce que la fixture pose, ligne à ligne

Sept lignes et une appartenance, dans cet ordre — c'est celui des dépendances, et l'inverse pour la
destruction :

| Ordre | Table | Ce que la ligne porte |
|---|---|---|
| 1 | `workspaces` | l'espace jetable, `slug` préfixé, jamais celui du seed |
| 2 | `workspace_members` | **Driss**, et lui seul, en `admin` de cet espace |
| 3 | `tracks` | un track, `position` 1 |
| 4 | `workflows` | un workflow vide de transitions : la card ne bouge pas |
| 5 | `workflow_nodes_catalog` | le nœud que l'étape exige |
| 6 | `workflow_steps` | l'étape initiale, `is_initial` |
| 7 | `channels` | le channel, qui porte le workflow |
| 8 | `cards` | l'affaire, dont Driss sera le seul lecteur |

**Aucune ligne n'est posée dans l'espace du seed**, et c'est la propriété qui rend la fixture sûre :
MA5 mesure que les profils des autres suites ne voient rien de cet espace. Une fixture qui poserait
une card dans `p2enjoy` changerait les comptes que douze suites figent.

### 50.4 LE MEMBRE UNIQUE EST DRISS, ET CE N'EST PAS INDIFFÉRENT

Trois raisons, dont deux mesurées.

1. **Un profil du seed, jamais un quatrième compte.** Créer un compte demanderait `auth.users`,
   donc l'API d'administration, donc un mot de passe et une identité qui survivraient à l'échec du
   scénario. Réemployer un profil existant ne laisse rien derrière lui qu'un `DELETE` ne défasse.
2. **Pas l'administratrice, et c'est MA5 qui le dit.** Camille est déjà l'appelante de tous les
   autres scénarios du fichier ; lui ajouter une seconde appartenance ferait varier ce que sa barre
   latérale rend pendant que d'autres scénarios l'observent.
3. **`admin` de l'espace jetable, et non `viewer`.** Le rôle décide de ce que Driss peut faire, pas
   de ce qu'il peut **lire** : l'état vide vient de l'absence d'autres membres, jamais du rôle. Le
   rôle `admin` est retenu parce qu'un espace sans administrateur est un état que
   `last_workspace_admin` (`CRM-022`) refuse, et fabriquer une donnée que la base refuserait par
   ailleurs serait fabriquer un cas impossible.

### 50.5 LA DESTRUCTION EST UN CONTRAT, ET MA7 LE MESURE

Elle n'est pas de l'hygiène : laissée en place, la sonde rend **une preuve d'une autre unité
rouge**. `e2e/ui/demarrage.spec.ts` (`CRM-079`) assère que la base ne porte qu'un espace, et cette
assertion est juste — elle protège l'écran du premier lancement, dont tout le sens est de n'avoir
rien à montrer.

Conséquences, et elles sont opposables :

- la chaîne est détruite dans un `finally`, **même si le scénario échoue** ;
- la destruction suit l'ordre inverse des dépendances, `workspace_members` partant en cascade avec
  l'espace ;
- le scénario **constate** l'état rendu au lieu de le supposer : un seul espace en base après son
  passage, relu par la clé de service. Une restauration supposée n'est pas une restauration
  (`docs/SPEC-test-harness.md` §7.2) ;
- les identifiants sont **fixes et préfixés** — `e0640000-…` —, de sorte qu'une exécution
  interrompue au pire moment laisse une trace reconnaissable, que l'exécution suivante écrase au
  lieu de dupliquer.

### 50.6 Ce que le parcours d'interface éprouve, et ce qu'il ne suppose pas

Sur session réelle de Driss, obtenue par le formulaire de connexion :

| # | Ce qui est éprouvé | Pourquoi ce n'est pas redondant |
|---|---|---|
| a | La fiche de l'affaire jetable s'ouvre, titre rendu | Sans elle, un échec de route se lirait comme un état vide |
| b | Le sélecteur, une fois ouvert, rend le message de l'état vide | C'est la promesse du §36.4, jusqu'ici jamais rendue à l'écran |
| c | **Zéro case à cocher** dans le `fieldset` | Un message rendu au-dessus d'une liste peuplée passerait `b` |
| d | **Zéro bouton** dans le `fieldset` | Le §36.4 exige « sans action » : l'état vide n'est pas une erreur, il n'offre donc **pas** la reprise du §5.8 |
| e | La commande porte « Mentionner », **sans compte** | Le §36.5 dérive le compte des cases cochées ; à zéro case, il n'y a rien à compter |
| f | Le composeur reste publiable | Le §36.6 : mentionner est facultatif, et l'être seul ne ferme pas le fil |
| g | Console **vierge** | `200 []` est un état normal, pas un refus : rien ne doit atteindre la console |
| h | Une capture, **observée** | `CLAUDE.md` §16 ; le §40 promet « liste peuplée et liste vide » |

**Ce que le parcours ne fait pas** : il n'écrit aucun commentaire, ne pose aucune mention et ne
touche à aucune notification. L'état vide est un état de **lecture** ; y publier n'éprouverait rien
de plus et rendrait la restauration plus fragile.

### 50.7 La ligne de contrat d'API que cette section ajoute

Une seule, et elle **fige MA4** — la mesure sans laquelle le parcours d'interface ne prouverait pas
d'où vient le vide :

| Ligne | Appelant | Requête | Attendu |
|---|---|---|---|
| *ah* | Driss, unique membre d'un espace jetable | `POST /rest/v1/rpc/mentionnables` sur la card de cet espace | **`200`** et **`[]`** — jamais une erreur, jamais un refus. Le §34.2 le disait ; aucune donnée ne l'avait encore montré |

*La lettre suit celle du §37, dont la dernière ligne est* ag *: les onze lignes du contrat d'API de
la sous-tranche 3b se lisent d'une seule suite.*

Elle vit dans `e2e/api/mentions-composeur.spec.ts`, à côté des dix lignes du §37, et emploie la même
fixture jetable que le parcours d'interface.

### 50.8 Ce que cette section ne fait PAS

- **Elle n'étend pas le seed**, et le §38 reste vrai mot pour mot : rien de neuf n'y est posé.
- **Elle ne crée aucun profil**, ni compte, ni identité : le §50.4 en donne le motif.
- **Elle n'ouvre aucune politique et n'écrit aucune migration.** Le contrat backend de la
  sous-tranche 3b est inchangé.
- **Elle ne referme pas les points 1, 2, 3 et 5 du §39**, qui restent ouverts sans changement.

### 50.9 Preuves attendues

| Niveau | Preuves |
|---|---|
| API | La ligne *ag* du §50.7, sur la fixture jetable, avec la ligne de base MA1 rejouée dans le même scénario — sans quoi `[]` ne distinguerait pas « personne n'est éligible » de « la fonction ne rend jamais rien » |
| E2E d'interface | Les huit points *a* à *h* du §50.6, sur session réelle, sans aucune substitution réseau |
| Visuel | Une capture de la liste **vide**, produite **et observée** (`CLAUDE.md` §16), qui complète les captures de liste peuplée du §40 |
| Non-régression | `e2e/ui/demarrage.spec.ts` vert **après** le passage — c'est MA7 retournée en preuve —, et l'état du seed relu par la clé de service |
