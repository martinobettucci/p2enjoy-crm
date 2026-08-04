# Registre des contradictions et points ouverts

Consigne les contradictions, références manquantes et hypothèses non vérifiées relevées pendant
la conception ou l'implémentation. **Rien n'est résolu implicitement** : tant qu'un point est
ouvert, le comportement reste inchangé et l'arbitrage du responsable est sollicité lorsque la
correction dépasse la tâche autorisée.

Une entrée est close lorsque la décision est prise, consignée dans `docs/JOURNAL.md`, et
répercutée dans les documents concernés.

---

## Ouverts

### INC-002 — Messages entrants sans `Message-ID`

**Nature :** cas limite non tranché.
**Relevé le :** 2026-08-03.

Le dédoublonnage repose sur `(workspace_id, rfc822_message_id)`. Certains expéditeurs non
conformes n'émettent pas d'en-tête `Message-ID`, ce qui rendrait la clé nulle et le dédoublonnage
inopérant — un même message serait alors inséré autant de fois qu'il existe de boîtes le
recevant.

**Proposition :** empreinte de repli `sha256(from_addr + date + subject + taille du corps)`,
préfixée pour la distinguer d'un identifiant véritable.

**Risque résiduel :** deux messages réellement distincts et rigoureusement identiques sur ces
quatre critères seraient fusionnés. Jugé improbable, mais non nul.

**Comportement en attendant :** proposition retenue par défaut dans
`docs/SPEC-mail-subsystem.md` §4.2, en attente de validation du responsable.

---

### INC-003 — Transition « Réalisation → Perdu » non déclarée

**Nature :** règle métier à confirmer.
**Relevé le :** 2026-08-03.

Le workflow par défaut déclare un passage vers « Perdu » depuis Prospection, Relance, Négociation
et Signature, mais **pas** depuis Réalisation. Une affaire signée puis abandonnée en cours de
réalisation n'a donc aucun chemin vers « Perdu ».

**Deux lectures possibles :** soit c'est voulu — un projet signé qui échoue relève d'un autre
traitement (avenant, litige) —, soit c'est un oubli.

**Comportement en attendant :** transition non déclarée. Le workflow étant une donnée, un
administrateur peut l'ajouter sans modification de code.

---

### INC-004 — Politique face aux expéditeurs inconnus

**Nature :** décision de sécurité à confirmer.
**Relevé le :** 2026-08-03.

L'adresse email d'une card circule dans les messages : elle est donc publique de fait. N'importe
qui la connaissant peut déposer du contenu dans une card.

**Comportement retenu par défaut :** tout accepter, signaler les expéditeurs inconnus, et surtout
**ne rien déclencher automatiquement** — un message reçu n'entraîne aucune transition, aucune
autorisation, aucune action. Le risque se limite donc à du bruit et à du stockage.

**Alternative non retenue :** restreindre l'ingestion aux expéditeurs connus, au prix de perdre
les premiers contacts entrants, qui sont précisément la matière première d'un CRM de prospection.

**En attente :** confirmation du responsable. Mesures de bornage déjà spécifiées : taille
maximale des pièces jointes, analyse antivirale, aucune exécution de contenu.

---

### INC-005 — Écart assumé : copie de workflow contre surcharge

**Nature :** écart documenté à une convention générale.
**Relevé le :** 2026-08-03.

`CLAUDE.md` §4 demande que « tout existe par défaut au niveau général, puis les contextes
spécialisés ne définissent que leurs différences ». Le responsable a explicitement demandé de
**copier** un workflow global dans un track pour l'y modifier, ce qui produit une duplication et
non une surcharge.

**Résolution appliquée :** l'instruction explicite du responsable prime (`CLAUDE.md` §26,
priorité 2 sur priorité 8). L'écart est compensé par la traçabilité de l'origine
(`derived_from_workflow_id`, `derived_at`) et par un signalement de divergence dans l'interface.

**Statut :** ouvert pour information, aucune action attendue. Sera clos si le responsable
confirme.

---

### INC-006 — Pile de référence `../starter.2025.12/` introuvable dans l'environnement d'exécution

**Nature :** référence absente, contournée sans arbitrage.
**Relevé le :** 2026-08-03, pendant `CRM-001`.

`docs/BACKLOG.md` décrit `CRM-001` comme la « copie de la pile éprouvée
(`../starter.2025.12/supabase/docker/`) », et `docs/JOURNAL.md` s'appuie sur son inspection. Or
la routine cloud travaille sur un conteneur où **seul** le dépôt `p2enjoy-crm` est cloné : le
répertoire voisin n'existe pas et n'est pas accessible.

```
$ ls -la /home/user/
drwxr-xr-x 3 root root 4096 .
drwxr-xr-x 5 root root 4096 ..
drwxr-xr-x 4 root root 4096 p2enjoy-crm
```

**Comportement retenu :** la pile a été assemblée à partir de la distribution self-hosted
**officielle** de Supabase (`supabase/supabase`, répertoire `docker/`), avec versions épinglées,
et non à partir de la pile voisine. Les fichiers d'initialisation repris portent la mention de
leur origine.

**Risque résiduel :** si `../starter.2025.12/` contenait des adaptations maison (réglages
PostgreSQL, correctifs, versions volontairement figées à un autre niveau), elles sont **absentes**
de la pile livrée, sans que la routine puisse le constater.

**Arbitrage attendu du responsable :** confirmer que la pile officielle épinglée convient, ou
fournir les écarts de `starter.2025.12` à reporter. Tant que ce point est ouvert, aucune
divergence n'est supposée ni inventée.

---

### INC-007 — `supabase/functions/` référencé sans composant correspondant

**Nature :** référence documentaire sans contrepartie architecturale.
**Relevé le :** 2026-08-03, pendant `CRM-001`.

`README.md` §10 annonce un répertoire `supabase/functions/` décrit comme « Edge functions Deno ».
Or :

- `docs/DAT.md` §3 ne liste **aucun** composant de fonctions edge ;
- `docs/DAT.md` §6 n'expose **aucune** interface de ce type ;
- **aucune** unité de `docs/BACKLOG.md` ne prévoit d'en écrire.

**Comportement en attendant :** le service `edge-runtime` n'est **pas** déployé et la route
`/functions/v1/` n'est **pas** déclarée dans la passerelle. Ni le `README.md` ni le `DAT.md` ne
sont modifiés pour faire disparaître la contradiction : elle est consignée ici.

**Arbitrage attendu du responsable :** soit les fonctions edge entrent au périmètre et reçoivent
une unité de backlog, soit la mention est retirée du `README.md` §10.

---

### INC-008 — Commandes `npm` annoncées sans `package.json`, et `npm run stop` attribué à `CRM-002`

**Nature :** contradiction entre la documentation et le périmètre des unités.
**Relevé le :** 2026-08-03, pendant `CRM-002`.

`README.md` annonçait `npm install` en §4 et `npm run stop` en §5, cette dernière marquée « à
venir (`CRM-002`) » ; `docs/DAT.md` §13 la reprenait. Or :

- le dépôt ne contient **aucun** `package.json`, et aucune unité du backlog ne dit lequel
  l'introduit — `CRM-006` (types générés) et `CRM-007` (webapp) le supposent tous deux ;
- `CRM-002` est décrite dans `docs/BACKLOG.md` comme livrant `runDev.sh`, `runProd.sh`,
  `resetMe.sh` et `.env.example`. Rien n'y mentionne d'alias `npm`, et en créer un aurait exigé
  d'introduire un `package.json` sans unité pour le porter.

**Comportement retenu :** `CRM-002` livre l'arrêt propre là où il a du sens, sous forme d'options
des scripts qu'elle produit — `./runDev.sh --stop` et `./runProd.sh --stop`. `README.md` §5 et
`docs/DAT.md` §13 décrivent désormais ces commandes réellement exécutables, et la ligne
`npm run stop` en a été retirée plutôt que laissée à décrire une commande inexistante.

**Ce qui n'est pas tranché, et n'a pas été tranché ici :** quelle unité introduit `package.json`,
et si le projet veut par-dessus les scripts une façade `npm` — `npm run stop`, `npm run dev` —
qui les appelle. Les deux questions relèvent d'un arbitrage, pas d'un choix d'implémentation.

**Arbitrage attendu du responsable :** rattacher `package.json` à une unité explicite, et dire si
les alias `npm` doivent exister en doublon des scripts.

**Mise à jour du 2026-08-03, pendant `CRM-006`.** La première question s'est tranchée d'elle-même :
la Definition of Done de `CRM-006` nomme `npm run types:generate`, l'unité ne peut donc pas être
livrée sans `package.json`. Il est introduit par elle (`docs/JOURNAL.md`, décision 38), **réduit
aux seules commandes que cette DoD exige** — `types:generate`, `types:check`, `typecheck`.

**La seconde question reste entière, et n'a pas été préemptée :** aucun alias `npm` des scripts
existants n'a été ajouté. `npm run dev`, `npm run stop` et `npm run db:seed` — ce dernier annoncé
par `docs/DAT.md` §13 — n'existent toujours pas. L'entrée reste **ouverte**.

---

### INC-009 — La Definition of Done de `CRM-002` dépend d'une unité planifiée bien après elle

**Nature :** contradiction d'ordonnancement entre `docs/BACKLOG.md` et `docs/MASTER_PLAN.md`.
**Relevé le :** 2026-08-03, pendant `CRM-002`.

La DoD de `CRM-002` exige que « `resetMe.sh` recrée la base **et le seed** ». Or le seed est
l'objet de `CRM-005`, que `docs/MASTER_PLAN.md` §2.c place **après** `CRM-010` → `CRM-014`.
`CRM-002` ne peut donc pas satisfaire sa propre DoD au moment où le plan lui demande d'être
livrée, quelle que soit la qualité de son implémentation.

**Comportement retenu :** `resetMe.sh` appelle `supabase/seed/apply-seed.sh` s'il est exécutable,
et avertit explicitement en nommant `CRM-005` sinon. L'unité reste `[~]`, avec cette seule preuve
manquante nommée noir sur blanc. Rien n'est simulé : aucun script de seed factice n'a été créé
pour rendre la preuve verte, ce qui aurait été une fausse déclaration de complétion.

**Ce qu'il ne faut pas en conclure :** que `CRM-002` est à reprendre. Elle est terminée pour tout
ce qui dépend d'elle ; la preuve restante ne s'obtiendra qu'au moment où `CRM-005` existera.

**Arbitrage attendu du responsable :** soit retirer la mention du seed de la DoD de `CRM-002` et
la rattacher à `CRM-005` — qui vérifierait alors que `resetMe.sh` le rejoue —, soit avancer
`CRM-005` avant `CRM-002` dans `docs/MASTER_PLAN.md`. Tant que le point est ouvert, l'unité reste
`[~]` et la limite est nommée.

---

### INC-010 — `track_members` et `channel_members` sont créées avant les tables qu'elles référencent

**Nature :** contradiction d'ordonnancement entre `docs/BACKLOG.md` et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-03, pendant `CRM-003`.

`CRM-003` doit créer `track_members` et `channel_members`. Or `tracks` est livrée par `CRM-020` et
`channels` par `CRM-021`, toutes deux placées dans le chunk 3, donc **après**. Les colonnes
`track_id` et `channel_id` ne peuvent pas porter de clé étrangère au moment où le plan demande
ces tables.

Ce n'est pas un oubli de rédaction : `docs/SCHEMA.md` §1 déclare explicitement les clés étrangères
de `workspace_members` et **n'en déclare aucune** pour ces deux tables. La documentation est donc
cohérente avec elle-même, mais laisse une intégrité référentielle non garantie : rien n'empêche
aujourd'hui d'insérer un droit fin sur un `track_id` qui ne désigne aucun track, et rien ne
supprimera ce droit lorsque le track sera supprimé.

**Comportement retenu :** les tables sont créées **sans** clé étrangère sur `track_id` et
`channel_id`, avec un commentaire de table qui le dit et nomme cette entrée. Aucune table `tracks`
ou `channels` n'est créée par anticipation pour faire disparaître la contradiction : cela
déborderait du périmètre de `CRM-003` et préempterait `CRM-020`. La suite pgTAP **constate**
l'absence de la contrainte, de sorte qu'elle devienne rouge le jour où elle sera posée sans que la
suite soit mise à jour.

**Risque résiduel :** entre `CRM-003` et `CRM-020`, un droit fin peut désigner un track
inexistant. Le risque est borné : aucune interface ni aucun seed n'écrit encore dans ces tables.

**Arbitrage attendu du responsable :** désigner l'unité qui pose ces deux clés étrangères —
`CRM-020` et `CRM-021` semblent les candidats naturels — et l'inscrire dans leur Definition of
Done, ou décider que ces colonnes restent volontairement sans contrainte.

---

### INC-011 — `track_members` et `channel_members` sans `workspace_id`, contre la convention générale

**Nature :** contradiction interne à `docs/SCHEMA.md`.
**Relevé le :** 2026-08-03, pendant `CRM-003`.

Les conventions générales de `docs/SCHEMA.md` posent que « toute table métier porte
`workspace_id`, y compris lorsqu'il serait déductible par jointure : les politiques RLS restent
ainsi simples et indexables ». Or la définition de `track_members` et `channel_members`, au §1 du
même document, ne comporte pas cette colonne.

Les deux lectures se défendent. Sans `workspace_id`, une politique RLS sur ces tables devra
joindre `tracks` ou `channels` pour retrouver le workspace, ce que la convention cherche
précisément à éviter. Avec, la colonne devient une donnée dénormalisée de plus à maintenir
cohérente, sur une table dont chaque ligne est déjà rattachée à un objet cloisonné.

**Comportement retenu :** la définition **spécifique** du §1 l'emporte sur la convention
générale, et les tables sont créées sans `workspace_id`. Ce choix est réversible par une migration
d'ajout de colonne ; l'inverse — retirer une colonne déjà exploitée par des politiques — le serait
beaucoup moins.

**Arbitrage attendu du responsable :** trancher avant `CRM-012`, qui écrira les politiques de
résolution des droits fins et fixera de fait la forme des requêtes.

---

### INC-012 — Le motif principal de la décision 8 est démenti par la mesure

**Nature :** motif de décision invalidé par un fait vérifié.
**Relevé le :** 2026-08-03, en clôturant `CRM-004`.

La décision 8 (`docs/JOURNAL.md`) place l'ordonnancement des relances, séquences, digests et
purges dans `mail-sync` plutôt que dans `pg_cron`. Elle invoquait deux motifs :

1. « sa présence dans l'image retenue n'est pas vérifiée » ;
2. l'ordonnancement applicatif est testable par pytest sans manipuler la base.

La mesure de `CRM-004` **dément le premier** : `pg_cron` 1.6.4 est présent dans
`supabase/postgres:17.6.1.136`, préchargé par le serveur, installable, et il ordonnance
réellement une tâche. Le second motif tient toujours.

**Comportement en attendant :** le **résultat** de la décision 8 est conservé — l'ordonnanceur
reste applicatif — parce que le motif de testabilité suffit à le justifier seul. Seul l'**énoncé**
a été corrigé, dans `docs/DAT.md` §3.3 et §12, pour ne plus invoquer un fait démenti. Aucun code
d'ordonnancement n'existe encore : rien n'est donc à défaire à ce stade.

**Pourquoi ce n'est pas résolu ici :** rouvrir le choix d'architecture dépasse le périmètre de
`CRM-004`, dont l'objet était de mesurer et de trancher le chiffrement des secrets. Le point est
consigné plutôt qu'arbitré implicitement.

**Arbitrage attendu du responsable :** confirmer l'ordonnanceur applicatif, ou demander la
réévaluation de `pg_cron` maintenant que sa disponibilité est acquise. À trancher avant `CRM-062`
(relances automatiques), première unité qui consommera réellement un ordonnanceur.

---

### INC-013 — Quatre des six fonctions d'autorisation dépendent de tables livrées deux chunks plus tard

**Nature :** contradiction d'ordonnancement entre `docs/SPEC-permissions-rls.md` §3,
`docs/BACKLOG.md` et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-03, pendant `CRM-010`.

`CRM-010` doit livrer six fonctions. Quatre d'entre elles — `app.can_read_track`,
`app.can_read_channel`, `app.can_write_channel`, `app.can_read_card` — reçoivent l'identifiant
d'un track, d'un channel ou d'une card et doivent remonter jusqu'au workspace pour connaître le
rôle de l'appelant. Ce chemin passe nécessairement par `tracks`, `channels` et `cards`, livrées
par `CRM-020`, `CRM-021` et `CRM-040`, toutes placées dans le **chunk 3**, donc après.

Ce n'est pas une difficulté d'écriture contournable : sans `tracks`, rien ne relie un
`track_id` à un `workspace_id`. Le langage PL/pgSQL accepterait une fonction référençant une table
absente — elle échouerait au premier appel, et aucune preuve ne pourrait être produite d'ici
`CRM-020`. C'est exactement le même motif qu'INC-010, un cran plus loin : `CRM-003` avait dû se
passer des clés étrangères, `CRM-010` doit se passer des jointures.

**Comportement retenu :** `CRM-010` livre ce qui est démontrable aujourd'hui, et **rien de plus** :

- `app.resolve_access(ws_role, track_access, channel_access)` — l'**algorithme** de résolution
  du §2.2, isolé de toute table, donc éprouvé de façon exhaustive sur ses 64 combinaisons
  d'entrées. C'est la seule partie qui porte une règle métier ; les quatre fonctions différées
  n'auront plus qu'à lire leur ligne et l'appeler ;
- `app.workspace_role`, `app.is_workspace_member`, `app.is_workspace_admin` — la résolution du
  rôle de workspace, qui ne dépend que de `workspace_members`.

Aucune table n'est créée par anticipation pour faire disparaître la contradiction : cela
préempterait trois unités. La suite pgTAP **constate** l'absence des quatre fonctions
(`hasnt_function`), de sorte qu'elle devienne rouge le jour où elles seront écrites sans que ces
preuves soient étendues.

**Risque résiduel :** aucun à ce stade — aucune politique ne les appelle, puisque `CRM-010` n'en
pose aucune. Le risque naîtrait si `CRM-012` écrivait les politiques des tracks et des channels en
supposant ces fonctions disponibles.

**Conséquence sur l'état de l'unité :** `CRM-010` reste `[~]`. Ce n'est pas un défaut de
réalisation mais une dépendance non satisfiable dans l'ordre actuel du plan.

**Arbitrage attendu du responsable.** Trois options, à trancher **avant `CRM-012`**, qui écrira
les politiques et figera la forme des requêtes :

1. rattacher chacune des quatre fonctions à l'unité qui livre sa table — `can_read_track` à
   `CRM-020`, `can_read_channel` et `can_write_channel` à `CRM-021`, `can_read_card` à `CRM-040` —
   et l'inscrire dans leur Definition of Done ;
2. déplacer `CRM-010` après `CRM-021` dans `docs/MASTER_PLAN.md` §2, au prix de livrer `tracks` et
   `channels` avant le modèle d'autorisation, ce que le plan cherche précisément à éviter ;
3. créer une unité distincte, par exemple `CRM-010b`, placée après `CRM-040`.

Tant que le point est ouvert, l'unité reste `[~]` et la limite est nommée.

---

### INC-014 — Aucune unité ne nomme explicitement l'écriture des politiques RLS des tables d'identité

**Nature :** référence manquante dans le découpage du backlog.
**Relevé le :** 2026-08-03, pendant `CRM-010`.

`docs/SPEC-permissions-rls.md` §4 spécifie les politiques de `profiles`, `workspaces` et
`workspace_members` — lecture par les membres, écriture réservée à l'administrateur, et la règle
« un administrateur ne peut pas se retirer son propre rôle s'il est le dernier ». Or aucune unité
du backlog ne les porte nommément :

- `CRM-010` livre les **fonctions**, pas les politiques ;
- `CRM-012` est intitulée « Droits fins par track et channel » et sa Definition of Done vise les
  preuves n° 3, 4, 7 et 11, qui concernent les cards et les comptes mail ;
- `CRM-013` traite des **colonnes** protégées, dont aucune de ces trois tables.

Le commentaire de `supabase/tests/0001_identite_et_cloisonnement.test.sql` annonce d'ailleurs ces
politiques « jusqu'à `CRM-010` », ce que `CRM-010` ne fait pas — la mention a été corrigée en
`CRM-012` dans le même changement, faute de meilleur candidat, mais **le rattachement lui-même
n'est pas tranché**.

**Comportement en attendant :** les trois tables restent en refus par défaut, comme les a laissées
`CRM-003`. Aucune politique n'est écrite hors d'une unité qui la porte.

**Conséquence pratique :** la preuve n° 10 du §7 — « dernier administrateur tente de se retirer
son rôle » — n'est actuellement attribuée à aucune unité.

**Arbitrage attendu du responsable :** rattacher explicitement les politiques des tables
d'identité, ainsi que la preuve n° 10, à `CRM-012` ou à une unité dédiée.

---

### INC-015 — Le parcours d'invitation depuis le produit n'a pas de composant pour le porter

**Nature :** référence manquante dans l'architecture, décision non prise.
**Relevé le :** 2026-08-03, pendant `CRM-011`.

`docs/BACKLOG.md` décrit `CRM-011` comme livrant « l'invitation par un administrateur », et
`docs/manual.md` rattache le chapitre 17, « Inviter et gérer les membres », à cette unité. Or
`POST /auth/v1/invite` exige un jeton portant `service_role` — mesuré : la clé anonyme est refusée
par `403 not_admin`. La webapp ne doit jamais détenir cette clé.

Il manque donc un composant serveur entre l'administrateur de workspace et GoTrue, et le projet
n'en possède aucun qui convienne :

- les fonctions edge ne sont **pas** au périmètre (INC-007, ouvert) ;
- `mail-sync` (`CRM-051`) n'existe pas encore, et vise la messagerie du produit, pas l'identité ;
- la webapp (`CRM-007`) est un client, sans partie serveur.

**Mesure faite pour éclairer l'arbitrage.** `pg_net` 0.20.3 est déjà installée dans la base et
préchargée, et la base joint réellement GoTrue (`net.http_get('http://auth:9999/health')` rend
`200`). Une fonction `SECURITY DEFINER` vérifiant `app.is_workspace_admin` puis appelant GoTrue par
`pg_net`, la clé de service rangée en Vault, est donc techniquement possible **aujourd'hui**.

**Ce qui n'est pas tranché, et n'a pas été tranché ici.** Cette voie suppose trois choix
d'architecture que `CRM-011` n'a pas mandat de prendre : une table d'invitations absente de
`docs/SCHEMA.md`, un appel sortant depuis la base absent de `docs/DAT.md` §3, et une clé de service
à provisionner en Vault. S'y ajoute une question de règle métier entière : ce que l'invitation
porte comme workspace et comme rôle, et à quel moment la ligne `workspace_members` est créée — à
l'émission de l'invitation, ou à son acceptation.

**Comportement retenu en attendant :** l'invitation est émise par un **opérateur** disposant de la
clé de service, hors interface. Aucune table, aucune fonction et aucun appel sortant n'est créé par
anticipation. `docs/SPEC-auth.md` §3.2 et §6 le disent explicitement plutôt que de laisser croire à
un parcours produit livré.

**Arbitrage attendu du responsable.** Trois options :

1. rattacher le parcours à `CRM-070` (administration des permissions fines), qui traite déjà de la
   gestion des membres, et livrer d'ici là l'invitation par opérateur ;
2. créer une unité dédiée, placée après `CRM-007`, portant la table d'invitations, la fonction
   `SECURITY DEFINER` et le provisionnement de la clé de service en Vault ;
3. décider que l'invitation reste définitivement une opération d'exploitation, et retirer le
   chapitre 17 de `docs/manual.md`.

Lié à INC-014 : les politiques RLS des tables d'identité ne sont toujours rattachées à aucune
unité, et le rattachement d'une éventuelle table d'invitations poserait la même question.

---

### INC-016 — Gabarits d'emails : chargement HTTP obligatoire et repli silencieux vers l'anglais

**Nature :** limite d'un composant tiers, contraire à une exigence générale.
**Relevé le :** 2026-08-03, pendant `CRM-011`.

Le produit est en français ; les emails transactionnels partent en **anglais**, avec les gabarits
par défaut de GoTrue.

**Mesure.** `supabase/gotrue:v2.189.0` ne sait charger un gabarit personnalisé que par **HTTP**. Un
chemin de fichier n'est pas reconnu : la valeur est concaténée à `SITE_URL`, ce que la
journalisation du service montre sans ambiguïté.

```
templatemailer: template type "invite":
Get "http://localhost:5173file///etc/gotrue/templates/invite.html": no such host
```

**Le point qui compte : l'email est tout de même parti**, avec le gabarit anglais par défaut. La
défaillance est donc **silencieuse du point de vue du destinataire**. Un email reçu ne prouve pas
que le gabarit configuré a été employé — toute preuve future portant sur les gabarits devra
vérifier le **contenu** de l'email, jamais sa seule présence.

**Pourquoi ce n'est pas résolu ici.** Servir les gabarits en HTTP demanderait soit un service
statique de plus dans les deux assemblages pour quatre fichiers, soit de les héberger dans la
webapp — qui n'existe pas (`CRM-007`) et dont l'origine n'est de toute façon pas joignable depuis
le réseau des conteneurs. Les deux débordent du périmètre de `CRM-011`.

**Constat supplémentaire, relevé lors de la vérification visuelle.** Inbucket signale sur chacun
des emails émis : « MIME problems detected — Plain Text from HTML: Message did not contain a
text/plain part ». Les gabarits par défaut de GoTrue produisent donc un message **HTML seul**,
sans variante texte. Deux conséquences, l'une pour le produit, l'autre pour les preuves : un
message sans partie texte est un signal négatif pour la délivrabilité et gêne les clients en mode
texte ; et la partie « texte » que lit `scripts/verify-auth.sh` est **reconstruite** par Inbucket
à partir du HTML, elle n'est pas émise par GoTrue. Captures :
`docs/captures/CRM-011/email-invitation-1280x800.jpg` et
`docs/captures/CRM-011/email-reinitialisation-1280x800.jpg`.

**Comportement en attendant :** gabarits par défaut conservés, limite nommée dans
`docs/SPEC-auth.md` §5.

**Arbitrage attendu du responsable :** rattacher les gabarits d'emails français à `CRM-007`, qui
introduira une origine HTTP servie, ou à `CRM-P09` (internationalisation, en attente d'arbitrage),
ou décider que les emails transactionnels restent en anglais.

---

### INC-017 — `README.md` §11 annonce encore comme non vérifié ce que `CRM-004` a mesuré

**Nature :** documentation en retard sur une décision déjà prise.
**Relevé le :** 2026-08-03, pendant `CRM-011`, en relisant `README.md`.

`README.md` §11 « Limites connues » porte toujours :

> **Disponibilité de `supabase_vault` et `pg_cron` non vérifiée** dans l'image PostgreSQL
> retenue. Un repli est documenté pour chacun (`pgcrypto` et ordonnanceur applicatif). Le point
> sera tranché avant tout code de messagerie.

Or `CRM-004` a mesuré les deux extensions dans l'image réellement épinglée, a clos INC-001 et a
retenu Vault (décision 23). Le `README.md` avait bien été mis à jour en §5, §7 et §12 par cette
unité, mais **pas** en §11.

**Pourquoi ce n'est pas corrigé ici.** La ligne appartient au périmètre de `CRM-004` et non à
celui de `CRM-011`. La modifier au passage mêlerait deux sujets dans un même commit, contre
`CLAUDE.md` §13. Ce n'est pas non plus une contradiction à arbitrer : la décision est prise et
documentée, seul son report dans ce paragraphe manque.

**Risque :** un lecteur du seul `README.md` peut croire la question ouverte et refaire le travail
de `CRM-004`.

**Action attendue :** retirer ou reformuler cette limite dans `README.md` §11, dans un changement
qui lui soit propre.

---

### INC-018 — L'API d'administration de GoTrue n'applique pas la politique de mot de passe

**Nature :** spécification démentie par la mesure.
**Relevé le :** 2026-08-03, pendant `CRM-005`, en mesurant le chemin de création des comptes du
seed.

`docs/SPEC-auth.md` §4 énonce la politique **sans réserve** : « `PASSWORD_MIN_LENGTH` vaut 12 [...]
Le refus est explicite : `HTTP 422`, code `weak_password`, avec la raison `length`. » `CRM-011` l'a
prouvée dans les deux sens — onze caractères refusés, douze acceptés — mais **sur le chemin
utilisateur uniquement**.

Mesure sur la pile de développement, `GOTRUE_PASSWORD_MIN_LENGTH=12` réellement appliqué au
conteneur `p2enjoy-auth` :

| Chemin | Mot de passe | Résultat mesuré |
|---|---|---|
| `PUT /auth/v1/user` | `onzecaracte` (11) | `422 weak_password` — « Password should be at least 12 characters. » |
| `POST /auth/v1/admin/users` | `court123` (8) | `200` — compte créé |

Le compte ainsi créé n'est pas un artefact inerte : la connexion par mot de passe avec ces huit
caractères rend `200` et un jeton d'accès valide. La politique encadre donc ce qu'un
**utilisateur** choisit, jamais ce qu'un **opérateur** impose.

**Portée réelle.** Aujourd'hui, seuls la clé de service et donc un opérateur atteignent ce chemin ;
le risque n'est pas une escalade depuis le produit, mais une **fausse assurance** : lire
`docs/SPEC-auth.md` §4 laisse croire qu'aucun compte faible ne peut exister dans la base, ce qui
est faux. Le jour où `CRM-011` obtiendra son écran d'invitation (INC-015), un administrateur de
workspace choisissant un mot de passe initial passerait par ce même chemin.

**Comportement retenu en attendant :** rien n'est modifié. `CRM-005` s'y conforme
**volontairement** — les mots de passe du seed font 16 caractères — et `scripts/verify-seed.sh`
**prouve** cette longueur au lieu de la supposer, précisément parce que l'API ne la garantit pas
(`docs/SPEC-seed.md` §3.5 et §7, preuve n° 7).

**Pourquoi ce n'est pas résolu ici :** la correction appartient à `CRM-011`, dont c'est la
spécification, et le choix n'est pas neutre. Trois options s'offrent, aucune évidente :

1. **documenter la réserve** dans `docs/SPEC-auth.md` §4 — la politique encadre le chemin
   utilisateur, pas le chemin d'administration — et s'en tenir là ;
2. **valider côté appelant** dans tout script ou service qui crée un compte par l'API
   d'administration, seed compris ;
3. **valider côté base**, par un `CHECK` ou un trigger sur `auth.users`, ce qui reviendrait à
   écrire dans un schéma dont GoTrue est l'autorité — écart notable de la ligne du projet.

**Arbitrage attendu du responsable :** trancher entre ces options avant que l'invitation ne
devienne un parcours produit (INC-015), moment où le chemin d'administration cessera d'être
réservé à un opérateur.

---

### INC-019 — Le bandeau d'état du `README.md` décrit un dépôt que trois unités ont dépassé

**Nature :** documentation en retard sur l'état réel.
**Relevé le :** 2026-08-03, pendant `CRM-005`, en mettant à jour le `README.md`.

Le bandeau « État d'avancement — lisez ceci en premier », en tête du `README.md`, porte encore :

> En revanche, **le produit n'existe pas encore** : aucune migration
> (`supabase/migrations/` est vide), aucune webapp, aucun service `mail-sync`.

Deux de ces trois affirmations sont fausses depuis `CRM-003` : `supabase/migrations/` contient
deux migrations appliquées et vérifiées, et le socle d'identité est en base. `CRM-005` y ajoute un
seed. Seules « aucune webapp » et « aucun service `mail-sync` » restent exactes.

C'est le même mode de défaillance qu'INC-017, à un autre endroit du même fichier : une unité met à
jour les sections qu'elle touche et laisse le paragraphe de synthèse en arrière.

**Pourquoi ce n'est pas corrigé ici.** Le bandeau relève de l'état global du dépôt, non du
périmètre de `CRM-005`. Le réécrire au passage mêlerait deux sujets dans un même commit, contre
`CLAUDE.md` §13 — c'est le raisonnement retenu pour INC-017, et il vaut ici à l'identique. Ce
n'est pas non plus une contradiction à arbitrer : aucune décision n'est en jeu, seulement une mise
à jour.

**Risque :** un lecteur qui s'arrête au bandeau — ce que le bandeau lui demande explicitement de
faire en premier — croit le dépôt vide de toute migration, et peut refaire le travail de `CRM-003`
ou douter de la validité des unités suivantes.

**Action attendue :** réécrire le bandeau à partir de l'état réel de `docs/BACKLOG.md`, dans un
changement qui lui soit propre, et le traiter désormais comme une section à revoir à chaque
livraison — au même titre que `CHANGELOG.md`.

**Mise à jour du 2026-08-03, pendant `CRM-006`.** La troisième affirmation devient ambiguë à son
tour : `webapp/` existe désormais, mais ne contient que les types générés et leurs assertions —
aucun écran, aucun composant, aucun build. « Aucune webapp » reste vrai au sens du produit et faux
au sens du répertoire. À prendre en compte dans la réécriture attendue.

---

### INC-021 — Aucune unité ne porte l'écran de connexion, que la DoD de `CRM-011` présuppose

**Nature :** référence manquante entre `docs/BACKLOG.md` et lui-même.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-007`.

La Definition of Done de `CRM-011` exige un « **E2E de connexion et de refus** ». Un tel parcours
suppose un écran où l'on saisit une adresse et un mot de passe. Or :

- `CRM-011` a livré et prouvé le **mécanisme** d'authentification, entièrement hors interface, et a
  nommé l'absence d'écran comme la seule preuve qui lui manque ;
- `CRM-007` livre le **squelette** de la webapp : mise en page, jetons, états. Son énoncé ne
  mentionne ni formulaire de connexion, ni session, ni parcours d'authentification ;
- `CRM-008` livre le **harnais** de tests, c'est-à-dire de quoi exécuter un E2E, pas de quoi en
  avoir un à exécuter ;
- aucune unité de `CRM-012` à `CRM-075` ne nomme cet écran.

C'est le même mode de défaillance qu'INC-015, un cran plus bas : INC-015 constate que le parcours
d'**invitation** n'a aucun composant pour le porter ; on constate ici que le parcours de
**connexion** n'en a pas davantage. La différence est que l'invitation reste discutable — elle peut
demeurer une opération d'exploitation — alors que la connexion ne l'est pas : sans elle, la webapp
ne peut afficher que ce que la clé anonyme obtient, c'est-à-dire rien.

**Conséquence mesurable, aujourd'hui :** la coquille livrée par `CRM-007` n'affiche que des états
vides, non parce qu'elle est inachevée, mais parce que la RLS en refus par défaut rend `200` et
`[]` à un appelant anonyme. C'est l'état réel du produit.

**Comportement retenu :** `CRM-007` ne l'invente pas. Elle livre la coquille, traite l'état vide
comme un état de premier rang, et **nomme** la limite dans `docs/SPEC-webapp.md` §15 et dans
`docs/BACKLOG.md`. Aucun écran de connexion n'est écrit par anticipation : ce serait préempter un
arbitrage et gonfler une unité au-delà de son énoncé.

**Trois options d'arbitrage :**

1. **Rattacher l'écran à `CRM-011`**, qui redeviendrait alors ouverte au sens plein, et dont la
   Definition of Done serait enfin satisfaisable telle qu'elle est écrite.
2. **Créer une unité dédiée** — connexion, déconnexion, session, garde de route — placée entre
   `CRM-007` et `CRM-008`, ce qui rendrait `CRM-011` et `CRM-006` closes dans la foulée.
3. **Élargir `CRM-007`**, ce qui reviendrait à faire porter par le squelette une fonctionnalité que
   son énoncé ne mentionne pas.

**Action attendue du responsable :** trancher entre ces trois options. L'option 2 a la préférence
de rédaction — elle laisse chaque unité à son objet — mais la décision n'appartient pas à l'agent.
Tant qu'elle n'est pas prise, `CRM-011` reste `[~]` avec sa preuve d'E2E manquante, et la webapp
reste anonyme.

**Lié à :** INC-015 (invitation sans composant), INC-020 (build dû par `CRM-007`).

---

### INC-022 — `docs/DAT.md` §3.1 se contredit sur la persistance de session, et l'une des deux versions heurte `CLAUDE.md` §11

**Nature :** contradiction interne à `docs/DAT.md` §3.1, doublée d'une contradiction avec
`CLAUDE.md` §11.
**Relevé le :** 2026-08-04, en relisant `docs/DAT.md` après la livraison de `CRM-007`.

Le même chapitre porte les deux affirmations, à quatre lignes d'intervalle :

> - Authentification via `supabase-js` (GoTrue), **session persistée par la bibliothèque**.

> - `src/lib/supabase.ts` — le client, typé par ce schéma, **sans persistance de session** tant
>   qu'aucun parcours de connexion n'existe (`CLAUDE.md` §11, `docs/JOURNAL.md` décision 44).

La seconde décrit ce qui est livré et vérifié. La première décrit une intention, écrite avant
qu'aucun code n'existe — et cette intention n'est pas neutre : le défaut de
`@supabase/supabase-js` est d'écrire la session dans `localStorage`.

`CLAUDE.md` §11 n'admet une donnée persistante sur l'appareil que si elle est « strictement
nécessaire au fonctionnement demandé » ou « persistante avec consentement explicite lorsque ce
consentement est requis ». Le DAT annonce donc, comme acquise, une écriture persistante dont ni le
recueil du consentement ni le comportement en cas de refus ne sont décrits nulle part.

**Pourquoi ce n'est pas résolu ici.** Ce n'est pas une coquille : c'est un arbitrage de
conformité, et le trancher au passage reviendrait à décider seul de la posture RGPD du produit.
`CRM-007` a fait le seul choix tenable en l'absence de parcours de connexion — ne rien écrire — et
l'a prouvé par un contrôle E2E exigeant un `localStorage` vide. Cela ne répond pas à la question
posée pour la suite.

**Risque :** l'unité qui livrera la connexion peut lire `docs/DAT.md` §3.1, y voir la persistance
présentée comme le comportement attendu, et laisser simplement le défaut de la bibliothèque
s'appliquer. La posture de consentement du produit serait alors décidée par une valeur par défaut,
en silence — ce que `CLAUDE.md` §11 interdit explicitement.

**Action attendue du responsable :** trancher entre trois postures **avant** que l'écran de
connexion ne soit écrit, puis corriger `docs/DAT.md` §3.1 :

1. session en mémoire seule, reperdue à chaque rechargement — aucun consentement requis ;
2. session en `sessionStorage`, limitée à l'onglet — catégorie 2 de `CLAUDE.md` §11 ;
3. session persistante en `localStorage` avec consentement explicite, refus possible sans perdre
   la connexion elle-même — catégorie 3.

Cette contradiction est liée à **INC-021** : c'est la même unité manquante — l'écran de connexion —
qui les porte toutes les deux.

---

### INC-023 — La Definition of Done de `CRM-008` exige des commandes dont les sujets arrivent au chunk 4

**Nature :** contradiction d'ordonnancement entre `docs/BACKLOG.md` et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-008`.

La Definition of Done de `CRM-008` tient en une phrase : « chaque commande du `README.md` §7
s'exécute ; un test volontairement faux échoue bien ». Or `README.md` §7 énumère sept commandes,
et deux d'entre elles n'ont **aucun sujet à exercer** avant le chunk 4 :

- `pytest mail-sync/tests` suppose le service `mail-sync`, livré par `CRM-051` ;
- `npm run e2e:mail` suppose Stalwart et un aller-retour d'email réel, livrés par `CRM-050` puis
  `CRM-054`.

C'est le même mode de défaillance qu'INC-020, où la DoD de `CRM-006` exigeait le build d'une webapp
que l'unité suivante allait livrer, et qu'INC-013, où quatre fonctions d'autorisation attendaient
des tables du chunk 3. La différence tient à l'ampleur : ici, l'écart n'est pas d'une unité mais de
**deux chunks entiers**.

**Pourquoi ce n'est pas résolu ici.** Trois conduites étaient possibles, et deux sont exclues par
`CLAUDE.md` :

1. **Déclarer les projets vides**, pour que les commandes « s'exécutent ». Ce serait une
   déclaration mensongère de complétion (`CLAUDE.md` §26) : `pytest` sur un répertoire sans test
   rend `5`, et un projet Playwright sans scénario rend `0` sans rien avoir exercé. Le dépôt a
   déjà écrit ce refus en toutes lettres dans `e2e/playwright.config.ts` depuis `CRM-007`.
2. **Fabriquer un `mail-sync/` minimal** pour avoir quelque chose à tester : c'est préempter
   `CRM-051` et inventer du périmètre (`CLAUDE.md` §1).
3. **Livrer ce qui est livrable et nommer le reste** : conduite retenue.

**Ce qui est donc livré par `CRM-008`** : `npm run test:sql`, le projet Playwright `api` et ses
fixtures de jetons réels, `npm run e2e:report`, et la preuve de non-complaisance sur chaque famille
de tests. **Ce qui reste dû** : `pytest` et `e2e:mail`.

**Conséquence sur l'état de l'unité :** `CRM-008` reste `[~]`. Elle ne peut pas passer `[x]` sans
mentir sur deux des sept commandes de sa propre Definition of Done.

**Trois options d'arbitrage :**

1. **Scinder `CRM-008`** en `CRM-008a` — harnais SQL et API, livrable maintenant et close — et
   `CRM-008b` — harnais mail et pytest, rattachée au chunk 4. C'est l'option qui laisse chaque
   unité à son objet, et elle a la préférence de rédaction.
2. **Restreindre la Definition of Done de `CRM-008`** aux commandes dont le sujet existe, et faire
   porter `pytest` par `CRM-051` et `e2e:mail` par `CRM-054`, dont les DoD les mentionnent déjà
   toutes les deux. Cette lecture rendrait `CRM-008` close immédiatement.
3. **Laisser `CRM-008` ouverte jusqu'au chunk 4**, ce qui la ferait traverser tout le chunk 3 en
   `[~]` et contreviendrait à la règle 1 de `docs/MASTER_PLAN.md` §1 — « aucun `[~]` laissé
   derrière soi ».

**Action attendue du responsable :** trancher. À noter que l'option 2 s'appuie sur un fait
vérifiable et non sur une commodité : la DoD de `CRM-051` exige déjà « pytest unitaire », et celle
de `CRM-054` « pytest unitaire et intégration contre Stalwart » ainsi que « E2E `mail` avec un
email **réellement envoyé** ». Les deux commandes manquantes sont donc **déjà** couvertes par les
unités qui livreront leur sujet ; les exiger aussi de `CRM-008` les compte deux fois.

**Lié à :** INC-013 (fonctions d'autorisation en attente de tables), INC-020 (build dû par l'unité
suivante, close).

---

## Clos

### INC-020 — La Definition of Done de `CRM-006` exige le build d'une webapp livrée par l'unité suivante

**Nature :** contradiction d'ordonnancement entre `docs/BACKLOG.md` et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-03, pendant `CRM-006`.

La DoD de `CRM-006` tient en deux exigences : « `npm run types:generate` régénère depuis le schéma
local ; **build de la webapp vert** ». La seconde ne peut pas être satisfaite au moment où le plan
demande cette unité : la webapp est l'objet de `CRM-007`, que `docs/MASTER_PLAN.md` §2.c place
**après**. Il n'existe ni `index.html`, ni composant, ni configuration Vite à builder.

C'est le même mode de défaillance qu'INC-009 — la DoD de `CRM-002` exigeait un seed livré trois
unités plus tard — et qu'INC-013.

**Comportement retenu :** `CRM-006` livre ce qui est démontrable, et le nomme :

- `tsc --noEmit` en mode `strict` compile **réellement** les types livrés et leurs assertions.
  C'est moins qu'un build — aucun bundle n'est produit, aucun plugin Vite n'est exercé — et c'est
  dit comme tel dans `docs/BACKLOG.md` et dans `docs/SPEC-types.md` §9 ;
- rien n'est fabriqué pour faire disparaître la contradiction : aucune webapp factice, aucun
  `index.html` vide, aucune configuration Vite écrite par anticipation. Cela préempterait
  `CRM-007`.

**Risque résiduel :** faible et borné. Ce que `tsc` ne couvre pas est la résolution des modules
telle que Vite l'appliquera — extension `.js` dans les imports, `moduleResolution`, alias. Le
`tsconfig.json` de la racine est réglé en `moduleResolution: bundler`, qui est le mode d'un build
Vite ; la confirmation reste due par `CRM-007`.

**Conséquence sur l'état de l'unité :** `CRM-006` reste `[~]`, avec cette seule preuve manquante
nommée noir sur blanc. Ce n'est pas un défaut de réalisation.

**Action attendue du responsable :** aucune décision n'est requise — la preuve s'acquerra
mécaniquement avec `CRM-007`, dont la Definition of Done doit alors **reprendre explicitement** la
vérification du build avec les types générés importés, faute de quoi cette case resterait ouverte
sans propriétaire.

**Clôture, 2026-08-04.** `CRM-007` a livré la webapp et **repris explicitement la vérification**,
comme cette entrée le demandait : `scripts/verify-webapp.sh` prouve que `npm run build` est vert,
que `webapp/dist` est produit, et que le client comme la couche d'accès importent les types
générés. La preuve va plus loin que ce qui était attendu : les types étant effacés à la
compilation, le bundle n'en contient rien — ce qui établit qu'ils **contraignent** le code est un
contrôle non complaisant, où une colonne inexistante fait échouer `npm run typecheck`. Le risque
résiduel nommé ici — la résolution des modules telle que Vite l'applique — est levé par le même
build. `CRM-006` passe `[x]`.

### INC-001 — Disponibilité de `supabase_vault` et `pg_cron` non vérifiée

**Close le :** 2026-08-03, par l'unité `CRM-004`.

**Mesure :** l'image réellement épinglée par `docker-compose.yml`, `supabase/postgres:17.6.1.136`,
fournit `supabase_vault` **0.3.1** — déjà installée et préchargée — et `pg_cron` **1.6.4**,
disponible, préchargé et fonctionnel. Sorties de commande consignées dans `docs/JOURNAL.md`,
section `CRM-004`. Preuves rejouables : `scripts/verify-vault.sh` (26 vérifications).

**Décision :** Vault est retenu, le repli `pgcrypto` est abandonné (décision 23). `pg_cron` reste
inutilisé, mais pour le seul motif de testabilité — voir INC-012, ouvert à cette occasion.

**Conséquence non anticipée, désormais documentée :** la clé racine de Vault vit hors de `PGDATA`
et devient une donnée de sauvegarde à part entière (décision 24, `docs/DAT.md` §10,
`docs/PROD_MIGRATIONS.md`).
