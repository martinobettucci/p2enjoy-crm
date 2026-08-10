# Spécification — Authentification, sessions et cycle de vie des comptes

Unités de backlog : `CRM-009` (interface, session d'onglet et gabarits) et `CRM-011`
(mécanisme GoTrue ; voir `docs/BACKLOG.md`).
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
- **Aucune authentification à facteurs multiples, aucun fournisseur externe, aucun SSO.**

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
