# Spécification — Administration des tracks et des channels

Unité de backlog : `CRM-075` (voir `docs/BACKLOG.md`).
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
