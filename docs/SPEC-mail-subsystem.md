# Spécification — Sous-système de messagerie

Unités de backlog : `CRM-050` à `CRM-059` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §7, `docs/DAT.md` §3.3 et §4.3–4.4,
`docs/SPEC-permissions-rls.md`, `docs/DESIGN_SYSTEM.md` §5.4.

---

## 1. Intention

Chaque card possède une adresse email. Les messages qui y parviennent sont classés dans la card
avec leurs pièces jointes. Les utilisateurs travaillent depuis une **inbox intégrée** où les
Tracks, Channels et Cards apparaissent comme des dossiers imbriqués, et peuvent répondre depuis
la card ou depuis l'inbox.

Trois contraintes issues du fonctionnement réel de l'équipe :

1. **Entrant et sortant sont deux serveurs distincts.** Un business developer reçoit sur une
   boîte (par exemple Yahoo) et répond depuis une adresse interne (`@p2enjoy.studio`) dont les
   messages sont mirroités vers la première. Compte entrant et identité sortante sont donc des
   objets **indépendants**, configurés séparément.
2. **Un message classé dans une card reste dans l'inbox globale.** Le classement ajoute une
   appartenance, il ne retire rien.
3. **Les dossiers sont réellement créés côté IMAP**, pour que l'organisation soit visible depuis
   n'importe quel client mail, pas seulement dans le CRM.

## 2. Objets de configuration

### 2.1 Compte entrant (`mail_inbound_accounts`)

Lu en IMAP par `imap_worker`. Deux natures :

| `owner_id` | Nature | Usage |
|---|---|---|
| `NULL` | **Boîte système du workspace** | Catch-all du domaine des cards : reçoit tout ce qui est adressé à `c-xxxxxxxx@<inbound_domain>` |
| renseigné | **Boîte personnelle** | La boîte de réception de l'utilisateur, telle qu'il la consulte par ailleurs |

Paramètres : hôte, port, sécurité (`ssl`, `starttls`, `none`), identifiant, secret chiffré,
dossiers surveillés (par défaut `INBOX`), style de rangement (`folder` ou `label`), profondeur de
backfill, état de synchronisation.

### 2.2 Identité sortante (`mail_outbound_identities`)

Utilisée par `smtp_worker`. Paramètres : hôte, port, sécurité, identifiant, secret chiffré,
**adresse d'expédition affichée** (`from_address`), nom affiché, signature HTML, quota journalier,
indicateur d'identité par défaut.

Rien n'impose que `from_address` corresponde au compte entrant : c'est précisément le cas d'usage
décrit ci-dessus.

### 2.3 Secrets

Les mots de passe sont chiffrés via Supabase Vault ; la table ne stocke qu'une référence.
La colonne `secret_id` est **révoquée en lecture pour le rôle `authenticated`** : aucun chemin
PostgREST ne peut l'exposer. Seul `mail-sync`, avec le rôle `service_role`, déchiffre.

Les formulaires de configuration n'affichent jamais un secret enregistré ; ils proposent
« remplacer le mot de passe ». Le bouton « Tester la connexion » exerce le véritable chemin de
connexion et retourne un diagnostic assaini, sans identifiant ni trace de secret.

*Prérequis levé par `CRM-004`* : `supabase_vault` 0.3.1 est présente, installée et préchargée dans
l'image épinglée `supabase/postgres:17.6.1.136`. **Vault est retenu ; le repli `pgcrypto` est
abandonné** (`docs/JOURNAL.md`, décision 23 ; `docs/DAT.md` §8).

La mesure a montré une protection plus forte que prévu : le schéma `vault` est **entièrement**
hors de portée d'`anon` et d'`authenticated`, refusés dès l'accès au schéma. Le `REVOKE` sur
`secret_id` reste néanmoins exigé — il porte sur des tables du schéma `public`, que PostgREST
expose, et empêche un membre du workspace de lire la *référence* du secret d'un collègue.

*Contrainte d'exploitation à ne pas perdre de vue* : la clé racine de Vault vit hors de `PGDATA`.
Sa perte rend les secrets définitivement indéchiffrables — voir `docs/DAT.md` §10.

## 3. Adresse d'une card

`email_local_part` est généré à la création sous la forme `c-<8 caractères base32>` et unique
globalement. L'adresse complète est `<email_local_part>@<workspace.inbound_domain>`.

Le jeton aléatoire est délibéré : une adresse divulguée ne doit pas permettre d'énumérer les
autres cards. L'adresse n'est **pas** un secret pour autant — elle circule dans les emails — et
ne vaut donc jamais autorisation : un message reçu est archivé, il ne confère aucun droit et ne
déclenche aucune transition automatique.

## 4. Réception

### 4.1 Boucle de synchronisation

Pour chaque compte actif, `imap_worker` maintient une connexion IDLE et, à défaut, interroge à
intervalle régulier. L'état par dossier (`UIDVALIDITY` et dernier UID traité) est persisté, ce
qui évite de retraiter l'historique après un redémarrage. Un changement d'`UIDVALIDITY` force une
resynchronisation du dossier concerné.

### 4.2 Dédoublonnage

Un même message arrive fréquemment deux fois : dans la boîte système et dans la boîte
personnelle mirroir. La clé de dédoublonnage est `(workspace_id, rfc822_message_id)`.

Un message déjà connu n'est pas réinséré : seule une **occurrence** est ajoutée
(`mail_message_occurrences` : compte, dossier, UID). C'est ce qui permet à un message d'exister
simultanément dans l'inbox globale et dans une card.

**Messages sans `Message-ID`** — certains expéditeurs non conformes n'en fournissent pas. Empreinte
de repli retenue : `sha256(from_addr + date + subject + taille du corps)`, préfixée pour la
distinguer d'un identifiant véritable. Point signalé dans `docs/INCONSISTENCY_REPORT.md`.

### 4.3 Pièces jointes

Chaque pièce jointe est extraite, son type déterminé par **inspection du contenu** et non par
l'extension, son nom assaini, son empreinte `sha256` calculée, puis elle est déposée dans
Storage. Elle est ensuite soumise à ClamAV.

- `pending` : analyse en cours, non téléchargeable ;
- `clean` : disponible ;
- `infected` : conservée pour investigation, **jamais téléchargeable**, signalée dans la card ;
- `skipped` : analyse impossible (taille), traitée comme non téléchargeable.

Une taille maximale (`MAIL_MAX_ATTACHMENT_MB`) borne l'ingestion. Le dépassement est journalisé
et visible dans la card : la pièce jointe manquante ne disparaît jamais silencieusement.

### 4.4 Classement

Chaîne déterministe, arrêtée à la première règle satisfaite :

| # | Règle | Résultat |
|---|---|---|
| 1 | Une adresse de card figure dans `To`, `Cc` ou `Delivered-To` | Classement **certain**, `classification='auto'` |
| 2 | `In-Reply-To` ou `References` désigne un message déjà classé | Même card que le message parent |
| 3 | L'expéditeur est un contact rattaché à **exactement une** card active | **Suggestion**, message laissé non classé |
| 4 | Aucune règle ne s'applique | « Non classés » |

Les règles 1 et 2 classent ; la règle 3 **ne classe pas** : elle propose. Classer automatiquement
sur la seule foi d'un expéditeur produirait des rattachements faux et difficiles à détecter.

Le classement manuel (`classify_message`) est journalisé (`classified_by`) et écrit un
`card_event` de type `mail_received`.

### 4.5 Dossiers IMAP

Après classement, le worker s'assure de l'existence du chemin `CRM/<Track>/<Channel>/<Card>` sur
le compte concerné et y dépose une copie du message.

- **Dossiers imbriqués par défaut**, en respectant le délimiteur annoncé par le serveur.
- **Labels** lorsque la capacité `X-GM-EXT-1` est détectée (Gmail), le modèle de dossiers y étant
  inadapté.
- Les noms sont assainis (délimiteur du serveur, longueur, caractères interdits) ; la
  correspondance réelle est mémorisée dans `mail_folder_map`, car le chemin créé peut différer du
  nom souhaité.
- Un renommage de track, channel ou card **renomme** le dossier correspondant plutôt que d'en
  créer un nouveau.

Le worker ne supprime jamais un message de `INBOX` : il copie. Décider à la place de
l'utilisateur de retirer un message de sa boîte serait destructif.

## 5. Envoi

L'interface n'ouvre jamais de connexion SMTP. Elle appelle `queue_outbound_email(...)`, qui
insère une ligne dans `mail_outbox` après vérification des droits.

`smtp_worker` consomme la file :

1. sélection des messages `queued` dont `next_attempt_at` est échu, par ordre d'ancienneté ;
2. vérification du quota journalier de l'identité ;
3. composition : `From` = identité, **`Reply-To` = adresse de la card**, `In-Reply-To` et
   `References` renseignés lorsqu'il s'agit d'une réponse, signature de l'utilisateur ajoutée ;
4. envoi ; en cas d'échec, `attempts` incrémenté et `next_attempt_at` repoussé selon un backoff
   exponentiel borné, avec passage en `failed` au-delà du seuil ;
5. en cas de succès : statut `sent`, archivage du message envoyé dans `mail_messages`
   (`direction='outbound'`), dépôt dans le dossier de la card, écriture d'un `card_event`.

Le `Reply-To` pointant vers la card est le mécanisme qui ramène les réponses du destinataire dans
le CRM, quel que soit le serveur d'où l'utilisateur a écrit.

Composer depuis la card ou depuis l'inbox emprunte **le même chemin de code** : seule la card
sélectionnée diffère. Depuis l'inbox, l'utilisateur choisit la card par navigation
Track → Channel → Card ou en saisissant directement son identifiant.

## 6. Backfill

À la connexion d'une boîte, l'utilisateur choisit une profondeur d'import (`backfill_months`).
L'import s'exécute en tâche de fond, par lots, avec une progression visible, sans bloquer la
synchronisation courante. Les messages importés suivent la même chaîne de classement — les
règles 1 et 2 rattachent rétroactivement les fils déjà connus.

## 7. Résilience et supervision

- La file d'envoi est **persistante** : un SMTP indisponible repousse, ne perd pas.
- L'état de chaque compte (dernière synchronisation, dernier incident, messages en attente) est
  exposé dans l'interface.
- Un compte en erreur répétée passe en `error` et alerte son propriétaire, sans désactiver le
  reste du système.
- Si `mail-sync` est arrêté, le CRM reste pleinement utilisable ; l'interface indique que la
  messagerie est suspendue plutôt que d'afficher un état trompeur.

## 8. Confidentialité et journalisation

Ne sont **jamais** journalisés : mots de passe, secrets, jetons, en-têtes d'authentification,
corps de message, pièces jointes. Un message est identifié dans les journaux par son identifiant
interne et son `Message-ID`.

La correspondance de tiers étant une donnée personnelle, la rétention est configurable et la
purge documentée dans l'unité RGPD du backlog.

## 9. Vérification exigée

La messagerie ne peut pas être validée par des simulations : le développement utilise un vrai
serveur (Stalwart) et un webmail de contrôle (Roundcube).

| Niveau | Preuves attendues |
|---|---|
| pytest unitaire | Analyse MIME, assainissement des noms, empreinte de repli, calcul du backoff, composition des en-têtes de fil |
| pytest intégration | Contre un vrai Stalwart : connexion, IDLE, création de dossier imbriqué, dépôt, relecture |
| API | `secret_id` illisible par `authenticated` ; `queue_outbound_email` refusé sans droit sur la card ; pièce jointe `infected` non téléchargeable |
| E2E `mail` | Un email **réellement envoyé** vers l'adresse d'une card est ingéré, attaché à la card, visible dans l'inbox globale, et le dossier IMAP est constaté par un client IMAP dans le test ; réponse depuis la card reçue par le destinataire avec le bon `Reply-To` |
| Visuel | Inbox aux paliers responsive, message non classé et sa suggestion, état d'erreur de compte, dossiers imbriqués observés dans Roundcube |

## 10. Arbitrages du sous-système

1. **Bibliothèque IMAP Python — tranchée par `CRM-051`.** `IMAPClient` 3.1.0 est retenu pour son
   API orientée UID, son support d'IDLE, sa licence BSD-3-Clause, sa maintenance actuelle et son
   support déclaré de Python 3.13. Il n'entre dans l'image qu'avec son premier consommateur
   (`CRM-052` ou `CRM-054`) : choisir une dépendance n'autorise pas à l'embarquer avant usage.
   Toute connexion TLS future construit explicitement un contexte vérifiant certificat et nom
   d'hôte ; elle ne s'en remet jamais à un défaut implicite de bibliothèque.
2. **OAuth2 Gmail / Microsoft 365 — limite v1 confirmée.** Les organisations qui imposent OAuth
   ne pourront pas connecter leur boîte en v1. Aucun faux écran ni secret OAuth dormant n'est
   livré avant une unité dédiée.
3. **Empreinte de repli — tranchée par la décision 297.** Sans `Message-ID`, l'identifiant est
   préfixé `fallback-sha256:` et dérivé de l'enveloppe, des en-têtes et du MIME brut canonisés.
   `CRM-054` en fixera et éprouvera la canonisation exacte.
4. **Anti-usurpation — tranchée par la décision 297.** Un expéditeur inconnu est accepté afin de
   ne pas perdre une sollicitation légitime, mais placé en quarantaine fonctionnelle : il ne
   déclenche ni classement, ni automatisation, ni transition tant qu'un utilisateur ne l'a pas
   qualifié.

---

## 11. Infrastructure de messagerie de développement — `CRM-050`

Écrite **après mesure** sur la pile réellement exécutée le 2026-08-07, et non d'après la
documentation des images retenues. Chaque paragraphe intitulé « Mesuré » rapporte une sortie de
commande obtenue sur cet hôte ; les pièges nommés au §11.4 ont tous été rencontrés avant d'être
écrits.

Unité de backlog : **`CRM-050`** (`docs/BACKLOG.md`, chunk 4).
Documents liés : `docs/DAT.md` §3.3, §3.4, §3.6 et §3.7, `README.md` §6 et §9,
`docs/SPEC-seed.md` §4 (identifiants stables), `docs/PROD_MIGRATIONS.md` §4.

### 11.1 Ce que l'unité livre, et ce qu'elle ne livre pas

`CRM-050` livre **le monde extérieur** dont la messagerie a besoin pour être vérifiable : un vrai
serveur IMAP/SMTP, un webmail de contrôle, un antivirus, et des boîtes réellement créées. Elle ne
livre **aucun consommateur** : ni `mail-sync` (`CRM-051`), ni ingestion (`CRM-054`), ni écran
(`CRM-057`).

La distinction gouverne la Definition of Done. Une preuve de cette unité exerce le **protocole** —
un client IMAP se connecte, un client SMTP dépose, un client `clamd` fait analyser — jamais un
comportement produit, qui n'existe pas encore. Fabriquer ici un embryon de `mail-sync` pour avoir
quelque chose à tester préempterait `CRM-051` et gonflerait l'unité au-delà de son énoncé
(`CLAUDE.md` §1).

| Livré par `CRM-050` | Attendu d'une unité ultérieure |
|---|---|
| Stalwart, ses domaines et ses trois boîtes | Comptes entrants configurés dans le CRM (`CRM-052`) |
| Roundcube, connecté à Stalwart | Inbox globale du produit (`CRM-057`) |
| ClamAV, joignable et doté de ses signatures | Analyse des pièces jointes (`CRM-054`) |
| Projet Playwright `mail` et ses scénarios de connexion | Aller-retour d'email complet (`CRM-054`, `CRM-058`) |
| Inbucket **conservé** pour les emails transactionnels | — |

**Inbucket n'est pas remplacé.** Il reste le puits des emails transactionnels de GoTrue, et
`CRM-011` s'appuie sur lui. Les deux serveurs coexistent parce qu'ils ne servent pas le même
usage : Inbucket capture ce que la pile *envoie* et n'expose pas d'IMAP ; Stalwart est un serveur
que le produit devra *lire*. `README.md` §6 le dit déjà, et cette unité ne change pas ce partage.

### 11.2 Composants, images épinglées et placement

| Service | Image épinglée | Fichier Compose | Motif du placement |
|---|---|---|---|
| `stalwart` | `stalwartlabs/stalwart:v0.13.4` | `docker-compose.dev.yml` | La production utilise les serveurs des utilisateurs (`docs/DAT.md` §3.6) |
| `stalwart-init` | `curlimages/curl:8.16.0` | `docker-compose.dev.yml` | Provisionne les boîtes par la véritable API de gestion, puis s'arrête |
| `roundcube` | `roundcube/roundcubemail:1.6.11-apache` | `docker-compose.dev.yml` | Outil de contrôle du développement (`docs/DAT.md` §3.6) |
| `clamav` | `clamav/clamav:1.4.3` | `docker-compose.dev.yml` | Voir la décision ci-dessous |

**ClamAV est déclaré dans l'overlay de développement, et son déclaration de production est due à
`CRM-054`.** `docs/DAT.md` §3.6 ne le range pas parmi les composants exclusivement de
développement : c'est bien un composant de production. Mais son unique consommateur est
l'ingestion des pièces jointes, livrée par `CRM-054`. L'ajouter aujourd'hui à l'assemblage commun
imposerait à la production de démarrer et de tenir `healthy` un service qu'aucun autre service
n'appelle, et obligerait cette unité à rejouer les preuves de production de `CRM-002` pour un
changement dont aucun énoncé de backlog ne demande l'effet. Le service est donc déclaré là où il
est **exercé**, et son passage dans `docker-compose.yml` est inscrit comme opération due dans
`docs/PROD_MIGRATIONS.md` §4, sous l'unité qui l'appellera.

Aucune image n'est suivie par un tag mouvant (`docs/DAT.md` §3.7). `curlimages/curl` est la
quatrième image introduite par cette unité ; elle ne sert qu'à porter un client HTTP dans le
réseau interne, où aucun autre service n'en fournit — mesuré : l'image de Stalwart n'embarque ni
`curl` ni `wget`, et son `stalwart-cli` v0.13.4 n'expose **aucune** sous-commande de gestion de
compte.

### 11.3 Configuration de Stalwart

Le fichier `stalwart/config.toml` est **versionné et monté en lecture seule**. L'entrée par défaut
de l'image écrit une configuration au premier démarrage, avec un mot de passe d'administration
**tiré au hasard et imprimé dans les journaux** : ce comportement est incompatible avec un
environnement reproductible, et il est écarté en fournissant la configuration.

Les valeurs sensibles n'y figurent pas en clair : la configuration lit l'environnement par la
macro `%{env:VARIABLE}%`.

**Mesuré — les listeners doivent lier `0.0.0.0`, jamais `[::]`.** La configuration générée par
`--init` lie `[::]`. Sur un hôte dont le conteneur n'a pas d'IPv6, le serveur **s'arrête sans
écrire une seule ligne**, ni sur la sortie standard ni dans un fichier : `docker logs` rend le
vide, le conteneur reste `Up`, et aucun port n'est ouvert. C'est le piège le plus coûteux de
l'unité, et il ne se diagnostique par aucun message. Toutes les liaisons valent donc `0.0.0.0`.

**Mesuré — le traceur écrit sur la sortie standard, pas dans un fichier.** Le traceur `log`
généré par `--init` échoue avec `Failed to create log file … No such file or directory` tant que
le répertoire n'existe pas. Un traceur `stdout` est retenu : il rend les journaux à
`docker compose logs`, donc à `./runDev.sh --withLog stalwart`, ce qui est le comportement attendu
d'un service conteneurisé (`CLAUDE.md` §20).

**Le démarrage ne télécharge aucune console mouvante.** Le code source du tag exact `v0.13.4`
établit que, lorsque son blob est absent, Stalwart télécharge sans condition
`webadmin-oss.zip` depuis la release GitHub `latest`. Ce comportement rend le premier démarrage
dépendant du réseau, produit deux lignes `ERROR` derrière le proxy de la routine et contourne
l'épinglage du §3.7 du DAT. La console n'a aucun usage dans ce projet : Roundcube est l'outil de
vérification visuelle, et l'exploitation passe par `/api/*`.

`webadmin.resource` vise donc un **petit ZIP local versionné** qui ne contient qu'une page
explicative statique. Il est monté en lecture seule et importé par le mécanisme natif de Stalwart ;
aucun blob n'est écrit directement dans RocksDB. Le premier démarrage est ainsi identique avec ou
sans accès Internet, l'API de gestion reste disponible, et la racine HTTP dit explicitement que la
console est désactivée au lieu d'afficher un faux outil d'administration. Le bundle et son chemin
local font partie des invariants de `stalwart/config.test.ts` et de
`scripts/verify-mail-infra.sh`.

Listeners retenus, et rien de plus : `smtp` (remise, port 25), `submission` (soumission
authentifiée, port 587), `imap` (port 143), `http` (API de gestion, port 8080). Les variantes
implicitement chiffrées de la configuration générée — `submissions`, `imaptls`, `pop3s`, `https` —
et les protocoles inutilisés — `pop3`, `managesieve` — sont retirés : un port ouvert sans usage est
une surface, et un certificat auto-signé en développement complique chaque client sans rien
prouver.

**Aucun TLS en développement, et c'est un choix nommé.** `imap.auth.allow-plain-text` vaut `true`
et la soumission SMTP annonce `AUTH PLAIN LOGIN` en clair. Les ports ne sont publiés que sur
`DEV_BIND_ADDRESS` (`127.0.0.1` par défaut) : rien ne sort de l'hôte. En production, ce sont les
serveurs des utilisateurs qui portent le chiffrement, et `mail_inbound_accounts.security` en
décrit déjà les trois valeurs (§2.1). Ce choix ne relâche donc aucune règle de production.

**Ces réglages modifiables ne vivent pas dans le fichier local.** Stalwart `v0.13.4` avertit
explicitement lorsqu'une clé de sa base de configuration est aussi définie dans `config.toml`.
`session.auth.mechanisms` et `imap.auth.allow-plain-text` sont donc écrites de façon convergente
par `stalwart-init`, avec la véritable API `POST /api/settings`, puis activées par
`GET /api/reload` avant la création des boîtes. `session.auth.require` n'est pas écrit : la valeur
par défaut mesurée de cette version exige déjà l'authentification sur tout port différent de 25.
Le harnais relit les deux clés par l'API et les protocoles prouvent leur effet ; déplacer les lignes
sans ces deux preuves ne serait qu'effacer un avertissement.

**Aucune fausse signature de production n'est fabriquée.** La configuration par défaut de
Stalwart tente de sceller ARC et de signer DKIM chaque message soumis. Le développement local ne
possède volontairement aucune clé de domaine : inventer une clé jetable donnerait une preuve
trompeuse et ferait passer une configuration locale pour la politique de production. Le
provisionnement convergent écrit donc aussi `auth.arc.seal=false` et `auth.dkim.sign=false` par
l'API de réglages. Le verdict sur les journaux est rendu **après** la soumission SMTP, afin qu'un
retour de ces tentatives produise réellement un échec du harnais.

### 11.4 Domaines et boîtes de développement

Deux domaines sont déclarés, tous deux sous `.test`, TLD réservé par la RFC 2606 et non routable —
la même précaution que celle du seed socle (`docs/SPEC-seed.md` §2) :

| Domaine | Rôle |
|---|---|
| `crm.p2enjoy.test` | Domaine des adresses de cards, valeur de `workspaces.inbound_domain` du seed |
| `p2enjoy.test` | Domaine des adresses personnelles des comptes seedés |

Trois boîtes, qui sont exactement celles que l'énoncé de `CRM-050` demande — « boîte système et
deux boîtes personnelles » :

| Adresse | Nature (§2.1) | Compte du seed |
|---|---|---|
| `systeme@crm.p2enjoy.test` | Boîte **système** du workspace, `owner_id` `NULL` | — |
| `admin@p2enjoy.test` | Boîte personnelle | Camille Aubert, `admin` |
| `bizdev@p2enjoy.test` | Boîte personnelle | Driss Lemoine, `business_developer` |

**Farida Nowak (`viewer`) n'a pas de boîte, et c'est délibéré.** Un `viewer` lit ; il ne
correspond pas. Lui créer une boîte inutilisée donnerait à croire que le produit lui destine une
messagerie, ce qu'aucune spécification ne dit.

**Mesuré — la boîte système est un véritable catch-all.** L'adresse `@crm.p2enjoy.test`, inscrite
sans partie locale dans la liste `emails` du principal, capte tout le domaine. Un message soumis à
`c-abcd1234@crm.p2enjoy.test` — une adresse de card qui n'a jamais été déclarée — est accepté puis
relu dans `INBOX` de `systeme@crm.p2enjoy.test`. C'est le mécanisme exact que le §2.1 attend de la
boîte système.

**Mesuré — un principal sans rôle s'authentifie et ne peut rien faire.** Créé sans
`"roles":["user"]`, un compte valide bien ses identifiants — le serveur écrit
`Authentication successful` — puis **refuse la commande** : `Unauthorized access … "authenticate"`,
et le client reste sans réponse jusqu'à sa propre expiration. Aucun message d'erreur n'atteint le
client. Le provisionnement pose donc `roles: ["user"]` sur chaque boîte, et le harnais vérifie que
la connexion IMAP **aboutit**, pas seulement que le compte existe.

**Créées par le véritable mécanisme.** Le service `stalwart-init` appelle l'API de gestion de
Stalwart (`POST /api/principal`, authentification HTTP Basic avec l'administrateur de repli), comme
le ferait un exploitant. Aucune écriture directe dans la base RocksDB, aucune donnée fabriquée à la
main : c'est la règle de `CLAUDE.md` §8, appliquée à un serveur mail comme le seed socle l'applique
aux comptes Supabase.

**Convergent, comme le seed socle.** Le provisionnement se rejoue sans erreur ni doublon : un
principal déjà présent est mis à jour, jamais dupliqué ; l'API rend alors un conflit, que le script
reconnaît comme un état déjà atteint et non comme un échec. Un rejeu ne détruit aucun message.

**Mot de passe commun `SeedDev2026Local`**, celui du seed socle. Il ne protège rien : les adresses
sont sous `.test`, les ports ne sont ouverts que sur la boucle locale, et le serveur ne contient
que des messages de démonstration. Le publier dans `README.md` est délibéré, exactement comme pour
les comptes seedés (`docs/SPEC-seed.md` §2). Le mot de passe de **l'administrateur** de Stalwart,
lui, est tiré au hasard par `runDev.sh` au premier amorçage et n'est jamais versionné.

### 11.5 Roundcube

Webmail de contrôle, et **seul moyen de vérification visuelle** de la messagerie tant que l'inbox
du produit n'existe pas (`CRM-057`). Il se connecte à Stalwart par le réseau interne, en IMAP sur
143 et en soumission sur 587. Sa base est un SQLite interne : aucun schéma supplémentaire n'est
ajouté à PostgreSQL pour un outil de développement.

Sa Definition of Done est **d'afficher les boîtes** : une session ouverte avec les identifiants
d'une boîte seedée, et l'arborescence de dossiers rendue à l'écran. C'est ce que le scénario
d'interface vérifie, capture à l'appui.

### 11.6 ClamAV

`clamd` écoute sur 3310. **Mesuré — les signatures sont dans l'image**, et aucun téléchargement
n'est nécessaire pour que l'analyse fonctionne : `zPING` rend `PONG`, et un `zINSTREAM` portant la
chaîne de test EICAR rend `stream: Eicar-Test-Signature FOUND`. Le rafraîchissement par
`freshclam` reste tenté périodiquement et échoue sans conséquence lorsque le réseau est fermé ;
l'analyse continue avec la base embarquée.

La preuve retenue n'est donc **pas** la simple vivacité du service. Un `PONG` prouve qu'un
processus écoute, pas qu'il sait détecter. Le harnais exige la détection réelle d'EICAR, qui est le
seul contrôle capable de distinguer un antivirus opérant d'un antivirus sans base.

### 11.7 Variables d'environnement

Toutes documentées dans `.env.example` avec leur rôle, leur format, leur caractère obligatoire et
une valeur d'exemple non sensible (`CLAUDE.md` §3).

| Variable | Rôle | Format | Requise |
|---|---|---|---|
| `STALWART_IMAP_PORT` | Port IMAP publié sur l'hôte | entier 1-65535 | oui en développement |
| `STALWART_SMTP_PORT` | Port de **remise** SMTP publié (conteneur : 25) | entier 1-65535 | oui en développement |
| `STALWART_SUBMISSION_PORT` | Port de **soumission** authentifiée publié (conteneur : 587) | entier 1-65535 | oui en développement |
| `STALWART_ADMIN_PORT` | Port de l'API de gestion publié (conteneur : 8080) | entier 1-65535 | oui en développement |
| `STALWART_ADMIN_USER` | Administrateur de repli de Stalwart | chaîne | oui en développement |
| `STALWART_ADMIN_PASSWORD` | Son mot de passe, **tiré au hasard à l'amorçage** | chaîne | oui en développement |
| `STALWART_MAILBOX_PASSWORD` | Mot de passe commun des boîtes de développement | chaîne | oui en développement |
| `MAIL_DEV_PERSONAL_DOMAIN` | Domaine des adresses personnelles seedées | domaine | oui en développement |
| `ROUNDCUBE_PORT` | Port du webmail de contrôle | entier 1-65535 | oui en développement |
| `CLAMAV_PORT` | Port `clamd` publié sur l'hôte | entier 1-65535 | oui en développement |

**`CRM_INBOUND_DOMAIN` cesse d'être une variable sans consommateur.** Elle vaut désormais
`crm.p2enjoy.test` dans `.env.example`, et non plus `crm.exemple.tld` : c'est le domaine que
Stalwart déclare, et c'est celui que le seed écrit dans `workspaces.inbound_domain`. Les deux
valeurs divergeaient sans que rien ne les compare, parce qu'aucun service ne lisait la variable ;
à partir de cette unité, une divergence rendrait la boîte système inutile — le catch-all
n'accepterait pas les adresses que le produit génère. Le harnais compare les deux valeurs.

### 11.8 Ports et exposition

Publiés **uniquement** sur `DEV_BIND_ADDRESS`, comme tous les services de développement
(`README.md` §6) :

| Service | Hôte | Conteneur |
|---|---|---|
| Stalwart IMAP | `1143` | `143` |
| Stalwart SMTP (remise) | `1025` | `25` |
| Stalwart soumission | `1587` | `587` |
| Stalwart API de gestion | `8081` | `8080` |
| Roundcube | `8080` | `80` |
| ClamAV `clamd` | `3310` | `3310` |

Les ports 1143, 1025 et 8080 sont ceux que `README.md` §6 annonçait déjà avant la livraison ; ils
sont tenus.

### 11.9 Preuves exigées

| Niveau | Preuve | Fichier |
|---|---|---|
| Unitaire | Le fichier de configuration de Stalwart respecte les invariants mesurés : aucune liaison `[::]`, traceur `stdout`, aucun secret en clair, les quatre listeners attendus et pas d'autre | `stalwart/config.test.ts` |
| Intégration | Provisionnement convergent, principals réellement créés avec leur rôle, catch-all déclaré | `scripts/verify-mail-infra.sh` |
| Protocole | Connexion IMAP réelle sur les trois boîtes, `LIST` non vide, `SELECT INBOX` ; soumission SMTP authentifiée réelle, message remis dans la boîte système par le catch-all et relu par IMAP ; `clamd` détecte EICAR | `e2e/mail/*.spec.ts` (projet Playwright `mail`) |
| Refus | Un mot de passe faux est refusé ; l'API de gestion refuse une requête anonyme | `e2e/mail/*.spec.ts` |
| Visuel | Roundcube affiche les boîtes : session ouverte au clavier et à la souris, arborescence de dossiers rendue, captures observées et console nominale vide | `e2e/mail/roundcube.spec.ts` |

Le test unitaire porte sur le **seul artefact du dépôt qui contienne de la logique** : la
configuration de Stalwart. Il la lit et vérifie ses invariants, dont deux ont été payés par une
panne réelle (§11.3). Ce n'est pas un test de façade : une régression sur `[::]` rend la pile
silencieusement morte, et ce test est le seul contrôle capable de l'attraper sans démarrer la pile.
Il vit **à côté du fichier qu'il éprouve**, et non dans `webapp/src/` : le périmètre de Vitest est
étendu à `stalwart/` dans le même changement, plutôt que de ranger une preuve d'infrastructure
parmi celles de l'interface.

Les scénarios de protocole n'emploient **aucune bibliothèque IMAP ou SMTP**. Ils parlent le
protocole sur une socket TCP, avec le module `node:net`. Le motif est double : aucune dépendance
n'est ajoutée au dépôt pour une unité d'infrastructure (`CLAUDE.md` §19), et une preuve qui écrit
`a1 LOGIN` puis lit `a1 OK` prouve le serveur, là où une bibliothèque prouverait surtout
elle-même. À la clôture de `CRM-050`, le choix d'une bibliothèque IMAP restait donc correctement
réservé à `CRM-051` ; il est désormais tranché au §10 sans modifier ces preuves de protocole.

Le projet Playwright `mail`, annoncé par `README.md` §7 et laissé non déclaré par `CRM-008`
(`docs/INCONSISTENCY_REPORT.md` INC-023), est déclaré par cette unité. Il n'exige aucun
`webServer` : les scénarios de protocole parlent directement aux serveurs, tandis que les trois
scénarios Roundcube emploient Chromium pour exercer le véritable parcours utilisateur.

Le démarrage nominal fait lui aussi partie de la preuve : sur un volume Stalwart absent,
`./runDev.sh` doit sortir en succès, `postgres-meta` ne doit pas devenir `unhealthy` pendant sa
fenêtre d'initialisation, et les journaux de Stalwart ne doivent contenir ni `ERROR` ni `WARN`.
Avant de créer le moindre conteneur, le script refuse par ailleurs un profil de développement dont
`CRM_INBOUND_DOMAIN` diffère de `crm.p2enjoy.test`, valeur fixe du seed. Le contrôle tardif du
harnais reste présent comme défense en profondeur, mais il ne doit plus être le premier endroit où
un utilisateur apprend que sa boîte catch-all vise le mauvais domaine.

### 11.10 Limites nommées

- **Aucun consommateur applicatif.** Rien dans le CRM ne lit ces boîtes avant `CRM-052` et
  `CRM-054`. Les preuves de cette unité exercent des protocoles, pas un parcours produit.
- **Pas de console web de Stalwart.** La racine HTTP sert une page locale qui le dit ; la
  vérification visuelle passe par Roundcube, et l'exploitation par l'API de gestion (§11.3).
- **Aucun TLS**, par choix documenté au §11.3. Un environnement de développement exposé au-delà de
  la boucle locale exigerait de revenir sur ce choix.
- **ClamAV n'est pas déclaré en production** (§11.2) : opération due, inscrite dans
  `docs/PROD_MIGRATIONS.md` §4 sous `CRM-054`.
- **La base de signatures est celle de l'image.** Sur un réseau fermé, `freshclam` échoue et les
  signatures vieillissent avec l'image épinglée. C'est acceptable en développement ; la production
  devra prévoir le rafraîchissement (`docs/DAT.md` §14).

---

## 12. Socle du service `mail-sync` — `CRM-051`

### 12.1 Périmètre et runtime

`mail-sync` est un service Python commun aux assemblages de développement et de production. Il
est construit sur Python **3.13.13 slim-bookworm**, FastAPI **0.139.2**, Starlette **1.3.1**,
Uvicorn **0.51.0** et Pydantic Settings **2.14.2**. Les versions sont épinglées ; l'image finale s'exécute sans
privilège, avec système de fichiers en lecture seule, capacités Linux retirées et aucun port
publié sur l'hôte.

`CRM-051` livre le processus, sa configuration, ses journaux, sa santé, son API interne et la
preuve de reprise. Il ne prétend pas synchroniser un compte inexistant : `imap_worker` et
`smtp_worker` apparaissent dans l'état `waiting_for_configuration`, jusqu'à `CRM-052` à
`CRM-054` et `CRM-058`. Aucun ordonnanceur ne revient dans le service : décision 261.

Le conteneur ne reçoit pas encore `SERVICE_ROLE_KEY`. Le principe de moindre privilège interdit
de remettre une clé qui contourne la RLS à un processus qui n'appelle pas encore PostgreSQL. Son
ajout appartiendra à la première unité qui consomme réellement une table mail.

### 12.2 Configuration

Toute configuration vient de l'environnement et est validée avant l'écoute :

| Variable | Contrat |
|---|---|
| `P2ENJOY_ENV_PROFILE` | `dev` ou `prod`, obligatoire |
| `MAIL_SYNC_INTERNAL_TOKEN` | secret dédié, obligatoire, au moins 32 caractères ; jamais journalisé |
| `MAIL_SYNC_LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING`, `ERROR` ou `CRITICAL`, défaut `INFO` |
| `MAIL_SYNC_HOST` | adresse interne d'écoute, fixée à `0.0.0.0` par Compose |
| `MAIL_SYNC_PORT` | port interne, fixé à `8080` par Compose |
| `MAIL_SYNC_STATE_PATH` | fichier d'état, fixé à `/var/lib/p2enjoy-mail-sync/runtime.json` par Compose |

Le développement amorce le token avec les autres secrets, y compris sur un `.env` créé avant
`CRM-051` (`env_ensure_dev_completions`). La production refuse toute valeur gabarit.

Une erreur de configuration termine le processus avant sa disponibilité et **sans révéler la
valeur fautive**. `ValidationError` reproduisant l'entrée dans son texte comme dans sa trace, le
chargement passe par `load_settings`, qui ne conserve que le nom de la variable et la règle
enfreinte, et lève son refus hors du gestionnaire d'exception — `from None` masquerait l'affichage
de la cause, mais la laisserait sur `__context__`. Le point d'entrée journalise une unique ligne
`CRITICAL` `configuration_rejected`, puis rend le code de sortie `78` (`EX_CONFIG`) : aucune
socket n'est ouverte, aucun état n'est créé. Décision 313.

### 12.3 Santé et API interne

Seuls `GET /health/live` et `GET /health/ready` sont sans authentification. Ils ne renvoient ni
configuration, ni secret ; `ready` n'est positif qu'après ouverture synchrone d'un état local
valide, avant que le processus ne commence à écouter. Le service n'ouvre aucune ressource
asynchrone à ce stade : il n'ajoute donc pas un lifespan applicatif artificiel.

`GET /internal/v1/status` exige `Authorization: Bearer <MAIL_SYNC_INTERNAL_TOKEN>` et renvoie :
version de service, profil, identifiant et compteur de démarrage, version du schéma d'état, puis
état des workers IMAP/SMTP. Jeton absent, mal formé ou faux donnent le même `401` générique.

Le développement ajoute `GET` et `PUT /internal/v1/dev/checkpoint`. Le `PUT` n'accepte qu'un UUID
et le persiste ; le `GET` le relit. Ces routes rendent `404` en production, même avec le bon
jeton. Elles ne sont pas un stockage métier : elles donnent à la DoD une preuve observable de
continuité via la véritable API du conteneur.

Chaque réponse porte `X-Request-ID`, `Cache-Control: no-store` et
`X-Content-Type-Options: nosniff`. Un identifiant appelant n'est repris que s'il respecte le
format borné du service. Les corps sont bornés et les modèles refusent les propriétés inconnues.

### 12.4 État durable et reprise

Un volume nommé porte un JSON opérationnel versionné : `schema_version`, `boot_count`,
`boot_id` et le checkpoint de développement facultatif. L'écriture passe par un fichier
temporaire dans le même répertoire, `fsync`, remplacement atomique puis synchronisation du
répertoire. Un état illisible, tronqué ou d'une version inconnue fait échouer le démarrage ; il
n'est jamais effacé silencieusement.

Cet état ne contient **jamais** message, pièce jointe, secret, jeton, UID IMAP, file SMTP ni donnée
utilisateur. La progression métier future reste dans PostgreSQL et Storage, conformément au §10
de la DAT.

La preuve de reprise écrit un UUID par l'API interne, relève `boot_count` et `boot_id`, exécute
`docker compose stop mail-sync` puis `docker compose start mail-sync`, attend la santé, et exige
le même UUID, un compteur incrémenté d'une unité et un nouvel identifiant de démarrage.

### 12.5 Journaux et refus

Chaque ligne de journal est un objet JSON autonome en UTC, avec au minimum `timestamp`, `level`,
`service` et `event`; une requête ajoute son `correlation_id`, sa méthode, son chemin et son code
de réponse. Les journaux Uvicorn empruntent le même format et l'accès HTTP natif redondant est
désactivé.

Ne sont jamais journalisés : en-têtes HTTP, jetons, secrets, paramètres de configuration, corps
de requête ou données utilisateur. L'application journalise l'état ouvert ; Uvicorn journalise
son propre démarrage et son arrêt dans le même format. Le nominal — démarrage, santé, statut,
checkpoint, arrêt et redémarrage — ne produit aucune ligne de niveau `WARNING` ou supérieur.

### 12.6 Preuves de l'unité

- `pytest mail-sync/tests`, avec le `TestClient` Starlette 1.3.1 et HTTPX2 2.7.0, éprouve
  configuration, refus sans fuite, autorisation constante, routes dev/prod,
  en-têtes, bornes, JSONL, écritures atomiques et refus d'un état corrompu ;
- `scripts/verify-mail-sync.sh` réunit ces preuves sur la pile réelle, et sa `--contre-epreuve`
  exige que les gardes mordent ; `e2e/mail/mail-sync.spec.ts` exerce le service par le réseau
  Compose, seul chemin d'accès existant ;
- la construction de l'image et son exécution comme utilisateur non privilégié sont contrôlées ;
- la santé et l'API sont appelées par le réseau interne, sans publier le port ;
- la séquence d'arrêt/redémarrage du §12.4 prouve la conservation réelle de l'état ;
- les journaux nominaux sont relus et doivent être du JSON valide sans secret, avertissement ni
  erreur.

---

## 13. Comptes entrants IMAP — `CRM-052`

Écrit **après mesure** sur la pile réellement exécutée le 2026-08-10, et non d'après la
documentation des outils retenus. Chaque paragraphe intitulé « Mesuré » rapporte une sortie de
commande obtenue sur cet hôte.

### 13.1 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré :

- la table `mail_inbound_accounts`, ses politiques, ses privilèges de colonne et ses contraintes ;
- le **chemin d'écriture du secret**, qui passe par Vault sans jamais exposer ni le mot de passe
  ni sa référence à un client PostgREST ;
- le **test de connexion réel** : `mail-sync` ouvre une véritable session IMAP vers le serveur
  déclaré, avec le mot de passe déchiffré, et écrit le résultat dans l'état du compte ;
- l'**état de synchronisation** de premier niveau : `status`, `last_error`, `last_checked_at` ;
- le seed des trois comptes de développement, posés par le **véritable chemin d'écriture** ;
- les preuves de refus n° 6 et n° 7 de `docs/SPEC-permissions-rls.md` §7, jusque-là non
  satisfaisables faute de table.

**Non livré, et nommé plutôt que suggéré** : aucun écran de configuration. Le §2.3 décrit des
formulaires — « ils proposent *remplacer le mot de passe* », « le bouton *Tester la connexion* » —
qu'aucune unité du backlog ne porte aujourd'hui. Les inventer ici ferait porter à `CRM-052` une
surface que le plan n'a pas ordonnée, et qui appartient au chunk 4 côté interface (`CRM-057` pour
l'inbox, une unité de réglages restant à créer). Le geste existe donc **par l'API interne du
service**, comme l'exploitant l'exercera, et l'écart est écrit ici et dans le manuel.

Ni IDLE, ni analyse MIME, ni dossiers, ni backfill : `CRM-054` et `CRM-056`. Les colonnes que ces
unités consommeront — `watch_folders`, `folder_style`, `sync_state`, `backfill_months` — sont
créées ici parce que `docs/SCHEMA.md` les déclare sur cette table, et laissées à leur valeur par
défaut. Une colonne créée sans consommateur est nommée comme telle ; l'omettre obligerait `CRM-054`
à migrer la table qu'il lit.

### 13.2 Modèle

La table suit `docs/SCHEMA.md` §12, avec trois précisions que la mesure impose.

**`owner_id` distingue deux natures, et la contrainte d'unicité le suit.** Une boîte système par
workspace — `owner_id IS NULL` — et une boîte personnelle par couple `(workspace_id, owner_id)`.
Deux index uniques partiels le tiennent : un `UNIQUE (workspace_id) WHERE owner_id IS NULL`, un
`UNIQUE (workspace_id, owner_id) WHERE owner_id IS NOT NULL`. Sans le premier, deux catch-all
concurrents liraient le même domaine et dédoubleraient chaque message ; sans le second, un
utilisateur porterait deux boîtes personnelles dont rien ne dirait laquelle `CRM-054` doit lire.

**`last_checked_at` est ajoutée à ce que `docs/SCHEMA.md` §12 déclarait.** `last_sync_at` répond à
« quand ai-je lu des messages », question que seule `CRM-054` pourra renseigner ; « quand la
connexion a-t-elle été éprouvée » est une autre question, et c'est celle que cette unité sait
répondre. Les confondre ferait croire à une synchronisation qui n'a pas eu lieu. `docs/SCHEMA.md`
est corrigé dans le même changement.

**`status` a quatre valeurs et une seule origine.** `pending` à la création, puis `ok` ou `error`
selon le test de connexion, `disabled` par une décision d'exploitation. Le client ne les écrit
jamais : la colonne est fermée en écriture à `authenticated`, comme `last_error`,
`last_checked_at`, `last_sync_at`, `sync_state` et `secret_id`. C'est la règle du §4.4 de
`docs/SPEC-permissions-rls.md` appliquée à une table neuve : une colonne dont la valeur est un
**constat du serveur** n'est pas offerte au client.

### 13.3 Le secret ne traverse jamais PostgREST en clair, et sa référence ne le traverse jamais du tout

**Mesuré** — `authenticated` est refusé **dès le schéma** : `select vault.create_secret('x','y','z')`
rend `ERROR: permission denied for schema vault`. Un client ne peut donc ni écrire ni lire un
secret, quelle que soit la politique de la table.

**Mesuré** — `service_role` a `USAGE` sur le schéma `vault` et `SELECT` sur `vault.secrets` comme
sur `vault.decrypted_secrets`. Le déchiffrement est donc possible pour le service, et pour lui
seul.

**Mesuré** — un aller-retour complet fonctionne : `vault.create_secret` rend un `uuid`,
`vault.decrypted_secrets` rend le texte d'origine, et `vault.secrets.secret` porte un chiffré sans
rapport visible avec l'entrée.

L'écriture passe donc par **une fonction `SECURITY DEFINER`**, `app.upsert_mail_inbound_account`,
et par elle seule :

- elle vérifie le droit de l'appelant **avant** de créer le secret — administrateur du workspace
  pour la boîte système, administrateur ou l'intéressé lui-même pour une boîte personnelle ;
- elle appelle `vault.create_secret` ou `vault.update_secret` selon qu'un secret existe déjà ;
- elle **ne rend jamais** `secret_id` : sa valeur de retour est l'identifiant du compte ;
- un mot de passe vide ou absent lors d'une mise à jour **conserve** le secret existant. C'est ce
  que le §2.3 appelle « remplacer le mot de passe » : ne pas le remplacer est le cas ordinaire, et
  obliger à le ressaisir pour changer un port ferait ressaisir un secret sans raison.

`INSERT` et `UPDATE` directs sur la table restent **refusés à `authenticated`** : aucune politique
ne les ouvre. Une table de configuration dont un seul chemin d'écriture est correct ne doit pas en
offrir deux, et le contrôle du droit vit dans la fonction, en base — pas dans l'interface
(`CLAUDE.md` §10).

### 13.4 Qui lit quoi

| Profil | Boîte système du workspace | Sa propre boîte | La boîte d'un collègue |
|---|---|---|---|
| Administrateur du workspace | lit | lit | lit |
| Membre non administrateur | **aucune ligne** | lit | **aucune ligne** |
| Anonyme | aucune ligne | — | aucune ligne |

La boîte système est un objet d'exploitation : y donner accès à tout membre reviendrait à publier
la configuration de réception du domaine des cards. La boîte d'un collègue est sa correspondance :
c'est la preuve de refus n° 7, et elle est ici **acquise** au lieu d'être figée.

`secret_id` reste **révoquée en lecture** pour `authenticated` sur toutes les lignes, y compris
celles que l'appelant a le droit de lire — preuve de refus n° 6. La révocation est un privilège de
colonne, pas une politique : elle ne dépend d'aucune ligne et ne peut pas être contournée par un
`select` bien choisi.

### 13.5 Le test de connexion

`mail-sync` reçoit une route interne, protégée par le même jeton que le reste de son API interne
(`§12.3`) :

```
POST /internal/v1/inbound-accounts/{id}/test
```

Elle exécute, dans cet ordre : lecture du compte et du secret déchiffré par une fonction
`SECURITY DEFINER` réservée à `service_role`, ouverture d'une session IMAP réelle vers l'hôte
déclaré, `LOGIN`, `LIST`, `LOGOUT`, puis écriture de `status`, `last_error` et `last_checked_at`.

Le service atteint PostgreSQL **par PostgREST**, avec `SERVICE_ROLE_KEY` — la clé que le §12.1
réservait à « la première unité qui consomme réellement une table mail », et c'est celle-ci. Le
schéma `vault` n'étant pas exposé par PostgREST, le déchiffrement passe par la fonction
`app.mail_inbound_account_credentials`, `SECURITY DEFINER`, dont l'exécution est **révoquée à
`public`, `anon` et `authenticated`** et accordée au seul `service_role`. C'est la seule voie par
laquelle un mot de passe sort de la base, et elle est éprouvée dans les deux sens : elle rend le
secret au service, elle est refusée à tout le reste.

**La vérification TLS n'a aucun mode dégradé.** Le contexte est construit par
`ssl.create_default_context()`, qui vérifie certificat et nom d'hôte — l'arbitrage n° 1 du §10
l'exige, et aucun paramètre du produit ne permet de le désactiver.

### 13.6 Ce que le développement peut prouver, et ce qu'il ne peut pas

**Mesuré**, depuis le réseau Compose, contre le Stalwart de `CRM-050` :

| Tentative | Résultat mesuré |
|---|---|
| `LOGIN` en clair sur 143, bon mot de passe | **succès**, `LIST` rend `INBOX`, `Drafts`, `Junk Mail`, `Deleted Items` |
| `LOGIN` en clair sur 143, mauvais mot de passe | `[AUTHENTICATIONFAILED] Authentication failed` |
| `LOGIN` en clair sur 143, **compte inexistant** | **le même** `[AUTHENTICATIONFAILED] Authentication failed` |
| `STARTTLS` avec vérification stricte | `SSLCertVerificationError … self-signed certificate` |
| `IMAPS` implicite sur 993 | `ConnectionRefusedError` — aucun listener 993 n'est déclaré (`stalwart/config.toml`) |
| Hôte inconnu | `gaierror … Name or service not known` |

Trois conséquences, écrites plutôt que contournées :

1. **Le seed emploie `imap_security = 'none'`**, et c'est le seul mode que la pile locale peut
   prouver en succès. Ce n'est pas une faiblesse du produit : c'est un certificat auto-signé sur un
   domaine `.test`, et le produit refuse à raison de lui faire confiance.
2. **`starttls` est prouvé en REFUS**, avec sa cause TLS nommée. Un mode de sécurité qui échouerait
   silencieusement serait pire qu'un mode absent.
3. **`ssl` n'est pas prouvable localement** faute de listener, et l'absence est figée par une
   assertion qui devra tomber le jour où un listener 993 existera — jamais par un commentaire.

Le serveur ne distingue pas un mot de passe faux d'un compte inconnu. C'est une propriété de
discrétion, et le produit ne la défait pas : les deux cas rendent le même code.

### 13.7 Le message d'erreur est un CODE, jamais le texte du serveur

`last_error` ne porte pas la phrase renvoyée par le serveur distant. Elle porte l'une des valeurs
suivantes, et rien d'autre :

| Code | Cause |
|---|---|
| `auth_failed` | Identifiants refusés — mot de passe faux **ou** compte inconnu, le serveur ne les distinguant pas |
| `host_unreachable` | Le nom d'hôte ne se résout pas |
| `connection_refused` | Rien n'écoute sur l'hôte et le port déclarés |
| `tls_failed` | Le certificat ou le nom d'hôte ne sont pas vérifiables |
| `timeout` | Le serveur n'a pas répondu dans le délai imparti |
| `protocol_error` | Le serveur a répondu, mais pas comme un serveur IMAP — **et tout ce qu'aucune des cinq causes précédentes n'explique** |

`protocol_error` est donc le **repli nommé**, et il l'est délibérément. Un repli silencieux
laisserait une panne sans cause ; le confondre avec `auth_failed` ferait ressaisir un mot de passe
correct. Nommer « je ne sais pas » est une réponse ; le déguiser en « votre mot de passe est faux »
n'en est pas une.

Motif, et il n'est pas théorique : le texte d'un serveur distant est une entrée non maîtrisée. Il
peut contenir l'identifiant essayé, un nom d'hôte interne, un numéro de ticket, une adresse IP —
et il finirait dans une table lue par l'interface, puis dans une capture d'écran. Un code stable
est traduisible (`CLAUDE.md` §23), comparable d'une exécution à l'autre, et ne peut rien révéler
que le produit n'ait décidé de dire.

Le §8 du présent document — « aucun mot de passe, aucun jeton, aucun contenu de message dans les
journaux » — s'applique à la lettre : le service journalise l'identifiant du compte et le code,
jamais l'identifiant de connexion, jamais l'hôte, jamais le texte du serveur.

### 13.8 Seed

Trois comptes, un par boîte de `§11.4`, posés par `app.upsert_mail_inbound_account` — le
**véritable chemin d'écriture**, jamais un `INSERT` direct (`CLAUDE.md` §8) :

| `label` | `owner_id` | `imap_username` | Nature |
|---|---|---|---|
| Boîte système du workspace | `NULL` | `systeme@crm.p2enjoy.test` | catch-all du domaine des cards |
| Boîte de Camille Aubert | Camille | `admin@p2enjoy.test` | personnelle |
| Boîte de Driss Lemoine | Driss | `bizdev@p2enjoy.test` | personnelle |

Farida Nowak n'en a pas, pour la raison déjà écrite au §11.4 : un `viewer` lit, il ne correspond
pas. Son absence est **utile aux preuves** — elle donne un membre sans boîte, donc un cas de
lecture vide qui n'est pas un refus.

Les trois comptes visent `stalwart:143` en `none`, avec le mot de passe commun des boîtes de
développement. La convergence suit la règle des autres sections du seed : un rejeu met à jour sans
dupliquer, et **ne réécrit pas le secret** lorsqu'il existe déjà.

### 13.9 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | Table, contraintes, deux index uniques partiels, quatre politiques, colonnes fermées en écriture, `secret_id` révoquée, les deux fonctions et leurs `GRANT`/`REVOKE` |
| API | Preuve n° 6 : `secret_id` illisible par `authenticated`, sur une ligne qu'il lit par ailleurs. Preuve n° 7 : la boîte d'un collègue rend **zéro ligne** avec le jeton réel. Écriture directe refusée. `app.mail_inbound_account_credentials` refusée à `authenticated` et à `anon` |
| pytest | Traduction de chaque exception IMAP en son code, écriture de l'état, refus sans fuite, borne du délai |
| E2E `mail` | Le test de connexion **réel** depuis le réseau Compose : succès sur une boîte seedée, `status = 'ok'` relu en base ; échec d'authentification après changement du secret, `status = 'error'` et `last_error = 'auth_failed'` ; refus TLS sur `starttls` |
| Harnais | `scripts/verify-mail-inbound.sh`, non complaisant : chaque dégradation volontaire fait réellement échouer une preuve |

### 13.10 Limites nommées

- **Aucun écran** (§13.1). Le manuel dit ce que le produit fait et ce qu'il n'offre pas encore.
- **`ssl` implicite non prouvable en développement** (§13.6), absence figée par une assertion.
- **`starttls` non prouvable en succès en développement** : certificat auto-signé, refus attendu.
- **Aucune synchronisation** : `last_sync_at` et `sync_state` restent nuls, `CRM-054` les remplira.
- **OAuth2 reste hors périmètre**, arbitrage n° 2 du §10 inchangé.

---

## 14. Identités sortantes SMTP — `CRM-053`

Écrit **après mesure** sur la pile réellement exécutée le 2026-08-10, comme le §13.

### 14.1 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré : la table `mail_outbound_identities`, ses politiques, ses privilèges de colonne, son chemin
d'écriture unique vers Vault, le **test de connexion SMTP réel**, l'invariant d'identité par défaut,
et le cas d'usage que le §2.2 promettait — **entrant d'un côté, sortant de l'autre**.

**Non livré** : l'envoi. `queue_outbound_email`, `smtp_worker`, le quota consommé et le fil de
discussion appartiennent à `CRM-058`. `daily_quota` est donc **créée sans consommateur**, et le dire
vaut mieux que de laisser croire qu'un quota est appliqué. Aucun écran non plus, pour la même raison
qu'au §13.1.

**La preuve de refus n° 12 reste hors d'atteinte**, et sa cause est nommée : elle exige
`queue_outbound_email`, que `CRM-058` livrera. Son absence reste **figée par une assertion**.

### 14.2 Modèle

`docs/SCHEMA.md` §12, avec les précisions que la mesure impose.

**Une identité par défaut par personne, et une seule.** `is_default` est tenue par un index unique
partiel — `UNIQUE (workspace_id, owner_id) WHERE is_default` — et par un trigger qui **rabat** les
autres au lieu de refuser : choisir une nouvelle identité par défaut est un geste ordinaire, et
obliger l'utilisateur à décocher l'ancienne d'abord ferait porter à l'écran une mécanique que la
base sait tenir. L'identité de service — `owner_id IS NULL` — suit la même règle, séparément.

**`from_address` n'a aucune raison de correspondre au compte entrant.** C'est le cas d'usage du
§2.2, et le seed le démontre : Driss reçoit sur `bizdev@p2enjoy.test` et expédie depuis
`contact@p2enjoy.test`. Aucune contrainte ne les lie.

**`status`, `last_error`, `last_checked_at` et `secret_id` sont fermées en écriture**, exactement
comme au §13.2, et `last_error` porte l'un des **six codes du §13.7** — le même catalogue, parce
qu'une panne réseau est une panne réseau, qu'elle survienne en IMAP ou en SMTP.

### 14.3 Qui lit quoi

La règle du §13.4, mot pour mot : l'administrateur du workspace lit tout, un membre ne lit que ses
propres identités, un anonyme ne lit rien. `secret_id` est **révoquée en lecture** pour
`authenticated` sur toutes les lignes — c'est la seconde moitié de la preuve de refus n° 6, et la
seconde moitié de la n° 7.

### 14.4 Le test de connexion

`POST /internal/v1/outbound-identities/{id}/test`, protégé par le jeton interne. Il ouvre une
session SMTP réelle, s'authentifie, envoie `NOOP`, et referme. **Il n'envoie aucun message** : une
unité qui n'a pas de destinataire n'a pas à en inventer un, et un test qui écrirait dans une boîte
laisserait une trace que personne n'a demandée.

### 14.5 Ce que le développement peut prouver, et une mesure qui change le contrat

**Mesuré**, depuis le réseau Compose, contre le Stalwart de `CRM-050` :

| Tentative | Résultat mesuré |
|---|---|
| `AUTH` sur 587 en clair, bon mot de passe | **succès** ; le serveur annonce `AUTH`, `STARTTLS`, `SIZE`, `PIPELINING`, `SMTPUTF8` |
| `AUTH` sur 587, mauvais mot de passe, **délai 5 s** | `SMTPServerDisconnected … timed out` |
| `AUTH` sur 587, mauvais mot de passe, **délai 10 s ou 35 s** | `535 5.7.8 Authentication credentials invalid`, **après 10,0 s exactement** |
| `STARTTLS` avec vérification stricte | `SSLCertVerificationError … self-signed certificate` |
| SMTPS implicite sur 465 | `ConnectionRefusedError` — aucun listener 465 n'est déclaré |
| `AUTH` sur 25 | succès également : le port de remise accepte l'authentification |

**LE SERVEUR APPLIQUE UN DÉLAI DE PÉNALITÉ DE DIX SECONDES SUR UN ÉCHEC D'AUTHENTIFICATION**, et
c'est la mesure qui change le contrat. Avec le délai par défaut hérité du §13.5 — dix secondes —, un
mot de passe faux serait rapporté comme un **`timeout`** au lieu d'un `auth_failed` : le diagnostic
mentirait, et l'exploitant chercherait un problème de réseau là où il n'y a qu'un mot de passe
erroné. Le test SMTP emploie donc **trente secondes**, et la variable est distincte de celle
d'IMAP — le protocole a ses propres temps, et les confondre reviendrait à régler l'un par l'autre.

IMAP, lui, refuse **immédiatement** : les deux mesures du §13.6 le montrent. Aucune raison
d'allonger son délai.

Conséquences identiques au §13.6 pour le reste : le seed emploie `none`, `starttls` est prouvé en
**refus**, `ssl` implicite n'est pas prouvable et son absence est **figée par une assertion**.

### 14.6 Seed

Deux identités, et la seconde est **le cas d'usage du §2.2** :

| `label` | `owner_id` | `from_address` | Par défaut |
|---|---|---|---|
| Identité de service | `NULL` | `systeme@crm.p2enjoy.test` | oui, pour le service |
| Envoi de Driss Lemoine | Driss | `contact@p2enjoy.test` | oui, pour lui |

Driss **reçoit** sur `bizdev@p2enjoy.test` et **expédie** depuis `contact@p2enjoy.test` : entrant et
sortant divergent, comme le §2.2 l'annonce depuis le socle documentaire, et le seed le démontre au
lieu de le décrire. Camille n'a pas d'identité sortante, ce qui donne aux preuves un administrateur
sans identité — cas de lecture vide qui n'est pas un refus.

### 14.7 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | Table, contraintes, index uniques partiels, invariant d'identité par défaut rabattue, politiques, colonnes fermées, `secret_id` révoquée, fonctions et droits |
| API | Seconde moitié des refus n° 6 et n° 7 ; écriture directe refusée ; la fonction de déchiffrement refusée à tous sauf au service |
| pytest | Traduction de chaque panne SMTP en son code, et le délai qui ne transforme pas un refus d'authentification en `timeout` |
| E2E `mail` | Connexion SMTP **réelle** : succès, `auth_failed` après changement de secret, `tls_failed` sur `starttls`, et l'absence de listener 465 |
| Harnais | `scripts/verify-mail-outbound.sh`, non complaisant, avec son témoin |

---

## 15. Ingestion — `CRM-054`

Écrit **après mesure** sur la pile réellement exécutée le 2026-08-10.

### 15.1 Ce que la mesure a établi, et qui n'était écrit nulle part

**1. UN MESSAGE EXTERNE NON AUTHENTIFIÉ N'ARRIVE PAS DANS `INBOX`.** Mesuré trois fois, sur trois
expéditeurs différents — dont `preuves.p2enjoy.test`, le domaine même qu'emploie la preuve de
`CRM-050` : un message soumis sur le port 25 **sans authentification** est accepté (`250 … queued`)
puis classé dans **`Junk Mail`** par Stalwart. Le même message soumis en **SMTP authentifié**
arrive dans `INBOX` — c'est ce que la preuve M2 de `CRM-050` exerce, et c'est pourquoi elle passe.

Conséquence directe, et elle touche le produit : `watch_folders` vaut `{INBOX}` par défaut (§2.1).
Un worker qui ne surveillerait que `INBOX` **ne verrait jamais** un message classé indésirable.
Deux réponses étaient possibles ; la retenue est écrite au §15.4.

**1 bis. IDLE N'EST PAS ANNONCÉ AVANT L'AUTHENTIFICATION, ET IL L'EST APRÈS.** Mesuré : la
`CAPABILITY` initiale de Stalwart ne contient pas `IDLE` ; celle renvoyée **après `LOGIN`** le
contient, et un `IDLE` réel répond `+ Idling, send 'DONE' to stop.` puis `OK IDLE completed`. Un
client qui lirait la capacité **avant** de s'authentifier — le réflexe naturel — conclurait à tort
que le serveur ne sait pas veiller, et se rabattrait sur une scrutation périodique sans que rien ne
le signale. La capacité est donc relue **après authentification**, et le §4.1 s'entend ainsi.

**2. `UIDVALIDITY` est lisible et stable** — `2649709628` sur `INBOX` de la boîte système —, et la
recherche par UID comme le `FETCH (RFC822)` fonctionnent. La boucle du §4.1 a donc tout ce qu'il
lui faut.

**3. ClamAV détecte réellement depuis le réseau Compose** : `zINSTREAM` portant EICAR rend
`stream: Eicar-Test-Signature FOUND`. Ce n'est pas une nouveauté — `CRM-050` l'avait mesuré — mais
c'est ici que le produit va s'en servir.

**4. Storage accepte un aller-retour complet avec la clé de service** : création de bucket, dépôt,
relecture, suppression, suppression du bucket. **Et `storage.buckets` est VIDE** : aucun bucket
n'existe avant cette unité, ce que la preuve de refus n° 9 avait figé.

### 15.2 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré : les tables `mail_messages`, `mail_message_occurrences` et `mail_attachments` ; le bucket de
Storage et sa politique ; la boucle de relève, son état par dossier et son dédoublonnage ;
l'analyse MIME ; l'extraction des pièces jointes, leur empreinte, leur dépôt et leur soumission à
ClamAV ; l'empreinte de repli du §4.2.

**Non livré, et nommé** : le **classement** (`CRM-055`), les **dossiers IMAP imbriqués**
(`CRM-056`), l'**inbox globale** (`CRM-057`), l'**envoi** (`CRM-058`) et le **backfill**
(`CRM-059`). Un message ingéré est donc « non classé » : il existe, il est lisible par l'API, et
aucun écran ne le montre.

### 15.3 Le dédoublonnage, et l'empreinte de repli

Clé : `(workspace_id, rfc822_message_id)`. Un message déjà connu n'est pas réinséré ; seule une
**occurrence** est ajoutée — compte, dossier, UID —, ce qui est exactement ce que le §4.2 décrit.

**Sans `Message-ID`**, l'empreinte est `fallback-sha256:` suivi du SHA-256 de la concaténation
canonisée de : adresse d'expéditeur normalisée en minuscules, date au format RFC 3339 en UTC,
sujet **débarrassé de ses espaces de tête et de fin**, et taille du corps en octets. Les quatre
composantes sont séparées par un octet nul, qui ne peut apparaître dans aucune d'elles : sans
séparateur non ambigu, deux messages différents pourraient produire la même empreinte par simple
décalage des champs.

Le préfixe n'est pas décoratif : il **distingue une empreinte d'un identifiant véritable**, et
interdit qu'un expéditeur forge un `Message-ID` qui entrerait en collision avec l'empreinte d'un
autre message.

### 15.4 Les dossiers surveillés, et la mesure qui les impose

Le seed de développement surveille **`INBOX` et `Junk Mail`**, et le motif est mesuré (§15.1) :
sur cette pile, un message venant de l'extérieur sans authentification est classé indésirable, et
un worker aveugle à ce dossier ne verrait jamais arriver le courrier qu'il est censé relever.

Ce n'est **pas** un défaut du serveur, et le produit ne le contourne pas en désactivant le filtre :
une boîte de production a le même dossier, et un client réel y trouvera de vrais messages. La
question « faut-il relever les indésirables » appartient à l'exploitant, et `watch_folders` est
précisément la colonne qui la porte. Le défaut par défaut reste `{INBOX}` : c'est le seul choix
qu'un produit puisse faire à la place de quelqu'un.

La preuve d'ingestion, elle, emprunte le **chemin authentifié** — celui de `CRM-050` M2 —, parce
que c'est celui d'un message légitime remis par un serveur de messagerie.

### 15.5 Les pièces jointes

Chaîne du §4.3, dans cet ordre : extraction, **inspection du contenu** pour le type, assainissement
du nom, empreinte `sha256`, dépôt dans Storage, soumission à ClamAV, écriture du statut.

**L'ordre compte, et il est celui-là pour une raison.** Le dépôt précède l'analyse : une pièce
jointe infectée est **conservée pour investigation** (§4.3), et ne pourrait pas l'être si le dépôt
attendait un verdict favorable. Le statut, lui, naît `pending` — donc non téléchargeable — et ne
devient `clean` que si ClamAV le dit.

**Le bucket est PRIVÉ**, et aucune politique ne l'ouvre à `authenticated` : le téléchargement d'une
pièce jointe appartient à `CRM-057`, qui devra le faire passer par une URL signée conditionnée au
statut `clean`. Livrer ici une politique de lecture ouvrirait le téléchargement d'une pièce
`infected` — exactement ce que la preuve de refus n° 9 interdit.

**Le nom est assaini** : chemin retiré, caractères de contrôle retirés, longueur bornée à
255 octets, nom vide remplacé par `piece-jointe`. Le nom d'origine est **conservé** à côté du nom
assaini : le perdre priverait l'utilisateur de l'information que l'expéditeur a voulu transmettre.

**Le chemin de dépôt ne contient pas le nom de fichier** : il est
`<workspace_id>/<message_id>/<sha256>`. Un nom d'origine dans un chemin de stockage est une
traversée de répertoire qui attend son heure, et l'empreinte suffit à distinguer deux pièces.

### 15.6 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | Les trois tables, leurs clés, le dédoublonnage, les politiques, le bucket privé, l'absence de tout privilège de téléchargement |
| pytest | Analyse MIME, assainissement des noms, **empreinte de repli** et sa canonisation, ordre dépôt→analyse, bornes |
| API | Preuve n° 9 : une pièce `infected` **et** une pièce `pending` ne sont pas téléchargeables ; un anonyme ne lit aucune des trois tables |
| E2E `mail` | Un email **réellement envoyé** — chemin authentifié du §15.4 — est relevé, dédoublonné, sa pièce jointe déposée et analysée ; un second envoi du même `Message-ID` ajoute une **occurrence** et non un message |
| Harnais | `scripts/verify-mail-ingestion.sh`, non complaisant, avec son témoin |

---

## 16. Classement assisté — `CRM-055`

### 16.1 Ce que l'unité livre, et la règle qu'elle DÉSACTIVE

Livré : les règles **1**, **2** et **4** du §4.4, le classement manuel `classify_message`, sa
journalisation, et l'événement de timeline `mail_received`.

**LA RÈGLE 3 EST DÉSACTIVÉE, ET C'EST LA DEFINITION OF DONE QUI LE PRÉVOIT** : « si `CRM-060` n'est
pas livré, règle 3 désactivée et documentée comme telle ». Elle suppose des **contacts** — « une
adresse rattachée à exactement une card active » —, et aucune table de contacts n'existe. La
désactivation n'est pas un raccourci : la règle 3 ne classe pas, elle **suggère**, et une
suggestion fondée sur rien serait pire qu'aucune suggestion. Son absence est **figée par une
assertion**, non commentée.

**Non livré** : l'inbox globale (`CRM-057`) et les dossiers IMAP (`CRM-056`). Le classement écrit
donc dans la base ; aucun écran ne le montre.

### 16.2 La chaîne, et pourquoi elle s'arrête à la première règle satisfaite

| # | Règle | Résultat | Livrée |
|---|---|---|---|
| 1 | Une adresse de card figure dans `To`, `Cc` ou `Delivered-To` | `classification = 'auto'` | oui |
| 2 | `In-Reply-To` ou `References` désigne un message déjà classé | même card que le parent | oui |
| 3 | L'expéditeur est un contact rattaché à exactement une card active | suggestion, **ne classe pas** | **non — `CRM-060`** |
| 4 | Aucune règle ne s'applique | « non classé » | oui |

L'arrêt à la première règle satisfaite n'est pas une optimisation : c'est ce qui rend le classement
**déterministe**. Un message adressé à une card et répondant à un message d'une autre card doit
avoir une destination unique et prévisible, et la règle 1 — l'adresse explicite — est plus forte
qu'une filiation.

**Une adresse de card se reconnaît à sa FORME ET à son domaine** : `c-<8 caractères base32>` suivi
du `inbound_domain` du workspace. La forme seule ne suffit pas — un correspondant peut écrire à
`c-abcd1234@son-domaine.tld` sans que cela désigne quoi que ce soit —, et le domaine seul non plus.

**Une card archivée ou en corbeille ne reçoit pas** : classer dans une card qu'on a rangée
ramènerait du courrier dans un dossier que l'utilisateur a fermé. Le message reste non classé, et
c'est un état, pas une erreur.

### 16.3 Le classement manuel

`classify_message(p_message_id, p_card_id)` — `SECURITY DEFINER`, ouverte à `authenticated`.

- elle **exige le droit d'écriture sur la card** : classer un message y ajoute du contenu ;
- elle écrit `classification = 'manual'` et `classified_by = auth.uid()` ;
- elle écrit un **`card_event` de type `mail_received`**, ce qui étend le vocabulaire de dix à onze
  types. La timeline est la mémoire d'une card : un message qui y entre est un fait, et le taire
  laisserait un trou entre deux commentaires ;
- elle est **idempotente** : reclasser un message dans la même card ne produit pas un second
  événement. Un utilisateur qui clique deux fois ne raconte pas deux histoires.

**Déclasser n'est pas prévu**, et l'absence est nommée : rien dans le §4.4 ne le décrit, et
l'inventer ici obligerait à décider ce que devient l'événement de timeline déjà écrit — une
question qui appartient à l'unité qui livrera l'écran.

### 16.4 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | Chaque règle livrée, la désactivation de la règle 3 **figée**, le refus d'une card archivée, l'idempotence, le vocabulaire à onze types |
| pytest | La reconnaissance d'une adresse de card : forme, domaine, et les cas voisins qui ne doivent PAS classer |
| API | `classify_message` refusée sans droit d'écriture ; le message classé devient lisible par qui lit la card |
| E2E `mail` | Un email **réellement envoyé à l'adresse d'une card** est ingéré puis classé **automatiquement** ; un second, adressé à personne, reste non classé et est classé **à la main** |
| Harnais | `scripts/verify-mail-classement.sh`, non complaisant, avec son témoin |

---

## 17. Dossiers IMAP imbriqués — `CRM-056`

### 17.1 Ce que la mesure a établi, et qui n'était écrit nulle part

**Mesuré le 2026-08-10 contre le Stalwart de `CRM-050`, depuis le réseau Compose :**

| Mesure | Résultat |
|---|---|
| Délimiteur annoncé par `LIST` | `/` |
| `CREATE "CRM"`, puis `"CRM/Track"`, puis `"CRM/Track/Channel"` | **OK** à chaque niveau |
| `LIST` **avec `imaplib`** après création de `CRM/Conseil & IA` | **`CRM/Conseil &- IA`** |
| `LIST` **avec IMAPClient** sur le même dossier | **`CRM/Conseil & IA`** — le nom d'origine |
| `RENAME "CRM/Conseil & IA"` → `"CRM/Conseil et IA"` | **OK**, et **l'enfant suit** : `CRM/Conseil et IA/Grands comptes` |
| `CREATE` d'un nom portant une contre-oblique | **OK** — le serveur ne la refuse pas |

**LE NOM CIRCULE EN UTF-7 MODIFIÉ SUR LE FIL, ET LA BIBLIOTHÈQUE LE DÉCODE — LES DEUX MESURES ONT
ÉTÉ FAITES, ET LA SECONDE CORRIGE LA PREMIÈRE.** Lu avec `imaplib`, `CRM/Conseil & IA` revient
`CRM/Conseil &- IA` : c'est l'encodage de la RFC 3501, où `&` s'écrit `&-`, et `imaplib` ne le
décode pas. Lu avec **IMAPClient** — la bibliothèque que le produit emploie —, le même dossier
revient `CRM/Conseil & IA`. Le ré-encodage est donc une propriété **du fil**, pas du serveur, et il
est transparent pour le produit.

**`mail_folder_map` reste néanmoins nécessaire, et pour une autre raison que celle-là.** Le chemin
demandé est dérivé de noms que l'utilisateur peut changer : renommer un track change le chemin
souhaité, et sans correspondance mémorisée le produit ne saurait plus quel dossier renommer. Le
§4.5 l'écrit d'ailleurs ainsi — « la correspondance réelle est mémorisée, car le chemin créé peut
différer du nom souhaité » —, et l'assainissement du produit est justement l'un des cas où ils
diffèrent : un track nommé « A/B » donne un segment « A B ».

**Le renommage emporte les enfants**, ce qui rend le §4.5 tenable : renommer un track renomme son
dossier **et** ceux de ses channels, sans reconstruire l'arborescence.

**Le serveur n'assainit pas à notre place** : une contre-oblique passe. L'assainissement du §4.5 —
délimiteur, longueur, caractères interdits — reste donc entièrement à la charge du produit.

### 17.2 Ce que l'unité livrera

`mail_folder_map` — compte, entité (`track`, `channel`, `card`), identifiant, **chemin demandé**,
**chemin réellement créé** —, la création paresseuse de l'arborescence `CRM/<Track>/<Channel>/<Card>`
après classement, l'assainissement des noms, le renommage propagé, et la détection des labels Gmail
(`X-GM-EXT-1`), pour lesquels le modèle de dossiers est inadapté.

**Le worker ne supprime jamais un message d'`INBOX` : il copie** (§4.5). Décider à la place de
l'utilisateur de retirer un message de sa boîte serait destructif.
