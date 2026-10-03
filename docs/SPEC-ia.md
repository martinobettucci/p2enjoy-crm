# Spécification — l'assistant IA de configuration (`CRM-097`)

*Écrite le 2026-10-02, avant le code, sur la demande et les arbitrages du responsable (`docs/JOURNAL.md`,
décision 617). Chaque tranche précise son contrat d'API et son écran ici, avant son propre code.*

## 1. Intention et arbitrages

La demande du responsable, le 2026-10-02 : « on va ajouter des fonctionnalités IA à cette application : la
première, la création et l'édition de workflows, l'ajout de champs personnalisés et les transitions. **Tout
ce qui est créé par IA est d'abord SUGGÉRÉ**, puis soit on rectifie et on review again, soit on accepte. »

Quatre arbitrages, rendus le même jour :

| Question | Décision |
|---|---|
| Comment l'administrateur rectifie une suggestion | Il **corrige à la main** l'aperçu et/ou écrit une **consigne** ; l'IA revoit la version corrigée avec la consigne et rend une nouvelle suggestion. On boucle jusqu'à « Accepter » ou « Abandonner » |
| Où vit une suggestion avant acceptation | **En base, avec son historique** : chaque tour de revue est conservé, visible des autres administrateurs, et survit au rechargement |
| Jusqu'où va l'édition d'un workflow qui porte des affaires | **Tout, avec remappage** : l'IA peut retirer une étape occupée en proposant où déplacer ses affaires ; le remappage est revu avant acceptation |
| Où l'assistant apparaît | **À côté de chaque geste** : « Créer avec l'IA » près de « Nouveau workflow », « Suggérer » dans les vues étapes, transitions et champs d'un workflow ouvert |

## 2. Le principe : l'IA ne crée rien, elle suggère

1. **Une demande** — un besoin décrit en français — produit une **suggestion**, dont la première **révision**
   vient de l'IA.
2. **Rectifier** : l'administrateur corrige l'aperçu (révision d'origine `correction`) et/ou écrit une
   consigne. « Revoir avec l'IA » envoie la dernière révision et la consigne ; l'IA rend une nouvelle
   révision (origine `ia`).
3. **Accepter** applique la dernière révision **en une transaction**, sous l'autorité de la base, qui
   revalide tout comme pour un geste manuel. **Abandonner** clôt la suggestion sans rien écrire dans la
   configuration.
4. Une suggestion acceptée ou abandonnée est **figée** ; son historique reste lisible.
5. **Rien n'est écrit dans la configuration avant « Accepter »** — ni workflow, ni étape, ni transition,
   ni champ, ni nœud du catalogue, ni déplacement d'affaire.

**La sortie du modèle n'est jamais crue.** Elle est contrôlée deux fois : par la fonction qui l'obtient,
pour présenter une suggestion cohérente et dire ce qu'elle a dû corriger ; puis, **seule autorité**, par
le geste d'acceptation en base, qui applique les règles des gestes manuels.

## 3. Le serveur LLM

| Variable | Rôle |
|---|---|
| `OLLAMA_HOST` | Serveur Ollama de LeLabs, `https://hôte:port` |
| `OLLAMA_API_KEY` | Clé, envoyée en `Authorization: Bearer` ; **secret**, jamais au dépôt. Vide : assistant indisponible |
| `OLLAMA_MODEL` | Modèle de génération ; défaut `gemma4:e2b`, le seul modèle génératif du serveur au 2026-10-02 |
| `OLLAMA_CONTEXT_LENGTH` | `num_ctx` demandé au modèle ; défaut `36864` |

**Mesuré le 2026-10-02** depuis le poste de développement :

- sans clé, `401` « clé API manquante » ; avec une clé hors de son origine autorisée, `403` « origine non
  autorisée pour cette clé » — la clé est liée par le serveur à une plage d'adresses, que le responsable
  règle (il a autorisé `192.168.0.0/24` pour le développement) ;
- `GET /api/tags` : deux modèles, `gemma4:e2b` (5,1 milliards de paramètres, `Q4_K_M`) et `all-minilm`
  (plongements, inutilisé ici) ;
- une demande de workflow à **sortie structurée** (`format` = schéma JSON, température 0,2) : **32,5 s**,
  537 jetons en entrée, 668 en sortie ; JSON conforme au schéma, workflow cohérent — une seule étape
  initiale, « gagné » et « perdu » terminales. Défauts relevés : clés hors de la forme du produit, et
  « perdu » atteignable depuis une seule étape. Ils justifient la double vérification du §2 et la boucle
  de revue.

**Usage.** Sortie structurée par schéma JSON, `stream` désactivé, température basse. Une génération est
bornée à **120 s** ; aucune nouvelle tentative automatique — une génération coûte une demi-minute, c'est
l'administrateur qui relance. Les refus du serveur sont traduits : clé absente ou refusée — « l'assistant
est mal configuré » ; réseau ou délai dépassé — « l'assistant ne répond pas ».

**Ce qui est envoyé au modèle, et rien d'autre** : la demande et la consigne de l'administrateur, la
dernière révision, et la configuration utile **lue sous ses droits** — catalogue de nœuds, workflow ciblé,
types de champs admis, et, pour un remappage, le **nombre** d'affaires par étape. **Jamais** une affaire, un
contact, un message, une valeur de champ ni une donnée personnelle du CRM. Le serveur est opéré par LeLabs ;
l'écran rappelle de ne pas coller de données personnelles dans une demande. Les journaux de la fonction
portent durée, jetons et statut, **jamais** le texte d'une demande ni la clé.

## 4. Architecture

- **Une fonction edge, `ia`**, derrière Kong (`/functions/v1/ia/…`), la seule à connaître la clé. Elle
  authentifie l'appelant par son jeton de session, lit la configuration et écrit les révisions **avec ce
  jeton** : c'est la RLS qui refuse un non-administrateur, pas la fonction (`CLAUDE.md` §10). Routes
  prévues : l'état de l'assistant (disponible ou non, et pourquoi), créer une suggestion depuis une
  demande, revoir une suggestion avec une consigne.
- **Les corrections manuelles** s'écrivent directement, par PostgREST, en révision d'origine `correction`,
  sous la même RLS.
- **L'acceptation** est un geste SQL, `public.accepter_suggestion_ia`, en une transaction. Pour un workflow
  nouveau, elle crée la composition entière, comme `creer_workflow_de_depart` (`CRM-094`). Pour un workflow
  existant, elle reprend **l'algorithme de restauration de `CRM-078`** (`docs/SPEC-workflow-engine.md`
  §7 ter.13) : la composition vivante est publiée en version — le point de retour —, le plan de remappage
  est calculé affaire par affaire, **aucune destination n'est devinée** — une affaire sans destination
  refuse l'acceptation —, les champs surnuméraires sont archivés. Comme la restauration, elle déplace des
  affaires : `security definer`, avec les vérifications d'administration et d'appartenance écrites à la
  main.
- **Concurrence.** Une suggestion sur un workflow existant porte l'empreinte de composition lue à sa
  création ; l'acceptation refuse si le workflow a changé depuis — « le workflow a changé : demandez une
  revue ». Une seule génération est en vol par suggestion ; une seconde demande est refusée.
- **Mode dégradé.** Clé vide ou serveur injoignable : l'assistant se déclare indisponible, ses commandes le
  disent, et **tous les gestes manuels restent entiers**.

## 5. Données — migration `0083` (tranche T1)

Deux tables, décrites dans `docs/SCHEMA.md` §9 ter avant leur migration :

- **`suggestions_ia`** — une suggestion : espace, cible (`workflow` nouveau ou existant, et le workflow
  visé), portée (`workflow`, `etapes`, `transitions`, `champs`), statut (`en_revue`, `acceptee`,
  `abandonnee`), empreinte de composition lue à la création, auteur, dates ; à l'acceptation, ce qui a été
  créé ou modifié, et la version publiée en point de retour.
- **`suggestions_ia_revisions`** — l'historique : numéro, origine (`ia` ou `correction`), consigne, la
  **proposition** (`jsonb`), et pour une révision de l'IA le modèle, les jetons et la durée.

Lecture et écriture **réservées aux administrateurs** de l'espace, par RLS ; aucune suppression exposée —
abandonner est un statut.

## 6. La proposition

Une révision porte une **proposition de composition** : la même structure que le document canonique de
`CRM-078` — workflow, étapes, transitions, champs, règles de visibilité, exigences —, mais désignée par
**clés** et non par identifiants, puisque ses objets n'existent pas encore. Pour un workflow existant, un
objet conservé porte son identifiant, un objet nouveau n'en porte pas, un objet absent est retiré ; un
retrait d'étape occupée porte sa destination de remappage. Les clés sont **normalisées par le produit**
à la forme `^[a-z0-9]+(-[a-z0-9]+)*$`, jamais reprises telles que le modèle les écrit. Le format exact est
fixé par la tranche T1 (§11.5), versionné (`version: 1`).

### 6.1 Le format `version: 1` — un workflow complet (fixé par T1)

```
{
  "version": 1,
  "workflow":    { "nom": texte },
  "noeuds":      [ { "cle", "libelle", "nature": "open" | "won" | "lost", "probabilite": 0–100 } ],
  "etapes":      [ { "noeud": cle, "initiale": booléen } ],
  "transitions": [ { "de": cle, "vers": cle, "libelle": texte, "commentaire_requis": booléen } ],
  "champs":      [ { "cle", "libelle", "type", "choix": [texte] | null, "devise": "EUR" | null, "aide": texte | null } ],
  "regles":      [ { "champ": cle, "etape": cle, "visibilite": "hidden" | "visible" | "required" } ],
  "exigences":   [ { "de": cle, "vers": cle, "champ": cle } ]
}
```

- **Une étape est désignée par la clé de son nœud** : un nœud n'apparaît qu'une fois par workflow
  (`docs/SCHEMA.md`, unicité `(workflow_id, node_id)`). `noeuds` porte les nœuds que la proposition
  **ajouterait au catalogue** ; une étape peut aussi viser un nœud déjà au catalogue, par sa clé.
- `type` est l'un des quinze types de `form_fields` ; `choix` est exigé et non vide pour `select` et
  `multiselect` ; `devise` est exigée pour `money`.
- **La fonction contrôle et dit**, sans corriger en silence : une seule étape initiale ; des transitions
  entre étapes existantes, sans boucle sur soi ; des clés normalisées (`^[a-z0-9]+(-[a-z0-9]+)*$`) et
  uniques ; des règles et des exigences qui visent des champs et des étapes de la proposition. Une
  proposition qui échoue à ces contrôles est conservée **avec la liste de ses défauts**, pour que
  l'administrateur la corrige ou la fasse revoir ; elle ne peut pas être acceptée en l'état.

> **Révisé par T2, le 2026-10-02 (§12.1).** Ce contrôle est passé **en base** : la fonction ne vérifie plus que
> la forme et normalise les clés, et les défauts de toute révision sont écrits par le trigger de création.
> Le paragraphe ci-dessus décrit la règle, plus son lieu.

## 7. L'écran

- « **Créer avec l'IA** » à côté de « Nouveau workflow » ; « **Suggérer** » dans les vues étapes,
  transitions et champs d'un workflow ouvert, ciblé sur ce que l'on regarde.
- Le **panneau de suggestion** : l'aperçu de la proposition — pour une modification, ce qui est **ajouté,
  modifié, retiré** —, éditable ; le champ de consigne ; « Revoir avec l'IA », « Accepter », « Abandonner ».
  Pour un retrait d'étape occupée, le nombre d'affaires et leur destination, modifiable avant d'accepter.
- La génération dure une demi-minute : l'écran le dit et montre un état d'attente explicite.
- Les règles visuelles et d'accessibilité sont écrites dans `docs/DESIGN_SYSTEM.md` par la tranche qui
  livre l'écran, avant son code.

## 8. Tests

Les preuves automatisées n'appellent **jamais** le serveur réel : il est distant, lent et non déterministe.
Un **simulateur local** du contrat Ollama (`/api/chat`, `/api/tags`), réponses déterministes par scénario,
remplace le serveur dans les tests ; son contrat est documenté et calqué sur les réponses mesurées au §3.
Un contrôle de contrat **facultatif** contre le serveur réel vérifie que le simulateur ne s'en écarte pas ;
il n'entre dans aucune campagne par défaut.

## 9. Découpage

| Tranche | Contenu |
|---|---|
| **T1** | Le socle : variables, fonction `ia` (état, appel au modèle, mode dégradé, borne, une génération en vol), tables et RLS (migration `0083`), simulateur local ; preuves pgTAP, API, unitaires |
| **T2** | Créer un workflow avec l'IA : demande, suggestion, aperçu éditable, consigne, revue, accepter (création atomique), abandonner ; écran et E2E |
| **T3** | Suggérer dans un workflow ouvert — étapes, transitions, champs — et accepter par l'algorithme de restauration, remappage des affaires revu ; écran et E2E |
| **T4** | Production : variables proposées dans la cellule, clé saisie en console, plage d'origine de la cellule autorisée, migration `0083` en fenêtre, constat |

## 10. Ce que cette unité ne fait pas

Aucune IA sur les affaires, les contacts ou les messages ; aucune écriture autonome du modèle ; aucun
entraînement ni ajustement du modèle ; le modèle de plongements `all-minilm` n'est pas utilisé.

## 11. Tranche T1 — le contrat du socle (écrit le 2026-10-02, avant son code)

### 11.1 Une génération vit dans sa requête, et la tient ouverte — mesuré, et pourquoi

Une génération dure **32,5 s** mesurées, et jusqu'à la borne de 120 s. Trois mesures fixent la forme :

- la route Kong des fonctions (`functions-v1`, `supabase/docker/volumes/api/kong.yml`) ne fixe aucun délai :
  celui de Kong, **60 s entre deux lectures**, s'applique ;
- les workers sont bornés à **10 s** par `main` (`workerTimeoutMs`) ;
- **le runtime tourne en `--policy oneshot`** (`docs/SPEC-edge-functions.md` §2) : le worker est retiré dès
  sa réponse rendue. **Mesuré le 2026-10-02** : une génération confiée à `EdgeRuntime.waitUntil` après une
  réponse `202` n'atteint jamais le serveur — le simulateur n'a reçu aucun `/api/chat`, et le verrou est resté
  posé. La première rédaction de ce paragraphe, qui retenait cette tâche de fond, est donc **retournée par la
  mesure**.

La génération vit donc **dans sa requête**, dont la réponse est un **flux** NDJSON (`application/x-ndjson`,
statut `202`) : la première ligne rend aussitôt `{"suggestion_id": …}`, puis une ligne `{"attente": true}`
toutes les **15 s** tient la connexion au-dessous du délai de lecture de Kong, et la dernière ligne porte
l'issue — `{"issue": "revision", "defauts": n}` ou `{"issue": "echec", "echec": code}`. L'issue s'écrit
**aussi en base** : le flux n'en est que le porteur, et l'écran peut relire la suggestion. Une connexion
coupée en route interrompt la génération : le verrou devient périmé après 180 s (§11.4) et l'administrateur
relance. `main` donne au seul worker `ia` une borne de **150 s** (`DELAI_PROPRE`), comme il ne lui remet
que ses propres variables (`ENVIRONNEMENT_PROPRE` : les quatre `OLLAMA_*` et le simulateur).

### 11.2 Qui écrit quoi

Le jeton interne vit **au plus 300 s** (`DUREE_MAX_JETON_INTERNE`), et peut arriver presque expiré : il ne
suffit pas à écrire le résultat d'une génération de deux minutes. Le contrat est donc :

1. **L'autorisation est décidée à la requête, par la base, avec le jeton de l'appelant** : créer la
   suggestion et sa demande, ou poser le verrou de génération (`generation_depuis`) sur une suggestion
   existante, passe par la RLS des administrateurs. Un refus ici rend `403` et **aucun appel au modèle n'a
   lieu**.
2. **La fin de la génération s'écrit avec la clé de service**, bornée à la suggestion que l'étape 1 a
   autorisée : la révision de l'IA, ou l'échec (`derniere_erreur`), puis la levée du verrou. La clé de
   service ne choisit ni la suggestion ni l'auteur : elle recopie ce que l'étape 1 a établi.

### 11.3 Les routes de la fonction `ia`

| Route | Effet | Réponses |
|---|---|---|
| `GET /ia/etat` | Disponibilité de l'assistant : clé présente et serveur joignable (`/api/tags`, borne 5 s), modèle servi | `200` `{disponible, raison?, modele}` — `raison` parmi `cle_absente`, `serveur_injoignable`, `cle_refusee`, `modele_absent` |
| `POST /ia/suggestions` | Crée une suggestion (`portee`, `workflow_id?`, `demande`) et mène sa première génération | `202`, flux NDJSON (§11.1) ; `400` demande vide ou trop longue (4 000 caractères) ; `403` non-administrateur ; `503` assistant indisponible |
| `POST /ia/suggestions/:id/revue` | Mène une nouvelle génération sur la dernière révision, avec une consigne | `202`, flux NDJSON ; `404` suggestion introuvable ou illisible ; `409` génération déjà en vol, ou suggestion figée ; `403` ; `503` |

Toute autre méthode : `405`. Aucune réponse ne reflète la clé, l'adresse du serveur ni un message brut du
modèle.

> **Révisé par T2 (§12.6)** : troisième issue `sans_suite` ; revue sans consigne d'une suggestion sans révision.

### 11.4 Ce qui change dans les tables (`docs/SCHEMA.md` §9 ter)

- `suggestions_ia.derniere_erreur` (`text`, nullable, `CHECK` : `delai_depasse`, `serveur_injoignable`,
  `cle_refusee`, `reponse_invalide`) : le dernier échec de génération, effacé par la génération suivante.
- **Le verrou** : `generation_depuis` est posé par l'appelant (RLS), levé par la fin de génération. Un verrou
  de plus de **180 s** est périmé — la fonction a disparu — et une nouvelle génération peut le reprendre.

### 11.5 La proposition `version: 1` est fixée dès T1

Une génération a besoin du schéma de sa sortie : le format de la proposition (§6) est donc fixé par T1, et
non par T2. T1 livre la génération d'un **workflow complet** (`portee = workflow`) ; T2 en livre l'écran et
l'acceptation.

### 11.6 Le simulateur — une instrumentation de développement, absente de la production

`ollama-simule` est un service du **seul** `docker-compose.dev.yml` : un serveur Python de la bibliothèque
standard, sur l'image déjà employée par `mail-sync`, qui répond à `/api/tags` et `/api/chat` selon le
contrat mesuré au §3 — sortie structurée, compteurs de jetons, `401` sans clé.

**Comment une preuve l'atteint sans priver le développement du vrai serveur.** La fonction `ia` ne vise le
simulateur que si deux conditions sont réunies : la variable `IA_SIMULATEUR_HOST` lui est remise — **seul
`docker-compose.dev.yml` la pose** — **et** la requête porte l'en-tête `x-ia-simulateur`, dont la valeur
choisit le scénario. En production la variable n'existe pas : l'en-tête est ignoré, ce qu'un test unitaire
prouve. La pile de développement sert donc le vrai serveur à l'usage, et chaque preuve le simulateur, sans
recréer `functions` (`CLAUDE.md` §15 : instrumentation de test non disponible en production).

Scénarios : `valide` (un workflow conforme), `incoherente` (conforme au schéma, mais deux étapes initiales
et une transition vers une étape absente), `invalide` (JSON hors schéma), `cle_refusee` (`403` « origine non
autorisée pour cette clé »). Le dépassement de la borne de 120 s est prouvé par les tests unitaires, avec une
borne injectée : aucune preuve n'attend deux minutes.

## 12. Tranche T2 — créer un workflow avec l'IA (écrit le 2026-10-02, avant son code)

T2 livre le premier parcours entier : demander, relire, corriger, faire revoir, accepter ou abandonner, pour un
**workflow nouveau** (`portee = workflow`, sans `workflow_id`). Les règles visuelles sont au
`docs/DESIGN_SYSTEM.md` §5.52 ; la décision est la 618 de `docs/JOURNAL.md`.

### 12.1 La base, seule juge des défauts — révision du §6.1

Le §6.1 confiait le contrôle à la fonction. T2 ajoute deux chemins qui ne passent pas par elle — la correction
manuelle, écrite par PostgREST, et l'acceptation, qui doit revalider —, et trois copies des mêmes règles, en
TypeScript dans la fonction, dans l'écran et en SQL, divergeraient au premier changement. **Le contrôle passe
donc en base, une fois** :

- `app.defauts_proposition_ia(p_workspace uuid, p_proposition jsonb) returns jsonb` rend la liste des défauts
  d'une proposition, lue contre le catalogue de nœuds de l'espace ;
- le trigger de création d'une révision l'appelle pour **toute** révision, d'origine `ia` comme `correction`,
  et écrit son résultat dans `defauts`. Un client ne fournit plus `defauts` : le privilège de colonne lui est
  retiré ;
- l'acceptation l'appelle de nouveau, au moment d'écrire — le catalogue a pu changer depuis la révision.

**La fonction `ia` ne fait plus que deux choses de la sortie du modèle** : rejeter ce qui n'a pas la forme d'une
proposition (`reponse_invalide`), et normaliser les clés (§6). Elle lit en retour les défauts que la base a
écrits, et c'est leur nombre que porte la dernière ligne du flux.

**La forme**, contrôlée par le trigger avant les défauts — une révision mal formée est **refusée** (`22023`,
« proposition mal formée »), jamais conservée : `version` vaut `1` ; `workflow` est un objet dont `nom` est un
texte ; `noeuds`, `etapes`, `transitions`, `champs`, `regles`, `exigences` sont des tableaux d'objets, deux
cents éléments au plus en tout ; les clés, libellés, `nature`, `type` et `visibilite` sont des textes ;
`initiale` et `commentaire_requis` des booléens ; `probabilite` un nombre ou `null` ; `choix` `null` ou un
tableau de textes ; `devise` et `aide` `null` ou un texte.

**Un défaut** est un objet `{code, chemin, valeurs}` : `chemin` désigne l'élément (`etapes[2]`,
`champs[0].choix`) ; `valeurs` porte ce que la phrase nomme — l'écran compose la phrase par une clé de
traduction (`docs/DESIGN_SYSTEM.md` §10), jamais par le texte de la base. Les codes, dans l'ordre où la base
les rend :

| Code | `valeurs` | Ce qui est relevé |
|---|---|---|
| `nom_absent` | — | le nom du workflow est blanc |
| `cle_invalide` | `cle` | une clé de nœud ou de champ hors de la forme `^[a-z0-9]+(-[a-z0-9]+)*$` |
| `noeud_en_double` | `cle` | deux nœuds proposés portent la même clé |
| `noeud_deja_au_catalogue` | `cle` | un nœud proposé porte la clé d'un nœud vivant du catalogue : l'étape doit le viser sans le redéclarer |
| `noeud_archive` | `cle` | une clé, proposée ou visée, est celle d'un nœud **archivé** du catalogue — le réactiver sans le dire changerait l'objet que l'administrateur a retiré (règle de `creer_workflow_de_depart`) |
| `libelle_absent` | `cle` | un nœud ou un champ sans libellé |
| `nature_invalide` | `cle`, `nature` | une nature hors `open`, `won`, `lost` |
| `probabilite_invalide` | `cle` | une probabilité absente ou hors de 0 à 100 |
| `noeud_inutilise` | `cle` | un nœud proposé qu'aucune étape ne vise — l'accepter l'ajouterait au catalogue pour rien |
| `aucune_etape` | — | aucune étape |
| `etape_en_double` | `cle` | deux étapes visent le même nœud |
| `noeud_inconnu` | `cle` | une étape vise un nœud ni proposé ni au catalogue |
| `etape_initiale` | `nombre` | il n'y a pas exactement une étape initiale |
| `transition_etape_absente` | `de`, `vers` | une transition touche une étape absente |
| `transition_boucle` | `cle` | une transition mène d'une étape à elle-même |
| `transition_en_double` | `de`, `vers` | deux transitions relient les mêmes étapes dans le même sens |
| `transition_sans_libelle` | `de`, `vers` | une transition sans libellé |
| `champ_en_double` | `cle` | deux champs portent la même clé |
| `type_inconnu` | `cle`, `type` | un type hors des quinze de `form_fields` |
| `choix_requis` | `cle` | une liste (`select`, `multiselect`) sans choix |
| `choix_invalide` | `cle`, `choix` | un choix dont la clé dérivée (§12.3) est vide ou déjà prise dans le même champ |
| `devise_requise` | `cle` | un champ `money` sans devise de trois lettres capitales |
| `regle_champ_absent` | `cle` | une règle vise un champ absent |
| `regle_etape_absente` | `cle` | une règle vise une étape absente |
| `regle_en_double` | `champ`, `etape` | deux règles pour le même couple champ × étape |
| `visibilite_invalide` | `visibilite` | une visibilité hors `hidden`, `visible`, `required` |
| `exigence_transition_absente` | `de`, `vers` | une exigence vise une transition absente |
| `exigence_champ_absent` | `cle` | une exigence vise un champ absent |
| `exigence_en_double` | `de`, `vers`, `champ` | deux exigences identiques |

`choix` et `devise` ne sont lus que pour les types qui les emploient ; les textes sont pris sans leurs espaces
de bord, et une `aide` blanche vaut l'absence d'aide. Ce sont les seules mises en forme, et elles sont écrites
ici pour ne pas être silencieuses.

### 12.2 Corriger — une révision `correction`, par PostgREST

`POST /rest/v1/suggestions_ia_revisions` avec `{suggestion_id, origine: 'correction', proposition}` — la
proposition **entière**, telle que l'administrateur l'a laissée — et `Prefer: return=representation` : la
réponse `201` porte la révision écrite, ses défauts calculés par la base et son numéro. Refus : `42501` pour un
non-administrateur (RLS) ; `P0001` « suggestion figée » ; `P0001` « génération en cours » — **nouveau** : une
correction écrite pendant une génération serait aussitôt recouverte par la révision du modèle, calculée sur la
version précédente, et l'administrateur croirait sa correction prise en compte ; `22023` pour une forme invalide.

### 12.3 Accepter — `public.accepter_suggestion_ia(p_suggestion uuid) returns uuid`

**`SECURITY DEFINER`**, comme la restauration de `CRM-078` (§4) et pour le même motif, ici réduit : l'état
`acceptee` est refusé à `authenticated` par le trigger de T1, si bien qu'un geste `SECURITY INVOKER` ne pourrait
jamais conclure. Les vérifications sont écrites à la main, dans cet ordre, et chacune rend un refus nommé :

| Ordre | Contrôle | Refus |
|---|---|---|
| 1 | appelant authentifié | `42501` « authentification requise » |
| 2 | la suggestion existe **et** l'appelant administre son espace — indiscernables, pour qu'un non-administrateur n'apprenne pas qu'elle existe | `PT404` « suggestion introuvable » — HTTP 404 ; `P0002`, d'abord écrit, est rendu **500** par PostgREST (mesuré le 2026-10-02), convention `PT<statut>` de `0042` |
| 3 | statut `en_revue` (suggestion verrouillée `for update`) | `P0001` « suggestion figée » |
| 4 | portée `workflow` sans cible — T3 livrera les autres | `P0001` « portée non livrée » |
| 5 | aucune génération en vol (verrou de moins de 180 s, §11.4) | `P0001` « génération en cours » |
| 6 | une révision existe | `P0001` « aucune révision » |
| 7 | la dernière révision, **recontrôlée maintenant**, ne porte aucun défaut | `P0001` « proposition non conforme », `detail` : le nombre de défauts |

**Les effets, en une transaction**, tous dans l'espace de la suggestion :

1. le workflow : `name` = le nom proposé, portée `global`, `is_default` vrai si l'espace n'a encore aucun
   workflow par défaut, archivé compris (règle de `creer_workflow_de_depart`) ;
2. un nœud de catalogue par nœud proposé — clé, libellé, `kind` = la nature, `default_probability` = la
   probabilité, `color` dérivée de la nature : `brand` pour `open`, `success` pour `won`, `danger` pour
   `lost` ;
3. les étapes, dans l'ordre de la proposition (`position` 1, 2, …), l'initiale désignée ;
4. les transitions, leur libellé et leur motif exigé ;
5. les champs, dans l'ordre de la proposition : `options` = `{"choices": [{key, label}, …]}` pour une liste —
   la **clé d'un choix est dérivée de son libellé** par la forme du produit (accents retirés par `unaccent`,
   minuscules, tout autre caractère en tiret), le format `version: 1` ne portant que des libellés —,
   `{"currency": devise}` pour `money`, `{}` sinon ; `help_text` = l'aide ;
6. les règles de visibilité, puis les exigences de transition ;
7. la suggestion passe `acceptee`, `workflow_cree_id` = le workflow créé ; `decided_by` et `decided_at` sont
   posés par le trigger.

Rendu : l'identifiant du workflow créé. Les contraintes des tables restent en vigueur sous `SECURITY DEFINER` :
une violation que le contrôle n'aurait pas prévue annule tout, et rien n'est écrit. Privilège : `authenticated`
seulement.

**Le gel d'une suggestion décidée laisse passer l'effacement d'un lien** — défaut de `0083` trouvé par T2 le
2026-10-02 (décision 618). Les clés `on delete set null` vers le workflow créé, la version de retour, l'auteur et
le décideur mettent à jour une suggestion décidée — et l'auteur d'une révision immuable — quand ce qu'elles
désignent disparaît ; le gel les refusait, si bien qu'un workflow créé par une acceptation ou un profil ne se
supprimaient plus. `0084` révise les deux triggers : seul passe un changement qui ne fait **qu'effacer** un de
ces liens ; poser un lien ou toucher toute autre colonne reste refusé.

### 12.4 Abandonner — par PostgREST

`PATCH /rest/v1/suggestions_ia?id=eq.<id>` `{statut: 'abandonnee'}`, `Prefer: return=representation`. Zéro
ligne rendue est l'issue « sans effet » — suggestion illisible ou non administrée — et l'écran la dit. `P0001`
« suggestion figée » si elle est déjà décidée. Abandonner **pendant** une génération est permis — c'est le
moyen de se défaire d'une génération qu'on ne veut plus — : le trigger lève le verrou, et la génération qui
s'achève ensuite n'écrit rien (§12.6).

### 12.5 L'écran — le parcours (sa forme : `docs/DESIGN_SYSTEM.md` §5.52)

- **Entrées.** « Créer avec l'IA » à côté de « Nouveau workflow », au-dessus de la liste et dans l'état vide ;
  rendue à tous les rôles (§4, décision 509) — la base refuse. **Les suggestions en revue** de l'espace sont
  lues avec la liste des workflows (`suggestions_ia?statut=eq.en_revue&portee=eq.workflow`, plus récentes
  d'abord) et listées sous elle ; la RLS n'en rend aucune à un non-administrateur, et l'écran ne rend alors
  rien — il ne nomme pas ce qu'il ne montre pas.
- **Le panneau** vit dans la colonne de droite, à la place du workflow choisi, ou sous l'état vide.
- **Demander.** Un champ « Décrivez le workflow » (4 000 caractères au plus), le rappel de ne pas y coller de
  donnée personnelle (§3), « Générer la suggestion ». L'état de l'assistant (`GET /ia/etat`) est lu à
  l'ouverture ; indisponible, l'écran le dit avec sa raison, et la commande reste offerte.
- **Générer.** Le flux est lu ligne à ligne (`fetch`, jeton de session et clé anonyme) : la première ligne
  donne la suggestion, que la liste relit aussitôt ; la dernière donne l'issue, après quoi la suggestion et ses
  révisions sont relues. L'attente est dite, avec le temps écoulé.
- **Relire.** La dernière révision est rendue en aperçu : nom, étapes (nœud proposé ou du catalogue), sorties
  de chaque étape, champs, visibilités, exigences ; ses défauts, traduits, au-dessus ; l'historique des
  révisions, replié.
- **Corriger à la main**, dans l'aperçu, ce qui se corrige sans réécrire la structure : le nom ; pour un nœud
  proposé, son libellé, sa nature et sa probabilité ; l'étape initiale ; retirer une étape ; « utiliser le
  nœud du catalogue » quand un nœud proposé y existe déjà ; le libellé et le motif d'une transition, en
  retirer une, en **ajouter** une entre deux étapes ; le libellé, le type, les choix, la devise et l'aide d'un
  champ, en retirer un ; la visibilité d'une règle, en retirer une ; retirer une exigence. **Ajouter une étape,
  un champ, une règle ou une exigence** se demande par une consigne, ou se fait dans l'éditeur une fois le
  workflow créé. **Un retrait emporte ce qui en dépend**, comme la base l'emporterait : une étape, ses
  transitions, leurs exigences, ses règles et son nœud proposé ; un champ, ses règles et ses exigences ; une
  transition, ses exigences. « Enregistrer la correction » écrit la révision (§12.2) ; « Rétablir » revient à
  la dernière révision.
- **Faire revoir.** Une consigne et « Revoir avec l'IA » : une correction non enregistrée est d'abord
  enregistrée — l'IA revoit ce que l'administrateur voit (§2) —, puis la revue part.
- **Accepter.** « Accepter et créer le workflow » : une correction non enregistrée est d'abord enregistrée ;
  si elle porte des défauts, l'acceptation n'est pas demandée et les défauts sont rendus. Au succès, la liste
  des workflows est relue, le workflow créé devient le workflow choisi, et la suggestion quitte la liste.
- **Abandonner**, après une confirmation dans le flux. Au succès, le panneau se ferme et la liste est relue.
- **Une suggestion ouverte pendant une génération** — par un autre administrateur, ou après un rechargement —
  dit qu'une génération est en cours et offre « Relire » ; aucune scrutation automatique.

### 12.6 Ce que T2 change à la fonction `ia` (révision du §11.3)

- La dernière ligne du flux porte le nombre de défauts **écrits par la base** ; une révision que la base n'a
  pas écrite — suggestion abandonnée pendant la génération — rend `{"issue": "sans_suite"}`, troisième issue.
- `POST /ia/suggestions/:id/revue` accepte un corps **sans consigne** quand la suggestion n'a encore aucune
  révision : c'est la reprise d'une première génération échouée, qui rejoue la demande. Avec une révision, la
  consigne reste exigée (`400`).
- Une revue transmet au modèle, avec la dernière révision, **les défauts que la base y a relevés**.

### 12.7 Les refus traduits par l'écran

| Geste | Issue | Ce que l'écran dit |
|---|---|---|
| générer, revoir | `400` | la demande ou la consigne est vide ou trop longue |
| générer, revoir | `403` | réservé aux administrateurs de l'espace |
| générer, revoir | `503` | l'assistant est indisponible, avec sa raison |
| revoir | `404` / `409` | suggestion introuvable / figée / génération en cours |
| issue `echec` | `delai_depasse`, `serveur_injoignable`, `cle_refusee`, `reponse_invalide` | quatre phrases ; « Réessayer » relance la même génération |
| issue `sans_suite` | — | la suggestion a été décidée entre-temps ; l'écran la relit |
| corriger | `42501`, `P0001`, `22023` | réservé ; figée ou génération en cours ; correction mal formée |
| accepter | `PT404`, `P0001` (×5), `42501` | les refus du §12.3, un par un |
| abandonner | zéro ligne, `P0001` | sans effet ; figée |
| réseau | — | l'assistant ne répond pas |

### 12.8 Preuves et données de démonstration

- **pgTAP** : chaque code de défaut ; le trigger qui écrit les défauts quel que soit ce que le client envoie, et
  refuse une forme invalide ; la correction refusée pendant une génération ; l'acceptation — chaque objet créé
  avec ses attributs, le défaut posé ou non, les clés de choix dérivées — ; ses sept refus, dont le commercial
  et la lectrice (`PT404`) ; l'atomicité.
- **API** aux jetons réels : correction et défauts calculés par la base ; acceptation par la RPC, workflow
  relu ; refus du commercial et de la lectrice ; proposition incohérente refusée ; abandon, puis acceptation
  refusée ; revue sans consigne d'une suggestion sans révision.
- **Unitaires** : la lecture du flux, la traduction des défauts et des refus, les corrections et leurs retraits
  en cascade, le panneau.
- **E2E** à la souris et au clavier, contre le simulateur (l'en-tête est ajouté aux requêtes de la fonction par
  la preuve) : demander, relire, corriger, enregistrer, revoir, accepter — le workflow choisi dans la liste — ;
  abandonner ; le refus du commercial ; captures observées aux quatre paliers.
- **Seed** : une suggestion **en revue**, créée par l'administratrice au travers de la vraie fonction et du
  simulateur — le seul chemin réel en développement (`CLAUDE.md` §8) —, pour que l'écran ne s'ouvre pas vide.

## 13. Tranche T3 — suggérer dans un workflow ouvert (écrit le 2026-10-03, avant son code)

T3 livre le second parcours : un administrateur, depuis un workflow **existant** — qui porte peut-être des affaires
—, demande à l'IA de faire évoluer ses **étapes**, ses **transitions** ou ses **champs** ; il relit ce qui serait
**ajouté, modifié, retiré**, décide où vont les affaires d'une étape retirée, puis accepte ou abandonne. Arbitrage
du responsable (décision 617) : « Tout, avec remappage ». Les règles visuelles sont au `docs/DESIGN_SYSTEM.md` §5.53 ;
la décision est la 620 de `docs/JOURNAL.md`.

### 13.1 La proposition d'une modification : le format `version: 1`, la composition CIBLE entière

Une suggestion sur un workflow existant porte, comme une création, la **composition cible entière** au format du
§6.1 — et non une liste de différences : l'IA reçoit la composition vivante et rend celle qu'elle propose, que
l'administrateur relit et corrige avec l'aperçu de T2. **L'identité d'un objet est sa clé**, et aucun identifiant
n'atteint le modèle :

| Objet | Clé d'identité dans le workflow | Conservé | Nouveau | Retiré |
|---|---|---|---|---|
| étape | la clé de son nœud (unique par workflow) | la clé est une étape vivante | sinon | étape vivante absente |
| transition | le couple `de` → `vers` | le couple existe | sinon | couple vivant absent |
| champ | sa clé (unique par workflow) | la clé est un champ vivant **non archivé** | sinon | champ actif absent → **archivé**, jamais supprimé (§7 ter.13.4 du moteur) |
| règle | le couple champ × étape | le couple existe | sinon | couple vivant absent |
| exigence | transition × champ | existe | sinon | absente |

**Une seule clé s'ajoute au format, facultative** : `remappages`, tableau de `{ "de": clé d'étape retirée,
"vers": clé d'étape de la cible }` — où vont les affaires d'une étape retirée qui en porte. C'est la forme de
`step_overrides` (`CRM-078`, §7 ter.12.3), dite en clés. Une création n'en porte pas ; la forme l'admet vide.

**Ce que la cible ne change pas d'un objet conservé, elle le garde** : la surcharge de libellé, de probabilité et le
seuil d'ancienneté d'une étape, le libellé d'un nœud du catalogue, les champs déjà archivés. La position d'une étape
et d'un champ suit l'ordre de la proposition.

**Le libellé d'une transition, dans une modification** (précisé le 2026-10-03, à l'écriture de T3.a). Une transition
vivante peut n'avoir aucun libellé propre — l'éditeur affiche alors celui de son étape d'arrivée. La composition
vivante la rend avec `"libelle": ""`, et, pour une modification, **un libellé vide vaut l'absence de libellé propre** :
il n'est pas un défaut, et l'acceptation pose un libellé `null`. Pour une création, `transition_sans_libelle` reste
un défaut (§12.1) : un workflow neuf n'a pas d'éditeur pour le compléter.

**Le nom du workflow** suit la cible : s'il diffère du nom vivant, l'acceptation renomme le workflow.

### 13.2 La composition vivante, rendue au format de la proposition

`public.proposition_du_workflow(p_workflow uuid) returns jsonb` — `stable`, `security invoker` : la composition
vivante au format du §6.1 — nom, étapes (par clé de nœud) dans l'ordre, transitions, champs actifs, règles,
exigences ; `noeuds` vide, puisque tout nœud d'une étape vivante est au catalogue. Elle sert trois fois : la fonction
`ia` l'envoie au modèle, l'écran en tire le différentiel, et l'acceptation compare la cible à elle.

`public.occupation_du_workflow(p_workflow uuid) returns jsonb` — `stable`, `security invoker` : `{clé d'étape :
nombre d'affaires}`, archivées et en corbeille comprises (règle du §7 ter.12.5 du moteur). Exhaustive pour un
administrateur (règle 2 de `app.resolve_access`) ; partielle pour un autre membre, qui ne peut de toute façon pas
accepter. **Le modèle reçoit ces nombres — et seulement eux** (§3) : il peut ainsi proposer les remappages.

### 13.3 Les défauts d'une modification (révision du §12.1)

`app.defauts_proposition_ia` reçoit le workflow ciblé (`null` pour une création). Les vingt-neuf codes du §12.1
valent tels quels, et cinq s'ajoutent, dans cet ordre, après les exigences :

| Code | `valeurs` | Ce qui est relevé |
|---|---|---|
| `type_non_modifiable` | `cle`, `type` | un champ conservé change de type — le type d'un champ existant ne se modifie pas (§5.15 de la charte) |
| `remappage_requis` | `cle`, `affaires` | une étape retirée porte des affaires et aucun remappage ne la couvre — **aucune destination n'est devinée** |
| `remappage_origine_inconnue` | `cle` | un remappage part d'une étape qui n'est pas retirée |
| `remappage_cible_absente` | `de`, `vers` | un remappage vise une étape absente de la cible |
| `remappage_en_double` | `cle` | deux remappages partent de la même étape |

Pour une modification, les étapes, champs et nœuds **vivants** sont connus de la base : `noeud_inconnu` et
`noeud_deja_au_catalogue` se jugent contre le catalogue comme pour une création.

### 13.4 Accepter une modification — l'algorithme de restauration de `CRM-078`

`public.accepter_suggestion_ia` accepte désormais les quatre portées. Pour une suggestion sur un workflow existant,
après les vérifications 1 à 3 et 5 à 7 du §12.3 (la 4 tombe), trois refus s'ajoutent, dans cet ordre :

| Ordre | Contrôle | Refus |
|---|---|---|
| 4 bis | le workflow ciblé est vivant (non archivé) | `P0001` « workflow archive » |
| 4 ter | son empreinte de composition est celle relevée à la création de la suggestion (`empreinte_initiale`) | `PT409` « workflow modifie » — la base a bougé depuis : une revue est nécessaire |

Les effets, en une transaction :

1. **le point de retour** : la composition vivante est publiée en version (`publish_workflow_version`), sauf si la
   dernière version la photographie déjà — son empreinte est l'`empreinte_initiale` — : cette version **est** alors
   le point de retour, rien n'est republié. C'est la règle exacte de la restauration (§7 ter.13.5 du moteur) ;
2. les nœuds proposés entrent au catalogue (comme une création) ;
3. **la cible est traduite en document de composition** (§7 ter.2 du moteur) par `app.document_cible_ia` — un objet
   conservé garde son identifiant, un objet nouveau en reçoit un ; une étape nouvelle lit son nœud au catalogue par
   sa clé, unique dans l'espace —, et les remappages en `step_overrides`. Les étapes nouvelles sont posées avant
   l'application, jamais initiales : une affaire peut être remappée vers l'une d'elles ;
4. **ce document est appliqué par le cœur de la restauration** : affaires déplacées, étapes, transitions, champs
   (archivés et non supprimés), règles, exigences — `app.appliquer_composition`, extrait de
   `restore_workflow_version`, qui l'appelle désormais lui aussi ; **un seul algorithme pour les deux gestes** ;
4 bis. le workflow est renommé si la cible porte un autre nom ;
5. la suggestion passe `acceptee`, avec `version_retour_id` — le point de retour, qu'une restauration rend ensuite
   comme toute version.

Rendu : l'identifiant du workflow. Une violation que le contrôle n'aurait pas prévue annule tout.

### 13.5 La fonction `ia` (révision du §11.3)

`POST /ia/suggestions` accepte `portee` ∈ `etapes`, `transitions`, `champs` avec un `workflow_id` ; la portée sans
cible reste `400`. La génération envoie au modèle, en plus des règles : la composition vivante (§13.2), l'occupation
par étape, et la portée — « ne fais évoluer que les étapes », etc. — ; le modèle rend la cible entière. La portée
**oriente** le modèle ; elle ne restreint pas ce que l'administrateur peut corriger, et le différentiel montre tout
ce qui change.

### 13.6 L'écran — le parcours

- **Entrée** : « Suggérer » (`Sparkles`), en tête des blocs étapes, transitions et champs du workflow ouvert ; elle
  ouvre le panneau de T2 en mode demande, la portée nommée — « Faire évoluer les étapes de « Cycle… » ».
- **Les suggestions en revue d'un workflow** sont listées dans sa colonne, au-dessus des étapes ; celles de création
  restent sous la liste des workflows.
- **Relire** : en tête, le **différentiel** — ajouté, modifié, retiré, par collection, en mots (§5.15 de la charte,
  comparaison de versions) ; puis l'aperçu modifiable de T2, sur la cible.
- **Les affaires des étapes retirées** : pour chaque étape retirée qui en porte, leur nombre et un `select` de
  destination parmi les étapes de la cible, ouvert sur « Aucune destination » — jamais présélectionné. Choisir
  écrit le remappage dans le brouillon ; « Enregistrer la correction » le persiste.
- **Accepter** : comme T2 — une correction non enregistrée l'est d'abord. Au succès, l'éditeur relit le workflow, le
  panneau se ferme, et l'annonce nomme le point de retour.

### 13.7 Preuves

- **pgTAP** : la proposition vivante ; l'occupation ; les cinq codes ; l'acceptation — chaque collection ajoutée,
  modifiée, retirée ; un champ archivé et non supprimé ; les affaires déplacées ; le point de retour publié une fois ;
  `PT409` si le workflow a bougé ; `restore_workflow_version` **inchangée** — ses suites existantes restent vertes.
- **API** : une modification du workflow du seed acceptée par la RPC, relue, puis **annulée par la restauration du
  point de retour** ; le refus du commercial ; le `PT409`.
- **Unitaires** : le différentiel, le remappage dans le brouillon, le panneau en mode modification.
- **E2E** : « Suggérer » depuis les étapes, le différentiel, une étape occupée retirée et remappée, acceptée, le
  graphe relu ; au clavier ; les quatre paliers ; captures observées.
