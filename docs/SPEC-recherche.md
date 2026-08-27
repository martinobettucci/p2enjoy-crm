# SPEC — Recherche globale plein texte

*Unité `CRM-065` du backlog — « Recherche globale plein texte et palette Cmd+K ».*

Ce document est le contrat opposable de la recherche. Il est écrit **après mesure** sur la pile
locale montée et seedée, jamais de mémoire : le §2 énumère les mesures, avec leur sortie exacte, et
chaque règle des chapitres suivants s'y appuie.

---

## 1. Objet, découpage et frontières

### 1.1 Ce que l'unité livre, et pourquoi

Le produit compte aujourd'hui plus de trente écrans et une arborescence à trois niveaux — tracks,
channels, affaires — doublée d'un carnet de contacts, d'une messagerie et d'un fil de commentaires.
**Rien ne permet de retrouver un objet dont on ne sait plus où il vit.** Chaque écran porte au mieux
un filtre local, qui ne voit que sa propre liste.

`CRM-065` livre la recherche transverse : un terme, et les objets métier qui le portent, quels que
soient leur famille et leur emplacement dans l'arborescence.

### 1.2 Le découpage en deux tranches, écrit avant la première ligne de code

- **Tranche 1 — la recherche en base.** Le vocabulaire de recherche, les index, et la fonction
  `public.recherche_globale`. Elle est **le sujet du présent document**, chapitres §3 à §9.
  **Aucune surface.**
- **Tranche 2 — la palette.** Le raccourci `Cmd+K` / `Ctrl+K`, la palette, sa navigation clavier,
  ses états, et la navigation vers l'objet choisi. Elle sera spécifiée dans son propre chapitre,
  après mesure, et **avant sa première ligne de code**.

La frontière est nette et elle est délibérée : la tranche 1 se prouve **entièrement hors
interface**, avec les jetons réels des trois profils du seed. Une règle d'accès qui ne se prouve que
par un écran n'est pas une règle d'accès (`CLAUDE.md` §10).

### 1.3 Le principe qui commande tout le reste

**La recherche n'ouvre RIEN.** Elle ne crée aucune politique, ne modifie aucune politique existante,
n'accorde aucun privilège de table, et ne contourne aucune RLS. Elle est un **chemin de lecture
supplémentaire vers ce que l'appelant peut déjà lire**, et rien d'autre.

C'est ce que garantit le choix de `SECURITY INVOKER` au §6.3 : la fonction s'exécute sous le rôle et
les claims de l'appelant, donc chaque table qu'elle interroge applique sa propre politique de
lecture, écrite par l'unité qui la porte. Une recherche `SECURITY DEFINER` répondrait pour
`postgres`, qui traverse toute la RLS : elle rendrait à chacun les affaires de tous. Ce ne serait pas
une commodité, ce serait une fuite.

**Le refus est donc ZÉRO LIGNE, jamais une erreur** : un objet que l'appelant ne peut pas lire ne se
distingue en rien d'un objet qui n'existe pas. C'est la forme de refus déjà retenue par
`public.mentionnables` (`docs/SPEC-notifications.md` §34.2) et par `public.cards_figees`.

---

## 2. Mesures fondatrices

Relevées le **2026-08-27** sur la pile locale montée par `./runDev.sh` et seedée par
`supabase/seed/apply-seed.sh`, base `postgres`, PostgreSQL **17.6**. Toutes les sondes ont été
créées dans une transaction et **annulées** ; l'état de la base a été relu après chaque bloc et
retrouvé intact (`select count(*) from pg_namespace where nspname='sonde'` → `0`,
`select count(*) from pg_extension where extname='unaccent'` → `0`).

### M1 — la configuration `french` existe, et `unaccent` est disponible sans être installée

`select cfgname from pg_ts_config` énumère **29 configurations**, dont `french` et `simple`.
`pg_extension` en porte sept : `pg_cron`, `pg_net`, `pg_stat_statements`, `pgcrypto`, `plpgsql`,
`supabase_vault`, `uuid-ossp` — **`unaccent` n'y est pas**. `pg_available_extensions` la donne
disponible en version **1.1**, aux côtés de `pg_trgm` 1.6, `btree_gin` 1.3 et `fuzzystrmatch` 1.2.

La migration doit donc **installer** `unaccent`. Ce n'est pas une commodité : voir M2.

### M2 — LA CONFIGURATION `french` N'EST PAS INSENSIBLE AUX ACCENTS, ET ELLE EN A L'AIR

C'est la mesure qui commande le §3, et elle contredit l'intuition. Le radicaliseur français retire
l'accent de certains mots et le conserve dans d'autres, sans règle qu'un utilisateur puisse deviner :

```
to_tsvector('french','Amélie Dupont créance échéance')  =>  'amel':1 'dupont':2 'créanc':3 'échéanc':4
```

Conséquence, mesurée terme à terme :

| Saisie | Document | `french` | `app.francais_sans_accent` |
|---|---|---|---|
| `amelie` | `Amélie` | **trouve** | trouve |
| `societe` | `société` | **trouve** | trouve |
| `creance` | `créance` | **NE TROUVE PAS** | trouve |
| `echeance` | `échéance` | **NE TROUVE PAS** | trouve |
| `proces` | `procès` | **NE TROUVE PAS** | trouve |

Un comportement juste une fois sur deux est **pire** qu'un comportement uniformément strict : il
apprend à l'utilisateur une règle fausse. La recherche ne peut donc pas employer `french` telle
quelle.

### M3 — une configuration dérivée corrige l'écart, et reste indexable

Sonde exécutée puis annulée :

```sql
create extension unaccent;
create text search configuration sonde.fr ( copy = french );
alter text search configuration sonde.fr
  alter mapping for hword, hword_part, word with unaccent, french_stem;

to_tsvector('sonde.fr','Société Générale — créance échéance procès')
  =>  'creanc':3 'echeanc':4 'general':2 'proc':5 'societ':1
```

Les cinq lignes du tableau de M2 passent, **dans les deux sens** — `créance` saisi trouve `creance`
écrit, et l'inverse.

**Et la configuration est indexable**, ce qui n'allait pas de soi : `to_tsvector(regconfig, text)`
est `IMMUTABLE` (`provolatile = 'i'`) là où la forme à un seul argument est `STABLE` — elle dépend de
`default_text_search_config`. Un index d'expression et une colonne générée l'acceptent donc tous
deux ; la sonde a créé les deux et le `create index … using gin` a réussi.

### M4 — les cinq familles, leurs colonnes, et leur effacement doux

`information_schema.columns` mesuré sur les tables candidates :

| Table | Colonnes de texte retenues | `deleted_at` |
|---|---|---|
| `cards` | `title`, `next_action`, `description` | **oui** |
| `contacts` | `full_name`, `email`, `role_title` | non |
| `organizations` | `name`, `domain` | non |
| `card_comments` | `body` | **oui** |
| `mail_messages` | `subject`, `from_name`, `from_address`, `body_text` | non |

`tracks` et `channels` portent également `deleted_at`. Leur exclusion du périmètre est motivée au
§8.1.

### M5 — les cinq tables portent une politique de lecture, et une seule chacune

`pg_policies`, `cmd = 'SELECT'` :

```
cards            cards_lecture
card_comments    card_comments_lecture
contacts         contacts_lecture_membre
organizations    organizations_lecture_membre
mail_messages    mail_messages_lecture
```

La RLS est active (`relrowsecurity = t`) sur les cinq. **La recherche n'en écrit aucune et n'en
modifie aucune.**

### M6 — LE SEED REND LES TROIS PROFILS ASYMÉTRIQUES, ET C'EST CE QUI REND LA TRANCHE PROUVABLE

Comptes lus **sous les rôles réels**, `set local role authenticated` et
`set local request.jwt.claims`, transaction annulée :

| Table | Camille Aubert (`admin`, `…011`) | Driss Lemoine (`business_developer`, `…012`) | Farida Nowak (`viewer`, `…013`) |
|---|---|---|---|
| `cards` non supprimées | 40 | 40 | **35** |
| `contacts` | 3 | 3 | 3 |
| `organizations` | 3 | 3 | 3 |
| `card_comments` non supprimés | 4 | 4 | **1** |
| `mail_messages` | 4 | **2** | **0** |

Trois écarts réels, sur trois familles différentes, sans qu'aucune donnée nouvelle soit à seeder :
la preuve du §9 s'appuie sur eux et **non** sur une fixture fabriquée.

### M7 — le préfixe est nécessaire, et `websearch_to_tsquery` ne le donne pas

Une palette se remplit lettre à lettre : `audi` doit trouver `Audit sécurité applicative` **avant**
que l'utilisateur ait fini de taper. Mesuré :

```
websearch_to_tsquery('sonde.fr','audit securite')   =>  'audit' & 'securit'      -- aucun préfixe
to_tsquery('sonde.fr','audi:*')                     =>  'audi':*
to_tsquery('sonde.fr','societe:*')                  =>  'societ':*               -- radicalisé ET préfixé
to_tsquery('sonde.fr','creance:*')                  =>  'creanc':*
```

`to_tsquery` applique donc bien le dictionnaire — désaccentuation comprise — **avant** de poser le
préfixe. C'est cette forme que le §6.2 retient.

Correspondances réelles mesurées sur le seed :

```
'audi:* & secu:*'   =>  Audit sécurité applicative
'astreint:*'        =>  Astreinte 24/7 … Ville de Lyon  /  Astreinte week-end — Transports Béranger
'elise:*'           =>  Élise Fabre                      -- l'accent initial, saisi sans accent
```

### M8 — un terme sans lexème rend une requête vide, et `to_tsquery` le signale bruyamment

```
websearch_to_tsquery('sonde.fr','le la de')  =>  ''    (vide)
to_tsquery('sonde.fr', <chaîne vide>)        =>  NOTICE: text-search query contains only stop
                                                 words or doesn't contain lexemes, ignored
```

Le `NOTICE` n'est pas une erreur, mais il pollue le journal du serveur à chaque frappe d'une palette.
Le §6.2 impose donc de **ne jamais appeler `to_tsquery` sur une chaîne vide** : la fonction sort par
zéro ligne avant l'appel.

### M9 — l'index d'expression est réellement employé

Sonde annulée, `enable_seqscan = off`, `explain (costs off)` sur `public.cards` :

```
Bitmap Heap Scan on cards
  Recheck Cond: ((setweight(to_tsvector('sonde.fr', COALESCE(title,''))     , 'A') ||
                  setweight(to_tsvector('sonde.fr', COALESCE(next_action,'')), 'B') ||
                  setweight(to_tsvector('sonde.fr', COALESCE(description,'')), 'C')) @@ '''audit'':*')
  ->  Bitmap Index Scan on sonde_cards_idx
```

L'expression de l'index et celle de la clause `where` sont **écrites à l'identique**, et c'est une
contrainte de conception, pas un accident : voir §5.2.

### M10 — les conventions de RPC du dépôt

`pg_proc` sur `public`, fonctions rendant un ensemble : douze existent. Six sont
`SECURITY INVOKER` — `cards_figees`, `mentionnables`, `etat_messagerie`, `inbox_arborescence`,
`previsualiser_exigence`, `rendre_modele_email` —, six sont `DEFINER`. Les plus récentes préfixent
leurs paramètres par `p_`. `public.recherche_globale` suit les premières sur les deux points.

### M11 — l'extrait se prélève proprement, sans balise

`ts_headline` avec `StartSel` et `StopSel` **vides** rend un extrait de texte pur, sans balisage à
échapper côté client :

```
ts_headline('sonde.fr', body, to_tsquery('sonde.fr','gabarit:*'),
            'StartSel="", StopSel="", MaxWords=18, MinWords=6, ShortWord=2,
             MaxFragments=1, FragmentDelimiter=" … "')
  =>  confirmé le périmètre de la refonte : trois gabarits, pas cinq
```

Mesuré aussi : sur un corps court, l'extrait rend le **document entier, retours à la ligne
compris**. Le §6.5 impose donc de replier les blancs.

---

## 3. Le vocabulaire de recherche — `app.francais_sans_accent`

### 3.1 Définition

La migration installe `unaccent` puis crée, **dans le schéma `app`**, une configuration de recherche
dérivée de `french` :

```sql
create text search configuration app.francais_sans_accent ( copy = french );
alter text search configuration app.francais_sans_accent
  alter mapping for hword, hword_part, word with unaccent, french_stem;
```

`app` et non `public` : le schéma `app` porte déjà les fonctions d'autorisation
(`docs/SPEC-permissions-rls.md` §3) et n'est **pas** exposé par PostgREST. Une configuration de
recherche n'est pas un objet de l'API.

L'extension `unaccent` est installée dans le schéma **`extensions`** lorsqu'il existe, sinon dans
`public` — la migration se conforme à ce que la base porte déjà, sans en créer.

### 3.2 Ce que la configuration garantit, et ce qu'elle ne garantit pas

**Garanti** : la désaccentuation est **uniforme et bidirectionnelle** (M2, M3). `créance` saisi
trouve `creance` écrit ; `creance` saisi trouve `créance` écrit. La casse est ignorée, l'analyseur
`default` la neutralisant avant les dictionnaires.

**Non garanti, et nommé plutôt que sous-entendu** :

- **aucune tolérance à la faute de frappe.** `audti` ne trouve pas `audit`. `pg_trgm` le
  permettrait ; il n'est pas installé, et l'introduire changerait le classement de tous les
  résultats. Écart nommé, laissé à la tranche 2 ou à une unité ultérieure.
- **aucune recherche de sous-chaîne interne.** `curite` ne trouve pas `sécurité` : le préfixe du
  §6.2 attaque le début du lexème, jamais son milieu.
- **les mots vides français sont ignorés** (`le`, `la`, `de`, `et`…). Une saisie qui n'en contient
  pas d'autres rend zéro ligne (§6.5, ligne *f*).

### 3.3 Cette configuration ne remplace jamais `default_text_search_config`

Elle est **toujours nommée explicitement**, dans l'index comme dans la requête. Aucune migration ne
touche `default_text_search_config`, ni au niveau de la base, ni au niveau d'un rôle : le faire
changerait silencieusement le comportement de tout appel à un argument de `to_tsvector` écrit
ailleurs, aujourd'hui ou demain.

---

## 4. Les cinq familles, leurs colonnes et leurs poids

La tranche 1 couvre **cinq familles d'objets métier**. Chacune reçoit un discriminant textuel stable,
qui est la valeur de la colonne `objet` du résultat, et qui **ne changera pas** — la tranche 2 en
dépend pour router vers l'écran.

| `objet` | Table | Poids `A` | Poids `B` | Poids `C` |
|---|---|---|---|---|
| `affaire` | `public.cards` | `title` | `next_action` | `description` |
| `contact` | `public.contacts` | `full_name` | `email` | `role_title` |
| `organisation` | `public.organizations` | `name` | `domain` | — |
| `commentaire` | `public.card_comments` | — | — | `body` |
| `message` | `public.mail_messages` | `subject` | `from_name`, `from_address` | `body_text` |

Les poids sont ceux de PostgreSQL, et `ts_rank_cd` leur applique les coefficients par défaut
`{0.1, 0.2, 0.4, 1.0}` pour `{D, C, B, A}` : un terme trouvé dans le **titre** d'une affaire pèse dix
fois un terme trouvé dans sa description. C'est ce que l'utilisateur attend d'une palette — le nom de
la chose avant son contenu.

`card_comments` ne porte que `body` : un commentaire n'a pas de titre, et lui en fabriquer un à
partir de son affaire fausserait le classement en donnant le poids `A` à un texte que le commentaire
ne contient pas.

`organizations.website` est **exclue** : c'est une URL, dont les lexèmes (`https`, `www`, `com`)
bruiteraient chaque recherche sans jamais être ce qu'on cherche.

---

## 5. Les index

### 5.1 Cinq index GIN d'expression, aucune colonne nouvelle

La migration crée **un index GIN par famille**, sur l'expression pondérée du §4. Elle **n'ajoute
aucune colonne** aux cinq tables.

Ce choix est délibéré et il a un motif mesurable : une colonne générée `tsvector` serait
**exposée par PostgREST** sur cinq tables, donc rendue par tout `select=*` existant, et elle
apparaîtrait dans `webapp/src/lib/database.types.ts`. Elle changerait la forme publique de cinq
tables du produit pour un besoin interne au moteur de recherche. L'index d'expression obtient le même
service sans rien changer de ce que l'API rend.

Nommage, aligné sur le dépôt : `<table>_recherche_idx`.

### 5.2 L'expression est écrite à l'identique dans l'index et dans la requête

C'est une contrainte, et M9 en est la preuve : l'optimiseur ne retient un index d'expression que si
l'expression de la clause `where` lui est **structurellement identique**. Aucune fonction
enveloppante n'est interposée — une fonction SQL peut être « inlinée » à la planification de la
requête et pas dans la définition de l'index, et les deux expressions cesseraient alors de
correspondre, sans le moindre signal : la recherche resterait juste, et deviendrait lente.

La duplication est donc **assumée et signalée dans la migration**, avec ce motif écrit sur place.

### 5.3 Ce que les index ne portent pas

Les index ne portent **pas** la condition `deleted_at is null`. Un index partiel serait plus petit,
mais la corbeille (`CRM-077`) restaure des lignes : un index partiel les réintégrerait par une
écriture d'index au moment de la restauration, là où l'index complet les a déjà. Le filtre reste dans
la requête.

---

## 6. `public.recherche_globale` — le contrat

### 6.1 Signature

```sql
public.recherche_globale(p_terme text, p_limite integer default 20)
returns table (
    objet        text,
    id           uuid,
    workspace_id uuid,
    titre        text,
    sous_titre   text,
    extrait      text,
    rang         real
)
```

| Colonne | Contenu | Nul possible |
|---|---|---|
| `objet` | le discriminant du §4 : `affaire`, `contact`, `organisation`, `commentaire`, `message` | non |
| `id` | la clé primaire de la ligne trouvée, dans sa propre table | non |
| `workspace_id` | l'espace de travail de la ligne | non |
| `titre` | le libellé principal — voir §6.4 | non, mais peut être la chaîne vide |
| `sous_titre` | le contexte de la ligne — voir §6.4 | **oui** |
| `extrait` | l'extrait du corps, replié sur une ligne — voir §6.5 | **oui** |
| `rang` | `ts_rank_cd` de la ligne, strictement positif | non |

### 6.2 Comment le terme devient une requête

La normalisation est **entièrement écrite ici**, et elle ne dépend d'aucune saisie du client :

1. `p_terme` est découpé sur toute suite de caractères non alphanumériques :
   `regexp_split_to_array(lower(p_terme), '[^[:alnum:]]+')`. Les lettres accentuées sont
   alphanumériques dans la locale de la base et **survivent au découpage** (mesuré : `Audit Sécu!!`
   → `audit`, `sécu`).
2. Les fragments vides sont écartés.
3. Chaque fragment restant reçoit le suffixe `:*` et les fragments sont joints par ` & ` — donc
   **conjonction** : tous les mots saisis doivent être présents. Une palette qui rendrait l'union
   noierait la ligne cherchée dès le deuxième mot.
4. Si la chaîne obtenue est **vide**, la fonction rend zéro ligne **sans appeler `to_tsquery`**
   (M8).
5. Sinon `to_tsquery('app.francais_sans_accent', <chaîne>)` produit la requête. Le dictionnaire
   s'applique à chaque fragment — désaccentuation puis radicalisation — avant la pose du préfixe
   (M7).

L'échappement est structurel : après l'étape 1, un fragment ne contient **que** des caractères
alphanumériques. Aucun métacaractère de `tsquery` — `&`, `|`, `!`, `(`, `)`, `:`, `'` — ne peut
atteindre `to_tsquery`. Il n'y a donc pas d'injection possible par le terme, et ce n'est pas une
précaution de style : `to_tsquery` **lève une erreur** sur une syntaxe invalide, et une erreur
serveur à chaque frappe serait un défaut visible.

### 6.3 Volatilité, sécurité, privilèges

- **`stable`**, et non `volatile` : PostgREST n'expose en `GET` que les fonctions non volatiles, et
  la recherche lit. Non `immutable` non plus — le corps lit des tables. C'est la volatilité de
  `public.cards_figees` et de `public.mentionnables`, pour la même raison.
- **`SECURITY INVOKER`**, qui est le défaut et qui est ici **le point même de la fonction** (§1.3).
  Sa conversion en `DEFINER` est interdite : elle rendrait à chaque appelant les objets de tous.
- **`set search_path = ''`**, comme toute fonction du dépôt : tous les objets sont qualifiés.
- **Privilèges** : `revoke all … from public, anon` puis `grant execute … to authenticated,
  service_role`. La révocation nominative d'`anon` n'est pas redondante — `pg_default_acl` accorde
  `execute` à `anon` sur toute fonction neuve de `public`, et `revoke … from public` ne lui retire
  rien, `public` étant le pseudo-rôle. C'est la leçon payée par la migration `0053`
  (`docs/JOURNAL.md`, `CRM-062`). Sans cette ligne, un appelant anonyme obtiendrait `200 []` là où
  le contrat annonce `401`.

### 6.4 Titre et sous-titre, famille par famille

| `objet` | `titre` | `sous_titre` |
|---|---|---|
| `affaire` | `cards.title` | le nom du channel, `null` si l'appelant ne le lit pas |
| `contact` | `contacts.full_name` | le nom de l'organisation rattachée, sinon `contacts.email`, sinon `null` |
| `organisation` | `organizations.name` | `organizations.domain` |
| `commentaire` | le titre de l'affaire commentée, `null` si elle n'est pas lisible | le nom de l'auteur, `null` s'il n'est pas lisible |
| `message` | `mail_messages.subject` | `from_name`, sinon `from_address` |

Toutes les jointures de contexte sont des **jointures externes**. Le motif est le même qu'à la
décision 104 de `CRM-012` : une jointure interne transformerait une politique de lecture absente sur
la table de contexte en **disparition du résultat principal**, ce qui serait un refus par accident.
Le contexte manquant se dit par `null`, la ligne reste.

### 6.5 L'extrait

`extrait` n'est calculé que pour les familles qui portent un corps long — `commentaire` et
`message` — et vaut `null` pour les trois autres. Il est produit par `ts_headline` avec `StartSel` et
`StopSel` **vides** : la donnée rendue est du **texte pur**, sans balise à échapper côté client
(M11).

L'extrait est ensuite **replié** : `regexp_replace(…, '\s+', ' ', 'g')` puis `btrim`. M11 mesure
qu'un corps court est rendu en entier, retours à la ligne compris, et une palette n'affiche qu'une
ligne.

### 6.6 Ordre et bornes

- Ordre : `rang desc`, puis `titre` en `collate "fr-FR-x-icu"`, puis `id`. Le second et le troisième
  critère ne sont pas décoratifs : sans eux, deux lignes de rang égal — cas courant sur un terme
  trouvé une seule fois dans deux titres — s'ordonneraient au gré du plan d'exécution, et la palette
  changerait d'ordre d'une frappe à l'autre.
- `p_limite` est **borné à 50**. Une palette n'affiche pas cent lignes, et une borne côté serveur
  est la seule qui tienne : un client peut demander ce qu'il veut.
- `p_limite` nul, nul ou négatif : voir §6.7, lignes *g* et *h*.

### 6.7 Refus et cas limites — le contrat ligne à ligne

Chaque ligne est une assertion, et chacune est éprouvée par le §9.

| # | Situation | Réponse |
|---|---|---|
| *a* | appelant **anonyme** (clé `anon`) | **`401` / `42501`** — refus par le **privilège**, plus strict qu'une liste vide |
| *b* | `authenticated`, terme trouvé sur une ligne **lisible** | `200`, la ligne, `rang > 0` |
| *c* | `authenticated`, terme trouvé sur une ligne **non lisible** | `200 []` — zéro ligne, **jamais** une erreur |
| *d* | `p_terme` **nul** | `200 []` |
| *e* | `p_terme` **vide ou fait de blancs et de ponctuation** | `200 []`, et **aucun appel à `to_tsquery`** |
| *f* | `p_terme` **fait uniquement de mots vides** (`le la de`) | `200 []` |
| *g* | `p_limite` **nul, zéro ou négatif** | `200 []` |
| *h* | `p_limite` **supérieur à 50** | `200`, **au plus 50 lignes** |
| *i* | terme trouvé dans une ligne **effacée doucement** (`deleted_at` non nul) | `200 []` — la corbeille ne se cherche pas |
| *j* | terme trouvé dans **plusieurs familles** | `200`, les lignes des deux familles, **classées entre elles** |
| *k* | terme saisi **sans accent**, écrit **avec** | trouvé (§3.2) |
| *l* | terme saisi **avec accent**, écrit **sans** | trouvé (§3.2) |
| *m* | terme **préfixe** d'un mot du document | trouvé (M7) |
| *n* | **deux** mots saisis, un seul présent | `200 []` — la conjonction du §6.2 |
| *o* | clé de **service** | `200`, toutes les lignes ; `auth.uid()` est nul et la RLS ne filtre pas |

La ligne *i* mérite son motif : une affaire à la corbeille reste en base et reste lisible par la RLS
— c'est ce qui permet de la restaurer (`CRM-077`). L'exclure est donc une décision de la recherche,
pas une conséquence de la sécurité. Elle est écrite dans la requête, jamais dans l'index (§5.3).

---

## 7. Ce que la migration change, et ce qu'elle ne change pas

**Elle crée** : l'extension `unaccent`, la configuration `app.francais_sans_accent`, cinq index GIN,
une fonction `public.recherche_globale`, et son commentaire.

**Elle ne change RIEN d'autre.** Aucune table, aucune colonne, aucune politique, aucun privilège de
table, aucun trigger, aucune valeur. Les suites pgTAP des unités qui portent les cinq tables doivent
rester vertes **sans aucune modification** ; si l'une rougit, c'est cette migration qui a tort.

**Rejouabilité.** Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité
du répertoire à chaque démarrage (`docs/DAT.md` §3.2). Chaque objet est donc créé sous une forme
rejouable : `create extension if not exists`, `create index if not exists`,
`create or replace function`. La configuration de recherche n'a pas de forme `or replace` : elle est
protégée par un `do` qui la crée seulement si `pg_ts_config` ne la porte pas déjà.

**Rechargement du cache PostgREST.** Une fonction neuve reste invisible au cache de schéma :
`rpc/recherche_globale` rendrait `404 / PGRST202` sur une pile déjà démarrée. La migration se termine
donc par `notify pgrst, 'reload schema'`, sans effet si personne n'écoute.

---

## 8. Ce que la tranche 1 ne fait pas, et pourquoi

### 8.1 Ni tracks, ni channels, ni objectifs, ni budgets, ni modèles d'emails

Cinq familles, pas dix. Le motif n'est pas le temps : c'est que chaque famille ajoutée est un index
de plus sur une table de plus, et une ligne de plus au contrat du §6.4 — donc une preuve de plus.
Les cinq retenues sont celles qu'un utilisateur cherche par leur **texte**. Un track et un channel se
trouvent par la navigation, qui les énumère tous à l'écran ; les ajouter est un élargissement
mesurable, à décider quand la palette existera et qu'on saura ce qui manque.

**Écart nommé, non masqué** : chercher le nom d'un track ne rend rien aujourd'hui.

### 8.2 Aucune surface

Aucun écran, aucune capture d'écran, aucun test E2E d'interface. C'est la tranche 2 (§1.2).
L'absence est nommée plutôt que compensée par une preuve de substitution.

### 8.3 Aucune trace de recherche

Rien n'est journalisé : ni le terme, ni l'appelant, ni le nombre de résultats. Un terme de recherche
est une donnée personnelle au sens du §11 de `CLAUDE.md` — il dit ce qu'une personne cherche — et
rien dans le produit n'en a besoin aujourd'hui. Le jour où un historique serait demandé, il devra
l'être explicitement, avec sa durée de conservation.

### 8.4 Aucune tolérance à la faute de frappe, aucune sous-chaîne

Voir §3.2.

---

## 9. Preuves dues par la tranche 1

| Preuve | Ce qu'elle établit |
|---|---|
| `supabase/tests/0065_recherche_globale.test.sql` (pgTAP) | l'existence et la **forme** des objets — configuration, index, fonction, volatilité, `prosecdef` faux, `search_path` vide, ACL des trois rôles — puis les lignes *b* à *o* du §6.7 sous les **jetons simulés** des trois profils du seed |
| `e2e/api/recherche-globale.spec.ts` | le contrat du §6.7 **hors interface**, par HTTP, avec les **jetons réels** des trois profils et la clé anonyme — dont la ligne *a*, qu'un test pgTAP ne peut pas mesurer, le privilège d'exécution ne se voyant que depuis PostgREST |
| `npm run test:sql`, `npm run test:unit`, `npm run typecheck`, `npm run build` | l'absence de régression sur les suites existantes |

Une preuve d'interface n'est **pas** due par cette tranche (§8.2).

**Definition of Done de la tranche 1** : les objets sont créés et rejouables ; les quinze lignes du
§6.7 sont mesurées et vertes ; aucune suite pgTAP existante n'a été modifiée ; `docs/SCHEMA.md`,
`docs/PROD_MIGRATIONS.md`, `docs/BACKLOG.md` et `CHANGELOG.md` sont à jour dans le même changement.
