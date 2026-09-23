# Realm de développement `lelabs`

Compagnon de [`realm-lelabs.json`](realm-lelabs.json), importé par le service `keycloak` de
`docker-compose.dev.yml`. Unité `CRM-091`, spécification `docs/SPEC-auth.md` §10.9.

Ce texte vit ici et non dans le JSON : Keycloak refuse d'importer un realm portant un champ qu'il ne
connaît pas, commentaire compris.

## Ce que ce realm reproduit du SSO réel

Ce qu'une différence ferait payer au premier déploiement : le chemin `/realms/lelabs`, les rôles
`verified` et `admin`, **PKCE `S256` imposé** sur chaque client, des URL de retour **exactes**, et la
vérification d'adresse exigée. La version de l'image est celle du SSO réel, `26.7.3`.

## Ce qui diffère volontairement

- Les comptes, leur mot de passe commun `SsoDev2026Local`, et l'absence d'inscription libre.
- Le client `lelabs-crm` a **deux** URL de retour exactes : `SITE_URL` + `/auth/retour`, **substituée
  à l'import** (`${SSO_DEV_REDIRECT_URI}`) parce que l'origine du Vite de développement varie d'un
  poste à l'autre ; et `http://127.0.0.1:4173/auth/retour`, l'origine du `vite preview` que le
  harnais Playwright construit et sert (`e2e/playwright.config.ts`, `WEBAPP_PREVIEW_PORT` par
  défaut). Un harnais lancé sur un autre port verra Keycloak refuser l'URL — « Paramètre invalide :
  redirect_uri » —, et c'est voulu : le fournisseur réel compare au caractère près.
- Le client `crm-audience-etrangere` n'existe qu'ici : il sert à prouver que GoTrue refuse un jeton
  émis pour une autre audience (décision 568, M8).

## Les comptes, et ce que chacun démontre

| Compte | État SSO | Compte CRM | Ce qu'il démontre |
|---|---|---|---|
| `admin@p2enjoy.test` | `verified` | administratrice du seed | le parcours nominal |
| `bizdev@p2enjoy.test` | aucun rôle | membre du seed | qu'aucun rôle n'est exigé |
| `viewer@p2enjoy.test` | `verified` + `admin` du realm | lectrice du seed | que l'`admin` du realm n'ouvre aucun droit du CRM |
| `inconnu@p2enjoy.test` | `verified` | aucun | le refus « aucun compte » |
| `adresse-non-verifiee@p2enjoy.test` | adresse non vérifiée | créé par la preuve | le refus d'une adresse non prouvée (M5) |

Le domaine est `MAIL_DEV_PERSONAL_DOMAIN`, substitué à l'import : ce sont les adresses du seed.

## L'émetteur

`http://sso.localhost:<SSO_DEV_PORT>/realms/lelabs`, le même vu du navigateur et vu de GoTrue
(décision 568, M11). L'administration de l'instance est sur
`http://sso.localhost:<SSO_DEV_PORT>/admin`, compte `admin` et `SSO_DEV_ADMIN_PASSWORD`.
