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


**MISE À JOUR — 2026-08-04, `CRM-020`.** La moitié `tracks` est **close** : la migration
`0003_tracks.sql` pose `track_members_track_id_fkey` en `ON DELETE CASCADE`, et l'assertion de la
suite `0001` qui constatait son absence a **réellement échoué** puis été révisée — le mécanisme de
la décision 51 a fonctionné comme prévu. La moitié `channel_members.channel_id` **reste ouverte** :
`channels` arrive avec `CRM-021`, et l'assertion garde sa fonction de garde pour cette table.

Risque d'exploitation associé, nommé à cette occasion : l'ajout d'une clé étrangère échoue s'il
existe une ligne orpheline, et le `migrations-runner` étant une dépendance de démarrage de
PostgREST, la pile ne redémarrerait plus. La vérification préalable est portée par
`docs/PROD_MIGRATIONS.md` §3 (`docs/JOURNAL.md`, décision 55).


**MISE À JOUR — 2026-08-04, `CRM-021`.** La seconde moitié est **close** : la migration
`0004_channels.sql` pose `channel_members_channel_id_fkey` en `ON DELETE CASCADE`. Les deux clés
étrangères différées par cette entrée sont désormais en place.

L'entrée reste **ici, dans les ouverts**, et non déplacée en « Clos », pour une raison qu'il faut
dire plutôt que taire : l'arbitrage demandé — « désigner l'unité qui pose ces deux clés étrangères
et l'inscrire dans leur Definition of Done » — n'a **jamais été rendu**. `CRM-020` et `CRM-021` ont
posé les clés parce qu'elles étaient les candidates naturelles, ce que cette entrée suggérait, mais
aucune Definition of Done n'a été modifiée par le responsable. Le fait technique est acquis ; la
décision documentaire ne l'est pas, et la déclarer close reviendrait à la prendre à sa place.


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

### INC-024 — La politique de lecture des tracks ignore les droits fins, faute de `app.can_read_track`

**Nature :** écart entre `docs/SPEC-permissions-rls.md` §4 et la politique réellement livrée par
`CRM-020`.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-020`.

`docs/SPEC-permissions-rls.md` §4 prescrit, pour la table `tracks`, une lecture gouvernée par
`app.can_read_track`. Cette fonction est l'une des quatre différées par INC-013, dont l'arbitrage
appartient au responsable et **reste ouvert**. `CRM-020` doit néanmoins livrer une politique de
lecture : sans elle, la table serait en refus par défaut et l'unité ne pourrait prouver ni son
CRUD, ni sa lecture, ni le cloisonnement entre workspaces.

**Comportement retenu :** la politique de lecture s'appuie sur `app.is_workspace_member`, livrée et
prouvée par `CRM-010`. Elle est donc **correcte mais incomplète** : elle cloisonne par workspace,
elle n'applique aucun droit fin. Concrètement, un `track_members.access = 'none'` posé sur un track
ne le masque pas encore.

**Ce qui n'est pas fait, et pourquoi :** aucune des quatre fonctions `can_*` n'est écrite ici. Les
créer reviendrait à trancher l'option 1 d'INC-013 — « rattacher chacune des quatre fonctions à
l'unité qui livre sa table » — à la place du responsable. La suite pgTAP de `CRM-010` constate
d'ailleurs leur absence (`hasnt_function`) et deviendrait rouge si elles apparaissaient sans que
ses preuves soient étendues.

**Ce qui protège l'écart :** il est **figé par une assertion** et non par un commentaire. La suite
`supabase/tests/0004_tracks.test.sql` pose une ligne `track_members` restrictive et constate que le
track reste lisible, en nommant `CRM-012`. Le jour où la politique sera resserrée, l'assertion
deviendra rouge et forcera sa révision (`docs/JOURNAL.md`, décision 51).

**Risque résiduel :** un droit fin restrictif posé aujourd'hui sur un track n'aurait aucun effet.
Aucune ligne `track_members` n'existe sur les bases du projet — le seed n'y écrit rien — et
`CRM-012` est l'unité suivante du chunk 2 à traiter dès que ses tables existent. Le risque est donc
borné à la fenêtre entre `CRM-020` et `CRM-012`.

**Action attendue du responsable :** trancher INC-013, ce qui décidera du même coup qui écrit
`app.can_read_track` et quand cette politique est resserrée.

**Lié à :** INC-013 (quatre fonctions différées), INC-014 (aucune unité ne nomme les politiques des
tables d'identité).

---

### INC-025 — `docs/SCHEMA.md` §2 omet `created_at` et `updated_at`, que ses propres conventions exigent

**Nature :** contradiction interne à `docs/SCHEMA.md`.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-020`.

Les « Conventions générales » de `docs/SCHEMA.md` posent : « Horodatages `timestamptz`, toujours en
UTC. `created_at` par défaut `now()`. » Les tables du socle livrées par `CRM-003` — `profiles`,
`workspaces` — portent bien `created_at` et `updated_at`, et le tableau du §1 les énumère.

Le tableau du §2, qui décrit `tracks` et `channels`, ne les énumère **pas**. Rien dans le document
ne justifie l'exception, et les deux tables sont des tables métier ordinaires.

**Comportement retenu :** `CRM-020` livre `tracks` **avec** les deux colonnes et le trigger
`app.set_updated_at()`, conformément aux conventions générales, et met à jour le tableau du §2 dans
le même changement. L'omission est traitée comme une lacune du tableau, non comme une décision
implicite d'y renoncer.

**Ce qui n'est pas fait :** le tableau de `channels`, dans le même §2, n'est **pas** corrigé — il
relève de `CRM-021`, qui livrera la table. Le corriger ici modifierait la spécification d'une unité
non commencée.

**Action attendue du responsable :** confirmer la lecture, ou nommer la raison pour laquelle les
tables du §2 devraient échapper aux conventions générales.


**MISE À JOUR — 2026-08-04, `CRM-021`.** La seconde moitié est traitée : `channels` est livrée
**avec** `created_at`, `updated_at` et le trigger `app.set_updated_at()`, et le tableau du §2 est
complété dans le même changement. Les deux tables du §2 suivent désormais les conventions
générales.

L'entrée reste **ouverte** pour la même raison qu'INC-010 : la lecture retenue — « l'omission était
une lacune du tableau, non une décision d'y renoncer » — n'a pas été confirmée par le responsable.
Deux unités l'ont appliquée ; si elle est fausse, ce sont deux migrations qu'il faut reprendre, et
non une.

---

### INC-026 — Le refus d'un privilège manquant par PostgREST divulgue la commande `GRANT` à exécuter

**Nature :** comportement de PostgREST `v14.12`, mesuré, en tension avec `CLAUDE.md` §20 (« les
erreurs doivent permettre le diagnostic sans exposer l'infrastructure »).
**Relevé le :** 2026-08-04, pendant la mesure préalable à `CRM-020`.

`tracks` n'accorde `DELETE` à personne : la suppression du produit est l'archivage
(`docs/SPEC-tracks.md` §4). Le refus mesuré est correct — `403`, code `42501` — mais son corps
porte un `hint` :

```
"hint": "Grant the required privileges to the current role with: GRANT DELETE ON public.tracks TO authenticated;"
```

Le message nomme la table, le schéma, le rôle courant et la commande exacte qui lèverait le refus.
Aucun secret n'est divulgué, et la table est déjà nommée par la route appelée ; l'information
ajoutée est la **forme du modèle de privilèges**.

**Pourquoi ce n'est pas résolu ici :** le `hint` est produit par PostgREST, pas par le produit. Le
supprimer supposerait un filtrage à la passerelle (Kong) portant sur **toutes** les réponses
d'erreur, donc une décision d'architecture transverse qui déborde très largement `CRM-020`, et qui
risquerait d'appauvrir des diagnostics légitimes.

**Portée réelle :** tous les refus de privilège de l'API, sur toute table, présente et à venir.

**Action attendue du responsable :** décider si ce `hint` doit être filtré à la passerelle, et si
oui, rattacher la mesure à une unité — aucune ne la porte aujourd'hui.

---

### INC-027 — Le type généré exige `position` à l'insertion, que le trigger rend facultative

**Nature :** écart entre `webapp/src/lib/database.types.ts` (généré) et le comportement réel de
`public.tracks`.
**Relevé le :** 2026-08-04, pendant `CRM-020`.

`tracks.position` est `NOT NULL` **sans défaut de colonne** : c'est le trigger
`app.tracks_attribuer_position` qui la renseigne lorsqu'un client l'omet, ce qui est le
comportement voulu et prouvé (`docs/SPEC-tracks.md` §3).

Le générateur de types ne lit que le défaut de **colonne**, et ignore les triggers. Il déclare
donc `position` comme requise dans `TablesInsert<'tracks'>` :

```ts
Insert: { ...; position: number; ... }   // requise pour TypeScript
```

Un appel REST qui l'omet réussit pourtant — mesuré, `201`, position attribuée. **Le type est plus
strict que le produit.**

**Pourquoi ce n'est pas corrigé.** `webapp/src/lib/database.types.ts` est un fichier **généré**, et
la garde anti-dérive de `CRM-006` (`npm run types:check`) compare le fichier versionné à ce que la
base produit. Le retoucher à la main la ferait échouer, et à juste titre.

**Ce qui est fait à la place :** l'écart est **figé par une assertion** dans
`webapp/src/lib/database.types.test-d.ts` (`_tracksInsertRequis`), qui énumère exactement les
colonnes requises à l'insertion. Si une migration future ajoutait un défaut de colonne, l'assertion
deviendrait rouge et forcerait sa révision.

**Conséquence pratique, bornée :** un client TypeScript qui crée un track doit fournir `position`,
ou passer par un cast. Aucun code du dépôt ne crée de track depuis TypeScript aujourd'hui — le seed
passe par `curl`, et l'interface n'a aucun parcours de création (INC-021).

**Action attendue du responsable :** décider, le jour où une interface créera des tracks, entre
trois conduites — poser un défaut de colonne en plus du trigger, exposer une RPC de création, ou
assumer le cast. Le même écart se reproduira sur toute colonne renseignée par trigger.

**Lié à :** INC-021 (aucun écran de connexion, donc aucun parcours de création).

---

### INC-028 — `docs/DESIGN_SYSTEM.md` §5.6 et §8 sont incompatibles pour trois jetons sur cinq

**Nature :** contradiction interne au design system, **mesurée**.
**Relevée le :** 2026-08-04, en ajoutant à `CRM-020` la preuve de contraste qui manquait.

Le §5.6 décrivait les pilules : « fond de la couleur à 10–15 %, **texte à la couleur pleine** ». Le
§8 exige : « Contrastes AA (4,5:1) vérifiés, **y compris pour les badges colorés** ».

Appliquées ensemble aux cinq jetons de couleur de donnée du §1, les deux règles se contredisent.
Contrastes calculés selon WCAG 2.1, texte plein sur son propre fond doux :

| Jeton | Texte | Fond doux | Contraste | §8 |
|---|---|---|---|---|
| `brand` | `#23468C` | `#E9ECF4` | **7,64:1** | conforme |
| `success` | `#238C33` | `#E9F4EB` | **3,82:1** | ÉCHEC |
| `accent` | `#D9CF4A` | `#F7F4D7` | **1,45:1** | ÉCHEC |
| `danger` | `#F24141` | `#FEECEC` | **3,29:1** | ÉCHEC |
| `neutral` | `#4B5563` | `#F3F4F6` | **6,87:1** | conforme |

La contradiction date de `CRM-000`, pas de `CRM-020` : elle n'avait jamais été rencontrée, aucun
composant n'ayant eu à peindre un texte sur un fond doux de sa propre couleur — `CRM-007`
n'employait `bg-brand-soft text-brand`, le seul couple conforme, que pour l'état actif.

**Ce que la première livraison de `CRM-020` avait corrigé, et ce qu'elle avait laissé passer.**
`accent`, à 1,45:1, est illisible : il a été vu sur une capture et corrigé par un repli sur l'encre.
`success` et `danger` sont restés en couleur pleine. Ils sont **lisibles sans être conformes** — ils
ne se voient pas, ils se mesurent — et la conformité AA n'était alors que *déclarée* : aucune preuve
du dépôt ne calculait un contraste. Le track `studio-web` du seed, en `success`, a donc été rendu à
3,82:1 pendant que la Definition of Done invoquait le §8.

**Ce qui a été fait, et pourquoi ce n'est pas une résolution implicite.** Une pilule devait bien
être peinte : il n'existait aucun comportement antérieur conforme à laisser inchangé. La conduite
est donc explicite — quatre jetons `--color-*-on-soft`, le jeton plein assombri juste assez pour
tenir le §8 en conservant sa teinte, donc l'intention du §5.6. Valeurs **calculées** à partir du
jeton, comme les fonds doux, jamais des hexadécimaux ad hoc. Contrastes obtenus : 7,64 / 4,85 /
4,72 / 4,67. Écart déclaré en `docs/DESIGN_SYSTEM.md` §12.5, et **mesuré sur le rendu** par
`e2e/ui/tracks.spec.ts`.

Entre les deux règles, `CLAUDE.md` §26 place de toute façon la protection des personnes avant la
préférence stylistique.

**Ce qui reste à trancher, et qui déborde `CRM-020` :**

1. Le §5.6 doit-il être **réécrit** pour tout le produit, ou l'écart §12.5 doit-il rester borné aux
   pilules de track ?
2. Les mêmes jetons `*-on-soft` s'appliquent-ils aux **badges** (`Badge.tsx`), aux liserés de card
   (§5.1) et aux compteurs de colonne (§5.2), qui rencontreront la même contradiction ?
3. Le jeton `accent` reste-t-il utilisable comme couleur de donnée ? Le §1 le réserve à « un seul
   surlignage par vue » ; l'ouvrir aux tracks, comme le fait le seed, va au-delà de cette phrase.

**Leçon retenue, indépendante de l'arbitrage :** une exigence chiffrée qu'aucune preuve ne calcule
n'est pas une exigence, c'est une intention. Les contrôles d'accessibilité chiffrés du §8 devraient
être mesurés partout où ils s'appliquent, et non seulement sur les pilules de track.

**Action attendue du responsable :** trancher les trois points, et rattacher la mise en conformité
des autres composants à une unité si le §5.6 est réécrit.

---

### INC-029 — `channels.workflow_id` est exigée `non nul` et référencée, alors que `workflows` arrive deux étapes plus tard

**Nature :** contradiction d'ordonnancement entre `docs/SCHEMA.md` §2 et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-021`.

`docs/SCHEMA.md` §2 décrit `channels.workflow_id` comme `uuid`, **`FK workflows`, non nul**. La
table `workflows` est livrée par `CRM-031`, que `docs/MASTER_PLAN.md` §2 place au chunk **3.b**,
après `CRM-021` qui est au **3.a**. Mesuré sur la base migrée du projet :
`to_regclass('public.workflows')` rend `NULL`.

Ce n'est pas contournable par l'écriture. Une clé étrangère vers une table absente est refusée à la
création, et une contrainte `NOT NULL` sur une colonne qu'aucune valeur licite ne peut renseigner
rendrait la table **inutilisable** : ni le seed, ni les preuves d'API ne pourraient créer un
channel. C'est le troisième cas du même mode de défaillance, après INC-010 (`CRM-003` a dû se
passer de clés étrangères) et INC-013 (`CRM-010` a dû se passer de jointures) ; ici, `CRM-021` doit
se passer d'une contrainte.

Le plan lui-même est cohérent avec son propre motif — « l'arborescence conditionne tout le reste »
place tracks et channels d'abord, « le moteur de workflow avant les cards » place les workflows
ensuite. C'est le **modèle de données** qui introduit une dépendance inverse, en faisant du
workflow une propriété obligatoire du channel.

**Comportement retenu :** `CRM-021` livre ce qui est démontrable aujourd'hui, et **rien de plus**.

| Aspect | Livré par `CRM-021` | Différé, et à qui |
|---|---|---|
| Colonne `workflow_id uuid` | oui, **nullable** | — |
| Clé étrangère vers `workflows` | non | `CRM-031` |
| Contrainte `NOT NULL` | non | `CRM-031`, après reprise des lignes existantes |
| Trigger de cohérence workflow ↔ track | non | `CRM-033`, déjà nommé par la DoD de `CRM-021` |

Aucune table `workflows` n'est créée par anticipation : cela préempterait `CRM-030` et `CRM-031`.

**Ce qui protège l'écart :** il est **figé par des assertions** de
`supabase/tests/0005_channels.test.sql`, non par un commentaire. La suite constate que
`workflow_id` est nullable, qu'elle ne porte aucune clé étrangère, et que `public.workflows`
n'existe pas. Les trois deviendront rouges le jour où `CRM-031` livrera la table, et forceront la
reprise de `docs/SPEC-channels.md` §2.5 (même procédé que la décision 51).

**Risque résiduel :** un channel sans workflow n'a pas d'étapes, donc pas de board. Le risque est
**borné à la fenêtre `CRM-021` → `CRM-031`** : les cards n'existent pas avant `CRM-040`, qui vient
après les deux. Le seed laisse `workflow_id` nul partout, ce qui est l'état réel du produit, et ne
fabrique pas une donnée que le modèle ne sait pas encore produire.

**Conséquence sur l'état de l'unité :** `CRM-021` ne peut pas satisfaire `docs/SCHEMA.md` §2 à la
lettre. Ce n'est pas un défaut de réalisation mais une dépendance non satisfiable dans l'ordre
actuel du plan.

**Arbitrage attendu du responsable.** Trois options, à trancher **avant `CRM-031`**, qui décidera
de la forme de la reprise :

1. inscrire dans la Definition of Done de `CRM-031` la pose de la clé étrangère **et** de la
   contrainte `NOT NULL`, avec la reprise des channels existants — symétrique de ce qu'INC-010 a
   demandé à `CRM-020` et `CRM-021` ;
2. déplacer `CRM-030` et `CRM-031` avant `CRM-021` dans `docs/MASTER_PLAN.md` §2, au prix de livrer
   le moteur de workflow avant l'arborescence qu'il équipe ;
3. décider que `workflow_id` reste **facultative** dans le modèle — un channel sans workflow étant
   alors un état légitime du produit — et corriger `docs/SCHEMA.md` §2 en conséquence. Cette option
   a un coût qu'il faut nommer : tout code lisant `channel.workflow_id` devra traiter le cas nul.

**Lié à :** INC-010 et INC-013 (même mode de défaillance), INC-025 (autre lacune du même tableau).

**Mise à jour du 2026-08-04, pendant `CRM-031` — la moitié structurelle est levée, l'arbitrage
reste ouvert.** `workflows` existe désormais. `CRM-031` livre donc :

- la clé étrangère, et **composite** — `(workflow_id, workspace_id)` vers
  `workflows (id, workspace_id)` —, de sorte que le workflow d'un channel appartienne au même
  workspace, garanti par la base et non par une politique ;
- le rattachement des **six channels du seed** au workflow par défaut, ce qui retire le risque
  résiduel nommé ci-dessus : plus aucun channel de démonstration n'est sans board ;
- la mise à jour des trois assertions de `supabase/tests/0005_channels.test.sql`, devenues rouges
  comme prévu — le mécanisme a fonctionné une quatrième fois.

**La contrainte `NOT NULL` n'est pas posée**, et ce n'est pas un oubli. Elle change le **contrat de
création d'un channel** : créer un channel deviendrait impossible sans désigner un workflow, ce qui
touche les scénarios d'API de `CRM-021` et le geste produit lui-même. C'est l'unité de la cohérence
workflow ↔ channel — `CRM-033`, déjà nommée par la Definition of Done de `CRM-021` pour son trigger
— qui doit la porter, avec la règle qu'elle applique. L'option 1 de l'arbitrage ci-dessus est donc
**engagée à moitié et non tranchée** : `CRM-031` a fait ce qu'il pouvait faire sans décider à la
place du responsable. Les options 2 et 3 restent ouvertes ; l'option 3, en particulier, rendrait la
`NOT NULL` inutile plutôt que différée.

---

### INC-030 — La politique de lecture des channels ignore les droits fins, faute de `app.can_read_channel`

**Nature :** écart entre `docs/SPEC-permissions-rls.md` §4 et la politique réellement livrée par
`CRM-021`.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-021`.

Jumelle d'INC-024, pour les channels.

`docs/SPEC-permissions-rls.md` §4 prescrit, pour la table `channels`, une lecture gouvernée par
`app.can_read_channel`, et une écriture par `app.can_write_channel` pour les tables filles.
Ces deux fonctions sont parmi les quatre différées par INC-013, dont l'arbitrage appartient au
responsable et **reste ouvert**. `CRM-021` doit néanmoins livrer une politique de lecture : sans
elle, la table serait en refus par défaut et l'unité ne pourrait prouver ni son CRUD, ni sa lecture,
ni le cloisonnement entre workspaces.

**Comportement retenu :** la politique de lecture s'appuie sur `app.is_workspace_member`, livrée et
prouvée par `CRM-010` — exactement le choix de `CRM-020` pour `tracks`. Elle est donc **correcte
mais incomplète** : elle cloisonne par workspace, elle n'applique aucun droit fin. Un
`channel_members.access = 'none'` posé sur un channel ne le masque pas encore.

**Ce qui n'est pas fait, et pourquoi :** aucune des quatre fonctions `can_*` n'est écrite ici. Les
créer reviendrait à trancher l'option 1 d'INC-013 à la place du responsable, et la suite pgTAP de
`CRM-010` — qui constate leur absence par `hasnt_function` — deviendrait rouge.

**Ce qui protège l'écart :** une assertion de `supabase/tests/0005_channels.test.sql` pose une ligne
`channel_members` restrictive et constate que le channel reste lisible, en nommant `CRM-012`.

**Risque résiduel :** un droit fin restrictif posé aujourd'hui sur un channel n'aurait aucun effet.
Aucune ligne `channel_members` n'existe sur les bases du projet — le seed n'y écrit rien.

**Action attendue du responsable :** trancher INC-013, ce qui décidera du même coup qui écrit
`app.can_read_channel` et `app.can_write_channel`, et quand ces politiques sont resserrées.

**Lié à :** INC-013, INC-024 (la même entrée pour `tracks`), INC-014.

---

### INC-031 — Le refus d'archivage d'un nœud occupé exige `workflow_steps` et `cards`, livrées après

**Nature :** contradiction d'ordonnancement entre `docs/SPEC-workflow-engine.md` §2, la Definition
of Done de `CRM-030` dans `docs/BACKLOG.md`, et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-030`.

La Definition of Done de `CRM-030` exige « pgTAP sur le refus d'archivage » d'un nœud occupé, et
`docs/SPEC-workflow-engine.md` §2 énonce la règle : « son archivage est refusé tant qu'une card
active s'y trouve ».

Or « une card active se trouve sur ce nœud » n'est pas une propriété du nœud. Le chemin est
`cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id`. Il traverse donc deux
tables livrées **après** cette unité par `docs/MASTER_PLAN.md` §2 : `workflow_steps` par `CRM-031`,
`cards` par `CRM-040`. **Mesuré** au moment de la spécification :
`to_regclass('public.workflow_steps')`, `to_regclass('public.workflows')` et
`to_regclass('public.cards')` rendent tous les trois `NULL`.

C'est le troisième cas du même motif — INC-010 pour des clés étrangères, INC-013 pour des
jointures d'autorisation, INC-029 pour une colonne. Ici, ce qui manque est la **cible** de la
garde.

**Ce qui rend l'écriture anticipée pire que l'omission — mesuré, non supposé.** PostgreSQL
**accepte la création** d'une fonction PL/pgSQL référençant une table absente : le corps n'est pas
analysé à la création. L'échec ne survient qu'au **premier appel**, en
`relation "public.cards" does not exist`. Un trigger d'archivage écrit aujourd'hui ne protégerait
donc rien, et ferait échouer **toute** mise à jour du catalogue — y compris un simple renommage —
dès sa livraison. Le seed lui-même ne pourrait plus converger.

**Comportement retenu :** `CRM-030` livre l'archivage **doux et réversible** — `archived_at`,
aucune suppression physique, aucun privilège `DELETE` — sans la garde d'occupation. La règle est
énoncée dans la spécification, l'absence de ses tables est **figée par des assertions pgTAP**
(`hasnt_table`), de sorte que la suite devienne rouge le jour où `workflow_steps` ou `cards`
apparaîtront sans que la garde ait été écrite. Mécanisme de la décision 51, employé une quatrième
fois.

**Risque résiduel :** nul aujourd'hui — aucune card n'existe, aucun nœud ne peut être occupé. Le
risque naîtrait à `CRM-040` si la garde n'était pas écrite avant que des cards ne peuplent des
étapes : un nœud archivé alors qu'il porte des cards actives ferait disparaître une colonne du
board sans que ses cards aient été déplacées.

**Arbitrage attendu du responsable.** Trois options, à trancher **avant `CRM-040`** :

1. rattacher la garde à `CRM-040`, l'unité qui livre la dernière table dont elle dépend, et
   l'inscrire dans sa Definition of Done ;
2. rattacher la garde à `CRM-031`, en la limitant à l'occupation par une **étape** — un nœud
   instancié dans un workflow ne serait plus archivable, règle plus stricte que celle spécifiée et
   qui interdirait d'archiver un nœud pourtant vide de cards ;
3. créer une unité distincte, par exemple `CRM-030b`, placée après `CRM-040`.

Tant que le point est ouvert, `CRM-030` reste `[~]` et la limite est nommée.

**Lié à :** INC-010, INC-013, INC-029 (le même motif, sur d'autres objets), INC-023.

**Mise à jour du 2026-08-04, pendant `CRM-031` — la moitié du chemin existe, l'arbitrage reste
ouvert.** `workflows` et `workflow_steps` sont livrées. Le chemin de la garde n'est donc plus
interrompu qu'en un point : `cards`, due par `CRM-040`. **Mesuré à nouveau** :
`to_regclass('public.workflow_steps')` rend désormais la table, `to_regclass('public.cards')` rend
toujours `NULL`.

`CRM-031` **n'écrit pas la garde**, et n'adopte pas l'option 2 qui la lui rattacherait : cette
option est plus stricte que la règle spécifiée — elle interdirait d'archiver un nœud instancié dans
un workflow mais vide de toute card —, et l'adopter en silence trancherait à la place du
responsable. Les trois options restent donc ouvertes, à trancher avant `CRM-040`.

Les assertions qui figeaient l'écart sont mises à jour dans le même changement : deux
`hasnt_table` sont devenues fausses et ont été remplacées par leur constat inverse — les tables
existent, `cards` n'existe pas, et **aucun trigger d'archivage n'est posé sur le catalogue**. La
troisième, sur `cards`, reste en place et deviendra rouge à `CRM-040`.

---

### INC-032 — `./runDev.sh` ne peut pas démarrer à froid derrière un proxy TLS interposé

**Nature :** chemin documenté inatteignable depuis le script de lancement.
**Relevé le :** 2026-08-04, pendant l'intégration de `CRM-030` sur `main`.

Sur un environnement neuf, `./runDev.sh` s'interrompt à la construction de l'image `webapp` :

```
npm error code SELF_SIGNED_CERT_IN_CHAIN
npm error request to https://registry.npmjs.org/... failed,
  reason: self-signed certificate in certificate chain
```

Le motif est connu et **anticipé par le dépôt** : `webapp/Dockerfile` §20–29 monte un secret de
construction `npm_ca` précisément pour ce cas, et documente l'invocation attendue —
`docker build --secret id=npm_ca,src=/chemin/vers/ca.crt`. Mais `docker-compose.dev.yml` ne déclare
aucun `secrets:` dans la section `build:` du service `webapp`, et `runDev.sh` appelle
`compose_dev up -d --wait` sans passer par `docker build`. Le chemin prévu existe donc, et **aucune
commande du dépôt ne l'emprunte**.

**Conséquence mesurée.** `./runDev.sh` sort en `1` sur toute machine dont le trafic HTTPS traverse
un proxy présentant sa propre autorité — ce qui est le cas de l'environnement de la routine cloud,
et le cas courant en entreprise. La pile complète est alors inaccessible, et avec elle **toutes**
les preuves du projet, y compris celles qui n'ont rien à voir avec la webapp.

**Contournement appliqué, et pourquoi il n'est pas la correction.** L'image a été construite à la
main avec le secret, puis `runDev.sh` l'a réutilisée — `compose up` ne reconstruit pas une image
présente. C'est un geste hors dépôt, que rien ne documente et que la prochaine exécution devra
refaire.

**Ce qui n'est pas fait, et pourquoi.** `docker-compose.dev.yml` et `runDev.sh` sont des livrables
de `CRM-002` et de `CRM-007`, toutes deux `[x]`. Les corriger reviendrait à rouvrir deux unités
vérifiées pendant un passage consacré à une troisième, et à toucher les preuves de `CRM-002`
(`scripts/verify-scripts.sh`, 38 contrôles) dans un commit qui n'en traite pas — ce que
`CLAUDE.md` §13 interdit. Le comportement reste donc **inchangé**.

**Arbitrage attendu du responsable.** Trois options :

1. déclarer un secret de construction facultatif dans `docker-compose.dev.yml`, alimenté par une
   variable `NPM_CA_FILE` documentée dans `.env.example` — la correction la plus fidèle à
   l'intention du `Dockerfile`, au prix d'une variable de plus ;
2. laisser le dépôt tel quel et **documenter** la construction manuelle dans `README.md` §6, en
   assumant que l'amorçage n'est pas autonome derrière un proxy interposé, contre `CLAUDE.md` §3
   (« l'environnement de développement doit être aussi autonome que possible ») ;
3. rattacher la correction à une unité de dette dédiée, avec ses propres preuves.

**Lié à :** `CLAUDE.md` §3 (autonomie de l'environnement de développement), `CLAUDE.md` §14
(démarrage des services locaux).

---

---

### INC-033 — `require_fields` ne peut porter aucune intégrité référentielle, jamais

**Nature :** limite du modèle de données, mesurée ; `docs/SCHEMA.md` §3 la décrit sans la nommer.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-031`.

`docs/SCHEMA.md` §3 donne à `workflow_transitions.require_fields` le type `uuid[]` : « champs
exigés en plus de ceux requis par l'étape cible ». Ces identifiants désignent des lignes de
`form_fields` (`CRM-035`).

**Mesuré sur la sonde :** PostgreSQL refuse toute clé étrangère depuis une colonne tableau —
`alter table … add foreign key (require_fields) references … (id)` échoue en « Key columns
"require_fields" and "id" are of incompatible types: uuid[] and uuid ». Ce n'est pas un différé
d'ordonnancement comme INC-029 ou INC-031 : c'est une propriété du type, qui ne changera pas quand
`form_fields` existera.

**Conséquence.** La suppression d'un champ de formulaire laissera des identifiants morts dans les
tableaux `require_fields` des transitions. Rien ne les signalera, et le comportement de `move_card`
(§5) face à un identifiant qui ne désigne plus rien n'est écrit nulle part : exiger un champ
inexistant bloquerait toute transition, l'ignorer relâcherait silencieusement une exigence.

**Comportement retenu par `CRM-031` :** la colonne est livrée telle que la référence de schéma la
décrit — `uuid[]`, non nulle, défaut `'{}'` —, l'absence de contrainte est **écrite** dans
`docs/SPEC-workflow-engine.md` §3.4, et le seed la laisse vide partout, `form_fields` n'existant
pas. Aucune règle de nettoyage n'est inventée.

**Arbitrage attendu du responsable**, à trancher avant `CRM-036` qui livrera la validation des
champs :

1. remplacer le tableau par une table de liaison `workflow_transition_required_fields`, qui
   restaurerait l'intégrité référentielle au prix d'une table de plus et d'un écart avec
   `docs/SCHEMA.md` §3 ;
2. conserver le tableau et poser un trigger de nettoyage à la suppression d'un champ, qui retirerait
   l'identifiant des transitions concernées ;
3. conserver le tableau et décider explicitement du comportement de `move_card` face à un
   identifiant mort — l'ignorer, en le journalisant.

**Lié à :** INC-029, INC-031 (écarts nommés sur le même modèle, d'origine différente).

---

### INC-034 — L'environnement de la routine impose une branche et une identité Git contraires à `CLAUDE.md` §13

**Nature :** contradiction entre les conventions du responsable et la configuration de
l'environnement d'exécution de la routine.
**Relevé le :** 2026-08-04, pendant `CRM-031`.

`CLAUDE.md` §13 et `docs/MASTER_PLAN.md` §1 sont explicites : **pas de branche, pas de worktree**,
tout se fait sur `main` ; et **aucun commit n'est attribué à un agent**, l'auteur et le committer
étant ceux du responsable. Deux faits mesurés contredisent l'un et l'autre.

**1. La routine s'exécute sur une branche imposée, pas sur `main`.** Son environnement lui assigne
`claude/happy-goldberg-s6b1t0` et lui interdit de pousser ailleurs. C'est la seconde occurrence du
problème traité par la décision 71 : `CRM-030` avait été poussée sur
`claude/happy-goldberg-c627zj`, puis reportée sur `main` par cherry-pick à l'exécution suivante.
Le travail de `CRM-031` est dans la même situation — il est complet et vérifié, mais il vit sur une
branche.

**Mesuré, et plus grave que l'écart lui-même :** au démarrage de cette exécution, la branche locale
portait **29 commits qu'aucune référence distante ne contenait**. `git fetch origin
claude/happy-goldberg-s6b1t0` répondait « couldn't find remote ref ». Le travail de plusieurs
exécutions — dont `CRM-020`, `CRM-021` et l'intégration de `CRM-030` — n'existait donc que dans le
conteneur, qui est éphémère. Le `push` a été fait immédiatement, avant toute autre chose.

**2. L'identité Git par défaut de l'environnement est celle de l'agent.** Aucun `user.name` ni
`user.email` n'était configuré **localement** dans le dépôt ; la valeur globale du conteneur vaut
`Claude <noreply@anthropic.com>`, et les deux premiers commits de cette exécution en ont hérité,
alors que les 34 précédents portent tous `P2Enjoy <contact@p2enjoy.studio>`.

**Comportement retenu :** la configuration **locale** du dépôt est posée à
`P2Enjoy <contact@p2enjoy.studio>`, et les deux commits fautifs — les seuls concernés, tous deux de
cette exécution et non fusionnés — ont été réécrits pour porter cette identité. `CLAUDE.md` §13
prévoit que la correction d'un commit déjà poussé se fait « sur instruction explicite du
responsable » ; aucune instruction n'était atteignable, la routine s'exécutant sans personne devant
l'écran. La règle d'attribution étant elle-même **non négociable** et la réécriture ne portant que
sur des commits de la routine, la correction a été faite et est nommée ici plutôt que laissée en
l'état. Aucun commit antérieur n'a été touché.

**Ce qui reste à arbitrer :**

1. **La branche.** Soit la routine est autorisée à pousser sur `main` — ce que ses consignes
   demandent —, soit `CLAUDE.md` §13 acte que le travail des exécutions cloud transite par une
   branche et décrit qui l'intègre, et quand. L'état actuel oblige chaque exécution à découvrir le
   travail de la précédente sur une branche qu'elle doit d'abord énumérer.
2. **L'identité.** La configuration locale posée ici vit dans `.git/config`, qui n'est pas versionné :
   elle sera **perdue au prochain conteneur neuf**. Un correctif durable suppose soit un script
   d'amorçage qui la pose, soit une variable d'environnement fournie par la routine.

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
