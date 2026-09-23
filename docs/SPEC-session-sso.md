# Spécification — Le SSO, seule source d'identité : session ouverte par échange, GoTrue retiré

Unité de backlog : `CRM-092` (`docs/BACKLOG.md`).
Décisions : `docs/JOURNAL.md` 578 (instruction du responsable, mesures K1 à K9), 579 (arbitrage A1 à
A3), 580 (mesures K10 à K17), 581 (correction de K12 : migration élevée, harnais de l'unité),
585 (T5 avant T4), 586 (**client serveur** : arbitrage du responsable, sessions serveur).
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

Entre les deux, un **échangeur de session** (décision 579, A1), **client confidentiel de LeLabs**
(décision 586) : il reçoit le code d'autorisation, l'échange avec son secret, vérifie le jeton d'accès
obtenu, applique la règle d'admission, garde **côté serveur** le jeton de rafraîchissement LeLabs, et
remet au navigateur un **jeton interne** court — que PostgREST, Realtime et Storage acceptent sans
changement — et une **poignée de session** opaque dans un cookie `httpOnly`. Aucun jeton LeLabs
n'atteint le navigateur.

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
| Échange d'`id_token` de `CRM-091` et son nonce ; client public `lelabs-crm` | `webapp/src/lib/sso.ts`, `Authentification.tsx` ; realm LeLabs (retrait par son administrateur, décision 586) | T5, production |
| Trigger `on_auth_user_created` et `app.handle_new_user()` | migration `0077` | T6 |
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
| K15 | Le rafraîchissement rend un nouveau jeton, et l'**ancien reste accepté** : le realm ne révoque pas un jeton réutilisé | Le jeton de rafraîchissement ne quitte jamais le serveur (décision 586, §5.6) |
| K16 | Révoquer le jeton de rafraîchissement ferme la session LeLabs | La déconnexion du CRM ne révoque rien (§8.5) |
| K17 | La cellule sort vers `oauth.lelabs.tech` | L'échangeur lit la découverte et les clés en production |

## 4. Parcours de connexion

1. **`/connexion`** offre **une seule action**, primaire : « Se connecter avec LeLabs » (§9).
2. La webapp lit la découverte, tire un vérificateur PKCE et un `state`, enregistre la transaction et
   navigue vers le point d'autorisation — **sans nonce** : aucun `id_token` n'est lu, et PKCE protège
   le code (§8.1).
3. LeLabs revient sur **`/auth/retour`**, route de la webapp. La transaction est retirée dès sa
   lecture ; `state` et `code` sont jugés comme avant (`docs/SPEC-auth.md` §10.3, points 5 et 6).
4. La webapp remet à l'échangeur le **code**, le **vérificateur** et l'URL de retour (§5.2). Elle ne
   parle plus au point de jeton de LeLabs : c'est l'échangeur, client confidentiel, qui échange le code
   **avec son secret** (décision 586).
5. L'échangeur rend soit la session — jeton interne en corps, poignée en cookie `httpOnly` —, soit un
   refus nommé (§5.5).
6. Succès : le jeton interne est gardé **en mémoire** (§8.3), l'adresse de retour est rejointe par
   remplacement. Refus : retour à `/connexion`, qui rend le refus ou l'attente (§9).

## 5. L'échangeur de session — fonction edge `session`, client confidentiel

### 5.1 Trois gestes, une seule origine

| Geste | Requête | Réponse de succès |
|---|---|---|
| **Ouvrir** | `POST /functions/v1/session/ouvrir`, corps JSON `{ "code", "verificateur", "redirect_uri" }` | `200`, corps du §5.4, `Set-Cookie` de la poignée |
| **Prolonger** | `POST /functions/v1/session/prolonger`, cookie de la poignée, corps vide | `200`, corps du §5.4 |
| **Fermer** | `POST /functions/v1/session/fermer`, cookie de la poignée, corps vide | `204`, cookie effacé |

Tous portent l'en-tête `apikey` (clé anonyme) que Kong exige (`docs/SPEC-edge-functions.md` §5). Toute
autre méthode : `405` ; tout autre chemin : `404`.

**La webapp les appelle par un chemin RELATIF**, donc sur sa propre origine. En production, Caddy
relaie déjà `/functions/v1/*` vers Kong (`caddy/routes.caddy`) ; en développement et sous le harnais,
le proxy de Vite relaie `/functions/v1/session` vers Kong. Le cookie est ainsi **de même origine**
partout, et aucune configuration CORS n'est nécessaire. Mesuré le 2026-09-23 : la webapp de
développement est servie sur `127.0.0.1`, l'API sur `localhost` — deux sites où un cookie `SameSite`
ne passerait pas (décision 586).

### 5.2 Ouvrir

Dans cet ordre ; la première étape qui échoue arrête le geste, et **rien n'est écrit en base** avant
le point 5.

1. **Corps** : `code`, `verificateur` et `redirect_uri` sont des chaînes non vides ; `redirect_uri` est
   une URL `http(s)` se terminant par `/auth/retour`. Sinon `400 requete_invalide`. LeLabs compare de
   toute façon l'URL au caractère près à celles déclarées.
2. **Découverte** : `GET ${SSO_OIDC_ISSUER}/.well-known/openid-configuration`. Son `issuer` doit être
   **égal** à `SSO_OIDC_ISSUER` ; son `token_endpoint` et son `jwks_uri` sont des URL `https:` — ou
   `http:` vers la boucle locale ou `*.localhost`, pour le seul Keycloak de développement.
3. **Échange du code** au `token_endpoint` : `grant_type=authorization_code`, `client_id`,
   **`client_secret`** (`SSO_OIDC_CLIENT_SECRET`), `code`, `code_verifier`, `redirect_uri`. Un refus
   `4xx` de LeLabs — code déjà servi, échu, émis pour un autre client, vérificateur faux — rend
   `401 jeton_refuse`. La réponse doit porter `access_token` et `refresh_token`.
4. **Vérification du jeton d'accès** obtenu, même reçu directement de LeLabs par TLS : c'est la même
   fonction qu'en T3, et elle ne coûte qu'une lecture de clés.
   1. JWS compact à trois segments d'entête et de charge JSON ;
   2. **`alg` ∈ { `RS256`, `ES256` }**, vérifié **avant** toute lecture de clé : `none`, `HS*` et tout
      autre algorithme sont refusés sans qu'une clé soit jamais essayée
      (`docs/SSO-client-lelabs-crm.md`) ;
   3. **clés** lues au `jwks_uri` — même `kid`, `kty` conforme, `use` absent ou `sig` —, **relues à
      chaque geste**, jamais épinglées : toute rotation est suivie sans redémarrage ;
   4. **signature** par WebCrypto ;
   5. **revendications** : `iss` égal à `SSO_OIDC_ISSUER`, `azp` égal à `SSO_OIDC_CLIENT_ID`, `typ` égal à
      `Bearer`, `exp` futur sans tolérance, `iat` au plus 60 s dans le futur, `sub` UUID ; **jamais
      `aud`** (K14).
5. **Admission** (§6) : adresse vérifiée, puis **présence** de `verified`, puis
   `public.ouvrir_session_serveur` (§7.4), qui applique `ouvrir_session_sso` (§6.2) **et**, si la
   personne est admise, enregistre la session serveur — en un seul appel.
6. **Réponse** : jeton interne (§5.4) et `Set-Cookie` de la poignée (§5.6).

### 5.3 Prolonger et fermer

**Prolonger** sert au rafraîchissement **et** à la restauration au chargement de la page.

1. Sans cookie de poignée : `401 session_absente` — le cas normal d'un navigateur jamais connecté.
2. `public.lire_session_serveur(hash(poignée))` rend le `sub` et le jeton de rafraîchissement chiffré
   d'une session **non révoquée et non échue** ; sinon `401 session_absente`, et le cookie est effacé.
3. Découverte, puis `grant_type=refresh_token` avec le secret. Un refus `4xx` de LeLabs — session LeLabs
   échue ou fermée — **supprime** la session serveur, efface le cookie et rend `401 session_expiree`.
4. Vérification du nouveau jeton d'accès (§5.2, point 4). Son `sub` doit être celui de la session.
5. Admission rejouée **en entier** : `public.renouveler_session_serveur` réapplique la règle du §6 et,
   si la personne est toujours admise, remplace le jeton de rafraîchissement — LeLabs en rend un
   nouveau à chaque fois — et son échéance. Sinon il **supprime** la session, et l'échangeur efface le
   cookie et rend le refus nommé : un `verified` retiré ou une appartenance retirée ferment l'accès au
   prochain rafraîchissement, donc **au plus tard 300 s après**.

**Fermer** supprime la session serveur désignée par la poignée et efface le cookie ; `204` même sans
cookie — fermer ce qui n'existe pas n'est pas une erreur. **Rien n'est révoqué chez LeLabs** : révoquer
le jeton de rafraîchissement fermerait la session LeLabs de la personne (K16), ce que `docs/SSO.md`
exclut.

### 5.4 Réponse de succès — `200`

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
| `iat` | l'instant du geste |
| `exp` | **le plus proche** de l'`exp` du jeton d'accès LeLabs et de `iat + 300` |

Il ne porte **ni rôle du realm, ni rôle d'espace, ni adresse** : les droits restent relus par la RLS
(§1), et l'admission est rejouée à chaque prolongation (§5.3). C'est la lecture, pour ce CRM, de
« relisez le rôle à chaque requête et ne le gardez pas au-delà de la durée de vie du jeton ».

Ce jeton est symétrique, et la règle du fournisseur interdit d'**accepter** un jeton symétrique **comme
preuve SSO** : l'échangeur n'en accepte aucun (§5.2, point 4.2). Le jeton interne ne prouve rien au
SSO ; il ne sort pas du CRM.

### 5.5 Refus — dictionnaire fermé

Corps `{"erreur": "<code>"}`, auquel s'ajoute `"adresse"` pour les trois attentes, afin que l'écran
puisse la nommer. Aucune autre information : ni motif technique, ni message du fournisseur.

| Code HTTP | `erreur` | Cause |
|---|---|---|
| `400` | `requete_invalide` | corps d'ouverture absent ou mal formé |
| `401` | `jeton_refuse` | code refusé par LeLabs, ou jeton d'accès non conforme au §5.2, point 4 |
| `401` | `session_absente` | aucun cookie, poignée inconnue, révoquée ou échue |
| `401` | `session_expiree` | LeLabs refuse le rafraîchissement : la session LeLabs a pris fin |
| `403` | `adresse_non_verifiee` | `email` absent ou `email_verified` différent de `true` |
| `403` | `attente_verification` | `verified` absent des rôles du realm |
| `403` | `attente_espace` | personne vérifiée, mais aucune appartenance ni aucune attente à son adresse (§6) |
| `404` | `geste_inconnu` | chemin autre que `ouvrir`, `prolonger`, `fermer` |
| `405` | `methode` | méthode autre que `POST` |
| `502` | `sso_injoignable` | découverte, point de jeton ou clés injoignables, échéance dépassée, réponse non conforme |
| `502` | `service_indisponible` | appel de la base en échec, ou configuration absente |

Un `401 jeton_refuse` ne distingue pas ses causes : les distinguer n'aiderait que qui forge des jetons.

### 5.6 La poignée de session et son cookie

- **Poignée** : 32 octets tirés par `crypto.getRandomValues`, en base64url. Seule son empreinte
  **SHA-256** est gardée en base : une fuite de la table ne livre aucune poignée utilisable.
- **Cookie** : `p2enjoy_crm_session=<poignée>; Path=/functions/v1/session; HttpOnly; SameSite=Strict`,
  plus **`Secure` quand l'origine appelante est `https`** (en-tête `Origin`), sans `Max-Age` : un
  cookie **de session du navigateur**, effacé à sa fermeture. Aucun script de la page ne le lit, et il
  n'est envoyé qu'à l'échangeur. `Set-Cookie` est accompagné de `Cache-Control: no-store`.
- **Catégorie 1** de `CLAUDE.md` §11 : strictement nécessaire à la session, sans traçage.
- **La posture change, et c'est voulu** (décision 586) : la session vivait dans l'onglet ; elle vit
  désormais dans le navigateur, partagée par ses onglets, jusqu'à sa fermeture ou à la déconnexion.
- **Contrefaçon de requête** : `SameSite=Strict` n'envoie pas le cookie depuis un autre site, et
  l'`apikey` exigée en en-tête impose une requête de script, que la même politique d'origine borne.

### 5.7 Environnement, chiffrement, journal, limites

- **Variables remises au seul worker `session`** (`main/environnement.ts`) : `JWT_SECRET`,
  `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID`, **`SSO_OIDC_CLIENT_SECRET`**, en plus du commun. Une autre
  fonction ne peut ni frapper un jeton, ni parler à LeLabs au nom du CRM.
- **Chiffrement au repos du jeton de rafraîchissement** : AES-GCM 256, vecteur de 12 octets tiré à
  chaque écriture, clé dérivée de `JWT_SECRET` par HKDF-SHA-256 (sel fixe, information
  `p2enjoy-crm/sessions-sso/v1`). Une sauvegarde de base seule ne livre aucun jeton utilisable. La clé
  n'est pas un secret de plus : qui détient `JWT_SECRET` peut déjà frapper tout jeton interne.
- **Échéance** : **8 s** par geste, et au plus **3 s** par appel dans ce qui en reste, pour que la
  réponse parte toujours avant les 10 s de temps mur d'un worker (`docs/SPEC-edge-functions.md` §2).
  Un dépassement rend `sso_injoignable` ou `service_indisponible`, jamais un worker tué sans réponse.
- **Journal** : un événement structuré par geste — `session_ouverte`, `session_prolongee`,
  `session_fermee` ou `session_refusee` avec son code, et sa durée. **Jamais** de jeton, de poignée, de
  code, d'adresse, de nom ni de `sub`.
- **Coût** : un geste d'ouverture lit la découverte, le point de jeton et les clés ; une prolongation
  en fait autant, toutes les cinq minutes environ par navigateur ouvert. Aucun cache : le service
  principal crée un worker par requête, et c'est ce qui rend la rotation gratuite. Le délai mesuré est
  consigné à la livraison ; un cache n'est ajouté que si une mesure le justifie (`CLAUDE.md` §21).
- **Mode dégradé** : LeLabs injoignable, aucune session ne s'ouvre ni ne se prolonge ; la session en
  cours s'arrête à l'échéance de son jeton interne, avec le message réseau (§9). Aucun repli qui
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
`public.chemin_dossier_card`. Seul l'échangeur l'appelle, par les fonctions de session du §7.4, après
le §5.2 ; la fonction ne revérifie pas le jeton, qu'elle ne voit pas.

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
rien, et le retirer avant que le seed ne passe par le SSO (T4) casserait le seed. La migration `0077`
le retire avec GoTrue.

### 7.3 Données de production

La migration ne modifie **aucune ligne**. Le compte de K9 est repris par une opération décrite au §12,
exécutée sur instruction explicite seulement.

### 7.4 Migration `0076_sessions_serveur.sql` — sessions du client confidentiel (décision 586)

- **Table `public.sessions_sso`** : `id` (`uuid`), `sub` (`uuid`, référence `profiles` en
  **cascade** — retirer une personne ferme ses sessions), `poignee_empreinte` (`bytea`, 32 octets,
  **unique**), `rafraichissement` (`text`, chiffré, jamais en clair), `expire_le` (`timestamptz`,
  échéance d'inactivité que LeLabs rend avec le jeton), `cree_le`, `renouvele_le`.
- **Personne ne la lit par l'API** : RLS activée **sans aucune politique**, tous privilèges retirés à
  `anon` et `authenticated`. Seules quatre fonctions `SECURITY DEFINER`, `search_path` vide,
  exécutables par **`service_role` seul**, y touchent :

  | Fonction | Rôle |
  |---|---|
  | `ouvrir_session_serveur(p_sub, p_email, p_nom, p_empreinte, p_rafraichissement, p_expire_le)` | applique `ouvrir_session_sso` ; si admise, enregistre la session. Rend le même objet, plus rien d'autre |
  | `lire_session_serveur(p_empreinte)` | rend `sub` et jeton chiffré d'une session non échue ; purge au passage les sessions échues depuis plus d'un jour |
  | `renouveler_session_serveur(p_empreinte, p_sub, p_email, p_nom, p_rafraichissement, p_expire_le)` | réapplique l'admission ; admise, remplace jeton et échéance ; sinon supprime la session |
  | `fermer_session_serveur(p_empreinte)` | supprime la session ; sans effet si elle n'existe pas |

- Un profil supprimé emporte ses sessions ; une session ne survit jamais à la personne.

## 8. Webapp

### 8.1 `webapp/src/lib/sso.ts` — révisé

Garde la découverte (émetteur exact), le PKCE `S256`, la transaction à usage unique de dix minutes et
le jugement du retour. **Retire** le nonce, l'échange d'`id_token` et tout appel au point de jeton de
LeLabs : le client confidentiel est l'échangeur (§5.2).

### 8.2 `webapp/src/lib/session.ts` — nouveau

Porte les trois gestes vers l'échangeur (§5.1) et rien d'autre : `ouvrir`, `prolonger`, `fermer`, par
un chemin **relatif** et l'en-tête `apikey`, avec `credentials: 'same-origin'`. Classe les réponses
selon le §5.5 vers le dictionnaire du §9.2. Ne rend rien, ne stocke rien.

### 8.3 Stockage sur l'appareil

- **Aucun jeton, aucune identité n'est écrit** par la webapp. Le jeton interne vit **en mémoire** ;
  la poignée vit dans le cookie `httpOnly` que le serveur pose et qu'aucun script ne lit (§5.6).
- **`p2enjoy-crm.sso.transaction`**, dans `sessionStorage`, reste la seule écriture : `state`,
  vérificateur, adresse de retour, dix minutes, retirée au retour (catégorie 1 de `CLAUDE.md` §11).
- Aucun `localStorage`.

### 8.4 Restauration et rafraîchissement

- **Au chargement**, avant tout montage métier (`docs/SPEC-auth.md` §9.1), la webapp **prolonge** :
  un cookie valide rend une session sans aucun geste de la personne ; `session_absente` rend l'état
  anonyme, sans message.
- **Le rafraîchissement part 60 s avant** l'échéance du jeton interne, par la même prolongation — qui
  rejoue l'admission (§5.3). Un seul à la fois.
- `session_expiree` ou un refus de l'échangeur **mettent fin** à la session : état anonyme et retour
  à `/connexion`, qui dit pourquoi. Une panne réseau est réessayée jusqu'à l'échéance, puis met fin
  à la session avec le message réseau.
- Le client `supabase-js` est créé avec `accessToken`, qui rend le jeton interne courant (K6).
  **Mesuré en T3 (K18, décision 584)** : `supabase-js` pose ce jeton sur Realtime de façon
  asynchrone, sans l'attendre ; un abonnement lancé aussitôt rejoint le canal **en anonyme**. La
  webapp pose donc le jeton sur Realtime (`realtime.setAuth`) et l'**attend** avant de déclarer la
  session ouverte, puis à chaque renouvellement.

### 8.5 Déconnexion

« Se déconnecter » appelle **fermer** (§5.3), oublie le jeton en mémoire, remet Realtime à l'anonyme
et mène à `/connexion`. **Rien n'est révoqué chez LeLabs** (K16). Conséquence assumée et documentée
dans le manuel : se reconnecter depuis le même navigateur ne redemande pas le mot de passe LeLabs tant
que la session LeLabs vit ; la fermer se fait depuis l'espace de compte LeLabs.

### 8.6 Le relais de développement

`webapp/vite.config.ts` relaie `/functions/v1/session` vers Kong — pour le serveur de développement
comme pour `vite preview` du harnais —, la cible venant de l'environnement du processus
(`API_RELAIS_SESSION`), jamais du bundle. En production, ce relais n'existe pas : Caddy sert la
webapp et relaie `/functions/v1/*` sur la même origine.

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
  **`CircleDashed`**, `role="status"`, titre court « Accès en attente ». Aucune couleur ni aucun jeton
  nouveau ; une icône nouvelle, qui ne sert aucun autre objet. `Hourglass`, d'abord retenue, porte
  déjà l'entrée « Affaires figées » (`docs/DESIGN_SYSTEM.md` §5.37), et le §9 de ce document interdit
  qu'une icône serve deux objets — trouvé à la lecture intégrale du design system avant T5.
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

Le domaine reste `MAIL_DEV_PERSONAL_DOMAIN`, substitué à l'import.

**Le client devient confidentiel, comme en production (décision 586)** : `lelabs-crm-serveur`,
`publicClient: false`, secret **substitué à l'import** depuis `SSO_OIDC_CLIENT_SECRET`, que
`./runDev.sh` tire au hasard dans le `.env` du poste — le même nom de variable qu'en production, jamais
une valeur versée. PKCE `S256` reste imposé, les deux URL de retour exactes sont conservées. Le client
public `lelabs-crm` est **retiré** du realm de développement : il n'a plus d'emploi, et le garder
laisserait éprouver un chemin que la production n'aura plus. Le client `crm-audience-etrangere`
reste, pour prouver qu'un code émis pour une autre application est refusé.

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

Opérations à décrire dans `docs/PROD_MIGRATIONS.md` en T7 et à mener au déploiement, que le
responsable a demandé une fois `CRM-092` entièrement vérifiée (décision 584) :

1. **Préalables humains chez LeLabs** :
   - la **déclaration du client serveur** (décision 586) remise à un administrateur du realm :

     ```
     CLIENTID=lelabs-crm-serveur
     NOM=P2Enjoy CRM
     TYPE=serveur
     REDIRECT=https://crm.lelabs.tech/auth/retour
     SECRET_VAR=SSO_OIDC_CLIENT_SECRET
     ```

     L'identifiant **retenu par le service** fait foi ; le secret, affiché une seule fois à
     l'administrateur, est posé par lui comme variable de la cellule, sans transiter par aucun dépôt
     ni message ;
   - `martino@p2enjoy.studio` porte `verified` et une adresse vérifiée (décision 579) ; sans cela, sa
     connexion rend l'attente, et c'est le comportement voulu.
2. **Variables** : les demandes de variables manquantes sont **reposées** par
   `scripts/spark/proposer.sh` (décision 586) — `SSO_OIDC_CLIENT_ID` au nouvel identifiant,
   `SSO_OIDC_CLIENT_SECRET` —, et les variables propres à GoTrue sont retirées, dont les `SMTP_*`.
3. **Lecture seule d'abord** : l'espace `crm` ne porte rien d'autre que l'appartenance de K9 — aucune
   card, aucun commentaire, aucune donnée — et le compte n'a jamais été connecté.
4. Appliquer `0074` à `0077` en fenêtre de maintenance.
5. Livrer la fonction `session` et recréer `functions` ; arrêter et retirer `auth` et `auth-templates` ;
   reconstruire la webapp.
6. **Reprise du compte de K9** : l'espace vide est supprimé puis réamorcé par
   `amorcer-espace.sh --email martino@p2enjoy.studio --espace "P2Enjoy CRM" --slug crm`, qui n'inscrit
   plus qu'une **attente** `admin`. Supprimer puis recréer est la seule voie : retirer l'unique
   administrateur d'un espace est refusé par l'invariant du dernier administrateur, même espace vidé
   (`docs/SPEC-identite.md` §5), et le `sub` LeLabs n'est connu qu'à la première connexion.
7. Vérifier : sonde du nouveau client (`302` sans PKCE) ; `/auth/v1/health` ne répond plus ; une
   connexion réelle aboutit ; l'attente est consommée ; `profiles.id` vaut le `sub` LeLabs ; une session
   serveur existe, chiffrée ; le navigateur ne porte aucun jeton LeLabs.
8. Après une connexion réelle réussie : demander à l'administrateur du realm de **retirer le client
   public `lelabs-crm`**, désormais sans emploi.

## 13. Preuves exigées

| Niveau | Preuve |
|---|---|
| Unitaire, Deno | `supabase/functions/session/*.test.ts` — **révisés par la décision 586** : corps d'ouverture invalide ; code refusé par LeLabs ; échange avec le secret et le vérificateur exacts ; trois gestes, chemin inconnu, méthode ; poignée absente, inconnue, échue ; `session_expiree` qui supprime la session et efface le cookie ; admission rejouée à la prolongation ; cookie `HttpOnly`, `SameSite=Strict`, `Path`, `Secure` sur `https` seulement ; chiffrement AES-GCM : aller-retour, vecteur unique, altération refusée ; échéance globale ; et toujours : jeton mal formé ; `alg` `none`, `HS256`, `HS512`, `RS384` refusés **sans** lecture de clé ; `kid` inconnu ; signature altérée d'un octet ; `iss`, `azp`, `typ` différents ; `exp` passé d'une seconde ; `iat` futur ; `sub` non UUID ; adresse non vérifiée ; `verified` absent, puis présent parmi d'autres rôles dans un autre ordre ; découverte d'un autre émetteur ; délai dépassé ; jeton interne : revendications exactes, signature vérifiable par `JWT_SECRET`, `exp` = min des deux ; dictionnaire du §5.4 complet. Clés RSA et EC tirées par WebCrypto dans le test, jamais versées |
| pgTAP | `sessions_sso` : aucune politique, aucun privilège pour `anon` et `authenticated`, empreinte unique, cascade depuis `profiles` ; les quatre fonctions de session réservées à `service_role`, admission appliquée à l'ouverture et au renouvellement, suppression d'une session non admise ; `workspace_invitations` : contraintes, clé, trois politiques et privilèges ; `ouvrir_session_sso` : attente consommée en appartenance au bon rôle, profil créé une fois, profil existant non réécrit, appartenance existante non rétrogradée, aucune trace sans attente, rejeu stable, `EXECUTE` refusé à `anon` et `authenticated` ; `profiles` sans clé vers `auth.users` |
| Base neuve | T1 : un cluster jetable **sans GoTrue**, `0074` appliquée deux fois : `auth.uid()` rend le `sub` de `request.jwt.claims` (K11 levée), propriétaire inchangé. T6 : la pile entière recréée sans GoTrue par `./resetMe.sh`, seed et preuves d'API rejoués — une lecture RLS réelle aboutit |
| API, pile réelle | `e2e/api/session.spec.ts`, **révisé par la décision 586** — code et vérificateur remis à l'échangeur, jamais de jeton LeLabs côté client : ouverture, prolongation par le cookie, fermeture qui rend le cookie inopérant ; la table de sessions ne porte aucun jeton en clair ; un code émis pour le client étranger est refusé ; un code rejoué est refusé ; et toujours : les trois comptes seedés ouvrent une session et lisent leurs données sous RLS ; `inconnu@`, `attendu@`, adresse non vérifiée rendent leur `403` et leur code ; jeton du client étranger, `id_token`, jeton interne présenté à l'échangeur : `401` ; jeton interne accepté par PostgREST, **Realtime** et **Storage** ; `verified` retiré par l'API d'administration de développement → échange suivant refusé ; appartenance retirée → échange suivant refusé ; **rotation** : nouvelle clé prioritaire créée, nouveau jeton accepté sans redémarrer, ancienne clé désactivée → ancien jeton refusé ; `/auth/v1/*` → `404` après T6 |
| E2E | `e2e/ui/connexion.spec.ts` : vraie page Keycloak pour chacun des trois rôles ; **aucun jeton dans `sessionStorage` ni `localStorage`**, cookie de poignée `HttpOnly` présent, transaction retirée, URL sans `code` ; rechargement conservant la session ; **rafraîchissement** franchi par l'horloge de Playwright sans perte de session ; déconnexion ramenant à `/connexion` et reconnexion sans formulaire tant que LeLabs vit ; `inconnu@` et `attendu@` voyant leur attente ; annulation ; configuration absente ; console vierge. Les 50 specs d'interface se connectent par la fixture `connecterAvecLeLabs` |
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
| **T3 bis** | Client serveur (décision 586) : migration `0076`, échangeur à trois gestes, chiffrement, cookie, realm de développement confidentiel, relais Vite, preuves unitaires, pgTAP et d'API révisées | T3 |
| **T5** | Webapp (§8, §9), tests unitaires, `e2e/ui/connexion.spec.ts`, fixture et portage des 50 specs d'interface, `docs/DESIGN_SYSTEM.md` §5.12, captures, `docs/manual.md` chapitre 1 — **livrée AVANT T4** (décision 585) | T3 bis |
| **T4** | `e2e/api/jetons.ts` et `scripts/lib/sso.sh` par la vraie connexion, comptes jetables par l'API de développement, seed (§11), portage des 18 scripts et des specs d'API qui créaient des comptes GoTrue, `docs/SPEC-seed.md`, `docs/SPEC-test-harness.md` | T3, T5 |
| **T6** | Retrait de GoTrue (§2), migration `0077`, retrait de `verify-auth.sh`, scripts d'environnement et de cellule, `docs/SPEC-auth.md` réduit à un renvoi | T4, T5 |
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
