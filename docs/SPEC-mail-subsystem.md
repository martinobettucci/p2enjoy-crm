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

*Prérequis à vérifier avant implémentation* : disponibilité de `supabase_vault` dans l'image
PostgreSQL retenue. Repli documenté : `pgcrypto` avec clé dédiée fournie par l'environnement.

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
