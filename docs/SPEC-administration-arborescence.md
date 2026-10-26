# Spécification — Administration des tracks et des channels

Unité de backlog : `CRM-075` (voir `docs/BACKLOG.md`) ; le §13 relève de `CRM-100` (décision 623).
Documents liés : `docs/SPEC-tracks.md` (le modèle et le contrat d'API des tracks),
`docs/SPEC-channels.md` (idem pour les channels), `docs/SPEC-workflow-engine.md` §4.12 (contrainte
d'affectation d'un workflow), `docs/SPEC-permissions-rls.md` §4 (politiques), `docs/SPEC-webapp.md`
§5.2 (routes), §6.4 (contrat asynchrone), `docs/DESIGN_SYSTEM.md` §5.9 (tableau), §5.13 (cette
surface), §8 (accessibilité), `docs/manual.md`.

Origine : `docs/INCONSISTENCY_REPORT.md` INC-086, **arbitrée le 2026-08-11, option 2**, et
`docs/JOURNAL.md` décisions 332 et 335.

---

## 1. Objet, et ce que cette unité ne livre pas

Le CRUD de `public.tracks` et de `public.channels` est **livré et prouvé depuis `CRM-020` et
`CRM-021`**. Ce qui manque, et que cette unité livre, est la **surface** : un administrateur ne peut
aujourd'hui créer un track qu'avec la clé de service, hors interface.

**Cette unité ne livre aucune règle nouvelle.** C'est sa contrainte la plus forte, et elle est
opposable : une règle d'accès, une contrainte de validation ou une colonne qui apparaîtrait ici
serait le signe qu'elle a été **inventée**, et non spécifiée. Tout ce que l'écran refuse, la base le
refuse déjà ; tout ce que l'écran accepte, la base l'accepte déjà.

### 1.1 Dans le périmètre

1. La route `/reglages/arborescence` et l'index `/reglages` qui y mène (§3).
2. Les gestes sur un **track** : créer, renommer, réordonner, archiver, **désarchiver** (§5, §6).
3. Les mêmes gestes sur un **channel**, plus la désignation de son **workflow** (§7).
4. La couche d'accès aux données correspondante, `webapp/src/lib/administration-arborescence.ts`.
5. Les preuves : unitaires, API, E2E clavier et souris, captures aux quatre paliers, harnais dédié.

### 1.2 Hors périmètre, et nommé comme tel

| Ce qui n'est pas livré | Pourquoi, et par qui |
|---|---|
| Toute **suppression** | Ni `tracks` ni `channels` n'exposent de `DELETE` (`docs/SPEC-tracks.md` §4, `docs/SPEC-channels.md` §4). L'écran ne propose pas un geste que la base refuse |
| La **modification du `slug`** après création | §5.3 : motif écrit, et limite nommée au §11 |
| Le **déplacement d'un channel vers un autre track** | `CRM-045` livre le déplacement d'une **card** entre channels ; déplacer un channel entier n'est réclamé par aucune unité, et le faire ici l'inventerait |
| L'**édition des workflows** eux-mêmes — étapes, transitions, champs | `CRM-076`, dont cette unité est le préalable (INC-086, option 2) |
| La **corbeille**, la rétention et l'effacement définitif | `CRM-077`. L'archivage du §6 n'est pas une corbeille : il n'a ni durée de rétention, ni effacement |
| Le **glisser-déposer** de réordonnancement | §6.2 : le réordonnancement est livré au clavier et à la souris par des commandes explicites. Le glisser-déposer relève de `CRM-041`, qui le porte pour les cards |
| Les **droits fins** par track et par channel | `CRM-070`. Cet écran administre l'arborescence, pas les permissions |

## 2. Ce que la base garantit déjà, et que l'écran se contente d'exercer

Récapitulé ici pour que la relecture n'ait pas à ouvrir trois documents — **ce tableau ne décide
rien**, il cite.

| Garantie | Où elle est posée | Où elle est prouvée |
|---|---|---|
| `INSERT` et `UPDATE` réservés à l'administrateur du workspace | `app.is_workspace_admin`, `USING` **et** `WITH CHECK` | `docs/SPEC-tracks.md` §6 lignes *e*, *f*, *k*, *l* ; `docs/SPEC-channels.md` §7 idem |
| Aucun `DELETE` accordé à `authenticated` | privilèges de table | `docs/SPEC-tracks.md` §6 ligne *i* |
| `slug` conforme à `^[a-z0-9]+(-[a-z0-9]+)*$` | `CHECK` | pgTAP `0004` / `0005` |
| `slug` unique par workspace (track) / par track (channel) | contrainte d'unicité | `docs/SPEC-tracks.md` §6 ligne *h* ; `docs/SPEC-channels.md` §7 ligne *h* |
| `name` non vide après `btrim` | `CHECK` | pgTAP `0004` / `0005` |
| `color` parmi cinq jetons, `icon` en kebab-case | `CHECK` | pgTAP `0004` |
| `position` attribuée si omise, portée workspace / track | trigger `BEFORE INSERT` | `docs/SPEC-tracks.md` §3, `docs/SPEC-channels.md` §3 |
| `workspace_id` d'un channel = celui de son track | clé étrangère **composite** | `docs/SPEC-channels.md` §2.4, §7 lignes *n* et *o* |
| `workflow_id` non nul, `global` ou `track` du track du channel | `NOT NULL` + triggers des deux côtés | `docs/SPEC-workflow-engine.md` §4.12 |

**Conséquence de conception, et elle gouverne tout le reste du document :** l'écran n'anticipe aucun
de ces refus pour décider s'il envoie la requête. Il **envoie**, puis **traduit** le refus reçu.
C'est la règle déjà tenue par le composeur de commentaires (`docs/DESIGN_SYSTEM.md` §5.10, « le
refus est un message, pas une absence ») et par `CLAUDE.md` §10, qui ne reconnaît un contrôle
d'interface que comme une aide.

La seule exception est la **validation de forme immédiate** du §8 : elle ne remplace aucune règle,
elle évite un aller-retour dont la réponse est connue d'avance, et le refus de la base reste traité
lorsqu'elle se trompe.

## 3. Adresse et composition

### 3.1 Deux adresses, et non une

| Adresse | Contenu |
|---|---|
| `/reglages` | **Index des sections de réglages.** Une liste de liens, une entrée aujourd'hui |
| `/reglages/arborescence` | L'écran d'administration lui-même |

**Pourquoi un index plutôt qu'un écran unique.** `/reglages` affiche aujourd'hui « Aucun réglage
modifiable » (`CRM-007`), ce qui devient faux avec cette unité. Deux corrections étaient possibles :
faire de `/reglages` l'écran d'administration, ou lui donner un index. La seconde est retenue parce
que **deux autres sections sont déjà planifiées** — `CRM-070` (permissions et invitations) et
`CRM-076` (éditeur de workflows). Placer l'arborescence à `/reglages` obligerait à **déplacer son
adresse** le jour où la deuxième arrive, et une adresse qui a été partagée ne se déplace pas
gratuitement.

L'index conserve la phrase de `CRM-007` sur la configuration d'instance — « tenue par le fichier
d'environnement du serveur » —, qui reste vraie : elle décrit l'instance, pas l'arborescence.

### 3.2 Composition de l'écran

Un seul écran, deux niveaux, **le track comme citoyen de première classe** (`CLAUDE.md` §4,
« architecture centrée sur l'objet métier principal ») :

```
Administration de l'arborescence
┌────────────────────────────────────────────────────────────┐
│ [+ Nouveau track]                    [ ] Afficher archivés │
├────────────────────────────────────────────────────────────┤
│ ▸ ⬤ Conseil & IA          conseil-ia      ↑ ↓  ✎  ⌫       │
│ ▾ ⬤ Studio web            studio-web      ↑ ↓  ✎  ⌫       │
│     ├ Refonte de site     refonte     W1  ↑ ↓  ✎  ⌫       │
│     ├ Maintenance         maintenance W1  ↑ ↓  ✎  ⌫       │
│     └ [+ Nouveau channel]                                  │
└────────────────────────────────────────────────────────────┘
```

- Les channels d'un track ne sont **chargés qu'au dépliage** de ce track. Charger les channels des
  quatre tracks à l'ouverture ferait transiter des lignes que l'écran ne montre pas, ce que la règle
  déjà tenue par `lireChannels` refuse (`docs/SPEC-channels.md` §5).
- Le dépliage est un `button` portant `aria-expanded`, pas une ligne cliquable : la cible du clic
  est la cible annoncée (`docs/DESIGN_SYSTEM.md` §5.9).
- **Aucune modale.** Le §5 du design system n'en déclare aucune, et `CRM-043` a déjà tranché le cas
  d'une confirmation en la plaçant dans le flux du document (`docs/DESIGN_SYSTEM.md` §5.10). Les
  formulaires de création et de renommage, et la confirmation d'archivage, prennent donc **la place
  de la ligne** qu'ils concernent, ou s'insèrent sous l'en-tête pour une création. Inventer une
  modale ici ferait porter au design system un composant que personne n'a spécifié.

Les règles visuelles de cette surface — hauteur de ligne, colonnes, groupe d'actions, formulaire en
ligne — sont écrites dans `docs/DESIGN_SYSTEM.md` §5.13, et non ici : ce document dit **ce que**
l'écran fait, celui-là **de quoi il a l'air**.

## 4. Les quatre états, et le cinquième

`docs/DESIGN_SYSTEM.md` §5.8 en exige quatre ; cette surface en a un de plus, et il est le plus
important.

| État | Ce que l'écran montre |
|---|---|
| Chargement | Squelettes de lignes, jamais un spinner plein écran |
| Vide | « Aucun track dans cet espace de travail », avec l'action de création |
| Erreur | Message et reprise **réelle** (`docs/SPEC-webapp.md` §6.4) |
| Absence de droit en **lecture** | La RLS rend `200` et zéro ligne : c'est l'état **vide**, pas une erreur (`docs/SPEC-permissions-rls.md` §7) |
| **Refus en écriture** | §9 : une alerte nommant la cause, la saisie **conservée**, la liste inchangée |

Le cinquième état est celui qu'un membre non administrateur rencontre : il **voit** l'arborescence,
puisqu'il a le droit de la lire, et ses écritures sont refusées. L'écran ne masque pas les commandes
pour autant — §10.

## 5. Créer et renommer un track

### 5.1 Créer

Formulaire en ligne, sous l'en-tête. Champs, dans cet ordre de tabulation :

| Champ | Obligatoire | Contrainte de base correspondante |
|---|---|---|
| Nom | oui | `CHECK (btrim(name) <> '')` |
| Slug | oui | `CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`, unique par workspace |
| Couleur | non — défaut `neutral` | `CHECK (color IN (…))`, cinq jetons |
| Icône | non — défaut `folder` | `CHECK (icon ~ '^[a-z][a-z0-9-]*$')` |
| Description | non | aucune |

**`position` n'est pas un champ.** Elle est omise à l'insertion, et le trigger place le track en fin
de liste (`docs/SPEC-tracks.md` §3). Demander sa valeur à l'utilisateur exposerait un index
fractionnaire qui n'a de sens que pour la machine.

**`workspace_id` est envoyé, et il n'est pas choisi.** L'écran envoie le workspace qu'il a lu par
`lireWorkspaces` — il n'y en a qu'un aujourd'hui. Il est envoyé parce que la colonne est obligatoire
et qu'aucun défaut ne l'attribue ; le `WITH CHECK` de la politique refuse tout workspace dont
l'appelant n'est pas administrateur, et c'est **cette règle-là** qui protège, pas le choix du
client. Le cas où l'appelant est membre de plusieurs workspaces n'existe pas encore et n'est pas
anticipé ici (§11, limite 4).

**Le slug est proposé à partir du nom, et reste modifiable.** La proposition minuscule, translittère
les diacritiques latines, remplace toute suite de caractères non alphanumériques par un tiret unique
et élague les tirés de bord. Elle est **une commodité, jamais une garantie** : lorsque le nom ne
contient aucun caractère exploitable — « ??? » —, la proposition est vide et le champ reste à
remplir par l'utilisateur, l'écran ne fabriquant pas un slug de son cru. La proposition cesse dès
que l'utilisateur a touché le champ du slug, sans quoi elle écraserait sa saisie.

### 5.2 Renommer

Le même formulaire, **sans le champ slug**, prenant la place de la ligne du track. Il modifie `name`,
`color`, `icon` et `description`.

L'annulation restaure la ligne sans écrire. Une modification non enregistrée qui serait perdue par
un clic ailleurs ne l'est pas : le formulaire reste ouvert tant qu'il n'est ni validé, ni annulé.

### 5.3 Pourquoi le slug ne se modifie pas

`docs/SCHEMA.md` §2 décrit le slug comme « identifiant d'URL **stable** », et `/tracks/:slug` est
l'adresse qu'un utilisateur partage. Le modifier romprait silencieusement tout lien déjà transmis,
sans qu'aucune redirection n'existe pour le rattraper.

**Ce n'est pas une règle inventée, et c'est important :** la base accepte parfaitement un
`UPDATE … SET slug = …`, et la preuve d'API du §12 le mesure. L'écran ne l'expose pas ; il ne
prétend pas que la base le refuse. La distinction est celle que `CLAUDE.md` §10 impose de tenir, et
la limite est nommée au §11 pour arbitrage.

## 6. Réordonner et archiver

### 6.1 Ce que réordonner veut dire

Réordonner, c'est écrire `position` — `docs/SPEC-tracks.md` §10.4 et `docs/SPEC-channels.md` §10.5
le disent déjà, et aucune RPC atomique n'existe.

### 6.2 Une seule écriture par déplacement, par index fractionnaire

Deux commandes par ligne, « Monter » et « Descendre ». Elles ne **permutent** pas deux positions —
ce qui coûterait deux `UPDATE` non atomiques, dont le second peut échouer en laissant la liste dans
un état que personne n'a voulu. Elles calculent **une** nouvelle position pour la ligne déplacée :

| Destination | Nouvelle position |
|---|---|
| Entre deux lignes | `(position(precedente) + position(suivante)) / 2` |
| En tête | `position(premiere) / 2` |
| En queue | `position(derniere) + 1` |

C'est exactement l'usage pour lequel `position` est un `numeric` et non un entier
(`docs/SPEC-tracks.md` §3 : « permettra d'insérer un track entre deux autres **sans renuméroter
toute la liste** »). Une seule ligne est écrite, l'écriture est atomique par construction, et un
refus laisse la liste **exactement** dans son état d'origine.

**Le cas dégénéré est traité, pas ignoré.** Si les deux voisines portent la **même** position — ce
que la base autorise, l'ordre se départageant alors par le nom (`docs/SPEC-tracks.md` §3) —, leur
milieu leur est égal et l'écriture ne changerait **rien** à l'ordre affiché. L'écran ne l'envoie
pas : il refuse le déplacement en le nommant, plutôt que d'écrire une valeur qui donne l'illusion
d'un effet. Le renumérotage atomique qui lèverait ce cas est une RPC que ni `CRM-020` ni `CRM-021`
n'ont livrée ; il est nommé au §11, limite 2.

De même, en tête de liste, une première position **nulle ou négative** rend `position / 2` inapte à
produire une valeur strictement inférieure — pour `0`, le milieu vaut `0`. Le même refus nommé
s'applique. Le seed ne produit aucun de ces deux cas ; ils sont traités parce que la base les
autorise, pas parce qu'ils sont attendus.

**Les commandes aux extrémités sont désactivées, jamais masquées** : `docs/DESIGN_SYSTEM.md` §8 —
« les états désactivés restent lisibles et expliquent pourquoi l'action est indisponible ».

### 6.3 Archiver et désarchiver

Archiver, c'est écrire `archived_at = now()` ; désarchiver, c'est l'écrire à `null`. Les deux sont
de simples `UPDATE` soumis à la même politique (`docs/SPEC-tracks.md` §4).

**L'archivage demande une confirmation explicite nommant l'objet** (`docs/DESIGN_SYSTEM.md` §6),
dans le flux du document et non dans une modale (§3.2). Le désarchivage n'en demande aucune : il ne
retire rien.

**Pourquoi le désarchivage est livré ici, alors que l'énoncé de `CRM-075` ne cite que quatre
verbes.** L'énoncé motive l'absence de suppression par le fait qu'« archiver masque et reste
**réversible** ». Un écran qui archive sans pouvoir désarchiver rend cette phrase fausse **dans le
produit** : l'administrateur qui archive un track par erreur devrait reprendre la clé de service,
c'est-à-dire exactement le défaut qu'INC-086 relève. Le désarchivage n'ajoute aucune règle, aucune
colonne et aucune politique — c'est le même `UPDATE`, à la même table, sous la même politique.

Ce n'est pas la corbeille de `CRM-077`, qui porte une durée de rétention, des dépendances visibles
et un effacement définitif. **Si le responsable juge malgré tout ce geste hors périmètre, il se
retire en supprimant la case du §6.4 et deux fonctions** : la décision est nommée au §11, limite 1,
plutôt que prise en silence.

### 6.4 Voir les archivés

Une case à cocher « Afficher les archivés », **éteinte par défaut**, qui retire le filtre
`archived_at=is.null` de la lecture. Une ligne archivée porte une mention textuelle « Archivé » —
jamais une couleur seule (`docs/DESIGN_SYSTEM.md` §1) —, et son groupe d'actions se réduit à
« Désarchiver » : renommer ou réordonner un objet masqué n'a pas d'effet observable.

L'état de la case est une **préférence d'écran, non persistée** : ni cookie, ni `localStorage`
(`CLAUDE.md` §11). Elle retombe à l'état éteint au rechargement, ce qui est le comportement voulu —
la vue par défaut de l'administration est l'arborescence **active**.

## 7. Les channels

Les mêmes gestes, à trois différences près, et chacune vient d'une règle déjà posée.

### 7.1 La portée de l'ordre est le track

`position` d'un channel est attribuée et comparée **dans son track** (`docs/SPEC-channels.md` §3).
Le calcul du §6.2 s'applique donc à la liste des channels de ce track, et non à tous les channels du
workspace.

### 7.2 Désigner un workflow est obligatoire

`channels.workflow_id` est `NOT NULL` depuis `CRM-033`, et sa valeur doit être un workflow `global`
du workspace **ou** un workflow `track` du track du channel
(`docs/SPEC-workflow-engine.md` §4.12.2).

Le formulaire de création propose donc une liste, lue par une requête **filtrée côté serveur** sur
exactement ces deux cas :

```
GET /rest/v1/workflows?select=id,name,scope,is_default
    &workspace_id=eq.<ws>&or=(scope.eq.global,and(scope.eq.track,track_id.eq.<track>))
    &order=is_default.desc,name
```

- **Aucun défaut n'est présélectionné.** `docs/SPEC-workflow-engine.md` §4.12.5 le dit d'une
  colonne, et la raison vaut pour un formulaire : « le défaut silencieux transformerait une omission
  du client en un choix qu'il n'a pas fait ». Le workflow par défaut est **présenté en tête** et
  signalé comme tel, ce qui est une aide ; il n'est pas coché.
- **Si la liste est vide**, la création de channel est impossible et l'écran le **dit** — « aucun
  workflow n'est affectable à ce track » — au lieu d'afficher un formulaire dont l'envoi serait
  refusé. Ce n'est pas un contrôle d'accès mais un état vide : il n'y a rien à choisir.
- Le refus `23514` `workflow_hors_track`, que la course entre le chargement de la liste et l'envoi
  rend atteignable, reste traité au §9.

### 7.3 Le `workspace_id` d'un channel n'est pas choisi

Il est celui de son track, et la clé étrangère composite le garantit
(`docs/SPEC-channels.md` §2.4). L'écran envoie le `workspace_id` **du track déplié**, jamais une
valeur saisie.

## 8. Validation de forme immédiate — ce qu'elle est, et ce qu'elle n'est pas

Trois contrôles seulement, tous portant sur la **forme**, jamais sur un droit :

| Contrôle | Effet | Règle réelle |
|---|---|---|
| Nom vide ou blanc | Le bouton d'envoi est désactivé | `CHECK (btrim(name) <> '')` |
| Slug vide | idem | `NOT NULL` |
| Slug non conforme au motif | Message sous le champ, envoi désactivé | `CHECK (slug ~ …)` |

Le motif est **copié de la contrainte**, comme `LONGUEUR_MAX_CORPS` l'est de la sienne
(`webapp/src/lib/commentaires.ts`), et il est exporté pour que le test unitaire compare les deux
écritures. **L'unicité du slug n'est pas contrôlée ici** : la connaître exigerait une requête dont
la réponse serait périmée à l'instant où elle arrive. Le `23505` est traité au §9, et c'est le seul
endroit où cette règle est tenue.

## 9. Les refus, et comment ils sont présentés

L'écran classe le refus sur le **code d'erreur PostgreSQL** puis sur le **code HTTP**, jamais sur le
texte du message — la règle de `classerErreur` (`webapp/src/lib/async.ts`), reprise sans exception.

| Refus | Code | Ce que l'écran dit |
|---|---|---|
| Politique d'écriture | `403` / `42501` | « Seul un administrateur de cet espace de travail peut modifier l'arborescence. » |
| Slug déjà pris | `409` / `23505` | « Ce slug est déjà utilisé » — sous le champ du slug, qui reçoit le focus |
| Forme refusée par un `CHECK` | `400` / `23514` | Le message de forme correspondant, sous le champ concerné |
| Workflow incompatible | `400` / `23514` `workflow_hors_track` | « Ce workflow n'est pas affectable à ce track. » |
| Track ou workspace incohérent | `409` / `23503` | « Ce track n'existe plus, ou n'appartient pas à cet espace de travail. » |
| Transport | aucun code | « La requête n'a pas abouti », avec reprise |

Deux règles gouvernent tous ces cas :

1. **La saisie est conservée.** Vider un formulaire après un refus ferait perdre à l'utilisateur un
   texte pour une erreur qui n'est pas la sienne (`docs/DESIGN_SYSTEM.md` §5.10).
2. **Un `PATCH` qui rend `200` et zéro ligne n'est ni un succès ni une erreur.** Le `USING` de la
   politique filtre la ligne avant la mise à jour, et PostgREST rend une collection vide. L'écran le
   traite comme un état propre — « sans effet » —, exactement comme les gestes d'auteur de
   `CRM-043` (`webapp/src/lib/commentaires.ts`, `ResultatGeste`). Le confondre avec un succès
   afficherait une modification qui n'a pas eu lieu.

Après une écriture acceptée, la liste est **relue** plutôt que corrigée en mémoire : la position
attribuée par le trigger, l'horodatage d'archivage et l'ordre résultant viennent du serveur. Une
mise à jour optimiste devrait les deviner, et `docs/DESIGN_SYSTEM.md` §6 ne réserve l'optimisme
qu'au glisser-déposer d'une card, où le retour visuel immédiat est le geste lui-même.

## 10. Ce que voit un non-administrateur

**Les commandes ne sont pas masquées, et ce choix est motivé.**

`CRM-075` pose qu'« un `viewer` ne voit aucun de ces gestes […] mais c'est une **aide d'interface**
». Cette unité tient la seconde moitié de la phrase et **écarte la première**, pour une raison
mesurable : l'interface ne dispose d'aucun moyen fiable de connaître le rôle de l'appelant sans le
demander au serveur, et un rôle lu au chargement peut avoir changé à l'instant de l'écriture. Une
commande masquée sur la foi d'un rôle périmé cacherait un geste **permis** ; une commande affichée
puis refusée montre le refus **réel**.

C'est la position déjà tenue par le composeur de commentaires — « il est **toujours rendu** :
l'interface ne calcule aucun droit d'écriture, elle envoie et traduit le refus du backend »
(`docs/DESIGN_SYSTEM.md` §5.10) — et la reprendre évite deux comportements contradictoires dans le
même produit pour la même question.

Le refus reste donc **prouvé hors interface**, avec les jetons réels du `viewer` et du
`business_developer` (`CLAUDE.md` §10), et l'écran se contente de le traduire lisiblement.

## 11. Limites connues, et ce qui reste à arbitrer

1. **Le désarchivage dépasse les quatre verbes de l'énoncé de `CRM-075`** (§6.3). Il est livré parce
   que sans lui « réversible » est faux dans le produit. **Arbitrage du responsable attendu** ; d'ici
   là le geste existe et son motif est écrit.
2. **Deux positions égales, ou une première position nulle ou négative, bloquent un déplacement**
   (§6.2). L'écran le nomme au lieu d'écrire une valeur sans effet. La RPC de renumérotage atomique
   qui lèverait le cas n'appartient à aucune unité — même constat qu'INC-086, un cran plus bas.
3. **L'index fractionnaire s'épuise en précision flottante.** `position` est un `numeric` de
   précision arbitraire en base, mais le milieu est calculé en JavaScript, dont le `number` est un
   flottant 64 bits : après une cinquantaine d'insertions au **même** point de la liste, le milieu
   redevient égal à l'une des bornes et la limite 2 s'applique. Aucune liste réelle n'atteint ce
   régime ; le fait est écrit parce qu'il est vrai, pas parce qu'il est probable.
4. **Un seul workspace est supposé.** L'écran administre celui que `lireWorkspaces` rend en premier.
   Le produit n'a jamais eu de sélecteur de workspace, et en inventer un ici dépasserait l'unité.
5. **Le slug ne se modifie pas depuis l'écran** (§5.3), alors que la base l'accepte.
6. **Aucune pagination.** La barre latérale défile déjà et rien ne borne le nombre de tracks côté
   serveur (`docs/SPEC-tracks.md` §10.5) ; cet écran hérite de la même limite.
7. **L'archivage d'un track ne cascade pas sur ses channels** (`docs/SPEC-channels.md` §4). L'écran
   ne le suggère pas et la confirmation ne le promet pas.

## 12. Preuves attendues

| Preuve | Support |
|---|---|
| Calcul de position, dégénérescences, proposition de slug, motif, classement des refus | `webapp/src/lib/administration-arborescence.test.ts` |
| Requêtes réellement émises pour chaque geste | idem |
| Rendu, états, formulaires, confirmation, commandes désactivées aux extrémités | `webapp/src/app/AdministrationArborescence.test.tsx` |
| Les refus des trois profils, hors interface, avec les jetons réels | `e2e/api/administration-arborescence.spec.ts` |
| Créer, renommer, réordonner, archiver, désarchiver — track puis channel, clavier **et** souris | `e2e/ui/administration-arborescence.spec.ts` |
| Le sélecteur de workflow du §7.2 ne propose QUE les affectables, et le refus du §9 tient quand la liste est périmée | `e2e/ui/coherence-workflow.spec.ts` (`CRM-033`, `docs/SPEC-workflow-engine.md` §4.12.9) |
| Captures aux quatre paliers | `e2e/output/CRM-075/*.jpg` |
| Seed inchangé après le passage du scénario | `e2e/ui/administration-arborescence.spec.ts`, épilogue |
| Rejeu complet et non-complaisance | `scripts/verify-administration-arborescence.sh` |

Le harnais est **non complaisant** au sens des autres unités : il dégrade réellement le produit —
politique d'écriture relâchée, contrainte de slug retirée, calcul de position faussé — et exige que
les preuves échouent, puis restaure et constate le retour au vert.

**Le scénario E2E rend le seed à son état initial.** Il crée ses propres objets, sous des slugs
préfixés qui n'entrent en collision avec aucun slug seedé, et les archive en épilogue — la
suppression n'existant pas. Un scénario qui laisserait derrière lui un track de plus ferait dériver
les captures et les comptages des autres unités.

---

## 13. Créer un channel depuis le track, et l'aller-retour vers l'éditeur de workflows — `CRM-100`

*Écrit le 2026-10-11, avant le code — décision 623 (`docs/JOURNAL.md`), arbitrages du responsable. Charte :
`docs/DESIGN_SYSTEM.md` §5.55.*

### 13.1 Objet, et ce que ce chapitre ne livre pas

Deux raccourcis d'ergonomie, **sans aucune règle nouvelle** — la contrainte du §1 vaut ici mot pour mot :

1. **« Nouveau channel » dans la vue d'un track** (`/tracks/:slugTrack…`) : le formulaire du §7 s'ouvre sous la barre
   d'onglets, sans passer par les réglages ;
2. **« Nouveau workflow » dans le formulaire de CRÉATION d'un channel**, aux deux endroits où il vit : un aller-retour vers
   l'éditeur de workflows (`docs/SPEC-workflow-engine.md` §3 bis), qui rend la saisie intacte et présélectionne le
   workflow créé.

| Hors périmètre | Pourquoi |
|---|---|
| « Nouveau workflow » dans le formulaire de **modification** d'un channel | Changer le workflow d'un channel qui porte des affaires relève de `docs/SPEC-change-channel-workflow.md`, pas d'un raccourci |
| Toute migration, toute politique, toute fonction | Les écritures sont celles du §7 et du §3 bis de `docs/SPEC-workflow-engine.md`, déjà prouvées |
| Masquer les commandes selon le rôle | §10 ; la question générale appartient à `CRM-093`, non arbitrée |
| Une modale | `docs/DESIGN_SYSTEM.md` §5.13 : aucune ; le formulaire vit dans le flux |
| Une création de workflow « en ligne » dans le formulaire du channel | Écartée par la décision 623 : un workflow naît vide, et le composer exige l'éditeur |

### 13.2 Le formulaire partagé

Le formulaire du §7 quitte `AdministrationArborescence.tsx` pour un module propre, `webapp/src/app/FormulaireChannel.tsx`,
qu'importent les deux écrans. Il n'est **pas recopié** : deux copies divergeraient au premier refus traduit d'un côté
seulement. Ce qu'il demande, sa validation de forme (§8), ses refus (§9) et l'absence de défaut présélectionné (§7.2) sont
inchangés.

Il reçoit deux propriétés nouvelles, **toutes deux réservées à la création** :

- **`cheminNouveauWorkflow(saisie)`** — l'adresse de l'aller-retour, calculée par l'écran hôte à partir de la saisie
  COURANTE (§13.4). Fournie, elle rend le lien « Nouveau workflow » sous le sélecteur, **quel que soit l'état de la liste**
  — chargement, erreur, vide ou non —, et l'état vide « aucun workflow n'est affectable » de `CRM-094` mène à la même
  adresse au lieu de l'éditeur nu. Absente — en modification —, rien ne change ;
- **`idWorkflowAttendu`** — le workflow créé pendant l'aller-retour (§13.6). S'il figure dans la liste lue, il est la
  valeur initiale du sélecteur ; s'il n'y figure pas — créé propre à UN AUTRE track —, le sélecteur reste sur « Choisir »
  et une ligne le dit sous lui : « Le workflow créé n'est pas affectable à ce track. » Le taire laisserait croire que
  l'aller-retour a échoué.

### 13.3 « Nouveau channel » dans la vue d'un track

**Où.** Une commande de la barre d'onglets, **après les onglets des channels et avant les entrées transverses** (« Coûts »,
`docs/DESIGN_SYSTEM.md` §4). Elle est rendue aussi quand le track n'a aucun channel — à côté de « Aucun channel », qui
reste vrai.

**Un lien, et non un bouton.** Le formulaire ouvert est un état de l'ADRESSE : `?nouveau-channel=1`, ajouté aux
paramètres présents (ceux de la vue liste sont conservés). C'est ce qui permet au retour de l'éditeur (§13.6) de rouvrir le
formulaire, et à un rechargement de ne pas le perdre. La règle de la charte (§12.1, §5.51) veut qu'un geste qui change
l'adresse soit un lien.

**Ce que l'écran fait à l'ouverture.** Le formulaire paraît en tête de la zone principale, au-dessus du board, de la vue
liste ou de l'état vide, qui restent rendus dessous — sauf l'état vide « aucun channel », que le formulaire remplace. La
liste des workflows affectables est lue À L'OUVERTURE (lecture du §7.2, inchangée), avec le `workspace_id` du track : la
lecture du track par la route (`COLONNES_TRACK_OUVERT`, `webapp/src/lib/channels.ts`) porte désormais cette colonne, la
seule ajoutée par ce chapitre.

**Ce que l'écran envoie.** L'écriture `creerChannel` du §7, inchangée : `workspace_id` et `track_id` du track de la route,
jamais saisis (§7.3).

**Après un succès.** Les paramètres du formulaire quittent l'adresse, la vue s'ouvre sur le **board du nouveau channel**
(`/tracks/<track>/<slug créé>`), les channels du track sont **relus** — l'onglet paraît sans rechargement, sans squelette
—, l'annonce « Channel « … » créé » est faite dans la région vivante, et le focus se pose sur l'onglet du nouveau
channel, une fois celui-ci rendu.

**Après un refus.** Le refus s'écrit dans le formulaire (§9), la saisie conservée.

**Annuler, ou `Échap` depuis un champ**, retire les paramètres du formulaire de l'adresse et rend le focus à la commande
« Nouveau channel » — différé d'un rendu, sans temporisation.

**L'état vide « aucun channel »** cesse de porter le lien vers l'arborescence : le geste vit désormais sur l'écran même, et
le §5.51 de la charte veut alors que le texte NOMME la commande — « Nouveau channel » — sans ajouter de second accès.

### 13.4 L'aller-retour : l'adresse de départ

« Nouveau workflow » mène à :

```
/reglages/workflows?creer=1&track=<id du track>&retour=<adresse d'origine, encodée>
```

L'**adresse d'origine** est celle de l'écran hôte, formulaire ouvert, **brouillon compris** :

| Écran hôte | Adresse d'origine |
|---|---|
| Vue d'un track | l'adresse courante (chemin et paramètres conservés), `nouveau-channel=1` |
| Arborescence | `/reglages/arborescence?nouveau-channel=<id du track>` |

et, dans les deux cas, le brouillon : `nc-nom`, `nc-slug`, `nc-description` — un paramètre vide n'est pas écrit. Le
préfixe `nc-` évite toute collision avec les paramètres de la vue liste. Le slug n'est porté que s'il a été **saisi** :
un slug proposé à partir du nom se recalcule au retour.

**Pourquoi l'adresse, et pas un stockage du navigateur** : rien n'est conservé hors de l'historique de l'onglet
(`CLAUDE.md` §11) ; le retour, le bouton « Précédent » et un rechargement produisent le même formulaire.

### 13.5 Dans l'éditeur de workflows

- **`creer=1`** ouvre le formulaire de création au montage ; **`track=<id>`** y pré-règle la portée « Propre à un track »
  et ce track — modifiables : la portée « Global » reste un choix légitime. Une fois lus, ces deux paramètres **quittent
  l'adresse** (remplacement, sans entrée d'historique) : un rechargement ne rouvre pas une création déjà faite ou
  abandonnée.
- **Un workflow créé** — par le formulaire, ou par l'acceptation d'une suggestion de l'IA (`docs/SPEC-ia.md` §12.5), qui
  crée et choisit un workflow — **inscrit `workflow-cree=<id>` dans l'adresse** (remplacement). Un rechargement en pleine
  composition ne le perd pas. Un second workflow créé remplace le premier : c'est le dernier créé qui revient.
- **`retour`** est lu à chaque rendu. S'il est **valide** (§13.7), un bandeau en tête de l'écran le rappelle — « Vous créez
  un channel » — avec le lien **« Revenir au nouveau channel »**. Après une création, le bandeau nomme le workflow qui
  sera présélectionné. `retour` reste dans l'adresse tant qu'on compose : choisir un autre workflow, ajouter des étapes,
  des transitions ou des champs ne le fait pas disparaître.
- Le lien de retour mène à l'adresse d'origine, augmentée de **`nc-workflow=<workflow-cree>`** lorsqu'un workflow a été
  créé. Sans création, il ramène au formulaire tel qu'il a été quitté.

**Le formulaire de création ne prend le focus qu'à son OUVERTURE**, et repart de la saisie courante s'il est remonté.
*Ajouté le 2026-10-11, défaut trouvé par l'E2E du guide flottant* : ouvert par `creer=1` sur un éditeur vide, le
formulaire était remonté quand le guide posait le workflow de départ — la liste relue le fait passer de l'état vide à
la colonne de gauche — et reprenait le focus que le guide venait de poser sur son lien, la saisie perdue.

L'éditeur ne contrôle pas que le workflow créé ait des étapes : un workflow vide est un brouillon légitime
(`docs/SPEC-workflow-engine.md` §3.5), et le board du channel le dira par son état vide, qui mène à l'éditeur (§5.51).

### 13.6 Au retour

- **Vue d'un track** : `nouveau-channel=1` ouvre le formulaire, prérempli de `nc-nom`, `nc-slug`, `nc-description`, et
  `nc-workflow` devient `idWorkflowAttendu` (§13.2).
- **Arborescence** : `nouveau-channel=<id du track>` — une fois les tracks lus — déplie ce track s'il ne l'est pas et ouvre
  sa création de channel, préremplie de la même façon. Si le track n'est pas dans la liste lue — archivé et masqué, retiré,
  ou illisible —, les paramètres quittent l'adresse et rien ne s'ouvre : il n'y a pas de formulaire à rouvrir sur un track
  que l'écran ne montre pas.
- Dans les deux écrans, **les paramètres du formulaire quittent l'adresse quand il se referme** — succès, « Annuler » ou
  `Échap`.

### 13.7 Validation de l'adresse de retour

`retour` vient de l'adresse, donc de n'importe qui : un lien forgé ne doit pas faire de l'éditeur une **redirection
ouverte**. Il n'est retenu que s'il est, une fois décodé :

- un chemin **relatif à l'origine** — commence par un seul `/`, sans `//`, sans `\`, sans schéma ;
- vers l'un des **deux écrans hôtes** : `/tracks/<slug>`, `/tracks/<slug>/<slug>` ou `/tracks/<slug>/<slug>/liste`, ou
  `/reglages/arborescence` ;
- portant le paramètre `nouveau-channel`.

Sinon le bandeau n'est pas rendu, et l'éditeur se comporte comme sans aller-retour. La validation est une fonction pure
de `webapp/src/lib/nouveau-channel.ts`, prouvée par ses tests unitaires — dont les formes d'attaque : adresse absolue,
`//hôte`, `/\hôte`, `javascript:`, chemin hors liste.

### 13.8 États, rôles et refus

- Les quatre états du formulaire sont ceux du §7 : chargement de la liste des workflows, erreur de lecture, liste vide,
  liste prête.
- **Rendu à tous les rôles** (§10) : la commande, le formulaire et le lien « Nouveau workflow » le sont ; la base refuse la
  création d'un channel (`42501`) et celle d'un workflow (`docs/SPEC-workflow-engine.md` §3 bis.5) à qui n'est pas
  administrateur, et l'écran traduit. Le refus est déjà prouvé hors interface par `e2e/api/administration-arborescence.spec.ts`
  et par les preuves d'API de `CRM-031` ; la preuve E2E de ce chapitre montre qu'il est TRADUIT dans la vue du track.
- Un workflow non affectable au retour : §13.2.

### 13.9 Limites connues

1. Le brouillon voyage en clair dans l'adresse — nom, slug, description d'un channel, rien de plus. Il entre dans
   l'historique du navigateur comme toute adresse du produit ; aucune donnée personnelle n'y est attendue.
2. Un aller-retour abandonné — l'éditeur quitté par un autre chemin — laisse le workflow créé, vide ou non : c'est un objet
   d'administration ordinaire, visible dans l'éditeur.
3. Un workflow créé propre à un autre track n'est pas affectable ; l'écran le dit (§13.2) sans proposer de le copier.

### 13.10 Preuves attendues

| Preuve | Support |
|---|---|
| Composition des adresses, lecture du brouillon, validation du retour (formes d'attaque comprises) | `webapp/src/lib/nouveau-channel.test.ts` |
| Le formulaire partagé : lien « Nouveau workflow » et son adresse, présélection, workflow non affectable, modification sans lien | `webapp/src/app/FormulaireChannel.test.tsx` |
| La commande de la barre d'onglets, avec et sans channel, son adresse | `webapp/src/app/TabBar.test.tsx` |
| La zone « Nouveau channel » de la vue du track : lecture des workflows du track, envoi, refus, annulation, `Échap`, adresse d'origine, retour prérempli | `webapp/src/app/NouveauChannelTrack.test.tsx` |
| La route elle-même — le board du channel créé, l'onglet focalisé, l'état vide sans lien | `e2e/ui/nouveau-channel.spec.ts` et `e2e/ui/premier-lancement.spec.ts` : la coquille entière ne se monte pas sans la pile |
| L'éditeur : `creer=1` et `track`, bandeau, `workflow-cree` après création et après acceptation IA, lien de retour, focus non repris au remontage | `webapp/src/app/AdministrationWorkflows.nouveau-channel.test.tsx` |
| L'arborescence : réouverture préremplie par l'adresse, track absent | `webapp/src/app/AdministrationArborescence.test.tsx` |
| La lecture du track porte `workspace_id` | `webapp/src/lib/channels.test.ts` |
| Parcours réels : créer un channel depuis le track à la souris ; l'aller-retour complet au clavier seul (workflow créé, une étape ajoutée, retour, channel créé, board à une colonne) ; l'aller-retour depuis l'arborescence ; le refus traduit pour un non-administrateur ; captures aux quatre paliers | `e2e/ui/nouveau-channel.spec.ts`, captures `docs/captures/CRM-100/` |

Le scénario E2E rend le seed à son état : ses channels et workflows portent un préfixe propre, et sont retirés après chaque
scénario par la clé de service — le patron de `e2e/ui/nouvelle-affaire.spec.ts` —, retrait CONSTATÉ par une relecture.
Chaque effet d'écran est confirmé en base par une lecture de service.

## 14. La couleur d'un track et d'un channel — `CRM-116`, décision 729

*Écrit le 2026-10-26, avant le code, sur les arbitrages du responsable.* L'apparence du sélecteur et de la pastille est
réglée par `docs/DESIGN_SYSTEM.md` §5.68 ; ce chapitre fixe ce que la base porte, ce que les formulaires envoient et
ce que les écrans lisent.

### 14.1 Objet

Le responsable : « je vois en dev des tracks et des channels en couleur et aucune façon de le faire en UI ». Mesuré :
`tracks.color` existe et le formulaire du §5.1 la propose, mais par une liste de noms de jetons (`brand`, `success`…),
illisible ; `channels` n'a aucune couleur (`docs/SPEC-channels.md` §2.1, position révisée par ce chapitre). Arbitrages :
une couleur propre au channel, des pastilles nommées pour les deux formulaires, **pas de connecteur MCP** — la couleur
se choisit dans la webapp seulement, et les outils de structure du connecteur n'écrivent pas la colonne : un channel
créé par eux prend le défaut `neutral`.

### 14.2 La donnée

`channels.color` : `text`, non nul, défaut `'neutral'`, `CHECK (color IN ('brand','success','accent','danger',
'neutral'))`, contrainte `channels_color_check` — la forme exacte de `tracks.color` (`docs/SCHEMA.md`). Migration au
prochain numéro libre au moment du code ; les channels existants prennent le défaut. **Aucune politique nouvelle** :
la colonne entre dans les privilèges `INSERT` et `UPDATE` déjà accordés à `authenticated` sur `channels`, s'ils le
sont colonne par colonne, et les politiques existantes — insertion et mise à jour par `app.is_workspace_admin` —
décident de qui l'écrit. Retour arrière : supprimer la colonne ; aucune autre donnée n'en dépend.

### 14.3 Les formulaires

- **Track** (§5.1, §5.2) : le champ « Couleur » devient le sélecteur ; il reste à sa place, après le slug et avant
  l'icône. La valeur envoyée est inchangée — un des cinq jetons.
- **Channel** (§7, `FormulaireChannel` partagé avec la barre d'onglets, §13.2) : un champ « Couleur » nouveau, après le
  slug et avant le workflow ; `neutral` à la création, la valeur lue en modification. `creerChannel` et la
  modification d'un channel envoient `color`. Le formulaire étant partagé, la création depuis l'arborescence et depuis
  « Nouveau channel » de la barre d'onglets reçoivent le champ ensemble.
- **Refus** : la valeur ne peut sortir des cinq jetons depuis l'écran ; un `23514` sur `channels_color_check`, que seul
  un appel direct atteint, rejoint le refus générique du §9. Les refus de droit sont ceux du §9 et du §10, inchangés.

### 14.4 Les lectures

- **Barre d'onglets** : `color` rejoint la sélection des channels (`docs/SPEC-channels.md` §5) — la même lecture, aucune
  requête de plus.
- **Arborescence** : `color` rejoint `COLONNES_CHANNEL_ADMIN` (`webapp/src/lib/administration-arborescence.ts`), pour la
  pilule et pour la valeur initiale du formulaire de modification.

### 14.5 Ce que voit un non-administrateur

Rien de nouveau : les formulaires ne lui sont pas offerts (§10), et la pastille de l'onglet est une lecture, ouverte à
qui lit le channel.

### 14.6 Limites connues

- **L'icône d'un track reste une liste de noms techniques** (`folder`, `briefcase`…). Le même défaut de lisibilité,
  non demandé : hors de ce chapitre, à arbitrer.
- La couleur d'un channel n'est pas reportée sur ses cartes ni sur son board : seuls l'onglet et l'arborescence la
  montrent, comme arbitré.

### 14.7 Preuves attendues

pgTAP de la contrainte et du défaut ; preuve d'API aux jetons réels — l'administrateur écrit la couleur d'un channel,
un `business_developer` et une lectrice sont refusés, une valeur hors jetons est refusée par `23514` ; unitaires du
sélecteur (rendu, valeur initiale, flèches, repli d'une valeur inconnue), des formulaires (valeur envoyée) et de la
pastille ; E2E à la souris et au clavier sur les deux formulaires de channel et sur celui de track, la pastille relue
sur l'onglet, la lectrice sans formulaire, quatre paliers ; captures observées ; seed ; manuel, chapitre 5 et section
3.2 ter.
