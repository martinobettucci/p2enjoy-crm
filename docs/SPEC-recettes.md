# Recettes d'une affaire et rapport de rentabilité — `CRM-108`

*Écrite le 2026-10-23, avant tout code, sur les arbitrages du responsable consignés en décision 632
(`docs/JOURNAL.md`). Unité de backlog : `CRM-108` (`docs/BACKLOG.md`). Règles visuelles : `docs/DESIGN_SYSTEM.md`
§5.60. Schéma : `docs/SCHEMA.md`, « Migration `0095` ». Connecteur : `docs/SPEC-mcp.md` §6.1 et §9.2.*

Les choix que la décision 632 ne tranche pas et que cette spécification arrête sont marqués **[choix de rédaction]** :
ils se contestent comme une décision, pas comme un détail.

## 1. Le modèle en une phrase

Une **affaire** porte des **lignes de recette** — autant qu'il en faut —, chacune avec une **recette prévue** et
**plusieurs recettes réelles** datées, jusqu'à ce qu'on la déclare **soldée** ; la **rentabilité** d'une affaire est ce
qu'elle a rapporté moins ce qu'elle a coûté : **recettes − lignes de coût − coût du personnel**.

C'est le pendant exact des lignes de coût (`docs/SPEC-costs.md` §2.3 et §2.3 bis), sans budget : une recette n'entre
dans aucune enveloppe.

Exemple : l'affaire « Refonte intranet Ville de Lyon » porte `Lot 1 — conception — prévu 20 000, encaissé 4 000` et
`Lot 2 — réalisation — prévu 52 000, rien encaissé`. Ses coûts sont `Publicité — estimé 100, réel inconnu` et
`Production — estimé 350, réel 375`, et Driss y a passé du temps valorisé 4 800 €. Sa marge réelle à date vaut
`4 000 − 375 − 4 800 = −1 175 €`, **partielle** : une ligne de coût n'a pas son réel.

## 2. Objets

### 2.1 `card_revenues` — les lignes de recette d'une affaire

| Attribut | Règle |
|---|---|
| `card_id` | non nul, `on delete cascade` |
| `label` | non vide après suppression des blancs — « Acompte », « Solde », « Lot 1 » |
| `estimated_amount` | `numeric(14,2)`, **non nul**, sans contrainte de signe — un avoir est une recette négative légitime |
| `actual_amount` | `numeric(14,2)`, **dérivé** (§2.3), jamais écrit par le client |
| `settled_at`, `settled_by` | la ligne soldée (§2.3), posés par la base |
| `position` | ordre d'affichage dans la fiche, attribué par déclencheur si omis [choix de rédaction : les lignes d'une affaire se lisent dans l'ordre du contrat, pas dans celui de leur saisie] |
| `created_by`, `created_at`, `updated_at` | posés par la base |

**Aucune unicité sur `(card_id, label)`** : deux « Acompte » peuvent correspondre à deux factures distinctes, comme deux
« Publicité » pour les coûts (`docs/SPEC-costs.md` §2.3).

**Le montant de l'affaire (`cards.amount`) n'est pas une ligne de recette**, et il ne le devient jamais par défaut
[choix de rédaction]. Il reste le montant du portefeuille que le pilotage pondère (`docs/SPEC-analytique.md` §7.2). Une
affaire sans ligne de recette n'a **aucune** recette prévue : la déduire du montant serait la valeur par défaut
trompeuse que `CLAUDE.md` §18 interdit. Le rapport montre le montant à côté, pour comparaison (§6.3).

### 2.2 `card_revenue_actuals` — les recettes réelles d'une ligne

| Attribut | Règle |
|---|---|
| `card_revenue_id` | non nul, `on delete cascade` |
| `amount` | `numeric(14,2)`, **non nul**, sans contrainte de signe ; `0` admis |
| `received_on` | `date`, non nulle, **la date du jour par défaut** — la date de la facture ou de l'encaissement, non celle de la saisie |
| `label` | facultatif ; s'il est renseigné, non vide après suppression des blancs — « Facture n° 2026-041 » |
| `created_by`, `created_at`, `updated_at` | posés par la base |

Un réel se modifie (montant, date, libellé) et se retire ; il ne change jamais de ligne — la règle de
`card_cost_actuals` (`docs/SPEC-costs.md` §2.3 bis).

**Ce qu'est un « réel » est laissé à l'usage de l'espace** [choix de rédaction] : facture émise ou encaissement reçu.
Le produit ne distingue pas les deux ; le libellé le dit si on le souhaite. Deux notions demanderaient deux colonnes et un
état de plus, que personne n'a demandés.

### 2.3 Le réel dérivé et la ligne soldée

La règle de `card_costs.actual_cost` (`docs/SPEC-costs.md` §2.3 bis), reprise mot pour mot :

| État de la ligne | `actual_amount` |
|---|---|
| au moins un réel | **la somme des réels** — soldée ou non |
| soldée, aucun réel | **`0`** — « finalement rien encaissé » |
| ouverte, aucun réel | **nul** — la recette réelle est inconnue |

- La colonne est **tenue par la base** (déclencheurs sur les réels et sur `settled_at`) ; un `PATCH` qui la change, ou une
  insertion qui en fournit une non nulle, est refusé (`23514` « reel derive »).
- **Une ligne soldée est figée** : aucun réel ne s'y ajoute, ne s'y modifie ni ne s'en retire — refus en base. La rouvrir
  est un geste explicite : décocher « Soldé ».
- `settled_at` est posé par la base à l'instant du geste, `settled_by` à l'auteur du jeton ; le client n'envoie qu'un
  drapeau.

**Nul n'est pas zéro.** Une recette réelle inconnue ne compte pas comme une recette nulle, et chaque écran distingue les
deux (§4.3).

### 2.4 La devise d'une ligne est celle de son affaire

Une ligne de recette ne porte pas de colonne `currency` : sa devise est `cards.currency`. **Changer la devise d'une
affaire qui porte au moins une ligne de recette est refusé** (`23514`, « devise verrouillée par les recettes »)
[choix de rédaction] — sinon 28 000 CHF deviendraient 28 000 EUR sans que personne ne l'ait décidé. Pour changer de
devise, on retire d'abord les lignes, ou on les recrée sur une autre affaire. Le montant de l'affaire, lui, reste libre.

## 3. Autorisations — toutes appliquées en base (`CLAUDE.md` §10)

| Geste | Autorisé à |
|---|---|
| Lire les lignes de recette et leurs réels | quiconque lit l'affaire — `app.can_read_card` |
| Créer, modifier, supprimer une ligne ; ajouter, modifier, retirer un réel ; solder, rouvrir | quiconque écrit l'affaire — `app.can_write_card` |
| Lire la rentabilité (`public.rentabilite_affaires`, §5) | **les administrateurs de l'espace** de l'affaire — `app.is_workspace_admin` |

**Pourquoi la rentabilité est réservée aux administrateurs (décision 632, arbitrage 3).** La marge soustrait le coût du
personnel ; or un membre ne lit que **son** temps et **son** coût (`docs/SPEC-temps.md` §5.1). Calculée pour lui, la marge
serait surévaluée de tout le temps de ses collègues — un chiffre faux qui aurait l'air juste. L'administrateur est le
seul à lire le coût de toute l'équipe : la marge qu'il lit est complète.

**Un membre lit et saisit pourtant les recettes et les coûts** dans la fiche : ce sont des données de l'affaire, sous la
règle de l'affaire. Ce qui lui est fermé, c'est le **calcul** qui les rapproche du coût de l'équipe.

**Un réel de recette se lit par sa ligne**, comme un réel de coût : deux fonctions `security definer`,
`app.card_revenue_lisible(ligne)` et `app.card_revenue_ecrivable(ligne)`, lisent la ligne hors RLS pour qu'aucune
politique ne relise une table sous politique (`docs/SPEC-permissions-rls.md` §3.5) — la forme de
`app.card_cost_lisible` (migration 0088).

## 4. La rentabilité d'une affaire — définitions

### 4.1 Les grandeurs

Pour une affaire et **une devise** :

| Grandeur | Définition |
|---|---|
| recettes prévues | somme des `estimated_amount` de ses lignes de recette |
| recettes réelles | somme des `actual_amount` **connus** |
| coûts prévus | somme des `estimated_cost` de ses lignes de coût (devise du budget de chaque ligne) |
| coûts réels | somme des `actual_cost` **connus** |
| personnel | coût valorisé du temps passé sur l'affaire (`public.temps_valorise`, `docs/SPEC-temps.md` §4), dans la devise de la version de coût |
| **marge réelle** | recettes réelles − coûts réels − personnel |
| **marge prévue** | recettes prévues − coûts prévus − personnel [choix de rédaction, §4.2] |
| **taux de marge** | marge réelle ÷ recettes réelles, en pourcentage à une décimale ; **vide** si les recettes réelles sont nulles, inconnues ou égales à zéro |

### 4.2 La marge prévue soustrait le personnel déjà valorisé [choix de rédaction]

Le temps passé n'a **pas de prévision** dans le produit (`docs/SPEC-temps.md` §9) : seul le temps déjà passé est connu.
Trois issues existaient — exclure le personnel de la marge prévue, le soustraire tel qu'il est à date, inventer une
prévision. La troisième est exclue (une prévision que personne n'a saisie). **La deuxième est retenue** : une marge prévue
qui ignorerait le personnel comparerait deux grandeurs de natures différentes, et la marge prévue d'une affaire déjà
très consommatrice de temps resterait flatteuse jusqu'à la fin. L'écran le dit sous le tableau : « La marge prévue
soustrait le temps déjà passé : le produit ne prévoit pas le temps. »

### 4.3 Ce que le chiffre ne dit pas : la marge **partielle**

La marge réelle d'une affaire est dite **partielle** dès que l'une de ces trois conditions est vraie :

1. une ligne de recette est **ouverte sans aucun réel** (recette réelle inconnue) ;
2. une ligne de coût est **ouverte sans aucun réel** (coût réel inconnu) ;
3. du temps passé sur l'affaire est **non valorisé** (personne sans version de coût, `docs/SPEC-temps.md` §4).

Une marge partielle n'est **pas** masquée : elle est rendue, marquée « partielle », et sa raison est dans le nom
accessible de la marque (§6.3). Sans cette marque, un réel bas se lirait comme une perte, ou une marge haute comme un
succès, alors qu'il ne s'agit que de saisies en retard — la principale façon dont un tel écran ment
(`docs/SPEC-costs.md` §4.4).

### 4.4 Les devises ne s'additionnent jamais

Les montants se rendent **par devise**. Une affaire dont recettes, coûts et personnel vivent dans **une seule** devise
— le cas attendu — rend une ligne. Une affaire qui en mêle plusieurs rend **ses montants par devise**, et sa marge est
« **non calculable — plusieurs devises** » : une marge calculée devise par devise serait fausse (une affaire facturée
en CHF dont les coûts sont en EUR paraîtrait rentable en CHF et déficitaire en EUR). Aucune conversion de devise
(§9).

### 4.5 La période

Le rapport porte sur une **période** facultative, du … au … (`?du=AAAA-MM-JJ&au=AAAA-MM-JJ`) ; son absence vaut
« depuis toujours ».

- **Elle filtre les réels par leur date** : `received_on` d'une recette, `spent_on` d'un coût, `jour` du temps passé.
- **Elle ne filtre pas les prévus**, qui n'ont pas de date : les prévus portent toujours sur toute l'affaire, et l'écran
  l'écrit dès qu'une période est choisie [choix de rédaction].
- **Une ligne soldée sans réel** (réel `0`) n'a aucune date : elle compte pour `0` quelle que soit la période.
- Une période choisie rend la marge réelle **de la période** : ce qui a été encaissé, dépensé et passé entre ces dates.

### 4.6 Quelles affaires paraissent

Paraissent les affaires que l'administrateur lit, **non mises à la corbeille**, qui portent **au moins** une ligne de
recette, une ligne de coût ou du temps passé [choix de rédaction : une affaire sans rien de tout cela n'a pas de
rentabilité à montrer, et la lister ajouterait des lignes vides par centaines].

- **Les affaires archivées paraissent** [choix de rédaction] : une affaire livrée puis archivée est précisément celle dont
  on veut connaître la marge. L'écart avec l'entonnoir (`docs/SPEC-analytique.md` §4), qui les exclut, est voulu :
  l'entonnoir mesure un portefeuille actif, ce rapport mesure ce qui a été fait.
- **Le filtre d'état** (`?etat=`) choisit parmi les affaires gagnées (`won`), en cours (`open`), perdues (`lost`) ou
  toutes ; **toutes par défaut** [choix de rédaction : un filtre qui cache par défaut ce qui coûte sans rapporter — une
  affaire perdue qui a consommé du temps — cacherait l'information la plus utile]. L'état est le `kind` du nœud du
  catalogue de l'étape courante, comme dans l'entonnoir.

## 5. `public.rentabilite_affaires(p_debut date default null, p_fin date default null, p_card uuid default null)`

`stable`, **`security invoker`**, `search_path` vide, `EXECUTE` à `authenticated` et `service_role`, **révoqué nommément à
`public` et `anon`** (la forme de `public.entonnoir_conversion`, `docs/SPEC-analytique.md` §5.3 et §5.4).

**Ce qu'elle rend** : une ligne par **affaire × devise**, pour les affaires du §4.6 :

| Colonne | Contenu |
|---|---|
| `workspace_id`, `track_id`, `channel_id`, `card_id` | le chemin de l'affaire |
| `node_kind` | `open`, `won` ou `lost` |
| `archivee` | l'affaire est archivée |
| `currency` | la devise de la ligne |
| `recettes_prevues`, `recettes_reelles` | §4.1 ; `recettes_reelles` nul si aucune recette réelle n'est connue |
| `lignes_recette`, `lignes_recette_sans_reel` | nombre de lignes, et de lignes ouvertes sans réel |
| `couts_prevus`, `couts_reels` | §4.1, mêmes règles |
| `lignes_cout`, `lignes_cout_sans_reel` | idem pour les coûts |
| `personnel` | §4.1, nul si rien n'est valorisé dans cette devise |
| `minutes`, `minutes_non_valorisees` | le temps passé et sa part non valorisée ; le temps **non valorisé** (sans version de coût, donc sans devise) se range sous la **devise de l'affaire**, sans montant — *précision de T2* : une ligne de devise nulle laissait l'écran sans tableau où ranger une affaire qui n'a que cela |

- **Sommes arrondies une seule fois**, au centime, comme l'entonnoir.
- **La période** (§4.5) filtre les réels et le temps ; `p_debut` et `p_fin` nuls valent « depuis toujours ».
- **`p_card`** restreint à une affaire — c'est le bloc « Rentabilité » de la fiche (§6.2).
- **La garde.** La fonction ne rend que les affaires d'un espace dont l'appelant est **administrateur**
  (`app.is_workspace_admin`). Un appelant qui n'est administrateur d'**aucun** espace reçoit **`42501`**
  `rentabilite_reservee` ; avec `p_card`, une affaire qu'il lit mais dont il n'administre pas l'espace rend aussi
  `42501`, et une affaire qu'il ne lit pas rend **zéro ligne** (rien n'est révélé de son existence).
- **`security invoker` est le point même de la fonction** : elle somme ce que la RLS rend à l'appelant — `card_costs`
  sous sa double condition, `saisies_temps` et `couts_personnel` sous la règle du temps —, jamais davantage. Un
  administrateur lit tout de son espace, et c'est pour cela que la garde suffit.
- **La marge, le taux et le caractère partiel ne sont pas calculés en base** [choix de rédaction] : la fonction rend
  des sommes et des comptes, la webapp et le connecteur appliquent §4 par une fonction pure, prouvée par les mêmes cas
  des deux côtés (§11). Calculer la marge en SQL figerait dans la base une règle de présentation — « non calculable »,
  « partielle » — qui se lit mieux là où elle se montre.

## 6. Écrans

### 6.0 Adresses

| Écran | Adresse | Figure dans `ROUTES` |
|---|---|---|
| Rentabilité — vue d'ensemble | `/rentabilite` | **oui** |
| Rentabilité — recettes à saisir | `/rentabilite?onglet=saisir` | (même entrée) |

Une route de **premier niveau** (décision 632, arbitrage 4), entrée de barre latérale **« Rentabilité »** placée
**après « Pilotage »** et avant « Temps » : coûts, pilotage puis rentabilité se lisent dans l'ordre — ce que le
portefeuille a coûté, ce qu'il peut rapporter, ce qu'il a rapporté. L'onglet vit dans la chaîne de requête, comme les
écrans de coûts (`docs/SPEC-costs.md` §4.0) ; les filtres aussi (`du`, `au`, `etat`, `vue`).

### 6.1 Le bloc « Recettes » de la fiche d'une affaire

Dans la colonne gauche de la fiche, **avant le bloc « Coûts »** [choix de rédaction : on lit ce que l'affaire rapporte
avant ce qu'elle coûte, l'ordre du calcul].

- Une table des lignes : nature, prévu, réel (« Déjà saisi »), état (« Soldé »), actions — le patron de
  `BlocCoutsCard` (`docs/SPEC-costs.md` §4.6 et §2.3 bis), sans colonne de budget ni d'occurrence.
- Ajouter une ligne : nature et prévu. Modifier : nature et prévu. Supprimer : confirmation dans le flux.
- Chaque ligne déplie ses réels **sous la table** : date, libellé ou « Sans libellé », montant ; ajout, modification,
  retrait, et la case « Soldé ». Une ligne soldée a ses gestes désactivés et lisibles, avec leur motif.
- Le pied : total prévu et total réel, dans la devise de l'affaire, et la mention « n lignes sans recette réelle
  saisie, pour m de prévu » si des réels manquent.
- Les gestes suivent le droit d'écrire l'affaire, rendu par la base (`CRM-093`, `docs/DESIGN_SYSTEM.md` §5.59) : désactivés
  avec le motif de la fiche quand la base le refuse, jamais masqués.

### 6.2 Le bloc « Rentabilité » de la fiche

Après le bloc « Temps passé ». Il lit `rentabilite_affaires(p_card => …)`, sans période :

- recettes, coûts, personnel et marge, en **prévu** et en **réel**, dans une liste de définitions (`dl`) ;
- le taux de marge réelle ; la marque « partielle » et sa raison (§4.3) ;
- « non calculable — plusieurs devises » et les montants par devise quand c'est le cas (§4.4) ;
- un lien « Ouvrir dans Rentabilité » vers l'écran, filtré sur rien de plus.

**Précision de T3 (2026-10-23), défaut trouvé par les campagnes E2E d'autres unités** : un refus `42501` ATTENDU laisse
une erreur réseau 403 dans la console de chaque fiche d'un non-administrateur, que les fixtures E2E tiennent pour un
défaut. Le bloc lit donc D'ABORD la capacité d'administrer l'espace de l'affaire (`workspaces.administration_permise`,
`CRM-093`, `docs/SPEC-droits-interface.md` §2.2) et n'appelle la fonction que si la base la permet ; l'écran fait de même
avec la capacité que la coquille a lue. La garde `42501` reste en base, seule juge ; la capacité n'évite qu'un appel voué
au refus. L'écran attend en outre que l'espace soit connu : avant, la capacité est « inconnue » sans avoir été lue, et
l'appel partait au chargement direct de `/rentabilite` (trouvé par l'E2E). Mesuré par requête directe : jeton de l'administratrice `200`, du business developer `403`.

**Pour qui la base répond `42501`, le bloc n'est pas rendu** [choix de rédaction]. Ce n'est pas un rôle deviné par
l'écran : c'est le refus de la base, lu à la première requête. Rendre un bloc qui dirait à chaque membre, sur chaque
fiche, « réservé aux administrateurs » serait du bruit — la fiche n'est pas un écran d'administration (§5.59 :
le motif de bloc vaut pour ce qui se **consulte**). Toute autre erreur rend l'état d'erreur du bloc avec sa reprise.

### 6.3 « Rentabilité » — l'onglet « Vue d'ensemble »

**Révisé par `CRM-111` T2.4.1** (docs/SPEC-rattachements.md §6) : la seconde lecture nomme les channels et tracks de
**tous** les rattachements de chaque affaire ; le montant comparé est celui du plus ancien, la forme d'avant. La ligne par
rattachement vient avec le contrat de `rentabilite_affaires` (une tranche ultérieure de `CRM-111`).

**Pour un administrateur** :

- **Les filtres**, en tête : la période (deux champs `date`, « Du » et « Au », facultatifs), l'état (« Toutes »,
  « Gagnées », « En cours », « Perdues ») et la vue (**« Réel »** / **« Prévu »**, deux liens : deux vues nommées, pas une
  option — `docs/DESIGN_SYSTEM.md` §5.36).
- **Un tableau par devise** — titre de devise rendu seulement s'il y en a plusieurs, et la devise nommée dans les
  en-têtes de montant dans tous les cas (`docs/DESIGN_SYSTEM.md` §5.48).
- **Les lignes** : track, puis ses channels, puis leurs affaires, en arborescence (les retraits du rapport mensuel,
  `docs/DESIGN_SYSTEM.md` §5.54) ; chaque track et chaque channel porte son **sous-total**, et le tableau son **total**.
- **Les colonnes** de la vue « Réel » : Affaire (lien vers la fiche), État (mot : « Gagnée », « En cours », « Perdue »,
  avec « Archivée » le cas échéant), Montant de l'affaire, Recettes, Coûts, Personnel, Marge, Taux. La vue « Prévu »
  remplace Recettes, Coûts et Marge par leurs prévus et retire le Taux.
- **Une marge négative** est écrite avec son signe et porte la teinte de danger sur la valeur seule (§5.60) ; une marge
  partielle porte la marque « partielle ».
- **Les mentions** sous les tableaux : lignes de recette sans réel, lignes de coût sans réel, temps non valorisé
  (comptes non nuls seulement) ; la phrase de la marge prévue (§4.2) ; avec une période, « Les prévus portent sur toute
  l'affaire » ; la **portée** : « Toutes les affaires de l'espace que vous administrez, corbeille exclue ».
- **Une affaire mêlant plusieurs devises** paraît dans le tableau de chacune, sa marge dite « non calculable — plusieurs
  devises » dans chacun.

**Pour un non-administrateur**, la base répond `42501` : l'onglet rend l'état « Réservé aux administrateurs » du §5.8, qui
dit pourquoi — la marge soustrait le coût de toute l'équipe — et renvoie à l'onglet « À saisir », qu'il peut employer.

### 6.4 « Rentabilité » — l'onglet « À saisir »

La saisie en série des recettes réelles, sur le patron exact de l'onglet « À saisir » des coûts (`docs/SPEC-costs.md`
§4.8, §4.8.1, §2.3 bis) :

- **Ce qu'il liste** : toutes les lignes de recette **non soldées** que l'appelant lit, de la plus ancienne à la plus
  récente (`created_at`). **Ouvert à tout membre** : un commercial saisit les encaissements de ses affaires.
- **Colonnes** : Ancienneté, Affaire (lien), Nature, Prévu, Déjà saisi, Une recette de plus (le champ), Soldé.
  L'ancienneté est neutre : aucun seuil n'existe pour une recette, et **aucun n'est inventé** (`docs/SPEC-costs.md`
  §2.1 bis) [choix de rédaction].
- **Le droit d'écrire chaque ligne est rendu par la base**, colonne calculée `public.recette_saisissable(card_revenues)`
  ⇒ `app.can_write_card(card_id)` — la forme de `reel_saisissable` ; une ligne non écrivable est rendue en lecture seule
  avec son motif, jamais masquée.
- **La saisie** : `Entrée` ajoute le réel daté du jour et mène au champ de la ligne suivante ; date et libellé à la
  demande ; la ligne enregistrée reste en place jusqu'au prochain chargement ; zéro est une valeur, vide n'en est pas une.
- **Le badge** de l'onglet compte exactement les lignes que le tableau liste, et son nom accessible le dit : « n ligne(s)
  en attente de leur recette réelle, toutes devises confondues ».
- **Vide** : « Toutes les recettes réelles sont saisies. »

### 6.5 États

| État | Rendu |
|---|---|
| Chargement | squelettes à la forme du tableau (§5.8 du design system) |
| Erreur de lecture | message et « Réessayer » |
| Non-administrateur, vue d'ensemble | « Réservé aux administrateurs », et le lien vers « À saisir » |
| Aucune affaire à montrer (administrateur) | « Aucune affaire ne porte encore de recette, de coût ni de temps. » — et, avec une période ou un état, « … pour ces filtres » ; les filtres restent rendus (§5.48 bis) |
| Fiche : affaire sans ligne de recette | « Aucune recette prévue », et l'ajout d'une ligne |
| Fiche : lecture seule | gestes désactivés lisibles et motif de la fiche (§5.59) |

## 7. Connecteur MCP

**Oui** — réponse du responsable du 2026-10-23 à la question de `CLAUDE.md` (« Spécificités du projet »), consignée en
décision 632, arbitrages 5 et 6.

- **Une huitième famille, `recettes`** : « lignes de recette d'une affaire et leurs réels ; rapport de rentabilité,
  réservé aux administrateurs par la base ». Elle se règle **à part** des coûts (`budgets`). La liste des familles étant
  fermée en base, la migration `0095` l'ajoute au `check` de `mcp_droits`, à `public.mcp_autorise` et aux deux
  fonctions d'administration de `0094` ; le moteur du connecteur (`FAMILLES`) et la matrice de l'onglet « Connecteur
  MCP » la reçoivent dans le même changement.
- **Les outils sont construits dans cette unité** (arbitrage 6), sur le socle de `CRM-102` — pas renvoyés à `CRM-104`.

| Action | Outils |
|---|---|
| `consulter` | `crm_card_revenue_list` (lignes d'une affaire et leurs réels) ; `crm_revenues_to_enter` (« à saisir », paginé) ; `crm_profitability_report` (rapport, période et état facultatifs) |
| `ajouter` | `crm_card_revenue_add` (une ligne : nature, prévu) ; `crm_card_revenue_actual_add` (un réel : montant, date, libellé) |
| `modifier` | `crm_card_revenue_update` (nature, prévu) ; `crm_card_revenue_actual_update` (montant, date, libellé) ; `crm_card_revenue_settle` (soldé ou rouvert) |
| `supprimer` | **aucun** : une ligne et un réel ne se mettent ni à la corbeille ni en archive, ils se détruisent — ils se corrigent donc par `modifier` (`docs/SPEC-mcp.md` §6.1) |

- **Ancres** : `card:card_id` pour une affaire ; deux genres nouveaux, **`revenue`** (une ligne de recette, son espace lu
  par `card_revenues → cards`) et **`revenue_actual`** (un réel, par `card_revenue_actuals → card_revenues → cards`) ;
  `workspace:workspace` pour « à saisir » et le rapport.
- **`crm_profitability_report`** porte en cases `aussi` **`budgets:consulter`** et **`temps:consulter`** : il révèle des
  coûts et le coût du personnel, que ces deux familles gardent.
- **Aucun chemin parallèle** : les mêmes tables et la même fonction que la webapp ; la marge appliquée par une fonction
  Python qui suit §4, prouvée par les mêmes cas que la fonction de la webapp.
- **Refus traduits** : `42501` de `rentabilite_reservee` dit au modèle que le rapport est réservé aux administrateurs de
  l'espace ; `ligne soldee`, `reel derive` et `devise verrouillée` reçoivent chacun leur phrase (`docs/SPEC-mcp.md` §9.3).

## 8. Jeu de démonstration

Section du seed et contrat : `docs/SPEC-seed.md` §21. Les lignes et leurs réels sont créés par la vraie API, sous le
jeton d'un profil qui écrit l'affaire, pour que la rentabilité montre : une affaire **gagnée et rentable**, une affaire
**déficitaire et partielle**, une ligne **soldée à zéro**, une affaire en **CHF**, une affaire **sans recette** dont le
temps est **non valorisé**, et des lignes non soldées pour l'onglet « À saisir ».

## 9. Ce qui n'est pas au périmètre

- aucune conversion de devise, aucun taux de change ;
- aucune facturation, aucun numéro de facture généré, aucune relance d'impayé, aucun lien avec un logiciel comptable ;
- aucune prévision du temps, aucun taux de vente horaire (`docs/SPEC-temps.md` §9) ;
- aucune répartition d'une recette entre plusieurs affaires ;
- aucune alerte de marge, aucun envoi d'email ;
- aucun export — `CRM-071` porte l'import/export ;
- aucune ligne de recette déduite du montant de l'affaire (§2.1).

## 10. Découpage

| Tranche | Contenu |
|---|---|
| **T1** | Cette spécification, la décision, le backlog, le schéma, le DAT, le design system, le seed, le contrat de déploiement, le catalogue du connecteur — committés avant tout code |
| **T2** | Migration `0095` : les deux tables, leurs règles, la devise verrouillée, `recette_saisissable`, `rentabilite_affaires`, la famille `recettes` ; pgTAP |
| **T3** | Webapp : bloc « Recettes » et bloc « Rentabilité » de la fiche, écran « Rentabilité » et ses deux onglets, famille `recettes` de la matrice ; unitaires |
| **T4** | Connecteur : `FAMILLES`, les deux genres d'ancre, les huit outils ; pytest unitaires et intégration |
| **T5** | Seed §21, API (refus avec jetons réels), E2E souris et clavier, captures aux quatre paliers, manuel, campagnes |
| **T6** | Production : migration `0095` en fenêtre avec instantané, webapp et service `mcp`, constat |

## 11. Preuves

- **pgTAP** (`supabase/tests/0087_recettes.test.sql`) : réel dérivé dans ses trois états ; écriture directe du réel
  refusée ; ligne soldée figée, rouverte ; signe libre, zéro admis ; libellé blanc refusé ; réel qui change de ligne
  refusé ; devise verrouillée par une ligne, libérée sans ligne ; RLS — la lectrice lit sans écrire, un membre hors du
  track ne lit rien ; `recette_saisissable` ; `rentabilite_affaires` — refusée au business developer et à la lectrice en
  `42501`, rendue à l'administratrice, sommes par devise, période sur les trois sortes de réels, ligne soldée à zéro
  hors période, personnel valorisé et non valorisé, affaire à la corbeille absente, archivée présente ; famille
  `recettes` acceptée par `mcp_autorise` et `mcp_poser_droits`, famille inconnue toujours `22023`
  (`0085_connecteur_mcp.test.sql`) ; mutations.
- **API** (`e2e/api`) : chaque refus avec le jeton réel du profil — écriture de la lectrice, réel écrit directement,
  devise changée, rentabilité demandée par un non-administrateur.
- **Unitaires** (Vitest) : la règle de §4 — marge réelle et prévue, taux vide, partielle et ses trois causes, plusieurs
  devises, sous-totaux par channel et track ; le bloc « Recettes », le bloc « Rentabilité » absent sur `42501`, l'écran
  et ses filtres, l'onglet « À saisir » ; mutations.
- **Connecteur** (pytest) : déclarations valides (genres, cases `aussi`) ; contre la vraie base, pour **chaque** outil :
  succès, refus par la matrice, refus par le CRM malgré la matrice ouverte, journal écrit ; la marge Python sur les
  mêmes cas que la webapp.
- **E2E** (Playwright) : une ligne et deux réels saisis puis soldés depuis la fiche, à la souris et au clavier, relus en
  base ; la saisie en série au clavier ; le rapport de l'administratrice, ses filtres et ses deux vues ; le membre qui
  lit « Réservé aux administrateurs » et saisit dans « À saisir » ; un outil du connecteur dont l'effet se voit dans la
  fiche ; quatre paliers sans défilement de la page ; captures observées.
