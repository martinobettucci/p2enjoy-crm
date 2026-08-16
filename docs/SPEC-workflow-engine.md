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

### 2.6 Archivage — et la garde, livrée depuis `CRM-040`

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

**Les deux paragraphes ci-dessus décrivent l'état du 2026-08-04, et il a cessé d'être vrai.** La
garde **est livrée** : `supabase/migrations/0011_cards.sql` la pose avec la table qui manquait, sous
le nom `workflow_nodes_catalog_refuser_archivage_occupe` (`CRM-040`, `docs/JOURNAL.md` décision 111),
et l'assertion d'absence de `supabase/tests/0006_workflow_nodes_catalog.test.sql` est devenue rouge
ce jour-là, exactement comme elle avait été écrite pour le faire. Le texte d'origine est conservé
parce qu'il porte le motif du différé, non parce qu'il décrit le produit.

**Mesuré le 2026-08-16** sur la pile réelle, avec le jeton de l'administratrice seedée :

```
PATCH /rest/v1/workflow_nodes_catalog?id=eq.<prospection>  {"archived_at": "…"}
=> 403
   {"code":"42501","message":"node_occupied : 4 card(s) active(s) se trouvent encore sur ce nœud"}
```

Le même appel sur un nœud **libre** — `qualification`, qu'aucune étape n'emploie — rend `200` et la
ligne archivée ; le **désarchivage** est accepté sans condition, l'archivage seul étant gardé. Le
compte porté par le message est celui des cards `archived_at is null and deleted_at is null` : une
affaire archivée ou en corbeille n'occupe plus le nœud.

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

**La dernière ligne a cessé d'être vraie le 2026-08-16.** INC-021 est close depuis `CRM-009`, et
l'écran d'administration du catalogue est spécifié au §2 bis ci-dessous. Les preuves d'interface
qu'il apporte sont celles du §2 bis.9, et la Definition of Done de `CRM-030` — « E2E
d'administration » — s'y appuie.

## 2 bis. Interface : l'administration du catalogue de nœuds — `CRM-030`

Le §2.10 posait qu'aucune interface n'était due, pour deux motifs mesurés en août 2026 : la webapp
était un appelant **anonyme** (INC-021) et le catalogue n'avait aucun écran d'où l'administrer.
Le premier motif est tombé avec `CRM-009`, le second n'a jamais été un motif d'absence — c'était
l'absence elle-même. Ce chapitre spécifie l'écran qui la comble, et il est écrit **après mesure**
sur la pile réelle : chaque code et chaque message du §2 bis.5 a été observé le 2026-08-16 avec les
jetons des comptes seedés, jamais supposé.

### 2 bis.1 Ce que l'écran est, et ce qu'il n'est pas

C'est le **vocabulaire d'un workspace**, administré par la seule surface d'où un administrateur
peut le faire sans passer par l'API. Il est au catalogue ce que `CRM-075` est à l'arborescence et
ce que le §7 bis est aux workflows : la troisième surface d'administration du produit, et la
première dont l'objet est une **liste plate**.

Il **n'est pas** :

- **une autorisation.** L'écran envoie, la base tranche, l'écran traduit le refus reçu
  (`CLAUDE.md` §10). Les trois politiques du §2.7 réservent déjà l'écriture aux administrateurs, et
  elles sont prouvées hors interface depuis `CRM-030` ;
- **un éditeur de workflow.** Employer un nœud dans un workflow, l'ordonner, le surcharger : c'est
  le §7 bis. Ici on déclare **quels états ont un nom**, pas dans quel ordre une affaire les
  traverse (§2.1) ;
- **un écran de suppression.** Aucune suppression physique n'est exposée (§2.6), et l'écran ne
  prétend pas le contraire : il n'offre aucune commande de suppression, pas même désactivée.

### 2 bis.2 Adresse, et comment on y arrive

`/reglages/catalogue`, hors de `ROUTES`, atteinte depuis l'index des réglages — le patron exact de
`CHEMIN_ADMIN_ARBORESCENCE` et de `CHEMIN_ADMIN_WORKFLOWS`, pour la même raison : ce n'est pas une
entrée de la barre latérale. Elle est placée **après** les workflows dans l'index, et l'ordre est
un ordre de lecture : on compose un workflow avec des nœuds, mais on découvre l'éditeur avant le
vocabulaire qu'il emploie.

### 2 bis.3 Ce que l'écran lit, et en combien de requêtes

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 1 | `workflow_nodes_catalog` | **aucun** — la RLS borne au workspace | `position`, puis `label` | la liste entière |

**Une seule lecture, et elle rapporte AUSSI les nœuds archivés** — contrairement à la lecture 3 du
§7 bis.3, qui filtre `archived_at=is.null`. La distinction est celle du §5.15 de
`docs/DESIGN_SYSTEM.md` pour les champs archivés : le sélecteur d'ajout d'une étape ne doit pas
proposer un nœud retiré, mais l'écran d'où l'on **restaure** ce nœud doit le montrer, sans quoi le
désarchivage serait introuvable.

**L'écran ne lit PAS l'occupation d'un nœud**, et c'est un choix. Le compte des cards actives par
nœud demanderait une jointure que PostgREST n'expose pas au client, et l'anticiper serait un
contrôle d'interface là où la base en tient déjà un (§2 bis.5, `CLAUDE.md` §10). Le nombre est
d'ailleurs **rendu par le refus lui-même**, mesuré et non deviné.

### 2 bis.4 Les gestes de cette tranche

| Geste | Écriture | Ce que la base garantit déjà |
|---|---|---|
| **Créer un nœud** | `INSERT` | clé conforme au motif du §2.3 et unique par workspace ; libellé non vide ; `kind` et `color` bornés ; `position` attribuée par trigger si omise (§2.4) |
| **Modifier un nœud** | `PATCH label, kind, color, default_probability, default_stale_after_days` | les mêmes contraintes de valeur (§2.5), plus le `WITH CHECK` de la politique de mise à jour (§2.7) |
| **Archiver** | `PATCH archived_at` | la garde `node_occupied` du §2.6 |
| **Désarchiver** | `PATCH archived_at = null` | rien à garder : le désarchivage n'est jamais refusé (§2.6) |

**La clé ne se modifie pas.** Rien dans la base ne l'interdit — c'est une colonne comme une autre —,
mais le §2.1 pose que la comparabilité analytique repose sur elle : la renommer réécrirait
silencieusement l'histoire de toutes les cards passées par ce nœud. L'écran la rend donc en phrase,
selon la règle du §5.15 de `docs/DESIGN_SYSTEM.md` — « une valeur qui ne se modifie plus se rend en
PHRASE, jamais en champ désactivé » —, et nomme la manœuvre de remplacement : archiver ce nœud, en
créer un autre.

**Aucune de ces règles n'est réécrite dans l'écran.** Le module de données réutilise
`classerRefusEcriture`, `slugConforme` et `proposerSlug` de `CRM-075` plutôt que d'en écrire des
jumeaux : la clé d'un nœud et le slug d'un track sont contraints par le **même motif** (§2.3).

### 2 bis.5 Les refus, mesurés le 2026-08-16

| Geste tenté | Profil | Mesuré | Ce que l'écran en dit |
|---|---|---|---|
| `PATCH archived_at` sur un nœud occupé | `admin` | `403`, `42501`, message `node_occupied : 4 card(s) active(s) se trouvent encore sur ce nœud` | « des affaires en cours se trouvent encore sur ce nœud », **avec leur nombre**, et la manœuvre : les déplacer d'abord |
| `POST` d'une clé déjà prise | `admin` | `409`, `23505`, contrainte `workflow_nodes_catalog_workspace_id_key_key` | « cette clé est déjà employée dans cet espace de travail » |
| `POST` d'une clé mal formée | `admin` | `400`, `23514`, contrainte `workflow_nodes_catalog_key_check` | « la forme attendue est … », le champ conservant sa saisie |
| `POST` | `viewer` | `403`, `42501`, `new row violates row-level security policy` | « vous n'avez pas le droit de modifier le catalogue » |
| `PATCH` | `viewer` | **`200` et `[]`** | « la modification n'a pas été appliquée » — jamais un succès |

**Les deux `42501` ne disent pas la même chose, et l'écran ne les confond pas.** Celui de la garde
porte `node_occupied` dans son message ; celui de la RLS porte `row-level security policy`. Les
classer ensemble sous « interdit » ferait lire un refus **rattrapable** — déplacez les affaires —
comme un refus de droit, contre lequel l'utilisateur ne peut rien. Le classement se fait donc sur le
message, et il est le seul endroit du produit où le message d'une exception est lu ; le fait est
nommé ici pour qu'un changement de libellé côté base rende la preuve rouge plutôt que l'écran muet.

La ligne `viewer` / `PATCH` est celle du §2.8 h, et elle est reconduite sans changement : une mise à
jour refusée par le `USING` rend `200` et zéro ligne. `ResultatEcriture` de `CRM-075` porte déjà
l'état `sans-effet` pour ce cas exact ; l'écran l'emploie plutôt que d'inventer un troisième mot.

### 2 bis.6 Validation de forme, et sa seule justification

Comme au §7 bis.5 : l'écran ne valide que ce dont la réponse est connue d'avance et dont l'erreur
reste rattrapée par la base — clé conforme au motif du §2.3, libellé non vide après `btrim`,
probabilité de 0 à 100, seuil de relance strictement positif. Elle économise un aller-retour ; elle
ne remplace aucune garde. Les deux champs numériques sont **facultatifs**, et un champ laissé vide
vaut `NULL`, jamais `0` — la distinction du §2.5, qu'un `Number('')` valant `0` détruirait en
silence.

La clé est **proposée** depuis le libellé par `proposerSlug`, et reste modifiable tant que le nœud
n'existe pas : c'est la commodité du §5.1 de `docs/SPEC-administration-arborescence.md`, jamais une
garantie.

### 2 bis.7 États, accessibilité et responsive

Les quatre états de `docs/DESIGN_SYSTEM.md` §5.8 sont rendus — chargement, erreur avec reprise,
vide, succès —, un catalogue vide dit ce qui manque et offre la création, chaque geste est
atteignable au clavier comme à la souris (§8), et la console reste vierge. Les règles visuelles
sont au §5.18 de `docs/DESIGN_SYSTEM.md`.

### 2 bis.8 Ce que cette tranche ne livre PAS, et qui reste dû sous `CRM-030`

- ~~le **réordonnancement** du catalogue~~ — **LIVRÉ PAR LA TRANCHE SUIVANTE, spécifiée au §2 ter.**
  Le texte d'origine est conservé ci-dessous pour son motif, qui reste exact : « `position` est une
  `numeric` et le geste serait un `PATCH`, mais le §2 le note depuis l'origine — le réordonnancement
  du catalogue n'a pas d'opération atomique. `calculerDeplacement` de `CRM-075` couvrirait le cas
  courant ; il reste à prouver, et il n'est pas livré ici plutôt qu'à moitié. » Il n'est toujours
  pas atomique, et le §2 ter.6 dit exactement ce que cela coûte ;
- la **suppression**, qui n'existe pas dans le produit (§2.6) et n'est donc pas un manque ;
- l'**occupation affichée avant le geste** (§2 bis.3), qui demanderait une lecture que PostgREST
  n'expose pas au client.

### 2 bis.9 Preuves attendues de cette tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Composition de la liste depuis les lignes lues, archivés compris et à leur place ; validation de forme dans ses quatre cas, bornes comprises ; champ numérique vide rendu `NULL` et non `0` ; classement des cinq refus du §2 bis.5, dont la distinction des deux `42501` |
| API | La lecture du §2 bis.3 et les quatre gestes du §2 bis.4 hors interface, avec les jetons réels de l'administratrice et du viewer ; le refus `node_occupied` constaté sur un nœud réellement occupé par le seed |
| Interface | Les quatre gestes joués à la souris **et** au clavier sur la vraie base, chacun confirmé en base après coup ; le refus d'un nœud occupé **constaté et non simulé** ; console vierge |
| Visuel | Captures à 1440 px et à 390 px, liste chargée, formulaire de création ouvert, refus d'archivage affiché |
| Seed | Les huit nœuds du §2.9 suffisent : sept actifs, un archivé, et `prospection` occupée par quatre affaires actives — l'écran a de quoi montrer ses deux états de ligne et son refus sans qu'aucune donnée soit ajoutée |

## 2 ter. Réordonnancement du catalogue — `CRM-030`, dernière tranche

Le §2 bis.8 nommait ce geste comme le seul manque de l'unité. Ce chapitre le spécifie, et il est
écrit **après mesure** sur la pile réelle : chaque code et chaque valeur du §2 ter.4 a été observé
le 2026-08-16 avec les jetons des comptes seedés, sur les huit nœuds du §2.9, positions restituées
ensuite. Rien ici n'est déduit du comportement d'une autre table.

### 2 ter.1 Ce que le geste est, et ce qu'il n'est pas

C'est **une écriture d'une seule colonne sur une seule ligne** : `PATCH position`. L'ordre du
catalogue est celui du §2.4 — une liste unique par workspace, `position` puis `label` —, et le rendre
manœuvrable est ce qui restait dû.

Il **n'est pas** :

- **un glisser-déposer.** Deux commandes, « Monter » et « Descendre », le même patron que
  l'arborescence de `CRM-075` et pour la même raison : un déplacement au clavier doit exister
  (`CLAUDE.md` §22), et une liste plate de huit lignes ne justifie pas le mécanisme de pointage que
  `docs/DESIGN_SYSTEM.md` ne déclare nulle part ;
- **une renumérotation.** La liste entière n'est jamais réécrite. `position` est une `numeric`
  précisément pour qu'un nœud s'insère entre deux autres sans toucher aux voisins (§2.4) ;
- **une transaction.** Le §2 bis.8 le notait, et cela reste vrai : il n'y a pas d'opération atomique
  de réordonnancement. Le §2 ter.6 dit ce que cette absence coûte réellement, mesuré et borné.

### 2 ter.2 Le calcul de la position, et pourquoi il n'est pas réécrit ici

Le module réutilise `calculerDeplacement`, `positionEntre` et `positionAvant` de
`webapp/src/lib/administration-arborescence.ts` (`CRM-075`, `docs/SPEC-administration-arborescence.md`
§8) **sans en écrire de jumeau**. La règle est celle de `CRM-075` : monter, c'est prendre une
position strictement comprise entre l'avant-précédente et la précédente ; descendre, c'est en prendre
une entre la suivante et l'après-suivante ; en queue de liste, `suivante + 1` ; en tête, la moitié de
la première.

Deux façons de se tromper que ces fonctions attrapent déjà, et qui valent ici comme là-bas :

- **les extrémités** — la première ligne ne monte pas, la dernière ne descend pas. Le calcul rend
  `impossible` / `extremite`, la commande est **désactivée et dit pourquoi**, jamais masquée ;
- **les positions indistinctes** — deux nœuds peuvent partager une position, rien en base ne
  l'interdit, et le §2 bis.3 ordonne alors sur `label`. Le milieu de deux bornes égales n'est
  strictement compris entre aucune des deux : le calcul rend `impossible` /
  `positions-indistinctes`, et l'écran le NOMME au lieu d'écrire une valeur sans effet.

### 2 ter.3 Sur quelle liste le calcul porte — les archivés COMPRIS

Le calcul porte sur **la liste affichée**, c'est-à-dire celle du §2 bis.3 : les huit nœuds, archivés
compris, à leur place.

C'est le seul choix qui ne ment pas. Un nœud archivé **reste dans la liste à sa position**
(`docs/DESIGN_SYSTEM.md` §5.18), donc il est visible entre deux actifs ; calculer sur la seule
sous-liste active ferait franchir cette ligne archivée d'un seul clic, ou pire, produirait une
position identique à la sienne — exactement le cas `positions-indistinctes` que le §2 ter.2 écarte.
Ce que l'administrateur voit et ce sur quoi le calcul porte sont la même liste.

**Le nœud archivé, lui, ne se déplace pas.** Ses commandes de réordonnancement ne sont pas rendues,
comme « Modifier » ne l'est pas : le geste n'a aucun effet observable sur un nœud que les sélecteurs
d'étape ignorent déjà (§2 bis.3). C'est la règle de `docs/DESIGN_SYSTEM.md` §5.13 — « renommer et
réordonner disparaissent sur une ligne archivée » —, reprise sans changement. Il reste en revanche
une **voisine** pour le calcul des autres, puisqu'il occupe une place à l'œil.

### 2 ter.4 Contrat d'API, mesuré le 2026-08-16

| # | Appelant | Appel | Mesuré |
|---|---|---|---|
| a | `admin` | `PATCH ?key=eq.relance` `{"position":1.5}` | `200`, la ligne rendue porte `position: 1.5` — la **fraction est conservée**, `numeric` ne l'arrondit pas |
| b | `admin` | `PATCH ?key=eq.prospection` `{"position":2.5}` sur le nœud **occupé par quatre affaires actives** | `200`. **La garde `node_occupied` ne se déclenche PAS** |
| c | `viewer` | `PATCH ?key=eq.negociation` `{"position":99}` | **`200` et `[]`**, et la ligne relue à la clé de service porte toujours `position: 3` |

**La ligne b est la mesure décisive de ce chapitre, et elle n'allait pas de soi.** La garde du §2.6
est un trigger `BEFORE UPDATE` sur toute la table : rien dans son nom ne dit qu'un déplacement y
échappe. Elle ne se déclenche qu'au passage de `archived_at` de `NULL` à une valeur — c'est écrit
dans son corps et c'est le défaut qu'INC-031 redoutait, « une garde qui ferait échouer toute mise à
jour du catalogue ». **Mesuré plutôt que lu** : déplacer `prospection`, que le seed occupe de quatre
affaires actives, rend `200`. Une preuve d'API fige ce fait, sans quoi un resserrement futur de la
garde rendrait le catalogue immobile sans qu'aucune preuve ne l'annonce.

La ligne c est celle du §2.8 h, reconduite sur cette colonne : le `USING` de la politique de mise à
jour filtre la ligne, l'`UPDATE` réussit sur zéro ligne, PostgREST rend `200` et un tableau vide.
`sans-effet` de `ResultatCatalogue` porte déjà ce cas, et l'écran le dit.

### 2 ter.5 Les refus

Aucun refus **nouveau**. Le geste emprunte la politique de mise à jour du §2.7 et
`classerRefusCatalogue` sans y ajouter de nature :

| Cas | Ce que l'écran en dit |
|---|---|
| Le calcul rend `impossible` avant tout appel | l'écran nomme l'impossibilité et **n'écrit rien** — la phrase déjà employée par `CRM-075`, jamais « une erreur est survenue » |
| `200` et `[]` (ligne c) | « la modification n'a pas été appliquée » — l'état `sans-effet`, jamais un succès |
| `42501` de la RLS | « vous n'avez pas le droit de modifier le catalogue » |

`noeud-occupe` **ne peut pas survenir** sur ce geste (§2 ter.4 b). Rien dans le module ne l'exclut
pour autant : le classement reste celui du §2 bis.5, parce qu'un classement qui écarterait d'avance
un refus que la base pourrait un jour rendre serait un contrôle d'interface (`CLAUDE.md` §10).

### 2 ter.6 Ce que l'absence d'opération atomique coûte réellement

Deux limites, bornées, et aucune n'est masquée :

1. **Deux administrateurs qui déplacent en même temps.** La liste est relue après chaque écriture,
   mais le calcul part de la liste affichée : deux déplacements concurrents peuvent produire deux
   positions égales. La conséquence est **un ordre stable mais inattendu** — le §2 bis.3 départage
   alors sur `label` —, jamais une perte de donnée ni une erreur. Le geste suivant sur l'une des deux
   lignes rend `positions-indistinctes` et le dit ;
2. **l'épuisement de la précision.** Insérer sans cesse au même point divise l'intervalle ; après une
   cinquantaine d'insertions au même endroit, le milieu de deux bornes n'est plus strictement compris
   entre elles. `positionEntre` vérifie **le résultat** et non les entrées, ce qui attrape ce cas
   exactement comme l'égalité des bornes. La sortie est un refus nommé, pas une écriture silencieuse
   qui casserait l'ordre. Une renumérotation reste à écrire le jour où le cas s'observe ; il ne s'est
   jamais observé sur un catalogue de huit nœuds.

### 2 ter.7 Preuves attendues de cette tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Le calcul sur une liste de catalogue **archivés compris** ; les deux extrémités ; deux positions égales rendues `positions-indistinctes` ; l'écriture n'envoie **que** `position` et sur **une seule** ligne |
| API | Les trois lignes du §2 ter.4 avec les jetons réels, dont **le déplacement d'un nœud occupé, rendu `200`** ; la ligne du `viewer` relue inchangée à la clé de service |
| Interface | Monter et descendre joués **à la souris et au clavier** sur la vraie base, l'ordre relu en base après coup ; les commandes désactivées aux extrémités, avec leur infobulle ; l'ordre du seed restitué en épilogue ; console vierge |
| Visuel | Une capture de la liste après déplacement, à 1440 px |
| Seed | Les huit nœuds du §2.9 suffisent : leurs positions sont `1` à `8`, entières et distinctes, donc tout déplacement a un milieu strict |

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
| Interface | Livrée par le §3 bis — la **création** d'un workflow depuis l'éditeur d'administration. La ligne d'origine disait « aucune », l'écran d'administration authentifié n'existant pas (INC-021) ; il existe depuis `CRM-009` et `CRM-076`, et l'écart n'a plus de motif |

## 3 bis. Interface : la création d'un workflow — `CRM-031`

L'éditeur de `CRM-076` compose les workflows **existants** : il l'écrit lui-même au §7 bis.1, où
« un créateur de workflow » figure parmi ce qu'il n'est pas, et renvoie la création à `CRM-031`.
Cette tranche livre ce geste, dernier comportement dû par `CRM-031` — sa Definition of Done exige
« E2E de création » et « captures de l'éditeur », et les deux attendaient l'écran.

Ce chapitre est **écrit après mesure** sur la pile réelle, le 2026-08-16, seed appliqué, avec les
jetons réels des trois profils du seed obtenus par la véritable route de connexion. Les codes du
§3 bis.5 sont ces mesures ; les lignes créées pour les obtenir ont été détruites, et le compte des
workflows du seed constaté revenu à deux.

### 3 bis.1 Ce que le geste est, et ce qu'il n'est pas

Créer un workflow, c'est écrire **une ligne dans `workflows`** : un nom, une portée, et le track
que la portée `track` exige. Rien d'autre.

Il **n'est pas** :

- **une composition.** Le workflow naît **vide**, sans étape ni transition. C'est exactement ce que
  le §3.5 appelle un *brouillon* : structurellement valide, inutilisable tant qu'aucune étape
  initiale n'existe. L'écran ne fabrique aucune étape par complaisance — il conduit à l'éditeur, qui
  est fait pour ça ;
- **une copie.** Dupliquer un workflow vers un track est `copy_workflow_to_track` (§4), un geste
  distinct qui remappe des arêtes et pose un lignage. Créer, c'est partir de rien ;
- **une désignation par défaut.** `is_default` n'est pas exposé. Le §3.2 garantit « au plus un vrai
  par workspace » par index unique partiel : offrir la case à la création ferait échouer en `23505`
  tout workspace qui a déjà son défaut — c'est-à-dire le cas normal — pour un réglage qui se prend
  après coup, sur un workflow qu'on a d'abord composé ;
- **une autorisation.** Comme `CRM-075` et `CRM-076`, l'écran n'anticipe aucun refus : il envoie, la
  base tranche, l'écran traduit (`CLAUDE.md` §10). La commande de création est rendue pour tout le
  monde, y compris le `viewer`, dont le refus est mesuré au §3 bis.5.

### 3 bis.2 Où le geste se trouve, et pourquoi il y est deux fois

`/reglages/workflows`, l'écran du §7 bis. Le formulaire est ancré **au-dessus de la liste de
gauche**, dans le flux du document — patron du §5.13 de `docs/DESIGN_SYSTEM.md`, jamais une modale.

Il est rendu **aussi bien quand la liste porte des workflows que quand elle est vide**, et cette
seconde position n'est pas une redondance : c'est le seul cas où le geste est indispensable. Le
§3.2 pose qu'« un workspace neuf n'a aucun workflow » ; l'état vide de l'écran écrit aujourd'hui
« Aucun workflow dans cet espace de travail » et n'offre aucune issue. Un écran d'administration
dont l'état vide est un cul-de-sac est un défaut, pas une sobriété.

### 3 bis.3 Ce que le formulaire demande, et dans quel ordre

| Champ | Contrôle | Obligatoire | Motif |
|---|---|---|---|
| Nom | texte | oui | `name` non vide après `btrim` (§3.2) |
| Portée | liste — « Global » / « Propre à un track » | oui, valeur initiale `global` | `scope`, deux valeurs et pas d'autre |
| Track | liste des tracks du workspace | **seulement si** la portée vaut `track` | la cohérence de portée du §3.2 |

La liste des tracks est une **quatrième lecture** de l'écran, `tracks?select=id,name&order=position`,
émise à l'ouverture du formulaire et non au chargement de l'écran — même règle que la lecture 3 du
§7 bis.3 : un catalogue que personne ne consulte n'a pas à voyager. La RLS la borne au workspace ; il
n'y a donc **aucun filtre `workspace_id`** dans la requête, et l'écrire laisserait croire que la
lecture est protégée par lui.

Le sélecteur de track n'est **rendu que sous la portée `track`**. Ce n'est pas un champ désactivé :
sous la portée `global` il n'a aucun sens, et la règle du §5.15 vaut — une valeur qui n'existe pas
se nomme, elle ne se grise pas. Basculer de `track` à `global` **oublie** le track choisi, de sorte
qu'un `track_id` résiduel ne parte jamais avec une portée `global`, ce que le §3.2 refuse.

Le `workspace_id` envoyé n'est **pas saisi** : il est celui du workspace courant, lu comme
`AdministrationArborescence` le lit (`lireWorkspaces`). Le laisser saisir offrirait un champ dont
toute autre valeur est refusée en `42501` — mesuré au §3 bis.5.

### 3 bis.4 Validation de forme, et sa seule justification

Comme au §7 bis.5, l'écran ne valide que ce dont la réponse est connue d'avance et dont l'erreur
reste rattrapée par la base :

- **nom non vide après `btrim`** — la commande reste désactivée tant qu'il l'est ;
- **track choisi lorsque la portée vaut `track`** — même règle.

Elle économise un aller-retour ; elle ne remplace aucune garde. Tout le reste part et se fait
refuser.

### 3 bis.5 Les refus, mesurés le 2026-08-16

| Situation | Profil | Mesure |
|---|---|---|
| Création `global` valide | `admin` | `201`, `is_default` faux, `track_id` nul, `position` sans objet |
| Création `track` valide | `admin` | `201`, `track_id` renseigné |
| Création | `business_developer` | `403`, `42501`, `new row violates row-level security policy for table "workflows"` |
| Création | `viewer` | `403`, `42501`, même message |
| `scope = 'track'` sans `track_id` | `admin` | `400`, `23514`, contrainte `workflows_scope_track_check` |
| `scope = 'global'` avec `track_id` | `admin` | `400`, `23514`, même contrainte |
| Nom vide ou blanc | `admin` | `400`, `23514`, contrainte `workflows_name_check` |
| Track d'un autre workspace | `admin` | `409`, `23503`, clé `workflows_track_id_workspace_id_fkey` |
| `workspace_id` étranger | `admin` | `403`, `42501` — c'est le `WITH CHECK` |
| `is_default` vrai alors qu'un défaut existe | `admin` | `409`, `23505`, index `workflows_workspace_default_uk` |

**Un nom déjà porté par un autre workflow est ACCEPTÉ — `201`, mesuré.** Aucune unicité ne porte sur
`name`, et le §3.2 n'en demande aucune : deux workflows homonymes sont un choix d'administration,
pas une faute. L'écran ne l'invente donc pas, et cette mesure est figée par une preuve — sans elle,
une unicité ajoutée un jour passerait inaperçue jusqu'au premier refus en production.

**Les deux dernières lignes du tableau ne sont pas atteignables depuis l'écran**, et c'est pour
cela qu'elles y figurent : le `workspace_id` n'est pas saisi (§3 bis.3) et `is_default` n'est pas
exposé (§3 bis.1). Elles sont mesurées par la preuve d'API, qui contourne l'interface comme
`CLAUDE.md` §10 l'exige, et non par un scénario d'écran qui ne pourrait pas les produire.

**La correspondance des refus réutilise `classerRefusEcriture` de `CRM-075`**, et n'en écrit pas de
jumeau. Trois natures y sont déjà rangées et suffisent : `forbidden` pour `42501`, `forme-refusee`
pour `23514`, `reference-absente` pour `23503`. Le `23505` de l'index partiel n'est pas atteignable
depuis l'écran ; il n'y reçoit donc aucune traduction propre, et le classement générique le
couvrirait si la base venait à l'opposer.

### 3 bis.6 Ce que l'écran fait après un succès

Trois effets, dans cet ordre, et aucun n'est décoratif :

1. **la liste est relue**, non complétée localement — la relecture est la seule chose qui prouve que
   la ligne existe côté base, et l'ordre `is_default` décroissant puis `name` de la lecture 1 du
   §7 bis.3 place le nouveau workflow là où il doit être, ce qu'une insertion optimiste ne saurait
   pas faire ;
2. **le workflow créé devient le workflow choisi**, et ses blocs se chargent. C'est ce qui rend le
   brouillon du §3.5 immédiatement composable : créer puis chercher son objet dans une liste serait
   un geste inachevé ;
3. **le formulaire se referme et l'annonce est faite** dans la `LiveRegion` de l'écran, comme tout
   geste de cette surface.

Un workflow neuf n'a **aucune étape** : le bloc des étapes rend alors son état vide, déjà écrit
(« Ce workflow n'a aucune étape »), et le §3.5 est ainsi montré plutôt que raconté.

### 3 bis.7 États, accessibilité et responsive

Les états de `docs/DESIGN_SYSTEM.md` §5.8 s'appliquent sans exception. Le formulaire vit dans le
flux, le focus entre dans son premier champ à l'ouverture, la commande d'envoi porte son état
d'attente, et l'alerte de refus est rendue **dans le bloc du formulaire** — le patron du §5.13, et
la correction faite à `AdministrationArborescence` après un refus calculé, correct et invisible.
La console reste vierge.

### 3 bis.8 Preuves attendues de cette tranche

| Niveau | Preuves |
|---|---|
| Unitaire | La composition de l'insertion : `track_id` nul sous la portée `global` et renseigné sous `track` ; le nom `btrim`é ; la validation de forme dans ses deux cas, bornes comprises ; la correspondance des refus `42501`, `23514` et `23503` |
| Composant | L'**état vide de la liste porte le geste** — c'est le cas du §3 bis.2 que l'écran seul peut montrer, la table du seed n'étant jamais vide. Il se prouve par le test de composant, avec une lecture rendue vide, et non en vidant une table que tout le reste du seed emploie |
| API | Les dix lignes du §3 bis.5 hors interface, avec les jetons réels des trois profils, chaque refus **relisant** la table pour constater qu'aucune ligne n'a été écrite ; le nom homonyme accepté |
| Interface | Le parcours de création joué à la souris **et** au clavier sur la vraie base, la ligne **confirmée en base** après coup ; la bascule de portée qui fait apparaître le sélecteur de track ; le workflow créé devenu le workflow choisi, son bloc d'étapes vide |
| Visuel | Captures aux quatre paliers de `docs/DESIGN_SYSTEM.md` §7, formulaire ouvert sous les deux portées, et le workflow neuf choisi montrant son bloc d'étapes vide |
| Seed | Aucun ajout : le workspace du seed porte déjà deux workflows, dont un dérivé, et le formulaire n'a besoin d'aucune donnée nouvelle. La preuve d'interface crée ses propres lignes sous un nom préfixé `e2e-workflow-` et les **purge dans son `finally`** par la clé de service — la règle d'INC-099 et de la décision 362, sans laquelle deux workflows résiduels rendraient rouges les assertions de compte de `supabase/tests/0007_workflows.test.sql` |

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

- l'édition des **transitions** — arêtes, libellés, motif exigé ; **livrée par la deuxième
  tranche, spécifiée au §7 bis.9** ;
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

### 7 bis.9 Deuxième tranche : l'édition des transitions

Le §7 bis.7 nommait quatre manques. Celui-ci en lève le premier : les **arêtes** du graphe, leur
**libellé** et le **motif exigé**. Les trois autres restent dus, et l'unité reste `[~]` tant qu'ils
le sont.

Cette tranche ne touche NI au modèle, NI aux autorisations : `workflow_transitions` existe depuis
`CRM-031` avec ses contraintes (§3.4) et ses politiques (§3.7), et elle est déjà prouvée en pgTAP
par `CRM-040`. Ce qui manquait était l'écran. **Aucune migration n'est écrite.**

#### 7 bis.9.1 Ce que la deuxième tranche lit

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 4 | `workflow_transitions` | `workflow_id=eq.<workflow choisi>` | `from_step_id`, puis `to_step_id` | les arêtes du workflow choisi |

Une seule lecture s'ajoute aux trois du §7 bis.3, et elle est émise **avec** la lecture des étapes :
un graphe dont on montrerait les nœuds sans les arêtes serait à moitié faux, et l'administrateur
n'a pas à demander la seconde moitié.

L'ordre de la requête est celui des **identifiants**, pas celui du graphe : PostgREST ordonne sur
des colonnes de la table, et `workflow_transitions` ne porte pas la position des étapes. L'ordre
lisible — les arêtes groupées par étape de départ, dans l'ordre du graphe — est donc **composé par
l'écran** à partir des étapes déjà lues, par une fonction `grouperTransitions` prouvée
unitairement. Un tri d'identifiants n'est pas un ordre pour un humain ; c'est un ordre stable, ce
qui suffit à la requête.

Les deux extrémités sont rendues par le **libellé d'étape** du §7 bis.3 — surcharge si elle existe,
catalogue sinon — et non par leur identifiant. `libelleEtape` est réutilisée telle quelle : une
arête qui nommerait ses étapes autrement que la liste juste au-dessus décrirait un autre graphe.

#### 7 bis.9.2 Les trois gestes de cette tranche

| Geste | Écriture | Ce que la base garantit déjà |
|---|---|---|
| **Déclarer une arête** | `INSERT` dans `workflow_transitions` | unicité `(workflow_id, from_step_id, to_step_id)` ; `from_step_id <> to_step_id` ; les deux clés composites interdisent de sortir du workflow (§3.4) |
| **Modifier une arête** | `PATCH label`, `require_comment` | `label is null or btrim(label) <> ''` (§3.4) |
| **Retirer une arête** | `DELETE` | rien ne la retient : **aucune card ne référence une transition**, contrairement à une étape |

**Retirer une arête n'a pas de refus métier, et c'est une différence à écrire plutôt qu'à
supposer.** Le `on delete restrict` qui protège une étape occupée vient de `cards.current_step_id`
(§3.3) ; aucune colonne de `cards` ne désigne une transition. Le seul refus possible sur un retrait
d'arête est donc celui de la politique — un non-administrateur —, et l'écran ne doit pas promettre
à l'administrateur un obstacle qui n'existe pas. La confirmation avant retrait est **conservée**
malgré cela : une arête retirée est une porte fermée dans le parcours des cards, et le geste est
irréversible en un clic.

**Le motif exigé est un `boolean`, pas un texte.** `require_comment` dit que `move_card` refusera
le déplacement sans commentaire (§5) ; il ne dit pas lequel. L'écran l'expose en case à cocher, et
son aide nomme l'effet réel sur le parcours plutôt que la colonne.

**`label` vide vaut `NULL`, comme toute surcharge.** Le §3.4 le déclare facultatif : à défaut,
l'interface d'une card affiche le libellé de l'étape d'arrivée (§7). Un champ vidé envoie donc
`null` — la même règle que les surcharges du §7 bis.4, pour la même raison : `''` serait refusé par
le `CHECK`, et omettre la clé rendrait le retrait impossible depuis l'écran.

#### 7 bis.9.3 Ce que l'écran filtre, et pourquoi ce n'est pas une garde

Le sélecteur de déclaration propose une étape de départ et une étape d'arrivée. Il en retire deux
choix :

1. **l'étape de départ elle-même** dans la liste d'arrivée — le `CHECK from_step_id <> to_step_id`
   la refuserait ;
2. **les arrivées déjà déclarées depuis ce départ** — l'unicité les refuserait.

Ces deux filtres sont l'exact équivalent du filtre des nœuds déjà employés du §7 bis.4 : ils
évitent d'offrir un choix dont la réponse est connue, ils ne remplacent aucune garde, et la base
tranche de toute façon (`CLAUDE.md` §10). Lorsqu'une étape de départ n'a plus aucune arrivée
possible, le formulaire le **dit** au lieu de présenter une liste vide.

**Un workflow de moins de deux étapes ne peut porter aucune arête**, et l'écran l'annonce plutôt
que d'ouvrir un formulaire dont les deux listes seraient inutilisables.

#### 7 bis.9.4 Validation de forme

Une seule, dans le même esprit que le §7 bis.5 : un libellé **fourni** n'est pas blanc. Les deux
étapes sont choisies dans des listes, donc jamais absentes ni malformées ; `require_comment` est un
booléen. Il n'y a rien d'autre dont la réponse soit connue d'avance.

#### 7 bis.9.5 Les refus, et celui qui change de sens

Les natures sont celles du §7 bis.4, à deux exceptions près qui viennent de ce que la table
garantit :

- `23505` est ici **« cette arête est déjà déclarée »** et non « ce nœud est déjà une étape » ;
- `23503` ne peut plus vouloir dire « étape occupée » sur un retrait, puisque rien ne retient une
  arête : il redevient uniformément « une des deux étapes n'existe plus », ce qui est exactement ce
  qu'un administrateur voit lorsqu'un autre a retiré l'étape entre-temps.

Le `CHECK` de la réflexivité et celui du libellé blanc partagent le SQLSTATE `23514` et sont tous
deux rendus par `forme-refusee`, comme au §7 bis.4 : le message nomme les deux causes possibles
plutôt que d'en deviner une.

#### 7 bis.9.6 États, accessibilité et responsive

Les arêtes sont un **second bloc** sous la liste des étapes, dans la même colonne : elles décrivent
le même workflow et se lisent après ses étapes, pas à côté. Le bloc rend les quatre états du
§5.8 du design system, un workflow sans arête dit ce que cela signifie pour ses cards, chaque geste
est atteignable au clavier comme à la souris, et la console reste vierge.

#### 7 bis.9.7 Preuves attendues de la deuxième tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Groupement des arêtes par étape de départ dans l'ordre du graphe ; arête dont une extrémité a disparu de la liste des étapes ; arrivées possibles = étapes moins le départ moins les arrivées déjà déclarées ; libellé fourni blanc refusé, libellé vide valant `NULL` ; correspondance des refus, `23505` et `23503` compris |
| Interface | Les trois gestes joués à la souris **et** au clavier sur la vraie base, chacun confirmé en base après coup ; le refus d'une arête déjà déclarée constaté et non simulé |
| Visuel | Captures aux **quatre paliers** de `docs/DESIGN_SYSTEM.md` §7, workflow sans arête, formulaire de déclaration ouvert |
| Seed | Le workflow par défaut du §3.9 suffit. **Mesuré sur la pile, 2026-08-14** : sept étapes, **onze** arêtes dont **cinq** à motif exigé, et deux étapes sans sortie — `Livré` et `Perdu`. Le workflow dérivé du §4.10 porte le même graphe |

### 7 bis.10 Troisième tranche : l'édition des champs de formulaire

Le §7 bis.7 nommait quatre manques ; la deuxième tranche en a levé un. Celui-ci lève la **moitié**
du deuxième : les **champs** du formulaire d'un workflow — leur déclaration, leur libellé, leur
aide, leurs options, leur ordre et leur archivage. La seconde moitié — la **grille champ × étape**
des règles de visibilité (`docs/SPEC-form-composer.md` §3.1 et §5) — reste due, ainsi que la
prévisualisation des effets. L'unité reste `[~]` tant qu'elles le sont.

Comme la deuxième tranche, celle-ci ne touche NI au modèle NI aux autorisations :
`form_fields` existe depuis `CRM-035` avec ses contraintes (`docs/SPEC-form-composer.md` §2.2, §2.4)
et ses politiques (§2.7), déjà prouvées en pgTAP. Ce qui manquait était l'écran, et l'écran seul.
**Aucune migration n'est écrite.**

#### 7 bis.10.1 Ce que la troisième tranche lit

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 5 | `form_fields` | `workflow_id=eq.<workflow choisi>` | `position` | les champs du formulaire du workflow choisi |

**Les champs archivés SONT rapportés**, à la différence du catalogue de nœuds de la lecture 3 qui
exclut les siens côté serveur. La différence n'est pas une inconstance : un nœud archivé n'est plus
**ajoutable**, et la lecture 3 sert précisément à offrir un choix ; un champ archivé, lui, est le
seul état que le produit connaisse pour « retiré » — aucun privilège `DELETE` n'existe (§2.7 du
composeur, **mesuré ci-dessous**). Le masquer rendrait le geste de restauration inatteignable et
laisserait croire à une suppression qui n'a pas eu lieu.

La lecture est émise **avec** celles des étapes et des arêtes, pour la même raison qu'au §7 bis.9.1 :
les trois décrivent le même workflow, et toute écriture de l'un des trois blocs les rejoue toutes.

#### 7 bis.10.2 Les cinq gestes de cette tranche

| Geste | Écriture | Ce que la base garantit déjà |
|---|---|---|
| **Déclarer un champ** | `INSERT` dans `form_fields`, `position` **omise** | unicité `(workflow_id, key)` ; forme de la clé ; `type` dans la liste des quinze ; `options` objet ; `choices` non vide pour `select`/`multiselect` ; `currency` pour `money` |
| **Modifier un champ** | `PATCH label`, `help_text`, `options` | libellé non vide, aide non vide si fournie, mêmes contraintes d'options |
| **Réordonner** | `PATCH position` | `position` est un `numeric` où l'on insère entre deux voisines — `calculerDeplacement` de `CRM-075`, comme les étapes |
| **Archiver** | `PATCH archived_at` à l'instant courant | rien : la colonne est libre, l'archivage n'est refusé par aucune garde |
| **Restaurer** | `PATCH archived_at` à `NULL` | idem |

**Aucun geste de suppression n'est offert, et ce n'est pas un oubli.** MESURÉ sur la pile le
2026-08-14 : `DELETE /form_fields` avec le jeton réel de l'administratrice rend **`403` / `42501`**,
avec le `hint` « Grant the required privileges […] GRANT DELETE ON public.form_fields ». Le §2.7 du
composeur l'annonçait ; c'est désormais constaté. Un écran qui offrirait le geste ne produirait
qu'un refus que l'administrateur ne peut pas lever, et effacerait — s'il aboutissait — des valeurs
déjà saisies par les équipes.

#### 7 bis.10.3 Ce que l'écran ne modifie PAS, et pourquoi c'est mesuré et non supposé

Deux colonnes sont écrites à la déclaration et **jamais** ensuite, alors que la base accepte de les
modifier. Chacune est un choix motivé, pas une limite technique.

**La clé.** MESURÉ : `PATCH /form_fields {"key": …}` rend `200` et la ligne modifiée. L'écran ne
l'offre pourtant pas. Le §2.5 du composeur fait de `key` l'identifiant **durable** : celui qu'un
export, un filtre de vue sauvegardée et les messages d'erreur de `move_card` nomment. La renommer
réécrit rétroactivement le sens de tout ce qui la cite, sans qu'aucune erreur ne le signale. Un
champ dont la clé est mauvaise s'archive et se redéclare — deux gestes visibles plutôt qu'une
mutation silencieuse.

**Le type.** MESURÉ, et c'est la mesure décisive de cette tranche :

1. un champ `text` reçoit la valeur `"une chaîne"` sur une card réelle — `201` ;
2. `PATCH /form_fields {"type": "number"}` sur ce même champ — **`200`**, la base accepte ;
3. la valeur `"une chaîne"` est **toujours en base**, inchangée : le trigger de validation du
   §6.4 du composeur porte sur `card_field_values`, il ne revisite aucune ligne existante ;
4. réécrire **la même valeur** est alors refusé — `P0001`, `invalid_field_value`, détail
   « sonde-type attend un nombre, reçu string ».

Autrement dit, changer le type d'un champ déjà rempli laisse en base des valeurs que le produit
refuse désormais d'écrire, lisibles mais non réenregistrables, sans qu'aucun écran ne le dise. La
conversion des valeurs existantes est un **plan de remappage**, exactement ce que `CRM-078` porte
pour les workflows. Offrir le changement de type ici livrerait la moitié destructrice d'une
fonctionnalité dont l'autre moitié n'existe pas. L'écran écrit le type à la déclaration et l'affiche
ensuite en lecture seule, en nommant le motif à l'utilisateur.

#### 7 bis.10.4 Validation de forme, et la seule qui ne soit pas un raccourci

Le §7 bis.5 pose la règle : l'écran ne valide que ce dont la réponse est connue d'avance et dont
l'erreur reste rattrapée par la base. Cinq contrôles en relèvent, tous adossés à un `CHECK` mesuré :

| Contrôle | `CHECK` correspondant | Refus mesuré sans lui |
|---|---|---|
| clé au motif `^[a-z0-9]+(-[a-z0-9]+)*$` | `form_fields_key_check` | `23514` |
| libellé non vide après `btrim` | `form_fields_label_check` | `23514` |
| aide non vide si fournie | `form_fields_help_text_check` | `23514` |
| `select`/`multiselect` : au moins un choix | `form_fields_choices_check` | `23514` |
| `money` : devise `^[A-Z]{3}$` | `form_fields_currency_check` | `23514` |

**Le sixième contrôle n'est PAS un raccourci, et c'est le seul de tout cet écran dans ce cas :
l'unicité des clés de choix et la forme `{key, label}` de chaque entrée.** Le §2.4 du composeur
l'annonce — un `CHECK` ne peut porter aucune sous-requête ni déplier un tableau `jsonb` — et la
mesure le confirme : un `select` déclaré avec **deux choix de clé `a`** est accepté, `201`. Rien
en base ne l'arrête. Ici l'écran n'économise pas un aller-retour, il tient une règle que personne
d'autre ne tient, et sa preuve unitaire est la seule garantie du produit. Ce que cela **ne** rend
pas, il faut l'écrire : une clé de choix dupliquée écrite par l'API directement reste possible, et
seule la validation des valeurs (§6.5 du composeur) en subira la conséquence.

**Un champ `select` naît avec au moins un choix**, conséquence assumée au §2.4 : la question et ses
réponses partent du même formulaire, en une seule écriture.

#### 7 bis.10.5 Les refus

Les natures reprennent celles du §7 bis.4, avec le vocabulaire du formulaire :

- `23505` est **« cette clé est déjà prise dans ce workflow »** — mesuré sur `budget` ;
- `23514` est `forme-refusee`, et il recouvre **six** `CHECK` distincts : clé, libellé, aide, type
  hors liste, `options` non objet, options manquantes de `select` ou de `money`. Le message nomme
  les causes plutôt que d'en deviner une, comme au §7 bis.9.5 ;
- `23503` reste « le workflow a disparu, ou n'appartient pas à ce workspace » : aucun retrait
  n'existe ici, donc aucune lecture « occupée » de ce code n'est possible — même raisonnement
  qu'au §7 bis.9.5, et même absence de paramètre `geste` ;
- `200` avec **zéro ligne** est `sans-effet`. MESURÉ : `PATCH /form_fields` avec le jeton réel du
  `business_developer` rend `200` et `[]` — le `USING` de la politique filtre la ligne avant la
  mise à jour, sans lever d'erreur (§2.8 du composeur, ligne h).

#### 7 bis.10.6 États, accessibilité et responsive

Les champs sont un **troisième bloc**, sous les arêtes et dans la même colonne : on ne dessine pas
le formulaire d'un workflow avant d'en avoir posé les étapes et les chemins. Le bloc rend les quatre
états du §5.8 du design system ; un workflow sans champ dit ce que cela signifie pour ses cards ;
un champ archivé est **nommé comme tel** et non grisé en silence ; chaque geste est atteignable au
clavier comme à la souris ; la console reste vierge. Le §5.15 du design system porte les règles
visuelles.

#### 7 bis.10.7 Ce que cette tranche ne livre pas

- la **grille champ × étape** des règles de visibilité (`docs/SPEC-form-composer.md` §3.1, §5) ;
- les **exigences de transition** (`docs/SPEC-transition-required-fields.md`) ;
- la **prévisualisation des effets** exigée par la Definition of Done de `CRM-076` ;
- la **modification du type** d'un champ, qui suppose le plan de remappage de `CRM-078` (§7 bis.10.3).

#### 7 bis.10.8 Preuves attendues de la troisième tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Lecture 5 émise avec ses colonnes et son ordre ; champs archivés conservés dans la liste ; validation de forme dans ses six cas — clé, libellé, aide, choix, devise, **et l'unicité des clés de choix que la base n'assure pas** ; `options` composé selon le type ; correspondance des refus, `23505` et `23514` compris |
| Interface | Les cinq gestes joués à la souris **et** au clavier sur la vraie base, chacun confirmé en base après coup ; le refus d'une clé déjà prise constaté et non simulé |
| Visuel | Captures aux **quatre paliers** de `docs/DESIGN_SYSTEM.md` §7, formulaire de déclaration ouvert, champ archivé visible |
| Seed | Le formulaire du workflow par défaut suffit. **Mesuré sur la pile, 2026-08-14** : **sept** champs de positions 1 à 7, dont **un archivé** — `budget-previsionnel` —, six types distincts, `budget` portant sa devise et `source` ses quatre choix |

### 7 bis.11 Quatrième tranche : la grille champ × étape des règles de visibilité

Le §7 bis.10.7 nommait quatre manques ; celui-ci en lève un, et c'est la **seconde moitié** du
deuxième : les **règles de visibilité** que `docs/SPEC-form-composer.md` §3.1 pose et dont le §5 du
même document exige qu'elles se règlent « en un seul écran, plutôt que champ par champ ». Les
exigences de transition et la prévisualisation des effets restent dues ; l'unité reste `[~]`.

Comme les deux tranches précédentes, celle-ci ne touche NI au modèle NI aux autorisations :
`form_field_rules` existe depuis `CRM-035` avec ses trois clés composites, son `CHECK` de valeur et
ses quatre politiques, déjà prouvés en pgTAP. Ce qui manquait était l'écran. **Aucune migration
n'est écrite.**

#### 7 bis.11.1 Ce que la quatrième tranche lit

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 6 | `form_field_rules` | `workflow_id=eq.<workflow choisi>` | `field_id`, `step_id` | les règles de visibilité du workflow choisi |

L'ORDRE DEMANDÉ EST CELUI DES IDENTIFIANTS, pour la raison exacte de la lecture 4 (§7 bis.9.1) :
la table ne porte ni la position d'un champ ni celle d'une étape, donc aucun tri lisible ne peut
être demandé au serveur. Il n'en a pas besoin — la grille n'est jamais parcourue dans l'ordre des
règles, elle est **indexée** par le couple (champ, étape) et son ordre vient des deux listes déjà
lues.

La lecture est émise **avec** celles des étapes, des arêtes et des champs, par le §7 bis.10.1 : une
règle n'a de sens qu'entre un champ et une étape du même instant, et toute écriture des quatre
blocs les rejoue toutes.

#### 7 bis.11.2 La composition, qui ne part JAMAIS des règles

Le §3.1 du composeur pose la règle de lecture et en donne le motif : « le formulaire d'une étape ne
se lit **jamais** en listant les règles de cette étape, mais en listant les **champs du workflow**
puis en appliquant les règles trouvées ». La grille est le même algorithme, en deux dimensions :

1. les **lignes** sont les champs **non archivés**, dans l'ordre de leur `position` ;
2. les **colonnes** sont les étapes, dans l'ordre du graphe — celui de la lecture 2 ;
3. la **cellule** est la règle du couple si elle existe, et **le défaut sinon**.

Une grille composée depuis les règles perdrait toutes les cases par défaut, c'est-à-dire la
majorité : MESURÉ sur le seed le 2026-08-15, le workflow par défaut porte **quinze** règles pour
**six** champs actifs × **sept** étapes, soit quarante-deux couples — vingt-sept cases sont donc des
défauts, et une lecture par les règles n'en montrerait aucune.

**Les champs ARCHIVÉS sont exclus des lignes, à la différence de la liste du §7 bis.10.1.** Ce n'est
pas une inconstance de plus : la liste des champs sert à **restaurer** un champ archivé, et l'y
masquer rendrait le geste inatteignable ; la grille, elle, décrit ce qu'un formulaire montre, et un
champ archivé n'apparaît dans aucun formulaire (`docs/SPEC-form-composer.md` §5). Lui donner sept
cases réglables ferait croire à un effet qui n'existe pas. Ses règles **ne sont pas supprimées** —
MESURÉ le 2026-08-15, la base accepte une règle sur un champ archivé (`201`) et l'archivage n'en
efface aucune — et elles redeviennent effectives dès sa restauration. L'écran écrit combien de
champs sont ainsi retirés de la grille, plutôt que de laisser un administrateur chercher une ligne
absente.

#### 7 bis.11.3 Les deux gestes, et pourquoi le premier est un `upsert`

| Geste | Écriture | Ce que la base garantit déjà |
|---|---|---|
| **Régler une case** sur `hidden`, `visible` ou `required` | `POST` avec `Prefer: resolution=merge-duplicates` | `CHECK visibility IN ('hidden','visible','required')` ; les trois clés composites du §3.3 du composeur |
| **Rendre une case au défaut** | `DELETE` sur le couple `(field_id, step_id)` | la politique de suppression, ouverte aux règles et refusée aux champs (décision 96) |

**Le réglage est UNE écriture, pas « insérer si absente, sinon modifier », et c'est mesuré.**
Le 2026-08-15, sur la pile seedée :

1. `POST` d'une règle absente → **`201`** ;
2. `POST` du **même couple** avec `Prefer: resolution=merge-duplicates` → **`200`**, la ligne est
   remplacée ;
3. `POST` du même couple **sans** cette résolution → **`409`**, `23505`,
   « duplicate key value violates unique constraint "form_field_rules_pkey" » ;
4. `PATCH` du même couple → `200`.

Un écran qui choisirait entre `POST` et `PATCH` d'après ce qu'il a lu prendrait donc le `409` dès
qu'un autre administrateur a réglé la même case entre la lecture et le clic — un refus que
l'utilisateur n'a pas provoqué et ne peut pas comprendre. L'`upsert` n'est pas une commodité :
c'est la seule des quatre formes qui soit **indifférente à l'état lu**, et la clé primaire
`(field_id, step_id)` du §3.2 est précisément ce qui la rend possible.

**Le retour au défaut est un `DELETE`, et il n'a pas d'équivalent ailleurs dans cet éditeur.** Un
champ ne se supprime pas — aucun privilège `DELETE` (§7 bis.10.2) —, une règle si : la décision 96
l'écrit dans la migration elle-même, « une règle est la composition d'un formulaire, sans existence
propre ». MESURÉ : `DELETE` par l'administratrice rend `200` et la ligne retirée.

#### 7 bis.11.4 Les QUATRE états d'une case, et pourquoi `visible` n'est pas replié sur le défaut

Le §3.1 du composeur donne trois visibilités et fait de **l'absence de règle** un quatrième état,
qui vaut `visible`. L'écran rend donc quatre choix par case — `par défaut`, `masqué`, `affiché`,
`exigé` — et non trois.

Replier `affiché` sur `par défaut` aurait paru plus simple et aurait été **faux** : le seed pose
deux règles `visible` explicites, et une grille à trois choix les afficherait comme des défauts,
puis les supprimerait au premier réglage d'une autre case de la même ligne. Un écran ne doit pas
effacer une ligne que l'administrateur n'a pas désignée.

L'écran **dit** en revanche ce que la base fait de cette distinction : `par défaut` et `affiché`
produisent le **même formulaire**, et leur différence est une intention consignée, non un effet. Le
taire laisserait chercher une différence de comportement qui n'existe pas.

#### 7 bis.11.5 Les refus

Le vocabulaire est celui d'une règle, et deux natures du §7 bis.10.5 disparaissent faute de pouvoir
être produites :

- `23514` est `forme-refusee` et n'a **qu'une** cause ici, le `CHECK` de visibilité —
  MESURÉ, `400` sur `visibility: "peut-etre"`. L'écran ne propose que les trois valeurs, de sorte
  que ce refus ne peut venir que d'un état corrompu ou d'une écriture concurrente ;
- `23503` est « le champ ou l'étape a disparu, ou n'appartient pas à ce workflow » — MESURÉ,
  `409` sur un couple croisant deux workflows, la clé `form_field_rules_step_id_workflow_id_fkey`
  répondant la première. C'est exactement ce que voit un administrateur dont le voisin vient de
  retirer l'étape ;
- `23505` **n'est pas traduit en refus métier** : il ne peut apparaître que si l'écran renonçait à
  l'`upsert`, et le §7 bis.11.3 dit pourquoi il ne le fait pas. Il reste rendu par le message
  générique plutôt que par une nature que rien ne doit produire ;
- `403` / `42501` est `forbidden` — MESURÉ avec le jeton réel du `business_developer` sur une
  insertion ;
- `200` avec **zéro ligne** est `sans-effet`, et c'est ici le cas le plus fréquent d'un
  non-administrateur : MESURÉ, le `business_developer` obtient `200` et `[]` aussi bien en `PATCH`
  qu'en `DELETE` sur une règle seedée, qui reste intacte. Le `USING` de la politique filtre la ligne
  avant l'écriture, sans lever d'erreur. Le confondre avec un succès afficherait un réglage qui n'a
  pas eu lieu.

#### 7 bis.11.6 États, accessibilité et responsive

La grille est un **quatrième bloc**, sous les champs et dans la même colonne : on ne règle pas la
visibilité de champs qu'on n'a pas déclarés.

- **C'est un vrai tableau** — `table`, `thead`, `th scope="col"` pour les étapes, `th scope="row"`
  pour les champs —, par le §5.9 du design system : une grille de `div` priverait un lecteur
  d'écran de l'en-tête rappelé à chaque cellule, ce qui est ici la seule façon de savoir de quel
  couple on parle.
- **Chaque case est une liste déroulante** dont le libellé accessible nomme **le champ ET l'étape**,
  jamais « visibilité » seul. Sept colonnes de cases anonymes seraient indéchiffrables à la voix.
- **Le tableau défile dans son propre conteneur** (§7 du design system) : sept étapes ne tiennent
  pas sous 768 px, et la page ne défile jamais horizontalement.
- Le bloc rend les quatre états du §5.8 ; un workflow sans champ actif ou sans étape **dit** ce que
  cela signifie plutôt que d'afficher un tableau vide ; chaque case est atteignable au clavier ; la
  console reste vierge.

#### 7 bis.11.7 Ce que cette tranche ne livre pas

- les **exigences de transition** (`docs/SPEC-transition-required-fields.md`) ;
- la **prévisualisation des effets** exigée par la Definition of Done de `CRM-076` ;
- le réglage en **lot** d'une ligne ou d'une colonne entière : chaque case est une écriture, et
  aucune écriture de lot n'est spécifiée. Une boucle de quarante-deux `POST` déguisée en un geste
  laisserait, au premier refus, une grille à moitié réglée sans que rien ne le dise.

#### 7 bis.11.8 Preuves attendues de la quatrième tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Lecture 6 émise avec ses colonnes et son filtre ; grille composée des champs **non archivés** × étapes, cases par défaut comprises ; règle d'un couple appliquée à la bonne case ; règle orpheline — champ ou étape absent — écartée ; les deux écritures, dont l'`upsert` et son en-tête `Prefer` ; correspondance des refus, `23514`, `23503`, `42501` et `sans-effet` compris |
| Interface | Les deux gestes joués à la souris **et** au clavier sur la vraie base, chacun confirmé en base après coup ; le retour au défaut vérifié par l'**absence** de ligne, pas par l'affichage |
| Visuel | Captures aux **quatre paliers** de `docs/DESIGN_SYSTEM.md` §7, grille défilant dans son conteneur sous 768 px, case ouverte |
| Seed | Le formulaire du workflow par défaut suffit. **Mesuré sur la pile, 2026-08-15** : **quinze** règles — sept `hidden`, six `required`, deux `visible` — pour six champs actifs et sept étapes, soit vingt-sept couples sans règle. Les preuves écrivent sur des couples que le seed laisse par défaut et les rendent au défaut dans leur `finally` : le seed retrouve exactement ses quinze règles |

### 7 bis.12 Cinquième tranche : les exigences propres à une transition

Le §7 bis.11.7 nommait deux manques ; celui-ci lève le premier — les **exigences de transition** de
`docs/SPEC-transition-required-fields.md`, livrées en base par `CRM-018` et jusqu'ici sans écran.
La prévisualisation des effets reste due ; l'unité reste `[~]`.

Comme les quatre tranches précédentes, celle-ci ne touche NI au modèle NI aux autorisations :
`workflow_transition_required_fields` existe depuis `CRM-018` avec sa clé primaire à deux colonnes,
ses deux clés étrangères en cascade, ses trois triggers de cohérence et ses trois politiques, déjà
prouvés en pgTAP. **Aucune migration n'est écrite.**

#### 7 bis.12.1 Ce que la cinquième tranche lit

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 7 | `workflow_transition_required_fields` | `transition.workflow_id=eq.<workflow choisi>` par jointure **interne** sur `workflow_transitions` | `transition_id`, `field_id` | les exigences propres aux arêtes du workflow choisi |

**LE FILTRE PASSE PAR UNE JOINTURE, ET CE N'EST PAS UN CHOIX DE STYLE.** La table n'a que deux
colonnes — `docs/SPEC-transition-required-fields.md` §2 explique pourquoi le workflow n'y est
délibérément pas dénormalisé : il se déduit des deux parents, et un trigger garantit leur égalité.
Il n'existe donc littéralement aucune colonne locale à filtrer. MESURÉ le 2026-08-15 : la jointure
`workflow_transitions!inner` avec `transition.workflow_id=eq.…` rend `200` et la seule liaison
globale, là où la lecture sans filtre rend **les deux** liaisons du seed — celle du workflow global
et celle de sa copie dérivée. Sans le filtre, l'écran d'un workflow afficherait les exigences d'un
autre.

L'ordre demandé est celui des identifiants, pour la raison des lectures 4 et 6 : la table ne porte
ni la position d'un champ ni celle d'une étape. L'écran n'en dépend pas — les exigences sont
**indexées** par transition, et l'ordre lisible vient des listes déjà lues.

La lecture est émise **avec** les quatre autres : une exigence n'a de sens qu'entre une arête et un
champ du même instant, et toute écriture des cinq blocs les rejoue toutes.

#### 7 bis.12.2 Ce que l'écran doit montrer, et que la table seule ne dit pas

Une transition n'exige pas seulement les champs qu'elle nomme. La sixième garde de `move_card`
(`docs/SPEC-transition-required-fields.md` §1 et §5.1) exige l'**union** de deux ensembles, et son
code le dit mot pour mot :

1. les champs dont la **règle vaut `required` à l'étape d'arrivée** — c'est-à-dire une colonne de la
   grille du §7 bis.11 ;
2. les champs **liés explicitement à la transition** — c'est-à-dire cette table.

Le tout restreint aux champs **non archivés** du workflow.

**UN ÉCRAN QUI NE MONTRERAIT QUE LA SECONDE MOITIÉ MENTIRAIT PAR OMISSION.** Un administrateur qui
lit « cette transition n'exige aucun champ » alors que l'étape d'arrivée exige trois champs par
règle se tromperait sur ce que le produit refusera à ses utilisateurs. Pire, il déclarerait une
exigence explicite déjà obtenue par la règle, ajoutant une ligne sans effet observable.

L'écran rend donc, pour chaque transition, ses exigences **effectives**, chacune portant son
origine :

- **par la règle de l'étape d'arrivée** : lecture seule ici, et l'écran renvoie à la grille, qui est
  l'endroit où cela se règle. MESURÉ sur le seed le 2026-08-15 : six règles `required` réparties sur
  quatre étapes d'arrivée ;
- **par cette transition** : le seul ensemble que ce bloc écrit.

Un champ peut relever des deux : il est alors nommé une fois, avec ses deux origines, car la base
accepte parfaitement les deux et `move_card` ne l'exige qu'une fois.

#### 7 bis.12.3 Les deux gestes, et pourquoi le premier N'EST PAS un `upsert`

| Geste | Écriture | Ce que la base garantit déjà |
|---|---|---|
| **Exiger un champ** pour une transition | `POST` **simple**, sans résolution de conflit | clé primaire `(transition_id, field_id)`, deux clés étrangères, trigger de même workflow |
| **Ne plus l'exiger** | `DELETE` sur le couple `(transition_id, field_id)` | politique de suppression réservée à l'administrateur |

**LA TRANCHE PRÉCÉDENTE RÉGLAIT PAR `upsert` ; CELLE-CI NE LE PEUT PAS, ET C'EST MESURÉ.** Le
2026-08-15, sur la pile seedée :

1. `POST` d'un couple absent → **`201`** ;
2. `POST` du **même couple**, sans résolution → **`409`**, `23505`,
   `workflow_transition_required_fields_pkey` ;
3. `POST` du même couple **avec** `Prefer: resolution=merge-duplicates` → **`403`**, `42501`,
   `permission denied for table workflow_transition_required_fields`, avec pour indice
   « GRANT UPDATE ON public.workflow_transition_required_fields TO authenticated » ;
4. `PATCH` → **`403`**, `42501`, le même indice.

La cause est dans la migration de `CRM-018`, et elle est **volontaire** : seuls `insert` et `delete`
sont accordés à `authenticated`, jamais `update`. Le §2 de sa spécification en donne le motif —
« aucune valeur mutable : modifier une liaison signifie la supprimer puis en créer une autre ». Un
`upsert` PostgREST a besoin du privilège `UPDATE` pour sa branche de conflit ; il est donc refusé
avant même d'atteindre la politique. Reprendre le patron de la tranche précédente aurait produit un
`403` incompréhensible sur le geste le plus courant du bloc.

Le `23505` n'est donc **pas** un défaut d'écran, mais l'état normal d'une course : un autre
administrateur a déclaré la même exigence entre la lecture et le clic. L'écran le traduit par « déjà
exigé » et **recharge**, plutôt que par une alerte d'échec — l'état voulu par l'administrateur est
précisément celui que la base porte déjà. C'est l'inverse exact du §7 bis.11.5, où le même code ne
pouvait pas apparaître.

#### 7 bis.12.4 Ce que l'écran refuse de proposer, et pourquoi

**Les champs archivés ne sont pas proposés**, comme ils sont écartés des lignes de la grille
(§7 bis.11.2). MESURÉ le 2026-08-15 : la base **accepte** une liaison vers un champ archivé —
`201` sur le couple `…071 × …087` —, mais la sixième garde de `move_card` filtre
`f.archived_at is null` : la liaison ne produirait **aucun** effet. Offrir ce choix ferait déclarer
une exigence qui ne s'appliquerait jamais. Les liaisons existantes vers un champ archivé ne sont
pour autant pas supprimées — elles redeviennent effectives à la restauration du champ, exactement
comme ses règles — et l'écran **nomme** celles qu'il rend ainsi sans effet plutôt que de les taire.

**Les champs déjà liés ne sont pas proposés une seconde fois** : le couple serait refusé en `23505`,
et proposer un choix dont on connaît le refus est une faute d'écran, pas une garantie.

**Les champs d'un autre workflow ne sont pas proposables**, la liste ne portant que ceux du workflow
choisi. Le refus existe néanmoins en base et reste traduit : MESURÉ, `400` / `23514` /
`required_field_workflow_mismatch` sur un champ du workflow dérivé lié à une arête globale.

#### 7 bis.12.5 Les refus

| Reçu | Nature | Mesuré le 2026-08-15 |
|---|---|---|
| `409` / `23505` | `deja-exige` | `POST` d'un couple existant, clé `workflow_transition_required_fields_pkey` |
| `409` / `23503` | `reference-absente` | `POST` d'un `field_id` inconnu, clé `…_field_id_fkey` — l'arête ou le champ a disparu entre deux lectures |
| `400` / `23514` | `workflow-different` | `required_field_workflow_mismatch`, champ du workflow dérivé sur une arête globale |
| `403` / `42501` | `forbidden` | `POST` avec le jeton réel du `business_developer` : « new row violates row-level security policy ». Le même code répond au `PATCH` et à l'`upsert` de l'administratrice, pour une autre cause — le privilège manquant — et le message générique convient aux deux |
| `200` avec zéro ligne | `sans-effet` | `DELETE` du `business_developer` sur la liaison seedée : `200`, `[]`, liaison **relue intacte**. MESURÉ aussi sur un couple **inexistant** avec le jeton de l'administratrice : `200` et `[]` également — les deux sont indiscernables par la réponse seule, donc l'écran dit « rien n'a changé » sans prétendre savoir laquelle des deux causes s'applique |

#### 7 bis.12.6 États, accessibilité et responsive

Le bloc est le **cinquième**, sous la grille et dans la même colonne : on n'ajoute pas d'exigence
propre à une arête avant d'avoir vu ce que les règles exigent déjà.

- Les exigences se lisent **par transition**, groupées comme les arêtes du §7 bis.9.6 et dans le
  même ordre : l'administrateur retrouve chaque arête à la place où il vient de la lire.
- Chaque exigence effective **nomme son origine** en toutes lettres ; la commande de retrait n'est
  offerte que sur les exigences propres à la transition, et l'origine « règle » renvoie à la grille
  plutôt que d'offrir un bouton qui refuserait.
- L'ajout est un formulaire à **une** liste — la transition est déjà connue par la ligne qui l'ouvre
  —, fermable au clavier, dont la liste ne contient que des choix acceptables (§7 bis.12.4). Un
  workflow dont tous les champs actifs sont déjà exigés le **dit** au lieu d'offrir une liste vide.
- Le bloc rend les quatre états du §5.8 ; un workflow sans arête ou sans champ actif dit ce que cela
  signifie ; tout est atteignable au clavier ; la console reste vierge.

#### 7 bis.12.7 Ce que cette tranche ne livre pas

- la **prévisualisation des effets** exigée par la Definition of Done de `CRM-076` — **livrée par la
  sixième tranche, spécifiée au §7 bis.13** ;
- le réglage en **lot** d'une exigence sur plusieurs transitions, pour le motif du §7 bis.11.7 ;
- toute modification de la règle d'une étape depuis ce bloc : elle appartient à la grille, et deux
  écrans qui écrivent la même ligne se contrediraient.

#### 7 bis.12.8 Preuves attendues de la cinquième tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Lecture 7 émise avec sa jointure interne, ses colonnes et son filtre ; union des exigences effectives par transition — origine `règle`, origine `transition`, et le champ qui porte les deux ; champs archivés exclus de l'union et des choix ; choix d'ajout privés des champs déjà liés ; les deux écritures, dont le `POST` **sans** résolution de conflit ; correspondance des refus, `23505`, `23503`, `23514`, `42501` et `sans-effet` compris |
| Interface | Les deux gestes joués à la souris **et** au clavier sur la vraie base, chacun confirmé en base après coup ; le retrait vérifié par l'**absence** de ligne ; l'exigence héritée d'une règle affichée **sans** commande de retrait |
| Visuel | Captures aux **quatre paliers** de `docs/DESIGN_SYSTEM.md` §7, formulaire d'ajout ouvert, sans débordement de page |
| Seed | Le workflow par défaut suffit. **Mesuré sur la pile, 2026-08-15** : **deux** liaisons en tout — une sur le workflow global (`Démarrer la réalisation` × `lien-proposition`) et une remappée sur la copie dérivée —, et **six** règles `required` sur quatre étapes d'arrivée. Les preuves écrivent sur des couples que le seed ne porte pas et les retirent dans leur `finally` : le seed retrouve exactement ses deux liaisons |

### 7 bis.13 Sixième tranche : la prévisualisation des effets

Dernier manque de `CRM-076`, et le seul point de sa Definition of Done qui ne soit ni une lecture
ni une écriture : **avant** d'ajouter une exigence, l'administrateur doit voir ce qu'elle fera aux
affaires déjà en cours.

Deux gestes de l'éditeur, et deux seulement, peuvent **bloquer** une affaire existante :

1. régler une case de la grille sur **« Exigé »** (§7 bis.11.3) ;
2. **exiger un champ** sur une transition (§7 bis.12.3).

Les autres gestes n'ont aucun effet de ce genre : « Masqué » et « Affiché » ne bloquent rien, le
retrait d'une exigence ne fait que lever une contrainte, et le retrait d'une étape occupée est déjà
refusé par la base (`on delete restrict`, §7 bis.4). La tranche porte donc sur ces deux gestes.

#### 7 bis.13.1 Les deux effets, qui ne sont PAS le même nombre

Une exigence ajoutée sur un couple champ × étape produit **deux** effets distincts, et l'écran les
sépare parce que la base les traite différemment :

- **sur place** — les affaires **déjà** à cette étape. Elles ne sont jamais chassées (§5.7) ; leur
  fiche signalera un manque, sans bloquer sa lecture ;
- **à l'entrée** — les affaires qui, depuis leur étape courante, empruntent un chemin **menant** à
  cette étape, et dont le champ est vide. Celles-là seront refusées par la sixième garde de
  `move_card` tant que le champ ne sera pas renseigné.

Les deux nombres diffèrent, et pas d'un peu. MESURÉ sur le seed le 2026-08-15, workflow par défaut,
pour le champ `date-signature-prevue` sur les sept étapes : `Prospection` rend **4 sur place** et
**0 à l'entrée** — aucune arête ne mène à l'étape initiale ; `Signature` rend l'inverse, **0 sur
place** et **1 à l'entrée** ; `Perdu` rend **1** et **8**. Un écran qui n'aurait rendu qu'un seul
nombre aurait donc annoncé « aucun effet » sur deux étapes du workflow par défaut, alors que
l'effet existait de l'autre côté.

Une exigence ajoutée sur une **transition** n'a pas d'effet « sur place » : elle ne porte pas sur
l'étape d'arrivée mais sur un chemin. Elle ne rend que le second nombre, restreint aux affaires
situées à l'étape de **départ** de cette arête. MESURÉ : `date-signature-prevue` sur
`Prospection → Perdu` rend **4**.

#### 7 bis.13.2 Pourquoi le compte est fait par la BASE, et non par l'écran

Trois raisons, chacune mesurée, et aucune n'est une préférence de style :

1. **« Vide » est un contrat backend, et il est plus subtil qu'il n'y paraît.**
   `app.valeur_de_champ_est_vide` traite `null` SQL, `'null'` JSON, la chaîne blanche et le tableau
   vide, et son `btrim` porte sur **vingt-quatre** points de code d'espaces, Unicode compris
   (`CRM-036`). Le réécrire en TypeScript dupliquerait la définition que `move_card` possède, et les
   deux dériveraient sans que rien ne le signale.
2. **La lecture serait non bornée.** Compter côté navigateur exigerait de charger toutes les
   affaires du workflow et toutes leurs valeurs de champ. Le seed en porte 13 actives et 21
   valeurs ; rien ne borne ces tables en production (`CLAUDE.md` §21).
3. **Le compte doit être celui de ce que le lecteur a le droit de voir.** Une fonction
   `security invoker` hérite de la RLS des tables lues, comme `etat_messagerie` et
   `inbox_arborescence` avant elle. Un `security definer` aurait annoncé un nombre d'affaires que
   son lecteur ne peut pas ouvrir.

#### 7 bis.13.3 La fonction, son contrat et ses refus

```
public.previsualiser_exigence(
  p_field_id      uuid,
  p_step_id       uuid default null,
  p_transition_id uuid default null
) returns table (sur_place bigint, a_l_entree bigint)
```

`stable`, `security invoker`, `set search_path to ''`, `grant execute` au rôle `authenticated`.

- **Exactement une** des deux cibles est fournie. Zéro ou deux lèvent `previsualisation_cible`
  (`P0001`) : une prévisualisation sans cible compterait un ensemble que personne n'a demandé, et
  deux cibles rendraient un nombre dont on ne saurait pas de quel geste il parle.
- Un champ, une étape ou une transition **inconnus** ne lèvent pas : la fonction rend `0, 0`. Une
  cible disparue entre la lecture de l'écran et l'appel est une course ordinaire, pas une erreur, et
  l'écriture qui suit la signalera elle-même par son `23503`.
- Les affaires **archivées** sont exclues des deux comptes : `move_card` refuse déjà de les déplacer
  (`c.archived_at is null`, première garde). MESURÉ : le seed en porte **une**.
- Un **champ archivé** rend `0, 0` : la sixième garde filtre `f.archived_at is null`, donc
  l'exigence serait sans effet — c'est ce que le §7 bis.11 et le §7 bis.12 écrivent déjà de leur
  côté.
- Le compte « à l'entrée » compte des **affaires**, non des couples affaire × arête. La défense est
  un `count(distinct)`, et il faut dire ce qu'elle vaut : la contrainte
  `workflow_transitions_workflow_from_to_key` rend unique le couple (départ, arrivée) d'un
  workflow, si bien qu'aucune affaire ne peut aujourd'hui être comptée deux fois. MESURÉ sur les
  cinq arêtes menant à `Perdu` : prises une à une elles rendent 4, 2, 1, 0 et 1, et l'étape rend
  **8** — l'union est exactement la somme. Le `distinct` ne change donc rien tant que cette
  contrainte tient, et la preuve constate cette **égalité** plutôt que de prétendre observer un
  dédoublonnage que le modèle rend impossible.

Le corps reprend la sixième garde de `move_card` **mot pour mot** pour la partie qui définit
« renseigné » — `not exists (… and not app.valeur_de_champ_est_vide(v.value))` —, et cette parenté
est ce que la preuve pgTAP vérifie : la prévisualisation et le refus doivent porter le même verdict
sur la même affaire.

#### 7 bis.13.4 Ce que l'écran en fait

- La prévisualisation est **demandée au moment du geste**, jamais chargée d'avance : quarante-deux
  cases et une dizaine d'arêtes feraient autant d'appels pour des gestes qui n'auront pas lieu.
- **Pour la grille**, la case réglée sur « Exigé » n'écrit pas immédiatement : elle ouvre une
  confirmation qui porte les deux nombres, et la case reprend sa valeur précédente si
  l'administrateur renonce. Les trois autres états restent **immédiats** — ils ne bloquent rien, et
  leur imposer une confirmation aurait rendu la grille inutilisable.
- **Pour les exigences de transition**, le nombre est affiché dans le formulaire d'ajout, sous le
  choix du champ, dès qu'un champ est choisi : le formulaire existe déjà et porte son bouton de
  validation, donc aucune confirmation supplémentaire n'est ajoutée.
- **Zéro se dit en toutes lettres** — « aucune affaire en cours n'est concernée » —, jamais par
  l'absence de phrase : un bloc muet se lirait comme un chargement qui n'a pas abouti.
- L'échec de la prévisualisation **ne bloque pas le geste**. Le compte est une aide à la décision,
  pas une garde ; la garde est dans `move_card`. L'écran écrit alors que l'effet n'a pas pu être
  mesuré, et laisse valider.

#### 7 bis.13.5 Ce que cette tranche ne livre pas

- la prévisualisation des effets d'un **retrait** — retirer une exigence ne bloque aucune affaire,
  et son seul effet est de lever une contrainte ;
- la **liste nominative** des affaires concernées : un compte suffit à la décision, et une liste
  demanderait une pagination, un filtre de lecture et un écran que rien n'a spécifié ;
- le réglage en **lot**, toujours hors périmètre (§7 bis.11.7, §7 bis.12.7).

#### 7 bis.13.6 Preuves attendues de la sixième tranche

| Niveau | Preuves |
|---|---|
| pgTAP | La fonction existe, `stable`, non `security definer`, exécutable par `authenticated` ; ses deux refus de cible ; les deux comptes sur des couples mesurés du seed ; l'affaire archivée exclue ; le champ archivé rendant `0, 0` ; le dédoublonnage des arêtes multiples ; **la parenté avec `move_card`** — une affaire comptée « à l'entrée » se voit bien refuser son déplacement par `missing_required_fields` une fois la règle posée |
| Unitaire | L'appel RPC et ses paramètres ; la composition du message selon les deux nombres, dont le cas `0, 0` ; le repli lorsque l'appel échoue |
| Interface | La confirmation ouverte par « Exigé » porte les deux nombres et n'écrit qu'après acceptation ; le renoncement rend la case à sa valeur précédente **et** n'écrit rien en base ; le formulaire d'exigence de transition affiche son compte au choix du champ |
| Visuel | Captures aux quatre paliers, confirmation ouverte, sans débordement de page |
| Seed | Le workflow par défaut suffit et n'est pas modifié : les comptes du §7 bis.13.1 sont ceux du seed |

## 7 ter. Versionnement des workflows — `CRM-078`

Unité `CRM-078` du backlog. Ce chapitre est écrit **après mesure sur la pile réelle**, seedée, et
non d'après un compte rendu antérieur. Toute ligne marquée MESURÉ a été observée en base ou par
l'API avec les jetons réels des comptes seedés.

### 7 ter.1 Ce que le versionnement est, et ce qu'il n'est pas

Un workflow est une **structure vivante** : l'éditeur de `CRM-076` en modifie les étapes, les
arêtes, les champs et les règles à tout moment, et rien ne garde trace de ce qu'il était hier. Une
affaire qui a traversé « Prospection → Négociation » sous un graphe donné devient donc illisible dès
que ce graphe change : ni l'historique ni l'analytique ne peuvent dire sous quelle composition la
card a circulé.

Le versionnement répond à cela, et **à cela seulement** : figer, à la demande d'un administrateur,
une **photographie immuable** de la composition d'un workflow, numérotée, datée, attribuée, et
comparable.

Ce que le versionnement **n'est pas** :

- ce n'est **pas** un mécanisme d'activation : publier une version ne change rien au comportement
  du produit. Les cards continuent de circuler sur la structure vivante, et `move_card` ne consulte
  aucune version. Une version est un **témoin**, pas une cible d'exécution ;
- ce n'est **pas** un retour arrière : restaurer une version dans la structure vivante est un geste
  distinct, avec son plan de remappage des cards, et il n'appartient pas à cette tranche (§7 ter.9) ;
- ce n'est **pas** une copie : `copy_workflow_to_track` (§4) crée un **autre workflow**, qui vit sa
  vie. Une version ne crée aucun workflow et n'est jamais empruntable par une card.

### 7 ter.2 La composition, document canonique — et pourquoi elle existe déjà à moitié

`CRM-032` a livré `app.workflow_composition_fingerprint(uuid)`, qui construit un document `jsonb`
canonique — workflow, étapes, arêtes, champs, règles, exigences, chacun trié par identifiant — et
n'en rend que l'empreinte SHA-256. **Le document lui-même est jeté.** Le versionnement a besoin des
deux : du document pour le conserver, de l'empreinte pour comparer.

La composition est donc **extraite** dans `app.workflow_composition_document(target_workflow_id uuid)
returns jsonb`, et `app.workflow_composition_fingerprint` devient son appelant :

```
app.workflow_composition_fingerprint(id)
  = encode(digest(convert_to(app.workflow_composition_document(id)::text, 'UTF8'), 'sha256'), 'hex')
```

**Exigence non négociable de cette extraction : l'empreinte rendue doit être identique, caractère
pour caractère, à celle rendue avant l'extraction.** `workflows.source_composition_fingerprint`
porte des valeurs figées par la copie, et la vue `public.workflow_derivations` compare l'empreinte
courante à ces valeurs (§4.6). Une extraction qui changerait l'ordre des clés ou le tri d'une
collection ferait diverger toutes les copies existantes sans qu'aucune n'ait bougé. MESURÉ avant
extraction, sur la base seedée, et à figer par assertion :

| Workflow | Empreinte |
|---|---|
| `Cycle commercial standard` (`5eed0000-…-000000000051`) | `6b2f5f2adbadd48680d38b8d4bc19a004ff35881df654593e43d2eb4f577e7c8` |
| `Cycle commercial — Conseil IA` (`352d02ac-…`) | `6e4faac608cc1d16fdb8db1b6ae9c8b2d4de7728204919d8ebd6166c13a58d89` |

Le document conservé est celui du §4.6 sans retrait ni ajout : six clés de premier niveau —
`workflow`, `steps`, `transitions`, `fields`, `rules`, `required_fields`. Il contient les
identifiants réels des objets vivants : une version sait donc désigner ce qu'elle photographiait,
même après disparition de l'objet.

**Ce que le document ne contient pas, et il faut le dire** : aucune card, aucune valeur de champ,
aucune donnée personnelle. Une version est une photographie de **structure**. C'est ce qui la rend
conservable sans limite de durée et hors du champ d'une purge RGPD portant sur les personnes.

### 7 ter.3 Modèle — `public.workflow_versions`

| Colonne | Type | Règle |
|---|---|---|
| `id` | `uuid` | clé primaire, `gen_random_uuid()` |
| `workspace_id` | `uuid` | non nul, → `workspaces(id)` `on delete cascade` |
| `workflow_id` | `uuid` | non nul, → `workflows(id, workspace_id)` `on delete cascade`, couple porté avec `workspace_id` |
| `version_number` | `integer` | non nul, `> 0`, **unique par workflow** |
| `composition` | `jsonb` | non nul, objet — `jsonb_typeof(composition) = 'object'` |
| `composition_fingerprint` | `text` | non nul, `^[0-9a-f]{64}$` |
| `note` | `text` | facultatif, non vide après `btrim` s'il est fourni |
| `published_by` | `uuid` | → `public.profiles(id)` `on delete set null` — même convention que `cards.created_by` |
| `published_at` | `timestamptz` | non nul, `now()` |

**Aucune colonne `updated_at`, et c'est intentionnel** : une ligne immuable n'a pas de date de
modification. En poser une laisserait croire que la mise à jour existe.

La clé étrangère porte le **couple** `(workflow_id, workspace_id)` et non le seul `workflow_id`,
comme toutes les tables filles du projet : elle interdit qu'une version soit rattachée à un workflow
d'un autre workspace, ce qu'une clé simple laisserait passer.

Index : la clé primaire, l'unicité `(workflow_id, version_number)`, et un index
`(workflow_id, version_number desc)` — toute lecture utile est « les versions de ce workflow, la
plus récente d'abord ».

### 7 ter.4 L'immuabilité, et où elle est réellement tenue

L'immuabilité n'est pas une intention, c'est un empilement de trois refus :

1. **Aucune politique RLS de mise à jour ni de suppression.** La table n'en porte que deux : lecture
   par les membres du workspace, insertion par personne. Sans politique, l'opération ne voit aucune
   ligne ;
2. **Aucun privilège d'écriture.** `revoke all … from anon, authenticated`, puis `grant select`
   seul. `insert`, `update` et `delete` ne sont accordés à **personne** hors `service_role`, de
   sorte que le refus se manifeste dès le privilège, comme pour le catalogue (§2.6) ;
3. **Un trigger `before update` qui refuse en `42501`**, y compris sous `service_role` et sous
   `postgres`. C'est la seule des trois barrières qui tienne face à la clé de service — et
   `mail-sync` la porte. Une version modifiée en silence ne serait plus une preuve de rien.

**Le trigger porte sur `update` et sur lui seul.** Un trigger `before delete` s'exécuterait aussi
lors de la **suppression en cascade** d'un workspace ou d'un workflow, et rendrait cette suppression
impossible — c'est exactement le mode de défaillance d'INC-039. La suppression directe est donc
tenue par le privilège et par l'absence de politique ; la suppression en cascade reste possible,
et elle est voulue : les versions d'un workflow disparu n'ont plus d'objet.

MESURÉ, et c'est ce qui justifie le point 3 : `grant all privileges … to service_role` est le défaut
de toutes les tables du projet ; sans le trigger, la clé de service réécrirait une composition
publiée sans qu'aucune trace ne subsiste.

### 7 ter.5 Le geste — `public.publish_workflow_version`

```
public.publish_workflow_version(
  target_workflow_id uuid,
  note               text default null
) returns public.workflow_versions
```

`security definer`, `search_path` vide, `volatile`. Exécution accordée à `authenticated` et à
`service_role` ; **révoquée de `public` et d'`anon`** — la révocation nommée est obligatoire, le
`grant execute` par défaut de l'image portant sur `anon` aussi (§4.7, décision 80).

**La fonction sérialise sur le workflow** avant toute lecture de composition :
`select … from public.workflows where id = target_workflow_id for update`. Sans ce verrou, deux
publications simultanées liraient le même `max(version_number)` et l'une des deux échouerait en
`23505` — un `409` incompréhensible là où la bonne réponse est deux versions successives.

Les vérifications, **dans cet ordre**, et ce que chacune rend :

| # | Vérification | Refus | `SQLSTATE` | HTTP |
|---|---|---|---|---|
| 1 | l'appelant est authentifié — `auth.uid()` non nul | `authentification requise` | `42501` | `403` (anonyme : `401`, le privilège refuse d'abord) |
| 2 | le workflow existe et appartient à un workspace de l'appelant | `workflow introuvable` | `P0001` | `400` |
| 3 | l'appelant est administrateur de ce workspace — `app.is_workspace_admin` | `publication reservee aux administrateurs` | `42501` | `403` |
| 4 | le workflow n'est pas archivé | `workflow archive` | `P0001` | `400` |
| 5 | la composition diffère de celle de la dernière version publiée | `composition inchangee` | `P0001` | `400` |

La vérification 2 rend **le même refus** qu'un workflow d'un autre workspace : un identifiant
inexistant et un identifiant appartenant à autrui sont indiscernables pour l'appelant, ce qui est la
règle du projet (§4.3) et évite de transformer la fonction en oracle d'existence.

`P0002` n'est employé nulle part : il est rendu en `500` par PostgREST (§4.4).

**La vérification 5 est la règle de fond de cette unité.** Publier deux fois la même composition
produirait deux versions indiscernables, et la comparaison entre versions deviendrait bruit. La
comparaison porte sur l'**empreinte** de la dernière version, jamais sur le document — c'est
exactement à cela que sert l'empreinte, et cela reste juste quand la composition grossit. Elle ne
porte que sur la **dernière** version : republier une composition identique à une version plus
ancienne, après un aller-retour, est **accepté**, et le numéro avance. Une version dit « voici la
structure à cette date », pas « voici une structure jamais vue ».

En cas de succès, la fonction insère `version_number = coalesce(max(version_number), 0) + 1` dans la
portée du workflow, `published_by = auth.uid()`, et rend **la ligne complète**.

`note` est facultative. Fournie, elle est `btrim`ée ; réduite au vide, elle est enregistrée `NULL`
plutôt que refusée — la note est un confort, pas une donnée de contrôle.

### 7 ter.6 Autorisations

| Opération | `anon` | `viewer` / `business_developer` | `admin` | `service_role` |
|---|---|---|---|---|
| lire les versions | `200` et `[]` — refus n° 11 | `200`, celles de son workspace | `200` | `200` |
| insérer directement | refusé (privilège) | refusé (privilège) | refusé (privilège) | accordé |
| mettre à jour | refusé | refusé | refusé | **refusé par le trigger** |
| supprimer directement | refusé | refusé | refusé | accordé |
| `publish_workflow_version` | `401` | `403`, `42501` | `201`/`200` | accordé |

La lecture suit `app.is_workspace_member`, comme `workflows` : une version décrit une structure
d'organisation, pas une affaire. Les droits fins de track et de channel ne s'y appliquent pas, pour
la même raison qu'au §2.7 — une version n'appartient à aucun track.

### 7 ter.7 Contrat d'API attendu, à mesurer

Les lignes ci-dessous constituent le contrat que les preuves d'API de cette tranche doivent
**observer** sur la pile, avec les jetons réels obtenus par
`POST /auth/v1/token?grant_type=password`. Elles ne sont pas annoncées mesurées tant qu'elles ne
l'ont pas été.

| # | Appel | Profil | Attendu |
|---|---|---|---|
| a | `POST /rpc/publish_workflow_version` sur le workflow par défaut | `admin` | `200`, version `1`, `published_by` = l'administrateur |
| b | le même appel immédiatement rejoué | `admin` | `400`, `P0001`, `composition inchangee` |
| c | le même appel après une modification de la composition | `admin` | `200`, version `2` |
| d | `POST /rpc/publish_workflow_version` | `business_developer` | `403`, `42501` |
| e | `POST /rpc/publish_workflow_version` | `viewer` | `403`, `42501` |
| f | `POST /rpc/publish_workflow_version` | anonyme | `401` — le privilège refuse avant la vérification 1 |
| g | `POST /rpc/publish_workflow_version` sur un identifiant inexistant | `admin` | `400`, `P0001`, `workflow introuvable` |
| h | `POST /rpc/publish_workflow_version` sur le workflow d'un autre workspace | `admin` | `400`, `P0001`, **le même message qu'en g** |
| i | `POST /rpc/publish_workflow_version` sur un workflow archivé | `admin` | `400`, `P0001`, `workflow archive` |
| j | `GET /workflow_versions` | `viewer` | `200`, les versions de son workspace |
| k | `GET /workflow_versions` | anonyme | `200` et `[]` — preuve de refus n° 11 |
| l | `GET /workflow_versions` filtré sur un autre workspace | `admin` | `200` et `[]` — preuve de refus n° 3 |
| m | `POST /workflow_versions` en écriture directe | `admin` | `403`, `permission denied` — le privilège manque |
| n | `PATCH /workflow_versions` sur une version publiée | `admin` | `403`, `permission denied` — le privilège manque |
| o | `DELETE /workflow_versions` | `admin` | `403`, `permission denied` — le privilège manque |

La ligne h est la contrepartie de la règle du §7 ter.5 : le message doit être **identique** à celui
de g, sans quoi la fonction dirait à l'appelant qu'un identifiant existe ailleurs.

### 7 ter.8 Ce que le seed livre

Le seed publie **une version du workflow par défaut**, par la véritable RPC et avec le jeton réel de
l'administrateur — jamais par une insertion directe, que les privilèges refusent de toute façon
(`CLAUDE.md` §8). Sans elle, aucun écran ni aucune preuve de lecture n'aurait de ligne à montrer.

Le seed est **convergent et non seulement idempotent** : un second passage ne publie pas une
deuxième version, la composition étant inchangée — c'est la vérification 5 qui l'assure, et non une
garde propre au seed.

### 7 ter.9 Ce que cette tranche ne livre PAS, et qui reste dû sous `CRM-078`

- la **comparaison de deux versions** — quelles étapes, arêtes, champs et règles ont été ajoutés,
  retirés ou modifiés. Le document conservé la rend calculable ; l'unité en portera le calcul et sa
  restitution ;
- le **plan de remappage des cards**, cœur de la Definition of Done : avant d'activer une version,
  dire card par card où elle atterrit, sans qu'aucune étape ne soit devinée ;
- l'**application transactionnelle** de ce plan, et son **retour arrière** ;
- **tout écran** : ni liste des versions, ni bouton de publication, ni aperçu de comparaison. Cette
  tranche est une fondation de données et de geste serveur. Aucune capture d'application n'est donc
  produite ici, et l'absence est nommée plutôt que compensée ;
- le **changement de type d'un champ**, que le §7 bis.10.3 renvoie explicitement à ce plan de
  remappage.

### 7 ter.10 Preuves attendues de la première tranche

| Niveau | Preuves |
|---|---|
| pgTAP | Structure, contraintes de valeur, unicité `(workflow_id, version_number)`, clé étrangère de couple ; les deux politiques et **l'absence** des deux autres ; les privilèges ; le refus de mise à jour sous `service_role` par le trigger ; la suppression en cascade d'un workflow emportant ses versions ; les cinq refus de la RPC contre des comptes réels ; **l'empreinte inchangée par l'extraction du document**, figée sur les deux workflows du seed |
| API | Les quinze lignes du §7 ter.7, hors interface, avec les jetons réels des trois profils ; preuves de refus n° 3 et n° 11 au niveau des versions |
| Seed | Une version du workflow par défaut, publiée par la vraie RPC, convergente au rejeu |
| Interface | **Aucune** — cette tranche ne livre aucun écran (§7 ter.9) |

### 7 ter.11 Deuxième tranche — la comparaison de deux versions

Chapitre écrit **avant la première ligne de code** de cette tranche (`CLAUDE.md` §5), après mesure
sur la pile seedée. Les valeurs marquées MESURÉ ont été relevées en base.

#### 7 ter.11.1 Ce que la comparaison est, et ce qu'elle n'est pas

La première tranche conserve des documents ; elle ne les lit pas. Deux versions d'un même workflow
sont aujourd'hui deux blocs `jsonb` de plusieurs milliers de caractères, et dire ce qui a changé
entre les deux suppose de les parcourir à l'œil. La comparaison rend cette lecture au produit :
**quelles étapes, arêtes, questions, règles et exigences ont été ajoutées, retirées ou modifiées**,
et pour chaque modification, **quel attribut a changé, de quelle valeur à quelle valeur**.

Ce qu'elle **n'est pas** :

- ce n'est **pas** un plan de remappage des cards. Dire qu'une étape a disparu ne dit pas où
  atterrissent les affaires qui s'y trouvent : c'est la troisième tranche, et elle a ses propres
  refus ;
- ce n'est **pas** une application. La comparaison ne modifie **rien** : elle est `stable`, elle
  n'écrit aucune ligne, et publier, restaurer ou remapper restent des gestes distincts ;
- ce n'est **pas** un rapprochement heuristique. **Aucune correspondance n'est devinée** — voir le
  paragraphe suivant, qui est la règle de fond de cette tranche.

#### 7 ter.11.2 L'identité est un identifiant, jamais une ressemblance

La Definition of Done de `CRM-078` exige qu'**aucune étape ne soit devinée**. Cette exigence se
tranche ici, dans la comparaison, et non plus loin : c'est elle qui décide si « Négociation »
renommée en « Négociation commerciale » est **une** étape modifiée ou **deux** étapes, l'une retirée
et l'autre ajoutée.

La règle est donc énoncée une fois, et elle ne souffre aucune exception : **deux éléments sont le
même élément si et seulement si leur identité est égale**, l'identité étant faite d'identifiants
réels et d'eux seuls. Aucun libellé, aucune position, aucune distance de chaîne, aucune proximité de
clé n'entre dans ce calcul. Le document canonique du §7 ter.2 porte les identifiants réels des
objets vivants — c'est précisément ce qui rend cette règle applicable.

| Collection | Identité |
|---|---|
| `workflow` | l'objet est unique dans le document ; les deux versions portant le même `workflow_id`, il est toujours apparié |
| `steps` | `id` |
| `transitions` | `id` |
| `fields` | `id` |
| `rules` | le couple `(field_id, step_id)` — la table n'a pas d'identifiant propre dans le document |
| `required_fields` | le couple `(transition_id, field_id)` — même raison |

Conséquence assumée et à dire au lecteur : une étape supprimée puis recréée à l'identique apparaît
comme **un retrait et un ajout**, jamais comme un élément inchangé. C'est la vérité de la base — la
seconde ligne n'est pas la première — et toute autre réponse serait une supposition.

#### 7 ter.11.3 Le geste — `public.compare_workflow_versions`

```
public.compare_workflow_versions(
  base_version_id   uuid,
  target_version_id uuid
) returns jsonb
```

`stable`, `search_path` vide, et **`security invoker`** — donc **sans** `security definer`, à la
différence de `publish_workflow_version`. Ce choix est délibéré : la politique de lecture de
`public.workflow_versions` (§7 ter.4) **est** déjà la règle d'autorisation exacte de ce geste. Une
fonction `definer` devrait la réécrire dans son corps, et deux formulations de la même règle
finissent toujours par diverger. Précédent du dépôt : `public.previsualiser_exigence` (§7 bis.13.3).

Exécution accordée à `authenticated` et à `service_role` ; **révoquée de `public` et d'`anon`** —
la révocation nommée est obligatoire, le `grant execute` par défaut de l'image portant sur `anon`
aussi (§4.7, décision 80).

Les vérifications, **dans cet ordre**, et ce que chacune rend :

| # | Vérification | Refus | `SQLSTATE` | HTTP |
|---|---|---|---|---|
| 1 | l'appelant est authentifié — `auth.uid()` non nul | `authentification requise` | `42501` | `403` (anonyme : `401`, le privilège refuse d'abord) |
| 2 | la version de base existe et est lisible par l'appelant | `version introuvable` | `P0001` | `400` |
| 3 | la version cible existe et est lisible par l'appelant | `version introuvable` | `P0001` | `400` |
| 4 | les deux versions portent le même `workflow_id` | `versions de workflows differents` | `P0001` | `400` |

Les vérifications 2 et 3 rendent **le même message**, et une version d'un autre workspace rend ce
même message qu'un identifiant inexistant : la RLS ne la donne pas à lire, `not found` s'ensuit, et
la fonction n'est donc pas un oracle d'existence (§4.3). C'est aussi pourquoi elle n'a **aucun**
contrôle de workspace écrit à la main : il serait redondant, et son absence est ici une garantie et
non un oubli.

La vérification 4 n'est pas un scrupule : deux versions de workflows distincts ne partagent aucun
identifiant d'étape ni de champ. Leur comparaison rendrait « tout retiré, tout ajouté », un document
volumineux et vide de sens que l'appelant prendrait pour une réponse.

**Comparer une version à elle-même est ACCEPTÉ**, et rend `identical = true` avec toutes les
collections vides. L'écran de la cinquième tranche en a besoin ; le refuser obligerait l'appelant à
tester l'égalité avant d'appeler.

**L'orientation est celle des arguments, et la fonction ne la corrige pas.** « Ajouté » signifie
*présent dans la cible, absent de la base*. Passer la version la plus récente en base rend donc une
comparaison exacte, mais lue à l'envers. Choisir le sens appartient à l'appelant, qui seul sait s'il
regarde un historique ou un projet de restauration.

#### 7 ter.11.4 Ce que la fonction rend

Un objet `jsonb` à cinq clés de premier niveau :

```
{
  "base":      { "version_id", "version_number", "published_at", "composition_fingerprint" },
  "target":    { … les mêmes … },
  "identical": true | false,
  "summary":   { "added": n, "removed": n, "modified": n },
  "changes":   {
    "workflow":        { "modified": [ … ] },
    "steps":           { "added": [ … ], "removed": [ … ], "modified": [ … ] },
    "transitions":     { … }, "fields": { … }, "rules": { … }, "required_fields": { … }
  }
}
```

Forme d'un élément, uniforme dans les six collections :

- **ajouté** et **retiré** : `{ "identity": { … }, "element": { … le document complet … } }`. Le
  document entier est rendu, et non son seul identifiant : un écran doit pouvoir nommer l'étape
  disparue, ce que l'objet vivant ne permet plus ;
- **modifié** : `{ "identity": { … }, "attributes": [ { "name", "before", "after" }, … ] }`. Seuls
  les attributs **réellement différents** figurent dans la liste, et un attribut apparu ou disparu
  y figure avec `null` du côté où il manque.

`changes.workflow` ne porte **que** `modified` : l'objet workflow existe des deux côtés par
construction (vérification 4).

**Tous les tableaux sont ordonnés**, par identité puis par nom d'attribut. Une fonction `stable` qui
rendrait deux ordres différents pour la même paire rendrait toute assertion instable et toute
comparaison d'écran clignotante.

`identical` est vrai **si et seulement si** les deux empreintes sont égales. C'est un invariant, pas
une commodité : l'empreinte est le condensé du document (§7 ter.2), donc deux empreintes égales
imposent six collections vides, et deux empreintes différentes imposent au moins un écart. Les
preuves l'éprouvent **dans les deux sens**.

`summary` compte les éléments, non les attributs : une étape dont trois attributs changent compte
pour **un** `modified`. Le workflow modifié compte pour un `modified` s'il porte au moins un
attribut différent.

#### 7 ter.11.5 Un seul algorithme, appelé six fois

Le calcul est porté par `app.composition_collection_diff(base jsonb, target jsonb, identity_keys
text[]) returns jsonb`, `immutable`, `search_path` vide, révoquée de `public` puis accordée aux
trois rôles. Elle ne connaît **rien** aux workflows : elle reçoit deux tableaux d'objets et la liste
des clés qui font l'identité, et rend `{ "added", "removed", "modified" }`.

Écrire cinq comparaisons spécialisées aurait produit cinq occasions de diverger — c'est le défaut
qu'a corrigé l'extraction du document canonique au §7 ter.2, et il n'est pas réintroduit ici. La clé
`workflow` du document n'étant pas un tableau, elle est enveloppée dans un tableau d'un élément et
passée au même algorithme, avec `id` pour identité.

#### 7 ter.11.6 Contrat d'API attendu, à mesurer

Les lignes ci-dessous sont le contrat que les preuves d'API de cette tranche doivent **observer**
sur la pile, avec les jetons réels obtenus par `POST /auth/v1/token?grant_type=password`.

| # | Appel | Profil | Attendu |
|---|---|---|---|
| a | `POST /rpc/compare_workflow_versions`, une version comparée à elle-même | `admin` | `200`, `identical` vrai, `summary` à zéro, six collections vides |
| b | deux versions dont la seconde ajoute une étape | `admin` | `200`, `identical` faux, l'étape en `changes.steps.added`, son document complet rendu |
| c | deux versions dont la seconde renomme une étape | `admin` | `200`, l'étape en `modified`, `attributes` portant le seul attribut changé, `before` et `after` exacts |
| d | deux versions dont la seconde retire une transition | `admin` | `200`, la transition en `changes.transitions.removed` |
| e | la même paire qu'en b, arguments **inversés** | `admin` | `200`, l'étape en `removed` et non en `added` — l'orientation est celle des arguments |
| f | comparaison lue par un `viewer` du workspace | `viewer` | `200` — la comparaison est une lecture, elle suit la politique de lecture |
| g | comparaison lue par un `business_developer` | `business_developer` | `200` |
| h | `base_version_id` inexistant | `admin` | `400`, `P0001`, `version introuvable` |
| i | `target_version_id` inexistant | `admin` | `400`, `P0001`, **le même message qu'en h** |
| j | une version d'un autre workspace | `admin` | `400`, `P0001`, **le même message qu'en h** — preuve de refus n° 3 |
| k | deux versions de workflows différents | `admin` | `400`, `P0001`, `versions de workflows differents` |
| l | appel anonyme | anonyme | `401` — le privilège refuse avant la vérification 1 |

#### 7 ter.11.7 Ce que cette tranche ne livre PAS

- **aucun écran**, ni aperçu de comparaison ni liste des versions : cinquième tranche. Aucune
  capture d'application n'est donc produite ici, et l'absence est nommée plutôt que compensée ;
- **aucun plan de remappage**, **aucune application**, **aucun retour arrière** : tranches 3 et 4 ;
- **aucune comparaison entre une version et la structure vivante**. Elle sera utile à l'écran de
  publication, mais elle a ses propres refus — la structure vivante n'est pas une ligne lisible par
  identifiant — et l'inventer ici l'aurait laissée sans spécification ;
- **aucun seed** : la comparaison ne conserve rien. Une seconde version publiée par le seed pour
  donner à comparer serait une donnée fabriquée pour la preuve, ce que `CLAUDE.md` §8 refuse ; les
  preuves publient elles-mêmes ce qu'elles comparent, par la vraie RPC.

#### 7 ter.11.8 Preuves attendues de la deuxième tranche

| Niveau | Preuves |
|---|---|
| pgTAP | Existence, volatilité `stable`, absence de `security definer`, privilèges et **révocation d'`anon`** ; les quatre refus contre des comptes réels ; l'algorithme sur les six collections — ajout, retrait, modification d'attribut, couples d'identité de `rules` et `required_fields` ; l'invariant `identical` dans les deux sens ; l'ordre déterministe des tableaux ; **une étape supprimée puis recréée rend un retrait et un ajout**, jamais un inchangé |
| API | Les douze lignes du §7 ter.11.6, hors interface, avec les jetons réels des trois profils |
| Seed | **Aucun** (§7 ter.11.7) |
| Interface | **Aucune** — cette tranche ne livre aucun écran |

### 7 ter.12 Troisième tranche — le plan de remappage des cards

Chapitre écrit **avant la première ligne de code** de cette tranche (`CLAUDE.md` §5), après mesure
sur la pile seedée. Les valeurs marquées MESURÉ ont été relevées en base le 2026-08-15.

#### 7 ter.12.1 Ce que le plan est, et ce qu'il n'est pas

Restaurer une version dans la structure vivante — quatrième tranche — signifie rendre le workflow
égal à la composition photographiée. Les étapes créées **depuis** la publication de cette version
n'y figurent pas : elles disparaîtront. Or des affaires s'y trouvent, et
`cards.current_step_id` est `not null` et lié par clé étrangère composite à une étape du workflow
(`docs/SPEC-cards.md` §3.3). Une restauration qui ne dirait rien de ces affaires échouerait en base,
ou pire, les déplacerait sans que personne l'ait demandé.

Le plan répond à cela, et **à cela seulement** : avant toute restauration, dire **card par card où
elle atterrit**, et nommer celles pour lesquelles la base ne le dit pas.

Ce qu'il **n'est pas** :

- ce n'est **pas** une application. Le plan est `stable`, il n'écrit **rien**, et il ne réserve
  rien. Appliquer est la quatrième tranche, et rejouer le plan juste avant d'appliquer y sera
  obligatoire — une structure vivante peut avoir bougé entre les deux ;
- ce n'est **pas** une comparaison de versions. Le §7 ter.11 compare deux **photographies** ; le
  plan confronte **une** photographie à la **structure vivante et aux affaires réelles** ;
- ce n'est **pas** une heuristique. Le plan ne propose **aucune** destination : il constate celles
  que l'identité impose, applique celles que l'appelant a explicitement données, et **refuse de
  deviner** le reste. C'est la lecture littérale de « aucune étape n'est devinée » dans la
  Definition of Done de `CRM-078`.

#### 7 ter.12.2 Les trois issues d'une card, et la seule qui soit automatique

Soit `V` l'ensemble des identifiants d'étapes de la version cible — la clé `steps` du document
(§7 ter.2) —, et `L` celui des étapes vivantes du workflow.

| Ensemble | Nom | Sens |
|---|---|---|
| `L \ V` | **étapes retirées** | vivantes aujourd'hui, absentes de la version : elles disparaîtront |
| `V \ L` | **étapes rétablies** | présentes dans la version, disparues depuis : la restauration les recréera, avec leur identifiant d'origine que le document conserve |
| `L ∩ V` | étapes conservées | de part et d'autre |

Chaque card du workflow reçoit alors **exactement une** des trois résolutions :

| Résolution | Condition | Destination |
|---|---|---|
| `unchanged` | `current_step_id ∈ V` | elle-même — la card ne bouge pas |
| `remapped` | `current_step_id ∈ L \ V` **et** l'appelant a fourni une instruction pour cette étape | l'étape nommée par l'instruction |
| `unresolved` | `current_step_id ∈ L \ V` **et** aucune instruction ne la couvre | **aucune**, et c'est la réponse |

`unchanged` est la **seule** issue automatique, et elle l'est parce qu'elle ne suppose rien :
l'étape existe des deux côtés, avec le même identifiant. Toute autre destination vient d'un humain.

**Aucune étape rétablie n'est jamais proposée comme destination par défaut.** Une étape que la
restauration ressuscite est vide par construction, et il serait tentant d'y verser les affaires des
étapes retirées « puisqu'elle revient ». Ce serait une supposition sur l'intention, exactement ce
que la Definition of Done interdit. Elle est **nommée** dans le plan, pour qu'un humain puisse la
choisir ; elle n'est jamais choisie à sa place.

#### 7 ter.12.3 Les instructions de remappage, et pourquoi elles portent sur les étapes

`step_overrides` est un tableau `jsonb` d'objets `{ "from_step_id": uuid, "to_step_id": uuid }`.

**C'est exactement la forme de `change_channel_workflow.step_mapping`** (`CRM-019`,
`docs/SPEC-change-channel-workflow.md`), et ce n'est pas une coïncidence : les deux gestes disent la
même chose — « les affaires de cette étape vont là » —, et deux formes différentes pour la même
décision auraient obligé tout écran à traduire l'une dans l'autre. Le contrôle de forme reprend le
même idiome, `pg_input_is_valid` plutôt qu'un `cast` sous `exception`.

L'instruction porte sur une **étape**, jamais sur une card. Deux motifs, et le second est le seul
qui compte :

1. le volume — un workflow peut porter des milliers d'affaires sur une poignée d'étapes, et exiger
   une instruction par affaire rendrait le geste inutilisable ;
2. **la décision est de même grain que le fait.** Ce qui disparaît est une étape ; ce qu'un
   administrateur décide est « les affaires de cette étape vont là ». Un remappage par card
   laisserait croire à un tri, alors que rien dans la base ne distingue deux affaires de la même
   étape.

Une instruction par card reste possible plus tard, sous sa propre spécification, si le produit en
montre le besoin. Elle n'est pas inventée ici.

Les instructions sont **validées, jamais interprétées** (§7 ter.12.4) : une `from_step_id` qui ne
disparaît pas est refusée plutôt que silencieusement appliquée, sans quoi le plan de restauration
déplacerait des affaires que la restauration n'oblige pas à déplacer — un geste de masse caché dans
un aperçu.

#### 7 ter.12.4 Le geste — `public.plan_card_remapping`

```
public.plan_card_remapping(
  target_version_id uuid,
  step_overrides    jsonb   default null,
  card_limit        integer default 200
) returns jsonb
```

`stable`, `search_path` vide, et **`security invoker`** — comme `compare_workflow_versions`
(§7 ter.11.3) et `previsualiser_exigence` (§7 bis.13.3), et **jamais** `security definer`.

Ce choix demande ici une justification que les deux précédents ne demandaient pas, parce que
**le plan doit être exhaustif ou il ne vaut rien** : un plan qui annoncerait « trois affaires
concernées » là où quarante le sont ferait échouer la restauration après l'avoir déclarée sûre. Or
`public.cards` applique les droits fins dès sa politique de lecture — `app.can_read_channel`. La
question est donc : `security invoker` rend-il un plan **complet** ?

Oui, et uniquement parce que le plan est réservé aux administrateurs (vérification 3). La règle 2 de
`app.resolve_access` (`docs/SPEC-permissions-rls.md` §2.2) énonce qu'**un administrateur n'est jamais
restreint**, et elle s'applique **avant** les droits fins. MESURÉ sur la pile seedée, et c'est la
mesure qui tranche : le seed pose `track_members.access = 'none'` pour l'administratrice sur le track
« Conseil & IA », dont le channel « Grands comptes » porte **six** des treize affaires du workflow
par défaut ; l'administratrice en lit néanmoins **13 sur 13**, tandis que la lectrice n'en lit que
**7 sur 13**.

Deux conséquences, et il faut les dire ensemble :

- appelé par une administratrice, le plan est **exhaustif**, sans qu'aucun `security definer` n'ait
  eu à emprunter des droits ;
- appelé par un membre ordinaire, il serait **partiel** — d'où la vérification 3, qui n'est pas une
  formalité d'autorisation mais **la condition de justesse du résultat**.

Une assertion pgTAP fige `prosecdef = false`, et une autre compte les treize affaires sous le compte
réel de l'administratrice malgré son droit fin `none` : le jour où quelqu'un poserait
`security definer` pour « simplifier », les deux règles diraient la même chose de deux façons, et
elles finiraient par diverger.

Exécution accordée à `authenticated` et à `service_role` ; **révoquée de `public` et d'`anon`** — la
révocation nommée est obligatoire, le `grant execute` par défaut de l'image portant sur `anon` aussi
(§4.7, décision 80).

Les vérifications, **dans cet ordre**, et ce que chacune rend :

| # | Vérification | Refus | `SQLSTATE` | HTTP |
|---|---|---|---|---|
| 1 | l'appelant est authentifié — `auth.uid()` non nul | `authentification requise` | `42501` | `403` (anonyme : `401`, le privilège refuse d'abord) |
| 2 | la version cible existe **et** l'appelant est membre de son workspace — `app.is_workspace_member` | `version introuvable` | `P0001` | `400` |
| 3 | l'appelant est administrateur du workspace de la version — `app.is_workspace_admin` | `plan reserve aux administrateurs` | `42501` | `403` |
| 4 | `card_limit` est compris entre 1 et 1000 | `limite invalide` | `P0001` | `400` |
| 5 | `step_overrides`, s'il est fourni, est un tableau d'objets portant deux `uuid` valides | `remappage invalide` | `P0001` | `400` |
| 6 | aucune `from_step_id` n'apparaît deux fois | `remappage ambigu` | `P0001` | `400` |
| 7 | chaque `from_step_id` est une étape **retirée** du workflow de la version | `origine de remappage inconnue` | `P0001` | `400` |
| 8 | chaque `to_step_id` est une étape **de la version** | `cible de remappage absente de la version` | `P0001` | `400` |

La vérification 2 rend le même refus qu'une version d'un autre workspace : la RLS ne la donne pas à
lire, `not found` s'ensuit, et la fonction n'est pas un oracle d'existence (§4.3). Elle précède la
vérification 3, faute de quoi le message d'administration révélerait l'existence d'une version
d'autrui.

`P0002` n'est employé nulle part : il est rendu en `500` par PostgREST (§4.4).

**La vérification 7 est refusée et non ignorée, et c'est une décision.** Une instruction visant une
étape qui survit à la restauration est soit une erreur de l'appelant, soit un déplacement de masse
déguisé ; l'accepter en silence ferait du plan un geste d'écriture par procuration. Le refus est
donc explicite, et il nomme l'étape en cause dans son `detail`.

**Un workflow archivé n'est PAS un motif de refus.** Publier sur un workflow archivé est refusé
(§7 ter.5, vérification 4) parce que publier écrit ; planifier ne fait que lire, et interdire à un
administrateur de regarder ce qu'une restauration ferait n'aurait protégé personne. La quatrième
tranche portera ses propres refus d'application.

#### 7 ter.12.5 Quelles cards entrent dans le plan

**Toutes les cards du workflow de la version, y compris les archivées et celles en corbeille.**

Ce n'est pas un oubli de filtre, c'est la seule réponse juste : une card archivée et une card en
corbeille portent l'une comme l'autre un `current_step_id` réel et une clé étrangère opposable
(`docs/SPEC-cards.md` §4 — archiver et supprimer sont deux suppressions **douces**, aucune ligne ne
disparaît). Les exclure rendrait un plan qui se dit complet et une restauration qui échoue en base
sur une affaire que personne ne regardait plus.

Chaque card porte donc son `state`, calculé dans cet ordre de priorité :

| `state` | Condition |
|---|---|
| `deleted` | `deleted_at is not null` — la corbeille l'emporte, une card supprimée puis archivée reste supprimée |
| `archived` | sinon, `archived_at is not null` |
| `active` | sinon |

MESURÉ sur la pile seedée : le workflow par défaut porte **13** affaires, dont **une archivée** à
l'étape « Livré » et **une en corbeille** à l'étape « Prospection ». Une preuve les compte
explicitement.

#### 7 ter.12.6 Ce que la fonction rend

Un objet `jsonb` à cinq clés de premier niveau :

```
{
  "version": { "version_id", "version_number", "workflow_id", "published_at",
               "composition_fingerprint" },
  "ready":   true | false,
  "summary": { "cards_total", "cards_unchanged", "cards_remapped", "cards_unresolved",
               "steps_removed", "steps_restored" },
  "steps":   {
    "removed":  [ { "step_id", "label", "cards_total", "cards_unresolved",
                    "target_step_id" | null } ],
    "restored": [ { "step_id", "label" } ]
  },
  "cards":   { "total", "returned", "truncated", "limit",
               "items": [ { "card_id", "title", "state", "channel_id",
                            "current_step_id", "target_step_id" | null, "resolution" } ] }
}
```

`ready` est vrai **si et seulement si** `summary.cards_unresolved = 0`. Il ne dit pas que la
restauration réussira — la quatrième tranche a ses propres refus, et la structure vivante peut
bouger entre le plan et son application ; il dit que **plus aucune affaire n'attend une décision
humaine**.

`label` d'une étape retirée est `coalesce(label_override, node_label)` **lu sur la structure
vivante** ; celui d'une étape rétablie est lu **dans le document de la version**, seul endroit où il
subsiste. C'est précisément à cela que sert la conservation du document entier (§7 ter.11.4) : un
écran doit pouvoir nommer une étape que la base ne porte plus.

**Les compteurs de `summary` et de `steps` portent sur la TOTALITÉ des affaires**, jamais sur la
seule page rendue. Un plan dont le verdict dépendrait de la taille de la page ne serait pas un
verdict.

#### 7 ter.12.7 La liste des cards est bornée, et sa troncature est annoncée

Compter est borné par le nombre d'étapes ; **lister ne l'est pas**. Un workflow peut porter des
milliers d'affaires, et les rendre toutes serait une lecture non bornée que `CLAUDE.md` §21 refuse.

La liste est donc limitée à `card_limit`, dont le défaut est **200** et le maximum **1000**
(vérification 4). `cards.total` porte le compte réel, `cards.returned` le nombre rendu, et
`cards.truncated` dit s'il manque quelque chose. **Une troncature silencieuse serait un mensonge** :
elle ferait lire « voici les affaires concernées » là où il faut lire « en voici les deux cents
premières ».

**L'ordre est déterministe, et il place les blocages en tête** : `unresolved`, puis `remapped`, puis
`unchanged` ; à résolution égale, par `current_step_id` puis par `card_id`. Ce n'est pas une
commodité d'affichage. Si la liste est tronquée, ce qu'un humain doit voir en premier est
**exactement ce qui l'empêche d'appliquer** ; un ordre par titre ou par date pourrait reléguer les
seules affaires bloquantes au-delà de la coupure et rendre un plan qui a l'air sain.

#### 7 ter.12.8 Autorisations

| Opération | `anon` | `viewer` / `business_developer` | `admin` | `service_role` |
|---|---|---|---|---|
| `plan_card_remapping` | `401` — le privilège refuse | `403`, `42501` — vérification 3 | `200` | accordé |

La lecture des versions suit `app.is_workspace_member` (§7 ter.6), mais **planifier est une
prérogative d'administration** : le geste prépare une restauration, et son résultat n'est juste que
sous le seul profil qui lit toutes les affaires (§7 ter.12.4).

#### 7 ter.12.9 Contrat d'API attendu, à mesurer

Les lignes ci-dessous sont le contrat que les preuves d'API de cette tranche doivent **observer**
sur la pile, avec les jetons réels obtenus par `POST /auth/v1/token?grant_type=password`.

| # | Appel | Profil | Attendu |
|---|---|---|---|
| a | `POST /rpc/plan_card_remapping` sur la version du seed, sans instruction | `admin` | `200`, `ready` vrai, `cards_unresolved` à zéro, aucune étape retirée, et `cards_total` **égal au compte lu par la clé de service** — la mesure de l'exhaustivité |
| b | sur une fixture portant quatre affaires dont une archivée et une en corbeille | `admin` | `200`, `cards.items` portant les quatre, chacune avec son `state`, toutes `unchanged` |
| c | plan contre une version **antérieure** à l'ajout d'une étape, les affaires ayant été déplacées sur la nouvelle | `admin` | `200`, `ready` **faux**, l'étape en `steps.removed`, les affaires en `unresolved` avec `target_step_id` nul |
| d | le même plan avec une instruction couvrant l'étape retirée | `admin` | `200`, `ready` **vrai**, les affaires en `remapped` vers l'étape nommée |
| e | `card_limit` à 1 sur un plan portant treize affaires | `admin` | `200`, `returned` 1, `total` 13, `truncated` vrai, et l'affaire rendue est bien la première de l'ordre du §7 ter.12.7 |
| f | `card_limit` à 0 | `admin` | `400`, `P0001`, `limite invalide` |
| g | `step_overrides` qui n'est pas un tableau | `admin` | `400`, `P0001`, `remappage invalide` |
| h | deux instructions sur la même `from_step_id` | `admin` | `400`, `P0001`, `remappage ambigu` |
| i | instruction dont la `from_step_id` est une étape **conservée** | `admin` | `400`, `P0001`, `origine de remappage inconnue` |
| j | instruction dont la `to_step_id` est absente de la version | `admin` | `400`, `P0001`, `cible de remappage absente de la version` |
| k | `POST /rpc/plan_card_remapping` | `business_developer` | `403`, `42501`, `plan reserve aux administrateurs` |
| l | `POST /rpc/plan_card_remapping` | `viewer` | `403`, `42501`, **le même message qu'en k** |
| m | version inexistante | `admin` | `400`, `P0001`, `version introuvable` |
| n | version d'un autre workspace | `admin` | `400`, `P0001`, **le même message qu'en m** — preuve de refus n° 3 |
| o | appel anonyme | anonyme | `401` — le privilège refuse avant la vérification 1 |

La ligne n est la contrepartie de la règle du §7 ter.12.4 : le message doit être **identique** à
celui de m, sans quoi la fonction dirait à l'appelant qu'une version existe ailleurs.

**Aucun compte du seed n'est figé en dur dans ces preuves.** La ligne a compare le `cards_total`
rendu à l'administratrice au compte lu **par la clé de service**, laquelle ignore la RLS : c'est la
mesure de l'exhaustivité, et elle reste juste au premier ajout du seed. Les lignes b à e portent sur
une fixture créée et rendue par la preuve elle-même.

#### 7 ter.12.10 Ce que cette tranche ne livre PAS

- **aucune application, aucun retour arrière** : quatrième tranche. Le plan est `stable` et n'écrit
  rien, pas même une réservation ;
- **aucun écran**, ni liste des versions, ni aperçu du plan : cinquième tranche. Aucune capture
  d'application n'est donc produite ici, et l'absence est nommée plutôt que compensée ;
- **aucune instruction par card** : le remappage porte sur les étapes (§7 ter.12.3) ;
- **aucun plan contre la structure vivante** prise comme cible — le plan confronte une version à la
  structure vivante, jamais deux structures vivantes ;
- **aucun seed** : le plan ne conserve rien, et publier une seconde version ou déplacer une affaire
  pour donner un plan bloqué à montrer serait une donnée fabriquée pour la preuve, ce que
  `CLAUDE.md` §8 refuse. Les preuves construisent elles-mêmes ce qu'elles planifient, par les vrais
  gestes.

#### 7 ter.12.11 Preuves attendues de la troisième tranche

| Niveau | Preuves |
|---|---|
| pgTAP | Existence, volatilité `stable`, **absence de `security definer`**, privilèges et révocation d'`anon` ; les huit refus contre des comptes réels ; **l'exhaustivité sous droit fin `none`** — treize affaires comptées par l'administratrice malgré son `track_members.access = 'none'` ; les archivées et celles en corbeille présentes avec leur `state` ; `unchanged` sur une version égale à la structure vivante ; `unresolved` puis `remapped` sur une étape retirée ; `ready` dans les deux sens ; l'ordre déterministe et la troncature annoncée |
| API | Les quinze lignes du §7 ter.12.9, hors interface, avec les jetons réels des trois profils ; preuve de refus n° 3 au niveau des versions |
| Seed | **Aucun** (§7 ter.12.10) |
| Interface | **Aucune** — cette tranche ne livre aucun écran |

### 7 ter.13 Quatrième tranche — l'application transactionnelle du plan, et son retour arrière

Chapitre écrit **avant la première ligne de code** de cette tranche (`CLAUDE.md` §5), après mesure
sur la pile seedée. Les valeurs marquées MESURÉ ont été relevées en base le 2026-08-15.

#### 7 ter.13.1 Ce que l'application est, et ce qu'elle n'est pas

Les trois premières tranches ont conservé une photographie (§7 ter.3), su la comparer (§7 ter.11) et
su dire où chaque affaire atterrirait (§7 ter.12). Aucune n'écrit. Cette tranche est celle qui
**écrit** : elle rend la composition vivante du workflow égale à celle que la version a photographiée,
et elle le fait **en une transaction, ou pas du tout**.

Ce qu'elle **n'est pas** :

- ce n'est **pas** une activation. Le §7 ter.1 dit qu'une version est un témoin et non une cible
  d'exécution, et cela reste vrai : après la restauration, les cards circulent toujours sur la
  structure vivante — c'est **cette structure** qui a changé, pas la manière dont on la parcourt ;
- ce n'est **pas** un déplacement métier. Une affaire remappée ne franchit **aucune arête** : elle
  est déposée par une décision d'administration. Aucune règle de transition, aucun champ requis,
  aucun commentaire exigé ne s'applique — exactement comme `change_channel_workflow` (`CRM-019`),
  pour la même raison, et le trigger `card_events_apres_maj` écrit un événement `moved` sans que
  cette fonction ait à en fabriquer un ;
- ce n'est **pas** un « annuler » de l'éditeur. L'éditeur de `CRM-076` défait un geste ; la
  restauration rétablit un **état** publié, daté et attribué ;
- ce n'est **pas** une suppression de la version. Restaurer ne consomme pas la photographie : elle
  reste lisible, et rien n'interdit de la restaurer deux fois.

#### 7 ter.13.2 Le plan est REJOUÉ dans la transaction, et c'est la règle de fond

Le §7 ter.12.1 l'annonçait : « rejouer le plan juste avant d'appliquer y sera obligatoire — une
structure vivante peut avoir bougé entre les deux ».

Un plan calculé à 14 h 03 et appliqué à 14 h 09 décrit un monde qui n'existe peut-être plus : un
autre administrateur a pu créer une étape, en supprimer une, ou déplacer une affaire. Appliquer un
plan périmé, c'est appliquer une décision prise sur des faits faux.

La restauration **appelle donc `public.plan_card_remapping` elle-même**, dans sa propre transaction,
avec les `step_overrides` que l'appelant lui donne, et **exige que le plan rendu soit `ready`**.
Elle n'accepte aucun plan pré-calculé : un plan transmis par l'appelant serait une affirmation sur
l'état de la base, et une affirmation ne se vérifie pas moins cher qu'elle ne se recalcule.

**Conséquence directe, et elle est voulue : les huit refus du §7 ter.12.4 sont ceux de la
restauration.** `remappage invalide`, `remappage ambigu`, `origine de remappage inconnue`,
`cible de remappage absente de la version` remontent tels quels, avec leur message et leur
`SQLSTATE`. Les réécrire aurait donné deux formulations de la même règle, qui finissent toujours par
diverger — c'est le défaut qu'a corrigé l'extraction du document canonique en §7 ter.2, et il n'est
pas réintroduit ici.

**La concurrence est tenue par un verrou, comme pour publier.** La fonction sérialise sur le
workflow — `select … from public.workflows where id = … for update` — **avant** de rejouer le plan.
Sans ce verrou, deux restaurations simultanées liraient la même structure vivante et la seconde
écraserait la première sans le savoir. C'est le même geste qu'au §7 ter.5, pour le même motif.

L'appelant peut en outre transmettre `expected_live_fingerprint` : l'empreinte de la structure
vivante **telle qu'il l'a vue** lorsqu'il a demandé le plan. Fournie, elle est comparée à l'empreinte
courante, et une divergence est un refus. C'est une concurrence **optimiste**, facultative et non
imposée : un écran responsable la fournira, un script d'administration pourra s'en passer.

#### 7 ter.13.3 Ce que la restauration touche, et ce qu'elle ne touche pas

Le document canonique porte six clés (§7 ter.2). La restauration en écrit **cinq** :

| Clé | Restaurée ? |
|---|---|
| `steps` | oui |
| `transitions` | oui |
| `fields` | oui, **sans jamais supprimer** (§7 ter.13.4) |
| `rules` | oui |
| `required_fields` | oui |
| `workflow` | **non** |

**La clé `workflow` n'est pas restaurée, et c'est une décision.** Elle porte `name`, `scope`,
`track_id`, `is_default` et `archived_at` : l'**identité** et le **placement** du workflow, non sa
composition. Rétablir `track_id` déménagerait le workflow d'un track à l'autre ; rétablir
`is_default` désignerait un autre workflow par défaut du workspace ; rétablir `archived_at`
désarchiverait. Aucun de ces trois gestes n'est une restauration de composition, et chacun a — ou
aura — son propre geste, avec ses propres refus. Une restauration qui les emporterait au passage
serait un déménagement caché dans un rétablissement.

La conséquence est dite plutôt que masquée : **après une restauration, l'empreinte vivante peut
différer de celle de la version** si le nom du workflow a changé depuis. La fonction rend
l'empreinte obtenue et un booléen `matches_version` qui le dit (§7 ter.13.8). Un produit qui
prétendrait à l'égalité sans la mesurer mentirait.

#### 7 ter.13.4 Les champs ne sont JAMAIS supprimés, et ce n'est pas un choix de prudence

Un champ créé **depuis** la publication ne figure pas dans la version. La lecture naïve de
« rendre le workflow égal à la photographie » voudrait qu'il disparaisse. **Il ne disparaît pas :
il est archivé.**

Deux motifs, et le second retire toute discussion :

1. `card_field_values` porte les **saisies** des utilisateurs. `docs/SPEC-form-composer.md` §5 et la
   migration `0009` l'énoncent : « les valeurs saisies survivent à l'archivage ; les effacer par
   cascade serait une perte de données silencieuse ». Supprimer un champ pour rétablir une structure
   détruirait des données métier qu'aucune version ne conserve — le document canonique ne porte
   **aucune** valeur (§7 ter.2) ;
2. **MESURÉ sur la pile seedée, et c'est la mesure qui tranche** : `public.form_fields` ne porte
   **aucune politique `delete`** — `form_fields_lecture_membre`, `form_fields_insertion_admin`,
   `form_fields_maj_admin`, et rien d'autre — et `authenticated` n'a que `SELECT`, `INSERT`,
   `UPDATE`. La suppression d'un champ **n'existe pas** dans ce produit. Le point 1 n'est donc pas
   une préférence de conception : c'est le schéma qui refuse, depuis `CRM-035`.

Symétriquement, un champ **présent dans la version et archivé depuis** est **désarchivé** :
`archived_at` repasse à `NULL`. C'est bien la restauration de son état photographié, et elle ne perd
rien.

Un champ présent dans la version et **absent de la base** — cas qu'aucun geste du produit ne peut
produire aujourd'hui, la suppression n'existant pas — est **recréé** avec son identifiant d'origine,
que le document conserve.

Les autres collections n'ont pas ce problème et sont donc restaurées **exactement**, suppressions
comprises : une arête, une règle de visibilité ou un champ requis ne portent **aucune donnée
utilisateur**. Les supprimer ne détruit que de la structure, et c'est précisément ce qu'on demande.

#### 7 ter.13.5 Le retour arrière est un point de retour PUBLIÉ, et non un journal parallèle

La Definition of Done exige « application transactionnelle, retour arrière ». Deux lectures
s'offraient, et la seconde est retenue :

1. **conserver l'état d'avant dans une table dédiée** — `workflow_restorations`, avec le document
   d'avant et un geste d'annulation. C'est **refusé** : ce serait une seconde forme de conservation
   d'une composition, à côté de `workflow_versions` qui existe pour cela. Deux mécanismes pour la
   même chose divergent toujours, et l'un des deux finit non testé ;
2. **publier la composition vivante comme une version, avant d'écrire.** C'est retenu. Le retour
   arrière n'est alors **pas un geste de plus** : c'est la restauration elle-même, appliquée au point
   de retour. Rien n'est inventé, et le mécanisme d'annulation est **le même code**, donc éprouvé par
   les mêmes preuves.

Le point de retour est publié par `public.publish_workflow_version` — la vraie RPC, jamais une
insertion directe que les privilèges refusent de toute façon (§7 ter.4) —, avec une `note` qui dit ce
qu'il est. Il est publié **si et seulement si** la composition vivante diffère de la dernière version
publiée : lorsqu'elles sont égales, cette dernière version **est** déjà le point de retour, et en
publier une seconde indiscernable est exactement ce que la vérification 5 du §7 ter.5 interdit.

La fonction rend `rollback_version`, l'identifiant et le numéro du point de retour — ou `null`
lorsqu'il n'y avait rien à publier, **avec** dans ce cas le numéro de la version qui joue ce rôle.

**La transactionnalité, elle, n'a pas besoin d'être construite** : une fonction PL/pgSQL s'exécute
dans la transaction de l'appel, et toute exception défait l'ensemble. Ce qui doit être construit,
c'est l'**ordre** des écritures (§7 ter.13.7), sans quoi la transaction échouerait sur ses propres
contraintes au lieu d'aboutir.

#### 7 ter.13.6 Le geste — `public.restore_workflow_version`

```
public.restore_workflow_version(
  target_version_id         uuid,
  step_overrides            jsonb default null,
  expected_live_fingerprint text  default null
) returns jsonb
```

`volatile`, `search_path` vide, et **`security definer`** — à l'inverse des trois gestes précédents
de ce chapitre.

**Ce choix a été retourné par la mesure, et le motif est écrit ici plutôt que corrigé en silence.**
La première rédaction de ce paragraphe retenait `security invoker`, au motif — exact — que les tables
de structure portent toutes leurs politiques d'écriture d'administrateur :
`workflow_steps_insertion_admin`, `workflow_steps_maj_admin`, `workflow_steps_suppression_admin` et
leurs équivalentes sur `workflow_transitions`, `form_fields`, `form_field_rules` et
`workflow_transition_required_fields`. Un administrateur écrit en effet **toute la structure** par
ces politiques, comme l'éditeur de `CRM-076`.

Mais la restauration n'écrit pas que la structure : elle **déplace des affaires**. Et MESURÉ le
2026-08-15 sur la pile seedée, `authenticated` ne détient l'`UPDATE` sur `public.cards` que
**colonne par colonne**, sur douze colonnes — `title`, `description`, `owner_id`, `amount`,
`currency`, `probability_override`, `next_action`, `next_action_at`, `position`, `archived_at`,
`deleted_at`, `snoozed_until`. **`current_step_id` n'en fait pas partie**, ni `workflow_id`, ni
`channel_id`, ni `entered_step_at` : c'est le privilège de colonne posé par `CRM-034` qui ferme le
`PATCH` direct d'une affaire (INC-046), et c'est exactement pourquoi `move_card`,
`move_card_to_channel` et `change_channel_workflow` sont **toutes les trois** `security definer`.

Un `security invoker` échouerait donc en `42501` sur la deuxième écriture, quel que soit
l'appelant — y compris un administrateur. Restaurer déplace des affaires : le geste rejoint cette
famille, et non celle des lectures.

**Ce que ce choix oblige à écrire à la main, et qui n'est pas négociable.** Sous `security definer`,
la RLS ne fait plus le travail de la vérification 2 : la fonction verrait une version de n'importe
quel workspace. La vérification 2 porte donc explicitement `app.is_workspace_member`, comme
`publish_workflow_version` la porte déjà (§7 ter.5, vérification 2), et rend `version introuvable`
dans les deux cas. Sans cela, un identifiant d'autrui tomberait sur le refus d'administration et la
fonction deviendrait l'oracle d'existence que tout ce chapitre refuse d'être.

**Et le plan rejoué change de nature, ce qui doit être dit.** Appelé depuis un `security definer`
dont le propriétaire est `postgres`, `plan_card_remapping` ne s'exécute plus sous la RLS de
l'appelant : son exhaustivité ne repose plus sur la règle 2 d'`app.resolve_access` mais sur le
propriétaire. Ce n'est pas une régression — le plan reste exhaustif, et sa vérification 3 refuse
toujours un non-administrateur, `auth.uid()` étant inchangé. Mais **ce n'est plus pour son
exhaustivité qu'il est rejoué ici** : c'est pour ses **huit refus** et pour son verdict `ready`,
qui sont la seule formulation de la règle de remappage (§7 ter.13.2).

Exécution accordée à `authenticated` et à `service_role` ; **révoquée de `public` et d'`anon`** — la
révocation nommée est obligatoire (§4.7, décision 80).

Les vérifications, **dans cet ordre**, et ce que chacune rend :

| # | Vérification | Refus | `SQLSTATE` | HTTP |
|---|---|---|---|---|
| 1 | l'appelant est authentifié — `auth.uid()` non nul | `authentification requise` | `42501` | `403` (anonyme : `401`, le privilège refuse d'abord) |
| 2 | la version cible existe **et** l'appelant est membre de son workspace — `app.is_workspace_member` | `version introuvable` | `P0001` | `400` |
| 3 | l'appelant est administrateur du workspace de la version | `restauration reservee aux administrateurs` | `42501` | `403` |
| 4 | le workflow n'est pas archivé | `workflow archive` | `P0001` | `400` |
| 5 | `expected_live_fingerprint`, s'il est fourni, égale l'empreinte vivante | `structure modifiee depuis le plan` | `PT409` | `409` |
| 6 | les huit refus de `plan_card_remapping`, **remontés tels quels** | leurs messages | leurs `SQLSTATE` | `400`/`403` |
| 7 | le plan rejoué est `ready` | `plan non applicable` | `P0001` | `400` |
| 8 | chaque étape rétablie désigne un nœud de catalogue existant | `noeud de catalogue introuvable` | `P0001` | `400` |

La vérification 2 rend le même refus qu'une version d'un autre workspace, et précède la
vérification 3 : la règle du §7 ter.12.4 est inchangée, la fonction n'est pas un oracle d'existence.
Elle est ici écrite **à la main** et non déléguée à la RLS, pour le motif du paragraphe précédent.

**La vérification 4 diffère de celle du plan, et c'est cohérent.** Planifier ne fait que lire, et le
§7 ter.12.4 refuse explicitement d'interdire à un administrateur de regarder ce qu'une restauration
ferait sur un workflow archivé. Restaurer **écrit** : un workflow archivé est un workflow qu'on a
sorti du service, et le réécrire en silence n'a pas de sens. Le refus est ici, et pas là-bas.

**La vérification 5 est la seule qui rende `409`**, et c'est le code juste : la demande était valide,
c'est l'état du monde qui a changé sous elle. Un `400` laisserait croire à une erreur de l'appelant.

**Et c'est le seul refus dont le `SQLSTATE` n'est pas `P0001` — révision du 2026-08-15, imposée par
la mesure.** La première rédaction de ce tableau exigeait `P0001` **et** `409`. MESURÉ par une sonde
posée puis retirée sur la pile locale : PostgREST rend **`400`** pour tout `P0001`, et **`409`** pour
un `SQLSTATE` de la forme `PT<statut>` — le seul mécanisme par lequel une fonction choisit son code
HTTP. Les deux exigences étaient donc inconciliables, et le refus rendait `400` en pratique : le
harnais d'API de la quatrième tranche l'a constaté avant qu'aucune session ne l'ait remarqué.

**C'est le `SQLSTATE` qui cède, et le motif se lit dans le texte même de cette section.** Le `409` y
est **argumenté** — un `400` mentirait à l'appelant sur la nature de l'échec. Le `P0001` ne l'est
nulle part : c'est la valeur par défaut de `raise exception`, écrite par symétrie avec les sept
autres lignes. Entre une exigence raisonnée et une valeur par défaut, c'est la valeur par défaut qui
s'efface. Le message et le `detail` sont inchangés — seul le véhicule du statut change —, et
l'assertion pgTAP qui figeait `P0001` a été **révisée avec son motif dans le fichier**, jamais
contournée.

**La vérification 7 ne se contente pas d'un compteur.** Son `detail` nomme le nombre d'affaires non
résolues **et** les étapes retirées qui les portent : un refus qui dirait seulement « plan non
applicable » obligerait l'appelant à redemander le plan pour savoir quoi corriger.

**La vérification 8 existe parce qu'une étape rétablie porte un `node_id`**, et que
`workflow_steps` le lie au catalogue par une clé `on delete restrict`. MESURÉ : le catalogue ne porte
lui non plus **aucune politique `delete`**, donc le cas ne peut pas se produire par un geste du
produit ; il le pourrait par une purge d'administration. Le contrôle explicite rend alors un refus
lisible plutôt qu'un `23503` brut, comme le veut `CLAUDE.md` §20.

#### 7 ter.13.7 L'ordre des écritures, et pourquoi il n'est pas commutatif

Chaque étape de cet ordre est imposée par une contrainte **mesurée**, non par un goût de séquence.

| # | Écriture | Ce qui l'impose |
|---|---|---|
| 1 | publier le point de retour | il doit photographier la structure **d'avant** (§7 ter.13.5) |
| 2 | déplacer les affaires des étapes retirées vers leur cible | MESURÉ : `cards_current_step_id_workflow_id_fkey` est `NO ACTION` — supprimer une étape qui porte encore une affaire échoue en `23503`. C'est ce fait, et lui seul, qui rend le plan obligatoire |
| 3 | `is_initial` remis à faux sur toutes les étapes vivantes | MESURÉ : `workflow_steps_workflow_initial_uk`, index unique **partiel** sur `(workflow_id) where is_initial`. Rétablir l'étape initiale de la version avant d'avoir défait l'actuelle échoue en `23505` |
| 4 | supprimer les étapes retirées | leur suppression emporte en cascade leurs arêtes et leurs règles, ce qui allège les étapes 6 et 7 |
| 5 | créer les étapes rétablies, puis mettre à jour les étapes conservées | `workflow_steps_workflow_id_node_id_key` : un nœud n'apparaît qu'une fois par workflow. Une étape rétablie peut réclamer le nœud d'une étape retirée — d'où la suppression **avant** la création |
| 6 | arêtes : supprimer, créer, mettre à jour | leurs deux extrémités doivent exister, donc après les étapes |
| 7 | champs : désarchiver, recréer, mettre à jour, **archiver** les surnuméraires | jamais de suppression (§7 ter.13.4) |
| 8 | règles de visibilité : supprimer, créer, mettre à jour | elles lient un champ **et** une étape, donc après les deux |
| 9 | champs requis : supprimer, créer | ils lient une arête et un champ, donc après les deux |

**Aucune ligne n'est détruite puis recréée à l'identique.** Vider une collection pour la réécrire
serait plus court à écrire et faux à l'usage : les identifiants survivraient peut-être, mais les
`created_at` seraient réécrits, les cascades emporteraient des lignes filles que la restauration
devrait ensuite deviner, et une arête reconstruite serait une arête nouvelle pour tout ce qui la
référence. La restauration **différencie** : ce qui doit disparaître, ce qui doit naître, ce qui doit
changer — et ce qui ne doit rien faire ne subit rien.

#### 7 ter.13.8 Ce que la fonction rend

Un objet `jsonb` :

```
{
  "version":          { "version_id", "version_number", "workflow_id",
                        "composition_fingerprint" },
  "rollback_version": { "version_id", "version_number", "published" } ,
  "cards":            { "remapped" },
  "steps":            { "created", "deleted", "updated" },
  "transitions":      { "created", "deleted", "updated" },
  "fields":           { "created", "unarchived", "archived", "updated" },
  "rules":            { "created", "deleted", "updated" },
  "required_fields":  { "created", "deleted" },
  "fingerprint_after": "…",
  "matches_version":   true | false
}
```

`rollback_version.published` dit si le point de retour a été **publié par cet appel** (§7 ter.13.5) ;
lorsqu'il est faux, `version_id` et `version_number` désignent la version qui jouait déjà ce rôle.
La clé n'est jamais nulle : il y a **toujours** un point vers lequel revenir, et le produit doit
pouvoir le nommer.

**Chaque compteur compte ce que SON instruction a écrit, et rien d'autre.** MESURÉ : supprimer une
étape emporte ses arêtes et ses règles **en cascade** ; lorsque la restauration retire une étape,
`transitions.deleted` rend donc `0` alors qu'une arête a bel et bien disparu. Ce n'est pas une
lacune, c'est le seul comptage qui ne mente pas dans les deux sens : compter la cascade obligerait à
la recompter ligne à ligne, et compter la ligne deux fois — une fois sous `steps`, une fois sous
`transitions` — ferait lire deux suppressions là où l'administrateur n'en a demandé qu'une. Le
compteur dit « voici ce que j'ai effacé moi-même » ; `fingerprint_after` dit le résultat.

`fingerprint_after` est l'empreinte **recalculée après écriture**, jamais celle de la version
recopiée. `matches_version` est vrai lorsque les deux coïncident. Il peut être faux **sans qu'aucune
erreur n'ait eu lieu** — la clé `workflow` n'est pas restaurée (§7 ter.13.3), et un champ
surnuméraire archivé reste dans le document avec son `archived_at`. Rendre ce booléen plutôt que de
prétendre à l'égalité est la seule réponse honnête, et une assertion l'éprouve **dans les deux
sens**.

#### 7 ter.13.9 Autorisations

| Opération | `anon` | `viewer` / `business_developer` | `admin` | `service_role` |
|---|---|---|---|---|
| `restore_workflow_version` | `401` — le privilège refuse | `403`, `42501` — vérification 3 | `200` | accordé |

Restaurer est une prérogative d'administration, pour un motif plus fort encore que planifier : le
geste **écrit** la structure de travail de tout un channel.

#### 7 ter.13.10 Contrat d'API attendu, à mesurer

| # | Appel | Profil | Attendu |
|---|---|---|---|
| a | `POST /rpc/restore_workflow_version` sur la version du seed, structure vivante inchangée | `admin` | `200`, tous les compteurs à zéro, `rollback_version.published` **faux**, `matches_version` vrai |
| b | après ajout d'une étape et d'une arête, restauration de la version de référence | `admin` | `200`, `steps.deleted` 1, **`transitions.deleted` 0** — l'arête est partie en cascade avec son étape (§7 ter.13.8) —, `rollback_version.published` **vrai** |
| c | l'empreinte vivante après b, republiée par la vraie RPC et relue en base | clé de service | égale à `composition_fingerprint` de la version |
| d | restauration du point de retour rendu en b | `admin` | `200`, l'étape et l'arête **réapparaissent** avec leurs identifiants d'origine — le retour arrière |
| e | restauration d'une version antérieure à une étape portant des affaires, sans instruction | `admin` | `400`, `P0001`, `plan non applicable` |
| f | le même appel avec l'instruction qui lève le blocage | `admin` | `200`, `cards.remapped` égal au nombre d'affaires de l'étape retirée, relu **en base** |
| g | après f, la timeline des affaires déplacées | clé de service | un événement `moved` par affaire, écrit par le trigger et non par la fonction |
| h | restauration d'une version dont un champ a été ajouté depuis | `admin` | `200`, `fields.archived` 1, `fields.created` 0, et le champ **existe toujours** avec son `archived_at` |
| i | `expected_live_fingerprint` périmée | `admin` | `409`, `PT409`, `structure modifiee depuis le plan` — le seul refus dont le `SQLSTATE` n'est pas `P0001`, et c'est ce qui produit le `409` (§7 ter.13.6) |
| j | `expected_live_fingerprint` exacte | `admin` | `200` |
| k | `step_overrides` qui n'est pas un tableau | `admin` | `400`, `P0001`, `remappage invalide` — le refus du plan, remonté tel quel |
| l | instruction dont la `to_step_id` est absente de la version | `admin` | `400`, `P0001`, `cible de remappage absente de la version` |
| m | `POST /rpc/restore_workflow_version` | `business_developer` | `403`, `42501`, `restauration reservee aux administrateurs` |
| n | `POST /rpc/restore_workflow_version` | `viewer` | `403`, `42501`, **le même message qu'en m** |
| o | version inexistante | `admin` | `400`, `P0001`, `version introuvable` |
| p | version d'un autre workspace | `admin` | `400`, `P0001`, **le même message qu'en o** — preuve de refus n° 3 |
| q | workflow archivé | `admin` | `400`, `P0001`, `workflow archive` |
| r | appel anonyme | anonyme | `401` — le privilège refuse avant la vérification 1 |

**Aucune preuve ne restaure la structure du seed sans la rétablir.** Chaque scénario qui modifie la
composition vivante repart de sa version de référence, et l'ordre des preuves ne suppose jamais qu'un
scénario précédent a laissé la base propre : c'est la restauration elle-même qui la ramène, ce qui
est aussi une manière de l'éprouver.

**PRÉCISION APPORTÉE À LA RÉDACTION DU HARNAIS, 2026-08-15, ET LE MOTIF EST MESURÉ.** La première
rédaction de ce tableau disait « la version du seed » aux lignes b, c et d. Or **restaurer publie un
point de retour** (§7 ter.13.5) : jouées sur le workflow par défaut du seed, ces trois lignes lui
laisseraient deux versions supplémentaires **à chaque exécution** — et une version est immuable, sans
politique de suppression pour `authenticated` (§7 ter.4). Le harnais serait non idempotent, et le
numéro de version du seed dériverait sans qu'aucun geste du produit ne l'ait voulu. C'est le même
constat qui avait déjà écarté le workflow du seed des harnais des deuxième et troisième tranches.

La règle est donc, et elle vaut pour toute preuve d'API de ce chapitre :

- la ligne a **reste sur la vraie version du seed**, parce qu'elle **n'écrit rien** : structure
  vivante inchangée, tous les compteurs à zéro et `rollback_version.published` **faux**. C'est
  précisément le scénario qui doit être éprouvé sur la structure réelle du produit, et il ne laisse
  aucune trace ;
- **toute ligne qui écrit** — b, c, d, e, f, g, h, i, j, k, l, m, n, q — se joue sur un workflow
  jetable créé par la preuve, avec sa version de référence publiée par la **vraie** RPC, et le
  workflow est supprimé dans un `finally` : la cascade emporte versions, étapes, arêtes et champs.

**La ligne c mesure l'empreinte vivante par un chemin INDÉPENDANT de la valeur rendue.** Comparer le
`fingerprint_after` de la réponse à `composition_fingerprint` ne prouverait rien de plus que
`matches_version`, qui est calculé à partir de lui : ce serait la fonction se relisant elle-même.
`app.workflow_composition_fingerprint` n'est pas exposée par PostgREST — le schéma `app` ne l'est
pas —, et il n'existe aucune RPC publique qui rende l'empreinte vivante. La mesure indépendante est
donc **une republication par la vraie RPC** après la restauration, dont la ligne créée est relue en
base **avec la clé de service** : `publish_workflow_version` recalcule l'empreinte par son propre
chemin, et l'égalité des deux devient une vraie coïncidence et non une tautologie.

#### 7 ter.13.11 Ce que cette tranche ne livre PAS

- **aucun écran** : la liste des versions, le bouton de publication, l'aperçu de comparaison et
  l'aperçu du plan appartiennent à la cinquième tranche. Aucune capture d'application n'est donc
  produite ici, et l'absence est nommée plutôt que compensée ;
- **aucune restauration de l'identité du workflow** — nom, portée, track, défaut, archivage
  (§7 ter.13.3) ;
- **aucune suppression de champ**, ni ici ni ailleurs : elle n'existe pas dans ce produit
  (§7 ter.13.4) ;
- **aucune purge de versions** : restaurer ne supprime rien, et le nombre de versions ne fait que
  croître. Une politique de rétention, si elle devient nécessaire, aura sa propre unité ;
- **aucun seed** : la restauration ne conserve rien qu'une version ne conserve déjà, et fabriquer une
  divergence dans le seed pour donner une restauration à montrer serait une donnée fabriquée pour la
  preuve (`CLAUDE.md` §8). Les preuves construisent elles-mêmes ce qu'elles restaurent, par les
  vrais gestes ;
- **aucun changement de type de champ** : le §7 bis.10.3 le renvoyait à ce plan de remappage. Il n'y
  entre pas — le plan porte sur les **étapes** (§7 ter.12.3), et le remappage des **valeurs** d'un
  champ dont le type change est un autre problème, qui aura sa propre spécification.

#### 7 ter.13.12 Preuves attendues de la quatrième tranche

| Niveau | Preuves |
|---|---|
| pgTAP | Existence, volatilité `volatile`, **`security definer` et propriétaire `postgres`**, privilèges et révocation d'`anon` ; **le refus opposé à un membre non administrateur d'un AUTRE workspace, qui doit rendre `version introuvable` et non le refus d'administration** — c'est la seule preuve qui éprouve que la vérification 2 a bien été écrite à la main ; les huit refus contre des comptes réels ; **le point de retour publié, puis restauré, rendant les identifiants d'origine** ; les affaires remappées comptées **en base** et leur événement `moved` ; le champ surnuméraire **archivé et non supprimé**, avec sa valeur saisie intacte ; l'empreinte après restauration égale à celle de la version ; `matches_version` **faux** lorsque le nom du workflow a changé ; l'ordre des écritures éprouvé par le cas qui échouerait sans lui — étape initiale déplacée, nœud réutilisé |
| API | Les dix-huit lignes du §7 ter.13.10, hors interface, avec les jetons réels des trois profils ; preuve de refus n° 3 au niveau des versions |
| Seed | **Aucun** (§7 ter.13.11) |
| Interface | **Aucune** — cette tranche ne livre aucun écran |

### 7 ter.14 Cinquième tranche — les écrans

Chapitre écrit **avant la première ligne de code** de cette tranche (`CLAUDE.md` §5), après mesure
sur la pile seedée. Les valeurs marquées MESURÉ ont été relevées en base le 2026-08-15.

Les quatre tranches précédentes ont livré une photographie (§7 ter.3), sa comparaison (§7 ter.11),
le plan de remappage (§7 ter.12) et son application transactionnelle (§7 ter.13). **Aucune n'a
d'écran**, et chacune l'a nommé plutôt que de le compenser. Cette tranche les rend accessibles à un
administrateur qui ne passe pas par l'API, et c'est elle qui permet à `CRM-078` de sortir de `[~]`.

#### 7 ter.14.1 Ce que les écrans sont, et ce qu'ils ne sont pas

Le versionnement se rend en **un sixième bloc de l'éditeur de workflows** (§7 bis), dans la même
colonne et sous les exigences de transition. La règle d'ordre est celle des cinq blocs précédents :
on ne photographie pas une composition qu'on n'a pas composée, et les quatre gestes portent tous sur
le workflow que la colonne de gauche a déjà choisi.

Ce bloc **n'est pas** :

- **une autorisation.** La règle de `CRM-075` reprise mot pour mot : l'écran envoie, la base
  tranche, l'écran traduit le refus reçu (`CLAUDE.md` §10). Publier, planifier et restaurer sont
  réservés aux administrateurs par les vérifications 3 des §7 ter.5, §7 ter.12.4 et §7 ter.13.6,
  déjà prouvées hors interface. **Aucune commande n'est éteinte d'avance** ;
- **un éditeur de version.** Une version est immuable, par trois barrières empilées (§7 ter.4). Le
  bloc n'offre ni renommage, ni suppression, ni modification de note : ces gestes n'existent pas
  dans le produit, et les offrir grisés enseignerait une règle fausse ;
- **un second moteur de comparaison ni de plan.** Rien n'est calculé dans le navigateur : le bloc
  appelle les trois fonctions et met en forme ce qu'elles rendent. C'est la règle du §7 bis.13.2,
  et elle vaut ici plus fort encore — un plan recalculé à l'écran serait borné par ce que la RLS de
  l'appelant consent à lire, et annoncerait « trois affaires » là où quarante sont concernées
  (§7 ter.12.4).

#### 7 ter.14.2 Adresse

`/reglages/workflows`, sixième bloc — **aucune route nouvelle**. Une version appartient à un
workflow ; choisir le workflow est déjà le travail de la colonne de gauche (§7 bis.3, lecture 1), et
une route propre obligerait à le choisir deux fois.

#### 7 ter.14.3 Ce que l'écran lit, et en combien de requêtes

Une lecture s'ajoute aux sept de l'éditeur :

| # | Source | Filtre | Ordre | Motif |
|---|---|---|---|---|
| 8 | `workflow_versions` + `profiles` embarqué par `workflow_versions_published_by_fkey` | `workflow_id=eq.<workflow choisi>` | `version_number` **décroissant** | la liste des versions |

L'ordre décroissant est celui de l'index posé par le §7 ter.3 — « toute lecture utile est *les
versions de ce workflow, la plus récente d'abord* ».

Le profil est **embarqué** et non relu : `published_by` est un `uuid`, et aucun `uuid` n'atteint
l'écran (`CRM-022`). MESURÉ : `select=…,auteur:profiles!workflow_versions_published_by_fkey(full_name)`
rend `Camille Aubert` sur la version du seed. Le nommage explicite de la clé étrangère est
obligatoire, comme au §5.16 de `docs/DESIGN_SYSTEM.md` : sans lui PostgREST rend `300`. Un
`published_by` nul — profil supprimé — rend `auteur` nul, et l'écran écrit « Auteur inconnu », la
règle du §5.16 exactement.

MESURÉ sur la pile seedée : le workflow par défaut porte **une** version, numéro `1`, note
« Composition de référence livrée par le seed » ; le workflow dérivé n'en porte **aucune**. Les deux
états sont donc atteignables sans fabriquer de donnée (`CLAUDE.md` §8).

**Les trois autres appels ne sont PAS émis au chargement**, et c'est la règle du §7 bis.13.4
reconduite : comparer, planifier et restaurer sont des **réponses à un geste**. Le plan lit toutes
les affaires du workflow — MESURÉ : `cards_total` 13 sur le workflow par défaut du seed —, et le
poser à chaque changement de workflow dépenserait cette lecture pour un geste qui n'aura pas lieu.

#### 7 ter.14.4 Les quatre gestes

| Geste | Appel | Ce que la base garantit déjà |
|---|---|---|
| **Publier** | `publish_workflow_version(target_workflow_id, note)` | les cinq refus du §7 ter.5, dont `composition inchangee` |
| **Comparer** | `compare_workflow_versions(base_version_id, target_version_id)` | les quatre refus du §7 ter.11.3 |
| **Planifier** | `plan_card_remapping(target_version_id, step_overrides, card_limit)` | les huit refus du §7 ter.12.4 |
| **Restaurer** | `restore_workflow_version(target_version_id, step_overrides)` | les huit refus du plan **remontés tels quels**, plus les siens (§7 ter.13.6) |

**Aucune de ces règles n'est réécrite dans l'écran**, et c'est la contrainte la plus forte du bloc.
En particulier, l'écran **ne teste jamais lui-même si la composition a changé** avant d'offrir
« Publier » : la vérification 5 du §7 ter.5 est la seule formulation de cette règle, et l'empreinte
vivante n'est de toute façon lisible par aucun chemin public (§7 ter.13.10, mesure de la ligne c).
L'écran envoie, et traduit `composition inchangee` si elle vient.

**Publier** porte un champ de note facultatif. La note est `btrim`ée par la base et enregistrée
`NULL` si elle est vide (§7 ter.5) : l'écran ne la valide donc pas, il n'y a aucune réponse connue
d'avance à économiser (§7 bis.5). Le succès recharge la lecture 8 et **annonce** le numéro obtenu.

**Comparer** porte deux listes déroulantes — base et cible — alimentées par la lecture 8. Défaut :
cible = la version la plus récente, base = la précédente ; s'il n'existe qu'une version, les deux
désignent la même, ce que le §7 ter.11.3 **accepte** explicitement et qui rend `identical` vrai.
L'orientation est celle des arguments et la fonction ne la corrige pas (§7 ter.11.3) : l'écran
l'écrit en toutes lettres — « ce que la cible ajoute, retire ou modifie par rapport à la base » —
plutôt que de laisser le lecteur la deviner.

**Planifier** porte une liste déroulante de version et rend le plan sous la forme du §7 ter.12.6.
`card_limit` n'est **pas** offert à la saisie : le défaut de 200 est celui de la fonction, la
troncature est annoncée par la base (`cards.truncated`), et un champ de plus n'apporterait rien à un
administrateur qui cherche à savoir si sa restauration passe. MESURÉ : avec `card_limit` à 3 sur
treize affaires, la base rend `returned` 3, `total` 13 et `truncated` vrai — l'écran écrit ces trois
nombres, jamais seulement la liste.

**Restaurer** part du plan **affiché**, et de lui seul : la commande n'est offerte que sous un plan
déjà rendu, avec ses instructions de remappage saisies. Elle demande une confirmation (§6 du design
system) : le geste écrit la structure de travail d'un channel entier et déplace des affaires. Le
succès rend les compteurs du §7 ter.13.8, **nomme le point de retour** — numéro de version, et s'il
a été publié par cet appel — et recharge à la fois la lecture 8 et le graphe entier de l'éditeur :
restaurer réécrit étapes, arêtes, champs et règles, et ne recharger que les versions laisserait à
l'écran une composition périmée.

#### 7 ter.14.5 Les instructions de remappage se saisissent sur les ÉTAPES RETIRÉES

C'est le point de conception de la tranche, et il découle du §7 ter.12.3 : les instructions portent
sur les **étapes**, jamais sur les affaires.

Le plan rend `steps.removed`, chaque entrée portant `step_id`, `label`, `cards_total`,
`cards_unresolved` et `target_step_id`. L'écran rend **une liste déroulante par étape retirée**,
dont les options sont les étapes de la **version** — lues dans `composition.steps` du document
conservé, seul endroit où une étape que la base ne porte plus est encore nommée (§7 ter.12.6).
Choisir une cible reconstitue une instruction `{ from_step_id, to_step_id }`, et **replanifie**.

Trois règles, et chacune répond à un refus ou à une règle déjà écrite :

- **replanifier après chaque choix, plutôt que de calculer le nouveau verdict à l'écran.** `ready`
  est vrai si et seulement si `cards_unresolved` vaut zéro (§7 ter.12.6) ; le recalculer dans le
  navigateur serait une seconde formulation de la même règle, et les deux finiraient par diverger.
  L'appel est `stable` et borné par le nombre d'étapes ;
- **une étape retirée sans instruction reste sans instruction** : l'écran ne pré-remplit **aucune**
  cible. « Aucune destination n'est devinée » est la lecture littérale de la Definition of Done de
  `CRM-078`, et proposer d'office la première étape de la version en ferait une supposition sur
  l'intention ;
- **la commande de restauration n'est jamais éteinte par l'écran**, même lorsque `ready` est faux.
  Le §7 ter.13.6 porte la garde en vérification 7, avec un `detail` qui nomme les affaires non
  résolues ; un bouton grisé ferait passer cette règle de base pour une décision d'interface
  (`CLAUDE.md` §10, et §5.16 du design system pour le précédent). L'écran **écrit** que le plan
  n'est pas applicable et laisse le geste partir.

#### 7 ter.14.6 Nommer un élément de comparaison, sans jamais l'inventer

L'identité d'un élément est un jeu d'identifiants — MESURÉ dans la migration 40 : `id` pour le
workflow, les étapes, les arêtes et les champs ; le couple `(field_id, step_id)` pour les règles ;
`(transition_id, field_id)` pour les champs requis. Aucun libellé n'y figure, et c'est voulu :
l'identité est un identifiant, jamais une ressemblance (§7 ter.11.2).

Le nom affiché vient donc, **dans cet ordre**, et l'écran s'arrête au premier disponible :

1. pour un **ajout** ou un **retrait**, du document complet rendu par la fonction — MESURÉ sur la
   composition du seed : une étape porte `label_override` et `node_label`, un champ porte `label`,
   une arête porte `label`, le workflow porte `name`. C'est exactement à cela que sert la
   conservation du document entier (§7 ter.11.4) : nommer ce que la base ne porte plus ;
2. pour une **modification**, de l'attribut changé lorsqu'il est le libellé — `before` nomme
   l'élément, `after` dit son nouveau nom ;
3. à défaut, de la structure vivante déjà chargée par l'éditeur — étapes et champs sont en mémoire ;
4. à défaut, de son identifiant, rendu en `code`.

**Aucune phrase n'est construite par concaténation et aucun `undefined` n'atteint l'écran** (§5.11
du design system, règle du libellé non résolu). Une identité composée — une règle, un champ requis —
qui ne se résout pas rend ses deux identifiants, pas une phrase à trou.

#### 7 ter.14.7 Les refus, traduits par un dictionnaire fermé

Les quatre gestes rendent des messages `P0001`, des `42501` et un `PT409`. Ils sont traduits par un
dictionnaire fermé, comme les six codes d'incident du §5.14 du design system et les refus d'écriture
de `CRM-075` : un message d'API n'est pas un texte pour un humain.

| Message rendu par la base | Geste | Ce que l'écran écrit |
|---|---|---|
| `composition inchangee` | publier | la composition n'a pas bougé depuis la dernière version |
| `workflow archive` | publier, restaurer | le workflow est archivé |
| `workflow introuvable`, `version introuvable` | les quatre | l'objet n'est plus lisible ; rechargez |
| `publication reservee aux administrateurs`, `plan reserve aux administrateurs`, `restauration reservee aux administrateurs` | publier, planifier, restaurer | le geste est réservé aux administrateurs |
| `versions de workflows differents` | comparer | les deux versions n'appartiennent pas au même workflow |
| `plan non applicable` | restaurer | des affaires attendent encore une instruction |
| `structure modifiee depuis le plan` | restaurer | la structure a changé, replanifiez |
| `remappage invalide`, `remappage ambigu`, `origine de remappage inconnue`, `cible de remappage absente de la version` | planifier, restaurer | l'instruction de remappage a été refusée |
| `limite invalide` | planifier | la borne demandée est hors des valeurs admises |
| tout autre message | les quatre | un refus générique, **jamais le message brut** |

Le `detail` de la base n'est pas affiché tel quel : il nomme des identifiants (§7 ter.13.6,
vérification 7). Le refus est rendu dans le bloc qui l'a causé, jamais en tête d'écran (§5.13 du
design system).

#### 7 ter.14.8 États, accessibilité, responsive, et ce que la tranche ne livre PAS

Les quatre états du §5.8 du design system sont rendus pour la lecture 8 — chargement, erreur avec
reprise, vide (« ce workflow n'a aucune version »), et la liste. Les trois gestes qui rendent un
document ont **leur propre état de chargement** : un bloc muet pendant qu'un plan se calcule se
lirait comme un plan vide. Chaque geste est atteignable au clavier, les succès passent par la région
`aria-live` déjà posée par l'éditeur, et la console reste vierge.

Ce que cette tranche ne livre PAS :

- **aucune concurrence optimiste depuis l'écran.** `expected_live_fingerprint` n'est pas transmis,
  et le motif est mesuré et non choisi : aucune RPC publique ne rend l'empreinte vivante d'un
  workflow, et le schéma `app` n'est pas exposé par PostgREST (§7 ter.13.10, ligne c). Le produit
  n'est pas pour autant sans garde — la restauration **rejoue le plan dans sa propre transaction**
  (§7 ter.13.2), ce qui est précisément la réponse au monde qui bouge. Exposer l'empreinte vivante
  est un geste serveur, qui aura son unité et sa spécification ;
- **aucun `card_limit` réglable** (§7 ter.14.4) ;
- **aucune purge ni rétention de version** (§7 ter.13.11) ;
- **aucun seed nouveau** : la version publiée par le §7 ter.8 suffit à montrer la liste, la
  comparaison d'une version à elle-même et un plan `ready`. Publier une seconde version dans le seed
  pour donner une comparaison plus riche à montrer serait une donnée fabriquée pour la preuve
  (`CLAUDE.md` §8) ; les preuves publient elles-mêmes ce qu'elles comparent, par la vraie RPC.

#### 7 ter.14.9 Preuves attendues de la cinquième tranche

| Niveau | Preuves |
|---|---|
| Unitaire | Composition de la liste des versions depuis les lignes lues, auteur nul compris ; le choix par défaut des deux versions à comparer, y compris quand il n'y en a qu'une ; le nom d'un élément de comparaison dans les quatre cas du §7 ter.14.6, identité composée comprise ; la construction des instructions de remappage depuis les choix, et le fait qu'une étape sans choix n'en produit aucune ; la traduction de chaque message du §7 ter.14.7, et le repli générique |
| Interface | Les quatre gestes joués sur la vraie base avec le compte de l'administratrice : la liste rendue, une publication refusée en `composition inchangee` **affichée**, une comparaison d'une version à elle-même rendant `identical`, un plan rendu avec ses compteurs. Le refus opposé au `viewer` sur la publication, **constaté et non simulé** |
| Visuel | Captures aux quatre paliers de `docs/DESIGN_SYSTEM.md` §7, bloc des versions déployé, plan rendu, refus affiché |
| Seed | La version du §7 ter.8 suffit (§7 ter.14.8) |

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
