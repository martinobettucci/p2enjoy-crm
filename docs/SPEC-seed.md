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

Aucun droit fin (`track_members`, `channel_members`) n'est posé : les tables `tracks` et `channels`
n'existent pas encore (`CRM-020`, `CRM-021`), et une ligne de droit fin y renverrait un identifiant
qui ne désigne rien.

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

## 8. Ce que ce seed ne livre pas, et pourquoi

- **Aucun second workspace, aucun compte extérieur.** `CRM-005` dit « un workspace ». Les preuves
  n° 3 et n° 7 de `docs/SPEC-permissions-rls.md` §7 en exigeront un, ainsi qu'un compte sans
  appartenance ; `scripts/verify-authz.sh` les crée et les détruit lui-même aujourd'hui. Le point
  est nommé ici pour que `CRM-014` sache qu'il devra soit étendre le seed, soit continuer de
  fabriquer ses propres comptes. Ce n'est pas une contradiction, seulement une frontière d'unité.
- **Aucun droit fin.** Voir §2.2 : les tables cibles n'existent pas.
- **Aucune donnée métier** — ni track, ni channel, ni workflow, ni card, ni message : aucune de ces
  tables n'est livrée. C'est l'objet de `CRM-046`.
- **Aucun écran, aucune vérification visuelle.** Le seed n'atteint pas l'interface, dont le premier
  écran arrive avec `CRM-007`.
- **Le seed ne crée pas ses comptes depuis le produit.** Le parcours d'invitation n'a aucun
  composant pour le porter (INC-015) : la création reste une opération d'exploitation, comme pour
  `CRM-011`.
