# Spécification — Réglages ▸ « Membres » : l'administrateur d'espace et ses membres

- Unité de backlog : `CRM-070` — administration des permissions fines et invitation d'un membre.
- Arbitrages : `docs/JOURNAL.md`, décision 634 (2026-10-23) ; décisions 256 et 593 pour l'invitation et les attentes ;
  décision 627 pour la frontière avec la plateforme (`CRM-101`).
- Documents liés : `docs/SPEC-permissions-rls.md` §3 (droits fins, « le plus spécifique gagne »), `docs/SPEC-session-sso.md`
  §6 et §7 (attentes, admission), `docs/SPEC-plateforme.md` §6 et §7 (l'écran du superadministrateur),
  `docs/SPEC-droits-interface.md` (les capacités, `CRM-093`), `docs/DESIGN_SYSTEM.md` §5.56 et §5.59.
- État : **validée par le responsable le 2026-10-23** (décision 635), avec les choix du §5.

## 1. Objet

Donner à l'administrateur d'un espace l'écran qui manque : **qui est membre de mon espace, avec quel rôle, avec quels
droits sur mes tracks et mes channels, et qui est attendu**. La plateforme (`CRM-101`) sert le superadministrateur, sur
tous les espaces ; cet écran sert l'administrateur, sur le sien, et seulement par ses propres droits.

**Connecteur MCP : non** (décision 634). La gestion des membres et des droits reste un geste humain dans la webapp ;
aucun outil n'est ajouté au catalogue de `CRM-104`.

## 2. Ce que la base permet déjà — mesuré le 2026-10-23

Toutes les écritures nécessaires sont **déjà ouvertes à l'administrateur d'espace** par la RLS, sans fonction
nouvelle, et sans toucher aux fonctions `plateforme_*`, qui restent gardées par `app.exiger_superadmin()` :

| Table | Lecture | Insertion, mise à jour, suppression |
|---|---|---|
| `workspace_members` | tout membre de l'espace (`app.is_workspace_member`) | `app.is_workspace_admin(workspace_id)` |
| `workspace_invitations` | **administrateur seul** | administrateur ; à l'insertion, `invited_by = auth.uid()` |
| `track_members` | administrateur, ou la personne elle-même | `app.is_workspace_admin(app.track_workspace(track_id))` |
| `channel_members` | administrateur, ou la personne elle-même | `app.is_workspace_admin(app.channel_workspace(channel_id))` |
| `profiles` | soi, ou un co-membre d'un espace commun | — |

Contraintes existantes, réemployées telles quelles : l'invariant du **dernier administrateur** (`0021`,
`last_workspace_admin`) ; `access` dans `member`, `viewer`, `none` ; `role` d'une attente dans `admin`,
`business_developer`, `viewer` ; l'adresse d'une attente en minuscules, sans espace, de 3 à 320 caractères.

**Conséquence de conception.** L'écran écrit directement dans ces tables par PostgREST, comme l'arborescence écrit dans
`tracks` et `channels`. Aucune migration n'est prévue pour les gestes ; la seule question de base est celle du §5.3.

## 3. L'écran

Adresse : `/reglages/membres`, entrée « Membres » de la navigation des réglages, placée **après** l'arborescence
(on organise l'espace, puis on y place les personnes). **Consultable par tout membre** (décision 634) ; les commandes
sont éteintes avec leur motif quand la base refuse l'administration (`administration_permise`, `CRM-093`,
`docs/DESIGN_SYSTEM.md` §5.59).

Trois sections, dans cet ordre :

### 3.1 Les membres

Une ligne par membre : nom (profil), rôle, depuis quand. Administrateurs d'abord, puis par nom.

- **Changer le rôle** : un sélecteur `admin`, `business developer`, `lecteur`. Écriture `PATCH workspace_members`.
  Retirer le rôle d'administrateur au dernier administrateur est refusé par la base (`last_workspace_admin`), et
  l'écran traduit ce refus.
- **Retirer de l'espace** : confirmation dans le flux, qui nomme la personne et dit la conséquence (ses droits fins
  dans l'espace disparaissent avec elle, `docs/SPEC-plateforme.md` §6.3). Même garde du dernier administrateur.
- **Soi-même** : on peut changer son propre rôle ou se retirer, et la confirmation le dit en clair (« vous perdrez
  l'accès à l'administration de cet espace »).

### 3.2 Les attentes

Lisibles par l'administrateur seul (RLS) : pour un autre membre, la section est **absente**, sans phrase qui dirait
qu'elle existe.

- **Inscrire** une personne par son adresse et un rôle. Une attente existante pour la même adresse est remplacée
  (retirée puis réinscrite dans la même transaction côté écran : deux écritures, ou une fonction si la mesure du T1
  montre qu'il en faut une — §5.3).
- **Retirer** une attente.
- **État** de chaque attente :
  - **en attente** — elle se consommera à la première connexion LeLabs de cette adresse ;
  - **en suspens** — attente non administratrice dans un espace **sans administrateur membre** : elle ne se
    consommera qu'à l'arrivée d'un administrateur (décision 593, `docs/SPEC-session-sso.md` §6). L'écran ne peut le
    montrer qu'à un administrateur non membre (l'administrateur LeLabs), puisqu'un administrateur membre suffit à lever
    le suspens.
- **« Jamais connectée » n'est pas mesurable aujourd'hui** : une attente consommée disparaît, et aucune trace ne garde
  une connexion refusée à une adresse. Voir §5.2.

### 3.3 Les droits fins

Pour une personne choisie dans la liste des membres : la matrice de ses accès **par track et par channel** de l'espace.

- Chaque track et chaque channel porte : **hérité** (aucune ligne), **membre**, **lecture** ou **aucun accès**.
- L'écran affiche aussi l'**accès effectif** qui en résulte, calculé par la base (« le plus spécifique gagne »,
  `docs/SPEC-permissions-rls.md` §3.3 et §3.3 bis), jamais recalculé à l'écran : la lecture passe par une fonction de
  lecture existante si elle existe, sinon par une fonction neuve de lecture (§5.1).
- Écritures : `track_members` et `channel_members`, insertion, mise à jour ou suppression (retour à « hérité »).
- Un administrateur n'est jamais restreint (`SPEC-permissions-rls.md`) : la matrice d'un administrateur l'affiche et
  désactive ses cellules, avec cette phrase.

### 3.4 États et refus

États systématiques (`docs/DESIGN_SYSTEM.md` §5.8) : chargement, erreur avec reprise, vide (« aucune attente »),
succès annoncé par une région vivante. Les refus de la base sont traduits par un dictionnaire fermé : dernier
administrateur, adresse invalide, rôle invalide, droit refusé, réseau, inconnu.

## 4. Composants

Le composant de liste des membres de `PlateformeEspace.tsx` (`CRM-101`) est **extrait et partagé** plutôt que dupliqué,
en coordination avec la session qui tient `CRM-103` (fichiers `plateforme.ts` et `presentation-plateforme.ts`). La
couche d'accès est distincte : l'écran de l'administrateur parle aux tables par la RLS, celui de la plateforme aux
fonctions `plateforme_*`. Les libellés de rôle sont communs.

## 5. Points tranchés à la validation (décision 635)

1. **L'accès effectif se lit en base.** Une fonction de lecture `public.acces_effectif_membre(p_ws uuid, p_user uuid)`
   rend, pour chaque track et chaque channel de l'espace, le droit posé et l'accès effectif (« le plus spécifique
   gagne », par les fonctions mêmes de la RLS). Elle est **réservée à l'administrateur de l'espace** :
   `SECURITY DEFINER`, `search_path` vide, garde `app.is_workspace_admin(p_ws)` en premier, refus `42501` sinon ;
   `execute` à `authenticated` seul. Migration au prochain numéro libre au moment de l'écrire (T1).
2. **« Jamais connectée » et « connexion refusée » sortent de `CRM-070`.** Journaliser les refus d'admission par
   adresse devient une unité propre (`CRM-109`). `CRM-070` montre « en attente » et « en suspens ».
3. **Remplacer une attente** : mesuré en T1 ; une fonction gardée par `app.is_workspace_admin` si les deux écritures ne
   peuvent pas être atomiques depuis l'écran. *Tranché en T3* : elles ne le peuvent pas — aucune politique UPDATE, clé
   `(workspace_id, email)`. `public.inscrire_attente(p_ws, p_email, p_role)`, migration 97, **`SECURITY INVOKER`** : les
   politiques existantes décident, la garde en tête ne fait que nommer le refus (`docs/SCHEMA.md` §9 bis.8 quinquies).
   Le bloc des attentes de la plateforme est extrait et partagé comme le tableau des membres (§4).

## 6. Preuves

- **pgTAP** : la matrice des écritures de l'administrateur, du business developer et de la lectrice sur les quatre
  tables ; le dernier administrateur ; la fonction de lecture du §5.1 si elle est retenue (droits, `security`).
- **API**, jetons réels : chaque écriture acceptée pour l'administrateur, refusée pour les autres profils.
- **Unitaires** : la composition des trois sections, les états, les refus traduits, les capacités.
- **E2E** : l'administratrice change un rôle, retire et réinscrit une attente, pose et retire un droit fin ; la
  lectrice consulte, commandes éteintes, et ne voit pas les attentes ; le refus du dernier administrateur ;
  captures observées aux quatre paliers.
- **Manuel** : le chapitre 17, réécrit ; **seed** : une attente en place, un droit fin de chaque sorte.

## 7. Tranches

| Tranche | Contenu |
|---|---|
| T1 | Mesures et, si retenue, la fonction de lecture de l'accès effectif (migration), pgTAP, API |
| T2 | Les membres et leurs rôles : composant partagé, écran, unitaires |
| T3 | Les attentes et leur état |
| T4 | Les droits fins |
| T5 | E2E, captures, manuel, seed, campagnes |
| T6 | Livraison en production, sur instruction du responsable |
