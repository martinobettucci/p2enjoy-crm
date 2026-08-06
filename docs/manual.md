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
| 4 | Créer une card et renseigner sa fiche | `CRM-040`, `CRM-037` | **Partiellement livré ; le formulaire a désormais un écran, en consultation seule** — voir les chapitres 4 et 4.7. L'affaire existe côté serveur avec son titre, son responsable, son montant, sa devise, sa probabilité, sa prochaine action, son archivage et sa corbeille. L'espace de travail livré en contient neuf, dont une archivée et une en corbeille. **Ses réponses au formulaire existent aussi depuis `CRM-036`** — voir le chapitre 24. Ce qui manque est l'**écran** |
| 5 | Faire avancer une card dans son workflow | `CRM-034`, `CRM-041` | **Livré, avec son écran** — voir les chapitres 4.3 et 4.8. Le tableau kanban, son glisser-déposer et son menu de déplacements sont livrés par `CRM-041` ; ils restent invisibles à un visiteur non identifié (INC-021). Côté serveur — Une affaire ne change d'étape que par un déplacement **déclaré** dans son workflow, et le produit refuse désormais toute écriture directe de l'étape, y compris par une administratrice. **Les six vérifications sont en place** depuis `CRM-036` : une affaire ne peut plus entrer dans une étape sans que les questions obligatoires de cette étape aient une réponse. Ce qui manque est l'écran : le tableau kanban et son glisser-déposer relèvent de `CRM-041` |
| 6 | Comprendre pourquoi une transition est refusée | `CRM-034`, `CRM-037`, `CRM-041` | **Livré** : les **six** motifs de refus existent, sont nommés (chapitre 4.3) et sont désormais **affichés** par le tableau (chapitre 4.8), y compris celui qui liste les questions restées sans réponse — nommées par leur libellé |
| 7 | Commenter et suivre l'historique d'une card | `CRM-043`, `CRM-044` | **Livré, avec son écran** — la **discussion** et l'**historique** d'une affaire tiennent dans un seul fil filtrable (chapitre 4.10). Écrire un commentaire exige le droit d'écriture sur le channel ; corriger et supprimer sont réservés à l'auteur, **la règle est appliquée par le serveur mais aucun bouton ne l'offre encore**. L'historique est écrit par le serveur seul et ne peut être ni fabriqué, ni corrigé, ni effacé ; il ne dit pas **qui** a agi, aucun nom n'étant lisible |
| 7 bis | Ranger une affaire dans un autre dossier | `CRM-045` | **Livré côté serveur, sans écran.** Une affaire peut changer de channel — donc, si le channel d'arrivée suit un autre processus, changer de processus. L'étape d'arrivée doit alors être **choisie explicitement** : l'application ne devine jamais l'étape équivalente, deux processus pouvant porter la même étape sans qu'elle veuille dire la même chose. **Les réponses au formulaire de l'affaire sont perdues** lorsque le processus change — elles répondaient aux questions de l'ancien —, et l'opération est refusée tant que cette perte n'a pas été acceptée explicitement ; le refus indique combien de réponses seraient perdues. L'historique de l'affaire, lui, conserve les réponses données : la mémoire survit à la donnée. Le déplacement laisse une trace « changement de dossier » dans l'historique, y compris quand personne ne passe par l'application. Ce qui manque est l'écran : aucun bouton ne permet encore de déplacer une affaire, et il n'y en aura pas avant qu'un écran de connexion existe (INC-021) |
| 8 | Vue liste, filtres et vues sauvegardées | `CRM-042`, `CRM-071` | **Partiellement livré** — la vue liste, son tri, ses deux filtres et sa pagination existent (chapitre 4.9) ; les **vues sauvegardées** relèvent de `CRM-071` et ne sont pas livrées |
| 9 | Prochaine action et vue « Ma journée » | `CRM-061` | À livrer |

### Messagerie

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 10 | Connecter sa boîte de réception (IMAP) | `CRM-052` | À livrer |
| 11 | Configurer son adresse d'expédition (SMTP) | `CRM-053` | À livrer |
| 12 | L'adresse email d'une card : à quoi elle sert | `CRM-040`, `CRM-013`, `CRM-054` | **Partiellement livré** : l'adresse est **générée** à la création de chaque affaire, non devinable, et depuis `CRM-013` **non modifiable** — le refus est appliqué par le serveur et tient hors de l'écran (chapitre 4.2). Ce à quoi elle sert — recevoir les messages et les rattacher à l'affaire — relève de `CRM-054` |
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

Ouvrir un onglet change l'adresse de la page : elle se partage et se met en favori. Le contenu d'un
channel se lit désormais de **deux façons**, et une bascule en haut de la zone principale passe de
l'une à l'autre : le **tableau kanban** (chapitre 4.8), qui est la vue par défaut, et la **vue
liste** (chapitre 4.9). Chacune a sa propre adresse.

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

**Elle ne se modifie pas non plus après coup.** Le produit refuse toute tentative de réécrire
l'adresse d'une affaire, y compris à un administrateur, et y compris si l'on s'adresse directement
à l'API sans passer par l'écran. Sans ce refus, il suffirait de remplacer une adresse tirée au
hasard par une adresse triviale pour que n'importe qui puisse écrire à l'affaire. L'adresse se
**lit**, en revanche, par toute personne qui peut consulter l'affaire : c'est une identité, pas un
mot de passe.

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

### 4.7 La fiche d'une affaire : son formulaire, et ce qu'il montre

Une affaire s'ouvre à l'adresse `/tracks/<track>/<onglet>/cards/<identifiant de l'affaire>`. Cet
écran affiche le **formulaire de l'étape où l'affaire se trouve**, et lui seul : la timeline, les
commentaires et les champs d'en-tête arrivent avec leurs chapitres.

Ce que vous y voyez :

- **les questions de l'étape courante**, dans l'ordre que l'administration leur a donné. Une
  question sans réglage particulier est **affichée** : c'est la valeur par défaut, et elle évite de
  devoir déclarer une règle par étape pour les questions courantes ;
- **une étoile et la mention « Requis pour passer à <étape> »** sur les questions obligatoires.
  L'étoile ne porte jamais l'information seule : la mention l'écrit en toutes lettres, et les
  lecteurs d'écran l'annoncent ;
- **un message d'alerte** sous chaque question obligatoire restée sans réponse. Il ne bloque pas la
  lecture : il signale ce qui manquera au moment de faire avancer l'affaire ;
- **une section repliée « Informations d'autres étapes »**, qui rassemble les réponses données à des
  questions que l'étape courante n'affiche pas — et celles données à une question **archivée**
  depuis. Rien de ce qui a été saisi ne disparaît de la vue sans y être rangé.

**La barre d'onglets reste celle du track de l'adresse.** Ouvrir une affaire ne vous fait pas
perdre votre contexte : les onglets du track continuent d'être affichés au-dessus de la fiche, et
celui de l'affaire ouverte est **souligné**, comme lorsque vous le parcourez. Un clic sur un autre
onglet vous y ramène.

*Ce que le produit ne vérifie pas, et que vous pouvez constater :* l'adresse d'une affaire nomme un
track et un onglet, mais **rien ne les confronte à l'affaire elle-même**. Une adresse dont le track
serait faux afficherait la bonne affaire sous les mauvais onglets. Aucun droit n'est contourné pour
autant : chaque partie de l'écran reste soumise à ce que le serveur vous consent.

**Cet écran est en consultation seule, et il le dit.** Un bandeau explique que l'enregistrement
d'une réponse exige une session, et qu'aucun écran de connexion n'est encore livré. Les champs
restent lisibles et sont désactivés — vous voyez ce que l'affaire porte, vous ne pouvez rien y
écrire depuis le produit.

**Conséquence de l'absence de connexion :** ouvrir cette adresse aujourd'hui affiche « Affaire
introuvable ». Ce n'est pas un défaut de l'écran, c'est le refus réel du serveur, qui ne consent
aucune affaire à un visiteur non identifié — la même cause que pour les tracks et les onglets
(chapitre 3.2).

### 4.8 Le tableau kanban d'un channel

Ouvrir un onglet de channel affiche son **tableau** : une colonne par étape de son workflow, dans
l'ordre de ces étapes.

**Ce que montre une colonne.** Son libellé, le nombre d'affaires qu'elle contient, et le **montant
cumulé** de celles qui en portent un. Une colonne mêlant deux devises n'affiche aucun cumul plutôt
qu'une addition qui n'aurait pas de sens. Une colonne sans affaire le dit — c'est la situation
normale : un workflow de sept étapes est rarement occupé partout.

**Ce que montre une affaire.** Un liseré à la couleur de son étape, son titre — cliquable, il ouvre
sa fiche —, son montant, sa prochaine action, et depuis combien de jours elle est dans cette étape.
Ce dernier repère passe au **rouge** quand le seuil de relance de l'étape est dépassé ; il
n'apparaît pas lorsque l'étape n'en définit aucun.

Les affaires **archivées** et celles en **corbeille** n'y figurent pas : le tableau montre l'activité
en cours (chapitre 4.4).

**Faire avancer une affaire : deux gestes, une seule règle.**

- **À la souris**, en faisant glisser la carte vers une colonne. Seules les colonnes vers lesquelles
  un déplacement est **déclaré** dans le workflow acceptent le dépôt ; les autres le refusent
  visuellement, et aucune demande n'est envoyée au serveur.
- **Au clavier**, par le bouton « Déplacer » de la carte, qui ouvre la liste des déplacements
  déclarés depuis l'étape courante — et **eux seuls**. Lorsqu'une étape n'en propose aucun, le
  bouton reste lisible et le dit.

Les deux gestes passent par le même contrôle du serveur, celui du chapitre 4.3 : l'écran ne propose
jamais une action que le serveur refuserait, et il ne se substitue jamais à lui.

**Quand un motif est exigé.** Certains déplacements — « Marquer perdu », par exemple — exigent une
raison. L'écran la demande **avant** d'envoyer quoi que ce soit, et l'affaire ne bouge pas tant que
vous ne l'avez pas donnée. **Ce motif n'est pas encore conservé** : il valide le déplacement, puis
il est perdu, faute d'historique des affaires. L'écran vous le dit plutôt que de vous laisser croire
le contraire.

**Quand le serveur refuse.** L'affaire **retourne exactement à sa place**, et la raison s'affiche :
déplacement non déclaré, droit d'écriture insuffisant, affaire devenue inaccessible, ou **liste des
questions restées sans réponse**, nommées par leur libellé. Un refus que l'écran ne connaîtrait pas
est affiché tel quel, plutôt que traduit à tort.

**Conséquence de l'absence de connexion :** ouvrir cette adresse aujourd'hui affiche « Track
introuvable » — le serveur ne consent aucun track à un visiteur non identifié, et le tableau n'est
donc jamais atteint (chapitre 3.2).

### 4.9 La vue liste d'un channel

À côté du tableau, un channel se lit aussi **en liste**. La bascule **Tableau / Liste**, en haut de
la zone principale, passe de l'une à l'autre ; chaque vue a son adresse, et la liste ajoute la
sienne au chemin du channel (`…/liste`).

**À quoi elle sert.** Le tableau répond à « où en est chaque affaire ? ». La liste répond à
« laquelle, parmi toutes, dois-je ouvrir ? ». Elle montre les mêmes affaires — celles qui ne sont
ni archivées ni en corbeille — rangées par leurs propres colonnes plutôt que par le workflow.

**Ce que montre une ligne.** Le titre de l'affaire, qui est un **lien** vers sa fiche ; son étape,
en pastille de couleur ; son montant ; sa prochaine action ; et son échéance. Une ligne tient sur
**une seule ligne de texte** : un titre trop long est coupé, et la valeur entière apparaît en
survolant. C'est délibéré — une liste se balaye en diagonale, là où une carte de tableau se lit.

**Une case vide est vide.** Aucun tiret, aucun « non renseigné » : lorsqu'une affaire ne porte pas
de montant ou pas d'échéance, la case reste blanche. Un tiret serait un caractère que rien ne
distingue d'une donnée.

**Trier.** Trois colonnes se trient, en cliquant leur en-tête — ou en l'atteignant au clavier et en
pressant `Entrée` : **Affaire** (par ordre alphabétique), **Montant** (la plus grosse d'abord) et
**Échéance** (la plus proche d'abord). Un second clic inverse le sens. Une affaire sans montant ou
sans échéance se range **toujours en dernier**, dans les deux sens : une case vide n'est pas la plus
grosse affaire du channel.

**Filtrer.** Deux filtres, au-dessus du tableau :

- **Étape** — n'afficher que les affaires d'une étape donnée. Toutes les étapes du workflow sont
  proposées, y compris celles qu'aucune affaire n'occupe ;
- **Rechercher une affaire** — un ou plusieurs mots, cherchés dans le **titre et la description**.
  La recherche part lorsque vous validez, par le bouton ou par `Entrée`, et non à chaque frappe.
  Elle est faite pour le français : une affaire rédigée en anglais peut lui échapper.

Le compte affiché à droite — « Affaires : 3 » — est celui des affaires **qui correspondent aux
filtres**, pas celui du channel entier.

**Paginer.** La liste affiche **25 affaires par page**. Les boutons *Page précédente* et *Page
suivante* encadrent le rang courant, écrit en toutes lettres (« Page 2 sur 5 ») ; ils restent
visibles aux extrémités, simplement inutilisables, plutôt que de disparaître.

**Tout est dans l'adresse.** Le tri, les filtres et le rang de page s'inscrivent dans l'adresse de
la page. Recharger la page vous ramène exactement où vous étiez, et l'adresse se partage telle
quelle. Une adresse abîmée à la main — un tri qui n'existe pas, un rang de page trop grand —
retombe sur les valeurs par défaut sans afficher d'erreur.

**Quand la liste ne montre rien.** Deux messages distincts, parce qu'ils n'appellent pas la même
réponse : « Aucune affaire dans ce channel », et « Aucune affaire ne correspond », qui propose
d'effacer les filtres. Un troisième existe : si le nombre d'affaires a diminué pendant que la page
était ouverte, une page devenue inexistante affiche « Cette page n'existe plus » et propose de
revenir à la première — jamais un message d'erreur technique.

**Ce que la liste ne fait pas.** Elle **lit**. On n'y crée, n'y modifie, n'y archive et n'y déplace
aucune affaire : le déplacement reste le geste du tableau (chapitre 4.8), et le reste n'a pas encore
d'écran. Le **responsable** n'y figure pas non plus, pour le même motif qu'au tableau : aucun nom
n'est aujourd'hui lisible, et le produit préfère ne rien afficher qu'un identifiant technique.

**Conséquence de l'absence de connexion :** ouvrir cette adresse aujourd'hui affiche « Track
introuvable », comme pour le tableau (chapitre 3.2).

### 4.10 L'historique et la discussion d'une affaire

À droite de la fiche d'une affaire — sous le formulaire lorsque l'écran est étroit — se trouve
**Historique et discussion**. C'est **un seul fil**, du plus ancien en haut au plus récent en bas
comme une conversation se lit, où se mêlent deux choses : ce que les gens ont **dit** — les
commentaires — et ce qui est **arrivé** à l'affaire.

**Ce que l'affaire retient d'elle-même.** Chaque fait laisse une trace, écrite au moment où il a
lieu :

| Ce qui s'est passé | Ce que le fil montre |
|---|---|
| L'affaire a été créée | *Affaire créée* |
| Elle a changé d'étape | *Étape franchie*, avec les deux étapes — par exemple « Prospection → Relance » |
| Son responsable a changé | *Responsable modifié* |
| Elle a été archivée, ou remise en service | *Affaire archivée* / *Affaire désarchivée* |
| Elle a été mise à la corbeille, ou restaurée | *Affaire mise à la corbeille* / *Affaire restaurée* |
| Une réponse de formulaire a été saisie ou changée | *Champ renseigné*, avec le nom du champ |

**Ces traces ne peuvent être ni fabriquées, ni corrigées, ni effacées.** Personne ne peut en écrire
une à la main — ni un utilisateur, ni un administrateur, ni le compte technique qui installe le jeu
de démonstration. C'est le serveur qui les écrit, au moment de l'acte. Une fois écrite, une trace ne
peut plus être modifiée par qui que ce soit. Ce que l'historique montre a donc **réellement eu
lieu** ; en revanche, il ne dit **pas qui** l'a fait, pour la même raison qu'ailleurs dans le
produit : aucun nom de personne n'est aujourd'hui lisible.

**Une action qui ne change rien ne laisse rien.** Réenregistrer une réponse identique, ou
réattribuer une affaire à la personne qui en est déjà responsable, n'ajoute aucune ligne au fil.

**Filtrer le fil.** Quatre bascules le trient par famille : *Discussion*, *Étapes*, *Champs*,
*Cycle de vie*. Toutes sont actives à l'ouverture, et le nombre porté par chacune compte ce que
l'affaire contient — il ne bouge pas quand vous éteignez la famille. Éteindre tout affiche « Aucun
élément pour ces filtres », qui ne se confond pas avec « Aucun événement pour le moment » : le
premier dit que vous filtrez, le second qu'il n'y a rien. **Rien n'est retenu** : rouvrir la fiche
rétablit le fil complet, et aucune préférence n'est enregistrée sur votre appareil.

**Qui peut écrire.** Toute personne qui a le droit d'**écrire** dans le channel de l'affaire. Un
compte en consultation seule **lit** la discussion sans pouvoir y ajouter quoi que ce soit : la
demande est refusée par le serveur, et l'écran l'explique. Ce n'est pas le bouton qui décide — il
est toujours là — mais le serveur, et lui seul.

**Écrire un commentaire.** Le champ se trouve sous le fil. Le bouton *Publier* reste indisponible
tant que le champ est vide ou ne contient que des espaces. Un commentaire fait au plus **10 000
caractères**. Si la publication est refusée, **votre texte reste dans le champ** : vous n'avez rien
à ressaisir.

**Corriger et supprimer : la règle existe, les boutons pas encore.** Le serveur n'autorise la
correction et la suppression d'un commentaire qu'à **son auteur**, et à personne d'autre —
administrateur compris. **Aucun bouton ne les propose encore dans le fil** : la règle est donc
opposable, mais le geste n'est pas offert par l'écran.

Ce que cette règle donnera, une fois le geste livré : un commentaire corrigé portera la mention
*modifié* — l'écran l'affiche **déjà** pour les commentaires corrigés autrement —, avec sa date en
infobulle ; et **la suppression sera définitive**. Un commentaire supprimé garde sa place dans la
conversation, pour qu'on voie qu'un tour de parole a existé, mais **son texte est détruit** : il
n'est pas seulement masqué, il n'est plus enregistré nulle part et rien ne permet de le retrouver.
Il ne peut alors plus être ni corrigé, ni restauré. L'écran sait déjà afficher un commentaire
supprimé — la mention *Commentaire supprimé* à sa place.

**Le fil se met à jour tout seul, pour la discussion seulement.** Un commentaire publié par un
collègue apparaît sans que vous rechargiez la page — et seulement chez les personnes qui ont accès à
l'affaire. Une suppression se propage de la même façon. **Les faits, eux, ne s'affichent pas
d'eux-mêmes** : un déplacement effectué par un collègue pendant que vous regardez la fiche
n'apparaît qu'au prochain chargement.

**Ce que le fil ne fait pas encore.**

- **On lit, on filtre, on ne fait rien d'autre** : aucune action n'est proposée depuis une ligne
  d'historique.
- **Le motif d'un déplacement n'est conservé nulle part.** L'écran le demande lorsqu'une affaire est
  marquée perdue, et il n'est enregistré ni dans le fil, ni ailleurs.
- **Les emails et les activités — appels, réunions — n'apparaissent pas** : ils n'existent pas encore
  dans le produit.
- **Aucune recherche, aucun regroupement par jour, aucun export** du fil.

- **Aucun nom d'auteur n'est affiché** : aucun nom de personne n'est aujourd'hui lisible dans le
  produit, et il est préféré de ne rien afficher plutôt qu'un identifiant technique. C'est la même
  limite que pour le responsable d'une affaire (chapitres 4.8 et 4.9).
- **Les mentions ne préviennent personne** : écrire le nom d'un collègue dans un commentaire ne lui
  envoie aucune notification.
- **La mise en forme n'est pas interprétée** : le texte est affiché tel qu'il a été saisi, retours à
  la ligne compris, sans gras ni liens cliquables.
- **Aucun modérateur ne peut retirer le commentaire d'une autre personne**, pas même un
  administrateur.

**Conséquence de l'absence de connexion :** ouvrir la fiche d'une affaire aujourd'hui affiche
« Card introuvable », et la discussion n'est donc jamais atteinte (chapitre 3.2).

### 4.6 Ce qui n'est pas encore livré

- **Les vues sauvegardées** : la vue liste et ses filtres existent (chapitre 4.9), mais aucun filtre
  ne se conserve d'une session à l'autre autrement qu'en gardant l'adresse.
- **Le choix du nombre de lignes par page** : la liste en affiche vingt-cinq, et cela ne se règle pas.
- **La recherche sur tout l'espace de travail** : la recherche de la vue liste est bornée au channel
  ouvert.
- **La création et la modification d'une affaire** : aucun écran ne les porte, ni depuis le tableau,
  ni depuis la fiche.
- **Le réordonnancement d'une affaire dans sa colonne** : le déplacement change d'étape, pas de rang.
- **Le déplacement d'une affaire d'un channel à un autre.**
- **L'enregistrement d'une réponse depuis l'écran** (chapitre 4.7).
- **Le responsable et les étiquettes sur une carte** : le nom d'une personne n'est aujourd'hui
  lisible par personne, et le produit préfère ne rien afficher plutôt qu'un identifiant technique.
- **Les documents** : aucune pièce jointe n'est portée par le produit. L'historique, lui, est livré
  (chapitre 4.10).
- **La modification et la suppression d'un commentaire depuis l'écran** : la règle existe et le
  serveur l'applique, mais aucun bouton ne les propose encore dans le fil.
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
