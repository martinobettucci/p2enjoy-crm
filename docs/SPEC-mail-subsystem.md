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
globalement. L'adresse complète est `<email_local_part>@<workspace.inbound_domain>`. **`CRM-123`, livré en développement le
2026-11-01** (décision 804, `docs/SPEC-cards.md` §3.6) : le préfixe se règle par espace, pour suivre un motif d'alias
du serveur (`app-*`) quand le domaine n'est pas réservé au CRM. Une régénération explicite l'applique aux affaires
existantes.

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

*Révisé par `CRM-143` (`docs/SPEC-pieces-jointes.md` §17.3, décision 889)* : `skipped` a deux raisons, gardées en base,
`scanner_unavailable` et `too_large`. Une pièce **non analysée** — `skipped` déposée, ou `pending` depuis plus de quinze
minutes — se télécharge après un avertissement et une confirmation persistée par personne. `infected` ne se télécharge
jamais. Une reprise analyse les pièces non analysées dès que l'antivirus répond.

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

**Révisé par `CRM-111` T6.1** (docs/SPEC-rattachements.md §7, décisions 657, 818 et 820) : le dossier d'une affaire sort
de l'arborescence des tracks et des channels. `chemin_dossier_card` rend **`CRM/Affaires/<titre assaini> (<8 derniers
caractères de l'identifiant>)`** pour toutes les affaires, quel que soit leur nombre de rattachements ; deux affaires de
même titre ont deux dossiers. **Les dossiers existants sont déplacés par `mail-sync`** sans geste nouveau : le registre
(`mail_folder_map`, `dossiers_a_renommer`) voit chaque dossier d'affaire diverger de son nouveau chemin, et la relève
suivante le renomme (§4.5 ci-dessous, « renommage »), comme pour un titre changé. **Plus aucun parent n'est inscrit** :
le track et le channel ne contiennent plus le dossier d'une affaire, et les y inscrire ferait renommer des dossiers qui
ne la portent pas — un renommage refusé arrêterait la boucle. Les dossiers `CRM/<track>/<channel>` déjà créés restent
sur le serveur, vides, sans être retirés : `mail-sync` n'efface jamais un dossier de la boîte.
*Avant T6.1 (`CRM-111` T2.4.2)* : le track et le channel parents étaient ceux du plus ancien rattachement.

Après classement, le worker s'assure de l'existence du chemin `CRM/Affaires/<affaire>` sur le compte concerné et y dépose
une copie du message.

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

**Écart volontaire — la limite d'envoi par expéditeur est relevée pour le développement (INC-272, décision 625).**
Stalwart v0.13.4 limite par défaut `queue.limiter.inbound.sender` à `25/1h`, sur le couple (domaine expéditeur,
destinataire) — relu sur le serveur, non déduit d'une documentation. Une campagne `e2e:mail` adresse plusieurs messages
au même destinataire : au-delà de trois campagnes par heure, les soumissions étaient refusées en
`452 4.4.5 Rate limit exceeded`. `stalwart-init` écrit `1000/1h` par l'API de réglages, comme les réglages IMAP/SMTP,
puis le relit ; la limite par adresse IP (`5/1s`) et l'activation du limiteur restent celles du serveur. L'écart n'a
d'effet qu'en développement : ce serveur n'existe nulle part ailleurs (§2.1). Preuves : `stalwart/config.test.ts`
(écriture et relecture par l'API) et `e2e/mail/infrastructure.spec.ts` M2 bis (l'ancienne limite plus un, toutes les
soumissions acceptées vers un même destinataire).

**Écart volontaire — le réseau de la pile n'est jamais banni (INC-273, décision 626).** Stalwart bannit une adresse
au-delà de `server.auto-ban.auth.rate` échecs d'authentification (`100/1d`, valeur par défaut lue dans le binaire
v0.13.4) ; les preuves « mot de passe faux » passent volontairement par `mail-sync` et `roundcube`, qu'il finissait par
bannir. `stalwart-init` lit à l'exécution le sous-réseau du réseau Compose qu'il partage avec Stalwart, le déclare
`server.allowed-ip` par l'API, efface les bannissements posés, puis relit les deux ; aucune adresse n'est écrite dans le
dépôt, et le bannissement reste actif pour toute autre origine. Preuves : `stalwart/config.test.ts` et
`e2e/mail/infrastructure.spec.ts` M1 bis (101 échecs, puis une session valide, aucune adresse bannie).

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

**UN TROISIÈME DOMAINE ET UNE QUATRIÈME BOÎTE, AJOUTÉS LE 2026-08-20 PAR `CRM-060`
sous-tranche 2 bis** (`docs/SPEC-contacts.md` §8.8.8). Ils ne servent **pas** le produit : ils
servent le **correspondant**, c'est-à-dire l'extérieur que cette pile n'avait pas.

| Domaine | Rôle |
|---|---|
| `sogexia.example` | Domaine du **correspondant de démonstration**, hors du produit |

| Adresse | Nature | À quoi elle sert |
|---|---|---|
| `leo.marchand@sogexia.example` | Boîte d'un **correspondant extérieur** | Soumettre le courrier de démonstration qui déclenche la **règle 3** du §4.4 |

Le motif est mesuré, et il est écrit au §2.19 de `docs/SPEC-seed.md` depuis `CRM-057` : **un
principal n'expédie que depuis ses propres adresses**, et le serveur refuse tout autre `From` en
`501 5.5.4 You are not allowed to send from this address.` Le seed s'était donc rabattu sur une
boîte du produit — `bizdev@p2enjoy.test` — comme correspondant, ce qui suffisait aux règles 1, 2
et 4. La **règle 3** exige davantage : que l'expéditeur soit reconnu comme **contact** du workspace,
à son adresse. Celle de Léo Marchand est `leo.marchand@sogexia.example`
(`docs/SPEC-contacts.md` §5), et aucune boîte ne la portait.

**La réponse n'est pas de faire mentir le `From`, c'est d'en faire exister un.** Un serveur de
développement qui héberge aussi le domaine du client simule ce que la production verra arriver de
l'extérieur, et le message reste soumis par le **véritable chemin authentifié** (`CLAUDE.md` §8).

`.example` est réservé par la RFC 2606 au même titre que `.test` : il n'est pas routable, et la
précaution en tête de ce paragraphe est tenue. La boîte porte le même mot de passe commun et le
même `roles: ["user"]` que les trois autres, pour la raison mesurée ci-dessous.

**Cette boîte n'est PAS un compte entrant du produit** : aucune ligne de `mail_inbound_accounts` ne
la désigne, et le produit ne relève jamais dedans. Elle n'existe que pour **émettre**. L'y inscrire
en ferait une boîte du workspace, ce que le correspondant n'est pas.

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

**Une seule relève à la fois par compte — INC-266, ajouté le 2026-10-03 (décision 619).** La veille de fond et la
route interne `/poll` relèvent par le même `relever_compte`, dans le même processus : sans verrou, deux relèves du
même compte lisaient la même divergence de dossier (§4.5), et la seconde renommait un dossier déjà renommé —
`folder_rename_refused`, « NONEXISTENT ». Un verrou PAR COMPTE les sérialise ; deux boîtes différentes ne s'attendent
pas. Il vit dans le processus, seul exemplaire du service ; un second exemplaire demanderait un verrou en base.

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
- **les preuves `e2e/mail` n'entrent pas en collision avec la veille de fond — INC-271, décision 624.** La veille
  relève en continu tout compte doté d'un secret (§20.10) ; une preuve qui partage une boîte avec elle obéit à trois
  règles. (1) Son contrat se juge sur l'ÉTAT — message en base, card, pièces, dossier —, jamais sur les compteurs de
  SA relève, que la veille peut avoir devancée. (2) Elle rend chaque boîte dans l'état trouvé : instantané des dossiers
  avant, puis, dans cet ordre, le message retiré de TOUS les dossiers, une relève-barrière par `/poll` (le verrou par
  compte du §12.4 lui fait attendre une relève de veille en vol), ses lignes, les correspondances nées, les dossiers
  nés ; l'état rendu est ensuite exigé (`e2e/mail/menage.ts`). (3) Une preuve qui observe une TRANSITION — le premier
  contact du backfill (§20.6 bis.4) — s'exécute sur un exemplaire jetable du service, même image et même
  environnement, veille désactivée (`MAIL_SYNC_POLL_INTERVAL=0`), le service partagé arrêté le temps de la preuve :
  un seul exemplaire à la fois, le verrou en processus reste suffisant. La console opérationnelle (S3) mesure le
  silence sur son propre passage, qui contient un tour de veille complet ; un état laissé faussé par une autre preuve
  y fait parler la veille et la rougit ;
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

**Ce que « par défaut » veut dire** (décision 805, INC-335). Le défaut d'une **personne** est l'identité que l'écran
d'envoi présélectionne (§19.4) et que le connecteur prend quand aucune adresse n'est donnée (`docs/SPEC-mcp.md`
§9.2 decies). Le défaut du **service** est l'identité des envois automatiques, le digest quotidien
(`app.envoyer_digests`). Les deux ne se concurrencent jamais : **l'identité de service ne s'emprunte plus**, ni pour
un envoi, ni pour une cadence, administrateur compris (§19.4).

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
| Envoi de Camille Aubert | Camille | `admin@p2enjoy.test` | oui, pour elle — **ajoutée par la décision 805** (INC-335) : l'identité de service ne s'emprunte plus, et l'envoi de démonstration de l'administratrice part de la sienne (`docs/SPEC-seed.md` §2.18) |

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

> **Révisé par `CRM-057` (§18.5), et la preuve suit depuis INC-317 (2026-10-26).** Une politique ouvre désormais la
> lecture d'une pièce `clean` à qui voit son message (`mail_attachments_objets_lecture`) ; le listage du bucket suit la
> même politique. L'anonyme ne lit ni ne liste rien, et une pièce `pending`, `skipped` ou `infected` ne se lit ni ne se
> liste par personne (`e2e/api/ingestion.spec.ts`, `e2e/api/inbox.spec.ts`).

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

### 16.1 Ce que l'unité livre — et la règle 3, désactivée puis ACTIVÉE

Livré par `CRM-055` : les règles **1**, **2** et **4** du §4.4, le classement manuel
`classify_message`, sa journalisation, et l'événement de timeline `mail_received`.

**LA RÈGLE 3 A ÉTÉ DÉSACTIVÉE JUSQU'À `CRM-060`, PUIS ACTIVÉE PAR SA TRANCHE 2** (migration `0046`,
`docs/SPEC-contacts.md` §8). Tant qu'aucune table de contacts n'existait, la Definition of Done de
`CRM-055` prévoyait « règle 3 désactivée et documentée comme telle », et son absence était **figée
par une assertion**. `CRM-060` tranche 1 a livré `contacts` et `card_contacts`, tranche 2 a écrit la
règle : elle **suggère** — expéditeur contact rattaché à **exactement une** card active — sans
classer. La suggestion se persiste dans `mail_messages.suggested_card_id` ; le message reste non
classé (`classification = 'unclassified'`, `card_id` nul, aucun `card_event`). Zéro card active
n'invente rien, deux ou plus se taisent, une card archivée ne compte pas, la casse de l'email est
ignorée, le workspace borne l'appariement (`docs/SPEC-contacts.md` §8.2, §8.5).

**~~Reste non livré : l'écran qui MONTRE la suggestion.~~ LIVRÉ le 2026-08-20 par `CRM-060`
sous-tranche 2 bis** (`docs/SPEC-contacts.md` §8.8, `docs/DESIGN_SYSTEM.md` §5.4 ter). Le motif de
l'attente — « l'inbox globale, `CRM-057` » — était **caduc depuis le 2026-08-11** : l'inbox était
livrée, et la règle vivait en base sans qu'aucun écran ne la montre. Le panneau de lecture d'un
message non classé porte désormais l'encadré qui nomme l'affaire suggérée, écrit la règle et
propose de la ranger d'un geste ; le seed fait **réellement arriver** un message qui la déclenche
(`docs/SPEC-seed.md` §2.19), sans quoi la surface n'aurait ni capture ni parcours. La règle reste
prouvée en base (pgTAP `0044`, API `classement.spec.ts`, harnais `verify-mail-classement.sh`), et
la preuve visible existe enfin : `e2e/ui/suggestion-classement.spec.ts`, quatre paliers compris.

### 16.2 La chaîne, et pourquoi elle s'arrête à la première règle satisfaite

| # | Règle | Résultat | Livrée |
|---|---|---|---|
| 1 | Une adresse de card figure dans `To`, `Cc` ou `Delivered-To` | `classification = 'auto'` | oui |
| 2 | `In-Reply-To` ou `References` désigne un message déjà classé | même card que le parent | oui |
| 3 | L'expéditeur est un contact rattaché à exactement une card active | suggestion (`suggested_card_id`), **ne classe pas** | oui — `CRM-060` tranche 2, migration `0046` |
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

**~~Déclasser n'est pas prévu~~, et l'absence est nommée** : rien dans le §4.4 ne le décrit, et
l'inventer ici obligerait à décider ce que devient l'événement de timeline déjà écrit — une
question qui appartient à l'unité qui livrera l'écran. **RÉVISÉ le 2026-08-28, et le renvoi est
caduc** : l'écran est livré depuis `CRM-057`, le 2026-08-11, et il n'a pas tranché la question ;
l'écart est donc resté imputable à personne pendant dix-sept jours. Le déclassement est
**spécifié au §16.5 et livré par la tranche 2 de cette unité** — la question laissée ouverte, « ce
que devient l'événement de timeline déjà écrit », y reçoit sa réponse mesurée
(`docs/JOURNAL.md` décision 536). Ce paragraphe est conservé plutôt qu'effacé : il dit pourquoi
l'absence a duré.

### 16.4 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | Chaque règle livrée, la désactivation de la règle 3 **figée**, le refus d'une card archivée, l'idempotence, le vocabulaire à onze types |
| pytest | La reconnaissance d'une adresse de card : forme, domaine, et les cas voisins qui ne doivent PAS classer |
| API | `classify_message` refusée sans droit d'écriture ; le message classé devient lisible par qui lit la card |
| E2E `mail` | Un email **réellement envoyé à l'adresse d'une card** est ingéré puis classé **automatiquement** ; un second, adressé à personne, reste non classé et est classé **à la main** |
| Harnais | `scripts/verify-mail-classement.sh`, non complaisant, avec son témoin |

### 16.5 Le déclassement d'un message — `CRM-055` tranche 2

*Écrit le 2026-08-28, **après mesure sur la pile réelle** et avant la première ligne de code
(`CLAUDE.md` §5). L'arbitrage et ses motifs sont au `docs/JOURNAL.md`, décision 536 ; il est rendu
par la session elle-même en application du `docs/CloudWorker.md` §4.1 bis.*

#### 16.5.1 Les trois mesures qui fondent le contrat

Rien de ce chapitre n'est déduit d'un souvenir. Les trois mesures ci-dessous sont relevées sur la
pile de développement seedée, le 2026-08-28.

**Mesure 1 — un message classé est visible par DEUX chemins, et ils ne se valent pas.**
`app.peut_voir_message` (migration `0028`) rend vrai si l'appelant lit la card du message **ou**
s'il voit la boîte où le message est arrivé. Endossés tour à tour, les trois profils du seed
rendent, sur le message classé `Demande de devis — refonte` et sa card `…0c1` :

| Profil | `can_write_card` | `boite_du_message_lisible` | `peut_voir_message` |
|---|---|---|---|
| `admin@p2enjoy.test` | vrai | **vrai** | vrai |
| `bizdev@p2enjoy.test` | vrai | **faux** | vrai |
| `viewer@p2enjoy.test` | faux | faux | faux |

**Mesure 2 — déclasser peut rendre le message invisible à qui vient de le déclasser.** La ligne du
`bizdev` est la mesure qui décide ce chapitre : Driss voit ce message **par la card seule**. Le
`card_id` remis à nul, `peut_voir_message` devient faux pour lui, et il ne peut ni le relire ni le
reclasser. Ce n'est pas une hypothèse : c'est la lecture directe des deux fonctions ci-dessus.

**Mesure 3 — le vocabulaire de la timeline porte déjà le précédent exact.**
`card_events_type_check` énumère **dix-huit** types, dont `contact_linked` et `contact_unlinked` :
le produit écrit déjà un événement quand un rattachement est **défait**. Le déclassement d'un
message est le même geste sur un autre objet, et il n'appelle donc aucune règle nouvelle.

#### 16.5.2 Contrat opposable de `unclassify_message`

`unclassify_message(p_message_id uuid) returns uuid` — `SECURITY DEFINER`, `search_path = ''`,
exécutable par `authenticated` et `service_role`, refusée à `public` et `anon`. Elle rend
**l'identifiant de la card quittée**, ou `null` si le message n'était pas classé.

| # | Règle | Refus |
|---|---|---|
| a | Appelant anonyme | `not_authenticated`, `42501` |
| b | Message inconnu | `message_not_found`, `P0002` |
| c | L'appelant ne **voit** pas le message | `forbidden`, `42501` |
| d | L'appelant ne peut pas **écrire** la card où le message est classé | `forbidden`, `42501` |
| e | Le message n'est **pas** classé, et l'appelant le voit encore | aucun refus : rend `null`, n'écrit rien |

**Les deux droits sont ceux du classement, et pas d'autres.** `classify_message` exige de voir le
message **et** d'écrire la card ; `unclassify_message` exige exactement les mêmes, évalués
**avant** le geste. La symétrie est le contrat : *on ne retire que ce qu'on aurait pu poser*. Exiger
en plus de voir la BOÎTE aurait interdit au `bizdev` de défaire son propre geste (mesure 1), et un
geste qu'on ne peut pas défaire est pire que le geste lui-même.

**Ce que l'écriture fait, et c'est l'exact inverse du classement :** `card_id` à nul,
`classification` à `'unclassified'`, `classified_by` à nul, `classified_at` à nul, et les
`mail_attachments` du message repassent à `card_id` nul. Rien d'autre n'est touché.

**Idempotente** (ligne e) : déclasser un message déjà non classé ne produit **aucun** événement et
rend `null`. Un utilisateur qui clique deux fois ne raconte pas deux histoires — c'est la règle que
le §16.3 pose déjà pour le classement.

**MAIS L'IDEMPOTENCE A UNE BORNE, ET ELLE EST MESURÉE, NON SUPPOSÉE.** Écrite d'abord sans borne,
cette ligne était **fausse pour l'appelant qui en a le plus besoin**, et c'est le premier appel réel
sur la pile qui l'a montré, non la relecture :

```
bizdev voit AVANT = t
bizdev déclasse -> card rendue = 5eed0000-…-0000000000c1
bizdev voit APRÈS = f
second appel      => ERREUR forbidden (42501), et non « null »
```

Le geste retire au `bizdev` le seul chemin par lequel il voyait ce message (mesure 2). Son second
appel bute donc sur la ligne **c**, en amont de la ligne e. **Ce refus est JUSTE**, et l'ordre des
gardes n'est pas révisé pour le contourner : l'appelant n'a effectivement plus le droit d'agir sur
ce message, et déplacer la ligne e devant la ligne c ferait de la fonction une sonde — un
`authenticated` quelconque distinguerait « message inconnu », « message non classé » et « message
classé que vous n'avez pas le droit de voir » par le seul code de retour.

**La borne s'énonce donc ainsi, et elle est figée par une assertion** : l'idempotence est garantie à
l'appelant qui **conserve** la visibilité du message — celui qui voit la boîte d'arrivée. À celui
qui la perd dans le geste, un second appel oppose `forbidden`. Ce n'est pas une dégradation à
corriger : c'est la conséquence, nommée, de l'arbitrage du §16.5.2 ; et l'écran ne l'expose pas,
puisque le message quitte son panneau au premier geste (§16.5.5).

#### 16.5.3 L'historique n'est pas réécrit, et le départ s'écrit

C'est la question que le §16.3 laissait ouverte, et voici la réponse.

**Le `card_event` `mail_received` déjà écrit est CONSERVÉ.** Le courrier *est* arrivé dans cette
card : l'effacer réécrirait une histoire vraie, et `card_events` n'accorde d'ailleurs aucune
écriture de correction, `service_role` compris (`CRM-044`, mesuré par `CRM-055`).

**Un DIX-NEUVIÈME type est ajouté, `mail_unclassified`**, écrit sur la card
quittée avec `{message_id, subject}`. Sans lui, la timeline garderait « courrier reçu » pointant
vers un message qui n'y est plus : une **perte silencieuse**, que le §4.1 bis du
`docs/CloudWorker.md` interdit en toutes lettres. Il rejoint la famille **discussion**, comme
`mail_received`, pour la même raison : un message est une parole, et son départ aussi.

**Les assertions qui figent le vocabulaire sont RÉVISÉES, jamais retirées** — mécanisme de la
décision 51. Elles passent de dix-huit à **dix-neuf** types, et le fichier dit pourquoi.

#### 16.5.4 Ce que ce chapitre ne fait pas, et les motifs

- **La suggestion n'est pas ressuscitée.** `suggested_card_id` n'est pas recalculé au déclassement.
  La règle 3 (§16.2) est un **constat de la relève**, jamais d'un geste humain : la rejouer ici
  ferait réapparaître une proposition automatique derrière une décision explicite de l'utilisateur.
  La colonne garde donc la valeur que la relève y avait posée, ou reste nulle.
- **Aucun classement automatique ne se rejoue.** Un message déclassé reste non classé jusqu'à ce
  qu'un humain en décide autrement ; la chaîne du §4.4 ne s'applique qu'à l'ingestion.
- **Aucune politique n'est ouverte, aucune table n'est créée.** Tout le contrat de lecture existe
  depuis `CRM-054` et `CRM-057` ; cette tranche n'ajoute qu'une fonction et un type d'événement.
- **La conséquence de la mesure 2 n'est pas un refus, c'est une conséquence** : elle se **dit**, à
  l'écran, avant le geste (§16.5.5). L'inscrire en refus dans la base interdirait au `bizdev` un
  geste que la règle d'accès lui accorde, et ferait passer une décision d'écran pour une décision de
  base (`CLAUDE.md` §10).

#### 16.5.5 La surface — tranche 2 b

Le panneau de lecture d'un message **classé** de l'inbox (`§18.3`) porte la commande
« Retirer de l'affaire ». Elle suit la grammaire déjà posée par le produit pour un geste réversible
mais conséquent :

- **la commande n'est jamais éteinte d'avance, quel que soit le rôle** (`docs/DESIGN_SYSTEM.md`
  §5.3, §5.13, §5.16, §5.21, §5.23, §5.25, §5.27, §5.28) : l'écran offre, envoie, et **traduit** le
  refus par un dictionnaire fermé ;
- **une confirmation nomme la conséquence de la mesure 2** lorsqu'elle s'applique — « vous ne verrez
  plus ce message » — plutôt que de laisser l'utilisateur la découvrir après coup ;
- **aucun corps d'erreur du serveur n'est affiché**, règle constante du sous-système (§13.7).

#### 16.5.6 Preuves exigées de la tranche 2

| Niveau | Preuve |
|---|---|
| pgTAP | Les cinq lignes du §16.5.2, la **borne de l'idempotence** figée dans les deux sens, le vocabulaire à **dix-neuf** types, le `mail_received` **conservé**, le `mail_unclassified` écrit, `suggested_card_id` inchangé |
| API | Le refus opposé au `viewer` avec son **jeton réel** ; le `bizdev` déclasse et **perd** la visibilité du message, mesuré par une relecture derrière le geste ; l'`admin` déclasse et la garde |
| E2E d'interface | La commande, sa confirmation, son annulation, le message repassant en « Non classés » ; console vierge |
| Harnais | `scripts/verify-mail-classement.sh` étendu, avec ses dégradations réelles |

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

---

## 18. Inbox globale — `CRM-057`

### 18.1 La question que l'unité doit trancher, et qu'aucune autre ne pouvait trancher

`CRM-054` a livré l'ingestion en laissant une phrase dans sa migration : « un message NON CLASSÉ
n'est lisible par personne à travers PostgREST, faute d'un porteur de droit — l'inbox globale, qui
décidera qui voit les non classés, appartient à `CRM-057` ». C'est ici que cela se décide.

**LA RÈGLE N'EST PAS INVENTÉE : ELLE EST DÉJÀ ÉCRITE, AILLEURS.** `mail_message_occurrences` dit
*où* un message a été vu — dans quelle boîte —, et sa politique existe depuis `CRM-054` : le
propriétaire du compte, ou un administrateur du workspace. Un message non classé n'existe que par
ses occurrences ; sa visibilité est donc **exactement celle de la boîte où il a été vu**. Aucune
notion nouvelle, aucun rôle nouveau, aucune colonne nouvelle.

Il en découle, sans que rien d'autre soit décidé :

| Boîte | Qui voit ses messages **non classés** |
|---|---|
| Boîte du workspace (`owner_id` nul) | Les **administrateurs** du workspace |
| Boîte personnelle (`owner_id` renseigné) | Son **propriétaire**, et les administrateurs |

**Un membre ordinaire ne voit donc AUCUN message non classé**, et cette limite est nommée plutôt
que contournée. Ouvrir le tri à tous les membres exposerait à chacun du courrier dont personne n'a
encore établi qu'il concerne le workspace : une adresse de contact reçoit aussi des candidatures,
des factures et des erreurs de destinataire. Un rôle de tri est concevable — il n'est pas demandé,
il n'existe nulle part dans le produit, et l'inventer ici serait du périmètre en plus. **Une
assertion fige cette absence** et devra être révisée, non retirée, le jour où un tel rôle existera.

**Un message CLASSÉ ne change pas de règle** : il se lit si l'on peut lire sa card
(`app.can_read_card`), comme depuis `CRM-054`. Un message peut donc être visible dans l'inbox à
deux titres différents — sa boîte avant classement, sa card après — et c'est précisément ce que la
Definition of Done demande de montrer : « visible **à la fois** dans la card et dans l'inbox ».

### 18.2 Un défaut trouvé en écrivant cette spécification

`classify_message` (§16.3) vérifie le droit d'**écriture sur la card cible**, et rien sur le
message. Tant qu'aucun message non classé n'était lisible, cela restait sans conséquence
observable. Dès lors que l'inbox existe, la faille devient réelle : un membre disposant du droit
d'écriture sur une seule card pourrait, en désignant l'identifiant d'un message qu'il n'a pas le
droit de voir, le **classer dans sa propre card** — et le lire ensuite en toute légitimité. Le
contrôle d'accès serait contourné par l'écriture.

**Classer exige désormais les DEUX droits** : voir le message, et écrire dans la card. C'est la
règle naturelle d'un déplacement — on ne déplace que ce qu'on a le droit de prendre —, et son refus
est éprouvé **hors interface**, avec le jeton d'un membre.

### 18.3 Les trois panneaux

Le §5.4 de `docs/DESIGN_SYSTEM.md` porte la forme ; ce qui suit porte le contenu.

| Panneau | Contenu |
|---|---|
| Dossiers | « Non classés » en tête, **toujours présent**, puis l'arborescence Track → Channel → Card |
| Liste | Les messages du dossier retenu, du plus récent au plus ancien, expéditeur, objet, date, présence de pièces |
| Message | En-têtes, corps, pièces jointes et leur statut d'analyse, puis la card ou l'action de classement |

**L'ARBORESCENCE NE MONTRE QUE CE QUI PORTE DU COURRIER.** Rejouer le board entier dans le premier
panneau donnerait des dizaines de branches vides à traverser pour atteindre les trois qui
comptent : une inbox est une vue du courrier, pas un second board. « Non classés » fait exception
et reste affiché même à zéro — c'est l'entrée du travail de tri, et sa disparition ferait croire à
une panne.

**Le compte affiché est celui des messages visibles**, non celui des messages existants : deux
utilisateurs voient deux nombres différents, et c'est la conséquence directe du §18.1.

### 18.4 Le HTML d'un expéditeur ne s'affiche jamais — RÉVISÉ par le §30 (`CRM-140`, décision 881)

> **Révisé le 2026-11-11.** Le rendu confiné que la dernière phrase réservait à une autre unité est livré par `CRM-140` :
> bac à sable, politique de contenu et nettoyage (§30). L'écran n'injecte toujours aucun HTML dans son propre DOM, et les
> preuves qui figeaient l'absence sont retournées (§30.10). Le texte qui suit est conservé tel qu'il a été écrit.

`mail_messages` conserve `body_text` **et** `body_html`. L'inbox affiche le premier. Lorsqu'un
message n'a que du HTML, le corps est réduit à du texte **dans le client**, balises retirées.

Ce n'est pas une limitation temporaire, c'est une règle de sécurité : injecter dans le DOM le HTML
d'un expéditeur inconnu, c'est lui offrir l'exécution de scripts, le chargement d'images distantes
— donc le pistage à l'ouverture — et la réécriture de l'écran autour de son propre message. Un
rendu HTML confiné est concevable ; il exige un bac à sable, une politique de contenu dédiée et ses
propres preuves. **Il n'appartient pas à cette unité, et son absence est figée par une assertion.**

### 18.5 La pièce jointe saine devient téléchargeable — la preuve n° 9 est RÉVISÉE, non retirée

`CRM-054` a déposé les pièces dans un bucket privé **sans écrire la moindre politique** : la
lecture est refusée à tout le monde, y compris à une administratrice, et la preuve de refus n° 9
l'établit. La migration de `CRM-054` l'annonçait : « `CRM-057` devra en écrire une conditionnée à
`av_status = 'clean'` ; écrite à la légère, elle ouvrirait aussi les `infected` ».

La politique livrée ici ouvre **exactement une intersection** :

- l'objet appartient au bucket `mail-attachments` ; **et**
- la pièce correspondante est en statut **`clean`** — `pending`, `infected` et `skipped` restent
  refusés, et le §4.3 range les trois parmi les statuts non téléchargeables ; **et**
- le lecteur a le droit de voir le **message** qui la porte, selon le §18.1.

**Mesuré le 2026-08-11 sur la pile de développement**, et cette mesure change la forme de la
migration : `storage.objects` appartient à `supabase_storage_admin`, dont `postgres` n'est pas
membre. La migration doit donc déclarer `-- @migration-role: supabase_admin`, comme `0018_pg_cron`.
Mesuré aussi : `anon` et `authenticated` détiennent les privilèges de table sur `storage.objects`,
et seule l'**absence de politique** les refuse — une politique trop large ouvrirait donc tout le
stockage, et la restriction au bucket est portée par la politique elle-même.

Les assertions qui figeaient l'absence deviennent : la pièce **`clean`** se télécharge avec le
jeton de qui peut voir son message ; la pièce **`infected`** et la pièce **`pending`** restent
refusées à tous, y compris à l'administratrice ; et l'anonyme reste refusé sur les trois.
**Dixième occurrence du mécanisme de la décision 51.**

### 18.6 Le message dans la card

L'événement `mail_received` du §16.3 cesse d'être un événement sans détail : la timeline affiche
l'objet et l'expéditeur du message reçu, et non plus seulement « un message est arrivé ». Le fil
d'une card est sa mémoire ; une ligne qui ne dit pas de quel courrier elle parle n'en est pas une.

L'objet et l'expéditeur sont lus dans `mail_messages` filtrée sur la card — donc sous la RLS de
`CRM-054`, sans nouvelle route ni nouvelle politique. Un événement dont le message n'est pas
lisible retombe sur l'affichage sans détail : la mémoire ne ment pas, elle se tait.

### 18.7 Seed

Le seed **envoie réellement deux messages** par la soumission SMTP authentifiée de `CRM-050`, puis
déclenche **une relève réelle** — le chemin exact du produit, sans aucune trace fabriquée
(CLAUDE.md §8) :

| Message | Destinataire | État attendu |
|---|---|---|
| « Demande de devis — refonte » | l'adresse d'une card seedée | **classé automatiquement**, règle 1 |
| « Candidature spontanée » | la boîte système uniquement | **non classé** |

Leurs `Message-ID` sont **fixes** : rejouer le seed ne duplique rien, le dédoublonnage du §4.2 s'en
charge, et les captures peuvent en dépendre. Le statut des comptes reste `pending` (§13.8) : la
relève n'y touche pas.

**Mesuré le 2026-08-11, et cela contraint l'expéditeur** : Stalwart refuse un `From` qui
n'appartient pas au principal authentifié — `501 5.5.4 You are not allowed to send from this
address.` —, y compris `contact@p2enjoy.test` soumis par `bizdev@p2enjoy.test`. Le correspondant de
démonstration est donc une boîte locale. La même mesure établit que l'identité sortante seedée au
§14.6, qui promet précisément cette divergence, est inapplicable sur la pile de développement :
**INC-087**, à trancher par `CRM-058`, qui soumettra réellement du courrier.

**Le second message rend le panneau « Non classés » démontrable**, et le premier rend démontrable la
double visibilité exigée par la Definition of Done.

### 18.8 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | La visibilité d'un non classé suit sa boîte ; un membre n'en voit aucun ; `classify_message` refuse un message invisible ; la politique de stockage n'ouvre que `clean` |
| Vitest | La réduction du HTML en texte, l'arbre bâti depuis les messages, les états vide, chargement et erreur |
| API | Hors interface, avec de vrais jetons : le refus du membre, le refus du classement d'un message invisible, le téléchargement d'une pièce `clean` et le refus des trois autres statuts |
| E2E `ui` | Le parcours complet au **clavier et à la souris** : tri d'un non classé, classement dans une card, message retrouvé **dans la card et dans l'inbox** |
| Captures | Les **quatre paliers** — 390, 768, 1152, 1440 px —, l'état vide et l'état d'erreur |
| Harnais | `scripts/verify-mail-inbox.sh`, non complaisant, témoin et dégradations comprises |

### 18.9 Limites nommées

- **Aucun envoi depuis l'inbox** : répondre appartient à `CRM-058`. L'écran montre le courrier reçu.
- ~~**Aucun rendu HTML** (§18.4), et l'absence est figée.~~ — **livré par `CRM-140`** (décision 881), §30.
- ~~**Aucune notion de lu / non lu**~~ — **à livrer par la tranche 2** (décision 707), §18 bis.
- **Aucun rôle de tri** (§18.1) : un membre ordinaire ne voit aucun non classé.
- **Aucune suppression de message** depuis l'écran : la purge relève d'une unité RGPD.

---

## 18 bis. Lu / non lu — `CRM-057` tranche 2

*Spécification proposée le 2026-10-26, avant tout code, **validée le même jour par le responsable avec une variante au
point 6** (décision 716) : l'arborescence garde le total et y ajoute les non lus. Arbitrages déjà rendus : la notion est **à livrer** et le rôle
de tri des non classés est **hors périmètre** (décision 707, option C) ; **connecteur MCP : oui, famille `messagerie`**,
l'état lu paraît dans les lectures et **aucun outil ne marque** (décision 708, M1 B) — aucune case nouvelle dans la
matrice. Les points marqués **[proposition]** sont les choix de cette spécification, soumis à la validation du
responsable (décision 715) ; tous sont validés (décision 716).*

### 18 bis.1 Ce que la mesure établit, le 2026-10-26, sur la pile de développement

- **Rien ne porte la lecture en base.** `mail_messages` n'a aucune colonne d'état, et `mail_message_occurrences.flags`
  porte les drapeaux IMAP **de la boîte** — `\Seen` y dit qu'un client de messagerie a ouvert le message dans cette
  boîte, pas qu'une personne l'a lu dans le CRM. Le §18.9 le disait : inventer l'état côté client le rendrait faux dès la
  seconde session.
- **`mail_messages.direction`** vaut `inbound` ou `outbound` ; le seed porte quatre messages reçus (§18.7), aucun envoyé.
- **`public.inbox_arborescence()`** rend `(track_id, track_name, channel_id, channel_name, card_id, card_title, nombre)`,
  `SECURITY INVOKER`, `STABLE` : le compte suit la RLS de l'appelant (§18.3). Elle n'a qu'un appelant, `inbox.ts`.
- **La liste énumère des fils** (§5.4 bis du design system, `docs/SPEC-cards.md` §16.16) : ouvrir une ligne ouvre le
  message le plus récent du fil, et le sélecteur du panneau de lecture donne les autres.
- **Le produit a déjà un état de lecture** : celui des notifications (`docs/SPEC-notifications.md` §15.1,
  `docs/DESIGN_SYSTEM.md` §5.43) — un liseré, des icônes `Mail` / `MailOpen`, « Marquer comme lue / non lue ». La
  tranche le réemploie plutôt que d'en inventer un second.

### 18 bis.2 Les choix

1. **[proposition] L'état est PERSONNEL.** Chaque personne a le sien : ce qu'une administratrice a lu reste non lu pour
   le propriétaire de la boîte. Un état partagé ferait disparaître un message de la vue de tous dès qu'un seul l'a
   ouvert — c'est le mode de défaillance d'une boîte partagée sans attribution, et le CRM n'a pas d'attribution des
   messages.
2. **[proposition] Seul le courrier REÇU peut être non lu.** Un message `outbound` est écrit par le produit au nom d'un
   membre ; il est toujours lu, sans ligne en base.
3. **[proposition] Ouvrir un fil le marque lu tout entier.** Ouvrir une ligne affiche le fil (§5.4 bis) : les messages
   du fil présents dans la page passent lus. Marquer le seul message affiché laisserait la ligne non lue après qu'on l'a
   ouverte, ce qui ferait mentir la liste.
4. **[proposition] « Marquer comme non lu » porte sur le message affiché**, depuis le panneau de lecture ; le fil
   redevient non lu, puisqu'un fil est non lu dès qu'un de ses messages l'est. Le panneau reste ouvert et **ne remarque
   pas lu** le message tant qu'on ne l'a pas rouvert — sinon le geste s'annulerait de lui-même.
5. **[proposition] « Tout marquer comme lu »** en tête de la liste : marque lus les fils de la page affichée
   (cinquante messages au plus, `MESSAGES_PAR_PAGE`). C'est aussi la réponse au démarrage : les messages déjà reçus
   naissent **non lus** pour tous, la migration ne pouvant pas juger qui les a déjà vus — elle ne fabrique aucune
   lecture (`CLAUDE.md` §8).
6. **L'arborescence GARDE LE TOTAL ET Y AJOUTE LES NON LUS** — *variante du responsable (décision 716), qui remplace la
   proposition d'afficher les seuls non lus.* Chaque dossier garde son nombre de messages visibles (§18.3) et porte, à
   côté, une pastille de ses messages non lus par l'appelant — absente à zéro, « 99+ » au-delà de 99, nom accessible
   exact (« 3 messages non lus ») ; sa ligne passe en graisse moyenne quand il en porte. « Non classés » reste affiché à
   zéro (§18.3).
7. **[proposition] Seul l'écran de l'inbox marque.** Lire un message dans le fil de l'affaire, par la recherche ou par le
   connecteur **ne change pas** son état : une lecture ne doit pas écrire, et le fil d'une affaire affiche des
   événements, pas une boîte de réception. C'est une limite nommée (§18 bis.8).

### 18 bis.3 Le modèle — migration `0105_mail_message_reads.sql`

**`public.mail_message_reads`** — une ligne par message lu par une personne :

| Colonne | Type | Contraintes |
|---|---|---|
| `message_id` | `uuid` | FK `mail_messages` `on delete cascade` ; PK composite |
| `user_id` | `uuid` | FK `profiles` `on delete cascade` ; PK composite |
| `read_at` | `timestamptz` | non nul, `now()` |

- **RLS activée ; lecture de SES lignes seules** (`user_id = auth.uid()`). Aucune écriture directe n'est accordée à
  `authenticated` : les deux fonctions ci-dessous sont les seules portes.
- **`public.mark_messages_read(p_message_ids uuid[]) returns integer`** — `SECURITY DEFINER`, `search_path` vide.
  Insère, pour l'appelant, une ligne par message **reçu** que `app.peut_voir_message` lui rend visible, `on conflict do
  nothing`, et rend le nombre de messages visibles désormais lus. **Un identifiant invisible, inconnu ou envoyé est
  ignoré sans erreur** : c'est la règle de discrétion (`docs/SPEC-permissions-rls.md` §7), un refus ne se distinguant pas
  d'une absence. Plus de 200 identifiants : `22023` `too_many_messages`. Sans session : `42501`.
- **`public.mark_message_unread(p_message_id uuid) returns boolean`** — même forme : retire la ligne de l'appelant, rend
  vrai si une ligne a été retirée. Un message invisible rend faux.
- **`public.is_read(public.mail_messages) returns boolean`** — colonne calculée, `STABLE`, `SECURITY INVOKER` : vrai pour
  un message `outbound`, ou si l'appelant en a une ligne de lecture. La liste la demande avec ses colonnes (`is_read`),
  sans jointure côté client.
- **`public.inbox_arborescence()`** gagne une colonne **`unread_count bigint`** : les messages `inbound` sans ligne de
  lecture de l'appelant. Le type rendu change, donc `drop` puis `create` dans la même migration, privilèges reposés ;
  son seul appelant est livré dans le même changement, et le contrat de types est régénéré.

**Index** : la clé primaire `(message_id, user_id)` sert `is_read` et le compte ; aucun autre.

### 18 bis.4 L'écran

La forme est au §5.4 quinquies de `docs/DESIGN_SYSTEM.md` ; le contenu ici.

- **Ligne de fil non lue** : liseré gauche 3 px `--color-brand` et objet en graisse forte ; le nom accessible du bouton
  commence par « Non lu, ».
- **Arborescence** : le total, et la pastille des non lus à côté (§18 bis.2 point 6).
- **Panneau de lecture** : à l'ouverture d'un fil, `mark_messages_read` avec les identifiants du fil présents dans la
  page ; puis la liste et l'arborescence sont relues. Le bouton « Marquer comme non lu » (`Mail`) / « Marquer comme lu »
  (`MailOpen`) se pose dans l'en-tête du message, celui des notifications réemployé.
- **En tête de la liste**, dans une rangée d'action sous l'en-tête du panneau : « Tout marquer comme lu » (`CheckCheck`),
  présent seulement si la page affichée porte un non lu (§5.4 quinquies).
- **Un refus ou une panne du marquage** s'affiche dans le panneau en `role="alert"`, et l'état affiché **n'est pas
  changé** : l'écran ne montre jamais lu ce que la base n'a pas enregistré.

### 18 bis.5 Le connecteur

`crm_card_mail_list` et `crm_mail_get` rendent **`read`**, l'état **de la personne** que le connecteur représente
(`is_read`). Aucun outil ne marque, et **lire par le connecteur ne marque pas** (§18 bis.2 point 7). Aucune case nouvelle
dans la matrice : c'est l'action `consulter` de la famille `messagerie` (`docs/SPEC-mcp.md` §9.2 decies).

### 18 bis.6 Seed

Le profil administrateur du seed **ouvre** le fil « Demande de devis — refonte » par la vraie fonction, avec son propre jeton
(`mark_messages_read`, `api_admin`) : ses deux messages sont lus pour ce profil, « Candidature spontanée » et « Point
d'avancement — migration ERP » restent non lus. Rien n'est écrit en base à la main. Les autres profils voient leurs
messages visibles non lus.

### 18 bis.7 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | la table et sa RLS (lecture de ses lignes seules, aucune écriture directe) ; `mark_messages_read` ignore un invisible et un envoyé, est idempotente, refuse 201 identifiants et l'anonyme ; `mark_message_unread` ; `is_read` ; `unread_count` personnel |
| Vitest | le fil non lu dès qu'un de ses messages l'est ; le compte « 99+ » et son nom exact ; le marquage qui échoue ne change pas l'état |
| API | hors interface, avec les vrais jetons : l'état d'une personne n'est pas celui d'une autre ; le membre ne marque pas un message qu'il ne voit pas (zéro ligne, aucune ligne en base) ; l'insertion directe dans la table est refusée |
| MCP | `read` dans les deux lectures, et lire ne marque pas |
| E2E `ui` | ouvrir un fil le marque lu et fait baisser le compte des non lus, le total restant ; « Marquer comme non lu » le rétablit ; « Tout marquer comme lu » ; au clavier et à la souris |
| Captures | les quatre paliers, une ligne lue et une non lue, l'état d'erreur du marquage |

### 18 bis.8 Limites nommées

- **Aucune synchronisation avec IMAP** : lire dans le CRM ne pose pas `\Seen` dans la boîte, et l'inverse non plus. Les
  deux états ne disent pas la même chose (§18 bis.1).
- **Lire dans le fil de l'affaire, la recherche ou le connecteur ne marque pas** (§18 bis.2 point 7).
- **Aucun temps réel** : le compte se met à jour à la relecture de l'écran, comme aujourd'hui.
- **Le rôle de tri reste absent** (décision 707) : l'absence figée du §18.1 est inchangée.

---

## 19. Composition et réponse — `CRM-058`

### 19.1 Ce que la mesure a établi

**Mesuré le 2026-08-11 contre le Stalwart de `CRM-050`, depuis le réseau Compose :**

| Mesure | Résultat |
|---|---|
| Soumission authentifiée depuis `systeme@crm.p2enjoy.test` | **acceptée** |
| `Reply-To` vers une adresse de card **inexistante** | **transmis tel quel**, aucun contrôle |
| `In-Reply-To` et `References` | **transmis tels quels** |
| `Message-ID` choisi par l'expéditeur | **conservé**, jamais réécrit par le serveur |
| `From` n'appartenant pas au principal authentifié | **`501 5.5.4 You are not allowed to send from this address.`** |
| `Delivered-To` sur le message remis | présent ; `Return-Path` absent des en-têtes stockés |

**Trois conséquences directes, et elles gouvernent la conception :**

1. **Le produit choisit son propre `Message-ID` et le mémorise.** Puisque le serveur ne le réécrit
   pas, l'identifiant écrit à l'envoi est celui que le destinataire citera dans sa réponse : c'est
   la charnière du fil, et la règle 2 du §4.4 s'en sert sans rien deviner.
2. **Le `Reply-To` n'est vérifié par personne d'autre que nous.** Le serveur transmet ce qu'on lui
   donne, y compris une adresse de card qui n'existe pas. La justesse du `Reply-To` est donc une
   responsabilité entière du produit, pas une garantie du transport.
3. **Une identité sortante ne peut expédier que depuis une adresse de son principal** — c'est
   **INC-087**, ouvert par `CRM-057` et **clos ici** : `contact@p2enjoy.test` est ajoutée à la
   liste `emails` de `bizdev@p2enjoy.test` dans le provisionnement. La divergence entrant/sortant
   du §2.2, que le seed promettait depuis `CRM-053`, devient **applicable** au lieu de rester
   décorative. Le modèle était juste ; le provisionnement de développement était incomplet.

### 19.2 Ce que l'unité livre, et ce qu'elle ne livre pas

**Livré** : la file persistante `mail_outbox`, la garde `queue_outbound_email`, le worker qui la
consomme, le `Reply-To` de la card, les en-têtes de fil, l'archivage du message envoyé, le quota
journalier, et la composition depuis la card **comme** depuis l'inbox — par le même chemin de code.

**Non livré, et nommé** : le **backoff** et la reprise après coupure appartiennent à `CRM-059`,
qui les revendique explicitement (« file persistante, backoff, états visibles »). L'unité livre les
colonnes qui les porteront — `attempts`, `next_attempt_at`, `last_error` — et une seule tentative
par message : un échec passe en `failed` et le **dit**, il ne feint pas d'avoir été envoyé.

**La relève reste déclenchée** (§15.2) : le worker d'envoi l'est aussi, par une route interne. La
veille permanente est une seule et même unité, `CRM-059`.

### 19.3 Deux colonnes que `mail_messages` n'avait pas

| Colonne | Pourquoi elle est nécessaire ici |
|---|---|
| `direction` (`inbound` / `outbound`) | Le §5 exige d'archiver le message **envoyé** dans la même table. Sans cette colonne, l'inbox et la card montreraient un message reçu là où il a été écrit, et la règle 2 pourrait rattacher une réponse à notre propre envoi comme s'il venait du correspondant |
| `references_ids` (`text[]`) | Une réponse doit citer **toute** la chaîne, non le seul parent. Sans elle, le produit ne pourrait reconstituer que le dernier maillon, et un client de messagerie couperait le fil au deuxième aller-retour |

`references_ids` est renseignée **à l'ingestion** comme à l'envoi. La règle 2 du §4.4 continue de
recevoir `In-Reply-To` et `References` en paramètres : elle lit ce que le message porte, non ce que
la base a retenu.

> **CETTE PHRASE A ÉTÉ FAUSSE DE `CRM-058` AU 2026-08-19, ET C'EST MESURÉ.** À l'envoi, oui :
> `marquer_envoi_reussi` compose la chaîne en SQL. À l'ingestion, **non** :
> `PostgrestClient.enregistrer_message` composait sa charge d'insertion sans la colonne, qui
> retombait donc sur son `default '{}'`. Tout message **reçu** était par conséquent sa propre
> racine au sens de `app.cle_fil`, et aucun fil ne pouvait se former à partir de courrier entrant —
> défaut invisible à toute assertion portant sur la ligne écrite, l'insertion réussissant
> parfaitement. Corrigé par `CRM-081` tranche 2 f (`docs/SPEC-cards.md` §16.16.2), qui met la
> colonne dans la charge et fige la coïncidence par deux tests portant sur la charge elle-même.
>
> **Aucune reprise rétroactive** n'accompagne ce correctif : les messages ingérés avant lui gardent
> `references_ids` = `[]`. Relire leurs en-têtes supposerait de les redemander à l'IMAP, ce que rien
> ne conserve en base. L'écart est nommé, non masqué.

### 19.4 La file, et qui peut y écrire

`queue_outbound_email(p_card_id, p_identity_id, p_to, p_cc, p_subject, p_body_text,
p_in_reply_to_message_id)` — `SECURITY DEFINER`, ouverte à `authenticated`.

Elle refuse, dans cet ordre, et chaque refus porte son code :

| Refus | Code | Motif |
|---|---|---|
| `not_authenticated` | `42501` | aucune session |
| `forbidden` | `42501` | pas de droit d'**écriture** sur la card : envoyer au nom d'une affaire, c'est y ajouter du contenu |
| `identity_not_available` | `42501` | l'identité n'existe pas, ou n'est pas celle de l'appelant. **L'identité de service n'est empruntable par personne**, administrateur compris, depuis la décision 805 (INC-335) : elle ne sert qu'aux envois automatiques (§14.2). **Mesuré** : `P0002`, d'abord retenu, est traduit par PostgREST en **500** — un refus d'autorisation ne doit pas se présenter comme une panne de serveur |
| `card_not_available` | `23514` | card archivée, en corbeille, ou d'un autre workspace que l'identité |
| `recipient_required` | `23514` | aucun destinataire : un message sans destinataire n'est pas un message |
| `quota_exceeded` | `23505` | le quota journalier de l'identité est atteint |

**Le quota est compté sur la JOURNÉE UTC en cours**, et porte sur les lignes `queued`, `sending` et
`sent` — non sur les seules `sent`. Compter les envois réussis laisserait mettre en file mille
messages qui partiraient tous : le quota protège le **serveur d'envoi**, pas la statistique.

**Le contrôle a lieu DEUX fois, et ce n'est pas une redondance.** À la mise en file, pour que le
refus soit immédiat et visible par celui qui écrit ; à l'envoi, parce que c'est le worker qui
dépense réellement le quota, et que plusieurs messages peuvent avoir été acceptés avant que le
premier ne parte. **La règle est celle du worker** ; celle du RPC est une politesse.

### 19.5 Ce que le worker compose

1. `From` = `from_address` de l'identité, `Reply-To` = **adresse de la card** ;
2. `Message-ID` choisi par le produit, mémorisé dans `mail_outbox.sent_message_id` puis dans
   `mail_messages` ;
3. `In-Reply-To` = `rfc822_message_id` du parent, `References` = `references_ids` du parent **suivi
   de** son `rfc822_message_id` — la chaîne complète, dans l'ordre ;
4. envoi par soumission authentifiée, avec les identifiants tirés de Vault comme pour la relève ;
5. au succès : `status = 'sent'`, archivage dans `mail_messages` en `direction = 'outbound'`,
   `card_event` de type **`mail_sent'** — douzième type —, et dépôt dans le dossier IMAP de la card
   lorsqu'il existe ;
6. à l'échec : `attempts` incrémenté, `last_error` **assaini** — un code, jamais le texte du
   serveur (§13.7) —, `status = 'failed'`.

**Le `Reply-To` est ce qui ramène les réponses dans le CRM**, et la mesure du §19.1 rappelle qu'il
n'est vérifié par personne d'autre : une card sans `email_local_part` ne doit donc jamais produire
d'envoi, et la garde le refuse avant la file.

### 19.6 Composer depuis la card ou depuis l'inbox

**Le même chemin de code**, et la même RPC : seule la card sélectionnée diffère. Depuis la card,
elle est connue ; depuis l'inbox, elle est celle du message ouvert — répondre à un message classé
répond **dans son affaire**. Un message non classé ne se répond pas : il faut d'abord le classer,
et l'écran le dit plutôt que d'offrir une action qui échouerait.

### 19.7 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | Les six refus de la garde, le quota compté sur la journée UTC, l'invariant `direction`, le douzième type d'événement |
| pytest | La composition des en-têtes de fil, sans serveur : `References` complet, `Reply-To` de la card, `Message-ID` mémorisé |
| API | Hors interface : le refus d'écriture, l'identité d'autrui, la card archivée, le quota atteint |
| E2E `mail` | **L'aller-retour complet** : le produit envoie, le destinataire **reçoit réellement**, répond au `Reply-To`, et la réponse est relevée puis **classée dans la même card** par la règle 1 |
| E2E `ui` | Répondre depuis la card et depuis l'inbox, au clavier et à la souris |
| Harnais | `scripts/verify-mail-envoi.sh`, non complaisant, avec son témoin |

### 19.8 Limites nommées

- **Aucun backoff, aucune reprise** : un échec est `failed` et le dit. `CRM-059`.
- **Aucune pièce jointe à l'envoi** : la colonne `attachments` existe, rien ne l'alimente, et
  l'absence est figée par une assertion.
- **Aucune signature d'utilisateur** : le §5 la mentionne, aucune table ne la porte.
- **Aucun envoi en masse** : la file est unitaire, et le quota la borne.

---

## 19 bis. Copie cachée et pièces jointes à l'envoi — `CRM-058` tranche 2

*Spécification proposée le 2026-10-26, avant tout code, **validée telle quelle le même jour** (décision 720). Arbitrages déjà rendus : les **pièces jointes à l'envoi** et la
**copie cachée** sont à livrer (décision 707, option B) ; **connecteur MCP** : la copie cachée seule, dans
`crm_mail_send` (famille `messagerie`, action `ajouter`), **aucune pièce jointe** par le connecteur (décision 708, M2 B) —
aucune case nouvelle dans la matrice. Les points marqués **[proposition]** sont soumis à la validation du responsable
(décision 719).*

### 19 bis.1 Ce que la mesure établit, le 2026-10-26, sur la pile de développement

- **`mail_outbox.attachments jsonb` existe depuis la migration 30, et rien ne l'alimente** (§19.8) ; aucune colonne ne
  porte une copie cachée, et `composition.destinataires` le dit : l'enveloppe est `To` puis `Cc`.
- **`queue_outbound_email`** a sept paramètres et sept refus (migrations 58 et 60) ; l'insertion passe par
  `app.mail_outbox_inserer`, que les séquences de relance emploient aussi. Trois appelants : `webapp/src/lib/envoi.ts`,
  `crm_mail_send` du connecteur, et les jobs de séquence par la porte extraite.
- **Un seul bucket de courrier**, `mail-attachments`, privé, sans plafond de taille ni de type ; sa seule politique ouvre
  la **lecture** d'une pièce reçue `clean` (§18.5). Aucune écriture n'y est ouverte à `authenticated`.
- **L'antivirus** (`clamav`) n'existe qu'en développement : en production, une pièce reçue est enregistrée `skipped`, donc
  non téléchargeable (§4.3). Le worker d'envoi ne parle à aucun antivirus.
- **`mail_messages`** archive l'envoi en `outbound` avec `to_addresses` et `cc_addresses` ; aucune colonne de copie
  cachée.

### 19 bis.2 Les choix

1. **La copie cachée** : une colonne `bcc_addrs text[]` dans `mail_outbox`, un paramètre `p_bcc` dans
   `queue_outbound_email`. Les adresses entrent **dans l'enveloppe SMTP seulement**, jamais dans un en-tête : c'est la
   définition même d'une copie cachée. Même borne que `To` et `Cc` : cinquante adresses.
2. **[proposition] La copie cachée reste lisible dans l'affaire** : le message archivé porte `bcc_addresses`, que
   l'écran affiche « Cci » à qui lit l'affaire. Cachée aux destinataires, pas à l'équipe qui suit l'affaire.
3. **[proposition] Une pièce jointe se prend sur l'ordinateur** (sélection ou glisser-déposer). Réemployer une pièce
   reçue de l'affaire est hors de cette tranche.
4. **[proposition] Plafonds** : **10 fichiers** et **10 Mo au total** par message. Au-delà, le formulaire refuse avant
   tout envoi et la base refuse à nouveau (`attachments_too_large`, `too_many_attachments`) — la règle est en base.
5. **Le chemin du fichier** : le navigateur dépose d'abord chaque fichier dans un bucket privé nouveau,
   **`mail-outbound-attachments`**, sous `<espace>/<personne>/<uuid>/<nom>` ; puis `queue_outbound_email` reçoit leurs
   chemins (`p_attachments`) et **vérifie** que chaque objet existe dans ce bucket, appartient à l'appelant
   (`storage.objects.owner`) et à l'espace de l'affaire, et que les plafonds tiennent. Une politique de stockage n'ouvre
   que l'**insertion** dans son propre dossier et la **suppression** de ses propres objets non encore mis en file ; aucune
   lecture par un client.
6. **[proposition] L'antivirus à l'envoi** : quand `CLAMAV_HOST` est posé, le worker soumet chaque pièce à l'antivirus
   avant l'envoi ; une pièce **infectée** fait échouer l'envoi sans reprise (`attachment_infected`) et le dit. Sans
   antivirus — la production aujourd'hui —, l'envoi part.
7. **L'archive** : au succès, chaque pièce devient une ligne de `mail_attachments` du message archivé, son objet copié
   dans `mail-attachments` ; son statut est celui de l'analyse — `clean` après ClamAV, `skipped` sans antivirus, la règle
   de la réception (§4.3). Elle se télécharge donc depuis l'affaire **dans les mêmes conditions qu'une pièce reçue**.
8. **[proposition] Les dépôts abandonnés** : le formulaire retire ses objets quand on l'annule ou qu'on retire un fichier ;
   un objet jamais mis en file est effacé après **24 heures**. *Précisé en codant (mesure)* : un `delete` SQL sur
   `storage.objects` laisserait le fichier dans MinIO ou S3 ; la base **liste** donc les dépôts à effacer
   (`depots_envoi_abandonnes`) et `mail-sync` les efface **par l'API de stockage**, à la fin de chaque vidage de la file —
   la veille de `mail-sync` ne s'occupe que du courrier entrant, et aucun `pg_cron` n'atteint l'API de stockage.
9. **Le connecteur** : `crm_mail_send` gagne `bcc` (cinquante adresses au plus) ; aucune pièce jointe (décision 708).

### 19 bis.3 Le modèle — migration `0106_envoi_cci_pieces_jointes.sql`

- `mail_outbox.bcc_addrs text[] not null default '{}'` ; `mail_messages.bcc_addresses text[] not null default '{}'`.
- Bucket **`mail-outbound-attachments`**, privé, plafond **10 Mo** par objet ; politiques d'insertion, de **lecture de ses
  propres dépôts** et de suppression bornées au dossier `<espace dont l'appelant est membre>/<auth.uid()>/` ; la
  suppression refusée si l'objet est cité par une ligne de `mail_outbox`. *Mesuré en codant* : les politiques de
  `storage.objects` ne se créent que sous `supabase_admin` (patron de la migration 29) — elles vivent dans une seconde
  migration, **`0107`**, qui n'appelle que les prédicats `app.piece_envoi_deposable` et `app.piece_envoi_retirable` créés
  sous `postgres` par la `0106` ; la lecture de ses propres dépôts est nécessaire, l'API de stockage relisant l'objet
  avant de le retirer.
- `queue_outbound_email(… , p_bcc text[] default '{}', p_attachments jsonb default '[]')` — **retirée puis recréée** (sa
  signature change) avec ses sept refus intacts, plus trois : `attachment_not_available` (`23514` : objet absent, d'un
  autre bucket, d'un autre propriétaire ou d'un autre espace), `too_many_attachments` et `attachments_too_large`
  (`23514`). `attachments` reçoit `[{path, filename, mime_type, size_bytes}]`, la taille et le type **lus dans
  `storage.objects`**, jamais crus du client.
- `reserver_envois` rend `bcc_addrs` et `attachments` ; `marquer_envoi_reussi` archive `bcc_addresses` et écrit les lignes
  de `mail_attachments` avec le statut que le worker lui passe.
- `public.depots_envoi_abandonnes(p_age interval default '24 hours')`, réservée à `service_role` : les objets de
  `mail-outbound-attachments` plus vieux que `p_age` qu'aucun envoi **en cours** ne cite ; `mail-sync` les efface par
  l'API de stockage (point 8).
- **L'archive d'une pièce envoyée** se dépose dans `mail-attachments` sous **`<affaire>/<envoi>/<empreinte>`** : la
  contrainte `mail_attachments_chemin_sans_nom` exige deux UUID puis une empreinte (mesuré : un premier chemin
  `outbound/…` a été refusé à l'archive).

### 19 bis.4 Le worker

`composer` ajoute chaque pièce (`add_attachment`, type MIME lu en base) ; `destinataires` rend `To`, `Cc` **et** `Bcc`,
dédoublonnés ; aucun en-tête `Bcc` n'est écrit. Les fichiers sont lus par la clé de service. ClamAV, s'il est configuré,
juge chaque pièce avant l'ouverture SMTP (§19 bis.2 point 6). **L'archive est déposée AVANT l'envoi** : un dépôt qui
échouerait après la remise laisserait un message parti que la file ne pourrait pas marquer, et que la reprise
renverrait. Une pièce introuvable fait échouer l'envoi (`attachment_missing`), une pièce infectée aussi
(`attachment_infected`), sans reprise ; un stockage injoignable est une panne (`storage_unavailable`) qui se rejoue avec le
délai d'un serveur injoignable.

### 19 bis.5 L'écran

`docs/DESIGN_SYSTEM.md` §5.4 sexies. Dans `FormulaireEnvoi`, depuis l'affaire comme depuis l'inbox (§19.6) : un lien
« Ajouter Cci », sous le champ « Destinataires » — le formulaire n'a pas de champ « Copie » —, qui révèle le champ ;
**le nom du fichier est translittéré** dans le chemin de dépôt, l'API de stockage refusant une clé accentuée
(« Proposition révisée.pdf » part sous « Proposition revisee.pdf »), et « Joindre des fichiers » (`Paperclip`) qui ouvre le sélecteur ; la liste des
fichiers avec nom, taille et un bouton de retrait ; le total et le plafond écrits ; chaque refus nommé. Le message
archivé affiche « Cci » et ses pièces comme un message reçu.

### 19 bis.6 Seed

Un envoi de démonstration **réellement soumis** par le worker depuis l'affaire « Refonte du site vitrine », avec une copie
cachée vers une boîte locale et une pièce jointe texte : le message archivé montre « Cci » et sa pièce, et la boîte de la
copie cachée le reçoit **sans** en-tête `Bcc`.

### 19 bis.7 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | colonnes et bucket ; les trois refus nouveaux ; taille et type lus en base ; politiques de stockage ; le job de purge |
| pytest | la composition : pièces attachées, aucun en-tête `Bcc`, l'enveloppe `To` + `Cc` + `Bcc` ; le verdict antivirus |
| API | le dépôt hors de son dossier refusé ; la pièce d'autrui refusée à la mise en file ; les plafonds |
| E2E `mail` | l'aller complet : la copie cachée **reçoit** le message, sans en-tête `Bcc` ; la pièce arrive intacte (empreinte) |
| E2E `ui` | joindre, retirer, dépasser le plafond, ajouter une Cci, au clavier et à la souris ; captures aux quatre paliers |
| MCP | `bcc` transmis ; aucune pièce jointe |

### 19 bis.8 Limites nommées

- **Aucune pièce jointe par le connecteur** (décision 708).
- **Aucun réemploi d'une pièce reçue** (point 3, si validé).
- **Sans antivirus, aucune analyse** des pièces envoyées, comme pour la réception (§4.3).

---

## 20. Backfill, résilience et supervision — `CRM-059`

### 20.1 Ce que la mesure a établi

**Mesuré le 2026-08-11 contre le Stalwart de `CRM-050` :**

| Mesure | Résultat |
|---|---|
| `UID SEARCH SINCE <date>` | **honoré** — le serveur filtre, le service n'a rien à trier |
| `UID FETCH` sur une liste d'UID | **honoré** — les lots sont possibles sans relire toute la boîte |
| Capacités annoncées | `IMAP4rev2`, **`IDLE`**, `ESEARCH`, `WITHIN`, `UIDPLUS` |
| `MAIL_SYNC_POLL_INTERVAL` | **déclarée, consommée par rien** — `README.md` la dit « en attente de `CRM-054` », qui ne l'a pas prise |

**Trois conséquences :**

1. **Le backfill est une SÉLECTION, pas un tri.** `SINCE` bornant côté serveur, la profondeur
   `backfill_months` se traduit en une date et rien de plus. Rapatrier toute la boîte pour ignorer
   ce qui dépasse ferait payer au réseau ce que le serveur sait faire.
2. **La veille peut être permanente**, `IDLE` étant annoncé. Elle ne le sera pourtant **pas** ici :
   voir §20.2.
3. **`MAIL_SYNC_POLL_INTERVAL` cesse d'être décorative.** Une variable documentée que rien ne lit
   est une promesse tenue par personne.

### 20.2 Ce que l'unité livre, et ce qu'elle ne livre pas

**Livré** : le backoff exponentiel borné de la file d'envoi, la reprise d'un envoi orphelin, la
reprise d'un rangement manqué — dette nommée de `CRM-056` —, le backfill par lots, la boucle de
veille qui consomme `MAIL_SYNC_POLL_INTERVAL`, et l'état de chaque compte **conforme à la réalité**.

**Non livré, et nommé** : la veille par **`IDLE`**. Le serveur l'annonce, mais elle suppose une
connexion maintenue par compte, sa surveillance, et sa reprise — trois choses qu'une boucle de
scrutation n'exige pas. Une scrutation à intervalle déclaré est **observable et rejouable** ; une
connexion permanente est un état de plus à superviser. Le passage à `IDLE` est une optimisation qui
demandera sa propre mesure : combien de comptes, quelle latence réellement gagnée.

### 20.3 Le backoff, et pourquoi il n'existait pas avant

`CRM-058` marquait un envoi échoué `failed` **à la première tentative**, et l'écrivait : « un échec
passe `failed` et le dit ; il ne feint pas d'avoir été envoyé ». C'était honnête et insuffisant —
un serveur d'envoi momentanément indisponible perdait le message.

| Tentative | Délai avant la suivante |
|---|---|
| 1 | 1 minute |
| 2 | 4 minutes |
| 3 | 16 minutes |
| 4 | 64 minutes |
| 5 | **`failed` définitif** |

**La progression est géométrique et BORNÉE**, et les deux comptent : sans progression, un serveur
en panne serait harcelé toutes les minutes ; sans borne, un message adressé à un domaine qui
n'existe plus resterait en file pour toujours, et l'exploitant croirait qu'il va partir.

**UN REFUS N'EST PAS UNE PANNE, ET NE SE REJOUE PAS.** Un mot de passe faux (`auth_failed`), une
adresse refusée (`sender_rejected`) ou un message refusé par le serveur ne deviendront pas justes
en attendant : ces codes passent `failed` **immédiatement**. Seules les pannes de transport —
`connection_refused`, `timeout`, `tls_failed`, `protocol_error` — sont rejouées. Rejouer un refus,
c'est répéter une erreur en espérant un autre résultat.

### 20.4 Un envoi orphelin, et pourquoi il faut le reprendre

`reserver_envois` marque `sending` **avant** de soumettre. Si le worker meurt entre les deux, la
ligne reste `sending` pour toujours : aucune passe ne la reprend, aucun statut ne la signale, et
`CRM-058` le disait déjà — « `reserved` peut dépasser `sent + failed` ».

Une ligne `sending` depuis plus de **dix minutes** est considérée orpheline et repasse `queued`,
avec sa tentative comptée. **Le seuil est généreux à dessein** : un envoi lent n'est pas un envoi
mort, et reprendre trop tôt enverrait le message deux fois.

### 20.5 La reprise d'un rangement manqué — dette de `CRM-056`

`CRM-056` tentait le rangement à la **première** vue d'un message et journalisait un refus sans le
rejouer. La dette est réglée ici : un message classé dont aucune occurrence n'est rangée dans le
dossier de sa card est **repris à la relève suivante**, sans qu'il faille recevoir un nouveau
message pour déclencher la reprise.

### 20.6 Le backfill par lots

À la connexion d'une boîte, `backfill_months` fixe la profondeur. La relève traite la boîte
courante **d'abord**, puis un lot d'historique borné — jamais l'inverse : le courrier du jour ne
doit pas attendre que dix ans d'archives soient descendus.

La progression vit dans `sync_state`, qui existe depuis `CRM-052` sans consommateur : elle porte le
plus petit UID déjà rapatrié par dossier. **Reprendre est donc possible après une coupure**, et
rejouer ne redescend pas ce qui l'a déjà été.

**`backfill_months = 0` signifie « aucun historique », et c'est le défaut.** Contrairement au
`daily_quota` de `CRM-053`, ce zéro-là est **le bon choix par défaut** : importer dix ans d'archives
sans qu'on l'ait demandé serait une décision prise à la place de l'exploitant.

### 20.6 bis Le plan de relève, écrit avant d'être codé

*`docs/JOURNAL.md` décision 342. Le §20.6 pose la règle ; ce chapitre pose l'algorithme, parce qu'un
« lot d'historique borné » ne se code pas sans dire de quoi il est fait.*

#### 20.6 bis.1 Ce que fait la relève aujourd'hui, et pourquoi c'est intenable

MESURÉ dans `mail_sync/ingestion.py` : chaque relève exécute `imap.search(["ALL"])`, puis
`imap.fetch` sur **tout** ce que la recherche rend. Le dédoublonnage de la base fait que rien n'est
dupliqué — la relève est idempotente, et elle le restera —, mais **le réseau paie la boîte entière à
chaque tour**. Sur une boîte de dix mille messages relevée toutes les minutes, c'est dix mille
`FETCH RFC822` par minute pour zéro message neuf.

Ce n'était pas un défaut de `CRM-054` : `sync_state` n'avait alors aucun consommateur, et l'unité
livrait ce qui était démontrable. C'est la dette que ce chapitre solde.

#### 20.6 bis.2 `sync_state` porte une PLAGE, et non un seul UID

Le §20.6 écrit que `sync_state` « porte le plus petit UID déjà rapatrié par dossier ». Un seul UID ne
suffit pas, et la raison est mécanique : connaître le plancher dit jusqu'où l'historique est
descendu, mais **pas** où commence le courrier neuf. Il faudrait alors, à chaque tour, redemander
tout ce qui est au-dessus du plancher — c'est-à-dire exactement le comportement qu'on veut corriger.

`sync_state[<dossier>]` porte donc `{"uid_min": …, "uid_max": …}` : les bornes de la plage
**contiguë** déjà rapatriée. Deux nombres au lieu d'un, et le contrat du §20.6 est tenu — `uid_min`
est bien « le plus petit UID déjà rapatrié ».

**La plage est contiguë par construction**, jamais par hypothèse : les deux passes ci-dessous ne
peuvent que l'étendre par le haut ou par le bas, jamais créer de trou. Un dossier sans état est un
dossier dont rien n'a été rapatrié, ce qui est différent d'un dossier vide.

#### 20.6 bis.3 Deux passes, et le courrier du jour d'abord

| Passe | Ce qu'elle demande | Bornée par |
|---|---|---|
| **Courante** | `UID SEARCH UID <uid_max+1>:*` | rien — le neuf est rare et doit descendre en entier |
| **Historique** | `UID SEARCH SINCE <borne> UID 1:<uid_min-1>`, dont on ne garde que les **plus grands** | `LOT_BACKFILL` messages |

**Le courrier du jour ne doit pas attendre que dix ans d'archives soient descendus** (§20.6). La
passe courante est donc exécutée **la première**, et elle n'est pas bornée : borner le neuf ferait
prendre du retard à une boîte active sans jamais le rattraper, puisque chaque tour en laisserait
derrière lui.

La passe d'historique descend **du plus récent vers le plus ancien** — les plus grands UID sous
`uid_min` d'abord. L'inverse rapatrierait les archives les plus vieilles en premier, c'est-à-dire
celles dont personne n'a besoin tout de suite.

**`LOT_BACKFILL` vaut 200.** Ce n'est pas une mesure, et il est écrit ici que ce n'en est pas une :
c'est un ordre de grandeur choisi pour qu'un tour reste court devant un intervalle de veille de
soixante secondes. La valeur devra être mesurée le jour où une vraie boîte historique sera relevée ;
d'ici là, elle est nommée plutôt que dissimulée.

#### 20.6 bis.4 Premier contact : le courrier du jour, pas la boîte entière

Sans état, `uid_max` est inconnu et la passe courante ne peut pas s'écrire. Elle demande alors
`UID SEARCH SINCE <aujourd'hui>` : **le courrier du jour, et rien d'autre**.

C'est le point le plus contre-intuitif du chapitre, et il est délibéré. Un premier contact qui
descendrait toute la boîte ferait exactement ce que `backfill_months` sert à éviter, et le ferait
**sans qu'on l'ait demandé** — alors que le défaut de `backfill_months` est `0`, c'est-à-dire
« aucun historique ». Ce qui précède le jour du branchement **est** de l'historique, et
l'historique ne descend que si l'exploitant l'a demandé.

#### 20.6 bis.5 `backfill_months = 0` : aucune passe d'historique, jamais

Zéro ne borne pas la profondeur à zéro mois : il **supprime la passe**. Aucune recherche `SINCE`
n'est émise, `uid_min` ne bouge jamais, et l'état du dossier ne porte que la progression du courant.

C'est le défaut, et le §20.6 dit pourquoi : « importer dix ans d'archives sans qu'on l'ait demandé
serait une décision prise à la place de l'exploitant ».

#### 20.6 bis.6 Ce que le plan ne fait pas

- **Il ne comble aucun trou.** Si un message est supprimé puis un autre déposé avec un UID
  intermédiaire — ce qu'un serveur IMAP conforme ne fait pas, les UID étant strictement croissants
  par dossier —, le plan ne le verrait pas. La garantie repose sur `UIDVALIDITY`, non sur une
  vérification du service.
- **Il ne traite pas un changement d'`UIDVALIDITY`.** Lorsqu'un serveur réinitialise ses UID, l'état
  enregistré désigne des messages qui n'existent plus. Le cas est **nommé et non traité** : il
  demande d'invalider `sync_state` pour ce dossier, et cette décision appartient à une reprise qui
  saura la mesurer. En attendant, un tel dossier redescend son courant sans rien perdre — la base
  dédoublonne — mais son historique paraîtra complet à tort.
- **Il ne borne pas la taille d'un lot en octets**, seulement en nombre de messages. Deux cents
  messages porteurs de pièces jointes lourdes tiennent plus longtemps que deux cents messages nus ;
  `MAIL_MAX_ATTACHMENT_MB` borne chaque pièce, pas le tour.

### 20.7 L'état affiché est conforme à la réalité

La Definition of Done l'exige en ces termes : « état affiché conforme à la réalité ». Ce qui est
montré est donc **lu**, jamais supposé :

| Fait montré | D'où il vient |
|---|---|
| Dernière relève réussie | `last_sync_at`, écrit par la relève elle-même — **promesse non tenue jusqu'à `CRM-127`** (INC-340, §23.2) |
| Dernier incident | `status` et `last_error` — un **code**, jamais le texte du serveur (§13.7) |
| Messages en attente d'envoi | comptés dans `mail_outbox`, statut `queued` ou `sending` |
| Envois en échec définitif | comptés dans `mail_outbox`, statut `failed` |

**SI LE SERVICE EST ARRÊTÉ, L'ÉCRAN LE DIT** (§7) plutôt que d'afficher un état figé qui passerait
pour frais. Une dernière relève ancienne n'est pas un incident : c'est un fait, et l'écran donne sa
date au lieu d'inventer un jugement.

### 20.10 La boucle de veille — sa forme, et pourquoi celle-là

*Écrit avant le code, `docs/JOURNAL.md` décision 341.*

`MAIL_SYNC_POLL_INTERVAL` est déclarée depuis `CRM-051` et **lue par rien** (§20.1). Ce chapitre dit
ce qui la lit.

#### 20.10.1 Un fil d'exécution, et non une boucle asynchrone

Le service est **synchrone de bout en bout** : `PostgrestClient` parle en HTTP bloquant, les routes
de `app.py` sont des `def` et non des `async def`, et `relever_compte` bloque sur IMAP. Une boucle
`asyncio` obligerait à réécrire ces trois couches, ou à les envelopper dans un exécuteur — c'est-à-dire
à retrouver un fil, en ayant payé une conversion.

La veille est donc un **fil d'arrière-plan démarré avec l'application** et arrêté avec elle, piloté
par un `threading.Event` : l'attente s'interrompt à la demande d'arrêt, au lieu de retenir le
conteneur jusqu'à la fin de l'intervalle. Un service qui met soixante secondes à s'arrêter est un
service qu'un orchestrateur finit par tuer.

#### 20.10.2 La décision est PURE, l'attente ne l'est pas

Ce que la boucle **décide** — quels comptes relever, dans quel ordre, quand le prochain tour est dû —
est une fonction pure de l'horloge et de l'état, dans `mail_sync/veille.py`. Ce qu'elle **fait** —
dormir, appeler la relève — vit dans le pilote.

Le motif n'est pas esthétique : `CLAUDE.md` §18 proscrit la « temporisation arbitraire », et une
preuve qui devrait attendre soixante secondes pour observer un second tour serait exactement cela.
La décision étant pure, elle se vérifie **sans dormir une seule fois** en avançant une horloge
injectée.

#### 20.10.3 Un compte en panne n'arrête pas la veille, et ne masque pas les autres

Chaque compte est relevé dans son propre essai. Une exception est **journalisée et absorbée**, puis
le tour continue avec le compte suivant. C'est le seul endroit du service où une exception large est
admise, et la raison est écrite : la solution de rechange — laisser remonter — arrêterait le fil, et
un seul compte mal configuré priverait de courrier tous les autres.

**L'absorption n'est pas un silence.** L'événement `veille_compte_echoue` porte l'identifiant du
compte et le **type** de la panne, jamais son texte, qui peut contenir un identifiant de connexion
(§13.7). Le `try/except` vide que `CLAUDE.md` §18 proscrit est celui qui ne dit rien ; celui-ci dit.
*Précisé par `CRM-135` (§24.2, INC-349) : la liste fermée du formateur jetait ces deux champs, et la ligne sortait sans
détail. Elle les admet désormais, avec le code de l'échec et les compteurs du tour.*

#### 20.10.4 Un tour ne se chevauche jamais avec lui-même

Si un tour dure plus que l'intervalle, le suivant ne démarre pas en parallèle : l'intervalle est
compté **à partir de la fin** du tour précédent, non de son début. Deux relèves simultanées du même
compte ne perdraient aucun message — le dédoublonnage est tenu par la base depuis `CRM-054` — mais
elles doubleraient la charge IMAP au moment précis où le serveur est déjà lent.

#### 20.10.5 `MAIL_SYNC_POLL_INTERVAL = 0` désactive la veille, explicitement

Zéro n'est pas « aussi vite que possible » : c'est **aucune veille**, et la relève reste alors
déclenchée par l'API interne comme `CRM-054` l'a livrée. Ce cas existe pour l'environnement de
preuve, où le scénario veut décider lui-même du moment de la relève, et pour un exploitant qui
pilote la relève depuis son propre ordonnanceur.

Le journal de démarrage dit **laquelle des deux** est en vigueur — `veille_demarree` avec son
intervalle, ou `veille_desactivee`. Un service dont on ne sait pas s'il relève tout seul est un
service qu'on interroge en le regardant tourner.

**La borne basse est de cinq secondes**, hors le zéro. Elle n'est pas un réglage de confort : une
scrutation d'une seconde par compte transformerait la veille en charge constante sur Stalwart et sur
PostgREST, pour un courrier qui n'arrive pas plus vite. La borne haute est d'une heure — au-delà,
`last_sync_at` vieillirait au point que l'écran d'état du §20.7 ne distinguerait plus une veille
lente d'un service arrêté.

#### 20.10.6 Quels comptes sont relevés

Ceux de `mail_inbound_accounts` **dont un secret est présent**. Un compte sans mot de passe ne peut
pas être relevé — la route `poll` rend déjà `409` dans ce cas —, et l'inclure ferait un échec par
tour et par compte incomplet, c'est-à-dire un journal qui crie sans rien apprendre à personne.

L'ordre est celui de `last_sync_at` **croissante, les jamais relevés d'abord** : le compte le plus en
retard passe en tête. Trier par date de création ferait attendre un compte neuf derrière tous les
anciens.

*Complété par `CRM-135` (§24.4, §24.5) : une boîte `disabled` n'est pas relevée, et une boîte au mot de passe refusé
est espacée.*

### 20.11 L'écran d'état — sa forme, et ce qu'il n'invente pas

*Écrit avant le code, `docs/JOURNAL.md` décision 346. Le §20.7 dit les faits à montrer ; ce
chapitre dit où et comment.*

#### 20.11.1 Une adresse dédiée, suivant le patron de `CRM-075`

`/reglages/messagerie` porte l'écran, monté par `App` **hors de la table `ROUTES`** — même patron
que `CHEMIN_ADMIN_ARBORESCENCE` : une adresse nommée, chargée à la demande, et l'index des
réglages (`/reglages`) gagne une seconde entrée. Aucune modale, aucun onglet transverse : le §5.13
a déjà tranché ce cas pour l'unique autre écran de la même famille.

#### 20.11.2 Deux lectures, aucune règle nouvelle

L'écran n'ouvre **aucune** politique : il lit ce que `CRM-052` et `CRM-058` ont déjà rendu
lisible.

- **Les comptes entrants** — `mail_inbound_accounts`, filtré par la RLS posée en `0022` : un
  administrateur du workspace voit tous les comptes ; un membre ordinaire ne voit que le sien s'il
  en possède un ; sans droit, la ligne n'apparaît simplement pas. L'écran ne recalcule rien : il
  affiche exactement ce que la requête rend.
- **La file sortante** — deux comptages sur `mail_outbox`, filtrés par `app.can_read_card` (RLS
  de `0030`) : `status in ('queued','sending')` pour « en attente », `status = 'failed'` pour
  « échec définitif ». Un membre ordinaire ne voit donc que la file des cards qu'il peut lire —
  c'est la portée déjà tenue par `CRM-057`, pas une portée inventée ici.

#### 20.11.3 Le tableau des comptes suit `docs/DESIGN_SYSTEM.md` §5.9

Colonnes comparables — boîte, dernière relève, dernier incident — donc un `table`, pas une liste
imbriquée : le §5.13 réserve ce patron aux objets dont les colonnes diffèrent par ligne, ce qui
n'est pas le cas ici.

| Colonne | Valeur | Vide quand |
|---|---|---|
| Boîte | `label` | jamais |
| Dernière relève réussie | `last_sync_at`, date/heure locale, monospace à droite (§5.9) | `last_sync_at IS NULL` — « Jamais relevée » **en toutes lettres**, pas une cellule vide : l'absence de relève est un fait à nommer, pas une donnée manquante |
| Dernier incident | `last_error` traduit par un dictionnaire fermé — voir §20.11.4 | `status <> 'error'` — cellule vide, §5.9 |

#### 20.11.4 Le dictionnaire des six codes, fermé et centralisé

`last_error` porte un des six codes de la contrainte `mail_inbound_accounts_erreur_code` (`0022`).
L'écran ne les affiche jamais bruts — un code d'API n'est pas un texte pour un humain — et ne
traduit rien d'autre que ces six valeurs : un septième code que la base rendrait serait un défaut
de contrainte, pas un texte à deviner côté client. Les six clés vivent dans
`webapp/src/i18n/fr.ts`, à côté des autres dictionnaires fermés du produit.

#### 20.11.5 Les deux compteurs sont des chiffres nommés, pas une pilule

« En attente d'envoi » et « Échecs définitifs » sont deux chiffres, chacun sous son libellé —
même sobriété que les compteurs de colonne du board (§5.2 bis) : un chiffre grand, un libellé
`--color-text-2` en dessous, sans pilule ni couleur de fond. Une couleur d'alerte sur le second
serait une opinion que la spécification n'a pas tranchée : `docs/SPEC-mail-subsystem.md` §20.9
dit déjà qu'un compte en échec n'envoie ni courriel ni notification, donc n'affiche pas non plus un
signal d'urgence que rien ne vient étayer.

#### 20.11.6 États systématiques

Chargement (squelette de tableau), erreur (réseau ou refus, §5.8), vide (aucun compte visible —
« Aucune boîte à superviser », sans action puisqu'en créer une n'appartient pas à cette unité),
prêt. **SI LE SERVICE EST ARRÊTÉ, L'ÉCRAN LE DIT** (§20.7) : une relève ancienne n'est pas
maquillée par un état "chargement" qui ne finirait jamais — c'est une donnée comme une autre,
affichée telle quelle.

#### 20.11.7 Ce que l'écran ne fait pas

- **Aucune action** : ni relancer une relève, ni acquitter un incident, ni relever un secret.
  Cet écran **lit**; agir dessus est hors DoD et hors spécification.
- **Aucun flux temps réel** : la donnée est lue à l'ouverture, comme tous les autres écrans
  d'administration du produit ; un rafraîchissement se fait en rechargeant l'écran.

### 20.8 Preuves exigées

| Niveau | Preuve |
|---|---|
| pytest | Le backoff : progression, borne, et la distinction refus / panne — **sans serveur** |
| pgTAP | La reprise d'un orphelin, le décompte des états, le seuil de dix minutes |
| API | L'état d'un compte est lisible par son propriétaire et par un administrateur, par personne d'autre |
| E2E `mail` | **Une coupure SMTP réelle** : le message n'est pas perdu, il est reprogrammé ; le serveur revenu, il part |
| E2E `mail` | **Le backfill par lots** : un premier contact ne descend que le jour, même avec de l'historique déjà présent et `backfill_months` l'autorisant ; la relève suivante le reprend |
| E2E `ui` | L'écran d'état montre ce que la base porte, y compris un incident |
| Harnais | `scripts/verify-mail-resilience.sh`, non complaisant, avec son témoin |

### 20.9 Limites nommées

- **Aucune veille par `IDLE`** (§20.2) : la scrutation est déclarée, observable et rejouable.
- **Aucune alerte sortante** : un compte en erreur est *visible*, il n'envoie ni courriel ni
  notification — les notifications relèvent de leur propre unité.
- **Aucun backfill de pièces jointes anciennes au-delà de la profondeur déclarée** : ce qui n'est
  pas descendu n'est pas analysé, et l'écran ne prétend pas le contraire.

---

## 21. Écran de configuration des comptes entrants — `CRM-088`

*Écrit avant le code, `docs/JOURNAL.md` décision 492. Le §2.3 décrit depuis `CRM-000` des
« formulaires de configuration » qui « proposent *remplacer le mot de passe* » ; le §13.1 a
différé cette surface vers « une unité de réglages restant à créer », qu'aucune ligne du backlog ne
portait. Cette unité EST cette unité, et ce chapitre en est le contrat.*

### 21.1 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré :

- une surface de réglages, `/reglages/comptes-mail`, qui **liste** les comptes entrants visibles
  par l'appelant et **écrit** par le seul chemin que `CRM-052` a ouvert ;
- le formulaire de **création** et de **modification** d'une boîte — la sienne pour tout membre, la
  boîte système pour qui la base l'accepte ;
- le **remplacement du mot de passe**, jamais son affichage (§2.3) ;
- la traduction des refus de la base par un **dictionnaire fermé**, jamais le texte du serveur.

**Non livré, et nommé plutôt que suggéré :**

- **le bouton « Tester la connexion » du §2.3.** MESURÉ : le test de connexion est la route interne
  `POST /internal/v1/inbound-accounts/{id}/test` (§13.5), protégée par le jeton d'API interne du
  service (§12.3). Un navigateur ne peut pas la joindre sans que ce jeton soit publié dans un
  paquet JavaScript public, ce que `CLAUDE.md` §11 et le §8 du présent document interdisent. La
  seule voie correcte serait une fonction edge relayant le geste sous une autorisation propre —
  surface qu'aucune unité n'a spécifiée. L'écran **affiche donc l'état écrit par le service**
  (`status`), et le geste reste celui de l'exploitant par l'API interne, comme au §13.1.
  **LEVÉ PAR `CRM-127`** (§23, décision 816) : la fonction edge `mail-connection-test` relaie le geste sous le droit
  d'écriture de la ligne, et le bouton est sur chaque ligne.
- **les trois paramètres d'ingestion** — `watch_folders`, `folder_style`, `backfill_months`. Ils
  appartiennent à `CRM-054` et `CRM-056`, non à la connexion d'une boîte. MESURÉ, l'écran ne les
  **écrase jamais** : `upsert_mail_inbound_account` applique `coalesce(p_x, a.x)` sur les trois, si
  bien qu'un appel qui les omet laisse la valeur en place, et un compte neuf reçoit les défauts de
  la table (`{INBOX}`, `folder`, `0`).
- **la suppression d'un compte.** Aucune fonction ne la porte : `CRM-052` n'a ouvert ni `DELETE`
  direct ni chemin de retrait, et le §13.10 laisse déjà la purge d'un secret Vault à une unité
  RGPD. Une commande morte serait pire que l'absence (`docs/DESIGN_SYSTEM.md` §5.10).
- **les identités sortantes SMTP** (`CRM-053`, §14). Même écart, même motif : elles ont leur propre
  table, leur propre fonction d'écriture et leurs propres refus. Les fondre dans un écran unique
  ferait porter à cette unité une seconde surface que le plan n'a pas ordonnée.

### 21.2 Une adresse dédiée, suivant le patron de `CRM-075`

`/reglages/comptes-mail` porte l'écran, monté par `App` **hors de la table `ROUTES`** — le patron
de `CHEMIN_ADMIN_ARBORESCENCE` et de `CHEMIN_ETAT_MESSAGERIE` : une adresse nommée dans
`chemins.ts`, chargée à la demande, et l'index des réglages (`/reglages`) gagne une entrée.

**Elle vit AVANT « État de la messagerie » dans l'index**, et l'ordre porte un sens : on configure
une boîte avant d'en superviser la relève. C'est la règle que `CRM-030` a déjà appliquée en plaçant
le catalogue après l'éditeur de workflows — « on découvre l'éditeur avant le vocabulaire qu'il
emploie ».

**Aucune modale**, comme les cinq autres surfaces de réglages (`docs/DESIGN_SYSTEM.md` §5.13).

### 21.3 Ce que l'écran lit — aucune politique nouvelle

Une seule lecture, `mail_inbound_accounts`, sous la RLS posée en `0022` et déjà décrite au §13.4 :
un administrateur du workspace voit tous les comptes, un membre ordinaire ne voit que le sien, un
membre sans boîte lit **zéro ligne** — MESURÉ le 2026-08-20 avec le jeton réel de la lectrice :
`200` et `[]`, jamais un refus.

Colonnes demandées, toutes couvertes par le `GRANT SELECT` de `0022` :
`id, label, owner_id, imap_host, imap_port, imap_security, imap_username, status, last_error,
last_checked_at`.

**`secret_id` n'est jamais demandée**, et ce n'est pas une précaution de style : la demander rend
`403 / 42501` pour l'appelant `authenticated` (preuve de refus n° 6, §13.4), donc une requête qui
la citerait ferait échouer la lecture entière de l'écran pour tout le monde sauf le service.

### 21.4 Le formulaire, champ par champ

Un seul formulaire, qui **crée** ou **modifie** selon la boîte visée — c'est la forme de la
fonction, qui est un `upsert` sur le couple `(workspace_id, owner_id)` (§13.2). Il vit **dans le
flux du document**, sous la liste, et il est **replié par défaut** (`docs/DESIGN_SYSTEM.md` §5.23).

| Champ | Contrôle | Contrainte de la base | Valeur envoyée |
|---|---|---|---|
| Boîte visée | `select` **construit depuis ce que l'appelant voit** — voir juste sous ce tableau | aucune : c'est le paramètre `p_owner_id` | l'identifiant du propriétaire, ou rien pour la boîte système |
| Libellé | texte | `mail_inbound_accounts_label_borne` — 1 à 200 caractères après `btrim` | `p_label` |
| Serveur IMAP | texte | `mail_inbound_accounts_host_borne` — 1 à 253 | `p_imap_host` |
| Port | nombre | `mail_inbound_accounts_port_borne` — 1 à 65535 | `p_imap_port` |
| Sécurité | `select` fermé — `ssl`, `starttls`, `none` | `mail_inbound_accounts_securite` | `p_imap_security` |
| Identifiant | texte | `mail_inbound_accounts_username_borne` — 1 à 320 | `p_imap_username` |
| Mot de passe | mot de passe, **vide par défaut** | aucune ; voir §21.5 | `p_password`, omis si vide |

**Aucune garde de saisie ne double une contrainte de la base** — la règle du §5.3 ter du design
system, tenue sans exception : ni `required`, ni `min`, ni `max`, ni `pattern`. Un libellé vide et
un port hors bornes sont **envoyés**, et c'est la base qui tranche (`CLAUDE.md` §10). Le port est un
`input type="number"` parce que c'est un nombre, non pour borner la saisie.

**Le sélecteur énumère les boîtes VISIBLES, plus celles que l'appelant peut créer.** Une boîte
visible y est nommée par son `label`, qui est une **donnée** et non une traduction
(`docs/DESIGN_SYSTEM.md` §10) ; une boîte qui n'existe pas encore est nommée par une clé, faute de
donnée à afficher — « Ma boîte personnelle », « Boîte système de l'espace de travail ». Une
administratrice y retrouve donc les trois comptes du seed et peut corriger celui d'un collègue, ce
que la fonction accepte (§13.3) ; un membre ordinaire n'y voit que la sienne, plus la boîte système,
qu'il peut viser et se voir refuser. **Aucune option vide en tête** : le couple
`(workspace_id, owner_id)` est la clé de l'objet, et n'en viser aucun n'aurait pas de sens — c'est
l'écart assumé avec le §5.22 du design system.

**Le sélecteur n'est jamais restreint selon le rôle**, et l'écran ne calcule aucun
droit : un membre ordinaire voit l'option « Boîte système », l'envoie, et lit le refus **traduit**.
C'est la règle que le design system tient au §5.3, §5.13, §5.16, §5.21 et §5.27 sans exception —
une commande grisée ferait passer une décision de la base pour une décision d'écran.

**Choisir une boîte déjà configurée préremplit le formulaire** de ses valeurs courantes (§5.25), le
mot de passe excepté (§21.5). Choisir une boîte qui n'existe pas encore vide les champs : préremplir
une création avec les valeurs d'une autre boîte écrirait une configuration que personne n'a saisie.

### 21.5 Le mot de passe ne s'affiche jamais, et un champ vide ne le touche pas

C'est la règle du §2.3 — « les formulaires n'affichent jamais un secret enregistré ; ils proposent
*remplacer le mot de passe* » —, et la base la rend applicable sans ruse. MESURÉ le 2026-08-20 :

- un appel **sans** `p_password` sur une boîte existante laisse `secret_id` **inchangé** — relu par
  la clé de service, `540f1223-…` avant et après —, et le libellé modifié est bien écrit ;
- un appel **avec** `p_password` réécrit le secret **en conservant sa référence** (§13.8), et remet
  `status` à `pending` en effaçant `last_error` : un `ok` obtenu avec l'ancien secret ne dit rien du
  nouveau ;
- un compte **neuf** sans mot de passe est **refusé** — `password_required`, `SQLSTATE 23514`. Le
  refus est explicite parce qu'un compte sans secret échouerait plus tard sur un diagnostic
  incompréhensible plutôt que sur sa cause.

L'écran suit donc la base au lieu de la doubler : le champ est vide à l'ouverture, et le paramètre
est **omis** plutôt qu'envoyé vide.

**Son texte d'aide a DEUX visages, et l'un des deux a été trouvé en regardant une capture**
(`CLAUDE.md` §16) : sur une boîte existante, « laissé vide, le mot de passe enregistré est
conservé » ; sur une boîte qui n'existe pas encore, « obligatoire ». La première phrase serait
**fausse** à la création — il n'y a rien d'enregistré —, et promettre une conservation inexistante
est la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit. Ce n'est **pas** une garde de
saisie : le champ reste envoyable vide, le refus `password_required` est alors traduit et affiché,
et il n'est **pas** anticipé.

### 21.6 Ce que la mesure a établi, et qui n'était écrit nulle part

Toutes les lignes ci-dessous sont des sorties de commande obtenues le 2026-08-20 sur la pile de
développement, avec les jetons réels des comptes du seed, par la véritable route de connexion.

| Appel | Réponse mesurée |
|---|---|
| `GET mail_inbound_accounts` — jeton de la lectrice (`viewer@p2enjoy.test`), qui n'a pas de boîte | `200`, `[]` |
| `POST rpc/upsert_mail_inbound_account`, `p_owner_id` = **l'appelante elle-même** | `200`, l'identifiant du compte créé. **Une lectrice configure donc sa propre boîte** : la fonction n'exige l'`admin` que pour la boîte système ou celle d'autrui |
| Le même appel avec `p_owner_id` **nul** (boîte système), jeton de la lectrice | `403`, `{"code":"42501","message":"forbidden"}` |
| `p_imap_port = 70000` | `400`, `23514`, contrainte `mail_inbound_accounts_port_borne` |
| `p_imap_security = 'bogus'` | `400`, `23514`, contrainte `mail_inbound_accounts_securite` |
| `p_label = '   '` | `400`, `23514`, contrainte `mail_inbound_accounts_label_borne` |
| Compte neuf sans `p_password` | `400`, `23514`, message `password_required` |
| `p_imap_port` nul | `400`, `23502`, `null value in column "imap_port" … violates not-null constraint` |
| `p_imap_port` non entier | `400`, `22P02`, `invalid input syntax for type integer` |
| Appel sans session (clé anonyme seule) | `401`, `42501`, `permission denied for function upsert_mail_inbound_account` — le `GRANT EXECUTE` de `0022` ne va pas à `anon` |
| Mise à jour sans `p_password` | `200` ; `secret_id` inchangé, `watch_folders`, `folder_style` et `backfill_months` inchangés |

**UN DÉFAUT DE DIVULGATION TROUVÉ EN MESURANT, ET IL EST ÉTRANGER À CETTE UNITÉ.** Le corps d'un
refus `23514` rendu par PostgREST porte un champ `details` qui contient **la ligne fautive
entière**, `secret_id` compris — la colonne précisément révoquée à `authenticated` par la preuve de
refus n° 6. La référence Vault relevée dans ce `details` est **exactement** celle que la clé de
service lit sur la même ligne. Le comportement est laissé **inchangé** (`CLAUDE.md` §18) et
consigné en `INC-193` ; il n'appartient ni à cette unité ni à cet écran. Ce que cette unité en
tire, en revanche, est une règle : **l'écran n'affiche jamais le corps d'erreur du serveur**, et le
§21.7 en fait un dictionnaire fermé.

### 21.7 Les refus sont traduits par un dictionnaire fermé, jamais recopiés

C'est le §13.7 transposé à l'écran : là-bas `last_error` porte un **code** et non la phrase du
serveur distant ; ici l'écran porte une **phrase du produit** et non le corps d'erreur de PostgREST.
Les deux règles ont la même cause — un texte venu d'ailleurs est une entrée non maîtrisée — et le
§21.6 vient d'en donner la démonstration la plus nette qui soit.

| Cause reconnue | Ce que l'écran écrit |
|---|---|
| `forbidden` (`42501`) | Le refus d'autorisation, nommant la boîte visée |
| `not_authenticated` (`42501`) | La session a expiré, reconnectez-vous |
| `password_required` | Un mot de passe est exigé pour créer une boîte |
| `mail_inbound_accounts_label_borne` | Le libellé est obligatoire, 200 caractères au plus |
| `mail_inbound_accounts_host_borne` | Le serveur est obligatoire, 253 caractères au plus |
| `mail_inbound_accounts_port_borne` (`23514`), la colonne `imap_port` absente (`23502`) ou une saisie non entière (`22P02`) | Le port doit être un nombre entier compris entre 1 et 65535 — **trois refus, une seule phrase** : ils visent le même champ à corriger, et les distinguer ferait trois messages pour une seule saisie |
| `mail_inbound_accounts_securite` | Le mode de sécurité n'est pas reconnu |
| `mail_inbound_accounts_username_borne` | L'identifiant est obligatoire, 320 caractères au plus |
| `owner_not_member` | Le propriétaire n'est pas membre de cet espace de travail |
| aucune des précédentes | **Un refus nommé, jamais muet** : « l'enregistrement a été refusé », suivi d'aucune donnée du serveur |

La dernière ligne est le **repli nommé** du §13.7, repris sans changement : nommer « je ne sais
pas » est une réponse, le déguiser en une cause précise n'en est pas une, et recopier le message du
serveur reviendrait à publier ce qu'`INC-193` mesure.

**Un refus n'efface pas la saisie et laisse le formulaire ouvert** (`docs/DESIGN_SYSTEM.md`
§5.7 ter, §5.25).

### 21.8 États systématiques

Les quatre du §5.8, plus deux qui sont propres à cette surface :

| État | Rendu |
|---|---|
| Chargement | squelette de liste |
| Erreur de lecture | message et **reprise qui relit réellement** |
| Aucune boîte visible | « Aucune boîte configurée », **avec** le geste de configuration — c'est la règle du §5.13 pour l'état vide d'une surface qui agit, et l'écart assumé avec le §5.14, dont l'écran ne fait que lire |
| Sans espace de travail | l'état déjà rendu par `EtatMessagerie`, sans action |
| Enregistrement en vol | le bouton porte son libellé d'attente et est désactivé pendant le vol |
| Enregistré | la liste est **relue**, jamais complétée localement (§5.21, §5.26) |

### 21.9 Ce que l'écran ne fait pas

- **Il ne teste aucune connexion** (§21.1), et n'écrit donc ni `status`, ni `last_error`, ni
  `last_checked_at` — ces trois colonnes sont fermées en écriture à `authenticated` (§13.2), et
  l'écran les **affiche** telles que le service les a écrites.
- **Il ne supprime rien** (§21.1).
- **Il n'affiche aucun secret**, ni le mot de passe, ni sa référence (§21.3, §21.5).
- **Aucun flux temps réel** : la donnée est lue à l'ouverture et après chaque écriture, comme
  toutes les autres surfaces d'administration.

### 21.10 Seed

**Aucune donnée nouvelle n'est due**, et c'est mesuré plutôt que supposé : le §13.8 pose déjà trois
comptes — la boîte système et les boîtes de Camille et de Driss — écrits par le **véritable chemin
d'écriture**, c'est-à-dire par la fonction que cet écran appelle. L'écran a donc de quoi montrer
ses trois lectures dès le premier `apply-seed.sh` :

- l'administratrice y voit **trois** lignes, la boîte système comprise ;
- Driss y voit **la sienne**, et le formulaire préremplie de ses valeurs ;
- Farida, qui n'a pas de boîte (§13.8), y voit l'**état vide avec son geste** — le cas le plus utile
  de l'écran, et le seul que le seed n'aurait pas exercé si elle en avait une.

### 21.11 Preuves exigées

| Niveau | Preuve |
|---|---|
| Unitaire | Le module de lecture et d'écriture : colonnes demandées, paramètre `p_password` **omis** quand le champ est vide, classement des refus par le dictionnaire fermé du §21.7 |
| Unitaire | Le composant : préremplissage, état vide avec geste, refus affiché sans corps de serveur, liste relue après succès |
| API | Déjà acquise par `CRM-052` (`e2e/api/comptes-entrants.spec.ts`) pour les refus n° 6, n° 7 et le chemin d'écriture. **Ajoutée ici** : une lectrice configure sa propre boîte et se voit refuser la boîte système, mesuré avec son jeton réel |
| E2E `ui` | Le parcours complet d'un administrateur : ouvrir l'écran, lire ses trois boîtes, modifier le libellé de la boîte système sans toucher au mot de passe, constater la relecture ; puis un refus réel obtenu par un port hors bornes, avec sa phrase du produit |
| Vérification visuelle | Captures aux paliers du §7, **observées** (`CLAUDE.md` §16) : liste, formulaire ouvert, refus, état vide |

#### 21.11 bis Le harnais dédié — `scripts/verify-mail-comptes.sh`

*Écrit après la livraison de l'écran, et c'est le seul reste que la Definition of Done nommait.
Les autres unités d'interface portent chacune le leur ; celle-ci n'en avait pas, si bien que ses
preuves n'étaient rejouables qu'à la main, commande par commande.*

Le harnais rejoue, sur une pile démarrée et seedée, ce que les quatre lignes ci-dessus exigent,
et il ajoute **ce qu'aucune d'elles ne couvre** : la vérification que le contrat de base sur
lequel l'écran s'appuie est toujours celui que le §21.6 a mesuré.

1. **Traçabilité** : les six fichiers livrés existent et portent leur `@spec` ou `@verifies`
   citant `CRM-088`.
2. **La surface est câblée** : le chemin est déclaré, l'écran est monté **hors** de la table
   `ROUTES`, et son entrée d'index vient **avant** « État de la messagerie » (§21.2) — l'ordre est
   lu dans la source, non supposé.
3. **Le contrat de base, relu en base.** Les cinq noms de contrainte sur lesquels le dictionnaire
   fermé du §21.7 classe ses refus sont des **identifiants du schéma** : si `0022` en renommait un,
   l'écran retomberait silencieusement sur son repli « refus inconnu » et **aucune preuve existante
   ne le verrait**, puisque toutes simulent la réponse ou visent une seule contrainte. Le harnais
   les relit donc dans `pg_constraint`, un par un. Il constate en outre les deux refus dont l'écran
   dépend : `secret_id` reste révoquée à `authenticated` (§21.3), et `upsert_mail_inbound_account`
   reste refusée à `anon` (§21.6).
4. **Preuves exécutables** : les deux suites unitaires, `e2e/api/comptes-entrants.spec.ts`,
   `e2e/ui/reglages-comptes-mail.spec.ts`, et la présence des six captures du §21.11.
5. **Non-complaisance, témoin compris.** Le harnais dégrade **réellement** le module livré, puis
   constate que la suite rougit, sur les trois règles qui portent la sécurité de l'écran :
   `p_password` envoyé même vide — le secret enregistré serait écrasé —, `secret_id` ajoutée aux
   colonnes lues — la lecture entière deviendrait `403` —, et le message du serveur recopié en
   guise de classement — ce que `INC-193` rend divulgant. Un témoin vert précède les trois.
6. **Restauration constatée** : les fichiers altérés sont rendus identiques **octet à octet** à
   l'instantané pris avant la dégradation, et la suite redevient verte.

L'option `--rapide` saute les preuves Playwright et n'exécute que ce qui ne demande pas de
navigateur. Elle ne saute **aucun** contrôle de base : une pile est requise dans les deux cas.

### 21.12 Limites nommées

- ~~**Aucun test de connexion depuis l'écran** (§21.1) : l'état affiché est celui que le service a
  écrit, et rien dans l'interface ne le rafraîchit.~~ Levée par `CRM-127` (§23).
- **Aucune suppression** (§21.1).
- **Les trois paramètres d'ingestion ne sont pas éditables** (§21.1), et ne sont jamais écrasés.
- **Aucune identité sortante** (§21.1) : `CRM-053` garde son écart, inchangé.
- **`INC-193` reste ouverte** : le corps d'un refus de contrainte divulgue `secret_id`. Cet écran
  ne l'affiche pas, ce qui borne la divulgation à qui appelle l'API directement — ce n'est pas une
  correction, et le §21.6 le dit.

---

## 22. Écran de configuration des identités sortantes — `CRM-089`

*Écrit avant le code, `docs/JOURNAL.md` décision 494. Le §14.1 nomme l'écart « aucun écran non
plus, pour la même raison qu'au §13.1 », et le §21.1 l'a laissé intact en bornant `CRM-088` à la
moitié entrante : « `CRM-053` garde son écart, inchangé ». Cette unité est la moitié SORTANTE, et
ce chapitre en est le contrat.*

### 22.1 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré :

- une surface de réglages, `/reglages/identites-mail`, qui **liste** les identités sortantes
  visibles par l'appelant et **écrit** par le seul chemin que `CRM-053` a ouvert — la fonction
  `upsert_mail_outbound_identity`, dans la signature que la migration `0033` fixe ;
- le formulaire de **déclaration** et de **modification** d'une identité — la sienne pour tout
  membre, l'identité de service pour qui la base l'accepte ;
- l'**adresse d'expédition** et le **nom d'expéditeur**, qui sont les deux seules données de cette
  table qu'un destinataire verra (§14.2) ;
- le **choix de l'identité par défaut**, dont le déplacement est tenu par la base (§14.2), et que l'envoi
  présélectionne depuis la décision 805 (§22.14) ;
- le **remplacement du mot de passe**, jamais son affichage (§2.3) ;
- la traduction des refus par un **dictionnaire fermé**, jamais le texte du serveur (§21.7).

**Non livré, et nommé plutôt que suggéré :**

- **le bouton « Tester la connexion »**, pour la raison exacte du §21.1 : le test SMTP est la route
  interne `POST /internal/v1/outbound-identities/{id}/test` (§14.4), protégée par le jeton d'API
  interne du service (§12.3), qu'un navigateur ne peut pas porter sans le publier. L'écran
  **affiche l'état écrit par le service** (`status`), et le geste reste celui de l'exploitant.
  **LEVÉ PAR `CRM-127`** (§23, décision 816).
- **le quota journalier** — `daily_quota`. Il appartient à `CRM-058`, qui le consomme (§19.4), et sa
  sémantique à trois valeurs — `NULL` aucun plafond, `0` interdiction explicite, `n` plafond — a été
  posée par la migration `0030` puis corrigée par la `0033` après un défaut réel (décision 347).
  MESURÉ : la branche `UPDATE` applique `coalesce(p_daily_quota, i.daily_quota)`, si bien qu'un
  appel qui l'omet laisse la valeur en place — mais aussi qu'**aucun appel ne peut la ramener à
  `NULL`**. Un champ d'écran qui ne sait pas revenir en arrière poserait un piège ; l'écran ne
  l'envoie donc jamais, et ne l'écrase jamais.
- ~~**la signature HTML** — `signature_html`. Même mécanique de `coalesce`, et surtout : une
  signature est un contenu riche, dont aucune unité n'a spécifié l'éditeur ni l'assainissement. Le
  §18.4 a posé qu'aucun HTML d'origine extérieure ne s'affiche sans être maîtrisé ; ouvrir ici un
  champ libre sans ce contrat serait ouvrir une surface que rien ne borne.~~
  **LIVRÉE PAR `CRM-063` TRANCHE 3, le 2026-08-25, et les DEUX objections sont levées à leur
  source** (`docs/SPEC-modeles-emails.md` §10). La colonne est renommée `signature_text` : il n'y a
  plus de HTML à assainir, donc plus de surface à border — le §18.4 n'a plus prise. Et le
  `coalesce` est remplacé par TROIS états — omis conserve, vide EFFACE, rempli écrit —, si bien que
  le champ sait revenir en arrière et n'est plus le piège que ce paragraphe décrivait. Le §22.5
  gagne donc un champ « Signature », et le §22.1 ne refuse plus que le quota, le test de connexion,
  la suppression d'une identité et les comptes entrants.
- **la suppression d'une identité.** Aucune fonction ne la porte, exactement comme au §21.1, et une
  commande morte serait pire que l'absence (`docs/DESIGN_SYSTEM.md` §5.10).
- **les comptes entrants IMAP** (`CRM-052`, `CRM-088`, §21) : ils ont leur écran, et les fondre
  ferait porter à cette unité une seconde surface.

### 22.2 Une adresse dédiée, la SEPTIÈME section de réglages

`/reglages/identites-mail` porte l'écran, monté par `App` **hors de la table `ROUTES`** — le patron
du §21.2, repris sans changement.

**Elle vit APRÈS « Comptes entrants » et AVANT « État de la messagerie »**, et l'ordre porte le même
sens qu'au §21.2 : on reçoit avant d'expédier, et on configure avant de superviser. Les trois
entrées de la famille « messagerie » se suivent donc dans l'ordre du parcours réel.

**Aucune modale** (`docs/DESIGN_SYSTEM.md` §5.13).

### 22.3 Ce que l'écran lit — aucune politique nouvelle

Une seule lecture, `mail_outbound_identities`, sous la RLS posée en `0023` et décrite au §14.3 :
l'administrateur du workspace lit tout, un membre ne lit que ses propres identités, un anonyme ne
lit rien.

MESURÉ le 2026-08-21 avec les jetons réels du seed :

| Appelant | Réponse |
|---|---|
| Camille, administratrice | `200`, **deux** lignes — l'identité de service et celle de Driss |
| Driss, membre | `200`, **une** ligne — la sienne |
| Farida, lectrice sans identité | `200`, `[]` — jamais un refus |

Colonnes demandées, toutes couvertes par le `GRANT SELECT` de `0023` :
`id, label, owner_id, smtp_host, smtp_port, smtp_security, smtp_username, from_address, from_name,
is_default, status, last_error, last_checked_at`.

**`secret_id` n'est jamais demandée** — MESURÉ : la citer rend `403 / 42501`
`permission denied for table mail_outbound_identities` pour l'appelant `authenticated`, y compris
pour l'**administratrice**. C'est la seconde moitié de la preuve de refus n° 6 (§14.3), et une
requête qui la citerait ferait échouer la lecture entière de l'écran pour tout le monde.

**`daily_quota` n'est pas demandée non plus** : l'écran ne l'affiche pas plus qu'il ne l'écrit
(§22.1). Ne pas lire ce qu'on ne montre pas est la même discipline que ne pas envoyer ce qu'on ne
modifie pas.

**`signature_text` EST demandée depuis `CRM-063` tranche 3**, et c'est la RÉCIPROQUE de cette même
discipline : l'écran ne peut pas proposer de MODIFIER une signature sans montrer celle qui est
enregistrée. La liste, elle, n'en rend que la PRÉSENCE, par une pilule neutre
(`docs/SPEC-modeles-emails.md` §10.6).

### 22.4 L'objet de cet écran n'est PAS celui du §21, et c'est la différence qui commande sa forme

Au §21, la clé est le couple `(workspace_id, owner_id)` : **une** boîte par personne, et le
sélecteur énumère donc des personnes. Ici la clé est le triplet
`(workspace_id, owner_id, from_address)` — MESURÉ, et c'est écrit dans la fonction : « rien
n'interdit d'en déclarer plusieurs, contrairement aux comptes entrants » (§14.2). Une personne peut
donc porter **plusieurs** identités sortantes, et le sélecteur énumère des **identités**, pas des
personnes.

**CONSÉQUENCE MESURÉE, ET ELLE DOIT ÊTRE DITE À L'UTILISATEUR** : modifier l'adresse d'expédition
d'une identité existante n'en change pas l'adresse — elle **déclare une seconde identité**, et la
première demeure. Mesuré le 2026-08-21 : partant d'une identité `mesure@…`, un appel identique
portant `mesure-bis@…` a rendu un **nouvel** identifiant, et la relecture montre **deux** lignes,
la nouvelle par défaut et l'ancienne rabattue.

L'écran ne masque pas ce comportement et ne le contrarie pas :

- il **n'interdit pas** la saisie — ce serait une garde d'écran sur une règle que la base ne pose
  pas, et le §5.3 ter n'autorise pas davantage l'inverse de ce qu'il interdit ;
- il le **nomme**, par le texte d'aide du champ, sur une identité existante seulement ;
- il **relit la liste** après l'enregistrement (§22.8), si bien que les deux lignes apparaissent et
  que le geste est visible plutôt que deviné.

C'est la règle constante de ce produit : l'écran suit la base et l'explique, il ne la double pas.

**UNE CONSÉQUENCE DE PLUS, MESURÉE EN ÉCRIVANT LA PREUVE D'INTERFACE, ET ELLE SURPREND** : sur une
identité existante dont on modifie l'adresse, le refus que la base rend en premier n'est pas celui
qu'on attend. Mesuré le 2026-08-21, sur l'identité de Driss :

| Appel | Réponse |
|---|---|
| `p_from_address = 'pas-une-adresse'`, **sans** `p_password` | `400`, `23514`, **`password_required`** |
| le même **avec** `p_password` | `400`, `23514`, contrainte `mail_outbound_identities_from_address` |

La cause tient en une phrase : l'adresse étant dans la clé, une adresse que la base ne retrouve pas
fait de l'appel une **déclaration**, et la fonction vérifie le mot de passe **avant** d'insérer. Un
exploitant qui corrige une adresse mal saisie verra donc « un mot de passe est exigé » — message
exact, mais dont la cause réelle est ailleurs. C'est un argument de plus pour le texte d'aide du
§22.5 : il dit ce qui va se passer avant que le refus ne le rappelle. **Aucune ligne n'est laissée
derrière** : la contrainte annule la transaction, et le secret Vault créé au passage disparaît avec
elle — vérifié, aucun orphelin `pas-une-adresse` dans `vault.secrets`.

### 22.5 Le formulaire, champ par champ

Un seul formulaire, qui **déclare** ou **modifie** selon l'identité visée. Il vit **dans le flux du
document**, sous la liste, **replié par défaut** (`docs/DESIGN_SYSTEM.md` §5.23).

| Champ | Contrôle | Contrainte de la base | Valeur envoyée |
|---|---|---|---|
| Identité visée | `select` construit depuis ce que l'appelant voit, plus ce qu'il peut déclarer | aucune : c'est le couple `p_owner_id` / `p_from_address` | l'identifiant du propriétaire, ou rien pour l'identité de service |
| Libellé | texte | `mail_outbound_identities_label_borne` — 1 à **120** caractères après `btrim` | `p_label` |
| Serveur SMTP | texte | `mail_outbound_identities_host_borne` — 1 à 253 | `p_smtp_host` |
| Port | nombre | `mail_outbound_identities_port_borne` — 1 à 65535 | `p_smtp_port` |
| Sécurité | `select` fermé — `ssl`, `starttls`, `none` | `mail_outbound_identities_securite` | `p_smtp_security` |
| Identifiant | texte | `mail_outbound_identities_username_borne` — 1 à 320 | `p_smtp_username` |
| Adresse d'expédition | texte | `mail_outbound_identities_from_address` — 3 à 320, et la forme `x@y.z` | `p_from_address` |
| Nom d'expéditeur | texte | aucune | `p_from_name`, **toujours envoyé** — voir ci-dessous |
| Identité par défaut | case à cocher | aucune ; l'invariant est tenu par un index et un trigger (§14.2) | `p_is_default` |
| Mot de passe | mot de passe, **vide par défaut** | aucune ; voir §22.6 | `p_password`, omis si vide |

**Le libellé est borné à 120 caractères ici, contre 200 au §21.4**, et ce n'est pas une coquille :
`mail_outbound_identities_label_borne` et `mail_inbound_accounts_label_borne` sont deux contraintes
distinctes, relues en base. Recopier la borne de l'une sur l'autre ferait mentir le message de
refus.

**`p_from_name` est TOUJOURS envoyé, y compris vide, et c'est l'exact contraire de `p_password`.**
MESURÉ le 2026-08-21 : la fonction applique `coalesce(p_from_name, i.from_name)`, si bien qu'un
paramètre **omis** conserve la valeur — un nom d'expéditeur serait alors ineffaçable —, tandis
qu'une **chaîne vide** est une valeur et l'écrase. Les deux mesures se suivent : `"Farida Nowak"`
écrit le nom, `""` le rend vide. Le champ est donc envoyé tel quel, et l'utilisateur peut retirer un
nom qu'il a posé.

**Aucune garde de saisie ne double une contrainte de la base** (§5.3 ter) : ni `required`, ni `min`,
ni `max`, ni `pattern`, ni `type="email"` sur l'adresse d'expédition — c'est la contrainte
`mail_outbound_identities_from_address` qui tranche, et son refus est traduit.

**Le sélecteur énumère les identités VISIBLES, plus celles que l'appelant peut déclarer.** Une
identité existante y est nommée par son `label` suivi de son `from_address` — deux **données**
(`docs/DESIGN_SYSTEM.md` §10) —, parce que le seul libellé ne suffit plus à distinguer deux
identités d'une même personne, ce que le §21.4 n'avait pas à trancher. Les deux entrées de
déclaration portent une clé, faute de donnée à afficher : « Nouvelle identité personnelle »,
« Nouvelle identité de service ». **Le sélecteur n'est jamais restreint selon le rôle** (§21.4,
même règle) : un membre ordinaire voit l'option de service, l'envoie, et lit le refus **traduit** —
MESURÉ, `403 forbidden`.

**Choisir une identité existante préremplit le formulaire** de ses valeurs courantes (§5.25), le mot
de passe excepté. Choisir une entrée de déclaration vide les champs, sauf la case « identité par
défaut », **cochée** : c'est le défaut de la fonction (`coalesce(p_is_default, true)`), et l'écran
montre ce que la base ferait plutôt qu'un état qu'elle ne tiendrait pas.

### 22.6 Le mot de passe ne s'affiche jamais, et un champ vide ne le touche pas

La règle du §21.5, **remesurée sur cette table** plutôt que recopiée :

- un appel **sans** `p_password` sur une identité existante laisse `secret_id` **inchangé** — relu
  par la clé de service, `4156e0bc-…` avant et après —, et le libellé modifié est bien écrit ;
- un compte **neuf** sans mot de passe est **refusé** — `password_required`, `SQLSTATE 23514` ;
- toute modification de la connexion — hôte, port, sécurité, identifiant — ou du mot de passe remet
  `status` à `pending` et efface `last_error` : un `ok` obtenu avec l'ancien réglage ne dit rien du
  nouveau (§14.2, mesuré au §22.3 sur les deux identités du seed, toutes deux `pending`).

Le paramètre est donc **omis** plutôt qu'envoyé vide, et le texte d'aide a **deux visages** comme au
§21.5 : « laissé vide, le mot de passe enregistré est conservé » sur une identité existante,
« obligatoire » sur une déclaration — la première phrase serait fausse sur la seconde, et promettre
une conservation inexistante est la valeur par défaut trompeuse que `CLAUDE.md` §18 interdit.

### 22.7 Ce que la mesure a établi, et qui n'était écrit nulle part

Sorties de commande obtenues le 2026-08-21 sur la pile de développement, avec les jetons réels des
comptes du seed, par la véritable route de connexion. La ligne de mesure et son secret Vault ont été
**retirés** ensuite : deux identités et cinq secrets, comme avant.

| Appel | Réponse mesurée |
|---|---|
| `GET mail_outbound_identities` — jeton de la lectrice, qui n'a pas d'identité | `200`, `[]` |
| `GET …?select=id,secret_id` — jeton de l'**administratrice** | `403`, `42501`, `permission denied for table mail_outbound_identities` |
| `POST rpc/upsert_mail_outbound_identity`, `p_owner_id` = **l'appelante elle-même**, jeton de la lectrice | `200`, l'identifiant de l'identité créée. **Une lectrice déclare donc sa propre identité** : la fonction n'exige l'`admin` que pour l'identité de service ou celle d'autrui |
| Le même appel avec `p_owner_id` **omis** (identité de service), jeton de la lectrice | `403`, `{"code":"42501","message":"forbidden"}` |
| `p_smtp_port = 70000` | `400`, `23514`, contrainte `mail_outbound_identities_port_borne` |
| `p_from_address = 'pas-une-adresse'` | `400`, `23514`, contrainte `mail_outbound_identities_from_address` |
| `p_smtp_security = 'bogus'` | `400`, `23514`, contrainte `mail_outbound_identities_securite` |
| `p_label = '   '` | `400`, `23514`, contrainte `mail_outbound_identities_label_borne` |
| Identité neuve sans `p_password` | `400`, `23514`, message `password_required` |
| `p_daily_quota = 200000` | `400`, `23514`, contrainte `mail_outbound_identities_quota_borne` — **l'écran n'envoie jamais ce paramètre** (§22.1), et la mesure établit qu'il refuserait |
| `p_smtp_port` nul | `400`, `23502`, `null value in column "smtp_port" … violates not-null constraint` |
| `p_smtp_port` non entier | `400`, `22P02`, `invalid input syntax for type integer` |
| `p_owner_id` inconnu du workspace | `400`, `23514`, message `owner_not_member` |
| Appel sans session (clé anonyme seule) | `401`, `42501`, `permission denied for function upsert_mail_outbound_identity` |
| Mise à jour **sans** `p_password` | `200` ; `secret_id` inchangé |
| Mise à jour changeant `p_from_address` | `200`, **nouvel** identifiant ; deux lignes en base, la nouvelle par défaut, l'ancienne rabattue (§22.4) |
| `p_from_name` = `"Farida Nowak"` puis `""` | `200` deux fois ; le nom est écrit, puis **vidé** — la chaîne vide est une valeur, l'omission n'en est pas une (§22.5) |

**`INC-193` vaut ici mot pour mot** : le corps d'un refus `23514` rendu par PostgREST porte un champ
`details` contenant la ligne fautive entière. L'écran n'affiche donc **jamais** le corps d'erreur du
serveur, et le §22.8 en fait un dictionnaire fermé.

### 22.8 Les refus sont traduits par un dictionnaire fermé, jamais recopiés

| Cause reconnue | Ce que l'écran écrit |
|---|---|
| `forbidden` (`42501`) | Le refus d'autorisation, nommant l'identité visée |
| `not_authenticated` (`42501`) | La session a expiré, reconnectez-vous |
| `password_required` | Un mot de passe est exigé pour déclarer une identité |
| `mail_outbound_identities_label_borne` | Le libellé est obligatoire, 120 caractères au plus |
| `mail_outbound_identities_host_borne` | Le serveur est obligatoire, 253 caractères au plus |
| `mail_outbound_identities_port_borne` (`23514`), `smtp_port` absent (`23502`), saisie non entière (`22P02`) | Le port doit être un nombre entier compris entre 1 et 65535 — **trois refus, une seule phrase**, règle du §21.7 |
| `mail_outbound_identities_securite` | Le mode de sécurité n'est pas reconnu |
| `mail_outbound_identities_username_borne` | L'identifiant est obligatoire, 320 caractères au plus |
| `mail_outbound_identities_from_address` | L'adresse d'expédition doit être une adresse électronique |
| `owner_not_member` | Le propriétaire n'est pas membre de cet espace de travail |
| aucune des précédentes | **Un refus nommé, jamais muet** : « l'enregistrement a été refusé », suivi d'aucune donnée du serveur |

L'attribution de `22P02` au port suit l'argument du §21.7, et elle est ici **encore plus étroite** :
`p_smtp_port` est le seul entier que ce module envoie, `p_daily_quota` n'étant jamais transmis
(§22.1). L'attribution est une propriété de l'appel, pas une devinette sur la prose du serveur.

**Un refus n'efface pas la saisie et laisse le formulaire ouvert** (§5.7 ter, §5.25).

### 22.9 États systématiques

Les quatre du §5.8, plus les deux du §21.8 :

| État | Rendu |
|---|---|
| Chargement | squelette de liste |
| Erreur de lecture | message et **reprise qui relit réellement** |
| Aucune identité visible | « Aucune identité d'expédition », **avec** le geste de déclaration (§5.13) |
| Sans espace de travail | l'état déjà rendu par `EtatMessagerie`, sans action |
| Enregistrement en vol | le bouton porte son libellé d'attente et est désactivé pendant le vol |
| Enregistré | la liste est **relue**, jamais complétée localement (§5.21, §5.26) — et c'est cette relecture qui rend visibles le déplacement du défaut et la seconde identité du §22.4 |

### 22.10 Ce que l'écran ne fait pas

- **Il ne teste aucune connexion** (§22.1), et n'écrit donc ni `status`, ni `last_error`, ni
  `last_checked_at` — trois colonnes fermées en écriture à `authenticated` (§14.2).
- **Il ne supprime rien**, **n'écrit ni quota ni signature**, **n'affiche aucun secret** (§22.1).
- **Aucun flux temps réel** : la donnée est lue à l'ouverture et après chaque écriture.

### 22.11 Seed

**Aucune donnée nouvelle n'est due**, et c'est mesuré : le §14.6 pose déjà deux identités, écrites
par le véritable chemin d'écriture — celui que cet écran appelle. L'écran a donc de quoi montrer ses
trois lectures dès le premier `apply-seed.sh` :

- l'administratrice y voit **deux** lignes, l'identité de service comprise — **trois depuis la décision 805**, la
  sienne s'y ajoutant, chacune avec son propriétaire et son défaut (§22.14) ;
- Driss y voit **la sienne**, et le formulaire préremplí de ses valeurs — dont l'adresse
  `contact@p2enjoy.test`, qui diverge de sa boîte entrante `bizdev@p2enjoy.test` : le cas d'usage du
  §2.2, visible à l'écran pour la première fois ;
- Farida, qui n'a aucune identité, y voit l'**état vide avec son geste**.

### 22.12 Preuves exigées

| Niveau | Preuve |
|---|---|
| Unitaire | Le module : colonnes demandées, `p_password` **omis** quand le champ est vide, `p_from_name` et — depuis `CRM-063` tranche 3 — `p_signature_text` **toujours** envoyés, `p_daily_quota` **jamais** envoyé, classement des refus par le dictionnaire du §22.8 |
| Unitaire | Le composant : préremplissage, état vide avec geste, refus affiché sans corps de serveur, liste relue après succès, case « par défaut » cochée sur une déclaration |
| API | Déjà acquise par `CRM-053` (`e2e/api/identites-sortantes.spec.ts`) pour les refus n° 6 et n° 7. **Ajoutée ici** : une lectrice déclare sa propre identité et se voit refuser celle de service ; et le déplacement du défaut constaté par relecture, avec les jetons réels |
| E2E `ui` | Le parcours d'un administrateur : ouvrir l'écran, lire ses deux identités, modifier le libellé sans toucher au mot de passe, constater la relecture ; un refus réel obtenu par une adresse d'expédition non conforme, avec sa phrase du produit ; l'état vide d'une lectrice avec son geste |
| Vérification visuelle | Captures aux paliers du §7, **observées** (`CLAUDE.md` §16) : liste, formulaire ouvert, refus, état vide |

#### 22.12 bis Le harnais dédié — `scripts/verify-mail-identites.sh`

*Sur le modèle du §21.11 bis, et pour la même raison : les preuves d'une unité doivent être
rejouables d'un seul geste, et non commande par commande.*

Le harnais rejoue, sur une pile démarrée et seedée, ce que le §22.12 exige, et il ajoute **ce
qu'aucune de ces preuves ne couvre** : la vérification que le contrat de base sur lequel l'écran
s'appuie est toujours celui que le §22.7 a mesuré.

1. **Traçabilité** : les six fichiers livrés existent et portent leur `@spec` ou `@verifies` citant
   `CRM-089`. L'en-tête est lu **en entier**, jamais par une fenêtre de trois lignes (INC-192).
2. **La surface est câblée** : le chemin est déclaré, l'écran est monté **hors** de la table
   `ROUTES`, et son entrée d'index vient **après** « Comptes entrants » et **avant** « État de la
   messagerie » (§22.2) — l'ordre des **trois** entrées est lu dans la source, non supposé.
3. **Le contrat de base, relu en base.** Les **six** noms de contrainte sur lesquels le dictionnaire
   du §22.8 classe ses refus sont des identifiants du schéma : un renommage ferait retomber l'écran
   sur son repli « refus inconnu » **silencieusement**, et aucune preuve existante ne le verrait,
   toutes simulant la réponse. Le harnais les relit dans `pg_constraint`, puis vérifie que le module
   les cite — les deux sens. Il constate en outre que `secret_id` reste révoquée à `authenticated`
   (§22.3) et qu'`upsert_mail_outbound_identity` reste refusée à `anon` (§22.7).
4. **Preuves exécutables** : les deux suites unitaires, `e2e/api/identites-sortantes.spec.ts`,
   `e2e/ui/reglages-identites-mail.spec.ts`, et la présence des huit captures du §22.12.
5. **Non-complaisance, témoin compris.** Le harnais dégrade **réellement** le module livré, puis
   constate que la suite rougit, sur les **quatre** règles qui portent cet écran — et deux d'entre
   elles sont propres à cette unité, la jumelle n'ayant rien d'équivalent :
   - `p_password` envoyé même vide — le secret enregistré serait écrasé ;
   - **`p_from_name` OMIS quand il est vide** — un nom d'expéditeur deviendrait ineffaçable, et
     c'est la règle la plus contre-intuitive de l'unité (§22.5) ;
   - **`p_daily_quota` envoyé** — le quota que `CRM-058` consomme serait écrasé par l'écran ;
   - `secret_id` ajoutée aux colonnes lues — la lecture entière deviendrait `403`, y compris pour
     l'administratrice (§22.3).

   Un témoin vert précède les quatre.
6. **Restauration constatée** : les fichiers altérés sont rendus identiques **octet à octet** à
   l'instantané pris avant la dégradation, et la suite redevient verte.

L'option `--rapide` saute les preuves Playwright et n'exécute que ce qui ne demande pas de
navigateur. Elle ne saute **aucun** contrôle de base : une pile est requise dans les deux cas.

### 22.13 Limites nommées

- ~~**Aucun test de connexion depuis l'écran** (§22.1).~~ Levée par `CRM-127` (§23).
- **Aucune suppression** (§22.1).
- **Ni quota, ni signature** (§22.1) : jamais envoyés, jamais écrasés.
- **Changer l'adresse d'expédition déclare une seconde identité** (§22.4) : c'est le comportement de
  la base, il est nommé à l'écran, et il n'est ni contrarié ni masqué.
- **`INC-193` reste ouverte**, comme au §21.12.

### 22.14 Le propriétaire est nommé, et la case dit ce qu'elle règle — INC-335 (décision 805)

*Signalé par le responsable le 2026-11-01.* L'administratrice lit toutes les identités de l'espace (§22.3) : celle du
service et celles de chaque personne. Chacune peut porter son défaut (§14.2), si bien que la liste montrait **plusieurs
pastilles « Par défaut »** sans dire à qui chacune appartient. La case « Identité par défaut pour cet expéditeur »
disait « expéditeur » là où la règle porte sur le **propriétaire**. Et ce défaut n'était lu par aucun envoi.

- **Chaque ligne nomme son propriétaire** : « Service » pour l'identité sans propriétaire, le nom de la personne sinon.
  Une pastille « Par défaut » se lit donc avec son propriétaire.
- **La case dit ce qu'elle règle**, selon l'identité visée par le formulaire : « Identité par défaut de cette personne »,
  ou « Identité par défaut des envois automatiques » pour l'identité de service.
- **Le défaut d'une personne est présélectionné** à l'envoi (§19.4) et, dans le cas de la décision 803, à l'armement
  d'une cadence. À défaut, l'unique identité de la personne si elle n'en a qu'une, sinon rien.
- **L'identité de service n'est plus proposée** ni à l'envoi, ni à l'armement : la base la refuse
  (`identity_not_available`, §19.4), et l'écran cesse de proposer un geste voué au refus.

Connecteur MCP : `docs/SPEC-mcp.md` §9.2 decies, famille `messagerie`, action `ajouter`.

---

## 23. Tester la connexion depuis les réglages, et la relève écrit `last_sync_at` — `CRM-127`

*Écrit avant le code, `docs/JOURNAL.md` décision 816, qui arbitre INC-340. Demande du responsable du 2026-11-02 :
« comment tester un compte sortant ? il faudrait au minimum un bouton pour tester une configuration email (in et out) »,
et, en production, une messagerie entrante affichée « En attente » depuis des heures.*

### 23.1 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré :

- **la relève réussie écrit `last_sync_at`** (§23.2), ce que le §20.7 promettait et qu'aucun code ne faisait (INC-340) ;
- **le bouton « Tester la connexion »** sur chaque ligne de `/reglages/comptes-mail` (§21) et de
  `/reglages/identites-mail` (§22). Il lève l'écart que les §21.1 et §22.1 nommaient, par la voie qu'ils désignaient :
  une fonction edge qui vérifie le droit de l'appelant, puis relaie le geste vers `mail-sync` avec le jeton interne,
  que le navigateur ne voit jamais (§23.3, §23.4) ;
- **le libellé de `pending` devient « Non testée »** sur les deux écrans de réglages (§23.5). « En attente » se lisait
  comme une file d'attente ou une relève en suspens, alors que la valeur dit seulement qu'aucun test n'a eu lieu
  depuis la création ou la dernière modification (§13.2, §14.2). C'est ce libellé qui a fait croire au responsable
  que la réception était bloquée.

**Connecteur MCP : non.** Le test reste un geste d'écran ; aucun outil, aucune famille ni case nouvelle (décision 816).

**Non livré, et nommé :**

- **une relève qui échoue n'écrit ni `status` ni `last_error`.** Ces deux colonnes restent le constat du seul test de
  connexion (§13.2). Une relève en échec se voit à `last_sync_at` qui vieillit sur l'écran d'état (§20.7), et dans le
  journal du service (`veille_compte_echoue`). *Révisé par `CRM-135` (§24.3, décision 873) : une relève qui échoue
  écrit désormais `status = 'error'` et `last_error`, et une relève allée au bout les rend.*
- **aucun test automatique à l'enregistrement.** Enregistrer remet `status` à `pending` (§21, §22) ; le test reste un
  geste explicite.
- **aucun test depuis l'écran d'état** (§20.11), qui lit et n'agit pas.

### 23.2 La relève réussie écrit `last_sync_at`

Une fonction `public.mail_inbound_account_record_sync(p_account_id uuid) returns timestamptz`, `SECURITY DEFINER`,
`search_path = ''`, pose `last_sync_at = now()` et rend la valeur posée. Elle refuse un compte inconnu par
`account_not_found`, levé par `app.raise_http_error(404, …)` : `CRM-120` a banni l'`errcode` `P0002`
(`docs/SPEC-refus-404.md` §2). Son exécution est **révoquée à `public`, `anon` et `authenticated`** et accordée au seul
`service_role`, comme `mail_inbound_account_record_check` (§13.5). La colonne reste fermée en écriture à
`authenticated`. C'est l'horloge de la base qui date la relève, pas celle du conteneur.

**« Réussie » veut dire que `relever_compte` est allée au bout** : la session IMAP s'est ouverte, chaque dossier
surveillé a été parcouru ou écarté parce qu'absent (§15.4), et la progression a été enregistrée. L'écriture vient
**après** `enregistrer_progression`, hors de la session IMAP, au même endroit et pour la même raison qu'elle : une
relève qui lève une exception n'écrit rien. Les deux chemins de relève, la veille (§20.10) et la route interne
`/poll` (§15), passent par `relever_compte` : un seul point d'écriture les couvre tous les deux.

**Un échec de cette écriture n'est pas avalé.** Il remonte comme une panne de la relève : la veille le journalise
(`veille_compte_echoue`, §20.10.3) et la route `/poll` rend `502`. Les messages déjà ingérés restent acquis, et la
relève suivante, idempotente (§4.2), réessaie l'écriture.

`scripts/verify-mail-inbound.sh` §4, qui figeait l'absence (« MOITIÉ 1 »), est **retourné en preuve** : après une
relève réelle, `last_sync_at` est renseignée et postérieure au début de la preuve.

### 23.3 Le droit de tester est décidé par la base

Une fonction `public.authorize_mail_connection_test(p_target text, p_id uuid) returns void`, `SECURITY DEFINER`,
`search_path = ''`, exécutable par `authenticated` seul (révoquée à `public` et `anon`). La fonction edge l'appelle
**avec le jeton de l'appelant**, avant tout appel à `mail-sync`. Elle refuse :

| Cas | Refus | Code |
|---|---|---|
| Appelant sans session | `not_authenticated` | `42501` |
| `p_target` hors de `inbound`, `outbound` | `invalid_target` | `22023` |
| Ligne absente, **ou** l'appelant n'a pas le droit de l'écrire | `not_found` | `app.raise_http_error(404, …)` (`CRM-120`) |
| La ligne est `disabled`, une décision d'exploitation (§13.2) qu'un test écraserait par `ok` ou `error` | `disabled` | `55000` |
| Le dernier test de cette ligne date de moins de 30 secondes | `too_soon` | `P0001` |

**Le droit est exactement celui de l'écriture**, relu sur la ligne : l'administrateur de l'espace de la ligne
(`app.is_workspace_admin`), ou son propriétaire (`owner_id = auth.uid()`). Une ligne sans propriétaire (boîte système,
identité de service) n'est donc testable que par un administrateur. C'est la règle de `upsert_mail_inbound_account` et
de `upsert_mail_outbound_identity` (§13.3, §14.3), et elle coïncide avec la lecture (§13.4) : qui voit la ligne sur
l'écran peut la tester. **Un refus de droit et une ligne absente rendent le même `not_found`**, pour ne pas révéler
l'existence de la boîte d'un collègue (preuve de refus n° 7).

**Pourquoi 30 secondes.** Chaque test est une véritable authentification sur le serveur distant, et un fournisseur
peut verrouiller un compte après des échecs répétés. Le bouton est désactivé pendant le vol (§23.5), mais rien
n'empêche de recliquer ensuite, ni d'appeler la fonction en boucle. La borne se lit sur `last_checked_at`, un constat
du serveur qu'aucun client n'écrit. **Limite nommée** : deux appels simultanés passent tous deux la garde, puisque
`last_checked_at` n'est écrite qu'à la fin du test. La borne vise la répétition, pas la concurrence.

### 23.4 La fonction edge `mail-connection-test`

`POST /functions/v1/mail-connection-test`, corps JSON `{"target": "inbound" | "outbound", "id": "<uuid>"}`.

1. **Forme de la requête.** Une autre méthode rend `405` ; un corps illisible, un `target` inconnu ou un `id` qui n'est
   pas un UUID rend `400 invalid_request`, avant tout appel.
2. **Session.** Sans `Authorization: Bearer`, `401 unauthorized`.
3. **Droit.** `authorize_mail_connection_test` est appelée par PostgREST **avec le jeton de l'appelant**. Ses refus
   deviennent : `not_authenticated` → `401 unauthorized`, `invalid_target` → `400 invalid_request`, `not_found` →
   `404 not_found`, `disabled` → `409 disabled`, `too_soon` → `429 too_soon`. Toute autre réponse de la base →
   `502 service_unavailable`.
4. **Relais.** `POST {MAIL_SYNC_URL}/internal/v1/inbound-accounts/{id}/test` ou
   `.../outbound-identities/{id}/test` (§13.5, §14.4), avec `Authorization: Bearer {MAIL_SYNC_INTERNAL_TOKEN}`,
   borné à 40 secondes : le test SMTP en prend jusqu'à 30 (§14.5). Les réponses du service deviennent : `200` →
   `200 {"status", "error", "checked_at"}`, recopiés du verdict, qui est celui que le service a écrit en base ;
   `404` → `404 not_found` ; `409` (secret absent) → `409 secret_missing` ; tout le reste, délai dépassé et service
   injoignable compris → `502 service_unavailable`.
5. **Journal.** Une ligne par appel : `fonction`, `target`, statut HTTP rendu, `duree_ms`. Jamais le jeton, ni
   l'hôte, ni l'identifiant de connexion.

**Environnement propre** (`docs/SPEC-edge-functions.md` §2) : `MAIL_SYNC_URL` et `MAIL_SYNC_INTERNAL_TOKEN` sont remis à
ce seul worker par `main/environnement.ts`, comme `JWT_SECRET` à `session` ; aucune autre fonction ne voit le jeton
interne. La borne du worker est de **45 secondes** (`DELAI_PROPRE`), pour couvrir le relais de 40 secondes.
`MAIL_SYNC_URL` vaut `http://mail-sync:8080` sur le réseau Compose ; `mail-sync` n'a toujours aucun port publié.

### 23.5 L'écran

Sur chaque ligne des deux listes (§21, §22) : une commande discrète **« Tester la connexion »**, icône Lucide `PlugZap`,
placée avant « Configurer ». Elle reprend les propriétés de commande de la ligne (`capaciteDeBoiteMail`, `CRM-093`) :
désactivée avec le même motif quand la base refuse l'administration, puisque le droit de tester est celui d'écrire.

- **Pendant le vol**, la commande est désactivée et porte « Test en cours… ». Les autres lignes restent utilisables.
- **Au retour**, la liste est **relue** depuis la base : la pilule montre ce que le service a écrit, jamais une
  valeur déduite de la réponse (§20.7).
- **Le verdict s'écrit sous la ligne**, dans une région `role="status"` : « Connexion réussie. » ou
  « Échec : {incident} », avec l'incident tiré du dictionnaire fermé des six codes (§13.7, `admin.mail.incident.*`).
  Un code inconnu donne « Échec : cause non reconnue », jamais le code brut.
- **Les refus** s'écrivent au même endroit : `429` « Un test vient d'avoir lieu sur cette ligne. Réessayez dans
  quelques secondes. » ; `404` « Cette ligne n'est plus disponible pour vous. » ; `409` « Aucun mot de passe n'est
  enregistré : configurez-le avant de tester. » ; `409 disabled` « Cette ligne est désactivée : elle ne se teste
  pas. » ; `401` le message de session expirée de l'écran ; `502` ou réseau
  « Le service de messagerie n'a pas répondu : rien n'a été testé. »
- **Une ligne en erreur montre son incident** à côté de la pilule « En erreur », en texte du même dictionnaire :
  sans lui, l'écran disait qu'une boîte échoue sans dire pourquoi.
- **`pending` se lit « Non testée »** sur les deux écrans de réglages. L'écran d'état (§20.11) n'affiche pas `status`
  en pilule et n'est pas touché.

Les règles visuelles sont écrites au `docs/DESIGN_SYSTEM.md` §5.93 avec l'écran (tranche T4 ; le §5.81, d'abord
réservé, a été pris par `CRM-111` T7.1), après la lecture intégrale du design system qu'exige `CLAUDE.md` §4.

### 23.6 Seed

**Inchangé, et c'est suffisant.** Les boîtes et identités du seed pointent vers le Stalwart de développement (§11) :
un test y réussit. L'échec se reproduit par le véritable parcours, sans trace fabriquée (`CLAUDE.md` §8) : changer le
mot de passe d'une ligne par le formulaire, tester (`auth_failed`), puis remettre le bon mot de passe et retester.
Les scénarios qui le font remettent la ligne dans son état d'origine.

### 23.7 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | `authorize_mail_connection_test` : administrateur sur la boîte système et sur la boîte d'un membre ; membre sur la sienne ; membre refusé `not_found` sur la boîte système, sur celle d'un collègue et sur un identifiant inconnu ; `disabled` ; `too_soon` sous 30 s ; `invalid_target` ; exécution refusée à `anon`. Même matrice sur les identités. `mail_inbound_account_record_sync` : refusée à `authenticated`, pose `now()` pour `service_role`, `account_not_found` sur un inconnu |
| pytest | `relever_compte` date une relève allée au bout, sans message nouveau comme avec un dossier absent ; ne la date pas quand la session IMAP échoue ; un échec de l'écriture remonte. L'ordre progression puis datation, qui suppose un message réellement traité, est prouvé par l'E2E `mail` (`sync_state` et `last_sync_at` relus après une relève réelle) |
| Deno | le gestionnaire : chaque code de la table du §23.4, le jeton interne jamais dans la réponse ni le journal ; `environnement.test.ts` : seul `mail-connection-test` reçoit `MAIL_SYNC_INTERNAL_TOKEN` |
| Vitest | la traduction d'une réponse en issue d'écran ; la commande, son vol, sa désactivation par capacité, le verdict et les refus |
| API (Playwright) | sur la pile réelle, sans l'interface : un membre sur la boîte d'un collègue → `404` ; sans session → `401` ; deux tests rapprochés → `429` ; un test réussi écrit `last_checked_at` en base |
| E2E `mail` | une relève réelle (`/poll`) renseigne `last_sync_at` et ses bornes d'UID (`e2e/mail/releve-datee.spec.ts`). *Précisé à l'écriture de T4 (décision 850)* : l'écran d'état, que le projet `mail` ne sert pas, montre la date après une relève réelle dans `e2e/ui/etat-messagerie.spec.ts` |
| E2E UI | administratrice : test de la boîte système → « Connectée » relue en base ; membre : test de sa boîte et de son identité ; échec `auth_failed` par un mauvais mot de passe, puis remise en état ; captures 1440, 900 et 390 observées |
| Harnais | `scripts/verify-mail-inbound.sh` §4 retourné (§23.2) |

### 23.8 Limites nommées

- La garde de 30 secondes ne protège pas contre deux appels simultanés (§23.3).
- Le résultat d'un test n'est pas annoncé aux autres personnes qui ont l'écran ouvert : elles le verront à leur
  prochain chargement.
- Une relève en échec n'a toujours pas de pilule propre (§23.1) : seule la date de `last_sync_at` le dit. *Levée par
  `CRM-135` (§24.3) : la relève en échec écrit `error` et son code, que la pilule et l'incident montrent.*

---

## 24. La veille dit pourquoi elle échoue, l'écrit, espace les refus et ignore une boîte désactivée — `CRM-135`

*Écrit avant le code, `docs/JOURNAL.md` décisions 873 (l'arbitrage du responsable) et 874 (les choix de conception).
Origine : INC-349. En production, le fournisseur refuse l'authentification IMAP de la boîte entrante. La veille rejoue ce
LOGIN refusé à chaque tour, environ toutes les 70 s, et quatre défauts la rendent muette et sans frein.*

### 24.1 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré :

- **(i) un journal qui dit quoi** (§24.2) : le compte, le motif et les compteurs paraissent dans les lignes de la veille.
  Ni secret ni identifiant de connexion n'y entre ;
- **(ii) une relève qui échoue l'écrit** (§24.3) : `status = 'error'` et `last_error`, un des six codes du §13.7.
  Une relève allée au bout les rend : `status = 'ok'`, `last_error` nulle. **Le §23.1 est révisé sur ce point** : une
  relève en échec ne se voit plus seulement à `last_sync_at` qui vieillit. Les écrans qui lisent déjà ces colonnes la
  montrent sans changer : la pilule et l'incident des réglages (§23.5), le « Dernier incident » de l'écran d'état
  (§20.11.3) ;
- **(iii) l'espacement après un refus d'authentification** (§24.4) : la veille ne retente plus la boîte avant un délai
  croissant, borné à une heure ;
- **(iv) une boîte `disabled` n'est pas relevée par la veille** (§24.5).

**Connecteur MCP : non** (décision 873). C'est un service interne : l'état des boîtes se lit à l'écran « État de la
messagerie ».

**Non livré, et nommé :**

- **aucun geste d'écran pour désactiver une boîte.** Aucune fonction ne pose `disabled` aujourd'hui (§13.2, §21). La
  valeur reste une décision d'exploitation, posée en base sur instruction du responsable. Si un geste d'écran est
  voulu, c'est une unité à part ;
- **la route interne `/poll` n'est pas espacée et ne refuse pas une boîte `disabled`.** C'est un geste explicite
  (preuves, ordonnanceur d'un exploitant, §20.10.5), pas une boucle. Elle écrit pourtant l'échec et le succès (ii), parce
  que l'écriture vit dans `relever_compte`, que les deux chemins partagent (§23.2) ;
- **l'espacement ne survit pas à un redémarrage du service** (§24.4) : au pire, un LOGIN refusé de plus à chaque
  redémarrage.

### 24.2 (i) Le journal de la veille

Le formateur JSON (`structured_logging.JsonFormatter`, §12.5) **n'émet que les champs d'une liste fermée**,
`SAFE_FIELDS` : tout autre champ passé à `log_event` est jeté, et c'est ce qui garantit qu'aucun secret ne sort.
Le défaut d'INC-349 vient de cette garde : la veille passait `account_id` et `panne`, la liste ne les connaissait pas, et
la ligne sortait vide. **La garde reste ; la liste s'allonge de champs dont la valeur est sûre par construction** :

| Champ | Valeur | Pourquoi elle est sûre |
|---|---|---|
| `account_id` | l'UUID du compte | un identifiant interne, ni adresse ni identifiant de connexion |
| `error` | un des six codes du §13.7 | un vocabulaire fermé, jamais le texte du serveur |
| `panne` | le **nom de classe** de l'exception (`LoginError`, `PostgrestError`…) | un nom de type, jamais le message de l'exception |
| `postgrest_status` | le code HTTP rendu par PostgREST (`0` : injoignable) | un entier |
| `releves`, `echecs`, `ignores`, `espaces` | les compteurs d'un tour | des entiers |
| `intervalle_secondes` | l'intervalle de la veille | un entier de configuration publique (§20.10.5) |
| `refus_consecutifs`, `retry_in_seconds` | l'espacement d'un compte (§24.4) | des entiers |

`account_id`, `error` et `postgrest_status` sont déjà passés par d'autres événements du service, par exemple
`inbound_account_checked` et `inbound_poll_failed`. Ils y paraissent désormais aussi, et c'est voulu : ces lignes
étaient muettes pour la même raison.

**Jamais** : le message d'une exception (`str(erreur)`), l'hôte, le port, l'identifiant de connexion, l'adresse de la
boîte, le mot de passe. Un serveur IMAP peut recopier l'identifiant de connexion dans son refus, et `LoginError` le
porte alors dans son texte.

**Les lignes de la veille** :

| Événement | Niveau | Champs |
|---|---|---|
| `veille_compte_echoue` | `WARNING` | `account_id`, `panne`, `error` si l'échec est celui de la boîte (§24.3), `postgrest_status` si c'est la base ; avec `refus_consecutifs` et `retry_in_seconds` après un refus d'authentification |
| `veille_source_indisponible` | `WARNING` | `panne`, `postgrest_status` |
| `veille_tour_termine` | `INFO` | `releves`, `echecs`, `ignores`, `espaces` |
| `releve_echec_non_ecrit` | `WARNING`, le niveau du journal de la relève | `account_id`, `error`, `panne`, `postgrest_status` : l'échec n'a pas pu être écrit en base (§24.3) |

### 24.3 (ii) L'échec et le succès d'une relève s'écrivent

**Le classement de l'échec** est une fonction pure du service, `classer_echec_releve(erreur) -> str | None`. Elle rend
l'un des six codes du §13.7 quand **la boîte** est en cause, et `None` sinon :

- `PostgrestError` → `None` : c'est la base qui a failli, pas la boîte, et rien n'est écrit sur la ligne ;
- une erreur IMAP (`IMAPClientError`), TLS (`ssl.SSLError`) ou réseau (`OSError`) → le code que rend déjà le test de
  connexion, par la même traduction (`imap_probe`, §13.7). Un refus de LOGIN donne donc `auth_failed`, exactement comme
  « Tester la connexion » ;
- toute autre exception → `None` : c'est un défaut du service, pas un constat sur la boîte. L'écrire en
  `protocol_error` ferait chercher la panne chez le fournisseur. La ligne de journal porte son `panne`.

**L'écriture vit dans `relever_compte`**, autour de la relève, pour les deux chemins (§23.2). Quand le code n'est pas
`None`, elle appelle la nouvelle fonction de base `mail_inbound_account_record_poll_failure`, puis **relance l'exception
d'origine** : la veille la compte et la journalise, `/poll` rend `502` comme avant. Si cette écriture échoue à son tour,
l'échec n'est pas avalé : `releve_echec_non_ecrit` le dit, et c'est l'exception d'origine qui remonte, pas celle de
l'écriture.

**Deux fonctions de base, migration `0170`** (`docs/SCHEMA.md` « Migration `0170` ») :

- **`public.mail_inbound_account_record_poll_failure(p_account_id uuid, p_error text) returns void`** — nouvelle,
  `SECURITY DEFINER`, `search_path = ''`, exécutable par le seul `service_role`. Elle pose `status = 'error'` et
  `last_error = p_error`. La contrainte de la table (`0022`) refuse un code hors des six. **Elle ne touche ni
  `last_checked_at` ni `last_sync_at`.** `last_checked_at` reste la date du dernier *test* : la garde de 30 s (§23.3) s'y
  lit, et une relève qui l'écrirait refuserait « Tester la connexion » une fois sur deux. `last_sync_at` reste la date
  de la dernière relève *réussie*. Un compte inconnu est refusé par `app.raise_http_error(404, 'account_not_found')`.
- **`public.mail_inbound_account_record_sync(uuid)`** — reprise à l'identique (§23.2), avec un ajout : elle pose aussi
  `status = 'ok'` et `last_error = null`. Une relève allée au bout prouve que la connexion fonctionne. Garder un
  `error` ou un `pending` à côté d'une relève datée de la minute serait une contradiction à l'écran.

**Une ligne `disabled` n'est jamais réécrite** par l'une ou l'autre : les deux fonctions laissent `status` et
`last_error` en l'état quand `status = 'disabled'`. `record_sync` date tout de même la relève. Une relève par `/poll` a
pu avoir lieu, et la date reste un constat.

### 24.4 (iii) L'espacement après un refus d'authentification

**Seul `auth_failed` est espacé.** Les cinq autres codes sont des pannes de transport (§20.3, décision 331). Un serveur
injoignable reviendra, et la veille le retente au tour suivant comme aujourd'hui. Un mot de passe refusé ne deviendra
pas juste en attendant, et chaque nouvel essai est un LOGIN refusé de plus, qu'un fournisseur peut sanctionner en
verrouillant la boîte.

**La règle est pure**, dans `veille.py`, comme le reste de la décision (§20.10.2) :

- après le *n*-ième refus consécutif, la boîte n'est plus relevée avant `min(300 × 2^(n−1), 3 600)` secondes. La
  suite est donc 5, 10, 20 et 40 minutes, puis une heure ;
- **le plafond d'une heure** est la borne haute de l'intervalle de veille (§20.10.5). Une boîte réparée chez le
  fournisseur, sans rien changer dans le CRM, est donc reprise dans l'heure ;
- l'échéance se compte sur l'horloge **monotone** du pilote, injectable (§20.10.2) : la preuve avance l'horloge et ne
  dort jamais.

**L'espacement cesse dès que la base dit autre chose qu'`error`.** À chaque tour, la veille relit `status`. Il vaut
`pending` quand la connexion a été modifiée : un nouveau mot de passe remet l'état à `pending` (`0022`, §21). Il vaut
`ok` après un test réussi (§23). Dans ces deux cas, l'espacement du compte est oublié et la boîte est relevée au tour
même. Corriger le mot de passe ou tester avec succès relance donc la relève sans attendre l'échéance. Une relève réussie
l'oublie aussi.

**L'état de l'espacement vit en mémoire du pilote**, pas en base. Le garder en base demanderait une colonne et une
écriture par refus, pour un gain mince : sans espacement mémorisé, un redémarrage coûte au pire un LOGIN refusé.

**Ce qui se voit** : `veille_compte_echoue` porte `refus_consecutifs` et `retry_in_seconds` ; `veille_tour_termine`
compte les boîtes espacées en `espaces`, sans une ligne par boîte et par tour. Une boîte espacée n'est pas comptée en
`ignores`, réservé aux comptes sans secret ou `disabled`.

### 24.5 (iv) Une boîte `disabled` n'est pas relevée

`lire_comptes_a_veiller` lit aussi `status`, et demande au serveur `status=neq.disabled`. `ordonner_comptes` écarte de
plus toute boîte `disabled`, avec les comptes sans secret (§20.10.6) : la décision reste vérifiable sans base, même
devant une source qui ne filtrerait pas. Une boîte `disabled` est comptée en `ignores`.

`CompteAVeiller` gagne le champ `statut`, la valeur de `status` telle que la base la rend. L'espacement (§24.4) le lit
aussi.

### 24.6 Seed

**Inchangé.** *Conséquence mesurée sur la pile de développement (sessions d9 et be, 2026-11-10)* : les trois boîtes du
seed naissent `pending`. La veille les relève à la minute, et la première relève réussie les rend `ok`. « Non testée »
ne dure donc que jusqu'au premier tour, et une preuve ne la suppose plus pour une boîte du seed :
`e2e/ui/reglages-comptes-mail.spec.ts` confronte chaque pilule au statut relu en base. Le témoin de « Non testée » est
tenu après un enregistrement (`e2e/ui/tester-connexion.spec.ts`) et par Vitest. `e2e/manuel/13-etat-messagerie.spec.ts`
pose « Jamais relevée » sur la boîte de Driss, comme les incidents. L'échec se reproduit par le véritable parcours, sans
trace fabriquée (`CLAUDE.md` §8). Un mauvais mot de
passe est posé par `upsert_mail_inbound_account`, une relève a lieu, puis le bon mot de passe est remis. Les scénarios qui
le font rendent la ligne dans son état d'origine. Une boîte `disabled` naît de même dans la preuve qui en a besoin, et y
est rendue.

### 24.7 Preuves exigées

| Niveau | Preuve |
|---|---|
| pytest | **le journal** : une ligne de la veille porte `account_id`, `panne`, `error` et les compteurs ; un champ hors liste (hôte, identifiant de connexion, mot de passe) n'est jamais émis ; le texte d'un `LoginError` qui recopie l'identifiant de connexion n'apparaît nulle part. **Le classement** : refus de LOGIN → `auth_failed`, TLS, délai, hôte, refus de connexion, `PostgrestError` → `None`, exception inattendue → `None`. **L'écriture** : `relever_compte` écrit l'échec de la boîte puis relance l'exception d'origine ; n'écrit rien pour un échec de la base ; une écriture qui échoue est journalisée et n'efface pas l'exception d'origine. **L'espacement** : la suite 300, 600, 1 200, 2 400, 3 600, 3 600 ; une boîte espacée n'est pas relevée avant l'échéance et l'est après, horloge avancée sans dormir ; `pending` ou `ok` relu oublie l'espacement ; une panne de transport n'espace pas. **Disabled** : `ordonner_comptes` l'écarte et la compte en `ignores` |
| pgTAP | `mail_inbound_account_record_poll_failure` : refusée à `anon` et à `authenticated` ; pose `error` et le code pour `service_role` sans toucher `last_checked_at` ni `last_sync_at` ; refuse un code hors des six ; laisse une ligne `disabled` intacte ; `account_not_found` sur un inconnu. `mail_inbound_account_record_sync` : pose `ok` et efface `last_error`, laisse `disabled` en l'état tout en datant |
| Intégration (contre la vraie base et le vrai service) | `e2e/mail/releve-echec-ecrite.spec.ts`. Sur la pile de développement, une relève réelle (`/poll`) d'une boîte du seed au mauvais mot de passe écrit `error` et `auth_failed`, sans toucher `last_checked_at`. Remise au bon mot de passe, la relève suivante écrit `ok`. `lire_comptes_a_veiller`, exécutée dans le conteneur du service, n'y rend pas une boîte `disabled`. *Précisé à l'écriture* : le projet `mail` plutôt que pytest. Aucune suite pytest du service n'atteint la pile, et le projet `mail` est le chemin déjà tracé vers le conteneur (`e2e/mail/releve-datee.spec.ts`) |
| Harnais | `scripts/verify-mail-inbound.sh` gagne une section 4 bis : traçabilité, droits de la fonction en base, suite pgTAP 0159 et intégration. Son §6 gagne six dégradations : l'écriture ouverte à `authenticated`, sans le filtre `disabled` (dans le pilote, puis dans la requête), sans l'écriture de l'échec, sans l'espacement, sans `account_id` au journal. `scripts/verify-mail-resilience.sh` (la veille) est rejoué vert. *Précisé à l'écriture* : il est en cours de modification par `CRM-132`, et les preuves de `CRM-135` n'y sont pas ajoutées pour ne pas croiser ce chantier |
| E2E `ui` | `/reglages/messagerie` : après une relève réelle au mauvais mot de passe, la boîte montre « Authentification refusée » en « Dernier incident », relu en base ; la ligne est rendue ensuite. Captures 1440 et 390 observées |

### 24.8 Limites nommées

- L'espacement est perdu au redémarrage du service (§24.4).
- Le classement range en `None` toute exception qui n'est ni IMAP, ni TLS, ni réseau. Une panne de la boîte qui
  prendrait une autre forme ne serait pas écrite sur la ligne, seulement journalisée.
- Une `OSError` levée hors de la session IMAP pendant une relève est classée comme une panne de la boîte. Par exemple, un
  délai de lecture d'une réponse de la base qui ne serait pas enveloppé en `PostgrestError`. Le cas est étroit :
  `PostgrestClient` enveloppe ses erreurs d'URL, et l'antivirus absorbe les siennes (§15).

---

## 25. Historique, dossiers relevés, style de classement et quota d'envoi réglables à l'écran — `CRM-136`

*Écrit avant le code, `docs/JOURNAL.md` décisions 875 (l'arbitrage du responsable), 884 (les choix de conception, et trois
points soumis à son arbitrage) et 885 (ses réponses). Origine : la boîte de production ne relève que le courrier reçu depuis son branchement
(§20.6 bis.4, `backfill_months = 0`), et aucun écran ne permet de changer ce réglage.*

### 25.1 Ce que l'unité livre, et ce qu'elle ne livre pas

Livré :

- **(i) deux réglages de relève sur Réglages ▸ Comptes de messagerie entrante** (§21) : l'historique
  (`backfill_months`, au formulaire, §25.4) et les dossiers relevés (`watch_folders`, au panneau, §25.5). Le §21.1 les
  renvoyait à `CRM-054` et `CRM-056`, qui ne les ont jamais exposés. **Le style de classement (`folder_style`) n'est pas
  exposé** (décision 885, §25.2) ;
- **(ii) le choix des dossiers parmi ceux de la boîte** (§25.3, §25.5) : l'écran lit la liste réelle des dossiers du
  serveur IMAP et propose une case par dossier ;
- **(iii) le quota journalier sur Réglages ▸ Identités d'expédition** (§22), y compris le retour à « aucun plafond »
  (§25.6). La migration de l'unité corrige pour cela le `coalesce` de `upsert_mail_outbound_identity` que le §22.1
  nommait.

**Connecteur MCP : non** (décision 875) : « ce sont des réglages internes exclusifs UI ». Aucun outil, aucune famille,
aucune case de la matrice (`docs/SPEC-mcp.md` §6.1).

**Non livré, et nommé :**

- **aucune suppression d'un message déjà relevé** quand un dossier est décoché ou l'historique réduit (§25.7) ;
- **aucun relevé « immédiat » de l'historique** : l'historique descend par lots, au rythme de la veille (§20.6 bis.3) ;
- **aucun réglage de l'intervalle de veille**, qui reste une variable d'installation (§20.10.5) ;
- **aucun réglage du style de classement** (`folder_style`) : aucun code ne le lit (INC-351), et le responsable a choisi de
  ne pas l'exposer (décision 885). INC-351 reste ouverte, sans correction dans cette unité.

### 25.2 Trois points soumis à l'arbitrage du responsable — tranchés

La décision 875 tranche le quoi ; la conception a rencontré trois questions qu'elle ne tranche pas. **Le responsable les a
tranchées le 2026-11-10 (décision 885)** : (1) le panneau dans le flux, comme recommandé ; (2) **`folder_style` n'est pas
exposé** ; (3) la liste par le test de connexion, comme recommandé. Le texte d'origine des trois questions suit.

1. **« Une fenêtre de cases à cocher »** : le design system n'admet aucune modale sur les écrans de réglages (§5.13,
   §5.34 : « aucune modale », pour ne pas recouvrir la liste que l'on règle). **Recommandé** : un **panneau dans le flux du
   document**, sous la ligne de la boîte, qui porte les cases. Il a la fonction de la fenêtre demandée, sans voile ni
   piège de focus. L'autre voie, une vraie modale, demanderait un écart nouveau, écrit au §12 du design system.
2. **Ce que fait `folder_style`.** MESURÉ : **aucun code ne lit la colonne.** `mail-sync` décide seul si une boîte se prête
   aux dossiers, par la capacité `X-GM-EXT-1` des serveurs à libellés (§17.2, `supporte_les_dossiers`). Exposer le
   réglage tel quel offrirait une commande sans effet (`docs/DESIGN_SYSTEM.md` §5.10) : c'est INC-351. **Recommandé** :
   `folder` (« Dossiers ») garde le comportement actuel, et `label` (« Libellés ») **interdit au CRM de créer des dossiers
   et d'y copier les messages dans cette boîte**, même sur un serveur qui le permettrait. La détection d'un serveur à
   libellés reste prioritaire : `folder` ne force jamais les dossiers chez Gmail. L'autre voie est de ne pas exposer le
   réglage. **Retenue par le responsable (décision 885) : le réglage n'est pas exposé.**
3. **Lister les dossiers est une connexion réelle.** **Recommandé** : la liste vient du **test de connexion existant**
   (§23), qui ouvre déjà la session et exécute `LIST`. Lister les dossiers est donc un test : il écrit `status`,
   `last_error` et `last_checked_at`, et la garde de 30 s le borne (§23.3). Un fournisseur peut verrouiller une boîte après
   des authentifications répétées, et la garde existante protège aussi ce geste.

### 25.3 La liste des dossiers vient du test de connexion (§25.2, point 3)

**`mail-sync`**, route `POST /internal/v1/inbound-accounts/{id}/test` (§13.5) : la réponse gagne `folder_names`, la liste
des dossiers **sélectionnables** que `LIST` a rendus. Ce sont des noms décodés par IMAPClient (§17.1), dans l'ordre du
serveur.

- **Exclus** : les dossiers marqués `\Noselect`, qu'on ne peut pas ouvrir, et **la racine `CRM` du produit et ses
  descendants** (§4.5, `CRM/Affaires/…`). Ces dossiers contiennent des copies faites par le CRM lui-même ; les relever ne
  créerait que des occurrences en double.
- `folders`, le nombre, reste rendu et inchangé.
- La sonde n'écrit toujours rien d'autre que le verdict (§13.5). Les noms de dossiers ne sont **jamais journalisés** : ce
  sont des données de la boîte.

**La fonction edge `mail-connection-test`** (§23.4) relaie `folder_names` dans sa réponse `200`, **pour une boîte entrante
seulement**, sous le même droit : celui d'écrire la ligne (§23.3). Aucune route, aucune fonction, aucun droit nouveau.
Un appel de l'écran porte `{"target": "inbound", "id": …}` comme aujourd'hui ; la réponse d'une identité sortante est
inchangée.

### 25.4 Le formulaire de la boîte gagne un champ

Sous les champs de connexion du §21.4, un champ, **sans garde de saisie qui doublerait la base** (§5.3 ter) :

| Champ | Contrôle | Contrainte de la base | Valeur envoyée |
|---|---|---|---|
| Historique relevé, en mois | nombre | `mail_inbound_accounts_backfill_borne`, 0 à 120 | `p_backfill_months` |

- **Prérempli** de la valeur de la boîte (§21.4) ; pour une boîte à créer, du défaut de la table, `0`.
- **`p_folder_style` n'est jamais envoyé** (décision 885) : `coalesce` garde la valeur en place, comme avant.
- **Le texte d'aide de l'historique dit ce que fait le nombre** : `0` relève le courrier reçu depuis le branchement, et
  rien d'avant (§20.6 bis.4). Un nombre de mois fait descendre l'historique **par lots**, du plus récent au plus ancien, au
  fil des relèves (§20.6 bis.3).
- Les refus nouveaux entrent au dictionnaire fermé du §21.7 : `mail_inbound_accounts_backfill_borne` donne « L'historique
  doit être un nombre entier de mois, de 0 à 120 », avec `23502` et `22P02` sur ce champ.
- **Les dossiers relevés ne sont pas un champ du formulaire** : ils se choisissent dans le panneau du §25.5, parce que la
  liste à proposer vient du serveur.

`mail-comptes.ts` lit désormais `watch_folders` et `backfill_months`, jamais `folder_style` (§21.3 : colonnes couvertes par le
`GRANT SELECT` de `0022`). Ce n'est pas un secret.

### 25.5 Le panneau « Dossiers relevés »

*Précision du 2026-11-10 (décision 892)* : le §5.94 du design system est pris par `CRM-137` ; ce panneau prendra le
premier paragraphe libre à l'écriture de son écran.

- **Où** : sous la ligne de la boîte, dans le flux, comme le formulaire (§25.2, point 1). Une commande discrète
  **« Dossiers relevés »** (icône Lucide `FolderTree`) sur chaque ligne de boîte, avant « Tester la connexion », avec les
  propriétés de capacité de « Configurer » : le droit est celui d'écrire la ligne (§23.3).
- **À l'ouverture**, le panneau lance le test de la boîte (§25.3) et montre « Lecture des dossiers… » pendant le vol. Au
  retour, **une case par dossier**, indentée selon la hiérarchie du serveur. Une case est **cochée** si le dossier est dans
  `watch_folders`.
- **Un dossier de `watch_folders` absent du serveur** paraît en fin de liste, coché, avec la mention « absent de la boîte ».
  On peut le décocher. `mail-sync` l'écarte déjà sans échec (§15.4, mesuré par `test_releve_datee.py`), et rien ne le retire
  en silence : c'est l'utilisateur qui décide.
- **Le test échoue ou est refusé** : le panneau n'affiche aucune case. Il écrit la phrase du verdict ou du refus (§23.5),
  et propose « Réessayer ». Les dossiers déjà relevés restent tels quels : sans liste, rien à choisir.
- **« Enregistrer »** envoie `p_watch_folders`, la liste cochée dans l'ordre affiché, par `upsert_mail_inbound_account`.
  Les autres paramètres reprennent les valeurs de la ligne, sans mot de passe (§21.5). **Aucune case cochée** est envoyé tel
  quel : la contrainte `mail_inbound_accounts_watch_folders_non_vide` (`0022`) refuse, et le refus est traduit : « Choisissez au moins
  un dossier ». Après succès, la liste est relue (§21.8).
- **« Annuler »** referme sans rien écrire. Le focus entre dans la première case, puis revient à la commande qui a ouvert
  le panneau (§5.34).
- **« Première connexion »** : après la **création** d'une boîte par le formulaire, le panneau **s'ouvre de lui-même** sur la
  nouvelle ligne. C'est la seule ouverture automatique. Une boîte existante, comme celle de la production, le reçoit par sa
  commande, à tout moment. Ce n'est pas un test silencieux : il est visible et annoncé. **Le §23.1 est révisé** : la
  création d'une boîte déclenche désormais un test, celui qui lit ses dossiers.

Les règles visuelles sont au `docs/DESIGN_SYSTEM.md` §5.99, écrites le 2026-11-11 avant le code (lecture ciblée, décision
914).

### 25.6 Le quota journalier d'une identité

- **La migration** (`docs/SCHEMA.md`, au premier numéro libre au push, selon l'arbitrage de la session de livraison) ajoute
  à `upsert_mail_outbound_identity` un paramètre **`p_daily_quota_set boolean default false`**. À `false`, rien ne change :
  `coalesce(p_daily_quota, i.daily_quota)` garde la valeur, et les appelants existants (harnais, seed) ne sont pas touchés.
  À `true`, `daily_quota = p_daily_quota` **tel quel, `NULL` compris** : c'est le retour à « aucun plafond ». Le paramètre
  est explicite, plutôt qu'une valeur sentinelle comme `-1`, que personne ne lirait sans la documentation.
- **Le formulaire de l'identité** (§22.5) gagne « Envois par jour, au plus » : un nombre. **Vide** veut dire « aucun
  plafond » et envoie `NULL` avec `p_daily_quota_set = true`. `0` est une interdiction explicite d'envoyer (§19.4). Le texte
  d'aide dit les trois sens. Le refus `mail_outbound_identities_quota_borne`, 0 à 100 000, est traduit (§22).
- L'écran envoie toujours `p_daily_quota_set = true`. Un formulaire qui montre la valeur et la renvoie ne peut pas
  l'écraser par erreur.

### 25.7 Ce que changent les réglages sur une boîte déjà relevée

- **Historique augmenté** : la passe d'historique recalcule sa borne à chaque tour (`borne_backfill`, §20.6 bis.3). Elle
  reprend donc sous `uid_min` et descend jusqu'à la nouvelle profondeur, par lots de 200. Aucun état n'est à réinitialiser.
- **Historique réduit** : la passe s'arrête à la nouvelle borne. **Rien de déjà relevé n'est retiré.**
- **Dossier ajouté** : il n'a pas d'état. Son premier contact relève le courrier du jour (§20.6 bis.4), puis l'historique si
  `backfill_months > 0`.
- **Dossier retiré** : il n'est plus relevé. Son état reste dans `sync_state`, ses messages restent dans le CRM, et le
  recocher reprend où il s'était arrêté.

### 25.8 Seed

- La boîte de Camille porte `backfill_months = 3`, pour qu'un historique non nul se voie dans le formulaire
  (`docs/SPEC-seed.md` §43).
- L'identité de Driss porte un plafond, `daily_quota = 200`. Les autres restent sans plafond, pour que les deux états se
  voient.
- Les valeurs sont posées par les fonctions d'écriture, comme le reste du seed (§13.8). Elles sont vérifiées contre les
  preuves existantes avant le commit : une preuve qui supposerait un `NULL` partout serait à revoir, pas à contourner.
- Les dossiers que le panneau liste sont ceux du Stalwart de développement. Ils seront **mesurés** à l'écriture du code
  par un vrai `LIST`, et non supposés ; ils ne demandent aucun seed propre.

### 25.9 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | `upsert_mail_outbound_identity` : `p_daily_quota_set` absent garde le quota ; `true` avec `NULL` le remet à « aucun plafond » ; `true` avec `n` l'écrit ; la borne refuse `100001` ; un membre ne règle pas l'identité d'un autre, et `anon` n'exécute pas. `upsert_mail_inbound_account` : `p_watch_folders` vide refusé, `p_backfill_months` hors bornes refusé |
| pytest | la sonde rend `folder_names` sans `\Noselect` ni la racine `CRM` ; un dossier absent ne fait pas échouer la relève (existant)  |
| Deno | le relais rend `folder_names` pour `inbound`, rien de plus pour `outbound` ; un corps de service sans `folder_names` reste lisible |
| Vitest | le module : colonnes lues, `p_daily_quota_set` toujours envoyé, vide → `NULL` ; le panneau : vol, cases, absent du serveur, aucun cochée refusé et traduit, annulation, focus rendu ; le formulaire : l'historique prérempli et traduit, `p_folder_style` jamais envoyé |
| API (Playwright) | avec les jetons réels : un membre règle sa boîte et se voit refuser celle d'un collègue (`404` au test, `42501` à l'écriture) ; le quota remis à « aucun plafond » est relu `null` |
| E2E `ui` | **sur le vrai Stalwart** : le panneau liste les dossiers de la boîte du seed, on coche un second dossier mesuré, on enregistre, `watch_folders` est relu en base et une relève réelle relève ce dossier. Le formulaire règle l'historique. Une identité reçoit un plafond, puis revient à « aucun plafond ». Au clavier et à la souris, captures aux quatre paliers observées |
| Manuel | §11 : les deux champs, le panneau, le quota ; images |

### 25.10 Limites nommées

- La liste des dossiers est celle du moment du test : un dossier créé ensuite chez le fournisseur ne paraît qu'au
  prochain test.
- Un historique profond descend lentement, 200 messages par dossier et par tour (§20.6 bis.3) ; la valeur n'est toujours
  pas mesurée sur une vraie boîte.
- Aucun écran ne pose encore `disabled` (§24.1).

### 25.11 Tranches

*Écrit le 2026-11-10 à la reprise de l'unité (session c2), avant le code.* Chaque tranche est commitée et poussée vérifiée
(décision 904).

1. **T1, la base** : la migration du quota (`p_daily_quota_set`, §25.6) ; pgTAP (§25.9, ligne « pgTAP ») ; `docs/SCHEMA.md` ;
   le contrat de déploiement.
2. **T2, la liste des dossiers** : `folder_names` dans la sonde de `mail-sync` (§25.3), son relais par
   `mail-connection-test` ; pytest et Deno ; le contrat (image `mail-sync`, fonction edge).
3. **T3, les écrans** : l'historique au formulaire de la boîte (§25.4), le panneau « Dossiers relevés » (§25.5), le quota au
   formulaire de l'identité (§25.6) ; le design system au premier paragraphe libre (lecture à décider par le responsable,
   comme les décisions 901, 907 et 910) ; Vitest, API, E2E `ui` sur le vrai Stalwart, captures ; le manuel §11.
4. **T4, le seed** (§25.8) et le contrat ; puis l'unité passe `[P]`.

## 26. Classer un mail : les affaires candidates, cherchables, l'expéditeur connu d'abord — `CRM-137`

*Écrit le 2026-11-10 avant le code, après relecture intégrale de `docs/DESIGN_SYSTEM.md` le même jour. `docs/JOURNAL.md`
décisions 877 (l'arbitrage du responsable), 891 (les deux outils du connecteur) et 893 (les choix de conception).*

### 26.1 Ce que l'unité livre, et ce qu'elle ne livre pas

**Le défaut.** Le formulaire de classement de l'inbox (§16, `FormulaireClassement`) rend un `<select>` de toutes les
affaires lisibles, « chemin › titre », lues côté client par trois requêtes et bornées à 200 (`CARDS_CLASSABLES_MAX`). Il
n'a ni recherche ni rapprochement avec l'expéditeur. Sur un espace réel, le responsable fait défiler des centaines de
lignes à chaque mail (décision 877).

Livré :
- **une fonction de lecture, `public.classification_candidates`** (§26.2), qui rend les affaires candidates d'un message,
  côté serveur et sous les droits de l'appelant ;
- **le sélecteur cherchable** et la case **« Expéditeur connu »**, cochée par défaut, à la place du `<select>`
  (`docs/DESIGN_SYSTEM.md` §5.94) ;
- **deux outils du connecteur**, famille `messagerie` (`docs/SPEC-mcp.md` §9.2 *septendecies*) : lister les candidates,
  et classer.

Non livré, et nommé :
- **le classement lui-même ne change pas.** `classify_message`, sa garde (droit d'écrire l'affaire, affaire ni archivée ni
  en corbeille) et ses refus restent ceux du §16 ;
- **la suggestion (règle 3, §4.4) ne change pas.** Elle reste rendue au-dessus du formulaire (§5.4 ter du design system),
  et n'existe que pour **exactement une** affaire active. La case « Expéditeur connu » couvre aussi le cas de plusieurs
  affaires, que la règle 3 tait ;
- **aucun rapprochement par le domaine de l'organisation** : la décision 877 dit « un contact rattaché » ; le domaine
  reste le pivot de la seule création de contact (§16) ;
- **un contact porte une seule adresse** (`contacts.email`) : l'unité n'en ajoute pas.

### 26.2 `public.classification_candidates` — le contrat

```
public.classification_candidates(
  p_message_id   uuid,
  p_known_sender boolean default true,
  p_search       text    default null,
  p_limit        integer default 50
) returns table (card_id uuid, title text, path text, known_sender boolean)
```

- **`security invoker`, `stable`, `search_path` vidé**, relations pleinement qualifiées. Elle ne lit **que ce que les
  politiques de l'appelant lui rendent** : le message (`mail_messages`), les affaires et leurs rattachements, les channels
  et les tracks, les contacts et leurs liens. Aucun droit n'est calculé dans la fonction : c'est la RLS qui filtre
  (`CLAUDE.md` §10). `execute` à `authenticated` seulement ; l'anonyme est refusé par le privilège.
- **Le message doit être lisible.** Sinon la fonction refuse par `app.raise_http_error(404, 'message_not_found')` (la
  convention de `CRM-120`) : un message illisible et un message inexistant ne se distinguent pas.
- **Une affaire est candidate** si elle n'est pas en corbeille (`deleted_at is null`) et a **au moins un rattachement non
  archivé lisible**. C'est la règle de `lireCardsClassables`, passée dans la base : la base refuse de classer dans une
  affaire rangée (§16.2), et la proposer serait promettre un refus.
- **`known_sender`** est vrai quand un contact **lisible** rattaché à l'affaire (`card_contacts`) porte l'adresse de
  l'expéditeur : `lower(contacts.email) = lower(btrim(mail_messages.from_address))`. C'est la comparaison exacte de la
  règle 3 (`0046`), pour qu'un même expéditeur soit « connu » de la même façon partout. `from_address` est stockée
  nue (mesuré : `bizdev@p2enjoy.test`, sans nom).
- **`p_known_sender` vrai** ne rend que les affaires où `known_sender` est vrai ; **faux**, toutes les candidates, et la
  colonne dit lesquelles sont connues.
- **`p_search`**, rogné, retient les affaires dont le titre **ou** le chemin contient le terme, sans tenir compte de la
  casse ni des accents : `extensions.unaccent(lower(…))` des deux côtés, en sous-chaîne. Un terme vide ou nul ne filtre
  rien. Ce n'est pas la recherche globale (`recherche_globale`, radicalisée et préfixe) : un sélecteur cherche une
  affaire qu'on a sous les yeux, et « vitri » doit trouver « vitrine ».
- **`path`** est « Track › Channel » du **plus ancien rattachement non archivé lisible** de l'affaire, la règle de
  `lireCardsClassables` (`CRM-111` T2.4.1) ; vide si le channel ou le track ne se lit pas.
- **L'ordre** : les affaires connues d'abord, puis le titre, puis l'identifiant. Il est rendu par la base et jamais
  retrié à l'écran (§5.22 du design system).
- **`p_limit`** est borné de 1 à 100 (défaut 50) ; une valeur hors bornes est ramenée dans les bornes, sans refus.
  L'appelant qui veut savoir s'il y en a plus demande **une ligne de plus** qu'il n'en montre (§26.3).

**Migration** : au prochain numéro libre, pris à l'écriture du code. Elle ne crée ni table ni colonne, ne touche aucune
donnée et se retire par un `drop function` (`docs/SCHEMA.md`). Elle part avec la webapp et l'image `mcp` qui
l'appellent (`docs/PROD_MIGRATIONS.md`).

### 26.3 L'écran

La forme est au §5.94 du design system. Le comportement :
- **à l'ouverture du formulaire**, la case est **cochée** et la liste demande `p_known_sender => true`, sans terme, avec
  `p_limit => 51`, pour en montrer 50 et savoir s'il y en a d'autres. L'état de la case n'est mémorisé nulle part : il
  repart coché à chaque ouverture (`CLAUDE.md` §11) ;
- **chaque frappe relance la lecture** après 200 ms de repos (le délai de la palette, `docs/SPEC-recherche.md` §13.3) ;
  **décocher ou recocher** la relance aussitôt. Une réponse arrivée après une plus récente est ignorée ;
- **aucune affaire n'est présélectionnée**, sauf quand la liste **cochée et sans terme** n'en rend **qu'une** : elle est
  alors choisie, comme le contact unique d'une prévisualisation (`CRM-124`). « Classer » reste désactivé sans choix
  (§5.50 du design system) ;
- **le choix survit au filtre** : une affaire choisie qui sort de la liste après une frappe reste nommée sous le champ
  (« Affaire choisie : … »), et c'est elle que « Classer » envoie ;
- « Classer » appelle `classify_message`, inchangée, et ses refus restent ceux d'aujourd'hui.

### 26.4 Données de développement

*Révisé le 2026-11-10 à l'écriture du code.* La première rédaction promettait un message d'un contact rattaché à **deux**
affaires. Mesuré : le seed n'a qu'**une** boîte de correspondant extérieur, celle de Léo Marchand, et un principal du
serveur de dev n'expédie que depuis sa propre adresse (`501 5.5.4`). En ajouter une seconde toucherait au provisionnement
du serveur de courrier, et rattacher Léo à une seconde affaire supprimerait la suggestion (règle 3) que `CRM-060` prouve sur
son message. **Le seed existant démontre donc l'unité sans changement** :
- « Point d'avancement — migration ERP », de Léo Marchand, contact de la seule affaire `…00c2` : un **expéditeur connu**.
  La case cochée montre cette affaire, présélectionnée (§26.3) ;
- « Candidature spontanée », de `bizdev@p2enjoy.test`, contact d'aucune affaire : un **expéditeur inconnu**, pour l'état
  vide qui propose de décocher.

Le cas de **plusieurs** affaires connues est monté et défait par les preuves elles-mêmes. L'E2E API et l'E2E UI rattachent
Léo à une seconde affaire par la clé de service, puis retirent ce lien. Le pgTAP crée sa propre sonde dans sa transaction.

### 26.5 Preuves

- **pgTAP** :
  - le filtre connu et non connu ;
  - la recherche sans casse ni accents, sur le titre et sur le chemin ;
  - l'ordre ;
  - les bornes de `p_limit` ;
  - une affaire en corbeille ou au rattachement archivé exclue ;
  - le message illisible en 404 ;
  - l'anonyme refusé ;
  - une affaire illisible jamais rendue, la lectrice ne voyant pas l'affaire `…00c1` ;
  - un lien affaire–contact illisible, celui d'une affaire illisible, qui ne rend jamais cette affaire. *Précisé à
    l'écriture du code* : un contact se lit par tout membre de l'espace (`contacts_lecture_membre`), et un lien suit la
    lecture de son affaire (`card_contacts_lecture`). Le cas d'un « contact illisible » se confond donc avec celui d'une
    affaire illisible.
- **API** : les mêmes droits par jeton réel, administratrice, business developer et lectrice.
- **Unitaires** : le module de lecture et le composant (débounce, réponse périmée ignorée, présélection unique, choix
  conservé).
- **E2E souris et clavier** sur le seed :
  - case cochée, puis décochée ;
  - recherche ;
  - état vide et son action ;
  - classement réussi ;
  - captures aux quatre paliers.
- **Connecteur** : `mcp/tests` et `scripts/verify-mcp.sh`.

## 27. « Seulement moi » : l'inbox montre d'abord le courrier qui me concerne — `CRM-139`

*Écrit le 2026-11-10, avant le code, après lecture des sections générales du design system et de celles de l'inbox
(décision 901). `docs/JOURNAL.md` décisions 879 (l'arbitrage du responsable) et 902 (les points que la 879 laissait à la
spécification).*

### 27.1 Ce que l'unité livre, et ce qu'elle ne livre pas

**La demande** (décision 879) : une case « Seulement moi », cochée par défaut, qui ne montre dans l'inbox que les mails où
l'une des adresses d'expédition **personnelles** de la personne connectée est destinataire (À, Cc, Cci) ou expéditrice.

Livré :
- **une fonction de lecture par message, `public.concerns_me(public.mail_messages)`** (§27.2), employée comme colonne
  calculée par la liste ;
- **`public.inbox_arborescence(p_only_me boolean default false)`**, dont les compteurs suivent la case (§27.3) ;
- **la case dans l'inbox**, son état dans l'adresse, et son état désactivé (`docs/DESIGN_SYSTEM.md` §5.96) ;
- **un argument `only_me` sur `crm_card_mail_list`** (`docs/SPEC-mcp.md` §9.2 *duodevicies*).

Non livré, et nommé :
- **ce n'est pas une règle d'accès.** La RLS des messages ne change pas. Décochée, la case rend exactement l'inbox
  d'avant. Un message qui ne concerne pas la personne reste lisible, par l'inbox décochée, par la fiche de l'affaire et
  par la recherche ;
- **la fiche d'une affaire n'a pas la case** : son fil reste entier ;
- **l'identité de service** (`owner_id` nul) n'est l'adresse de personne. Elle n'entre jamais dans le filtre, même pour
  un administrateur ;
- **le domaine ne compte pas** : seule l'adresse exacte d'une identité compte, pas son domaine.

### 27.2 `public.concerns_me` — le contrat

```
public.concerns_me(public.mail_messages) returns boolean
```

- **Son paramètre n'a pas de nom** (*précisé à l'écriture du code*) : c'est ce qui en fait une **colonne calculée** de
  `mail_messages` pour PostgREST et pour le générateur de types, comme `is_read` (§18 bis.3). La liste la lit et la
  filtre par son nom, `concerns_me`.
- **`sql`, `stable`, `security invoker`, `search_path` vidé.** Elle lit les identités de l'appelant sous la RLS
  (`mail_outbound_identities_lecture_proprietaire`), en filtrant explicitement `owner_id = auth.uid()`. Un
  administrateur lit aussi les identités des autres (`…_lecture_admin`), et ce filtre explicite les écarte.
- **Vraie** quand l'une des adresses de `m.to_addresses`, `m.cc_addresses`, `m.bcc_addresses` ou `m.from_address`
  est égale à l'adresse d'une identité personnelle de l'appelant. La comparaison se fait par
  `lower(btrim(…))` des deux côtés. **Mesuré** : `mail-sync` stocke les adresses nues et en minuscules, sans la forme
  `Nom <adresse>` (`mime_analyse._adresses`). Une identité peut porter des majuscules, et la comparaison les ignore.
- **Fausse** pour un appelant sans identité personnelle : rien ne le concerne. C'est l'écran qui, dans ce cas, n'applique
  pas le filtre (§27.4).
- Le statut de l'identité (en erreur, non testée) ne compte pas : l'adresse reste celle de la personne.
- `execute` à `authenticated` seul.

### 27.3 La liste et les compteurs

- **La liste** (`lireMessages`) ajoute `concerns_me=is.true` à sa lecture quand le filtre s'applique. Le filtre porte
  sur **les messages**, comme la décision 879 le dit. Le groupement en fils (§16.16) se fait ensuite, sur ce qui
  reste : un fil ne montre que ses messages qui concernent la personne, et le sélecteur du panneau de lecture n'énumère
  qu'eux. Décocher rend le fil entier.
- **Le filtre du sommeil** se compose après, inchangé (§16.15) : il juge les fils ainsi formés.
- **L'arborescence** : `inbox_arborescence(p_only_me => true)` compte, pour chaque dossier, les seuls messages qui
  concernent l'appelant, et leurs non-lus. Un dossier d'affaire sans aucun message qui le concerne **n'est pas rendu**,
  comme aujourd'hui un dossier sans message. « Non classés » reste toujours rendu, même à zéro. Sans argument, la fonction
  rend les compteurs d'avant : la signature change, pas le comportement des appelants existants.
- **« Tout marquer comme lu »** porte sur les fils affichés (§18 bis.2), donc sur ce que le filtre laisse.
- **`CRM-137`** n'est pas touchée. Le classement d'un message ne dépend pas de la case, et un message classé quitte
  « Non classés » pour le dossier de son affaire, qu'il y concerne la personne ou non.

### 27.4 L'écran

La forme est au §5.96 du design system. Le comportement :
- **l'état de la case vit dans l'adresse**, comme le sommeil (§16.17.1) : la clé `courrier`, de valeur `tous` quand la
  case est décochée, jamais écrite quand elle est cochée. Une valeur inconnue est ramenée au défaut. Rien n'est stocké
  sur l'appareil (`CLAUDE.md` §11). Un rechargement garde ce que l'on regardait ;
- **la présence d'une identité personnelle** est lue une fois au chargement de l'écran :
  `mail_outbound_identities?owner_id=eq.<moi>&select=id&limit=1`. **La liste et l'arborescence attendent cette
  lecture** avant de lire, pour ne pas montrer un instant le courrier de tous puis de le retirer ;
- **avec au moins une identité personnelle**, le filtre s'applique quand la case est cochée ;
- **sans identité personnelle**, la case est rendue décochée et désactivée, et le filtre ne s'applique pas. L'écran
  l'explique : « Aucune adresse d'expédition personnelle : tous les mails sont affichés. », avec un lien vers
  Réglages ▸ Identités sortantes ;
- **si la lecture des identités échoue**, la case est désactivée de la même façon, et le filtre ne s'applique pas.
  L'écran dit : « Vos adresses d'expédition n'ont pas pu être lues : tous les mails sont affichés. », avec
  « Réessayer ». Montrer tout est l'état qui ne cache rien ;
- **l'adresse d'un message l'emporte sur le filtre** (`docs/SPEC-recherche.md` §15). Quand `?message=` désigne un
  message que la case cochée cacherait, l'écran ouvre le message, et la case passe décochée en écrivant
  `courrier=tous`. La palette mène à un message, et elle ne doit pas mener à un panneau vide ;
- **une liste vide sous le filtre** dit « Aucun message de ce dossier ne vous concerne. », avec l'action « Afficher tout
  le courrier », qui décoche la case. L'écran ne sait pas, sans une lecture de plus, si le dossier a d'autres messages.
  La phrase reste donc vraie dans les deux cas, et l'action ne promet rien.

### 27.5 Données de développement

*Révisé le 2026-11-10 à l'écriture du code.* La première rédaction promettait une seconde identité personnelle à
l'administratrice, et deux messages qui la concernent. Mesuré : quatre preuves comptent **exactement trois identités**
(`e2e/api/identites-sortantes.spec.ts`, pgTAP `0025`, `0030` et `0135`), et le seed démontre déjà la case. **Le seed ne
change donc pas** :
- **Camille** (`admin@p2enjoy.test`, sa seule identité) a envoyé la proposition de démonstration, classée dans
  « Refonte du monitoring — Vertuo ». Case cochée, c'est le seul dossier compté, avec ce seul message ;
- **« Non classés »** ne la concerne pas : ses messages sont adressés à la seule boîte système. Case cochée, le dossier est
  à zéro, et son vide porte l'action « Afficher tout le courrier » ;
- **la lectrice** n'a aucune identité : la case est désactivée et explique.

**Le cas de plusieurs identités** est monté et défait par les preuves, comme celui de `CRM-137` (§26.4). Le pgTAP crée
une seconde identité dans sa transaction. L'E2E API prête une identité à Camille et à la lectrice par la clé de service,
puis les retire.

**Les preuves existantes de l'inbox** qui ne portent pas sur ce filtre ouvrent l'inbox avec `courrier=tous` : leur sujet
est ailleurs. Celles qui ouvrent un message par `?message=` restent telles quelles, puisque l'adresse du message
l'emporte sur la case. Celles qui n'emploient l'inbox que comme une page quelconque (l'aide, la barre des channels, la
navigation du manuel) ne changent pas.

### 27.6 Preuves

- **pgTAP** :
  - `concerns_me` vraie par À, par Cc, par Cci et par l'expéditeur ;
  - insensible à la casse de l'identité ;
  - fausse pour une adresse de l'identité de service et pour l'identité d'une autre personne, y compris sous un
    administrateur ;
  - fausse sans identité ;
  - `inbox_arborescence(true)` et ses compteurs ; `inbox_arborescence()` inchangée ;
  - l'anonyme refusé.
- **API**, par jetons réels : la liste filtrée de l'administratrice avec ses deux identités ; un business developer
  avec la sienne ; un message illisible jamais rendu, filtre ou non.
- **Unitaires** : la clé `courrier` (lecture, écriture, valeur inconnue), et la décision « le filtre s'applique ou
  non » selon l'identité et l'échec de sa lecture.
- **E2E souris et clavier** sur le seed : case cochée par défaut, puis décochée et recochée ; compteurs de l'arborescence ;
  vide sous le filtre et son action ; personne sans identité (case désactivée, explication, lien) ; adresse d'un message
  caché qui décoche la case ; captures aux quatre paliers.
- **Connecteur** : `mcp/tests` (unitaires et intégration) et `scripts/verify-mcp.sh`.

## 28. L'outbox : en file (annuler), envoyés, échecs (réessayer), pour toute l'équipe — `CRM-144`

*Écrit le 2026-11-10, avant le code. `docs/JOURNAL.md` décisions 898 (la demande et son périmètre) et 906 (qui exerce les
gestes, où se voit un annulé, l'envoi à l'issue incertaine). Session d5b44a2d.*

### 28.1 Ce que l'unité livre, et ce qu'elle ne livre pas

**L'existant** : `mail_outbox` porte cinq états (`queued`, `sending`, `sent`, `failed`, `cancelled`) ; `mail-sync` la vide par
`reserver_envois` (§19.4, §20.4) ; aucun écran ne montre ce qui attend, ce qui est parti, ni ce qui a échoué, et rien
n'écrit `cancelled`.

Livré :
- **trois dossiers dans l'inbox** (§28.6) : « En file » — l'heure prévue, « Annuler » ; « Envoyés » — la date, l'adresse
  d'expédition, l'affaire ; « Échecs » — le motif en toutes lettres, « Réessayer » ;
- **deux gestes, contrôlés par la base** : `public.cancel_outbound_email` et `public.retry_outbound_email` (§28.3, §28.4) ;
- **la course entre l'annulation et la passe d'envoi**, tenue par la base et prouvée (§28.5) ;
- **une ligne « Envoi annulé par X »** dans le fil de l'affaire (décision 906, Q2) ;
- **trois outils du connecteur** (§28.8).

Non livré, et nommé :
- **le récapitulatif quotidien** (`kind = 'digest'`, sans affaire) **reste hors de l'outbox** : la RLS de `mail_outbox`
  (`app.can_read_card(card_id)`) ne le rend à personne, et l'unité ne la change pas ;
- **aucun dossier « Annulés »** (décision 906, Q2) : l'annulé se lit dans le fil de son affaire ;
- **aucune modification d'un envoi en file** : on l'annule, puis on écrit un nouveau message ;
- **le double envoi possible d'un envoi orphelin** (§20.4), antérieur à l'unité, n'est pas résolu ici ; l'unité refuse
  seulement d'en dire « annulé » (§28.3).

### 28.2 Qui voit quoi

**Toute l'équipe voit les envois des affaires qu'elle lit** (décision 898) : la politique existante
`mail_outbox_lecture` (`app.can_read_card(card_id)`) s'applique telle quelle. La liste ne demande rien de plus, sauf l'adresse
d'expédition : la RLS de `mail_outbound_identities` ne rend une identité qu'à son propriétaire et aux administrateurs, si bien
qu'une collègue ne lirait pas l'adresse sous laquelle un envoi part. **L'envoi porte donc sa propre adresse** :
`mail_outbox.from_address`, posée à la mise en file depuis l'identité (déclencheur `BEFORE INSERT`), reprise pour les lignes
existantes. C'est aussi la vérité historique : une identité renommée ne réécrit pas les envois partis.

### 28.3 Annuler — `public.cancel_outbound_email(p_outbox_id uuid) returns timestamptz`

`SECURITY DEFINER`, `search_path` vidé, `authenticated` seul. Les refus, dans cet ordre :

| Refus | Code | Statut HTTP | Cas |
|---|---|---|---|
| `not_authenticated` | `42501` | 401 | aucune session |
| `outbox_not_found` | — | 404 (`app.raise_http_error`) | inconnu, illisible (`app.can_read_card` faux), ou récapitulatif quotidien : l'absence et l'interdit ne se distinguent pas |
| `forbidden` | `42501` | 403 | ni l'auteur (`created_by`) ni un administrateur de l'espace, **ou** sans droit d'écrire sur l'affaire (décision 906, Q1) |
| `outbox_sending` | — | 409 | en cours d'envoi : trop tard |
| `outbox_sent` | — | 409 | déjà parti |
| `outbox_failed` | — | 409 | en échec : rien à annuler (« Réessayer » ou rien) |
| `outbox_cancelled` | — | 409 | déjà annulé |
| `outbox_uncertain` | — | 409 | **issue incertaine** : `queued` avec `last_error = 'worker_interrompu'`, un premier essai interrompu dont le message a pu partir (décision 906, Q3) |

**Ce qu'elle écrit, en une seule mise à jour conditionnelle** : `status = 'cancelled'`, `cancelled_at = now()`,
`cancelled_by = auth.uid()`, **où** `id = p_outbox_id` **et** `status = 'queued'` **et** `last_error` n'est pas
`worker_interrompu`. Zéro ligne mise à jour : la fonction relit l'état et lève le refus qui lui correspond. Puis elle écrit
l'événement **`mail_cancelled`** dans le fil de l'affaire (`app.card_event_ecrire`, acteur l'appelant, `payload` :
`outbox_id`, `subject`) et rend `cancelled_at`.

### 28.4 Réessayer — `public.retry_outbound_email(p_outbox_id uuid) returns uuid`

`SECURITY DEFINER`, `authenticated` seul. Mêmes trois premiers refus que l'annulation ; puis :
- **l'état** : seul un `failed` se réessaie — `outbox_queued`, `outbox_sending`, `outbox_sent`, `outbox_cancelled` sinon
  (409) ;
- **les gardes de la mise en file** (§19.4), relues pour l'affaire et l'identité de l'envoi : `card_not_available`
  (`23514` : archivée, en corbeille, sans adresse), `quota_exceeded` (`23505` : le quota de l'identité, compté comme à la
  mise en file). L'identité est celle de l'auteur : **un administrateur qui réessaie l'envoi d'un collègue l'envoie sous
  l'adresse que le collègue avait choisie** (décision 906, Q1) — c'est un nouvel essai du même envoi, pas un nouvel envoi.

**Ce qu'elle écrit, conditionnellement** (`where status = 'failed'`) : `status = 'queued'`, `next_attempt_at = now()`,
`last_error = null`, `reserved_at = null` ; `attempts` est **conservé** (l'historique des essais). Elle rend l'identifiant de
l'envoi. Aucun événement de fil : l'envoi réussi écrira « Message envoyé », comme toujours.

**Les pièces d'un échec restent au stockage** : `public.depots_envoi_abandonnes` épargne désormais les objets cités par un
envoi `failed`, sans quoi un nouvel essai après vingt-quatre heures échouerait en `attachment_missing`. Ceux d'un envoi
`cancelled` redeviennent purgeables.

### 28.5 La course entre l'annulation et la passe d'envoi

**L'exigence** (décision 898, rappelée par la session de livraison) : une annulation ne laisse **jamais** partir un message,
et ne dit **jamais** « annulé » d'un message parti.

**Ce qui la tient, en base** :
1. `reserver_envois` choisit ses lignes `for update of o skip locked` **sur `status = 'queued'`**, et Postgres réévalue
   la condition sur la version la plus récente de la ligne (`READ COMMITTED`) ;
2. l'annulation est une mise à jour **conditionnelle** sur `status = 'queued'`, qui prend le même verrou de ligne.

D'où les trois ordres possibles, et aucun autre :
- **l'annulation verrouille d'abord** : la passe saute la ligne tant que le verrou est tenu, puis la relit `cancelled` et ne
  la réserve pas — rien ne part, l'annulation est vraie ;
- **la passe verrouille d'abord** : l'annulation attend, relit `sending`, ne met à jour aucune ligne et refuse
  `outbox_sending` — le message part, et personne ne l'a dit annulé ;
- **aucune ne se chevauche** : la seconde lit l'état laissé par la première.

**Le cas de l'envoi orphelin** (§20.4) : une ligne `sending` depuis dix minutes repasse `queued` avec `worker_interrompu`,
alors qu'un worker lent l'envoie peut-être encore, et que `marquer_envoi_reussi` la passera `sent` sans condition d'état.
L'annuler dirait « annulé » d'un message qui part : **elle est refusée** (`outbox_uncertain`, décision 906, Q3).
`marquer_envoi_reussi` et `marquer_envoi_echoue` ne sont pas modifiés : l'annulation ne vise jamais une ligne qu'ils
peuvent encore écrire.

**Les preuves** :
- **pgTAP, à une connexion** : les invariants de chaque transition — une ligne `cancelled`, même due et la plus ancienne,
  n'est jamais réservée ; une ligne `sending` ne s'annule pas (`outbox_sending`) ; une ligne `queued` à l'issue incertaine
  non plus (`outbox_uncertain`), et elle reste `queued` ;
- **`scripts/verify-outbox-course.sh`, à deux connexions réelles** : deux sessions `psql` ouvertes dans le conteneur de la
  base locale, pilotées pas à pas, jouent les deux ordres du verrou — l'annulation tient le verrou et la passe ne réserve
  rien, ni pendant ni après ; la passe tient le verrou et l'annulation, débloquée à la validation, refuse `outbox_sending`.
  Les lignes de la preuve sont créées puis retirées par le script. *Révisé le 2026-11-10 (`CRM-144` T1)* : la preuve
  prévue en pgTAP par `dblink` n'est pas jouable — le rôle `postgres` de Supabase n'est pas superutilisateur et `dblink`
  exige alors un mot de passe, qu'aucune preuve versionnée ne porte (`CLAUDE.md` §3) ;
- **pytest** (`mcp/tests/test_integration_outbox.py`, intégration du connecteur, contre la vraie base à travers
  PostgREST) : une série d'envois annulés sous le jeton de leur auteur **pendant** que des passes `reserver_envois`
  tournent en parallèle sous la clé de service ; à l'issue, chaque envoi est soit `cancelled` et jamais réservé, soit
  réservé et son annulation refusée — jamais les deux, jamais aucun —, et le fil porte une ligne `mail_cancelled` par
  annulation réussie, et aucune autre. Le worker local, qui joue lui aussi `reserver_envois`, n'est qu'une passe de
  plus. Une passe qui prendrait une ligne étrangère à la preuve la rend aussitôt à la file. Une manche ne compte que si
  elle a vu les deux issues (au plus cinq manches) ;
- **aucun pytest `mail-sync`** (*révisé le 2026-11-10, `CRM-144` T2*) : l'annulation ne touche aucun code du worker, qui ne
  voit que ce que `reserver_envois` rend ; la course se prouve donc en base, là où elle est tenue (le script et le pytest
  ci-dessus, le worker réel y prenant part). Un test du worker n'y prouverait rien de plus.

### 28.6 L'écran — trois dossiers de l'inbox

Les règles visuelles sont au `docs/DESIGN_SYSTEM.md` §5.98, écrites le 2026-11-10 avant le code (lecture ciblée,
décision 910). Deux précisions qu'il fixe : le dossier ouvert vit dans l'adresse sous la clé `envois` (`file`, `envoyes`,
`echecs`) ; « Seulement moi » (§27) ne s'applique pas à l'outbox, qui montre à toute l'équipe les envois qu'elle peut
lire (décision 898).
- **« En file »** : les envois `queued` et `sending`, du plus proche départ au plus lointain (`next_attempt_at`) ; par
  ligne, les destinataires, l'objet, l'affaire, l'adresse d'expédition, l'auteur, **l'heure prévue** — « au prochain
  passage » quand elle est échue —, et, pour un envoi reprogrammé après une panne, le nombre d'essais et le motif. Un envoi
  `sending` dit « en cours d'envoi », sans commande. **« Annuler »**, avec une confirmation dans le flux qui nomme l'objet ;
  un envoi à l'issue incertaine porte la phrase de la décision 906 au lieu de la commande.
- **« Envoyés »** : les envois `sent`, du plus récent au plus ancien, paginés ; la date d'envoi, les destinataires,
  l'objet, l'adresse d'expédition, l'affaire (lien vers sa fiche).
- **« Échecs »** : les envois `failed`, du plus récent au plus ancien ; **le motif en toutes lettres**, par un dictionnaire
  fermé des codes de `last_error` (§28.7) ; **« Réessayer »**, sans confirmation — il ne détruit rien.
- Les commandes suivent les droits que la base dit sur la ligne (décision 906, Q1) : une colonne calculée
  `app.outbox_gestes_permis(mail_outbox)` rend vrai pour l'auteur ou un administrateur qui écrit l'affaire ; refusée, la
  commande est **désactivée avec son motif** (`docs/DESIGN_SYSTEM.md` §5.59), jamais masquée. La base refuse de toute
  façon.

### 28.7 Le dictionnaire des motifs

Les codes que la file écrit (§13.7, §19 bis.4, §20.4) : `auth_failed`, `tls_failed`, `timeout`, `host_unreachable`,
`connection_refused`, `protocol_error`, `quota_exceeded`, `credentials_missing`, `storage_unavailable`,
`attachment_infected`, `attachment_missing`, `worker_interrompu`. Chacun a sa phrase ; un code inconnu rend « cause non
reconnue », jamais le code brut.

### 28.8 Le connecteur

**MCP : oui, famille `messagerie`, cases existantes** (décisions 898 et 906) — `docs/SPEC-mcp.md` §9.2 *undevicies* :
`crm_mail_outbox_list` (`consulter`), `crm_mail_outbox_cancel` et `crm_mail_outbox_retry` (`modifier`), ancre nouvelle
`outbox` (`mail_outbox`, qui porte son espace).

### 28.9 Migration

Une migration, au premier numéro libre au push :
- `mail_outbox.from_address` (`text`), son déclencheur `BEFORE INSERT` et la reprise des lignes existantes ;
- `mail_outbox.cancelled_at`, `mail_outbox.cancelled_by` (`profiles`, `on delete set null`) ;
- le type d'événement `mail_cancelled` dans la contrainte de `card_events` (et hors du rattachement, comme `mail_sent`) ;
- `cancel_outbound_email`, `retry_outbound_email`, `app.outbox_gestes_permis` ;
- `depots_envoi_abandonnes`, reprise (§28.4) ;
- `app.outbox_refuser_etat`, qui lève les refus d'état en 409, et `public.outbox_gestes_permis`, l'enveloppe qui expose la
  colonne calculée à PostgREST ;
- `reserver_envois`, reprise pour INC-354 : la branche du quota dépassé qualifie `attempts` par sa table, faute de quoi
  la passe échoue en entier dès qu'une identité a dépassé son quota au moment d'envoyer.

Elle porte le numéro `0176`, et son test pgTAP le `0165`. `docs/SCHEMA.md` la décrit, avec son retrait.

### 28.10 Seed

Par les vrais chemins (`CLAUDE.md` §8) : **un envoi en file** reprogrammé après une panne réelle (une identité dont le
serveur SMTP est injoignable : la passe le reprogramme avec son délai), **un échec** réel (une identité au mot de passe
refusé : `auth_failed`), **un envoyé** (ceux du seed existant), **un annulé** par la vraie fonction, sous la session de son
auteur.
*Confirmé par le responsable le 2026-11-10 (décision 913)* : les deux identités sont à Camille, en plus de son identité par
défaut ; les gardes qui comptent les identités du seed sont révisées, non relâchées (décision 51).

### 28.11 Preuves exigées

| Niveau | Preuve |
|---|---|
| pgTAP | chaque refus des deux fonctions ; les transitions permises et refusées ; l'issue incertaine ; l'événement `mail_cancelled` ; la colonne `from_address` reprise ; les invariants de la course à une connexion (§28.5) ; la purge qui épargne un échec ; la passe au quota dépassé (INC-354) |
| Script | `scripts/verify-outbox-course.sh` : la course à deux connexions réelles, les deux ordres du verrou (§28.5) |
| pytest | la course en parallèle contre la vraie base (§28.5) : un envoi annulé n'est jamais réservé, un envoi réservé n'est jamais dit annulé |
| unitaires | le dictionnaire des motifs, l'heure prévue, les états d'écran |
| API (Playwright, jetons réels) | l'auteur annule ; un administrateur annule ; une collègue non administratrice est refusée ; la lectrice ne voit rien et est refusée ; réessayer un échec, et pas un envoyé |
| E2E `ui`, souris et clavier | « En file » et « Annuler », « Envoyés », « Échecs » et « Réessayer », le refus d'un envoi à l'issue incertaine ; captures aux quatre paliers |
| Connecteur | les trois outils et `scripts/verify-mcp.sh` |
| Manuel | le chapitre de l'inbox ; le chapitre du connecteur |

### 28.12 Tranches

1. **T1, base** : la migration et pgTAP (les invariants de la course), avec la correction d'INC-354.
2. **T2, la course** : `scripts/verify-outbox-course.sh` à deux connexions, et le pytest d'intégration en parallèle.
3. **T3, l'écran** : les trois dossiers, l'API, l'E2E `ui`, les captures, le design system, le manuel.
4. **T4, le connecteur** : les trois outils, `verify-mcp.sh`, `docs/SPEC-mcp.md`.
5. **T5, le seed**.

## 29. Effacer un message : la corbeille de l'inbox, la boîte IMAP en option ; « non lu » et « sommeil » à portée — `CRM-138`

*Écrit le 2026-11-11, avant le code (décisions 878 et 917).* **Origine** : le responsable ne trouvait ni « non lu » (une
icône seule), ni le sommeil (« Mettre le fil en sommeil », sous l'en-tête), et ne pouvait pas effacer un mail. **Connecteur
MCP** : oui, famille `messagerie`, cases existantes (§29.8).

### 29.1 Ce que voit la personne

Dans le message ouvert de l'inbox (`docs/DESIGN_SYSTEM.md` §5.99) :
- un bouton **libellé** « Marquer comme non lu » ou « Marquer comme lu », **à côté** du bouton de sommeil, remplace l'icône
  seule (`inbox-basculer-lecture`) ; l'état lu reste **personnel** (`mail_message_reads`, `CRM-063`) ;
- le sommeil se dit avec **« message »** au lieu de « fil » (`docs/SPEC-cards.md` §16.14.7) ;
- **« Effacer »** ouvre une **confirmation dans le flux** (décision 921) qui nomme le message. Elle porte la case
  **« L'effacer aussi dans la boîte mail (le déplacer dans sa corbeille) »**, décochée par défaut, **offerte seulement si la
  personne peut écrire au moins une des boîtes où le message figure** (§29.3) ;
  *précisé avant le code de T3 (2026-11-11)* : cette capacité est la **colonne calculée
  `public.mailbox_trash_permitted(mail_messages)`** (migration `0181`), lue avec le message ouvert, le patron
  d'`ecriture_permise` (`docs/SPEC-droits-interface.md` §2.1). Elle rend `app.peut_ecrire_boite_du_message`, la règle même
  du point 4 du §29.3 : titulaire d'une boîte où le message figure, ou administrateur de l'espace de cette boîte. La case
  n'est rendue que sur `true` ; sur `false`, sur une valeur absente ou sur un échec de lecture, elle est absente — il n'y a
  pas de boîte à nommer, et la base refuse de toute façon (`no_writable_mailbox`). « Effacer » n'a pas de capacité propre :
  la commande est toujours offerte, et son refus est traduit dans la confirmation ;
- un dossier **« Corbeille »** dans l'inbox liste les messages effacés que la personne peut voir là (§29.4), avec la date
  d'effacement définitif, l'état du déplacement IMAP (§29.5) et **« Restaurer »** ;
- dans le fil d'une affaire, un message effacé est remplacé par la ligne **« Message effacé par X »** ; restauré, il revient,
  suivi de la ligne **« Message restauré par X »** (décision 917).

### 29.2 Le modèle

`mail_messages` reçoit **`deleted_at timestamptz`** et **`deleted_by uuid`** (vers `profiles`, `on delete set null`). Comme
pour la corbeille des affaires (`docs/SPEC-corbeille.md` §8.1), un déclencheur pose `deleted_at := now()` et `deleted_by :=
auth.uid()` au passage de `NULL` à une valeur, et les **fige** tant que le message reste en corbeille : un client ne choisit
jamais la date qui décide de la purge.

Une table nouvelle, **`mail_trash_moves`**, porte un déplacement IMAP **par occurrence** du message dans une boîte que la
personne peut écrire : `id`, `workspace_id`, `message_id` (`on delete cascade`), `account_id` (`on delete cascade`),
`folder`, `uid`, `state` (`pending`, `done`, `failed`, `cancelled`), `attempts` (≥ 0), `next_attempt_at`, `last_error`
(motif lisible, jamais un secret), `requested_by`, `created_at`, `done_at`. RLS : lecture par qui voit le message en corbeille
(§29.4) ; **aucune écriture** pour `authenticated` ; `service_role` (`mail-sync`) l'avance par des fonctions dédiées.

### 29.3 Effacer : `public.delete_message(p_message_id uuid, p_also_mailbox boolean default false)`

`SECURITY DEFINER`, `search_path` vide, `authenticated` seulement. Dans cet ordre :
1. non connecté : `42501` ; message inconnu **ou illisible** : `404 message_not_found` (indiscernables) ;
2. **le droit d'écrire** (décision 917) : classé dans une affaire, `app.can_write_card(card_id)` ; non classé,
   `app.peut_ecrire_boite_du_message(id)` — titulaire d'une boîte où il figure, ou administrateur de l'espace (la règle de
   lecture des boîtes, `app.boite_du_message_lisible`). Sinon `42501 forbidden` ;
3. déjà en corbeille : rien ne change, la fonction rend l'état (**idempotente**, aucun second événement) ;
4. `p_also_mailbox` : une ligne `pending` dans `mail_trash_moves` pour **chaque occurrence dans une boîte que la personne
   peut écrire** ; s'il n'y en a aucune, **`22023 no_writable_mailbox`**, avant toute écriture — l'écran n'offre pas la case
   dans ce cas, la base le refuse quand même ;
5. `deleted_at`, `deleted_by` posés ; classé, l'événement **`mail_deleted`** (`message_id`, `subject`) est écrit au fil de
   l'affaire par `app.card_event_ecrire`.

**La portée est le message ouvert** (décision 917) : les autres messages du même fil restent.

### 29.4 Ce qu'un message effacé n'est plus, et où il se voit

- **La politique de lecture `mail_messages_lecture` exclut tout message en corbeille** : les fonctions `SECURITY INVOKER`
  qui le lisent l'excluent d'elles-mêmes (`inbox_arborescence`, la recherche, `is_read`, `concerns_me`,
  `classification_candidates`). **Quatre fonctions `SECURITY DEFINER` reçoivent le filtre**, chacune prouvée par pgTAP :
  `app.peut_voir_message` — la garde de classer, retirer, marquer lu, lire un fil et télécharger une pièce —,
  `app.health_last_contact` sous `app.health_context` (`CRM-142`), `public.messages_a_ranger` (`mail-sync` ne range pas un
  message effacé) et `public.prepare_email` (on ne répond pas à un message effacé). Un message effacé n'est donc ni dans
  l'inbox, ni dans le fil de l'affaire, ni dans la recherche, ni compté (non lus, « à ranger », santé), ni téléchargeable,
  ni proposé au classement.
  *Précisé à l'écriture de la migration (2026-11-11)* : les autres fonctions `SECURITY DEFINER` qui lisent `mail_messages`
  le **comptent à dessein**, parce qu'il existe encore en base — l'export RGPD d'un contact (`export_contact`), l'énumération
  de ce qu'emporte la purge d'une affaire (`trash_enumerate_cards`), la détection d'une réponse par les séquences de relance
  (`executer_sequences_relance`), la tenue des envois (`reserver_envois`, `marquer_envoi_reussi`,
  `marquer_message_range`) et la classification d'un message **nouveau** par sa filiation
  (`classer_message_automatiquement`). La liste de quinze fonctions écrite avant le code en surestimait le besoin.
- **Le dossier « Corbeille »** se lit par `public.trashed_messages(p_workspace_id uuid)`, `SECURITY DEFINER` : la règle de
  la corbeille des affaires (décision 707) — **un membre y voit les messages qu'il a lui-même effacés, un administrateur
  ceux de tout l'espace** —, avec pour chacun l'objet, l'expéditeur, la date d'effacement, la date d'effacement définitif
  (`deleted_at + app.trash_retention()`) et l'état agrégé des déplacements IMAP. L'écran en tire le dossier « Corbeille »
  et son compte ; `inbox_arborescence` n'est pas changée (précisé à l'écriture de la migration).
- **Restaurer** : `public.restore_message(p_message_id uuid)`, `SECURITY DEFINER` : le message doit être dans la corbeille
  **visible** de la personne (ci-dessus) et la personne doit avoir le droit d'écrire (§29.3, point 2) ; sinon `404` puis
  `42501`. `deleted_at` et `deleted_by` repassent à `NULL` ; les déplacements encore **`pending` passent à `cancelled`** ;
  un déplacement **`done` n'est pas défait** (le message reste dans la corbeille du serveur, et le dit) ; classé,
  l'événement **`mail_restored`** est écrit. Un message dont l'affaire a été mise en corbeille entre-temps revient **tel
  quel**, classé, et se lit comme tout message d'une affaire en corbeille.

### 29.5 Le déplacement dans la corbeille de la boîte, par `mail-sync`

À chaque passe de veille, et sur la route interne **`POST /internal/v1/trash-moves/flush`** (jeton interne, comme
`/internal/v1/outbox/flush`), `mail-sync` prend les déplacements `pending` dont `next_attempt_at` est échu
(`public.trash_moves_to_process(p_limit)`, `service_role`, verrou `for update skip locked`), et pour chacun :
1. se connecte à la boîte avec ses identifiants (jamais journalisés) ;
2. cherche le dossier annoncé **`\Trash`** (RFC 6154, `LIST` étendu) ; aucun : **`failed`, `no_trash_folder`** ;
3. dans le dossier de l'occurrence, `UID MOVE` (RFC 6851) vers ce dossier ; sans `MOVE`, `UID COPY` puis `\Deleted` et
   `UID EXPUNGE` (UIDPLUS) ; sans l'un ni l'autre : **`failed`, `move_unsupported`** ;
4. un UID absent du dossier — déjà déplacé ou effacé sur le serveur — est **`done`** avec la note `absent_from_folder` ;
5. succès : **`done`**, `done_at`, et l'occurrence quitte la table `mail_message_occurrences` pour ce dossier ;
6. boîte injoignable, refus d'authentification, délai dépassé : `attempts + 1`, **nouvel essai** à 1, 5, 15, 60, puis 240
   minutes ; au **dixième** essai, **`failed`**, `last_error` lisible (`public.trash_move_record(...)`, `service_role`).

Le message est déjà dans la corbeille du CRM : un déplacement en attente ou échoué ne le ramène jamais (décision 917). L'état
se lit sur le message du dossier « Corbeille » : « Déplacé dans la corbeille de la boîte », « Déplacement en attente »,
« Déplacement impossible : {motif} ».

### 29.6 L'effacement définitif, à 30 jours

La durée est celle de la corbeille des affaires, lue au même endroit, `app.trash_retention()` (décision 917). Une fois par
heure au plus, `mail-sync` prend les messages dont `deleted_at < now() - app.trash_retention()` et dont aucun déplacement
n'est `pending` (`public.mail_messages_to_purge(p_limit)`, `service_role`) ; pour chacun, il **efface les objets de ses pièces
jointes** dans le bucket par l'API du stockage, puis appelle `public.purge_mail_message(p_message_id)` (`service_role`), qui
journalise (`app.audit_record`, `purged`, `mail_message`, **sans l'objet** : un objet de courriel peut porter une donnée
personnelle, et le journal survit au message) et supprime la ligne — ses occurrences, lectures, pièces,
sommeils et déplacements suivent par cascade. Les lignes « Message effacé par X » du fil de l'affaire restent : le journal
d'une affaire est immuable (`card_events`).

### 29.7 Le sommeil, en mots

Voir `docs/SPEC-cards.md` §16.14.7. Rien ne change au sommeil lui-même : il reste celui du fil (`snooze_thread`).

### 29.8 Le connecteur MCP — famille `messagerie`, cases existantes (décision 878)

| Outil | Action | Ancre | Ce qu'il fait |
|---|---|---|---|
| `crm_mail_set_read` | `modifier` | `message:message_id` | marque le message lu ou non lu **pour la personne** (`mark_messages_read`, `mark_message_unread`) |
| `crm_mail_snooze` | `modifier` | `message:message_id` | met le message en sommeil jusqu'à une date, ou le réveille (`snooze_thread`, `wake_thread`) |
| `crm_mail_delete` | `supprimer` | `message:message_id` | l'efface (`delete_message`), avec `also_mailbox` ; outil **destructif** |
| `crm_mail_restore` | `modifier` | `trashed_message:message_id` | le restaure (`restore_message`) ; *précisé avant le code de T4* |
| `crm_mail_trash_list` | `consulter` | `workspace:workspace` | la corbeille visible de la personne (`trashed_messages`) |

Tous agissent **sous le jeton de la personne** : la base décide (§29.3, §29.4). Aucune famille ni case nouvelle.

*Précisé avant le code de T4 (2026-11-11), révisé le même jour.* **L'ancre de `crm_mail_restore` est
`trashed_message:message_id`**, et non `message:message_id` : la politique du connecteur résout une ancre `message:` en
lisant `mail_messages` sous le jeton de la personne, et un message effacé n'y est plus lisible (§29.4) — l'ancre écrite avant
le code ne se résolvait jamais. La nouvelle ancre se résout par une fonction de la base, **`public.trashed_message_workspace(
p_message_id)`** (migration `0182`), qui rend l'espace du message **seulement s'il est dans la corbeille visible de la
personne** (la règle de `trashed_messages`), et rien sinon : la matrice s'applique à l'espace réel du message, et un message
absent rend le refus uniforme « introuvable ». *Écarté* : prendre l'espace en argument et vérifier la corbeille à part — la
règle de complétude du connecteur (§9.1 de `docs/SPEC-mcp.md` : tout identifiant est une ancre résolue) l'interdit à juste
titre. `crm_mail_snooze` lit le message pour en tirer la clé de fil (`app.cle_fil` : le premier `References`, à défaut le
`Message-ID`), la même que l'écran (`cleFil`).

### 29.9 Le seed

Un message **non classé** de la boîte de Camille effacé **avec** la case (son déplacement IMAP fait par le vrai `mail-sync`
contre le serveur de dev), et un message **classé** dans « Plateforme de billetterie — Musée des Confluences » effacé
**sans** la case puis **restauré** — le fil de l'affaire porte les deux lignes. Effacés par `delete_message` et
`restore_message` sous le jeton de Camille, comme l'écran.

### 29.10 Preuves exigées

| Niveau | Preuves |
|---|---|
| pgTAP | colonnes, déclencheur qui fige la date ; chaque refus de `delete_message` et `restore_message` dans l'ordre ; la politique et **chacune** des fonctions du §29.4 excluent un message effacé ; la règle de visibilité de la corbeille (le sien, l'administrateur) ; `mail_trash_moves` sans écriture pour `authenticated` ; la restauration qui annule les `pending` ; la purge, réservée à `service_role`, et son journal |
| pytest (`mail-sync`) | `MOVE`, `COPY`+`EXPUNGE`, `\Trash` absent, UID absent, l'espacement des essais et le dixième, aucun secret au journal |
| API | refus par jeton réel : le business developer qui ne peut pas écrire l'affaire, la lectrice, un autre membre pour la boîte d'autrui, la case sans boîte inscriptible |
| E2E `mail` | contre le vrai serveur IMAP de dev : la case cochée, le message arrive dans la corbeille de la boîte ; non cochée, il reste dans son dossier |
| E2E `ui` | souris et clavier : non lu et lu, sommeil, effacer puis annuler, effacer, retrouver dans « Corbeille », restaurer ; la ligne du fil de l'affaire |
| Connecteur | pytest des cinq outils, intégration, `verify-mcp.sh` |

---

## 30. Le corps HTML d'un mail rendu dans un cadre confiné, liens cliquables, images distantes sur demande — `CRM-140`

*Demande du responsable du 2026-11-10, arbitrée le même jour (décision 881) ; forme arbitrée le 2026-11-11 (décision 918).*
**Ce paragraphe révise le §18.4**, qui posait l'absence du rendu HTML et la figeait par une assertion. Sa dernière phrase
annonçait déjà la condition du rendu : « un bac à sable, une politique de contenu dédiée et ses propres preuves ». L'unité
pose ces trois éléments. Les preuves qui figeaient l'absence sont **retournées, non retirées** (§30.10, décision 51).

### 30.1 Ce que l'unité livre, et ce qu'elle ne livre pas

**Elle livre**, dans le panneau de lecture de l'inbox (§18.3), pour tout message de `mail_messages`, reçu ou envoyé :
- le corps HTML rendu dans un **cadre isolé** : aucun script, aucun formulaire, aucune navigation de l'écran ;
- des **liens cliquables**, qui s'ouvrent dans un nouvel onglet, sans référent ;
- des **images distantes bloquées**, avec un bandeau et le bouton « Afficher les images », qui vaut **pour ce message
  seulement** ;
- les **images intégrées** (`cid:`), affichées sans attendre lorsque leur pièce est saine (décision 918, Q2) ;
- pour un message **sans HTML**, son texte, dont les adresses web deviennent des liens.

**Elle ne livre pas** :
- un rendu HTML ailleurs que dans le panneau de lecture. La timeline d'une affaire n'affiche que l'objet et l'expéditeur
  (§18.6), l'outbox montre le corps texte de l'envoi (§28.6), et le formulaire d'envoi compose du texte (§19) ;
- un HTML **composé** par le CRM : l'envoi reste en texte ;
- une mémoire du choix « Afficher les images », ni par expéditeur ni par message. Le choix vit le temps où le message est
  ouvert, et rien n'est stocké sur l'appareil (`CLAUDE.md` §11) ;
- **le connecteur MCP** (décision 881) : il rend le corps en texte, et n'affiche rien.

### 30.2 Le choix du corps

| `body_html` | `body_text` | Ce que montre le panneau |
|---|---|---|
| non vide | quelconque | le **cadre** (§30.3), nourri du HTML nettoyé (§30.4) |
| vide ou absent | non vide | le **texte**, adresses web en liens (§30.7) |
| vide ou absent | vide ou absent | la phrase du corps vide (inchangée) |

Le HTML est préféré au texte quand les deux existent : c'est la forme que l'expéditeur a composée et que son destinataire
lit dans tout client de messagerie. La phrase « corps réduit depuis le HTML » (`inbox.message.reduced`) disparaît de
l'écran, puisque le HTML n'est plus réduit pour y être lu. `reduireHtmlEnTexte` reste pour ses autres usages, et ses tests
restent en place.

**Un HTML que le nettoyage vide** (rien de visible ne reste, par exemple un message fait d'un seul script) se rabat sur le
texte s'il existe, sinon sur la phrase du corps vide. Le cadre n'est jamais montré vide.

### 30.3 Le cadre : bac à sable et politique de contenu

Le HTML nettoyé est servi par `srcdoc` dans un `<iframe>` **qui ne porte que** :

```
sandbox="allow-popups allow-popups-to-escape-sandbox"
referrerpolicy="no-referrer"
title="Contenu du message"   (clé i18n)
```

- **Ni `allow-scripts`** : aucun script ne s'exécute, quelle que soit sa forme (balise, gestionnaire `on*`, `javascript:`).
- **Ni `allow-same-origin`** (décision 918, Q3) : le cadre a une origine opaque. Il ne lit ni les cookies, ni le stockage,
  ni le jeton de session de l'application. L'écran ne peut donc pas mesurer sa hauteur : le cadre a une hauteur fixe et
  **défile en lui-même** (§30.8).
- **Ni `allow-forms`, ni `allow-top-navigation`, ni `allow-modals`** : aucun formulaire ne s'envoie, et le message ne peut
  ni remplacer l'écran ni ouvrir une boîte de dialogue.
- **`allow-popups` et `allow-popups-to-escape-sandbox`** : un lien ouvre un onglet **ordinaire**, et non un onglet qui
  hériterait du bac à sable et casserait le site visité.

Le document servi est construit par le CRM, jamais repris de l'expéditeur. Il commence par la politique de contenu :

```html
<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="POLITIQUE">
<meta name="referrer" content="no-referrer">
<base target="_blank">
<style>/* la feuille de base, §30.8 */</style>
</head><body>HTML NETTOYÉ</body></html>
```

**La politique de contenu**, selon l'état des images :

| État | `POLITIQUE` |
|---|---|
| images bloquées (par défaut) | `default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'` |
| « Afficher les images » activé | la même, avec `img-src data: https: http:` |

- `default-src 'none'` interdit tout le reste : scripts, polices, feuilles distantes (`@import`), cadres imbriqués, médias,
  requêtes réseau.
- `img-src data:` laisse passer les images intégrées (§30.6), qui arrivent en `data:`. Les images distantes, et les fonds
  `url(...)` des styles, sont bloquées **avant la requête**.
- La politique est **une seconde barrière, indépendante du nettoyage**. Le nettoyage (§30.4) retire déjà les adresses des
  images distantes. Si une adresse lui échappait, la politique bloquerait sa requête.

### 30.4 Le nettoyage — DOMPurify

DOMPurify (décision 918, Q1 ; licence MPL-2.0 ou Apache-2.0) nettoie le HTML **dans le navigateur, au moment de
l'affichage**. Rien n'est réécrit en base : `body_html` reste le HTML reçu. Le module du CRM fixe la configuration, et ses
tests la figent.

**Retiré, avec son contenu** :
- `script`, `noscript`, `template` ;
- `iframe`, `frame`, `frameset`, `object`, `embed`, `applet` ;
- `form`, `input`, `button`, `select`, `option`, `textarea` ;
- `meta` (dont `meta http-equiv="refresh"`), `base`, `link` ;
- `audio`, `video`, `source`, `track`, `picture` ;
- `svg` et `math` : leurs espaces de noms sont la voie connue des contournements.

**Gardé** : la mise en forme d'un courrier, soit les titres, paragraphes, listes, tableaux, `img`, `a`, `span`, `div`,
`font`, `center`, ainsi que `style` en balise et en attribut. Les courriers reposent sur eux, et la politique de contenu
leur interdit tout chargement distant.

**Attributs** :
- tout attribut `on*` est retiré (la configuration par défaut de DOMPurify, que le test vérifie) ;
- `srcset`, `ping`, `formaction`, `action`, `background` (l'image de fond d'un tableau ancien) et `poster` sont retirés ;
- **sur `a`** :
  - `href` n'est gardé que pour les schémas `http:`, `https:` et `mailto:`. Tout autre schéma (`javascript:`, `data:`,
    `vbscript:`, `file:`), une adresse relative ou une ancre seule (`#…`) perd son `href`, et le texte reste en texte ;
  - le crochet pose `target="_blank"` et `rel="noopener noreferrer"` sur **chaque** lien gardé, que l'expéditeur l'ait
    écrit ou non ;
- **sur `img`** :
  - `src` en `http:` ou `https:` est **déplacé** dans `data-crm-src` : c'est une image distante bloquée, et le module la
    compte ;
  - `src` en `cid:` est résolu (§30.6) ;
  - tout autre `src` est retiré, y compris un `data:` venu de l'expéditeur. Une image intégrée n'arrive que par sa pièce,
    analysée par ClamAV.

**« Afficher les images »** reconstruit le document à partir du même HTML nettoyé : `data-crm-src` est rendu à `src`, et la
politique passe à l'état « affiché » (§30.3). Le nettoyage n'est jamais relâché, et les liens restent ce qu'ils étaient.

### 30.5 Le bandeau des images distantes

Le bandeau ne paraît que si le nettoyage a compté **au moins une** image distante (`data-crm-src`). Il dit, en une phrase,
pourquoi les images sont bloquées : leur chargement prévient l'expéditeur que le message a été ouvert. Il porte le bouton
« Afficher les images ».

- Le choix vaut **pour le message ouvert**. Ouvrir un autre message, ou revenir à celui-ci après l'avoir quitté, repart
  bloqué. L'état est attaché à l'identifiant du message dans l'écran, et rien n'est stocké.
- Après le clic, le bandeau devient une phrase d'état, « Images affichées pour ce message », annoncée par `role="status"`.
  Le focus revient sur cette phrase, pour qu'une personne au clavier ne le perde pas avec le bouton.
- Un fond `url(...)` dans un style n'est pas compté, mais il est bloqué par la politique de contenu et suit le même clic.
  Un message qui n'a **que** des fonds distants ne montre donc pas de bandeau ; ses fonds restent bloqués. C'est une
  limite nommée (§30.12).

### 30.6 Les images intégrées (`cid:`)

**Le modèle** — migration `mail_attachments_content_id` (numéro pris au push, comme celle de `CRM-138`) :
- `mail_attachments.content_id text null` : le `Content-ID` de la partie, **sans** ses chevrons, borné à 255 caractères
  par une contrainte nommée ;
- aucune politique nouvelle. La colonne se lit sous la RLS de la pièce (§18.1, `CRM-054`), et son fichier sous la
  politique de stockage de la migration `0029` (pièce saine, message lisible, §18.5).

**`mail-sync`** (`mime_analyse.analyser`) :
- relève le `Content-ID` de toute partie gardée comme pièce ;
- **garde aussi** une partie `image/*` qui porte un `Content-ID` sans nom ni disposition `attachment`. Elle était perdue
  jusqu'ici (mesuré le 2026-11-11, décision 918). Son nom de repli est celui des pièces sans nom (`NOM_DE_REPLI`) ;
- la pièce suit le chemin de toutes les autres : dépôt, ClamAV, statut.

**L'écran** :
- résout chaque `src="cid:X"` contre les pièces du message dont `content_id` vaut `X`. La comparaison ignore la casse et
  les chevrons ; si plusieurs pièces portent le même identifiant, la première par nom l'emporte ;
- lit le fichier sous la session, par le chemin de l'aperçu (`lireFichierPiece`, `CRM-074`) ;
- le pose en `data:`, avec le type **forcé** depuis la liste fermée des images de l'aperçu (`image/png`, `image/jpeg`,
  `image/gif`, `image/webp`), jamais repris du fichier.

L'image ne s'affiche que si sa pièce est **saine** (`clean`), d'un type de cette liste, et d'au plus **5 Mo**. Sinon, elle
est remplacée par une mention, « image intégrée indisponible », et par son texte alternatif s'il existe. Les images
intégrées sont lues **avant** de montrer le cadre, avec une phrase d'attente : la reconstruire au fil des lectures ferait
sauter le défilement.

Les images intégrées s'affichent **sans** « Afficher les images » : leur lecture est une requête au stockage du CRM, sous
la session, et rien ne part chez l'expéditeur. Elles **restent dans la liste des pièces jointes** du message, comme
aujourd'hui une image intégrée qui porte un nom (§30.12).

### 30.7 Le message sans HTML : des adresses web cliquables

Le texte reste rendu par React, sans aucune injection de HTML. Seules les adresses qui commencent par `http://` ou
`https://` deviennent des liens. Elles s'arrêtent au premier blanc, et une ponctuation finale (`.`, `,`, `;`, `:`, `!`,
`?`, `)`, `»`) n'en fait pas partie. Ces liens portent `target="_blank"` et `rel="noopener noreferrer"`. Une adresse
`www.…` sans schéma reste du texte : deviner un schéma serait ouvrir un lien que l'expéditeur n'a pas écrit.

### 30.8 L'écran

La forme et les règles de `docs/DESIGN_SYSTEM.md` §5.100 s'appliquent : le cadre, le bandeau et la phrase d'attente.

- Le cadre occupe la largeur du corps. Sa hauteur est fixe, celle du cadre du PDF (`docs/DESIGN_SYSTEM.md` §5.80) :
  `min(70vh, 720px)`, `60vh` sous `md`. Il défile en lui-même, à la verticale comme à l'horizontale lorsqu'un tableau
  dépasse. La page, elle, ne défile jamais à l'horizontale.
- La feuille de base est écrite par le CRM, avec les valeurs des jetons (`docs/DESIGN_SYSTEM.md` §5.100, écart §12.7) :
  fond `--color-surface`, texte `--color-text`, la pile `--font-sans`, `img { max-width: 100%; height: auto }` et la
  coupure des mots longs. Le HTML de l'expéditeur garde la main sur sa propre mise en page.
- Le clavier : `Tab` entre dans le cadre et en parcourt les liens, puis en sort vers la suite du panneau. Le cadre porte un
  `title` lisible.

### 30.9 Le seed

Un message **réellement envoyé** par la soumission SMTP du seed (le chemin du §18.7), puis **réellement relevé**, sans
trace fabriquée (`CLAUDE.md` §8). Il est en `multipart/related`, avec une alternative `text/plain` :
- un **lien** `https://` ;
- une **image distante** sur un hôte réservé aux tests, `https://images.partenaire-demo.test/…` (RFC 2606) ;
- une **image intégrée** `cid:`, un petit PNG du dépôt ;
- un **lien piégé** `javascript:`, un gestionnaire `onclick` et un `<script>`, pour que le nettoyage soit démontré sur le
  courrier du seed et non seulement en test.

Son `Message-ID` est fixe, comme ceux du §18.7. L'hôte `.test` ne se résout pas : sur la pile de développement, l'image
distante reste absente même après « Afficher les images ». L'E2E remplace ce serveur par l'interception réseau de Playwright,
qui répond une vraie image. C'est le seul double, et il tient la place d'un serveur extérieur impossible à joindre en local
(`CLAUDE.md` §15).

### 30.10 Les preuves de l'absence, retournées

- `e2e/ui/inbox.spec.ts` (« le corps est du texte ») : le message en `text/plain` du seed reste affiché en texte. Le
  message HTML du seed est rendu **dans le cadre**, et son HTML n'atteint pas le DOM de l'écran (aucun nœud du message
  hors du cadre).
- `scripts/verify-mail-inbox.sh` : le contrôle « aucun `dangerouslySetInnerHTML` » **reste**, puisque l'écran n'injecte
  toujours rien dans son propre DOM. S'y ajoutent deux contrôles du code : le cadre ne porte ni `allow-scripts` ni
  `allow-same-origin`, et le document servi commence par la politique de contenu.
- `webapp/src/lib/inbox.test.ts` : la réduction du HTML en texte garde ses tests, puisque la fonction reste.

### 30.11 Preuves exigées

| Niveau | Preuve |
|---|---|
| Vitest, nettoyage | chaque vecteur retiré : `<script>`, `onerror`/`onclick`, `href="javascript:"` (et ses variantes de casse et d'espaces), `<form>` et ses champs, `<meta http-equiv="refresh">`, `<base>`, `<link>`, `<iframe>`, `<svg>` porteur de script ; `target`/`rel` posés sur chaque lien ; l'image distante déplacée et comptée ; un `data:` d'expéditeur retiré ; le HTML vidé se rabat sur le texte |
| Vitest, document | la politique en tête, ses deux états ; `cid:` résolu, pièce non saine ou trop grande remplacée ; les adresses web du texte |
| Vitest, écran | le cadre et ses attributs exacts ; le bandeau, le clic, la phrase d'état, le retour bloqué à l'ouverture d'un autre message |
| pytest `mail-sync` | le `Content-ID` relevé ; l'image intégrée sans nom gardée ; une partie sans `Content-ID` inchangée |
| pgTAP | la colonne, sa borne ; la RLS de la pièce inchangée (un membre sans droit sur le message ne lit pas le `content_id`) |
| E2E `ui`, souris et clavier | le message HTML du seed : **aucune requête vers l'hôte de l'image avant le clic**, mesurée par l'interception réseau ; la requête part après le clic ; **le message suivant repart bloqué** ; l'image `cid:` affichée sans clic ; le lien ouvre un onglet avec `noopener` (pas d'`opener`) ; au clavier : `Tab` jusqu'au bouton, `Entrée`, le focus sur la phrase d'état, puis les liens du cadre |
| Captures | les quatre paliers, le bandeau, après le clic, le message sans HTML aux liens |
| Harnais | `scripts/verify-mail-inbox.sh` révisé (§30.10) |
| Manuel | le chapitre de l'inbox : le message HTML, le bandeau, ce que fait « Afficher les images » |

### 30.12 Limites nommées

- Un **fond distant** (`url(...)` dans un style) n'est pas compté par le bandeau (§30.5). Il est bloqué par la politique,
  et ne se débloque qu'avec le clic, lorsque le message a aussi une image distante.
- Une image intégrée **reste listée** parmi les pièces jointes (§30.6).
- Les messages relevés **avant** la migration n'ont pas de `content_id`. Leurs images `cid:` montrent la mention
  « indisponible », et une image intégrée sans nom n'a jamais été gardée. Aucune relève rétroactive.
- La hauteur du cadre ne s'ajuste pas au contenu (décision 918, Q3).
- Les polices distantes sont toujours bloquées, même après le clic. Le message prend la police système.

### 30.13 Contrat de déploiement

- La migration de `content_id` (§30.6).
- `mail-sync`, qui relève le `Content-ID`.
- La webapp, avec la dépendance `dompurify`.
- Aucune variable nouvelle.

Le retour arrière est le suivant : la colonne est facultative, une webapp antérieure l'ignore, et un `mail-sync` antérieur
ne l'écrit pas.

### 30.14 Tranches

1. **T1, le modèle** : la migration et pgTAP, puis `mail-sync` et pytest.
2. **T2, le rendu** : la dépendance, le module de nettoyage et de document, et ses tests Vitest.
3. **T3, l'écran** : le cadre, le bandeau, `cid:`, le texte aux liens ; le design system §5.100 ; l'E2E souris et clavier ;
   les captures ; le harnais révisé.
4. **T4, le seed et le manuel** : le message HTML du seed, sa garde, le manuel, le DAT (la sécurité du rendu).

## 31. Les pastilles d'un mail : posées par le LLM du CRM, réévaluables, corrigeables à la main — `CRM-141`

*Écrit le 2026-11-11, avant le code (décisions 883, 923, 924 et 926).* Le CRM passe chaque mail reçu au modèle de son
assistant IA (`docs/SPEC-ia.md` §3), qui lui attribue zéro, une ou plusieurs **pastilles** prises dans une liste propre à
l'espace. Les pastilles se voient dans la liste des mails et dans le message ouvert, se filtrent, se corrigent à la main,
et la main prime toujours. L'apparence : `docs/DESIGN_SYSTEM.md` §5.103 ; l'appel au modèle : `docs/SPEC-ia.md` §15 ; le
connecteur : `docs/SPEC-mcp.md` §9.2 *duovicies*.

### 31.1 Ce que l'unité livre, et ce qu'elle ne livre pas

**Livre** : les pastilles de l'espace et leurs défauts ; une file d'évaluation en base, cadencée par `pg_cron` ; l'appel
au modèle par la fonction `ia` ; la pose et le retrait à la main ; le bouton « Réévaluer les pastilles » ; les pastilles
dans la liste, dans le message ouvert, et un filtre par pastille ; l'écran Réglages ▸ Pastilles des mails ; trois outils
du connecteur ; le seed ; le manuel.

**Ne livre pas** :
- **les mails envoyés** ne sont pas évalués (décision 926) ; seuls les messages `direction = 'inbound'` entrent dans la
  file ;
- **aucune pièce jointe** n'est envoyée au modèle, ni son nom (décision 883) ;
- **le connecteur ne passe jamais par le LLM du CRM** : l'assistant connecté juge lui-même (décision 924) ;
- **aucune règle d'affaire** ne dépend d'une pastille : elle classe pour l'œil, elle ne déclenche rien.

### 31.2 Le modèle

Noms anglais (`docs/DAT.md` §12 bis, décision 658). La migration et son numéro : `docs/SCHEMA.md`, « Migration —
`CRM-141` T1 ».

**`public.mail_labels`** — les pastilles de l'espace :

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK |
| `workspace_id` | `uuid` | FK `workspaces`, `on delete cascade` |
| `name` | `text` | 1 à 40 caractères après `btrim` |
| `color` | `text` | un des cinq jetons (`brand`, `success`, `accent`, `danger`, `neutral`), défaut `neutral` |
| `description` | `text` | 1 à 500 caractères après `btrim` : ce que le modèle lit pour décider |
| `archived_at` | `timestamptz` | nul : active |
| `created_at`, `updated_at` | `timestamptz` | |
| `created_by` | `uuid` | FK `profiles`, `on delete set null` |

Unicité de `(workspace_id, lower(btrim(name)))`, **archivées comprises** : une pastille archivée garde son nom, et le
refus de doublon nomme la case « Afficher les archivées » (`docs/DESIGN_SYSTEM.md` §5.29 bis, règle générale). **Aucune
destruction** : `DELETE` n'est accordé à personne par l'API ; le geste des réglages est un archivage (décision 926).

**`public.mail_message_labels`** — les pastilles d'un message :

| Colonne | Type | Contrainte |
|---|---|---|
| `message_id` | `uuid` | FK `mail_messages`, `on delete cascade` |
| `label_id` | `uuid` | FK `mail_labels`, `on delete cascade` |
| `workspace_id` | `uuid` | celui du message et de la pastille (vérifié par la fonction d'écriture) |
| `source` | `text` | `llm` ou `manual` |
| `applied` | `boolean` | vrai : posée ; faux : **retirée à la main** |
| `set_by` | `uuid` | FK `profiles`, nul pour `llm` |
| `set_at` | `timestamptz` | |

PK `(message_id, label_id)`. `CHECK (applied or source = 'manual')` : seule la main retire. **Une ligne `manual`
est un choix que la réévaluation ne touche jamais**, qu'il pose (`applied`) ou retire (`not applied`) — c'est ainsi que
« la main prime » se tient en base, sans mémoire à côté.

**`public.mail_label_evaluations`** — l'état d'évaluation d'un message, et la file :

| Colonne | Type | Contrainte |
|---|---|---|
| `message_id` | `uuid` | PK, FK `mail_messages`, `on delete cascade` |
| `workspace_id` | `uuid` | |
| `state` | `text` | `pending`, `done`, `failed` |
| `priority` | `smallint` | `0` : un mail neuf ou une demande ; `1` : le rattrapage |
| `requested_at` | `timestamptz` | |
| `attempts` | `smallint` | essais depuis la dernière demande |
| `next_attempt_at` | `timestamptz` | dû à partir de |
| `leased_until` | `timestamptz` | réservé par une passe jusqu'à |
| `last_error` | `text` | `delai_depasse`, `serveur_injoignable`, `cle_refusee`, `reponse_invalide` ; nul sinon |
| `evaluated_at` | `timestamptz` | la dernière évaluation réussie |

### 31.3 Qui lit, qui écrit

| Geste | Qui | Où la règle est tenue |
|---|---|---|
| Lire les pastilles de l'espace | tout membre de l'espace | politique `SELECT` de `mail_labels` (`app.is_workspace_member`) |
| Créer, modifier, archiver, désarchiver une pastille | administrateur de l'espace | politiques `INSERT` / `UPDATE` (`app.is_workspace_admin`, `USING` et `WITH CHECK`) |
| Lire les pastilles d'un message et son état d'évaluation | qui voit le message | politiques `SELECT` (`app.peut_voir_message(message_id)`) |
| Poser ou retirer à la main | qui voit le message **et édite l'espace** (administrateur, business developer) | `public.set_message_label`, `SECURITY DEFINER` (§31.4) |
| Demander une réévaluation | idem | `public.request_label_evaluation`, `SECURITY DEFINER` (§31.4) |
| Prendre et clore une évaluation | la clé de service seule | `claim_label_evaluations`, `record_label_evaluation` (§31.5) |

Aucun privilège d'écriture directe sur `mail_message_labels` ni `mail_label_evaluations` n'est accordé à
`authenticated` : tout passe par les fonctions. Une lectrice voit les pastilles et les commandes grisées, avec leur motif
(décision 926 ; `docs/DESIGN_SYSTEM.md` §5.59).

### 31.4 Les gestes d'une personne

- **`public.set_message_label(p_message_id uuid, p_label_id uuid, p_applied boolean) returns void`** — pose
  (`p_applied`) ou retire une pastille, **toujours comme un choix manuel** : la ligne devient `source = 'manual'`,
  `applied = p_applied`, `set_by = auth.uid()`. Refus nommés : `message_not_found` (le message n'existe pas ou n'est pas
  vu : un seul code, rien n'est divulgué), `forbidden` (l'appelant n'édite pas l'espace), `label_not_found` (pastille
  absente ou d'un autre espace), `label_archived` (une pastille archivée ne se pose plus ; la **retirer** reste permis,
  pour qu'un mail se débarrasse d'une pastille d'avant). Un message envoyé se pastille à la main comme un reçu : seule
  l'évaluation automatique les écarte.
- **`public.request_label_evaluation(p_message_id uuid) returns void`** — le bouton « Réévaluer les pastilles » : la
  ligne d'évaluation repasse `pending`, `priority = 0`, `attempts = 0`, `next_attempt_at = now()`, `last_error` effacé.
  Refus : `message_not_found`, `forbidden`, `outbound_message` (un mail envoyé n'est pas évalué). Une demande sur un
  message déjà en attente le remonte en tête sans le dupliquer.

### 31.5 La file et la passe d'évaluation — « la base décide, la fonction évalue, `pg_cron` cadence »

Le patron des webhooks (`docs/DAT.md` §3.7 quinquies), repris parce que la fonction `ia` vit dans sa requête
(`docs/SPEC-ia.md` §11.1) : une tâche de fond n'y survit pas, une passe bornée si.

- **L'entrée dans la file** : un déclencheur `AFTER INSERT` sur `mail_messages` inscrit chaque message `inbound` en
  `pending`, `priority = 0`. **À la migration**, tous les messages `inbound` existants, hors corbeille, sont inscrits en
  `pending`, `priority = 1`, les plus récents d'abord (décision 923 : tous les mails existants). Un mail neuf passe donc
  toujours devant le rattrapage.
- **La cadence** : `pg_cron` appelle chaque minute, par `pg_net`, sur le réseau interne, la route `POST
  /ia/pastilles/evaluer` de la fonction `ia` — **seulement si une évaluation est due**. L'appel porte un secret tiré au
  hasard dans Vault, que la fonction fait vérifier par `public.verify_label_dispatch(p_secret text)` ; sans lui, `401`.
- **La passe** : la fonction prend **une** évaluation due à la fois par `public.claim_label_evaluations(p_limit int)`
  (verrou `for update skip locked`, ordre `priority`, puis `requested_at`, réservation de 5 minutes, essai compté), qui
  rend le message — objet, expéditeur, `body_text`, `body_html` borné — et les pastilles **actives** de son espace ; elle
  l'évalue (`docs/SPEC-ia.md` §15), le clôt par `public.record_label_evaluation`, et recommence **tant que sa passe n'a
  pas dépassé 100 s** — sous la borne de 150 s du worker `ia`. Deux passes ne prennent jamais le même message.
- **La clôture** — `public.record_label_evaluation(p_message_id uuid, p_label_ids uuid[], p_error text)`, clé de service :
  - **réussite** (`p_error` nul) : les lignes `source = 'llm'` du message sont **remplacées** par les pastilles rendues,
    **restreintes** aux pastilles actives de l'espace du message et **sans ligne `manual`** pour ce couple ; l'état passe
    `done`, `evaluated_at = now()`. Une évaluation qui ne rend **aucune** pastille est une réussite : le mail n'en porte
    pas ;
  - **échec** : `attempts + 1`, `last_error`, et le prochain essai après 1 min, 5 min, 30 min, puis 2 h ; **au cinquième
    échec**, l'état passe `failed` et le message attend le bouton. Une passe interrompue laisse sa réservation expirer :
    le message est repris à la passe suivante.
- **Le mode dégradé** : clé absente ou serveur injoignable (`docs/SPEC-ia.md` §15.4) — la passe ne prend rien quand
  l'assistant se déclare indisponible ; les messages restent `pending`, **tous les gestes manuels restent entiers**, et
  l'écran dit « Pastilles en attente d'évaluation ».
- **Le débit**, mesuré à l'écriture du code et consigné : une évaluation courte prend quelques secondes au modèle ; une
  passe d'une minute en traite donc une dizaine à une vingtaine. Le rattrapage de tous les mails existants peut durer des
  heures, et c'est assumé (décision 923).
- **La mémoire de la cellule** (8 Go) : **aucun modèle n'y est chargé** — le serveur Ollama est celui de LeLabs
  (`docs/SPEC-ia.md` §3). La passe coûte un worker de la fonction `ia` par minute et des requêtes HTTP.
- **En développement**, la cadence est la même ; un réglage de la base posé par le seed de développement seul fait porter
  à l'appel de `pg_cron` l'en-tête `x-ia-simulateur: pastilles`, que la fonction ne suit que si `IA_SIMULATEUR_HOST` lui
  est remise (`docs/SPEC-ia.md` §11.6) : la pile de développement évalue de façon déterministe, sans le serveur réel. En
  production, ni le réglage ni la variable n'existent.

### 31.6 Les pastilles par défaut

La migration pose dans **chaque espace existant**, et un déclencheur `AFTER INSERT` sur `workspaces` dans **chaque espace
créé**, neuf pastilles actives, avec un descriptif écrit pour le modèle (décision 883) : « Spam », « Lead », « Devis /
commande », « Facture / paiement », « Support client », « Partenariat », « Recrutement », « Newsletter », « Administratif ».
Leurs descriptifs et leurs couleurs sont fixés dans la migration et dans `docs/SCHEMA.md` ; les administrateurs les
modifient comme les autres.

### 31.7 L'écran

L'apparence : `docs/DESIGN_SYSTEM.md` §5.103.

- **Réglages ▸ Pastilles des mails** : la liste des pastilles — nom, couleur, descriptif —, « Nouvelle pastille »,
  « Modifier », « Archiver » avec confirmation, « Désarchiver » sans confirmation, la case « Afficher les archivées ».
  L'écran est lisible par tout membre ; ses commandes sont éteintes avec leur motif pour qui n'administre pas l'espace.
- **Dans la liste des mails** : les pastilles **posées** du fil — celles de son dernier message —, et un filtre par
  pastille dans l'en-tête de la liste, porté par l'adresse (clé `pastille`). Le filtre montre les fils dont un message
  porte la pastille, posée ; il se combine avec le dossier choisi.
- **Dans le message ouvert** : ses pastilles posées, avec leur origine (« posée par l'IA », « posée à la main ») ;
  l'état d'évaluation quand il n'est pas `done` ; « Réévaluer les pastilles » dans la rangée de commandes, à côté du
  sommeil et de « Marquer comme non lu » ; et « Pastilles », qui ouvre dans le flux la liste des pastilles actives à
  cocher ou décocher — chaque case appelle `set_message_label`.
- **Une pastille archivée** reste affichée sur les mails qui la portent, avec la mention « archivée » ; elle n'est plus
  proposée à la pose, et le modèle ne la reçoit plus.

### 31.8 Le connecteur

**Oui, famille `messagerie`, cases existantes** (décisions 883, 923 et 924) : lire les pastilles de l'espace, lire les
pastilles et le contenu d'un mail, poser et retirer une pastille — comme un choix manuel. **L'assistant connecté juge
lui-même** ; aucun outil ne demande une réévaluation au LLM du CRM. Les outils : `docs/SPEC-mcp.md` §9.2 *duovicies*.

### 31.9 Le seed

- les neuf pastilles par défaut de l'espace du seed, posées par la migration ;
- **des messages déjà évalués par le vrai chemin** : le seed de développement appelle la route de la passe avec le secret
  et le scénario `pastilles` du simulateur ; aucune ligne `llm` n'est écrite à la main ;
- **un message corrigé à la main** : une pastille retirée et une posée, par `set_message_label` sous le jeton de
  l'administratrice ;
- **un message en échec** : une évaluation que le scénario `panne` du simulateur fait échouer cinq fois, le reste de la
  file la prenant ensuite ;
- une pastille archivée, encore portée par un message.

### 31.10 Preuves exigées

- **pgTAP** : la RLS des trois tables (lecture par qui voit le message, écriture des pastilles par l'administrateur,
  aucune écriture directe des deux autres) ; `set_message_label` et ses quatre refus, sous les trois profils du seed ; la
  main prime — une réévaluation ne touche ni une pose ni un retrait manuels ; `record_label_evaluation` restreint aux
  pastilles actives du même espace ; l'espacement des échecs et l'état `failed` au cinquième ; le verrou de
  `claim_label_evaluations` ; les défauts dans un espace créé ; l'unicité du nom, archivées comprises ; un message
  envoyé jamais inscrit.
- **Unitaires** : la construction de la demande au modèle (troncature à 2 000 caractères, texte tiré du HTML quand
  `body_text` manque, aucune pièce jointe) ; le contrôle de la sortie — une clé inconnue est rejetée et comptée, un JSON
  hors schéma est `reponse_invalide`, les doublons tombent ; la passe bornée à 100 s ; le journal sans contenu ; l'écran
  (pastilles, filtre, cases, bouton, états, commandes éteintes).
- **API** (jetons réels) : poser, retirer, réévaluer sous l'administratrice et le business developer ; la lectrice
  refusée ; un autre espace refusé ; la passe entière contre le simulateur, puis contre le vrai modèle quand il est
  joignable (`CLAUDE.md` §15).
- **E2E** souris et clavier : les réglages (créer, modifier, archiver, désarchiver, le refus de doublon) ; les pastilles
  dans la liste et le filtre ; « Réévaluer » ; poser et retirer à la main ; la lectrice ; quatre paliers ; captures.
- **Connecteur** : pytest unitaires et intégration ; `verify-mcp.sh`.

### 31.11 Tranches

Chaque tranche est poussée une fois vérifiée.

| Tranche | Contenu |
|---|---|
| **T1** | Migration : les trois tables, la RLS, `set_message_label`, `request_label_evaluation`, `claim_label_evaluations`, `record_label_evaluation`, les défauts et leur déclencheur, le déclencheur d'entrée dans la file et le rattrapage ; pgTAP ; `docs/SCHEMA.md` ; contrat de déploiement — *faite le 2026-11-11, migration `0183`* |
| **T2** | L'évaluation : la route `POST /ia/pastilles/evaluer` de la fonction `ia`, le scénario `pastilles` du simulateur, `verify_label_dispatch` et la cadence `pg_cron` (seconde migration) ; unitaires ; preuve d'intégration contre le simulateur et le vrai modèle ; le seed — *faite le 2026-11-11, migration `0184` ; la preuve contre le vrai modèle n'a pas pu être jouée : le serveur de LeLabs refuse la clé depuis l'origine actuelle du poste (`cle_refusee`)* |
| **T3** | L'écran Réglages ▸ Pastilles des mails ; unitaires ; API ; E2E ; captures |
| **T4** | L'inbox : les pastilles dans la liste, le filtre, le message ouvert, « Pastilles » et « Réévaluer les pastilles » ; unitaires ; E2E ; captures |
| **T5** | Le connecteur : trois outils ; pytest ; `verify-mcp.sh` |
| **T6** | Le manuel : l'inbox et les réglages de la messagerie, avec leurs images |
| **T7** | Production, par la session de livraison, sur instruction du responsable : deux migrations, la fonction `ia`, la webapp, l'image `mcp` ; le rattrapage observé |
