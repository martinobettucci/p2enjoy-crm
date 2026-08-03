# P2Enjoy CRM

CRM de suivi de projets commerciaux, organisé en **Tracks** → **Channels** → **Cards**, avec
workflows à transitions contraintes, formulaires conditionnels par étape, et une messagerie
intégrée (IMAP entrant / SMTP sortant) qui classe les emails dans les cards.

> **État d'avancement — lisez ceci en premier.**
> Le dépôt est en **phase de spécification**. À ce jour, seule la documentation existe : aucun
> code applicatif, aucune migration, aucun conteneur n'est encore livré. Les commandes décrites
> plus bas sont le **contrat** que l'implémentation devra respecter, pas un état constaté.
> L'état réel, unité par unité, est tenu dans [`docs/BACKLOG.md`](docs/BACKLOG.md) ; l'ordre
> d'exécution dans [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md).
> Chaque commande sera documentée comme « disponible » uniquement une fois exécutée et vérifiée.

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
| Interface | React 18, Vite, TypeScript, Tailwind CSS, lucide-react, React Router, TanStack Query, react-hook-form, zod, dnd-kit |
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
npm install
cp .env.example .env          # puis renseigner les valeurs locales
cp .env.dev.example .env.local
```

Aucun secret réel n'est versionné. `.env.example` documente chaque variable : rôle, format,
caractère obligatoire, et valeur d'exemple non sensible.

## 5. Commandes principales

| Commande | Effet |
|---|---|
| `./runDev.sh` | Démarre la pile de développement complète (Supabase, mail-sync, Stalwart, Roundcube, Inbucket, MinIO, webapp) |
| `./runDev.sh --dev` | Idem sans la webapp conteneurisée (utile si Vite tourne dans l'IDE) |
| `./runDev.sh --withLog <composant>` | Suit les journaux d'un composant (`webapp`, `mail-sync`, `supabase`, `stalwart`) |
| `./runProd.sh` | Démarre la pile de production (sans outillage de développement, TLS via Caddy) |
| `./resetMe.sh` | Détruit les volumes locaux, rejoue les migrations et le seed |
| `npm run db:migrate` | Applique les migrations en attente |
| `npm run db:seed` | Rejoue le seed de démonstration |
| `npm run types:generate` | Régénère les types TypeScript depuis le schéma |
| `npm run build` | Build de production de la webapp |
| `npm run stop` | Arrêt propre de tous les services |

## 6. Lancement en développement

```bash
./runDev.sh
```

Services exposés :

| Service | URL / port | Usage |
|---|---|---|
| Webapp | http://localhost:5173 | L'application |
| API Supabase (Kong) | http://localhost:8000 | REST, Auth, Storage, Realtime |
| Supabase Studio | http://localhost:54323 | Inspection de la base |
| Inbucket | http://localhost:54324 | Emails **transactionnels** (invitations, @mentions, relances, digest) |
| Roundcube | http://localhost:8080 | Webmail de vérification : montre les dossiers IMAP créés par le CRM |
| Stalwart | IMAP 1143 · SMTP 1025 | Vrai serveur mail local (boîte système + boîtes de démonstration) |
| MinIO | http://localhost:9001 | Console du stockage S3 local |

**Pourquoi deux serveurs mail en développement ?** Inbucket est un puits SMTP : il capture les
emails que l'application *envoie* (GoTrue, notifications) et n'expose pas d'IMAP. Or le produit
doit *lire* des boîtes en IMAP, y créer des dossiers imbriqués et y déposer des messages :
cela exige un vrai serveur, d'où Stalwart. Roundcube permet de **voir** le résultat, ce qui rend
la vérification visuelle possible.

## 7. Tests

```bash
npm run test:unit          # Vitest (webapp)
npm run test:sql           # pgTAP (fonctions SQL, gardes de transition, helpers RLS)
pytest mail-sync/tests     # unitaires et intégration du service mail
npm run e2e:api            # Playwright — contrats API et refus d'autorisation
npm run e2e:ui             # Playwright — parcours utilisateur
npm run e2e:mail           # Playwright — aller-retour email réel via Stalwart
npm run e2e:report         # Rapport HTML
```

Les tests d'autorisation interrogent la base **directement**, avec les jetons réels de chaque
profil, afin de prouver qu'une opération interdite est refusée même en contournant l'interface.

## 8. Build

```bash
npm run build              # webapp -> webapp/dist
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
```

## 9. Variables d'environnement

Toutes les variables sont documentées dans `.env.example` (rôle, format, obligatoire ou
facultatif, exemple non sensible). Familles principales :

| Famille | Exemples | Remarque |
|---|---|---|
| Base de données | `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` | Obligatoires |
| Jetons Supabase | `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` | Obligatoires, jamais versionnés |
| API | `API_EXTERNAL_URL`, `SUPABASE_PUBLIC_URL`, `KONG_HTTP_PORT` | Obligatoires |
| Stockage | `GLOBAL_S3_BUCKET`, `GLOBAL_S3_ENDPOINT`, `AWS_ACCESS_KEY_ID` | Obligatoires |
| Messagerie | `CRM_INBOUND_DOMAIN`, `MAIL_SYNC_POLL_INTERVAL`, `MAIL_MAX_ATTACHMENT_MB` | Obligatoires |
| Chiffrement | `VAULT_ENC_KEY`, `PG_META_CRYPTO_KEY` | Obligatoires |
| SMTP transactionnel | `SMTP_HOST`, `SMTP_PORT`, `SMTP_ADMIN_EMAIL` | Obligatoires |

Les identifiants IMAP/SMTP **des utilisateurs** ne sont jamais des variables d'environnement :
ils sont saisis dans l'application et chiffrés en base (Supabase Vault).

## 10. Structure du dépôt

```
.
├── docker-compose.yml          Assemblage des services
├── docker-compose.dev.yml      Compléments de développement
├── docker-compose.prod.yml     Compléments de production
├── runDev.sh · runProd.sh · resetMe.sh
├── docs/                       Documentation de référence (voir ci-dessous)
├── supabase/
│   ├── docker/                 Pile Supabase self-hosted, versions épinglées
│   ├── migrations/             SQL versionné
│   ├── functions/              Edge functions Deno
│   └── seed/                   Données de démonstration
├── mail-sync/                  Service Python IMAP/SMTP + ordonnanceur
├── webapp/                     Application React
├── e2e/                        Playwright (api · ui · mail)
└── scripts/                    Bootstrap, seed, types, statut, journaux
```

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
| [`docs/PROD_MIGRATIONS.md`](docs/PROD_MIGRATIONS.md) | Contrat de déploiement |
| [`docs/manual.md`](docs/manual.md) | Manuel utilisateur |
| [`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md) | Contradictions relevées, en attente d'arbitrage |

## 11. Limites connues

- **Rien n'est implémenté à ce jour** : le dépôt contient la spécification, pas le produit.
- **OAuth2 Gmail / Microsoft 365 hors périmètre v1.** La connexion d'une boîte se fait par
  serveur + identifiant + mot de passe applicatif. Les organisations imposant OAuth ne pourront
  pas connecter leurs boîtes tant que l'unité correspondante du backlog n'est pas livrée.
- **Disponibilité de `supabase_vault` et `pg_cron` non vérifiée** dans l'image PostgreSQL
  retenue. Un repli est documenté pour chacun (`pgcrypto` et ordonnanceur applicatif). Le point
  sera tranché avant tout code de messagerie.
- **La production exige des prérequis externes** non fournis par le dépôt : domaine des adresses
  de card, enregistrements DNS, SPF/DKIM/DMARC pour les identités sortantes, certificats TLS.
  Voir [`docs/PROD_MIGRATIONS.md`](docs/PROD_MIGRATIONS.md).
- **Le seed de démonstration n'est pas une base de production** : mots de passe faibles connus,
  domaines fictifs, boîtes locales.
