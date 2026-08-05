# Spécification — Données de développement et de démonstration

Unités de backlog : `CRM-005` (socle), `CRM-046` (démonstration complète) — voir `docs/BACKLOG.md`.
Documents liés : `docs/DAT.md` §11, `docs/SCHEMA.md` §1, `docs/SPEC-permissions-rls.md` §2,
`docs/SPEC-auth.md` §3 et §4, `README.md` §5 et §8.

Ce document a été écrit **après mesure** du comportement réel de `supabase/gotrue:v2.189.0` et de
`postgrest/postgrest:v14.12`, les versions épinglées par `docker-compose.yml`. Chaque comportement
décrit ici est soit mesuré et consigné dans `docs/JOURNAL.md`, soit explicitement signalé comme non
mesuré. Aucun mécanisme n'est supposé d'après la documentation d'un service tiers.

---

## 1. Principe

Le seed est un **contrat maintenu**, pas un jeu de données de confort. Trois règles le gouvernent :

1. **Les données naissent des vrais mécanismes applicatifs.** Un compte est créé par l'API
   d'administration GoTrue, jamais par un `INSERT` dans `auth.users` ; un workspace est créé par
   l'API REST, jamais par `psql`. Une donnée fabriquée à côté du produit ne prouve rien du produit
   (`CLAUDE.md` §8, `docs/DAT.md` §11).
2. **Le seed converge, il ne duplique pas.** Il est rejouable sur une base déjà seedée sans
   erreur ni ligne en double, pour la même raison que les migrations le sont (`docs/JOURNAL.md`,
   décision 20).
3. **Le seed n'existe qu'en développement.** Il porte des mots de passe faibles et connus,
   publiés dans ce dépôt. Il refuse de s'appliquer à tout environnement dont le profil n'est pas
   `dev`.

Le seed **socle** de `CRM-005` couvre l'identité et le cloisonnement, seules tables livrées à ce
jour. Il grandit avec le produit : toute unité qui introduit une table, un statut, un flux ou une
règle métier étend le seed **dans le même changement** (`CLAUDE.md` §8). `CRM-046` livrera le jeu
de démonstration complet.

## 2. Ce que le seed socle livre

### 2.1 Espace de travail

| Colonne | Valeur |
|---|---|
| `id` | `5eed0000-0000-4000-8000-000000000001` |
| `name` | `P2Enjoy SAS` |
| `slug` | `p2enjoy` |
| `inbound_domain` | `crm.p2enjoy.test` |
| `settings` | `{}` |

Un seul workspace, conformément à `CRM-005`. Le second workspace, nécessaire à la preuve de refus
n° 3 de `docs/SPEC-permissions-rls.md` §7 — « membre du workspace A lit une card du workspace B » —
n'est **pas** livré ici : voir §8.

### 2.2 Comptes et rôles

Les trois rôles de `docs/SPEC-permissions-rls.md` §2.1 sont représentés, un compte chacun :

| `id` | Email | Nom affiché | Rôle de workspace |
|---|---|---|---|
| `5eed0000-0000-4000-8000-000000000011` | `admin@p2enjoy.test` | Camille Aubert | `admin` |
| `5eed0000-0000-4000-8000-000000000012` | `bizdev@p2enjoy.test` | Driss Lemoine | `business_developer` |
| `5eed0000-0000-4000-8000-000000000013` | `viewer@p2enjoy.test` | Farida Nowak | `viewer` |

**Les droits fins sont posés depuis `CRM-012`**, l'unité qui les a rendus opposables. Contrat
détaillé au §2.11.

### 2.3 Mot de passe de développement

Les trois comptes partagent le mot de passe **`SeedDev2026Local`** (16 caractères).

Ce n'est pas un secret : il est publié ici, dans `README.md` et dans le script lui-même. C'est
précisément ce qui le rend acceptable — il ne prétend pas protéger quoi que ce soit, et le §1
interdit au seed de s'appliquer ailleurs qu'en développement. `CLAUDE.md` §3 interdit de versionner
un secret **réel** ; un identifiant de démonstration destiné à une base jetable n'en est pas un, et
`README.md` §11 l'annonçait déjà.

Sa longueur satisfait `PASSWORD_MIN_LENGTH=12` (`docs/SPEC-auth.md` §4) — **volontairement**, et
non parce que l'API l'imposerait : la mesure du §3.5 établit qu'elle ne l'impose pas sur ce chemin.

### 2.4 Domaine des adresses

Toutes les adresses du seed sont sous `p2enjoy.test`. Le TLD `.test` est réservé par la RFC 2606 :
il ne peut **pas** être enregistré ni routé. Un email envoyé par erreur à un compte du seed ne peut
donc atteindre personne de réel.

## 3. Mécanismes employés, et ce qui a été mesuré

### 3.1 Les comptes naissent de l'API d'administration GoTrue

`POST /auth/v1/admin/users`, avec la clé de service. Trois faits mesurés :

- **L'API accepte un identifiant fourni par l'appelant.** Le champ `id` de la charge utile est
  honoré : le compte créé porte exactement l'UUID demandé. C'est ce qui rend les identifiants du
  §4 tenables sans lecture préalable.
- **Le profil est créé par le trigger de `CRM-003`**, alimenté par `user_metadata` : `full_name` et
  `locale` de la charge utile se retrouvent dans `public.profiles`. Le seed ne crée donc **aucun**
  profil lui-même — il serait faux qu'il le fasse, la table étant sous l'autorité du trigger.
- **`email_confirm: true`** rend le compte immédiatement utilisable : la connexion par mot de passe
  répond `200`. Sans lui, le compte attendrait la confirmation d'une adresse qui n'existe pas.

### 3.2 Le workspace et les appartenances naissent de l'API REST

`POST /rest/v1/workspaces` et `POST /rest/v1/workspace_members`, avec la clé de service.

Mesuré : la clé de service **écrit malgré le refus par défaut** de `CRM-003` — RLS activée, aucune
politique — parce que `service_role` contourne RLS par construction. La même requête avec la clé
anonyme est refusée (`HTTP 401`, `SQLSTATE 42501`), l'`INSERT` n'étant accordé qu'à
`authenticated` par la migration `0001`.

C'est le chemin le plus proche du produit **disponible aujourd'hui** : la véritable API REST, son
cache de schéma, ses contraintes. Il reste un chemin d'exploitation, et non le geste qu'un
administrateur posera depuis l'interface — celui-là exige les politiques de `CRM-012` et l'écran
correspondant, aucun des deux n'étant livré. La limite est nommée au §8 plutôt que masquée.

La contrainte `CHECK` sur `workspace_members.role` a été mesurée active à travers l'API : un rôle
hors des trois valeurs est refusé en `HTTP 400`, `SQLSTATE 23514`.

### 3.3 La convergence passe par l'upsert de PostgREST

Mesuré : l'en-tête `Prefer: resolution=merge-duplicates` produit un véritable upsert. Deux passages
consécutifs sur `workspace_members`, dont la clé primaire est composite, rendent `201` puis `200`,
et laissent **une seule ligne**.

### 3.4 Un compte déjà présent est mis à jour, pas recréé

Mesuré : recréer un compte dont l'adresse existe est refusé — `HTTP 422`, `error_code`
`email_exists`. Le seed teste donc la présence du compte avant de le créer.

**Mesure décisive pour la convergence** : `PUT /auth/v1/admin/users/{id}` met bien à jour le
compte, mais **le profil ne suit pas**. Le trigger de `CRM-003` est `AFTER INSERT` et porte
`on conflict (id) do nothing` : il ne se déclenche pas sur une mise à jour, et ne réécrirait pas un
profil existant même s'il se déclenchait. C'est le comportement voulu par la décision 22 — un profil
édité par son titulaire ne doit pas être écrasé — mais il signifie que le seed ne peut pas compter
sur les métadonnées pour converger un nom affiché.

Le seed converge donc `public.profiles` **explicitement**, par `PATCH /rest/v1/profiles`, mesuré
efficace avec la clé de service. Les deux voies restent des mécanismes réels du produit ; aucune ne
passe par `psql`.

### 3.5 L'API d'administration n'applique pas la politique de mot de passe

Mesuré, et contraire à `docs/SPEC-auth.md` §4, qui énonce la politique sans réserve :

| Chemin | Mot de passe | Résultat mesuré |
|---|---|---|
| `PUT /auth/v1/user` (chemin utilisateur) | 11 caractères | `422 weak_password`, « Password should be at least 12 characters. » |
| `POST /auth/v1/admin/users` (chemin d'administration) | 8 caractères | `200` — **compte créé**, et il se connecte réellement |

Le réglage est pourtant bien appliqué au conteneur : `GOTRUE_PASSWORD_MIN_LENGTH=12`. La politique
encadre donc ce que l'**utilisateur** choisit, pas ce que l'**opérateur** impose.

Cette contradiction est consignée dans `docs/INCONSISTENCY_REPORT.md`, **INC-018**, et n'est
**pas** résolue ici : la corriger relèverait de `CRM-011`, et le choix entre « documenter la
réserve » et « valider côté seed ou côté produit » appartient au responsable. Le seed s'y conforme
volontairement — ses mots de passe font 16 caractères — et le §7 exige que ce soit **prouvé**,
puisque l'API ne le garantit pas.

## 4. Identifiants stables

Tout identifiant du seed est **fixé dans le script**, jamais tiré au hasard. Les tests, les
captures et les futures spécifications peuvent donc y faire référence sans lecture préalable.

La convention est visible à l'œil nu : tout UUID du seed commence par **`5eed`**, ce qui rend une
ligne seedée reconnaissable immédiatement dans la base, dans un journal ou dans une capture.

```
5eed0000-0000-4000-8000-0000000000NN
└──┬─┘                 ┬          └┬┘
   │                   │           └── rang dans sa famille
   │                   └── variant RFC 4122, et version 4 en amont
   └── marqueur « seed »
```

| Famille | Plage |
|---|---|
| Espaces de travail | `…000000000001` et suivants |
| Comptes | `…000000000011` et suivants |
| Tracks | `…000000000021` et suivants (`CRM-020`) |
| Channels | `…000000000031` et suivants (`CRM-021`) |
| Nœuds du catalogue | `…000000000041` et suivants (`CRM-030`) |

Les identifiants restent des UUID valides : version `4`, variant `8`. Aucun outil ne les distingue
d'un identifiant produit par `gen_random_uuid()` autrement que par leur préfixe.

## 5. Gardes

| Garde | Motif |
|---|---|
| Profil `dev` exigé (`P2ENJOY_ENV_PROFILE`) | Le seed publie des mots de passe. L'appliquer ailleurs qu'en développement créerait des comptes réellement utilisables par quiconque a lu ce dépôt |
| Fichier d'environnement validé contre `.env.example` | Même contrat que les trois scripts de lancement (`CRM-002`) |
| Pile démarrée exigée | Le seed passe par l'API : sans elle, il ne peut qu'échouer, et doit le dire plutôt que réussir à moitié |

Le seed **ne détruit rien**. Il ne supprime aucun compte, aucun workspace, aucune appartenance : il
crée ou met à jour. La destruction appartient à `resetMe.sh`, qui porte ses propres gardes et sa
confirmation explicite (`CLAUDE.md` §9).

## 6. Interface d'exécution

```bash
supabase/seed/apply-seed.sh          # applique le seed sur la pile de développement en cours
supabase/seed/apply-seed.sh --help
```

Le script lit `.env` à la racine, ou le fichier désigné par `P2ENJOY_ENV_FILE`, comme tous les
scripts du dépôt. `resetMe.sh` l'appelle après le redémarrage à froid, en lui transmettant le
fichier d'environnement qu'il a lui-même validé.

`npm run db:seed` reste annoncé par `README.md` §5 et `docs/DAT.md` §13 ; il n'aura d'objet qu'avec
le `package.json` de `CRM-007` (INC-008).

## 7. Preuves exigées

Exécutées **hors interface**, contre l'API réelle, par `scripts/verify-seed.sh` :

| # | Scénario | Attendu |
|---|---|---|
| 1 | Le workspace existe, avec l'identifiant, le nom, le slug et le domaine du §2.1 | Conforme |
| 2 | Les trois comptes existent, avec les identifiants **fixes** du §2.2 | Conforme |
| 3 | Les trois profils existent, avec le nom affiché et la langue attendus | Conforme |
| 4 | Les trois appartenances existent, avec les rôles attendus, et **aucune autre** | Conforme |
| 5 | Chacun des trois comptes **se connecte réellement** avec le mot de passe publié | `200`, jeton émis |
| 6 | Le jeton obtenu porte le `sub` égal à l'identifiant fixe du compte | Conforme |
| 7 | Le mot de passe du seed satisfait `PASSWORD_MIN_LENGTH` | Longueur ≥ réglage appliqué au conteneur |
| 8 | Le seed est **rejouable** : second passage sans erreur | Aucune ligne dupliquée, identifiants inchangés |
| 9 | Une dérive est **rattrapée** : nom de profil et rôle modifiés à la main, seed rejoué | Valeurs du contrat rétablies |
| 10 | Le refus par défaut tient toujours : anonyme sur les cinq tables du socle | `200` et zéro ligne |
| 11 | Un compte du seed ne voit **rien** de plus qu'un anonyme | Zéro ligne — aucune politique n'existe encore |
| 12 | Le seed **refuse** un profil d'environnement autre que `dev` | Sortie non nulle, aucune écriture |

Le harnais doit être **non complaisant** : sa sévérité est éprouvée en faussant réellement le seed
— identifiant modifié, rôle modifié, compte supprimé — et en exigeant qu'il échoue.

La preuve n° 11 mérite d'être explicitée : elle constate qu'à ce stade **le seed ne rend pas les
données lisibles**. C'est le comportement voulu — les politiques arrivent avec `CRM-012` —, et le
seed ne doit surtout pas l'anticiper en posant une politique pour « rendre l'application
utilisable ».

### 2.5 Tracks — ajoutés par `CRM-020`

Quatre tracks dans l'espace de travail, dont un **archivé**. Contrat détaillé et motifs :
`docs/SPEC-tracks.md` §8.

| id | slug | nom | couleur | icône | position | état |
|---|---|---|---|---|---|---|
| `…021` | `conseil-ia` | Conseil & IA | `brand` | `sparkles` | 1 | actif |
| `…022` | `studio-web` | Studio web | `success` | `layout-dashboard` | 2 | actif |
| `…023` | `formation` | Formation | `accent` | `graduation-cap` | 3 | actif |
| `…024` | `pipeline-2024` | Pipeline 2024 | `neutral` | `archive` | 4 | **archivé** |

Le quatrième existe pour que l'état « archivé » soit **démontrable** et non seulement documenté
(`CLAUDE.md` §8). Comme le workspace et les appartenances, ils sont créés par l'API REST avec la
clé de service, et l'écriture est convergente (`Prefer: resolution=merge-duplicates`).

### 2.6 Channels — ajoutés par `CRM-021`

Six channels répartis sur les trois tracks actifs, dont un **archivé**. Contrat détaillé et
motifs : `docs/SPEC-channels.md` §8.

| id | track | slug | nom | position | état |
|---|---|---|---|---|---|
| `…031` | `conseil-ia` | `prospection` | Prospection | 1 | actif |
| `…032` | `conseil-ia` | `grands-comptes` | Grands comptes | 2 | actif |
| `…033` | `conseil-ia` | `appels-offres` | Appels d'offres | 3 | **archivé** |
| `…034` | `studio-web` | `refonte` | Refonte de site | 1 | actif |
| `…035` | `studio-web` | `maintenance` | Maintenance | 2 | actif |
| `…036` | `formation` | `inter-entreprises` | Inter-entreprises | 1 | actif |

Trois répartitions sont démontrées, et non une seule : deux channels actifs plus un archivé, deux
channels actifs, et **un seul** channel — une barre à un onglet est un cas d'affichage réel,
distinct de la barre vide. Le track archivé `pipeline-2024` n'en porte aucun : un track masqué n'a
pas à démontrer une barre d'onglets.

`workflow_id` est laissé **nul partout**. C'est l'état réel du produit jusqu'à `CRM-031` (INC-029),
et le seed ne fabrique pas une donnée que le modèle ne sait pas encore produire (`CLAUDE.md` §8).

### 2.7 Catalogue de nœuds — ajouté par `CRM-030`

Les sept nœuds du workflow de référence, plus un **archivé**. Contrat détaillé et motifs :
`docs/SPEC-workflow-engine.md` §2.9.

| id | clé | libellé | type | couleur | probabilité | seuil | position | état |
|---|---|---|---|---|---|---|---|---|
| `…041` | `prospection` | Prospection | `open` | `neutral` | 10 % | 14 j | 1 | actif |
| `…042` | `relance` | Relance | `open` | `accent` | 20 % | 7 j | 2 | actif |
| `…043` | `negociation` | Négociation | `open` | `brand` | 50 % | 10 j | 3 | actif |
| `…044` | `signature` | Signature | `open` | `brand` | 90 % | 7 j | 4 | actif |
| `…045` | `realisation` | Réalisation | `open` | `success` | 100 % | 30 j | 5 | actif |
| `…046` | `livre` | Livré | `won` | `success` | 100 % | — | 6 | actif |
| `…047` | `perdu` | Perdu | `lost` | `danger` | 0 % | — | 7 | actif |
| `…048` | `qualification` | Qualification | `open` | `neutral` | 5 % | 21 j | 8 | **archivé** |

Trois propriétés sont démontrées, et non une seule :

- **les trois types sont représentés**, `won` et `lost` compris — sans eux, l'analytique de
  conversion n'aurait aucune donnée de démonstration ;
- **les cinq jetons du design system sont exercés**, `danger` compris. Un jeton que rien ne porte
  n'est jamais mesuré : c'est la leçon du correctif de contraste de `CRM-020` ;
- **les deux nœuds terminaux n'ont aucun seuil de relance**, la valeur étant `NULL` et non `0` —
  une affaire livrée ou perdue n'est pas en retard, et la contrainte de la migration refuserait un
  zéro.

Le nœud archivé est hors des sept du contrat métier : sans lui, l'état archivé du catalogue serait
documenté sans être démontrable (`CLAUDE.md` §8), comme pour le track archivé de `CRM-020` et le
channel archivé de `CRM-021`.

**Ce que le seed rend désormais visible, et ce qu'il ne rend toujours pas visible.** Le message
affiché en fin d'exécution a été corrigé par `CRM-020`, `CRM-021` puis `CRM-030` : `tracks`,
`channels`, `workflow_nodes_catalog` et, depuis `CRM-031`, `workflows`, `workflow_steps` et
`workflow_transitions` portent des politiques : un membre du workspace y lit ses quatre tracks, ses
six channels, ses huit nœuds et son workflow, tandis que `profiles`, `workspaces` et
`workspace_members` restent en refus par défaut jusqu'à `CRM-012`. Annoncer un refus général serait
devenu faux.

### 2.11 Droits fins — ajoutés par `CRM-012`

Quatre lignes, choisies pour que **chacune des quatre situations** de la matrice du §2.2 de
`docs/SPEC-permissions-rls.md` soit exercée par une donnée réelle, et non seulement décrite.

| Table | Cible | Compte | `access` | Ce que cette ligne démontre |
|---|---|---|---|---|
| `track_members` | `conseil-ia` | `viewer@p2enjoy.test` | `none` | une restriction **ferme** un sous-arbre entier, ses channels compris |
| `channel_members` | `prospection` | `viewer@p2enjoy.test` | `member` | la règle la plus spécifique **rouvre** ce que la moins spécifique ferme, et en écriture |
| `channel_members` | `maintenance` | `bizdev@p2enjoy.test` | `viewer` | une restriction en **lecture seule** d'un compte qui écrit partout ailleurs |
| `track_members` | `conseil-ia` | `admin@p2enjoy.test` | `none` | un administrateur **n'est jamais restreint** : la ligne existe, elle est lisible, elle est sans effet |

La quatrième mérite son motif. Sans elle, « un administrateur n'est jamais restreint » resterait une
règle démontrée par la seule suite pgTAP, sur une ligne créée puis détruite. Avec elle, la
démonstration est **permanente** et opposable : n'importe qui peut se connecter avec le compte
administrateur et constater qu'un droit fin restrictif le laisse voir les quatre tracks.

**Ce que ces lignes changent aux écrans, et qui est voulu.** Le compte `viewer@p2enjoy.test` ne voit
plus que trois tracks sur quatre, et un seul des trois channels de `conseil-ia`. Ce n'est pas un
appauvrissement du seed : c'est la première fois qu'un compte du seed voit **autre chose** qu'un
autre, ce que `CLAUDE.md` §8 demande de couvrir — « les principaux profils », « les branches
alternatives ».

**Aucune ligne n'est posée sur un track ou un channel archivé.** Un droit fin sur un objet déjà
masqué ne démontrerait rien, les deux causes de refus se confondant.

### 2.8 Workflow par défaut — ajouté par `CRM-031`

Un workflow `global`, par défaut du workspace, ses sept étapes et ses dix transitions. Contrat
détaillé et motifs : `docs/SPEC-workflow-engine.md` §3.9.

| id | nom | portée | par défaut | étapes | transitions |
|---|---|---|---|---|---|
| `…051` | Cycle commercial standard | `global` | oui | 7 | 10 |

Les étapes portent les identifiants `…061` à `…067`, dans l'ordre du catalogue actif ; les
transitions, `…071` à `…07a`.

Quatre propriétés sont démontrées, et non une seule :

- **une étape initiale, et une seule** — la base garantit « au plus une » (§3.5), le seed fournit
  l'autre moitié de l'exigence, que la base ne peut pas imposer ;
- **deux surcharges, sur deux colonnes différentes** — `negociation` raccourcit son seuil de
  relance à 5 jours, `realisation` prend le libellé « Réalisation en cours ». Sans elles, la
  faculté de surcharger serait documentée sans être démontrable ;
- **quatre transitions exigent un commentaire**, celles qui mènent à « Perdu » — sans quoi
  `require_comment` ne serait jamais exercée. Ce choix est nommé au §3.9 et renversable ;
- **`Réalisation → Perdu` n'est pas déclarée**, conformément au point ouvert n° 1 de la
  spécification : une absence se démontre comme le reste, et `scripts/verify-workflows.sh` la
  vérifie.

Le nœud archivé `qualification` reste **hors** du workflow : un vocabulaire retiré ne s'instancie
pas. `require_fields` reste vide partout — depuis `CRM-035` le motif a changé, et il est écrit au
§2.10 plutôt que laissé périmé : la colonne peut désormais désigner des champs réels, mais aucune
garde ne la lit.

**Les six channels reçoivent ce workflow.** Ils étaient sans `workflow_id` depuis `CRM-021`, faute
de table `workflows` (INC-029). Le rattachement se fait en fin de section 6 du script, et non dans
la section des channels : à ce moment-là, le workflow n'existe pas encore, ses étapes instanciant
des nœuds du catalogue créé après eux.

### 2.9 Copie du workflow vers un track — ajoutée par `CRM-032`

Une copie du workflow par défaut, posée sur le track « Conseil & IA », sous le nom
« Cycle commercial — Conseil IA ». Contrat détaillé et motifs :
`docs/SPEC-workflow-engine.md` §4.10.

| source | track | nom | portée | par défaut | étapes | transitions |
|---|---|---|---|---|---|---|
| `…051` | `…021` | Cycle commercial — Conseil IA | `track` | **non** | 7 | 10 |

Deux points distinguent cette section de toutes les précédentes, et ils sont voulus.

**Elle n'écrit aucune ligne : elle appelle `copy_workflow_to_track`**, la véritable fonction du
produit, par le véritable appel RPC de l'API REST. `CLAUDE.md` §8 l'exige — une donnée de
démonstration naît du mécanisme réel. Ce qu'elle démontre d'un seul geste : la portée `track`, la
traçabilité d'origine, le forçage de `is_default` et le remappage des arêtes.

**Le jeton employé est celui de l'administrateur seedé, obtenu par la vraie route de connexion**, et
non la clé de service. La fonction exige `app.is_workspace_admin`, qui lit `auth.uid()` ; la clé de
service n'a pas de `sub`, et l'appel serait refusé par `workflow_not_found`. Ce n'est pas un
obstacle contourné, c'est la garde qui fonctionne : le seed la traverse comme un administrateur le
ferait.

**L'identifiant de la copie n'est PAS stable**, contrairement à toutes les autres lignes du seed
(§4). Il est frappé par la fonction. Le rendre stable supposerait un paramètre de plus sur
`copy_workflow_to_track`, ajouté pour le seul confort du seed — une API façonnée par ses tests. La
copie se retrouve donc par sa **source et son track**, ce que font toutes les preuves. C'est le
prix assumé de la règle « la donnée de démonstration naît du mécanisme réel », et il est nommé ici
plutôt que découvert par le premier test qui chercherait un `…052`.

**La convergence est vérifiée avant d'agir**, et non obtenue par un upsert : la fonction crée
toujours une ligne neuve, et rien n'interdit deux copies du même workflow sur le même track. Le
seed regarde si la copie existe et n'appelle la fonction que si elle manque. Un second passage ne
crée rien, ce que `scripts/verify-copie-workflow.sh` mesure.

**Un défaut de convergence, trouvé et corrigé par `CRM-033` — INC-041.** La recherche portait sur la
source **et** le track. Mesuré, reproductible : le `track_id` de la copie déplacé à la main, la
recherche ne la trouvait plus et le seed en créait une **seconde**. Le contrat en déclare une ; le
seed en laissait deux, sans erreur ni avertissement — idempotent sans être convergent, troisième
forme de la décision 57 et la première sur un seed. Trois corrections dans le même changement : la
copie est cherchée par sa **seule** dérivation, son track et son nom sont **ramenés** aux valeurs
déclarées, et toute copie **surnuméraire** est supprimée, la plus ancienne étant conservée.

**Ce que `CRM-033` change à l'ordre du seed.** `channels.workflow_id` devient `NOT NULL` : le
workflow par défaut doit donc naître **avant** les channels. Sa ligne est créée en section 3 bis —
elle ne dépend d'aucun nœud du catalogue, seules ses étapes en dépendent —, et le `PATCH` de
rattachement qui terminait la section 6 depuis `CRM-031` disparaît, les channels naissant rattachés.
`prospection` est ensuite rattaché à la copie de portée `track` en section 7, une fois celle-ci
créée : elle dérive du workflow global et ne peut donc pas le précéder. L'ordre des trois gestes de
cette section n'est pas indifférent — le channel est rendu au workflow global, ce qui **libère** la
copie, puis la copie est ramenée à son track, puis le channel la rejoint. Rattacher d'abord ferait
refuser la convergence par le trigger de `CRM-033` : le seed traverse la garde dans le bon ordre
plutôt que de la contourner.

**Conséquence sur les comptes des unités précédentes :** le workspace porte désormais **deux**
workflows, dont un seul `global` et un seul par défaut. Les contrôles qui comptaient « un workflow,
ni plus ni moins » ont été révisés dans le même changement — mécanisme de la décision 51, cinquième
occurrence.

### 2.10 Champs de formulaire et règles de visibilité — ajoutés par `CRM-035`

Sept champs sur le workflow par défaut, dont **un archivé**, et quinze règles de visibilité.
Contrat détaillé et motifs : `docs/SPEC-form-composer.md` §2.9.

| id | clé | libellé | type | position | état |
|---|---|---|---|---|---|
| `…081` | `budget` | Budget estimé | `money` | 1 | actif |
| `…082` | `source` | Origine du contact | `select` | 2 | actif |
| `…083` | `date-signature-prevue` | Date de signature prévue | `date` | 3 | actif |
| `…084` | `motif-perte` | Motif de la perte | `textarea` | 4 | actif |
| `…085` | `decideur-identifie` | Décideur identifié | `checkbox` | 5 | actif |
| `…086` | `lien-proposition` | Lien vers la proposition | `url` | 6 | actif |
| `…087` | `budget-previsionnel` | Budget prévisionnel | `number` | 7 | **archivé** le 2026-03-15 |

Six types distincts sont couverts, et ce n'est pas un hasard : `money` et `select` sont les deux
seuls dont la base **exige** des options (`docs/SPEC-form-composer.md` §2.4, décision 94). Sans eux
dans le seed, ces deux contraintes seraient documentées sans être démontrables.

Le champ archivé démontre deux choses d'un seul geste : l'état « archivé » côté formulaire, comme un
track, un channel et un nœud archivés avant lui, **et** le fait qu'un champ archivé garde sa clé
réservée (décision 96). Il n'a **aucune règle** — l'archivage ne demande aucun ménage.

Les quinze règles couvrent les **trois** visibilités :

| Visibilité | Nombre | Où |
|---|---|---|
| `hidden` | 7 | `budget`, `date-signature-prevue`, `lien-proposition` et `motif-perte` en prospection ; `motif-perte` aussi en relance, négociation et signature |
| `required` | 6 | `source` en prospection ; `budget` en négociation et en signature ; `date-signature-prevue` et `decideur-identifie` en signature ; `motif-perte` en perdu |
| `visible` | 2 | `source` en relance, `lien-proposition` en négociation |

`visible` est écrit **explicitement** deux fois, bien qu'il soit la valeur par défaut. Sans cela, la
valeur `'visible'` de la colonne ne serait jamais exercée par aucune donnée, et rien ne
distinguerait « déclaré facultatif » de « non déclaré ».

**Et vingt-sept couples champ × étape restent sans règle** — sept étapes fois six champs actifs,
moins les quinze règles, qui portent toutes sur un champ actif. C'est ce qui démontre la valeur par défaut du
§3.1 : une valeur par défaut qu'aucune donnée n'exerce n'est pas démontrée.

**`require_fields` restait vide sur les dix transitions** tant qu'aucune garde ne la lisait. Le
motif est éteint depuis `CRM-036`, qui a livré la sixième vérification de `move_card` : la
transition *signature → réalisation* porte désormais `require_fields = {…086}` — `lien-proposition`.
Voir §2.13.

**La copie de la section 2.9 ne reçoit aucun champ.** `copy_workflow_to_track` n'en copie aucun, et
son comportement reste inchangé — INC-037, arbitrage attendu du responsable, décision 93. L'écart
est **compté** par les preuves plutôt que passé sous silence : la source porte sept champs, la copie
zéro.

### 2.12 Cards — ajoutées par `CRM-040`

Neuf cards, réparties sur **quatre** channels et **trois** tracks, à cinq étapes distinctes du
workflow global. Le détail du contrat vit dans `docs/SPEC-cards.md` §9, qui est la référence ; ce
chapitre ne retient que ce qui engage le seed.

- **Sept actives, une archivée, une en corbeille.** Les deux suppressions douces de
  `docs/SPEC-cards.md` §4 sont donc démontrées par des données réelles, non seulement décrites.
- **Une card sans responsable et sans montant**, pour que le caractère nullable d'`owner_id` et
  d'`amount` soit exercé.
- **Deux devises distinctes**, sans quoi le défaut de colonne `EUR` serait la seule valeur jamais
  observée.
- **`email_local_part` n'est jamais envoyé** par le seed : il est généré par le trigger de la
  migration 11. Il est donc **stable d'un rejeu à l'autre**, la branche de mise à jour d'un `upsert`
  ne touchant que les colonnes envoyées. Un contrôle de `scripts/verify-cards.sh` le constate.
- **AUCUNE card dans `prospection`**, et le motif est mesuré : c'est le seul channel que le seed
  **repointe** — section 4 vers le workflow global, section 7 vers la copie de portée track —, et la
  clé composite de `CRM-040` refuse ce déplacement dès qu'une card l'occupe. MESURÉ : le seed échoue
  alors **en section 4**, code de sortie `1`, `23503`. Contre-épreuve mesurée : une card dans
  `grands-comptes` laisse le seed vert. INC-046, arbitrage attendu, `docs/SPEC-cards.md` §9.1.

Ce que le seed **ne** démontre **pas**, et qui est nommé plutôt que compensé : aucune card sur un
**workflow dérivé**, pour la raison ci-dessus ; aucune valeur de formulaire, `card_field_values`
arrivant à `CRM-036` ; aucun événement de timeline, `card_events` arrivant à `CRM-044`.

### 2.13 Valeurs de formulaire — ajoutées par `CRM-036`

Quatorze valeurs sur **six cards**. Contrat détaillé et motifs : `docs/SPEC-form-composer.md` §6.11.

| Card | Champ | Valeur | Ce qu'elle démontre |
|---|---|---|---|
| `…0c1` *Refonte du site vitrine*, relance | `source` | `"recommandation"` | un `select` dont la clé figure dans `options.choices` |
| `…0c1` | `budget` | `null` | **une ligne présente n'est pas une valeur renseignée** (§6.6) : la transition vers *négociation* est refusée |
| `…0c2` *Migration ERP Sogexia*, relance | `source` | `"salon"` | — |
| `…0c2` | `budget` | `45000` | le cas **symétrique** de `…0c1` : même étape, même transition, acceptée |
| `…0c3` *Audit sécurité applicative*, prospection | `source` | `"site"` | l'exigence de son étape courante, satisfaite |
| `…0c3` | `budget` | `90000` | un champ **`hidden` à l'étape courante portant une valeur** (§4, section repliée) |
| `…0c3` | `budget-previsionnel` | `72000` | une valeur portée par un champ **archivé** (§5) : elle survit, et n'exige rien |
| `…0c4` *Refonte intranet Ville de Lyon*, négociation | `budget` | `120000` | — |
| `…0c4` | `lien-proposition` | `"https://…"` | un `url` conforme |
| `…0c6` *Piste entrante à qualifier*, prospection | `source` | `"prospection"` | — |
| `…0c6` | `motif-perte` | `"…"` | le parcours **« Marquer perdu »** reste franchissable : l'étape *perdu* exige ce champ |
| `…0c7` *Formation Data & IA*, signature | `budget` | `78000` | — |
| `…0c7` | `date-signature-prevue` | `"2026-09-30"` | un `date` convertible |
| `…0c7` | `decideur-identifie` | `true` | un `checkbox` — et **`false` serait tout autant renseigné** (§6.6) |

Sept types sur quinze sont donc exercés par des données permanentes : `money`, `select`, `date`,
`textarea`, `checkbox`, `url`, `number`. Ce sont exactement ceux que `CRM-035` a déclarés ; en
ajouter d'autres exigerait de nouveaux champs, donc de rouvrir `CRM-035`. Les huit restants sont
éprouvés par la suite pgTAP sur des champs sondes, créés puis détruits.

**Une transition porte enfin `require_fields`.** *Signature → réalisation* (`…074`) exige
`lien-proposition`. C'est la seule donnée du seed qui exerce le **second membre** de l'union du
§3.5 de `docs/SPEC-form-composer.md` : la card `…0c7` satisfait les trois exigences de son étape
courante et reste bloquée par cette quatrième, portée par l'arête et non par l'étape.

**Aucune valeur n'est posée sur la card archivée ni sur celle en corbeille.** Une card rangée ne se
déplace pas : y poser des valeurs n'exercerait rien que les six autres n'exercent déjà.

### 2.14 Commentaires — ajoutés par `CRM-043`

Cinq commentaires sur **trois** cards, écrits par les **trois** comptes du seed. Contrat détaillé et
motifs : `docs/SPEC-cards.md` §13.11.

| Card | Auteur | État | Ce qu'il démontre |
|---|---|---|---|
| `…0c1` *Refonte du site vitrine* | Camille Aubert (`admin`) | vivant | le cas nominal |
| `…0c1` | Driss Lemoine (`business_developer`) | vivant | deux auteurs sur une même card, donc un **fil** |
| `…0c1` | Camille Aubert | **modifié** | `edited_at` renseigné : l'état « modifié » est démontré, non seulement décrit |
| `…0c4` *Refonte intranet Ville de Lyon* | Driss Lemoine | **supprimé** | la pierre tombale : `deleted_at` renseigné et **corps vide**, dans un channel d'un autre track |
| `…0c5` *Support niveau 2* | Farida Nowak (`viewer`) | vivant | le **témoin** de la preuve de lecture : le `viewer` lit ce qu'il ne peut pas écrire |

Les identifiants suivent la convention du §4 : `5eed0000-0000-4000-8000-0000000000d1` à `…d5`.

**Deux écritures du seed ne passent pas par le chemin d'un utilisateur, et c'est dit :**

- la ligne de `…0c5` porte `author_id` = Farida Nowak, un `viewer` — que la politique d'insertion
  refuserait. Elle est posée par la **clé de service**, comme toutes les autres lignes du seed, et
  elle existe pour que la lecture autorisée d'un `viewer` soit distinguable d'une table vide
  (décision 50) ;
- l'état « modifié » et l'état « supprimé » sont obtenus par un **second appel** `PATCH` avec la
  clé de service, qui traverse les **vrais triggers** : `edited_at` et `deleted_at` sont donc posés
  par le produit, et le corps du commentaire supprimé est vidé par lui. Le seed ne fabrique aucune
  trace (`CLAUDE.md` §8) — il ne pourrait d'ailleurs pas : les deux colonnes sont posées par
  trigger, et une valeur envoyée y est ignorée.

**La convergence de cette section ne s'écrit PAS comme les autres, et le motif est structurel.**
Partout ailleurs le seed emploie `Prefer: resolution=merge-duplicates` : la ligne présente est
réécrite, ce qui **répare** une modification faite à la main. Ici, ce geste échouerait — le trigger
de `card_comments` refuse toute écriture sur une ligne supprimée (`comment_deleted`), et le rejeu du
seed tomberait en erreur sur la quatrième ligne. Il serait de surcroît faux dans son principe : un
commentaire est une **parole**, non un paramètre ; la réécrire à chaque rejeu effacerait ce qu'un
utilisateur aurait ajouté.

La section emploie donc :

- `Prefer: resolution=ignore-duplicates` pour les cinq insertions — la ligne absente est créée, la
  ligne présente est laissée telle quelle ;
- deux mises à jour **conditionnées par une relecture** : l'état « modifié » n'est posé que si
  `edited_at` est nul, l'état « supprimé » que si `deleted_at` l'est. Un second rejeu ne réécrit
  rien et ne déclenche aucun refus.

La convergence est donc celle de la **présence et de l'état**, non celle du contenu. Elle est
vérifiée en rejouant le seed, et `scripts/verify-commentaires.sh` la contrôle.

### 2.15 Événements de timeline — ajoutés par `CRM-044`

**Le seed n'écrit aucun événement, et il ne le peut pas.** `card_events` n'accorde le privilège
`INSERT` à personne — pas même à `service_role`, MESURÉ (`docs/SPEC-cards.md` §14.7). C'est la
première section du seed dont le contenu est **entièrement dérivé** de ses autres actes : chaque
ligne du fil est le produit d'un trigger déclenché par une écriture réelle.

| Origine | Événements produits | Ce que ça démontre |
|---|---|---|
| §2.12, les 9 cards insérées | 9 × `created`, `actor_id` **nul** | la naissance d'une affaire, et l'attribution à un **service** |
| §2.13, les 14 valeurs de formulaire | 14 × `field_changed`, `payload` **sans clé `from`** | la valeur qui naît, distinguée de la valeur qui change |
| Un aller-retour d'étape sur `…0c4` | 2 × `moved` | la transition, dans les deux sens, par la **vraie** RPC `move_card` |
| Un aller-retour de responsable sur `…0c1` | 2 × `assigned` | l'attribution, par un **vrai** `PATCH` |

**Les deux allers-retours laissent l'état du seed rigoureusement identique.** La card `…0c4`
repart de l'étape de négociation où elle était, la card `…0c1` retrouve Driss Lemoine comme
responsable : aucune assertion des unités précédentes ne bouge, seule l'**histoire** s'allonge.
Deux effets ne sont pas rendus à l'identique, et ils sont nommés : `entered_step_at` et `position`
de `…0c4`, que `move_card` maintient (`docs/SPEC-cards.md` §2.9).

**Convergence : la même écriture que le §2.14, pour une raison voisine.** Un événement ne peut être
ni réécrit ni supprimé ; un rejeu qui referait les allers-retours allongerait le fil de quatre
lignes à chaque exécution. Les deux gestes sont donc **conditionnés par une relecture** : ils ne
sont exécutés que si la card ne porte encore **aucun** événement du type visé — `moved` pour
`…0c4`, `assigned` pour `…0c1`. La lecture passe par la clé de service, qui a le droit de **lire**
la table sans avoir celui d'y écrire.

**Le compte de 27 ne vaut qu'au sortir du seed.** Une timeline enregistre tout, y compris ce que
les preuves du dépôt font ensuite à la même pile. Seule la naissance d'une card est idempotente :
les suites assèrent neuf `created` exactement, et des bornes inférieures pour le reste
(`docs/JOURNAL.md` décision 210).

**Aucune des cinq autres familles n'est démontrée par le seed** : `archived`, `unarchived`,
`trashed` et `restored` supposeraient d'archiver puis de désarchiver une card du seed, ce qui
toucherait `archived_at` et `deleted_at` — deux colonnes dont l'état est asserté par `CRM-040`. Les
quatre types sont exercés par `e2e/api/timeline.spec.ts` avec les jetons réels, sur une card créée
et détruite par la preuve elle-même.

## 8. Ce que ce seed ne livre pas, et pourquoi

- **Aucun second workspace, aucun compte extérieur.** `CRM-005` dit « un workspace ». Les preuves
  n° 3 et n° 7 de `docs/SPEC-permissions-rls.md` §7 en exigeront un, ainsi qu'un compte sans
  appartenance ; `scripts/verify-authz.sh` les crée et les détruit lui-même aujourd'hui. Le point
  est nommé ici pour que `CRM-014` sache qu'il devra soit étendre le seed, soit continuer de
  fabriquer ses propres comptes. Ce n'est pas une contradiction, seulement une frontière d'unité.
- **Aucun droit fin.** Voir §2.2 : les tables cibles n'existent pas.
- **Aucune card, aucun message.** Les tracks, les channels, le catalogue de nœuds et le workflow
  par défaut sont désormais seedés (`CRM-020`, `CRM-021`, `CRM-030`, `CRM-031`) ; les cards et les
  messages restent l'objet de `CRM-046`.
- **Aucun écran, aucune vérification visuelle.** Le seed n'atteint pas l'interface, dont le premier
  écran arrive avec `CRM-007`.
- **Le seed ne crée pas ses comptes depuis le produit.** Le parcours d'invitation n'a aucun
  composant pour le porter (INC-015) : la création reste une opération d'exploitation, comme pour
  `CRM-011`.
