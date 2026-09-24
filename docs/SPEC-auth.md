# Spécification — Authentification, sessions et cycle de vie des comptes (remplacée)

Unités de backlog : `CRM-009` (interface, session d'onglet et gabarits), `CRM-011` (mécanisme
GoTrue) et `CRM-091` (connexion unique par `oauth.lelabs.tech`) — **toutes remplacées par
`CRM-092`** ; voir `docs/BACKLOG.md`.

> **Ce document n'est plus un contrat. Il est réduit à un renvoi par `CRM-092` T6**
> (`docs/SPEC-session-sso.md` §14, `docs/JOURNAL.md` décision 589). Le SSO `oauth.lelabs.tech` est
> la **seule** source d'identité du CRM, en développement comme en production (décision 578) :
> GoTrue, la connexion par mot de passe, l'invitation par courriel, la récupération, la politique de
> mot de passe et les gabarits transactionnels ont quitté la pile. **Le contrat en vigueur est
> `docs/SPEC-session-sso.md`.**

Le texte historique — la configuration de GoTrue 2.189.0 telle qu'elle fut mesurée, le cycle de vie
des comptes, les gabarits, la session d'onglet et la connexion unique de `CRM-091` — reste lisible
dans l'historique du dépôt : `git show 15e9a8a5:docs/SPEC-auth.md`. Il ne décrit plus le produit.

## Correspondance des sections encore citées

Le code et la documentation citent encore ce document par numéro de section. Chaque section citée
renvoie ici à l'endroit où son contrat vit désormais, ou dit qu'il est retiré.

| Section d'origine | Sujet | Où le contrat vit désormais |
|---|---|---|
| §2 | Configuration imposée à GoTrue | **Retiré avec GoTrue.** L'environnement de l'échangeur de session : `docs/SPEC-session-sso.md` §5.7 |
| §3 | Cycle de vie d'un compte (inscription, invitation, acceptation, connexion, déconnexion, réinitialisation) | Admission par une **attente** et le rôle `verified` : `docs/SPEC-session-sso.md` §6 ; inscrire une attente : §6.3 et `CRM-070` ; déconnexion : §8.5. Le compte lui-même vit chez LeLabs |
| §4, §4.1 | Politique de mot de passe et chemin d'administration | **Retiré** : le CRM ne connaît plus aucun mot de passe. Celui du LeLabs de développement : `docs/SPEC-seed.md` §2.3 |
| §5, §5.1, §5.2 | Courriels transactionnels et service de gabarits | **Retiré avec GoTrue, `auth-templates` et Inbucket** (`docs/SPEC-session-sso.md` §2) |
| §9 | Parcours de connexion de la webapp | `docs/SPEC-session-sso.md` §4 (parcours), §8 (webapp), §9 (interface) |
| §9.1 | Écran de connexion et navigation | `docs/SPEC-session-sso.md` §9.1 ; `docs/DESIGN_SYSTEM.md` §5.12 |
| §9.2 | Session limitée à l'onglet | **Remplacée** : jeton interne en mémoire et poignée `httpOnly`, `docs/SPEC-session-sso.md` §5.6, §8.3 et §8.4 |
| §9.3 | États, erreurs et accessibilité de l'écran | `docs/SPEC-session-sso.md` §9.2 (refus et attentes, deux surfaces) |
| §10 | Connexion unique par `oauth.lelabs.tech` (`CRM-091`) | `docs/SPEC-session-sso.md` en entier : le client public de `CRM-091` est remplacé par un client **confidentiel** (décision 586) |
| §10.2 | Configuration du fournisseur | `docs/SPEC-session-sso.md` §5.7 (environnement), §10 (développement), §12 (production) |
| §10.3 | Parcours SSO | `docs/SPEC-session-sso.md` §4, §5.2 |
| §10.4 | Dictionnaire des refus | `docs/SPEC-session-sso.md` §5.5 |
| §10.5 | Stockage sur l'appareil | `docs/SPEC-session-sso.md` §8.3 |
| §10.8 | Déclarer le client au realm | `docs/SPEC-session-sso.md` §12 (point 1) ; `docs/SSO-client-lelabs-crm.md` |
| §10.9 | Keycloak de développement | `docs/SPEC-session-sso.md` §10 ; `keycloak/README.md` |
| §10.10 | Preuves exigées | `docs/SPEC-session-sso.md` §13 ; harnais `scripts/verify-session-sso.sh`. `scripts/verify-auth.sh` est retiré avec GoTrue (décision 581) |

Une section absente de cette table n'est plus citée nulle part. Une citation nouvelle vise
`docs/SPEC-session-sso.md`, jamais ce document.
