# Spécification — le journal des refus d'admission d'une adresse attendue

- Unité de backlog : `CRM-109` — journaliser les refus d'admission, pour dire d'une attente « jamais tentée » ou
  « refusée ».
- Arbitrages : `docs/JOURNAL.md`, décision 640 (2026-10-23) ; décision 635 pour la séparation d'avec `CRM-070` ;
  décisions 579 et 593 pour la règle d'admission et la suspension.
- État : **validée le 2026-10-23** (décision 644), avec la cascade au remplacement d'une attente (§3).
- Connecteur MCP : **non** (décision 640, point 1). Le journal se lit dans Réglages ▸ Membres et sur la plateforme.

## 1. Le problème

Une personne attendue entre dans le CRM à sa première connexion LeLabs **admise** (`docs/SPEC-session-sso.md` §6.1) :
son attente est alors consommée. Tant qu'elle n'est pas admise, son attente reste en place, et **rien ne dit pourquoi**.
L'administrateur voit « en attente » sans savoir si la personne n'a jamais essayé, ou si elle a essayé et a été
refusée — adresse non vérifiée chez LeLabs, rôle `verified` absent, espace sans administrateur. Ce cas a été relevé par
une connexion refusée en production.

## 2. Ce qui est journalisé, et ce qui ne l'est pas (décision 640, point 2)

**Une trace naît seulement d'un refus dont l'adresse a au moins une attente.** L'échangeur de session
(`supabase/functions/session`) connaît, au moment du refus, l'adresse du jeton LeLabs et le code du refus. Trois codes
qualifient une personne attendue :

| Code de l'échangeur | Ce qu'il dit | Ce que l'administrateur peut faire |
|---|---|---|
| `adresse_non_verifiee` | l'adresse du compte LeLabs n'est pas vérifiée | demander à la personne de vérifier son adresse chez LeLabs |
| `attente_verification` | le compte LeLabs n'a pas le rôle `verified` | demander à LeLabs de vérifier le compte |
| `attente_administrateur` | l'espace n'a pas encore d'administrateur membre (décision 593) | inscrire ou nommer un administrateur |

**Aucune trace n'est écrite pour une adresse que personne n'attend** — `attente_espace`, ni pour aucun autre code
(jeton refusé, session expirée, service indisponible…). La minimisation de `docs/SPEC-session-sso.md` §6.1 (« une
personne vérifiée mais ni membre ni attendue ne laisse aucune trace ») reste vraie au mot près, et s'étend à la
personne non vérifiée que personne n'attend.

Ce qui est gardé, **par attente** (espace, adresse) : le **dernier motif**, l'**heure du dernier refus**, l'**heure du
premier refus** et le **nombre de refus**. Ni le `sub` LeLabs, ni le nom, ni l'adresse IP, ni l'agent utilisateur : le
journal répond à « a-t-elle essayé, et qu'est-ce qui bloque ? », pas à « d'où ».

## 3. Le modèle

Une table `public.admission_refus` :

| Colonne | Type | Sens |
|---|---|---|
| `workspace_id` | `uuid` | l'espace de l'attente |
| `email` | `text` | l'adresse attendue, normalisée comme celle de l'attente |
| `motif` | `text` | `adresse_non_verifiee`, `attente_verification` ou `attente_administrateur` (contrainte fermée) |
| `premier_refus` | `timestamptz` | le premier refus gardé |
| `dernier_refus` | `timestamptz` | le plus récent |
| `refus` | `integer` | leur nombre, `≥ 1` |

- Clé primaire `(workspace_id, email)` ; **clé étrangère vers `workspace_invitations (workspace_id, email)`, `on delete
  cascade`** : la trace **part avec l'attente**, consommée à l'admission ou retirée (décision 640, point 3).
  *Conséquence voulue* : remplacer une attente (`inscrire_attente`, migration 97, qui la retire puis la réinscrit) efface
  sa trace — l'administrateur a changé l'attente, l'histoire de l'ancienne ne la décrit plus.
- **Conservation : 90 jours au plus après le dernier refus.** Une tâche `pg_cron` quotidienne supprime les traces dont
  `dernier_refus` a plus de 90 jours, et la lecture ne rend jamais une trace plus ancienne (deux garde-fous : la tâche
  peut manquer un jour).
- **Écriture** : une fonction `public.journaliser_refus_admission(p_email text, p_motif text)`, `SECURITY DEFINER`,
  `search_path` vide, **exécutable par `service_role` seul** — l'échangeur l'appelle avec sa clé de service, comme il
  appelle `ouvrir_session_sso`. Elle normalise l'adresse, refuse un motif hors des trois (`22023`), et pose ou met à jour
  une trace **pour chaque attente de cette adresse, et seulement celles-là** : sans attente, elle n'écrit rien et ne le
  dit pas. Une seule écriture par refus, bornée par le nombre d'attentes de l'adresse.
- **Aucune politique d'écriture** ; `insert`, `update` et `delete` révoqués à `anon` et `authenticated`.
- **Lecture** (décision 640, point 4) : une politique `SELECT` à `app.is_workspace_admin(workspace_id)` — l'administrateur
  de l'espace, et le porteur d'`admin` LeLabs qui l'est de tout espace —, filtrée aux 90 derniers jours. Le
  superadministrateur lit par la fonction de la plateforme qui rend déjà les attentes d'un espace (`plateforme_attentes`,
  `docs/SPEC-plateforme.md` §6.4), étendue des quatre colonnes.

## 4. L'échangeur

Dans `supabase/functions/session/handler.ts`, au point où un refus de l'un des trois codes est levé **avec une
adresse** (vérification du jeton pour les deux premiers, `refusNonAdmise` pour le troisième), l'échangeur appelle
`journaliser_refus_admission` **avant** de répondre. **Un échec de journalisation ne change jamais la réponse** : la
personne reçoit le même refus, l'échec est consigné dans le journal du service, sans l'adresse en clair (`CLAUDE.md`
§20). Le délai de l'appel est borné par l'échéance de la requête, comme les autres appels à la base.

## 5. Ce qu'on en voit

- **Réglages ▸ Membres, section « Attentes »** (`CRM-070`, `docs/DESIGN_SYSTEM.md` §5.61) : une colonne **« Dernière
  tentative »**. Sans trace : « Aucune tentative refusée ». Avec : le motif en mots et la date — « Refusée le 23/10 :
  adresse non vérifiée chez LeLabs » —, et « (3 fois depuis le 20/10) » au-delà d'un refus. Le texte dit ce qui bloque,
  jamais un code.
- **Plateforme, fiche d'un espace** : la même colonne dans le bloc des attentes, partagé (`BlocAttentes`).
- **Manuel** : chapitre 10 bis.5 (attentes) et chapitre 10 (plateforme) : ce que dit chaque motif, et ce qu'on peut
  faire.

## 6. Preuves

- **pgTAP** : forme de la table et de la fonction (`security definer`, `search_path` vide, `service_role` seul) ; une
  adresse attendue journalise, une inconnue n'écrit rien ; trois motifs acceptés, un autre refusé ; compteur et dates ;
  cascade à la consommation, au retrait et au remplacement ; politique de lecture par profil ; purge à 90 jours.
- **Unitaires de l'échangeur** : les trois codes appellent la journalisation avec l'adresse, `attente_espace` et les
  autres non ; un échec de journalisation laisse la réponse identique.
- **Intégration** : une connexion réelle refusée sur la pile de développement (compte LeLabs local non vérifié et
  attendu) laisse sa trace ; une connexion d'une adresse inconnue n'en laisse aucune.
- **API** aux jetons réels : l'administrateur lit les traces de son espace, le business developer et la lectrice
  rien, l'anonyme rien.
- **Unitaires et E2E de l'écran** : la colonne, ses trois formes, et la lectrice qui ne voit pas la section.
- **Seed** : une attente avec une trace de refus réelle, produite par le même chemin que la production (§4), et une
  attente sans trace.

## 7. Tranches

| Tranche | Contenu |
|---|---|
| T1 | Migration : table, fonction, purge, politique ; pgTAP ; contrat de déploiement |
| T2 | L'échangeur journalise ; unitaires ; intégration réelle |
| T3 | Les écrans : Réglages ▸ Membres et la plateforme ; `plateforme_attentes` étendue ; unitaires, API, E2E, manuel, seed |
| T4 | Livraison en production, sur instruction du responsable |
