# Registre des contradictions et points ouverts

Consigne les contradictions, références manquantes et hypothèses non vérifiées relevées pendant
la conception ou l'implémentation. **Rien n'est résolu implicitement** : tant qu'un point est
ouvert, le comportement reste inchangé et l'arbitrage du responsable est sollicité lorsque la
correction dépasse la tâche autorisée.

Une entrée est close lorsque la décision est prise, consignée dans `docs/JOURNAL.md`, et
répercutée dans les documents concernés.

---

## Ouverts

### INC-084 — Le parcours Chromium global est instable et son exécuteur écrit des avertissements — **CLOSE**

**Nature :** preuve E2E non déterministe et sortie utilisateur contraire à l'exigence zéro
`warning`.
**Relevé le :** 2026-08-07, pendant le rejeu de fermeture d'INC-083 et de `CRM-015`.

**Mesure globale.** Après SQL 19/19 et API 410/410, `scripts/verify-harness.sh` rend **143/144**
sur le projet UI. Le parcours « le retour à la card publie réellement le commentaire de
l'administratrice » voit le texte dans la page, interroge immédiatement PostgREST puis reçoit un
tableau dont la longueur n'est pas 1. Son `finally` nettoie la ligne et le reste du harnais se
restaure ; verdict final **28 contrôles, 1 anomalie**.

**Contre-mesure ciblée.** Le même scénario, exécuté **dix fois** de suite contre la pile réelle,
rend 10/10. Ce résultat n'annule pas l'échec global : il localise un ordre d'attente trop faible.
Le scénario attend le texte saisi dans la page, pas le signal utilisateur de fin de publication.
Or seul le brouillon vidé et l'annonce « Commentaire publié » sont posés après le retour réussi de
l'insertion. Une preuve qui relit l'API doit attendre ce point précis.

**Avertissements reproductibles.** Chacune de ces dix exécutions écrit
`Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set` dans le processus
webServer puis dans les workers. Playwright force la couleur tandis que l'environnement de
l'appelant exporte `NO_COLOR`; Node avertit avant le premier scénario. Ce n'est pas la console du
navigateur — déjà stricte — mais c'est bien la console de la commande utilisateur, et elle ne peut
pas être déclarée propre.

**Correction décidée.** Le parcours de publication attend le brouillon vide et la région live
« Commentaire publié » avant sa relecture hors interface. La configuration Playwright retire
`NO_COLOR` de son propre environnement lorsque Playwright pilote les processus colorés, avant de
lancer le webServer ou un worker. La preuve ciblée, la suite UI complète et le harnais global
doivent ensuite rendre zéro échec et zéro ligne `Warning:`.

**Clôture, 2026-08-07.** Le scénario attend désormais le champ vidé et la région live avant la
relecture PostgREST ; dix répétitions rendent **10/10**. La configuration retire `NO_COLOR` dans
son propre processus avant les enfants Playwright, sans modifier le shell parent. Le harnais
global refuse explicitement tout `warning` de la sortie UI et rend **144/144 sans avertissement**,
puis **28 contrôles sans anomalie** après ses six dégradations et leur restauration.

---

### INC-083 — Vingt et un harnais autonomes contournent encore la chaîne Node de `CRM-008` — **CLOSE**

**Nature :** preuve utilisateur inexécutable depuis le shell WSL réel ; portée trop étroite du
correctif de la décision 278.
**Relevé le :** 2026-08-07, pendant le parcours utilisateur final de `CRM-015`.

**Mesure.** Après deux démarrages réels de la pile, sans puis avec `NPM_CA_FILE`,
`scripts/verify-stack.sh` rend **50/50**. Lancé juste après depuis le même shell,
`scripts/verify-webapp.sh` choisit pourtant `/mnt/c/Program Files/nodejs/npm` : `cmd.exe` refuse le
chemin UNC, `vite` est introuvable, le build ne produit pas `webapp/dist`, et le harnais commence
par **deux échecs**. Ce n'est pas une régression de la webapp : `scripts/verify-harness.sh` avait
déjà sélectionné Node v24.14.1 / npm 11.11.0 Linux et rendu 28/28 sur la même machine.

**Cause.** La décision 278 a livré un résolveur commun dans `scripts/lib/node.sh`, mais seul
`scripts/verify-harness.sh` le charge. Une recherche des invocations effectives, hors commentaires,
trouve **vingt-deux** harnais `scripts/verify-*.sh` qui exécutent `npm` ou `node`; vingt et un
contournent encore le résolveur. Tous sont annoncés comme commandes autonomes dans le README ou
constituent la preuve autonome d'une unité. Demander à l'utilisateur de corriger son `PATH` entre
deux commandes ne rend pas ces actions exécutables.

**Correction décidée.** Tout harnais shell autonome qui exécute Node ou npm charge
`scripts/lib/node.sh` et appelle `node_toolchain_prepare` avant sa première mutation. Une preuve
statique recense les invocations réelles et refuse tout nouveau harnais non protégé ; la preuve
isolée du résolveur passe donc de quatre à cinq contrôles. `scripts/verify-webapp.sh` doit ensuite
être rejoué depuis le `PATH` WSL défectueux d'origine, pas depuis un shell préparé à la main.

**Portée.** Le correctif ne crée aucun alias npm, ne modifie pas le shell parent et ne change
aucune logique métier. Il complète `CRM-008`; `CRM-015` ne pourra revendiquer son parcours final
qu'une fois `verify-webapp.sh` redevenu réellement exécutable.

**Clôture, 2026-08-07.** Les vingt et un points d'entrée chargent maintenant le résolveur avant
leur première mutation. `scripts/verify-node-toolchain.sh` recense dynamiquement les **22**
harnais Node/npm et rend **5/5**. Depuis le `PATH` WSL qui expose réellement `npm.exe`,
`scripts/verify-webapp.sh` sélectionne Node v24.14.1 / npm 11.11.0 Linux et rend **42/42** ; le
rejeu global rend ensuite **28/28**. Aucun alias, téléchargement ni changement du shell parent.

---

### INC-082 — Trois décisions récupérées décrivent un assemblage Stalwart que `main` n'a pas

**Nature :** contradiction entre des décisions du responsable réinsérées et l'infrastructure
réellement livrée. **Aucune des deux n'est modifiée** tant que l'arbitrage n'est pas rendu.
**Relevé le :** 2026-08-07, pendant la passe de cohérence documentaire.

**Le fait.** Les décisions **249, 250 et 252** ont été rendues sur `claude/happy-goldberg-qt5vfi`,
dont la ligne de travail sur `CRM-050` a divergé de celle de `main`. Elles décrivent un assemblage
que `main` n'a pas adopté :

| Point | Décision récupérée | Ce que `main` livre |
|---|---|---|
| Configuration | `stalwart/config.json` monté en lecture seule + `stalwart/plan.json.template` appliqué par `stalwart-cli apply` (décision 249) | `stalwart/config.toml` + `stalwart/provision.sh` |
| Services d'assemblage | Deux conteneurs, `stalwart-plan` et `stalwart-init`, l'image du CLI étant *distroless* | Aucun ; provisionnement par script |
| Écoutes réseau | **Aucune** déclarée ; les sept écoutes par défaut suffisent, TLS implicite sur 993 et 465 (décision 250) | **Cinq écoutes déclarées** dans `config.toml` |
| Spécification citée | `docs/SPEC-mail-dev-infra.md` §9.1 et §9.8 | `docs/SPEC-mail-subsystem.md` §11 — le fichier cité **n'existe pas** dans ce dépôt |

**Ce qui n'est pas en cause.** Les constats de mesure portés par ces décisions restent
vraisemblablement valables quelle que soit la voie retenue, et méritent d'être confrontés à
l'assemblage de `main` plutôt que perdus :

- un `grep -q` en bout de tuyau sous `set -o pipefail` fait dire à un contrôle **l'inverse** de ce
  qu'il mesure (décision 252) — le harnais de `main` doit être relu sur ce motif ;
- une écoute Stalwart n'est liée qu'au **démarrage suivant** du serveur (décision 250) ;
- le port 25 annonce `STARTTLS` et **jamais** `AUTH` : toute expédition authentifiée passe par 465 ;
- `SEARCH HEADER Message-ID` rend zéro résultat sur `v0.16.16` alors que le message est bien dans
  l'`INBOX` — ce qui concernera `CRM-054`, dont le dédoublonnage repose sur le `Message-ID`.

**Arbitrage attendu du responsable.** Conserver l'assemblage de `main` et déclarer ces trois
décisions caduques sur leur volet *mise en œuvre* ; ou reprendre l'assemblage décidé. Dans les deux
cas, les quatre constats de mesure ci-dessus sont à vérifier contre le code réellement livré.

**En attendant :** rien n'est modifié dans `stalwart/`, et les décisions 249, 250 et 252 restent
dans `docs/JOURNAL.md` telles qu'elles ont été rendues.

---

### INC-081 — Les décisions du responsable sont réinsérées ; leur mise en œuvre reste à faire

**Nature :** décisions du responsable restées hors de `main`, désormais réinsérées ; l'écart qui
subsiste est un écart **de mise en œuvre**, pas de trace.
**Relevé le :** 2026-08-07, pendant la suppression des branches `claude/happy-goldberg-*`.

**Le fait.** Quarante et une branches ont été poussées sur `origin` en violation de `CLAUDE.md`
§13, qui interdit toute création de branche. Avant leur suppression, leur contenu a été comparé à
`main`. Quarante ne portaient que des réimplémentations parallèles d'unités que `main` porte déjà.
La branche `claude/happy-goldberg-qt5vfi` retenait en propre **dix-huit décisions du responsable,
dont cinq arbitrages explicites**, ainsi que `docs/ARBITRAGES.md`.

**Ce qui est fait.** Les dix-huit décisions sont **réinsérées dans `docs/JOURNAL.md`**, texte
inchangé, sous les numéros **249 à 266**. La renumérotation était contrainte : les deux lignes
avaient attribué les numéros 235 à 252 à des sujets différents — sur `main` le numéro 239 traite de
la boîte mail du `viewer`, sur la branche il rattachait l'écran de connexion à `CRM-009`. Les
numéros d'origine sont conservés en tête de chaque entrée et rappelés dans
`docs/ARBITRAGES_RECUPERES.md`. `docs/ARBITRAGES.md` est également récupéré.

**Ce qui reste ouvert, et c'est le seul objet de cette entrée.** La **mise en œuvre** de plusieurs
de ces décisions n'est pas faite. Mesuré :

- **Décision 262 — `require_fields` devient une table de liaison.** Non appliquée.
  `docs/SCHEMA.md` décrit toujours `require_fields` en `uuid[]` et note qu'il ne peut porter
  aucune intégrité référentielle, ce que cette décision renversait. Engage une migration,
  `docs/SCHEMA.md`, `docs/DAT.md` et `docs/PROD_MIGRATIONS.md`.
- **Décision 261 — l'ordonnancement passe à `pg_cron`**, qui renverse la décision 8.
- **Décision 260 — les fonctions edge entrent au périmètre**, qui rouvre la décision 12.
- **Décision 263 — `change_channel_workflow`** est un geste distinct, sans unité de backlog dédiée.

Appliquées, vérifiées : les décisions **253** (unité de l'écran de connexion) et **254** (session en
`sessionStorage`) le sont déjà par la décision 243 de `main` ; seule leur trace manquait. Les
autres entrées n'ont pas été mesurées une à une.

**Suite due.** Rattacher chaque mise en œuvre restante à une unité de `docs/BACKLOG.md`, puis
clore cette entrée lorsque les quatre points ci-dessus sont livrés ou explicitement déclarés
caducs par le responsable.

---

### INC-080 — Des garde-fous du chunk 3 sont périmés, et le rejeu séquentiel des harnais n'est pas un instrument de mesure valable

**Nature :** deux points distincts, mesurés le même jour. (1) des garde-fous figés par des unités
antérieures ont été rendus faux par une unité **ultérieure** qui ne les a pas révisés ; (2) les
harnais du dépôt **interfèrent entre eux** lorsqu'ils sont rejoués à la suite, au point qu'une
exécution séquentielle ne prouve plus rien.
**Relevé le :** 2026-08-07, pendant le rejeu de non-régression de `CRM-050`.

---

#### 1. Des garde-fous périmés, mesurés sur un état FROID

Ces trois-là ont été mesurés **immédiatement après un seed appliqué sur une base saine**, avant
tout rejeu de migration. Ils ne dépendent d'aucun ordre d'exécution :

| Harnais | Anomalies | Ce qui est figé | Ce que la base porte |
|---|---|---|---|
| `scripts/verify-authz.sh` | 3 | `admin` et `bizdev` voient `4/6/9`, `viewer` voit `3/4/4` | `4/6/14` et `3/4/8` |
| `scripts/verify-cards.sh` | 6 | « état du seed : `9/1/1/9` » | `14/1/1/14` |
| `scripts/verify-board.sh` | 4 | `grands-comptes` porte 3 cards actives, occupant 2 étapes | 4 cards actives, 3 étapes |
| `scripts/verify-preuves-refus.sh` | 2 | 41 politiques, 9 cards | 45 politiques, 14 cards |

`verify-authz.sh` et `verify-preuves-refus.sh` ont été **re-mesurés après destruction complète du
cluster et des volumes**, migrations rejouées et seed réappliqué : ils rendent respectivement 3 et
2 anomalies, les mêmes. Le point est donc établi, et non déduit.

`git log` donne la chronologie : `verify-authz.sh` n'a pas été touché depuis la reprise de
`CRM-010` (commit `011ac2e`), et `CRM-046` — le jeu de démonstration complet, **quatorze cards** là
où le seed socle en portait neuf — est venu **après**.

**Un écart n'est pas un compteur, et ne se corrige pas en changeant un nombre :**

- `scripts/verify-commentaires.sh` cherche `webapp/src/app/PanneauCommentaires.tsx` et son test.
  **Ces deux fichiers n'existent plus** : `CRM-044` (commit `2575b89`) les a supprimés en fondant
  le panneau des commentaires dans `PanneauTimeline.tsx`. Le harnais de `CRM-043` désigne donc un
  composant que l'unité suivante a dissous, et personne ne l'a suivi.
- `verify-board.sh`, `verify-liste.sh`, `verify-formulaire.sh` et `verify-webapp.sh` rendent
  « des classes citées n'existent pas dans le CSS produit ». Ce contrôle ne parle d'aucun volume de
  seed : il compare des classes utilitaires citées par le harnais au CSS réellement engendré par le
  build.

**Cause établie et correction décidée — décision 267.** La mesure du CSS produit sépare trois
défauts réels d'un défaut du contrôleur :

- `text-muted` et `placeholder:text-muted` demandent un jeton `muted` qui n'existe pas dans la
  palette fermée ; le jeton sémantique existant est `text-3` ;
- `sm:hidden` et `sm:inline` demandent un palier `sm` que le design system ne déclare pas ; le
  premier palier autorisé est `md` ;
- `before:content-['·']` est bien engendrée dans le CSS, mais le contrôleur n'échappe pas
  l'apostrophe comme Tailwind dans son sélecteur ;
- le contrôle des attributs visibles emploie en outre la plage non portable `À-ÿ`, que le `grep`
  de l'environnement refuse avec `Invalid collation character`.

Les composants passent aux jetons et paliers existants ; le contrôleur apprend l'échappement de
l'apostrophe et emploie la classe POSIX `[[:alpha:]]`. La non-complaisance qui injecte une classe
hors échelle reste obligatoire : le correctif ne peut donc pas rendre le garde-fou permissif.

#### 2. Le rejeu séquentiel des harnais dégrade l'environnement qu'il mesure

**MESURÉ, et c'est le point le plus important de cette entrée.** Vingt-six harnais ont été rejoués
à la suite. À l'issue du rejeu, `p2enjoy-migrations` était **`exited (3)`**, sur :

```
psql:/migrations/0005_workflow_nodes_catalog.sql:175: ERROR:  deadlock detected
DETAIL:  Process 35645 waits for AccessExclusiveLock … blocked by process 35647.
```

Plusieurs harnais rejouent des migrations, réappliquent le seed ou dégradent la base pour éprouver
leur propre non-complaisance. Enchaînés, ils se marchent dessus : un harnais restaure un état que
le suivant a déjà changé.

**La preuve que ce n'est pas une théorie :** `scripts/verify-seed-demo.sh` rend **2 anomalies**
pendant le rejeu séquentiel, et **62 contrôles, aucune anomalie** lorsqu'il est exécuté seul sur un
état froid. Ses deux anomalies n'existaient pas ; elles ont été **fabriquées par le rejeu**.
`verify-preuves-refus.sh`, lui, passe de 4 anomalies en séquence à **2** sur un état froid : deux
réelles, deux fabriquées.

**Conséquence directe** : le tableau de vingt-six lignes produit par une exécution séquentielle
n'est **pas** une mesure de l'état du dépôt, et ne doit pas être lu comme telle. Les livraisons
antérieures qui annoncent « les vingt-trois harnais rejoués » l'ont probablement fait dans les
mêmes conditions.

**Ce qui reste à arbitrer :**

1. **Réviser les garde-fous périmés** — trois lignes de volumes, plus le chemin du composant
   dissous par `CRM-044`. Mécanique, mais appartenant à quatre unités antérieures.
2. ~~**Établir la cause des classes CSS absentes**~~ — **résolu par la décision 267** ; les causes
   sont distinguées ci-dessus et leur correction est portée par le rejeu du harnais webapp.
3. **Décider ce qu'est un rejeu de non-régression valable.** Soit chaque harnais est rendu
   réellement indépendant — base recréée avant chacun —, soit le dépôt cesse de promettre un rejeu
   global et nomme l'ordre, le coût et les précautions d'un balayage. L'état actuel donne une
   couleur rouge à des harnais sains et une confiance imméritée à un balayage vert.

**Ce que ce n'est pas.** Aucun de ces points ne vient de `CRM-050`, qui ne touche ni table, ni
politique, ni seed de la base. Vérifié après reconstruction complète : cluster détruit, volumes
détruits, migrations rejouées (`p2enjoy-migrations` `exited (0)`), seed réappliqué — la base porte
14 cards et 45 politiques, `npm run test:sql` rend **1405 assertions sans anomalie**,
`npm run test:unit` **488 tests**, `npm run e2e:mail` **16 scénarios**, et
`scripts/verify-mail-infra.sh` **72 contrôles sans anomalie**.

**Lié à :** `CRM-046` (l'unité qui a changé les volumes), `CRM-043` et `CRM-044` (le composant
dissous), `CRM-010`, `CRM-040`, `CRM-041`, `CRM-014` (les unités qui portent les garde-fous),
INC-055 (un harnais qui rejoue sa migration laisse la base dans un état que le runner ne produit
jamais), INC-058 (une assertion qui compte une donnée qu'un autre harnais fait varier pendant
qu'il l'exécute), INC-078 (même motif : une omission consignée plutôt que refermée au passage).

## Clos — reprise de `CRM-050` le 2026-08-07

### INC-079 — La console d'administration de Stalwart ne peut pas s'installer dans l'environnement de la routine — **CLOSE**

**Arbitrage rendu — `docs/JOURNAL.md`, décision 257.** Fermée par le même arbitrage qu'INC-044 : lecture de `/proc/net/tcp` en dernier recours, rattachée à `CRM-002`, prouvée dans les deux sens.

**Nature :** dépendance réseau d'une image épinglée, non satisfaite par l'environnement
d'exécution ; le composant démarre malgré tout.
**Relevé le :** 2026-08-07, pendant la spécification de `CRM-050`.

**MESURÉ.** Au premier démarrage, `stalwartlabs/stalwart:v0.13.4` tente de dépaqueter sa console
web ; ne la trouvant pas dans l'image, il la télécharge depuis
`https://github.com/stalwartlabs/webadmin/releases/latest/download/webadmin.zip`. Derrière le
proxy de la routine, la requête échoue et **deux lignes `ERROR`** sont écrites à chaque
démarrage :

```
ERROR Resource error … details = "Failed to unpack webadmin bundle"
ERROR Configuration build error … "Failed to download webadmin: … error sending request"
```

**Ce qui n'est pas cassé.** Le serveur démarre, ouvre ses quatre listeners, authentifie, remet et
sert IMAP. L'API de gestion `/api/*` — celle dont le provisionnement se sert — répond
normalement : c'est la **console web** qui manque, pas l'API.

**Questions instruites avant correction :**

1. **Faut-il une console d'administration du serveur mail de développement ?** Roundcube est
   l'outil de vérification visuelle retenu (`docs/SPEC-mail-subsystem.md` §11.5), et l'exploitation
   passe par l'API. La console n'a peut-être aucun usage dans ce projet — auquel cas la désactiver
   explicitement vaudrait mieux que de la laisser échouer.
2. **Deux lignes `ERROR` à chaque démarrage sont un bruit qui use.** Une exploitation qui apprend à
   ignorer un `ERROR` récurrent finit par ignorer le suivant. Si la console n'est pas voulue, ces
   lignes ne doivent pas exister.
3. **La dépendance n'est pas épinglée.** L'image télécharge `latest`. Sur un hôte au réseau ouvert,
   deux démarrages à deux dates peuvent donc installer deux consoles différentes, ce qui heurte
   `docs/DAT.md` §3.7 — « aucune image n'est suivie par un tag mouvant ». La règle vise les images ;
   elle ne dit rien d'un composant qu'une image va chercher elle-même au démarrage.

**Arbitrage retenu le 2026-08-07 — décision 245.** Le projet n'a pas
besoin de la console : Roundcube porte la vérification visuelle et `/api/*` l'exploitation. Le
premier démarrage doit importer, par le mécanisme natif de Stalwart, un petit bundle local
versionné qui explique ce choix.

**Clôture mesurée.** `./runDev.sh` a démarré un projet Docker jetable sur volume Stalwart neuf ;
l'API, IMAP, SMTP, Roundcube et ClamAV ont été exercés. Le bundle local est servi, Chromium rend la
page avec une console propre, et le journal Stalwart reste sans `ERROR` ni `WARN` **après** la
soumission SMTP réelle. `verify-mail-infra.sh` rend 84/84, `e2e:mail` 16/16. Les volumes normaux
n'ont pas été supprimés et la pile a été restaurée dessus.

**Lié à :** INC-032 et INC-042 (le même motif — une dépendance réseau que l'environnement de la
routine ne satisfait pas), `docs/DAT.md` §3.7, `CRM-050`.

## Ouverts — suite

### INC-078 — Quatre harnais de preuves du chunk 3 n'apparaissent dans aucune liste du README

**Nature :** référence manquante entre un fichier livré et le document qui l'inventorie.
**Relevé le :** 2026-08-06, pendant `CRM-047`, en ajoutant `scripts/verify-manual.sh` aux deux
listes du `README.md`.

Le `README.md` inventorie les harnais à deux endroits — la table des commandes du §5 et le bloc du
§7. **MESURÉ** : quatre scripts livrés par des unités du chunk 3 n'apparaissent ni dans l'un, ni
dans l'autre, ni dans `docs/DAT.md` :

| Harnais | Unité qui l'a livré |
|---|---|
| `scripts/verify-formulaire.sh` | `CRM-037` |
| `scripts/verify-commentaires.sh` | `CRM-043` |
| `scripts/verify-timeline.sh` | `CRM-044` |
| `scripts/verify-move-card-to-channel.sh` | `CRM-045` |

Les scripts existent, sont exécutables et sont cités par leur unité de backlog : rien n'est cassé.
Ce qui manque est le **chemin de découverte** — une personne qui lit le `README.md` pour savoir
quelles preuves rejouer en manquera quatre, et croira l'inventaire complet parce qu'il en liste
vingt autres.

**Non résolue ici, et le motif est explicite.** `CRM-047` porte le manuel utilisateur, pas le
`README.md`, et compléter quatre lignes appartenant à quatre autres unités mêlerait quatre sujets
dans un commit qui n'en traite qu'un (`CLAUDE.md` §1 et §13). L'omission est donc **consignée**
plutôt que refermée au passage. Elle se corrige en quatre lignes, dans un changement qui lui est
propre.

**Lié à :** `CRM-037`, `CRM-043`, `CRM-044`, `CRM-045`, `README.md` §5 et §7.

### INC-077 — Le neuvième type d'événement est écrit par le produit et n'a aucun libellé dans le fil

**Nature :** écart entre un type d'événement livré et prouvé côté serveur, et ce que l'interface
sait en dire.
**Relevé le :** 2026-08-06, pendant la spécification de `CRM-047`.

`card_events.type` admet **neuf** valeurs, la contrainte de la table les énumère :

```
'created', 'moved', 'assigned', 'channel_changed', 'archived', 'unarchived', 'trashed',
'restored', 'field_changed'
```

`webapp/src/app/PanneauTimeline.tsx` en déclare **huit**. `channel_changed` — le type écrit par
`CRM-045` lorsqu'une affaire change de dossier — n'y figure pas.

**MESURÉ le 2026-08-06, sur la base réelle :**

| Type | Lignes |
|---|---|
| `created` | 14 |
| `field_changed` | 35 |
| `moved` | 18 |
| `assigned` | 2 |
| **`channel_changed`** | **2** |
| `archived` | 1 |
| `unarchived` | 1 |

Le type n'est donc pas théorique : le jeu de démonstration en porte deux lignes. Le fil les affiche,
et les affiche sous le libellé de repli `timeline.event.unknown` — **« Événement »**. Le lecteur
voit qu'un fait a eu lieu, et n'apprend pas lequel.

**Le repli n'est pas en cause.** Il est délibéré (`docs/DESIGN_SYSTEM.md` §5.11 : « aucun
`undefined` n'atteint l'écran », « un libellé non résolu n'est pas une phrase tronquée »). Il est
fait pour un type inconnu du client — pas pour un type que le produit écrit lui-même.

**Constat associé, observé sur la capture** `docs/captures/CRM-047/manuel-evenement-sans-nom-1440.jpg` :
le repli emprunte l'icône `Sparkles`, celle de `created`. Sa pastille reste neutre (`--color-hover`)
là où `created` porte le vert, de sorte que les deux ne se confondent pas — mais l'icône, elle, est
partagée. Le point est consigné avec le reste, non traité séparément : il disparaîtra avec le
libellé, ou il devra être tranché avec lui.

**Ce que trois documents disent, et qui ne s'accorde pas :**

| Document | Ce qu'il dit |
|---|---|
| `docs/manual.md` ch. 7 *bis* (écrit par `CRM-045`) | « Le déplacement laisse une trace *changement de dossier* dans l'historique » |
| `docs/DESIGN_SYSTEM.md` §5.11 | table des familles : `moved` → Étapes, `field_changed` → Champs, six types → Cycle de vie. **`channel_changed` n'y est pas** |
| `webapp/src/app/PanneauTimeline.tsx` | huit types, repli générique pour le neuvième |

**Trois questions, aucune tranchée** — et elles ne relèvent pas d'une unité documentaire :

1. quel **libellé** ? « Dossier changé » dirait le fait ; « Rangée dans <channel> » exigerait de
   résoudre un nom de channel que le fil ne charge pas aujourd'hui ;
2. quelle **famille de filtre** ? Ce n'est ni une prise de parole, ni un franchissement d'étape, ni
   un changement de champ. « Cycle de vie » l'accueillerait par défaut, ce qui ferait passer un
   rangement pour un événement de cycle de vie ;
3. quelle **pastille** ? Le §5.11 attribue une couleur par famille ; en ajouter une engage la règle,
   pas seulement une icône.

**Conséquence retenue en attendant l'arbitrage :** le comportement est **inchangé**, et
`docs/manual.md` cesse d'annoncer un libellé qui n'existe pas — il décrit ce que le fil montre
réellement. `e2e/ui/manuel.spec.ts` **mesure** ce rendu plutôt que de le déduire, de sorte que le
jour où un libellé sera livré, la preuve deviendra rouge et forcera la mise à jour du manuel.

**Lié à :** `CRM-045` (l'unité qui écrit le type), `CRM-044` (l'unité qui rend le fil), INC-021
(aucun écran de connexion, donc aucun parcours réel n'atteint le fil), `docs/JOURNAL.md`
décision 232.

### INC-075 — Un channel consenti par le backend est inatteignable par la navigation du produit

**Nature :** écart entre une règle d'autorisation livrée et prouvée, et le parcours réellement
possible dans l'interface.
**Relevé le :** 2026-08-06, pendant la spécification de `CRM-046`.

`docs/SPEC-permissions-rls.md` §3, ligne **f**, déclare — et `CRM-012` a livré — qu'un
`channel_members.access = 'member'` posé **sous un track fermé** rouvre le channel : « le plus
spécifique gagne », dans le sens contre-intuitif. INC-030 a été close sur cette mesure.

Le seed exerce précisément ce cas : le `viewer` Farida Nowak porte `track_members.access = 'none'`
sur `conseil-ia` **et** `channel_members.access = 'member'` sur `prospection`.

**MESURÉ le 2026-08-06, avec le jeton réel du `viewer` :**

| Lecture | Résultat |
|---|---|
| `GET /rest/v1/tracks` | `studio-web`, `formation`, `pipeline-2024` — **`conseil-ia` absent** |
| `GET /rest/v1/channels` | `refonte`, `inter-entreprises`, **`prospection`**, `maintenance` |

Le channel lui est donc bien consenti. Mais la coquille livrée par `CRM-021` résout le track
**avant** ses channels — `lireTrackParSlug` filtre sur le slug puis `lireChannels` filtre sur
`track_id` (`webapp/src/lib/channels.ts`). La route `/tracks/conseil-ia/prospection` rend donc
« Track introuvable » à ce profil, et aucune barre latérale ne propose `conseil-ia`. **Le droit
existe côté serveur et n'a aucun chemin côté produit.**

**Ce que ce n'est pas :** ni un défaut de RLS — la politique fait exactement ce que le §3 prescrit
—, ni un défaut d'affichage — l'interface reflète fidèlement ce que `tracks` lui rend.

**Trois issues, aucune tranchée ici :**

1. **La politique des tracks s'élargit** : un track redevient lisible dès qu'un de ses channels
   l'est. Le « plus spécifique gagne » deviendrait alors transitif, ce qui touche `CRM-012` et la
   matrice à 64 combinaisons de `CRM-010`.
2. **La coquille cesse de passer par le track** : une route de channel qui résout le channel
   d'abord. Cela engage `CRM-021` et la composition de la barre d'onglets.
3. **Le cas est déclaré non pertinent** : un droit fin de channel sous un track fermé n'est pas un
   parcours produit, et la ligne f ne décrit qu'une propriété de la fonction d'autorisation. Il
   faudrait alors le dire dans `docs/SPEC-permissions-rls.md` §3, qui aujourd'hui ne le dit pas.

**Comportement retenu en attendant l'arbitrage :** aucun. `CRM-046` **mesure** le cas et le fige
par une preuve — le `viewer` lit bien les cards de `prospection` par son jeton, et ne lit pas son
track —, sans rien changer ni à la politique ni à la coquille (`docs/SPEC-seed.md` §9.7).

**Action attendue du responsable :** trancher entre les trois issues.

**Lié à :** INC-030 (close, dont la mesure de clôture est l'origine de ce point), INC-024, INC-021
(aucun écran de connexion, donc aucun parcours réel pour l'observer), `docs/SPEC-permissions-rls.md`
§3 ligne f, `docs/SPEC-seed.md` §9.7.
### INC-076 — Supprimer un compte est devenu impossible dès qu'il a commenté, et trois preuves du seed le constatent sans le nommer

**Nature :** régression de contrat entre deux unités, mesurée. **Antérieure à `CRM-045`**, relevée
par son balayage de non-régression.
**Relevée le :** 2026-08-06.

`CRM-011` a livré, et sa Definition of Done l'inscrit noir sur blanc : « **Suppression du compte**
par l'API d'administration : aucun profil orphelin (cascade) ». `docs/JOURNAL.md` le confirme —
« compte supprimé sans profil orphelin ».

`CRM-043` a ensuite livré `public.card_comments` avec :

```sql
author_id uuid not null default auth.uid() references public.profiles (id)
```

**Sans aucune action `ON DELETE`**, là où les cinq autres clés vers `profiles` du schéma portent
toutes `ON DELETE SET NULL` — `cards.owner_id`, `cards.created_by`, `card_field_values.updated_by`,
`card_events.actor_id`. MESURÉ le 2026-08-06, sur la pile réelle, avec la clé de service :

```
DELETE /auth/v1/admin/users/<bizdev>   →   HTTP 500
{"code":"23503","message":"update or delete on table \"profiles\" violates foreign key
 constraint \"card_comments_author_id_fkey\" on table \"card_comments\"",
 "detail":"Key is still referenced from table \"card_comments\"."}
```

Le seed fait de `bizdev@p2enjoy.test` l'auteur de **deux** commentaires : le compte est donc
indestructible sur toute base seedée.

**Trois contrôles de `scripts/verify-seed.sh` échouent en conséquence**, et ils échouaient déjà
avant `CRM-045` — le script n'a pas été modifié depuis `CRM-005` :

```
ECHEC  mutation non appliquée : le compte est toujours présent, la suite ne prouverait rien
ECHEC  le compte supprimé se connecte encore : la preuve n° 5 est complaisante
ECHEC  un profil orphelin subsiste pour le compte détruit
```

Le troisième message est trompeur, et il vaut d'être relevé : le profil « subsiste » non parce que
la cascade a échoué, mais parce que **la suppression n'a jamais eu lieu**. Le harnais rapporte un
symptôme pour une cause.

**Ce n'est pas seulement un défaut de preuve, c'est une règle de produit que personne n'a
décidée** : un utilisateur qui a écrit un commentaire ne peut plus être supprimé. Sur un produit
qui traite des données personnelles, cela heurte `CLAUDE.md` §11 — un droit à l'effacement que le
schéma rend inexécutable.

**Comportement laissé INCHANGÉ.** La colonne appartient à `CRM-043`, unité `[~]`, et la Definition
of Done qu'elle contredit appartient à `CRM-011`, unité `[~]` elle aussi. La corriger depuis
`CRM-045` reviendrait à rouvrir deux unités pendant un passage consacré à une troisième, ce que
`CLAUDE.md` §13 interdit — et le choix n'est pas mécanique : `author_id` est `not null`, donc
`ON DELETE SET NULL` **ne s'applique pas en l'état**.

**Arbitrage attendu du responsable.** Trois options, et aucune n'est neutre :

1. **rendre `author_id` nullable** et poser `ON DELETE SET NULL`, comme les cinq autres clés vers
   `profiles`. Un commentaire survivrait à son auteur, anonyme — cohérent avec `CRM-044`, dont
   `actor_id` fait déjà exactement cela, et avec la pierre tombale du §13.4 ;
2. **poser `ON DELETE CASCADE`** : supprimer un compte effacerait ses commentaires. Cohérent avec
   un droit à l'effacement, incohérent avec un fil de discussion dont des réponses perdraient leur
   contexte ;
3. **assumer la règle** — un auteur de commentaire n'est pas supprimable — et l'inscrire dans
   `docs/SPEC-cards.md` §13 ainsi que dans la Definition of Done de `CRM-011`, qui affirme
   aujourd'hui le contraire. Il faudrait alors traiter séparément la question du RGPD.

**Lié à :** `CRM-011` (Definition of Done contredite), `CRM-043` (la colonne), `CRM-044`
(`card_events.actor_id`, qui a tranché la même question dans l'autre sens), `CLAUDE.md` §11.

---

### INC-074 — La convergence d'INC-035 ne sait pas exprimer une définition qui avance avec les migrations

**Nature :** limite structurelle d'un mécanisme du dépôt, mesurée.
**Relevée le :** 2026-08-06, pendant `CRM-045`, par le balayage de non-régression.

Le remède d'INC-035 — `converger_contrainte`, repris par les migrations 11, 13, 15, 16 et 17 —
REMPLACE une contrainte dont la définition diffère de celle que le fichier déclare. Il rend le
dépôt convergent, et non seulement idempotent : un objet altéré à la main est réparé au prochain
démarrage.

Il suppose en revanche qu'**un seul fichier fasse autorité** sur un objet donné. Dès que deux
migrations déclarent des définitions différentes de la même contrainte, le `migrations-runner` —
qui rejoue tout le répertoire dans l'ordre à chaque démarrage — les fait se contredire à chaque
passage. Le cas s'est présenté pour la première fois avec `CRM-045`, qui étend à neuf valeurs le
`CHECK` de `card_events` créé à huit par `CRM-044` :

```
ERROR: check constraint "card_events_type_check" of relation "card_events"
       is violated by some row
migrations-runner : code de sortie 3
```

**Ce qui rend le cas pernicieux :** sur une base NEUVE, les migrations tournent avant le seed, aucune
ligne n'existe, et le rétrécissement passe sans erreur. Le défaut n'apparaît qu'au **deuxième**
démarrage, ou sur toute base déjà seedée. Aucune suite pgTAP, aucune preuve d'API et aucun harnais
dédié ne pouvait le voir : tous s'exécutent contre une base déjà migrée.

**Comportement retenu pour ce cas — décision 219 :** l'autorité sur le vocabulaire passe à la
dernière migration qui l'étend. La 16 crée si absent, la 17 converge. Aucune garantie n'est perdue,
elle change de fichier. La correction est **locale**, et c'est pourquoi elle n'attend pas
d'arbitrage : la pile ne redémarrait plus.

**Ce qui reste à arbitrer, et qui dépasse cette unité.** La règle « la dernière migration qui étend
un objet en devient responsable » n'est écrite nulle part comme convention du dépôt. Elle est
tenue ici par des commentaires dans deux fichiers, et rien ne la vérifie. Trois issues :

1. **l'inscrire comme convention** dans `docs/SCHEMA.md` ou `docs/MASTER_PLAN.md` §3, et ajouter au
   harnais un contrôle qui dénonce deux migrations déclarant la même contrainte nommée ;
2. **doter le mécanisme d'une expression du cumul** — un helper qui ÉLARGIT une énumération au lieu
   de la remplacer —, ce qui traiterait les `CHECK` de vocabulaire mais pas les autres contraintes ;
3. **rejouer les migrations dans l'ordre inverse pour la convergence**, ce qui rendrait la dernière
   déclaration gagnante par construction — au prix d'un runner beaucoup moins lisible.

**Un contrôle manque, quelle que soit l'issue :** aucun harnais du dépôt ne rejoue le
`migrations-runner` **sur une base seedée**. `scripts/verify-authz.sh` le fait par effet de bord, et
c'est lui qui a trouvé ce défaut ; `scripts/verify-migrations.sh`, dont c'est pourtant l'objet, ne
l'a pas vu.

**Lié à :** INC-035 (la convergence des clés étrangères, dont ce mécanisme est né), INC-056 (un
défaut que seule une base froide pouvait révéler — celui-ci est l'exact symétrique : seule une base
CHAUDE le révèle), `docs/JOURNAL.md` décision 219.

---

### INC-073 — `docs/SCHEMA.md` §9 et `docs/SPEC-workflow-engine.md` §6 décrivent deux fonctions différentes sous le même nom

**Arbitrage rendu — `docs/JOURNAL.md`, décision 263.** Le paramètre `step_mapping` du `docs/SCHEMA.md` §9 désignait bien une **seconde fonction**, désormais nommée `change_channel_workflow`. Mise en œuvre : `CRM-019`.

**Nature :** contradiction entre spécifications, sur la signature d'une fonction.
**Relevée le :** 2026-08-06, pendant la spécification de `CRM-045`.

Les deux documents nomment `move_card_to_channel`, et n'en décrivent pas la même.

| Source | Ce qu'elle annonce |
|---|---|
| `docs/SCHEMA.md` §9 | `move_card_to_channel(card_id, channel_id, **step_mapping**)` — « changement de channel avec remappage explicite **des étapes** » |
| `docs/SPEC-workflow-engine.md` §6 | « l'appelant fournit **l'étape** de destination », au singulier, pour **une** card |

`step_mapping` — au singulier grammatical mais désignant une *correspondance* — et « remappage des
**étapes** », au pluriel, annoncent une table de correspondance : plusieurs étapes remappées en un
appel. C'est la forme qu'aurait une fonction de déplacement **en lot**, ou une fonction qui
changerait le workflow d'un channel entier en remappant l'étape de chacune de ses cards — soit
précisément l'option 2 de l'arbitrage d'**INC-046**, qui n'est rattachée à aucune unité.

Le §6 décrit l'autre fonction : **une** card, **une** étape de destination. Sa Definition of Done au
backlog dit de même — « `move_card_to_channel` avec remappage explicite », et la preuve attendue est
« remappage obligatoire », au singulier.

**Comportement retenu — la lecture du §6**, et le motif est qu'elle est la plus faible : une
fonction qui déplace une card ne préempte aucune décision, là où une fonction de lot trancherait
INC-046 par implémentation plutôt que par arbitrage. Le paramètre est donc nommé `to_step_id`, par
symétrie avec `move_card(card_id, **to_step_id**, comment)` livrée par `CRM-034`.

**Ce qui a été corrigé :** la ligne de `docs/SCHEMA.md` §9, seule des deux sources à porter la
signature minoritaire — la laisser ferait mentir le document de schéma sur une fonction livrée.

**Ce qui reste à arbitrer :** si `step_mapping` exprimait bien l'intention d'un déplacement en lot,
alors cette capacité **n'est portée par aucune unité du backlog**, et son absence n'était jusqu'ici
visible que dans le nom d'un paramètre. Deux issues : confirmer que `CRM-045` livre le geste unitaire
et que le lot n'est pas au périmètre ; ou ouvrir l'unité qui le porte, auquel cas elle rejoindrait
naturellement l'option 2 d'INC-046 dont elle est la forme générale.

**Lié à :** INC-046 (le changement de workflow d'un channel peuplé, dont le lot serait la solution),
`docs/SPEC-workflow-engine.md` §6.2 et §6.10, `docs/SCHEMA.md` §9.

---

### INC-071 — Trois documents se contredisent sur ce qu'il faut pour commenter une card

**Nature :** contradiction entre spécifications, sur une règle d'autorisation.
**Relevée le :** 2026-08-05, pendant `CRM-043`.

| Source | Ce qu'elle exige pour écrire un commentaire |
|---|---|
| `docs/SCHEMA.md` §5 | « Tout membre pouvant **lire** la card peut commenter : c'est la règle demandée » |
| `docs/SPEC-permissions-rls.md` §4 | « **Écriture** sur le channel » |
| `docs/BACKLOG.md`, `CRM-043` | Énoncé : « tout membre pouvant lire la card ». **Definition of Done : « API (refus pour un `viewer`) »** |

L'énoncé de backlog **se contredit lui-même** : un `viewer` peut lire une card — le seed le démontre
sur `…0c5` —, et la preuve exigée par sa propre Definition of Done est celle de son **refus**.

**Comportement retenu — le droit d'ÉCRITURE** (`app.can_write_card`), motivé au §13.6 de
`docs/SPEC-cards.md` et à la décision 192 du journal : deux sources concordantes contre une, dont
l'une est la Definition of Done ; et le §2.1 de `docs/SPEC-permissions-rls.md` définit le `viewer`
comme « consulte, **sans aucune écriture** », invariant qu'aucune table n'est autorisée à percer.

**Ce qui a été corrigé :** la phrase de `docs/SCHEMA.md` §5, seule des trois sources à porter la
règle minoritaire — la laisser ferait mentir le document de schéma sur une table qu'il décrit.

**Ce qui reste à arbitrer :** l'**énoncé** de `CRM-043` dans `docs/BACKLOG.md` porte toujours la
formulation corrigée, à côté d'une Definition of Done qui la contredit. Le réécrire serait réécrire
la demande du responsable, ce qu'aucune unité ne fait d'elle-même. Deux issues possibles : corriger
l'énoncé pour qu'il dise « tout membre pouvant écrire sur le channel », ou — si la lecture littérale
était bien l'intention — rouvrir la règle, ce qui suppose alors de retirer de la Definition of Done
la preuve du refus opposé au `viewer`, et d'accepter qu'un rôle défini « sans aucune écriture »
écrive.

---

### INC-072 — La modération des commentaires est ouverte aux `admin` par un document, à personne par l'autre

**Nature :** contradiction entre spécifications, sur l'étendue d'un droit.
**Relevée le :** 2026-08-05, pendant `CRM-043`.

`docs/SPEC-permissions-rls.md` §4 réserve la modification et la suppression d'un commentaire « à
l'auteur **et aux `admin`** ». L'énoncé de `CRM-043` dans `docs/BACKLOG.md` ne mentionne que
l'auteur : « édition et suppression par l'auteur ».

**Comportement retenu — l'auteur seul**, c'est-à-dire l'**intersection** des deux énoncés (décision
194). Elle n'ouvre rien que l'une ou l'autre source refuse, là où le sur-ensemble donnerait un
pouvoir qu'un des deux documents ne donne pas. Le choix a un fond, et il n'est pas seulement
prudentiel : **modifier** le commentaire d'autrui n'est pas de la modération mais une falsification
— un administrateur pourrait faire dire à un commercial l'inverse de ce qu'il a écrit, sans autre
trace que `edited_at`, et aucun document ne demande cela.

**Conséquence nommée, non masquée :** aucun modérateur ne peut retirer un commentaire déplacé.

**Ce qui reste à arbitrer :** faut-il ouvrir la **suppression** aux `admin`, sans la modification ?
Rien n'est à défaire pour l'ajouter — une politique `UPDATE` supplémentaire, restreinte à
`deleted_at`, suffirait —, mais la décision appartient au responsable : elle donne à un rôle le
pouvoir de faire disparaître la parole d'un autre.

---

### INC-070 — Le contrôle de textes en dur lit la queue d'un ternaire comme un nœud de texte

**Nature :** faux positif d'un contrôle du dépôt, reproductible.
**Relevé le :** 2026-08-05, pendant `CRM-042`.

`webapp/src/i18n/i18n.test.ts` interdit tout texte visible écrit en dur dans un composant
(`docs/DESIGN_SYSTEM.md` §10). Il repère les nœuds de texte d'un JSX par une expression régulière.
MESURÉ : l'affectation

```tsx
const etatVide = totalFiltre > 0 ? undefined : (
```

lui fait rendre le littéral `0 ? undefined : (` comme un texte visible, et le test **échoue**. Le
fragment n'est pas un texte : c'est la queue d'une condition, suivie d'une parenthèse ouvrante de
JSX.

Une observation voisine avait été portée par la seconde exécution de `CRM-041` puis écartée, au
motif qu'aucun fichier de `main` ne portait la forme incriminée — un autre motif, une signature
`=> Promise<…>` (`docs/JOURNAL.md`, décision 182). **Cette occurrence-ci est reproductible sur
`main`**, et le motif est différent.

**Comportement retenu : aucun changement du contrôle.** `CRM-042` a réécrit l'affectation en `if`,
qui est de toute façon la forme la plus lisible des deux, et le motif est écrit dans le code. Élargir
l'expression régulière d'un contrôle de qualité **sans mesure de ce qu'elle cesserait d'attraper**
serait affaiblir une garde pour accommoder une écriture : le contraire de ce que `CLAUDE.md` §18
demande.

**Ce qui reste à arbitrer :** le contrôle repose sur une expression régulière là où il faudrait un
analyseur de JSX. Le remplacer est une décision d'outillage, et son coût — une dépendance
d'analyse syntaxique — dépasse le périmètre d'une unité de chunk 3. Tant qu'il n'est pas rendu, la
règle pratique est : **pas de ternaire dont la branche est un fragment JSX ouvert par `(`** dans un
composant.

---

### INC-069 — Deux décisions du journal portent le même numéro 180

**Arbitrage rendu — `docs/JOURNAL.md`, décision 258.** **Suffixer les titres — `180 a` et `180 b` — et ne renuméroter ni l'une ni l'autre**, puisque les deux sont citées. La cause est traitée ailleurs : la routine est sérialisée.

**Nature :** collision d'identifiants dans un document dont les numéros servent de références
croisées.
**Relevé le :** 2026-08-05, au début de `CRM-042`, en rebasant sur `main`.

`docs/JOURNAL.md` porte **deux** entrées « Décision 180 » :

- « Une seconde exécution de la routine a livré `CRM-041` en parallèle, et elle abandonne son
  implémentation », poussée par le commit `16cb2ee` ;
- « `t` accepte des paramètres, parce que le §7.5 exige une phrase et interdit de la construire »,
  poussée par le commit `13da2b7`.

Les deux commits sont l'œuvre de **deux exécutions concurrentes de la même routine**, chacune ayant
lu le numéro le plus élevé avant que l'autre ne pousse le sien. C'est la conséquence directe
d'INC-059 et du point 1 d'INC-034 : rien dans le dépôt ne sérialise les exécutions, et le journal
est un fichier que toutes appendent par la fin.

**La collision n'est pas théorique** : `docs/BACKLOG.md` et `CHANGELOG.md` citent « décision 180 »
pour désigner l'écart au §7.5, tandis que `docs/JOURNAL.md` §`CRM-041` cite le même numéro pour
l'arbitrage des exécutions parallèles. Un lecteur qui suit la référence tombe sur l'une ou l'autre
selon l'ordre de lecture.

**Comportement retenu : aucun.** Renuméroter une entrée déjà poussée casserait les références qui
la citent, et les deux sont citées. `CRM-042` a **décalé ses propres décisions à 183–188** pour ne
pas aggraver la collision, et la consigne ici plutôt que de la résoudre implicitement.

**Ce qui reste à arbitrer :**

1. **La numérotation.** Soit les décisions cessent d'être numérotées par un compteur global —
   un identifiant dérivé de l'unité, `CRM-041/3` par exemple, ne collisionne pas —, soit la routine
   se resynchronise **immédiatement avant** d'écrire son numéro, ce qui réduit la fenêtre sans la
   fermer.
2. **Les deux entrées 180 elles-mêmes.** Les renuméroter suppose de reprendre les références de
   `docs/BACKLOG.md` et de `CHANGELOG.md` dans le même changement. C'est un geste sur du travail
   déjà poussé, qui relève du responsable.

---

### INC-068 — Les pastilles d'étiquettes sont prescrites par le design system et n'ont ni table ni unité

**Nature :** unité manquante ; un contenu d'interface prescrit sans porteur, ni côté schéma ni côté
backlog.
**Relevé le :** 2026-08-05, en relisant `CRM-041` contre le §5.1 du design system.

`docs/DESIGN_SYSTEM.md` §5.1 énumère depuis `CRM-000` le contenu d'une carte de card : « titre
(2 lignes maximum, ellipse), **pastilles d'étiquettes**, avatar du responsable, montant si
renseigné, indicateur de prochaine action, et pastille d'ancienneté dans l'étape ».

**Constat, mesuré sur le schéma et sur le backlog.** `docs/SCHEMA.md` ne déclare **aucune** table
d'étiquettes, `public.cards` ne porte aucune colonne qui en tienne lieu, et aucune unité de
`docs/MASTER_PLAN.md` §2 n'en porte — ni dans le chunk 3, ni dans le chunk 4, ni dans les extensions
du chunk 5. Le mot n'apparaît nulle part ailleurs dans le dépôt que dans cette énumération et dans
les deux endroits où `CRM-041` constate son absence.

**Ce que cela ne met pas en cause.** Rien du comportement livré : une carte sans étiquette est
complète au sens de tout ce que la donnée permet. Le manque est d'**affichage**, pas d'intégrité.

**Pourquoi c'est distinct de l'avatar du responsable, avec lequel le §7.4 le range.** L'avatar manque
pour une raison **connue et déjà consignée** — `profiles` reste en refus par défaut, INC-014 : la
donnée existe et attend un arbitrage d'accès. Les étiquettes, elles, n'existent **nulle part** : ce
n'est pas un droit de lecture qui manque, c'est un modèle de données. Les deux ne se referment pas
par le même geste, et les ranger ensemble comme deux « absences » masque cette différence.

**Ce que `CRM-041` en a fait.** Elle a nommé l'absence au §7.4 de `docs/SPEC-workflow-engine.md` et
dans sa Definition of Done, ce qui est juste. Elle n'a pas relevé que la **prescription** du §5.1
reste sans porteur — c'est l'objet de cette entrée. La phrase du §5.1 est conservée intacte.

**Arbitrage attendu du responsable.** Trois options :

1. créer une unité « étiquettes » dans le chunk 5 — table, politiques d'accès, seed, et rendu sur la
   carte —, et lui rattacher la phrase ;
2. retirer les étiquettes du §5.1, en actant que la couleur du nœud et le libellé de colonne
   suffisent à qualifier une affaire ;
3. les remplacer par une donnée déjà présente que la carte pourrait afficher en pastille — la
   probabilité de l'étape, par exemple —, ce qui changerait l'intention du §5.1 et doit donc être
   décidé, non déduit.

**Lié à :** INC-066 (même motif : une règle d'interface sans porteur), INC-014 (l'avatar, motif
différent), `docs/DESIGN_SYSTEM.md` §5.1, `docs/SPEC-workflow-engine.md` §7.4.

---

### INC-067 — Trois sources décrivent `cards.amount` de deux façons, et le cumul du board dépend de celle qui a raison

**Nature :** contradiction entre deux déclarations du dépôt ; comportement inchangé.
**Relevé le :** 2026-08-05, pendant la vérification de `CRM-041`.

| Source | Ce qu'elle déclare |
|---|---|
| `webapp/src/lib/database.types.ts`, **engendré** | `amount: number \| null` |
| `e2e/api/cards.spec.ts` ligne 87, écrit à `CRM-040` | `amount: string \| null` |
| **la pile réelle, MESURÉE** | `{"amount":48000.00}` — un **nombre** JSON |

`GET /rest/v1/cards?select=id,amount&id=eq.…0000c1` avec le jeton réel de l'administratrice rend
`48000.00`, non `"48000.00"`. Le type engendré a donc raison, et la preuve d'API de `CRM-040` porte
une déclaration défensive que la pile ne justifie pas.

**Pourquoi cela cesse d'être anodin avec `CRM-041`.** `webapp/src/lib/board.ts` additionne les
montants d'une colonne sans conversion :

```ts
montant: avecMontant.reduce((total, card) => total + (card.amount ?? 0), 0),
```

En JavaScript, `0 + "48000.00"` rend `"048000.00"`. Si la représentation basculait un jour vers la
chaîne — changement de version de PostgREST, réglage de la pile, ou colonne migrée —, le cumul
**concaténerait en silence** et l'en-tête de colonne afficherait un nombre faux. Aucun test ne le
verrait : les preuves actuelles emploient des fixtures où `amount` est déjà un nombre.

**Ce qui n'est pas tranché.** Laquelle des deux déclarations doit être corrigée, et si la
représentation d'un `numeric` doit être **mesurée** plutôt que supposée. La question dépasse
`CRM-041` : elle touche `CRM-040` et toute lecture future d'une colonne `numeric`.
**Comportement inchangé, arbitrage demandé.**

**Options :**

1. corriger `e2e/api/cards.spec.ts` en `number | null` — la déclaration devient exacte, et la
   fragilité du cumul reste entière ;
2. convertir explicitement dans le cumul (`Number(card.amount)`), et écrire le motif — la garde
   tient les deux formes, au prix d'une conversion que la pile actuelle ne réclame pas ;
3. ajouter à `scripts/verify-cards.sh` un contrôle qui **mesure** la représentation rendue par la
   pile, de sorte qu'un basculement soit dénoncé au lieu d'être découvert sur un écran.

**Lié à :** `CRM-040` (`e2e/api/cards.spec.ts`), `CRM-041` (`webapp/src/lib/board.ts`, cumul du
§7.3), `docs/SPEC-types.md` (« un type ne garantit jamais une valeur »).

### INC-066 — L'éditeur de workflow est spécifié depuis `CRM-000` et n'est rattaché à aucune unité

**Nature :** unité manquante ; une règle du produit n'a aucun porteur.
**Relevé le :** 2026-08-05, pendant la spécification de `CRM-041`.

`docs/SPEC-workflow-engine.md` §7 énonce depuis `CRM-000` : « L'éditeur de workflow est réservé aux
administrateurs : sélection des nœuds, ordre, arêtes, surcharges, et champs de formulaire. » La
phrase décrit un **écran**, et elle prescrit une règle d'accès sur cet écran.

**Constat, mesuré sur le backlog et non supposé.** Sept unités ont livré la matière de cet éditeur
sans en livrer une ligne d'interface, et **chacune l'a nommé** dans sa Definition of Done :
`CRM-030` (catalogue de nœuds), `CRM-031` (workflows, étapes, transitions), `CRM-032` (copie vers un
track), `CRM-033` (cohérence workflow ↔ channel), `CRM-035` (définition des champs), `CRM-036`
(valeurs et validation), `CRM-037` (rendu du formulaire). Aucune unité `[ ]` de
`docs/MASTER_PLAN.md` §2 ne porte cet éditeur : `CRM-041` livre le board, `CRM-042` la vue liste,
`CRM-043` à `CRM-047` les commentaires, la timeline, le déplacement entre channels, le seed et le
manuel. Le chunk 5 ne le nomme pas davantage.

**Ce que cela ne met pas en cause.** Aucune règle d'autorisation ne manque côté serveur : les
politiques d'écriture des cinq tables concernées réservent déjà la modification aux administrateurs
du workspace, et elles sont prouvées hors interface. L'écran absent ne relâche rien ; il empêche
seulement qu'un administrateur configure son produit autrement que par l'API.

**Ce que `CRM-041` fait de cette phrase.** Rien. Elle est **conservée mot pour mot** au §7.13,
comme énoncé d'intention, et l'unité ne la livre pas. La retirer du document aurait effacé une
exigence du responsable ; la livrer aurait inventé un périmètre que personne n'a demandé.

**Arbitrage attendu du responsable.** Trois options :

1. créer une unité d'administration des workflows dans le chunk 5, et lui rattacher la phrase ;
2. acter que la configuration d'un workflow reste une opération d'**exploitation**, par l'API et la
   clé de service, et réécrire la phrase en ce sens — comme l'invitation l'est restée (INC-015) ;
3. rattacher l'éditeur à `CRM-042`, qui est la seule unité `[ ]` du chunk 3 touchant à une vue
   d'administration — au prix de gonfler une unité déjà large.

**Lié à :** INC-015 (l'invitation, même motif : une règle produit sans écran pour la porter),
INC-021 (aucun écran de connexion), `docs/SPEC-workflow-engine.md` §7.1 et §7.13.

---

### INC-065 — L'adresse d'une card nomme un track et un channel que rien ne confronte à la card

**Nature :** règle absente ; aucune spécification ne dit ce qu'une adresse incohérente doit rendre.
**Relevé le :** 2026-08-05, pendant la reprise de `CRM-037`.

`docs/SPEC-form-composer.md` §4.6 pose l'adresse `/tracks/:slugTrack/:slugChannel/cards/:idCard` et
précise que la card est désignée par son **identifiant**. C'est ce que fait le code : la requête
porte `id=eq.<idCard>` et `deleted_at=is.null`, et **rien d'autre**.

**Conséquence, structurelle et non hypothétique.** Les deux premiers segments ne sont confrontés à
rien. Une adresse formée du bon identifiant de card et d'un couple `(track, channel)` quelconque
rend le formulaire de cette card, sous les onglets de ce track-là. Le §4.6 bis, écrit pendant ce
passage, alimente désormais la barre d'onglets depuis `slugTrack` : l'incohérence devient
**visible** là où elle était seulement latente.

**Ce que cela ne met pas en cause.** Aucun droit n'est contourné : la card n'est rendue que si la
politique de lecture de `public.cards` la consent à l'appelant, et les channels affichés ne le sont
que si celle de `public.channels` les consent. Deux lectures autorisées mises côte à côte ne
donnent pas un accès de plus. Le défaut est de **cohérence d'affichage**, pas d'autorisation.

**Ce qui n'est pas su.** `docs/SPEC-cards.md` décrit le rattachement d'une card à son channel, mais
aucun chapitre ne dit ce qu'une **adresse** incohérente doit produire. Trois lectures se défendent,
et aucune n'est appliquée en silence :

1. **rediriger** vers l'adresse canonique de la card, déduite de son channel réel — le plus
   confortable, mais suppose que le rendu sache lire le channel de la card, ce qui n'est pas dans
   le périmètre de `CRM-037` ;
2. **refuser**, en rendant le même état « card introuvable » qu'un identifiant inconnu — cohérent
   avec la discrétion de `docs/SPEC-permissions-rls.md` §7, au prix d'une requête de plus ;
3. **tolérer**, en actant que les deux premiers segments ne sont qu'un contexte de navigation et
   n'ont aucune valeur d'assertion — ce que fait le code aujourd'hui, sans que ce soit écrit.

**Comportement retenu :** inchangé — l'option 3, de fait. Elle n'est pas *choisie* ici, elle est
*constatée*, et c'est la raison de cette entrée.

**Arbitrage attendu du responsable**, et rattachement de la correction à l'unité qui porte le
rattachement d'une card à son channel — `CRM-040`, ou `CRM-045` qui traite du déplacement d'une
card entre channels — plutôt qu'au rendu du formulaire.

**Lié à :** `docs/SPEC-form-composer.md` §4.6 et §4.6 bis, `docs/SPEC-cards.md`,
`docs/SPEC-permissions-rls.md` §7.

---

### INC-064 — Un contrôle de restitution comparant à `HEAD` peut exister dans d'autres harnais, et n'y a pas été cherché

**Nature :** défaut de méthode possiblement répliqué, non vérifié.
**Relevé le :** 2026-08-05, pendant la correction de `CRM-037`.

`scripts/verify-formulaire.sh` vérifiait qu'il avait bien restauré les fichiers qu'il dégrade en les
comparant à **`HEAD`** (`git diff --quiet`). Ce contrôle confond « non restauré » et « non encore
committé », et il est donc rouge pour tout travail en cours sur ces fichiers — c'est-à-dire à son
moment d'emploi. Corrigé pour ce harnais par une empreinte prise à l'entrée du script
(`docs/JOURNAL.md` décision 166).

**Ce qui n'est pas su.** Le dépôt compte vingt-quatre scripts `verify-*.sh`, dont plusieurs
pratiquent des dégradations volontaires et les restaurent. Aucun n'a été relu à ce titre pendant ce
passage : ce sont les livrables d'unités déjà closes ou en cours, et les reprendre ici les rouvrirait
(`CLAUDE.md` §13). **Le nombre de harnais concernés est inconnu, et il n'est pas supposé nul.**

**Comportement retenu :** aucun autre script n'est modifié.

**Arbitrage attendu :** une revue transverse des harnais sur ce point précis, rattachée à l'unité
d'outillage — `CRM-008` — plutôt qu'à l'unité fonctionnelle qui la traverse.

---

### INC-063 — Deux chapitres prescrivent `role="alert"` pour deux éléments différents du formulaire, et l'implémentation a tranché sans arbitrage

**Nature :** contradiction entre deux documents, résolue de fait par le code.
**Relevé le :** 2026-08-05, après la livraison de `CRM-037`.

Deux textes prescrivent `role="alert"`, et ils ne désignent pas le même élément :

- `docs/DESIGN_SYSTEM.md` §5.7 le pose sur **l'erreur** d'un champ — « Erreur en `--color-danger`
  avec icône, `role="alert"`, associée au champ par `aria-describedby` » ;
- `docs/SPEC-form-composer.md` §4.5, écrit pendant `CRM-037`, le pose sur le **message
  d'exigence** — « élément portant `role="alert"`, cité par l'`aria-describedby` du contrôle ».

La différence n'est pas de forme. `role="alert"` est une région live **assertive** : son contenu est
annoncé dès qu'il apparaît. Le message d'exigence — « Requis pour passer à *E* » — n'est pas une
erreur, c'est une explication permanente, rendue pour **chaque** champ exigé de l'étape. Appliqué à
la lettre du §4.5, il ferait annoncer autant de messages assertifs qu'il y a de champs exigés, au
**chargement** de l'écran. MESURÉ sur le seed : l'étape `signature` porte trois champs `required`,
donc trois annonces pour un écran qui n'a rien signalé.

**Ce que le code fait aujourd'hui, et qui n'est écrit nulle part.** `webapp/src/app/FormulaireCard.tsx`
sépare les deux : la mention d'exigence est un texte ordinaire (`requis-<clé>`), et `role="alert"`
ne porte que sur l'**alerte de champ manquant** (`alerte-<clé>`), qui n'apparaît que lorsque le
champ exigé est vide. C'est la lecture du §5.7, et elle est probablement la bonne — mais c'est une
**résolution implicite** du §4.5, que `CLAUDE.md` §5 proscrit, et elle n'est consignée dans aucun
document.

**Comportement retenu :** le code est **laissé inchangé**. Il est le plus défendable des deux, et le
modifier maintenant échangerait une contradiction non consignée contre une autre.

**Trois options d'arbitrage :**

1. **Corriger le §4.5 de `docs/SPEC-form-composer.md`** pour qu'il décrive ce que le code fait :
   `role="alert"` sur l'alerte de champ manquant, texte ordinaire pour la mention d'exigence ;
2. **Employer `role="status"`** (poli) pour la mention d'exigence, et conserver `role="alert"` pour
   l'alerte — la mention serait alors annoncée, mais sans interrompre ;
3. **Appliquer la lettre du §4.5** et l'assumer en le motivant dans le design system.

L'option 1 décrit l'existant et ne change aucun comportement ; elle **modifie une spécification déjà
committée**, ce qui appartient au responsable.

---

### INC-062 — La Definition of Done de `CRM-037` exige un parcours de transition que `CRM-041`, ordonnée après elle, est seule à pouvoir livrer

**Nature :** contradiction d'ordonnancement entre la Definition of Done de `CRM-037`
(`docs/BACKLOG.md`), `docs/SPEC-form-composer.md` §7.3 et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-05, pendant la spécification de `CRM-037`.

La Definition of Done de `CRM-037` exige « **E2E (transition bloquée, saisie, transition
réussie)** ». Ce parcours suppose trois choses, dont **aucune** n'appartient à cette unité :

1. une **session** — la webapp est un appelant anonyme, INC-021, arbitrage ouvert depuis le
   2026-08-04 ;
2. un **contrôle de transition** dans l'interface — le menu des transitions déclarées et le
   glisser-déposer sont l'objet de `CRM-041` (`docs/DESIGN_SYSTEM.md` §5.1) ;
3. une **écriture de valeur** depuis l'écran, qui exige elle aussi la session du point 1.

Or `docs/MASTER_PLAN.md` §2 place `CRM-041` **après** `CRM-037` — et cet ordre est justifié :
« le form composer s'appuie sur les étapes », et le board s'appuie sur la garde `move_card`. Il n'y
a pas d'erreur d'ordonnancement à corriger ; il y a une Definition of Done écrite en supposant un
écran que l'ordre du plan livre plus tard.

C'est le sixième cas du motif déjà relevé — INC-010 (clés étrangères), INC-013 (jointures
d'autorisation), INC-029 (une colonne), INC-031 (une cible d'archivage), INC-037 (des champs à
copier) : **une preuve dont l'objet n'existe pas encore**. La différence est qu'ici l'objet manquant
n'est pas une table mais un **geste d'interface**.

**Ce qui est mesuré, et qui n'est pas une supposition :** le seed porte neuf cards, sept étapes et
dix-sept règles de visibilité ; la card `…0000c6` est à `Prospection`, où `motif-perte` est
`hidden`, et porte pourtant une valeur pour ce champ. Le formulaire d'une étape et sa section
repliée sont donc **entièrement démontrables aujourd'hui**. Seule la **transition depuis l'écran**
ne l'est pas.

**Comportement retenu :** `CRM-037` livre le rendu, son écran hôte et ses preuves atteignables
(`docs/SPEC-form-composer.md` §7.3, second tableau), et **n'invente ni contrôle de transition, ni
parcours de connexion**. L'écart est nommé dans `docs/BACKLOG.md`, et l'unité reste `[~]`.

**Trois options d'arbitrage :**

1. **Déplacer cette exigence dans la Definition of Done de `CRM-041`**, l'unité qui livre le geste
   dont elle dépend, en la retirant de `CRM-037` ;
2. **La conserver dans `CRM-037`** et accepter que l'unité ne puisse passer `[x]` qu'après
   `CRM-041`, c'est-à-dire hors de son rang dans le plan ;
3. **Créer une unité de jonction** — par exemple `CRM-037b`, placée après `CRM-041` — qui porte le
   seul parcours « transition bloquée → saisie → transition réussie ».

**Action attendue du responsable :** trancher. L'option 1 a la préférence de rédaction — elle laisse
chaque preuve à l'unité qui livre son objet, et c'est le raisonnement déjà retenu pour INC-031 —
mais la décision ne revient pas à l'agent, et INC-021 conditionne les trois.

**Lié à :** INC-021 (aucun écran de connexion), INC-031 et INC-037 (le même motif sur d'autres
objets), INC-053 (`user` et `contact` non résolus, donc rendus bruts).

---

### INC-061 — `scripts/verify-cards.sh` mesure `npm run test:sql` avant de retirer son propre jeu d'essai, et une suite livrée après lui le dénonce

**Nature :** défaut d'outillage de vérification, mesuré ; aucun comportement du produit en cause.
**Relevé le :** 2026-08-05, pendant la reprise de `CRM-010`, par le rejeu des vingt-trois harnais.

`scripts/verify-cards.sh` crée cinq cards de preuve, titrées `tst-crm040-%`, et les retire dans son
`trap … EXIT`. Sa **section 10** rejoue `npm run test:sql`, `npm run e2e:api` et le reste — donc
**avant** ce retrait. La base porte alors **14** cards au lieu des 9 du seed.

Trois assertions de `supabase/tests/0015_colonnes_protegees.test.sql`, livrée par `CRM-013`
**après** que cette section 10 a été écrite, comptent précisément les neuf cards du seed :

```
not ok 33 - les neuf cards du seed sont intactes …            have: 14  want: 9
not ok 34 - et leurs neuf adresses ont toujours la forme générée   have: 14  want: 9
not ok 35 - neuf adresses DISTINCTES …                            have: 14  want: 9
```

**MESURÉ :** `scripts/verify-cards.sh` rend « 45 contrôles, 1 en échec » de façon **reproductible**,
et `npm run test:sql` lancé **immédiatement après** sa sortie rend « 1164 assertions, aucune
anomalie ». L'écart n'est donc ni un défaut du produit, ni une régression : c'est le harnais qui se
mesure lui-même en train de tenir son jeu d'essai.

**Ce n'est pas INC-058, et ce n'est pas INC-055.** INC-058 décrit une assertion qui compte une donnée
globale qu'un **autre** harnais fait varier pendant qu'il l'exécute ; ici, un seul harnais est en
cause, et il se dénonce lui-même. INC-055 décrit une base laissée **dégradée en sortant** ; ici la
base est correcte en sortant, c'est **pendant** que la mesure est faussée.

**Correction connue, non appliquée.** Il suffirait de déplacer la section 10 après le retrait du jeu
d'essai, ou de retirer les cards avant elle. `scripts/verify-cards.sh` est un livrable de `CRM-040`,
unité `[~]` dont les preuves ont été validées ; le reprendre dans un commit consacré à `CRM-010`
reviendrait à toucher les 45 contrôles d'une autre unité sans les rejouer sous la sienne
(`CLAUDE.md` §13). **L'échec est nommé plutôt que masqué**, et il l'est ici plutôt que dans un
commentaire du script.

**Arbitrage attendu du responsable.** Trois options :

1. corriger `scripts/verify-cards.sh` sous `CRM-040`, en rejouant ses 45 contrôles ;
2. poser dans `docs/SPEC-test-harness.md` une règle générale — « un harnais ne rejoue jamais les
   suites globales tant qu'il tient un jeu d'essai » — et l'appliquer à tous les harnais qui en
   créent un, par une unité de dette dédiée ;
3. retirer la section 10 de `scripts/verify-cards.sh`, les suites globales étant déjà rejouées par
   `npm run test:sql` et par le compte rendu de chaque unité.

**SECONDE OCCURRENCE, MESURÉE LE 2026-08-05 PENDANT `CRM-041`, ET L'ENTRÉE S'AGGRAVE.** Le harnais
rend désormais « 45 contrôles, **2** en échec » : `npm run test:sql` comme avant, et **`npm run
e2e:api`** avec lui. La cause est identique et le second victime était prévisible — `CRM-041` livre
`e2e/api/board.spec.ts`, dont trois scénarios comptent les cards de `grands-comptes` : trois actives,
deux rangées, cinq en tout. Le jeu d'essai du harnais s'y ajoute, et les comptes ne tombent plus.

Contre-épreuve **mesurée**, comme pour la première occurrence : la base porte **9** cards en sortant
du harnais, `npm run e2e:api` lancé ensuite rend **332 scénarios, aucune anomalie**, et
`npm run test:sql` **1164 assertions, aucune anomalie**. Ni le produit ni les preuves de `CRM-041`
ne sont en cause.

**Ce que la seconde occurrence apprend.** Le défaut ne concerne pas une suite en particulier : il
frappera **toute** preuve future qui comptera des cards, et il en frappera d'autant plus que le
produit avance. Les assertions de `CRM-041` **ne sont pas affaiblies** pour l'accommoder — compter
les trois cards actives du seed est précisément ce qui rend la composition des colonnes vérifiable,
et relâcher ce compte pour qu'un harnais fautif passe reviendrait à supprimer un test pour obtenir
un vert (`CLAUDE.md` §26). L'arbitrage reste dû, et l'option 2 gagne en poids : la règle générale
protégerait les preuves à venir, que l'option 1 ne protège pas.

**TROISIÈME OCCURRENCE, MESURÉE LE 2026-08-05 PENDANT LE REJEU DES NEUF HARNAIS EN ATTENTE DE
`CRM-042`, ET LA CAUSE EST ISOLÉE SANS LE HARNAIS.** Le harnais rend de nouveau « 45 contrôles,
**2** en échec », `npm run test:sql` et `npm run e2e:api`. Cette fois la cause n'est pas déduite du
harnais : elle est **reproduite hors de lui**. Les cinq cards de preuve ont été recréées par le
**vrai chemin applicatif** — `POST /rest/v1/cards` avec le jeton réel de l'administratrice, cinq
`201`, base portée à **14** cards —, les suites ont été mesurées dans cet état, puis les cards
retirées. MESURÉ :

```
not ok 33 - les neuf cards du seed sont intactes …
not ok 34 - et leurs neuf adresses ont toujours la forme générée …
not ok 35 - neuf adresses DISTINCTES …
11 failed, 347 passed  (npm run e2e:api)
```

**Onze scénarios d'API**, contre deux à la première occurrence et trois à la deuxième :
`e2e/api/board.spec.ts` (2), `e2e/api/colonnes-protegees.spec.ts` (1) et surtout
`e2e/api/liste-cards.spec.ts` (**7**) — les deux lectures de la vue liste, les deux filtres
d'activité, la contre-épreuve des deux lignes de plus, et les cinq scénarios de la pagination et du
`416`. Base ramenée à **9** cards, `npm run test:sql` rend ensuite **1164 assertions, aucune
anomalie** et `npm run e2e:api` **358 scénarios, aucune anomalie**.

**Ce que la troisième occurrence tranche.** La prédiction de la deuxième — « il frappera toute
preuve future qui comptera des cards » — est **vérifiée** : la victime la plus atteinte est la
preuve d'intégration dédiée de l'unité la plus récente, livrée après que l'entrée a été écrite. Le
nombre de scénarios touchés a **quintuplé en deux unités**, et rien n'indique que cela s'arrête :
toute unité qui lira des cards ajoutera ses propres victimes. **L'option 2 — poser la règle générale
dans `docs/SPEC-test-harness.md` — est la seule qui protège les preuves à venir**, l'option 1 ne
protégeant que le harnais fautif d'aujourd'hui. La correction n'est toujours **pas appliquée** :
`scripts/verify-cards.sh` est un livrable de `CRM-040`, et le reprendre sous `CRM-042` reviendrait à
toucher les 45 contrôles d'une autre unité sans les rejouer sous la sienne (`CLAUDE.md` §13).
**Arbitrage attendu du responsable, pour la troisième fois.**

**Lié à :** INC-055 et INC-060 (défauts d'outillage de la même famille), INC-058 (compteur perturbé
par un harnais concurrent), `docs/JOURNAL.md` décisions 158 et 191.

---

### INC-060 — `scripts/verify-migrations.sh` déclare vert un rejeu qu'il n'a pas attendu, et rend la main sur une base à moitié migrée

**Nature :** défaut d'outillage de vérification, mesuré ; aucun comportement du produit en cause.
**Relevé le :** 2026-08-05, pendant la reprise de `CRM-010`.

Deux harnais déclenchent le `migrations-runner` avec la même écriture :

```
docker compose … up -d migrations-runner
runner_code=$(docker inspect -f '{{.State.ExitCode}}' p2enjoy-migrations)
```

`docker compose up -d` **rend la main dès que le conteneur est démarré**, pas quand il a fini.
MESURÉ, immédiatement après l'appel :

```
docker inspect -f '{{.State.ExitCode}} {{.State.Status}}' p2enjoy-migrations
→ 0 running
```

Le `0` lu est celui de l'exécution **précédente**. Deux conséquences, toutes deux mesurées :

- **le contrôle est complaisant** : il annoncerait « code 0 » d'un rejeu encore en cours, ou sur le
  point d'échouer ;
- **le harnais rend la main sur une base intermédiaire.** Le runner rejoue le répertoire dans
  l'ordre ; entre la migration 3 et la migration 10, `tracks_lecture_membre` est revenue à sa forme
  de `CRM-003` — `app.is_workspace_member(workspace_id)` —, les droits fins de `CRM-012` cessant
  d'être appliqués. MESURÉ : `npm run test:sql` lancé dans cette fenêtre rend **trois assertions
  rouges** dans `supabase/tests/0011_droits_fins.test.sql`, dont la **preuve de refus n° 4**.

C'est ainsi que le défaut a été trouvé : par un rejeu de régression qui a échoué sans qu'aucun code
ait changé.

**Corrigé pour `scripts/verify-authz.sh`**, livrable de `CRM-010`, dans le même changement que cette
entrée : `docker compose run --rm migrations-runner` est **synchrone** et rend le code du rejeu qu'il
vient de lancer. Ce n'est pas une invention — c'est déjà le procédé de `scripts/verify-tracks.sh`.
Un contrôle de plus vérifie ensuite que la base est bien celle du répertoire **complet**, et non un
état intermédiaire.

**Non corrigé pour `scripts/verify-migrations.sh`**, livrable de `CRM-003`, unité `[x]`. La
correction est connue, tient en trois lignes, et est celle qui vient d'être appliquée à l'autre
harnais. Elle n'est pas appliquée ici parce que la porter reviendrait à modifier un livrable vérifié
d'une autre unité dans un commit qui n'en traite pas (`CLAUDE.md` §13), et à toucher ses 23 contrôles
sans les rejouer sous leur propre unité. **Le piège reste donc armé** : toute exécution de
`scripts/verify-migrations.sh` suivie immédiatement d'une autre mesure peut faire échouer cette
mesure sans qu'aucun code soit en cause.

**Arbitrage attendu du responsable.** Trois options :

1. appliquer la même correction à `scripts/verify-migrations.sh`, en rejouant les 23 contrôles de
   `CRM-003` dans le même changement ;
2. inscrire dans `docs/SPEC-test-harness.md` une règle générale — « un harnais ne déclenche jamais
   le runner sans l'attendre, et vérifie l'état final plutôt que le code d'un conteneur » — puis la
   faire appliquer à tous les harnais existants par une unité de dette dédiée ;
3. laisser en l'état et documenter que les harnais ne doivent pas être enchaînés sans attente.

**Lié à :** INC-055 (même famille : un harnais qui laisse la base dans un état que le runner ne
produit jamais), `docs/JOURNAL.md` décisions 108, 135 et 157.

---

### INC-059 — Deux exécutions de la routine ont livré `CRM-014` en parallèle, sans se voir

**Nature :** défaut d'exploitation de la routine d'avancement, mesuré ; aucune conséquence sur le
produit livré, une conséquence certaine sur le travail dépensé.
**Relevé le :** 2026-08-05, à la clôture d'une exécution de la routine.

**Ce qui a été mesuré.** Une exécution de la routine a démarré à 04:56 UTC, s'est resynchronisée —
`origin/main` valait alors `9a69350`, le commit documentaire de `CRM-014` —, a constaté que
l'unité suivante à traiter était `CRM-014`, et l'a implémentée : fichier consolidé de 37 scénarios,
harnais de non-complaisance, documentation, captures, commit local à 05:33. Au `git fetch` précédant
le `push`, `origin/main` valait `1364bf3` : **une autre exécution de la même routine avait livré
`CRM-014` à 05:06**, pendant ce temps.

Les deux livraisons sont indépendantes et concordantes sur le fond — mêmes sept preuves acquises,
mêmes cinq absences figées, et **la même réfutation** de la prédiction du §7.4, atteinte séparément.
La livraison poussée est la meilleure des deux : elle résout par une suite pgTAP d'inventaire ce que
la seconde avait conclu être impossible, à savoir faire échouer le harnais au **retrait** d'une
politique. La seconde exécution a donc abandonné son commit plutôt que de le pousser, et a vérifié
la première de façon indépendante — 26 contrôles verts sur un conteneur neuf.

**Pourquoi cela doit être consigné.** Le coût n'est pas nul et n'était pas détectable plus tôt :

- la resynchronisation d'ouverture, que les consignes de la routine imposent, **ne protège de
  rien** : elle mesure l'état du dépôt à un instant, et le travail dure une heure ;
- rien dans le dépôt ne signale qu'une unité est **en cours de traitement** par quelqu'un. Le
  marquage `[~]` de `docs/BACKLOG.md` désigne un travail *livré et insuffisamment vérifié*, pas un
  travail *en cours* — les deux exécutions ont donc lu le même `[ ]` sur `CRM-014` ;
- si la seconde exécution avait poussé sans refetch, ou avait poussé sur sa branche assignée sans
  regarder `main`, le dépôt porterait **deux implémentations concurrentes de la même unité**, sur
  des fichiers de même chemin.

**Comportement retenu :** la seconde exécution n'a **rien poussé** de sa version de `CRM-014`. Son
commit local `346a230` n'existe que dans le conteneur, qui est éphémère : il sera perdu, ce qui est
le résultat voulu pour un doublon.

**Action attendue du responsable :** trancher entre

1. **sérialiser la routine** — une seule exécution active à la fois, ce que le planificateur sait
   faire et qui supprime le problème à la racine ;
2. **poser un verrou dans le dépôt** — un marquage d'unité « prise » committé et poussé avant tout
   travail, ce qui déplace la course sur un fichier au lieu de la supprimer, mais la rend visible ;
3. **accepter la redondance** et écrire dans `docs/MASTER_PLAN.md` §1 la règle appliquée ici :
   refetch obligatoire avant `push`, et abandon du travail si l'unité a été livrée entre-temps.

**Lié à :** INC-034 (branche et identité imposées à la routine), `docs/MASTER_PLAN.md` §1,
`docs/BACKLOG.md` `CRM-014`.

---

### INC-058 — Une assertion pgTAP compte une donnée globale qu'un autre harnais fait varier pendant qu'il l'exécute

**Nature :** contradiction entre deux harnais de vérification ; aucun comportement du produit en
cause. L'assertion est livrée par `CRM-013`, le harnais qui la met en défaut par `CRM-040`.
**Relevé le :** 2026-08-05, pendant `CRM-014`, en rejouant les vingt et un harnais précédents.

`scripts/verify-cards.sh` échoue en mode **complet** — `45 contrôles, 1 en échec` — sur son
contrôle `npm run test:sql`. MESURÉ, en capturant la sortie de ce `npm run test:sql` :

```
ECHEC  supabase/tests/0015_colonnes_protegees.test.sql — 3 assertion(s) en échec sur 41
       not ok 33 - les neuf cards du seed sont intactes
       not ok 34 - et leurs neuf adresses ont toujours la forme générée
       not ok 35 - neuf adresses DISTINCTES
```

**La cause, mesurée et non déduite.** En échantillonnant `select count(*) from public.cards`
toutes les trois secondes pendant une exécution complète du harnais, le compte vaut **14** pendant
onze relevés, puis **9** pendant vingt-trois. `scripts/verify-cards.sh` crée cinq cards pour ses
propres preuves et les retire dans son `trap EXIT` — donc **après** sa section 10, qui est
précisément celle qui lance `npm run test:sql`. Les trois assertions de `CRM-013` comptent, elles,
neuf cards à l'échelle de la table entière. Elles ne peuvent donc **pas** être vertes à ce moment
précis, quelle que soit la qualité du produit.

**Ce n'est ni un défaut du produit, ni un défaut de mesure.** Les deux côtés sont défendables pris
isolément : un harnais a le droit de créer ses données avant de nettoyer, et une assertion a le
droit de vérifier que le seed est intact. C'est leur **composition** qui est contradictoire, et
rien ne la surveillait.

**Pourquoi c'était invisible jusqu'ici.** `CRM-013` rapporte `verify-cards` à **37 contrôles** ;
en mode complet il en rend **45**. L'écart est exactement la section 10 — sept contrôles de suites
et de build —, que `--rapide` saute. Le défaut n'existe donc que sur le chemin le plus long, celui
qu'on emprunte le moins souvent.

**Vérifié comme antérieur à `CRM-014`** : la suite `supabase/tests/0016_preuves_refus.test.sql`
retirée du répertoire, `scripts/verify-cards.sh` échoue à l'identique, au même contrôle. L'unité en
cours n'y est pour rien, et sa propre suite pgTAP passe dans cet état — elle n'assère que des
tables **non vides**, jamais un compte global de cards.

**Comportement retenu :** **inchangé**. `scripts/verify-cards.sh` est un livrable de `CRM-040` et
les trois assertions un livrable de `CRM-013` ; les corriger pendant un passage consacré à
`CRM-014` rouvrirait deux unités vérifiées, ce que `CLAUDE.md` §13 interdit.

**Action attendue du responsable :** trancher entre

1. déplacer le ménage de `scripts/verify-cards.sh` **avant** sa section 10, de sorte qu'aucune
   suite ne s'exécute sur un état transitoire — la correction la plus simple, à un seul endroit ;
2. restreindre les trois assertions de `CRM-013` aux **neuf identifiants du seed** plutôt qu'au
   compte de la table, ce qui les rendrait insensibles à toute donnée de test ;
3. poser en règle générale, dans `docs/SPEC-test-harness.md`, qu'une assertion pgTAP ne compte
   jamais une population **globale** mais toujours un ensemble nommé — règle qui vaudrait pour tout
   le dépôt et préviendrait la prochaine occurrence au lieu de la corriger.

L'option 3 rejoint la question déjà posée en **INC-055** : faut-il inscrire les règles de
composition des harnais dans leur spécification, plutôt que les corriger harnais par harnais ?
C'est la **troisième** fois que la question se pose sous une forme différente.

**Lié à :** INC-055 (un harnais laisse un état que le produit ne connaît pas), INC-056 (un
garde-fou qui dépend de l'âge de la base), `docs/SPEC-test-harness.md` §7, `CLAUDE.md` §8 (le seed
est un contrat reproductible).

---

### INC-057 — Un commentaire `@verifies` annonçait une preuve de refus que le fichier ne portait pas

**Nature :** commentaire de traçabilité inexact, livré par `CRM-040`.
**Relevé le :** 2026-08-05, pendant `CRM-014`, en inventoriant les douze preuves de refus.

L'en-tête de `e2e/api/cards.spec.ts` déclare :

```ts
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 3, 4 et 11 sur les cards)
```

MESURÉ, par recherche dans le fichier : la n° 4 et la n° 11 y sont bien exercées et nommées ; la
**n° 3 ne l'est pas**. Aucun scénario de ce fichier ne crée de second workspace, et aucun ne vérifie
qu'un membre du workspace A ne lit pas une card du workspace B. L'énoncé de `CRM-040` dans
`docs/BACKLOG.md` est d'ailleurs exact — il n'annonce que les n° 4 et n° 11 : c'est le commentaire
du fichier qui promet davantage que son contenu.

**Pourquoi cela compte plus qu'une ligne de commentaire.** `CLAUDE.md` §5 fait des commentaires
`@spec` / `@verifies` la trace opposable entre le code et la spécification. Un `@verifies`
inexact est pire qu'absent : il fait croire à une couverture qui n'existe pas, et une revue qui
s'y fie conclut que la preuve est acquise. C'est exactement le mode de défaillance que le registre
existe pour empêcher.

**Comportement retenu :** **inchangé**, et la preuve est livrée ailleurs. `CRM-014` écrit la
preuve n° 3 sur les cards dans son fichier consolidé — chaîne complète créée dans un second
workspace avec la clé de service, constatée présente, puis invisible aux trois profils du
workspace A. La preuve existe donc désormais ; ce qui reste faux est le commentaire de
`e2e/api/cards.spec.ts`, fichier livrable de `CRM-040`, qu'un passage consacré à `CRM-014` ne
corrige pas de son propre chef (`CLAUDE.md` §13).

**Action attendue du responsable :** trancher entre

1. corriger l'en-tête de `e2e/api/cards.spec.ts` pour qu'il n'annonce que les n° 4 et n° 11 — une
   ligne, dans un commit rattaché à `CRM-040` ;
2. y ajouter réellement la preuve n° 3, ce qui la dupliquerait avec `CRM-014` sans rien prouver de
   plus ;
3. décider que les `@verifies` d'un fichier peuvent nommer une preuve **portée ailleurs pour la
   même table**, et l'écrire dans `docs/MASTER_PLAN.md` §3 — auquel cas rien n'est à corriger, mais
   la convention change pour tout le dépôt.

**Lié à :** `docs/MASTER_PLAN.md` §3 (format de la traçabilité), `docs/SPEC-permissions-rls.md` §7
(preuve n° 3), `docs/BACKLOG.md` `CRM-040`.

---

### INC-055 — Un harnais qui rejoue sa seule migration laisse la base dans un état que le runner ne produit jamais

**Nature :** défaut d'outillage de vérification ; aucun comportement du produit en cause.
**Relevé le :** 2026-08-05, pendant `CRM-036`. **Le défaut lui-même date de `CRM-034`.**

Le `migrations-runner` rejoue **tout** le répertoire, dans l'ordre, à chaque démarrage de la pile
(décision 20). Un harnais de preuves qui restaure son état en rejouant **sa seule** migration
produit donc un état intermédiaire que le produit ne connaît **jamais**.

`scripts/verify-cards.sh` rejoue `0011_cards.sql`, dont la section 7 fait
`grant insert, update on public.cards to authenticated`. Or `0012_move_card.sql` **retire**
précisément l'`UPDATE` de table pour rendre `move_card` incontournable — c'est la moitié de
l'unité `CRM-034`, et la **preuve de refus n° 5** de `docs/SPEC-permissions-rls.md` §7.

**MESURÉ le 2026-08-05, sur une base saine, avant et après un passage du harnais :**

```
avant  has_table_privilege('authenticated', 'public.cards', 'update') → false
après  has_table_privilege('authenticated', 'public.cards', 'update') → true
après  npm run test:sql → 2 fichiers en échec, 8 assertions
       (0012_cards.test.sql : 1 · 0013_move_card.test.sql : 7)
```

**La garde centrale de `CRM-034` était donc désactivée pour tout ce qui s'exécutait ensuite**, sans
qu'aucun message ne le signale : le harnais se déclarait « aucune anomalie » en laissant la base
dans un état où la porte qu'il venait de vérifier était rouverte. Le défaut est **antérieur à
`CRM-036`** — il date de `CRM-034`, qui a ajouté le `revoke` dans une migration ultérieure sans
reprendre le harnais de `CRM-040`.

**Correction appliquée, et son périmètre.** `scripts/verify-cards.sh` rejoue désormais sa migration
**et celles qui la complètent** — `0012_move_card.sql` puis `0013_valeurs_champs.sql` —, c'est-à-dire
exactement ce que le runner produit. La correction ne touche **aucun** comportement du produit,
aucune migration, aucune politique et aucun privilège : elle porte sur la seule restauration d'un
outil de vérification. Elle est signalée ici plutôt que passée sous silence, parce qu'elle modifie
un livrable de `CRM-040`.

**Un second effet, découvert par cette correction.** La dégradation *b* de `scripts/verify-cards.sh`
faisait un `PATCH` de `channel_id` pour éprouver le `WITH CHECK` de `cards_maj`. Or `channel_id` est
fermée au **niveau colonne** depuis `CRM-034` : ce `PATCH` est refusé par le **privilège**, avant
qu'aucune politique ne soit consultée. La dégradation ne prouvait donc plus rien du `WITH CHECK` —
elle ne l'exerçait que grâce à l'état dégradé décrit ci-dessus, c'est-à-dire grâce au défaut
lui-même. Elle est réécrite **en deux temps**, ce qui la rend plus forte : le refus tenu par le seul
privilège, puis le `WITH CHECK` réellement exercé une fois le privilège rendu. Le refus est
**double**, et chaque barrière est désormais mesurée séparément.

**Ce qui reste ouvert, et qui appartient au responsable.** Faut-il une règle générale — « un harnais
restaure en rejouant toutes les migrations de son numéro à la dernière » — inscrite dans
`docs/SPEC-test-harness.md`, plutôt que corrigée harnais par harnais à mesure que le défaut se
manifeste ? Le même piège attend toute unité qui modifiera par une migration ultérieure un objet
créé par une migration antérieure. Le comportement est corrigé pour la seule occurrence mesurée,
sans généralisation implicite.

**Lié à :** décision 20 (le runner ne tient aucun registre), `CRM-034` §2 (la protection de colonne),
INC-049 (chevauchement de Definition of Done entre `CRM-034` et `CRM-013`).

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

**Arbitrage rendu — `docs/JOURNAL.md`, décision 259.** La transition « Réalisation → Perdu » est ajoutée et le graphe du workflow par défaut est **relu en entier** : chaque étape doit avoir au moins une sortie. Interrogé sur l'origine de l'oubli, le responsable a répondu qu'il avait **listé des exemples** et attendait des propositions — l'oubli est celui de l'agent. Mise en œuvre : `CRM-005`, `CRM-046`.

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

**Arbitrage rendu — `docs/JOURNAL.md`, décision 260.** **Les fonctions edge entrent au périmètre ; la décision 12 est rouverte.** L'agent proposait de retirer la mention du `README.md` ; le responsable tranche l'inverse — livrer ce que le document annonce plutôt que faire disparaître la moitié qui gêne. Mise en œuvre : `CRM-016`.

**Nature :** référence documentaire sans contrepartie architecturale.
**Relevé le :** 2026-08-03, pendant `CRM-001`.

`README.md` §10 annonce un répertoire `supabase/functions/` décrit comme « Edge functions Deno ».
Or :

- `docs/DAT.md` §3 ne liste **aucun** composant de fonctions edge ;
- `docs/DAT.md` §6 n'expose **aucune** interface de ce type ;
- **aucune** unité de `docs/BACKLOG.md` ne prévoit d'en écrire.

**Mise en œuvre ouverte le 2026-08-07.** `docs/SPEC-edge-functions.md` fixe le contrat mesuré du
service, de sa route, de son exemple et de ses preuves ; `CRM-016` passe `[~]`. Tant que son commit
d'implémentation n'est pas livré et vérifié, le service `edge-runtime` et la route
`/functions/v1/` restent absents de la pile active. Le constat ne sera déplacé en « Clos » qu'après
l'appel réel par Kong et l'inspection de journaux silencieux.

**Arbitrage rendu :** les fonctions edge entrent au périmètre et reçoivent `CRM-016` ; la mention
du `README.md` doit devenir la description du répertoire réellement livré, jamais être retirée.

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

**Arbitrage rendu — `docs/JOURNAL.md`, décision 261.** **L'ordonnancement passe à `pg_cron` ; la décision 8 est renversée.** Une purge RGPD qui ne s'exécute pas est un manquement, pas un retard. Mise en œuvre : `CRM-017` ; `CRM-051` perd son sous-composant `scheduler`.

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

**Arbitrage rendu — `docs/JOURNAL.md`, décision 256.** Le parcours d'invitation est **rattaché à `CRM-070`**, et non à une unité créée maintenant : trois décisions d'architecture d'un coup pour un geste rare. En attendant, le comportement réel — invitation émise par un **opérateur**, hors interface — est nommé dans `docs/manual.md` chapitre 17 plutôt que promis comme un parcours livré.

**Nature :** référence manquante dans l'architecture, décision non prise.
**Relevé le :** 2026-08-03, pendant `CRM-011`.

`docs/BACKLOG.md` décrit `CRM-011` comme livrant « l'invitation par un administrateur », et
`docs/manual.md` rattache le chapitre 17, « Inviter et gérer les membres », à cette unité. Or
`POST /auth/v1/invite` exige un jeton portant `service_role` — mesuré : la clé anonyme est refusée
par `403 not_admin`. La webapp ne doit jamais détenir cette clé.

Il manque donc un composant serveur entre l'administrateur de workspace et GoTrue, et le projet
n'en possède aucun qui convienne :

- les fonctions edge **entrent au périmètre avec `CRM-016`** (décision 260) et donnent à
  `CRM-070` le composant serveur attendu, sans livrer encore le parcours d'invitation ;
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

### INC-016 — Gabarits d'emails : chargement HTTP obligatoire et repli silencieux vers l'anglais — **CLOSE**

**Arbitrage rendu — `docs/JOURNAL.md`, décision 264.** **Les gabarits d'emails sont servis en HTTP depuis la pile.** Exigence attachée, qui vaut au-delà de cette entrée : toute preuve portant sur un email vérifie son **contenu**, jamais sa seule présence. Mise en œuvre : `CRM-009`.

**Contrat de résolution écrit — `docs/JOURNAL.md`, décision 269.** Le service interne commun
`auth-templates`, ses quatre URL, ses sujets français et les preuves de contenu sont spécifiés dans
`docs/SPEC-auth.md` §5.

**CLOSE le 2026-08-07 par `CRM-009`.** Le service commun est sain et GoTrue dépend de lui ; les
quatre gabarits français sont joignables. Le harnais obtient les vrais emails d'invitation et de
réinitialisation par SMTP, exige leur sujet, leur phrase propre, le produit, le code et le lien,
puis démontre qu'un GoTrue jetable privé du service retombe bien sur l'anglais que ce même
validateur refuse : **62/62**. Dans Chromium, le destinataire ouvre Inbucket, lit le contenu
français rendu, voit l'action contrastée, clique avec la souris et obtient sa session d'onglet ;
capture observée dans `docs/captures/CRM-009/`.

**Nature :** limite d'un composant tiers, contraire à une exigence générale.
**Relevé le :** 2026-08-03, pendant `CRM-011`.

Au moment du constat, le produit était en français tandis que les emails transactionnels partaient
en **anglais**, avec les gabarits par défaut de GoTrue.

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

**Pourquoi ce n'était pas résolu lors du constat.** Servir les gabarits en HTTP demandait soit un service
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

**Arbitrage exécuté :** décision 264, mise en œuvre et prouvée par `CRM-009`. Le constat MIME reste
une limite distincte du composant épinglé : son interface interne ne reçoit qu'un corps et son
client SMTP l'envoie par `SetBody("text/html", body)`. Un simple gabarit ne peut donc pas créer un
multipart alternatif (`docs/SPEC-auth.md` §5.2).

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

**Arbitrage rendu — `docs/JOURNAL.md`, décision 265.** **Le chemin d'administration de GoTrue est interdit en production** et documenté comme une opération d'exploitation encadrée : un privilège ne dispense pas d'une règle. Mise en œuvre : `docs/PROD_MIGRATIONS.md` §7 et `docs/SPEC-auth.md` §4.1.

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

## Clos — reprises du 2026-08-07

### INC-005 — Écart assumé : copie de workflow contre surcharge — **CLOS**

**Nature :** écart documenté à une convention générale.
**Relevé le :** 2026-08-03. **Clos le :** 2026-08-07.

`CLAUDE.md` §4 demande que « tout existe par défaut au niveau général, puis les contextes
spécialisés ne définissent que leurs différences ». Le responsable a explicitement demandé de
**copier** un workflow global dans un track pour l'y modifier, ce qui produit une duplication et
non une surcharge.

**Arbitrage rendu — `docs/JOURNAL.md`, décision 266 : l'écart est confirmé.** L'instruction
explicite du responsable prime (`CLAUDE.md` §26, priorité 2 sur priorité 8), et la compensation est
en place et prouvée : l'origine reste connue (`derived_from_workflow_id`, `derived_at`) et la
divergence est signalée. L'entrée était ouverte « pour information », en attente de cette
confirmation ; elle est close.

---

### INC-021 — Aucune unité ne porte l'écran de connexion, que la DoD de `CRM-011` présuppose — **CLOSE**

**Arbitrage rendu — `docs/JOURNAL.md`, décision 253.** **Option 2 : une unité dédiée, `CRM-009`**, insérée entre `CRM-007` et `CRM-008`. `docs/SPEC-auth.md` §9 avait retenu l'option 1 — rattacher l'écran à `CRM-011` — et est corrigé. Le comportement livré est conforme ; c'est le rattachement qui était faux.

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

**Arbitrage rendu le 2026-08-07 — décision 253 récupérée du responsable.** L'option 2 est retenue :
une unité dédiée, `CRM-009`, entre `CRM-007` et `CRM-008`. Le rattachement transitoire à
`CRM-011`, décidé à tort pendant que cette décision manquait de `main`, est corrigé dans le code,
les preuves et l'architecture.

**CLOSE le 2026-08-07 par `CRM-009`.** Huit scénarios navigateur obtiennent les vraies sessions
GoTrue : refus, session d'onglet, fermeture du contexte, déconnexion, lecture, publication,
déplacements autorisé/refusé et parcours destinataire depuis Inbucket. Les effets métier sont
relus par l'API, les données nettoyées, l'URL du lien débarrassée de ses jetons et `localStorage`
reste vide. INC-015 reste distincte ; les unités métier dépendantes sont réévaluées une par une.

**Lié à :** INC-015 (invitation sans composant), INC-020 (build dû par `CRM-007`).

---

### INC-022 — `docs/DAT.md` §3.1 se contredit sur la persistance de session — **CLOSE**

**Arbitrage rendu — `docs/JOURNAL.md`, décision 254.** **Option 2 : `sessionStorage`.** Catégorie 2 de `CLAUDE.md` §11, sans recueil de consentement : un `F5` ne déconnecte pas, la fermeture de l'onglet si. Aucune bannière, aucun registre de consentement, aucune persistance transverse.

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

**Arbitrage rendu le 2026-08-07.** L'option 2 est retenue : session dans `sessionStorage`, limitée
à l'onglet, avec repli mémoire lorsque ce stockage n'est pas disponible. Le contrat opposable est
`docs/SPEC-auth.md` §9.2 et le DAT ne présente plus la persistance par défaut de la bibliothèque
comme un acquis. Le point reste ouvert jusqu'à la preuve qu'aucune session n'est écrite dans
`localStorage` et qu'un rechargement du même onglet conserve bien la session.

**CLOSE le 2026-08-07.** Les tests unitaires éprouvent `sessionStorage` et son repli mémoire. Le
parcours navigateur constate un `localStorage` vide, un jeton présent dans `sessionStorage`, la
session encore active après rechargement, puis le jeton retiré après déconnexion.

---

## Ouverts — suite

### INC-023 — La Definition of Done de `CRM-008` exige des commandes dont les sujets arrivent au chunk 4 — **CLOSE**

**Arbitrage rendu — `docs/JOURNAL.md`, décision 277.** Le responsable retient l'option 2 : la DoD
de `CRM-008` couvre les commandes dont le sujet existe ; `pytest mail-sync/tests` appartient à
`CRM-051`. `e2e:mail`, devenu réel en `CRM-050`, reste la preuve des protocoles de cette unité ; le
parcours mail du produit est dû par `CRM-054` et `CRM-058`. Aucun projet vide n'est créé.

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

**Pourquoi ce n'était pas résolu lors de l'implémentation de `CRM-008`.** Trois conduites étaient
possibles, et deux étaient exclues par `CLAUDE.md` :

1. **Déclarer les projets vides**, pour que les commandes « s'exécutent ». Ce serait une
   déclaration mensongère de complétion (`CLAUDE.md` §26) : `pytest` sur un répertoire sans test
   rend `5`, et un projet Playwright sans scénario rend `0` sans rien avoir exercé. Le dépôt a
   déjà écrit ce refus en toutes lettres dans `e2e/playwright.config.ts` depuis `CRM-007`.
2. **Fabriquer un `mail-sync/` minimal** pour avoir quelque chose à tester : c'est préempter
   `CRM-051` et inventer du périmètre (`CLAUDE.md` §1).
3. **Livrer ce qui est livrable et nommer le reste** : conduite retenue.

**Ce qui était donc livré par `CRM-008`** : `npm run test:sql`, le projet Playwright `api` et ses
fixtures de jetons réels, `npm run e2e:report`, et la preuve de non-complaisance sur chaque famille
de tests. À cette date, `pytest` et `e2e:mail` restaient dus. Depuis, `e2e:mail` a été livré par
`CRM-050` ; `pytest` reste dû exclusivement par `CRM-051` selon l'arbitrage ci-dessus.

**Conséquence avant arbitrage sur l'état de l'unité :** `CRM-008` restait `[~]`. Elle ne pouvait
pas passer `[x]` sans mentir sur deux des sept commandes de sa propre Definition of Done.

**Trois options d'arbitrage examinées :**

1. **Scinder `CRM-008`** en `CRM-008a` — harnais SQL et API, livrable maintenant et close — et
   `CRM-008b` — harnais mail et pytest, rattachée au chunk 4. C'est l'option qui laisse chaque
   unité à son objet, et elle a la préférence de rédaction.
2. **Restreindre la Definition of Done de `CRM-008`** aux commandes dont le sujet existe, et faire
   porter `pytest` par `CRM-051` et `e2e:mail` par `CRM-054`, dont les DoD les mentionnent déjà
   toutes les deux. C'est l'option retenue ; elle rend la fermeture possible après rejeu complet
   du périmètre, sans transformer l'arbitrage documentaire en preuve d'exécution.
3. **Laisser `CRM-008` ouverte jusqu'au chunk 4**, ce qui la ferait traverser tout le chunk 3 en
   `[~]` et contreviendrait à la règle 1 de `docs/MASTER_PLAN.md` §1 — « aucun `[~]` laissé
   derrière soi ».

**Motif confirmé par le responsable.** L'option 2 s'appuie sur un fait vérifiable et non sur une
commodité : la DoD de `CRM-051` exige déjà « pytest unitaire », et celle
de `CRM-054` « pytest unitaire et intégration contre Stalwart » ainsi que « E2E `mail` avec un
email **réellement envoyé** ». Les deux commandes manquantes sont donc **déjà** couvertes par les
unités qui livreront leur sujet ; les exiger aussi de `CRM-008` les compte deux fois.

**Lié à :** INC-013 (fonctions d'autorisation en attente de tables), INC-020 (build dû par l'unité
suivante, close).

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

**MISE À JOUR — 2026-08-04, `CRM-035`.** L'omission n'était pas propre au §2 : le §4 la répète pour
`form_fields`, `form_field_rules` et `card_field_values`, et y ajoute `workspace_id`, que les mêmes
conventions générales exigent « y compris lorsqu'il serait déductible par jointure ».
**Cinquième et sixième occurrences** — après `tracks`, `channels`, `workflow_nodes_catalog` et les
trois tables du §3. `CRM-035` livre ses deux tables avec les trois colonnes et met le §4 à jour dans
le même changement, comme les quatre unités précédentes.

Le nombre d'occurrences change la nature du constat : ce n'est plus une lacune ponctuelle d'un
tableau, c'est une **règle d'écriture** que `docs/SCHEMA.md` n'applique nulle part hors du §1. Si la
lecture retenue est fausse, ce sont désormais **six** migrations à reprendre. L'arbitrage devient
d'autant plus utile qu'il est peu coûteux : une phrase dans les conventions générales suffirait à
dispenser chaque tableau de répéter les colonnes communes.

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

### INC-032 — `./runDev.sh` ne peut pas démarrer à froid derrière un proxy TLS interposé — **CLOSE**

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

**Prédiction vérifiée, le 2026-08-04, pendant `CRM-032`.** La phrase ci-dessus disait « la prochaine
exécution devra le refaire » ; elle a dû le refaire. Sur un conteneur neuf, `./runDev.sh` s'est
arrêté exactement au même endroit, avec le même `SELF_SIGNED_CERT_IN_CHAIN`, et la pile n'a démarré
qu'après un `docker build --secret id=npm_ca,src=…` lancé à la main. Le coût de l'entrée est donc
récurrent, et non ponctuel : chaque exécution de la routine le paie avant de pouvoir produire la
moindre preuve. L'arbitrage attendu ci-dessous n'en devient que plus concret.

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

**Arbitrage et clôture, 2026-08-07.** Le responsable a retenu l'option 1 sous `CRM-015`
(décisions 255 et 280). `docker-compose.dev.yml` transporte maintenant le paquet PEM externe
désigné par `NPM_CA_FILE` jusqu'au secret `npm_ca`; absent ou vide, `/dev/null` garde le build
inerte. `./runDev.sh` aboutit réellement sans puis avec le CA de l'hôte, sans construction
manuelle : scripts **80/80**, pile **50/50**, webapp **42/42**, harnais **28/28**. Aucun certificat
n'est versionné ou conservé dans l'image. INC-032 et INC-042 décrivaient les deux observations du
même défaut ; elles sont closes par la même livraison.

---

### INC-033 — `require_fields` ne peut porter aucune intégrité référentielle, jamais

**Arbitrage rendu — `docs/JOURNAL.md`, décision 262.** **`require_fields` devient une table de liaison `(transition_id, field_id)`** : le modèle est corrigé, pas contourné. L'intégrité référentielle est le travail de la base, pas d'un nettoyage applicatif qu'un chemin de suppression oubliera. Mise en œuvre : `CRM-018`, qui rouvre `CRM-031` et `CRM-035`.

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

**Confirmation mesurée, 2026-08-05.** Les deux prédictions de cette entrée se sont vérifiées à
l'exécution suivante, sur un conteneur neuf :

- la configuration **locale** posée le 2026-08-04 avait disparu — `git config user.email` rendait de
  nouveau `noreply@anthropic.com`. Elle a été reposée **avant** le premier commit, de sorte
  qu'aucune réécriture d'historique n'a été nécessaire cette fois. Elle disparaîtra de nouveau au
  prochain conteneur : le correctif durable annoncé au point 2 ci-dessous reste entier ;
- la branche assignée était encore différente — `claude/happy-goldberg-wq44ln` —, et
  `git ls-remote` en dénombre désormais **dix-huit**, toutes issues d'exécutions successives de la
  même routine. `refs/heads/main` suit bien le travail, mais rien dans le dépôt ne documente qui
  l'y reporte, ni quand, ni selon quelle règle — c'est exactement le point 1 ci-dessous.

Une troisième conséquence, non prévue par cette entrée, a été mesurée le même jour : deux
exécutions ont traité la même unité en parallèle. Voir **INC-059**.

**Troisième occurrence de l'identité, 2026-08-05, pendant la reprise de `CRM-010`.** La prédiction
du point 2 s'est vérifiée une fois de plus : sur un conteneur neuf, `git config user.email` rendait
`noreply@anthropic.com`, et le **commit documentaire de l'unité a été créé puis poussé sous cette
identité** avant que l'écart ne soit vu — la vérification n'ayant lieu qu'après le second commit.
La configuration locale a été reposée à `P2Enjoy <contact@p2enjoy.studio>`, et les **deux** commits
de cette exécution — le documentaire, déjà poussé, et celui de l'unité, non poussé — ont été
réécrits pour la porter, puis republiés. Aucun commit antérieur n'a été touché ; aucun commit
d'une autre exécution n'est concerné.

**QUATRIÈME OCCURRENCE DE L'IDENTITÉ, 2026-08-05, PENDANT LE REJEU DES HARNAIS DE `CRM-042`.** La
prédiction du point 2 s'est vérifiée pour la quatrième fois : conteneur neuf, aucune configuration
**locale**, `git config user.email` rendant `noreply@anthropic.com`. Le commit de cette exécution a
été créé sous cette identité, l'écart vu **immédiatement après**, la configuration locale reposée à
`P2Enjoy <contact@p2enjoy.studio>` et le commit réécrit par `--amend --reset-author` **avant tout
push** — aucune référence distante n'a donc porté l'identité fautive. La branche assignée était
`claude/happy-goldberg-szblin`, et `git branch -a` en dénombre désormais **plus de trente**, toutes
issues d'exécutions successives de la même routine. Les deux points ci-dessous restent entiers.

Le motif est celui déjà retenu : `CLAUDE.md` §13 prévoit l'instruction explicite du responsable
pour réécrire un commit poussé, aucune instruction n'est atteignable pendant une exécution
automatique, et la règle d'attribution est elle-même **non négociable**. La correction est faite et
nommée, plutôt que laissée en l'état.

**CINQUIÈME OCCURRENCE DE L'IDENTITÉ, 2026-08-05, PENDANT `CRM-043`.** Même constat, cinquième
conteneur neuf : aucune configuration **locale**, `git config user.email` rendant
`noreply@anthropic.com`, et `user.signingkey` pointant vers une clé de l'agent. Cette fois l'écart a
été vu **avant le premier commit** : la configuration locale a été posée à
`P2Enjoy <contact@p2enjoy.studio>` — avec `commit.gpgsign false`, la clé globale n'étant pas celle
du responsable — et **aucune réécriture d'historique n'a été nécessaire**. C'est la deuxième
exécution sur cinq où la vérification précède le premier commit ; les trois autres ont dû réécrire.
Le point 2 reste entier : la seule différence entre « réécrire » et « ne rien réécrire » est
l'ordre dans lequel l'agent pense à vérifier, ce qui n'est pas un mécanisme.

**Ce que cette troisième occurrence ajoute au point 2 :** reposer la configuration au début d'une
exécution ne suffit pas si le premier commit est créé avant. Le correctif durable — script
d'amorçage ou variable d'environnement fournie par la routine — n'est plus seulement souhaitable :
il est la seule façon d'éviter une réécriture d'historique à chaque conteneur neuf.

**Ce qui reste à arbitrer :**

1. **La branche.** Soit la routine est autorisée à pousser sur `main` — ce que ses consignes
   demandent —, soit `CLAUDE.md` §13 acte que le travail des exécutions cloud transite par une
   branche et décrit qui l'intègre, et quand. L'état actuel oblige chaque exécution à découvrir le
   travail de la précédente sur une branche qu'elle doit d'abord énumérer.
2. **L'identité.** La configuration locale posée ici vit dans `.git/config`, qui n'est pas versionné :
   elle sera **perdue au prochain conteneur neuf**. Un correctif durable suppose soit un script
   d'amorçage qui la pose, soit une variable d'environnement fournie par la routine.


**QUATRIÈME occurrence du point 2, le 2026-08-05.** Le conteneur de cette exécution rend de nouveau
`user.name = Claude` et `user.email = noreply@anthropic.com`. L'écart a été **vu avant le premier
commit** cette fois — contrairement à la troisième occurrence (décision 159), où deux commits avaient
dû être réécrits —, et la configuration locale a été reposée à `P2Enjoy <contact@p2enjoy.studio>`
avant toute écriture d'historique. Le coût reste **récurrent à chaque conteneur neuf**, et le
correctif durable — script d'amorçage, ou variable d'environnement de l'environnement d'exécution —
reste dû.
---

### INC-035 — Les clés étrangères des migrations `0003`, `0004` et `0005` sont idempotentes sans être convergentes

**Nature :** défaut réel latent, mesuré sur une migration voisine ; les fichiers concernés
appartiennent à des unités déjà vérifiées.
**Relevé le :** 2026-08-04, pendant `CRM-031`.

`CRM-031` a mesuré qu'une contrainte posée en
`if not exists (select 1 from pg_constraint where conname = …)` n'est **jamais réparée** : elle
n'est créée que si le **nom** est absent, si bien qu'une clé remplacée à la main par une clé plus
faible portant le même nom survit à tous les rejeux de la migration. La base reste durablement
affaiblie, et rien ne le signale. Le défaut a été trouvé par la dégradation **d** de
`scripts/verify-workflows.sh`, qui a échoué sur la **restauration** ; il est corrigé dans
`0006_workflows.sql` (`docs/JOURNAL.md`, décision 78).

**Le même motif est présent ailleurs, et n'est pas corrigé ici :**

| Fichier | Contrainte | Unité |
|---|---|---|
| `0004_channels.sql` | `tracks_id_workspace_id_key` (unicité) | `CRM-021` |
| `0004_channels.sql` | `channels_track_id_workspace_id_fkey` | `CRM-021` |
| `0004_channels.sql` | `channel_members_channel_id_fkey` | `CRM-021` |
| `0003_tracks.sql` | `track_members_track_id_fkey` | `CRM-020` |

**Conséquence mesurée sur `CRM-031`, donc reproductible ailleurs.** Une clé composite
`channels_track_id_workspace_id_fkey` remplacée par une clé simple sur `track_id` laisserait un
channel déclarer un `workspace_id` étranger à son track, et la politique de lecture des channels
cloisonnerait alors sur une valeur fausse — exactement ce que `docs/SPEC-channels.md` §2.4 cherche
à empêcher. Aucune commande du dépôt ne rétablirait la clé.

**Ce qui n'est pas fait, et pourquoi.** Corriger ces quatre contraintes reviendrait à rouvrir
`CRM-020` et `CRM-021`, toutes deux vérifiées, dans un commit consacré à une troisième unité, et à
toucher leurs harnais de preuves — ce que `CLAUDE.md` §13 interdit. Le comportement reste
**inchangé** ; aucune de ces contraintes n'est aujourd'hui dégradée sur les bases du projet.

**Arbitrage attendu du responsable.** Trois options :

1. reprendre les deux migrations dans une unité de dette dédiée, en généralisant le mécanisme de
   `0006_workflows.sql` — l'option la plus fidèle à la décision 57, au prix d'une unité de plus ;
2. extraire le mécanisme dans une migration d'amorçage antérieure, de sorte que toutes les
   migrations puissent l'appeler sans le redéfinir, et reprendre les fichiers concernés ;
3. considérer le risque comme théorique — personne ne remplace une contrainte à la main en
   production — et se contenter d'un contrôle de conformité du schéma dans un harnais transverse.

**Lié à :** `docs/JOURNAL.md` décisions 57, 64 et 78 (les trois formes du même défaut).

---

### INC-036 — Les navigateurs préinstallés de l'environnement d'exécution ne correspondent pas au Playwright épinglé

**Nature :** obstacle d'environnement ; aucun fichier du dépôt n'est en cause.
**Relevé le :** 2026-08-04, pendant `CRM-031`.

`package.json` épingle `@playwright/test` 1.62.1, qui attend la révision `1234` du navigateur.
L'environnement de la routine cloud fournit la révision `1194`, sous une arborescence différente —
`chromium_headless_shell-1194/chrome-linux/headless_shell` au lieu de
`chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`.

**Conséquence mesurée.** `npm run e2e:ui` échoue sur ses **37** scénarios, tous avec
« Executable doesn't exist ». Aucune preuve d'interface n'est exécutable, y compris celles qui
n'ont rien à voir avec l'unité en cours. Le projet `api` n'est pas concerné : il ne lance aucun
navigateur.

**Contournement appliqué, et pourquoi il n'est pas la correction.** Une arborescence de
compatibilité a été créée **hors dépôt**, faisant pointer les chemins attendus vers les binaires
présents. Le geste n'est documenté nulle part et la prochaine exécution devra le refaire — même
nature qu'INC-032.

**Prédiction vérifiée, le 2026-08-04, pendant `CRM-032`.** Elle a dû être refaite : le conteneur
neuf fournissait de nouveau la révision `1194`, et `npm run e2e:ui` échouait sur ses **37**
scénarios avant que les liens ne soient recréés. Une fois l'arborescence rétablie, les 37 sont
passés. Comme pour INC-032, le coût est **récurrent**.

**Prédiction vérifiée une SIXIÈME fois, le 2026-08-05, pendant `CRM-036`.** Même révision `1194`
fournie par l'environnement, même exécutable réclamé sous `chromium_headless_shell-1234`, mêmes 37
scénarios rouges. Les liens recréés — `chromium_headless_shell-1234 → 1194`, puis
`chrome-headless-shell-linux64 → chrome-linux` et `chrome-headless-shell → headless_shell` à
l'intérieur —, les 37 scénarios sont passés. Le coût reste **récurrent**, et l'arbitrage reste
attendu.

**Prédiction vérifiée une troisième fois, le 2026-08-04, pendant `CRM-035`.** Même révision `1194`,
même « Executable doesn't exist at
`/opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` »,
mêmes **37** scénarios rouges, y compris ceux qui n'ont rien à voir avec l'unité en cours. Une
observation s'ajoute, et elle aggrave le constat : l'échec est **silencieux pour qui ne lit que le
résumé** — `scripts/verify-webapp.sh` signalait « 10 anomalies » dont neuf « capture manquante », la
cause réelle n'apparaissant qu'en lisant la sortie complète de Playwright. Les liens recréés, les 37
scénarios et les deux harnais concernés sont repassés au vert.

**Ce qui n'est pas fait, et pourquoi.** `e2e/playwright.config.ts` est un livrable de `CRM-008`,
et y écrire un `executablePath` conditionnel reviendrait à rouvrir cette unité pendant un passage
consacré à une troisième — et à faire dépendre la configuration du dépôt d'un chemin propre à un
environnement d'exécution particulier.

**Arbitrage attendu du responsable.** Trois options :

1. aligner la version épinglée de `@playwright/test` sur celle dont l'environnement fournit les
   navigateurs, au prix d'un suivi de version dicté par l'hébergeur ;
2. rendre l'exécutable configurable par une variable d'environnement documentée, lue par
   `e2e/playwright.config.ts` et vide par défaut ;
3. conteneuriser l'exécution des preuves d'interface, de sorte que la révision du navigateur
   appartienne au dépôt et non à la machine — l'option la plus fidèle à `CLAUDE.md` §3, et la plus
   coûteuse.

**Lié à :** INC-032 et INC-034 (même nature : un chemin du dépôt inatteignable depuis
l'environnement réel).

---

### INC-037 — La Definition of Done de `CRM-032` exige la copie de champs dont la table arrive à `CRM-035`

**Nature :** contradiction d'ordonnancement entre `docs/BACKLOG.md`, `docs/SPEC-workflow-engine.md`
§4 et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-032`.

La Definition of Done de `CRM-032` exige un test pgTAP prouvant la « copie complète des étapes, des
transitions **et des champs** ». Les champs de formulaire vivent dans `form_fields`, livrée par
`CRM-035` — étape 3.c de `docs/MASTER_PLAN.md` §2, deux unités après celle-ci. MESURÉ :
`to_regclass('public.form_fields')` rend `NULL`.

C'est le même motif qu'INC-010, INC-013, INC-029 et INC-031 : une preuve dont la cible n'existe pas
encore. La différence tient à ce que la conséquence est ici **nulle** tant que `form_fields`
n'existe pas — il n'y a rien à copier, et rien qui manque.

**Comportement retenu :** la fonction copie ce qui existe. `require_fields` — le seul endroit du
modèle qui désigne des champs — est copié **tel quel**, et le restera correctement après `CRM-035` :
les identifiants qu'il porte désigneront des champs du **workspace**, que la copie ne change pas.
Aucune table n'est créée par anticipation : cela préempterait `CRM-035`.

**Ce qui protège l'écart :** il est **figé par une assertion** et non par un commentaire. La suite
`supabase/tests/0008_copie_workflow.test.sql` constate l'absence de `form_fields` (`hasnt_table`) et
deviendra rouge le jour où `CRM-035` la livrera, forçant la reprise de la fonction et de ses preuves
(mécanisme de la décision 51).

**Risque résiduel :** aucun aujourd'hui. Le jour où `form_fields` existera, une copie faite avant
cette date n'aura pas de champs propres — ce qui est correct, puisque les champs appartiendront au
workspace et non au workflow, ou incorrect si `CRM-035` les rattache au workflow. Ce point est
précisément ce que `CRM-035` devra trancher, l'assertion l'y obligeant.

**Arbitrage attendu du responsable**, à trancher **avant `CRM-035`** :

1. rattacher la copie des champs à `CRM-035`, en l'inscrivant dans sa Definition of Done, et
   retirer le mot « champs » de celle de `CRM-032` ;
2. laisser la Definition of Done de `CRM-032` telle quelle et considérer l'unité comme
   partiellement due jusqu'à `CRM-035` ;
3. créer une unité de reprise dédiée, par exemple `CRM-032b`, placée après `CRM-035`.

**Mise à jour du 2026-08-04, pendant `CRM-035` : la conséquence n'est plus nulle, elle est
mesurable.** `form_fields` existe désormais, et `CRM-035` la rattache bien au **workflow**, comme
`docs/SCHEMA.md` §4 l'imposait. C'est la branche que cette entrée annonçait comme « incorrecte » :
la copie posée par le seed porte **zéro champ** là où sa source en porte **sept**. Un channel qui
suivrait la copie afficherait un formulaire vide, sans qu'aucune erreur ne le signale.

Le comportement de `copy_workflow_to_track` reste **inchangé**. La corriger reviendrait à trancher
l'option 1 ci-dessous à la place du responsable, et à rouvrir `CRM-032` — sa fonction, sa suite
pgTAP, ses scénarios d'API et son harnais — pendant un passage consacré à `CRM-035`, ce que
`CLAUDE.md` §13 interdit. C'est le raisonnement déjà retenu pour INC-024, INC-030 et INC-031.

Les trois garde-fous que cette entrée avait posés ont échoué comme prévu, et ont été **révisés
plutôt que retirés** — mécanisme de la décision 51 :

| Garde-fou | Avant | Après |
|---|---|---|
| `supabase/tests/0007_workflows.test.sql` | `hasnt_table('form_fields')` | la table existe, et `require_fields` reste vide dans le seed |
| `supabase/tests/0008_copie_workflow.test.sql` | `hasnt_table('form_fields')` | la table existe, la source porte des champs, **la copie n'en porte aucun** |
| `scripts/verify-copie-workflow.sh` | « `form_fields` n'existe toujours pas » | l'écart est mesuré et chiffré à chaque exécution |

L'écart n'est donc plus une prédiction : il est **compté**, et le jour où la copie des champs sera
écrite, ce sont ces trois assertions qui exigeront leur propre révision.

**Lié à :** INC-013, INC-029, INC-031 (mêmes contradictions d'ordonnancement), INC-033
(`require_fields` sans intégrité référentielle), INC-043 (le même mode de défaillance, sixième
occurrence), `docs/SPEC-form-composer.md` §2.10 et point ouvert n° 3.

---

### INC-038 — Le signalement de divergence ne voit pas une suppression dans la source

**Nature :** limite mesurée du mécanisme livré par `CRM-032` ; `docs/SPEC-workflow-engine.md` §4.1
promet davantage que ce que le signal détecte.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-032`.

Le §4.1 exige que l'interface signale « ce workflow dérive de *X*, **modifié depuis** le
*jj/mm/aaaa* ». Le signal livré, `workflow_derivations.source_modified_since_copy`, compare
`derived_at` au plus récent `updated_at` du workflow source **et de sa composition**.

**MESURÉ :** une **suppression** dans la source ne modifie aucun `updated_at`. Après avoir retiré
une transition du workflow source, `source_modified_since_copy` vaut toujours **faux**, alors que la
source a bel et bien divergé de sa copie. Le même angle mort vaut pour une étape retirée.

**Comportement retenu par `CRM-032` :** le signal est livré tel quel, sa portée exacte est écrite au
§4.6, et l'angle mort est **figé par une assertion** de `supabase/tests/0008_copie_workflow.test.sql`
qui le constate — de sorte qu'il ne puisse pas être oublié, et qu'une correction future rende
l'assertion rouge. Aucune règle n'est inventée : chacune des corrections possibles engage le schéma,
ce qui dépasse le périmètre d'une unité consacrée à la copie.

**Risque résiduel :** un administrateur qui retire une arête d'un workflow global ne verra apparaître
aucune mention de divergence sur les copies qui en dérivent. Il est borné par le fait qu'aucune copie
n'existe hors du seed, et que l'interface qui afficherait la mention n'existe pas non plus (INC-021).

**Arbitrage attendu du responsable**, à trancher avant que l'interface de `CRM-032` ne soit écrite :

1. stocker à la copie le nombre d'étapes et de transitions copiées, et comparer les cardinalités —
   deux colonnes de plus sur `workflows`, absentes de `docs/SCHEMA.md` §3 ;
2. journaliser les suppressions d'étapes et de transitions dans une table d'événements, ce que
   `card_events` fera pour les cards et qui n'existe pas pour les workflows ;
3. calculer une empreinte de la composition de la source — une somme des identifiants et des
   horodatages — et la comparer à celle enregistrée à la copie, au prix d'une colonne et d'un
   calcul à chaque lecture.

**Lié à :** INC-021 (aucune interface pour afficher la mention), `docs/JOURNAL.md` décision 84.

---

### INC-039 — La suppression d'un workspace échoue lorsqu'un de ses workflows instancie ses nœuds

**Nature :** conséquence non anticipée de deux clés étrangères livrées par des unités différentes.
**Relevé le :** 2026-08-04, pendant les mesures de `CRM-032`.

MESURÉ, et reproductible : `delete from public.workspaces where id = …` échoue en `23503` dès qu'un
workflow du workspace porte au moins une étape.

```
ERROR:  update or delete on table "workflow_nodes_catalog" violates foreign key constraint
        "workflow_steps_node_id_workspace_id_fkey" on table "workflow_steps"
DETAIL: Key (id, workspace_id)=(…) is still referenced from table "workflow_steps".
```

La cause est l'ordre dans lequel PostgreSQL propage les cascades. `workspaces` cascade vers
`workflow_nodes_catalog` (`CRM-030`) **et** vers `workflows` (`CRM-031`) ; `workflows` cascade
ensuite vers `workflow_steps`. Lorsque le catalogue est traité avant les workflows, la clé
`workflow_steps.node_id`, posée en `on delete restrict` à dessein (§3.3 : l'effacement silencieux
des étapes détruirait des workflows entiers sans le dire), bloque la suppression entière.

**Ce n'est pas un défaut du `on delete restrict`**, qui protège exactement ce qu'il doit protéger.
C'est une interaction entre deux règles, chacune correcte isolément, que personne n'avait mesurée.

**Conséquence pratique.** Toute suppression d'un workspace — nettoyage de harnais, purge RGPD,
réinitialisation partielle — doit retirer les étapes **avant** le workspace. Les harnais livrés y
échappent par accident : ils suppriment les workflows avant les workspaces, ce qui emporte les
étapes en cascade. Le fait est écrit ici pour que ce ne soit plus un accident.

**Comportement retenu :** aucun changement de schéma. Le contournement — supprimer dans l'ordre —
est appliqué par le harnais de `CRM-032`, et le fait est **figé par une assertion** de
`supabase/tests/0008_copie_workflow.test.sql`, qui provoque le refus et le constate.

**Arbitrage attendu du responsable :**

1. laisser en l'état et documenter l'ordre de suppression comme une contrainte d'exploitation ;
2. passer `workflow_steps.node_id` en `on delete cascade`, ce qui contredirait le §3.3 et rendrait
   silencieuse la destruction d'un workflow par une purge du catalogue ;
3. livrer une fonction `app.purge_workspace(uuid)` qui applique l'ordre correct, à rattacher à
   l'unité RGPD `CRM-072`.

**Lié à :** `docs/SPEC-workflow-engine.md` §3.3 (`on delete restrict` et son motif), `CRM-072`
(conformité RGPD, où une purge réelle sera écrite).

---

### INC-040 — Quatre écritures cassent la cohérence workflow ↔ channel, là où la spécification n'en nommait que deux

**Nature :** insuffisance de la spécification d'origine, constatée par la mesure.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-033`.

Le §4.12 de `docs/SPEC-workflow-engine.md`, écrit à `CRM-000`, nommait deux gestes à surveiller :
l'affectation d'un workflow à un channel, et le déplacement d'un channel vers un autre track. La
mesure en trouve **quatre**, toutes acceptées sur la base du seed :

| # | Écriture | Table visée |
|---|---|---|
| 1 | Rattacher un channel de `studio-web` au workflow `track` de `conseil-ia` | `channels` |
| 2 | Déplacer vers `studio-web` un channel de `conseil-ia` suivant le workflow `track` de `conseil-ia` | `channels` |
| 3 | Changer le `track_id` d'un workflow `track` **sous** les channels qui le suivent | `workflows` |
| 4 | Faire passer le workflow **par défaut** de `global` à `track` sous ses six channels | `workflows` |

Les portes 3 et 4 ne passent pas par la table que la règle prétendait surveiller. La quatrième
invalide d'un seul `UPDATE` le rattachement des **six** channels du seed.

**Comportement retenu :** la spécification est corrigée dans le même changement — §4.12 réécrit après
mesure — et `CRM-033` livre **deux** triggers plutôt qu'un, `docs/JOURNAL.md` décision 89. L'entrée
est ouverte parce que l'écart entre ce qu'une spécification énonce et ce que la base tolère mérite
d'être tracé, non parce qu'il resterait quelque chose à trancher.

**Ce qui reste à arbitrer :** rien pour `CRM-033`. En revanche, le mode de défaillance est
**transverse** : chaque fois qu'une règle relie deux tables, la spécification d'origine n'a nommé que
la table « évidente ». Le responsable peut vouloir qu'une relecture systématique des chapitres non
encore mesurés — §5 à §9 de ce document, `docs/SPEC-form-composer.md` — cherche les portes
symétriques avant que les unités correspondantes ne les découvrent une à une.

**Lié à :** `docs/SPEC-workflow-engine.md` §4.12.1 (les quatre portes), `docs/JOURNAL.md`
décision 89 ; INC-029 (la dette `NOT NULL` que la même unité solde).

---

### INC-041 — Le seed de `CRM-032` est idempotent sans être convergent : une copie déplacée en fait naître une seconde

**Nature :** défaut réel du produit livré, trouvé par la mesure et reproductible.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-033`.

La section 7 du seed cherche la copie du workflow par `derived_from_workflow_id` **et** par
`track_id`. MESURÉ, en quatre gestes reproductibles :

```
1. seed appliqué sur une base neuve          → 1 copie, sur le track « Conseil & IA »
2. track_id de la copie déplacé à la main    → 1 copie, sur « Formation »
3. seed rejoué                               → la recherche ne trouve rien
4. état final                                → 2 copies, sur deux tracks différents
```

Le contrat du §4.10 en déclare **une**. Le seed en laisse deux, sans erreur ni avertissement.

C'est la troisième forme du défaut de la décision 57, après celle de `CRM-020` sur une contrainte
`CHECK` et celle de `CRM-031` sur une contrainte nommée : un mécanisme **idempotent** — rejouable
sans erreur — qui n'est pas **convergent** — il ne ramène pas l'état à ce que le contrat déclare.
Cette fois, ce n'est pas une migration mais un seed, ce qui explique qu'aucun des garde-fous posés
pour les deux précédentes ne l'ait vu.

**Comportement retenu :** corrigé par `CRM-033`, dans le même changement que la réécriture de la
section du seed qu'impose la contrainte `NOT NULL` (§4.12.5). La copie est cherchée par sa **seule**
dérivation, et son `track_id` est **ramené** à la valeur déclarée plutôt que servir de critère de
recherche. Le harnais de `CRM-033` reproduit la dégradation et constate la restauration, sans quoi le
défaut pourrait revenir en silence.

**Ce qui reste à arbitrer :** faut-il un contrôle transverse de convergence du seed — un harnais qui
dégraderait chaque objet déclaré et vérifierait que le rejeu le ramène —, plutôt qu'une vérification
ajoutée unité par unité après chaque défaut trouvé ? Les trois occurrences plaident pour, mais le
coût est celui d'un harnais de plus, à maintenir avec le contrat du seed.

**Lié à :** `docs/JOURNAL.md` décisions 57, 64, 78 (les formes précédentes du même défaut) et 91 ;
`docs/SPEC-workflow-engine.md` §4.12.7 ; `docs/SPEC-seed.md` §2.9.

---

### INC-042 — L'image de la webapp ne se construit pas dans l'environnement de la routine : le registre npm est derrière un proxy à certificat interposé — **CLOSE**

**Arbitrage rendu — `docs/JOURNAL.md`, décision 255.** **Le secret de build `npm_ca` est câblé**, dans une unité à part entière : `CRM-015`. Onzième occurrence — c'est une mesure, pas une malchance —, et le coût réel est une **preuve perdue à chaque unité**. Contrainte non négociable : le certificat vient de l'environnement, jamais du dépôt, et l'assemblage reste inerte là où la variable est absente.

**Contrat de mise en œuvre — décision 280.** `NPM_CA_FILE` porte uniquement un chemin PEM absolu
et lisible ; Compose le remplace par `/dev/null` lorsqu'il est absent ou vide. `runDev.sh` valide
la valeur effective avant Docker, y compris la priorité du shell sur `.env`. Les anciens `.env`
peuvent omettre cette variable facultative. La fermeture exige deux builds sans cache, l'absence
du secret et du `cafile` dans l'image finale, puis le lancement réel dans les deux configurations.

**Clôture, 2026-08-07.** `CRM-015` câble `${NPM_CA_FILE:-/dev/null}` au secret BuildKit
`npm_ca`, valide la valeur effective avant Docker et accepte les anciens `.env`. Les deux builds
sans cache rendent les marqueurs `inactif` puis `actif`; l'image ne garde ni secret, ni `cafile`,
ni `.npmrc` non vide. `./runDev.sh` aboutit réellement sans puis avec le paquet PEM de l'hôte.
Preuves finales : scripts **80/80**, pile **50/50**, webapp **42/42**, harnais **28/28** dont UI
**144/144 sans avertissement**. Aucun certificat n'est versionné ; aucune opération de production.

**Nature :** obstacle d'environnement ; aucun fichier du dépôt n'est en cause.
**Relevé le :** 2026-08-04, pendant `CRM-033`.

`./runDev.sh --dev` échoue à la construction de l'image `webapp`, avant tout démarrage :

```
npm error code SELF_SIGNED_CERT_IN_CHAIN
npm error request to https://registry.npmjs.org/… failed,
            reason: self-signed certificate in certificate chain
```

L'environnement de la routine route tout le trafic HTTPS sortant par un proxy qui **interpose son
propre certificat**, et fournit son autorité de certification à l'hôte. Le conteneur de construction,
lui, ne l'a pas. `webapp/Dockerfile` a prévu exactement ce cas — il monte un secret facultatif
`npm_ca` et le pose en `cafile` s'il est fourni — mais **aucun fichier Compose ne déclare ce
secret** : le point d'entrée existe, rien ne le branche.

**Contournement appliqué, et pourquoi il n'est pas la correction.** La pile a été démarrée **sans le
service `webapp`**, en nommant les douze autres services. C'est sans effet sur les preuves : le
projet Playwright `ui` démarre son **propre** serveur Vite sur l'hôte (`e2e/playwright.config.ts`),
et le conteneur `webapp` ne sert qu'au confort de développement. Les 37 scénarios d'interface ont été
exécutés et sont verts. Sur l'hôte, `npm ci` a exigé le même geste — `npm config set cafile` vers le
paquet d'autorités du proxy — avant de réussir.

Le geste n'est documenté nulle part et la prochaine exécution devra le refaire : même nature
qu'INC-032 et INC-036, et **troisième** coût récurrent de cet environnement.

**Ce qui n'est pas fait, et pourquoi.** Brancher le secret dans `docker-compose.dev.yml` ferait
dépendre le fichier Compose d'un chemin propre à un environnement d'exécution particulier, et
`docker-compose.dev.yml` est un livrable de `CRM-001` : le modifier pendant un passage consacré à une
autre unité rouvrirait celle-là.

**Arbitrage attendu du responsable.** Trois options :

1. déclarer dans `docker-compose.dev.yml` un secret de build `npm_ca` alimenté par une variable
   d'environnement documentée et **vide par défaut**, de sorte qu'un poste sans proxy ne change pas
   de comportement — l'option la plus proche de ce que le `Dockerfile` a déjà prévu ;
2. documenter le contournement dans `README.md` et l'assumer comme une contrainte de l'hébergeur ;
3. ne rien faire, la webapp conteneurisée n'étant nécessaire à aucune preuve — au prix d'un
   `./runDev.sh` qui échoue par défaut dans cet environnement.

**Lié à :** INC-032 et INC-036 (mêmes coûts récurrents), `webapp/Dockerfile` (le secret prévu),
`docker-compose.dev.yml` (le service `webapp`).

**Prédiction vérifiée, le 2026-08-04, pendant `CRM-035`.** L'entrée disait « la prochaine exécution
devra le refaire » ; elle a dû le refaire. `./runDev.sh --dev` s'est arrêté au même endroit, avec le
même `SELF_SIGNED_CERT_IN_CHAIN` — et l'on note au passage que `--dev`, qui écarte la webapp par
`--scale webapp=0`, **ne dispense pas de la construire** : Compose bâtit l'image d'un service même
lorsqu'il n'en démarre aucune instance. L'option documentée comme « sans la webapp » n'offre donc
aucun contournement. La pile n'a démarré qu'après un
`docker build --secret id=npm_ca,src=… -f webapp/Dockerfile -t p2enjoy-crm-webapp .` lancé à la
main ; une fois l'image présente, `./runDev.sh` complet a rendu **quinze services**, `webapp`
compris et sain. Quatrième exécution consécutive à payer ce coût, et première à obtenir le
conteneur `webapp` réellement démarré.

---

### INC-043 — `CRM-034` précède de trois à dix unités toutes les tables dont sa garde a besoin

**Nature :** contradiction d'ordonnancement entre `docs/MASTER_PLAN.md` §2,
`docs/SPEC-workflow-engine.md` §5 et `docs/BACKLOG.md`.
**Relevé le :** 2026-08-04, avant de choisir l'unité de ce passage.

`docs/MASTER_PLAN.md` §2 place `CRM-034` — la garde centrale `move_card` — à l'étape 3.b, et le
justifie ainsi : « le moteur de workflow avant les cards, car une card naît dans une étape ». Le
raisonnement vaut pour `CRM-030` à `CRM-033`, qui décrivent le graphe. Il **s'inverse** pour
`CRM-034`, dont les six vérifications du §5 ne portent sur rien d'autre que des cards.

MESURÉ sur la base du seed, la pile en marche :

```
cards=NULL   card_events=NULL   card_comments=NULL   card_field_values=NULL
form_fields=NULL   form_field_rules=NULL   move_card=NULL
```

Chacune des six vérifications exigées, et l'unité qui livrera sa cible :

| # | Vérification du §5 | Objet requis | Unité |
|---|---|---|---|
| 1 | La card existe et n'est ni archivée ni supprimée | `cards` | `CRM-040` |
| 2 | L'appelant a le droit d'écriture sur le channel | `cards`, `app.can_write_channel` | `CRM-040`, `CRM-012` |
| 3 | L'étape cible appartient au workflow de la card | `cards` | `CRM-040` |
| 4 | Une transition est déclarée | `cards` (livrée : `workflow_transitions`) | `CRM-040` |
| 5 | Le commentaire est fourni si la transition l'exige | `card_comments` | `CRM-043` |
| 6 | Les champs requis de l'étape cible sont renseignés | `form_fields`, `form_field_rules`, `card_field_values` | `CRM-035`, `CRM-036` |

Et l'effet de bord exigé en cas de succès — « écriture d'un `card_event` de type `moved` » — vise
`card_events`, livrée par `CRM-044`.

C'est le sixième cas du même mode de défaillance, après INC-010 (clés étrangères), INC-013
(jointures d'autorisation), INC-029 (une colonne), INC-031 (une cible d'archivage) et INC-037 (des
champs à copier). Il s'en distingue par son **ampleur** : les précédents laissaient une part
livrable de l'unité, celui-ci n'en laisse **aucune**. `move_card` sans `cards` n'est pas une garde
partielle, c'est une signature vide.

**Comportement retenu :** `CRM-034` n'est pas commencée, et reste `[ ]`. Aucune table n'est créée
par anticipation — cela préempterait `CRM-040`, `CRM-043` et `CRM-044` en même temps. Le passage a
pris l'unité `[ ]` suivante que l'ordre du plan n'interdit pas, `CRM-035`, dont les deux tables ne
dépendent que de `workflows` et de `workflow_steps`, livrées. **Aucune contrainte d'ordre de
`docs/MASTER_PLAN.md` §2 n'est enfreinte** : les trois qui concernent ces unités sont « `CRM-034`
avant `CRM-041` », « `CRM-036` avant `CRM-037` » et « `CRM-004` avant `CRM-052` », toutes intactes.

**Arbitrage attendu du responsable.** Trois options :

1. **déplacer `CRM-034` après `CRM-040`** dans `docs/MASTER_PLAN.md` §2, en conservant la
   contrainte « `CRM-034` avant `CRM-041` » qui reste juste — l'ordre deviendrait
   `CRM-035` → `CRM-036` → `CRM-040` → `CRM-034` → `CRM-037` → `CRM-041` ;
2. **scinder `CRM-034`** en une partie livrable maintenant — le catalogue des refus, leurs
   `SQLSTATE` et le format du message listant les clés manquantes — et une partie exécutable après
   `CRM-040`, au prix d'une unité dont la moitié ne s'exécute jamais ;
3. **laisser l'ordre inchangé** et accepter que `CRM-034` reste bloquée jusqu'à `CRM-040`, ce qui
   revient à l'option 1 sans l'écrire.

**Lié à :** INC-010, INC-013, INC-029, INC-031, INC-037 (le même mode de défaillance, cinq fois
avant celui-ci), INC-023 (une Definition of Done dont les sujets arrivent plus tard).

---

### INC-044 — Sans `ss` ni `netstat`, la garde de ports est silencieusement inerte — **CLOSE**

**Arbitrage rendu — `docs/JOURNAL.md`, décision 257.** **La garde lit `/proc/net/tcp` en dernier recours.** Seule option qui ferme les deux entrées et rende la garde réellement protectrice plutôt qu'apparemment protectrice. Rattachement : `CRM-002`. Exigence : la lecture est prouvée **dans les deux sens**.

**Nature :** garde livrée par `CRM-002` dont l'hypothèse d'outillage n'est pas vérifiée.
**Relevé le :** 2026-08-04, pendant `CRM-035`, en rejouant les harnais après synchronisation.

`scripts/lib/env.sh` a reçu, pendant ce passage et par une autre exécution de la routine, la garde
`require_free_ports` et sa fonction de lecture `host_listening_ports`. Celle-ci essaie `ss`, puis
`netstat`, et **ne dit rien si aucun des deux n'existe** :

```sh
host_listening_ports() {
	if command -v ss >/dev/null 2>&1; then …
	elif command -v netstat >/dev/null 2>&1; then …
	fi
}
```

MESURÉ sur l'hôte de la routine : ni `ss` ni `netstat` ne sont installés. La fonction rend donc
**zéro ligne**, la garde conclut que tous les ports sont libres, et `./runDev.sh` démarre — ce qui
s'est produit ici. Le contrôle 52 de `scripts/verify-scripts.sh`, qui compare un port dont Docker
affirme qu'il est publié à la liste des ports en écoute, **échoue** : c'est lui qui a révélé le
point, et il fonctionne exactement comme prévu.

Le mode de défaillance est celui que `CLAUDE.md` §18 nomme « valeur par défaut trompeuse » : une
liste vide ne signifie pas « aucun port pris », elle signifie « je ne sais pas ». Là où la garde
devait remplacer un échec obscur de Compose par un refus explicite, elle rend le silence — sur un
poste dépourvu des deux outils, le symptôme d'origine reviendrait à l'identique, et l'opérateur
aurait de surcroît la garde comme preuve apparente que les ports vont bien.

**Comportement retenu :** **inchangé**. `scripts/lib/env.sh` et `scripts/verify-scripts.sh` sont
des livrables de `CRM-002`, `[x]` et vérifiée ; les corriger pendant un passage consacré à
`CRM-035` rouvrirait cette unité et toucherait ses 52 contrôles dans un commit qui n'en traite pas
(`CLAUDE.md` §13). Le contrôle en échec est **laissé en échec** et nommé dans le compte rendu :
le masquer serait exactement ce que `CLAUDE.md` §18 interdit.

**Arbitrage attendu du responsable.** Trois options :

1. faire **échouer bruyamment** `require_free_ports` lorsque aucun des deux outils n'est
   disponible — le plus fidèle à son intention, au prix d'un prérequis de plus à documenter ;
2. ajouter une troisième source de lecture qui ne dépend d'aucun paquet — `/proc/net/tcp` et
   `/proc/net/tcp6` sont lisibles partout où le noyau est Linux, et donnent les ports en
   hexadécimal ;
3. accepter l'inertie et la **documenter** dans `README.md`, la garde n'étant qu'un confort.

**Lié à :** `docs/JOURNAL.md` décision 99 (la garde et son intention), `CLAUDE.md` §18 (ne jamais
masquer une erreur par une valeur par défaut trompeuse), INC-032, INC-036 et INC-042 (autres écarts
entre l'hôte supposé et l'hôte réel).

**CLOSE le 2026-08-07 par la reprise de `CRM-002`.** `host_listening_ports` essaie toujours `ss`,
puis `netstat`, mais lit désormais `/proc/net/tcp` et `/proc/net/tcp6` si les deux outils manquent.
La preuve force réellement ce dernier chemin : une socket ouverte par le harnais apparaît, puis le
même port disparaît après l'arrêt et l'attente de son détenteur. La conversion IPv4/IPv6 et le
filtrage du seul état `LISTEN` ont leur contre-épreuve déterministe. `verify-scripts.sh` : **64/64**.

---

### INC-045 — Aucun chapitre ne nommait les politiques de `track_members` et `channel_members`

**Nature :** référence manquante dans `docs/SPEC-permissions-rls.md` §4.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-012`.

Le tableau « Politiques par famille de tables » du §4 énumère vingt tables, de `profiles` à
`saved_views`. `track_members` et `channel_members` n'y figuraient pas — alors qu'elles sont
l'objet même de `CRM-012`, dont le titre est « droits fins par track et channel ». Le document
spécifiait donc comment un droit fin **se résout** (§2.2) sans jamais dire qui a le droit d'en
**poser** un, ni de le lire.

C'est la jumelle d'INC-014, à une différence près qui change tout : INC-014 constate que les
politiques des tables d'**identité** ne sont portées par aucune unité, et l'attribution reste
ouverte ; ici, l'unité qui porte les tables est nommée sans ambiguïté par son propre titre, et
c'est la **règle** qui manquait, non son porteur.

**Comportement retenu :** la règle est écrite en `docs/SPEC-permissions-rls.md` §4.1, dans le
commit documentaire qui précède le code, et les tables sont ajoutées au tableau du §4. Sans elle,
`CRM-012` aurait livré un mécanisme de droits fins qu'aucun administrateur ne peut opérer depuis le
produit : les deux tables restaient en refus par défaut depuis `CRM-003`, et seul `service_role`
pouvait y écrire.

**Ce qui n'est pas décidé ici :** rien qui déborde des deux tables. Les politiques des tables
d'identité restent hors de `CRM-012` (INC-014), et la règle « un administrateur ne peut pas se
retirer son propre rôle s'il est le dernier » — preuve n° 10 — reste sans porteur.

**Arbitrage attendu du responsable :** confirmer la règle du §4.1, en particulier le choix de
réserver la **lecture** d'un droit fin à l'administration et à l'intéressé. Un produit qui
afficherait « qui a accès à ce channel » à tout membre du workspace exigerait une lecture plus
large ; c'est un choix de produit, et il est réversible.

**Lié à :** INC-011 (l'absence de `workspace_id` oblige les politiques à remonter par `tracks`),
INC-013, INC-014, INC-024 et INC-030.

---

### INC-046 — « Figé à la création, suit le channel » énonce deux règles distinctes, et la seconde interdit un geste que nulle spécification n'aborde

**Arbitrage rendu — `docs/JOURNAL.md`, décision 263.** **Le geste pluriel est retenu et nommé `change_channel_workflow`.** Le pluriel du `docs/SCHEMA.md` §9 n'était pas une erreur de rédaction : il décrivait une fonction que personne n'avait nommée. `move_card_to_channel` est retenue **inchangée**. Mise en œuvre : `CRM-019`.

**Nature :** énoncé ambigu de `docs/SCHEMA.md` §5, dont la lecture structurelle produit une règle
de produit non spécifiée.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-040`.

`docs/SCHEMA.md` §5 décrit `cards.workflow_id` ainsi : « `FK`, non nul — **figé à la création, suit
le channel** ». Deux exigences s'y lisent, qui ne demandent pas la même garde :

1. « **suit le channel** » — le workflow d'une card est celui de son channel. Tenu en permanence par
   la clé étrangère composite `(channel_id, workflow_id) → channels (id, workflow_id)` ;
2. « **figé** » — la colonne ne peut pas être réécrite. Un gel littéral interdirait
   `move_card_to_channel` (`CRM-045`), dont l'objet est précisément de changer `channel_id` **et**
   `workflow_id` ensemble.

`CRM-040` retient la lecture n° 1, qui est la plus faible et la seule qui ne préempte pas `CRM-045`.
Ce n'est pas la contradiction relevée ici.

**Ce qui est relevé est la conséquence de la clé composite, mesurée sur la sonde `sonde_c4` :**

```
ERROR:  update or delete on table "channels" violates foreign key constraint
        "sonde_c4_wf_fk" on table "sonde_c4"
DETAIL: Key (id, workflow_id)=(…) is still referenced from table "sonde_c4".
```

Autrement dit : **changer le `workflow_id` d'un channel qui porte au moins une card devient
refusé**, en `23503`, donc `409` par l'API. La règle est défendable — repointer le workflow d'un
channel sous des cards existantes les laisserait sur des étapes d'un graphe qu'elles ne suivent
plus, et `CRM-045` prévoit un remappage **explicite** pour le cas voisin du changement de channel.
Elle n'en est pas moins une **règle de produit que personne n'a décidée** : ni `docs/SPEC-channels.md`,
ni `docs/SPEC-workflow-engine.md`, ni la Definition of Done de `CRM-021` ou de `CRM-033` ne
l'énoncent. Aucune n'aborde le changement de workflow d'un channel déjà en service.

**Comportement retenu :** la clé composite est posée, la règle émergente est **écrite** dans
`docs/SPEC-cards.md` §2.4 et **figée par une assertion** de la suite pgTAP, qui constate le refus.
L'alternative — remplacer la clé par un trigger `BEFORE INSERT` sur `cards` — laisserait la
cohérence se rompre en silence à la première mise à jour d'un channel, ce qui est strictement pire
qu'une règle non décidée mais visible.

**Risque résiduel :** un administrateur qui souhaite légitimement changer le workflow d'un channel
devra d'abord vider ce channel de ses cards. Aucune interface ne l'expose aujourd'hui (INC-021), et
le message d'erreur est celui de PostgreSQL, non un message produit.

**Ce n'est pas un risque théorique : le seed du projet l'exerce déjà, et MESURÉ il tombe.** Le
channel `prospection` est le seul que le seed **repointe**, deux fois par exécution — la section 4
le ramène au workflow global déclaré, la section 7 le rattache à la copie de portée track livrée par
`CRM-032`. Une card posée dans ce channel, puis le seed rejoué : **échec, code de sortie `1`**, dès
la section 4.

```
ERREUR création du channel prospection : code HTTP 409, attendu 200 201.
  {"code":"23503","details":"Key (id, workflow_id)=(…31, 244bbfc6-…) is still referenced
   from table \"cards\"", …}
```

Contre-épreuve mesurée : une card dans `grands-comptes`, dont le workflow ne change jamais, laisse
le seed **vert**, code de sortie `0`, zéro erreur. Le conflit est donc **exactement** celui décrit
ci-dessus, et pas un effet de bord plus large.

**Ce que `CRM-040` en fait, et ce qu'elle refuse de faire.** Le seed de `CRM-040` **ne pose aucune
card dans `prospection`**, ce qui le laisse convergent, et le motif est écrit dans
`docs/SPEC-cards.md` §9.1 plutôt que tu. Deux corrections étaient possibles, toutes deux écartées :

1. **rendre conditionnels les deux `PATCH` de convergence du seed**, pour qu'ils ne s'exécutent que
   si la valeur diffère. Cela ne suffit pas : sur un rejeu, `prospection` est bien sur la copie, la
   section 4 la ramène bien au global, et la valeur **diffère** réellement. Le geste resterait
   nécessaire et resterait refusé ;
2. **faire déplacer les cards par le seed** avant de repointer le channel, puis les ramener. C'est
   écrire à la main ce que `CRM-045` doit livrer, dans un seed, sans garde ni événement — soit
   exactement le « geste fabriqué » que `CLAUDE.md` §8 proscrit.

Aucune des deux ne tranche l'arbitrage ci-dessous ; elles le contourneraient. Le comportement de
`CRM-032` et de `CRM-033` reste donc **inchangé**, et la contradiction reste visible.

**Conséquence à ne pas perdre de vue :** tant que la règle n'est pas arbitrée, le seed ne peut pas
démontrer une card sur un **workflow dérivé**. La divergence de `CRM-032` reste donc démontrée par
ses étapes et ses transitions, jamais par une card qui les emprunterait.

**Arbitrage attendu du responsable.** Trois options :

1. **confirmer la règle** et l'inscrire dans `docs/SPEC-channels.md` — le changement de workflow
   d'un channel occupé est refusé, et passe par le vidage ou par `CRM-045` card par card ;
2. **prévoir un remappage de channel**, symétrique de `move_card_to_channel` : une RPC qui change le
   workflow d'un channel **et** remappe l'étape de chacune de ses cards, dans la même transaction.
   C'est une unité de backlog qui n'existe pas ;
3. **relâcher la contrainte** en laissant les cards conserver leur ancien workflow, ce qui produirait
   des cards dont le workflow diffère de celui de leur channel — l'exact contraire de « suit le
   channel ».

**Lié à :** INC-029 (la colonne `workflow_id` de `channels`, différée puis livrée par `CRM-033`),
INC-033 (une intégrité que le type interdit), INC-043 (`CRM-034` sans cible), `CRM-045`.

---

### INC-047 — La sixième vérification de `move_card` lit une table que le plan livre après elle — **CLOSE**

**Nature :** contradiction d'ordonnancement entre `docs/MASTER_PLAN.md` §2 et la Definition of Done
de `CRM-034`.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-034`.

`docs/SPEC-workflow-engine.md` §5 exige six vérifications. La sixième — « les champs requis de
l'étape cible sont **renseignés** », message `missing_required_fields` portant la liste des clés —
compare deux ensembles :

- l'**ensemble exigé**, calculable dès aujourd'hui : les champs `required` de l'étape cible dans
  `form_field_rules`, unis aux `require_fields` de la transition empruntée
  (`docs/SPEC-form-composer.md` §3.5). Les deux tables existent depuis `CRM-035` ;
- l'**ensemble renseigné**, qui n'a **aucune source**. `card_field_values` est le livrable de
  `CRM-036`, unité que `docs/MASTER_PLAN.md` §2 place **après** `CRM-034`. MESURÉ le 2026-08-04 :
  `to_regclass('public.card_field_values')` rend `NULL`.

C'est la seconde occurrence du problème d'INC-043 : `CRM-034` précède les tables sur lesquelles elle
opère. La première avait été réglée par le temps — `cards` est arrivée. Celle-ci ne le sera pas :
`CRM-036` reste devant.

**Les deux écritures possibles sont l'une destructrice, l'autre mensongère.**

1. **Rien n'est renseigné, donc toute transition à ensemble exigé non vide est refusée.** Lecture
   littérale, et MESURÉE destructrice : le seed déclare `required` sur `prospection`, `negociation`,
   `signature` et `perdu`. Les entrées en négociation, en signature et les **quatre** transitions
   « Marquer perdu » seraient refusées jusqu'à `CRM-036`. La garde interdirait le parcours qu'elle
   garde, et `CRM-041` n'aurait plus rien à démontrer ;
2. **Tout est renseigné, donc rien n'est vérifié** en le présentant comme vérifié. C'est le faux
   vert que `CLAUDE.md` §17 proscrit nommément.

**Comportement retenu :** la vérification n° 6 n'est **pas écrite**. `CRM-034` livre cinq
vérifications sur six, l'unité reste `[~]`, et l'écart est **figé par une assertion** de
`supabase/tests/0013_move_card.test.sql` : un déplacement vers une étape portant une règle
`required` réussit aujourd'hui, et cette assertion deviendra **rouge** le jour où `CRM-036`
livrera `card_field_values`. C'est le mécanisme employé par `CRM-040` pour la protection de colonne,
qui a effectivement désigné son moment.

**Conséquence à ne pas perdre de vue :** le message « liste des clés manquantes », que la Definition
of Done de `CRM-034` nomme, n'existe pas. Il naîtra avec la vérification qu'il décrit.

**Arbitrage attendu du responsable.** Trois options :

1. **rattacher la vérification n° 6 à `CRM-036`**, dont la Definition of Done porte déjà « union
   étape + transition » et « `hidden` non exigé » — c'est-à-dire, mot pour mot, la sémantique de
   cette vérification. C'est l'option la plus simple, et la lecture la plus naturelle du backlog ;
2. **déplacer `CRM-036` avant `CRM-034`** dans `docs/MASTER_PLAN.md` §2, ce qui n'est plus possible
   sans rouvrir `CRM-034` une fois livrée ;
3. **retirer la vérification n° 6 de la spécification** et faire porter l'obligation par
   l'interface seule — écarté d'office : `CLAUDE.md` §10 interdit qu'une règle métier ne vive que
   dans l'interface.

**CLOSE LE 2026-08-05, PAR `CRM-036`.** L'arbitrage n'a jamais été rendu, et il n'avait pas à
l'être : l'**option 1** ci-dessus n'est pas une décision de produit, c'est la lecture littérale de
deux textes déjà écrits. La Definition of Done de `CRM-036` dans `docs/BACKLOG.md` énonce « union
étape + transition » ; le §7.2 de `docs/SPEC-form-composer.md` énonce « champ `required` manquant →
transition refusée ; champ `hidden` non exigé même si vide ; union étape + transition ». C'est, mot
pour mot, la sémantique de la vérification n° 6. Livrer `CRM-036` sans l'écrire aurait amputé
l'unité de ce que sa propre Definition of Done nomme (décision 123).

**Le mécanisme de l'assertion figée a fonctionné.** Les deux preuves que `CRM-034` avait écrites
pour devenir rouges ce jour-là — `hasnt_table('public','card_field_values')` et le scénario *M7* de
`e2e/api/move-card.spec.ts` — le sont devenues, et ont été **retournées** : elles constatent
désormais le refus, et leur jumelle constate l'acceptation une fois la valeur renseignée.

**Ce que la n° 6 contrôle** est écrit au §6.7 de `docs/SPEC-form-composer.md`, et le message
« liste des clés manquantes » que la Definition of Done de `CRM-034` nommait existe : il voyage dans
le `DETAIL` du `raise`, mesuré exposé par PostgREST dans la clé `details` (décision 126).


---

**Lié à :** INC-043 (`CRM-034` avant ses tables), INC-033 (`require_fields` sans intégrité),
`CRM-036`, `CRM-037`.

### INC-048 — `move_card` exige un commentaire qu'elle ne peut conserver nulle part

**Nature :** perte de donnée utilisateur induite par l'ordre du plan.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-034`.

La vérification n° 5 de `docs/SPEC-workflow-engine.md` §5 exige un commentaire lorsque la transition
le demande — dans le seed, les **quatre** transitions « Marquer perdu ». Le même paragraphe énonce
qu'en cas de succès la fonction procède à l'« insertion du commentaire s'il est fourni » et à
l'« écriture d'un `card_event` de type `moved` ».

MESURÉ le 2026-08-04 : `to_regclass('public.card_comments')` et `to_regclass('public.card_events')`
rendent tous deux `NULL`. Ces tables sont les livrables de `CRM-043` et de `CRM-044`, unités que
`docs/MASTER_PLAN.md` §2 place après `CRM-034`.

**Conséquence exacte :** un utilisateur qui motive une affaire perdue voit sa transition acceptée et
**son motif disparaître**. Ce n'est pas une fonctionnalité différée, c'est une donnée saisie qui
n'est écrite nulle part. Le déplacement lui-même ne laisse par ailleurs **aucune trace** : ni
auteur, ni date, ni étape d'origine.

**Comportement retenu :** le paramètre est conservé dans la signature — le retirer casserait la
vérification n° 5, qui est dans la Definition of Done — et la perte est **écrite** dans
`docs/SPEC-workflow-engine.md` §5.4, dans `docs/manual.md` et dans la Definition of Done de
`CRM-034`, qui reste `[~]`. **Aucune table n'est créée par anticipation** : `card_comments` et
`card_events` préempteraient `CRM-043` et `CRM-044`, et la règle du projet est constante depuis
`CRM-035` (décision 92).

**Arbitrage attendu du responsable.** Trois options :

1. **accepter la perte temporaire** et livrer la garde maintenant, ce qui est le comportement
   retenu par défaut ci-dessus, le déplacement gardé valant mieux qu'un déplacement libre ;
2. **refuser toute transition exigeant un commentaire** tant que `card_comments` n'existe pas — ce
   qui neutraliserait les quatre transitions vers `Perdu` du seed, exactement le défaut décrit en
   INC-047 ;
3. **avancer `CRM-043` et `CRM-044`** avant `CRM-034`, ce qui inverse l'ordre du chunk 3 et retarde
   la seule garde du produit.

**LA CAUSE BLOQUANTE EST LEVÉE, 2026-08-05, PAR `CRM-043` — ET LA PERTE SUBSISTE.**
`public.card_comments` existe depuis la migration 15. L'argument qui fondait le « comportement
retenu » ci-dessus — « aucune table n'est créée par anticipation » — n'a donc plus d'objet, et
l'option 1 cesse d'être une acceptation *temporaire* : elle devient un choix par défaut que
personne n'a pris.

`CRM-043` **n'a pas** redéfini `move_card`, et le motif est de périmètre, non de faisabilité :
la fonction est un livrable de `CRM-034`, et la reprendre sous une unité qui ne la porte pas
toucherait ses six vérifications sans les rejouer sous la sienne (`CLAUDE.md` §13). Deux à trois
lignes suffiraient pourtant — une insertion dans `card_comments` à l'intérieur de la fonction —,
et c'est précisément ce qui rend l'arbitrage exigible plutôt que théorique.

Quatre assertions ont été **révisées, non retirées** (mécanisme de la décision 51) : elles
constataient l'absence de la table, elles constatent désormais la **perte elle-même** —
`supabase/tests/0012_cards.test.sql`, `supabase/tests/0013_move_card.test.sql`,
`supabase/tests/0014_valeurs_champs.test.sql` et `e2e/api/move-card.spec.ts`, cette dernière
mesurant qu'une card déplacée avec un motif exigé et fourni ne porte **aucun** commentaire.

**Ce qui reste à arbitrer est désormais plus étroit :** faut-il que `move_card` écrive le motif
comme un commentaire ordinaire — donc lisible et supprimable par son auteur —, ou comme un
événement de timeline que `CRM-044` portera, ou les deux ? Les trois options ci-dessus restent
formellement ouvertes, mais seules la première et la troisième ont encore un sens.

**Lié à :** INC-047 (même ordonnancement), `CRM-043` (**table livrée**), `CRM-044`.

---

### INC-049 — La preuve de refus n° 5 figure dans deux Definitions of Done à la fois

**Nature :** chevauchement de périmètre entre `CRM-034` et `CRM-013`.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-034`.

`docs/SPEC-permissions-rls.md` §7 numérote douze preuves de refus. La n° 5 — « mise à jour directe
de `cards.current_step_id` par PostgREST → refus » — est réclamée par **deux** unités :

- `CRM-034`, dont la Definition of Done dit « preuves de refus n° 1 et 5 » ;
- `CRM-013`, dont la Definition of Done dit « `current_step_id` et `email_local_part` non
  modifiables directement » et « preuves de refus n° 5, 6 et 8 ».

Ce n'est pas une redondance sans conséquence. **Sans la protection de colonne, `move_card` ne garde
rien** : n'importe quel client contourne les six vérifications par un `PATCH`. Livrer `CRM-034` en
laissant la colonne ouverte reviendrait à livrer une garde décorative et à en apporter la preuve par
un test qui ne teste pas le produit réel.

**Comportement retenu :** la protection de `cards.current_step_id` est livrée par **`CRM-034`**,
parce qu'une unité dont la Definition of Done exige une preuve doit livrer ce qui la rend possible.
Le périmètre restant de `CRM-013` est **réduit et nommé** : `cards.email_local_part`,
`mail_inbound_accounts.secret_id`, `mail_outbound_identities.secret_id`, `api_tokens.token_hash`,
`card_events.*`, `audit_log.*` — cinq cibles sur six dont les tables n'existent pas encore. Le
mécanisme mesuré est écrit dans `docs/SPEC-permissions-rls.md` §4.3 pour que `CRM-013` le reprenne
sans le redécouvrir.

**Risque résiduel, et il est réel :** le retrait du `GRANT UPDATE` de table ferme **par défaut**
toute colonne ajoutée plus tard à `cards`. Une migration ultérieure qui ajouterait une colonne
modifiable et oublierait l'énumération la rendrait silencieusement en lecture seule. Le fait est
écrit au §4.3 et **figé par une assertion** de `supabase/tests/0013_move_card.test.sql`, qui
énumère les colonnes ouvertes une par une : ajouter une colonne sans trancher son cas fera échouer
la suite.

**Arbitrage attendu du responsable :** confirmer ce partage, ou rendre la protection de colonne à
`CRM-013` — auquel cas `CRM-034` doit être livrée en sachant que sa garde est contournable, et sa
Definition of Done amendée pour retirer la preuve n° 5.

**Lié à :** INC-026 (le message de refus divulgue le `GRANT`), `CRM-013`.

---

### INC-051 — La ligne i du contrat d'API de `move_card` nomme un profil que le seed ne peut pas mettre en défaut

**Nature :** erreur de fait dans une spécification, mesurée contre la pile réelle.
**Relevé le :** 2026-08-04, pendant l'implémentation de `CRM-034`.

`docs/SPEC-workflow-engine.md` §5.8 énumère treize appels à mesurer. Sa ligne i dit :

| # | Appelant | Appel | Attendu |
|---|---|---|---|
| i | `bizdev` | card d'un channel fermé par un droit fin | `400`, `card_not_found` — discrétion |

**MESURÉ le 2026-08-04 contre la pile réelle**, avec le jeton du compte seedé : le `bizdev`
**lit les neuf cards du seed**, et l'appel rend `200`. Le tableau des droits effectifs le confirme —
`app.can_read_channel` rend `true` pour lui sur les quatre channels qui portent des cards.

Le motif est dans le seed lui-même (`docs/SPEC-seed.md` §2.11) : ses quatre droits fins ferment le
track `conseil-ia` au **viewer** et à l'**administratrice**, et rétrogradent le `bizdev` en lecture
sur le channel `maintenance`. **Aucune ligne ne ferme quoi que ce soit au `bizdev`** — une
rétrogradation en lecture n'est pas une fermeture, et elle produit `forbidden`, pas
`card_not_found`. La ligne i est donc insatisfaisable telle qu'écrite, et le §5.9 pose par ailleurs
que le seed **n'est pas modifié** par cette unité.

**Comportement retenu :** le profil retenu pour la ligne i est le **`viewer`**, à qui le seed ferme
réellement le track de `grands-comptes`. Ce choix est meilleur que celui d'origine, et pas seulement
faute de mieux : les lignes h et i sont désormais exercées **par le même jeton**, ce qui est la
seule façon d'exclure que l'écart entre `forbidden` et `card_not_found` vienne du profil plutôt que
de la règle de discrétion. Le fait qui rend la ligne d'origine inapplicable est lui-même **figé par
un scénario** de `e2e/api/move-card.spec.ts`, qui mesure le `200` du `bizdev` et deviendra rouge si
un droit fin venait à lui fermer ce channel. Un scénario supplémentaire couvre la rétrogradation du
`bizdev` sur `maintenance`, qui exerce l'autre chemin vers `forbidden`.

**Arbitrage attendu du responsable :** corriger la ligne i du §5.8 pour qu'elle nomme le `viewer`,
ou ajouter au seed un droit fin fermant un channel au `bizdev` — ce que le §5.9 interdit
aujourd'hui, et qui n'apporterait aucune preuve que le `viewer` n'apporte déjà.

**Lié à :** `docs/SPEC-seed.md` §2.11, `CRM-012`.

---

### INC-052 — « Un commentaire vide n'est pas un commentaire » ne refuse pas une tabulation

**Nature :** écart entre l'intention affichée d'une règle et l'expression qui la met en œuvre, les
deux étant écrites dans la même spécification.
**Relevé le :** 2026-08-04, pendant l'implémentation de `CRM-034`.

`docs/SPEC-workflow-engine.md` §5.3 pose la règle sous un titre sans ambiguïté — « **Un commentaire
vide n'est pas un commentaire** » — puis en spécifie l'expression **caractère pour caractère** :
« `comment` est normalisé par `nullif(btrim(comment), '')` avant la vérification n° 5 : une chaîne
d'espaces est refusée comme l'absence ».

**MESURÉ :** `btrim(text)` à un seul argument ne retire **que des espaces**. `btrim(E'\t\n ')` rend
deux caractères, `nullif(…, '')` ne les annule donc pas, et une tabulation seule **passe pour un
motif d'affaire perdue**. La règle écrite est plus étroite que le titre qui l'annonce.

L'implémentation est **fidèle à la spécification** : c'est la spécification qui dit deux choses
d'ampleur différente. `btrim(comment, E' \t\r\n')` refuserait strictement davantage et ne casserait
aucun usage légitime — un motif fait de blancs n'a aucune valeur pour personne.

**Comportement retenu :** l'expression du §5.3 est reprise **inchangée**. Élargir ce que la règle
refuse est une décision de produit, et la spécification l'a posée explicitement plutôt que par
défaut : la trancher au moment de l'implémentation serait la résoudre implicitement, ce que
`CLAUDE.md` §5 proscrit. L'écart est **figé par une assertion** de
`supabase/tests/0013_move_card.test.sql`, qui constate qu'une tabulation passe et qui deviendra
rouge le jour où l'arbitrage sera rendu.

**Portée réelle, pour que l'arbitrage se fasse en connaissance de cause :** l'exposition est faible.
Le seul cas atteint est un client qui envoie délibérément un commentaire fait de blancs non-espaces,
et le produit ne perd aucune donnée — il enregistre une transition dont le motif est vide, ce qui
est précisément ce que la n° 5 voulait empêcher. Rien ne dépend de cette valeur aujourd'hui, le
commentaire n'étant conservé nulle part (INC-048).

**SECONDE OCCURRENCE, relevée le 2026-08-05 pendant `CRM-037` — même propriété, autre appelant, et
elle avait déjà produit un défaut.** `app.valeur_de_champ_est_vide(jsonb)` emploie
`btrim(valeur #>> '{}') = ''`, et `docs/SPEC-form-composer.md` §6.6 l'annonce par « une chaîne vide,
ou faite de seuls espaces ». MESURÉ contre la base réelle, par la vraie route et le vrai refus de
`move_card` : une valeur réduite à `"\t"` ou `"\n"` est **renseignée**, et satisfait donc un champ
`required`.

Le prédicat TypeScript de `CRM-037` avait été écrit avec `String.prototype.trim()`, qui retire
**toute** l'espace blanche : les deux lectures divergeaient sur ces valeurs, ce que le §4.3 existe
précisément pour interdire. Le défaut a été reproduit puis corrigé — `docs/JOURNAL.md` décision 165,
`webapp/src/lib/valeur-renseignee.ts` — en **reproduisant fidèlement `btrim`**, non en élargissant
la règle.

**Ce qui reste ouvert est donc inchangé et s'étend à un second endroit** : faut-il que le produit
tienne pour vide une chaîne de blancs non-espaces ? La réponse vaudrait pour le §5.3 de
`docs/SPEC-workflow-engine.md` **et** pour le §6.6 de `docs/SPEC-form-composer.md`, et la correction
devrait alors bouger **des deux côtés à la fois** — la preuve d'API de `CRM-037` dénoncera un côté
qui bougerait seul.

**Arbitrage attendu du responsable :** élargir l'expression du §5.3 à `btrim(comment, E' \t\r\n')`
et retourner l'assertion dans le même changement, ou confirmer que seuls les espaces sont refusés et
corriger le titre du §5.3 pour qu'il n'annonce pas davantage.

**Lié à :** INC-048 (le commentaire n'est conservé nulle part).

---

### INC-053 — `SPEC-form-composer` §2.3 confie la résolution de `user` et `contact` à deux unités sans dire laquelle fait quoi

**Nature :** référence ambiguë dans `docs/SPEC-form-composer.md` §2.3.
**Relevé le :** 2026-08-05, pendant la spécification de `CRM-036`.

Le §2.3 énonce : « Déclarer un champ de type `contact` est donc licite dès `CRM-035` ; le
**résoudre** appartient à `CRM-036` et à `CRM-060`. » La phrase désigne deux unités et n'attribue
rien : elle ne dit ni ce que chacune doit résoudre, ni ce que « résoudre » signifie.

**Ce que `CRM-036` a mesuré et retenu.** Trois types désignent des objets : `user` vise `profiles`
(livrée), `contact` vise `contacts` (`CRM-060`, non commencée — MESURÉ,
`to_regclass('public.contacts')` rend `NULL`), `file` vise Storage, service distinct. `CRM-036`
valide donc la **forme** d'un `uuid` pour `user` et `contact`, et une chaîne pour `file`. Aucune
résolution n'est faite.

**Pourquoi ne pas résoudre `user`, qui serait possible.** Deux raisons, dont la seconde est la vraie :

1. la famille deviendrait incohérente — deux types voisins, l'un opposable et l'autre non, sans que
   rien dans le formulaire ne le laisse voir ;
2. surtout, cela **poserait une règle que nul document n'énonce** : un `user` doit-il être membre du
   workspace de la card ? un membre du workspace suffit-il ? un profil quelconque ? Le §2.3 ne le dit
   pas, `docs/SPEC-permissions-rls.md` non plus, et chacune de ces réponses est une décision de
   produit défendable.

**Comportement retenu :** la validation de forme, et rien de plus. L'écart est nommé au §6.5 et au
§6.12 de `docs/SPEC-form-composer.md`, et figé par une assertion de
`supabase/tests/0014_valeurs_champs.test.sql` qui constate qu'un `uuid` bien formé désignant un
profil **inexistant** est accepté aujourd'hui.

**Arbitrage attendu du responsable.** Trois options :

1. **résoudre `user` contre `profiles`**, en nommant la règle d'appartenance attendue, et laisser
   `contact` à `CRM-060` — au prix de l'incohérence temporaire de la famille ;
2. **rattacher les deux résolutions à `CRM-060`**, qui livrera `contacts` et pourra traiter la
   famille d'un seul geste — c'est la lecture la plus économe, et elle laisse le comportement actuel
   inchangé jusque-là ;
3. **renoncer à toute résolution**, en assumant qu'un `jsonb` ne porte aucune intégrité et que
   l'interface seule proposera des valeurs valides — au prix d'un `PATCH` direct capable d'écrire
   n'importe quel `uuid`.

**Lié à :** INC-033 (aucune intégrité référentielle possible sur un `uuid[]`, même famille de
limite), `CRM-060`.

---

### INC-054 — `SCHEMA` §4 exigeait `value` non nul, ce qui rendait inatteignable le « vide explicite » que la ligne suivante spécifie

**Nature :** contradiction interne à `docs/SCHEMA.md` §4, révélée par une mesure.
**Relevé le :** 2026-08-05, pendant `CRM-036`, **par l'échec du seed**.

Le tableau de `card_field_values` posait deux règles dans la même ligne : « `value` `jsonb` **non
nul** ; `'null'::jsonb` signifie explicitement vide ». La seconde suppose que `'null'::jsonb` soit
écrivable ; la première interdit tout le reste.

**MESURÉ le 2026-08-05** contre PostgREST `v14.12`, sur une table sonde créée puis détruite :

| Corps envoyé | Colonne `jsonb` obtenue |
|---|---|
| `{"v": null}` | **SQL NULL** |
| `{"v": "null"}` | la chaîne `"null"` |
| `{"v": [null]}` | le tableau `[null]` |

**Aucune écriture d'API ne produit `'null'::jsonb`.** La conséquence n'est pas théorique : « vider un
champ » devenait impossible pour tout type dont la validation refuse la chaîne vide. Un `money`
renseigné par erreur n'avait aucune écriture licite qui le remette à vide — chaîne vide refusée par
la validation de type, SQL NULL par la contrainte de colonne, aucune suppression exposée.

**Comportement retenu :** `value` est **nullable**, et SQL NULL vaut « explicitement vide » au même
titre que `'null'::jsonb` (décision 133). `docs/SCHEMA.md` §4 et `docs/SPEC-form-composer.md` §6.2 et
§6.6 sont corrigés dans le même changement.

**Pourquoi la contradiction est tranchée plutôt que consignée sans suite.** `CLAUDE.md` §5 impose de
consigner et de laisser le comportement inchangé — mais il n'y avait **aucun comportement** à
laisser : la table naissait dans ce commit, et les deux branches ne décrivent pas deux produits
possibles, seulement une règle réalisable et une qui ne l'est pas. Consigner sans trancher aurait
livré une valeur impossible à retirer.

**Où le défaut a été trouvé, et pourquoi cela compte.** Par le **seed**, qui est le premier client
réel du produit et emprunte les mêmes routes qu'un utilisateur (`CLAUDE.md` §8). Aucune suite pgTAP
ne l'aurait vu — `insert … values (…, 'null'::jsonb)` en SQL passe très bien —, et aucun test d'API
écrit **après** le code non plus, puisqu'il aurait été écrit contre le comportement observé.

**Action attendue du responsable :** confirmer la lecture, ou nommer la raison pour laquelle
`value` devrait rester `NOT NULL` malgré l'impossibilité d'écrire `'null'::jsonb` depuis l'API.

**Lié à :** INC-025 (autre lacune des tableaux de `docs/SCHEMA.md`), INC-033 (autre limite mesurée
d'un type plutôt que d'un choix).

---

### INC-056 — Trois garde-fous comptaient une donnée que `copy_workflow_to_track` duplique, et leur valeur dépendait de l'âge de la base

**Arbitrage rendu — `docs/JOURNAL.md`, décision 262.** Rendue **déterministe par construction** par la table de liaison décidée en INC-033 : la copie de workflow cesse de recopier `require_fields` tel quel. Mise en œuvre : `CRM-018`.

**Nature :** garde-fous non déterministes, livrés par `CRM-031`, `CRM-035` et `CRM-036`.
**Relevé le :** 2026-08-05, pendant `CRM-013`, sur une base **froide**.

Trois contrôles comptaient, **à l'échelle du workspace**, les transitions dont `require_fields`
n'est pas vide, et attendaient `1` :

- `supabase/tests/0007_workflows.test.sql` ;
- `supabase/tests/0010_champs_formulaire.test.sql` ;
- `scripts/verify-champs-formulaire.sh`.

MESURÉ sur une base créée de zéro — `./runDev.sh` puis `supabase/seed/apply-seed.sh` sur un cluster
neuf — le compte vaut **2**, et les trois contrôles échouent. La cause est mécanique :

1. la section 6 du seed pose `require_fields` sur « Démarrer la réalisation » du workflow global ;
2. la section 7, **ensuite**, appelle `copy_workflow_to_track`, qui recopie `require_fields` tel
   quel (INC-037) — son propre commentaire dit encore « il est vide partout aujourd'hui », prémisse
   que `CRM-036` a invalidée ;
3. la copie hérite donc de l'exigence, et le workspace en porte deux.

Sur une base **ancienne**, la copie a été créée avant `CRM-036` et ne porte rien : le compte vaut
`1`, et c'est là que `CRM-036` l'a mesuré. Les trois contrôles mesuraient donc **l'âge de la base**,
non le produit.

**Ce que cela dit de plus grave que trois assertions.** `CLAUDE.md` §8 pose que le seed est un
contrat **reproductible**. Ici, `./resetMe.sh` ne reproduisait pas l'état sur lequel les preuves
avaient été écrites : deux exécutions de la même commande, sur deux historiques différents,
donnaient deux états différents. Un garde-fou qui dépend de l'historique de la base ne garde rien.

**Comportement retenu :** **inchangé**. Le comportement de `copy_workflow_to_track` appartient à
`CRM-032` et relève d'INC-037, déjà ouverte. Les trois contrôles sont **rendus déterministes** —
ils comptent désormais sur le workflow **global** — et l'héritage de la copie est **compté
séparément**, par une assertion neuve dans `supabase/tests/0007_workflows.test.sql` et un contrôle
neuf dans `scripts/verify-champs-formulaire.sh`. Rien n'est relâché : le total du workspace reste
`2`, et il est désormais affirmé plutôt que subi.

**Ce qui reste à trancher, et qui n'appartient pas à `CRM-013` :**

1. `copy_workflow_to_track` doit-elle recopier `require_fields` alors que la copie ne reçoit
   **aucun** champ ? L'exigence y est inerte — la sixième vérification de `move_card` ignore un
   identifiant qu'elle ne résout pas (décision 128). C'est INC-037, aggravée.
2. Le seed doit-il poser `require_fields` **après** la copie, de sorte que l'ordre des sections ne
   décide plus du contenu ? Ce serait une correction à un seul endroit, mais elle appartient à
   `CRM-005` / `CRM-046`.

**Action attendue du responsable :** trancher le point 1 avec INC-037, et dire si le point 2 doit
être rattaché au seed de démonstration complet (`CRM-046`).

**Lié à :** INC-037 (la copie recopie `require_fields`), INC-033 (`require_fields` sans intégrité
référentielle), `CLAUDE.md` §8 (le seed est reproductible).

---

## Clos

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

**Mise à jour du 2026-08-04 — trois des quatre fonctions sont livrées par `CRM-012`, et le motif
d'attente s'est éteint de lui-même pour elles.** L'arbitrage n'a pas été rendu ; quatre exécutions
de la routine l'ont attendu et ont choisi une autre unité en le nommant (`docs/JOURNAL.md`,
décisions au choix d'unité de `CRM-005`, `CRM-020`, `CRM-021` et `CRM-030`). Deux faits ont changé
la situation :

- **les tables existent.** `tracks` est livrée depuis `CRM-020`, `channels` depuis `CRM-021`. La
  contradiction relevée ici — « la jointure n'a pas de table où aller » — ne vaut plus que pour
  `can_read_card`, `cards` arrivant à `CRM-040` ;
- **l'option 1 est devenue inapplicable pour ces trois fonctions.** Elle proposait de les rattacher
  à `CRM-020` et `CRM-021` ; ces deux unités sont livrées et rouvrir leur périmètre pour y verser
  une fonction écrite après elles contredirait `CLAUDE.md` §13.

`CRM-012` les écrit donc, ce qui n'est pas une quatrième option inventée mais la lecture littérale
de son titre — « droits fins par track et channel » — et de sa Definition of Done, qui exige la
matrice de résolution et les preuves n° 3 et n° 4. **Le choix est nommé plutôt que tu** :
`docs/JOURNAL.md`, décision 103.

**Ce qui reste ouvert, et n'est pas tranché ici :**

1. **`app.can_read_card`.** Toujours différée, et pour la raison d'origine : `cards` n'existe pas.
   Elle sera écrite par l'unité qui livre la table, `CRM-040`, ou par une unité dédiée si le
   responsable préfère. La suite pgTAP de `CRM-010` continue de constater son absence.
2. **La Definition of Done de `CRM-010`.** Elle nomme six fonctions ; quatre lui échappent
   désormais pour de bon. Faut-il la réécrire à quatre — les deux qu'elle livre plus
   `resolve_access` et `workspace_role` —, ou la laisser porter une dette que d'autres unités
   soldent ? `CRM-010` reste `[~]` tant que le point n'est pas tranché.

Ces deux points sont désormais tranchés — voir la clôture ci-dessous.

**CLOSE le 2026-08-05, par la reprise de `CRM-010`** (`docs/JOURNAL.md`, décisions 155, 156 et 157).
Les deux points restés ouverts le sont pour deux raisons distinctes, et aucune n'est un arbitrage
rendu à la place du responsable.

1. **`app.can_read_card` est livrée** par `CRM-040` en même temps que `cards`, et
   `app.can_write_card` par `CRM-036`. Le motif d'attente — « la jointure n'a pas de table où
   aller » — n'existe plus pour aucune des quatre fonctions.
2. **La Definition of Done de `CRM-010` n'est pas réécrite, et n'a plus à l'être.** La question
   posée le 2026-08-03 supposait quatre fonctions **inécrivables** ; elles sont écrites. Le texte
   qui nomme six fonctions est redevenu **satisfaisable tel qu'il est**, et le réduire à quatre
   reviendrait à retirer de l'unité ce qu'elle nomme, au moment précis où cela cesse d'être
   impossible. `CRM-010` a donc été reprise pour le satisfaire, en étendant ses **propres** preuves
   aux quatre fonctions : la matrice complète à travers des lignes réelles, l'absence de récursion
   sur `tracks`, `channels` et `cards`, et le recensement des fonctions `SECURITY DEFINER`
   (`docs/SPEC-permissions-rls.md` §3.8).

**Mesure de clôture :** `supabase/tests/0002_fonctions_autorisation.test.sql` passe de 128 à
**153 assertions**, `scripts/verify-authz.sh` de 26 à **35 contrôles**, dont quatre dégradations
qui n'existaient pas et qui font tomber la suite lorsque l'une des quatre fonctions est réécrite de
travers. Aucune migration n'est modifiée : le produit est inchangé, ce sont ses preuves qui le
rattrapent.

**Ce que cette clôture ne tranche pas :** INC-014 (politiques des tables d'identité, et preuve de
refus n° 10) reste **ouverte et inchangée**.

---

### INC-050 — Le §5.5 de `SPEC-workflow-engine` se contredisait sur `email_local_part`

**Close le :** 2026-08-05, par l'unité `CRM-013`, **par exécution et non par arbitrage**.

**Ce qui était en cause.** La prose du §5.5 rangeait `email_local_part` parmi ce qui « reste à
`CRM-013` » — donc ouverte ; son bloc `GRANT` ne la listait pas — donc fermée. Le mécanisme étant
exclusif par construction, les deux lectures ne pouvaient pas coexister. `CRM-034` a consigné sans
résoudre et laissé la colonne ouverte, comme `CLAUDE.md` §5 l'impose.

**Pourquoi aucun arbitrage n'était nécessaire.** Les deux branches proposées ne portaient que sur
**l'attribution** — quelle unité ferme la colonne — et non sur le comportement final, identique des
deux côtés : la colonne finit fermée. Exécuter `CRM-013` tranche l'attribution par l'énoncé de son
propre backlog, « `current_step_id` et `email_local_part` non modifiables directement », sans rien
décider à la place du responsable (`docs/JOURNAL.md`, décision 142).

**Mesure.** `supabase/migrations/0014_colonnes_protegees.sql` retire `UPDATE` à `authenticated` sur
cette colonne. L'état posé — douze colonnes ouvertes — coïncide **exactement** avec le bloc `GRANT`
du §5.5. Preuves : `supabase/tests/0015_colonnes_protegees.test.sql` (41 assertions),
`e2e/api/colonnes-protegees.spec.ts` (12 scénarios), `scripts/verify-colonnes-protegees.sh`
(50 contrôles). Les trois garde-fous qui constataient la colonne ouverte ont été **retournés**, non
retirés.

**Portée générale, écrite parce qu'elle resservira :** une contradiction dont toutes les branches
mènent au même état du produit n'est pas un arbitrage, c'est une question d'imputation — et
l'exécution de l'unité nommée la résout. La distinguer d'un vrai arbitrage évite d'immobiliser une
unité qui n'attend rien.

**A laissé ouvert :** la dépendance d'ordre 12 → 14, réelle et mesurée, consignée dans
`docs/PROD_MIGRATIONS.md` §3.

---

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

**CLOSE le 2026-08-04 par `CRM-012`.** La politique de lecture de `tracks` s'appuie désormais sur
`app.can_read_track`, qui applique les droits fins. MESURÉ : un `track_members.access = 'none'`
posé sur le viewer lui masque le track — trois tracks visibles au lieu de quatre —, tandis que le
même droit fin posé sur l'administratrice ne lui masque rien. L'assertion de
`supabase/tests/0004_tracks.test.sql` qui figeait l'écart est **devenue rouge comme prévu** et a
été révisée dans le même changement, non retirée (mécanisme de la décision 51).

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

**CLOSE le 2026-08-04 par `CRM-012`.** La politique de lecture de `channels` s'appuie désormais sur
`app.can_read_channel`, et `app.can_write_channel` est livrée avec elle. MESURÉ : un
`channel_members.access = 'none'` masque le channel ; un `channel_members.access = 'member'` posé
sous un track fermé le **rouvre**, ce qui est « le plus spécifique gagne » dans le sens
contre-intuitif du §3.1. L'assertion de `supabase/tests/0005_channels.test.sql` qui figeait l'écart
est devenue rouge et a été révisée dans le même changement.

---

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
