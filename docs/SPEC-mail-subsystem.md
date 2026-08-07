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

## 10. Points ouverts

1. **Bibliothèque IMAP Python** non arrêtée : choix à faire au chunk correspondant, après examen
   de la maintenance, de la licence et du support d'IDLE.
2. **OAuth2 Gmail / Microsoft 365** hors périmètre v1 : les organisations qui imposent OAuth ne
   pourront pas connecter leur boîte.
3. **Empreinte de repli** pour les messages sans `Message-ID` : à valider par le responsable.
4. **Politique anti-usurpation** : l'adresse d'une card est publique de fait. Faut-il restreindre
   l'ingestion aux expéditeurs connus, ou tout accepter en signalant les expéditeurs inconnus ?
   Comportement retenu par défaut : tout accepter, ne rien déclencher automatiquement.

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
elle-même. Le point ouvert n° 1 du §10 — le choix d'une bibliothèque IMAP pour `mail-sync` — n'est
donc **pas** tranché ici : il reste ouvert pour `CRM-051`.

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
