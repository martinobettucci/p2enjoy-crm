# Spécification — Données de développement et de démonstration

Unités de backlog : `CRM-005` (socle), `CRM-046` (démonstration complète) et `CRM-018`
(copie utilisable du formulaire) — voir `docs/BACKLOG.md`.
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
règle métier étend le seed **dans le même changement** (`CLAUDE.md` §8). `CRM-046` porte le jeu de
démonstration complet, spécifié au **§9** : ce que le socle laisse vide, ce qui le comble, et ce qui
reste hors de portée.

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

**Extension décidée par `CRM-022`.** Les trois profils portent un avatar SVG même origine :
`/avatars/camille-aubert.svg`, `/avatars/driss-lemoine.svg` et `/avatars/farida-nowak.svg`. La
valeur converge à la fois dans les métadonnées GoTrue et dans `profiles`, puis est relue. Aucun
réseau tiers n'est nécessaire pour prouver le rendu des avatars.

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

### 2.20 Un second tableau d'objectifs, ARCHIVÉ — ajouté par `CRM-083` tranche 2 h

**Ce qu'il ferme, et le manque est réel.** Depuis la tranche 2 h, la liste des tableaux porte une
case « Afficher les archivés » et une commande de reprise (`docs/SPEC-goals.md` §5.6). Le seed ne
posant **aucun** tableau archivé, cocher la case ne montrait rien : une fonctionnalité livrée serait
restée indémontrable sur le jeu de démonstration, ce que `CLAUDE.md` §8 refuse. C'est le motif exact
qui a fait poser une card **archivée** et une card **en corbeille** à la section 8 ter — un état du
cycle de vie que le seed ne porte pas est un état que personne ne peut regarder.

| Attribut | Valeur | Pourquoi celle-là |
|---|---|---|
| Nom | « Objectifs 2025 (clos) » | Un exercice précédent, la raison la plus ordinaire d'archiver un tableau |
| `position` | `2` | Il se range **après** le tableau vivant, et la reprise **conserve** cette position — une preuve peut donc le constater |
| `archived_at` | `2026-01-15T09:00:00Z`, **fixe** | Un horodatage tiré à l'exécution rendrait la ligne différente à chaque rejeu ; la colonne sert à masquer, jamais à ordonner |
| Blocs | **un**, « Clôturer l'exercice 2025 » | À zéro bloc, « Aucun objectif » et « 1 objectif » seraient indistinguables, et la ligne ne prouverait pas que le compte de blocs **lisibles** suit (§5.6.2, ligne i) |

**L'état est VÉRIFIÉ après écriture, pas supposé.** Un rejeu qui aurait rendu `archived_at` à nul —
par exemple parce qu'une preuve a désarchivé le tableau sans le remettre — laisserait le seed vert
et la case vide, sans que rien ne le dise. Le contrôle compte les tableaux archivés du workspace et
échoue s'il n'en trouve aucun.

**Les preuves d'interface le remettent archivé après CHAQUE scénario**, et non à la fin de la série :
mesuré, une remise en fin de série laissait le scénario suivant échouer sur un décor qu'il n'avait
pas cassé (`e2e/ui/objectifs.spec.ts`, tranche 2 h).

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
| Workflows, étapes, champs | `…000000000051`, `…000000000061`, `…000000000081` et suivants (`CRM-031`, `CRM-035`) |
| Cards | `…0000000000c1` à `…0000000000ce` (`CRM-040`, étendue par `CRM-046`) |
| Commentaires | `…0000000000d1` et suivants (`CRM-043`) |

**Deux valeurs échappent à cette règle, et c'est le produit qui l'impose** : l'identifiant du
workflow **dérivé** et ceux de ses sept étapes sont tirés par `copy_workflow_to_track`. Le seed les
résout à l'exécution par la clé de nœud, jamais par une constante — voir §9.4.

Les identifiants restent des UUID valides : version `4`, variant `8`. Aucun outil ne les distingue
d'un identifiant produit par `gen_random_uuid()` autrement que par leur préfixe.

## 5. Gardes

| Garde | Motif |
|---|---|
| Profil `dev` exigé (`P2ENJOY_ENV_PROFILE`) | Le seed publie des mots de passe. L'appliquer ailleurs qu'en développement créerait des comptes réellement utilisables par quiconque a lu ce dépôt |
| Fichier d'environnement validé contre `.env.example` | Même contrat que les trois scripts de lancement (`CRM-002`) |
| Pile démarrée exigée | Le seed passe par l'API : sans elle, il ne peut qu'échouer, et doit le dire plutôt que réussir à moitié |

Le seed **ne détruit aucune donnée inconnue ni aucune copie utilisateur**. Il ne supprime aucun
compte, workspace ou membership. Une seule exception bornée existe depuis `CRM-018` : l'ancienne
copie de démonstration, identifiable sans ambiguïté comme l'unique dérivation seedée, peut être
reconstruite par la vraie RPC lorsqu'elle ne possède pas encore de formulaire. Avant ce geste, le
seed exige la composition source exacte, seulement les deux cards aux identifiants seedés et aucun
commentaire utilisateur ; sinon il s'arrête. Toute copie supplémentaire est conservée. Une
ambiguïté demande un reset ou une intervention explicite, jamais une suppression opportuniste.

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
| 3 | Les trois profils existent, avec nom, langue et avatar attendus dans `profiles` et GoTrue | Conforme |
| 4 | Les trois appartenances existent, avec les rôles attendus, et **aucune autre** | Conforme |
| 5 | Chacun des trois comptes **se connecte réellement** avec le mot de passe publié | `200`, jeton émis |
| 6 | Le jeton obtenu porte le `sub` égal à l'identifiant fixe du compte | Conforme |
| 7 | Le mot de passe du seed satisfait `PASSWORD_MIN_LENGTH` | Longueur ≥ réglage appliqué au conteneur |
| 8 | Le seed est **rejouable** : second passage sans erreur | Aucune ligne dupliquée, identifiants inchangés |
| 9 | Une dérive est **rattrapée** : nom de profil et rôle modifiés à la main, seed rejoué | Valeurs du contrat rétablies |
| 10 | Le refus par défaut tient toujours : anonyme sur les cinq tables du socle | `200` et zéro ligne |
| 11 | L'administratrice seedée lit exactement son équipe | 3 profils, 1 workspace, 3 memberships |
| 12 | Le seed **refuse** un profil d'environnement autre que `dev` | Sortie non nulle, aucune écriture |

Le harnais doit être **non complaisant** : sa sévérité est éprouvée en faussant réellement le seed
— nom, rôle et mot de passe modifiés — et en exigeant qu'il échoue, puis qu'il rétablisse l'état.

La preuve n° 11 a été retournée par `CRM-022` : le seed ne pose toujours aucune politique, mais la
migration consent désormais les identités d'une même équipe. Le harnais exige les volumes exacts,
pas seulement un statut `200`; le cloisonnement à un second workspace est prouvé séparément par
`e2e/api/identites.spec.ts`.

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
- **cinq transitions exigent un commentaire**, celles qui mènent à « Perdu » — sans quoi
  `require_comment` ne serait jamais exercée. Ce choix est nommé au §3.9 et renversable ;
- **`Réalisation → Perdu` EST déclarée depuis la décision 259** (INC-003, close). Son absence était
  présentée ici comme une règle démontrée ; c'était un **cul-de-sac** recopié d'une énumération
  d'exemples. Le graphe compte donc **onze** transitions, et `scripts/verify-workflows.sh` vérifie
  désormais leur présence au lieu de figer une absence.

Le nœud archivé `qualification` reste **hors** du workflow : un vocabulaire retiré ne s'instancie
pas. À la livraison historique de `CRM-031`, `require_fields` restait vide partout : les champs et
la garde n'existaient pas encore. Depuis `CRM-018`, aucune colonne tableau ne subsiste ; la liaison
effective est posée après la création des champs au §2.13.

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
copie se retrouve donc par sa **source et son nom déclaré**, avec repli sur une dérivation unique
pour réparer une ancienne fixture renommée ou déplacée. Le track fait partie du contrat à
converger, jamais d'un filtre qui créerait un doublon. C'est le prix assumé de la règle « la donnée
de démonstration naît du mécanisme réel », nommé ici plutôt que découvert par le premier test qui
chercherait un `…052`.

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
déclarées, et aucune seconde copie n'est créée lorsqu'une dérivation unique existe.

**CRM-018 retire la suppression des copies surnuméraires** (décision 300). Une dérivation
supplémentaire peut avoir été créée depuis l'interface et ne porte aucun marqueur qui autoriserait
le seed à se l'approprier. Le seed choisit l'unique copie au nom déclaré ; à défaut, il accepte une
unique dérivation comme ancienne fixture déplacée. Plusieurs candidates exactes, ou plusieurs
dérivations sans candidate exacte, rendent l'état ambigu : le seed échoue en nommant les
identifiants et n'en supprime aucune.

**Une copie moderne ne passe pas sur ses seuls comptes** (décision 303). Une fois la candidate
seedée choisie, sa composition métier est comparée à celle de la source en faisant abstraction des
identifiants que la RPC remappe : étapes par nœud, transitions par couple de nœuds, champs par clé,
règles et exigences par ces mêmes clés durables. Toute différence fonctionnelle — même un simple
libellé modifié avec tous les champs toujours présents — arrête le seed avant qu'il n'écrive la
composition cible. Il ne maquille jamais une personnalisation en copie conforme et ne reconstruit
que l'ancienne fixture sans empreinte sous les cinq gardes de la décision 300.

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
| `…088` | `contact-principal` | Contact principal | `contact` | 8 | actif |
| `…089` | `referent-technique` | Référent technique | `user` | 9 | actif |

**Les deux derniers arrivent avec la sous-tranche 4d de `CRM-060`** (`docs/SPEC-contacts.md` §13.6),
et non avec la tranche 3 qui a livré leur règle en base : le §9.6 avait écrit que « la donnée de
démonstration arrive avec l'écran qui la montre », les sélecteurs étant alors dus. Ils sont livrés,
et ces deux champs avec eux.

NEUF types distincts sont couverts, et ce n'est pas un hasard : `money` et `select` sont les deux
seuls dont la base **exige** des options (`docs/SPEC-form-composer.md` §2.4, décision 94) ;
`contact` et `user` sont les deux seuls que le validateur **résout** vers une autre table depuis la
migration `0047`. Sans eux dans le seed, ces quatre contraintes seraient documentées sans être
démontrables. *(Ce paragraphe annonçait « six types » pour sept champs couvrant sept types : écart
de commentaire, antérieur, corrigé ici — INC-159.)*

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

**Et quarante et un couples champ × étape restent sans règle** — sept étapes fois HUIT champs
actifs, moins les quinze règles, qui portent toutes sur un champ actif. Vingt-sept jusqu'à la
sous-tranche 4d : les deux champs ajoutés sont actifs et ne reçoivent aucune règle, précisément pour
que la valeur par défaut les rende `visible` à toutes les étapes. C'est ce qui démontre la valeur par défaut du
§3.1 : une valeur par défaut qu'aucune donnée n'exerce n'est pas démontrée.

**`require_fields` restait vide sur les dix transitions** tant qu'aucune garde ne la lisait. Le
motif est éteint depuis `CRM-036`, qui a livré la sixième vérification de `move_card`. Depuis
`CRM-018`, la transition *signature → réalisation* porte une liaison vers `…086` —
`lien-proposition` — et non un élément de tableau. Voir §2.13.

**La copie de la section 2.9 reçoit le formulaire complet.** Depuis la décision 293,
`copy_workflow_to_track` remappe champs, règles et exigences ; la liaison source
`lien-proposition` possède donc une liaison dérivée vers un **autre** identifiant de champ. Le seed
exige une liaison de chaque côté et zéro référence croisée. Une ancienne copie seedée sans
formulaire est recréée par le vrai geste de copie, jamais maquillée par des insertions manuelles.

### 2.12 Cards — ajoutées par `CRM-040`

Douze cards suivent le workflow global et deux le workflow dérivé, soit **quatorze** cards sur cinq
channels. Les neuf fixtures initiales de `CRM-040` sont étendues par `CRM-046` et `CRM-018` ; le
détail courant vit dans `docs/SPEC-cards.md` §9 et au §9.3 ci-dessous.

- **Douze actives, une archivée, une en corbeille.** Les deux suppressions douces de
  `docs/SPEC-cards.md` §4 sont donc démontrées par des données réelles, non seulement décrites.
- **Une card sans responsable et sans montant**, pour que le caractère nullable d'`owner_id` et
  d'`amount` soit exercé.
- **Deux devises distinctes**, sans quoi le défaut de colonne `EUR` serait la seule valeur jamais
  observée.
- **`email_local_part` n'est jamais envoyé** par le seed : il est généré par le trigger de la
  migration 11. Il est donc **stable d'un rejeu à l'autre**, la branche de mise à jour d'un `upsert`
  ne touchant que les colonnes envoyées. Un contrôle de `scripts/verify-cards.sh` le constate.
- **Deux cards dans `prospection`**, toutes deux sur le workflow dérivé. Le seed ne repointe plus ce
  channel lorsqu'il suit déjà sa copie conforme ; c'est ce qui rend son rejeu compatible avec un
  channel peuplé. Leurs étapes et champs sont résolus à l'exécution, jamais écrits en dur.

Le seed démontre désormais les deux workflows, chaque étape globale, le formulaire dérivé et la
timeline. Les limites restantes sont nommées dans les unités fonctionnelles correspondantes, pas
maintenues ici comme une photographie historique dépassée.

### 2.13 Valeurs de formulaire — ajoutées par `CRM-036`

Vingt et une valeurs sur **onze cards** : quatorze valeurs initiales de `CRM-036`, quatre ajoutées
par `CRM-046` et trois portées par les champs remappés de la copie depuis `CRM-018`. Le tableau
ci-dessous conserve les quatorze valeurs initiales ; les sept extensions sont détaillées au §9.6.

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

**Une transition porte enfin une liaison de champ exigé.** *Signature → réalisation* (`…074`)
exige `lien-proposition`. C'est la seule donnée du seed qui exerce le **second membre** de l'union du
§3.5 de `docs/SPEC-form-composer.md` : la card `…0c7` satisfait les trois exigences de son étape
courante et reste bloquée par cette quatrième, portée par l'arête et non par l'étape.

La copie dérivée porte une liaison remappée vers son propre champ `lien-proposition`. Le seed relit
donc exactement une liaison globale et une dérivée, sans identifiant de champ partagé.

**Aucune valeur n'est posée sur la card archivée ni sur celle en corbeille.** Une card rangée ne se
déplace pas : y poser des valeurs n'exercerait rien que les onze autres n'exercent déjà.

### 2.14 Commentaires — ajoutés par `CRM-043`

Cinq commentaires sur **trois** cards, écrits par les **trois** comptes du seed. Contrat détaillé et
motifs : `docs/SPEC-cards.md` §13.11.

| Card | Auteur | État | Ce qu'il démontre |
|---|---|---|---|
| `…0c1` *Refonte du site vitrine* | Camille Aubert (`admin`) | vivant | le cas nominal |
| `…0c1` | Driss Lemoine (`business_developer`) | vivant | deux auteurs sur une même card, donc un **fil** |
| `…0c1` | Camille Aubert | **modifié** | `edited_at` renseigné : l'état « modifié » est démontré, non seulement décrit |
| `…0c4` *Refonte intranet Ville de Lyon* | Driss Lemoine | **retiré par la modération** | la pierre tombale : `deleted_at` renseigné et **corps vide**, dans un channel d'un autre track — **et l'audit** : `deleted_by` = Camille Aubert, différent d'`author_id` |
| `…0c5` *Support niveau 2* | Farida Nowak (`viewer`) | vivant | le **témoin** de la preuve de lecture : le `viewer` lit ce qu'il ne peut pas écrire |

Les identifiants suivent la convention du §4 : `5eed0000-0000-4000-8000-0000000000d1` à `…d5`.

**Deux écritures du seed ne passent pas par le chemin d'un utilisateur, et c'est dit :**

- la ligne de `…0c5` porte `author_id` = Farida Nowak, un `viewer` — que la politique d'insertion
  refuserait. Elle est posée par la **clé de service**, comme toutes les autres lignes du seed, et
  elle existe pour que la lecture autorisée d'un `viewer` soit distinguable d'une table vide
  (décision 50) ;
- l'état « modifié » et l'état « retiré » sont obtenus par un **second appel** `PATCH`, qui traverse
  les **vrais triggers** : `edited_at` et `deleted_at` sont donc posés par le produit, et le corps
  du commentaire supprimé est vidé par lui. Le seed ne fabrique aucune trace (`CLAUDE.md` §8) — il
  ne pourrait d'ailleurs pas : les deux colonnes sont posées par trigger, et une valeur envoyée y
  est ignorée.

**Le retrait de `…0d4` emploie le JETON RÉEL de l'administratrice, et c'est le seul appel de cette
section qui ne passe pas par la clé de service** (décision 376). Le motif est mesurable : la clé de
service ne porte aucune revendication `sub`, `auth.uid()` y est nul, et `deleted_by` reste donc nul
— la pierre tombale démontre alors la destruction du corps, jamais la **modération**. Le corps de
`…0d4`, « Note interne publiée par erreur sur la mauvaise affaire », écrit par Driss Lemoine, est le
cas de démonstration exact du §13.6 de `docs/SPEC-cards.md`, et le seul geste qui le produise est
celui qu'un modérateur ferait. `api_admin`, déjà employée par le §2.15 pour les déplacements, sert
ici aussi : sa définition remonte au-dessus de cette section plutôt que d'y être dupliquée.

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
| Un aller-retour de channel sur `…0c5` — §2.16 | 2 × `channel_changed` | le changement de dossier **et de workflow**, par la vraie RPC `move_card_to_channel` |

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

**Le compte est passé de 27 à 29 avec `CRM-045`**, et il ne vaut qu'au sortir du seed. Une timeline enregistre tout, y compris ce que
les preuves du dépôt font ensuite à la même pile. Seule la naissance d'une card est idempotente :
les suites assèrent neuf `created` exactement, et des bornes inférieures pour le reste
(`docs/JOURNAL.md` décision 210).

**Aucune des cinq autres familles n'est démontrée par le seed** : `archived`, `unarchived`,
`trashed` et `restored` supposeraient d'archiver puis de désarchiver une card du seed, ce qui
toucherait `archived_at` et `deleted_at` — deux colonnes dont l'état est asserté par `CRM-040`. Les
quatre types sont exercés par `e2e/api/timeline.spec.ts` avec les jetons réels, sur une card créée
et détruite par la preuve elle-même.

### 2.16 Aller-retour entre channels — ajouté par `CRM-045`

**Le seed ne peut pas écrire un `channel_changed`**, pour la raison exacte du §2.15 : aucun rôle ne
détient l'`INSERT` sur `card_events`. L'événement ne naît que d'un déplacement réel.

Le seed exécute donc **un aller-retour**, avec le **jeton de l'administratrice** et par la vraie RPC
`public.move_card_to_channel` :

| Geste | Card | De | Vers | Étape fournie |
|---|---|---|---|---|
| aller | `…0c5` « Support niveau 2 — Atelier Meunier » | `maintenance` (workflow global) | `prospection` (**copie de portée track**) | `Prospection` du graphe cible |
| retour | la même | `prospection` | `maintenance` | `Prospection` du graphe d'origine |

**Ce que cet aller-retour démontre, et qu'aucun autre geste du seed ne démontrait :** une card qui
suit réellement un **workflow dérivé**, le temps du transit. La copie de `CRM-032` était jusqu'ici
prouvée par ses étapes et ses transitions, jamais par une card les empruntant — conséquence
d'INC-046, nommée au §9.1 de `docs/SPEC-cards.md`. Elle l'est désormais, sans qu'aucune card ne
demeure dans `prospection` : le channel repointé par les sections 4 et 7 reste vide au repos, et le
rejeu du seed reste possible.

**Pourquoi `…0c5` et pas une autre.** MESURÉ : elle est l'une des trois cards du seed qui ne portent
**aucune** réponse de formulaire. Le changement de workflow n'a donc rien à détruire,
`discard_field_values` reste à `false`, et le seed ne démontre pas la destruction — il ne le peut
pas sans cesser d'être convergent, une réponse détruite ne renaissant pas au retour. La destruction
est prouvée par `e2e/api/move-card-to-channel.spec.ts`, sur une card qu'elle crée et qu'elle détruit.

**Convergence.** Les deux gestes sont **conditionnés par une relecture**, comme ceux du §2.15 : ils
ne sont exécutés que si la card est là où le seed l'attend. Le retour rend la card à son channel, à
son workflow et à son étape de départ ; sa `position` est recalculée deux fois et retombe sur `1`,
`…0c5` étant seule dans sa colonne. Aucune assertion des unités précédentes ne bouge — seule
l'histoire s'allonge, de deux lignes.

### 2.17 Comptes entrants IMAP — ajoutés par `CRM-052`

Trois comptes, un par boîte de développement de `docs/SPEC-mail-subsystem.md` §11.4 :

| `label` | `owner_id` | `imap_username` | Nature |
|---|---|---|---|
| Boîte système du workspace | `NULL` | `systeme@crm.p2enjoy.test` | catch-all du domaine des cards |
| Boîte de Camille Aubert | Camille | `admin@p2enjoy.test` | personnelle |
| Boîte de Driss Lemoine | Driss | `bizdev@p2enjoy.test` | personnelle |

**Farida Nowak n'en a pas**, et c'est délibéré : un `viewer` lit, il ne correspond pas. Son
absence est **utile aux preuves** — elle donne un membre sans boîte, donc une lecture vide qui
n'est pas un refus.

**Posés par le VÉRITABLE chemin d'écriture.** Le seed appelle
`/rest/v1/rpc/upsert_mail_inbound_account` avec le jeton réel de l'administratrice, jamais un
`INSERT` direct : c'est la seule voie qui met le mot de passe dans Vault, et le seed ne doit pas
démontrer un état que le produit ne sait pas atteindre (`CLAUDE.md` §8). L'écriture directe est
d'ailleurs refusée à `authenticated`, ce que la suite pgTAP mesure.

**Convergence par état, comme le §2.14.** La fonction est elle-même un `upsert` : un rejeu met à
jour la ligne existante sans la dupliquer, et **ne réécrit pas le secret** lorsqu'aucun mot de
passe n'est transmis. Le seed transmet le mot de passe commun des boîtes de développement à chaque
exécution — il n'a rien à protéger — mais le contrat « ne pas remplacer » est éprouvé par pgTAP.

Les trois comptes visent `stalwart:143` en `none`. Le motif est mesuré et écrit au §13.6 du
sous-système : le certificat local est auto-signé, et le produit refuse à raison de lui faire
confiance. `starttls` n'est donc prouvable qu'en **refus** sur cette pile.

Leur `status` reste `pending` tant qu'aucun test de connexion n'a été exécuté. Le seed ne le force
jamais : un état `ok` sans connexion réelle serait exactement la trace fabriquée que `CLAUDE.md` §8
proscrit.

### 2.18 Identités sortantes SMTP — ajoutées par `CRM-053`

Deux identités, et la seconde est **le cas d'usage que le §2.2 du sous-système promettait depuis le
socle documentaire** :

| `label` | `owner_id` | `from_address` | Par défaut |
|---|---|---|---|
| Identité de service | `NULL` | `systeme@crm.p2enjoy.test` | oui |
| Envoi de Driss Lemoine | Driss | `contact@p2enjoy.test` | oui |

**Driss reçoit sur `bizdev@p2enjoy.test` et expédie depuis `contact@p2enjoy.test`.** Entrant et
sortant divergent : le seed le **démontre** au lieu de le décrire, et c'est précisément ce que la
Definition of Done de `CRM-053` réclame.

**Camille n'a pas d'identité sortante**, et c'est utile aux preuves : elle donne une
administratrice sans identité, donc un cas de lecture vide qui n'est pas un refus.

Posées par le véritable chemin d'écriture, comme au §2.17, avec la même convergence : un rejeu met
à jour sans dupliquer et ne réécrit pas le secret lorsqu'aucun mot de passe n'est transmis. Leur
`status` reste `pending` : aucune connexion n'est ouverte par le seed.

### 2.19 Quatre messages réellement reçus — ajoutés par `CRM-057`, complétés par `CRM-081` puis par `CRM-060`

L'inbox globale ne se démontre pas sur un écran vide, et CLAUDE.md §8 interdit d'y suppléer par une
trace fabriquée : « un e-mail de démonstration doit être envoyé par le véritable mécanisme d'envoi
local ». Le seed **soumet donc réellement quatre messages** en SMTP authentifié sur le Stalwart de
`CRM-050`, puis **déclenche une relève réelle** du service `mail-sync`.

| Objet | Destinataire | État obtenu | Ce qu'il démontre |
|---|---|---|---|
| Demande de devis — refonte | l'adresse de la card « Refonte du site vitrine » | **classé**, règle 1 | La double visibilité : dans la card **et** dans l'inbox |
| Candidature spontanée | `systeme@crm.p2enjoy.test` seul | **non classé** | Le panneau « Non classés », et le classement à la main |
| Re: Demande de devis — refonte | la même adresse de card, **en réponse au premier** | **classé**, règle 1 | Le GROUPEMENT en fils : deux messages, une seule ligne (`CRM-081` tranche 2 f) |
| Point d'avancement — migration ERP | `systeme@crm.p2enjoy.test` seul, **expédié par Léo Marchand** | **non classé ET suggéré**, règle 3 | La SUGGESTION de classement à l'écran (`CRM-060` sous-tranche 2 bis, `docs/SPEC-contacts.md` §8.8) |

**Les trois premiers partent d'une boîte du PRODUIT, et la mesure l'imposait.** Soumettre depuis un
domaine que le serveur n'héberge pas — `solene.ferrand@client.test` — est refusé net par Stalwart :
`501 5.5.4 You are not allowed to send from this address.` Un principal n'expédie que depuis ses
propres adresses. Le correspondant de ces trois messages est donc **Driss**
(`bizdev@p2enjoy.test`). La même mesure a révélé que l'identité sortante du §2.18, qui expédie
depuis `contact@p2enjoy.test`, est **inapplicable telle quelle** sur ce serveur : INC-087.

**LE QUATRIÈME PART D'UN VRAI CORRESPONDANT, ET C'EST LA RÈGLE 3 QUI L'EXIGE** — `CRM-060`
sous-tranche 2 bis. La règle 3 ne se déclenche que si l'expéditeur est reconnu comme **contact** du
workspace, à son adresse ; celle de Léo Marchand est `leo.marchand@sogexia.example`
(`docs/SPEC-contacts.md` §5), et aucune boîte ne la portait. La conclusion « aucun correspondant
extérieur n'existe sur cette pile » n'était donc pas une fatalité : **il en manquait un**, et
`docs/SPEC-mail-subsystem.md` §11.4 le provisionne désormais — un troisième domaine
`sogexia.example`, sous le TLD `.example` réservé par la RFC 2606, et une boîte pour lui. Le
message reste soumis par le **véritable chemin authentifié** : rien n'est forgé, et le `From` ne
ment pas.

**MESURÉ le 2026-08-20**, après soumission et relève réelles : `classification = unclassified`,
`card_id` nul, `suggested_card_id = 5eed0000-0000-4000-8000-0000000000c2` — l'affaire « Migration
ERP Sogexia », seule affaire active de Léo, exactement ce que la garde du §11 promet. Le seed
**vérifie** cette suggestion plutôt que de la supposer, comme il vérifie déjà le fil : sans elle,
le bloc du §5.4 ter de `docs/DESIGN_SYSTEM.md` n'aurait jamais de quoi se rendre, et aucune capture
ne montrerait la fonctionnalité.

**Leurs `Message-ID` sont fixes** — `<seed-inbox-classe@p2enjoy.test>`,
`<seed-inbox-non-classe@p2enjoy.test>`, `<seed-inbox-reponse@p2enjoy.test>` et
`<seed-inbox-suggere@sogexia.example>`. Le dédoublonnage du §4.2 fait le reste : rejouer le seed
n'ajoute rien, et les captures peuvent dépendre de ces quatre objets.

**LE TROISIÈME PORTE `In-Reply-To` ET `References`, ET LES DEUX SONT NÉCESSAIRES** — `CRM-081`
tranche 2 f, `docs/SPEC-cards.md` §16.16.8. C'est `References` que `app.cle_fil` lit ; un message
qui ne porterait qu'`In-Reply-To` resterait sa propre racine, donc un fil de plus au lieu d'un fil
de deux. Avant cette tranche, les deux messages du seed portaient des clés **distinctes** : l'inbox
groupée aurait été identique à l'inbox d'avant, et aucune capture n'aurait montré la fonctionnalité.

**Le seed VÉRIFIE le fil plutôt que de le supposer.** Il relit `references_ids` du message reçu et
compte, par `app.cle_fil` elle-même, les clés distinctes de la card « Refonte du site vitrine » —
qui doit en porter **une seule**. Les deux contrôles échouent avec leur cause nommée si le service
`mail-sync` n'est pas à jour du correctif d'ingestion du §16.16.2. Un seed qui accepterait un fil
coupé ne serait plus un contrat : il annoncerait une démonstration que l'écran ne pourrait pas
faire.

**Rien n'est forcé en base** : ni le classement, écrit par `classer_message_automatiquement` au
cours de la relève, ni les occurrences, ni le statut des comptes, qui reste `pending` (§2.17). Le
seed n'écrit pas un message : il en **fait arriver** un.

**Cette étape ajoute une dépendance, et elle est assumée** : sans Stalwart ni `mail-sync`, le seed
échoue au lieu de passer en silence. Un seed qui saute discrètement une démonstration ment sur
l'état du produit.

## 8. Ce que ce seed ne livre pas, et pourquoi

- **Aucun second workspace, aucun compte extérieur.** `CRM-005` dit « un workspace ». Les preuves
  n° 3 et n° 7 de `docs/SPEC-permissions-rls.md` §7 en exigeront un, ainsi qu'un compte sans
  appartenance ; `scripts/verify-authz.sh` les crée et les détruit lui-même aujourd'hui. Le point
  est nommé ici pour que `CRM-014` sache qu'il devra soit étendre le seed, soit continuer de
  fabriquer ses propres comptes. Ce n'est pas une contradiction, seulement une frontière d'unité.
- **Aucun droit fin.** Voir §2.2 : les tables cibles n'existent pas.
- **Aucun message.** Les tracks, les channels, le catalogue de nœuds, le workflow par défaut, les
  champs, les cards, leurs valeurs, leurs commentaires et leur timeline sont désormais seedés
  (`CRM-020`, `CRM-021`, `CRM-030`, `CRM-031`, `CRM-035`, `CRM-036`, `CRM-040`, `CRM-043`,
  `CRM-044`, `CRM-045`). Les **messages** relèvent du chunk 4 et d'aucune unité de ce chapitre.
  Ce que le socle laisse vide — trois étapes sans card, un workflow dérivé inexercé, un channel
  actif vide — est comblé par `CRM-046`, spécifié au §9.
- **Aucun écran, aucune vérification visuelle.** Le seed n'atteint pas l'interface, dont le premier
  écran arrive avec `CRM-007`.
- **Le seed ne crée pas ses comptes depuis le produit.** Le parcours d'invitation n'a aucun
  composant pour le porter (INC-015) : la création reste une opération d'exploitation, comme pour
  `CRM-011`.

---

## 9. Le jeu de démonstration complet — `CRM-046`

Le §2 décrit le **socle**, grandi unité par unité jusqu'à `CRM-045`. Ce chapitre décrit ce que
`CRM-046` y ajoute, et il est écrit **après mesure de la pile réelle**, seedée par
`supabase/seed/apply-seed.sh` à la version `0017` des migrations. Chaque nombre cité ci-dessous a
été relu en base ; aucun n'est déduit d'une lecture du script.

L'énoncé de backlog demande : « Trois tracks, plusieurs channels, workflows distincts dont un
dérivé, cards à toutes les étapes, cas d'erreur et branches alternatives, **aucun écran vide** ».
Sa Definition of Done ajoute : « `resetMe.sh` reproduit exactement le même état ; chaque
fonctionnalité livrée est démontrable depuis le seed ».

### 9.1 Ce qui manque, mesuré et non supposé

Trois des quatre exigences de l'énoncé sont **déjà satisfaites** par le socle, et le dire évite de
refaire ce qui existe : trois tracks actifs plus un archivé, six channels sur ces tracks dont un
archivé, et **deux** workflows dont un dérivé — `Cycle commercial — Conseil IA`, copie de portée
`track` produite par `copy_workflow_to_track`.

Ce qui manque tient en trois manques, tous mesurés le 2026-08-06 sur la pile de développement :

| Manque | Mesure |
|---|---|
| **Trois étapes sur sept ne portent aucune card active** | `realisation` : 0 card ; `livre` : 1 card, **archivée** ; `perdu` : 0 card. Sur un board de sept colonnes, trois sont vides quel que soit le profil |
| **Le workflow dérivé ne porte aucune card, à aucune de ses sept étapes** | 0 card sur les sept étapes de la copie. Il est seedé, il est rattaché à `prospection`, et **rien ne l'exerce** |
| **Un channel actif est vide** | `prospection` : 0 card. Sa route `/tracks/conseil-ia/prospection` rend un board sans aucune colonne peuplée — l'écran vide que l'énoncé proscrit |

Les cinq autres channels ne sont pas concernés : `grands-comptes` porte 3 cards actives, `refonte`
1, `maintenance` 1, `inter-entreprises` 2, et `appels-offres` est archivé — un channel masqué n'a
aucun écran à remplir.

### 9.2 L'obstruction, re-mesurée, et comment elle est levée

Le §2.12 et `docs/SPEC-cards.md` §9.1 disent depuis `CRM-040` pourquoi aucune card ne vit dans
`prospection`. L'obstruction a été **re-mesurée** avant d'être levée, et non reprise de confiance :
une card posée dans `prospection` sur le workflow dérivé, puis le seed rejoué, échoue

```
[4. Channels]
ERREUR création du channel prospection : code HTTP 409, attendu 200 201.
        {"code":"23503","details":"Key (id, workflow_id)=(…031, fa9f0f61-…) is still referenced
         from table \"cards\"", "message":"update or delete on table \"channels\" violates foreign
         key constraint \"cards_channel_id_workflow_id_fkey\" on table \"cards\""}
```

code de sortie `1`. La mesure confirme mot pour mot ce que le §9.1 de `docs/SPEC-cards.md`
annonçait.

**La cause n'est pas la clé étrangère : c'est que le seed écrit deux fois de suite le workflow de
ce channel alors que la valeur finale est déjà en place.** Deux écritures sont en cause, et une
seule suffirait à faire échouer le seed :

1. **section 4**, qui recrée les six channels en envoyant `workflow_id = <workflow global>` — donc
   ramène `prospection` en arrière avant que la section 7 ne le renvoie sur la copie ;
2. **section 7**, qui « libère » le channel vers le workflow global pour pouvoir ramener la copie à
   son track déclaré, puis l'y rattache de nouveau.

Aucune des deux n'est nécessaire lorsque la base est **déjà conforme au contrat**. La levée est donc
une **convergence par état**, exactement le mécanisme déjà employé aux §2.14 et §2.15 pour les
commentaires et les événements : le seed relit avant d'écrire, et n'écrit que ce qui diverge.

- **Section 4.** Le `workflow_id` de `prospection` n'est envoyé que si le channel **n'est pas déjà**
  rattaché à la copie déclarée. Sur une base neuve la copie n'existe pas encore, la valeur envoyée
  est le workflow global, et la section 7 fera le rattachement. Sur une base conforme, la colonne
  n'est pas envoyée du tout : la branche de mise à jour de l'`upsert` ne touche que les colonnes
  transmises, et la clé étrangère n'a rien à vérifier.
- **Section 7.** La séquence libérer → converger → rattacher n'est jouée que si la copie **diverge**
  de son contrat — portée, track, nom, défaut, archivage — ou si `prospection` ne la suit pas. Sur
  une base conforme, la section ne fait **aucune écriture** et le dit.

**Ce que cette levée ne faisait pas à `CRM-046`.** Repointé directement, le workflow d'un channel
peuplé reste refusé en `23503`, et c'est la règle voulue. `CRM-019` ferme ensuite INC-046 par une
RPC de remappage explicite ; le seed n'en a pas besoin et cesse simplement de **tenter** le PATCH
quand il n'y a rien à changer. Il subsiste donc un cas où le seed échoue
légitimement : une base dont la copie a été déplacée à la main **et** dont `prospection` porte des
cards. Le seed le détecte et le nomme — message explicite citant INC-046 — plutôt que de laisser
lire un `23503` brut : l'exploitation doit employer `change_channel_workflow` pour réparer ce cas.

### 9.3 Les cards ajoutées

Cinq cards, portant le rang `…0ca` à `…0ce` dans la famille des cards du §4. Aucune n'est
décorative : chacune ferme un des trois manques du §9.1.

| Id | Channel | Workflow | Étape | Titre | Ce qu'elle ferme |
|---|---|---|---|---|---|
| `…0ca` | `prospection` | **dérivé** | `prospection` | Cadrage data — Groupe Vallier | le channel vide **et** le workflow dérivé inexercé |
| `…0cb` | `prospection` | **dérivé** | `negociation` | Assistant IA support — Nordis | deux colonnes peuplées sur le board dérivé, et non une seule |
| `…0cc` | `refonte` | global | `realisation` | Portail adhérents — MGEN Loire | l'étape `realisation`, vide partout |
| `…0cd` | `grands-comptes` | global | `livre` | Socle analytique — Vertuo | l'étape `livre`, dont la seule card est **archivée** |
| `…0ce` | `inter-entreprises` | global | `perdu` | Cursus DevSecOps — Institut Berthier | l'étape `perdu`, vide, et la **branche alternative** du graphe |

Après extension, **les sept étapes du workflow global portent au moins une card active**, et le
workflow dérivé en porte deux. Neuf cards deviennent **quatorze** : neuf actives au socle plus
cinq, soit **douze actives**, une archivée, une en corbeille — les deux suppressions douces restent
démontrées, et leur proportion cesse d'être trompeuse.

**`…0ce` est le seul cas d'affaire perdue du seed.** Son étape exige `motif-perte`
(`form_field_rules`, `required` à l'étape `perdu`), et la card le porte : une affaire perdue sans
motif serait une donnée que le produit refuse de produire lui-même.

**Aucune card n'est ajoutée à `appels-offres`.** Le channel est archivé ; y poser une card
peuplerait un écran que le produit ne montre pas.

### 9.4 Les identifiants du workflow dérivé ne sont pas stables, et le seed les résout

Le §4 pose que tout identifiant du seed est fixé dans le script. **Deux valeurs échappent à cette
règle, et c'est le produit qui l'impose** : `copy_workflow_to_track` crée le workflow copié et ses
sept étapes avec `gen_random_uuid()`. Mesuré : la copie porte `fa9f0f61-9f4a-4a03-b235-90b823cfd236`
sur la base de vérification, et une autre valeur sur toute autre base.

Les cards `…0ca` et `…0cb` ne peuvent donc pas porter un `workflow_id` ni un `current_step_id`
écrits dans le contrat. Le seed les **résout à l'exécution**, par la clé de nœud du catalogue —
`prospection` et `negociation` —, qui est elle stable :

```
GET /rest/v1/workflow_steps?workflow_id=eq.<copie>&select=id,node_id,workflow_nodes_catalog(key)
```

Trois conséquences, écrites ici pour qu'aucune preuve ne les redécouvre :

- **les identifiants des cards restent stables** : seules leurs deux clés étrangères sont résolues ;
- **une preuve ne peut pas figer le `workflow_id` de `…0ca`** ; elle fige la **clé du nœud** de son
  étape, ou l'identifiant du channel ;
- **si la copie manque, le seed échoue** en le disant, au lieu de poser les deux cards sur le
  workflow global — ce qui aurait produit un seed vert et un contrat faux.

### 9.5 Le formulaire du workflow dérivé démontre la vraie copie

La mesure historique d'INC-037 comptait zéro champ dérivé. La décision 293 remplace ce contrat :
le workflow dérivé porte les mêmes sept clés de champ, les mêmes règles et la même exigence métier,
avec des identifiants propres. Les cards `…0ca` et `…0cb` reçoivent des valeurs de formulaire par
les champs dérivés, afin que leur fiche ne soit plus un état vide connu. Les clés composites
continuent de refuser en `23503` toute tentative de réutiliser un identifiant de la source.

### 9.6 Valeurs de formulaire, commentaires et événements

**Sept valeurs ajoutées**, quatorze deviennent **vingt et une** : les quatre valeurs de
`CRM-046` et trois réponses portées par les champs remappés de la copie depuis `CRM-018`.

| Card | Champ | Valeur | Motif |
|---|---|---|---|
| `…0cc` *réalisation* | `lien-proposition` | `"https://p2enjoy.fr/propositions/mgen-loire"` | l'arête *signature → réalisation* l'**exige** par sa liaison : une card à cette étape sans ce champ décrirait un franchissement impossible |
| `…0cc` | `budget` | `64000` | — |
| `…0cd` *livré* | `budget` | `210000` | la seule affaire **gagnée** active ; sans montant, le cumul du board serait muet à cette colonne |
| `…0ce` *perdu* | `motif-perte` | `"…"` | l'étape l'**exige** (§9.3) |
| `…0ca` *prospection dérivée* | `source` | `"recommandation"` | la copie expose un formulaire réellement renseignable, pas seulement ses définitions |
| `…0cb` *négociation dérivée* | `budget` | `87000` | le montant de la card reste cohérent avec sa réponse métier |
| `…0cb` | `lien-proposition` | `"https://p2enjoy.fr/propositions/nordis-assistant-ia"` | la branche de négociation de la copie porte sa proposition |

**Aucun commentaire n'est ajouté, et le motif est écrit.** Les cinq commentaires du §2.14 couvrent
déjà le fil à deux auteurs, la modification, la suppression et l'auteur `viewer`. `card_comments`
ne porte **aucune** référence à un workflow : un commentaire posé sur une card du workflow dérivé
ne démontrerait rien qu'un `card_id` ne démontre déjà. Une ligne de plus serait décorative, ce que
`CLAUDE.md` §8 proscrit.

**Douze événements naissent des triggers**, 29 deviennent **41** : cinq `created` pour les cinq
cards et sept `field_changed` pour les sept valeurs. Le seed n'en forge aucun — il ne le peut pas,
le §2.15 l'établit.

**CE NOMBRE EST UN ÉTAT, PAS UN INVARIANT** (décision 226). Il décrit une base **au sortir d'un
seed sur cluster neuf**, et il croît dès la première écriture de qui que ce soit : un utilisateur
qui archive une card, une preuve d'API qui déplace une affaire, la non-complaisance de
`scripts/verify-seed-demo.sh` qui vide puis remplit une valeur — chacune inscrit des événements que
rien n'efface, et c'est le produit qui fonctionne.

Une seule quantité de la timeline est **invariante**, et c'est la seule que les preuves fixent par
une égalité : **un `created` par card, exactement**, une card ne naissant qu'une fois. Tout le reste
— le total, `field_changed`, `moved`, `assigned`, `channel_changed` — est vérifié **en minorant**.
La même correction a été portée à `supabase/tests/0018_timeline.test.sql`, dont une assertion
comptait un cumul en le croyant stable.

### 9.7 Ce que chaque profil voit, après extension

Le contrat « aucun écran vide » n'a de sens que **par profil** : la RLS et les droits fins du
socle ne rendent pas la même arborescence à trois comptes différents. L'état mesuré **avant**
extension, avec les jetons réels des trois comptes, est le suivant :

| Profil | Tracks lus | Channels lus | Cards actives lues |
|---|---|---|---|
| `admin` Camille Aubert | 4 | 6 | 7 |
| `business_developer` Driss Lemoine | 4 | 6 | 7 |
| `viewer` Farida Nowak | 3 | 4 | 4 |

Après extension, le contrat exigé est : **tout channel actif lisible par un profil lui rend au
moins une card active**, et **toute étape du workflow d'un channel lisible porte au moins une card
active dans au moins un channel lisible**. Les deux formulations sont vérifiables par requête, et
`scripts/verify-seed-demo.sh` les vérifie pour les trois profils.

**Un cas résiste, et il est nommé plutôt que corrigé.** Le `viewer` lit le channel `prospection` —
un `channel_members.access = 'member'` le lui rouvre sous un track fermé, « le plus spécifique
gagne », ligne f du §3 de `docs/SPEC-permissions-rls.md` — mais **il ne lit pas le track
`conseil-ia`**, et la coquille résout le track **avant** ses channels. Le channel lui est donc
consenti par le backend et **inatteignable par la navigation du produit**. Les cards `…0ca` et
`…0cb` y sont bien lues par son jeton, ce qu'une preuve d'API mesure ; aucun écran ne les lui
montre. Consigné en **INC-075**, sans résolution implicite : corriger cela engage soit la politique
des tracks, soit la coquille, et ni l'un ni l'autre n'appartient à `CRM-046`.

> **CE CAS EST CLOS DEPUIS, ET LE PARAGRAPHE CI-DESSUS DÉCRIT L'ÉTAT D'ALORS.** La **décision 333**
> a tranché — « un droit qui n'a pas de chemin n'est pas un droit » —, et la migration
> `0034_lecture_track_transitive.sql` a rendu la lecture d'un track **transitive** : un track est
> lisible dès que l'un au moins de ses channels l'est. Le `viewer` lit donc désormais `conseil-ia`
> **et** `prospection`, et un chemin de navigation mène à son droit fin. INC-075 et son doublon
> INC-085 sont closes. La preuve n° 13 de `scripts/verify-seed-demo.sh` a été **révisée en
> conséquence** le 2026-08-16, avec son motif écrit dans le fichier.

### 9.8 Convergence et reproductibilité

La Definition of Done exige que « `resetMe.sh` reproduise exactement le même état ». Deux
propriétés distinctes, et le seed doit les deux :

1. **Convergence** — le seed rejoué sur une base déjà seedée n'ajoute aucune ligne, n'en modifie
   aucune, et sort en `0`. C'est la propriété que le §9.2 restaure pour `prospection`.
2. **Reproductibilité à froid** — `resetMe.sh` détruit le cluster, rejoue les dix-sept migrations
   puis le seed, et l'état obtenu est **identique** à celui d'avant destruction, aux valeurs que le
   produit tire lui-même près.

Ce qui **ne peut pas** être identique, et qui est donc exclu de la comparaison, est nommé
exhaustivement : l'identifiant et l'horodatage du workflow dérivé et de ses sept étapes (§9.4), les
identifiants des lignes `card_events`, toutes les colonnes `created_at`, `updated_at`,
`derived_at`, `entered_step_at`, et **`email_local_part`**. Tout le reste — identifiants, slugs,
positions, titres, montants, devises, états, rattachements, valeurs, commentaires — est comparé
ligne à ligne.

**`email_local_part` mérite son motif, et il a été trouvé en exécutant.** L'adresse d'une card est
**tirée au hasard** par le trigger de la migration 11 — `gen_random_bytes(5)`, encodés sur
l'alphabet du §3.4 de `docs/SPEC-cards.md`. Elle est stable d'un **rejeu du seed** à l'autre, la
branche de mise à jour d'un `upsert` ne touchant que les colonnes envoyées ; elle ne peut **pas**
l'être d'un cluster à l'autre. La comparer d'un `resetMe.sh` à l'autre rendrait la preuve n° 14
rouge par construction. La valeur est donc remplacée par sa **forme** et par son **unicité**, qui
sont, elles, des propriétés du produit — et deux contrôles dédiés les vérifient.

Il y a donc **deux** empreintes, et elles ne servent pas au même usage : l'une, complète, compare
deux états du **même** cluster et prouve que le rejeu du seed ne change rien, `email_local_part`
comprise ; l'autre, reproductible, compare deux **reconstructions** et est celle que rend
`scripts/verify-seed-demo.sh --empreinte`.

La comparaison est faite par une **empreinte** : la même requête ordonnée, exécutée avant et après,
dont la sortie est hachée. Deux empreintes égales prouvent l'identité ; une empreinte différente
nomme la table qui a bougé.

**Mesure historique de `CRM-046`, le 2026-08-06.** `./resetMe.sh --yes` a réellement détruit le
cluster PostgreSQL et ses volumes, les dix-sept migrations ont été rejouées à froid
(« 17 fichier(s) appliqué(s) avec succès »), puis le seed appliqué. L'empreinte reproductible est
**identique** de part et d'autre :

```
34c409d17775c2ee6d1f68aa5fc73c03b9b49a0573596ffcf07bb2ead27d9d07
```

Et `card_events` portait **exactement 38 lignes** sur cette base neuve. `CRM-018` ajoute trois
valeurs dérivées et porte donc le nouvel état froid attendu à **41** ; sa propre preuve froide est
due avant fermeture de l'unité et remplacera cette empreinte historique.

**Une réserve, nommée** : `resetMe.sh` a détruit le cluster puis **échoué** à la construction de
l'image `webapp` (INC-042, neuvième occurrence sur cet hôte). La pile a été redémarrée à la main,
sans le service `webapp`, qui ne touche à aucune donnée. La destruction et la reconstruction de la
base sont donc réelles et complètes ; seul le conteneur de l'interface manque à l'appel.

### 9.9 Preuves exigées

Exécutées **hors interface**, contre l'API réelle et la base, par
`scripts/verify-seed-demo.sh` :

| # | Scénario | Attendu |
|---|---|---|
| 1 | Les cinq cards du §9.3 existent, avec leurs identifiants fixes, leur channel et leur étape | Conforme |
| 2 | Les sept étapes du workflow **global** portent chacune ≥ 1 card **active** | Conforme |
| 3 | Le workflow **dérivé** porte ≥ 1 card active à ≥ 2 étapes distinctes | Conforme |
| 4 | Tout channel **actif** porte ≥ 1 card active | Conforme — `appels-offres` exclu, archivé |
| 5 | Les deux cards du workflow dérivé désignent bien la **copie**, jamais le workflow global | `workflow_id` = copie, résolu à l'exécution |
| 6 | Le formulaire de la copie est complet et autonome | 9 champs, 15 règles, 1 exigence ; aucun identifiant de champ partagé avec la source |
| 7 | Les sept valeurs du §9.6 existent, dont les trois réponses des cards dérivées | Conforme |
| 8 | 14 cards, dont **12 actives**, une archivée, une en corbeille | Conforme |
| 9 | 23 valeurs sur 11 cards, 5 commentaires ; **14 `created`, un par card** | Égalité stricte |
| 9 bis | Total des événements, `field_changed`, `moved`, `assigned`, `channel_changed` | **Minorants** — 41, 21, 2, 2, 2 : un cumul ne se fige pas (décision 226) |
| 10 | Le seed est **rejouable avec des cards dans `prospection`** : second passage, sortie `0` | Aucune écriture en sections 4 et 7, aucun `23503` |
| 11 | Une dérive **réparable** de la copie — nom, défaut, archivage — est rattrapée | Le seed la ramène à son contrat, même avec des cards dans `prospection` (décision 225) |
| 12 | Pour chacun des **trois** profils, tout channel actif lisible rend ≥ 1 card active | Conforme |
| 13 | Le `viewer` lit les cards de `prospection` par son droit fin, **et** lit son track par transitivité | Décision 333 : révisée le 2026-08-16, INC-075 close |
| 14 | Empreinte reproductible du §9.8 **avant** et **après** une reconstruction à froid | Empreintes égales |
| 14 bis | Les adresses de card ont la **forme** générée et sont **distinctes** | 14 et 14 — ce qui remplace la comparaison de leur valeur |

Le harnais doit être **non complaisant** : sa sévérité est éprouvée en faussant réellement le jeu —
toutes les cards actives d'une étape archivées, une valeur vidée, le rattachement de `prospection` que l'on tente de défaire — et
en exigeant qu'il échoue à chaque fois, puis en constatant la restauration.

**La restauration porte sur l'ÉTAT, jamais sur la mémoire.** Archiver puis désarchiver une card,
vider puis remplir une valeur, sont quatre écritures que les triggers de `CRM-044` inscrivent et
que rien n'efface. L'empreinte comparée après réparation exclut donc `card_events`, et l'écart de
la timeline est mesuré **séparément, à la valeur près** : quatre événements, `archived`,
`unarchived` et deux `field_changed`. Une empreinte qui reviendrait à l'identique, événements
compris, prouverait que la timeline ne voit pas ce qui se passe.

**Une dégradation doit être réparable par le seed lui-même**, et toutes ne le sont pas : supprimer
une card ne l'est pas, son `email_local_part` étant frappé par le trigger de la migration 11 et ne
se retrouvant jamais à l'identique. Le harnais ne dégrade donc que ce qu'il sait rendre.

### 9.10 Ce que ce jeu ne livre toujours pas

- **Aucun message, aucune pièce jointe.** `card_messages` et le sous-système de messagerie relèvent
  du chunk 4 (`CRM-050` à `CRM-059`). L'énoncé de `CRM-046` n'en demande pas.
- **Le formulaire dérivé n'est plus une limite** : `CRM-018` copie ses neuf champs, ses quinze
  règles et son exigence, et le seed renseigne trois valeurs par leurs identifiants remappés.
- **Aucun second workspace, aucun compte extérieur** : inchangé depuis le §8.
- **Le parcours connecté est désormais vérifié par `CRM-011`.** Les trois tracks, une fiche, la
  publication et un déplacement réel sont atteints avec les comptes de ce jeu, sans substitution.
- **~~Un channel consenti par le backend reste inatteignable par la navigation.~~** INC-075 est
  **close** par la décision 333 et la migration `0034` : la lecture d'un track est transitive, le
  droit fin a désormais son chemin (§9.7).
- **~~Ni volume, ni donnée longue.~~** Le manque est réel et il est mesuré au §9.11 ; il est fermé
  par la tranche que ce §9.11 spécifie.
- **~~Aucune card en retard sur son seuil de relance.~~** Le manque est réel, il est mesuré au
  §9.12, et il est fermé par la tranche que ce §9.12 spécifie : une card — et une seule — est
  posée à trente jours d'une étape dont le seuil est de quatorze.

### 9.11 Le volume et les données longues — tranche 2 de `CRM-046`

**Ce qui manque, mesuré le 2026-08-16 sur la pile de développement**, seed appliqué :

| Manque | Mesure |
|---|---|
| **Aucune donnée longue** | Le titre le plus long du seed fait **36** caractères ; la prochaine action la plus longue, **34** |
| **Aucune seconde page** | Le channel le plus chargé, `grands-comptes`, porte **4** cards actives, là où la vue liste pagine à **25** lignes (`LIGNES_PAR_PAGE`) |

Ces deux manques n'appartiennent pas à la vue liste : `CRM-042` les a nommés à sa clôture et les a
renvoyés ici, où ils sont dus. Ils sont aujourd'hui **prouvés contre des réponses substituées**
(`docs/DESIGN_SYSTEM.md` §12.5) et contre une mesure directe de l'`offset`. Une substitution prouve
que l'écran réagit à une réponse **donnée** ; elle ne prouve pas que la base rend celle-là, ni
qu'un utilisateur du jeu de démonstration rencontre jamais le cas.

#### 9.11.1 Le channel porteur, et pourquoi ce n'est pas `grands-comptes`

Le volume est posé dans **`maintenance`** (`5eed0000-0000-4000-8000-000000000035`, track
« Studio web », route `/tracks/studio-web/maintenance/liste`).

Deux motifs, et le second est mesuré :

- **la vraisemblance** : un channel de maintenance porte structurellement beaucoup d'affaires
  simultanées, là où un channel de grands comptes en porte peu et de gros montants ;
- **le coût sur les preuves existantes** : `grands-comptes` est cité par **29** fichiers de preuves,
  de captures et de code ; `maintenance` par **6**. Charger le premier réécrirait les onze captures
  du board de `CRM-041` et les douze de `CRM-042` sans rien démontrer de plus.

#### 9.11.2 Le compte, et pourquoi vingt-sept

**Vingt-six cards sont ajoutées**, portant `maintenance` de **1** à **27** cards actives.

Vingt-sept et non vingt-six : à vingt-six, la seconde page ne porterait qu'**une** ligne, et une
page d'une ligne ne se distingue pas d'une erreur d'un rang au bord de la plage — précisément le
défaut que le §12.6 de `docs/SPEC-cards.md` classe sous le `416`. À vingt-sept, la première page
est **pleine** — vingt-cinq lignes —, la seconde en porte **deux**, et le total affiché est
vérifiable à l'œil.

#### 9.11.3 Les étapes retenues, et les deux qui sont exclues

Les vingt-six cards se répartissent sur **cinq** des sept étapes du workflow global :
`prospection`, `relance`, `negociation`, `signature` et `livre`.

**`realisation` et `perdu` sont exclues, et l'exclusion est une règle, pas un oubli.** Mesuré : la
transition `signature → realisation` **exige** `lien-proposition`
(`workflow_transition_required_fields`), et l'étape `perdu` exige `motif-perte`. Une card posée à
l'une de ces deux étapes sans sa valeur décrirait un franchissement que `move_card` aurait refusé —
la trace fabriquée que `CLAUDE.md` §8 proscrit. Les deux étapes portent déjà leur card de
démonstration, `…0cc` et `…0ce`, avec les valeurs que leur position exige (§9.3) : le volume n'a
rien à y ajouter.

Aucune valeur de formulaire n'est posée sur les vingt-six. Elles démontrent un **volume** et une
**longueur**, pas une règle de formulaire ; les règles sont démontrées par les onze cards qui
portent les vingt et une valeurs du §9.6.

#### 9.11.4 La card de données longues

**Une seule** des vingt-six porte les données longues, et elle est nommée `…d001` :

- **titre de 128 caractères** ;
- **prochaine action de 134 caractères**.

Ces deux longueurs ne sont pas choisies : ce sont **exactement** celles que les réponses substituées
de `CRM-042` servent aujourd'hui (`docs/SPEC-cards.md` §12.11). Les captures `liste-donnees-longues-1440`
et `liste-donnees-longues-390` cessent donc de dépendre d'une substitution sans changer ce qu'elles
montrent.

Son titre commence par **« A »**, ce qui la place en **première page** du tri par défaut — `title`
ascendant, `docs/SPEC-cards.md` §12.4. Une donnée longue reléguée en seconde page ne serait pas
capturable sans un geste de pagination, et la capture ne montrerait pas ce qu'elle prétend.

#### 9.11.5 Identifiants et convergence

Les vingt-six identifiants sont **stables** et déclarés dans le script, comme le §4 l'exige :
`5eed0000-0000-4000-8000-00000000d001` à `…d026`. La famille `d0…` est neuve et ne recouvre aucune
des familles existantes — `…0c1` à `…0cf` pour les cards du §9.3.

Elles naissent par le **vrai chemin** : `POST /rest/v1/cards` avec la clé de service et
`Prefer: resolution=merge-duplicates`, comme les quinze autres. `email_local_part` n'est jamais
envoyé — le trigger de la migration 0011 le frappe, et il reste stable d'un rejeu à l'autre (§9.8).
`position` est écrite explicitement.

Aucun commentaire, aucun événement de timeline n'est ajouté : `card_events` reçoit le `created`
que le trigger écrit, et rien d'autre. Le §9.6 compte les événements **en minorant** depuis la
décision 226, et ce compte reste vrai.

#### 9.11.6 Ce que cette tranche coûte aux preuves existantes, et pourquoi c'est légitime

Trois preuves **doivent** devenir rouges, et elles sont **révisées, jamais retirées** (`CLAUDE.md`
§18, `docs/CloudWorker.md` §3.1) :

- `scripts/verify-liste.sh` figeait « le titre le plus long du seed fait moins de 40 caractères » et
  « aucun channel ne porte plus de 25 cards ». Ces deux contrôles **assèrent l'absence** que cette
  tranche comble : ils sont retournés, et assèrent désormais la **présence**, avec le motif écrit
  dans le fichier ;
- toute assertion figeant un **compte global de cards** est révisée à sa nouvelle valeur mesurée.

Une preuve qui devient rouge parce que la règle a changé par arbitrage est révisée avec son motif ;
elle n'est ni supprimée, ni contournée.

#### 9.11.7 Preuves exigées

1. le seed appliqué deux fois de suite rend le **même** état — convergence, §9.8 ;
2. `maintenance` porte **27** cards actives, mesurées en base ;
3. le titre le plus long du seed fait **128** caractères, la prochaine action la plus longue **134** ;
4. la **seconde page** de `/tracks/studio-web/maintenance/liste` est atteinte contre la pile réelle
   avec le jeton réel de l'administratrice, et porte **deux** lignes ;
5. le rang immédiatement suivant rend le `416` que le §12.6 classe ;
6. les captures de données longues sont produites **et observées** à 1440 et à 390 px, sur la
   donnée **réelle** ;
7. `scripts/verify-liste.sh` rejoué, ses deux contrôles retournés compris.

### 9.12 L'ancienneté dans l'étape — tranche 3 de `CRM-046`

**Ce qui manque, mesuré le 2026-08-21 sur la pile de développement**, seed appliqué :

| Manque | Mesure |
|---|---|
| **Aucune pastille d'ancienneté ne bascule** | Les **40** cards actives du seed ont toutes `now() - entered_step_at` inférieur à **une minute**, contre des seuils de relance de **5 à 30 jours** : aucune n'atteint le sien, et la bascule vers `danger` du §5.1 du design system n'a **aucune donnée permanente** qui la porte |

Ce manque appartient à `CRM-046`, et il y est renvoyé nommément depuis trois endroits : l'énoncé de
`CRM-040` dans `docs/BACKLOG.md`, le §7.4 de `docs/SPEC-workflow-engine.md`, et un contrôle de
`scripts/verify-board.sh` qui **échoue** si le fait venait à changer. La Definition of Done de
`CRM-046` exige que « chaque fonctionnalité livrée soit démontrable depuis le seed » : la pastille
d'ancienneté est livrée par `CRM-041` et ne l'est pas. Cette tranche la rend démontrable.

Aujourd'hui la bascule est prouvée **contre une réponse substituée** (`e2e/ui/board.spec.ts`, carte
`…0c3` vieillie de trente jours dans la seule fixture) et par un test unitaire. Une substitution
prouve que l'écran réagit à une réponse **donnée** ; elle ne prouve pas qu'un utilisateur du jeu de
démonstration rencontre jamais le cas — c'est exactement le raisonnement du §9.11.

#### 9.12.1 La card retenue, et pourquoi celle-là

**`5eed0000-0000-4000-8000-0000000000c3` — « Audit sécurité applicative »**, seule card active du
channel `grands-comptes` à l'étape `Prospection`, dont le seuil de relance est de **14 jours**
(`workflow_nodes_catalog.default_stale_after_days`, l'étape n'en surcharge aucun).

Trois raisons, et aucune n'est esthétique :

1. **C'est la card que la fixture d'interface vieillit déjà.** `e2e/ui/board.spec.ts` la sert à
   trente jours depuis `CRM-041`, en écrivant dans son commentaire que « le seed pose
   `entered_step_at` à `now()` ». La donnée permanente et la réponse substituée racontent
   désormais la **même** histoire, au lieu de se contredire ;
2. **elle est seule dans sa colonne**, si bien que le vieillissement ne déplace aucun cumul, ne
   change aucun ordre — l'ordre d'une colonne est `position` puis `title` (§2.6 de
   `docs/SPEC-cards.md`) et ne lit jamais `entered_step_at` ;
3. **le contraste reste sur le même écran** : la colonne `Relance`, immédiatement à droite, porte
   `…0c1` et `…0c2`, fraîches et de seuil 7 jours. Une capture unique montre donc la **bascule** —
   pastille `danger` sur `Prospection`, pastille neutre sur `Relance`. Le troisième état du §7.4,
   la pastille **absente**, vit à `Livré`, sixième colonne que le board laisse hors champ à
   1440 px : il a sa propre capture (§9.12.7 point 5).

**Trente jours**, et non huit ou quinze : le seuil est de quatorze, et un écart du simple au double
ne dépend d'aucune heure d'application. Une card posée à quinze jours basculerait aussi, mais son
« 15 jours » contre un seuil de 14 se lit comme une limite ; « 30 jours » se lit comme un retard.

#### 9.12.2 Les autres cards ne bougent pas, et c'est le contrat

Les **39** autres cards actives continuent de repartir à zéro à chaque application, comme la
section 8 octies bis du script le pose depuis sa décision d'origine : le jeu de démonstration
montre un pipeline **sain**, avec un unique retard que le CRM est précisément fait pour faire
remonter. Un pipeline entièrement en retard ne démontrerait pas la bascule : il démontrerait un
seuil mal choisi.

L'unique retard est donc **voulu, choisi et écrit**, jamais subi par le temps qui passe — ce que la
section 8 octies bis avait annoncé en toutes lettres : « la démonstration d'une card en retard,
quand elle sera voulue, se posera explicitement, avec une date choisie, non avec le temps qui
passe. »

#### 9.12.3 L'écriture, et pourquoi elle passe par la clé de service

Comme la remise à zéro qui la précède, la date est posée par `psql` avec le rôle `postgres` :
`entered_step_at` ne figure pas parmi les douze colonnes que `CRM-013` ouvre à `authenticated`, et
c'est très bien ainsi — un client n'a pas à vieillir ni à rajeunir une ancienneté.

Elle est écrite **après** la remise à zéro générale, dans la même section, de sorte que l'ordre des
deux instructions porte la règle : tout repart à zéro, **puis** la seule card voulue en retard
recule de trente jours. Aucun rejeu ne cumule le recul, la date étant calculée depuis `now()` et
non depuis la valeur courante.

#### 9.12.4 Convergence et reproductibilité

Le §9.8 exige qu'un rejeu rende le **même** état. Il le rend, au sens qui compte ici : l'ancienneté
du jeu est définie **relativement à l'instant d'application**, non par un horodatage absolu. Deux
applications successives rendent donc deux dates absolues différentes et le **même** état
observable — une card à trente jours de son étape, trente-neuf à zéro, une seule au-delà de son
seuil. C'est déjà la règle que la remise à zéro générale applique depuis son écriture ; cette
tranche ne l'invente pas, elle l'étend d'une ligne.

Un contrôle de non-complaisance est dû : reculer la date d'une **seconde** card doit faire échouer
le harnais, faute de quoi « exactement une » ne serait pas mesuré.

> **RÉVISION DU 2026-08-24 — `CRM-062` tranche 3a.** Avec **quatre** affaires voulues, la garde
> change de forme et gagne un second sens : reculer la date d'une **cinquième** doit faire échouer
> — c'est D9 —, **et rajeunir l'une des quatre** aussi — c'est D9 bis. Sans la seconde, un seed qui
> cesserait de vieillir `…0cf` passerait inaperçu, et l'écran perdrait son classement sans qu'aucun
> contrôle ne bronche. Les deux vivent dans `scripts/verify-board.sh`, avec leur restauration
> **constatée** et non supposée.

#### 9.12.5 Ce que cette tranche coûte aux preuves existantes, et pourquoi c'est légitime

Deux preuves **doivent** devenir rouges, et elles sont **révisées, jamais retirées** (`CLAUDE.md`
§18, `docs/CloudWorker.md` §3.1) :

- `scripts/verify-board.sh` fige « aucune card du seed n'atteint son seuil : l'écart du §7.4 est
  constaté, pas oublié ». Ce contrôle **assère l'absence** que cette tranche comble : il est
  retourné et assère désormais la **présence** — exactement une card au-delà de son seuil, et c'est
  `…0c3` —, plus la présence d'au moins une card en deçà, sans quoi « au-delà » ne serait pas un
  contraste ;
- `e2e/api/board.spec.ts` porte le scénario « aucune card du seed n'atteint son seuil de relance »,
  qui borne l'âge de **toutes** les cards à cinq jours. Il est retourné et mesure le contrat du
  §9.12.6 contre la vraie API, avec le jeton réel de l'administratrice.

Le §7.4 de `docs/SPEC-workflow-engine.md` porte la phrase « AUCUNE CARD DU SEED N'ATTEINT SON
SEUIL, ET C'EST MESURÉ », et il est révisé dans le **même** changement que le code : une
spécification qui survit à sa mesure est un mensonge à retardement.

#### 9.12.6 Contrat, mesurable en base et par l'API

> **RÉVISION DU 2026-08-24 — `CRM-062` tranche 3a**, `docs/SPEC-relances.md` §10.2. Les lignes *a*
> et *b* posaient **une** card au-delà de son seuil ; le jeu en pose désormais **quatre**. Le motif
> est écrit là-bas et se résume ici : l'écran des affaires figées ne démontrerait ni son classement
> par retard, ni son regroupement par dossier, sur une ligne unique — dette que le §5 de
> `docs/SPEC-relances.md` nomme depuis la tranche 1. **`…0c3` ne bouge pas** : elle reste à trente
> jours pour un seuil de quatorze, et tout ce que le §9.12.1 écrit d'elle reste vrai au caractère
> près. La révision **ajoute**, elle ne déplace pas. Les lignes *c* à *g* sont inchangées.
>
> Les trois affaires ajoutées, avec leur retard **mesuré** :
>
> | Affaire | Dossier / Track | Seuil | Âge posé | Retard |
> |---|---|---|---|---|
> | `…0c4` « Refonte intranet Ville de Lyon » | `refonte` / `studio-web` | 5 | 40 j | 35 |
> | `…d007` « Contrat TMA 2026 — Mairie de Vaulx » | `maintenance` / `studio-web` | 7 | 25 j | 18 |
> | `…0cf` « Reprise du dossier Marchand » | `dossiers-2023` / `legacy-2023` | 5 | 12 j | 7 |

| # | Énoncé | Vérifiable par |
|---|---|---|
| a | Exactement **quatre** cards actives du seed ont `now() - entered_step_at` supérieur ou égal à leur seuil | `count(*) = 4` sur la jointure card → étape → nœud |
| b | Ce sont `…0c3`, `…0c4`, `…0cf` et `…d007`, et leurs retards valent **35, 18, 16, 7** — deux à deux distincts, donc l'ordre `retard_jours desc` est **total** sur ce jeu | `string_agg` sur `public.cards_figees()` |
| b bis | Elles vivent dans **quatre** dossiers pour **trois** tracks : un track en porte deux, seul cas qui prouve que le regroupement porte sur le channel | `count(distinct channel_id)`, `count(distinct track_id)` |
| b ter | L'`admin` et le `business_developer` en lisent **quatre**, la lectrice **trois** — `…0c3` vit dans `grands-comptes`, dont le track lui est fermé | `rpc/cards_figees` avec les trois jetons réels |
| c | Son ancienneté est d'au moins **30** jours et de moins de **31** | `now() - entered_step_at` |
| d | Son seuil est de **14** jours, hérité du nœud et non surchargé par l'étape | `stale_after_days is null` et `default_stale_after_days = 14` |
| e | Au moins une card active porte un seuil et reste **en deçà** | `count(*) >= 1` sur le complément de *a* |
| f | Aucune card **archivée** ou **en corbeille** n'est vieillie | `archived_at`, `deleted_at` |
| g | Les cards à l'étape `Livré`, sans seuil, n'ont **aucune** pastille — inchangé | seuil `null` |

#### 9.12.7 Preuves exigées

1. le seed appliqué deux fois de suite rend le **même** état observable — convergence, §9.8 ;
2. les sept lignes du contrat du §9.12.6 mesurées en base ;
3. les lignes *a* à *e* mesurées par l'**API**, avec le jeton réel de l'administratrice — scénario
   retourné de `e2e/api/board.spec.ts` ;
4. la bascule constatée **à l'écran, sur la donnée réelle et sans aucune substitution** : session
   ouverte par le formulaire de connexion, board de `grands-comptes`, pastille `data-depassee="oui"`
   sur `…0c3` et `data-depassee="non"` sur `…0c1`, console vierge ;
5. captures produites **et observées**, sous `docs/captures/CRM-046/`. **Trois, et non une** : le
   contraste `danger` / neutre tient sur un seul écran à 1440 px, `Prospection` et `Relance` étant
   voisines, mais `Livré` est la **sixième** colonne et le board la laisse hors champ. La troisième
   capture l'amène à l'écran plutôt que d'annoncer trois états sur une image qui n'en porte que
   deux. La quatrième mesure le repli à 390 px ;
6. `scripts/verify-board.sh` rejoué, son contrôle retourné compris, avec sa **contre-épreuve** :
   une seconde card vieillie fait échouer le contrôle, puis la base est rendue à son état.

---

## 10. Le jeu de démonstration de la corbeille — `CRM-077`

Le §9 comble les écrans vides. Ce chapitre comble un vide d'une autre nature : les migrations
`0037` et `0038` ont livré la corbeille et sa garde de restauration, et **aucune donnée du seed ne
les exerce**. Le §5 de `docs/SPEC-corbeille.md` le nomme dans sa ligne « Seed » : sans un track et
un channel en corbeille, et sans un enfant sous parent en corbeille, le refus du §3.4 « n'a aucun
cas de démonstration ».

Trois sessions ont différé ce chapitre. Il est le **préalable** de l'écran du §4 de
`docs/SPEC-corbeille.md` et de ses preuves E2E : un écran de corbeille n'a rien à afficher tant que
la corbeille est vide de tout sauf d'une card.

### 10.1 Les trois objets ajoutés

| id | type | slug | nom | parent | état |
|---|---|---|---|---|---|
| `…025` | track | `legacy-2023` | Legacy 2023 | workspace | **en corbeille** |
| `…037` | channel | `dossiers-2023` | Dossiers 2023 | track `…025` | **actif** |
| `…038` | channel | `annexes-2023` | Annexes 2023 | track `…025` | **en corbeille** |

Chacun démontre une chose que les autres ne démontrent pas :

- **`…025` est le cas de restauration qui RÉUSSIT.** Son seul ascendant est le workspace, qui n'est
  jamais en corbeille : rien ne s'oppose à son retour. Sans lui, la corbeille ne porterait que des
  objets irrécupérables, et le produit ne démontrerait que son refus.
- **`…037` est l'enfant du §3.3, et il ne porte AUCUN `deleted_at`.** C'est le point le plus facile
  à manquer en relisant la base : ce channel est, en colonne, parfaitement vivant. Il est
  injoignable parce que son track ne se résout plus (troisième tranche, `webapp/src/lib/tracks.ts`).
  C'est précisément ce qui garde la restauration non ambiguë — restaurer `…025` le rend, sans que
  quiconque ait eu à distinguer les enfants emportés de ceux déjà retirés.
- **`…038` est le cas de refus du §3.4.** Il est en corbeille sous un parent en corbeille : sa
  restauration rend `parent_en_corbeille` (`P0001`), et le refus dit quoi restaurer d'abord.

**Une quatrième ligne s'y est ajoutée depuis, et le §10.4 bis la porte.** Ce jeu ne portait
volontairement aucune card : le §3.3 prévoit que l'écran de suppression énumère les affaires rendues
inaccessibles, cette énumération n'existait pas, et une card posée alors n'aurait été comptée par
aucun écran. L'énumération est livrée (`docs/SPEC-corbeille.md` §3.5) ; l'affaire `…0cf` l'est donc
aussi.

### 10.2 La corbeille est un GESTE, jamais une déclaration

C'est la règle de ce chapitre, et elle a une mesure pour origine.

`app.corbeille_avant_ecriture()` (migration `0037`) écrit `deleted_by` à partir de `auth.uid()`.
**La clé de service ne porte aucune revendication `sub`** : un objet créé directement avec
`deleted_at` renseigné par la clé de service naît donc en corbeille avec `deleted_by` **nul**, et
l'audit ne documente rien. Pire, le trigger **fige** ensuite cette valeur tant que la ligne reste en
corbeille : une fois né ainsi, l'objet ne retrouvera jamais son auteur.

Les trois objets sont donc créés **actifs** par les sections ordinaires du seed, puis mis en
corbeille par un `PATCH` portant **le jeton réel de l'administratrice**. C'est exactement le patron
que la décision 376 a posé pour le commentaire retiré par la modération (INC-072) : le seed ne
fabrique pas la trace d'un geste, il **fait** le geste et laisse le produit la produire
(`CLAUDE.md` §8, « ne pas fabriquer artificiellement des traces »).

Le seed VÉRIFIE ensuite que `deleted_by` vaut bien `…011` et échoue en le disant sinon. Sans cette
vérification, une régression du trigger rendrait un seed vert et un audit muet.

### 10.3 Convergence, et le piège qu'elle évite

Les charges de création des tracks et des channels **n'envoient pas `deleted_at`**. Ce n'est pas un
oubli, c'est la condition de la convergence : `Prefer: resolution=merge-duplicates` ne met à jour
que les colonnes présentes dans la charge, si bien qu'un rejeu laisse l'état de corbeille
intact et que le trigger fige l'audit.

**Le piège, s'il fallait faire autrement.** Une charge qui enverrait `deleted_at: null` sur un objet
actuellement en corbeille demanderait sa **restauration** à chaque rejeu. Pour `…038`, dont le
parent est en corbeille, cette restauration serait **refusée** par la garde de la migration `0038`,
et le seed échouerait au second passage. La règle du §10.2 n'est donc pas seulement plus honnête :
c'est la seule qui converge.

La mise en corbeille est elle-même **conditionnée par une relecture** de l'état réel, comme les
deux allers-retours du §9.6 : si l'objet est déjà en corbeille, le seed ne récrit rien.

### 10.4 Ce que ce chapitre coûte aux preuves existantes, et pourquoi c'est légitime

Le contrat du seed change : quatre tracks deviennent **cinq**, six channels deviennent **huit**.
Plusieurs preuves figent ces comptes et deviennent rouges. Elles sont **révisées, aucune n'est
supprimée ni contournée**, et chacune porte son motif dans son propre fichier
(`docs/CloudWorker.md` §3.1) : ce n'est pas une preuve qui se trompe, c'est la règle qu'elle
constate qui a changé.

Les révisions **renforcent** plutôt qu'elles n'assouplissent : là où une preuve affirmait « quatre
tracks, dont un archivé », elle affirme désormais « cinq tracks, dont un archivé **et un en
corbeille** ». Un compte relâché en tolérance — « au moins quatre » — aurait rendu la preuve muette
sur ce que cette tranche ajoute.

### 10.4 bis L'affaire sous l'enfant vivant, et les deux niveaux qu'elle démontre

*Ajoutée par la cinquième tranche de `CRM-077`, celle de l'énumération
(`docs/SPEC-corbeille.md` §3.5).*

Le §10.1 annonçait cette affaire et disait pourquoi elle ne pouvait pas venir plus tôt : « une card
posée ici ne serait comptée par aucun écran ». L'énumération existe maintenant, son compte est donc
visible, et l'affaire est due.

| id | channel | étape | titre | état |
|---|---|---|---|---|
| `…0cf` | `…037` `dossiers-2023` | `negociation` | Reprise du dossier Marchand | **active** |

**Elle est le seul cas de garde à DEUX niveaux du seed, et c'est sa raison d'être.** La deuxième
tranche vérifie le channel **et** le track d'une affaire avant de la restaurer ; jusqu'ici, aucune
donnée ne portait la situation où le premier niveau est vivant et le second en corbeille. `…0cf` la
porte : son channel `…037` n'est pas en corbeille, son track `…025` l'est. Elle n'est pas elle-même en
corbeille — il n'y a donc rien à restaurer —, mais **l'y mettre puis l'en sortir** rend
`parent_en_corbeille` par le second niveau seul, ce qu'aucun autre objet du seed ne démontre.

**Elle donne à l'énumération son compte non nul.** Sans elle, le track `…025` énumérait « 1 channel »
et zéro affaire : la ligne des affaires étant omise quand son compte est nul
(`docs/SPEC-corbeille.md` §3.5), la composition des deux lignes ensemble n'aurait jamais été
démontrée sur la vraie base.

**Son étape est `negociation`, et ce choix est mesuré plutôt qu'esthétique.** `livre` était exclue :
`e2e/api/cards.spec.ts` pose comme préalable qu'après archivage de `…0cd` « plus aucune card ACTIVE »
n'occupe cette étape, et une seconde affaire livrée aurait rendu ce préalable faux. `perdu` était
exclue de son côté parce que son étape **exige** `motif-perte` : une affaire y naîtrait avec une fiche
incomplète, et le seed démontrerait un manque au lieu d'une affaire. `negociation` n'exige rien et ne
porte aucun compte figé hors de son propre channel.

**Ce qu'elle coûte, et les révisions sont des renforcements.** Le contrat passe de **14 à 15
affaires**, de **12 à 13 actives**, et les affaires occupent désormais **six** channels au lieu de
cinq. Les preuves qui figent ces comptes sont **révisées, aucune n'est supprimée ni contournée**, et
chacune porte son motif dans son fichier : `e2e/api/cards.spec.ts`, `e2e/api/timeline.spec.ts`,
`e2e/api/colonnes-protegees.spec.ts`, `scripts/verify-colonnes-protegees.sh`,
`scripts/verify-move-card.sh`, `scripts/verify-seed-demo.sh`, et l'annexe A de `docs/manual.md`, que
`scripts/verify-manual.sh` compare à la base.

**Deux comptes de l'annexe A étaient devenus faux DÈS la quatrième tranche, et cette tranche les
répare.** MESURÉ avant toute modification : le manuel disait « 3 tracks actifs » et « 5 channels
actifs » quand la base en portait **4** et **7**. La cause n'est pas un nombre périmé mais un
**libellé devenu ambigu** : les requêtes de `scripts/verify-manual.sh` ne connaissaient que
l'archivage, si bien qu'un objet en corbeille y était compté comme actif. Les deux requêtes excluent
désormais `deleted_at`, et deux grandeurs nouvelles — « Tracks en corbeille », « Channels en
corbeille » — rendent la corbeille visible dans l'inventaire au lieu de la fondre dans l'actif.

### 10.5 Preuves exigées

| # | Scénario | Attendu |
|---|---|---|
| 1 | Le track `…025` existe, en corbeille, `deleted_by` = `…011` | Conforme |
| 2 | Le channel `…038` existe, en corbeille, `deleted_by` = `…011` | Conforme |
| 3 | Le channel `…037` existe et porte `deleted_at` **nul** — l'enfant du §3.3 n'est pas horodaté | `deleted_at is null` |
| 4 | Restaurer `…038` avec le jeton de l'administratrice | Refus `parent_en_corbeille` (`P0001`) |
| 5 | Le seed est **rejouable** : second passage sans erreur | Cinq tracks, huit channels, `deleted_by` inchangés |
| 6 | Une dérive est rattrapée : `…025` restauré à la main, seed rejoué | `…025` de nouveau en corbeille, `deleted_by` = `…011` |
| 7 | L'affaire `…0cf` existe sous `…037`, active, à l'étape `negociation` | `deleted_at` et `archived_at` nuls |
| 8 | L'énumération du track `…025` avec le jeton de l'administratrice | **1 channel et 1 affaire** — l'enfant en corbeille n'est pas compté |

## 11. Contacts et organisations — `CRM-060` tranches 1 et 4b

Le carnet de démonstration livré par la première tranche de `CRM-060`, section 8 novies bis de
`supabase/seed/apply-seed.sh`. Toutes les valeurs ci-dessous sont **le contrat opposable** au
code : `verify-seed.sh` (à venir) les mesure.

### 11.1 Ce que le seed pose

**TROIS organisations** — deux posées par la tranche 1, la troisième par la tranche 4b :

| Identifiant | Nom | Domaine | Site web | Contacts |
|---|---|---|---|---|
| `5eed…0081` | Sogexia | `sogexia.example` | `https://www.sogexia.example` | Léo Marchand |
| `5eed…0082` | Studio Meunier | *(aucun)* | *(aucun)* | Élise Fabre |
| `5eed…0083` | Comptoir Vasseur | `comptoir-vasseur.example` | *(aucun)* | **aucun** |

Une organisation sans domaine est le cas licite du §2.1 de `docs/SPEC-contacts.md` — l'unicité
partielle sur `lower(domain)` autorise plusieurs lignes à `NULL`.

**Les deux ajouts de la tranche 4b sont exigés par la fiche d'organisation**
(`docs/SPEC-contacts.md` §11.7), et chacun exerce un cas que le seed ne couvrait pas :

- **le `website` de Sogexia** est la seule donnée qui rende le **lien externe** du §11.5. Sans lui,
  ce lien n'est jamais rendu, et la capture ne le montre pas ;
- **Comptoir Vasseur, sans aucun contact**, est la seule qui exerce l'**état vide** de la liste de
  contacts de la fiche (§11.9, cas d). Sans elle, cet état n'est démontrable que contre une réponse
  substituée, ce que `CLAUDE.md` §8 proscrit.

**Aucun compteur figé n'est déplacé, et c'est MESURÉ** : le seed compare `organizations_count` à la
taille du tableau `ORGANIZATIONS_SEED` lui-même ; aucun `scripts/verify-*.sh` ne cite
`organizations` ; `e2e/api/contacts.spec.ts` crée ses **propres** organisations sondes et les
supprime. Le carnet, qui liste des **contacts**, garde ses trois lignes.

**Trois contacts** :

| Identifiant | Nom | Organisation | Email | Téléphone | Rôle |
|---|---|---|---|---|---|
| `5eed…0091` | Léo Marchand | Sogexia | `leo.marchand@sogexia.example` | *(aucun)* | Directeur achats |
| `5eed…0092` | Sophie Dupont | *(aucune)* | `sophie@dupont.test` | *(aucun)* | *(aucun)* |
| `5eed…0093` | Élise Fabre | Studio Meunier | *(aucun)* | `+33 6 12 34 56 78` | Cheffe d'atelier |

Trois cas licites, choisis pour éprouver la matrice des colonnes facultatives :
- avec email **et** organisation (Léo) ;
- avec email, **sans** organisation (Sophie) ;
- **sans** email, avec organisation et téléphone (Élise).

**Deux rattachements `card_contacts`** :

| Card | Contact | Rôle |
|---|---|---|
| `5eed…00c2` (Migration ERP Sogexia, `grands-comptes`) | Léo Marchand | `decideur` |
| `5eed…00c4` (Refonte intranet Ville de Lyon, `refonte`) | Sophie Dupont | `prescripteur` |

### 11.2 Un contrat mesurable pour la règle 3 du classement

**Léo Marchand est rattaché à EXACTEMENT UNE card active.** C'est l'état précis que la règle 3
du classement (`CRM-055`, tranche 2 de `CRM-060`, `docs/SPEC-mail-subsystem.md` §16) lira pour
suggérer une card. Le seed **vérifie** ce compte et **échoue** si un rejeu ou une future tranche
ajoute une seconde affaire à Léo : sans cette garde, la donnée exigée par la tranche 2 pourrait
dériver silencieusement.

### 11.3 Convergence

Les insertions passent par un `PUT ... eq.<id>` avec `Prefer: resolution=merge-duplicates`, et
les rattachements par un `POST /rest/v1/card_contacts` avec la même en-tête sur la clé primaire
`(card_id, contact_id)`. Le seed est **rejouable sans dédoublonnage** ; deux passages successifs
laissent `organizations = 2`, `contacts = 3`, `card_contacts = 2`, `leo_cards = 1`, mesuré.

### 11.4 Preuves exigées

| # | Scénario | Attendu |
|---|---|---|
| 1 | `select count(*) from public.organizations` | `2` |
| 2 | `select count(*) from public.contacts` | `3` |
| 3 | `select count(*) from public.card_contacts` | `2` |
| 4 | `select count(*) from public.card_contacts where contact_id = '5eed…0091'` | `1` — Léo sur exactement une card active |
| 5 | Second rejeu du seed | Aucune erreur, mêmes comptes |
| 6 | Un contact sans email et un contact avec email cohabitent dans le même workspace | Conforme, unicité partielle |
| 7 | Une organisation sans domaine et une avec cohabitent dans le même workspace | Conforme, unicité partielle |

## 12. Budgets et occurrences — `CRM-084` tranche 1

Section 8 quaterdecies du script. Les quatre budgets et les deux occurrences sont un **contrat
opposable** : `CRM-086` construira ses histogrammes dessus, et les déplacer déplacerait ses
captures.

### 12.1 Ce que le seed pose

| Identifiant | Track | Nom | Devise | Enveloppe | Récurrent | Clôturé |
|---|---|---|---|---|---|---|
| `…0000c1` | Conseil & IA | Prospection sortante | `EUR` | 12 000,00 | non | non |
| `…0000c2` | Studio web | Publicité 2026 | `EUR` | 24 000,00 | **oui** | non |
| `…0000c3` | Studio web | Salon du web 2025 | `EUR` | 8 000,00 | non | **oui** |
| `…0000c4` | Formation | Suisse romande | **`CHF`** | 15 000,00 | non | non |

| Identifiant | Budget | Libellé | Période | Enveloppe | Clôturée |
|---|---|---|---|---|---|
| `…0000d1` | Publicité 2026 | Janvier 2026 | 2026-01-01 → 2026-01-31 | 2 000,00 | **oui** |
| `…0000d2` | Publicité 2026 | Février 2026 | 2026-02-01 → 2026-02-28 | 2 500,00 | non |

**Chaque ligne existe pour une raison, et aucune n'est décorative.**

- **`Prospection sortante` vit sur un track fermé à la lectrice.** MESURÉ sur la pile :
  `app.can_read_track` rend faux à Farida pour « Conseil & IA », son droit fin `none` n'étant pas
  rouvert au niveau du TRACK par son `channel_members` sur « Prospection ». Sans ce budget, la
  règle de lecture du §3.1 de `docs/SPEC-costs.md` ne serait démontrable sur aucun écran : les
  trois profils verraient la même liste, et le cumul du §4.5 n'aurait jamais l'occasion de
  différer selon le lecteur.
- **`Publicité 2026` porte DEUX occurrences, dont une close.** C'est le seul jeu qui permette à
  `CRM-086` de rendre ses deux vues sur la MÊME donnée : agrégé dans la vue du track (§4.2),
  détaillé par occurrence dans sa fiche (§4.3). Avec une seule occurrence, les deux vues seraient
  indistinguables.
- **`Salon du web 2025` est clôturé**, donc absent de l'histogramme du track (§4.2) et masqué par
  défaut dans l'administration (§4.1). Sans lui, l'état « clôturé » serait documenté sans être
  démontrable, ce que `CLAUDE.md` §8 refuse.
- **`Suisse romande` est en `CHF`.** Le §4.5 impose un histogramme **par devise présente** ; un
  jeu entièrement en euros rendrait cette règle indémontrable et laisserait la contrainte
  `^[A-Z]{3}$` de la migration purement décorative.

**Il n'y a PAS de « Mars 2026 », et c'est le contrat.** `docs/SPEC-costs.md` §2.2 interdit toute
génération automatique d'occurrences. Un mois sans occurrence est une information — il ne s'est
rien passé —, et un seed qui poserait douze mois vides la détruirait tout en donnant à croire que
le produit les engendre.

### 12.2 Les deux clôtures sont des GESTES

`Salon du web 2025` et `Janvier 2026` naissent **ouverts**, puis sont clôturés par un vrai `PATCH`,
exactement ce que l'administration des budgets enverra (§4.1). `CLAUDE.md` §8 interdit de fabriquer
la trace d'un processus au lieu de l'exécuter : une clôture posée à l'insertion ne prouverait pas
que la clôture fonctionne.

### 12.3 Convergence

Les insertions passent par un `POST` avec `Prefer: resolution=merge-duplicates` sur la clé
primaire, et les deux clôtures par un `PATCH` idempotent. Le seed est **rejouable sans
dédoublonnage** ; deux passages successifs laissent `budgets = 4` et `budget_occurrences = 2`,
mesuré. Un budget doté à la main pendant une session de développement est **rétabli au contrat**,
pas dupliqué.

### 12.4 Preuves exigées

Les deux premières sont exécutées **par le script lui-même**, avec des jetons obtenus par la vraie
route de connexion : un contrôle qui s'appuierait sur la clé de service ne prouverait rien, celle-ci
traversant la RLS.

| # | Scénario | Attendu |
|---|---|---|
| 1 | `GET /rest/v1/budgets` avec le jeton réel de la lectrice | **3** budgets sur 4 — « Prospection sortante » est absent |
| 2 | `POST /rest/v1/budgets` avec le jeton réel du business developer | **403** — il écrit les affaires du track, pas ses enveloppes |
| 3 | `select count(*) from public.budgets` | `4` |
| 4 | `select count(*) from public.budget_occurrences` | `2` |
| 5 | `select count(*) from public.budgets where closed_at is not null` | `1` |
| 6 | `select count(*) from public.budget_occurrences where closed_at is not null` | `1` |
| 7 | `select count(distinct currency) from public.budgets` | `2` — `EUR` et `CHF` |
| 8 | Second rejeu du seed | Aucune erreur, mêmes comptes, clôtures conservées |

---

## 13. Les échéances suivent le calendrier — `CRM-061`

Écrit **avant toute ligne de code** de `CRM-061`, et **après mesure** sur la pile seedée le
2026-08-21. Ce chapitre est au `next_action_at` ce que le §9.12 est à `entered_step_at`, et il
naît du même défaut, constaté une seconde fois.

### 13.1 Le manque, mesuré et non supposé

Le §9 pose les échéances du contrat en **dates littérales** — `2026-08-07T14:00:00Z`,
`2026-08-25T09:00:00Z`, et ainsi de suite. Elles étaient justes le jour où le contrat a été écrit ;
le calendrier les défait ensuite, exactement comme il défaisait l'ancienneté avant le §9.12.

MESURÉ le 2026-08-21, base fraîchement seedée, sur les **26** affaires actives portant une échéance :

| Ce que la vue « Ma journée » aurait montré | Compte |
|---|---|
| **En retard** | 5 — aucune voulue, toutes rattrapées par le calendrier |
| **Aujourd'hui** | **0** |
| **À venir dans sept jours** | 1 |

La section centrale de l'écran — celle qui donne son nom à la vue — n'avait **aucune donnée pour
l'exercer**, et n'en aurait jamais eu : aucune date littérale ne tombe le jour où on la regarde. Le
§9 de `docs/SPEC-cards.md` annonçait pourtant que ces colonnes existent « sans quoi la vue *Ma
journée* et l'index du §2.8 seraient livrés sans aucune donnée pour les exercer ». La donnée était
là ; c'est sa **date** qui ne l'était plus.

### 13.2 Le remède : un DÉCALAGE unique, appliqué après l'écriture du contrat

Le contrat du §9 **n'est pas réécrit**. Ses dates littérales restent la référence lisible, et une
seule instruction les translate toutes du même intervalle :

```
next_action_at ← next_action_at + (date_trunc('day', now()) − date '2026-08-21')
```

`2026-08-21` est l'**ancre** du contrat : la journée pour laquelle ses dates ont été choisies. Le
jour de l'ancre, le décalage vaut zéro et rien ne bouge ; un mois plus tard il vaut trente et un
jours, et **toute la distribution est préservée à la journée près** — les écarts entre affaires,
l'ordre, les regroupements par channel, tout ce que le §9 décrit reste vrai.

**Pourquoi un décalage global et non une date relative par ligne.** Écrire chaque échéance en
« `now()` plus tant de jours » aurait rendu le contrat du §9 illisible — quarante lignes de tableau
dont aucune ne dit plus quand l'affaire est due par rapport aux autres — et aurait dispersé la règle
dans quarante endroits. Une translation unique laisse le contrat lisible et met la règle à un seul
endroit.

### 13.3 Convergence, et l'ordre qui la porte

L'instruction est **convergente**, et c'est l'ordre des sections qui le garantit : la section 8 ter
et ses suivantes réécrivent `next_action_at` depuis les **littéraux** du contrat à chaque passage
(`Prefer: resolution=merge-duplicates`, colonne envoyée y compris nulle, §9.2). La translation part
donc toujours de la valeur littérale, jamais de la valeur déjà translatée : **deux rejeux successifs
laissent la même base**, et non une base décalée deux fois.

Le décalage est appliqué **après** toutes les sections qui écrivent des cards, et **après** le
sommeil de démonstration de la section 8 duodecies : le contrôle de la ligne *e* du §13.5 lit
`snoozed_until`, qui n'est posée que là. Les deux sections sont par ailleurs indépendantes — le
sommeil ne lit aucune échéance, et la translation n'écrit aucun sommeil.

L'écriture passe par la **clé de service**, comme au §9.12.3 : `next_action_at` est ouverte à
`authenticated` (`CRM-013`), mais le seed n'a pas à se connecter pour poser un état de
démonstration.

### 13.4 Trois échéances du contrat sont RÉVISÉES, et chacune a son motif

Le décalage préserve la distribution ; il ne crée pas ce qu'elle ne contient pas. Le contrat du §9
ne portait **aucune** échéance le jour de l'ancre, et aucune échéance proche appartenant à
l'administratrice — les deux manques du §13.1. Trois lignes sont donc révisées, et **seulement**
trois :

| Affaire | Avant | Après | Ce qu'elle démontre |
|---|---|---|---|
| `…0c7` « Formation Data & IA — promo 2026 » | `2026-08-10T08:00:00Z` | `2026-08-21T09:00:00Z` | la section **Aujourd'hui**, qui n'avait aucune donnée. Responsable : Camille Aubert |
| `…d008` « Hébergement infogéré — Éditions Bertrand » | `2026-09-15T11:00:00Z` | `2026-08-24T11:00:00Z` | la section **À venir** pour Camille Aubert, dont aucune affaire ne tombait dans l'horizon de sept jours |
| *(inchangée)* `…0c3` « Audit sécurité applicative » | `2026-08-07T14:00:00Z` | — | la section **En retard**, quatorze jours avant l'ancre. C'est déjà la card que le §9.12 vieillit dans son étape : une seule affaire porte les deux retards, et ce n'est pas une coïncidence — c'est la même affaire négligée |

**Ce que ces trois révisions ne changent pas** : ni le channel, ni l'étape, ni le responsable, ni le
montant, ni la position d'aucune affaire. Aucune preuve du dépôt n'assortit d'assertion à ces deux
échéances — vérifié fichier par fichier avant la révision.

### 13.5 Contrat, mesurable en base

Quel que soit le jour où le seed s'applique, et pour l'administratrice `…011` :

| # | Ce qui doit être vrai | Vérifié par |
|---|---|---|
| a | **Au moins une** affaire active, non endormie, dont elle est responsable, a une échéance **strictement antérieure** au début du jour courant | le seed lui-même |
| b | **Au moins une**, dans le **jour courant** | le seed lui-même |
| c | **Au moins une**, entre demain et l'horizon de sept jours | le seed lui-même |
| d | La portée « tout l'espace de travail » rend **strictement plus** de lignes que « mes affaires » | le seed lui-même |
| e | **Exactement une** affaire endormie porte une échéance dans l'horizon — `…0ca` « Cadrage data — Groupe Vallier » | le seed lui-même |
| f | Un second rejeu laisse les mêmes échéances, à la seconde près | rejeu |

Le seed **échoue** si l'un de ces contrôles n'est pas tenu : un jeu de démonstration qui ne
démontre plus est un contrat rompu, pas un détail cosmétique (`CLAUDE.md` §8).

### 13.6 Ce que ce chapitre ne fait pas

- Il **ne touche à aucune autre colonne de date** : `created_at`, `entered_step_at`, `archived_at`,
  `deleted_at` et `snoozed_until` gardent leurs règles, écrites ailleurs.
- Il **n'invente aucune affaire**. Les quarante et une cards du seed restent les mêmes, aux trois
  échéances révisées près.
- Il **ne rend pas les dates du §9 fausses**. Elles restent le contrat lisible ; le décalage est
  une translation, pas une réécriture.

## 14. Modèles d'email — `CRM-063` tranche 1

Unité : `CRM-063`. Spécification de l'objet : `docs/SPEC-modeles-emails.md` §2.8.
Section du script : `supabase/seed/apply-seed.sh`, « 8 sexdecies ».

### 14.1 Ce que le seed pose

**Deux modèles**, et deux suffisent parce qu'ils sont **différents par construction** — le compte
n'est pas le contrat, la différence l'est.

| Identifiant | Nom | Objet | Ce que ce modèle démontre, et lui seul |
|---|---|---|---|
| `7e11a7e0-…001` | Relance sans réponse | `Où en est {{card.title}} ?` | des variables dans l'**objet** ET dans le corps, dont une **pouvant être nulle** (`{{card.amount}}`) : le cas que le rendu de la tranche 2 devra trancher |
| `7e11a7e0-…002` | Prise de contact | texte fixe | des variables dans le **corps seul** : sans lui, une contrainte posée sur le seul `subject` passerait tous les contrôles |

Les deux portent `created_by` = Camille Aubert, **explicitement**. La colonne est une trace
qu'aucune politique ne lit (`docs/SPEC-modeles-emails.md` §2.7 point 14) ; la laisser nulle rendrait
indémontrable l'écran de la tranche 2, qui affichera l'auteur.

### 14.2 Les deux modèles sont créés PAR LE PRODUIT

`api_admin`, c'est-à-dire la route REST avec le **jeton réel de l'administratrice** — jamais un
`INSERT` direct, jamais la clé de service. `CLAUDE.md` §8 l'exige, et ce chemin a ici une vertu de
plus : il **exerce** la politique d'insertion du §2.6. Un seed qui passerait par `service_role`
resterait vert même si cette politique était cassée.

### 14.3 Convergence

`resolution=merge-duplicates` sur des identifiants **stables** : un rejeu ne duplique rien. Le
script relit ensuite le compte et **échoue** s'il diffère de deux — la garde des identités
sortantes, transposée.

Deux gardes supplémentaires portent sur ce que le jeu doit **démontrer**, et non sur son compte :
l'objet du premier modèle doit porter une variable, celui du second ne doit pas en porter. Un jeu
qui perdrait cette différence laisserait passer une validation posée sur une seule colonne.

### 14.4 Preuves exigées

- `supabase/tests/0053_modeles_emails.test.sql` : la suite pose ses propres fixtures et rend le
  seed **intact** par son `rollback` ;
- `e2e/api/modeles-emails.spec.ts` : les quatorze lignes du contrat d'API, et le seed constaté
  **intact** en fin de suite ;
- `scripts/verify-modeles-emails.sh` : le verdict unique de la tranche.
