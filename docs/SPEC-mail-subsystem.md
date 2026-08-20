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

**Reste non livré** : l'écran qui MONTRE la suggestion (l'inbox globale, `CRM-057`). La règle vit en
base et se prouve en base (pgTAP `0044`, API `classement.spec.ts`, harnais
`verify-mail-classement.sh`) ; la preuve visible attend l'écran.

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

### 18.4 Le HTML d'un expéditeur ne s'affiche jamais

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
- **Aucun rendu HTML** (§18.4), et l'absence est figée.
- **Aucune notion de lu / non lu** : rien ne la porte en base, et l'inventer côté client donnerait
  un état faux dès la seconde session. Elle appartient à une unité qui la persistera.
- **Aucun rôle de tri** (§18.1) : un membre ordinaire ne voit aucun non classé.
- **Aucune suppression de message** depuis l'écran : la purge relève d'une unité RGPD.

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
| `identity_not_available` | `42501` | l'identité n'existe pas, n'est pas celle de l'appelant, ou n'est pas l'identité de service d'un workspace dont il est administrateur. **Mesuré** : `P0002`, d'abord retenu, est traduit par PostgREST en **500** — un refus d'autorisation ne doit pas se présenter comme une panne de serveur |
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
| Dernière relève réussie | `last_sync_at`, écrit par la relève elle-même |
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
