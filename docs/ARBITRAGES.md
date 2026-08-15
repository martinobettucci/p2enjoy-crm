# Dossier d'arbitrage — décisions rendues et travail restant

Document de **travail du responsable**. Il ne remplace pas `docs/INCONSISTENCY_REPORT.md`, qui
reste la source de vérité de chaque constat : il le **trie**, propose des options chiffrées en
avantages et inconvénients, et recommande une issue.

Une entrée disparaît d'ici lorsque la décision est prise, écrite dans `docs/JOURNAL.md`, et
l'entrée `INC-` correspondante close.

**Nettoyage du 2026-08-13.** Cette règle n'avait jamais été appliquée : le dossier portait encore la
photographie du 2026-08-06 — « quarante entrées qui restent », trois familles, un ordre d'exécution
—, dont chaque ligne a depuis été soit livrée, soit renversée par une décision plus récente. Elle
est retirée, comme la ligne des entrées désormais closes dans la matrice. L'état antérieur reste
lisible dans l'historique Git. Ce document ne contient donc plus que **ce sur quoi il reste quelque
chose à faire**.

**Conséquence à connaître :** les renvois par **numéro de ligne** vers ce fichier — `docs/JOURNAL.md`
en porte un, « `docs/ARBITRAGES.md` (ligne 61) » pour INC-072 — ne pointent plus sur la bonne ligne.
Le journal n'est pas réécrit : il est chronologique. Une ligne de la matrice se retrouve par son
**numéro d'entrée**, jamais par sa position.

## 1. Arbitrages du 2026-08-15 — mise en œuvre due

**Le registre des contradictions est vide.** Les dix-neuf dernières entrées ouvertes ont été
arbitrées le 2026-08-15 par les décisions **408 à 419**, sur instruction du responsable de trancher
automatiquement tout ce qui restait en suspens. Ce tableau est ce qu'il reste : **du travail**, pas
des questions.

| Décision | Entrées | Ce qui est dû | Porteur |
|---|---|---|---|
| **408** | INC-109, INC-119 | réécrire les deux dégradations vides pour qu'elles dégradent : `btrim` sans second argument pour le formulaire, un type d'essai réservé pour la timeline. **Règle** : une dégradation n'emploie jamais une valeur que le produit peut livrer un jour | reprise harnais, `CRM-008` |
| **409** | INC-112, INC-113 | rejouer le **préfixe complet** des migrations pour restaurer ou éprouver l'idempotence, jamais une liste de fichiers en dur. Contournement en attendant : rejouer `0037_corbeille.sql` après `verify-tracks.sh` ou `verify-channels.sh` | reprise harnais, `CRM-008` |
| **410** | INC-105, INC-116, INC-117 | un harnais restaure à l'entrée ; un `finally` purge **même après échec** ; une preuve cible sa trace par identifiant ; la section d'aller-retour du seed devient convergente **dès le premier rejeu** | `CRM-043`, `CRM-046`, `CRM-008` |
| **411** | INC-107, INC-118 | borner toute lecture de journal à la fenêtre du scénario (`docker logs --since`). Un tour de veille qui échoue pendant une preuve est **l'effet attendu de la preuve** | `CRM-051` |
| **412** | INC-106 | remplacer `printf … \| grep -q <motif présent>` par un comptage comparé à zéro, et **balayer le motif dans tous les harnais** | `CRM-051`, `CRM-008` |
| **413** | INC-103, INC-104, INC-108 | mettre les chiffres à leur valeur mesurée et les dater ; ajouter à `verify-scripts.sh` le recomptage de l'index et des entrées ouvertes du registre | documentation, `scripts/verify-scripts.sh` |
| **414** | INC-100 | retirer les deux affirmations fausses du §4.10 du manuel et **relire la liste entière**. Règle : un inventaire de manques se relit à chaque livraison qui en comble un | `docs/manual.md` |
| **415** | INC-102 | le seed supprime puis recrée `…0d4` quand `deleted_at` est posée et `deleted_by` nulle, avant de le faire retirer par le jeton réel ; sa ligne d'information n'annonce que ce qu'il a fait | `supabase/seed/apply-seed.sh`, `CRM-046` |
| **416** | INC-114 | `AppShell` ne monte la barre d'onglets que pour les routes portant un track | `CRM-007` |
| **417** | INC-115 | réécrire le §9.7 de `docs/SPEC-seed.md` et la preuve n° 13 pour asserter la **réouverture** au lieu d'une absence | reprise `CRM-012` |
| **418** | INC-110 | instrumenter `inbound_poll_write_failed` avec le détail assaini de l'erreur ; inscrire dans `docs/DAT.md` que `down -v` n'est pas une remise à zéro complète | `CRM-051`, `docs/DAT.md` |
| **419** | INC-111 | la vérification de fin de session porte sur le **fond** — document lu en entier avant le backlog et avant toute modification — et non sur le rang de l'appel d'outil | `docs/CloudWorker.md` |
| **421** | — (constat mesuré, tranché sans passer par le registre, doctrine du 2026-08-15) | la barre latérale et l'administration tiennent **deux copies** de la liste des tracks, et une écriture de l'écran ne rafraîchit que la sienne. MESURÉ sur l'ARCHIVAGE — le track reste dans la barre jusqu'au prochain chargement de page —, donc antérieur à la corbeille. **Règle** : une écriture qui change ce que la coquille affiche doit pouvoir l'invalider | `CRM-075` |

### Complément du 2026-08-15 — trois entrées de plus, dont une rouverte

| Décision | Entrées | Ce qui est dû | Porteur |
|---|---|---|---|
| **428** | INC-120 (= **INC-094 rouverte**) | la garde des élévations cesse d'énumérer les fichiers : elle vérifie que tout fichier marqué porte le `raise exception` sur `current_user` **et** son motif mesuré en en-tête | `CRM-002` |
| **429** | INC-121 | les deux compteurs de `verify-preuves-refus.sh` se **calculent** en base ; le troisième contrôle reste rouge et nomme les neuf preuves de refus dues | `CRM-008` (calcul), `CRM-014` et `CRM-013` (preuves) |
| **430** | INC-122 | l'assertion « empreinte inchangée » mesure les deux états au lieu de comparer à une constante, et le workflow dérivé se désigne **par son nom** | `CRM-078`, première tranche |

**Ce que la réouverture d'INC-094 enseigne, et qui vaut pour tout ce tableau.** Un arbitrage rendu et
non livré finit par être **redemandé** : la décision 363 a tranché la garde des élévations le
2026-08-13, personne ne l'a mise en œuvre, le harnais est resté rouge quatre jours, et une session
de `CRM-077` a reconsigné le même fait sous INC-120. La dette listée ici n'est pas une formalité
administrative — chaque ligne non soldée reviendra sous un numéro neuf, avec le temps de diagnostic
qui va avec.

**Bloqueur d'environnement, rappelé ici parce qu'il commande le reste.** Le registre d'images Docker
a été injoignable (INC-096, arbitrée) : sans pile, aucune de ces mises en œuvre n'est **prouvable**,
et aucune unité ne peut passer à `[x]`. Les seules exécutables sans pile sont les décisions **413**,
**414** et **419**, purement documentaires, et la partie statique de **412**.

## 2. Matrice d'exécution des arbitrages du 2026-08-08

Le responsable a délégué l'ensemble des choix alors suspendus : les décisions 292 à 299 les rendent
tous. **Aucune ligne de cette matrice n'est une question** — chacune est une décision prise dont la
mise en œuvre reste due. Les entrées closes depuis en ont été retirées.

| Entrées | Décision exécutable | Porteur |
|---|---|---|
| INC-002, INC-004 | empreinte MIME complète ; inconnu accepté mais sans pouvoir automatique | `CRM-054` |
| INC-006, INC-008, INC-018, INC-026, INC-082 | pile actuelle canonique ; scripts canoniques ; erreurs UI sûres ; faits Stalwart reportés | socle, mail |
| INC-009, INC-010, INC-017, INC-019, INC-025, INC-029, INC-031, INC-033, INC-043, INC-054 | choix déjà acquis confirmés ; fermeture seulement après mesure de l'unité porteuse | unités existantes |
| INC-011, INC-045 | permissions dérivées des parents ; parent navigable par enfant autorisé ; identité RLS | reprise droits fins |
| INC-027 | `DEFAULT NULL` plus trigger pour toute position omissible | reprise migrations/types |
| INC-028 | `*-on-soft` partout, `accent` réservé au surlignage | reprise design transverse |
| INC-034, INC-059, INC-069 | une routine séquentielle sur `main`, identité du responsable ; décisions `180a`/`180b` | méthode de travail |
| INC-035, INC-039, INC-040, INC-041, INC-074 | dernier propriétaire = définition complète ; gardes symétriques ; seed convergent | reprise migrations/seed |
| INC-036 | `PLAYWRIGHT_CHROMIUM_PATH` contrôlé explicitement | harnais UI |
| INC-037, INC-038, INC-056 | copie intégrale du formulaire et empreinte de composition | `CRM-018` |
| INC-048, INC-052 | vrai commentaire transactionnel ; blancs Unicode normalisés | reprise `CRM-034` |
| INC-049, INC-051, INC-057 | propriété exacte de chaque preuve et de chaque `@verifies` | reprise preuves |
| INC-053 | `user` résolu maintenant ; `contact` refusé jusqu'à `CRM-060` | reprise formulaires, `CRM-060` |
| INC-055, INC-058, INC-060, INC-064 | harnais autonomes, synchrones, restaurés à l'entrée, comptes seedés nommés | reprise harnais |
| INC-062 | parcours transition détenu par `CRM-041`, contre-preuve de `CRM-037` | reprise DoD |
| INC-063 | `alert` réservé à l'erreur | reprise formulaire |
| INC-065 | redirection canonique seulement après double autorisation | parcours card |
| INC-066 | éditeur administrateur complet | `CRM-076` |
| INC-067 | conversion numérique finie et parseur partagé | reprise cards, `CRM-066` |
| INC-068 | étiquettes réelles, RLS, filtres et digest | `CRM-069` |
| INC-070 | analyse AST TypeScript prouvée dans les deux sens | reprise `CRM-008` |
| INC-071, INC-072 | commenter exige écriture ; modération auditée | reprise commentaires/identité |
| INC-088 | l'écriture depuis la fiche rejoint `CRM-037`, dont la DoD exige déjà la saisie (décision 334) | `CRM-037` |

Les propositions P01 à P12 sont elles aussi arbitrées par la décision 299 et par la fin de
`docs/BACKLOG.md`. Sur la série 002 à 088, il ne reste donc **aucune décision produit suspendue** ;
il reste du travail à implémenter, mesurer et fermer.

## 3. Ordre de solde — décision 336, mis à jour au 2026-08-13

L'ordre retenu était : les défauts réels d'abord, le lot documentaire ensuite. Deux de ses trois
termes sont soldés.

1. ~~**INC-076** — un compte devenu indestructible dès qu'il a commenté.~~ **Close le 2026-08-12**
   (décision 355) : la correction existait depuis `CRM-022` et n'avait pas été constatée.
2. ~~**INC-085 / INC-075** — la politique de lecture des tracks s'élargit.~~ **Closes le 2026-08-12**
   (décision 333 livrée) : `CRM-012` passe `[x]`, preuve d'interface comprise.
3. **INC-072** — la suppression d'un commentaire ouverte aux `admin`, auditée, sans la modification.
   **C'est le terme restant.**
4. Le **lot documentaire** — INC-017, INC-019, INC-069 —, puis les mises en œuvre par unité porteuse.

Le lot documentaire vient **après** les défauts réels, et non avant : il est le moins cher et ne
répare rien. Les entrées de la section 1, arbitrées le 2026-08-13, s'intercalent selon ce même
principe : **INC-096 d'abord**, puisqu'elle rend toute preuve de pile inexécutable et qu'aucune des
autres ne peut être prouvée avant elle ; puis INC-091/092 et INC-094, qui rendent deux harnais de
nouveau lisibles ; puis INC-072, INC-095, et la garde d'INC-089/097.

## 4. Annexe — correspondance de la récupération de `claude/happy-goldberg-qt5vfi`

**Fusionnée ici le 2026-08-15**, depuis l'ancien document séparé `docs/ARBITRAGES_RECUPERES.md`.
Cette annexe est une **table de correspondance** : le texte des décisions n'est pas ici, il est
dans `docs/JOURNAL.md`, à sa place, sous une numérotation neuve.

### Ce qui s'est passé

Quarante et une branches `claude/happy-goldberg-*` ont été poussées sur `origin` en violation de
`CLAUDE.md` §13, qui interdit toute création de branche. Elles ont été supprimées — inventaire dans
`docs/BRANCHES_SUPPRIMEES.md`. Quarante ne portaient que des réimplémentations parallèles d'unités
que `main` porte déjà. Une seule, `claude/happy-goldberg-qt5vfi`, retenait **dix-huit décisions du
responsable que `main` n'avait jamais reçues**, dont **cinq arbitrages explicites**.

Ces dix-huit décisions sont **réinsérées dans `docs/JOURNAL.md`**, texte inchangé, sous les numéros
**249 à 266**.

### Pourquoi la renumérotation

Les deux lignes ont numéroté leurs décisions en parallèle : les numéros 235 à 252 désignaient des
sujets différents de chaque côté. Sur `main`, le numéro 239 traite de la boîte mail du `viewer` ;
sur la branche, il rattachait l'écran de connexion à `CRM-009`. Réinsérer sous les numéros d'origine
aurait écrasé des décisions de `main`. Les numéros d'origine sont conservés en tête de chaque
entrée réinsérée, et rappelés ci-dessous.

Les renvois internes à la série ont été décalés du même pas ; les renvois vers des décisions
antérieures à 235 — les décisions 8, 12, 180 et 234 — sont intacts.

### Correspondance

| N° d'origine | N° sur `main` | Sujet | Arbitrage du responsable |
|---|---|---|---|
| 235 | **249** | Stalwart 0.16 ne se configure plus par un fichier, et l'assemblage doit en tenir compte | — |
| 236 | **250** | Le plan ne déclare aucune écoute réseau, et c'est une contrainte mesurée | — |
| 237 | **251** | Le domaine des cards passe sous un TLD réservé avant d'être réellement délivré | — |
| 238 | **252** | Trois défauts trouvés en exécutant le harnais, et les trois étaient les miens | — |
| 239 | **253** | L'écran de connexion a son unité : `CRM-009` (arbitrage du responsable, INC-021) | **oui** |
| 240 | **254** | La session vit en `sessionStorage` (arbitrage du responsable, INC-022) | **oui** |
| 241 | **255** | Le secret de build du registre npm est câblé, et c'est une unité : `CRM-015` (arbitrage du responsable, INC-042) | **oui** |
| 242 | **256** | L'invitation est rattachée à `CRM-070` (arbitrage du responsable, INC-015) | **oui** |
| 243 | **257** | La garde de ports lit `/proc/net/tcp` en dernier recours (arbitrage du responsable, INC-044 et INC-079) | **oui** |
| 244 | **258** | La collision du numéro 180 est levée par un suffixe, jamais par une renumérotation | — |
| 245 | **259** | Une liste d'exemples du responsable n'est pas une spécification exhaustive | — |
| 246 | **260** | Les fonctions edge entrent au périmètre : la décision 12 est rouverte | — |
| 247 | **261** | L'ordonnancement passe à `pg_cron` : la décision 8 est renversée | — |
| 248 | **262** | `require_fields` devient une table de liaison : le modèle est corrigé, pas contourné | — |
| 249 | **263** | Changer le workflow d'un channel entier est un geste distinct : `change_channel_workflow` | — |
| 250 | **264** | Les gabarits d'emails sont servis, et une preuve d'email vérifie son contenu | — |
| 251 | **265** | Le chemin d'administration de GoTrue est encadré, pas accepté | — |
| 252 | **266** | La copie de workflow contre la surcharge : l'écart est confirmé | — |

### Trois décisions contredisent l'infrastructure livrée

Les décisions **249, 250 et 252** (origines 235, 236 et 238) décrivent un assemblage Stalwart que
`main` n'a pas adopté : `config.json` + `plan.json.template` et **aucune écoute déclarée**, là où
`main` livre `config.toml` + `provision.sh` et **cinq écoutes**. Elles citent en outre
`docs/SPEC-mail-dev-infra.md`, qui n'existe pas dans ce dépôt. La contradiction est consignée en
**INC-082** et **n'est pas résolue** : ni les décisions ni `stalwart/` ne sont modifiés.

### Ce qui reste dû

L'arbitrage **`require_fields` devient une table de liaison** (origine 248, désormais décision
**262**) est pris en charge par `CRM-018`. `docs/SCHEMA.md` et les spécifications décrivent la
relation à deux colonnes ; la migration 19, les appelants, le seed et les preuves sont écrits dans
le même changement. Sa fermeture reste conditionnée à la preuve froide exigée par l'unité. Le
suivi historique de la récupération demeure clos en **INC-081**, et l'écart de modèle en **INC-033**.

À l'inverse, l'unité de l'écran de connexion (décision 253) et la session en `sessionStorage`
(décision 254) sont **déjà appliquées** sur `main` par la décision 243 : seule leur trace manquait.
Les quinze autres entrées n'ont pas été mesurées une à une.
