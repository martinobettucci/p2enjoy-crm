# P2Enjoy CRM

CRM de suivi de projets commerciaux, organisé en **Tracks** → **Channels** → **Cards**, avec
workflows à transitions contraintes, formulaires conditionnels par étape, et une messagerie
intégrée (IMAP entrant / SMTP sortant) qui classe les emails dans les cards.

> **État d'avancement — lisez ceci en premier.**
> Sont livrés et vérifiés : la **pile d'exécution** (`CRM-001`, `CRM-002`), les **migrations
> d'amorçage** et leur refus par défaut (`CRM-003`), le **chiffrement des secrets** (`CRM-004`),
> les **fonctions d'autorisation** (`CRM-010`), l'**authentification** (`CRM-011`), l'**écran de
> connexion, la session d'onglet et les emails transactionnels français** (`CRM-009`), le **seed
> socle** (`CRM-005`), les **types générés** (`CRM-006`), le **squelette de la webapp**
> (`CRM-007`), le **harnais de tests** (`CRM-008`), les **tracks** (`CRM-020`), les **channels**
> (`CRM-021`), le **catalogue de nœuds** (`CRM-030`), les **workflows** (`CRM-031`), leur **copie
> vers un track** (`CRM-032`), la **cohérence workflow ↔ channel** (`CRM-033`), les **champs de
> formulaire** (`CRM-035`), les **cards** (`CRM-040`), la **garde centrale `move_card`**
> (`CRM-034`) et les **valeurs de formulaire** (`CRM-036`).
> Le board, la vue liste, la fiche, les commentaires et l'historique sont également livrés. La
> webapp possède désormais son **écran de connexion**, une session limitée à l'onglet et une
> déconnexion réelle (`CRM-009`). Un utilisateur connecté peut consulter les données que la RLS
> lui consent, publier un commentaire et déplacer une card. `move_card` porte ses **six** vérifications :
> la sixième, « les champs requis de l'étape cible sont renseignés », est livrée par `CRM-036`, qui
> a refermé INC-047.
> **Conséquence à connaître avant de lancer l'application** : sans session, l'interface conserve
> les vrais états vides et de refus du backend. Après connexion, elle réutilise le même client avec
> le jeton réel du compte ; aucune autorisation n'est calculée côté navigateur. Les tables
> d'identité restent toutefois illisibles (INC-014), si bien que le nom du workspace et les noms de
> personnes peuvent rester absents alors que les objets métier sont accessibles.
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
- `jq` **ou** `python3`, uniquement sur un poste dont la configuration Docker délègue ses
  identifiants à un binaire Windows — cas courant sous WSL. Voir §11.

Sur un poste géré par NVM, activer la version du dépôt dans chaque nouveau shell avant une
commande `npm` :

```bash
nvm use
```

Sous WSL, `command -v node` et `command -v npm` doivent désigner des exécutables Linux. Un
`npm` trouvé sous `/mnt/c/Program Files/` est le binaire Windows et ne sait pas exécuter ce dépôt
depuis son chemin UNC.

## 4. Installation

```bash
./runDev.sh
```

C'est tout. Au premier lancement, `runDev.sh` crée `.env` à partir de `.env.example` et **tire au
hasard** chaque secret : mot de passe PostgreSQL, `JWT_SECRET`, clés MinIO, secrets de Realtime et
du pooler. `ANON_KEY` et `SERVICE_ROLE_KEY` sont dérivées du `JWT_SECRET` produit, sous forme de
jetons HS256 valides. **Aucune clé n'est reprise du dépôt** : deux postes n'ont jamais les mêmes.

Le fichier est créé en mode `600` et n'est jamais versionné. Un `.env` existant n'est jamais
écrasé. Une valeur historique `CRM_INBOUND_DOMAIN=crm.exemple.tld` n'est pas corrigée en silence :
le développement la refuse avant de démarrer, car le seed porte nécessairement
`crm.p2enjoy.test`. Il faut aligner explicitement la valeur locale sur `.env.example`.

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
| `supabase/seed/apply-seed.sh` | Applique le seed socle **et le jeu de démonstration** sur la pile de développement | **disponible** |
| `scripts/verify-seed-demo.sh` | Rejoue les preuves du jeu de démonstration : étapes peuplées, workflow dérivé exercé, aucun channel actif vide, convergence | **disponible** |
| `scripts/verify-seed-demo.sh --empreinte` | N'affiche que l'empreinte de reproductibilité du seed, et sort | **disponible** |
| `scripts/verify-manual.sh` | Rejoue les preuves du manuel utilisateur : chiffres de l'annexe A comparés à la base, captures citées, unités couvertes, libellés réels, absence de secret | **disponible** |
| `scripts/verify-manual.sh --contre-epreuve` | Dégrade une **copie** du manuel et exige que le harnais morde ; ne touche jamais au dépôt | **disponible** |
| `scripts/verify-mail-infra.sh` | Rejoue les preuves de l'infrastructure mail de développement : configuration versionnée, placement des services, variables, domaines convergents, boîtes et rôles, IMAP réel, détection ClamAV, Roundcube | **disponible** |
| `scripts/verify-mail-infra.sh --contre-epreuve` | Dégrade une **copie** des fichiers versionnés et exige que le harnais morde ; ne touche jamais au dépôt | **disponible** |
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
| Webapp | http://127.0.0.1:5173 | L'application | **disponible** |
| Roundcube | http://localhost:8080 | Webmail de vérification : montre les dossiers IMAP créés par le CRM | **disponible** |
| Stalwart | IMAP 1143 · SMTP 1025 (remise) · 1587 (soumission) | Vrai serveur mail local (boîte système + deux boîtes personnelles) | **disponible** |
| Stalwart — API de gestion | http://localhost:8081/api/ | Provisionnement des réglages, domaines et boîtes ; la racine explique pourquoi aucune console n'est servie | **disponible** |
| ClamAV (`clamd`) | localhost:3310 | Analyse antivirale des pièces jointes ; son consommateur arrive avec `CRM-054` | **disponible** |

Studio n'est **pas** joignable au travers de la passerelle : celle-ci ne connaît aucun service de
développement, ce qui rend sa configuration identique en développement et en production
(voir [`docs/JOURNAL.md`](docs/JOURNAL.md), décision 11).

**Pourquoi deux serveurs mail en développement ?** Inbucket est un puits SMTP : il capture les
emails que l'application *envoie* (GoTrue, notifications) et n'expose pas d'IMAP. Or le produit
doit *lire* des boîtes en IMAP, y créer des dossiers imbriqués et y déposer des messages :
cela exige un vrai serveur, d'où Stalwart. Roundcube permet de **voir** le résultat, ce qui rend
la vérification visuelle possible.

### Boîtes de développement

Trois boîtes sont provisionnées au démarrage, par la **véritable API de gestion** de Stalwart, et
non par une écriture directe dans son magasin. Le provisionnement est convergent : le rejouer ne
duplique rien, rétablit une valeur modifiée à la main, et **ne détruit aucun message**.

| Adresse | Nature | Compte du seed |
|---|---|---|
| `systeme@crm.p2enjoy.test` | Boîte **système** du workspace, catch-all de `@crm.p2enjoy.test` | — |
| `admin@p2enjoy.test` | Boîte personnelle | Camille Aubert, `admin` |
| `bizdev@p2enjoy.test` | Boîte personnelle | Driss Lemoine, `business_developer` |

Mot de passe commun : **`SeedDev2026Local`**, le même que celui des comptes seedés. Il ne protège
rien, et c'est délibéré : les domaines sont sous `.test`, TLD réservé par la RFC 2606 donc non
routable, et les ports ne sont publiés que sur la boucle locale. Farida Nowak (`viewer`) n'a pas de
boîte : un `viewer` lit, il ne correspond pas.

Le **catch-all** est ce qui rend la boîte système utile : un message adressé à
`c-xxxxxxxx@crm.p2enjoy.test` — une adresse de card qui n'a jamais été déclarée — y est remis. Ce
domaine doit rester celui que le seed écrit dans `workspaces.inbound_domain` ; `scripts/verify-mail-infra.sh`
compare les deux et devient rouge s'ils divergent.

Vérifier à la main, depuis le webmail : http://localhost:8080, puis l'une des trois adresses.

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

Depuis `CRM-046`, il livre le **jeu de démonstration complet** : quatre tracks dont un archivé, six
channels dont un archivé, deux workflows dont un **dérivé**, et **quatorze cards** — douze actives,
une archivée, une en corbeille. Les **sept** étapes du workflow global portent chacune une card
active, le workflow dérivé en porte deux, et **aucun channel actif n'est vide**
(`docs/SPEC-seed.md` §9). Ses preuves se rejouent par `scripts/verify-seed-demo.sh`.

Deux identifiants échappent à la règle de stabilité, et c'est le produit qui l'impose : le workflow
dérivé et ses sept étapes naissent de `copy_workflow_to_track`, avec `gen_random_uuid()`. Le seed
les résout à l'exécution par la clé de nœud du catalogue (`docs/SPEC-seed.md` §9.4).

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

Sur un poste NVM, exécuter d'abord `nvm use` comme indiqué au §3. Les commandes `npm run …`
directes utilisent toujours la chaîne Node du shell courant.

```bash
npm run typecheck          # TypeScript, quatre projets   — aucune pile requise
npm run test:unit          # Vitest, 525 tests            — aucune pile requise
npm run test:sql           # pgTAP, 1405 assertions       — pile démarrée
npm run e2e:api            # Playwright — contrats API et refus, hors interface  (pile + seed)
npm run e2e:ui             # Playwright — parcours utilisateur et captures       (pile)
npm run e2e:mail           # Playwright — IMAP, SMTP, ClamAV et Roundcube réels  (pile)
npm run e2e:report         # sert le dernier rapport HTML sur http://localhost:9323
pytest mail-sync/tests     # PAS ENCORE LIVRÉ — attend le service mail-sync (CRM-051)
```

Les tests d'autorisation interrogent la base **directement**, avec les jetons réels de chaque
profil, afin de prouver qu'une opération interdite est refusée même en contournant l'interface.

Les sept premières commandes sont livrées et prouvées. `npm run e2e:mail` l'est **depuis
`CRM-050`** : il exerce les protocoles — session IMAP sur les trois boîtes, soumission SMTP
authentifiée, remise par le catch-all et relecture, détection réelle d'EICAR par ClamAV, et
Roundcube à l'écran. L'aller-retour d'email **du produit** reste dû par `CRM-054` et `CRM-058` :
rien dans le CRM ne lit encore ces boîtes.

`pytest mail-sync/tests` n'est toujours pas livré, et n'est **pas déclaré vide pour autant** :
sans service à exercer, il rendrait `5` (« no tests ran ») — ce qui serait pire qu'une commande
absente. Il arrivera avec son sujet, en `CRM-051`. Le responsable a explicitement retiré cette
commande de la DoD de `CRM-008` — décision 277, INC-023 — plutôt que de créer un harnais vide ou de
compter deux fois la preuve de `CRM-051`.

`npm run test:sql` ne se fie **ni** au code de sortie de `psql`, **ni** au diagnostic de pgTAP :
mesuré, `psql` rend `0` sur une suite dont toutes les assertions échouent, et pgTAP n'émet aucun
diagnostic de plan lorsque `finish()` manque. L'exécuteur compare donc lui-même le plan `1..N` au
nombre d'assertions réellement émises. Voir
[`docs/SPEC-test-harness.md`](docs/SPEC-test-harness.md) §3.

`npm run e2e:api` ne construit ni ne sert la webapp : le projet parle directement à Kong. Comme
Playwright démarre son `webServer` pour toute exécution quel que soit le filtre `--project`, le
besoin est déclaré par la variable `E2E_PROJETS`, positionnée par les scripts npm eux-mêmes
(`docs/SPEC-test-harness.md` §4.2).

**Sur une machine qui fournit son propre navigateur** — image d'intégration continue préinstallée,
poste où `playwright install` est indisponible —, la variable facultative
`PLAYWRIGHT_CHROMIUM_PATH` porte le chemin absolu du Chromium à employer :

```bash
PLAYWRIGHT_CHROMIUM_PATH=/chemin/vers/chromium npm run e2e:ui
```

Absente, rien ne change : Playwright résout le navigateur lui-même. Elle ne désactive aucun contrôle
et ne substitue aucune réponse — seul le binaire diffère (`docs/SPEC-test-harness.md` §4.4 bis).

Les autres preuves disponibles aujourd'hui sont les harnais rejouables ci-dessous, à exécuter sur
une pile de développement déjà démarrée :

```bash
scripts/verify-stack.sh        # pile Supabase : santé, passerelle, stockage        (CRM-001)
scripts/verify-scripts.sh      # scripts de lancement et contrat d'environnement    (CRM-002)
scripts/verify-migrations.sh   # migrations, suite pgTAP, refus par défaut          (CRM-003)
scripts/verify-vault.sh        # chiffrement des secrets de messagerie              (CRM-004)
scripts/verify-authz.sh        # fonctions d'autorisation, jetons réels             (CRM-010)
scripts/verify-auth.sh         # GoTrue + contenu des emails transactionnels (CRM-011, CRM-009)
scripts/verify-seed.sh         # seed socle : contrat, identifiants stables, convergence  (CRM-005)
scripts/verify-types.sh        # types générés : déterminisme, garde anti-dérive        (CRM-006)
scripts/verify-webapp.sh       # webapp : build/chunks, jetons, états, clavier, console (CRM-007)
scripts/verify-harness.sh      # harnais de tests : exécuteurs, projets, non-complaisance (CRM-008)
scripts/verify-tracks.sh       # tracks : modèle, ordre, archivage, politiques RLS       (CRM-020)
scripts/verify-channels.sh     # channels : cloisonnement composite, onglets, RLS       (CRM-021)
scripts/verify-catalogue.sh    # catalogue de nœuds : bornes, ordre, archivage, RLS      (CRM-030)
scripts/verify-workflows.sh    # workflows, étapes, transitions : graphe, RLS, seed     (CRM-031)
scripts/verify-copie-workflow.sh # copie vers un track : refus, remappage, divergence  (CRM-032)
scripts/verify-coherence-workflow.sh # cohérence workflow ↔ channel : quatre portes  (CRM-033)
scripts/verify-champs-formulaire.sh # champs de formulaire et règles de visibilité   (CRM-035)
scripts/verify-droits-fins.sh  # droits fins par track et channel : matrice, refus    (CRM-012)
scripts/verify-cards.sh        # cards : adresse générée, archivage, corbeille, RLS   (CRM-040)
scripts/verify-move-card.sh    # move_card : les cinq gardes, protection de colonne   (CRM-034)
scripts/verify-valeurs-champs.sh # valeurs de formulaire, validation, sixième garde  (CRM-036)
scripts/verify-colonnes-protegees.sh # colonnes protégées : email_local_part fermée (CRM-013)
scripts/verify-preuves-refus.sh # les douze preuves de refus, et la non-complaisance (CRM-014)
scripts/verify-board.sh        # board kanban : colonnes, glisser-déposer, refus        (CRM-041)
scripts/verify-liste.sh        # vue liste : tri total, filtres, pagination, 416        (CRM-042)
scripts/verify-seed-demo.sh    # jeu de démonstration complet : toutes les étapes peuplées (CRM-046)
scripts/verify-manual.sh       # manuel utilisateur : annexe A, captures, libellés réels  (CRM-047)
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
combinaisons** de la matrice de résolution des droits fins **deux fois** — sur l'algorithme seul,
puis à travers des lignes réelles pour éprouver la jointure qui l'alimente —, met à l'épreuve la
résolution du rôle contre cinq comptes réels — dont un membre d'un autre workspace et un appelant
anonyme —, et **provoque** la récursion des politiques sur `workspace_members`, `tracks`,
`channels` et `cards` pour démontrer que les fonctions livrées y échappent : une jumelle
`SECURITY INVOKER` de chacune épuise la pile. Elle recense enfin les fonctions `SECURITY DEFINER`
des schémas `app` et `public`, dont aucune ne doit laisser son `search_path` au hasard.

Le schéma `app` n'étant pas exposé par l'API, l'étape d'intégration pose **temporairement** deux
politiques adossées aux deux fonctions de rôle, interroge PostgREST avec trois jetons obtenus par
la route de connexion, puis les retire et vérifie qu'aucune ne subsiste (`docs/JOURNAL.md`,
décision 28). Les quatre fonctions `can_*` n'ont pas besoin de cette instrumentation : les
politiques de `tracks`, `channels` et `cards` les appellent déjà, et le harnais les exerce donc par
le chemin réel du produit, avec les jetons des trois profils du seed.

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

Les **88** variables sont documentées une à une dans `.env.example` : rôle, format attendu,
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
| Messagerie | `CRM_INBOUND_DOMAIN`, `MAIL_SYNC_POLL_INTERVAL`, `MAIL_MAX_ATTACHMENT_MB` | `CRM_INBOUND_DOMAIN` est consommée **depuis `CRM-050`** — Stalwart lui attache la boîte système, et sa valeur doit égaler `workspaces.inbound_domain`. Les deux autres attendent `CRM-054` |
| Messagerie de développement | `STALWART_IMAP_PORT`, `STALWART_SMTP_PORT`, `STALWART_SUBMISSION_PORT`, `STALWART_ADMIN_PORT`, `STALWART_ADMIN_USER`, `STALWART_ADMIN_PASSWORD`, `STALWART_MAILBOX_PASSWORD`, `MAIL_DEV_PERSONAL_DOMAIN`, `ROUNDCUBE_PORT`, `CLAMAV_PORT` | Obligatoires **en développement uniquement** : aucun de ces services n'existe en production. `STALWART_ADMIN_PASSWORD` est tiré au hasard à l'amorçage |
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
├── stalwart/                   Serveur mail de développement (CRM-050)
│   ├── config.toml             Configuration versionnée, montée en lecture seule
│   ├── webadmin-disabled.zip   Page locale déterministe ; aucun téléchargement de console `latest`
│   ├── provision.sh            Domaines et boîtes créés par la vraie API de gestion
│   └── config.test.ts          Invariants de la configuration, éprouvés par Vitest
├── e2e/
│   ├── playwright.config.ts    Projets `api`, `mail` et `ui`
│   ├── mail/                   Scénarios IMAP, SMTP, ClamAV et Roundcube (CRM-050)
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

Le répertoire `supabase/functions/` (edge functions Deno) **n'existe pas encore**, et l'arbitrage
qui le concerne est rendu : les fonctions edge **entrent au périmètre**
([`docs/JOURNAL.md`](docs/JOURNAL.md), décision 260, INC-007). L'agent avait proposé de retirer la
mention de ce document ; le responsable a tranché l'inverse — livrer ce que le document annonce
plutôt que faire disparaître la moitié qui gêne. La **décision 12 est rouverte sur ce point**.

L'unité **`CRM-016`** porte le service `edge-runtime`, le répertoire `supabase/functions/` et la
route `/functions/v1/` de la passerelle. Elle donne un porteur à deux besoins qui n'en avaient
aucun : l'invitation d'un membre, qui exige la clé de service et ne peut pas vivre dans la webapp,
et les webhooks sortants signés (`CRM-073`). La logique métier reste en PostgreSQL et `mail-sync`
reste un service Python : les fonctions edge **s'ajoutent**, elles ne remplacent rien.

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
- **La messagerie de développement existe, mais rien ne la lit.** Depuis `CRM-050`, Stalwart,
  Roundcube et ClamAV démarrent avec la pile, et trois boîtes sont provisionnées. **Aucun composant
  du CRM ne s'y connecte** : le service `mail-sync` arrive en `CRM-051`, l'ingestion en `CRM-054`.
  Ce qui est livré est le monde extérieur, pas la fonctionnalité.
- **Stalwart n'expose volontairement aucune console web.** Sa racine HTTP sert une page locale
  explicative, sans téléchargement au démarrage. Tous ses protocoles et son API de gestion
  `/api/*` fonctionnent ; la vérification visuelle passe par Roundcube.
- **Le serveur mail de développement n'emploie aucun TLS**, et ses ports ne sont publiés que sur
  `DEV_BIND_ADDRESS`. C'est un choix documenté (`docs/SPEC-mail-subsystem.md` §11.3) : en
  production, ce sont les serveurs des utilisateurs qui portent le chiffrement. Exposer cette pile
  au-delà de la boucle locale imposerait de revenir sur ce choix.
- **Les tables d'identité restent illisibles.** La connexion et les objets métier fonctionnent,
  mais `workspaces`, `profiles` et `workspace_members` restent en refus par défaut (INC-014). Le
  nom du workspace et les noms de personnes peuvent donc manquer dans l'interface, même pour une
  administratrice connectée.
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
- **Ce que la pile suppose de l'hôte.** Cinq suppositions ont été mesurées fausses sur un poste
  WSL alors qu'elles tenaient dans le conteneur d'intégration. Elles sont désormais gardées par les
  scripts, et chaque garde est inerte là où elle ne s'applique pas
  (`docs/JOURNAL.md`, décisions 98 à 101 et 257) :
  - **Magasin d'identifiants Docker.** Un `~/.docker/config.json` désignant `desktop.exe` fait
    passer chaque accès au registre par un binaire Windows. En rafale — et Compose tire ses images
    en parallèle — il rend une sortie vide, et le tirage s'arrête sur
    `error getting credentials`. `./runDev.sh` écarte alors les assistants `.exe` pour la durée de
    son exécution, en conservant le contexte Docker du poste, et le dit. Les tirages deviennent
    anonymes ; toutes les images de la pile sont publiques. Écarter ces assistants demande `jq` ou
    `python3` : sans l'un des deux, le script le signale et laisse la configuration intacte.
  - **Ports déjà pris.** `./runDev.sh`, `./resetMe.sh` et `./runProd.sh` refusent de démarrer
    lorsqu'un port publié par l'assemblage est tenu par un autre programme, en nommant le port,
    son détenteur et la variable à changer dans `.env`. **Aucun port n'est choisi automatiquement**
    : les URL ci-dessus, les preuves et le seed en dépendent. `.env` est propre au poste, le
    modifier ne change rien au dépôt. La détection essaie `ss`, puis `netstat`; sur un Linux
    minimal qui ne porte aucun des deux, elle lit directement `/proc/net/tcp` et
    `/proc/net/tcp6`. Le harnais ouvre puis ferme une vraie socket et prouve les deux verdicts.
  - **Effacement du cluster PostgreSQL.** PostgreSQL referme son répertoire de données en `0750`
    sous son propre compte : sur un hôte dont l'utilisateur n'est pas celui du conteneur, `rm`
    échoue. `./resetMe.sh` confie alors la destruction à un conteneur jetable. Aucun `sudo` n'est
    demandé.
  - **`node_modules` à la racine.** Le service `webapp` monte un volume nommé sur
    `/app/node_modules` ; le répertoire est créé sur l'hôte avant Compose, faute de quoi le démon
    le crée en `root` et `npm install` échoue ensuite en `EACCES` dans votre propre dépôt.
  - **Contexte de build de la webapp.** Le `COPY . .` de l'image de développement est borné par le
    `.dockerignore` racine : `.env`, `.git`, `node_modules`, les sorties de build et de preuve,
    ainsi que `supabase/docker/volumes/` n'entrent jamais dans l'image. Sans cette garde, un
    cluster PostgreSQL en `0750` fait échouer la reconstruction et, surtout, les secrets de
    `.env` sont copiés dans une couche Docker.
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
- **Les emails transactionnels français sont livrés ; leur limite est MIME.** Le service interne
  `auth-templates` sert les quatre gabarits à GoTrue et les preuves vérifient le contenu SMTP réel,
  pas la seule présence d'un message : INC-016 est close. GoTrue 2.189.0 n'émet toutefois qu'une
  partie `text/html`, sans alternative `text/plain` ; Inbucket reconstruit son onglet texte.
- **Le seed de démonstration n'est pas une base de production** : mots de passe faibles connus,
  domaines fictifs, boîtes locales.
