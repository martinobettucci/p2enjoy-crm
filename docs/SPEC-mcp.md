# Spécification — Le connecteur MCP du CRM

Unités de backlog : `CRM-102` (socle : service, mandataire OAuth, connexion longue, registre),
`CRM-103` (administration dans la webapp), `CRM-104` (outils, une tranche par famille) —
`docs/BACKLOG.md`.
Décision : `docs/JOURNAL.md` 627 (arbitrages A1 à A4 du responsable, décisions techniques D1 à D8,
2026-10-20).
Documents liés : `docs/SPEC-plateforme.md` (superadministrateurs, amorçage, journal),
`docs/SPEC-session-sso.md` (échangeur, jeton interne, admission), `docs/SPEC-permissions-rls.md`,
`docs/SSO.md`, `docs/SPEC-session-sso.md` §12 (le client confidentiel du CRM), `docs/SCHEMA.md` §9 quinquies,
`docs/DAT.md` §3 et §7, `docs/SPEC-deploiement-spark.md`, `docs/DESIGN_SYSTEM.md` (section
« Connecteur MCP », écrite avec `CRM-103`), `docs/manual.md` (chapitre 11, écrit avec `CRM-103`).
Modèle éprouvé : le connecteur Evoliz du même responsable (`p2enjoy-evoliz`, en production depuis le
2026-10-06), dont le mandataire OAuth, la garde d'entrée et la connexion longue sont repris.

Écrite le 2026-10-20 **avant la première ligne de code**.

---

## 1. Objet et principe

Un **serveur MCP distant** permet de piloter le CRM depuis un assistant — Claude (web, Desktop, Code)
ou ChatGPT. Il couvre les tracks, les channels, les affaires, les contacts, les budgets et les coûts,
les saisies de temps, les objectifs et la messagerie.

**Le principe tient en une phrase (arbitrage A2) :** le connecteur agit **sous l'identité de la
personne connectée**, à travers la même API et les mêmes règles que la webapp. La **matrice** du
connecteur restreint en plus ce que l'assistant peut faire en son nom. Il en découle :

> **droit effectif = matrice du connecteur ∩ droits de la personne dans le CRM.**

- La matrice **ne donne jamais plus** que le CRM. Accorder `affaires:ajouter` sur un espace dont la
  personne est lectrice n'ouvre rien : la RLS refuse.
- La RLS et les règles métier — gardes de transition, plafond de temps, corbeille — restent les
  **seuls juges** de la donnée. Le connecteur n'a **aucun chemin parallèle** : il appelle les tables
  et les RPC que la webapp appelle.
- Un **superadministrateur** (`docs/SPEC-plateforme.md` §2) franchit la matrice, comme dans Evoliz.
  Il ne franchit **jamais** la RLS.

## 2. Composant et hébergement — décisions D1 et D4

### 2.1 Le service `mcp`

Le service est écrit en Python 3.13 avec FastMCP (`4.0.11`, SDK MCP `2.3.0`, versions épinglées dans
`mcp/requirements.lock`, comme dans Evoliz), sous Uvicorn, avec `httpx`.

| Module | Rôle | Origine |
|---|---|---|
| `mcp/crm_mcp/reglages.py` | configuration (§10) ; refuse de démarrer en nommant chaque variable manquante | nouveau |
| `mcp/crm_mcp/autorisation.py` | mandataire OAuth adossé au realm `lelabs` (§3), vérificateur du rôle, admission (§4) | repris d'`evoliz_mcp/autorisation.py` |
| `mcp/crm_mcp/garde.py` | garde d'entrée ASGI : corps bornés, débit, purge (§3.5) | repris d'`evoliz_mcp/garde.py` |
| `mcp/crm_mcp/jeton_interne.py` | frappe du jeton interne (§5) | nouveau |
| `mcp/crm_mcp/crm.py` | client de PostgREST et des RPC sous le jeton interne : délais, reprises, traduction des refus | nouveau |
| `mcp/crm_mcp/registre.py` | appels des RPC `mcp_*` sous la clé de service (§7) | nouveau |
| `mcp/crm_mcp/politique.py` | déclaration des outils, résolution de l'espace, contrôle de la matrice (§6) | nouveau, sur le modèle d'`evoliz_mcp/politique.py` |
| `mcp/crm_mcp/outils/<famille>.py` | les outils, une famille par module (§9) | nouveau |
| `mcp/crm_mcp/audit.py`, `journalisation.py` | audit des appels, journaux JSON | repris |
| `mcp/crm_mcp/pages.py` | accueil, « Compte en attente de vérification », « Droits en attente », « La connexion n'a pas abouti » | repris, textes adaptés |

**Pourquoi Python, et pas une fonction edge.**

- C'est la préférence du `CLAUDE.md` §3 pour un service backend.
- Le mandataire d'Evoliz est en production et prouvé.
- Les **10 s de temps mur** d'un worker edge (`docs/SPEC-edge-functions.md` §2) ne conviennent ni
  à un mandataire OAuth, ni à un appel d'outil qui enchaîne plusieurs requêtes.

`mail-sync` établit déjà le précédent d'un service Python dans la pile.

**La reprise de code est une copie tracée.** Chaque fichier repris porte, sous son `@spec`, la
mention de sa source et de la révision d'Evoliz copiée. Il n'y a pas de bibliothèque partagée entre
les deux dépôts : leurs cycles de déploiement sont indépendants. Ce compromis est nommé au §14.

**Durcissement du conteneur**, comme pour `mail-sync` :

- `read_only`, `cap_drop: ALL`, `no-new-privileges`, utilisateur non root ;
- l'état écrit sur le seul volume `mcp-etat` ;
- une sonde de santé par l'interpréteur.

**Un service démarré seulement s'il est configuré** — *précisé le 2026-10-20 en spécifiant la tranche T3, avant son
code*. Le service `mcp` est déclaré dans `docker-compose.yml` sous le **profil Compose `mcp`** :

- **en développement**, l'overlay le rend toujours actif (`profiles: !reset []`) : la pile locale porte le connecteur ;
- **en production**, `compose_prod` (`scripts/lib/env.sh`) n'active le profil que si `CRM_MCP_HOTE` est posée (§10).
  Sans elle, le service n'est ni construit, ni démarré, et **ne reçoit aucun secret** : le moindre privilège se tient
  dans le temps, comme pour `mail-sync` (`CRM-052`). La livraison de la plateforme (`CRM-101` T5) ne dépend donc
  pas de celle du connecteur, dont la route est encore à confirmer (§2.2).

L'image est construite depuis `mcp/Dockerfile`, cible `production`, avec le même secret de construction **facultatif**
`pip_ca` que `mail-sync` (décision 356), pour un poste derrière un proxy TLS. Elle attend `kong` et `rest` sains, et,
en développement, Keycloak sain : le mandataire lit la découverte OIDC au démarrage.

### 2.2 Adresses

| Environnement | Origine publique | Connecteur |
|---|---|---|
| Développement | `http://localhost:${MCP_DEV_PORT}` (défaut `18490`), port publié par l'overlay de développement | `http://localhost:18490/mcp` |
| Production (cellule `crm`) | `https://crm.mcp.lelabs.tech` | `https://crm.mcp.lelabs.tech/mcp` |

**En production, un hôte dédié (D4).** Caddy sert déjà `crm.lelabs.tech`. Les requêtes dont l'en-tête `Host` vaut
`crm.mcp.lelabs.tech` sont relayées **entièrement** vers `mcp:8080`, sans retirer de préfixe.

**Comment, mesuré contre `caddy:2.9-alpine` le 2026-10-20.** L'aiguillage vit dans `caddy/routes.caddy`, partagé par
les deux Caddyfile : un matcher `@connecteur_mcp host {$MCP_HOTE}`, placé **avant** toutes les autres routes. Deux
variables internes à Caddy dérivent de la seule variable d'exploitation `CRM_MCP_HOTE` (§10) :

| Variable de Caddy | Valeur | Pourquoi |
|---|---|---|
| `MCP_HOTE` | `${CRM_MCP_HOTE:-mcp.invalid}` | **jamais vide** : un matcher `host` vide fait refuser à Caddy sa configuration ENTIÈRE — le site tomberait avec le connecteur ; `.invalid` (RFC 6761) ne correspond à aucun hôte |
| `MCP_SITE` | `${CRM_MCP_HOTE:-}` | dans la liste d'adresses du Caddyfile ACME seulement (`{$APP_DOMAIN} {$MCP_SITE}`) : vide, la liste se réduit à l'hôte de l'application, et aucun certificat n'est demandé pour rien |

Dans la cellule Spark, le site `:8080` reçoit tous les hôtes de la Forge, et le matcher seul les sépare ; Caddy y
reçoit donc `MCP_HOTE`, et rien d'autre — **aucun secret**. Un hôte non posé laisse `mcp.invalid` : aucune requête
n'atteint `mcp`, qui n'est d'ailleurs pas démarré.

- Les routes OAuth du connecteur (`/.well-known/oauth-protected-resource/mcp`,
  `/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/consent`, `/token`,
  `/auth/callback`, `/revoke`) restent **propres à cet hôte**.
- Le `404` explicite de `/.well-known/oauth-authorization-server` sur `crm.lelabs.tech`
  (décision 589) **ne change pas**.
- L'étiquette `com.p2enjoy.caddy-routes-revision` est incrémentée dans le même commit
  (`docs/SPEC-deploiement-spark.md`).

**Les chemins `/plateforme` et `/admin` mènent à l'administration — précision T6, 2026-10-21.** L'administration du
connecteur vit dans la webapp (arbitrage A3), à `${SITE_URL}/plateforme`. Sur l'hôte du connecteur :

- `GET /plateforme` et `GET /admin` — ce dernier étant le chemin de l'administration d'Evoliz — répondent `302` vers
  cette adresse ;
- aucun autre chemin n'est redirigé, et la chaîne de requête n'est pas transmise ;
- la page d'accueil porte le même lien (`docs/DESIGN_SYSTEM.md` §5.57) ;
- la webapp reste seule juge de l'accès : sans le drapeau, elle rend son état de refus (`docs/SPEC-plateforme.md` §6).

`302` et non `301` : la destination changera avec `CRM-103` (onglet « Connecteur MCP »), et un navigateur garde en
mémoire une redirection permanente.

**Pourquoi pas un chemin sous `crm.lelabs.tech`.** Les métadonnées OAuth (RFC 8414, RFC 9728)
s'insèrent au **début** du chemin, et elles entreraient en collision avec le repli de l'application
monopage. Un hôte à part est la forme d'Evoliz (`evoliz.mcp.lelabs.tech`).

**À vérifier avant la livraison de `CRM-102`** : une **seconde route** de la Forge vers la même
cellule (`crm.mcp.lelabs.tech 8080 tls`) est une demande au propriétaire du Spark. Elle se propose
par `scripts/spark/proposer.sh --connecteur-mcp`, avec la variable `CRM_MCP_HOTE` (§10). Si la Forge ne
l'accepte pas, la question revient au responsable avant tout code de production : elle n'est pas
tranchée implicitement.

## 3. Mandataire OAuth

### 3.1 Flux

```
client MCP ──► POST /mcp                               401 + WWW-Authenticate (resource_metadata)
           ──► GET /.well-known/oauth-protected-resource/mcp
           ──► GET /.well-known/oauth-authorization-server
           ──► POST /register  (ou client_id = URL de métadonnées, CIMD)
           ──► GET /authorize?…&code_challenge=…        → page de consentement (§3.3)
navigateur ──► consentement accepté                     → realm lelabs (PKCE S256)
           ──► connexion au SSO                         → GET /auth/callback?code=…
mcp        ──► échange du code au realm (client confidentiel lelabs-crm-serveur, secret)
           ──► vérification du jeton d'accès, admission (§4) : refus → page, aucun code émis
           ──► redirection vers le client MCP avec un code
client MCP ──► POST /token (PKCE)                       → jeton émis par le mandataire
           ──► POST /mcp  Authorization: Bearer …        → outils
```

**Ce que le client MCP détient.** Le jeton qu'il reçoit est une **référence** signée par le
mandataire. Le jeton LeLabs correspondant est conservé **chiffré côté serveur** (§3.4). Aucun jeton
LeLabs ni aucun jeton interne n'atteint le client MCP.

### 3.2 Client LeLabs — décision D3

Le connecteur **réutilise le client confidentiel du CRM**, celui de l'échangeur de session : **`lelabs-crm-serveur`**,
l'identifiant retenu par le service et porté par `SSO_OIDC_CLIENT_ID` (`docs/SPEC-session-sso.md` §12). *Corrigé le
2026-10-20, avec la tranche T4 : la première rédaction nommait `lelabs-crm`, l'ancien client public, supprimé du realm le
2026-09-24 (décision 598).*

Sa déclaration est **renvoyée complète** à un administrateur du realm, avec le même `CLIENTID` — la règle « Changer une
intégration déjà créée » de `docs/SSO.md`, aligné le 2026-10-20 sur la référence du service : la déclaration n'est pas
refusée comme un doublon, le secret n'est ni retouché ni réémis, et l'échangeur n'est pas coupé. **Une URL absente de la
nouvelle déclaration est retirée du client** : elle porte donc les deux retours. La déclaration à remettre :

```
CLIENTID=lelabs-crm-serveur
NOM=P2Enjoy CRM
TYPE=serveur
REDIRECT=https://crm.lelabs.tech/auth/retour
REDIRECT=https://crm.mcp.lelabs.tech/auth/callback
ACCUEIL=https://crm.lelabs.tech
ROLE=verified
HORS_LIGNE=oui
```

- `REDIRECT=https://crm.mcp.lelabs.tech/auth/callback` est **ajouté** : le retour du mandataire (§3.1) ;
- `HORS_LIGNE=oui` est **ajouté** : il autorise `offline_access` (§3.3) — avec `non`, le SSO refuse toute demande ;
- `ACCUEIL` est **désormais obligatoire** pour le service (référence du 2026-10-16) : la webapp, l'entrée que les
  personnes ouvrent depuis leur espace de compte ;
- `ROLE=verified` est gardé tel que déclaré : le service l'ajoute de toute façon. Aucune clé `SECRET_VAR` : le service la
  refuse, et le secret reste lu sous `OIDC_CLIENT_SECRET`.

**Pourquoi le même client.** La cellule ne peut porter qu'un seul `OIDC_CLIENT_SECRET`, nom imposé à
toute intégration du domaine : un second client y créerait une collision de nom. Le `azp` des jetons
est donc le même pour l'échangeur et pour le connecteur, et chacun vérifie celui de son jeton.

**Conséquence assumée.** `HORS_LIGNE=oui` permet à ce client de **demander** `offline_access`.
L'échangeur de session, lui, ne le demande pas et ne change pas : la session de la webapp garde sa
durée.

### 3.3 Connexion longue — « Stay signed in »

La page de consentement porte la case **« Stay signed in »** (textes de FastMCP, en anglais ; écart
documenté au design system, comme dans Evoliz). Elle est **décochée par défaut**.

- **Décochée :** le jeton de rafraîchissement remis au client MCP vit autant que la session du SSO,
  bornée par son inactivité. Après une longue pause, l'assistant repasse par la connexion.
- **Cochée :** le mandataire ajoute `offline_access` aux portées demandées au realm. Le jeton de
  rafraîchissement survit alors aux pauses. Son inactivité et sa révocation sont réglées par le SSO,
  et la personne le révoque depuis son espace de compte LeLabs (section *Applications*).
- **Dans les deux cas,** le jeton d'accès LeLabs vit 300 s, et **chaque renouvellement relit**
  `verified`, `admin` et l'admission (§4). Un rôle retiré ferme l'accès en 300 s au plus.

### 3.4 Clients MCP acceptés et état du mandataire — décision D8

**Clients acceptés.**

- L'enregistrement dynamique (RFC 7591) et les documents de métadonnées (CIMD) sont ouverts.
- Les **adresses de retour sont restreintes** à `CRM_MCP_REDIRECTIONS_CLIENTS` : la boucle locale
  (`http://localhost:*`, `http://127.0.0.1:*`), Claude (`https://claude.ai/api/mcp/auth_callback`)
  et ChatGPT (`https://chatgpt.com/connector_platform_oauth_redirect`).
- Le consentement reste exigé dans le navigateur qui se connecte : un cookie de liaison protège
  contre l'adjoint confus.

**État du mandataire.** Clients enregistrés, transactions, codes et correspondance entre jetons émis
et jetons LeLabs sont conservés dans le volume `mcp-etat`. Ils sont chiffrés (Fernet) par une clé
dérivée d'`OIDC_CLIENT_SECRET` par HKDF-SHA256, et la clé qui signe les jetons émis en dérive de même.

**Perdre le volume** déconnecte les clients MCP, qui se réenregistrent. Aucune donnée métier n'y vit
: le registre est en base (§7), donc couvert par les sauvegardes (`CRM-080`).

### 3.5 Garde d'entrée

Une garde ASGI est placée devant toute l'application, reprise d'Evoliz, valeurs comprises :

- **corps bornés :** 64 Kio, et 1 Mio sur `/mcp` (aucun outil n'accepte de fichier dans cette
  unité) ; au-delà, `413` ;
- **débit par adresse :** `CRM_MCP_DEBIT_OAUTH_MINUTE` requêtes par minute (défaut 60) sur les
  points OAuth ;
- **enregistrements de clients :** `CRM_MCP_ENREGISTREMENTS_HEURE` par adresse et par heure
  (défaut 20 ; 200 au total) ;
- **purge horaire** de l'état expiré.

L'adresse est celle que transmet Caddy (`X-Forwarded-For`).

## 4. Accès — qui entre

Le rôle `verified` est vérifié côté serveur à **trois** endroits, comme dans Evoliz :

| Où | Contrôle | Refus |
|---|---|---|
| Retour du SSO (`/auth/callback`) | jeton d'accès LeLabs vérifié (signature au `jwks_uri`, `iss` exact, `azp` = `SSO_OIDC_CLIENT_ID`, `typ = Bearer`, `exp`, `alg` ∈ {RS256, ES256} avant toute clé) ; `email_verified` ; **`verified`** ; puis **inscription** au registre et **amorçage** (§7.2) ; puis **au moins un droit** ou le drapeau superadministrateur | `403`, aucun code émis : « Compte en attente de vérification » (sans `verified` ou sans adresse vérifiée), « Droits en attente » (vérifié, aucun droit), « La connexion n'a pas abouti » (jeton invérifiable) |
| Échange du code (`/token`) | `verified` sur les jetons attachés au code | `invalid_grant` |
| Chaque requête `/mcp` | jeton LeLabs conservé, contrôles ci-dessus ; renouvelé auprès du realm à l'échéance | `401` |

**Le rôle `admin` LeLabs** n'est pas un écart ici, contrairement à Evoliz (décision 18 de ce
dépôt-là). Il vaut superadministrateur de la plateforme (A1), donc franchit la matrice ; il ne
franchit pas la RLS, qui lui accorde déjà l'administration de tout espace (décision 597).

**L'inscription n'est pas une admission au CRM.** Un compte vérifié qui se connecte au connecteur
est inscrit à `mcp_comptes` (§7.1), pour que le superadministrateur le voie et puisse lui accorder
des droits. Il n'obtient ni profil, ni appartenance (minimisation), sauf l'amorçage du
superadministrateur, qui crée son profil (`docs/SPEC-plateforme.md` §3).

## 5. Le jeton interne du connecteur — décision D2

Pour chaque requête `/mcp`, après la vérification du §4, le service frappe un jeton **HS256** signé
par `JWT_SECRET`, la clé que PostgREST, Realtime et Storage connaissent :

| Revendication | Valeur |
|---|---|
| `iss` | `p2enjoy-crm/mcp` — distinct de `p2enjoy-crm/session` ; jamais confondu avec un jeton LeLabs |
| `sub` | le `sub` LeLabs |
| `role`, `aud` | `authenticated` |
| `iat` | l'instant de la requête |
| `exp` | le plus proche de l'`exp` du jeton LeLabs et de `iat + 300` |
| `lelabs_admin` | `true` **si et seulement si** `admin` est présent dans `realm_access.roles` ; absente sinon — même règle que l'échangeur |
| `canal` | `mcp` |

**Règles du jeton :**

- Il **ne quitte jamais le service**. Il n'est pas journalisé, et il n'est pas mis en cache au-delà
  de la requête qui l'a frappé.
- **Toute la donnée passe sous ce jeton** : PostgREST (`/rest/v1/…`) et les RPC, par Kong sur le
  réseau Compose (`http://kong:8000`), avec l'en-tête `apikey` (clé anonyme) que Kong exige. La RLS
  s'applique donc **exactement** comme pour la webapp.
- **La clé de service** n'est employée que pour les RPC du registre (§7.3), réservées à
  `service_role`, et jamais pour lire ou écrire une donnée métier.

**Compromis nommé (§14).** Une **deuxième** entité détient `JWT_SECRET`, et peut donc frapper un
jeton pour n'importe quel `sub`. `docs/SPEC-session-sso.md` §5.7 réservait jusqu'ici ce pouvoir à
la fonction `session`. Les deux processus vivent dans la même pile et sur le même hôte. La
revendication `canal` permet à la base, si un besoin le justifie un jour, de distinguer un appel du
connecteur.

## 6. La matrice — décisions D5 et D6

### 6.1 Familles et actions

| Famille | Ce qu'elle couvre |
|---|---|
| `structure` | tracks, channels, lecture des workflows et de leurs étapes |
| `affaires` | affaires (cards) : champs, étape, déplacement, sommeil, commentaires, timeline, contacts liés |
| `contacts` | contacts et organisations |
| `budgets` | budgets, occurrences, lignes de coût d'une affaire et leurs réels |
| `temps` | saisies de temps ; le coût du personnel en lecture, dans ce que la RLS ouvre |
| `objectifs` | tableaux d'objectifs, blocs, flèches |
| `messagerie` | lecture des fils d'une affaire et des messages ; envoi d'un email |

| Action | Sens |
|---|---|
| `consulter` | lire |
| `ajouter` | créer ; **envoyer un email** est un ajout, avec `destructiveHint` |
| `modifier` | changer un objet existant, déplacer une affaire, la mettre en sommeil |
| `supprimer` | **mettre à la corbeille ou archiver**, selon ce que le CRM offre pour l'objet — jamais purger (arbitrage A4). Un objet que le CRM ne sait que détruire (une saisie de temps, une ligne de coût, un bloc d'objectif) **n'a pas d'outil de suppression** : on le corrige par `modifier` |

La liste des espaces accessibles et la recherche globale sont des outils de **référence** : visibles
dès qu'un droit existe dans au moins un espace, avec des résultats filtrés par la matrice (§9.2).

### 6.2 Où la matrice est appliquée

Elle est appliquée **côté serveur**, à deux endroits.

1. **Visibilité.** Chaque outil porte un contrôle FastMCP (`Tool.auth`), évalué à `tools/list` et à
   la résolution d'un appel :
   - un superadministrateur voit tout ;
   - un autre compte voit un outil si **au moins un espace** ouvre sa famille et son action, ainsi
     que les cases `aussi` de l'outil (§9.1) ;
   - un outil caché répond « outil inconnu ».

   Le client MCP garde la liste reçue à la connexion : un changement de droits l'atteint à sa
   prochaine connexion, et un appel devenu fermé est refusé au point 2. L'état du compte lu pour la
   visibilité est gardé **2 secondes** par compte, le temps d'un `tools/list` (un contrôle par
   outil) ; un registre injoignable cache tous les outils, jamais il ne les ouvre.
2. **Chaque appel.** `politique.py`, placé après l'audit et avant toute donnée :
   1. **résout l'espace** de l'appel, selon la déclaration de l'outil (§9.1). C'est soit l'argument
      `workspace` (slug ou identifiant), soit l'espace de l'objet visé, **lu sous le jeton de la
      personne** : un objet qu'elle ne lit pas est « introuvable », quelle qu'en soit la cause ;
   2. appelle `public.mcp_autorise(p_ws, p_famille, p_action)` **sous le jeton de la personne**,
      pour l'action de l'outil puis pour chaque case `aussi` ;
   3. en cas de refus, rend le **refus uniforme** et l'inscrit au journal (§7.1) ;
   4. en cas d'accord, exécute l'outil, toujours sous le jeton de la personne. La RLS a le dernier
      mot, et un refus de la base est traduit sans détail technique (§9.3).

**Le refus uniforme :** « Introuvable ou hors de votre périmètre : <objet> <identifiant> ». C'est le
même texte pour un objet inexistant, un objet d'un espace que la matrice ferme et un objet que la RLS
cache. Un refus de la matrice sur un espace **nommé** par la personne dit à la place : « Le connecteur
n'a pas le droit <action> sur <famille> dans l'espace <slug> ». Elle a donné cet espace, et elle
apprend seulement ce que sa matrice lui accorde.

### 6.3 `public.mcp_autorise(p_ws uuid, p_famille text, p_action text) returns boolean`

- **Forme :** `SECURITY DEFINER` (elle lit `mcp_droits`, fermée), `STABLE`, `search_path` vide.
  `EXECUTE` est accordé à `authenticated` seul, et révoqué nommément à `anon`.
- **Ce qu'elle rend :** `app.est_superadmin() or exists(select 1 from public.mcp_droits where sub =
  auth.uid() and workspace_id = p_ws and famille = p_famille and action = p_action)`.
- **Validation :** une famille ou une action hors liste rend `22023`, jamais `false` ; une erreur de
  déclaration se voit ainsi au lieu de se confondre avec un refus.
- **Ce qu'elle ne fait pas :** elle ne lit pas l'appartenance au CRM. L'intersection est faite par la
  RLS au moment de l'accès, et non recopiée ici.

## 7. Le registre — migration `0090_connecteur_mcp.sql`

Migration ordinaire et idempotente, qui ne modifie aucune donnée existante.

### 7.1 Tables

**`public.mcp_comptes`** — les comptes vérifiés qui se sont connectés au connecteur.

| Colonne | Type | Règle |
|---|---|---|
| `sub` | `uuid` | PK ; **aucune** clé vers `profiles` : un compte connecté n'a pas forcément de profil (§4) |
| `email` | `text` | non nul, normalisé ; **mis à jour** à chaque connexion, l'adresse pouvant changer chez LeLabs |
| `nom` | `text` | non nul, borné à 120 caractères, même chaîne de repli que le profil |
| `premiere_connexion`, `derniere_activite` | `timestamptz` | non nuls |

**`public.mcp_droits`** — la matrice.

| Colonne | Type | Règle |
|---|---|---|
| `sub` | `uuid` | FK `mcp_comptes` `ON DELETE CASCADE` |
| `workspace_id` | `uuid` | FK `workspaces` `ON DELETE CASCADE` — supprimer un espace retire ses droits |
| `famille` | `text` | `check` fermé (§6.1) |
| `action` | `text` | `check` : `consulter`, `ajouter`, `modifier`, `supprimer` |
| `accorde_par` | `uuid` | FK `profiles` `ON DELETE SET NULL` |
| `accorde_le` | `timestamptz` | non nul, `now()` |

Clé primaire `(sub, workspace_id, famille, action)`.

**`public.mcp_journal`** — un appel d'outil par ligne.

| Colonne | Type | Règle |
|---|---|---|
| `id` | `bigint` | PK, identité |
| `sub` | `uuid` | non nul ; sans clé étrangère, pour survivre à un compte retiré |
| `outil` | `text` | non nul |
| `workspace_id` | `uuid` | nullable, sans clé |
| `issue` | `text` | `check` : `ok`, `refus_matrice`, `refus_crm`, `erreur`, `trop_volumineux` |
| `duree_ms` | `integer` | non nul, ≥ 0 |
| `cree_le` | `timestamptz` | non nul, `now()` ; indexée |

**`mcp_journal` ne porte jamais d'arguments**, de contenu ni de jeton. L'objet créé est retrouvé par
la timeline du CRM, qui nomme son auteur.

**Fermeture des trois tables :** RLS activée sans politique, privilèges retirés nommément à `anon` et
`authenticated`.

### 7.2 Inscription et amorçage

**`public.mcp_inscrire_compte(p_sub uuid, p_email text, p_nom text, p_superadmins_initiaux text[]
default '{}', p_admin_lelabs boolean default false) returns jsonb`.** Elle est réservée à
`service_role`, et le service ne l'appelle qu'après la vérification du §4. Elle :

1. insère le compte ou met à jour son adresse (normalisée), son nom (resserré, borné à 120 caractères,
   avec la chaîne de repli du profil) et sa `derniere_activite`. Une adresse mal formée ou un `sub`
   absent lèvent `22023`. L'inscription seule **ne crée pas de profil** ;
2. appelle `app.amorcer_superadmin(p_sub, p_email, p_nom, p_superadmins_initiaux)`
   (`docs/SPEC-plateforme.md` §3) ;
3. rend `{"superadmin": <app.est_superadmin pour ce sub>, "droits": <nombre de lignes>}`.

La vérification ne passe pas par `auth.uid()` : l'appel est fait sous la clé de service. Elle est
faite par une variante interne, `app.est_superadmin_pour(p_sub, p_admin_lelabs boolean)`, qui
reçoit le drapeau LeLabs du jeton vérifié par le service.

### 7.3 RPC réservées au service

| Fonction | Rôle |
|---|---|
| `mcp_inscrire_compte(…)` | §7.2 ; appelée au retour du SSO et à chaque renouvellement du jeton LeLabs, ce qui met `derniere_activite` à jour au plus toutes les 300 s |
| `mcp_etat_compte(p_sub uuid, p_admin_lelabs boolean default false) returns jsonb` | le drapeau et la matrice d'un compte en un appel — `{"superadmin": bool, "droits": [{"workspace_id", "famille", "action"}]}` —, pour la **visibilité** des outils (§6.2, point 1), relue à chaque `tools/list` et à chaque appel |
| `mcp_journaliser(p_sub, p_outil, p_ws, p_issue, p_duree_ms) returns void` | une ligne du journal |

Toutes sont `SECURITY DEFINER`, avec `search_path` vide. `EXECUTE` est accordé à `service_role`
seul, et révoqué nommément à `public`, `anon` et `authenticated`.

## 8. L'administration du connecteur — `CRM-103`

Arbitrage A3 : l'administration du connecteur est un **quatrième onglet de `/plateforme`**,
« Connecteur MCP » (`/plateforme/mcp`), réservé aux superadministrateurs.

**Arbitrage A5 (2026-10-21) : on accorde des droits à tout utilisateur du CRM, pas seulement aux comptes déjà venus au
connecteur.** Le responsable : « on doit pouvoir chercher parmi les utilisateurs déjà enregistrés en base ». Les droits
se posent donc à l'avance, et valent dès la première connexion.

- **Le droit vise le profil (décision D9).** `CRM-103` T1 fait pointer la clé étrangère de `mcp_droits.sub` vers
  `public.profiles (id)`, en cascade, au lieu de `mcp_comptes`. Le `sub` LeLabs est l'identifiant du profil depuis
  `CRM-092`.
- **Un compte venu au connecteur sans profil ne reçoit pas de matrice.** Un droit serait sans effet, puisque le
  connecteur agit sous la RLS (A2). La fiche le dit et renvoie à l'inscription d'une attente dans un espace.
- **Avant la bascule de la clé**, la migration retire les droits d'un compte sans profil, et en écrit le nombre. Il n'y
  en a aucun en production au 2026-10-21, où le registre est vide.

### 8.1 Écrans

- **Comptes** : les comptes venus au connecteur — nom, adresse, première connexion, dernière activité, nombre d'espaces
  ouverts, drapeau superadministrateur —, plus **« Accorder des droits à un utilisateur »**, qui cherche par nom parmi
  **tous** les utilisateurs du CRM (`plateforme_utilisateurs`, `docs/SPEC-plateforme.md` §6.5) et ouvre sa fiche.
  Un compte sans profil y porte la mention « Sans profil dans le CRM ». L'onglet « Utilisateurs » de la plateforme mène
  aussi à la fiche d'un utilisateur.
- **Fiche d'un compte**, `/plateforme/mcp/:sub`, pour un utilisateur venu ou non au connecteur ; jamais venu, elle dit
  « Jamais connecté au connecteur : ces droits vaudront dès sa première connexion » :
  - un **sélecteur d'espace**, qui liste tous les espaces ;
  - pour l'espace choisi, la **matrice** : familles en lignes, actions en colonnes, une case à
    cocher par cellule ;
  - un en-tête de ligne qui coche toute la famille, et un en-tête de colonne qui coche toute
    l'action ;
  - « Enregistrer » remplace la matrice de cet espace, puis relit l'état.
- **Le rôle de la personne dans le CRM** est affiché pour l'espace choisi : « administratrice »,
  « business developer », « lectrice », ou « **pas membre de cet espace** ». Dans ce dernier cas, un
  avertissement dit : « Ces droits resteront sans effet tant que cette personne n'est pas membre de
  l'espace : le connecteur agit en son nom » (conséquence d'A2). L'écran n'interdit pas d'accorder,
  car le superadministrateur peut ajouter l'appartenance ensuite.
- **Un compte superadministrateur** affiche « Franchit la matrice » à la place des cases, qui sont
  désactivées.
- **Journal des appels** : date, compte, outil, espace, issue, durée, paginé, avec des filtres par
  compte et par issue.

### 8.2 RPC

Toutes sont gardées par `app.exiger_superadmin()`, mêmes formes que `docs/SPEC-plateforme.md` §6.

| Fonction | Rôle |
|---|---|
| `mcp_comptes_liste() returns table(sub, nom, email, premiere_connexion, derniere_activite, espaces_ouverts, superadmin)` | la liste des comptes |
| `mcp_compte(p_sub uuid) returns jsonb` | le compte, sa matrice par espace, son rôle dans chaque espace (`app.workspace_role_pour`, appartenances enregistrées seulement), son drapeau |
| `mcp_poser_droits(p_sub uuid, p_ws uuid, p_droits jsonb) returns void` | **remplace** la matrice d'un espace par `[["affaires","consulter"], …]` ; valide chaque couple ; journalise `mcp_droits_poses` à `plateforme_journal`, avec l'avant et l'après |
| `mcp_journal_liste(p_sub uuid default null, p_issue text default null, p_avant bigint default null, p_limite int default 50)` | le journal des appels, paginé, borné à 200 |

**Précisé le 2026-10-21, avant le code de T1, après les arbitrages A5 et D9.** Le tableau ci-dessus fixe les noms ; voici
le contrat exact. Chaque fonction est `SECURITY DEFINER`, à `search_path` vide, gardée **en premier** par
`app.exiger_superadmin()`, exécutable par `authenticated` seul et révoquée nommément à `public` et `anon`, comme les
fonctions de la plateforme.

- **`mcp_comptes_liste(p_limite integer default 200)`** rend `table(sub, nom, email, premiere_connexion,
  derniere_activite, espaces_ouverts, superadmin, avec_profil)` : les comptes **venus au connecteur** (`mcp_comptes`),
  la dernière activité d'abord, bornés à 200.
  - `espaces_ouverts` compte les espaces où la matrice porte au moins une case.
  - `superadmin` est le drapeau **en base** : le rôle `admin` LeLabs ne se lit que dans un jeton.
  - `avec_profil` dit si la personne a un profil dans le CRM.
- **`mcp_compte(p_sub uuid) returns jsonb`** rend la fiche d'un utilisateur, **venu ou non au connecteur** (A5) :
  `{sub, nom, email, avec_profil, connecte, premiere_connexion, derniere_activite, superadmin, espaces}`.
  - **Valeurs absentes.** Le nom est celui du profil, ou à défaut celui du compte du connecteur. L'adresse est connue par
    le connecteur seulement, sinon `null`. Les dates sont `null` pour qui n'est jamais venu.
  - **`espaces`** porte **tous** les espaces, dans l'ordre des noms : `{workspace_id, slug, nom, role, droits}`. `role`
    vaut le rôle d'appartenance, ou `null` hors de l'espace. `droits` liste les couples `[famille, action]`, dans
    l'ordre des familles puis des actions du §6.1.
  - **Ni profil ni compte du connecteur** : `P0002` `profil_introuvable`.
- **`mcp_poser_droits(p_sub uuid, p_ws uuid, p_droits jsonb) returns void`** **remplace** la matrice d'un espace.
  - **Validation**, dans cet ordre : profil exigé (`P0002` `profil_introuvable` — D9, un droit sans profil serait sans
    effet) ; espace exigé (`P0002` `espace_introuvable`) ; `p_droits` doit être un tableau de couples de deux chaînes,
    famille et action du §6.1 (`22023` `droit_invalide`). Les doublons se confondent.
  - **Écriture.** `accorde_par` reçoit `auth.uid()`.
  - **Journal.** Un remplacement qui change l'ensemble inscrit `mcp_droits_poses` à `plateforme_journal`, avec l'espace
    et `cible = {nom, espace, avant, apres}`, deux listes triées. Un remplacement à l'identique n'écrit et ne journalise
    rien.
- **`mcp_journal_liste(…)`** rend `table(id, sub, nom, outil, workspace_id, espace_nom, issue, duree_ms, cree_le)`, le
  plus récent d'abord, curseur `p_avant` exclusif, borné à 200. Une issue hors des cinq du §7.1 est refusée en `22023`
  `issue_invalide`.
- **Deux codes de refus nouveaux**, `droit_invalide` et `issue_invalide`, rejoignent le dictionnaire fermé de la webapp
  (`docs/SPEC-plateforme.md` §6.1).

**La bascule de la clé (D9), dans la même migration et avant les fonctions** :

1. les droits d'un `sub` sans profil sont retirés, et leur nombre est écrit par `raise notice` ; la production n'en a
   aucun ;
2. la contrainte `mcp_droits_sub_fkey` est remplacée par une clé vers `public.profiles (id)`, en cascade.

`mcp_etat_compte` et `mcp_autorise` ne changent pas : elles lisent `mcp_droits` par `sub`. Le numéro de la migration est
pris au moment de l'écrire, et sa suite pgTAP prouve la garde, chaque refus, la bascule, le remplacement, le journal et
au moins deux mutations.

## 9. Les outils — `CRM-104`

### 9.1 Conventions

- **Langue.** Les noms et les descriptions destinées au modèle sont en anglais, avec le terme métier
  français entre parenthèses (« affaire », « channel »), comme dans Evoliz. Les noms suivent la forme
  `crm_<objet>_<verbe>`.
- **Déclaration.** Chaque outil déclare sa `famille`, son `action`, ses cases `aussi` et la façon de
  résoudre son espace :
  - `workspace:<argument>` : l'espace est donné par l'argument ;
  - `track:<arg>`, `channel:<arg>`, `card:<arg>`, `contact:<arg>`, `organisation:<arg>`,
    `budget:<arg>`, `board:<arg>` : l'espace de l'objet, lu sous le jeton ;
  - `reference` : pas d'espace unique, résultats filtrés.

  Un outil qui reçoit **plusieurs** identifiants nomme les autres dans `autres` (même forme
  `<genre>:<argument>`) : chacun est résolu sous le jeton et soumis à la **même** matrice (action et
  cases `aussi`), de sorte qu'un identifiant d'un autre espace ne passe jamais sans être lu.

  La déclaration est **vérifiée au démarrage**, à l'enregistrement de chaque outil
  (`MoteurPolitique.enregistrer`) : une déclaration absente ou invalide arrête le service. Elle est
  invalide si sa famille, son action, une case `aussi` ou un genre d'ancre sort de la liste fermée,
  si une ancre nomme un argument absent de la signature, ou si **un argument d'identifiant** (nommé
  `workspace` ou terminé par `_id`) n'est ni l'ancre ni dans `autres` — sur le modèle d'`evoliz_mcp`
  (`tests/test_politique.py`).
- **Annotations.** `readOnlyHint` sur toute consultation : il découle de l'action. `destructiveHint`
  sur toute mise à la corbeille, tout archivage, tout déplacement d'étape et tout envoi d'email, avec
  une description qui nomme l'effet. La vérification de démarrage l'exige d'une suppression et le
  refuse à une consultation. `openWorldHint` vaut faux : le connecteur n'agit que dans le CRM.
- **Pas de chemin parallèle.** Un outil appelle **uniquement** les tables, vues et RPC que la webapp
  appelle pour le même geste (`move_card`, `creer_affaire`, `move_card_to_channel`, `snooze_card`,
  `queue_outbound_email`, `recherche_globale`…). Les règles métier restent en base.

### 9.2 Catalogue initial

Chaque tranche **fixe** la liste exacte de ses outils dans ce paragraphe, par un commit de
documentation, **avant** son code. Le catalogue ci-dessous est la cible.

| Famille | Consulter | Ajouter | Modifier | Supprimer (corbeille ou archive) |
|---|---|---|---|---|
| référence | `crm_workspace_list`, `crm_search` (recherche globale ; chaque ligne est filtrée par la matrice de sa famille) | — | — | — |
| `structure` | `crm_track_list`, `crm_track_get`, `crm_channel_list`, `crm_channel_get`, `crm_workflow_get` (étapes, transitions, champs exigés) | `crm_track_create`, `crm_channel_create` | `crm_track_update`, `crm_channel_update` | `crm_track_trash`, `crm_channel_trash` |
| `affaires` | `crm_card_list` (par channel, étape, échéance), `crm_card_get` (champs, étape, contacts, prochaine action), `crm_card_timeline`, `crm_card_comment_list`, `crm_stale_card_list` (affaires figées) | `crm_card_create`, `crm_card_comment_add` | `crm_card_update` (titre, champs, prochaine action, échéance), `crm_card_move` (étape, par `move_card`), `crm_card_move_to_channel`, `crm_card_snooze`, `crm_card_wake`, `crm_card_contact_link` (`aussi` : `contacts:consulter`) | `crm_card_trash` |
| `contacts` | `crm_contact_list`, `crm_contact_get`, `crm_organization_list`, `crm_organization_get` | `crm_contact_create`, `crm_organization_create` | `crm_contact_update`, `crm_organization_update` | selon ce que le CRM offre, fixé en tranche |
| `budgets` | `crm_budget_list`, `crm_budget_get` (occurrences), `crm_card_cost_list`, `crm_costs_to_enter` (« à saisir ») | `crm_card_cost_add`, `crm_card_cost_actual_add` | `crm_card_cost_update`, `crm_card_cost_settle` (soldé) | `crm_budget_archive` si le CRM l'offre |
| `temps` | `crm_time_entry_list` (semaine, personne, cible), `crm_time_report` (rapport mensuel, dans ce que la RLS ouvre) | `crm_time_entry_add` | `crm_time_entry_update` | — (une saisie se corrige) |
| `objectifs` | `crm_goal_board_list`, `crm_goal_board_get` | `crm_goal_block_add`, `crm_goal_link_add` | `crm_goal_block_update` | `crm_goal_board_archive` |
| `messagerie` | `crm_card_mail_list` (fils et messages d'une affaire, sans pièce jointe), `crm_mail_get` | `crm_mail_send` (`queue_outbound_email`, `destructiveHint`, `aussi` : `affaires:consulter`) | — | — |

### 9.3 Réponses

- **Forme.** Un JSON structuré, avec les identifiants **et** les libellés utiles : nom du track,
  étape, slug de l'espace. Les listes sont paginées (`limit` borné à 100, `offset`).
- **Garde de taille.** Une réponse de plus de `CRM_MCP_TAILLE_MAX_REPONSE` caractères (défaut
  `200000`) est remplacée par une erreur qui donne sa taille et propose de paginer ou de filtrer.
- **Traduction des refus du CRM.** Les refus nommés de la base (`transition_not_allowed`,
  `comment_required`, `channel ferme`, plafond de temps…) sont traduits en un message pour le modèle
  : le code et une phrase, jamais une pile ni un détail d'infrastructure. Un refus RLS (`42501`, ou
  une ligne absente) devient le refus uniforme (§6.2).

## 10. Configuration

| Variable | Rôle | Format | Obligatoire | Exemple non sensible |
|---|---|---|---|---|
| `CRM_MCP_HOTE` | **variable d'exploitation** : l'hôte public du connecteur. Posée, elle active le profil `mcp` en production et l'aiguillage de Caddy ; vide, le connecteur est éteint (§2.1, §2.2) | nom d'hôte, sans schéma ni port | non, défaut : vide (connecteur éteint) ; sans objet en développement | `crm.mcp.lelabs.tech` |
| `CRM_MCP_ORIGINE_PUBLIQUE` | origine publique, lue par le **service** ; **jamais posée à la main** : Compose la dérive — `https://${CRM_MCP_HOTE}` en production, `http://localhost:${MCP_DEV_PORT}` en développement | URL sans barre finale | oui, pour le service | `https://crm.mcp.lelabs.tech` |
| `CRM_SUPERADMINS_INITIAUX` | adresses amorcées superadministratrices tant qu'aucune n'existe (`docs/SPEC-plateforme.md` §3) ; lue aussi par l'échangeur | adresses séparées par des virgules | non, défaut : aucune | `responsable@exemple.test` |
| `CRM_MCP_REDIRECTIONS_CLIENTS` | adresses de retour acceptées des clients MCP (`*` : port ou segment quelconque) | liste | non, défaut : boucle locale, Claude, ChatGPT | `http://localhost:*,https://claude.ai/api/mcp/auth_callback` |
| `CRM_MCP_TAILLE_MAX_REPONSE` | taille maximale d'une réponse d'outil, en caractères | entier | non, défaut `200000` | `200000` |
| `CRM_MCP_DEBIT_OAUTH_MINUTE` | requêtes par minute et par adresse sur les points OAuth | entier | non, défaut `60` ; relevée seulement en développement | `60` |
| `CRM_MCP_ENREGISTREMENTS_HEURE` | enregistrements de clients par adresse et par heure | entier | non, défaut `20` | `20` |
| `CRM_MCP_JOURNAL_NIVEAU` | niveau des journaux | `debug`, `info`, `warning` | non, défaut `info` | `info` |
| `SITE_URL` | **réutilisée** : l'origine de la webapp, vers laquelle mènent le lien de l'accueil et les redirections `/plateforme` et `/admin` (§2.2, T6) ; le service refuse de démarrer sans elle, en la nommant | URL sans barre finale | oui, comme pour la webapp | `https://crm.lelabs.tech` |
| `MCP_DEV_PORT` | port publié du connecteur en développement | entier | développement seulement, défaut `18490` | `18490` |

**En développement**, l'overlay relève `CRM_MCP_DEBIT_OAUTH_MINUTE` et `CRM_MCP_ENREGISTREMENTS_HEURE` à `1000` : toute
une campagne de preuves vient d'une seule adresse (même choix qu'Evoliz). L'état du mandataire vit dans le volume
`mcp-etat` monté sur `/var/lib/crm-mcp`.

**Ce que le service reçoit de Compose** : `SUPABASE_URL=http://kong:8000`, `SUPABASE_ANON_KEY=${ANON_KEY}`,
`SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}`, `JWT_SECRET`, `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID`,
`OIDC_CLIENT_SECRET`, `CRM_SUPERADMINS_INITIAUX`, `SITE_URL` (depuis T6) et les variables `CRM_MCP_*`. `scripts/verify-spark.sh` mesure que
`JWT_SECRET` et `SERVICE_ROLE_KEY` n'atteignent `mcp` que lorsque son profil est actif.

**Variables réutilisées, sans changement de nom :** `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`,
`OIDC_CLIENT_SECRET`, `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID` et, depuis T6, `SITE_URL`.

**Documentation de chaque variable :** `.env.example`, `docs/DAT.md`, `scripts/lib/env.sh` (contrat
du profil), `scripts/spark/proposer.sh`, `docs/PROD_MIGRATIONS.md` et le README, dans le même
commit que le code qui la lit.

## 11. Observabilité

- **Journaux.** Des journaux JSON sur la sortie standard, une ligne par événement, jamais à `debug`
  pour FastMCP, qui y écrirait les arguments. On n'y trouve jamais de jeton, de code, d'adresse ni
  d'argument d'outil.
- **Audit.** Une ligne par appel, à la sortie standard **et** à `mcp_journal` (§7.1).
- **`GET /sante`** rend `200` tant que le processus répond.
- **`GET /pret`** rend `200` si la découverte OIDC répond et si `rest` répond à travers Kong ; sinon
  `503`, avec le contrôle en défaut nommé.

## 12. Données de développement

- **Keycloak.** Le realm de développement (`keycloak/realm-lelabs.json`) reçoit, pour le client
  `${SSO_OIDC_CLIENT_ID}` :
  - le `redirectUri` `${SSO_DEV_MCP_REDIRECT_URI}`, que l'overlay pose à
    `http://localhost:${MCP_DEV_PORT}/auth/callback` (substitué à l'import, comme celui de la webapp) ;
  - ses portées **déclarées** au lieu d'être héritées : les six portées par défaut que le realm lui attribuait déjà
    (`web-origins`, `acr`, `roles`, `profile`, `basic`, `email` — relevées par l'API d'administration le 2026-10-20) et
    `offline_access` **seule** en portée facultative. Le client l'avait déjà par défaut du realm, avec quatre autres
    sans usage (`address`, `phone`, `organization`, `microprofile-jwt`) : la déclarer rend la connexion longue
    indépendante d'un défaut implicite.
  - Le hors-ligne n'exige rien de plus en développement : le rôle `offline_access` vient de `default-roles-lelabs`.
    En production, c'est `HORS_LIGNE=oui` de la déclaration du client (§3.2).
- **Ce que le seed démontre** (`docs/SPEC-seed.md`, paragraphe écrit avec `CRM-103`), par les vrais
  chemins :
  - les comptes sont inscrits par une **vraie connexion OAuth** d'un client MCP de test
    (`e2e/mcp/client.ts`, repris d'`e2e/mcp.ts` d'Evoliz) ;
  - la matrice est posée par l'écran d'administration (ou par `mcp_poser_droits` sous le jeton de
    Sabine), et des créations sont faites par le connecteur ;
  - cela couvre un compte en attente, un compte avec droits de lecture sur un espace, un compte avec
    écriture sur `affaires`, un refus de la matrice et un refus du CRM au journal.

## 13. Preuves

| Unité | Preuves |
|---|---|
| `CRM-102` T3 | **Intégration** (`mcp/tests/test_integration_oauth.py`, marque `integration`), jouée par `scripts/verify-mcp.sh` dans l'image `dev` **sur le réseau Compose**, contre le vrai Keycloak, la vraie base et le vrai service `mcp` ; seule l'origine publique `localhost:${MCP_DEV_PORT}` est réécrite vers `mcp:8080`, `sso.localhost` étant le même dedans et dehors : `401` et métadonnées (`resource`, `issuer` = l'origine) ; parcours complet de `plateforme@` (superadministratrice en base) et d'`exploitante@` (`admin` LeLabs), jusqu'à `crm_workspace_list` — vide pour la première (RLS, D7), l'espace seedé pour la seconde — et la ligne au `mcp_journal` ; « Droits en attente » pour `admin@` (vérifié, sans droit) ; « Compte en attente de vérification » pour `attendu@` (sans `verified`) et `adresse-non-verifiee@` ; aucun code émis sur un refus ; `offline_access` demandé **si et seulement si** la case est cochée, et le renouvellement qui survit à la fin de la session du SSO **seulement** dans ce cas ; jeton forgé, et vrai jeton du realm émis pour un autre client (`crm-audience-etrangere`), refusés ; adresse de retour hors liste refusée ; `/pret` à `200`. **E2E** : un vrai client MCP, connecté **dans le navigateur**, case cochée. **Assemblage** : `scripts/verify-spark.sh` résout la cellule profil éteint et allumé — limites mémoire, secrets de `mcp` présents seulement allumé, Caddy sans secret, révision des routes. `scripts/verify-mcp.sh` rejoue le tout, avec des dégradations réelles |
| `CRM-102` | **pytest unitaires** : jeton interne (revendications, échéance bornée, `lelabs_admin`), garde, réglages, déclaration des outils. **Intégration** contre le vrai Keycloak et la vraie base : parcours OAuth complet en requêtes directes ; refus sans `verified` et sans adresse vérifiée ; « Droits en attente » ; `offline_access` demandé **seulement** case cochée ; jeton forgé, d'un autre client ou HS256 refusé ; amorçage par la première connexion ; `crm_workspace_list` sous la RLS. **pgTAP** `0085_connecteur_mcp.test.sql` : fermeture, privilèges, `mcp_autorise` (superadministrateur, porteur de `lelabs_admin`, matrice, famille invalide en `22023`), cascade d'un espace supprimé, mutations. **E2E** : un vrai client MCP connecté dans le navigateur, case cochée. `scripts/verify-mcp.sh` |
| `CRM-102` T6 | **pytest unitaires** : `SITE_URL` obligatoire et nommée quand elle manque ; l'accueil porte le lien vers `${SITE_URL}/plateforme`, échappé ; `/plateforme` et `/admin` en `302` vers cette adresse, sans chaîne de requête, et `/plateforme/autre` non redirigé. **Intégration** contre la vraie pile : le service en route rend ce `302`. **E2E** : depuis l'accueil, le lien mène à l'écran Plateforme de la webapp, à la souris et au clavier ; captures de l'accueil renouvelées aux quatre paliers, observées. **Assemblage** : `scripts/verify-spark.sh` mesure que `SITE_URL` atteint `mcp` allumé |
| `CRM-103` | **pgTAP** et **API** : chaque RPC refusée à l'anonyme, à la lectrice et à l'administrateur d'espace. **E2E UI** : matrice posée à la souris et au clavier, avertissement « pas membre », effet constaté par un appel MCP réel ; captures aux quatre paliers, observées ; manuel (chapitre 11) |
| `CRM-104` | Par tranche et pour **chaque** outil, contre la vraie base et un vrai client MCP : succès ; **refus par la matrice** (case décochée) ; **refus par le CRM** malgré la matrice ouverte (lectrice, objet d'un autre espace) ; journal écrit. **E2E** : l'effet est constaté dans la webapp (une affaire créée par le connecteur apparaît au board, et sa timeline nomme la personne) |

## 14. Compromis connus

- **`JWT_SECRET` partagé avec un second processus** (§5).
- **La matrice est appliquée par le service**, non par la RLS. Un défaut de déclaration d'un outil
  ouvrirait l'outil sans la matrice, **jamais** sans la RLS. La vérification de démarrage et le
  test de complétude le bornent.
- **Un changement de droits atteint le modèle à sa prochaine connexion** pour la liste des outils.
  L'appel, lui, est revérifié tout de suite.
- **Le code repris d'Evoliz est une copie** : un correctif de sécurité du mandataire se reporte à la
  main dans les deux dépôts. La provenance tracée en tête de chaque fichier le rend repérable.
- **Le mandataire s'appuie sur des points internes de FastMCP** (contrôle du rôle au retour et à
  l'échange). La version est épinglée, et les tests sont rejoués à chaque montée.
- **Les définitions d'outils ont un coût.** Le catalogue complet pèse sur le contexte des clients qui
  chargent toutes les définitions ; la visibilité par matrice le réduit pour un compte restreint.
- **Le connecteur n'a pas d'environnement de staging** : la Forge ne fournit qu'une cellule.

## 15. Production — actions humaines

Elles sont tenues dans `docs/PROD_MIGRATIONS.md` §3, et aucune n'est exécutée sans instruction.

1. **Un administrateur du realm LeLabs** renvoie la déclaration complète de `lelabs-crm-serveur` (§3.2), avec le
   `REDIRECT` du connecteur et `HORS_LIGNE=oui` (§3.2).
2. **Le propriétaire du Spark :**
   - pose le DNS et la route `crm.mcp.lelabs.tech 8080 tls` (§2.2) ;
   - pose les variables `CRM_MCP_HOTE` (qui allume le connecteur) et `CRM_SUPERADMINS_INITIAUX` ;
   - applique la migration `0090`, instantané d'abord.
3. **Le responsable fait le constat** : il ajoute le connecteur dans Claude ou ChatGPT, se connecte
   avec « Stay signed in », pose une matrice et voit un appel au journal.
