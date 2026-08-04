# P2Enjoy CRM

CRM de suivi de projets commerciaux, organisé en **Tracks** → **Channels** → **Cards**, avec
workflows à transitions contraintes, formulaires conditionnels par étape, et une messagerie
intégrée (IMAP entrant / SMTP sortant) qui classe les emails dans les cards.

> **État d'avancement — lisez ceci en premier.**
> Sont livrés et vérifiés : la **pile d'exécution** (`CRM-001`, `CRM-002`), les **migrations
> d'amorçage** et leur refus par défaut (`CRM-003`), le **chiffrement des secrets** (`CRM-004`),
> les **fonctions d'autorisation** (`CRM-010`), l'**authentification** (`CRM-011`), le **seed
> socle** (`CRM-005`), les **types générés** (`CRM-006`), le **squelette de la webapp**
> (`CRM-007`), le **harnais de tests** (`CRM-008`), les **tracks** (`CRM-020`), les **channels**
> (`CRM-021`), le **catalogue de nœuds** (`CRM-030`) et les **workflows** (`CRM-031`).
> En revanche, **le reste du métier n'existe pas encore** : ni cards, ni formulaires,
> ni messagerie — et **aucun écran de connexion**, qu'aucune unité ne porte à ce jour
> (`docs/INCONSISTENCY_REPORT.md`, INC-021).
> **Conséquence à connaître avant de lancer l'application** : les tracks et leurs channels
> existent réellement côté serveur, sont ordonnés, archivables, cloisonnés, et leur écriture est
> réservée aux administrateurs — tout cela est mesuré. Mais l'interface interroge le serveur
> **sans compte**, et le serveur ne consent rien à un appelant anonyme. L'écran affiche donc
> « Aucun track », et la route d'un track affiche « Track introuvable » pour tout identifiant :
> c'est le refus réel du backend et non un défaut d'affichage. Tant qu'INC-021 n'est pas tranchée, **aucune
> donnée métier ne peut apparaître à l'écran**.
> Les commandes marquées « à venir » dans le tableau du §5 sont le **contrat** que
> l'implémentation devra respecter, pas un état constaté.
> L'état réel, unité par unité, est tenu dans [`docs/BACKLOG.md`](docs/BACKLOG.md) ; l'ordre
> d'exécution dans [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md).
> Une commande n'est documentée comme « disponible » qu'une fois exécutée et vérifiée.

## 1. Objectif

Suivre des projets, clients ou sujets commerciaux dans une arborescence libre :

- un **Workspace** cloisonne une entité (membres, tracks, workflows, boîtes mail) ;
- un **Track** (« Chaîne YouTube », « Eventos », « Blog ») regroupe des channels ;
- un **Channel** (« Vidéos promotionnelles », « Sponsorships », « Prestataires métiers de
  bouche ») porte **son propre workflow** ;
- une **Card** représente un projet, un client ou un sujet ; elle avance dans le workflow du
  channel, accepte des commentaires libres, et possède **sa propre adresse email**.

La messagerie est un citoyen de première classe : les emails reçus sur l'adresse d'une card y
sont classés automatiquement avec leurs pièces jointes, tout en restant visibles dans une inbox
globale où Tracks, Channels et Cards apparaissent comme des dossiers imbriqués — dossiers
réellement créés côté serveur IMAP.

## 2. Stack

| Couche | Technologie |
|---|---|
| Interface | React 19, Vite 8, TypeScript, Tailwind CSS 4, lucide-react, React Router 8 ; TanStack Query, react-hook-form, zod et dnd-kit viendront avec le métier qui les exige |
| Backend | Supabase **self-hosted** (PostgreSQL 17, GoTrue, PostgREST, Realtime, Storage, Kong, Supavisor) |
| Règles métier | PostgreSQL : fonctions `SECURITY DEFINER` + Row Level Security |
| Messagerie | Service Python `mail-sync` (IMAP IDLE, file d'envoi SMTP, ordonnanceur) |
| Antivirus | ClamAV (pièces jointes entrantes) |
| Stockage | Supabase Storage sur S3 (MinIO en développement) |
| Tests | pgTAP (SQL), Vitest (webapp), pytest (mail-sync), Playwright (API, UI, mail) |
| Exécution | Docker Compose ; Caddy en production |

Les règles d'accès sont appliquées **côté base**. L'interface ne fait que refléter ce que le
backend autorise (voir [`docs/SPEC-permissions-rls.md`](docs/SPEC-permissions-rls.md)).

## 3. Prérequis

- Docker et Docker Compose v2 (`docker compose version`)
- Node 24 (voir `.nvmrc`) et npm 11+
- Environ 8 Go de RAM disponibles pour la pile complète
- Aucun service cloud n'est requis en développement : la pile est autonome.

## 4. Installation

```bash
./runDev.sh
```

C'est tout. Au premier lancement, `runDev.sh` crée `.env` à partir de `.env.example` et **tire au
hasard** chaque secret : mot de passe PostgreSQL, `JWT_SECRET`, clés MinIO, secrets de Realtime et
du pooler. `ANON_KEY` et `SERVICE_ROLE_KEY` sont dérivées du `JWT_SECRET` produit, sous forme de
jetons HS256 valides. **Aucune clé n'est reprise du dépôt** : deux postes n'ont jamais les mêmes.

Le fichier est créé en mode `600` et n'est jamais versionné. Un `.env` existant n'est jamais
écrasé.

Amorçage manuel, si l'on préfère garder la main :

```bash
cp .env.example .env          # puis remplacer chaque valeur CHANGE_ME_*
./runDev.sh
```

`.env.example` documente chaque variable : rôle, format, caractère obligatoire, et valeur
d'exemple non sensible. Deux conventions y ont force de contrat, et les scripts les appliquent :

- une valeur `CHANGE_ME_*` **doit** être remplacée — `runDev.sh` la remplace, `runProd.sh` refuse
  de démarrer tant qu'il en reste une ;
- une valeur **vide** signale une variable facultative ; toute autre variable doit être
  renseignée.

`npm install` installe les dépendances de la racine — le dépôt n'a **qu'un seul projet npm**, et
Vite prend `webapp/` pour racine par sa configuration. Le `package.json` porte les commandes de
`CRM-006` (types, compilation) et celles de `CRM-007` (développement, build, tests).
**Aucun alias `npm` des scripts de lancement n'existe** :
la question d'une façade `npm` par-dessus `runDev.sh` et consorts reste ouverte, voir
[`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md), INC-008.

## 5. Commandes principales

| Commande | Effet | État |
|---|---|---|
| `./runDev.sh` | Amorce `.env` si besoin, puis démarre la pile de développement | **disponible** |
| `./runDev.sh --dev` | Idem sans la webapp conteneurisée (utile si Vite tourne dans l'IDE) | **disponible** |
| `./runDev.sh --withLog <composant>` | Démarre puis suit les journaux d'un composant (`supabase`, `webapp`, `mail-sync`, `stalwart`) | **disponible** |
| `./runDev.sh --bootstrap` | Amorce `.env` et s'arrête, sans rien démarrer | **disponible** |
| `./runDev.sh --stop` | Arrêt propre de la pile de développement, volumes conservés | **disponible** |
| `./runProd.sh` | Démarre l'assemblage de production (sans outillage de développement, TLS via Caddy) | **disponible** |
| `./runProd.sh --stop` | Arrêt propre de l'assemblage de production | **disponible** |
| `./resetMe.sh` | Détruit la base et les volumes locaux, redémarre à froid, rejoue migrations et seed | **disponible** |
| `scripts/verify-stack.sh` | Rejoue les preuves de la pile : santé des services, passerelle, Studio, absence d'outillage en production, chaîne de stockage | **disponible** |
| `scripts/verify-scripts.sh` | Rejoue les preuves des scripts : contrat `.env.example`, amorçage, gardes de profil | **disponible** |
| `scripts/verify-migrations.sh` | Rejoue les preuves des migrations : suite pgTAP, idempotence, refus par défaut mesuré hors interface | **disponible** |
| `scripts/verify-vault.sh` | Rejoue les preuves du chiffrement des secrets : extensions de l'image, chiffrement effectif, cloisonnement par rôle, cycle de vie de la clé racine | **disponible** |
| `scripts/verify-authz.sh` | Rejoue les preuves des fonctions d'autorisation : suite pgTAP, idempotence, comportement sous PostgREST avec des jetons réels | **disponible** |
| `npm run db:migrate` | Applique les migrations en attente | à venir (`CRM-003`) |
| `supabase/seed/apply-seed.sh` | Applique le seed socle sur la pile de développement | **disponible** |
| `scripts/verify-seed.sh` | Rejoue les preuves du seed : contrat, identifiants stables, connexion réelle, convergence | **disponible** |
| `npm run db:seed` | Rejoue le seed de démonstration | à venir (INC-008, arbitrage ouvert) |
| `npm run types:generate` | Régénère les types TypeScript depuis le schéma de la base migrée | **disponible** |
| `npm run types:check` | Vérifie que les types versionnés n'ont pas dérivé du schéma, sans rien réécrire | **disponible** |
| `npm run typecheck` | `tsc --noEmit` sur les quatre projets : types générés, application, tests, outillage | **disponible** |
| `scripts/verify-types.sh` | Rejoue les preuves des types générés : déterminisme, garde anti-dérive éprouvée par le fichier **et par le schéma**, assertions | **disponible** |
| `npm run dev` | Vite en développement, hors conteneur | **disponible** |
| `npm run build` | Build de production de la webapp vers `webapp/dist` | **disponible** |
| `npm run preview` | Sert le build produit, utilisé par les preuves E2E | **disponible** |
| `npm run test:unit` | Tests unitaires de la webapp (Vitest) | **disponible** |
| `npm run e2e:ui` | Scénarios E2E de l'interface et captures (Playwright) | **disponible** |
| `scripts/verify-webapp.sh` | Rejoue les preuves du squelette : build, jetons, états, clavier, captures | **disponible** |
| `scripts/verify-harness.sh` | Rejoue les preuves du harnais de tests : exécuteurs, projets, non-complaisance | **disponible** |
| `scripts/verify-tracks.sh` | Rejoue les preuves des tracks : modèle, ordre, archivage, politiques RLS, seed, non-complaisance | **disponible** |
| `scripts/verify-channels.sh` | Rejoue les preuves des channels : modèle, cloisonnement par clé composite, ordre par track, archivage, politiques RLS, seed, non-complaisance | **disponible** |
| `scripts/verify-catalogue.sh` | Rejoue les preuves du catalogue de nœuds : modèle, bornes, ordre par workspace, archivage, politiques RLS, seed, non-complaisance | **disponible** |

Les trois scripts acceptent `--help`. Ils s'appuient sur le fichier `.env` de la racine, ou sur
celui que désigne la variable `P2ENJOY_ENV_FILE` — ce qui permet aux preuves de travailler sur un
fichier jetable sans toucher à la configuration du poste.

L'arrêt propre passe par `./runDev.sh --stop` et `./runProd.sh --stop`. Le `npm run stop` annoncé
dans les versions antérieures de ce document n'existe toujours pas : le `package.json` livré par
`CRM-006` se limite aux commandes de types, et créer des alias des scripts trancherait en silence
un point laissé à l'arbitrage — voir
[`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md), INC-008.

Les commandes `docker compose` sous-jacentes restent utilisables directement :

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --wait
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --wait
docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v
```

Elles n'appliquent en revanche **aucune** des gardes des scripts : ni validation du fichier
d'environnement contre `.env.example`, ni refus de démarrer la production avec des secrets de
développement, ni protection contre l'effacement d'un environnement qui n'est pas local.

### Gardes des scripts

| Garde | Où | Effet |
|---|---|---|
| Fichier d'environnement complet | les trois scripts | Refus si une variable de `.env.example` manque, est vide alors qu'elle est obligatoire, ou vaut encore `CHANGE_ME_*` |
| `P2ENJOY_ENV_PROFILE=dev` | `runDev.sh`, `resetMe.sh` | Refus d'agir sur un fichier décrivant un autre environnement |
| `P2ENJOY_ENV_PROFILE=prod` | `runProd.sh` | Refus de démarrer la production avec les secrets du développement |
| `APPLY_MIGRATIONS=false` | `runProd.sh` | Refus de démarrer si la production applique les migrations toute seule (`docs/PROD_MIGRATIONS.md`) |
| Confirmation explicite | `resetMe.sh` | `oui` à la demande, ou `--yes` hors terminal interactif |
| Aucun amorçage en production | `runProd.sh` | Le script n'invente jamais de secret : les valeurs de production sont produites par un humain |

## 6. Lancement en développement

```bash
./runDev.sh
scripts/verify-stack.sh
scripts/verify-scripts.sh
```

Le premier lancement amorce `.env` (voir §4) ; les suivants le conservent tel quel. Repartir d'une
base vierge :

```bash
./resetMe.sh          # détruit la base et les volumes, redémarre à froid, rejoue migrations et seed
```

Services exposés. Les ports ne sont publiés que sur `DEV_BIND_ADDRESS` (`127.0.0.1` par défaut) :
la pile de développement n'est pas destinée à être exposée sur le réseau.

| Service | URL / port | Usage | État |
|---|---|---|---|
| API Supabase (Kong) | http://localhost:8000 | REST, Auth, Storage, Realtime | **disponible** |
| Supabase Studio | http://localhost:54323 | Inspection de la base | **disponible** |
| Inbucket | http://localhost:54324 | Emails **transactionnels** (invitations, @mentions, relances, digest) | **disponible** |
| MinIO | http://localhost:9001 | Console du stockage S3 local | **disponible** |
| PostgreSQL | localhost:54322 | Accès SQL direct (pgTAP, outillage de migration) | **disponible** |
| Pooler (Supavisor) | localhost:5432 · 6543 | Sessions et transactions poolées | **disponible** |
| Webapp | http://localhost:5173 | L'application | à venir (`CRM-007`) |
| Roundcube | http://localhost:8080 | Webmail de vérification : montre les dossiers IMAP créés par le CRM | à venir (`CRM-050`) |
| Stalwart | IMAP 1143 · SMTP 1025 | Vrai serveur mail local (boîte système + boîtes de démonstration) | à venir (`CRM-050`) |

Studio n'est **pas** joignable au travers de la passerelle : celle-ci ne connaît aucun service de
développement, ce qui rend sa configuration identique en développement et en production
(voir [`docs/JOURNAL.md`](docs/JOURNAL.md), décision 11).

**Pourquoi deux serveurs mail en développement ?** Inbucket est un puits SMTP : il capture les
emails que l'application *envoie* (GoTrue, notifications) et n'expose pas d'IMAP. Or le produit
doit *lire* des boîtes en IMAP, y créer des dossiers imbriqués et y déposer des messages :
cela exige un vrai serveur, d'où Stalwart. Roundcube permet de **voir** le résultat, ce qui rend
la vérification visuelle possible.

### Données de développement — le seed socle

`./resetMe.sh` applique le seed après le redémarrage à froid. Pour le rejouer seul, sur une pile
déjà démarrée :

```bash
supabase/seed/apply-seed.sh      # crée ou met à jour ; ne détruit jamais rien
scripts/verify-seed.sh           # rejoue les 12 preuves du seed
```

Le seed est **convergent** : le rejouer ne duplique rien et rattrape une valeur modifiée à la
main. Ses identifiants sont **stables** et commencent tous par `5eed`, ce qui rend une ligne
seedée reconnaissable au premier coup d'œil.

Un espace de travail, **P2Enjoy SAS** (`p2enjoy`), et trois comptes couvrant les trois rôles :

| Email | Nom affiché | Rôle | Identifiant |
|---|---|---|---|
| `admin@p2enjoy.test` | Camille Aubert | `admin` | `5eed0000-0000-4000-8000-000000000011` |
| `bizdev@p2enjoy.test` | Driss Lemoine | `business_developer` | `5eed0000-0000-4000-8000-000000000012` |
| `viewer@p2enjoy.test` | Farida Nowak | `viewer` | `5eed0000-0000-4000-8000-000000000013` |

Mot de passe commun : **`SeedDev2026Local`**.

Ce mot de passe n'est pas un secret, et c'est délibéré : il ne protège rien. Les adresses sont
sous `p2enjoy.test`, TLD réservé par la RFC 2606, donc non routable — un email envoyé par erreur
à l'un de ces comptes ne peut atteindre personne. Le seed **refuse** de s'appliquer à un
environnement dont le profil n'est pas `dev`.

> **Ces données ne sont pas encore lisibles par l'API.** Les tables du socle sont en refus par
> défaut depuis `CRM-003` : RLS activée, aucune politique. Une lecture retourne zéro ligne, même
> avec le jeton de l'administrateur seedé. Les politiques arrivent avec `CRM-012` ; le seed n'en
> pose aucune, et ne doit pas en poser.

Le contrat complet — mécanismes employés, convention d'identifiants, preuves exigées — est dans
[`docs/SPEC-seed.md`](docs/SPEC-seed.md).

## 7. Tests

```bash
npm run typecheck          # TypeScript, quatre projets   — aucune pile requise
npm run test:unit          # Vitest (webapp), 96 tests    — aucune pile requise
npm run test:sql           # pgTAP, 227 assertions        — pile démarrée
npm run e2e:api            # Playwright — contrats API et refus, hors interface  (pile + seed)
npm run e2e:ui             # Playwright — parcours utilisateur et captures       (pile)
npm run e2e:report         # sert le dernier rapport HTML sur http://localhost:9323
pytest mail-sync/tests     # PAS ENCORE LIVRÉ — attend le service mail-sync (CRM-051)
npm run e2e:mail           # PAS ENCORE LIVRÉ — attend Stalwart (CRM-050, CRM-054)
```

Les tests d'autorisation interrogent la base **directement**, avec les jetons réels de chaque
profil, afin de prouver qu'une opération interdite est refusée même en contournant l'interface.

Les six premières commandes sont livrées et prouvées. Les deux dernières ne le sont pas, et
elles ne sont **pas déclarées vides pour autant** : `pytest` sans service à exercer rendrait `5`,
et un projet Playwright sans scénario rendrait `0` sans rien avoir mesuré — ce qui serait pire
qu'une commande absente. Elles arriveront avec leur sujet, au chunk 4 ; la contradiction entre
cette réalité et la Definition of Done de `CRM-008` est consignée en
[`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md), INC-023.

`npm run test:sql` ne se fie **ni** au code de sortie de `psql`, **ni** au diagnostic de pgTAP :
mesuré, `psql` rend `0` sur une suite dont toutes les assertions échouent, et pgTAP n'émet aucun
diagnostic de plan lorsque `finish()` manque. L'exécuteur compare donc lui-même le plan `1..N` au
nombre d'assertions réellement émises. Voir
[`docs/SPEC-test-harness.md`](docs/SPEC-test-harness.md) §3.

`npm run e2e:api` ne construit ni ne sert la webapp : le projet parle directement à Kong. Comme
Playwright démarre son `webServer` pour toute exécution quel que soit le filtre `--project`, le
besoin est déclaré par la variable `E2E_PROJETS`, positionnée par les scripts npm eux-mêmes
(`docs/SPEC-test-harness.md` §4.2).

Les autres preuves disponibles aujourd'hui sont huit harnais rejouables, à exécuter sur une pile de
développement déjà démarrée :

```bash
scripts/verify-stack.sh        # pile Supabase : santé, passerelle, stockage        (CRM-001)
scripts/verify-scripts.sh      # scripts de lancement et contrat d'environnement    (CRM-002)
scripts/verify-migrations.sh   # migrations, suite pgTAP, refus par défaut          (CRM-003)
scripts/verify-vault.sh        # chiffrement des secrets de messagerie              (CRM-004)
scripts/verify-authz.sh        # fonctions d'autorisation, jetons réels             (CRM-010)
scripts/verify-auth.sh         # authentification : invitation, connexion, mot de passe (CRM-011)
scripts/verify-seed.sh         # seed socle : contrat, identifiants stables, convergence  (CRM-005)
scripts/verify-types.sh        # types générés : déterminisme, garde anti-dérive        (CRM-006)
scripts/verify-webapp.sh       # squelette de la webapp : build, jetons, états, clavier (CRM-007)
scripts/verify-harness.sh      # harnais de tests : exécuteurs, projets, non-complaisance (CRM-008)
scripts/verify-tracks.sh       # tracks : modèle, ordre, archivage, politiques RLS       (CRM-020)
scripts/verify-channels.sh     # channels : cloisonnement composite, onglets, RLS       (CRM-021)
scripts/verify-catalogue.sh    # catalogue de nœuds : bornes, ordre, archivage, RLS      (CRM-030)
scripts/verify-workflows.sh    # workflows, étapes, transitions : graphe, RLS, seed     (CRM-031)
scripts/verify-copie-workflow.sh # copie vers un track : refus, remappage, divergence  (CRM-032)
```

`scripts/verify-vault.sh` fait exception : il est **autonome**, ne lit ni `.env` ni la pile en
cours d'exécution, et crée ses propres conteneur et volumes jetables, détruits en sortant. Il
mesure l'image PostgreSQL **réellement épinglée** par `docker-compose.yml` — extensions
disponibles, chiffrement et déchiffrement effectifs, refus d'`anon` et d'`authenticated` sur le
schéma `vault` — puis éprouve le cycle de vie de la clé racine : conservée, le secret survit à un
redémarrage ; perdue, il devient définitivement illisible. C'est ce dernier point qui fonde la
contrainte de sauvegarde de `docs/DAT.md` §10.

`scripts/verify-migrations.sh` exécute la suite pgTAP de `supabase/tests/`, réapplique la
migration pour prouver son idempotence, crée un compte par l'**API d'administration GoTrue** puis
constate le profil correspondant par PostgREST, et mesure les refus **hors interface** avec les
jetons réels. Il vérifie enfin sa propre sévérité en mutant la structure : chaque mutation doit le
faire échouer.

`scripts/verify-authz.sh` couvre les fonctions d'autorisation. Sa suite pgTAP énumère les **64
combinaisons** de la matrice de résolution des droits fins, éprouve la résolution du rôle contre
cinq comptes réels — dont un membre d'un autre workspace et un appelant anonyme —, et **provoque**
la récursion des politiques pour démontrer que les fonctions livrées y échappent. Le schéma `app`
n'étant pas exposé par l'API, l'étape d'intégration pose **temporairement** deux politiques
adossées à ces fonctions, interroge PostgREST avec trois jetons obtenus par la route de connexion,
puis les retire et vérifie qu'aucune ne subsiste (`docs/JOURNAL.md`, décision 28).

`scripts/verify-auth.sh` couvre l'authentification, entièrement **hors interface**. Il vérifie
d'abord que la configuration réellement appliquée au service `auth` est celle du `.env`, puis
exerce le cycle de vie complet d'un compte : inscription libre refusée — y compris avec la clé de
service —, invitation refusée à la clé anonyme puis émise par la clé de service, email
**réellement reçu** dans Inbucket, acceptation en suivant le lien de cet email, définition du mot
de passe, connexion, rafraîchissement, déconnexion, réinitialisation menée à son terme et
suppression du compte. Les refus qui doivent rester **muets** sur l'existence d'un compte sont
comparés message à message. Sa non-complaisance est éprouvée par un GoTrue **jetable**, à la même
version épinglée, portant le réglage affaibli : le contrôle n'est réussi que si ce GoTrue-là
accepte ce que la pile refuse.

## 8. Build

```bash
npm run build              # webapp -> webapp/dist
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
```

Les deux variables `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont lues **au build** et
figées dans le bundle : après leur changement, il faut reconstruire, pas seulement redémarrer
(`docs/PROD_MIGRATIONS.md`). Absentes, l'application démarre et affiche son état « configuration
incomplète » plutôt que d'échouer en silence.

En production, Caddy sert `webapp/dist` en lecture seule : aucune image n'est fabriquée pour des
fichiers statiques.

## 9. Variables d'environnement

Les **78** variables sont documentées une à une dans `.env.example` : rôle, format attendu,
caractère obligatoire, valeur d'exemple non sensible. Ce gabarit est le contrat de référence, et
`scripts/verify-scripts.sh` vérifie qu'il couvre exactement les variables interpolées par les
trois fichiers Compose — une variable ajoutée à un service sans être documentée fait échouer les
preuves.

| Famille | Exemples | Remarque |
|---|---|---|
| Profil | `P2ENJOY_ENV_PROFILE` | Obligatoire. `dev` ou `prod` ; c'est la garde des scripts |
| Base de données | `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Obligatoires |
| Jetons Supabase | `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` | Obligatoires, jamais versionnés. Les deux clés sont **dérivées** de `JWT_SECRET` |
| API | `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `KONG_HTTP_PORT` | Obligatoires |
| Stockage | `GLOBAL_S3_BUCKET`, `GLOBAL_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID` | Obligatoires. En développement, l'overlay vise MinIO |
| Messagerie | `CRM_INBOUND_DOMAIN`, `MAIL_SYNC_POLL_INTERVAL`, `MAIL_MAX_ATTACHMENT_MB` | Obligatoires **à partir de `CRM-051`** : aucun service ne les consomme aujourd'hui |
| Chiffrement | `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY`, `REALTIME_DB_ENC_KEY` | Obligatoires. Longueurs imposées : 32, 32 et 16 caractères |
| Authentification | `DISABLE_SIGNUP`, `PASSWORD_MIN_LENGTH`, `JWT_EXPIRY` | Obligatoires. `DISABLE_SIGNUP` vaut **toujours** `true` (`docs/SPEC-auth.md` §2) |
| SMTP transactionnel | `SMTP_HOST`, `SMTP_PORT`, `SMTP_ADMIN_EMAIL` | Obligatoires |
| Pile | `STACK_RLIMIT_NOFILE`, `APPLY_MIGRATIONS` | Facultatives, avec défauts. `APPLY_MIGRATIONS=false` est imposé en production |
| Production | `APP_DOMAIN`, `CADDY_ACME_EMAIL` | Obligatoires en production uniquement |

Les identifiants IMAP/SMTP **des utilisateurs** ne sont jamais des variables d'environnement :
ils sont saisis dans l'application et chiffrés en base (Supabase Vault).

## 10. Structure du dépôt

Livré à ce jour :

```
.
├── .env.example                Gabarit documenté de l'environnement, contrat de référence
├── runDev.sh                   Lancement du développement, amorçage de `.env`
├── runProd.sh                  Lancement de la production, gardes de profil et de migrations
├── resetMe.sh                  Réinitialisation destructive de l'environnement local
├── docker-compose.yml          Assemblage commun des services
├── docker-compose.dev.yml      Outillage de développement (Studio, meta, MinIO, Inbucket, webapp)
├── docker-compose.prod.yml     Production (Caddy, aucun outillage de développement)
├── caddy/Caddyfile             Terminaison TLS et service des fichiers statiques
├── package.json                Projet npm unique : types (CRM-006), webapp (CRM-007) — aucun alias des scripts (INC-008)
├── tsconfig.json               Compilation stricte des types générés et de leurs assertions
├── tsconfig.tools.json         Compilation des configurations et des scénarios E2E
├── docs/                       Documentation de référence (voir ci-dessous)
├── scripts/
│   ├── lib/env.sh              Socle commun des scripts : lecture, amorçage, validation, gardes
│   ├── verify-stack.sh         Preuves rejouables de la pile
│   ├── verify-scripts.sh       Preuves rejouables des scripts et du contrat d'environnement
│   ├── verify-migrations.sh    Preuves rejouables des migrations et du refus par défaut
│   ├── verify-vault.sh         Preuves rejouables du chiffrement des secrets de messagerie
│   ├── verify-authz.sh         Preuves rejouables des fonctions d'autorisation
│   ├── verify-auth.sh          Preuves rejouables de l'authentification
│   ├── verify-seed.sh          Preuves rejouables du seed socle
│   ├── generate-types.sh       Génération des types TypeScript depuis le schéma migré
│   ├── verify-types.sh         Preuves rejouables des types générés et de leur garde anti-dérive
│   ├── verify-webapp.sh        Preuves rejouables du squelette : build, jetons, états, clavier
│   ├── verify-harness.sh       Preuves rejouables du harnais de tests et de sa non-complaisance
│   ├── verify-tracks.sh        Preuves rejouables des tracks : modèle, ordre, archivage, RLS
│   ├── verify-channels.sh      Preuves rejouables des channels : cloisonnement, onglets, RLS
│   ├── verify-catalogue.sh     Preuves rejouables du catalogue de nœuds : bornes, ordre, RLS
│   └── lib/classes-css.mjs     Contrôle : toute classe citée existe dans le CSS produit
├── supabase/
│   ├── docker/                 Configuration Kong et scripts d'initialisation de la base
│   ├── migrations/             SQL versionné, rejoué en ordre par `migrations-runner`
│   ├── seed/                   Seed socle, appliqué par les API réelles (CRM-005)
│   └── tests/                  Suites pgTAP, une par migration
├── e2e/
│   ├── playwright.config.ts    Projet `ui` ; `api` et `mail` restent dus par CRM-008
│   └── ui/                     Scénarios d'interface et production des captures
└── webapp/
    ├── index.html              Point d'entrée Vite
    ├── vite.config.ts          Build et serveur de développement (racine déclarée : webapp/)
    ├── vitest.config.ts        Tests unitaires, environnement jsdom
    ├── tsconfig.json           Compilation de l'application (navigateur)
    ├── tsconfig.test.json      Compilation des tests (Node + DOM simulé)
    ├── Dockerfile              Image de développement, Node 24
    └── src/
        ├── app/                Coquille : mise en page, routes, préférences de session
        ├── components/ui/      Composants du design system, seuls porteurs de styles de base
        ├── i18n/               Dictionnaire français et fonction `t` typée
        ├── lib/                Client Supabase, contrat asynchrone, types générés (CRM-006)
        └── styles/tokens.css   Jetons du design system — seul fichier portant des hexadécimaux
```

Prévu par le backlog, pas encore livré :

```
├── e2e/                        CRM-008
└── mail-sync/                  CRM-051
```

Le répertoire `webapp/` existe déjà, mais ne contient que ce que `CRM-006` livre :

```
webapp/src/lib/
├── database.types.ts           Types générés depuis le schéma — fichier généré, ne pas éditer
└── database.types.test-d.ts    Assertions de type, vérifiées à la compilation
```

L'application elle-même — `index.html`, composants, routes, configuration Vite — relève de
`CRM-007`.

Le répertoire `supabase/functions/` (edge functions Deno) mentionné dans les versions antérieures
de ce document n'a **aucun** composant correspondant dans l'architecture ni aucune unité de
backlog : le point est consigné dans
[`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md) (INC-007) et attend l'arbitrage du
responsable.

Documentation de référence :

| Document | Contenu |
|---|---|
| [`docs/DAT.md`](docs/DAT.md) | Architecture technique : composants, flux, dépendances, déploiement |
| [`docs/SCHEMA.md`](docs/SCHEMA.md) | Modèle de données complet |
| [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) | Charte, tokens, composants, accessibilité |
| [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md) | Index d'exécution autoritatif (référencé par les `@spec`) |
| [`docs/BACKLOG.md`](docs/BACKLOG.md) | Unités `CRM-NNN` et leur Definition of Done |
| [`docs/JOURNAL.md`](docs/JOURNAL.md) | Décisions et investigations, par ordre chronologique |
| [`docs/SPEC-workflow-engine.md`](docs/SPEC-workflow-engine.md) | Catalogue de nœuds, workflows, transitions |
| [`docs/SPEC-form-composer.md`](docs/SPEC-form-composer.md) | Champs conditionnels par étape |
| [`docs/SPEC-mail-subsystem.md`](docs/SPEC-mail-subsystem.md) | IMAP, SMTP, classement, dossiers |
| [`docs/SPEC-permissions-rls.md`](docs/SPEC-permissions-rls.md) | Rôles, RLS, preuves de refus |
| [`docs/SPEC-auth.md`](docs/SPEC-auth.md) | Authentification, sessions, cycle de vie d'un compte |
| [`docs/SPEC-seed.md`](docs/SPEC-seed.md) | Données de développement : contrat du seed, identifiants stables |
| [`docs/SPEC-types.md`](docs/SPEC-types.md) | Types TypeScript générés depuis le schéma, garde anti-dérive |
| [`docs/SPEC-webapp.md`](docs/SPEC-webapp.md) | Squelette de la webapp : chaîne de build, jetons, coquille, états |
| [`docs/SPEC-test-harness.md`](docs/SPEC-test-harness.md) | Harnais de tests : exécuteur pgTAP, projets Playwright, rapport |
| [`docs/PROD_MIGRATIONS.md`](docs/PROD_MIGRATIONS.md) | Contrat de déploiement |
| [`docs/manual.md`](docs/manual.md) | Manuel utilisateur |
| [`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md) | Contradictions relevées, en attente d'arbitrage |

## 11. Limites connues

- **Le métier est incomplet** : la pile démarre, le socle d'identité est en base, le seed existe,
  **le squelette de l'interface est livré**, et les tracks, channels, nœuds et workflows existent
  réellement côté serveur — mais il n'y a ni cards, ni formulaires, ni messagerie, et **aucun de
  ces objets n'a d'écran d'administration**. Voir [`docs/BACKLOG.md`](docs/BACKLOG.md) pour l'état
  réel.
- **Aucun écran de connexion, et donc aucune donnée à l'écran.** L'interface interroge l'API avec
  la seule clé anonyme ; la RLS en refus par défaut rend `200` et `[]`, et l'application affiche
  ses états vides. Mesuré : **un compte seedé connecté obtient exactement le même vide**, faute de
  politiques RLS (`CRM-012`). L'écran est donc exact, pas inachevé. Aucune unité ne porte cet
  écran de connexion : [`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md), INC-021.
- **La webapp ne connaît aucune règle d'accès**, par construction : elle affiche ce que le backend
  consent à rendre. Un type ne décrit jamais un droit (voir ci-dessous), et l'interface ne
  masque rien qui ne soit déjà refusé côté base.
- **Les types générés ne décrivent que le schéma, jamais les droits.** Une table en refus par
  défaut se type exactement comme une table ouverte : elle rend simplement zéro ligne à
  l'exécution. Une contrainte `CHECK` ne survit pas non plus à la génération —
  `workspace_members.role` se type `string`, et seule la base refuse une valeur hors vocabulaire.
  Voir [`docs/SPEC-types.md`](docs/SPEC-types.md) §7.
- **Les autorisations ne sont pas encore écrites.** Les tables du socle d'identité sont en
  **refus par défaut** : RLS activée, aucune politique. Une lecture retourne zéro ligne et une
  écriture est refusée, quel que soit le compte. Les **fonctions** d'autorisation sont livrées et
  prouvées (`CRM-010`) ; les **politiques** qui les emploient relèvent de `CRM-012`. Tant qu'elles
  manquent, la base est sûre mais inexploitable par l'API, ce qui est le comportement voulu et non
  un défaut.
- **Descripteurs de fichiers.** Realtime et le pooler réclament `STACK_RLIMIT_NOFILE`
  descripteurs (défaut `100000`). Sur un hôte dont la limite dure est inférieure — conteneur sans
  `CAP_SYS_RESOURCE`, par exemple — ces deux services redémarrent en boucle tant que la variable
  n'est pas abaissée. `./runDev.sh` détecte le cas lors de l'amorçage : il inscrit la limite dure
  réelle de l'hôte dans le `.env` produit et le signale. Un `.env` déjà existant n'est en revanche
  jamais corrigé, et la production ne bénéficie d'aucun ajustement automatique : le prérequis
  reste à vérifier avant le premier démarrage (`docs/PROD_MIGRATIONS.md` §4). La valeur par défaut
  n'a **pas** pu être éprouvée dans l'environnement de vérification, plafonné à 4096.
- **TLS de production non éprouvé** : la pile de production a été vérifiée avec
  `APP_DOMAIN=localhost`, donc l'autorité interne de Caddy. L'émission d'un certificat ACME exige
  un domaine public et reste à confirmer au premier déploiement réel.
- **OAuth2 Gmail / Microsoft 365 hors périmètre v1.** La connexion d'une boîte se fait par
  serveur + identifiant + mot de passe applicatif. Les organisations imposant OAuth ne pourront
  pas connecter leurs boîtes tant que l'unité correspondante du backlog n'est pas livrée.
- **Les preuves d'interface s'exécutent sur Chromium seul**, et sur Node 22 côté hôte ; Node 24,
  le prérequis du dépôt, n'est exercé que dans le conteneur `webapp`. Firefox et WebKit ne sont
  pas couverts, et le rechargement à chaud de Vite n'est éprouvé par aucune preuve automatique.
- **La production exige des prérequis externes** non fournis par le dépôt : domaine des adresses
  de card, enregistrements DNS, SPF/DKIM/DMARC pour les identités sortantes, certificats TLS.
  Voir [`docs/PROD_MIGRATIONS.md`](docs/PROD_MIGRATIONS.md).
- **L'invitation n'est pas encore un parcours produit.** Un compte se crée par
  `POST /auth/v1/invite`, qui exige la clé de service : c'est aujourd'hui une opération
  d'**exploitation**, pas un bouton dans l'interface. Le composant qui permettrait à un
  administrateur de workspace d'inviter depuis le produit n'existe pas et n'est rattaché à aucune
  unité — consigné en [`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md), INC-015.
- **Les emails transactionnels partent en anglais.** GoTrue ne sait charger un gabarit
  personnalisé que par HTTP, et le dépôt n'expose aucune origine HTTP joignable depuis le réseau
  des conteneurs avant la webapp. Le repli vers le gabarit anglais est de surcroît **silencieux**
  du point de vue du destinataire : INC-016.
- **Le seed de démonstration n'est pas une base de production** : mots de passe faibles connus,
  domaines fictifs, boîtes locales.
