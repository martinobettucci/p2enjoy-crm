# Registre des contradictions et points ouverts

Consigne les contradictions, références manquantes et hypothèses non vérifiées relevées pendant
la conception ou l'implémentation. **Rien n'est résolu implicitement** : tant qu'un point est
ouvert, le comportement reste inchangé et l'arbitrage du responsable est sollicité lorsque la
correction dépasse la tâche autorisée.

Une entrée est close lorsque la décision est prise, consignée dans `docs/JOURNAL.md`, **et que son
comportement correctif est livré et prouvé** lorsqu'elle exige du code. La décision seule retire
l'attente d'arbitrage ; elle ne transforme pas une correction due en fait acquis.

## Ce document ne conserve que ce qui est ouvert

**Politique d'archivage, arrêtée le 2026-08-13 par le responsable.** Le texte intégral d'une entrée
close est **retiré de ce document** au lieu d'y rester. Le motif est mesuré : les entrées closes
occupaient plus de la moitié d'un fichier de plus de cinq mille lignes, relu au début de chaque
session, pour une information qui n'oriente plus aucun travail.

Rien n'est perdu, et c'est la condition qui rend le retrait acceptable :

- la **décision** vit dans `docs/JOURNAL.md`, numérotée, avec son motif ;
- la **règle** qui en découle vit dans la spécification concernée, `docs/SCHEMA.md`,
  `docs/DESIGN_SYSTEM.md` ou `docs/DAT.md` ;
- la **preuve** vit dans la Definition of Done de l'unité porteuse, dans `docs/BACKLOG.md` ;
- le **texte d'origine** — mesure, options écartées, contre-épreuves — reste intégralement lisible
  dans l'historique Git, qui est fait pour cela.

L'index ci-dessous garde une ligne par entrée close : de quoi la retrouver, savoir qui l'a fermée
et où lire la décision. **Une entrée n'est retirée qu'après vérification que sa décision et sa
preuve existent ailleurs** ; à défaut, elle reste ici en entier, close ou non.

**Arbitrage exhaustif du 2026-08-08.** Le responsable a délégué tous les choix suspendus. Les
décisions 292 à 299 et la matrice de `docs/ARBITRAGES.md` tranchent chaque entrée alors en attente.
Le texte historique de chaque entrée conserve la mesure et les options d'origine ; toute formule
« arbitrage attendu » y est l'état **au jour du constat**, pas une question encore adressée au
responsable. Les entrées **restent ouvertes jusqu'à leur mise en œuvre et leur preuve**.

**Solde d'arbitrage du 2026-08-11.** Les deux dernières entrées de la série 002 à 088 sans arbitrage
— **INC-085**, qui recouvrait **INC-075**, et **INC-088** — sont tranchées par les décisions **333**
et **334**. L'ordre de solde est fixé par la décision **336** : les défauts réels d'abord, le lot
documentaire ensuite.

**Solde d'arbitrage du 2026-08-13.** Les entrées ouvertes depuis — **INC-089**, **INC-091**,
**INC-092**, **INC-094**, **INC-095** et **INC-097** — sont tranchées par les décisions **362 à
365**. **INC-096** n'appelait pas un choix mais une action hors dépôt. **Aucune entrée de ce registre
n'attend donc une décision du responsable** : les cinquante-huit entrées ouvertes attendent toutes
une mise en œuvre et une preuve. `docs/ARBITRAGES.md` §1 et §2 en donnent les porteurs, §3 l'ordre.
**INC-098**, relevée le même jour, est tranchée dès son ouverture par la décision **366**.

**État au 2026-08-14 :** 102 entrées ouvertes depuis l'origine, **43 closes** — index ci-dessous,
texte dans l'historique Git — et **56 ouvertes**, conservées ici en entier : 56 après la clôture d'INC-096, plus INC-099 relevée le même jour, moins les QUATRE entrées du lot G — INC-048, INC-052 et INC-071 par la migration 35, **INC-072 par le geste d'interface de la décision 376** —, plus **INC-100** et **INC-101**, relevées le 2026-08-14 pendant la reprise d'INC-072 et laissées intactes parce qu'elles appartiennent à d'autres unités, plus **INC-102**, relevée le même jour en rejouant le seed puis les preuves sur une base montée AVANT la livraison du lot G. **Le lot G est intégralement soldé.** Les soixante et une
entrées de la décision 367 sont devenues soixante-deux avec INC-098, puis cinquante-huit avec la
clôture du lot D, cinquante-sept avec INC-091 (décision 371) et cinquante-six avec INC-096
(décision 373).

**Le lot A est soldé.** INC-096 exigeait « des identifiants Docker Hub ou un miroir de registre » :
le responsable a transmis un jeton d'accès personnel **hors dépôt** le 2026-08-14, et la décision
373 mesure en outre que le `429` venait pour partie des tirages **parallèles** de `docker compose`,
qu'un tirage séquentiel avec temporisation contourne. La contrainte de tête qui rendait « aucune
preuve de pile exécutable » ne s'applique plus, tant que l'exécution reçoit le jeton.

---

## Clos — index

Quarante-cinq entrées closes, texte retiré de ce document. Colonnes : ce que l'entrée constatait,
la date de clôture, l'unité ou la reprise qui l'a fermée, et la décision du journal à lire.

| Entrée | Objet | Close le | Fermée par | Décision |
|---|---|---|---|---|
| INC-001 | Disponibilité de `supabase_vault` et `pg_cron` non vérifiée | 2026-08-03 | `CRM-004` | 23, 24 |
| INC-003 | Transition « Réalisation → Perdu » non déclarée | 2026-08-09 | `CRM-005` | 259 |
| INC-005 | Écart assumé : copie de workflow contre surcharge | 2026-08-07 | confirmation, aucun code | 266 |
| INC-006 | Pile de référence `../starter.2025.12/` introuvable dans l'environnement | 2026-08-13 | confirmation du responsable, aucun code | 367 |
| INC-007 | `supabase/functions/` référencé sans composant correspondant | 2026-08-08 | `CRM-016` | 260 |
| INC-008 | Commandes `npm` annoncées sans `package.json` ; façade `npm` des scripts | 2026-08-13 | `README.md` §5, `docs/DAT.md` §13 | 38, 367 |
| INC-012 | Le motif principal de la décision 8 démenti par la mesure | 2026-08-09 | `CRM-017` | 8, 261 |
| INC-013 | Quatre fonctions d'autorisation dépendent de tables livrées deux chunks plus tard | 2026-08-05 | reprise `CRM-010` | 155, 156, 157 |
| INC-014 | Aucune unité ne nommait l'écriture des politiques RLS des tables d'identité | 2026-08-09 | `CRM-022` | 294 |
| INC-016 | Gabarits d'emails : chargement HTTP obligatoire, repli silencieux vers l'anglais | 2026-08-07 | `CRM-009` | 264 |
| INC-017 | `README.md` §11 annonçait non vérifié ce que `CRM-004` avait mesuré | 2026-08-13 | report constaté effectif | 23, 367 |
| INC-019 | Le bandeau d'état du `README.md` décrivait un dépôt dépassé par trois unités | 2026-08-13 | bandeau réécrit, relu à chaque livraison | 367 |
| INC-020 | La DoD de `CRM-006` exigeait le build d'une webapp livrée par l'unité suivante | 2026-08-04 | `CRM-007` | — |
| INC-021 | Aucune unité ne portait l'écran de connexion, que la DoD de `CRM-011` présuppose | 2026-08-07 | `CRM-009` | 253 |
| INC-022 | `docs/DAT.md` §3.1 se contredisait sur la persistance de session | 2026-08-07 | `CRM-009` | 254 |
| INC-023 | La DoD de `CRM-008` exigeait des commandes dont les sujets arrivent au chunk 4 | 2026-08-08 | `CRM-051`, `CRM-054` | 277 |
| INC-024 | La politique de lecture des tracks ignorait les droits fins | 2026-08-04 | `CRM-012` | — |
| INC-030 | La politique de lecture des channels ignorait les droits fins | 2026-08-04 | `CRM-012` | — |
| INC-032 | `./runDev.sh` ne démarrait pas à froid derrière un proxy TLS interposé | 2026-08-07 | `CRM-015` | 255, 280 |
| INC-042 | L'image de la webapp ne se construisait pas : registre npm derrière un proxy | 2026-08-07 | `CRM-015` | 255 |
| INC-044 | Sans `ss` ni `netstat`, la garde de ports était silencieusement inerte | 2026-08-07 | reprise `CRM-002` | 257 |
| INC-046 | Un channel occupé change de workflow par remappage atomique explicite | 2026-08-09 | `CRM-019` | 263 |
| INC-047 | La sixième vérification de `move_card` lisait une table livrée après elle | 2026-08-05 | `CRM-036`, par exécution | 123, 126 |
| INC-050 | Le §5.5 de `SPEC-workflow-engine` se contredisait sur `email_local_part` | 2026-08-05 | `CRM-013`, par exécution | 142 |
| INC-061 | `verify-cards.sh` mesurait `test:sql` avant de retirer son propre jeu d'essai | 2026-08-09 | `CRM-040` | 296 |
| INC-073 | Les gestes unitaire et pluriel sont deux fonctions distinctes | 2026-08-09 | `CRM-019` | 263, 306 |
| INC-075 | Un channel consenti par le backend inatteignable par la navigation — doublon d'INC-085 | 2026-08-12 | reprise `CRM-012` | 333 |
| INC-076 | Un compte devenait indestructible dès qu'il avait commenté | 2026-08-12 | `CRM-022`, prouvé par `CRM-045` | 336, 355 |
| INC-077 | Les changements de contexte n'étaient pas nommés dans le fil | 2026-08-09 | `CRM-019` | 232, 298, 306 |
| INC-078 | Quatre harnais du chunk 3 n'étaient inventoriés ni au README ni au DAT | 2026-08-09 | `CRM-019` | — |
| INC-079 | La console d'administration de Stalwart non installable dans la routine | 2026-08-07 | `CRM-050` | 245, 257 |
| INC-072 | La modération d'un commentaire : règle ouverte aux `admin` avec audit, puis GESTE livré dans l'écran | 2026-08-14 | `CRM-043` — décisions 374 (serveur) puis 376 (écran) | 194, 367, 374, 376 |
| INC-080 | Garde-fous du chunk 3 périmés ; le rejeu séquentiel n'était pas une mesure | 2026-08-09 | reprise des harnais | 296, 309 |
| INC-081 | Les décisions récupérées d'une branche supprimée, rattachées et livrées | 2026-08-09 | `CRM-016` à `CRM-019` | 243 |
| INC-083 | Vingt et un harnais autonomes contournaient la chaîne Node de `CRM-008` | 2026-08-07 | `CRM-008` | 278 |
| INC-084 | Parcours Chromium instable, et avertissements dans la sortie utilisateur | 2026-08-07 | `CRM-015` | — |
| INC-085 | Un channel rouvert sous un track fermé était lisible par l'API, inatteignable à l'écran | 2026-08-12 | reprise `CRM-012` | 333 |
| INC-086 | Tracks et channels sans aucune surface d'administration, sans porteur | 2026-08-12 | `CRM-075` | 332, 349 |
| INC-087 | L'identité sortante de Driss expédiait depuis une adresse refusée par le serveur | 2026-08-11 | `CRM-058` | — |
| INC-090 | `CRM-075` livrait un cinquième geste que son énoncé ne citait pas : le désarchivage | 2026-08-11 | énoncé corrigé, aucun code | 338, 339 |
| INC-091 | La veille permanente de `CRM-059` transformait tout envoi de preuve vers une boîte seedée en non classé permanent | 2026-08-14 | reprise de `resilience.spec.ts` et `infrastructure.spec.ts`, purge IMAP | 362, 370, 371 |
| INC-093 | Le contournement `pip_ca` de `mail-sync` n'était câblé par aucun fichier Compose | 2026-08-12 | `CRM-051` | 356 |
| INC-096 | Le registre d'images injoignable rendait toute preuve de pile inexécutable | 2026-08-14 | jeton Docker Hub fourni hors dépôt, et tirage séquentialisé | 369, 373 |
| INC-048 | `move_card` exigeait un motif qu'elle ne conservait nulle part | 2026-08-14 | reprise `CRM-034`, migration 35 | 367, 374 |
| INC-052 | « Un commentaire vide n'est pas un commentaire » ne refusait pas une tabulation | 2026-08-14 | reprise `CRM-034` et `CRM-036`, `app.btrim_blancs` | 367, 374 |
| INC-071 | Trois documents se contredisaient sur ce qu'il faut pour commenter une card | 2026-08-14 | énoncé de `CRM-043` aligné, aucun code | 192, 367, 374 |

---

## Ouverts

### INC-102 — Le seed ne peut PAS faire converger `…0d4` vers la modération sur une base déjà seedée, et il annonce pourtant sa convergence

**Nature :** convergence du seed impossible par construction sur une base antérieure, et **annoncée
comme acquise** ; la preuve `0017` de l'unité en rougit.
**Relevée le :** 2026-08-14, en rejouant le seed puis `npm run test:sql` sur une pile montée AVANT
la livraison d'INC-072, c'est-à-dire sur le chemin de mise à jour d'un poste existant.

**Le fait, MESURÉ.** La pile a été montée et seedée avec la version d'`apply-seed.sh` antérieure au
commit `80214c8`, qui retirait `…0d4` avec la **clé de service**. `auth.uid()` y étant nul, la base
porte donc :

```
id …0d4 | author_id …012 (Driss) | deleted_at renseignée | deleted_by NULL
```

Le seed a ensuite été rejoué avec la version livrée, celle qui retire `…0d4` avec le **jeton réel**
de l'administratrice. Sortie observée :

```
d4 déjà retiré : rien à faire (convergence par état)
```

et `deleted_by` vaut toujours `NULL`. La ligne d'information finale du même seed affirme pourtant :

```
Celui de la card c4 est retiré par un TIERS : deleted_by diffère d'author_id (INC-072, décision 376)
```

**Ce qui en rougit.** `npm run test:sql` sur cette base, code courant, base sans autre résidu :

```
ECHEC supabase/tests/0017_commentaires.test.sql — 1 assertion(s) en échec sur 98
  not ok 81 - …et il a été retiré par CAMILLE AUBERT, qui n'en est pas l'auteur
      have: NULL
      want: 5eed0000-0000-4000-8000-000000000011
```

et, dans `e2e/ui/commentaires-gestes.spec.ts`, le scénario « le commentaire retiré du seed se lit
comme tel dans le fil » échoue sur la même cause, à l'assertion `deleted_by === PROFIL_CAMILLE`.
**Les 32 autres suites pgTAP et les 7 autres scénarios du fichier sont verts** : le défaut est
strictement celui-ci.

**Pourquoi ce n'est PAS réparable par une écriture de plus.** La garde du seed est
`if [ "$etat_d4" = 'null' ]`, donc elle ne se déclenche que sur une ligne encore vivante. La lever
ne suffirait pas : le trigger `card_comments_avant_maj` lève `comment_deleted` sur **toute**
écriture visant une ligne déjà supprimée, quel que soit le rôle, `service_role` compris. La pierre
tombale est irréversible par conception (`docs/SPEC-cards.md` §13.4, et §13.13 point 6, qui la nomme
explicitement comme telle). Aucun `PATCH` ne peut donc porter `deleted_by` après coup.

**Ce que cela dit de plus gênant qu'une assertion rouge.** L'unité `CRM-043` lot G est close `[x]`
et INC-072 avec elle, sur la foi d'une preuve qui n'est verte que sur une base **recréée**. Or ni
`README.md`, ni `docs/SPEC-seed.md` §2.14, ni `docs/PROD_MIGRATIONS.md` n'indiquent qu'une base
antérieure doit être recréée pour que le seed tienne sa promesse. Un poste existant rejoue le seed,
le voit réussir, lit « retiré par un TIERS » — et sa suite `0017` est rouge sans que rien n'explique
pourquoi. C'est exactement le cas que `CLAUDE.md` §8 vise en demandant que le seed **démontre** ce
qu'il annonce.

**Ce qui n'est PAS tranché ici, et pourquoi.** Trois issues sont possibles, et elles n'ont pas le
même coût :

1. **supprimer physiquement `…0d4` puis le réinsérer** lorsque `deleted_at` est renseignée et
   `deleted_by` nulle, avant de le faire retirer par le jeton réel — `service_role` porte bien le
   privilège `DELETE` (migration `0015`, `grant all privileges`). La convergence redevient totale,
   au prix d'une destruction de ligne que le seed ne pratique nulle part ailleurs ;
2. **documenter la limite** — une base seedée avant `80214c8` doit être recréée — dans
   `docs/SPEC-seed.md` §2.14 et dans le contrat de déploiement, et laisser la garde telle quelle ;
3. **borner l'assertion 81** à une base fraîche, ce qui affaiblirait une preuve pour accommoder un
   état, et que ce registre ne recommande pas.

Le choix engage la doctrine de convergence du seed, qui appartient au responsable
(`docs/CloudWorker.md` §4.1 : une entrée qui attend un arbitrage ne se tranche pas soi-même).
**Comportement laissé rigoureusement inchangé**, statut de `CRM-043` non modifié : la preuve est
verte sur base fraîche, et l'écart mesuré ici porte sur le chemin de mise à jour.

### INC-101 — Les quatre garde-fous globaux de `scripts/verify-harness.sh` sont périmés, et personne ne l'avait mesuré

**Nature :** garde-fous figés non maintenus par les unités qui ont fait bouger les compteurs.
**Relevée le :** 2026-08-14, pendant la reprise de `CRM-043` (INC-072), au premier rejeu du harnais
global depuis plusieurs livraisons.

**Le fait, MESURÉ** — `./scripts/verify-harness.sh`, exécuté après la livraison d'INC-072, sur une
base sans résidu, avec Node 24 :

| Compteur figé | Valeur attendue | Valeur mesurée | Écart |
|---|---|---|---|
| `FICHIERS_SQL_ATTENDUS` | 31 | **33** | +2 fichiers |
| `ASSERTIONS_ATTENDUES` | 1921 | **1971** | +50 assertions |
| `SCENARIOS_API` | 504 | **507** | +3 scénarios |
| `SCENARIOS_UI` | 182 | **185** | +3 scénarios |
| `SCENARIOS_MAIL` | 41 | **42** | +1 scénario |

**Ce qui appartient à INC-072, et ce qui ne lui appartient pas.** La reprise d'INC-072 ajoute
**2 assertions** pgTAP — l'audit du seed — et **3 scénarios d'interface** — la modération. Tout le
reste de l'écart, soit **2 fichiers, 48 assertions, 3 scénarios d'API et 1 scénario de messagerie**,
vient de livraisons antérieures qui n'ont pas rejoué ce harnais. Le compteur d'API et celui de
messagerie étaient donc **déjà faux avant** cette session : `e2e:api` rendait 507 et `e2e:mail` 42
sur la LIGNE DE BASE, établie avant toute modification.

**Deux anomalies de plus, et elles ne sont pas de la même famille.** Les contrôles « `test:sql`
reste rouge après restauration » et « `e2e:api` reste rouge après restauration » ne mesurent pas une
restauration défaillante : le harnais exécute lui-même `e2e:ui`, donc
`e2e/ui/administration-arborescence.spec.ts`, qui laisse **deux tracks et deux channels** derrière
lui. C'est **INC-099**, constatée une seconde fois, dans un troisième harnais. Le nettoyage manuel
de ces quatre lignes suffit à rendre `test:sql` vert — **33 fichiers, 1971 assertions, aucune
anomalie** —, ce qui achève de démontrer que la cause est le résidu et non la restauration.

**Comportement laissé INCHANGÉ.** `scripts/verify-harness.sh` appartient à `CRM-008`, et ses cinq
compteurs sont des totaux de campagne : les réviser ici reviendrait à adopter les nombres de quatre
autres unités sans rejouer leurs preuves sous leur unité, ce que `docs/CloudWorker.md` §3.1
proscrit. Les compteurs propres à `CRM-043` ont été révisés, eux, dans
`scripts/verify-commentaires.sh` et dans le même changement que le code.

**Ce qu'il faut faire :** rejouer ce harnais sous `CRM-008` et réviser ses cinq constantes avec les
valeurs mesurées, **puis** solder INC-099, sans quoi les deux contrôles de restauration resteront
rouges au prochain rejeu quelle que soit la valeur des compteurs. L'ordre importe : réviser les
compteurs d'abord donnerait un harnais qui échoue encore, et le faire croire cassé.

**Leçon, et elle a un précédent exact.** INC-080 constatait déjà « garde-fous du chunk 3 périmés ».
Un compteur figé qui n'est pas rejoué à chaque livraison ne garde plus rien : il finit par n'être
qu'une valeur historique que la première exécution honnête rend rouge.

---

### INC-100 — Le chapitre 4.10 du manuel se contredit lui-même sur deux points déjà livrés

**Nature :** documentation utilisateur dépassée par le produit, contradiction interne au même
document. **Relevée le :** 2026-08-14, pendant la reprise de `CRM-043` (INC-072), en rédigeant le
chapitre voisin.

La liste « Ce que le fil ne fait pas encore » du §4.10 de `docs/manual.md` porte deux affirmations
que le produit dément, et que **le manuel lui-même dément ailleurs** :

| Affirmation du §4.10 | Ce que le produit fait | Ce que le manuel dit ailleurs |
|---|---|---|
| « **Aucun nom d'auteur n'est affiché** : aucun nom de personne n'est aujourd'hui lisible dans le produit » | `PanneauTimeline.tsx` rend le nom et l'avatar de l'auteur, par la relation embarquée livrée par `CRM-022` | §3.2 : « les commentaires leur auteur et les événements leur acteur lorsque cette identité est connue » |
| « **Le motif d'un déplacement n'est conservé nulle part.** L'écran le demande […] et il n'est enregistré ni dans le fil, ni ailleurs » | `move_card` conserve le motif dans `card_comments` depuis la migration `0035` (INC-048, décision 374) | §4.3 : « Le motif que vous donnez est conservé, et il l'est comme un commentaire » |

**Mesure.** Les deux lignes sont des restes : la première date d'avant `CRM-022`, la seconde d'avant
le lot G. Chacune a été corrigée dans **son** chapitre sans que la liste du §4.10 le soit.

**Comportement laissé INCHANGÉ, et rien n'est corrigé au passage.** Les deux affirmations
appartiennent à `CRM-022` et à `CRM-034` — ni l'une ni l'autre à INC-072, qui reprend le seul geste
de modération. Les corriger ici toucherait deux unités sans rejouer leurs preuves sous leur unité,
ce que `docs/CloudWorker.md` §3.1 proscrit. Le §4.10 a été modifié dans le même changement **sur
les seuls points de modération**, et ces deux lignes ont été laissées telles quelles.

**Ce qu'il faut faire :** retirer les deux affirmations de la liste du §4.10, sous l'unité qui les a
rendues fausses, et relire la liste entière au même moment — un inventaire de manques qui n'est pas
relu à chaque livraison devient un inventaire de mensonges.

---

### INC-099 — Les preuves d'arborescence laissent quatre lignes derrière elles, et sept assertions d'autres suites en rougissent

**Nature :** résidu d'une preuve dans une table partagée, qui rend rouge l'assertion de conformité
du seed d'une AUTRE suite. **Même famille qu'INC-091**, sur une autre table et un autre harnais.
**Relevé le :** 2026-08-14, pendant le lot G, sur une ligne de base établie AVANT toute modification.

**Le fait, mesuré, et la chronologie compte.** Sur cette exécution, `npm run test:sql` a été joué
**avant** toute modification du dépôt : **33 fichiers, 1944 assertions, aucune anomalie**. Puis
`npm run e2e:ui` a été joué, vert lui aussi (**182 passed**). Rejoué ensuite, `test:sql` rend
`0004_tracks.test.sql` **rouge sur deux assertions** :

```
not ok 75 - le seed pose quatre tracks dans le workspace de démonstration
        have: 6   want: 4
not ok 76 - l'un d'eux est archivé : l'état « archivé » est démontrable, pas seulement documenté
```

`public.tracks` porte alors six lignes au lieu de quatre :

```
5eed…0021 Conseil & IA      2026-08-14 14:52:56   (seed)
5eed…0022 Studio web        2026-08-14 14:52:56   (seed)
5eed…0023 Formation         2026-08-14 14:52:56   (seed)
5eed…0024 Pipeline 2024     2026-08-14 14:52:56   (seed, archivé)
2eb41de8… E2E Arbo Souris Renommé    2026-08-14 14:58:34   archivé
85577b88… E2E Arbo Clavier Renommé   2026-08-14 14:58:38   archivé
```

Les deux horodatages tombent pendant la fenêtre de `npm run e2e:ui`, et les noms sont ceux que
`e2e/ui/administration-arborescence.spec.ts` écrit en toutes lettres.

**LA MÊME CHOSE SUR `channels`, et elle coûte SIX assertions de plus.** Le constat initial ne
portait que sur `tracks`, parce que `test:sql` s'arrête là. `npm run e2e:api`, joué ensuite, a rendu
**sept** scénarios rouges, dont six sur le seul compte des channels :

```
✘ channels.spec.ts       le seed a posé six channels, dont un archivé, sur trois tracks
✘ channels.spec.ts       lignes c et d — admin lit les channels de son workspace
✘ channels.spec.ts       lignes c et d — business_developer lit les channels de son workspace
✘ channels.spec.ts       le viewer seedé ne voit que quatre channels
✘ coherence-workflow.spec.ts  six channels rattachés, un seul suivant un workflow de portée track
✘ workflows.spec.ts      INC-029 — les channels du seed sont tous rattachés
```

**ET DEUX CONTRÔLES DE PLUS SUR LE MANUEL.** `scripts/verify-manual.sh`, joué après une exécution
de `e2e:ui`, rend **107 contrôles, 2 anomalies** :

```
ECHEC annexe A : Tracks archivés — le manuel dit « 1 », la base dit « 3 »
ECHEC annexe A : Channels archivés — le manuel dit « 1 », la base dit « 3 »
```

Les quatre lignes résiduelles étant toutes **archivées** par leur scénario, elles gonflent
exactement les deux grandeurs archivées de l'annexe A. Sur une base nettoyée, le même harnais rend
**107 contrôles, aucune anomalie**. Le total des assertions que ce résidu fait rougir est donc de
**neuf**, réparties sur trois harnais distincts.

`public.channels` portait alors **huit** lignes : les six du seed, plus `E2E Canal Souris Renommé`
et `E2E Canal Clavier Renommé`, créées elles aussi pendant la fenêtre de `e2e:ui`. Quatre lignes
résiduelles au total — deux tracks et deux channels —, et la portée du défaut est donc **beaucoup
plus large** que ce que le premier constat laissait croire : ce n'est pas une assertion isolée,
c'est **l'ordre d'exécution des trois suites** qui décide de leur couleur.

**La cause, lue dans le fichier et non supposée.** Le scénario appelle bien `supprimerParSlug`,
mais **à l'entrée** — son commentaire le dit : « Nettoyage préalable : une exécution interrompue ne
doit pas faire échouer celle-ci sur un `23505` ». Il n'y a **aucun `finally`** qui retire la ligne
en sortie. Le scénario se termine par un désarchivage, puis un archivage, et la ligne reste. Deux
scénarios sont concernés — la variante souris et la variante clavier —, ce qui donne exactement les
deux lignes mesurées.

**Pourquoi ce n'est pas un défaut du produit, et pourquoi il faut quand même le traiter.** Aucune
règle métier n'est violée : un administrateur a le droit de créer un track. Ce qui est en cause est
la **propriété de la preuve** — `docs/SPEC-test-harness.md` et INC-055 posent qu'un harnais part
d'un état déterministe et le restaure. Un résidu qui survit rend rouge une assertion de conformité
du seed **écrite pour être exacte**, et l'ordre d'exécution des suites devient significatif : jouées
dans un sens, elles sont vertes ; dans l'autre, non. C'est précisément ce qu'INC-091 a coûté sur
`mail_messages`, et l'arbitrage rendu là-bas — « chaque preuve purge ce qu'elle dépose, dans son
propre `finally` » — s'énonce ici à l'identique.

**Comportement laissé inchangé, conformément à `CLAUDE.md` §5 et `docs/CloudWorker.md` §3.1.** Le
défaut est **étranger à l'unité de la session** (lot G, sur `card_comments` et `move_card`) : le
corriger au passage toucherait `CRM-075` sans rejouer ses preuves sous son unité. L'assertion de
`0004_tracks.test.sql` n'est **ni désarmée ni assouplie** : elle est le détecteur, exactement comme
l'assertion 9 de `0029` l'a été pour INC-091.

**Ce qui a été fait pour que les preuves du lot G restent lisibles.** Les quatre lignes résiduelles
ont été retirées de la base de développement par une suppression ciblée sur leurs deux identifiants,
geste d'exploitation sur un volume jetable, **consigné ici plutôt que tu**. Ce n'est pas une
correction : la prochaine exécution de `npm run e2e:ui` les recréera.

**Arbitrage attendu du responsable :** appliquer à `e2e/ui/administration-arborescence.spec.ts` la
règle déjà rendue pour INC-091 — purge dans un `finally`, quel que soit le sort du scénario —, et
décider si le contrôle doit être généralisé aux autres preuves qui écrivent dans des tables
partagées, ce qu'un harnais de non-complaisance saurait mesurer.

**REPRODUIT LE 2026-08-14, ET LA CAUSALITÉ CESSE D'ÊTRE UNE CHRONOLOGIE POUR DEVENIR UNE
CONTRE-ÉPREUVE** (décision 377). Le constat d'origine reposait sur l'**ordre** des exécutions : vert
avant, rouge après. Les deux sens ont cette fois été mesurés dans la même session, ce qui est une
preuve d'une autre nature.

1. `npm run test:sql` sur le seed frais, **avant** toute suite d'interface :
   **33 fichiers, 1971 assertions, aucune anomalie**.
2. `e2e:ui`, `e2e:api` puis `e2e:mail` joués. Rejoué, `test:sql` rend **deux** fichiers rouges —
   `0004_tracks.test.sql` (`have: 6 want: 4`, puis `have: 3 want: 1`) et
   `0029_inbox_globale.test.sql` (assertion 9, `have: 1 want: 0`, qui relève d'INC-091).
3. Les **cinq** lignes résiduelles ont été nommées une à une avant tout geste :

```
b4e4db5f… E2E Arbo Souris Renommé    17:21:38  archivé   (tracks)
302b1dcc… E2E Arbo Clavier Renommé   17:21:42  archivé   (tracks)
18b5cc4b… E2E Canal Souris Renommé                       (channels)
b5d62e6a… E2E Canal Clavier Renommé                      (channels)
dc2a14b2… AllerRetour1786727909608   17:18:32            (mail_messages, non classé)
```

4. Les cinq retirées, **sans qu'aucune assertion ni aucun fichier du dépôt ne soit touché**,
   `test:sql` rend de nouveau **1971 assertions, aucune anomalie**.

Le résidu rougit, son retrait verdit, et rien d'autre n'a changé entre les deux mesures : ce n'est
plus une corrélation d'horodatages. La prédiction de l'entrée — « la prochaine exécution de
`npm run e2e:ui` les recréera » — est **vérifiée pour la deuxième fois**, sur un conteneur neuf.

Le retrait des cinq lignes est, comme la fois précédente, un **geste d'exploitation sur un volume
jetable**, consigné ici et non une correction : le comportement du dépôt est laissé **inchangé**, le
défaut restant étranger à l'unité de la session (`CRM-043`). L'assertion de `0004_tracks.test.sql`
n'est **ni désarmée ni assouplie** : elle reste le détecteur. Le coût est désormais **récurrent et
mesuré à chaque exécution de la routine**, ce qui est l'argument le plus fort en faveur de
l'arbitrage attendu ci-dessus.

**Lié à :** INC-091 (même famille, table `mail_messages`), INC-055 et INC-057 (propriété et
autonomie des harnais), `CRM-075` (porteur du scénario), `CRM-020` (porteur de l'assertion rouge).

---

### INC-097 — Deux décisions du journal portent le même numéro 340, troisième collision du document

**Arbitrage rendu — `docs/JOURNAL.md`, décision 364.** **La cause est mécanisée** : `.githooks/pre-commit` refusera un numéro de décision déjà pris dans `docs/JOURNAL.md`, et une seconde exécution concurrente. L'option 1 d'INC-069 — abandonner le compteur global — est **explicitement écartée** : plus de trois cent soixante décisions sont citées par leur numéro, et un schéma mixte serait moins lisible que le défaut. L'entrée reste ouverte jusqu'à la livraison des deux refus et de leur preuve dans `scripts/verify-crochets-git.sh`.

**Nature :** collision d'identifiants dans un document dont les numéros servent de références
croisées. **Troisième occurrence**, après les deux décisions 180 (INC-069).
**Relevée le :** 2026-08-13, pendant le nettoyage du registre décidé par la décision 361.

**Le fait, mesuré.** `docs/JOURNAL.md` portait deux entrées « Décision 340 » :

| Position | Titre | Cité par |
|---|---|---|
| l. 10943 | L'attribution du commit `e373900` est corrigée par réécriture d'historique | **six fois** — `CHANGELOG.md`, `docs/JOURNAL.md` (trois renvois), ce registre (deux renvois) |
| dernière entrée | Vérifier la prémisse d'une preuve avant d'accuser le produit (`CRM-059`) | **jamais** |

La seconde est en outre écrite **après** la décision 359 : le compteur n'a pas été relu avant
l'écriture, exactement comme pour les deux décisions 180.

**Correction appliquée, et pourquoi elle ne contredit pas la décision 258.** La seconde entrée est
renumérotée en **360**. La règle d'INC-069 — suffixer `180 a` et `180 b` plutôt que renuméroter —
a pour seul motif de ne casser aucune référence, « puisque les deux sont citées ». Cette condition
n'est pas remplie ici : l'entrée renumérotée n'était citée nulle part, et le renvoi est vérifié
comme tel avant le geste. **Aucune référence n'est cassée**, et la note de renumérotation reste dans
l'entrée. Appliquer le suffixe aurait conservé une ambiguïté qu'aucune contrainte n'imposait.

**QUATRIÈME OCCURRENCE, le même jour, commise par la session qui venait d'écrire cette entrée.** La
décision **367** a d'abord été écrite sous le numéro **366**, pris une heure plus tôt par « Un
service sans consommateur n'est pas une réserve, c'est une dette » (retrait de Supavisor, INC-098).
La règle de la décision 360 a été appliquée — la 366 d'origine étant citée par `README.md`,
`docs/DAT.md`, `docs/PROD_MIGRATIONS.md`, `docs/BACKLOG.md` et ce registre, c'est la nouvelle qui a
été renumérotée —, mais le fait vaut d'être écrit sans être adouci : **une session qui venait de
documenter la cause l'a reproduite dans l'heure**, en relisant pourtant le compteur avant d'écrire.
Entre la lecture et l'écriture, une exécution concurrente avait pris le numéro. C'est exactement le
scénario que le verrou de la décision 364 doit rendre impossible, et c'est la démonstration que la
discipline humaine ou machinale ne suffit pas ici.

**Ce qui reste, et qui n'est pas corrigé ici :** la **cause**. Rien dans le dépôt n'empêche une
écriture de reprendre un numéro déjà pris. C'est le point 1 d'INC-069, toujours ouvert — soit les
décisions cessent d'être numérotées par un compteur global, soit une garde vérifie l'unicité avant
le commit, comme le crochet de la décision 358 le fait déjà pour la branche et l'identité. Un
crochet qui refuse un numéro de décision en double coûterait quelques lignes et fermerait
définitivement une famille de défauts qui en est à sa troisième occurrence.

**CINQUIÈME OCCURRENCE, relevée le 2026-08-14 : deux décisions 341.** Elle ne vient pas d'une
exécution concurrente, contrairement à la quatrième — elle dormait dans le document **depuis le
2026-08-12** sans que personne la voie, et c'est un fait nouveau sur la nature du défaut. Mesure :

| Position | Titre | Cité par |
|---|---|---|
| l. 10976 | La boucle de veille est un fil, sa décision est pure, et son intervalle a des bornes | **huit fois** — `veille.py`, `__main__.py`, `ingestion.py`, `test_veille.py`, `verify-mail-resilience.sh`, `CHANGELOG.md`, `SPEC-mail-subsystem.md` §20.10, `BACKLOG.md` l. 5780 |
| l. 12262 | Une preuve rouge mesurée sur une pile incomplète ne désigne pas encore un coupable | **une fois** — `BACKLOG.md` l. 5741 |

La règle de la décision 360 s'applique sans ambiguïté : la seconde est renumérotée en **368**, son
unique renvoi est mis à jour dans le même commit, et la note de renumérotation reste dans l'entrée.
**Aucune référence n'est cassée.** La collision d'origine avait été commise par la session du
2026-08-14 qui écrivait sa décision **sans relire le compteur** — le numéro 341 était pris depuis
trois jours.

**Ce que cette occurrence ajoute à l'entrée.** Les quatre premières pouvaient se lire comme un défaut
de concurrence ; celle-ci est un simple défaut de relecture, et elle est passée **inaperçue pendant
deux jours**. Le verrou d'exécution concurrente du lot C n'aurait donc **pas** suffi à l'arrêter :
seul le second refus — celui d'un numéro de décision **déjà pris** — l'aurait fait. C'est un argument
de plus pour livrer le lot C, et un avertissement sur ce qu'il faut en attendre : la garde doit porter
sur l'unicité du numéro, pas seulement sur la concurrence.

**Lié à :** INC-069 (les deux décisions 180, même défaut, arbitrage rendu par la décision 258),
INC-089 (exécutions concurrentes), INC-059, `docs/JOURNAL.md` décisions 258, 358, 361, 368 et 369.

---

### INC-095 — Le contrat de déploiement s'arrête à la migration 30, alors que le dépôt en compte 34

**Arbitrage rendu — `docs/JOURNAL.md`, décision 365.** **Les unités porteuses complètent leurs propres lignes** — `CRM-053`, `CRM-056`, `CRM-059` —, parce qu'objectif, dépendances et réversibilité ont été décidés par elles et ne se déduisent pas du SQL. **Un contrôle rejoint `scripts/verify-migrations.sh`** et refusera toute migration absente de `docs/PROD_MIGRATIONS.md`. Il est posé **avec** le contenu, dans le même changement, jamais avant : un harnais rouge en attendant reproduirait INC-094. L'entrée reste ouverte jusqu'aux quatre lignes et à la garde.

**Nature :** dérive du contrat de déploiement par rapport à l'état réel du dépôt — exactement ce que
`CLAUDE.md` §12 interdit en toutes lettres : « Ce fichier ne doit jamais dériver de l'état réel du
projet. »
**Relevé le :** 2026-08-12, en y inscrivant la migration `0034`.

**Le fait, mesuré.** Le tableau « Migrations en attente » de `docs/PROD_MIGRATIONS.md` décrit les
migrations 1 à 30. Le dépôt en contient **34**. Trois n'y ont **aucune ligne** :

| Fichier | Unité qui l'a livrée |
|---|---|
| `supabase/migrations/0031_resilience_envoi.sql` | `CRM-059` |
| `supabase/migrations/0032_reprise_rangement.sql` | `CRM-056` |
| `supabase/migrations/0033_quota_par_defaut.sql` | `CRM-053` (correctif, décision 347) |

**Pourquoi c'est grave, et pas seulement incomplet.** Ce document n'est pas un inventaire : c'est
**la consigne qu'un humain applique en production**, dans l'ordre indiqué, une transaction par
fichier. Trois migrations dépourvues d'objectif, de dépendances et de procédure de retour arrière
sont trois migrations qu'un opérateur appliquera **sans savoir ce qu'elles font ni comment les
annuler** — ou, pire, qu'il n'appliquera pas du tout, le tableau lui donnant à croire que le contrat
s'arrête à la 30. `0033` est précisément un correctif de données (`daily_quota`), le genre de
migration dont l'omission se paie en silence.

**Ce que ce constat fait, et ne fait pas.** Le tableau reçoit une ligne d'attente explicite couvrant
`0031` à `0033`, qui **nomme le trou plutôt que de le laisser invisible** et interdit leur
application tant qu'il n'est pas comblé. Le contenu réel de ces trois lignes n'est pas rédigé ici :
décrire l'objectif, les dépendances et surtout le **retour arrière** d'une migration qu'on n'a pas
livrée, c'est deviner — et un retour arrière deviné est plus dangereux qu'un retour arrière absent,
puisqu'il inspire confiance.

**Action attendue du responsable :** faire compléter les trois lignes par les unités qui ont livré
ces migrations — `CRM-059`, `CRM-056` et `CRM-053` —, chacune connaissant son objectif et sa
réversibilité. Et, la cause étant systémique, décider si la Definition of Done doit être **contrôlée
mécaniquement** : un harnais qui compare `supabase/migrations/*.sql` aux lignes du tableau et rougit
sur tout écart aurait empêché les trois omissions, là où la règle écrite ne l'a pas fait.

**Lié à :** `CLAUDE.md` §12 et §24, `CRM-059`, `CRM-056`, `CRM-053`, INC-094 (même famille : un
invariant énoncé quelque part, et rien qui le vérifie).

---

### INC-094 — Une seconde migration s'exécute sous `supabase_admin`, et le contrôle qui n'en tolère qu'une n'a pas suivi

**Arbitrage rendu — `docs/JOURNAL.md`, décision 363.** **Option 3 : la justification obligatoire.** Toute migration portant `-- @migration-role:` cite son motif mesuré en en-tête, et le harnais contrôle la présence de cette justification au lieu d'énumérer les fichiers autorisés. L'arbitrage ne crée pas une exigence : `0018` et `0029` portent déjà la leur, il **promeut en règle une pratique tenue**. Limite dite : le contrôle vérifie qu'un motif est écrit, jamais qu'il est vrai. Mise en œuvre : `scripts/verify-scripts.sh` et la convention dans `docs/SCHEMA.md`.

**Nature :** dérive entre une migration livrée et prouvée, et le harnais qui énonce l'invariant la
concernant. Le harnais est donc rouge **en permanence** depuis la livraison, et l'invariant qu'il
défend n'est plus celui du produit.
**Relevé le :** 2026-08-12, en établissant la ligne de base de `scripts/verify-scripts.sh` avant la
correction d'INC-093.

**Le fait, mesuré.** `scripts/verify-scripts.sh` (ligne 621) énonce que **`0018_pg_cron.sql` est la
seule** migration portant un marqueur d'élévation, par une comparaison de chaîne exacte :

```sh
role_markers=$(grep -l '^-- @migration-role:' supabase/migrations/*.sql)
if [ "$role_markers" = supabase/migrations/0018_pg_cron.sql ] && …
```

Or elles sont **deux** :

```
supabase/migrations/0018_pg_cron.sql
supabase/migrations/0029_pieces_jointes_telechargeables.sql
```

`0029` porte `-- @migration-role: supabase_admin` **à dessein**, et son en-tête le justifie par une
mesure : `storage.objects` appartient à `supabase_storage_admin`, dont `postgres` n'est pas membre,
si bien que seul un superutilisateur peut y créer une politique (`CRM-057`, décision 327,
`docs/SPEC-mail-subsystem.md` §18.5). La migration n'est donc pas en cause ; c'est l'invariant du
harnais qui a cessé d'être vrai sans que personne ne le reformule.

**Conséquence, et c'est elle qui compte.** Le contrôle rend `ECHEC` à chaque exécution depuis
`CRM-057`. Un harnais durablement rouge cesse d'être lu : il ne défend plus rien, et il masque
l'anomalie suivante qui s'ajouterait au même bilan. La ligne de base de cette session le confirme —
**104 vérifications, 3 anomalies**, identiques avant et après un changement qui ne touche ni les
migrations ni ce contrôle.

**Ce que cette entrée ne fait pas, et pourquoi.** Elle ne modifie ni le harnais, ni `0029`. La
correction n'est pas mécanique : elle demande de choisir **quel invariant le produit veut tenir**,
et ce choix n'appartient pas à l'agent.

1. **Une liste close, tenue à jour.** Le contrôle énumère les migrations autorisées à s'élever, et
   toute nouvelle élévation devient un changement délibéré du harnais. Le plus strict ; c'est
   l'intention d'origine, et elle vient de coûter une régression silencieuse.
2. **Une règle plutôt qu'une liste.** Le contrôle vérifie que tout marqueur présent vaut exactement
   `supabase_admin` et qu'aucun autre rôle n'apparaît, sans énumérer les fichiers. Robuste à
   l'ajout légitime, mais il cesse d'alerter quand une migration s'élève sans nécessité.
3. **Une justification obligatoire.** Toute migration élevée doit citer son motif mesuré en en-tête,
   contrôlé par le harnais. Le plus fidèle à l'esprit du dépôt, le plus coûteux à écrire.

**Action attendue du responsable :** trancher entre ces trois options. Tant qu'elle n'est pas prise,
le comportement reste celui qui est mesuré ci-dessus, et l'anomalie est nommée dans la ligne de base
plutôt que corrigée au passage.

**Lié à :** `CRM-057`, `CRM-017`, décision 327, `docs/SPEC-mail-subsystem.md` §18.5, INC-083 et
INC-093 (même famille : un correctif ou un invariant dont la portée n'a pas suivi ses appelants).

---

### INC-092 — La même veille permanente fait aussi rougir `mail-sync.spec.ts` S3 sur un échec ATTENDU d'une autre preuve

**Arbitrage rendu — `docs/JOURNAL.md`, décision 362**, avec INC-091 : **chaque preuve purge par IMAP ce qu'elle a déposé**, dans son propre `finally`. L'entrée reste ouverte jusqu'à la reprise des deux fichiers et à sa contre-épreuve.

**Nature :** même famille qu'INC-091 — la veille continue de `CRM-059` interagit avec une preuve
antérieure qui ne l'anticipait pas —, mais la manifestation diffère : ici, un journal, pas une
donnée.
**Relevé le :** 2026-08-12, en rejouant `npm run e2e:mail` en boucle pour vérifier la décision 351.

**Le fait.** `e2e/mail/mail-sync.spec.ts` S3 exige qu'AUCUNE ligne du journal du conteneur, depuis
son tout premier démarrage, ne porte `WARNING`. `e2e/mail/comptes-entrants.spec.ts` (`CRM-052`)
positionne DÉLIBÉRÉMENT un mot de passe faux sur le compte entrant de Driss, le temps de prouver
que le test de connexion rend `auth_failed` (§13.7) — puis le restaure. Si la veille (§20.10) relève
ce même compte PENDANT cette fenêtre, l'échec est réel, absorbé comme prévu, et journalisé en
`WARNING` (`veille_compte_echoue`) — un comportement CORRECT du service, que S3 confond avec une
anomalie parce qu'il ne distingue pas « le service a bien réagi à une panne réelle qu'un autre
scénario a délibérément provoquée » de « le service est en défaut ». Mesuré intermittent : rouge
une fois sur plusieurs rejeux de la suite complète, jamais en isolant `mail-sync.spec.ts` seul.

**Ce que cette entrée ne fait pas.** Elle ne modifie ni `mail-sync.spec.ts`, ni
`comptes-entrants.spec.ts` : choisir entre suspendre la veille pendant ce scénario, filtrer S3 sur
les seuls événements qu'il connaît par avance, ou autre chose, est un choix de conception qui
dépasse le dernier écart de `CRM-059` — objet de la présente session.

**Action attendue du responsable :** trancher, avec INC-091, la même question de fond : comment les
preuves qui provoquent une panne ou une pollution DÉLIBÉRÉE sur un compte seedé doivent coexister
avec une veille qui, depuis `CRM-059`, ne s'arrête jamais.

**MESURE DU 2026-08-14, ET POURQUOI L'ENTRÉE RESTE OUVERTE ALORS QU'INC-091 SE FERME.** La purge
IMAP livrée pour INC-091 (décision 371) **ne traite pas ce défaut-ci**, et il faut le dire
explicitement plutôt que de laisser croire que le lot B est soldé : INC-091 était une **donnée**
laissée dans une boîte, qu'une purge retire ; INC-092 est un **journal**, produit par une panne
d'authentification réelle et délibérée que `comptes-entrants.spec.ts` provoque, et qu'aucune purge
n'empêche. Le mot de passe faux sera toujours posé, la veille pourra toujours tomber dessus, et le
`WARNING` restera légitime.

`npm run e2e:mail` a été rejouée **trois fois** ce jour, suite complète, **42 scénarios verts à
chaque passage**, S3 compris. **Ce n'est pas une preuve que le défaut est corrigé** — l'entrée le
qualifiait déjà d'intermittent, « rouge une fois sur plusieurs rejeux » —, seulement la mesure que
la fenêtre de course ne s'est pas ouverte sur ces trois exécutions. La question de conception reste
entière et appartient toujours au responsable.

**LA FENÊTRE S'EST ROUVERTE LE 2026-08-14, ET LA PRUDENCE DE LA MESURE PRÉCÉDENTE EST JUSTIFIÉE**
(décision 377). Sur un conteneur neuf, `npm run e2e:mail` rend **41 passés, 1 échec**, et l'échec est
exactement S3 :

```
Expected value: "WARNING"     Received array: ["DEBUG", "INFO"]
e2e/mail/mail-sync.spec.ts:221
```

Le journal du conteneur porte **une seule** ligne `WARNING`, et c'est celle que l'entrée décrit :

```
{"timestamp":"2026-08-14T17:20:15.145Z","level":"WARNING","service":"mail-sync","event":"veille_compte_echoue"}
```

Un seul événement, `veille_compte_echoue`, dans la fenêtre où `comptes-entrants.spec.ts` pose
délibérément un mot de passe faux sur le compte entrant de Driss. **Le service a réagi correctement
à une panne réelle qu'une autre preuve a provoquée** ; c'est S3 qui ne sait pas distinguer les deux.
Trois passages verts n'avaient donc rien prouvé quant à la correction, comme la mesure du 2026-08-14
le disait elle-même — et ce passage rouge, sur la même journée et un autre conteneur, en donne la
démonstration.

Rien n'est modifié : ni `mail-sync.spec.ts`, ni `comptes-entrants.spec.ts`, ni la veille. Le choix —
suspendre la veille pendant ce scénario, restreindre S3 aux événements qu'il connaît par avance, ou
autre chose — reste un **arbitrage du responsable**, et il est désormais adossé à une occurrence
rouge datée plutôt qu'à un souvenir.

---

### INC-089 — Une exécution concurrente de la routine a committé le travail d'une autre, sous son propre message

**Arbitrage rendu — `docs/JOURNAL.md`, décision 364.** **La sérialisation devient une garde vérifiable dans le dépôt** : `.githooks/pre-commit` refusera une seconde exécution concurrente, par un verrou daté avec expiration, et un numéro de décision déjà pris. La question de la réécriture de `d7b35d5` est **éteinte par les faits** — la décision 359 a réécrit l'historique sur instruction explicite du responsable, et le commit porte un autre identifiant. Seule la garde restait due ; l'entrée reste ouverte jusqu'à sa livraison et sa preuve.

**Nature :** violation mesurée de `CLAUDE.md` §13 — « un commit ne doit contenir que des
modifications liées » — par le mécanisme d'exécution lui-même, et non par une décision de rédaction.
**Relevé le :** 2026-08-11, pendant la persistance des décisions 333 à 336.

**Le fait, horodaté.** Les quatre décisions d'arbitrage et leurs mises à jour documentaires —
`docs/JOURNAL.md`, `docs/INCONSISTENCY_REPORT.md`, `docs/ARBITRAGES.md`, `docs/BACKLOG.md`,
`docs/MASTER_PLAN.md` — ont été écrites dans l'arbre de travail entre 16h40 et 16h57. À **16h58**,
une autre exécution de la routine a committé `d7b35d5` — « Mesure ce que la base garantit d'une
reprise, et pas seulement le service », dont l'objet réel est la suite pgTAP
`0031_resilience_envoi.test.sql` de `CRM-059`. Ce commit **emporte les cinq documents d'arbitrage**,
qui n'ont aucun rapport avec son sujet, et il est **poussé**.

| | Attendu | Constaté |
|---|---|---|
| Sujets par commit | un | **deux** : la résilience d'envoi de `CRM-059`, et les arbitrages 333 à 336 |
| Message | décrit le changement | ne mentionne **aucune** des quatre décisions qu'il contient |
| Traçabilité | un arbitrage se retrouve par son commit | les décisions 333 à 336 sont introuvables par le message |

**La cause.** L'exécution concurrente indexe l'arbre entier avant de committer, sans distinguer ce
qu'elle a écrit de ce qu'elle a trouvé. Ce n'est pas une erreur de jugement : c'est le même défaut
qu'**INC-059** — deux exécutions ayant livré `CRM-014` en parallèle sans se voir — et que le point 1
d'**INC-034**, dont la décision retenue est « **une routine séquentielle sur `main`** ». La
sérialisation est décidée depuis le 2026-08-08 ; elle est **hors dépôt**, portée par le
planificateur, et cette entrée mesure qu'elle n'est **pas appliquée**.

**Ce que cela n'est pas.** Aucun contenu n'est perdu ni altéré : les quatre décisions sont intactes
dans `d7b35d5`, et les documents disent ce qu'ils doivent dire. Le défaut porte sur la
**traçabilité** et sur l'atomicité du commit, pas sur l'exactitude.

**Comportement laissé inchangé.** L'historique poussé n'est pas réécrit : `CLAUDE.md` §13 réserve
cette correction à une instruction explicite du responsable. Le rattachement est fait ici, par le
registre, plutôt qu'en silence.

**Action attendue du responsable :** dire si `d7b35d5` doit être réécrit pour séparer les deux
sujets — ce qui suppose une réécriture d'historique déjà poussé —, et surtout **si la sérialisation
de la routine, décidée depuis le 2026-08-08, doit devenir une garde vérifiable plutôt qu'un réglage
de planificateur**. Tant que ce n'est pas tranché, le défaut se reproduira à chaque chevauchement.

**Lié à :** INC-034 (point 1, la branche et l'identité imposées par l'environnement de la routine),
INC-059 (deux exécutions livrant la même unité en parallèle), INC-069 (deux décisions sous le numéro
180, née de la même cause), `CLAUDE.md` §13.

**OBSERVÉ DE NOUVEAU LE 2026-08-11, EN DIRECT, ET SANS DOMMAGE.** Deux exécutions ont travaillé sur
`main` dans la même heure sans se voir. La seconde a poussé `199aa6f` (« Corrige le cycle de
dépendances qui empêchait tout amorçage à froid de la pile ») entre deux poussées de la première.
Trois faits, tous vérifiés :

1. **Aucun conflit de contenu.** Les deux changements ne partagent aucun fichier hors
   `docs/JOURNAL.md`, et le `git pull --rebase` exigé par `CLAUDE.md` §13 a suffi. Les 235
   assertions pytest passent après rebase.
2. **La numérotation des décisions a tenu, mais de justesse.** L'exécution concurrente a lu le
   journal après la décision 342 et a correctement numéroté la sienne **343** — mais son **message
   de commit** cite « décision 342 », rédigé avant de relire le fichier. La trace du dépôt est donc
   correcte ; la référence du message est périmée. C'est le même mode de défaillance qu'INC-069,
   arrêté cette fois par le fichier plutôt que par une convention.
3. **L'attribution fautive s'est reproduite.** `199aa6f` porte `Claude <noreply@anthropic.com>`,
   alors que la décision 340 venait de corriger exactement cela sur `e373900` une heure plus tôt.
   C'est la preuve directe que la correction d'historique ne suffit pas : **seul le crochet
   `pre-commit` nommé par la décision 340 empêcherait la récidive**, et il n'appartient toujours à
   aucune unité. Ce commit n'est PAS réécrit : il appartient à une exécution concurrente, et une
   réécriture d'historique pendant qu'une autre session pousse détruirait son travail.

**Ce que cela change pour l'arbitrage en cours.** Le responsable a autorisé la réécriture de
`e373900` en déclarant être **seul sur `main`**. Cette observation montre que la branche est en
réalité partagée avec d'autres exécutions planifiées. La réécriture du 2026-08-11 est passée sans
dommage — elle précède `199aa6f` d'une heure —, mais **toute réécriture ultérieure doit être
considérée comme dangereuse** tant que ces exécutions ne sont pas sérialisées.

---

### INC-088 — La fiche d'une card reste en lecture seule au nom d'une entrée close

**Arbitrage rendu — `docs/JOURNAL.md`, décision 334.** **L'écriture depuis la fiche rejoint `CRM-037`**, dont la Definition of Done exige déjà « E2E (transition bloquée, **saisie**, transition réussie) » : l'unité n'est pas élargie, elle est ramenée à son énoncé. Aucune unité n'est créée, aucune règle n'est inventée — `CRM-036` livre déjà la table, ses politiques et sa validation. Règle générale posée par la même décision : **toute limite qui cite une entrée du registre est réexaminée le jour où cette entrée est close**, dans le même changement que la clôture. L'entrée reste ouverte jusqu'à la livraison et la preuve.

**Nature :** limite dont le motif invoqué a disparu, sans que la limite soit levée.
**Relevé le :** 2026-08-11, en même temps que l'arbitrage d'INC-086 et pour la même cause — l'essai
du produit par le responsable.

**Ce qui est constaté à l'écran.** La fiche d'une affaire affiche « Consultation seule :
l'enregistrement des réponses n'est pas encore livré dans cette fiche », et aucun champ n'y est
saisissable.

**Ce que le backlog en dit.** `CRM-037` porte la limite « **Aucune écriture depuis l'écran** (§4.7),
donc aucune preuve de saisie. **Relève d'INC-021.** »

**La contradiction.** INC-021 — l'absence de session — est **close depuis `CRM-009`** : l'écran
authentifie, la session est restaurée, et `CRM-043` publie des commentaires avec elle. Le motif
invoqué par `CRM-037` n'existe donc plus. La limite, elle, subsiste, et personne ne l'a réexaminée.

**Ce n'est pas la même chose qu'INC-086.** Là-bas, aucune unité ne portait le geste. Ici, l'unité
existe (`CRM-036` livre `card_field_values`, ses politiques et sa validation ; `CRM-037` livre le
rendu), et c'est leur jonction — l'écriture depuis l'écran — qui n'appartient à personne.

**Ce que cela coûte à l'utilisateur** : un formulaire conditionnel complet, validé, prouvé côté
base, qu'aucun utilisateur ne peut remplir. C'est la fonction centrale du produit.

**Action attendue du responsable :** dire si l'écriture depuis la fiche rejoint `CRM-037` — dont la
Definition of Done demande déjà « E2E (transition bloquée, **saisie**, transition réussie) », ce qui
la désigne implicitement — ou fait l'objet d'une unité propre. Tant que ce n'est pas tranché, le
comportement reste inchangé et la limite est nommée à l'écran plutôt que masquée.

---

### INC-082 — Trois décisions récupérées décrivent un assemblage Stalwart que `main` n'a pas

**Nature :** contradiction entre des décisions du responsable réinsérées et l'infrastructure
réellement livrée. **Aucune des deux n'est modifiée** tant que l'arbitrage n'est pas rendu.
**Relevé le :** 2026-08-07, pendant la passe de cohérence documentaire.

**Le fait.** Les décisions **249, 250 et 252** ont été rendues sur `claude/happy-goldberg-qt5vfi`,
dont la ligne de travail sur `CRM-050` a divergé de celle de `main`. Elles décrivent un assemblage
que `main` n'a pas adopté :

| Point | Décision récupérée | Ce que `main` livre |
|---|---|---|
| Configuration | `stalwart/config.json` monté en lecture seule + `stalwart/plan.json.template` appliqué par `stalwart-cli apply` (décision 249) | `stalwart/config.toml` + `stalwart/provision.sh` |
| Services d'assemblage | Deux conteneurs, `stalwart-plan` et `stalwart-init`, l'image du CLI étant *distroless* | Aucun ; provisionnement par script |
| Écoutes réseau | **Aucune** déclarée ; les sept écoutes par défaut suffisent, TLS implicite sur 993 et 465 (décision 250) | **Cinq écoutes déclarées** dans `config.toml` |
| Spécification citée | `docs/SPEC-mail-dev-infra.md` §9.1 et §9.8 | `docs/SPEC-mail-subsystem.md` §11 — le fichier cité **n'existe pas** dans ce dépôt |

**Ce qui n'est pas en cause.** Les constats de mesure portés par ces décisions restent
vraisemblablement valables quelle que soit la voie retenue, et méritent d'être confrontés à
l'assemblage de `main` plutôt que perdus :

- un `grep -q` en bout de tuyau sous `set -o pipefail` fait dire à un contrôle **l'inverse** de ce
  qu'il mesure (décision 252) — le harnais de `main` doit être relu sur ce motif ;
- une écoute Stalwart n'est liée qu'au **démarrage suivant** du serveur (décision 250) ;
- le port 25 annonce `STARTTLS` et **jamais** `AUTH` : toute expédition authentifiée passe par 465 ;
- `SEARCH HEADER Message-ID` rend zéro résultat sur `v0.16.16` alors que le message est bien dans
  l'`INBOX` — ce qui concernera `CRM-054`, dont le dédoublonnage repose sur le `Message-ID`.

**Arbitrage attendu du responsable.** Conserver l'assemblage de `main` et déclarer ces trois
décisions caduques sur leur volet *mise en œuvre* ; ou reprendre l'assemblage décidé. Dans les deux
cas, les quatre constats de mesure ci-dessus sont à vérifier contre le code réellement livré.

**En attendant :** rien n'est modifié dans `stalwart/`, et les décisions 249, 250 et 252 restent
dans `docs/JOURNAL.md` telles qu'elles ont été rendues.

---

### INC-074 — La convergence d'INC-035 ne sait pas exprimer une définition qui avance avec les migrations

**Nature :** limite structurelle d'un mécanisme du dépôt, mesurée.
**Relevée le :** 2026-08-06, pendant `CRM-045`, par le balayage de non-régression.

Le remède d'INC-035 — `converger_contrainte`, repris par les migrations 11, 13, 15, 16 et 17 —
REMPLACE une contrainte dont la définition diffère de celle que le fichier déclare. Il rend le
dépôt convergent, et non seulement idempotent : un objet altéré à la main est réparé au prochain
démarrage.

Il suppose en revanche qu'**un seul fichier fasse autorité** sur un objet donné. Dès que deux
migrations déclarent des définitions différentes de la même contrainte, le `migrations-runner` —
qui rejoue tout le répertoire dans l'ordre à chaque démarrage — les fait se contredire à chaque
passage. Le cas s'est présenté pour la première fois avec `CRM-045`, qui étend à neuf valeurs le
`CHECK` de `card_events` créé à huit par `CRM-044` :

```
ERROR: check constraint "card_events_type_check" of relation "card_events"
       is violated by some row
migrations-runner : code de sortie 3
```

**Ce qui rend le cas pernicieux :** sur une base NEUVE, les migrations tournent avant le seed, aucune
ligne n'existe, et le rétrécissement passe sans erreur. Le défaut n'apparaît qu'au **deuxième**
démarrage, ou sur toute base déjà seedée. Aucune suite pgTAP, aucune preuve d'API et aucun harnais
dédié ne pouvait le voir : tous s'exécutent contre une base déjà migrée.

**Comportement retenu pour ce cas — décision 219 :** l'autorité sur le vocabulaire passe à la
dernière migration qui l'étend. La 16 crée si absent, la 17 converge. Aucune garantie n'est perdue,
elle change de fichier. La correction est **locale**, et c'est pourquoi elle n'attend pas
d'arbitrage : la pile ne redémarrait plus.

**Ce qui reste à arbitrer, et qui dépasse cette unité.** La règle « la dernière migration qui étend
un objet en devient responsable » n'est écrite nulle part comme convention du dépôt. Elle est
tenue ici par des commentaires dans deux fichiers, et rien ne la vérifie. Trois issues :

1. **l'inscrire comme convention** dans `docs/SCHEMA.md` ou `docs/MASTER_PLAN.md` §3, et ajouter au
   harnais un contrôle qui dénonce deux migrations déclarant la même contrainte nommée ;
2. **doter le mécanisme d'une expression du cumul** — un helper qui ÉLARGIT une énumération au lieu
   de la remplacer —, ce qui traiterait les `CHECK` de vocabulaire mais pas les autres contraintes ;
3. **rejouer les migrations dans l'ordre inverse pour la convergence**, ce qui rendrait la dernière
   déclaration gagnante par construction — au prix d'un runner beaucoup moins lisible.

**Un contrôle manque, quelle que soit l'issue :** aucun harnais du dépôt ne rejoue le
`migrations-runner` **sur une base seedée**. `scripts/verify-authz.sh` le fait par effet de bord, et
c'est lui qui a trouvé ce défaut ; `scripts/verify-migrations.sh`, dont c'est pourtant l'objet, ne
l'a pas vu.

**Lié à :** INC-035 (la convergence des clés étrangères, dont ce mécanisme est né), INC-056 (un
défaut que seule une base froide pouvait révéler — celui-ci est l'exact symétrique : seule une base
CHAUDE le révèle), `docs/JOURNAL.md` décision 219.

---

### INC-070 — Le contrôle de textes en dur lit la queue d'un ternaire comme un nœud de texte

**Nature :** faux positif d'un contrôle du dépôt, reproductible.
**Relevé le :** 2026-08-05, pendant `CRM-042`.

`webapp/src/i18n/i18n.test.ts` interdit tout texte visible écrit en dur dans un composant
(`docs/DESIGN_SYSTEM.md` §10). Il repère les nœuds de texte d'un JSX par une expression régulière.
MESURÉ : l'affectation

```tsx
const etatVide = totalFiltre > 0 ? undefined : (
```

lui fait rendre le littéral `0 ? undefined : (` comme un texte visible, et le test **échoue**. Le
fragment n'est pas un texte : c'est la queue d'une condition, suivie d'une parenthèse ouvrante de
JSX.

Une observation voisine avait été portée par la seconde exécution de `CRM-041` puis écartée, au
motif qu'aucun fichier de `main` ne portait la forme incriminée — un autre motif, une signature
`=> Promise<…>` (`docs/JOURNAL.md`, décision 182). **Cette occurrence-ci est reproductible sur
`main`**, et le motif est différent.

**Comportement retenu : aucun changement du contrôle.** `CRM-042` a réécrit l'affectation en `if`,
qui est de toute façon la forme la plus lisible des deux, et le motif est écrit dans le code. Élargir
l'expression régulière d'un contrôle de qualité **sans mesure de ce qu'elle cesserait d'attraper**
serait affaiblir une garde pour accommoder une écriture : le contraire de ce que `CLAUDE.md` §18
demande.

**Ce qui reste à arbitrer :** le contrôle repose sur une expression régulière là où il faudrait un
analyseur de JSX. Le remplacer est une décision d'outillage, et son coût — une dépendance
d'analyse syntaxique — dépasse le périmètre d'une unité de chunk 3. Tant qu'il n'est pas rendu, la
règle pratique est : **pas de ternaire dont la branche est un fragment JSX ouvert par `(`** dans un
composant.

---

### INC-069 — Deux décisions du journal portent le même numéro 180

**Arbitrage rendu — `docs/JOURNAL.md`, décision 258.** **Suffixer les titres — `180 a` et `180 b` — et ne renuméroter ni l'une ni l'autre**, puisque les deux sont citées. La cause est traitée ailleurs : la routine est sérialisée.

**Nature :** collision d'identifiants dans un document dont les numéros servent de références
croisées.
**Relevé le :** 2026-08-05, au début de `CRM-042`, en rebasant sur `main`.

`docs/JOURNAL.md` porte **deux** entrées « Décision 180 » :

- « Une seconde exécution de la routine a livré `CRM-041` en parallèle, et elle abandonne son
  implémentation », poussée par le commit `16cb2ee` ;
- « `t` accepte des paramètres, parce que le §7.5 exige une phrase et interdit de la construire »,
  poussée par le commit `13da2b7`.

Les deux commits sont l'œuvre de **deux exécutions concurrentes de la même routine**, chacune ayant
lu le numéro le plus élevé avant que l'autre ne pousse le sien. C'est la conséquence directe
d'INC-059 et du point 1 d'INC-034 : rien dans le dépôt ne sérialise les exécutions, et le journal
est un fichier que toutes appendent par la fin.

**La collision n'est pas théorique** : `docs/BACKLOG.md` et `CHANGELOG.md` citent « décision 180 »
pour désigner l'écart au §7.5, tandis que `docs/JOURNAL.md` §`CRM-041` cite le même numéro pour
l'arbitrage des exécutions parallèles. Un lecteur qui suit la référence tombe sur l'une ou l'autre
selon l'ordre de lecture.

**Comportement retenu : aucun.** Renuméroter une entrée déjà poussée casserait les références qui
la citent, et les deux sont citées. `CRM-042` a **décalé ses propres décisions à 183–188** pour ne
pas aggraver la collision, et la consigne ici plutôt que de la résoudre implicitement.

**Ce qui reste à arbitrer :**

1. **La numérotation.** Soit les décisions cessent d'être numérotées par un compteur global —
   un identifiant dérivé de l'unité, `CRM-041/3` par exemple, ne collisionne pas —, soit la routine
   se resynchronise **immédiatement avant** d'écrire son numéro, ce qui réduit la fenêtre sans la
   fermer.
2. **Les deux entrées 180 elles-mêmes.** Les renuméroter suppose de reprendre les références de
   `docs/BACKLOG.md` et de `CHANGELOG.md` dans le même changement. C'est un geste sur du travail
   déjà poussé, qui relève du responsable.

---

### INC-068 — Les pastilles d'étiquettes sont prescrites par le design system et n'ont ni table ni unité

**Nature :** unité manquante ; un contenu d'interface prescrit sans porteur, ni côté schéma ni côté
backlog.
**Relevé le :** 2026-08-05, en relisant `CRM-041` contre le §5.1 du design system.

`docs/DESIGN_SYSTEM.md` §5.1 énumère depuis `CRM-000` le contenu d'une carte de card : « titre
(2 lignes maximum, ellipse), **pastilles d'étiquettes**, avatar du responsable, montant si
renseigné, indicateur de prochaine action, et pastille d'ancienneté dans l'étape ».

**Constat, mesuré sur le schéma et sur le backlog.** `docs/SCHEMA.md` ne déclare **aucune** table
d'étiquettes, `public.cards` ne porte aucune colonne qui en tienne lieu, et aucune unité de
`docs/MASTER_PLAN.md` §2 n'en porte — ni dans le chunk 3, ni dans le chunk 4, ni dans les extensions
du chunk 5. Le mot n'apparaît nulle part ailleurs dans le dépôt que dans cette énumération et dans
les deux endroits où `CRM-041` constate son absence.

**Ce que cela ne met pas en cause.** Rien du comportement livré : une carte sans étiquette est
complète au sens de tout ce que la donnée permet. Le manque est d'**affichage**, pas d'intégrité.

**Pourquoi c'est distinct de l'avatar du responsable, avec lequel le §7.4 le range.** L'avatar
manquait pour une raison d'accès, fermée depuis par `CRM-022` et INC-014 : la donnée existait. Les
étiquettes, elles, n'existent **nulle part** : ce n'est pas un droit de lecture qui manque, c'est un
modèle de données. Les deux ne se referment pas
par le même geste, et les ranger ensemble comme deux « absences » masque cette différence.

**Ce que `CRM-041` en a fait.** Elle a nommé l'absence au §7.4 de `docs/SPEC-workflow-engine.md` et
dans sa Definition of Done, ce qui est juste. Elle n'a pas relevé que la **prescription** du §5.1
reste sans porteur — c'est l'objet de cette entrée. La phrase du §5.1 est conservée intacte.

**Arbitrage attendu du responsable.** Trois options :

1. créer une unité « étiquettes » dans le chunk 5 — table, politiques d'accès, seed, et rendu sur la
   carte —, et lui rattacher la phrase ;
2. retirer les étiquettes du §5.1, en actant que la couleur du nœud et le libellé de colonne
   suffisent à qualifier une affaire ;
3. les remplacer par une donnée déjà présente que la carte pourrait afficher en pastille — la
   probabilité de l'étape, par exemple —, ce qui changerait l'intention du §5.1 et doit donc être
   décidé, non déduit.

**Lié à :** INC-066 (même motif : une règle d'interface sans porteur), INC-014 (l'avatar, motif
différent), `docs/DESIGN_SYSTEM.md` §5.1, `docs/SPEC-workflow-engine.md` §7.4.

---

### INC-067 — Trois sources décrivent `cards.amount` de deux façons, et le cumul du board dépend de celle qui a raison

**Nature :** contradiction entre deux déclarations du dépôt ; comportement inchangé.
**Relevé le :** 2026-08-05, pendant la vérification de `CRM-041`.

| Source | Ce qu'elle déclare |
|---|---|
| `webapp/src/lib/database.types.ts`, **engendré** | `amount: number \| null` |
| `e2e/api/cards.spec.ts` ligne 87, écrit à `CRM-040` | `amount: string \| null` |
| **la pile réelle, MESURÉE** | `{"amount":48000.00}` — un **nombre** JSON |

`GET /rest/v1/cards?select=id,amount&id=eq.…0000c1` avec le jeton réel de l'administratrice rend
`48000.00`, non `"48000.00"`. Le type engendré a donc raison, et la preuve d'API de `CRM-040` porte
une déclaration défensive que la pile ne justifie pas.

**Pourquoi cela cesse d'être anodin avec `CRM-041`.** `webapp/src/lib/board.ts` additionne les
montants d'une colonne sans conversion :

```ts
montant: avecMontant.reduce((total, card) => total + (card.amount ?? 0), 0),
```

En JavaScript, `0 + "48000.00"` rend `"048000.00"`. Si la représentation basculait un jour vers la
chaîne — changement de version de PostgREST, réglage de la pile, ou colonne migrée —, le cumul
**concaténerait en silence** et l'en-tête de colonne afficherait un nombre faux. Aucun test ne le
verrait : les preuves actuelles emploient des fixtures où `amount` est déjà un nombre.

**Ce qui n'est pas tranché.** Laquelle des deux déclarations doit être corrigée, et si la
représentation d'un `numeric` doit être **mesurée** plutôt que supposée. La question dépasse
`CRM-041` : elle touche `CRM-040` et toute lecture future d'une colonne `numeric`.
**Comportement inchangé, arbitrage demandé.**

**Options :**

1. corriger `e2e/api/cards.spec.ts` en `number | null` — la déclaration devient exacte, et la
   fragilité du cumul reste entière ;
2. convertir explicitement dans le cumul (`Number(card.amount)`), et écrire le motif — la garde
   tient les deux formes, au prix d'une conversion que la pile actuelle ne réclame pas ;
3. ajouter à `scripts/verify-cards.sh` un contrôle qui **mesure** la représentation rendue par la
   pile, de sorte qu'un basculement soit dénoncé au lieu d'être découvert sur un écran.

**Lié à :** `CRM-040` (`e2e/api/cards.spec.ts`), `CRM-041` (`webapp/src/lib/board.ts`, cumul du
§7.3), `docs/SPEC-types.md` (« un type ne garantit jamais une valeur »).

---

### INC-066 — L'éditeur de workflow est spécifié depuis `CRM-000` et n'est rattaché à aucune unité

**Nature :** unité manquante ; une règle du produit n'a aucun porteur.
**Relevé le :** 2026-08-05, pendant la spécification de `CRM-041`.

`docs/SPEC-workflow-engine.md` §7 énonce depuis `CRM-000` : « L'éditeur de workflow est réservé aux
administrateurs : sélection des nœuds, ordre, arêtes, surcharges, et champs de formulaire. » La
phrase décrit un **écran**, et elle prescrit une règle d'accès sur cet écran.

**Constat, mesuré sur le backlog et non supposé.** Sept unités ont livré la matière de cet éditeur
sans en livrer une ligne d'interface, et **chacune l'a nommé** dans sa Definition of Done :
`CRM-030` (catalogue de nœuds), `CRM-031` (workflows, étapes, transitions), `CRM-032` (copie vers un
track), `CRM-033` (cohérence workflow ↔ channel), `CRM-035` (définition des champs), `CRM-036`
(valeurs et validation), `CRM-037` (rendu du formulaire). Aucune unité `[ ]` de
`docs/MASTER_PLAN.md` §2 ne porte cet éditeur : `CRM-041` livre le board, `CRM-042` la vue liste,
`CRM-043` à `CRM-047` les commentaires, la timeline, le déplacement entre channels, le seed et le
manuel. Le chunk 5 ne le nomme pas davantage.

**Ce que cela ne met pas en cause.** Aucune règle d'autorisation ne manque côté serveur : les
politiques d'écriture des cinq tables concernées réservent déjà la modification aux administrateurs
du workspace, et elles sont prouvées hors interface. L'écran absent ne relâche rien ; il empêche
seulement qu'un administrateur configure son produit autrement que par l'API.

**Ce que `CRM-041` fait de cette phrase.** Rien. Elle est **conservée mot pour mot** au §7.13,
comme énoncé d'intention, et l'unité ne la livre pas. La retirer du document aurait effacé une
exigence du responsable ; la livrer aurait inventé un périmètre que personne n'a demandé.

**Arbitrage attendu du responsable.** Trois options :

1. créer une unité d'administration des workflows dans le chunk 5, et lui rattacher la phrase ;
2. acter que la configuration d'un workflow reste une opération d'**exploitation**, par l'API et la
   clé de service, et réécrire la phrase en ce sens — comme l'invitation l'est restée (INC-015) ;
3. rattacher l'éditeur à `CRM-042`, qui est la seule unité `[ ]` du chunk 3 touchant à une vue
   d'administration — au prix de gonfler une unité déjà large.

**Lié à :** INC-015 (l'invitation, même motif : une règle produit sans écran pour la porter),
INC-021 (aucun écran de connexion), `docs/SPEC-workflow-engine.md` §7.1 et §7.13.

---

### INC-065 — L'adresse d'une card nomme un track et un channel que rien ne confronte à la card

**Nature :** règle absente ; aucune spécification ne dit ce qu'une adresse incohérente doit rendre.
**Relevé le :** 2026-08-05, pendant la reprise de `CRM-037`.

`docs/SPEC-form-composer.md` §4.6 pose l'adresse `/tracks/:slugTrack/:slugChannel/cards/:idCard` et
précise que la card est désignée par son **identifiant**. C'est ce que fait le code : la requête
porte `id=eq.<idCard>` et `deleted_at=is.null`, et **rien d'autre**.

**Conséquence, structurelle et non hypothétique.** Les deux premiers segments ne sont confrontés à
rien. Une adresse formée du bon identifiant de card et d'un couple `(track, channel)` quelconque
rend le formulaire de cette card, sous les onglets de ce track-là. Le §4.6 bis, écrit pendant ce
passage, alimente désormais la barre d'onglets depuis `slugTrack` : l'incohérence devient
**visible** là où elle était seulement latente.

**Ce que cela ne met pas en cause.** Aucun droit n'est contourné : la card n'est rendue que si la
politique de lecture de `public.cards` la consent à l'appelant, et les channels affichés ne le sont
que si celle de `public.channels` les consent. Deux lectures autorisées mises côte à côte ne
donnent pas un accès de plus. Le défaut est de **cohérence d'affichage**, pas d'autorisation.

**Ce qui n'est pas su.** `docs/SPEC-cards.md` décrit le rattachement d'une card à son channel, mais
aucun chapitre ne dit ce qu'une **adresse** incohérente doit produire. Trois lectures se défendent,
et aucune n'est appliquée en silence :

1. **rediriger** vers l'adresse canonique de la card, déduite de son channel réel — le plus
   confortable, mais suppose que le rendu sache lire le channel de la card, ce qui n'est pas dans
   le périmètre de `CRM-037` ;
2. **refuser**, en rendant le même état « card introuvable » qu'un identifiant inconnu — cohérent
   avec la discrétion de `docs/SPEC-permissions-rls.md` §7, au prix d'une requête de plus ;
3. **tolérer**, en actant que les deux premiers segments ne sont qu'un contexte de navigation et
   n'ont aucune valeur d'assertion — ce que fait le code aujourd'hui, sans que ce soit écrit.

**Comportement retenu :** inchangé — l'option 3, de fait. Elle n'est pas *choisie* ici, elle est
*constatée*, et c'est la raison de cette entrée.

**Arbitrage attendu du responsable**, et rattachement de la correction à l'unité qui porte le
rattachement d'une card à son channel — `CRM-040`, ou `CRM-045` qui traite du déplacement d'une
card entre channels — plutôt qu'au rendu du formulaire.

**Lié à :** `docs/SPEC-form-composer.md` §4.6 et §4.6 bis, `docs/SPEC-cards.md`,
`docs/SPEC-permissions-rls.md` §7.

---

### INC-064 — Un contrôle de restitution comparant à `HEAD` peut exister dans d'autres harnais, et n'y a pas été cherché

**Nature :** défaut de méthode possiblement répliqué, non vérifié.
**Relevé le :** 2026-08-05, pendant la correction de `CRM-037`.

`scripts/verify-formulaire.sh` vérifiait qu'il avait bien restauré les fichiers qu'il dégrade en les
comparant à **`HEAD`** (`git diff --quiet`). Ce contrôle confond « non restauré » et « non encore
committé », et il est donc rouge pour tout travail en cours sur ces fichiers — c'est-à-dire à son
moment d'emploi. Corrigé pour ce harnais par une empreinte prise à l'entrée du script
(`docs/JOURNAL.md` décision 166).

**Ce qui n'est pas su.** Le dépôt compte vingt-quatre scripts `verify-*.sh`, dont plusieurs
pratiquent des dégradations volontaires et les restaurent. Aucun n'a été relu à ce titre pendant ce
passage : ce sont les livrables d'unités déjà closes ou en cours, et les reprendre ici les rouvrirait
(`CLAUDE.md` §13). **Le nombre de harnais concernés est inconnu, et il n'est pas supposé nul.**

**Comportement retenu :** aucun autre script n'est modifié.

**Arbitrage attendu :** une revue transverse des harnais sur ce point précis, rattachée à l'unité
d'outillage — `CRM-008` — plutôt qu'à l'unité fonctionnelle qui la traverse.

---

### INC-063 — Deux chapitres prescrivent `role="alert"` pour deux éléments différents du formulaire, et l'implémentation a tranché sans arbitrage

**Nature :** contradiction entre deux documents, résolue de fait par le code.
**Relevé le :** 2026-08-05, après la livraison de `CRM-037`.

Deux textes prescrivent `role="alert"`, et ils ne désignent pas le même élément :

- `docs/DESIGN_SYSTEM.md` §5.7 le pose sur **l'erreur** d'un champ — « Erreur en `--color-danger`
  avec icône, `role="alert"`, associée au champ par `aria-describedby` » ;
- `docs/SPEC-form-composer.md` §4.5, écrit pendant `CRM-037`, le pose sur le **message
  d'exigence** — « élément portant `role="alert"`, cité par l'`aria-describedby` du contrôle ».

La différence n'est pas de forme. `role="alert"` est une région live **assertive** : son contenu est
annoncé dès qu'il apparaît. Le message d'exigence — « Requis pour passer à *E* » — n'est pas une
erreur, c'est une explication permanente, rendue pour **chaque** champ exigé de l'étape. Appliqué à
la lettre du §4.5, il ferait annoncer autant de messages assertifs qu'il y a de champs exigés, au
**chargement** de l'écran. MESURÉ sur le seed : l'étape `signature` porte trois champs `required`,
donc trois annonces pour un écran qui n'a rien signalé.

**Ce que le code fait aujourd'hui, et qui n'est écrit nulle part.** `webapp/src/app/FormulaireCard.tsx`
sépare les deux : la mention d'exigence est un texte ordinaire (`requis-<clé>`), et `role="alert"`
ne porte que sur l'**alerte de champ manquant** (`alerte-<clé>`), qui n'apparaît que lorsque le
champ exigé est vide. C'est la lecture du §5.7, et elle est probablement la bonne — mais c'est une
**résolution implicite** du §4.5, que `CLAUDE.md` §5 proscrit, et elle n'est consignée dans aucun
document.

**Comportement retenu :** le code est **laissé inchangé**. Il est le plus défendable des deux, et le
modifier maintenant échangerait une contradiction non consignée contre une autre.

**Trois options d'arbitrage :**

1. **Corriger le §4.5 de `docs/SPEC-form-composer.md`** pour qu'il décrive ce que le code fait :
   `role="alert"` sur l'alerte de champ manquant, texte ordinaire pour la mention d'exigence ;
2. **Employer `role="status"`** (poli) pour la mention d'exigence, et conserver `role="alert"` pour
   l'alerte — la mention serait alors annoncée, mais sans interrompre ;
3. **Appliquer la lettre du §4.5** et l'assumer en le motivant dans le design system.

L'option 1 décrit l'existant et ne change aucun comportement ; elle **modifie une spécification déjà
committée**, ce qui appartient au responsable.

---

### INC-062 — La Definition of Done de `CRM-037` exige un parcours de transition que `CRM-041`, ordonnée après elle, est seule à pouvoir livrer

**Nature :** contradiction d'ordonnancement entre la Definition of Done de `CRM-037`
(`docs/BACKLOG.md`), `docs/SPEC-form-composer.md` §7.3 et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-05, pendant la spécification de `CRM-037`.

La Definition of Done de `CRM-037` exige « **E2E (transition bloquée, saisie, transition
réussie)** ». Ce parcours suppose trois choses, dont **aucune** n'appartient à cette unité :

1. une **session** — la webapp est un appelant anonyme, INC-021, arbitrage ouvert depuis le
   2026-08-04 ;
2. un **contrôle de transition** dans l'interface — le menu des transitions déclarées et le
   glisser-déposer sont l'objet de `CRM-041` (`docs/DESIGN_SYSTEM.md` §5.1) ;
3. une **écriture de valeur** depuis l'écran, qui exige elle aussi la session du point 1.

Or `docs/MASTER_PLAN.md` §2 place `CRM-041` **après** `CRM-037` — et cet ordre est justifié :
« le form composer s'appuie sur les étapes », et le board s'appuie sur la garde `move_card`. Il n'y
a pas d'erreur d'ordonnancement à corriger ; il y a une Definition of Done écrite en supposant un
écran que l'ordre du plan livre plus tard.

C'est le sixième cas du motif déjà relevé — INC-010 (clés étrangères), INC-013 (jointures
d'autorisation), INC-029 (une colonne), INC-031 (une cible d'archivage), INC-037 (des champs à
copier) : **une preuve dont l'objet n'existe pas encore**. La différence est qu'ici l'objet manquant
n'est pas une table mais un **geste d'interface**.

**Ce qui est mesuré, et qui n'est pas une supposition :** le seed porte neuf cards, sept étapes et
dix-sept règles de visibilité ; la card `…0000c6` est à `Prospection`, où `motif-perte` est
`hidden`, et porte pourtant une valeur pour ce champ. Le formulaire d'une étape et sa section
repliée sont donc **entièrement démontrables aujourd'hui**. Seule la **transition depuis l'écran**
ne l'est pas.

**Comportement retenu :** `CRM-037` livre le rendu, son écran hôte et ses preuves atteignables
(`docs/SPEC-form-composer.md` §7.3, second tableau), et **n'invente ni contrôle de transition, ni
parcours de connexion**. L'écart est nommé dans `docs/BACKLOG.md`, et l'unité reste `[~]`.

**Trois options d'arbitrage :**

1. **Déplacer cette exigence dans la Definition of Done de `CRM-041`**, l'unité qui livre le geste
   dont elle dépend, en la retirant de `CRM-037` ;
2. **La conserver dans `CRM-037`** et accepter que l'unité ne puisse passer `[x]` qu'après
   `CRM-041`, c'est-à-dire hors de son rang dans le plan ;
3. **Créer une unité de jonction** — par exemple `CRM-037b`, placée après `CRM-041` — qui porte le
   seul parcours « transition bloquée → saisie → transition réussie ».

**Action attendue du responsable :** trancher. L'option 1 a la préférence de rédaction — elle laisse
chaque preuve à l'unité qui livre son objet, et c'est le raisonnement déjà retenu pour INC-031 —
mais la décision ne revient pas à l'agent, et INC-021 conditionne les trois.

**Lié à :** INC-021 (aucun écran de connexion), INC-031 et INC-037 (le même motif sur d'autres
objets), INC-053 (`user` et `contact` non résolus, donc rendus bruts).

---

### INC-060 — `scripts/verify-migrations.sh` déclare vert un rejeu qu'il n'a pas attendu, et rend la main sur une base à moitié migrée

**Nature :** défaut d'outillage de vérification, mesuré ; aucun comportement du produit en cause.
**Relevé le :** 2026-08-05, pendant la reprise de `CRM-010`.

Deux harnais déclenchent le `migrations-runner` avec la même écriture :

```
docker compose … up -d migrations-runner
runner_code=$(docker inspect -f '{{.State.ExitCode}}' p2enjoy-migrations)
```

`docker compose up -d` **rend la main dès que le conteneur est démarré**, pas quand il a fini.
MESURÉ, immédiatement après l'appel :

```
docker inspect -f '{{.State.ExitCode}} {{.State.Status}}' p2enjoy-migrations
→ 0 running
```

Le `0` lu est celui de l'exécution **précédente**. Deux conséquences, toutes deux mesurées :

- **le contrôle est complaisant** : il annoncerait « code 0 » d'un rejeu encore en cours, ou sur le
  point d'échouer ;
- **le harnais rend la main sur une base intermédiaire.** Le runner rejoue le répertoire dans
  l'ordre ; entre la migration 3 et la migration 10, `tracks_lecture_membre` est revenue à sa forme
  de `CRM-003` — `app.is_workspace_member(workspace_id)` —, les droits fins de `CRM-012` cessant
  d'être appliqués. MESURÉ : `npm run test:sql` lancé dans cette fenêtre rend **trois assertions
  rouges** dans `supabase/tests/0011_droits_fins.test.sql`, dont la **preuve de refus n° 4**.

C'est ainsi que le défaut a été trouvé : par un rejeu de régression qui a échoué sans qu'aucun code
ait changé.

**Corrigé pour `scripts/verify-authz.sh`**, livrable de `CRM-010`, dans le même changement que cette
entrée : `docker compose run --rm migrations-runner` est **synchrone** et rend le code du rejeu qu'il
vient de lancer. Ce n'est pas une invention — c'est déjà le procédé de `scripts/verify-tracks.sh`.
Un contrôle de plus vérifie ensuite que la base est bien celle du répertoire **complet**, et non un
état intermédiaire.

**Non corrigé pour `scripts/verify-migrations.sh`**, livrable de `CRM-003`, unité `[x]`. La
correction est connue, tient en trois lignes, et est celle qui vient d'être appliquée à l'autre
harnais. Elle n'est pas appliquée ici parce que la porter reviendrait à modifier un livrable vérifié
d'une autre unité dans un commit qui n'en traite pas (`CLAUDE.md` §13), et à toucher ses 23 contrôles
sans les rejouer sous leur propre unité. **Le piège reste donc armé** : toute exécution de
`scripts/verify-migrations.sh` suivie immédiatement d'une autre mesure peut faire échouer cette
mesure sans qu'aucun code soit en cause.

**Arbitrage attendu du responsable.** Trois options :

1. appliquer la même correction à `scripts/verify-migrations.sh`, en rejouant les 23 contrôles de
   `CRM-003` dans le même changement ;
2. inscrire dans `docs/SPEC-test-harness.md` une règle générale — « un harnais ne déclenche jamais
   le runner sans l'attendre, et vérifie l'état final plutôt que le code d'un conteneur » — puis la
   faire appliquer à tous les harnais existants par une unité de dette dédiée ;
3. laisser en l'état et documenter que les harnais ne doivent pas être enchaînés sans attente.

**Lié à :** INC-055 (même famille : un harnais qui laisse la base dans un état que le runner ne
produit jamais), `docs/JOURNAL.md` décisions 108, 135 et 157.

---

### INC-059 — Deux exécutions de la routine ont livré `CRM-014` en parallèle, sans se voir

**Nature :** défaut d'exploitation de la routine d'avancement, mesuré ; aucune conséquence sur le
produit livré, une conséquence certaine sur le travail dépensé.
**Relevé le :** 2026-08-05, à la clôture d'une exécution de la routine.

**Ce qui a été mesuré.** Une exécution de la routine a démarré à 04:56 UTC, s'est resynchronisée —
`origin/main` valait alors `9a69350`, le commit documentaire de `CRM-014` —, a constaté que
l'unité suivante à traiter était `CRM-014`, et l'a implémentée : fichier consolidé de 37 scénarios,
harnais de non-complaisance, documentation, captures, commit local à 05:33. Au `git fetch` précédant
le `push`, `origin/main` valait `1364bf3` : **une autre exécution de la même routine avait livré
`CRM-014` à 05:06**, pendant ce temps.

Les deux livraisons sont indépendantes et concordantes sur le fond — mêmes sept preuves acquises,
mêmes cinq absences figées, et **la même réfutation** de la prédiction du §7.4, atteinte séparément.
La livraison poussée est la meilleure des deux : elle résout par une suite pgTAP d'inventaire ce que
la seconde avait conclu être impossible, à savoir faire échouer le harnais au **retrait** d'une
politique. La seconde exécution a donc abandonné son commit plutôt que de le pousser, et a vérifié
la première de façon indépendante — 26 contrôles verts sur un conteneur neuf.

**Pourquoi cela doit être consigné.** Le coût n'est pas nul et n'était pas détectable plus tôt :

- la resynchronisation d'ouverture, que les consignes de la routine imposent, **ne protège de
  rien** : elle mesure l'état du dépôt à un instant, et le travail dure une heure ;
- rien dans le dépôt ne signale qu'une unité est **en cours de traitement** par quelqu'un. Le
  marquage `[~]` de `docs/BACKLOG.md` désigne un travail *livré et insuffisamment vérifié*, pas un
  travail *en cours* — les deux exécutions ont donc lu le même `[ ]` sur `CRM-014` ;
- si la seconde exécution avait poussé sans refetch, ou avait poussé sur sa branche assignée sans
  regarder `main`, le dépôt porterait **deux implémentations concurrentes de la même unité**, sur
  des fichiers de même chemin.

**Comportement retenu :** la seconde exécution n'a **rien poussé** de sa version de `CRM-014`. Son
commit local `346a230` n'existe que dans le conteneur, qui est éphémère : il sera perdu, ce qui est
le résultat voulu pour un doublon.

**Action attendue du responsable :** trancher entre

1. **sérialiser la routine** — une seule exécution active à la fois, ce que le planificateur sait
   faire et qui supprime le problème à la racine ;
2. **poser un verrou dans le dépôt** — un marquage d'unité « prise » committé et poussé avant tout
   travail, ce qui déplace la course sur un fichier au lieu de la supprimer, mais la rend visible ;
3. **accepter la redondance** et écrire dans `docs/MASTER_PLAN.md` §1 la règle appliquée ici :
   refetch obligatoire avant `push`, et abandon du travail si l'unité a été livrée entre-temps.

**Lié à :** INC-034 (branche et identité imposées à la routine), `docs/MASTER_PLAN.md` §1,
`docs/BACKLOG.md` `CRM-014`.

---

### INC-058 — Une assertion pgTAP compte une donnée globale qu'un autre harnais fait varier pendant qu'il l'exécute

**Nature :** contradiction entre deux harnais de vérification ; aucun comportement du produit en
cause. L'assertion est livrée par `CRM-013`, le harnais qui la met en défaut par `CRM-040`.
**Relevé le :** 2026-08-05, pendant `CRM-014`, en rejouant les vingt et un harnais précédents.

`scripts/verify-cards.sh` échoue en mode **complet** — `45 contrôles, 1 en échec` — sur son
contrôle `npm run test:sql`. MESURÉ, en capturant la sortie de ce `npm run test:sql` :

```
ECHEC  supabase/tests/0015_colonnes_protegees.test.sql — 3 assertion(s) en échec sur 41
       not ok 33 - les neuf cards du seed sont intactes
       not ok 34 - et leurs neuf adresses ont toujours la forme générée
       not ok 35 - neuf adresses DISTINCTES
```

**La cause, mesurée et non déduite.** En échantillonnant `select count(*) from public.cards`
toutes les trois secondes pendant une exécution complète du harnais, le compte vaut **14** pendant
onze relevés, puis **9** pendant vingt-trois. `scripts/verify-cards.sh` crée cinq cards pour ses
propres preuves et les retire dans son `trap EXIT` — donc **après** sa section 10, qui est
précisément celle qui lance `npm run test:sql`. Les trois assertions de `CRM-013` comptent, elles,
neuf cards à l'échelle de la table entière. Elles ne peuvent donc **pas** être vertes à ce moment
précis, quelle que soit la qualité du produit.

**Ce n'est ni un défaut du produit, ni un défaut de mesure.** Les deux côtés sont défendables pris
isolément : un harnais a le droit de créer ses données avant de nettoyer, et une assertion a le
droit de vérifier que le seed est intact. C'est leur **composition** qui est contradictoire, et
rien ne la surveillait.

**Pourquoi c'était invisible jusqu'ici.** `CRM-013` rapporte `verify-cards` à **37 contrôles** ;
en mode complet il en rend **45**. L'écart est exactement la section 10 — sept contrôles de suites
et de build —, que `--rapide` saute. Le défaut n'existe donc que sur le chemin le plus long, celui
qu'on emprunte le moins souvent.

**Vérifié comme antérieur à `CRM-014`** : la suite `supabase/tests/0016_preuves_refus.test.sql`
retirée du répertoire, `scripts/verify-cards.sh` échoue à l'identique, au même contrôle. L'unité en
cours n'y est pour rien, et sa propre suite pgTAP passe dans cet état — elle n'assère que des
tables **non vides**, jamais un compte global de cards.

**Comportement retenu :** **inchangé**. `scripts/verify-cards.sh` est un livrable de `CRM-040` et
les trois assertions un livrable de `CRM-013` ; les corriger pendant un passage consacré à
`CRM-014` rouvrirait deux unités vérifiées, ce que `CLAUDE.md` §13 interdit.

**Action attendue du responsable :** trancher entre

1. déplacer le ménage de `scripts/verify-cards.sh` **avant** sa section 10, de sorte qu'aucune
   suite ne s'exécute sur un état transitoire — la correction la plus simple, à un seul endroit ;
2. restreindre les trois assertions de `CRM-013` aux **neuf identifiants du seed** plutôt qu'au
   compte de la table, ce qui les rendrait insensibles à toute donnée de test ;
3. poser en règle générale, dans `docs/SPEC-test-harness.md`, qu'une assertion pgTAP ne compte
   jamais une population **globale** mais toujours un ensemble nommé — règle qui vaudrait pour tout
   le dépôt et préviendrait la prochaine occurrence au lieu de la corriger.

L'option 3 rejoint la question déjà posée en **INC-055** : faut-il inscrire les règles de
composition des harnais dans leur spécification, plutôt que les corriger harnais par harnais ?
C'est la **troisième** fois que la question se pose sous une forme différente.

**Lié à :** INC-055 (un harnais laisse un état que le produit ne connaît pas), INC-056 (un
garde-fou qui dépend de l'âge de la base), `docs/SPEC-test-harness.md` §7, `CLAUDE.md` §8 (le seed
est un contrat reproductible).

---

### INC-057 — Un commentaire `@verifies` annonçait une preuve de refus que le fichier ne portait pas

**Nature :** commentaire de traçabilité inexact, livré par `CRM-040`.
**Relevé le :** 2026-08-05, pendant `CRM-014`, en inventoriant les douze preuves de refus.

L'en-tête de `e2e/api/cards.spec.ts` déclare :

```ts
// @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 3, 4 et 11 sur les cards)
```

MESURÉ, par recherche dans le fichier : la n° 4 et la n° 11 y sont bien exercées et nommées ; la
**n° 3 ne l'est pas**. Aucun scénario de ce fichier ne crée de second workspace, et aucun ne vérifie
qu'un membre du workspace A ne lit pas une card du workspace B. L'énoncé de `CRM-040` dans
`docs/BACKLOG.md` est d'ailleurs exact — il n'annonce que les n° 4 et n° 11 : c'est le commentaire
du fichier qui promet davantage que son contenu.

**Pourquoi cela compte plus qu'une ligne de commentaire.** `CLAUDE.md` §5 fait des commentaires
`@spec` / `@verifies` la trace opposable entre le code et la spécification. Un `@verifies`
inexact est pire qu'absent : il fait croire à une couverture qui n'existe pas, et une revue qui
s'y fie conclut que la preuve est acquise. C'est exactement le mode de défaillance que le registre
existe pour empêcher.

**Comportement retenu :** **inchangé**, et la preuve est livrée ailleurs. `CRM-014` écrit la
preuve n° 3 sur les cards dans son fichier consolidé — chaîne complète créée dans un second
workspace avec la clé de service, constatée présente, puis invisible aux trois profils du
workspace A. La preuve existe donc désormais ; ce qui reste faux est le commentaire de
`e2e/api/cards.spec.ts`, fichier livrable de `CRM-040`, qu'un passage consacré à `CRM-014` ne
corrige pas de son propre chef (`CLAUDE.md` §13).

**Action attendue du responsable :** trancher entre

1. corriger l'en-tête de `e2e/api/cards.spec.ts` pour qu'il n'annonce que les n° 4 et n° 11 — une
   ligne, dans un commit rattaché à `CRM-040` ;
2. y ajouter réellement la preuve n° 3, ce qui la dupliquerait avec `CRM-014` sans rien prouver de
   plus ;
3. décider que les `@verifies` d'un fichier peuvent nommer une preuve **portée ailleurs pour la
   même table**, et l'écrire dans `docs/MASTER_PLAN.md` §3 — auquel cas rien n'est à corriger, mais
   la convention change pour tout le dépôt.

**Lié à :** `docs/MASTER_PLAN.md` §3 (format de la traçabilité), `docs/SPEC-permissions-rls.md` §7
(preuve n° 3), `docs/BACKLOG.md` `CRM-040`.

---

### INC-055 — Un harnais qui rejoue sa seule migration laisse la base dans un état que le runner ne produit jamais

**Nature :** défaut d'outillage de vérification ; aucun comportement du produit en cause.
**Relevé le :** 2026-08-05, pendant `CRM-036`. **Le défaut lui-même date de `CRM-034`.**

Le `migrations-runner` rejoue **tout** le répertoire, dans l'ordre, à chaque démarrage de la pile
(décision 20). Un harnais de preuves qui restaure son état en rejouant **sa seule** migration
produit donc un état intermédiaire que le produit ne connaît **jamais**.

`scripts/verify-cards.sh` rejoue `0011_cards.sql`, dont la section 7 fait
`grant insert, update on public.cards to authenticated`. Or `0012_move_card.sql` **retire**
précisément l'`UPDATE` de table pour rendre `move_card` incontournable — c'est la moitié de
l'unité `CRM-034`, et la **preuve de refus n° 5** de `docs/SPEC-permissions-rls.md` §7.

**MESURÉ le 2026-08-05, sur une base saine, avant et après un passage du harnais :**

```
avant  has_table_privilege('authenticated', 'public.cards', 'update') → false
après  has_table_privilege('authenticated', 'public.cards', 'update') → true
après  npm run test:sql → 2 fichiers en échec, 8 assertions
       (0012_cards.test.sql : 1 · 0013_move_card.test.sql : 7)
```

**La garde centrale de `CRM-034` était donc désactivée pour tout ce qui s'exécutait ensuite**, sans
qu'aucun message ne le signale : le harnais se déclarait « aucune anomalie » en laissant la base
dans un état où la porte qu'il venait de vérifier était rouverte. Le défaut est **antérieur à
`CRM-036`** — il date de `CRM-034`, qui a ajouté le `revoke` dans une migration ultérieure sans
reprendre le harnais de `CRM-040`.

**Correction appliquée, et son périmètre.** `scripts/verify-cards.sh` rejoue désormais sa migration
**et celles qui la complètent** — `0012_move_card.sql` puis `0013_valeurs_champs.sql` —, c'est-à-dire
exactement ce que le runner produit. La correction ne touche **aucun** comportement du produit,
aucune migration, aucune politique et aucun privilège : elle porte sur la seule restauration d'un
outil de vérification. Elle est signalée ici plutôt que passée sous silence, parce qu'elle modifie
un livrable de `CRM-040`.

**Un second effet, découvert par cette correction.** La dégradation *b* de `scripts/verify-cards.sh`
faisait un `PATCH` de `channel_id` pour éprouver le `WITH CHECK` de `cards_maj`. Or `channel_id` est
fermée au **niveau colonne** depuis `CRM-034` : ce `PATCH` est refusé par le **privilège**, avant
qu'aucune politique ne soit consultée. La dégradation ne prouvait donc plus rien du `WITH CHECK` —
elle ne l'exerçait que grâce à l'état dégradé décrit ci-dessus, c'est-à-dire grâce au défaut
lui-même. Elle est réécrite **en deux temps**, ce qui la rend plus forte : le refus tenu par le seul
privilège, puis le `WITH CHECK` réellement exercé une fois le privilège rendu. Le refus est
**double**, et chaque barrière est désormais mesurée séparément.

**Ce qui reste ouvert, et qui appartient au responsable.** Faut-il une règle générale — « un harnais
restaure en rejouant toutes les migrations de son numéro à la dernière » — inscrite dans
`docs/SPEC-test-harness.md`, plutôt que corrigée harnais par harnais à mesure que le défaut se
manifeste ? Le même piège attend toute unité qui modifiera par une migration ultérieure un objet
créé par une migration antérieure. Le comportement est corrigé pour la seule occurrence mesurée,
sans généralisation implicite.

**Lié à :** décision 20 (le runner ne tient aucun registre), `CRM-034` §2 (la protection de colonne),
INC-049 (chevauchement de Definition of Done entre `CRM-034` et `CRM-013`).

---

### INC-002 — Messages entrants sans `Message-ID`

**Nature :** cas limite non tranché.
**Relevé le :** 2026-08-03.

Le dédoublonnage repose sur `(workspace_id, rfc822_message_id)`. Certains expéditeurs non
conformes n'émettent pas d'en-tête `Message-ID`, ce qui rendrait la clé nulle et le dédoublonnage
inopérant — un même message serait alors inséré autant de fois qu'il existe de boîtes le
recevant.

**Proposition :** empreinte de repli `sha256(from_addr + date + subject + taille du corps)`,
préfixée pour la distinguer d'un identifiant véritable.

**Risque résiduel :** deux messages réellement distincts et rigoureusement identiques sur ces
quatre critères seraient fusionnés. Jugé improbable, mais non nul.

**Comportement en attendant :** proposition retenue par défaut dans
`docs/SPEC-mail-subsystem.md` §4.2, en attente de validation du responsable.

---

### INC-004 — Politique face aux expéditeurs inconnus

**Nature :** décision de sécurité à confirmer.
**Relevé le :** 2026-08-03.

L'adresse email d'une card circule dans les messages : elle est donc publique de fait. N'importe
qui la connaissant peut déposer du contenu dans une card.

**Comportement retenu par défaut :** tout accepter, signaler les expéditeurs inconnus, et surtout
**ne rien déclencher automatiquement** — un message reçu n'entraîne aucune transition, aucune
autorisation, aucune action. Le risque se limite donc à du bruit et à du stockage.

**Alternative non retenue :** restreindre l'ingestion aux expéditeurs connus, au prix de perdre
les premiers contacts entrants, qui sont précisément la matière première d'un CRM de prospection.

**En attente :** confirmation du responsable. Mesures de bornage déjà spécifiées : taille
maximale des pièces jointes, analyse antivirale, aucune exécution de contenu.

---

### INC-009 — La Definition of Done de `CRM-002` dépend d'une unité planifiée bien après elle

**Nature :** contradiction d'ordonnancement entre `docs/BACKLOG.md` et `docs/MASTER_PLAN.md`.
**Relevé le :** 2026-08-03, pendant `CRM-002`.

La DoD de `CRM-002` exige que « `resetMe.sh` recrée la base **et le seed** ». Or le seed est
l'objet de `CRM-005`, que `docs/MASTER_PLAN.md` §2.c place **après** `CRM-010` → `CRM-014`.
`CRM-002` ne peut donc pas satisfaire sa propre DoD au moment où le plan lui demande d'être
livrée, quelle que soit la qualité de son implémentation.

**Comportement retenu :** `resetMe.sh` appelle `supabase/seed/apply-seed.sh` s'il est exécutable,
et avertit explicitement en nommant `CRM-005` sinon. L'unité reste `[~]`, avec cette seule preuve
manquante nommée noir sur blanc. Rien n'est simulé : aucun script de seed factice n'a été créé
pour rendre la preuve verte, ce qui aurait été une fausse déclaration de complétion.

**Ce qu'il ne faut pas en conclure :** que `CRM-002` est à reprendre. Elle est terminée pour tout
ce qui dépend d'elle ; la preuve restante ne s'obtiendra qu'au moment où `CRM-005` existera.

**Arbitrage attendu du responsable :** soit retirer la mention du seed de la DoD de `CRM-002` et
la rattacher à `CRM-005` — qui vérifierait alors que `resetMe.sh` le rejoue —, soit avancer
`CRM-005` avant `CRM-002` dans `docs/MASTER_PLAN.md`. Tant que le point est ouvert, l'unité reste
`[~]` et la limite est nommée.

---

### INC-010 — `track_members` et `channel_members` sont créées avant les tables qu'elles référencent

**Nature :** contradiction d'ordonnancement entre `docs/BACKLOG.md` et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-03, pendant `CRM-003`.

`CRM-003` doit créer `track_members` et `channel_members`. Or `tracks` est livrée par `CRM-020` et
`channels` par `CRM-021`, toutes deux placées dans le chunk 3, donc **après**. Les colonnes
`track_id` et `channel_id` ne peuvent pas porter de clé étrangère au moment où le plan demande
ces tables.

Ce n'est pas un oubli de rédaction : `docs/SCHEMA.md` §1 déclare explicitement les clés étrangères
de `workspace_members` et **n'en déclare aucune** pour ces deux tables. La documentation est donc
cohérente avec elle-même, mais laisse une intégrité référentielle non garantie : rien n'empêche
aujourd'hui d'insérer un droit fin sur un `track_id` qui ne désigne aucun track, et rien ne
supprimera ce droit lorsque le track sera supprimé.

**Comportement retenu :** les tables sont créées **sans** clé étrangère sur `track_id` et
`channel_id`, avec un commentaire de table qui le dit et nomme cette entrée. Aucune table `tracks`
ou `channels` n'est créée par anticipation pour faire disparaître la contradiction : cela
déborderait du périmètre de `CRM-003` et préempterait `CRM-020`. La suite pgTAP **constate**
l'absence de la contrainte, de sorte qu'elle devienne rouge le jour où elle sera posée sans que la
suite soit mise à jour.

**Risque résiduel :** entre `CRM-003` et `CRM-020`, un droit fin peut désigner un track
inexistant. Le risque est borné : aucune interface ni aucun seed n'écrit encore dans ces tables.

**Arbitrage attendu du responsable :** désigner l'unité qui pose ces deux clés étrangères —
`CRM-020` et `CRM-021` semblent les candidats naturels — et l'inscrire dans leur Definition of
Done, ou décider que ces colonnes restent volontairement sans contrainte.


**MISE À JOUR — 2026-08-04, `CRM-020`.** La moitié `tracks` est **close** : la migration
`0003_tracks.sql` pose `track_members_track_id_fkey` en `ON DELETE CASCADE`, et l'assertion de la
suite `0001` qui constatait son absence a **réellement échoué** puis été révisée — le mécanisme de
la décision 51 a fonctionné comme prévu. La moitié `channel_members.channel_id` **reste ouverte** :
`channels` arrive avec `CRM-021`, et l'assertion garde sa fonction de garde pour cette table.

Risque d'exploitation associé, nommé à cette occasion : l'ajout d'une clé étrangère échoue s'il
existe une ligne orpheline, et le `migrations-runner` étant une dépendance de démarrage de
PostgREST, la pile ne redémarrerait plus. La vérification préalable est portée par
`docs/PROD_MIGRATIONS.md` §3 (`docs/JOURNAL.md`, décision 55).


**MISE À JOUR — 2026-08-04, `CRM-021`.** La seconde moitié est **close** : la migration
`0004_channels.sql` pose `channel_members_channel_id_fkey` en `ON DELETE CASCADE`. Les deux clés
étrangères différées par cette entrée sont désormais en place.

L'entrée reste **ici, dans les ouverts**, et non déplacée en « Clos », pour une raison qu'il faut
dire plutôt que taire : l'arbitrage demandé — « désigner l'unité qui pose ces deux clés étrangères
et l'inscrire dans leur Definition of Done » — n'a **jamais été rendu**. `CRM-020` et `CRM-021` ont
posé les clés parce qu'elles étaient les candidates naturelles, ce que cette entrée suggérait, mais
aucune Definition of Done n'a été modifiée par le responsable. Le fait technique est acquis ; la
décision documentaire ne l'est pas, et la déclarer close reviendrait à la prendre à sa place.

---

### INC-011 — `track_members` et `channel_members` sans `workspace_id`, contre la convention générale

**Nature :** contradiction interne à `docs/SCHEMA.md`.
**Relevé le :** 2026-08-03, pendant `CRM-003`.

Les conventions générales de `docs/SCHEMA.md` posent que « toute table métier porte
`workspace_id`, y compris lorsqu'il serait déductible par jointure : les politiques RLS restent
ainsi simples et indexables ». Or la définition de `track_members` et `channel_members`, au §1 du
même document, ne comporte pas cette colonne.

Les deux lectures se défendent. Sans `workspace_id`, une politique RLS sur ces tables devra
joindre `tracks` ou `channels` pour retrouver le workspace, ce que la convention cherche
précisément à éviter. Avec, la colonne devient une donnée dénormalisée de plus à maintenir
cohérente, sur une table dont chaque ligne est déjà rattachée à un objet cloisonné.

**Comportement retenu :** la définition **spécifique** du §1 l'emporte sur la convention
générale, et les tables sont créées sans `workspace_id`. Ce choix est réversible par une migration
d'ajout de colonne ; l'inverse — retirer une colonne déjà exploitée par des politiques — le serait
beaucoup moins.

**Arbitrage attendu du responsable :** trancher avant `CRM-012`, qui écrira les politiques de
résolution des droits fins et fixera de fait la forme des requêtes.

---

### INC-015 — Le parcours d'invitation depuis le produit n'a pas de composant pour le porter

**Arbitrage rendu — `docs/JOURNAL.md`, décision 256.** Le parcours d'invitation est **rattaché à `CRM-070`**, et non à une unité créée maintenant : trois décisions d'architecture d'un coup pour un geste rare. En attendant, le comportement réel — invitation émise par un **opérateur**, hors interface — est nommé dans `docs/manual.md` chapitre 17 plutôt que promis comme un parcours livré.

**Nature :** référence manquante dans l'architecture, décision non prise.
**Relevé le :** 2026-08-03, pendant `CRM-011`.

`docs/BACKLOG.md` décrit `CRM-011` comme livrant « l'invitation par un administrateur », et
`docs/manual.md` rattache le chapitre 17, « Inviter et gérer les membres », à cette unité. Or
`POST /auth/v1/invite` exige un jeton portant `service_role` — mesuré : la clé anonyme est refusée
par `403 not_admin`. La webapp ne doit jamais détenir cette clé.

Il manque donc un composant serveur entre l'administrateur de workspace et GoTrue, et le projet
n'en possède aucun qui convienne :

- les fonctions edge **entrent au périmètre avec `CRM-016`** (décision 260) et donnent à
  `CRM-070` le composant serveur attendu, sans livrer encore le parcours d'invitation ;
- `mail-sync` (`CRM-051`) n'existe pas encore, et vise la messagerie du produit, pas l'identité ;
- la webapp (`CRM-007`) est un client, sans partie serveur.

**Mesure faite pour éclairer l'arbitrage.** `pg_net` 0.20.3 est déjà installée dans la base et
préchargée, et la base joint réellement GoTrue (`net.http_get('http://auth:9999/health')` rend
`200`). Une fonction `SECURITY DEFINER` vérifiant `app.is_workspace_admin` puis appelant GoTrue par
`pg_net`, la clé de service rangée en Vault, est donc techniquement possible **aujourd'hui**.

**Ce qui n'est pas tranché, et n'a pas été tranché ici.** Cette voie suppose trois choix
d'architecture que `CRM-011` n'a pas mandat de prendre : une table d'invitations absente de
`docs/SCHEMA.md`, un appel sortant depuis la base absent de `docs/DAT.md` §3, et une clé de service
à provisionner en Vault. S'y ajoute une question de règle métier entière : ce que l'invitation
porte comme workspace et comme rôle, et à quel moment la ligne `workspace_members` est créée — à
l'émission de l'invitation, ou à son acceptation.

**Comportement retenu en attendant :** l'invitation est émise par un **opérateur** disposant de la
clé de service, hors interface. Aucune table, aucune fonction et aucun appel sortant n'est créé par
anticipation. `docs/SPEC-auth.md` §3.2 et §6 le disent explicitement plutôt que de laisser croire à
un parcours produit livré.

**Arbitrage attendu du responsable.** Trois options :

1. rattacher le parcours à `CRM-070` (administration des permissions fines), qui traite déjà de la
   gestion des membres, et livrer d'ici là l'invitation par opérateur ;
2. créer une unité dédiée, placée après `CRM-007`, portant la table d'invitations, la fonction
   `SECURITY DEFINER` et le provisionnement de la clé de service en Vault ;
3. décider que l'invitation reste définitivement une opération d'exploitation, et retirer le
   chapitre 17 de `docs/manual.md`.

Lié à INC-014, **close depuis par `CRM-022`** : les politiques RLS des tables d'identité ont leur
unité. La table et le geste éventuels d'invitation restent, eux, explicitement rattachés à
`CRM-070`.

---

### INC-018 — L'API d'administration de GoTrue n'applique pas la politique de mot de passe

**Arbitrage rendu — `docs/JOURNAL.md`, décision 265.** **Le chemin d'administration de GoTrue est interdit en production** et documenté comme une opération d'exploitation encadrée : un privilège ne dispense pas d'une règle. Mise en œuvre : `docs/PROD_MIGRATIONS.md` §7 et `docs/SPEC-auth.md` §4.1.

**Nature :** spécification démentie par la mesure.
**Relevé le :** 2026-08-03, pendant `CRM-005`, en mesurant le chemin de création des comptes du
seed.

`docs/SPEC-auth.md` §4 énonce la politique **sans réserve** : « `PASSWORD_MIN_LENGTH` vaut 12 [...]
Le refus est explicite : `HTTP 422`, code `weak_password`, avec la raison `length`. » `CRM-011` l'a
prouvée dans les deux sens — onze caractères refusés, douze acceptés — mais **sur le chemin
utilisateur uniquement**.

Mesure sur la pile de développement, `GOTRUE_PASSWORD_MIN_LENGTH=12` réellement appliqué au
conteneur `p2enjoy-auth` :

| Chemin | Mot de passe | Résultat mesuré |
|---|---|---|
| `PUT /auth/v1/user` | `onzecaracte` (11) | `422 weak_password` — « Password should be at least 12 characters. » |
| `POST /auth/v1/admin/users` | `court123` (8) | `200` — compte créé |

Le compte ainsi créé n'est pas un artefact inerte : la connexion par mot de passe avec ces huit
caractères rend `200` et un jeton d'accès valide. La politique encadre donc ce qu'un
**utilisateur** choisit, jamais ce qu'un **opérateur** impose.

**Portée réelle.** Aujourd'hui, seuls la clé de service et donc un opérateur atteignent ce chemin ;
le risque n'est pas une escalade depuis le produit, mais une **fausse assurance** : lire
`docs/SPEC-auth.md` §4 laisse croire qu'aucun compte faible ne peut exister dans la base, ce qui
est faux. Le jour où `CRM-011` obtiendra son écran d'invitation (INC-015), un administrateur de
workspace choisissant un mot de passe initial passerait par ce même chemin.

**Comportement retenu en attendant :** rien n'est modifié. `CRM-005` s'y conforme
**volontairement** — les mots de passe du seed font 16 caractères — et `scripts/verify-seed.sh`
**prouve** cette longueur au lieu de la supposer, précisément parce que l'API ne la garantit pas
(`docs/SPEC-seed.md` §3.5 et §7, preuve n° 7).

**Pourquoi ce n'est pas résolu ici :** la correction appartient à `CRM-011`, dont c'est la
spécification, et le choix n'est pas neutre. Trois options s'offrent, aucune évidente :

1. **documenter la réserve** dans `docs/SPEC-auth.md` §4 — la politique encadre le chemin
   utilisateur, pas le chemin d'administration — et s'en tenir là ;
2. **valider côté appelant** dans tout script ou service qui crée un compte par l'API
   d'administration, seed compris ;
3. **valider côté base**, par un `CHECK` ou un trigger sur `auth.users`, ce qui reviendrait à
   écrire dans un schéma dont GoTrue est l'autorité — écart notable de la ligne du projet.

**Arbitrage attendu du responsable :** trancher entre ces options avant que l'invitation ne
devienne un parcours produit (INC-015), moment où le chemin d'administration cessera d'être
réservé à un opérateur.

---

### INC-025 — `docs/SCHEMA.md` §2 omet `created_at` et `updated_at`, que ses propres conventions exigent

**Nature :** contradiction interne à `docs/SCHEMA.md`.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-020`.

Les « Conventions générales » de `docs/SCHEMA.md` posent : « Horodatages `timestamptz`, toujours en
UTC. `created_at` par défaut `now()`. » Les tables du socle livrées par `CRM-003` — `profiles`,
`workspaces` — portent bien `created_at` et `updated_at`, et le tableau du §1 les énumère.

Le tableau du §2, qui décrit `tracks` et `channels`, ne les énumère **pas**. Rien dans le document
ne justifie l'exception, et les deux tables sont des tables métier ordinaires.

**Comportement retenu :** `CRM-020` livre `tracks` **avec** les deux colonnes et le trigger
`app.set_updated_at()`, conformément aux conventions générales, et met à jour le tableau du §2 dans
le même changement. L'omission est traitée comme une lacune du tableau, non comme une décision
implicite d'y renoncer.

**Ce qui n'est pas fait :** le tableau de `channels`, dans le même §2, n'est **pas** corrigé — il
relève de `CRM-021`, qui livrera la table. Le corriger ici modifierait la spécification d'une unité
non commencée.

**Action attendue du responsable :** confirmer la lecture, ou nommer la raison pour laquelle les
tables du §2 devraient échapper aux conventions générales.


**MISE À JOUR — 2026-08-04, `CRM-021`.** La seconde moitié est traitée : `channels` est livrée
**avec** `created_at`, `updated_at` et le trigger `app.set_updated_at()`, et le tableau du §2 est
complété dans le même changement. Les deux tables du §2 suivent désormais les conventions
générales.

L'entrée reste **ouverte** pour la même raison qu'INC-010 : la lecture retenue — « l'omission était
une lacune du tableau, non une décision d'y renoncer » — n'a pas été confirmée par le responsable.
Deux unités l'ont appliquée ; si elle est fausse, ce sont deux migrations qu'il faut reprendre, et
non une.

**MISE À JOUR — 2026-08-04, `CRM-035`.** L'omission n'était pas propre au §2 : le §4 la répète pour
`form_fields`, `form_field_rules` et `card_field_values`, et y ajoute `workspace_id`, que les mêmes
conventions générales exigent « y compris lorsqu'il serait déductible par jointure ».
**Cinquième et sixième occurrences** — après `tracks`, `channels`, `workflow_nodes_catalog` et les
trois tables du §3. `CRM-035` livre ses deux tables avec les trois colonnes et met le §4 à jour dans
le même changement, comme les quatre unités précédentes.

Le nombre d'occurrences change la nature du constat : ce n'est plus une lacune ponctuelle d'un
tableau, c'est une **règle d'écriture** que `docs/SCHEMA.md` n'applique nulle part hors du §1. Si la
lecture retenue est fausse, ce sont désormais **six** migrations à reprendre. L'arbitrage devient
d'autant plus utile qu'il est peu coûteux : une phrase dans les conventions générales suffirait à
dispenser chaque tableau de répéter les colonnes communes.

---

### INC-026 — Le refus d'un privilège manquant par PostgREST divulgue la commande `GRANT` à exécuter

**Nature :** comportement de PostgREST `v14.12`, mesuré, en tension avec `CLAUDE.md` §20 (« les
erreurs doivent permettre le diagnostic sans exposer l'infrastructure »).
**Relevé le :** 2026-08-04, pendant la mesure préalable à `CRM-020`.

`tracks` n'accorde `DELETE` à personne : la suppression du produit est l'archivage
(`docs/SPEC-tracks.md` §4). Le refus mesuré est correct — `403`, code `42501` — mais son corps
porte un `hint` :

```
"hint": "Grant the required privileges to the current role with: GRANT DELETE ON public.tracks TO authenticated;"
```

Le message nomme la table, le schéma, le rôle courant et la commande exacte qui lèverait le refus.
Aucun secret n'est divulgué, et la table est déjà nommée par la route appelée ; l'information
ajoutée est la **forme du modèle de privilèges**.

**Pourquoi ce n'est pas résolu ici :** le `hint` est produit par PostgREST, pas par le produit. Le
supprimer supposerait un filtrage à la passerelle (Kong) portant sur **toutes** les réponses
d'erreur, donc une décision d'architecture transverse qui déborde très largement `CRM-020`, et qui
risquerait d'appauvrir des diagnostics légitimes.

**Portée réelle :** tous les refus de privilège de l'API, sur toute table, présente et à venir.

**Action attendue du responsable :** décider si ce `hint` doit être filtré à la passerelle, et si
oui, rattacher la mesure à une unité — aucune ne la porte aujourd'hui.

---

### INC-027 — Le type généré exige `position` à l'insertion, que le trigger rend facultative

**Nature :** écart entre `webapp/src/lib/database.types.ts` (généré) et le comportement réel de
`public.tracks`.
**Relevé le :** 2026-08-04, pendant `CRM-020`.

`tracks.position` est `NOT NULL` **sans défaut de colonne** : c'est le trigger
`app.tracks_attribuer_position` qui la renseigne lorsqu'un client l'omet, ce qui est le
comportement voulu et prouvé (`docs/SPEC-tracks.md` §3).

Le générateur de types ne lit que le défaut de **colonne**, et ignore les triggers. Il déclare
donc `position` comme requise dans `TablesInsert<'tracks'>` :

```ts
Insert: { ...; position: number; ... }   // requise pour TypeScript
```

Un appel REST qui l'omet réussit pourtant — mesuré, `201`, position attribuée. **Le type est plus
strict que le produit.**

**Pourquoi ce n'est pas corrigé.** `webapp/src/lib/database.types.ts` est un fichier **généré**, et
la garde anti-dérive de `CRM-006` (`npm run types:check`) compare le fichier versionné à ce que la
base produit. Le retoucher à la main la ferait échouer, et à juste titre.

**Ce qui est fait à la place :** l'écart est **figé par une assertion** dans
`webapp/src/lib/database.types.test-d.ts` (`_tracksInsertRequis`), qui énumère exactement les
colonnes requises à l'insertion. Si une migration future ajoutait un défaut de colonne, l'assertion
deviendrait rouge et forcerait sa révision.

**Conséquence pratique, bornée :** un client TypeScript qui crée un track doit fournir `position`,
ou passer par un cast. Aucun code du dépôt ne crée de track depuis TypeScript aujourd'hui — le seed
passe par `curl`, et l'interface n'a aucun parcours de création (INC-021).

**Action attendue du responsable :** décider, le jour où une interface créera des tracks, entre
trois conduites — poser un défaut de colonne en plus du trigger, exposer une RPC de création, ou
assumer le cast. Le même écart se reproduira sur toute colonne renseignée par trigger.

**Lié à :** INC-021 (aucun écran de connexion, donc aucun parcours de création).

---

### INC-028 — `docs/DESIGN_SYSTEM.md` §5.6 et §8 sont incompatibles pour trois jetons sur cinq

**Nature :** contradiction interne au design system, **mesurée**.
**Relevée le :** 2026-08-04, en ajoutant à `CRM-020` la preuve de contraste qui manquait.

Le §5.6 décrivait les pilules : « fond de la couleur à 10–15 %, **texte à la couleur pleine** ». Le
§8 exige : « Contrastes AA (4,5:1) vérifiés, **y compris pour les badges colorés** ».

Appliquées ensemble aux cinq jetons de couleur de donnée du §1, les deux règles se contredisent.
Contrastes calculés selon WCAG 2.1, texte plein sur son propre fond doux :

| Jeton | Texte | Fond doux | Contraste | §8 |
|---|---|---|---|---|
| `brand` | `#23468C` | `#E9ECF4` | **7,64:1** | conforme |
| `success` | `#238C33` | `#E9F4EB` | **3,82:1** | ÉCHEC |
| `accent` | `#D9CF4A` | `#F7F4D7` | **1,45:1** | ÉCHEC |
| `danger` | `#F24141` | `#FEECEC` | **3,29:1** | ÉCHEC |
| `neutral` | `#4B5563` | `#F3F4F6` | **6,87:1** | conforme |

La contradiction date de `CRM-000`, pas de `CRM-020` : elle n'avait jamais été rencontrée, aucun
composant n'ayant eu à peindre un texte sur un fond doux de sa propre couleur — `CRM-007`
n'employait `bg-brand-soft text-brand`, le seul couple conforme, que pour l'état actif.

**Ce que la première livraison de `CRM-020` avait corrigé, et ce qu'elle avait laissé passer.**
`accent`, à 1,45:1, est illisible : il a été vu sur une capture et corrigé par un repli sur l'encre.
`success` et `danger` sont restés en couleur pleine. Ils sont **lisibles sans être conformes** — ils
ne se voient pas, ils se mesurent — et la conformité AA n'était alors que *déclarée* : aucune preuve
du dépôt ne calculait un contraste. Le track `studio-web` du seed, en `success`, a donc été rendu à
3,82:1 pendant que la Definition of Done invoquait le §8.

**Ce qui a été fait, et pourquoi ce n'est pas une résolution implicite.** Une pilule devait bien
être peinte : il n'existait aucun comportement antérieur conforme à laisser inchangé. La conduite
est donc explicite — quatre jetons `--color-*-on-soft`, le jeton plein assombri juste assez pour
tenir le §8 en conservant sa teinte, donc l'intention du §5.6. Valeurs **calculées** à partir du
jeton, comme les fonds doux, jamais des hexadécimaux ad hoc. Contrastes obtenus : 7,64 / 4,85 /
4,72 / 4,67. Écart déclaré en `docs/DESIGN_SYSTEM.md` §12.5, et **mesuré sur le rendu** par
`e2e/ui/tracks.spec.ts`.

Entre les deux règles, `CLAUDE.md` §26 place de toute façon la protection des personnes avant la
préférence stylistique.

**Ce qui reste à trancher, et qui déborde `CRM-020` :**

1. Le §5.6 doit-il être **réécrit** pour tout le produit, ou l'écart §12.5 doit-il rester borné aux
   pilules de track ?
2. Les mêmes jetons `*-on-soft` s'appliquent-ils aux **badges** (`Badge.tsx`), aux liserés de card
   (§5.1) et aux compteurs de colonne (§5.2), qui rencontreront la même contradiction ?
3. Le jeton `accent` reste-t-il utilisable comme couleur de donnée ? Le §1 le réserve à « un seul
   surlignage par vue » ; l'ouvrir aux tracks, comme le fait le seed, va au-delà de cette phrase.

**Leçon retenue, indépendante de l'arbitrage :** une exigence chiffrée qu'aucune preuve ne calcule
n'est pas une exigence, c'est une intention. Les contrôles d'accessibilité chiffrés du §8 devraient
être mesurés partout où ils s'appliquent, et non seulement sur les pilules de track.

**Action attendue du responsable :** trancher les trois points, et rattacher la mise en conformité
des autres composants à une unité si le §5.6 est réécrit.

---

### INC-029 — `channels.workflow_id` est exigée `non nul` et référencée, alors que `workflows` arrive deux étapes plus tard

**Nature :** contradiction d'ordonnancement entre `docs/SCHEMA.md` §2 et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-021`.

`docs/SCHEMA.md` §2 décrit `channels.workflow_id` comme `uuid`, **`FK workflows`, non nul**. La
table `workflows` est livrée par `CRM-031`, que `docs/MASTER_PLAN.md` §2 place au chunk **3.b**,
après `CRM-021` qui est au **3.a**. Mesuré sur la base migrée du projet :
`to_regclass('public.workflows')` rend `NULL`.

Ce n'est pas contournable par l'écriture. Une clé étrangère vers une table absente est refusée à la
création, et une contrainte `NOT NULL` sur une colonne qu'aucune valeur licite ne peut renseigner
rendrait la table **inutilisable** : ni le seed, ni les preuves d'API ne pourraient créer un
channel. C'est le troisième cas du même mode de défaillance, après INC-010 (`CRM-003` a dû se
passer de clés étrangères) et INC-013 (`CRM-010` a dû se passer de jointures) ; ici, `CRM-021` doit
se passer d'une contrainte.

Le plan lui-même est cohérent avec son propre motif — « l'arborescence conditionne tout le reste »
place tracks et channels d'abord, « le moteur de workflow avant les cards » place les workflows
ensuite. C'est le **modèle de données** qui introduit une dépendance inverse, en faisant du
workflow une propriété obligatoire du channel.

**Comportement retenu :** `CRM-021` livre ce qui est démontrable aujourd'hui, et **rien de plus**.

| Aspect | Livré par `CRM-021` | Différé, et à qui |
|---|---|---|
| Colonne `workflow_id uuid` | oui, **nullable** | — |
| Clé étrangère vers `workflows` | non | `CRM-031` |
| Contrainte `NOT NULL` | non | `CRM-031`, après reprise des lignes existantes |
| Trigger de cohérence workflow ↔ track | non | `CRM-033`, déjà nommé par la DoD de `CRM-021` |

Aucune table `workflows` n'est créée par anticipation : cela préempterait `CRM-030` et `CRM-031`.

**Ce qui protège l'écart :** il est **figé par des assertions** de
`supabase/tests/0005_channels.test.sql`, non par un commentaire. La suite constate que
`workflow_id` est nullable, qu'elle ne porte aucune clé étrangère, et que `public.workflows`
n'existe pas. Les trois deviendront rouges le jour où `CRM-031` livrera la table, et forceront la
reprise de `docs/SPEC-channels.md` §2.5 (même procédé que la décision 51).

**Risque résiduel :** un channel sans workflow n'a pas d'étapes, donc pas de board. Le risque est
**borné à la fenêtre `CRM-021` → `CRM-031`** : les cards n'existent pas avant `CRM-040`, qui vient
après les deux. Le seed laisse `workflow_id` nul partout, ce qui est l'état réel du produit, et ne
fabrique pas une donnée que le modèle ne sait pas encore produire.

**Conséquence sur l'état de l'unité :** `CRM-021` ne peut pas satisfaire `docs/SCHEMA.md` §2 à la
lettre. Ce n'est pas un défaut de réalisation mais une dépendance non satisfiable dans l'ordre
actuel du plan.

**Arbitrage attendu du responsable.** Trois options, à trancher **avant `CRM-031`**, qui décidera
de la forme de la reprise :

1. inscrire dans la Definition of Done de `CRM-031` la pose de la clé étrangère **et** de la
   contrainte `NOT NULL`, avec la reprise des channels existants — symétrique de ce qu'INC-010 a
   demandé à `CRM-020` et `CRM-021` ;
2. déplacer `CRM-030` et `CRM-031` avant `CRM-021` dans `docs/MASTER_PLAN.md` §2, au prix de livrer
   le moteur de workflow avant l'arborescence qu'il équipe ;
3. décider que `workflow_id` reste **facultative** dans le modèle — un channel sans workflow étant
   alors un état légitime du produit — et corriger `docs/SCHEMA.md` §2 en conséquence. Cette option
   a un coût qu'il faut nommer : tout code lisant `channel.workflow_id` devra traiter le cas nul.

**Lié à :** INC-010 et INC-013 (même mode de défaillance), INC-025 (autre lacune du même tableau).

**Mise à jour du 2026-08-04, pendant `CRM-031` — la moitié structurelle est levée, l'arbitrage
reste ouvert.** `workflows` existe désormais. `CRM-031` livre donc :

- la clé étrangère, et **composite** — `(workflow_id, workspace_id)` vers
  `workflows (id, workspace_id)` —, de sorte que le workflow d'un channel appartienne au même
  workspace, garanti par la base et non par une politique ;
- le rattachement des **six channels du seed** au workflow par défaut, ce qui retire le risque
  résiduel nommé ci-dessus : plus aucun channel de démonstration n'est sans board ;
- la mise à jour des trois assertions de `supabase/tests/0005_channels.test.sql`, devenues rouges
  comme prévu — le mécanisme a fonctionné une quatrième fois.

**La contrainte `NOT NULL` n'est pas posée**, et ce n'est pas un oubli. Elle change le **contrat de
création d'un channel** : créer un channel deviendrait impossible sans désigner un workflow, ce qui
touche les scénarios d'API de `CRM-021` et le geste produit lui-même. C'est l'unité de la cohérence
workflow ↔ channel — `CRM-033`, déjà nommée par la Definition of Done de `CRM-021` pour son trigger
— qui doit la porter, avec la règle qu'elle applique. L'option 1 de l'arbitrage ci-dessus est donc
**engagée à moitié et non tranchée** : `CRM-031` a fait ce qu'il pouvait faire sans décider à la
place du responsable. Les options 2 et 3 restent ouvertes ; l'option 3, en particulier, rendrait la
`NOT NULL` inutile plutôt que différée.

---

### INC-031 — Le refus d'archivage d'un nœud occupé exige `workflow_steps` et `cards`, livrées après

**Nature :** contradiction d'ordonnancement entre `docs/SPEC-workflow-engine.md` §2, la Definition
of Done de `CRM-030` dans `docs/BACKLOG.md`, et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-030`.

La Definition of Done de `CRM-030` exige « pgTAP sur le refus d'archivage » d'un nœud occupé, et
`docs/SPEC-workflow-engine.md` §2 énonce la règle : « son archivage est refusé tant qu'une card
active s'y trouve ».

Or « une card active se trouve sur ce nœud » n'est pas une propriété du nœud. Le chemin est
`cards.current_step_id → workflow_steps.node_id → workflow_nodes_catalog.id`. Il traverse donc deux
tables livrées **après** cette unité par `docs/MASTER_PLAN.md` §2 : `workflow_steps` par `CRM-031`,
`cards` par `CRM-040`. **Mesuré** au moment de la spécification :
`to_regclass('public.workflow_steps')`, `to_regclass('public.workflows')` et
`to_regclass('public.cards')` rendent tous les trois `NULL`.

C'est le troisième cas du même motif — INC-010 pour des clés étrangères, INC-013 pour des
jointures d'autorisation, INC-029 pour une colonne. Ici, ce qui manque est la **cible** de la
garde.

**Ce qui rend l'écriture anticipée pire que l'omission — mesuré, non supposé.** PostgreSQL
**accepte la création** d'une fonction PL/pgSQL référençant une table absente : le corps n'est pas
analysé à la création. L'échec ne survient qu'au **premier appel**, en
`relation "public.cards" does not exist`. Un trigger d'archivage écrit aujourd'hui ne protégerait
donc rien, et ferait échouer **toute** mise à jour du catalogue — y compris un simple renommage —
dès sa livraison. Le seed lui-même ne pourrait plus converger.

**Comportement retenu :** `CRM-030` livre l'archivage **doux et réversible** — `archived_at`,
aucune suppression physique, aucun privilège `DELETE` — sans la garde d'occupation. La règle est
énoncée dans la spécification, l'absence de ses tables est **figée par des assertions pgTAP**
(`hasnt_table`), de sorte que la suite devienne rouge le jour où `workflow_steps` ou `cards`
apparaîtront sans que la garde ait été écrite. Mécanisme de la décision 51, employé une quatrième
fois.

**Risque résiduel :** nul aujourd'hui — aucune card n'existe, aucun nœud ne peut être occupé. Le
risque naîtrait à `CRM-040` si la garde n'était pas écrite avant que des cards ne peuplent des
étapes : un nœud archivé alors qu'il porte des cards actives ferait disparaître une colonne du
board sans que ses cards aient été déplacées.

**Arbitrage attendu du responsable.** Trois options, à trancher **avant `CRM-040`** :

1. rattacher la garde à `CRM-040`, l'unité qui livre la dernière table dont elle dépend, et
   l'inscrire dans sa Definition of Done ;
2. rattacher la garde à `CRM-031`, en la limitant à l'occupation par une **étape** — un nœud
   instancié dans un workflow ne serait plus archivable, règle plus stricte que celle spécifiée et
   qui interdirait d'archiver un nœud pourtant vide de cards ;
3. créer une unité distincte, par exemple `CRM-030b`, placée après `CRM-040`.

Tant que le point est ouvert, `CRM-030` reste `[~]` et la limite est nommée.

**Lié à :** INC-010, INC-013, INC-029 (le même motif, sur d'autres objets), INC-023.

**Mise à jour du 2026-08-04, pendant `CRM-031` — la moitié du chemin existe, l'arbitrage reste
ouvert.** `workflows` et `workflow_steps` sont livrées. Le chemin de la garde n'est donc plus
interrompu qu'en un point : `cards`, due par `CRM-040`. **Mesuré à nouveau** :
`to_regclass('public.workflow_steps')` rend désormais la table, `to_regclass('public.cards')` rend
toujours `NULL`.

`CRM-031` **n'écrit pas la garde**, et n'adopte pas l'option 2 qui la lui rattacherait : cette
option est plus stricte que la règle spécifiée — elle interdirait d'archiver un nœud instancié dans
un workflow mais vide de toute card —, et l'adopter en silence trancherait à la place du
responsable. Les trois options restent donc ouvertes, à trancher avant `CRM-040`.

Les assertions qui figeaient l'écart sont mises à jour dans le même changement : deux
`hasnt_table` sont devenues fausses et ont été remplacées par leur constat inverse — les tables
existent, `cards` n'existe pas, et **aucun trigger d'archivage n'est posé sur le catalogue**. La
troisième, sur `cards`, reste en place et deviendra rouge à `CRM-040`.

---

### INC-033 — `require_fields` ne peut porter aucune intégrité référentielle, jamais

**Arbitrage rendu — `docs/JOURNAL.md`, décision 262.** **`require_fields` devient une table de liaison `(transition_id, field_id)`** : le modèle est corrigé, pas contourné. L'intégrité référentielle est le travail de la base, pas d'un nettoyage applicatif qu'un chemin de suppression oubliera. Mise en œuvre : `CRM-018`, qui rouvre `CRM-031` et `CRM-035`.

**Nature :** limite du modèle de données, mesurée ; `docs/SCHEMA.md` §3 la décrit sans la nommer.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-031`.

`docs/SCHEMA.md` §3 donne à `workflow_transitions.require_fields` le type `uuid[]` : « champs
exigés en plus de ceux requis par l'étape cible ». Ces identifiants désignent des lignes de
`form_fields` (`CRM-035`).

**Mesuré sur la sonde :** PostgreSQL refuse toute clé étrangère depuis une colonne tableau —
`alter table … add foreign key (require_fields) references … (id)` échoue en « Key columns
"require_fields" and "id" are of incompatible types: uuid[] and uuid ». Ce n'est pas un différé
d'ordonnancement comme INC-029 ou INC-031 : c'est une propriété du type, qui ne changera pas quand
`form_fields` existera.

**Conséquence.** La suppression d'un champ de formulaire laissera des identifiants morts dans les
tableaux `require_fields` des transitions. Rien ne les signalera, et le comportement de `move_card`
(§5) face à un identifiant qui ne désigne plus rien n'est écrit nulle part : exiger un champ
inexistant bloquerait toute transition, l'ignorer relâcherait silencieusement une exigence.

**Comportement retenu par `CRM-031` :** la colonne est livrée telle que la référence de schéma la
décrit — `uuid[]`, non nulle, défaut `'{}'` —, l'absence de contrainte est **écrite** dans
`docs/SPEC-workflow-engine.md` §3.4, et le seed la laisse vide partout, `form_fields` n'existant
pas. Aucune règle de nettoyage n'est inventée.

**Options historiques instruites avant la décision 262 :**

1. remplacer le tableau par une table de liaison `workflow_transition_required_fields`, qui
   restaurerait l'intégrité référentielle au prix d'une table de plus et d'un écart avec
   `docs/SCHEMA.md` §3 ;
2. conserver le tableau et poser un trigger de nettoyage à la suppression d'un champ, qui retirerait
   l'identifiant des transitions concernées ;
3. conserver le tableau et décider explicitement du comportement de `move_card` face à un
   identifiant mort — l'ignorer, en le journalisant.

**Lié à :** INC-029, INC-031 (écarts nommés sur le même modèle, d'origine différente).

**Mise en œuvre ouverte le 2026-08-08.** `docs/SPEC-transition-required-fields.md` fixe la table à
deux colonnes, la migration sans perte de comportement, la cohérence de workflow, les cascades,
RLS et la révision atomique de `move_card`, `copy_workflow_to_track` et du seed. INC-033 restera
ouvert jusqu'à une preuve froide où la suppression réelle d'un champ jetable laisse zéro liaison.

**Audit de mise en œuvre — décision 301.** Le contrôle ne porte pas seulement sur l'écriture de la
liaison : les deux parents sont verrouillés pendant celle-ci, et déplacer ensuite une transition ou
un champ déjà lié est refusé symétriquement. Sans ces gardes, la relation normalisée aurait encore
pu devenir incohérente par un chemin d'administration ou une course concurrente.

**Close le 2026-08-09 par `CRM-018`.** La migration 19 a passé le reset froid, les tableaux legacy
valides sont migrés, les UUID morts et croisements refusent atomiquement, et la suppression réelle
d'un champ jetable laisse zéro liaison. Les deux cascades, les gardes symétriques et la concurrence
sont éprouvées par 88 assertions et le harnais 24/24.

---

### INC-034 — L'environnement de la routine impose une branche et une identité Git contraires à `CLAUDE.md` §13

**Nature :** contradiction entre les conventions du responsable et la configuration de
l'environnement d'exécution de la routine.
**Relevé le :** 2026-08-04, pendant `CRM-031`.

`CLAUDE.md` §13 et `docs/MASTER_PLAN.md` §1 sont explicites : **pas de branche, pas de worktree**,
tout se fait sur `main` ; et **aucun commit n'est attribué à un agent**, l'auteur et le committer
étant ceux du responsable. Deux faits mesurés contredisent l'un et l'autre.

**1. La routine s'exécute sur une branche imposée, pas sur `main`.** Son environnement lui assigne
`claude/happy-goldberg-s6b1t0` et lui interdit de pousser ailleurs. C'est la seconde occurrence du
problème traité par la décision 71 : `CRM-030` avait été poussée sur
`claude/happy-goldberg-c627zj`, puis reportée sur `main` par cherry-pick à l'exécution suivante.
Le travail de `CRM-031` est dans la même situation — il est complet et vérifié, mais il vit sur une
branche.

**Mesuré, et plus grave que l'écart lui-même :** au démarrage de cette exécution, la branche locale
portait **29 commits qu'aucune référence distante ne contenait**. `git fetch origin
claude/happy-goldberg-s6b1t0` répondait « couldn't find remote ref ». Le travail de plusieurs
exécutions — dont `CRM-020`, `CRM-021` et l'intégration de `CRM-030` — n'existait donc que dans le
conteneur, qui est éphémère. Le `push` a été fait immédiatement, avant toute autre chose.

**2. L'identité Git par défaut de l'environnement est celle de l'agent.** Aucun `user.name` ni
`user.email` n'était configuré **localement** dans le dépôt ; la valeur globale du conteneur vaut
`Claude <noreply@anthropic.com>`, et les deux premiers commits de cette exécution en ont hérité,
alors que les 34 précédents portent tous `P2Enjoy <contact@p2enjoy.studio>`.

**Comportement retenu :** la configuration **locale** du dépôt est posée à
`P2Enjoy <contact@p2enjoy.studio>`, et les deux commits fautifs — les seuls concernés, tous deux de
cette exécution et non fusionnés — ont été réécrits pour porter cette identité. `CLAUDE.md` §13
prévoit que la correction d'un commit déjà poussé se fait « sur instruction explicite du
responsable » ; aucune instruction n'était atteignable, la routine s'exécutant sans personne devant
l'écran. La règle d'attribution étant elle-même **non négociable** et la réécriture ne portant que
sur des commits de la routine, la correction a été faite et est nommée ici plutôt que laissée en
l'état. Aucun commit antérieur n'a été touché.

**Confirmation mesurée, 2026-08-05.** Les deux prédictions de cette entrée se sont vérifiées à
l'exécution suivante, sur un conteneur neuf :

- la configuration **locale** posée le 2026-08-04 avait disparu — `git config user.email` rendait de
  nouveau `noreply@anthropic.com`. Elle a été reposée **avant** le premier commit, de sorte
  qu'aucune réécriture d'historique n'a été nécessaire cette fois. Elle disparaîtra de nouveau au
  prochain conteneur : le correctif durable annoncé au point 2 ci-dessous reste entier ;
- la branche assignée était encore différente — `claude/happy-goldberg-wq44ln` —, et
  `git ls-remote` en dénombre désormais **dix-huit**, toutes issues d'exécutions successives de la
  même routine. `refs/heads/main` suit bien le travail, mais rien dans le dépôt ne documente qui
  l'y reporte, ni quand, ni selon quelle règle — c'est exactement le point 1 ci-dessous.

Une troisième conséquence, non prévue par cette entrée, a été mesurée le même jour : deux
exécutions ont traité la même unité en parallèle. Voir **INC-059**.

**Troisième occurrence de l'identité, 2026-08-05, pendant la reprise de `CRM-010`.** La prédiction
du point 2 s'est vérifiée une fois de plus : sur un conteneur neuf, `git config user.email` rendait
`noreply@anthropic.com`, et le **commit documentaire de l'unité a été créé puis poussé sous cette
identité** avant que l'écart ne soit vu — la vérification n'ayant lieu qu'après le second commit.
La configuration locale a été reposée à `P2Enjoy <contact@p2enjoy.studio>`, et les **deux** commits
de cette exécution — le documentaire, déjà poussé, et celui de l'unité, non poussé — ont été
réécrits pour la porter, puis republiés. Aucun commit antérieur n'a été touché ; aucun commit
d'une autre exécution n'est concerné.

**QUATRIÈME OCCURRENCE DE L'IDENTITÉ, 2026-08-05, PENDANT LE REJEU DES HARNAIS DE `CRM-042`.** La
prédiction du point 2 s'est vérifiée pour la quatrième fois : conteneur neuf, aucune configuration
**locale**, `git config user.email` rendant `noreply@anthropic.com`. Le commit de cette exécution a
été créé sous cette identité, l'écart vu **immédiatement après**, la configuration locale reposée à
`P2Enjoy <contact@p2enjoy.studio>` et le commit réécrit par `--amend --reset-author` **avant tout
push** — aucune référence distante n'a donc porté l'identité fautive. La branche assignée était
`claude/happy-goldberg-szblin`, et `git branch -a` en dénombre désormais **plus de trente**, toutes
issues d'exécutions successives de la même routine. Les deux points ci-dessous restent entiers.

Le motif est celui déjà retenu : `CLAUDE.md` §13 prévoit l'instruction explicite du responsable
pour réécrire un commit poussé, aucune instruction n'est atteignable pendant une exécution
automatique, et la règle d'attribution est elle-même **non négociable**. La correction est faite et
nommée, plutôt que laissée en l'état.

**CINQUIÈME OCCURRENCE DE L'IDENTITÉ, 2026-08-05, PENDANT `CRM-043`.** Même constat, cinquième
conteneur neuf : aucune configuration **locale**, `git config user.email` rendant
`noreply@anthropic.com`, et `user.signingkey` pointant vers une clé de l'agent. Cette fois l'écart a
été vu **avant le premier commit** : la configuration locale a été posée à
`P2Enjoy <contact@p2enjoy.studio>` — avec `commit.gpgsign false`, la clé globale n'étant pas celle
du responsable — et **aucune réécriture d'historique n'a été nécessaire**. C'est la deuxième
exécution sur cinq où la vérification précède le premier commit ; les trois autres ont dû réécrire.
Le point 2 reste entier : la seule différence entre « réécrire » et « ne rien réécrire » est
l'ordre dans lequel l'agent pense à vérifier, ce qui n'est pas un mécanisme.

**Ce que cette troisième occurrence ajoute au point 2 :** reposer la configuration au début d'une
exécution ne suffit pas si le premier commit est créé avant. Le correctif durable — script
d'amorçage ou variable d'environnement fournie par la routine — n'est plus seulement souhaitable :
il est la seule façon d'éviter une réécriture d'historique à chaque conteneur neuf.

**Ce qui reste à arbitrer :**

1. **La branche.** Soit la routine est autorisée à pousser sur `main` — ce que ses consignes
   demandent —, soit `CLAUDE.md` §13 acte que le travail des exécutions cloud transite par une
   branche et décrit qui l'intègre, et quand. L'état actuel oblige chaque exécution à découvrir le
   travail de la précédente sur une branche qu'elle doit d'abord énumérer.
2. **L'identité.** La configuration locale posée ici vit dans `.git/config`, qui n'est pas versionné :
   elle sera **perdue au prochain conteneur neuf**. Un correctif durable suppose soit un script
   d'amorçage qui la pose, soit une variable d'environnement fournie par la routine.


**QUATRIÈME occurrence du point 2, le 2026-08-05.** Le conteneur de cette exécution rend de nouveau
`user.name = Claude` et `user.email = noreply@anthropic.com`. L'écart a été **vu avant le premier
commit** cette fois — contrairement à la troisième occurrence (décision 159), où deux commits avaient
dû être réécrits —, et la configuration locale a été reposée à `P2Enjoy <contact@p2enjoy.studio>`
avant toute écriture d'historique. Le coût reste **récurrent à chaque conteneur neuf**, et le
correctif durable — script d'amorçage, ou variable d'environnement de l'environnement d'exécution —
reste dû.

---

### INC-035 — Les clés étrangères des migrations `0003`, `0004` et `0005` sont idempotentes sans être convergentes

**Nature :** défaut réel latent, mesuré sur une migration voisine ; les fichiers concernés
appartiennent à des unités déjà vérifiées.
**Relevé le :** 2026-08-04, pendant `CRM-031`.

`CRM-031` a mesuré qu'une contrainte posée en
`if not exists (select 1 from pg_constraint where conname = …)` n'est **jamais réparée** : elle
n'est créée que si le **nom** est absent, si bien qu'une clé remplacée à la main par une clé plus
faible portant le même nom survit à tous les rejeux de la migration. La base reste durablement
affaiblie, et rien ne le signale. Le défaut a été trouvé par la dégradation **d** de
`scripts/verify-workflows.sh`, qui a échoué sur la **restauration** ; il est corrigé dans
`0006_workflows.sql` (`docs/JOURNAL.md`, décision 78).

**Le même motif est présent ailleurs, et n'est pas corrigé ici :**

| Fichier | Contrainte | Unité |
|---|---|---|
| `0004_channels.sql` | `tracks_id_workspace_id_key` (unicité) | `CRM-021` |
| `0004_channels.sql` | `channels_track_id_workspace_id_fkey` | `CRM-021` |
| `0004_channels.sql` | `channel_members_channel_id_fkey` | `CRM-021` |
| `0003_tracks.sql` | `track_members_track_id_fkey` | `CRM-020` |

**Conséquence mesurée sur `CRM-031`, donc reproductible ailleurs.** Une clé composite
`channels_track_id_workspace_id_fkey` remplacée par une clé simple sur `track_id` laisserait un
channel déclarer un `workspace_id` étranger à son track, et la politique de lecture des channels
cloisonnerait alors sur une valeur fausse — exactement ce que `docs/SPEC-channels.md` §2.4 cherche
à empêcher. Aucune commande du dépôt ne rétablirait la clé.

**Ce qui n'est pas fait, et pourquoi.** Corriger ces quatre contraintes reviendrait à rouvrir
`CRM-020` et `CRM-021`, toutes deux vérifiées, dans un commit consacré à une troisième unité, et à
toucher leurs harnais de preuves — ce que `CLAUDE.md` §13 interdit. Le comportement reste
**inchangé** ; aucune de ces contraintes n'est aujourd'hui dégradée sur les bases du projet.

**Arbitrage attendu du responsable.** Trois options :

1. reprendre les deux migrations dans une unité de dette dédiée, en généralisant le mécanisme de
   `0006_workflows.sql` — l'option la plus fidèle à la décision 57, au prix d'une unité de plus ;
2. extraire le mécanisme dans une migration d'amorçage antérieure, de sorte que toutes les
   migrations puissent l'appeler sans le redéfinir, et reprendre les fichiers concernés ;
3. considérer le risque comme théorique — personne ne remplace une contrainte à la main en
   production — et se contenter d'un contrôle de conformité du schéma dans un harnais transverse.

**Lié à :** `docs/JOURNAL.md` décisions 57, 64 et 78 (les trois formes du même défaut).

---

### INC-036 — Les navigateurs préinstallés de l'environnement d'exécution ne correspondent pas au Playwright épinglé

**Nature :** obstacle d'environnement ; aucun fichier du dépôt n'est en cause.
**Relevé le :** 2026-08-04, pendant `CRM-031`.

`package.json` épingle `@playwright/test` 1.62.1, qui attend la révision `1234` du navigateur.
L'environnement de la routine cloud fournit la révision `1194`, sous une arborescence différente —
`chromium_headless_shell-1194/chrome-linux/headless_shell` au lieu de
`chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`.

**Conséquence mesurée.** `npm run e2e:ui` échoue sur ses **37** scénarios, tous avec
« Executable doesn't exist ». Aucune preuve d'interface n'est exécutable, y compris celles qui
n'ont rien à voir avec l'unité en cours. Le projet `api` n'est pas concerné : il ne lance aucun
navigateur.

**Contournement appliqué, et pourquoi il n'est pas la correction.** Une arborescence de
compatibilité a été créée **hors dépôt**, faisant pointer les chemins attendus vers les binaires
présents. Le geste n'est documenté nulle part et la prochaine exécution devra le refaire — même
nature qu'INC-032.

**Prédiction vérifiée, le 2026-08-04, pendant `CRM-032`.** Elle a dû être refaite : le conteneur
neuf fournissait de nouveau la révision `1194`, et `npm run e2e:ui` échouait sur ses **37**
scénarios avant que les liens ne soient recréés. Une fois l'arborescence rétablie, les 37 sont
passés. Comme pour INC-032, le coût est **récurrent**.

**Prédiction vérifiée une SIXIÈME fois, le 2026-08-05, pendant `CRM-036`.** Même révision `1194`
fournie par l'environnement, même exécutable réclamé sous `chromium_headless_shell-1234`, mêmes 37
scénarios rouges. Les liens recréés — `chromium_headless_shell-1234 → 1194`, puis
`chrome-headless-shell-linux64 → chrome-linux` et `chrome-headless-shell → headless_shell` à
l'intérieur —, les 37 scénarios sont passés. Le coût reste **récurrent**, et l'arbitrage reste
attendu.

**Prédiction vérifiée une troisième fois, le 2026-08-04, pendant `CRM-035`.** Même révision `1194`,
même « Executable doesn't exist at
`/opt/pw-browsers/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` »,
mêmes **37** scénarios rouges, y compris ceux qui n'ont rien à voir avec l'unité en cours. Une
observation s'ajoute, et elle aggrave le constat : l'échec est **silencieux pour qui ne lit que le
résumé** — `scripts/verify-webapp.sh` signalait « 10 anomalies » dont neuf « capture manquante », la
cause réelle n'apparaissant qu'en lisant la sortie complète de Playwright. Les liens recréés, les 37
scénarios et les deux harnais concernés sont repassés au vert.

**Prédiction vérifiée une SEPTIÈME fois, le 2026-08-14, pendant `CRM-043`** (décision 377). Même
révision `1194` fournie par le conteneur, même exécutable réclamé sous `chromium_headless_shell-1234`.
La portée observée est cette fois **plus étroite, et l'entrée doit le dire** : ce ne sont pas les
scénarios d'interface qui tombent, mais les **quatre** scénarios Roundcube de `npm run e2e:mail` —
`e2e:ui` n'a pas été atteinte, le projet `ui` résolvant son navigateur par `chromium` et non par le
*headless shell*. Le contournement retenu n'est plus l'arborescence de liens des occurrences
précédentes mais celui de la décision 372, plus court et sans écriture hors dépôt :
`npx playwright install chromium-headless-shell`, qui télécharge le build `1234` attendu. Les quatre
scénarios repassent. Le coût reste **récurrent** — le conteneur suivant repartira du build `1194` —
et l'arbitrage reste attendu.

**Ce qui n'est pas fait, et pourquoi.** `e2e/playwright.config.ts` est un livrable de `CRM-008`,
et y écrire un `executablePath` conditionnel reviendrait à rouvrir cette unité pendant un passage
consacré à une troisième — et à faire dépendre la configuration du dépôt d'un chemin propre à un
environnement d'exécution particulier.

**Arbitrage attendu du responsable.** Trois options :

1. aligner la version épinglée de `@playwright/test` sur celle dont l'environnement fournit les
   navigateurs, au prix d'un suivi de version dicté par l'hébergeur ;
2. rendre l'exécutable configurable par une variable d'environnement documentée, lue par
   `e2e/playwright.config.ts` et vide par défaut ;
3. conteneuriser l'exécution des preuves d'interface, de sorte que la révision du navigateur
   appartienne au dépôt et non à la machine — l'option la plus fidèle à `CLAUDE.md` §3, et la plus
   coûteuse.

**Lié à :** INC-032 et INC-034 (même nature : un chemin du dépôt inatteignable depuis
l'environnement réel).

---

### INC-037 — La Definition of Done de `CRM-032` exige la copie de champs dont la table arrive à `CRM-035`

**Arbitrage final rendu — décision 293, portée par `CRM-018`.** Une copie est utilisable ou elle
n'est pas une copie : champs, règles et exigences sont remappés atomiquement, avec des identifiants
propres. Une empreinte de composition rend aussi visibles les ajouts, modifications et
suppressions ultérieurs de la source. L'historique ci-dessous explique l'origine de l'écart ; il
ne constitue plus une option suspendue.

**Nature :** contradiction d'ordonnancement entre `docs/BACKLOG.md`, `docs/SPEC-workflow-engine.md`
§4 et `docs/MASTER_PLAN.md` §2.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-032`.

La Definition of Done de `CRM-032` exige un test pgTAP prouvant la « copie complète des étapes, des
transitions **et des champs** ». Les champs de formulaire vivent dans `form_fields`, livrée par
`CRM-035` — étape 3.c de `docs/MASTER_PLAN.md` §2, deux unités après celle-ci. MESURÉ :
`to_regclass('public.form_fields')` rend `NULL`.

C'est le même motif qu'INC-010, INC-013, INC-029 et INC-031 : une preuve dont la cible n'existe pas
encore. La différence tient à ce que la conséquence est ici **nulle** tant que `form_fields`
n'existe pas — il n'y a rien à copier, et rien qui manque.

**Comportement retenu :** la fonction copie ce qui existe. `require_fields` — le seul endroit du
modèle qui désigne des champs — est copié **tel quel**, et le restera correctement après `CRM-035` :
les identifiants qu'il porte désigneront des champs du **workspace**, que la copie ne change pas.
Aucune table n'est créée par anticipation : cela préempterait `CRM-035`.

**Ce qui protège l'écart :** il est **figé par une assertion** et non par un commentaire. La suite
`supabase/tests/0008_copie_workflow.test.sql` constate l'absence de `form_fields` (`hasnt_table`) et
deviendra rouge le jour où `CRM-035` la livrera, forçant la reprise de la fonction et de ses preuves
(mécanisme de la décision 51).

**Risque résiduel :** aucun aujourd'hui. Le jour où `form_fields` existera, une copie faite avant
cette date n'aura pas de champs propres — ce qui est correct, puisque les champs appartiendront au
workspace et non au workflow, ou incorrect si `CRM-035` les rattache au workflow. Ce point est
précisément ce que `CRM-035` devra trancher, l'assertion l'y obligeant.

**Arbitrage attendu du responsable**, à trancher **avant `CRM-035`** :

1. rattacher la copie des champs à `CRM-035`, en l'inscrivant dans sa Definition of Done, et
   retirer le mot « champs » de celle de `CRM-032` ;
2. laisser la Definition of Done de `CRM-032` telle quelle et considérer l'unité comme
   partiellement due jusqu'à `CRM-035` ;
3. créer une unité de reprise dédiée, par exemple `CRM-032b`, placée après `CRM-035`.

**Mise à jour du 2026-08-04, pendant `CRM-035` : la conséquence n'est plus nulle, elle est
mesurable.** `form_fields` existe désormais, et `CRM-035` la rattache bien au **workflow**, comme
`docs/SCHEMA.md` §4 l'imposait. C'est la branche que cette entrée annonçait comme « incorrecte » :
la copie posée par le seed porte **zéro champ** là où sa source en porte **sept**. Un channel qui
suivrait la copie afficherait un formulaire vide, sans qu'aucune erreur ne le signale.

Le comportement de `copy_workflow_to_track` reste **inchangé**. La corriger reviendrait à trancher
l'option 1 ci-dessous à la place du responsable, et à rouvrir `CRM-032` — sa fonction, sa suite
pgTAP, ses scénarios d'API et son harnais — pendant un passage consacré à `CRM-035`, ce que
`CLAUDE.md` §13 interdit. C'est le raisonnement déjà retenu pour INC-024, INC-030 et INC-031.

Les trois garde-fous que cette entrée avait posés ont échoué comme prévu, et ont été **révisés
plutôt que retirés** — mécanisme de la décision 51 :

| Garde-fou | Avant | Après |
|---|---|---|
| `supabase/tests/0007_workflows.test.sql` | `hasnt_table('form_fields')` | la table existe, et `require_fields` reste vide dans le seed |
| `supabase/tests/0008_copie_workflow.test.sql` | `hasnt_table('form_fields')` | la table existe, la source porte des champs, **la copie n'en porte aucun** |
| `scripts/verify-copie-workflow.sh` | « `form_fields` n'existe toujours pas » | l'écart est mesuré et chiffré à chaque exécution |

L'écart n'est donc plus une prédiction : il est **compté**, et le jour où la copie des champs sera
écrite, ce sont ces trois assertions qui exigeront leur propre révision.

**Lié à :** INC-013, INC-029, INC-031 (mêmes contradictions d'ordonnancement), INC-033
(`require_fields` sans intégrité référentielle), INC-043 (le même mode de défaillance, sixième
occurrence), `docs/SPEC-form-composer.md` §2.10 et point ouvert n° 3.

**Close le 2026-08-09 par `CRM-018`.** La RPC copie désormais les sept champs, les quinze règles
et l'exigence dans la même transaction, avec des identifiants remappés. Une référence impossible à
remapper refuse tout le lot ; source et copie seedée sont réellement utilisables.

---

### INC-038 — Le signalement de divergence ne voit pas une suppression dans la source

**Nature :** limite mesurée du mécanisme livré par `CRM-032` ; `docs/SPEC-workflow-engine.md` §4.1
promet davantage que ce que le signal détecte.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-032`.

Le §4.1 exige que l'interface signale « ce workflow dérive de *X*, **modifié depuis** le
*jj/mm/aaaa* ». Le signal livré, `workflow_derivations.source_modified_since_copy`, compare
`derived_at` au plus récent `updated_at` du workflow source **et de sa composition**.

**MESURÉ :** une **suppression** dans la source ne modifie aucun `updated_at`. Après avoir retiré
une transition du workflow source, `source_modified_since_copy` vaut toujours **faux**, alors que la
source a bel et bien divergé de sa copie. Le même angle mort vaut pour une étape retirée.

**Comportement retenu par `CRM-032` :** le signal est livré tel quel, sa portée exacte est écrite au
§4.6, et l'angle mort est **figé par une assertion** de `supabase/tests/0008_copie_workflow.test.sql`
qui le constate — de sorte qu'il ne puisse pas être oublié, et qu'une correction future rende
l'assertion rouge. Aucune règle n'est inventée : chacune des corrections possibles engage le schéma,
ce qui dépasse le périmètre d'une unité consacrée à la copie.

**Risque résiduel :** un administrateur qui retire une arête d'un workflow global ne verra apparaître
aucune mention de divergence sur les copies qui en dérivent. Il est borné par le fait qu'aucune copie
n'existe hors du seed, et que l'interface qui afficherait la mention n'existe pas non plus (INC-021).

**Arbitrage attendu du responsable**, à trancher avant que l'interface de `CRM-032` ne soit écrite :

1. stocker à la copie le nombre d'étapes et de transitions copiées, et comparer les cardinalités —
   deux colonnes de plus sur `workflows`, absentes de `docs/SCHEMA.md` §3 ;
2. journaliser les suppressions d'étapes et de transitions dans une table d'événements, ce que
   `card_events` fera pour les cards et qui n'existe pas pour les workflows ;
3. calculer une empreinte de la composition de la source — une somme des identifiants et des
   horodatages — et la comparer à celle enregistrée à la copie, au prix d'une colonne et d'un
   calcul à chaque lecture.

**Lié à :** INC-021 (aucune interface pour afficher la mention), `docs/JOURNAL.md` décision 84.

**Close le 2026-08-09 par `CRM-018`.** Une empreinte SHA-256 canonique remplace le verdict fondé
sur les seuls horodatages. Ajout, modification et suppression de la composition source allument
la divergence ; restaurer exactement la composition l'éteint même si `updated_at` a avancé.

---

### INC-039 — La suppression d'un workspace échoue lorsqu'un de ses workflows instancie ses nœuds

**Nature :** conséquence non anticipée de deux clés étrangères livrées par des unités différentes.
**Relevé le :** 2026-08-04, pendant les mesures de `CRM-032`.

MESURÉ, et reproductible : `delete from public.workspaces where id = …` échoue en `23503` dès qu'un
workflow du workspace porte au moins une étape.

```
ERROR:  update or delete on table "workflow_nodes_catalog" violates foreign key constraint
        "workflow_steps_node_id_workspace_id_fkey" on table "workflow_steps"
DETAIL: Key (id, workspace_id)=(…) is still referenced from table "workflow_steps".
```

La cause est l'ordre dans lequel PostgreSQL propage les cascades. `workspaces` cascade vers
`workflow_nodes_catalog` (`CRM-030`) **et** vers `workflows` (`CRM-031`) ; `workflows` cascade
ensuite vers `workflow_steps`. Lorsque le catalogue est traité avant les workflows, la clé
`workflow_steps.node_id`, posée en `on delete restrict` à dessein (§3.3 : l'effacement silencieux
des étapes détruirait des workflows entiers sans le dire), bloque la suppression entière.

**Ce n'est pas un défaut du `on delete restrict`**, qui protège exactement ce qu'il doit protéger.
C'est une interaction entre deux règles, chacune correcte isolément, que personne n'avait mesurée.

**Conséquence pratique.** Toute suppression d'un workspace — nettoyage de harnais, purge RGPD,
réinitialisation partielle — doit retirer les étapes **avant** le workspace. Les harnais livrés y
échappent par accident : ils suppriment les workflows avant les workspaces, ce qui emporte les
étapes en cascade. Le fait est écrit ici pour que ce ne soit plus un accident.

**Comportement retenu :** aucun changement de schéma. Le contournement — supprimer dans l'ordre —
est appliqué par le harnais de `CRM-032`, et le fait est **figé par une assertion** de
`supabase/tests/0008_copie_workflow.test.sql`, qui provoque le refus et le constate.

**Arbitrage attendu du responsable :**

1. laisser en l'état et documenter l'ordre de suppression comme une contrainte d'exploitation ;
2. passer `workflow_steps.node_id` en `on delete cascade`, ce qui contredirait le §3.3 et rendrait
   silencieuse la destruction d'un workflow par une purge du catalogue ;
3. livrer une fonction `app.purge_workspace(uuid)` qui applique l'ordre correct, à rattacher à
   l'unité RGPD `CRM-072`.

**Lié à :** `docs/SPEC-workflow-engine.md` §3.3 (`on delete restrict` et son motif), `CRM-072`
(conformité RGPD, où une purge réelle sera écrite).

---

### INC-040 — Quatre écritures cassent la cohérence workflow ↔ channel, là où la spécification n'en nommait que deux

**Nature :** insuffisance de la spécification d'origine, constatée par la mesure.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-033`.

Le §4.12 de `docs/SPEC-workflow-engine.md`, écrit à `CRM-000`, nommait deux gestes à surveiller :
l'affectation d'un workflow à un channel, et le déplacement d'un channel vers un autre track. La
mesure en trouve **quatre**, toutes acceptées sur la base du seed :

| # | Écriture | Table visée |
|---|---|---|
| 1 | Rattacher un channel de `studio-web` au workflow `track` de `conseil-ia` | `channels` |
| 2 | Déplacer vers `studio-web` un channel de `conseil-ia` suivant le workflow `track` de `conseil-ia` | `channels` |
| 3 | Changer le `track_id` d'un workflow `track` **sous** les channels qui le suivent | `workflows` |
| 4 | Faire passer le workflow **par défaut** de `global` à `track` sous ses six channels | `workflows` |

Les portes 3 et 4 ne passent pas par la table que la règle prétendait surveiller. La quatrième
invalide d'un seul `UPDATE` le rattachement des **six** channels du seed.

**Comportement retenu :** la spécification est corrigée dans le même changement — §4.12 réécrit après
mesure — et `CRM-033` livre **deux** triggers plutôt qu'un, `docs/JOURNAL.md` décision 89. L'entrée
est ouverte parce que l'écart entre ce qu'une spécification énonce et ce que la base tolère mérite
d'être tracé, non parce qu'il resterait quelque chose à trancher.

**Ce qui reste à arbitrer :** rien pour `CRM-033`. En revanche, le mode de défaillance est
**transverse** : chaque fois qu'une règle relie deux tables, la spécification d'origine n'a nommé que
la table « évidente ». Le responsable peut vouloir qu'une relecture systématique des chapitres non
encore mesurés — §5 à §9 de ce document, `docs/SPEC-form-composer.md` — cherche les portes
symétriques avant que les unités correspondantes ne les découvrent une à une.

**Lié à :** `docs/SPEC-workflow-engine.md` §4.12.1 (les quatre portes), `docs/JOURNAL.md`
décision 89 ; INC-029 (la dette `NOT NULL` que la même unité solde).

---

### INC-041 — Le seed de `CRM-032` est idempotent sans être convergent : une copie déplacée en fait naître une seconde

**Nature :** défaut réel du produit livré, trouvé par la mesure et reproductible.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-033`.

La section 7 du seed cherche la copie du workflow par `derived_from_workflow_id` **et** par
`track_id`. MESURÉ, en quatre gestes reproductibles :

```
1. seed appliqué sur une base neuve          → 1 copie, sur le track « Conseil & IA »
2. track_id de la copie déplacé à la main    → 1 copie, sur « Formation »
3. seed rejoué                               → la recherche ne trouve rien
4. état final                                → 2 copies, sur deux tracks différents
```

Le contrat du §4.10 en déclare **une**. Le seed en laisse deux, sans erreur ni avertissement.

C'est la troisième forme du défaut de la décision 57, après celle de `CRM-020` sur une contrainte
`CHECK` et celle de `CRM-031` sur une contrainte nommée : un mécanisme **idempotent** — rejouable
sans erreur — qui n'est pas **convergent** — il ne ramène pas l'état à ce que le contrat déclare.
Cette fois, ce n'est pas une migration mais un seed, ce qui explique qu'aucun des garde-fous posés
pour les deux précédentes ne l'ait vu.

**Comportement retenu :** corrigé par `CRM-033`, dans le même changement que la réécriture de la
section du seed qu'impose la contrainte `NOT NULL` (§4.12.5). La copie est cherchée par sa **seule**
dérivation, et son `track_id` est **ramené** à la valeur déclarée plutôt que servir de critère de
recherche. Le harnais de `CRM-033` reproduit la dégradation et constate la restauration, sans quoi le
défaut pourrait revenir en silence.

**Révision de sécurité, décision 300.** Supprimer toutes les dérivations surnuméraires pour obtenir
un compte global de un confondait convergence du seed et propriété des données. Une copie créée par
un utilisateur n'appartient pas au seed. La candidate seedée est désormais choisie par son contrat
exact, avec repli sur une dérivation unique ; un état ambigu est refusé et aucune copie
supplémentaire n'est détruite. La convergence signifie « ne pas recréer la fixture », pas « ramener
toutes les copies utilisateur à un compte global de un ».

**Révision de conformité, décision 303.** La candidate moderne ne peut pas davantage être déclarée
conforme par ses seuls volumes : une altération de libellé, d'option, de règle ou d'exigence à compte
constant échappait au contrôle. Le seed compare désormais la composition métier normalisée de sa
candidate à la source et refuse toute différence sans écraser la cible. Les autres dérivations ne
participent toujours ni à cette comparaison ni aux assertions de la fixture.

**Ce qui reste à arbitrer :** faut-il un contrôle transverse de convergence du seed — un harnais qui
dégraderait chaque objet déclaré et vérifierait que le rejeu le ramène —, plutôt qu'une vérification
ajoutée unité par unité après chaque défaut trouvé ? Les trois occurrences plaident pour, mais le
coût est celui d'un harnais de plus, à maintenir avec le contrat du seed.

**Lié à :** `docs/JOURNAL.md` décisions 57, 64, 78 (les formes précédentes du même défaut) et 91 ;
`docs/SPEC-workflow-engine.md` §4.12.7 ; `docs/SPEC-seed.md` §2.9.

---

### INC-043 — `CRM-034` précède de trois à dix unités toutes les tables dont sa garde a besoin

**Nature :** contradiction d'ordonnancement entre `docs/MASTER_PLAN.md` §2,
`docs/SPEC-workflow-engine.md` §5 et `docs/BACKLOG.md`.
**Relevé le :** 2026-08-04, avant de choisir l'unité de ce passage.

`docs/MASTER_PLAN.md` §2 place `CRM-034` — la garde centrale `move_card` — à l'étape 3.b, et le
justifie ainsi : « le moteur de workflow avant les cards, car une card naît dans une étape ». Le
raisonnement vaut pour `CRM-030` à `CRM-033`, qui décrivent le graphe. Il **s'inverse** pour
`CRM-034`, dont les six vérifications du §5 ne portent sur rien d'autre que des cards.

MESURÉ sur la base du seed, la pile en marche :

```
cards=NULL   card_events=NULL   card_comments=NULL   card_field_values=NULL
form_fields=NULL   form_field_rules=NULL   move_card=NULL
```

Chacune des six vérifications exigées, et l'unité qui livrera sa cible :

| # | Vérification du §5 | Objet requis | Unité |
|---|---|---|---|
| 1 | La card existe et n'est ni archivée ni supprimée | `cards` | `CRM-040` |
| 2 | L'appelant a le droit d'écriture sur le channel | `cards`, `app.can_write_channel` | `CRM-040`, `CRM-012` |
| 3 | L'étape cible appartient au workflow de la card | `cards` | `CRM-040` |
| 4 | Une transition est déclarée | `cards` (livrée : `workflow_transitions`) | `CRM-040` |
| 5 | Le commentaire est fourni si la transition l'exige | `card_comments` | `CRM-043` |
| 6 | Les champs requis de l'étape cible sont renseignés | `form_fields`, `form_field_rules`, `card_field_values` | `CRM-035`, `CRM-036` |

Et l'effet de bord exigé en cas de succès — « écriture d'un `card_event` de type `moved` » — vise
`card_events`, livrée par `CRM-044`.

C'est le sixième cas du même mode de défaillance, après INC-010 (clés étrangères), INC-013
(jointures d'autorisation), INC-029 (une colonne), INC-031 (une cible d'archivage) et INC-037 (des
champs à copier). Il s'en distingue par son **ampleur** : les précédents laissaient une part
livrable de l'unité, celui-ci n'en laisse **aucune**. `move_card` sans `cards` n'est pas une garde
partielle, c'est une signature vide.

**Comportement retenu :** `CRM-034` n'est pas commencée, et reste `[ ]`. Aucune table n'est créée
par anticipation — cela préempterait `CRM-040`, `CRM-043` et `CRM-044` en même temps. Le passage a
pris l'unité `[ ]` suivante que l'ordre du plan n'interdit pas, `CRM-035`, dont les deux tables ne
dépendent que de `workflows` et de `workflow_steps`, livrées. **Aucune contrainte d'ordre de
`docs/MASTER_PLAN.md` §2 n'est enfreinte** : les trois qui concernent ces unités sont « `CRM-034`
avant `CRM-041` », « `CRM-036` avant `CRM-037` » et « `CRM-004` avant `CRM-052` », toutes intactes.

**Arbitrage attendu du responsable.** Trois options :

1. **déplacer `CRM-034` après `CRM-040`** dans `docs/MASTER_PLAN.md` §2, en conservant la
   contrainte « `CRM-034` avant `CRM-041` » qui reste juste — l'ordre deviendrait
   `CRM-035` → `CRM-036` → `CRM-040` → `CRM-034` → `CRM-037` → `CRM-041` ;
2. **scinder `CRM-034`** en une partie livrable maintenant — le catalogue des refus, leurs
   `SQLSTATE` et le format du message listant les clés manquantes — et une partie exécutable après
   `CRM-040`, au prix d'une unité dont la moitié ne s'exécute jamais ;
3. **laisser l'ordre inchangé** et accepter que `CRM-034` reste bloquée jusqu'à `CRM-040`, ce qui
   revient à l'option 1 sans l'écrire.

**Lié à :** INC-010, INC-013, INC-029, INC-031, INC-037 (le même mode de défaillance, cinq fois
avant celui-ci), INC-023 (une Definition of Done dont les sujets arrivent plus tard).

---

### INC-045 — Aucun chapitre ne nommait les politiques de `track_members` et `channel_members`

**Nature :** référence manquante dans `docs/SPEC-permissions-rls.md` §4.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-012`.

Le tableau « Politiques par famille de tables » du §4 énumère vingt tables, de `profiles` à
`saved_views`. `track_members` et `channel_members` n'y figuraient pas — alors qu'elles sont
l'objet même de `CRM-012`, dont le titre est « droits fins par track et channel ». Le document
spécifiait donc comment un droit fin **se résout** (§2.2) sans jamais dire qui a le droit d'en
**poser** un, ni de le lire.

C'était la jumelle d'INC-014, à une différence près qui change tout : INC-014 constatait que les
politiques des tables d'**identité** n'étaient portées par aucune unité — elles le sont depuis par
`CRM-022` ; ici, l'unité qui porte les tables est nommée sans ambiguïté par son propre titre, et
c'est la **règle** qui manquait, non son porteur.

**Comportement retenu :** la règle est écrite en `docs/SPEC-permissions-rls.md` §4.1, dans le
commit documentaire qui précède le code, et les tables sont ajoutées au tableau du §4. Sans elle,
`CRM-012` aurait livré un mécanisme de droits fins qu'aucun administrateur ne peut opérer depuis le
produit : les deux tables restaient en refus par défaut depuis `CRM-003`, et seul `service_role`
pouvait y écrire.

**Ce qui n'était pas décidé ici :** rien qui déborde des deux tables. Les politiques des tables
d'identité restaient hors de `CRM-012`; `CRM-022` et INC-014 ont depuis donné un porteur à la règle
du dernier administrateur et à sa preuve n° 10.

**Arbitrage attendu du responsable :** confirmer la règle du §4.1, en particulier le choix de
réserver la **lecture** d'un droit fin à l'administration et à l'intéressé. Un produit qui
afficherait « qui a accès à ce channel » à tout membre du workspace exigerait une lecture plus
large ; c'est un choix de produit, et il est réversible.

**Lié à :** INC-011 (l'absence de `workspace_id` oblige les politiques à remonter par `tracks`),
INC-013, INC-014, INC-024 et INC-030.

---

### INC-049 — La preuve de refus n° 5 figure dans deux Definitions of Done à la fois

**Nature :** chevauchement de périmètre entre `CRM-034` et `CRM-013`.
**Relevé le :** 2026-08-04, pendant la spécification de `CRM-034`.

`docs/SPEC-permissions-rls.md` §7 numérote douze preuves de refus. La n° 5 — « mise à jour directe
de `cards.current_step_id` par PostgREST → refus » — est réclamée par **deux** unités :

- `CRM-034`, dont la Definition of Done dit « preuves de refus n° 1 et 5 » ;
- `CRM-013`, dont la Definition of Done dit « `current_step_id` et `email_local_part` non
  modifiables directement » et « preuves de refus n° 5, 6 et 8 ».

Ce n'est pas une redondance sans conséquence. **Sans la protection de colonne, `move_card` ne garde
rien** : n'importe quel client contourne les six vérifications par un `PATCH`. Livrer `CRM-034` en
laissant la colonne ouverte reviendrait à livrer une garde décorative et à en apporter la preuve par
un test qui ne teste pas le produit réel.

**Comportement retenu :** la protection de `cards.current_step_id` est livrée par **`CRM-034`**,
parce qu'une unité dont la Definition of Done exige une preuve doit livrer ce qui la rend possible.
Le périmètre restant de `CRM-013` est **réduit et nommé** : `cards.email_local_part`,
`mail_inbound_accounts.secret_id`, `mail_outbound_identities.secret_id`, `api_tokens.token_hash`,
`card_events.*`, `audit_log.*` — cinq cibles sur six dont les tables n'existent pas encore. Le
mécanisme mesuré est écrit dans `docs/SPEC-permissions-rls.md` §4.3 pour que `CRM-013` le reprenne
sans le redécouvrir.

**Risque résiduel, et il est réel :** le retrait du `GRANT UPDATE` de table ferme **par défaut**
toute colonne ajoutée plus tard à `cards`. Une migration ultérieure qui ajouterait une colonne
modifiable et oublierait l'énumération la rendrait silencieusement en lecture seule. Le fait est
écrit au §4.3 et **figé par une assertion** de `supabase/tests/0013_move_card.test.sql`, qui
énumère les colonnes ouvertes une par une : ajouter une colonne sans trancher son cas fera échouer
la suite.

**Arbitrage attendu du responsable :** confirmer ce partage, ou rendre la protection de colonne à
`CRM-013` — auquel cas `CRM-034` doit être livrée en sachant que sa garde est contournable, et sa
Definition of Done amendée pour retirer la preuve n° 5.

**Lié à :** INC-026 (le message de refus divulgue le `GRANT`), `CRM-013`.

---

### INC-051 — La ligne i du contrat d'API de `move_card` nomme un profil que le seed ne peut pas mettre en défaut

**Nature :** erreur de fait dans une spécification, mesurée contre la pile réelle.
**Relevé le :** 2026-08-04, pendant l'implémentation de `CRM-034`.

`docs/SPEC-workflow-engine.md` §5.8 énumère treize appels à mesurer. Sa ligne i dit :

| # | Appelant | Appel | Attendu |
|---|---|---|---|
| i | `bizdev` | card d'un channel fermé par un droit fin | `400`, `card_not_found` — discrétion |

**MESURÉ le 2026-08-04 contre la pile réelle**, avec le jeton du compte seedé : le `bizdev`
**lit les neuf cards du seed**, et l'appel rend `200`. Le tableau des droits effectifs le confirme —
`app.can_read_channel` rend `true` pour lui sur les quatre channels qui portent des cards.

Le motif est dans le seed lui-même (`docs/SPEC-seed.md` §2.11) : ses quatre droits fins ferment le
track `conseil-ia` au **viewer** et à l'**administratrice**, et rétrogradent le `bizdev` en lecture
sur le channel `maintenance`. **Aucune ligne ne ferme quoi que ce soit au `bizdev`** — une
rétrogradation en lecture n'est pas une fermeture, et elle produit `forbidden`, pas
`card_not_found`. La ligne i est donc insatisfaisable telle qu'écrite, et le §5.9 pose par ailleurs
que le seed **n'est pas modifié** par cette unité.

**Comportement retenu :** le profil retenu pour la ligne i est le **`viewer`**, à qui le seed ferme
réellement le track de `grands-comptes`. Ce choix est meilleur que celui d'origine, et pas seulement
faute de mieux : les lignes h et i sont désormais exercées **par le même jeton**, ce qui est la
seule façon d'exclure que l'écart entre `forbidden` et `card_not_found` vienne du profil plutôt que
de la règle de discrétion. Le fait qui rend la ligne d'origine inapplicable est lui-même **figé par
un scénario** de `e2e/api/move-card.spec.ts`, qui mesure le `200` du `bizdev` et deviendra rouge si
un droit fin venait à lui fermer ce channel. Un scénario supplémentaire couvre la rétrogradation du
`bizdev` sur `maintenance`, qui exerce l'autre chemin vers `forbidden`.

**Arbitrage attendu du responsable :** corriger la ligne i du §5.8 pour qu'elle nomme le `viewer`,
ou ajouter au seed un droit fin fermant un channel au `bizdev` — ce que le §5.9 interdit
aujourd'hui, et qui n'apporterait aucune preuve que le `viewer` n'apporte déjà.

**Lié à :** `docs/SPEC-seed.md` §2.11, `CRM-012`.

---

### INC-053 — `SPEC-form-composer` §2.3 confie la résolution de `user` et `contact` à deux unités sans dire laquelle fait quoi

**Nature :** référence ambiguë dans `docs/SPEC-form-composer.md` §2.3.
**Relevé le :** 2026-08-05, pendant la spécification de `CRM-036`.

Le §2.3 énonce : « Déclarer un champ de type `contact` est donc licite dès `CRM-035` ; le
**résoudre** appartient à `CRM-036` et à `CRM-060`. » La phrase désigne deux unités et n'attribue
rien : elle ne dit ni ce que chacune doit résoudre, ni ce que « résoudre » signifie.

**Ce que `CRM-036` a mesuré et retenu.** Trois types désignent des objets : `user` vise `profiles`
(livrée), `contact` vise `contacts` (`CRM-060`, non commencée — MESURÉ,
`to_regclass('public.contacts')` rend `NULL`), `file` vise Storage, service distinct. `CRM-036`
valide donc la **forme** d'un `uuid` pour `user` et `contact`, et une chaîne pour `file`. Aucune
résolution n'est faite.

**Pourquoi ne pas résoudre `user`, qui serait possible.** Deux raisons, dont la seconde est la vraie :

1. la famille deviendrait incohérente — deux types voisins, l'un opposable et l'autre non, sans que
   rien dans le formulaire ne le laisse voir ;
2. surtout, cela **poserait une règle que nul document n'énonce** : un `user` doit-il être membre du
   workspace de la card ? un membre du workspace suffit-il ? un profil quelconque ? Le §2.3 ne le dit
   pas, `docs/SPEC-permissions-rls.md` non plus, et chacune de ces réponses est une décision de
   produit défendable.

**Comportement retenu :** la validation de forme, et rien de plus. L'écart est nommé au §6.5 et au
§6.12 de `docs/SPEC-form-composer.md`, et figé par une assertion de
`supabase/tests/0014_valeurs_champs.test.sql` qui constate qu'un `uuid` bien formé désignant un
profil **inexistant** est accepté aujourd'hui.

**Arbitrage attendu du responsable.** Trois options :

1. **résoudre `user` contre `profiles`**, en nommant la règle d'appartenance attendue, et laisser
   `contact` à `CRM-060` — au prix de l'incohérence temporaire de la famille ;
2. **rattacher les deux résolutions à `CRM-060`**, qui livrera `contacts` et pourra traiter la
   famille d'un seul geste — c'est la lecture la plus économe, et elle laisse le comportement actuel
   inchangé jusque-là ;
3. **renoncer à toute résolution**, en assumant qu'un `jsonb` ne porte aucune intégrité et que
   l'interface seule proposera des valeurs valides — au prix d'un `PATCH` direct capable d'écrire
   n'importe quel `uuid`.

**Lié à :** INC-033 (aucune intégrité référentielle possible sur un `uuid[]`, même famille de
limite), `CRM-060`.

---

### INC-054 — `SCHEMA` §4 exigeait `value` non nul, ce qui rendait inatteignable le « vide explicite » que la ligne suivante spécifie

**Nature :** contradiction interne à `docs/SCHEMA.md` §4, révélée par une mesure.
**Relevé le :** 2026-08-05, pendant `CRM-036`, **par l'échec du seed**.

Le tableau de `card_field_values` posait deux règles dans la même ligne : « `value` `jsonb` **non
nul** ; `'null'::jsonb` signifie explicitement vide ». La seconde suppose que `'null'::jsonb` soit
écrivable ; la première interdit tout le reste.

**MESURÉ le 2026-08-05** contre PostgREST `v14.12`, sur une table sonde créée puis détruite :

| Corps envoyé | Colonne `jsonb` obtenue |
|---|---|
| `{"v": null}` | **SQL NULL** |
| `{"v": "null"}` | la chaîne `"null"` |
| `{"v": [null]}` | le tableau `[null]` |

**Aucune écriture d'API ne produit `'null'::jsonb`.** La conséquence n'est pas théorique : « vider un
champ » devenait impossible pour tout type dont la validation refuse la chaîne vide. Un `money`
renseigné par erreur n'avait aucune écriture licite qui le remette à vide — chaîne vide refusée par
la validation de type, SQL NULL par la contrainte de colonne, aucune suppression exposée.

**Comportement retenu :** `value` est **nullable**, et SQL NULL vaut « explicitement vide » au même
titre que `'null'::jsonb` (décision 133). `docs/SCHEMA.md` §4 et `docs/SPEC-form-composer.md` §6.2 et
§6.6 sont corrigés dans le même changement.

**Pourquoi la contradiction est tranchée plutôt que consignée sans suite.** `CLAUDE.md` §5 impose de
consigner et de laisser le comportement inchangé — mais il n'y avait **aucun comportement** à
laisser : la table naissait dans ce commit, et les deux branches ne décrivent pas deux produits
possibles, seulement une règle réalisable et une qui ne l'est pas. Consigner sans trancher aurait
livré une valeur impossible à retirer.

**Où le défaut a été trouvé, et pourquoi cela compte.** Par le **seed**, qui est le premier client
réel du produit et emprunte les mêmes routes qu'un utilisateur (`CLAUDE.md` §8). Aucune suite pgTAP
ne l'aurait vu — `insert … values (…, 'null'::jsonb)` en SQL passe très bien —, et aucun test d'API
écrit **après** le code non plus, puisqu'il aurait été écrit contre le comportement observé.

**Action attendue du responsable :** confirmer la lecture, ou nommer la raison pour laquelle
`value` devrait rester `NOT NULL` malgré l'impossibilité d'écrire `'null'::jsonb` depuis l'API.

**Lié à :** INC-025 (autre lacune des tableaux de `docs/SCHEMA.md`), INC-033 (autre limite mesurée
d'un type plutôt que d'un choix).

---

### INC-056 — Trois garde-fous comptaient une donnée que `copy_workflow_to_track` duplique, et leur valeur dépendait de l'âge de la base

**Arbitrage rendu — `docs/JOURNAL.md`, décisions 262 puis 293.** La table de liaison rend le
comptage déterministe et la copie remappe l'exigence vers le champ de sa propre composition. Mise
en œuvre : `CRM-018`.

**Nature :** garde-fous non déterministes, livrés par `CRM-031`, `CRM-035` et `CRM-036`.
**Relevé le :** 2026-08-05, pendant `CRM-013`, sur une base **froide**.

Trois contrôles comptaient, **à l'échelle du workspace**, les transitions dont `require_fields`
n'est pas vide, et attendaient `1` :

- `supabase/tests/0007_workflows.test.sql` ;
- `supabase/tests/0010_champs_formulaire.test.sql` ;
- `scripts/verify-champs-formulaire.sh`.

MESURÉ sur une base créée de zéro — `./runDev.sh` puis `supabase/seed/apply-seed.sh` sur un cluster
neuf — le compte vaut **2**, et les trois contrôles échouent. La cause est mécanique :

1. la section 6 du seed pose `require_fields` sur « Démarrer la réalisation » du workflow global ;
2. la section 7, **ensuite**, appelle `copy_workflow_to_track`, qui recopie `require_fields` tel
   quel (INC-037) — son propre commentaire dit encore « il est vide partout aujourd'hui », prémisse
   que `CRM-036` a invalidée ;
3. la copie hérite donc de l'exigence, et le workspace en porte deux.

Sur une base **ancienne**, la copie a été créée avant `CRM-036` et ne porte rien : le compte vaut
`1`, et c'est là que `CRM-036` l'a mesuré. Les trois contrôles mesuraient donc **l'âge de la base**,
non le produit.

**Ce que cela dit de plus grave que trois assertions.** `CLAUDE.md` §8 pose que le seed est un
contrat **reproductible**. Ici, `./resetMe.sh` ne reproduisait pas l'état sur lequel les preuves
avaient été écrites : deux exécutions de la même commande, sur deux historiques différents,
donnaient deux états différents. Un garde-fou qui dépend de l'historique de la base ne garde rien.

**Comportement retenu :** **inchangé**. Le comportement de `copy_workflow_to_track` appartient à
`CRM-032` et relève d'INC-037, déjà ouverte. Les trois contrôles sont **rendus déterministes** —
ils comptent désormais sur le workflow **global** — et l'héritage de la copie est **compté
séparément**, par une assertion neuve dans `supabase/tests/0007_workflows.test.sql` et un contrôle
neuf dans `scripts/verify-champs-formulaire.sh`. Rien n'est relâché : le total du workspace reste
`2`, et il est désormais affirmé plutôt que subi.

**Ce qui reste à trancher, et qui n'appartient pas à `CRM-013` :**

1. `copy_workflow_to_track` doit-elle recopier `require_fields` alors que la copie ne reçoit
   **aucun** champ ? L'exigence y est inerte — la sixième vérification de `move_card` ignore un
   identifiant qu'elle ne résout pas (décision 128). C'est INC-037, aggravée.
2. Le seed doit-il poser `require_fields` **après** la copie, de sorte que l'ordre des sections ne
   décide plus du contenu ? Ce serait une correction à un seul endroit, mais elle appartient à
   `CRM-005` / `CRM-046`.

**Action attendue du responsable :** trancher le point 1 avec INC-037, et dire si le point 2 doit
être rattaché au seed de démonstration complet (`CRM-046`).

**Lié à :** INC-037 (la copie recopie `require_fields`), INC-033 (`require_fields` sans intégrité
référentielle), `CLAUDE.md` §8 (le seed est reproductible).

**Close le 2026-08-09 par `CRM-018`.** La liaison est comptée séparément dans la source et dans la
copie remappée ; aucun compte global ne dépend plus de l'âge de la base. Le reset froid et le seed
rejoué prouvent le même état : une exigence fonctionnelle dans chacun des deux workflows.

---

### INC-098 — `VAULT_ENC_KEY` est documentée comme la clé des secrets de messagerie, alors que seul le pooler la lisait

**Arbitrage rendu — `docs/JOURNAL.md`, décision 366.** La variable est retirée avec Supavisor, son
unique consommateur. Mise en œuvre : `CRM-001`.

**Nature :** description fausse d'une variable obligatoire, dans deux documents de référence.
**Relevé le :** 2026-08-13, en instruisant le retrait du pooler.

`docs/PROD_MIGRATIONS.md` §2 la présente comme « Chiffrement des secrets de messagerie », obligatoire
en production, et `README.md` §9 la range parmi les clés de chiffrement à 32 caractères. Or la
recherche de `VAULT_ENC_KEY` dans le dépôt ne rend **qu'une seule** consommation :
`docker-compose.yml` ligne 362, dans le service `supavisor`. Aucun autre service, aucun script,
aucune migration ne la lit.

Les secrets de messagerie sont chiffrés par un mécanisme **entièrement distinct** : le Vault de
Supabase, à l'intérieur de PostgreSQL, écrit par `vault.create_secret()` et
`vault.update_secret()` aux migrations `0022`, `0023` et `0033`, et lu par
`vault.decrypted_secrets`. Sa clé racine appartient à la base, pas à une variable de Compose.

**Ce que cela dit de plus grave qu'une ligne de tableau.** Un opérateur qui lit le contrat de
déploiement en conclut qu'une rotation de `VAULT_ENC_KEY` mettrait les mots de passe IMAP et SMTP
hors d'atteinte, et qu'il faut la sauvegarder comme telle. Les deux conclusions sont fausses. Une
variable mal décrite dans un contrat de déploiement est pire qu'une variable absente : elle oriente
une manœuvre de production sur une prémisse inexistante, ce que `CLAUDE.md` §12 interdit
précisément à ce document.

**Comportement retenu :** la variable est **supprimée** — de `.env.example`, de son amorçage dans
`scripts/lib/env.sh`, de ses contrôles dans `scripts/verify-scripts.sh`, du contrat de déploiement
et du README. Rien n'est relâché : le chiffrement réel des secrets de messagerie est inchangé,
puisqu'il n'a jamais dépendu d'elle.

**Reste ouverte jusqu'à :** la preuve du démarrage à froid de la pile sans Supavisor et sans cette
variable, `scripts/verify-stack.sh` rejoué au vert.

**Lié à :** décision 366 (retrait du pooler), décision 14 (descripteurs de fichiers),
`docs/SPEC-mail-subsystem.md` §2.3 (secrets et Vault), `CLAUDE.md` §12 (contrat de déploiement).
