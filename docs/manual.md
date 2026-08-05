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
| 4 | Créer une card et renseigner sa fiche | `CRM-040`, `CRM-037` | **Partiellement livré, sans écran** — voir le chapitre 4 ci-dessous. L'affaire existe côté serveur avec son titre, son responsable, son montant, sa devise, sa probabilité, sa prochaine action, son archivage et sa corbeille. L'espace de travail livré en contient neuf, dont une archivée et une en corbeille. **Ses réponses au formulaire existent aussi depuis `CRM-036`** — voir le chapitre 24. Ce qui manque est l'**écran** |
| 5 | Faire avancer une card dans son workflow | `CRM-034`, `CRM-041` | **Livré côté serveur, sans écran** — voir le chapitre 4.3. Une affaire ne change d'étape que par un déplacement **déclaré** dans son workflow, et le produit refuse désormais toute écriture directe de l'étape, y compris par une administratrice. **Les six vérifications sont en place** depuis `CRM-036` : une affaire ne peut plus entrer dans une étape sans que les questions obligatoires de cette étape aient une réponse. Ce qui manque est l'écran : le tableau kanban et son glisser-déposer relèvent de `CRM-041` |
| 6 | Comprendre pourquoi une transition est refusée | `CRM-034`, `CRM-037` | **Partiellement livré** : les **six** motifs de refus existent et sont nommés (chapitre 4.3), y compris celui qui **liste les questions restées sans réponse**, livré par `CRM-036`. Ce qui manque est leur **affichage** |
| 7 | Commenter et suivre l'historique d'une card | `CRM-043`, `CRM-044` | À livrer |
| 8 | Vue liste, filtres et vues sauvegardées | `CRM-042`, `CRM-071` | À livrer |
| 9 | Prochaine action et vue « Ma journée » | `CRM-061` | À livrer |

### Messagerie

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 10 | Connecter sa boîte de réception (IMAP) | `CRM-052` | À livrer |
| 11 | Configurer son adresse d'expédition (SMTP) | `CRM-053` | À livrer |
| 12 | L'adresse email d'une card : à quoi elle sert | `CRM-040`, `CRM-054` | **Partiellement livré** : l'adresse est **générée** à la création de chaque affaire et non devinable (chapitre 4.2). Ce à quoi elle sert — recevoir les messages et les rattacher à l'affaire — relève de `CRM-054` |
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
| 21 | Copier un workflow dans un track et le modifier | `CRM-032` | **Partiellement livré, sans écran.** La copie existe côté serveur : un administrateur duplique un workflow global vers un track, avec ses étapes et ses transitions, et la copie se souvient de son origine. L'espace de travail est livré avec un exemple, « Cycle commercial — Conseil IA » sur le track « Conseil & IA ». Le produit sait aussi dire qu'une copie a **divergé** de son original. Ce qui manque est l'écran : aucun bouton ne permet encore de copier, et la mention de divergence n'est affichée nulle part — il n'y en aura pas avant qu'un écran de connexion existe (INC-021) |
| 22 | Choisir le workflow d'un channel | `CRM-033` | **Livré côté serveur, sans écran.** Un channel suit désormais **obligatoirement** un workflow, et pas n'importe lequel : le workflow général de l'espace de travail, ou celui de son propre track. Toute autre affectation est refusée, y compris de façon détournée — déplacer un channel vers un autre track, ou déplacer un workflow sous les channels qui le suivent. L'espace de travail livré le montre : cinq channels suivent « Cycle commercial standard », « Prospection » suit la copie réservée à son track. Ce qui manque est l'écran : aucun sélecteur ne permet encore de changer le workflow d'un channel, et il n'y en aura pas avant qu'un écran de connexion existe (INC-021) |
| 23 | Composer le formulaire d'un workflow | `CRM-035` | **Livré côté serveur, sans écran.** Un workflow porte désormais son propre formulaire : les questions posées à propos d'une affaire, et le moment où chacune est affichée, facultative ou obligatoire. L'espace de travail livré en montre sept — budget estimé, origine du contact, date de signature prévue, motif de la perte, décideur identifié, lien vers la proposition, et un champ retiré du formulaire dont les réponses restent consultables. Un champ non déclaré à une étape y reste simplement visible : on ne déclare que les exceptions. Une limite à connaître : un workflow **copié** dans un track naît **sans formulaire**, qu'il faut donc recomposer — et, depuis `CRM-036`, une exigence recopiée sur ses transitions n'exige rien, puisqu'elle désigne un champ que la copie ne porte pas. L'obligation, elle, est **désormais appliquée** : voir le chapitre 24. Ce qui manque est l'écran : la grille champ × étape n'existe pas, et il n'y en aura pas avant qu'un écran de connexion existe (INC-021) |
| 24 | Répondre aux questions d'une affaire | `CRM-036`, `CRM-037` | **Livré côté serveur, sans écran.** Une affaire porte désormais ses réponses, et le produit les **vérifie** : une réponse doit correspondre au type de la question — un montant est un nombre, une case est cochée ou non, une date est une date, et une liste de choix n'accepte que les choix déclarés. Une réponse peut être **vidée** explicitement, ce qui n'est pas la même chose que ne jamais avoir répondu — mais le produit traite les deux de la même façon lorsqu'il exige une réponse. Les réponses d'une question **retirée du formulaire** restent enregistrées et consultables. Depuis ce chapitre, l'obligation est **réellement appliquée** : voir le chapitre 4.3. L'espace de travail livré montre quatorze réponses sur six affaires, dont une volontairement vidée pour que le refus soit démontrable. Ce qui manque est l'écran : le formulaire, sa section repliée « informations d'autres étapes » et la mention « requis pour passer à » relèvent de `CRM-037`, et il n'y en aura pas avant qu'un écran de connexion existe (INC-021) |
| 24 bis | Restreindre l'accès à un track ou à un channel | `CRM-070` | À livrer |
| 25 | Boîte mail système de l'espace | `CRM-052` | À livrer |
| 26 | Jetons d'API et webhooks | `CRM-073` | À livrer |
| 27 | Journal d'audit, export et suppression de données | `CRM-072` | À livrer |

### Pilotage

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 28 | Analytique de conversion par channel et par track | `CRM-066` | À livrer |
| 29 | Prévisionnel pondéré et objectifs | `CRM-066` | À livrer |
| 30 | Cards figées et relances automatiques | `CRM-062` | À livrer |

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
channels de l'espace de travail suit un workflow — cinq suivent celui-ci, et « Prospection » suit sa
**copie réservée au track « Conseil & IA »**. Tout cela est créé, ordonné et archivable côté
serveur, et une personne administratrice peut le gérer. Mais l'application n'a **pas encore d'écran
de connexion**. Elle interroge donc le serveur sans compte, et le serveur ne consent rien à un
visiteur anonyme — ce qu'elle vous dit, au lieu d'afficher une page blanche.

Le catalogue de nœuds, les workflows et **les affaires elles-mêmes** n'ont d'ailleurs **aucun écran
du tout**, connexion ou non. Ce qui est livré est la mécanique : le vocabulaire des états, le graphe
des déplacements permis, le refus de tout déplacement qui n'y figure pas, la **copie** d'un workflow
vers un track avec la mémoire de son origine — chapitre 21 —, la garantie qu'un channel ne peut
suivre **que** le workflow général de l'espace de travail ou celui de son propre track —
chapitre 22 —, le **formulaire** attaché à un workflow — chapitre 23 —, et, depuis le chapitre 4,
**l'affaire** : l'objet autour duquel tout le reste s'organise. Les écrans viendront avec l'éditeur
du chapitre 20 et le tableau du chapitre 5, l'un et l'autre suspendus à l'écran de connexion.

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

### 3.2 quater Les accès par track et par channel

*Livrée par `CRM-012`. Aucune capture : cette règle n'a pas encore d'écran, voir plus bas.*

Par défaut, votre accès à un track ou à un channel découle de votre **rôle dans l'espace de
travail** : une personne administratrice administre, une business developer travaille, une
observatrice consulte. Rien à configurer.

Une personne administratrice peut cependant poser une **exception** sur un track ou sur un channel
précis, pour une personne précise. Trois exceptions existent :

| Exception | Effet sur ce track ou ce channel |
|---|---|
| **Accès complet** | vous y lisez et y écrivez, même si votre rôle est « observatrice » |
| **Lecture seule** | vous y lisez sans y écrire, même si votre rôle vous autorise à écrire ailleurs |
| **Aucun accès** | ce track ou ce channel disparaît de votre affichage |

Trois choses méritent d'être sues, parce qu'elles surprennent :

- **L'exception la plus précise l'emporte.** Une exception posée sur un channel prime sur celle de
  son track. On peut donc vous fermer tout un track *et* vous rouvrir un seul de ses channels : ce
  channel restera visible alors que le track qui le contient ne le sera plus.
- **Une exception ne s'applique jamais à une personne administratrice.** Elle peut être enregistrée
  sur son compte, elle restera sans effet tant que cette personne administre l'espace — sans quoi
  une exception malheureuse pourrait rendre un espace impossible à administrer. Elle reprendrait
  effet si ce compte cessait d'être administrateur.
- **Un track ou un channel qui vous est fermé n'apparaît pas comme « interdit » : il n'apparaît
  pas du tout.** C'est voulu. Un libellé « accès refusé » révélerait l'existence et le nom d'une
  activité que vous n'avez pas à connaître.

**Ce que vous pouvez voir de vos propres exceptions.** Vous pouvez consulter celles qui vous
concernent — une restriction invisible à celle qui la subit serait une mauvaise règle — mais pas
celles de vos collègues, et vous ne pouvez pas lever la vôtre. Seule une personne administratrice
pose et retire une exception. Retirer une exception ne « redonne » pas un accès particulier : elle
rend l'accès à ce qu'il aurait été sans elle, c'est-à-dire celui de votre rôle.

**Aucun écran ne permet encore de les gérer**, pour la même raison qu'au §3.2 : le produit n'a pas
de parcours de connexion. La règle est en revanche **appliquée par le serveur** dès aujourd'hui, et
non par l'affichage : elle tient même si l'on s'adresse directement à l'API.

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

## 4. L'affaire : ce qu'elle porte, son adresse, ses deux façons de disparaître

*Livrée par `CRM-040`. Aucune capture : cette fonctionnalité n'a pas encore d'écran, voir §3.2.*

L'**affaire** — appelée *card* dans le produit — est l'objet autour duquel tout le CRM s'organise :
une opportunité, un dossier, un projet. Elle vit dans un onglet (channel), à une étape du workflow
que cet onglet suit, et c'est à elle que se rattacheront les commentaires, les documents et les
échanges de messagerie.

### 4.1 Ce qu'une affaire porte

| Ce que vous renseignez | Ce que cela sert |
|---|---|
| Un **titre** | Il ne peut pas être vide ni composé d'espaces |
| Une **description** | Texte libre |
| Un **responsable** | Une personne de l'espace de travail. Facultatif : une affaire peut attendre d'être attribuée |
| Un **montant** et une **devise** | La devise s'écrit en trois lettres majuscules — `EUR`, `CHF`. La valeur par défaut est `EUR` |
| Une **probabilité** | Facultative, entre 0 et 100. Sans elle, celle de l'étape s'applique |
| Une **prochaine action** et son **échéance** | Ce qui alimentera la vue « Ma journée » |

Deux valeurs sont posées pour vous et ne se saisissent pas : l'**étape courante**, qui vient de
l'onglet où l'affaire naît, et l'**adresse email** ci-dessous.

### 4.2 L'adresse email de l'affaire

Chaque affaire reçoit à sa création une **adresse email qui lui est propre**, de la forme
`c-3p55qdgw@…`. Elle est tirée au hasard sur un espace d'environ mille milliards de possibilités :
une adresse divulguée ne permet donc pas de deviner celles des autres affaires.

Vous ne la choisissez pas, et une valeur que vous fourniriez serait ignorée — c'est ce qui garantit
qu'aucune adresse ne soit devinable. Elle servira, à partir du chapitre sur la messagerie, à
rattacher automatiquement à l'affaire tout message qui lui est envoyé.

### 4.3 Faire avancer une affaire : ce que le produit autorise, et ce qu'il refuse

Une affaire change d'étape par **un seul chemin**, et c'est délibéré : le produit refuse désormais
qu'on écrive directement l'étape d'une affaire, même à une administratrice. Tout déplacement passe
par la commande de déplacement, qui vérifie **six** choses avant d'accepter.

| Ce qui est vérifié | Ce que vous voyez si cela bloque |
|---|---|
| L'affaire existe, vous y avez accès, et elle n'est **ni archivée ni en corbeille** | « affaire introuvable » |
| Vous avez le droit d'**écrire** dans son onglet | « accès refusé » |
| L'étape visée appartient bien au workflow de l'affaire | « cette étape n'est pas dans ce workflow » |
| Le workflow **déclare** un déplacement de l'étape actuelle vers celle-là | « ce déplacement n'est pas autorisé » |
| Vous avez donné un **motif**, si ce déplacement l'exige | « un commentaire est requis » |
| Les **questions obligatoires** de l'étape d'arrivée ont une réponse | « questions sans réponse », suivi de la liste des questions manquantes |

**Le quatrième point est le cœur de la chose.** Le workflow que vous avez dessiné n'est pas une
suggestion : une affaire ne peut emprunter qu'un déplacement que vous avez déclaré. Dans l'espace de
travail livré, une affaire en « Prospect » peut passer en « Relance » ou être marquée perdue, mais
pas sauter directement en « Négociation ». Le produit vous le dit, et il refuse.

**Le cinquième explique une exigence que vous rencontrerez tôt.** Les quatre déplacements « Marquer
perdu » du workflow livré exigent un motif. Un motif fait uniquement d'espaces est refusé comme
l'absence de motif.

**Le sixième est celui que vous rencontrerez le plus souvent.** Une affaire ne peut pas entrer dans
une étape qui pose des questions obligatoires tant que ces questions n'ont pas de réponse. Le refus
**nomme les questions manquantes**, une par une, pour que vous sachiez lesquelles remplir sans avoir
à deviner. Deux précisions comptent :

- une question **cachée** à l'étape d'arrivée n'est jamais exigée, même sans réponse ;
- une question posée **par le déplacement lui-même**, et non par l'étape d'arrivée, est exigée tout
  autant : c'est le cas de « Lien vers la proposition » avant de démarrer la réalisation.

Deux effets accompagnent chaque déplacement accepté : la date d'**entrée dans l'étape** est remise
à l'instant présent — c'est elle qui mesurera l'ancienneté d'une affaire à son étape —, et l'affaire
est placée **en fin** de la colonne d'arrivée, sans bousculer l'ordre que vous y aviez mis.

**Deux limites à connaître, et elles sont réelles.**

1. **Le motif que vous donnez n'est conservé nulle part.** Il est exigé, il est contrôlé, et il
   disparaît : les commentaires arrivent avec leur propre chapitre. Un déplacement motivé est donc
   accepté, mais sa raison n'est pas relisible.
2. **Aucune trace du déplacement n'est enregistrée.** L'historique d'une affaire n'existe pas
   encore.

**Aucun écran ne permet encore de faire ce geste.** Le tableau kanban et son glisser-déposer
arrivent au chapitre suivant ; la règle, elle, est déjà en place et opposable — c'est volontaire,
l'interface ne fera qu'exercer une garde qui existe déjà.

### 4.4 Archiver n'est pas supprimer

Une affaire a **deux** façons de quitter votre vue, et elles ne veulent pas dire la même chose.

| Geste | Ce que cela signifie | Réversible |
|---|---|---|
| **Archiver** | Le dossier est clos, et vous le conservez | Oui |
| **Mettre à la corbeille** | C'était une erreur de saisie, vous l'effacez | Oui |

Aucune suppression définitive n'existe : le produit n'en expose aucune, à personne, pas même à une
administratrice. Ce qu'il appelle « supprimer » est toujours une date posée sur la ligne, que l'on
peut retirer.

**Une affaire archivée ou en corbeille n'occupe plus son étape.** C'est ce qui permet d'archiver un
état du catalogue (chapitre 20) une fois que toutes les affaires qui s'y trouvaient ont été closes.
À l'inverse, un état qu'une affaire **active** occupe encore ne peut pas être archivé : le produit
refuse, plutôt que de faire disparaître une colonne du tableau sous les affaires qu'elle contient.

### 4.5 Qui peut faire quoi

- **Voir** les affaires d'un onglet suppose le droit de lire cet onglet. Les accès par track et par
  channel du §3.2 *quater* s'appliquent **dès la première affaire** : une restriction `Aucun accès`
  masque les affaires comme elle masque l'onglet, et un accès `Membre` posé sur un onglet les rouvre
  même si le track est fermé.
- **Créer et modifier** une affaire suppose le droit d'**écriture** sur l'onglet. Une personne en
  lecture seule voit les affaires et ne peut pas les toucher — et sa tentative ne produit aucun
  message d'erreur : la modification n'a simplement aucun effet.
- **Déplacer** une affaire vers un onglet où vous n'avez pas le droit d'écrire est refusé, même si
  vous aviez le droit d'écrire là où elle se trouvait.

### 4.6 Ce qui n'est pas encore livré

- **Le tableau et la vue liste** : aucun écran n'affiche encore les affaires.
- **Les commentaires, l'historique et les documents.**
- **Le score de santé** : la colonne existe, rien ne l'alimente.

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
