# Manuel utilisateur — P2Enjoy CRM

Ce manuel décrit le CRM tel que vous l'utilisez : chaque écran, chaque geste, et ce que le produit refuse et pourquoi.
Il suit l'ordre dans lequel on découvre le produit — se connecter, se repérer, suivre ses affaires, échanger avec ses
contacts, administrer son espace, piloter son activité. Depuis n'importe quel écran, l'icône « Aide » de l'en-tête
mène à la section qui le décrit.

## 1. Se connecter et se déconnecter

Le CRM n'a **pas de mot de passe à lui** : vous vous connectez avec votre compte LeLabs. L'écran de connexion n'offre
qu'une action, **Se connecter avec LeLabs**. Le produit vous envoie sur la page de connexion de LeLabs ; une fois
connecté là-bas, vous revenez au CRM, à la page d'où vous étiez parti si vous aviez commencé depuis une fiche ou un
board. Pendant l'aller, le bouton affiche « Redirection vers LeLabs… » ; au retour, une carte grisée annonce « Connexion
LeLabs en cours » le temps que le CRM vérifie votre connexion.

**Ouvrir une adresse du CRM sans être connecté** — un lien reçu, un favori — affiche l'écran de
connexion, et rien d'autre : ni menu, ni page vide. Une fois connecté avec LeLabs, vous arrivez sur
la page demandée.

### 1.1 Qui peut entrer

Un compte LeLabs n'ouvre le CRM que si **trois** conditions sont réunies :

- votre adresse est **vérifiée** auprès de LeLabs ;
- votre compte LeLabs est **vérifié** par un administrateur de LeLabs — un geste humain, qui peut
  prendre du temps ;
- un administrateur d'un espace du CRM vous a **inscrit à cette adresse**, ou vous en êtes déjà
  membre — **ou vous êtes administrateur de LeLabs**.

À votre première connexion, votre inscription devient votre place dans l'espace, avec le rôle que
l'administrateur a choisi pour vous.

**Les administrateurs de LeLabs administrent le CRM.** C'est une règle commune aux produits LeLabs :
qui porte le rôle d'administration de LeLabs est administrateur de **chaque** espace
du CRM, sans avoir à y être inscrit, et cesse de l'être dans les cinq minutes qui suivent le retrait
de ce rôle chez LeLabs. Tout autre rôle LeLabs ne change rien à vos droits dans le CRM : ils restent
ceux de votre espace.

### 1.2 Les messages de l'écran de connexion

Deux sortes de messages existent, et ils ne se ressemblent pas.

**« Accès en attente »** — sur fond jaune pâle, avec une icône de cercle en pointillés. Vous n'avez
rien fait de faux : un geste manque, qui n'est pas le vôtre ou que vous faites ailleurs. Le message
nomme votre adresse.

| Message | Ce qu'il faut faire |
|---|---|
| Votre adresse … n'est pas encore vérifiée auprès de LeLabs. | Vérifiez votre adresse depuis votre compte LeLabs, puis reconnectez-vous. |
| Votre compte LeLabs … n'est pas encore vérifié. | Un administrateur de LeLabs doit confirmer votre identité. Rien à faire de votre côté, sinon patienter et vous reconnecter plus tard. |
| Aucun espace du CRM ne vous attend à l'adresse … | Demandez à un administrateur de votre espace de vous inscrire **avec cette adresse exacte**, puis reconnectez-vous. |
| Un espace du CRM vous attend à l'adresse …, mais son administrateur ne s'y est pas encore connecté. | L'espace est tout neuf : son administrateur doit s'y connecter une première fois avant que d'autres puissent entrer. Rien à faire de votre côté ; reconnectez-vous une fois qu'il l'aura fait. Si vous êtes aussi attendu dans un autre espace, vous y entrez déjà. |

**Un refus** — sur fond rouge pâle, avec un triangle d'alerte. Une tentative a échoué ; il suffit en
général de recommencer.

| Message | Ce qu'il veut dire |
|---|---|
| La connexion LeLabs a été annulée. | Vous avez refusé ou interrompu la connexion chez LeLabs. Rien n'a changé. |
| La connexion LeLabs n'a pas abouti. Recommencez depuis cet écran. | Le retour de LeLabs n'a pas pu être vérifié — par exemple si vous avez mis plus de dix minutes, ou ouvert le retour dans un autre onglet. |
| Le serveur n'a pas répondu… | LeLabs ou le CRM est momentanément injoignable. Réessayez. |
| Votre session a pris fin. Reconnectez-vous avec LeLabs. | Votre session LeLabs a été fermée, ou un droit vous a été retiré. |
| La connexion n'est pas configurée sur ce déploiement. | Cette installation du CRM ne connaît pas LeLabs : prévenez la personne qui l'a installée. Aucun bouton n'est alors proposé. |

Dans les deux cas, le bouton **Se connecter avec LeLabs** reste disponible.

### 1.3 La session

**Votre session vit dans ce navigateur**, pas seulement dans l'onglet : recharger la page ou ouvrir
un nouvel onglet vous retrouve connecté. Elle se prolonge d'elle-même tant que votre session LeLabs
vit. Elle prend fin quand vous fermez le navigateur, quand vous vous déconnectez, ou quand LeLabs ou
votre espace vous retire l'accès — au plus tard cinq minutes après ce retrait : l'écran de connexion
vous dit alors pourquoi, et vous ramène à l'adresse que vous quittiez une fois reconnecté.

**Rien d'identifiant n'est écrit sur votre appareil.** Aucun jeton LeLabs n'y est jamais conservé ;
le CRM garde votre session de son côté et ne laisse au navigateur qu'un cookie technique, illisible
par les pages, strictement nécessaire à la session et effacé à la fermeture du navigateur.

### 1.4 Se déconnecter

L'en-tête affiche votre nom et votre avatar — votre adresse en infobulle — et l'action **Se
déconnecter**, qui ferme votre session du CRM et revient à l'écran de connexion. Elle **ne ferme
pas votre session LeLabs** : c'est le principe même d'une connexion unique. Tant que celle-ci reste
ouverte dans ce navigateur, **Se connecter avec LeLabs** vous reconnecte sans vous redemander votre
mot de passe. Sur un ordinateur partagé, fermez aussi votre session LeLabs, depuis votre espace de
compte LeLabs.

## 2. Le guide de démarrage : par où commencer

À la première connexion, l'accueil ne montre aucun board — il n'y en a pas encore. Il montre à la
place le **Guide de démarrage**, une liste de **six étapes** qui mènent chacune vers l'écran qui
la réalise.

Les six étapes, dans l'ordre :

| Étape | Ce qu'elle établit | Où elle se fait |
|---|---|---|
| Rejoindre un espace de travail | Votre compte appartient à un espace | Aucun écran : elle est accomplie par votre connexion |
| Créer un premier track | Un dossier de premier niveau existe | Réglages ▸ Arborescence |
| Préparer un premier workflow | Les affaires ont des étapes à suivre | Réglages ▸ Workflows — ou, pour un administrateur, le bouton **Créer le workflow de départ** du guide ([§2.4](#le-workflow-de-depart-en-un-geste)) |
| Ouvrir un channel dans ce track | Un onglet de travail existe sous ce track | **Nouveau channel**, dans la barre d'onglets du track ([chapitre 3.4](#les-onglets-d-un-track)), ou Réglages ▸ Arborescence |
| Créer une première affaire | Un board a quelque chose à montrer | Le board du premier channel : dès qu'un channel existe, le lien **Ouvrir le board et créer l'affaire** y mène, et le bouton **Nouvelle affaire** crée l'affaire ([chapitre 9.10](#le-tableau-kanban-d-un-channel)). Sans channel, le lien mène à l'arborescence |
| Raccorder une boîte de réception | Le courrier entrant se classe dans les affaires | Réglages ▸ État de la messagerie |

**Le workflow vient avant le channel, et ce n'est pas un détail d'ordre** : un channel suit
toujours un workflow, et un espace neuf n'en a **aucun**. Tant qu'il n'y en a pas, le formulaire
« Nouveau channel » le dit — « Aucun workflow n'est affectable à ce track » — et propose le lien
**Nouveau workflow**, qui ouvre l'éditeur et vous ramène ensuite au channel en cours ([chapitre 17.2](#un-channel)).

### 2.1 L'état d'une étape est mesuré, jamais mémorisé

Une étape n'est pas « cochée » : à **chaque affichage**, le produit compte ce que votre compte voit
réellement, et en déduit l'état. Trois conséquences directes, et elles sont voulues :

- supprimer votre dernier track **décoche** l'étape correspondante ; rien ne prétend qu'elle est
  faite parce qu'elle l'a été un jour ; un workflow **archivé** ne compte pas non plus ;
- une étape marquée **Fait** garde son lien : accompli ne veut pas dire terminé, et rien n'empêche
  d'ajouter un second track ;
- rien n'est enregistré sur votre appareil, et aucune progression n'est stockée sur le serveur.

Chaque état est écrit **en toutes lettres** — *Fait*, *À faire* — à côté de son icône, et la
progression est une phrase, « 3 étape(s) sur 6 », jamais une barre seule.

### 2.2 Ce que le guide dit exactement, et ce qu'il ne dit pas

Une étape non accomplie écrit « **Vous n'en voyez aucun pour le moment** », et le mot est choisi :
le guide rapporte ce que **votre compte** voit, jamais ce qui existe dans l'espace. Deux personnes
n'ont donc pas nécessairement le même guide — un compte en lecture seule peut ne voir aucune boîte
de réception là où l'espace en porte trois, et sa dernière étape restera « à faire ». Ce n'est pas
un défaut d'affichage : ce sont ses droits, et le guide ne prétend jamais les contourner.

Si vous n'administrez pas l'espace, les liens du guide vers un geste d'administration deviennent un texte
grisé, et un bandeau en tête de la liste dit pourquoi ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Les écrans vers lesquels le guide renvoie
portent eux-mêmes leurs refus, et c'est là que vous les rencontrerez, expliqués.

Lorsqu'une étape **n'a pas pu être mesurée** — une coupure réseau, une session expirée —, sa ligne
le dit (« Cette étape n'a pas pu être vérifiée ») et propose de **réessayer**, ce qui relance
réellement les six mesures. Les cinq autres étapes restent lisibles : une mesure manquante n'en
efface aucune.

### 2.3 Le masquer, et le retrouver

Le bouton **Masquer le guide** le retire de l'accueil **pour cette session** et rend la place au
board. Un lien discret, *Rouvrir le guide de démarrage*, reste sur l'accueil. Pour un
administrateur, il masque aussi la pastille du guide flottant ([§2.5](#le-guide-flottant-des-administrateurs)).

Le guide vit aussi dans **Réglages ▸ Guide de démarrage**, en tête de l'index. Là, il est toujours rendu : même
masqué, même intégralement accompli. C'est ce qui le rend relançable.

Le masquage survit au **rechargement** de l'onglet, et disparaît quand l'onglet se ferme. C'est
délibéré : cette préférence d'affichage ne justifie aucun stockage durable sur votre appareil, et
le produit n'en écrit aucun.

### 2.4 Le workflow de départ, en un geste

Dans un espace neuf, l'étape **Préparer un premier workflow** porte, pour un **administrateur** de
l'espace, un bouton **Créer le workflow de départ**. Il pose en une fois le cycle commercial type :

- un workflow **Cycle commercial**, le workflow **par défaut** de l'espace ;
- sept étapes — Prospection (l'étape initiale), Relance, Négociation, Signature, Réalisation,
  Livré, Perdu — et les nœuds correspondants dans le catalogue ;
- onze transitions, dont « Marquer perdu » depuis chaque étape ouverte, qui **exige un motif**.

Tout se modifie ensuite dans **Réglages ▸ Workflows**, comme n'importe quel workflow :
le renommer, retirer ou ajouter des étapes, changer ses transitions.

Ce que l'écran montre pendant et après :

- pendant la création, le bouton est désactivé et dit « Création… » ;
- une fois le workflow posé, l'étape passe à **Fait**, le bouton disparaît, et le curseur du
  clavier se place sur le lien **Ouvrir l'éditeur de workflows** de la même ligne ; un lecteur
  d'écran annonce « Workflow de départ créé » ;
- si un workflow existe déjà — créé entre-temps dans un autre onglet, ou par un collègue —, l'étape
  passe aussi à **Fait**, et l'annonce dit « Cet espace a déjà un workflow : ouvrez l'éditeur pour
  le composer. » Ce n'est pas une erreur ;
- si un nœud du cycle type a été **archivé** dans le catalogue, la création est refusée et le
  message nomme ce nœud : restaurez-le depuis **Réglages ▸ Catalogue de nœuds**, ou composez votre
  workflow à la main ;
- sur une coupure réseau, le message invite à réessayer, et le bouton reste disponible.

Le bouton n'est montré qu'aux administrateurs, et le serveur refuse ce geste à tout autre rôle.
Un compte qui n'est pas administrateur voit l'étape et son lien, pas le bouton.

**L'écran ouvert se met à jour.** Si vous créez le workflow depuis le guide flottant alors que
l'éditeur de workflows, le catalogue de nœuds ou un formulaire « Nouveau channel » est ouvert, cet
écran se relit aussitôt : le formulaire de channel propose alors le nouveau workflow, sans perdre
le nom déjà saisi.

### 2.5 Le guide flottant des administrateurs

Pour un **administrateur**, le guide ne reste pas sur l'accueil : il le suit sur toutes les pages,
sous la forme d'une **pastille** en bas à droite de l'écran — « Démarrage · 2 sur 6 », ou « 2/6 »
sur un téléphone. Les autres rôles gardent le guide sur l'accueil et dans les réglages.

- **L'ouvrir** : un clic sur la pastille (ou `Entrée` quand elle a le focus) déploie au-dessus
  d'elle un panneau avec les six étapes, leurs liens et le bouton du workflow de départ.
- **Suivre un lien ne le referme pas.** Vous pouvez aller créer votre track, revenir, ouvrir
  l'éditeur : le panneau reste ouvert, et la progression est **re-mesurée à chaque changement de
  page**, sans recharger.
- **Le refermer** : le bouton **Réduire**, la touche `Échap`, ou un nouveau clic sur la pastille.
  Le focus revient sur la pastille. **Masquer pour la session** la retire jusqu'à la fermeture de
  l'onglet — c'est la même préférence que *Masquer le guide*.
- **Ce qu'il retient** : ouvert ou réduit, pour la durée de l'onglet seulement ; rien d'autre, et
  rien de durable sur votre appareil.
- **Quand il disparaît** : une fois les six étapes accomplies. Il n'apparaît pas non plus sur
  l'accueil ni dans **Réglages ▸ Guide de démarrage**, qui montrent déjà le guide dans la page.

Le panneau n'est pas une fenêtre modale : le reste de la page reste utilisable, panneau ouvert. Il
couvre en revanche la partie droite de l'écran ; **Réduire** la libère d'un geste.

**Ce qui reste hors du guide.** Il **lit et renvoie**, à une exception près : le workflow de départ, qu'il pose en un
geste. Il ne crée ni track, ni channel, ni affaire : ces écrans existent, et le guide y mène.

## 3. Naviguer : barre latérale, onglets, états

Ce chapitre décrit ce qui entoure chaque page du CRM : la barre latérale à gauche, l'en-tête en haut, la barre
d'onglets d'un track, et la façon dont l'application vous dit qu'elle charge, qu'elle n'a rien à montrer ou qu'elle
n'a pas pu lire.

### 3.1 La disposition de l'écran

L'écran se lit en quatre zones :

- à gauche, la **barre latérale** : les entrées de navigation, puis la section **Tracks**
  ([section 3.3](#la-barre-laterale-et-la-section-tracks)) ;
- en haut, l'**en-tête** : le **fil d'Ariane**, qui dit où vous êtes ([section 3.2](#le-fil-d-ariane-savoir-ou-vous-etes)),
  puis la recherche, l'icône **« Aide »**, la cloche des notifications, votre nom et **Se déconnecter** ;
- sous l'en-tête, la **barre d'onglets** : les channels du track ouvert ([section 3.4](#les-onglets-d-un-track)). Hors
  d'un track, elle écrit « Aucun channel » ;
- au centre, le **contenu** de la page.

### 3.2 Le fil d'Ariane : savoir où vous êtes

En haut de l'écran, le **fil d'Ariane** nomme le chemin qui mène à la page ouverte, du plus général au plus précis.
Sur une affaire, il se lit par exemple :

> P2Enjoy SAS / Conseil & IA / Grands comptes / **Migration ERP Sogexia**

- Le **premier niveau** est votre **espace de travail**. Il mène au Board.
- Viennent ensuite le **track**, puis le **channel**. Chacun est un lien : cliquez le channel pour revenir à son
  tableau, ou le track pour revenir à ses onglets.
- Le **dernier niveau**, en gras, est le titre de la page : l'affaire, le channel, ou l'écran ouvert. Ce n'est pas un
  lien, puisque vous y êtes.

Le fil suit la page :

| Page ouverte | Ce que dit le fil |
|---|---|
| une affaire | espace / track / channel / **affaire** |
| le tableau ou la liste d'un channel | espace / track / **channel** |
| un track, sans channel ouvert | espace / **track** |
| les coûts d'un track | espace / track / **Coûts** |
| le détail d'un budget | espace / track / Coûts / **budget** |
| un chapitre du manuel | espace / Aide / **chapitre** |
| toute autre page (Inbox, Contacts, Réglages…) | espace / **nom de la page** |

**Un nom trop long** est raccourci par « … » ; survolez-le pour lire le nom complet.

**Sur un écran plus étroit qu'un ordinateur portable**, le fil passe sur sa propre ligne, sous la recherche, l'aide,
les notifications et votre profil. **Sur un téléphone**, il ne montre que le niveau précédent et le titre : « … /
Grands comptes / **Migration ERP Sogexia** ». Le bouton **« … »** ouvre la liste des niveaux masqués — votre espace et
le track —, chacun cliquable. Au clavier, atteignez-le avec `Tab`, ouvrez-le avec `Entrée`, refermez-le avec `Échap`.

**Le fil ne nomme que ce que vous pouvez lire.** Un channel auquel vous n'avez pas accès n'y apparaît jamais, pas plus
qu'un nom tapé dans l'adresse qui ne correspond à rien.

### 3.3 La barre latérale et la section Tracks

La barre latérale porte, dans cet ordre : **Board**, **Inbox**, **Contacts**, **Objectifs**, **Coûts**, **Pilotage**,
**Rentabilité**, **Temps**, **Ma journée**, **Affaires figées** et **Réglages**. Une personne superadministratrice y
trouve en plus, en dernier, l'entrée **Plateforme** ([chapitre 32](#la-plateforme-espaces-membres-et-superadministrateurs)).

Dessous, la section **Tracks** liste les activités de votre espace de travail — par exemple « Conseil & IA », « Studio
web », « Formation ». Chaque track s'affiche en pilule colorée, précédée de son icône.

- L'**ordre** est celui que l'administration de l'espace a choisi, pas l'ordre de création.
- Un track **archivé** n'apparaît pas. L'archivage masque sans détruire : une personne administratrice peut le rendre
  à tout moment.
- La **couleur** et l'**icône** aident à repérer un track d'un coup d'œil ; elles ne portent jamais seules une
  information, le nom les accompagne toujours.
- Un clic sur la pilule ouvre le track sur ses channels. Le track ouvert se signale par un anneau bleu, qui s'ajoute à
  sa couleur sans la remplacer.

Créer, renommer, réordonner ou archiver un track est réservé aux administrateurs de l'espace, depuis **Réglages ▸
Arborescence** ([chapitre 17](#administrer-l-arborescence-tracks-et-channels)). Le serveur applique cette règle, quel que
soit le chemin emprunté pour la contourner.

### 3.4 Les onglets d'un track

Ouvrir un track affiche ses **channels** en onglets, juste sous l'en-tête. Le nom du track devient le titre de la page
; ouvrir un channel en fait le titre à son tour, et le fil d'Ariane nomme alors le track avant lui.

- L'**ordre** des onglets est celui que l'administration a choisi. Un channel **archivé** n'apparaît pas.
- L'onglet **ouvert** se signale par un libellé bleu et un soulignement, jamais par la couleur seule.
- Chaque onglet porte, devant son nom, une **pastille de la couleur de son channel**. Elle se choisit dans le
  formulaire du channel ([section 17.2](#un-channel)) et ne change pas quand l'onglet est ouvert.
- Sur un écran étroit, la barre **défile horizontalement** plutôt que de tronquer les noms. Une ombre au bord indique
  qu'il reste des onglets à voir de ce côté.
- **« Nouveau channel »**, après les onglets, crée un channel **sans quitter le track**. Le formulaire s'ouvre en haut de
  la page — nom, identifiant d'adresse proposé depuis le nom, workflow, description —, le tableau restant visible
  dessous. **Créer** ouvre aussitôt le tableau du nouveau channel ; **Annuler** ou la touche `Échap` referment le
  formulaire sans rien créer. Un rechargement de la page garde le formulaire ouvert. Seul un administrateur de l'espace
  peut créer un channel : pour un autre compte, le refus s'écrit dans le formulaire, sa saisie conservée.
- **« Coûts »**, en dernier, ouvre les coûts du track
  ([chapitre 24](#les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense)).

Le contenu d'un channel se lit de **deux façons**, et une bascule en haut de la page passe de l'une à l'autre : le
**tableau kanban** ([section 9.10](#le-tableau-kanban-d-un-channel)), vue par défaut, et la **vue liste**
([section 9.11](#la-vue-liste-d-un-channel)). Chacune a sa propre adresse, qui se partage et se met en favori.

Trois écrans particuliers :

- un track **sans channel** affiche « Aucun channel dans ce track » : « Un channel se crée avec « Nouveau channel »,
  dans la barre d'onglets ci-dessus. » ;
- un channel dont le workflow **n'a aucune étape** n'a pas de tableau : « Ce workflow ne déclare aucune étape », avec le
  lien **« Ouvrir l'éditeur de workflows »** ([chapitre 18](#composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire)) ;
- une adresse qui ne correspond à **aucun track**, ou à un track auquel vous n'avez pas accès, affiche « Track
  introuvable ». Les deux cas produisent le **même** message : il ne renseigne personne sur l'existence d'un track
  qu'il n'a pas le droit de voir.

### 3.5 Les accès par track et par channel

Votre accès à un track ou à un channel découle d'abord de votre **rôle dans l'espace** : une administratrice
administre, un business developer travaille, une lectrice consulte. Un administrateur peut ensuite poser, pour une
personne et sur un track ou un channel précis, un **droit fin** qui le restreint ou le rouvre — **Membre** (lecture et
écriture), **Lecture**, ou **Aucun accès** ([section 21.6](#les-droits-fins-restreindre-ou-rouvrir-un-track-ou-un-channel)).

Ce que vous en voyez :

- **Le droit le plus précis l'emporte** : celui d'un channel sur celui de son track, celui d'un track sur votre rôle.
  On peut vous fermer un track et vous en rouvrir un seul channel : vous voyez alors le nom du track, pour atteindre ce
  channel, et rien d'autre de ce track.
- **Ce qui vous est fermé n'apparaît pas comme « interdit » : il n'apparaît pas.** Un libellé « accès refusé »
  révélerait l'existence d'une activité que vous n'avez pas à connaître.
- **Sur un onglet en lecture**, les commandes qui modifieraient les affaires restent visibles, grisées, et un bandeau
  dit pourquoi ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)).
- **Un administrateur n'est jamais restreint**, même si un droit fin a été posé sur son compte.

### 3.6 La description d'un track, d'un channel ou d'une affaire, au survol

Un track, un channel et une affaire peuvent porter une **description** : un texte libre qui dit à quoi sert l'activité,
ce que regroupe le channel, ou ce que recouvre l'affaire. Celle d'un track et d'un channel se saisit dans **Réglages ▸
Arborescence**, champ « Description » du formulaire.

Quand une description existe, elle paraît dans une **infobulle** :

- **au survol de la souris**, après un court instant, sur la pilule du track dans la barre latérale, sur l'onglet du
  channel, et sur le titre de l'affaire — dans sa carte du tableau comme dans sa ligne de la vue liste ;
- **au clavier**, dès que l'élément reçoit le focus par la touche `Tab`.

La bulle écrit d'abord le **nom**, puis la description, avec ses retours à la ligne ; une description très longue
défile à l'intérieur. Vous pouvez y amener la souris pour la lire : elle reste ouverte tant que le pointeur est sur
l'élément ou sur elle. `Échap` la ferme ; un clic sur l'élément l'ouvre, sans laisser de bulle.

**Sans description, rien ne change** : aucune bulle, et le nom complet reste lisible au survol. Un lecteur d'écran
annonce la description avec le nom de l'élément.

**Ce qui n'est pas proposé** : sur un écran tactile, il n'y a pas de survol, et toucher l'élément l'ouvre ; la
description n'y paraît pas en bulle. La description d'une affaire ne se saisit pas encore depuis l'écran.

### 3.7 Replier la barre latérale

Le bouton en haut de la barre latérale la replie en colonne d'icônes, et la déplie à nouveau. Ce choix vaut **pour la
session en cours** : il est oublié à la fermeture de l'onglet, et rien n'est conservé sur votre appareil.

Sur un écran étroit, la barre latérale devient un **tiroir** : le bouton en haut à gauche de l'en-tête l'ouvre, la
croix ou la touche `Échap` la referme.

### 3.8 Naviguer au clavier

L'application s'utilise entièrement au clavier :

- la première tabulation fait apparaître le lien **« Aller au contenu »**, qui saute la navigation ;
- les tabulations suivantes parcourent le bouton de repli, puis les entrées de la barre latérale ;
- `Entrée` active l'élément qui a le focus ;
- l'élément qui a le focus est toujours entouré d'un liseré bleu visible.

### 3.9 L'aide : le manuel, depuis n'importe quel écran

L'icône **« Aide »** de l'en-tête — un livre ouvert, à gauche de la cloche — ouvre un petit panneau :

- **« Aide sur cet écran »** mène à la section du manuel qui décrit la page où vous êtes ; le lien porte le titre de
  cette section ;
- **« Sommaire du manuel »** mène à la liste de tous les chapitres.

Un écran que le manuel ne décrit pas en propre — l'index des réglages, par exemple — n'offre que le sommaire.

Le panneau se referme par **« Fermer l’aide »**, par la touche `Échap` — le focus revient alors sur l'icône —, par un
clic ailleurs, ou en suivant l'un de ses liens. Au clavier, ouvrir le panneau place le focus sur son premier lien.
Ouvrir l'aide referme les notifications, et inversement : un seul panneau de l'en-tête est ouvert à la fois.

**Le sommaire** liste chaque chapitre et ses sections, chacun cliquable. **Un chapitre** s'ouvre sur « Dans ce
chapitre », la liste de ses sections, et se termine par deux liens, **« Chapitre précédent »** et **« Chapitre
suivant »**. Les renvois d'un chapitre à l'autre sont des liens. Une illustration large propose **« Voir en taille
réelle »**, qui l'ouvre dans un nouvel onglet.

Le manuel n'est lisible qu'avec une session : sans session, ses adresses mènent à l'écran de connexion. Si le manuel ne
peut pas être lu, la page le dit — « Le manuel n’a pas pu être chargé » — et propose **« Réessayer »** ; un chapitre qui
n'existe pas affiche « Chapitre introuvable » et un lien vers le sommaire.

### 3.10 Quand quelque chose ne va pas

| Ce qui s'affiche | Ce que cela signifie | Ce que vous pouvez faire |
|---|---|---|
| Barres grises animées | Les données sont en cours de chargement | Patienter |
| « Aucun … » | Il n'y a rien à afficher pour vous | Rien : ce n'est pas une erreur |
| « Chargement impossible » | Le serveur n'a pas répondu | **Réessayer** : le bouton relance la lecture sans recharger la page |
| « Accès refusé » | Votre compte n'a pas les droits nécessaires | Demander l'accès à un administrateur de l'espace |
| « Configuration incomplète » | L'application a été installée sans l'adresse de son serveur | Prévenir la personne qui l'a installée |

En cas de panne du serveur, l'application **réessaie trois fois** avant d'afficher l'erreur : le message peut donc
mettre quelques secondes à apparaître.

### 3.11 Les commandes grisées : ce que votre rôle vous laisse faire

Le produit ne vous propose pas un geste que le serveur vous refuserait. Une commande que vous ne pouvez pas utiliser
**reste à sa place, grisée**, et un **bandeau** — une icône en forme d'œil sur fond gris clair — dit en tête du bloc
pourquoi : « Vous consultez … : les commandes restent visibles mais sont inactives. » Un seul bandeau par bloc ;
chaque commande grisée y renvoie, et un lecteur d'écran le lit quand elle a le focus.

Trois choses décident de ce que vous pouvez faire :

| Ce que vous voulez faire | Il faut | Exemples |
|---|---|---|
| Administrer l'espace | être **administrateur** de l'espace | l'arborescence, les workflows, le catalogue, les budgets, le coût du personnel, la boîte système |
| Éditer le carnet et les modèles | être administrateur ou **business developer** | créer ou modifier un contact, un modèle d'email, une séquence de relance |
| Travailler une affaire | pouvoir **écrire sur son onglet** | créer, modifier, déplacer, endormir une affaire ; ses contacts, ses coûts, ses commentaires, ses envois |

Le troisième suit les **accès par track et par channel** ([section 3.5](#les-acces-par-track-et-par-channel)) : un
business developer peut être limité à la lecture sur un onglet, et une lectrice rouverte en écriture sur un autre.

**Ce qui n'est jamais grisé** : ce qui ne regarde que vous — vos préférences de notifications, votre propre boîte de
réception et vos propres identités d'expédition, la saisie de votre temps.

**Juste après l'ouverture d'un écran**, le temps que vos droits soient lus, les commandes peuvent être grisées un
instant **sans bandeau** : rien n'est encore refusé. Si vos droits ne peuvent pas être lus — une coupure réseau —, les
commandes restent offertes, et c'est la réponse du serveur qui s'affiche si vous tentez un geste.

**Le serveur reste la seule règle.** Griser une commande vous évite un geste voué au refus ; cela ne protège rien à soi
seul. Si vos droits changent pendant que vous travaillez, le serveur refuse, et l'écran affiche son refus.

Dans **Réglages**, l'entrée « Coût du personnel » devient un texte grisé si vous n'administrez pas l'espace : son écran
vous serait refusé. Les autres écrans d'administration restent ouverts **en lecture** : vous y voyez la configuration,
commandes grisées.

## 4. Retrouver n'importe quoi : la recherche

**La recherche cherche partout à la fois**, depuis n'importe quel écran, sans le quitter : une affaire, un contact,
une organisation, un commentaire ou un message dont vous ne savez plus où il se trouve.

### 4.1 L'ouvrir

Trois chemins, et ils mènent au même endroit :

- le raccourci **`Cmd + K`** sur Mac, **`Ctrl + K`** ailleurs. Il fonctionne **partout**, y compris
  pendant que vous écrivez un commentaire ;
- un clic dans le champ **« Rechercher… »**, en haut de l'écran ;
- sur un écran étroit, le bouton en forme de loupe, à la même place.

Le raccourci est rappelé **dans le champ lui-même** : il n'y a rien à apprendre par cœur.

**Appuyer une seconde fois ne referme pas la recherche** : le texte déjà tapé est simplement
sélectionné, prêt à être remplacé. Pour refermer, appuyez sur **`Échap`**, ou cliquez ailleurs.

### 4.2 Ce qu'elle cherche

Cinq familles d'objets, dans la même frappe :

| Famille | Ce qui est cherché |
|---|---|
| **Affaire** | son titre |
| **Contact** | son nom, sa fonction, son adresse email |
| **Organisation** | son nom, son domaine |
| **Commentaire** | le texte du propos |
| **Message** | l'objet, le corps, l'expéditeur |

Chaque résultat porte **le nom de sa famille en toutes lettres**, puis ce qui l'identifie et le
contexte où il vit — le channel d'une affaire, l'organisation d'un contact, l'auteur d'un
commentaire. Pour un commentaire et un message, un **extrait du passage trouvé** est affiché.

### 4.3 Ce qu'elle comprend, et ce qu'elle ne comprend pas

- **Il suffit de commencer un mot** : « audi » trouve déjà « Audit sécurité applicative ».
- **Les accents ne comptent pas, dans les deux sens** : « creance » trouve « créance », et
  « créance » trouve « creance ».
- **Deux mots saisis doivent être présents tous les deux.** « audit sécurité » ne rend pas tout ce
  qui contient « audit ».
- **Aucune tolérance à la faute de frappe.** « audti » ne trouve rien. La recherche cherche des
  mots, elle ne les devine pas.
- **Ce qui est à la corbeille ne se cherche pas**, y compris les commentaires d'une affaire mise à
  la corbeille.

### 4.4 La parcourir au clavier, et y aller

La main ne quitte pas le clavier :

| Touche | Effet |
|---|---|
| **`↓`** | descend d'un résultat ; du dernier, revient au premier |
| **`↑`** | monte d'un résultat ; du premier, va au dernier |
| **`Entrée`** | ouvre le résultat en surbrillance |
| **`Échap`** | referme la recherche |
| **`Tab`**, **`Maj+Tab`** | quittent la recherche, qui se referme ; le curseur va où la touche l'envoie |

Un clic sur une ligne fait la même chose que `Entrée`.

**Où chaque famille vous mène** :

| Famille | Destination |
|---|---|
| Affaire | sa fiche |
| Commentaire | **la fiche de l'affaire commentée**, où le propos se lit dans le fil |
| Contact | sa fiche |
| Organisation | sa fiche |
| Message | **votre boîte, le message ouvert**, dans le dossier où il est classé |

**Un message vous mène au message, pas seulement à votre boîte.** Le dossier est celui de son
affaire quand il est classé, et **« Non classés »** quand il ne l'est pas — vous arrivez donc là où
le message se trouve réellement, sans avoir à le retrouver dans la liste.

L'adresse qui vous y a mené **ne reste pas dans la barre du navigateur** : recharger la page vous
laisse dans votre boîte, sans rouvrir un message que vous aviez peut-être quitté depuis longtemps.
Et si le message n'existe plus, ou s'il ne vous est pas lisible, **votre boîte s'ouvre simplement
sans sélection** — aucune erreur ne s'affiche.

### 4.5 Vous ne trouvez que ce que vous avez le droit de lire

**La recherche n'ouvre rien.** Une affaire d'un track qui ne vous est pas ouvert, son commentaire,
un message que vous ne pouvez pas lire : rien de tout cela n'apparaît, et **rien ne signale que
quelque chose vous est caché**. Deux personnes cherchant le même mot ne voient donc pas
nécessairement la même liste, et c'est voulu.

### 4.6 Ce que la recherche affiche, et ce qu'elle ne fait pas

- **Au plus vingt résultats**, et quand la liste est pleine elle l'écrit : « 20 résultats
  affichés ». Précisez votre terme pour en voir d'autres.
- **L'ordre est celui de la pertinence**, familles mêlées : un message peut passer devant une
  affaire s'il correspond mieux.
- **Rien n'est enregistré** : ni ce que vous cherchez, ni quand, ni combien de résultats. Il n'y a
  pas d'historique de recherche.
- **Aucun filtre par famille**, aucune suggestion, aucune correction de frappe.
- **Aucune action sur un résultat** : la recherche mène, elle n'agit pas.
- **Les tracks et les channels ne sont pas cherchés.** On les trouve par la navigation, qui les
  liste tous à l'écran.
- **Un résultat dont l'écran n'est pas atteignable reste affiché**, marqué « Objet non
  atteignable » et non cliquable — plutôt que de disparaître ou de mener à un écran cassé.
- **Sans être connecté, la recherche n'existe pas** : aucune page ne s'affiche sans session
  ([chapitre 1](#se-connecter-et-se-deconnecter)).

## 5. Vos notifications : savoir qu'on vous a nommé

**Où.** En haut à droite de chaque écran, la **cloche**, entre l'icône « Aide » et votre nom. Elle est visible partout,
parce qu'une notification n'est pas une destination : on y jette un œil et l'on retourne à ce qu'on faisait.

**Qui.** Chacun voit **ses** notifications, et elles seules. Personne d'autre — ni un collègue, ni
un administrateur de l'espace de travail. La boîte de quelqu'un n'est pas une donnée
d'exploitation. Sans session ouverte, aucune page ne s'affiche, cloche comprise.

### 5.1 Ce que la cloche annonce

Le chiffre posé sur la cloche compte vos notifications **non lues**, jamais le total : une cloche
qui afficherait « 12 » sur douze messages tous lus ne dirait rien d'utile.

- **Aucun chiffre** signifie l'une de deux choses, et jamais « zéro par défaut » : soit vous n'avez
  rien de non lu, soit le compte n'a pas encore été mesuré. Dans le second cas, la cloche
  s'annonce simplement « Notifications », sans prétendre que tout est lu.
- **Au-delà de quatre-vingt-dix-neuf**, la cloche écrit « 99+ » — un badge à quatre chiffres la
  déformerait. Le compte **exact** reste annoncé aux lecteurs d'écran.

### 5.2 Ce que le panneau montre

Un clic — ou `Entrée` au clavier — ouvre le panneau **sous la cloche**, sans quitter l'écran où
vous êtes. `Échap`, un clic à l'extérieur, ou « Fermer les notifications » le referment ; le focus
revient alors à la cloche. Ouvrir les notifications referme le panneau d'aide, et inversement.

Chaque ligne porte :

- **qui vous a nommé**, avec son avatar — « Camille Aubert vous a mentionné » ;
- **ce qui a été écrit**, en extrait ;
- **l'affaire concernée**, dont le titre est un lien vers sa fiche ;
- **le dossier**, en pastille « Track › Channel », qui mène au channel ;
- **la date et l'heure**, absolues.

Une **ligne non lue** porte un liseré bleu à gauche et son libellé en gras. L'ordre est celui de
l'arrivée : **le plus récent en haut**. C'est l'inverse du fil de discussion d'une affaire, où la
conversation se lit dans le sens où elle s'est tenue ; une boîte de réception, elle, se lit en
commençant par ce qui vient d'arriver. **Les non-lues ne remontent pas en tête** : une ligne qui
sauterait au moment où vous la marquez vous la ferait perdre de vue.

**Une ligne dont le propos n'est plus lisible garde sa place**, avec son affaire, sa date et son
lien, mais sans auteur ni extrait. Le produit ne dit alors ni que le message a été supprimé, ni que
vous n'y avez plus accès : les deux causes sont indistinguables, et les nommer divulguerait la
seconde.

### 5.3 Marquer lu, et marquer non lu

Le bouton en bout de ligne bascule l'état, **dans les deux sens** : on ouvre une notification par
mégarde, et une boîte dont on ne peut pas remettre un message de côté n'est pas une boîte.

**Suivre le lien d'une affaire ne marque rien.** Ce sont deux gestes distincts : fondre les deux
ferait disparaître du compteur une notification que vous avez seulement effleurée en visant autre
chose.

La ligne ne change qu'**après** la réponse du serveur. Si vos droits ont changé depuis l'ouverture
du panneau, le produit écrit « Aucune notification n'a été modifiée » et invite à recharger la
page — il n'annonce jamais une modification qui n'a pas eu lieu.

### 5.4 La mise à jour est immédiate

Le panneau et le compteur s'actualisent **sans rechargement** dès qu'une notification vous est
adressée. Le produit ne vous envoie **aucun email**, ne fait
sonner **aucun son** et ne modifie **pas** le titre de l'onglet.

### 5.5 Mentionner quelqu’un dans un commentaire

Sous la zone de saisie du fil d'une affaire, la commande **« Mentionner »** ouvre la liste des
personnes que ce commentaire peut prévenir. Cochez-en une ou plusieurs, écrivez votre message, et
publiez : chacune reçoit sa notification.

**Il n'y a pas de syntaxe à connaître.** Taper « @ » dans le texte ne fait rien : le produit ne lit
pas votre commentaire pour y deviner des noms. Vous choisissez explicitement qui vous prévenez, et
vous le voyez avant d'envoyer — la commande porte le nombre de personnes cochées, même repliée.

**La liste ne contient que les personnes qui peuvent lire cette affaire**, et elle **change d'une
affaire à l'autre** : un collègue proposé sur un dossier peut être absent d'un autre, parce que ses
droits ne sont pas les mêmes partout. Ce n'est pas l'écran qui décide — c'est la même règle
d'autorisation que partout ailleurs dans le produit.

**Vous n'y figurez jamais vous-même.** Se mentionner n'enverrait rien : vous savez déjà ce que vous
venez d'écrire.

**Si personne d'autre ne peut lire l'affaire**, la liste le dit en toutes lettres. Ce n'est pas une
panne : c'est un dossier dont vous êtes le seul lecteur.

**Quand une mention échoue, votre commentaire reste publié.** Le cas est rare — il faut qu'un droit
change entre le moment où vous ouvrez la liste et celui où vous publiez —, et le produit ne le
cache pas : un message sous le composeur **nomme la personne** qui n'a pas été prévenue et dit
pourquoi. Votre texte, lui, est bien en ligne : le retirer effacerait un propos que vous avez
réellement tenu. Les personnes qui n'ont pas pu être prévenues restent cochées, pour que vous
sachiez ce qu'il reste à faire.

**Mentionner est facultatif.** Un commentaire sans mention se publie exactement comme avant.

### 5.6 Choisir ce que vous recevez

*Réglages ▸ Notifications.*

C'est **votre** réglage : personne d'autre ne le voit, pas même l'administratrice de l'espace de
travail. C'est aussi la seule section des réglages qui règle votre compte plutôt que l'espace, et
c'est pourquoi elle vient en dernier dans la liste.

**Une case par type de notification**, cochée par défaut. Aujourd'hui il n'y en a qu'une :
« Recevoir les mentions ». Décochez-la, et les mentions cessent d'arriver dans votre cloche — le
compteur tombe, le panneau se vide, et rien ne s'affiche plus en direct.

**Rien n'est supprimé.** Les notifications continuent d'être produites et conservées : elles sont
simplement **masquées** tant que la case est décochée. Recochez-la, et tout revient — non lu, dans
l'ordre, exactement comme avant. C'est la différence entre couper le son et jeter le courrier.

**Il n'y a pas de bouton « Enregistrer ».** La case écrit dès que vous la basculez, et affiche
« Enregistré » sous elle. Elle ne se coche qu'**après** la confirmation du serveur : ce que vous
voyez est ce que le produit a réellement retenu, jamais ce qu'il a cru envoyer.

**Une chose à savoir**, parce qu'elle surprend : tant qu'un type est décoché, vous ne pouvez pas
marquer lues les notifications de ce type. Vous ne les voyez pas, donc vous ne les marquez pas ;
elles vous attendront, non lues, si vous recochez.

**Il n'y a qu'un seul canal, et l'écran n'en promet pas d'autre.** Le produit n'envoie aucune
notification par email, ni de résumé quotidien. Vous ne trouverez donc aucune case pour cela :
une case qui ne commande rien serait une promesse que le produit ne tiendrait pas.

### 5.7 Ce qui n'est pas encore là

- **Les mentions d'un commentaire déjà publié ne se corrigent pas.** On choisit avant de publier,
  pas après ; ni la liste des personnes nommées, ni leur retrait ne sont offerts par l'écran.
- **Le fil ne montre pas qui un commentaire mentionne.** La personne prévenue le voit dans sa
  cloche ; le commentaire, lui, ne l'affiche pas.
- **La liste des personnes n'a ni recherche ni pagination.**
- **Aucun canal en dehors de l'application** : ni email, ni résumé quotidien. Le [§5.6](#choisir-ce-que-vous-recevez) dit ce que
  vous pouvez régler, et ce qui n'existe pas.
- **La préférence vaut pour tous vos espaces de travail** : elle porte sur vous, pas sur un
  contexte. Vous ne pouvez pas couper les mentions d'un espace en les gardant dans un autre.
- **Aucune suppression, et aucune expiration.** Une notification ne s'efface pas. Le panneau montre
  les **vingt plus récentes**, et le dit en toutes lettres quand il en manque ; le compteur, lui,
  les compte toutes.
- **Aucun regroupement** : dix mentions sur la même affaire font dix lignes.
- **Aucun « tout marquer comme lu »** : un geste de masse ne saurait pas dire *lesquelles* n'ont pas
  bougé si vos droits ont changé, et le produit ne montre jamais une issue qu'il n'a pas mesurée.

## 6. Ma journée : ce qui est en retard, ce qui est dû aujourd'hui

L'entrée **Ma journée** de la barre latérale répond à une seule question : **que dois-je faire
aujourd'hui ?** Elle rassemble les affaires qui portent une **échéance** — la date de leur prochaine
action —, à travers tout votre espace de travail, sans avoir à ouvrir un dossier après l'autre.

C'est la troisième façon de lire vos affaires, et elle range par le **temps** :

- le **tableau** d'un channel les range par étape du processus — « où en est chaque affaire ? » ;
- la **vue liste** les range par leurs colonnes, dans un channel — « laquelle dois-je ouvrir ? » ;
- **Ma journée** les range par échéance, partout — « qu'est-ce qui est en retard ? ».

### 6.1 Les trois sections

L'écran se lit de haut en bas, en trois sections, et chacune écrit **combien** d'affaires elle
porte :

| Section | Ce qu'elle contient |
|---|---|
| **En retard** | Les échéances passées, **sans aucune limite d'ancienneté** — une échéance oubliée depuis trois mois est précisément celle qu'il faut voir |
| **Aujourd'hui** | Les échéances du jour, de minuit à minuit, dans le fuseau horaire de **votre** appareil |
| **À venir** | Les échéances des **sept prochains jours**, pas au-delà |

**Une section sans affaire n'est pas affichée.** Trois titres surmontant trois vides diraient trois
fois « rien » ; leur absence le dit une fois.

**L'horizon est de sept jours, et il n'est pas réglable.** Au-delà, ce ne serait plus une journée :
c'est la vue liste d'un channel, triée par échéance, qui répond à cette question-là.

### 6.2 Ce qu'une ligne montre

Chaque ligne porte, dans cet ordre : l'**échéance** avec son heure, le **titre** de l'affaire — qui
est un lien vers sa fiche —, la **prochaine action** à mener, et la **situation** de l'affaire sous
la forme « Track › Channel », elle-même un lien qui ouvre le dossier.

L'échéance vient en tête parce que c'est elle qui range l'écran : une colonne de dates alignées se
lit d'un seul regard. **L'heure est toujours affichée** — une échéance du jour sans heure ne dirait
pas si la matinée est déjà passée.

Dans la section **En retard**, et là seulement, l'échéance est teintée de rouge. La teinte porte sur
la **date**, jamais sur la ligne entière : une affaire en retard est un travail à faire, pas une
erreur.

**Une affaire peut porter une échéance sans prochaine action écrite.** La colonne reste alors vide —
ni tiret, ni « non renseigné ». L'échéance seule est déjà une information.

### 6.3 « Mes affaires » ou tout l'espace de travail

Deux onglets en haut de l'écran choisissent la **portée** :

- **Mes affaires**, la vue par défaut : les affaires dont **vous** êtes responsable ;
- **Tout l'espace de travail** : toutes celles que vos droits vous laissent lire.

Le choix vit dans l'**adresse** de la page : une adresse copiée à un collègue lui montre donc ce que vous voyez — sous
réserve de ses propres droits, qui restent seuls juges de ce qu'il peut lire.

**Élargir la portée n'ouvre rien.** Ce que vous voyez reste ce que le serveur vous consent : une
affaire d'un track qui vous est fermé n'apparaît dans aucune des deux portées, et l'écran ne la
nomme jamais.

### 6.4 Ce qui n'apparaît pas, et pourquoi

| Absent de l'écran | Motif |
|---|---|
| Les affaires **archivées** et celles **à la corbeille** | Elles ne sont plus en cours ([section 9.4](#archiver-n-est-pas-supprimer)) |
| Les affaires **en sommeil** | Les endormir est précisément le geste qui dit « pas aujourd'hui » ([section 9.13](#mettre-une-affaire-en-sommeil-et-la-retrouver)). Elles restent visibles dans leur tableau et leur vue liste, où une case à cocher les ramène |
| Les affaires **sans échéance** | Il n'y a rien à ranger dans une journée |
| Les échéances au-delà de **sept jours** | Voir l'horizon ci-dessus |

### 6.5 Ce que l'écran ne fait pas

**Il lit, il n'écrit pas.** Aucun bouton n'y reporte une échéance, ne coche « fait » ni ne saisit une
prochaine action. Ces deux valeurs se modifient à un seul endroit — l'**en-tête de la fiche** de
l'affaire ([section 9.6](#la-fiche-d-une-affaire-son-en-tete-son-formulaire-et-ce-qu-ils-montrent)) —, et le rester est ce qui évite deux façons de faire la même chose.

**Ce n'est pas un agenda** : ni créneau, ni durée, ni rendez-vous, ni récurrence. Une affaire porte
un instant, pas une plage.

**Ce n'est pas la liste des relances.** Une affaire peut stagner dans son étape au-delà de son seuil
de relance sans porter aucune échéance, et l'inverse. La **pastille d'ancienneté** du tableau
([chapitre 9.10](#le-tableau-kanban-d-un-channel)) répond à cette autre question.

### 6.6 Quand il n'y a rien

Deux messages, et ils ne disent pas la même chose :

- **« Aucune échéance dans votre journée »** — vous n'êtes responsable d'aucune affaire à échéance.
  L'écran offre alors le geste qui élargit la portée : *Voir tout l'espace de travail* ;
- **« Aucune échéance dans les 7 prochains jours »** — personne n'en a, parmi ce que vous pouvez
  lire. Il n'y a rien à élargir, et l'écran n'offre donc aucun bouton.

Sans session, la page ne s'affiche pas : son adresse mène à l'écran de connexion ([chapitre 1](#se-connecter-et-se-deconnecter)).

## 7. Les affaires figées : ce qui dort depuis trop longtemps

« Ma journée » vous dit ce qui est **dû**. Cet écran-ci vous dit ce qui **dort**. Les deux
questions se ressemblent et ne sont pas la même : une affaire peut porter une prochaine action à
demain et n'avoir pas bougé d'étape depuis six semaines. C'est pourquoi les deux entrées sont
voisines dans la barre latérale, dans cet ordre.

Vous y arrivez par **Affaires figées**, immédiatement sous *Ma journée*.

### 7.1 Ce qu'être « figée » veut dire

Une affaire est **figée** lorsqu'elle est restée dans son étape **au-delà du seuil de relance de
cette étape**. Ce n'est ni un jugement ni un score : c'est une durée comparée à un seuil.

Le seuil vient du **processus**, et il se lit en deux temps :

1. l'étape elle-même peut porter un seuil, réglé dans l'éditeur de workflows ([chapitre 18](#composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire)) ;
2. sinon, c'est celui du **nœud** du catalogue dont l'étape est une occurrence
   ([chapitre 19](#le-catalogue-de-noeuds-le-vocabulaire-de-vos-workflows)).

**Une étape sans seuil ne fige jamais ses affaires.** Personne n'a dit au bout de combien de temps
elle est en retard, et le produit n'invente pas ce chiffre. C'est souvent le cas des étapes terminales, comme
« Livré » ou « Perdu » : leurs affaires n'apparaissent alors jamais ici.

Le compte se fait en **jours révolus**, et la borne est **large** : une affaire qui atteint
exactement son seuil est figée, et son retard vaut alors zéro.

**Trois affaires ne sont jamais figées, quel que soit leur âge** :

- une affaire **archivée** — elle n'est pas en retard, elle est rangée ;
- une affaire **à la corbeille** — elle est sortie du produit ([chapitre 20](#la-corbeille-ce-qui-a-ete-retire-et-comment-le-rendre)) ;
- une affaire **en sommeil** — mettre en sommeil est précisément le geste qui dit « pas
  maintenant » ([chapitre 9.13](#mettre-une-affaire-en-sommeil-et-la-retrouver)), et la relancer annulerait le seul geste posé contre les
  relances. Une échéance de sommeil **échue** ne protège plus : l'affaire est réveillée de fait.

### 7.2 Ce que l'écran montre

Les affaires sont **groupées par dossier**, et les groupes sont rangés du **plus gros retard au
plus petit**. Chaque titre de groupe porte son compte entre parenthèses.

Une ligne se lit de gauche à droite :

| Élément | Ce qu'il dit |
|---|---|
| **35 j** | le retard, en jours, sur fond rouge pâle |
| **le titre** | un lien vers la fiche de l'affaire |
| **Négociation** | l'étape où l'affaire est restée |
| **seuil 5 j** | le seuil de cette étape, sans lequel le retard n'a pas d'échelle |
| **Studio web › Refonte** | le dossier où elle vit ; un clic l'ouvre |

Le rouge porte sur le **retard seul**, jamais sur la ligne entière : une affaire figée est un
travail à faire, pas une erreur.

### 7.3 Deux personnes n'y lisent pas la même chose

L'écran ne montre que les affaires que **vos droits vous laissent lire**. Deux collègues ouvrant la
même page au même instant peuvent donc y voir des listes différentes, et c'est voulu : les droits
par track et par onglet ([chapitre 3.5](#les-acces-par-track-et-par-channel)) s'appliquent ici comme partout.

**L'écran ne dit jamais qu'il vous cache quelque chose.** Aucune mention « une affaire vous est
masquée » n'apparaît : ce serait divulguer par la bande l'existence de ce que vos droits ferment.

### 7.4 La relance inscrite dans l'affaire

Chaque nuit, le produit parcourt les affaires figées et inscrit dans l'historique de chacune une
ligne **« Relance automatique »**, avec son retard et son seuil au moment du passage. Vous la
trouvez dans le fil de la fiche ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)), dans la famille *Cycle de vie*.

**Au plus une par séjour dans une étape** : une affaire figée depuis six semaines ne reçoit pas
quarante-deux lignes. Si vous la déplacez puis qu'elle s'y rendort, une nouvelle relance est écrite
— elle y dort une seconde fois.

Cette ligne **n'a pas d'auteur** : personne ne l'a écrite, c'est l'horloge.

### 7.5 Ce que le produit ne fait PAS

- **Aucun email n'est envoyé par cette relance.** C'est un fait inscrit dans le produit, que vous rencontrez en
  l'ouvrant. Relancer par email est le rôle des **séquences**, qu'on arme sur la fiche d'une affaire figée
  ([chapitre 16](#enchainer-des-relances-les-sequences)) ;
- **aucune notification** ne vous prévient ;
- **aucune cadence n'est réglable** : le passage a lieu une fois par jour, et l'heure n'est pas un
  réglage du produit ;
- **l'écran n'écrit rien.** Ni « traité », ni report, ni mise en sommeil depuis cette liste : ces
  gestes vivent sur la fiche de l'affaire, et les dédoubler ici en ferait deux définitions du même
  geste.

### 7.6 Quand il n'y a rien

**« Aucune affaire figée »** — aucune affaire, parmi celles que vous pouvez lire, ne dort dans son
étape au-delà de son seuil. Le message ne propose aucun bouton, et ce n'est pas un oubli : il n'y a
rien à faire d'une liste vide, et c'est une bonne nouvelle.

Si la liste **n'a pas pu être lue**, l'écran le dit — « Les affaires figées n’ont pas pu être chargées » — et propose
**Réessayer**. Un écran vide et une panne ne se confondent jamais.

## 8. Les objectifs : le tableau blanc de l'équipe

L'entrée **Objectifs** de la barre latérale ouvre les **tableaux d'objectifs** de votre espace de travail. Un tableau est
un **tableau blanc** : vous y posez des **blocs** — un objectif chacun —, vous les reliez par des **flèches** pour dire ce
qui nourrit quoi, et vous indiquez sur chaque bloc où vous en êtes.

**Le remplissage d'un bloc est saisi à la main, jamais calculé.** Un bloc peut viser un channel, mais le produit ne
déduit rien des affaires de ce channel : c'est vous qui décidez de ce que le pourcentage signifie, et vous qui le
tenez à jour. La fiche du bloc le rappelle sous son remplissage.

### 8.1 La liste des tableaux

L'écran **« Tableaux d'objectifs »** liste les tableaux de l'espace dans leur ordre, chacun avec sa description et son
nombre de blocs. Cliquer sur le nom d'un tableau ouvre son canevas.

Un **administrateur** ou un **business developer** de l'espace administre les tableaux depuis cette liste :

- **« Créer un tableau »** ouvre un formulaire dans la page — un **Nom**, obligatoire et unique dans l'espace, et une
  **Description** facultative ;
- **« Renommer »** change le nom et la description d'un tableau ;
- **« Monter »** et **« Descendre »** changent son rang, d'un cran à la fois ;
- **« Archiver »** retire un tableau de la liste, après une confirmation qui le nomme. Rien n'est perdu : la case
  **« Afficher les archivés »** le fait reparaître avec la mention **« Archivé »** et la seule commande
  **« Désarchiver »**. Un tableau archivé garde son nom : un autre tableau ne peut pas le prendre tant qu'il existe.

Pour un autre compte, le serveur refuse ces gestes, et l'écran le dit sous la commande : *« Vous ne pouvez pas
administrer les tableaux de cet espace de travail. »*

### 8.2 Le canevas

Le canevas d'un tableau se **déplace** — faites-le glisser — et se **zoome** avec les boutons **« Réduire le canevas »**
et **« Agrandir le canevas »**, la valeur courante affichée entre les deux. **« Retour aux tableaux »** ramène à la
liste.

Chaque **bloc** porte son **titre**, deux lignes de son **corps** s'il en a un, sa **jauge** — « Remplissage 40 % », par
exemple — et, s'il vise un channel, une **pilule « Track › Channel »** : cliquer dessus **ouvre le channel**. Une
**flèche** relie deux blocs ; elle a un sens — du départ vers l'arrivée, de l'arrivée vers le départ, ou dans les deux
sens — et parfois un libellé, posé en son milieu.

Sous le canevas, **« Liens du diagramme »** donne l'équivalent textuel de toutes les flèches, une par ligne — c'est ce
que lit un lecteur d'écran, et c'est la façon la plus sûre de vérifier ce qui relie quoi.

**Ce que vous ne voyez pas, et pourquoi.** Un bloc qui vise un channel que vous n'avez pas le droit de lire **n'est pas
affiché du tout** ; ses flèches sont dessinées en pointillés vers le vide, et la liste textuelle les écrit vers une
**« extrémité hors de portée »**. L'écran ne nomme jamais ce qu'il vous cache. Un bloc dont le channel a été **mis à la
corbeille** reste affiché, sans pilule, avec la mention **« Lien perdu »** : reposez-lui un lien. Si le channel a été
**détruit** définitivement, le bloc redevient un bloc libre, sans mention — rien ne permet plus de savoir qu'il visait
un channel.

### 8.3 Poser, déplacer et modifier un bloc

**« Poser un bloc »** fait apparaître un repère : cliquez sur le canevas à l'endroit voulu, ou, au clavier, déplacez le
repère avec les flèches, validez par Entrée et annulez par Échap. Le bloc naît avec un titre provisoire, et sa fiche
s'ouvre pour que vous le nommiez.

Un bloc se **déplace** et se **redimensionne** à la souris — en le faisant glisser, ou par sa poignée d'angle — ou au
clavier, le bloc ayant le focus : les flèches le déplacent, **Maj** et les flèches l'ajustent au pixel, **Alt** et les
flèches le redimensionnent. **Entrée** ouvre sa **fiche** :

- **Titre** — obligatoire : un bloc sans titre ne se lit pas ;
- **Corps** — facultatif ; deux lignes en sont rendues sur le bloc ;
- **Couleur** — Bleu, Vert, Jaune, Rouge ou Gris ;
- **Remplissage** — au curseur, ou en pourcentage, de 0 à 100 ;
- **Channel visé** — facultatif. **« Retirer le lien »** l'enlève. Viser un channel demande le droit d'**écrire** sur
  ce channel : le produit refuse un lien vers un channel où vous ne faites que lire.

Chaque champ s'enregistre de lui-même et dit **« Enregistré »** ; **« Fermer la fiche »** ou Échap la referment.

### 8.4 Tracer et supprimer une flèche

**« Tracer une flèche »**, puis cliquez sur le bloc de départ et sur celui d'arrivée — ou, au clavier, **Espace** sur le
bloc de départ, puis Entrée ou Espace sur le second. Le bloc de départ, Échap ou le bouton annulent le tracé. Une
flèche relie deux blocs **du même tableau**, jamais un bloc à lui-même, et **une seule** flèche joint deux blocs donnés.
Dans « Liens du diagramme », chaque flèche porte un sélecteur de **direction** et la commande **« Supprimer la
flèche »**.

### 8.5 Supprimer un bloc

**« Supprimer le bloc »**, au bas de sa fiche, demande une confirmation qui nomme le bloc et compte les flèches qui
partiront avec lui ; **« Supprimer définitivement »** l'efface. **Un bloc supprimé ne se restaure pas**, une flèche non
plus — contrairement à un tableau, qui s'archive.

### 8.6 Qui peut écrire

**Tout membre de l'espace lit les tableaux.** Les **administrateurs** et les **business developers** de l'espace les
administrent et les composent ; pour un autre compte, le canevas affiche : *« Vous consultez ce tableau. Vous n'avez
pas le droit d'y écrire : les commandes de modification restent visibles mais sont inactives. »* — et la fiche d'un
bloc s'ouvre en lecture. C'est le serveur qui décide : un refus de dernière minute est dit sous la commande, sans que
rien ne soit écrit.

### 8.7 Quand il n'y a rien

**« Aucun tableau d'objectifs »** — l'espace n'en a pas encore ; « Créer un tableau » reste offert à qui peut écrire.
**« Aucun objectif sur ce tableau »** — posez un premier bloc. **« Tableau introuvable »** — l'adresse ne mène à aucun
tableau que vous puissiez lire, ou il est archivé. Si les tableaux **n'ont pas pu être chargés**, l'écran le dit et
propose « Réessayer ».

L'assistant connecté par le **connecteur MCP** lit et compose aussi les canevas, dans vos droits ([chapitre 33](#le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant)).

## 9. L'affaire : ce qu'elle porte, son adresse, ses deux façons de disparaître

L'**affaire** — appelée *card* dans le produit — est l'objet autour duquel tout le CRM s'organise :
une opportunité, un dossier, un projet. Elle vit dans un onglet (channel), à une étape du workflow
que cet onglet suit, et c'est à elle que se rattacheront les commentaires, les documents et les
échanges de messagerie.

### 9.1 Ce qu'une affaire porte

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

**Les deux scores de santé.** Une affaire ouverte porte deux notes sur 100, calculées par le produit à chaque lecture —
vous n'avez rien à saisir, et elles sont toujours à jour. Elles s'affichent en pastilles sur la carte du board, et en
détail sur la fiche, dans le bloc « Santé de l'affaire ». Chacune est **saine** à partir de 70 (vert), **à surveiller**
de 40 à 69 (jaune) et **en danger** sous 40 (rouge) ; le palier est toujours écrit en toutes lettres, pas seulement
colorié.

- **La dynamique dit quoi faire.** Elle part de 100 et retire des points, chacun affiché avec sa raison : étape figée au
  delà de son seuil de relance (−30), prochaine action en retard (−25) ou absente (−15), aucun contact depuis plus de 14
  jours (−20) ou plus de 30 jours (−30). Un contact, c'est une activité consignée ou un email classé dans l'affaire ; une
  affaire jamais contactée compte depuis sa création.
- **La santé commerciale dit les chances de gagner.** C'est une moyenne de quatre signaux, chacun noté sur 100 et
  affiché avec son poids : la probabilité de l'étape (40 %), la fraîcheur du dernier contact (25 % — pleine jusqu'à 7
  jours, nulle à 30), la ponctualité de la prochaine action (20 % — datée dans le futur 100, sans date 60, absente 30, en
  retard 0) et l'ancienneté dans l'étape rapportée à son seuil (15 %). Un signal qu'on ne peut pas mesurer — aucune
  probabilité, aucun seuil — est écrit « inconnu », et son poids se répartit sur les autres au lieu de compter pour zéro.
- **Une affaire gagnée, perdue, archivée ou à la corbeille n'a pas de score.** Une affaire en sommeil garde les siens.
- Un assistant connecté par le connecteur lit les mêmes scores ([chapitre 33](#le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant)).

### 9.2 L'adresse email de l'affaire

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

### 9.3 Faire avancer une affaire : ce que le produit autorise, et ce qu'il refuse

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
   l'affaire affiche *Étape franchie*, avec les deux étapes ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)). Cette trace ne peut
   être ni fabriquée, ni corrigée, ni effacée.
2. **Le motif que vous donnez est conservé, et il l'est comme un commentaire.** Depuis le
   2026-08-14, la raison que vous écrivez au moment du déplacement apparaît dans le fil de
   l'affaire, signée de votre nom et datée, exactement comme si vous l'aviez publiée vous-même
   ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)). Vous pouvez donc la corriger ou la retirer ensuite, comme n'importe lequel de
   vos commentaires.

   Trois précisions utiles. Le motif est enregistré **en même temps** que le déplacement : si l'un
   échoue, l'autre n'a pas lieu, et vous ne verrez jamais une affaire déplacée sans sa raison. Un
   motif est conservé **même lorsque le déplacement ne l'exigeait pas** — commenter un passage
   d'étape volontairement est donc utile. Enfin, un motif est un commentaire : il fait au plus
   **10 000 caractères**, et un motif fait uniquement d'espaces, de tabulations ou de tout autre
   blanc est refusé comme s'il était absent.

   Le motif n'apparaît pas dans la ligne d'historique *Étape franchie* : il vit **une seule fois**,
   dans la discussion, et non recopié dans la trace.

**Ce geste a désormais son écran** : le tableau kanban du [chapitre 9.10](#le-tableau-kanban-d-un-channel), à la souris comme au
clavier. La règle décrite ici lui préexiste et ne dépend pas de lui — c'est volontaire, l'interface
ne fait qu'exercer une garde qui tient de toute façon si l'on s'adresse directement à l'API.

### 9.4 Archiver n'est pas supprimer

Une affaire a **deux** façons de quitter votre vue, et elles ne veulent pas dire la même chose.

| Geste | Ce que cela signifie | Réversible |
|---|---|---|
| **Archiver** | Le dossier est clos, et vous le conservez | Oui |
| **Mettre à la corbeille** | C'était une erreur de saisie, vous l'effacez | Oui |

Aucune suppression définitive n'existe : le produit n'en expose aucune, à personne, pas même à une
administratrice. Ce qu'il appelle « supprimer » est toujours une date posée sur la ligne, que l'on
peut retirer.

**Une affaire archivée ou en corbeille n'occupe plus son étape.** C'est ce qui permet d'archiver un
état du catalogue ([chapitre 19](#le-catalogue-de-noeuds-le-vocabulaire-de-vos-workflows)) une fois que toutes les affaires qui s'y trouvaient ont été closes.
À l'inverse, un état qu'une affaire **active** occupe encore ne peut pas être archivé : le produit
refuse, plutôt que de faire disparaître une colonne du tableau sous les affaires qu'elle contient.

### 9.5 Qui peut faire quoi

- **Voir** les affaires d'un onglet suppose le droit de lire cet onglet. Les accès par track et par
  channel du [§3.5](#les-acces-par-track-et-par-channel) s'appliquent **dès la première affaire** : une restriction `Aucun accès`
  masque les affaires comme elle masque l'onglet, et un accès `Membre` posé sur un onglet les rouvre
  même si le track est fermé.
- **Créer et modifier** une affaire suppose le droit d'**écriture** sur l'onglet. Une personne en
  lecture seule voit les affaires et ne peut pas les toucher : les commandes sont grisées, et un
  bandeau en tête de l'onglet et de la fiche dit pourquoi ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)).
- **Déplacer** une affaire vers un onglet où vous n'avez pas le droit d'écrire est refusé, même si
  vous aviez le droit d'écrire là où elle se trouvait.

### 9.6 La fiche d'une affaire : son en-tête, son formulaire, et ce qu'ils montrent

Une affaire s'ouvre depuis sa carte du tableau, sa ligne de la vue liste, ou tout lien qui la nomme ; son adresse se
partage. Cet écran affiche à gauche **l'en-tête de l'affaire** puis le **formulaire de l'étape où elle se
trouve**, et à droite son **historique et sa discussion** ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)).

**L'en-tête, en haut de la colonne de gauche**, dit ce que l'affaire *est* :

- son **titre** ;
- son **responsable**, avec son avatar. Lorsqu'aucune personne n'en est responsable, l'écran l'écrit
  — « Aucun responsable » — plutôt que de laisser un blanc ;
- son **montant** et sa devise, lorsqu'un montant est renseigné. Sinon la ligne n'apparaît pas : une
  affaire qui débute n'est pas encore chiffrée, et un tiret se lirait comme une valeur ;
- sa **prochaine action** et son échéance, aux mêmes conditions ;
- son **adresse email** ([chapitre 9.2](#l-adresse-email-de-l-affaire)), avec le bouton **« Copier l'adresse »** et la phrase qui en
  dit l'usage. Le bouton confirme la copie par « Copié » pendant deux secondes ; si votre navigateur
  la refuse — cela arrive hors connexion sécurisée —, l'écran vous dit de sélectionner l'adresse à
  la main plutôt que de faire comme si la copie avait eu lieu ;
- la mention **« Archivé »** lorsque l'affaire est archivée ([chapitre 9.4](#archiver-n-est-pas-supprimer)). Sa fiche reste
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
- **changer le responsable apparaît dans l'historique** de l'affaire ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)), sous la forme
  « Responsable modifié ». Les autres champs ne laissent pas de trace dans ce fil.

Le formulaire de l'étape, lui, s'enregistre de la même façon, question par question.

Ce que vous y voyez :

- **les questions de l'étape courante**, dans l'ordre que l'administration leur a donné. Une
  question sans réglage particulier est **affichée** : c'est la valeur par défaut, et elle évite de
  devoir déclarer une règle par étape pour les questions courantes ;
- **une étoile et la mention « Requis à l'étape <étape> »** sur les questions obligatoires : l'étape
  nommée est celle où se trouve l'affaire, dont la règle exige la question. Elle porte le même nom
  que sur le board : celui que l'administration a donné à l'étape dans ce workflow, s'il en a un.
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

- **La liste des contacts** est celle du carnet ([chapitre 10](#le-carnet-de-contacts)), avec l'organisation à côté du
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
([chapitre 9.10](#le-tableau-kanban-d-un-channel)). Le message de refus les nomme, et il porte désormais un lien **« Renseigner ces
champs »**. Il ouvre la fiche de l'affaire, et cette fiche :

- **affiche les questions concernées, même celles que l'étape courante ne montre pas d'habitude.**
  C'est le point important : une question comme « Motif de la perte » est normalement masquée tant
  que l'affaire n'est pas perdue, et elle n'apparaissait donc nulle part au moment où on vous la
  demandait. Elle est maintenant affichée et **saisissable**, parce que le déplacement l'exige ;
- **les met en évidence** par un liseré bleu et la mention **« Exigé par le déplacement que vous
  avez demandé »**, écrite en toutes lettres à côté de la question ;
- **vous amène directement à la première**, qui reçoit le curseur : vous pouvez saisir sans chercher
  ni faire défiler, y compris au clavier.

Une question déjà obligatoire à l'étape courante garde sa mention « Requis à l'étape … » **en
plus** : les deux phrases disent des choses différentes, et les deux sont vraies.

*Ce que ce lien ne fait pas :* il **ne rejoue pas** le déplacement. Une fois les réponses saisies,
revenez au board et refaites votre geste. Et la mention ne nomme pas l'étape vers laquelle vous
vouliez aller : la fiche ne la connaît pas, et le produit préfère ne rien dire plutôt que de
deviner.

**Un second geste y est offert : mettre l'affaire à la corbeille** ([chapitre 9.15](#mettre-une-affaire-a-la-corbeille)).

Une card que votre compte ne peut pas lire — ou qui n'existe pas — affiche « Card introuvable » :
c'est le refus réel du serveur. Une card consentie ouvre sa fiche et son fil. Sans connexion,
l'adresse mène à l'écran de connexion, qui y ramène une fois connecté.

### 9.7 Les contacts d'une affaire : les rattacher, les détacher

**Où.** Dans la colonne de gauche de la fiche, **entre le formulaire et le bouton de mise à la
corbeille** : le bloc **« Contacts de l'affaire »**. Il dit qui, dans le carnet de l'espace
([chapitre 10](#le-carnet-de-contacts)), est associé à cette affaire.

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
- **le carnet de l'espace est vide** : le bloc l'écrit, dit que le contact se crée dans le carnet avec
  « Nouveau contact » ([section 10](#le-carnet-de-contacts)), et propose le lien **Ouvrir le carnet**.

**Détacher.** Chaque ligne porte un bouton **« Détacher »**. Il demande une **confirmation qui nomme
la personne** : le rattachement et le rôle saisi sont perdus, la personne restant au carnet et
pouvant être rattachée de nouveau. Tant que vous n'avez pas confirmé, **rien n'est écrit**.

**Si vous n'avez pas le droit d'écrire sur cette affaire.** Les deux boutons restent visibles et
actifs : le produit ne devine pas vos droits, il vous répond. Un rattachement refusé affiche
**« Vous ne pouvez pas modifier cette affaire. »** sous le formulaire, **sans effacer votre saisie**.
Un détachement refusé, lui, affiche **« Aucun rattachement n'a été retiré. »** : c'est la réponse
exacte du serveur, qui ne distingue pas un refus d'une ligne déjà retirée par quelqu'un d'autre — et
le produit préfère le dire ainsi plutôt qu'annoncer un retrait qui n'a pas eu lieu.

**Corriger un rôle ne se fait pas depuis cette page**, mais depuis la **fiche du contact** : le bouton « Modifier le
rôle » de chaque ligne le corrige d'un seul geste ([section 10.8](#corriger-le-role-d-une-personne-dans-une-affaire)).
Ici, il faudrait détacher puis rattacher.

**Ce que cette page ne fait pas.** Une affaire ne se rattache pas depuis le carnet ni depuis la
fiche d'organisation — le geste part toujours de l'affaire ou de la fiche du contact. Et un
rattachement n'apparaît **pas** dans l'historique de l'affaire ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)).

### 9.8 Les activités d'une affaire : appels, réunions, visios

**À quoi cela sert.** Garder la trace de ce qui **a eu lieu** avec le client hors du CRM : un appel, une réunion, une
visio. La « prochaine action » de l'en-tête dit ce qui **vient** ; les activités disent ce qui **s'est passé**.

**Où.** Dans la colonne de gauche de la fiche, **juste après « Contacts de l'affaire »** : le bloc **« Activités »**.
Les activités sont listées de la plus récente à la plus ancienne.

**Ce que chaque ligne montre.**
- Une icône, puis le **sujet**.
- Dessous, le **type en toutes lettres** (Appel, Réunion, Visio), la **date et l'heure** de l'activité, sa **durée**
  si elle a été saisie, et **qui l'a consignée**. La mention « modifiée » paraît si son auteur l'a corrigée depuis.
- Les **participants** : « Avec Léo Marchand, Camille Aubert ». Une activité sans participant n'affiche rien à cette
  place.
- Le **compte rendu**, replié sous « Compte rendu » : cliquez, ou appuyez sur Entrée, pour le lire.

**Consigner une activité.** Le bouton **« Consigner une activité »**, en tête du bloc, ouvre un formulaire dans la
page, sans fenêtre par-dessus :
- **Type** : Appel, Réunion ou Visio. Appel est choisi d'avance.
- **Date et heure** : maintenant, par défaut. Vous pouvez la reculer pour un appel d'hier, mais **pas l'avancer** : une
  activité consignée est une activité qui a déjà eu lieu. Le produit tolère cinq minutes d'avance pour l'horloge de
  votre poste.
- **Durée (minutes)** : facultative, de 1 à 1440. **Elle ne compte pas dans votre temps passé** : votre temps se
  saisit dans « Temps » ([chapitre 28](#le-temps-passe-et-le-cout-du-personnel)), et le formulaire le rappelle.
- **Sujet** : obligatoire, 200 caractères au plus. Tant qu'il est vide, « Consigner » reste grisé.
- **Compte rendu** : facultatif.
- **Participants** : les **contacts liés à cette affaire** et les **membres de l'espace**, à cocher. Un contact qui
  n'est pas lié à l'affaire ne peut pas être choisi : rattachez-le d'abord ([chapitre 9.7](#les-contacts-d-une-affaire-les-rattacher-les-detacher)).

« Annuler », ou la touche Échap, referme le formulaire sans rien écrire.

**Corriger, retirer.**
- **Seul l'auteur corrige** son activité, avec le même formulaire, prérempli. Si vous ne touchez pas à la date, elle
  reste exactement celle d'origine.
- **L'auteur la retire**, et **un administrateur de l'espace** peut retirer l'activité d'une autre personne, sans
  pouvoir la corriger.
- Retirer demande une **confirmation sur la ligne**. Le sujet, le compte rendu et les participants sont effacés, mais
  la ligne reste à sa place : « Activité retirée », ou « Activité retirée par la modération » quand ce n'est pas
  l'auteur qui l'a retirée. Le nom de la personne qui a retiré n'est pas affiché.
- **Une activité retirée ne se rétablit pas.**

**Si vous ne pouvez pas écrire sur cette affaire.** Les boutons restent visibles mais grisés, et le bandeau en tête de
la fiche dit pourquoi ([chapitre 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Vous lisez les activités comme les autres.

**Ce que le produit refuse, et comment il le dit.** Chaque refus s'écrit **dans le formulaire**, en français, et votre
saisie est conservée :
- une date dans le futur ;
- un sujet vide ou trop long ;
- une durée qui n'est pas un nombre entier de minutes entre 1 et 1440 ;
- un participant qui n'est plus lié à l'affaire ;
- une affaire qui ne vous est pas ouverte en écriture.

Si un participant est refusé alors que l'activité, elle, est enregistrée, le bloc le dit sous la liste : l'activité
n'est pas annulée pour autant.

**Dans l'historique de l'affaire.** Chaque activité paraît aussi dans le fil ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)), **à la date où elle a eu
lieu** et non à celle où elle a été saisie : un appel consigné le lendemain s'insère à sa place dans l'histoire. Le fil
montre le type, le sujet, la durée et l'auteur. Le compte rendu et les participants restent dans le bloc.

**Ce qui n'est pas offert.** Aucune planification, aucun rappel, aucune liste de toutes les activités de l'espace.
Le connecteur MCP liste, consigne et corrige les activités d'une affaire
([chapitre 33](#le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant)) ; il ne les retire pas : le retrait reste un
geste de l'écran.

### 9.9 La checklist d'une affaire : les points à cocher

**À quoi cela sert.** Dire ce qu'il reste à faire sur une affaire, point par point, et savoir qui l'a fait. Certains
points viennent de l'**étape** où se trouve l'affaire ; d'autres sont **libres**, ajoutés à la main sur une affaire.

**Où.** Dans la colonne de gauche de la fiche, **juste après le formulaire** : le bloc **« Checklist »**. Son titre
porte le compte des points cochés : « 2 sur 3 ». Une affaire sans aucun point affiche « Aucun point pour cette
affaire. », et le champ d'ajout reste offert.

**Ce que le bloc montre.**
- **« Étape Relance »** — les points de l'étape où se trouve l'affaire, en premier. Ils sont ajoutés **automatiquement**
  quand l'affaire entre dans l'étape ; un administrateur les définit pour chaque étape du processus.
- Sous leur propre titre, les points des **étapes déjà traversées** : ils restent, cochés ou non, pour mémoire. Si une
  étape a été supprimée depuis, ses points restent sous « Étape supprimée ».
- **« Points libres »** — ceux que l'on a ajoutés sur cette affaire.
- Un point coché dit **qui l'a coché, et quand** : « Coché par Driss Lemoine, le 26/10/2026 14:05 ».
- Un point **exigé** pour quitter l'étape porte la mention **« Exigé pour passer à Négociation »** : tant qu'il n'est pas
  coché, ce déplacement est refusé.

**Cocher, décocher.** Cliquez sur la case, ou appuyez sur Espace quand elle a le focus. La case bascule tout de suite ;
si le serveur refuse, elle revient à son état et le motif s'écrit sous le point. Tout point se coche et se décoche, qu'il
vienne de l'étape ou qu'il soit libre.

**Ajouter un point libre.** Saisissez son libellé dans **« Nouveau point »**, sous les points libres, puis **« Ajouter »**
ou Entrée. Le champ se vide et garde le focus, pour en ajouter un autre. « Ajouter » reste grisé tant que le champ est
vide. Un libellé fait 200 caractères au plus.

**Retirer un point libre.** Le bouton **« Retirer »** de la ligne le retire aussitôt, sans confirmation : il se
réécrit en un instant. **Un point d'étape ne se retire pas** et n'a pas de bouton : il appartient à l'étape.

**Sur le tableau kanban.** Une carte dont l'étape porte des points montre leur compte, **« 1/2 »**, à côté de son
ancienneté ; tous cochés, la pastille passe au vert. Une carte dont l'étape n'a aucun point ne montre rien. Si vous
glissez une affaire vers une étape alors qu'un point exigé n'est pas coché, le déplacement est refusé et le bandeau
**nomme les points à cocher** : « Ces points de la checklist doivent être cochés avant ce déplacement : Proposition
envoyée ». La carte revient à sa place.

**Dans l'historique de l'affaire.** Chaque cochage et chaque décochage paraît dans le fil ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)), sous le
filtre « Champs » : « Point de checklist coché », avec le libellé du point et son auteur.

**Si vous ne pouvez pas écrire sur cette affaire.** Les cases, « Retirer » et le champ d'ajout restent visibles mais
grisés, et le bandeau en tête de la fiche dit pourquoi ([chapitre 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Vous lisez la checklist comme les autres.

**Définir les points d'une étape** et les points exigés par un déplacement se fait dans l'éditeur de workflows
([section 18.10](#les-checklists-des-etapes-et-les-points-qu-un-chemin-exige)). Le bandeau de refus du tableau porte le lien **« Cocher ces points »**, qui ouvre la fiche sur ce
bloc, le premier point exigé non coché prêt à être coché.

### 9.10 Le tableau kanban d'un channel

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
en cours ([chapitre 9.4](#archiver-n-est-pas-supprimer)). Les affaires **en sommeil** n'y figurent pas non plus, jusqu'à leur
échéance : une case à cocher **« Afficher les affaires en sommeil »**, au-dessus des colonnes, les
ramène — marquées de leur date de réveil ([chapitre 9.13](#mettre-une-affaire-en-sommeil-et-la-retrouver)). Le nombre d'affaires d'une colonne et
son cumul de montants portent sur les cartes **affichées** : ils changent donc avec cette case.

Si toutes les affaires d'un channel dorment, le tableau ne prétend pas qu'il est vide : il annonce
« Toutes les affaires de ce channel sont en sommeil » et propose le geste qui les révèle.

**Créer une affaire.** Le bouton **Nouvelle affaire**, en tête de la barre
au-dessus des colonnes, ouvre un formulaire **dans la page**, sous la barre — pas une fenêtre
par-dessus : le tableau reste visible. Un seul champ, le **titre** ; tout le reste — montant,
responsable, échéance, contacts — se complète ensuite sur la fiche.

- **« Créer » reste grisé tant que le titre est vide** — des espaces seuls ne comptent pas.
- **Partir d'un modèle.** Quand le workflow du channel a au moins un modèle d'affaire, une liste
  **« Modèle »** paraît sous le titre, « Aucun modèle » en tête. Choisir un modèle **remplit le titre s'il est encore
  vide** — jamais par-dessus ce que vous avez tapé —, et l'affaire naît avec la description, le montant, les réponses
  aux questions et les points de checklist du modèle ; les points de l'étape initiale s'y ajoutent comme à toute
  création. Un channel dont le workflow n'a aucun modèle ne montre pas la liste. Les modèles se préparent dans
  **Réglages ▸ Modèles d'affaires** ([section 18.15](#preparer-des-modeles-d-affaires)).
- **L'affaire entre toujours par l'étape initiale** du workflow du channel, quelle que soit la façon
  dont vous avez ouvert le formulaire. C'est le serveur qui la choisit, pas l'écran.
- **Une fois créée, sa fiche s'ouvre** : c'est là que l'affaire se complète.
- **La colonne de l'étape initiale**, quand elle est vide, porte le même geste : **Créer une affaire**.
  Les autres colonnes vides n'en portent pas — une affaire n'y naît pas.
- **Au clavier** : le bouton se rejoint par `Tab`, `Entrée` ouvre le formulaire et y place le
  curseur, `Entrée` crée ; **`Échap`** — ou **Annuler** — referme sans rien créer, et le curseur
  revient au bouton. Pendant l'envoi, le bouton dit « Création… », et ni `Échap` ni Annuler
  n'interrompent l'envoi.
- **Quand le serveur refuse**, la raison s'écrit sous le champ, et ce que vous avez tapé reste en
  place : channel archivé ou mis à la corbeille ; workflow sans étape initiale — avec le lien **Ouvrir
  l'éditeur de workflows**, où l'étape initiale se désigne ; droit d'écriture insuffisant sur ce
  channel ; modèle qui n'est plus proposé — archivé entre-temps. Le bouton est montré à tous les profils : un compte en lecture seule le voit, et le refus
  le lui dit.
- **Un channel sans aucune affaire** l'annonce au-dessus du tableau, avec le geste à faire :
  « Créez la première avec « Nouvelle affaire », au-dessus des colonnes ».

**Faire avancer une affaire : deux gestes, une seule règle.**

- **À la souris**, en faisant glisser la carte vers une colonne. Seules les colonnes vers lesquelles
  un déplacement est **déclaré** dans le workflow acceptent le dépôt ; les autres le refusent
  visuellement, et aucune demande n'est envoyée au serveur.
- **Au clavier**, par le bouton « Actions » de la carte, qui ouvre son menu. La partie
  **Déplacer vers** y liste les déplacements déclarés depuis l'étape courante — et **eux seuls**.
  Lorsqu'une étape n'en propose aucun, le menu s'ouvre quand même et le dit en toutes lettres : il
  porte aussi le geste de sommeil ([chapitre 9.13](#mettre-une-affaire-en-sommeil-et-la-retrouver)), qui, lui, reste disponible.

Les deux gestes passent par le même contrôle du serveur, celui du [chapitre 9.3](#faire-avancer-une-affaire-ce-que-le-produit-autorise-et-ce-qu-il-refuse) : l'écran ne propose
jamais une action que le serveur refuserait, et il ne se substitue jamais à lui.

**Quand un motif est exigé.** Certains déplacements — « Marquer perdu », par exemple — exigent une
raison. L'écran la demande **avant** d'envoyer quoi que ce soit, et l'affaire ne bouge pas tant que
vous ne l'avez pas donnée. **Ce motif est conservé** : il rejoint l'historique de l'affaire, comme un
commentaire à votre nom ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)), et l'écran de saisie le dit. *Cette phrase disait qu'il était
perdu ; il est enregistré depuis que l'historique des affaires existe.*

**Quand le serveur refuse.** L'affaire **retourne exactement à sa place**, et la raison s'affiche :
déplacement non déclaré, droit d'écriture insuffisant, affaire devenue inaccessible, ou **liste des
questions restées sans réponse**, nommées par leur libellé. Un refus que l'écran ne connaîtrait pas
est affiché tel quel, plutôt que traduit à tort.

Pour un track que votre compte ne peut pas lire, cette adresse affiche « Track introuvable ». Sinon,
le tableau réel est atteint et les déplacements consentis sont exécutables depuis le menu ou par
glisser-déposer. Sans connexion, l'adresse mène à l'écran de connexion.

### 9.11 La vue liste d'un channel

À côté du tableau, un channel se lit aussi **en liste**. La bascule **Tableau / Liste**, en haut de
la zone principale, passe de l'une à l'autre ; chaque vue a sa propre adresse.

**À quoi elle sert.** Le tableau répond à « où en est chaque affaire ? ». La liste répond à
« laquelle, parmi toutes, dois-je ouvrir ? ». Elle montre les mêmes affaires — celles qui ne sont
ni archivées ni en corbeille — rangées par leurs propres colonnes plutôt que par le workflow.

**Créer une affaire** depuis la liste : le bouton **Nouvelle affaire** vient en tête de la barre des
filtres, et ouvre le même formulaire que sur le tableau ([chapitre 9.10](#le-tableau-kanban-d-un-channel)) — même titre seul, même étape
initiale, même fiche qui s'ouvre.

**Ce que montre une ligne.** Le titre de l'affaire, qui est un **lien** vers sa fiche ; son **responsable** ; son
étape, en pastille de couleur ; son montant ; sa prochaine action ; et son échéance. Une ligne tient sur
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
  Voir le [chapitre 9.13](#mettre-une-affaire-en-sommeil-et-la-retrouver).

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

**Ce que la liste ne fait pas.** En dehors de la création, elle **lit** : on n'y modifie, n'y archive et n'y déplace
aucune affaire. Le déplacement est le geste du tableau ([section 9.10](#le-tableau-kanban-d-un-channel)) ; le reste se
fait sur la fiche.

Pour un track que votre compte ne peut pas lire, cette adresse affiche « Track introuvable », comme
pour le tableau. Sinon, la liste réelle est consultable, triable et filtrable. Sans connexion,
l'adresse mène à l'écran de connexion.

### 9.12 L'historique et la discussion d'une affaire

À droite de la fiche d'une affaire — sous le formulaire lorsque l'écran est étroit — se trouve
**Historique et discussion**. C'est **un seul fil**, du plus ancien en haut au plus récent en bas
comme une conversation se lit, où se mêlent deux choses : ce que les gens ont **dit** — les
commentaires — et ce qui est **arrivé** à l'affaire.

**Ce que l'affaire retient d'elle-même.** Chaque fait laisse une trace, écrite au moment où il a
lieu :

| Ce qui s'est passé | Ce que le fil montre |
|---|---|
| L'affaire a été créée | *Affaire créée* |
| Elle a changé d'étape | *Étape franchie*, avec les deux étapes — par exemple « Prospection → Relance ». Chaque étape y porte le nom que le board lui donne : si un administrateur a renommé l'étape dans ce workflow, c'est ce nom qui paraît — « Signature → Réalisation en cours » |
| Son responsable a changé | *Responsable modifié* |
| Elle a été archivée, ou remise en service | *Affaire archivée* / *Affaire désarchivée* |
| Elle a été mise à la corbeille, ou restaurée | *Affaire mise à la corbeille* / *Affaire restaurée* |
| Une réponse de formulaire a été saisie ou changée | *Champ renseigné*, avec le nom du champ |
| Un courrier est arrivé sur l'affaire, ou en est parti | *Message reçu* / *Message envoyé*, avec son objet et son correspondant |
| Un contact a été rattaché à l'affaire, ou détaché | *Contact rattaché* / *Contact détaché*, avec son nom et son rôle |
| Le rôle d'un contact rattaché a changé | *Rôle du contact modifié*, avec l'ancien rôle et le nouveau |
| Un appel, une réunion ou une visio a été consigné ([chapitre 9.8](#les-activites-d-une-affaire-appels-reunions-visios)) | *Appel*, *Réunion* ou *Visio*, avec son sujet, à la date où l'activité a eu lieu ; *Activité retirée* une fois retirée |
| L'affaire a été mise en sommeil, ou réveillée | *Affaire mise en sommeil* / *Affaire réveillée*, avec l'échéance |
| L'affaire est restée trop longtemps dans son étape | *Relance automatique*, avec le retard et le seuil |

**Ces traces ne peuvent être ni fabriquées, ni corrigées, ni effacées.** Personne ne peut en écrire
une à la main — ni un utilisateur, ni un administrateur, ni un compte technique. C'est le serveur qui les écrit, au moment de l'acte. Une fois écrite, une trace ne
peut plus être modifiée par qui que ce soit. Ce que l'historique montre a donc **réellement eu
lieu**, et il dit désormais **qui** l'a fait lorsque l'acte a un auteur : le nom apparaît à côté de
la date. Certaines lignes n'en portent pas, et c'est normal — une relance nocturne n'a pas d'auteur,
c'est un fait de l'horloge.

**Le nom d'un contact rattaché est lu au moment où vous ouvrez le fil**, jamais recopié dans la
trace : si la personne est renommée, l'historique dit son nom d'aujourd'hui plutôt qu'un nom périmé.
Si elle a été supprimée entre-temps, la ligne reste — le geste a bien eu lieu — mais sans nom :
l'historique préfère se taire que d'inventer.

**Une action qui ne change rien ne laisse rien.** Réenregistrer une réponse identique, ou
réattribuer une affaire à la personne qui en est déjà responsable, n'ajoute aucune ligne au fil.

**Filtrer le fil.** Six bascules le trient par famille : *Discussion*, *Activités*, *Étapes*, *Champs*,
*Organisation*, *Cycle de vie*. Toutes sont actives à l'ouverture, et le nombre porté par chacune
compte ce que l'affaire contient — il ne bouge pas quand vous éteignez la famille. Éteindre tout
affiche « Aucun élément pour ces filtres », qui ne se confond pas avec « Aucun événement pour le moment » : le
premier dit que vous filtrez, le second qu'il n'y a rien. **Rien n'est retenu** : rouvrir la fiche
rétablit le fil complet, et aucune préférence n'est enregistrée sur votre appareil.

**La barre de filtres n'apparaît que s'il y a quelque chose à filtrer.** Sur une affaire dont le
fil est vide, elle est absente : six bascules affichant « 0 » au-dessus de « aucun événement pour
le moment » seraient un contrôle sans objet.

**Les changements de contexte sont nommés.** Lorsqu'une affaire change de dossier ([chapitre 9.14](#ranger-une-affaire-dans-un-autre-dossier)),
le serveur écrit une trace **« Dossier changé »**. Lorsqu'un administrateur remappe toutes les
affaires d'un dossier vers un autre processus, le fil dit **« Workflow modifié »**. Il ne donne pas
les noms avant/après : la vue ne résout pas ces noms historiques et n'en invente aucun.

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
- **Le motif d'un déplacement** n'est pas recopié dans la ligne d'historique : quand un chemin exige un motif, il est
  conservé une fois, comme un commentaire de la discussion.
- **Aucune recherche, aucun regroupement par jour, aucun export** du fil.
- **Écrire « @ » et un nom dans le texte ne prévient personne** : on prévient un collègue par la commande
  « Mentionner » du composeur ([section 5.5](#mentionner-quelqu-un-dans-un-commentaire)).
- **La mise en forme n'est pas interprétée** : le texte est affiché tel qu'il a été saisi, retours à
  la ligne compris, sans gras ni liens cliquables.
- **Un retrait par la modération n'apparaît pas dans l'historique** : le fil montre la pierre
  tombale du commentaire, il n'ajoute aucune ligne d'événement pour le retrait.

Après connexion, le composeur publie réellement le commentaire si votre compte peut écrire dans
le channel. Un profil en lecture seule reçoit un refus explicite et conserve son texte saisi.

### 9.13 Mettre une affaire en sommeil, et la retrouver

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

Quand vous lisez cette affaire sans avoir le droit de l'écrire, le geste est grisé et un bandeau
en tête de l'onglet dit pourquoi ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Si le serveur refuse malgré tout — vos droits ont
changé entre-temps —, **le menu reste ouvert** et la raison s'affiche dessous, mot pour mot celle de
la fiche.

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
([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)).

**Les compteurs suivent ce que vous voyez.** Le nombre d'affaires d'une colonne du tableau, le total
de montants qui l'accompagne et le compte « Affaires : n » de la liste portent sur les affaires
**affichées** : ils changent donc lorsque vous cochez la case. Une colonne annonce ce qu'elle
montre, sinon son compteur désignerait des cartes introuvables à l'œil.

**Ce que le sommeil n'est pas.** Ce n'est ni une archive, ni une suppression, ni une permission : une
affaire endormie se déplace, se modifie et se commente exactement comme une autre, et toute personne
qui pouvait la lire peut encore la retrouver. Le sommeil **range**, il ne protège pas.

**Les fils de messagerie dorment aussi**, depuis l'inbox ([section 12.2](#l-inbox-lire-et-trier-le-courrier-recu)).
La **vue liste** n'offre pas le geste : elle laisse la case d'affichage et le lien vers la fiche.

### 9.14 Ranger une affaire dans un autre dossier

Une affaire peut **changer d'onglet** — de dossier. Le geste répond à une situation banale : une
affaire a été ouverte au mauvais endroit, ou elle a changé de nature et relève désormais d'une
autre activité.

Ce n'est pas un déplacement d'étape ([chapitre 9.3](#faire-avancer-une-affaire-ce-que-le-produit-autorise-et-ce-qu-il-refuse)), et les deux ne se confondent pas : l'un fait
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
*Champ renseigné* qu'elles ont laissées dans l'historique restent, avec leurs dates ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)).
Rien ne peut effacer l'historique d'une affaire.

**Deux effets accompagnent le rangement.** L'affaire est placée **en fin** de la colonne d'arrivée,
comme pour un déplacement d'étape. Sa date d'**entrée dans l'étape** n'est remise à zéro **que si
l'étape change** : ranger une affaire dans un autre dossier sans la faire avancer ne doit pas faire
croire qu'elle vient d'entrer dans son étape — sans quoi une affaire en négociation depuis trois
semaines paraîtrait y être entrée à l'instant.

**Une trace est écrite.** Le rangement laisse un événement **« Dossier changé »** dans
l'historique de l'affaire, y compris lorsque personne ne passe par l'application. Le fil ne nomme
pas les dossiers avant/après, car il ne résout pas leurs noms historiques ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)).

**Ce rangement ne se fait pas encore depuis l'écran** : aucune commande de la fiche ne le propose.

### 9.15 Mettre une affaire à la corbeille

**Où.** En bas de la colonne de gauche de la fiche, sous le formulaire : le bouton **« Mettre à la
corbeille »**. C'est le seul endroit d'où une affaire se retire — ni le tableau kanban ni la vue
liste ne l'offrent, et ce n'est pas un oubli : le menu d'une carte du tableau porte les gestes qui
se défont d'eux-mêmes — un déplacement, une mise en sommeil —, et un retrait y serait d'une autre
nature.

**Ce que le produit demande avant d'agir.** Une confirmation, sous le formulaire, qui **nomme
l'affaire** et rappelle ce que le geste fait : elle quitte le tableau, la vue liste et la recherche,
sans être supprimée, et se restaure depuis la corbeille. Tant que vous n'avez pas confirmé, **rien
n'est écrit**. « Annuler » referme la confirmation et vous rend le bouton — au clavier aussi.

Contrairement au retrait d'un track ou d'un channel ([chapitre 17](#administrer-l-arborescence-tracks-et-channels)), **aucun décompte n'accompagne la
question** : une affaire ne porte pas d'objet qui deviendrait inaccessible avec elle.

**Ce que vous voyez ensuite.** L'écran est remplacé par un message qui dit que l'affaire est à la
corbeille, avec deux chemins : **revenir au channel**, ou **ouvrir la corbeille** pour l'y retrouver
et la restaurer ([chapitre 20](#la-corbeille-ce-qui-a-ete-retire-et-comment-le-rendre)). Il ne dit pas « Card introuvable » : l'affaire existe, vous venez
de la retirer.

**Trois réponses sont possibles, et l'écran les distingue** :

| Ce que vous voyez | Ce qui s'est passé |
|---|---|
| Le message « Affaire mise à la corbeille » | Le retrait est enregistré, et votre nom avec lui |
| « Aucune modification : votre compte ne peut pas écrire dans cette affaire. » | Votre compte lit l'affaire mais n'a pas le droit d'y écrire. **Rien n'a changé** |
| « Votre compte n'a pas le droit de retirer cette affaire. » | Le serveur a refusé explicitement |

**Le bouton est grisé si vous ne pouvez pas écrire sur l'onglet**, et la fiche dit pourquoi
([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). La règle reste celle du serveur : si vos droits changent entre l'ouverture de la fiche
et le clic, c'est sa réponse, ci-dessus, qui s'affiche.

**Qui peut le faire.** Toute personne ayant le droit d'**écrire** sur l'onglet de l'affaire — ce
n'est pas réservé à une administratrice, contrairement au retrait d'un track ou d'un channel. Une
personne en lecture seule obtient la deuxième réponse du tableau ci-dessus.

**Le retrait est inscrit dans l'historique de l'affaire** ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)), sous « Cycle de vie »,
avec son auteur et sa date. Vous le relisez après restauration.

### 9.16 Ce qui n'est pas encore offert

- **Les vues sauvegardées** : la vue liste et ses filtres existent ([chapitre 9.11](#la-vue-liste-d-un-channel)), mais aucun filtre
  ne se conserve d'une session à l'autre autrement qu'en gardant l'adresse.
- **Le choix du nombre de lignes par page** : la liste en affiche vingt-cinq, et cela ne se règle pas.
- **La recherche de la vue liste** est bornée au channel ouvert ; la recherche de l'en-tête cherche partout
  ([chapitre 4](#retrouver-n-importe-quoi-la-recherche)).
- **Le réordonnancement d'une affaire dans sa colonne** : le déplacement change d'étape, pas de rang.
- **Le rangement d'une affaire dans un autre dossier depuis l'écran** : la règle existe et le
  serveur l'applique ([section 9.14](#ranger-une-affaire-dans-un-autre-dossier)), mais aucune commande ne le propose.
- **Les étiquettes sur une carte du tableau** : elles ne sont pas portées par le produit.
- **Les documents** : une affaire ne porte pas de documents propres ; les pièces jointes de son courrier se trouvent
  avec ses messages ([chapitre 12](#l-inbox-lire-trier-et-repondre)).

## 10. Le carnet de contacts

L'entrée **Contacts** de la barre latérale ouvre le **carnet** de votre espace de travail : les
personnes avec qui vos affaires se traitent, et l'organisation à laquelle chacune appartient.

Le carnet a **deux onglets**, en tête de page : **Contacts**, la liste des personnes, et
**Organisations**, la liste des organisations (voir plus bas). Chaque onglet a sa propre adresse :
vous pouvez l'ajouter à vos favoris ou la partager.

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
une donnée manquante à corriger.

**Qui voit quoi.** Tout membre de l'espace de travail lit le carnet, y compris un compte en lecture
seule. Une ligne que votre compte n'a pas le droit de lire n'apparaît simplement pas, et c'est la
règle générale du produit — un refus se manifeste par l'absence de donnée,
jamais par un message d'erreur technique.

**Ce que le carnet ne fait pas encore, et c'est dit plutôt que laissé à deviner.** Il permet de
**créer** un contact, mais ni de le modifier ni de le supprimer : ces deux gestes vivent sur la
**fiche** du contact, et non sur une ligne du carnet — on ne pose pas un geste irréversible au bout
de chaque ligne d'une liste que l'on parcourt. Cliquer sur un email n'ouvre pas votre logiciel de
messagerie. Il n'y a pas non plus de recherche ni de filtre : le carnet affiche l'ensemble des
contacts de l'espace.

Rattacher une personne à une affaire se fait depuis sa fiche
([section 10.6](#rattacher-une-personne-a-une-affaire)) ou depuis celle de l'affaire
([section 9.7](#les-contacts-d-une-affaire-les-rattacher-les-detacher)). Ce rattachement sert aussi à ranger le
courrier : un message dont l'expéditeur est un contact rattaché à une affaire est proposé pour cette affaire.

### 10.1 Créer un contact

Le bouton **« Nouveau contact »**, au-dessus du tableau, ouvre un formulaire **dans la page** — pas
une fenêtre par-dessus : la liste reste visible, et c'est elle qui vous dit si la personne y figure
déjà.

Cinq champs, et un seul est obligatoire :

- **Nom** — obligatoire. Un nom vide est refusé avant même l'envoi.
- **Organisation** — au choix parmi celles de l'espace de travail, ou aucune. Le formulaire ne crée
  pas d'organisation : créez-la d'abord dans l'onglet **Organisations**.
- **Fonction**, **Email**, **Téléphone** — facultatifs. Laissés vides, ils restent vides : le carnet
  n'écrit ni tiret ni « non renseigné ».

Le contact créé **rejoint aussitôt le tableau**, à sa place dans l'ordre alphabétique, sans que la
page ne se recharge.

**Si la création est refusée**, le message le dit en clair et **votre saisie est conservée** :

- *« Un contact porte déjà cette adresse email »* — l'adresse est unique dans l'espace de travail,
  quelle que soit la casse ;
- *« Cette organisation n'existe plus »* — la liste que vous aviez sous les yeux a vieilli ;
  relisez-la et choisissez-en une autre ;
- *« Votre rôle ne permet pas de créer un contact »* — d'ordinaire, « Nouveau contact » est grisé
  pour un compte qui ne peut pas créer ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)) ; ce message ne paraît que si vos droits ont
  changé entre-temps ou n'ont pas pu être lus. Le serveur reste la règle.

**Ce que ce formulaire ne fait pas**, et c'est dit plutôt que caché : il ne **supprime** pas un
contact existant et il ne crée pas d'organisation ; il n'existe que sur le carnet — ni depuis la
fiche d'une affaire, ni depuis un champ de formulaire. Pour **modifier** une personne déjà créée,
ouvrez sa fiche : le bouton « Modifier » y attend.

### 10.2 La fiche d'un contact

Cliquer sur le nom d'une personne — dans le carnet, ou dans la liste des contacts d'une
organisation — ouvre sa **fiche**. Elle porte son **nom en titre**, puis deux blocs :

- **ce qui la caractérise** — sa **fonction**, son **organisation**, son **email** et son
  **téléphone**. L'organisation est un lien vers sa propre fiche ; comme partout dans le carnet, une
  valeur absente laisse la place **vide** plutôt qu'un tiret ;
- **ses affaires** — un tableau à trois colonnes : l'affaire, le **rôle** que la personne y tient
  (par exemple « decideur »), et son **état**. Le titre de chaque affaire est un lien qui l'ouvre.

C'est la seule page qui répond à la question « sur quoi travaillons-nous avec cette personne ? »,
et c'est aussi d'ici que l'on **ajoute** une affaire à cette liste
([section 10.6](#rattacher-une-personne-a-une-affaire)).

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

### 10.3 Modifier un contact

Le bouton **« Modifier »**, en haut de la fiche, ouvre un formulaire **dans la page** — pas une
fenêtre par-dessus : les deux blocs restent visibles en dessous, et vous corrigez en voyant ce que
vous corrigez.

Les cinq champs sont ceux de la création, **déjà remplis** avec les valeurs actuelles. Le **nom**
reste obligatoire ; les autres peuvent être vidés, et ils redeviennent alors vides sur la fiche.
Vider le champ **Organisation** détache la personne de son organisation, sans la supprimer.

Une fois enregistrée, la modification apparaît **immédiatement** dans le bloc du haut, et le titre
de la page suit le nouveau nom. Le tableau des affaires, lui, ne bouge pas : modifier une personne
ne change rien à ce sur quoi elle travaille.

**Si la modification est refusée**, le message le dit en clair et **votre saisie est conservée** :

- *« Un autre contact porte déjà cette adresse email »* — l'adresse est unique dans l'espace de
  travail, quelle que soit la casse. Vous pouvez en revanche réenregistrer la personne avec sa
  **propre** adresse sans rien changer : elle ne se heurte pas à elle-même ;
- *« Cette organisation n'existe plus »* — la liste que vous aviez sous les yeux a vieilli ;
- *« Une des valeurs saisies n'a pas la forme attendue »* — un email mal formé, par exemple ;
- *« Rien n'a été modifié »* — et ce message-là mérite une explication.

**Pourquoi « Rien n'a été modifié » ne dit pas pourquoi.** Deux situations donnent exactement la
même réponse du serveur, et le produit ne peut pas les distinguer : soit votre rôle ne vous permet
pas de modifier ce contact — d'ordinaire, « Modifier » est alors grisé ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)) ; ce message ne paraît
que si vos droits ont changé entre-temps ou n'ont pas pu être lus —, soit le contact a été supprimé entre le moment où vous
avez ouvert sa fiche et celui où vous avez enregistré. Le message ne tranche donc pas, et vous
invite à **recharger la fiche** : son état actuel répondra à la question. Le formulaire reste
ouvert et votre saisie est intacte, pour que vous ne perdiez rien.

### 10.4 Supprimer un contact

Le bouton **« Supprimer »** se trouve à côté de **« Modifier »**, en haut de la fiche. Il vient en
second, et c'est délibéré : on lit d'abord le geste que l'on peut défaire.

Il ouvre une **confirmation dans la page**, qui **nomme la personne** et vous dit **deux choses que
l'écran ne montre pas** :

- **combien d'affaires perdent ce contact**, et que **chacune gardera dans son historique la trace
  de ce détachement**. Supprimer un contact retire tous ses rattachements d'un seul coup, et chaque
  affaire concernée reçoit une ligne « Contact détaché » dans son fil. Cette trace est
  **définitive** : l'historique d'une affaire ne s'efface pas, c'est ce qui en fait une mémoire ;
- **que les formulaires d'affaires qui désignent ce contact conservent leur valeur.** Ils
  n'affichent pas un champ vidé, mais une **« référence inconnue »** avec l'identifiant. C'est
  volontaire : effacer la valeur détruirait une donnée historique juste — cette affaire a bien été
  suivie par cette personne —, et un champ vidé donnerait à croire que rien n'y avait été saisi.

Quand la personne n'est rattachée à **aucune** affaire, la première phrase n'apparaît pas : il n'y
a rien à annoncer.

**Une suppression réussie vous ramène au carnet**, qui ne porte plus la ligne. C'est là que vous
vérifiez que le geste a abouti.

**Si rien n'a été supprimé, l'écran le dit.** Vous restez sur la fiche, elle est relue, et un
message vous annonce qu'« aucun contact n'a été supprimé ». Deux causes mènent là et le produit ne
peut pas les distinguer : soit vous n'avez pas le droit de supprimer ce contact — d'ordinaire, le
bouton est alors grisé ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)) ; ce message ne paraît que si vos droits ont changé entre-temps
ou n'ont pas pu être lus —, soit le contact avait déjà été supprimé. La fiche relue répond à la question.

**La suppression est définitive : il n'y a pas de corbeille pour les contacts.** Les affaires en
ont une ([chapitre 20](#la-corbeille-ce-qui-a-ete-retire-et-comment-le-rendre)), les contacts n'en ont pas. Recréer un contact supprimé est possible,
mais ses rattachements aux affaires devront être refaits un par un, et leurs rôles ressaisis.

**Un seul geste ouvert à la fois.** Ouvrir la confirmation referme le formulaire de modification, et
inversement : deux questions posées en même temps sur la même personne ne diraient pas à laquelle
vous répondez.

**Ce que la fiche ne fait pas encore.** Elle ne montre pas les emails échangés avec la personne : la
messagerie d'une affaire reste dans l'affaire.

### 10.5 Les données personnelles d'un contact : les exporter, les anonymiser

En bas de la fiche, la zone **« Données personnelles (RGPD) »** porte deux gestes, réservés aux **administrateurs de
l'espace**. Pour un autre membre, les deux boutons restent visibles mais grisés, et une phrase dit pourquoi. Chaque geste
est inscrit au **journal d'audit** ([chapitre 22](#le-journal-d-audit-ce-qui-s-est-fait-dans-votre-espace)), sans le nom de la personne.

**« Exporter les données »** télécharge un fichier JSON nommé `contact-…-AAAA-MM-JJ.json`. Il réunit tout ce que le CRM
garde sur cette personne : sa fiche, son organisation, les affaires où elle est rattachée et son rôle, les activités dont
elle est participante, les messages où son adresse paraît, et les champs de formulaire qui la désignent. Le fichier
n'est enregistré nulle part dans le CRM : il n'existe que sur votre poste.

**« Anonymiser ce contact »** efface la personne sans effacer l'historique des affaires :

1. Le bouton ouvre une confirmation dans la page, qui dit ce qui va se passer : le nom, l'email, le téléphone et la
   fonction sont effacés ; les affaires gardent ce contact, anonyme ; les messages ne sont pas modifiés.
2. **Retapez le nom exact du contact** : le bouton **« Anonymiser définitivement »** ne s'active qu'à l'égalité.
3. La fiche se relit. Elle porte la mention **« Anonymisé le … »**, son nom devient « Contact anonymisé », et
   **« Modifier » est grisé** : un contact anonymisé ne se modifie plus, pour qu'aucune saisie ne le ré-identifie par
   mégarde. **« Supprimer » reste possible.**

L'anonymisation est **définitive**. **Les messages ne sont pas touchés** : ils sont la correspondance de l'entreprise, et
l'adresse ou la signature de la personne peuvent encore y paraître.

### 10.6 Rattacher une personne à une affaire

Le bouton **« Rattacher à une affaire »** se trouve dans le bloc **Affaires**, juste sous son titre.
Il ouvre un formulaire **dans la page** — le tableau reste visible en dessous, et c'est voulu :
c'est lui qui vous dit à quelles affaires la personne est **déjà** rattachée.

Deux champs :

- **Affaire** — la liste des affaires de l'espace de travail que vous avez le droit de lire,
  rangées par titre. Les affaires auxquelles cette personne est **déjà** rattachée n'y figurent
  pas : les proposer serait proposer un geste qui échouerait ;
- **Rôle dans l'affaire** — facultatif, et libre : « décideur », « prescripteur », « contact
  technique »… Laissé vide, il reste vide.

**Une affaire archivée peut être rattachée**, et la liste le dit : son titre est suivi de
**« (archivée) »**. Rattacher quelqu'un à une affaire close est un geste ordinaire de mise à jour
d'un historique. Une affaire **mise à la corbeille**, en revanche, n'est pas proposée : elle
n'apparaîtrait pas dans le tableau, et vous auriez agi sans rien voir changer.

Une fois enregistré, le formulaire se referme et **le tableau se relit** : la nouvelle affaire
apparaît avec son rôle, son état et son lien.

**Si le rattachement est refusé**, le message le dit en clair et **votre saisie est conservée** :

- *« Ce contact est déjà rattaché à cette affaire »* — quelqu'un d'autre a agi entre-temps ;
- *« Le rattachement a été refusé »* — vous n'avez pas le droit d'écrire sur cette affaire, ou elle
  n'est plus accessible. Le message ne tranche pas entre les deux, parce que le serveur répond la
  même chose dans les deux cas, et il vous invite à recharger la liste.

**Pouvoir lire une affaire ne veut pas dire pouvoir y rattacher quelqu'un.** Les droits se règlent
**affaire par affaire** : le même compte peut réussir sur l'une et être refusé sur l'autre, et c'est
mesuré. Le bouton n'est donc jamais grisé d'avance — le produit ne devine pas ce que le serveur
décidera, il envoie et vous rapporte la réponse.

### 10.7 Détacher une personne d'une affaire

Ce geste existe **des deux côtés** : ici, et sur la fiche de l'affaire
([section 9.7](#les-contacts-d-une-affaire-les-rattacher-les-detacher)).

Chaque ligne du tableau **Affaires** porte un bouton **« Détacher »**, dans une dernière colonne
« Commandes ». Toutes les lignes le portent, **y compris celle d'une affaire archivée** : détacher
une personne d'une affaire close est un geste ordinaire de correction d'historique.

Le bouton ouvre une **confirmation**, sur une ligne à elle, juste sous celle qu'elle concerne. Elle
**nomme l'affaire** et rappelle ce qui part avec le rattachement : **le rôle de la personne dans
cette affaire**. Vous pourrez la rattacher de nouveau, mais le rôle devra être ressaisi. Une seule
confirmation reste ouverte à la fois : en ouvrir une autre referme la précédente.

Une fois confirmé, **le tableau se relit** et la ligne disparaît. Si c'était la dernière affaire, le
bloc revient à son état vide, qui garde le bouton « Rattacher à une affaire ».

**Un détachement peut n'avoir aucun effet, et le produit vous le dit.** Sous le tableau apparaît
alors : *« Aucun rattachement n'a été retiré. Vous n'avez peut-être pas le droit de modifier cette
affaire, ou le rattachement avait déjà été supprimé. »* Le message **ne tranche pas** entre les deux
causes, parce que le serveur répond exactement la même chose dans les deux cas — et **la ligne
reste affichée**, parce qu'elle est toujours là. C'est délibéré : faire disparaître la ligne vous
aurait annoncé un détachement qui n'a pas eu lieu.

Comme pour le rattachement, **le bouton n'est jamais grisé d'avance**. Les droits se règlent affaire
par affaire : le même compte peut détacher sur l'une et se voir opposer ce message sur l'autre.

### 10.8 Corriger le rôle d'une personne dans une affaire

Corriger un rôle mal saisi ne demande pas de **détacher puis rattacher** la personne : le rôle se modifie en place.

Chaque ligne du tableau **Affaires** porte un second bouton, **« Modifier le rôle »**, placé
**avant** « Détacher » dans la colonne « Commandes » : le geste qui corrige vient avant celui qui
retire. Toutes les lignes le portent, **y compris celle d'une affaire archivée**.

Le bouton ouvre un formulaire sur une ligne à lui, juste sous celle qu'il concerne. Il **nomme
l'affaire**, et son champ est **prérempli** du rôle actuel — c'est exactement ce que vous venez
corriger. Un rattachement sans rôle donne un champ **vide**.

**Un seul bloc reste ouvert à la fois dans le tableau**, quel que soit le geste : ouvrir ce
formulaire referme une confirmation de détachement en cours, et inversement. Deux questions
ouvertes en même temps ne diraient pas à laquelle vous répondez.

**Vider le champ efface le rôle**, et le rattachement à l'affaire est **conservé** : c'est la façon
de retirer un rôle saisi par erreur sans défaire le lien. Le texte sous le champ le rappelle.

Une fois enregistré, le formulaire se referme et **la cellule « Rôle dans l'affaire » porte la
nouvelle valeur**. Aucun message de succès n'est affiché : la cellule est la confirmation.

**Une modification peut n'avoir aucun effet, et le produit vous le dit.** Le formulaire affiche
alors : *« Aucun rôle n'a été modifié. Vous n'avez peut-être pas le droit de modifier cette affaire,
ou le rattachement n'existe plus. »* Comme pour le détachement, le message **ne tranche pas** entre
les deux causes — le serveur répond la même chose dans les deux cas. **Le formulaire reste ouvert,
votre saisie est conservée**, et la cellule garde son ancienne valeur : rien n'a changé, et l'écran
ne prétend pas le contraire.

Le rôle est un **texte libre** : aucune liste imposée, aucune longueur maximale. Les exemples du
texte d'aide — décideur, prescripteur, contact technique — ne sont que des exemples.

### 10.9 L'onglet « Organisations »

L'onglet **Organisations** liste toutes les organisations de l'espace de travail, rangées par nom,
**y compris celles qui n'ont encore aucun contact** : c'est le seul chemin qui mène à elles.

| Colonne | Ce qu'elle porte |
|---|---|
| Nom | Le nom de l'organisation. **C'est un lien** : il ouvre sa fiche |
| Domaine | Son domaine, par exemple `sogexia.example`, lorsqu'il est renseigné |
| Site web | L'adresse de son site, lorsqu'elle est renseignée. Ici ce n'est pas un lien : la fiche le porte |
| Contacts | Le nombre de contacts du carnet rattachés à l'organisation |

Comme partout dans le carnet, une valeur absente laisse la cellule **vide**. Sur un écran étroit, le
tableau défile de côté dans son cadre ; la page, elle, ne défile jamais de côté. Lorsque l'espace ne
compte aucune organisation, l'onglet le dit, et le bouton « Nouvelle organisation » reste offert.

**Qui voit quoi.** Tout membre de l'espace lit l'onglet. **Créer et modifier** une organisation sont
réservés aux **administrateurs** et aux **business developers** de l'espace : pour un compte en
lecture seule, « Nouvelle organisation » et « Modifier » restent visibles mais grisés, avec le motif
écrit au-dessus ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Le serveur applique la même règle.

### 10.10 La fiche d'une organisation

Cliquer sur le nom d'une organisation, dans la colonne **Organisation** du carnet ou dans l'onglet
**Organisations**, ouvre sa **fiche**.

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

**Ce que la fiche ne fait pas.** Elle ne **supprime** pas une organisation — c'est délibéré : ses
contacts perdraient leur organisation sans laisser de trace —, et elle ne montre pas les affaires de
l'organisation. Le nom d'un contact, lui, est un lien vers sa fiche. Pour **modifier**
l'organisation, voir « Modifier une organisation » ci-dessous.

### 10.11 Créer une organisation

Le bouton **« Nouvelle organisation »**, au-dessus du tableau, ouvre un formulaire **dans la page**.
Trois champs, et un seul est obligatoire :

- **Nom** — obligatoire.
- **Domaine** — facultatif. Minuscules, chiffres, tirets et points, par exemple `sogexia.fr`. Si
  vous tapez des majuscules, le domaine est enregistré **en minuscules** : la casse d'un domaine ne
  change rien.
- **Site web** — facultatif. Une adresse commençant par `http://` ou `https://`.

Après la création, **la fiche de la nouvelle organisation s'ouvre**. Vous pouvez ensuite lui
rattacher des contacts depuis le carnet : en créant un contact, ou depuis la fiche d'un contact
existant, avec « Modifier ».

**Si la création est refusée**, le message le dit en clair, dans le formulaire, et **votre saisie
est conservée** :

- *« Ce domaine est déjà celui d'une autre organisation de l'espace. »* — un domaine est unique
  dans l'espace de travail ;
- *« Le domaine n'a pas la bonne forme… »* ou *« Le site web doit commencer par http:// ou
  https://. »* — corrigez le champ et renvoyez ;
- *« Le nom est requis. »* ;
- *« Vous ne pouvez pas modifier les organisations de cet espace. »* — d'ordinaire, la commande est
  déjà grisée ; ce message ne paraît que si vos droits ont changé entre-temps.

### 10.12 Modifier une organisation

Sur la fiche d'une organisation, le bouton **« Modifier »** remplace les caractéristiques par le
même formulaire, **prérempli**. **Vider** le domaine ou le site web l'efface. « Enregistrer » relit
la fiche à jour, et l'annonce « Organisation enregistrée » le confirme ; « Annuler » rend la fiche
sans rien écrire. Les refus sont ceux de la création.

## 11. Les boîtes de réception et les adresses d'expédition

Le CRM ne remplace pas votre messagerie : il s'y raccorde. Une **boîte de réception** déclarée lui permet de relever
le courrier et de le ranger dans les affaires ([chapitre 12](#l-inbox-lire-trier-et-repondre)) ; une **adresse
d'expédition** lui permet d'écrire en votre nom. Ce chapitre dit comment les déclarer, et ce que le produit garantit
ensuite.

### 11.1 Les boîtes de réception déclarées

**Ce que le produit sait faire.** Un espace de travail peut déclarer une **boîte système** — celle
qui reçoit tout ce qui est adressé aux affaires — et chaque personne peut déclarer **la sienne**.
Une boîte porte un serveur, un port, un mode de sécurité, un identifiant et un mot de passe.

**Où se fait la déclaration : « Réglages ▸ Comptes de messagerie entrante »**. L'écran
liste les boîtes que vous voyez, avec leur connexion et leur état, et porte un formulaire pour les
déclarer ou les corriger. Il vient **avant** « État de la messagerie » dans la liste des réglages :
on configure une boîte avant d'en superviser la relève.

- **Choisissez d'abord la boîte visée.** La liste propose les boîtes que vous voyez, plus celle que
  vous pouvez créer — la vôtre si vous n'en avez pas encore, et la boîte système de l'espace de
  travail. Choisir une boîte déjà déclarée remplit le formulaire de ses valeurs.
- **La boîte système et celle d'un collègue sont réservées à une administratrice ou un
  administrateur.** L'option reste proposée à tout le monde ; si vous n'administrez pas l'espace,
  « Configurer » et « Enregistrer » sont grisés sur ces boîtes, et un bandeau en tête de l'écran dit
  pourquoi. Votre propre boîte reste configurable ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)).
- **Le mot de passe est toujours vide à l'ouverture, et il n'est jamais affiché.** Le laisser vide
  **conserve** celui qui est enregistré ; le remplir le **remplace**. Sur une boîte qui n'existe
  pas encore, il est obligatoire — sans lui, aucune connexion ne serait possible.
- **Changer la connexion remet l'état à « En attente »** et efface le dernier incident : un
  « Connectée » obtenu avec l'ancien serveur ne dirait plus rien du nouveau.
- **Ce que l'écran n'offre pas**, et c'est écrit plutôt que suggéré : aucun bouton *Tester la
  connexion* — l'essai est fait par le service de messagerie, et son résultat s'affiche dans l'état
  de la boîte ; aucune **suppression** de boîte ; aucun réglage des dossiers relevés ni de la
  profondeur d'historique, que l'écran ne touche jamais.

Le reste du chapitre décrit ce que le produit garantit une fois la boîte déclarée.

**Le mot de passe n'est jamais relisible, par personne.** Il n'est pas conservé avec le reste de la configuration :
il part dans un coffre chiffré, qui n'est ouvert à aucune personne connectée — administrateur compris. Seul le service
de messagerie, qui doit ouvrir la connexion, peut obtenir le mot de passe en clair.

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

### 11.2 Les adresses d'expédition

**Où se fait la déclaration : « Réglages ▸ Identités d'expédition »**. L'écran liste
les adresses que vous voyez, avec leur connexion et leur état, et porte un formulaire pour les
déclarer ou les corriger. Il vient **après** « Comptes de messagerie entrante » et **avant** « État
de la messagerie » : on reçoit avant d'expédier, et on configure avant de superviser.

- **Une ligne commence par l'adresse**, précédée du nom affiché quand il est renseigné — sous la
  forme `Nom <adresse>`, celle que verront vos destinataires. C'est cette adresse qui distingue
  deux identités, et non leur libellé, qui peut être le même.
- **Choisissez d'abord l'identité visée.** La liste propose celles que vous voyez, plus deux
  entrées pour en déclarer une nouvelle : la vôtre, ou celle de service de l'espace de travail.
- **L'identité de service et celle d'un collègue sont réservées à une administratrice ou un
  administrateur.** L'entrée reste proposée à tout le monde ; si vous n'administrez pas l'espace,
  « Configurer » et « Enregistrer » sont grisés sur ces identités, et un bandeau en tête de l'écran
  dit pourquoi. Vos propres identités restent configurables ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)).
- **ATTENTION — changer l'adresse d'expédition ne renomme pas une identité : cela en déclare une
  seconde**, et la première demeure. L'adresse fait partie de ce qui identifie la configuration, au
  même titre que son propriétaire. L'écran vous le rappelle sous le champ, et la liste relue vous
  montre alors **deux** lignes. Si vous vouliez corriger une faute de frappe, retirez ensuite
  l'ancienne — ce que l'écran ne sait pas encore faire, voir plus bas.
- **Le mot de passe est toujours vide à l'ouverture, et il n'est jamais affiché.** Le laisser vide
  **conserve** celui qui est enregistré ; le remplir le **remplace**. Sur une identité qui n'existe
  pas encore, il est obligatoire. *Conséquence de la règle précédente* : si vous modifiez l'adresse
  sans saisir de mot de passe, le produit vous répond qu'un mot de passe est exigé — parce que la
  nouvelle adresse fait de votre enregistrement une déclaration, et non une correction.
- **Le nom d'expéditeur se vide en effaçant le champ**, contrairement au mot de passe : un champ
  vide y est une valeur, et non une absence de changement.
- **La case « identité par défaut » est cochée d'avance sur une déclaration**, parce que c'est ce
  que le produit ferait de toute façon. La décocher n'est utile que si vous en avez déjà une.
- **Ce que l'écran n'offre pas**, et c'est écrit plutôt que suggéré : aucun bouton *Tester la
  connexion* — l'essai est fait par le service de messagerie, et son résultat s'affiche dans l'état
  de l'identité ; aucune **suppression** ; aucun réglage du **plafond quotidien** d'envois (voir plus bas). La
  **signature**, elle, se règle sur ce même écran ([chapitre 15](#signer-les-messages-expedies-depuis-une-identite)).

Le reste du chapitre décrit ce que le produit garantit une fois l'adresse déclarée.

**Recevoir et expédier sont deux choses distinctes.** Une personne peut relever sa boîte
`bizdev@…` et pourtant écrire à ses clients depuis `contact@…` : le produit ne lie pas les deux. Une adresse
d'expédition porte son serveur d'envoi, son
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
causes d'échec affichées sont les mêmes que celles du [chapitre 11.1](#les-boites-de-reception-declarees).

**Une adresse peut porter un plafond d'envois quotidien.** Par défaut, elle n'en a aucun, et l'écran ne le règle pas.
Quand un plafond est atteint, tout nouveau message est refusé au moment où vous l'envoyez — « Cette adresse
d'expédition a atteint son plafond du jour. » — et le compte repart au jour suivant, compté en temps universel. Les messages déjà en attente
d'envoi comptent : le plafond protège le serveur d'envoi, pas une statistique.

## 12. L'inbox : lire, trier et répondre

L'**Inbox** de la barre latérale rassemble le courrier que le CRM a relevé dans les boîtes déclarées
([chapitre 11](#les-boites-de-reception-et-les-adresses-d-expedition)) : celui qu'il a rangé dans les affaires, et
celui qui attend d'être trié. On y lit, on y range, et l'on écrit depuis une affaire.

### 12.1 Ce que le produit fait d'un message reçu

**Les messages sont relevés, et rangés dans l'affaire à qui ils s'adressent.** Chaque affaire a son
adresse propre ([chapitre 9.2](#l-adresse-email-de-l-affaire)) ; un message envoyé à cette adresse est rattaché à l'affaire **tout
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

### 12.2 L'inbox : lire et trier le courrier reçu

*Écran « Inbox » de la barre latérale.*

L'inbox montre **trois panneaux** : les dossiers à gauche, la liste des messages au milieu, le
message lui-même à droite. Sous 1024 px de large, les trois deviennent une **pile** : on descend
d'un panneau au suivant, et un bouton « Retour » remonte d'un cran.

**Les dossiers.** « Non classés » vient toujours en premier, même quand il est vide : c'est
l'entrée du travail de tri. Viennent ensuite les affaires qui portent du courrier, rangées sous
leur track et leur channel. **Une affaire sans courrier n'apparaît pas** : l'inbox est une vue du
courrier reçu, pas une seconde copie du board. Chaque ligne affiche le nombre de messages **que
vous pouvez voir**, ce qui explique que deux personnes n'y lisent pas les mêmes nombres. Quand un
dossier contient des messages que vous n'avez pas encore lus, une **pastille bleue** en donne le
nombre, juste avant ce total, et le nom du dossier passe en gras.

**Qui voit quoi.** Un message déjà rangé dans une affaire se lit comme l'affaire : si vous pouvez
la lire, vous lisez son courrier. Un message **non classé**, lui, n'appartient encore à aucune
affaire : il est visible par le **propriétaire de la boîte** où il est arrivé, et par les
**administrateurs** de l'espace de travail. Si votre panneau « Non classés » affiche zéro, ce n'est
pas une panne : c'est qu'aucune boîte dont vous répondez n'a reçu de courrier en attente.

**La liste énumère des fils, pas des messages.** Une conversation — un premier message et les
réponses qui le citent — tient sur **une seule ligne**. Cette ligne porte l'expéditeur, l'objet et
la date de son **dernier** message, et, dès qu'elle en rassemble plusieurs, un petit **compte** à
côté de l'objet. Une conversation d'un seul message ressemble exactement à ce qu'elle était avant :
ni compte, ni rien d'autre à faire.

Le nombre affiché à côté d'un dossier, lui, continue de compter des **messages** : un dossier
annonçant « 2 » au-dessus d'une liste d'une seule ligne portant « 2 » dit la même chose deux fois,
et non deux choses différentes.

**Parcourir une conversation.** Ouvrir une ligne affiche son message le **plus récent**. Quand la
conversation en compte plusieurs, un encadré « Messages de ce fil » apparaît sous l'en-tête, avec
un bouton par message — le plus récent d'abord. Choisissez-en un autre et le panneau de lecture
change, **sans que la ligne perde sa sélection** : vous naviguez à l'intérieur de ce que vous avez
choisi, pas ailleurs.

**Lu et non lu.** Chaque personne a **son propre** état de lecture : ce que vous avez lu reste non
lu pour vos collègues, et inversement. Une conversation non lue se reconnaît à un **trait bleu** sur
son bord gauche et à son objet en gras ; un lecteur d'écran l'annonce par « Non lu ». **Ouvrir une
conversation la marque lue tout entière**, tous ses messages compris, et la pastille du dossier
baisse d'autant. Trois gestes complètent cela :

- dans l'en-tête du message ouvert, le bouton à l'enveloppe fermée, « **Marquer comme non lu** »,
  rend la conversation non lue — le message reste affiché, et il ne se remarque pas lu tant que vous
  ne l'avez pas rouvert. Le même bouton propose ensuite « **Marquer comme lu** » ;
- en tête de la liste, « **Tout marquer comme lu** » marque lues les conversations affichées. Il
  n'apparaît que lorsqu'il en reste au moins une non lue ;
- le courrier que vous **envoyez** n'est jamais « non lu » : seul le courrier reçu en porte l'état.

Seul l'écran de l'inbox marque un message comme lu. Le lire dans l'historique d'une affaire, le
retrouver par la recherche, ou le faire lire par un assistant à travers le connecteur ([chapitre 33](#le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant))
**ne change pas** son état. Si l'enregistrement
échoue, un message rouge le dit et **l'état affiché ne change pas** : l'écran ne montre jamais lu ce
qui n'a pas été enregistré. L'état de lecture n'est pas partagé avec votre logiciel de messagerie :
lire un message dans le CRM ne le marque pas lu dans votre boîte, et inversement.

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

**La suggestion de classement.** Quand l'expéditeur d'un message non classé est un **contact** de
votre carnet et qu'il n'est rattaché qu'à **une seule** affaire en cours, le produit vous le dit :
un encadré « **Suggestion de classement** » apparaît au-dessus du bouton « Classer dans une
affaire ». Il nomme l'affaire, la rend cliquable pour que vous puissiez aller la vérifier, écrit la
raison de la suggestion — « l'expéditeur est un contact rattaché à cette affaire » —, et propose
« **Classer dans cette affaire** », qui range le message d'un seul geste.

C'est une **suggestion, pas une décision** :

- elle ne range **rien** toute seule. Tant que vous n'avez pas appuyé, le message reste non classé ;
- « Classer dans une affaire » reste offert à côté, et propose **toutes** les affaires : une
  suggestion peut désigner la mauvaise, et vous gardez le dernier mot ;
- elle ne vous donne **aucun droit de plus**. Si vous n'avez pas le droit d'écrire sur l'affaire
  proposée, « Classer ici » est grisé et l'encadré dit pourquoi ; vous pouvez la consulter, ou
  ranger le message ailleurs ;
- elle n'apparaît que si vous **pouvez voir** l'affaire suggérée. Sinon, l'encadré n'est pas
  affiché du tout : le produit ne nomme jamais une affaire qui ne vous est pas ouverte ;
- elle est calculée **à l'arrivée du message** et n'est plus recalculée ensuite. Rattacher le
  contact à une seconde affaire ne la fait pas disparaître.

La plupart des messages n'en portent aucune, et c'est normal : la règle demande un expéditeur connu
**et** une seule affaire en cours.

**Tout se fait au clavier.** La tabulation parcourt les dossiers, la liste puis le message ;
Entrée ouvre. Le dossier retenu et le message ouvert sont annoncés aux lecteurs d'écran, et pas
seulement signalés par une couleur.

**Mettre un fil en sommeil.** Un **fil** rassemble les messages d'une même conversation. Sous
l'en-tête du message ouvert, « Mettre le fil en sommeil » ouvre un petit panneau : quatre échéances
usuelles — demain, dans trois jours, la semaine prochaine, le mois prochain — ou une échéance de
votre choix. Une fois le fil endormi :

- la conversation **entière disparaît de la liste** tant que l'échéance n'est pas passée — tous
  ses messages, pas seulement celui que la ligne montrait. Le message que vous êtes en train de
  lire, lui, reste affiché : rien ne disparaît sous votre doigt ;
- une **pastille** portant une petite lune et la date rappelle jusqu'à quand il dort, **une fois**
  sur la ligne de la conversation, et dans l'en-tête du message ;
- « **Réveiller le fil** » le ramène immédiatement, sans confirmation ;
- la case « **Afficher les fils en sommeil** », en haut de la liste, les fait tous réapparaître,
  reconnaissables à leur pastille. Si un dossier ne contient plus que des fils endormis, la liste
  vous le dit et vous propose la case au lieu d'un vide muet.

Le sommeil est **partagé** : un fil endormi l'est pour toute personne qui le voit. Il n'a pas besoin
d'être réveillé à la main — une échéance passée n'est plus un sommeil, et le fil revient tout seul.
Une échéance déjà passée est refusée, avec son motif écrit sous le champ.

**La case se retient dans l'adresse de la page** : vous pouvez recharger la page, la mettre en favori ou en envoyer
le lien à un collègue sans que la case se décoche. Elle vaut pour **tous les dossiers** de la boîte tant qu'elle
est cochée, et le bouton « Précédent » du navigateur la décoche comme il défait n'importe quel autre
geste. C'est exactement ce que fait déjà la case « Afficher les affaires en sommeil » du tableau et
de la vue liste d'un channel.

**Retirer un message d'une affaire.** Un message rangé dans la mauvaise affaire n'y reste pas.
Sous le message ouvert, en bas et séparée du reste, la commande « **Retirer de l'affaire** »
demande d'abord confirmation. La confirmation dit deux choses, et elles comptent toutes les deux :

- **rien n'est supprimé.** Le message quitte l'affaire et repasse dans les messages non classés,
  d'où vous pouvez le ranger ailleurs. Aucun courrier n'est détruit par ce geste ;
- **vous pourriez cesser de le voir.** Un message est visible soit parce que vous lisez l'affaire
  où il est rangé, soit parce qu'il est arrivé dans une boîte que vous suivez. Si seule la première
  raison s'applique à vous, le retrait vous en prive : le message existe toujours, mais il ne vous
  est plus ouvert, et c'est à une personne qui suit la boîte de le ranger de nouveau. La phrase
  vous le dit **avant** le geste, jamais après.

« Annuler » referme sans rien envoyer. Si vous ne pouvez pas modifier l'affaire où le message est
rangé, la commande est grisée et un bandeau dit pourquoi ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Le serveur reste la règle :
s'il refuse malgré tout, l'écran vous l'écrit sous la confirmation.

**L'affaire garde la mémoire des deux faits.** Dans l'historique de l'affaire, la ligne
« Message reçu » **reste** — le courrier y est bien arrivé, et le produit ne réécrit pas ce qui a
eu lieu — et une ligne « **Message retiré de l'affaire** » vient s'ajouter, avec l'objet du message
et le nom de la personne qui l'a retiré. Le geste se fait entièrement au clavier.

**Ce qui n'est pas encore là.** L'inbox n'a pas de recherche propre — la recherche de l'en-tête trouve les messages
([chapitre 4](#retrouver-n-importe-quoi-la-recherche)). La liste montre les cinquante messages les plus récents d'un
dossier, et le dit lorsqu'elle en laisse de côté. **Ce sont bien cinquante messages, pas cinquante conversations** : une
conversation dont une partie seulement tient dans ces cinquante n'en affiche que cette partie, et son compte porte sur
ce qui est affiché. Un message dont l'expéditeur n'a pas transmis de quoi retrouver la conversation reste sur sa propre
ligne.

### 12.3 Écrire et répondre

*Depuis la fiche d'une affaire, ou depuis un message de l'inbox.* Pour enchaîner plusieurs envois à des délais
choisis, voyez les séquences ([chapitre 16](#enchainer-des-relances-les-sequences)).

**Écrire depuis une affaire.** La fiche porte un bouton « Écrire un message ». Choisissez l'adresse
d'expédition, un ou plusieurs destinataires — séparés par une virgule ou un point-virgule —, un
objet et un message, puis « Mettre en file ».

**Une copie cachée.** Sous les destinataires, le lien « **Ajouter Cci** » ouvre le champ « Copie cachée (Cci) ». Ces
adresses reçoivent le message **sans qu'aucun autre destinataire ne le sache** : rien, dans le message reçu, ne les
nomme. Elles restent en revanche **visibles dans l'affaire** — l'inbox affiche « Cci : … » sur le message envoyé —, parce
que la copie cachée est cachée aux destinataires, pas à votre équipe.

**Des pièces jointes.** « **Joindre des fichiers** » (le trombone) ouvre le sélecteur de votre ordinateur ; vous pouvez
aussi déposer des fichiers sur le formulaire. Chaque fichier part aussitôt vers le produit — la ligne dit « Envoi du
fichier… » — puis s'affiche avec sa taille et un bouton pour le retirer. Sous la liste, le total est écrit : « 2 fichiers,
3,4 Mo sur 10 Mo ».

- **Dix fichiers et 10 Mo au total**, au plus, par message. Au-delà, le bouton « Mettre en file » s'éteint et le
  formulaire dit lequel des deux plafonds est dépassé ; retirez des fichiers pour continuer. Le bouton reste aussi éteint
  tant qu'un fichier est en cours d'envoi.
- **Un nom accentué est simplifié** : « Proposition révisée.pdf » part sous le nom « Proposition revisee.pdf ».
- **Retirer un fichier, ou annuler le formulaire, le supprime** du produit. Un fichier abandonné autrement — un onglet
  fermé — est effacé de lui-même au bout de 24 heures.
- **Les fichiers envoyés restent dans l'affaire** : le message envoyé les montre comme ceux d'un message reçu. Quand
  l'analyse antivirus est en place, un fichier sain se télécharge, et **un fichier infecté empêche le message de
  partir** : il est marqué en échec, et le dit. Sans antivirus, le message part et ses fichiers sont « non analysés »,
  donc non téléchargeables, comme les pièces reçues.

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
| Une pièce jointe n'est plus disponible | La retirer, puis la joindre de nouveau |
| Les pièces jointes dépassent le plafond | Retirer des fichiers : 10 au plus, 10 Mo au total |

**Votre texte n'est jamais perdu** : un refus laisse le formulaire ouvert, avec ce que vous aviez
écrit.

**Ce qui n'est pas encore là.** Joindre une pièce **déjà reçue** dans l'affaire : un fichier se prend sur votre
ordinateur. Un message qui échoue à partir est marqué en échec et le dit.

## 13. Consulter l'état de la messagerie

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

### 13.1 Ce qui n'est pas encore là

- **Aucune alerte n'est envoyée** lorsqu'un compte tombe en erreur : cet écran est le seul endroit où
  le constater.
- **La relève n'est pas instantanée** : elle a lieu à intervalles réguliers, fixés à l'installation du CRM et non
  depuis cet écran. Un message arrivé dans votre boîte paraît dans le CRM au passage suivant.

## 14. Écrire des modèles d'emails et les prévisualiser

**Où.** Barre latérale ▸ **Réglages** ▸ « Modèles d'emails ».

**À quoi cela sert.** Un modèle est un texte que vous écrivez **une fois** et que tout l'espace de
travail réemploie : une relance sans réponse, une prise de contact. Il porte des **trous** —
`{{card.title}}`, `{{contact.full_name}}` — que le produit remplace par les valeurs de l'affaire
concernée. Deux personnes qui écrivent au même prospect envoient ainsi le même texte.

**Qui.** Tout membre de l'espace de travail **lit** les modèles et peut les prévisualiser. Les
**écrire** — créer, modifier, supprimer — est réservé aux administrateurs et aux business developers. Pour un autre
rôle, ces commandes restent visibles, grisées, et un bandeau dit pourquoi
([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)).

**La liste.** Une ligne par modèle : son **nom** — unique dans l'espace de travail — puis son
**objet**. L'objet y est montré **tel qu'il est écrit**, trous compris : la liste n'est pas une
prévisualisation, et elle n'a pas d'affaire sur laquelle remplir les trous.

### 14.1 Écrire un modèle

« Nouveau modèle » ouvre la fiche, sous la liste — jamais dans une fenêtre qui recouvrirait l'écran.
Trois champs : le **nom**, l'**objet** et le **corps du message**.

**Les variables disponibles sont proposées sous le corps**, en douze boutons. Un clic insère la
variable **à l'endroit du curseur**, dans le champ que vous venez de quitter — l'objet ou le corps.
Vous pouvez aussi les taper à la main : rien ne vous en empêche.

**Une variable qui n'existe pas est refusée**, et le produit dit **dans quel champ** elle se trouve :
« L'objet emploie une variable qui n'existe pas ». C'est le serveur qui refuse, pas l'écran — ce qui
signifie que la faute ne peut pas passer par un autre chemin et se découvrir chez le destinataire.
Votre saisie n'est pas effacée : corrigez la variable et réenregistrez.

Les autres refus sont dits de la même façon : un nom de plus de 120 caractères, un objet de plus de
300, un corps de plus de 20 000, ou un nom déjà employé par un autre modèle.

### 14.2 Prévisualiser un modèle sur une affaire réelle

« Prévisualiser », sur la ligne d'un modèle, ouvre un panneau à trois choix :

- **l'affaire** — obligatoire. Aucune n'est choisie d'avance : le produit ne devine pas de quelle
  affaire vous voulez parler ;
- **le contact** — facultatif. La liste porte **tous** les contacts que vous pouvez lire, et pas
  seulement ceux qui sont rattachés à l'affaire choisie ;
- **l'identité d'expédition** — facultative. Aucune n'est choisie d'avance non plus : plusieurs
  identités peuvent être « par défaut », chacune pour une personne, et le produit ne tranche pas à
  votre place.

« Prévisualiser » affiche alors l'**objet** et le **corps** exactement tels qu'ils partiront, retours
à la ligne compris.

**Les trous sans valeur sont NOMMÉS.** Si l'affaire n'a pas de montant, ou si vous n'avez choisi
aucune identité, le produit rend ces trous **vides** — jamais un tiret, qui se lirait comme une
valeur — et l'écrit sous le message : « 2 variables sans valeur », suivi de la liste des variables
concernées, dans la graphie exacte que vous avez tapée. C'est ce qui vous permet de voir le manque
**avant** l'envoi, plutôt que le destinataire après.

Quand toutes les variables employées ont une valeur, **rien n'est affiché** : l'absence de message
dit déjà que tout est rempli.

**Si aucune affaire n'est choisie**, ou si l'affaire choisie ne vous est plus lisible, le produit
écrit « Aucun rendu : choisissez une affaire, ou l'affaire choisie n'est plus lisible ». Les deux
causes sont volontairement dites ensemble : les distinguer révélerait l'existence d'affaires que vos
droits vous cachent.

### 14.3 Supprimer un modèle

Le bouton vit **dans la fiche** du modèle, et non sur sa ligne : un geste qui détruit ne se déclenche
pas depuis une liste qu'on parcourt du regard. Il demande une confirmation qui **nomme** le modèle et
dit ce qui est perdu : « Le texte du modèle est définitivement perdu. »

Il n'y a **pas de corbeille** pour un modèle : il ne contient aucun travail, c'est un texte. Une fois
supprimé, il faut le réécrire.

### 14.4 Ce qui n'est pas encore offert

- **Aucun envoi depuis cet écran.** La prévisualisation montre ; elle n'expédie rien. Un modèle part par une
  **séquence de relance** ([chapitre 16](#enchainer-des-relances-les-sequences)) ; le formulaire « Écrire un message »
  d'une affaire ne propose pas encore de partir d'un modèle.
- **La signature** n'appartient pas au modèle : elle est celle de l'identité d'expédition, ajoutée à la fin de chaque
  message ([chapitre 15](#signer-les-messages-expedies-depuis-une-identite)).
- **Les dates sont rendues en UTC.** Une échéance affichée « 16/08/2026 09:00 » dans un message est
  exprimée en temps universel : le produit ne connaît pas encore le fuseau de votre espace de
  travail. Un destinataire français lira donc 09:00 là où le rendez-vous est à 11:00 en heure d'été.

## 15. Signer les messages expédiés depuis une identité

**Où.** Barre latérale ▸ **Réglages** ▸ « Identités d'expédition », puis « Configurer » sur
l'identité concernée.

**À quoi cela sert.** Une signature est le pied de message que vos destinataires liront sous chaque
courriel parti depuis cette adresse : votre nom, votre fonction, votre société, un téléphone. Vous
l'écrivez **une fois**, et le produit l'ajoute ensuite à **tous** les messages expédiés depuis cette
identité — ceux que vous composez à la main comme ceux que le produit enverra pour vous.

**La signature appartient à l'ADRESSE, pas à vous.** Si vous expédiez depuis deux adresses —
`contact@` et `recrutement@`, par exemple —, chacune porte la sienne, et vous les remplissez
séparément. C'est voulu : on ne signe pas de la même façon selon l'adresse sous laquelle on écrit.
L'identité de service de l'espace de travail, qui n'appartient à personne en particulier, a elle
aussi la sienne.

### 15.1 Écrire, modifier, supprimer une signature

Le champ **Signature** se trouve dans le formulaire, juste après le nom d'expéditeur. Il accepte
plusieurs lignes, et les conserve telles que vous les écrivez : les retours à la ligne et les
alignements que vous posez sont ceux que votre destinataire verra.

- **Écrire** : remplissez le champ, puis « Enregistrer ». C'est immédiat, et cela vaut pour le
  prochain message.
- **Modifier** : rouvrez « Configurer ». Le champ est prérempli avec la signature enregistrée — le
  produit ne vous demande jamais de la réécrire de mémoire.
- **Supprimer** : **videz le champ**, puis « Enregistrer ». La signature disparaît, et les messages
  suivants partent sans elle.

Une signature est limitée à **2 000 caractères**. Au-delà, l'enregistrement est refusé et le produit
vous le dit : rien n'est écrit à moitié.

### 15.2 Où la signature apparaît dans le message

Elle est ajoutée **à la fin** du corps, après une ligne vide et une ligne de séparation composée de
deux tirets. C'est la convention que les logiciels de messagerie reconnaissent pour replier ou
griser une signature :

```
Bonjour,

voici le devis dont nous avons parlé.

-- 
Camille Martin — Business developer
Votre société
```

**Ce que vous voyez dans le CRM est exactement ce qui est parti.** Le message conservé par le
produit porte sa signature : il n'y a pas d'un côté ce que vous avez écrit et de l'autre ce que
votre destinataire a reçu.

**Dans la liste des identités**, une pastille « Signature » marque les identités qui en portent une.
La signature elle-même n'y est pas montrée — elle serait trop longue pour une ligne de liste ; c'est
sa **présence** qui vous intéresse d'un coup d'œil.

### 15.3 Ce qui n'est pas offert

- **Une signature est du texte, jamais de la mise en forme riche.** Pas de gras, pas de logo, pas de
  lien cliquable : toute la messagerie du produit expédie du texte, et une signature en HTML
  arriverait chez votre destinataire avec ses balises en toutes lettres.
- **Aucun trou dans une signature.** `{{contact.full_name}}` écrit dans une signature part
  **littéralement**. Les trous sont une propriété des modèles d'emails ([chapitre 14](#ecrire-des-modeles-d-emails-et-les-previsualiser)), pas des
  signatures.
- **Un message vide ne part pas, même signé.** Si vous laissez le corps vide, le produit refuse
  l'envoi : une signature seule n'est pas un message.
- **Aucune signature commune à tout l'espace de travail.** Chaque identité porte la sienne, ou n'en
  porte pas.

## 16. Enchaîner des relances : les séquences

**Où.** Deux endroits, et le partage est délibéré : la **cadence** s'écrit dans Barre latérale ▸
**Réglages** ▸ « Séquences de relance » ; elle **s'arme** depuis la fiche de l'affaire qu'elle doit
relancer, dans le bloc « Relance automatique », sous les coûts.

**À quoi cela sert.** Une séquence enchaîne plusieurs **modèles d'emails** ([chapitre 14](#ecrire-des-modeles-d-emails-et-les-previsualiser)) à des délais
choisis. Armée sur une affaire qui n'avance plus, elle expédie le premier modèle après son délai, le
deuxième après le sien, et ainsi de suite — **et elle s'arrête dès qu'une réponse arrive**.

**Qui.** Tout membre de l'espace de travail **lit** les séquences. Les **écrire** — créer, modifier,
réordonner, supprimer — est réservé aux administrateurs et aux business developers. **Armer** une relance sur une
affaire suppose le droit d'y **écrire**. Sans ce droit, les commandes restent visibles, grisées, et un bandeau dit
pourquoi ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)) ; le serveur reste la règle, et
un refus de dernière minute s'écrit sous la commande.

### 16.1 Écrire une cadence

« Nouvelle séquence » ouvre la fiche, sous la liste. Un seul champ pour commencer : le **nom**,
unique dans l'espace de travail.

**Les paliers n'apparaissent qu'une fois la séquence enregistrée**, et ce n'est pas une contrainte
d'écran : un palier appartient à une séquence, et il ne peut pas être posé avant qu'elle existe. La
fiche vous le dit — « Enregistrez la séquence pour lui ajouter des paliers ».

**Un palier, c'est un modèle et un délai.** Choisissez le modèle dans la liste, tapez le délai en
jours, « Ajouter le palier ». Le palier prend le **rang suivant** : vous n'avez jamais à saisir une
position.

**LE DÉLAI SE COMPTE DEPUIS LE PALIER PRÉCÉDENT**, et le tout premier depuis l'armement. C'est ce
que « J+3 », « J+7 », « J+14 » veulent dire dans la liste : trois jours après l'armement, puis sept
jours après le premier envoi, puis quatorze après le deuxième. Un palier glissé au milieu d'une
cadence ne vous oblige donc à rien renuméroter.

**Le délai va de 1 à 365 jours.** Zéro est refusé : un palier de délai nul partirait en même temps
que celui qui le précède, ce qui n'est pas une cadence mais un doublon.

**Un même modèle peut servir plusieurs paliers** : les paliers 1 et 3 d'une cadence peuvent employer tous deux
« Relance sans réponse ».

### 16.2 Changer l'ordre des paliers

Deux flèches par ligne, **Monter** et **Descendre**. La flèche qui n'a pas de sens — monter le
premier, descendre le dernier — reste **visible mais inactive** : elle ne disparaît pas, sans quoi
les boutons sauteraient d'une ligne à l'autre sous votre curseur.

**L'ordre est enregistré immédiatement**, et la liste est **relue** : ce que vous voyez après un
déplacement est ce que le produit a réellement retenu, jamais un affichage optimiste. Si vos droits
ne permettent pas l'écriture, le produit écrit « Aucun palier n'a été réordonné » — jamais un succès
qui n'a pas eu lieu.

**« Retirer » ne demande aucune confirmation**, et c'est voulu : retirer un palier ne détruit aucun
texte. Le modèle reste, la séquence reste, et reposer le palier est un formulaire de deux champs.

### 16.3 Supprimer une séquence

Le bouton vit **dans la fiche**, jamais sur la ligne de la liste : un geste destructeur ne se
déclenche pas depuis une liste qu'on parcourt. La confirmation **nomme la séquence** et dit combien
de paliers partiront avec elle.

**Une séquence qui relance actuellement une affaire ne peut pas être supprimée**, et la confirmation
vous en avertit avant que vous ne cliquiez. Interrompez la relance depuis l'affaire concernée, puis
réessayez.

**Un modèle employé par une séquence ne peut pas être supprimé non plus** ([chapitre 14](#ecrire-des-modeles-d-emails-et-les-previsualiser)) : retirez-le
d'abord des paliers qui l'emploient.

### 16.4 Armer une relance sur une affaire

Ouvrez la fiche de l'affaire, descendez jusqu'au bloc **« Relance automatique »**. Deux choix : la
**séquence**, et l'**adresse d'expédition** depuis laquelle les messages partiront. Aucun des deux
n'est présélectionné — le produit ne choisit pas à votre place l'adresse qui signera vos relances.

**L'affaire doit être « figée »**, c'est-à-dire immobile dans son étape depuis plus longtemps que le
seuil de relance de cette étape ([chapitre 7](#les-affaires-figees-ce-qui-dort-depuis-trop-longtemps)). Si elle ne l'est pas, le produit vous le
dit : « Cette affaire n'a pas dépassé le seuil d'inactivité de son étape ». Faites avancer l'affaire,
ou attendez — une relance automatique n'a de sens que sur une conversation qui s'est arrêtée.

**Une seule relance à la fois par affaire.** Si une autre personne en a armé une entre-temps, le
produit refuse la seconde plutôt que d'envoyer deux fois.

**Ce que le bloc montre ensuite** : le nom de la séquence, l'adresse qui expédie, et où en est la
cadence — « Aucun palier envoyé pour l'instant », puis « Palier 2 envoyé le 12/09/2026 ».

**« Interrompre la relance »** ferme la cadence. Le bloc revient alors à son geste, et il ne
l'annonce qu'après avoir **vérifié** que la relance est bien close.

### 16.5 Ce qui arrête une relance, sans que vous ayez rien à faire

Quatre choses la terminent, et trois d'entre elles ne vous demandent aucun geste :

1. **une réponse du destinataire arrive sur l'affaire** — c'est la raison d'être de la cadence, et
   relancer quelqu'un qui vient de répondre est le seul défaut qu'un système de relance ne doit
   jamais avoir ;
2. **l'affaire cesse d'être figée** : vous la faites avancer d'une étape, vous la mettez en sommeil,
   vous l'archivez ou vous la mettez à la corbeille ;
3. **le dernier palier est parti** : la cadence est épuisée ;
4. **vous l'interrompez** depuis le bloc.

### 16.6 Ce qui n'est pas offert

- **Aucune date de prochain envoi n'est affichée.** La cadence **glisse** sur les envois réels : un
  palier parti avec un jour de retard décale tous les suivants d'autant. Une date annoncée serait
  fausse au premier décalage, et le produit préfère ne rien dire plutôt que dire faux.
- **Aucune prévisualisation d'une séquence entière.** Prévisualisez ses modèles un par un depuis
  l'écran des modèles ([chapitre 14.2](#previsualiser-un-modele-sur-une-affaire-reelle)).
- **Aucune trace dans l'historique de l'affaire.** L'armement et l'interruption n'y écrivent rien.
- **Les relances passées ne sont pas listées.** Le bloc porte un geste, pas une histoire.
- **Aucun réordonnancement à la souris par glisser-déposer.** Les deux flèches font le même travail,
  et elles restent utilisables au clavier.
- **Aucune duplication de séquence**, aucun archivage, aucune corbeille : une séquence se supprime
  ou se garde.

## 17. Administrer l'arborescence : tracks et channels

**Où.** Barre latérale ▸ **Réglages** ▸ « Arborescence : tracks et channels ».

**L'index.** Ouvrir « Réglages » affiche d'abord l'index des sections de réglages, sous le titre « Sections de
réglages » ; « Arborescence : tracks et channels » en est une entrée.

**Qui.** L'écriture est réservée aux **administrateurs** de l'espace de travail. Les autres membres
voient l'arborescence — ils ont le droit de la lire — et leurs modifications sont refusées par le
serveur avec le message « Seul un administrateur de cet espace de travail peut modifier
l'arborescence. »

**Les boutons ne sont pas masqués pour autant** : ils restent visibles, grisés, et un bandeau dit pourquoi
([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Si votre rôle change pendant que la page
est ouverte, c'est la réponse du serveur qui s'affiche.

### 17.1 Un track

- **Créer** : bouton « Nouveau track ». Le **slug** — l'identifiant qui apparaît dans l'adresse — est
  proposé à partir du nom et reste modifiable tant que vous n'avez pas validé. Il n'accepte que des
  minuscules, des chiffres et des tirets simples ; le formulaire le dit avant l'envoi, et le serveur
  refuse un slug déjà pris dans l'espace de travail avec « Ce slug est déjà utilisé. »
- **Renommer** : le crayon. Vous modifiez le nom, la couleur, l'icône et la description.
- **Choisir la couleur** : le champ « Couleur » propose cinq couleurs, chacune avec sa pastille et son nom — Bleu,
  Vert, Jaune, Rouge, Gris. Cliquez sur celle que vous voulez, ou, au clavier, atteignez le groupe avec `Tab` et
  changez de couleur avec les flèches. Un nouveau track est Gris tant que vous n'en choisissez pas d'autre. La couleur
  colore sa pilule dans la barre latérale et dans cet écran.
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
  ([chapitre 20](#la-corbeille-ce-qui-a-ete-retire-et-comment-le-rendre)).

**La barre latérale suit vos gestes, sans rechargement** : un track créé y paraît aussitôt, un track
renommé ou recoloré y change, un track archivé ou mis à la corbeille la quitte — et il y revient
dès que vous le désarchivez ou le restaurez depuis la corbeille. L'ancienne liste reste affichée le
temps de la mise à jour : la barre ne clignote pas.

**Aucun geste ne supprime définitivement**, et ce n'est pas un oubli : archiver masque ; mettre à la corbeille
retire. Les deux sont réversibles. Seul un objet resté **30 jours** dans la corbeille est effacé, automatiquement
([section 20.3](#l-effacement-definitif)).

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

### 17.2 Un channel

Dépliez un track avec le chevron : ses channels sont chargés à ce moment-là, et pas avant.

Les mêmes six gestes s'appliquent, avec deux différences :

- **L'ordre d'un channel se compte dans son track**, pas dans l'espace de travail entier ;
- **choisir un workflow est obligatoire.** La liste ne propose que les workflows réellement
  affectables : ceux de l'espace de travail entier, et ceux propres à ce track. Le workflow par
  défaut est présenté en tête et signalé comme tel, **mais il n'est pas coché** — le produit ne
  choisit pas à votre place. Tant qu'aucun workflow n'est choisi, « Créer » reste indisponible.

**Un channel a sa propre couleur.** Elle se choisit comme celle d'un track, avec les mêmes cinq
couleurs, à la création comme en modification, et un nouveau channel est Gris tant que vous n'en choisissez pas
d'autre. Elle s'affiche en **pastille** devant le nom de son onglet ([section 3.4](#les-onglets-d-un-track)) et en **pilule** dans
l'arborescence. Elle aide à repérer un channel d'un coup d'œil ; elle ne remplace jamais son nom.

Si aucun workflow n'est affectable à ce track, l'écran vous le dit au lieu d'afficher un formulaire
que le serveur refuserait. C'est le cas d'un espace neuf : le guide de démarrage pose alors le
workflow de départ en un geste ([§2.4](#le-workflow-de-depart-en-un-geste)), et un formulaire resté ouvert le propose aussitôt.

**Le channel a besoin d'un workflow qui n'existe pas encore ?** Le lien **Nouveau workflow**, sous la
liste des workflows, ouvre l'éditeur de workflows avec son formulaire de création déjà ouvert, la
portée réglée sur ce track — vous pouvez choisir « Global ». Créez le workflow, ajoutez-lui ses
étapes, puis cliquez **Revenir au nouveau channel**, dans le bandeau en haut de l'éditeur : le
formulaire du channel se rouvre là où vous l'aviez laissé — dans la vue du track ou dans
l'arborescence —, avec le nom, l'identifiant, la couleur et la description déjà saisis, et le workflow créé déjà
choisi.

- Le lien n'existe que dans le formulaire de **création** ; changer le workflow d'un channel existant
  reste un geste de modification.
- Un workflow créé **propre à un autre track** ne peut pas être choisi pour ce channel : le formulaire
  le dit sous la liste, et attend votre choix.
- Rien n'est créé tant que vous n'avez pas cliqué **Créer** dans le formulaire du channel : quitter
  l'éditeur par un autre chemin laisse le workflow créé, mais aucun channel.

**Changer le workflow d'un channel qui porte des affaires.** Le formulaire de
modification ne change que le workflow d'un channel **vide** : sur un channel qui porte des affaires, il refuse et vous
renvoie à la commande **Changer de workflow** de la ligne du channel (l'icône d'un petit schéma, entre le crayon et
l'archivage). Elle ouvre un panneau sous la ligne, qui nomme le workflow actuel :

1. Choisissez le **nouveau workflow** — un workflow global, ou propre à ce track, non archivé.
2. Sous « Où vont les affaires », chaque étape **occupée** du workflow actuel est listée avec son nombre d'affaires
   (affaires archivées et en corbeille comprises). Choisissez pour chacune sa **destination** dans le nouveau workflow.
   **Rien n'est choisi à votre place** : tant qu'une étape n'a pas sa destination, « Changer de workflow » reste
   indisponible. Un channel sans affaire le dit, et n'attend que le nouveau workflow.
3. Cliquez **Changer de workflow**. Si des affaires ont répondu à des questions de formulaire que le nouveau workflow
   ne connaît pas, le changement s'arrête et le panneau dit **combien de réponses seraient perdues**. Il ne les supprime
   jamais sans votre accord : cochez « J'accepte de perdre ces réponses », puis cliquez à nouveau sur **Changer de
   workflow** — ou annulez.

Le changement est fait d'un bloc : toutes les affaires passent à leur destination en même temps, et chacune garde une
trace « workflow changé » dans son fil. Un message confirme le nouveau workflow. Comme les autres commandes de
l'arborescence, celle-ci demande d'administrer l'espace de travail.

### 17.3 Quand un déplacement est indisponible sans être en bout de liste

Il arrive qu'une flèche soit désactivée alors que la ligne n'est ni en tête ni en fin. L'infobulle
l'explique : deux positions voisines sont **indistinctes**, et le déplacement ne changerait rien à
l'ordre affiché. Le produit préfère le dire plutôt que d'écrire une valeur sans effet. Remettre une
telle liste d'aplomb demande une renumérotation, qui n'est pas encore livrée.

### 17.4 Ce qui n'est pas encore là

- Une **affaire** se met à la corbeille depuis sa fiche ([section 9.15](#mettre-une-affaire-a-la-corbeille)), pas
  depuis cet écran.
- Le **déplacement d'un channel vers un autre track** n'est pas proposé.
- La composition des **workflows** — étapes, transitions, questions et leur visibilité étape par étape — relève du
  [chapitre 18](#composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire).
- Les **droits fins** par track et par channel relèvent de la [section 21.6](#les-droits-fins-restreindre-ou-rouvrir-un-track-ou-un-channel).

## 18. Composer un workflow : ses étapes, ses transitions et son formulaire

**Où.** Barre latérale ▸ **Réglages** ▸ « Workflows : étapes et composition ».

**Ce que cet écran fait, et ce qu'il ne fait pas.** Il **compose** les workflows qui existent
déjà : il choisit leurs étapes dans le catalogue de nœuds, les ordonne, les surcharge, désigne
celle par laquelle les affaires entrent, déclare les **transitions** qui relient les étapes, et
définit les **questions du formulaire** posées sur chaque affaire. Il **crée** aussi un workflow
([section 18.1](#creer-un-workflow)), et son en-tête le renomme, le copie vers un track, le rend par défaut, l'archive
et le rétablit ([section 18.4](#choisir-un-workflow)).

**Qui.** L'écriture est réservée aux **administrateurs** de l'espace de travail. Comme au
[chapitre 17](#administrer-l-arborescence-tracks-et-channels), les boutons ne sont pas masqués aux autres membres : le refus affiché est celui du
serveur, « Seul un administrateur de cet espace de travail peut composer un workflow. »

### 18.1 Créer un workflow

Le bouton **« Nouveau workflow »**, au-dessus de la liste de gauche, ouvre un formulaire à deux ou
trois champs :

- le **nom**, obligatoire — deux workflows peuvent porter le même, rien ne l'interdit ;
- la **portée** : « Global », disponible pour tous les tracks, ou « Propre à un track », proposé
  aux seuls channels de ce track ;
- le **track**, qui n'apparaît que sous la seconde portée. Sous « Global », il n'existe pas : ce
  n'est pas un champ grisé, c'est un champ sans objet.

**Le workflow naît vide.** Il n'a aucune étape, et il n'est utilisable par aucun channel tant que
vous ne lui en avez pas donné au moins une, désignée comme initiale ([chapitre 18.5](#les-etapes)). L'écran le
dit dès la création : « Ce workflow n'a aucune étape. » Un workflow sans étape initiale est un
brouillon parfaitement licite, pas une erreur. Un channel qui le suit n'a pas de tableau : son onglet
le dit, et propose le lien **Ouvrir l'éditeur de workflows** ([chapitre 3.4](#les-onglets-d-un-track)).

Le workflow créé devient aussitôt le workflow **choisi**, prêt à être composé.

**Ce que le formulaire ne propose pas, et pourquoi.** Aucune case « par défaut » : un espace de
travail n'a qu'un seul workflow par défaut, et le proposer à chaque création reviendrait à offrir
un réglage refusé neuf fois sur dix. Un workflow devient le défaut par la commande « Définir par défaut » de son
en-tête ([section 18.4](#choisir-un-workflow)).

**Arrivé depuis le formulaire d'un channel** (lien **Nouveau workflow**, [chapitre 17.2](#un-channel)), l'éditeur
s'ouvre formulaire de création ouvert, portée réglée sur le track du channel, et un bandeau rappelle
« Vous créez un channel ». Une fois le workflow créé — par ce formulaire ou par **Créer avec l'IA** —,
le bandeau le nomme : c'est lui qui sera choisi au retour. Composez-le, puis **Revenir au nouveau
channel**.

**Si l'espace de travail est vide**, l'écran affiche « Aucun workflow dans cet espace de travail »
et porte le même bouton. Un workflow composé ainsi part d'un catalogue de nœuds **vide** dans un
espace neuf : le plus court est souvent le workflow de départ du guide ([§2.4](#le-workflow-de-depart-en-un-geste)), que vous
recomposez ensuite ici.

### 18.2 Créer un workflow avec l'IA

L'assistant IA **propose** un workflow à partir d'une description écrite en français ; **il ne crée
rien**. Ce qu'il rend est une **suggestion** : vous la relisez, la corrigez, la faites revoir autant de
fois que nécessaire, puis vous l'acceptez — et c'est seulement alors que le workflow existe — ou vous
l'abandonnez, sans que rien n'ait été écrit. Le panneau le rappelle en permanence : « Suggestion — rien
n'est créé avant « Accepter » ».

**Où.** Le bouton **« Créer avec l’IA »**, juste après « Nouveau workflow », au-dessus de la liste de
gauche — et dans l'écran vide d'un espace qui n'a encore aucun workflow.

**Qui.** L'assistant est réservé aux **administrateurs** de l'espace de travail. Le bouton est montré à
tout le monde ; un autre membre qui l'utilise reçoit le refus du serveur : « L’assistant est réservé aux
administrateurs de l’espace de travail. »

**1. Demander.** Écrivez dans **« Décrivez le workflow »** ce dont vous avez besoin : les étapes, les
issues — gagné, perdu —, les informations à saisir sur une affaire. Le texte part vers le serveur d'IA
de LeLabs : **n'y collez aucune donnée personnelle** — ni nom de client, ni adresse, ni contenu de
message. Puis **« Générer la suggestion »**. La réponse prend environ une demi-minute ; le panneau le
dit, avec le temps écoulé. Si l'assistant est indisponible, le panneau le dit et vous pouvez toujours
créer le workflow à la main.

**2. Relire.** La suggestion s'affiche à la place du workflow choisi, dans l'ordre de l'éditeur : le
nom, les étapes — chacune dit si son nœud est **nouveau** ou vient **du catalogue** —, les transitions
au départ de chaque étape, les champs, leur visibilité par étape et les champs exigés pour franchir une
transition. Si la proposition a des **défauts** — deux étapes initiales, une transition vers une étape
qui n'existe pas, une liste sans choix… —, ils sont listés en tête, et la suggestion **ne peut pas être
acceptée** tant qu'ils demeurent.

**3. Corriger à la main.** Dans l'aperçu, vous pouvez renommer le workflow ; donner à **chaque étape**
son propre nom (**« Nom de l’étape »**) et sa propre probabilité (**« Probabilité de l’étape »**) — laissés
vides, l'étape garde le nom et la probabilité de son nœud, que le champ montre en gris (un nom qui ne
diffère de celui du nœud que par les majuscules n'est pas un nouveau nom : l'étape garde celui de son nœud, et
un nom déjà donné à l'étape ne change pas si seules ses majuscules changent) ; changer le
libellé, la nature et la probabilité d'un nœud nouveau ; choisir l'étape initiale ; retirer une étape, une
transition, un champ, une règle ou une exigence ; ajouter une transition ; changer le type, les choix,
la devise ou l'aide d'un champ. Un retrait emporte ce qui en dépend — retirer une étape retire aussi
ses transitions et les règles qui la visent — et l'écran annonce ce qui a été emporté. Vos modifications
restent locales jusqu'à **« Enregistrer la correction »** ; « Rétablir » les annule. Ajouter une étape
ou un champ se demande à l'IA, ou se fait ici même une fois le workflow créé.

**4. Faire revoir.** Écrivez une consigne — « ajoute une étape de relance », « rends perdu possible
depuis chaque étape » — puis **« Revoir avec l’IA »**. L'IA reprend la proposition **telle qu'elle est
affichée**, vos corrections comprises, avec les défauts relevés, et rend une nouvelle version.
L'historique, en bas du panneau, garde chaque version : proposée par l'IA ou corrigée à la main, avec
sa consigne.

**5. Accepter ou abandonner.** **« Accepter et créer le workflow »** crée en une seule fois le workflow,
ses nouveaux nœuds de catalogue, ses étapes, transitions, champs, règles et exigences. Le serveur
revérifie tout à ce moment : si le catalogue a changé entre-temps, il refuse et dit combien de défauts
la proposition porte. Le workflow créé devient le workflow choisi, prêt à être affecté à un channel ;
il n'est pas le workflow par défaut si l'espace en a déjà un. **« Abandonner la suggestion »**, après
confirmation, la retire de la liste ; rien n'a été créé.

**Réutiliser le catalogue.** Une étape peut viser un nœud qui existe déjà au catalogue de l'espace tout en
portant un autre nom : l'IA y est invitée — par exemple l'étape « Premier contact » sur le nœud
« Prospection ». Quand elle redéclare malgré tout un nœud du catalogue, le défaut le dit, et
**« Utiliser le nœud du catalogue »** fait viser le nœud existant **en gardant le nom** que la suggestion
donnait à l'étape — et sa probabilité, si elle diffère ; un nom qui ne diffère de celui du catalogue que par
les majuscules n'est pas gardé. Le curseur passe dans le nom de l'étape ; l'écran
annonce le nom gardé. Une fois le workflow créé, l'éditeur montre l'étape sous ce nom, avec la mention
« Libellé surchargé ».

**Les informations que l'affaire porte déjà.** Toute affaire a déjà son titre, sa description, son
responsable, son montant et sa devise, sa probabilité, sa prochaine action et son échéance, ses contacts et
son organisation, ses coûts, ses recettes, son temps, ses commentaires et ses e-mails. L'IA ne doit pas
proposer de champ pour elles ; si un champ nouveau en reprend une — un champ « Montant », par exemple —, le
défaut le dit : « Le champ « montant » reprend le montant, déjà porté par l'affaire : retirez-le ou
renommez-le. » Un champ qui existe déjà dans un workflow n'est jamais signalé.

**Les suggestions en revue** sont listées sous les workflows, dans « Suggestions de l’IA en revue » :
elles survivent au rechargement de la page, et les autres administrateurs les voient et peuvent les
reprendre. Une suggestion dont la génération a échoué le dit, avec la raison, et « Réessayer » relance
la même demande.

**Ce que l'assistant ne fait pas.** Il ne touche ni aux affaires, ni aux contacts, ni aux messages. Pour
faire évoluer un workflow déjà en usage, voir le chapitre suivant.

### 18.3 Faire évoluer un workflow avec l'IA

Le même assistant fait évoluer un workflow **existant** — y compris un workflow qui porte des affaires.
Comme pour une création, il ne change rien lui-même : il **suggère** le workflow tel qu'il deviendrait, et
rien ne change avant « Accepter ». Le panneau le rappelle : « Suggestion — rien ne change avant
« Accepter » ».

**Où.** Ouvrez le workflow dans « Réglages ▸ Workflows ». Un bouton **« Suggérer »** est posé en tête de
chacun des trois blocs — **Étapes**, **Transitions déclarées**, **Champs du formulaire**. Il ouvre la
demande **au-dessus des étapes**, sans cacher le workflow : vous voyez ce que vous faites évoluer pendant
que vous le décrivez. Le titre du panneau dit ce qui est visé — « Faire évoluer les étapes de « Cycle
commercial standard » ». Le bloc d'où vous partez **oriente** l'IA ; vous pouvez tout corriger ensuite.

**Qui.** Les administrateurs de l'espace, comme pour une création ; un autre membre reçoit le refus du
serveur.

**1. Demander.** Écrivez dans **« Décrivez ce qui doit changer »** — « remplace la relance par une
qualification des besoins », « ajoute un champ pour le canal d'acquisition ». L'IA reçoit le workflow tel
qu'il est et le **nombre** d'affaires de chaque étape — rien d'autre des affaires : ni leur titre, ni
leurs contacts. N'écrivez aucune donnée personnelle. Puis **« Générer la suggestion »**.

**2. Relire ce qui change.** En tête de la suggestion, **« Ce qui change »** liste, collection par
collection, ce qui serait **ajouté**, **modifié** — avec la valeur d'avant et celle d'après — ou
**retiré**. Un champ retiré est dit « Retiré — archivé » : il n'est jamais supprimé, ses réponses restent
consultables. Si rien ne change, la phrase le dit. Le reste de l'aperçu se corrige comme pour une
création ; le type d'un champ existant, lui, ne se change pas.

**3. Choisir où vont les affaires.** Quand la suggestion retire une étape qui porte des affaires, le bloc
**« Où vont les affaires des étapes retirées »** donne leur nombre et une liste **« Destination »**, ouverte
sur « Aucune destination » : **rien n'est deviné**. Tant qu'une étape n'a pas de destination, un défaut le
dit en tête et la suggestion ne peut pas être acceptée. Vous pouvez choisir une étape que la suggestion
**ajoute**. Votre choix s'enregistre avec la correction, ou au moment d'accepter.

**4. Accepter.** **« Accepter et faire évoluer le workflow »** applique tout en une fois : étapes,
transitions, champs, règles et exigences, et déplace les affaires vers leur destination. **Juste avant**,
le produit garde une **version** du workflow tel qu'il était — le *point de retour* — et l'annonce la
nomme : « Point de retour : version 4 ». Pour revenir en arrière, restaurez cette version depuis le bloc
« Versions » du même écran ([chapitre 18.13](#garder-une-photographie-d-un-workflow-et-y-revenir)).

**Si le workflow a changé entre-temps** — un collègue a ajouté une étape, renommé une transition —,
l'acceptation est refusée : « Le workflow a changé depuis cette suggestion : elle ne peut plus être
acceptée. » Abandonnez-la, puis demandez une nouvelle suggestion, qui partira du workflow tel qu'il est.

**Les suggestions d'un workflow** sont listées au-dessus de ses étapes, dans « Suggestions de l’IA pour ce
workflow » ; celles qui créent un workflow restent sous la liste des workflows.

### 18.4 Choisir un workflow

La colonne de gauche liste les workflows de l'espace de travail, celui **par défaut** en tête, et
le premier est ouvert d'office. Chaque entrée dit sa portée — globale, ou propre à un track.

La case **Afficher les archivés**, au-dessus de la liste, y ajoute les workflows archivés ; chacun porte la mention
« Archivé ». Sans elle, un workflow archivé quitte la liste.

**L'en-tête du workflow ouvert.** En haut de la colonne de droite, le nom du workflow, puis ses pastilles : sa portée
(« Global », ou le nom de son track), « Par défaut » s'il l'est, « Archivé » s'il l'est. Dessous, ses commandes :

- **Renommer** remplace le nom par un champ « Nom du workflow », déjà rempli. « Enregistrer » reste indisponible tant
  que le champ est vide ; `Échap` ou « Annuler » referme sans rien changer.
- **Définir par défaut** fait de ce workflow le workflow par défaut de l'espace de travail, en un geste et sans
  confirmation : l'ancien défaut cesse de l'être au même instant — il n'y en a jamais deux, ni aucun. Le défaut est le
  workflow proposé en tête quand on crée un channel. Seul un workflow **global** et **non archivé** peut l'être : la
  commande n'apparaît pas sur les autres, ni sur le défaut lui-même. Pour revenir en arrière, ouvrez l'ancien défaut et
  redéfinissez-le.
- **Copier vers un track** ouvre un petit formulaire : choisissez le **track**, et donnez si vous le voulez un **nom à la
  copie** (il reprend sinon celui du workflow). La copie reprend les étapes, les transitions et le formulaire, devient
  propre à ce track, puis évolue seule ; elle s'ouvre aussitôt, et dit de quel workflow elle vient. Seul un workflow
  global non archivé se copie ainsi.
- **Archiver** demande une confirmation, qui rappelle qu'aucun channel ne pourra plus choisir ce workflow. Sa structure
  et ses versions sont conservées. Deux refus sont possibles, et chacun dit quoi faire :
  - le workflow est **employé par des channels** — y compris des channels archivés : le refus en donne le nombre.
    Changez d'abord leur workflow depuis l'arborescence (« Changer de workflow », sur la ligne de chaque channel) ;
  - c'est le **workflow par défaut** : désignez d'abord un autre workflow par défaut.
- **Rétablir**, sur un workflow archivé (cochez « Afficher les archivés » pour le retrouver), le remet en service, sans
  confirmation.

Ces commandes demandent d'**administrer l'espace de travail**. Sans ce droit, elles restent visibles mais grisées, et
le motif est écrit en tête de l'éditeur.

### 18.5 Les étapes

Les étapes s'affichent dans l'ordre du graphe, avec pour chacune sa probabilité et son seuil de
relance — ceux du catalogue, ou ceux que vous avez surchargés.

- **Ajouter** : « Ajouter une étape » ouvre le catalogue des nœuds encore disponibles. Un nœud déjà
  employé par ce workflow n'y figure pas, un nœud archivé non plus. Lorsque tout le catalogue actif
  est employé, l'écran le dit plutôt que d'afficher une liste vide. Lorsque le catalogue est
  **vide** — le cas d'un espace neuf —, l'écran le dit aussi, autrement, et propose le lien **Ouvrir
  le catalogue de nœuds**.
- **Ordonner** : les flèches montent et descendent une étape. Une flèche désactivée sans être en
  bout de liste s'explique comme au [§17.3](#quand-un-deplacement-est-indisponible-sans-etre-en-bout-de-liste).
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

### 18.6 Les transitions

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
  cette transition sera refusé sans lui — c'est la règle décrite au [§9.3](#faire-avancer-une-affaire-ce-que-le-produit-autorise-et-ce-qu-il-refuse), vue depuis son réglage.
- **Modifier** : le crayon change le libellé et le motif exigé, jamais les deux extrémités. Changer
  une extrémité, c'est une autre transition : déclarez-la, puis retirez l'ancienne.
- **Retirer** : la corbeille, après confirmation. Rien ne retient une transition — contrairement à
  une étape, aucune affaire ne la « porte » —, donc le retrait aboutit toujours si vous êtes
  administrateur. Les deux étapes, elles, restent dans le workflow ; seule la porte entre elles se
  ferme.

Si un autre administrateur déclare la même transition pendant que votre formulaire est ouvert, le
serveur refuse la vôtre et l'écran affiche « Cette transition est déjà déclarée. » Rien n'est écrit
deux fois.

### 18.7 Les questions du formulaire

Sous les transitions, le bloc « Champs du formulaire » liste les **questions posées sur chaque
affaire** de ce workflow, dans l'ordre où elles apparaissent sur la fiche ([§9.6](#la-fiche-d-une-affaire-son-en-tete-son-formulaire-et-ce-qu-ils-montrent)). Chaque ligne
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

Si vous n'êtes pas administrateur de l'espace de travail, les commandes de l'éditeur sont grisées et
un bandeau dit pourquoi ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)) ; le serveur refuse de toute façon l'enregistrement.

### 18.8 La visibilité des questions, étape par étape

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

### 18.9 Ce qu'il faut avoir rempli pour emprunter un chemin

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

### 18.10 Les checklists des étapes, et les points qu'un chemin exige

**Les points d'une étape.** Juste avant les exigences, le bloc **« Checklists des étapes »** liste chaque étape du
workflow dans l'ordre du graphe, avec ses points. Ces points sont **ajoutés automatiquement aux affaires qui entrent dans
l'étape** ; elles les cochent ensuite sur leur fiche ([section 9.9](#la-checklist-d-une-affaire-les-points-a-cocher)).

- **« Ajouter un point »**, sous chaque étape, ouvre un champ : saisissez le libellé, puis « Ajouter » ou Entrée.
- **« Monter »** et **« Descendre »** changent l'ordre ; ils sont grisés en tête et en queue de liste.
- **« Renommer »** corrige le libellé. Les affaires qui portent déjà ce point gardent l'ancien libellé : il a été copié
  à leur entrée dans l'étape.
- **« Archiver »** retire le point des affaires **à venir** : il n'est plus ajouté à celles qui entrent dans l'étape,
  mais celles qui le portent déjà le gardent. Le point reste dans la liste, marqué « Archivé », et **« Désarchiver »** le
  rétablit. Aucun de ces gestes ne demande de confirmation : chacun se défait d'un clic.

**Les points qu'un chemin exige.** Dans le bloc des exigences, sous chaque chemin et après les questions exigées, la
ligne **« Points de checklist exigés »** liste les points qu'une affaire doit avoir cochés pour emprunter ce chemin.

- **« Exiger un point »** propose les seuls points **de l'étape de départ** du chemin — ceux que l'affaire a reçus en y
  entrant —, non archivés et pas encore exigés. Quand il n'y en a aucun, une phrase le dit à la place du bouton.
- **« Ne plus exiger »** retire l'exigence, sans confirmation ; le point reste dans l'étape.
- **Un point archivé encore exigé reste exigé**, et l'écran le dit : « Toujours exigé : retirez l'exigence pour ne plus
  bloquer cette transition. »
- Un workflow **sans question** montre quand même ses chemins, pour leurs points.

Sur le tableau, un déplacement refusé faute de points cochés **nomme les points**, et le lien **« Cocher ces points »**
ouvre la fiche de l'affaire sur son bloc « Checklist », le premier point exigé prêt à être coché.

Ces gestes sont réservés aux administrateurs de l'espace ; les autres voient le bloc, ses commandes grisées.

### 18.11 Ce qu'une exigence fera aux affaires en cours

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

### 18.12 Ce qui n'est pas encore là

- La prévisualisation ne montre **aucune liste nominative** des affaires concernées, seulement leur
  nombre.
- Retirer une exigence n'est pas prévisualisé : cela ne bloque rien, cela lève une contrainte.
- Exiger une même question sur **plusieurs chemins d'un coup** n'est pas possible : le geste se
  répète chemin par chemin.

### 18.13 Garder une photographie d'un workflow, et y revenir

**Où.** Le bloc **Versions**, tout en bas de l'éditeur de workflows, sous les exigences de chemin.

Un workflow change : ses étapes, ses transitions, ses questions et leurs règles se modifient à tout
moment. Une **version** est une photographie datée, numérotée et signée de sa composition entière.
Elle ne se modifie pas et ne se supprime pas — c'est tout son intérêt.

**Le tableau des versions** liste, de la plus récente à la plus ancienne : son numéro, la date de
publication, la personne qui l'a publiée, sa note éventuelle et le début de son empreinte — le
condensé qui identifie la composition. Un workflow qui n'a jamais été publié le dit en toutes
lettres.

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
l'espace de travail. Les commandes restent visibles pour tout le monde, grisées pour qui n'administre
pas l'espace, avec un bandeau qui dit pourquoi ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)) ; le serveur refuse de toute façon.

### 18.14 Ce qui n'est pas encore là, côté versions

- La **liste des affaires** du plan est bornée à deux cents entrées, et l'écran écrit combien il en
  montre sur combien. Cette borne n'est pas réglable depuis l'interface.
- Aucune **purge** ni rétention : le nombre de versions ne fait que croître.
- Une version ne porte **aucune commande de ligne** : elle ne se renomme pas, ne se supprime pas, et
  sa note ne se modifie plus après coup.

### 18.15 Préparer des modèles d'affaires

Quand vos affaires se ressemblent — un audit, une formation, un atelier —, un **modèle** évite de tout ressaisir : choisi
dans « Nouvelle affaire » ([section 9.10](#le-tableau-kanban-d-un-channel)), il pose sur l'affaire qui naît un titre
proposé, une description, un montant, les réponses aux questions du workflow et des points de checklist. Un modèle sert
**les affaires d'un workflow** : il n'est proposé que dans les channels qui suivent ce workflow.

**L'écran.** **Réglages ▸ Modèles d'affaires**, juste après les workflows, range les modèles par workflow. Chaque ligne
donne le nom du modèle, puis son titre proposé, son montant et son nombre de points.

- **« Nouveau modèle »** ouvre une fiche dans la page : **Workflow**, **Nom**, **Titre proposé**, **Description**,
  **Montant** et **Devise**, puis les **points de checklist** — « Ajouter un point » ajoute une ligne, « Retirer » l'ôte.
  « Enregistrer » le pose ; « Annuler » ou `Échap` referme sans rien écrire.
- **« Modifier »** rouvre la fiche d'un modèle. Son workflow ne change plus : la fiche le dit en une phrase, parce que
  ses réponses répondent aux questions de ce workflow-là.
- **« Archiver »** retire le modèle de « Nouvelle affaire », sans confirmation ; la case **« Afficher les archivés »** le
  ramène dans la liste, marqué « Archivé », avec **« Désarchiver »**. Archiver libère son nom.
- Deux modèles non archivés ne peuvent pas porter **le même nom**, majuscules comprises : l'écran le dit sous les champs
  et garde votre saisie.

**Les réponses aux questions.** Sous les points, la fiche montre les questions du workflow, chacune avec le même
contrôle que sur la fiche d'une affaire. Elles s'enregistrent avec le modèle. Laissez une question vide pour qu'elle reste
sans réponse ; une case décochée reste aussi sans réponse. Les questions qui désignent une personne ou un fichier —
contact, membre, pièce jointe — ne se répondent pas dans un modèle : elles appartiennent à une affaire. Si le modèle en
porte une réponse, parce qu'il a été enregistré depuis une affaire, elle est conservée, et la fiche le dit. À la
création, changer de workflow efface les réponses déjà saisies : ce ne sont plus les mêmes questions. Une réponse mal
formée, comme une adresse incomplète, est refusée sous les champs, et votre saisie reste en place.

**Enregistrer une affaire comme modèle.** Sur la fiche d'une affaire, après « Mettre en sommeil », le bouton
**« Enregistrer comme modèle »** ouvre un petit panneau : le **nom du modèle**, prérempli du titre de l'affaire, puis
« Enregistrer ». Le modèle reprend le titre, la description, le montant, les réponses aux questions et les libellés des
points de checklist de l'affaire — **sans les cochages** : un modèle prépare une affaire, il ne dit pas où elle en est.
Un message confirme le nom du modèle enregistré.

**Qui peut le faire.** Préparer, modifier, archiver un modèle et enregistrer une affaire comme modèle sont réservés aux
**administrateurs de l'espace**. Les autres voient l'entrée des réglages grisée, et le bouton de la fiche grisé, avec la
raison ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Choisir un modèle à la création
d'une affaire est ouvert à quiconque peut créer une affaire dans le channel.

## 19. Le catalogue de nœuds : le vocabulaire de vos workflows

Un **nœud** est un état par lequel une affaire peut passer : « Prospection », « Négociation »,
« Perdu ». Le catalogue est la liste de ceux qui ont un nom dans votre espace de travail, et les
workflows y puisent leurs étapes. Deux workflows différents qui emploient le même nœud parlent du
même état — c'est ce qui rend comparable le temps passé en « Relance » d'un channel à l'autre.

On y arrive par **« Réglages ▸ Catalogue de nœuds »**.

### 19.1 Ce que chaque ligne montre

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

### 19.2 Créer un nœud

« Nouveau nœud » ouvre un formulaire sous l'en-tête. Le libellé propose une clé, que vous pouvez
corriger : elle doit être en minuscules, chiffres et tirets, et rester unique dans l'espace de
travail. La proposition est une commodité et rien de plus — pour « Nœud de suivi », elle rend
`n-ud-de-suivi`, la ligature « œ » n'étant pas convertible automatiquement ; corrigez-la avant
d'enregistrer.

Probabilité et seuil de relance sont facultatifs. Laissés vides, ils restent vides.

### 19.3 Modifier un nœud

« Modifier » ouvre le même formulaire à la place de la ligne, sans la clé : **la clé ne se modifie
pas**. Elle est ce sur quoi vos statistiques s'appuient, et la renommer réécrirait l'histoire de
toutes les affaires passées par ce nœud. Si un nœud ne convient plus, archivez-le et créez-en un
autre.

### 19.4 Archiver un nœud, et le rétablir

Archiver retire le nœud des workflows à composer, sans rien effacer. Le nœud reste dans la liste,
marqué « Archivé », et « Rétablir » le remet en service — ce geste-là ne demande aucune
confirmation, puisqu'il ne détruit rien.

**Un nœud sur lequel des affaires se trouvent encore ne s'archive pas.** Le produit refuse, dit
combien d'affaires en cours l'occupent, et vous demande de les déplacer d'abord. Ce refus vient du
serveur : la commande reste offerte, et c'est en la déclenchant que vous obtenez le compte exact.
Les affaires archivées ou mises à la corbeille ne comptent pas.

### 19.5 Réordonner le catalogue

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

### 19.6 Ce qui n'est pas encore là

- **Supprimer** un nœud n'existe pas, et n'est pas prévu : l'archivage tient lieu de retrait.
- Le nombre d'affaires posées sur un nœud n'est **pas affiché à l'avance** ; il apparaît dans le
  refus d'archivage.

## 20. La corbeille : ce qui a été retiré, et comment le rendre

**Où.** Barre latérale ▸ **Réglages** ▸ « Corbeille ».

**Ce que l'écran montre.** Un tableau des objets retirés — tracks, channels et affaires mêlés —, du
plus récemment retiré au plus ancien. Chaque ligne dit son **type**, son **nom**, **qui** l'a
retiré, **quand**, **quand il sera effacé**, et **ce qu'il retient avec lui**.

**Un objet reste 30 jours dans la corbeille, puis il est effacé définitivement, avec ce qu'il
contient.** Une phrase en tête de l'écran le rappelle. La colonne **« Effacement »** donne, pour
chaque ligne, la date à partir de laquelle l'objet sera effacé ; l'effacement a lieu **dans la nuit
qui suit**. La date de mise à la corbeille est celle du serveur, au moment du geste. Si la durée de
conservation n'a pas pu être lue, la phrase n'est pas affichée et la colonne écrit « Inconnue ».

**Ce que vous y voyez dépend de votre rôle.** Un **administrateur de l'espace** voit tout ce qui est
dans la corbeille. **Un autre membre n'y voit que ce qu'il y a lui-même mis** — une phrase le lui
rappelle en tête de l'écran : « Vous voyez ce que vous avez mis à la corbeille. ». C'est une règle
du serveur : une affaire qu'un autre a mise à la corbeille vous est introuvable, même par son
adresse. Dans tous les cas, vous n'y voyez que ce que vous avez par ailleurs le droit de lire, et le
nombre affiché dans « Retient avec lui » suit la même règle — c'est **votre** décompte, pas un
inventaire complet.

**« Auteur inconnu » n'est pas une anomalie.** Un objet peut avoir été retiré par un traitement
technique plutôt que par une personne, ou par un compte supprimé depuis. Le produit le dit au lieu
de laisser la case vide.

### 20.1 Restaurer

Le bouton **Restaurer** de la ligne. Aucune confirmation n'est demandée : restaurer ne détruit rien,
et le geste inverse est précisément celui qui a rempli cet écran.

Trois réponses sont possibles, et l'écran les distingue :

| Ce que vous voyez | Ce qui s'est passé |
|---|---|
| La ligne disparaît, un message confirme | L'objet est rendu, exactement dans l'état où il était |
| « Son parent est lui-même en corbeille : restaurez-le d'abord. » | Le rendre seul l'aurait rendu **à un endroit invisible** — un channel dans un track retiré, une affaire dans un channel retiré |
| « Rien n'a été restauré : cet objet n'est plus modifiable avec votre compte. » | Votre compte n'a pas le droit d'écrire sur cet objet. **Rien n'a changé** |

**« Restaurer » est grisé quand vous ne pouvez pas le faire** ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)) : un track ou un channel se restaure
par un administrateur de l'espace, une affaire par qui peut écrire sur son onglet. Un bandeau en tête du
tableau dit lequel des deux cas vous concerne. Le message « Rien n'a été restauré » ne paraît plus que si
vos droits ont changé entre-temps ou n'ont pas pu être lus.

**La deuxième réponse est une règle du serveur, pas une précaution de l'écran** : elle vaut aussi
pour un script ou une intégration qui tenterait la même chose.

### 20.2 Ce que cet écran ne fait pas

- **On n'y retire rien, on y rend.** Le geste de mise à la corbeille vit là où vivent les objets —
  [chapitre 17](#administrer-l-arborescence-tracks-et-channels) pour un track et un channel, [chapitre 9.15](#mettre-une-affaire-a-la-corbeille) pour une affaire.
- **Aucun effacement manuel, et aucun « vider la corbeille ».** Seul l'effacement automatique, au
  bout de 30 jours, détruit un objet ([section 20.3](#l-effacement-definitif)).
- **Aucun filtre, aucun tri, aucune pagination** : la corbeille est rendue en entier, la plus
  récemment retirée d'abord.

### 20.3 L'effacement définitif

Chaque nuit, le produit efface ce qui est dans la corbeille depuis plus de 30 jours : les tracks
d'abord, puis les channels, puis les affaires. **Ce qui est effacé ne se restaure plus.**

- **Un objet emporte ce qu'il contient** : un track ses channels et leurs affaires, une affaire ses
  commentaires, ses activités, ses valeurs de champs, ses coûts et ses recettes. Les messages liés à
  une affaire effacée ne sont pas effacés : ils perdent seulement ce lien.
- **Le temps saisi n'est pas perdu avec son affaire.** Avant d'effacer une affaire, le produit
  reporte ses saisies de temps sur son channel ; avant d'effacer un channel, sur son track. Le temps
  et son coût restent dans les rapports, sous le dossier parent. Seul le temps saisi sur un **track**
  effacé disparaît, faute de parent.
- **Chaque effacement est inscrit au journal d'audit** ([chapitre 22](#le-journal-d-audit-ce-qui-s-est-fait-dans-votre-espace)), avec ce qu'il a emporté
  et ce qu'il a reporté, sans auteur : c'est le produit qui efface, pas une personne.
- **Un track peut rester bloqué.** Une affaire d'un autre track peut avoir imputé une dépense à l'un
  de ses budgets : effacer le track détruirait ce budget, et la dépense avec. Le produit ne le fait
  pas. La ligne du track porte alors la mention **« Bloqué »** dans la colonne « Effacement », et un
  administrateur dispose du bouton **« Réaffecter les dépenses »**. Il ouvre, sous la ligne, la liste
  de ces dépenses : pour chacune, choisissez le **budget cible** — un budget ouvert d'un autre track,
  de la même devise — et, pour un budget récurrent, son **occurrence**, puis **« Réaffecter »**. Une
  dépense rattachée à un budget clôturé se réaffecte après sa réouverture : le bouton **« Rouvrir le
  budget »** est proposé à sa place. Quand plus rien ne bloque, l'écran le dit, et le track sera
  effacé à sa date.

### 20.4 Ce qui n'est pas encore là

- Le retrait d'une **affaire** se fait depuis sa fiche ([chapitre 9.15](#mettre-une-affaire-a-la-corbeille)), et non depuis le
  tableau kanban ni la vue liste.
- La durée de conservation est la même pour tout l'espace ; elle ne se règle pas.

## 21. Les membres de votre espace : qui y travaille, avec quel rôle

Chaque espace de travail a ses **membres**, et chacun y tient un **rôle** : **Administrateur**, **Business developer**
ou **Lecteur**. Cet écran les montre à tous les membres ; seuls les administrateurs de l'espace y changent quelque chose.

### 21.1 Ouvrir l'écran

Barre latérale ▸ **Réglages** ▸ **« Membres : personnes et rôles »**, juste après « Arborescence : tracks et channels ».

La liste montre une ligne par membre : son nom, son rôle et la date depuis laquelle il est membre. Les
administrateurs viennent en tête, puis les autres membres par ordre alphabétique. Une personne dont le profil n'a pas
de nom apparaît comme **« Compte sans nom »**.

### 21.2 Si vous n'administrez pas l'espace

Vous consultez la liste, mais vous ne la modifiez pas. Un bandeau le dit en tête de l'écran : les modifications sont
réservées aux administrateurs de l'espace. Les sélecteurs de rôle et les boutons **« Retirer »** restent visibles,
mais ils sont inactifs.

### 21.3 Changer le rôle d'un membre

Choisissez le nouveau rôle dans le sélecteur de sa ligne : le changement est enregistré **dès le choix**, sans bouton
à presser. Un message sous la liste le confirme — « Rôle de Jeanne Martin modifié. » —, puis la liste est relue.

**Un espace garde toujours au moins un administrateur.** Retirer le rôle d'administrateur au dernier d'entre eux est
refusé, et le message le dit : nommez d'abord un autre administrateur. Le sélecteur revient alors au rôle enregistré.

Vous pouvez changer votre propre rôle. Si vous cessez d'être administrateur, vous ne pourrez plus rien modifier sur
cet écran.

### 21.4 Retirer un membre de l'espace

**« Retirer »**, au bout de sa ligne, ouvre une confirmation sous la ligne. Elle nomme la personne et l'espace, et dit
ce que le retrait emporte : **ses droits fins sur les tracks et les channels de l'espace partent avec elle**. Le reste
de son compte n'est pas touché. **« Retirer de l'espace »** confirme ; **« Annuler »**, ou la touche Échap, referme
la confirmation sans rien changer.

**Vous retirer vous-même** est possible, et la confirmation vous prévient : vous ne serez plus membre de l'espace, et
vous perdrez l'accès à ses affaires comme à son administration. Le dernier administrateur ne peut pas se retirer.

### 21.5 Les attentes : les personnes qu'on attend

Le CRM ne crée aucun compte : on y entre avec son identité LeLabs. Pour faire entrer quelqu'un dans l'espace, un
administrateur inscrit une **attente** — une adresse et un rôle. La personne devient membre, avec ce rôle, à sa
**première connexion LeLabs** avec cette adresse vérifiée ([chapitre 1](#se-connecter-et-se-deconnecter)).

La section **« Attentes »** vient sous la liste des membres. **Seuls les administrateurs de l'espace la voient** : pour
les autres membres, elle n'apparaît pas.

- **Inscrire une attente** ouvre un petit formulaire : **« Adresse »** et **« Rôle »**, puis **« Inscrire »**. La liste
  montre l'adresse, le rôle, qui l'a inscrite et depuis quand.
- **Changer le rôle d'une attente** : inscrivez de nouveau la même adresse avec le nouveau rôle. L'attente est
  **remplacée**, et le message le dit — « Attente de … remplacée : Lecteur devient Administrateur. ».
- **« Retirer »**, au bout de la ligne, retire l'attente aussitôt, sans confirmation : il suffit de la réinscrire pour
  revenir en arrière.
- Une attente **« En suspens »** ne se consommera qu'à l'arrivée d'un administrateur : c'est le cas d'une attente qui
  n'est pas administratrice, dans un espace qui n'a encore aucun administrateur membre. Vous ne la verrez que rarement
  ici, puisqu'un administrateur membre suffit à lever le suspens ; la plateforme la montre ([chapitre 32](#la-plateforme-espaces-membres-et-superadministrateurs)).
- **« Dernière tentative »** dit si la personne attendue a déjà essayé de se connecter, et pourquoi elle a été refusée :
  « Refusée le 21/10 : compte LeLabs pas encore vérifié », avec le nombre de refus quand il y en a eu plusieurs. Trois
  motifs existent : **adresse non vérifiée chez LeLabs** (la personne doit confirmer son adresse dans son compte
  LeLabs), **compte LeLabs pas encore vérifié** (LeLabs doit vérifier son compte), **l'espace n'a pas encore
  d'administrateur** (nommez-en un). « Aucune tentative refusée » veut dire que la personne n'a pas essayé — ou que son
  dernier essai date de plus de 90 jours : le CRM n'en garde pas la trace au-delà. Une adresse que personne n'attend ne
  laisse jamais de trace, et réinscrire une attente efface la sienne.

Une adresse mal formée est refusée, et le formulaire reste ouvert pour la corriger.

### 21.6 Les droits fins : restreindre ou rouvrir un track ou un channel

Le rôle d'un membre vaut pour tout l'espace. Les **droits fins** le précisent, track par track et channel par channel.
La section **« Droits fins »** vient en dernier ; **seuls les administrateurs de l'espace la voient**.

1. Choisissez la personne dans **« Membre »**. L'écran propose d'abord le premier membre qui n'est pas administrateur.
2. Le tableau liste chaque track, suivi de ses channels, par ordre alphabétique. Pour chacun :
   - **« Droit posé »** : **Hérité** (rien n'est posé : le droit vient du track, ou du rôle), **Membre** (lecture et
     écriture), **Lecture**, ou **Aucun accès** ;
   - **« Accès effectif »** : ce que la personne peut réellement faire — **Écriture**, **Lecture** ou **Aucun accès**.
     C'est le CRM qui le calcule, avec la même règle que partout ailleurs.
3. Choisissez un autre droit dans la liste : il est enregistré **dès le choix**, un message le confirme, et l'accès
   effectif est relu. **« Hérité »** retire le droit posé.

**Le droit le plus précis l'emporte** : celui d'un channel sur celui de son track, celui d'un track sur le rôle. On
peut donc fermer un track à quelqu'un et lui rouvrir un seul de ses channels. Le track apparaît alors « Aucun accès »,
avec la mention **« Lisible par l'un de ses channels »** : la personne voit son nom, pour atteindre le channel ouvert.

**Un administrateur n'est jamais restreint.** Sa matrice s'affiche, une phrase le rappelle, et ses droits ne se
modifient pas ici.

### 21.7 Quand un geste n'aboutit pas

Le message sous la liste dit pourquoi :

- **le dernier administrateur** : nommez-en un autre d'abord ;
- **rien n'a changé** : la personne n'était peut-être plus membre, ou vos droits ont changé entre-temps. La liste a été
  relue ;
- **ce geste est réservé aux administrateurs de l'espace** ;
- **le serveur n'a pas répondu** : vérifiez votre connexion et réessayez.

## 22. Le journal d'audit : ce qui s'est fait dans votre espace

Le CRM tient un **journal des gestes sensibles** de chaque espace. Ce sont les gestes qui changent qui peut faire quoi,
comment l'espace est configuré, et ce qui disparaît :

- **les droits et les appartenances** : un membre ajouté ou retiré, un rôle changé, une attente inscrite ou retirée, un
  accès à un track ou à un channel posé ou retiré ;
- **la configuration** : l'espace lui-même, les tracks, les channels, les workflows et leurs publications, les étapes,
  les transitions, le catalogue de nœuds, les champs de formulaire, les boîtes de réception et les identités
  d'expédition ;
- **les connexions** : chaque connexion réussie d'un membre ;
- **les effacements et la corbeille** : une affaire, un track ou un channel mis à la corbeille, restauré ou détruit, un
  commentaire ou une activité retirés, un contact ou une organisation supprimés ;
- **la rétention** : l'effacement des entrées de plus d'un an.

Le journal est tenu **par le CRM lui-même**. Un geste fait à l'écran, par l'API ou par l'assistant du connecteur MCP y
est inscrit de la même façon, avec la personne qui l'a fait. **Personne ne peut modifier ni supprimer une entrée**, pas
même un administrateur. Les entrées sont conservées **un an**, puis effacées chaque nuit, et cet effacement est
lui-même inscrit.

Le journal ne garde **jamais le nom d'un contact** : il ne garde que son identifiant, et l'écran lit le nom dans le
carnet au moment de l'affichage. Il ne garde pas non plus de contenu : ni le texte d'un commentaire, ni celui d'un
message, ni un mot de passe, ni la valeur d'un réglage.

### 22.1 Ouvrir le journal

1. Ouvrez **« Réglages »** dans la barre latérale.
2. Choisissez **« Journal d'audit »**, juste après « Membres ».

Le journal est **réservé aux administrateurs de l'espace**. Pour un autre membre, l'entrée de l'index est grisée, et
l'adresse ouverte directement affiche **« Réservé aux administrateurs »**.

### 22.2 Lire une entrée

Le tableau montre les entrées les plus récentes en tête, sur quatre colonnes :

- **« Date »** : le jour et l'heure du geste ;
- **« Acteur »** : la personne qui l'a fait. **« Système ou compte supprimé »** désigne une entrée sans acteur : un geste
  du CRM lui-même (une tâche de nuit, par exemple), ou une personne dont le compte a été supprimé depuis ;
- **« Geste »** : une phrase qui dit ce qui s'est passé et sur quoi — « Membre ajouté : Jeanne Martin », « Workflow
  publié : Cycle commercial » ;
- **« Détail »** : ce qui a changé — « Rôle : Lecteur → Business developer », « Accès : Lecture », « Nom : A → B »,
  « Version 4 ». Un texte trop long est coupé à l'écran ; survolez-le pour le lire en entier.

Cinquante entrées s'affichent d'abord. **« Entrées plus anciennes »**, sous le tableau, ajoute les cinquante suivantes.

### 22.3 Filtrer

Au-dessus du tableau, quatre filtres se combinent :

- **« Famille »** : droits et appartenances, configuration, connexions, exports, effacements et corbeille, rétention ;
- **« Acteur »** : un membre de l'espace, ou « Système ou compte supprimé » ;
- **« Du »** et **« Au »** : une période, les deux jours compris.

Les filtres sont inscrits dans l'adresse de la page : vous pouvez la partager avec un autre administrateur.
**« Aucun geste sur cette période »** dit qu'aucune entrée ne correspond aux filtres. Les filtres restent au-dessus pour
les élargir.

### 22.4 Ce que le journal ne fait pas

- Il ne s'exporte pas : on le consulte à l'écran.
- Il n'inscrit pas les gestes ordinaires de la vie d'une affaire, comme un déplacement, un champ rempli ou un
  commentaire. L'historique de l'affaire les montre déjà.
- Il n'inscrit pas la déconnexion. Le CRM ne distingue pas une déconnexion d'une session expirée.
- Le superadministrateur garde son propre journal, celui de la plateforme ([chapitre 32](#la-plateforme-espaces-membres-et-superadministrateurs)).

## 23. Les budgets d'un track

**À quoi sert un budget.** Un budget est une **enveloppe de dépenses** d'un track — « Publicité
2026 », « Salon du web 2025 ». Les lignes de coût d'une affaire s'y rattachent, depuis la section
« Coûts » de sa fiche, et les écrans de coûts comparent, budget par budget, ce qui était prévu à ce qui
a été dépensé ([chapitre 24](#les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense)).

**Où.** Barre latérale ▸ **Réglages** ▸ « Arborescence : tracks et channels ». Dépliez un track avec
le chevron : sous ses channels paraît le bloc **« Budgets »**.

**Ce que le tableau montre**, une ligne par budget :

| Colonne | Contenu |
|---|---|
| Nom | le nom du budget |
| Devise | trois lettres — `EUR`, `CHF` |
| Enveloppe | le montant prévu ; **cellule vide** si l'enveloppe n'est pas décidée — ce n'est pas zéro |
| Récurrent | « Oui » ou « Non » |
| Occurrences ouvertes | pour un budget récurrent, le nombre de ses occurrences **non clôturées** ; c'est aussi le lien qui les déplie ([chapitre 23.1](#les-occurrences-d-un-budget-recurrent)). **Cellule vide** pour un budget non récurrent, qui n'en porte jamais |
| État | « Ouvert » ou « Clôturé », écrit en toutes lettres |
| Actions | monter, descendre, modifier, clôturer — ou rouvrir |

**Les budgets clôturés sont masqués par défaut.** Cochez **« Afficher les budgets clôturés »** pour
les faire reparaître : ils ne sont pas supprimés, ils sortent seulement du chemin.

**Créer un budget.** Le bouton **« Nouveau budget »**, sous le tableau, ouvre le formulaire dans la
page, le curseur dans le premier champ :

| Champ | Règle |
|---|---|
| Nom | obligatoire. Deux budgets **ouverts** d'un même track ne portent pas le même nom ; un budget clôturé peut, lui, garder un nom qu'un nouveau budget reprend — « Salon 2025 » l'année suivante |
| Devise | trois lettres majuscules, `EUR` par défaut. Une autre écriture est signalée sur le champ, et « Créer » reste indisponible |
| Enveloppe (facultative) | un nombre. **Laissez vide** si l'enveloppe n'est pas décidée ; un montant **négatif** est accepté — un avoir, un remboursement. Une saisie qui n'est pas un nombre est signalée sur le champ |
| Seuil d'ancienneté (facultatif) | un nombre de **jours entiers, à partir de 1**. Au delà, une dépense de ce budget qui attend son coût réel est signalée **en retard** dans l'onglet « À saisir » ([chapitre 27](#l-onglet-a-saisir-renseigner-les-couts-reels-a-la-suite)). **Laissez vide pour ne rien signaler** : aucun seuil n'est alors appliqué, pas même un seuil « par défaut ». « 0 » ou « 2,5 » sont signalés sur le champ |
| Budget récurrent (porte des occurrences) | à cocher pour un budget qui se décline en périodes — « Janvier 2026 », « Février 2026 ». Un budget récurrent ne reçoit aucune ligne de coût tant qu'il ne porte pas au moins une occurrence ouverte ([chapitre 23.1](#les-occurrences-d-un-budget-recurrent)) |

**Modifier un budget.** Le crayon rouvre le même formulaire, **prérempli** avec les valeurs
actuelles. Vider l'enveloppe ou le seuil les **efface** réellement. Un budget qui porte des
occurrences ne redevient pas non récurrent : retirez d'abord ses occurrences.

**Réordonner.** Les flèches montent ou descendent un budget d'un cran ; elles sont désactivées en tête
et en fin de liste, et le disent.

**Clôturer un budget.** Le cadenas demande une **confirmation**, dans la page : « Clôturer le budget
« … » ? ». Elle dit ce que la clôture fait — le budget sort du tableau sans être supprimé, et peut
être rouvert — et elle **compte** les dépenses du budget qui attendent encore leur coût réel : « Ce
budget porte n ligne(s) sans coût réel ; elles resteront saisissables après la clôture. » La clôture
n'est **pas empêchée** par ce décompte : c'est une décision de gestion, elle est seulement éclairée.
Un budget clôturé **ne reçoit plus de nouvelle ligne de coût** ; celles qu'il porte restent, et leur
coût réel se saisit encore — les factures arrivent souvent après la clôture.

**Rouvrir un budget.** Affichez les budgets clôturés, puis utilisez le cadenas ouvert. Aucune
confirmation n'est demandée. Si un budget ouvert du track a repris son nom entre-temps, la
réouverture est refusée : renommez l'un des deux.

**Un budget ne se supprime pas** : des dépenses le référencent, et le supprimer effacerait la
dépense constatée. On le clôture.

**Qui.** Créer, modifier, réordonner, clôturer et rouvrir un budget sont réservés aux
**administrateurs de l'espace de travail** — le serveur l'applique. Un autre membre voit le tableau
des budgets des tracks qu'il lit ; ses commandes restent à leur place, **grisées**, et le bandeau de
l'écran dit pourquoi ([chapitre 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)). Afficher les budgets clôturés et déplier les occurrences lui
restent ouverts.

| Message | Ce qu'il signifie |
|---|---|
| « Un budget ouvert de ce track porte déjà ce nom… » | Choisissez un autre nom, ou clôturez l'autre budget |
| « Ce budget porte des occurrences : supprimez-les avant de le rendre non récurrent. » | Retirez ses occurrences d'abord ([chapitre 23.1](#les-occurrences-d-un-budget-recurrent)) |
| « Cette valeur a été refusée : vérifiez le nom et la devise. » | Le serveur a refusé la forme d'une valeur |
| « Seul un administrateur de cet espace de travail peut gérer les budgets. » | Le geste demande un droit que votre compte n'a pas |
| « Rien n'a été modifié… » | Vos droits sur ce budget ont changé depuis l'ouverture de l'écran, ou il a disparu |

### 23.1 Les occurrences d'un budget récurrent

**Où.** Sous un track déplié, dans le tableau « Budgets ». Un budget déclaré **récurrent** affiche
dans la colonne « Occurrences ouvertes » un nombre **cliquable** : il déplie la liste de ses
occurrences sous le tableau. Un budget non récurrent affiche une cellule vide, et n'offre pas ce
geste — il ne peut porter aucune occurrence.

**Pourquoi c'est nécessaire.** Un budget récurrent ne peut recevoir aucune ligne de coût tant qu'il
ne porte pas au moins une occurrence : le sélecteur de la fiche d'affaire ne le propose pas. Avant
cet écran, cocher « récurrent » produisait donc un budget inutilisable.

**Ce que la liste montre**, de la plus récente à la plus ancienne : le libellé, la période si elle
est renseignée, l'enveloppe si elle est décidée, et l'état — « Ouverte » ou « Clôturée ».

**Les occurrences clôturées ne sont pas masquées**, contrairement aux budgets. C'est voulu : les
factures arrivent souvent après la clôture, et l'onglet « À saisir » des écrans de coûts liste
précisément leurs lignes.

**Les cinq gestes**, tous réservés à un **administrateur de l'espace de travail** :

| Geste | Ce qu'il fait |
|---|---|
| Ouvrir une occurrence | Déclare une instance — « Janvier 2026 ». Le libellé est obligatoire ; la période et l'enveloppe ne le sont pas |
| Modifier | Change le libellé, la période et l'enveloppe. Reste offert sur une occurrence **clôturée** |
| Clôturer | La retire des choix proposés à une nouvelle ligne de coût. **Sans confirmation** : elle se rouvre d'un clic |
| Rouvrir | L'inverse, également sans confirmation |
| Retirer | La supprime. **Avec confirmation**, et refusé si des lignes de coût y sont rattachées |

**Aucune occurrence n'est engendrée automatiquement.** On crée « janvier », puis « février », à la
main. Un mois sans occurrence est une information — il ne s'est rien passé — qu'une génération
automatique détruirait en fabriquant une occurrence vide.

**Vider un champ facultatif l'efface réellement.** Une enveloppe posée par erreur se retire en
laissant le champ vide, de même que les deux bornes de période.

**Les périodes ne contraignent rien.** Elles servent à ordonner et à libeller : aucune ligne de coût
n'est refusée parce que sa date sortirait de la période, et rien n'exige que la fin suive le début.

**Deux libellés qui ne diffèrent que par la casse coexistent.** « Janvier 2026 » et « janvier 2026 »
sont deux occurrences distinctes ; seuls les espaces de début et de fin sont ignorés. C'est la même
règle que pour le nom d'un budget.

**Ce que vous pouvez lire sans pouvoir l'écrire.** La liste est visible à qui lit le budget. Si vous
n'êtes pas administrateur, vos gestes sont refusés par le serveur et l'écran vous le dit — il ne les
masque pas, parce que vos droits peuvent avoir changé depuis l'ouverture de la page.

| Message | Ce qu'il signifie |
|---|---|
| « Ce budget porte déjà une occurrence de ce libellé » | Choisissez un autre libellé |
| « Ce budget n'est pas récurrent » | Rendez-le récurrent avant d'y ouvrir une occurrence |
| « Cette occurrence porte des lignes de coût » | Clôturez-la plutôt que de la retirer : la dépense constatée n'est pas effacée |
| « Seul un administrateur… » | Le geste demande un droit que votre compte n'a pas |
| « Rien n'a été modifié » | Vos droits sur ce budget ont changé depuis l'ouverture de l'écran |

### 23.2 Ce qui n'est pas là, côté budgets

Ces absences sont voulues, et non des oublis :

- **aucune conversion de devise** : chaque budget compte dans sa propre devise, et les écrans de coûts
  rendent un histogramme par devise plutôt qu'un total qui mélangerait des euros et des francs ;
- **aucune occurrence engendrée automatiquement**, aucun calendrier ([chapitre 23.1](#les-occurrences-d-un-budget-recurrent)) ;
- **aucune alerte de dépassement** ni aucun envoi d'email : un dépassement se lit sur l'histogramme ;
- **aucun export comptable**, aucun import de factures.

## 24. Les coûts d'un track : ce qui était prévu, ce qui a été dépensé

**Où.** Ouvrez un track, puis l'entrée **« Coûts »** de la barre d'onglets, à droite des channels et
séparée d'eux par un filet. L'adresse est partageable et rechargeable.

**L'entrée est là même si le track n'a aucun channel.** Un track porte ses budgets indépendamment de
ses channels ; ne pas encore avoir ouvert de channel n'empêche pas d'avoir engagé des dépenses.

**Ce que l'écran montre.** Pour chaque budget **ouvert** du track, deux barres côte à côte : le
**prévisionnel** — la somme des coûts estimés des lignes rattachées à ce budget — et le **réel** — la
somme des coûts réellement saisis. La barre du réel passe au rouge lorsqu'elle **dépasse** le
prévisionnel, et le tableau sous le graphique l'écrit aussi en toutes lettres : une couleur ne porte
jamais seule une information dans ce produit.

**Le tableau sous le graphique n'est pas un doublon.** C'est la version que lit un lecteur d'écran,
et celle qui reste juste si les couleurs ne passent pas — à l'impression, sur un projecteur, ou pour
qui les distingue mal. Il porte les mêmes chiffres, plus une colonne **« Sans réel »** qui compte les
lignes dont le coût réel n'a pas encore été saisi, budget par budget.

**Un budget récurrent apparaît ici en UNE seule paire de barres**, toutes ses occurrences confondues.
Le détail occurrence par occurrence appartient à l'écran du budget : **le nom d'un
budget est un lien** vers sa fiche ([§25](#le-detail-d-un-budget-occurrence-par-occurrence-ligne-par-ligne)).

**Un budget clôturé n'apparaît pas sur cet écran.** Il n'a pas disparu : ses lignes existent
toujours, et leur coût réel reste saisissable — clôturer une campagne n'empêche pas les factures
d'arriver ensuite. Il sort simplement de la comparaison des budgets en cours.

### 24.1 La phrase sous le graphique, et pourquoi elle compte

Quand des coûts réels manquent, l'écran écrit sous le graphique :

> « 1 ligne(s) sans coût réel saisi, pour 100 € de prévisionnel. »

**Sans elle, un réel bas se lirait comme une économie alors qu'il n'est qu'une saisie en retard**,
et c'est la principale façon dont un tel écran pourrait mentir. Une ligne sans coût réel **ne compte
pas** dans la barre du réel : le produit ne confond jamais « pas encore su » et « rien dépensé ».

**Elle disparaît quand tous les réels sont saisis**, au lieu d'afficher « 0 ligne ». Un
avertissement affiché en permanence cesse d'être lu, et c'est quand il apparaît qu'il doit se
remarquer.

### 24.2 Plusieurs devises

Si le track porte des budgets dans plusieurs devises, l'écran rend **un graphique par devise**,
chacun avec son propre total. Il n'additionne jamais deux devises : aucune conversion et aucun taux
de change n'existent dans le produit, et un total unique n'aurait donc aucun sens. Si tout est dans
la même devise — le cas courant — vous ne voyez rien de cette mécanique.

### 24.3 Les états que vous pouvez rencontrer

| Ce que vous voyez | Ce que cela veut dire |
|---|---|
| « Aucun budget sur ce track » | Aucun budget **ouvert** que vous ayez le droit de lire. Un administrateur en crée depuis « Réglages ▸ Arborescence » |
| Deux barres à zéro et « Aucune dépense rattachée. » | Le budget existe, aucune affaire n'y a encore rattaché de ligne de coût |
| « Accès refusé » | Votre compte n'a pas le droit de lire ces budgets |
| « Track introuvable » | L'adresse ne désigne aucun track que vous puissiez lire |

**Ce que vous voyez est ce que vos droits vous consentent.** Un budget que vous n'avez pas le droit
de lire n'entre pas dans le total, et **l'écran ne vous signale aucun manque** : le signaler
reviendrait à vous apprendre l'existence de ce qu'il cache. Votre total peut donc être plus petit
que celui d'un collègue, et c'est le comportement voulu.

### 24.4 Ce que cet écran ne fait pas

- **On n'y saisit rien.** Les lignes de coût d'une affaire se créent et se modifient depuis la fiche
  de l'affaire, section « Coûts ». Les budgets s'administrent depuis « Réglages ▸ Arborescence ».
- **Aucun filtre, aucun tri, aucune période.** L'écran rend les budgets ouverts du track dans l'ordre
  de leur administration.

### 24.5 Deux onglets, et le second est celui où l'on saisit

Cet écran porte **deux onglets** : « Vue d'ensemble » — le graphique décrit ci-dessus — et
**« À saisir »**, qui liste les lignes de ce track en attente de leur coût réel et permet de les
saisir à la suite. L'onglet « À saisir » porte un **compteur** : le nombre de lignes qu'il liste.

Le second onglet vit dans l'adresse (`?onglet=saisir`) : il est donc **partageable et
rechargeable**, comme le reste du produit. Tout est décrit au **[§27](#l-onglet-a-saisir-renseigner-les-couts-reels-a-la-suite)*.

Le **cumul de l'espace de travail** a son propre écran ([chapitre 26](#les-couts-de-tout-l-espace-de-travail-un-cumul-par-track)).

## 25. Le détail d'un budget : occurrence par occurrence, ligne par ligne

**Où.** Depuis l'écran de coûts d'un track ([§24](#les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense)), **cliquez sur le nom d'un budget** dans
le tableau sous le graphique. L'adresse est partageable et rechargeable ; elle désigne le budget par
son identifiant, et non par son nom — deux budgets peuvent porter le même nom dès que l'un est clos.

**Ce que l'écran montre, de haut en bas :**

1. **La devise du budget et son enveloppe**, quand une enveloppe a été décidée. Si aucune ne l'a été,
   la ligne n'apparaît pas du tout : le produit ne confond jamais « rien n'a été décidé » et
   « l'enveloppe vaut zéro ».
2. **Un graphique à deux barres par occurrence** — le prévisionnel et le réel —, dans l'ordre des
   périodes. C'est ce que l'écran du track agrège en une seule paire. Un budget **non récurrent**
   n'en rend qu'une, nommée « Sans occurrence ».
3. **La liste de ses lignes de coût** : l'affaire, la nature de la dépense, le coût estimé, le coût
   réel et l'auteur de la saisie. Le titre de l'affaire est un lien vers sa fiche.

**Une occurrence qui n'a rien coûté garde ses deux barres, à zéro.** Qu'il ne se soit rien passé en
février est une information ; la faire disparaître ferait lire le budget comme s'il n'avait jamais
porté ce mois-là.

**Sous le libellé d'une occurrence, sa période.** Le libellé est libre — rien n'oblige
« Janvier 2026 » à couvrir janvier —, et la période dit ce que le libellé ne garantit pas. Elle est
purement descriptive : elle ne refuse aucune ligne de coût.

### 25.1 Filtrer par occurrence

Dès que le budget porte des occurrences, un sélecteur **« Filtrer par occurrence »** apparaît
au-dessus de la liste. Il ne retient que **la liste** : le graphique reste celui du budget entier,
sans quoi vous perdriez la comparaison entre occurrences, qui est ce que cet écran sert à voir.

L'option **« Toutes les occurrences »** lève le filtre. Un budget non récurrent, ou un budget
récurrent qui ne porte encore aucune occurrence, n'affiche aucun sélecteur : il n'y aurait rien à
filtrer.

### 25.2 La colonne « Réel » laissée vide

Une ligne dont le coût réel n'a pas encore été saisi laisse sa cellule **vide** — pas un tiret, pas
« non renseigné », et surtout pas `0 €`. Le produit ne confond jamais « pas encore su » et « rien
dépensé » : un zéro affiché ferait passer une saisie en retard pour une économie. Le compte de ces
lignes est donné une seule fois, par la phrase sous le graphique.

### 25.3 Les états que vous pouvez rencontrer

| Ce que vous voyez | Ce que cela veut dire |
|---|---|
| « Budget clôturé — ses lignes restent lisibles et leur coût réel saisissable. » | Le budget a été clos. Il ne figure plus sur l'écran du track, mais son histoire reste entière et les factures qui arrivent après coup restent saisissables |
| « Aucune occurrence ouverte. » | Le budget est récurrent mais n'en porte aucune. Tant que c'est le cas, aucune dépense ne peut lui être rattachée |
| Deux barres à zéro et « Aucune dépense rattachée. » | Le budget existe, aucune affaire n'y a encore rattaché de ligne |
| « Aucune dépense sur cette occurrence. » | Le filtre est posé sur une occurrence qui ne porte aucune ligne — ce n'est pas la même chose qu'un budget vide |
| « Budget introuvable » | Ce budget n'existe pas, **ou** il ne vous est pas accessible, **ou** l'adresse est mal formée. Les trois se ressemblent **volontairement** : distinguer les cas vous apprendrait l'existence d'un budget que vous n'avez pas le droit de voir |
| « Auteur inconnu » dans la colonne « Auteur » | Le compte qui a saisi la ligne a été supprimé depuis. La ligne, elle, est intacte |

**Le bouton « Revenir aux coûts du track »** de l'écran « Budget introuvable » vous ramène là d'où
vous venez, et là où les autres budgets sont listés.

### 25.4 Ce que cet écran ne fait pas

- **On n'y saisit rien.** Les lignes de coût se créent et se modifient depuis la fiche de l'affaire,
  section « Coûts » ; les budgets et leurs occurrences s'administrent depuis
  « Réglages ▸ Arborescence ».
- **Aucun tri, aucune période, aucun export.** La liste rend les lignes de la plus ancienne à la
  plus récente.

## 26. Les coûts de tout l'espace de travail : un cumul par track

**Où.** Barre latérale ▸ **« Coûts »**, entre « Objectifs » et « Pilotage ». L'adresse de la page est partageable et
rechargeable.

**Qui.** Tout membre de l'espace de travail. Ce que l'écran montre dépend de ce que vous avez le
droit de lire — voir le [§26.3](#votre-total-est-le-votre-et-il-peut-differer-de-celui-d-un-collegue), qui est la partie la plus importante de cette page.

### 26.1 Ce que l'écran montre

**Un groupe de deux barres par track**, cumulant **tous ses budgets ouverts** : le **prévisionnel**
— la somme des coûts estimés — et le **réel** — la somme des coûts réellement saisis. La barre du
réel passe au rouge lorsqu'elle dépasse le prévisionnel, et la légende nomme les trois séries.

C'est la différence exacte avec l'écran de coûts d'un track ([§24](#les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense)) : là-bas, une paire de
barres désigne **un budget** ; ici, elle désigne **un track entier**. Un track qui porte trois
budgets ouverts en euros rend donc **une** seule paire de barres, dont les montants sont la somme
des trois.

**Sous le graphique, le même tableau que partout ailleurs** : une ligne par track, le prévisionnel,
le réel, le nombre de lignes en attente de leur coût réel, et un **total**. Ce tableau est la
version lisible du graphique : il reste juste si la couleur ne passe pas, et c'est lui que lit un
lecteur d'écran.

**Le nom d'un track est un lien** vers ses propres coûts, budget par budget ([§24](#les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense)). C'est le
chemin normal : on lit d'abord quels tracks dépensent, puis on ouvre celui qu'on veut détailler.

**Un budget clôturé n'entre dans aucun cumul.** Il ne disparaît pas pour autant : ses lignes restent
lisibles depuis sa propre fiche ([§25](#le-detail-d-un-budget-occurrence-par-occurrence-ligne-par-ligne)).

**Un track archivé ou mis à la corbeille ne figure pas sur cet écran** — comme il ne figure pas dans
la barre latérale. Si un budget y est resté ouvert, il se lit depuis l'écran de coûts de ce track,
dont l'adresse continue de répondre.

### 26.2 Les devises ne se mélangent jamais

Si les budgets que vous lisez sont libellés dans **plusieurs devises**, l'écran rend **un graphique
par devise**, chacun avec son **titre** — « Coûts en EUR », « Coûts en CHF » — et son propre total.
Additionner des francs et des euros ne voudrait rien dire, et les poser sur un même axe rendrait la
comparaison fausse à l'œil.

Si tout est libellé dans une seule devise — le cas courant —, vous ne voyez rien de cette mécanique :
un seul graphique, sans titre de devise.

### 26.3 Votre total est le vôtre, et il peut différer de celui d'un collègue

**C'est la règle la plus importante de cet écran.** Le cumul est calculé **à partir de ce que vos
droits vous laissent lire**, jamais à partir de tout ce qui existe. Un budget qui appartient à un
track qui vous est fermé :

- n'apparaît nulle part ;
- n'entre dans **aucun** total ;
- et **n'est signalé par rien**.

Deux collègues aux droits différents lisent donc deux nombres différents sur le même écran, au même
instant. Ce n'est pas une erreur de calcul : afficher un total « complet » vous apprendrait, par
simple soustraction, l'existence et le montant d'un budget que vous n'avez pas le droit de voir.

L'écran l'écrit sous les graphiques, pour que personne n'ait à le deviner :

> « Ce cumul ne porte que sur les budgets ouverts des tracks que vous pouvez lire. Un track archivé
> ou mis à la corbeille n'y figure pas ; ses budgets restent lisibles depuis son propre écran de
> coûts. »

Si un montant vous paraît manquer, la question à poser n'est donc pas « l'écran s'est-il trompé ? »
mais « ai-je le droit de lire ce track ? ».

### 26.4 Ce que l'écran écrit quand il n'y a rien à montrer

| Ce que vous lisez | Ce que cela veut dire |
|---|---|
| « n ligne(s) sans coût réel saisi, pour m € de prévisionnel. » | Des dépenses ont été engagées sans que leur coût réel ait encore été saisi. La barre du réel est donc plus basse que la réalité |
| « Aucune dépense rattachée. » | Les tracks de cette devise ont bien un budget ouvert, mais aucune affaire n'y a encore rattaché la moindre ligne de coût |
| « Aucun budget ouvert » | Aucun des tracks que vous pouvez lire ne porte de budget ouvert — **ou** vous n'en lisez aucun. Les deux cas se ressemblent volontairement : les distinguer vous apprendrait l'existence de ce que l'écran cache |
| « Aucun espace de travail » | Votre session a expiré, ou votre compte n'appartient à aucun espace de travail. Reconnectez-vous |

### 26.5 Ce que cet écran ne fait pas

- **On n'y saisit rien.** Les lignes de coût se créent depuis la fiche d'une affaire, section
  « Coûts » ; les budgets s'administrent depuis « Réglages ▸ Arborescence ».
- **Aucun filtre, aucune période, aucun export, aucune conversion de devise.** L'écran rend les
  tracks dans l'ordre de la barre latérale.
- **Aucun total toutes devises confondues** — voir le [§26.2](#les-couts-de-tout-l-espace-de-travail-un-cumul-par-track).

### 26.6 Deux onglets, ici aussi

Cet écran porte les **mêmes deux onglets** que celui d'un track ([§24.5](#deux-onglets-et-le-second-est-celui-ou-l-on-saisit)) : « Vue
d'ensemble » et **« À saisir »**. La différence est la **portée** : ici, l'onglet liste les lignes
en attente de **tous les tracks que vous lisez**, et non celles d'un seul. Tout est décrit au
[§27](#l-onglet-a-saisir-renseigner-les-couts-reels-a-la-suite).

## 27. L'onglet « À saisir » : renseigner les coûts réels à la suite

**Où.** Sur l'écran de coûts d'un track ([§24](#les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense)) ou sur celui de l'espace de travail
([§26](#les-couts-de-tout-l-espace-de-travail-un-cumul-par-track)), l'onglet **« À saisir »**, à droite de « Vue d'ensemble ». L'adresse gagne
`?onglet=saisir` : elle se partage et se recharge, et le bouton « précédent » du navigateur revient
à l'onglet d'avant.

**À quoi il sert.** Le graphique dit **combien** de coûts réels manquent ; il ne permettait pas de
les saisir. Il fallait ouvrir une affaire après l'autre. Cet onglet est la surface de **saisie en
série** : une ligne par coût en attente, un champ par ligne, et le clavier pour aller de l'une à
l'autre.

**Ce que la table liste.** Toutes les lignes de coût **non soldées** que vous avez le droit de
**lire**, dans la portée de l'écran, **de la plus ancienne à la plus récente** — celle qui attend
depuis le plus longtemps est celle qu'on oublie. Une ligne reçoit autant de coûts réels qu'il en
faut — une facture, puis une autre — et reste dans la table tant qu'on ne l'a pas **soldée**. Chaque
ligne porte son **ancienneté**, son **budget**, son **occurrence** le cas échéant, son **affaire** (le
titre est un lien vers la fiche), la **nature** de la dépense, son **coût estimé**, et ce qui est
**« Déjà saisi »** — la somme de ses réels.

**Les budgets clôturés y figurent, et c'est voulu :** c'est précisément après la clôture que les
factures arrivent. La ligne d'un budget clos porte une pastille **« clôturé »** — une indication
neutre, jamais une alerte : la clôture n'empêche pas de saisir le coût réel, elle empêche seulement
de **changer le rattachement** d'une ligne.

### 27.1 Saisir, au clavier

- **Tapez le montant dans le champ « Un réel de plus », puis `Entrée`.** Le réel s'ajoute à la
  ligne immédiatement — il n'y a **aucun bouton d'enregistrement** —, « Déjà saisi » montre la
  nouvelle somme, le champ se vide pour le réel suivant, et le curseur passe au champ de la **ligne
  suivante**. C'est cela, saisir à la suite.
- **La date et le libellé** (« Facture n° 42 ») se règlent à la demande, par le crayon à côté du
  champ ; sans eux, le réel est daté du jour et sans libellé.
- **Cochez « Soldé »** quand toutes les factures d'une ligne sont arrivées : elle quitte la table au
  prochain chargement. Soldée sans aucun réel, elle vaut **zéro** — « finalement rien dépensé ».
- **`Échap`** annule la saisie en cours et laisse la ligne intacte : rien n'est envoyé.
- **La ligne enregistrée ne disparaît pas sous vos doigts.** Elle reste à sa place, sur un fond
  vert, marquée « Enregistré », **jusqu'au prochain chargement de l'onglet**. La retirer aussitôt
  ferait remonter les lignes suivantes pendant que vous tapez, et vous feriez écrire une valeur dans
  la mauvaise ligne.
- **Un champ laissé vide n'envoie rien.** Un `0` saisi est un réel comme un autre ; c'est « Soldé »
  qui fait sortir une ligne de l'attente. La règle est écrite sous la table, avec la consigne
  clavier.

### 27.2 Ce que vous ne pouvez pas modifier reste visible

Une ligne que vous pouvez **lire** mais pas **écrire** est rendue comme les autres, avec son champ
**désactivé** et la phrase « Vous ne pouvez pas modifier cette affaire. » sous lui. Elle n'est
**jamais masquée** : une table qui cacherait des lignes se lirait comme complète alors qu'elle ne
l'est pas.

Si **aucune** des lignes que vous lisez n'est modifiable — le cas d'un compte en lecture seule —, la
table est rendue entière et le dit **en tête** : « Aucune de ces lignes ne peut être modifiée avec
vos droits : ce tableau est en lecture seule. »

Ce droit est demandé à la base, ligne par ligne, et jamais déduit de votre rôle : les droits fins
ouvrent l'écriture channel par channel, et un rôle ne dirait pas la vérité.

### 27.3 Ce que l'écran écrit quand quelque chose ne va pas

| Ce que vous lisez sous le champ | Ce que cela veut dire |
|---|---|
| « Enregistrement… » | L'envoi est en cours |
| « Enregistré » | La base a retenu le réel — « Déjà saisi » montre **la somme qu'elle tient** |
| « Ce montant n'est pas un nombre. » | La saisie n'a pas été envoyée, et elle reste à l'écran pour être corrigée |
| « Aucune ligne n'a été enregistrée. […] rechargez l'onglet. » | Ni un succès ni une erreur : vos droits ont pu changer depuis l'ouverture de l'écran. Rien n'a été écrit |
| « Vous ne pouvez pas modifier cette affaire. » | La base a refusé l'écriture |
| « Tous les coûts réels sont saisis » | Il n'y a rien à saisir dans cette portée. C'est une bonne nouvelle, pas un écran en panne |

### 27.4 Le compteur de l'onglet

Le badge porte le nombre de lignes **que la table liste** — les lignes non soldées que vous lisez,
budgets clôturés compris, y compris celles que vous ne pouvez pas modifier.

**Il peut différer du nombre écrit sous le graphique** de la vue d'ensemble (« n ligne(s) sans coût
réel saisi »), et ce n'est pas une erreur : le graphique **exclut les budgets clôturés** et compte
**par devise**, là où le badge est un nombre unique. Les deux chiffres ne comptent pas la même
chose.

**L'écran le dit lui-même, et vous n'avez donc rien à deviner.** Dès que le badge paraît, l'onglet
« Vue d'ensemble » écrit sous la barre d'onglets :

> « Le compteur de l'onglet "À saisir" porte sur tout cet écran, budgets clôturés compris et toutes
> devises confondues ; les mentions sous les histogrammes ne comptent que les budgets qu'ils
> montrent. »

Un exemple : un track porte des lignes non soldées sur un budget ouvert et sur un budget clôturé, dont une qui a déjà
reçu un réel ; le badge les compte toutes, quand la mention sous le graphique ne compte que la ligne sans réel du
budget ouvert.

C'est la même règle que celle du cumul du workspace ([§26.3](#votre-total-est-le-votre-et-il-peut-differer-de-celui-d-un-collegue)) : quand deux nombres d'un même
écran ne comptent pas la même chose, l'écran écrit lequel compte quoi.

### 27.5 Ce que cet onglet ne fait pas

- **Il ne crée aucune ligne de coût** : une dépense se crée depuis la fiche de son affaire, section
  « Coûts ».
- **Il ajoute des réels et solde des lignes** — il ne modifie ni la nature, ni le budget, ni
  l'occurrence, ni le coût estimé.
- **Il ne corrige ni ne retire un réel déjà saisi** : cela se fait depuis la fiche de son affaire
  ([§27.6](#les-reels-d-une-ligne-dans-la-fiche-d-une-affaire)).
- **Aucun import de fichier, aucun rapprochement automatique avec une facture.**

### 27.6 Les réels d'une ligne, dans la fiche d'une affaire

Dans la section « Coûts » d'une fiche, la colonne « Réel » d'une ligne est la **somme de ses réels**,
et le formulaire d'une ligne ne porte plus de réel : il en règle la nature, le budget, l'occurrence
et le coût estimé. La flèche au début des actions de la ligne **déplie ses réels**, sous la table :

- la liste des réels — date, libellé ou « Sans libellé », montant —, chacun **modifiable** (crayon)
  et **retirable** (corbeille, après confirmation) ;
- la saisie d'un réel de plus : montant, date (celle du jour par défaut), libellé facultatif, puis
  « Ajouter le réel » ;
- la case **« Soldé »**. Une ligne soldée porte la pastille « Soldé » ; ses réels ne se modifient
  plus, et l'écran le dit : « Ligne soldée — décochez « Soldé » pour la modifier. » Décocher la
  rouvre.

Un budget clôturé n'empêche rien de tout cela : on clôt une campagne, puis les factures arrivent.

## 28. Le temps passé et le coût du personnel

L'écran **« Temps »**, dans la barre latérale, a deux onglets : **« Saisie »**, où chacun note le temps qu'il a passé,
et **« Rapport mensuel »**, où ce temps est valorisé par le coût du personnel.

### 28.1 Saisir sa semaine

La matrice montre une semaine, du lundi au dimanche. Ses lignes sont les tracks que vous lisez, chacun suivi de ses
channels, et sous eux les affaires qui portent déjà du temps — celles de la semaine affichée et de la précédente sont
reprises d'office. Pour une autre affaire, tapez son titre dans **« Ajouter une affaire »** et choisissez-la : sa ligne
paraît sous son channel.

Chaque cellule se saisit au **quart de journée** : une journée compte **7 heures**, un quart vaut donc 1 h 45, et une
cellule va de 0 à 4. La valeur **s'enregistre seule** quand vous quittez la cellule ou appuyez sur `Entrée` — qui
descend à la ligne suivante ; les flèches vont de cellule en cellule, `Échap` rétablit la valeur enregistrée. Une
cellule vide vaut zéro, et vider une cellule retire ce temps.

Le pied de la matrice dit, jour par jour, où vous en êtes — « 3 / 4 quarts » ; une journée pleine est surlignée. **Une
journée ne dépasse jamais 7 heures** : une valeur qui la dépasserait est refusée, avec le message « Cette valeur
dépasserait la journée de 7 heures. »

« Semaine précédente », « Semaine suivante » et « Cette semaine » changent de semaine ; l'adresse de l'écran garde la
semaine affichée.

### 28.2 Saisir une journée en heures

Plus de quatre affaires dans la journée : cochez **« En heures »** sous le jour. Ses cellules se saisissent alors en
heures, au quart d'heure — « 1,5 » pour une heure et demie, « 0,25 » pour un quart d'heure —, toujours dans la limite de
7 heures. Tant qu'une valeur de ce jour ne tombe pas sur un quart, la case reste cochée, et l'écran le dit.

### 28.3 Saisir pour quelqu'un d'autre

Un administrateur dispose de **« Saisir pour »** : il choisit une personne, et un bandeau rappelle « Vous saisissez le
temps de… ». Le produit garde la trace de qui a saisi. Un membre ne saisit que son propre temps, et seulement sur ce
qu'il peut lire.

### 28.4 Le rapport mensuel

Choisissez un mois : le rapport liste chaque track, channel et affaire où du temps a été passé, avec ce temps et son
coût. Le coût est celui de la personne **le jour où le temps a été passé** : une augmentation ne change pas le coût des
semaines d'avant. Les montants restent séparés par devise. Le temps d'une personne qui n'a pas encore de coût est
compté, et dit **« non valorisé »** — jamais zéro.

Un membre ne voit que **son** temps et **son** coût. Un administrateur choisit une personne, ou **« Toute l’équipe »**,
qui rend une section par personne.

### 28.5 Régler le coût du personnel

Dans **Réglages ▸ « Coût du personnel »**, réservé aux administrateurs — pour les autres, l'entrée des
réglages est un texte grisé ([section 3.11](#les-commandes-grisees-ce-que-votre-role-vous-laisse-faire)) —, chaque personne a sa carte : son coût en
vigueur, sa prochaine version s'il y en a une. **« Nouvelle version »** fixe un coût par quart, une devise et une date
d'effet : augmenter quelqu'un, c'est créer une version, qui vaut à partir de sa date. Une version ne se modifie jamais ;
une date d'effet n'est jamais passée, sauf pour la toute première version d'une personne, qui peut valoriser du temps
déjà saisi. **« Historique »** liste les versions ; une version **programmée** peut encore être retirée, une version
en vigueur jamais.

**Calculer le coût par quart.** Dans le formulaire « Nouvelle version », **« Calculer depuis le coût mensuel »** ouvre un
petit calcul. Saisissez le salaire brut mensuel, les charges sociales en pourcentage du brut,
les frais de gestion et les avantages par mois, et le nombre de jours travaillés par an — 218 par défaut, le forfait
jours ; un salarié qui n’est pas au forfait en travaille plutôt 228 environ (365 jours, moins les week-ends, 25 jours de congés et les
fériés). Le calcul affiche, à mesure que vous tapez, le coût mensuel complet et le coût par quart :

> coût mensuel complet = brut × (1 + charges) + frais + avantages ;
> coût par quart = coût mensuel complet × 12 ÷ (jours × 4).

Par exemple, 3 000 € de brut, 42 % de charges, 150 € de frais et 100 € d'avantages font 4 510 € par mois, soit
62,06 € par quart sur 218 jours. **« Utiliser ce coût »** recopie le résultat dans « Coût par quart » ; rien n'est
enregistré tant que vous n'avez pas cliqué **« Enregistrer la version »**, et seul le coût par quart l'est — le salaire
et les charges ne sont conservés nulle part.

### 28.6 Le coût du personnel à côté des coûts

Sur l'écran de coûts d'un track ([chapitre 24](#les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense)), sous l'histogramme, **« Coût du personnel »** donne le temps et
son coût du mois choisi, channel par channel. Dans la fiche d'une affaire, **« Temps passé »** donne le temps passé
depuis le premier jour et son coût. Ces chiffres ne se mêlent ni aux budgets ni aux lignes de coût. Ils disent leur
portée : « Votre temps » pour un membre, « Le temps de toute l’équipe » pour un administrateur.

### 28.7 Saisir son temps depuis la fiche d'une affaire

Sous le résumé « Temps passé », **« Votre semaine »** montre la ligne de l'affaire, du lundi au
dimanche : les mêmes cases que l'écran « Temps », au quart de journée ou, en cochant la case sous un jour, au quart
d'heure. Une case s'enregistre seule ; `Entrée` passe au jour suivant. Taper une nouvelle valeur **remplace** celle du jour ; vider
la case retire ce temps. Sous la bande, le total de la semaine sur l'affaire.

Le total sous chaque jour compte **tout** votre temps de la journée, sur toutes les cibles : c'est lui qui ne dépasse
pas 7 heures. « Semaine précédente », « Semaine suivante » et « Cette semaine » changent de semaine ;
**« Ouvrir dans Temps »** ouvre la matrice sur la même semaine, pour le reste de votre journée.

Chacun n'y saisit que **son** temps — un administrateur aussi : pour saisir le temps de quelqu'un d'autre, passez par
« Saisir pour », sur l'écran « Temps ». Une lectrice saisit son temps sur une affaire qu'elle lit, même si elle ne peut
pas modifier l'affaire.

### 28.8 Ce qui n'est pas offert

Aucune validation ni clôture d'un mois, aucun calendrier de congés ou de jours fériés, aucune facturation au temps
passé, aucune conversion de devise, aucun export.

## 29. Les recettes d'une affaire et sa rentabilité

Une affaire porte ce qu'elle doit rapporter et ce qu'elle a rapporté, comme elle porte ce qu'elle coûte. Le rapport
de rentabilité rapproche les trois : recettes, coûts et coût du personnel.

### 29.1 Saisir les recettes dans la fiche

Dans la fiche d'une affaire, le bloc **« Recettes »** vient avant « Coûts ». **« Nouvelle ligne de recette »** ajoute une
ligne : sa nature — « Acompte », « Solde », « Lot 1 » — et sa recette prévue. Les montants sont dans la devise de
l'affaire, rappelée dans l'en-tête des colonnes.

Chaque ligne se déplie : on y ajoute une **recette réelle** par facture ou par encaissement — un montant, une date
(celle du jour par défaut) et un libellé facultatif. La colonne « Réel » est leur somme ; tant qu'aucune n'est saisie,
elle montre un tiret : la recette réelle est **inconnue**, pas nulle. Quand tout est encaissé, cochez **« Soldé »** :
la ligne ne reçoit plus de recette réelle, et une ligne soldée sans recette réelle vaut zéro. Décocher la rouvre.

Il faut pouvoir modifier l'affaire pour saisir ses recettes. Tant qu'une affaire porte des lignes de recette, sa devise
ne change plus.

### 29.2 La rentabilité d'une affaire

Pour un administrateur de l'espace, le bloc **« Rentabilité »** suit « Temps passé » : recettes, coûts, coût du
personnel et marge, en **prévu** et en **réel**, et le taux de marge réelle. La marge est **recettes − coûts −
personnel**. Une marge négative est écrite avec son signe, sur fond rouge. La mention **« partielle »** dit qu'il manque
encore quelque chose — une recette ou un coût sans réel, du temps sans coût défini ; survolez-la pour savoir quoi.

La marge prévue soustrait le temps **déjà passé** : le CRM ne prévoit pas le temps. Une affaire dont les montants sont
dans plusieurs devises a une marge **« Non calculable — plusieurs devises »** : le CRM ne convertit pas les devises.

### 29.3 L'écran « Rentabilité »

Barre latérale ▸ **« Rentabilité »**, après « Pilotage ». L'onglet **« Vue d'ensemble »** rend un tableau par devise :
chaque track, ses channels et leurs affaires, avec un sous-total à chaque niveau et le total. Les filtres :

- **« Du »** et **« Au »** retiennent les recettes réelles, les coûts réels et le temps par leur date ; les montants
  prévus portent toujours sur toute l'affaire ;
- **« État »** : toutes les affaires, les gagnées, les en cours ou les perdues ;
- **« Réel »** et **« Prévu »** changent de vue.

Seuls les **administrateurs** de l'espace lisent ce rapport : il soustrait le coût du temps de toute l'équipe, que
seuls eux peuvent lire. Un autre membre lit « Réservé aux administrateurs » et un lien vers l'onglet « À saisir ».

### 29.4 L'onglet « À saisir »

Il liste les lignes de recette **non soldées**, de la plus ancienne à la plus récente, pour tout membre. Tapez un montant
dans **« Une recette de plus »** : `Entrée` l'enregistre, à la date du jour, et passe à la ligne suivante. Saisir 0
enregistre une recette nulle ; laisser le champ vide ne change rien. Cochez « Soldé » quand la ligne est encaissée. Une
ligne que vous ne pouvez pas modifier reste visible, son champ éteint, avec le motif.

### 29.5 Ce qui n'est pas offert

Aucune facturation ni relance d'impayé, aucune conversion de devise, aucune prévision du temps, aucune répartition d'une
recette entre plusieurs affaires, aucun export.

## 30. L'entonnoir de conversion : où se tiennent vos affaires

**Où.** Barre latérale ▸ **« Pilotage »**, entre « Coûts » et « Rentabilité ». L'adresse de la page est partageable et
rechargeable.

**Qui.** Tout membre de l'espace de travail. Ce que l'écran montre dépend de ce que vous avez le
droit de lire — voir le [§30.5](#vos-nombres-sont-les-votres-et-ils-peuvent-differer-de-ceux-d-un-collegue), qui est la partie la plus importante de cette page.

### 30.1 Choisir la portée : tout l'espace, un track, un channel

En **tête** de l'écran, au-dessus des deux nombres, un champ **« Portée »** choisit ce que tout le
reste de la page mesure : **tout l'espace de travail** — le défaut —, **un track entier**, ou **un
channel**. Les options sont groupées par track, et chacune nomme son track : « Studio web — tout le
track », « Studio web — Refonte de site ». Vous ne voyez que les tracks et les channels que vous
avez le droit de lire.

**Changer de portée ne recharge rien.** Les nombres se replient instantanément : l'écran a lu une
seule fois, et la portée ne fait que choisir ce qu'il additionne. Les **deux nombres** du [chapitre 31](#le-previsionnel-pondere-et-le-taux-de-conversion)
et les **mentions** suivent la portée, comme les tableaux — un prévisionnel de tout l'espace
au-dessus d'un entonnoir d'un seul channel dirait le contraire de ce qu'il montre.

**L'adresse porte votre choix, et se partage** : recharger la page, la mettre en favori ou en envoyer le lien garde la
portée. Pour un channel, l'adresse nomme aussi son track, parce que le nom court d'un channel n'est unique qu'à
l'intérieur de son track.

**Une adresse que l'écran ne sait pas résoudre ne provoque aucune erreur.** Un track que vous ne
lisez pas, un nom mal recopié, un channel nommé sous un track qui ne le porte pas : l'écran retombe
sur la portée la plus large qu'il a comprise — le track, ou tout l'espace de travail — et **le champ
« Portée » affiche alors la portée réellement appliquée**. Rien ne vous dit si le nom que vous aviez
tapé existe ailleurs : ce serait vous renseigner sur ce que vos droits ferment.

**Une portée sans affaire garde son champ.** Si le track ou le channel choisi ne porte aucune
affaire active lisible, l'écran l'écrit — « Aucune affaire active dans cette portée » — **sans**
retirer le champ, pour que vous puissiez en choisir une autre sans repasser par l'adresse.

**Un track sans channel n'est pas proposé**, et un channel **archivé** ou **à la corbeille** non
plus : il n'y a rien d'actif à y mesurer.

### 30.2 Ce que l'écran montre

Un **tableau par devise**, une **ligne par étape** de vos workflows, dans **l'ordre du catalogue** —
celui-là même que suivent les colonnes de vos boards. Chaque ligne porte :

| Colonne | Ce qu'elle dit |
|---|---|
| **Étape** | Le nom du nœud, tel que le catalogue le porte — jamais le nom qu'un workflow lui a donné localement. C'est ce qui permet de comparer deux workflows sur la même ligne |
| **Genre** | « Ouvert », « Gagné » ou « Perdu ». C'est lui, et lui seul, qui dit pourquoi une étape entre ou n'entre pas dans le prévisionnel du [§31](#le-previsionnel-pondere-et-le-taux-de-conversion) |
| **Affaires** | Combien d'affaires actives se tiennent à cette étape |
| **Montant (…)** | La somme de leurs montants, dans la devise que l'en-tête nomme |
| **Pondéré (…)** | La même somme, chaque affaire multipliée par sa **probabilité** ([§30.4](#la-probabilite-d-une-affaire-trois-niveaux-et-le-plus-precis-gagne)) |

**L'ordre ne se change pas, et aucune colonne ne se trie.** Un entonnoir est un **chemin** : le
reclasser par montant en ferait un palmarès, où « Perdu » remonterait au-dessus de « Prospection ».

**Une étape où aucune affaire ne se tient n'a pas de ligne — elle est NOMMÉE sous les tableaux.**
Elle n'est jamais rendue « à zéro » : un zéro affirmerait une mesure que l'écran n'a pas faite, et il
faudrait de surcroît le poser dans une devise qu'aucune affaire n'y porte. L'écran écrit donc, sous
les tableaux et dans l'ordre du catalogue : « Aucune affaire active aux étapes Signature et Perdu. »

C'est la lecture la plus utile de cet écran sous une portée restreinte : elle dit **de quelles
étapes** un track ou un channel est absent — où est le trou du chemin. Une étape **archivée** n'y
figure pas : elle n'est plus une étape du chemin, et la nommer « sans affaire » inviterait à y en
mettre une.

### 30.3 Quelles affaires y entrent, et lesquelles n'y entrent pas

**Y entrent** toutes vos affaires **actives** — celles qui ne sont ni archivées, ni à la corbeille.
Cela comprend :

- les affaires **gagnées** et **perdues**, qui ont leur propre ligne, marquée par la colonne
  « Genre » ;
- les affaires **en sommeil**. Mettre une affaire en sommeil dit « ne me réveille pas à son sujet »,
  jamais « cette affaire n'est plus au portefeuille » : la retirer ferait **disparaître un montant**
  d'un total du seul fait qu'on a demandé le silence.

**N'y entrent pas** les affaires **archivées** et celles qui sont **à la corbeille**. Une affaire
gagnée puis archivée ne compte donc ni dans l'entonnoir, ni dans le taux de conversion du
[§31.2](#le-taux-de-conversion-des-affaires-decidees).

### 30.4 La probabilité d'une affaire : trois niveaux, et le plus précis gagne

Le montant **pondéré** est le montant de l'affaire multiplié par sa probabilité. Cette probabilité
se résout à trois niveaux, du plus précis au plus général :

1. **la probabilité de l'affaire elle-même**, saisie sur sa fiche ;
2. sinon, **la probabilité de l'étape** du workflow, saisie dans l'éditeur de workflows ([§18](#composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire)) ;
3. sinon, **la probabilité par défaut du nœud**, saisie au catalogue ([§19](#le-catalogue-de-noeuds-le-vocabulaire-de-vos-workflows)).

**Une probabilité absente n'est jamais remplacée par un défaut.** Si aucun des trois niveaux n'est
renseigné, la probabilité est **inconnue** : l'affaire est comptée dans la colonne « Affaires »,
elle est comptée dans la mention « n affaire(s) sans probabilité renseignée », et elle ne contribue
**pas** au montant pondéré. Écrire zéro à sa place transformerait « personne n'a dit ce que vaut
cette affaire » en « cette affaire ne vaut rien ».

**Un montant absent suit la même règle** : l'affaire est comptée, elle est signalée par la mention
« n affaire(s) sans montant renseigné », et elle ne contribue ni au montant ni au pondéré.

Ces deux mentions sont rendues **sous les tableaux**, et seulement lorsqu'elles ont un objet. Sans
elles, un prévisionnel bas se lirait comme un portefeuille **pauvre** au lieu d'un portefeuille
**mal renseigné**.

### 30.5 Vos nombres sont les vôtres, et ils peuvent différer de ceux d'un collègue

**C'est la règle la plus importante de cet écran**, et c'est exactement celle du cumul des coûts
([§26.3](#votre-total-est-le-votre-et-il-peut-differer-de-celui-d-un-collegue)). L'entonnoir est calculé **à partir de ce que vos droits vous laissent lire**, jamais
à partir de tout ce qui existe. Une affaire d'un channel qui vous est fermé :

- n'apparaît dans aucune ligne ;
- n'entre dans **aucun** total ;
- et **n'est signalée par rien**.

Deux collègues aux droits différents lisent donc deux nombres différents sur le même écran, au même
instant. Ce n'est pas une erreur de calcul : afficher un total « complet » vous apprendrait, par
simple soustraction, l'existence et le montant d'une affaire que vous n'avez pas le droit de voir.

L'écran l'écrit sous les tableaux, pour que personne n'ait à le deviner — et la phrase **nomme la
portée courante** :

> « Ces nombres portent sur toutes les affaires actives que vous pouvez lire, tous tracks et tous
> channels confondus. Un collègue dont les droits diffèrent des vôtres lit d'autres totaux sur les
> mêmes données. »

> « Ces nombres portent sur les affaires actives du track « Studio web » que vous pouvez lire. […] »

**Le sélecteur de portée n'ouvre aucun droit.** Choisir un channel, ou l'écrire dans l'adresse, ne
montre rien de plus que ce que vos droits consentent déjà : la restriction s'applique **après** vos
droits, jamais à leur place.

### 30.6 Les devises ne se mélangent jamais

Si vos affaires sont libellées dans **plusieurs devises**, l'écran rend **un tableau par devise**,
chacun avec son **titre** — « Entonnoir en EUR », « Entonnoir en CHF ». Si tout est libellé dans une
seule devise — le cas courant —, vous ne voyez pas ce titre ; les en-têtes des deux colonnes de
montant nomment la devise dans tous les cas.

Aucun total « toutes devises confondues » n'est affiché : additionner des francs et des euros
demanderait un taux de change que le produit ne connaît pas, et le nombre obtenu se lirait pourtant
comme un chiffre d'affaires.

### 30.7 Ce que l'écran écrit quand il n'y a rien à montrer

| Ce que vous lisez | Ce que cela veut dire |
|---|---|
| « Aucune affaire active » | Aucune affaire active ne vous est lisible — **ou** il n'en existe aucune. Les deux cas se ressemblent volontairement : les distinguer vous apprendrait l'existence de ce que l'écran cache |
| « Lecture refusée » | Votre session ne permet pas de lire l'entonnoir. Reconnectez-vous, puis revenez sur cet écran |
| « L'entonnoir n'a pas pu être lu » | La lecture a échoué. Le bouton « Réessayer » relance réellement la requête |
| « Aucun espace de travail » | Votre session a expiré, ou votre compte n'appartient à aucun espace de travail |

### 30.8 Ce que cet écran ne fait pas

- **On n'y saisit rien**, et aucune ligne n'est cliquable. Les probabilités se saisissent au
  catalogue ([§19](#le-catalogue-de-noeuds-le-vocabulaire-de-vos-workflows)), dans l'éditeur de workflows ([§18](#composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire)) et sur la fiche d'une affaire ([§9](#l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre)).
- **Aucun score de santé** : l'entonnoir compte des affaires, il ne les note pas. Les deux scores d'une affaire se
  lisent sur sa carte du tableau et sur sa fiche ([section 9.1](#ce-qu-une-affaire-porte)).
- **Aucune lecture d'historique.** L'entonnoir est un **instantané** de l'état courant, jamais une
  analyse par période : il dit où vos affaires se tiennent **aujourd'hui**, pas ce qu'elles sont
  devenues depuis janvier.
- **Aucun export, aucune période, aucune conversion de devise.**

## 31. Le prévisionnel pondéré et le taux de conversion

**Où.** En **tête** de l'écran « Pilotage » ([§30](#l-entonnoir-de-conversion-ou-se-tiennent-vos-affaires)), au-dessus des tableaux : deux nombres, et
c'est la lecture que la plupart des visites viennent chercher.

### 31.1 Le prévisionnel pondéré

C'est la somme des montants de vos affaires **ouvertes**, chacune multipliée par sa probabilité
([§30.4](#la-probabilite-d-une-affaire-trois-niveaux-et-le-plus-precis-gagne)), **par devise**.

**Les étapes terminales en sont exclues**, et les deux motifs sont distincts : une affaire **gagnée**
n'est plus une prévision, et une affaire **perdue** vaut zéro — l'inclure ne changerait aucun total
tout en laissant croire qu'elle compte. C'est pourquoi la colonne « Genre » de l'entonnoir n'est pas
décorative : elle vous dit quelles lignes du tableau alimentent ce nombre.

**Une devise dont toutes les affaires sont closes n'apparaît pas.** « CHF : 0,00 » se lirait comme
une prévision nulle au lieu d'une absence de prévision.

**S'il n'y a aucune affaire ouverte**, l'écran écrit « Aucune affaire ouverte à ce jour. » plutôt
qu'un zéro.

### 31.2 Le taux de conversion des affaires décidées

**Son nom entier compte, et l'écran ne l'abrège jamais.** Ce nombre est la part **gagnée** parmi les
affaires qui se tiennent **actuellement** à une étape terminale :

> gagnées ÷ (gagnées + perdues)

Il est accompagné de son numérateur et de son dénominateur en toutes lettres — « 7 gagnées sur
8 décidées » —, parce qu'un pourcentage seul ne dit pas sur combien il porte.

**Ce n'est pas « la part gagnée parmi les affaires ouvertes en janvier ».** Les deux lectures
diffèrent dès qu'une affaire décidée est archivée : une affaire gagnée puis archivée ne compte dans
**ni l'une ni l'autre** de ce que cet écran montre. L'analyse par période — dite par cohortes — n'est
pas livrée, et appeler ce nombre du nom de l'autre serait un compteur complaisant.

**Zéro affaire décidée rend « Aucune affaire décidée à ce jour. », jamais « 0 % ».** Un taux de 0 %
dit « tout a été perdu » ; l'absence de toute décision ne dit rien.

### 31.3 Aucun objectif chiffré n'est confronté à ce prévisionnel

Les **objectifs** existent dans le produit ([chapitre 8](#les-objectifs-le-tableau-blanc-de-l-equipe)) sous forme de tableaux de blocs et de flèches,
avec un **remplissage** que vous saisissez à la main. Rien n'y décrit un objectif **chiffré** qu'un
prévisionnel viendrait remplir automatiquement.

Cet écran donne donc le prévisionnel **seul** : il ne le compare à aucun objectif.

### 31.4 Ce que ces deux nombres ne sont pas

- **Ils ne sont pas un chiffre d'affaires.** Le prévisionnel est une espérance : il vaut ce que
  valent les probabilités saisies.
- **Ils ne sont pas comparables d'un collègue à l'autre** sans précaution : chacun lit les siens sur
  son propre portefeuille ([§30.5](#vos-nombres-sont-les-votres-et-ils-peuvent-differer-de-ceux-d-un-collegue)).
- **Le taux ne traverse pas les devises par accident** : il compte des **affaires**, pas de l'argent,
  et c'est la seule grandeur de cet écran qui le fasse légitimement.

## 32. La plateforme : espaces, membres et superadministrateurs

La **plateforme** est l'étage au-dessus des espaces de travail. On y crée un espace, on y désigne qui en est membre et
avec quel rôle, et on y inscrit les personnes attendues. Elle est réservée aux **superadministrateurs**.

### 32.1 Qui est superadministrateur

Deux sortes de personnes le sont :

- celles qui portent le rôle **`admin` chez LeLabs** : elles exploitent le SSO, et la règle du domaine fait d'elles les
  administratrices de toute application qui s'y branche ;
- celles qui ont reçu le **drapeau** dans le CRM.

**Le tout premier drapeau** est posé une seule fois, à la première connexion d'une adresse que l'exploitant a désignée
à l'installation. La connexion doit être vérifiée chez LeLabs. Dès qu'un superadministrateur existe, plus aucun ne
s'amorce de cette façon : les suivants reçoivent le drapeau de la main d'un superadministrateur.

**Être superadministrateur ne donne accès à aucune donnée commerciale.** On ne lit ni les tracks, ni les affaires, ni
les coûts d'un espace dont on n'est pas membre. Pour y travailler, un superadministrateur s'ajoute lui-même comme
membre de cet espace, et ce geste est inscrit au journal.

### 32.2 Ouvrir la plateforme

Un superadministrateur voit l'entrée **« Plateforme »** en bas de la barre latérale, après « Réglages ». Personne
d'autre ne la voit. Une adresse de la plateforme ouverte sans le drapeau affiche **« Accès réservé »**.

La plateforme a quatre onglets : **« Espaces »**, **« Utilisateurs »**, **« Superadministrateurs »** et **« Journal »**.

### 32.3 Créer un espace

Dans l'onglet « Espaces », **« Nouvel espace »** ouvre un formulaire à trois champs :

- **« Nom »** ;
- **« Identifiant court »** : en minuscules, chiffres et tirets. Il nomme les dossiers de la messagerie et **ne se
  modifie plus ensuite** ;
- **« Domaine entrant (facultatif) »** : le domaine des adresses de ses affaires.

**« Créer »** ouvre la fiche du nouvel espace. Un espace naît **sans membre** : sa fiche le dit, et la liste porte
« Aucun administrateur ». Donnez-lui son premier administrateur, comme décrit ci-dessous. À sa première connexion, cet
administrateur trouvera le guide de démarrage, qui pose le workflow de départ ([chapitre 2](#le-guide-de-demarrage-par-ou-commencer)).

### 32.4 Les membres d'un espace

La fiche d'un espace liste ses **« Membres »**. Le rôle d'un membre se change dans sa ligne, et s'enregistre dès qu'on
le choisit.

- **« Ajouter un membre »** cherche une personne **par son nom**, deux caractères au moins, puis lui donne un rôle. Seules
  les personnes qui se sont déjà connectées au CRM y figurent.
- **« Retirer »** demande confirmation. Les droits fins de la personne sur les tracks et les channels de cet espace
  partent avec son appartenance.

**Un espace garde toujours au moins un administrateur.** Le premier membre d'un espace doit être administrateur, et le
dernier administrateur ne se retire ni ne se rétrograde. Le refus le dit, et indique quoi faire.

### 32.5 Les attentes

Une personne qui ne s'est jamais connectée n'a pas encore de nom dans le CRM. On l'**attend** à son adresse :
**« Inscrire une attente »**, avec l'adresse et le rôle. Elle devient membre à sa première connexion LeLabs, si son
adresse et son compte sont vérifiés ([chapitre 1](#se-connecter-et-se-deconnecter)). Réinscrire une adresse remplace son rôle, et **« Retirer »** efface
l'attente, sans confirmation.

Dans un espace qui n'a encore aucun administrateur, une attente qui n'est pas administratrice porte **« En
suspens »** : elle ne se consommera qu'après l'arrivée d'un administrateur. Inscrivez donc d'abord l'administrateur.

**« Dernière tentative »** dit si la personne attendue a déjà essayé de se connecter, et pourquoi elle a été refusée :
« Refusée le 21/10 : compte LeLabs pas encore vérifié », avec le nombre de refus quand il y en a eu plusieurs. Trois
motifs existent : **adresse non vérifiée chez LeLabs** (la personne doit confirmer son adresse dans son compte
LeLabs), **compte LeLabs pas encore vérifié** (LeLabs doit vérifier son compte), **l'espace n'a pas encore
d'administrateur** (nommez-en un). « Aucune tentative refusée » veut dire que la personne n'a pas essayé — ou que son
dernier essai date de plus de 90 jours : le CRM n'en garde pas la trace au-delà. Une adresse que personne n'attend ne
laisse jamais de trace, et réinscrire une attente efface la sienne.

### 32.6 Modifier ou supprimer un espace

**« Modifier »** change le nom et le domaine entrant d'un espace. Son identifiant court ne change pas.

**« Supprimer l’espace »**, en bas de la fiche, ouvre une confirmation.

- **Ce qu'elle dit :** ce que l'espace emporte avec lui — ses appartenances, ses attentes, et tout son contenu.
- **Ce qu'elle demande :** de **saisir l'identifiant court** de l'espace. **« Supprimer définitivement »** reste
  inactif tant que la saisie diffère.
- **Ce qui ne se rattrape pas :** la suppression est définitive. Seule la restauration d'une sauvegarde la défait.

### 32.7 Les utilisateurs

L'onglet **« Utilisateurs »** liste toutes les personnes admises au moins une fois dans le CRM. Pour chacune, il
affiche :

- ses **espaces**, chacun suivi de son rôle ; un clic sur un espace ouvre sa fiche. « Aucun espace » dit qu'elle n'en a
  plus ;
- la pilule **« Superadministrateur »**, si elle porte le drapeau ;
- sa **dernière activité au connecteur MCP**, ou « Jamais connecté » ;
- la date de sa première admission.

**« Rechercher un utilisateur »** filtre la liste par nom pendant que vous tapez, sans tenir compte des accents ni des
majuscules. La liste montre au plus 200 personnes ; au-delà, elle le dit, et la recherche affine.

L'onglet ne modifie rien. Pour ajouter une personne à un espace, ouvrez la fiche de l'espace ([§32.4](#les-membres-d-un-espace)). Pour lui donner
le drapeau, passez par l'onglet « Superadministrateurs » ([§32.8](#les-superadministrateurs-et-le-journal)). **« Droits du connecteur »**, sur chaque ligne, mène
à ses droits du connecteur MCP ([chapitre 33](#le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant)). Le rôle `admin` LeLabs n'y est pas affiché : le CRM
ne le connaît que par la connexion.

### 32.8 Les superadministrateurs et le journal

L'onglet **« Superadministrateurs »** liste les drapeaux posés dans le CRM.

- **« Amorçage »** désigne le premier drapeau, posé à l'installation.
- **« Accorder le drapeau »** le donne à une personne déjà connectée ; **« Retirer »** le lui reprend, après
  confirmation. Le dernier drapeau ne se retire pas : accordez-en un autre d'abord.
- **Les porteurs du rôle `admin` LeLabs** sont aussi superadministrateurs, mais n'y figurent pas.

L'onglet **« Journal »** retrace chaque geste de la plateforme, du plus récent au plus ancien :

- la date ;
- qui a agi ;
- le geste, en mots ;
- son détail.

**« Entrées plus anciennes »** remonte le temps, une page après l'autre.

Le journal de la plateforme et celui des appels du connecteur sont **conservés un an**. Chaque nuit, le CRM efface les
entrées plus anciennes, et inscrit le geste **« Journaux purgés »** avec le nombre d'entrées effacées de chacun. Personne
ne peut modifier ni supprimer une entrée de ces journaux ([chapitre 22](#le-journal-d-audit-ce-qui-s-est-fait-dans-votre-espace)).

### 32.9 Ce que la plateforme n'offre pas

- **Gérer ses propres membres en tant qu'administrateur d'espace**, sans être superadministrateur : c'est l'écran
  « Réglages ▸ Membres » ([chapitre 21](#les-membres-de-votre-espace-qui-y-travaille-avec-quel-role)), avec les attentes et les droits fins par track et par channel.
- **Changer l'identifiant court d'un espace.**
- **Annuler une suppression.**

## 33. Le connecteur MCP : piloter le CRM depuis votre assistant

Le **connecteur MCP** relie votre assistant — Claude, ChatGPT, ou tout client MCP — au CRM. L'assistant agit **en votre
nom** : il voit et modifie exactement ce que vous pourriez voir et modifier dans le CRM, jamais davantage.

### 33.1 Ce que l'assistant a le droit de faire

Deux règles se cumulent :

- **vos droits dans le CRM**, ceux de votre rôle dans chaque espace ;
- **les droits du connecteur**, qu'un superadministrateur vous accorde espace par espace, par **famille** et par
  **action**.

L'assistant ne peut faire que ce que **les deux** permettent. Un droit du connecteur dans un espace dont vous n'êtes pas
membre reste sans effet.

Les dix familles, et ce que chacune couvre :

- **Structure** : tracks, channels, lecture des workflows ;
- **Workflows** : créer, modifier et archiver les workflows, leurs étapes, leurs transitions et leur formulaire, le
  catalogue de nœuds ; leurs versions, leur copie vers un track, le workflow d'un channel ; la lecture d'un workflow
  reste à « Structure » ;
- **Affaires** : affaires, champs, étapes, commentaires, contacts liés, activités (appels, réunions, visios), checklist ;
- **Contacts** : les contacts du carnet ;
- **Organisations** : les organisations du carnet, et leurs contacts en lecture ;
- **Budgets** : budgets, occurrences, lignes de coût, réels ;
- **Recettes** : lignes de recette d'une affaire et leurs réels ; le rapport de rentabilité, réservé aux
  administrateurs de l'espace ;
- **Temps** : saisies de temps, et le coût du personnel en lecture ;
- **Objectifs** : tableaux d'objectifs ;
- **Messagerie** : lecture des fils ; l'envoi compte comme « ajouter ».

Les quatre actions sont **Consulter**, **Ajouter**, **Modifier** et **Supprimer**. « Supprimer » place en corbeille ou
archive, avec une seule exception : **retirer une étape ou une transition d'un workflow** (« Workflows ▸ Supprimer »)
la détruit définitivement, comme le fait l'éditeur de workflows, car le CRM ne garde pas d'étape ni de transition en
corbeille.

**Un superadministrateur franchit les droits du connecteur** : l'assistant lui ouvre tout ce que le CRM lui permet.

### 33.2 Ajouter le connecteur à votre assistant

1. Ouvrez la **page d'accueil du connecteur**, et cliquez sur **« Copier l'adresse du connecteur »**.
2. Dans votre assistant, ajoutez un **connecteur personnalisé** avec cette adresse.
3. Sur la page de consentement, autorisez l'accès. Cochez **« Stay signed in »** pour rester connecté entre deux pauses.
4. Connectez-vous avec votre compte LeLabs.

Si aucun droit ne vous est encore accordé, une page **« Droits en attente »** le dit : demandez à un superadministrateur
de vous en accorder, puis relancez la connexion.

La page d'accueil porte aussi **« Ouvrir la plateforme du CRM »**, qui mène à l'administration décrite ci-dessous.

### 33.3 Accorder des droits du connecteur

Dans la plateforme ([chapitre 32](#la-plateforme-espaces-membres-et-superadministrateurs)), l'onglet **« Connecteur MCP »** réunit trois blocs.

- **Les comptes venus au connecteur** : leur dernière activité et le nombre d'espaces où ils ont des droits. Un compte
  marqué **« Sans profil dans le CRM »** s'est connecté au connecteur sans avoir jamais été admis dans le CRM : il faut
  d'abord inscrire une attente à son adresse dans un espace ([§32.5](#les-attentes)).
- **« Accorder des droits à un utilisateur »** : cherchez une personne par son nom, parmi **tous** les utilisateurs du
  CRM, même ceux qui ne se sont jamais connectés au connecteur. Leurs droits vaudront dès leur première connexion.
  L'onglet « Utilisateurs » mène au même endroit, par **« Droits du connecteur »** sur chaque ligne.
- **Le journal des appels** ([§33.4](#le-journal-des-appels)).

**La fiche d'un utilisateur** montre :

- en haut, son nom et sa dernière activité au connecteur, ou « Jamais connecté » ;
- un **espace** à choisir, et son rôle dans cet espace. S'il n'en est pas membre, un avertissement rappelle que les
  droits resteront sans effet ;
- **la grille des droits** : les familles en lignes, les actions en colonnes, une case par droit. **« Toute la
  famille »** et **« Toute l’action »** cochent une ligne ou une colonne entière, ou la décochent quand elle est déjà
  pleine.

Rien ne s'écrit case par case : **« Enregistrer les droits »** enregistre la grille de l'espace en une fois, et
**« Annuler les modifications »** revient à l'état enregistré. Tant qu'une modification n'est pas enregistrée, le choix
de l'espace est verrouillé, pour qu'aucune saisie ne se perde. Une fois l'enregistrement fait, **« Droits
enregistrés. »** le confirme, et le geste est inscrit au journal de la plateforme.

Pour un superadministrateur, la grille reste visible mais ne se modifie pas, puisqu'il la franchit.

### 33.4 Le journal des appels

Chaque appel de l'assistant est inscrit, sans son contenu : la date, le compte, l'outil appelé, l'espace et l'issue —
« Réussi », « Refusé par la matrice », « Refusé par le CRM », « Erreur » ou « Réponse trop volumineuse ». Un filtre
retient une seule issue, et **« Entrées plus anciennes »** remonte le temps. La fiche d'un utilisateur montre ses
propres appels.

### 33.5 Ce que l'assistant sait faire

L'assistant ne voit que les outils que vos droits ouvrent : un outil fermé n'apparaît pas dans sa liste.

- **La liste des espaces** qui vous sont ouverts, dès qu'un droit du connecteur vous est accordé.
- **Recettes** :
  - *Consulter* : les lignes de recette d'une affaire ; les recettes réelles restant à saisir dans un espace ; le
    **rapport de rentabilité** d'un espace, qui demande aussi « Budgets ▸ Consulter » et « Temps ▸ Consulter »,
    puisqu'il montre les coûts et le coût du personnel. Le CRM le réserve aux administrateurs de l'espace : pour un
    autre membre, l'assistant reçoit un refus ;
  - *Ajouter* : une ligne de recette, avec sa nature et son montant prévu, ou une recette réelle datée ;
  - *Modifier* : corriger une ligne ou une recette réelle, solder une ligne ou la rouvrir.

  Aucun outil ne supprime une ligne de recette. Les règles sont celles de la fiche ([chapitre 29](#les-recettes-d-une-affaire-et-sa-rentabilite)) : une ligne
  soldée n'accepte plus de recette réelle, la recette réelle d'une ligne est la somme de ses réels, et la marge du
  rapport se calcule comme sur l'écran « Rentabilité ». Ce que l'assistant écrit apparaît aussitôt dans la fiche.
- **Affaires, en lecture** (« Affaires ▸ Consulter ») :
  - **lister les affaires** d'un espace, par titre, avec leur track, leur channel, leur étape, leur responsable et leur
    prochaine action — filtrées au besoin par channel, par mots du titre, par étape ou par échéance (en retard,
    aujourd'hui, dans la semaine). Les affaires en sommeil n'y paraissent que si on le demande ;
  - **lire une affaire** : son en-tête, sa description, sa probabilité, ses contacts liés et leur rôle, ses réponses au
    formulaire, si vous pouvez la modifier, et ses **deux scores de santé** avec leur détail ([chapitre 9.1](#ce-qu-une-affaire-porte)) — la liste
    des affaires les rend aussi ;
  - **lire son historique**, comme le fil de la fiche ([chapitre 9.12](#l-historique-et-la-discussion-d-une-affaire)) : événements, commentaires et activités, du plus
    ancien au plus récent ;
  - **lire ses commentaires**, et **ses activités** ([chapitre 9.8](#les-activites-d-une-affaire-appels-reunions-visios)) ;
  - **lire sa checklist** ([section 9.9](#la-checklist-d-une-affaire-les-points-a-cocher)) : les points libres, ceux de l'étape
    courante et ceux des étapes passées, cochés ou non, par qui et quand, et les étapes pour lesquelles un point est
    exigé ;
  - **les affaires figées** de l'espace ([chapitre 7](#les-affaires-figees-ce-qui-dort-depuis-trop-longtemps)) ;
  - **votre journée** ([chapitre 6](#ma-journee-ce-qui-est-en-retard-ce-qui-est-du-aujourd-hui)) : ce qui est en retard, dû aujourd'hui ou à venir dans les sept jours, pour
    vos affaires ou pour tout ce que vous lisez.

  L'assistant lit ce que vous liriez dans la webapp, et rien de plus : une affaire d'un track qui vous est fermé est
  « introuvable » pour lui aussi.
- **Affaires, en écriture** :
  - *Ajouter* (« Affaires ▸ Ajouter ») : **créer une affaire** dans un channel, avec son titre — elle naît à l'étape
    initiale, comme par le bouton « Nouvelle affaire » ; **la commenter** ; y **consigner une activité** réalisée,
    avec ses participants ;
  - *Modifier* (« Affaires ▸ Modifier ») : changer son **en-tête** — titre, description, montant, probabilité,
    prochaine action et échéance, responsable désigné par son nom — et ses **réponses au formulaire** ; la
    **déplacer** vers une étape désignée par son nom, dans les seuls déplacements que le workflow déclare ; la **changer
    de channel** ; la **mettre en sommeil** ou la **réveiller** ; **lier ou délier un contact** (ce geste demande aussi
    « Contacts ▸ Consulter ») ; **corriger une activité** dont vous êtes l'auteur ; **cocher ou décocher un point de
    checklist** — le fil de l'affaire le dit à votre nom, comme depuis la fiche. L'assistant
    n'ajoute, ne renomme ni ne retire aucun point : ces gestes restent ceux de la fiche ;
  - *Supprimer* (« Affaires ▸ Supprimer ») : la **mettre à la corbeille**, d'où un administrateur la restaure.

  Les règles sont celles de l'écran. Un déplacement non déclaré, un motif manquant, une question obligatoire sans
  réponse ou une date d'activité future sont refusés, et l'assistant reçoit le motif. Changer de channel vers un autre
  processus détruit les réponses au formulaire de l'ancien : l'assistant doit le dire et l'accepter explicitement. Ce que
  l'assistant écrit est signé de votre nom dans l'historique de l'affaire.

  **Ce que l'assistant ne fait pas** : corriger ou retirer un commentaire, retirer une activité, restaurer une affaire
  de la corbeille, l'archiver, mentionner quelqu'un. Ces gestes restent ceux de l'écran.

- **La recherche** : retrouver des affaires, des contacts, des
  organisations, des commentaires et des messages par des mots, comme la barre de recherche de l'en-tête. Un résultat
  n'est rendu que si le connecteur peut consulter sa famille dans son espace — « Affaires », « Contacts »,
  « Organisations » ou « Messagerie ». **Une organisation demande « Organisations ▸ Consulter »** : « Contacts » ne
  l'ouvre pas.
- **Structure** :
  - *Consulter* : les tracks d'un espace, un track et ses channels, un channel et son nombre d'affaires actives, et un
    **workflow** — ses étapes, les déplacements qu'il déclare, le motif ou les questions qu'ils exigent ;
  - *Ajouter* : créer un track, ou un channel avec son workflow ;
  - *Modifier* : renommer un track ou un channel, changer sa description, la couleur ou l'icône d'un track. Le slug
    — l'adresse — ne change jamais ; changer le workflow d'un channel relève de la famille « Workflows », et choisir la
    couleur d'un channel reste un geste de l'écran ;
  - *Supprimer* : mettre un track ou un channel à la corbeille.

  Le CRM réserve ces écritures aux administrateurs de l'espace : pour un autre membre, l'assistant reçoit un refus.

- **Workflows** :
  - *Consulter* : la liste des workflows d'un espace, le workflow par défaut en tête, avec leur portée (tout l'espace ou
    un seul track) et le workflow d'origine d'une copie ; le **formulaire** d'un workflow, tel que l'éditeur le montre —
    ses champs, archivés compris, la visibilité de chaque champ à chaque étape, ce que chaque déplacement exige ; et, avant
    d'exiger un champ, **combien d'affaires en cours seraient concernées** ; les **versions** publiées d'un workflow, et la
    comparaison de deux versions, ou d'une copie avec le workflow dont elle vient ; enfin, avant une restauration, **le
    plan** de ce qu'elle ferait des affaires — sans rien changer ; le **catalogue de nœuds**, dont les étapes sont faites.
    Lire un workflow, étape par étape, demande « Structure ▸ Consulter » ;
  - *Ajouter* : créer un workflow vide, pour tout l'espace ou pour un track — il reste un brouillon tant qu'il n'a pas
    d'étape initiale ; créer le **workflow de départ** dans un espace qui n'en a aucun, comme le panneau « Bien
    démarrer » ; ajouter une étape à partir d'un nœud du catalogue, avec un libellé, une probabilité ou un seuil de
    relance qui lui sont propres ; déclarer un déplacement d'une étape vers une autre, avec son libellé et un motif
    exigé ; ajouter une question au formulaire — une clé, un libellé, l'un des quinze types, une aide, les choix d'une
    liste ou la devise d'un montant ; **publier une version** du workflow, avec une note ; **copier** un workflow global vers un track — la copie reprend
    ses étapes, ses déplacements et son formulaire, puis évolue seule ; ajouter un **nœud** au
    catalogue ; ajouter un **point de checklist** à une étape — les affaires qui y entrent ensuite le reçoivent ;
  - *Modifier* : **renommer** un workflow, ou le **désigner par défaut** — il y en a toujours un seul, et il est global ;
    **changer le workflow d'un channel** : chaque étape occupée reçoit sa destination, rien n'est deviné, et si des
    réponses de formulaire seraient perdues, le CRM refuse et l'assistant doit vous le dire et obtenir votre accord ;
    changer les valeurs propres d'une étape, ou les retirer pour reprendre celles du catalogue ; désigner
    l'**étape initiale** ; changer l'ordre des étapes ; changer le libellé d'un déplacement, ou s'il exige un motif ;
    changer le libellé, l'aide, les choix ou la devise d'une question — **jamais sa clé ni son type** — et l'ordre des
    questions ; régler la visibilité d'une question à une étape (masquée, affichée, exigée, ou par défaut) ; **exiger une
    question pour un déplacement**, ou ne plus l'exiger : une affaire ne passe alors plus sans y avoir répondu ;
    **restaurer une version** : le workflow reprend ses étapes, ses déplacements et son formulaire d'alors, et les affaires
    des étapes qu'elle retire vont où vous l'indiquez — l'assistant doit vous montrer le plan d'abord ; l'état d'avant
    reste disponible comme version ; changer le libellé, le type, la couleur ou les valeurs par défaut d'un nœud — jamais
    sa clé — et l'ordre du catalogue ; renommer un point de checklist d'étape — les affaires qui l'ont déjà gardent
    l'ancien libellé — ou changer son ordre ; **exiger un point** de l'étape de départ pour un déplacement, ou ne plus
    l'exiger : une affaire ne passe alors plus sans l'avoir coché ;
  - *Supprimer* : **retirer une étape** — avec les déplacements qui y mènent ou en partent — ou **retirer un
    déplacement**. Ces retraits sont **définitifs**. Le CRM refuse de retirer une étape sur laquelle se trouvent des
    affaires. **Archiver une question** du formulaire : elle quitte le formulaire, ses réponses sont gardées, et un
    administrateur la restaure dans l'éditeur. **Archiver un nœud** du catalogue : il n'est plus proposé aux nouvelles
    étapes ; le CRM refuse tant que des affaires actives se trouvent sur une étape qui en est faite. **Archiver un
    workflow** : aucun channel ne peut plus le choisir ; le CRM refuse tant que des channels le suivent, et pour le
    workflow par défaut. Le rétablir reste un geste de l'écran. **Archiver un point de checklist** d'une étape : les
    affaires qui y entrent ne le reçoivent plus, celles qui l'ont le gardent, et un déplacement qui l'exigeait l'exige
    toujours ; le désarchiver reste un geste de l'écran.

  Comme dans l'éditeur, le CRM réserve ces écritures aux administrateurs de l'espace.

- **Contacts** :
  - *Consulter* : lister les contacts du carnet, par mots du nom, de l'adresse ou de la fonction, ou par
    organisation ; lire la fiche d'un contact, avec les affaires auxquelles il est lié et son rôle dans chacune ;
  - *Ajouter* : créer un contact, avec une organisation qui existe déjà ;
  - *Modifier* : changer son nom, sa fonction, son adresse, son téléphone ou son organisation.

  **Aucun outil ne supprime un contact** : le CRM ne sait que le détruire, et l'assistant ne détruit rien. Le nom de
  l'organisation d'un contact fait partie du contact ; les organisations elles-mêmes sont la famille suivante.

- **Organisations** :
  - *Consulter* : lister les organisations du carnet, par mots du nom ou du domaine, avec le nombre de contacts de
    chacune — y compris celles qui n'en ont aucun ; lire la fiche d'une organisation, avec ses contacts ;
  - *Ajouter* : créer une organisation — un nom, et un domaine et un site web facultatifs. Le domaine est enregistré en
    minuscules, et il est unique dans l'espace : un domaine déjà pris est refusé ;
  - *Modifier* : changer son nom, son domaine ou son site web ; une valeur vide efface le domaine ou le site.

  Comme à l'écran, le CRM réserve la création et la modification aux administrateurs et aux business developers de
  l'espace. **Aucun outil ne supprime une organisation** : ses contacts la perdraient sans laisser de trace. Pour
  rattacher un contact à une organisation, l'assistant modifie le contact (famille « Contacts »).

- **Budgets** :
  - *Consulter* : les budgets des tracks, avec ce qui est prévu et ce qui est déjà connu de leurs dépenses ; le détail
    d'un budget, occurrence par occurrence, avec ses lignes et leur affaire ; les lignes de coût d'une affaire et leurs
    dépenses réelles ; les lignes « à saisir », comme l'onglet du même nom ;
  - *Ajouter* : une ligne de coût sur une affaire, rattachée à un budget ouvert — et à l'une de ses occurrences quand
    le budget est récurrent ; une dépense réelle sur une ligne ;
  - *Modifier* : le libellé, le montant prévu, le budget ou l'occurrence d'une ligne ; corriger une dépense réelle ;
    solder une ligne, ou la rouvrir.

  Comme à l'écran, le coût réel d'une ligne est la somme de ses dépenses, et une ligne soldée n'en accepte plus : il
  faut la rouvrir d'abord. Deux devises ne s'additionnent jamais. **Aucun outil ne supprime une ligne ni une dépense** —
  le CRM ne saurait que les détruire —, et **créer, modifier ou clôturer un budget** reste un geste de l'écran.

- **Temps** :
  - *Consulter* : vos saisies de temps sur une période de trois mois au plus — ou celles d'une personne nommée, ou de
    tout l'espace, que seul un administrateur peut lire —, chacune avec son jour et sa cible ; le rapport valorisé,
    minutes et coût par personne et cible, comme le rapport mensuel de l'écran « Temps » ;
  - *Modifier* : poser les minutes d'un jour sur une cible — un track, un channel ou une affaire —, comme une case de
    la grille : la case est créée ou remplacée, et **0 la vide**. Par quarts d'heure, sept heures au plus par jour.

  Vous saisissez votre propre temps ; un administrateur peut saisir celui d'un membre, **désigné par son nom**. Le coût
  du personnel — les taux — reste un geste de l'écran. Deux devises ne s'additionnent jamais, et une minute sans taux
  est comptée à part, jamais à zéro.

- **Objectifs** :
  - *Consulter* : les tableaux d'objectifs de l'espace ; un tableau lu comme un texte — ses blocs dans l'ordre de
    lecture, avec leur avancement et leur channel lié, et les flèches qui les relient ;
  - *Ajouter* : un bloc — titre, texte, avancement, channel lié facultatif —, posé à droite des blocs existants ; une
    flèche entre deux blocs du même tableau ;
  - *Modifier* : le titre, le texte, l'avancement ou le channel lié d'un bloc ;
  - *Supprimer* : archiver un tableau, ou le désarchiver.

  L'avancement d'un bloc est **saisi**, jamais calculé : l'assistant l'écrit quand vous le lui demandez. Déplacer,
  redimensionner ou colorer un bloc, créer ou renommer un tableau restent des gestes de l'écran. **Aucun outil ne
  supprime un bloc ni une flèche.**

- **Messagerie** :
  - *Consulter* : les emails classés dans une affaire, du plus ancien au plus récent — sens, date, expéditeur,
    destinataires, objet, un extrait, et le **nombre** de pièces jointes ; un email en entier, avec son texte. Quand
    l'expéditeur n'a écrit qu'en HTML, le texte en est extrait comme à l'écran, et l'assistant le sait. Chaque email dit
    aussi s'il est **lu ou non lu pour vous** ([chapitre 12.2](#l-inbox-lire-et-trier-le-courrier-recu)) ; le lire par l'assistant ne le marque pas lu, et aucun outil
    ne change cet état ;
  - *Ajouter* : **envoyer un email depuis une affaire**, par la même file que le bouton « Envoyer » de la fiche : la
    signature de l'identité est ajoutée, le message part, puis paraît dans le fil de l'affaire. L'assistant peut
    répondre à un email **de cette affaire** ; l'objet est alors repris, précédé de « Re: ». Il peut ajouter une
    **copie cachée** ; il ne joint **aucun fichier**.

  **Un envoi est irréversible** : l'outil l'annonce, et l'assistant vous demande de confirmer les destinataires,
  l'objet et le texte avant d'envoyer. Il envoie avec **votre** identité d'expédition, ou avec celle du service si vous
  administrez l'espace ; si vous en avez plusieurs, il vous demande laquelle — il ne choisit jamais à votre place.
  L'envoi exige aussi la case « Affaires — Consulter », et le droit d'écrire sur l'affaire. Le quota journalier de
  l'identité s'applique comme à l'écran.

### 33.6 Ce que le connecteur n'offre pas

Toutes les familles ont leurs outils. Restent des gestes de l'écran : **les pièces jointes**, ni lues ni
envoyées par le connecteur ; **classer, déclasser ou mettre en sommeil** un fil de la boîte de réception ; **les modèles
et les séquences** de relance.
