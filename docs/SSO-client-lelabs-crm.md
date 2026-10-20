# Clients du CRM chez LeLabs — blocs d'intégration reçus du fournisseur

Chaque bloc est la réponse d'`oauth.lelabs.tech` à une déclaration du CRM : il fait foi pour l'identifiant retenu, les
URL **réellement enregistrées**, les portées et les contrôles attendus sur le jeton. Le fournisseur précise qu'aucun ne
contient de secret.

Le contrat général du fournisseur est `docs/SSO.md`. Ce fichier-ci est propre aux clients du CRM.

## 1. `lelabs-crm-serveur` — le client en vigueur

Client **confidentiel**, déclaré au §12 de `docs/SPEC-session-sso.md` (`CRM-092`) et réemployé par le connecteur MCP
(`CRM-102`, `docs/SPEC-mcp.md` §3.2) : un seul client pour l'échangeur de session et le mandataire du connecteur, un seul
`OIDC_CLIENT_SECRET`. **Redéclaré** avec le retour du mandataire et `HORS_LIGNE=oui` ; le bloc ci-dessous, remis par le
responsable le 2026-10-21, est versé au dépôt tel quel (`docs/JOURNAL.md`, décision 627, livraison). La date « Client
créé le 2026-10-20 22:55:56 » est celle que le service inscrit dans son récapitulatif ; l'identifiant et le secret, eux,
sont inchangés.

Sonde publique rejouée le 2026-10-21 (autorisation avec PKCE S256 et `scope=openid offline_access`) : `200` pour
`https://crm.mcp.lelabs.tech/auth/callback` et pour `https://crm.lelabs.tech/auth/retour`, `400 Paramètre invalide :
redirect_uri` pour une adresse témoin non déclarée. La découverte publie `offline_access` et `S256`.

```
# llms.txt — intégration OIDC « P2Enjoy CRM »

> Fournisseur d'identité du domaine, realm `lelabs`. Client créé le 2026-10-20 22:55:56.
> Ce bloc ne contient aucun secret et peut être collé tel quel à votre agent.

## Points d'entrée

- issuer : https://oauth.lelabs.tech/realms/lelabs
- découverte : https://oauth.lelabs.tech/realms/lelabs/.well-known/openid-configuration
- autorisation : https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/auth
- jeton : https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/token
- fin de session : https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/logout
- clés de signature : https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/certs

Préférez la découverte à la recopie : elle reste juste si le service évolue.

## Client

- client_id : lelabs-crm-serveur
- type : confidentiel — le secret est détenu par votre serveur, le navigateur ne reçoit jamais de jeton
- secret : à poser dans la variable `OIDC_CLIENT_SECRET` de votre environnement d'exécution. Il ne figure pas ici, ne transite par aucune messagerie et n'entre dans aucun dépôt.
- authentification au point de jeton : client_secret_post ou client_secret_basic

## URL enregistrées

Elles sont comparées **caractère par caractère**. Une différence d'un seul
caractère fait échouer la connexion sans message utile.

redirect_uri :
- https://crm.lelabs.tech/auth/retour
- https://crm.mcp.lelabs.tech/auth/callback

post_logout_redirect_uri :
- aucune — la personne reste sur la page du fournisseur après déconnexion

origines web :
- https://crm.lelabs.tech
- https://crm.mcp.lelabs.tech

## Flux et portées

- flux : code d'autorisation **seul**
- PKCE : S256 **obligatoire**
- refusés par le serveur : flux implicite, octroi direct par mot de passe, flux appareil
- portées : openid profile email offline_access
- offline_access : à demander dans `scope` (`openid offline_access`) pour recevoir un jeton de rafraîchissement hors ligne. Il survit à la fin de la session de la personne sur le fournisseur : gardez-le comme un secret, sur votre serveur. Sans cette demande, le jeton de rafraîchissement suit la session.
- jamais exposés : téléphone et profil public déclarés à l'inscription — recueillis pour vérifier que la personne est réelle, le consentement ne couvre pas leur transmission

## Rôles

- les rôles de realm arrivent dans `realm_access.roles` du jeton d'accès
- rôles attendus par cette application :
- verified
- `verified` est le plancher du domaine : **aucune application ne s'ouvre sans lui**, et votre serveur doit le refuser lui-même
- `admin` vaut administrateur de votre application, d'office, s'il est présent
- attribution : humaine, depuis l'interface de vérification du service ; jamais automatique
- durée de vie du jeton d'accès : 300 s

Testez la **présence** d'un rôle, jamais le nombre ni l'ordre : le tableau porte
aussi les rôles par défaut du realm. Relisez-le à chaque requête et ne le gardez
pas au-delà de la durée de vie du jeton — un rôle se retire aussi vite qu'il
s'attribue.

## À vérifier côté application

- l'`iss` du jeton vaut exactement https://oauth.lelabs.tech/realms/lelabs
- `azp` vaut lelabs-crm-serveur
- signature vérifiée par les clés publiées, algorithme asymétrique ; refuser tout jeton signé par un algorithme symétrique
- suivre la rotation des clés par le point `certs` plutôt qu'en épingler une
- une connexion réussie ne vaut pas autorisation : prévoyez un écran d'attente lisible pour un compte qui ne porte pas encore le rôle attendu

## Déclaration reçue

CLIENTID=lelabs-crm-serveur
NOM=P2Enjoy CRM
TYPE=serveur
REDIRECT=https://crm.lelabs.tech/auth/retour
REDIRECT=https://crm.mcp.lelabs.tech/auth/callback
ACCUEIL=https://crm.lelabs.tech
ROLE=verified
HORS_LIGNE=oui
```

## 2. `lelabs-crm` — archive de l'ancien client public

Versé au dépôt le 2026-09-23 (`docs/JOURNAL.md`, décision 578) : la réponse à la déclaration de `docs/SPEC-auth.md`
§10.8. Le client était public et n'avait pas de secret.

Sonde publique rejouée le 2026-09-23 après réception (`docs/SPEC-auth.md` §10.8) : `302` vers
`https://crm.lelabs.tech/auth/retour` avec `error_description=Missing+parameter%3A+code_challenge_method`
— le client existe, l'URL est acceptée au caractère près, PKCE est exigé.

**Client supprimé du realm le 2026-09-24**, avant le déploiement de `CRM-092` : sonde `400`, « Client
non trouvé. » (`docs/JOURNAL.md`, décision 598). Ce bloc n'est plus qu'une archive.

---

```
# llms.txt — intégration OIDC « P2Enjoy CRM »

> Fournisseur d'identité du domaine, realm `lelabs`. Client créé le 2026-09-23 16:08:44.
> Ce bloc ne contient aucun secret et peut être collé tel quel à votre agent.

## Points d'entrée

- issuer : https://oauth.lelabs.tech/realms/lelabs
- découverte : https://oauth.lelabs.tech/realms/lelabs/.well-known/openid-configuration
- autorisation : https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/auth
- jeton : https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/token
- fin de session : https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/logout
- clés de signature : https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/certs

Préférez la découverte à la recopie : elle reste juste si le service évolue.

## Client

- client_id : lelabs-crm
- type : public — aucun secret, la sécurité repose sur PKCE
- authentification au point de jeton : aucune, PKCE tient lieu de preuve

## URL enregistrées

Elles sont comparées **caractère par caractère**. Une différence d'un seul
caractère fait échouer la connexion sans message utile.

redirect_uri :
- https://crm.lelabs.tech/auth/retour

post_logout_redirect_uri :
- aucune — la personne reste sur la page du fournisseur après déconnexion

origines web :
- https://crm.lelabs.tech

## Flux et portées

- flux : code d'autorisation **seul**
- PKCE : S256 **obligatoire**
- refusés par le serveur : flux implicite, octroi direct par mot de passe, flux appareil
- portées : openid profile email
- jamais exposés : téléphone et profil public déclarés à l'inscription — recueillis pour vérifier que la personne est réelle, le consentement ne couvre pas leur transmission

## Rôles

- les rôles de realm arrivent dans `realm_access.roles` du jeton d'accès
- rôles attendus par cette application :
- aucun — toute personne authentifiée est acceptée
- attribution : humaine, depuis l'interface de vérification du service ; jamais automatique
- durée de vie du jeton d'accès : 300 s

Testez la **présence** d'un rôle, jamais le nombre ni l'ordre : le tableau porte
aussi les rôles par défaut du realm. Relisez-le à chaque requête et ne le gardez
pas au-delà de la durée de vie du jeton — un rôle se retire aussi vite qu'il
s'attribue.

## À vérifier côté application

- l'`iss` du jeton vaut exactement https://oauth.lelabs.tech/realms/lelabs
- `azp` vaut lelabs-crm
- signature vérifiée par les clés publiées, algorithme asymétrique ; refuser tout jeton signé par un algorithme symétrique
- suivre la rotation des clés par le point `certs` plutôt qu'en épingler une
- une connexion réussie ne vaut pas autorisation : prévoyez un écran d'attente lisible pour un compte qui ne porte pas encore le rôle attendu

## Déclaration reçue

CLIENTID=lelabs-crm
NOM=P2Enjoy CRM
TYPE=navigateur
REDIRECT=https://crm.lelabs.tech/auth/retour
```
