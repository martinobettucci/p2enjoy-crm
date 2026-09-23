# Spécification — Le SSO, seule source d'identité : session ouverte par échange, GoTrue retiré

Unité de backlog : `CRM-092` (`docs/BACKLOG.md`).
Décisions : `docs/JOURNAL.md` 578 (instruction du responsable, mesures K1 à K9), 579 (arbitrage A1 à
A3), 580 (mesures K10 à K17), 581 (correction de K12 : migration élevée, harnais de l'unité).
Contrats du fournisseur : `docs/SSO.md` (général), `docs/SSO-client-lelabs-crm.md` (client du CRM).
Documents liés : `docs/SPEC-auth.md` (état remplacé), `docs/SPEC-identite.md` §3 à §6,
`docs/SPEC-permissions-rls.md` §1 à §3, `docs/SPEC-edge-functions.md` §2 à §5, `docs/SPEC-seed.md`
§2.2 à §3.5, `docs/SPEC-test-harness.md`, `docs/SPEC-deploiement-spark.md`, `docs/SCHEMA.md` §1,
`docs/DAT.md` §3 et §4.1, `docs/DESIGN_SYSTEM.md` §5.12, `docs/manual.md` chapitres 1 et 17.

Écrite le 2026-09-23 **avant la première ligne de code**, sur des faits mesurés : chaque
affirmation ci-dessous renvoie à une mesure K*n* ou est signalée comme restant à mesurer.

---

## 1. Principe

**Le SSO `oauth.lelabs.tech` est la seule source d'identité du CRM**, en développement comme en
production (décision 578). Le CRM ne crée, ne prouve et ne conserve aucune identité :

- aucun mot de passe, aucune inscription, aucune invitation par courriel, aucune récupération ;
- aucun compte GoTrue : le service `auth` et ses gabarits quittent la pile ;
- l'identifiant d'une personne dans le CRM est le **`sub` du SSO**, et rien d'autre.

Ce que le CRM garde, c'est **l'autorisation** : les appartenances aux espaces, leurs rôles et les
droits fins restent dans ses tables et sont relus à chaque requête par la RLS (décision 579, A3).

Entre les deux, un **échangeur de session** (décision 579, A1) : il reçoit le jeton d'accès LeLabs,
le vérifie, applique la règle d'admission, et remet au navigateur un **jeton interne** court, que
PostgREST, Realtime et Storage acceptent sans changement. L'échangeur ne stocke rien : il traduit une
preuve vérifiée en un format que la pile de données sait lire.

Comme partout dans ce projet, « refusé » désigne une règle appliquée côté serveur. Le navigateur
transporte des preuves ; il ne décide d'aucun accès.

## 2. Ce qui est retiré, et ce qui en reste

| Retiré | Où | Tranche |
|---|---|---|
| Service `auth` (GoTrue) et service `auth-templates` | `docker-compose.yml`, overlays dev, prod et cellule | T6 |
| Gabarits de courriel `supabase/auth/templates/` | dépôt | T6 |
| Routes Kong `/auth/v1/*` et `/.well-known/oauth-authorization-server` | `supabase/docker/volumes/api/kong.yml` | T6 |
| Variables propres à GoTrue : `DISABLE_SIGNUP`, `ENABLE_EMAIL_SIGNUP`, `ENABLE_EMAIL_AUTOCONFIRM`, `ENABLE_PHONE_*`, `ENABLE_ANONYMOUS_USERS`, `PASSWORD_MIN_LENGTH`, `ADDITIONAL_REDIRECT_URLS`, `MAILER_*`, `SMTP_*` | `.env.example`, `scripts/lib/env.sh`, `runDev.sh`, `scripts/spark/proposer.sh` | T6 |
| Formulaire à mot de passe de `/connexion` et module `webapp/src/lib/auth.ts` en ce qu'il classe les refus de GoTrue | webapp | T5 |
| Échange d'`id_token` de `CRM-091` et son nonce | `webapp/src/lib/sso.ts`, `Authentification.tsx` | T5 |
| Trigger `on_auth_user_created` et `app.handle_new_user()` | migration `0076` | T6 |
| Clé étrangère `profiles.id → auth.users` | migration `0075` | T1 |
| Création de comptes par l'API d'administration GoTrue, connexions par mot de passe GoTrue | seed, `e2e/api/jetons.ts`, 18 scripts, 50 specs d'interface | T4, T5 |

Une variable qu'un autre service consomme encore (`SITE_URL` pour le realm de développement,
`JWT_EXPIRY` si PostgREST la lit toujours) **reste**, redocumentée pour ce qu'elle sert désormais ; la
tranche T6 le mesure par recherche exhaustive avant de retirer quoi que ce soit.

**Ce qui reste, inerte.** Les tables du schéma `auth` ne sont pas supprimées : la base neuve les
reçoit de l'image (K10), la production porte celles de GoTrue et le compte de K9. Plus rien n'y
écrit. Les supprimer est une opération destructive distincte, hors de cette unité (§15).

## 3. Faits qui fondent le contrat

Résumé ; le détail est dans `docs/JOURNAL.md`, décisions 578 et 580.

| # | Fait | Conséquence |
|---|---|---|
| K3 | Le jeton d'accès LeLabs est `RS256`, porte `sub`, `azp`, `typ=Bearer`, `email`, `email_verified`, `name` et `realm_access.roles` ; **ni `role`, ni `aud` utilisable** (K14 : `aud=account` dès que les rôles par défaut sont présents) ; il vit `300 s` | L'échangeur contrôle `iss`, `azp` et `typ`, jamais `aud` |
| K5 | PostgREST n'accepte qu'une clé statique et lit le rôle dans `.role` | Le jeton LeLabs n'est pas présenté à la pile de données ; le jeton interne l'est |
| K6 | `supabase-js` 2.112 accepte `accessToken` | Le client de la webapp reçoit le jeton interne sans module `auth` |
| K7 | La RLS n'emploie que `auth.uid()`, qui ne lit que `sub` | Le jeton interne porte `sub` = `sub` LeLabs ; aucune politique ne change |
| K11, K12 | Sans GoTrue, `auth.uid()` d'une base neuve rend `NULL` ; ses fonctions appartiennent à un rôle dont `postgres` n'est pas membre | Migration élevée `0074` (§7.1, décision 581) |
| K13 | Un `id` imposé à l'import devient le `sub` | Les comptes du seed gardent leurs identifiants stables (§10) |
| K15 | Le client public rafraîchit son jeton sans secret | La webapp rafraîchit chez LeLabs puis rééchange (§8.4) |
| K16 | Révoquer le jeton de rafraîchissement ferme la session LeLabs | La déconnexion du CRM ne révoque rien (§8.5) |
| K17 | La cellule sort vers `oauth.lelabs.tech` | L'échangeur lit la découverte et les clés en production |

## 4. Parcours de connexion

1. **`/connexion`** offre **une seule action**, primaire : « Se connecter avec LeLabs » (§9).
2. La webapp lit la découverte, tire un vérificateur PKCE et un `state`, enregistre la transaction et
   navigue vers le point d'autorisation — **sans nonce** désormais : aucun `id_token` n'est plus lu,
   et PKCE protège le code (§8.1).
3. LeLabs revient sur **`/auth/retour`**. La transaction est retirée dès sa lecture ; `state` et `code`
   sont jugés comme aujourd'hui (`docs/SPEC-auth.md` §10.3, points 5 et 6).
4. La webapp échange le code au point de jeton de LeLabs et lit **le jeton d'accès et le jeton de
   rafraîchissement**. L'`id_token` n'est plus lu.
5. Elle présente le jeton d'accès à l'**échangeur** (§5). Celui-ci rend soit un jeton interne, soit un
   refus nommé (§5.4).
6. Succès : la session est écrite dans le stockage d'onglet (§8.3), l'adresse de retour est rejointe
   par remplacement. Refus : retour à `/connexion`, qui rend le refus ou l'attente (§9).

## 5. L'échangeur de session — fonction edge `session`

### 5.1 Requête

`POST /functions/v1/session`, derrière Kong comme toute fonction (`docs/SPEC-edge-functions.md` §5) :
en-tête `apikey` (clé anonyme) et `Authorization: Bearer <jeton d'accès LeLabs>`. La traduction Lua de
Kong laisse passer un `Authorization` qui ne commence pas par `Bearer sb_` (mesuré dans
`kong-entrypoint.sh`). Corps vide. Toute autre méthode : `405`.

### 5.2 Vérifications, dans cet ordre

Toutes appliquées **avant** tout accès à la base. La première qui échoue arrête l'échange.

1. Le jeton est un JWS compact à trois segments base64url, d'en-tête et de charge JSON.
2. **`alg` ∈ { `RS256`, `ES256` }**. `none`, toute la famille `HS*` et tout autre algorithme sont
   refusés **avant** de chercher une clé : aucune clé symétrique n'est jamais essayée, comme le
   demande `docs/SSO-client-lelabs-crm.md`.
3. **Découverte** : `GET ${SSO_OIDC_ISSUER}/.well-known/openid-configuration`, délai `3 s`. Son
   `issuer` doit être **égal** à `SSO_OIDC_ISSUER` ; son `jwks_uri` doit être une URL `https:` — ou
   `http:` sur un hôte de boucle locale ou `*.localhost`, pour le seul Keycloak de développement.
4. **Clés** : `GET jwks_uri`, délai `3 s`. La clé retenue a le même `kid` que l'en-tête, un `kty`
   conforme à `alg` (`RSA` ou `EC` `P-256`) et un `use` absent ou égal à `sig`. **Aucune clé n'est
   épinglée ni gardée** : chaque échange relit la découverte et les clés, ce qui suit toute rotation
   sans redémarrage. Un `kid` inconnu est un refus.
5. **Signature** vérifiée par WebCrypto (`RSASSA-PKCS1-v1_5` SHA-256, ou `ECDSA` P-256 SHA-256).
   Aucune bibliothèque tierce : le runtime fournit tout, et `CLAUDE.md` §19 demande de s'en contenter.
6. **Revendications** : `iss` **égal** à `SSO_OIDC_ISSUER` ; `azp` **égal** à `SSO_OIDC_CLIENT_ID` ;
   `typ` égal à `Bearer` — un `id_token` (`typ=ID`) n'est pas un jeton d'accès ; `exp` postérieur à
   l'instant présent, sans tolérance ; `iat`, s'il est présent, pas plus de `60 s` dans le futur ;
   `sub` est un UUID — `auth.uid()` le convertit en `uuid`, et un autre format ne pourrait désigner
   aucun profil.
7. **Admission** (§6), dans cet ordre : `email` présent et `email_verified` strictement `true`, puis
   **présence** de `verified` dans `realm_access.roles` — jamais le nombre ni l'ordre des rôles (K14),
   puis l'appel de `public.ouvrir_session_sso` (§6.2).

### 5.3 Réponse de succès — `200`

```json
{ "jeton": "<jeton interne>", "expire_a": 1790180430,
  "identite": { "id": "<sub>", "adresse": "<email>", "nom": "<nom du profil>" } }
```

**Le jeton interne** est un JWT `HS256` signé par `JWT_SECRET`, la clé que PostgREST, Realtime et
Storage connaissent déjà :

| Revendication | Valeur |
|---|---|
| `iss` | `p2enjoy-crm/session` — il n'est jamais confondu avec un jeton LeLabs |
| `sub` | le `sub` LeLabs |
| `role` | `authenticated` |
| `aud` | `authenticated` |
| `iat` | l'instant de l'échange |
| `exp` | **le plus proche** de l'`exp` du jeton LeLabs et de `iat + 300` |

Il ne porte **ni rôle du realm, ni rôle d'espace, ni adresse** : les droits restent relus par la RLS
(§1), et l'admission est rejouée à chaque échange (§8.4). Sa durée ne dépasse jamais celle du jeton
LeLabs : un `verified` retiré, une appartenance retirée ou un compte LeLabs désactivé ferment l'accès
**au plus tard 300 s après**. C'est la lecture, pour ce CRM, de « relisez le rôle à chaque requête et
ne le gardez pas au-delà de la durée de vie du jeton ».

Ce jeton est symétrique, et la règle du fournisseur interdit d'**accepter** un jeton symétrique **comme
preuve SSO** : l'échangeur n'en accepte aucun (§5.2, point 2). Le jeton interne ne prouve rien au
SSO ; il ne sort pas du CRM.

### 5.4 Refus — dictionnaire fermé

Corps `{"erreur": "<code>"}`, auquel s'ajoute `"adresse"` pour les trois attentes, afin que l'écran
puisse la nommer. Aucune autre information : ni motif technique, ni message du fournisseur.

| Code HTTP | `erreur` | Cause |
|---|---|---|
| `401` | `jeton_refuse` | en-tête absent ou mal formé, point 1, 2, 4, 5 ou 6 du §5.2 |
| `403` | `adresse_non_verifiee` | `email` absent ou `email_verified` différent de `true` |
| `403` | `attente_verification` | `verified` absent des rôles du realm |
| `403` | `attente_espace` | personne vérifiée, mais aucune appartenance ni aucune attente à son adresse (§6) |
| `405` | `methode` | méthode autre que `POST` |
| `502` | `sso_injoignable` | découverte ou clés injoignables, délai dépassé, réponse non conforme, émetteur de la découverte différent |
| `502` | `service_indisponible` | appel de `ouvrir_session_sso` en échec |

Un `401` ne distingue pas ses causes : les distinguer n'aiderait que qui forge des jetons.

### 5.5 Environnement, journalisation, limites

- **Variables** : `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID`, `JWT_SECRET`, `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`. Le service principal (`supabase/functions/main`) transmet désormais
  l'environnement **par fonction** : `JWT_SECRET` et les deux `SSO_*` ne sont remis **qu'à** `session`.
  Une autre fonction ne peut pas frapper un jeton.
- **Journal** : un événement structuré par échange — `session_ouverte` ou `session_refusee` avec son
  code, identifiant de requête et durée. **Jamais** de jeton, d'adresse, de nom ni de `sub`.
- **Délais** : `3 s` par appel — découverte, clés, puis la base —, pour que les trois restent sous
  les 10 s de temps mur d'un worker (`docs/SPEC-edge-functions.md` §2) et qu'un fournisseur lent
  rende `sso_injoignable` plutôt qu'un worker tué sans réponse (révisé en T3, décision 584).
- **Configuration absente** : l'échangeur rend `service_indisponible` et journalise
  `configuration_absente`, sans rien tenter.
- **Coût** : deux lectures chez LeLabs par échange, soit une ouverture et un rafraîchissement toutes les
  cinq minutes environ par onglet ouvert. Le service principal crée un worker par requête
  (`--policy oneshot`) : aucune mémoire ne survit, et c'est ce qui rend la rotation gratuite. Le délai
  mesuré d'un échange est consigné à la livraison ; un cache n'est ajouté que si une mesure le justifie
  (`CLAUDE.md` §21).
- **Mode dégradé** : LeLabs injoignable, aucune session ne s'ouvre ni ne se prolonge ; les sessions en
  cours s'arrêtent au plus tard à leur échéance, avec le message réseau (§9). Aucun repli qui
  ouvrirait une session sans preuve.

## 6. Admission — personne attendue ET vérifiée

### 6.1 Règle

Une connexion LeLabs ouvre une session du CRM **si et seulement si** (décision 579, A2) :

1. l'adresse du jeton est **vérifiée** (`email_verified = true`) ;
2. la personne porte le rôle de realm **`verified`** ;
3. la personne est **membre** d'au moins un espace, ou **attendue** à cette adresse par au moins un.

Une personne attendue devient membre à sa première connexion admise : ses attentes sont
**consommées** et changées en appartenances, avec le rôle choisi par l'administrateur. Elles se
rattachent au `sub`, non à l'adresse : un changement d'adresse ultérieur chez LeLabs ne défait rien.

Une personne qui ne remplit pas 1 ou 2 n'est **jamais** rattachée, même attendue : l'attente reste en
place et se consommera le jour où elle sera vérifiée. Une personne vérifiée mais ni membre ni attendue
ne laisse **aucune trace** dans le CRM : pas de profil, pas de ligne (`CLAUDE.md` §11, minimisation).

Les rôles `admin` du realm et tout autre rôle ne sont **pas** lus (décision 579, A3) : un porteur
d'`admin` chez LeLabs reste lecteur dans un espace où il est lecteur.

### 6.2 `public.ouvrir_session_sso(p_sub uuid, p_email text, p_nom text) returns jsonb`

`SECURITY DEFINER`, propriétaire `postgres`, `search_path = ''`, `EXECUTE` retiré à `public`, `anon`
et `authenticated`, accordé à **`service_role` seul** — le précédent est
`public.chemin_dossier_card`. Seul l'échangeur l'appelle, après le §5.2 ; la fonction ne revérifie
pas le jeton, qu'elle ne voit pas.

Dans une transaction :

1. normaliser l'adresse : `lower(btrim(p_email))` ;
2. consommer les attentes de cette adresse (`delete … returning`) ;
3. si des attentes ont été consommées ou si `p_sub` a déjà un profil : créer le profil s'il manque
   (`on conflict (id) do nothing`), le nom suivant la chaîne de repli de `docs/SCHEMA.md` §1 appliquée
   aux revendications — `p_nom` épuré, puis la partie locale de l'adresse, puis
   « Utilisateur » suivi des huit premiers caractères du `sub` —, borné à 120 caractères
   (`docs/SPEC-identite.md` §4). **Un profil existant n'est jamais réécrit** : son nom est éditable
   par la personne ;
4. insérer une appartenance par attente consommée, `on conflict do nothing` — une appartenance
   existante garde son rôle ;
5. rendre `{"admis": <au moins une appartenance>, "espaces": n, "rattachees": m, "nom": <nom du profil ou null>}`.

Deux ouvertures concurrentes de la même personne convergent : la seconde attend les verrous de la
première sur les attentes, puis n'en trouve plus et lit l'appartenance validée. L'invariant du dernier
administrateur (`docs/SPEC-identite.md` §5) n'est jamais sollicité : la fonction n'insère que.

### 6.3 Qui inscrit une attente

Un **administrateur de l'espace**, par l'API : insertion dans `workspace_invitations` sous la RLS du
§7.2. L'écran qui le permet appartient à `CRM-070`, qui reste propriétaire de l'invitation d'un
membre (`docs/BACKLOG.md`, précision d'arbitrage de `CRM-070`) ; d'ici là, l'opérateur l'inscrit par
`scripts/spark/amorcer-espace.sh` en production (§12) et le seed en développement (§11). Ce n'est
plus une création de compte : c'est l'inscription d'une adresse, que le SSO seul pourra honorer.

## 7. Modèle de données

### 7.1 Les fonctions `auth.*` — migration élevée `0074_revendications_du_jeton.sql`

Déclare `-- @migration-role: supabase_admin` avec son motif mesuré (K12), selon la décision 363, et
**ne crée rien d'autre**. Elle pose `auth.uid()`, `auth.role()`, `auth.email()` et `auth.jwt()` sous
la forme exacte que GoTrue installait — lecture de `request.jwt.claim.<x>`, puis de
`request.jwt.claims ->> '<x>'` —, fonctions SQL sans `SECURITY DEFINER`, propriétaire
`supabase_auth_admin` comme sous GoTrue. Rejouée à chaque passage du runner, elle s'applique à toute
base : sur une base neuve elle lève K11 ; sur une base où GoTrue a tourné, développement existant
comme production, elle réécrit une définition identique (décision 581). `scripts/verify-scripts.sh`
ajoute ce fichier à la liste nommée des élévations.

### 7.2 Migration `0075_identite_sso.sql` — tranche T1

- **Retire** la clé étrangère `profiles.id → auth.users` : un profil naît désormais d'un `sub` LeLabs,
  qui n'a pas de ligne dans `auth.users`. Le commentaire de `profiles.id` devient « `sub` du SSO ».
- **Crée `public.workspace_invitations`** :

  | Colonne | Type | Règle |
  |---|---|---|
  | `workspace_id` | `uuid` | non nul, `references workspaces on delete cascade` |
  | `email` | `text` | non nul ; égal à `lower(btrim(email))` ; 3 à 320 caractères ; un seul `@`, entouré de caractères non blancs |
  | `role` | `text` | non nul, `admin`, `business_developer` ou `viewer` — la liste de `workspace_members` |
  | `invited_by` | `uuid` | `references profiles on delete set null` |
  | `created_at` | `timestamptz` | non nul, `now()` |

  Clé primaire `(workspace_id, email)` ; index sur `email`, la question posée à chaque échange.
- **RLS** de `workspace_invitations`, activée : lecture, insertion et suppression par un
  **administrateur de l'espace** (`app.is_workspace_admin(workspace_id)`) ; à l'insertion,
  `invited_by = auth.uid()`. **Aucune mise à jour** : changer le rôle d'une attente, c'est la retirer et
  la réinscrire, comme pour une appartenance. Privilèges de table alignés sur la convention du projet
  (`docs/SPEC-permissions-rls.md` §3.2) : ce que `anon` peut lire rend zéro ligne, jamais une erreur
  de privilège.
- **Crée `public.ouvrir_session_sso`** (§6.2).

Le trigger `on_auth_user_created` **reste** jusqu'à T6 : tant que GoTrue tourne encore, il ne gêne
rien, et le retirer avant que le seed ne passe par le SSO (T4) casserait le seed. La migration `0076`
le retire avec GoTrue.

### 7.3 Données de production

La migration ne modifie **aucune ligne**. Le compte de K9 est repris par une opération décrite au §12,
exécutée sur instruction explicite seulement.

## 8. Webapp

### 8.1 `webapp/src/lib/sso.ts` — révisé

Garde la découverte (émetteur exact), le PKCE `S256`, la transaction à usage unique de dix minutes et
le jugement du retour. **Retire** le nonce et l'échange d'`id_token`. `echangerCode` rend
`{ jetonAcces, jetonRafraichissement }` ; un corps sans l'un des deux est un `sso_echec`. Ajoute
`rafraichir(pointJeton, clientId, jetonRafraichissement)`, `grant_type=refresh_token`.

### 8.2 `webapp/src/lib/session.ts` — nouveau

Porte la session du CRM et rien d'autre : échange auprès de l'échangeur, classement de ses refus
(§5.4 vers §9.2), écriture et lecture du stockage, horloge de rafraîchissement, oubli. Il ne rend rien.

### 8.3 Stockage sur l'appareil

- **`p2enjoy-crm.session`**, dans `sessionStorage` par `creerStockageSession`, repli mémoire compris :
  jeton interne, son échéance, jeton de rafraîchissement LeLabs, point de jeton lu dans la découverte,
  identité affichable (`id`, `adresse`, `nom`). Catégorie 1 de `CLAUDE.md` §11 : strictement
  nécessaire à la session, bornée à l'onglet. C'est la posture exacte de la session GoTrue qu'elle
  remplace, qui portait elle aussi un jeton de rafraîchissement dans ce stockage.
- **`p2enjoy-crm.sso.transaction`** inchangée.
- Aucun `localStorage`, aucun cookie posé par le CRM.

### 8.4 Restauration et rafraîchissement

- Au chargement, la session stockée est relue avant tout montage métier (`docs/SPEC-auth.md` §9.1).
  Échue ou à moins de 60 s de son échéance : elle est d'abord rafraîchie.
- Le rafraîchissement part **60 s avant** l'échéance du jeton interne : jeton de rafraîchissement chez
  LeLabs (K15), puis **nouvel échange** — l'admission est donc rejouée à chaque fois. Un seul
  rafraîchissement à la fois.
- Refus de LeLabs (`400`, session LeLabs échue ou fermée) : la session du CRM prend fin avec
  `session_expiree`. Refus de l'échangeur : la session prend fin avec son code. Réseau : nouvel essai
  jusqu'à l'échéance, puis fin avec `reseau`.
- Le client `supabase-js` est créé avec `accessToken`, qui rend le jeton interne courant (K6).
  **Mesuré en T3 (K18, décision 584)** : `supabase-js` pose ce jeton sur Realtime de façon
  asynchrone, sans l'attendre ; un abonnement lancé aussitôt rejoint le canal **en anonyme**. La
  webapp pose donc le jeton sur Realtime (`realtime.setAuth`) et l'**attend** avant tout abonnement,
  puis à chaque renouvellement. Un jeton refusé par Realtime ne rend aucun état : il n'entre pas.
  La preuve de T5 est une souscription qui survit à un rafraîchissement.

### 8.5 Déconnexion

« Se déconnecter » **oublie** la session du CRM — stockage d'onglet vidé, client remis à l'anonyme — et
mène à `/connexion`. **Rien n'est révoqué chez LeLabs** : révoquer fermerait la session LeLabs de la
personne (K16), ce que `docs/SSO.md` exclut. Conséquence assumée et documentée dans le manuel : se
reconnecter depuis le même navigateur ne redemande pas le mot de passe LeLabs tant que la session
LeLabs vit ; la fermer se fait depuis l'espace de compte LeLabs. Le jeton de rafraîchissement effacé
reste valide chez LeLabs jusqu'à son échéance d'inactivité, et n'existe plus que là.

## 9. Interface

### 9.1 `/connexion` — `docs/DESIGN_SYSTEM.md` §5.12, révisé en T5

- Même carte autonome, mêmes jetons. Titre H1 « Se connecter ». Phrase : l'accès est réservé aux
  personnes inscrites par un administrateur de leur espace, avec un compte LeLabs vérifié.
- **Une seule action, primaire, pleine largeur** : « Se connecter avec LeLabs », icône `KeyRound`.
  Plus de champ, plus de séparateur « ou ».
- Pendant la redirection, l'action est désactivée et son libellé devient « Redirection vers
  LeLabs… ».
- `VITE_SSO_*` ou `VITE_SUPABASE_*` absentes au build : aucune action, et l'emplacement d'erreur dit
  que la connexion n'est pas configurée sur ce déploiement. La commande morte reste interdite
  (§5.10 du design system).
- Le retour de LeLabs rend la carte squelette annoncée « Connexion LeLabs en cours ».

### 9.2 Refus et attentes — deux surfaces distinctes

Un **refus** dit qu'une tentative a échoué ; une **attente** dit que la personne n'a rien fait de faux
et qu'un geste d'autrui manque. Elles ne se ressemblent pas.

| Nature | Surface | Message |
|---|---|---|
| `sso_annule` | refus | La connexion LeLabs a été annulée. |
| `sso_echec` | refus | La connexion LeLabs n'a pas abouti. Recommencez depuis cet écran. |
| `reseau` | refus | le message réseau existant de `docs/SPEC-auth.md` §9.3 |
| `session_expiree` | refus | Votre session a pris fin. Reconnectez-vous avec LeLabs. |
| `adresse_non_verifiee` | attente | Votre adresse *adresse* n'est pas encore vérifiée auprès de LeLabs. Vérifiez-la depuis votre compte LeLabs, puis reconnectez-vous. |
| `attente_verification` | attente | Votre compte LeLabs *adresse* n'est pas encore vérifié. Un administrateur de LeLabs doit confirmer votre identité avant que le CRM vous ouvre ses espaces ; ce geste est humain et peut prendre du temps. |
| `attente_espace` | attente | Aucun espace du CRM ne vous attend à l'adresse *adresse*. Demandez à un administrateur de votre espace de vous inscrire avec cette adresse, puis reconnectez-vous. |

- **Refus** : surface `--color-danger-soft`, texte `--color-danger-on-soft`, icône `TriangleAlert`,
  `role="alert"` — la forme existante.
- **Attente** : surface `--color-accent-soft`, texte `--color-accent-on-soft`, icône Lucide
  **`Hourglass`**, `role="status"`, titre court « Accès en attente ». Aucune couleur ni aucun jeton
  nouveau ; une icône nouvelle, qui ne sert aucun autre objet.
- L'une ou l'autre se place au-dessus de l'action, qui la cite par `aria-describedby`. L'action reste
  disponible : se reconnecter est le seul geste utile, une fois la cause levée.
- Les textes sont centralisés dans `webapp/src/i18n`, clés stables ; l'adresse est interpolée, jamais
  concaténée.

### 9.3 En-tête

Nom et avatar du profil courant, lus dans `profiles` par l'`id` de la session ; l'adresse de la session
en infobulle et en repli ; « Se déconnecter » (§8.5). Inchangé à l'œil.

## 10. Keycloak de développement préchargé — tranche T2

`keycloak/realm-lelabs.json`, importé au démarrage du service `keycloak` de l'overlay de
développement. Ce qui change :

- **Identifiants imposés** : le `sub` de chaque compte est un identifiant stable (K13).
- **Rôles par défaut** `default-roles-lelabs` sur chaque compte, comme le realm réel (K4, K14).
- **Un seul mot de passe de développement**, `SeedDev2026Local`, publié comme aujourd'hui : il n'existe
  plus qu'une identité, il n'y a plus qu'un mot de passe. `SsoDev2026Local` disparaît.

| Compte | `sub` | Adresse vérifiée | `verified` | Attendu par le seed | Démontre |
|---|---|---|---|---|---|
| `admin@` | `5eed…0011` | oui | oui | `admin` | le parcours nominal |
| `bizdev@` | `5eed…0012` | oui | oui | `business_developer` | un membre ordinaire |
| `viewer@` | `5eed…0013` | oui | oui, et `admin` du realm | `viewer` | que l'`admin` du realm n'ouvre aucun droit |
| `inconnu@` | `5eed…0014` | oui | oui | non | l'attente `attente_espace` |
| `attendu@` | `5eed…0015` | oui | **non** | `viewer` | l'attente `attente_verification`, attente non consommée |
| `adresse-non-verifiee@` | `5eed…0016` | **non** | non | non | l'attente `adresse_non_verifiee`, par la preuve qui l'y amène (§13) |

Le domaine reste `MAIL_DEV_PERSONAL_DOMAIN`, substitué à l'import. Le client `lelabs-crm` garde ses
deux URL de retour exactes ; le client `crm-audience-etrangere` reste, pour prouver le refus d'`azp`.

**L'API d'administration du Keycloak de développement** sert au seul harnais — comptes jetables d'une
preuve, rotation de clés, retrait d'un rôle — avec `SSO_DEV_ADMIN_PASSWORD`. Le produit ne l'appelle
jamais, et rien ne l'appelle en production (`docs/SSO.md`).

## 11. Seed — tranche T4

Le seed ne crée plus de compte : les comptes existent dans le Keycloak préchargé. Il :

1. crée l'espace et le reste de ses données comme aujourd'hui ;
2. inscrit les **attentes** des quatre adresses attendues du §10 ;
3. **ouvre la session de chaque compte seedé par la vraie connexion** — PKCE contre le Keycloak de
   développement, puis l'échangeur (K2) : ce sont donc l'échangeur et `ouvrir_session_sso` qui créent
   profils et appartenances, par le chemin de production (`CLAUDE.md` §8) ;
4. pose les avatars par la mise à jour de **son propre** profil, avec le jeton de chaque personne ;
5. relit : trois profils aux identifiants stables, trois appartenances aux rôles attendus, l'attente
   d'`attendu@` intacte, aucune trace d'`inconnu@`.

Le rejeu ne crée rien : les attentes déjà consommées ne sont pas réinscrites pour une personne déjà
membre. `attendu@` n'étant pas vérifié, sa connexion est refusée et son attente demeure : c'est l'état
démontré.

## 12. Production

Opérations à décrire dans `docs/PROD_MIGRATIONS.md` en T7, **chacune exécutée sur instruction
explicite du responsable** :

1. Lecture seule d'abord : l'espace `crm` ne porte rien d'autre que l'appartenance de K9 — aucune
   card, aucun commentaire, aucune donnée — et le compte n'a jamais été connecté.
2. Appliquer `0074`, `0075` et `0076`.
3. Livrer la fonction `session` ; remettre `JWT_SECRET` et les `SSO_*` au seul service `functions`.
4. Arrêter et retirer `auth` et `auth-templates` ; retirer les variables du §2, dont les `SMTP_*` que
   `proposer.sh` proposait pour les seuls courriels de GoTrue.
5. **Reprise du compte de K9** : l'espace vide est supprimé puis réamorcé par
   `amorcer-espace.sh --email martino@p2enjoy.studio --espace "P2Enjoy CRM" --slug crm`, qui n'inscrit
   plus qu'une **attente** `admin`. Supprimer puis recréer est la seule voie : retirer l'unique
   administrateur d'un espace est refusé par l'invariant du dernier administrateur, même espace vidé
   (`docs/SPEC-identite.md` §5), et le `sub` LeLabs n'est connu qu'à la première connexion.
6. **Préalable humain** chez LeLabs : `martino@p2enjoy.studio` doit porter `verified` et une adresse
   vérifiée (décision 579). Sans cela, sa connexion rend l'attente, et c'est le comportement voulu.
7. Vérifier : sonde `302` ; `/auth/v1/health` ne répond plus ; une connexion réelle aboutit ; l'attente
   est consommée ; `profiles.id` vaut le `sub` LeLabs.

## 13. Preuves exigées

| Niveau | Preuve |
|---|---|
| Unitaire, Deno | `supabase/functions/session/*.test.ts` : jeton mal formé ; `alg` `none`, `HS256`, `HS512`, `RS384` refusés **sans** lecture de clé ; `kid` inconnu ; signature altérée d'un octet ; `iss`, `azp`, `typ` différents ; `exp` passé d'une seconde ; `iat` futur ; `sub` non UUID ; adresse non vérifiée ; `verified` absent, puis présent parmi d'autres rôles dans un autre ordre ; découverte d'un autre émetteur ; délai dépassé ; jeton interne : revendications exactes, signature vérifiable par `JWT_SECRET`, `exp` = min des deux ; dictionnaire du §5.4 complet. Clés RSA et EC tirées par WebCrypto dans le test, jamais versées |
| pgTAP | `workspace_invitations` : contraintes, clé, trois politiques et privilèges ; `ouvrir_session_sso` : attente consommée en appartenance au bon rôle, profil créé une fois, profil existant non réécrit, appartenance existante non rétrogradée, aucune trace sans attente, rejeu stable, `EXECUTE` refusé à `anon` et `authenticated` ; `profiles` sans clé vers `auth.users` |
| Base neuve | T1 : un cluster jetable **sans GoTrue**, `0074` appliquée deux fois : `auth.uid()` rend le `sub` de `request.jwt.claims` (K11 levée), propriétaire inchangé. T6 : la pile entière recréée sans GoTrue par `./resetMe.sh`, seed et preuves d'API rejoués — une lecture RLS réelle aboutit |
| API, pile réelle | `e2e/api/session.spec.ts`, Keycloak de développement et échangeur derrière Kong : les trois comptes seedés ouvrent une session et lisent leurs données sous RLS ; `inconnu@`, `attendu@`, adresse non vérifiée rendent leur `403` et leur code ; jeton du client étranger, `id_token`, jeton interne présenté à l'échangeur : `401` ; jeton interne accepté par PostgREST, **Realtime** et **Storage** ; `verified` retiré par l'API d'administration de développement → échange suivant refusé ; appartenance retirée → échange suivant refusé ; **rotation** : nouvelle clé prioritaire créée, nouveau jeton accepté sans redémarrer, ancienne clé désactivée → ancien jeton refusé ; `/auth/v1/*` → `404` après T6 |
| E2E | `e2e/ui/connexion.spec.ts` : vraie page Keycloak pour chacun des trois rôles ; session dans `sessionStorage`, `localStorage` vide, transaction retirée, URL sans `code` ; rechargement conservant la session ; **rafraîchissement** franchi par l'horloge de Playwright sans perte de session ; déconnexion ramenant à `/connexion` et reconnexion sans formulaire tant que LeLabs vit ; `inconnu@` et `attendu@` voyant leur attente ; annulation ; configuration absente ; console vierge. Les 50 specs d'interface se connectent par la fixture `connecterAvecLeLabs` |
| Visuel | carte de connexion, redirection, retour, chacun des refus et chacune des attentes, textes longs, aux quatre paliers ; captures observées |
| Harnais | **`scripts/verify-session-sso.sh`**, grandi à chaque tranche et **non complaisant** : il rougit si `alg=HS256` est accepté, si `azp` n'est plus contrôlé, si l'admission cesse d'exiger `verified`, si `/auth/v1` répond, si `JWT_SECRET` atteint une autre fonction que `session`. `scripts/verify-auth.sh` est retiré avec GoTrue en T6 (décision 581) |

Les suites existantes qui prouvaient GoTrue sont **révisées ou retirées avec leur objet**, jamais
désactivées : chaque retrait est nommé dans le journal avec ce qui le remplace.

## 14. Découpage en tranches

Chaque tranche est un commit cohérent, vert sur son périmètre, poussé, avec sa documentation. L'ordre
garde la pile utilisable à chaque étape : GoTrue ne part qu'en T6, quand plus rien n'en dépend. **T5
précède T4** (décision 585) : le seed ne cesse de créer des comptes GoTrue qu'une fois la webapp
passée au SSO.

| Tranche | Contenu | Dépend de |
|---|---|---|
| **T1** | Migrations `0074` et `0075`, pgTAP, preuve de base neuve, `scripts/verify-session-sso.sh`, `docs/SCHEMA.md` §1 | — |
| **T2** | Keycloak préchargé (§10), `keycloak/README.md`, révision des preuves `CRM-091` qui en dépendent | — |
| **T3** | Fonction `session`, environnement par fonction dans `main`, variables vers `functions`, tests Deno, `e2e/api/session.spec.ts`, `docs/SPEC-edge-functions.md` | T1, T2 |
| **T5** | Webapp (§8, §9), tests unitaires, `e2e/ui/connexion.spec.ts`, fixture et portage des 50 specs d'interface, `docs/DESIGN_SYSTEM.md` §5.12, captures, `docs/manual.md` chapitre 1 — **livrée AVANT T4** (décision 585) | T3 |
| **T4** | `e2e/api/jetons.ts` et `scripts/lib/sso.sh` par la vraie connexion, comptes jetables par l'API de développement, seed (§11), portage des 18 scripts et des specs d'API qui créaient des comptes GoTrue, `docs/SPEC-seed.md`, `docs/SPEC-test-harness.md` | T3, T5 |
| **T6** | Retrait de GoTrue (§2), migration `0076`, retrait de `verify-auth.sh`, scripts d'environnement et de cellule, `docs/SPEC-auth.md` réduit à un renvoi | T4, T5 |
| **T7** | `README.md`, `docs/DAT.md`, `docs/SPEC-deploiement-spark.md`, `docs/manual.md` chapitre 17, `docs/PROD_MIGRATIONS.md` (§12), `CHANGELOG.md` ; campagne des harnais touchés | T6 |

## 15. Hors périmètre

- **L'écran d'inscription d'une attente** : `CRM-070` (§6.3).
- **La déconnexion de LeLabs** depuis le CRM (§8.5).
- **La lecture de rôles** autres que `verified` (décision 579, A3).
- **`offline_access`** : le CRM ne demande pas de jeton hors ligne.
- **La suppression des tables inertes du schéma `auth`** (§2) : opération destructive distincte.

## 16. Definition of Done de `CRM-092`

Tranches T1 à T7 livrées, chacune poussée. Aucune route, aucun service, aucune variable, aucun script
ni aucune preuve ne dépend plus de GoTrue — prouvé par recherche et par le harnais. Chaque preuve du
§13 verte contre la pile réelle, harnais non complaisant. Seed rejouable par le seul SSO. Captures
observées. Documentation du §14 à jour. En production, sur instruction : opérations du §12 faites, une
connexion réelle de `martino@p2enjoy.studio` aboutie et relue. Tant que ce dernier point manque,
l'unité reste `[~]`.
