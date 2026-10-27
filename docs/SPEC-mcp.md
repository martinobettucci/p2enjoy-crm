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
les recettes et la rentabilité (depuis `CRM-108`), les saisies de temps, les objectifs et la messagerie.

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
| `affaires` | affaires (cards) : champs, description, probabilité, étape, déplacement, sommeil, commentaires, timeline, contacts liés, **activités réalisées** (appels, réunions, visios — `CRM-067`, décision 647) |
| `contacts` | contacts du carnet — les organisations sont à `organizations` depuis `CRM-114` T4 ; le nom de l'organisation d'un contact reste un attribut du contact (décision 666) |
| `organizations` | organisations : les lister, les lire, les créer, les modifier ; elles filtrent aussi les résultats `organisation` de `crm_search` (décision 666) — **ajoutée par `CRM-114`** (`docs/SPEC-organisations.md` §5, décisions 660 et 663, migration `0101`) ; nom anglais (décision 658) |
| `budgets` | budgets, occurrences, lignes de coût d'une affaire et leurs réels |
| `recettes` | lignes de recette d'une affaire et leurs réels ; rapport de rentabilité, réservé aux administrateurs par la base — **ajoutée par `CRM-108`** (`docs/SPEC-recettes.md` §7, décision 632, migration `0095`) |
| `temps` | saisies de temps ; le coût du personnel en lecture, dans ce que la RLS ouvre |
| `objectifs` | tableaux d'objectifs, blocs, flèches |
| `messagerie` | lecture des fils d'une affaire et des messages ; envoi d'un email |
| `workflows` | workflows, leurs étapes et leurs transitions : les créer, les modifier, les archiver — **décidée le 2026-10-26, à livrer par `CRM-118`** (décision 752) ; migration de la liste fermée au prochain numéro libre ; `crm_workflow_get` reste à `structure` ; périmètre complet : workflow, étapes et transitions, exigences d'une transition, champs de formulaire et règles de visibilité, copie, versions et remappage ; **retirer une étape ou une transition relève de `supprimer`, exception assumée** à la règle ci-dessous, le CRM ne sachant que les détruire (décision 754) ; liste des outils fixée par la spécification de la tranche ; nom anglais (décision 658) |

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

**Précisé le 2026-10-21, avant le code de T2** (forme : `docs/DESIGN_SYSTEM.md` §5.56, onglet « Connecteur MCP ») :

- **Adresses.** `/plateforme/mcp` porte les comptes, « Accorder des droits à un utilisateur » et le journal des appels,
  filtré par issue. `/plateforme/mcp/:sub` porte la fiche, avec son propre journal (filtre par compte) ; l'espace choisi
  vit dans `?espace=<slug>`, le premier par défaut.
- **La recherche d'un utilisateur** emploie `plateforme_utilisateurs` (`docs/SPEC-plateforme.md` §6.5). L'onglet
  « Utilisateurs » de la plateforme porte, par ligne, un lien « Droits du connecteur » vers la fiche.
- **L'enregistrement** envoie la matrice entière de l'espace choisi à `mcp_poser_droits`, puis relit la fiche.
- **Les refus** `droit_invalide` et `issue_invalide` rejoignent le dictionnaire fermé de la webapp, avec un texte chacun.
- **Le détail du journal de la plateforme** pour `mcp_droits_poses` nomme la personne, l'espace, et le nombre de cases
  avant et après.

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
    `budget:<arg>`, `board:<arg>` : l'espace de l'objet, lu sous le jeton ; **depuis `CRM-108`**, `revenue:<arg>`
    (une ligne de recette, par `card_revenues → cards`) et `revenue_actual:<arg>` (un réel de recette, par
    `card_revenue_actuals → card_revenues → cards`) ;
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
| `contacts` — **livrée par `CRM-104` T3** (§9.2 *quinquies*) | `crm_contact_list`, `crm_contact_get` | `crm_contact_create` | `crm_contact_update` | — (le CRM ne sait que détruire, A4) |
| `organizations` — **`CRM-114` T4** (§9.2 *sexies*) | `crm_organization_list`, `crm_organization_get` | `crm_organization_create` | `crm_organization_update` | — (décision 660) |
| `budgets` — **`CRM-104` T4** (§9.2 *septies*) | `crm_budget_list`, `crm_budget_get` (occurrences), `crm_card_cost_list`, `crm_costs_to_enter` (« à saisir ») | `crm_card_cost_add`, `crm_card_cost_actual_add` | `crm_card_cost_update`, `crm_card_cost_actual_update`, `crm_card_cost_settle` (soldé) | — (le CRM ne sait que détruire, A4 ; l'administration des budgets reste à l'écran, décision 668) |
| `recettes` — **livrée par `CRM-108` T4, liste fixée le 2026-10-23** (`docs/SPEC-recettes.md` §7) | `crm_card_revenue_list` (ancre `card:card_id`), `crm_revenues_to_enter` (`workspace:workspace`, paginé), `crm_profitability_report` (`workspace:workspace`, période et état facultatifs ; `aussi` : `budgets:consulter`, `temps:consulter`) | `crm_card_revenue_add` (`card:card_id`), `crm_card_revenue_actual_add` (`revenue:revenue_id`) | `crm_card_revenue_update` (`revenue:revenue_id`), `crm_card_revenue_actual_update` (`revenue_actual:revenue_actual_id`), `crm_card_revenue_settle` (`revenue:revenue_id`, soldé ou rouvert) | — (une ligne et un réel se corrigent) |
| `temps` — **`CRM-104` T5** (§9.2 *octies*) | `crm_time_entry_list` (période, personne nommée, cible), `crm_time_report` (`temps_valorise`, dans ce que la RLS ouvre) | — | `crm_time_entry_set` (une case de la grille ; 0 la vide, décision 671) | — |
| `objectifs` — **`CRM-104` T6** (§9.2 *nonies*) | `crm_goal_board_list`, `crm_goal_board_get` | `crm_goal_block_add`, `crm_goal_link_add` | `crm_goal_block_update` | `crm_goal_board_archive` (archiver ou désarchiver) |
| `messagerie` — **`CRM-104` T7** (§9.2 *decies*) | `crm_card_mail_list` (fils et messages d'une affaire, sans pièce jointe), `crm_mail_get` | `crm_mail_send` (`queue_outbound_email`, `destructiveHint`, `aussi` : `affaires:consulter`) | — | — |

### 9.2 bis Tranche `affaires`, lecture — `CRM-104` T2.a (liste fixée, **validée le 2026-10-23**, décision 654)

**Révisé par `CRM-111` T2.4.2** (docs/SPEC-rattachements.md §5, §11) : `crm_card_list` et `crm_card_mine` lisent les
**rattachements** (`card_placements`, l'affaire plongée, la corbeille filtrée sur elle, le tri par son titre) ;
`crm_card_get`, `crm_card_timeline` et les outils d'écriture lisent l'affaire et les colonnes de son **plus ancien**
rattachement. `crm_channel_get` compte les rattachements actifs du channel ; `crm_contact_get` dit une affaire archivée
quand tous ses rattachements le sont. Contrats, arguments et réponses inchangés ; la forme à plusieurs rattachements vient
avec les outils du §11 de cette spécification-là.

*Ajout de `CRM-066` tranche 4 (décision 708, M4 B ; `docs/SPEC-analytique.md` §13.7) : `crm_card_get` et `crm_card_list`
rendent `health_momentum` et `health_commercial`, l'objet des colonnes calculées tel quel — score, palier, composantes ;
`null` pour une affaire décidée, archivée ou à la corbeille. Même action `consulter`, aucune case nouvelle.*

Décisions 652 et 653. Sept outils, tous `affaires:consulter`, `readOnlyHint`, sans case `aussi`. Ils lisent **les mêmes
tables et fonctions que la webapp**, sous le jeton de la personne. La RLS décide de ce qui est rendu.

| Outil | Ancre | Ce qu'il lit | Ce qu'il rend |
|---|---|---|---|
| `crm_card_list` | `workspace:workspace` ; `autres` : `channel:channel_id`, **facultative** | `cards` (colonnes de la vue liste, `COLONNES_CARD_LISTE`), avec le channel, le track et l'étape nommés | les affaires actives (ni archivées, ni à la corbeille), filtrables par channel, par **texte** du titre (`query`), par **étape** (libellé exact) et par **échéance** de la prochaine action (`due` : `overdue`, `today`, `week`) ; `include_snoozed` faux par défaut ; paginé |
| `crm_card_get` | `card:card_id` | `cards`, `ecriture_permise` (`CRM-093`), le responsable, `card_contacts` (contact, organisation, rôle), `card_field_values` avec leurs `form_fields` | l'en-tête — titre, **description** (`CRM-105`), montant et devise, **probabilité** (surcharge, ou celle de l'étape), prochaine action et échéance, sommeil, responsable —, track, channel, workflow et étape **nommés**, adresse email de l'affaire, `can_write`, contacts liés, réponses au formulaire **par libellé** |
| `crm_card_timeline` | `card:card_id` | `card_events`, `card_comments`, `card_activities` — trois requêtes, fusionnées comme la webapp (décision 209, `docs/SPEC-activites.md` §4) | le fil du plus ancien au plus récent : chaque ligne avec son genre (`event`, `comment`, `activity`), sa date, son auteur ou acteur nommé, et son libellé résolu (étapes, champs, contacts), jamais un identifiant à la place d'un nom ; paginé |
| `crm_card_comment_list` | `card:card_id` | `card_comments` | les commentaires, du plus ancien au plus récent ; une pierre tombale reste à sa place, sans corps, avec « retiré par la modération » si c'est le cas |
| `crm_card_activity_list` | `card:card_id` | `card_activities` et leurs participants (`CRM-067` T4) | les activités, la plus récente en tête : type, date, durée, sujet, compte rendu, auteur, participants nommés ; une activité retirée en pierre tombale |
| `crm_stale_card_list` | `workspace:workspace` | `cards_figees()` | les affaires figées de l'espace, du plus gros retard au plus petit, avec l'étape, le seuil et le retard |
| `crm_card_mine` | `workspace:workspace` | la lecture de « Ma journée » (`CRM-061`) | les affaires à échéance en trois groupes — en retard, aujourd'hui, à venir sur sept jours — pour **la personne**, ou pour tout ce qu'elle lit (`scope` : `mine`, `all`) |

**L'ancre facultative.** `crm_card_list` accepte un `channel_id` facultatif. Absent, aucune ancre n'est résolue pour
lui. Présent, il est lu sous le jeton et soumis à la même matrice que l'espace. La vérification de démarrage le permet
pour une ancre `autres` dont l'argument a une valeur par défaut `None`, et pour elle seule.

**Ce que la tranche ne fait pas.** Aucune écriture : c'est T2.b. Aucune pièce jointe, aucun message : c'est la famille
`messagerie`. Aucune lecture des recettes ni des coûts d'une affaire : ce sont les familles `recettes` et `budgets`.

### 9.2 ter Tranche `affaires`, écriture — `CRM-104` T2.b (liste fixée, **validée le 2026-10-23**, décision 655)

Décision 652. **Douze** outils — le texte proposé disait « treize », une erreur de compte ; la liste est celle du
tableau. Chacun appelle **la table ou la fonction que la webapp appelle pour le même geste**, sous le
jeton de la personne : la base garde ses règles, et l'outil traduit ses refus (§9.3).

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_card_create` | `ajouter` | `channel:channel_id` | `creer_affaire(p_channel, p_titre)` | l'affaire naît à l'étape initiale ; rend son identifiant et sa fiche résumée |
| `crm_card_comment_add` | `ajouter` | `card:card_id` | `POST card_comments` | texte brut, 10 000 caractères au plus ; aucune mention |
| `crm_card_activity_add` | `ajouter` | `card:card_id` | `POST card_activities`, puis un `POST card_activity_participants` par participant | `CRM-067` T4 ; mêmes règles qu'à l'écran — date jamais future, durée 1 à 1440 ; un participant refusé n'annule pas l'activité, l'issue le compte |
| `crm_card_update` | `modifier` | `card:card_id` | `PATCH cards` (titre, description) puis, depuis `CRM-111` T2.3.2, `PATCH card_placements` sur le rattachement de l'affaire (montant, probabilité, prochaine action et échéance, responsable) — deux écritures, chacune jugée par sa règle ; `card_field_values` en `upsert` sur `(card_id, field_id)` pour les réponses au formulaire | seuls les champs donnés sont écrits ; le responsable est **nommé** parmi les membres de l'espace, une réponse est désignée par la **clé** de son champ dans le workflow de l'affaire |
| `crm_card_move` | `modifier`, `destructiveHint` | `card:card_id` | `move_card(card_id, to_step_id, comment)` | l'étape d'arrivée est **nommée**, résolue dans le workflow de l'affaire ; refus traduits : transition non déclarée, motif exigé, champs exigés manquants (nommés par leur libellé) |
| `crm_card_move_to_channel` | `modifier`, `destructiveHint` | `card:card_id` ; `autres` : `channel:to_channel_id` | `move_card_to_channel(card_id, to_channel_id, to_step_id, discard_field_values)` | sur un changement de workflow, l'étape d'arrivée doit être nommée et la perte des réponses **acceptée** (`discard_field_values`), sinon le refus dit combien seraient perdues |
| `crm_card_snooze` | `modifier` | `card:card_id` | `snooze_card(card_id, until)` | — |
| `crm_card_wake` | `modifier` | `card:card_id` | `wake_card(card_id)` | — |
| `crm_card_contact_link` | `modifier` ; `aussi` : `contacts:consulter` | `card:card_id` ; `autres` : `contact:contact_id` | `POST card_contacts` | rôle libre, facultatif |
| `crm_card_contact_unlink` | `modifier` ; `aussi` : `contacts:consulter` | `card:card_id` ; `autres` : `contact:contact_id` | `DELETE card_contacts` | zéro ligne rendue est un refus, jamais un succès |
| `crm_card_activity_update` | `modifier` | `activity:activity_id` (genre nouveau : `card_activities.workspace_id`) | `PATCH card_activities`, puis les participants par différence | l'auteur seul, comme à l'écran ; aucun outil de retrait (décision 648) |
| `crm_card_trash` | `supprimer`, `destructiveHint` | `card:card_id` | `PATCH cards set deleted_at` — le geste de la fiche (`CRM-077`) | l'affaire part à la corbeille, d'où un administrateur la restaure ; rien n'est purgé |

**Les identifiants qui ne sont pas des ancres.** Trois arguments désignent un objet sans être résolus par la politique,
parce que l'objet est **jugé dans l'affaire** par la base ou par l'outil :
- l'étape d'arrivée, **par son nom**, cherchée parmi les étapes du workflow de l'affaire lue sous le jeton ;
- le responsable, **par son nom**, cherché parmi les membres de l'espace de l'affaire ;
- les participants d'une activité (`participant_contact_ids`, `participant_member_ids`), que le trigger de la base
  refuse hors de l'affaire (`participant_outside_card`, `docs/SPEC-activites.md` §3).

Aucun ne peut donc désigner un objet d'un autre espace. La vérification de démarrage (§9.1) ne vise que les arguments
terminés par `_id` : ces listes finissent par `_ids`, et la raison est écrite ici.

**Ce que la tranche ne fait pas.** Ni corriger ni retirer un commentaire ; ni retirer une activité (décision 648) ; ni
restaurer une affaire de la corbeille ; ni archiver une affaire ; ni poser une mention. Ce sont des gestes d'écran.

**Preuves** (§13) : pour chaque outil, contre la vraie base et un vrai client MCP — succès, refus par la matrice, refus
par le CRM malgré la matrice ouverte, journal écrit ; et **E2E** : une affaire créée par le connecteur paraît au board,
et sa timeline nomme la personne.

### 9.2 quater Tranche `structure` et recherche — `CRM-104` T1 (liste fixée, **validée le 2026-10-24**, décision 656)

Décision 652 : elle suit la tranche `affaires`. **Douze outils**, qui lisent et écrivent ce que l'arborescence et la
palette de recherche de la webapp lisent et écrivent (`administration-arborescence.ts`, `recherche.ts`). Les écritures
sont réservées par la base à qui administre l'espace ; l'outil traduit son refus.

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_search` | référence | — | `recherche_globale(p_terme, p_limite)` | chaque ligne n'est rendue que si la matrice ouvre `consulter` sur la famille de son objet **dans son espace** : affaire et commentaire → `affaires`, contact et organisation → `contacts`, message → `messagerie` |
| `crm_track_list` | `consulter` | `workspace:workspace` | `tracks` | nom, slug, description, couleur, icône, rang, archivé ; les tracks à la corbeille n'y sont pas |
| `crm_track_get` | `consulter` | `track:track_id` | `tracks`, `channels` | le track et ses channels, avec leur workflow nommé et `can_write` (`ecriture_permise`, `CRM-093`) |
| `crm_channel_list` | `consulter` | `workspace:workspace` ; `autres` : `track:track_id`, **facultative** | `channels` | par track au besoin |
| `crm_channel_get` | `consulter` | `channel:channel_id` | `channels`, `workflows` | description, workflow nommé, `can_write`, nombre d'affaires actives |
| `crm_workflow_get` | `consulter` | `workflow:workflow_id` (genre nouveau : `workflows.workspace_id`) | `workflows`, `workflow_steps`, `workflow_transitions`, `form_fields`, `workflow_transition_required_fields` | les étapes dans l'ordre (initiale, probabilité, seuil de relance), les transitions déclarées (motif exigé, champs exigés **par libellé**), les champs du formulaire |
| `crm_track_create` | `ajouter` | `workspace:workspace` | `POST tracks` | nom, slug, couleur, icône, description |
| `crm_channel_create` | `ajouter` | `track:track_id` ; `autres` : `workflow:workflow_id` | `POST channels` | le workflow est obligatoire (`CRM-033`) |
| `crm_track_update` | `modifier` | `track:track_id` | `PATCH tracks` | nom, couleur, icône, description — **jamais le slug**, l'adresse du track (`administration-arborescence.ts`) |
| `crm_channel_update` | `modifier` | `channel:channel_id` | `PATCH channels` | nom, description — **jamais le workflow** : le changer passe par `change_channel_workflow` et le remappage des affaires (`CRM-019`), un geste d'écran |
| `crm_track_trash` | `supprimer`, `destructiveHint` | `track:track_id` | `PATCH tracks set deleted_at` | le geste de l'arborescence (`CRM-077`) ; restaurable par un administrateur |
| `crm_channel_trash` | `supprimer`, `destructiveHint` | `channel:channel_id` | `PATCH channels set deleted_at` | idem |

**Ce que la tranche ne fait pas.** Ni archiver ni réordonner un track ou un channel ; ni éditer un workflow, ni le
publier, ni le restaurer ; ni le catalogue des nœuds. Ce sont des gestes d'écran d'administration. `crm_workflow_get`
dit ce qu'il faut savoir pour déplacer une affaire (`crm_card_move`).

**Preuves** (§13) : pour chaque outil, contre la vraie base et un vrai client MCP — succès, refus par la matrice, refus
par le CRM malgré la matrice ouverte (un business developer qui crée un track : la base le réserve à l'administrateur),
journal écrit ; la recherche **filtrée par la matrice**, une famille fermée retirant ses lignes ; et **E2E** : un channel
créé par le connecteur paraît dans la barre d'onglets du track.

### 9.2 quinquies Tranche `contacts` — `CRM-104` T3 (liste fixée, **validée le 2026-10-24**, décision 660)

**Quatre outils**, ceux que le carnet de la webapp offre pour un contact (`contacts.ts`), sous le jeton de la personne.
*Révisée par la décision 660* : la proposition en comptait six. Les deux lectures d'organisation partent dans la famille
nouvelle `organizations` de `CRM-114`, avec leur création et leur modification (décision 659 : une permission distincte).

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_contact_list` | `consulter` | `workspace:workspace` ; `autres` : `organisation:organization_id`, **facultative** | `contacts` | par nom, adresse ou fonction (`query`), par organisation ; paginé ; l'organisation de chaque contact nommée |
| `crm_contact_get` | `consulter` | `contact:contact_id` | `contacts`, `card_contacts` | la fiche, son organisation nommée, et les affaires auxquelles il est lié, avec son rôle dans chacune |
| `crm_contact_create` | `ajouter` | `workspace:workspace` ; `autres` : `organisation:organization_id`, **facultative** | `POST contacts` | nom obligatoire ; fonction, adresse, téléphone, organisation existante facultatifs |
| `crm_contact_update` | `modifier` | `contact:contact_id` ; `autres` : `organisation:organization_id`, **facultative** | `PATCH contacts` | seuls les champs donnés ; une chaîne vide efface un champ facultatif ; `detach_organization` retire l'organisation |

**Ce que la tranche ne fait pas, et pourquoi.**
- **Aucun outil de suppression d'un contact.** Le CRM ne sait que le **détruire**, ses rattachements avec lui, et
  « supprimer » ne veut jamais dire purger (§6.1, arbitrage A4). Le geste reste celui de la fiche du contact.
- **Les organisations** — les lire, les créer, les modifier — sont la famille `organizations` de `CRM-114`.
- **Le rôle d'un contact dans une affaire** se pose avec `crm_card_contact_link` (`affaires`).

**Preuves** (§13) : pour chaque outil, contre la vraie base et un vrai client MCP — succès, refus par la matrice, refus
par le CRM malgré la matrice ouverte (la lectrice qui crée un contact), journal écrit ; et **E2E** : un contact créé par
le connecteur paraît dans le carnet.

### 9.2 sexies Famille `organizations` — `CRM-114` T4 (liste fixée par `docs/SPEC-organisations.md` §5, **validée le 2026-10-24**, décision 663)

**Quatre outils**, ceux de l'onglet « Organisations » et de la fiche d'organisation de la webapp (`organisations.ts`),
sous le jeton de la personne. **Aucun outil de suppression** (décision 660).

| Outil | Action | Ancre | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_organization_list` | `consulter` | `workspace:workspace` | `organizations`, compte embarqué `contacts(count)` | par nom ou domaine (`query`) ; par nom ; paginé ; le nombre de contacts de chacune |
| `crm_organization_get` | `consulter` | `organisation:organization_id` | `organizations`, `contacts` | la fiche, et ses contacts (nom, fonction, adresse, téléphone) |
| `crm_organization_create` | `ajouter` | `workspace:workspace` | `POST organizations` | nom obligatoire ; domaine (mis en minuscules, comme l'écran) et site web facultatifs |
| `crm_organization_update` | `modifier` | `organisation:organization_id` | `PATCH organizations` | seuls les champs donnés ; une chaîne vide efface le domaine ou le site web |

**Refus nommés** : `domain_taken` (`23505`, le domaine est unique dans l'espace) ; la contrainte de forme nommée
(`organizations_name_check`, `organizations_domain_check`, `organizations_website_check`) ; le reste comme partout.

**`crm_search` suit la famille** (décision 666) : un résultat `organisation` est filtré par `organizations:consulter`,
et non plus par `contacts:consulter`. Une permission distincte (décision 659) qui laisserait la recherche montrer les
organisations à qui ne la tient pas ne serait pas distincte. Le nom de l'organisation d'un **contact**, lui, reste dans
les lectures de contact : c'est un attribut du contact, comme l'écran du carnet le montre à tout lecteur du carnet.

**La matrice de l'onglet « Connecteur MCP »** gagne la ligne « Organisations » (phrase de portée : « Organisations du
carnet, et leurs contacts en lecture ») ; celle de « Contacts » devient « Contacts du carnet ».

**Preuves** (§13) : pour chaque outil, contre la vraie base et un vrai client MCP — succès, refus par la matrice, refus
par le CRM malgré la matrice ouverte (la lectrice qui crée une organisation), journal écrit ; `crm_search` sans
`organizations:consulter` ne rend aucune organisation ; et **E2E** : une organisation créée par le connecteur paraît dans
l'onglet « Organisations ».

### 9.2 septies Famille `budgets` — `CRM-104` T4 (liste fixée, **validée le 2026-10-24**, décisions 668 et 669)

**Neuf outils** : les lectures des budgets et des coûts, et les **lignes de coût d'une affaire**, en miroir de la famille
`recettes` (§9.2 et `docs/SPEC-recettes.md` §7). Les mêmes tables que la webapp (`budgets.ts`, `couts-ecrans.ts`,
`card-costs.ts`, `reels-ligne.ts`, `couts-a-saisir.ts`), sous le jeton de la personne ; la base tient le réel dérivé, la
ligne soldée figée, le rattachement à un budget ou une occurrence clôturés, et la garde d'écriture de l'affaire.

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_budget_list` | `consulter` | `workspace:workspace` ; `autres` : `track:track_id`, **facultative** | `budgets`, `card_costs` | les budgets des tracks lisibles : nom, devise, récurrent, enveloppe, clôturé, seuil d'ancienneté ; prévu et réel cumulés des lignes lisibles, par budget ; `include_closed` |
| `crm_budget_get` | `consulter` | `budget:budget_id` | `budgets`, `budget_occurrences`, `card_costs` | le budget, ses occurrences (période, enveloppe, clôturée) et ses lignes, chacune avec son affaire ; prévu, réel et lignes sans réel par occurrence |
| `crm_card_cost_list` | `consulter` | `card:card_id` | `card_costs`, `card_cost_actuals` | les lignes de coût d'une affaire : libellé, prévu, réel (somme des réels), soldée, budget et occurrence nommés, et chaque réel |
| `crm_costs_to_enter` | `consulter` | `workspace:workspace` ; `autres` : `track:track_id`, **facultative** | `card_costs` (`reel_saisissable`) | l'onglet « À saisir » : lignes non soldées, plus anciennes d'abord ; `you_can_enter` ; paginé |
| `crm_card_cost_add` | `ajouter` | `card:card_id` ; `autres` : `budget:budget_id` | `POST card_costs` | libellé, prévu, budget ; occurrence exigée si le budget est récurrent, refusée sinon (la base le dit) |
| `crm_card_cost_actual_add` | `ajouter` | `cost:cost_id` | `POST card_cost_actuals` | montant, date (aujourd'hui par défaut), libellé ; refusé sur une ligne soldée |
| `crm_card_cost_update` | `modifier` | `cost:cost_id` ; `autres` : `budget:budget_id`, **facultative** | `PATCH card_costs` | libellé, prévu, budget et occurrence ; seuls les champs donnés ; le réel n'est pas écrivable |
| `crm_card_cost_actual_update` | `modifier` | `cost_actual:cost_actual_id` | `PATCH card_cost_actuals` | montant, date, libellé ; refusé sur une ligne soldée |
| `crm_card_cost_settle` | `modifier` | `cost:cost_id` | `PATCH card_costs` (`settled_at`) | solder (sans réel, la ligne vaut 0) ou rouvrir |

**Trois genres d'ancre nouveaux** : `cost` (`card_costs`, résolu jusqu'à l'espace par son affaire) et `cost_actual`
(`card_cost_actuals`, par sa ligne puis son affaire), comme `revenue` et `revenue_actual` ; et `occurrence`
(`budget_occurrences`, par son budget puis son track), parce que le moteur exige que **tout identifiant** passé à un
outil soit une ancre déclarée (§6.2) : l'`occurrence_id` de `crm_card_cost_add` et de `crm_card_cost_update` est une
ancre `autres` facultative. *Précision apportée en écrivant le code, sans changer la liste validée.*

**Refus nommés** : `ligne soldee` et `reel derive` (les messages de la base, comme pour les recettes) ; l'occurrence
exigée, interdite ou d'un autre budget, et le rattachement à un budget ou une occurrence clôturés (les fragments de
`FRAGMENTS_REFUS_COUT`) ; une référence absente (`23503`) ; le reste comme partout.

**Ce que la tranche ne fait pas, et pourquoi.**
- **Aucune suppression** d'une ligne de coût ni d'un réel : le CRM ne sait que les **détruire** (§6.1, arbitrage A4).
- **L'administration des budgets** — créer, modifier, clôturer un budget, ses occurrences — reste un geste de l'écran,
  réservé par la base aux administrateurs (décision 668).
- **Les histogrammes et cumuls des écrans « Coûts »** ne sont pas des outils : `crm_budget_list` et `crm_budget_get`
  rendent les sommes, sans additionner deux devises.

**Preuves** (§13) : pour chaque outil, contre la vraie base et un vrai client MCP — succès, refus par la matrice, refus
par le CRM malgré la matrice ouverte (la lectrice qui ajoute une ligne), journal écrit ; et **E2E** : une ligne de coût
ajoutée par le connecteur paraît dans la section « Coûts » de la fiche de l'affaire.

### 9.2 octies Famille `temps` — `CRM-104` T5 (liste fixée, **validée le 2026-10-24**, décisions 671 et 672)

**Trois outils** : lire ses saisies de temps et le rapport valorisé, et **poser une case de la grille** — les mêmes tables et
la même fonction que la webapp (`saisie-temps.ts`, `rapport-temps.ts`), sous le jeton de la personne. La base tient le
reste : une saisie par personne, jour et cible (index uniques), des minutes par quarts d'heure jusqu'à 7 h
(`saisies_temps_minutes_check`), le plafond journalier, et `app.saisie_temps_permise` — soi-même, ou l'administrateur de
l'espace pour un autre, sur une cible que cette personne peut lire.

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_time_entry_list` | `consulter` | `workspace:workspace` ; `autres` : `track:track_id`, `channel:channel_id`, `card:card_id`, **facultatives** | `saisies_temps` | une période (`date_from`, `date_to`, 93 jours au plus) ; vos saisies par défaut, celles d'une personne **nommée**, ou de tout l'espace (`everyone`) — la RLS ne rend que les siennes à qui n'administre pas ; chaque saisie avec sa cible nommée ; total en minutes |
| `crm_time_report` | `consulter` | `workspace:workspace` ; `autres` : `track:track_id`, `card:card_id`, **facultatives** | `public.temps_valorise` | minutes et coût valorisé par personne et cible sur la période, ramenés aux tracks de l'espace ; montants par devise, jamais additionnés entre devises ; les minutes sans taux comptées à part |
| `crm_time_entry_set` | `modifier` | `workspace:workspace` ; `autres` : `track:track_id`, `channel:channel_id`, `card:card_id`, **facultatives** (exactement une) | `saisies_temps` (`POST`, `PATCH` ou `DELETE` de la case) | les minutes d'une personne (vous par défaut, ou nommée), un jour, sur une cible ; la case existante est remplacée ; **0 vide la case**, comme l'écran (décision 671) |

**La personne est nommée, jamais désignée par un identifiant** : le moteur exige que tout identifiant passé à un outil
soit une ancre (§6.2), et il n'existe pas d'ancre « profil ». Le nom est résolu parmi les membres de l'espace, comme le
responsable de `crm_card_update` ; un nom ambigu ou inconnu est refusé.

**Refus nommés** : `plafond journalier` (le total du jour dépasserait la limite) ; les minutes hors forme
(`saisies_temps_minutes_check`) ; une saisie qui n'est pas permise (`42501`) ; le reste comme partout.

**Ce que la tranche ne fait pas, et pourquoi.**
- **Le coût du personnel** — les versions de taux — reste un geste de l'écran, réservé aux administrateurs.
- **Aucun outil de suppression** distinct : vider une case est le geste de la grille, rangé sous `modifier` (décision 671).

**Preuves** (§13) : pour chaque outil, contre la vraie base et un vrai client MCP — succès, refus par la matrice, refus
par le CRM malgré la matrice ouverte (la saisie d'une personne qu'on n'administre pas, le plafond), journal écrit ; et
**E2E** : du temps posé par le connecteur paraît dans la bande « Votre semaine » de la fiche de l'affaire.

### 9.2 nonies Famille `objectifs` — `CRM-104` T6 (liste fixée, **validée le 2026-10-24**, décisions 673 et 674)

**Six outils**, ceux du catalogue (§9.2) : lire les canevas d'objectifs, et les composer sans jamais rien détruire. Les
mêmes tables que la webapp (`objectifs.ts`, `objectifs-ecriture.ts`) : `goal_boards`, `goal_blocks`, `goal_links`, sous
le jeton de la personne ; la base décide qui écrit un tableau (`ecriture_permise`). **L'avancement d'un bloc est
manuel** (`fill_percent`, `docs/SPEC-goals.md` §1) : le connecteur l'écrit, il ne le calcule jamais.

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_goal_board_list` | `consulter` | `workspace:workspace` | `goal_boards` | les tableaux de l'espace, par position ; les archivés avec `include_archived` |
| `crm_goal_board_get` | `consulter` | `board:board_id` | `goal_boards`, `goal_blocks`, `goal_links` | le tableau, `can_write` ; ses blocs **en texte** — titre, texte, avancement, channel lié nommé — dans l'ordre de lecture du canevas (haut en bas, gauche à droite) ; ses flèches entre blocs, avec leur sens |
| `crm_goal_block_add` | `ajouter` | `board:board_id` ; `autres` : `channel:channel_id`, **facultative** | `POST goal_blocks` | titre, texte, avancement (0 à 100), channel lié ; **placé automatiquement** à droite du bloc le plus à droite, à la taille d'un bloc neuf de l'écran |
| `crm_goal_link_add` | `ajouter` | `board:board_id` ; `autres` : `block:source_block_id`, `block:target_block_id` | `POST goal_links` | une flèche entre deux blocs du tableau ; sens `forward`, `backward` ou `both` ; libellé facultatif ; un doublon est refusé (`23505`) |
| `crm_goal_block_update` | `modifier` | `block:block_id` ; `autres` : `channel:channel_id`, **facultative** | `PATCH goal_blocks` | titre, texte (chaîne vide qui efface), avancement, channel lié ou détaché ; **jamais la géométrie** — déplacer ou redimensionner reste un geste de l'écran |
| `crm_goal_board_archive` | `supprimer` | `board:board_id` | `PATCH goal_boards` (`archived_at`) | archive le tableau, ou le désarchive (`archived=false`) ; c'est le « supprimer » du §6.1, jamais une purge |

**Un genre d'ancre nouveau** : `block` (`goal_blocks`, résolu jusqu'à l'espace par son tableau). `board` existe déjà.

**Ce que la tranche ne fait pas, et pourquoi.**
- **Aucune suppression d'un bloc ni d'une flèche** : le CRM ne sait que les détruire (A4).
- **Ni créer, ni renommer, ni réordonner un tableau** : ces gestes restent ceux de l'écran (décision 673).
- **Ni la géométrie, ni la couleur** d'un bloc : la composition visuelle du canevas reste à l'écran.

**Preuves** (§13) : pour chaque outil, contre la vraie base et un vrai client MCP — succès, refus par la matrice, refus
par le CRM malgré la matrice ouverte (la lectrice qui ajoute un bloc), journal écrit ; et **E2E** : un bloc ajouté par le
connecteur paraît sur le canevas, avec son avancement.

### 9.2 decies Famille `messagerie` — `CRM-104` T7 (liste fixée, **validée par la session le 2026-10-24**, décision 684, **confirmée par le responsable**, décision 706 ; périmètre arbitré par la décision 676)

**Trois outils** : lire les messages d'une affaire, en lire un, et **envoyer un email depuis une affaire** par la même
file que l'écran (`envoi.ts`, `inbox.ts`) — `public.queue_outbound_email`, qui garde le droit d'écrire sur l'affaire,
le droit d'emprunter l'identité d'expédition, la signature, le quota et le journal de l'affaire.

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_card_mail_list` | `consulter` | `card:card_id` | `mail_messages` | les messages classés dans l'affaire, du plus ancien au plus récent : sens, date, expéditeur, destinataires, objet, un extrait du texte ; paginé ; **jamais les pièces jointes** |
| `crm_mail_get` | `consulter` | `message:message_id` | `mail_messages` | un message : en-têtes et **texte** (`body_text`) ; ni le HTML ni les pièces jointes |
| `crm_mail_send` | `ajouter` (`destructiveHint` ; `aussi` : `affaires:consulter`) | `card:card_id` ; `autres` : `message:in_reply_to_message_id`, **facultative** | `public.queue_outbound_email` | destinataires, copie, objet, texte ; l'identité d'expédition **désignée par son adresse** parmi celles que la personne peut emprunter (la sienne, ou celle du service pour un administrateur) ; en réponse éventuelle à un message de l'affaire |

**Un genre d'ancre nouveau** : `message` (`mail_messages`, qui porte son espace). L'identité d'expédition est désignée
par son adresse et non par un identifiant : le moteur exige que tout identifiant soit une ancre (§6.2), et l'adresse est
ce que la personne connaît.

**L'envoi est irréversible et sort du CRM** : `destructiveHint` l'annonce, pour que l'assistant demande confirmation
avant d'appeler l'outil. Le message part par la file de l'écran, avec la signature de l'identité, et paraît dans le fil
de l'affaire comme un envoi depuis l'écran.

**Refus nommés** : le quota de l'identité atteint (`23505`), une adresse ou une saisie invalide (`23514`), une écriture
ou une identité non permises (`42501`) ; une adresse d'expédition inconnue est refusée avant l'appel, en nommant les
adresses possibles.

**L'état lu, ajouté par `CRM-057` tranche 2** (décision 708, M1 B ; `docs/SPEC-mail-subsystem.md` §18 bis.5) :
`crm_card_mail_list` et `crm_mail_get` rendent `read`, l'état de la personne que le connecteur représente. Aucun outil ne
marque, et lire par le connecteur ne marque pas. Même action `consulter`, aucune case nouvelle.

**La copie cachée, ajoutée par `CRM-058` tranche 2** (décision 708, M2 B ; `docs/SPEC-mail-subsystem.md` §19 bis.2
point 9) : `crm_mail_send` prend `bcc` (cinquante adresses au plus), transmis en `p_bcc` ; remise par l'enveloppe, jamais
montrée aux destinataires. Même action `ajouter`, aucune case nouvelle.

**Ce que la tranche ne fait pas, et pourquoi.**
- **Les pièces jointes** : ni lues ni envoyées — y compris depuis `CRM-058` tranche 2 (décision 708).
- **Classer, déclasser ou mettre en sommeil un fil** de la boîte de réception : gestes de l'écran.
- **Les modèles et les séquences** : gestes de l'écran.

**Preuves** (§13) : pour chaque outil, contre la vraie base et un vrai client MCP — succès, refus par la matrice, refus
par le CRM malgré la matrice ouverte (la lectrice qui envoie), journal écrit ; l'envoi est constaté dans `mail_outbox`,
sans relève réelle ; et **E2E** : un email envoyé par le connecteur paraît dans le fil de l'affaire.

**Précisions du contrat, mesurées sur la pile de développement le 2026-10-24 avant le code (décision 684)** — la liste
ci-dessus est inchangée :

- **`crm_card_mail_list`** lit `mail_messages` où `card_id` est l'affaire, du plus ancien au plus récent (`received_at`,
  puis `id`, ordre total), `limit` 25 par défaut, borné à 100, `offset`. Chaque ligne : `id`, `direction` (`inbound`,
  `outbound`), `sent_at`, `received_at`, `from` (`address`, `name`), `to`, `cc`, `subject`, `excerpt` — les 280 premiers
  caractères du corps affichable, espaces resserrés — et `attachment_count`, le **nombre** de pièces jointes (compte
  embarqué `mail_attachments(count)`). Le nombre est donné pour que leur absence du connecteur ne soit pas une perte
  silencieuse ; leur contenu ni leur nom ne le sont jamais.
- **`crm_mail_get`** lit un message que la RLS rend — classé ou non, comme ceux que rend `crm_search` — : en-têtes,
  `card_id`, `classification`, `attachment_count`, et `body`. **Le corps affichable est celui de l'écran**
  (`corpsAffichable` d'`inbox.ts`) : `body_text` s'il n'est pas vide, sinon le HTML réduit en texte par la même règle que
  `reduireHtmlEnTexte`, et `body_from_html` le dit. Le HTML lui-même n'est jamais rendu.
- **`crm_mail_send`** prend `card_id`, `to` (une à cinquante adresses), `cc` (facultatif, même borne), `subject`, `body`,
  `from_address` et `in_reply_to_message_id`, ces deux derniers facultatifs. Il appelle `queue_outbound_email` avec
  `p_cc`, que la fonction accepte déjà — le même appel que l'écran, un paramètre de plus que son formulaire.
  - **L'identité d'expédition** est cherchée dans `mail_outbound_identities` de l'espace de l'affaire, parmi celles que
    la personne peut emprunter — la sienne, ou celle du service (sans propriétaire), que la RLS ne montre qu'aux
    administrateurs : le filtre de `lireIdentitesDisponibles`. L'adresse se compare sans la casse. **Absente**, elle vaut
    l'unique identité possible ; s'il y en a plusieurs, l'appel est refusé en nommant les adresses possibles, et s'il n'y
    en a aucune, en le disant. Aucun choix implicite parmi plusieurs.
  - **Une réponse** désigne un message **classé dans cette affaire** : un message lisible d'une autre affaire, ou non
    classé, est refusé (`reply_outside_card`) avant l'appel — la fonction ne le vérifie pas, l'écran ne le propose pas.
    En réponse, `subject` est facultatif et vaut l'objet du message préfixé une seule fois (`objetDeReponse`).
  - **Refus nommés**, et non le refus uniforme : l'affaire est lisible, la personne doit savoir pourquoi l'envoi
    échoue — `forbidden` (pas le droit d'écrire sur l'affaire), `identity_not_available`, `card_not_available`
    (affaire archivée, à la corbeille ou sans adresse), `recipient_required`, `body_required`, `quota_exceeded`.
  - **Rend** l'identifiant de l'envoi en file, l'adresse d'expédition employée et l'état `queued` : le message part
    par le worker de `mail-sync`, puis paraît dans le fil de l'affaire (`direction = outbound`).
- **Le genre d'ancre `message`** : `mail_messages`, qui porte son `workspace_id`.
- **Les consignes au modèle** (`INSTRUCTIONS`) gagnent une ligne : lire le fil avant de répondre, et confirmer avec la
  personne avant tout envoi.
- **L'onglet « Connecteur MCP »** garde sa phrase de portée (« Lecture des fils ; l'envoi compte comme « ajouter » ») :
  elle décrit déjà la famille.
- **Aucune migration** : la famille est dans la liste fermée depuis `0090`.

### 9.2 undecies Famille `workflows` — `CRM-118` T1 (liste fixée, **validée le 2026-10-26**, décision 756 ; décisions 752 et 754)

**La famille.** Dixième famille, rangée **après `structure`** dans les listes fermées et dans la matrice de l'onglet
« Connecteur MCP ». Elle gouverne **ce qui écrit** un workflow, ainsi que les lectures propres à la gestion (liste,
formulaire complet, versions, comparaisons, plans). **La lecture de la composition reste à `structure`**
(`crm_workflow_get`, décision 754). Les écritures sont réservées par la base aux administrateurs d'espace
(`docs/SPEC-workflow-engine.md` §3.7) ; le connecteur n'ouvre rien de plus.

**Sous-tranches livrées séparément**, sur le modèle de `CRM-104` T2.a et T2.b. La migration et les genres d'ancre
viennent avec la première. **Le connecteur suit strictement l'écran** (décision 756) : un outil dont le geste n'a pas
encore d'écran attend la tranche d'écran de `CRM-118` (T1.b, `docs/SPEC-workflow-engine.md`) ou l'éditeur de checklists
de `CRM-068` T3b ; il est marqué *après T1.b* ou *après `CRM-068` T3b* ci-dessous.

**Genres d'ancre nouveaux** (§9.1), chacun lu sous le jeton jusqu'à son `workspace_id` :

| Genre | Table |
|---|---|
| `step` | `workflow_steps` |
| `transition` | `workflow_transitions` |
| `field` | `form_fields` |
| `checklist_item` | `workflow_step_checklist_items` |
| `version` | `workflow_versions` |
| `node` | `workflow_nodes_catalog` |

#### T2.a — le workflow, ses étapes, ses transitions (douze outils, dont deux après T1.b, et la migration)

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_workflow_list` | `consulter` | `workspace:workspace` | `workflows` | nom, portée, track, défaut, archivé, workflow d'origine d'une copie ; les archivés sur demande |
| `crm_workflow_create` | `ajouter` | `workspace:workspace` ; `autres` : `track:track_id`, facultative | `POST workflows` | `creerWorkflow` : nom (`trim`), portée `global` ou `track`, `track_id` forcé à nul sous `global` ; `is_default` jamais envoyé. Un workflow naît **sans étape** : c'est un brouillon (§3.5) |
| `crm_workflow_starter_create` | `ajouter` | `workspace:workspace` | `creer_workflow_de_depart(p_workspace)` | le geste « workflow de départ » (`CRM-094`) |
| `crm_workflow_step_add` | `ajouter` | `workflow:workflow_id` ; `autres` : `node:node_id` | `POST workflow_steps` | `ajouterEtape` : position en fin (trigger) ; surcharges facultatives (libellé, probabilité, seuil de relance) |
| `crm_workflow_transition_add` | `ajouter` | `workflow:workflow_id` ; `autres` : `step:from_step_id`, `step:to_step_id` | `POST workflow_transitions` | `declarerTransition` : libellé, motif exigé |
| `crm_workflow_update` | `modifier` | `workflow:workflow_id` | `PATCH workflows` | **après T1.b** : le nom, et la désignation par défaut, comme l'écran les offrira |
| `crm_workflow_step_update` | `modifier` | `step:step_id` | `PATCH workflow_steps` | `surchargerEtape` : libellé, probabilité, seuil ; `null` rend la valeur du catalogue (§2.5 : `0` n'est pas `null`). `is_initial: true` suit `designerEtapeInitiale` : l'ancienne initiale retirée, puis la nouvelle posée |
| `crm_workflow_step_move` | `modifier` | `step:step_id` ; `autres` : `step:after_step_id`, facultative | `PATCH workflow_steps set position` | une écriture, la position entre les deux voisines (`calculerDeplacement`) ; sans `after_step_id`, en tête |
| `crm_workflow_transition_update` | `modifier` | `transition:transition_id` | `PATCH workflow_transitions` | `modifierTransition` : libellé, motif exigé ; ni le départ ni l'arrivée |
| `crm_workflow_step_remove` | `supprimer`, `destructiveHint` | `step:step_id` | `DELETE workflow_steps` | `retirerEtape` ; emporte ses arêtes (§3.4) ; **une étape occupée par une affaire est refusée par la base** ; exception assumée à « `supprimer` = corbeille ou archive » (décision 754) |
| `crm_workflow_transition_remove` | `supprimer`, `destructiveHint` | `transition:transition_id` | `DELETE workflow_transitions` | `retirerTransition` ; même exception |
| `crm_workflow_archive` | `supprimer`, `destructiveHint` | `workflow:workflow_id` | `PATCH workflows set archived_at` | **après T1.b**, avec la garde côté serveur qu'elle pose |

#### T2.b — le formulaire, la visibilité, les exigences (douze outils)

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_workflow_form_get` | `consulter` | `workflow:workflow_id` | `form_fields`, `form_field_rules`, `workflow_transition_required_fields`, `workflow_step_checklist_items`, `workflow_transition_required_checklist_items` | les champs, archivés compris ; la grille champ × étape (`hidden`, `visible`, `required`, ou le défaut) ; les exigences de chaque transition (champs et points de checklist) ; les points de checklist de chaque étape |
| `crm_transition_requirement_preview` | `consulter` | `field:field_id` ; `autres` : `step:step_id`, `transition:transition_id`, facultatives | `previsualiser_exigence` | le nombre d'affaires touchées, sur place et à l'entrée (§7 bis.13) — à appeler avant d'exiger un champ |
| `crm_form_field_add` | `ajouter` | `workflow:workflow_id` | `POST form_fields` | `declarerChamp` : clé, libellé, type (les quinze), options, aide |
| `crm_form_field_update` | `modifier` | `field:field_id` | `PATCH form_fields` | `modifierChamp` : libellé, aide, options ; **jamais la clé ni le type** |
| `crm_form_field_move` | `modifier` | `field:field_id` ; `autres` : `field:after_field_id`, facultative | `PATCH form_fields set position` | comme `crm_workflow_step_move` |
| `crm_form_field_visibility_set` | `modifier` | `field:field_id` ; `autres` : `step:step_id` | `upsert form_field_rules`, ou `DELETE` pour `default` | `reglerVisibilite`, `rendreAuDefaut` : rendre une case au défaut est un réglage |
| `crm_transition_required_field_set` | `modifier` | `transition:transition_id` ; `autres` : `field:field_id` | `POST` ou `DELETE workflow_transition_required_fields` | `exigerChamp`, `retirerExigence` ; `required` vrai ou faux ; `modifier`, un réglage de la transition (décision 756) |
| `crm_step_checklist_item_add` | `ajouter` | `step:step_id` | `POST workflow_step_checklist_items` | **après `CRM-068` T3b** |
| `crm_step_checklist_item_update` | `modifier` | `checklist_item:item_id` | `PATCH workflow_step_checklist_items` | libellé, position ; **après `CRM-068` T3b** |
| `crm_transition_required_checklist_item_set` | `modifier` | `transition:transition_id` ; `autres` : `checklist_item:item_id` | `POST` ou `DELETE workflow_transition_required_checklist_items` | **après `CRM-068` T3b** |
| `crm_form_field_archive` | `supprimer`, `destructiveHint` | `field:field_id` | `PATCH form_fields set archived_at` | `archiverChamp` : un champ ne se supprime pas |
| `crm_step_checklist_item_archive` | `supprimer`, `destructiveHint` | `checklist_item:item_id` | `PATCH workflow_step_checklist_items set archived_at` | **après `CRM-068` T3b** ; le geste exact (archive ou retrait) suit l'éditeur |

#### T2.c — la copie, les versions, le remappage (sept outils)

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_workflow_version_list` | `consulter` | `workflow:workflow_id` | `workflow_versions` | numéro, note, auteur, date ; sans la composition |
| `crm_workflow_version_compare` | `consulter` | `version:base_version_id` ; `autres` : `version:target_version_id` | `compare_workflow_versions` | ajouts, retraits, modifications, par libellé |
| `crm_workflow_source_compare` | `consulter` | `workflow:workflow_id` | `workflow_derivations`, `compare_workflow_with_source` | la divergence d'une copie avec sa source (§4 ter) |
| `crm_workflow_remap_plan` | `consulter` | `version:version_id` | `plan_card_remapping(target_version_id, step_overrides, card_limit)` | où chaque affaire atterrirait ; n'écrit rien ; rend l'empreinte vivante à repasser à la restauration |
| `crm_workflow_copy_to_track` | `ajouter` | `workflow:workflow_id` ; `autres` : `track:track_id` | `copy_workflow_to_track(workflow_id, track_id, new_name)` | **après T1.b** : aucun écran n'appelle la fonction aujourd'hui |
| `crm_workflow_version_publish` | `ajouter` | `workflow:workflow_id` | `publish_workflow_version(target_workflow_id, note)` | une photographie immuable (§7 ter.5) |
| `crm_workflow_version_restore` | `modifier`, `destructiveHint` | `version:version_id` | `restore_workflow_version(target_version_id, step_overrides, expected_live_fingerprint)` | réécrit la composition vivante **et remappe les affaires**, en une transaction ; le plan est rejoué, l'empreinte vérifiée (§7 ter.13). La description demande de montrer le plan à la personne avant |

**Refus nommés**, et non le refus uniforme : la personne qui administre doit savoir pourquoi. Les contraintes nommées
(`23514`) et les unicités (`23505` : un nœud déjà présent, une seconde étape initiale, une arête déjà déclarée, une clé
de champ prise) ; une étape occupée (`23503`) ; une arête hors de son workflow (`23503`) ; les huit refus du plan
(`remappage invalide`, `remappage ambigu`…, §7 ter.12.4), rendus tels quels ; une empreinte périmée. Le reste comme
partout (§9.3).

**Le reste de la famille.** Les consignes au modèle (`INSTRUCTIONS`) gagnent une ligne : lire le workflow
(`crm_workflow_get`) avant de le modifier, dire à la personne ce qui va changer, montrer le plan avant une
restauration. **L'onglet « Connecteur MCP »** gagne la ligne `workflows` et sa phrase de portée, **qui grandit avec les
sous-tranches** pour ne jamais promettre un outil absent. Avec T2.a : « Créer et modifier les workflows, leurs étapes et
transitions ; la lecture reste à Structure » ; avec T2.b : « Créer et modifier les workflows, leurs étapes, transitions et
formulaire ; la lecture reste à Structure ». Cible, toutes sous-tranches livrées : « Créer, modifier et archiver les
workflows, leurs étapes, transitions et formulaire, le catalogue de nœuds ; versions, copie, workflow d'un channel. La
lecture d'un workflow reste à Structure. »

**La migration** (T2.a, au prochain numéro libre) : `workflows` après `structure` dans les quatre listes fermées
(`mcp_droits_famille`, `mcp_autorise`, `mcp_compte`, `mcp_poser_droits`), sur le modèle de `0101` ; retour arrière :
retirer les droits de la famille, puis réappliquer `0101`.

#### T2.d — le catalogue de nœuds, le workflow d'un channel (six outils)

| Outil | Action | Ancre (et `autres`) | Ce qu'il appelle | Remarques |
|---|---|---|---|---|
| `crm_workflow_node_list` | `consulter` | `workspace:workspace` | `workflow_nodes_catalog` | clé, libellé, type, couleur, probabilité et seuil par défaut, rang ; les archivés sur demande |
| `crm_workflow_node_create` | `ajouter` | `workspace:workspace` | `POST workflow_nodes_catalog` | `creerNoeud` |
| `crm_workflow_node_update` | `modifier` | `node:node_id` | `PATCH workflow_nodes_catalog` | `modifierNoeud` : libellé, couleur, probabilité et seuil ; **jamais la clé** (§2.3) |
| `crm_workflow_node_move` | `modifier` | `node:node_id` ; `autres` : `node:after_node_id`, facultative | `PATCH workflow_nodes_catalog set position` | `deplacerNoeud`, comme `crm_workflow_step_move` |
| `crm_workflow_node_archive` | `supprimer`, `destructiveHint` | `node:node_id` | `PATCH workflow_nodes_catalog set archived_at` | `archiverNoeud` ; la garde d'un nœud occupé (`docs/SPEC-workflow-engine.md` §2.6) est rendue nommée |
| `crm_channel_workflow_change` | `modifier`, `destructiveHint` | `channel:channel_id` ; `autres` : `workflow:workflow_id` | `change_channel_workflow(channel_id, workflow_id, step_mapping, discard_field_values)` | **après T1.b** ; remappe toutes les affaires du channel, la correspondance des étapes explicite et exhaustive (`docs/SPEC-change-channel-workflow.md`) ; la perte des réponses de formulaire exigée explicitement, comme `crm_card_move_to_channel`. `crm_channel_update` (`structure`) ne change toujours pas le workflow |

**Les points ouverts du 2026-10-26 sont tranchés** (décision 756) : les gestes sans écran reçoivent d'abord leur écran
(T1.b) ; le catalogue et le workflow d'un channel entrent dans la famille (T2.d) ; exiger ou ne plus exiger relève de
`modifier`.

**Preuves** (§13), par sous-tranche et par outil : succès ; refus par la matrice (case décochée) ; **refus par le CRM
malgré la matrice ouverte** (un business developer qui ajoute une étape : la base le réserve à l'administrateur) ;
journal écrit ; et **E2E** : une étape ajoutée par un vrai client MCP paraît dans l'éditeur de workflows (T2.a), un
champ exigé par le connecteur bloque un déplacement au board (T2.b), une restauration par le connecteur remappe une
affaire visible au board (T2.c).

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
  - **Précisé le 2026-10-23, avec `CRM-103` T3** (`docs/SPEC-seed.md` §22). Le seed couvre le compte en attente
    (Farida), la lecture (Camille, `recettes:consulter`, à qui le rapport de rentabilité reste invisible) et le refus du
    CRM (le rapport, pour Driss). **Pas de refus de la matrice** : avec un seul espace, un outil fermé est invisible et
    ne s'appelle pas ; ce refus est prouvé par `mcp/tests/test_politique.py`, à deux espaces simulés. L'écriture sur `affaires` et
    les créations par le connecteur attendent les outils `affaires` de `CRM-104` T2. Le parcours OAuth du seed est celui
    des preuves d'intégration, `mcp/tests/parcours_oauth.py`.

## 13. Preuves

| Unité | Preuves |
|---|---|
| `CRM-102` T3 | **Intégration** (`mcp/tests/test_integration_oauth.py`, marque `integration`), jouée par `scripts/verify-mcp.sh` dans l'image `dev` **sur le réseau Compose**, contre le vrai Keycloak, la vraie base et le vrai service `mcp` ; seule l'origine publique `localhost:${MCP_DEV_PORT}` est réécrite vers `mcp:8080`, `sso.localhost` étant le même dedans et dehors : `401` et métadonnées (`resource`, `issuer` = l'origine) ; parcours complet de `plateforme@` (superadministratrice en base) et d'`exploitante@` (`admin` LeLabs), jusqu'à `crm_workspace_list` — vide pour la première (RLS, D7), l'espace seedé pour la seconde — et la ligne au `mcp_journal` ; « Droits en attente » pour `admin@` (vérifié, sans droit) ; « Compte en attente de vérification » pour `attendu@` (sans `verified`) et `adresse-non-verifiee@` ; aucun code émis sur un refus ; `offline_access` demandé **si et seulement si** la case est cochée, et le renouvellement qui survit à la fin de la session du SSO **seulement** dans ce cas ; jeton forgé, et vrai jeton du realm émis pour un autre client (`crm-audience-etrangere`), refusés ; adresse de retour hors liste refusée ; `/pret` à `200`. **E2E** : un vrai client MCP, connecté **dans le navigateur**, case cochée. **Assemblage** : `scripts/verify-spark.sh` résout la cellule profil éteint et allumé — limites mémoire, secrets de `mcp` présents seulement allumé, Caddy sans secret, révision des routes. `scripts/verify-mcp.sh` rejoue le tout, avec des dégradations réelles |
| `CRM-102` | **pytest unitaires** : jeton interne (revendications, échéance bornée, `lelabs_admin`), garde, réglages, déclaration des outils. **Intégration** contre le vrai Keycloak et la vraie base : parcours OAuth complet en requêtes directes ; refus sans `verified` et sans adresse vérifiée ; « Droits en attente » ; `offline_access` demandé **seulement** case cochée ; jeton forgé, d'un autre client ou HS256 refusé ; amorçage par la première connexion ; `crm_workspace_list` sous la RLS. **pgTAP** `0085_connecteur_mcp.test.sql` : fermeture, privilèges, `mcp_autorise` (superadministrateur, porteur de `lelabs_admin`, matrice, famille invalide en `22023`), cascade d'un espace supprimé, mutations. **E2E** : un vrai client MCP connecté dans le navigateur, case cochée. `scripts/verify-mcp.sh` |
| `CRM-102` T6 | **pytest unitaires** : `SITE_URL` obligatoire et nommée quand elle manque ; l'accueil porte le lien vers `${SITE_URL}/plateforme`, échappé ; `/plateforme` et `/admin` en `302` vers cette adresse, sans chaîne de requête, et `/plateforme/autre` non redirigé. **Intégration** contre la vraie pile : le service en route rend ce `302`. **E2E** : depuis l'accueil, le lien mène à l'écran Plateforme de la webapp, à la souris et au clavier ; captures de l'accueil renouvelées aux quatre paliers, observées. **Assemblage** : `scripts/verify-spark.sh` mesure que `SITE_URL` atteint `mcp` allumé |
| `CRM-102` T5 | **Contrôles de production** portés dans `scripts/spark/verifier.sh` par `scripts/lib/connecteur-mcp.sh` (`docs/SPEC-deploiement-spark.md` §7, point 7 ; décision 683). **Harnais** `scripts/verify-controles-connecteur.sh` : les quatre contrôles publics contre le vrai service de développement ; contre-épreuves — origine et `SITE_URL` fausses, serveur qui rend `200` à tout, port fermé ; cellule simulée devant un vrai Caddy de la cellule, webapp montée pour que l'hôte non aiguillé reçoive `200` comme en production |
| `CRM-103` | **pgTAP** et **API** : chaque RPC refusée à l'anonyme, à la lectrice et à l'administrateur d'espace. **E2E UI** : matrice posée à la souris et au clavier, avertissement « pas membre », effet constaté par un appel MCP réel ; captures aux quatre paliers, observées ; manuel (chapitre 11) |
| `CRM-108` T4 | Pour **chaque** outil de la famille `recettes`, contre la vraie base : succès ; **refus par la matrice** (case `recettes` décochée ; pour le rapport, case `budgets:consulter` ou `temps:consulter` décochée) ; **refus par le CRM** malgré la matrice ouverte (la lectrice qui ajoute une ligne, le business developer qui demande le rapport en `42501`) ; journal écrit. Déclarations des genres `revenue` et `revenue_actual` vérifiées au démarrage. La marge Python prouvée sur les mêmes cas que `webapp/src/lib/rentabilite.ts`. **E2E** : une ligne ajoutée par le connecteur paraît dans le bloc « Recettes » de la fiche |
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

## 16. Actualisation — à reprendre quand la boucle du backlog atteint `CRM-104`

*Consigne du responsable, 2026-10-23.* Cette spécification décrit le CRM tel qu'il était le 2026-10-20. Le produit
continue d'évoluer pendant que le connecteur se construit. Quand la boucle de développement du backlog arrive à
`CRM-104`, **avant d'écrire le catalogue d'une tranche** :

1. **Faire l'inventaire des fonctionnalités livrées depuis le 2026-10-20**, d'après `CHANGELOG.md` et `docs/BACKLOG.md`.
   Exemples connus à cette date : les capacités lues par l'interface (`CRM-093`), la description des tracks, des channels
   et des affaires (`CRM-105`), les réels multiples d'une ligne de coût (`CRM-099`), la saisie de temps (`CRM-098`).
2. **Actualiser cette spécification en conséquence** :
   - le catalogue des outils (§9.2), pour que le connecteur couvre toutes ces fonctionnalités ;
   - la portée de chaque famille (§6.1, et sa phrase dans l'onglet « Connecteur MCP ») ;
   - les consignes données au modèle (§2, `INSTRUCTIONS`).
3. **Une fonctionnalité qui n'entre dans aucune famille** se consigne comme une décision du responsable, et n'est pas
   rangée implicitement. Une famille nouvelle demande une migration, puisque la liste est fermée en base (§6.1, §7.1).

Cette actualisation est committée comme documentation avant le code de la tranche, comme toute spécification (`CLAUDE.md`
§5).

**Première application, `CRM-108` (2026-10-23).** La question a été posée pour les recettes et la rentabilité : oui,
dans une **famille nouvelle**, `recettes`, sur décision du responsable (décision 632, arbitrages 5 et 6) — la migration
`0095` l'ajoute à la liste fermée, et les outils sont livrés par `CRM-108` T4.

**Inventaire du 2026-10-23, pour `CRM-104`** (décisions 652 et 653). Les fonctionnalités livrées depuis le 2026-10-20,
d'après `CHANGELOG.md` et `docs/BACKLOG.md` :

| Unité | Fonctionnalité | Dans le connecteur |
|---|---|---|
| `CRM-067` | activités réalisées d'une affaire | **oui**, `affaires` — `crm_card_activity_list` (T2.a), `crm_card_activity_add`, `crm_card_activity_update` (T2.b) ; aucun retrait (décisions 648, 653) |
| `CRM-093` | capacités lues par l'interface | **oui**, en lecture : `crm_card_get` rend `can_write` ; `structure` rendra celles des channels (T1) |
| `CRM-105` | description d'un track, d'un channel, d'une affaire | **oui** : lue par `crm_card_get` (T2.a), écrite par `crm_card_update` (T2.b) ; tracks et channels avec `structure` (T1) |
| `CRM-066` | surcharge de probabilité d'une affaire | **oui** : lue par `crm_card_get`, écrite par `crm_card_update` (T2.b) |
| `CRM-061` | « Ma journée » | **oui** : `crm_card_mine` (T2.a) |
| `CRM-095` | créer une affaire depuis le board | **oui** : `crm_card_create` (T2.b), par `creer_affaire` |
| `CRM-099` | plusieurs réels par ligne de coût | **oui**, `budgets` (T4) |
| `CRM-098`, `CRM-106` | saisie de temps, bande de la semaine | **oui**, `temps` (T5) ; la bande est une forme d'écran |
| `CRM-107` | calculateur du coût par quart | **non** : une aide de saisie d'écran, sans donnée |
| `CRM-108` | recettes et rentabilité | **oui**, `recettes` — livrée (`CRM-108` T4) |
| `CRM-070` | membres et droits fins | **non** (décision 653) |
| `CRM-097` | suggestions de l'assistant IA | **non** (décision 653) |
| `CRM-109` | refus d'admission | **non** (décision 640) |
| `CRM-101`, `CRM-103` | plateforme, administration du connecteur | **non** : écrans du superadministrateur |
| `CRM-110` | fil d'Ariane | **non** : une forme d'écran |

Les consignes au modèle (`INSTRUCTIONS`, §2) gagnent une ligne avec T2.a : « Affaires (cards) : start with
crm_card_list or crm_card_mine; crm_card_get gives the header, contacts and form answers; crm_card_timeline the history. »

**Règle permanente, 2026-10-23.** Pour ne plus rattraper l'écart après coup, `CLAUDE.md` (« Spécificités du projet »)
impose désormais de demander au responsable, **avant de spécifier toute fonctionnalité**, si elle doit aussi exister dans
le connecteur. La réponse est écrite dans la spécification de l'unité.

**Complément, 2026-10-24 (décision 659).** Une deuxième question accompagne toujours la première : **si oui, la
fonctionnalité relève-t-elle d'une permission distincte**, c'est-à-dire d'une **famille nouvelle** de la matrice (§6.1),
avec sa propre ligne de cases, ou d'une famille existante dont elle partage les cases ? La réponse est écrite à côté de
la première. Une famille nouvelle entraîne la migration de la liste fermée (§6.1, §7.1) et sa phrase dans l'onglet
« Connecteur MCP » (§8.1), comme pour `recettes`. L'inventaire du point 1 ne couvre donc que les
fonctionnalités antérieures à cette règle, ou celles pour lesquelles la question n'a pas été posée.

