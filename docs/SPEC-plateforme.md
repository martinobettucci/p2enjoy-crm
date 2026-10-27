# Spécification — La plateforme : superadministrateurs, espaces, appartenances et attentes

Unité de backlog : `CRM-101` (`docs/BACKLOG.md`).
Décision : `docs/JOURNAL.md` 627 (arbitrages A1 à A4 du responsable, décisions techniques D1 à D8,
2026-10-20).
Documents liés : `docs/SPEC-session-sso.md` §6 (admission, révisée par le §4 ci-dessous),
`docs/SPEC-permissions-rls.md` §2 et §3, `docs/SPEC-identite.md` §5 (invariant du dernier
administrateur), `docs/SPEC-mcp.md` (le connecteur, qui s'appuie sur ce document), `docs/SCHEMA.md`
§1 bis, `docs/DAT.md` §7, `docs/DESIGN_SYSTEM.md` (section de l'écran, écrite avec la tranche T3),
`docs/manual.md` (chapitre 32 du plan public, écrit avec la tranche T4).

Écrite le 2026-10-20 **avant la première ligne de code**.

---

## 1. Objet, et ce que cette unité ne livre pas

**Le manque constaté.** Le CRM n'offre aucun écran pour créer un espace de travail, ni pour gérer
ses appartenances et ses attentes. `public.workspaces` n'est même pas inscriptible par un client :
`0021` n'accorde que `select` à `authenticated`. Un espace naît aujourd'hui par
`scripts/spark/amorcer-espace.sh`, sous la clé de service, sur instruction d'exploitation.
L'invitation d'un membre appartient à `CRM-070`, qui n'est pas commencée.

**Ce que livre `CRM-101` :**

- le **superadministrateur de la plateforme**, avec son amorçage unique (§2, §3) ;
- l'admission d'un superadministrateur sans appartenance (§4) ;
- les fonctions de la plateforme (§6) : créer, renommer et supprimer un espace, poser, changer et
  retirer une appartenance, inscrire et retirer une attente, accorder et retirer le drapeau ;
- l'écran `/plateforme` (§7), réservé aux superadministrateurs.

**Hors périmètre, et nommé comme tel :**

- l'écran d'un **administrateur d'espace** qui gère ses propres membres, et les **droits fins** par
  track et channel. Ils restent à `CRM-070`, qui pourra réutiliser l'écran du §7 limité à un espace ;
- le connecteur MCP et sa matrice : `docs/SPEC-mcp.md`, unités `CRM-102` à `CRM-104`. Le connecteur
  réutilise ici le drapeau, l'amorçage et le journal de la plateforme ;
- toute écriture chez LeLabs : le CRM ne crée, ne vérifie et ne retire aucun compte du SSO.

## 2. Qui est superadministrateur — arbitrage A1

**Est superadministrateur** la personne dont l'appel satisfait `app.est_superadmin()`, c'est-à-dire :

1. **ou bien** le jeton interne porte `lelabs_admin: true`, c'est-à-dire le rôle de realm `admin`
   de LeLabs (règle 2 du domaine, `docs/SSO.md` ; décision 597) ;
2. **ou bien** `public.superadmins` contient une ligne pour `auth.uid()`. C'est le **drapeau en
   base**, amorcé une seule fois (§3), puis accordé et retiré par un superadministrateur (§6.5).

**Ce que chacun des deux reçoit (décision 627, D7) :**

| | Porteur d'`admin` LeLabs | Superadministrateur en base |
|---|---|---|
| Gérer la plateforme (§6) et le connecteur MCP | oui | oui |
| Administrateur de **tout** espace, sans appartenance (décision 597) | **oui, inchangé** | **non** : il s'ajoute lui-même à un espace s'il veut y travailler (§6.3) |
| Admis à une session sans appartenance ni attente | oui (§6.1 bis de `SPEC-session-sso`) | **oui**, depuis cette unité (§4) |
| Durée de vie du pouvoir | celle du jeton, relu toutes les 300 s au plus | celle de la ligne ; un retrait agit à la requête suivante, la base étant relue à chaque appel |

Le drapeau en base **n'élargit aucune politique RLS des données métier**. Il n'ouvre que les
fonctions de la plateforme et du connecteur, qui le testent elles-mêmes. Un superadministrateur en
base sans appartenance ne lit donc ni track, ni affaire, ni coût. Ce choix est délibéré : un pouvoir
d'exploitation n'est pas un accès aux données commerciales. S'il en a besoin, il se donne une
appartenance, et ce geste est journalisé (§5.2).

## 3. L'amorçage unique — `CRM_SUPERADMINS_INITIAUX`

**Règle.** Tant que `public.superadmins` est **vide**, une personne dont l'adresse **vérifiée**
figure dans `CRM_SUPERADMINS_INITIAUX` devient superadministratrice à sa connexion admise. Dès qu'une
ligne existe, la variable **n'a plus aucun effet**. Le produit ne vide jamais la table : le dernier
superadministrateur ne se retire pas (§6.5). Seule une opération hors produit pourrait la vider, et
l'amorçage redeviendrait alors possible ; `plateforme_journal` garde la trace de chaque amorçage
(§5.2).

- **Format de la variable :** des adresses séparées par des virgules ; les espaces de bord sont
  ignorés ; la comparaison se fait en minuscules. Une liste vide, l'absence de variable ou une
  adresse mal formée n'amorcent rien, sans erreur de démarrage : l'amorçage est facultatif, un
  porteur d'`admin` LeLabs gérant déjà la plateforme.
- **L'unique point d'écriture :** `app.amorcer_superadmin(p_sub uuid, p_email text, p_nom text,
  p_liste text[]) returns boolean`.
  - **Forme :** `SECURITY DEFINER`, `search_path` vide, propriétaire `postgres`, aucun privilège
    public (le schéma `app` n'est pas exposé).
  - **Ce qu'elle fait :** elle prend `pg_advisory_xact_lock(hashtext('p2enjoy-crm/superadmins'))`,
    puis vérifie que la table est vide et que l'adresse normalisée figure dans la liste normalisée.
    Si c'est le cas, elle crée le profil s'il manque (même chaîne de repli du nom que
    `ouvrir_session_sso`, `docs/SPEC-session-sso.md` §6.2, point 3), insère la ligne
    (`accorde_par = null`), journalise `superadmin_amorce` et rend `true`. Sinon, elle rend `false`
    sans rien écrire.
  - **Concurrence :** deux premières connexions simultanées de deux adresses listées n'amorcent
    qu'**une** personne. Le verrou sérialise, et la seconde trouve la table non vide.
- **Qui l'appelle**, et seulement après avoir vérifié le jeton LeLabs, l'adresse vérifiée
  (`email_verified = true`) et le rôle `verified` :
  - `public.ouvrir_session_serveur` et `public.renouveler_session_serveur`, qui reçoivent un
    paramètre de plus, `p_superadmins_initiaux text[] default '{}'`, et l'appellent **avant**
    l'admission ;
  - `public.mcp_inscrire_compte` (`docs/SPEC-mcp.md` §7), au retour du SSO du mandataire.
- **D'où vient la liste.** Le worker `session` la reçoit de `main/environnement.ts`, qui la remet à
  ce seul worker, et la passe à l'appel. Le service `mcp` la lit dans son propre environnement. La
  base ne lit aucune variable d'environnement.

**Pourquoi l'amorçage n'est pas fait par le script d'exploitation.** Cela aurait rouvert la clé de
service à la main pour un geste que la première connexion fait déjà, et l'amorçage d'Evoliz
(décision 27 de ce dépôt-là) a prouvé la forme retenue.

## 4. Admission révisée — un superadministrateur entre sans appartenance

`docs/SPEC-session-sso.md` §6.1, condition 3, devient :

> 3. la personne est **membre** d'au moins un espace, ou **attendue** à cette adresse par au moins
>    un, ou porte le rôle de realm **`admin`** (§6.1 bis), **ou est superadministratrice en base**
>    (`docs/SPEC-plateforme.md` §4).

Sans cette révision, le superadministrateur amorcé sur une base sans espace serait refusé
(`attente_espace`) et ne pourrait jamais créer le premier espace.

Mise en œuvre dans la migration `0089` :

- `public.ouvrir_session_sso(p_sub, p_email, p_nom, p_admin_lelabs boolean default false)` garde sa
  signature. Elle admet la personne et crée son profil quand une ligne `superadmins` existe pour
  `p_sub`, comme pour le porteur d'`admin`.
- `public.ouvrir_session_serveur` et `public.renouveler_session_serveur` reçoivent
  `p_superadmins_initiaux text[] default '{}'` et appellent `app.amorcer_superadmin` avant
  `ouvrir_session_sso`. Les anciennes signatures sont retirées dans la même migration, comme l'a fait
  `0079`.
- **Le retrait** du drapeau agit à la prolongation suivante, donc au plus tard 300 s après. Sans
  autre motif d'admission, la session est supprimée (`attente_espace`).

La réponse de l'échangeur ne change pas (§5.4 de `SPEC-session-sso`). Le jeton interne **ne porte
pas** le drapeau en base : il est relu en base à chaque appel d'une fonction de la plateforme.

## 5. Modèle de données — migration `0089_plateforme.sql`

Ordinaire, non élevée, idempotente. Aucune donnée existante n'est modifiée.

### 5.1 `public.superadmins`

| Colonne | Type | Règle |
|---|---|---|
| `sub` | `uuid` | PK, FK `profiles` `ON DELETE CASCADE` |
| `accorde_par` | `uuid` | FK `profiles` `ON DELETE SET NULL` ; `null` pour l'amorçage |
| `accorde_le` | `timestamptz` | non nul, `now()` |

**Personne ne la lit par l'API.** La RLS est activée **sans politique**, et tous les privilèges sont
retirés **nommément** à `anon` et `authenticated` (`docs/SCHEMA.md` §9, « un `revoke … from public` ne
suffit pas »). La lecture passe par `plateforme_superadmins()` et l'écriture par
`plateforme_poser_superadmin()`, toutes deux gardées.

### 5.2 `public.plateforme_journal`

| Colonne | Type | Règle |
|---|---|---|
| `id` | `bigint` | PK, identité |
| `acteur` | `uuid` | FK `profiles` `ON DELETE SET NULL` ; `null` pour l'amorçage |
| `geste` | `text` | non nul, `check` fermé (liste ci-dessous) |
| `workspace_id` | `uuid` | sans clé étrangère : l'entrée survit à la suppression de l'espace |
| `cible` | `jsonb` | non nul, `'{}'` par défaut : identifiants et libellés **nécessaires**, jamais de jeton |
| `cree_le` | `timestamptz` | non nul, `now()` ; indexée en ordre décroissant |

**Les gestes :**

- superadministrateurs : `superadmin_amorce`, `superadmin_accorde`, `superadmin_retire` ;
- espaces : `espace_cree`, `espace_modifie`, `espace_supprime` ;
- appartenances : `membre_pose`, `membre_retire` ;
- attentes : `attente_inscrite`, `attente_retiree` ;
- connecteur : `mcp_droits_poses` (`docs/SPEC-mcp.md` §8).

**Règles de la table :** ajout seul. Même fermeture que `superadmins` ; la lecture passe par
`plateforme_journal_liste()`. Rien ne la purge dans cette unité. La rétention fait partie de
`CRM-072`, journal d'audit et RGPD.

### 5.3 Fonctions d'appui

- **`app.est_superadmin() returns boolean`** : `STABLE`, `SECURITY DEFINER` (il lit `superadmins`,
  fermée à l'appelant), `search_path` vide. Elle rend `app.est_admin_lelabs() or exists(select 1 from
  public.superadmins where sub = auth.uid())`. Elle est exécutable par `authenticated` et
  `service_role`, et révoquée à `anon`.
- **`public.est_superadmin() returns boolean`** : `SECURITY INVOKER`, `EXECUTE` à `authenticated`
  seul. Elle rend `app.est_superadmin()`, et l'interface s'en sert pour afficher l'entrée de
  navigation (§7). C'est une aide d'interface, jamais une protection.
- **`app.exiger_superadmin()`** : elle lève `42501 reserve_aux_superadministrateurs` si
  `app.est_superadmin()` est faux. Chaque fonction du §6 l'appelle **en premier**, avant toute
  lecture.

## 6. Les fonctions de la plateforme

**Communes à toutes :**

- `SECURITY DEFINER`, `search_path` vide, propriétaire `postgres` ;
- `EXECUTE` révoqué à `public` et **nommément** à `anon`, accordé à `authenticated` seul ;
- garde `app.exiger_superadmin()` en premier ;
- chaque écriture journalise son geste dans la même transaction.

`SECURITY DEFINER` est nécessaire : un superadministrateur en base n'est membre d'aucun espace, et la
RLS de `workspace_members` et de `workspace_invitations` le refuserait. La garde écrite à la main est
la règle d'accès, et la suite pgTAP la prouve fonction par fonction.

### 6.1 Dictionnaire des refus

| SQLSTATE | Message | Cause |
|---|---|---|
| `42501` | `reserve_aux_superadministrateurs` | l'appelant n'est pas superadministrateur, anonyme compris |
| `P0002` | `espace_introuvable` | l'espace n'existe pas |
| `P0002` | `profil_introuvable` | la personne visée n'a pas de profil |
| `22023` | `nom_invalide` | nom vide après `btrim`, ou plus de 120 caractères |
| `22023` | `identifiant_invalide` | slug hors de `^[a-z0-9]+(-[a-z0-9]+)*$`, ou hors de 2 à 63 caractères (la règle de `amorcer-espace.sh`, rendue exacte) |
| `22023` | `domaine_invalide` | domaine entrant non vide qui n'est pas un nom de domaine en minuscules |
| `22023` | `role_invalide` | rôle hors de `admin`, `business_developer` et `viewer` |
| `22023` | `adresse_invalide` | adresse d'attente qui ne respecte pas la règle de `workspace_invitations` |
| `22023` | `confirmation_incorrecte` | l'identifiant saisi pour supprimer ne correspond pas |
| `23505` | `identifiant_pris` | slug déjà employé |
| `23514` | `last_workspace_admin` | l'invariant existant (`0021`), **remonté tel quel** |
| `P0001` | `dernier_superadministrateur` | retrait de la dernière ligne de `superadmins` |

### 6.2 Espaces

| Fonction | Effet |
|---|---|
| `plateforme_espaces() returns table(id, nom, slug, domaine_entrant, membres, administrateurs, attentes, cree_le)` | **Tous** les espaces, triés par nom puis par slug, avec leurs compteurs |
| `plateforme_creer_espace(p_nom text, p_slug text, p_domaine_entrant text default null) returns uuid` | Crée l'espace, `settings = '{}'`. **Aucun membre ni workflow** : le premier administrateur, inscrit ensuite (§6.3, §6.4), est accueilli par le guide de démarrage (`CRM-094`), qui pose le workflow de départ. Journal : `espace_cree` |
| `plateforme_modifier_espace(p_id uuid, p_nom text, p_domaine_entrant text) returns void` | Renomme l'espace, ou change ou retire son domaine entrant. **Le slug ne se modifie pas** : il nomme les dossiers IMAP et les adresses d'amorçage. C'est le même motif que `docs/SPEC-administration-arborescence.md` §5.3. Journal : `espace_modifie`, avant et après |
| `plateforme_supprimer_espace(p_id uuid, p_slug_confirme text) returns void` | Exige `p_slug_confirme = slug`, puis supprime l'espace. La cascade et l'ajournement des contraintes viennent de `0085` (décision 619). Journal : `espace_supprime` avec nom, slug et compteurs. **Irréversible** : seule la restauration d'une sauvegarde le défait (`CRM-080`), et l'écran le dit (§7.4) |

### 6.3 Appartenances

| Fonction | Effet |
|---|---|
| `plateforme_membres(p_ws uuid) returns table(user_id, nom, role, superadmin, depuis)` | Les membres, administrateurs d'abord puis par nom |
| `plateforme_poser_membre(p_ws uuid, p_user uuid, p_role text) returns void` | Insère l'appartenance ou change son rôle. Le profil doit exister. Le premier membre d'un espace doit être `admin` : l'invariant de `0021` le refuse sinon, et le refus remonte. Journal : `membre_pose`, ancien et nouveau rôle |
| `plateforme_retirer_membre(p_ws uuid, p_user uuid) returns void` | Retire l'appartenance, sans effet si elle n'existe pas. Le dernier administrateur est refusé par l'invariant (`last_workspace_admin`). Les droits fins de la personne dans l'espace sont retirés par les cascades existantes, ou à défaut retirés explicitement dans la même transaction ; la règle est mesurée en T1 avant d'être écrite. Journal : `membre_retire` |

**Qui peut être posé comme membre ?** Une personne qui a déjà un **profil** : elle s'est connectée
au moins une fois et a été admise. Une personne jamais venue s'inscrit comme **attente** à son
adresse (§6.4). Le CRM ne conserve pas d'adresse dans `profiles` (`docs/SCHEMA.md` §1). La recherche
de personnes porte donc sur les noms.

### 6.4 Attentes

| Fonction | Effet |
|---|---|
| `plateforme_attentes(p_ws uuid) returns table(email, role, invite_par, depuis)` | Les attentes de l'espace |
| `plateforme_inviter(p_ws uuid, p_email text, p_role text) returns void` | Inscrit l'attente, adresse normalisée, `invited_by = auth.uid()`. Une attente existante pour la même adresse est **remplacée** : changer le rôle d'une attente, c'est la retirer puis la réinscrire (`docs/SPEC-session-sso.md` §7.2), et la fonction le fait en une transaction. Journal : `attente_inscrite` |
| `plateforme_retirer_attente(p_ws uuid, p_email text) returns void` | Retire l'attente, sans effet si elle n'existe pas. Journal : `attente_retiree` |

Une attente `admin` dans un espace sans administrateur se consomme à la première connexion. Une
attente non administratrice dans un tel espace **reste en suspens** jusqu'à l'arrivée d'un
administrateur (décision 593) : l'écran l'affiche comme telle (§7.3).

### 6.5 Personnes et superadministrateurs

| Fonction | Effet |
|---|---|
| `plateforme_profils(p_recherche text default null, p_limite int default 50) returns table(id, nom, espaces, superadmin, cree_le)` | Les profils, filtrés par nom (`ilike`, sans accent comme la recherche globale), bornés à 200 |
| `plateforme_superadmins() returns table(sub, nom, accorde_par_nom, accorde_le)` | Les superadministrateurs **en base**. Les porteurs d'`admin` LeLabs n'y figurent pas : le CRM ne les connaît que par leur jeton (§10) |
| `plateforme_poser_superadmin(p_user uuid, p_actif boolean) returns void` | Accorde le drapeau (profil exigé) ou le retire. La **dernière** ligne ne se retire pas (`dernier_superadministrateur`), même par un porteur d'`admin` LeLabs : la plateforme garde toujours un superadministrateur en base, indépendant du SSO. Journal : `superadmin_accorde` ou `superadmin_retire` |
| `plateforme_journal_liste(p_avant bigint default null, p_limite int default 50) returns table(id, acteur_nom, geste, workspace_id, cible, cree_le)` | Le journal, pagination par curseur, le plus récent d'abord, borné à 200 |
| `plateforme_utilisateurs(p_recherche text default null, p_limite int default 200) returns table(id, nom, cree_le, superadmin, espaces, connecteur_derniere_activite)` | **T6, arbitrage A6 (2026-10-21).** Les utilisateurs du CRM, c'est-à-dire les profils, filtrés par nom comme `plateforme_profils` (sans accent, métacaractères échappés), dans l'ordre des noms, bornés à 200. `espaces` est un tableau JSON `[{"slug", "nom", "role"}]` des appartenances, dans l'ordre des noms d'espace ; `connecteur_derniere_activite` vient de `mcp_comptes`, nulle pour qui n'est jamais venu au connecteur. Lecture seule, rien n'est journalisé. Migration propre à T6, prochain numéro libre au moment de l'écrire |

## 7. L'écran `/plateforme`

Section de la webapp **réservée aux superadministrateurs**. Composition détaillée, tokens et états :
`docs/DESIGN_SYSTEM.md` §5.56, écrite avec la tranche T3 **après lecture intégrale** du design system.
Ce qui suit fixe le contrat.

### 7.1 Accès

- **L'entrée de navigation** « Plateforme » (icône `ShieldCheck`) apparaît dans la barre latérale,
  après « Réglages », si et seulement si `public.est_superadmin()` rend vrai. La coquille fait
  l'appel à son montage ; un retrait du drapeau la fait disparaître au rechargement suivant, et la
  base refuse dès l'appel suivant.
- **Une adresse ouverte sans le drapeau** (`/plateforme` et ses sous-adresses) rend l'état de
  refus : « Cette section est réservée aux superadministrateurs de la plateforme. » Aucune requête
  métier ne part. La base refuserait de toute façon, et c'est elle qui fait foi (`CLAUDE.md` §10).

### 7.2 Composition

L'écran porte trois onglets, sous forme de liens dans l'adresse :

| Onglet | Adresse | Ce qu'il porte |
|---|---|---|
| **Espaces** | `/plateforme/espaces` | Le tableau des espaces (nom, slug, membres, administrateurs, attentes) et l'action « Nouvel espace ». Une ligne ouvre la fiche de l'espace (§7.3) |
| **Superadministrateurs** | `/plateforme/superadmins` | La liste des superadministrateurs en base, « Ajouter » (recherche dans `plateforme_profils`) et « Retirer ». Une note rappelle que les porteurs d'`admin` LeLabs le sont aussi |
| **Utilisateurs** | `/plateforme/utilisateurs` | **T6, arbitrage A6.** Tous les utilisateurs du CRM, avec une recherche par nom : leurs espaces et leurs rôles (chaque espace mène à sa fiche), le drapeau, leur dernière activité au connecteur ou « Jamais connecté », la date de leur profil. Lecture seule : les gestes restent dans la fiche d'un espace et dans l'onglet des superadministrateurs. Placé entre « Espaces » et « Superadministrateurs » |
| **Journal** | `/plateforme/journal` | Le journal paginé, en lecture seule |

`CRM-103` ajoute un dernier onglet, **Connecteur MCP** (`docs/SPEC-mcp.md` §8).

**Qui est un utilisateur (A6).** Une personne qui a un **profil** : elle a été admise au moins une fois. Un compte
venu seulement au connecteur, sans profil, n'en est pas un : il paraît dans l'onglet « Connecteur MCP » (`CRM-103`).
Les porteurs d'`admin` LeLabs figurent dans la liste s'ils ont un profil ; leur rôle de domaine n'est pas affiché, le
CRM ne le connaissant que par leur jeton (§10). Une phrase sous le titre le dit.

### 7.3 Fiche d'un espace — `/plateforme/espaces/:slug`

- **En-tête :** le nom et le slug, puis « Modifier » (nom et domaine entrant, formulaire **dans le
  flux** — le design system n'admet aucune modale, §5.13) et « Supprimer l'espace » (zone de danger,
  en bas de fiche).
- **Section Membres :**
  - un tableau (nom, rôle, superadministrateur, depuis) ;
  - un sélecteur de rôle par ligne, qui écrit à la sélection puis relit l'état ;
  - « Retirer » avec confirmation ;
  - « Ajouter un membre », qui recherche une personne connue et choisit son rôle.
- **Section Attentes :**
  - un tableau (adresse, rôle, invitée par, depuis), avec l'étiquette « En suspens » quand l'espace
    n'a aucun administrateur et que l'attente n'est pas `admin` ;
  - « Inscrire une attente » (adresse et rôle) et « Retirer ».
- **Un espace sans administrateur** affiche un bandeau d'avertissement : « Aucun administrateur :
  inscrivez une attente administratrice ou ajoutez un administrateur. »

### 7.4 Supprimer un espace

Une confirmation **dans le flux**, sous sa commande — jamais une modale (`docs/DESIGN_SYSTEM.md`
§5.13, §5.56) :

- elle nomme ce qui disparaît, à partir des données déjà lues — membres et attentes —, puis dit en
  une phrase que tout ce que l'espace contient part avec lui (tracks, affaires, workflows,
  messagerie) ;
- elle dit que la suppression est **définitive**, et que seule la restauration d'une sauvegarde la
  défait ;
- elle exige de **saisir le slug** ; le bouton reste inactif tant que la saisie diffère.

La base revérifie la saisie (`confirmation_incorrecte`).

### 7.5 États et refus

- Chaque vue traite les états de chargement, de liste vide, d'erreur et de refus.
- **Traduction des refus :** chaque code du §6.1 reçoit un message dans `webapp/src/i18n` ; un code
  inconnu reçoit le message générique, **jamais** le texte brut de la base.
- **Après chaque écriture, l'état est relu** auprès du serveur, jamais déduit localement : c'est la
  convention de `CRM-075`.

### 7.6 Code

Les motifs sont repris de `CRM-075` (`webapp/src/lib/administration-arborescence.ts`,
`webapp/src/app/AdministrationArborescence.tsx`) :

- **logique pure et appels :** `webapp/src/lib/plateforme.ts`, avec son test ;
- **composants :** `webapp/src/app/Plateforme*.tsx` ;
- **textes :** `webapp/src/i18n`.

Aucune règle de droit n'est calculée dans le navigateur.

## 8. Seed

`docs/SPEC-seed.md` §19 ; section `8 unvicies` de `supabase/seed/apply-seed.sh`.

- **Comptes Keycloak.** `keycloak/realm-lelabs.json` reçoit un compte **« Sabine Plateforme »**
  (`plateforme@p2enjoy.test`, rôle `verified` seul, identifiant stable `5eed…0018`), membre d'**aucun** espace.
- **Variable de développement.** L'overlay `docker-compose.dev.yml` donne à `CRM_SUPERADMINS_INITIAUX` cette adresse
  pour défaut ; `.env.example` la laisse vide, comme en production.
- **L'amorçage passe par une vraie connexion** (`sso_jeton_interne`), jamais par une insertion directe
  (`CLAUDE.md` §8). Le seed constate ensuite, par `public.est_superadmin()` sous le jeton de Sabine, que le drapeau
  est posé, et s'arrête sinon.
- **Aucun espace de démonstration n'est créé** — *révisé le 2026-10-20 en écrivant la tranche T4, avant le code du
  seed*. La première rédaction prévoyait un espace « Atelier ». Mesuré : de nombreuses preuves tiennent pour acquis
  que le seed porte un **unique** espace (`CRM-005`). C'est le cas de la suite `0003`, des démontages de
  `e2e/ui/premier-lancement.spec.ts` et `e2e/ui/guide-flottant.spec.ts`, et de l'espace « premier par ordre de nom »
  qu'emploie `e2e/ui/objectifs.spec.ts` (« Atelier » précéderait « P2Enjoy SAS »). La création, les appartenances,
  les attentes et la suppression se démontrent donc dans l'E2E de la plateforme, qui rend la base telle qu'il l'a
  trouvée. La fiche de l'espace seedé, avec ses trois membres et l'attente d'`attendu@`, sert de démonstration en
  lecture.
- **Convergence :** la seconde connexion ne fait rien de plus, la table n'étant plus vide.

## 9. Preuves

| Niveau | Preuve |
|---|---|
| pgTAP | `supabase/tests/0084_plateforme.test.sql` : forme et fermeture des tables, privilèges mesurés dans le catalogue, refus `42501` de **chaque** fonction pour l'anonyme, la lectrice et un administrateur d'espace non superadministrateur ; succès pour un superadministrateur en base et pour un porteur de `lelabs_admin` ; amorçage unique (seconde adresse listée sans effet, adresse non listée sans effet, liste vide sans effet) ; dernier superadministrateur ; invariant du dernier administrateur remonté ; suppression d'un espace peuplé ; journal écrit par chaque geste ; admission révisée (§4) ; **mutations** de la migration, chacune rouge |
| Unitaires | `webapp/src/lib/plateforme.test.ts` (traduction des refus, validation de forme du slug, confirmation) ; tests des composants ; `supabase/functions/session` (liste remise au seul worker `session`, transmise à l'appel) |
| API | `e2e/api/plateforme.spec.ts`, aux **jetons réels** du seed : chaque fonction refusée en requête directe à l'anonyme, à la lectrice et à l'administrateur d'espace ; succès de Sabine ; amorçage unique constaté après une vraie connexion |
| E2E | `e2e/ui/plateforme.spec.ts` : souris et clavier seul. Création d'un espace, membre posé, rôle changé, attente inscrite, suppression confirmée par saisie ; effets relus en base ; refus d'interface pour un non-superadministrateur ; captures aux quatre paliers, observées |
| Harnais | `scripts/verify-plateforme.sh` : traçabilité, catalogue, suites, dégradations réelles et restauration constatée |

## 10. Limites connues

- **Les porteurs d'`admin` LeLabs ne sont pas listés** : le CRM ne les connaît que par leur jeton.
  L'onglet le dit.
- **Une attente ne peut pas être refusée pour l'adresse d'un membre existant** : l'adresse des
  membres n'est pas conservée (minimisation). L'attente se consomme sans effet, `on conflict do
  nothing`.
- **La suppression d'un espace est irréversible** hors restauration d'une sauvegarde.
- **Un superadministrateur en base peut se donner une appartenance** dans tout espace. Le geste est
  journalisé, et c'est voulu : il administre la plateforme.

## 11. Production

Les opérations sont détaillées dans `docs/PROD_MIGRATIONS.md` §3, « en attente ».

1. Appliquer la migration `0089`, instantané d'abord.
2. Le propriétaire du Spark pose `CRM_SUPERADMINS_INITIAUX` (facultative) : l'adresse LeLabs du
   responsable.
3. Redéployer les fonctions edge (`session`) et la webapp.
4. **Constat :** la première connexion du responsable amorce le drapeau, et `/plateforme` liste les
   espaces de production.

## 12. Découpage en tranches

| Tranche | Contenu |
|---|---|
| T1 | Migration `0089`, sa suite pgTAP, les types régénérés, `docs/SCHEMA.md` |
| T2 | La fonction `session` : la liste remise et transmise, l'amorçage et l'admission exercés par une vraie connexion ; preuves unitaires et d'API |
| T3 | L'écran `/plateforme` (Espaces, Superadministrateurs, Journal) ; `docs/DESIGN_SYSTEM.md` après lecture intégrale ; preuves unitaires |
| T4 | Seed, E2E, captures observées, manuel (chapitre 10 du corps et ligne 17 *bis* du sommaire ; la ligne 17 est révisée, l'invitation n'étant plus une opération d'exploitation), `verify-plateforme.sh`, campagnes |
| T5 | Livraison en production et constat |
| T6 | **L'onglet « Utilisateurs »** (arbitrage A6, 2026-10-21) : `plateforme_utilisateurs` et sa migration, pgTAP (refus sans le drapeau, recherche, bornes, espaces et connecteur), types ; l'onglet, `docs/DESIGN_SYSTEM.md` §5.56 ; API aux jetons réels, E2E à la souris et au clavier, captures, manuel (chapitre 10), campagnes |
