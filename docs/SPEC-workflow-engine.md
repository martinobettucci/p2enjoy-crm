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

**`derived_from_workflow_id` est une trace, pas un lien de dépendance.** La copie est une
divergence assumée (§4) : le workflow copié vit sa vie. La clé étrangère est donc `on delete set
null` et non `cascade` — supprimer l'original ne doit pas emporter ses copies. Mesuré : la copie
survit à la suppression de son origine, `derived_from_workflow_id` repassant à nul.

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
| `require_fields` | `uuid[]` | non nul, défaut `'{}'` |
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

**`require_fields` ne peut porter aucune intégrité référentielle, et jamais n'en portera.** Mesuré,
et c'est une propriété du type, non un différé : `alter table … add foreign key (require_fields)
references form_fields (id)` échoue en « Key columns "require_fields" and "id" are of incompatible
types: uuid[] and uuid ». PostgreSQL ne sait pas contraindre les éléments d'un tableau. La
suppression d'un champ de formulaire laissera donc des identifiants morts dans ce tableau, que
seul `move_card` (§5) pourra ignorer à la lecture. Écart consigné en
`docs/INCONSISTENCY_REPORT.md`, **INC-033**, avec ses options ; il n'est pas tranché ici.
`form_fields` n'existe de surcroît pas encore — `CRM-035`, mesuré : `to_regclass` nul.

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

**`Réalisation → Perdu` n'est pas déclaré** : une affaire signée qui échoue relève d'un autre
traitement. Le point reste ouvert au §9, comme il l'était.

**Les quatre transitions vers `Perdu` exigent un commentaire.** Ce choix n'était pas écrit dans
l'énoncé d'origine : il est pris ici, et il est justifiable — une affaire perdue sans motif n'est
exploitable par aucune analyse, et c'est la seule transition du graphe dont la raison ne se déduit
pas de l'étape d'arrivée. Il fait de surcroît de `require_comment` une colonne **démontrable** dans
le seed. Le responsable peut le renverser ; le §9 le porte comme point ouvert n° 4.

`require_fields` reste vide partout : `form_fields` n'existe pas (`CRM-035`), et le seed ne
fabrique pas une donnée que le modèle ne sait pas encore produire — même règle que `workflow_id`
laissé nul sur les channels jusqu'à cette unité.

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
| | `derived_from_workflow_id`, `derived_at` | la traçabilité d'origine, renseignée par la fonction |
| | `is_default` | **forcé à faux**, jamais copié |
| | `archived_at` | jamais copié : une copie naît active |
| `workflow_steps` | `node_id`, `position`, les trois surcharges, `is_initial` | à l'identique |
| `workflow_transitions` | `label`, `require_comment`, `require_fields` | extrémités remappées (ci-dessous) |
| champs de formulaire | **non** | `form_fields` n'existe pas — §4.8, INC-037 |

**`is_default` forcé à faux n'est pas une précaution, c'est une nécessité mesurée.** Copier la
colonne telle quelle depuis un workflow par défaut est refusé en `23505` par
`workflows_workspace_default_uk` : au plus un défaut par workspace (§3.2). Or le workflow que l'on
copie est, en pratique, le workflow par défaut. Sans ce forçage, la fonctionnalité échouerait sur
son cas d'emploi principal.

**Les arêtes sont remappées par le nœud, et non par une table de correspondance.** `(workflow_id,
node_id)` est unique (§3.3) : le nœud est donc la **clé naturelle** d'une étape dans son workflow, et
l'étape de la copie qui correspond à une étape de la source est celle qui instancie le même nœud.
Aucune structure temporaire n'est nécessaire, et la propriété se vérifie : mesuré sur la sonde,
**zéro** arête de la copie pointe vers une étape restée dans la source.

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
| `source_modified_at` | le plus récent `updated_at` de la source **et de sa composition** |
| `source_modified_since_copy` | `source_modified_at > derived_at` |

**Ce que ce signal ne voit pas, et c'est mesuré.** Une **suppression** dans la source — une
transition retirée, une étape retirée — ne modifie aucun `updated_at` et laisse donc
`source_modified_since_copy` à faux. La source a pourtant divergé. Le fait est établi par la mesure,
non supposé, et n'est **pas** corrigé ici : le corriger suppose de choisir entre stocker la
composition au moment de la copie, journaliser les suppressions, ou comparer les cardinalités — trois
options qui engagent le schéma. Consigné en `docs/INCONSISTENCY_REPORT.md`, **INC-038**, avec ses
options.

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

### 4.8 Les champs de formulaire ne sont pas copiés, et ne peuvent pas l'être

La Definition of Done de `CRM-032` exige la copie « des étapes, des transitions **et des champs** ».
Les champs de formulaire vivent dans `form_fields`, livrée par `CRM-035` — deux étapes plus loin dans
`docs/MASTER_PLAN.md` §2. Mesuré : `to_regclass('public.form_fields')` rend `NULL`.

Aucune table n'est créée par anticipation : cela préempterait `CRM-035`. La fonction copie ce qui
existe, et `require_fields` — le seul endroit du modèle qui désigne des champs — est copié **tel
quel**, ce qui est correct tant qu'il est vide partout, et le restera après `CRM-035` puisque les
identifiants qu'il porte désignent des champs du **workspace**, que la copie ne change pas.
Contradiction d'ordonnancement consignée en `docs/INCONSISTENCY_REPORT.md`, **INC-037**.

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

Un trigger sur `channels` vérifie que `workflow_id` désigne un workflow `global` du même
workspace **ou** un workflow `track` rattaché au track du channel. Toute autre valeur est
refusée. La même vérification s'applique lors du déplacement d'un channel vers un autre track.

Cette contrainte n'appartient pas à `CRM-032` : elle relève de `CRM-033`, avec la contrainte
`NOT NULL` sur `channels.workflow_id` qu'INC-029 laisse due. `CRM-032` la rend **nécessaire** — un
workflow de portée `track` existe désormais dans le seed, et rien n'empêche encore de le rattacher
à un channel d'un autre track.

## 5. Garde centrale : `move_card`

Toute écriture de `cards.current_step_id` passe par cette fonction. La mise à jour directe de la
colonne est refusée aux clients par les politiques RLS.

```
move_card(card_id uuid, to_step_id uuid, comment text default null)
```

Vérifications, dans l'ordre, chacune levant une exception explicite :

| # | Vérification | Message |
|---|---|---|
| 1 | La card existe et n'est ni archivée ni supprimée | `card_not_found` |
| 2 | L'appelant a le droit d'écriture sur le channel | `forbidden` |
| 3 | L'étape cible appartient au workflow de la card | `step_not_in_workflow` |
| 4 | Une transition est déclarée de l'étape courante vers la cible | `transition_not_allowed` |
| 5 | Le commentaire est fourni si la transition l'exige | `comment_required` |
| 6 | Les champs requis de l'étape cible sont renseignés | `missing_required_fields` (liste des clés) |

En cas de succès : mise à jour de `current_step_id`, réinitialisation de `entered_step_at`,
écriture d'un `card_event` de type `moved`, insertion du commentaire s'il est fourni, arrêt des
cadences de relance si l'étape cible est terminale.

La fonction est `SECURITY DEFINER`, avec `search_path` fixé, accordée au seul rôle
`authenticated`.

## 6. Changement de channel

Une card change de channel — donc potentiellement de workflow — par
`move_card_to_channel(card_id, channel_id, step_mapping)`. Le remappage est **explicite** :
l'appelant fournit l'étape de destination. Si le workflow cible est identique, l'étape est
conservée par défaut. L'opération écrit un `card_event` de type `channel_changed` conservant
l'ancien et le nouveau contexte.

Il n'y a pas de remappage automatique par clé de nœud : deux workflows peuvent partager une clé
sans que le déplacement soit sémantiquement équivalent.

## 7. Interface

- Le board affiche une colonne par étape, ordonnée par `position`.
- Le menu d'actions d'une card liste **exactement** les transitions déclarées depuis son étape
  courante, avec leur libellé.
- Le glisser-déposer vers une colonne non atteignable est refusé visuellement **et** ne déclenche
  aucun appel : la liste des transitions autorisées est connue du client.
- Un refus du backend replace la card et affiche la raison exacte (transition interdite, champs
  manquants avec leur libellé, droit insuffisant).
- L'éditeur de workflow est réservé aux administrateurs : sélection des nœuds, ordre, arêtes,
  surcharges, et champs de formulaire.

## 8. Vérification exigée

| Niveau | Preuves attendues |
|---|---|
| pgTAP | Transition déclarée acceptée ; transition non déclarée refusée ; champ requis manquant refusé ; commentaire exigé absent refusé ; étape hors workflow refusée ; unicité de l'étape initiale ; refus d'archivage d'un nœud occupé — **différé, INC-031** : sa cible traverse `workflow_steps` (`CRM-031`) et `cards` (`CRM-040`), voir §2.6 |
| API | Appel direct de `move_card` avec le jeton d'un `viewer` → refusé ; mise à jour directe de `cards.current_step_id` par PostgREST → refusée |
| E2E | Parcours complet Prospection → Livré par l'interface ; tentative de glisser-déposer interdite ; message d'erreur de champ requis affiché et compréhensible |
| Visuel | Board aux quatre paliers responsive, colonne vide, card figée au-delà du seuil, menu de transitions |

## 9. Points ouverts

1. **Réalisation → Perdu** non déclaré dans le workflow par défaut : à confirmer par le
   responsable.
2. **Suppression d'une transition** encore empruntée par des cadences ou des automatisations :
   comportement à définir (refus, ou avertissement).
3. **Le refus d'archivage d'un nœud occupé n'est rattaché à aucune unité livrable** : INC-031,
   trois options d'arbitrage, à trancher avant `CRM-040`. `CRM-031` en a livré la moitié du
   chemin — `workflow_steps` existe désormais —, `cards` reste due.
4. **Les quatre transitions vers `Perdu` exigent un commentaire** dans le workflow par défaut du
   seed (§3.9). Choix pris par `CRM-031`, faute d'énoncé d'origine, et renversable : il suffit de
   passer `require_comment` à faux dans le contrat du seed.
5. **Un workflow sans étape initiale est structurellement valide** (§3.5). La base ne peut pas
   exiger « au moins une » sans rendre la création impossible par l'API, ce qui a été mesuré. La
   condition est reportée sur l'emploi du workflow — `CRM-033`, `CRM-040`.
6. **`require_fields` ne portera jamais d'intégrité référentielle** (§3.4, INC-033) : PostgreSQL
   ne sait pas contraindre les éléments d'un tableau. La conséquence — des identifiants morts après
   suppression d'un champ — attend un arbitrage.
