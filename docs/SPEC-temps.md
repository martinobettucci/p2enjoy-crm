# Saisie de temps et coût du personnel — `CRM-098`

*Écrite le 2026-10-11, avant tout code, sur les arbitrages du responsable consignés en décision 621
(`docs/JOURNAL.md`). Unité de backlog : `CRM-098` (`docs/BACKLOG.md`). Règles visuelles :
`docs/DESIGN_SYSTEM.md` §5.54. Schéma : `docs/SCHEMA.md`, « Migration `0087` ».*

*Complétée le 2026-10-23 par le §7.6 — la saisie depuis la fiche d'une affaire, unité `CRM-106`, décision 630 ;
règles visuelles : `docs/DESIGN_SYSTEM.md` §5.54 bis.*

Les choix que la décision 621 ne tranche pas et que cette spécification arrête sont marqués **[choix de
rédaction]** : ils se contestent comme une décision, pas comme un détail.

## 1. Le modèle en une phrase

Chaque **membre** d'un espace saisit, jour par jour, le **temps** qu'il a passé sur un **track**, un **channel** ou une
**affaire** ; chaque membre a un **coût par quart de journée**, **versionné** par date d'effet ; le temps, valorisé par la
version en vigueur le jour travaillé, donne le **coût du personnel** d'un track, d'un channel et d'une affaire.

Exemple : le mardi 13 octobre, Camille passe deux quarts sur l'affaire « Refonte Sogexia » et deux quarts sur le
channel « Prospection » (sans affaire précise). Son coût par quart est de 120 € depuis le 1er octobre : la journée
coûte 480 €, dont 240 € à l'affaire — et donc à son channel et à son track.

## 2. Les unités

| Unité | Valeur | Origine |
|---|---|---|
| journée | **7 heures** = 420 minutes | décision 621, point 10 |
| quart | **1 h 45** = 105 minutes | un quart de journée |
| saisie en heures | au **quart d'heure** (15 minutes) | [choix de rédaction] — le plus fin qui reste lisible |

**Le temps est conservé en minutes**, seule unité commune aux deux modes de saisie (décision 621, point 9). Un quart est
une saisie de 105 minutes ; une heure, de 60. Rien ne distingue en base une saisie faite en quarts d'une saisie faite en
heures : l'écran déduit le mode d'une journée de ses valeurs (§6.3).

**Plafond : 420 minutes par personne et par date**, toutes cibles confondues, quel que soit le mode (décision 621, points
4 et 10). Refusé en base. **Il se compte par espace** [précision de T1] : un refus calculé sur un autre espace
trahirait à un administrateur ce qui s'y trouve, et le produit n'a qu'un espace en pratique.

## 3. Objets

### 3.1 `couts_personnel` — le coût par quart d'un membre, versionné

| Attribut | Règle |
|---|---|
| `workspace_id` | non nul, `on delete cascade` |
| `profile_id` | non nul — la personne ; **membre de l'espace, ou y ayant déjà saisi du temps**, à la création (un administrateur du domaine, `docs/SPEC-session-sso.md` §6.1 bis, n'a pas de ligne d'appartenance) ; tenue par `NO ACTION` |
| `date_effet` | `date`, non nulle |
| `cout_quart` | `numeric(10,2)`, non nul, **≥ 0** — le coût d'un quart (105 minutes) |
| `devise` | `text`, défaut `'EUR'`, `^[A-Z]{3}$` — la convention de `budgets.currency` |
| `created_by`, `created_at` | posés par la base |

- **Unique** sur `(workspace_id, profile_id, date_effet)`.
- **Une version ne se modifie jamais** : augmenter quelqu'un, c'est créer une version (décision 621, demande).
- **Aucune rétroactivité** [choix de rédaction, conséquence du point 2] : `date_effet` est **au moins la date du jour**
  à la création — sauf pour la **première** version d'une personne, qui peut porter toute date. Ainsi une valorisation
  passée ne change jamais : « une saisie tardive pour un jour ancien garde l'ancien coût ».
- **Supprimer une version** n'est permis que tant qu'elle n'est **pas en vigueur** (`date_effet` > aujourd'hui) — la
  correction d'une augmentation programmée par erreur. Une version en vigueur reste, à jamais.

### 3.2 `saisies_temps` — le temps passé

| Attribut | Règle |
|---|---|
| `workspace_id` | non nul, `on delete cascade` |
| `profile_id` | non nul — la personne dont c'est le temps ; **`NO ACTION`** [choix de rédaction] : une personne qui a du temps saisi ne se supprime pas, on retire son appartenance (aucune clé `RESTRICT` depuis INC-268 ; la suppression d'un espace entier emporte ses saisies) |
| `jour` | `date`, non nulle — le jour travaillé |
| `minutes` | `integer`, **> 0**, **≤ 420**, **multiple de 15** |
| `track_id`, `channel_id`, `card_id` | **exactement une** des trois est renseignée (décision 621, point 1) ; la cible appartient au même espace ; `on delete cascade` |
| `created_by`, `updated_by` | la personne qui a saisi — elle-même, ou l'administrateur qui saisit pour elle (point 7) |
| `created_at`, `updated_at` | posés par la base |

- **Une seule saisie par personne, jour et cible** (trois index uniques partiels, un par sorte de cible) : la cellule
  de la matrice **est** la ligne. Mettre une cellule à zéro **supprime** la ligne ; aucune ligne à zéro n'existe.
- **Le plafond** (§2) est tenu par un déclencheur qui **sérialise** les écritures d'une même personne sur une même date
  (verrou consultatif de transaction) : deux onglets ne peuvent pas dépasser 420 minutes ensemble.
- **Une mise à jour ne change que `minutes`** : déplacer du temps d'une cible à une autre, c'est retirer et saisir.
- **Les week-ends se saisissent** comme les autres jours ; aucun calendrier de jours ouvrés n'est imposé.

## 4. La valorisation

`montant = minutes × cout_quart ÷ 105`, arrondi au centime, où `cout_quart` est celui de **la version de la personne
dont la `date_effet` est la plus récente sans dépasser `jour`** (décision 621, point 2).

- La valorisation est **calculée à la lecture**, jamais stockée : l'absence de rétroactivité (§3.1) suffit à ce qu'un
  montant passé ne bouge plus, et une saisie faite d'avance prend la bonne version.
- **Une saisie sans version applicable n'est pas valorisée** — montant `null`, jamais zéro (la doctrine de
  `card_costs.actual_cost`) ; l'écran la dit « non valorisée ».
- **Les devises ne s'additionnent pas** : les totaux se rendent par devise, comme ceux des coûts.

## 5. Autorisations — toutes appliquées en base (`CLAUDE.md` §10)

### 5.1 Lecture

| Objet | Lisible par |
|---|---|
| `saisies_temps` | **la personne elle-même**, et les **administrateurs** de l'espace |
| `couts_personnel` | **la personne elle-même** (décision 621, point 3 : « chacun voit aussi son propre coût ») et les **administrateurs** |

Un membre ne voit donc ni le temps ni le coût d'un collègue. Les montants d'un rapport découlent de ces deux lectures :
une fonction `security invoker` ne valorise que ce que l'appelant lit.

### 5.2 Écriture

| Geste | Autorisé à |
|---|---|
| Saisir, modifier, retirer **son** temps | tout **membre** de l'espace — lectrice comprise [choix de rédaction : le temps décrit la personne, non un droit d'écrire sur la cible] — sur une cible qu'il **lit** |
| Saisir, modifier, retirer le temps **d'un autre membre** | un **administrateur** (point 7), sur une cible que **ce membre** lit |
| Créer une version de coût, supprimer une version non en vigueur | un **administrateur** |

Chaque refus se prouve par une requête directe avec le jeton réel du profil (`CLAUDE.md` §10).

## 6. Les lectures et les fonctions

### 6.1 La semaine

La matrice lit, sous la RLS : les saisies de la personne sur la semaine (lundi → dimanche) et la précédente ; les tracks
et channels lisibles, non archivés ; les affaires que portent ces saisies. Une **recherche d'affaire** (titre) ajoute
une ligne.

### 6.2 `public.temps_valorise(p_debut date, p_fin date, p_profile uuid default null, p_track uuid default null, p_card uuid default null)`

`stable`, `security invoker`. Une ligne par personne × cible sur la période : `profile_id`, `track_id`, `channel_id`,
`card_id` — **chemin complet** : une saisie sur une affaire rend aussi son channel et son track —, `minutes`, `montant`
(`null` si non valorisé **ou** si l'appelant ne lit pas la version), `devise`. Filtres facultatifs : une personne, un
track (ses saisies directes, celles de ses channels et de leurs affaires), une affaire. Elle sert le rapport mensuel et
la série « Personnel ».

### 6.3 Le mode d'une journée

Une journée s'affiche **en quarts** si toutes ses saisies sont des multiples de 105 minutes, **en heures** sinon. La case
« En heures » d'une journée bascule l'affichage ; elle se coche à tout moment, et ne se **décoche** que si les valeurs
du jour sont toutes des multiples d'un quart — sinon l'écran dit pourquoi elle reste cochée. Le mode n'est pas une
donnée : c'est une lecture des valeurs, rien n'est écrit en le changeant.

## 7. Les écrans

### 7.1 « Temps » — une route de premier niveau

Entrée de barre latérale **« Temps »** (`/temps`), deux onglets : **« Saisie »** et **« Rapport mensuel »**
(`?onglet=rapport`) — le patron des écrans de coûts. Un administrateur dispose d'un sélecteur **« Saisir pour »**, sur
lui-même par défaut.

### 7.2 La matrice de la semaine

- **Lignes** : les tracks lisibles, chacun suivi de ses channels, et sous eux les affaires ajoutées ou reprises
  (point 6) ; une ligne qui portait du temps la semaine précédente est reprise d'office.
- **Colonnes** : lundi → dimanche, puis le total de la ligne. L'en-tête d'un jour porte la date et la case « En heures ».
- **Cellule** : en quarts, une valeur de 0 à 4 ; en heures, de 0 à 7 au quart d'heure. Elle **s'enregistre seule** dès
  que la valeur est arrêtée (le mode des champs du §5.7 ter de la charte).
- **Pied** : le total de chaque jour, et ce qu'il reste avant la journée pleine — « 3 quarts sur 4 », « 6 h 30 sur 7 h ».
- **Navigation** : semaine précédente, semaine suivante, « Cette semaine ». La semaine affichée vit dans l'adresse
  (`/temps?semaine=AAAA-MM-JJ`, le lundi) ; son absence vaut la semaine du jour. La personne choisie dans « Saisir
  pour » n'y vit pas : elle revient à soi au rechargement.
- **Ajouter une affaire** : une recherche par titre, qui ajoute sa ligne sous son channel.

### 7.3 Le rapport mensuel

Un sélecteur de mois (`?mois=AAAA-MM`, le mois du jour par défaut). Pour un membre : **son** mois — une ligne par cible (track › channel › affaire), le temps en jours
et en heures, le montant par devise, et les totaux. Pour un administrateur : en plus, une personne ou **« Toute
l'équipe »**, avec un tableau par personne. Une saisie non valorisée est comptée en temps et dite « non valorisée ».

### 7.4 Réglages ▸ « Coût du personnel » — administrateurs

Adresse : `/reglages/cout-personnel`, atteinte depuis l'index des réglages. Les personnes listées sont les membres de
l'espace et celles qui y ont déjà saisi du temps (un administrateur du domaine, §3.1).

La liste des membres, avec le coût en vigueur et la prochaine version programmée ; l'ajout d'une version (coût par
quart, devise, date d'effet — aujourd'hui au plus tôt, toute date pour une première version) ; l'historique des versions
de chacun ; la suppression d'une version programmée.

### 7.4 bis Calculer le coût par quart depuis le coût mensuel — `CRM-107` (décision 631)

Le formulaire « Nouvelle version » (§7.4) porte un calculateur, **replié** par défaut [choix de rédaction] : « Calculer
depuis le coût mensuel ». Les points 1 à 3 sont les arbitrages du responsable (2026-10-23).

1. **Les champs** : salaire brut mensuel (montant), charges sociales patronales (**% du brut**), frais de gestion
   (montant par mois), avantages (montant par mois), **jours travaillés par an** (entier, **218** par défaut). Les
   montants sont dans la devise de la version. Un champ vide vaut zéro, sauf le salaire, requis, et les jours, qui
   reprennent 218.
2. **Le calcul** :
   `coût mensuel complet = brut × (1 + charges ÷ 100) + frais + avantages` ;
   `coût par quart = coût mensuel complet × 12 ÷ (jours × 4)`, arrondi au centime le plus proche.
   Exemple : 3 000 de brut, 42 % de charges, 150 de frais, 100 d'avantages, 218 jours → 4 510 par mois, 62,06 par quart.
3. **Calculateur seulement** : rien de ce qu'il reçoit n'est enregistré. Seul le coût par quart l'est, par le geste
   « Enregistrer la version » d'aujourd'hui. Aucune migration.
4. Le résultat — coût mensuel complet et coût par quart — se lit **en direct** ; il ne passe dans « Coût par quart » que
   par le geste **« Utiliser ce coût »**, qui ne crée rien [choix de rédaction].
5. **Bornes** [choix de rédaction] : montants ≥ 0 ; charges de 0 à 100 ; jours entiers de 1 à 366. Hors bornes, le
   résultat ne s'affiche pas et le champ fautif dit pourquoi. La virgule et le point valent séparateur décimal.
6. **Rien ne persiste côté client** (`CLAUDE.md` §11) : refermer le formulaire oublie les valeurs.
7. **Connecteur MCP** (réponse du responsable, 2026-10-23, `CLAUDE.md` « Spécificités du projet ») : **non** — une aide
   de calcul d'interface, qui n'enregistre rien, n'a pas d'outil.

### 7.5 La série « Personnel » — à côté des coûts existants (point 8)

Sur l'**écran de coûts d'un track** : un bloc « Coût du personnel » — temps et montant du track, par channel, sur la
période choisie (mois par défaut). Dans la **fiche d'une affaire** : un bloc « Temps passé » — temps et montant. Les deux
ne se mêlent ni aux budgets, ni aux lignes de coût, ni à l'histogramme. **Leur portée est écrite** : un membre n'y lit
que **son** temps (§5.1), et le bloc le dit — « votre temps » ; un administrateur lit celui de toute l'équipe.
Depuis `CRM-106`, le bloc « Temps passé » porte aussi la **saisie** de son temps sur l'affaire (§7.6).

### 7.6 Saisir son temps depuis la fiche d'une affaire — `CRM-106` (décision 630)

Le bloc « Temps passé » de la fiche (§7.5) porte, sous son résumé, la **bande de la semaine** : la ligne de l'affaire
extraite de la matrice (§7.2). Les points 1 à 3 sont les arbitrages du responsable (2026-10-23) ; les autres sont des
**[choix de rédaction]**.

1. **Forme.** Sept cellules, du lundi au dimanche, puis le total de la semaine de l'affaire. Chaque cellule est **celle
   de la matrice** : en quarts de 0 à 4, en heures de 0 à 7 au quart d'heure, vide vaut zéro, elle s'enregistre seule,
   `Entrée` l'enregistre, `Échap` rétablit la valeur, les flèches gauche et droite vont d'un jour à l'autre.
2. **Une valeur remplace** celle que la personne a déjà saisie ce jour-là sur l'affaire ; zéro retire la ligne (§3.2).
   Rien ne s'additionne.
3. **Son temps seulement.** La bande saisit le temps de la personne connectée, quel que soit son rôle — lectrice
   comprise (§5.2), administrateur compris. Aucun « Saisir pour » : il reste sur l'écran « Temps » (§7.1).
4. **Le jour se lit sur toutes ses saisies.** L'en-tête d'un jour porte la case « En heures » du §6.3, et le mode du jour
   se déduit de **toutes** les saisies de la personne ce jour-là, toutes cibles confondues — le même jour se lit de la
   même façon dans la fiche et dans la matrice. Le pied de chaque jour dit le total de la journée **toutes cibles
   confondues** (« 3 quarts sur 4 ») : c'est ce que compte le plafond (§2). Une valeur qui dépasserait la journée est
   annoncée avant l'envoi ; la base reste seule juge.
5. **La lecture.** Les saisies de la personne sur la semaine affichée, toutes cibles (`saisies_temps`, filtrées sur
   l'espace et la personne) — aucune lecture de l'arborescence. Pour un administrateur, la RLS rendrait le temps de
   chacun : le filtre sur la personne est donc écrit dans la requête.
6. **La navigation.** « Semaine précédente », « Semaine suivante », « Cette semaine ». La semaine **ne vit pas dans
   l'adresse** : l'adresse d'une fiche désigne l'affaire, et un lien partagé n'emporte pas de semaine. Un lien **« Ouvrir
   dans Temps »** mène à la matrice de la même semaine (`/temps?semaine=AAAA-MM-JJ`).
7. **La portée est écrite.** La bande dit « Votre semaine » : pour un administrateur, le résumé au-dessus compte toute
   l'équipe, la bande son seul temps.
8. **Le résumé se relit** après chaque enregistrement accepté — le temps depuis le premier jour et son coût.
9. **Aucun motif de lecture seule** : le motif de la fiche (`CRM-093`) dit le droit d'écrire l'affaire ; le temps décrit
   la personne. Un refus de la base (la personne ne lit plus l'affaire, plafond, conflit) se dit sur la cellule, avec
   les messages de la matrice.
10. **Aucune règle nouvelle en base** : `app.saisie_temps_permise` exige déjà que la personne lise l'affaire, le plafond
    compte toutes les cibles, l'unicité tient une ligne par personne, jour et affaire (migration `0087`).
11. **Connecteur MCP** (réponse du responsable, 2026-10-23, `CLAUDE.md` « Spécificités du projet ») : **déjà couvert**
    par `CRM-104` — famille `temps`, actions `ajouter` et `modifier` (`docs/SPEC-mcp.md` §6.1) ; `crm_time_entry_add` et
    `crm_time_entry_update` figurent à son catalogue cible (§9.2), **pas encore codé** : la tranche `temps` de `CRM-104`
    devra accepter une affaire pour cible, comme la base le permet déjà. Aucun outil de plus au catalogue.

## 8. Jeu de démonstration

Des versions de coût pour les trois comptes du seed — dont une augmentation programmée dans le futur et une personne
sans version (saisies « non valorisées ») —, et des saisies sur les quatre dernières semaines, en quarts et une journée
en heures (cinq cibles dans la journée), créées par la vraie API sous le jeton de chaque profil. Section du seed et
contrat : `docs/SPEC-seed.md` (à écrire avec la tranche qui les pose).

## 9. Ce qui n'est pas au périmètre

- aucune validation ni verrouillage de mois, aucun circuit d'approbation ;
- aucun calendrier de jours fériés, de congés ou d'absences ;
- aucune facturation au temps passé, aucun taux de vente ;
- aucune conversion de devise ;
- aucun export — `CRM-071` porte l'import/export ;
- aucun chronomètre ni saisie automatique.

## 10. Découpage

| Tranche | Contenu |
|---|---|
| **T1** | Migration `0087` : les deux tables, la RLS, le plafond, la non-rétroactivité, `temps_valorise` ; pgTAP |
| **T2** | Écran « Temps », onglet « Saisie » : matrice, case « En heures », navigation, ajout d'une affaire, « Saisir pour » ; unitaires |
| **T3** | Réglages « Coût du personnel », rapport mensuel, série « Personnel » des coûts du track et de la fiche ; unitaires |
| **T4** | API (refus avec jetons réels), E2E souris et clavier, captures aux quatre paliers, seed, manuel, campagnes |
| **T5** | Production : migration en fenêtre avec instantané, constat |

`CRM-106` (§7.6) se découpe à part : T1 la spécification ; T2 la bande et ses unitaires ; T3 l'API, l'E2E, les captures,
le manuel, les campagnes ; T4 la livraison de la webapp.

## 11. Preuves

- **pgTAP** : unités et plafond (420, multiple de 15, cible unique, sérialisation) ; versions immuables, non
  rétroactives sauf la première, supprimables seulement avant leur effet ; valorisation par date d'effet, `null` sans
  version, devises séparées ; RLS — la personne, l'administrateur, le collègue refusé, la lectrice qui saisit le sien ;
  l'administrateur qui saisit pour autrui sur une cible que l'autre lit, et non sur une autre.
- **API** : chaque refus avec le jeton réel ; le plafond par deux écritures concurrentes.
- **Unitaires** : le mode d'une journée, les conversions minutes ↔ quarts ↔ heures, la matrice, le rapport.
- **E2E** : une semaine saisie à la souris et au clavier, une journée en heures, le rapport mensuel, une version de coût
  programmée, la série « Personnel » ; refus d'un collègue ; quatre paliers ; captures observées.

### 11 bis. Preuves de `CRM-106` (§7.6)

- **Unitaires** : la bande lit la semaine de la seule personne connectée ; le mode d'un jour et le total du pied
  comptent les saisies des autres cibles ; une valeur remplace, zéro retire ; le plafond annoncé sans envoi ; une seule
  écriture à la fois (`Entrée` puis sortie du champ) ; le résumé relu après un enregistrement ; la navigation et le lien
  « Ouvrir dans Temps » ; aucun motif de lecture seule n'éteint la bande.
- **API** : la saisie sur une affaire avec le jeton réel d'un membre qui la lit ; le refus pour une affaire qu'il ne lit
  pas.
- **E2E** : une semaine saisie à la souris et au clavier depuis la fiche, relue dans l'écran « Temps » et en base ; une
  journée en heures ; un remplacement et un retrait ; le plafond atteint par une autre cible ; la lectrice qui saisit
  le sien ; l'administrateur dont la bande ne saisit que son temps ; quatre paliers sans défilement de page ; captures
  observées.
