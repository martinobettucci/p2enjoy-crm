# Realm de développement `lelabs`

Compagnon de [`realm-lelabs.json`](realm-lelabs.json), importé par le service `keycloak` de
`docker-compose.dev.yml`. Unités `CRM-091` puis **`CRM-092`** : spécification
`docs/SPEC-session-sso.md` §10, où le SSO devient la seule source d'identité du CRM (décision 578), et
§6.1 bis pour la règle du domaine sur `admin` (décision 597, tranche T8).

Ce texte vit ici et non dans le JSON : Keycloak refuse d'importer un realm portant un champ qu'il ne
connaît pas, commentaire compris.

## Ce que ce realm reproduit du SSO réel

Ce qu'une différence ferait payer au premier déploiement : le chemin `/realms/lelabs`, les rôles
`verified` et `admin`, **les rôles par défaut** du realm (`default-roles-lelabs`, donc
`offline_access`, `uma_authorization` et `aud: account` dans le jeton d'accès — mesuré, décision 580,
K14), **PKCE `S256` imposé** sur chaque client, des URL de retour **exactes**, et la vérification
d'adresse exigée. La version de l'image est celle du SSO réel, `26.7.3`.

## Ce qui diffère volontairement

- **Les comptes sont préchargés**, avec un identifiant imposé : leur `sub` est l'identifiant stable du
  seed (décision 580, K13). Sans cela, chaque recréation du conteneur tirait des `sub` au hasard, et
  une personne du CRM n'aurait pas été la même d'un démarrage à l'autre.
- **Un seul mot de passe**, `SeedDev2026Local`, celui du seed : il n'existe plus qu'une identité, il
  n'y a plus qu'un mot de passe. Publié, comme celui des boîtes de développement : ce n'est pas un
  secret, et le realm réel refuse ces comptes.
- Pas d'inscription libre.
- **Le client du CRM est CONFIDENTIEL, comme en production** (décision 586). Son identifiant est
  `SSO_OIDC_CLIENT_ID` (`lelabs-crm-serveur` par défaut) et son secret `SSO_OIDC_CLIENT_SECRET`, tous
  deux **substitués à l'import** depuis le `.env` du poste, où `./runDev.sh` tire le secret au hasard :
  le même nom de variable qu'en production, jamais une valeur versée. Un code n'est échangé qu'avec
  lui ; seul l'échangeur de session le détient, et le harnais le lit dans le `.env` pour les preuves
  qui ont besoin d'un jeton LeLabs brut. Le client public `lelabs-crm` de `CRM-091` est **retiré** : il
  n'avait plus d'emploi.
- Le client du CRM a **deux** URL de retour exactes : `SITE_URL` + `/auth/retour`, **substituée
  à l'import** (`${SSO_DEV_REDIRECT_URI}`) parce que l'origine du Vite de développement varie d'un
  poste à l'autre ; et `http://127.0.0.1:4173/auth/retour`, l'origine du `vite preview` que le
  harnais Playwright construit et sert (`e2e/playwright.config.ts`, `WEBAPP_PREVIEW_PORT` par
  défaut). Un harnais lancé sur un autre port verra Keycloak refuser l'URL — « Paramètre invalide :
  redirect_uri » —, et c'est voulu : le fournisseur réel compare au caractère près.
- Le client `crm-audience-etrangere` n'existe qu'ici, public : il sert à prouver le refus d'un code
  émis pour une autre application.

## Les comptes, et ce que chacun démontre

| Compte | `sub` | Adresse vérifiée | `verified` | Attendu par le seed | Démontre |
|---|---|---|---|---|---|
| `admin@` | `5eed…0011` | oui | oui | `admin` | le parcours nominal |
| `bizdev@` | `5eed…0012` | oui | oui | `business_developer` | un membre ordinaire |
| `viewer@` | `5eed…0013` | oui | oui | `viewer` | la lectrice ; **n'est plus** `admin` du realm depuis la décision 597, qui ferait d'elle une administratrice |
| `exploitante@` | `5eed…0017` | oui | oui, et `admin` du realm | non | la règle du domaine : admise sans attente, administratrice de tout espace, sans aucune appartenance (§6.1 bis) |
| `inconnu@` | `5eed…0014` | oui | oui | non | l'attente « aucun espace ne vous attend » |
| `attendu@` | `5eed…0015` | oui | **non** | `viewer` | l'attente « compte LeLabs pas encore vérifié » |
| `adresse-non-verifiee@` | `5eed…0016` | **non** | non | non | le refus d'une adresse non prouvée ; la preuve lève le temps d'un jeton l'exigence de vérification du realm |

Le domaine est `MAIL_DEV_PERSONAL_DOMAIN`, substitué à l'import : ce sont les adresses du seed.
Chaque compte porte `default-roles-lelabs`. « Attendu par le seed » décrit l'état que le seed pose
depuis la tranche T4 de `CRM-092` : une attente, consommée à la première connexion — sauf celle
d'`attendu@`, que LeLabs n'a pas vérifié.

## L'émetteur

`http://sso.localhost:<SSO_DEV_PORT>/realms/lelabs`, le même vu du navigateur et vu des services de la
pile (décision 568, M11). L'administration de l'instance est sur
`http://sso.localhost:<SSO_DEV_PORT>/admin`, compte `admin` et `SSO_DEV_ADMIN_PASSWORD`. Seuls les
harnais l'emploient — comptes jetables, rotation de clés, retrait d'un rôle — ; le produit ne
l'appelle jamais (`docs/SSO.md`).
