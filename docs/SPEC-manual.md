# Spécification — Manuel utilisateur du chunk 3

Unité de backlog : **`CRM-047`** (`docs/BACKLOG.md`).
Documents liés : `docs/manual.md` (l'objet spécifié), `docs/MASTER_PLAN.md` §2 et §4,
`docs/DESIGN_SYSTEM.md` §11 (captures), `CLAUDE.md` §7 (documentation utilisateur) et §16
(vérification visuelle).

Écrite **après mesure** sur la pile réellement exécutée le 2026-08-06, et non de mémoire : le §6
consigne, écart par écart, ce que le manuel affirmait et ce que le produit fait.

---

> **RÉVISÉE PAR `CRM-117`, le 2026-10-26 (`docs/JOURNAL.md` décisions 736 et 740).** Le manuel devient **le manuel
> public du produit**, lu par les membres depuis la webapp. Les §1 à §8 ci-dessous restent l'histoire de `CRM-047` et
> la source des commentaires `@spec` qui les citent, mais **trois de leurs règles tombent** et ne s'appliquent plus :
> nommer l'unité qui portera un écran manquant (§3, point 2) ; renvoyer à un dossier `docs/captures/<unité>/` (§3,
> point 4) ; l'annexe A et ses volumes du jeu de démonstration (§4). Le §2 cesse d'être un contrat de couverture **par
> citation dans le manuel** : la correspondance entre unités et chapitres vit désormais dans cette spécification
> (§12). Ce qui fait foi pour le manuel public est la **partie II** (§9 et suivants).

## 1. Objet

`CRM-047` tient en une ligne dans le backlog — « `docs/manual.md` décrit le produit réellement
exécuté ; captures renouvelées » — et cette ligne ne dit ni **de quoi** le manuel doit parler à la
fin du chunk 3, ni **comment** on prouve qu'il décrit le produit plutôt qu'un souvenir de celui-ci.
Ce document tranche les deux.

**Ce que l'unité livre :**

1. un manuel dont **chaque affirmation est vraie du produit exécuté** au moment du commit ;
2. le **chapitre manquant** d'une unité livrée qui n'en avait pas (`CRM-045`, §2) ;
3. une **annexe chiffrée unique**, mesurée, à laquelle la prose renvoie au lieu de recopier des
   nombres qui vieillissent (§4) ;
4. les **captures renouvelées** depuis l'application réellement exécutée (§5) ;
5. un **harnais rejouable** qui fait mordre la prochaine dérive au lieu de la laisser passer (§7).

**Ce que l'unité ne livre pas, et ne doit pas livrer :** aucune ligne de code applicatif, aucun
écran, aucune correction de comportement. Un manuel qui corrigerait le produit pour se donner
raison serait l'inverse de ce qu'il est. Les écarts entre ce que le produit fait et ce qu'il
devrait faire sont **consignés** (§6, INC-077), jamais refermés ici.

## 2. Portée : quelle unité du chunk 3 vit dans quel chapitre

Le manuel est écrit par unité, au fil des livraisons (`docs/manual.md`, en-tête). À la fin du
chunk 3 il doit donc **couvrir toutes les unités du chunk**, et rien d'autre. L'inventaire ci-dessous
est le contrat de couverture : une unité du chunk 3 sans chapitre est un manquement de `CRM-047`.

| Unité | Ce qu'elle a livré | Chapitre du manuel | État avant `CRM-047` |
|---|---|---|---|
| `CRM-007` | Coquille, navigation, états | §3.1, §3.3, §3.4, §3.5 | présent |
| `CRM-012` | Droits fins par track et channel | §3.2 *quater* | présent |
| `CRM-013` | Colonnes protégées | §4.2 | présent |
| `CRM-020` | Tracks | §3.2 *bis* | présent |
| `CRM-021` | Channels, onglets | §3.2 *ter* | présent |
| `CRM-030` | Catalogue de nœuds | ch. 19 (sommaire) | présent |
| `CRM-031` | Workflows, étapes, transitions | ch. 20 (sommaire) | présent |
| `CRM-032` | Copie d'un workflow vers un track | ch. 21 (sommaire) | présent |
| `CRM-033` | Cohérence workflow ↔ channel | ch. 22 (sommaire) | présent |
| `CRM-034` | `move_card`, garde centrale | §4.3 | présent, **faux** (§6, écarts 2 et 3) |
| `CRM-035` | Définition des champs | ch. 23 (sommaire) | présent |
| `CRM-036` | Valeurs et validation | ch. 24 (sommaire) | présent, **chiffres faux** (écart 7) |
| `CRM-037` | Rendu du formulaire | §4.7 | présent, **faux** (écarts 1 et 5) |
| `CRM-040` | Cards | §4.1, §4.2, §4.4, §4.5 | présent, **chiffres faux** (écart 6) |
| `CRM-041` | Board kanban | §4.8 | présent |
| `CRM-042` | Vue liste | §4.9 | présent |
| `CRM-043` | Commentaires | §4.10 | présent |
| `CRM-044` | Timeline unifiée | §4.10 | présent |
| `CRM-045` | Déplacement entre channels | **§4.11** | **ABSENT** — promis par le sommaire, écrit nulle part (écart 11) |
| `CRM-046` | Jeu de démonstration complet | **Annexe A** | absent |

Deux chapitres du sommaire ne relèvent **pas** du chunk 3 et restent « à livrer » : le chapitre 1
(se connecter, INC-021) et le chapitre 17 (inviter, INC-015). Ils ne sont pas des manquements de
`CRM-047` : aucune unité du backlog ne les porte.

## 3. Contrat d'un chapitre

Un chapitre du manuel n'est conforme que s'il satisfait **les cinq** points suivants. Ils reprennent
les règles de rédaction déjà présentes en fin de `docs/manual.md` et les rendent opposables.

1. **Il décrit ce que le produit fait, pas ce que sa spécification demande.** Toute phrase du
   manuel doit être vérifiable en ouvrant l'application ou en lisant une capture. Les libellés
   cités entre guillemets sont les libellés **réels** (`webapp/src/i18n/fr.ts`), au caractère près :
   le manuel ne paraphrase pas un message d'erreur, il le cite.
2. **Il nomme ce qui manque, et pourquoi.** Une fonctionnalité livrée côté serveur sans écran le
   dit, en nommant l'unité qui portera l'écran ou l'arbitrage qui le retient. « Pas encore livré »
   sans cause est une phrase creuse.
3. **Il ne recopie aucun chiffre mesurable.** Les volumes du jeu de démonstration vivent à l'annexe
   A et nulle part ailleurs (§4).
4. **Il renvoie à ses captures**, par le dossier `docs/captures/<unité>/`, et ces captures existent.
5. **Il est compréhensible sans lire le code, et ne porte aucun secret** — ni clé, ni valeur de
   variable d'environnement, ni adresse d'infrastructure. Les **noms** de variables sont permis.

## 4. Les chiffres vivent en un seul endroit — annexe A

**Constat qui motive la règle.** Le manuel affirmait « neuf affaires » et « quatorze réponses sur
six affaires ». Mesuré le 2026-08-06 : **14 affaires** et **18 réponses sur 9 affaires**. Ces deux
phrases étaient exactes le jour où elles ont été écrites ; `CRM-046` les a rendues fausses sans que
rien ne le signale, parce qu'un nombre recopié dans une phrase n'a aucun lien avec la base qui le
produit.

**Deuxième dérive détectée par le harnais le 2026-08-09.** `CRM-018` a rendu la copie de workflow
complète : ses six champs actifs et son champ retiré existent désormais eux aussi. Le même seed
porte en outre **21 réponses sur 11 affaires**. L'annexe passe donc de 6/1 à **12/2** questions et
de 18/9 à **21/11** réponses/affaires ; ce sont les requêtes du harnais, exécutées sur la base
froide, qui ont imposé ces quatre valeurs.

**Règle.** Tout volume du jeu de démonstration figure dans **une seule table**, l'annexe A de
`docs/manual.md`, sous la forme :

```
| <libellé de la grandeur> | <valeur> |
```

La prose des chapitres renvoie à l'annexe (« voir l'annexe A ») et n'écrit aucun nombre mesurable.
Les nombres qui **ne sont pas** des volumes du jeu — 25 lignes par page, 10 000 caractères, 0 à 100
pour une probabilité, trois lettres pour une devise — restent dans leur chapitre : ce sont des
règles du produit, pas des états de la base, et ils ne bougent qu'avec le code qui les porte.

**Grandeurs de l'annexe A**, et la requête qui fait foi pour chacune :

| Grandeur | Source de vérité |
|---|---|
| Tracks actifs / archivés | `tracks`, `archived_at is null` |
| Channels actifs / archivés | `channels`, `archived_at is null` |
| États du catalogue, actifs / archivés | `workflow_nodes_catalog` |
| Workflows, dont copies de track | `workflows`, `scope` |
| Étapes et transitions du workflow général | `workflow_steps`, `workflow_transitions` |
| Questions du formulaire, actives / retirées | `form_fields` |
| Affaires : total, actives, archivées, en corbeille | `cards`, `archived_at`, `deleted_at` |
| Réponses de formulaire, et affaires qui en portent | `card_field_values` |
| Commentaires, dont supprimés | `card_comments`, `deleted_at` |
| Comptes de démonstration | `workspace_members` |

**Un nombre de l'annexe A est un ÉTAT, pas un invariant** — la leçon est déjà payée par `CRM-046`
(décision 226). Le harnais du §7 compare donc l'annexe à la base **du moment**, et exige l'égalité
sur un seed fraîchement appliqué ; il ne prétend pas que ces nombres seraient vrais après qu'un
humain a travaillé dans l'espace.

**UNE GRANDEUR EST EXCLUE DE L'ANNEXE, ET LA RÈGLE CI-DESSUS NE SUFFISAIT PAS À L'ÉCARTER.** Le
**total d'événements d'historique** y figurait ; la première exécution du harnais après la suite
d'API a rendu « le manuel dit 38, la base dit 73 » (décision 234). Ce total ne fait que croître, et
croît dès que quiconque touche une affaire — une personne comme une preuve. Une grandeur qui ne peut
pas être vraie deux fois de suite n'a pas sa place dans une table d'égalités. Ce qui est vérifié à
sa place est le seul invariant du fil : **aucune affaire sans son événement `created`**, et le
manuel écrit l'absence plutôt que de la taire.

## 5. Contrat de captures

`CRM-047` ne réinvente pas la production de captures : elle est portée par `e2e/ui/captures.ts`
depuis `CRM-007`, et range chaque image sous `docs/captures/<unité>/` (`docs/DESIGN_SYSTEM.md` §11).

**Ce que « captures renouvelées » signifie ici, et c'est plus qu'un rejeu :**

1. **Le corpus entier est reproduit** depuis l'application réellement exécutée, par le projet
   Playwright `ui` au complet — pas seulement les images qu'un chapitre modifié cite.
2. **Les captures sont OBSERVÉES**, image par image, pour les chapitres que l'unité touche. Une
   capture produite et non regardée ne prouve rien (`CLAUDE.md` §16).
3. **`CRM-047` produit son propre jeu**, `docs/captures/CRM-047/`, qui n'est pas un doublon des
   jeux par unité : il montre le produit **tel qu'un lecteur du manuel le rencontre aujourd'hui**,
   c'est-à-dire en **visiteur anonyme**, sur les sept adresses que le manuel cite. C'est la seule
   série du dépôt qui documente le parcours du manuel plutôt qu'une fonctionnalité.

**Les sept adresses du parcours**, et ce que le manuel dit de chacune :

| Adresse | Chapitre | Ce que le manuel affirme |
|---|---|---|
| `/` | §3.1, §3.2 | « Aucun board à afficher », « Aucun track », « Aucun workspace accessible » |
| `/inbox` | §3.1 | état vide explicite |
| `/ma-journee` | §3.1, **§9** | état vide explicite — depuis `CRM-061`, c'est le premier des deux vides du §17.8 de `docs/SPEC-cards.md` (« Aucune échéance dans votre journée »), la portée « mes affaires » n'ayant aucun sujet sans session. L'exigence est inchangée ; c'est son texte qui a changé, par livraison |
| `/reglages` | §3.1 | état vide explicite |
| `/tracks/conseil-ia` | §3.2 *ter* | « Track introuvable » et retour à l'accueil |
| `/tracks/conseil-ia/grands-comptes` | §4.8 | « Track introuvable » : le board n'est jamais atteint |
| `/tracks/conseil-ia/grands-comptes/liste` | §4.9 | « Track introuvable », comme le board |
| `/tracks/conseil-ia/grands-comptes/cards/<id>` | §4.7, §4.10 | « Card introuvable » : la fiche et le fil ne sont jamais atteints |

Ces huit lignes — sept adresses de navigation plus la fiche — sont **exactement** ce que le §7
transforme en preuve.

## 6. La dérive mesurée le 2026-08-06

Inventaire complet des écarts entre `docs/manual.md` et le produit exécuté, relevé avant toute
correction. Chacun porte la mesure qui l'établit. C'est le travail de `CRM-047` de les refermer,
**sauf le douzième**, qui est un écart du produit et non du manuel.

| N° | Où | Ce que le manuel disait | Ce qui est mesuré |
|---|---|---|---|
| 1 | §4.7 | ouvrir la fiche affiche « Affaire introuvable » | le libellé réel est **« Card introuvable »** (`route.card.notfound.title`) ; le §4.10 du même manuel l'écrivait déjà correctement — le document se contredisait |
| 2 | §4.3 | « Aucune trace du déplacement n'est enregistrée. L'historique d'une affaire n'existe pas encore » | `card_events` porte **18 lignes `moved`**, et le fil affiche « Étape franchie · Prospection → Relance » (`CRM-044`) |
| 3 | §4.3 | « Aucun écran ne permet encore de faire ce geste » | le board le fait depuis `CRM-041` : bouton « Déplacer » et glisser-déposer |
| 4 | §3.2 | « les affaires elles-mêmes n'ont aucun écran du tout » | **trois** écrans : fiche, board, liste (`webapp/src/app/routes.tsx`) |
| 5 | §4.7 | « la timeline, les commentaires et les champs d'en-tête arrivent avec leurs chapitres » | la timeline et les commentaires **sont sur cet écran** depuis `CRM-043` et `CRM-044` ; seuls les champs d'en-tête manquent |
| 6 | sommaire ch. 4 | « neuf [affaires], dont une archivée et une en corbeille » | **14 affaires**, 12 actives, 1 archivée, 1 en corbeille |
| 7 | sommaire ch. 24 | « quatorze réponses sur six affaires » | **18 réponses sur 9 affaires** à la clôture de `CRM-047`, puis **21 sur 11** après `CRM-018` |
| 8 | sommaire ch. 5 | la cellule s'ouvre par « Livré, avec son écran » et se referme par « Ce qui manque est l'écran » | contradiction interne, héritée d'une mise à jour partielle |
| 9 | §4.4 | « archiver un état du catalogue (chapitre 20) » | le catalogue est le **chapitre 19** ; le 20 est le workflow |
| 10 | §4.6 | « Le déplacement d'une affaire d'un channel à un autre » rangé parmi ce qui n'est pas livré | `CRM-045` l'a livré côté serveur, et le sommaire le dit au chapitre 7 *bis*. C'est l'**écran** qui manque, pas la fonction |
| 11 | ch. 7 *bis* | promis par le sommaire | **aucun corps de chapitre n'existe** dans le document |
| 12 | ch. 7 *bis* | « laisse une trace "changement de dossier" dans l'historique » | `card_events` portait **2 lignes `channel_changed`**, et `PanneauTimeline.tsx` ne déclarait **aucun libellé** pour ce type : le fil affichait « Événement ». **Écart du PRODUIT — INC-077, clos ensuite par `CRM-019` : « Dossier changé »** |
| 13 | §4.10 | rien sur la disparition de la barre de filtres | `docs/DESIGN_SYSTEM.md` §5.11 : la barre n'existe que si le fil chargé n'est pas vide. Omission, pas erreur |

**Le douzième écart ne se corrigeait pas dans cette unité.** Ajouter un libellé au fil aurait
modifié un écran depuis une unité documentaire, contre `CLAUDE.md` §1. `CRM-019`, qui étend
précisément le vocabulaire de timeline, le ferme ensuite avec les libellés « Dossier changé » et
« Workflow modifié » ; le neuvième scénario ci-dessous mesure désormais cette résolution.

## 7. Preuves de l'unité

Une unité documentaire ne peut pas s'auto-attester : « le manuel décrit le produit » est une
affirmation sur le monde, qui exige des mesures. Trois preuves, de natures différentes.

### 7.1 Preuve d'interface — `e2e/ui/manuel.spec.ts`

Le projet Playwright `ui`, contre le **build de production** servi, en **visiteur anonyme réel** :
aucune substitution de réseau, aucun jeton. Il exerce les huit adresses du §5 et exige que l'écran
porte **le libellé exact** que le manuel cite. C'est la preuve directe du contrat §3.1 : si un
libellé change, le manuel devient rouge avant de devenir faux.

Il produit `docs/captures/CRM-047/`, le jeu du parcours (§5.3).

Il porte **un neuvième scénario**, qui n'est pas un parcours : un événement `channel_changed`
servi par le réseau, pour **mesurer** — et non déduire — que le fil le nomme « Dossier changé »
sans inventer les noms des dossiers. C'est la preuve de clôture d'INC-077 et la seule du dépôt qui
rende ce type visible.

### 7.2 Preuve documentaire — `scripts/verify-manual.sh`

Rejouable, hors interface, contre la base réelle. Il vérifie :

1. **les chiffres de l'annexe A** égalent la base, grandeur par grandeur (§4) ;
2. **chaque dossier de captures cité** par le manuel existe et n'est pas vide (§3.4) ;
3. **chaque unité `CRM-0NN` citée** par le manuel existe dans `docs/BACKLOG.md` ;
4. **chaque unité du chunk 3** de l'inventaire du §2 est citée par le manuel (contrat de
   couverture) ;
5. **chaque libellé cité entre guillemets** par les chapitres du parcours existe littéralement dans
   `webapp/src/i18n/fr.ts` ;
6. **aucun volume mesurable n'est recopié hors de l'annexe A** (§4) ;
7. le manuel ne porte **aucune valeur de variable d'environnement** ni aucune clé (§3.5).

**Non complaisant, et le seuil est un nombre.** Le harnais est éprouvé **en le mettant en échec**,
par `--contre-epreuve`, sur une **copie** du manuel — jamais sur le dépôt. Cinq dégradations sont
posées, **une par famille de contrôle** : un volume de l'annexe faussé, un dossier de captures
inexistant, une unité citée sans backlog, le libellé faux remis, un volume recopié dans un chapitre.
La contre-épreuve exige **au moins cinq anomalies**, et non la simple présence d'un échec.

Ce seuil n'est pas une précaution d'écriture : c'est lui qui a trouvé le second défaut de la
décision 234 — deux contrôles se terminant par `condition && ok` faisaient rendre `1` à leur
fonction sous `set -e`, de sorte que le harnais s'interrompait **au premier écart** sans jouer les
suivants. Une contre-épreuve exigeant « au moins une anomalie » l'aurait déclaré non complaisant à
tort.

### 7.3 Preuve unitaire

**Aucun test unitaire dédié, et l'absence est nommée.** Cette unité ne livre aucune logique
applicative : elle livre un document et deux harnais. Un test unitaire qui vérifierait le contenu
d'un fichier Markdown dupliquerait le §7.2 dans un exécuteur qui n'a pas accès à la base, et serait
donc **plus faible** que la preuve qu'il double. La Definition of Done est adaptée sur ce point, et
l'écart est écrit dans `docs/BACKLOG.md` plutôt que comblé par un test de façade.

## 8. Limites connues

- **Le manuel décrit un produit que personne ne peut utiliser connecté.** Tant qu'INC-021 n'est pas
  tranchée, les chapitres décrivent des écrans dont les captures chargées proviennent de réponses
  **substituées sur le réseau** (`docs/DESIGN_SYSTEM.md` §12.5), et le parcours réel d'un lecteur
  est celui du §5 : une suite d'états vides et de refus. Le manuel le dit à chaque chapitre
  concerné, et c'est la vérité du produit, pas une facilité de rédaction.
- **Le harnais du §7.2 vérifie des faits, pas du sens.** Il attrape un chiffre faux, un libellé
  paraphrasé, une capture disparue, une unité oubliée. Il n'attrape pas une phrase juste mais
  trompeuse. La relecture humaine reste la seule preuve de la qualité d'un manuel.
- **Les chapitres 19 à 24 vivent dans les cellules du sommaire**, non dans des sections propres.
  C'est l'état hérité de six unités successives, et `CRM-047` ne le change pas : déplacer six
  chapitres pour les reformater sans rien apprendre au lecteur serait un remaniement gratuit, et
  chaque cellule satisfait déjà le contrat du §3.
- **Aucune capture d'un écran connecté n'existe, ni ne peut exister.**

---

# Partie II — Le manuel public, joignable depuis la webapp (`CRM-117`)

*Écrite le 2026-10-26, avant le code, sur les arbitrages du responsable (`docs/JOURNAL.md` décisions 736 et 740), après
relecture intégrale de `docs/DESIGN_SYSTEM.md`. Les choix de forme qui reviennent à l'agent sont marqués « choix de
l'agent » et repris au §18 pour relecture.*

## 9. Objet et lecteur

**Le constat.** Le manuel n'était joignable nulle part depuis la webapp, et il n'avait jamais été écrit pour un
utilisateur : il cite des identifiants d'unité et des chemins du dépôt, décrit le jeu de démonstration et
l'environnement de développement, et ne montre aucune image. `CLAUDE.md` §7 demandait l'inverse — une documentation
« compréhensible sans lire le code », « dépourvue d'adresses internes ». C'est la partie I de ce document qui l'a
détourné, en exigeant de citer unités et dossiers de captures (§3, points 2 et 4).

**Le lecteur** est une personne membre d'un espace, connectée, qui veut savoir comment faire quelque chose dans le CRM.
Elle ne connaît ni le dépôt, ni le backlog, ni l'architecture, ni le jeu de démonstration. Elle lit en français.

**Ce que `CRM-117` livre** : un manuel unique, `docs/manual.md`, réécrit pour ce lecteur (§10) et illustré (§11) ; sa
lecture dans la webapp, depuis l'en-tête (§13) ; une lecture réservée aux membres connectés, appliquée côté serveur
(§14) ; une construction et des preuves rejouables (§15, §16).

**Ce qu'il ne livre pas** : aucun second manuel, aucune traduction, aucune recherche dans le manuel, aucun accès par le
connecteur MCP (§17), aucun manuel lisible sans session.

## 10. Le contrat d'un chapitre public

Un chapitre n'est conforme que s'il tient **les huit** points suivants. Ils remplacent le §3 de la partie I.

1. **Il décrit ce que le produit fait**, vérifiable en ouvrant l'application. Les libellés cités entre guillemets
   français sont les libellés **réels** de l'interface (`webapp/src/i18n/fr.ts`), au caractère près.
2. **Il ne porte aucune référence interne.** Sont interdits dans `docs/manual.md`, et la preuve du §16 les cherche
   mécaniquement :
   - un identifiant d'unité, d'incohérence ou de décision (`CRM-…`, `INC-…`, « décision N », « tranche », `T1`…) ;
   - un chemin ou un nom de fichier du dépôt (`docs/`, `scripts/`, `webapp/`, `supabase/`, `e2e/`, `mcp/`, `*.md`,
     `*.ts`, `*.sql`…) ;
   - un nom de table, de colonne, de fonction ou de code d'erreur de la base, un nom de variable d'environnement, une
     commande de terminal ;
   - toute mention du développement, du seed, du jeu de démonstration ou d'un environnement autre que celui du lecteur.
3. **Il dit ce qui n'existe pas encore sans renvoyer au backlog** : « cet écran ne permet pas encore de … » suffit. Il
   ne promet aucune date.
4. **Il ne recopie aucun volume** : ni nombre d'affaires, ni nombre de membres d'un espace. Les nombres qui sont des
   règles du produit — 25 lignes par page, 10 000 caractères, 30 jours de corbeille — restent, avec la même exigence
   d'exactitude que les libellés.
5. **Il illustre chaque élément d'interface qu'il cite** : §11.
6. **Il est compréhensible sans lire le code, et ne porte aucun secret** — ni clé, ni valeur de variable, ni adresse
   d'infrastructure (`CLAUDE.md` §7). Une adresse de la webapp se décrit par l'écran qu'elle ouvre, pas par son chemin.
7. **Il a une adresse stable.** Un chapitre est un titre de niveau 2 ; ses sections, des titres de niveau 3. Leur
   **identifiant** se déduit du titre : minuscules, accents retirés, tout ce qui n'est ni lettre ni chiffre devient un
   tiret, et la numérotation de tête (« 5 bis. ») est retirée. Deux chapitres, ou deux sections d'un même chapitre, ne
   portent jamais le même identifiant ; la construction le refuse (§15). *Choix de l'agent* : l'identifiant suit le
   titre plutôt qu'une ancre écrite à la main, qui serait une syntaxe hors du Markdown standard ; renommer un titre
   change son adresse, et la preuve du §16 le signale partout où l'ancien identifiant est employé.
8. **Il se lit sans numérotation latine.** La numérotation « bis, ter, quater… » héritée des livraisons successives est
   remplacée par une numérotation simple, chapitre par chapitre, à la réécriture.

## 10 bis. Le plan du manuel public

*Choix de l'agent, 2026-10-27, soumis à la relecture du responsable avec la première tranche réécrite.* Le manuel a grandi
au fil des livraisons : un sujet entier vivait dans le chapitre d'un autre — le carnet de contacts dans la navigation,
les boîtes et l'inbox dans l'affaire, les budgets dans l'arborescence —, et sa numérotation (« 5 undecies.6 bis »)
suivait l'ordre des livraisons, pas celui du lecteur. Le plan public range les chapitres **par sujet**, dans l'ordre où
une personne découvre le produit, et les numérote simplement (§10, point 8).

| N° | Chapitre | Repris de |
|---|---|---|
| | **Prise en main** | |
| 1 | Se connecter et se déconnecter | 1 (sans 1.5, qui décrivait le développement) |
| 2 | Le guide de démarrage : par où commencer | 1 bis |
| 3 | Naviguer : barre latérale, onglets, états | 3, sans le carnet de contacts ; une section nouvelle sur l'aide |
| 4 | Retrouver n'importe quoi : la recherche | 9 |
| 5 | Vos notifications : savoir qu'on vous a nommé | 8 |
| | **Le suivi quotidien et l'affaire** | |
| 6 | Ma journée : ce qui est en retard, ce qui est dû aujourd'hui | 3 quater |
| 7 | Les affaires figées : ce qui dort depuis trop longtemps | 3 quinquies |
| 8 | Les objectifs : le tableau blanc de l'équipe | 3 sexies |
| 9 | L'affaire : ce qu'elle porte, son adresse, ses deux façons de disparaître | 4.1 à 4.11 |
| 10 | Le carnet de contacts | 3 ter |
| | **La messagerie** | |
| 11 | Les boîtes de réception et les adresses d'expédition | 4.12, 4.13 |
| 12 | L'inbox : lire, trier et répondre | 4.14, 4.15, 4.16 |
| 13 | Consulter l'état de la messagerie | 6 |
| 14 | Écrire des modèles d'emails et les prévisualiser | 7 |
| 15 | Signer les messages expédiés depuis une identité | 7 bis |
| 16 | Enchaîner des relances : les séquences | 7 ter |
| | **L'administration de l'espace** | |
| 17 | Administrer l'arborescence : tracks et channels | 5.1 à 5.4 |
| 18 | Composer un workflow : ses étapes, ses transitions et son formulaire | 5 bis |
| 19 | Le catalogue de nœuds : le vocabulaire de vos workflows | 5 quater |
| 20 | La corbeille : ce qui a été retiré, et comment le rendre | 5 ter |
| 21 | Les membres de votre espace : qui y travaille, avec quel rôle | 10 bis |
| 22 | Le journal d'audit : ce qui s'est fait dans votre espace | 10 ter |
| | **Le pilotage** | |
| 23 | Les budgets d'un track | 5.4 bis, 5.5, 5.6 |
| 24 | Les coûts d'un track : ce qui était prévu, ce qui a été dépensé | 5 quinquies |
| 25 | Le détail d'un budget : occurrence par occurrence, ligne par ligne | 5 sexies |
| 26 | Les coûts de tout l'espace de travail : un cumul par track | 5 septies |
| 27 | L'onglet « À saisir » : renseigner les coûts réels à la suite | 5 octies |
| 28 | Le temps passé et le coût du personnel | 5 undecies |
| 29 | Les recettes d'une affaire et sa rentabilité | 5 duodecies |
| 30 | L'entonnoir de conversion : où se tiennent vos affaires | 5 nonies |
| 31 | Le prévisionnel pondéré et le taux de conversion | 5 decies |
| | **La plateforme et le connecteur** | |
| 32 | La plateforme : espaces, membres et superadministrateurs | 10 |
| 33 | Le connecteur MCP : piloter le CRM depuis votre assistant | 11 |

**Retirés** : le sommaire écrit à la main (la page `/aide` le construit), l'annexe A sur l'espace de démonstration, les
règles de rédaction (elles vivent dans ce document), et les sections « En développement ». Les lignes « en gras » du
tableau sont des regroupements de lecture : elles ne sont pas des chapitres et n'ont pas d'adresse.

**Les renvois deviennent des liens.** Un renvoi d'un chapitre à un autre s'écrit en lien vers l'identifiant de la
section visée (`[le tableau kanban](#le-tableau-kanban-d-un-channel)`), et non plus « chapitre 4.8 » : la construction
refuse un lien qui ne mène nulle part (§15), et un numéro recopié en toutes lettres ne serait vérifié par rien.
**Le numéro écrit dans le texte d'un lien suit sa cible** : « [la section 3.4](#les-onglets-d-un-track) » doit nommer
le numéro que porte réellement le titre visé. `npm run manuel:liens` le recalcule — il garde le mot de l'auteur,
« chapitre » ou « section », pour ne pas casser l'accord de la phrase —, et la preuve du §16 le vérifie. Un lien vers
une section au titre répété mène à son chapitre et garde le numéro de la section, qui appartient à ce chapitre.

**L'ordre des tranches** : T3.0 pose ce plan dans le manuel — chapitres déplacés et renumérotés, renvois changés en
liens, sans réécrire les phrases —, puis T3.1 à T3.5 réécrivent les groupes. `scripts/verify-manual.sh` est révisé dès
T3.0 : ses contrôles du chunk 3 (annexe A, dossiers de captures, unités citées, couverture) exigeaient ce que le §10
interdit, et le contrôle « aucune référence interne » s'applique aux chapitres déjà réécrits, liste qui grandit à
chaque tranche et couvre tout le manuel à la fin de T3.5.

## 11. Les images

**La règle du responsable** (décision 736) : « Si on réfère un champ, un bouton, une fenêtre, il faut l'image, et il
faut toutes les maintenir. On découpe l'écran au strict minimum pour expliquer le passage du manuel. La pleine page
est autorisée en début de chapitre. »

### 11.1 Ce qu'une image montre

- **Une image illustre une section** (titre de niveau 3), et se place dans cette section, au plus près du passage
  qu'elle explique.
- **Chaque élément d'interface cité par une section est visible dans au moins une image de cette section.** Un
  « élément d'interface cité » est un libellé entre guillemets français qui est aussi une valeur de
  `webapp/src/i18n/fr.ts` : un champ, un bouton, un onglet, un titre de fenêtre ou de bloc, un message. Une même image
  montre souvent plusieurs éléments cités : c'est le cas normal d'un formulaire.
- **La découpe est le strict minimum** : le rectangle qui englobe les éléments que le passage explique, avec une marge
  de 16 px, jamais l'écran entier — sauf la **première image d'un chapitre**, qui peut montrer la page entière dans la
  fenêtre de 1440 × 900 pour situer le lecteur.
- **Le texte alternatif est obligatoire** et dit ce que l'image montre, pas son nom de fichier (« Le formulaire de
  création d'un channel, avec le champ « Nom » et le choix de la couleur »).
- **Format** : JPEG, qualité 85, à la densité 1 de la fenêtre de 1440 px, comme les captures de vérification
  (`CLAUDE.md` §16). Rangement : `docs/manuel/images/<identifiant du chapitre>/<nom>.jpg`, référencé dans le Markdown
  par un chemin relatif (`manuel/images/…`), si bien que le manuel se lit aussi avec ses images dans le dépôt.

### 11.2 Comment elles sont produites et maintenues

- **Un générateur, jamais une capture à la main.** Les images sont produites par des scénarios Playwright dédiés,
  `e2e/manuel/*.spec.ts`, joués sur la pile de développement et le seed, connectés avec le profil qui convient au
  passage. Une aide, `illustrer(page, { chapitre, section, nom, cibles, pleinePage })`, attend que chaque cible soit
  visible, découpe le rectangle qui les englobe, écrit l'image, et inscrit dans un **manifeste**
  (`docs/manuel/images/manifeste.json`) : l'image, sa largeur et sa hauteur, son chapitre, sa section, et les libellés
  visibles qu'elle contient, relevés dans la page et non déclarés.
- **Elles se renouvellent ensemble.** Toute unité qui change un écran décrit par le manuel rejoue les scénarios du
  chapitre concerné et met à jour ses images dans le même changement (`CLAUDE.md` §7). La preuve du §16 rend visible
  une image orpheline, une image citée qui n'existe pas, et un élément cité sans image.
- **Les images sont observées** avant chaque commit qui les change (`CLAUDE.md` §16), comme toute capture.
- **Une exception se déclare, elle ne se tait pas.** Un élément qu'aucun scénario ne peut faire paraître de façon
  reproductible — une panne du réseau, par exemple — figure dans la table des exceptions du §11.3 avec son motif.
  Le manuel le décrit alors en mots seulement. La table est relue par le responsable.

### 11.3 Exceptions à la règle d'illustration

| Élément cité | Chapitre | Motif |
|---|---|---|
| « Workflow de départ créé » | `le-guide-de-demarrage-par-ou-commencer` | annonce réservée aux lecteurs d'écran : rien ne paraît à l'écran, l'étape passe à « Fait » (image de la section) |
| « Cet espace a déjà un workflow : ouvrez l'éditeur pour le composer. » | `le-guide-de-demarrage-par-ou-commencer` | annonce réservée aux lecteurs d'écran, qui exige en outre un workflow créé ailleurs entre l'affichage et le geste |
| « Configuration incomplète » | `naviguer-barre-laterale-onglets-etats` | ne paraît que sur une installation construite sans l'adresse de son serveur ; la pile de développement en a toujours une |
| « Objet non atteignable » | `retrouver-n-importe-quoi-la-recherche` | exige un résultat lisible dont l'écran ne l'est pas — une affaire dont le channel serait illisible ; aucun état du seed ne le produit |
| « Enregistrer » | `vos-notifications-savoir-qu-on-vous-a-nomme` | cité pour dire que ce bouton n'existe pas |
| « Accès refusé » | `naviguer-barre-laterale-onglets-etats` | exige un refus explicite du serveur à une lecture ; les droits du seed se traduisent par l'absence de ce qui est fermé, jamais par ce refus |

*Lignes proposées par l'agent avec `CRM-117` T4.1 (2026-10-28), soumises au responsable.*

### 11.4 Le contrat technique des images

*Choix de l'agent, 2026-10-27, avant le code de T4 (mesure : environ 620 libellés de l'interface cités, dans 157
sections).*

- **Le manifeste** `docs/manuel/images/manifeste.json` est `{ "images": [ … ] }`, une entrée par image, rangée par
  fichier : `fichier` (`<chapitre>/<nom>.jpg`, relatif à `docs/manuel/images/`), `largeur`, `hauteur`, `chapitre`,
  `section` (l'identifiant de la section, ou `null` pour l'introduction du chapitre), `pleinePage` (booléen) et
  `libelles` (les textes visibles dans le rectangle, dédoublonnés et triés). Le fichier est écrit par `illustrer`, jamais
  à la main ; un scénario rejoué remplace ses entrées, et laisse celles des autres.
- **La découpe** (`scripts/manuel/images.mjs`, module pur) : le rectangle qui englobe les cibles, élargi de 16 px de
  chaque côté et borné à la page. Une image **pleine page** prend la fenêtre de 1440 × 900.
- **Les libellés relevés** sont les textes que la page rend dans le rectangle — nœuds de texte visibles, `aria-label`,
  `placeholder` et `value` des champs —, normalisés (apostrophe droite, espaces réduits). Ils sont **lus dans la page**,
  jamais déclarés par le scénario : c'est ce qui rend la preuve « un élément cité, une image » opposable.
- **Un élément cité** est un texte entre guillemets français, dans une section, qui est une valeur de
  `webapp/src/i18n/fr.ts` ; une valeur à paramètres (`{nom}`) se compare comme un motif. Il est **illustré** quand il
  figure, à la normalisation près, dans les libellés d'une image de **la même section** — ou de l'introduction de son
  chapitre pour une image pleine page.
- **Le projet Playwright `manuel`** (`e2e/manuel/`) joue les scénarios, sur la pile de développement et le seed, comme
  `ui` ; il n'est pas compté dans les campagnes de non-régression : ses scénarios produisent des images, et la preuve est
  celle du §16.
- **La preuve grandit avec T4**, comme celle des références internes avec T3 : les contrôles d'images portent sur les
  chapitres déjà illustrés, liste qui couvre tout le manuel à la fin de T4.

## 12. Correspondance entre unités et chapitres

La partie I faisait porter au manuel la trace des unités. Elle vit ici, et seulement ici. **Une ligne par unité livrée
qui a un effet visible pour le lecteur**, avec l'identifiant du chapitre et, le cas échéant, de la section. La table est
établie à la réécriture (tranche T3 de `CRM-117`) et tenue ensuite par chaque unité, dans le même changement que son
chapitre. La preuve du §16 vérifie que chaque identifiant de cette table existe dans le manuel.

| Unité | Chapitre | Section |
|---|---|---|
| `CRM-092` | se-connecter-et-se-deconnecter | — |
| `CRM-079` | le-guide-de-demarrage-par-ou-commencer | — |
| `CRM-094` | le-guide-de-demarrage-par-ou-commencer | le-workflow-de-depart-en-un-geste |
| `CRM-007` | naviguer-barre-laterale-onglets-etats | la-disposition-de-l-ecran |
| `CRM-110` | naviguer-barre-laterale-onglets-etats | le-fil-d-ariane-savoir-ou-vous-etes |
| `CRM-020` | naviguer-barre-laterale-onglets-etats | la-barre-laterale-et-la-section-tracks |
| `CRM-021` | naviguer-barre-laterale-onglets-etats | les-onglets-d-un-track |
| `CRM-100` | naviguer-barre-laterale-onglets-etats | les-onglets-d-un-track |
| `CRM-012` | naviguer-barre-laterale-onglets-etats | les-acces-par-track-et-par-channel |
| `CRM-105` | naviguer-barre-laterale-onglets-etats | la-description-d-un-track-d-un-channel-ou-d-une-affaire-au-survol |
| `CRM-093` | naviguer-barre-laterale-onglets-etats | les-commandes-grisees-ce-que-votre-role-vous-laisse-faire |
| `CRM-117` | naviguer-barre-laterale-onglets-etats | l-aide-le-manuel-depuis-n-importe-quel-ecran |
| `CRM-065` | retrouver-n-importe-quoi-la-recherche | — |
| `CRM-064` | vos-notifications-savoir-qu-on-vous-a-nomme | — |
| `CRM-040` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | — |
| `CRM-013` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | l-adresse-email-de-l-affaire |
| `CRM-034` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | faire-avancer-une-affaire-ce-que-le-produit-autorise-et-ce-qu-il-refuse |
| `CRM-037` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | la-fiche-d-une-affaire-son-en-tete-son-formulaire-et-ce-qu-ils-montrent |
| `CRM-067` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | les-activites-d-une-affaire-appels-reunions-visios |
| `CRM-068` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | la-checklist-d-une-affaire-les-points-a-cocher |
| `CRM-041` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | le-tableau-kanban-d-un-channel |
| `CRM-095` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | le-tableau-kanban-d-un-channel |
| `CRM-042` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | la-vue-liste-d-un-channel |
| `CRM-043` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | l-historique-et-la-discussion-d-une-affaire |
| `CRM-044` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | l-historique-et-la-discussion-d-une-affaire |
| `CRM-081` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | mettre-une-affaire-en-sommeil-et-la-retrouver |
| `CRM-045` | l-affaire-ce-qu-elle-porte-son-adresse-ses-deux-facons-de-disparaitre | ranger-une-affaire-dans-un-autre-dossier |
| `CRM-076` | composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire | — |
| `CRM-031` | composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire | creer-un-workflow |
| `CRM-097` | composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire | creer-un-workflow-avec-l-ia |
| `CRM-035` | composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire | les-questions-du-formulaire |
| `CRM-078` | composer-un-workflow-ses-etapes-ses-transitions-et-son-formulaire | garder-une-photographie-d-un-workflow-et-y-revenir |
| `CRM-061` | ma-journee-ce-qui-est-en-retard-ce-qui-est-du-aujourd-hui | — |
| `CRM-062` | les-affaires-figees-ce-qui-dort-depuis-trop-longtemps | — |
| `CRM-082` | les-objectifs-le-tableau-blanc-de-l-equipe | — |
| `CRM-083` | les-objectifs-le-tableau-blanc-de-l-equipe | le-canevas |
| `CRM-060` | le-carnet-de-contacts | — |
| `CRM-114` | le-carnet-de-contacts | l-onglet-organisations |
| `CRM-052` | les-boites-de-reception-et-les-adresses-d-expedition | les-boites-de-reception-declarees |
| `CRM-088` | les-boites-de-reception-et-les-adresses-d-expedition | les-boites-de-reception-declarees |
| `CRM-053` | les-boites-de-reception-et-les-adresses-d-expedition | les-adresses-d-expedition |
| `CRM-089` | les-boites-de-reception-et-les-adresses-d-expedition | les-adresses-d-expedition |
| `CRM-054` | l-inbox-lire-trier-et-repondre | ce-que-le-produit-fait-d-un-message-recu |
| `CRM-057` | l-inbox-lire-trier-et-repondre | l-inbox-lire-et-trier-le-courrier-recu |
| `CRM-058` | l-inbox-lire-trier-et-repondre | ecrire-et-repondre |
| `CRM-059` | consulter-l-etat-de-la-messagerie | — |
| `CRM-063` | ecrire-des-modeles-d-emails-et-les-previsualiser | — |
| `CRM-075` | administrer-l-arborescence-tracks-et-channels | — |
| `CRM-116` | administrer-l-arborescence-tracks-et-channels | un-channel |
| `CRM-030` | le-catalogue-de-noeuds-le-vocabulaire-de-vos-workflows | — |
| `CRM-077` | la-corbeille-ce-qui-a-ete-retire-et-comment-le-rendre | — |
| `CRM-070` | les-membres-de-votre-espace-qui-y-travaille-avec-quel-role | — |
| `CRM-072` | le-journal-d-audit-ce-qui-s-est-fait-dans-votre-espace | — |
| `CRM-084` | les-budgets-d-un-track | — |
| `CRM-086` | les-couts-d-un-track-ce-qui-etait-prevu-ce-qui-a-ete-depense | — |
| `CRM-099` | l-onglet-a-saisir-renseigner-les-couts-reels-a-la-suite | — |
| `CRM-098` | le-temps-passe-et-le-cout-du-personnel | — |
| `CRM-106` | le-temps-passe-et-le-cout-du-personnel | saisir-son-temps-depuis-la-fiche-d-une-affaire |
| `CRM-107` | le-temps-passe-et-le-cout-du-personnel | regler-le-cout-du-personnel |
| `CRM-108` | les-recettes-d-une-affaire-et-sa-rentabilite | — |
| `CRM-066` | l-entonnoir-de-conversion-ou-se-tiennent-vos-affaires | — |
| `CRM-101` | la-plateforme-espaces-membres-et-superadministrateurs | — |
| `CRM-102` | le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant | — |
| `CRM-103` | le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant | accorder-des-droits-du-connecteur |
| `CRM-104` | le-connecteur-mcp-piloter-le-crm-depuis-votre-assistant | ce-que-l-assistant-sait-faire |

## 13. Le manuel dans la webapp

### 13.1 Les adresses

- **`/aide`** rend le **sommaire** : la liste des chapitres, chacun avec ses sections. **`/aide/:chapitre`** rend un
  chapitre ; une section s'atteint par le fragment de l'adresse (`/aide/board#deplacer-une-affaire`). Les deux
  adresses vivent dans la coquille ordinaire — barre latérale, en-tête, fil d'Ariane — et suivent sa règle : sans
  session, elles mènent à l'écran de connexion, qui ramène à l'adresse demandée (`docs/DESIGN_SYSTEM.md` §5.12).
  C'est une aide d'interface ; la règle d'accès, elle, est appliquée par le serveur (§14).
- **Le fil d'Ariane** porte `Workspace / Aide` sur le sommaire, et `Workspace / Aide / <titre du chapitre>` sur un
  chapitre (`docs/SPEC-webapp.md` §5.1 bis).
- **L'adresse est en français** comme toutes les adresses de la webapp ; le contrat exposé par le serveur (§14) est en
  anglais (`docs/DAT.md` §12 bis).
- **Un chapitre inconnu** rend l'état « introuvable » de la coquille, avec un lien vers le sommaire.

### 13.2 L'entrée « Aide » de l'en-tête (décision 740)

- **Une icône dans l'en-tête, à côté de la cloche, qui ouvre un panneau.** Le panneau porte, dans cet ordre :
  « Aide sur cet écran », lien vers le chapitre — ou la section — qui décrit l'écran courant, nommé par son titre ; puis
  « Sommaire du manuel », lien vers `/aide`. Quand l'écran courant n'a pas de chapitre, la première ligne n'est pas
  rendue : le panneau n'offre que le sommaire. Forme et comportement : `docs/DESIGN_SYSTEM.md` §5.69.
- **La correspondance entre écran et chapitre vit en un seul endroit**, un module pur de la webapp
  (`webapp/src/app/aide-ecrans.ts`) : à chaque motif d'adresse, l'identifiant du chapitre et, s'il y a lieu, de la
  section. Le motif le plus précis l'emporte : la fiche d'une affaire avant le board de son channel. La preuve du §16
  vérifie que chaque identifiant de ce module existe dans le manuel construit.

### 13.3 Le rendu d'un chapitre

- **Le chapitre arrive du serveur sous forme de blocs structurés**, jamais de HTML : titres, paragraphes, listes,
  tableaux, citations, code en ligne, liens, images. La webapp rend chaque genre de bloc par un composant aux styles du
  design system, et **n'injecte jamais de HTML** (`dangerouslySetInnerHTML` est proscrit sur cette surface). *Choix de
  l'agent* : des blocs plutôt que du HTML assaini, pour que les styles du produit s'appliquent par composant et
  qu'aucune balise venue d'un fichier ne puisse s'exécuter.
- **Un lien vers un autre chapitre ou une section** est un lien de la webapp (`/aide/<chapitre>#<section>`), qui
  navigue sans recharger. Un lien externe s'ouvre dans un nouvel onglet et l'annonce (`docs/DESIGN_SYSTEM.md` §5.20).
- **Une image** est demandée au serveur avec la session du lecteur (§14), puis rendue avec son texte alternatif. Elle
  est chargée à l'approche de l'écran, pas toutes à l'ouverture du chapitre.
- **Le sommaire** est lu une fois par session de lecture et garde la page entière : il n'est pas relu à chaque
  chapitre.

### 13.4 Les états (`docs/DESIGN_SYSTEM.md` §5.8)

Chargement : un squelette à la forme d'un chapitre. Erreur de lecture : le message et « Réessayer ». Chapitre inconnu :
l'état « introuvable » et le lien vers le sommaire. Image indisponible : son texte alternatif à sa place, dans un cadre,
et jamais une icône d'image cassée. Le sommaire n'a pas d'état vide : un manuel construit a toujours des chapitres, et
la construction refuse un manuel sans chapitre (§15).

## 14. L'accès réservé aux membres connectés

**La règle** (décision 736) : seul un membre connecté lit le manuel — son texte et ses images. C'est une règle
d'accès ; elle s'applique côté serveur (`CLAUDE.md` §10). Un manuel compilé dans le paquet de la webapp, ou servi en
fichier statique par le relais, serait lisible sans session : le contenu n'y est donc **pas**.

> **RÉVISÉ le 2026-10-26 à l'écriture du code, sur une mesure (décision 751).** La première rédaction de ce paragraphe
> servait le manuel par une fonction edge `manual` lisant un répertoire monté, et faisait juger la session par une
> fonction SQL `public.can_read_manual()`. **Mesuré** sur la pile de développement, par une fonction sonde : un worker
> du runtime des fonctions edge **ne lit aucun fichier du disque**, ni dans son propre répertoire, ni ailleurs — le code
> est compilé, et le système de fichiers du worker ne porte rien d'autre (`NotFound` sur les quatre chemins essayés).
> Le contenu ne peut donc pas être lu par une fonction. Le manuel est servi par le **stockage**, sous une politique de
> lecture — le mécanisme qui protège déjà les pièces jointes.

### 14.1 Le bucket `manual`

- **Un bucket privé, `manual`**, créé par migration, comme ceux des pièces jointes (`docs/SCHEMA.md` §9 septies). Il
  porte le manuel construit (§15) : `contents.json`, un `chapters/<slug>.json` par chapitre, et les images sous
  `images/<chapitre>/<nom>.jpg`.
- **Une seule politique, de lecture**, `manual_select`, sur `storage.objects`, `for select to authenticated using
  (bucket_id = 'manual')`. Aucune politique d'écriture : seul le service écrit, par la publication (§15). Le rôle `anon`
  n'a aucune politique, et la mesure de la migration 29 vaut ici : seule l'absence de politique le refuse, la politique
  porte donc elle-même la restriction au bucket.
- **Une session suffit** : un jeton interne n'est émis qu'à une personne admise (`docs/DAT.md` §4.1), donc membre d'un
  espace ou administratrice LeLabs. Ni l'espace, ni le rôle n'interviennent. Le stockage accepte le jeton interne
  comme PostgREST (`docs/SPEC-session-sso.md` §1).

### 14.2 Ce que la webapp en fait

La webapp lit le sommaire, puis un chapitre, puis ses images, par le client de stockage et avec la session courante
(`download`). Une image ne peut pas porter d'en-tête dans un `<img src>` : elle est donc lue en `Blob`, puis rendue
depuis une adresse locale au navigateur (`URL.createObjectURL`), libérée quand l'image quitte l'écran. Un `400` ou un
`404` du stockage sur un chapitre est l'état « introuvable » ; une erreur de réseau, l'état d'erreur avec reprise ; un
refus de session mène, comme partout, à la reprise de session de la coquille.

## 15. La construction et la publication

- **Source unique** : `docs/manual.md` et `docs/manuel/images/`. Rien d'autre n'est rédigé.
- **Un script de construction**, `scripts/manuel/construire.mjs` (`npm run manuel:construire`), lit la source, la
  découpe en chapitres (titres de niveau 2) et en sections (niveau 3), calcule les identifiants (§10, point 7), et
  écrit le **manuel construit** dans `docs/manuel/construit/` : `contents.json` — `{ "introduction": [...], "chapters": [{
  "slug", "title", "sections": [{ "anchor", "title" }] }] }`, où `introduction` porte en blocs ce qui précède le premier
  chapitre, rendu en tête du sommaire — et un `chapters/<slug>.json` par chapitre — `{ "slug", "title",
  "blocks": [...] }`. Un bloc d'image porte sa largeur et sa hauteur, lues dans le manifeste, pour que la page réserve
  sa place avant de la charger. Les clés de ce contrat sont en anglais (`docs/DAT.md` §12 bis).
- **Le manuel construit est versionné**, et `npm run manuel:verifier` échoue s'il diffère de ce que la source
  produirait : la même discipline que la vérification des types engendrés (`npm run types:check`).
- **La construction refuse**, avec un message qui nomme la ligne : du HTML brut dans la source ; une image référencée
  absente du disque ou du manifeste ; deux identifiants identiques ; un lien interne vers un identifiant qui n'existe
  pas ; un manuel sans chapitre.
- **La conversion du Markdown en blocs** emploie `marked`, en dépendance de développement seulement — elle ne sert qu'à
  la construction et n'entre pas dans le paquet de la webapp (décision 750, sous réserve de la mesure du `CLAUDE.md`
  §19, consignée dans `docs/DAT.md` §15 à son ajout).
- **La publication**, `scripts/manuel/publier.sh`, recopie le manuel construit et les images dans le bucket `manual`,
  avec la clé de service : chaque fichier déposé en remplacement, et tout objet du bucket absent de la source retiré —
  le bucket est un **miroir**. Elle est rejouable et sans effet sur un bucket déjà à jour. Elle s'exécute en
  développement à la fin du seed, et en production à chaque livraison qui change le manuel (`docs/PROD_MIGRATIONS.md`).
  Elle n'a besoin que de `curl` et `jq`, comme le seed.

## 16. Les preuves

- **Base (pgTAP)** : le bucket `manual` existe et est privé ; la politique `manual_select` existe, en lecture, pour
  `authenticated`, restreinte au bucket ; aucune autre politique ne nomme ce bucket ; sous le rôle `authenticated`, un
  objet du bucket se lit ; sous `anon`, aucun ; sous `authenticated`, l'écriture est refusée.
- **API, par requête directe** (`CLAUDE.md` §10) : sans jeton, ni le sommaire, ni un chapitre, ni une image ne se
  lisent ; avec un jeton forgé, non plus ; avec la session réelle d'une lectrice, d'un business developer et d'une
  administratrice, les trois se lisent ; aucune de ces sessions ne peut déposer, remplacer ni retirer un objet ; la
  liste des objets du bucket est refusée sans session.
- **Construction** : `manuel:verifier` vert sur le dépôt ; des sources dégradées sur une copie font échouer chacun des
  cinq refus du §15.
- **Publication** : après publication, chaque fichier du manuel construit et chaque image est dans le bucket, à
  l'octet près, et aucun autre objet ; un second passage ne change rien.
- **Manuel** (`scripts/verify-manual.sh`, révisé) : aucune référence interne (§10, point 2), recherchée par motifs ;
  chaque libellé cité existe dans `webapp/src/i18n/fr.ts` ou est une donnée déclarée ; chaque élément cité est visible
  dans une image de sa section, d'après le manifeste, hors exceptions du §11.3 ; aucune image orpheline, aucune image
  absente, aucune image sans texte alternatif ; une image pleine page n'est que la première de son chapitre ; chaque
  identifiant du §12 et de `aide-ecrans.ts` existe ; aucun secret. Sa contre-épreuve dégrade une copie, une famille à
  la fois, et exige au moins une anomalie par famille.
- **Webapp (unitaires)** : rendu de chaque genre de bloc, liens internes et externes, image chargée et libérée,
  correspondance écran → chapitre, panneau d'aide.
- **E2E** : depuis un écran, le panneau d'aide mène au bon chapitre, au clavier et à la souris ; le sommaire mène à
  chaque chapitre ; une image s'affiche ; un chapitre inconnu ; les quatre paliers, cadre du panneau mesuré ; sans
  session, `/aide` mène à la connexion puis revient.
- **Vérification visuelle** des écrans de l'aide et des images du manuel (`CLAUDE.md` §16).

## 17. Connecteur MCP

**Non** (décision 736). Le manuel ne s'expose pas au connecteur ; la seconde question — la famille de la matrice — ne
se pose donc pas.

## 18. Choix de l'agent — validés tels quels le 2026-10-26 (décision 750)

1. L'identifiant d'un chapitre et d'une section se déduit de son titre (§10, point 7).
2. Le chapitre est servi en blocs structurés, rendus par des composants, et non en HTML (§13.3).
3. Le manuel construit est versionné, et vérifié contre sa source (§15).
4. `marked` pour analyser le Markdown, en dépendance de développement, sous réserve de la mesure du `CLAUDE.md` §19
   (§15).
5. ~~La session est reconnue par une fonction SQL `public.can_read_manual()`, sans donner de secret à la fonction
   `manual` (§14.2).~~ **Révisé par la décision 751, sur une mesure** : le manuel est servi par un bucket de stockage
   privé, sous une politique de lecture pour `authenticated` (§14) ; aucune fonction edge, aucune fonction SQL.
6. L'icône de l'aide est `BookOpen` (`docs/DESIGN_SYSTEM.md` §5.69) : `CircleHelp` désigne déjà une étape non vérifiable
   du guide de démarrage, et le §9 du design system interdit qu'une icône serve deux objets.
