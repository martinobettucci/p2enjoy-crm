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

## 1. Ce qui attend encore une décision

Sept entrées, toutes ouvertes après le 2026-08-11, n'ont **aucun arbitrage rendu**. Chacune nomme en
fin d'entrée ce qu'elle attend ; la colonne ci-dessous en donne la substance.

| Entrée | Question | Nature |
|---|---|---|
| **INC-089** | Faut-il réécrire le commit qui a mélangé deux sujets, et la sérialisation de la routine doit-elle devenir une garde **vérifiable dans le dépôt** plutôt qu'un réglage de planificateur ? | méthode de travail |
| **INC-091** | Comment une preuve qui dépose délibérément un message dans une boîte seedée coexiste-t-elle avec une veille permanente qui le relève ? | preuves ↔ `CRM-059` |
| **INC-092** | Même question de fond qu'INC-091, sur une seconde preuve rendue rouge par la même veille | preuves ↔ `CRM-059` |
| **INC-094** | Une seconde migration s'exécute sous `supabase_admin` et le contrôle n'en tolère qu'une : élargir le contrôle, restreindre la migration, ou nommer l'exception | migrations |
| **INC-095** | Trois migrations livrées manquent au contrat de déploiement ; à faire compléter par `CRM-053`, `CRM-056` et `CRM-059`, et à empêcher structurellement | contrat de déploiement |
| **INC-096** | Registre d'images injoignable : **action humaine hors dépôt** — identifiants Docker Hub ou miroir de registre. Rien à corriger ici | environnement |
| **INC-097** | Collision de numéros de décision, **troisième occurrence** : la cause n'est pas traitée. Un crochet doit-il refuser un numéro déjà pris, comme celui de la décision 358 refuse une branche ? | méthode de travail |

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
répare rien. Les six entrées de la section 1, ouvertes depuis cette décision, s'intercalent selon ce
même principe — INC-096 d'abord, puisqu'elle rend toute preuve de pile inexécutable.
