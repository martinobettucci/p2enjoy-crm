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
| 1 bis | Le guide de démarrage : par où commencer | `CRM-079` | **Livré et vérifié** — voir le chapitre 1 *bis*. Cinq étapes mesurées à chaque affichage, chacune renvoyant vers l'écran qui la réalise. L'état est **mesuré**, jamais mémorisé : supprimer le dernier track décoche l'étape. Le guide se masque pour la session — rien n'est écrit durablement sur l'appareil — et reste toujours consultable depuis « Réglages ▸ Guide de démarrage ». Il **lit et renvoie** : il ne crée ni track, ni channel, ni affaire |
| 2 | Comprendre l'organisation : espace, tracks, channels, cards | `CRM-020`, `CRM-021` | À livrer |
| 3 | Naviguer : barre latérale, onglets, recherche | `CRM-007`, `CRM-065` | **Partiellement livré** — voir ci-dessous ; la recherche relève de `CRM-065` |
| 3 ter | Le carnet de contacts | `CRM-060` | **Livré en LECTURE** — voir la section 3 *ter*. L'entrée « Contacts » de la barre latérale ouvre le carnet de l'espace : nom, organisation, fonction, email et téléphone, une ligne par personne. Tout membre le lit, y compris un compte en lecture seule. Le nom d'organisation ouvre sa **fiche** (sous-tranche 4b) : domaine, site web et contacts rattachés. Une affaire **rattache et détache** ses contacts depuis sa fiche (sous-tranche 4c, chapitre 4.7 *ter*). Un contact **se crée** depuis le carnet (sous-tranche 4e) : le bouton « Nouveau contact » ouvre un formulaire au-dessus du tableau. Ce qui manque est dit : aucune modification ni suppression d'un contact, aucune création d'organisation, aucune recherche |

### Suivi quotidien

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 4 | Créer une card et renseigner sa fiche | `CRM-040`, `CRM-037` | **Partiellement livré ; la fiche a son écran, et ses réponses s'y saisissent** — voir les chapitres 4 et 4.7. L'affaire existe côté serveur avec son titre, son responsable, son montant, sa devise, sa probabilité, sa prochaine action, son archivage et sa corbeille, et **ses réponses au formulaire** depuis `CRM-036` (chapitre 24). Combien l'espace de démonstration en porte : **annexe A**. Ce qui manque est l'écran de **création** et la modification des champs d'**en-tête** — titre, responsable, montant, prochaine action ; les **réponses au formulaire**, elles, se saisissent depuis la fiche depuis le 2026-08-16, et les questions de type **contact** et **membre** se répondent dans une liste de NOMS depuis la sous-tranche 4d de `CRM-060` |
| 5 | Faire avancer une card dans son workflow | `CRM-034`, `CRM-041` | **Livré, avec son écran** — voir les chapitres 4.3 et 4.8. Une affaire ne change d'étape que par un déplacement **déclaré** dans son workflow, et le produit refuse toute écriture directe de l'étape, y compris par une administratrice. **Les six vérifications sont en place** : une affaire ne peut pas entrer dans une étape sans que les questions obligatoires de cette étape aient une réponse. Le tableau kanban, son glisser-déposer et son menu de déplacements sont utilisables après connexion |
| 6 | Comprendre pourquoi une transition est refusée | `CRM-034`, `CRM-037`, `CRM-041` | **Livré** : les **six** motifs de refus existent, sont nommés (chapitre 4.3) et sont désormais **affichés** par le tableau (chapitre 4.8), y compris celui qui liste les questions restées sans réponse — nommées par leur libellé |
| 7 | Commenter et suivre l'historique d'une card | `CRM-043`, `CRM-044` | **Livré, avec son écran** — la **discussion** et l'**historique** d'une affaire tiennent dans un seul fil filtrable (chapitre 4.10). Écrire un commentaire exige le droit d'écriture sur le channel ; **corriger est réservé à l'auteur**, et **supprimer lui est ouvert ainsi qu'aux administrateurs du workspace**, avec trace nominative du retrait. Les deux gestes de l'auteur sont offerts par l'écran, la suppression après confirmation et elle est définitive ; **le retrait par un administrateur a son bouton depuis le 2026-08-14**, unique — *Supprimer*, jamais *Modifier* —, et le fil distingue un retrait par la modération d'une suppression par l'auteur. L'historique est écrit par le serveur seul et ne peut être ni fabriqué, ni corrigé, ni effacé |
| 7 bis | Ranger une affaire dans un autre dossier | `CRM-045` | **Livré côté serveur, sans écran** — voir le chapitre 4.11. Une affaire peut changer de channel — donc, si le channel d'arrivée suit un autre processus, changer de processus. L'étape d'arrivée doit alors être **choisie explicitement** : l'application ne devine jamais l'étape équivalente, deux processus pouvant porter la même étape sans qu'elle veuille dire la même chose. **Les réponses au formulaire de l'affaire sont perdues** lorsque le processus change — elles répondaient aux questions de l'ancien —, et l'opération est refusée tant que cette perte n'a pas été acceptée explicitement ; le refus indique combien de réponses seraient perdues. L'historique de l'affaire, lui, conserve les réponses données : la mémoire survit à la donnée. Le déplacement laisse une trace **« Dossier changé »** dans l'historique, y compris quand personne ne passe par l'application. Ce qui manque est uniquement l'écran : aucun bouton ne permet encore ce rangement |
| 4.7 bis | Mettre une affaire à la corbeille | `CRM-077` | **Livré et vérifié** — voir le chapitre 4.7 *bis*. Le bouton vit en bas de la fiche de l'affaire, demande une confirmation qui la nomme, et remplace ensuite l'écran par les deux chemins utiles : revenir au channel, ou ouvrir la corbeille. Le geste suppose le droit d'**écrire** sur l'onglet, et non un rôle d'administrateur |
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
| 16 | Que faire quand un compte mail est en erreur | `CRM-059` | **Livré avec son écran, vérifié visuellement** — voir le chapitre 6. « Réglages ▸ État de la messagerie » montre la dernière relève réussie et le dernier incident de chaque boîte visible, ainsi que la file sortante en attente et en échec définitif. Ce qui manque : aucune alerte n'est envoyée, l'écran reste le seul endroit où le constater |

### Administration

| Chapitre | Contenu | Unité | État |
|---|---|---|---|
| 17 | Inviter et gérer les membres | `CRM-070` | À livrer. **L'invitation est aujourd'hui une opération d'exploitation, pas un parcours produit** : un compte est créé par un **opérateur** disposant de la clé de service, hors de l'interface. Aucun écran n'existe, et aucun n'est promis avant `CRM-070`, à laquelle l'arbitrage du responsable rattache ce parcours ([`docs/JOURNAL.md`](JOURNAL.md), décision 256, INC-015) |
| 18 | Créer des tracks et des channels | `CRM-020`, `CRM-021`, `CRM-075`, `CRM-077` | **Livré et vérifié** — voir le chapitre 5. Un administrateur crée, renomme, réordonne, archive, désarchive et **met à la corbeille** un track comme un channel, depuis « Réglages ▸ Arborescence ». Le rattachement d'un channel à son track et le choix de son workflow y sont faits. La **suppression définitive n'existe pas** : archiver masque, la corbeille retire, et les deux restent réversibles |
| 18 bis | Retrouver et restaurer ce qui a été retiré | `CRM-077` | **Livré et vérifié** — voir le chapitre 5 ter. « Réglages ▸ Corbeille » liste les tracks, channels et affaires retirés, qui les a retirés, quand, et ce que chacun retient avec lui ; un clic les rend. Un enfant dont le parent est lui-même dans la corbeille n'est pas restaurable seul, et le produit dit lequel restaurer d'abord. **Aucun effacement définitif n'est offert** : la durée de conservation n'est pas arrêtée |
| 19 | Le catalogue de nœuds | `CRM-030` | **Livré et vérifié** — voir le chapitre 5 *quater*. Les états par lesquels une affaire passe ont désormais leur écran, « Réglages ▸ Catalogue de nœuds » : un administrateur y crée un nœud, en modifie le libellé, le type, la couleur et les valeurs par défaut, l'archive et le rétablit. La **clé ne se modifie pas** — les statistiques s'appuient sur elle —, et un nœud sur lequel des affaires se trouvent encore **ne s'archive pas** : le produit dit combien il en porte. Deux flèches par ligne **réordonnent** le catalogue, d'un cran à la fois |
| 20 | Construire un workflow et ses transitions | `CRM-031` | **Partiellement livré, sans écran.** Le workflow existe côté serveur — l'espace de travail est livré avec le sien, « Cycle commercial standard », ses étapes et les déplacements qu'il autorise (annexe A), et chacun de ses channels suit un workflow. L'**éditeur** est livré : un administrateur **crée** un workflow depuis « Réglages ▸ Workflows » — nom, portée globale ou propre à un track —, puis en compose les étapes et les transitions (chapitres 5 bis.0 à 5 bis.3). Le workflow naît vide et reste un brouillon tant qu'il n'a pas d'étape initiale. Ce qui reste hors interface est la **copie** vers un track et la désignation du workflow **par défaut** |
| 20 bis | Garder une photographie d'un workflow, la comparer et y revenir | `CRM-078` | **Livré.** Un workflow change : ses étapes, ses déplacements, ses questions et leurs règles sont modifiables à tout moment, et rien ne disait jusqu'ici sous quelle forme une affaire avait circulé. Un administrateur peut désormais **publier une version** : le produit fige une photographie datée, numérotée et signée de la composition entière du workflow, que plus personne ne peut réécrire — pas même le produit lui-même. Publier une version **ne change rien** au fonctionnement : les affaires continuent de circuler sur le workflow vivant, une version est un témoin et non une cible. Republier sans avoir rien modifié est refusé, pour que deux versions ne soient jamais indiscernables. Le produit sait aussi **comparer deux versions** — quelles étapes, quels déplacements, quelles questions et quelles règles ont été ajoutés, retirés ou modifiés, et pour chaque modification ce qui a changé et de quoi vers quoi. Et, avant de revenir à une version, il sait dire **affaire par affaire où elle atterrit** : celles dont l'étape existe toujours ne bougent pas, et celles dont l'étape a été créée depuis restent **sans destination** tant qu'un administrateur n'a pas dit où les envoyer. Le produit ne devine jamais à sa place, même lorsqu'une étape disparue est sur le point d'être rétablie : il la nomme, il ne la choisit pas. Les affaires archivées et celles en corbeille sont comptées comme les autres. Le produit sait désormais **appliquer** ce plan en une seule transaction, et **revenir en arrière** : la composition d'avant est publiée comme point de retour avant toute écriture. Et les quatre gestes ont leur **écran**, au bas de l'éditeur de workflows : voir le chapitre 5 bis.6 |
| 21 | Copier un workflow dans un track et le modifier | `CRM-032`, `CRM-018` | **Partiellement livré, sans écran.** La copie existe côté serveur : un administrateur duplique un workflow global vers un track, avec ses étapes, transitions, champs, règles et exigences remappés, et la copie se souvient de son origine. L'espace de travail est livré avec un exemple, « Cycle commercial — Conseil IA » sur le track « Conseil & IA ». Une empreinte de composition permet au produit de signaler toute divergence, suppression comprise. Ce qui manque est l'écran : aucun bouton ne permet encore de copier, et la mention de divergence n'est affichée nulle part |
| 22 | Choisir le workflow d'un channel | `CRM-033`, `CRM-019` | **Livré côté serveur, sans écran.** Un channel suit désormais **obligatoirement** un workflow, et pas n'importe lequel : le workflow général de l'espace de travail, ou celui de son propre track. Toute affectation directe incohérente est refusée. Même lorsque le channel contient des affaires, une administratrice peut changer son workflow par l'API en donnant le mapping exhaustif de toutes les étapes occupées ; aucune affaire n'est laissée à moitié remappée et toute perte de réponse doit être acceptée explicitement. L'espace de travail livré le montre : tous ses channels suivent « Cycle commercial standard », sauf « Prospection » qui suit la copie réservée à son track (annexe A). Ce qui manque est l'écran : aucun sélecteur ne permet encore ce geste |
| 23 | Composer le formulaire d'un workflow | `CRM-035`, `CRM-018`, `CRM-076` | **Partiellement livré dans l'écran** — voir le chapitre 5 bis.4. Un workflow porte son propre formulaire : budget estimé, origine du contact, date de signature prévue, motif de la perte, décideur identifié et lien vers la proposition, ainsi qu'un champ retiré dont les réponses restent consultables (volumes en annexe A). Un champ non déclaré à une étape y reste simplement visible : on ne déclare que les exceptions. Lorsqu'un workflow est copié vers un track, son formulaire, ses règles et ses exigences sont remappés avec lui ; il est utilisable immédiatement sans partager les identifiants de la source. L'obligation est appliquée : voir le chapitre 24. Depuis `CRM-076`, un administrateur **déclare, modifie, réordonne, archive et restaure** les questions depuis « Réglages ▸ Workflows ». Ce qui manque est la **grille champ × étape** : régler la visibilité d'une question sur une étape reste un geste d'API |
| 24 | Répondre aux questions d'une affaire | `CRM-036`, `CRM-037` | **Partiellement livré dans l'écran.** Une affaire porte ses réponses, et le produit les **vérifie** : une réponse doit correspondre au type de la question — un montant est un nombre, une case est cochée ou non, une date est une date, et une liste de choix n'accepte que les choix déclarés. Les réponses et les exigences sont consultables sur la fiche, et **s'y enregistrent** : chaque question s'écrit pour elle-même, dit ce qu'elle a fait, et montre son refus sous elle |
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

## 1 bis. Le guide de démarrage : par où commencer

*Livré par `CRM-079`. Décrit l'application réellement exécutée ; captures dans
`docs/captures/CRM-079/`.*

À la première connexion, l'accueil ne montre aucun board — il n'y en a pas encore. Il montre à la
place le **Guide de démarrage**, une liste de **cinq étapes** qui mènent chacune vers l'écran qui
la réalise.

Les cinq étapes, dans l'ordre :

| Étape | Ce qu'elle établit | Où elle se fait |
|---|---|---|
| Rejoindre un espace de travail | Votre compte appartient à un espace | Aucun écran : elle est accomplie par votre connexion |
| Créer un premier track | Un dossier de premier niveau existe | Réglages ▸ Arborescence |
| Ouvrir un channel dans ce track | Un onglet de travail existe sous ce track | Réglages ▸ Arborescence |
| Créer une première affaire | Un board a quelque chose à montrer | Réglages ▸ Arborescence, puis le channel choisi |
| Raccorder une boîte de réception | Le courrier entrant se classe dans les affaires | Réglages ▸ État de la messagerie |

### 1 bis.1 L'état d'une étape est mesuré, jamais mémorisé

Une étape n'est pas « cochée » : à **chaque affichage**, le produit compte ce que votre compte voit
réellement, et en déduit l'état. Trois conséquences directes, et elles sont voulues :

- supprimer votre dernier track **décoche** l'étape correspondante ; rien ne prétend qu'elle est
  faite parce qu'elle l'a été un jour ;
- une étape marquée **Fait** garde son lien : accompli ne veut pas dire terminé, et rien n'empêche
  d'ajouter un second track ;
- rien n'est enregistré sur votre appareil, et aucune progression n'est stockée sur le serveur.

Chaque état est écrit **en toutes lettres** — *Fait*, *À faire* — à côté de son icône, et la
progression est une phrase, « 3 étape(s) sur 5 », jamais une barre seule.

### 1 bis.2 Ce que le guide dit exactement, et ce qu'il ne dit pas

Une étape non accomplie écrit « **Vous n'en voyez aucun pour le moment** », et le mot est choisi :
le guide rapporte ce que **votre compte** voit, jamais ce qui existe dans l'espace. Deux personnes
n'ont donc pas nécessairement le même guide — un compte en lecture seule peut ne voir aucune boîte
de réception là où l'espace en porte trois, et sa cinquième étape restera « à faire ». Ce n'est pas
un défaut d'affichage : ce sont ses droits, et le guide ne prétend jamais les contourner.

Aucun lien n'est jamais éteint, quel que soit votre rôle. Les écrans vers lesquels le guide renvoie
portent eux-mêmes leurs refus, et c'est là que vous les rencontrerez, expliqués.

Lorsqu'une étape **n'a pas pu être mesurée** — une coupure réseau, une session expirée —, sa ligne
le dit (« Cette étape n'a pas pu être vérifiée ») et propose de **réessayer**, ce qui relance
réellement les cinq mesures. Les quatre autres étapes restent lisibles : une mesure manquante n'en
efface aucune.

### 1 bis.3 Le masquer, et le retrouver

Le bouton **Masquer le guide** le retire de l'accueil **pour cette session** et rend la place au
board. Un lien discret, *Rouvrir le guide de démarrage*, reste sur l'accueil.

Le guide vit aussi à son adresse propre, `/demarrage`, et **Réglages ▸ Guide de démarrage** le
place en tête de l'index. Là, il est toujours rendu : même masqué, même intégralement accompli.
C'est ce qui le rend relançable.

Le masquage survit au **rechargement** de l'onglet, et disparaît quand l'onglet se ferme. C'est
délibéré : cette préférence d'affichage ne justifie aucun stockage durable sur votre appareil, et
le produit n'en écrit aucun.

**Ce qui reste hors du guide.** Il **lit et renvoie** ; il ne crée ni track, ni channel, ni
affaire, et il n'existe aucune création assistée « en trois clics » qui doublerait les écrans
réels. Aucune étape ne mesure votre workflow : un channel naît avec le workflow par défaut, et
l'éditeur reste accessible depuis les réglages (chapitre 5 *bis*).

## 3. Naviguer : barre latérale, onglets, états

*Livré par `CRM-007`. Décrit l'application réellement exécutée ; captures dans
`docs/captures/CRM-007/`.*

### 3.1 La disposition de l'écran

L'écran se lit en trois zones :

- à gauche, la **barre latérale** : le nom du produit, les cinq entrées de navigation — Board,
  Inbox, **Contacts**, Ma journée, Réglages — puis la section **Tracks** ;
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
et la vue liste ; la discussion et l'historique vivent dans la fiche. Le **carnet de contacts** a
le sien (section 3 *ter*), en lecture. L'arborescence a son écran
d'administration (chapitre 5), et la **composition d'un workflow** — ses étapes, ses transitions et
les **questions de son formulaire** — le sien (chapitre 5 bis). En revanche, le catalogue de nœuds,
la **visibilité question par étape** et les droits d'accès n'ont toujours aucun écran
d'administration. La connexion rend
accessibles les surfaces déjà livrées ; elle ne fabrique pas les éditeurs encore absents.

### 3 ter. Le carnet de contacts

*Livré par `CRM-060`, sous-tranches 4a, 4b, 4e et 4f. Décrit l'application réellement exécutée ;
captures dans `docs/captures/CRM-060/`.*

L'entrée **Contacts** de la barre latérale ouvre le **carnet** de votre espace de travail : les
personnes avec qui vos affaires se traitent, et l'organisation à laquelle chacune appartient.

Le carnet se présente en tableau, une ligne par contact, rangé par nom :

| Colonne | Ce qu'elle porte |
|---|---|
| Nom | Le nom complet de la personne. Il est toujours renseigné. **C'est un lien** : il ouvre la fiche de ce contact |
| Organisation | L'organisation à laquelle la personne appartient, lorsqu'elle en a une. **C'est un lien** : il ouvre la fiche de cette organisation |
| Fonction | Sa fonction, par exemple « Directeur achats » |
| Email | Son adresse, lorsqu'elle est connue |
| Téléphone | Son numéro, lorsqu'il est connu |

**Une cellule vide veut dire « pas renseigné », et rien d'autre.** Le carnet n'écrit ni tiret ni
« non renseigné » : un contact peut n'être qu'un nom et un téléphone, et c'est un cas ordinaire, pas
une donnée manquante à corriger. Dans l'espace de démonstration, Sophie Dupont n'a pas
d'organisation et Élise Fabre n'a pas d'email.

**Qui voit quoi.** Tout membre de l'espace de travail lit le carnet, y compris un compte en lecture
seule. Sans session, la page s'affiche vide : le serveur ne consent aucune ligne à un visiteur
anonyme, et c'est la règle générale du produit — un refus se manifeste par l'absence de donnée,
jamais par un message d'erreur technique.

**Ce que le carnet ne fait pas encore, et c'est dit plutôt que laissé à deviner.** Il ne permet ni
de créer, ni de modifier, ni de supprimer un contact : ces gestes existent dans la base, mais aucun
écran ne les porte à ce jour. Cliquer sur un email n'ouvre pas votre logiciel de messagerie. Il n'y
a pas non plus de recherche ni de filtre : le carnet affiche l'ensemble des contacts de l'espace.

Le rattachement d'un contact à une affaire existe déjà **en base** — c'est lui qui alimente la
suggestion de classement d'un message dont l'expéditeur est un contact connu —, mais il ne se
règle pas encore depuis un écran.

#### La fiche d'une organisation

Cliquer sur le nom d'une organisation, dans la colonne **Organisation** du carnet, ouvre sa
**fiche**. C'est le seul chemin qui y mène : il n'existe pas de liste des organisations.

La fiche porte le **nom de l'organisation en titre**, puis deux blocs :

- **ce qui la caractérise** — son **domaine** (par exemple `sogexia.example`, celui qui sert à
  reconnaître ses adresses email) et son **site web**. Le site est un lien : il s'ouvre dans un
  **nouvel onglet**, et vous quittez alors l'application. Le domaine, lui, n'est pas un lien : ce
  n'est pas une adresse à visiter. Comme dans le carnet, une valeur absente laisse la place **vide**
  plutôt qu'un tiret ;
- **ses contacts** — un tableau à quatre colonnes : nom, fonction, email et téléphone. La colonne
  « Organisation » du carnet n'y figure pas, puisqu'elle répéterait le titre de la page. Lorsque
  l'organisation n'a **aucun contact rattaché**, la fiche le dit explicitement au lieu d'afficher un
  tableau vide.

**Une adresse inconnue, une organisation supprimée ou une organisation que vous n'avez pas le droit
de lire donnent toutes le même écran** : « Organisation introuvable », avec un bouton de retour au
carnet. C'est délibéré — distinguer ces cas révélerait à quelqu'un sans droit qu'une organisation
existe.

**Ce que la fiche ne fait pas encore.** Elle ne permet ni de créer, ni de modifier, ni de supprimer
une organisation, et elle ne montre pas les affaires de l'organisation. Le nom d'un contact, lui,
**est désormais un lien** vers sa fiche.

#### La fiche d'un contact

Cliquer sur le nom d'une personne — dans le carnet, ou dans la liste des contacts d'une
organisation — ouvre sa **fiche**. Elle porte son **nom en titre**, puis deux blocs :

- **ce qui la caractérise** — sa **fonction**, son **organisation**, son **email** et son
  **téléphone**. L'organisation est un lien vers sa propre fiche ; comme partout dans le carnet, une
  valeur absente laisse la place **vide** plutôt qu'un tiret ;
- **ses affaires** — un tableau à trois colonnes : l'affaire, le **rôle** que la personne y tient
  (par exemple « decideur »), et son **état**. Le titre de chaque affaire est un lien qui l'ouvre.

C'est la seule page qui répond à la question « sur quoi travaillons-nous avec cette personne ? ».
Le rattachement lui-même, en revanche, se règle toujours depuis l'affaire (chapitre 4.7 ter).

**Le rôle dans l'affaire n'est pas la fonction.** La fonction qualifie la personne dans son
organisation ; le rôle dit ce qu'elle est **dans cette affaire-là**. Les deux portent le même mot
dans la langue courante, c'est pourquoi ils vivent dans deux blocs séparés.

**Quelles affaires sont listées.** Uniquement celles que **vous** avez le droit de lire : si une
affaire appartient à un univers qui vous est fermé, elle n'apparaît pas, et la page ne le signale
pas — elle ne peut pas vous parler de ce que vous ne pouvez pas voir. Une affaire **archivée** reste
listée, avec la mention **« Archivée »**, parce que l'historique d'une personne compte. Une affaire
**mise à la corbeille** n'est pas listée : c'est la corbeille qui en répond.

**Une adresse inconnue, un contact supprimé ou un contact que vous n'avez pas le droit de lire
donnent tous le même écran** : « Contact introuvable », avec un bouton de retour au carnet — même
règle que pour l'organisation, et pour la même raison.

**Ce que la fiche ne fait pas encore.** Elle ne permet ni de modifier, ni de supprimer un contact,
ni de le rattacher à une affaire depuis cette page. Elle ne montre pas non plus les emails échangés
avec la personne : la messagerie d'une affaire reste dans l'affaire.

#### Créer un contact

Le bouton **« Nouveau contact »**, au-dessus du tableau, ouvre un formulaire **dans la page** — pas
une fenêtre par-dessus : la liste reste visible, et c'est elle qui vous dit si la personne y figure
déjà.

Cinq champs, et un seul est obligatoire :

- **Nom** — obligatoire. Un nom vide est refusé avant même l'envoi.
- **Organisation** — au choix parmi celles de l'espace de travail, ou aucune. Le formulaire ne crée
  pas d'organisation.
- **Fonction**, **Email**, **Téléphone** — facultatifs. Laissés vides, ils restent vides : le carnet
  n'écrit ni tiret ni « non renseigné ».

Le contact créé **rejoint aussitôt le tableau**, à sa place dans l'ordre alphabétique, sans que la
page ne se recharge.

**Si la création est refusée**, le message le dit en clair et **votre saisie est conservée** :

- *« Un contact porte déjà cette adresse email »* — l'adresse est unique dans l'espace de travail,
  quelle que soit la casse ;
- *« Cette organisation n'existe plus »* — la liste que vous aviez sous les yeux a vieilli ;
  relisez-la et choisissez-en une autre ;
- *« Votre rôle ne permet pas de créer un contact »* — un compte en **lecture seule** voit le
  bouton et le formulaire, comme partout dans le produit, et c'est le serveur qui refuse. Rien
  n'est grisé d'avance.

**Ce que ce formulaire ne fait pas**, et c'est dit plutôt que caché : il ne **modifie** ni ne
**supprime** un contact existant, il ne crée pas d'organisation, et il n'existe que sur le carnet —
ni depuis la fiche d'une affaire, ni depuis un champ de formulaire.

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
perdu » du workflow livré exigent un motif. Un motif fait uniquement de **blancs** — espaces,
tabulations, sauts de ligne, espaces insécables — est refusé comme l'absence de motif, et un motif
de plus de 10 000 caractères l'est aussi : le motif est conservé comme un commentaire, et il en a
les limites.

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
2. **Le motif que vous donnez est conservé, et il l'est comme un commentaire.** Depuis le
   2026-08-14, la raison que vous écrivez au moment du déplacement apparaît dans le fil de
   l'affaire, signée de votre nom et datée, exactement comme si vous l'aviez publiée vous-même
   (chapitre 4.10). Vous pouvez donc la corriger ou la retirer ensuite, comme n'importe lequel de
   vos commentaires.

   Trois précisions utiles. Le motif est enregistré **en même temps** que le déplacement : si l'un
   échoue, l'autre n'a pas lieu, et vous ne verrez jamais une affaire déplacée sans sa raison. Un
   motif est conservé **même lorsque le déplacement ne l'exigeait pas** — commenter un passage
   d'étape volontairement est donc utile. Enfin, un motif est un commentaire : il fait au plus
   **10 000 caractères**, et un motif fait uniquement d'espaces, de tabulations ou de tout autre
   blanc est refusé comme s'il était absent.

   Le motif n'apparaît pas dans la ligne d'historique *Étape franchie* : il vit **une seule fois**,
   dans la discussion, et non recopié dans la trace.

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

### 4.7 La fiche d'une affaire : son en-tête, son formulaire, et ce qu'ils montrent

*Livrée par `CRM-037`, son en-tête par `CRM-040`. Captures dans `docs/captures/CRM-037/` et
`docs/captures/CRM-040/`.*

Une affaire s'ouvre à l'adresse `/tracks/<track>/<onglet>/cards/<identifiant de l'affaire>`. Cet
écran affiche à gauche **l'en-tête de l'affaire** puis le **formulaire de l'étape où elle se
trouve**, et à droite son **historique et sa discussion** (chapitre 4.10).

**L'en-tête, en haut de la colonne de gauche**, dit ce que l'affaire *est* :

- son **titre** ;
- son **responsable**, avec son avatar. Lorsqu'aucune personne n'en est responsable, l'écran l'écrit
  — « Aucun responsable » — plutôt que de laisser un blanc ;
- son **montant** et sa devise, lorsqu'un montant est renseigné. Sinon la ligne n'apparaît pas : une
  affaire qui débute n'est pas encore chiffrée, et un tiret se lirait comme une valeur ;
- sa **prochaine action** et son échéance, aux mêmes conditions ;
- son **adresse email** (chapitre 4.2), avec le bouton **« Copier l'adresse »** et la phrase qui en
  dit l'usage. Le bouton confirme la copie par « Copié » pendant deux secondes ; si votre navigateur
  la refuse — cela arrive hors connexion sécurisée —, l'écran vous dit de sélectionner l'adresse à
  la main plutôt que de faire comme si la copie avait eu lieu ;
- la mention **« Archivé »** lorsque l'affaire est archivée (chapitre 4.4). Sa fiche reste
  consultable, et cette mention est ce qui la distingue d'une affaire en cours.

**Ces six champs se modifient depuis la fiche.** Le bouton **« Modifier »**, à droite du titre,
bascule l'en-tête en saisie : les six champs y apparaissent **tous**, y compris ceux qui n'étaient
pas affichés faute de valeur — c'est ainsi que l'on renseigne le montant d'une affaire qui n'en
avait pas.

Quelques points à connaître :

- **il n'y a aucun bouton d'enregistrement.** Chaque champ enregistre sa propre valeur dès que vous
  le quittez ; le responsable, lui, s'enregistre dès que vous le choisissez dans la liste. Une
  mention sous le champ vous dit « Enregistrement… » puis « Enregistré » ;
- **« Terminer » referme la saisie et n'envoie rien** — tout a déjà été enregistré ;
- **le titre ne peut pas être vide**, et la devise doit s'écrire en trois lettres (« EUR », « CHF »).
  Si vous saisissez autre chose, l'écran vous dit que la valeur ne convient pas et **conserve votre
  saisie** : rien n'est effacé à votre place ;
- **si votre compte n'a pas le droit de modifier cette affaire**, le bouton reste proposé — c'est
  volontaire —, mais l'écran vous répond « Rien n'a été enregistré : votre compte ne peut pas
  modifier cette affaire ». Vous savez ainsi que la tentative a bien eu lieu, et qu'elle a été
  refusée ;
- **changer le responsable apparaît dans l'historique** de l'affaire (chapitre 4.10), sous la forme
  « Responsable modifié ». Les autres champs ne laissent pas de trace dans ce fil.

Le formulaire de l'étape, lui, s'enregistre de la même façon, question par question.

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

**Vous pouvez répondre aux questions depuis cette fiche.** Chaque question s'enregistre **pour
elle-même**, et il n'y a aucun bouton « Enregistrer » : votre réponse part dès qu'elle est arrêtée —
quand vous quittez un champ de saisie, ou dès que vous cochez une case ou choisissez dans une liste.

- **Ce que l'écran vous dit.** « Enregistrement… » pendant l'envoi, puis **« Enregistré »** sous la
  question concernée. Si la réponse est refusée, un message rouge apparaît **sous cette question**,
  et il explique le refus : soit la valeur ne convient pas au type de la question, soit vous n'avez
  pas le droit d'écrire sur cet onglet.
- **Un refus n'efface jamais ce que vous avez saisi.** Votre texte reste à l'écran avec son
  explication ; c'est la réponse **enregistrée** qui n'a pas changé.
- **Répondre à une question obligatoire fait disparaître son alerte** immédiatement, sans recharger
  la page. La vider la fait réapparaître : une réponse effacée redevient une réponse manquante.
- **Effacer une réponse est une modification, pas une suppression.** Videz le champ, ou choisissez
  « — Aucun choix — » dans une liste : la question redevient sans réponse.
- **La section repliée reste en lecture seule.** Elle rassemble des réponses que l'étape courante ne
  demande pas ; les modifier depuis là n'aurait pas de sens.
- **Rien n'est enregistré tant que le serveur ne l'a pas accepté**, et le droit d'écrire est vérifié
  par le serveur, jamais seulement par l'écran. Une personne en lecture seule voit les questions et
  reçoit un refus explicite si elle tente d'y répondre.

**Deux questions se répondent dans une LISTE DE NOMS, et non en tapant un identifiant.**

Une question dont le type est « contact » ou « membre de l'espace » n'est plus un champ où l'on
saisit un texte : elle offre la **liste** des personnes concernées, et vous y choisissez un nom.

- **La liste des contacts** est celle du carnet (chapitre 3 *ter*), avec l'organisation à côté du
  nom lorsqu'elle est connue — « Léo Marchand — Sogexia ». C'est ce qui distingue deux homonymes.
- **La liste des membres** est celle de l'espace de travail : les personnes qui y ont un accès.
- **« — Aucun choix — » efface la réponse**, comme pour toute autre liste.
- **Si la personne choisie a été supprimée depuis**, la question garde ce qui a été enregistré et
  l'affiche comme **« Référence inconnue »**, suivie de l'identifiant. Le produit ne remplace jamais
  en silence une réponse enregistrée par une autre : à vous de choisir un nom valide si vous le
  souhaitez.
- **Si la liste ne peut pas être lue**, la question le dit et offre **« Réessayer »**. Tant qu'elle
  n'est pas lue, il n'y a rien à choisir, et la liste reste inactive.
- **Si l'espace n'a aucun contact**, la question le dit en toutes lettres. Aucun écran ne crée de
  contact aujourd'hui.
- **Dans la section repliée**, ces réponses se lisent aussi en toutes lettres. Lorsque le nom ne
  peut pas être retrouvé, c'est l'identifiant brut qui s'affiche, dans la police des données
  techniques — jamais un nom inventé.

Le refus, lui, ne change pas : une personne en lecture seule voit les deux listes, peut y choisir,
et reçoit le même message rouge que pour toute autre question.

**Quand un déplacement vous a été refusé, la fiche vous emmène aux questions qui manquent.**

Sur le board, déplacer une affaire peut être refusé parce que des réponses obligatoires manquent
(chapitre 4.8). Le message de refus les nomme, et il porte désormais un lien **« Renseigner ces
champs »**. Il ouvre la fiche de l'affaire, et cette fiche :

- **affiche les questions concernées, même celles que l'étape courante ne montre pas d'habitude.**
  C'est le point important : une question comme « Motif de la perte » est normalement masquée tant
  que l'affaire n'est pas perdue, et elle n'apparaissait donc nulle part au moment où on vous la
  demandait. Elle est maintenant affichée et **saisissable**, parce que le déplacement l'exige ;
- **les met en évidence** par un liseré bleu et la mention **« Exigé par le déplacement que vous
  avez demandé »**, écrite en toutes lettres à côté de la question ;
- **vous amène directement à la première**, qui reçoit le curseur : vous pouvez saisir sans chercher
  ni faire défiler, y compris au clavier.

Une question déjà obligatoire à l'étape courante garde sa mention « Requis pour passer à … » **en
plus** : les deux phrases disent des choses différentes, et les deux sont vraies.

*Ce que ce lien ne fait pas :* il **ne rejoue pas** le déplacement. Une fois les réponses saisies,
revenez au board et refaites votre geste. Et la mention ne nomme pas l'étape vers laquelle vous
vouliez aller : la fiche ne la connaît pas, et le produit préfère ne rien dire plutôt que de
deviner.

**Un second geste y est offert : mettre l'affaire à la corbeille** (chapitre 4.7 *bis*).

Sans connexion, cette adresse affiche « Card introuvable » : c'est le refus réel du serveur. Après
connexion, une card consentie ouvre sa fiche et son fil.

### 4.7 ter Les contacts d'une affaire : les rattacher, les détacher

*Livré par `CRM-060`, sous-tranche 4c. Captures dans `docs/captures/CRM-060/`, préfixées
`contacts-affaire-`.*

**Où.** Dans la colonne de gauche de la fiche, **entre le formulaire et le bouton de mise à la
corbeille** : le bloc **« Contacts de l'affaire »**. Il dit qui, dans le carnet de l'espace
(chapitre 3 *ter*), est associé à cette affaire.

**Ce que chaque ligne montre.** Le **nom** de la personne, le nom de son **organisation** — qui est
un lien vers sa fiche — et son **rôle dans cette affaire** : « décideur », « prescripteur »,
« technique », ou tout autre mot que vous avez saisi. Le rôle est **libre** : le produit n'en impose
aucune liste. Lorsqu'aucun rôle n'a été saisi, la place reste vide plutôt que de porter un tiret.
Une personne sans organisation n'affiche aucun lien.

**Rattacher.** Le bouton **« Rattacher un contact »** ouvre, sous la liste, un formulaire à deux
champs : la personne à rattacher, choisie dans une liste, et le rôle, **facultatif**. La liste
n'offre que les personnes **pas encore rattachées** à cette affaire — proposer les autres reviendrait
à proposer un geste que le produit refuserait. Une fois validé, le rattachement apparaît dans la
liste, qui est relue depuis le serveur.

Deux cas sont dits en toutes lettres plutôt que laissés à deviner :

- **toutes les personnes du carnet sont déjà rattachées** : le bloc l'écrit, et n'ouvre pas une
  liste vide ;
- **le carnet de l'espace est vide** : le bloc l'écrit également. Aucun écran ne permet encore de
  créer un contact — c'est une limite connue, pas un défaut d'affichage.

**Détacher.** Chaque ligne porte un bouton **« Détacher »**. Il demande une **confirmation qui nomme
la personne** : le rattachement et le rôle saisi sont perdus, la personne restant au carnet et
pouvant être rattachée de nouveau. Tant que vous n'avez pas confirmé, **rien n'est écrit**.

**Si vous n'avez pas le droit d'écrire sur cette affaire.** Les deux boutons restent visibles et
actifs : le produit ne devine pas vos droits, il vous répond. Un rattachement refusé affiche
**« Vous ne pouvez pas modifier cette affaire. »** sous le formulaire, **sans effacer votre saisie**.
Un détachement refusé, lui, affiche **« Aucun rattachement n'a été retiré. »** : c'est la réponse
exacte du serveur, qui ne distingue pas un refus d'une ligne déjà retirée par quelqu'un d'autre — et
le produit préfère le dire ainsi plutôt qu'annoncer un retrait qui n'a pas eu lieu.

**Ce qui n'est pas encore livré.** Le rôle d'un rattachement ne se **modifie** pas : détachez puis
rattachez. Une affaire ne se rattache pas depuis le carnet ni depuis la fiche d'organisation — le
geste part toujours de l'affaire. Et un rattachement n'apparaît **pas** dans l'historique de
l'affaire (chapitre 4.10).

### 4.7 bis Mettre une affaire à la corbeille

*Livré par `CRM-077`. Captures dans `docs/captures/CRM-077/`, préfixées `card-geste-`.*

**Où.** En bas de la colonne de gauche de la fiche, sous le formulaire : le bouton **« Mettre à la
corbeille »**. C'est le seul endroit d'où une affaire se retire — ni le tableau kanban ni la vue
liste ne l'offrent, et ce n'est pas un oubli : le menu d'une carte du tableau porte les gestes qui
se défont d'eux-mêmes — un déplacement, une mise en sommeil —, et un retrait y serait d'une autre
nature.

**Ce que le produit demande avant d'agir.** Une confirmation, sous le formulaire, qui **nomme
l'affaire** et rappelle ce que le geste fait : elle quitte le tableau, la vue liste et la recherche,
sans être supprimée, et se restaure depuis la corbeille. Tant que vous n'avez pas confirmé, **rien
n'est écrit**. « Annuler » referme la confirmation et vous rend le bouton — au clavier aussi.

Contrairement au retrait d'un track ou d'un channel (chapitre 5), **aucun décompte n'accompagne la
question** : une affaire ne porte pas d'objet qui deviendrait inaccessible avec elle.

**Ce que vous voyez ensuite.** L'écran est remplacé par un message qui dit que l'affaire est à la
corbeille, avec deux chemins : **revenir au channel**, ou **ouvrir la corbeille** pour l'y retrouver
et la restaurer (chapitre 5 ter). Il ne dit pas « Card introuvable » : l'affaire existe, vous venez
de la retirer.

**Trois réponses sont possibles, et l'écran les distingue** :

| Ce que vous voyez | Ce qui s'est passé |
|---|---|
| Le message « Affaire mise à la corbeille » | Le retrait est enregistré, et votre nom avec lui |
| « Aucune modification : votre compte ne peut pas écrire dans cette affaire. » | Votre compte lit l'affaire mais n'a pas le droit d'y écrire. **Rien n'a changé** |
| « Votre compte n'a pas le droit de retirer cette affaire. » | Le serveur a refusé explicitement |

**Le bouton reste offert même si votre compte ne peut pas aboutir**, et c'est voulu : la règle est
celle du serveur, qui peut changer entre le moment où vous ouvrez la fiche et celui où vous cliquez.
Un bouton éteint par l'écran ferait passer une règle du serveur pour une décision d'affichage.

**Qui peut le faire.** Toute personne ayant le droit d'**écrire** sur l'onglet de l'affaire — ce
n'est pas réservé à une administratrice, contrairement au retrait d'un track ou d'un channel. Une
personne en lecture seule obtient la deuxième réponse du tableau ci-dessus.

**Le retrait est inscrit dans l'historique de l'affaire** (chapitre 4.10), sous « Cycle de vie »,
avec son auteur et sa date. Vous le relisez après restauration.

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
en cours (chapitre 4.4). Les affaires **en sommeil** n'y figurent pas non plus, jusqu'à leur
échéance : une case à cocher **« Afficher les affaires en sommeil »**, au-dessus des colonnes, les
ramène — marquées de leur date de réveil (chapitre 4.9 bis). Le nombre d'affaires d'une colonne et
son cumul de montants portent sur les cartes **affichées** : ils changent donc avec cette case.

Si toutes les affaires d'un channel dorment, le tableau ne prétend pas qu'il est vide : il annonce
« Toutes les affaires de ce channel sont en sommeil » et propose le geste qui les révèle.

**Faire avancer une affaire : deux gestes, une seule règle.**

- **À la souris**, en faisant glisser la carte vers une colonne. Seules les colonnes vers lesquelles
  un déplacement est **déclaré** dans le workflow acceptent le dépôt ; les autres le refusent
  visuellement, et aucune demande n'est envoyée au serveur.
- **Au clavier**, par le bouton « Actions » de la carte, qui ouvre son menu. La partie
  **Déplacer vers** y liste les déplacements déclarés depuis l'étape courante — et **eux seuls**.
  Lorsqu'une étape n'en propose aucun, le menu s'ouvre quand même et le dit en toutes lettres : il
  porte aussi le geste de sommeil (chapitre 4.9 bis), qui, lui, reste disponible.

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

**Filtrer.** Trois filtres, au-dessus du tableau :

- **Étape** — n'afficher que les affaires d'une étape donnée. Toutes les étapes du workflow sont
  proposées, y compris celles qu'aucune affaire n'occupe ;
- **Rechercher une affaire** — un ou plusieurs mots, cherchés dans le **titre et la description**.
  La recherche part lorsque vous validez, par le bouton ou par `Entrée`, et non à chaque frappe.
  Elle est faite pour le français : une affaire rédigée en anglais peut lui échapper ;
- **Afficher les affaires en sommeil** — une case à cocher, **décochée par défaut**. Les affaires
  mises en sommeil sont rangées hors de la liste jusqu'à leur échéance ; cette case les ramène.
  Voir le chapitre 4.9 bis.

Le compte affiché à droite — « Affaires : 3 » — est celui des affaires **qui correspondent aux
filtres**, pas celui du channel entier.

**Paginer.** La liste affiche **25 affaires par page**. Les boutons *Page précédente* et *Page
suivante* encadrent le rang courant, écrit en toutes lettres (« Page 2 sur 5 ») ; ils restent
visibles aux extrémités, simplement inutilisables, plutôt que de disparaître.

**Tout est dans l'adresse.** Le tri, les filtres et le rang de page s'inscrivent dans l'adresse de
la page. Recharger la page vous ramène exactement où vous étiez, et l'adresse se partage telle
quelle. Une adresse abîmée à la main — un tri qui n'existe pas, un rang de page trop grand —
retombe sur les valeurs par défaut sans afficher d'erreur.

**Quand la liste ne montre rien.** Trois messages distincts, parce qu'ils n'appellent pas la même
réponse : « Aucune affaire dans ce channel » ; « Aucune affaire ne correspond », qui propose
d'effacer les filtres ; et « Aucune affaire éveillée dans ce channel », qui propose d'**afficher les
affaires en sommeil** — car les affaires endormies étant masquées par défaut, une liste vide n'est
plus la preuve d'un channel vide. Un quatrième existe : si le nombre d'affaires a diminué pendant
que la page était ouverte, une page devenue inexistante affiche « Cette page n'existe plus » et
propose de revenir à la première — jamais un message d'erreur technique.

**« Effacer les filtres » efface les trois.** L'étape, la recherche **et** l'affichage des affaires
en sommeil reprennent leur valeur par défaut : le bouton rend la vue par défaut, et la vue par
défaut ne montre pas les affaires endormies. Il apparaît donc aussi sur une liste dont la seule
différence est que ces affaires y sont visibles.

**Ce que la liste ne fait pas.** Elle **lit**. On n'y crée, n'y modifie, n'y archive et n'y déplace
aucune affaire : le déplacement reste le geste du tableau (chapitre 4.8), et le reste n'a pas encore
d'écran. Le **responsable** n'y figure pas non plus, pour le même motif qu'au tableau : aucun nom
n'est aujourd'hui lisible, et le produit préfère ne rien afficher qu'un identifiant technique.

Sans connexion, cette adresse affiche « Track introuvable », comme pour le tableau. Après
connexion, la liste réelle est consultable, triable et filtrable.

### 4.9 bis Mettre une affaire en sommeil, et la retrouver

*Livrée par `CRM-081`. Captures dans `docs/captures/CRM-081/`.*

Certaines affaires n'attendent rien de vous avant plusieurs semaines : un client qui rappellera
après ses congés, une décision reportée au prochain comité. Les laisser dans le tableau et dans la
liste les fait relire chaque jour pour rien. Le **sommeil** les range jusqu'à une échéance que vous
choisissez, sans les archiver et sans rien leur retirer.

**Endormir une affaire, depuis sa fiche.** Le bouton **Mettre en sommeil** ouvre un petit panneau
qui propose quatre échéances usuelles — *Demain*, *Dans trois jours*, *La semaine prochaine*, *Le
mois prochain* — et une échéance libre, à saisir. L'affaire porte alors, à côté de son titre, la
mention **« En sommeil jusqu'au … »**.

**Ou depuis le tableau, sans quitter l'écran.** Le bouton **Actions** d'une carte ouvre son menu,
qui porte deux parties : les déplacements déclarés, puis **Sommeil**. Les quatre mêmes échéances y
sont proposées directement. La carte **quitte alors le tableau** — c'est tout l'intérêt du geste :
ranger une affaire sans changer d'écran — et le compteur de sa colonne suit.

L'**échéance libre**, elle, ne se saisit que depuis la fiche : une carte de tableau est trop étroite
pour un champ de date. Sur une affaire endormie que la case « Afficher les affaires en sommeil »
ramène, ce même menu porte **Réveiller** à la place des quatre échéances.

Si le serveur refuse — vous lisez cette affaire sans avoir le droit de l'écrire —, **le menu reste
ouvert** et la raison s'affiche dessous, mot pour mot celle de la fiche. Le geste n'est jamais
éteint d'avance : c'est le serveur qui décide, jamais l'écran.

Une échéance **déjà passée** est refusée, et le message le dit sous le champ sans effacer votre
saisie. Une affaire peut être **à la fois archivée et endormie** : les deux mentions coexistent, car
elles ne disent pas la même chose.

**La réveiller.** Sur une affaire endormie, le même emplacement porte **Réveiller**. Le geste est
immédiat, sans confirmation : il n'y a rien à perdre, l'affaire redevient simplement visible.
Réveiller une affaire qui ne dormait pas ne produit rien — ce n'est pas une erreur, c'est un état
déjà atteint.

**Ce que le sommeil change dans les deux vues.** Une affaire endormie **sort du tableau et de la
liste** aussi longtemps que son échéance est future. C'est tout l'intérêt du geste : sans cela,
l'endormir ne changerait rien pour vous.

Elle n'est pour autant jamais perdue. Une case à cocher **Afficher les affaires en sommeil** — au
dessus des colonnes du tableau, et dans les filtres de la liste — les ramène d'un clic. Rendues
visibles, elles sont **marquées** d'une petite pastille portant l'icône de lune et leur date de
réveil, pour que vous ne les confondiez pas avec les autres.

**Le choix suit la vue.** Ce réglage s'inscrit dans l'adresse de la page : recharger vous ramène au
même état, l'adresse se partage telle quelle, et passer du tableau à la liste — ou l'inverse — le
conserve. Vous n'avez donc à le demander qu'une fois.

**Une échéance passée n'est plus un sommeil.** Le produit n'a besoin d'aucun réveil automatique :
dès que l'échéance est dépassée, l'affaire redevient visible partout, sans pastille et sans que
personne ait à intervenir. Sa date reste inscrite dans son historique, mais elle ne la range plus.
Rien ne clignote pour autant à la seconde près : la mention disparaît au prochain affichage de
l'écran, et une échéance de sommeil se compte en jours.

**L'historique garde les deux gestes.** Le fil de l'affaire nomme **« Mise en sommeil »** et
**« Réveil »**, avec l'échéance concernée. Comme tout le fil, ces lignes ne s'effacent pas
(chapitre 4.10).

**Les compteurs suivent ce que vous voyez.** Le nombre d'affaires d'une colonne du tableau, le total
de montants qui l'accompagne et le compte « Affaires : n » de la liste portent sur les affaires
**affichées** : ils changent donc lorsque vous cochez la case. Une colonne annonce ce qu'elle
montre, sinon son compteur désignerait des cartes introuvables à l'œil.

**Ce que le sommeil n'est pas.** Ce n'est ni une archive, ni une suppression, ni une permission : une
affaire endormie se déplace, se modifie et se commente exactement comme une autre, et toute personne
qui pouvait la lire peut encore la retrouver. Le sommeil **range**, il ne protège pas.

**Ce qui n'est pas encore livré.** Seules les **affaires** peuvent dormir : pas encore les fils de
messagerie. Et la **vue liste** n'offre pas le geste — elle laisse la case d'affichage et le lien
vers la fiche.

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

**Corriger et supprimer vos commentaires.** Le serveur n'autorise la **correction** d'un commentaire
qu'à **son auteur**, et à personne d'autre — administrateur compris. C'est une règle de fond et non
une précaution : réécrire le propos d'un autre ne serait pas de la modération, ce serait lui faire
dire ce qu'il n'a pas dit. Les deux gestes de l'auteur sont offerts par l'écran.

**La suppression, elle, est aussi ouverte aux administrateurs du workspace depuis le 2026-08-14** —
afin qu'un propos déplacé puisse être retiré. Un administrateur peut **retirer** un commentaire, il
ne peut pas le **modifier**, et le retrait laisse une trace nominative : le serveur enregistre qui
a supprimé, et non seulement quand.

Placez le pointeur sur **votre** commentaire, ou atteignez-le avec la touche `Tab` : deux actions
apparaissent, *Modifier* et *Supprimer*. Elles ne s'affichent que sur vos propres commentaires,
parce qu'elles n'aboutiraient sur aucun autre.

**Si vous êtes administrateur du workspace**, le commentaire d'une autre personne vous offre une
action, et **une seule** : *Supprimer*. Vous n'y verrez jamais *Modifier* — réécrire le propos d'un
collègue n'est pas de la modération, et le serveur le refuse quel que soit votre rôle. La demande de
confirmation est différente de celle de vos propres commentaires : elle rappelle que le commentaire
appartient à quelqu'un d'autre, et que **le retrait sera enregistré sous votre nom**.

Un commentaire ainsi retiré affiche *Commentaire retiré par la modération*, là où celui que son
auteur a supprimé lui-même affiche *Commentaire supprimé*. La distinction se lit donc sans avoir à
demander à personne. **Le nom de la personne qui a retiré n'est pas affiché** : le produit dit qu'un
tiers est intervenu, pas qui. La trace nominative existe côté serveur.

Si vous n'êtes pas administrateur, le commentaire d'une autre personne ne vous offre aucune action :
ce n'est pas un bouton masqué par prudence, c'est un geste qui n'aboutirait pas.

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
- **Un retrait par la modération n'apparaît pas dans l'historique** : le fil montre la pierre
  tombale du commentaire, il n'ajoute aucune ligne d'événement pour le retrait.

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
- **La création d'une affaire, et la modification de ses champs d'en-tête** : la fiche **montre**
  désormais le titre, le responsable, le montant et la prochaine action (chapitre 4.7), mais aucun
  écran ne permet encore de les saisir ni de les corriger.
- **Le réordonnancement d'une affaire dans sa colonne** : le déplacement change d'étape, pas de rang.
- **Le rangement d'une affaire dans un autre dossier depuis l'écran** : la règle existe et le
  serveur l'applique (chapitre 4.11), mais aucun bouton ne le propose.
- **Les étiquettes sur une carte du tableau** : elles ne sont pas portées par le produit. Le
  responsable, lui, est lisible sur la fiche depuis le chapitre 4.7.
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

**Ce que ces chapitres ne couvrent pas encore.** L'envoi n'est pas livré, ni la relève
automatique — elle est déclenchée par l'exploitant. La suggestion par contact connu attend la
fiche contact.

### 4.15 L'inbox : lire et trier le courrier reçu

*Écran « Inbox » de la barre latérale.*

L'inbox montre **trois panneaux** : les dossiers à gauche, la liste des messages au milieu, le
message lui-même à droite. Sous 1024 px de large, les trois deviennent une **pile** : on descend
d'un panneau au suivant, et un bouton « Retour » remonte d'un cran.

**Les dossiers.** « Non classés » vient toujours en premier, même quand il est vide : c'est
l'entrée du travail de tri. Viennent ensuite les affaires qui portent du courrier, rangées sous
leur track et leur channel. **Une affaire sans courrier n'apparaît pas** : l'inbox est une vue du
courrier reçu, pas une seconde copie du board. Chaque ligne affiche le nombre de messages **que
vous pouvez voir**, ce qui explique que deux personnes n'y lisent pas les mêmes nombres.

**Qui voit quoi.** Un message déjà rangé dans une affaire se lit comme l'affaire : si vous pouvez
la lire, vous lisez son courrier. Un message **non classé**, lui, n'appartient encore à aucune
affaire : il est visible par le **propriétaire de la boîte** où il est arrivé, et par les
**administrateurs** de l'espace de travail. Si votre panneau « Non classés » affiche zéro, ce n'est
pas une panne : c'est qu'aucune boîte dont vous répondez n'a reçu de courrier en attente.

**Lire un message.** L'expéditeur, les destinataires et la date d'arrivée sont affichés en tête,
puis le corps du message. **Le corps est toujours affiché en texte**, jamais avec la mise en forme
de l'expéditeur : un courrier venu de l'extérieur ne doit pas pouvoir exécuter quoi que ce soit
dans votre navigateur, ni charger d'images qui signaleraient l'ouverture de votre message. Quand un
message n'a été envoyé qu'en HTML, le produit vous le dit et n'en affiche que le texte.

**Les pièces jointes.** Une pièce déclarée saine porte un bouton « Télécharger ». Une pièce en
cours d'analyse, écartée par l'antivirus ou non analysée n'en a **pas** : son état est écrit en
toutes lettres à côté de son nom. Un bouton grisé promettrait ce que le serveur refuserait.

**Ranger un message.** Un message non classé propose « Classer dans une affaire ». Choisissez
l'affaire dans la liste, puis validez : le message rejoint l'affaire, son historique en garde la
trace, et vous le retrouvez ensuite **des deux côtés** — dans l'affaire et sous son dossier dans
l'inbox. Ranger exige le droit d'**écrire** sur l'affaire choisie, et celui de **voir** le message.
Une affaire archivée ou en corbeille est refusée, avec son motif.

**Tout se fait au clavier.** La tabulation parcourt les dossiers, la liste puis le message ;
Entrée ouvre. Le dossier retenu et le message ouvert sont annoncés aux lecteurs d'écran, et pas
seulement signalés par une couleur.

**Ce qui n'est pas encore là.** Il n'existe pas de notion de « lu / non lu », ni de recherche : la
liste montre les cinquante messages les plus récents d'un dossier, et le dit lorsqu'elle en laisse
de côté.

### 4.16 Écrire et répondre

*Depuis la fiche d'une affaire, ou depuis un message de l'inbox.*

**Écrire depuis une affaire.** La fiche porte un bouton « Écrire un message ». Choisissez l'adresse
d'expédition, un ou plusieurs destinataires — séparés par une virgule ou un point-virgule —, un
objet et un message, puis « Mettre en file ».

**Répondre depuis l'inbox.** Un message rangé dans une affaire porte un bouton « Répondre » : le
destinataire et l'objet sont déjà remplis, et votre réponse reste rattachée à la conversation. Un
message **non classé** n'offre pas de réponse : tant qu'il n'appartient à aucune affaire, il n'y a
pas d'adresse à laquelle votre correspondant pourrait répondre. Classez-le d'abord.

**Les réponses de votre correspondant reviennent dans l'affaire**, quelle que soit sa messagerie :
le produit place dans chaque message qu'il envoie une adresse de retour qui pointe vers l'affaire.
C'est écrit sous le formulaire, parce que cette adresse n'est pas la vôtre.

**« Mis en file » n'est pas « envoyé ».** Le produit n'expédie pas au moment où vous validez : il
inscrit votre message dans une file, qu'un service vide ensuite. Tant que ce service n'a pas parlé,
le produit ne prétend pas que votre message est arrivé.

**Ce que le produit peut refuser, et pourquoi :**

| Refus | Ce qu'il faut faire |
|---|---|
| Vous ne pouvez pas écrire au nom de cette affaire | Demander le droit d'écriture sur son dossier |
| Cette adresse d'expédition ne vous est pas attribuée | En choisir une autre dans la liste |
| Cette affaire ne peut pas recevoir de réponse | Elle est archivée ou en corbeille : la restaurer d'abord |
| Cette adresse a atteint son plafond du jour | Attendre le lendemain, ou demander un plafond plus haut |

**Votre texte n'est jamais perdu** : un refus laisse le formulaire ouvert, avec ce que vous aviez
écrit.

**Ce qui n'est pas encore là.** Aucune pièce jointe à l'envoi, aucune signature automatique, aucune
copie cachée. Un message qui échoue à partir est marqué en échec et le dit ; il n'est pas réessayé
tout seul.


## 5. Administrer l'arborescence : tracks et channels

*Livré par `CRM-075` ; les règles d'accès sont celles de `CRM-020` et `CRM-021`, inchangées.*

**Où.** Barre latérale ▸ **Réglages** ▸ « Arborescence : tracks et channels ».

**L'index.** Ouvrir « Réglages » affiche d'abord un INDEX des sections de réglages, sous le titre
« Sections de réglages » — « Arborescence : tracks et channels » en est la première entrée. Ce
n'est plus, depuis `CRM-075`, la page sans contenu qu'elle a été : chaque nouvelle section de
réglages (permissions, workflows) y ajoutera sa propre entrée plutôt que de déplacer une adresse
déjà partagée.

**Qui.** L'écriture est réservée aux **administrateurs** de l'espace de travail. Les autres membres
voient l'arborescence — ils ont le droit de la lire — et leurs modifications sont refusées par le
serveur avec le message « Seul un administrateur de cet espace de travail peut modifier
l'arborescence. »

**Les boutons ne sont pas masqués pour autant**, et c'est délibéré : votre rôle peut changer pendant
que la page est ouverte, et cacher un bouton sur la foi d'un rôle lu à l'arrivée reviendrait à vous
interdire un geste qui vous est peut-être permis. Le produit préfère vous montrer le refus réel.

### 5.1 Un track

- **Créer** : bouton « Nouveau track ». Le **slug** — l'identifiant qui apparaît dans l'adresse — est
  proposé à partir du nom et reste modifiable tant que vous n'avez pas validé. Il n'accepte que des
  minuscules, des chiffres et des tirets simples ; le formulaire le dit avant l'envoi, et le serveur
  refuse un slug déjà pris dans l'espace de travail avec « Ce slug est déjà utilisé. »
- **Renommer** : le crayon. Vous modifiez le nom, la couleur, l'icône et la description.
  **Le slug ne se modifie pas depuis cet écran** : c'est l'adresse que vous partagez, et la changer
  romprait les liens déjà transmis sans que rien ne les rattrape.
- **Réordonner** : les flèches. Elles sont **désactivées** en tête et en fin de liste, et disent
  pourquoi plutôt que de disparaître.
- **Archiver** : la boîte. L'action demande une **confirmation** qui nomme le track. Un track archivé
  disparaît de la barre latérale et de son adresse, **sans être supprimé**.
- **Désarchiver** : cochez « Afficher les archivés » pour les faire réapparaître, puis utilisez la
  flèche de restauration. Aucune confirmation n'est demandée : ce geste ne retire rien.
- **Mettre à la corbeille** : la corbeille. L'action demande une **confirmation** qui nomme le track
  et **dit ce qui devient inaccessible avec lui** : le nombre de ses channels, puis celui de leurs
  affaires. Le track quitte
  alors l'arborescence et se retrouve dans **Réglages ▸ Corbeille**, d'où il se restaure
  (chapitre 5 ter).

**La suppression définitive n'existe pas**, et ce n'est pas un oubli : le produit ne l'expose nulle
part, et la base la refuse. Archiver masque ; mettre à la corbeille retire. Les deux sont
réversibles, et **rien n'efface**.

**Archiver et mettre à la corbeille sont deux états distincts**, et ils ne se remplacent pas :

| | Archiver | Mettre à la corbeille |
|---|---|---|
| Ce que cela veut dire | dossier clos, que l'on conserve | erreur que l'on retire |
| Où l'objet se retrouve | dans la même liste, en cochant « Afficher les archivés » | dans **Réglages ▸ Corbeille** |
| Comment on revient en arrière | « Désarchiver » | « Restaurer », depuis la corbeille |
| Confirmation demandée | oui | oui, **avec le décompte de ce qui devient inaccessible** |

Un track archivé peut être mis à la corbeille, et il **reste archivé** : le restaurer le rend
archivé, tel qu'il était.

**Archiver un track n'archive pas ses channels.** Ils restent dans l'état où ils étaient, et
réapparaissent exactement tels quels si vous désarchivez le track.

**Mettre un track à la corbeille n'y met pas ses channels** non plus — et c'est la raison d'être du
décompte de la confirmation. Ses channels et leurs affaires ne sont pas retirés : ils deviennent
**inaccessibles** tant que le track reste dans la corbeille, et redeviennent joignables dès qu'il est
restauré, exactement tels qu'ils étaient. C'est aussi pourquoi un channel dont le track est dans la
corbeille **ne se restaure pas seul** : le produit vous demande de restaurer le track d'abord.

### 5.2 Un channel

Dépliez un track avec le chevron : ses channels sont chargés à ce moment-là, et pas avant.

Les mêmes six gestes s'appliquent, avec deux différences :

- **L'ordre d'un channel se compte dans son track**, pas dans l'espace de travail entier ;
- **choisir un workflow est obligatoire.** La liste ne propose que les workflows réellement
  affectables : ceux de l'espace de travail entier, et ceux propres à ce track. Le workflow par
  défaut est présenté en tête et signalé comme tel, **mais il n'est pas coché** — le produit ne
  choisit pas à votre place. Tant qu'aucun workflow n'est choisi, « Créer » reste indisponible.

Si aucun workflow n'est affectable à ce track, l'écran vous le dit au lieu d'afficher un formulaire
que le serveur refuserait.

### 5.3 Quand un déplacement est indisponible sans être en bout de liste

Il arrive qu'une flèche soit désactivée alors que la ligne n'est ni en tête ni en fin. L'infobulle
l'explique : deux positions voisines sont **indistinctes**, et le déplacement ne changerait rien à
l'ordre affiché. Le produit préfère le dire plutôt que d'écrire une valeur sans effet. Remettre une
telle liste d'aplomb demande une renumérotation, qui n'est pas encore livrée.

### 5.4 Ce qui n'est pas encore là

- Le geste de mise à la corbeille existe pour un **track** et un **channel**, pas pour une
  **affaire** : une affaire ne se retire depuis aucun écran pour l'instant.
- Un objet retiré **disparaît de cette liste immédiatement**, mais la barre latérale garde le track
  jusqu'au prochain chargement de la page. Le même décalage existe depuis toujours pour l'archivage.
- Aucune **capture** de cet écran n'a encore été produite, et son parcours de bout en bout n'a pas
  été rejoué : les deux exigent la pile de développement complète.
- Le **déplacement d'un channel vers un autre track** n'est pas proposé.
- L'édition des **workflows** eux-mêmes relève du **chapitre 5 bis** pour leurs étapes, leurs
  transitions et les **questions** de leur formulaire ; la visibilité d'une question étape par
  étape n'a, elle, toujours pas d'écran.
- Les **droits fins** par track et par channel relèvent du chapitre 24 bis.

## 5 bis. Composer un workflow : ses étapes, ses transitions et son formulaire

*Livré par `CRM-076` ; les règles d'accès sont celles de `CRM-031`, inchangées. Captures dans
`docs/captures/CRM-076/`.*

**Où.** Barre latérale ▸ **Réglages** ▸ « Workflows : étapes et composition ».

**Ce que cet écran fait, et ce qu'il ne fait pas.** Il **compose** les workflows qui existent
déjà : il choisit leurs étapes dans le catalogue de nœuds, les ordonne, les surcharge, désigne
celle par laquelle les affaires entrent, déclare les **transitions** qui relient les étapes, et
définit les **questions du formulaire** posées sur chaque affaire. Depuis `CRM-031`, il **crée**
aussi un workflow (chapitre 5 bis.0). Il ne le copie pas vers un track et ne le rend pas par
défaut : ces deux gestes restent hors interface.

**Qui.** L'écriture est réservée aux **administrateurs** de l'espace de travail. Comme au
chapitre 5, les boutons ne sont pas masqués aux autres membres : le refus affiché est celui du
serveur, « Seul un administrateur de cet espace de travail peut composer un workflow. »

### 5 bis.0 Créer un workflow

*Livré par `CRM-031`. Captures dans `docs/captures/CRM-031/`.*

Le bouton **« Nouveau workflow »**, au-dessus de la liste de gauche, ouvre un formulaire à deux ou
trois champs :

- le **nom**, obligatoire — deux workflows peuvent porter le même, rien ne l'interdit ;
- la **portée** : « Global », disponible pour tous les tracks, ou « Propre à un track », proposé
  aux seuls channels de ce track ;
- le **track**, qui n'apparaît que sous la seconde portée. Sous « Global », il n'existe pas : ce
  n'est pas un champ grisé, c'est un champ sans objet.

**Le workflow naît vide.** Il n'a aucune étape, et il n'est utilisable par aucun channel tant que
vous ne lui en avez pas donné au moins une, désignée comme initiale (chapitre 5 bis.2). L'écran le
dit dès la création : « Ce workflow n'a aucune étape. » Un workflow sans étape initiale est un
brouillon parfaitement licite, pas une erreur.

Le workflow créé devient aussitôt le workflow **choisi**, prêt à être composé.

**Ce que le formulaire ne propose pas, et pourquoi.** Aucune case « par défaut » : un espace de
travail n'a qu'un seul workflow par défaut, et le proposer à chaque création reviendrait à offrir
un réglage refusé neuf fois sur dix. Rendre un workflow par défaut reste un geste d'API.

**Si l'espace de travail est vide**, l'écran affiche « Aucun workflow dans cet espace de travail »
et porte le même bouton : c'est ainsi que se pose le tout premier workflow d'un espace neuf.

### 5 bis.1 Choisir un workflow

La colonne de gauche liste les workflows de l'espace de travail, celui **par défaut** en tête, et
le premier est ouvert d'office. Chaque entrée dit sa portée — globale, ou propre à un track.

### 5 bis.2 Les étapes

Les étapes s'affichent dans l'ordre du graphe, avec pour chacune sa probabilité et son seuil de
relance — ceux du catalogue, ou ceux que vous avez surchargés.

- **Ajouter** : « Ajouter une étape » ouvre le catalogue des nœuds encore disponibles. Un nœud déjà
  employé par ce workflow n'y figure pas, un nœud archivé non plus. Lorsque tout le catalogue actif
  est employé, l'écran le dit plutôt que d'afficher une liste vide.
- **Ordonner** : les flèches montent et descendent une étape. Une flèche désactivée sans être en
  bout de liste s'explique comme au §5.3.
- **Surcharger** : le crayon ouvre un formulaire à trois champs — libellé, probabilité, seuil de
  relance. **Un champ laissé vide veut dire « prendre la valeur du catalogue »**, et ce n'est pas
  la même chose que zéro : une probabilité surchargée à `0` est une probabilité nulle voulue, que
  l'écran affiche comme telle. Vider un champ déjà surchargé retire la surcharge.
- **Désigner l'étape initiale** : le fanion. C'est par elle que les nouvelles affaires entrent. Un
  workflow qui n'en a aucune l'annonce en tête de liste — aucune affaire ne peut y entrer tant
  qu'elle n'est pas désignée.
- **Retirer** : la corbeille, après confirmation. Une étape **occupée par des affaires** n'est pas
  retirable : le serveur refuse, et l'écran nomme le refus. Retirer une étape ne supprime pas son
  nœud du catalogue.

### 5 bis.3 Les transitions

Sous les étapes, le bloc « Transitions déclarées » montre le graphe : chaque étape y figure avec
**ses sorties**, dans l'ordre du graphe. Une affaire ne peut aller que là où une transition la
mène ; une étape sans sortie est un point d'arrivée, et l'écran l'écrit — « Aucune sortie : les
cards s'y arrêtent » — plutôt que de la faire disparaître.

Chaque sortie affiche l'étape d'arrivée, le **libellé du bouton** qui la déclenche depuis une
affaire, et la mention **« Motif exigé »** lorsqu'un commentaire est obligatoire pour l'emprunter.

- **Déclarer** : « Déclarer une transition » ouvre un formulaire à deux listes. La liste d'arrivée
  ne propose ni l'étape de départ elle-même — une étape ne va pas vers elle-même — ni les arrivées
  **déjà déclarées** depuis ce départ. Lorsqu'il ne reste aucune arrivée possible, le formulaire le
  dit. Un workflow d'une seule étape ne peut porter aucune transition, et l'écran l'annonce.
- **Le libellé du bouton est facultatif.** Laissé vide, le menu d'une affaire affiche le libellé de
  l'étape d'arrivée. Une valeur composée uniquement d'espaces est refusée.
- **Exiger un motif** : la case rend le commentaire obligatoire. Le déplacement d'une affaire par
  cette transition sera refusé sans lui — c'est la règle décrite au §4.3, vue depuis son réglage.
- **Modifier** : le crayon change le libellé et le motif exigé, jamais les deux extrémités. Changer
  une extrémité, c'est une autre transition : déclarez-la, puis retirez l'ancienne.
- **Retirer** : la corbeille, après confirmation. Rien ne retient une transition — contrairement à
  une étape, aucune affaire ne la « porte » —, donc le retrait aboutit toujours si vous êtes
  administrateur. Les deux étapes, elles, restent dans le workflow ; seule la porte entre elles se
  ferme.

Si un autre administrateur déclare la même transition pendant que votre formulaire est ouvert, le
serveur refuse la vôtre et l'écran affiche « Cette transition est déjà déclarée. » Rien n'est écrit
deux fois.

### 5 bis.4 Les questions du formulaire

Sous les transitions, le bloc « Champs du formulaire » liste les **questions posées sur chaque
affaire** de ce workflow, dans l'ordre où elles apparaissent sur la fiche (§4.7). Chaque ligne
montre le libellé de la question, sa **clé** entre parenthèses techniques, son **type**, et son
texte d'aide s'il en porte un.

- **Déclarer** : « Déclarer un champ » ouvre le formulaire. Vous y saisissez une **clé**, un
  **libellé** et un **type**. La clé n'accepte que des minuscules, des chiffres et des tirets
  simples : c'est elle qui nomme la question dans les exports et dans les messages d'erreur. Une
  clé déjà employée dans ce workflow est refusée — l'écran affiche « Cette clé est déjà prise dans
  ce workflow. »
- **Les types à choix** — « Choix unique » et « Choix multiple » — font apparaître la liste des
  **choix proposés**. Chacun porte une clé et un libellé, et deux choix ne peuvent pas partager la
  même clé : les réponses seraient impossibles à distinguer. Un champ à choix a besoin d'au moins
  un choix pour être enregistré.
- **Le type « Montant »** demande une **devise**, en trois lettres majuscules, par exemple `EUR`.
- **Modifier** : le crayon change le **libellé**, le **texte d'aide** et, pour les types
  concernés, les **choix** ou la **devise**. La clé et le type, eux, ne se modifient plus : la clé
  est citée par les exports, et changer le type laisserait les réponses déjà saisies dans l'ancien
  format. Pour en changer, archivez la question et déclarez-en une nouvelle.
- **Réordonner** : les flèches déplacent la question dans le formulaire. L'ordre à l'écran est
  celui que voient les équipes sur chaque affaire.
- **Archiver** : la question disparaît des formulaires, **et les réponses déjà saisies sont
  conservées**. C'est le seul retrait que le produit connaisse : aucune question n'est jamais
  supprimée. Une question archivée reste dans la liste, marquée « Archivé », et le bouton de
  restauration la remet en place.

Comme partout ailleurs, l'écran ne décide d'aucun droit : si vous n'êtes pas administrateur de
l'espace de travail, l'enregistrement est refusé par le serveur et l'écran vous le dit.

### 5 bis.4 bis La visibilité des questions, étape par étape

Sous les questions, le bloc « Visibilité des champs, étape par étape » est une **grille** : une
ligne par question, une colonne par étape, et sur chaque case ce que la question devient à cette
étape-là.

Quatre états par case :

- **Par défaut** — aucune règle n'est enregistrée pour ce couple, et la question est **affichée** ;
- **Masqué** — la question n'apparaît pas sur les affaires de cette étape, et n'y est pas demandée ;
- **Affiché** — la question apparaît, facultative ;
- **Exigé** — la question apparaît, et elle doit être renseignée **pour qu'une affaire entre dans
  cette étape**. Une affaire déjà arrivée n'en est jamais chassée : le manque est signalé sur sa
  fiche sans bloquer sa lecture.

« Par défaut » et « Affiché » produisent le même formulaire. Le premier n'enregistre rien, le
second enregistre une règle explicite ; la grille les distingue pour ne pas effacer une règle que
vous n'avez pas désignée. Le choix part **dès que vous le faites** : il n'y a pas de bouton
d'enregistrement, chaque case étant une règle à elle seule.

Deux précisions que l'écran écrit lui-même sous le tableau :

- une **question archivée n'apparaît pas** dans la grille — elle ne figure dans aucun formulaire.
  Ses règles sont conservées et redeviennent effectives si vous la restaurez ;
- sur un écran étroit, **le tableau défile de lui-même** vers la droite ; la page, elle, ne défile
  jamais horizontalement.

La grille se parcourt entièrement au clavier, chaque case annonçant la question **et** l'étape
qu'elle règle.

### 5 bis.4 ter Ce qu'il faut avoir rempli pour emprunter un chemin

Sous la grille, le bloc « Champs exigés pour franchir une transition » reprend les chemins dans
l'ordre du graphe et écrit, sous chacun, ce qu'une affaire doit avoir renseigné pour l'emprunter.

Une exigence a **deux origines possibles**, et chaque ligne dit la sienne :

- **exigé par la règle de l'étape d'arrivée** — la question est réglée sur « Exigé » dans la grille
  ci-dessus, pour l'étape où ce chemin arrive. Elle vaut alors pour **tous** les chemins qui mènent
  à cette étape ;
- **exigé par cette transition** — la question n'est obligatoire que pour ce chemin-là, quels que
  soient les réglages de l'étape d'arrivée ;
- une même question peut porter **les deux** ; elle est alors écrite comme telle.

Cette distinction commande ce que vous pouvez faire depuis ce bloc. Une exigence venue d'une règle
**n'y porte aucune commande de retrait** : elle se modifie dans la grille, à la case correspondante.
Retirer ici ce qui a été réglé là-haut vous aurait laissé croire à un effet que le formulaire
n'aurait pas eu.

Deux gestes seulement, tous deux confirmés en base :

- **Exiger un champ** ouvre un court formulaire sous le chemin concerné. La liste ne propose que
  des questions qu'il est utile d'exiger : celles déjà liées à ce chemin en sont retirées, et les
  questions archivées n'y figurent jamais. Une question déjà exigée par la règle de l'étape
  d'arrivée reste proposée, avec un avertissement qui dit ce qu'elle changera — rien, tant que
  cette règle ne change pas.
- **Ne plus exiger** demande une confirmation nommant la question et le chemin. Elle rappelle que la
  question **reste dans le formulaire** : elle cesse seulement d'être obligatoire pour ce chemin.

Deux précisions que l'écran écrit lui-même :

- un chemin sans aucune exigence l'annonce en toutes lettres — « Aucun champ exigé » —, jamais par
  une liste vide ;
- une question **archivée** encore liée à un chemin est nommée **sans effet** : elle ne figure dans
  aucun formulaire, donc elle n'est demandée nulle part. La liaison est conservée et redevient
  effective si vous restaurez la question.

Si un autre administrateur déclare la même exigence pendant que vous remplissez le formulaire,
l'écran vous le dit — « Ce champ est déjà exigé par cette transition » — au lieu d'afficher une
erreur technique.

### 5 bis.4 quater Ce qu'une exigence fera aux affaires en cours

Rendre une question obligatoire est le seul réglage de cet écran qui puisse **empêcher** une affaire
existante d'avancer. L'éditeur vous dit donc, **avant** d'enregistrer, ce que le réglage ferait.

Quand vous passez une case de la grille à **« Exigé »**, rien n'est enregistré tout de suite : une
confirmation s'ouvre sous le tableau et annonce **deux** nombres, qui ne se déduisent pas l'un de
l'autre :

- combien d'affaires sont **déjà** à cette étape — leur fiche signalera le manque, mais elles ne
  sont **jamais** déplacées ni bloquées en lecture ;
- combien d'affaires **ne pourront plus entrer** dans cette étape tant que la question sera vide.

Les deux peuvent être très différents. Sur l'étape initiale, aucun chemin n'arrive : le second
nombre est nul alors que le premier ne l'est pas. Sur une étape de fin, c'est souvent l'inverse.

Tant que vous n'avez pas confirmé, **rien n'est écrit** : « Annuler » rend la case à son état
enregistré. Les trois autres états — « Par défaut », « Masqué », « Affiché » — s'appliquent
immédiatement comme avant : aucun d'eux ne bloque une affaire.

Le formulaire **« Exiger un champ »** d'une transition affiche le même genre de nombre dès que vous
choisissez une question, sous la liste : combien d'affaires ne pourront plus emprunter **ce
chemin-là**. Une exigence de chemin ne concerne que lui, à la différence d'une case de la grille qui
vaut pour toutes les entrées dans l'étape.

Deux précisions honnêtes :

- ces nombres comptent les affaires **que vous avez le droit de voir** ;
- si la mesure échoue, l'écran le dit — « n'ont pas pu être mesurés » — et **laisse le geste
  possible** : c'est une aide à la décision, pas une autorisation. Le contrôle réel reste appliqué
  au moment où une affaire tente de changer d'étape.

### 5 bis.5 Ce qui n'est pas encore là

- La prévisualisation ne montre **aucune liste nominative** des affaires concernées, seulement leur
  nombre.
- Retirer une exigence n'est pas prévisualisé : cela ne bloque rien, cela lève une contrainte.
- Exiger une même question sur **plusieurs chemins d'un coup** n'est pas possible : le geste se
  répète chemin par chemin.
- **Copier** vers un track et **rendre par défaut** un workflow restent hors interface. Créer, en
  revanche, est livré depuis `CRM-031` — chapitre 5 bis.0.

### 5 bis.6 Garder une photographie d'un workflow, et y revenir

*Livré par `CRM-078`, cinquième tranche. Captures dans `docs/captures/CRM-078/`.*

**Où.** Le bloc **Versions**, tout en bas de l'éditeur de workflows, sous les exigences de chemin.

Un workflow change : ses étapes, ses transitions, ses questions et leurs règles se modifient à tout
moment. Une **version** est une photographie datée, numérotée et signée de sa composition entière.
Elle ne se modifie pas et ne se supprime pas — c'est tout son intérêt.

**Le tableau des versions** liste, de la plus récente à la plus ancienne : son numéro, la date de
publication, la personne qui l'a publiée, sa note éventuelle et le début de son empreinte — le
condensé qui identifie la composition. Un workflow qui n'a jamais été publié le dit en toutes
lettres ; c'est le cas de la copie « Cycle commercial — Conseil IA » de l'espace de démonstration.

**Publier une version** fige la composition actuelle. Une note facultative aide à la retrouver plus
tard ; elle ne change rien à ce qui est conservé. Publier **ne change rien** au fonctionnement : les
affaires continuent de circuler sur le workflow vivant, une version est un témoin, pas une cible.
Publier deux fois de suite sans avoir rien modifié entre-temps est **refusé**, et l'écran l'écrit :
deux versions identiques ne seraient distinguables par personne.

**Comparer deux versions** dit ce que la version **cible** ajoute, retire ou modifie par rapport à
la version de **base** — le sens est celui que vous choisissez dans les deux listes. Le résultat est
rangé en six familles : le workflow lui-même, les étapes, les transitions, les questions, les règles
de visibilité et les questions exigées par un chemin. Chaque élément est marqué *Ajouté*, *Retiré*
ou *Modifié*, et une modification dit l'attribut concerné, sa valeur avant et sa valeur après.
Comparer une version à elle-même est permis, et l'écran répond simplement que rien ne les distingue.

**Prévoir une restauration** demande au produit, avant tout geste, où chaque affaire atterrirait si
cette version était rétablie. Le plan dit combien d'affaires sont concernées, combien ne bougeraient
pas, combien seraient déplacées et combien **attendent une instruction**. Les affaires **archivées**
et celles **en corbeille** y figurent comme les autres : elles occupent une étape, elles aussi.

Lorsque la restauration ferait disparaître une étape, celle-ci apparaît avec le nombre d'affaires
qu'elle porte, et une liste déroulante vous demande **où les envoyer**. Le produit ne choisit jamais
à votre place, même lorsqu'une étape disparue est sur le point d'être rétablie : il la nomme, il ne
la choisit pas. Chaque choix relance le calcul du plan, et le verdict est mis à jour.

**Restaurer** rétablit la composition photographiée, en une seule fois ou pas du tout. Avant toute
écriture, le produit **publie la composition actuelle comme point de retour** : revenir en arrière
est alors la même manœuvre, appliquée à cette nouvelle version. Le résultat reste affiché — le point
de retour, le nombre d'affaires déplacées, les étapes et les questions créées, supprimées ou
modifiées. Tant qu'une affaire attend une instruction, la restauration est **refusée** et le dit.

**Ce qui n'est pas restauré, et le produit l'écrit** : le **nom** du workflow, sa portée, son track
et son caractère par défaut. Ce sont son identité et son placement, pas sa composition. Une question
devenue surnuméraire est **archivée**, jamais supprimée : les réponses déjà saisies sont conservées.

**Qui peut le faire.** Publier, prévoir et restaurer sont réservés aux **administrateurs** de
l'espace de travail. Les commandes restent visibles pour tout le monde — c'est le serveur qui
refuse, et l'écran affiche son refus plutôt que de faire disparaître un bouton.

### 5 bis.7 Ce qui n'est pas encore là, côté versions

- La **liste des affaires** du plan est bornée à deux cents entrées, et l'écran écrit combien il en
  montre sur combien. Cette borne n'est pas réglable depuis l'interface.
- Aucune **purge** ni rétention : le nombre de versions ne fait que croître.
- Une version ne porte **aucune commande de ligne** : elle ne se renomme pas, ne se supprime pas, et
  sa note ne se modifie plus après coup.

## 5 ter. La corbeille : ce qui a été retiré, et comment le rendre

*Livré par `CRM-077`. Captures dans `docs/captures/CRM-077/`.*

**Où.** Barre latérale ▸ **Réglages** ▸ « Corbeille ».

**Ce que l'écran montre.** Un tableau des objets retirés — tracks, channels et affaires mêlés —, du
plus récemment retiré au plus ancien. Chaque ligne dit son **type**, son **nom**, **qui** l'a
retiré, **quand**, et **ce qu'il retient avec lui**.

**Vous n'y voyez que ce que vous avez le droit de lire**, comme partout ailleurs dans le produit :
une affaire d'un channel qui vous est fermé n'apparaît pas dans votre corbeille. Le nombre affiché
dans « Retient avec lui » suit la même règle — c'est **votre** décompte, pas un inventaire complet.

**« Auteur inconnu » n'est pas une anomalie.** Un objet peut avoir été retiré par un traitement
technique plutôt que par une personne, ou par un compte supprimé depuis. Le produit le dit au lieu
de laisser la case vide.

### 5 ter.1 Restaurer

Le bouton **Restaurer** de la ligne. Aucune confirmation n'est demandée : restaurer ne détruit rien,
et le geste inverse est précisément celui qui a rempli cet écran.

Trois réponses sont possibles, et l'écran les distingue :

| Ce que vous voyez | Ce qui s'est passé |
|---|---|
| La ligne disparaît, un message confirme | L'objet est rendu, exactement dans l'état où il était |
| « Son parent est lui-même en corbeille : restaurez-le d'abord. » | Le rendre seul l'aurait rendu **à un endroit invisible** — un channel dans un track retiré, une affaire dans un channel retiré |
| « Rien n'a été restauré : cet objet n'est plus modifiable avec votre compte. » | Votre compte n'a pas le droit d'écrire sur cet objet. **Rien n'a changé** |

**La deuxième réponse est une règle du serveur, pas une précaution de l'écran** : elle vaut aussi
pour un script ou une intégration qui tenterait la même chose.

### 5 ter.2 Ce que cet écran ne fait pas

- **On n'y retire rien, on y rend.** Le geste de mise à la corbeille vit là où vivent les objets —
  chapitre 5 pour un track et un channel, chapitre 4.7 *bis* pour une affaire.
- **Aucun effacement définitif, et aucun « vider la corbeille ».** La **durée de conservation** n'est
  pas arrêtée, et livrer une destruction irréversible avant d'avoir fixé une règle de conservation
  serait le contraire d'une garantie.
- **Aucun filtre, aucun tri, aucune pagination** : la corbeille est rendue en entier, la plus
  récemment retirée d'abord.

### 5 ter.3 Ce qui n'est pas encore là

- Le retrait d'une **affaire** se fait depuis sa fiche (chapitre 4.7 *bis*), et non depuis le
  tableau kanban ni la vue liste.
- La **durée de conservation** et l'**effacement définitif** attendent une décision.
- La corbeille suit aujourd'hui la lecture de l'objet. Savoir si un membre ordinaire doit y avoir
  accès, ou le seul administrateur, n'est pas tranché.

## 5 quater. Le catalogue de nœuds : le vocabulaire de vos workflows

*Livré par `CRM-030` ; l'écran est spécifié au §2 bis de
[`docs/SPEC-workflow-engine.md`](SPEC-workflow-engine.md).*

Un **nœud** est un état par lequel une affaire peut passer : « Prospection », « Négociation »,
« Perdu ». Le catalogue est la liste de ceux qui ont un nom dans votre espace de travail, et les
workflows y puisent leurs étapes. Deux workflows différents qui emploient le même nœud parlent du
même état — c'est ce qui rend comparable le temps passé en « Relance » d'un channel à l'autre.

On y arrive par **« Réglages ▸ Catalogue de nœuds »**.

### 5 quater.1 Ce que chaque ligne montre

- le **libellé**, dans la couleur du nœud — la même que celle que le tableau kanban lui donnera ;
- sa **clé**, en petits caractères techniques : c'est l'identifiant durable sur lequel les
  statistiques s'appuient ;
- son **type** — « Ouvert », « Gagné » ou « Perdu » —, écrit en toutes lettres. C'est lui qui permet
  de calculer un taux de conversion sans deviner d'après le libellé ;
- sa **probabilité par défaut** et son **seuil de relance**, quand ils sont renseignés. Une case
  vide veut dire que le nœud ne se prononce pas, ce qui n'est **pas** la même chose que zéro :
  « Perdu » vaut réellement 0 %, alors qu'un autre nœud peut n'avoir aucune signification
  prévisionnelle ;
- la mention **« Archivé »**, le cas échéant.

### 5 quater.2 Créer un nœud

« Nouveau nœud » ouvre un formulaire sous l'en-tête. Le libellé propose une clé, que vous pouvez
corriger : elle doit être en minuscules, chiffres et tirets, et rester unique dans l'espace de
travail. La proposition est une commodité et rien de plus — pour « Nœud de suivi », elle rend
`n-ud-de-suivi`, la ligature « œ » n'étant pas convertible automatiquement ; corrigez-la avant
d'enregistrer.

Probabilité et seuil de relance sont facultatifs. Laissés vides, ils restent vides.

### 5 quater.3 Modifier un nœud

« Modifier » ouvre le même formulaire à la place de la ligne, sans la clé : **la clé ne se modifie
pas**. Elle est ce sur quoi vos statistiques s'appuient, et la renommer réécrirait l'histoire de
toutes les affaires passées par ce nœud. Si un nœud ne convient plus, archivez-le et créez-en un
autre.

### 5 quater.4 Archiver un nœud, et le rétablir

Archiver retire le nœud des workflows à composer, sans rien effacer. Le nœud reste dans la liste,
marqué « Archivé », et « Rétablir » le remet en service — ce geste-là ne demande aucune
confirmation, puisqu'il ne détruit rien.

**Un nœud sur lequel des affaires se trouvent encore ne s'archive pas.** Le produit refuse, dit
combien d'affaires en cours l'occupent, et vous demande de les déplacer d'abord. Ce refus vient du
serveur : la commande reste offerte, et c'est en la déclenchant que vous obtenez le compte exact.
Les affaires archivées ou mises à la corbeille ne comptent pas.

### 5 quater.5 Réordonner le catalogue

Les deux flèches en tête des commandes d'une ligne la font monter ou descendre d'un cran. Chaque
clic écrit l'ordre immédiatement : il n'y a rien à valider.

- La flèche est **éteinte** quand le geste n'a nulle part où aller — sur la première ligne pour
  « monter », sur la dernière pour « descendre ». Survolez-la : elle dit pourquoi.
- Un nœud **archivé** ne se déplace pas, et ne porte donc aucune flèche. Il **garde sa place** dans
  la liste, et les nœuds actifs le franchissent normalement.
- Cet ordre est celui de l'écran et celui des listes où l'on choisit un nœud. Il ne change **rien**
  aux affaires en cours, ni aux workflows déjà composés : réordonner le vocabulaire ne réordonne
  aucun parcours.

Le geste reste possible sur un nœud que des affaires occupent — contrairement à l'archivage.
Déplacer un état dans la liste ne déplace aucune affaire.

### 5 quater.6 Ce qui n'est pas encore là

- **Supprimer** un nœud n'existe pas, et n'est pas prévu : l'archivage tient lieu de retrait.
- Le nombre d'affaires posées sur un nœud n'est **pas affiché à l'avance** ; il apparaît dans le
  refus d'archivage.

## 6. Consulter l'état de la messagerie

*Livré par `CRM-059` ; les règles d'accès sont celles de `CRM-052` (comptes entrants) et de
`CRM-058` (file sortante) — cet écran n'en invente aucune.*

**Où.** Barre latérale ▸ **Réglages** ▸ « État de la messagerie ».

**Qui.** Un administrateur de l'espace de travail voit **tous** les comptes de messagerie entrante
du workspace, la boîte système comprise. Un membre ordinaire ne voit que **sa propre boîte**, s'il en
possède une ; sans boîte propre et sans droit d'administration, l'écran affiche « Aucune boîte à
superviser » plutôt qu'un tableau vide qui prétendrait avoir cherché sans rien trouver.

**Ce que le tableau montre, par boîte :**

- **Dernière relève réussie** — la date et l'heure du dernier relevé qui a abouti. Une boîte jamais
  relevée l'annonce en toutes lettres : « Jamais relevée », et non une case vide.
- **Dernier incident** — si la boîte est en échec, un texte compréhensible : « Authentification
  refusée », « Hôte injoignable », « Connexion refusée », « Échec TLS », « Délai dépassé » ou
  « Erreur de protocole ». Le produit ne montre jamais le message technique brut renvoyé par votre
  serveur mail, qui peut contenir des détails de connexion.

**Ce que les deux chiffres montrent :** le nombre de messages **en attente d'envoi** (mis en file ou
en cours d'envoi) et le nombre d'**échecs définitifs** — un envoi qui a épuisé ses tentatives de
reprise. Un membre ordinaire ne compte que la file des affaires qu'il a le droit de lire ; un
administrateur compte celle de tout l'espace de travail.

**Ce que cet écran ne fait pas.** Il **lit**, il n'agit pas : aucun bouton ne relance une relève,
n'acquitte un incident ni ne modifie un réglage depuis cette page. La donnée est lue à l'ouverture ;
rafraîchissez la page pour la mettre à jour.

### 6.1 Ce qui n'est pas encore là

- **Aucune alerte n'est envoyée** lorsqu'un compte tombe en erreur : cet écran est le seul endroit où
  le constater. Une notification proactive relèverait d'une unité dédiée aux notifications.
- **Aucune veille par IDLE** : la relève reste une scrutation régulière, dont l'intervalle se règle
  par la variable d'environnement `MAIL_SYNC_POLL_INTERVAL` (opération d'exploitation, hors de cet
  écran).

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
| Tracks en corbeille | 1 |
| Channels actifs | 6 |
| Channels archivés | 1 |
| Channels en corbeille | 1 |
| États du catalogue actifs | 7 |
| États du catalogue archivés | 1 |
| Workflows | 2 |
| Workflows copiés dans un track | 1 |
| Étapes du workflow général | 7 |
| Déplacements déclarés par le workflow général | 11 |
| Questions du formulaire actives | 12 |
| Questions du formulaire retirées | 2 |
| Affaires | 41 |
| Affaires actives | 39 |
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
