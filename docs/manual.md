# Manuel utilisateur — P2Enjoy CRM

> **Ce manuel est en cours de constitution.**
> Chaque chapitre est rédigé **au moment où l'unité correspondante est livrée**, à partir de
> l'application réellement exécutée, avec des captures produites lors de la vérification
> visuelle. Aucun chapitre n'est écrit d'avance : décrire un écran qui n'existe pas encore
> produirait une documentation fausse.
>
> Les chapitres marqués « à livrer » n'ont pas encore d'implémentation. Leur intitulé indique
> l'unité de backlog qui les produira (`docs/BACKLOG.md`).

---

## Sommaire

### Prise en main

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 1 | Se connecter, récupérer son mot de passe | `CRM-011`, non rattachée | À livrer — le mécanisme existe et est prouvé (`docs/SPEC-auth.md`), mais **aucune unité ne porte l'écran** (INC-021) |
| 2 | Comprendre l'organisation : espace, tracks, channels, cards | `CRM-020`, `CRM-021` | À livrer |
| 3 | Naviguer : barre latérale, onglets, recherche | `CRM-007`, `CRM-065` | **Partiellement livré** — voir ci-dessous ; la recherche relève de `CRM-065` |

### Suivi quotidien

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 4 | Créer une card et renseigner sa fiche | `CRM-040`, `CRM-037` | À livrer |
| 5 | Faire avancer une card dans son workflow | `CRM-034`, `CRM-041` | À livrer |
| 6 | Comprendre pourquoi une transition est refusée | `CRM-034`, `CRM-037` | À livrer |
| 7 | Commenter et suivre l'historique d'une card | `CRM-043`, `CRM-044` | À livrer |
| 8 | Vue liste, filtres et vues sauvegardées | `CRM-042`, `CRM-071` | À livrer |
| 9 | Prochaine action et vue « Ma journée » | `CRM-061` | À livrer |

### Messagerie

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 10 | Connecter sa boîte de réception (IMAP) | `CRM-052` | À livrer |
| 11 | Configurer son adresse d'expédition (SMTP) | `CRM-053` | À livrer |
| 12 | L'adresse email d'une card : à quoi elle sert | `CRM-040`, `CRM-054` | À livrer |
| 13 | L'inbox : dossiers, messages non classés, classement | `CRM-055`, `CRM-057` | À livrer |
| 14 | Répondre depuis une card ou depuis l'inbox | `CRM-058` | À livrer |
| 15 | Modèles d'emails, signature et séquences de relance | `CRM-063` | À livrer |
| 16 | Que faire quand un compte mail est en erreur | `CRM-059` | À livrer |

### Administration

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 17 | Inviter et gérer les membres | `CRM-011`, non rattachée | À livrer — l'invitation est aujourd'hui une opération d'**exploitation** et non un parcours produit ; aucune unité ne porte l'écran (INC-015) |
| 18 | Créer des tracks et des channels | `CRM-020`, `CRM-021` | À livrer |
| 19 | Le catalogue de nœuds | `CRM-030` | **Partiellement livré, sans écran.** Le catalogue existe côté serveur — les sept états d'une affaire, plus les vôtres — et l'espace de travail est livré avec le sien. Aucun écran ne permet encore de le consulter ni de le modifier : l'éditeur arrive avec le chapitre 20 (`CRM-031`) |
| 20 | Construire un workflow et ses transitions | `CRM-031` | **Partiellement livré, sans écran.** Le workflow existe côté serveur — l'espace de travail est livré avec le sien, « Cycle commercial standard », ses sept étapes et ses dix transitions, et chacun de ses six channels le suit. Ce qui manque est l'**éditeur** : aucun écran ne permet encore de dessiner un workflow, et il n'y en aura pas avant qu'un écran de connexion existe (INC-021) |
| 21 | Copier un workflow dans un track et le modifier | `CRM-032` | À livrer |
| 22 | Composer le formulaire d'un workflow | `CRM-035` | À livrer |
| 23 | Restreindre l'accès à un track ou à un channel | `CRM-070` | À livrer |
| 24 | Boîte mail système de l'espace | `CRM-052` | À livrer |
| 25 | Jetons d'API et webhooks | `CRM-073` | À livrer |
| 26 | Journal d'audit, export et suppression de données | `CRM-072` | À livrer |

### Pilotage

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 27 | Analytique de conversion par channel et par track | `CRM-066` | À livrer |
| 28 | Prévisionnel pondéré et objectifs | `CRM-066` | À livrer |
| 29 | Cards figées et relances automatiques | `CRM-062` | À livrer |

---

## 3. Naviguer : barre latérale, onglets, états

*Livré par `CRM-007`. Décrit l'application réellement exécutée ; captures dans
`docs/captures/CRM-007/`.*

### 3.1 La disposition de l'écran

L'écran se lit en trois zones :

- à gauche, la **barre latérale** : le nom du produit, les quatre entrées de navigation — Board,
  Inbox, Ma journée, Réglages — puis la section **Tracks** ;
- en haut, l'**en-tête** : le fil d'Ariane, qui nomme la page ouverte, et le contexte d'espace de
  travail à droite ;
- sous l'en-tête, la **barre d'onglets**, qui listera les channels du track courant ;
- au centre, le **contenu** de la page.

### 3.2 Ce que vous voyez aujourd'hui, et pourquoi

L'application affiche partout **« Aucun track »**, **« Aucun channel »** et **« Aucun workspace
accessible »**. Ce n'est pas une erreur, et ce n'est plus tout à fait pour la même raison qu'avant.

Les **tracks et les channels existent désormais**, ainsi que le **catalogue de nœuds** — le
vocabulaire des états par lesquels une affaire passe : Prospection, Relance, Négociation,
Signature, Réalisation, Livré, Perdu — et, depuis peu, un **workflow** qui les enchaîne : « Cycle
commercial standard », avec ses sept étapes et les dix déplacements qu'il autorise. Chacun des six
channels de l'espace de travail suit ce workflow. Tout cela est créé, ordonné et archivable côté
serveur, et une personne administratrice peut le gérer. Mais l'application n'a **pas encore d'écran
de connexion**. Elle interroge donc le serveur sans compte, et le serveur ne consent rien à un
visiteur anonyme — ce qu'elle vous dit, au lieu d'afficher une page blanche.

Le catalogue de nœuds et les workflows n'ont d'ailleurs **aucun écran du tout**, connexion ou non.
Ce qui est livré est la mécanique : le vocabulaire des états, le graphe des déplacements permis, et
le refus de tout déplacement qui n'y figure pas. Les écrans viendront avec l'éditeur du
chapitre 20, lui-même suspendu à l'écran de connexion.

Autrement dit : ce que vous ne voyez pas n'est pas absent du produit, il vous est **refusé**. Tant
qu'aucun écran de connexion n'existe, aucune donnée métier ne peut apparaître à l'écran.

### 3.2 bis La section Tracks

*Livrée par `CRM-020`. Captures dans `docs/captures/CRM-020/`.*

Sous les quatre entrées de navigation, la section **Tracks** liste les activités de votre espace de
travail — par exemple « Conseil & IA », « Studio web », « Formation ». Chaque track s'affiche en
pilule colorée, précédée de son icône.

- L'**ordre** est celui défini par l'administration de l'espace, pas l'ordre de création.
- Un track **archivé** n'apparaît pas dans cette liste. L'archivage masque sans détruire : il est
  réversible à tout moment par une personne administratrice.
- La **couleur** et l'**icône** sont choisies parmi un jeu fixe : elles aident à repérer un track
  d'un coup d'œil, et ne portent jamais seules une information — le libellé et l'icône
  l'accompagnent toujours.
- Les pilules sont **cliquables depuis `CRM-021`** : un clic ouvre le track sur ses channels. Le
  track ouvert se signale par un anneau bleu, qui s'ajoute à sa couleur sans la remplacer.

**Qui peut faire quoi.** Créer, renommer, réordonner ou archiver un track est réservé aux personnes
**administratrices** de l'espace de travail. Les autres profils les consultent. Cette règle est
appliquée par le serveur, et non par l'affichage : elle tient même si l'on s'adresse directement à
l'API. La suppression définitive d'un track n'est **jamais** proposée — l'archivage en tient lieu.

**Aucun écran ne permet encore de les gérer**, faute d'écran de connexion (voir §3.2). La gestion
des tracks passe aujourd'hui par l'API, ce qui est une opération d'exploitation, pas un parcours
produit.

### 3.2 ter Les onglets d'un track

*Livrée par `CRM-021`. Captures dans `docs/captures/CRM-021/`.*

Ouvrir un track — en cliquant sa pilule, ou en saisissant son adresse `/tracks/<identifiant>` —
affiche ses **channels** en onglets, juste sous l'en-tête. Le nom du track devient le titre de la
page.

- L'**ordre** des onglets est celui défini par l'administration, pas l'ordre de création.
- Un channel **archivé** n'apparaît pas. Comme pour les tracks, l'archivage masque sans détruire,
  et reste réversible.
- L'onglet **ouvert** se signale par un libellé bleu et un soulignement : jamais par la couleur
  seule.
- Sur un écran étroit, la barre **défile horizontalement** plutôt que de tronquer les libellés. Une
  ombre au bord indique qu'il reste des onglets à voir de ce côté.
- Un track **sans channel** affiche « Aucun channel dans ce track » plutôt qu'une barre vide sans
  explication.

Ouvrir un onglet change l'adresse de la page : elle se partage et se met en favori. Le contenu du
channel — board, vue liste, cards — n'est pas encore livré ; l'écran le dit explicitement plutôt
que d'afficher un vide.

**Si l'adresse ne correspond à aucun track**, ou si votre compte n'y a pas accès, l'écran affiche
« Track introuvable » et propose un retour à l'accueil. Les deux situations produisent le **même**
message : cela évite de renseigner qui que ce soit sur l'existence d'un track qu'il n'a pas le
droit de voir.

**Qui peut faire quoi.** Créer, renommer, réordonner ou archiver un channel est réservé aux
personnes **administratrices** de l'espace de travail, exactement comme pour les tracks, et la
règle est appliquée par le serveur. La suppression définitive n'est jamais proposée. **Aucun écran
ne permet encore de les gérer**, faute d'écran de connexion (voir §3.2).

### 3.3 Replier la barre latérale

Le bouton en haut de la barre latérale la replie en colonne d'icônes, et la déplie à nouveau. Ce
choix vaut **pour la session en cours** : il est oublié à la fermeture de l'onglet, et rien n'est
conservé sur votre appareil au-delà.

Sur un écran étroit, la barre latérale devient un **tiroir** : le bouton en haut à gauche de
l'en-tête l'ouvre, la croix ou la touche `Échap` la referme.

### 3.4 Naviguer au clavier

L'application s'utilise entièrement au clavier :

- la première tabulation fait apparaître le lien **« Aller au contenu »**, qui saute la
  navigation ;
- les tabulations suivantes parcourent le bouton de repli, puis les quatre entrées de navigation ;
- `Entrée` active l'entrée sélectionnée ;
- l'élément qui a le focus est toujours entouré d'un liseré bleu visible.

### 3.5 Quand quelque chose ne va pas

| Ce qui s'affiche | Ce que cela signifie | Ce que vous pouvez faire |
|---|---|---|
| Barres grises animées | Les données sont en cours de chargement | Patienter |
| « Aucun … » | Le serveur n'a rien à afficher pour vous | Rien : ce n'est pas une erreur |
| « Chargement impossible » | Le serveur n'a pas répondu | **Réessayer** ; le bouton relance la requête sans recharger la page |
| « Accès refusé » | Le serveur a refusé la lecture | Demander l'accès à un administrateur de l'espace |
| « Configuration incomplète » | L'application a été construite sans l'adresse du serveur | Prévenir la personne qui a déployé l'application |

En cas de panne du serveur, l'application **réessaie trois fois** avant d'afficher l'erreur : le
message peut donc mettre quelques secondes à apparaître.

---

## Règles de rédaction de ce manuel

Rappelées ici pour que chaque contribution s'y conforme :

- Le manuel décrit **le comportement réel**, constaté dans l'application exécutée, jamais un
  comportement supposé.
- Il est compréhensible **sans lire le code**.
- Il ne contient **aucun secret**, aucune clé, aucune adresse interne, aucun détail exploitable
  sur l'infrastructure. Les noms de variables d'environnement peuvent être cités, jamais leurs
  valeurs.
- Toute évolution du comportement met à jour le chapitre concerné **dans le même changement** :
  nouveau champ, nouvelle validation, nouveau bouton, nouvelle modale, nouvel onglet, nouvel
  état, nouveau filtre, nouveau message, parcours modifié.
- Les captures sont **renouvelées** dès que l'apparence ou le parcours change.
