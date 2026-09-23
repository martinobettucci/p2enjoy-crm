# Spécification — Authentification, sessions et cycle de vie des comptes

Unités de backlog : `CRM-009` (interface, session d'onglet et gabarits), `CRM-011`
(mécanisme GoTrue) et `CRM-091` (connexion unique par `oauth.lelabs.tech`, §10) ; voir
`docs/BACKLOG.md`.
Documents liés : `docs/DAT.md` §4.1 et §7, `docs/SCHEMA.md` §1, `docs/SPEC-permissions-rls.md` §1
et §7, `docs/manual.md` chapitres 1 et 17.

Ce document a été écrit **après mesure** du comportement réel de `supabase/gotrue:v2.189.0`, la
version épinglée par `docker-compose.yml`. Chaque comportement décrit ici est soit mesuré et
consigné dans `docs/JOURNAL.md`, soit explicitement signalé comme non mesuré.

---

## 1. Principe

L'authentification est assurée par **GoTrue**, seul émetteur de jetons. La webapp ne détient
jamais de secret de service : elle n'utilise que la clé anonyme et le jeton de l'utilisateur
connecté.

Deux règles gouvernent l'ensemble :

1. **Un compte ne naît jamais d'une inscription libre.** Il naît d'une invitation émise avec un
   droit d'administration.
2. **Le jeton ne porte aucun droit métier.** Il porte l'identité (`sub`), rien d'autre. Les droits
   sont relus dans les tables d'appartenance à chaque requête
   (`docs/SPEC-permissions-rls.md` §3), de sorte qu'une révocation prenne effet immédiatement.

Comme partout dans ce projet, « refusé » désigne une règle appliquée côté serveur. Une preuve
d'authentification qui passerait par l'interface ne prouve rien : toutes les preuves du §7 sont
exécutées hors interface, contre l'API réelle.

## 2. Configuration imposée

Les variables sont définies par `.env.example` et consommées par le service `auth` de
`docker-compose.yml` (`CRM-001`, `CRM-002`).

| Variable | Valeur imposée | Motif |
|---|---|---|
| `DISABLE_SIGNUP` | `true` | Aucune inscription libre. **Jamais `false`**, en développement comme en production |
| `ENABLE_EMAIL_SIGNUP` | `true` | Active le fournisseur email/mot de passe, que `DISABLE_SIGNUP` continue d'encadrer |
| `ENABLE_EMAIL_AUTOCONFIRM` | `false` | Une adresse doit être confirmée par son destinataire réel |
| `ENABLE_PHONE_SIGNUP`, `ENABLE_PHONE_AUTOCONFIRM`, `ENABLE_ANONYMOUS_USERS` | `false` | Aucun de ces parcours n'est au périmètre du produit |
| `PASSWORD_MIN_LENGTH` | `12` | Voir §4 |
| `JWT_EXPIRY` | `3600` | Durée de vie du jeton d'accès, en secondes |
| `SITE_URL` | origine de la webapp | Base de résolution des liens envoyés par email. En développement, `runDev.sh` exige l'origine exacte `http://DEV_BIND_ADDRESS:WEBAPP_DEV_PORT` et son autorisation dans `ADDITIONAL_REDIRECT_URLS` avant tout appel à Docker (`CRM-002`, décision 272) |
| `SMTP_*` | Inbucket en développement, fournisseur réel en production | Les emails transactionnels sont **réellement envoyés**, jamais simulés |

`ENABLE_ANONYMOUS_USERS` mérite une mention particulière : GoTrue sait émettre des jetons pour des
utilisateurs anonymes authentifiés. Ce n'est **pas** le rôle `anon` de PostgREST, et la confusion
serait coûteuse. Le produit n'utilise que le rôle `anon`, qui ne porte aucune identité et à qui
`docs/SPEC-permissions-rls.md` §3.2 accorde `EXECUTE` pour que le refus reste « zéro ligne ».

`GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated` reste injectée. Supabase Auth 2.189.0 la journalise
comme « non prise en charge », mais la contre-preuve de la décision 276 montre que son retrait
produit réellement `role=""` et un refus PostgREST `401`. Le contrat exige donc simultanément sa
présence dans le conteneur, `role=authenticated` dans le jeton et l'acceptation de ce jeton par
PostgREST. `GOTRUE_JWT_ADMIN_ROLES=service_role` porte l'administration JWT.

## 3. Cycle de vie d'un compte

### 3.1 Inscription libre — refusée

`POST /auth/v1/signup` est refusé, quel que soit le contenu, par `HTTP 422` et le code d'erreur
`signup_disabled`. C'est un refus de l'**instance**, appliqué avant toute considération de
workspace : il ne dépend d'aucune donnée applicative et ne peut donc pas être contourné par une
manipulation de la base.

### 3.2 Invitation

`POST /auth/v1/invite`, avec un jeton portant le rôle `service_role`.

- La requête crée immédiatement la ligne `auth.users`, avec `invited_at` renseigné, **sans mot de
  passe** et sans `email_confirmed_at`.
- Le trigger `on_auth_user_created` (`CRM-003`) crée le profil correspondant dans le même
  mouvement. Le nom affiché suit la chaîne de repli de `docs/SCHEMA.md` §1 : `full_name` des
  métadonnées, puis `name`, puis la partie locale de l'adresse.
- Un email d'invitation est envoyé, contenant un lien de vérification **et** un code à six
  chiffres.
- Une requête d'invitation présentée avec la clé anonyme est refusée : l'invitation n'est pas une
  opération ouverte.

**Ce que cette spécification ne tranche pas.** Le parcours par lequel un administrateur de
*workspace* déclenche une invitation depuis le produit n'est pas arrêté : il suppose un appelant
détenant `service_role`, que la webapp ne doit jamais détenir. La question est consignée en
`docs/INCONSISTENCY_REPORT.md`, INC-015, avec les options mesurées, et attend l'arbitrage du
responsable. Tant qu'elle est ouverte, l'invitation est émise par un **opérateur** disposant de la
clé de service, et non depuis l'interface.

### 3.3 Acceptation

Deux chemins équivalents, tous deux servis par GoTrue :

- le **lien** contenu dans l'email, `GET /auth/v1/verify?token=…&type=invite`, qui redirige vers
  `SITE_URL` en portant les jetons dans le fragment ;
- le **code à six chiffres**, `POST /auth/v1/verify` avec `{type: "invite", token, email}`, qui
  rend les jetons en JSON.

L'acceptation confirme l'adresse (`email_confirmed_at` renseigné) et ouvre une session. Le compte
n'ayant pas encore de mot de passe, l'utilisateur en définit un par `PUT /auth/v1/user` avec le
jeton de cette session.

**Tant que l'invitation n'est pas acceptée, la connexion par mot de passe est refusée.** C'est la
conséquence directe de l'absence de mot de passe : il n'existe aucun état intermédiaire dans
lequel un compte invité serait joignable.

### 3.4 Connexion

`POST /auth/v1/token?grant_type=password`. Rend un jeton d'accès et un jeton de rafraîchissement.
Un mot de passe erroné est refusé par `HTTP 400` et le code `invalid_credentials` — **le même
message que pour une adresse inconnue**, afin de ne pas révéler l'existence d'un compte.

La clé `apikey` reste exigée par la passerelle : une requête sans clé est refusée par Kong avant
d'atteindre GoTrue.

### 3.5 Session

Le jeton d'accès est un JWT HS256 signé avec `JWT_SECRET`, portant `sub` (identifiant de
l'utilisateur), `role` (`authenticated`), `aud` et `exp`. Sa durée de vie est `JWT_EXPIRY`.

Le rafraîchissement, `grant_type=refresh_token`, **fait tourner** le jeton de rafraîchissement :
celui présenté est remplacé par un nouveau. GoTrue laisse une **fenêtre de grâce** de 10 secondes
par défaut (`GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL`), pendant laquelle l'ancien jeton reste
accepté — ce qui évite qu'un double appel concurrent du client ne détruise la session. Ce
comportement est conservé tel quel ; le durcir relèverait d'une décision distincte, et non de
cette unité.

### 3.6 Déconnexion

`POST /auth/v1/logout` avec le jeton d'accès. Rend `HTTP 204` et **révoque la session** : le jeton
de rafraîchissement correspondant cesse immédiatement d'être accepté (`refresh_token_not_found`).

Le jeton d'accès déjà émis, lui, reste cryptographiquement valide jusqu'à son expiration : c'est
la nature d'un JWT, et non un défaut. La conséquence est bornée par `JWT_EXPIRY`, et la
révocation des **droits** est immédiate parce qu'elle ne dépend pas du jeton
(`docs/SPEC-permissions-rls.md` §3).

### 3.7 Réinitialisation de mot de passe

`POST /auth/v1/recover` avec l'adresse. La réponse est `HTTP 200` **que l'adresse existe ou non** :
elle ne renseigne pas un attaquant sur les comptes existants. Un email de réinitialisation n'est
envoyé que si le compte existe.

L'email porte, comme l'invitation, un lien et un code. Le parcours est ensuite identique au §3.3 :
vérification de type `recovery`, session ouverte, puis `PUT /auth/v1/user` pour le nouveau mot de
passe. L'ancien mot de passe cesse alors d'être accepté.

## 4. Politique de mot de passe

`PASSWORD_MIN_LENGTH` vaut **12**. La valeur par défaut de GoTrue est 6, ce qui a été mesuré comme
réellement permissif — un mot de passe de six caractères était accepté avant cette unité
(`docs/JOURNAL.md`, décision 29).

Aucune exigence de composition — majuscules, chiffres, caractères spéciaux — n'est imposée. La
longueur est le seul critère qui améliore réellement la résistance sans pousser l'utilisateur vers
des mots de passe courts et complexes, plus faibles et plus souvent réutilisés.

Le refus est explicite : `HTTP 422`, code `weak_password`, avec la raison `length`.

### 4.1 Le chemin d'administration y échappe, et il est encadré

Cette politique **n'est pas énoncée sans réserve**. Mesuré : `POST /auth/v1/admin/users` crée un
compte avec un mot de passe de **8 caractères** là où le chemin utilisateur en exige 12 et refuse
en `422 weak_password`. Le compte ainsi créé **est utilisable** : il se connecte.

**Arbitrage du responsable — `docs/JOURNAL.md`, décision 265, INC-018 : ce chemin est interdit en
production et documenté comme une opération d'exploitation encadrée.** L'accepter au motif qu'il
exige la clé de service reviendrait à dire qu'un privilège dispense d'une règle. La politique de
mot de passe n'est pas une gêne pour l'utilisateur, c'est une **propriété du produit** — et un
compte à 8 caractères créé par commodité est exactement la brèche qu'elle existe pour éviter.

En développement, le seed continue de créer ses comptes par ce chemin : c'est la seule voie
d'amorçage, et `CLAUDE.md` §8 exige que les données de développement soient créées par les
véritables API. La contrainte porte sur la **production**, où l'encadrement est décrit dans
`docs/PROD_MIGRATIONS.md`.

## 5. Emails transactionnels

Les emails d'invitation, de confirmation, de réinitialisation et de changement d'adresse sont
émis par GoTrue vers `SMTP_HOST`. En développement, c'est **Inbucket** : les emails sont
réellement transmis par SMTP et consultables, jamais simulés (`CLAUDE.md` §8).

### 5.1 Service de gabarits — `CRM-009`

Les quatre gabarits sont des fichiers HTML en français, versionnés sous
`supabase/auth/templates/` et servis par le service interne **`auth-templates`**. Ce service :

- emploie l'image déjà épinglée `caddy:2.9-alpine`, monte le répertoire en lecture seule et
  n'expose **aucun port hôte** ;
- appartient au fichier Compose commun : il existe donc en développement comme en production ;
- répond sur `http://auth-templates:8080`, avec un contrôle de santé portant réellement sur
  `invite.html` ;
- est une dépendance saine de `auth`, afin que le premier email ne puisse pas précéder le serveur.

GoTrue reçoit les quatre URL absolues suivantes :

| Type GoTrue | URL interne | Sujet imposé |
|---|---|---|
| invitation | `/invite.html` | `Invitation à P2Enjoy CRM` |
| confirmation | `/confirmation.html` | `Confirmez votre adresse — P2Enjoy CRM` |
| réinitialisation | `/recovery.html` | `Réinitialisez votre mot de passe — P2Enjoy CRM` |
| changement d'adresse | `/email-change.html` | `Confirmez votre nouvelle adresse — P2Enjoy CRM` |

Chaque corps nomme P2Enjoy CRM, explique l'action en français, expose une action textuelle dont
la cible est `{{ .ConfirmationURL }}` et présente aussi le code `{{ .Token }}`. L'email reste
compréhensible sans image ; son habillage reprend la palette, la pile typographique et les
contrastes de `docs/DESIGN_SYSTEM.md` sans introduire de nouveau jeton.

Le bouton d'action ne porte pas son contraste sur la seule balise `<a>` : certains clients sûrs,
dont l'Inbucket réellement livré en développement, retirent ses styles tout en conservant son
`href`. Une cellule de tableau porte donc le fond bleu et un élément textuel intérieur porte le
blanc ; le lien reste explicite sans CSS. La preuve Chromium exige le contraste **calculé** après
assainissement, pas seulement une ancre accessible dans le DOM (décision 274).

Le repli de GoTrue impose une preuve plus forte que « un message existe ». Si une URL est
injoignable lors du premier chargement, `supabase/gotrue:v2.189.0` journalise l'échec puis met en
cache son gabarit anglais par défaut. Les preuves n° 6 et 18 relisent donc le message **réellement
reçu par SMTP** et exigent simultanément son sujet français, la phrase propre au gabarit, le nom
du produit, le code à six chiffres et le lien d'action du bon type. Le repli anglais échoue ainsi
même lorsqu'un email a bien été livré.

### 5.2 Limite MIME mesurée de GoTrue 2.189.0

Le service de gabarits ne peut pas fabriquer une variante `text/plain`. Dans la version épinglée,
l'interface interne `mailer.Client.Mail` ne reçoit qu'une chaîne `body`, puis le client SMTP
`mailmeclient` appelle `SetBody("text/html", body)`. Il n'existe aucun second corps ni paramètre de
gabarit texte. Inbucket reconstruit donc son affichage texte depuis le HTML et signale l'absence de
partie `text/plain` ; ce n'est pas une variante réellement émise par GoTrue.

Cette limite du composant tiers est distincte d'INC-016, **close par les gabarits français et leur
preuve de contenu**. La contourner demanderait de remplacer ou d'interposer le client SMTP, ce que
`CRM-009` ne mandate pas. Les preuves inspectent le HTML reçu et ne présentent jamais le texte
reconstruit comme une partie MIME d'origine.

## 6. Ce que cette unité ne livre pas

- **Aucun écran de mot de passe oublié ni d'invitation.** L'écran de connexion, la session et la
  déconnexion sont livrés par la reprise décrite au §9 ; les deux autres parcours restent distincts.
- **Aucune politique RLS dans `CRM-009` elle-même.** Cette frontière historique a été fermée par
  `CRM-022` : les identités d'équipe sont lisibles et les mutations de memberships protégées.
- **Aucun rattachement d'un compte invité à un workspace.** L'invitation crée un compte et son
  profil ; elle ne crée aucune ligne `workspace_members`. Le lien entre invitation et appartenance
  fait partie de ce qu'INC-015 laisse à arbitrer.
- **Aucune authentification à facteurs multiples, aucun fournisseur externe, aucun SSO.** Ce
  hors-périmètre était celui de `CRM-009` et de `CRM-011`. Le SSO est livré par `CRM-091`, au §10 :
  il s'ajoute à ce qui précède et n'en réécrit rien (`docs/JOURNAL.md`, décision 568).

## 7. Preuves exigées

Exécutées **hors interface**, contre l'API réelle, avec les jetons réels de chaque profil. Elles
vivent dans `scripts/verify-auth.sh`.

| # | Scénario | Attendu |
|---|---|---|
| 1 | `POST /signup` avec la clé anonyme | `422`, `signup_disabled` |
| 2 | `POST /signup` avec la clé de service | `422`, `signup_disabled` — le refus n'est pas contournable par le privilège |
| 3 | `POST /invite` avec la clé anonyme | Refus |
| 4 | `POST /invite` avec la clé de service | `200`, `auth.users` créé avec `invited_at`, sans mot de passe |
| 5 | Profil créé pour l'invité | Ligne `public.profiles` présente, nom affiché conforme à la chaîne de repli |
| 6 | Email d'invitation | Réellement présent dans Inbucket ; sujet et corps français exacts, nom du produit, lien `invite` et code à six chiffres |
| 7 | Connexion d'un compte invité non accepté | Refus |
| 8 | Acceptation par le code | `200`, session ouverte, `email_confirmed_at` renseigné |
| 9 | Définition du mot de passe puis connexion | `200` |
| 10 | Connexion avec un mot de passe erroné | `400`, `invalid_credentials` |
| 11 | Connexion d'une adresse inconnue | `400`, `invalid_credentials` — message identique au n° 10 |
| 12 | Connexion sans clé `apikey` | Refus par la passerelle |
| 13 | Mot de passe plus court que `PASSWORD_MIN_LENGTH` | `422`, `weak_password` |
| 14 | Contenu du jeton d'accès | `sub`, `role=authenticated`, `exp − iat = JWT_EXPIRY` |
| 15 | Rafraîchissement | Nouveau jeton de rafraîchissement, différent du précédent |
| 16 | Déconnexion | `204`, puis rafraîchissement refusé |
| 17 | `POST /recover` sur une adresse inconnue | `200`, aucun email émis |
| 18 | `POST /recover` sur un compte existant | `200`, email réellement présent ; sujet et corps français exacts, nom du produit, lien `recovery` et code à six chiffres |
| 19 | Réinitialisation menée à son terme | Connexion avec le nouveau mot de passe acceptée, ancien refusé |
| 20 | Suppression du compte par l'API d'administration | Profil disparu par cascade |

Le harnais doit être **non complaisant** : il doit échouer lorsque `DISABLE_SIGNUP` repasse à
`false`, lorsque `PASSWORD_MIN_LENGTH` est abaissée, et lorsque l'invitation est ouverte à la clé
anonyme.

## 8. Points ouverts

1. **INC-015** — parcours d'invitation depuis le produit : qui appelle GoTrue, et comment
   l'invitation porte-t-elle le workspace et le rôle. En attente d'arbitrage.
2. **Partie MIME texte absente de GoTrue 2.189.0** — limite mesurée au §5.2 ; la lever exige un
   composant SMTP ou un client GoTrue différent et n'appartient pas à `CRM-009`.
3. **Durée de vie des liens d'invitation et de réinitialisation** : `GOTRUE_MAILER_OTP_EXP` vaut
   24 heures par défaut. La valeur n'a pas été modifiée, et son expiration n'a **pas** été mesurée
   — la mesurer exigerait de manipuler le temps de l'instance.

---

## 9. Parcours de connexion de la webapp — rattachement à `CRM-009`

Contrat écrit le 2026-08-07 **avant la première ligne de code**, après constat que les écrans du
chunk 3 ne sont démontrés qu'avec des réponses réseau substituées et qu'aucun utilisateur réel ne
peut atteindre les données que le backend lui consent.

**Rattachement corrigé — arbitrage du responsable, `docs/JOURNAL.md` décision 253 (INC-021).**
Ce contrat était initialement rattaché à `CRM-011` « selon l'option la plus étroite ». C'était
**l'option 1** des trois soumises ; le responsable a retenu **l'option 2**, une **unité dédiée**,
`CRM-009`, placée dans l'ordre d'exécution **entre `CRM-007` et `CRM-008`**.

Le motif de l'arbitrage : c'est la seule option qui laisse chaque unité à son objet. `CRM-011` a
livré et prouvé le **mécanisme** d'authentification sur 62 contrôles hors interface ; le rouvrir
pour y loger une interface mêle deux sujets qui n'ont ni les mêmes preuves ni le même risque. Une
unité dédiée donne en outre un propriétaire clair à la posture de session — §9.2 et décision 254 —
que les deux autres options auraient laissée orpheline.

**Ce que la correction change et ne change pas.** Le comportement décrit ci-dessous reste conforme
à la décision 254 ; la traçabilité est désormais corrigée dans les commentaires `@spec`, les
preuves et l'architecture. `CRM-009` porte seule cette interface et la posture de session.

La session, elle, reste limitée à l'onglet : c'est l'objet de la décision 254, qui referme INC-022.

### 9.1 Écran et navigation

- `/connexion` est une route publique, hors de la coquille métier. Elle porte le nom du produit,
  un titre unique, un champ email, un champ mot de passe et l'action primaire « Se connecter ».
- Toute page métier reste consultable sans session afin de conserver ses états de refus et de
  vide réels. Son en-tête offre alors « Se connecter » ; ce lien mémorise **dans l'état du
  routeur**, jamais dans un stockage, l'adresse interne à rouvrir après succès.
- Après une connexion réussie, l'utilisateur revient à cette adresse, ou à `/` lorsqu'il est
  arrivé directement sur `/connexion`. Une adresse externe n'est jamais acceptée comme retour.
- Un utilisateur déjà connecté qui ouvre `/connexion` revient à `/`.
- L'initialisation de l'authentification précède le montage des lectures métier : une session en
  cours de restauration ne doit jamais provoquer une première vague de requêtes anonymes.

### 9.2 Session limitée à l'onglet

La session Supabase est persistée dans **`sessionStorage`**, et nulle part ailleurs :

- un rechargement dans le même onglet conserve la session ;
- fermer l'onglet la supprime selon le contrat du navigateur ;
- aucun `localStorage`, cookie non essentiel ni traceur n'est ajouté ;
- si `sessionStorage` est indisponible, le client se replie sur une mémoire de processus : la
  connexion fonctionne, mais ne survit pas au rechargement ;
- le rafraîchissement automatique du jeton reste actif pendant la session, conformément au §3.5.
- le client détecte le fragment de session renvoyé par GoTrue après une invitation, une
  confirmation, une récupération ou un changement d'adresse ; `supabase-js` valide l'utilisateur,
  retire immédiatement les jetons de l'URL, puis écrit la session dans ce même `sessionStorage`
  — jamais dans `localStorage` (`detectSessionInUrl: true`, décision 273).

Ce choix relève de la catégorie 2 de `CLAUDE.md` §11 : préférence et état nécessaires limités à
la session, sans consentement supplémentaire. Il referme l'arbitrage d'INC-022 sans adopter la
persistance transverse que le défaut de `supabase-js` aurait placée dans `localStorage`.

### 9.3 États, erreurs et accessibilité

- Pendant la restauration initiale, un état de chargement sémantique est annoncé ; aucun contenu
  métier trompeur n'est rendu dessous.
- Les deux champs possèdent un libellé visible, `autocomplete="email"` et
  `autocomplete="current-password"`. Le formulaire se soumet au clavier.
- L'action est désactivée pendant l'envoi et ne peut pas ouvrir deux connexions concurrentes.
- `invalid_credentials`, une adresse inconnue et tout autre refus d'identifiants rendent le **même
  message générique**. L'interface ne réintroduit pas l'énumération que GoTrue évite au §3.4.
- Une panne réseau est distinguée d'un refus : elle invite à réessayer sans prétendre que les
  identifiants sont faux. Le mot de passe reste dans le champ pour cette reprise, mais n'est jamais
  journalisé ni copié ailleurs.
- L'erreur est portée par `role="alert"`, associée au formulaire, et le focus revient sur le champ
  email après un refus.

### 9.4 Profil et déconnexion

Une session ouverte ajoute dans l'en-tête le nom et l'avatar du profil courant ainsi que l'action
« Se déconnecter ». Le profil vient de `profiles`, lu une fois après restauration de la session ;
l'adresse GoTrue reste l'infobulle de l'identité et le repli si le profil manque. Sous le petit
palier, le nom peut être tronqué mais l'action reste complète et l'avatar garde son nom accessible.

La déconnexion appelle le véritable `signOut` de GoTrue, vide la session d'onglet, puis mène à
`/connexion`. Un échec est annoncé ; l'interface ne prétend pas que la session est fermée tant que
le client ne l'a pas confirmé.

### 9.5 Preuves qui rendent enfin les actions opposables

| Niveau | Preuve exigée |
|---|---|
| Unitaire | stockage limité à `sessionStorage`, repli mémoire, états de session, message générique, double soumission empêchée |
| E2E UI réel | mauvais mot de passe refusé ; compte seedé connecté depuis le formulaire ; rechargement conservant la session ; déconnexion ramenant à `/connexion` |
| Parcours utilisateur réel | après connexion par l'écran, lecture des tracks et channels seedés **sans substitution réseau**, publication d'un commentaire et déplacement d'une card par le menu du board ; effet relu directement par l'API |
| Autorisations | le même geste avec le `viewer` est refusé par le backend ; l'interface rend ce refus sans perdre la saisie ou l'état précédent |
| Email reçu comme un utilisateur | invitation créée par l'API d'administration, puis boîte Inbucket ouverte dans Chromium ; le destinataire sélectionne le message, lit sujet, phrase et code français dans son corps rendu, et active le lien avec la souris ; GoTrue confirme l'invitation et ouvre la session |
| Visuel | écran de connexion et produit chargé observés aux quatre paliers ; erreurs, focus, textes longs et absence de débordement vérifiés |

Les données créées par une preuve sont identifiées par un jeton propre au scénario et supprimées
en sortie. Une preuve de déplacement crée sa propre card : elle ne déplace jamais une card du seed,
dont la stabilité appartient à `CRM-046`.

**Résultat rejoué.** `scripts/verify-auth.sh` rend **62/62** ; la suite ciblée
`e2e/ui/authentification.spec.ts` rend **8/8**, et la suite UI complète **144/144**. Le parcours
destinataire part de l'interface Inbucket, active réellement le lien, constate la session GoTrue,
une URL nettoyée, `localStorage` vide et le jeton dans `sessionStorage`. La console navigateur ne
contient ni avertissement, ni erreur, ni `pageerror`.

### 9.6 Hors périmètre inchangé

- L'invitation depuis le produit reste ouverte en INC-015 : la webapp ne reçoit jamais la clé de
  service.
- La récupération de mot de passe reste prouvée hors interface au §7 ; cette extension ne crée
  pas un demi-parcours dont le lien de retour ne saurait pas encore définir le nouveau mot de
  passe.
- Les politiques de `profiles`, `workspaces` et `workspace_members` sont livrées par `CRM-022`.
  L'invitation et l'écran d'administration des membres restent distincts, à `CRM-070`.

---

## 10. Connexion unique par `oauth.lelabs.tech` — `CRM-091`

Contrat écrit le 2026-09-23 **avant la première ligne de code**, après les mesures M1 à M11 de
`docs/JOURNAL.md`, décision 568. Il met en œuvre `docs/SSO.md`, contrat publié par le fournisseur,
versé au dépôt.

### 10.1 Principe

GoTrue reste **l'unique émetteur** des jetons du produit (§1). Le SSO ne fait que **prouver une
identité** à GoTrue, qui décide seul d'ouvrir une session.

La voie `GET /auth/v1/authorize?provider=keycloak` est **inutilisable** : GoTrue 2.189.0 n'envoie
aucun `code_challenge` (M1), et le realm `lelabs` refuse toute demande sans PKCE (M2). Le client OIDC
est donc la **webapp** :

1. la webapp mène le **code d'autorisation avec PKCE `S256`** et un `nonce`, en client **public** ;
2. elle échange le code chez Keycloak, garde l'`id_token` **en mémoire** le temps d'un appel ;
3. elle le remet à GoTrue par `POST /auth/v1/token?grant_type=id_token`, fournisseur `keycloak`,
   avec le nonce **brut** ;
4. **GoTrue** vérifie signature, émetteur, audience et nonce, puis applique la règle d'accès du
   §10.6 et ouvre — ou refuse — la session.

Le navigateur ne décide d'aucune autorisation : il transporte une preuve que le serveur vérifie.

### 10.2 Configuration

| Variable | Consommateur | Rôle |
|---|---|---|
| `SSO_OIDC_ISSUER` | `auth` (`GOTRUE_EXTERNAL_KEYCLOAK_URL`) et webapp (`VITE_SSO_ISSUER`, au build) | Émetteur **exact** attendu dans les jetons. `https://oauth.lelabs.tech/realms/lelabs` en production |
| `SSO_OIDC_CLIENT_ID` | `auth` (`GOTRUE_EXTERNAL_KEYCLOAK_CLIENT_ID`) et webapp (`VITE_SSO_CLIENT_ID`, au build) | Identifiant du client **réellement créé** par le realm (§10.8) ; seule audience acceptée (M8) |

`GOTRUE_EXTERNAL_KEYCLOAK_ENABLED` vaut `true`. **Aucun secret client ni aucune URL de retour
GoTrue n'est configuré** : le client est public, et leur absence ferme d'elle-même la voie sans PKCE
(M9, `400 missing OAuth secret`). `DISABLE_SIGNUP` reste `true` (§2), et c'est lui qui porte le refus
du §10.6.

Côté webapp, les deux `VITE_SSO_*` sont figées au build comme les `VITE_SUPABASE_*`. Absentes, le
bouton du §10.3 **n'est pas rendu** : l'écran de connexion reste celui du §9, sans action morte.

### 10.3 Parcours

1. **`/connexion`** porte, sous le formulaire, un séparateur « ou » et l'action secondaire
   **« Se connecter avec LeLabs »**. Le formulaire par mot de passe est conservé (décision 568).
2. **Au clic**, la webapp lit la découverte `${issuer}/.well-known/openid-configuration`, exige que
   son `issuer` soit **égal** à celui configuré, et en prend `authorization_endpoint` et
   `token_endpoint` — jamais d'URL recopiée à la main, comme `docs/SSO.md` le demande.
3. Elle tire, par `crypto.getRandomValues` : un **vérificateur** PKCE (32 octets, base64url), un
   **`state`** (16 octets) et un **nonce brut** (16 octets). Le défi est
   `base64url(SHA-256(vérificateur))` ; le nonce **envoyé** à Keycloak est `hex(SHA-256(nonce brut))`,
   le nonce **remis** à GoTrue est le brut (M7).
4. Elle enregistre la **transaction** — `state`, vérificateur, nonce brut, adresse de retour interne,
   URL de retour déclarée, point d'échange lu dans la découverte, échéance à dix minutes — puis
   navigue vers
   `authorization_endpoint?client_id&response_type=code&scope=openid email profile&redirect_uri&state&nonce&code_challenge&code_challenge_method=S256`.
5. Keycloak revient sur **`/auth/retour`**, route publique hors de la coquille, comme `/connexion`.
   La transaction est **retirée du stockage dès sa lecture** : elle ne sert qu'une fois, succès ou
   échec.
6. La webapp exige une transaction présente et non échue, un `state` identique, un `code` ; elle
   poste alors au `token_endpoint`, en formulaire, `grant_type=authorization_code`, `client_id`,
   `code`, `redirect_uri` et `code_verifier`. De la réponse, **seul l'`id_token` est lu** : le jeton
   d'accès et le jeton de rafraîchissement de Keycloak ne sont ni conservés ni réutilisés.
7. Elle appelle `signInWithIdToken({ provider: 'keycloak', token, nonce })`. En cas de succès, la
   session GoTrue est écrite dans le stockage d'onglet du §9.2 et l'utilisateur rejoint l'adresse de
   retour, passée par `cheminRetour` (§9.1) — jamais une adresse externe.
8. **L'URL de retour est remplacée**, jamais empilée : le `code` ne reste pas dans l'historique.
9. En cas d'échec, l'utilisateur revient sur `/connexion`, où le refus est rendu par le même
   emplacement `role="alert"` que les erreurs du §9.3.

### 10.4 Refus et erreurs — dictionnaire fermé

Aucun message du serveur n'est affiché (§9.3).

| Nature | Cause | Message |
|---|---|---|
| `sso_annule` | Keycloak rend `error=access_denied` | La connexion LeLabs a été annulée. |
| `sso_sans_compte` | GoTrue rend `422 signup_disabled` (M3, M5) | Aucun compte du CRM ne correspond à ce compte LeLabs. L'accès exige une invitation à la même adresse, vérifiée auprès de LeLabs. |
| `reseau` | découverte, jeton ou GoTrue injoignables, ou réponse `5xx` | Le message réseau du §9.3 |
| `sso_echec` | tout le reste : transaction absente ou échue, `state` différent, `code` absent, autre `error` de Keycloak, émetteur de la découverte différent, refus `4xx` du jeton ou de GoTrue (nonce, audience, signature) | La connexion LeLabs n'a pas abouti. Recommencez depuis cet écran. |

`sso_sans_compte` ne distingue **pas** « aucun compte » de « adresse non vérifiée » : GoTrue rend le
même refus aux deux (M3, M5), et le message nomme les deux conditions plutôt que d'en deviner une.

### 10.5 Stockage sur l'appareil

- La **transaction** vit dans `sessionStorage`, sous `p2enjoy-crm.sso.transaction` : catégorie 1 de
  `CLAUDE.md` §11, strictement nécessaire à l'aller-retour, bornée à l'onglet, retirée au retour et
  échue en dix minutes. Aucun `localStorage`, aucun cookie.
- Si `sessionStorage` est indisponible, le repli mémoire du §9.2 ne survit pas à la navigation vers
  Keycloak : le retour rend `sso_echec`, et la connexion par mot de passe reste possible. Aucune
  persistance de substitution n'est inventée.
- Les jetons Keycloak ne sont **jamais** écrits.

### 10.6 Règle d'accès — appliquée par GoTrue, côté serveur

Une connexion SSO ouvre une session **si et seulement si** :

- un compte CRM existe **à la même adresse**, invité ou actif ;
- **et** l'`id_token` atteste `email_verified = true`.

C'est ce que GoTrue fait sous `DISABLE_SIGNUP=true`, mesuré : aucun compte → `422` (M3) ; compte
confirmé → rattachement de l'identité `keycloak`, **sans second compte** (M4) ; adresse non vérifiée
→ `422`, **aucun rattachement** (M5) ; invitation non acceptée → session et compte confirmé (M6),
ce que prouvait déjà l'acceptation par le lien du courriel (§3.3).

**Aucun rôle du realm n'est lu** — ni `verified`, ni `admin` (décision 568). Les droits restent ceux
des tables d'appartenance (§1, règle 2) : un porteur d'`admin` du realm reste lecteur dans un espace
où il est lecteur.

**La déconnexion reste celle de GoTrue** (§3.6). Elle ferme la session du CRM, pas celle du SSO :
c'est l'objet d'un SSO (`docs/SSO.md`, « Fermer une session »). Le manuel le dit à l'utilisateur.

### 10.7 Ce que GoTrue conserve

GoTrue recopie les revendications de l'`id_token` dans `auth.users.raw_user_meta_data` et
`auth.identities.identity_data`. Mesuré (M10) : nom, prénom, nom de famille, identifiant, adresse,
`email_verified`, émetteur, sujet — **ni téléphone, ni profil déclaré, ni rôle**. `docs/SSO.md`
interdit de recopier les deux premiers ; la conformité tient à la configuration du realm, et non à
ce dépôt. Elle est donc **prouvée** (§10.10) plutôt que supposée, et revérifiée en production après
la première connexion (`docs/PROD_MIGRATIONS.md`).

Le profil CRM (`public.profiles`) naît à la création du compte, par invitation : une connexion SSO
ultérieure ne le modifie pas.

### 10.8 Déclarer le client

Déclaration à remettre à un administrateur du realm, qui la colle dans
`https://oauth.lelabs.tech/verification/`, onglet **Intégrations** :

```
CLIENTID=lelabs-crm
NOM=P2Enjoy CRM
TYPE=navigateur
REDIRECT=https://crm.lelabs.tech/auth/retour
```

- `TYPE=navigateur` : client public, **sans secret** — il n'y a donc rien à poser comme secret.
- `ORIGINE` est omise : son défaut, l'origine des `REDIRECT`, est exactement l'origine qui appelle
  le `token_endpoint`.
- `DECONNEXION` est omise : le CRM ne déconnecte pas du SSO (§10.6).
- `ROLE` est omis : aucun rôle n'est lu (§10.6).
- Un seul domaine, sans `www` : la route de la cellule ne porte que `crm.lelabs.tech`.

**L'identifiant retenu par le service fait foi.** Le précédent de l'application « devis » montre qu'il
peut différer de celui déclaré. Il est reporté tel quel dans `SSO_OIDC_CLIENT_ID`.

**Sonde publique**, sans rien modifier :

```bash
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  'https://oauth.lelabs.tech/realms/lelabs/protocol/openid-connect/auth?client_id=lelabs-crm&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fcrm.lelabs.tech%2Fauth%2Fretour'
```

Attendu : `302` vers l'URL de retour avec `error_description=Missing+parameter%3A+code_challenge_method`.
Un `400` signifie que le client n'existe pas, ou que l'URL n'est pas celle enregistrée.

### 10.9 Développement

Le développement reste autonome (`CLAUDE.md` §3) : un service **`keycloak`** dans
`docker-compose.dev.yml`, image `quay.io/keycloak/keycloak:26.7.3` — la version du SSO réel —, realm
importé depuis **`keycloak/realm-lelabs.json`**.

- **L'émetteur est le même vu du navigateur et vu de GoTrue** (M11) : alias réseau `sso.localhost`,
  port `SSO_DEV_PORT` identique dedans et dehors, publié sur `127.0.0.1`. L'émetteur de développement
  est `http://sso.localhost:${SSO_DEV_PORT}/realms/lelabs`, et `./runDev.sh` refuse de démarrer si
  `SSO_OIDC_ISSUER` en diffère.
- Le realm reproduit ce qui se paierait au premier déploiement : chemin `/realms/lelabs`, rôles
  `verified` et `admin`, **PKCE `S256` imposé**, URL de retour **exactes**, vérification d'adresse
  exigée.
- Le client `lelabs-crm` a deux URL de retour exactes : `SITE_URL` + `/auth/retour`, injectée à
  l'import parce que l'origine du Vite de développement varie d'un poste à l'autre, et
  `http://127.0.0.1:4173/auth/retour`, l'origine du `vite preview` que le harnais Playwright sert
  (`keycloak/README.md`).
- Un second client public, `crm-audience-etrangere`, n'existe qu'ici : il sert à prouver le refus
  d'audience (M8).

| Compte du realm | État SSO | Compte CRM | Ce qu'il démontre |
|---|---|---|---|
| `admin@p2enjoy.test` | `verified` | administratrice du seed | le parcours nominal |
| `bizdev@p2enjoy.test` | **aucun rôle** | membre du seed | qu'aucun rôle n'est exigé |
| `viewer@p2enjoy.test` | `verified` + `admin` du realm | lectrice du seed | que l'`admin` du realm n'ouvre aucun droit du CRM |
| `inconnu@p2enjoy.test` | `verified` | **aucun** | le refus `sso_sans_compte` |
| `adresse-non-verifiee@p2enjoy.test` | aucun rôle, adresse **non vérifiée** | créé par la preuve | le refus de M5 |

Mot de passe commun des comptes du realm : `SsoDev2026Local`, publié comme celui des boîtes de
développement. L'administration de l'instance de développement emploie `SSO_DEV_ADMIN_PASSWORD`,
tiré au hasard par `./runDev.sh`.

### 10.10 Preuves exigées

| Niveau | Preuve |
|---|---|
| Unitaire | `webapp/src/lib/sso.test.ts` : défi PKCE contre le vecteur de la RFC 7636, annexe B ; nonce haché ; URL d'autorisation exacte ; transaction à usage unique, échue, `state` différent ; découverte d'un autre émetteur ; dictionnaire fermé du §10.4 ; configuration absente. Composants : bouton rendu seulement si configuré ; route de retour dans chacun de ses états |
| API, pile réelle | `e2e/api/sso.spec.ts`, Keycloak de développement et GoTrue derrière Kong : M2, M3, M4 (et **un seul** compte après deux connexions), M5, M6, M7, M8, M9, et M10 relu dans `auth.identities` |
| E2E | `e2e/ui/sso.spec.ts` : clic, **vraie page de connexion Keycloak**, retour, session dans `sessionStorage`, `localStorage` vide, transaction retirée, URL sans `code` ; `inconnu@` refusé avec son message ; annulation ; aucune erreur de console |
| Visuel | écran de connexion avec l'action SSO, et chacun des refus, aux quatre paliers |
| Production | sonde du §10.8, puis une connexion réelle et la relecture de `auth.identities` du §10.7 |

### 10.11 Hors périmètre

- La **déconnexion du SSO** depuis le CRM (§10.6).
- La lecture des **rôles** du realm (§10.6).
- `offline_access` : le CRM n'emploie pas le jeton de rafraîchissement de Keycloak.
- Un écran de **rattachement** manuel d'identités : GoTrue rattache à la première connexion (M4).
- Le retrait de la connexion par mot de passe : non demandé.
