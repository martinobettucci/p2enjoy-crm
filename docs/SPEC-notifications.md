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
| 3 | La surface et le temps réel | Le composeur qui pose une mention, la liste des notifications, le compteur, l'abonnement Realtime. |
| 4 | Les préférences | Ce que chacun reçoit, et par quel canal. |

**Ce document spécifie intégralement la tranche 1.** Les tranches 2 à 4 y sont nommées pour que le
périmètre de la 1 soit lisible, et elles seront spécifiées à leur tour, avant leur code.

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
2. sur le commentaire `…0d5` de la card `…0c5` (`maintenance`), écrit par Farida : mention de
   **Camille**. Le destinataire y est en écriture, l'auteure en écriture par droit fin : le cas
   nominal, sur un autre track et un autre channel que le premier.

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
