# Spécification — corbeille et restauration

Contrat exécutable de `CRM-077` (`docs/BACKLOG.md`).

- Unité de backlog : `CRM-077` — corbeille et restauration.
- Modèle des cards : `docs/SPEC-cards.md` §4 (cycle de vie), §5 (« active »), §6 (autorisations),
  §10 point 2 (la purge, laissée ouverte).
- Arborescence : `docs/SPEC-administration-arborescence.md` (tracks et channels, leur archivage).
- Schéma : `docs/SCHEMA.md`.
- Design system : `docs/DESIGN_SYSTEM.md`.
- Déploiement : `docs/PROD_MIGRATIONS.md`.
- État : **spécifiée, livrée en partie.** Écrite avant toute ligne de code (`CLAUDE.md` §5). Le
  modèle (§3.2), la garde de restauration (§3.4), le retrait des listes (§3.3), l'énumération
  (§3.5) et l'**écran** (§4) sont livrés. Reste dû : le **geste de mise à la corbeille**, qui n'est
  offert par aucun écran — le §4.7 le place hors de la corbeille, et il n'existe encore ni sur le
  board, ni sur la vue liste, ni sur l'administration de l'arborescence.

---

## 1. Ce que cette unité est, et ce qu'elle n'est pas

La Definition of Done de `CRM-077` tient en une phrase : « aucun objet enfant n'est perdu
silencieusement ; restauration atomique, audit, droits backend, E2E et captures ».

Elle N'EST PAS « ajouter un écran corbeille ». Les mesures du §2 montrent que le modèle est à moitié
posé et que la moitié manquante n'est pas visuelle.

Elle n'est pas non plus la purge automatique : celle-ci reste un point ouvert du responsable (§6).

## 2. Ce qui existe déjà, MESURÉ sur la pile le 2026-08-15

Ces quatre mesures décident de tout ce qui suit. Aucune n'est déduite d'une lecture de code.

### 2.1 `deleted_at` n'existe que sur les cards, et sur les commentaires

| Table | `archived_at` | `deleted_at` | `deleted_by` |
|---|---|---|---|
| `cards` | oui | **oui** | non |
| `card_comments` | non | **oui** | **oui** |
| `tracks`, `channels`, `workflows`, `form_fields`, `workflow_nodes_catalog` | oui | non | non |

`docs/SPEC-cards.md` §4 pose déjà que les deux colonnes des cards sont **indépendantes** : archiver
n'est pas supprimer. La Definition of Done couvre en revanche « cards, tracks et channels », et
**tracks et channels n'ont aucune corbeille** : ils n'ont que l'archivage. C'est le premier manque, et
il appelle une migration.

### 2.2 La corbeille des cards n'est aujourd'hui filtrée par AUCUNE politique

MESURÉ : `select tablename, policyname from pg_policies where qual like '%deleted_at%'` rend
**zéro ligne**, et l'appel réel
`GET /rest/v1/cards?select=id,title,deleted_at&deleted_at=not.is.null` avec le jeton de
l'administratrice rend **`200`** et la card `Saisie erronée`.

**Ce n'est pas un défaut, et il ne faut surtout pas le « corriger » au passage.** Le §12 de
`docs/SPEC-cards.md` filtre `deleted_at=is.null` dans les **lectures de listes** : la corbeille est
une **vue**, non une frontière de confidentialité. Une card en corbeille reste lisible par qui
pouvait déjà lire son channel — ce qui est la condition même pour qu'un écran de corbeille puisse
l'afficher et la restaurer.

**Conséquence pour la Definition of Done.** « droits backend » ne signifie donc PAS « rendre la
corbeille invisible ». Cela signifie que **mettre à la corbeille et restaurer** sont des écritures,
donc soumises aux politiques d'écriture existantes, et que leur refus doit être prouvé hors
interface avec les jetons réels (`CLAUDE.md` §10). C'est déjà le cas de `cards` (§6.1 de sa
spécification) ; ce sera à établir pour `tracks` et `channels`.

### 2.3 Les cascades physiques détruisent les enfants en silence

MESURÉ sur `pg_constraint` :

```
tracks → channels        CASCADE
channels → cards         CASCADE
cards → card_comments    CASCADE
cards → card_events      CASCADE
cards → card_field_values CASCADE
cards → mail_outbox      CASCADE
cards → mail_messages    SET NULL
cards → mail_attachments SET NULL
tracks → track_members   CASCADE
channels → channel_members CASCADE
tracks → workflows       CASCADE
```

Une suppression **physique** d'un track emporterait donc, sans un mot, ses channels, leurs cards,
leurs commentaires, leurs événements, leurs valeurs de champ et leur file d'envoi — et **délierait**
les messages et pièces jointes déjà reçus, qui survivraient orphelins.

C'est exactement ce que la Definition of Done interdit. Deux conséquences, non négociables :

1. **la corbeille ne supprime jamais physiquement** — elle horodate, comme tout le reste du produit
   (`docs/SPEC-cards.md` §4 : « ce que le produit appelle *supprimer* est toujours un horodatage ») ;
2. **l'effacement définitif, quand il viendra, ÉNUMÈRE avant d'agir** : il ne peut pas se contenter
   d'un `DELETE` en s'en remettant aux cascades, puisque celles-ci sont précisément le mécanisme qui
   perd les enfants en silence.

### 2.4 Aucun privilège `DELETE` n'est accordé, nulle part

Ni à `anon`, ni à `authenticated`, sur aucune des tables concernées. La corbeille n'a donc aucun
chemin d'écriture destructeur à fermer : elle a un chemin d'horodatage à ouvrir.

## 3. Le modèle retenu

### 3.1 Trois états, et ils sont déjà nommés pour les cards

| État | `archived_at` | `deleted_at` | Sens |
|---|---|---|---|
| Actif | `NULL` | `NULL` | l'objet vit |
| Archivé | renseigné | `NULL` | dossier clos que l'on conserve |
| En corbeille | indifférent | renseigné | erreur que l'on retire, **réversible** |

Ce tableau est celui de `docs/SPEC-cards.md` §4. Il est **étendu tel quel** à `tracks` et
`channels` : inventer un second vocabulaire pour les mêmes trois états rendrait le produit
inintelligible.

### 3.2 La migration due

Sur `tracks` et `channels` :

- `deleted_at timestamptz null` ;
- `deleted_by uuid null references profiles(id) on delete set null`, **fermée au client** et écrite
  par trigger, sur le patron déjà éprouvé de `card_comments.deleted_by` (`CRM-043`, INC-072) : un
  audit qu'un client peut écrire n'est pas un audit.

`cards` gagne `deleted_by` pour la même raison, sa corbeille existant déjà sans audit.

**Aucune colonne n'est retirée, aucune contrainte n'est modifiée, aucune cascade n'est touchée.**

### 3.3 Ce que « supprimer un parent » fait à ses enfants

C'est le cœur de la Definition of Done, et le §2.3 interdit de s'en remettre aux cascades.

**Règle : la mise en corbeille d'un parent ne descend PAS.** Elle horodate le parent, et lui seul.
Les enfants restent tels quels en base.

Motif, et il est mesurable : descendre l'horodatage rendrait la restauration **ambiguë**. Restaurer
un track devrait alors distinguer les channels qu'il a lui-même emportés de ceux qui étaient déjà en
corbeille avant lui — distinction que la seule colonne `deleted_at` ne porte pas. Le produit
choisirait pour l'utilisateur, et se tromperait.

**Ce qui remplace la descente : l'énumération.** L'écran de suppression d'un parent DIT ce qui
deviendra inaccessible avec lui, avec son compte, avant de demander confirmation — « ce track porte
3 channels et 27 affaires » —, et les lectures de listes traitent un enfant dont le **parent** est en
corbeille comme inaccessible, sans l'horodater.

### 3.4 La restauration est atomique, et elle refuse plutôt que de deviner

Restaurer met `deleted_at` à `NULL` sur le seul objet visé.

**Restaurer un enfant dont le parent est en corbeille est REFUSÉ**, par un refus nommé, et non
silencieusement toléré : une card rendue à un channel lui-même en corbeille serait « restaurée » vers
un endroit où personne ne la verrait. Le refus dit quoi restaurer d'abord.

C'est une garde **backend**, pas une aide d'interface (`CLAUDE.md` §10).

### 3.5 L'énumération, et ce qu'elle compte exactement

Le §3.3 pose le principe : l'énumération **remplace** la descente de l'horodatage. Ce chapitre dit ce
qu'elle compte, ce qu'elle ne compte pas, et comment elle se lit. Chaque règle a une mesure ou un
motif ; aucune n'est une convention arbitraire.

**Ce qu'elle compte.**

| Objet visé | Enfants comptés |
|---|---|
| un track | ses **channels** qui ne sont pas eux-mêmes en corbeille, et les **affaires** de ces channels qui ne sont pas elles-mêmes en corbeille |
| un channel | ses **affaires** qui ne sont pas elles-mêmes en corbeille |

**Un enfant DÉJÀ en corbeille n'est pas compté.** Il ne *devient* pas inaccessible avec son parent :
il l'est déjà, et il porte sa propre entrée dans la corbeille, où il se restaure séparément. Le
compter le ferait apparaître deux fois et ferait dire au produit que le geste retire plus qu'il ne
retire.

**Un enfant ARCHIVÉ est compté, lui.** C'est la règle la moins évidente des trois, et c'est la seule
qui dise la vérité : archiver est réversible — `docs/SPEC-administration-arborescence.md` livre le
désarchivage pour cela même. Un channel archivé est donc attendu de retour au premier désarchivage ;
si son track passe à la corbeille, ce retour n'a plus lieu. Ne pas le compter tairait exactement ce
que le geste immobilise.

**Les affaires d'un channel lui-même en corbeille ne sont pas comptées pour le track.** Elles sont
déjà retenues par leur channel, un cran plus bas, et restaurer le track ne les rendrait pas. Le
compte d'un track répond à une question précise — « que retire ce geste **de plus** que ce qui est
déjà retiré » —, et non « combien de lignes descendent de ce track ».

**L'énumération est ce que l'APPELANT peut lire, et cela se mesure.** Les deux lectures passent par
les politiques de `channels` et de `cards` : le compte est donc celui du profil qui le demande, pas
un inventaire d'autorité. MESURÉ le 2026-08-15 sur le track `conseil-ia` du seed : l'administratrice
lit **3 channels et 7 affaires**, la lectrice **1 channel et 2 affaires** — les droits fins de
`docs/SPEC-permissions-rls.md` §2.2 ferment le reste. C'est cohérent avec tout le produit — « un
refus de lecture est zéro ligne » (§7) — et cela interdit une seule chose : présenter ce compte comme
une garantie d'exhaustivité.

**DEUX LECTURES, ET NON UNE JOINTURE EMBARQUÉE — c'est une mesure, non une préférence.** MESURÉ le
2026-08-15 : `GET /rest/v1/cards?select=id,channels!inner(id)` rend **`300`** et `PGRST201`, « more
than one relationship was found for 'cards' and 'channels' » — `cards` porte **deux** clés étrangères
composites vers `channels`, `cards_channel_id_workflow_id_fkey` et
`cards_channel_id_workspace_id_fkey`. Lever l'ambiguïté demanderait d'écrire un nom de contrainte
dans la requête d'un écran, ce que `webapp/src/lib/inbox.ts` a déjà refusé pour la même relation.
L'énumération d'un track lit donc **les identifiants de ses channels**, puis **compte** les affaires
de ces identifiants ; le nombre de channels est la longueur de la première lecture, et n'appelle
aucune requête de plus.

**Le compte vient de `count=exact`, jamais des lignes.** L'écran affiche un nombre : rapporter les
affaires pour les dénombrer côté client ferait transiter une liste non bornée pour afficher un
entier — même position que `lireCompteursFileSortante` (`docs/SPEC-mail-subsystem.md` §20.11.7). Une
réponse aboutie sans `count` est traitée comme une **erreur** et non comme un zéro : un contrat rompu
n'est pas une corbeille vide.

**Aucune seconde lecture lorsque le track ne porte aucun channel.** MESURÉ : `channel_id=in.()` rend
`200` et `*/0`, la requête vide n'est donc pas un piège — la sauter est une requête épargnée dont on
connaît d'avance la réponse, exactement comme `useContenuTrack` n'interroge pas `channels` pour un
track absent (`docs/SPEC-channels.md` §5.1), et non le contournement d'un défaut.

**La composition ne construit jamais une phrase par concaténation** (`CLAUDE.md` §23). L'énumération
rendue à l'écran est une **liste ordonnée de lignes** — les channels d'abord, les affaires ensuite, du
plus englobant au plus fin —, dont chaque ligne porte son propre texte complet et son compte
substitué. Une ligne dont le compte est **zéro est omise** : « 0 channel » n'apprend rien et fait lire
deux fois pour comprendre qu'il n'y a rien. Une énumération **entièrement vide ne rend aucune ligne**,
et l'écran dit alors sa propre phrase, comme l'état vide du §4 — un tableau sans ligne n'est pas un
état vide.

## 4. Ce que l'écran montre

Adresse : la corbeille est une vue du workspace, atteinte depuis les réglages, et non un onglet de
chaque objet — un objet en corbeille n'a plus de place dans les listes où il vivait.

- une entrée par objet, portant **son type**, son nom, **qui** l'a mis à la corbeille et **quand** ;
- pour un parent, le compte de ses enfants rendus inaccessibles (§3.3) ;
- la restauration, et son refus nommé lorsque le parent est lui-même en corbeille (§3.4) ;
- les états du §5.8 du design system — chargement, erreur, **vide**, succès —, l'état vide étant ici
  le cas normal et non un accident : « la corbeille est vide » est une phrase, jamais un tableau
  sans ligne.

L'effacement définitif **n'a pas de commande** tant que le §6 n'est pas arbitré.

Les chapitres qui suivent détaillent l'écran. *Écrits par la sixième tranche, avant sa première
ligne de code (`CLAUDE.md` §5).* Chaque règle porte sa mesure ou son motif.

### 4.1 L'adresse, et pourquoi elle est hors de la table des routes

`/reglages/corbeille`, atteinte depuis l'**index des réglages**, et absente de `ROUTES`.

C'est le patron déjà suivi par les trois autres surfaces d'administration — `CRM-075`, `CRM-076`,
`CRM-059` : la table `ROUTES` couvre **exactement** les entrées de navigation transverses, contrainte
tenue par une assertion de `routes.test.tsx`. Une quatrième surface d'administration ne fait pas
exception, et l'écran est chargé à la demande comme les trois autres — la plupart des sessions ne
l'ouvrent pas, et elle n'a pas à peser sur leur premier rendu (`CLAUDE.md` §21).

### 4.2 Ce que l'écran lit — TROIS lectures, dont l'embarquement doit être DÉSAMBIGUÏSÉ

Trois lectures, une par table, filtrées `deleted_at=not.is.null` et ordonnées `deleted_at.desc` côté
serveur. Chacune embarque le profil qui a retiré l'objet.

**L'embarquement anonyme est ambigu sur les TROIS tables, et c'est mesuré.** Le 2026-08-15, avec le
jeton réel de l'administratrice, `select=id,profiles(id)` rend **`300`** et `PGRST201` partout — pour
**deux causes distinctes** :

| Table | Relations concurrentes rendues par PostgREST |
|---|---|
| `cards` | `cards_created_by_fkey`, `cards_deleted_by_fkey`, `cards_owner_id_fkey` — **trois** clés étrangères vers `profiles` |
| `tracks` | `tracks_deleted_by_fkey`, et la relation **plusieurs-à-plusieurs** passant par `track_members` |
| `channels` | `channels_deleted_by_fkey`, et la relation **plusieurs-à-plusieurs** passant par `channel_members` |

La seconde cause mérite d'être nommée, car elle surprend : sur `tracks` et `channels`, `deleted_by`
est la **seule** clé étrangère vers `profiles`, et l'embarquement est pourtant ambigu — la table
d'appartenance suffit à créer la concurrence. L'ambiguïté ne vient donc pas du nombre de clés
étrangères, mais de ce que PostgREST compte aussi les relations plusieurs-à-plusieurs.

**La levée d'ambiguïté est le NOM DE LA CONTRAINTE, et c'est la convention déjà établie du produit
pour cette relation exacte.** `auteur:profiles!tracks_deleted_by_fkey(id, full_name)` — MESURÉ
`200` sur les trois tables. C'est ce qu'écrivent déjà `colonnes-board.ts`, `colonnes-liste.ts` et
`commentaires.ts` pour désigner un responsable ou un auteur (`profiles!cards_owner_id_fkey`,
`profiles!card_comments_author_id_fkey`) : trois modules, une seule manière de nommer un profil
embarqué.

**Ce point contredit une première rédaction de ce chapitre, et la contradiction est instructive.**
Le §3.5 a écrit qu'« un nom de contrainte dans la requête d'un écran » avait été refusé par
`lireCardsClassables` (`inbox.ts`). C'est exact, mais cela portait sur la relation
`cards` → `channels`, dont les clés étrangères sont **composites** — PostgREST ne les résout pas par
le seul nom de colonne, et les nommer n'aurait rien réparé. Pour la relation vers `profiles`, la clé
est simple, le nom de contrainte suffit, et le produit l'écrit depuis `CRM-041`. Généraliser le refus
du §3.5 à toute relation aurait ajouté une lecture par écran contre une convention en place :
**une règle mesurée dans un contexte ne se transporte pas dans un autre sans y être remesurée** —
c'est la leçon qu'INC-113 avait déjà donnée à la quatrième tranche, sous une autre forme.

**Ce que l'écran montre est ce que l'APPELANT peut lire**, et c'est mesuré : sur le seed,
l'administratrice lit **1 track, 1 channel et 1 affaire** en corbeille ; la lectrice lit **1 track,
1 channel et 0 affaire** — l'affaire `Saisie erronée` vit dans un channel que les droits fins lui
ferment. La corbeille suit donc la lecture de l'objet, ce que le §2.2 constatait déjà, et le §6
point 3 reste **non arbitré** : la règle existante est conservée telle quelle, ni étendue ni
restreinte.

### 4.3 L'auteur inconnu est un fait à NOMMER, jamais une cellule vide

MESURÉ sur le seed : la card `Saisie erronée` (`…0c9`) porte `deleted_by` **NUL**. Ce n'est pas une
anomalie, c'est la conséquence documentée du §10.2 de `docs/SPEC-seed.md` — elle est née en corbeille
sous la clé de service, qui ne porte aucune revendication `sub`, et le trigger de `0037` a **figé**
cette valeur. Une seconde cause produira le même état : `on delete set null` détache `deleted_by`
lorsque le profil est supprimé (INC-076).

Dans les deux cas, l'objet **a été** retiré par quelqu'un dont la trace manque. C'est un fait, et le
§5.9 du design system réserve la cellule vide à « une donnée qui n'existe pas pour cette ligne ».
L'écran écrit donc **« Auteur inconnu »**, exactement comme l'état de la messagerie écrit « Jamais
relevée » plutôt que de laisser un blanc (§5.14).

### 4.4 L'énumération d'une entrée parente — la MÊME requête que la confirmation

Une entrée de type track ou channel porte le compte de ses enfants rendus inaccessibles, obtenu par
`compterEnfantsInaccessibles` (§3.5) — **la même fonction, les mêmes filtres, les mêmes deux
lectures** que l'écran de confirmation d'une mise à la corbeille. C'est ce que la ligne « API » du §5
demande, et c'est aussi ce qui fait que la preuve d'API déjà livrée couvre les deux usages.

Le coût est nommé plutôt que tu : **deux** requêtes par entrée de type track, **une** par entrée de
type channel, **aucune** pour une affaire — une affaire n'a pas d'enfant au sens du §3.5. Les
énumérations sont demandées en parallèle après la liste, et **une énumération en échec n'invalide pas
la liste** : l'entrée reste affichée, seule sa colonne de compte dit qu'elle n'a pas pu être lue. Une
liste entière perdue parce qu'un compte a échoué serait une panne plus grande que celle qu'on
signale.

### 4.5 La restauration, et ses TROIS issues

L'écran envoie, puis traduit ce qu'il reçoit. Il **ne calcule jamais d'avance** si la restauration
est possible : masquer la commande d'un enfant sous parent en corbeille ferait porter à l'interface
une règle qui vit dans la base (`CLAUDE.md` §10, §3.4).

| Issue | Ce que la pile rend | MESURÉ le 2026-08-15 |
|---|---|---|
| appliquée | `200` et la ligne | — |
| **refusée par la garde** | `400`, code `P0001`, message `parent_en_corbeille`, `details` nommant quoi restaurer d'abord | `PATCH /channels?id=eq.…038` avec le jeton réel de l'administratrice |
| **sans effet** | `200` et `[]` | `PATCH /tracks?id=eq.…025` avec le jeton réel de la **lectrice** — le track reste en corbeille, relu |

**« Sans effet » n'est ni un succès ni une erreur**, et c'est la troisième issue que l'écran doit
nommer : la clause `USING` de la politique filtre la ligne **avant** la mise à jour, PostgREST rend
`200` et zéro ligne (décision 70), et rien n'a changé. La confondre avec un succès afficherait une
restauration qui n'a pas eu lieu — le défaut que `ResultatEcriture` traite déjà pour l'arborescence.
C'est pourquoi chaque écriture porte un `select()` : sans lui, PostgREST ne rend aucun corps et
« zéro ligne touchée » serait indistinguable d'un succès.

**Le refus `parent_en_corbeille` dit quoi restaurer d'abord**, et l'écran le dit avec ses propres
mots, jamais avec le `details` du serveur : ce texte est écrit dans une migration, en français, mais
il n'est pas un texte d'interface — même position que le dictionnaire fermé des codes d'incident du
§20.11.4 de `docs/SPEC-mail-subsystem.md`.

**Aucune confirmation n'est demandée avant de restaurer.** Restaurer est réversible — le geste
inverse est précisément celui qui a rempli cet écran — et non destructeur. Une confirmation ne se
justifie que devant une perte ; en exiger une ici l'aurait banalisée là où elle compte.

### 4.6 Les quatre états, et l'état vide est le cas NORMAL

Chargement, erreur, vide, succès (§5.8). L'état vide n'est pas un accident à cet endroit : une
corbeille vide est le bon état d'un produit sain. « La corbeille est vide » est donc une **phrase**,
jamais un tableau sans ligne, et elle n'offre aucune action — il n'y a rien à y faire.

Le succès d'une restauration est annoncé par un message `role="status"` **et** par la disparition de
la ligne : l'entrée restaurée quitte la corbeille, et la liste est relue plutôt que corrigée en
mémoire — une liste recomposée localement finirait par diverger de la base, et c'est la base qui
décide de ce que contient la corbeille.

### 4.7 Ce que l'écran ne fait délibérément PAS

- **Aucun effacement définitif**, ni par entrée ni en masse : le §6 n'est pas arbitré, et livrer une
  destruction irréversible sans règle de conservation serait le contraire d'une mesure de conformité.
- **Aucun « vider la corbeille »**, pour la même raison.
- **Aucun filtre, aucun tri, aucune pagination.** La corbeille est ordonnée par date de retrait
  décroissante et rendue en entier. C'est une **limite assumée**, pas un oubli : le jour où une
  rétention sera arbitrée (§6 point 1), le volume deviendra borné par elle ; d'ici là, un workspace
  qui retirerait des milliers d'objets ferait transiter une liste non bornée. La limite est portée au
  §7.
- **Aucune mise à la corbeille depuis cet écran** : on n'y retire rien, on y rend. Les gestes de
  retrait vivent là où vivent les objets.

## 5. Preuves attendues

| Niveau | Preuves |
|---|---|
| pgTAP | Les deux colonnes ajoutées, leur nullabilité, la clé étrangère de `deleted_by` et son `on delete set null` ; `deleted_by` refusée en écriture au client et écrite par le trigger ; la restauration d'un enfant sous parent en corbeille refusée par son nom |
| API | Mise en corbeille et restauration avec les jetons RÉELS des trois profils : accordées à qui peut écrire, refusées aux autres — et le refus constaté par relecture, la clause `USING` d'une politique rendant `200` et `[]` sans erreur (décision 70) ; l'énumération des enfants lue par la même requête que l'écran |
| Unitaire | La composition de l'énumération, le classement des refus, l'état vide |
| E2E | Mise en corbeille d'une card, d'un channel et d'un track sur la vraie base, chacune confirmée **en base** ; restauration vérifiée par la valeur `NULL` relue ; refus réel de la restauration sous parent en corbeille ; parcours complet au clavier seul |
| Visuel | Captures aux quatre paliers, dont l'état **vide** et la confirmation portant l'énumération |
| Seed | Le seed porte déjà **une** card en corbeille (`Saisie erronée`) — MESURÉ. Il devra porter au moins un channel et un track en corbeille, ainsi qu'un enfant sous parent en corbeille, sans quoi le refus du §3.4 n'a aucun cas de démonstration. **LIVRÉ** par la quatrième tranche : `docs/SPEC-seed.md` §10 — track `legacy-2023` en corbeille, channel `annexes-2023` en corbeille sous lui, channel `dossiers-2023` actif sous lui. La corbeille y est posée par un **geste réel** de l'administratrice et non déclarée, faute de quoi `deleted_by` naîtrait nul (§10.2) |

## 6. Points ouverts — ARBITRAGE DU RESPONSABLE, non tranchés ici

1. **La durée de rétention.** `docs/SPEC-cards.md` §10 point 2 la laisse déjà ouverte : « toute
   rétention est une décision de conformité (`CLAUDE.md` §11) ». Cette spécification ne la fixe pas.
   Elle pose seulement que, le jour où elle sera décidée, elle sera une **valeur de configuration
   documentée** et non un nombre écrit dans le code (`CLAUDE.md` §3).
2. **L'effacement définitif et le parcours RGPD.** La Definition of Done le réserve à ce parcours.
   Tant que la rétention n'est pas arbitrée, aucun effacement n'est livré : livrer une destruction
   irréversible sans règle de conservation serait le contraire d'une mesure de conformité.
3. **La corbeille est-elle visible d'un membre ordinaire, ou du seul administrateur ?** Le §2.2
   montre qu'aujourd'hui la lecture suit celle du channel. Étendre ou restreindre est une décision
   de produit ; en l'absence d'arbitrage, la règle existante est conservée telle quelle.

## 7. Limites connues

1. **La corbeille est rendue en entier, sans pagination** (§4.7). Bornée en pratique par le volume
   d'un workspace de démonstration, elle ne l'est par aucune règle tant que la rétention du §6 n'est
   pas arbitrée. Une pagination posée aujourd'hui devrait l'être sur trois tables et un tri commun
   calculé côté client — un coût qui n'a pas de contrepartie tant que le volume n'est pas mesuré
   comme un problème (`CLAUDE.md` §21, « ne pas optimiser sans mesure »).
2. **Le tri croisé des trois tables est fait côté client.** Chaque lecture est ordonnée par le
   serveur, mais leur **fusion** l'est en mémoire : `deleted_at` est présent sur chaque ligne, le tri
   est donc exact, et il porte sur ce qui a déjà été rapporté. Une pagination serveur, si elle est un
   jour due, demandera une vue SQL réunissant les trois tables — et c'est la même unité qui portera
   les deux.
