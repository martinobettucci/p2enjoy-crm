# Spécification — Moteur de workflow

Unités de backlog : `CRM-030` à `CRM-034` (voir `docs/BACKLOG.md`).
Documents liés : `docs/SCHEMA.md` §3, `docs/SPEC-permissions-rls.md`,
`docs/SPEC-form-composer.md`, `docs/SPEC-seed.md`, `docs/DESIGN_SYSTEM.md` §1, §5.1–5.2.

Le §2 a été **réécrit après mesure** lors de `CRM-030`, le §3 lors de `CRM-031` ; les §4 à §9
datent de `CRM-000` et n'engagent que l'intention, jusqu'à ce que les unités correspondantes les
mesurent à leur tour.

---

## 1. Intention

Un workflow décrit les états possibles d'une card et **les déplacements autorisés entre ces
états**. Chaque channel suit un workflow ; deux channels d'un même track peuvent en suivre des
différents.

Trois exigences dictent la conception :

1. On assemble un workflow **à partir de nœuds** issus d'un catalogue partagé — c'est ce qui rend
   comparable le temps passé en « Relance » d'un channel à l'autre.
2. On crée des **workflows globaux**, on les **copie dans un track** pour les y modifier, et
   chaque channel choisit parmi ceux disponibles dans son track.
3. Un déplacement non prévu est **refusé par le backend**, pas seulement masqué dans l'interface.

## 2. Catalogue de nœuds — `CRM-030`

Le catalogue (`workflow_nodes_catalog`) est propre à un workspace. Chaque nœud porte une clé
stable, un libellé, un type (`open`, `won`, `lost`), une couleur, une probabilité par défaut et
un seuil de relance par défaut.

Ce chapitre a été **écrit après mesure**, et non de mémoire : une table sonde jetable portant la
structure et les politiques envisagées a été créée sur la pile réelle, interrogée avec les jetons
des trois comptes seedés obtenus par la véritable route de connexion, puis détruite — l'absence de
reste étant constatée (`to_regclass` nul, aucune fonction `app.sonde*`, aucun workspace de sonde).
Les valeurs chiffrées des §2.3 à §2.8 sont ces mesures.

### 2.1 Ce que le catalogue est, et ce qu'il n'est pas

Le catalogue est un **vocabulaire**, pas un workflow. Il ne dit ni l'ordre dans lequel une card
traverse les états, ni quels déplacements sont permis : cela relève de `workflow_steps` et de
`workflow_transitions` (§3). Il dit seulement **quels états ont un nom dans ce workspace**, et ce
que ce nom signifie pour l'analytique.

C'est ce qui rend comparable le temps passé en « Relance » d'un channel à l'autre : deux workflows
différents qui instancient le même nœud parlent du même état. Une étape peut en surcharger le
libellé, la probabilité et le seuil de relance ; **la clé et le type restent ceux du catalogue**,
faute de quoi la comparabilité serait perdue au premier renommage.

### 2.2 Modèle

Référence de schéma : `docs/SCHEMA.md` §3. Le tableau ci-dessous est celui de la table réellement
livrée, complété des `created_at` / `updated_at` que les conventions générales de `docs/SCHEMA.md`
exigent de toute table métier et que le §3 omettait — même omission que celle relevée pour
`tracks` et `channels` (INC-025).

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `workspace_id` | `uuid` | non nul, FK `workspaces` `on delete cascade` |
| `key` | `text` | non nul, minuscules-chiffres-tirets, **unique par workspace** |
| `label` | `text` | non nul, non vide après `btrim` |
| `kind` | `text` | non nul, défaut `open`, `CHECK (kind in ('open','won','lost'))` |
| `color` | `text` | non nul, défaut `neutral`, jeton du design system |
| `default_probability` | `numeric(5,2)` | nullable, `CHECK (0 ≤ x ≤ 100)` |
| `default_stale_after_days` | `integer` | nullable, `CHECK (x > 0)` |
| `position` | `numeric` | non nul, attribuée si omise |
| `archived_at` | `timestamptz` | non nul = archivé |
| `created_at`, `updated_at` | `timestamptz` | `now()` ; `updated_at` maintenu par trigger |

`workspace_id` est porté directement, sans jointure : c'est la convention générale de
`docs/SCHEMA.md`, et ici elle ne coûte rien — le catalogue n'a pas de parent intermédiaire, donc
aucune dénormalisation ne peut mentir, contrairement à `channels.workspace_id` qui a exigé une clé
étrangère composite (`docs/SPEC-channels.md` §2.4).

**`color` est un nom de jeton, jamais un hexadécimal** — `docs/DESIGN_SYSTEM.md` §1, « Couleurs de
données ». Les cinq valeurs admises sont celles de `tracks` : `brand`, `success`, `accent`,
`danger`, `neutral`. Le défaut est `neutral` : un nœud qui n'a pas choisi sa couleur ne doit pas
revendiquer celle de la marque.

### 2.3 La clé stable

`key` est l'identifiant durable du nœud, celui sur lequel l'analytique s'appuie. Il est contraint
à la même forme que les slugs de `tracks` et de `channels` — `^[a-z0-9]+(-[a-z0-9]+)*$` — de sorte
qu'il reste utilisable dans une URL, un nom de colonne de rapport ou une clé de traduction.

**Mesuré**, sur la sonde : `prospection` et `relance-longue` acceptés ; `Majuscule`,
`deux--tirets`, `-debut`, `fin-`, `avec_underscore`, `accentué` et la chaîne vide refusés, chacun
par `sonde_wnc_key_check`.

L'unicité est **par workspace**, pas globale. **Mesuré** : la même clé insérée deux fois dans le
même workspace est refusée (`duplicate key value violates unique constraint`, détail nommant
`(workspace_id, key)`) ; la même clé dans un autre workspace est acceptée. Deux workspaces peuvent
donc avoir chacun leur `prospection` sans se gêner — c'est la condition pour que le catalogue soit
réellement « propre à un workspace ».

### 2.4 Ordre du catalogue

`position` ordonne l'affichage du catalogue dans l'écran d'administration. Sa portée est le
**workspace** : le catalogue est une liste unique par workspace, contrairement aux onglets de
channels dont la portée est le track (`docs/SPEC-channels.md` §3).

Le type est `numeric` et non `integer`, comme `tracks.position` et `channels.position` : insérer un
nœud entre deux autres n'exigera pas de renuméroter la liste entière.

La colonne est `NOT NULL` **sans défaut de colonne** ; un trigger `BEFORE INSERT` la renseigne
lorsqu'elle est omise, en plaçant le nœud en fin de liste de son workspace.

**Mesuré** : trois insertions sans `position` dans un workspace rendent `1`, `2`, `3` ; une
quatrième dans un **autre** workspace rend `1` — la numérotation redémarre bien par workspace ; une
valeur explicite (`42`) est conservée telle quelle. Écrire `position: null` équivaut à l'omettre :
un trigger `BEFORE INSERT` reçoit `new.position` à `NULL` dans les deux cas et ne peut pas les
distinguer. Propriété héritée de `CRM-020` et vérifiée à nouveau ici plutôt que supposée.

La contrainte `NOT NULL` protège en revanche les **mises à jour**, que le trigger ne couvre pas.

### 2.5 Probabilité et seuil de relance

`default_probability` est un pourcentage, exprimé de `0` à `100`. Il est **nullable** : un nœud
peut ne pas se prononcer, ce qui est différent de se prononcer à `0` — `perdu` vaut réellement
`0 %`, alors qu'un nœud d'un catalogue métier peut n'avoir aucune signification prévisionnelle.

`default_stale_after_days` est le nombre de jours au-delà duquel une card figée sur ce nœud est
signalée. Il est nullable, et **doit être nul pour un nœud terminal** : une affaire livrée ou
perdue n'est pas en retard. La contrainte livrée est `x > 0` — un seuil de zéro jour signalerait
toute card dès son arrivée, ce qui n'est jamais l'intention et masquerait l'absence de seuil sous
une valeur qui a l'air d'en être une.

**Mesuré, et contre-intuitif** : `numeric(5,2)` **arrondit avant** que la contrainte de valeur ne
soit évaluée. `99.999` est stocké `100.00` et **accepté**, `100.004` également ; `100.01` et
`-0.01` sont refusés. La contrainte `0 ≤ x ≤ 100` porte donc sur la valeur **arrondie**, jamais sur
celle que le client a envoyée. Le fait est nommé ici parce qu'un test qui insérerait `99.999` en
attendant `99.999` échouerait pour une raison qui n'a rien à voir avec la règle métier.

### 2.6 Archivage — et la garde qui n'est pas livrable aujourd'hui

Un nœud n'est **jamais supprimé** : `archived_at` le masque des sélecteurs, réversiblement.
Aucune suppression physique n'est exposée — ni politique `for delete`, ni privilège `DELETE`, de
sorte que le refus se manifeste dès le privilège. La suppression physique reste réservée aux purges
RGPD, qui passent par `service_role` (`docs/SCHEMA.md`, conventions générales).

L'intention complète est plus forte : **l'archivage doit être refusé tant qu'une card active se
trouve sur ce nœud**, l'administrateur devant d'abord déplacer ces cards. Ce refus évite de casser
l'historique et les statistiques.

**Cette garde n'est pas livrable par `CRM-030`.** Le chemin qui va d'un nœud à une card active
passe par `workflow_steps` (`CRM-031`) puis par `cards` (`CRM-040`). **Mesuré** :
`to_regclass('public.workflow_steps')`, `to_regclass('public.workflows')` et
`to_regclass('public.cards')` rendent tous les trois `NULL`.

Et l'écrire quand même serait pire que l'omettre. **Mesuré** : PostgreSQL **accepte la création**
d'une fonction PL/pgSQL référençant une table absente — le corps n'est pas analysé à la création —
et l'échec ne survient qu'au **premier appel**, en `relation "public.cards" does not exist`. Un
trigger d'archivage écrit aujourd'hui ne protégerait donc rien : il ferait échouer **toute** mise à
jour du catalogue, y compris un simple renommage, dès la livraison. C'est le même motif qu'INC-013
un cran plus loin.

Le comportement retenu est donc celui des unités précédentes face à la même situation : livrer ce
qui est démontrable, **nommer** ce qui ne l'est pas, et **figer l'écart par des assertions** qui
deviendront rouges le jour où les tables apparaîtront. Contradiction consignée en
`docs/INCONSISTENCY_REPORT.md`, **INC-031**.

### 2.7 Autorisations

`docs/SPEC-permissions-rls.md` §4 range `workflow_nodes_catalog` avec les tables d'organisation :
**lecture par les membres du workspace, écriture réservée à l'`admin`**. Un
`business_developer` travaille dans la structure, il ne la définit pas.

Trois politiques, aucune de suppression :

| Politique | Commande | Prédicat |
|---|---|---|
| lecture | `select` (`anon`, `authenticated`) | `app.is_workspace_member(workspace_id)` |
| insertion | `insert` (`authenticated`) | `with check (app.is_workspace_admin(workspace_id))` |
| mise à jour | `update` (`authenticated`) | `using` **et** `with check` `app.is_workspace_admin(workspace_id)` |

Le `WITH CHECK` de la mise à jour n'est pas une redondance : sans lui, un administrateur du
workspace A pourrait déplacer un nœud vers le workspace B, où il n'a aucun droit. **Mesuré** :
refusé en `403`, code `42501`.

`select` est accordé à `anon` **et** à `authenticated`. Sans jeton, `auth.uid()` est nul, le
prédicat rend faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de
privilège — c'est ce que `docs/SPEC-permissions-rls.md` §7 exige d'une lecture refusée.

**Les droits fins ne s'appliquent pas, et n'ont pas à s'appliquer ici** : `track_members` et
`channel_members` portent sur un sous-arbre d'organisation, et le catalogue n'appartient à aucun
track ni à aucun channel. La politique s'arrête donc au rôle de workspace **par conception**, et
non par différé — à la différence de `tracks` (INC-024) et de `channels` (INC-030), où
`app.can_read_track` et `app.can_read_channel` restent dus.

### 2.8 Contrat d'API, mesuré

Toutes les lignes ci-dessous ont été **observées** sur la pile réelle, avec les jetons des comptes
seedés obtenus par `POST /auth/v1/token?grant_type=password`.

| # | Appel | Profil | Attendu, mesuré |
|---|---|---|---|
| a | `GET` du catalogue | `admin` | `200`, les nœuds du workspace, ordonnés par `position` |
| b | `GET` du catalogue | `viewer` | `200`, les mêmes nœuds — la lecture est ouverte à tout membre |
| c | `GET` du catalogue | anonyme | `200` et `[]` — preuve de refus n° 11 |
| d | `POST` d'un nœud | `admin` | `201`, `position` attribuée automatiquement |
| e | `POST` d'un nœud | `business_developer` | `403`, code `42501`, RLS |
| f | `POST` d'un nœud | `viewer` | `403`, code `42501`, RLS |
| g | `PATCH` `archived_at` | `admin` | `200`, nœud archivé |
| h | `PATCH` `archived_at` | `business_developer` | **`200` et `[]`** — voir ci-dessous |
| i | `DELETE` | `admin` | `403`, `permission denied for table` — le privilège manque |
| j | `PATCH` `workspace_id` vers un autre workspace | `admin` | `403`, `42501` — le `WITH CHECK` |
| k | `POST` dans un workspace dont on n'est pas membre | `admin` | `403`, `42501` |
| l | `GET` filtré sur un autre workspace | `admin` | `200` et `[]` — preuve de refus n° 3 |
| m | `POST` sans `position` | `admin` | `201`, `position` = dernière + 1 |

**La ligne h est la plus importante à énoncer explicitement.** Une mise à jour refusée par la
clause `USING` d'une politique ne produit **aucune erreur** : PostgREST rend `200` et un tableau
vide, parce qu'aucune ligne n'a été **vue** comme modifiable. Un test qui se contenterait de
constater l'absence d'erreur conclurait donc que l'écriture a réussi. Toute preuve de refus de mise
à jour doit relire la ligne et vérifier qu'elle est **inchangée** — sans quoi elle ne prouve rien.

*Précision acquise en écrivant les preuves, et non à la sonde.* Ce comportement **n'est pas une
particularité de PostgREST** : c'est celui du moteur. Une clause `USING` ne *refuse* pas une ligne,
elle la rend **invisible** ; l'ordre `UPDATE` ne trouve alors rien à modifier et réussit sur zéro
ligne. L'assertion pgTAP correspondante, d'abord écrite en `throws_ok('42501')` par symétrie avec
l'insertion, a **échoué** en rendant « caught: no exception » — et c'est cet échec qui a établi le
fait (`docs/JOURNAL.md`, décision 70). La différence avec la ligne j est nette : là, l'appelant
**voit** la ligne, et c'est le `WITH CHECK` qui refuse celle d'arrivée — le refus est alors bien
une erreur `42501`. Les deux formes coexistent sur la même politique.

Constat associé, déjà consigné : le refus de la ligne i **divulgue la commande `GRANT` à exécuter**
dans son `hint`. Comportement de la version épinglée de PostgREST, portée transverse, INC-026.

### 2.9 Catalogue initial livré par le seed

| Clé | Libellé | Type | Couleur | Probabilité | Seuil de relance |
|---|---|---|---|---|---|
| `prospection` | Prospection | `open` | `neutral` | 10 % | 14 j |
| `relance` | Relance | `open` | `accent` | 20 % | 7 j |
| `negociation` | Négociation | `open` | `brand` | 50 % | 10 j |
| `signature` | Signature | `open` | `brand` | 90 % | 7 j |
| `realisation` | Réalisation | `open` | `success` | 100 % | 30 j |
| `livre` | Livré | `won` | `success` | 100 % | — |
| `perdu` | Perdu | `lost` | `danger` | 0 % | — |

Le type `won` / `lost` est ce qui rend l'analytique de conversion possible sans convention
implicite sur les libellés.

Les couleurs ne figuraient pas dans l'énoncé d'origine, qui exigeait pourtant une colonne `color`.
Elles sont fixées ici : les deux nœuds terminaux prennent `success` et `danger`, dont c'est
exactement le sens dans `docs/DESIGN_SYSTEM.md` §1 ; `prospection` reste `neutral`, un début
d'affaire ne portant aucun jugement. **Aucun nœud du seed n'emploie les cinq jetons à lui seul** :
`accent` n'est employé que par `relance`, de sorte que chacun des cinq soit exercé au moins une
fois par l'ensemble catalogue + tracks.

Le seed livre en outre **un nœud archivé**, hors des sept ci-dessus, sans quoi l'état archivé ne
serait jamais représenté dans les données de démonstration — même raison qu'un track archivé pour
`CRM-020` et un channel archivé pour `CRM-021`.

### 2.10 Preuves attendues de `CRM-030`

| Niveau | Preuves |
|---|---|
| pgTAP | Structure, contraintes de valeur, unicité par workspace, ordre attribué et ordre fourni, archivage réversible, politiques, privilèges, autorisations éprouvées contre des comptes réels ; **absence des tables dont dépend la garde d'archivage**, figée pour devenir rouge à `CRM-031` / `CRM-040` |
| API | Les treize lignes du §2.8, hors interface, avec les jetons réels des trois profils ; preuves de refus n° 3 et n° 11 au niveau du catalogue |
| Seed | Les sept nœuds du §2.9 plus un nœud archivé, créés par la véritable API REST, convergents |
| Interface | **Aucune** — le catalogue n'a pas d'écran, et n'en aura pas avant l'éditeur de `CRM-031`. Voir INC-021 |

## 3. Workflow, étapes, transitions — `CRM-031`

Un workflow est une **sélection de nœuds** (`workflow_steps`) et un **ensemble d'arêtes**
(`workflow_transitions`). Le catalogue du §2 dit quels états ont un nom ; le workflow dit dans
quel ordre une card les traverse et quels déplacements sont permis.

Ce chapitre a été **écrit après mesure**, et non de mémoire : trois tables sondes jetables
portant la structure envisagée ont été créées sur la pile réelle, éprouvées, puis détruites —
l'absence de reste étant constatée (`to_regclass` nul sur les trois, aucune fonction `sonde*`).
Les affirmations chiffrées et les codes d'erreur des §3.2 à §3.6 sont ces mesures.

### 3.1 Ce qu'un workflow est, et ce qu'il n'est pas

Un workflow est un **graphe orienté**, pas une liste ordonnée. La `position` d'une étape sert
l'affichage du board — l'ordre des colonnes — et **ne définit aucun déplacement autorisé** :
seule une transition déclarée autorise un mouvement. Deux étapes voisines à l'écran peuvent être
inatteignables l'une depuis l'autre, et deux étapes éloignées peuvent être reliées.

Un workflow n'est pas non plus un vocabulaire : il **instancie** des nœuds du catalogue. La clé
et le type restent ceux du nœud ; l'étape ne peut en surcharger que le libellé, la probabilité et
le seuil de relance (§3.3). C'est cette invariance qui rend comparable le temps passé en
« Relance » d'un channel à l'autre.

### 3.2 Modèle — `workflows`

Référence de schéma : `docs/SCHEMA.md` §3, complété des `created_at` / `updated_at` que les
conventions générales du même document exigent de toute table métier et que le §3 omettait —
quatrième occurrence du même oubli (INC-025).

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `workspace_id` | `uuid` | non nul, FK `workspaces` `on delete cascade` |
| `name` | `text` | non nul, non vide après `btrim` |
| `scope` | `text` | `global` ou `track`, défaut `global` |
| `track_id` | `uuid` | nul si `global`, non nul si `track` ; FK **composite** vers `tracks (id, workspace_id)` |
| `derived_from_workflow_id` | `uuid` | FK `workflows (id)` `on delete set null` |
| `derived_at` | `timestamptz` | date de la copie |
| `source_composition_fingerprint` | `text` | SHA-256 canonique de la source à la copie ; nul hors dérivation ou pour une copie historique à vérifier |
| `is_default` | `boolean` | non nul, défaut faux ; **au plus un vrai par workspace** |
| `archived_at` | `timestamptz` | suppression douce |
| `created_at`, `updated_at` | `timestamptz` | conventions générales ; `updated_at` par trigger |

Trois points méritent d'être écrits parce qu'ils ne se déduisent pas du tableau.

**La cohérence de portée est une contrainte, pas une convention.** `scope = 'global'` exige
`track_id` nul, `scope = 'track'` l'exige renseigné. Sans cette contrainte, un workflow `global`
portant un `track_id` résiduel serait un objet dont personne ne saurait dire s'il est disponible
pour tout le workspace ou pour un seul track.

**Le track d'un workflow appartient au même workspace, et c'est la base qui le garantit.** La clé
étrangère est **composite** — `(track_id, workspace_id)` vers `tracks (id, workspace_id)` —, non
pas simple vers `tracks (id)`. Une clé simple laisserait un administrateur du workspace A rattacher
son workflow à un track de B, ce qu'aucune politique RLS ne rattraperait : la politique décide qui
écrit la ligne, pas ce que la ligne raconte. L'unicité `tracks (id, workspace_id)` nécessaire à
cette clé **existe déjà**, posée par `CRM-021` pour la même raison (`docs/SPEC-channels.md` §2.4).

**Le lignage est une trace, pas un lien de dépendance.** La copie est une
divergence assumée (§4) : le workflow copié vit sa vie. La clé étrangère est donc `on delete set
null` et non `cascade` — supprimer l'original ne doit pas emporter ses copies. Mesuré : la copie
survit à la suppression de son origine, `derived_from_workflow_id` repassant à nul. Tant que
l'origine existe, `source_composition_fingerprint` conserve l'empreinte de sa composition au
moment exact de la copie ; elle voit ainsi les suppressions que `updated_at` ne pouvait pas voir
(décision 293).

**`is_default` : au plus un vrai par workspace.** Posé par un index unique partiel
`(workspace_id) where is_default`. Mesuré : la seconde ligne marquée par défaut dans le même
workspace est refusée en `23505`. « Au plus un » et non « exactement un » : un workspace neuf n'a
aucun workflow, et exiger un défaut rendrait sa création impossible.

### 3.3 Modèle — `workflow_steps`

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK |
| `workflow_id` | `uuid` | non nul, FK **composite** vers `workflows (id, workspace_id)` `on delete cascade` |
| `workspace_id` | `uuid` | non nul, dénormalisé pour la RLS, **véracité garantie** par la clé composite ci-dessus |
| `node_id` | `uuid` | non nul, FK **composite** vers `workflow_nodes_catalog (id, workspace_id)` `on delete restrict` |
| `position` | `numeric` | non nulle, attribuée par trigger dans la portée du **workflow** si omise |
| `label_override` | `text` | facultatif, non vide après `btrim` s'il est fourni |
| `probability_override` | `numeric(5,2)` | facultatif, de 0 à 100 |
| `stale_after_days` | `integer` | facultatif, strictement positif |
| `is_initial` | `boolean` | non nul, défaut faux |
| `created_at`, `updated_at` | `timestamptz` | conventions générales |

Unique : `(workflow_id, node_id)` — un nœud n'apparaît qu'une fois par workflow, comme
`docs/SCHEMA.md` §3 l'exige. Unique également : `(id, workflow_id)`, sans quoi les transitions du
§3.4 ne peuvent pas porter de clé étrangère composite. Mesuré : sans cette unicité, la création de
la clé échoue en `42830`, « there is no unique constraint matching given keys for referenced
table ».

**Le nœud d'une étape appartient au même workspace que le workflow**, garanti par la clé composite
`(node_id, workspace_id)`. `on delete restrict` et non `cascade` : le catalogue n'expose aucune
suppression (§2.6), mais si une purge en venait à en supprimer un, l'effacement silencieux des
étapes qui l'instancient détruirait des workflows entiers sans le dire.

**Les surcharges sont facultatives et ne portent que sur trois colonnes.** Ni la clé ni le type ne
sont surchargeables : ils ne sont pas copiés dans l'étape, ils restent lus depuis le nœud. Une
surcharge absente vaut « prendre la valeur du catalogue » ; elle ne vaut pas zéro. C'est la même
distinction qu'au §2.5, et elle a la même conséquence : `probability_override` et
`stale_after_days` sont **nullables**, et `0` n'est pas `NULL`.

### 3.4 Modèle — `workflow_transitions`

| Colonne | Type | Contrainte |
|---|---|---|
| `id` | `uuid` | PK |
| `workflow_id` | `uuid` | non nul, FK composite vers `workflows (id, workspace_id)` `on delete cascade` |
| `workspace_id` | `uuid` | non nul, dénormalisé pour la RLS |
| `from_step_id` | `uuid` | non nul, FK **composite** `(from_step_id, workflow_id)` vers `workflow_steps (id, workflow_id)` `on delete cascade` |
| `to_step_id` | `uuid` | non nul, même clé composite, et **différent** de `from_step_id` |
| `label` | `text` | facultatif, libellé du bouton d'action |
| `require_comment` | `boolean` | non nul, défaut faux |
| `created_at`, `updated_at` | `timestamptz` | conventions générales |

Unique : `(workflow_id, from_step_id, to_step_id)` — une arête n'est déclarée qu'une fois.

**Une transition ne peut pas sortir de son workflow, et c'est structurel.** Les deux clés
étrangères portent `(step_id, workflow_id)` et non `step_id` seul. Mesuré : une arête dont
l'étape cible appartient à un autre workflow est refusée en `23503`, avec le détail
`Key (to_step_id, workflow_id)=(…) is not present in table "workflow_steps"`. Un trigger aurait
rendu le même service, plus tard et moins sûrement.

**Les cycles sont autorisés, et rien ne les empêche.** Mesuré : `A → B` et `B → A` coexistent sans
erreur. C'est voulu — Négociation ⇄ Relance est un aller-retour légitime. Aucune détection de
cycle n'est faite, ni ici ni ailleurs : un workflow n'est pas un graphe acyclique.

**Supprimer une étape emporte ses arêtes.** Mesuré : la suppression d'une étape reliée par deux
transitions laisse zéro transition. C'est la conséquence du `on delete cascade` des clés
composites, et c'est le comportement voulu : une arête vers une étape disparue n'est pas une
donnée à conserver, c'est une arête cassée.

**Les champs exigés ne vivent plus dans la transition.** `CRM-018` remplace l'ancien
`require_fields uuid[]`, impossible à contraindre, par
`workflow_transition_required_fields (transition_id, field_id)`. Les deux parents existent par
clé étrangère avec suppression en cascade ; un trigger refuse tout croisement de workflows. Le
contrat complet, sa migration et ses autorisations sont dans
`docs/SPEC-transition-required-fields.md`. INC-033 est ainsi corrigée par le modèle plutôt que par
un nettoyage applicatif.

### 3.5 « Exactement une étape initiale » : ce que la base peut garantir, et ce qu'elle ne peut pas

`docs/SCHEMA.md` §3 et le §1 de ce document exigent **exactement une** étape initiale par
workflow. La mesure a montré que cette exigence se scinde en deux moitiés très inégales.

**Au plus une : garanti par la base.** Un index unique partiel `(workflow_id) where is_initial`
refuse la seconde étape initiale en `23505`. Cette moitié est acquise, sans trigger ni fonction.

**Au moins une : impossible à imposer à l'écriture, mesuré.** Un workflow naît **avant** ses
étapes : la seule façon d'exiger qu'il en ait une serait un `constraint trigger … deferrable
initially deferred`, qui reporte le contrôle à la validation de la transaction. Éprouvé sur la
sonde : une insertion isolée de workflow — exactement ce que fait PostgREST, une requête valant
une transaction — est acceptée, puis **le `commit` échoue** en `workflow_sans_etape_initiale`. La
garde ne protégerait donc rien : elle rendrait la création d'un workflow **impossible par l'API**,
et l'éditeur d'administration du produit n'aurait aucun moyen de créer le premier objet qu'il est
censé éditer.

**Décision.** La base garantit « au plus une ». « Au moins une » est une condition **d'emploi**, pas
d'existence : un workflow sans étape initiale est un brouillon, structurellement valide et
inutilisable. Elle est vérifiée là où elle a un sens :

- au rattachement d'un channel à un workflow (`CRM-033`) ;
- à la création d'une card, qui doit savoir où la poser (`CRM-040`) ;
- par le seed, dont le workflow par défaut en porte une.

Le fait qu'un workflow puisse être un brouillon est **écrit ici plutôt que découvert plus tard** :
`docs/JOURNAL.md`, décision 72.

### 3.6 Ordre des étapes

`position` est un `numeric`, comme `tracks.position`, `channels.position` et la `position` du
catalogue : un index fractionnaire, de sorte qu'insérer une colonne entre deux autres n'exige pas
de renuméroter le board entier.

Elle est attribuée par un trigger `BEFORE INSERT` lorsqu'elle est omise, **dans la portée du
workflow** — et non du workspace comme pour le catalogue (§2.4), ni du track comme pour les
channels : l'ordre qu'elle sert est celui des colonnes d'un board, qui appartient à un workflow.
Mesuré : trois insertions sans `position` dans un workflow rendent `1`, `2`, `3` ; une insertion
dans un **autre** workflow rend `1`.

Propriété héritée de `CRM-020` et vérifiée à nouveau plutôt que supposée : un trigger
`BEFORE INSERT` ne distingue pas une colonne **omise** d'une colonne écrite explicitement à `NULL`.
Écrire `position: null` équivaut donc à omettre.

### 3.7 Autorisations

`docs/SPEC-permissions-rls.md` §4 range les trois tables ensemble : **lecture par les membres du
workspace, écriture par les administrateurs**. Aucun droit fin ne les gouverne — un workflow n'est
ni un track ni un channel, et `track_members` / `channel_members` portent sur un sous-arbre
d'organisation. La règle s'arrête au rôle de workspace **par conception**, non par différé.

La lecture est accordée à `anon` **et** `authenticated` : sans jeton, `auth.uid()` est nul, le
prédicat rend faux, et le refus se manifeste par **zéro ligne** plutôt que par une erreur de
privilège.

**La suppression est exposée pour les étapes et les transitions, et refusée pour les workflows.**
C'est le seul endroit du produit livré où une suppression physique est ouverte à un client, et cela
demande une justification, pas une exception silencieuse :

- un workflow est un objet de premier plan, il porte `archived_at`, et l'archivage tient lieu de
  suppression — même règle que les tracks, les channels et le catalogue ;
- une étape et une transition sont la **composition** d'un workflow, pas des objets à durée de vie
  propre. `docs/SCHEMA.md` §3 ne leur donne d'ailleurs aucun `archived_at`. Un éditeur qui ne peut
  pas retirer une arête ne peut pas éditer : la seule alternative serait d'inventer une colonne que
  la référence de schéma ne prévoit pas.

Le jour où des cards occuperont des étapes (`CRM-040`), la clé étrangère
`cards.current_step_id → workflow_steps (id)` devra être `on delete restrict` : la suppression
d'une étape occupée doit alors être refusée par la base. Le fait est écrit ici pour que `CRM-040`
le trouve écrit.

### 3.8 Contrat d'API attendu

Les lignes ci-dessous sont ce que `CRM-031` doit **mesurer** et non supposer ; elles sont écrites
avant le code, et les scénarios de `e2e/api/workflows.spec.ts` les rejouent une à une.

| # | Appel | Profil | Attendu |
|---|---|---|---|
| a | `GET /workflows` | membre du workspace | `200`, les workflows de son workspace uniquement |
| b | `GET /workflows` | anonyme | `200` et `[]`, alors que la table n'est pas vide |
| c | `GET /workflows` | membre d'un autre workspace | `200` et `[]` |
| d | `POST /workflows` | `admin` | `201` |
| e | `POST /workflows` | `business_developer` | `403`, code `42501`, et la ligne n'existe **nulle part** |
| f | `POST /workflows` | `viewer` | `403`, code `42501` |
| g | `PATCH /workflows` | `business_developer` | `200` et `[]` — le `USING` rend la ligne invisible, il ne lève pas d'erreur ; la ligne est **relue inchangée** |
| h | `PATCH /workflows` vers un autre workspace | `admin` | `403`, code `42501` — c'est le `WITH CHECK` |
| i | `POST /workflow_steps` avec `position` omise | `admin` | `201`, `position` attribuée en fin de workflow |
| j | `POST /workflow_steps` d'un nœud déjà présent | `admin` | `409`, code `23505` |
| k | `POST /workflow_steps` avec une seconde étape initiale | `admin` | `409`, code `23505` |
| l | `POST /workflow_transitions` vers une étape d'un autre workflow | `admin` | `409`, code `23503` |
| m | `POST /workflow_transitions` avec `from = to` | `admin` | `400`, contrainte de valeur |
| n | `DELETE /workflow_transitions` | `admin` | `204` |
| o | `DELETE /workflow_transitions` | `business_developer` | `403` ou zéro ligne supprimée, l'arête étant **relue présente** |
| p | `DELETE /workflows` | `admin` | `403` — aucune politique, aucun privilège |

### 3.9 Workflow par défaut livré par le seed

```
Prospection ──▶ Relance ◀──▶ Négociation ──▶ Signature ──▶ Réalisation ──▶ Livré
     │             │              │              │
     └─────────────┴──────────────┴──────────────┴────────────────────────▶ Perdu
```

Un seul workflow, `global`, par défaut du workspace : **Cycle commercial standard**. Sept étapes,
une par nœud actif du catalogue (§2.9), le nœud archivé `qualification` restant hors du workflow —
un vocabulaire retiré ne s'instancie pas.

| Étape | Nœud | `position` | Initiale | Surcharge |
|---|---|---|---|---|
| Prospection | `prospection` | 1 | **oui** | — |
| Relance | `relance` | 2 | non | — |
| Négociation | `negociation` | 3 | non | `stale_after_days` = 5 |
| Signature | `signature` | 4 | non | — |
| Réalisation | `realisation` | 5 | non | `label_override` = « Réalisation en cours » |
| Livré | `livre` | 6 | non | — |
| Perdu | `perdu` | 7 | non | — |

Les deux surcharges ne sont pas décoratives : sans elles, la faculté de surcharger serait
documentée sans être démontrable dans les données de démonstration, ce que `CLAUDE.md` §8 refuse.
Elles portent sur deux colonnes différentes, de sorte que le rendu — libellé d'une part, seuil de
relance d'autre part — soit exercé des deux façons.

Dix transitions, exactement celles du graphe :

| De | Vers | Libellé | Commentaire exigé |
|---|---|---|---|
| Prospection | Relance | Relancer | non |
| Relance | Négociation | Engager la négociation | non |
| Négociation | Signature | Passer en signature | non |
| Signature | Réalisation | Démarrer la réalisation | non |
| Réalisation | Livré | Marquer comme livré | non |
| Négociation | Relance | Revenir en relance | non |
| Prospection | Perdu | Marquer perdu | **oui** |
| Relance | Perdu | Marquer perdu | **oui** |
| Négociation | Perdu | Marquer perdu | **oui** |
| Signature | Perdu | Marquer perdu | **oui** |
| Réalisation | Perdu | Marquer perdu | **oui** |

**`Réalisation → Perdu` EST déclaré depuis la décision 259** (INC-003, close). Il ne l'était pas,
et l'énoncé qui le justifiait — « une affaire signée qui échoue relève d'un autre traitement » —
était une **reconstruction de l'agent**, non une règle du responsable : interrogé, celui-ci a
répondu qu'il avait listé des **exemples** et attendait des propositions. Une affaire signée puis
abandonnée en cours de réalisation n'avait donc aucun chemin vers « Perdu ».

**Le graphe est relu en entier, et la règle tenue est explicite** : toute étape possède au moins une
sortie, ou son absence de sortie est justifiée. Deux étapes n'en ont pas, et les deux le sont —
`Livré` porte l'issue `won`, `Perdu` l'issue `lost`. Ce sont les deux fins du cycle : une transition
sortante y contredirait la notion même d'issue, et le §3.6 la refuserait.

**Les cinq transitions vers `Perdu` exigent un commentaire.** Ce choix n'était pas écrit dans
l'énoncé d'origine : il est pris ici, et il est justifiable — une affaire perdue sans motif n'est
exploitable par aucune analyse, et c'est la seule transition du graphe dont la raison ne se déduit
pas de l'étape d'arrivée. Il fait de surcroît de `require_comment` une colonne **démontrable** dans
le seed. Le responsable peut le renverser ; le §9 le porte comme point ouvert n° 4.

À la livraison de `CRM-031`, `require_fields` reste vide partout : `form_fields` n'existe pas
encore (`CRM-035`), et le seed ne fabrique pas une donnée que le modèle ne sait pas encore produire
— même règle que `workflow_id` laissé nul sur les channels jusqu'à cette unité. `CRM-018` supprime
ensuite cette colonne et porte l'exigence effective dans sa table de liaison.

**Les six channels du seed reçoivent ce workflow.** `docs/SCHEMA.md` §2 exige `channels.workflow_id`
non nulle et référencée ; `CRM-021` a dû livrer la colonne nue, `workflows` n'existant pas
(INC-029). Cette unité pose la **clé étrangère composite** `(workflow_id, workspace_id)` — le
workflow d'un channel appartient donc au même workspace, garanti par la base — et renseigne les six
channels du seed. La contrainte `NOT NULL` **reste due**, et par `CRM-033` : elle change le contrat
de création d'un channel, qui devient impossible sans workflow, et c'est précisément l'unité de la
cohérence workflow ↔ channel qui doit la porter avec son trigger. INC-029 est mise à jour en
conséquence, elle n'est pas close.

### 3.10 Preuves attendues de `CRM-031`

| Niveau | Preuves |
|---|---|
| pgTAP | Structure des trois tables ; unicité `(workflow_id, node_id)` ; au plus une étape initiale ; transition hors workflow refusée ; `from = to` refusé ; cohérence de portée `scope` / `track_id` ; au plus un workflow par défaut ; ordre attribué dans la portée du workflow ; politiques et privilèges ; autorisations éprouvées contre des comptes réels ; **absence de `cards`**, figée pour devenir rouge à `CRM-040` |
| API | Les seize lignes du §3.8, hors interface, avec les jetons réels des trois profils ; preuves de refus n° 2, n° 3 et n° 11 au niveau des workflows |
| Seed | Le workflow du §3.9, ses sept étapes et ses dix transitions, créés par la véritable API REST, convergents ; les six channels rattachés |
| Interface | **Aucune** — l'éditeur de workflow exige un écran d'administration authentifié, et la webapp reste un appelant anonyme (INC-021). L'écart est nommé dans la Definition of Done, il n'est pas masqué |

## 4. Portée, copie vers un track et divergence — `CRM-032`

| Portée | `track_id` | Disponible pour |
|---|---|---|
| `global` | nul | tous les channels du workspace |
| `track` | renseigné | uniquement les channels de ce track |

Ce chapitre a été **écrit après mesure**, et non de mémoire : l'algorithme de copie a été appliqué
à la main sur la pile réelle, dans une transaction annulée ; les codes HTTP ont été relevés contre
PostgREST avec le jeton réel de l'administrateur seedé, au moyen de fonctions sondes créées puis
détruites, l'absence de reste étant constatée (`pg_proc` vide de toute fonction `sonde*`,
`to_regclass` nul sur la vue sonde). Les affirmations chiffrées et les codes des §4.3 à §4.8 sont
ces mesures.

### 4.1 Ce que la copie est, et ce qu'elle n'est pas

**La copie est une divergence assumée**, conforme au geste demandé : une modification ultérieure du
workflow global ne se propage pas. L'interface signale la situation — « ce workflow dérive de *X*,
modifié depuis le *jj/mm/aaaa* » — et propose de comparer, sans jamais réappliquer automatiquement.

Elle n'est donc **pas** une instanciation, pas un héritage, pas un lien vivant. `CRM-031` a posé la
clé étrangère `derived_from_workflow_id` en `on delete set null` précisément pour cela : supprimer
l'original ne doit pas emporter ses copies (§3.2). La copie est un objet neuf qui se souvient d'où
il vient.

*Écart relevé et assumé* : la convention générale privilégie la surcharge à la duplication
(`CLAUDE.md` §4). Le responsable a explicitement demandé une copie modifiable. La traçabilité
d'origine est la contrepartie retenue ; l'écart est consigné dans `docs/JOURNAL.md`.

### 4.2 Signature

```
copy_workflow_to_track(workflow_id uuid, track_id uuid, new_name text default null) returns uuid
```

Elle rend l'identifiant du workflow créé. `new_name` est facultatif : à défaut, la copie reprend le
nom de sa source. Aucune unicité ne porte sur `workflows.name` — deux workflows homonymes sont
structurellement valides —, de sorte que le renommage est une **commodité de l'appelant** et non
une condition de succès. Le nom fourni subit la même contrainte que tout autre : non vide après
`btrim`.

La fonction est `SECURITY DEFINER`, `search_path` fixé à la chaîne vide, et son privilège
d'exécution n'est accordé qu'à `authenticated` et `service_role` (§4.7). `SECURITY DEFINER` n'est
pas ici une facilité : les politiques RLS ne s'appliquent pas au propriétaire des tables, donc
**c'est la fonction elle-même qui porte la règle d'accès**, par un contrôle explicite (§4.3) — et
non les politiques, qu'elle contourne par construction.

### 4.3 Vérifications, dans l'ordre, et ce que chacune rend

Chacune lève une exception nommée. Les codes HTTP de la dernière colonne sont **mesurés** contre
PostgREST `v14.12`, non déduits (§4.4).

| # | Vérification | Message | `SQLSTATE` | HTTP |
|---|---|---|---|---|
| 1 | Le workflow existe, est **visible de l'appelant** et n'est pas archivé | `workflow_not_found` | `P0001` | `400` |
| 2 | L'appelant est **administrateur** du workspace du workflow | `forbidden` | `42501` | `403` |
| 3 | Le workflow est de portée `global` | `workflow_not_global` | `P0001` | `400` |
| 4 | Le track existe, appartient au **même workspace** et n'est pas archivé | `track_not_found` | `P0001` | `400` |

**L'ordre des deux premières vérifications est une règle de discrétion, pas un détail
d'implémentation.** « Visible » signifie `app.is_workspace_member` : un workflow d'un **autre**
workspace rend `workflow_not_found`, jamais `forbidden`. Répondre « interdit » révélerait qu'il
existe, à quelqu'un qui n'a pas le droit de le savoir. Un membre non administrateur de **son
propre** workspace obtient en revanche `forbidden` : il sait déjà que le workflow existe, il le lit
tous les jours.

**Le contrôle 3 refuse la copie d'un workflow déjà rattaché à un track.** Le §4 d'origine ne parlait
que de la copie d'un workflow *global*, et cette lecture est retenue : une chaîne de dérivations
— une copie d'une copie d'une copie — rendrait `derived_from_workflow_id` illisible sans parcourir
tout l'arbre, et le signalement de divergence du §4.6 devrait alors dire lequel des ancêtres a
changé. Le besoin n'est pas énoncé ; l'interdire est réversible, l'autoriser ne l'est pas.

### 4.4 Ce que PostgREST fait des `SQLSTATE`, mesuré

Mesuré en appelant une fonction sonde qui ne fait que lever l'exception demandée, avec le jeton réel
de l'administrateur seedé :

| `SQLSTATE` levé | HTTP rendu |
|---|---|
| `P0001` (`raise exception` sans `errcode`) | `400` |
| `P0002` (`no_data_found`) | **`500`** |
| `42501` (`insufficient_privilege`) | `403` |
| `23505` (`unique_violation`) | `409` |

**`P0002` est inutilisable** : le code le plus naturel pour dire « rien ne correspond » est rendu
comme une **erreur serveur**, ce qui ferait passer une donnée mal désignée par le client pour une
panne du produit. Les quatre refus du §4.3 emploient donc `P0001` et `42501`, et rien d'autre.

Un `404` **serait** atteignable : PostgREST accepte un `SQLSTATE` conventionnel `PGRST` dont le
`DETAIL` porte le statut voulu, et la mesure le confirme — `404` rendu, corps JSON conservé. Il est
**écarté** : il coudrait la base à un serveur d'API particulier, et une fonction SQL qui connaît les
codes HTTP de son client cesse d'être portable. La décision est consignée (`docs/JOURNAL.md`,
décision 81) plutôt que laissée au hasard d'une écriture.

**L'appelant anonyme est refusé par le privilège, et rend `401`** — non `403`, mesuré : PostgREST
traite l'absence de droit d'un appelant non authentifié comme une invitation à s'authentifier. Le
refus est donc double, privilège puis contrôle explicite, et le premier suffit.

### 4.5 Ce que la copie copie, et comment les arêtes sont remappées

| Objet | Copié | Remarque |
|---|---|---|
| `workflows` | nom (ou `new_name`), `workspace_id` | `scope` forcé à `track`, `track_id` renseigné |
| | `derived_from_workflow_id`, `derived_at`, `source_composition_fingerprint` | la traçabilité et l'empreinte d'origine, renseignées par la fonction |
| | `is_default` | **forcé à faux**, jamais copié |
| | `archived_at` | jamais copié : une copie naît active |
| `workflow_steps` | `node_id`, `position`, les trois surcharges, `is_initial` | à l'identique |
| `workflow_transitions` | `label`, `require_comment` | extrémités remappées (ci-dessous) |
| `form_fields` | clé, libellé, type, options, aide, position, archivage | nouveaux identifiants, même contrat métier |
| `form_field_rules` | visibilité | champ et étape remappés |
| champs exigés par une transition | oui | transition et champ remappés |

**`is_default` forcé à faux n'est pas une précaution, c'est une nécessité mesurée.** Copier la
colonne telle quelle depuis un workflow par défaut est refusé en `23505` par
`workflows_workspace_default_uk` : au plus un défaut par workspace (§3.2). Or le workflow que l'on
copie est, en pratique, le workflow par défaut. Sans ce forçage, la fonctionnalité échouerait sur
son cas d'emploi principal.

**Chaque référence est remappée par une clé naturelle unique.** Une étape se retrouve par son
`node_id`, un champ par sa `key`, et une transition par le couple de nœuds source/cible. La fonction
ne conserve aucun identifiant de composition de la source. La propriété se vérifie : zéro arête,
règle ou exigence de la copie ne pointe vers une ligne restée dans la source.

**Les positions fractionnaires sont conservées telles quelles.** Mesuré : une source portant
`1`, `2.5`, `3` donne une copie portant `1`, `2.5`, `3`. Le trigger d'attribution automatique
(§3.6) ne se déclenche pas, `position` étant fournie — et c'est ce qu'on lui demande : renuméroter
la copie changerait l'ordre du board sans que personne ne l'ait demandé.

### 4.6 Signalement de divergence : la vue `public.workflow_derivations`

Le §4.1 exige que l'interface puisse dire « dérive de *X*, modifié depuis le *jj/mm/aaaa* ». Cette
phrase n'est **pas** calculable à partir des seules colonnes de `workflows` : modifier une étape ou
une transition ne touche pas la ligne du workflow, donc son `updated_at` ne bouge pas. Le produit
doit donc exposer la date du dernier changement **du workflow et de sa composition**.

`public.workflow_derivations` est une vue en lecture seule, déclarée `security_invoker = true` —
mesuré : les politiques RLS des tables sous-jacentes s'appliquent bien à l'appelant, un rôle `anon`
n'y voyant aucune ligne là où le propriétaire en voit une.

| Colonne | Sens |
|---|---|
| `workflow_id`, `workspace_id`, `name`, `track_id` | la copie |
| `source_workflow_id`, `source_name`, `source_archived_at` | son origine |
| `derived_at` | la date de la copie |
| `source_modified_at` | le plus récent `updated_at` disponible de la source et de sa composition horodatée, catalogue de nœuds utilisé compris |
| `source_composition_fingerprint` | l'empreinte mémorisée à la copie |
| `current_source_composition_fingerprint` | l'empreinte recalculée de la source courante |
| `source_modified_since_copy` | vrai si les deux empreintes diffèrent |

**Le signal couvre les suppressions.** `app.workflow_composition_fingerprint` sérialise de façon
canonique les nœuds, étapes, transitions, champs, règles et exigences, triés par identifiants
source, puis calcule leur SHA-256 avec `extensions.digest`. Ajouter, modifier ou supprimer un de
ces objets change l'empreinte. `source_modified_at` reste une date d'aide à l'affichage : elle
inclut les nœuds référencés par les étapes, mais une suppression ou une liaison sans horodatage ne
peut pas lui transmettre sa date. Elle ne porte donc jamais le verdict de divergence ; seul
`source_modified_since_copy` le porte (INC-038, décisions 293 et 302).

Une copie antérieure à la migration 19 garde une empreinte `NULL` : la vue rend alors
`source_modified_since_copy = true`. L'état d'origine n'étant plus reconstructible, le déclarer à
jour serait une fausse preuve. Aucune copie utilisateur n'est réécrite automatiquement.

**La vue est fermée deux fois, et une seule fermeture est visible de l'API.** Aucun privilège
d'écriture n'est accordé (§4.7) ; et, mesuré, PostgreSQL refuse de toute façon la réécriture d'une
vue qui joint deux tables — `55000`, « Views that do not select from a single table or view are not
automatically updatable » —, **avant** tout contrôle de privilège. PostgREST ne sait pas traduire ce
code et rend `500`. Le privilège manquant est donc prouvé en base, par pgTAP, et non par l'API, qui
ne va jamais jusque-là.

**Deux modifications faites dans la même transaction que la copie ne divergent pas non plus**, et
pour une raison différente : `now()` est constant sur toute la durée d'une transaction — mesuré.
`derived_at` et l'`updated_at` d'une écriture concomitante valent alors exactement la même chose, et
`>` est faux. Ce n'est pas un défaut : au moment du `commit`, la copie est bien à jour.

### 4.7 Autorisations, privilèges, et un défaut d'origine de l'image

`docs/SPEC-permissions-rls.md` §4 réserve l'écriture des workflows aux administrateurs du
workspace. La copie est une écriture ; elle leur est donc réservée, et le contrôle 2 du §4.3
l'applique **dans la fonction**, la RLS ne protégeant pas contre son propriétaire.

**Mesuré, et contraire à l'attente : `revoke all … from public` ne suffit pas.** L'image de la base
livre des privilèges par défaut (`ALTER DEFAULT PRIVILEGES`) qui accordent, sur **tout** objet neuf
du schéma `public`, l'exécution des fonctions et **tous** les droits des tables et des vues à `anon`,
`authenticated` et `service_role`. Une fonction créée puis « protégée » par le seul
`revoke all … from public` reste donc exécutable par l'anonyme — vérifié : l'appel a réussi. Il faut
**révoquer nommément** `anon`. La même règle vaut pour la vue du §4.6, qui naîtrait autrement
`arwdDxtm` pour les trois rôles, donc modifiable.

C'est la première fois que le produit crée un objet dans `public` autrement qu'une table : les
migrations précédentes révoquaient déjà nommément sur leurs tables, et les fonctions du projet
vivent dans le schéma `app`, que l'API n'expose pas. Le fait est écrit ici pour que les unités
suivantes le trouvent écrit (`docs/JOURNAL.md`, décision 80).

### 4.8 Les champs sont copiés lorsque leur schéma existe

`CRM-032` ne pouvait matériellement copier `form_fields`, livrée deux unités plus tard ; cette
limite historique était mesurée et nommée par INC-037. `CRM-018`, exécutée après `CRM-035`, ferme
désormais la Definition of Done d'origine : elle redéfinit la même RPC avec le remappage complet
décrit au §4.5. Une base rejouée n'observe jamais une version intermédiaire comme état final.

### 4.9 Contrat d'API attendu

Les lignes ci-dessous sont ce que `CRM-032` doit **mesurer** et non supposer ; elles sont écrites
avant le code, et les scénarios de `e2e/api/copie-workflow.spec.ts` les rejouent une à une.

| # | Appel | Profil | Attendu |
|---|---|---|---|
| a | `POST /rpc/copy_workflow_to_track` | `admin` | `200`, l'identifiant de la copie ; la copie porte les mêmes étapes et les mêmes transitions |
| b | idem, avec `new_name` | `admin` | `200`, la copie porte le nom fourni |
| c | `POST /rpc/copy_workflow_to_track` | `business_developer` | `403`, message `forbidden`, et **aucune ligne créée** |
| d | `POST /rpc/copy_workflow_to_track` | `viewer` | `403`, message `forbidden` |
| e | `POST /rpc/copy_workflow_to_track` | anonyme | `401` — refus par le privilège, avant tout contrôle |
| f | workflow d'un **autre** workspace | `admin` | `400`, message `workflow_not_found` — jamais `forbidden` |
| g | workflow inexistant | `admin` | `400`, message `workflow_not_found` |
| h | workflow archivé | `admin` | `400`, message `workflow_not_found` |
| i | workflow déjà de portée `track` | `admin` | `400`, message `workflow_not_global` |
| j | track d'un **autre** workspace | `admin` | `400`, message `track_not_found` |
| k | track archivé | `admin` | `400`, message `track_not_found` |
| l | copie d'un workflow **par défaut** | `admin` | `200`, et la copie n'est **pas** par défaut |
| m | `GET /workflow_derivations` | membre du workspace | `200`, la ligne de la copie, `source_modified_since_copy` renseigné |
| n | `GET /workflow_derivations` | anonyme | `200` et `[]` (preuve de refus n° 11) |
| o | `PATCH /workflow_derivations` | `admin` | refusé, `500` / `55000` — mesuré : la vue joint deux tables, PostgreSQL refuse la réécriture **avant** tout contrôle de privilège |
| p | source modifiée après la copie | `admin` | `source_modified_since_copy` passe à vrai |

### 4.10 Ce que le seed livre

Le seed applique la fonction **par la véritable route** — l'appel RPC de l'API REST, avec la clé de
service —, et non par des `INSERT` fabriqués : `CLAUDE.md` §8 exige qu'une donnée de démonstration
naisse du mécanisme réel.

Une copie du workflow par défaut est posée sur le track **Conseil IA**, sous le nom
« Cycle commercial — Conseil IA ». Elle démontre d'un seul geste la portée `track`, la traçabilité
d'origine, le forçage de `is_default` et le remappage des arêtes : sept étapes, dix transitions,
une étape initiale, `derived_from_workflow_id` renseigné.

Le workspace du seed porte donc **deux** workflows, dont un seul par défaut. Les contrôles des
unités précédentes qui comptaient « un workflow, ni plus ni moins » sont révisés dans le même
changement — c'est le mécanisme de la décision 51, et sa cinquième occurrence.

### 4.11 Preuves attendues de `CRM-032`

| Niveau | Preuves |
|---|---|
| pgTAP | Existence, volatilité, `search_path` et privilèges de la fonction et de la vue ; copie complète des étapes et des transitions ; arêtes remappées ; surcharges et positions préservées ; `is_default` forcé ; lignage renseigné ; les quatre refus du §4.3 éprouvés contre des comptes réels ; **absence de `form_fields`**, figée pour devenir rouge à `CRM-035` |
| API | Les seize lignes du §4.9, hors interface, avec les jetons réels des trois profils ; preuves de refus n° 2 et n° 11 au niveau de la copie |
| Seed | La copie du §4.10, créée par le véritable appel RPC, convergente |
| Interface | **Aucune** — la mention de divergence exige un écran d'administration authentifié, et la webapp reste un appelant anonyme (INC-021). L'écart est nommé dans la Definition of Done, il n'est pas masqué |

### 4.12 Contrainte d'affectation — `CRM-033`

Un channel suit un workflow `global` de son workspace, **ou** un workflow `track` rattaché à son
propre track. Toute autre valeur est refusée. Avec elle vient la contrainte `NOT NULL` sur
`channels.workflow_id` qu'INC-029 laisse due depuis `CRM-021`.

Ce chapitre a été **réécrit après mesure**, et non de mémoire : les quatre écritures du §4.12.1 ont
été appliquées sur la pile réelle, un trigger sonde a été posé sur `channels` puis détruit — son
absence constatée, `to_regprocedure('app.sonde_crm033()')` rendant `NULL` —, et les codes HTTP ont
été relevés contre PostgREST avec le jeton réel de l'administrateur seedé. Les affirmations chiffrées
des §4.12.1 à §4.12.6 sont ces mesures.

#### 4.12.1 Quatre portes ouvertes, et non deux — mesuré

La rédaction d'origine de ce chapitre nommait deux gestes à surveiller : l'affectation d'un workflow
à un channel, et le déplacement d'un channel vers un autre track. La mesure en trouve **quatre**.
Les quatre ont été exécutées sur la base du seed, et les quatre ont été **acceptées** :

| # | Écriture | Côté | État mesuré |
|---|---|---|---|
| 1 | Rattacher un channel de `studio-web` au workflow `track` de `conseil-ia` | `channels` | **acceptée** |
| 2 | Déplacer vers `studio-web` un channel de `conseil-ia` qui suit le workflow `track` de `conseil-ia` | `channels` | **acceptée** |
| 3 | Changer le `track_id` d'un workflow `track` **sous** les channels qui le suivent | `workflows` | **acceptée** |
| 4 | Faire passer le workflow **par défaut** de `global` à `track` sous ses six channels | `workflows` | **acceptée** |

Les portes 3 et 4 n'étaient nommées nulle part. Elles sont pourtant les plus dommageables : la
quatrième invalide d'un seul `UPDATE` le rattachement des **six** channels du seed, et aucune des
deux ne passe par la table que la règle prétendait surveiller.

**Conséquence sur la conception : la règle est défendue des deux côtés.** Un invariant gardé d'un
seul côté n'est pas un invariant, c'est une convention — et l'écriture qui le contourne ne sera pas
signalée. `docs/JOURNAL.md`, décision 88.

#### 4.12.2 La règle, énoncée une fois

Pour tout channel dont `workflow_id` est renseigné, en désignant par *W* le workflow et par *C* le
channel :

```
W.workspace_id = C.workspace_id                          (déjà garanti : clé étrangère composite)
et (   W.scope = 'global'
    ou (W.scope = 'track' et W.track_id = C.track_id) )
```

La première ligne est **déjà tenue par la base** depuis `CRM-031` :
`channels_workflow_id_workspace_id_fkey` est composite. Elle n'est pas réécrite dans un trigger — la
redire coûterait une lecture à chaque écriture pour une garantie déjà acquise, et le jour où la clé
serait relâchée, le trigger masquerait la perte au lieu de la révéler.

La seconde ligne est ce que `CRM-033` livre.

#### 4.12.3 Le trigger sur `channels`

`BEFORE INSERT OR UPDATE OF workflow_id, track_id, workspace_id`. Les trois colonnes, et pas la
seule `workflow_id` : c'est la porte 2 qui l'impose — déplacer un channel ne touche pas
`workflow_id`, et un trigger qui ne se réveille que pour elle laisserait passer le déplacement.

Le trigger **se tait dans deux cas**, et chacun est un choix :

1. `new.workflow_id is null` — le trigger n'a rien à dire ; l'obligation d'un workflow relève de la
   contrainte `NOT NULL` du §4.12.5, qui la dit mieux et plus tôt ;
2. **le workflow désigné est introuvable** dans le workspace du channel. MESURÉ : la clé étrangère
   composite répond alors `23503` → `409`, en nommant la contrainte et la table. Le trigger se
   range : il rendrait un message moins précis pour la même faute. Une clé étrangère est vérifiée
   **après** les triggers `BEFORE`, de sorte que le trigger voit d'abord une ligne dont il ne peut
   rien dire — il rend la main plutôt que d'inventer un refus.

Dans tous les autres cas, l'incompatibilité lève une exception nommée `workflow_hors_track`, en
`SQLSTATE 23514`.

**`23514` et non `P0001`, et c'est mesuré.** Le §4.4 a établi que `P0001` rend `400` : le code
conviendrait. `23514` — `check_violation` — rend `400` lui aussi, MESURÉ sur la sonde, et dit en
outre **de quelle nature** est le refus : une contrainte d'intégrité, pas une règle applicative. Un
client qui trie ses erreurs par famille le range alors avec `channels_name_check` et
`channels_slug_check`, ce qu'il est. `docs/JOURNAL.md`, décision 89.

#### 4.12.4 Le trigger sur `workflows`, qui ferme les portes 3 et 4

`BEFORE UPDATE OF scope, track_id` sur `public.workflows`. Il refuse la modification dès qu'elle
laisserait **au moins un** channel rattaché à un workflow qui ne lui convient plus.

Le refus lève `workflow_portee_occupee`, en `SQLSTATE 23514` également : c'est la même règle, vue de
l'autre côté, et lui donner un autre code laisserait croire à une autre règle.

**Ce trigger ne refuse pas les modifications qui ne changent rien.** Une écriture qui réaffecte la
même valeur passe : la condition porte sur l'état résultant, non sur le fait qu'une colonne a été
mentionnée. Un `UPDATE` qui ne touche ni `scope` ni `track_id` ne le réveille pas du tout.

**Ce qu'il n'interdit pas, et c'est voulu** : un workflow `track` **sans aucun channel** change de
track librement. La règle protège des rattachements, pas des workflows.

#### 4.12.5 `NOT NULL` : la dette d'INC-029, et ce qu'elle change

`docs/SCHEMA.md` §2 décrit `channels.workflow_id` comme **non nulle** depuis l'origine. `CRM-021` ne
pouvait pas la poser — `workflows` n'existait pas —, `CRM-031` non plus : elle change le **contrat de
création d'un channel**, et cela relevait de l'unité qui porte ce contrat. C'est celle-ci.

**Mesuré : aucune ligne n'y ferait obstacle aujourd'hui.**
`select count(*) from public.channels where workflow_id is null` rend **`0`** — les six channels du
seed sont rattachés au workflow par défaut depuis `CRM-031`. La contrainte est donc posable sans
reprise de données.

**Ce que le contrat devient.** Créer un channel exige désormais de désigner un workflow. Trois
conséquences, toutes assumées et aucune masquée :

1. le **seed** doit créer le workflow par défaut **avant** les channels. La ligne `workflows` ne
   dépend d'aucun nœud du catalogue — seules ses **étapes** en dépendent —, si bien que la section
   du workflow se scinde : la ligne d'abord, ses étapes et ses transitions après le catalogue. Le
   `PATCH` de rattachement en fin de section 6, posé par `CRM-031`, disparaît : les channels naissent
   rattachés (`docs/SPEC-channels.md` §8) ;
2. les **scénarios d'API qui créaient un channel sans workflow** deviennent rouges et sont révisés
   dans le même changement — mécanisme de la décision 51, sixième occurrence ;
3. **aucun défaut de colonne n'est posé.** Rattacher automatiquement le channel neuf au workflow par
   défaut du workspace serait commode et faux : un workspace peut n'avoir aucun défaut (§3.2), et le
   défaut silencieux transformerait une omission du client en un choix qu'il n'a pas fait.

#### 4.12.6 Contrat d'API attendu

Écrit avant le code ; les scénarios de `e2e/api/coherence-workflow.spec.ts` le rejouent ligne à
ligne. `A` désigne le workspace du seed.

| # | Appel | Profil | Attendu |
|---|---|---|---|
| a | `PATCH /channels` — workflow `global` du workspace | `admin` | `204` — accepté |
| b | `PATCH /channels` — workflow `track` **du track du channel** | `admin` | `204` — accepté |
| c | `PATCH /channels` — workflow `track` d'un **autre** track | `admin` | `400`, `23514`, `workflow_hors_track` |
| d | `PATCH /channels` — déplacement du channel vers un autre track, workflow `track` conservé | `admin` | `400`, `23514`, `workflow_hors_track` |
| e | `PATCH /channels` — même déplacement, workflow `global` | `admin` | `204` — un workflow global suit le channel partout |
| f | `POST /channels` — création **sans** `workflow_id` | `admin` | `400`, `23502` — `NOT NULL` |
| g | `POST /channels` — création avec un workflow `global` | `admin` | `201` |
| h | `POST /channels` — création avec un workflow `track` d'un autre track | `admin` | `400`, `23514` |
| i | `PATCH /channels` — workflow inexistant | `admin` | `409`, `23503` — la clé étrangère parle, pas le trigger |
| j | `PATCH /workflows` — le `track_id` d'un workflow `track` **occupé** | `admin` | `400`, `23514`, `workflow_portee_occupee` |
| k | `PATCH /workflows` — `global` → `track` sur un workflow **occupé** | `admin` | `400`, `23514`, `workflow_portee_occupee` |
| l | `PATCH /workflows` — le `track_id` d'un workflow `track` **libre** | `admin` | `204` — la règle protège des rattachements, pas des workflows |
| m | Toutes les écritures ci-dessus | `business_developer` | refusées **avant** la règle, par la politique RLS de `CRM-021` / `CRM-031` |

La ligne m n'est pas une redite : elle établit que la nouvelle règle **s'ajoute** aux autorisations
et ne les remplace pas. Un refus de rôle doit rester un refus de rôle, et non devenir un refus
d'intégrité qui apprendrait au demandeur ce que contient la base.

#### 4.12.7 Ce que le seed livre

Le workspace du seed porte déjà les six channels et les deux workflows. `CRM-033` ne crée **aucune
ligne nouvelle** ; il change l'**ordre** de leur création (§4.12.5) et rattache un channel au
workflow de portée `track` :

- `prospection`, channel du track **Conseil & IA**, suit désormais « Cycle commercial — Conseil IA »,
  la copie de portée `track` posée sur ce même track par `CRM-032` ;
- les cinq autres channels continuent de suivre le workflow global par défaut.

Sans ce rattachement, le cas accepté le plus intéressant de la règle — un workflow `track` sur un
channel de **son** track — serait documenté sans être démontrable, ce que `CLAUDE.md` §8 refuse.

**Un défaut de convergence du seed est corrigé dans le même changement.** MESURÉ et reproductible :
la section du seed livrée par `CRM-032` cherche la copie par `derived_from_workflow_id` **et**
`track_id`. Le `track_id` de la copie déplacé à la main, la recherche ne la trouve plus et le seed
en crée une **seconde** — deux copies là où le contrat en déclare une. Le seed était idempotent sans
être convergent, troisième forme de la décision 57 après celles de `CRM-020` et de `CRM-031`. Il
cherche désormais la copie par sa seule dérivation, et **ramène** son track à la valeur déclarée.
Consigné en `docs/INCONSISTENCY_REPORT.md`, **INC-041**.

#### 4.12.8 Preuves attendues de `CRM-033`

| Niveau | Preuves |
|---|---|
| pgTAP | Les deux triggers existent et portent sur les bonnes colonnes ; les trois cas de la Definition of Done — global accepté, `track` du même track accepté, `track` étranger refusé ; le déplacement d'un channel refusé ; les portes 3 et 4 refusées ; un workflow `track` **libre** encore déplaçable ; `NOT NULL` posée ; la clé étrangère laissée parler pour un workflow introuvable |
| API | Les treize lignes du §4.12.6, hors interface, avec les jetons réels des trois profils |
| Seed | L'ordre nouveau, le rattachement de `prospection` au workflow `track`, et la convergence **éprouvée par une dégradation** (INC-041) |
| Interface | **Aucune** — l'affectation d'un workflow à un channel exige un écran d'administration authentifié, et la webapp reste un appelant anonyme (INC-021). L'écart est nommé dans la Definition of Done, il n'est pas masqué |

## 5. Garde centrale : `move_card` — `CRM-034`

### 5.1 Ce que la garde est, et ce qu'elle n'est pas

`move_card` est le **seul chemin** par lequel une card change d'étape. Ce n'est pas une commodité
offerte au client : c'est la seule place du produit où le graphe du workflow devient opposable.
Tant qu'elle n'existe pas, `cards.current_step_id` s'écrit par un simple `PATCH` et une card
franchit une arête que personne n'a déclarée — ce qui a été l'état du produit depuis `CRM-040`, et
qui est **nommé** dans sa Definition of Done plutôt que tu.

Elle **n'est pas** :

- **une politique RLS.** Une politique juge une ligne, pas une trajectoire. Aucune expression
  `USING` ne peut dire « la transition de l'ancienne étape vers la nouvelle est déclarée » : elle ne
  dispose pas des deux valeurs en même temps sous une forme exploitable, et surtout elle ne peut
  pas produire un message d'erreur nommant ce qui manque ;
- **une validation d'interface.** `docs/SPEC-form-composer.md` §6 le pose explicitement :
  « l'interface ne fait que prévenir ». `CLAUDE.md` §10 l'exige de toute règle d'accès ;
- **un remplacement des gardes structurelles.** La vérification n° 3 ci-dessous est déjà tenue par
  une clé étrangère composite livrée par `CRM-040` (§5.3). La fonction la refait quand même, pour
  la raison donnée au §5.3 : un message, et un ordre.

### 5.2 Signature et valeur de retour

```
public.move_card(card_id uuid, to_step_id uuid, comment text default null) returns public.cards
```

**Elle rend la ligne mise à jour**, et non `void`. MESURÉ contre PostgREST `v14.12` : une fonction
rendant un type composite `public.cards` est rendue par l'API comme un objet JSON unique, non comme
un tableau. Le client obtient donc en une requête l'étape, `entered_step_at` et `position`
recalculés, sans relecture — et sans que cette relecture puisse, entre-temps, être refusée par une
politique.

Rendre la ligne est sans conséquence sur la confidentialité, et ce n'est pas une intuition : le
droit d'écriture sur un channel implique le droit de lecture. `app.can_write_channel` exige
`= 'write'`, `app.can_read_channel` exige `<> 'none'` (`docs/SPEC-permissions-rls.md` §3.3) ;
la vérification n° 2 ayant réussi, la n° 1 l'a précédée.

Le troisième paramètre s'appelle `comment`, comme l'énonçait le §5 d'origine. MESURÉ : ce n'est pas
un mot réservé de PL/pgSQL, et PostgREST accepte sans réserve une clé JSON `comment`.

### 5.3 Les six vérifications, dans l'ordre, et ce que chacune rend

Les codes HTTP sont **mesurés** contre PostgREST `v14.12` selon la table du §4.4, non déduits.

| # | Vérification | Message | `SQLSTATE` | HTTP |
|---|---|---|---|---|
| 1 | La card existe, est **visible de l'appelant**, et n'est ni archivée ni en corbeille | `card_not_found` | `P0001` | `400` |
| 2 | L'appelant a le droit d'**écriture** sur le channel de la card | `forbidden` | `42501` | `403` |
| 3 | L'étape cible existe et appartient au workflow de la card | `step_not_in_workflow` | `P0001` | `400` |
| 4 | Une transition est déclarée de l'étape courante vers la cible | `transition_not_allowed` | `P0001` | `400` |
| 5 | Le commentaire est fourni si la transition l'exige | `comment_required` | `P0001` | `400` |
| 5 bis | Le commentaire fourni tient dans les bornes d'un commentaire — 10 000 caractères | `comment_too_long` | `P0001` | `400` |
| 6 | Les champs requis de l'étape cible sont renseignés | `missing_required_fields`, `DETAIL` portant les clés manquantes | `P0001` | `400` |

**L'ordre des deux premières est une règle de discrétion, reprise du §4.3 et non réinventée.**
« Visible » signifie `app.can_read_channel` sur le channel de la card. Une card d'un autre
workspace, ou d'un channel fermé par un droit fin, rend `card_not_found` — jamais `forbidden`.
Répondre « interdit » révélerait son existence à quelqu'un qui n'a pas le droit de la connaître. Un
`viewer` de son propre workspace obtient en revanche `forbidden` : il voit la card tous les jours,
lui dire qu'elle n'existe pas serait un mensonge inutile.

**Une card archivée ou en corbeille est traitée comme absente.** C'est la définition d'« active »
de `docs/SPEC-cards.md` §5, la même que celle qu'emploie la garde d'archivage d'un nœud occupé. Une
card qu'on a rangée ne se déplace pas ; on la restaure d'abord.

**La vérification n° 3 est déjà tenue par la base, et elle est refaite quand même.** La clé
composite `cards (current_step_id, workflow_id) → workflow_steps (id, workflow_id)` livrée par
`CRM-040` la garantit sans exception, y compris contre un `PATCH` direct. La refaire dans la
fonction n'ajoute aucune garantie : elle ajoute **un message** — `step_not_in_workflow` plutôt qu'un
`23503` brut nommant une contrainte — et **une place dans l'ordre**, avant la n° 4, de sorte
qu'une étape d'un autre workflow ne soit jamais rapportée comme une « transition non déclarée »,
ce qui enverrait le client chercher une arête à créer là où le problème est ailleurs.

**Un commentaire de blancs n'est pas un commentaire.** `comment` est normalisé par
`nullif(app.btrim_blancs(comment), '')` avant la vérification n° 5 : une chaîne de blancs est
refusée comme l'absence, sans quoi la règle « la raison d'une affaire perdue est exigée » se
satisferait d'une barre d'espace.

**ET « BLANCS » VEUT DIRE UNICODE — ARBITRÉ LE 2026-08-14, APRÈS AVOIR ÉTÉ MESURÉ PUIS LAISSÉ
OUVERT.** Ce paragraphe a porté pendant dix jours un titre plus large que son expression. Il
annonçait « un commentaire **vide** n'est pas un commentaire » et spécifiait `btrim(comment)`, qui à
un seul argument ne retire **que des espaces** : `btrim(E'\t\n ')` rend deux caractères, et une
tabulation seule passait donc pour un motif d'affaire perdue. L'écart était figé par une assertion
de `supabase/tests/0013_move_card.test.sql` et l'arbitrage demandé en **INC-052**. Il est rendu par
la décision **367** (lot G) et mis en œuvre par la décision **374** : la règle est élargie, et
l'assertion qui constatait le passage constate désormais le refus.

**L'ensemble des blancs est celui de `String.prototype.trim()`**, porté une seule fois par
`app.btrim_blancs(text)` : `U+0009`, `U+000A`, `U+000B`, `U+000C`, `U+000D`, `U+0020`, `U+00A0`,
`U+1680`, `U+2000` à `U+200A`, `U+2028`, `U+2029`, `U+202F`, `U+205F`, `U+3000`, `U+FEFF`. Le motif
du choix est la **convergence** exigée au §4.3 de `docs/SPEC-form-composer.md` : c'est déjà
l'ensemble que le navigateur applique, donc le prédicat de l'interface peut se contenter d'appeler
`trim()` et ne peut plus diverger par une réimplémentation. La classe est **énumérée en toutes
lettres** plutôt qu'écrite `\s` ou `[[:space:]]`, qui dépendent du `ctype` de l'instance — une règle
d'autorisation ne se règle pas par la configuration d'un serveur.

### 5.4 Ce qui est écrit en cas de succès, et ce qui ne peut pas l'être

| Effet | Livré par `CRM-034` | Motif |
|---|---|---|
| `current_step_id` ← étape cible | **oui** | l'objet même de la fonction |
| `entered_step_at` ← `now()` | **oui** | `docs/SPEC-cards.md` §2.9 la réserve nommément à `move_card` |
| `position` ← fin de la colonne d'arrivée | **oui** | voir ci-dessous |
| `updated_at` | **oui**, par le trigger existant | `app.set_updated_at()`, `CRM-040` |
| `card_event` de type `moved` | **oui**, par le trigger de `CRM-044` | migration 16 : le trigger est sur la TABLE `cards`, non dans la fonction |
| insertion du commentaire fourni | **oui**, depuis le 2026-08-14 | INC-048 close — décisions 367 (lot G) et 374. Voir ci-dessous |
| `card_event` de type `commented` | **non** | `card_events` porte huit types, et la timeline des commentaires est due par `CRM-044` |
| arrêt des cadences de relance | **non** | aucune table de cadence n'existe, et **aucune unité du backlog n'en porte** |

**`position` est recalculée, et ce n'est pas un ajout de périmètre.** `docs/SPEC-cards.md` §2.6
définit la portée de `position` comme le couple `(channel_id, current_step_id)` — **une colonne du
board**. Changer `current_step_id` sans recalculer `position` laisse la card dans une portée où sa
valeur n'a jamais été attribuée : deux cards y porteraient le même rang, et l'ordre des colonnes du
board deviendrait arbitraire. Le trigger d'attribution de `CRM-040` est un `BEFORE INSERT` : il ne
voit pas les déplacements. La card est donc placée **en fin** de la colonne d'arrivée, exactement
comme une card qui y naîtrait.

**Le commentaire fourni est écrit dans `card_comments`, et la perte d'INC-048 est close.** Pendant
neuf jours, la vérification n° 5 exigeait un motif que la fonction contrôlait et que rien
n'écrivait : un utilisateur qui motivait une affaire perdue voyait sa transition acceptée et son
motif disparaître. La cause bloquante — « `card_comments` n'existe pas » — a été levée par
`CRM-043` le 2026-08-05 ; l'arbitrage a été rendu par la décision **367** et mis en œuvre par la
décision **374**. Trois propriétés de cette écriture, qui font sa valeur :

- **elle est transactionnelle.** L'insertion vit dans le corps de `move_card` : soit la card change
  d'étape **et** le motif est conservé, soit ni l'un ni l'autre. Une écriture faite après coup par
  le client ne donnerait pas cette garantie ;
- **c'est un commentaire ORDINAIRE**, et non une donnée d'un genre à part. Il apparaît dans le fil
  de la card, porte son auteur et sa date, et son auteur peut le corriger ou le retirer comme
  n'importe quel autre. C'est le sens de l'arbitrage « vrai commentaire transactionnel » ;
- **elle a lieu dès que le motif est FOURNI**, et non seulement lorsque la transition l'exige. Ne
  l'écrire que sur les transitions `require_comment` créerait deux régimes pour un même paramètre,
  et perdrait sans le dire le motif d'un déplacement volontairement commenté.

**Ce que cette écriture emporte, et qu'il vaut mieux lire ici que découvrir.** Le motif étant un
commentaire, il hérite des bornes du commentaire : le `CHECK` de la migration 15 borne le corps à
**10 000 caractères**. Un motif plus long était auparavant accepté puis jeté ; il rendrait désormais
une violation de contrainte opaque. La vérification **n° 5 bis** l'intercepte et rend
`comment_too_long`.

**Ce qu'elle n'emporte pas.** Aucun `card_event` de type `commented` : `card_events` porte huit
types, et la timeline des commentaires appartient à `CRM-044`. Le motif est visible dans le **fil**,
pas dans la timeline typée.

### 5.5 La protection de colonne, sans laquelle la garde ne garde rien

Une garde que l'on contourne par un `PATCH` n'est pas une garde. Tant que `authenticated` détient
`UPDATE` sur **toute** la table `cards`, `move_card` est une commodité facultative, et les six
vérifications ci-dessus ne s'appliquent qu'à ceux qui veulent bien passer par elles.

La preuve de refus n° 5 de `docs/SPEC-permissions-rls.md` §7 — « mise à jour directe de
`cards.current_step_id` par PostgREST → refus » — figure **dans la Definition of Done de
`CRM-034`**. Elle figure aussi dans celle de `CRM-013`. Le chevauchement est réel et il est
consigné (**INC-049**) ; il est tranché du côté de `CRM-034`, parce qu'une unité dont la Definition
of Done exige une preuve doit livrer ce qui la rend possible.

**Le mécanisme, mesuré et non supposé.** Le privilège `UPDATE` de PostgreSQL s'accorde colonne par
colonne :

```
revoke update on public.cards from authenticated;
grant  update (title, description, position, owner_id, amount, currency,
               probability_override, next_action, next_action_at, snoozed_until,
               archived_at, deleted_at) on public.cards to authenticated;
```

Mesuré sur la pile réelle, avec le jeton de l'administratrice seedée :

| Geste | Résultat |
|---|---|
| `PATCH /rest/v1/cards` sur `current_step_id` | **`403`**, `42501`, « permission denied for table cards » |
| `PATCH /rest/v1/cards` sur `description` | `204` — les colonnes ouvertes le restent |
| Appel d'une fonction `SECURITY DEFINER` écrivant `current_step_id` | **accepté** |

La troisième ligne est le point non évident : un privilège de colonne s'applique au rôle qui exécute
l'instruction, et une fonction `SECURITY DEFINER` s'exécute avec les droits de son **propriétaire**.
La garde écrit donc ce que son appelant ne peut pas écrire — ce qui est exactement ce qu'on lui
demande.

**Ce qui n'était PAS livré par `CRM-034` :** `email_local_part`, dont l'écriture directe restait
ouverte ; `secret_id` et `token_hash`, dont les tables n'existent pas ; `card_events` et
`audit_log`, idem. Seule la colonne que cette garde protège était traitée ici.

**`email_local_part` est fermée depuis `CRM-013`** (`supabase/migrations/0014_colonnes_protegees.sql`,
`docs/SPEC-permissions-rls.md` §4.4). **INC-050 est close par cette livraison** : le bloc `GRANT`
ci-dessus, qui ne listait pas la colonne, décrit désormais l'état réellement posé — la
contradiction s'est éteinte par l'exécution de l'unité que la prose nommait, sans qu'aucun
arbitrage n'ait eu à être rendu (`docs/JOURNAL.md`, décision 142).

**DÉPENDANCE D'ORDRE 12 → 14 :** la section 2 de cette migration réapplique les privilèges avec
`email_local_part` dans la liste. La rejouer seule **rouvre** donc la colonne. Elle ne se rejoue
jamais sans la 13 puis la 14 derrière elle — `docs/PROD_MIGRATIONS.md` §3,
`scripts/verify-move-card.sh`, `scripts/verify-colonnes-protegees.sh`.

**Le message de refus divulgue la commande `GRANT` à exécuter** — « Grant the required privileges
to the current role with: GRANT UPDATE ON public.cards TO authenticated; ». Quatrième occurrence
d'INC-026, comportement de PostgREST et non du produit, inchangé et non masqué.

### 5.6 Autorisations et privilèges — trois faits mesurés

`SECURITY DEFINER`, `search_path` fixé à la chaîne vide, propriétaire `postgres`.

**`revoke … from public` ne suffit pas, et c'est mesuré.** L'image Supabase pose un
`ALTER DEFAULT PRIVILEGES IN SCHEMA public` qui accorde `EXECUTE` **nommément** à `anon`,
`authenticated` et `service_role` sur toute fonction nouvelle. Une fonction créée puis « protégée »
par le seul `revoke all … from public` reste donc exécutable par la clé anonyme : MESURÉ,
`200` rendu à un appelant sans jeton sur une fonction sonde ainsi protégée. Le `revoke` doit viser
`public` **et** `anon`, comme `copy_workflow_to_track` le fait depuis la décision 80.

**Le refus de l'appelant anonyme rend `401`, non `403`.** MESURÉ après le `revoke` correct :
`401`, `42501`, « permission denied for function move_card ». PostgREST traite l'absence de droit
d'un appelant non authentifié comme une invitation à s'authentifier (§4.4). Le refus est donc
double — privilège, puis vérification n° 2 —, et le premier suffit.

**`EXECUTE` n'est accordé qu'à `authenticated`.** Contrairement aux fonctions `app.can_*`, qui sont
appelées **depuis des politiques** et doivent donc être exécutables par `anon` pour que le refus se
manifeste par zéro ligne, `move_card` est appelée **directement** par un client : lui refuser le
privilège est le comportement voulu.

### 5.7 La vérification n° 6 n'était pas livrable par `CRM-034` — livrée par `CRM-036`

**Historique conservé, parce qu'il porte une décision et non seulement un état.** La n° 6 demande
que « les champs requis de l'étape cible soient **renseignés** ». L'ensemble exigé était calculable
dès `CRM-034` — l'union définie par `docs/SPEC-form-composer.md` §3.5. **L'ensemble renseigné, lui,
n'avait aucune source** : `card_field_values` est le livrable de `CRM-036`, que `docs/MASTER_PLAN.md`
§2 place après. MESURÉ le 2026-08-04 : `to_regclass('public.card_field_values')` rendait `NULL`.

Deux écritures étaient possibles, et **toutes deux ont été écartées** :

1. **considérer que rien n'est renseigné**, donc refuser toute transition dont l'ensemble exigé
   n'est pas vide. Lecture littérale, et **mesurablement destructrice** : le seed déclare
   `required` sur les étapes `prospection`, `negociation`, `signature` et `perdu`. Les entrées en
   négociation, en signature et les **quatre** transitions « Marquer perdu » auraient été refusées,
   définitivement, jusqu'à `CRM-036` ;
2. **considérer que tout est renseigné**, donc ne rien vérifier en le prétendant vérifié. C'est le
   faux vert que `CLAUDE.md` §17 proscrit.

`CRM-034` a donc livré **cinq** vérifications sur six, l'écart figé par une assertion de la suite
pgTAP destinée à devenir rouge, et la contradiction consignée en INC-047.

**LE MÉCANISME A FONCTIONNÉ, ET L'ASSERTION A DÉSIGNÉ SON MOMENT.** `CRM-036` a livré
`card_field_values` le 2026-08-05 ; l'assertion `hasnt_table` est devenue rouge, et avec elle les
deux scénarios — pgTAP et API — qui constataient qu'un déplacement vers une étape `required`
réussissait. Ils ont été **révisés, non retirés** : ils constatent désormais le refus, et leur
jumeau constate l'acceptation une fois la valeur renseignée.

**Ce que la n° 6 contrôle exactement** est écrit en `docs/SPEC-form-composer.md` §6.7 : l'union des
champs `required` de l'étape cible et des liaisons de la transition dans
`workflow_transition_required_fields`, **moins** les champs archivés. Les clés étrangères et la
cohérence de workflow empêchent désormais tout identifiant mort ou étranger. Le refus porte
`message = 'missing_required_fields'` — jeton stable, comme les cinq autres — et le `DETAIL` porte
la liste des clés manquantes, ordonnées par `position`. MESURÉ : PostgREST expose ce `DETAIL` dans
la clé `details` de sa réponse, et rend `400`.

**Elle vient en dernier**, après les cinq autres : une card invisible ne doit pas apprendre par un
refus quels champs son workflow exige.

### 5.8 Contrat d'API attendu, à mesurer

Treize lignes, écrites **avant** le code pour être mesurées et non supposées. Appels
`POST /rest/v1/rpc/move_card`, jetons réels des trois profils seedés.

| # | Appelant | Appel | Attendu |
|---|---|---|---|
| a | anonyme | n'importe lequel | `401` — privilège |
| b | `admin` | card active, transition déclarée, sans exigence | `200`, la card, étape à jour |
| c | `admin` | même appel, relecture de la ligne | `entered_step_at` postérieure à l'appel |
| d | `admin` | même appel, relecture de la ligne | `position` en fin de colonne d'arrivée |
| e | `admin` | `card_id` inconnu | `400`, `card_not_found` |
| f | `admin` | card **archivée** | `400`, `card_not_found` |
| g | `admin` | card en **corbeille** | `400`, `card_not_found` |
| h | `viewer` | card visible de lui | `403`, `forbidden` — preuve de refus n° 1 |
| i | `viewer` | card d'un channel fermé par un droit fin | `400`, `card_not_found` — discrétion |
| j | `admin` | étape appartenant à un **autre** workflow | `400`, `step_not_in_workflow` |
| k | `admin` | étape du bon workflow, **aucune transition déclarée** | `400`, `transition_not_allowed` |
| l | `admin` | transition exigeant un commentaire, sans commentaire | `400`, `comment_required` |
| m | `admin` | `PATCH` direct de `current_step_id` | `403`, `42501` — preuve de refus n° 5 |

Chaque refus **relit la ligne** pour la constater inchangée : une réponse d'erreur ne prouve pas
qu'aucune écriture n'a eu lieu.

**LA LIGNE i A ÉTÉ CORRIGÉE APRÈS MESURE — INC-051.** Elle nommait le `bizdev`. MESURÉ contre la
pile réelle : le `bizdev` **lit les neuf cards du seed**, aucun droit fin ne lui ferme de channel,
et l'appel rend `200`. Le seed ferme le track de `grands-comptes` au **`viewer`** et à
l'administratrice, et rétrograde le `bizdev` en lecture sur `maintenance` — une rétrogradation
produit `forbidden`, pas `card_not_found`. La ligne était donc insatisfaisable, et le §5.9 interdit
de modifier le seed pour la sauver. Le `viewer` la porte désormais, ce qui est **meilleur** que
l'écriture d'origine : les lignes h et i sont exercées par le **même jeton**, seule façon d'exclure
que l'écart entre les deux réponses vienne du profil plutôt que de la règle de discrétion.

Deux appels s'ajoutent aux treize, non pour élargir le contrat mais pour tenir des faits qui, sans
eux, ne reposeraient que sur cette prose : le `200` du `bizdev` sur la card de la ligne i, qui
deviendra rouge si un droit fin venait à lui fermer ce channel ; et le `403` du `bizdev` sur
`maintenance`, qui exerce l'**autre** chemin vers `forbidden` — un droit fin de channel, là où la
ligne h passe par un rôle de workspace.

### 5.9 Ce que le seed livre

Le seed de `CRM-031` déclare déjà tout ce dont cette garde a besoin, et il n'est **pas modifié** :
le graphe complet du workflow par défaut, dont les quatre transitions « Marquer perdu » exigent un
commentaire (§3.9) — c'est la donnée qui exerce la vérification n° 5 en permanence — et les paires
d'étapes non reliées qui exercent la n° 4.

L'ancien `require_fields` restait vide partout, et le motif était nommé : la vérification qui le lirait
n'était pas livrée (§5.7). Une donnée de démonstration que rien n'exerce est une décoration, pas une
preuve.

**LE MOTIF A DISPARU AVEC `CRM-036`, ET LE SEED SUIT.** La transition *signature → réalisation*
porte une liaison vers `lien-proposition` : c'est la seule donnée du seed qui exerce le
**second membre** de l'union du §3.5, et sans elle cette moitié de la règle ne serait démontrée par
aucune donnée permanente (`docs/SPEC-form-composer.md` §6.11). Le reste du graphe est inchangé.

### 5.10 Preuves attendues de `CRM-034`

| Niveau | Preuves |
|---|---|
| pgTAP | Les cinq vérifications livrées, chacune dans les **deux** sens — ce qui doit passer passe ; forme et privilèges de la fonction ; `search_path` vide ; le privilège de colonne posé et les autres colonnes laissées ouvertes ; `entered_step_at` et `position` mises à jour ; l'écart de la n° 6 figé par une assertion ; l'absence de `card_events` et de `card_comments` figée de même |
| API | Les treize lignes du §5.8, hors interface, avec les jetons réels des trois profils. Preuves de refus n° 1 et 5 de `docs/SPEC-permissions-rls.md` §7 |
| Seed | Inchangé, et **exercé** : le graphe seedé fournit les transitions déclarées, les paires non reliées et les quatre transitions à commentaire |
| Interface | **Aucune** — le board est `CRM-041`, et la webapp reste un appelant anonyme faute d'écran de connexion (INC-021). L'écart est nommé dans la Definition of Done, il n'est pas masqué |

### 5.11 Points ouverts propres à `move_card`

1. ~~**La vérification n° 6 et son message**~~ — **CLOS par `CRM-036`**, INC-047 refermée.
2. **Le commentaire fourni n'est pas conservé** — INC-048, `CRM-043`.
3. **Aucun `card_event`** n'est écrit : la trace du déplacement n'existe pas — `CRM-044`.
4. **Aucune cadence de relance** n'est arrêtée, aucune table n'en porte, aucune unité n'en prévoit.
5. **Le chevauchement de Definition of Done avec `CRM-013`** — INC-049.

La fonction est `SECURITY DEFINER`, avec `search_path` fixé, accordée au seul rôle
`authenticated`.

## 6. Changement de channel — `CRM-045`

Ce chapitre tenait en **dix lignes** écrites à `CRM-000`. Elles nomment une fonction, un principe —
« le remappage est explicite » — et un type d'événement, sans dire ce que la fonction vérifie, dans
quel ordre, ce qu'elle écrit, ni ce qu'elle détruit. Il est réécrit en contrat vérifiable **après
mesure sur la pile réelle** : les privilèges de colonne réellement en vigueur, les clés étrangères
composites qui s'opposent à l'écriture, le vocabulaire que le `CHECK` de `card_events` accepte, et
le refus qu'une seule de ces clés oppose à six cards du seed sur neuf.

Les quatre règles d'origine sont **conservées mot pour mot** ci-dessous et deviennent les §6.2,
§6.5, §6.7 et §6.4 ; rien n'est retiré, tout est rendu opposable.

> Une card change de channel — donc potentiellement de workflow — par
> `move_card_to_channel(card_id, channel_id, step_mapping)`. Le remappage est **explicite** :
> l'appelant fournit l'étape de destination. Si le workflow cible est identique, l'étape est
> conservée par défaut. L'opération écrit un `card_event` de type `channel_changed` conservant
> l'ancien et le nouveau contexte.
>
> Il n'y a pas de remappage automatique par clé de nœud : deux workflows peuvent partager une clé
> sans que le déplacement soit sémantiquement équivalent.

### 6.1 Ce que l'unité est, et ce qu'elle n'est pas

`move_card` (§5) déplace une card **dans** son graphe : elle franchit une arête déclarée, et le
graphe est opposable. `move_card_to_channel` déplace une card **d'un graphe à un autre**. Il n'y a
aucune arête entre deux workflows, et il ne peut pas y en avoir : ce sont deux graphes disjoints.
C'est la raison pour laquelle le remappage est fourni par l'appelant et non calculé — **il n'existe
aucune donnée dans la base à partir de laquelle il pourrait l'être**.

Elle **n'est pas** :

- **une transition.** Aucune `workflow_transitions` n'est consultée, aucune n'est exigée. Une card
  qui change de channel n'a franchi aucune arête ; prétendre le contraire ferait mentir le graphe ;
- **un déplacement entre workspaces.** Le cloisonnement est la propriété la plus ancienne du
  produit (`docs/SPEC-permissions-rls.md` §1). Le §6.4 montre qu'il est tenu **deux fois** : par la
  vérification n° 3 et, si elle était retirée, par une clé composite ;
- **une réponse à INC-046.** La contradiction porte sur le changement de workflow d'un **channel**
  peuplé ; celle-ci déplace une **card**. Le §6.11 mesure ce que cette unité change à INC-046, et
  c'est moins que ce que l'option 2 de son arbitrage demandait.

### 6.2 Signature et valeur de retour

```
public.move_card_to_channel(
    card_id              uuid,
    to_channel_id        uuid,
    to_step_id           uuid    default null,
    discard_field_values boolean default false
) returns public.cards
```

**Elle rend la ligne mise à jour**, comme `move_card` et pour le même motif mesuré au §5.2 : une
fonction rendant `public.cards` est rendue par PostgREST comme un objet JSON unique, et le client
obtient en une requête le channel, le workflow, l'étape, `entered_step_at` et `position`
recalculés, sans relecture. Le droit d'écriture sur le channel **cible** ayant été exigé par la
vérification n° 4, la lecture qu'elle rend est acquise (`app.can_write_channel` exige `= 'write'`,
`app.can_read_channel` exige `<> 'none'`).

**Le deuxième paramètre s'appelle `to_channel_id`, et non `channel_id`.** L'énoncé d'origine
écrivait `channel_id`, qui est aussi le nom d'une colonne de `cards` : dans une fonction dont le
corps lit et écrit cette colonne, l'homonymie est une source d'erreur silencieuse que PL/pgSQL ne
signale pas toujours. `move_card` a tranché de la même façon en nommant `to_step_id` ce que le §5
d'origine appelait « l'étape cible ».

**Le troisième paramètre s'appelle `to_step_id`, et non `step_mapping`.** `docs/SCHEMA.md` §9 le
nomme `step_mapping`, ce qui annonce une **table de correspondance** — plusieurs étapes remappées en
un appel. Le §6 d'origine dit l'inverse : « l'appelant fournit **l'étape** de destination », au
singulier, pour **une** card. Les deux énoncés ne décrivent pas la même fonction. La contradiction
est consignée — `docs/INCONSISTENCY_REPORT.md`, **INC-073** — et **non résolue implicitement** : la
signature retenue est celle du §6, qui décrit le geste réellement demandé, et `docs/SCHEMA.md` est
corrigé pour cesser d'annoncer l'autre.

**Le quatrième paramètre n'était prévu par aucun document, et une mesure l'a imposé** — §6.6.

### 6.3 Ce que la base interdit déjà, mesuré avant d'écrire la moindre ligne

Trois faits ont été mesurés sur la pile réelle **avant** de spécifier la fonction. Chacun change ce
qu'elle doit faire.

**1. `channel_id` et `workflow_id` sont déjà fermés à `authenticated`, et la garde est donc close
avant d'exister.** `move_card` avait dû, en `CRM-034`, retirer elle-même le privilège de colonne
sur `current_step_id` (§5.5) : sans quoi la garde eût été une commodité facultative. Ici, rien de
tel n'est à faire. MESURÉ — les douze colonnes que `authenticated` peut écrire sont :

```
amount, archived_at, currency, deleted_at, description, next_action,
next_action_at, owner_id, position, probability_override, snoozed_until, title
```

`channel_id`, `workflow_id` et `current_step_id` n'y sont pas. `CRM-013` les avait fermées « par
voie de conséquence », en énonçant qu'elles sont « tenues cohérentes par les clés composites de
`CRM-040` ». La conséquence n'avait pas été nommée : **elle rend `move_card_to_channel` opposable
dès sa naissance**, et cette unité n'a aucune protection de colonne à poser. C'est le premier cas du
projet où une unité de sécurité antérieure paie d'avance une unité qui n'existait pas encore.

**2. Un changement de channel est aujourd'hui parfaitement silencieux.** MESURÉ, sur la card
`…0c1` déplacée de `grands-comptes` vers `appels-offres` par un `UPDATE` direct sous `postgres` —
deux channels partageant le même workflow, donc sans changement d'étape : **zéro événement**. Le
trigger de `CRM-044` surveille quatre colonnes, et `channel_id` n'en fait pas partie. La mémoire
d'une affaire ne dit pas aujourd'hui qu'elle a changé de dossier.

**3. `channel_changed` est refusé par la base.** MESURÉ :

```
CHECK ((type = ANY (ARRAY['created', 'moved', 'assigned', 'archived',
                          'unarchived', 'trashed', 'restored', 'field_changed'])))
```

`CRM-044` l'avait écrit et l'avait annoncé : « le jour où une unité écrira un type nouveau, elle
devra étendre cette énumération **dans la même migration que son trigger**, et la base le lui
rappellera par un `23514` ». C'est ce jour. Le mécanisme a fonctionné comme prévu, sur la première
unité à l'éprouver.

### 6.4 Les huit vérifications, dans l'ordre, et ce que chacune rend

Les codes HTTP sont ceux du §4.4, **mesurés** contre PostgREST `v14.12`, non déduits.

| # | Vérification | Message | `SQLSTATE` | HTTP |
|---|---|---|---|---|
| 1 | La card existe, est **visible de l'appelant**, et n'est ni archivée ni en corbeille | `card_not_found` | `P0001` | `400` |
| 2 | L'appelant a le droit d'**écriture** sur le channel **d'origine** | `forbidden` | `42501` | `403` |
| 3 | Le channel cible existe et est **visible de l'appelant** | `channel_not_found` | `P0001` | `400` |
| 4 | L'appelant a le droit d'**écriture** sur le channel **cible** | `forbidden` | `42501` | `403` |
| 5 | Le channel cible n'est pas le channel courant | `same_channel` | `P0001` | `400` |
| 6 | L'étape de destination est fournie si le workflow change | `step_mapping_required` | `P0001` | `400` |
| 7 | L'étape fournie appartient au workflow du channel cible | `step_not_in_workflow` | `P0001` | `400` |
| 8 | Les réponses de formulaire sont assumées perdues si le workflow change | `field_values_would_be_lost`, `DETAIL` portant leur nombre | `P0001` | `400` |

**Les deux droits sont exigés, et l'ordre n'est pas indifférent.** Un déplacement retire une card
d'un endroit et la pose ailleurs : c'est une écriture sur deux channels. N'exiger que le droit sur
la destination laisserait quelqu'un vider un channel qu'il ne peut pas écrire ; n'exiger que celui
sur l'origine laisserait déposer une card dans un channel fermé. Le refus porte sur l'origine
**d'abord**, parce que c'est le seul des deux que l'appelant est certain de connaître : il vient d'y
lire la card.

**La règle de discrétion du §4.3 est reprise, et elle s'applique deux fois.** « Visible » signifie
`app.can_read_channel`. Une card d'un autre workspace, ou d'un channel fermé par un droit fin, rend
`card_not_found` — jamais `forbidden` : répondre « interdit » révélerait son existence. Un channel
cible invisible rend de même `channel_not_found`, et **non** `forbidden` : sans quoi la fonction
deviendrait un oracle d'existence de channels, interrogeable identifiant par identifiant par
quiconque possède une card à déplacer.

**Le cloisonnement des workspaces est tenu deux fois, et la seconde est structurelle.** La
vérification n° 3 le tient : `app.can_read_channel` est fausse pour un channel d'un autre
workspace, dont l'appelant n'est pas membre. Si elle était retirée, la clé composite
`cards (channel_id, workspace_id) → channels (id, workspace_id)` refuserait l'écriture en `23503`.
La fonction ne s'appuie pas sur ce filet — un message de contrainte PostgreSQL n'est pas un message
de produit —, mais il existe, et une assertion le fige.

**La vérification n° 5 refuse le déplacement sur place.** Un « déplacement » qui ne déplace rien
écrirait un `channel_changed` dont l'avant et l'après seraient identiques : une trace mensongère
dans une table que personne ne peut corriger. Le refus est explicite plutôt que silencieux —
rendre `200` sans rien faire serait la « simulation de succès » que `CLAUDE.md` §18 proscrit.

**La vérification n° 6 est le « remappage obligatoire » de la Definition of Done.** Si le workflow
du channel cible diffère de celui de la card et que `to_step_id` est nul, la fonction refuse. Elle
ne choisit **pas** d'étape par défaut : ni la première du graphe cible, ni celle qui porterait le
même nœud. Le §6 d'origine l'interdit — « deux workflows peuvent partager une clé sans que le
déplacement soit sémantiquement équivalent » —, et le seed le démontre : les deux workflows livrés
portent **les sept mêmes nœuds dans le même ordre**, `Prospection`, `Relance`, `Négociation`,
`Signature`, `Réalisation`, `Livré`, `Perdu`. Un remappage par clé de nœud paraîtrait donc juste
sur ce seed, et le paraîtrait jusqu'au jour où deux workflows divergeraient. Une règle qui n'est
fausse que plus tard est une règle fausse.

**Si le workflow est identique, `to_step_id` est facultatif — et accepté.** L'étape est alors
conservée, comme le §6 d'origine l'exige. Fournir explicitement une étape du même workflow reste
licite : c'est un changement de channel **et** de colonne en un geste, et rien ne justifie de
l'interdire. La vérification n° 7 s'applique dans les deux cas.

**La vérification n° 7 est refaite alors que la base la tient**, exactement comme la n° 3 de
`move_card` (§5.3) : la clé composite `cards (current_step_id, workflow_id) → workflow_steps` la
garantit. La refaire n'ajoute aucune garantie — elle ajoute **un message**, et **une place dans
l'ordre**, avant que la n° 8 ne parle de destruction.

### 6.5 Ce qui est écrit en cas de succès

| Effet | Valeur |
|---|---|
| `channel_id` | le channel cible |
| `workflow_id` | le workflow du channel cible — **jamais fourni par l'appelant**, toujours dérivé |
| `current_step_id` | `to_step_id`, ou l'étape courante si le workflow ne change pas |
| `entered_step_at` | `now()` **si et seulement si** l'étape change |
| `position` | fin de la colonne d'arrivée, portée `(channel_id, current_step_id)` |
| `updated_at` | par le trigger `app.set_updated_at()`, inchangé |
| `card_event` `channel_changed` | par le trigger de `cards`, §6.7 |

**`workflow_id` n'est pas un paramètre, et ce n'est pas un oubli.** Le workflow d'une card est celui
de son channel — c'est la lecture n° 1 de `docs/SCHEMA.md` §5 retenue par `CRM-040` (INC-046). Le
laisser fournir par l'appelant ouvrirait la seule combinaison que la clé composite refuse, pour
n'obtenir qu'un `23503`. Il est **lu** dans `channels`.

**Les trois colonnes s'écrivent en un seul `UPDATE`, et il le faut.** MESURÉ : écrire `channel_id`
seul rend

```
ERROR: insert or update on table "cards" violates foreign key constraint
       "cards_channel_id_workflow_id_fkey"
DETAIL: Key (channel_id, workflow_id)=(…031, …051) is not present in table "channels".
```

Les clés composites sont vérifiées en fin d'instruction, non en fin de transaction : deux `UPDATE`
successifs échoueraient là où un seul passe. Ce n'est pas une préférence de style.

**`entered_step_at` n'est touchée que si l'étape change.** `docs/SPEC-cards.md` §2.9 la réserve à
`move_card` ; l'étendre à `move_card_to_channel` est une décision, prise ici : entrer dans une
étape par remappage est y entrer. Mais un changement de channel **à étape constante** ne fait entrer
la card nulle part, et remettre l'horodatage à zéro y ferait mentir la seule mesure d'ancienneté du
produit — une affaire en négociation depuis trois semaines paraîtrait y être entrée à l'instant
parce qu'on l'a rangée dans un autre dossier.

**`position` est toujours recalculée**, même à étape constante : la portée définie par
`docs/SPEC-cards.md` §2.6 est le couple `(channel_id, current_step_id)`, et changer de channel
change de portée. Sans recalcul, deux cards porteraient le même rang dans la colonne d'arrivée et
l'ordre du board deviendrait arbitraire — le motif exact du §5.4.

### 6.6 Les réponses de formulaire, et la perte qu'aucun document n'avait vue

**Le fait, mesuré.** `card_field_values` porte
`(card_id, workflow_id) → cards (id, workflow_id) ON DELETE CASCADE`. La cascade joue sur la
**suppression** d'une card, pas sur la **mise à jour** de son `workflow_id` : il n'y a pas
d'`ON UPDATE CASCADE`. Changer le workflow d'une card qui porte au moins une réponse est donc
refusé :

```
ERROR: update or delete on table "cards" violates foreign key constraint
       "card_field_values_card_id_workflow_id_fkey" on table "card_field_values"
DETAIL: Key (id, workflow_id)=(…0c1, …051) is still referenced from table "card_field_values".
```

Ce n'est pas un cas limite. MESURÉ sur le seed : **six cards sur neuf** portent des réponses. Sans
traitement, `move_card_to_channel` serait, pour les deux tiers du seed, une fonction qui rend un
`23503` brut nommant une contrainte interne.

**Ce que les réponses deviennent, et pourquoi il n'y a pas de troisième voie.** Une réponse répond à
la question d'un workflow ; la charnière `workflow_id` de `card_field_values` existe précisément
pour « rendre impossible une valeur répondant à la question d'un **autre** workflow » (`CRM-036`).
Une card qui change de workflow n'a donc plus de réponses valides. Trois issues étaient possibles :

1. **les remapper** par clé de champ vers le workflow cible — écarté, et pas par prudence : c'est le
   remappage automatique par clé que le §6 d'origine interdit nommément, appliqué aux champs au lieu
   des nœuds. Deux workflows peuvent porter une clé `budget` qui ne désigne pas la même chose ;
2. **refuser le déplacement** dès qu'une réponse existe — cohérent, et inutile : deux tiers du seed
   deviennent indéplaçables, et la fonction ne sert plus qu'aux cards vides ;
3. **les supprimer**, ce qui est retenu — **mais jamais sans que l'appelant l'ait dit**.

**La perte est explicite, et c'est le quatrième paramètre.** `discard_field_values` vaut `false` par
défaut. Tant qu'il vaut `false`, un déplacement qui changerait de workflow et détruirait des
réponses est **refusé** — vérification n° 8, `field_values_would_be_lost`, avec le nombre de
réponses en `DETAIL`. L'appelant qui pose `true` a dit ce qu'il détruisait.

Le motif est le principe même de ce chapitre. Le §6 d'origine tient en une phrase : « le remappage
est **explicite** ». Détruire les réponses d'une affaire en silence, à l'occasion d'un geste
présenté comme un rangement, serait exactement l'inverse. Un paramètre par défaut destructeur eût
été la « valeur par défaut trompeuse » de `CLAUDE.md` §18.

**Ce que la mémoire en garde.** Les `field_changed` déjà écrits **ne sont pas supprimés** : la
suppression porte sur `card_field_values`, pas sur `card_events`, et rien ne peut supprimer un
événement (`CRM-044` §14.8). Le fil d'une card déplacée continue donc de porter les réponses qu'elle
a données, avec leurs dates — **la mémoire survit à la donnée**. Elle les porte sans libellé, les
champs du workflow d'origine n'étant plus résolus par l'écran ; c'est un manque nommé au §6.10.

**Le déplacement à workflow identique ne détruit rien**, et la vérification n° 8 ne s'y applique
pas : la charnière `workflow_id` ne change pas, les réponses restent valides et sont conservées.
MESURÉ : `…0c1` déplacée de `grands-comptes` vers `appels-offres` conserve ses deux réponses.

### 6.7 L'événement, et où il est écrit

`channel_changed` s'ajoute au vocabulaire de `docs/SPEC-cards.md` §14.4, qui compte désormais
**neuf** types. Son `payload` conserve « l'ancien et le nouveau contexte » comme le §6 d'origine
l'exige :

```json
{"from_channel_id": "…", "to_channel_id": "…",
 "from_workflow_id": "…", "to_workflow_id": "…",
 "from_step_id": "…", "to_step_id": "…"}
```

**Il est écrit par le trigger de `cards`, non par la fonction** — décision 203 de `CRM-044`, reprise
et non réinventée. Un trigger sur la table couvre **strictement plus** que la RPC : un `PATCH`
direct sous `service_role`, que la fermeture de colonne n'arrête pas (`CRM-013` §4.4.3), produit
lui aussi l'événement. Une garde protège les clients ; une trace doit couvrir tout le monde.

**Un déplacement produit UN événement, jamais deux.** La garde `moved` du trigger est désormais
conditionnée à `channel_id` **inchangé**. Sans cette condition, un déplacement qui change aussi
l'étape écrirait un `moved` à côté du `channel_changed` — et `moved` signifie, depuis `CRM-044`,
« la card a franchi une arête du graphe ». Elle n'en a franchi aucune. Rien n'est perdu pour autant :
`from_step_id` et `to_step_id` sont dans le `payload` de `channel_changed`, qui dit **plus** que le
`moved` qu'il remplace, et le dit sans mentir sur la nature du geste.

**Un déplacement à étape constante produit l'événement quand même** : c'est le fait n° 2 du §6.3 qui
cesse. Le rangement d'une affaire est un fait de son histoire.

### 6.8 Autorisations et privilèges

`SECURITY DEFINER`, `search_path` fixé à la chaîne vide, propriétaire `postgres`, exactement comme
`move_card` (§5.6) et pour les mêmes trois motifs mesurés. `EXECUTE` est **révoqué de `public` et
nommément d'`anon`** — un `revoke … from public` seul ne suffit pas, l'image posant des
`ALTER DEFAULT PRIVILEGES` qui accordent nommément aux trois rôles — puis accordé au seul rôle
`authenticated`. L'appelant anonyme obtient `401`, non `403` (§4.4).

`service_role` n'a pas besoin de la fonction : il conserve `all privileges` sur `cards` et peut
écrire les colonnes directement. C'est la limite déjà nommée au §4.4.3 de
`docs/SPEC-permissions-rls.md`, inchangée — et le §6.7 la rend au moins **visible**, le trigger
écrivant l'événement quel que soit le rôle.

### 6.9 Contrat d'API attendu

Toutes les lignes sont à **mesurer** contre PostgREST, non à déduire.

| # | Appel | Attendu |
|---|---|---|
| a | Sans jeton | `401`, `42501` |
| b | Jeton d'un autre workspace | `400`, `card_not_found` |
| c | `viewer` du workspace, sur une card qu'il voit | `403`, `forbidden` |
| d | Card inexistante | `400`, `card_not_found` |
| e | Card archivée, puis card en corbeille | `400`, `card_not_found` |
| f | Channel cible inexistant | `400`, `channel_not_found` |
| g | Channel cible d'un autre workspace | `400`, `channel_not_found` |
| h | Channel cible = channel courant | `400`, `same_channel` |
| i | Workflow différent, `to_step_id` nul | `400`, `step_mapping_required` |
| j | `to_step_id` appartenant à un autre workflow | `400`, `step_not_in_workflow` |
| k | Workflow différent, réponses présentes, `discard_field_values` faux | `400`, `field_values_would_be_lost` |
| l | Même workflow, `to_step_id` nul, réponses présentes | `200`, étape conservée, réponses **conservées** |
| m | Workflow différent, réponses présentes, `discard_field_values` vrai | `200`, réponses **supprimées** |
| n | Succès : objet JSON unique, `channel_id`, `workflow_id`, `current_step_id` et `position` à jour | `200` |
| o | `PATCH` direct de `cards.channel_id` par `authenticated` | `403`, `42501` — la garde n'est pas contournable |
| p | Après succès : un `channel_changed` de plus, **et aucun `moved`** | lecture de `card_events` |

### 6.10 Ce que `CRM-045` ne livre pas, et pourquoi

- **Aucun écran.** La Definition of Done de l'unité demande « pgTAP (remappage obligatoire,
  événement écrit) ; E2E » — et, seule du chunk 3, elle ne demande **pas** de captures. Le
  déplacement entre channels n'a pas de geste d'interface défini : ni le board (§7) ni la vue liste
  (`docs/SPEC-cards.md` §12) ne portent de sélecteur de channel, et INC-021 interdit de toute façon
  tout parcours par un utilisateur connecté. La preuve E2E est donc une preuve d'**API**, hors
  interface, avec les jetons réels des trois profils.
- **Aucun libellé pour les réponses supprimées.** Le fil continue de porter les `field_changed`
  d'un workflow que la card ne suit plus ; l'écran résout les libellés dans les champs du workflow
  **courant** et ne les y trouve plus. Le repli documenté de `CRM-044` s'applique — le fil affiche
  la famille sans le nom. Corriger cela demanderait de résoudre un libellé dans un workflow
  historique, ce qu'aucune donnée ne permet.
- **Aucun déplacement en lot dans cette fonction.** `move_card_to_channel` reste une card à la
  fois. Le geste pluriel que `step_mapping` annonçait est une fonction distincte, spécifiée par
  `docs/SPEC-change-channel-workflow.md` et portée par `CRM-019` (INC-073).
- **Aucun arrêt des cadences de relance**, comme `move_card` : aucune table de cadence n'existe et
  aucune unité du backlog n'en porte.

### 6.11 Ce que cette unité change à INC-046, et ce qu'elle n'y change pas

INC-046 constate que le workflow d'un channel **peuplé** ne peut plus changer, et que le seed ne
peut donc pas démontrer une card sur un workflow **dérivé** : `prospection`, seul channel du seed à
suivre la copie de portée track, est le seul que le seed repointe, et une card qui y séjournerait
ferait échouer le rejeu.

`move_card_to_channel` ne lève pas cette contrainte : elle déplace une card, jamais un channel.
L'option 2 de l'arbitrage — « une RPC qui change le workflow d'un channel **et** remappe l'étape de
chacune de ses cards » — est désormais **spécifiée séparément** par
`docs/SPEC-change-channel-workflow.md` et portée par `CRM-019`.

Ce qu'elle change est plus étroit et vaut d'être écrit : le seed peut désormais démontrer une card
sur un workflow dérivé **en transit**, par un aller-retour, sans en laisser aucune à demeure (§6.12).
La divergence de `CRM-032` reste démontrée par ses étapes et ses transitions ; elle l'est désormais
aussi par une card qui les a réellement empruntées, le temps d'un aller et d'un retour.

### 6.12 Ce que le seed livre

Le seed **ne peut pas** écrire un `channel_changed` : `card_events` n'accepte l'écriture d'aucun
rôle, `service_role` compris (`CRM-044` §14.7). L'événement ne peut naître que d'un déplacement
réel, ce qui est exactement ce que `CLAUDE.md` §8 demande — « ne pas fabriquer artificiellement des
traces censées représenter l'exécution d'un processus réel ».

Le seed exécute donc **un aller-retour réel**, avec le **jeton de l'administratrice**, par la vraie
RPC, sur le modèle des deux allers-retours de `CRM-044` §14.11 :

1. la card `…0c5`, « Support niveau 2 — Atelier Meunier », de `maintenance` vers `prospection` —
   donc du workflow global vers la **copie de portée track** —, avec l'étape `Prospection` du
   graphe cible fournie explicitement ;
2. la même, de `prospection` vers `maintenance`, avec l'étape `Prospection` du graphe d'origine.

**Pourquoi `…0c5` et non une autre.** MESURÉ : elle est l'une des trois cards du seed qui ne portent
**aucune** réponse de formulaire. L'aller-retour n'a donc rien à détruire, `discard_field_values`
reste à `false`, et le seed ne démontre pas la destruction — il ne la démontre pas parce qu'il ne
peut pas la rendre convergente, une réponse détruite ne renaissant pas au retour. La destruction est
prouvée par la suite d'API, sur une card qu'elle crée et qu'elle détruit.

**Le seed reste convergent**, au sens d'INC-041 et d'INC-035 : l'aller-retour est **conditionné par
une relecture** — il n'est exécuté que si la card est là où le seed l'attend —, et il rend la card à
son channel, à son workflow et à son étape de départ. Sa `position` est recalculée deux fois et
retombe sur sa valeur d'origine, `…0c5` étant seule dans sa colonne. Le rejeu ajoute donc **deux**
`channel_changed` à chaque exécution : c'est une histoire qui s'allonge, comme celle de `CRM-044`,
et non un état qui dérive. La distinction est celle du §14.11 — seule la **naissance** d'une card
est idempotente.

Au sortir du seed : **29 événements**, dont **2** `channel_changed`, et **aucun** `moved`
supplémentaire — le §6.7 en fait une propriété mesurable.

### 6.13 Le geste pluriel est un contrat séparé — `CRM-019`

`change_channel_workflow` ne remplace et n'élargit pas `move_card_to_channel`. Son sujet est le
contenant : le channel conserve son identité, change de graphe et remappe toutes ses cards. Le
tableau de correspondance, l'administration exigée, l'atomicité par contrainte différable, la perte
explicite des réponses, le retour `SETOF` et l'événement `workflow_changed` sont définis dans
`docs/SPEC-change-channel-workflow.md`. Cette séparation est la fermeture contractuelle
d'INC-046 et INC-073 ; aucune règle du geste unitaire des §6.1 à §6.12 n'est modifiée.

### 6.14 Preuves attendues de `CRM-045`

1. **pgTAP dédié** : les huit refus un par un ; le remappage **obligatoire** quand le workflow
   change ; l'événement **écrit**, avec son `payload` complet ; l'**absence** de `moved` à côté ;
   l'événement écrit aussi pour un `PATCH` direct sous `service_role` ; les réponses conservées à
   workflow identique et supprimées sur `discard_field_values` ; `entered_step_at` inchangée à étape
   constante ; le `CHECK` à neuf valeurs ; `mail_received` toujours refusé.
2. **Preuve d'API dédiée**, hors interface, avec les jetons réels des trois profils : les seize
   lignes du contrat du §6.9.
3. **Preuve de refus n° 5 reconduite** : le `PATCH` direct de `cards.channel_id` par
   `authenticated` — ligne *o*.
4. **Harnais rejouable** `scripts/verify-move-card-to-channel.sh`, **non complaisant** : éprouvé par
   des dégradations volontaires qui doivent réellement le faire échouer.
5. **Aucune régression** : les vingt-quatre harnais précédents rejoués, et les compteurs de
   `scripts/verify-harness.sh` révisés **dans le même changement**.

## 7. Interface : le board kanban — `CRM-041`

Ce chapitre tenait en **cinq lignes** écrites à `CRM-000`. Elles disent ce que l'écran montre sans
dire comment il le compose, ce qu'il lit, ni ce qu'il faut en prouver. Il est réécrit en contrat
vérifiable **après mesure de la pile réelle** — le seed en base, les réponses de PostgREST, les
refus de `move_card` un par un, et la pilotabilité du glisser-déposer par le harnais. Les cinq
règles d'origine sont **conservées mot pour mot** ci-dessous et deviennent les §7.3, §7.6, §7.7,
§7.10 et §7.13 ; rien n'est retiré, tout est rendu opposable.

> - Le board affiche une colonne par étape, ordonnée par `position`.
> - Le menu d'actions d'une card liste **exactement** les transitions déclarées depuis son étape
>   courante, avec leur libellé.
> - Le glisser-déposer vers une colonne non atteignable est refusé visuellement **et** ne déclenche
>   aucun appel : la liste des transitions autorisées est connue du client.
> - Un refus du backend replace la card et affiche la raison exacte (transition interdite, champs
>   manquants avec leur libellé, droit insuffisant).
> - L'éditeur de workflow est réservé aux administrateurs : sélection des nœuds, ordre, arêtes,
>   surcharges, et champs de formulaire.

### 7.1 Ce que le board est, et ce qu'il n'est pas

Le board est la **vue du graphe de workflow appliqué à un channel**. Il n'invente aucune règle : il
rend visible l'état que `cards.current_step_id` porte, et il ne propose que les gestes que
`move_card` accepterait. C'est la raison pour laquelle sa spécification vit ici, dans le document de
la garde, et non dans un document d'interface : **l'écran est le miroir du graphe**, et les deux ne
peuvent pas diverger sans que l'un des deux mente.

Il **n'est pas** :

- **une autorisation.** Ce que le board montre est ce que la RLS a consenti à rendre. Ce qu'il cache
  n'est jamais une protection : `CLAUDE.md` §10 l'interdit, et `move_card` refuse de son côté tout
  ce que le board croirait interdire ;
- **un éditeur de workflow.** La cinquième règle d'origine — « l'éditeur de workflow est réservé aux
  administrateurs » — décrit un écran que **`CRM-041` ne livre pas** et qu'aucune unité du backlog
  ne porte aujourd'hui. Elle est conservée telle quelle au §7.13, comme énoncé d'intention, et le
  manque est nommé plutôt que comblé ;
- **une vue liste.** Tri, filtres et pagination sont `CRM-042`.

### 7.2 Ce que le board lit, et en combien de requêtes

Le board s'ouvre sur la route `/tracks/:slugTrack/:slugChannel`, celle que `CRM-021` a livrée et qui
affichait jusqu'ici l'état vide de sa zone principale.

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 0 | le channel courant | résolu **dans la liste déjà chargée** par la coquille | — | aucune requête : `useContenuTrack` la rapporte déjà pour la barre d'onglets |
| 1 | `workflow_steps` + `workflow_nodes_catalog` embarqué | `workflow_id=eq.<workflow du channel>` | `position` | les colonnes |
| 2 | `workflow_transitions` | `workflow_id=eq.<workflow du channel>` | — | les gestes atteignables |
| 3 | `cards` | `channel_id=eq.<channel>`, `archived_at=is.null`, `deleted_at=is.null` | `position`, puis `title` | le contenu des colonnes |
| 4 | `form_fields` | `workflow_id=eq.<workflow du channel>` | — | le **libellé** des champs manquants d'un refus |

**Le channel n'est pas relu, et `workflow_id` rejoint les colonnes que la coquille demande.**
`CRM-021` lisait `id, name, slug, position` et écartait `workflow_id` en écrivant que « `workflow_id`
est de surcroît nul partout jusqu'à `CRM-031` (INC-029) — le demander donnerait l'illusion d'une
donnée exploitable ». MESURÉ : les six channels du seed portent désormais un workflow, la colonne
est `NOT NULL` depuis `CRM-033`, et le motif de l'écarter a disparu avec lui. La colonne est donc
ajoutée à la lecture **partagée**, plutôt qu'une seconde lecture des mêmes lignes soit écrite pour
la route du board — c'est la règle de la décision 167 et du §5.4 de `docs/SPEC-channels.md`,
appliquée une deuxième fois.

**Les quatre requêtes sont émises en parallèle**, et non en chaîne : elles ne dépendent que de
`workflow_id` et de `channel_id`, connus ensemble dès que le channel est résolu. Les enchaîner
multiplierait par quatre la latence d'ouverture sans rien garantir de plus.

**La quatrième requête est un coût assumé, et l'alternative est nommée.** `form_fields` n'est
affiché nulle part sur le board ; il n'est lu que pour traduire les clés qu'un refus
`missing_required_fields` rapporte (§7.10). L'obtenir **au moment du refus** aurait épargné une
requête à toutes les ouvertures qui ne refusent rien — au prix de faire dépendre un message d'erreur
d'une seconde requête qui peut échouer à son tour. Un refus expliqué à moitié est pire qu'un refus
expliqué : la requête est émise d'avance.

**Révisé par `CRM-022` : le responsable est lisible et son avatar est rendu.** La requête des cards
embarque le profil par la FK `cards_owner_id_fkey`; le board affiche avatar et nom sans lecture par
card. Une card sans responsable n'affiche rien à cet emplacement, et aucun UUID ne devient une
valeur de présentation.

### 7.3 Composition des colonnes

> « Le board affiche une colonne par étape, ordonnée par `position`. »

- **Une colonne par étape du workflow du channel**, dans l'ordre `workflow_steps.position` (§3.6).
  La composition part des **étapes**, jamais des cards : une étape sans card doit produire une
  colonne vide, et une lecture qui grouperait les cards par étape la perdrait en silence. MESURÉ sur
  le seed : le workflow standard porte **sept** étapes et le channel `grands-comptes` n'occupe que
  **deux** d'entre elles — cinq colonnes vides sont donc la situation normale, pas le cas limite.
- **Libellé de colonne** : `workflow_steps.label_override` s'il est renseigné, sinon
  `workflow_nodes_catalog.label`. MESURÉ : le seed emploie l'un et l'autre — `Réalisation en cours`
  surcharge `Réalisation`, les six autres étapes ne surchargent rien.
- **Compteur** en badge neutre (`docs/DESIGN_SYSTEM.md` §5.2), et **montant cumulé** des cards de la
  colonne lorsqu'au moins une porte un montant. Le cumul ne porte que sur les cards **de la même
  devise** que la première ; une colonne mêlant deux devises n'affiche aucun cumul plutôt qu'une
  addition fausse. MESURÉ : le seed porte `EUR` et `CHF` sur des channels distincts, la situation
  n'y survient donc pas — l'écart est figé par un test unitaire, non par une donnée.
- **Ordre des cards dans une colonne** : `cards.position`, portée `(channel_id, current_step_id)`
  (`docs/SPEC-cards.md` §2.6), puis `title` à position égale. Le second critère n'est pas
  décoratif : MESURÉ, `position` n'est pas dense — la card `…0000c7` est seule dans sa colonne et y
  porte la position `2` —, et deux cards peuvent partager une valeur après un déplacement. Sans
  départage, elles s'échangeraient d'un chargement à l'autre. C'est la règle déjà posée pour les
  channels (`docs/SPEC-channels.md` §3), reprise et non réinventée.
- **Cards archivées et en corbeille exclues**, par le filtre serveur et non par le composant : c'est
  la définition d'« active » de `docs/SPEC-cards.md` §5, la même que celle qu'emploie la
  vérification n° 1 de `move_card`.

### 7.4 Ce qu'une carte de card montre, et ce qu'elle ne peut pas montrer

`docs/DESIGN_SYSTEM.md` §5.1 énumère six contenus. Chacun est traité, aucun n'est passé sous
silence :

| Contenu du §5.1 | Livré par `CRM-041` | Motif |
|---|---|---|
| Liseré supérieur de 3 px à la couleur du nœud | **oui** | `workflow_nodes_catalog.color`, jeton parmi les cinq |
| Titre, 2 lignes maximum, ellipse | **oui** | — |
| Montant si renseigné | **oui**, en donnée technique (§2, §5.7 bis du design system) | — |
| Indicateur de prochaine action | **oui** — `cards.next_action`, avec son icône | — |
| Pastille d'ancienneté dans l'étape | **oui** | `entered_step_at`, seuil `workflow_steps.stale_after_days` sinon `workflow_nodes_catalog.default_stale_after_days` |
| Pastilles d'étiquettes | **non** | aucune table d'étiquettes n'existe, **et aucune unité du backlog n'en porte** |
| Avatar du responsable | **oui, depuis `CRM-022`** | profil embarqué par `cards_owner_id_fkey`, repli sur initiales |

**La pastille d'ancienneté est neutre, puis `danger` au-delà du seuil**, comme le §5.1 l'exige. Elle
n'est **pas** rendue lorsque le seuil est absent : MESURÉ, l'étape `Livré` n'en porte aucun, et
inventer un seuil par défaut serait une règle de produit que personne n'a prise.

**AUCUNE CARD DU SEED N'ATTEINT SON SEUIL, ET C'EST MESURÉ.** Le seed pose `entered_step_at` à
`now()` au moment où il s'applique : l'âge de toute card seedée est de quelques secondes, contre des
seuils de 5 à 30 jours. La bascule vers `danger` ne peut donc être démontrée **par aucune donnée
permanente** ; elle l'est par un test unitaire et par une preuve d'interface à réponse substituée.
Le manque appartient au seed de démonstration, `CRM-046`, et il est nommé plutôt que compensé.

### 7.5 Les transitions atteignables, source unique du geste

L'index `from_step_id → transitions déclarées` est calculé **une fois**, à partir de la requête n° 2,
et sert les trois usages : les cibles de dépôt, le menu, et le refus visuel. Une seconde définition
de « atteignable » serait une occasion de divergence, et c'est exactement ce que la garde interdit.

- Une transition **sans libellé** est légale : MESURÉ, `workflow_transitions.label` est nullable.
  Le repli est « Passer à *<étape cible>* », composé par une **clé de traduction paramétrée** et
  jamais par concaténation dans le composant (`CLAUDE.md` §23).
- **L'ordre du menu est celui de la position de l'étape cible.** MESURÉ : `workflow_transitions` ne
  porte **aucune colonne `position`** — c'est le seul ordre que la donnée porte. Un ordre
  alphabétique ferait passer « Marquer perdu » avant « Relancer » sur toutes les étapes du seed.
- Une transition dont l'étape cible n'existe pas dans les colonnes lues est **ignorée**. Le cas est
  structurellement impossible — la clé composite `workflow_transitions (to_step_id, workflow_id)`
  l'interdit —, et l'ignorer plutôt que rendre une colonne fantôme est le comportement sûr.

### 7.6 Le glisser-déposer

> « Le glisser-déposer vers une colonne non atteignable est refusé visuellement **et** ne déclenche
> aucun appel : la liste des transitions autorisées est connue du client. »

- **Patron retenu : le glisser-déposer natif HTML5** (`draggable`, `dragstart` / `dragover` / `drop`),
  et non une implémentation à base d'événements de pointeur. MESURÉ avant d'être écrit : Playwright
  1.62.1 pilote réellement ce patron dans Chromium, aussi bien par `locator.dragTo()` que par une
  séquence `mouse.down` / `mouse.move` / `mouse.up` — laquelle produit une vidéo exploitable, ce que
  `dragTo` ne fait pas. Sans cette mesure, la Definition of Done aurait exigé une vidéo d'un geste
  que le harnais ne sait pas jouer.
- **Une colonne non atteignable n'est pas une cible de dépôt** : elle n'appelle pas
  `preventDefault()` sur `dragover`, ce qui refuse le dépôt **au niveau du navigateur** — le
  pointeur affiche l'interdit, et aucun `drop` n'est émis. C'est le refus visuel de la règle
  d'origine, obtenu sans qu'aucune ligne ne compare quoi que ce soit au moment du dépôt.
- **La colonne d'origine n'est pas une cible** : `move_card` refuserait
  `from_step_id = to_step_id`, contrainte `workflow_transitions_distinct_check`, et le réordonnancement
  dans une colonne n'est pas livré (§7.12).
- **Une cible atteignable se signale** par un liseré `--color-brand` en pointillés pendant le
  survol (`docs/DESIGN_SYSTEM.md` §5.2).

### 7.7 Le déplacement au clavier

> « Le menu d'actions d'une card liste **exactement** les transitions déclarées depuis son étape
> courante, avec leur libellé. »

`docs/DESIGN_SYSTEM.md` §8 pose que « le déplacement d'une card est possible au clavier via le menu
de transitions ». Le menu **est** le chemin clavier ; aucun glisser-déposer au clavier n'est
inventé.

- Patron : un bouton `aria-expanded` / `aria-controls` révélant une **liste de boutons**. Le patron
  ARIA `menu` / `menuitem` avec `tabindex` glissant est **écarté**, pour le motif déjà écrit au
  §12.1 de `docs/DESIGN_SYSTEM.md` à propos des onglets : il retire la navigation par `Tab` que des
  boutons ordinaires donnent naturellement, et décrit un comportement d'application de bureau que
  le produit n'a pas.
- `Échap` referme le menu et **rend le focus au bouton** qui l'a ouvert.
- Une card dont l'étape n'a **aucune** transition sortante n'a pas de menu : le bouton est rendu
  **désactivé et lisible**, avec la raison (`docs/DESIGN_SYSTEM.md` §8, « les états désactivés
  restent lisibles et expliquent pourquoi »). MESURÉ : les étapes `Livré` et `Perdu` du seed sont
  dans ce cas.

### 7.8 Le commentaire exigé n'est jamais optimiste

Une transition `require_comment` — MESURÉ, les quatre « Marquer perdu » du seed — ne peut pas
aboutir sans motif. Deux comportements étaient possibles ; le second est retenu :

1. appeler, recevoir `comment_required`, puis demander le motif. Rejeté : l'écran ferait faire à
   l'utilisateur un aller-retour dont le client connaît d'avance l'issue, exactement ce que la
   troisième règle d'origine refuse pour les colonnes non atteignables ;
2. **demander le motif avant d'appeler.** Le geste — dépôt ou menu — ouvre une saisie, et l'appel
   n'est émis qu'après confirmation.

**Conséquence, et elle est voulue : ce geste n'est pas optimiste.** La card ne bouge pas tant que
le motif n'est pas donné. Déplacer d'abord et demander ensuite montrerait une card à une étape
qu'elle n'a pas atteinte.

**Et le motif est perdu à l'arrivée.** `move_card` le contrôle et ne l'écrit nulle part —
`card_comments` est `CRM-043`, **INC-048**. L'écran ne peut pas le taire : la saisie **dit** que le
motif est exigé pour valider le déplacement et qu'il n'est pas encore conservé. Laisser croire à un
enregistrement serait le mensonge que `CLAUDE.md` §18 proscrit.

### 7.9 Optimisme et retour arrière

`docs/DESIGN_SYSTEM.md` §6 : « le glisser-déposer d'une card est **optimiste**, mais un refus du
backend replace la card à sa position d'origine et affiche la raison du refus. »

| Instant | État de l'écran |
|---|---|
| dépôt sur une colonne atteignable, sans commentaire exigé | la card est **déjà** dans la colonne d'arrivée, en fin de colonne, et marquée « en cours » |
| réponse `200` | la ligne rendue par `move_card` **remplace** la card — étape, `position` et `entered_step_at` viennent du serveur, jamais du client |
| réponse en erreur | la card retrouve **exactement** son étape et sa position d'origine, et la raison est affichée |

**La ligne rendue remplace la card, elle ne la complète pas.** `move_card` recalcule `position` et
`entered_step_at` (§5.4) : les recopier depuis l'état optimiste laisserait l'écran afficher un rang
que la base n'a pas attribué. C'est la raison pour laquelle la fonction rend `public.cards` et non
`void` (§5.2), et le board est le premier appelant à s'en servir.

### 7.10 Les six refus, et ce que l'écran en dit

> « Un refus du backend replace la card et affiche la raison exacte (transition interdite, champs
> manquants avec leur libellé, droit insuffisant). »

Réponses **mesurées** contre la pile réelle, `POST /rest/v1/rpc/move_card`, jeton réel de
l'administratrice :

| `message` | HTTP | `code` | `details` mesuré | Ce que l'écran dit |
|---|---|---|---|---|
| `card_not_found` | `400` | `P0001` | `null` | l'affaire n'est plus accessible ; invite à recharger |
| `forbidden` | `403` | `42501` | `null` | droit d'écriture insuffisant sur ce channel |
| `step_not_in_workflow` | `400` | `P0001` | `null` | l'étape n'appartient pas au workflow de l'affaire |
| `transition_not_allowed` | `400` | `P0001` | `null` | ce déplacement n'est pas déclaré dans le workflow |
| `comment_required` | `400` | `P0001` | `null` | un motif est exigé (ne devrait pas survenir, §7.8) |
| `missing_required_fields` | `400` | `P0001` | `"lien-proposition"` — les **clés**, séparées par `, ` | les **libellés** des champs manquants, résolus par la requête n° 4 |
| `permission denied for function move_card` | `401` | `42501` | `null` | appelant anonyme — le cas de tout visiteur aujourd'hui (INC-021) |

- **Le message est un jeton stable comparé par égalité**, jamais un texte affiché tel quel. C'est le
  contrat que la décision 126 a posé en faisant voyager la liste dans le `DETAIL` plutôt que dans le
  message.
- **Un message inconnu n'est pas absorbé.** L'écran affiche un libellé générique **suivi du message
  brut**. Une valeur par défaut qui cacherait un refus non prévu est précisément ce que
  `CLAUDE.md` §18 interdit, et un refus muet ferait croire à un défaut d'interface.
- **Une clé sans libellé reste la clé.** Si la requête n° 4 a échoué, ou si le champ a été supprimé
  depuis, la clé brute est affichée. Elle est moins lisible qu'un libellé ; elle est vraie.

### 7.11 États systématiques, responsive et accessibilité

- **Les quatre états de `docs/DESIGN_SYSTEM.md` §5.8** : chargement en squelettes de colonnes, board
  vide (« ce channel n'a encore aucune affaire »), colonne vide (message propre à la colonne,
  §5.2), erreur avec action de reprise. Un échec **de l'une quelconque** des quatre requêtes rend
  l'état d'erreur du board entier : afficher des colonnes sans leurs cards, ou des cards sans leurs
  gestes, serait un écran à moitié faux.
- **Le board défile dans son propre conteneur** et la page ne défile jamais horizontalement (§7 du
  design system). Le conteneur porte `.indique-debordement-x` (§12.6), dont la portée annonçait
  nommément « le board (`CRM-041`) ». Sous 768 px, l'ancrage colonne par colonne est obtenu par
  `scroll-snap`.
- **Accessibilité** : les colonnes sont une liste sémantique, chaque colonne étiquetée par son
  libellé ; chaque card est un élément de liste portant un lien vers sa fiche ; le bouton de menu
  et les boutons de transition sont des contrôles ordinaires atteignables par `Tab` ; le résultat
  d'un déplacement — réussite comme refus — est annoncé par une région `aria-live` polie (§8).
- **La couleur ne porte jamais seule l'information** (§1) : le liseré de nœud est doublé du libellé
  de la colonne, et la pastille d'ancienneté d'un texte.

### 7.12 Ce que `CRM-041` ne livre pas, et pourquoi

- **Aucune création, aucune modification, aucune suppression de card** depuis le board. `CRM-040` a
  livré la table et son contrat d'API ; aucun écran d'édition n'existe, et en inventer un dépasserait
  l'unité.
- **Aucun réordonnancement dans une colonne.** Réordonner, c'est réécrire `position` sur plusieurs
  lignes ; il y faut une RPC atomique, que `docs/SPEC-channels.md` §1.2 annonce déjà comme
  nécessaire et qu'aucune unité ne porte. Un réordonnancement écrit ligne à ligne laisserait le
  board dans un ordre arbitraire au premier échec.
- **Aucun changement de channel** : `move_card_to_channel` est `CRM-045` (§6).
- **Aucun avatar de responsable, aucune étiquette** (§7.4).
- **Aucun éditeur de workflow** (§7.1, §7.13).
- **Aucune donnée métier visible en conditions réelles.** L'appelant est anonyme (INC-021) : la
  route rend « track introuvable » et le board ne s'affiche jamais. Ses états chargés se prouvent en
  **substituant la réponse réseau**, procédé endossé par `docs/DESIGN_SYSTEM.md` §12.5, et chaque
  preuve le dit.

### 7.13 Ce qui reste un énoncé d'intention

> « L'éditeur de workflow est réservé aux administrateurs : sélection des nœuds, ordre, arêtes,
> surcharges, et champs de formulaire. »

Cette règle est conservée **intacte** et n'est **pas** livrée par `CRM-041`. `CRM-030` à `CRM-036`
ont livré le catalogue, les workflows, les étapes, les transitions et les champs **sans aucun
écran d'administration**. L'éditeur est désormais porté explicitement par `CRM-076`, encore non
commencée ; le constat historique reste documenté dans `docs/INCONSISTENCY_REPORT.md`, INC-066.

### 7.14 Preuves attendues de `CRM-041`

| Niveau | Preuves |
|---|---|
| Unitaire | Composition des colonnes à partir des **étapes** ; libellé surchargé et non surchargé ; ordre des colonnes et des cards, départage à position égale ; compteur, cumul de montant et son refus en devises mêlées ; index des transitions et ordre du menu ; repli du libellé d'une transition ; seuil d'ancienneté dans ses trois cas — absent, en deçà, au-delà ; correspondance des sept refus, clé sans libellé comprise |
| API | Les **quatre lectures** du §7.2, hors interface, avec le jeton réel de l'administratrice : elles rendent exactement les colonnes et les cards que le board compose. Et le refus de la même lecture à l'anonyme — `200` et `[]` —, qui est la cause de l'écran vide |
| Interface | Le board rendu depuis des réponses substituées : colonnes, cards, colonne vide, menu de transitions et son contenu **exact**, dépôt sur une colonne atteignable, dépôt refusé sans appel émis sur une colonne non atteignable, retour arrière après refus, saisie du motif exigé. Au moins un scénario **sans aucune substitution**, montrant le refus réel du backend à un anonyme |
| Visuel | Captures aux **quatre paliers** de `docs/DESIGN_SYSTEM.md` §7, colonne vide, menu ouvert, card refusée ; **vidéo `.webm`** du glisser-déposer, produite par le harnais et observée |
| Seed | **Étendu ensuite par `CRM-046`, et exercé dans son état courant** : `grands-comptes` porte quatre cards actives sur trois étapes d'un workflow de sept, une archivée et une en corbeille — de quoi démontrer les colonnes occupées, les colonnes vides et l'exclusion des cards rangées |

## 7 bis. Interface : l'éditeur administrateur de workflows — `CRM-076`

La cinquième règle d'origine de `CRM-000` — « L'éditeur de workflow est réservé aux administrateurs :
sélection des nœuds, ordre, arêtes, surcharges, et champs de formulaire » — a traversé sept unités
comme énoncé d'intention (§7.13, INC-066). `CRM-076` la livre. La décision 298 lui a rattaché
l'éditeur complet ; ce chapitre spécifie ce que la **première tranche** livre, et nomme ce qu'elle
ne livre pas.

### 7 bis.1 Ce que l'éditeur est, et ce qu'il n'est pas

L'éditeur est la **composition d'un workflow**, c'est-à-dire le choix des nœuds du catalogue qui en
deviennent les étapes, leur ordre, et leurs surcharges. Il est au graphe ce que `CRM-075` est à
l'arborescence : le seul écran d'où un administrateur configure son produit sans passer par l'API.

Il **n'est pas** :

- **une autorisation.** Comme `CRM-075`, il n'anticipe aucun refus : l'écran envoie, la base
  tranche, et l'écran traduit le refus reçu (`CLAUDE.md` §10). Les politiques du §3.7 réservent déjà
  l'écriture aux administrateurs du workspace, et elles sont prouvées hors interface ;
- **un éditeur de transitions**, ni de champs, ni de règles. Les arêtes et le formulaire sont la
  tranche suivante de `CRM-076` ; ce chapitre les nomme au §7 bis.7 plutôt que de les laisser
  croire livrées ;
- **un créateur de workflow.** Créer un workflow, le copier vers un track et le rendre par défaut
  relèvent de `CRM-031` et `CRM-032`, livrés et prouvés par l'API. L'éditeur compose les workflows
  **existants**.

### 7 bis.2 Adresse, et comment on y arrive

`/reglages/workflows`, hors de `ROUTES` et atteinte depuis l'index des réglages — le patron exact de
`CHEMIN_ADMIN_ARBORESCENCE` (`CRM-075`), pour la même raison : ce n'est pas une entrée de la barre
latérale.

### 7 bis.3 Ce que l'écran lit, et en combien de requêtes

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 1 | `workflows` | aucun — la RLS borne au workspace | `is_default` décroissant, puis `name` | la liste de gauche |
| 2 | `workflow_steps` + `workflow_nodes_catalog` embarqué | `workflow_id=eq.<workflow choisi>` | `position` | les étapes du workflow choisi |
| 3 | `workflow_nodes_catalog` | `archived_at=is.null` | `position`, puis `label` | les nœuds ajoutables |

La lecture 2 embarque le nœud plutôt que de le relire : le libellé affiché est
`label_override` s'il existe, sinon celui du catalogue (§3.3, « une surcharge absente vaut prendre
la valeur du catalogue »). La lecture 3 n'est émise qu'à l'ouverture du sélecteur d'ajout — un
catalogue que personne ne consulte n'a pas à voyager.

### 7 bis.4 Les gestes de cette tranche

| Geste | Écriture | Ce que la base garantit déjà |
|---|---|---|
| **Ajouter une étape** | `INSERT` dans `workflow_steps` | unicité `(workflow_id, node_id)` — un nœud n'apparaît qu'une fois ; `position` attribuée par trigger si omise (§3.3) |
| **Réordonner** | `PATCH position` | l'ordre est une `numeric`, insérable entre deux voisines sans réécrire la suite (`CRM-075`, §6) |
| **Surcharger** | `PATCH label_override`, `probability_override`, `stale_after_days` | non vide après `btrim`, 0 à 100, strictement positif (§3.3) |
| **Retirer une surcharge** | `PATCH` à `NULL` | `NULL` vaut « prendre la valeur du catalogue », et **`0` n'est pas `NULL`** (§2.5, §3.3) |
| **Désigner l'étape initiale** | `PATCH is_initial` | ce que la base peut garantir, et ce qu'elle ne peut pas, est écrit au §3.5 |
| **Retirer une étape** | `DELETE` | `on delete restrict` depuis les cards : une étape occupée n'est pas supprimable, et le refus est celui de la base |

**Aucune de ces règles n'est réécrite dans l'écran.** C'est la contrainte la plus forte de cette
tranche, et elle est vérifiable ligne à ligne : chaque refus traduit vient du §2.5, du §3.3, du §3.5
ou du §3.7. Le module de données réutilise `calculerDeplacement`, `positionEntre` et
`classerRefusEcriture` de `CRM-075` plutôt que d'en écrire des jumeaux — l'ordre d'une étape dans un
workflow et l'ordre d'un channel dans un track sont le même problème.

### 7 bis.5 Validation de forme, et sa seule justification

Comme au §8 de `docs/SPEC-administration-arborescence.md`, l'écran ne valide que ce dont la réponse
est connue d'avance et dont l'erreur reste rattrapée par la base : surcharge de libellé non vide,
probabilité de 0 à 100, ancienneté strictement positive. Elle économise un aller-retour ; elle ne
remplace aucune garde.

### 7 bis.6 États, accessibilité et responsive

Les états de `docs/DESIGN_SYSTEM.md` §5.8 sont tous rendus — chargement, erreur, vide, succès —, un
workflow sans étape dit ce qui manque, chaque geste est atteignable au clavier comme à la souris
(§8), et la console reste vierge.

### 7 bis.7 Ce que cette tranche ne livre PAS, et qui reste dû sous `CRM-076`

- l'édition des **transitions** — arêtes, libellés, motif exigé ;
- l'édition des **champs de formulaire**, de leurs règles et des exigences de transition ;
- la **prévisualisation des effets** qu'exige la Definition of Done de l'unité ;
- la création et la copie d'un workflow, qui restent des gestes d'API (§7 bis.1).

Tant que ces quatre points sont dus, `CRM-076` reste `[~]`. L'unité ne passera à `[x]` qu'avec eux
et avec leurs preuves.

### 7 bis.8 Preuves attendues de `CRM-076`

| Niveau | Preuves |
|---|---|
| Unitaire | Composition de la liste d'étapes depuis les lignes lues ; libellé surchargé et non surchargé ; nœuds ajoutables = catalogue moins les nœuds déjà employés ; validation de forme dans ses trois cas, bornes comprises ; `0` distingué de `NULL` sur les deux surcharges numériques ; correspondance des refus |
| API | Les trois lectures du §7 bis.3 hors interface avec le jeton réel de l'administratrice, et le **refus d'écriture** opposé au viewer sur chacun des six gestes, avec ses véritables droits |
| Interface | Les six gestes joués à la souris **et** au clavier sur la vraie base, chacun confirmé en base après coup ; le refus d'une étape occupée constaté et non simulé |
| Visuel | Captures aux **quatre paliers** de `docs/DESIGN_SYSTEM.md` §7, workflow sans étape, sélecteur d'ajout ouvert, refus affiché |
| Seed | Le workflow par défaut du §3.9 et sa copie dérivée du §4.10 suffisent : sept étapes, un nœud archivé au catalogue, une étape occupée par des cards |

## 8. Vérification exigée

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Transition déclarée acceptée ; transition non déclarée refusée ; commentaire exigé absent refusé ; étape hors workflow refusée ; unicité de l'étape initiale ; refus d'archivage d'un nœud occupé — **livré et prouvé par `CRM-040`**, INC-031 close (§2.6). Champ requis manquant refusé — **livré et prouvé par `CRM-036`**, INC-047 close : la source est `card_field_values`, voir §5.7 et `docs/SPEC-form-composer.md` §6.7 |
| API | Appel direct de `move_card` avec le jeton d'un `viewer` → refusé ; mise à jour directe de `cards.current_step_id` par PostgREST → refusée. Les treize lignes du §5.8 détaillent ce que `CRM-034` mesure |
| E2E | Parcours complet Prospection → Livré par l'interface ; tentative de glisser-déposer interdite ; message d'erreur de champ requis affiché et compréhensible |
| Visuel | Board aux quatre paliers responsive, colonne vide, card figée au-delà du seuil, menu de transitions |

## 9. Points ouverts

1. ~~**Réalisation → Perdu** non déclaré dans le workflow par défaut~~ — **clos** par la
   décision 259 (INC-003). La transition est déclarée, elle exige un commentaire comme les quatre
   autres, et le graphe a été relu en entier à cette occasion (§3.9). Le point est conservé barré
   plutôt que supprimé, pour que la trace du différé reste lisible.
2. **Suppression d'une transition** encore empruntée par des cadences ou des automatisations :
   comportement à définir (refus, ou avertissement).
3. ~~**Le refus d'archivage d'un nœud occupé n'est rattaché à aucune unité livrable**~~ — **clos.**
   `CRM-040` a livré `cards`, dernière table du chemin, et la garde avec elle : INC-031 est close
   (décision 111). Le point est conservé barré plutôt que supprimé, pour que la trace du différé
   reste lisible.
4. **Les cinq transitions vers `Perdu` exigent un commentaire** dans le workflow par défaut du
   seed (§3.9). Choix pris par `CRM-031`, faute d'énoncé d'origine, et renversable : il suffit de
   passer `require_comment` à faux dans le contrat du seed.
5. **Un workflow sans étape initiale est structurellement valide** (§3.5). La base ne peut pas
   exiger « au moins une » sans rendre la création impossible par l'API, ce qui a été mesuré. La
   condition est reportée sur l'emploi du workflow — `CRM-033`, `CRM-040`.
6. **INC-033 est arbitrée et mise en œuvre par `CRM-018`** (§3.4) : l'ancien tableau, qui ne pouvait
   porter aucune intégrité référentielle, est remplacé par une table de liaison à deux clés
   étrangères. La suppression cascade et le refus des croisements de workflows rendent les
   identifiants morts ou étrangers impossibles dans l'état cible.
7. **`move_card` est livrée à SIX vérifications sur six** depuis `CRM-036`. Elle ne conserve
   toujours pas le commentaire qu'elle exige, n'écrit aucun événement et n'arrête aucune cadence :
   §5.11, INC-048, INC-049.
