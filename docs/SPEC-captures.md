# Spécification — les captures versionnées se renouvellent par une campagne dédiée (`CRM-122`)

*Écrite le 2026-11-01 par `CRM-122` T1, sur la décision 787 (révisée en séance) ; question du connecteur : sans objet
(décision 800). Le code attend que ce document soit committé.*

## 1. Le problème, mesuré

`capturer()` (`e2e/ui/captures.ts`) écrit chaque capture dans `e2e/output/`, que le dépôt ignore, **et la recopie** dans
`docs/captures/<unité>/`, qui est versionné. **Chaque passage** de chaque scénario réécrit donc les images versionnées
de toutes les unités (117 fichiers de scénario l'appellent ; 1 048 images au 2026-11-01). Une campagne de régression
salit l'arbre sans que personne observe ni committe ces images : 901 images le 2026-10-31, après la campagne
d'interface de `CRM-111` T2.4.5, rendues à leur version committée. Et `scripts/spark/livrer.sh` refuse un arbre sale.

Un second défaut, de même cause : `e2e/output/` est plat (`<nom>.jpg`). Deux unités qui emploient le même nom s'y
écrasent l'une l'autre.

Le renouvellement est voulu (`CLAUDE.md` §7 : les captures sont renouvelées quand l'apparence change). Mais il doit être
**délibéré, observé et committé**.

## 2. Deux demandes, et rien sans elles

| Demande | Variable | Ce que `capturer()` recopie dans `docs/captures/` |
|---|---|---|
| Aucune (campagne ordinaire, régression) | — | **rien** |
| L'unité qui livre | `CAPTURES_UNITES=CRM-122` (une liste, séparée par des virgules) | les captures des seules unités nommées |
| Le renouvellement | `CAPTURES_RENOUVELLEMENT=1` | toutes les captures |

- **Toujours** : la capture est écrite dans `e2e/output/<unité>/<nom>.jpg`, sous-dossier par unité, ce qui supprime la
  collision du §1. C'est là que l'agent observe ses images pendant le développement.
- **Une valeur hors forme est refusée**, et le scénario échoue en le disant : une unité doit correspondre à
  `^CRM-[0-9]{3}$` ou `^INC-[0-9]{3}$`, et `CAPTURES_RENOUVELLEMENT` vaut `1` ou est absente. Une faute de frappe ne
  produit jamais une campagne silencieuse.
- La décision appartient à une fonction pure, `destinationsCapture(unite, environnement)`, testée unitairement ; le
  scénario ne fait que l'appliquer.
- **Hors du périmètre** : les images du manuel (`docs/manuel/images/`, `illustrer`), qui ont leur propre campagne
  (`CRM-117`).

## 3. Le renouvellement, trié puis observé

Une campagne de renouvellement est **toute la campagne d'interface** jouée avec `CAPTURES_RENOUVELLEMENT=1`, puis le
rapport :

```
npm run captures:rapport
```

- **Ce qu'il compare** : chaque image de `docs/captures/` modifiée, ajoutée ou supprimée dans l'arbre de travail,
  confrontée à sa version de `HEAD` (`git show`). Les images sont décodées et comparées par le Chromium de Playwright,
  dans un canevas : aucune dépendance nouvelle, et le même décodeur que celui qui a produit les images.
- **L'écart d'une image** : la part de ses pixels dont un canal au moins diffère de **plus de 24** (sur 255), seuil qui
  absorbe le bruit de la recompression JPEG. Une taille différente compte comme un écart de 100 %.
- **Trois classes**, et le rapport (`e2e/output/captures-rapport.md`, ignoré) les liste par écart décroissant :
  - **changée** : un écart d'au moins **0,2 %** des pixels. L'image est observée une à une, avec les capacités de
    vision. Une régression est signalée, consignée dans `docs/INCONSISTENCY_REPORT.md`, et corrigée avant le commit ;
  - **bruit** : un écart inférieur à 0,2 %. L'image est **rendue à sa version committée** par le rapport lui-même
    (`--rendre-le-bruit`, le défaut), ce qui épargne au commit des centaines d'images que personne ne verrait changer ;
  - **ajoutée** ou **supprimée** : listée, et observée comme une image changée.
- **Le commit** : un seul, « Captures : renouvellement du <date> », qui porte les images changées, ajoutées et
  supprimées, et cite le rapport (comptes par classe, régressions trouvées).

## 4. Quand

- **Une unité qui livre** joue ses scénarios avec `CAPTURES_UNITES=<son identifiant>` et committe ses captures avec
  son code, comme aujourd'hui, mais sans plus toucher celles des autres.
- **Avant chaque livraison en production**, une campagne de renouvellement est jouée et committée. C'est un geste de
  la préparation, inscrit au contrat de déploiement (`docs/PROD_MIGRATIONS.md`, en-tête). La première est `CRM-122` T3.

## 5. Les preuves attendues (T2)

- **Unitaires** (`destinationsCapture` et le tri) : sans demande, rien ; l'unité nommée seule, une liste de deux, une
  unité non nommée ; le renouvellement ; les valeurs refusées ; le classement d'écarts connus en *changée* et en
  *bruit*, à la limite de 0,2 % ; la taille différente.
- **Une campagne ordinaire complète**, constatée propre : `git status` sans aucune capture modifiée après la campagne
  d'interface entière.
- **Documentation** : `docs/DESIGN_SYSTEM.md` §11, `docs/DAT.md` (commandes de test), `README.md`,
  `docs/PROD_MIGRATIONS.md` (le geste de préparation).
