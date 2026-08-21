# Spécification — Manuel utilisateur du chunk 3

Unité de backlog : **`CRM-047`** (`docs/BACKLOG.md`).
Documents liés : `docs/manual.md` (l'objet spécifié), `docs/MASTER_PLAN.md` §2 et §4,
`docs/DESIGN_SYSTEM.md` §11 (captures), `CLAUDE.md` §7 (documentation utilisateur) et §16
(vérification visuelle).

Écrite **après mesure** sur la pile réellement exécutée le 2026-08-06, et non de mémoire : le §6
consigne, écart par écart, ce que le manuel affirmait et ce que le produit fait.

---

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
