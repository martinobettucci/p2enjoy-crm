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
fixé par la tranche T2, versionné (`version: 1`).

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
