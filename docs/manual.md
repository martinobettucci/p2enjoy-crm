# Manuel utilisateur — P2Enjoy CRM

> **Ce manuel est en cours de constitution.**
> Chaque chapitre est rédigé **au moment où l'unité correspondante est livrée**, à partir de
> l'application réellement exécutée, avec des captures produites lors de la vérification
> visuelle. Aucun chapitre n'est écrit d'avance : décrire un écran qui n'existe pas encore
> produirait une documentation fausse.
>
> Les chapitres marqués « à livrer » n'ont pas encore d'implémentation. Leur intitulé indique
> l'unité de backlog qui les produira (`docs/BACKLOG.md`).
>
> **Relu et corrigé de bout en bout par `CRM-047`, le 2026-08-06**, contre la pile réellement
> exécutée : treize écarts ont été relevés et douze refermés. Le treizième, INC-077, a été refermé
> par `CRM-019` le 2026-08-09. Ce que le manuel doit contenir et comment on le prouve sont spécifiés
> dans `docs/SPEC-manual.md`.

---

## Sommaire

### Prise en main

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 1 | Se connecter, récupérer son mot de passe | `CRM-011` | **Partiellement livré** — connexion, session d'onglet et déconnexion sont disponibles ; la récupération du mot de passe reste hors interface |
| 2 | Comprendre l'organisation : espace, tracks, channels, cards | `CRM-020`, `CRM-021` | À livrer |
| 3 | Naviguer : barre latérale, onglets, recherche | `CRM-007`, `CRM-065` | **Partiellement livré** — voir ci-dessous ; la recherche relève de `CRM-065` |

### Suivi quotidien

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 4 | Créer une card et renseigner sa fiche | `CRM-040`, `CRM-037` | **Partiellement livré ; la fiche a son écran, en consultation seule** — voir les chapitres 4 et 4.7. L'affaire existe côté serveur avec son titre, son responsable, son montant, sa devise, sa probabilité, sa prochaine action, son archivage et sa corbeille, et **ses réponses au formulaire** depuis `CRM-036` (chapitre 24). Combien l'espace de démonstration en porte : **annexe A**. Ce qui manque est l'écran de **création** et de **modification** : la fiche se lit, elle ne s'écrit pas |
| 5 | Faire avancer une card dans son workflow | `CRM-034`, `CRM-041` | **Livré, avec son écran** — voir les chapitres 4.3 et 4.8. Une affaire ne change d'étape que par un déplacement **déclaré** dans son workflow, et le produit refuse toute écriture directe de l'étape, y compris par une administratrice. **Les six vérifications sont en place** : une affaire ne peut pas entrer dans une étape sans que les questions obligatoires de cette étape aient une réponse. Le tableau kanban, son glisser-déposer et son menu de déplacements sont utilisables après connexion |
| 6 | Comprendre pourquoi une transition est refusée | `CRM-034`, `CRM-037`, `CRM-041` | **Livré** : les **six** motifs de refus existent, sont nommés (chapitre 4.3) et sont désormais **affichés** par le tableau (chapitre 4.8), y compris celui qui liste les questions restées sans réponse — nommées par leur libellé |
| 7 | Commenter et suivre l'historique d'une card | `CRM-043`, `CRM-044` | **Livré, avec son écran** — la **discussion** et l'**historique** d'une affaire tiennent dans un seul fil filtrable (chapitre 4.10). Écrire un commentaire exige le droit d'écriture sur le channel ; **corriger et supprimer sont réservés à l'auteur, et les deux gestes sont offerts par l'écran** — la suppression après confirmation, et elle est définitive. L'historique est écrit par le serveur seul et ne peut être ni fabriqué, ni corrigé, ni effacé |
| 7 bis | Ranger une affaire dans un autre dossier | `CRM-045` | **Livré côté serveur, sans écran** — voir le chapitre 4.11. Une affaire peut changer de channel — donc, si le channel d'arrivée suit un autre processus, changer de processus. L'étape d'arrivée doit alors être **choisie explicitement** : l'application ne devine jamais l'étape équivalente, deux processus pouvant porter la même étape sans qu'elle veuille dire la même chose. **Les réponses au formulaire de l'affaire sont perdues** lorsque le processus change — elles répondaient aux questions de l'ancien —, et l'opération est refusée tant que cette perte n'a pas été acceptée explicitement ; le refus indique combien de réponses seraient perdues. L'historique de l'affaire, lui, conserve les réponses données : la mémoire survit à la donnée. Le déplacement laisse une trace **« Dossier changé »** dans l'historique, y compris quand personne ne passe par l'application. Ce qui manque est uniquement l'écran : aucun bouton ne permet encore ce rangement |
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
| 17 | Inviter et gérer les membres | `CRM-070` | À livrer. **L'invitation est aujourd'hui une opération d'exploitation, pas un parcours produit** : un compte est créé par un **opérateur** disposant de la clé de service, hors de l'interface. Aucun écran n'existe, et aucun n'est promis avant `CRM-070`, à laquelle l'arbitrage du responsable rattache ce parcours ([`docs/JOURNAL.md`](JOURNAL.md), décision 256, INC-015) |
| 18 | Créer des tracks et des channels | `CRM-020`, `CRM-021` | À livrer |
| 19 | Le catalogue de nœuds | `CRM-030` | **Partiellement livré, sans écran.** Le catalogue existe côté serveur — les états par lesquels une affaire passe, ceux du produit et les vôtres — et l'espace de travail est livré avec le sien (annexe A). Aucun écran ne permet encore de le consulter ni de le modifier : l'éditeur arrive avec le chapitre 20 (`CRM-031`) |
| 20 | Construire un workflow et ses transitions | `CRM-031` | **Partiellement livré, sans écran.** Le workflow existe côté serveur — l'espace de travail est livré avec le sien, « Cycle commercial standard », ses étapes et les déplacements qu'il autorise (annexe A), et chacun de ses channels suit un workflow. Ce qui manque est l'**éditeur** : aucun écran ne permet encore de dessiner un workflow |
| 21 | Copier un workflow dans un track et le modifier | `CRM-032`, `CRM-018` | **Partiellement livré, sans écran.** La copie existe côté serveur : un administrateur duplique un workflow global vers un track, avec ses étapes, transitions, champs, règles et exigences remappés, et la copie se souvient de son origine. L'espace de travail est livré avec un exemple, « Cycle commercial — Conseil IA » sur le track « Conseil & IA ». Une empreinte de composition permet au produit de signaler toute divergence, suppression comprise. Ce qui manque est l'écran : aucun bouton ne permet encore de copier, et la mention de divergence n'est affichée nulle part |
| 22 | Choisir le workflow d'un channel | `CRM-033`, `CRM-019` | **Livré côté serveur, sans écran.** Un channel suit désormais **obligatoirement** un workflow, et pas n'importe lequel : le workflow général de l'espace de travail, ou celui de son propre track. Toute affectation directe incohérente est refusée. Même lorsque le channel contient des affaires, une administratrice peut changer son workflow par l'API en donnant le mapping exhaustif de toutes les étapes occupées ; aucune affaire n'est laissée à moitié remappée et toute perte de réponse doit être acceptée explicitement. L'espace de travail livré le montre : tous ses channels suivent « Cycle commercial standard », sauf « Prospection » qui suit la copie réservée à son track (annexe A). Ce qui manque est l'écran : aucun sélecteur ne permet encore ce geste |
| 23 | Composer le formulaire d'un workflow | `CRM-035`, `CRM-018` | **Livré côté serveur, sans écran.** Un workflow porte son propre formulaire : budget estimé, origine du contact, date de signature prévue, motif de la perte, décideur identifié et lien vers la proposition, ainsi qu'un champ retiré dont les réponses restent consultables (volumes en annexe A). Un champ non déclaré à une étape y reste simplement visible : on ne déclare que les exceptions. Lorsqu'un workflow est copié vers un track, son formulaire, ses règles et ses exigences sont remappés avec lui ; il est utilisable immédiatement sans partager les identifiants de la source. L'obligation est appliquée : voir le chapitre 24. Ce qui manque est l'écran : la grille champ × étape n'existe pas |
| 24 | Répondre aux questions d'une affaire | `CRM-036`, `CRM-037` | **Partiellement livré dans l'écran.** Une affaire porte ses réponses, et le produit les **vérifie** : une réponse doit correspondre au type de la question — un montant est un nombre, une case est cochée ou non, une date est une date, et une liste de choix n'accepte que les choix déclarés. Les réponses et les exigences sont consultables sur la fiche ; leur enregistrement depuis cette fiche n'est pas encore livré |
| 24 bis | Restreindre l'accès à un track ou à un channel | `CRM-070` | À livrer |
| 12 bis | Ce que le produit fait d'un message reçu | `CRM-054`, `CRM-055` | **Livré côté serveur, sans écran** — voir le chapitre 4.14. Les messages sont relevés, rangés dans l'affaire à qui ils s'adressent, et une trace en apparaît dans son historique. Un message qu'on ne sait pas rattacher est conservé et reste « non classé » ; le ranger exige le droit d'**écrire** sur l'affaire. Une affaire archivée ne reçoit plus. Les pièces jointes sont **analysées** : une pièce n'est téléchargeable qu'une fois déclarée saine, et une pièce non analysée ne l'est pas davantage |
| 25 bis | Écrire depuis une autre adresse que celle où l'on reçoit | `CRM-053` | **Livré côté serveur, sans écran** — voir le chapitre 4.13. Recevoir et expédier sont deux choses distinctes : une personne peut relever `bizdev@` et écrire depuis `contact@`, et l'espace de démonstration le montre. Une adresse par défaut existe toujours, et en déclarer une nouvelle **déplace** la marque au lieu d'exiger qu'on retire l'ancienne. L'adresse d'expédition est vérifiée à l'enregistrement, puisque c'est la seule donnée que vos destinataires verront. Le quota quotidien peut être déclaré mais **n'est appliqué par rien** tant que l'envoi n'est pas livré |
| 25 | Boîte mail système de l'espace | `CRM-052` | **Livré côté serveur, sans écran** — voir le chapitre 4.12. L'espace de travail et chaque personne peuvent avoir une boîte de réception déclarée, avec son serveur, son identifiant et son mot de passe **chiffré**. Le mot de passe n'est jamais réaffiché, ni même sa référence : personne ne peut le relire, pas même un administrateur. Le produit sait **essayer réellement la connexion** et dire ce qui a échoué. Ce qui manque est l'écran : aucun formulaire ne permet encore de déclarer une boîte depuis l'application |
| 26 | Jetons d'API et webhooks | `CRM-073` | À livrer |
| 27 | Journal d'audit, export et suppression de données | `CRM-072` | À livrer |

### Pilotage

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 28 | Analytique de conversion par channel et par track | `CRM-066` | À livrer |
| 29 | Prévisionnel pondéré et objectifs | `CRM-066` | À livrer |
| 30 | Cards figées et relances automatiques | `CRM-062` | À livrer |

---

## 1. Se connecter et se déconnecter

*Connexion livrée par `CRM-011`. Captures dans `docs/captures/CRM-011/`.*

Ouvrez `/connexion`, saisissez l'adresse email et le mot de passe du compte qui vous a été invité,
puis choisissez **Se connecter**. Si vous aviez commencé depuis une fiche ou un board, le produit
vous ramène à cette même adresse après le succès.

Une adresse inconnue et un mot de passe erroné donnent volontairement le même message : le produit
ne révèle pas si un compte existe. Une panne de serveur est distinguée d'un refus d'identifiants et
invite à réessayer. Le formulaire fonctionne au clavier et replace le focus sur l'adresse après un
refus.

La session dure pendant l'onglet courant et survit à son rechargement. Elle n'est jamais écrite
dans le stockage durable du navigateur : fermer l'onglet la fait disparaître. L'en-tête affiche
l'adresse du compte connecté et l'action **Se déconnecter**, qui révoque la session puis revient à
l'écran de connexion.

Dans l'environnement de développement seedé, les trois comptes de démonstration sont
`admin@p2enjoy.test`, `bizdev@p2enjoy.test` et `viewer@p2enjoy.test`, avec le mot de passe commun
`SeedDev2026Local`. Ces identifiants `.test` ne sont jamais des comptes de production.

**Ce qui reste hors interface.** La récupération du mot de passe est appliquée et prouvée côté
serveur, mais aucun écran ne la porte encore. L'invitation demeure une opération d'exploitation :
la webapp ne détient jamais la clé de service nécessaire (INC-015).

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

Sans session, l'application affiche les états vides et « introuvable » que le serveur oppose à un
visiteur anonyme. Après connexion, la barre latérale montre les tracks consentis à votre compte ;
leurs onglets ouvrent les channels, le tableau et les fiches réels. Une administratrice du jeu de
démonstration voit par exemple « Conseil & IA », « Studio web » et « Formation ».

Après connexion, l'en-tête nomme votre workspace et votre profil. Les cards nomment leur
responsable, les commentaires leur auteur et les événements leur acteur lorsque cette identité est
connue. Une identité supprimée ne transforme jamais son UUID en libellé : un commentaire conserve
sa place avec « Compte supprimé », tandis qu'un événement de service reste sans acteur affiché.

**Ce qui a un écran, et ce qui n'en a pas.** L'affaire a sa fiche, le tableau kanban de son channel
et la vue liste ; la discussion et l'historique vivent dans la fiche. En revanche, le catalogue de
nœuds, les workflows, leur éditeur de formulaire et les droits d'accès n'ont toujours aucun écran
d'administration. La connexion rend accessibles les surfaces déjà livrées ; elle ne fabrique pas
les éditeurs encore absents.

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

**Aucun écran ne permet encore de les gérer.** La gestion des tracks passe aujourd'hui par l'API,
ce qui est une opération d'exploitation, pas un parcours produit.

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

**Aucun écran ne permet encore de les gérer.** La règle est en revanche appliquée par le serveur,
et non par l'affichage : elle tient même si l'on s'adresse directement à l'API.

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
ne permet encore de les gérer**.

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

**Ce qui reste de l'affaire après un déplacement, et ce qui n'en reste pas.**

1. **Le déplacement laisse une trace**, écrite par le serveur au moment où il a lieu : le fil de
   l'affaire affiche *Étape franchie*, avec les deux étapes (chapitre 4.10). Cette trace ne peut
   être ni fabriquée, ni corrigée, ni effacée.
2. **Le motif que vous donnez, lui, n'est conservé nulle part.** Il est exigé, il est contrôlé, et
   il disparaît. Un déplacement motivé est donc accepté, mais sa raison n'est **pas relisible** :
   ni dans le fil, ni ailleurs. Si la raison compte, écrivez-la en commentaire (chapitre 4.10) —
   c'est aujourd'hui le seul endroit où elle survit.

**Ce geste a désormais son écran** : le tableau kanban du chapitre 4.8, à la souris comme au
clavier. La règle décrite ici lui préexiste et ne dépend pas de lui — c'est volontaire, l'interface
ne fait qu'exercer une garde qui tient de toute façon si l'on s'adresse directement à l'API.

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
état du catalogue (chapitre 19) une fois que toutes les affaires qui s'y trouvaient ont été closes.
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

*Livrée par `CRM-037`. Captures dans `docs/captures/CRM-037/`.*

Une affaire s'ouvre à l'adresse `/tracks/<track>/<onglet>/cards/<identifiant de l'affaire>`. Cet
écran affiche à gauche le **formulaire de l'étape où l'affaire se trouve**, et à droite son
**historique et sa discussion** (chapitre 4.10). Ce qui n'y figure pas encore : les **champs
d'en-tête** — titre, responsable, montant, prochaine action —, qui n'ont aucun écran de saisie.

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

**Cet écran est en consultation seule, et il le dit.** L'enregistrement des réponses n'est pas
encore livré dans cette fiche. Les champs restent lisibles et sont désactivés — vous voyez ce que
l'affaire porte, vous ne pouvez pas encore l'y modifier.

Sans connexion, cette adresse affiche « Card introuvable » : c'est le refus réel du serveur. Après
connexion, une card consentie ouvre sa fiche et son fil.

### 4.8 Le tableau kanban d'un channel

*Livré par `CRM-041`. Captures dans `docs/captures/CRM-041/`, dont une vidéo du glisser-déposer.*

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

Sans connexion, cette adresse affiche « Track introuvable ». Après connexion, le tableau réel est
atteint et les déplacements consentis sont exécutables depuis le menu ou par glisser-déposer.

### 4.9 La vue liste d'un channel

*Livrée par `CRM-042`. Captures dans `docs/captures/CRM-042/`.*

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

Sans connexion, cette adresse affiche « Track introuvable », comme pour le tableau. Après
connexion, la liste réelle est consultable, triable et filtrable.

### 4.10 L'historique et la discussion d'une affaire

*Livrée par `CRM-043` et `CRM-044`. Captures dans `docs/captures/CRM-043/` et
`docs/captures/CRM-044/`.*

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

**Filtrer le fil.** Cinq bascules le trient par famille : *Discussion*, *Étapes*, *Champs*,
*Organisation*, *Cycle de vie*. Toutes sont actives à l'ouverture, et le nombre porté par chacune
compte ce que l'affaire contient — il ne bouge pas quand vous éteignez la famille. Éteindre tout
affiche « Aucun élément pour ces filtres », qui ne se confond pas avec « Aucun événement pour le moment » : le
premier dit que vous filtrez, le second qu'il n'y a rien. **Rien n'est retenu** : rouvrir la fiche
rétablit le fil complet, et aucune préférence n'est enregistrée sur votre appareil.

**La barre de filtres n'apparaît que s'il y a quelque chose à filtrer.** Sur une affaire dont le
fil est vide, elle est absente : cinq bascules affichant « 0 » au-dessus de « aucun événement pour
le moment » seraient un contrôle sans objet.

**Les changements de contexte sont nommés.** Lorsqu'une affaire change de dossier (chapitre 4.11),
le serveur écrit une trace **« Dossier changé »**. Lorsqu'un administrateur remappe toutes les
affaires d'un dossier vers un autre processus, le fil dit **« Workflow modifié »**. Il ne donne pas
les noms avant/après : la vue ne résout pas ces noms historiques et n'en invente aucun. INC-077 est
close par `CRM-019`.

**Qui peut écrire.** Toute personne qui a le droit d'**écrire** dans le channel de l'affaire. Un
compte en consultation seule **lit** la discussion sans pouvoir y ajouter quoi que ce soit : la
demande est refusée par le serveur, et l'écran l'explique. Ce n'est pas le bouton qui décide — il
est toujours là — mais le serveur, et lui seul.

**Écrire un commentaire.** Le champ se trouve sous le fil. Le bouton *Publier* reste indisponible
tant que le champ est vide ou ne contient que des espaces. Un commentaire fait au plus **10 000
caractères**. Si la publication est refusée, **votre texte reste dans le champ** : vous n'avez rien
à ressaisir. Après une publication réussie, le curseur **revient dans le champ**, prêt pour le
message suivant — vous n'avez pas à retraverser la page pour reprendre la parole.

**Corriger et supprimer vos commentaires.** Le serveur n'autorise la correction et la suppression
d'un commentaire qu'à **son auteur**, et à personne d'autre — administrateur compris. Les deux
gestes sont désormais offerts par l'écran.

Placez le pointeur sur **votre** commentaire, ou atteignez-le avec la touche `Tab` : deux actions
apparaissent, *Modifier* et *Supprimer*. Elles ne s'affichent que sur vos propres commentaires,
parce qu'elles n'aboutiraient sur aucun autre.

*Modifier* remplace le texte par un champ, curseur placé à la fin, prêt à continuer votre phrase.
*Enregistrer* applique la correction, *Annuler* l'abandonne sans rien changer. Un commentaire
corrigé porte ensuite la mention *modifié*, avec sa date en infobulle. Cette mention n'est pas
décidée par l'écran : le serveur la pose lui-même dès que le texte change, et il n'y a donc aucun
moyen de corriger un commentaire sans que cela se voie.

*Supprimer* **demande d'abord confirmation**, en nommant ce qui va être perdu. Rien n'est effacé
tant que vous n'avez pas choisi *Supprimer définitivement* ; *Conserver* referme la demande. **La
suppression est définitive.** Un commentaire supprimé garde sa place dans la conversation, pour
qu'on voie qu'un tour de parole a existé, mais **son texte est détruit** : il n'est pas seulement
masqué, il n'est plus enregistré nulle part et rien ne permet de le retrouver. Il ne peut alors
plus être ni corrigé, ni restauré — les deux actions disparaissent, et la mention *Commentaire
supprimé* prend la place du texte.

**Si vos droits ont changé pendant que la fiche était ouverte**, le serveur refuse le geste sans
erreur visible : l'écran vous dit alors que rien n'a été modifié, plutôt que d'afficher une
correction qui n'a pas eu lieu.

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
- **Les emails et les activités — appels, réunions — n'apparaissent pas** : les boîtes de réception
  se déclarent et se testent depuis `CRM-052` (chapitre 4.12), mais aucun message n'est encore
  relevé, et les activités n'existent pas
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

Après connexion, le composeur publie réellement le commentaire si votre compte peut écrire dans
le channel. Un profil en lecture seule reçoit un refus explicite et conserve son texte saisi.

### 4.11 Ranger une affaire dans un autre dossier

*Livrée par `CRM-045`. Aucune capture : cette fonctionnalité n'a pas encore d'écran, voir §3.2.*

Une affaire peut **changer d'onglet** — de dossier. Le geste répond à une situation banale : une
affaire a été ouverte au mauvais endroit, ou elle a changé de nature et relève désormais d'une
autre activité.

Ce n'est pas un déplacement d'étape (chapitre 4.3), et les deux ne se confondent pas : l'un fait
avancer une affaire **dans** son processus, l'autre la fait changer **de** dossier — et donc, si le
dossier d'arrivée suit un autre processus, **de processus**.

**Ce que le produit vérifie avant d'accepter :**

| Ce qui est vérifié | Ce que vous voyez si cela bloque |
|---|---|
| L'affaire existe, vous y avez accès, et elle n'est **ni archivée ni en corbeille** | « affaire introuvable » |
| Vous avez le droit d'**écrire** dans son onglet d'origine | « accès refusé » |
| L'onglet d'arrivée existe et vous y avez accès | « dossier introuvable » |
| Vous avez le droit d'**écrire** dans l'onglet d'arrivée | « accès refusé » |
| L'onglet d'arrivée n'est pas celui où l'affaire se trouve déjà | « c'est déjà son dossier » |
| Si le processus change, l'**étape d'arrivée est choisie explicitement** | « choisissez l'étape d'arrivée » |
| L'étape choisie appartient bien au processus du dossier d'arrivée | « cette étape n'est pas dans ce workflow » |
| Si des réponses de formulaire seraient perdues, **vous l'avez accepté** | « des réponses seraient perdues », suivi de leur nombre |

**L'étape d'arrivée n'est jamais devinée, et c'est délibéré.** Deux processus peuvent porter une
étape du même nom sans qu'elle veuille dire la même chose ; choisir à votre place la première du
graphe, ou celle qui porte le même nom, produirait un rangement qui *paraît* juste. Quand le
processus **ne change pas**, l'affaire garde son étape et vous n'avez rien à choisir — la préciser
reste possible, c'est alors un changement de dossier **et** de colonne en un geste.

**Les réponses au formulaire sont perdues quand le processus change.** Une réponse répond à la
question d'un processus donné ; changer de processus la laisse sans question. Le produit **refuse**
plutôt que de détruire en silence, et le refus dit **combien** de réponses seraient perdues. Il faut
accepter explicitement la perte pour que le rangement ait lieu. Rien n'est perdu lorsque le
processus reste le même.

**La mémoire, elle, survit à la donnée.** Les réponses disparaissent de la fiche ; les traces
*Champ renseigné* qu'elles ont laissées dans l'historique restent, avec leurs dates (chapitre 4.10).
Rien ne peut effacer l'historique d'une affaire.

**Deux effets accompagnent le rangement.** L'affaire est placée **en fin** de la colonne d'arrivée,
comme pour un déplacement d'étape. Sa date d'**entrée dans l'étape** n'est remise à zéro **que si
l'étape change** : ranger une affaire dans un autre dossier sans la faire avancer ne doit pas faire
croire qu'elle vient d'entrer dans son étape — sans quoi une affaire en négociation depuis trois
semaines paraîtrait y être entrée à l'instant.

**Une trace est écrite.** Le rangement laisse un événement **« Dossier changé »** dans
l'historique de l'affaire, y compris lorsque personne ne passe par l'application. Le fil ne nomme
pas les dossiers avant/après, car il ne résout pas leurs noms historiques (chapitre 4.10).

**Aucun écran ne porte ce geste.** Le rangement passe aujourd'hui par l'API, ce qui est une
opération d'exploitation et non un parcours produit.

### 4.6 Ce qui n'est pas encore livré

- **Les vues sauvegardées** : la vue liste et ses filtres existent (chapitre 4.9), mais aucun filtre
  ne se conserve d'une session à l'autre autrement qu'en gardant l'adresse.
- **Le choix du nombre de lignes par page** : la liste en affiche vingt-cinq, et cela ne se règle pas.
- **La recherche sur tout l'espace de travail** : la recherche de la vue liste est bornée au channel
  ouvert.
- **La création et la modification d'une affaire** : aucun écran ne les porte, ni depuis le tableau,
  ni depuis la fiche.
- **Le réordonnancement d'une affaire dans sa colonne** : le déplacement change d'étape, pas de rang.
- **Le rangement d'une affaire dans un autre dossier depuis l'écran** : la règle existe et le
  serveur l'applique (chapitre 4.11), mais aucun bouton ne le propose.
- **L'enregistrement d'une réponse depuis l'écran** (chapitre 4.7).
- **Le responsable et les étiquettes sur une carte** : le nom d'une personne n'est aujourd'hui
  lisible par personne, et le produit préfère ne rien afficher plutôt qu'un identifiant technique.
- **Les documents** : aucune pièce jointe n'est portée par le produit. L'historique, lui, est livré
  (chapitre 4.10).
- **Le score de santé** : la colonne existe, rien ne l'alimente.

### 4.12 Les boîtes de réception déclarées

**Ce que le produit sait faire, et ce qu'il n'offre pas encore.** Un espace de travail peut
déclarer une **boîte système** — celle qui reçoit tout ce qui est adressé aux affaires — et chaque
personne peut déclarer **la sienne**. Une boîte porte un serveur, un port, un mode de sécurité, un
identifiant et un mot de passe. **Aucun écran ne permet encore de les déclarer** : c'est
l'exploitant qui les configure, et le chapitre décrit ce que le produit garantit lorsqu'il le fait.

**Le mot de passe n'est jamais relisible, par personne.** Il n'est pas enregistré dans la même
table que le reste : il part dans un coffre chiffré, et la table ne conserve qu'une **référence**.
Cette référence elle-même est fermée à toute personne connectée — administrateur compris. Seul le
service de messagerie, qui doit ouvrir la connexion, peut obtenir le mot de passe en clair.

**Vous ne voyez que votre boîte.** Un administrateur voit la boîte système et celles de son équipe,
puisqu'il en répond. Une personne qui n'est pas administratrice ne voit **que la sienne** : la
boîte d'un collègue est sa correspondance, et le serveur ne la lui montre pas. Une personne sans
boîte voit une liste vide, ce qui n'est pas une erreur.

**Le produit essaie vraiment la connexion.** Il ne se contente pas d'enregistrer ce qui a été
saisi : il ouvre une session avec le serveur déclaré et regarde ce qui se passe. Le résultat est
enregistré, et il ne dit jamais plus que nécessaire :

| Ce qui est affiché | Ce que cela veut dire |
|---|---|
| *Identifiants refusés* | Le mot de passe est faux **ou** le compte n'existe pas — les serveurs de messagerie ne font pas la différence, et le produit ne l'invente pas |
| *Serveur introuvable* | Le nom du serveur ne correspond à rien |
| *Connexion refusée* | Rien n'écoute à cette adresse et sur ce port |
| *Sécurité impossible à vérifier* | Le certificat du serveur ne peut pas être vérifié |
| *Délai dépassé* | Le serveur n'a pas répondu à temps |
| *Réponse inattendue* | Le serveur a répondu, mais pas comme un serveur de messagerie |

**Le message d'origine du serveur n'est jamais conservé.** Un serveur tiers peut écrire n'importe
quoi dans son refus — l'identifiant essayé, une adresse interne, un numéro de dossier. Ce texte
finirait affiché, puis dans une capture d'écran. Le produit note **la cause**, et rien d'autre.

**La vérification de sécurité n'a pas de dérogation.** Si le certificat d'un serveur ne peut pas
être vérifié, la connexion est refusée — il n'existe aucune option pour passer outre. C'est
volontaire : une option de ce genre finit toujours par rester activée.

### 4.13 Les adresses d'expédition

**Recevoir et expédier sont deux choses distinctes.** Une personne peut relever sa boîte
`bizdev@…` et pourtant écrire à ses clients depuis `contact@…` : le produit ne lie pas les deux, et
l'espace de démonstration le montre. Une adresse d'expédition porte son serveur d'envoi, son
identifiant, son mot de passe — chiffré comme celui d'une boîte de réception —, un nom affiché et
une signature.

**Une adresse est « celle par défaut », et il y en a toujours exactement une.** En déclarer une
nouvelle comme adresse par défaut **déplace** la marque : l'ancienne la perd au même instant. Vous
n'avez jamais à la retirer d'abord, et il n'existe aucun moment où vous n'auriez plus d'adresse par
défaut.

**L'adresse d'expédition est vérifiée à l'enregistrement.** C'est la seule donnée de cette
configuration que vos destinataires verront ; une chaîne qui n'est pas une adresse est refusée tout
de suite, plutôt que d'échouer plus tard, à l'envoi, sur un compte annoncé comme valide.

**Le produit essaie vraiment la connexion**, comme pour une boîte de réception, et **sans envoyer
aucun message** : il ouvre une session avec le serveur d'envoi, s'authentifie, et referme. Les
causes d'échec affichées sont les mêmes que celles du chapitre 4.12.

**Un quota quotidien peut être déclaré, mais il n'est appliqué par rien aujourd'hui** : l'envoi
lui-même n'est pas encore livré, et le dire vaut mieux que de laisser croire à un garde-fou qui
n'existe pas.

### 4.14 Ce que le produit fait d'un message reçu

**Les messages sont relevés, et rangés dans l'affaire à qui ils s'adressent.** Chaque affaire a son
adresse propre (chapitre 4.2) ; un message envoyé à cette adresse est rattaché à l'affaire **tout
seul**, et une trace en apparaît dans son historique. Une réponse à un message déjà rangé suit la
même affaire.

**Un message qu'on ne sait pas rattacher n'est pas perdu** : il est conservé, et reste « non
classé » jusqu'à ce que quelqu'un le range. Le ranger exige le droit d'**écrire** sur l'affaire :
y ajouter un message, c'est y ajouter du contenu.

**Une affaire archivée ou en corbeille ne reçoit plus.** Un message qui lui était adressé reste non
classé plutôt que de revenir dans un dossier que vous avez fermé.

**Les pièces jointes sont analysées avant d'être proposées.** Une pièce n'est téléchargeable
qu'une fois déclarée saine ; une pièce reconnue dangereuse est conservée mais **jamais**
téléchargeable, et une pièce que l'antivirus n'a pas pu examiner ne l'est pas davantage. Un fichier
non analysé n'est pas un fichier sain.

**Le nom d'un fichier reçu est nettoyé sans être perdu** : le produit affiche un nom sûr, et
conserve le nom d'origine tel que l'expéditeur l'a écrit.

**Ce que ces chapitres ne couvrent pas encore.** Aucun écran ne montre les messages : ils existent
côté serveur, rattachés aux affaires, mais l'inbox et la fiche ne les affichent pas. L'envoi n'est
pas livré non plus, ni la relève automatique — elle est déclenchée par l'exploitant. La suggestion
par contact connu attend la fiche contact.

## Annexe A — Ce que contient l'espace de démonstration

*Livrée par `CRM-047` ; le jeu lui-même est livré par `CRM-046` (`docs/SPEC-seed.md` §9).*

L'espace de travail livré avec le produit sert à **démontrer chaque fonctionnalité** : il n'existe
pas d'écran vide faute de données. Les volumes ci-dessous sont **mesurés sur la base**, et non
recopiés de mémoire ; `scripts/verify-manual.sh` les compare à la base à chaque vérification.

Ces nombres décrivent l'espace **tel que le seed le pose**. Ils changent dès que quelqu'un y
travaille : ce sont des états, pas des règles du produit. Les règles — vingt-cinq lignes par page,
dix mille caractères par commentaire, une probabilité entre 0 et 100 — vivent dans leur chapitre et
ne bougent qu'avec le produit.

| Grandeur | Valeur |
|---|---|
| Tracks actifs | 3 |
| Tracks archivés | 1 |
| Channels actifs | 5 |
| Channels archivés | 1 |
| États du catalogue actifs | 7 |
| États du catalogue archivés | 1 |
| Workflows | 2 |
| Workflows copiés dans un track | 1 |
| Étapes du workflow général | 7 |
| Déplacements déclarés par le workflow général | 11 |
| Questions du formulaire actives | 12 |
| Questions du formulaire retirées | 2 |
| Affaires | 14 |
| Affaires actives | 12 |
| Affaires archivées | 1 |
| Affaires en corbeille | 1 |
| Réponses de formulaire | 21 |
| Affaires portant au moins une réponse | 11 |
| Commentaires | 5 |
| Commentaires supprimés | 1 |
| Comptes de démonstration | 3 |

**Une grandeur manque, et son absence est un fait.** Le nombre d'**événements d'historique** ne
figure pas dans cette table : il ne peut que croître, et il croît dès que quiconque — une personne
ou une preuve automatisée — touche une affaire. Le figer par une égalité rendrait l'annexe fausse à
la première utilisation de l'espace. Ce qui est vérifié à la place est le seul invariant que ce fil
possède : **chaque affaire porte au moins l'événement de sa création**, et rien ne peut l'effacer
(chapitre 4.10).

**Pourquoi une annexe plutôt qu'une phrase dans chaque chapitre.** Un nombre recopié dans une
phrase n'a aucun lien avec la base qui le produit : il ne vieillit pas, il devient faux en silence
le jour où une autre livraison change le jeu de données. C'est exactement ce qui s'est produit deux
fois dans ce manuel avant `CRM-047`. Rassemblés ici, ces nombres sont vérifiables d'un coup, et une
dérive devient rouge au lieu de rester invisible (`docs/JOURNAL.md` décision 231).

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
- Les captures sont **renouvelées** dès que l'apparence ou le parcours change, et chaque chapitre
  nomme le dossier `docs/captures/<unité>/` où les siennes se trouvent.
- Un **libellé cité entre guillemets** est le libellé réel de l'application, au caractère près : le
  manuel ne paraphrase jamais un message d'erreur, il le cite.
- **Aucun volume du jeu de démonstration n'est écrit dans un chapitre** : ils vivent tous dans
  l'annexe A, où ils sont vérifiés contre la base. Les nombres qui sont des **règles du produit** —
  vingt-cinq lignes par page, dix mille caractères — restent dans leur chapitre.
- Ces règles sont opposables : `scripts/verify-manual.sh` en vérifie quatre, et
  `e2e/ui/manuel.spec.ts` exerce les huit adresses citées par le manuel en visiteur anonyme réel.
