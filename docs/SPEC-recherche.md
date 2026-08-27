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

### M12 — `public.cards` PORTE DÉJÀ UNE RECHERCHE, ET ELLE EST VIVANTE

*Mesure ajoutée le 2026-08-27, trouvée par une assertion de la suite pgTAP qui figeait « aucune
colonne `tsvector` sur les cinq tables » et qui a rougi. Elle n'était pas au programme : c'est
l'assertion qui l'a imposée.*

```
information_schema.columns, data_type = 'tsvector', schéma public
  =>  cards.search_tsv   (GENERATED ALWAYS)
pg_indexes, table cards, GIN
  =>  cards_search_tsv_idx
```

`cards.search_tsv` est née avec la table, à la migration `0011` (`CRM-040`) :

```sql
search_tsv tsvector generated always as (
    to_tsvector('french', coalesce(title,'') || ' ' || coalesce(description,''))) stored
```

Et elle est **employée** : `webapp/src/lib/liste-cards.ts` filtre la vue liste par
`textSearch('search_tsv', …, { config: 'french' })`. Ce n'est donc pas une colonne morte.

**Trois conséquences, toutes écrites plutôt que découvertes plus tard.**

1. Le §5.1 ne peut pas dire « aucune colonne `tsvector` n'existe » — il dit « la tranche 1 n'en
   **ajoute** aucune », ce qui est la propriété qu'elle doit tenir. L'assertion a été **révisée** en
   ce sens, jamais retirée, motif écrit dans le fichier (mécanisme de la décision 51).
2. `public.cards` porte désormais **deux** index GIN, et c'est voulu : voir §5.4.
3. **La recherche de la vue liste est sujette à l'écart mesuré en M2** — elle emploie `french`, donc
   « creance » n'y trouve pas « créance ». Le défaut est **réel, mesuré, et ÉTRANGER à cette
   unité** : il appartient à `CRM-042`. Il est consigné à `docs/INCONSISTENCY_REPORT.md`, **INC-230**,
   et le comportement est **laissé inchangé** (`CLAUDE.md` §18, `docs/CloudWorker.md` §3.1).

### M13 — un commentaire ne suit PAS son affaire à la corbeille

*Mesure ajoutée le 2026-08-27, trouvée elle aussi par une assertion écrite avant le code qu'elle a
rendu nécessaire.*

`update public.cards set deleted_at = now()` sur `…0c1` — « Refonte du site vitrine » — puis
recherche sous l'administratrice :

```
'vitrine'   =>  2 lignes avant, 1 après   -- l'affaire sort, comme attendu
'gabarit'   =>  1 ligne  avant, 1 après   -- SON COMMENTAIRE RESTE
```

`public.card_comments` porte son **propre** `deleted_at`, que la mise à la corbeille de l'affaire ne
touche pas, et sa politique de lecture continue de le rendre. Une recherche qui rendrait ce
commentaire offrirait à la palette de la tranche 2 une **destination morte** — ce que le §5.10 de
`docs/DESIGN_SYSTEM.md` interdit. La ligne *i* du §6.7 est donc étendue au commentaire, et la
fonction porte la clause qui la tient.

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

La propriété que la tranche tient est donc « **elle n'en ajoute aucune** », et non « il n'en existe
aucune » : `public.cards` en porte une depuis `CRM-040` (M12).

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

### 5.4 `public.cards` porte deux index GIN, et c'est voulu

`cards_search_tsv_idx`, de `CRM-040`, sert la recherche **locale** de la vue liste — sans poids, en
`french`, sur `title` et `description` (M12). `cards_recherche_idx`, de cette tranche, sert la
recherche **transverse** — pondérée, en `app.francais_sans_accent`, sur `title`, `next_action` et
`description`.

Les deux répondent à des requêtes différentes et aucune ne peut servir l'autre : un index n'est
retenu que sur l'expression exacte qu'il porte (§5.2). Cette tranche ne touche **ni** la colonne
`search_tsv`, **ni** son index, **ni** l'écran qui les emploie. L'écart de vocabulaire entre les deux
recherches — la vue liste reste sujette à l'écart de M2 — est **consigné à INC-230** et **laissé
inchangé** : il appartient à `CRM-042`.

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
4. **Premier garde-fou** : si la chaîne obtenue est **vide**, la fonction rend zéro ligne **sans
   appeler `to_tsquery`** (M8). C'est le cas des lignes *d* et *e* du §6.7 — terme nul, vide, ou
   fait de blancs et de ponctuation.
5. **Second garde-fou** : si `to_tsvector('app.francais_sans_accent', p_terme)` est le vecteur
   **vide**, la fonction rend zéro ligne, toujours sans appeler `to_tsquery`. C'est le cas de la
   ligne *f* — un terme fait uniquement de mots vides français produit bien une chaîne
   `'le:* & la:*'` non vide, que l'étape 4 laisserait donc passer. Le contrôle passe par
   `to_tsvector` et non par `to_tsquery` parce que ce dernier **émet un `NOTICE`** dès que sa
   requête ne porte aucun lexème (M8) : ce serait une ligne de journal du serveur à **chaque
   frappe** d'une palette. `to_tsvector` emploie exactement les mêmes dictionnaires et n'émet rien.
6. Sinon `to_tsquery('app.francais_sans_accent', <chaîne>)` produit la requête. Le dictionnaire
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
| *i* | terme trouvé dans une ligne **effacée doucement** (`deleted_at` non nul), **ou dans un commentaire dont l'affaire l'est** | `200 []` — la corbeille ne se cherche pas |
| *j* | terme trouvé dans **plusieurs familles** | `200`, les lignes des deux familles, **classées entre elles** |
| *k* | terme saisi **sans accent**, écrit **avec** | trouvé (§3.2) |
| *l* | terme saisi **avec accent**, écrit **sans** | trouvé (§3.2) |
| *m* | terme **préfixe** d'un mot du document | trouvé (M7) |
| *n* | **deux** mots saisis, un seul présent | `200 []` — la conjonction du §6.2 |
| *o* | clé de **service** | `200`, toutes les lignes ; `auth.uid()` est nul et la RLS ne filtre pas |

La ligne *i* mérite son motif : une affaire à la corbeille reste en base et reste lisible par la RLS
— c'est ce qui permet de la restaurer (`CRM-077`). L'exclure est donc une décision de la recherche,
pas une conséquence de la sécurité. Elle est écrite dans la requête, jamais dans l'index (§5.3).

Sa **seconde moitié** vient de la mesure M13 : `card_comments` porte son propre `deleted_at`, que la
corbeille de l'affaire ne touche pas. Un commentaire d'affaire supprimée resterait donc trouvable et
mènerait, dans la palette de la tranche 2, à une destination morte. La condition est écrite en
`not exists` plutôt que sur la jointure externe du §6.4 : si l'affaire n'est pas lisible, la
sous-requête ne la voit pas non plus et le commentaire **reste** — le contexte manquant ne fait
jamais disparaître la ligne.

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

---

# TRANCHE 2 — LA PALETTE

*Chapitres §10 à §17, écrits le **2026-08-27** par la session planifiée `CloudWorker`, **avant la
première ligne de code** de la tranche (`CLAUDE.md` §5, `docs/CloudWorker.md` §3.2 point 3). Le §1.2
annonçait qu'elle serait « spécifiée dans son propre chapitre, après mesure » : les mesures sont au
§11, relevées sur la pile montée par `./runDev.sh` et seedée par `supabase/seed/apply-seed.sh`.*

## 10. Objet de la tranche 2, et son découpage

### 10.1 Ce qu'elle livre

La tranche 1 a livré un moteur que **rien n'appelle**. Le §8.2 le nomme sans détour : « aucun écran,
aucune capture, aucun test E2E d'interface ». La tranche 2 pose la surface qui manque : un champ de
recherche dans l'en-tête, ouvert par `Cmd+K` / `Ctrl+K`, une liste de résultats parcourue au clavier,
et **la navigation vers l'objet choisi**.

Le §4 du design system annonce cette surface **depuis `CRM-000`** — « En-tête : fil d'Ariane ·
recherche · Cmd+K · profil » —, et `webapp/src/app/Header.tsx` porte depuis `CRM-007` le commentaire
qui dit pourquoi elle n'existe pas : « aucun moteur ne la porte ». Ce motif est **tombé par
livraison**.

### 10.2 Le découpage en trois sous-tranches, écrit avant la première ligne de code

La tranche 2 est découpée, et le découpage suit la frontière qui rend chaque morceau **prouvable
seul** :

- **2a — le moteur d'appel.** Un module qui ne rend rien : il appelle la RPC, garde l'ordre des
  réponses, résout l'**adresse** de chaque résultat, et produit une destination par famille. Il se
  prouve **sans navigateur**, par des tests unitaires et par un contrat d'API. **Aucune surface.**
- **2b — la surface.** Le champ dans l'en-tête, le raccourci, la liste, la navigation clavier, les
  états, les captures, la suite E2E d'interface et le chapitre de `docs/manual.md`.
- **2c — l'inbox adressable.** `RouteInbox` honore le paramètre `?message=<id>` que le §13.5 arrête,
  de sorte qu'un résultat de la famille `message` mène **au message** et non à la racine de la boîte.

La frontière entre 2a et 2b est celle que `webapp/src/lib/mentions.ts` et
`webapp/src/lib/notifications.ts` tiennent déjà : « ce module ne rend rien : il lit et écrit. La
séparation est ce qui rend [le contrat] vérifiable **sans navigateur** ».

La frontière entre 2b et 2c a été nommée et **non masquée** pendant qu'elle tenait : entre les deux
livraisons, la destination d'un message était l'inbox, **son paramètre inerte**, et le §13.5
l'écrivait. **2c est livrée le 2026-08-27** — le paramètre est honoré, et l'écart est clos.

## 11. Mesures fondatrices de la tranche 2

Relevées le **2026-08-27**, pile montée et seedée, PostgreSQL **17.6**, PostgREST derrière Kong sur
`http://localhost:8000`, jetons obtenus par la **véritable route de connexion** de GoTrue. Aucune
ligne n'a été créée ni modifiée : toutes les mesures sont des **lectures**.

### M14 — LA RPC NE REND AUCUNE ADRESSE, ET C'EST LA MESURE QUI COMMANDE TOUTE LA TRANCHE

Le §6.1 donne sept colonnes : `objet`, `id`, `workspace_id`, `titre`, `sous_titre`, `extrait`,
`rang`. **Aucune n'est une adresse.** Relevé sur le terme `vitrine`, jeton de l'administratrice :

```json
[{"objet":"affaire","id":"5eed0000-…-0000000000c1","titre":"Refonte du site vitrine",
  "sous_titre":"Grands comptes","extrait":null,"rang":1},
 {"objet":"message","id":"4673c699-…","titre":"Demande de devis — refonte",
  "sous_titre":"bizdev@p2enjoy.test","extrait":"devis pour la refonte de notre site vitrine…","rang":0.2}]
```

Or `CHEMIN_CARD` vaut `/tracks/:slugTrack/:slugChannel/cards/:idCard` : **trois** segments variables
dont la RPC n'en donne qu'un. Et le terme `gabarit` rend un `commentaire` dont l'`id` est celui du
**commentaire**, jamais celui de l'affaire commentée :

```json
[{"objet":"commentaire","id":"5eed0000-…-0000000000d1","titre":"Refonte du site vitrine",
  "sous_titre":"Camille Aubert","extrait":"confirmé le périmètre de la refonte : trois gabarits, pas cinq"}]
```

Deux familles sur cinq — `affaire` et `commentaire` — exigent donc une **seconde lecture** pour être
atteignables. C'est le §13 qui l'écrit.

**Cette mesure n'ouvre PAS la tranche 1.** Ajouter une colonne d'adresse à la fonction changerait sa
signature, sa suite pgTAP, son contrat d'API et son témoin de types — pour porter dans le moteur de
recherche une composition d'URL qui est une affaire de **webapp**, et qui varierait le jour où une
route changerait. La base rend des identifiants ; l'adresse se compose là où les routes sont écrites.

### M15 — LA SECONDE LECTURE EST GROUPÉE, ET SON EMBARQUEMENT EST AMBIGU

`cards` porte **deux** clés étrangères vers `channels`, et PostgREST refuse l'embarquement nu :

```
GET /rest/v1/cards?id=in.(…)&select=id,channels(slug,tracks(slug))
=> 300 {"code":"PGRST201","message":"Could not embed because more than one relationship was found
        for 'cards' and 'channels'",
        "hint":"Try changing 'channels' to one of the following:
                'channels!cards_channel_id_workflow_id_fkey',
                'channels!cards_channel_id_workspace_id_fkey'"}
```

La relation est donc **nommée**, exactement comme `COLONNES_NOTIFICATION` le fait déjà depuis
`CRM-064` (`webapp/src/lib/colonnes-notifications.ts` ligne 45). Nommée, la lecture rend en **une
seule requête** l'adresse de toutes les affaires citées :

```
GET /rest/v1/cards?id=in.(…c1,…d022)
    &select=id,channels!cards_channel_id_workspace_id_fkey(slug,tracks(slug))
=> 200 [{"id":"…d022","channels":{"slug":"maintenance","tracks":{"slug":"studio-web"}}},
        {"id":"…c1","channels":{"slug":"grands-comptes","tracks":{"slug":"conseil-ia"}}}]
```

Et pour les commentaires, la même forme, à un niveau de plus :

```
GET /rest/v1/card_comments?id=in.(…d1)
    &select=id,card_id,cards(id,channels!cards_channel_id_workspace_id_fkey(slug,tracks(slug)))
=> 200 [{"id":"…d1","card_id":"…c1",
         "cards":{"id":"…c1","channels":{"slug":"grands-comptes","tracks":{"slug":"conseil-ia"}}}}]
```

**Ce n'est PAS `N + 1`.** C'est la mesure M8 de `docs/SPEC-notifications.md` §21, retrouvée ici : une
lecture groupée par `id=in.(…)` rapporte tous les objets cités d'une page en **une** requête. Le coût
d'une frappe est donc de **une à trois** requêtes — la RPC, plus au plus deux résolutions —, et non
d'une par résultat.

**`lireCheminCard` (`webapp/src/lib/inbox.ts`) n'est pas réemployée.** Elle fait **trois** lectures
séquentielles — `cards`, puis `channels`, puis `tracks` — pour **une seule** affaire : appliquée à
vingt résultats elle en ferait soixante. Elle reste juste pour son appelant, qui résout une affaire
à la fois ; elle ne l'est pas pour une palette.

### M16 — UN MESSAGE PORTE SON AFFAIRE QUAND IL EST CLASSÉ, ET RIEN QUAND IL NE L'EST PAS

```
GET /rest/v1/mail_messages?id=in.(6e5705de-…,4673c699-…)&select=id,card_id,classification
=> 200 [{"id":"4673c699-…","card_id":"5eed0000-…-0000000000c1","classification":"auto"},
        {"id":"6e5705de-…","card_id":null,"classification":"unclassified"}]
```

Les deux cas existent **dans le seed**, et ce n'est pas une chance : `docs/SPEC-seed.md` pose un
message non classé pour exercer le classement assisté. Une destination qui ne vaudrait que pour les
messages classés laisserait donc la moitié du seed sans issue. Le §13.5 en tire sa décision.

### M17 — UN TERME D'UNE SEULE LETTRE NE MET PAS LA BASE EN DIFFICULTÉ, ET LA BORNE SERVEUR SUFFIT

Quatre termes, jeton de l'administratrice, `p_limite=50` :

| Terme | Lignes rendues | Temps total de la requête HTTP |
|---|---|---|
| `a` | 33 | 0,027 s |
| `re` | 21 | 0,022 s |
| `ref` | 6 | 0,020 s |
| `refo` | 6 | 0,021 s |

**Aucune longueur minimale n'est donc posée à l'écran.** Une garde de saisie qui refuserait un terme
d'une lettre doublerait une contrainte que la base ne pose pas — ce que le §5.3 ter du design system
interdit sans exception — et interdirait de chercher une affaire nommée d'une seule lettre. Le §6.6
borne déjà le résultat à cinquante lignes **côté serveur**, et c'est la seule borne qui tienne.

*Portée de la mesure, et elle est nommée* : trente-trois lignes sur le seed ne disent rien d'une base
peuplée. Ce qui est mesuré est que le **produit local** ne souffre pas ; ce qui protège une base
peuplée est la borne du §6.6 et l'index GIN du §5, pas cette table.

### M18 — LE GÉNÉRATEUR DE TYPES DÉCLARE `titre`, `sous_titre` ET `extrait` NON NULS, ET IL A TORT

`webapp/src/lib/database.types.ts` ligne 2971 :

```ts
recherche_globale: {
  Args: { p_limite?: number; p_terme: string }
  Returns: { extrait: string; id: string; objet: string; rang: number
             sous_titre: string; titre: string; workspace_id: string }[]
}
```

Or le §6.1 rend `sous_titre` et `extrait` **nullables par contrat**, et `titre` peut être nul pour un
commentaire dont l'affaire n'est pas lisible (§6.4). La mesure M1 ci-dessus le confirme :
`"extrait": null` sur les trois familles courtes. **Un type ne garantit jamais une valeur**
(`docs/SPEC-types.md`), et le module de 2a lit donc ces trois colonnes comme **potentiellement
nulles**, sans se fier à la déclaration.

### M19 — L'ASYMÉTRIE DU SEED EST VISIBLE SUR UN SEUL TERME, ET C'EST CE QUI REND LA SURFACE PROUVABLE

Terme `sogexia`, `p_limite=20`, **deux jetons réels** :

| Appelante | Lignes | Objets rendus |
|---|---|---|
| `admin@p2enjoy.test` | **4** | organisation `Sogexia`, puis trois affaires |
| `viewer@p2enjoy.test` | **3** | organisation `Sogexia`, puis **deux** affaires |

L'affaire manquante est `Migration ERP Sogexia`, du track `Grands comptes`, fermé à la lectrice
(M6). Un **seul** terme exerce donc les cinq familles côté lecture et la RLS côté refus, dans la même
frappe — c'est le terme que la preuve E2E de 2b emploie, et la contre-épreuve est le compte, jamais
la seule présence : sans elle, un écran qui n'afficherait **rien** passerait le refus.

## 12. Où la surface vit, et pourquoi

### 12.1 Dans l'en-tête, jamais dans la barre latérale

Le §4 du design system range dans la barre latérale les **destinations** — les surfaces où l'on va
travailler. Une recherche n'en est pas une : on l'ouvre, on suit un résultat, et on est ailleurs.
C'est exactement le raisonnement que `CRM-064` a tenu pour la cloche (§5.43), et il est ici plus fort
encore : la palette **n'a pas d'écran à elle**, elle n'est qu'un chemin.

Elle vit donc dans l'en-tête, **entre le fil d'Ariane et le contexte d'espace de travail**, à la
place que le §4 lui donne depuis `CRM-000`. L'ordre de la ligne devient : fil d'Ariane, recherche,
contexte, cloche, identité. Le §5.43 a posé le sens de la fin de cette ligne — « ce que le produit a
à me dire précède qui je suis, et le geste qui sort du produit ferme la ligne » ; la recherche vient
**avant** parce qu'elle porte sur le produit entier et non sur l'utilisateur.

### 12.2 Aucune modale, et le §5 du design system n'en déclare toujours aucune

`CRM-043`, `CRM-075`, `CRM-079`, `CRM-060` et `CRM-064` l'ont tranché **cinq** fois : une surface qui
recouvre l'écran demanderait un piège de focus, une gestion d'`Échap` et le voile `--color-veil` —
trois mécanismes qu'aucune unité n'a spécifiés.

**Une palette de commandes est le cas où l'on est le plus tenté d'y déroger**, l'usage du marché
étant une fenêtre centrée sur un voile. La tranche n'y déroge pas, et le motif n'est pas la
conformité : c'est que **le voile cacherait l'écran d'où l'on cherche**. Le §5.23 l'a écrit pour le
carnet — « une modale recouvrirait la liste que l'on vient de lire, or cette liste est précisément ce
qui dit si le contact existe déjà » —, et la palette est le cas général de ce raisonnement : on
cherche **depuis** quelque part, et ce quelque part est le contexte de ce qu'on cherche.

La palette est donc un **panneau ancré à l'en-tête**, dans le flux du document, sur le patron exact
du §5.43. Elle ne piège aucun focus, `Échap` la referme, un clic hors d'elle la referme, et le champ
reste rendu dessous.

### 12.3 Ancré à l'EN-TÊTE, jamais au champ

C'est la règle que le §5.43 a payée par un défaut trouvé en regardant une capture : « le repère de
positionnement est le conteneur pleine largeur, jamais le contrôle ». Elle est reprise **sans
mesure nouvelle**, parce qu'elle est déjà mesurée : ancré sur le champ, un panneau proche d'un bord
sort de l'écran par le côté opposé, et `scrollWidth > clientWidth` ne le voit pas.

## 13. Ce que le moteur de 2a produit — le contrat

### 13.1 Une lecture, puis au plus deux résolutions

```
1. rpc('recherche_globale', { p_terme, p_limite })          → les lignes du §6.1
2. si au moins un objet 'affaire'     : GET cards?id=in.(…) → l'adresse de chacune
3. si au moins un objet 'commentaire' : GET card_comments?id=in.(…) → l'adresse de son affaire
```

Les étapes 2 et 3 sont **omises** quand leur famille est absente du résultat : une frappe qui ne rend
que des contacts n'émet **qu'une** requête. Elles sont émises **en parallèle** l'une de l'autre —
elles ne se conditionnent pas —, et jamais avant que l'étape 1 ait rendu : on ne sait pas quoi
résoudre avant de savoir ce qui a été trouvé.

### 13.2 L'ORDRE DES RÉPONSES EST GARDÉ PAR UN RANG, ET C'EST LA RÈGLE LA PLUS IMPORTANTE DU MODULE

Une palette émet une requête par frappe utile. Rien ne garantit que la réponse à `refonte` arrive
après celle de `refont` : deux requêtes concurrentes sur le réseau reviennent dans l'ordre que le
réseau décide. Sans garde, la liste afficherait le résultat d'un terme que l'utilisateur a déjà
dépassé — un état qu'il a vu et qui n'existe plus, exactement ce que le §5.45 du design system
proscrit pour une case cochée par anticipation.

**Chaque recherche porte donc un rang croissant, et une réponse dont le rang n'est pas le dernier
émis est JETÉE.** Elle n'est ni affichée, ni comptée, ni journalisée. C'est une propriété du module,
donc prouvable **sans navigateur** : le test unitaire fait revenir deux réponses dans l'ordre inverse
de leur émission et vérifie que c'est la **dernière émise** qui gagne.

### 13.3 UN DÉLAI DE FRAPPE, SA VALEUR, ET CE QU'IL N'EST PAS

Le module attend **200 ms** de silence au clavier avant d'émettre. Ce n'est **pas** la temporisation
arbitraire que `CLAUDE.md` §18 interdit : celle-là masque une erreur ou simule un succès, celle-ci ne
masque rien et n'affirme rien. Elle réduit un nombre de requêtes — sept pour `refonte` frappé lettre
à lettre, une avec le délai — et sa valeur est écrite ici pour qu'elle soit **un contrat**, pas un
réglage caché.

**Le délai ne remplace pas la garde du §13.2**, et l'ordre des deux règles est délibéré : deux
frappes séparées de plus de 200 ms émettent bien deux requêtes concurrentes, et c'est le rang qui les
départage. Une session qui retirerait le rang « puisqu'il y a un délai » rouvrirait le défaut.

### 13.4 La destination, famille par famille

| `objet` | Destination | Comment l'adresse est obtenue |
|---|---|---|
| `affaire` | la fiche de l'affaire — `CHEMIN_CARD` | résolution du §13.1 étape 2 |
| `commentaire` | la fiche de l'affaire **commentée** | résolution du §13.1 étape 3 |
| `contact` | `cheminContact(id)` | l'`id` rendu par la RPC **suffit** |
| `organisation` | `cheminOrganisation(id)` | l'`id` rendu par la RPC **suffit** |
| `message` | `/inbox?message=<id>` | l'`id` rendu par la RPC **suffit** — voir §13.5 |

**Un commentaire mène à son affaire, jamais à lui-même** : aucune adresse du produit ne désigne un
commentaire, et le fil de l'affaire est l'endroit où il se lit (§5.10, §5.11 du design system). La
tranche 1 a préparé exactement cela en excluant de la recherche le commentaire d'une affaire à la
corbeille (§6.7 ligne *i*, mesure M13) : sans cette clause, la palette aurait offert une
**destination morte**.

**Une famille dont l'adresse ne se résout pas rend une ligne SANS LIEN, jamais rien.** La ligne garde
son titre, son sous-titre et son extrait ; elle perd sa destination. C'est la règle du §5.37 du
design system pour une affaire figée que la seconde lecture n'a pas rapportée — « la masquer
retrancherait une affaire de la liste qui existe pour les montrer ; lui donner un lien vers une
adresse incomplète mènerait à un écran que l'utilisateur croirait cassé ». Le cas n'est pas
théorique : les deux lectures ne sont pas atomiques.

### 13.5 LE MESSAGE MÈNE À L'INBOX, ET SON ADRESSE PORTE LE MESSAGE

`/inbox` ne prend aujourd'hui **aucun paramètre** : la sélection d'un dossier et d'un message est un
état interne de `RouteInbox`, que rien dans l'URL ne porte. Trois issues ont été pesées :

1. **mener à l'affaire du message.** Écartée par M16 : un message sur deux du seed n'a **pas**
   d'affaire, et cette destination laisserait la moitié de la famille sans issue. Elle serait en
   outre fausse dans son principe — on a cherché un **message**, pas une affaire ;
2. **mener à `/inbox` sans rien désigner.** Écartée : l'utilisateur arriverait sur une boîte où il
   devrait retrouver **à la main** ce que la palette venait de lui montrer. C'est la commande morte
   du §5.10, sous sa forme la plus frustrante — elle a bien mené quelque part, mais pas à l'objet ;
3. **mener à `/inbox?message=<id>`**, l'inbox honorant le paramètre. **Retenue.**

Le paramètre est arrêté **ici**, dans la tranche 2a, et il est **stable par contrat** : `message`,
la valeur étant l'identifiant du message. La sous-tranche **2c** le fait honorer par `RouteInbox`.

**LE PARAMÈTRE EST HONORÉ DEPUIS LE 2026-08-27** (sous-tranche 2c, §15) : le message désigné
s'ouvre, dans le dossier que son classement décide. Entre les deux livraisons il fut **INERTE**, et
l'écart était nommé plutôt que masqué (`docs/BACKLOG.md`, `docs/manual.md`) : l'utilisateur arrivait
sur l'inbox sans sélection — une destination non pas morte, l'écran existant et portant ce qu'il
cherchait, mais **imprécise**. Le dire valait mieux que de choisir l'issue 1, fausse pour la moitié
des messages.

### 13.6 Le module ne bifurque JAMAIS sur un rôle

`CLAUDE.md` §10. La RPC est `SECURITY INVOKER` (§6.3) et le refus est **zéro ligne** (§1.3) : le
module n'a aucun droit à calculer, aucune famille à masquer et aucun message de refus à mettre en
scène. Une liste vide est l'état vide **ordinaire** du §5.8, jamais un refus.

La seule erreur qu'il classe est celle du transport, par `classerErreur` (`webapp/src/lib/async.ts`),
comme tout module de lecture du dépôt.

## 14. Ce que la surface de 2b rend

Ce que la surface a l'air est écrit dans **`docs/DESIGN_SYSTEM.md` §5.46**, spécifié avant code dans
le même changement que ce chapitre. Ce qui suit ne dit que ce que la surface **fait**.

### 14.1 Le raccourci

`Cmd+K` sur macOS, `Ctrl+K` ailleurs — la même touche, le modificateur de la plateforme. Le
gestionnaire est posé sur le document et **annule l'événement** : `Ctrl+K` est, dans certains
navigateurs, un raccourci de la barre d'adresse, et ne pas l'annuler ferait ouvrir deux choses à la
fois.

Il est **actif partout dans l'application connectée**, y compris quand le focus est dans un champ de
saisie : c'est la convention de toutes les palettes, et un raccourci qui cesserait de fonctionner
pendant qu'on écrit un commentaire serait inutilisable là où l'on en a le plus besoin.

Il est **inactif sans session** : l'en-tête ne rend alors pas le champ (§14.5), et un raccourci qui
ouvrirait une surface absente serait la commande morte du §5.10.

`Échap` referme et rend le focus au champ ; le champ vidé et refermé, le focus revient à l'élément
qui l'avait avant l'ouverture — c'est ce que le §5.13 exige de toute surface qui s'ouvre.

### 14.2 Ce que le champ envoie, et quand

Le champ est un `input` de type `search` avec son libellé, jamais un `div` piloté au clavier. Il
envoie selon le §13.3 : 200 ms après la dernière frappe. Le terme est envoyé **tel quel**, sans
nettoyage à l'écran : le §6.2 pose que la normalisation est « entièrement écrite [en base] et ne
dépend d'aucune saisie du client », et en poser une seconde à l'écran ferait deux définitions du même
découpage.

`p_limite` vaut **20**, le défaut de la fonction (§6.1). Ce n'est pas la borne — celle-ci vaut 50 et
vit au serveur (§6.6) — c'est ce qu'une liste ancrée à un en-tête peut montrer sans devenir un écran.
La **troncature est écrite** quand la liste est pleine, jamais laissée à deviner : c'est la règle du
§5.43 pour « les 20 plus récentes » et du §5.15 pour « 3 affaires listées sur 13 ».

### 14.3 La navigation clavier

| Touche | Effet |
|---|---|
| `Cmd+K` / `Ctrl+K` | ouvre la palette et porte le focus dans le champ ; **rouvre-la si elle est ouverte** en resélectionnant le texte, jamais ne la referme |
| `Flèche bas` | descend d'un résultat ; depuis le dernier, revient au premier |
| `Flèche haut` | monte d'un résultat ; depuis le premier, va au dernier |
| `Entrée` | suit le résultat **actif** ; sans résultat actif, ne fait rien |
| `Échap` | referme et rend le focus (§14.1) |

**Le focus ne quitte JAMAIS le champ**, et c'est la règle qui décide la forme : les flèches déplacent
un **résultat actif**, pas le focus. Un focus qui descendrait dans la liste ferait perdre la frappe
suivante — l'utilisateur corrige son terme en permanence, c'est le geste même d'une palette. La liste
est donc reliée au champ par `aria-activedescendant`, le patron ARIA d'une `combobox` à liste, et
chaque résultat porte son `id`.

**Aucune boucle silencieuse** : le passage du dernier au premier est un **choix écrit**, motivé par
le nombre borné de résultats (§14.2) ; sur vingt lignes au plus, revenir en haut est plus court que
de remonter.

### 14.4 Les quatre états du §5.8, et le vide qui n'est pas une panne

| État | Ce que la palette rend |
|---|---|
| terme vide | **aucune liste**, et une phrase qui dit ce que la recherche cherche — ce n'est pas un vide, c'est l'état d'arrivée |
| chargement | `aria-busy`, et **la liste précédente reste affichée** — voir ci-dessous |
| erreur | la mention et son **action de reprise**, qui rejoue la même recherche |
| vide | « aucun résultat pour ce terme », **sans action** — l'écart au §5.8 que le §5.16, le §5.19 et le §5.43 prennent déjà |
| peuplé | les lignes, dans l'ordre du serveur (§6.6), **jamais retriées** |

**LA LISTE PRÉCÉDENTE RESTE AFFICHÉE PENDANT LA RECHERCHE SUIVANTE, et c'est un écart au §5.8 qui est
motivé.** Le §5.8 demande des squelettes ; ils sont justes au **premier** chargement, seul moment où
il n'y a rien à montrer — c'est exactement la règle que le §5.29 tranche 2c a écrite pour la liste des
tableaux d'objectifs : « le squelette reste réservé au premier chargement ». Ici la frappe suivante
arrive 200 ms après la précédente : remplacer la liste par un squelette à chaque lettre la ferait
**clignoter** à chaque frappe, ce que le §6 du design system interdit.

### 14.5 Sans session, rien n'est rendu

Comme la cloche (§5.43, mesuré au §26.7 de `docs/SPEC-notifications.md`) : la RPC refuse l'anonyme
par le **privilège** — `401` / `42501`, ligne *a* du §6.7 —, et un champ offert à un anonyme
promettrait une recherche que la base refuse. L'en-tête rend « Se connecter » à sa place (§5.12).

### 14.6 Ce que la surface ne fait pas

- **aucun historique de recherche**, ni en session, ni persistant. Le §8.3 l'a déjà tranché pour la
  base, et le motif vaut à l'écran : un terme de recherche dit ce qu'une personne cherche, et le §11
  de `CLAUDE.md` borne le stockage sur l'appareil au strictement nécessaire ;
- **aucune suggestion, aucune complétion, aucune correction de frappe** — le §8.4 ;
- **aucun filtre par famille.** Cinq bascules pour cinq familles surmonteraient une liste qui en
  compte souvent une seule : c'est le contrôle sans objet que le §5.11 du design system refuse pour
  la barre de filtres d'un fil vide ;
- **aucune action sur un résultat.** La palette mène, elle n'agit pas. C'est la règle du §5.14 et du
  §5.36 : un second chemin d'écriture serait une seconde définition du même geste.

## 15. Ce que 2c livre

`RouteInbox` lit le paramètre `message` de la chaîne de requête **au montage**, et **une seule
fois** : la sélection est ensuite un état de l'écran, et relire le paramètre à chaque rendu
ramènerait l'utilisateur au message de départ à chaque clic.

Le message désigné est lu ; son `card_id` décide du dossier retenu — l'affaire quand il est classé,
« Non classés » sinon (M16) —, et le message est ouvert. **Un identifiant inconnu, ou un message que
l'appelant ne peut pas lire, ne rend AUCUNE erreur** : l'inbox s'ouvre sans sélection, comme si le
paramètre était absent. C'est la règle de discrétion du §7 de `docs/SPEC-permissions-rls.md` — un
refus ne se distingue pas d'une absence — et c'est aussi le comportement le moins surprenant : on
arrive sur sa boîte.

Le paramètre est **retiré de l'adresse** une fois honoré, par un remplacement d'historique : le
laisser ferait rouvrir le même message au rechargement de la page, longtemps après que l'utilisateur
soit passé à autre chose.

### 15.1 LE PARAMÈTRE EST RETIRÉ MÊME QUAND IL N'EST PAS HONORÉ

*Point complété le 2026-08-27, avant la première ligne de code de 2c (`CLAUDE.md` §5) : le §15 disait
le retrait « une fois honoré » et laissait le cas du refus sans réponse. Les deux issues ont été
pesées, et c'est le RETRAIT INCONDITIONNEL qui est retenu.*

Un identifiant inconnu, mal formé ou fermé par la RLS laisse l'écran **exactement** dans l'état d'une
arrivée sans paramètre — c'est ce que le §15 exige — et **l'adresse fait partie de cet état**. La
barre d'adresse est visible : y laisser `?message=<id>` après un refus dirait à l'utilisateur qu'il
s'est passé là quelque chose que l'écran ne montre pas, ce qui est précisément ce que la règle de
discrétion évite. Le retrait est donc décidé par le **traitement** du paramètre, jamais par son
succès, et l'écran est indiscernable dans les deux cas.

Le retrait a une seconde conséquence, utile : un rechargement ne rejoue pas la lecture infructueuse.

**Ce que cette règle n'autorise pas** : elle ne rend aucun autre paramètre de l'adresse. Le retrait
est écrit comme le `sommeil` du board (`docs/SPEC-cards.md` §16.12.4) — une copie de
`URLSearchParams`, la seule clé concernée supprimée, les autres conservées.

## 16. Ce que la tranche 2 ne fait pas

### 16.1 Elle n'ajoute aucune famille

Le §8.1 tient sans changement : ni tracks, ni channels, ni objectifs, ni budgets, ni modèles
d'emails. La palette existant enfin, l'élargissement pourra se décider **sur constat** plutôt que sur
supposition — c'est ce que le §8.1 annonçait.

### 16.2 Elle ne touche NI la migration, NI la fonction, NI sa suite pgTAP

Aucune ligne de `supabase/` n'est modifiée. La tranche 1 est close sur son comportement, et M14 dit
pourquoi l'adresse ne remonte pas en base.

### 16.3 Elle ne referme pas INC-230

La recherche **locale** de la vue liste emploie toujours `french` et reste sujette à l'écart de M2.
Deux recherches du produit ont deux vocabulaires, l'arbitrage est en attente, et cette tranche
**laisse le comportement inchangé** (`CLAUDE.md` §18, `docs/CloudWorker.md` §3.1).

## 17. Preuves dues par la tranche 2

| Preuve | Sous-tranche | Ce qu'elle établit |
|---|---|---|
| `webapp/src/lib/recherche.test.ts` | 2a | la garde d'ordre du §13.2, le délai du §13.3, la destination des cinq familles du §13.4, la ligne sans lien du §13.4, et les colonnes nulles de M18 |
| `e2e/api/recherche-palette.spec.ts` | 2a | les deux lectures de résolution du §13.1 **hors interface**, avec les jetons réels — dont l'ambiguïté d'embarquement de M15, qu'un test unitaire ne peut pas voir |
| `e2e/ui/recherche.spec.ts` | 2b | l'ouverture au raccourci, la navigation clavier du §14.3, les quatre états du §14.4, la navigation vers l'objet, et **l'asymétrie de M19 par son COMPTE** |
| captures sous `docs/captures/CRM-065/` | 2b | l'apparence réelle aux paliers 1440 et 390, **observées** (`CLAUDE.md` §16) |
| `e2e/ui/inbox.spec.ts` (complétée) | 2c | le paramètre honoré, et l'identifiant inconnu qui n'est pas une erreur |
| `npm run test:unit`, `typecheck`, `build`, `test:sql`, `e2e:api` | toutes | l'absence de régression |

**Definition of Done de la tranche 2** : les trois sous-tranches sont livrées ; la palette s'ouvre au
clavier, se parcourt au clavier et **mène à l'objet** pour les cinq familles ; les captures sont
produites **et observées** ; `docs/DESIGN_SYSTEM.md`, `docs/manual.md`, `docs/BACKLOG.md` et
`CHANGELOG.md` sont à jour dans le même changement.

Une sous-tranche livrée sans ses preuves laisse l'unité en `[~]`, et l'écart est **nommé**.
