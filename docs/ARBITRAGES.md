# Dossier d'arbitrage — questions ouvertes en attente de décision

Document de **travail du responsable**. Il ne remplace pas `docs/INCONSISTENCY_REPORT.md`, qui
reste la source de vérité de chaque constat : il le **trie**, propose des options chiffrées en
avantages et inconvénients, et recommande une issue.

Une entrée disparaît d'ici lorsque la décision est prise, écrite dans `docs/JOURNAL.md`, et
l'entrée `INC-` correspondante déplacée en « Clos ».

---

## État au 2026-08-06, après la passe de revue

| | Avant la passe | Après |
|---|---|---|
| Entrées du registre | 80 | 80 |
| **Ouvertes** | 74 | **40** |
| Closes | 6 | **40** |

**Trente-quatre entrées fermées en une passe**, en deux temps et par deux moyens distincts, qui ne
se valent pas :

- **Dix par arbitrage du responsable** — les cinq décisions de premier rang (`docs/JOURNAL.md`
  décisions 239 à 243) et la validation des recommandations de ce dossier.
- **Dix par la mesure** — leur prémisse n'était plus vraie. Ce sont, pour l'essentiel, des
  contradictions d'**ordonnancement** : elles constataient qu'une unité avait besoin d'une table
  qu'une unité ultérieure devait livrer. Ces unités sont livrées, les tables existent, les clés
  étrangères sont posées : le constat s'éteint de lui-même.
- Le reste par les unités qui les portaient.

**Aucune entrée n'a été close par déclaration.** Celles dont la prémisse n'a pas été mesurée ce
jour sont restées ouvertes, même lorsqu'elles paraissaient périmées.

### Ce qui a été décidé, et ce qui reste à faire

Les décisions ci-dessous sont **prises et persistées**. Leur **mise en œuvre**, elle, est du travail
rattaché à une unité — elle n'est pas faite.

| Décision | Mise en œuvre rattachée à |
|---|---|
| `CRM-009` porte l'écran de connexion, la session et la garde de route | unité créée, `[ ]` |
| La session vit en `sessionStorage`, jamais en `localStorage` | `CRM-009` |
| `CRM-015` câble le secret de build `npm_ca` | unité créée, `[ ]` |
| Le parcours d'invitation est rattaché à `CRM-070` | `CRM-070` |
| La garde de ports lit `/proc/net/tcp` en dernier recours | `CRM-002` |
| `cards.amount` est converti explicitement à la lecture | `CRM-040`, `CRM-041` |
| Le fil nomme `channel_changed` au lieu d'afficher « Événement » | `CRM-044` |
| `move_card` **conserve** le commentaire de transition au lieu de le jeter | `CRM-034` |
| Un commentaire de transition est normalisé sur **tous** les blancs | `CRM-034` |
| `role="alert"` ne porte que sur l'erreur, jamais sur la mention d'exigence | `CRM-037` |
| `CRM-076` porte l'éditeur de workflow | unité créée, `[ ]` |
| La routine est **sérialisée** : une seule exécution active | planificateur, **hors dépôt** |
| Un harnais attend réellement la fin d'un rejeu de migrations | `CRM-003` |
| Le ménage d'un harnais passe **avant** sa mesure | `CRM-040` |
| **Convergent, jamais seulement idempotent** — principe posé pour tout le dépôt | `CRM-003`, `CRM-040` |
| Un `@verifies` n'annonce que ce que le fichier prouve | `CRM-040` |
| La preuve de refus n° 5 appartient à `CRM-013` seule | `CRM-013` |
| Revue transverse des harnais sur le contrôle de restitution | `CRM-008` |
| Le détecteur de textes en dur est corrigé, mesuré **dans les deux sens** | `CRM-008` |
| Commenter exige le droit d'**écriture** sur le channel | documentation seule |

---

## Les quarante entrées qui restent

Elles ne sont **pas** un reliquat indifférencié. Trois familles, et rien ne se joue de la même
façon dans chacune.

### Famille 1 — Elles attendent une **mesure**, pas une décision (2)

Leur cause n'est pas établie. Décider avant de mesurer serait deviner.

| Entrée | Ce qu'il faut mesurer |
|---|---|
| **INC-080** | Trois classes ne sont plus engendrées dans le CSS produit. Dérive réelle de l'affichage, faux positif de l'extracteur, ou dérive d'outillage ? Ouvrir le CSS produit et les composants qui les citent |
| **INC-036** | Le contournement du navigateur préinstallé fonctionne, mais sa portée exacte n'est pas mesurée : quelles preuves d'interface reposent dessus, et laquelle tomberait si la révision changeait encore |

### Famille 2 — À trancher **avant une unité nommée** (7)

Elles ne bloquent rien aujourd'hui, et bloqueront tout le jour où l'unité démarrera.

| Entrée | À trancher avant | Question |
|---|---|---|
| **INC-002** | `CRM-054` | Empreinte de repli pour un message sans `Message-ID`. **Élément nouveau** : `CRM-050` a mesuré que `SEARCH HEADER Message-ID` ne rend rien sous Stalwart `v0.16.16` |
| **INC-004** | `CRM-054` | Tout accepter et signaler l'expéditeur inconnu, ou restreindre l'ingestion |
| **INC-046** | `CRM-054` | « Figé à la création, suit le channel » : deux règles distinctes, dont la seconde interdit un geste que nulle spécification n'aborde |
| **INC-065** | `CRM-054` | Ce qu'une adresse de card incohérente avec son track doit rendre |
| **INC-073** | `CRM-054` | Deux fonctions différentes sous le nom `move_card_to_channel` |
| **INC-053** | `CRM-060` | Qui résout `user` et `contact` : `CRM-036` ou `CRM-060` |
| **INC-032**, **INC-034** | `CRM-015` | Les deux dernières faces de l'environnement d'exécution ; `CRM-015` en ferme une partie |

### Famille 3 — Comportement retenu, correct, en attente de confirmation (31)

Ce sont les plus nombreuses, et les moins urgentes. Chacune décrit un choix **déjà fait, déjà
livré et déjà prouvé**, dont seule la confirmation manque. Les clore n'apporterait rien tant que
le comportement ne change pas ; les ignorer ferait perdre la trace du choix.

Elles se regroupent en cinq thèmes, et **la recommandation est la même pour tous** : les traiter
par lots, un commit par thème, en vérifiant chaque correction contre le code réel.

| Thème | Entrées | Recommandation |
|---|---|---|
| **Documentation en retard sur l'état réel** | INC-017, INC-019, INC-069, INC-078 | Corriger et clore. Aucune décision requise, aucun code. **Le lot le moins cher du registre** |
| **Périmètre non tranché** | INC-005, INC-007, INC-008, INC-014, INC-023, INC-026, INC-027, INC-045, INC-066 bis | Chacune demande « cette chose entre-t-elle au périmètre ? ». À répondre par oui-avec-unité ou non-avec-retrait de la mention |
| **Limites mesurées d'un tiers ou d'un type** | INC-012, INC-016, INC-018, INC-033, INC-036 | Rien à corriger : ce sont des faits. À **confirmer** pour qu'ils cessent de ressembler à des questions |
| **Choix de modélisation assumés** | INC-011, INC-025, INC-028, INC-038, INC-039, INC-040, INC-041, INC-051, INC-054, INC-056 | Le comportement est livré et prouvé. À confirmer, ou à rouvrir explicitement |
| **Défauts réels, non corrigés** | INC-072, INC-075, INC-076 | Les seules de cette famille où quelque chose est **cassé** : un compte devenu indestructible dès qu'il a commenté (INC-076), un channel consenti par le backend et inatteignable par la navigation (INC-075), aucune modération possible d'un commentaire déplacé (INC-072) |

**Recommandation de priorité dans la famille 3 : commencer par les trois derniers.** INC-076 est
une régression mesurée — `DELETE /auth/v1/admin/users/<id>` rend `500` sur toute base seedée, et
trois contrôles de `scripts/verify-seed.sh` le constatent sans le nommer. Les deux autres sont des
droits que le backend accorde et que le produit ne sait pas exercer.

---

## Ordre d'exécution recommandé

1. **`CRM-015`** — le secret de build. Petit, et il rend `runDev.sh` exécutable : c'est la preuve
   manquante de `CRM-050`, et de toutes les unités d'interface à venir.
2. **`CRM-009`** — l'écran de connexion et la session. Déverrouille dix-huit unités `[~]`, qui
   seront ensuite reprises **une par une**, leur preuve manquante réellement exécutée.
3. **Le lot « documentation en retard »** de la famille 3 — quatre entrées, aucun code.
4. **Les trois défauts réels** — INC-076, INC-075, INC-072.
5. **Les mises en œuvre décidées** du tableau ci-dessus, par unité porteuse.
6. **La famille 2**, avant que `CRM-054` ne démarre.
