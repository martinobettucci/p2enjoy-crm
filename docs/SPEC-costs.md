# Budgets et coûts

Spécification écrite **avant tout code**, sur décision du responsable du 2026-08-19
(`docs/JOURNAL.md`, décision 432). Unités porteuses : `CRM-084` (budgets et occurrences),
`CRM-085` (lignes de coût d'une affaire), `CRM-086` (écrans de coûts).

## 1. Le modèle en une phrase

Un **track** porte des **budgets**. Une **affaire** porte des **lignes de coût** — autant qu'il en
faut —, chacune rattachée à un budget, chacune avec un **coût estimé** et un **coût réel**. Les
écrans comparent, par budget, la somme des estimés à la somme des réels.

Exemple réel, celui qui a motivé la demande : une affaire porte `Publicité — estimé 100, réel non
connu` et `Production — estimé 350, réel 375`. **Deux lignes, une affaire.** Une affectation unique
par affaire ne rendrait pas ce cas, et c'est pourquoi le modèle porte des lignes et non une
colonne.

## 2. Objets

### 2.1 `budgets`

| Attribut | Règle |
|---|---|
| `track_id` | non nul — un budget appartient à un track |
| `name` | non vide, unique par track parmi les budgets **non clôturés** |
| `currency` | `text`, défaut `'EUR'`, `^[A-Z]{3}$` — même convention que `cards.currency` |
| `planned_amount` | `numeric(14,2)`, facultatif — l'enveloppe, si elle est décidée |
| `is_recurrent` | booléen, défaut faux |
| `closed_at` | horodatage, nul tant que le budget est ouvert |
| `position` | ordre d'affichage, attribuée par trigger si omise |
| `stale_after_days` | `integer`, **facultatif**, `null` ou strictement positif — le seuil d'ancienneté d'une ligne de coût de ce budget (§2.1 bis) |

**L'unicité du nom ne porte que sur les budgets ouverts.** Clôturer « Salon 2025 » puis ouvrir un
nouveau « Salon 2025 » l'année suivante est un geste normal ; l'interdire forcerait des noms
artificiels.

**Aucune contrainte de signe sur les montants**, comme pour `cards.amount` : un avoir, une remise
ou un remboursement sont des coûts négatifs légitimes.

### 2.1 bis Le seuil d'ancienneté d'une ligne de coût — arbitrage rendu le 2026-08-29, INC-183

`docs/DESIGN_SYSTEM.md` §5.31 promet, de la colonne « Ancienneté » de la table de saisie en série :
« au delà d'un seuil, elle passe en `--color-danger-on-soft` sur `--color-danger-soft`, comme la
pastille d'ancienneté d'une card (§5.1) ». Le §4.8.1 point 2 a livré la colonne **sans** cette
variante, faute de seuil, et a consigné l'écart à **INC-183** le 2026-08-20. L'entrée proposait
trois issues ; elle est tranchée ici par la session (`docs/CloudWorker.md` §4.1 bis, règle du
2026-08-27), et **l'issue retenue est la n° 2 : le seuil est une DONNÉE du budget.**

**Le motif tient en une phrase déjà écrite ailleurs dans le produit** : *un seuil absent ne devient
jamais un seuil par défaut* (`docs/SPEC-relances.md` §2.2, tenue par `seuilEffectif` de
`webapp/src/lib/carte-figee.ts`). L'étape `Livré` du seed ne porte aucun seuil, et ses affaires ne
sont donc **jamais** figées — le produit refuse déjà, une fois, d'inventer un rythme que personne
n'a décidé. Un budget sans seuil se comporte exactement pareil : **aucune variante de danger, sur
aucune de ses lignes**.

**Pourquoi le BUDGET porte le seuil, et pas autre chose.** Le seuil d'une card vit sur son étape
parce que l'étape est l'objet qui gouverne son rythme : une qualification et une signature ne
vieillissent pas au même pas. Pour une ligne de coût, l'objet qui gouverne le rythme est son
**budget** : un achat d'espace publicitaire se facture en quelques jours, un salon se solde après
l'événement. Le parallèle du §5.31 — « c'est le même signal, il doit avoir la même forme » — est
alors exact des deux côtés : même forme visuelle, et même doctrine de résolution.

**Les deux autres issues sont écartées, et voici par quoi.**

- **Issue n° 1, une constante de produit** — « soixante jours », posée une fois dans un module de
  configuration. Écartée parce qu'elle ferait cohabiter **deux doctrines contraires pour un même
  signal** : la pastille d'une card se tait quand personne n'a décidé, la cellule d'une ligne de
  coût crierait sur une valeur que personne n'a décidée. C'est le « comportement juste une fois sur
  deux » que `docs/CloudWorker.md` §4.1 bis proscrit, et la valeur métier codée en dur de
  `CLAUDE.md` §3 — la centraliser dans un module ne la rend pas décidée, elle la rend seulement
  décidée **une seule fois par nous**.
- **Issue n° 3, retirer la seconde phrase du §5.31** — l'ordre du tableau porterait alors
  l'information que la teinte devait porter. Écartée sur une mesure de l'écran lui-même : le §4.8
  liste **toute** la population en attente, du plus ancien au plus récent, qu'elle soit en retard ou
  non. La position dit donc un **rang**, jamais un **franchissement** ; la première ligne d'un
  onglet où rien n'est en retard est au même endroit que la première ligne d'un onglet où tout l'est.
  Retirer la teinte serait la perte silencieuse que `docs/CloudWorker.md` §4.1 bis interdit.

**LE REPLI AU NIVEAU DU WORKSPACE, que l'issue n° 2 nommait, n'est PAS retenu.** Le repli d'une card
existe parce qu'une étape est la **copie** d'un nœud du catalogue, et que le catalogue porte la
valeur par défaut (`workflow_nodes_catalog.default_stale_after_days`, mesuré : 7 à 30 jours selon le
nœud). Un budget n'est la copie de rien. Poser un défaut de workspace demanderait une seconde
colonne, une seconde surface d'administration et un ordre de résolution, pour une valeur qu'aucune
unité n'a demandée. `stale_after_days` est donc résolu **en un seul temps** : le sien, ou rien.

**Contrat, ligne à ligne.**

| Point | Règle |
|---|---|
| Colonne | `budgets.stale_after_days`, `integer`, nullable, sans défaut |
| Contrainte | `stale_after_days is null or stale_after_days > 0` — même forme et même nom de suffixe que `workflow_steps_stale_check` |
| Résolution | le seuil du budget, ou `null`. **Aucun repli**, ni sur l'occurrence, ni sur le track, ni sur le workspace |
| Occurrence | `budget_occurrences` ne porte **aucun** seuil : une occurrence est une instance de son budget, pas une politique de rythme distincte |
| Écriture | par la politique d'écriture des budgets déjà posée par la migration `0050` — `app.is_workspace_admin`. **Aucune politique, aucun privilège, aucune fonction neuve** |
| Refus mesuré | un `PATCH` d'un non-administrateur rend **`200` et zéro ligne**, la clause `USING` filtrant la ligne — et non `403` / `42501` (mesure M8 du 2026-08-29) |
| Comparaison | une ligne est **en retard** lorsque son ancienneté en jours révolus est **strictement supérieure** au seuil. Un seuil de 30 jours ne colore pas une ligne de 30 jours : la card emploie déjà la borne large du §2.5 de `docs/SPEC-relances.md`, et « au delà d'un seuil » se lit de la même façon |
| Seuil absent | **aucune variante**, jamais une valeur de repli |
| Ancienneté illisible | `ancienneteEnJours` rend `null`, la cellule reste vide (§4.8.1), et une cellule vide n'est **jamais** en retard |

**CE QUE LE SEED DOIT PORTER, ET C'EST UNE MESURE QUI L'IMPOSE.** Le 2026-08-29, les trois lignes
sans réel du seed ont **zéro jour** d'ancienneté — elles naissent à l'exécution du seed. Aucune
d'elles ne franchirait donc jamais aucun seuil, et la variante serait livrée **indémontrable**
(`CLAUDE.md` §8). Mesuré le même jour (M5) : un `POST /rest/v1/card_costs` portant `created_at`
explicite est accepté (`201`) et la valeur est **conservée telle quelle**. Le seed antidate donc la
ligne qu'il veut voir en retard, par le même chemin d'API que les autres.

Le jeu de démonstration porte alors les **trois** états, et non un seul :

| Budget | Seuil | Ligne sans réel | État attendu |
|---|---|---|---|
| « Prospection sortante » | **30** | « Prospection terrain », antidatée de **120 jours** | **en retard** — variante de danger |
| « Publicité 2026 » | **90** | « Publicité », du jour | dans les temps — variante neutre |
| « Salon du web 2025 » (clôturé) | **aucun** | « Impression plaquettes », du jour | **aucun seuil** — variante neutre, et elle le resterait à mille jours |

Sans la troisième ligne, « pas de seuil » et « seuil non franchi » rendraient la même chose à
l'écran et une régression qui confondrait les deux passerait inaperçue.

### 2.2 `budget_occurrences` — les instances d'un budget récurrent

| Attribut | Règle |
|---|---|
| `budget_id` | non nul |
| `label` | non vide, unique par budget — « Janvier 2026 » |
| `period_start`, `period_end` | `date`, facultatives, **purement descriptives** |
| `planned_amount` | `numeric(14,2)`, facultatif — l'enveloppe de cette occurrence |
| `closed_at` | une occurrence se clôture indépendamment de son budget |

**Aucune génération automatique, et c'est la demande explicite du responsable.** On crée « janvier »
à la main, puis « février » à la main, et **on ne crée pas « mars » s'il ne s'est rien passé en
mars**. Le produit ne pose aucun calendrier, ne devine aucune période et ne propose aucun
« générer les douze mois ». Un mois sans occurrence est une information — il ne s'est rien passé —
que la génération automatique détruirait en fabriquant une occurrence vide.

**`period_start` et `period_end` ne contraignent rien.** Elles servent à ordonner et à libeller.
Aucune ligne de coût n'est refusée parce que sa date sortirait de la période : le rattachement est
un choix de l'utilisateur, pas une déduction. C'est la même doctrine qu'au §1 de
`docs/SPEC-goals.md`.

**Un budget non récurrent n'a aucune occurrence**, et un trigger le refuse. Un budget récurrent
sans occurrence est légitime — il vient d'être créé — mais **aucune ligne de coût ne peut lui être
rattachée** tant qu'il n'en porte pas au moins une (§2.3).

### 2.3 `card_costs` — les lignes de coût d'une affaire

| Attribut | Règle |
|---|---|
| `card_id` | non nul, `on delete cascade` |
| `budget_id` | non nul |
| `occurrence_id` | **nul si le budget n'est pas récurrent, non nul s'il l'est** — trigger |
| `label` | non vide — « Publicité », « Production » |
| `estimated_cost` | `numeric(14,2)`, **non nul** |
| `actual_cost` | `numeric(14,2)`, **nullable** — « le réel, on le saisira après » |
| `created_by` | profil, `on delete set null` |

**`estimated_cost` est obligatoire et `actual_cost` ne l'est pas.** C'est l'asymétrie du cas
d'usage : on engage une dépense en la prévoyant, on la constate plus tard. Une ligne sans estimé
n'aurait rien à comparer ; une ligne sans réel est l'état normal d'une dépense en cours.

**`actual_cost` nul n'est pas zéro.** Un réel inconnu ne compte pas comme un réel nul dans les
agrégats, et l'écran distingue les deux (§4.4). Confondre « pas encore su » et « rien dépensé »
fausserait toute lecture de l'histogramme.

**Aucune unicité sur `(card_id, budget_id)` ni sur `(card_id, label)`.** Deux lignes « Publicité »
sur le même budget peuvent correspondre à deux achats distincts ; c'est à l'utilisateur de les
nommer, pas au schéma de les refuser.

**Un budget clôturé n'accepte aucune ligne neuve**, et une occurrence clôturée non plus — trigger.
Les lignes **déjà rattachées** restent, intactes et lisibles : clôturer n'efface pas l'histoire.

**Et leur `actual_cost` reste modifiable après la clôture.** C'est le point que la clôture rendait
ambigu, et il est tranché ici : on clôt une campagne **puis** les factures arrivent. Interdire la
saisie du réel sur un budget clos obligerait soit à le rouvrir, soit à renoncer à la seule donnée
qui rend la comparaison honnête. Le trigger refuse donc l'**insertion** et le changement de
rattachement — `budget_id`, `occurrence_id` —, jamais la mise à jour d'`actual_cost` ni du `label`.

**La devise d'une ligne est celle de son budget**, jamais celle de la card. Une ligne ne porte donc
pas de colonne `currency` : la porter permettrait d'additionner des devises différentes dans un
même total, ce qu'aucun écran ne saurait rendre honnêtement.

## 3. Autorisations

**Arbitrage du responsable, 2026-08-19.** Le budget est un **cadre** — décision de gestion ;
l'affectation est un **geste** quotidien. Les confondre bloquerait le travail ou ouvrirait la
gestion.

### 3.1 Lecture — la règle des tracks, sans exception

| Objet | Lisible lorsque |
|---|---|
| `budgets` | `app.can_read_track(track_id)` — droits fins compris, réouverture transitive comprise |
| `budget_occurrences` | l'appelant lit le budget |
| `card_costs` | l'appelant lit **la card** (`app.can_read_card`) **et** le budget |

**La double condition sur `card_costs` n'est pas une précaution redondante.** Une card et un budget
peuvent relever de deux tracks dont l'appelant ne lit que l'un : rendre la ligne au vu du seul
droit sur la card révélerait le nom et le montant d'un budget interdit, et l'inverse révélerait
l'existence d'une affaire.

### 3.2 Écriture

| Geste | Autorisé à |
|---|---|
| Créer, renommer, doter, rendre récurrent, réordonner, clôturer un budget | **administrateur du workspace** |
| Ouvrir, libeller, doter, clôturer une occurrence | **administrateur du workspace** |
| Créer, modifier, supprimer une **ligne de coût** | quiconque a `app.can_write_card(card_id)` |

**Une ligne de coût exige en outre que le budget soit lisible et ouvert.** On ne rattache pas une
dépense à une enveloppe qu'on n'a pas le droit de voir.

**Un budget ne se supprime pas : il se clôture.** Même doctrine que l'archivage des tracks et des
channels — des lignes de coût le référencent, et les détruire effacerait la dépense constatée.

## 4. Écrans

Détail visuel de l'histogramme : `docs/DESIGN_SYSTEM.md` §5.30.

### 4.0 Adresses des trois écrans — complété le 2026-08-19, décision 475

Les §4.2, §4.3 et §4.5 décrivaient le CONTENU des trois écrans sans jamais nommer leur **adresse**.
Le manque n'est pas cosmétique : sans adresse arrêtée avant le code, chaque tranche en inventerait
une, et le §4.8 exige qu'un onglet soit atteignable — donc partageable et rechargeable — sur chacun
des deux écrans à onglets.

| Écran | Adresse | Figure dans `ROUTES` |
|---|---|---|
| Coûts du track (§4.2) | `/tracks/:slugTrack/couts` | **non** |
| Détail d'un budget (§4.3) | `/tracks/:slugTrack/couts/:idBudget` | **non** |
| Cumul du workspace (§4.5) | `/couts` | **oui** |

**Les deux premières ne figurent pas dans `ROUTES`**, pour le motif exact déjà retenu par
`CHEMIN_CARD`, `CHEMIN_LISTE` et `CHEMIN_OBJECTIFS_TABLEAU` (`webapp/src/app/routes.tsx`) : leur
titre est une **donnée** — le nom du track, le nom du budget — et non une clé de traduction, et leur
contenu dépend d'un paramètre d'adresse. La couverture exacte `ROUTES` ⇄ `ENTREES_TRANSVERSES` reste
ainsi inchangée.

**Le cumul du workspace est une route de PREMIER NIVEAU**, et non une section de `/reglages` : c'est
le même raisonnement qui a placé le carnet de contacts et les objectifs hors des réglages — un
histogramme de coûts n'administre rien, il porte le travail. Il rejoint donc les entrées transverses
de la barre latérale.

**Le budget est désigné par son IDENTIFIANT**, jamais par son nom : le §2.1 pose que l'unicité du nom
ne porte que sur les budgets **non clôturés**, si bien que deux budgets « Salon 2025 » — l'un clos,
l'autre ouvert — peuvent coexister sur un même track. Un slug dérivé du nom ne désignerait alors
plus rien.

**L'onglet vit dans la CHAÎNE DE REQUÊTE**, `?onglet=saisir`, et non dans le chemin. Le §4.8 pose
deux onglets sur deux écrans ; les porter dans le chemin dupliquerait chaque adresse. L'absence du
paramètre vaut « Vue d'ensemble », qui est l'onglet par défaut. C'est la convention déjà employée
par la vue liste d'un channel pour son tri et son filtre.

### 4.1 Administration des budgets — dans le track

Sous l'administration de l'arborescence (`docs/DESIGN_SYSTEM.md` §5.13). Table des budgets du
track : nom, devise, enveloppe, récurrent ou non, nombre d'occurrences ouvertes, état.

Les budgets **clôturés sont masqués par défaut**, derrière un interrupteur « afficher les budgets
clôturés » — ils ne disparaissent pas de l'historique, ils sortent du chemin.

**Clôturer un budget qui porte des réels non saisis avertit et compte** : « ce budget porte n lignes
sans coût réel ; elles resteront saisissables après la clôture ». La clôture n'est pas empêchée —
c'est une décision de gestion —, mais elle n'est pas silencieuse : clôturer sans le savoir fige une
comparaison prévisionnel/réel fausse, et personne ne le verrait ensuite.

**Le seuil d'ancienneté s'administre ICI, et nulle part ailleurs — ajouté le 2026-08-29, §2.1 bis.**
Le formulaire de création et celui de modification portent un champ facultatif « Seuil d'ancienneté
(jours) », `type="number"`, `min="1"`, `step="1"`, dont le vide vaut `null`. Il n'entre **pas** dans
les colonnes de la table : le §5.9 réserve les colonnes à ce qu'on **compare** d'une ligne à
l'autre, et un seuil se règle une fois puis s'oublie — la table en porterait une septième colonne
vide neuf fois sur dix. C'est le même traitement que `period_start` et `period_end` d'une
occurrence, réglées au formulaire et absentes de la liste.

**« Vide » et « zéro » sont DEUX choses ici aussi**, exactement comme l'enveloppe du §4.1 : un champ
laissé vide envoie `null` — *aucun seuil décidé* —, et il n'existe aucune saisie qui envoie `0`,
la contrainte de la base refusant les valeurs nulles ou négatives. Le refus correspondant est le
`23514` du dictionnaire du §4.1 bis.4, et l'écran le nomme sur le champ plutôt qu'en tête d'écran.

### 4.1 bis Les occurrences d'un budget récurrent — arbitrage rendu le 2026-08-28, INC-173

Le §3.2 nomme depuis `CRM-000` quatre gestes — « **ouvrir, libeller, doter, clôturer** une
occurrence » — et le §4.1 en compte le résultat dans une colonne. **Entre les deux, aucun chapitre ne
décrivait l'écran qui les porte** : c'est INC-173, consignée le 2026-08-19 et restée sans réponse
neuf jours. Elle est tranchée ici par la session, `docs/CloudWorker.md` §4.1 bis — la règle du
2026-08-27 qui remplace l'interdiction que l'entrée invoquait.

**Ce que l'absence coûte, et c'est mesuré, pas supposé.** Les deux occurrences de « Publicité 2026 »
existent parce que le seed les pose en SQL. Un budget récurrent **créé à l'écran** n'en porte aucune,
et le §4.7 écarte alors ce budget du sélecteur de la fiche d'affaire : **aucune ligne de coût ne peut
jamais lui être rattachée**. La récurrence est donc, à l'écran, une case à cocher qui rend un budget
inutilisable.

**L'issue retenue est la n° 1 de l'entrée : une sous-surface de la table des budgets du §4.1**,
dépliée sous la ligne du budget récurrent concerné. Trois motifs, et les deux autres issues sont
écartées par eux :

- **c'est là que le nombre d'occurrences est déjà rendu.** Ouvrir une occurrence depuis la cellule
  qui les compte est le geste le plus court, et il ne crée aucune notion nouvelle ;
- **l'issue n° 2 — l'écran de détail du §4.3 — inverserait l'ordre du plan** : `CRM-085` dépendrait
  de `CRM-086`, alors que le plan pose l'inverse. Une dépendance introduite par un choix de placement
  d'écran est un mauvais échange ;
- **l'issue n° 3 — les occurrences hors interface — laisserait le §4.6 à amender et la récurrence
  définitivement inutilisable.** C'est la perte silencieuse que `docs/CloudWorker.md` §4.1 bis
  interdit, déguisée en limite nommée.

#### 4.1 bis.1 Ce que la sous-surface montre

La cellule « occurrences » d'un budget **récurrent** devient un `button` de dépliage portant
`aria-expanded` (`docs/DESIGN_SYSTEM.md` §5.47). Sur un budget **non récurrent** elle reste un texte :
le trigger de la migration 50 refuse toute occurrence sur un tel budget, et offrir la commande
mènerait à un refus garanti.

**La sous-surface est rendue SOUS la table**, comme les trois autres surfaces du bloc, et elle nomme
le budget dont elle parle — point révisé le 2026-08-28 dans le même changement que le code, motif
écrit au §5.47 du design system.

Dépliée, elle rend la liste des occurrences du budget, **de la plus récente à la plus ancienne** —
`period_start` décroissante, `label` croissant à égalité, les périodes étant facultatives (§2.2) :

| Colonne | Contenu |
|---|---|
| Libellé | le `label` |
| Période | `period_start` → `period_end`, **cellule vide** si aucune n'est posée |
| Enveloppe | `planned_amount`, **cellule vide** s'il n'y en a pas — un « 0 » y serait une décision que personne n'a prise (§4.1) |
| État | le mot « Ouverte » ou « Clôturée », jamais une teinte seule (§1) |
| Actions | renommer/doter, clôturer ou rouvrir, retirer |

**Les occurrences clôturées ne sont pas masquées**, contrairement aux budgets du §4.1. Le motif est
mesuré : le seed porte deux occurrences dont **une close**, et l'onglet « À saisir » du §4.8 liste
précisément les lignes des occurrences closes — « c'est après la clôture que les factures arrivent ».
Une liste qui cacherait par défaut la moitié de son objet ferait chercher ailleurs ce qui est là. La
liste est courte par construction : le §2.2 interdit toute génération automatique.

#### 4.1 bis.2 Les quatre gestes, et le cinquième que la mesure a imposé

Les quatre gestes du §3.2 sont **ouvrir**, **libeller**, **doter** et **clôturer**. Libeller et doter
partagent un seul formulaire — ce sont deux attributs d'une même ligne, et les séparer aurait donné
deux commandes pour un seul aller-retour.

**Un cinquième geste est offert, et il n'est pas une extension de périmètre : il est déjà ouvert par
la base.** MESURÉ le 2026-08-28 avec le jeton réel de l'administratrice :

| Envoi | Réponse mesurée |
|---|---|
| `DELETE` d'une occurrence sans ligne de coût | `204`, la ligne disparaît |
| `DELETE` de « Janvier 2026 », qui porte une ligne de coût | `409` / `23503`, `card_costs_occurrence_id_fkey` |

Le retrait est donc **déjà possible**, et le refuser dans l'interface n'aurait rien fermé : la
politique de la migration 50 l'accorde à l'administratrice, et un `DELETE` direct passe. La doctrine
du §3.2 — « un budget ne se supprime pas : il se clôture » — vise ce qu'on **effacerait** : une
occurrence référencée par une dépense est protégée par la clé étrangère, et le produit n'a rien à
ajouter. Une occurrence ouverte par erreur, elle, ne référence rien et n'a aucune raison de rester.

**Le retrait est donc offert, sa confirmation dit ce qu'il fait, et son refus est traduit** : `23503`
se dit « cette occurrence porte des lignes de coût : clôturez-la plutôt que de la retirer », qui
nomme le geste de remplacement au lieu de recopier le corps du serveur.

#### 4.1 bis.3 Ce que l'écriture envoie

Trois appels, tous en écriture directe sur `budget_occurrences` — la migration 50 n'expose **aucune**
fonction, et en inventer une pour ces gestes aurait posé un second chemin devant une politique qui
suffit déjà :

| Geste | Envoi |
|---|---|
| Ouvrir | `POST` `{ budget_id, label, period_start?, period_end?, planned_amount? }` |
| Libeller et doter | `PATCH` `{ label, period_start, period_end, planned_amount }` |
| Clôturer / rouvrir | `PATCH` `{ closed_at }` — l'instant courant, ou `null` |
| Retirer | `DELETE` |

**Les trois attributs facultatifs sont TOUJOURS envoyés par la modification**, y compris nuls : ils
sont effaçables par nature (§2.2, « facultatives »), et les omettre au motif qu'ils sont vides rendrait
une enveloppe posée par erreur ineffaçable. C'est l'inverse exact du choix du §22.1 de
`docs/SPEC-mail-subsystem.md` pour `p_daily_quota`, et pour la même raison retournée : là-bas un
`coalesce` rendait l'omission irréversible, ici l'envoi rend l'effacement possible.

**La clôture et la réouverture n'ont pas de confirmation.** Elles sont réversibles d'un clic — c'est
la mesure M7/M8 ci-dessous —, et le §5.13 réserve la confirmation dans le flux à ce qui ne se défait
pas ainsi. Le retrait, lui, en porte une.

#### 4.1 bis.4 Dictionnaire fermé des refus

Traduits par leur code et le nom de leur contrainte, jamais par le texte du serveur
(`docs/DESIGN_SYSTEM.md` §5.13, dernier point) :

| Mesure | Code | Ce que l'écran dit |
|---|---|---|
| M4 — occurrence sur un budget non récurrent | `23514`, message du trigger | « ce budget n'est pas récurrent : rendez-le récurrent avant d'y ouvrir une occurrence » |
| M10 — libellé vide | `23514`, `budget_occurrences_label_check` | « le libellé ne peut pas être vide » |
| M5 — libellé déjà pris | `23505`, `budget_occurrences_budget_label_key` | « ce budget porte déjà une occurrence de ce libellé » |
| M2 — appelant non administrateur | `42501` | « seul un administrateur du workspace gère les occurrences » |
| M11 — retrait d'une occurrence référencée | `23503` | « cette occurrence porte des lignes de coût : clôturez-la plutôt que de la retirer » |
| tout autre | — | repli nommé, sans recopier le corps du serveur |

#### 4.1 bis.5 Ce que la mesure a établi, et qui ne se devine pas

Relevé le 2026-08-28 sur la pile seedée, avec les jetons réels des trois profils.

- **M3 — la lectrice LIT les deux occurrences** de « Publicité 2026 », son track lui étant ouvert.
  La sous-surface lui est donc **visible et entièrement en lecture seule**, comme le §4.8 le pose
  pour l'onglet « À saisir » : masquer la liste à qui la lit déjà par l'API mentirait sur l'écran.
  La table des budgets ne s'affiche toutefois que dans l'administration de l'arborescence, dont
  l'accès est déjà celui d'un administrateur ; l'état lecture seule est donc **une garantie, pas un
  parcours** — il est figé par une preuve d'API, pas par un scénario d'écran.
- **M8 — une occurrence CLOSE reste modifiable** : `PATCH planned_amount` sur une occurrence close
  rend `200`. Aucun trigger ne s'y oppose, contrairement au rattachement d'une ligne de coût (§2.3).
  Le produit ne rejoue donc **aucune** garde ici : renommer et doter restent offerts sur une
  occurrence close, et c'est cohérent avec le §4.8, qui fait arriver des factures après la clôture.
- **M5 — l'unicité du libellé n'est PAS insensible à la casse.** `  janvier 2026  ` a été accepté
  à côté de « Janvier 2026 » (`201`) : l'index unique porte sur `app.btrim_blancs(label)`, qui retire
  les blancs de tête et de queue et **ne replie pas la casse**. C'est **exactement** la normalisation
  que l'index des budgets applique au nom (`budgets_track_name_ouvert_key`). L'écart n'est donc pas
  une incohérence de cette surface : c'est la règle uniforme du produit, et cette section la nomme
  plutôt que de laisser une session future la redécouvrir comme un défaut.

### 4.2 Écran de coûts du track

**Histogramme, deux barres adjacentes par budget** : le **prévisionnel** — somme des
`estimated_cost` — et le **réel** — somme des `actual_cost` renseignés.

| Rôle | Jeton |
|---|---|
| Prévisionnel | `--color-brand` |
| Réel | `--color-success` |
| Réel dépassant le prévisionnel | `--color-danger` sur la seule barre concernée |

La couleur ne porte jamais seule l'information (`docs/DESIGN_SYSTEM.md` §1, détail visuel §5.30) : chaque barre porte sa
valeur en clair, et la légende nomme les deux séries.

**Un budget récurrent apparaît ici agrégé**, toutes occurrences confondues, en une seule paire de
barres — c'est la demande explicite du responsable. Un budget clôturé n'y figure pas.

### 4.3 Écran de détail d'un budget

Une paire de barres **par occurrence**, dans l'ordre des périodes puis des libellés. Sous
l'histogramme, la liste des lignes de coût — affaire, libellé, estimé, réel, auteur —, filtrable
par occurrence, et l'accès à l'affaire.

Un budget non récurrent affiche une seule paire de barres et la même liste.

### 4.4 Ce que l'écran dit du réel inconnu

Une ligne sans `actual_cost` **ne compte pas** dans la barre du réel. L'écran l'écrit sous
l'histogramme : « n lignes sans coût réel saisi, pour m € de prévisionnel ». Sans cette mention, un
réel bas se lirait comme une économie alors qu'il n'est qu'une saisie en retard — c'est la
principale façon dont un tel écran ment.

### 4.5 Cumul du workspace

Un écran « Coûts » au niveau du workspace, **un groupe de barres par track**, cumulant les budgets
ouverts de chaque track. Il ne montre que les tracks lisibles par l'appelant : le cumul est calculé
**après** application de la RLS, jamais avant. Un total qui inclurait un budget interdit le
divulguerait par soustraction.

**Les devises ne se mélangent pas.** L'écran regroupe par devise et rend un histogramme par devise
présente, plutôt qu'un total unique qui n'aurait aucun sens. S'il n'y en a qu'une — le cas
attendu —, l'utilisateur ne voit rien de cette mécanique.

### 4.6 Dans la fiche d'une affaire

Une section « Coûts » : la liste des lignes, l'ajout d'une ligne, la modification et la suppression.
Le sélecteur de budget ne propose que les budgets **ouverts et lisibles** du track de la card ; si
le budget choisi est récurrent, un **second sélecteur d'occurrence apparaît et devient obligatoire**
— il ne propose que les occurrences ouvertes.

Total de la section : estimé et réel de l'affaire, avec la mention du §4.4 si des réels manquent.

### 4.7 États

| État | Rendu |
|---|---|
| Aucun budget sur le track | « Aucun budget », et l'action d'en créer un pour un administrateur ; pour un autre membre, la phrase seule |
| Budget sans ligne de coût | histogramme à deux barres nulles, et « aucune dépense rattachée » |
| Budget récurrent sans occurrence | « Aucune occurrence ouverte », et le sélecteur de la fiche d'affaire **ne propose pas ce budget** |
| Aucun réel saisi | barre du réel nulle, mention du §4.4 obligatoire |
| Lecture seule | les gestes d'écriture sont indisponibles et lisibles, et l'écran dit pourquoi |

### 4.8 Onglet « À saisir » — les coûts en attente de leur réel

Demandé par le responsable le 2026-08-19 (`docs/JOURNAL.md`, décision 433). Les écrans de coûts sont
donc **à onglets** : « Vue d'ensemble » — l'histogramme des §4.2 et §4.5 — et « **À saisir** ».

**Ce que l'onglet résout.** Le §4.4 dit qu'une ligne sans `actual_cost` ne compte pas et que l'écran
doit l'annoncer. Il manquait le geste : savoir *combien* de réels manquent sans pouvoir les saisir
oblige à ouvrir une affaire après l'autre. Cet onglet est la surface de **saisie en série**.

**Ce qu'il liste.** Toutes les lignes `card_costs` dont `actual_cost` est **nul**, que l'appelant a
le droit de **lire**, dans la portée de l'écran — les budgets du track, ou tous les tracks lisibles
au niveau du workspace. **Y compris celles des budgets et occurrences clôturés** : c'est précisément
après la clôture que les factures arrivent, et les exclure viderait l'onglet de son usage. Une ligne
de budget clos porte une pilule « clôturé » pour que personne ne s'étonne de la voir.

**Tableau, une ligne par coût**, du plus ancien au plus récent — celui qui attend depuis le plus
longtemps est celui qu'on oublie :

| Colonne | Contenu |
|---|---|
| Ancienneté | depuis quand la ligne attend son réel |
| Budget | nom, devise, pilule « clôturé » le cas échéant |
| Occurrence | libellé, si le budget est récurrent |
| Affaire | titre, lien vers la fiche |
| Nature | le `label` de la ligne — « Publicité », « Production » |
| Estimé | `estimated_cost` |
| **Réel** | **champ de saisie**, vide |

**La saisie s'enregistre pour elle-même**, sans bouton d'enregistrement global, selon le mode déjà
posé au §5.7 ter du design system. `Entrée` valide et **place le curseur sur le champ de la ligne
suivante** : c'est cela, « faciliter la saisie », et sans cette règle l'onglet ne vaut pas mieux que
la fiche d'affaire.

**Une ligne enregistrée ne disparaît pas immédiatement.** Elle reste affichée, marquée
« enregistré », jusqu'au prochain chargement de l'onglet. La retirer à la volée ferait remonter les
lignes suivantes **sous les doigts** de celui qui saisit, et lui ferait écrire une valeur dans la
mauvaise ligne — c'est le défaut classique de ce genre d'écran, et il est interdit ici.

**Zéro est une valeur, pas un vide.** Saisir `0` signifie « finalement rien dépensé » et retire la
ligne de l'attente ; laisser le champ vide la laisse en attente. Le §2.3 pose que nul n'est pas
zéro, et cet onglet est l'endroit où la distinction se fait au clavier : elle est donc écrite sous le
tableau, pas supposée comprise.

**Ce que l'appelant ne peut pas écrire.** Une ligne lisible mais non écrivable — `app.can_write_card`
faux — est rendue **en lecture seule**, avec le motif, jamais masquée. Un tableau qui cacherait
silencieusement des lignes se lirait comme complet alors qu'il ne l'est pas ; c'est la même règle
qu'au §4.4 sur les réels manquants, appliquée aux droits.

**Compteur.** L'onglet porte un badge : le nombre de lignes en attente dans la portée de l'écran,
c'est-à-dire **exactement le nombre de lignes que son tableau liste**.

> **RÉVISÉ LE 2026-08-28 PAR L'ARBITRAGE D'INC-182 (§4.8.3).** Ce paragraphe ajoutait : « Il est le
> même nombre que celui de la mention du §4.4 — s'ils divergeaient, l'un des deux mentirait. »
> **Cette exigence est RETIRÉE**, parce qu'elle est structurellement intenable : la clôture et la
> devise séparent les deux populations (§4.8.2). Ce que la phrase voulait empêcher est tenu
> autrement, et plus strictement — chacun des deux nombres compte exactement ce que son écran
> montre, et la portée du badge est ÉCRITE à l'écran dès qu'il paraît (§4.8.3).

**États.**

| État | Rendu |
|---|---|
| Aucune ligne en attente | « Tous les coûts réels sont saisis. » — c'est une bonne nouvelle, pas un état vide en défaut |
| Aucune ligne **écrivable**, mais des lignes lisibles | le tableau est rendu, entièrement en lecture seule, et le dit en tête |
| `viewer` | l'onglet est visible, le tableau est en lecture seule, et l'écran dit pourquoi |

### 4.8.1 Contrat de lecture de l'onglet — complété le 2026-08-20, décision 479

Le §4.8 ci-dessus décrit le COMPORTEMENT de l'onglet sans nommer ce qui le rend possible. Trois
points y manquaient, chacun **indispensable avant la première ligne de code** ; ils sont complétés
ici, et **uniquement** ici — le reste du §4.8 n'est pas réécrit (`docs/CloudWorker.md` §3.2, point 3).
Tout ce qui suit est **mesuré sur la pile de développement** le 2026-08-20, jamais supposé.

**1. LE DROIT D'ÉCRITURE D'UNE LIGNE EST RENDU PAR LA BASE, JAMAIS CALCULÉ PAR L'INTERFACE.** Le
§4.8 exige qu'« une ligne lisible mais non écrivable — `app.can_write_card` faux — soit rendue en
lecture seule, avec le motif, jamais masquée ». L'interface ne peut donc pas se contenter d'envoyer
et de traduire le refus, comme le fait le reste du produit
(`docs/DESIGN_SYSTEM.md` §5.13, §5.16, §5.21) : elle doit connaître le droit **avant** de rendre le
champ. Et elle ne doit pas le déduire d'un rôle — `CLAUDE.md` §10 l'interdit dans les deux sens, et
un rôle serait faux : les droits fins de `SPEC-permissions-rls.md` §3.7 ouvrent l'écriture par
channel.

La lecture porte donc une **colonne calculée** exposée par PostgREST :

```
public.reel_saisissable(ligne public.card_costs) returns boolean
  => app.can_write_card(ligne.card_id)
```

`stable`, **jamais `security definer`** : elle doit s'évaluer sous l'identité de l'appelant. Elle
n'ouvre aucune donnée — `app.can_write_card` est déjà exécutable par `anon` et `authenticated`
(migration 13) — et elle n'ajoute **aucun aller-retour** : PostgREST la rend comme une colonne de
plus dans la même requête. Le droit reste ainsi une règle de la base que l'écran **lit**, et non une
règle que l'écran **rejoue**.

MESURÉ, sur le seed, `actual_cost=is.null` :

| Appelant | Lignes rendues | `reel_saisissable` |
|---|---|---|
| `admin@p2enjoy.test` | 2 — « Publicité », « Prospection terrain » | `true` sur les deux |
| `bizdev@p2enjoy.test` | 2 — les mêmes | `true` sur les deux |
| `viewer@p2enjoy.test` | **1** — « Publicité » seule | **`false`** |

La lectrice ne voit qu'une des deux lignes : « Prospection terrain » est rattachée à « Prospection
sortante », budget d'un track qu'elle ne lit pas, et la **double condition du §3.1** l'écarte. C'est
le cas qui rend l'état « aucune ligne écrivable, mais des lignes lisibles » du §4.8 réellement
observable.

**2. L'ANCIENNETÉ SE MESURE SUR `created_at`, ET SON SEUIL N'EST PAS ARBITRÉ.** La colonne
« Ancienneté » compte depuis la **création de la ligne** — c'est-à-dire depuis que la dépense a été
engagée sans son réel —, jamais depuis `updated_at`, qui bougerait à chaque correction du libellé et
ferait rajeunir une ligne qu'on vient de renommer.

Le §5.31 de `docs/DESIGN_SYSTEM.md` ajoute qu'« au-delà d'un seuil, elle passe en
`--color-danger-on-soft` […] comme la pastille d'ancienneté d'une card (§5.1) ». **Ce seuil n'existe
pas pour une ligne de coût** : celui d'une card est une donnée du workflow — `stale_after_days` de
l'étape, avec le repli `default_stale_after_days` du catalogue —, et une ligne de coût n'a ni étape
ni nœud. En inventer un — trente jours, soixante — poserait une règle de gestion que personne n'a
prise (`CLAUDE.md` §3, « éviter les valeurs métier codées en dur »). La colonne est donc rendue en
13 px `--color-text-2` **sans variante de danger**, l'écart est consigné à **INC-183**, et il tombera
par arbitrage, jamais par supposition.

> **RÉVISÉ PAR LIVRAISON le 2026-08-29 — l'arbitrage est rendu, et le paragraphe ci-dessus reste
> lisible parce qu'il dit encore le vrai de ce qui l'a motivé.** INC-183 est tranchée au **§2.1 bis**
> : le seuil est une donnée du budget, `budgets.stale_after_days`, nullable et sans repli. Ce qui
> change ici, et seulement cela : la colonne « Ancienneté » porte désormais la variante de danger
> **lorsque le budget de la ligne déclare un seuil et que l'ancienneté le dépasse strictement**, et
> conserve son rendu neutre dans les deux autres cas — seuil absent, seuil non franchi. La lecture
> de l'onglet ramène donc `budgets.stale_after_days` dans son embed, comme elle ramène déjà
> `budgets.name` et `budgets.closed_at` ; **aucun aller-retour supplémentaire**, et le droit
> d'écriture du point 1 ci-dessus est inchangé.

**3. CE QUE LA SAISIE ENVOIE, ET LA FRONTIÈRE EXACTE DU §2.3.** L'écriture est un `PATCH` sur
`card_costs`, portant **`actual_cost` et rien d'autre**. Le §2.3 pose que « le trigger refuse
l'insertion et le changement de rattachement — `budget_id`, `occurrence_id` —, jamais la mise à jour
d'`actual_cost` ni du `label` », et c'est **mesuré des deux côtés** sur la ligne « Production »,
rattachée au budget **clôturé** « Salon du web 2025 » :

| Envoi | Réponse mesurée |
|---|---|
| `{ "actual_cost": 376.00 }` | `200`, **une ligne** rendue |
| `{ "budget_id": …, "occurrence_id": … }` | `23514` — « cette ligne est rattachée à un budget clôturé : son rattachement ne change plus » |

C'est pourquoi cet onglet n'emploie **pas** `modifierLigneCout` de `card-costs.ts`, qui renvoie les
cinq attributs : sur un budget clos, cet envoi traverse aujourd'hui — le trigger ne s'oppose qu'au
**changement** —, mais il fait dépendre la saisie d'un rattachement que l'onglet n'a aucune raison
de connaître, et une évolution du trigger le casserait sans que rien ne l'annonce. La saisie envoie
la seule colonne qu'elle modifie.

**Trois issues, comme partout ailleurs** (`docs/DESIGN_SYSTEM.md` §5.25, §5.27) : appliqué, refusé,
et **sans effet** — `200` et zéro ligne, ce que rend la clause `USING` de la politique de mise à jour
lorsque le droit d'écriture est retombé depuis le chargement. La troisième est **dite**, jamais
présentée comme un succès.

### 4.8.2 La portée du badge, et ce qu'elle ne peut pas être — décision 479

Le §4.8 écrit que le badge « est le même nombre que celui de la mention du §4.4 ». **Cette égalité
est fausse dès que le produit exerce ses propres règles**, et la contradiction est consignée à
**INC-182** plutôt que tranchée ici. Deux causes, toutes deux structurelles :

- la mention du §4.4 est rendue **sous un histogramme**, donc **par devise** (§4.5), tandis qu'un
  badge d'onglet est un nombre **unique** ;
- l'onglet liste les lignes des budgets **clôturés** (§4.8), que l'histogramme du §4.2 **exclut**
  explicitement. Une ligne sans réel sur un budget clos est donc comptée par l'un et pas par l'autre
  — et c'est exactement le cas que la Definition of Done de `CRM-086` demande de rendre
  **saisissable**.

**Le comportement retenu, en attendant l'arbitrage : le badge compte les lignes que le tableau de
l'onglet LISTE**, dans la portée de l'écran. Un badge qui annoncerait un autre nombre que celui des
lignes rendues juste en dessous mentirait sur l'écran même où il est posé, ce qui est le défaut que
le §4.8 cherchait à prévenir. La phrase du §4.8 garde sa raison — deux nombres qui parlent de la même
chose ne doivent pas diverger — mais elle désigne deux nombres qui ne parlent pas de la même chose.

### 4.8.3 L'arbitrage d'INC-182 — RENDU le 2026-08-28, décision 544

Le §4.8.2 constatait l'écart et le laissait suspendu. Il est tranché ici, sur le mandat du
`docs/CloudWorker.md` §4.1 bis, et la Definition of Done de `CRM-086` est révisée dans le même
geste. **La mesure d'abord**, refaite le 2026-08-28 sur la pile seedée avec le jeton réel du
business developer, par la vraie route REST — jamais d'après le souvenir de la mesure du 2026-08-20 :

| Portée | Lignes en attente lisibles | Dont sur un budget OUVERT |
|---|---|---|
| Track « Studio web » (§4.2) | **2** — « Publicité » et « Impression plaquettes » | **1** — « Publicité », sur `Publicité 2026` |
| Workspace, même appelant (§4.5) | **3** — la précédente et « Prospection terrain » | **2** |

La seconde colonne est celle que les mentions du §4.4 totalisent, l'histogramme excluant les
budgets clôturés ; la première est celle du badge. L'écart est donc **reproduit**, et il ne tient à
aucun défaut de code. La devise en est la seconde cause, latente sur ce jeu : `Suisse romande` est
libellé en **CHF**, de sorte qu'une ligne en attente sur ce budget rendrait un second histogramme,
donc une **seconde** mention du §4.4, quand le badge resterait un nombre unique.

**ISSUE RETENUE : la n° 1 du registre — les deux nombres n'ont jamais eu à être égaux, et le §4.8
est révisé.** Le badge compte la portée de l'ONGLET ; la mention du §4.4 compte la portée de SON
histogramme. Aucune migration, aucun changement de lecture, aucun filtre ajouté ou retiré : la
décision retient le comportement livré au §4.8.2, et lui donne son texte.

**CE QUE LA DÉCISION AJOUTE, ET SANS QUOI ELLE NE SERAIT QU'UNE PHRASE RAYÉE.** Deux nombres
légitimement différents sur un même écran s'y lisent comme une erreur de calcul tant que rien ne dit
ce que chacun compte. La règle est donc celle que le §4.5 a déjà posée pour le cumul du workspace —
*la portée d'un nombre est écrite à l'écran* —, appliquée ici :

- **le nom accessible du badge nomme sa population** : « n ligne(s) en attente de leur coût réel,
  budgets clôturés compris, toutes devises confondues ». Un badge est un chiffre nu, et le §5.4 bis
  du design system veut qu'un compte porte un nom accessible entier ; ce nom doit dire *ce qui est
  compté*, pas seulement *qu'on compte* ;
- **l'onglet « Vue d'ensemble » écrit la portée du badge sous la barre d'onglets**, dès lors que le
  badge est rendu — donc dès que le compte est connu et non nul. C'est l'onglet qui porte les
  mentions du §4.4 ; c'est donc là, et là seulement, que les deux nombres se rencontrent.

**POURQUOI CETTE PHRASE N'EST PAS CONDITIONNÉE À UNE DIVERGENCE RÉELLE**, alors que le §4.5
conditionne bien le titre d'un histogramme à la présence de plusieurs devises. Pour savoir si les
deux nombres diffèrent, l'onglet devrait recalculer la population de l'histogramme — c'est-à-dire
tenir une **seconde source** pour un nombre que la vue d'ensemble possède déjà, exactement la
divergence que le §4.8.2 ferme. Et la condition serait fausse au premier motif d'écart ajouté : un
track archivé au niveau du workspace en est déjà un troisième. La phrase est donc rendue avec le
badge, toujours, dans la formulation la plus courte qui reste vraie dans les trois cas.

**LES DEUX AUTRES ISSUES SONT ÉCARTÉES, ET VOICI POURQUOI.**

- **Issue n° 2 — l'onglet cesserait de lister les budgets clos.** Elle contredit la raison d'être de
  l'onglet, que le §4.8 énonce en toutes lettres : « c'est précisément après la clôture que les
  factures arrivent, et les exclure viderait l'onglet de son usage. » Elle rendrait en outre la
  Definition of Done de `CRM-086` inapplicable, celle-ci exigeant qu'une ligne de budget clos soit
  présente et **saisissable**. Elle achèterait l'égalité de deux nombres au prix d'une
  fonctionnalité.
- **Issue n° 3 — la mention du §4.4 gagnerait « dont n sur un budget clôturé ».** Elle ne referme pas
  l'écart, elle le déplace : une ligne clôturée n'appartient à AUCUN histogramme, et sur un écran à
  deux devises il faudrait choisir sous lequel des deux la compter — ou la compter deux fois. Elle
  écrirait de surcroît, sous un graphique dont le §4.2 exclut les budgets clos, un nombre qui les
  inclut : un chiffre placé là où le lecteur ne peut pas le retrouver.

**CE QUE LA PREUVE DOIT TENIR APRÈS CET ARBITRAGE**, en remplacement du point devenu impossible :
le badge porte **exactement** le nombre de lignes que le tableau de l'onglet rend, la divergence
avec la mention du §4.4 est **mesurée** sur le seed plutôt que supposée, et la phrase de portée est
**présente à l'écran** là où les deux nombres se croisent. C'est plus fort que l'égalité retirée :
une régression qui ajouterait un filtre de clôture à la lecture de l'onglet — le mimétisme que le
§4.8.1 redoute — ferait tomber la mesure, là où l'égalité l'aurait au contraire accueillie.

## 5. Ce qui n'est pas au périmètre

- aucune conversion de devise, aucun taux de change ;
- aucune génération automatique d'occurrences, aucun calendrier (§2.2) ;
- aucune alerte de dépassement, aucun envoi d'email ;
- aucune répartition automatique d'un coût entre plusieurs affaires ;
- aucun rapprochement avec une facture, aucune pièce jointe sur une ligne ;
- aucun import de réels depuis un fichier, ni rapprochement automatique avec une facture — l'onglet §4.8 est une saisie manuelle assistée, pas une reprise de données ;
- aucun export comptable — `CRM-071` porte l'import/export, et cette spécification ne le préempte pas.
