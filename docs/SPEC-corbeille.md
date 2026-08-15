# Spécification — corbeille et restauration

Contrat exécutable de `CRM-077` (`docs/BACKLOG.md`).

- Unité de backlog : `CRM-077` — corbeille et restauration.
- Modèle des cards : `docs/SPEC-cards.md` §4 (cycle de vie), §5 (« active »), §6 (autorisations),
  §10 point 2 (la purge, laissée ouverte).
- Arborescence : `docs/SPEC-administration-arborescence.md` (tracks et channels, leur archivage).
- Schéma : `docs/SCHEMA.md`.
- Design system : `docs/DESIGN_SYSTEM.md`.
- Déploiement : `docs/PROD_MIGRATIONS.md`.
- État : **spécifiée, non livrée.** Écrite avant toute ligne de code (`CLAUDE.md` §5).

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

## 5. Preuves attendues

| Niveau | Preuves |
|---|---|
| pgTAP | Les deux colonnes ajoutées, leur nullabilité, la clé étrangère de `deleted_by` et son `on delete set null` ; `deleted_by` refusée en écriture au client et écrite par le trigger ; la restauration d'un enfant sous parent en corbeille refusée par son nom |
| API | Mise en corbeille et restauration avec les jetons RÉELS des trois profils : accordées à qui peut écrire, refusées aux autres — et le refus constaté par relecture, la clause `USING` d'une politique rendant `200` et `[]` sans erreur (décision 70) ; l'énumération des enfants lue par la même requête que l'écran |
| Unitaire | La composition de l'énumération, le classement des refus, l'état vide |
| E2E | Mise en corbeille d'une card, d'un channel et d'un track sur la vraie base, chacune confirmée **en base** ; restauration vérifiée par la valeur `NULL` relue ; refus réel de la restauration sous parent en corbeille ; parcours complet au clavier seul |
| Visuel | Captures aux quatre paliers, dont l'état **vide** et la confirmation portant l'énumération |
| Seed | Le seed porte déjà **une** card en corbeille (`Saisie erronée`) — MESURÉ. Il devra porter au moins un channel et un track en corbeille, ainsi qu'un enfant sous parent en corbeille, sans quoi le refus du §3.4 n'a aucun cas de démonstration |

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
