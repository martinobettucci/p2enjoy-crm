# Changelog

Toutes les modifications notables du projet sont consignées ici.

Deux sections structurent ce fichier :

- **[Non publié]** — ce qui existe dans le code courant mais n'est **pas encore déployé et
  vérifié en production** ;
- **[Publié]** — uniquement ce qui est réellement actif et vérifié en production.

Un changement n'est jamais déclaré publié tant que la production n'a pas été constatée en train
d'exécuter le code attendu.

## [Non publié]

### Ajouté

- **Une commande unique dit si la corbeille tient encore — `CRM-077`**
  (`scripts/verify-corbeille.sh`, `docs/SPEC-corbeille.md` §5 bis). Les preuves de la corbeille
  étaient dispersées entre **neuf fichiers** : aucune commande ne rendait un verdict d'ensemble.
  - **Sept preuves rejouées en un passage** : la traçabilité des douze fichiers de l'unité, les
    captures des quatre paliers, les deux suites de base de données, les tests du modèle, de l'écran
    et de la fiche d'affaire, les scénarios d'API avec les jetons réels des trois profils, et le
    parcours d'interface au clavier et à la souris.
  - **Les comptes sont figés, fichiers ET assertions** : une suite entière qui disparaîtrait sans
    faire baisser le nombre d'assertions serait vue, et l'inverse aussi.
  - **Le harnais refuse d'être complaisant** : il retire réellement, une par une, quatre règles dont
    la disparition serait invisible à l'écran — le filtre qui ne montre que ce qui est retiré,
    l'omission des décomptes nuls, le refus nommé de restaurer sous un parent retiré, et la réponse
    « sans effet » d'un retrait refusé en silence — et **exige que les tests rougissent** à chaque
    fois. Les fichiers sont ensuite comparés **octet à octet** à leur état d'avant.
  - `--rapide` omet les parcours navigateur, et **l'annonce dans sa sortie** plutôt que de le taire.

- **Une affaire se met à la corbeille depuis sa fiche — `CRM-077`** (`webapp/src/app/RouteCard.tsx`,
  `webapp/src/lib/corbeille.ts`, `docs/SPEC-corbeille.md` §4 ter). Le geste existait pour un track et
  un channel ; **une affaire ne se retirait depuis aucun écran**.
  - **« Mettre à la corbeille » en bas de la fiche d'une affaire**, sous son formulaire. Ni le
    tableau kanban ni la vue liste ne l'offrent, et les deux motifs sont écrits : le menu d'une carte
    du tableau ne présente que les déplacements déclarés par le workflow, et le tableau de la vue
    liste ne déclare aucune colonne d'actions.
  - **La confirmation nomme l'affaire et ne porte AUCUN décompte** : une affaire n'a pas d'objet qui
    deviendrait inaccessible avec elle. Tant qu'elle n'est pas validée, rien n'est écrit.
  - **Après le retrait, l'écran dit que l'affaire est à la corbeille**, et non « Card introuvable » —
    ce serait faux pour qui vient de la retirer. Il offre **deux chemins** : revenir au channel, ou
    ouvrir la corbeille pour l'y restaurer.
  - **Le geste n'est PAS réservé aux administrateurs**, contrairement à celui d'un track. MESURÉ avec
    les jetons réels : un business developer réussit, la règle portant sur le droit d'écriture du
    channel. Une personne en lecture seule reçoit une réponse **sans effet**, que l'écran nomme.
  - **L'historique de l'affaire enregistre le retrait**, avec son auteur et sa date, écrit par la
    base seule — l'écran n'écrit que la date de retrait.
  - **Le manuel gagne le chapitre 4.7 *bis***, et le chapitre de la corbeille cesse d'annoncer
    qu'une affaire ne peut être retirée d'aucun écran.

- **La corbeille se remplit enfin par un GESTE — `CRM-077`**
  (`webapp/src/app/AdministrationArborescence.tsx`, `docs/SPEC-corbeille.md` §4 bis). L'écran de
  corbeille et son énumération existaient ; **aucun écran ne permettait d'y mettre quoi que ce
  soit**, et seul le jeu de démonstration pouvait la remplir.
  - **« Mettre à la corbeille » sur un track et sur un channel**, depuis « Réglages ▸ Arborescence »,
    à côté d'« Archiver » — et **distincte** d'elle : les deux états sont indépendants, un objet
    archivé se retire et **reste archivé** quand on le restaure.
  - **La confirmation dit ce qui devient inaccessible** avec l'objet retiré, en réutilisant
    l'énumération livrée précédemment — c'est l'appelant qui lui manquait. Le décompte a quatre
    états distincts, dont « n'a pas pu être mesuré », et **aucun n'empêche de confirmer** : une
    énumération informe, elle n'autorise pas.
  - **L'administration montrait ce qu'elle allait permettre de retirer.** MESURÉ avant d'y toucher :
    ses deux lectures rendaient le track et le channel déjà en corbeille du jeu de démonstration, la
    livraison précédente n'ayant filtré que la barre latérale, l'adresse d'un track et la barre
    d'onglets. Le filtre est ajouté, **séparé** de celui de l'archivage — la case « Afficher les
    archivés » ne ramène jamais un objet retiré.
  - **Rien n'est deviné du droit d'écrire** : la commande est offerte à tout le monde, l'écriture
    part, et le refus vient du serveur. MESURÉ avec les jetons réels : un membre non administrateur
    reçoit une réponse **sans effet**, jamais une erreur, et l'écran le nomme au lieu d'annoncer un
    retrait qui n'a pas eu lieu.
  - **L'audit reste écrit par la base** : la demande ne porte que la date de retrait, et une demande
    qui prétendrait désigner l'auteur est refusée en entier.
  - **Le manuel gagne le chapitre de la corbeille**, qui manquait depuis la livraison de l'écran, et
    celui de l'arborescence décrit le nouveau geste et ce qui le distingue de l'archivage.

### Documentation

- **`docs/CloudWorker.md` : la campagne de preuves quitte l'ouverture de session** (décision 420).
  Le §2.3 ordonnait « la pile debout, tu DOIS exécuter les vraies preuves applicables » — huit
  commandes plus tous les `verify-*.sh` — **avant** les chapitres qui disent quoi faire et comment
  choisir l'unité. Sur une tâche horaire, quarante à soixante-dix minutes étaient dépensées à
  mesurer un dépôt que la session n'avait pas encore modifié.
- **La séquence est désormais écrite en une ligne au §0** : Git → pile → choisir l'unité → spéc
  complète committée → coder → committer et pousser **au fil de l'eau, sans attendre d'avoir
  prouvé** → prouver son unité → campagne complète en fin de session → boucle de correction.
- **Un §3.2 neuf porte l'ordre de travail**, avec l'exception qui manquait : on ne réécrit **pas** la
  spécification d'une unité `[~]` dont la spéc existe déjà et couvre le reste à livrer — on code.
- **Le §4.3 porte une boucle de correction explicite** : corriger la cause, pousser la correction
  immédiatement, rejouer la preuve concernée seule, la campagne une dernière fois seulement. Sortie
  de boucle sans mensonge, et budget explicite si le temps manque.
- **Le §2.4 devient un diagnostic** : la ligne de base ne s'établit que lorsqu'une preuve rougit, et
  sur cette preuve seule.
- **Rien n'est relâché** : aucune preuve supprimée, aucune Definition of Done allégée. Ce qui change
  est **quand** la campagne s'exécute, pas **si**.

### Documentation

- **Le registre des contradictions est vide** (décisions 408 à 419). Les dix-neuf dernières entrées
  ouvertes sont arbitrées, sur instruction du responsable de trancher automatiquement tout ce qui
  restait en suspens, et retirées vers l'index — qui passe de **cent à cent dix-neuf**. Le document
  tombe de **1 091 à 194 lignes**. Toute la dette restante est une dette de **mise en œuvre**,
  suivie dans `docs/ARBITRAGES.md` §1 et dans le backlog.
- **Douze décisions pour dix-neuf entrées**, parce que plusieurs partageaient un mode de défaillance
  unique. Les quatre règles générales qui en sortent valent au-delà de leurs entrées :
  - **une dégradation n'emploie jamais une valeur que le produit peut livrer un jour** (408) — deux
    contrôles de non-complaisance étaient devenus des décors, l'un parce que `retirerEspaces` **est**
    `trim()` depuis la décision 374, l'autre parce que `mail_received` est un type légitime depuis
    la messagerie ;
  - **un harnais rejoue le préfixe complet des migrations, jamais un fichier isolé** (409) —
    `verify-tracks.sh` rouvrait `tracks.deleted_by` à l'écriture du client en restaurant par `0003`,
    et laissait la base durablement dégradée pour toutes les preuves suivantes ;
  - **une preuve décrit un état, jamais un historique** (411) — S3 lisait le journal du conteneur
    depuis son démarrage, et une seule ligne `WARNING` volontairement provoquée par une autre preuve
    le rendait rouge à vie ;
  - **un chiffre publié est vérifié par un harnais ou daté comme un état passé** (413) — cinq
    occurrences du même mécanisme, dont deux comptes contradictoires du registre sur lui-même.
- **Les harnais ne se chaînent pas** (410) : chacun restaure à l'entrée, purge même après échec, et
  cible sa propre trace par identifiant. La section d'aller-retour du seed devient convergente **dès
  le premier rejeu**, plutôt que d'affaiblir la promesse du §9.8.
- **Le seed converge ou se tait** (415) : il ne peut plus annoncer « retiré par un TIERS » sur une
  base où il n'a rien retiré.
- **Deux entrées sont fermées sans code** : INC-110, dont le symptôme n'est plus observable — on
  instrumente et on ferme, plutôt que de laisser ouvert un fait qu'aucun travail ne peut faire
  avancer —, et INC-111, dont la vérification portera désormais sur le fond de la consigne et non
  sur le rang d'un appel d'outil.

### Documentation

- **`docs/INCONSISTENCY_REPORT.md` change de règle de retrait, et cinquante-deux entrées en
  sortent** (décision 407). Une entrée est désormais retirée dès que son arbitrage est consigné
  dans `docs/JOURNAL.md`, que sa mise en œuvre soit ou non déjà livrée et prouvée — le travail
  restant dû reste suivi par `docs/ARBITRAGES.md` et par `docs/BACKLOG.md`. L'agent tente en outre
  de résoudre une incohérence par sa propre décision avant d'ouvrir une entrée, qui n'est réservée
  qu'aux choix où l'arbitrage du responsable est strictement nécessaire. Cinquante-deux des
  soixante-huit entrées alors en texte complet avaient déjà reçu un arbitrage et rejoignent
  l'index ; dix-neuf restent ouvertes, trois de plus consignées entre-temps par une session
  concurrente (INC-117 à INC-119).

### Ajouté

- **La corbeille énumère ce qu'un geste rendrait inaccessible — `CRM-077`**
  (`webapp/src/lib/corbeille.ts`, `docs/SPEC-corbeille.md` §3.5). Mettre un parent à la corbeille ne
  descend pas sur ses enfants ; c'est l'**énumération** qui remplace cette descente, et elle manquait.
  - **Trois règles de comptage, et chacune répond à une question précise.** Un enfant **déjà** en
    corbeille n'est pas compté : il ne *devient* pas inaccessible, il l'est, et il porte sa propre
    entrée où il se restaure séparément. Un enfant **archivé** est compté, lui : l'archivage est
    réversible, si bien que le retour attendu d'un objet archivé est exactement ce que la mise à la
    corbeille de son parent immobilise. Les affaires d'un channel lui-même en corbeille ne comptent
    pas pour le track : elles sont retenues un cran plus bas.
  - **Le compte est celui de l'appelant**, les deux lectures passant par les politiques existantes :
    sur le même track, l'administratrice lit trois channels et sept affaires, la lectrice un et
    deux. Aucune politique n'est ouverte ni élargie ici.
  - **Une affaire de démonstration sous l'enfant vivant** (`docs/SPEC-seed.md` §10.4 bis), annoncée
    par la livraison précédente : elle donne son compte non nul à l'énumération et devient le seul
    cas du jeu où la garde de restauration se déclenche par le **second** niveau d'ascendance — un
    channel vivant dont le track est en corbeille.
  - **Deux grandeurs de l'inventaire du manuel étaient devenues fausses** en même temps que la
    corbeille arrivait aux tracks et aux channels : « tracks actifs » et « channels actifs » y
    comptaient les objets retirés. Leurs mesures excluent désormais la corbeille, et deux grandeurs
    nouvelles la montrent séparément.

- **Le seed démontre enfin la corbeille — `CRM-077`** (`docs/SPEC-seed.md` §10). Les migrations
  `0037` et `0038` avaient livré la corbeille et sa garde de restauration, et **aucune donnée ne les
  exerçait** : la corbeille du seed ne contenait qu'une card, si bien que le refus de restaurer un
  enfant sous parent en corbeille n'avait aucun cas de démonstration.
  - **Trois objets, chacun démontrant ce que les autres ne démontrent pas** : le track
    `legacy-2023` **en corbeille**, seul cas dont la restauration RÉUSSIT — son unique ascendant est
    le workspace ; le channel `annexes-2023` **en corbeille sous lui**, dont la restauration est
    refusée par `parent_en_corbeille` ; et le channel `dossiers-2023` **actif sous lui**, qui ne
    porte **aucun `deleted_at`** et devient injoignable du seul fait que son track ne se résout
    plus. Sans ce dernier, « enfant d'un parent en corbeille » passerait pour un état unique.
  - **La corbeille est posée par un GESTE, jamais déclarée dans une charge de création.** La clé de
    service ne porte aucune revendication `sub` : un objet né avec `deleted_at` renseigné par elle
    porterait un `deleted_by` **nul**, que le trigger figerait ensuite. Les trois objets naissent
    donc actifs, puis sont mis en corbeille avec le **jeton réel de l'administratrice** — le patron
    déjà employé pour le commentaire retiré par la modération. Le seed vérifie l'auteur relevé et
    échoue en le disant sinon.
  - **Le rejeu du seed reste convergent**, et c'est ce qui dicte la règle précédente : une charge
    qui enverrait `deleted_at: null` demanderait à chaque passage la restauration d'un objet dont le
    parent est en corbeille — restauration que la base refuse, et le seed échouerait au second
    passage.
  - **Comptes du seed révisés dans le même changement, aucun contourné** : quatre tracks deviennent
    cinq, six channels deviennent huit. Chaque preuve révisée porte son motif, et affirme désormais
    « dont un archivé **et un en corbeille** » là où elle affirmait « dont un archivé ».

- **La corbeille retire les objets des listes, et l'enfant d'un parent en corbeille devient
  inaccessible — `CRM-077`** (`docs/SPEC-corbeille.md` §3.1, §3.3 et §4). Les migrations `0037` et
  `0038` avaient posé le modèle et sa garde ; les écrans, eux, montraient encore un track ou un
  channel mis à la corbeille.
  - **Un filtre SÉPARÉ de l'archivage**, sur les trois lectures de listes — la barre latérale des
    tracks, la résolution d'un track par son adresse, et la barre d'onglets des channels. Séparé, et
    non fondu dans le filtre existant : archiver conserve un dossier clos, mettre à la corbeille
    retire une erreur, et un track archivé PUIS mis à la corbeille ne doit pas réapparaître le jour
    où on le désarchive.
  - **L'adresse directe ne contourne plus rien.** Sans le filtre sur la résolution par slug, un
    track en corbeille serait resté ouvrable en saisissant son URL, avec ses onglets et son board :
    le produit aurait dit « retiré » et montré le contraire. Le track rendu `null`, la page affiche
    son état d'absence, comme pour un slug inconnu.
  - **L'enfant n'est pas horodaté, il est rendu inaccessible.** Un channel dont le track est en
    corbeille ne porte aucun `deleted_at` : il devient injoignable parce que son track ne se résout
    plus. C'est la règle du §3.3, et non un oubli — descendre l'horodatage aurait rendu la
    restauration ambiguë, plus rien ne distinguant les enfants emportés par leur parent de ceux déjà
    en corbeille avant lui.
  - **La corbeille reste LISIBLE**, et c'est ce qui rendra l'écran de corbeille possible : le
    retrait se joue à la lecture de liste, jamais par une politique qui masquerait les lignes.

- **L'éditeur administrateur de workflows, sixième tranche : la prévisualisation des effets —
  `CRM-076`** (`docs/SPEC-workflow-engine.md` §7 bis.13). Le **dernier** manque de comportement de
  l'unité est levé : avant d'ajouter une exigence, l'administrateur voit ce qu'elle fera aux
  affaires déjà en cours.
  - **DEUX nombres, et ils ne se déduisent pas l'un de l'autre** : les affaires **déjà** à l'étape —
    jamais chassées, leur fiche signalera le manque — et celles qui **ne pourront plus y entrer**.
    MESURÉ sur le seed pour `date-signature-prevue` : `Prospection` rend 4 et 0, `Signature` rend
    l'inverse 0 et 1, `Perdu` rend 1 et 8. Un écran à un seul nombre aurait annoncé « aucun effet »
    sur deux étapes du workflow par défaut.
  - **Le compte est fait par la BASE, et c'est une décision motivée** : « vide » est
    `app.valeur_de_champ_est_vide` — vingt-quatre points de code d'espaces (`CRM-036`) — et le
    réécrire en TypeScript aurait dupliqué la définition que `move_card` possède ; compter côté
    navigateur aurait exigé une lecture non bornée des affaires et de leurs valeurs ; et la fonction
    est **`security invoker`**, si bien que le nombre annoncé est borné par la RLS de son lecteur.
  - **Seul le geste qui contraint demande une confirmation.** « Exigé » ouvre une confirmation
    portant les deux nombres et n'écrit **rien** avant acceptation ; « Par défaut », « Masqué » et
    « Affiché » restent immédiats. Le formulaire d'exigence d'une transition affiche son compte sous
    le choix du champ, sans confirmation supplémentaire.
  - **Un échec de mesure ne bloque pas le geste**, et l'écran le dit : le compte est une aide à la
    décision, la garde reste `move_card`.
  - **Migration `0036`** : `public.previsualiser_exigence(uuid, uuid, uuid)`, en lecture seule,
    sans aucun changement de schéma. Refuse un appel sans cible ou à deux cibles
    (`previsualisation_cible`) ; rend `0, 0` sur un champ archivé ou une cible inconnue.
  - **Un défaut trouvé et corrigé par les preuves** : l'effet du formulaire d'exigence dépendait
    d'une callback recréée à chaque rendu, ce qui provoquait une boucle d'appels sans fin. Corrigé,
    et fixé par une preuve unitaire qui compte les appels.
  - **Preuves** : 10 assertions pgTAP dont la **parenté avec `move_card`** — une affaire comptée
    « à l'entrée » se voit réellement refuser son déplacement —, unitaires sur l'appel et la
    composition des messages, E2E sur la vraie base des deux gestes avec l'**absence** de ligne
    comme preuve du renoncement, captures aux quatre paliers produites et observées.
  - **Deux preuves antérieures révisées, non supprimées** : les deux scénarios qui réglaient une
    case sur « Exigé » et attendaient une écriture immédiate passent désormais par la confirmation ;
    le motif est écrit dans les fichiers. La règle prouvée est inchangée.

- **L'éditeur administrateur de workflows, cinquième tranche : les exigences de transition —
  `CRM-076`** (`docs/SPEC-workflow-engine.md` §7 bis.12). Le premier des deux manques nommés au
  §7 bis.11.7 est levé : les **champs exigés pour franchir une transition**, livrés en base par
  `CRM-018` et restés sans écran depuis, se règlent dans un cinquième bloc sous la grille.
  - **Le bloc rend les exigences EFFECTIVES, pas la table.** La sixième garde de `move_card` exige
    l'union des champs `required` par règle à l'étape d'arrivée et des champs liés à la transition,
    restreinte aux champs non archivés. Un écran qui n'aurait montré que la table de liaison aurait
    écrit « aucune exigence » là où l'étape d'arrivée en impose déjà. Chaque ligne porte son
    origine — règle, transition, ou les deux.
  - **Une exigence héritée d'une règle n'offre aucun retrait ici**, et le bloc renvoie à la grille :
    deux écrans qui écriraient la même ligne se contrediraient.
  - **L'écriture N'EST PAS un `upsert`, à l'inverse de la tranche précédente, et c'est mesuré** :
    la migration de `CRM-018` n'accorde que `insert` et `delete` — sa spécification §2 pose
    qu'aucune valeur n'est mutable —, si bien qu'un `POST` avec `resolution=merge-duplicates` rend
    **`403`** / `42501` et un `PATCH` aussi. Le `POST` est donc simple, et son `23505` devient un
    refus métier lisible — « déjà exigé » — au lieu d'un repli générique.
  - **Les champs archivés sont écartés des choix**, la base acceptant pourtant la liaison (`201`)
    alors que `move_card` la filtre : une liaison existante vers un champ archivé est **nommée sans
    effet** et n'est pas supprimée.
  - **La lecture est filtrée par jointure interne** `workflow_transitions!inner` : la table de
    liaison ne dénormalise aucun `workflow_id`, et une lecture sans filtre rendrait les exigences
    d'un autre workflow.
  - **Aucune migration** : `workflow_transition_required_fields`, ses triggers et ses politiques
    datent de `CRM-018`.
  - **Preuves** : unitaires sur la couche de données et sur l'écran, **E2E sur la vraie base** — les
    deux gestes à la souris et au clavier confirmés en base après coup, le retrait vérifié par
    l'**absence** de ligne, l'exigence héritée affichée sans commande de retrait, le refus réel
    `23505` consommé —, captures aux quatre paliers et formulaire ouvert, produites et observées.
  - **INC-108 relevée, non corrigée** : trois documents comptent « dix-sept règles » là où le seed
    en pose quinze par workflow. Arbitrage demandé.

- **L'éditeur administrateur de workflows, quatrième tranche : la grille champ × étape —
  `CRM-076`** (`docs/SPEC-workflow-engine.md` §7 bis.11). La seconde moitié du deuxième manque
  nommé au §7 bis.10.7 est levée : la **visibilité de chaque champ à chaque étape** se règle depuis
  `/reglages/workflows`, dans un quatrième bloc sous les champs, et « en un seul écran » comme
  `docs/SPEC-form-composer.md` §5 l'exigeait.
  - **Un vrai tableau** — une ligne par champ actif, une colonne par étape, une liste déroulante
    par case dont le libellé accessible nomme le champ **et** l'étape. Il défile dans son propre
    conteneur ; la page ne défile jamais horizontalement.
  - **Quatre états par case, pas trois** : `Par défaut`, `Masqué`, `Affiché`, `Exigé`. L'absence de
    règle vaut `visible` (§3.1 du composeur), mais une règle `visible` explicite existe aussi — le
    seed en pose deux —, et replier l'une sur l'autre les aurait supprimées au premier réglage
    voisin. L'écran écrit sous le tableau que les deux produisent le même formulaire.
  - **Le réglage est un `upsert`, et c'est mesuré** : `POST` d'un couple absent rend `201`, le même
    `POST` avec `resolution=merge-duplicates` rend `200` sur un couple existant, et **sans** cette
    résolution il rend `409` / `23505`. Un écran qui choisirait entre insertion et modification
    d'après ce qu'il a lu prendrait ce refus dès qu'un autre administrateur a réglé la même case
    entre-temps. Le retour au défaut, lui, **supprime** la règle : c'est le seul `DELETE` de cet
    éditeur de formulaire, et la décision 96 l'autorise là où un champ ne se supprime pas.
  - **Les champs archivés sont écartés de la grille**, et une phrase le dit : ils ne figurent dans
    aucun formulaire, leurs règles sont conservées et redeviennent effectives à leur restauration.
  - **Aucune migration** : `form_field_rules` et ses politiques datent de `CRM-035`.
  - **Preuves** : 16 unitaires sur la couche de données, 13 sur l'écran, **9 scénarios E2E** sur la
    vraie base — les deux gestes à la souris et au clavier confirmés en base après coup, le retour
    au défaut vérifié par l'**absence** de ligne, le compte des quinze règles seedées retrouvé
    après la campagne, et les captures aux quatre paliers observées.

- **L'éditeur administrateur de workflows, troisième tranche : les champs du formulaire —
  `CRM-076`** (`docs/SPEC-workflow-engine.md` §7 bis.10). La moitié du deuxième manque nommé au
  §7 bis.7 est levée : les **questions** posées sur chaque affaire s'éditent depuis
  `/reglages/workflows`, dans un troisième bloc sous les transitions.
  - **Cinq gestes contre la vraie base** : déclarer un champ — clé, libellé, type, aide, options —,
    modifier son libellé, son aide et ses options, le réordonner, l'archiver après confirmation et
    le restaurer. Les champs archivés **restent dans la liste**, nommés comme tels.
  - **Aucune suppression n'est offerte, et c'est mesuré** : `DELETE /form_fields` rend `403` /
    `42501` même à l'administratrice — aucun privilège `DELETE` n'est accordé (`docs/SPEC-form-composer.md`
    §2.7). L'archivage est le seul retrait du produit, et il conserve les réponses déjà saisies.
  - **La clé et le type ne se modifient pas depuis l'écran**, alors que la base l'accepterait — les
    deux mesures sont écrites au §7 bis.10.3. Changer le type d'un champ rempli laisse en base des
    valeurs que le produit refuse ensuite de réécrire (`P0001`, « attend un nombre, reçu string »),
    la validation ne revisitant aucune ligne existante : la conversion est un plan de remappage,
    c'est-à-dire `CRM-078`. La clé, elle, est citée par les exports et les messages d'erreur de
    `move_card`. L'écran affiche les deux en phrase, avec leur motif, plutôt qu'en champ grisé.
  - **Le premier contrôle d'écran qui ne soit pas un raccourci** : la base accepte un `select`
    portant deux choix de **même clé** — mesuré, `201` —, un `CHECK` ne pouvant pas déplier un
    tableau `jsonb`. L'unicité des clés de choix et la forme `{key, label}` sont donc tenues par
    l'éditeur seul, et par ses preuves.
  - **Aucune migration** : `form_fields` et ses politiques datent de `CRM-035`.
  - **Preuves** : 24 unitaires sur la couche de données, 16 sur l'écran, **9 scénarios E2E** sur la
    vraie base — cinq gestes à la souris confirmés en base après chaque geste, refus réel d'une clé
    déjà prise, parcours au clavier seul, quatre paliers et captures observées. `docs/manual.md`
    chapitre 5 bis.4 et `docs/DESIGN_SYSTEM.md` §5.15 complétés dans le même changement.

- **L'éditeur administrateur de workflows, deuxième tranche : les transitions — `CRM-076`**
  (`docs/SPEC-workflow-engine.md` §7 bis.9). Le premier des quatre manques nommés au §7 bis.7 est
  levé : les **arêtes** du graphe s'éditent depuis `/reglages/workflows`, sous la liste des étapes.
  - **Le graphe est rendu groupé par étape de départ**, dans l'ordre des étapes et non celui des
    identifiants — `workflow_transitions` ne porte pas la position des étapes, donc l'ordre
    lisible est composé par l'écran depuis les étapes déjà lues. Une étape sans sortie garde son
    groupe et l'annonce : « Aucune sortie : les cards s'y arrêtent. »
  - **Trois gestes contre la vraie base** : déclarer une arête (les arrivées déjà déclarées et
    l'étape de départ elle-même ne sont pas offertes — une aide d'interface, pas une garde),
    modifier son libellé et son motif exigé, la retirer après confirmation. Un libellé vidé
    redevient `null`, ce qui fait afficher le libellé de l'étape d'arrivée dans le menu d'une
    affaire.
  - **Le `23503` change de sens et le code le dit** : rien ne retient une arête — aucune colonne
    de `cards` ne désigne une transition —, donc il ne peut plus vouloir dire « occupée » comme
    sur une étape. `classerRefusTransition` n'a volontairement pas de paramètre `geste`.
  - **Aucune migration** : `workflow_transitions` existe depuis `CRM-031` avec ses contraintes et
    ses politiques. Ce qui manquait était l'écran.
  - Preuves : 22 unitaires ajoutées sur la couche de données, 18 sur l'écran monté, 8 scénarios
    E2E sur pile réelle — souris, clavier seul, quatre paliers, captures observées — dont le refus
    d'unicité obtenu par une **course réelle** (un second administrateur déclare l'arête par la clé
    de service pendant que le formulaire est ouvert). Reste dû sous `CRM-076` : champs de
    formulaire, règles, prévisualisation des effets.
  - Documentation : `docs/manual.md` gagne son **chapitre 5 bis**, absent jusqu'ici alors que la
    première tranche avait déjà livré l'écran ; `docs/DESIGN_SYSTEM.md` §5.15 pose les règles
    visuelles d'un graphe rendu en listes groupées.

- **L'éditeur administrateur de workflows, première tranche — `CRM-076`**
  (`docs/SPEC-workflow-engine.md` §7 bis). La règle portée depuis `CRM-000` — « l'éditeur de
  workflow est réservé aux administrateurs » — cesse d'être un énoncé d'intention : la route
  `/reglages/workflows`, atteinte depuis l'index des réglages, compose un workflow existant.
  - **Six gestes contre la vraie base** : ajouter une étape depuis le catalogue actif (lu à
    l'ouverture du sélecteur, filtré des nœuds déjà employés), monter/descendre par une seule
    écriture de position, surcharger libellé, probabilité et seuil de relance, retirer une
    surcharge en renvoyant `null` (`0` reste une valeur, §2.5), désigner l'étape initiale en
    éteignant avant d'allumer (§3.5), retirer une étape après confirmation — le refus d'une
    étape occupée venant du `on delete restrict`, traduit et nommé.
  - **Aucun droit calculé côté client** : l'écran envoie, la base tranche, le refus est traduit.
  - Preuves : 28 unitaires sur la couche de données, 22 sur l'écran monté, 8 scénarios E2E sur
    pile réelle — souris, clavier seul, refus réel 409, quatre paliers, captures observées.
    `test:sql` rejoué après la campagne : aucun résidu. Reste dû sous `CRM-076` : transitions,
    champs, règles, prévisualisation (§7 bis.7).

- **Le détecteur de textes en dur lit la grammaire, plus le texte — INC-070 close**
  (décisions 296 et 381). `webapp/src/i18n/i18n.test.ts` parse chaque composant avec l'analyseur
  TypeScript qui compile déjà le projet : un texte visible est un nœud `JsxText`, une chaîne
  rendue comme enfant de JSX ou la valeur d'un attribut visible — les deux dernières formes
  échappaient à l'ancienne expression régulière, qui comptait en revanche la queue d'un ternaire
  pour un texte. Une fixture éprouve le détecteur **dans les deux sens**, et plus aucune forme
  d'écriture du dépôt n'est imposée par l'outil : les trois contournements documentés
  (`RouteTrack`, `PanneauTimeline`, `AdministrationArborescence`) sont levés.

- **La routine horaire est réorientée : le produit d'abord** (décision 382, instruction du
  responsable). `docs/CloudWorker.md` §4 : le registre d'incohérences n'est plus une file de
  travail — l'unité d'une session vient du backlog dans l'ordre du plan, toute session avec du
  comportement à livrer doit pousser du code, et la documentation redevient proportionnée.

- **La modération d'un commentaire a enfin un geste dans le produit — INC-072 close**
  (conception : décision 376 ; règle serveur livrée le même jour par la décision 374). La règle
  existait, prouvée en pgTAP, et **personne ne pouvait s'en servir** : `PanneauTimeline.tsx`
  calculait `actionsOffertes = estAuteur && !supprime`, et la webapp n'avait aucune notion du rôle
  de workspace de l'utilisateur courant. C'est la forme d'INC-085 — *un droit qui n'a pas de chemin
  n'est pas un droit*.
  - **Le rôle courant est lu côté client**, dans `workspace_members` filtré sur
    `(workspace_id, user_id)` — nouveau module `webapp/src/lib/roles.ts`. Ce n'est **pas** une
    autorisation (`CLAUDE.md` §10) : la politique `card_comments_moderation` tient la règle, et le
    doute — rôle en chargement, illisible, inconnu de la contrainte — ne vaut jamais permission.
  - **Une seule action sur le commentaire d'un tiers : *Supprimer*.** Jamais *Modifier*, et pas
    même désactivé — un contrôle grisé annonce un droit temporairement indisponible, quand
    celui-ci ne le sera jamais. La forme porte ainsi la borne du trigger au lieu de la contredire.
  - **Elle n'est offerte qu'à qui peut aboutir.** MESURÉ : un non-administrateur qui tenterait le
    geste reçoit `200` et **zéro ligne**, soit un bouton qui ne dit rien et ne fait rien. Offrir
    *Supprimer* à tous en laissant le `USING` filtrer aurait été plus court, et c'est ce que le
    §5.10 du design system refuse déjà à propos de la pierre tombale.
  - **Une confirmation distincte de celle de l'auteur** : elle nomme que le commentaire appartient
    à quelqu'un d'autre, et que **le retrait sera enregistré sous votre nom**.
  - **La pierre tombale dit si un tiers est intervenu** — « Commentaire retiré par la modération »
    au lieu de « Commentaire supprimé ». La distinction vient de la donnée : `deleted_by` non nul
    **et différent** d'`author_id`. Une colonne d'audit que rien ne lit n'audite rien. Le **nom** du
    modérateur reste hors de l'écran : dire *qu'un tiers* a retiré un propos et dire *qui* l'a
    retiré ne sont pas la même divulgation, et aucun document ne porte la seconde.
  - **Deux `P0001` disaient deux choses opposées, et le classificateur n'en voyait qu'une.**
    `comment_moderation_limitee` était rendu comme `comment_deleted` : un administrateur bloqué
    lisait « ce commentaire a été supprimé » alors que le commentaire était vivant et que c'était
    son geste qui était borné. Les deux natures sont désormais distinguées par le symbole levé,
    jamais par une phrase humaine.
  - **Le seed retire `…0d4` avec le jeton RÉEL de l'administratrice**, et non plus par la clé de
    service dont `auth.uid()` est nul : `deleted_by` restait alors nul, et la pierre tombale ne
    démontrait que la destruction du corps. Le propos, « Note interne publiée par erreur sur la
    mauvaise affaire » écrit par Driss Lemoine, est le cas de modération exact du §13.6.
  - **Deux défauts réels trouvés en exécutant les preuves, pas à la lecture.** Le prédicat de
    modération, écrit `!== null`, lisait une colonne **absente** comme un retrait par un tiers :
    une pierre tombale supprimée par son propre auteur s'annonçait « retirée par la modération » sur
    une réponse substituée qui ne portait pas encore `deleted_by`. Une réponse dégradée ne doit
    accuser personne. Et une preuve d'interface attendait indéfiniment un texte que la confirmation
    venait de remplacer — la confirmation **prend la place** du corps.
  - **`scripts/verify-commentaires.sh` était ROUGE depuis la migration `0035`, et personne ne
    l'avait vu.** Trois gardes figées ont joué et sont **révisées, aucune retirée** : l'inventaire
    des politiques ignorait `card_comments_moderation` ; le compte d'assertions restait à 84 quand la
    suite en portait 96 ; et la restauration rejouait `0015` puis `0021` **sans `0035`**, donc
    réinstallait une version antérieure du trigger et laissait la suite `0017` rouge — le harnais
    accusait le produit d'un défaut qu'il venait lui-même d'introduire. Deux dégradations
    volontaires s'ajoutent, dont le retrait de la seule politique de modération, que la migration
    `0035` annonçait comme mesurable. Bilan : **78 contrôles, aucune anomalie.**
  - **Les types versionnés sont régénérés, et `npm run types:check` redevient vert.** La migration
    `0035` avait créé `card_comments.deleted_by` sans eux, et le compilateur refusait la colonne :
    l'unité ne pouvait pas être livrée sans régénérer. La régénération importe trois écarts
    **étrangers** — `mail_messages.filed_at`, la colonne `attempts` du retour de `reserver_envois`,
    et deux fonctions du rangement réservées au worker —, tous nommés, aucun ne changeant un
    comportement. L'assertion figée du catalogue de fonctions a joué et est révisée.
- **La règle la plus visible de la modération est enfin OBSERVÉE, et pas seulement éprouvée**
  (décision 379, `CLAUDE.md` §16). *Une seule action sur le commentaire d'un tiers* était tenue par
  deux assertions — `actions-moderation` à 1, `Modifier` à 0 — et **ne figurait sur aucune capture** :
  la seule qui aurait pu la montrer est prise **après** le clic, quand la confirmation a déjà pris la
  place du corps. Une forme qu'aucune capture ne montre n'est pas vérifiée visuellement, elle est
  seulement affirmée. Nouvelle capture `moderation-actions-1440.jpg`, prise avant le clic, et portée
  à l'inventaire de `scripts/verify-commentaires.sh`.
  - **Deux défauts de la capture elle-même, trouvés en la REGARDANT.** La première version ne
    montrait **rien** : les actions sont rendues `opacity-0` et révélées par `group-hover` ou
    `group-focus-within` (§5.10), si bien que la capture fixait une rangée vide et prouvait le
    contraire de ce qu'elle prétendait. La seconde, prise après survol, montrait un « Supprimer »
    **à demi transparent** : pour Playwright, un élément `opacity-0` qui occupe une surface **est**
    visible, et `toBeVisible()` passait donc pendant le fondu. Le scénario attend désormais que
    l'opacité **réellement calculée** atteigne `1` — une observation de l'état de l'écran, non une
    temporisation arbitraire (`CLAUDE.md` §18).
- **INC-101 relevée, mesurée et NON corrigée** : les cinq compteurs globaux de
  `scripts/verify-harness.sh` sont périmés — 33 fichiers / 1971 assertions contre 31 / 1921, 507
  scénarios d'API contre 504, 185 d'interface contre 182, 42 de messagerie contre 41. **Deux
  assertions et trois scénarios d'interface seulement** viennent de cette session ; les compteurs
  d'API et de messagerie étaient déjà faux sur la ligne de base. Le harnais appartient à `CRM-008`,
  et réviser ses totaux ici reviendrait à adopter les nombres de quatre autres unités sans rejouer
  leurs preuves.
- **INC-100 relevée, mesurée et NON corrigée** : la liste « Ce que le fil ne fait pas encore » du
  §4.10 de `docs/manual.md` affirme deux choses que le produit **et le manuel lui-même** démentent —
  « aucun nom d'auteur n'est affiché », faux depuis `CRM-022`, et « le motif d'un déplacement n'est
  conservé nulle part », faux depuis la migration `0035`. Les deux lignes appartiennent à `CRM-022`
  et à `CRM-034` ; le chapitre a été mis à jour sur les seuls points de modération.
- **INC-099 constatée une seconde fois, dans un troisième harnais** : le résidu de
  `e2e/ui/administration-arborescence.spec.ts` a fait passer `test:sql` au rouge après `e2e:ui`, puis
  après `verify-harness.sh`. Le nettoyage manuel des quatre lignes suffit à rendre la suite verte.
  Tout comptage `test:sql` publié après un `e2e:ui` est donc faux tant que l'entrée vit. Le défaut
  appartient à `CRM-075` et reste intact. **Les deux constats ci-dessus sont soldés depuis, dans la
  même section : voir « Lot I+J » sous *Corrigé*.** Ils sont conservés tels quels parce qu'ils
  décrivent ce que la session du lot G a réellement mesuré et livré, et qu'une entrée de changelog
  n'est pas réécrite après coup ; le renvoi évite qu'ils se lisent comme l'état courant.

### Corrigé

- **Lot I+J : les preuves d'arborescence rendent la table dans l'état où elles l'ont trouvée, et
  les cinq garde-fous globaux gardent de nouveau quelque chose** (ordre de reprise : décisions 377
  et 379 ; forme retenue : décision 380). Deux entrées, deux unités, un seul lot — celui que la
  décision 367 plaçait après le lot G.
  - **INC-099 close** (`CRM-075`). Les quatre scénarios de
    `e2e/ui/administration-arborescence.spec.ts` laissaient **deux tracks et deux channels**
    derrière eux à chaque exécution. Ils avaient pourtant un `finally` : il **archivait** au lieu de
    supprimer, au motif que « la suppression n'existe pas » — vrai du produit, sans effet sur ce
    qu'une preuve doit rendre. Une ligne archivée reste une ligne. Le `finally` **purge** désormais
    par slug, avec la clé de service, appliquant à la lettre la règle que la décision 362 avait
    rendue pour INC-091 sur `mail_messages`. Le nettoyage d'entrée est conservé : il protège du
    `23505` d'une exécution tuée avant son épilogue.
  - **La correction est CONTRE-ÉPROUVÉE, pas seulement affirmée.** Avant : `e2e:ui` puis
    `test:sql` rend `0004_tracks.test.sql` rouge sur deux assertions — `have: 6 want: 4`, puis
    `have: 3 want: 1`. Après, sur le même conteneur et sans qu'aucune assertion ne soit touchée :
    `test:sql` rend **33 fichiers, 1971 assertions, aucune anomalie**, y compris après les **trois**
    projets Playwright joués à la suite. `e2e:api`, que le résidu faisait tomber à **496 verts et
    11 rouges** lorsqu'il suivait `e2e:ui`, rend ses **507**.
  - **L'assertion n'est ni désarmée ni assouplie** : elle reste le détecteur, et c'est elle qui a
    prononcé la reproduction du défaut avant la correction.
  - **INC-101 close** (`CRM-008`). Les cinq compteurs figés de `scripts/verify-harness.sh` étaient
    périmés : `31 / 1921 / 504 / 182 / 41` contre **33 / 1971 / 507 / 185 / 42** mesurés. L'écart
    est attribué fichier par fichier plutôt que constaté en bloc — deux suites pgTAP ajoutées
    (`CRM-059`, `CRM-053`/`CRM-058`), quatre étendues (INC-085, lot G, `CRM-043`), trois scénarios
    d'interface par le geste de modération, un scénario de messagerie par `backfill.spec.ts`.
  - **Et une mesure que l'entrée n'avait pas faite : `SCENARIOS_API` n'a jamais été juste.** Les
    trois autres compteurs avaient dérivé, dépassés par des livraisons postérieures. Celui-ci non :
    depuis le commit qui a écrit `504`, **aucun scénario d'API n'a été ajouté ni retiré** — le seul
    fichier modifié depuis l'a été par le *renommage* d'un scénario. Le compte déclaré était déjà de
    507 à l'instant de l'écriture. Un compteur figé peut donc mentir sans qu'aucune livraison ne
    l'ait dépassé, ce qui élargit la leçon d'INC-080.

- **Lot G : le motif d'une transition est enfin conservé, « vide » s'entend des blancs Unicode, et
  la modération d'un commentaire devient possible et auditée** (arbitrage : décision 367 ; mise en
  œuvre : décision 374 ; migration `0035_commentaires_lot_g.sql`). Quatre entrées du registre
  fermées ou avancées en un seul geste, parce qu'elles touchent une seule table.
  - **INC-048 close.** `move_card` exigeait un motif, le contrôlait, et ne l'écrivait **nulle
    part** : un utilisateur qui motivait une affaire perdue voyait sa transition acceptée et sa
    raison disparaître. Le motif est désormais inséré dans `card_comments` **dans la transaction du
    déplacement** — soit les deux, soit ni l'un ni l'autre — et **dès qu'il est fourni**, non
    seulement lorsqu'il est exigé. Devenu un commentaire ordinaire, il en hérite les bornes : une
    vérification **n° 5 bis** rend `comment_too_long` au-delà de 10 000 caractères, plutôt que de
    laisser remonter une violation de contrainte illisible depuis un appel de fonction.
  - **INC-052 close, aux deux endroits à la fois.** La normalisation employait `btrim` à un
    argument, qui ne retire que l'espace `U+0020` : une **tabulation seule passait pour un motif**
    d'affaire perdue, et une valeur réduite à `"\t"` satisfaisait un champ `required`.
    `app.btrim_blancs(text)` porte désormais, **une seule fois**, la classe exacte de
    `String.prototype.trim()` — énumérée en points de code, jamais `\s` ni `[[:space:]]`, qui
    dépendent du `ctype` de l'instance. Conséquence la plus utile : le prédicat de l'interface cesse
    d'être une réimplémentation de `btrim` et redevient un appel à `trim()`. La convergence exigée
    par le §4.3 de `docs/SPEC-form-composer.md` tient **par construction**, et non plus par une
    recopie que la décision 165 avait dû corriger après un défaut mesuré.
  - **INC-071 close, sans une ligne de code.** L'énoncé de `CRM-043` promettait la rédaction à
    « tout membre pouvant **lire** la card », à côté d'une Definition of Done exigeant la preuve du
    **refus** opposé à un `viewer`. Le comportement livré était le bon depuis la migration 15 ;
    c'est l'énoncé qui est corrigé.
  - **INC-072 : la règle est livrée, le geste ne l'est pas encore.** La suppression d'un commentaire
    s'ouvre aux `admin` du workspace — la modification leur reste fermée, réécrire le propos d'autrui
    étant une falsification et non une modération. La borne est portée par le **trigger**, seul
    endroit qui voie `OLD`, `NEW` et `auth.uid()` ensemble : une politique RLS n'a pas d'`OLD`, et
    le privilège de colonne est attaché au rôle que l'auteur et le modérateur partagent. Le retrait
    est **audité** par `card_comments.deleted_by`. **L'écran n'offre encore aucun geste de
    modération** : `CRM-043` repasse `[~]` et l'entrée reste ouverte — un droit qui n'a pas de chemin
    n'est pas un droit (leçon d'INC-085).
  - Preuves rejouées sur pile complète : `test:sql` **33 fichiers / 1969 assertions**, `test:unit`
    **744**, `e2e:api` **507**, `e2e:ui` **182**, `e2e:mail` **42**, `pytest` **242**,
    `verify-manual.sh` **107 contrôles**, `typecheck` et `build`.
- **INC-099 relevée, mesurée et NON corrigée** : deux scénarios de `e2e/ui/administration-arborescence.spec.ts`
  créent un track et un channel, les archivent, et **ne les retirent jamais** — le nettoyage existe,
  mais à l'entrée du scénario et non dans un `finally`. Les quatre lignes résiduelles font rougir
  **neuf** assertions réparties sur trois harnais (`0004_tracks.test.sql`, `e2e:api` sur six
  scénarios de comptage, `verify-manual.sh` sur deux grandeurs de l'annexe A), de sorte que l'ordre
  d'exécution des suites décide de leur couleur. Même famille qu'INC-091, sur d'autres tables. Le
  défaut est étranger à l'unité de la session : il est consigné avec sa mesure, et le comportement
  est laissé inchangé.
- **INC-096 close, et le lot A soldé : les preuves de pile sont de nouveau exécutables**
  (décision 373). Deux faits, tous deux mesurés. Le responsable a transmis **hors dépôt** un jeton
  d'accès Docker Hub, qui est exactement l'action humaine que l'entrée attendait depuis le
  2026-08-12 ; le jeton n'entre ni dans le dépôt, ni dans un fichier d'exemple, ni dans un journal
  committé. Et le `429 Too Many Requests` avait une **seconde cause, jusque-là non identifiée** :
  `docker compose` tire les dix-huit images **en parallèle**, et c'est cette rafale qui atteint la
  limite. Le même tirage relancé **seul** réussit ; un tirage **séquentiel avec temporisation
  croissante** a rapatrié les dix-huit images sans un seul échec définitif. Une limite horaire
  épuisée ne se contournerait pas ainsi.
- **`CRM-059` revient à `[x]` : la preuve rétrogradée le 2026-08-12 est verte au rejeu**
  (décisions 369, 370). Le défaut annoncé — « le backfill descend tout l'historique dès la première
  relève » — **n'existait pas dans le produit** : il avait été mesuré sur une pile où `rest`,
  `mail-sync` et `webapp` étaient absents. Sur une pile complète (**17/17 `healthy`**, vérifiée
  AVANT la mesure et non après coup), `e2e/mail/backfill.spec.ts` passe, `e2e:mail` passe entière
  (**42**), `pytest` passe (**242**) et `scripts/verify-mail-resilience.sh` rend **56 contrôles sans
  anomalie**, mutations de non-complaisance comprises.
- **INC-091 close : deux preuves ne laissent plus de message dans une boîte réelle** (décision 371).
  `e2e/mail/resilience.spec.ts` et `e2e/mail/infrastructure.spec.ts` purgent désormais la **boîte**
  IMAP dans leur `finally`, et non plus seulement la table — un `DELETE` en base rend `204` sans
  rien effacer tant que le compte n'a pas été relevé, et le message restait alors dans la boîte de
  son destinataire, d'où la veille permanente de `CRM-059` le remontait en non classé. La fuite
  avait été **reproduite et chiffrée** avant correction : six messages pour deux exécutions de la
  suite, soit deux scénarios × deux passages pour chacun des deux fichiers.
- **`npm run test:sql` redevient intégralement vert** : **33 fichiers, 1944 assertions**, dont les
  22 de `0029_inbox_globale.test.sql`. L'assertion 9 — « un membre ordinaire ne voit AUCUN non
  classé » — **reste armée sur la table entière** : elle avait vu une fuite que rien d'autre ne
  voyait, et la désarmer aurait supprimé le détecteur au lieu de la cause.
- **Cinquième collision de numéro de décision corrigée** : deux entrées « 341 » coexistaient depuis
  le 2026-08-12. La moins citée est renumérotée en **368**, son unique renvoi mis à jour, aucune
  référence cassée. Contrairement aux précédentes, celle-ci ne vient pas d'une exécution concurrente
  mais d'une absence de relecture du compteur — le verrou du lot C ne l'aurait pas arrêtée.

### Ajouté

- **`retirerDeLaBoite` dans `e2e/mail/protocoles.ts`** : purge IMAP d'une boîte réelle par sujet,
  écrite en `node:net` et **sans aucune bibliothèque** (décision 238). Elle balaie **tous** les
  dossiers de la boîte, et non le seul `INBOX` — entre le dépôt et la purge, la veille a pu ranger
  le message dans le dossier de sa card.

### Documentation

- **INC-096 reçoit une mesure contraire, et reste pourtant ouverte** (décision 369) : le tirage
  d'images réussit sur l'exécution du 2026-08-14, alors qu'il rendait `429` le 2026-08-12. L'entrée
  n'est pas close parce que la limite de tirage **anonyme** de Docker Hub se recharge et dépend de
  l'adresse de sortie partagée : une exécution qui passe ne prouve rien pour la suivante.
- **INC-092 reste ouverte, et le lot B n'est pas soldé** : ce défaut est un **journal** et non une
  donnée — un `WARNING` légitime qu'aucune purge n'empêche —, et trois rejeux verts de la suite
  mesurent seulement que la course ne s'est pas produite.
- **Lot D soldé : quatre entrées closes, corrigées et non déclarées** (décision 367). Le registre
  passe de 62 à **58 entrées ouvertes**, puis à **57** avec la clôture d'INC-091.
- **INC-019 — le bandeau du `README.md` est réécrit depuis l'état réel du backlog**, et distingue
  désormais trois catégories que le lecteur confondait : livré **et vérifié** (`[x]`), écrit mais
  **insuffisamment vérifié** (`[~]`), pas commencé (`[ ]`). Il annonce aussi INC-096 en tête, parce
  qu'aucune preuve de pile n'est exécutable aujourd'hui. Règle posée : **ce bandeau se relit à
  chaque livraison, au même titre que ce fichier**.
- **INC-017 close** : la limite « `supabase_vault` et `pg_cron` non vérifiées » a bien disparu du
  §11, constaté et non supposé.
- **INC-008 close, et tranchée dans le sens des scripts** : `npm run stop`, `npm run db:migrate` et
  `npm run db:seed` **n'existeront pas**. Deux façades pour un même geste font diverger la
  documentation de l'une des deux ; le `package.json` reste borné à la chaîne Node. Les lignes « à
  venir » correspondantes sont retirées du `README.md` §5 et de `docs/DAT.md` §13.
- **INC-006 close** : la pile officielle épinglée est confirmée comme référence. La question de
  l'origine est d'ailleurs devenue sans objet — la pile a divergé de la distribution officielle par
  des décisions propres, dont le retrait de Supavisor.
- **`README.md` §11 corrigé sur deux points mesurés faux** : l'administration de l'arborescence a
  son écran depuis `CRM-075`, et la messagerie du produit n'est plus « rien ne la lit » mais
  « écrite, et aucune de ses unités intégralement prouvée ».

### Documentation

- **Les 61 entrées ouvertes du registre reçoivent chacune une disposition** (décision 367),
  présentées au responsable en treize lots et arbitrées une par une. Le filtre qui avait écarté
  cinquante-six d'entre elles comme « déjà tranchées » était posé par l'agent, pas par lui : une
  entrée arbitrée mais non livrée **est** un bloqueur pour qui lit le registre.
- **Contrainte de tête, INC-096** : le registre d'images étant injoignable, aucune preuve de pile
  n'est exécutable. Seuls les lots prouvables **sans la pile** sont traités — rien ne sera déclaré
  livré sans sa preuve.
- **Aucune entrée n'est fermée par déclaration.** À chaque lot, l'issue qui aurait fait descendre le
  compteur sans rien réparer a été explicitement écartée : désarmer l'assertion qui a trouvé la
  fuite, clore les écarts documentaires sans les corriger, valider les quinze entrées de
  modélisation sur la seule matrice sans revérifier le code.
- **`docs/BACKLOG.md` porte le plan d'exécution** — quels lots sont faisables aujourd'hui, lesquels
  attendent la pile.

### Supprimé

- **Le pooler de connexions Supavisor est retiré de la pile** (décision 366). Il était démarré,
  sondé et publié depuis `CRM-001` sans aucun consommateur : les quatre services qui parlent SQL
  ouvrent leur propre pool vers la base en direct, `mail-sync` passe par PostgREST, l'outillage SQL
  de l'hôte passe par `POSTGRES_DIRECT_PORT`, et la production ne lui publiait aucun port. Partent
  avec lui la base interne `_supabase`, le schéma `_supavisor`, `pooler.exs`, le mot de passe du
  rôle `pgbouncer` — le rôle appartient à l'image et y reste —, les deux ports publiés en
  développement et la sonde correspondante du harnais.
- **Six variables `POOLER_*` et `VAULT_ENC_KEY` quittent le contrat d'environnement.** Supavisor
  était l'unique consommateur de `VAULT_ENC_KEY` ; le contrat de déploiement et le README la
  décrivaient à tort comme la clé des secrets de messagerie, qui vivent en réalité dans le Vault de
  la base (INC-098). Le contrôle n° 1 de `scripts/verify-scripts.sh`, qui refuse toute variable du
  gabarit que rien n'interpole, imposait de lui-même ce retrait dans le même changement.

### Modifié

- **`STACK_RLIMIT_NOFILE` passe de `100000` à `10000`.** La valeur haute était la demande de
  Supavisor ; Realtime en réclame 10 000. Un hôte dont la limite dure est plus basse continue d'être
  détecté à l'amorçage. Le changement n'élargit que l'ensemble des hôtes qui démarrent sans réglage.
- **`CRM-001` repasse à `[~]`.** Le retrait touche des scripts d'initialisation qui ne rejouent qu'à
  la création du cluster PostgreSQL ; tant que le démarrage à froid et `scripts/verify-stack.sh`
  n'ont pas été rejoués, la preuve de l'unité est périmée. Non rejoués le 2026-08-13 : le démon
  Docker n'était pas joignable depuis la session.

### Documentation

- **Plus aucune décision n'est suspendue dans le registre** (décisions 362 à 365). Les six entrées
  ouvertes après le 2026-08-11 sont tranchées ; INC-096 n'appelait pas un choix mais une action hors
  dépôt. Les **61 entrées ouvertes attendent toutes une mise en œuvre et une preuve**, jamais un
  arbitrage.
- **INC-091 et INC-092 — chaque preuve purge par IMAP ce qu'elle dépose** dans une boîte seedée, dans
  son propre `finally`, qu'elle l'ait relevée ou non. **L'assertion 9 de `0029` reste armée sur la
  table entière** : elle a vu une fuite que rien d'autre ne voyait, et la désarmer serait corriger le
  défaut en supprimant son détecteur. Piège nommé pour la mise en œuvre : purger la **table** n'est
  pas purger la **boîte** — le `finally` actuel de `resilience.spec.ts` rend `204` en n'effaçant rien.
- **INC-094 — une élévation de privilège se justifie, elle ne s'énumère pas.** Toute migration portant
  `-- @migration-role:` cite son motif mesuré en en-tête, et le harnais contrôle cette justification
  au lieu d'énumérer les fichiers autorisés. La liste close avait rendu `verify-scripts.sh` rouge en
  permanence depuis `CRM-057` — un harnais durablement rouge cesse d'être lu.
- **INC-089 et INC-097 — la sérialisation devient une garde du dépôt.** Le crochet `pre-commit`
  refusera un numéro de décision déjà pris et une seconde exécution concurrente. Le compteur global
  est **conservé** : plus de trois cent soixante décisions sont citées par leur numéro, et un schéma
  mixte serait moins lisible que le défaut.
- **INC-095 — un contrat de déploiement se remplit par celui qui a décidé.** `CRM-053`, `CRM-056` et
  `CRM-059` écrivent les lignes de leurs propres migrations ; un contrôle refusera toute migration
  absente du contrat, posé **avec** le contenu et jamais avant.
- **`docs/BACKLOG.md` nomme les porteurs** de ces quatre arbitrages dans une section dédiée. Aucune
  unité n'est créée : le travail rejoint des unités existantes ou la méthode de travail.

### Documentation

- **Le registre des contradictions ne conserve plus que ce qui est ouvert** (décision 361). Le texte
  intégral des **36 entrées closes** est retiré de `docs/INCONSISTENCY_REPORT.md` et remplacé par un
  index d'une ligne chacune — objet, date de clôture, unité qui l'a fermée, décision du journal.
  **5 028 → 2 959 lignes**, INC-097 et l'index d'état compris. Chaque retrait a été précédé de
  la vérification que la décision et la preuve existent ailleurs ; quatre entrées — INC-014, INC-075,
  INC-085, INC-093 — étaient closes **dans leur corps sans que leur titre le dise**, et un tri sur
  l'en-tête les aurait manquées.
- **`docs/ARBITRAGES.md` applique enfin sa propre règle d'ouverture** — « une entrée disparaît d'ici
  lorsque la décision est prise » —, jamais mise en œuvre jusqu'ici : **183 → 88 lignes**. La
  photographie du 2026-08-06 et l'ordre d'exécution que trois décisions plus récentes avaient
  renversé sont retirés ; une section nomme désormais **les sept entrées qui attendent réellement une
  décision**, et l'ordre de solde de la décision 336 est mis à jour — INC-076 et INC-085/INC-075
  étant closes, **INC-072 est le terme restant**.
- **INC-097 ouverte, et sa correction appliquée** : `docs/JOURNAL.md` portait **deux décisions 340**,
  troisième collision du document après les deux décisions 180. L'entrée non citée est renumérotée
  **360** — la règle de la décision 258 impose le suffixe seulement lorsque les deux sont citées, ce
  qui n'était pas le cas, et aucune référence n'est cassée. **La cause n'est pas traitée** : rien
  n'empêche encore une écriture de reprendre un numéro déjà pris.

### Corrigé

- **INC-085 et INC-075 closes, `CRM-012` passe `[x]` : un track est désormais lisible dès qu'un de
  ses channels l'est.** Un `channel_members.access = 'member'` posé sous un track fermé rouvrait
  bien le channel — le backend le rendait, une assertion pgTAP le prouvait — mais l'interface ne
  liste les channels qu'une fois un track ouvert : **aucun geste de navigation n'y menait**, et
  l'adresse saisie à la main rendait « Track introuvable ». Un droit accordé qui n'a pas de chemin
  n'est pas un droit. `supabase/migrations/0034_lecture_track_transitive.sql` livre
  `app.track_has_readable_channel(uuid)` et élargit `tracks_lecture_membre` à « le track est lisible
  **ou** l'un de ses channels l'est » — « le plus spécifique gagne » devient **transitif**
  (`docs/JOURNAL.md` décisions 333 et 357, `docs/SPEC-permissions-rls.md` §3.3 bis). Aucun
  changement de schéma ; **aucun channel supplémentaire ouvert** et **aucun droit d'écriture
  conféré**. Mesuré avant/après avec le jeton du `viewer` seedé : tracks rendus **3 → 4**, channels
  **4 → 4 inchangés**, channels du track réapparu **« Prospection » seul**, `PATCH` du `viewer`
  **zéro ligne touchée**, `insert … returning` d'administrateur **201** — le défaut de la
  décision 107 n'est pas réintroduit. `npm run test:sql` **33 fichiers / 1944 assertions**,
  `npm run e2e:api` **504/504**, `npm run e2e:ui` **182/182**, `scripts/verify-authz.sh` **35
  contrôles**, `scripts/verify-seed.sh` **55 contrôles**, `npm run typecheck` — sans anomalie. Sept
  captures observées dans `docs/captures/CRM-012/`, dont le track rendu avec son unique onglet aux
  quatre paliers. Quatre preuves qui encodaient l'ancienne règle ont été **révisées en expliquant
  pourquoi dans le fichier même**, aucune supprimée ni relâchée — le triplet du `viewer` de
  `verify-authz.sh` passe de `3/4/8` à `4/4/8`, ce qui **dit strictement plus** : seuls les tracks
  ont bougé.

- **INC-093 close : le contournement TLS `pip_ca` de `mail-sync` est enfin câblé, et `runDev.sh`
  remonte la pile derrière un proxy à certificat interposé.** `mail-sync/Dockerfile` portait la
  branche facultative `--mount=type=secret,id=pip_ca` depuis la décision 280, mais **aucun fichier
  Compose ne la câblait** : le service déclarait `build:` sans clé `secrets:`, la branche testait un
  montage absent (`pip_ca: inactif`), `pip install` échouait en `CERTIFICATE_VERIFY_FAILED` et
  `./runDev.sh` s'arrêtait avant de démarrer le moindre service — la pile entière indisponible pour
  une seule image. `docker-compose.yml` déclare désormais le secret `pip_ca`, de source
  `${PIP_CA_FILE:-/dev/null}`, et le référence sous le `build:` du service ; le secret est porté par
  le fichier de base et non par l'overlay de développement, la production construisant la même
  image. La garde de forme `env_require_dev_npm_ca_file` devient `env_require_dev_ca_file
  <VARIABLE>`, paramétrée plutôt que dupliquée, et `runDev.sh` comme `resetMe.sh` la réclament pour
  `NPM_CA_FILE` **et** `PIP_CA_FILE`. Rejeu mesuré : `mail-sync` se construit sans erreur TLS et les
  **18 services** de l'assemblage de développement sont `healthy`. Sans la variable, la branche
  reste strictement inerte. `docs/JOURNAL.md` décision 356 ; `README.md`, `.env.example` et
  `docs/DAT.md` documentent la nouvelle variable facultative.

### Ajouté

- **Le travail hors de `main` est désormais refusé par Git, au commit comme au push** (décision
  358). `.githooks/lib/exige-main.sh` fournit un contrôle de branche appelé par `.githooks/pre-commit`
  et par le nouveau `.githooks/pre-push` : une branche courante autre que `main`, un `HEAD` détaché,
  ou une référence distante visée autre que `refs/heads/main` sont refusés, avec le message dicté par
  le responsable et le geste de rattachement qui ne perd rien. La règle de `CLAUDE.md` §13 cesse
  d'être une consigne en prose, oubliée par chaque session, comme la décision 345 l'avait fait pour
  l'identité des commits — dont le contrôle n'est pas relâché. Preuve :
  `scripts/verify-crochets-git.sh`, **20 vérifications**, aucune anomalie, dans des dépôts jetables.

- **INC-076 close : suppression d'un compte auteur de commentaires, prouvée sur une pile réelle.**
  Les trois preuves demandées par le constat statique du 2026-08-11 sont rejouées et vertes :
  `npm run test:sql` (suite `0023`, **1937 assertions**, aucune anomalie), `scripts/verify-seed.sh`
  (**55 contrôles**, aucune anomalie), et un véritable `DELETE /auth/v1/admin/users/<id>` sur le
  compte de Driss Lemoine (auteur réel de deux commentaires du seed) — **`HTTP 200`**, les deux
  commentaires survivant avec `author_id` devenu `null`. Aucun code modifié : le comportement était
  déjà correct depuis `CRM-022` (2026-08-09), seule la preuve d'exécution manquait. `docs/JOURNAL.md`
  décision 355 ; `docs/INCONSISTENCY_REPORT.md` INC-076 clôturée, l'ordre de la décision 336 reprend
  désormais à INC-085/INC-075.
- **`CRM-059` passe `[x]` : la passe d'historique du backfill est désormais prouvée de bout en
  bout.** Dernier écart nommé de l'unité — `e2e/mail/backfill.spec.ts` dépose de l'historique
  RÉEL dans une boîte seedée par `APPEND` IMAP daté (RFC 3501 §6.3.11), porte `backfill_months`
  à 6 par le vrai chemin d'écriture, puis envoie un message du jour par SMTP réel : le premier
  contact ne descend QUE le jour, la relève suivante reprend l'historique intégralement, un
  troisième appel confirme l'idempotence. `docs/JOURNAL.md` décision 352.
  - **Corrigé au passage** (décision 351) : `mail-sync` ne déclarait `depends_on` ni sur `kong` ni
    sur `rest` — sur un amorçage à froid, sa boucle de veille pouvait démarrer avant l'API et
    journalisait `veille_source_indisponible` en `WARNING`, rendant `e2e/mail/mail-sync.spec.ts`
    S3 rouge sans qu'aucun compte ne soit réellement en panne. `docker-compose.yml` attend
    désormais les deux services sains.
  - **Consignés, non corrigés** — INC-091 et INC-092 (`docs/INCONSISTENCY_REPORT.md`) : la veille
    permanente de cette unité révèle qu'`e2e/mail/resilience.spec.ts` et
    `e2e/mail/infrastructure.spec.ts` laissent un message réellement délivré dans une boîte seedée
    sans jamais le retirer, ce qui finit par casser une garantie RLS figée à dessein
    (`0029_inbox_globale.test.sql`, §18.1) — et qu'elle fait aussi, plus rarement, rougir
    `mail-sync.spec.ts` S3 sur un échec ATTENDU d'`e2e/mail/comptes-entrants.spec.ts`. Hors du
    périmètre de `CRM-059` : l'arbitrage revient au responsable.
- **`CRM-059` — la relève cesse de redescendre la boîte entière à chaque tour.** MESURÉ dans
  `mail_sync/ingestion.py` : chaque relève exécutait `search(["ALL"])` puis `fetch` sur tout. La
  base dédoublonnait, donc rien n'était dupliqué — mais avec la boucle de veille livrée juste avant,
  une boîte de dix mille messages relevée toutes les minutes aurait produit dix mille `FETCH` par
  minute pour zéro message neuf. `mail_sync/backfill.py` solde cette dette, après que
  `docs/SPEC-mail-subsystem.md` **§20.6 bis** en a écrit l'algorithme (décision 342).
  - **Deux passes, le courrier du jour d'abord** : le neuf n'est jamais borné, l'historique l'est à
    200 messages par tour et par dossier, et il descend du plus récent vers le plus ancien.
  - **`sync_state` porte une PLAGE** `{uid_min, uid_max}` et non un seul UID : le plancher dit
    jusqu'où l'historique est descendu, pas où commence le courrier neuf. Sa lecture est
    **tolérante** — une forme illisible est traitée comme vierge plutôt que de faire échouer la
    relève d'un compte.
  - **Un premier contact descend le courrier du jour, pas la boîte** : tout ce qui précède le
    branchement est de l'historique, et l'historique ne descend que si l'exploitant l'a demandé.
    `backfill_months = 0` — le défaut — **supprime la passe**, il ne la borne pas à zéro mois.
  - **La progression n'est écrite qu'après un rapatriement réel**, et hors du `finally` de la
    session IMAP : une relève qui échoue ne fait pas avancer le plancher.
  - **Aucune migration** : `service_role` a déjà tous les privilèges sur la table, et la RPC de
    secrets n'est pas élargie — lui faire porter deux colonnes de configuration élargirait la seule
    voie par laquelle un secret sort de la base.
  - Preuves : **48 assertions pytest** (suite complète **235 tests**, verts), dont le **premier test
    unitaire de `relever_compte`**. Non complaisantes : cinq mutations font toutes rougir la suite.
  - **Non traité et nommé** : un changement d'`UIDVALIDITY` invalide l'état enregistré — le dossier
    redescendrait son courant sans rien perdre, mais son historique paraîtrait complet à tort
    (§20.6 bis.6). `LOT_BACKFILL = 200` est un ordre de grandeur choisi, **pas une mesure**.

- **`CRM-059` — la boucle de veille consomme enfin `MAIL_SYNC_POLL_INTERVAL`.** La variable était
  déclarée dans `.env.example` et dans le `README.md` depuis `CRM-051`, et **lue par rien** : une
  promesse tenue par personne. `mail-sync/src/mail_sync/veille.py` la prend, après que
  `docs/SPEC-mail-subsystem.md` **§20.10** en a décrit la forme — spécification committée **avant**
  le code (décision 341).
  - **La décision est pure, l'attente ne l'est pas.** Quels comptes relever, dans quel ordre, quel
    délai avant le tour suivant : des fonctions sans effet, **prouvées sans dormir une seule fois**.
    Une preuve qui attendrait soixante secondes serait la temporisation arbitraire que `CLAUDE.md`
    §18 proscrit.
  - **Un fil d'arrière-plan, pas `asyncio`** — le service est synchrone de bout en bout. L'attente
    s'appuie sur un `threading.Event` : un arrêt l'interrompt au lieu de retenir le conteneur.
  - **Le délai ne se réduit pas de la durée du tour** : deux relèves du même compte ne se
    chevauchent jamais, et une série de tours lents ne produit pas de rafale de rattrapage.
  - **Un compte en panne n'arrête pas la veille** et ne masque pas les autres. L'absorption **n'est
    pas un silence** : le journal porte l'identifiant du compte et le **type** de la panne, jamais
    son texte, qui peut refléter un identifiant de connexion.
  - **`0` désactive explicitement**, et toute autre valeur doit tenir entre **5 secondes et 1
    heure** — hors bornes, le service **refuse de démarrer** plutôt que de corriger en silence.
  - **La veille n'invente pas une seconde façon de relever** : elle appelle `relever_compte` avec
    les mêmes arguments que la route interne de `CRM-054`, pour qu'aucun chemin ne diverge.
  - Preuves : **31 assertions pytest** (suite complète **187 tests**, verts), non complaisantes —
    quatre mutations font toutes rougir la suite. `README.md` et `.env.example` cessent d'annoncer
    la variable comme « en attente de `CRM-054` ».
  - **Non livré à cette étape** : le backfill par lots (§20.6) et l'écran d'état (§20.7), livrés
    séparément ci-dessous ou restant dus.

- **`CRM-059` — la reprise d'un rangement manqué, dette nommée de `CRM-056`.** `CRM-056` tentait le
  rangement à la PREMIÈRE vue d'un message et journalisait un refus sans le rejouer : un dossier
  introuvable au moment du classement, ou une copie IMAP refusée, laissait le message classé en
  base et absent de son dossier pour toujours. La dette est réglée — `docs/SPEC-mail-subsystem.md`
  §20.5, migration 32, décision 342 (renumérotée depuis une collision avec une décision parallèle,
  voir `docs/JOURNAL.md`).
  - **`mail_messages.filed_at` dit QUAND un message a été COPIÉ**, jamais quand il a été classé —
    nul pour un message non classé, ou classé mais dont le rangement a échoué. C'est ce second cas
    que la relève suivante reprend, sans nouveau message pour le déclencher.
  - **`messages_a_ranger(account_id)` vit en base**, pas dans le service : elle rend un message
    classé et non rangé avec l'occurrence la PLUS ANCIENNE de ce compte, déterministe et
    indépendante de l'ordre de retour du serveur.
  - **`marquer_message_range` ferme le fait UNIQUEMENT après une copie IMAP réussie**, jamais à la
    classification — la marquer avant de savoir si la copie a réussi masquerait un échec à la
    relève suivante.
  - **La reprise appelle la MÊME primitive que la classification** (`ranger_dans_dossier`), sans en
    inventer une seconde, et porte sur tout le compte — pas seulement les dossiers surveillés du
    tour courant, puisqu'un message peut avoir été vu dans un dossier retiré de `watch_folders`
    depuis, sans avoir quitté la boîte pour autant.
  - **La route interne `POST /internal/v1/inbound-accounts/{id}/poll` rend `filed_retried`**, distinct
    de `filed` — le décompte des rangements neufs ne doit pas se confondre avec celui des reprises,
    faute de quoi l'écran d'état du §20.7 mentirait sur ce qui vient de se passer.
  - Preuves : **12 assertions pgTAP** (suite complète **32 fichiers, 1933 assertions**, verte) et
    **5 assertions pytest** (suite complète **192 tests**, verte), non complaisantes — deux
    mutations (marquer le fait sans condition de succès) font rougir les deux assertions qui
    protègent exactement cette règle. **Round-trip réel exécuté sur la pile de développement** — la
    première depuis que `CRM-059` existe (`docs/JOURNAL.md` décision 343) : un message déjà classé
    et rangé par le seed voit son `filed_at` remis à nul pour simuler un rangement manqué passé, la
    route de relève interne est appelée contre le VRAI Stalwart et la VRAIE base, et
    `filed_retried: 1` est rendu tandis que `filed_at` redevient non nul en base.
  - **Non exécuté, et `CRM-059` reste `[~]`** : preuve E2E `mail` par Playwright d'une copie
    réellement refusée puis reprise (le round-trip ci-dessus est manuel, pas automatisé), preuve
    d'API des refus d'autorisation, écran d'état, backfill par lots et harnais
    `scripts/verify-mail-resilience.sh`.

- **`CRM-075` — l'écran d'administration des tracks et des channels.** Le geste le plus courant de
  l'administration d'un CRM — créer un track — avait un CRUD prouvé et **aucune surface** (INC-086).
  Il en a une : « Réglages ▸ Arborescence ». Créer, renommer, réordonner, archiver et désarchiver un
  track comme un channel, avec le rattachement du channel à son track et le choix de son workflow.
  - **`/reglages` devient l'index des sections**, `/reglages/arborescence` porte l'écran. L'écran est
    chargé à la demande (**21 ko** en paquet séparé) et sa route est déclarée **hors** de la table
    `ROUTES`, qui doit couvrir exactement les entrées de la barre latérale — patron déjà employé par
    le détail d'une card et la vue liste.
  - **Les commandes ne sont masquées pour personne.** Un rôle lu au chargement peut être périmé à
    l'instant de l'écriture : une commande masquée sur cette foi cacherait un geste **permis**. Le
    refus du backend est traduit champ par champ, et la saisie est conservée.
  - **Aucune modale**, aucune suppression, aucun défaut de workflow présélectionné.
  - **Un cinquième geste est livré : le désarchivage**, que l'énoncé de `CRM-075` ne citait pas.
    Sans lui, « archiver reste réversible » décrit une propriété de la base et non du produit.
    **Arbitré par le responsable (INC-090, option 1A, décision 339)** : le geste reste dans l'unité,
    dont l'énoncé est corrigé pour citer cinq verbes. INC-090 est close.
  - **Trois défauts réels trouvés par les preuves et corrigés dans le même changement** : un refus de
    déplacement calculé mais affiché nulle part ; une infobulle de commande désactivée qui annonçait
    « Déjà en tête de liste » alors que la cause était tout autre ; et la classe `size-10`, qui
    n'existe pas — 40 px n'étant pas dans l'échelle du §3 — et disparaissait **en silence**, le mode
    de défaillance que `docs/DESIGN_SYSTEM.md` §11 décrit.
  - **Une assertion existante a joué et a été révisée, non contournée** : `routes.test.tsx` exigeait
    un état vide de chaque route, et `/reglages` a cessé d'en être un. Même mécanisme que la révision
    de `CRM-057` pour l'inbox.
  - Preuves : **34 assertions de rendu** montant le vrai écran, `npm run typecheck`,
    `npm run test:unit` (**714 tests, 31 fichiers**), `npm run build` et le contrôle des classes CSS
    réellement engendrées — tous verts. `docs/manual.md` gagne son chapitre 5.
  - **Non exécuté, et l'unité reste `[~]`** : preuves d'API, E2E clavier et souris, captures aux
    quatre paliers, et harnais dédié. Tous exigent la pile de développement, absente de
    l'environnement où ce changement a été produit.

- **`CRM-075` — la couche d'accès aux données de l'administration de l'arborescence.**
  `webapp/src/lib/administration-arborescence.ts` porte les trois lectures — tracks, channels d'un
  track, workflows affectables — et les huit écritures : créer, renommer, déplacer, archiver et
  désarchiver un track comme un channel. **Aucune règle backend nouvelle** : chaque refus traduit est
  déjà posé et mesuré par `CRM-020`, `CRM-021` ou `CRM-033`.
  - **Réordonner écrit une seule position**, le milieu des deux voisines, au lieu d'une permutation
    en deux `UPDATE` non atomiques. Les cas où l'arithmétique ne peut pas produire une position
    distincte — voisines de position égale, première position nulle ou négative, précision flottante
    épuisée — sont **refusés et nommés**, jamais écrits à vide.
  - **Les refus sont classés sur le code PostgreSQL d'abord**, le code HTTP ensuite, jamais sur le
    texte du message. Les deux refus qui partagent le `SQLSTATE 23514` — contrainte d'affectation
    d'un workflow et `CHECK` de forme — sont séparés par le **nom de la contrainte**, seule
    inspection de texte du module.
  - **Un `PATCH` rendant `200` et zéro ligne est traité comme « sans effet »**, ni succès ni erreur :
    le `USING` de la politique a filtré la ligne, et afficher un succès montrerait une modification
    qui n'a pas eu lieu.
  - **`position` est envoyée à `null` à l'insertion** pour que le trigger place l'objet en fin de
    liste — comportement mesuré par `docs/SPEC-tracks.md` §3. Le générateur de types ne voyant pas
    les triggers déclare la colonne obligatoire ; l'écart est écrit à l'endroit exact où il est
    contourné, plutôt que tu.
  - Preuves : **51 assertions unitaires**, éprouvant la requête réellement émise autant que la
    valeur rendue. Non-complaisance vérifiée par trois mutations qui font bien rougir la suite.
    `npm run typecheck`, `npm run test:unit` (675 tests, 30 fichiers) et `npm run build` verts.
  - **Non livré par ce changement** : l'écran lui-même, ses textes, sa route, ses preuves E2E et ses
    captures. `CRM-075` reste `[~]`.

- **`CRM-075` — la preuve d'API des huit écritures, hors interface.**
  `e2e/api/administration-arborescence.spec.ts` prouve, avec les jetons réels du `viewer` et du
  `business_developer`, le refus de création, renommage, déplacement et archivage d'un track comme
  d'un channel.
  - **Deux formes de refus, mesurées et non supposées** : une création porte une ligne qui n'existe
    pas encore, et `WITH CHECK` la refuse en `403` / `42501` à l'insertion. Un renommage, un
    déplacement ou un archivage portent sur une ligne existante que la politique `USING` rend
    **invisible** à un non-administrateur : PostgREST n'y trouve rien à modifier, et rend `200` avec
    un corps **vide** — l'état « sans-effet » que `docs/SPEC-administration-arborescence.md` §9
    nomme, jamais une erreur. Une première rédaction attendait `403` pour les huit écritures ; rejouée
    contre la pile réelle, elle a échoué sur les douze scénarios d'`UPDATE` (`docs/JOURNAL.md`
    décision 348).
  - Preuves : **16 scénarios verts**, rejoués sans régression sur les **502 scénarios** de
    `npm run e2e:api`.

- **`CRM-075` ferme sa Definition of Done — l'écran est prouvé au clavier et à la souris.**
  `e2e/ui/administration-arborescence.spec.ts` : les cinq gestes — créer, renommer, réordonner,
  archiver, désarchiver — pour un track puis pour un channel, une fois à la souris et une fois
  entièrement au clavier (focus atteint par `Tab`, jamais par `focus()`). **8 scénarios verts**,
  captures aux quatre paliers dans `docs/captures/CRM-075/`, rejoués sans régression sur les
  **181 scénarios** de `npm run e2e:ui`.
  - **Un défaut réel trouvé en observant la capture à 390 px, pas en lisant un test**
    (`CLAUDE.md` §16) : le groupe de commandes d'une ligne au nom long débordait de la liste, et
    `<main>` (`AppShell.tsx`) porte son propre `overflow-x-auto` **sans** l'indication de
    débordement que `docs/DESIGN_SYSTEM.md` §12.6 impose — le bouton « Archiver » disparaissait au
    bord, sans aucun signal qu'il y avait plus à voir. Corrigé : les deux listes (tracks, channels)
    portent désormais `.indique-debordement-x`, le même patron déjà employé par la barre d'onglets,
    le board, la vue liste et le tableau de `CRM-059`.
  - **Deux preuves transverses périmées depuis que `/reglages` a cessé d'être un état vide,
    révélées ici pour la première fois** : `e2e/ui/coquille.spec.ts` et `e2e/ui/manuel.spec.ts`
    n'avaient jamais pu être rejouées contre la vraie pile depuis ce changement. Corrigées ;
    `docs/manual.md` §5 gagne la phrase qui manquait sur l'index des réglages.
  - **Un troisième défaut, dans `e2e/ui/etat-messagerie.spec.ts` (`CRM-059`)** : l'identifiant du
    compte mail de Driss y était recopié d'une exécution antérieure du seed, alors que
    `mail_inbound_accounts.id` n'a aucun littéral stable. Corrigé pour filtrer par `label`.
  - `scripts/verify-administration-arborescence.sh` est **LIVRÉ** — **27 contrôles, aucune
    anomalie**, non complaisant (trois dégradations réelles font rougir la suite avant
    restauration).
  - INC-086 est soldée : `docs/SPEC-tracks.md` §10 et `docs/SPEC-channels.md` §10 portent leur
    limite barrée avec renvoi vers cette unité. **`CRM-075` passe `[x]`.**

- **`CRM-059` — la boucle de veille n'avait jamais relevé un seul compte, et le défaut est corrigé.**
  `mail-sync/src/mail_sync/postgrest.py` interrogeait une colonne qui n'existe dans aucune
  migration (`password_secret_id`) au lieu de la réelle (`secret_id`, migration `0024`) : chaque
  tour de veille échouait dès sa première requête, absorbé silencieusement par la garde de
  résilience du §20.10.3 et journalisé en `veille_source_indisponible`. **Trouvé en surveillant les
  journaux du conteneur pendant la vérification de `CRM-075`** — la première fois que cette boucle
  s'exécute contre la vraie base (`docs/JOURNAL.md` décision 343 : « aucune session précédente
  n'avait atteint ce point »). Aucun test ne l'attrapait : `test_veille.py` alimente la décision par
  un double qui n'appelle jamais `PostgrestClient`.
  - Corrigé, et fixé par un nouveau fichier de preuve — `mail-sync/tests/test_postgrest.py`
    (2 assertions) — qui intercepte l'appel HTTP réel plutôt que de le contourner par un double.
  - Preuves : **242 assertions pytest** (240 + 2), **41 scénarios `e2e:mail`** verts sur un
    conteneur reconstruit à neuf, `scripts/verify-mail-resilience.sh` rejoué sans régression
    (**56 contrôles, aucune anomalie**). `docs/JOURNAL.md` décision 350.

- **`CRM-059` — l'écran d'état de la messagerie lit les comptes et la file sortante.**
  `/reglages/messagerie` (`webapp/src/app/EtatMessagerie.tsx`), atteint depuis l'index des réglages,
  n'ouvre aucune politique nouvelle : il lit `mail_inbound_accounts` sous la RLS de `CRM-052` et
  deux comptages sur `mail_outbox` sous celle de `CRM-058`. Tableau des comptes conforme à
  `docs/DESIGN_SYSTEM.md` §5.9, dictionnaire fermé des six codes d'incident (`docs/SPEC-mail-subsystem.md`
  §20.11.4), deux compteurs sobres pour la file sortante. Spécifié avant d'être écrit —
  `docs/SPEC-mail-subsystem.md` §20.11, décision 346.
  - Preuves : **45 assertions unitaires** (lecture + écran), `npm run typecheck` et `npm run build`
    verts, aucune classe Tailwind absente du CSS produit. `e2e/ui/etat-messagerie.spec.ts`
    (**6 scénarios**, captures aux quatre paliers) et `e2e/api/comptes-entrants.spec.ts`
    (**11 scénarios**, réutilisé de `CRM-052`) livrés et rejoués dans le même changement.
    `docs/manual.md` chapitre 6.
  - **`scripts/verify-mail-resilience.sh` est LIVRÉ** — **56 contrôles, aucune anomalie**, non
    complaisant (trois dégradations réelles font rougir la suite avant restauration). Il rejoue
    pytest sur `mail-sync/tests` (240 assertions), pgTAP sur `0031`/`0032`/`0033` (30 assertions),
    l'API, l'E2E `mail` (coupure SMTP réelle) et l'E2E `ui` (écran d'état).
  - **`CRM-059` reste `[~]`** : le seul écart nommé est la passe historique du backfill
    (`docs/SPEC-mail-subsystem.md` §20.6 bis.3), jamais exercée par une relève réelle faute d'un
    compte seedé avec `backfill_months > 0` — prouvée au niveau unitaire (pytest) seulement.

### Corrigé

- **`CRM-053`/`CRM-058` — `upsert_mail_outbound_identity` réinstallait `daily_quota = 0` à chaque
  appel sans plafond précisé, bloquant tout envoi.** La migration `0030` avait posé `NULL` comme
  défaut de la colonne (« aucun plafond »), mais n'avait jamais retouché la branche `INSERT` de son
  unique chemin d'écriture, restée sur `coalesce(p_daily_quota, 0)` depuis `CRM-053`. MESURÉ en
  tentant de rejouer `e2e/mail/resilience.spec.ts` pour `CRM-059` : chaque réapplication du seed
  réinstallait silencieusement le zéro sur les deux identités sortantes du seed, et le premier envoi
  échouait en `quota_exceeded`. Migration `0033` : une ligne changée, le reste de la fonction
  recopié à l'identique. `supabase/tests/0033_quota_par_defaut.test.sql` (4 assertions) fixe la
  garantie ; suite pgTAP complète rejouée, **1937 assertions vertes, aucune régression** ;
  `e2e/mail/resilience.spec.ts` et `e2e/mail/envoi.spec.ts` rejoués après réapplication du seed.
  `docs/JOURNAL.md`, décision 347.

- **L'attribution du commit `e373900` est rétablie.** Il portait `Claude <noreply@anthropic.com>` au
  lieu de l'identité du responsable, la configuration Git de l'environnement d'exécution écrasant
  celle du dépôt — ce que `CLAUDE.md` §13 interdit. Corrigé **sur instruction explicite** par
  `filter-branch` sur cinq commits : dates préservées, messages inchangés, **arbre du sommet
  identique bit pour bit**, poussé par `--force-with-lease`. `docs/JOURNAL.md`, décision 340, qui
  note aussi le remède durable manquant — un crochet `pre-commit` refusant une adresse non conforme,
  qui n'appartient à aucune unité.

### Documentation

- **`CRM-075` est spécifiée avant d'être écrite.** `docs/SPEC-administration-arborescence.md` décrit
  l'écran d'administration des tracks et des channels — adresses, gestes, requêtes émises, refus
  traduits, états —, et `docs/DESIGN_SYSTEM.md` **§5.13** en donne les règles visuelles. L'unité ne
  livre **aucune règle backend nouvelle** : tout ce que l'écran exerce est déjà posé et prouvé par
  `CRM-020`, `CRM-021` et `CRM-033`, et le §2 de la spécification cite chaque garantie avec l'endroit
  où elle est mesurée. Cinq points que l'énoncé laissait ouverts sont tranchés (décision 338) :
  `/reglages` devient un index et `/reglages/arborescence` porte l'écran ; réordonner écrit **une**
  position par index fractionnaire et jamais une permutation en deux `UPDATE` ; le **désarchivage**
  est livré avec l'archivage, sans quoi « archiver reste réversible » est faux dans le produit
  (**arbitrage attendu du responsable**) ; les commandes ne sont **pas** masquées pour un
  non-administrateur, un rôle lu au chargement pouvant être périmé à l'instant de l'écriture ;
  aucune modale, le design system n'en déclarant aucune. **Aucun code n'est livré par ce
  changement.**

- **Le registre des contradictions n'a plus aucune question ouverte au responsable.** Les deux
  dernières entrées sans arbitrage sont tranchées : **INC-085** — qui recouvrait **INC-075**, le
  même défaut relevé deux fois à trois jours d'écart — et **INC-088**. Les cinquante-six autres
  entrées ouvertes attendent une **mise en œuvre et une preuve**, jamais une décision (décisions 333
  à 336).
- **INC-085 et INC-075 sont arbitrées : « le plus spécifique gagne » devient transitif.** Un track
  redevient lisible dès que l'un de ses channels l'est, et son ouverture n'affiche que les channels
  consentis — la politique de lecture des `channels` filtre déjà, aucune règle n'est créée. Le
  contrat est écrit **avant le code** en `docs/SPEC-permissions-rls.md` **§3.3 bis**, avec ce que la
  reprise de `CRM-012` devra prouver. **Non livré** : le §8 du même document dit ce qui s'applique
  réellement en attendant.
- **INC-088 est arbitrée : l'écriture depuis la fiche d'une affaire appartient à `CRM-037`.** Sa
  Definition of Done exige déjà « transition bloquée, **saisie**, transition réussie » — l'unité
  n'est pas élargie, elle est ramenée à son énoncé, et `CRM-036` livre déjà la table, ses politiques
  et sa validation. Règle générale posée dans le même geste : **toute limite qui cite une entrée du
  registre est réexaminée le jour où cette entrée est close**.
- **Collision d'identifiant corrigée dans le backlog** : `CRM-075` désignait à la fois « Snooze des
  fils et des cards » et l'administration de l'arborescence créée la veille — le mode de défaillance
  d'INC-069 (deux décisions n° 180) transposé à un backlog où les numéros portent des dépendances
  d'ordre. **Le snooze devient `CRM-081`**, l'unité la moins référencée étant celle qu'on renumérote.
  `docs/MASTER_PLAN.md` cesse de borner le chunk 5 à `CRM-075` et de déclarer les propositions
  `CRM-P01` → `CRM-P12` en attente d'arbitrage, alors que la décision 299 les a toutes tranchées.
- **L'ordre de solde du registre est fixé** (décision 336) : les défauts réels d'abord — **INC-076**
  (un compte devenu indestructible dès qu'il a commenté, `500` sur toute base seedée), puis
  **INC-085/INC-075**, puis **INC-072** —, le lot documentaire ensuite. Il est le moins cher et ne
  répare rien.
- **INC-076 : constat, non clôture.** Le premier défaut que la décision 336 place en tête —
  « un compte devenu indestructible dès qu'il a commenté » — semble déjà corrigé depuis le
  **2026-08-09** par `CRM-022` (`author_id` nullable, `ON DELETE SET NULL`, prouvé par les
  assertions 5, 6, 81 à 83 de `supabase/tests/0023_identites_et_memberships_surs.test.sql`), deux
  jours avant que la décision 336 ne le classe encore comme non corrigé — probable conséquence
  d'INC-089, juste en dessous. La correction de `docs/BACKLOG.md` (`CRM-011`, le mot « cascade »
  était inexact) est faite ; la clôture ne l'est pas, faute de pile locale pour rejouer la preuve
  (décision 337).
- **INC-089 ouverte** : une exécution concurrente de la routine a committé, à 16h58 et sous son
  propre message, les cinq documents d'arbitrage écrits par une autre — les décisions 333 à 336 sont
  intactes dans `d7b35d5` mais introuvables par son message, qui traite de la résilience d'envoi de
  `CRM-059`. Aucun contenu n'est perdu ; c'est la traçabilité et l'atomicité du commit qui le sont.
  Même cause qu'INC-059 et que le point 1 d'INC-034 : la sérialisation de la routine, décidée le
  2026-08-08, est **hors dépôt** et n'est pas appliquée. Historique **non réécrit**, `CLAUDE.md` §13
  réservant ce geste à une instruction explicite.
- **INC-086 est arbitrée et close** : l'absence de toute surface d'administration des tracks et des
  channels, constatée par le responsable **en essayant le produit**, reçoit une unité dédiée —
  **`CRM-075`**, placée avant `CRM-076` dont elle est le préalable. Elle ne livrera **aucune règle
  d'accès** : le CRUD et ses droits existent en base depuis `CRM-020` et `CRM-021`.
- **INC-088 ouverte** : la fiche d'une affaire reste en lecture seule au nom d'INC-021, **close
  depuis `CRM-009`**. Le motif invoqué a disparu sans que la limite soit levée — un formulaire
  complet, validé et prouvé côté base, qu'aucun utilisateur ne peut remplir.

### Documentation

- **`CRM-059` est spécifiée avant d'être écrite** (`docs/SPEC-mail-subsystem.md` §20, décision 331),
  sur quatre mesures : `UID SEARCH SINCE` est honoré — le backfill est une sélection, pas un tri —,
  `IDLE` est annoncé mais ne sera pas employé, et `MAIL_SYNC_POLL_INTERVAL` est documentée depuis
  `CRM-051` sans que rien ne la lise.
- **La règle qui gouverne la reprise est écrite** : une panne se rejoue, un refus non. Le backoff —
  1, 4, 16, 64 minutes, puis échec définitif — ne s'applique qu'aux codes de transport.

### Documentation

- **`CRM-058` est spécifiée avant d'être écrite** (`docs/SPEC-mail-subsystem.md` §19, décision 330),
  sur quatre mesures faites contre le serveur réel : le `Message-ID` du produit est conservé, le
  `Reply-To` n'est vérifié par personne d'autre que nous, les en-têtes de fil passent tels quels, et
  un principal ne peut expédier que depuis ses propres adresses.
- **INC-087 est CLOSE** : `contact@p2enjoy.test` rejoint le principal de Driss dans le
  provisionnement, ce qui rend applicable la divergence entrant/sortant que le seed promettait
  depuis `CRM-053`. Vérifié : la soumission depuis cette adresse est désormais acceptée.

### Documentation

- **`CRM-057` est spécifiée avant d'être écrite** (`docs/SPEC-mail-subsystem.md` §18, décision 327).
  La question laissée ouverte par `CRM-054` — qui voit un message que personne n'a encore classé —
  est tranchée **sans notion nouvelle** : la visibilité d'un non classé est celle de la **boîte** où
  il a été vu, règle que `mail_message_occurrences` porte déjà. Un membre ordinaire n'en voit donc
  aucun, limite nommée et figée par une assertion à venir.
- **Un défaut de contrôle d'accès est documenté avant d'être corrigé** : `classify_message` ne
  vérifiait que le droit d'écriture sur la card cible. Avec un écran qui expose les identifiants de
  messages, un membre pourrait classer chez lui un message qu'il n'a pas le droit de lire, puis le
  lire. Le classement exigera **les deux** droits.
- **Le contrat de déploiement rattrape trois migrations** — 25, 26 et 27 — qui avaient été livrées
  sans y être décrites, avec leurs dépendances d'ordre et leurs retours arrière.
- `docs/DESIGN_SYSTEM.md` §5.4, `docs/SPEC-permissions-rls.md` §5, `docs/SCHEMA.md` §7 et
  `docs/SPEC-seed.md` §2.19 sont mis en cohérence dans le même changement.

### Ajouté

- **`CRM-059` — une coupure SMTP ne perd plus de message.** Le backoff est livré : 1, 4, 16, 64
  minutes, puis échec définitif. Il ne s'applique **qu'aux pannes de transport** — un mot de passe
  faux ou une adresse refusée passent en échec immédiatement, parce qu'attendre ne les rendra pas
  justes. Un envoi abandonné par un worker mort est repris au lieu de rester bloqué.
  Preuves : **13 tests** de la règle sans serveur, **14 assertions** pgTAP de ce que la base
  garantit, **2 scénarios `mail`** avec une coupure réelle — l'identité pointée vers un port fermé,
  puis rétablie.
- **`CRM-058` — le dos de l'envoi est livré, et l'aller-retour est prouvé de bout en bout.** Le
  produit met un message en file par sa garde, son worker le soumet réellement en SMTP authentifié,
  le destinataire le **reçoit dans sa boîte**, y répond à l'adresse que le produit a mise en
  `Reply-To`, et la relève ramène cette réponse **dans la même affaire**. Rien n'est simulé : un
  `Reply-To` faux rendrait ce scénario rouge.
  Un envoi réussi produit trois effets solidaires — file marquée, message archivé en `outbound`,
  timeline écrite —, et la timeline compte désormais **douze** types d'événements.
  Preuves : 1 scénario `mail` d'aller-retour complet, 10 tests de composition sans serveur.
- **Composer et répondre depuis l'écran** — par le **même chemin de code** depuis la card et
  depuis l'inbox, comme le §19.6 l'exige. Répondre pré-remplit le destinataire et l'objet, et cite
  le message parent : c'est ce dont le worker tirera `In-Reply-To` et la chaîne `References`. Un
  message non classé n'offre **pas** de réponse — sans affaire, il n'a pas d'adresse de retour, et
  l'écran propose le classement à la place plutôt qu'une action qui échouerait.
  L'écran annonce « mis en file », jamais « envoyé » : le worker n'a pas encore parlé.
- **Harnais dédié `scripts/verify-mail-envoi.sh`** : **43 contrôles, aucune anomalie**, témoin
  compris et **quatre** dégradations — dont le `Reply-To` remplacé par l'expéditeur, qui empêcherait
  toute réponse de revenir, et la chaîne `References` réduite à son dernier maillon.
- **`docs/manual.md` gagne le chapitre 4.16**, « Écrire et répondre », qui dit notamment pourquoi
  « mis en file » n'est pas « envoyé ».
- **Le quota journalier cesse d'être une promesse.** Il se compte sur la journée UTC, **en vol
  compris**, et se vérifie deux fois : à la mise en file par politesse, à l'envoi par autorité.
- **`CRM-057` — l'inbox globale est livrée.** Trois panneaux — dossiers, liste, message —, une
  **pile** sous 1024 px, une arborescence qui ne montre que ce qui porte du courrier, et
  « Non classés » toujours en tête, même à zéro. Un message classé se retrouve **des deux côtés** :
  dans son affaire et sous son dossier. Le fil d'une card nomme désormais le courrier reçu — objet
  et expéditeur — au lieu d'annoncer un événement sans détail.
  Preuves : `scripts/verify-mail-inbox.sh` **45/45**, **22 assertions** pgTAP, 9 scénarios d'API
  hors interface, 6 scénarios d'écran au clavier et à la souris, 27 tests du module, captures aux
  quatre paliers observées. Compteurs : 29 fichiers SQL, 1884 assertions, 478 `api`, 163 `ui`.
- **Le seed fait ARRIVER du courrier** : deux messages réellement soumis en SMTP authentifié puis
  relevés, l'un classé par la règle 1, l'autre laissé au tri. Aucune trace n'est fabriquée en base.
- **La pièce jointe saine devient téléchargeable**, et elle seule : `infected`, `pending` et
  `skipped` restent refusées à tous, l'anonyme sur les quatre.

### Sécurité

- **LA PREUVE DE REFUS N° 12 EST ACQUISE**, et l'inventaire de `docs/SPEC-permissions-rls.md` §7
  passe à « **onze acquises, une à moitié** ». Un membre n'emprunte pas l'identité de service du
  workspace, une administratrice n'emprunte pas l'identité personnelle d'un collègue, et la clé de
  service elle-même est refusée : un envoi part toujours au nom de quelqu'un. Mesuré hors interface.
- **La liste des adresses d'expédition ne propose plus ce que la garde refuserait.** Mesuré : la
  RLS ouvre la **lecture** des identités aux administrateurs sur tout le workspace — une règle de
  supervision, pas d'usage —, si bien que l'écran proposait à une administratrice d'expédier au nom
  d'un collègue, refusé au premier envoi. Le filtre est une aide d'interface ; la règle reste dans
  la garde.
- **Un refus ne doit pas ressembler à une panne** : `identity_not_available` portait d'abord
  `P0002`, que PostgREST traduit en **500**. Il porte désormais `42501`, donc `403` — un exploitant
  n'ira pas chercher un incident là où le produit a simplement dit non.
- **Un contournement du contrôle d'accès est fermé.** `classify_message` ne vérifiait que le droit
  d'écriture sur l'affaire de destination : un membre pouvait classer **chez lui** un message qu'il
  n'avait pas le droit de lire, puis le lire en toute légitimité. Le classement exige désormais les
  **deux** droits — voir le message, écrire dans l'affaire —, et le refus est mesuré hors interface
  avec un vrai jeton. Le défaut existait depuis `CRM-055` ; c'est la spécification de l'écran qui
  l'a mis en évidence.
- **Le HTML d'un expéditeur n'atteint jamais le DOM.** Le corps d'un message est réduit en texte —
  scripts et styles retirés avec leur contenu —, ce qui ferme l'exécution de scripts, le chargement
  d'images distantes et le pistage à l'ouverture. L'absence de rendu HTML est figée par des tests.
- **La preuve de refus n° 9 devient concluante.** Elle mesurait jusqu'ici l'impossibilité de
  télécharger des objets **jamais déposés** — vrai aussi d'un bucket vide. Quatre objets sont
  désormais réellement déposés, et la pièce saine sert de témoin.

### Corrigé

- **`daily_quota` valait zéro, donc interdisait tout envoi.** `CRM-053` l'avait créée
  `not null default 0` en écrivant qu'aucun consommateur n'existait ; dès qu'un consommateur a
  existé, ce zéro a interdit **tout** envoi à **toutes** les identités — mesuré au premier appel de
  la garde. `NULL` signifie désormais « aucun plafond », `0` garde son sens littéral, et les zéros
  jamais configurés sont convertis.
- **Trois défauts d'interface que seule l'observation pouvait montrer** (décision 328) : un bouton
  de flexbox qui refusait de rétrécir et débordait de son panneau en emportant son compteur hors de
  l'écran ; quatre classes d'espacement **inexistantes** — l'échelle du design system est fermée —
  qui disparaissaient sans erreur et donnaient trois panneaux de 1000 px ; une capture prise
  pendant la transition de la barre latérale.
- **Un refus de plus dans la console, retiré.** La timeline demandait les messages d'une card sur
  **toutes** les fiches, y compris sans session : chaque preuve d'interface anonyme y laissait un
  `401`. Elle ne les demande plus que si le fil porte réellement un courrier.
- **Le service journalisait un avertissement à chaque relève** dès qu'un dossier portait un
  caractère non ASCII (décision 329). La cause n'était pas le nom : c'est que l'arborescence était
  **recréée** à chaque passage, le serveur répondait « already exists », et la bibliothèque
  journalisait en tentant de décoder cette erreur en ASCII. La liste des dossiers est désormais lue
  avant toute création, et la souscription vérifiée séparément. Une erreur attendue à chaque
  passage finit par masquer celles qui ne le sont pas.
- **Une sonde IMAP qui ne savait pas encoder.** Le contrôle d'arborescence de `CRM-056` échouait
  dès qu'un dossier portait un caractère non ASCII : `imaplib` transmet le nom tel quel et le
  serveur l'attend en UTF-7 modifié. La sonde encode désormais comme la bibliothèque du produit.
- **Les types TypeScript versionnés rattrapent deux fonctions** livrées par `CRM-056` sans
  régénération. L'assertion qui fige la liste des fonctions exposées a joué — avec un chunk de
  retard, `scripts/verify-types.sh` n'appartenant pas au harnais global.

### Documentation

- `docs/manual.md` gagne le chapitre **4.15**, « L'inbox : lire et trier le courrier reçu ».
- **INC-087 ouvert** : l'identité sortante seedée expédie depuis une adresse que le serveur de
  développement refuse au principal qui l'authentifie — mesuré. La correction appartient à
  `CRM-058`, qui soumettra réellement du courrier.

- **`CRM-056` tient ses trois preuves.** L'arborescence est vérifiée par un **client IMAP tiers**
  qui décode lui-même l'UTF-7 modifié, **observée dans Roundcube** avec ses vrais noms, et le
  renommage d'un track y déplace les trois niveaux d'un seul `RENAME`. Le message est **copié** et
  reste dans `INBOX`.
  Preuves : `scripts/verify-mail-dossiers.sh` **37/37**, **18 assertions** pgTAP, 3 scénarios
  `mail`, 2 captures observées. Compteurs : 28 fichiers SQL, 1861 assertions, 38 `mail`.

### Corrigé

- **Les dossiers créés étaient invisibles pour l'utilisateur.** Un client de messagerie n'affiche
  que les dossiers **souscrits** : l'arborescence existait côté serveur, l'API la voyait, et
  personne ne la voyait à l'écran. `SUBSCRIBE` suit désormais chaque création et chaque renommage.
  Défaut trouvé par l'observation visuelle, et par elle seule (décision 326).

### Corrigé

- **Le redémarrage de la pile était cassé, et c'était bloquant.** Le `migrations-runner` rejoue tout
  le répertoire à chaque démarrage ; les migrations 17 et 20 rétrécissaient le vocabulaire de
  `card_events`, et l'arrivée de `mail_received` les faisait échouer en `23514` — PostgREST
  n'aurait jamais démarré. Leur convergence ne s'applique plus que si le type qu'elles introduisent
  est absent. Deux migrations se disputaient en outre la signature d'une fonction ; une seule la
  déclare désormais (décision 325).

- **`CRM-056` avance : les messages sont rangés dans une arborescence IMAP réelle.**
  `mail_folder_map`, l'assainissement des noms, le chemin `CRM/<Track>/<Channel>/<Card>` et la
  création paresseuse sont livrés ; un vrai email a créé
  `CRM/Conseil & IA/Grands comptes/Audit sécurité applicative`. Le message est **copié**, jamais
  déplacé : retirer un message de la boîte de quelqu'un serait destructif. Un serveur à labels
  (Gmail) écarte le modèle de dossiers. Restent dus le renommage propagé et l'observation dans
  Roundcube, que la Definition of Done exige.
- **Une mesure a été corrigée par la suivante, et les deux sont écrites** : lu avec `imaplib`, un
  nom de dossier revient ré-encodé ; lu avec la bibliothèque que le produit emploie, il revient
  intact. Une sonde doit parler la même langue que le code (décision 324).

- **`CRM-055` est livrée : un email adressé à une card y est classé tout seul.** Les règles 1, 2
  et 4 du §4.4 sont en base, arrêtées à la première satisfaite. Une adresse se reconnaît à sa
  **forme et à son domaine**, et une card archivée ne reçoit pas — la filiation ne contourne pas
  ce refus. Le classement manuel exige le droit d'**écriture**, journalise son auteur, écrit une
  trace dans la timeline, et reste idempotent.
- **La règle 3 est désactivée**, comme la Definition of Done le prévoit : elle suppose des
  contacts. Son absence est figée par une assertion qui devra tomber à `CRM-060`.
  Preuves : `scripts/verify-mail-classement.sh` **22/22**, **20 assertions** pgTAP, **3 scénarios**
  d'API, un vrai email classé automatiquement. Compteurs : 27 fichiers SQL, 1843 assertions,
  469 scénarios d'API, 35 `mail`.

### Corrigé

- **Deux preuves se croyaient propres** : elles retiraient l'événement de timeline qu'elles avaient
  créé, alors que `card_events` n'accorde aucune écriture à personne. Le refus était silencieux, et
  le scénario croyait nettoyer ce qu'il laissait derrière lui.
- **Un harnais mourait en silence** : une dégradation impossible à appliquer le faisait s'arrêter
  sous `set -e`, au milieu de sa section la plus importante. Elle est désormais rapportée.

- **`CRM-054` est livrée : un email réellement envoyé est relevé, dédoublonné, et ses pièces
  jointes analysées.** Les trois tables de l'ingestion naissent avec leur bucket **privé**, et
  aucune écriture n'est ouverte au client : un message est un fait reçu. La relève est
  **idempotente** — rejouée, elle n'ajoute rien —, une pièce EICAR est détectée `infected` par le
  vrai ClamAV, un PDF déclaré générique est typé **par son contenu**, et `../rapport.pdf` est
  assaini sans que le nom d'origine soit perdu.
- **La preuve de refus n° 9 est ACQUISE** : une pièce `infected` et une pièce `pending` ne se
  téléchargent ni anonymement, ni avec le jeton de l'administratrice. L'inventaire de couverture
  passe à « dix acquises, une à moitié, une absente ».
  Preuves : `scripts/verify-mail-ingestion.sh` **35/35** dont six dégradations, **26 assertions**
  pgTAP, **4 scénarios** d'API, **2 scénarios** `mail` dont un email réellement envoyé, `pytest`
  **114**. Compteurs globaux : 26 fichiers SQL, 1823 assertions, 466 scénarios d'API, 34 `mail`.

### Corrigé

- **Une relève rejouée échouait** : `Prefer: resolution=ignore-duplicates` ne s'applique pas sans
  le paramètre `on_conflict`, et PostgREST rendait un `409`.
- **Un faux serveur de preuve rendait un verdict faux une fois sur trois** : il lisait le flux par
  un unique `recv` puis fermait, et le client recevait un `BrokenPipeError` en poursuivant son
  envoi. Un test qui échoue une fois sur trois est pire qu'un test absent.

- **`CRM-054` est spécifiée avant d'être écrite** : `docs/SPEC-mail-subsystem.md` §15, et une
  mesure y change le produit — un message externe soumis **sans authentification** est classé dans
  `Junk Mail`, pas dans `INBOX`. Un worker aveugle à ce dossier ne verrait jamais arriver un vrai
  message. Le seed surveillera les deux dossiers ; le défaut de la colonne reste `{INBOX}`, et le
  filtre anti-spam n'est pas désactivé pour faire plaisir aux preuves (décision 320).

- **`CRM-053` est livrée : une adresse d'expédition se déclare, et la connexion SMTP est
  réellement essayée.** `mail_outbound_identities` naît jumelle de la table des comptes entrants —
  mêmes politiques, mêmes privilèges, même chemin vers Vault, même catalogue de codes. Le seed
  démontre enfin le cas d'usage promis depuis le socle documentaire : Driss reçoit sur `bizdev@`
  et expédie depuis `contact@`.
- **Une identité par défaut existe toujours, et en déclarer une nouvelle DÉPLACE la marque** au
  lieu d'exiger qu'on retire l'ancienne. L'adresse d'expédition est vérifiée à l'enregistrement :
  c'est la seule donnée que le destinataire verra.
- **La preuve de refus n° 7 est désormais ENTIÈRE**, et la n° 6 porte ses deux tables. L'inventaire
  de couverture passe à « neuf acquises, une à moitié, deux absentes ».
  Preuves : `scripts/verify-mail-outbound.sh` **51/51** dont huit dégradations, **38 assertions**
  pgTAP, **7 scénarios** d'API, **5 scénarios** SMTP réels, `pytest` **83**. Compteurs globaux :
  25 fichiers SQL, 1797 assertions, 463 scénarios d'API, 32 scénarios `mail`.
- **`docs/manual.md` chapitre 4.13** : recevoir et expédier sont deux choses distinctes, et le
  quota déclaré n'est appliqué par rien tant que l'envoi n'est pas livré.

### Corrigé

- **Un invariant arrivait après son gardien** : le trigger qui rabat l'identité par défaut était
  `AFTER`, si bien que l'index unique refusait la seconde identité avant tout rabattement. Il est
  `BEFORE`, et une assertion lit son type pour que la régression soit visible.

- **`CRM-053` est spécifiée avant d'être écrite** : `docs/SPEC-mail-subsystem.md` §14, et une
  mesure y change le contrat — Stalwart applique un **délai de pénalité de dix secondes** sur un
  échec d'authentification SMTP, si bien qu'un test réglé sur dix secondes rapporterait un mot de
  passe faux comme un `timeout`. Le diagnostic mentirait. Le test SMTP emploie trente secondes,
  dans une variable distincte de celle d'IMAP (décision 318).

- **`CRM-052` est livrée : une boîte de réception se déclare, son mot de passe est chiffré, et la
  connexion est RÉELLEMENT essayée.** `mail_inbound_accounts` naît avec ses deux index uniques
  partiels — un catch-all par espace, une boîte par personne —, deux politiques de lecture et
  aucune écriture directe : le seul chemin correct est une fonction qui met le mot de passe dans
  Vault au lieu de la table. `secret_id` est **révoquée en lecture** à toute personne connectée,
  administrateur compris ; seul `mail-sync` déchiffre, par une fonction réservée à `service_role`.
- **Le service ouvre une vraie session IMAP et écrit son verdict.**
  `POST /internal/v1/inbound-accounts/{id}/test` lit le compte, déchiffre, se connecte, liste les
  dossiers, et enregistre `status`, `last_error` et `last_checked_at`. `last_error` porte un
  **code stable**, jamais la phrase du serveur distant — laquelle peut contenir l'identifiant
  essayé ou une adresse interne, et finirait affichée puis capturée.
- **Les preuves de refus n° 6 et n° 7 sont ACQUISES**, après avoir été figées comme non
  satisfaisables depuis `CRM-013` et `CRM-014`. Les sept assertions qui figeaient l'absence sont
  **retournées, non retirées**, et l'inventaire de couverture passe de « sept acquises, quatre
  absentes » à « huit acquises, deux à moitié, deux absentes ».
  Preuves : `scripts/verify-mail-inbound.sh` **47/47** dont sept dégradations, **60 assertions**
  pgTAP dédiées, **11 scénarios** d'API avec les jetons réels, **6 scénarios** `mail` sans aucune
  substitution, `pytest mail-sync/tests` **70**. Compteurs globaux : 24 fichiers SQL, 1759
  assertions, 456 scénarios d'API, 27 scénarios `mail`.
- **`docs/manual.md` chapitre 4.12**, écrit d'après le produit réellement exécuté : ce que le
  produit garantit sur un mot de passe, qui voit quelle boîte, les six causes d'échec en français,
  et le fait qu'aucun écran ne permet encore de déclarer une boîte.

### Corrigé

- **Une borne de tableau ne bornait rien** : `array_length('{}', 1)` rend NULL, et un `check` qui
  vaut NULL est réputé satisfait — un compte pouvait donc ne surveiller aucun dossier.
- **Recréer une boîte supprimée échouait** : le nom d'un secret Vault est unique, et le secret
  orphelin bloquait la création suivante avec un `23505` inexplicable. Il est désormais repris.
- **La section de non-complaisance d'un harnais pouvait rendre six faux verts** : une suite déjà
  rouge fait passer chaque dégradation pour « vue ». Un témoin exige maintenant que la suite soit
  verte avant la première dégradation.
- **`scripts/verify-mail-sync.sh` lançait son conteneur de profil `prod` sans les deux variables
  devenues obligatoires**, et trois de ses contrôles échouaient pour une raison qui ne les
  regardait pas. Le harnais de `CRM-051` a dénoncé le changement de `CRM-052` ; la révision se
  fait dans le même changement que la cause.

- **`CRM-052` est spécifiée avant d'être écrite** : `docs/SPEC-mail-subsystem.md` §13, dix
  sous-chapitres opposables rédigés **après mesure** sur la pile réelle — Vault refusé à
  `authenticated` dès le schéma, `service_role` seul à pouvoir déchiffrer, et six comportements du
  vrai Stalwart, dont le fait qu'un mot de passe faux et un compte inconnu rendent le même refus.
  `docs/SCHEMA.md` §12 gagne `last_checked_at` et ses deux index uniques partiels,
  `docs/PROD_MIGRATIONS.md` sa migration 22, `docs/DAT.md` §3.3 le contrat d'accès aux secrets, et
  `docs/JOURNAL.md` la décision 316. Aucune ligne de code n'accompagne ce changement : c'est le
  contrat que l'implémentation devra respecter.

- **`CRM-043` est terminée : « Modifier » et « Supprimer » sont enfin offerts par le fil.** L'écart
  tenait à une cause nommée — reconnaître *ses* commentaires suppose une session, donc INC-021 —,
  et cette cause a disparu avec `CRM-009`. Les deux boutons tertiaires apparaissent au survol **et
  au focus clavier**, la correction ouvre un champ qui reçoit le focus curseur **en fin de texte**,
  et la suppression demande une confirmation qui nomme l'irréversible dans le libellé de son
  action. Une ligne déjà supprimée n'offre plus rien : le trigger refuserait.
- **La comparaison à l'identifiant de session n'est pas un contrôle d'accès.** Elle évite d'offrir
  un geste voué au refus ; la règle reste tenue par la politique `UPDATE`. Le cas où l'écran se
  trompe est **affiché** : un `PATCH` filtré rend `200` et zéro ligne, et l'écran le dit au lieu de
  montrer une modification qui n'a pas eu lieu.
  Preuves : `scripts/verify-commentaires.sh` **71/71**, `e2e/ui/commentaires-gestes.spec.ts`
  **5 scénarios sans aucune substitution** — session réelle, écriture par l'écran, relecture par
  l'API —, `npm run test:unit` **585**, et cinq captures nouvelles observées une à une.

### Corrigé

- **Le fil se vidait entièrement le temps d'une relecture, et une capture seule le montrait.**
  Après une publication, une correction ou une suppression, `recharger()` rejouait tout l'effet :
  état de chargement, canal de temps réel retiré puis recréé. Toute la conversation disparaissait
  une seconde, et une reconnexion était payée à chaque écriture. La relecture ne touche plus au
  canal, et l'état de chargement n'est posé que lorsqu'il n'y a rien à montrer (décision 315).
- **Un commentaire supprimé pouvait réapparaître.** Deux lectures en vol revenaient dans le
  désordre et la plus ancienne écrasait la plus récente. Le rang de garde est désormais pris **par
  lecture** et non par abonnement.
- **Publier au clavier renvoyait l'utilisateur en haut de la page.** « Publier » devient désactivé
  dès que le brouillon est vidé, et le navigateur rendait alors le focus au `body`. Le champ de
  composition le reçoit désormais, prêt pour le message suivant ; sur un refus, en revanche, le
  focus ne bouge pas — l'éloigner du message d'erreur serait pire.
- **Une preuve clavier verte montrait un bouton sans anneau de focus.** Elle atteignait la cible
  par `focus()`, que Chromium ne considère pas comme un focus visible ; elle presse `Shift+Tab`.
- **Un échec de `scripts/verify-commentaires.sh` était illisible** : le journal cité était effacé
  par le `trap` du script lui-même. Les journaux d'échec survivent sous `e2e/output/` et leurs
  dernières lignes sont imprimées.
- **Le compteur `SCENARIOS_UI` du harnais global était resté en arrière** : 145 attendus, 152
  livrés — sept scénarios de droits fins ajoutés sans révision dans le même changement. Porté à
  **157** avec les cinq scénarios de cette livraison. `SCENARIOS_MAIL` souffrait du même mal —
  16 attendus, 21 livrés par `CRM-051` — et passe à **21** : le harnais global était rouge par
  construction.
- **`npm run test:unit` échouait au hasard** : le délai par défaut de Vitest, 5 s, était atteint
  sous la charge de la pile Docker par un rendu qui coûte 0,1 s à vide. Le plafond passe à 20 s,
  sans qu'aucune assertion soit assouplie.

### Ajouté

- **`CRM-051` est livrée : le service `mail-sync` existe, tourne et se prouve.** Le conteneur est
  déclaré dans l'assemblage **commun**, donc identique en développement et en production : image
  `python:3.13.13-slim-bookworm` épinglée, utilisateur `10001` non privilégié, racine en lecture
  seule, capacités Linux retirées, `no-new-privileges`, **aucun port publié** et volume nommé pour
  le seul état opérationnel. `./runDev.sh` amorce son jeton — y compris sur un `.env` antérieur à
  l'unité — et `./runDev.sh --withLog mail-sync` suit réellement ses journaux.
  Preuves : `pytest mail-sync/tests` **40/40**, `scripts/verify-mail-sync.sh --contre-epreuve`
  **64/64**, `npm run e2e:mail` **21/21**. La reprise est prouvée sur le vrai conteneur — un UUID
  écrit par l'API interne survit à `stop`/`start`, `boot_count` passe de *n* à *n+1* et `boot_id`
  change. Les workers IMAP et SMTP annoncent `waiting_for_configuration` : l'unité ne simule
  aucune synchronisation.
- **Un refus de configuration ne peut plus publier le secret qu'il refuse.** `ValidationError`
  reproduit la valeur fautive dans son texte **et** sur `__context__` ; le chargement passe donc
  par `load_settings`, qui ne conserve que le nom de la variable et la règle, et lève son refus
  hors du gestionnaire d'exception. Le processus rend `78` après une unique ligne `CRITICAL`,
  sans ouvrir de socket ni créer d'état (décision 313).
- **`CRM-005` est terminée : le cul-de-sac du workflow par défaut est comblé.** La transition
  `Réalisation en cours → Perdu` est déclarée, avec commentaire exigé comme les quatre autres
  sorties vers Perdu — INC-003 close. Le graphe passe de dix à **onze** arêtes, la copie dérivée
  l'hérite, et il a été **relu en entier** : seules `Livré` et `Perdu` n'ont pas de sortie, et les
  deux sont justifiées par leur issue.
- **Douze preuves figeaient l'ABSENCE de cette transition et vérifient désormais sa PRÉSENCE.**
  `scripts/verify-workflows.sh` prouvait en permanence que « le point ouvert n° 1 est tenu » : une
  absence prouvée ne se distingue plus d'une règle, et c'est ce qui rendait l'oubli durable. Quatre
  harnais, trois suites Playwright, une fixture pgTAP et quatre paragraphes de spécification sont
  retournés (décision 314).
- **`CRM-012` obtient enfin sa preuve d'interface, neuf unités après l'avoir nommée comme
  manquante.** INC-021 bloquait toute vérification visuelle des droits fins : sans écran de
  connexion, la webapp restait anonyme, et un droit fin est invisible à qui n'a déjà aucun accès.
  INC-021 étant close depuis `CRM-009`, `e2e/ui/droits-fins.spec.ts` livre **7 scénarios verts** :
  Farida Nowak, connectée au clavier, ne voit pas le track que son droit fin ferme ; Camille Aubert
  **porte la même ligne `access = 'none'`** et voit pourtant les quatre tracks. Saisir l'adresse du
  track fermé rend « Track introuvable », sans révéler qu'il existe. Six captures observées, dont
  les quatre paliers.
- **Deux limites de `CRM-012` étaient périmées et sont levées** : `app.can_read_card` a été livrée
  par `CRM-040`, et les politiques des tables d'identité par `CRM-022`. Il ne reste que la preuve
  de refus n° 7, qui attend `mail_inbound_accounts` en `CRM-052`.
- **INC-085 est ouverte, et c'est cette preuve d'interface qui l'a trouvée.** Un droit fin de
  channel **accordé** sous un track fermé est rendu par l'API mais inatteignable à l'écran : la
  barre d'onglets ne liste les channels qu'une fois un track ouvert. Un droit **retiré** est
  correctement observable, un droit **accordé** ne l'est pas. Ni défaut de RLS, ni masquage : une
  surface manquante. Consignée avec ses trois options, non résolue.
- **`./runDev.sh` rappelle les identifiants de développement au démarrage.** Les trois comptes
  seedés et leur mot de passe commun, les trois boîtes mail, puis l'administration de PostgreSQL,
  Stalwart, MinIO et de l'API interne de `mail-sync`. Le mot de passe des comptes est lu dans
  `supabase/seed/apply-seed.sh` — seule source de vérité, jamais recopiée. Le rendu vit dans
  `scripts/lib/env.sh` afin d'être prouvé **sans démarrer la pile** : `scripts/verify-scripts.sh`
  passe de **84** à **104** contrôles.
- **Un `.env` amorcé avant une unité n'est plus un cul-de-sac.** `env_ensure_dev_completions`
  complète les variables introduites depuis : secret connu tiré au hasard, défaut du gabarit
  recopié, valeur `CHANGE_ME_` laissée à l'humain. Une valeur déjà renseignée n'est jamais
  réécrite.

- **`CRM-051` possédait son contrat stable avant code.** `mail-sync` est un service Python commun,
  non publié et sans clé `service_role` tant qu'il ne consomme aucune donnée. Santé minimale,
  statut Bearer, checkpoint strictement dev, état opérationnel atomique et journaux JSONL bornent
  une preuve réelle d'arrêt/redémarrage. Python 3.13.13, FastAPI 0.139.2, Uvicorn 0.51.0 et
  Starlette 1.3.1, Pydantic Settings 2.14.2 sont épinglés. IMAPClient 3.1.0 est choisi pour les futures unités
  IMAP mais n'est pas installé avant son premier usage. La preuve API emploie HTTPX2 2.7.0,
  exigé par le TestClient. Starlette 1.6.0, publiée le 8 août, se bloque elle aussi sur le lifespan
  dans cet environnement ; la dernière 1.3.1 éprouvée entre et sort correctement.
- **INC-080 est close et `CRM-050` est entièrement terminée.** Les harnais historiques restaurent
  désormais les migrations par le runner complet et synchrone, jamais par une liste de suffixes.
  Les dix preuves qui avaient révélé l'interférence passent sur la même pile : migrations
  **25/25**, authz **35/35**, cards **46/46**, board **56/56**, refus **21/21**, commentaires
  **46/46**, liste **54/54**, formulaire **27/27**, webapp **42/42** et seed **69/69**. La campagne
  qui suit reste verte à **1698 SQL**, **444 API** et **145 UI**, console Chromium silencieuse.
  L'infrastructure mail est simultanément reprouvée **84/84**, sa contre-épreuve produit les
  **6 anomalies** attendues et les **16** parcours mail réels passent. Le méta-harnais final rend
  **28/28**, rapport HTTP réel et restauration SQL/API compris.
- **INC-061 est close sans affaiblir les comptes du seed.** Le harnais cards retire désormais son
  jeu d'essai avant SQL/API/UI et mesure l'absence de résidu. Sa première campagne complète a
  reproduit les deux faux rouges historiques ; la seconde rend **46/46**, dont **1698 SQL**,
  **444 API** et **145 UI** avec console stricte.
- **`CRM-022` livre les identités d'équipe et les memberships sûrs.** Sept politiques rendent au
  membre son workspace, ses appartenances et les profils de ses collègues ; seul l'admin gère les
  rôles, et une contrainte différable protège le dernier administrateur jusque dans le cas zéro
  membre. Le profil propre n'expose que nom/avatar. La suppression d'un compte conserve sa parole
  par `ON DELETE SET NULL`. En-tête, board, liste, commentaires et timeline rendent noms et avatars
  par relations embarquées, sans UUID ni requête par ligne. Preuves : pgTAP dédié **84/84**, API
  **5/5** plus **2/2** refus dernier admin, UI réelle avec quatre captures et console silencieuse,
  harnais ciblé **23/23** après sept dégradations ; campagne globale **23 fichiers / 1698
  assertions**, **444 API**, **145 UI**, **16 mail**, **564 unitaires**, quatre compilations et
  méta-harnais **28/28**. Invitation et écran d'administration restent à `CRM-070`.
- **Le méta-harnais ne dépend plus d'un ancien plan pgTAP ni d'un arbre Git propre.** Ses
  dégradations trouvent structurellement `plan(N)` et sa restauration compare au snapshot reçu.
  Le défaut découvert sur CRM022 faisait passer à tort plan tronqué et erreur SQL sans les avoir
  injectés ; les six contre-épreuves mordent de nouveau avant restauration complète.
- **`CRM-019` livre le remappage atomique du workflow d'un channel entier.**
  `change_channel_workflow(channel_id, workflow_id, step_mapping, discard_field_values)` reçoit un
  tableau JSON dont les sources doivent égaler exactement les étapes occupées, accepte les
  regroupements plusieurs-vers-une, inclut les cards archivées et en corbeille et refuse toute
  perte de réponse sans opt-in. La migration 20 rend la clé composite différable mais initialement
  immédiate ; la RPC seule la diffère, verrouille le lot, remappe toutes les cards et force la FK
  avant de rendre. Chaque card écrit un unique `workflow_changed`, distinct de `moved` et
  `channel_changed`. La timeline ferme INC-077 selon la décision 298 : « Dossier changé » et
  « Workflow modifié » vivent dans la famille « Organisation ». Preuves froides : suite dédiée
  **59/59**, API **14/14**, harnais **23/23** avec course réelle et six dégradations ; global
  **22 fichiers / 1612 assertions**, **439 API**, **144 UI** à console stricte, **16 mail**,
  **532 unitaires**, quatre compilations, méta-harnais **28/28** et pile **55/55**.
- **`CRM-018` remplace le tableau de champs exigés par une relation à deux clés étrangères.**
  `workflow_transition_required_fields (transition_id, field_id)` garantit les deux parents, leur
  appartenance au même workflow et les deux suppressions en cascade. La migration 19 reprend les
  anciens tableaux effectifs, refuse les UUID morts et les croisements de workspace, recense puis
  écarte les anciennes exigences dérivées inertes. `move_card`, `copy_workflow_to_track`, le seed,
  les types attendus et les preuves historiques sont révisés ensemble. La copie remappe aussi
  les sept champs, les quinze règles et l'exigence, puis conserve l'empreinte SHA-256 canonique de
  la source afin de détecter jusqu'à ses suppressions. Le seed exerce les champs dérivés et porte
  désormais 21 valeurs sur 11 cards. Preuve froide : 21 fichiers / 1553 assertions pgTAP, 425
  scénarios API, 144 UI à console stricte, 16 mail, 531 unitaires et quatre compilations. Une copie
  utilisateur supplémentaire n'est plus supprimée au nom de la convergence : les états ambigus
  sont refusés. La reprise exceptionnelle d'une ancienne fixture refuse également de cascader une
  timeline utilisateur : seule l'absence d'événement ou l'unique `created` technique sans acteur
  autorise la reconstruction.
- **La preuve anonyme exhaustive cesse d'oublier des tables métier.** `card_comments`,
  `card_events` et la nouvelle liaison rejoignent l'inventaire : quinze tables seedées sont
  d'abord constatées non vides par la clé de service, puis rendues `200` / `[]` à l'anonyme. Le
  harnais associé passe à 52 assertions, 40 scénarios et 48 politiques nommées ; son ancien compte
  de neuf cards est également ramené aux quatorze du seed courant.
- **`CRM-017` porte l'ordonnancement applicatif dans `pg_cron`.** La migration 18 installe le
  heartbeat privé, ferme schéma, relations et fonction aux rôles API, et converge vers un unique
  job nommé sans changer son `jobid`. La suite dédiée compte 48 assertions et le harnais éprouve
  passage réel, réparation et ACL. Après reset froid, le harnais ciblé rend 14/14 et la campagne
  globale 1553 SQL, 425 API, 144 UI à console stricte, 16 mail et 531 unitaires ; l'unité est close.

- **`CRM-016` livre les fonctions edge de bout en bout.** Le service commun `functions` épingle
  Supabase Edge Runtime 1.74.2, monte `supabase/functions/` en lecture seule, ne publie aucun port
  et crée un worker `oneshot` borné pour chaque invocation. Kong protège
  `/functions/v1/`, recharge sa configuration grâce à une révision déclarative et exécute la
  fonction sans effet `example` avec le JSON exact. Le routeur refuse les noms invalides ou
  absents, ne transmet que les trois variables Supabase nécessaires et ne reçoit jamais
  `JWT_SECRET`. Après remise à zéro froide : Edge **13/13**, pile **55/55**, scripts **80/80**,
  harnais global **28/28** — 19 fichiers / 1405 assertions pgTAP, **416 API**, **144 UI** sans
  avertissement, **16 mail**, **531 Vitest**, quatre compilations et rapport HTTP 200. La relecture
  différée des journaux reste vide ; seed et captures sont inchangés. INC-007 est close.
- **Le déplacement connecté attend désormais son succès backend avant la relecture.** Le board
  place la card optimistement ; le parcours Chromium pouvait donc interroger PostgREST avant le
  retour de `move_card` et produire un faux rouge. Il attend maintenant la région live « Affaire
  déplacée » que l'utilisateur reçoit seulement après la réponse réelle. Le scénario ciblé puis
  les **144 parcours UI** complets passent avec console stricte.

- **`CRM-015` livre le secret de build npm facultatif.** `NPM_CA_FILE` est un chemin PEM absolu
  fourni par l'environnement, validé avant Docker et transporté comme secret BuildKit vers
  `npm_ca`; absent, vide ou omis d'un ancien `.env`, `/dev/null` rend l'assemblage inerte. Deux
  builds sans cache exercent les branches active et inactive ; l'image finale ne contient ni
  secret, ni `cafile`, ni `.npmrc` non vide. `./runDev.sh` aboutit réellement dans les deux
  configurations. Preuves : scripts **80/80**, pile **50/50**, webapp **42/42**, harnais **28/28**
  dont UI **144/144** sans avertissement. Aucun certificat versionné, aucune opération de
  production ; INC-032 et INC-042 sont closes.

- **`CRM-008` est close sur une base froide et depuis le vrai shell WSL.** Le harnais refuse
  désormais `npm.exe`, résout Node **v24.14.1** / npm **11.11.0** dans les installations NVM
  locales avant toute mutation et éprouve ce choix dans quatre environnements isolés. La garde
  couvre désormais les **22 harnais** Node/npm autonomes, preuve statique comprise (**5/5**).
  Son résumé SQL n'affiche plus trois fichiers en dur : il extrait et vérifie **19 fichiers / 1405
  assertions**. La publication réelle attend son annonce de succès avant la relecture API, et
  Playwright ne produit plus le conflit `NO_COLOR` / `FORCE_COLOR`. Rejeu complet : **28/28**, API
  **410**, UI Chromium **144** avec console navigateur et sortie sans avertissement, erreur ni
  `pageerror`, mail **16**, Vitest **525**, quatre compilations et rapport HTTP **200**, puis état
  SQL et RLS restauré. INC-083 et INC-084 sont closes.

- **`CRM-009` est livrée de bout en bout.** Quatre gabarits transactionnels français sont servis
  à GoTrue par le Caddy interne commun `auth-templates`; invitation et récupération sont validées
  sur leur contenu SMTP réel, et un repli anglais provoqué est explicitement refusé. Le parcours
  destinataire ouvre Inbucket dans Chromium, lit et clique l'action réellement contrastée, puis
  constate la session GoTrue dans `sessionStorage`, l'URL nettoyée et `localStorage` vide. Preuves :
  `verify-auth` **62/62**, suite d'authentification **8/8**, suite UI complète **144/144**, console
  sans avertissement, erreur ni `pageerror`. INC-016 est close.
- **Le service de gabarits est inclus dans la santé de la pile.** `verify-stack.sh` contrôle
  désormais exhaustivement les 16 services persistants, les 3 tâches one-shot et les 10 services
  réservés au développement : **50/50**. La garde de lancement refuse aussi avant Docker toute
  divergence entre `SITE_URL`, l'origine Vite réellement publiée et les redirections autorisées ;
  `verify-scripts.sh` rend **61/61**.
- **Un favicon SVG de marque est servi explicitement.** La requête implicite et bruyante de
  Chromium vers `/favicon.ico` disparaît ; le build reste en quatre chunks (maximum 477,86 kB),
  les **525 tests unitaires** et les **144 scénarios UI** passent.

- **Les décisions du responsable restées hors de `main` sont réinsérées** — les dix-huit entrées
  que la branche `claude/happy-goldberg-qt5vfi` retenait seule, dont cinq arbitrages explicites,
  reprennent leur place dans `docs/JOURNAL.md` sous les numéros 249 à 266, texte inchangé. La
  renumérotation était contrainte : les deux lignes avaient donné les numéros 235 à 252 à des
  sujets différents. La correspondance vit dans `docs/ARBITRAGES.md` (fusionnée depuis l'ancien
  `docs/ARBITRAGES_RECUPERES.md` le 2026-08-15). Depuis cette récupération, les fonctions edge sont closes et les mises en œuvre
  `pg_cron` / table de liaison étaient écrites mais attendaient leur preuve froide ;
  `change_channel_workflow` restait alors à livrer. Ces trois suites sont désormais closes dans
  les entrées `CRM-017` à `CRM-019` ci-dessus.

- **Passe de cohérence : les décisions du responsable sont propagées dans tout le documentaire** —
  six unités créées (`CRM-009`, `CRM-015` à `CRM-019`), `CRM-031` et `CRM-035` **rouvertes**,
  `CRM-051` amputée de son `scheduler`. `docs/MASTER_PLAN.md` insère `CRM-009` entre `CRM-007` et
  `CRM-008` ; `docs/DAT.md` passe à `pg_cron` et accueille `edge-runtime` ; `docs/SCHEMA.md` §9
  nomme `change_channel_workflow` et §3 la table de liaison décidée ; `docs/SPEC-auth.md` §4.1 et
  `docs/PROD_MIGRATIONS.md` §7 encadrent le chemin d'administration de GoTrue ; `README.md` §10,
  `docs/manual.md` chapitre 17 et `.env.example` sont alignés. Seize entrées du registre reçoivent
  leur arbitrage et INC-005 est close. **Aucune ligne de code n'est modifiée** : les mises en œuvre
  décidées restent dues, chacune rattachée à son unité.

### Corrigé

- **`scripts/verify-commentaires.sh` échouait sur tout hôte où Playwright résout son navigateur.**
  Il imposait `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` **par défaut**, un chemin propre
  à un seul environnement ; la variable redevient une porte que l'hôte ouvre, comme
  `e2e/playwright.config.ts` le documente. Il exigeait en outre **1250** assertions pgTAP globales,
  chiffre que toute unité ultérieure dément : c'est désormais un plancher, le compte propre à
  l'unité restant exigé à l'exactitude.

- **Le socle `mail-sync` n'ajoute plus de lifespan applicatif**, conformément à
  `docs/SPEC-mail-subsystem.md` §12.3, que le code ne suivait pas encore. Le motif invoqué par la
  décision 312 — un blocage de `TestClient` sous Starlette 1.3.1 — **ne se reproduit pas** : mesuré,
  une application munie d'un lifespan entre et sort en 23 ms. Le motif retenu est celui qui tient
  seul : aucune ressource asynchrone n'est ouverte par cette unité. L'état est donc ouvert dans
  `create_app`, avant l'écoute ; `ready` est vrai, ou l'application n'existe pas (décision 313).
- **Deux preuves du service se contredisaient et l'une ne pouvait pas passer.** Le contrôle
  d'en-têtes exigeait à la fois que `X-Request-ID` reprenne l'identifiant fourni par l'appelant et
  qu'il soit un UUID. Seuls les appels sans identifiant en reçoivent un.

- **INC-023 est arbitrée : chaque harnais naît avec son sujet.** Le responsable retient l'option 2
  (décision 277) : `CRM-008` couvre les commandes exécutables de son périmètre ;
  `pytest mail-sync/tests` appartient exclusivement à `CRM-051`. `e2e:mail`, déjà réel depuis
  `CRM-050`, reste la preuve des protocoles ; l'aller-retour du produit reste dû par `CRM-054` et
  `CRM-058`. Aucun projet vide n'est créé et aucune preuve n'est comptée deux fois.

- **`CRM-002` est de nouveau close : la garde de ports n'a plus d'angle mort sur un Linux
  minimal.** Après `ss` puis `netstat`, elle lit `/proc/net/tcp` et `/proc/net/tcp6`, convertit les
  ports hexadécimaux sans extension awk et ne retient que `LISTEN`. La preuve force ce chemin,
  retrouve une socket réellement ouverte puis ne retrouve plus son port après fermeture :
  `verify-scripts.sh` **64/64**. INC-044 est close.

- **Le parcours de connexion est rattaché à `CRM-009`, non à `CRM-011`** — `docs/SPEC-auth.md` §9
  l'avait rattaché « selon l'option la plus étroite », c'est-à-dire l'option 1 des trois soumises,
  alors que le responsable avait retenu l'option 2, une unité dédiée (décision 253, INC-021). Le
  comportement livré est conforme et **inchangé** ; seuls le rattachement et la traçabilité sont
  corrigés, dans `docs/SPEC-auth.md`, `docs/DAT.md` §3.1 et `docs/BACKLOG.md`. Les commentaires
  `@spec` du code et les `@verifies` des preuves sont maintenant repris sous `CRM-009`.

### Supprimé

- **Les quarante et une branches `claude/happy-goldberg-*` sont supprimées** d'`origin`, sur
  instruction du responsable : leur existence violait `CLAUDE.md` §13, qui impose de travailler sur
  `main` exclusivement. Quarante ne portaient que des réimplémentations parallèles d'unités que
  `main` porte déjà sous ses noms retenus. `docs/BRANCHES_SUPPRIMEES.md` conserve l'inventaire, le
  détail des vérifications et les empreintes des têtes, qui rendent une restauration possible tant
  que le ramasse-miettes d'`origin` n'est pas passé. Aucun code applicatif n'est modifié.

- **Le parcours utilisateur authentifié est livré** — écran `/connexion`, retour à la page
  demandée, restauration de session limitée à l'onglet, identité et déconnexion dans l'en-tête.
  Six scénarios Playwright sans substitution prouvent les gestes réels : commentaire publié et
  relu par l'API, déplacement d'une card d'essai et étape relue, refus du `viewer` sur les deux
  actions sans perte du brouillon ni de la position. `localStorage` reste vide. Les cinq nouvelles
  captures d'application de `CRM-011` ont été observées aux quatre paliers et en session chargée.
- **INC-021 et INC-022 closes.** `CRM-011`, `CRM-041`, `CRM-043` et `CRM-044` passent `[x]` ; les
  réponses substituées de leurs suites historiques restent utiles aux états rares mais ne sont
  plus la seule preuve d'un écran chargé.
- **Spécification du parcours utilisateur authentifié** — reprise de `CRM-011`,
  `docs/SPEC-auth.md` §9, écrite avant le code. L'écran de connexion est rattaché à l'unité qui
  porte déjà connexion et déconnexion ; la session est limitée à `sessionStorage`, avec repli
  mémoire, jamais au `localStorage`. La preuve exigée va jusqu'aux vraies actions du chunk 3 :
  commentaire publié et card déplacée depuis l'interface, effets relus par l'API, plus le refus du
  `viewer`. INC-021 et INC-022 portaient l'arbitrage désormais clos par les preuves ci-dessus.

- **Spécification de l'infrastructure mail de développement** — `CRM-050`,
  `docs/SPEC-mail-subsystem.md` §11, écrite **après mesure sur des conteneurs réellement démarrés**
  et avant toute ligne de code. L'unité tenait en quatre lignes de backlog ; le document dit
  désormais quelles images sont épinglées, où chacune est déclarée et pourquoi, quels ports sont
  publiés, quels domaines et quelles boîtes existent, par quel mécanisme réel elles sont créées, et
  par quelles preuves l'unité se ferme.
- **Trois pièges de Stalwart payés avant d'être écrits** (`docs/JOURNAL.md` décision 235) : une
  liaison `[::]` **tue le serveur en silence** sur un conteneur sans IPv6, le traceur fichier
  échoue tant que son répertoire n'existe pas, et un principal créé sans rôle s'authentifie puis
  refuse toute commande sans rien renvoyer au client.
- **ClamAV est déclaré là où il est exercé** (`docs/JOURNAL.md` décision 236) : l'overlay de
  développement, son unique consommateur — l'ingestion des pièces jointes — arrivant à `CRM-054`.
  Son passage dans l'assemblage commun est inscrit comme opération due dans
  `docs/PROD_MIGRATIONS.md` §4, plutôt que d'imposer à la production un service que rien n'appelle.
- **`CRM_INBOUND_DOMAIN` converge avec le seed** (`docs/JOURNAL.md` décision 237) :
  `crm.p2enjoy.test`, et non plus `crm.exemple.tld`. Les deux valeurs divergeaient depuis l'origine
  sans que rien ne les compare — à partir de `CRM-050`, une divergence rendrait la boîte système
  incapable d'attraper les seules adresses que le produit génère.
- **L'infrastructure mail de développement est livrée** — `CRM-050`. `./runDev.sh` démarre
  désormais **Stalwart** (vrai serveur IMAP/SMTP, ports 1143, 1025 et 1587), **Roundcube**
  (webmail de contrôle, http://localhost:8080), **ClamAV** (`clamd` sur 3310) et un service jetable
  qui provisionne les boîtes. Inbucket est **conservé** pour les emails transactionnels : les deux
  serveurs ne servent pas le même usage.
- **Le démarrage mail est déterministe et son journal reste propre après usage réel.** Stalwart
  importe un bundle webadmin local versionné au lieu d'une release GitHub `latest`, écrit ses
  réglages modifiables par l'API, désactive ARC/DKIM dans le serveur local sans clés de production,
  et refuse avant Docker un domaine catch-all divergent du seed. Preuves sur volume neuf :
  `runDev.sh` vert, `verify-mail-infra.sh` **84/84**, `e2e:mail` **16/16**, puis zéro
  `WARN`/`ERROR`. INC-079 est close.
- **Trois boîtes, créées par la véritable API de gestion de Stalwart** et non par une écriture dans
  son magasin : `systeme@crm.p2enjoy.test` — boîte système, **catch-all** de tout le domaine des
  cards —, `admin@p2enjoy.test` et `bizdev@p2enjoy.test`. Le provisionnement est **convergent** :
  rejoué, il rétablit les attributs sans dupliquer ni détruire un message. Farida Nowak (`viewer`)
  n'a pas de boîte, et c'est délibéré (décision 239).
- **Le catch-all est prouvé de bout en bout, hors interface** : un message soumis en SMTP
  authentifié à une adresse de card **jamais déclarée** est accepté, remis dans la boîte système et
  relu par IMAP avec son `Message-ID`, son sujet et son destinataire intacts.
- **Le projet Playwright `mail` est déclaré**, pour la première fois — `npm run e2e:mail`,
  **16 scénarios verts**. Il était annoncé par `README.md` §7 et laissé vide par `CRM-008` faute de
  sujet (INC-023). Il ne parle qu'aux serveurs : ni build, ni `webServer`. **Aucune bibliothèque
  IMAP ou SMTP n'est ajoutée au dépôt** — les clients sont écrits sur une socket `node:net`, et le
  choix d'une bibliothèque pour `mail-sync` reste ouvert pour `CRM-051` (décision 238).
- **ClamAV est prouvé opérant, pas seulement vivant** : `zINSTREAM` de la chaîne de test EICAR rend
  `stream: Eicar-Test-Signature FOUND`, et une contre-épreuve sur un contenu anodin rend `OK`. Un
  `PONG` prouve qu'un processus écoute, pas qu'il sait détecter.
- **Test unitaire dédié sur la configuration du serveur** — `stalwart/config.test.ts`, 24
  assertions, dont deux payées par une panne réelle : une régression sur la liaison `[::]` rend la
  pile silencieusement morte, et c'est le seul contrôle capable de l'attraper sans démarrer quoi
  que ce soit. `npm run test:unit` : **523 tests** sur l'état courant.
- **Harnais de preuves rejouable** `scripts/verify-mail-infra.sh` : **84 contrôles**, et **non
  complaisant** — cinq dégradations posées sur une **copie** produisent 6 anomalies.
- **Vérification visuelle observée** : `docs/captures/CRM-050/`, trois images regardées une à une.
  La boîte système y montre les messages que le catch-all a captés.
- **Preuve à froid, après destruction complète** : cluster et **tous** les volumes détruits — le
  RocksDB de Stalwart compris —, la pile remonte en **33 secondes**, les seize services sont sains,
  et les deux domaines et trois boîtes sont recréés sans aucune intervention.
- **INC-080, consignée et non résolue**, en deux points. D'abord, quatre garde-fous périmés,
  mesurés **à froid** donc réels : `verify-authz.sh`, `verify-cards.sh`, `verify-board.sh` et
  `verify-preuves-refus.sh` comptent neuf cards là où `CRM-046` en a livré quatorze, et
  `verify-commentaires.sh` cherche un composant que `CRM-044` a dissous. Ensuite, et c'est le point
  le plus important : **le rejeu séquentiel des harnais dégrade l'environnement qu'il mesure** —
  `verify-seed-demo.sh` rend 2 anomalies en séquence et **aucune** seul, et le conteneur de
  migrations finit `exited (3)` sur un `deadlock`. Un balayage global n'est donc pas une mesure de
  l'état du dépôt, ce qui rend suspecte toute livraison antérieure annonçant « les vingt-trois
  harnais rejoués ». Aucun de ces points ne vient de `CRM-050`, qui ne touche ni table, ni
  politique, ni seed.
- **INC-079 close** : la console Stalwart distante et mouvante est remplacée par une page locale ;
  l'API de gestion et Roundcube conservent leurs rôles respectifs. Le démarrage à froid et le
  journal après protocoles sont prouvés sans avertissement.
- **Spécification du manuel utilisateur du chunk 3** — `CRM-047`, `docs/SPEC-manual.md`, écrite
  **après mesure sur la pile réelle** et avant toute correction. L'unité tenait en une ligne de
  backlog ; le document dit désormais quelle unité vit dans quel chapitre, ce qu'un chapitre doit
  satisfaire, où vivent les chiffres, ce que « captures renouvelées » exige, et par quelles preuves
  l'unité se ferme.
- **La dérive du manuel est chiffrée : treize écarts**, chacun avec sa mesure
  (`docs/SPEC-manual.md` §6). Quatre affirmations ont été rendues fausses par une unité
  **ultérieure** à celle qui les avait écrites, deux chiffres l'ont été par `CRM-046`, un libellé
  cité n'existe pas dans le produit — « Affaire introuvable » là où l'écran dit « Card introuvable »
  —, et un chapitre promis par le sommaire n'était écrit nulle part.
- **INC-077, consignée et non résolue** : `card_events.type` admet neuf valeurs, le fil en sait
  nommer huit. `channel_changed`, écrit par `CRM-045` et présent deux fois dans la base, s'affiche
  « Événement » — un fait dont le fil ne dit pas lequel. Le comportement reste inchangé ; trois
  questions sont nommées pour l'arbitrage (décision 232). L'écran n'est **pas** modifié : le manuel
  dit désormais ce que le fil montre réellement.
- **Le manuel utilisateur du chunk 3 est à jour du produit exécuté** — `CRM-047`, `docs/manual.md`.
  Douze écarts refermés : les affaires ont **trois** écrans et non aucun, un déplacement **laisse**
  une trace et **a** son écran, la fiche affiche « **Card introuvable** » et porte son fil, et
  `CRM-045` n'est plus rangé parmi ce qui n'est pas livré.
- **Un chapitre qui manquait est écrit** — §4.11, « Ranger une affaire dans un autre dossier ».
  `CRM-045` était promis par le sommaire et n'existait nulle part dans le document.
- **Annexe A, mesurée** : les vingt et un volumes de l'espace de démonstration vivent désormais dans
  une table unique, comparée à la base à chaque vérification. La prose des chapitres n'écrit plus
  aucun nombre mesurable.
- **Preuve d'interface dédiée** `e2e/ui/manuel.spec.ts` : **9 scénarios**, dont huit exercent les
  huit adresses citées par le manuel **en visiteur anonyme réel, sans aucune substitution**, et
  exigent le libellé **exact** promis au lecteur. Le neuvième **mesure** INC-077.
- **Harnais de preuves rejouable** `scripts/verify-manual.sh` : **105 contrôles**, et **non
  complaisant** — cinq dégradations posées sur une copie du manuel produisent six anomalies.
- **INC-078, consignée et non résolue** : quatre harnais du chunk 3 n'apparaissent dans aucune liste
  du `README.md`. Corriger quatre lignes appartenant à quatre autres unités mêlerait quatre sujets à
  un commit qui n'en traite qu'un.

### Corrigé

- **Le chargement initial de la webapp repasse sous le seuil Vite sans relever ce seuil.**
  `RouteTrack` et `RouteCard` sont chargées à la navigation avec un squelette accessible : le
  chunk initial passe de **530,59 kB** à **477,86 kB**, trois chunks métier sont séparés et le
  build n'écrit plus d'avertissement. Les **525 tests unitaires** et les **144 scénarios UI**
  passent sur le build de production.
- **La console navigateur fait désormais partie du verdict de chaque scénario UI.** Aucun
  `warning`, `error` ou `pageerror` résiduel n'est toléré ; les erreurs réseau volontairement
  provoquées par les preuves de refus sont vérifiées côté écran puis consommées par égalité exacte,
  sans filtre global.
- **Les classes silencieusement absentes du CSS sont corrigées, et leur contrôleur aussi**
  (décision 267) : les composants emploient les jetons `text-3` et le palier `md` réellement
  déclarés, l'apostrophe de `before:content-['·']` est correctement échappée, et la plage
  locale-dépendante qui faisait écrire `grep: Invalid collation character` est remplacée.
  **167/167 classes** sont présentes ; une vraie dégradation `px-7` reste refusée.

- **Le build Docker de développement ne copie plus les secrets ni les données du poste.** Un
  `.dockerignore` racine exclut `.env`, `.git`, les dépendances, sorties de preuve et volumes
  locaux. Le défaut a été mesuré dans l'ancienne image, qui contenait réellement `/app/.env` et
  `/app/.git` ; elle n'existe plus. Contexte ramené de 233,04 Mo à 11,56 Mo et reconstruction
  prouvée par les **61 contrôles** de `verify-scripts.sh`.

- **Deux défauts de `CRM-047` trouvés en exécutant ses propres preuves** (décision 234). L'annexe A
  portait « 38 événements », recopié de `CRM-046` : un total d'événements ne fait que croître, et la
  première exécution après la suite d'API a rendu « le manuel dit 38, la base dit 73 ». La grandeur
  sort de la table, son absence est expliquée, et l'invariant qui la remplace est vérifié. Le second
  était dans le harnais : deux contrôles terminés par `condition && ok` faisaient rendre `1` à leur
  fonction sous `set -e`, interrompant le script au premier écart — **invisible à toute exécution
  verte**, et trouvé parce que la contre-épreuve exige un nombre minimal d'anomalies.

- **Le jeu de démonstration complet** — `CRM-046`, `supabase/seed/apply-seed.sh`. Cinq cards et
  quatre valeurs de formulaire ferment les trois manques mesurés du socle : les **sept** étapes du
  workflow global portent chacune une card **active**, le workflow **dérivé** en porte deux à deux
  étapes distinctes, et **aucun channel actif n'est vide**. Le seed livre désormais 14 cards dont 12
  actives, 18 valeurs, 5 commentaires et 38 événements au sortir d'un cluster neuf.
- **Une card peut enfin vivre dans « Prospection »**, et aucune règle n'a été relâchée pour cela :
  les deux écritures inutiles du seed — le `workflow_id` réécrit en section 4, la séquence de
  libération en section 7 — sont devenues **conditionnées par une relecture**. Sur une base
  conforme, la section 7 ne fait plus aucune écriture. À cette étape, **INC-046 n'était pas
  levée** : le PATCH d'un channel peuplé restait refusé en `409`, ce que trois preuves mesurent
  désormais — un refus prouve la règle là où un vide ne prouvait que l'absence d'occasion de
  l'enfreindre.
- **Deux clés étrangères du seed sont résolues à l'exécution**, et c'est le produit qui l'impose :
  `copy_workflow_to_track` frappe la copie et ses sept étapes avec `gen_random_uuid()`. Les cards du
  workflow dérivé retrouvent leur étape par la **clé de nœud** du catalogue, jamais par une
  constante ; si la copie manque, le seed **échoue en le disant** plutôt que de poser ces cards sur
  le workflow global (décision 222).
- **La reproductibilité du seed est prouvée par une destruction réelle** — `./resetMe.sh --yes` a
  détruit le cluster et ses volumes, les dix-sept migrations ont été rejouées à froid, et
  l'empreinte est **identique** de part et d'autre. `card_events` porte exactement 38 lignes sur la
  base neuve, ce qui confirme ce nombre pour ce qu'il est : un état, non un invariant.
- **Harnais de preuves rejouable** `scripts/verify-seed-demo.sh` : **62 contrôles**, dont ce que
  chacun des trois profils lit réellement, et **non complaisant** — trois dégradations posées par la
  vraie route le font mordre. Sa restauration porte sur l'**état** ; la **mémoire** ne revient pas,
  et l'écart de la timeline est mesuré à la valeur près.

### Corrigé

- **Deux défauts de `CRM-046` trouvés par son propre harnais, avant tout commit de code.**
  Conditionner toute la réparation de la section 7 à la conformité de la copie faisait perdre la
  convergence pour toute dérive réparable — seules `scope` et `track_id` exigent de libérer le
  channel (décision 225). Et « 38 événements » n'est pas un invariant mais un **état** : le harnais
  lui-même en écrit quatre par exécution, seul « un `created` par card » se fige par une égalité
  (décision 226).
- **`email_local_part` ne pouvait pas figurer dans une empreinte de reproductibilité** : l'adresse
  d'une card est tirée au hasard par le trigger de la migration 11. L'inclure aurait rendu la preuve
  de reconstruction rouge par construction, et fait conclure à une non-reproductibilité inexistante.
  Deux empreintes distinctes désormais, et la valeur est remplacée par sa forme et son unicité
  (décision 227).
- **Une preuve d'API restait verte sans plus rien prouver.** La ligne *b* de
  `e2e/api/coherence-workflow.spec.ts` remettait un channel à son workflow global **sans rien
  asserter** ; l'écriture échouait en silence et l'assertion suivante réaffectait une valeur déjà en
  place. Trois scénarios opèrent désormais sur un channel qu'ils créent et détruisent, et l'état de
  départ est asserté.
- **Onze assertions figées par des unités antérieures ont été révisées, jamais retirées**
  (décision 51), dans quatre suites pgTAP et sept preuves d'API. Deux d'entre elles figeaient
  explicitement une conséquence d'INC-046.

- **Spécification du jeu de démonstration complet** — `CRM-046`, `docs/SPEC-seed.md` §9, écrite
  **après mesure de la pile réelle** et avant toute ligne de code. Dix sous-chapitres opposables :
  ce que le socle satisfait déjà, les trois manques chiffrés, la levée de l'obstruction du §9.1 de
  `docs/SPEC-cards.md` par convergence, les cinq cards ajoutées, les deux identifiants que le
  produit tire lui-même, le formulaire vide du workflow dérivé, ce que chaque profil voit, le
  contrat de reproductibilité de `resetMe.sh`, quatorze preuves exigées et ce que le jeu ne livre
  toujours pas.
- **Trois manques du seed, mesurés et non supposés** — `realisation` **0 card**, `livre` **1 card
  archivée**, `perdu` **0 card**, le workflow **dérivé** 0 card à ses sept étapes, et le channel
  actif `prospection` 0 card : l'écran vide que l'énoncé de `CRM-046` proscrit. Quatre des six
  exigences de l'énoncé sont en revanche **déjà satisfaites** par le socle, et l'unité ne les
  refait pas (décision 220).
- **L'obstruction du §9.1 re-mesurée** — une card posée dans `prospection` fait échouer le seed
  **en section 4**, HTTP `409`, `23503`, code de sortie `1` ; la card retirée, le seed repasse en
  `0`. La levée retenue est une **convergence par état** — relire avant d'écrire, en section 4 et
  en section 7 —, et non un relâchement de la clé étrangère, qui trancherait INC-046 par
  implémentation (décision 221).
- **INC-075** — un channel consenti par le backend est **inatteignable par la navigation du
  produit**. MESURÉ avec le jeton réel du `viewer` : il lit `prospection` par droit fin sous un
  track fermé, et ne lit pas le track `conseil-ia` ; la coquille résolvant le track avant ses
  channels, la route rend « Track introuvable ». Trois issues nommées, aucune tranchée
  (décision 224).

- **Déplacement d'une card entre channels** — `CRM-045`,
  `supabase/migrations/0017_move_card_to_channel.sql`. La RPC `move_card_to_channel` déplace une
  card d'un graphe de workflow à un **autre** : aucune arête n'est franchie, aucune transition
  n'est consultée, et le remappage de l'étape est **fourni par l'appelant** — jamais deviné, deux
  workflows pouvant porter le même nœud sans que le déplacement soit équivalent. Huit refus, le
  droit d'écriture exigé sur les **deux** channels, et `channel_changed` comme **neuvième** type de
  la timeline. **Aucun privilège de colonne n'est posé** : `CRM-013` avait déjà fermé `channel_id`
  et `workflow_id`, et la garde était donc close avant d'exister (décision 214).
- **Les réponses de formulaire d'une card qui change de workflow sont détruites, et jamais en
  silence** — `discard_field_values` vaut `false`, et le refus porte le **nombre** de réponses
  perdues. La mémoire survit à la donnée : les `field_changed` de la timeline sont conservés
  (décision 216). MESURÉ : sans ce traitement, la fonction rendait un `23503` pour **six cards du
  seed sur neuf**.
- **Un déplacement écrit UN événement, jamais deux** : la garde `moved` est conditionnée à
  `channel_id` inchangé, `moved` signifiant « la card a franchi une arête du graphe » (décision
  215). L'événement est écrit par le **trigger de la table**, donc aussi pour un `PATCH` direct
  sous `service_role`.
- **Le seed démontre enfin une card sur un workflow dérivé**, en transit : un aller-retour réel de
  `…0c5` vers `prospection` par la vraie RPC, avec le jeton de l'administratrice. 29 événements au
  sortir du seed, convergent au rejeu. INC-046 n'était pas levée par ce seul geste (décision 218) ;
  `CRM-019` la ferme plus haut sans changer cette fonction unitaire.
- **Preuves** : `supabase/tests/0019_move_card_to_channel.test.sql` (**64 assertions**, les huit
  vérifications dans les deux sens) — `npm run test:sql` passe de 1337 à **1401** ;
  `e2e/api/move-card-to-channel.spec.ts` (**18 scénarios** hors interface, jetons réels des trois
  profils) — `npm run e2e:api` passe de 391 à **409** ;
  `scripts/verify-move-card-to-channel.sh` (**43 contrôles**, cinq dégradations volontaires).

### Corrigé

- **La pile ne redémarrait plus sur une base seedée** — `CRM-045`, décision 219, INC-074. La
  migration 16 ramenait le vocabulaire de `card_events` à huit valeurs à chaque rejeu du
  `migrations-runner`, avant que la 17 ne le rétablisse ; PostgreSQL refusant une contrainte que
  les lignes présentes violent, le runner sortait en **code 3**. Le défaut était invisible sur une
  base neuve — les migrations tournent avant le seed — et invisible de toute suite pgTAP, de toute
  preuve d'API et de tout harnais dédié, qui s'exécutent contre une base déjà migrée. Il a été
  trouvé par le balayage de non-régression. L'autorité sur le vocabulaire passe désormais à la
  dernière migration qui l'étend ; aucune garantie de convergence n'est perdue.
- **Une preuve de `CRM-045` rendait cinq autres suites dépendantes de son succès** — décision 229.
  Trois scénarios déplaçaient une card du seed et ne la rendaient que si toutes leurs assertions
  passaient ; une seule card mal rangée a rendu rouges **dix-sept assertions réparties sur cinq
  suites**. Ils opèrent désormais sur des cards créées et détruites par la preuve elle-même.
  Vérifié après remise à froid : les 409 scénarios d'API laissent les neuf cards du seed à leur
  channel, leur étape et leur rang exacts.
- **Deux défauts de `scripts/verify-timeline.sh`, tous deux nés de `CRM-045`.** Sa dégradation
  « CHECK élargi à `mail_received` » **cessait de mordre** — ses listes omettaient
  `channel_changed`, l'`ALTER` échouait en silence, et le harnais rendait « dégradation non vue ».
  Sa **restauration** rejouait la seule migration 16, qui remplaçait le trigger par sa forme à
  quatre gardes et rendait rouges neuf assertions **longtemps après** l'exécution du harnais. La
  migration 17 rejoint la séquence de restauration, et un contrôle constate que la cinquième garde
  est rendue : 74 → **76 contrôles**.
- **INC-076** — `card_comments.author_id` n'a aucune action `ON DELETE`, et supprimer un compte qui
  a commenté rend `500` / `23503`, contre la Definition of Done de `CRM-011`. **Antérieur à
  `CRM-045`**, relevé par son balayage, laissé inchangé : la colonne appartient à `CRM-043` et
  `author_id` étant `not null`, la correction n'est pas mécanique. Consigné, non résolu.
- **Le contrôle d'INC-046 du harnais de `CRM-045` a été révisé après `CRM-046`** — deux exécutions
  de la routine en parallèle, INC-059. Il vérifiait que `prospection` était vide ; elle porte
  désormais deux cards sur le workflow dérivé. Ce qui prouvait alors INC-046 n'était plus un vide
  mais un **refus** : le PATCH direct d'un channel peuplé reste impossible, mesuré en `23503` ; la
  RPC explicite de `CRM-019` ferme depuis le geste légitime.
  43 → **45 contrôles**.
- **Un garde-fou de types de `CRM-034` a joué comme il l'annonçait** et a été **révisé, non
  retiré** : `webapp/src/lib/database.types.test-d.ts` est resserré sur les **trois** fonctions
  appelables de `public`, avec la signature et le retour de la nouvelle.
- **Une affirmation fausse de cette unité, corrigée par vérification** : le commentaire annonçait
  qu'une assertion « huit valeurs » de `CRM-044` serait retournée. Cette suite éprouve ses types
  **en écrivant** et n'a jamais compté l'énumération ; aucun garde-fou ne pouvait jouer. Le
  recensement manquait, et il est désormais porté par la suite de `CRM-045`.

- **INC-074** — la convergence d'INC-035 ne sait pas exprimer « une contrainte dont la définition
  canonique avance avec les migrations », et **aucun harnais du dépôt ne rejoue le
  `migrations-runner` sur une base seedée**. Consignée sans être résolue au-delà de la correction
  locale que la panne imposait.

- **Spécification du déplacement d'une card entre channels** — `CRM-045`,
  `docs/SPEC-workflow-engine.md` §6, `docs/SCHEMA.md` §5 et §9, `docs/SPEC-cards.md` §14.4 et
  §14.6, `docs/SPEC-seed.md` §2.16. Écrite **avant toute ligne de code** et **après mesure sur la
  pile réelle**. Le chapitre tenait en dix lignes ; il est réécrit en treize sous-chapitres
  opposables : huit vérifications avec leur `SQLSTATE` et leur code HTTP mesurés, ce que la
  fonction écrit, l'événement `channel_changed` — neuvième type de la timeline —, les privilèges,
  seize lignes de contrat d'API, et ce que l'unité ne livre pas. Quatre faits mesurés changent ce
  que la fonction doit faire : `channel_id` et `workflow_id` sont **déjà** fermés à `authenticated`
  depuis `CRM-013`, un changement de channel est aujourd'hui **silencieux** dans la timeline, le
  `CHECK` de `card_events` **refuse** le type nouveau, et `card_field_values` **interdit** le
  changement de workflow d'une card qui porte une réponse — six cards du seed sur neuf.
  `discard_field_values` rend la perte explicite plutôt que silencieuse (décisions 213 à 218).
- **INC-073** — `docs/SCHEMA.md` §9 et `docs/SPEC-workflow-engine.md` §6 décrivaient deux fonctions
  différentes sous le même nom : `step_mapping` annonce un déplacement **en lot** qu'aucune unité
  du backlog ne porte. La lecture la plus faible est retenue, la contradiction est consignée sans
  être résolue implicitement.

- **Spécification de la mémoire d'une affaire** — `CRM-044`, `docs/SPEC-cards.md` §14,
  `docs/DESIGN_SYSTEM.md` §5.11, `docs/SPEC-seed.md` §2.15, `docs/SCHEMA.md` §5. Écrite **avant
  toute ligne de code** et **après mesure sur la pile réelle** : quatre documents nommaient la
  timeline sans la décrire, et l'unité tenait en deux lignes au backlog.

  Ce que la spécification tranche : les **huit** types d'événements réellement livrables et le refus
  des deux que la messagerie apportera ; l'horodatage à `clock_timestamp()` plutôt qu'à `now()`,
  mesuré, sans quoi trois événements nés d'une même instruction seraient rangés au hasard ;
  l'écriture réservée aux **triggers**, refusée à tout le monde y compris au compte de service, de
  sorte que le jeu de démonstration ne **puisse pas** fabriquer une trace ; l'immuabilité et la
  seule porte qu'elle laisse ouverte ; la fusion du fil des commentaires et du fil des événements
  **à la lecture**, sans duplication.

  Aucun code n'accompagne ce changement.

- **La mémoire d'une affaire, côté serveur** — `CRM-044`, `docs/SPEC-cards.md` §14. Une affaire se
  souvient désormais de ce qui lui est arrivé : sa création, chaque franchissement d'étape, chaque
  changement de responsable, son archivage, sa mise à la corbeille et leurs retours, et chaque
  valeur de formulaire écrite ou modifiée. Chaque trace porte sa date, son auteur lorsqu'il y en a
  un, et l'état d'avant comme celui d'après.

  **Personne ne peut écrire dans cette mémoire, et personne ne peut la corriger.** Ni un
  utilisateur, ni un administrateur, ni même le compte technique qui installe le jeu de
  démonstration : c'est la base elle-même qui écrit, au moment où l'acte a lieu. Une trace posée ne
  peut plus être modifiée, par qui que ce soit. Ce que la mémoire d'une affaire montre a donc
  réellement eu lieu — ce n'est plus une convention de développement, c'est une propriété du
  produit.

  **Une écriture qui ne change rien ne laisse aucune trace** : réenregistrer une fiche sans la
  modifier n'ajoute pas de ligne. Le jeu de démonstration en profite pour montrer une affaire
  déplacée puis ramenée à son étape, et une affaire réattribuée puis rendue à son responsable — les
  deux histoires sont réelles, et l'état de démonstration reste exactement celui d'hier.

  **Ce que cette livraison ne fait pas encore** : elle n'a pas d'écran. La colonne de droite d'une
  affaire montre toujours la seule discussion. Le motif qu'on saisit en déplaçant une affaire perdue
  n'est toujours conservé nulle part. Les emails et les activités — appels, réunions — n'ont pas
  encore de table, et n'apparaissent donc pas dans le fil.

  **À savoir avant tout déploiement** : cette table grandit sans limite et rien ne la purge ; aucune
  règle de conservation n'a été décidée. Le détail est dans `docs/PROD_MIGRATIONS.md`.

- **L'affaire raconte son histoire, et la discussion s'y range** — `CRM-044`,
  `docs/DESIGN_SYSTEM.md` §5.11, `docs/manual.md` chapitre 4.10. La colonne de droite d'une affaire
  ne porte plus la seule discussion : c'est désormais **un seul fil**, où ce qui a été *dit* et ce
  qui est *arrivé* se lisent ensemble, du plus ancien au plus récent.

  On y voit l'affaire naître, changer d'étape — avec les deux étapes nommées —, changer de
  responsable, être archivée, mise à la corbeille ou restaurée, et chaque réponse de formulaire
  saisie ou modifiée, avec le nom du champ. **Quatre bascules** trient le fil par famille :
  discussion, étapes, champs, cycle de vie. Le nombre porté par chacune compte ce que l'affaire
  contient et ne bouge pas quand on éteint la famille ; éteindre tout dit qu'on filtre, ce qui ne se
  confond pas avec une affaire sans histoire. **Rien n'est retenu sur l'appareil** : rouvrir la
  fiche rétablit le fil complet.

  **Ce que le fil ne fait pas** : on y lit, on y filtre, on n'y agit pas. Il ne dit pas **qui** a
  agi — aucun nom de personne n'est lisible dans le produit aujourd'hui. Les faits ne s'affichent pas
  d'eux-mêmes pendant qu'on regarde la fiche, à la différence des commentaires. Et le motif saisi en
  marquant une affaire perdue n'est toujours conservé nulle part.

  **Cinq défauts d'affichage ont été trouvés en regardant les captures**, alors que les 127 scénarios
  d'interface étaient verts : un compte collé à son libellé, une pastille d'icône sans taille ni
  fond, une barre de filtres coupée au bord du panneau, et des filtres proposés sur une affaire qui
  n'a rien à filtrer. Tous corrigés dans le même changement.

- **Les commentaires d'une affaire, côté serveur** — `CRM-043`, `docs/SPEC-cards.md` §13. Une
  affaire peut désormais porter une **discussion** : chaque membre qui a le droit d'écrire dans son
  channel peut y publier un commentaire, le corriger, ou le supprimer — et **lui seul** peut
  toucher aux siens. Un lecteur seul lit la discussion sans pouvoir y écrire.

  **Supprimer supprime vraiment.** Un commentaire retiré ne disparaît pas de la conversation — sa
  place reste tenue —, mais **son texte est détruit** : il n'est ni masqué, ni conservé quelque
  part. Le geste est définitif, et rien ne permet de le défaire. Cette place laissée est ce qui
  permet à la suppression de se propager instantanément aux écrans des autres.

  **Le fil se met à jour tout seul.** C'est la première donnée du produit diffusée en temps réel :
  un commentaire publié apparaît chez les autres membres sans qu'ils rechargent quoi que ce soit —
  et **uniquement** chez ceux qui ont accès à l'affaire. Un collègue à qui le dossier est fermé ne
  reçoit rien, ce qui a été vérifié en écoutant des deux côtés à la fois.

  Le jeu de démonstration porte cinq commentaires sur trois affaires, écrits par les trois comptes,
  dont un corrigé et un supprimé — les deux états sont produits par l'application elle-même, jamais
  fabriqués.

  **La discussion a son écran.** Elle occupe la colonne de droite de la fiche d'une affaire — sous
  le formulaire quand l'écran est étroit —, du plus ancien commentaire en haut au plus récent en
  bas. Un commentaire corrigé porte la mention *modifié* ; un commentaire supprimé **garde sa
  place**, réduit à la mention *Commentaire supprimé*, pour qu'on voie qu'un tour de parole a
  existé.

  Le champ d'écriture est **toujours affiché** : ce n'est pas l'interface qui décide qui peut
  commenter, c'est le serveur. Si la publication est refusée, le message l'explique et **votre
  texte reste dans le champ** — il n'y a rien à ressaisir. Aucun nom d'auteur n'est encore affiché :
  aucun nom de personne n'est aujourd'hui lisible dans le produit, et il est préféré de ne rien
  montrer plutôt qu'un identifiant technique.

  **Corriger et supprimer restent sans bouton** : la règle existe et le serveur l'applique — seul
  l'auteur peut le faire —, mais l'écran ne propose pas encore le geste. L'unité reste donc en
  cours. `docs/manual.md` gagne son chapitre 4.10.

- **La spécification des commentaires** — `CRM-043`, `docs/SPEC-cards.md` §13. Aucune ligne de code
  n'est livrée ici : le document précède l'implémentation, comme pour chaque unité. Le chapitre dit
  ce qu'un commentaire est, ce qu'il devient quand on le supprime — une **pierre tombale réellement
  vidée de son contenu**, et non un contenu masqué par l'interface —, qui peut l'écrire, qui peut le
  modifier, et comment le fil se met à jour **sans recharger la page**.

  Trois documents se contredisaient sur la question la plus simple : *qui peut commenter ?* Le
  schéma disait « qui peut lire la card », les règles d'autorisation disaient « qui peut écrire sur
  le channel », et l'énoncé de l'unité reprenait le premier tout en exigeant, dans sa propre
  recette, la preuve du refus opposé à un lecteur seul. Les deux contradictions sont **écrites**
  (`INC-071`, `INC-072`) plutôt que tranchées en silence ; le comportement retenu est celui des
  sources concordantes — **commenter est un droit d'écriture** —, et la modification comme la
  suppression restent réservées à **l'auteur**.

  `docs/DESIGN_SYSTEM.md` gagne son **§5.10**, les règles du premier fil de discussion du produit :
  ordre chronologique croissant, commentaire supprimé qui **garde sa place** dans la conversation,
  refus d'écriture affiché **sans perdre le texte saisi**, et aucun nom d'auteur — cette donnée
  n'est lisible par personne aujourd'hui, et le produit préfère ne rien afficher plutôt qu'afficher
  du vide.

- **La vue liste d'un channel** — `CRM-042`, `docs/SPEC-cards.md` §12. Un channel se lit désormais
  de **deux façons** : le tableau kanban, qui reste la vue par défaut, et une **liste** que la
  bascule *Tableau / Liste* ouvre sur sa propre adresse. Chaque ligne porte le titre de l'affaire —
  lien vers sa fiche —, son étape en pastille, son montant, sa prochaine action et son échéance, sur
  **une seule ligne de texte** : une liste se balaye, là où une carte se lit. Une case sans valeur
  reste **vide**, sans tiret ni « non renseigné ».

  **Trois colonnes se trient**, à la souris comme au clavier, et une affaire sans montant ou sans
  échéance se range toujours en dernier. **Deux filtres** — par étape, et par recherche plein texte
  dans le titre et la description — s'appliquent **côté serveur**, avant la pagination : un filtre
  appliqué après ne verrait que les lignes déjà rapportées. La liste affiche **25 affaires par
  page**, et le tri, les filtres et le rang de page vivent dans l'**adresse** : recharger la page y
  ramène, et l'adresse se partage. Aucune donnée n'est écrite sur l'appareil.

  **Un tri paginé qui n'est pas total perd des lignes, et cela a été mesuré** : sur une sonde de
  200 000 lignes de clé égale, une marche page par page rend **20 lignes dont 17 distinctes** —
  trois affaires que l'utilisateur n'aurait jamais vues, sans que rien ne le signale. Tout ordre de
  la liste se termine donc par la clé primaire. **Une page devenue inexistante** — parce qu'une
  affaire a été archivée ailleurs pendant que l'onglet était ouvert — affiche « Cette page n'existe
  plus » et propose de revenir à la première, jamais un message d'erreur technique.

  `docs/DESIGN_SYSTEM.md` gagne son **§5.9**, les règles du premier tableau du produit. Trois
  défauts ont été trouvés **en regardant une capture** : un état vide rendu au-dessus des filtres
  qui en étaient la cause, une action dupliquée, et une carcasse de tableau sous le message. Les
  trois sont corrigés et figés par des assertions.

### Corrigé

- **Le repli du libellé d'une transition était construit par concaténation dans le composant**, ce
  que `docs/SPEC-workflow-engine.md` §7.5 interdit nommément au profit d'une **clé de traduction
  paramétrée** (`CLAUDE.md` §23). L'ordre des mots du français s'y trouvait figé dans du JSX. La
  fonction `t` accepte désormais des paramètres — format minimal, marqueurs `{nom}`, ni pluriel ni
  genre —, et la clé devient « Passer à {etape} ». **Aucune preuve n'exerçait cette branche** : les
  dix transitions du seed portent toutes un libellé. Deux ont été ajoutées, l'une unitaire et l'autre
  d'interface, avec un jeu de rechange ; elles vérifient aussi que le marqueur ne fuit jamais jusqu'à
  l'écran (décision 180).

### Documentation

- **Les neuf harnais laissés en attente par `CRM-042` ont été rejoués, et huit sont verts** —
  `verify-catalogue` 39, `verify-workflows` 49, `verify-copie-workflow` 34,
  `verify-coherence-workflow` 33, `verify-champs-formulaire` 38, `verify-droits-fins` 42,
  `verify-colonnes-protegees` 50, `verify-preuves-refus` 26, **aucune anomalie**. Ce que l'unité
  tenait pour probable est désormais mesuré. Aucune ligne de produit n'a changé.

- **INC-061 reçoit une troisième occurrence, et sa cause est isolée hors du harnais fautif.**
  `scripts/verify-cards.sh` rejoue les suites globales **avant** de retirer ses cinq cards de
  preuve : il se mesure lui-même en train de tenir son jeu d'essai. La cause a été reproduite par le
  **vrai chemin applicatif** — cinq cards créées en `201`, base portée à 14 —, et l'ampleur a
  **quintuplé en deux unités** : onze scénarios d'API échouent, dont **sept** appartiennent à la
  preuve d'intégration dédiée de la vue liste. Base ramenée à 9 cards, les suites redeviennent
  intégralement vertes — **1164 assertions** et **358 scénarios**. Ni le produit ni les preuves ne
  sont en cause ; **aucune assertion n'a été relâchée** pour rendre le harnais vert, et le harnais
  n'est pas corrigé ici : il appartient à `CRM-040`, et l'arbitrage du responsable est dû pour la
  troisième fois.

- **INC-068 consignée, non résolue** : les pastilles d'étiquettes du §5.1 du design system n'ont ni
  table dans `docs/SCHEMA.md`, ni unité dans `docs/MASTER_PLAN.md`. `CRM-041` avait nommé l'absence
  sur la carte ; la **prescription** restait, elle, sans porteur. Distinct de l'avatar du
  responsable, qui manque faute de droit de lecture et non faute de modèle de données.

### Modifié

- **Le harnais E2E accepte un navigateur fourni par l'environnement**, par la variable facultative
  `PLAYWRIGHT_CHROMIUM_PATH` (`docs/SPEC-test-harness.md` §4.4 bis, décision 181). Sur une image qui
  préinstalle ses navigateurs et interdit `playwright install`, Playwright réclame la révision qu'il
  épingle et **tous** les scénarios `ui` du dépôt échouent au lancement. Absente, rien ne change ;
  elle ne désactive aucun contrôle et ne substitue aucune réponse, seul le binaire diffère.
### Documentation

- **La vue liste d'un channel est spécifiée avant d'être écrite** — `CRM-042`,
  `docs/SPEC-cards.md` §12, douze sous-chapitres. L'unité tenait en deux lignes au backlog, et
  quatre documents la nommaient sans jamais dire ce qu'elle lit, dans quel ordre, ni ce qu'il faut
  en prouver. Le chapitre est écrit **après mesure de la pile réelle** : le `Content-Range` d'une
  page, le **`416`** que PostgREST rend dès que le rang dépasse le total d'une unité, l'estimation
  de `count=planned` **fausse d'un facteur trois**, et une sonde de 200 000 lignes qui établit
  qu'une marche paginée sur un tri **non total** perd réellement des lignes — 20 rendues, **17
  distinctes**. `docs/DESIGN_SYSTEM.md` gagne son §5.9, les règles du **premier tableau du
  produit**, et la portée de son §12.6 s'étend à la vue liste comme elle l'annonçait.

- **Une contradiction mesurée sur `cards.amount`, consignée sans être résolue — INC-067.** Le type
  engendré déclare `number`, `e2e/api/cards.spec.ts` déclare `string`, et la pile — MESURÉE — rend
  `{"amount":48000.00}`, un **nombre** JSON. Le constat cesse d'être anodin avec le board : son
  cumul de colonne additionne sans convertir, et `0 + "48000.00"` rend `"048000.00"` en JavaScript.
  Un basculement de représentation concaténerait donc **en silence**, sans qu'aucune preuve ne le
  voie. Comportement inchangé, trois options portées au responsable.

### Ajouté

- **Le board kanban d'un channel** — `CRM-041`, `docs/SPEC-workflow-engine.md` §7. Ouvrir un onglet
  de channel affiche désormais **une colonne par étape de son workflow**, dans l'ordre de ces
  étapes, avec son compteur et le montant cumulé de ses affaires — refusé lorsque deux devises s'y
  mêlent, plutôt qu'une addition fausse. Chaque affaire porte le liseré de son étape, son titre
  menant à sa fiche, son montant, sa prochaine action et son ancienneté dans l'étape, qui passe au
  rouge au-delà du seuil de relance. Les affaires archivées et en corbeille en sont exclues **par
  le serveur**, comme la première vérification de `move_card` les exclut.
- **Le déplacement d'une affaire, à la souris et au clavier.** Le glisser-déposer natif appelle
  `move_card`, seul chemin par lequel une affaire change d'étape ; le menu « Déplacer » liste
  **exactement** les transitions déclarées depuis l'étape courante et constitue le chemin clavier.
  Une colonne non atteignable **n'est pas une cible de dépôt** : le navigateur refuse le geste, et
  aucun appel n'est émis. Le déplacement est **optimiste**, et un refus replace l'affaire
  exactement où elle était en affichant sa raison — déplacement non déclaré, droit insuffisant,
  affaire inaccessible, ou **liste des questions restées sans réponse, nommées par leur libellé**.
  Un refus que l'écran ne connaît pas n'est **jamais absorbé** : son message brut est montré.
- **Une transition exigeant un motif n'est jamais optimiste** : l'écran demande le motif **avant**
  d'appeler, et l'affaire ne bouge pas tant qu'il manque. La saisie **dit** que ce motif valide le
  déplacement et n'est pas encore conservé (INC-048) — laisser croire à un enregistrement aurait été
  une valeur par défaut trompeuse.
- **Preuves** : `webapp/src/lib/board.test.ts` (43 tests) et `webapp/src/app/Board.test.tsx`
  (24 tests) portent `npm run test:unit` de 234 à **308** ; `e2e/api/board.spec.ts` (**24
  scénarios**) confronte les quatre lectures du board à la pile réelle avec le jeton de
  l'administratrice et constate le `200`/`[]` opposé à l'anonyme ; `e2e/ui/board.spec.ts` (**21
  scénarios**) exerce l'écran contre le build de production, dont un scénario **sans aucune
  substitution**. `scripts/verify-board.sh` : **56 contrôles, aucune anomalie**, éprouvé par **huit**
  dégradations volontaires. Onze captures et la **vidéo `.webm` du glisser-déposer** ont été
  produites et observées.

### Corrigé (relevé par les preuves de `CRM-041`)

- **Une preuve d'interface était complaisante, et c'est sa propre dégradation qui l'a dit** —
  décision 174. Le refus d'un dépôt sur une colonne non atteignable n'était constaté que par
  « aucun appel émis », alors que le composant portait trois gardes redondantes. Deux mesures ont
  été nécessaires pour rendre le refus **visuel** observable : `dragleave` a un `relatedTarget`
  **nul** pendant un glissement — l'écouteur est donc **retiré**, ce qui supprime au passage un
  clignotement de l'indication de dépôt —, et un `mouse.move` qui s'**arrête** sur une colonne n'y
  fait dispatcher **aucun** `dragover`.
- **Le liseré d'une carte dont l'étape est neutre était invisible** — décision 175, trouvé en
  regardant une capture. Écrit en couleur de bordure, il disparaissait sur la surface blanche.
  Corrigé par le jeton du point neutre d'un badge, et la règle est écrite au §5.2 bis du design
  system.
- **Les channels servis par la preuve d'interface de `CRM-021` portaient des identifiants qui ne
  sont pas des UUID** — décision 178. Sans conséquence tant que le contenu d'un channel était vide ;
  le board les envoie à la vraie API, qui refuse en `400`, et l'écran capturé montrait l'état
  d'erreur. Les fixtures emploient désormais les identifiants du seed : une fixture n'a pas le droit
  de servir une ligne que la base ne pourrait pas produire.

### Documentation

- **Le chapitre « Interface » du moteur de workflow est réécrit en contrat vérifiable, avant toute
  ligne de code de `CRM-041`** — `docs/SPEC-workflow-engine.md` §7, décisions 168 à 173. Il tenait
  en **cinq lignes** écrites à `CRM-000` : elles posent des règles justes — une colonne par étape,
  un menu listant exactement les transitions déclarées, un dépôt impossible sans appel, un refus qui
  replace la card — sans jamais dire ce que le board **lit**, en combien de requêtes, dans quel ordre
  les colonnes et les cards se rangent, ni ce qu'il faut prouver. Réécrit en quatorze sous-chapitres
  **après mesure de la pile réelle** — les quatre lectures avec le jeton réel de l'administratrice,
  les **sept** refus de `move_card` un par un avec leur `code` et leur `details`, l'absence de
  colonne `position` sur `workflow_transitions`, le `[]` que `profiles` rend **même à
  l'administratrice** —, les cinq règles d'origine **citées mot pour mot**. Le glisser-déposer natif
  HTML5 y est prescrit **parce qu'il a été mesuré pilotable** par le Playwright épinglé, condition
  sans laquelle la vidéo `.webm` exigée par la Definition of Done serait inatteignable.
  `docs/SPEC-channels.md` §5 acte au passage que `workflow_id` rejoint la lecture **partagée** des
  channels, plutôt qu'une seconde lecture des mêmes lignes soit écrite pour le board.

- **Une contradiction consignée sans être résolue** — **INC-066** : l'éditeur de workflow que le §7
  prescrit depuis `CRM-000` n'est rattaché à **aucune unité** du backlog, alors que sept unités ont
  livré sa matière sans une ligne d'interface. La phrase est conservée intacte, explicitement hors
  du périmètre de `CRM-041`, et trois options d'arbitrage sont portées au responsable.

### Corrigé

- **La barre d'onglets restait vide sur la route d'une card, contre le §4 du design system** —
  décision 167, `docs/SPEC-form-composer.md` §4.6 bis, `docs/SPEC-channels.md` §5.4. La route livrée
  la veille transmettait `slugTrack` à la coquille **sans** les channels du track porteur : toute
  fiche d'affaire s'ouvrait sous « Aucun channel », là où `docs/DESIGN_SYSTEM.md` §4 pose « Onglets :
  les channels du track courant ». Le défaut avait été relevé sur une capture et laissé en l'état
  pour ne pas mêler deux sujets dans un commit ; il est corrigé ici. `RouteCard` charge le track
  porteur par le **même** chargeur que la route d'un track — aucune lecture propre à cet écran — et
  la projection d'un état de contenu de track en état de channels quitte `RouteTrack` pour
  `webapp/src/lib/channels.ts`, désormais partagée par les deux routes. L'onglet courant n'est pas
  calculé : `NavLink` le résout par préfixe de segments, l'adresse d'une card commençant par celle de
  son channel. Trois scénarios d'interface l'établissent — le track de l'adresse réellement demandé
  par un anonyme, la requête de channels filtrée sur `track_id`, l'onglet courant **seul** à porter
  `aria-current="page"` — et `scripts/verify-formulaire.sh` gagne la dégradation **D7**, qui remet la
  route dans son état fautif et exige que la preuve d'interface tombe.

- **L'adresse employée par la preuve d'interface de `CRM-037` n'était l'adresse de rien** — INC-065.
  Elle nommait `/tracks/inter-entreprises/formations/…` quand la card `…0000c6` appartient, MESURÉ en
  base, au channel `inter-entreprises` du track `formation` : les deux segments étaient intervertis
  et le second n'existait pas. **Aucune assertion ne pouvait le voir**, la card étant résolue par son
  seul identifiant. L'adresse redevient celle du produit ; le fait que rien ne confronte le couple
  `(slugTrack, slugChannel)` à la card reste **non tranché**, comportement inchangé, arbitrage
  demandé.

- **Deux compteurs figés de `scripts/verify-harness.sh` révisés, dont un que la correction
  précédente avait omis.** `SCENARIOS_UI` passe de 47 à **50** — les trois scénarios de la barre
  d'onglets ci-dessus. `SCENARIOS_API` passe de 306 à **308** : la correction du prédicat
  « renseigné » avait ajouté deux cas au tableau de cas partagé, donc deux scénarios à
  `e2e/api/rendu-formulaire.spec.ts` (15 → 17), sans réviser ce compteur dans le même changement.
  Le garde-fou a fait exactement ce qu'on lui demande — il aurait rendu « vert mais 308 au lieu de
  306 » — ; c'est la révision qui manquait. `ASSERTIONS_ATTENDUES` reste à 1164. Les deux valeurs
  sont MESURÉES.

- **Un contrôle de restitution comparait au dernier commit, et ne pouvait donc pas être vert pendant
  qu'on travaille** — décision 166, INC-064. La section 7 de `scripts/verify-formulaire.sh` vérifiait
  que le harnais avait bien restauré les trois fichiers qu'il dégrade, par `git diff --quiet`. Ce
  contrôle ne distingue pas « une dégradation n'a pas été restaurée » de « le fichier porte un
  changement non encore committé ». MESURÉ : `46 contrôles, 1 en échec` sur un fichier **parfaitement
  restauré**, au seul motif que la correction n'était pas encore committée — et il en aurait été
  ainsi de toute modification de ces fichiers, donc à chaque emploi du harnais. Le script prend
  désormais une **empreinte à son entrée** et compare à elle. Ce n'est pas un défaut de complaisance
  mais son inverse, et il est dangereux autrement : un contrôle qui ne peut pas être vert pendant
  qu'on travaille finit par être ignoré. Les autres harnais n'ont **pas** été relus à ce titre — ce
  sont les livrables d'autres unités, INC-064.

- **Le prédicat « renseigné » de l'interface divergeait de la garde sur les blancs non-espaces** —
  décision 165, INC-052 seconde occurrence. `webapp/src/lib/valeur-renseignee.ts` transcrivait la
  clause « chaîne vide après `btrim` » du §6.6 par `String.prototype.trim()`. MESURÉ contre la base
  réelle : `btrim(texte)` sans second argument ne retire que l'espace U+0020, là où `trim()` retire
  toute l'espace blanche Unicode. Une valeur réduite à `"\t"` ou `"\n"` est donc **renseignée** pour
  `app.valeur_de_champ_est_vide` et satisfait un champ `required` — l'interface, elle, l'annonçait
  vide et la transition bloquée. C'est exactement le défaut que le §4.3 existe pour rendre
  impossible, et il était livré. **Reproduit avant d'être corrigé** : les deux cas ajoutés au
  tableau de cas partagé ont rendu deux tests unitaires **et** deux scénarios d'API rouges contre la
  base, avant qu'une ligne du prédicat ne soit touchée. Corrigé en **reproduisant fidèlement
  `btrim`**, jamais en élargissant la règle : ce que le produit tient pour vide reste une décision
  ouverte (INC-052). `scripts/verify-formulaire.sh` gagne la dégradation **D2 bis**, qui remet
  `trim()` en place et confronte le résultat à la base — seule cette confrontation attrape ce
  défaut. Le mécanisme de comparaison était bon ; le tableau ne contenait pas le cas.
### Ajouté

- **`CRM-037` — le formulaire conditionnel d'une card est rendu, et il a un écran.** Première unité
  du chunk 3 à livrer une route affichant une donnée métier :
  `/tracks/:slugTrack/:slugChannel/cards/:idCard`, seul hôte possible du formulaire — le procédé de
  `CRM-021`, qui avait livré la route d'un track parce que la barre d'onglets n'en avait aucun.
  Rien d'autre du détail de card n'est livré : timeline, commentaires et champs d'en-tête restent
  dus par `CRM-044`, `CRM-043` et `CRM-040`.
  - **La composition part des champs, jamais des règles** (`docs/SPEC-form-composer.md` §4.1) :
    l'absence de règle vaut `visible`, et une lecture par les règles perdrait tous les champs par
    défaut. MESURÉ sur le seed : à `Prospection`, cinq règles pour six champs actifs.
  - **Trois destinations, dont une que le §4 ne nommait pas** : formulaire de l'étape, section
    repliée « Informations d'autres étapes » — qui recueille aussi les valeurs des champs
    **archivés**, ce que le §5 posait depuis `CRM-000` sans que le §4 le dise —, et rien du tout.
  - **L'interface et la garde lisent « renseigné » de la même façon, et c'est mesuré.** Le §6.6
    l'exigeait sans qu'aucune preuve ne le tienne. Un tableau de cas partagé de douze valeurs vit
    dans `webapp/src/lib/valeur-renseignee.ts` ; le test unitaire l'exerce contre le prédicat
    TypeScript, et `e2e/api/rendu-formulaire.spec.ts` écrit **les mêmes valeurs** dans de vraies
    lignes `card_field_values`, par la vraie route, puis lit le jugement de `move_card`. La card ne
    bouge jamais : `budget` étant vide par contrat de seed, c'est la liste des clés manquantes qui
    porte l'information, et le seed sort intact.
  - **Accessibilité prouvée sur le composant réel** : `for`, astérisque décoratif doublé d'un texte
    lisible par lecteur d'écran, mention « requis pour passer à <étape> », `role="alert"` cité par
    `aria-describedby`, `aria-invalid`, section repliée ouverte **au clavier** dans le navigateur.
  - **Aucune écriture, et l'écran dit pourquoi** : enregistrer exige une session (INC-021). Les
    contrôles sont indisponibles et restent lisibles, ce que `docs/DESIGN_SYSTEM.md` §8 exige.
  - Preuves : `npm run test:unit` **227 tests** (164 auparavant), `npm run e2e:api` **306
    scénarios** (291), `npm run e2e:ui` **47 scénarios** (37), `npm run test:sql` **1164
    assertions** inchangées, `scripts/verify-formulaire.sh` **45 contrôles** avec six dégradations
    volontaires qui le font réellement échouer, huit captures produites **et observées**.
  - **Le parcours « transition bloquée → saisie → transition réussie » de la Definition of Done
    n'est pas atteignable** : il exige une session et un contrôle de transition dû par `CRM-041`,
    que le plan ordonne après cette unité. **INC-062**, trois options, arbitrage attendu. L'unité
    reste `[~]`.

### Corrigé

- **Une case à cocher de 20 px n'existait pas dans le CSS produit** — décision 162, trouvée par
  `scripts/lib/classes-css.mjs` et non à l'œil. L'échelle d'espacement de `docs/DESIGN_SYSTEM.md`
  §3 est fermée et `--spacing-5` n'est pas déclarée : la classe `size-5` n'était **pas engendrée du
  tout**, en silence, et la case perdait sa taille. Portée à `size-6` (24 px), valeur de l'échelle.
  Deuxième occurrence du mode de défaillance qui avait fait disparaître `min-w-0` à `CRM-007`.

- **Un harnais déclarait vert un rejeu de migrations qu'il n'attendait pas, et rendait la main sur
  une base à moitié migrée** — INC-060, décision 157. L'étape 2 de `scripts/verify-authz.sh`
  enchaînait `docker compose up -d migrations-runner` et la lecture de `.State.ExitCode`. MESURÉ :
  l'inspection lit `0` alors que `Status` vaut encore `running` — c'est le code de l'exécution
  **précédente**. Deux conséquences : le contrôle était **complaisant**, et le harnais rendait la
  main pendant que le runner rejouait encore le répertoire. Entre les migrations 3 et 10,
  `tracks_lecture_membre` revenait à sa forme de `CRM-003` — les droits fins de `CRM-012` cessant
  d'être appliqués —, et `npm run test:sql` lancé dans cette fenêtre rendait **trois assertions
  rouges** dans `0011_droits_fins.test.sql`, dont la **preuve de refus n° 4**. Corrigé par
  `docker compose run --rm`, **synchrone**, et par un contrôle de plus qui vérifie l'**état final
  de la base** plutôt qu'un code de conteneur. Troisième occurrence du mécanisme des décisions 108
  et 135. Aucun comportement du produit n'est modifié.
  **`scripts/verify-migrations.sh` porte le même défaut et n'est pas corrigé** : livrable de
  `CRM-003`, unité `[x]` — INC-060, arbitrage attendu.
- **Un harnais de preuves désactivait la garde centrale de `CRM-034` derrière lui** — INC-055,
  décision 143. `scripts/verify-cards.sh` restaurait son état en rejouant `0011_cards.sql` **seul**,
  dont la section 7 rend à `authenticated` l'`UPDATE` de table sur `cards` — ce que
  `0012_move_card.sql` retire précisément pour rendre `move_card` incontournable. MESURÉ sur une
  base saine, avant et après son passage : le privilège passait de `false` à `true`, et
  `npm run test:sql` de « aucune anomalie » à **huit assertions en échec**. Le harnais annonçait
  pendant ce temps « aucune anomalie » : il disait vrai de ce qu'il mesurait, et laissait derrière
  lui une base où la porte qu'il venait de vérifier était rouverte. **Le défaut est antérieur à
  `CRM-036` : il date de `CRM-034`.** Il rejoue désormais sa migration **et celles qui la
  complètent**, c'est-à-dire ce que le `migrations-runner` produit. Aucun comportement du produit
  n'est modifié.
- **Une dégradation qui ne prouvait plus rien, réécrite plus fort.** Découverte par la correction
  ci-dessus : la dégradation *b* de `scripts/verify-cards.sh` exerçait le `WITH CHECK` de
  `cards_maj` par un `PATCH` de `channel_id`, colonne fermée au niveau **privilège** depuis
  `CRM-034`. Elle ne l'exerçait donc que grâce à l'état dégradé décrit ci-dessus — c'est-à-dire
  grâce au défaut lui-même. Réécrite **en deux temps** — refus par le seul privilège, puis
  `WITH CHECK` réellement exercé une fois le privilège rendu —, elle mesure désormais chaque
  barrière séparément. Le harnais passe de 37 à **38 contrôles hors suites** (44 à 45 au total).

### Ajouté

- **L'identité Git de l'exécution a dû être corrigée, et le fait est consigné** — INC-034 point 2,
  troisième occurrence, décision 159. Le conteneur neuf rend `user.email` =
  `noreply@anthropic.com` ; le commit documentaire de l'unité a été créé et poussé sous cette
  identité avant que l'écart ne soit vu. Configuration locale reposée à
  `P2Enjoy <contact@p2enjoy.studio>`, les deux commits de l'exécution réécrits et republiés. Aucun
  commit antérieur n'est touché. Le correctif durable — script d'amorçage ou variable
  d'environnement — reste dû.
- **`CRM-010` est close : ses six fonctions sont enfin toutes prouvées, et INC-013 s'éteint.**
  Les quatre fonctions qu'INC-013 avait retirées à l'unité faute de tables — `app.can_read_track`,
  `app.can_read_channel`, `app.can_write_channel`, `app.can_read_card` — existent depuis `CRM-012`
  et `CRM-040`. Sa Definition of Done n'est **pas** réécrite à quatre : elle est redevenue
  satisfaisable telle qu'elle est, et l'unité a été reprise pour la satisfaire (décision 155).
  - `docs/SPEC-permissions-rls.md` **§3.8**, écrit après mesure et committé avant tout code : les
    trois exigences rendues vérifiables — l'égalité que les quatre fonctions doivent respecter, le
    tableau des six cas de récursion avec leurs résultats mesurés, et le recensement des
    `SECURITY DEFINER`.
  - **La matrice à travers des lignes réelles** — ce qu'INC-013 nommait comme manquant : 64
    triplets construits par des lignes distinctes, aucune divergence avec `app.resolve_access`, et
    une discrimination qui interdit l'oracle dégénéré — 10 tracks sur 16, 38 channels sur 64 en
    lecture, 27 sur 64 en écriture. `can_read_card` délègue strictement à `can_read_channel`.
  - **L'absence de récursion démontrée en la provoquant sur `tracks`, `channels` et `cards`** : la
    fonction livrée répond avec le filtrage exact de la matrice, sa jumelle `SECURITY INVOKER`
    épuise la pile en **`54001`**, les trois fois. `docs/SPEC-permissions-rls.md` §3.3 l'affirmait
    depuis `CRM-012` sans qu'aucune assertion ne le tienne.
  - **Le `search_path` devient un recensement** plutôt qu'une liste : aucune fonction
    `SECURITY DEFINER` d'`app` ou de `public` sans `search_path` vide — 18 sur 29 —, et la preuve
    tombera d'elle-même le jour où une unité en ajoutera une sans le sien.
  - **Preuve d'intégration hors interface sur les quatre fonctions** : sous PostgREST, avec les
    jetons réels des trois profils du seed, `tracks`, `channels` et `cards` rendent 4/6/9 à
    l'administratrice et au business developer, **3/4/4** au `viewer` fermé sur un track par un
    droit fin, et zéro ligne avec un `200` à l'anonyme.
  - `supabase/tests/0002_fonctions_autorisation.test.sql` passe de 128 à **153 assertions** ;
    `scripts/verify-authz.sh` de 26 à **35 contrôles**, dont **quatre dégradations nouvelles** qui
    font tomber la suite lorsque l'une des quatre fonctions est réécrite de travers.
  - **Aucune migration n'est modifiée** : le produit est inchangé, ce sont ses preuves qui le
    rattrapent.
  - **Un garde-fou figé a échoué comme prévu et a été révisé** : le compteur d'assertions de
    `scripts/verify-harness.sh` passe de 1139 à **1164**, dans le même changement que les preuves
    qu'il compte. `SCENARIOS_API` et `SCENARIOS_UI` restent à 291 et 37.
  - **Deux anomalies relevées par le rejeu des vingt-trois harnais ne viennent pas de cette unité,
    et aucune n'est masquée** : `scripts/verify-scripts.sh` 51 sur 52 (INC-044, défaut d'hôte
    connu) et `scripts/verify-cards.sh` 44 sur 45 — **défaut réel et nouveau, INC-061** : sa
    section 10 rejoue `npm run test:sql` avant que son `trap` ne retire ses cinq cards de preuve,
    et trois assertions de `0015_colonnes_protegees.test.sql` comptent les neuf cards du seed.
    Livrable de `CRM-040`, non corrigé ici — arbitrage attendu.

- **`CRM-014` — les douze preuves de refus sont rassemblées, comptées, et l'absence des cinq
  impossibles est figée.** `e2e/api/preuves-refus.spec.ts`,
  `supabase/tests/0016_preuves_refus.test.sql`, `scripts/verify-preuves-refus.sh`,
  `docs/SPEC-permissions-rls.md` §7.1 à §7.4.
  - **Sept preuves sur douze sont acquises, et le périmètre est mesuré, non estimé** (décision 146).
    Les douze scénarios de `docs/SPEC-permissions-rls.md` §7 ont été rejoués à la main contre la
    pile réelle **avant** d'écrire la spécification : n° 1 à 5, n° 10 et n° 11 sont livrables ; les
    n° 6, 7, 8, 9 et 12 portent sur des tables ou une fonction **qui n'existent pas**.
  - **La preuve n° 3 sur les cards n'existait nulle part**, alors que l'en-tête de
    `e2e/api/cards.spec.ts` l'annonçait — INC-057, consignée sans être corrigée dans le fichier
    d'une autre unité. Elle est livrée ici, sur une chaîne complète créée dans un second workspace
    — workspace, track, workflow, nœud, étape, channel, card —, constatée présente avec la clé de
    service puis invisible aux trois profils du workspace A.
  - **La preuve n° 11 passe de trois tables à douze.** `CRM-008` l'exerçait sur les seules tables du
    socle, `track_members` et `channel_members` étant alors vides. Les douze tables métier sont
    aujourd'hui peuplées et **énumérées**, jamais échantillonnées.
  - **La preuve n° 10 obtient son effet sans porter sa règle, et le dit** (décision 148). Un
    administrateur qui tente de se retirer son rôle est bien sans effet — mesuré —, mais parce que
    `workspace_members` ne porte **aucune** politique (INC-014), non parce qu'une règle protège le
    dernier administrateur. Trois assertions figent ce zéro : le jour où INC-014 sera arbitrée,
    elles deviendront rouges, et c'est alors que la règle devra être écrite.
  - **Les cinq absences sont figées par des assertions**, jamais compensées par une preuve de
    substitution : `404` / `PGRST205` pour une table, `404` / `PGRST202` pour une fonction,
    inventaire vide pour `storage.buckets`. Chacune deviendra rouge à la naissance de son objet.
  - **UNE PRÉDICTION DE LA SPÉCIFICATION ÉTAIT FAUSSE, ET LA DÉGRADATION L'A ÉTABLIE**
    (décision 151). Le §7.4 annonçait que retirer `cards_lecture` ferait échouer trois scénarios ;
    MESURÉ, **aucun** n'échoue et le fichier reste vert sur ses trente-sept. Ce n'est pas un défaut
    du fichier mais une propriété structurelle : une suite de preuves de refus mesure une **borne
    supérieure** des droits — un produit devenu plus strict satisfait toutes ses assertions. La
    détection du sur-refus est donc portée par l'inventaire pgTAP des 41 politiques, et celle du
    sur-accès par les scénarios. La spécification est corrigée, pas le contrôle relâché.
  - **Test unitaire dédié** : `supabase/tests/0016_preuves_refus.test.sql`, **46 assertions** —
    l'inventaire des politiques nom par nom **et** par un compte, la RLS activée sur toutes les
    tables, les douze conditions de validité de la preuve n° 11, les causes en base des preuves
    n° 1, 4 et 5, et les sept assertions d'absence.
  - **Test d'intégration dédié, hors interface** : `e2e/api/preuves-refus.spec.ts`, **37
    scénarios**, avec les jetons réels des trois profils obtenus par la véritable route de
    connexion.
  - **Harnais rejouable et non complaisant** : `scripts/verify-preuves-refus.sh`, **26 contrôles**,
    21 hors suites. Il dégrade réellement le produit **dans les deux sens** — politique retirée,
    politique permissive —, mesure ce qui échoue et **où**, et compare l'inventaire des politiques
    à celui relevé avant dégradation.
  - **Il ne rejoue aucune migration** (décision 150). Quatre harnais ont laissé la base dégradée en
    rejouant un préfixe incomplet de l'historique (INC-055) ; celui-ci recrée la politique retirée
    à partir de sa définition **lue en base** avant retrait, jamais réécrite de mémoire.
  - Compteurs de `scripts/verify-harness.sh` révisés dans le **même** changement : 1093 → **1139**
    assertions, 254 → **291** scénarios d'API.

- **`CRM-013` — l'adresse d'une affaire cesse d'être réécrivable.**
  `supabase/migrations/0014_colonnes_protegees.sql`, `docs/SPEC-permissions-rls.md` §4.4.
  - **`cards.email_local_part` n'est plus modifiable par un client.** Le privilège `UPDATE` est
    retiré à `authenticated` sur cette seule colonne, par la forme énumérative que PostgreSQL
    impose : `revoke update` de table, puis `grant update (…)` sur les **douze** colonnes qui
    restent ouvertes.
  - **Ce que cela corrige était une propriété de sécurité fausse, pas un confort.** MESURÉ avant
    correction, avec le jeton réel de l'administratrice : un `PATCH` remplaçait les quarante bits
    de hasard de l'adresse par `c-00000000`, en `200`. La non-devinabilité sur laquelle
    `docs/SCHEMA.md` §5 fonde l'adresse entrante d'une affaire était rendue au client par une
    simple mise à jour.
  - **La lecture reste ouverte, et l'insertion inchangée.** Une adresse de card est une
    **identité**, non un secret. Et le chemin d'insertion était déjà sûr — MESURÉ : le trigger de
    `CRM-040` écrase la valeur fournie. Le fermer aurait refusé une requête que le produit accepte
    sans dommage.
  - **INC-050 est close, par exécution et non par arbitrage** : les deux branches attendues ne
    portaient que sur l'attribution de la colonne à une unité, non sur son état final. L'état posé
    coïncide désormais exactement avec le bloc `GRANT` du §5.5 de `docs/SPEC-workflow-engine.md`.
  - **Preuves** : `supabase/tests/0015_colonnes_protegees.test.sql` (41 assertions),
    `e2e/api/colonnes-protegees.spec.ts` (12 scénarios, jetons réels des trois profils),
    `scripts/verify-colonnes-protegees.sh` (50 contrôles, non complaisant).
  - **`CRM-013` reste `[~]`** : cinq de ses six cibles portent sur des tables qui n'existent pas
    encore, et les preuves de refus n° 6 et n° 8 restent hors d'atteinte. Chaque absence est figée
    par une assertion qui deviendra rouge à la naissance de sa table.

- **`CRM-036` — les valeurs de formulaire, et la sixième vérification de `move_card`.**
  `supabase/migrations/0013_valeurs_champs.sql`, `docs/SPEC-form-composer.md` §6.
  - **La table `public.card_field_values`**, réponse d'une card aux questions de son workflow, avec
    sa clé primaire composite `(card_id, field_id)` : une card porte au plus une valeur par champ.
  - **Trois clés étrangères composites** articulées autour de `workflow_id` : une valeur ne peut
    **pas** répondre, pour une card donnée, à la question d'un autre workflow. MESURÉ dans les deux
    sens. La première exigeait une unicité que `cards` ne portait pas — `UNIQUE (id, workflow_id)`
    lui est ajoutée, sans changer aucun comportement puisque `id` est déjà clé primaire.
  - **La validation par type est un trigger, et un `CHECK` ne pouvait pas la porter** : MESURÉ,
    « cannot use subquery in check constraint ». Les quinze types sont validés — `money` refuse une
    chaîne, `checkbox` refuse « true », `date` refuse ce qui ne se convertit pas, `url` refuse
    `javascript:`, et **un `select` refuse une clé absente de ses `choices`**, ce qui clôt le point
    ouvert n° 4 du §8 du côté qui compte, celui des réponses.
  - **LA SIXIÈME VÉRIFICATION DE `move_card` EST ÉCRITE — INC-047 est close.** `CRM-034` en livrait
    cinq sur six. La sixième contrôle l'**union** des champs `required` de l'étape cible et des
    `require_fields` de la transition empruntée, **moins** les champs archivés et les identifiants
    que la jointure ne résout pas. Refus `missing_required_fields`, `400`, dont le `DETAIL` porte
    **la liste des clés manquantes** ordonnée par position — le message que la Definition of Done de
    `CRM-034` nommait sans pouvoir le livrer.
  - **`app.valeur_de_champ_est_vide`**, seule définition de « non renseigné » du produit :
    `NULL`, `'null'::jsonb`, chaîne vide ou d'espaces, tableau vide. `false`, `0` et `"0"` sont des
    **réponses** — confondre les deux rendrait une case à cocher impossible à satisfaire par la
    négative.
  - **`app.can_write_card`**, symétrique d'`app.can_read_card` : une table fille ne dispose que d'un
    `card_id`, et aucune politique d'écriture ne peut atteindre le channel sans cette jointure.
    `app.can_read_card`, livrée sans usage par `CRM-040`, a ici son **premier appelant réel**.
  - Trois politiques RLS, **aucune suppression exposée** — vider un champ, c'est écrire une valeur
    vide —, et un refus **double** : ni privilège `DELETE`, ni politique.
  - **Seed repris dans le même changement** : quatorze valeurs sur six cards, dont une **vidée
    explicitement** pour que « une ligne présente n'est pas une valeur renseignée » soit démontré en
    permanence, une portée par un champ **archivé**, et une paire de cards à la même étape dont
    l'une passe et l'autre non. `require_fields` cesse d'être vide : « Démarrer la réalisation »
    exige `lien-proposition`, seule donnée qui exerce le second membre de l'union.
  - `supabase/tests/0014_valeurs_champs.test.sql` : **98 assertions**.
    `e2e/api/valeurs-champs.spec.ts` : **22 scénarios**, jetons réels des trois profils.
    `scripts/verify-valeurs-champs.sh` : **33 contrôles**, éprouvé par trois dégradations réelles.

### Corrigé

- **Trois garde-fous mesuraient l'âge de la base, non le produit — INC-056.** Sur une base créée de
  zéro, trois contrôles de `CRM-031`, `CRM-035` et `CRM-036` échouaient : ils comptaient à l'échelle
  du workspace les transitions à `require_fields` non vide, et le seed pose ce tableau **avant** de
  créer la copie de workflow, laquelle en hérite (INC-037). Le comportement du produit est
  **inchangé** ; les trois contrôles comptent désormais sur le workflow global, et l'héritage de la
  copie est compté séparément plutôt que masqué.
- **Un harnais laissait le produit dégradé en sortant, et c'est `npm run test:sql` qui l'a dit.**
  La première écriture de `scripts/verify-colonnes-protegees.sh` rejouait la migration 12 puis la
  14, sans la 13 — qui redéfinit `move_card` avec sa sixième vérification. Troisième occurrence du
  même mode de défaillance (décisions 108, 135). La séquence de restauration est désormais
  12 → 13 → 14, et un contrôle explicite constate que `move_card` a retrouvé sa sixième garde.
- **`scripts/verify-valeurs-champs.sh` rouvrait `cards.email_local_part` en sortant**, et
  annonçait pendant ce temps « 33 contrôles, aucune anomalie ». Il rejoue la migration 12 en trois
  endroits sans rejouer la 14 derrière — un défaut que la livraison de `CRM-013` a **créé
  rétroactivement**, ce harnais étant antérieur à cette migration. La 14 suit désormais chacun des
  trois rejeux, le ménage de sortie la rejoue, et un contrôle neuf **constate** la colonne
  refermée. `scripts/verify-cards.sh` reçoit la même chaîne.
- **Les vingt-deux harnais ont été passés un par un**, l'état du privilège étant relevé après
  chacun : c'était le seul à fuir.

- **`value` est nullable, et une mesure l'a imposé — INC-054.** `docs/SCHEMA.md` §4 exigeait
  `NOT NULL` avec `'null'::jsonb` pour « explicitement vide ». MESURÉ : PostgREST convertit un
  `null` JSON en **SQL NULL** et ne sait produire `'null'::jsonb` par aucune écriture. La contrainte
  rendait donc « vider un champ `money` » **impossible depuis le produit** — chaîne vide refusée par
  la validation de type, SQL NULL par la colonne, aucune suppression exposée. Défaut trouvé par
  l'échec du **seed**, premier client réel du produit.
- **Un `revoke all` manquait sur `card_field_values`, et le « refus double » n'existait pas.**
  MESURÉ : les privilèges par défaut de l'image Supabase accordent `DELETE`, `INSERT` et `UPDATE` à
  `anon` **et** `authenticated` sur toute table neuve — c'est la décision 80 sur les *fonctions*,
  dont la conséquence pour les *tables* n'avait jamais été tirée. Défaut trouvé par la suite pgTAP
  de l'unité elle-même, corrigé dans le même changement.
- **Deux lignes du contrat d'API corrigées après mesure**, plutôt que les tests relâchés : une
  violation de clé étrangère rend `409` et non `400` ; un `DELETE` refusé à un rôle **authentifié**
  rend `403` et non `401`.

### Modifié

- **Six garde-fous figés par des unités précédentes sont devenus rouges comme prévu, et ont été
  révisés — aucun n'a été retiré** (mécanisme de la décision 51, neuvième occurrence) : les deux
  assertions d'INC-047 dans `0013_move_card.test.sql` et `move-card.spec.ts` sont **retournées** ;
  les trois constats de `require_fields` vide **comptent** désormais ; et l'assertion d'absence de
  `card_field_values` dans `0012_cards.test.sql` constate la présence, plus la conséquence qui
  comptait — `app.can_read_card` a son premier appelant.
- **INC-037 est aggravée, non corrigée** : MESURÉ, `copy_workflow_to_track` recopie le
  `require_fields` de sa source, alors que la copie ne reçoit aucun champ. Une exigence déclarée sur
  une copie n'exige donc **rien**. Le comportement reste inchangé — il appartient à `CRM-032` — et
  l'écart est **compté** par un scénario.
- `docs/SPEC-permissions-rls.md` §3.7 et §4, `docs/SCHEMA.md` §4, `docs/SPEC-workflow-engine.md`
  §5.3, §5.7, §5.9, §8 et §9, `docs/SPEC-seed.md` §2.13, `docs/PROD_MIGRATIONS.md` §3,
  `docs/DAT.md`, `docs/manual.md` chapitres 4.3, 5, 6, 23 et 24, `webapp/src/lib/database.types.ts`
  et son test de types mis à jour dans le même changement.

### Ajouté (unités précédentes)

- **`CRM-034` — `move_card` : le graphe du workflow devient opposable.**
  `supabase/migrations/0012_move_card.sql`, `docs/SPEC-workflow-engine.md` §5.
  - **La fonction `public.move_card(card_id, to_step_id, comment)`**, seul chemin par lequel une
    card change d'étape. Elle rend la ligne mise à jour — donc un **objet** JSON pour PostgREST, non
    un tableau —, ce qui évite au client une relecture qu'une politique pourrait refuser entre-temps.
  - **Cinq vérifications, dans un ordre qui compte** : la card existe, est visible et **active** ;
    l'appelant a le droit d'**écriture** sur son channel ; l'étape cible appartient au workflow de la
    card ; une transition est **déclarée** de l'étape courante vers elle ; le commentaire est fourni
    si la transition l'exige. Une card archivée ou en corbeille est traitée comme absente.
  - **La règle de discrétion** : une card d'un channel fermé par un droit fin rend `card_not_found`,
    jamais `forbidden` — répondre « interdit » confirmerait son existence à qui n'a pas le droit de
    la connaître. Un lecteur de son propre workspace obtient bien `forbidden`.
  - **`entered_step_at` remise à l'instant du déplacement** et **`position` recalculée en fin de la
    colonne d'arrivée** : le trigger d'attribution de `CRM-040` est un `BEFORE INSERT` et ne voyait
    pas les déplacements, ce qui aurait laissé deux cards au même rang.
  - **LA PROTECTION DE COLONNE, sans laquelle la garde ne garderait rien.** `authenticated` perd
    l'`UPDATE` de **table** sur `cards` ; treize colonnes lui sont rendues nommément. Mesuré avec le
    jeton réel de l'administratrice : `PATCH` de `current_step_id` → **`403`/`42501`**, `PATCH` de
    `description` → `204`. C'est la **preuve de refus n° 5** de `docs/SPEC-permissions-rls.md` §7,
    et le chevauchement de Definition of Done avec `CRM-013` est tranché de ce côté (INC-049).
  - **Preuve de refus n° 1 acquise**, et la discrétion prouvée **par le même jeton** dans ses deux
    sens — seule façon d'exclure que l'écart vienne du profil plutôt que de la règle.
  - `supabase/tests/0013_move_card.test.sql` : **73 assertions**, les cinq vérifications chacune
    dans les **deux** sens, les colonnes ouvertes énumérées une par une, et le contournement refusé
    sous le rôle réel.
  - `e2e/api/move-card.spec.ts` : **26 scénarios** hors interface, les treize lignes du contrat du
    §5.8, chaque refus **relisant la ligne** pour la constater inchangée.
  - `scripts/verify-move-card.sh` : **56 contrôles**, éprouvé par **trois dégradations réelles** —
    privilège de colonne rendu, `anon` retrouvant `EXECUTE`, vérification n° 4 retirée. Il prouve en
    outre la **convergence** : un `grant update on public.cards to authenticated` posé à la main est
    **refermé** par un rejeu de la migration.

### Modifié

- **Quatre assertions figées par des unités précédentes ont été retournées**, aucune retirée
  (mécanisme de la décision 51, onzième occurrence) : trois dans `supabase/tests/0012_cards.test.sql`
  — dont un `lives_ok` devenu `throws_ok` et un droit de **table** devenu un droit de **colonne** —,
  et une dans `webapp/src/lib/database.types.test-d.ts`, qui annonçait littéralement « une fonction
  de plus les rendrait rouges ».
- `webapp/src/lib/database.types.ts` régénéré : `move_card` est la deuxième fonction appelable de
  `public`, et son type de retour confirme qu'elle rend la ligne.
- `README.md` : `scripts/verify-cards.sh` et `scripts/verify-droits-fins.sh` manquaient à la liste
  des harnais, omission de leurs unités respectives ; ajoutés avec `scripts/verify-move-card.sh`.

### Limites nommées

- **La sixième vérification n'est pas écrite** — INC-047. « Les champs requis de l'étape cible sont
  renseignés » lit `card_field_values`, due par `CRM-036`. Refuser toute transition dont l'ensemble
  exigé n'est pas vide interdirait — mesuré sur le seed — les entrées en négociation, en signature
  et les **quatre** transitions « Marquer perdu », c'est-à-dire le parcours que la garde est censée
  garder ; prétendre vérifier sans vérifier serait un faux vert. **Le message listant les clés
  manquantes n'existe donc pas non plus.** `CRM-034` reste `[~]`.
- **Le commentaire fourni n'est conservé nulle part** — INC-048, `CRM-043`. Il est exigé, contrôlé,
  et perdu.
- **Aucun `card_event`** n'est écrit (`CRM-044`), et aucune cadence de relance n'est arrêtée : aucune
  table n'en porte, aucune unité n'en prévoit.
- **Aucun écran, aucune capture** : le board est `CRM-041`, et la webapp reste un appelant anonyme
  faute d'écran de connexion (INC-021) — onzième unité consécutive.
- **Trois contradictions relevées et NON résolues**, consignées pour arbitrage : INC-050, le §5.5 se
  contredit sur `email_local_part` — comportement **laissé inchangé**, la colonne reste ouverte
  jusqu'à `CRM-013` ; INC-051, la ligne i du §5.8 nomme un profil que le seed ne peut pas mettre en
  défaut ; INC-052, « un commentaire vide n'est pas un commentaire » ne refuse pas une tabulation,
  `btrim` à un argument ne retirant que des espaces.

### Contrat de déploiement

- **Migration 12 — changement de contrat pour tout appelant existant.** `authenticated` perd
  l'`UPDATE` de table sur `cards` : toute intégration qui écrivait `current_step_id` par un `PATCH`
  direct recevra `403` et **doit passer par `move_card`**. `service_role` n'est pas touché.
  `docs/PROD_MIGRATIONS.md` §3 en porte le détail, le contrôle préalable et le retour arrière.

### Ajouté

- **`CRM-040` — les cards : l'objet métier principal existe enfin.**
  `supabase/migrations/0011_cards.sql`, `docs/SPEC-cards.md`.
  - **La table `public.cards`** : titre, description, responsable, montant et devise, probabilité de
    surcharge, prochaine action et échéance, position fractionnaire, archivage, corbeille, et une
    colonne générée `search_tsv` indexée en GIN. Cinq index, dont l'unicité **globale** de l'adresse.
  - **Trois clés étrangères composites plutôt que trois triggers** (décision 109) : une card ne peut
    mentir ni sur son workspace, ni sur le workflow de son channel, ni sur l'appartenance de son
    étape à ce workflow. La troisième livre **gratuitement la vérification n° 3 des six de
    `move_card`**, que `CRM-034` n'aura pas à écrire.
  - **L'adresse email de la card est générée** — `c-<8 caractères base32 Crockford>`, environ
    1,1 × 10¹² possibilités —, et une valeur fournie par le client est **ignorée et remplacée**. La
    boucle de réessai du trigger ne garantit rien : c'est l'index unique qui garantit, et le §3.3 de
    la spécification le dit explicitement (décision 112).
  - **`app.can_read_card` est livrée, et INC-013 est close** — la quatrième et dernière des fonctions
    d'autorisation différées. Elle n'est **pas** employée par les politiques de `cards`, qui jugent
    sur `channel_id`, colonne de la ligne : une politique qui relirait sa propre table ferait rendre
    `403` à toute création (décision 110, leçon de la décision 107). Ses appelants sont les tables
    filles à venir.
  - **Les droits fins s'appliquent dès la première card** : contrairement à `tracks` et à `channels`,
    cette table naît avec `app.can_read_channel` et `app.can_write_channel` dans ses politiques.
    INC-024 et INC-030 n'ont pas d'équivalent ici.
  - **La garde d'archivage d'un nœud occupé est écrite, et INC-031 est close** (décision 111). Un
    nœud du catalogue qu'une card **active** occupe ne peut plus être archivé (`42501`,
    `node_occupied`) ; une card archivée ou en corbeille n'occupe rien. Deux harnais livrés par des
    unités précédentes l'exigeaient nommément.
  - **Archiver et mettre à la corbeille sont deux gestes distincts**, tous deux réversibles. Aucun
    privilège `DELETE` n'est accordé, à personne.
  - **Seed** : neuf cards, dont une archivée, une en corbeille et une sans responsable ni montant,
    sur quatre channels et trois tracks.
  - **Preuves** : `supabase/tests/0012_cards.test.sql` **88 assertions** ; `e2e/api/cards.spec.ts`
    **24 scénarios** avec les jetons réels des trois profils seedés ; `scripts/verify-cards.sh`
    **44 contrôles**, éprouvé par trois dégradations réelles.

### Corrigé

- **`docs/SPEC-cards.md` §6.1 rectifié avant d'être publié** : le `WITH CHECK` d'une politique
  `for update` y était présenté comme indispensable. MESURÉ sur une politique sonde, il ne l'est
  pas — PostgreSQL **réutilise le `USING`** lorsque `with check` est omis. La clause est conservée
  pour la lisibilité, le fait qu'elle soit redondante est écrit, et la dégradation du harnais la rend
  **permissive** plutôt que de la retirer : la retirer ne dégradait rien et rendait la preuve
  complaisante sans que rien ne le signale.

### Modifié

- **Sept assertions figées par des unités précédentes ont échoué comme prévu, et ont été révisées**
  (mécanisme de la décision 51, dixième occurrence) : dans `0002`, `0006`, `0007` et `0011`, ainsi
  que dans `scripts/verify-authz.sh`, `scripts/verify-catalogue.sh` et `scripts/verify-workflows.sh`.
  **Aucune n'a été retirée** : chacune est **retournée** — de « la fonction est absente » à « la
  fonction est livrée », de « deux triggers » à « trois triggers, et le troisième est nommé », et la
  dégradation d'INC-013 crée désormais l'inverse de ce qu'elle créait.
- **`e2e/api/coherence-workflow.spec.ts` K4 révisé, et dédoublé** : sur un channel **occupé**, c'est
  désormais la clé de `cards` qui refuse d'abord un workflow introuvable. Un second scénario, sur un
  channel vide, conserve la preuve d'origine de `CRM-033`.
- **`scripts/verify-coherence-workflow.sh`, dégradation a** : elle visait un channel du seed devenu
  occupé, et mesurait donc la clé de `CRM-040` au lieu du trigger de `CRM-033`. Elle porte désormais
  sur un channel **jetable**, créé pour elle et détruit aussitôt.

- **`CRM-012` — les droits fins par track et par channel deviennent opposables.**
  `supabase/migrations/0010_droits_fins.sql`.
  - **Trois des quatre fonctions `can_*`** que `docs/SPEC-permissions-rls.md` §3 annonçait depuis
    `CRM-000` sont livrées : `app.can_read_track`, `app.can_read_channel`, `app.can_write_channel`.
    Leur motif d'attente — la table de destination n'existait pas — est éteint depuis `CRM-020` et
    `CRM-021`. `app.can_read_card` reste différée, `cards` arrivant à `CRM-040` (INC-013,
    décision 103).
  - **Les politiques de lecture de `tracks` et de `channels` appliquent le droit fin** : un
    `track_members.access = 'none'` masque désormais le track **et tous ses channels**, et un
    `channel_members.access = 'member'` en rouvre un sous un track fermé. INC-024 et INC-030 sont
    closes.
  - **`track_members` et `channel_members` portent enfin des politiques** — aucun chapitre ne les
    nommait, lacune ouverte en INC-045. Lecture par l'administrateur du workspace **et** par
    l'intéressé pour sa propre ligne ; insertion, mise à jour et **suppression** réservées à
    l'administrateur, la suppression étant exposée parce que retirer un droit fin n'est pas
    supprimer une donnée mais revenir à l'accès hérité (décision 105).
  - **Un administrateur n'est jamais restreint** : une ligne restrictive posée sur son compte est
    acceptée, lisible, et sans effet tant qu'il administre. Le seed en pose une pour que la règle
    soit démontrée en permanence, et non seulement dans une suite de tests.
  - **Le seed pose quatre droits fins** (`docs/SPEC-seed.md` §2.11), un par situation de la matrice
    du §2.2. Farida Nowak ne voit plus que trois des quatre tracks, et un seul des trois channels
    de « Conseil & IA ». C'est la première fois qu'un compte du seed voit autre chose qu'un autre.
  - Preuves : `supabase/tests/0011_droits_fins.test.sql` (**71 assertions**),
    `e2e/api/droits-fins.spec.ts` (**15 scénarios**, les treize lignes du contrat d'API du §4.2 avec
    les jetons réels des trois profils), et `scripts/verify-droits-fins.sh`, non complaisant —
    éprouvé par trois dégradations réelles, chacune restaurée et la restauration **constatée**.

### Corrigé

- **`CRM-012` — une politique qui relit sa propre table casse `insert … returning`.** Défaut réel,
  introduit puis corrigé dans le même changement, et trouvé par les preuves de `CRM-020`. Le
  `RETURNING` d'un `INSERT` est soumis à la politique `SELECT` ; une fonction `STABLE` ne voit pas
  la ligne écrite par l'instruction en cours. Toute création de track ou de channel par un
  administrateur rendait `403`. Les politiques évaluent désormais les **colonnes de la ligne**
  (`app.resolve_track_access`, `app.resolve_channel_access`) au lieu de relire la table. Règle
  générale écrite en `docs/SPEC-permissions-rls.md` §3.5, régression figée par quatre assertions
  (décision 107).
- **`CRM-012` — un refus de suppression ne lève aucune erreur.** Le `USING` d'une politique
  `for delete` **filtre** les lignes : la commande réussit, rien n'est supprimé, PostgREST rend
  `200`. Une preuve de suppression refusée qui ne relit pas la ligne est verte que la règle tienne
  ou qu'elle ait été retirée. Le contrat du §4.1 et quatre assertions ont été corrigés en
  conséquence (décision 106).
- **`CRM-020`, `CRM-021` — deux scénarios d'API détruisaient des données du seed.** `T6` et `C6`
  supprimaient par prédicat des lignes de droits fins qu'ils n'avaient pas toutes créées, et
  amputaient le seed à chaque exécution de `npm run e2e:api`. Invisible tant que les tables
  restaient vides (décision 108).
- **`CRM-020` — `scripts/verify-tracks.sh` laissait le produit dégradé.** Il réappliquait
  `0003_tracks.sql` seule, ce qui ramenait `tracks_lecture_membre` à sa version sans droits fins.
  Il rejoue désormais la paire `0003` + `0010`, dans l'ordre du `migrations-runner`. La dépendance
  d'ordre est inscrite dans `docs/PROD_MIGRATIONS.md` §3.

- **`CRM-035` — un workflow porte désormais son formulaire.**
  `supabase/migrations/0009_champs_formulaire.sql`.
  - **`public.form_fields`** : les questions posées à propos d'une card, déclarées pour un
    **workflow** et non pour un channel. Quinze types, unicité **totale** de la clé par workflow —
    un champ archivé garde la sienne (décision 96) —, `position` attribuée par trigger dans la
    portée du workflow, et deux exigences d'options que la base tient plutôt que de laisser naître
    un formulaire cassé : un `select` a au moins un choix, un `money` a une devise ISO 4217
    (décision 94).
  - **`public.form_field_rules`** : la visibilité d'un champ à une étape — `hidden`, `visible`,
    `required` —, l'**absence** de règle valant `visible`. **Trois clés étrangères composites**
    articulées autour de `workflow_id` rendent structurellement impossible une règle croisant deux
    workflows, mesuré dans les **deux** sens : quel que soit le workflow déclaré, l'une des deux
    clés attrape l'erreur (décision 95).
  - **Sept politiques RLS** : lecture par les membres du workspace, écriture par les `admin`, et une
    asymétrie de suppression assumée — une **règle** se supprime, un **champ** s'archive, sans
    politique ni privilège `DELETE`. Le refus est double, et la dégradation n° 3 du harnais le
    prouve en accordant le privilège pour constater que la politique tient encore.
  - **Seed** : sept champs sur le workflow par défaut, dont **un archivé**, couvrant sept types ;
    quinze règles couvrant les trois visibilités, dont deux `visible` **explicites** ; et vingt-sept
    couples champ × étape laissés **sans règle**, sans quoi la valeur par défaut serait écrite sans
    être démontrée.
  - **Preuves** : `supabase/tests/0010_champs_formulaire.test.sql` (61 assertions),
    `e2e/api/champs-formulaire.spec.ts` (25 scénarios, jetons réels des trois profils),
    `scripts/verify-champs-formulaire.sh` (30 contrôles hors suites, trois dégradations réelles).
  - **Aucun écran** : la grille champ × étape suppose un écran d'administration authentifié
    (INC-021). Les règles sont prouvées en base et par l'API.
  - **Deux limites nommées, non masquées.** `required` est une **déclaration sans garde** tant que
    `move_card` n'existe pas (`CRM-034`, non commencée faute de cible — INC-043), et un workflow
    **copié** vers un track naît **sans champ** : `copy_workflow_to_track` n'en copie aucun, le
    comportement reste inchangé, et l'écart est **compté** par trois assertions révisées (INC-037,
    décision 93).

- **`CRM-033` — un channel suit désormais un workflow, et pas n'importe lequel.**
  `supabase/migrations/0008_coherence_workflow_channel.sql`.
  - **Deux triggers, pas un.** `channels_verifier_workflow` sur `public.channels`
    (`workflow_id`, `track_id`, `workspace_id`) et `workflows_verifier_portee_occupee` sur
    `public.workflows` (`scope`, `track_id`). La Definition of Done n'en demandait qu'un ; la mesure
    a établi que **deux des quatre** écritures capables de casser la cohérence passent par
    `workflows` — dont la bascule du workflow par défaut de `global` à `track`, qui invalidait d'un
    seul `UPDATE` le rattachement des six channels du seed. INC-040, décision 89.
  - **INC-029 soldée**, trois unités après son ouverture : `channels.workflow_id` est **non nulle**.
    Créer un channel exige de désigner un workflow, et **aucun défaut de colonne** ne l'adoucit
    (décision 91).
  - **`23514` pour le refus d'incompatibilité**, mesuré à `400` ; le trigger **se tait** lorsque le
    workflow est introuvable, la clé étrangère composite rendant `409` / `23503` en nommant
    elle-même la contrainte (décision 90).
  - **Preuves** : `supabase/tests/0009_coherence_workflow_channel.test.sql` (31 assertions),
    `e2e/api/coherence-workflow.spec.ts` (15 scénarios, jetons réels),
    `scripts/verify-coherence-workflow.sh` (26 contrôles hors suites, trois dégradations réelles).
  - **Aucun écran** : affecter un workflow à un channel suppose un écran d'administration
    authentifié (INC-021). La règle est prouvée en base et par l'API.

### Corrigé

- **`CRM-002` — `./runDev.sh` ne démarrait pas sur un poste WSL, pour quatre raisons d'hôte.**
  Aucune ne touche au métier ; toutes tenaient à ce que le dépôt supposait de l'hôte sans le
  vérifier. Chaque garde est inerte là où elle ne s'applique pas, ce qui explique que rien de tout
  cela n'ait jamais été visible dans le conteneur d'intégration. Décisions 98 à 101.
  - **Magasin d'identifiants Docker.** Un `credsStore` valant `desktop.exe` fait passer chaque
    accès au registre par un binaire Windows. Mesuré : **52 sorties vides sur 150 appels
    simultanés**, et Compose tire ses images en parallèle — d'où l'arrêt sur
    « error getting credentials ». `require_docker` dérive désormais une
    configuration Docker privée des assistants `.exe`, contexte, proxies et greffons conservés,
    hors du dépôt et en mode `600`.
  - **Ports déjà pris.** Quatre des dix ports publiés étaient tenus par un autre projet du poste.
    `require_free_ports` refuse **avant** tout démarrage, en nommant le port, son détenteur et la
    variable de `.env`. Les ports de la pile elle-même sont ignorés — les plages annoncées par
    Docker sont développées port par port —, et `runDev.sh --dev` écarte celui de la webapp.
  - **`storage` déclaré `unhealthy` alors qu'il allait bien.** Le service n'écoute qu'en IPv4 et
    son contrôle de santé visait `localhost`, que `/etc/hosts` résout aussi en `::1`. Le contrôle
    vise `127.0.0.1` (`docker-compose.yml`).
  - **Ce que la pile écrivait sur l'hôte lui échappait.** `./resetMe.sh` ne pouvait plus effacer le
    cluster PostgreSQL, refermé en `0750` par le compte du conteneur : la destruction passe par un
    conteneur jetable, sans `sudo`. `./runDev.sh` laissait un `node_modules` appartenant à `root` à
    la racine du dépôt, ce qui faisait ensuite échouer `npm install` en `EACCES` et **cinq preuves**
    sans rapport ; le point de montage est créé avant Compose.
  - **Preuves** : `scripts/verify-scripts.sh` passe de 38 à **52 contrôles**, dont 14 nouveaux sur
    ces gardes, et reste non complaisant — neutraliser les gardes en fait échouer 9. Démarrage
    à froid réel : `./resetMe.sh --yes` puis `./runDev.sh`, 11 services `healthy`,
    `verify-stack.sh` 33/33, `verify-seed.sh` 49/49.
- **`CRM-035` — deux contraintes `CHECK` ne refusaient rien, faute d'un `coalesce`.**
  Trouvé par la suite pgTAP de l'unité, dans le même changement que le code qu'elle vérifie.
  Écrites `type not in (…) or (jsonb_typeof(options -> 'choices') = 'array' and …)`, elles
  refusaient `{"choices": []}` et **laissaient passer l'absence pure** — qui est pourtant le cas le
  plus courant, `{}` étant le défaut de la colonne. La cause est la logique ternaire de SQL : un
  accès `jsonb` absent rend `NULL`, la conjonction rend `NULL`, et **un `CHECK` qui rend `NULL`
  accepte la ligne**. Les deux expressions sont enveloppées d'un `coalesce(…, false)`, et
  `jsonb_array_length` — qui **lève une erreur** sur un scalaire, dans un `AND` dont l'ordre
  d'évaluation n'est pas garanti — est remplacé par une comparaison `jsonb`. Décision 102.

- **`CRM-032` — le seed était idempotent sans être convergent, et il en créait des doublons.**
  INC-041. La copie du workflow était cherchée par sa source **et** son track ; le `track_id` déplacé,
  la recherche ne la trouvait plus et un rejeu en créait une **seconde**. Le contrat en déclare une.
  - **Reproduit en quatre gestes**, et corrigé en trois : recherche par la seule dérivation, track et
    nom **ramenés** aux valeurs déclarées, copies surnuméraires supprimées.
  - Troisième forme de la décision 57, et la **première sur un seed** — ce qui explique qu'aucun des
    garde-fous posés pour les deux précédentes ne l'ait vue.

### Modifié

- **Le seed crée le workflow par défaut avant les channels** (section 3 bis), que `NOT NULL` oblige à
  le désigner. Le `PATCH` de rattachement posé par `CRM-031` disparaît. `prospection` suit désormais
  la copie de portée `track` de son propre track, pour que le cas accepté le plus intéressant de la
  règle soit démontrable et non seulement documenté.
- **Sept garde-fous d'unités précédentes révisés** après être devenus rouges comme prévu : deux
  assertions pgTAP, une assertion de type, deux scénarios d'API, trois contrôles de harnais, et les
  compteurs de `scripts/verify-harness.sh` (622 / 110 / 37 → **653 / 125 / 37**). Décision 51,
  sixième occurrence.

### Documentation

- **`CRM-033` — spécification de la cohérence workflow ↔ channel, écrite après mesure et avant tout
  code.** `docs/SPEC-workflow-engine.md` §4.12 réécrit en huit sous-chapitres.
  - **Quatre portes mesurées, là où la spécification n'en nommait que deux** : les deux écritures
    connues passent par `channels` ; les deux autres passent par `workflows` — changer le `track_id`
    d'un workflow `track` sous ses channels, et faire passer le workflow par défaut de `global` à
    `track`, cette dernière invalidant d'un seul `UPDATE` le rattachement des **six** channels du
    seed. Les quatre ont été appliquées sur la base réelle et **acceptées**. INC-040.
  - **Deux triggers plutôt qu'un** : un invariant gardé d'un seul côté n'est pas un invariant
    (décision 89).
  - **`23514` et non `P0001`** pour le refus d'incompatibilité — les deux rendent `400`, mesuré, mais
    le premier dit de quelle nature est le refus. Le trigger **se tait** lorsque le workflow est
    introuvable : la clé étrangère composite rend alors `409` / `23503` en nommant la contrainte
    (décision 90).
  - **La dette `NOT NULL` d'INC-029 est datée** : posable sans reprise — mesuré, zéro ligne nulle —,
    elle change le contrat de création d'un channel et impose de réordonner le seed. Aucun défaut de
    colonne ne vient l'adoucir (décision 91).
  - **Un défaut réel du seed de `CRM-032` trouvé et reproduit** : la copie cherchée par sa dérivation
    **et** son track, un déplacement de la copie fait naître une **seconde** copie au rejeu. Troisième
    forme de la décision 57, la première sur un seed. INC-041, correction rattachée à `CRM-033`.

### Corrigé

- **`CRM-008` — un faux vert réel de l'exécuteur pgTAP, trouvé, reproduit et corrigé.**
  `scripts/run-sql-tests.sh` déclarait verte une suite que pgTAP déclarait tronquée.
  - **Cause mesurée** : pgTAP tient **deux** comptes — la numérotation des lignes, portée par une
    séquence que rien n'annule, et le compte relu par `finish()`, porté par une table qu'un
    `rollback to savepoint` annule. Une suite dont les **dernières** assertions sont prises dans un
    savepoint annulé émet donc exactement autant de lignes que son plan en annonce, et passait le
    quatrième contrôle du contrat.
  - **Mesuré en déposant le fichier dans `supabase/tests/`** : « 1 fichiers, 3 assertions, aucune
    anomalie », code de sortie `0`, alors que pgTAP annonçait « planned 3 but ran 1 » et que les
    deux dernières preuves n'avaient pas été enregistrées.
  - **Correction** : un **cinquième contrôle** au contrat de `docs/SPEC-test-harness.md` §3.2 —
    tout diagnostic `# Looks like you planned` fait échouer le fichier. Il compare le plan au compte
    **enregistré** là où le quatrième le compare aux lignes **émises**.
  - **Contrainte d'écriture** qui en découle, portée par le §3.2 : une suite se termine **hors
    savepoint**, par une assertion de fond.
  - **Régression figée** : septième dégradation de `scripts/verify-harness.sh`, qui constate
    d'abord que la suite piégée émet bien ses trois lignes — sans quoi le contrôle ne prouverait
    rien —, puis exige l'échec de `npm run test:sql`. Le harnais passe de **22** à **25 contrôles**.
  - **La cause laissée ouverte par la décision 76 est élucidée** : la différence entre les suites
    qui dérivent et celles qui ne dérivent pas tient à la **position du dernier `rollback`**.
  - **Aucune suite livrée n'était concernée**, vérifié fichier par fichier : les sept sont vertes,
    plan tenu, aucun diagnostic.


### Documenté

- **`CRM-032` — spécification de la copie d'un workflow vers un track, écrite après mesure et avant
  tout code.** `docs/SPEC-workflow-engine.md` §4 est réécrit : le chapitre datait de `CRM-000`,
  tenait en vingt-cinq lignes et n'engageait qu'une signature et une intention. L'algorithme de
  copie a été appliqué à la main sur la pile réelle dans une transaction annulée, et les codes HTTP
  relevés contre PostgREST avec le jeton réel de l'administrateur seedé ; sondes créées puis
  détruites, absence de reste constatée.
  - **Décision 80 — sur un objet neuf du schéma `public`, révoquer à `public` ne protège rien.**
    Mesuré : une fonction « protégée » par `revoke all … from public` reste **exécutable par la clé
    anonyme**, l'image livrant des `ALTER DEFAULT PRIVILEGES` qui accordent nommément à `anon`,
    `authenticated` et `service_role` l'exécution de toute fonction et **tous** les droits de toute
    vue nouvelle. Les rôles sont désormais révoqués nommément.
  - **Décision 81 — le `404` est atteignable, et il est écarté.** Mesuré : `P0001` → `400`,
    `P0002` → **`500`**, `42501` → `403`, `23505` → `409` ; et un `SQLSTATE` conventionnel `PGRST`
    permet bien d'imposer `404`. Il est refusé : une fonction SQL qui connaît les codes HTTP de son
    client cesse d'être portable.
  - **Décision 82 — un workflow d'un autre workspace rend « introuvable », jamais « interdit ».**
    La visibilité est vérifiée avant le rôle ; répondre « interdit » confirmerait l'existence de la
    ligne à qui n'a pas le droit de la connaître.
  - **Décision 83 — les arêtes sont remappées par le nœud**, clé naturelle d'une étape depuis
    l'unicité `(workflow_id, node_id)`. Mesuré : zéro arête de la copie ne pointe vers la source ;
    `is_default` doit être **forcé à faux**, faute de quoi la copie d'un workflow par défaut est
    refusée en `23505` ; les `position` fractionnaires sont conservées.
  - **Décision 84 — le signalement de divergence est une vue**, `security_invoker = true`, mesurée
    soumise à la RLS. Son angle mort est mesuré, non supposé : une **suppression** dans la source
    ne modifie aucun `updated_at` et n'est donc pas détectée.
  - **Décision 85 — une copie ne se copie pas** : un workflow déjà de portée `track` est refusé.
  - **`INC-037` ouverte** : la Definition of Done exige la copie de champs dont la table arrive à
    `CRM-035`.
  - **`INC-038` ouverte** : l'angle mort du signal de divergence, avec ses trois options.
  - **`INC-039` ouverte** : la suppression d'un workspace échoue en `23503` dès qu'un de ses
    workflows instancie ses nœuds — interaction mesurée entre deux clés étrangères correctes.

- **`CRM-031` — spécification des workflows, écrite après mesure et avant tout code.**
  `docs/SPEC-workflow-engine.md` §3 est réécrit : le chapitre datait de `CRM-000`, tenait en
  vingt-six lignes et n'engageait que l'intention. Trois tables sondes jetables ont été créées sur
  la pile réelle, éprouvées, puis détruites — l'absence de reste étant constatée.
  - **Décision 72 — « exactement une étape initiale » n'est pas imposable à l'écriture.** Mesuré :
    un `constraint trigger` différé accepte l'insertion isolée d'un workflow puis **fait échouer le
    `commit`**, c'est-à-dire rend la création impossible par l'API. La base garantit « au plus
    une » ; « au moins une » devient une condition d'emploi, vérifiée par `CRM-033` et `CRM-040`.
  - **Décision 73 — une transition ne sort pas de son workflow parce que la base l'interdit.**
    Clés étrangères composites `(step_id, workflow_id)` : refus mesuré en `23503`. Elles exigent
    une unicité `(id, workflow_id)`, sans quoi leur création échoue en `42830`.
  - **Décision 74 — la suppression physique est ouverte aux étapes et aux transitions, et à elles
    seules.** Elles sont la composition d'un workflow, non des objets à durée de vie propre, et
    `docs/SCHEMA.md` §3 ne leur donne aucun `archived_at`.
  - **Décision 75 — le commentaire exigé sur les transitions vers « Perdu »** est un choix pris
    faute d'énoncé d'origine, nommé comme tel et renversable.
  - **`INC-033` ouverte** : `require_fields` étant un `uuid[]`, aucune clé étrangère n'est possible
    — mesuré, et propriété du type, non différé d'ordonnancement.
  - **`INC-029` et `INC-031` mises à jour**, sans être closes.

### Ajouté

- **`CRM-032` — Copie d'un workflow vers un track (`[~]`).** La fonction
  `public.copy_workflow_to_track(workflow_id, track_id, new_name)` duplique un workflow global vers
  un track — sept étapes, dix arêtes **remappées par le nœud**, surcharges et positions
  fractionnaires conservées, `is_default` forcé à faux, lignage renseigné —, et la vue
  `public.workflow_derivations` porte le signal de divergence. Le seed livre une copie de
  démonstration sur le track « Conseil & IA », créée par le **véritable appel RPC**, avec le jeton
  de l'administrateur obtenu par la vraie route de connexion.
  - **Un défaut d'origine de l'image, trouvé par la mesure et corrigé** : `revoke all … from public`
    ne protège rien dans le schéma `public`. La fonction ainsi « protégée » a été appelée **avec
    succès par la clé anonyme**. Les rôles sont désormais révoqués nommément, et le harnais rend le
    droit à `anon` pour vérifier que le refus disparaît, puis que le rejeu le retire.
  - **Quatre refus, avec leurs codes HTTP mesurés** : `workflow_not_found` et `track_not_found`
    (`400`), `forbidden` (`403`), `workflow_not_global` (`400`) ; l'anonyme obtient **`401`**, refusé
    par le privilège avant tout contrôle.
  - **Règle de discrétion** : un workflow d'un autre workspace rend « introuvable », jamais
    « interdit ». La visibilité est vérifiée avant le rôle, et l'ordre est éprouvé par une assertion.
  - **Preuves** : `supabase/tests/0008_copie_workflow.test.sql` (**63 assertions**),
    `e2e/api/copie-workflow.spec.ts` (**14 scénarios**), `scripts/verify-copie-workflow.sh`
    (**33 contrôles**, trois dégradations réelles et restauration constatée).
  - **Sans écran** : la mention de divergence exige un écran d'administration authentifié, suspendu
    à INC-021. La donnée qui la porterait est livrée et prouvée par l'API.
  - **Six garde-fous d'unités précédentes ont échoué comme prévu et ont été resserrés** : deux
    assertions de type de `CRM-006`, deux scénarios d'API et deux contrôles de harnais de
    `CRM-031`, et les compteurs du harnais de tests (559 / 96 / 37 → **622 / 110 / 37**).

- **`CRM-031` — Workflows, étapes et transitions (`[~]`).** Le graphe des états d'une card :
  `workflows`, `workflow_steps`, `workflow_transitions`, **neuf politiques RLS**, et le workflow par
  défaut du seed — « Cycle commercial standard », sept étapes, dix transitions.
  - **Une transition ne peut pas sortir de son workflow, et c'est structurel** : clés étrangères
    **composites** `(step_id, workflow_id)`, refus mesuré en `23503`. Trois autres cohérences suivent
    le même procédé — le track d'un workflow, le nœud d'une étape et le workflow d'un channel
    appartiennent tous au workspace attendu, garanti par la base et non surveillé par un trigger.
  - **Au plus une étape initiale par workflow**, par index unique partiel. « Au moins une » n'est
    **pas** imposable à l'écriture : mesuré, un `constraint trigger` différé rendrait la création
    d'un workflow impossible par l'API. Un workflow sans étape initiale est un brouillon, écrit dans
    la spécification plutôt que découvert plus tard.
  - **La suppression est exposée aux étapes et aux transitions, et à elles seules** : seul endroit
    du produit livré où un client peut supprimer une ligne. Un workflow s'archive ; sa suppression
    est refusée **par le privilège**, avant même la politique.
  - **Preuves de refus n° 2, n° 3 et n° 11** acquises au niveau des workflows, hors interface, avec
    les jetons réels des trois profils.
  - **`INC-029` levée pour la clé étrangère** : `channels.workflow_id` est enfin référencée, de
    façon composite, et les six channels du seed portent le workflow par défaut. La contrainte
    `NOT NULL` reste due par `CRM-033`.
  - **Preuves** : `supabase/tests/0007_workflows.test.sql` **106 assertions**,
    `e2e/api/workflows.spec.ts` **21 scénarios**, `scripts/verify-workflows.sh` **47 contrôles**,
    non complaisant — quatre dégradations réelles, restauration constatée.
  - **Quatre garde-fous figés par les unités précédentes sont devenus rouges et ont été révisés**
    dans le même changement, dont les compteurs du harnais (454 / 75 / 37 → **559 / 96 / 37**).
  - **Décisions 76 et 77** : le comptage de pgTAP est sensible aux savepoints, et une ligne
    doublement fautive est refusée par sa contrainte de valeur avant son unicité. Les deux ont été
    établies par un échec d'assertion, non par une lecture de documentation.

### Corrigé

- **Décision 78 — les contraintes nommées d'une migration doivent être convergentes, pas seulement
  idempotentes.** Défaut réel trouvé par une exécution parallèle de la routine : une contrainte
  posée en `if not exists (… where conname = …)` n'est jamais réparée, si bien qu'une clé composite
  remplacée à la main par une clé simple portant le même nom survit à tous les rejeux de la
  migration. La base reste durablement affaiblie — une transition peut alors sortir de son
  workflow — et **rien ne le signale**. Les douze contraintes nommées de `0006_workflows.sql`
  passent désormais par un mécanisme unique qui compare la définition réelle à celle attendue, et
  la dégradation qui a trouvé le défaut devient le quatrième contrôle de non-complaisance du
  harnais. C'est la troisième forme du défaut de la décision 57.
- **Deux exécutions parallèles de la routine ont livré `CRM-031`.** Conformément à la décision 66,
  l'implémentation **déjà poussée fait foi** ; le travail parallèle est conservé localement sans
  être poussé, et **seul le défaut ci-dessus** en est reporté. Toutes les preuves ont été rejouées
  sur ce socle après intégration.

### Signalé

- **`INC-035`** — les clés étrangères des migrations `0003`, `0004` et `0005` portent le défaut
  corrigé ci-dessus. Non corrigées : ce sont des livrables d'unités vérifiées, et les reprendre
  dans un commit consacré à une troisième unité irait contre `CLAUDE.md` §13. Trois options
  d'arbitrage.
- **`INC-036`** — les navigateurs préinstallés de l'environnement d'exécution ne correspondent pas
  au Playwright épinglé par le dépôt : `npm run e2e:ui` échoue sur ses 37 scénarios avec
  « Executable doesn't exist ». Contourné hors dépôt, comme INC-032. Trois options d'arbitrage.
  - **Reste dû, et nommé** : aucun éditeur d'administration, aucun E2E d'interface, aucune capture —
    la webapp est un appelant anonyme (INC-021). L'unité reste `[~]`.

### Intégré

- **`CRM-030` reportée sur `main`, puis intégralement revérifiée sur ce socle.** L'unité avait été
  poussée sur une branche parallèle, sur un état du dépôt qui ignorait le correctif d'idempotence
  de `CRM-021`. Ses deux commits — spécification, puis implémentation — sont reportés sans être
  refaits, et **toutes** ses preuves rejouées sur `main` : `scripts/verify-catalogue.sh` 36/36, et
  les douze harnais précédents, **439 contrôles au total, aucune anomalie**.
  - **Quatre décisions du journal renumérotées 67 → 70** : elles portaient les numéros 64 à 67,
    déjà pris par `CRM-021`. Les onze références croisées — migration, suite pgTAP, harnais,
    scénarios d'API, spécification du moteur de workflow, backlog — suivent dans le même
    changement.
  - **Un décompte du backlog corrigé** : `scripts/verify-channels.sh` vaut **30** contrôles et non
    28 depuis le correctif d'idempotence, ce que le décompte écrit sur la branche parallèle ne
    pouvait pas connaître.
  - **`INC-032` ouverte** : `./runDev.sh` ne peut pas démarrer à froid derrière un proxy TLS
    interposé — la construction de l'image `webapp` s'arrête sur `SELF_SIGNED_CERT_IN_CHAIN`, alors
    que `webapp/Dockerfile` prévoit le secret `npm_ca` pour ce cas exact et que
    `docker-compose.dev.yml` ne le câble pas. Comportement **inchangé**, arbitrage attendu.
  - **Trois captures régénérées par le rejeu ont été restaurées** après observation : l'une
    montrait deux entrées de navigation mises en valeur, artefact du survol laissé par le pilote
    Playwright. Ce passage ne touche aucun écran.

### Ajouté

- **`CRM-030` — Catalogue de nœuds (`[~]`).** Le vocabulaire des états d'une affaire, et la
  **première preuve de refus n° 2** du projet.
  - **`supabase/migrations/0005_workflow_nodes_catalog.sql`** : table
    `public.workflow_nodes_catalog` — clé stable unique **par workspace**, libellé, type
    `open`/`won`/`lost`, jeton de couleur, probabilité par défaut, seuil de relance, `position`
    numérique, archivage doux, horodatages. Trigger d'attribution automatique de `position` **dans
    la portée du workspace**, et non du track comme pour les channels : le catalogue est une liste
    unique par workspace, sans conteneur intermédiaire.
  - **Six contraintes de valeur, convergentes** : forme de la clé, libellé non blanc, `kind`, jeton
    de couleur — jamais un hexadécimal —, bornes de la probabilité et seuil de relance
    **strictement positif**. Un seuil de zéro jour signalerait toute card dès son arrivée et
    masquerait l'absence de seuil sous une valeur qui a l'air d'en être une. Un rejeu de la
    migration **répare** une contrainte retirée à la main.
  - **Trois politiques RLS**, prouvées hors interface avec les jetons réels des trois profils
    seedés : lecture par les membres du workspace, insertion et mise à jour par ses
    administrateurs. **Aucune suppression n'est exposée** — le refus se manifeste dès le privilège.
    L'absence de droit fin n'est pas un écart ici, contrairement à `tracks` et `channels` : le
    catalogue n'appartient ni à un track ni à un channel, et sa politique s'arrête au rôle de
    workspace **par conception**.
  - **Preuve de refus n° 2 acquise pour la première fois** : un `business_developer` ne modifie pas
    le vocabulaire du workspace. Les n° 3 et n° 11 le sont également au niveau du catalogue.
  - **Seed étendu** : les sept nœuds du workflow de référence plus un **archivé**. Les trois types
    sont représentés, les **cinq** jetons du design system exercés, et les deux nœuds terminaux
    portent un seuil de relance nul — une affaire livrée ou perdue n'est pas en retard.
  - **Un écart assumé, consigné et figé par des assertions** : le refus d'archiver un nœud occupé
    n'est pas livré, sa cible traversant `workflow_steps` et `cards` qui n'existent pas encore
    (**INC-031**). Mesuré : PostgreSQL accepte la création d'une fonction PL/pgSQL référençant une
    table absente, et l'échec ne survient qu'au premier appel — un trigger écrit aujourd'hui ferait
    échouer toute mise à jour du catalogue sans rien protéger.

### Corrigé

- **La spécification attribuait à PostgREST un comportement du moteur** (`CRM-030`). Le §2.8
  affirmait qu'une mise à jour refusée rend `200` et un tableau vide « sous PostgREST ». C'est faux
  en SQL direct aussi : une clause `USING` ne refuse pas une ligne, elle la rend **invisible**, et
  l'ordre `UPDATE` réussit alors sur zéro ligne. L'erreur a été établie par une **assertion pgTAP
  qui a échoué** — écrite en `throws_ok('42501')` par symétrie avec l'insertion, elle a rendu
  « caught: no exception ». Conséquence au-delà de cette unité : toute preuve de refus de mise à
  jour doit relire la ligne et la constater inchangée.

- **`CRM-021` — Channels (`[~]`).** Second niveau d'organisation, et **premier cloisonnement
  garanti par une contrainte plutôt que par une politique**.
  - **`supabase/migrations/0004_channels.sql`** : table `public.channels` — nom, slug unique **par
    track**, description, `position` numérique, archivage doux, horodatages. Trigger d'attribution
    automatique de `position` **dans la portée du track**, et non du workspace : les onglets d'un
    track forment une barre à eux seuls, et compter à l'échelle du workspace produirait des barres
    commençant à 7 sans que rien ne l'explique.
  - **Clé étrangère composite `(track_id, workspace_id) → tracks (id, workspace_id)`**, avec la
    contrainte d'unicité qu'elle exige sur `tracks`. `channels.workspace_id` est dénormalisé et
    c'est lui que la politique RLS interroge : s'il pouvait différer du workspace de son track, la
    politique cloisonnerait sur une valeur fausse, et aucune règle RLS ne le rattraperait. Le refus
    est mesuré **y compris à `postgres`**, donc indépendamment de toute politique, et à la mise à
    jour comme à l'insertion.
  - **Trois politiques RLS**, prouvées hors interface avec les jetons réels des trois profils
    seedés : lecture par les membres du workspace, insertion et mise à jour par ses
    administrateurs. **Aucune suppression n'est exposée** — le refus se manifeste dès le privilège.
  - **INC-010 refermée** : la clé étrangère `channel_members.channel_id → channels.id` est posée.
    Deux assertions figées par des unités précédentes ont **réellement échoué** en la posant, puis
    ont été révisées dans le même changement.
  - **INC-025 refermée** : `created_at` et `updated_at` sont livrées, et le tableau de `channels`
    de `docs/SCHEMA.md` §2 complété.
  - **Seed étendu** : six channels sur trois tracks, dont un **archivé** et un track n'en portant
    qu'un — une barre à un seul onglet est un cas d'affichage réel, distinct de la barre vide.
    `workflow_id` reste nul partout, ce qui est l'état réel du produit jusqu'à `CRM-031`.
  - **Route d'un track** `/tracks/:slug[/:channel]` : la destination que `CRM-020` avait annoncée
    sans pouvoir la livrer. Les pilules de la barre latérale deviennent des liens, et l'écart
    `docs/DESIGN_SYSTEM.md` §12.4 est **refermé**. L'état actif s'ajoute à la couleur du track sans
    la remplacer.
  - **Barre d'onglets réelle**, en navigation par liens et non en `tablist` : nos onglets changent
    l'URL, un `tablist` décrit des panneaux qui s'échangent dans la même page, et son `tabindex`
    glissant retirerait la navigation par `Tab`. L'écart §12.1 cesse d'être temporaire pour devenir
    une position motivée.
  - **Un slug refusé et un slug inexistant produisent le même écran**, délibérément : les
    distinguer renseignerait un appelant sans droit sur l'existence d'un track.
  - **Deux écarts assumés, consignés et figés par des assertions** : `workflow_id` livrée nullable
    et sans clé étrangère, la table `workflows` n'arrivant qu'avec `CRM-031` (**INC-029**) ; et la
    lecture qui n'applique aucun droit fin, `app.can_read_channel` restant différée (**INC-030**).

### Corrigé

- **La migration des channels était idempotente sans être réparatrice** (`CRM-021`). L'unicité
  `(track_id, slug)` était écrite **dans le `create table`**, qui porte `if not exists` : après
  qu'une contrainte a été remplacée à la main — ou par la dégradation d'un harnais —, la
  réapplication du fichier se terminait **sans erreur** en laissant la base durablement affaiblie.
  Un channel `prospection` devenait alors impossible dans deux tracks du même workspace, alors que
  `docs/SCHEMA.md` §2 l'autorise expressément. Reproduit sur la base de développement avant
  correction.
  - C'est exactement le défaut que `CRM-020` avait rencontré sur `tracks_color_check` : la leçon
    avait été appliquée aux contraintes `CHECK` sans être généralisée aux autres contraintes de
    table.
  - La contrainte est posée hors du `create table`, de façon convergente **et conditionnelle** :
    `pg_get_constraintdef` est comparé à la définition attendue, et la contrainte n'est refaite que
    si elle diffère. Un `drop`/`add` inconditionnel aurait **reconstruit son index à chaque
    démarrage de la pile**, ce qui n'est pas le prix négligeable d'une revalidation de `CHECK` —
    vérifié : à rejeu identique, l'OID de la contrainte ne change pas.
  - **Le défaut ne pouvait pas se voir autrement.** Toutes les autres preuves s'exécutent sur une
    base fraîchement migrée, où la contrainte est correcte ; seule la **restauration** après
    dégradation l'expose. `scripts/verify-channels.sh` ne dégradait pas cette contrainte : la
    dégradation manquante est ajoutée, et la restauration de l'unicité est désormais constatée
    séparément — un contrôle global l'aurait manquée.
- **`scripts/verify-webapp.sh` vérifiait la propreté de l'arbre de travail au lieu de sa propre
  restauration** (`CRM-007`). Son contrôle final employait `git diff`, donc une comparaison avec le
  **dernier commit**, et passait au rouge dès qu'un des fichiers qu'il altère portait une
  modification légitime non committée — c'est-à-dire dans son cas d'usage principal, juste avant un
  commit. Toute unité touchant `TabBar.tsx` ou `workspaces.ts`, ce que `CRM-021` fait, voyait ce
  contrôle échouer alors que le harnais avait parfaitement restauré ce qu'il avait altéré. Il
  compare désormais avec les sauvegardes prises avant la première altération, comme
  `scripts/verify-tracks.sh` le faisait déjà pour son fichier de jetons.
- **Le débordement horizontal de la barre d'onglets n'était pas signalé** (`CRM-021`). À 390 px, le
  dernier libellé était coupé net au bord du conteneur. Le §7 du design system était respecté — la
  page ne défilait pas — et le §4 violé : « défilable, jamais tronqué **sans indication** ».
  **Aucune assertion ne pouvait l'attraper**, les deux règles étant vérifiées séparément ; le défaut
  a été trouvé en regardant une capture. Corrigé par une classe `.indique-debordement-x` en CSS pur,
  sans JavaScript ni écoute d'événement : l'indication n'apparaît que lorsqu'il reste réellement
  quelque chose à voir de ce côté. Règle consignée en `docs/DESIGN_SYSTEM.md` §12.6.
- **Une capture de référence montrait un écran incohérent** (`CRM-021`) — un track ouvert avec ses
  onglets, et une barre latérale affirmant qu'aucun track n'existe — parce que la substitution
  réseau ne servait le track qu'à une des deux requêtes qui l'interrogent.
- **Les compteurs figés de `scripts/verify-harness.sh` ont échoué comme prévu** (`CRM-021`) : ils
  interdisent qu'une suite cessant d'être découverte passe pour verte, et toute unité qui ajoute
  des preuves doit donc les réviser explicitement. Portés à 374 assertions pgTAP, 50 scénarios
  d'API et 37 scénarios d'interface.
- **`scripts/verify-webapp.sh` était devenu complaisant en silence** (`CRM-021`) : ses contrôles de
  non-complaisance dégradent la barre d'onglets par substitution de chaîne, et cette unité a
  réécrit ce composant. Une substitution qui ne s'applique plus dégrade zéro ligne, et le contrôle
  passe alors sans rien mesurer. Le harnais a réellement échoué, et ses motifs ont été révisés dans
  le même changement.

- **`CRM-020` — le contraste des pilules de track était déclaré, non mesuré.** `docs/DESIGN_SYSTEM.md`
  §8 exige 4,5:1 « y compris pour les badges colorés », et aucune preuve du dépôt ne calculait un
  contraste. Mesuré sur le rendu réel : `success` à **3,82:1** — la couleur du track `studio-web` du
  seed — et `danger` à **3,29:1**. `accent`, à 1,45:1, avait déjà été corrigé parce qu'illisible ;
  les deux autres sont **lisibles sans être conformes** et ne pouvaient être trouvés qu'en mesurant.
  - Quatre jetons **`--color-*-on-soft`** : le jeton conservant sa teinte, assombri juste assez pour
    tenir les 4,5:1 — 7,64 / 4,85 / 4,72 / 4,67. Valeurs **calculées** à partir du jeton plein,
    comme les fonds doux ; `tokens.css` reste le seul fichier à contenir une couleur.
  - `accent` repasse de `text-ink` à `text-accent-on-soft` : le repli sur l'encre était conforme
    mais faisait de lui une **exception** dans un tableau qui devra s'étendre aux badges. Une règle
    unique se propage, une exception se recopie mal.
  - **Preuve ajoutée, et c'est elle le livrable** : `e2e/ui/tracks.spec.ts` mesure le contraste sur
    les couleurs **réellement rendues**, peintes sur un canevas d'un pixel. Lire `getComputedStyle`
    serait faux — Chromium mêle canaux 0–1 (`color-mix`) et octets (couleurs littérales) ; la
    première version de la mesure rendait 2,31:1 pour un contraste de 7,64:1.
  - Le scénario sert désormais **les cinq jetons**, dont `danger` et `neutral` qu'aucun track du
    seed n'emploie : un jeton que rien ne rend n'est jamais mesuré.
  - **Le mappage exact est figé** par `webapp/src/app/presentation-tracks.test.ts`. Les trois
    assertions qui existaient — « non vide », « pas d'hexadécimal », « fond et texte distincts » —
    étaient toutes vertes avec `text-success` : une propriété générale ne remplace pas la valeur
    attendue.
  - **`scripts/verify-tracks.sh` : 43 contrôles, aucune anomalie**, et une **huitième dégradation** —
    le jeton de contraste ramené à la couleur pleine doit faire échouer le projet `ui`. Sans elle,
    rien ne distinguerait « la conformité AA est mesurée » de « la conformité AA est déclarée ».
  - `scripts/verify-harness.sh` : **22 → 23** scénarios `ui` épinglés.
  - Contradiction consignée en **INC-028** : `docs/DESIGN_SYSTEM.md` §5.6 (« texte à la couleur
    pleine ») et §8 sont incompatibles pour trois jetons sur cinq, depuis `CRM-000`. Trois questions
    dépassent cette unité et sont portées à l'arbitrage — réécrire le §5.6 pour tout le produit,
    étendre les jetons aux badges et liserés de card, et maintenir ou non `accent` comme couleur de
    donnée.
  - `docs/DESIGN_SYSTEM.md` §1, §5.6 et **§12.5** (nouvel écart), `docs/JOURNAL.md` mis à jour dans
    le même changement.

### Ajouté

- **`CRM-020` — Tracks (`[~]`).** Premier objet métier du produit, et **premières politiques RLS**.
  - **`supabase/migrations/0003_tracks.sql`** : table `public.tracks` — nom, slug unique par
    workspace, couleur contrainte aux jetons du design system, icône, `position` numérique,
    archivage doux, horodatages. Trigger d'attribution automatique de `position` en fin de liste du
    workspace, et **clé étrangère `track_members.track_id → tracks.id`**, moitié d'INC-010 refermée.
  - **Trois politiques RLS, prouvées hors interface avec les jetons réels des trois profils
    seedés** : lecture par les membres du workspace, insertion et mise à jour par ses
    administrateurs. **Aucune suppression n'est exposée** — ni politique, ni privilège : l'archivage
    tient lieu de suppression, et le refus est mesuré (`403`, `42501`).
  - Le `WITH CHECK` de la mise à jour interdit de **déplacer** un track vers un workspace où
    l'appelant n'est pas administrateur — refus que le `USING` seul aurait laissé passer.
  - **Contraintes de valeur convergentes** : posées par `drop constraint if exists` puis
    `add constraint`, de sorte qu'un rejeu **répare** une contrainte retirée à la main. Défaut réel
    trouvé par le contrôle de restauration du harnais, où `create table if not exists` laissait la
    base durablement affaiblie.
  - **Seed étendu** : quatre tracks dans l'espace de démonstration, dont un **archivé**, pour que
    l'état « archivé » soit démontrable et non seulement documenté. Écriture convergente par la
    véritable API REST.
  - **Barre latérale** : la section « Tracks » lit désormais `public.tracks` — filtrée sur les non
    archivés **côté serveur**, ordonnée par `position` puis par nom. Pilules colorées par jeton,
    précédées de leur icône Lucide, avec repli documenté sur `neutral` et `Folder`.
  - **La zone principale regarde les deux chargements** : un échec sur les tracks n'est plus avalé
    par une barre latérale qui n'a pas la place de l'expliquer.
  - **Preuves** : `supabase/tests/0004_tracks.test.sql` (**78 assertions**),
    `e2e/api/tracks.spec.ts` (**17 scénarios**, dont les preuves de refus n° 3 et n° 11 au niveau
    des tracks), `e2e/ui/tracks.spec.ts` (**9 scénarios**), `webapp/src/lib/tracks.test.ts`,
    `webapp/src/app/presentation-tracks.test.ts`, `webapp/src/app/SectionTracks.test.tsx`
    (**133 tests unitaires** au total), et `scripts/verify-tracks.sh` — **40 contrôles, aucune
    anomalie**.
  - **Harnais non complaisant, éprouvé par sept dégradations réelles** : écriture ouverte aux
    membres, `WITH CHECK` retiré, contrainte de couleur retirée, `DELETE` accordé, trigger de
    position retiré, lecture ouverte à tous, seed privé de son track archivé. Chacune fait échouer
    les preuves ; la restauration est ensuite **constatée**, pas supposée.
  - **Deux défauts trouvés en observant les captures**, alors que toutes les preuves étaient
    vertes : l'écran affirmait « Aucun track n'est accessible » en listant trois tracks, et la
    pilule `accent` n'atteignait pas le contraste AA en texte jaune. Corrigés.
  - **Trois assertions figées par des unités précédentes ont échoué comme prévu et ont été
    révisées** : la clé étrangère absente (`CRM-003`), la liste des tables et les relations de
    `track_members` dans les types (`CRM-006`), les comptes de preuves du harnais (`CRM-008`).
  - **Reste dû, et l'unité reste `[~]` pour cela** : aucun track n'apparaît dans l'interface, et
    aucune interface ne permet de les gérer — la webapp est un appelant anonyme faute d'écran de
    connexion (**INC-021**). Les droits fins ne sont pas appliqués (**INC-024**).
  - Contradictions consignées sans être résolues : **INC-024**, **INC-025**, **INC-026**,
    **INC-027**.

- **`CRM-008` — Harnais de tests (`[~]`).**
  - **`npm run test:sql`** : les trois suites pgTAP de `supabase/tests/`, **227 assertions**, avec
    un verdict **calculé** et non emprunté. Quatre conditions d'échec indépendantes, dont l'écart
    entre le plan annoncé et le nombre d'assertions réellement émises — le seul contrôle qui
    attrape une suite tronquée, pgTAP restant muet lorsque `finish()` manque.
  - **Projet Playwright `api`** et **`npm run e2e:api`** : **13 scénarios verts**, entièrement hors
    interface, aucun navigateur lancé. Refus de la passerelle, schéma `app` non exposé, **preuve
    de refus n° 11**, absence de privilège des trois profils seedés, et refus d'écriture `403`
    doublé de la vérification que la ligne n'a été créée nulle part.
  - **Les jetons viennent de la véritable route de connexion**, jamais fabriqués. `e2e/api/jetons.ts`
    est le livrable durable : `CRM-014` s'y appuiera pour ses douze scénarios.
  - **« Zéro ligne » n'est affirmé que là où il prouve quelque chose** : les tables sont d'abord
    constatées **non vides** avec la clé de service ; les deux tables réellement vides sont exclues.
  - **`npm run e2e:api` ne construit ni ne sert la webapp**, mesuré en supprimant `webapp/dist` et
    en constatant qu'il n'est pas recréé. Playwright démarrant son `webServer` pour toute
    exécution, le besoin est déclaré par `E2E_PROJETS`.
  - **`npm run e2e:report`** : rapporteur `html` avec `open: 'never'`, sortie ignorée par git, et
    rapport **réellement servi** — interrogé en HTTP, `200` constaté.
  - **Aucune régression** : `e2e:ui` reste à 13 scénarios, `test:unit` à 96 tests, `typecheck` vert
    sur les quatre projets ; les neuf harnais précédents rejoués (33, 38, 23, 26, 26, 42, 49, 30,
    41 contrôles).
  - Harnais rejouable `scripts/verify-harness.sh` : **22 contrôles, aucune anomalie**, éprouvé par
    **six dégradations réelles** — assertion fausse, plan tronqué sans `finish()`, erreur SQL,
    **politique RLS permissive réellement posée**, test unitaire faux — chacune devant faire
    échouer la commande visée. Restauration constatée, aucune politique résiduelle.
  - **Reste dû, et l'unité reste `[~]` pour cela** : `pytest mail-sync/tests` et
    `npm run e2e:mail`, dont les sujets arrivent au chunk 4 (INC-023).
- **`docs/SPEC-test-harness.md` — spécification du harnais de tests, écrite avant tout code.**
  L'énoncé de `CRM-008` nommait quatre outils sans dire ce que chacun doit rendre, ni comment un
  harnais peut mentir. Rédigée **après mesure** du comportement réel des outils épinglés, pas de
  mémoire. Mesure fondatrice : `psql` rend `0` sur une suite pgTAP dont **toutes** les assertions
  échouent, et pgTAP n'émet **aucun** diagnostic de plan lorsque `finish()` manque — le code de
  sortie ne peut donc pas servir de verdict, ni le diagnostic de pgTAP le remplacer.
  Décisions 48 à 51 consignées au journal.
- **Contradiction consignée, sans être résolue : INC-023.** La Definition of Done de `CRM-008`
  exige que « chaque commande du `README.md` §7 s'exécute », or deux d'entre elles —
  `pytest mail-sync/tests` et `npm run e2e:mail` — n'ont aucun sujet à exercer avant le chunk 4.
  Les déclarer vides serait une fausse complétion ; fabriquer leur sujet serait préempter
  `CRM-051` et `CRM-054`. Trois options d'arbitrage sont posées, `CRM-008` restera `[~]`.
- **Contradiction consignée, sans être résolue : INC-022.** `docs/DAT.md` §3.1 portait, à quatre
  lignes d'intervalle, « session persistée par la bibliothèque » et « sans persistance de
  session ». La première annonce comme acquise une écriture persistante dans `localStorage` que
  `CLAUDE.md` §11 n'autorise pas sans consentement explicite. La ligne est **signalée sur place**
  comme non tranchée, le comportement livré est **inchangé**, et l'arbitrage — trois postures
  posées — est demandé avant que l'écran de connexion ne soit écrit.
- **Constat d'exploitation consigné au journal : deux exécutions concurrentes de la routine ont
  livré `CRM-007` en double.** Le doublon a été abandonné sans être poussé, la livraison la mieux
  prouvée conservée, et ses affirmations rejouées indépendamment — `typecheck`, 96 tests
  unitaires et `build` verts depuis un `node_modules` reconstruit. La sérialisation de la routine
  est proposée au responsable.

- **`CRM-007` — Squelette de la webapp (`[x]`).**
  - Chaîne complète : Vite 8, React 19, TypeScript strict, Tailwind 4, React Router 8,
    `@supabase/supabase-js`, Lucide. `npm run dev`, `build`, `preview`, `test:unit`, `e2e:ui`.
  - **Jetons du design system en variables CSS**, `webapp/src/styles/tokens.css` étant le seul
    fichier du dépôt autorisé à porter un hexadécimal. Les espaces de noms de Tailwind sont
    **remis à zéro** : `bg-red-500` et `p-7` n'existent pas comme classes.
  - Coquille conforme à `docs/DESIGN_SYSTEM.md` §4 — barre latérale repliable, en-tête, barre
    d'onglets, quatre routes — et **quatre états explicites** : chargement, vide, erreur, refus,
    plus l'état de configuration incomplète. Aucune page blanche.
  - **Les états sont provoqués sur le réseau, pas simulés** : réponse retardée, requête réellement
    abandonnée, `403` réel. La reprise **relance la requête**, ce qu'un scénario prouve en rendant
    la seconde réponse différente de la première.
  - **Preuve d'intégration décisive, hors interface** : la requête de la coquille rend `200` et
    `[]` **avec la clé anonyme comme avec le jeton réel d'un compte seedé**, alors que la base
    contient bien une ligne. L'écran vide est le refus par défaut de `CRM-003`, faute de politiques
    RLS (`CRM-012`) — pas un défaut d'interface.
  - `scripts/verify-webapp.sh` : **41 contrôles, aucune anomalie**, non complaisant et éprouvé en
    dégradant réellement le produit puis en le rebuildant — couleur hexadécimale dans un composant,
    texte visible en dur, espacement hors échelle, colonne inexistante dans une requête.
  - `scripts/lib/classes-css.mjs` : garde née d'un défaut réel — une classe dont le jeton manque
    n'était **pas engendrée, en silence**, et la page défilait horizontalement sous 768 px.
  - **96 tests unitaires** (Vitest, jsdom) et **13 scénarios E2E** (Playwright) contre le **build
    de production** servi, pas contre le serveur de développement.
  - **Deux défauts trouvés en regardant les captures**, alors que tout était vert : à 390 px le
    titre de la route disparaissait ; repliée, la barre latérale rognait sa propre bascule et le
    repli devenait irréversible. Corrigés, et figés par des assertions E2E.
  - Service `webapp` conteneurisé (`node:24-alpine`) : `runDev.sh` cesse de l'annoncer comme dû, et
    **le prérequis Node 24 du dépôt y est exercé pour la première fois** — build, tests et
    compilation rejoués verts dans le conteneur.
  - **Aucune écriture sur l'appareil** : `localStorage` vérifié vide après un parcours complet ;
    le repli de la barre vit en `sessionStorage` ; le client est créé **sans persistance de
    session**, faute de consentement recueilli (`CLAUDE.md` §11).
  - **Aucun texte visible en dur** : dictionnaire typé de 50 clés, `t` refusant une clé inconnue à
    la compilation, et un test qui échoue sur une clé morte.
  - Décisions 45 à 47 consignées dans `docs/JOURNAL.md`, avec les deux défauts que seules les
    captures ont révélés. `docs/DESIGN_SYSTEM.md` §1, §11 et §12 mis à jour ;
    `docs/manual.md` gagne son chapitre 3, écrit depuis l'application exécutée.
  - Les huit harnais précédents rejoués — 33, 38, 23, 26, 26, 42, 49 et 30 contrôles — aucune
    régression.

- **`CRM-006` — Build de la webapp acquis, unité close (`[x]`).**
  - La seule preuve qui manquait à `CRM-006` est acquise par `CRM-007`, exactement comme
    **INC-020** l'avait prévu : `npm run build` est vert et le code importe réellement les types
    générés. Les types étant effacés à la compilation, ce qui établit qu'ils **contraignent** le
    code est un contrôle non complaisant — une colonne inexistante fait échouer `npm run typecheck`.
  - **INC-020 close.**

- **`CRM-007` — Spécification du squelette de la webapp, écrite avant tout code.**
  - `docs/SPEC-webapp.md` : où vit la webapp, comment elle se build, comment les jetons du design
    system deviennent des variables CSS, quelle coquille est livrée, et **ce que chaque état de
    l'interface signifie** — chargement, vide, erreur, absence de droit.
  - Spécification rédigée **après mesure** de la chaîne réellement installée, et non de mémoire :
    `vite@8.2.0` (build vert, 1 782 modules en 219 ms), `tailwindcss@4.3.3` (jetons émis sur
    `:root,:host`, utilitaires en `var(--…)`), `vitest@4.1.10` sur `jsdom`, et
    `@playwright/test@1.62.1` dont le navigateur attendu a été **réellement téléchargé** puis a
    produit une capture.
  - Mesure fondatrice du §6.3 : sous la clé anonyme, `GET /rest/v1/workspaces` rend `200` et `[]`.
    L'état vide de l'interface sera donc **le refus du backend**, pas un défaut de l'interface.
  - Décisions 40 à 44 consignées dans `docs/JOURNAL.md` : React 19 avec `docs/DAT.md` corrigé
    plutôt que contourné ; TypeScript conservé à `5.9.3` après réexamen **mesuré** de `7.0.2`
    (décision 39 close) ; projet npm unique avec Vite pointé sur `webapp/` ; aucune bibliothèque
    d'internationalisation ; client Supabase **sans persistance de session**, faute de
    consentement recueilli (`CLAUDE.md` §11).
  - **INC-021** ouverte : aucune unité ne porte l'écran de connexion, que la Definition of Done de
    `CRM-011` présuppose pourtant. Trois options d'arbitrage sont posées, **aucune n'est prise** ;
    l'écran n'est pas écrit par anticipation.

- **`CRM-006` — Spécification des types générés, écrite avant tout code.**
  - `docs/SPEC-types.md` : d'où viennent les types TypeScript du produit, où ils vivent, comment
    ils se régénèrent, et **ce qui prouve qu'ils n'ont pas dérivé** du schéma réellement migré.
  - Spécification rédigée **après mesure** du comportement réel de
    `supabase/postgres-meta:v0.96.6`, la version épinglée : route, code `200`, sortie de 300 lignes
    et 8 527 octets sur le schéma d'amorçage, **déterminisme constaté** sur deux appels successifs.
  - Mesure notable : le service `meta` **ne publie aucun port** sur l'hôte — la génération passe
    nécessairement par `docker exec`, et exige donc la pile de développement démarrée.
  - Mesure notable : `detect_one_to_one_relationships=true` ajoute `isOneToOne` aux relations ;
    sans lui, `supabase-js` type mal une relation embarquée.
  - Limite nommée d'emblée : les contraintes `CHECK` **ne survivent pas** à la génération —
    `workspace_members.role` se type `string`, pas `'admin' | 'business_developer' | 'viewer'`.
    Seule la base refuse une valeur hors vocabulaire.
  - Décisions 36 à 38 consignées dans `docs/JOURNAL.md` : fichier **versionné** plutôt que produit
    au build, générateur `postgres-meta` déjà présent plutôt que CLI à télécharger, et
    `package.json` introduit par cette unité **réduit aux commandes que sa DoD nomme**.
  - **INC-008** mise à jour : sa première question est réglée par nécessité, la seconde — une
    façade `npm` par-dessus les scripts — reste **ouverte et non préemptée**.

- **`CRM-006` — Types TypeScript générés depuis le schéma (`[~]`).**
  - `webapp/src/lib/database.types.ts` : les types du socle d'identité, **générés depuis la base
    réellement migrée** et versionnés, en-tête de traçabilité réémis à chaque génération.
  - `scripts/generate-types.sh` : trois modes — régénération, `--check` qui compare sans écrire,
    `--stdout`. Aucune dépendance nouvelle : le générateur est le service `meta` déjà présent pour
    Studio (décision 37).
  - `package.json` et `tsconfig.json` : `npm run types:generate`, `npm run types:check`,
    `npm run typecheck`, en mode `strict`. **Aucun alias `npm` des scripts de lancement** — la
    façade `npm` reste un arbitrage ouvert (décision 38, INC-008).
  - `webapp/src/lib/database.types.test-d.ts` : **19 assertions de type** vérifiées à la
    compilation, dont deux qui **figent des limites connues** et échoueront volontairement quand
    leur cause disparaîtra — le vocabulaire des rôles s'il devient un type énuméré, les relations
    incomplètes à `CRM-020` et `CRM-021`.
  - `scripts/verify-types.sh` : **30 contrôles, aucune anomalie**. Garde anti-dérive éprouvée
    **par le fichier et par le schéma** — une table réellement créée en base la fait échouer, puis
    son retrait rend la sortie identique au fichier versionné. Générateur arrêté : échec explicite
    et **aucun fichier écrit**, vérifié par empreinte.
  - Les sept harnais des unités précédentes rejoués — 33, 38, 23, 26, 26, 42 et 49 contrôles —
    aucune régression.
  - **Reste ouvert** : le build de la webapp qu'exige la Definition of Done, impossible avant
    `CRM-007` faute de webapp. Contradiction d'ordonnancement consignée en **INC-020**, remplacée
    par un `tsc --noEmit` strict qui est **moins qu'un build** et le dit.
  - Limites nommées : les contraintes `CHECK` ne survivent pas à la génération (`role` se type
    `string`) ; les types n'expriment aucun droit ; le prérequis Node 24 du dépôt n'a pas été
    exercé, les preuves ayant été obtenues sur Node 22.22.2.

- **`CRM-005` — Spécification du seed, écrite avant tout code.**
  - `docs/SPEC-seed.md` : contrat des données de développement — l'espace de travail, les trois
    comptes et leurs rôles, les identifiants **stables**, le mot de passe de développement, les
    gardes, et les **12 preuves** exigées, toutes exécutées hors interface.
  - Spécification rédigée **après mesure** du comportement réel de `supabase/gotrue:v2.189.0` et
    de `postgrest/postgrest:v14.12`, et non de mémoire.
  - Mesure notable : l'API d'administration GoTrue **accepte un identifiant fourni** par
    l'appelant, ce qui rend les identifiants stables tenables sans lecture préalable.
  - Mesure notable : mettre à jour les métadonnées d'un compte **ne met pas à jour son profil** —
    le trigger de `CRM-003` est `AFTER INSERT` et ne réécrit jamais un profil existant. Le seed
    converge donc `profiles` explicitement, au lieu de le supposer.
  - Mesure notable : l'API d'administration **n'applique pas** la politique de mot de passe qu'un
    utilisateur subit — un mot de passe de 8 caractères crée un compte qui se connecte réellement.
  - Décisions 32 à 34 consignées dans `docs/JOURNAL.md` ; contradiction **INC-018** (politique de
    mot de passe démentie sur le chemin d'administration) consignée **sans résolution implicite**.

- **`CRM-005` — Seed socle livré et prouvé (`[x]`).**
  - `supabase/seed/apply-seed.sh` : un espace de travail **P2Enjoy SAS** et trois comptes couvrant
    les trois rôles de workspace — `admin`, `business_developer`, `viewer`.
  - **Produit par les vrais mécanismes** : comptes par l'API d'administration GoTrue, profils par
    le trigger de `CRM-003`, espace de travail et appartenances par l'API REST. **Aucun `psql`,
    aucun `INSERT` direct** (décision 32).
  - **Identifiants stables**, fixés et préfixés `5eed` pour qu'une ligne seedée se reconnaisse sans
    requête (décision 33). Rendu possible par une mesure : l'API accepte un `id` fourni.
  - **Convergent** (décision 34) : rejoué sans doublon, il rattrape une dérive réellement
    provoquée. Le profil est convergé par un `PATCH` explicite, une mise à jour de métadonnées ne
    déclenchant pas le trigger de `CRM-003`.
  - **Garde** : refuse tout profil d'environnement autre que `dev`, et il est vérifié qu'aucune
    écriture n'a lieu pendant ce refus. La production n'applique jamais de seed.
  - `supabase/tests/0003_seed_socle.test.sql` : **30 assertions** pgTAP, le même contrat vu au
    niveau SQL. `scripts/verify-seed.sh` : **49 contrôles, aucune anomalie**, couvrant les 12
    preuves de `docs/SPEC-seed.md` §7 hors interface, dont la **connexion réelle** des trois
    comptes et la conformité du `sub` de leur jeton.
  - Harnais **non complaisant, éprouvé en faussant réellement le seed** : rôle faussé → 4
    anomalies ; identifiant faussé → jusqu'à 7 anomalies ; code de sortie `1` à chaque fois.
  - Vérification visuelle observée : `docs/captures/CRM-005/` — comptes, profils, workspace et
    appartenances dans Studio.

- **`CRM-011` — Spécification de l'authentification, écrite avant tout code.**
  - `docs/SPEC-auth.md` : cycle de vie d'un compte de bout en bout — inscription libre refusée,
    invitation, acceptation, connexion, session, déconnexion, réinitialisation de mot de passe —,
    politique de mot de passe, contenu du jeton, et les **20 preuves de refus et d'acceptation**
    exigées, toutes exécutées hors interface.
  - Spécification rédigée **après mesure** du comportement réel de `supabase/gotrue:v2.189.0` et
    non de mémoire : GoTrue est un service tiers dont le comportement fait autorité.
  - Mesure notable : le refus d'inscription libre **n'est pas contournable par le privilège** — la
    clé `service_role` est refusée exactement comme la clé anonyme.
  - Mesure notable : l'API ne renseigne pas sur l'existence d'un compte — adresse inconnue et mot
    de passe erroné rendent le même message, et `recover` sur une adresse inconnue rend `200` sans
    émettre d'email.
  - Décisions 29 à 31 consignées dans `docs/JOURNAL.md` ; contradictions **INC-015** (parcours
    d'invitation sans composant pour le porter) et **INC-016** (gabarits d'emails, repli silencieux
    vers l'anglais) consignées sans résolution implicite.

- **`CRM-011` — Authentification durcie et prouvée hors interface (partiel : ni écran ni E2E
  d'interface avant `CRM-007`).**
  - **La longueur minimale de mot de passe passe de 6 à 12** (décision 29). Le défaut de GoTrue
    n'était pas théorique : un mot de passe de six caractères était **réellement accepté**.
    Nouvelle variable `PASSWORD_MIN_LENGTH`, documentée dans `.env.example` et câblée dans le
    service `auth`. Prouvée dans les deux sens — onze caractères refusés, douze acceptés.
  - `scripts/verify-auth.sh` : harnais de preuves rejouable, **42 contrôles, aucune anomalie**,
    couvrant les vingt scénarios de `docs/SPEC-auth.md` §7 — invitation, acceptation **en suivant
    le lien de l'email reçu**, connexion, refus, contenu du jeton, session, déconnexion,
    réinitialisation menée à son terme, suppression.
  - **Le harnais commence par comparer la configuration réellement appliquée au conteneur aux
    valeurs du `.env`** : sans ce contrôle, tous les suivants mesureraient les défauts de l'image
    en croyant mesurer le produit.
  - **Non-complaisance éprouvée dans les deux sens** : un GoTrue **jetable**, même version
    épinglée, portant le réglage affaibli, doit accepter ce que la pile refuse ; et le harnais a été
    **réellement mis en échec** contre la pile affaiblie — `DISABLE_SIGNUP=false` produit
    6 anomalies, `PASSWORD_MIN_LENGTH=6` en produit 2.
  - **Vérification visuelle observée** : `docs/captures/CRM-011/` — moniteur Inbucket et les deux
    emails ouverts. Constat relevé à cette occasion : les emails de GoTrue sont en **HTML seul**,
    sans partie `text/plain` (INC-016).
  - **Comportement d'exploitation mesuré et documenté** : une variable ajoutée au gabarit
    n'atteint pas un `.env` existant, mais la garde de `CRM-002` refuse le démarrage et **nomme**
    la variable manquante. Marche à suivre écrite dans `docs/PROD_MIGRATIONS.md` §4.
  - `README.md` §7, §9, §10 et §11, `docs/DAT.md` §4.1 et §7, `docs/PROD_MIGRATIONS.md` §2 et §4,
    `docs/manual.md` mis à jour. **INC-017** relevée au passage : `README.md` §11 annonce encore
    comme non vérifié ce que `CRM-004` a mesuré — consignée, non corrigée ici, car elle relève
    d'un autre périmètre.

- **`CRM-010` — Fonctions d'autorisation (partiel : 4 fonctions sur 6, voir INC-013).**
  - `supabase/migrations/0002_fonctions_autorisation.sql` : `app.resolve_access`,
    `app.workspace_role`, `app.is_workspace_member`, `app.is_workspace_admin`. **Aucune politique
    RLS** — le refus par défaut posé par `CRM-003` reste intact, ce que les preuves vérifient
    explicitement.
  - **L'algorithme de résolution des droits fins est isolé des tables qu'il ne peut pas encore
    lire** (décision 25). `app.resolve_access(ws_role, track_access, channel_access)` est une
    fonction **pure** : elle se prouve par énumération **exhaustive** de ses **64 combinaisons**
    d'entrées, sans fixture ni compte. Les quatre fonctions différées n'auront plus qu'à lire leur
    ligne et l'appeler.
  - **L'absence de récursion est démontrée en la provoquant** (décision 27) : une politique
    auto-référente échoue en `42P17`, une jumelle `SECURITY INVOKER` épuise la pile en `54001`, et
    la même politique adossée à la fonction livrée répond sans erreur avec le filtrage attendu.
    Fait relevé au passage, contraire à l'attente : PostgreSQL **ne détecte pas** la récursion
    lorsqu'elle traverse une fonction.
  - **Les droits ne sont pas portés par le jeton** : l'appartenance retirée, le même jeton non
    expiré cesse immédiatement d'ouvrir des droits. Mesuré en base **et** sous PostgREST.
  - **`EXECUTE` est accordé à `anon`** (décision 26), pour que le refus d'un appelant anonyme reste
    **zéro ligne** au lieu d'une erreur de privilège. Le droit n'ouvre rien, et `PUBLIC` reste
    exclu — vérifié sur l'ACL des quatre fonctions.
  - `scripts/verify-authz.sh` : harnais de preuves rejouable, **26 contrôles, aucune anomalie**, et
    non complaisant — sept affaiblissements volontaires le font échouer. Suite pgTAP
    `supabase/tests/0002_fonctions_autorisation.test.sql` : **127 assertions, aucune anomalie**.
  - Preuves **hors interface** avec les jetons réels de trois profils : chaque profil ne voit que
    son workspace, l'anonyme obtient `200` et `[]` (preuve n° 11), un `viewer` ne modifie rien, un
    administrateur d'un autre workspace non plus (preuve n° 3). Le schéma `app` n'étant pas exposé
    par l'API, deux politiques d'instrumentation sont posées temporairement puis retirées, et
    l'absence de toute politique résiduelle est vérifiée (décision 28).
  - `docs/INCONSISTENCY_REPORT.md` : **INC-013 ouverte** — quatre des six fonctions dépendent de
    `tracks`, `channels` et `cards`, livrées deux chunks plus tard ; trois options d'arbitrage sont
    proposées, à trancher avant `CRM-012`. **INC-014 ouverte** — aucune unité ne porte nommément
    les politiques RLS des tables d'identité, ni la preuve de refus n° 10.
  - `docs/SCHEMA.md` §9, `docs/SPEC-permissions-rls.md` §3, §3.1, §3.2, `docs/DAT.md` §7,
    `docs/PROD_MIGRATIONS.md` §3, `README.md` §5 et §7 mis à jour dans le même changement.
  - **L'unité reste `[~]`** : les quatre fonctions `can_*` ne sont pas livrables dans l'ordre
    actuel du plan.

- **`CRM-004` — Chiffrement des secrets de messagerie : hypothèse levée, décision prise.**
  - `scripts/verify-vault.sh` : harnais de preuves rejouable et **autonome** — il ne dépend ni de
    `.env` ni de la pile en cours d'exécution, crée ses propres conteneur et volumes jetables et
    les détruit en sortant. **26 vérifications, aucune anomalie.**
  - L'image **réellement épinglée** par `docker-compose.yml` est mesurée, et non supposée :
    `supabase_vault` **0.3.1** présente, déjà installée et préchargée ; `pg_cron` **1.6.4**
    disponible, préchargé et fonctionnel ; `pgcrypto` 1.3, `pg_net` 0.20.3, `pgtap` 1.3.3.
  - **Vault est retenu ; le repli `pgcrypto` est abandonné** (décision 23). Entretenir un second
    chemin de chiffrement que rien n'obligerait à exercer reviendrait à ne jamais l'éprouver avant
    le jour où il servirait.
  - Cloisonnement mesuré **hors interface** avec les rôles réels : `anon` et `authenticated` sont
    refusés sur le schéma `vault` tout entier — donc plus fortement qu'un `REVOKE` de colonne —,
    tandis que `service_role` lit, déchiffre et crée. Le `REVOKE` sur `secret_id` reste exigé : il
    porte sur des tables de `public`, exposées par PostgREST.
  - **La clé racine de Vault vit hors de `PGDATA`** (décision 24), dans le volume `db-config`.
    Mesuré : PGDATA restauré sans elle, le chiffré subsiste et le déchiffrement échoue. Elle
    devient un **élément obligatoire du périmètre de sauvegarde** — `docs/DAT.md` §10 et
    `docs/PROD_MIGRATIONS.md` §2.1, §5, §6, §7.
  - `docs/INCONSISTENCY_REPORT.md` : **INC-001 close**, avec sa mesure et sa décision. **INC-012
    ouverte** : la mesure dément le motif principal de la décision 8 — `pg_cron` est disponible.
    Le résultat de la décision est conservé, son énoncé corrigé dans `docs/DAT.md` §3.3 et §12, et
    la réouverture de l'arbitrage est laissée au responsable.
  - `docs/DAT.md` §8, §10, §12, §15, `docs/SCHEMA.md` §11, `docs/SPEC-mail-subsystem.md` §2.3,
    `README.md` §5, §7, §12 mis à jour dans le même changement.
  - **Débloque `CRM-052` et `CRM-053`.**

- **`CRM-003` — Migrations d'amorçage : identité et cloisonnement.**
  - `supabase/migrations/0001_identite_et_cloisonnement.sql` : extension `pgcrypto`, schéma `app`
    (non exposé par l'API REST), et les cinq tables de `docs/SCHEMA.md` §1 — `profiles`,
    `workspaces`, `workspace_members`, `track_members`, `channel_members`.
  - Création automatique du profil à l'ouverture d'un compte, par trigger sur `auth.users` : le
    seul point qui capte tous les modes de création — invitation, seed, API d'administration.
  - **Refus par défaut** : RLS activée sur les cinq tables, sans aucune politique. Une lecture
    anonyme ou authentifiée retourne zéro ligne, une écriture est refusée, jusqu'aux politiques de
    `CRM-010` et `CRM-012`. Les privilèges de table sont posés explicitement plutôt qu'hérités des
    privilèges par défaut de l'image.
  - Les migrations du dépôt sont **idempotentes** : le `migrations-runner` ne tient aucun registre
    et rejoue tout le répertoire à chaque démarrage.
  - `supabase/tests/0001_identite_et_cloisonnement.test.sql` : suite pgTAP de l'unité
    (**70 assertions**).
  - `scripts/verify-migrations.sh` : harnais rejouable des preuves de l'unité (**23 contrôles**),
    dont la création d'un compte par l'API d'administration GoTrue et les refus mesurés hors
    interface avec les jetons réels.
- **`CRM-002` — Scripts de lancement et contrat d'environnement.** *(unité `[~]` : une preuve
  reste bloquée par une dépendance, voir les notes)*
  - `.env.example` : gabarit documenté des **76** variables — rôle, format, caractère
    obligatoire, valeur d'exemple non sensible. Aucun secret réel ; les valeurs sensibles portent
    un marqueur `CHANGE_ME_*`.
  - `runDev.sh` : amorce `.env` au premier lancement en **tirant chaque secret au hasard**, en
    mode `600`, sans jamais écraser un fichier existant. `ANON_KEY` et `SERVICE_ROLE_KEY` sont
    dérivées du `JWT_SECRET` produit, sous forme de jetons HS256 valides. Options `--dev`,
    `--withLog <composant>`, `--bootstrap`, `--stop`.
  - `runProd.sh` : démarre l'assemblage de production. N'amorce jamais de fichier
    d'environnement et n'invente aucun secret ; refuse un profil de développement et refuse
    `APPLY_MIGRATIONS=true`.
  - `resetMe.sh` : détruit la base et les volumes locaux, redémarre à froid, rejoue les
    migrations, puis le seed s'il existe. Refuse tout profil autre que `dev` et exige une
    confirmation explicite.
  - `scripts/lib/env.sh` : socle commun — lecture du fichier d'environnement, amorçage,
    validation contre le gabarit, gardes de profil.
  - `scripts/verify-scripts.sh` : harnais rejouable des preuves de l'unité (**38 contrôles**).
  - Nouvelle variable `P2ENJOY_ENV_PROFILE` (`dev` ou `prod`), garde des trois scripts.
  - `STACK_RLIMIT_NOFILE` s'ajuste à la limite dure de l'hôte lors de l'amorçage, et le signale.
- **`CRM-001` — Pile Supabase self-hosted, à versions épinglées.**
  - `docker-compose.yml` : assemblage commun — PostgreSQL 17, GoTrue, PostgREST, Realtime,
    Storage, Supavisor, Kong, et un conteneur `migrations-runner` qui rejoue
    `supabase/migrations/*.sql` au démarrage.
  - `docker-compose.dev.yml` : Supabase Studio, `postgres-meta`, MinIO et Inbucket, tous publiés
    sur l'interface de bouclage uniquement.
  - `docker-compose.prod.yml` : Caddy pour TLS et fichiers statiques, aucun outillage de
    développement, ni Kong ni PostgreSQL exposés.
  - `supabase/docker/` : configuration déclarative de Kong et scripts d'initialisation de la
    base, repris de la distribution self-hosted officielle.
  - `caddy/Caddyfile` : terminaison TLS, en-têtes de sécurité, application monopage.
  - `scripts/verify-stack.sh` : harnais rejouable des preuves de la Definition of Done
    (33 contrôles).
  - Le stockage vise **toujours** S3 : MinIO en développement, fournisseur réel en production.
  - Captures de vérification visuelle : `docs/captures/CRM-001/`.
- Amorçage du dépôt : `.gitignore`, `.editorconfig`, `.nvmrc` (Node 24).
- Documentation de référence complète, rédigée et committée **avant tout code**, conformément à
  la règle de persistance immédiate des décisions :
  - `README.md` — objectif, stack, prérequis, commandes, variables, structure, limites connues ;
  - `docs/DAT.md` — architecture technique, composants, flux, déploiement, compromis ;
  - `docs/SCHEMA.md` — modèle de données complet et contraintes ;
  - `docs/DESIGN_SYSTEM.md` — charte P2Enjoy appliquée au CRM, tokens, composants, accessibilité ;
  - `docs/SPEC-workflow-engine.md` — catalogue de nœuds partagé, workflows dérivables par track,
    transitions contraintes appliquées côté base ;
  - `docs/SPEC-form-composer.md` — champs conditionnels par étape et validation au moment de la
    transition ;
  - `docs/SPEC-mail-subsystem.md` — comptes entrants IMAP et identités sortantes SMTP découplés,
    classement des messages, dossiers imbriqués, file d'envoi résiliente ;
  - `docs/SPEC-permissions-rls.md` — rôles, politiques RLS et preuves de refus exigées ;
  - `docs/MASTER_PLAN.md` — index d'exécution autoritatif référencé par les commentaires `@spec` ;
  - `docs/BACKLOG.md` — unités `CRM-NNN` avec leur Definition of Done ;
  - `docs/JOURNAL.md` — décisions de conception et leurs justifications ;
  - `docs/PROD_MIGRATIONS.md` — contrat de déploiement et prérequis manuels ;
  - `docs/manual.md` — manuel utilisateur ;
  - `docs/INCONSISTENCY_REPORT.md` — registre des contradictions en attente d'arbitrage.

### Corrigé

- **`CRM-002` passe `[x]`.** Sa dernière case ouverte — « `resetMe.sh` rejoue le seed » — est
  levée : `./resetMe.sh --yes` détruit le cluster, rejoue les migrations à blanc **puis applique
  le seed**, en 45,6 s, et les trois comptes sont constatés sur la base neuve. INC-009 peut être
  close par le responsable.
- **Suite pgTAP de `CRM-003` corrigée** (décision 35) : elle supposait une base vide — décompte
  global des profils, et slug `p2enjoy` réservé, ce dernier provoquant une **erreur d'insertion**
  qui interrompait tout ce qui suivait. Elle ne porte plus que sur ses propres fixtures et repasse
  à **70/70**. Aucune régression sur les sept harnais : **237 contrôles** au total.
- Contradiction **INC-019** consignée : le bandeau d'état du `README.md` décrit encore un dépôt
  sans migrations, dépassé depuis `CRM-003`. **Non corrigée ici** — elle relève de l'état global du
  dépôt, pas du périmètre de cette unité.

### Notes

- La pile d'exécution et son outillage de lancement sont livrés et vérifiés, mais **aucun code
  applicatif ni aucune migration** ne l'est encore : `supabase/migrations/` est vide, il n'y a ni
  webapp ni service `mail-sync`.
- `CRM-002` reste `[~]` : la branche « rejoue le seed » de `resetMe.sh` **n'a pas pu être
  prouvée**, faute de seed — c'est l'objet de `CRM-005`, planifiée plus tard. Contradiction
  d'ordonnancement consignée dans `docs/INCONSISTENCY_REPORT.md`, INC-009. Aucun seed factice
  n'a été fabriqué pour rendre la preuve verte.
- Limites de vérification nommées dans `docs/BACKLOG.md` (`CRM-001`, `CRM-002`) : valeur par
  défaut de `STACK_RLIMIT_NOFILE` non éprouvée, certificat ACME non obtenu, production démarrée
  contre un fournisseur S3 simulé.
- Les commandes `npm` annoncées sans `package.json` — dont `npm run stop`, attribué à `CRM-002` —
  sont consignées dans `docs/INCONSISTENCY_REPORT.md`, INC-008. L'arrêt propre passe par
  `./runDev.sh --stop` et `./runProd.sh --stop`.

## [Publié]

_Rien à publier pour le moment._
