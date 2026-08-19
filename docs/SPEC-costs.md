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

**L'unicité du nom ne porte que sur les budgets ouverts.** Clôturer « Salon 2025 » puis ouvrir un
nouveau « Salon 2025 » l'année suivante est un geste normal ; l'interdire forcerait des noms
artificiels.

**Aucune contrainte de signe sur les montants**, comme pour `cards.amount` : un avoir, une remise
ou un remboursement sont des coûts négatifs légitimes.

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

### 4.1 Administration des budgets — dans le track

Sous l'administration de l'arborescence (`docs/DESIGN_SYSTEM.md` §5.13). Table des budgets du
track : nom, devise, enveloppe, récurrent ou non, nombre d'occurrences ouvertes, état.

Les budgets **clôturés sont masqués par défaut**, derrière un interrupteur « afficher les budgets
clôturés » — ils ne disparaissent pas de l'historique, ils sortent du chemin.

**Clôturer un budget qui porte des réels non saisis avertit et compte** : « ce budget porte n lignes
sans coût réel ; elles resteront saisissables après la clôture ». La clôture n'est pas empêchée —
c'est une décision de gestion —, mais elle n'est pas silencieuse : clôturer sans le savoir fige une
comparaison prévisionnel/réel fausse, et personne ne le verrait ensuite.

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

**Compteur.** L'onglet porte un badge : le nombre de lignes en attente dans la portée de l'écran. Il
est le même nombre que celui de la mention du §4.4 — s'ils divergeaient, l'un des deux mentirait.

**États.**

| État | Rendu |
|---|---|
| Aucune ligne en attente | « Tous les coûts réels sont saisis. » — c'est une bonne nouvelle, pas un état vide en défaut |
| Aucune ligne **écrivable**, mais des lignes lisibles | le tableau est rendu, entièrement en lecture seule, et le dit en tête |
| `viewer` | l'onglet est visible, le tableau est en lecture seule, et l'écran dit pourquoi |

## 5. Ce qui n'est pas au périmètre

- aucune conversion de devise, aucun taux de change ;
- aucune génération automatique d'occurrences, aucun calendrier (§2.2) ;
- aucune alerte de dépassement, aucun envoi d'email ;
- aucune répartition automatique d'un coût entre plusieurs affaires ;
- aucun rapprochement avec une facture, aucune pièce jointe sur une ligne ;
- aucun import de réels depuis un fichier, ni rapprochement automatique avec une facture — l'onglet §4.8 est une saisie manuelle assistée, pas une reprise de données ;
- aucun export comptable — `CRM-071` porte l'import/export, et cette spécification ne le préempte pas.
