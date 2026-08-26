# P2Enjoy CRM

CRM de suivi de projets commerciaux, organisé en **Tracks** → **Channels** → **Cards**, avec
workflows à transitions contraintes, formulaires conditionnels par étape, et une messagerie
intégrée (IMAP entrant / SMTP sortant) qui classe les emails dans les cards.

> **État d'avancement — lisez ceci en premier.**
> *Ce bandeau est réécrit à partir de `docs/BACKLOG.md` à chaque livraison, au même titre que le
> `CHANGELOG.md` — règle posée le 2026-08-13 en clôturant INC-019, qui constatait qu'il décrivait un
> dépôt que trois unités avaient dépassé. Dernière relecture : **2026-08-15**.*
>
> **Ce qui est livré ET intégralement vérifié** (`[x]`) : les scripts de lancement (`CRM-002`), les
> migrations d'amorçage (`CRM-003`), le chiffrement des secrets (`CRM-004`), le seed socle
> (`CRM-005`), les types générés (`CRM-006`), le squelette de la webapp (`CRM-007`), le harnais de
> tests (`CRM-008`), l'écran de connexion et la session d'onglet (`CRM-009`), les fonctions
> d'autorisation (`CRM-010`), l'authentification (`CRM-011`), les **droits fins par track et
> channel** (`CRM-012`), le secret de build npm (`CRM-015`), les fonctions edge (`CRM-016`),
> l'ordonnancement `pg_cron` (`CRM-017`), `require_fields` en table de liaison (`CRM-018`),
> `change_channel_workflow` (`CRM-019`), les tracks (`CRM-020`), les channels (`CRM-021`), les
> identités d'équipe sûres (`CRM-022`), le board kanban (`CRM-041`), les commentaires (`CRM-043`),
> la timeline unifiée (`CRM-044`), l'**administration des tracks et des channels** (`CRM-075`),
> l'**éditeur administrateur de workflows** (`CRM-076`), l'infrastructure mail de développement
> (`CRM-050`), le service `mail-sync` (`CRM-051`) et le backfill et la supervision du mail
> (`CRM-059`).
>
> **Ce qui est écrit mais insuffisamment vérifié** (`[~]`) — le code existe, sa preuve n'est pas
> complète, et il ne faut pas s'y fier sans lire l'unité : la pile elle-même (`CRM-001`), les
> colonnes protégées (`CRM-013`), le harnais de preuves d'autorisation (`CRM-014`), le moteur de
> workflow (`CRM-030` à `CRM-037`), les cards et la vue liste (`CRM-040`, `CRM-042`), le
> déplacement entre channels (`CRM-045`), le seed de démonstration (`CRM-046`), le manuel
> (`CRM-047`), la messagerie du produit (`CRM-052` à `CRM-058`), la **corbeille et la restauration**
> (`CRM-077`) et le **versionnement des workflows** (`CRM-078`, première tranche livrée : versions
> immuables et publication ; comparaison, remappage et écrans encore dus).
>
> **Ce qui n'est pas commencé** (`[ ]`) : l'onboarding (`CRM-079`), les sauvegardes (`CRM-080`),
> le snooze (`CRM-081`) et les extensions du chunk 5 (`CRM-060` à `CRM-074`).
>
> **Une limite d'environnement à connaître avant tout.** Le registre d'images Docker est
> actuellement injoignable depuis l'environnement de vérification : `./runDev.sh` s'arrête avant de
> démarrer un service, et **aucune preuve de pile n'est exécutable** — ni `npm run test:sql`, ni
> `e2e:api`, ni `e2e:ui`, ni `e2e:mail`, ni les harnais `scripts/verify-*.sh` qui exigent les
> services. Voir `docs/INCONSISTENCY_REPORT.md`, INC-096. Cela ne dit rien de la qualité du code
> livré ; cela dit que rien de neuf ne peut être **prouvé** tant que le point n'est pas levé.
>
> **Conséquence à connaître avant de lancer l'application** : sans session, l'interface conserve
> les vrais états vides et de refus du backend. Après connexion, elle réutilise le même client avec
> le jeton réel du compte ; aucune autorisation n'est calculée côté navigateur.
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
| Backend | Supabase **self-hosted** (PostgreSQL 17, GoTrue, PostgREST, Realtime, Storage, Edge Runtime/Deno, Kong) |
| Règles métier | PostgreSQL : fonctions `SECURITY DEFINER` + Row Level Security |
| Messagerie | Service Python `mail-sync` (IMAP IDLE, file d'envoi SMTP) ; ordonnancement durable par `pg_cron` |
| Antivirus | ClamAV (pièces jointes entrantes) |
| Stockage | Supabase Storage sur S3 (MinIO en développement) |
| Tests | pgTAP (SQL), Vitest (webapp et modules edge purs), pytest (mail-sync), Playwright (API, UI, mail) |
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
- `age` (1.x) et `realpath`, **uniquement sur l'hôte qui exécute `scripts/backup.sh` ou
  `scripts/restore-drill.sh`**. La pile de développement n'en a pas besoin ; les deux scripts
  REFUSENT de s'exécuter sans `age`, plutôt que de se rabattre sur un autre chiffrement
  (`docs/SPEC-backups.md` §3.4). Ces deux hôtes sont **distincts** : celui qui sauvegarde ne
  détient que des clés publiques et ne peut relire aucune de ses archives ; celui qui restaure
  détient l'identité privée.

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
hasard** chaque secret : mot de passe PostgreSQL, `JWT_SECRET`, clés MinIO, secrets de Realtime. `ANON_KEY` et `SERVICE_ROLE_KEY` sont dérivées du `JWT_SECRET` produit, sous forme de
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
| `./runProd.sh --migrate` | Ouvre la **fenêtre de migration** : applique `supabase/migrations/` par le `migrations-runner`, puis recharge le cache de schéma de PostgREST. Exige la confirmation que l'instantané de VM est pris — « oui » demandé au terminal, ou `--instantane-verifie` hors terminal — et ne réécrit jamais `.env` | **disponible** — `CRM-087`, `docs/JOURNAL.md` décision 489 |
| `./runProd.sh --stop` | Arrêt propre de l'assemblage de production | **disponible** |
| `./resetMe.sh` | Détruit la base et les volumes locaux, redémarre à froid, rejoue migrations et seed | **disponible** |
| `scripts/verify-stack.sh` | Rejoue les preuves de la pile : santé des services, passerelle, Studio, absence d'outillage en production, chaîne de stockage | **disponible** |
| `scripts/backup.sh` | Produit une **sauvegarde chiffrée** de la base, de la clé racine de Vault et du dépôt objet local, dans un répertoire hors du dépôt | **disponible** |
| `scripts/verify-sauvegardes.sh` | Rejoue les preuves de la sauvegarde : archive produite, déchiffrée, dump lu par `pg_restore`, clé racine comparée octet à octet, empreintes recalculées, huit refus dégradés volontairement | **disponible** |
| `scripts/restore-drill.sh` | **Restaure** une archive dans un environnement **jetable**, compare les invariants — dont le déchiffrement effectif d'un secret de Vault — puis détruit ce seul environnement | **disponible** |
| `scripts/verify-restauration.sh` | Rejoue les preuves de la restauration : exercice nominal, témoin objet retrouvé, **clé racine remplacée qui doit faire échouer le déchiffrement**, six refus dégradés, nom jetable usurpé dont le conteneur doit survivre | **disponible** |
| `scripts/backup-supervision.sh` | **Observe** un répertoire de sauvegardes et rend un verdict : présence, fraîcheur, forme, destinataires, effondrement de taille, résidu d'écriture, dérive de rétention, copie hors site, âge du dernier exercice. Ne produit rien, ne supprime rien, ne déchiffre rien — `--cron` se tait quand tout est vert | **disponible** |
| `scripts/verify-exploitation.sh` | Rejoue les preuves de l'exploitation : les neuf contrôles dégradés un à un, la **copie hors site périmée mais recopiée à l'instant** qui doit rester en alerte, les huit refus au code `2`, et les sections exigées du runbook | **disponible** |
| `scripts/verify-functions.sh` | Rejoue les preuves des fonctions edge : runtime, isolation, route Kong, API réelle et journaux différés | **disponible** |
| `scripts/verify-mail-sync.sh` | Rejoue les preuves du service `mail-sync` : durcissement, API interne, absence de port publié, reprise après arrêt, journaux | **disponible** |
| `scripts/verify-mail-inbound.sh` | Rejoue les preuves des comptes entrants IMAP : secret dans Vault, `secret_id` illisible, cloisonnement des boîtes, test de connexion réel contre Stalwart, sept dégradations non complaisantes | **disponible** |
| `scripts/verify-mail-ingestion.sh` | Rejoue les preuves de l'ingestion : trois tables, bucket privé sans politique, relève idempotente d'un email réellement envoyé, EICAR détecté, six dégradations non complaisantes | **disponible** |
| `scripts/verify-mail-envoi.sh` | Rejoue les preuves de la composition : les six refus de la garde, le quota nullable, les trois fonctions du worker fermées au client, l'aller-retour réel, le parcours d'écran, quatre dégradations | **disponible** |
| `scripts/verify-mail-inbox.sh` | Rejoue les preuves de l'inbox globale : qui voit un message non classé, la garde des deux droits du classement, la pièce saine seule téléchargeable, le parcours d'écran au clavier, les captures aux quatre paliers, quatre dégradations | **disponible** |
| `scripts/verify-mail-dossiers.sh` | Rejoue les preuves des dossiers IMAP : assainissement, arborescence lue par un client IMAP tiers, observation visuelle dans Roundcube, renommage propagé, trois dégradations | **disponible** |
| `scripts/verify-mail-classement.sh` | Rejoue les preuves du classement assisté : les règles 1, 2 et 4, la règle 3 figée comme non satisfaisable, le droit d'écriture exigé, l'idempotence, trois dégradations | **disponible** |
| `scripts/verify-mail-outbound.sh` | Rejoue les preuves des identités sortantes SMTP : identité par défaut rabattue et jamais perdue, adresse d'expédition bornée, délai plus patient que le délai de pénalité du serveur, test SMTP réel, huit dégradations | **disponible** |
| `scripts/verify-mail-comptes.sh` | Rejoue les preuves de l'écran de configuration des comptes entrants : câblage de la surface et ordre de l'index, les **cinq noms de contrainte relus en base** sur lesquels l'écran classe ses refus, `secret_id` toujours révoquée, les suites unitaires, l'API, l'interface, les six captures, trois dégradations | **disponible** |
| `scripts/verify-scheduler.sh` | Rejoue les preuves de l'ordonnanceur : pgTAP, passage réel, convergence du job et restauration des ACL | **disponible** |
| `scripts/verify-transition-required-fields.sh` | Rejoue la migration de l'ancien tableau, les cascades, la cohérence de workflow, RLS et le seed des champs exigés | **disponible** |
| `scripts/verify-change-channel-workflow.sh` | Rejoue le remappage global : migration legacy, OID, vrais JWT, concurrence, dégradations et restauration | **disponible** |
| `scripts/verify-formulaire.sh` | Rejoue les preuves d'interface du formulaire de card et de ses états | **disponible** |
| `scripts/verify-commentaires.sh` | Rejoue les preuves du fil de commentaires, du temps réel, des refus et de l'interface | **disponible** |
| `scripts/verify-timeline.sh` | Rejoue la timeline append-only, ses événements, filtres, captures et dégradations | **disponible** |
| `scripts/verify-move-card-to-channel.sh` | Rejoue le déplacement entre channels, sa perte explicite, sa trace et ses refus | **disponible** |
| `scripts/verify-scripts.sh` | Rejoue les preuves des scripts : contrat `.env.example`, amorçage, gardes de profil | **disponible** |
| `scripts/verify-crochets-git.sh` | Rejoue les preuves des crochets Git : commit et push refusés hors de `main` et en `HEAD` détaché, référence distante contrôlée, identité du responsable toujours exigée | **disponible** |
| `scripts/verify-migrations.sh` | Rejoue les preuves des migrations : suite pgTAP, idempotence, refus par défaut mesuré hors interface | **disponible** |
| `scripts/verify-vault.sh` | Rejoue les preuves du chiffrement des secrets : extensions de l'image, chiffrement effectif, cloisonnement par rôle, cycle de vie de la clé racine | **disponible** |
| `scripts/verify-authz.sh` | Rejoue les preuves des fonctions d'autorisation : suite pgTAP, idempotence, comportement sous PostgREST avec des jetons réels | **disponible** |
| `supabase/seed/apply-seed.sh` | Applique le seed socle **et le jeu de démonstration** sur la pile de développement | **disponible** |
| `scripts/verify-seed-demo.sh` | Rejoue les preuves du jeu de démonstration : étapes peuplées, workflow dérivé exercé, aucun channel actif vide, convergence | **disponible** |
| `scripts/verify-seed-demo.sh --empreinte` | N'affiche que l'empreinte de reproductibilité du seed, et sort | **disponible** |
| `scripts/verify-manual.sh` | Rejoue les preuves du manuel utilisateur : chiffres de l'annexe A comparés à la base, captures citées, unités couvertes, libellés réels, absence de secret | **disponible** |
| `scripts/verify-manual.sh --contre-epreuve` | Dégrade une **copie** du manuel et exige que le harnais morde ; ne touche jamais au dépôt | **disponible** |
| `scripts/verify-corbeille.sh` | Rejoue les preuves de la corbeille et de la restauration : traçabilité, captures, pgTAP, Vitest, API et interface aux comptes figés, quatre dégradations réelles et restauration constatée | **disponible** |
| `scripts/verify-corbeille.sh --rapide` | Omet Playwright, et l'annonce dans sa sortie plutôt que de le taire | **disponible** |
| `scripts/verify-modeles-emails.sh` | Rejoue les preuves des modèles d'email : traçabilité, forme de la table et privilèges mesurés dans le catalogue, la liste fermée des douze variables comparée à sa spécification, le jeu de démonstration, pgTAP, contrat d'API, **six dégradations réelles** et restauration constatée octet à octet | **disponible** |
| `scripts/verify-modeles-emails.sh --rapide` | Omet le contrat d'API Playwright, et l'annonce dans sa sortie plutôt que de le taire | **disponible** |
| `scripts/verify-rendu-modeles-emails.sh` | Rejoue les preuves du **rendu** d'un modèle : traçabilité, `security invoker` et privilèges mesurés dans le catalogue, la substitution mesurée sur les données réelles du seed, la couverture nom à nom de la liste fermée par la carte de valeurs du rendu, pgTAP, contrat d'API, **sept dégradations réelles** et restauration constatée octet à octet | **disponible** |
| `scripts/verify-rendu-modeles-emails.sh --rapide` | Omet le contrat d'API Playwright, et l'annonce dans sa sortie plutôt que de le taire | **disponible** |
| `scripts/verify-modeles-emails-ecran.sh` | Rejoue les preuves de l'**écran** des modèles : traçabilité, le guichet mesuré dans le catalogue, la vérification qu'aucun des douze noms n'est recopié dans le code, les règles que seule une lecture du code constate — relecture après écriture, aucune garde de saisie, aucun droit calculé —, pgTAP, unitaires, contrat d'API, parcours E2E, **cinq dégradations réelles** et restauration constatée octet à octet | **disponible** |
| `scripts/verify-modeles-emails-ecran.sh --rapide` | Omet le contrat d'API et le parcours E2E Playwright, et l'annonce dans sa sortie plutôt que de le taire | **disponible** |
| `scripts/verify-sequences-ecran.sh` | Rejoue les preuves de l'**écran des séquences** et de l'**armement depuis l'affaire** : traçabilité, la RPC mesurée dans le catalogue — `security invoker`, `anon` exclu, aucun `set constraints` —, les deux compositions qui NOMMENT leur relation, les règles que seule une lecture du code constate — relecture après écriture, le `0` de la RPC distingué d'un succès, aucune garde de saisie, aucun droit calculé, aucune recopie du prédicat « figée » —, la garde du seed qui vérifie qu'aucune inscription n'est ACTIVE, pgTAP, unitaires, contrat d'API, deux parcours E2E, **sept dégradations réelles** et restauration constatée octet à octet | **disponible** |
| `scripts/verify-sequences-ecran.sh --rapide` | Omet le contrat d'API et les parcours E2E Playwright, et l'annonce dans sa sortie plutôt que de le taire | **disponible** |
| `scripts/verify-mentions.sh` | Rejoue les preuves de la **mention en base** (`CRM-064` tranche 1) : traçabilité, la forme de la relation et ses trois clés étrangères, le retrait de `card_comments.mentions` **et la garde qui compte avant de détruire**, les quatre fonctions d'accès vérifiées comme de vraies DÉLÉGATIONS — elles appellent leur variante paramétrée et ne relisent aucune table d'appartenance —, l'éligibilité mesurée contre la matrice du seed, le refus DOUBLE de la mise à jour, l'absence de publication au temps réel, le seed éprouvé par ce qu'il ne parvient PAS à écrire, **sept dégradations réelles** dont une qui retire la seule éligibilité en laissant tout le reste debout, et restauration constatée | **disponible** |
| `scripts/verify-notifications.sh` | Rejoue les preuves de la **notification** (`CRM-064` tranche 2) : traçabilité, la forme de la table et ses trois clés étrangères, **l'absence** de clé vers la mention, le `check` fermé de `type`, l'index PARTIEL du compteur de non-lues, la production éprouvée **par le geste** — poser une mention produit, une auto-mention ne produit rien mais reste posée, retirer la mention n'efface pas le message —, les **deux refus doubles** à l'insertion et à la suppression, la mise à jour bornée à la seule colonne `read_at`, la délégation à `app.can_read_card` dans la lecture, **la publication au temps réel** — contrôle RÉVISÉ par la sous-tranche 3a, qui l'a rendue vraie —, la suite de la **tranche 1 rejouée intacte**, **huit dégradations réelles** dont une qui fait produire une notification à l'auteur lui-même en laissant table, clés, politiques et privilèges debout, et restauration constatée | **disponible** |
| `scripts/verify-notifications-surface.sh` | Rejoue les preuves de la **surface de réception** (`CRM-064` sous-tranche 3a) : traçabilité, ce que les deux requêtes demandent **et ce qu'elles ne demandent pas**, le canal nommé par son destinataire, l'ordre du serveur, le compteur lu sans corps, le marquage qui demande sa ligne en retour pour distinguer « sans effet » d'un succès, l'ancrage du panneau à l'en-tête, la teinte de marque et non de danger, l'absence de « tout marquer comme lu », la publication au temps réel et la délégation que le flux évalue, les suites du module et du rendu rejouées, **sept dégradations réelles** dont une qui fait compter au compteur les lignes de la page au lieu de celles du serveur en laissant tout le reste debout, et une qui fait NOMMER au panneau la cause d'un propos illisible — la discrétion tombe, le rendu survit —, et restauration constatée par `git diff` | **disponible** |
| `scripts/verify-mentions-composeur.sh` | Rejoue les preuves de l'**émission d'une mention** (`CRM-064` sous-tranche 3b) : traçabilité, la règle d'éligibilité qui n'a toujours **qu'une seule écriture** — ni le module ni la surface n'interrogent une table d'appartenance —, la forme de `public.mentionnables` mesurée dans le catalogue (`security invoker`, `stable`, `anon` révoqué **nommément**), le croisement du seed où la **même personne** est éligible sur une affaire et pas sur l'autre, l'appelant absent de sa propre liste, l'émission **une requête par personne** que la mesure impose, **huit dégradations réelles** dont une qui rend la fonction `SECURITY DEFINER` en laissant tout le reste debout — la liste sort toujours, mais pour `postgres` — et une qui groupe les mentions en un seul `POST`, et restauration constatée **du fichier ET de la base**, que `git diff` ne voit pas | **disponible** |
| `scripts/verify-mail-infra.sh` | Rejoue les preuves de l'infrastructure mail de développement : configuration versionnée, placement des services, variables, domaines convergents, boîtes et rôles, IMAP réel, détection ClamAV, Roundcube | **disponible** |
| `scripts/verify-mail-infra.sh --contre-epreuve` | Dégrade une **copie** des fichiers versionnés et exige que le harnais morde ; ne touche jamais au dépôt | **disponible** |
| `scripts/verify-seed.sh` | Rejoue les preuves du seed : contrat, identifiants stables, connexion réelle, convergence | **disponible** |
| `npm run types:generate` | Régénère les types TypeScript depuis le schéma de la base migrée | **disponible** |
| `npm run types:check` | Vérifie que les types versionnés n'ont pas dérivé du schéma, sans rien réécrire | **disponible** |
| `npm run typecheck` | `tsc --noEmit` sur les quatre projets : types générés, application, tests, outillage | **disponible** |
| `scripts/verify-types.sh` | Rejoue les preuves des types générés : déterminisme, garde anti-dérive éprouvée par le fichier **et par le schéma**, assertions | **disponible** |
| `npm run dev` | Vite en développement, hors conteneur | **disponible** |
| `npm run build` | Build de production de la webapp vers `webapp/dist` | **disponible** |
| `npm run preview` | Sert le build produit, utilisé par les preuves E2E | **disponible** |
| `npm run test:unit` | Tests unitaires de la webapp et des modules edge purs (Vitest) | **disponible** |
| `npm run e2e:ui` | Scénarios E2E de l'interface et captures (Playwright) | **disponible** |
| `scripts/verify-webapp.sh` | Rejoue les preuves du squelette : build, jetons, états, clavier, captures | **disponible** |
| `scripts/verify-harness.sh` | Rejoue les preuves du harnais de tests : exécuteurs, projets, non-complaisance | **disponible** |
| `scripts/verify-tracks.sh` | Rejoue les preuves des tracks : modèle, ordre, archivage, politiques RLS, seed, non-complaisance | **disponible** |
| `scripts/verify-channels.sh` | Rejoue les preuves des channels : modèle, cloisonnement par clé composite, ordre par track, archivage, politiques RLS, seed, non-complaisance | **disponible** |
| `scripts/verify-catalogue.sh` | Rejoue les preuves du catalogue de nœuds : modèle, bornes, ordre par workspace, archivage, politiques RLS, seed, non-complaisance | **disponible** |

Les trois scripts acceptent `--help`. Ils s'appuient sur le fichier `.env` de la racine, ou sur
celui que désigne la variable `P2ENJOY_ENV_FILE` — ce qui permet aux preuves de travailler sur un
fichier jetable sans toucher à la configuration du poste.

L'arrêt propre passe par `./runDev.sh --stop` et `./runProd.sh --stop`.

**Les scripts sont la façade canonique, et `npm` ne les double jamais** (INC-008, close le
2026-08-13). Le `package.json` livré par `CRM-006` porte les commandes qui appartiennent réellement
à la chaîne Node — types, build, tests — et rien d'autre. `npm run stop`, `npm run dev` au sens de
la pile, `npm run db:migrate` et `npm run db:seed` ont été annoncés par des versions antérieures de
ce document : **ils n'existent pas et n'existeront pas**. Deux façades pour un même geste font
diverger la documentation de l'une des deux. Les migrations sont appliquées par le
`migrations-runner` au démarrage de la pile, et le seed par `supabase/seed/apply-seed.sh`.

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
| Fichier d'environnement complet | les trois scripts | Refus si une variable à exemple non vide manque, est vide ou vaut encore `CHANGE_ME_*` ; une variable facultative à exemple vide peut être omise |
| `P2ENJOY_ENV_PROFILE=dev` | `runDev.sh`, `resetMe.sh` | Refus d'agir sur un fichier décrivant un autre environnement |
| `NPM_CA_FILE` non vide | `runDev.sh`, `resetMe.sh` | Refus avant Docker si le chemin n'est pas absolu ou ne désigne pas un fichier PEM régulier, lisible et non vide |
| `PIP_CA_FILE` non vide | `runDev.sh`, `resetMe.sh` | Même garde, pour `pip install` dans l'image `mail-sync` (décision 356) |
| `P2ENJOY_ENV_PROFILE=prod` | `runProd.sh` | Refus de démarrer la production avec les secrets du développement |
| `APPLY_MIGRATIONS=false` | `runProd.sh` | Refus de démarrer si le fichier d'environnement de production autorise les migrations. L'invariant garantit qu'un lancement ordinaire, un redémarrage d'hôte ou le redéploiement d'un service **ne migrent rien** ; la fenêtre de migration surcharge la valeur pour sa seule invocation (`docs/PROD_MIGRATIONS.md` §3.1) |
| Confirmation explicite | `resetMe.sh` | `oui` à la demande, ou `--yes` hors terminal interactif |
| Aucun amorçage en production | `runProd.sh` | Le script n'invente jamais de secret : les valeurs de production sont produites par un humain |

## 6. Lancement en développement

```bash
./runDev.sh
scripts/verify-stack.sh
scripts/verify-scripts.sh
```

Le premier lancement amorce `.env` (voir §4) ; les suivants le conservent tel quel, et le
complètent des variables introduites depuis — un `.env` créé avant une unité n'est pas un
cul-de-sac. Une variable **effacée** reste refusée : seules celles qu'une unité a ajoutées après
coup sont complétées, et la liste en est explicite dans `scripts/lib/env.sh`.

À la fin du démarrage, le script rappelle les **identifiants de développement** : les trois comptes
seedés et leur mot de passe commun, les trois boîtes mail, puis l'administration de PostgreSQL,
Stalwart, MinIO et de l'API interne de `mail-sync`. Ce sont des secrets **locaux et jetables** — le
profil `dev` est exigé, les domaines sont sous des TLD réservés par la RFC 2606 donc non routables,
et les ports ne sont publiés que sur la boucle locale. Le mot de passe des comptes est lu dans
`supabase/seed/apply-seed.sh`, jamais recopié dans les scripts.

Repartir d'une base vierge :

```bash
./resetMe.sh          # détruit la base et les volumes, redémarre à froid, rejoue migrations et seed
```

Sur un réseau qui interpose sa propre autorité TLS devant le registre npm, fournir le **chemin**
du paquet PEM de l'hôte — jamais son contenu — pour la construction de l'image Vite :

```bash
NPM_CA_FILE=/chemin/absolu/autorites.pem PIP_CA_FILE=/chemin/absolu/autorites.pem ./runDev.sh
```

La variable peut aussi vivre dans `.env`. Une valeur exportée par le shell prévaut, comme dans
Compose. Le fichier doit être régulier, lisible, non vide et contenir un bloc
`BEGIN CERTIFICATE`; la garde le refuse avant Docker sinon. Variable absente, vide ou omise d'un
ancien `.env` : le build reste strictement inchangé. Le certificat reste sur l'hôte, n'est jamais
copié dans le dépôt ou l'image et ne concerne pas la production.

Le service `mail-sync` porte le même contournement pour `pip`, mais **sans variable
d'environnement** — `docs/JOURNAL.md` décision 342 : `runDev.sh` ne le câble pas, et le geste reste
manuel, à la construction directe de l'image :

```bash
docker build --secret id=pip_ca,src=/chemin/absolu/autorites.pem -f mail-sync/Dockerfile -t p2enjoy-crm-mail-sync .
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

Quatre boîtes sont provisionnées au démarrage, par la **véritable API de gestion** de Stalwart, et
non par une écriture directe dans son magasin. Le provisionnement est convergent : le rejouer ne
duplique rien, rétablit une valeur modifiée à la main, et **ne détruit aucun message**.

| Adresse | Nature | Compte du seed |
|---|---|---|
| `systeme@crm.p2enjoy.test` | Boîte **système** du workspace, catch-all de `@crm.p2enjoy.test` | — |
| `admin@p2enjoy.test` | Boîte personnelle | Camille Aubert, `admin` |
| `bizdev@p2enjoy.test` | Boîte personnelle | Driss Lemoine, `business_developer` |
| `leo.marchand@sogexia.example` | Boîte d'un **correspondant extérieur**, hors du produit | Léo Marchand, contact du carnet |

Mot de passe commun : **`SeedDev2026Local`**, le même que celui des comptes seedés. Il ne protège
rien, et c'est délibéré : les domaines sont sous `.test` et `.example`, TLD réservés par la
RFC 2606 donc non routables, et les ports ne sont publiés que sur la boucle locale. Farida Nowak
(`viewer`) n'a pas de boîte : un `viewer` lit, il ne correspond pas.

**La quatrième boîte n'appartient pas au produit**, et son adresse est portée par la variable
`MAIL_DEV_CORRESPONDENT_ADDRESS`. Elle existe pour **émettre** : le jeu de démonstration lui fait
expédier un courrier vers la boîte système, et comme son adresse est celle d'un **contact** du
carnet, ce courrier arrive non classé **et suggéré** — c'est ce qui rend la suggestion de classement
démontrable à l'écran. Le CRM ne relève **jamais** dedans : aucune ligne de `mail_inbound_accounts`
ne la désigne, et `scripts/verify-mail-infra.sh` devient rouge si l'une venait à le faire.

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

> **Ces identités sont lisibles selon l'équipe depuis `CRM-022`.** L'anonyme reçoit toujours zéro
> ligne. Un membre lit son workspace, ses memberships et les profils qui le partagent ; seul un
> administrateur gère les rôles, et le seed ne pose aucun droit hors des politiques migrées.

Le contrat complet — mécanismes employés, convention d'identifiants, preuves exigées — est dans
[`docs/SPEC-seed.md`](docs/SPEC-seed.md).

## 7. Tests

Sur un poste NVM, exécuter d'abord `nvm use` comme indiqué au §3. Les commandes `npm run …`
directes utilisent toujours la chaîne Node du shell courant. `scripts/verify-harness.sh`, lui,
valide sa chaîne avant toute dégradation et peut sélectionner une version compatible déjà
installée par NVM sans modifier le shell parent.

```bash
npm run typecheck          # TypeScript, quatre projets   — aucune pile requise
npm run test:unit          # Vitest, 564 tests            — aucune pile requise
npm run test:sql           # pgTAP, 1698 assertions       — pile démarrée
npm run e2e:api            # Playwright — contrats API et refus, hors interface  (pile + seed)
npm run e2e:ui             # Playwright — parcours utilisateur et captures       (pile)
npm run e2e:mail           # Playwright — IMAP, SMTP, ClamAV et Roundcube réels  (pile)
npm run e2e:report         # sert le dernier rapport HTML sur http://localhost:9323
pytest mail-sync/tests     # pytest, 40 tests du service mail-sync — aucune pile requise
```

Les tests d'autorisation interrogent la base **directement**, avec les jetons réels de chaque
profil, afin de prouver qu'une opération interdite est refusée même en contournant l'interface.

Les huit commandes sont livrées et prouvées. `npm run e2e:mail` l'est **depuis `CRM-050`** : il
exerce les protocoles — session IMAP sur les trois boîtes, soumission SMTP authentifiée, remise par
le catch-all et relecture, détection réelle d'EICAR par ClamAV, et Roundcube à l'écran. Depuis
`CRM-051`, il exerce aussi le service `mail-sync` par le réseau Compose. L'aller-retour d'email
**du produit** reste dû par `CRM-054` et `CRM-058` : rien dans le CRM ne lit encore ces boîtes.

`pytest mail-sync/tests` est livré **depuis `CRM-051`**, avec son sujet. Il n'a pas besoin de la
pile : le service est exercé par le `TestClient` de Starlette, et son état durable dans un
répertoire temporaire. La preuve du conteneur réel — durcissement, réseau, reprise après arrêt —
appartient à `scripts/verify-mail-sync.sh` et à `e2e/mail/mail-sync.spec.ts`. Le responsable avait
retiré cette commande de la DoD de `CRM-008` — décision 277, INC-023 — plutôt que de créer un
harnais vide ; elle y revient avec ce qu'elle éprouve.

L'environnement Python attendu est un `.venv` à la racine, créé une fois :

```bash
python3 -m venv .venv
.venv/bin/pip install -r mail-sync/requirements-dev.txt
.venv/bin/python -m pytest mail-sync/tests
```

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
scripts/verify-functions.sh    # fonctions edge : runtime, Kong, API et journaux    (CRM-016)
scripts/verify-scheduler.sh    # pg_cron : passage, convergence et ACL               (CRM-017)
scripts/verify-scripts.sh      # scripts de lancement et contrat d'environnement    (CRM-002)
scripts/verify-migrations.sh   # migrations, suite pgTAP, refus par défaut          (CRM-003)
scripts/verify-vault.sh        # chiffrement des secrets de messagerie              (CRM-004)
scripts/verify-authz.sh        # fonctions d'autorisation, jetons réels             (CRM-010)
scripts/verify-auth.sh         # GoTrue + contenu des emails transactionnels (CRM-011, CRM-009)
scripts/verify-seed.sh         # seed socle : contrat, identifiants stables, convergence  (CRM-005)
scripts/verify-types.sh        # types générés : déterminisme, garde anti-dérive        (CRM-006)
scripts/verify-webapp.sh       # webapp : build/chunks, jetons, états, clavier, console (CRM-007)
scripts/verify-node-toolchain.sh # résolution Linux de Node/npm, sans pile             (CRM-008)
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
scripts/verify-transition-required-fields.sh # champs exigés : liaison, migration, RLS (CRM-018)
scripts/verify-change-channel-workflow.sh # workflow d'un channel : mapping, concurrence (CRM-019)
scripts/verify-identites.sh  # identités d'équipe, dernier admin, avatars et parole (CRM-022)
scripts/verify-formulaire.sh   # formulaire de card : données, refus, états et captures (CRM-037)
scripts/verify-commentaires.sh # commentaires : RLS, temps réel, panneau et captures (CRM-043)
scripts/verify-timeline.sh     # timeline : mémoire append-only, filtres et captures (CRM-044)
scripts/verify-move-card-to-channel.sh # déplacement entre channels et perte explicite (CRM-045)
scripts/verify-seed-demo.sh    # jeu de démonstration complet : toutes les étapes peuplées (CRM-046)
scripts/verify-manual.sh       # manuel utilisateur : annexe A, captures, libellés réels  (CRM-047)
scripts/verify-ma-journee.sh   # « Ma journée » : sections, bornes, portée, seed daté  (CRM-061)
scripts/verify-corbeille.sh    # corbeille : modèle, garde, écran, gestes, non-complaisance (CRM-077)
scripts/verify-modeles-emails.sh # modèles d'email : liste fermée des variables, RLS, seed (CRM-063)
scripts/verify-rendu-modeles-emails.sh # rendu d'un modèle : substitution, trous nuls nommés (CRM-063)
scripts/verify-modeles-emails-ecran.sh # écran des modèles : palette, prévisualisation, suppression (CRM-063)
scripts/verify-sequences-ecran.sh    # écran des séquences et armement depuis l'affaire (CRM-063)
```

La cible courante de `scripts/verify-harness.sh` est **28 contrôles** : sélection de Node
**v24.14.1** / npm **11.11.0** Linux, 22 fichiers pgTAP / 1612 assertions, 439 scénarios API,
144 parcours UI, 16 scénarios mail, 532 tests Vitest, les quatre compilations TypeScript et le
rapport HTML servi en HTTP. Les parcours UI échouent sur tout `console.warn`, `console.error` ou
`pageerror`. La dernière preuve froide, exécutée le 2026-08-09 pour `CRM-019`, rend **28/28** :
22 fichiers / 1612 assertions, 439 scénarios API, 144 parcours UI sans avertissement, 16 scénarios
mail, 532 tests Vitest, quatre compilations TypeScript et rapport HTML servi en HTTP 200.

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

Les **98** variables sont documentées une à une dans `.env.example` : rôle, format attendu,
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
| Build de développement | `NPM_CA_FILE`, `PIP_CA_FILE` | Facultatives. Chemin absolu d'un paquet PEM local, pour `npm ci` dans l'image Vite et pour `pip install` dans l'image `mail-sync` derrière un proxy TLS ; vides ou absentes, aucun effet. Deux variables distinctes : les deux chaînes ne consomment pas le certificat de la même façon (décision 356) |
| Messagerie | `CRM_INBOUND_DOMAIN`, `MAIL_SYNC_INTERNAL_TOKEN`, `MAIL_SYNC_LOG_LEVEL`, `MAIL_SYNC_POLL_INTERVAL`, `MAIL_MAX_ATTACHMENT_MB` | `CRM_INBOUND_DOMAIN` est consommée **depuis `CRM-050`** — Stalwart lui attache la boîte système, et sa valeur doit égaler `workspaces.inbound_domain`. Les deux variables `MAIL_SYNC_INTERNAL_TOKEN` et `MAIL_SYNC_LOG_LEVEL` le sont **depuis `CRM-051`** : le service refuse de démarrer sous 32 caractères de jeton. **`MAIL_SYNC_POLL_INTERVAL` est consommée depuis `CRM-059`** : elle règle l'intervalle de la boucle de veille, en secondes. `0` **désactive** la veille — la relève reste alors déclenchable par l'API interne — et toute autre valeur doit tenir entre **5 secondes et 1 heure**, bornes appliquées au démarrage et non corrigées en silence. `MAIL_MAX_ATTACHMENT_MB` l'est depuis `CRM-054` |
| Messagerie de développement | `STALWART_IMAP_PORT`, `STALWART_SMTP_PORT`, `STALWART_SUBMISSION_PORT`, `STALWART_ADMIN_PORT`, `STALWART_ADMIN_USER`, `STALWART_ADMIN_PASSWORD`, `STALWART_MAILBOX_PASSWORD`, `MAIL_DEV_PERSONAL_DOMAIN`, `MAIL_DEV_CORRESPONDENT_ADDRESS`, `ROUNDCUBE_PORT`, `CLAMAV_PORT` | Obligatoires **en développement uniquement** : aucun de ces services n'existe en production. `STALWART_ADMIN_PASSWORD` est tiré au hasard à l'amorçage |
| Chiffrement | `PG_META_CRYPTO_KEY`, `REALTIME_DB_ENC_KEY` | Obligatoires. Longueurs imposées : 32 et 16 caractères. Les secrets de messagerie ne sont pas ici : ils vivent dans le Vault de la base, chiffrés par sa clé racine (décision 366, INC-098) |
| Authentification | `DISABLE_SIGNUP`, `PASSWORD_MIN_LENGTH`, `JWT_EXPIRY` | Obligatoires. `DISABLE_SIGNUP` vaut **toujours** `true` (`docs/SPEC-auth.md` §2) |
| SMTP transactionnel | `SMTP_HOST`, `SMTP_PORT`, `SMTP_ADMIN_EMAIL` | Obligatoires |
| Pile | `STACK_RLIMIT_NOFILE`, `APPLY_MIGRATIONS` | Facultatives, avec défauts. `APPLY_MIGRATIONS=false` est imposé en production **et doit y rester** : c'est ce qui empêche une migration non décidée. Les migrations de production s'appliquent dans une fenêtre de maintenance ouverte par `./runProd.sh --migrate`, qui surcharge la variable pour sa seule invocation sans réécrire `.env`, et dont le retour arrière est la restauration de l'instantané de VM (décision 489, `CRM-087`) |
| Production | `APP_DOMAIN`, `CADDY_ACME_EMAIL` | Obligatoires en production uniquement |
| Sauvegardes | `BACKUP_AGE_RECIPIENTS_FILE`, `BACKUP_OUTPUT_DIR`, `BACKUP_RETENTION_DAYS`, `RESTORE_AGE_IDENTITY_FILE` | Lues par `scripts/backup.sh` et `scripts/restore-drill.sh` **depuis `CRM-080`**, jamais par un service. `RESTORE_AGE_IDENTITY_FILE` désigne la **clé privée** et n'a rien à faire sur l'hôte qui sauvegarde : l'y poser annulerait la propriété que le chiffrement par destinataires publics apporte. Toutes quatre à exemple **vide** : la pile de développement ne sauvegarde rien, et une valeur d'exemple non vide ferait exiger par les gardes un fichier de clés que `./runDev.sh` n'a aucune raison de réclamer. `BACKUP_AGE_RECIPIENTS_FILE` ne porte que des clés **publiques** ; la clé privée vit hors de l'hôte qui sauvegarde, et le script ne la lit jamais |
| Exploitation des sauvegardes | `BACKUP_MAX_AGE_HOURS`, `BACKUP_MIN_RECIPIENTS`, `BACKUP_OFFSITE_DIR`, `BACKUP_DRILL_STAMP_FILE`, `BACKUP_DRILL_MAX_AGE_DAYS` | Lues par `scripts/backup-supervision.sh` **depuis `CRM-080` tranche 3**, jamais par un service. Toutes facultatives, à exemple **vide** : les trois entières prennent leur défaut — 26 heures, 1 destinataire, 30 jours —, et les deux qui désignent un chemin rendent leur contrôle **non applicable** plutôt que vert, la supervision ne verdissant jamais un contrôle qu'elle n'a pas fait. `BACKUP_MAX_AGE_HOURS` vaut 26 et non 24 : une sauvegarde quotidienne décalée par une charge de l'hôte dépasserait `24` sans qu'il se soit rien passé, et une alerte qui se déclenche seule apprend à être ignorée |

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
├── package.json                Projet npm unique : types, webapp, E2E et modules edge purs
├── tsconfig.json               Compilation stricte des types générés et de leurs assertions
├── tsconfig.tools.json         Compilation des configurations et des scénarios E2E
├── docs/                       Documentation de référence (voir ci-dessous)
├── scripts/
│   ├── lib/env.sh              Socle commun des scripts : lecture, amorçage, validation, gardes
│   ├── verify-stack.sh         Preuves rejouables de la pile
│   ├── verify-functions.sh     Preuves rejouables du runtime edge, de Kong et de ses journaux
│   ├── verify-scheduler.sh     Preuves rejouables de pg_cron, de son job et de ses ACL
│   ├── verify-transition-required-fields.sh  Preuves de la liaison des champs exigés
│   ├── verify-change-channel-workflow.sh  Preuves du remappage global et de sa concurrence
│   ├── verify-formulaire.sh    Preuves du formulaire de card
│   ├── verify-commentaires.sh  Preuves des commentaires et de leur panneau
│   ├── verify-timeline.sh      Preuves de la timeline unifiée et de ses filtres
│   ├── verify-move-card-to-channel.sh  Preuves du déplacement entre channels
│   ├── verify-corbeille.sh     Preuves de la corbeille, de ses gestes et de sa restauration
│   ├── verify-modeles-emails.sh Preuves des modèles d'email et de leurs variables fermées
│   ├── verify-rendu-modeles-emails.sh Preuves du rendu d'un modèle et de ses trous nuls
│   ├── verify-modeles-emails-ecran.sh Preuves de l'écran des modèles et de sa prévisualisation
│   ├── verify-sequences-ecran.sh  Preuves de l'écran des séquences et de l'armement
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
│   ├── functions/              Routeur Deno et fonctions edge, montés en lecture seule
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
│   ├── api/                    Contrats directs de Kong, PostgREST, GoTrue et Edge Runtime
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

Le service Python livré par `CRM-051` :

```
mail-sync/
├── src/mail_sync/          Configuration, état durable, journaux JSONL, API interne
├── tests/                  pytest — 40 cas, sans pile
└── Dockerfile              Image épinglée, utilisateur non privilégié, racine en lecture seule
```

Le répertoire des fonctions edge livré par `CRM-016` est volontairement petit et sans dépendance
distante :

```
supabase/functions/
├── main/                       Service principal, routeur validé et tests purs
└── example/                    Fonction sans effet, handler HTTP pur et tests
```

Kong est l'unique entrée : `/functions/v1/example` exige une clé d'API avant de joindre un worker
`oneshot`, et le conteneur ne publie aucun port. Ce porteur servira à l'invitation d'un membre
(`CRM-070`) et aux webhooks sortants signés (`CRM-073`) ; ces fonctions métier ne sont pas encore
livrées. La logique métier existante reste en PostgreSQL et `mail-sync` reste un service Python.

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
| [`docs/SPEC-transition-required-fields.md`](docs/SPEC-transition-required-fields.md) | Table de liaison des champs exigés par une transition, migration et preuves |
| [`docs/SPEC-form-composer.md`](docs/SPEC-form-composer.md) | Champs conditionnels par étape |
| [`docs/SPEC-mail-subsystem.md`](docs/SPEC-mail-subsystem.md) | IMAP, SMTP, classement, dossiers |
| [`docs/SPEC-permissions-rls.md`](docs/SPEC-permissions-rls.md) | Rôles, RLS, preuves de refus |
| [`docs/SPEC-auth.md`](docs/SPEC-auth.md) | Authentification, sessions, cycle de vie d'un compte |
| [`docs/SPEC-seed.md`](docs/SPEC-seed.md) | Données de développement : contrat du seed, identifiants stables |
| [`docs/SPEC-types.md`](docs/SPEC-types.md) | Types TypeScript générés depuis le schéma, garde anti-dérive |
| [`docs/SPEC-webapp.md`](docs/SPEC-webapp.md) | Squelette de la webapp : chaîne de build, jetons, coquille, états |
| [`docs/SPEC-test-harness.md`](docs/SPEC-test-harness.md) | Harnais de tests : exécuteur pgTAP, projets Playwright, rapport |
| [`docs/SPEC-edge-functions.md`](docs/SPEC-edge-functions.md) | Runtime Deno, route Kong, sécurité, exemple et preuves Edge |
| [`docs/PROD_MIGRATIONS.md`](docs/PROD_MIGRATIONS.md) | Contrat de déploiement |
| [`docs/manual.md`](docs/manual.md) | Manuel utilisateur |
| [`docs/INCONSISTENCY_REPORT.md`](docs/INCONSISTENCY_REPORT.md) | Contradictions relevées, en attente d'arbitrage |

## 11. Limites connues

- **La production applique ses migrations par un geste de maintenance, jamais par accident.**
  `./runProd.sh --migrate` (livré par `CRM-087`, `docs/JOURNAL.md` décision 489) ouvre la fenêtre
  décrite au §3.1 de `docs/PROD_MIGRATIONS.md` : le geste surcharge `APPLY_MIGRATIONS` pour la
  seule invocation, exige la confirmation que l'instantané de VM est pris (« oui » demandé au
  terminal, `--instantane-verifie` hors terminal), force la recréation du `migrations-runner`, et
  le runner émet `notify pgrst, 'reload schema'` une seule fois en fin de passage réussi. Le
  retour arrière est la **restauration de l'instantané de VM**, qui détruit tout ce qui a été
  écrit depuis. La fenêtre est donc à ouvrir avec l'accès utilisateur fermé, et la restauration
  éprouvée reste à couvrir par `CRM-080`.
- **L'administration métier est partielle.** L'arborescence — créer, renommer, réordonner,
  archiver et désarchiver un track ou un channel — a son écran depuis `CRM-075`. Restent sans
  surface : l'**éditeur de workflows** (`CRM-076`), la définition des **formulaires**, la
  **corbeille** (`CRM-077`) et l'administration des **membres** (`CRM-070`). La **fiche d'une
  affaire reste en lecture seule** : le formulaire conditionnel est rendu, validé et prouvé côté
  base, mais l'enregistrement depuis l'écran est dû par `CRM-037` (INC-088). Voir
  [`docs/BACKLOG.md`](docs/BACKLOG.md) pour l'état exact unité par unité.
- **La messagerie du produit est écrite, et aucune de ses unités n'est intégralement prouvée.**
  Depuis `CRM-050` et `CRM-051` — les deux seules `[x]` de la chaîne — Stalwart, Roundcube, ClamAV
  et le service `mail-sync` démarrent avec la pile. Les comptes entrants, les identités sortantes,
  l'ingestion, le classement, les dossiers IMAP, l'inbox globale, la composition et le backfill
  (`CRM-052` à `CRM-059`) sont **tous `[~]`** : le code existe, la preuve est incomplète. Ne pas
  s'appuyer sur cette chaîne sans lire l'unité concernée dans le backlog.
- **Stalwart n'expose volontairement aucune console web.** Sa racine HTTP sert une page locale
  explicative, sans téléchargement au démarrage. Tous ses protocoles et son API de gestion
  `/api/*` fonctionnent ; la vérification visuelle passe par Roundcube.
- **Le serveur mail de développement n'emploie aucun TLS**, et ses ports ne sont publiés que sur
  `DEV_BIND_ADDRESS`. C'est un choix documenté (`docs/SPEC-mail-subsystem.md` §11.3) : en
  production, ce sont les serveurs des utilisateurs qui portent le chiffrement. Exposer cette pile
  au-delà de la boucle locale imposerait de revenir sur ce choix.
- **L'administration des membres n'a pas encore d'écran.** Les politiques de `CRM-022` rendent les
  identités de l'équipe lisibles et réservent les mutations de memberships aux administrateurs ;
  la base protège aussi le dernier administrateur. Le parcours d'invitation et l'écran complet de
  gestion restent portés par `CRM-070`.
- **La webapp ne connaît aucune règle d'accès**, par construction : elle affiche ce que le backend
  consent à rendre. Un type ne décrit jamais un droit (voir ci-dessous), et l'interface ne
  masque rien qui ne soit déjà refusé côté base.
- **Les types générés ne décrivent que le schéma, jamais les droits.** Une table en refus par
  défaut se type exactement comme une table ouverte : elle rend simplement zéro ligne à
  l'exécution. Une contrainte `CHECK` ne survit pas non plus à la génération —
  `workspace_members.role` se type `string`, et seule la base refuse une valeur hors vocabulaire.
  Voir [`docs/SPEC-types.md`](docs/SPEC-types.md) §7.
- **Descripteurs de fichiers.** Realtime réclame `STACK_RLIMIT_NOFILE` descripteurs (défaut
  `10000` ; il valait `100000` tant que le pooler Supavisor était de la pile, car c'était sa
  demande à lui — décision 366). Sur un hôte dont la limite dure est inférieure — conteneur sans
  `CAP_SYS_RESOURCE`, par exemple — le service redémarre en boucle tant que la variable n'est pas
  abaissée. `./runDev.sh` détecte le cas lors de l'amorçage : il inscrit la limite dure
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
