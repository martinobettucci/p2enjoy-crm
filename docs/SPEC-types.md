# SPEC — Types TypeScript générés depuis le schéma

**Unité de backlog :** `CRM-006` (`docs/BACKLOG.md`).
**Documents liés :** `docs/SCHEMA.md` §1 et §9, `docs/DAT.md` §3.1 et §13, `README.md` §7.

Ce document décrit **ce que le produit exige** des types TypeScript dérivés du schéma : d'où ils
viennent, où ils vivent, comment ils sont régénérés, comment on prouve qu'ils n'ont pas dérivé, et
ce qu'ils **n'expriment pas**.

Il est rédigé **après mesure** du comportement réel de `supabase/postgres-meta:v0.96.6`, la version
épinglée par `docker-compose.dev.yml`, et non de mémoire. Les valeurs citées au §3 sont des
observations, pas des attentes.

---

## 1. Objet

La webapp (`CRM-007`) lit la base par PostgREST au travers de `supabase-js`, qui est générique sur
un type `Database`. Sans ce type, chaque colonne lue est un `any` : une colonne renommée ou
supprimée par une migration ne se manifeste qu'à l'exécution, dans le navigateur, chez
l'utilisateur.

L'objet de `CRM-006` est de rendre cette classe d'erreurs visible **à la compilation**, et de
garantir que le type employé décrit le schéma **réellement migré**, pas celui que l'on croit avoir
migré.

Périmètre : la génération, son fichier de sortie, sa commande, et la garde qui prouve l'absence de
dérive. Hors périmètre : l'usage de ces types par un composant, qui n'existera qu'avec `CRM-007`.

## 2. Un fichier versionné, pas un artefact de build

Le fichier généré est **committé dans le dépôt**.

L'alternative — le générer au build — rendrait la compilation dépendante d'une base PostgreSQL
démarrée, donc d'un démon Docker, y compris en intégration continue et pour un simple
`npm run build`. Elle rendrait surtout la dérive **invisible** : le build produirait toujours des
types cohérents avec la base du moment, et personne ne verrait jamais qu'une migration a changé le
contrat lu par l'interface.

Versionner le fichier déplace la dérive dans le diff, là où elle se lit. La contrepartie est qu'il
faut une garde qui prouve que le fichier committé correspond au schéma : c'est le §6.

## 3. Source de vérité et chemin de génération

**Source de vérité : la base de développement réellement migrée**, pas les fichiers SQL. Le
générateur interroge les catalogues de PostgreSQL après application des migrations par
`migrations-runner`. Ce qui est décrit est donc ce que PostgREST exposera, y compris les effets
qu'aucune lecture des fichiers `.sql` ne révélerait — défauts appliqués, colonnes nullables,
relations réellement créées.

**Générateur : le service `meta` de l'overlay de développement**
(`supabase/postgres-meta:v0.96.6`), déjà présent pour Studio. Aucune dépendance nouvelle n'est
introduite : ni CLI Supabase à télécharger, ni binaire hors registre npm. C'est le même moteur que
celui qu'emploie `supabase gen types typescript`.

Le service `meta` **ne publie aucun port sur l'hôte** — il n'est joignable que depuis le réseau
Docker (`docker-compose.dev.yml`, service `meta`). L'appel se fait donc par `docker exec` dans le
conteneur `p2enjoy-meta`.

Mesures du 2026-08-03, sur la pile démarrée par `./runDev.sh --dev` :

| Observation | Valeur mesurée |
|---|---|
| Route | `GET http://localhost:8080/generators/typescript` |
| Code | `200` |
| Paramètres retenus | `included_schemas=public&detect_one_to_one_relationships=true` |
| Sortie sur le schéma d'amorçage | 300 lignes, 8 527 octets, terminée par un saut de ligne |
| Déterminisme | deux appels successifs rendent des octets **identiques** |
| Effet de `detect_one_to_one_relationships` | ajoute `isOneToOne` aux 4 relations ; sans lui, `supabase-js` type mal une relation embarquée |

**`included_schemas` vaut `public`, et rien d'autre.** Le schéma `app` est bien accepté par le
générateur — vérifié — mais il n'est **pas exposé par PostgREST** : aucune de ses fonctions n'est
appelable depuis un client. L'y inclure produirait un type décrivant des appels impossibles, ce qui
est pire que pas de type du tout.

## 4. Commande

| Commande | Effet |
|---|---|
| `npm run types:generate` | Régénère le fichier depuis la base de développement et l'écrit dans le dépôt |
| `npm run types:check` | Régénère en mémoire et **compare** au fichier versionné ; sort en `1` en cas d'écart, sans rien réécrire |
| `npm run typecheck` | `tsc --noEmit` sur les types générés et leurs assertions |

Les deux premières délèguent à `scripts/generate-types.sh`, qui suit les conventions des autres
scripts du dépôt (`scripts/lib/env.sh`) :

- il exige un `.env` en **profil `dev`** — la génération lit une base, et jamais celle de
  production (`CLAUDE.md` §9) ;
- il exige la pile démarrée, et le dit en nommant `./runDev.sh` sinon ;
- il ne démarre ni n'arrête aucun service.

## 5. Fichier produit

**Emplacement : `webapp/src/lib/database.types.ts`.**

C'est l'emplacement que `docs/DAT.md` §3.1 nomme déjà — « `src/lib` (client Supabase, **types
générés**, helpers) ». Le répertoire `webapp/` est créé par cette unité alors que son contenu
applicatif relève de `CRM-007` : c'est assumé, l'ordre du plan (`docs/MASTER_PLAN.md` §2.c) plaçant
délibérément les types avant l'interface qui les consomme. Aucun autre fichier de `webapp/` n'est
livré ici.

Le fichier porte un **en-tête de traçabilité réémis à chaque génération** (`docs/MASTER_PLAN.md`
§3), qui nomme l'unité, la présente spécification, et le fait qu'il est généré :

```ts
// @spec CRM-006 (docs/BACKLOG.md) — types TypeScript dérivés du schéma
// @spec docs/SPEC-types.md §3 (source), §5 (fichier), §6 (garde anti-dérive)
// @spec docs/SCHEMA.md §1 (socle d'identité) ; docs/DAT.md §3.1 (webapp)
//
// FICHIER GÉNÉRÉ — NE PAS ÉDITER À LA MAIN.
// Régénérer : npm run types:generate    Vérifier : npm run types:check
```

Le corps est la sortie du générateur, **inchangée**. Aucune retouche manuelle n'est tolérée : le
§6 la ferait échouer, ce qui est le comportement voulu.

## 6. Garde anti-dérive

`npm run types:check` régénère depuis la base et compare **octet à octet** au fichier versionné.
Un écart est un échec, jamais une réécriture silencieuse.

Ce que la garde prouve, et qu'aucune relecture ne prouverait :

1. le fichier committé décrit le schéma que les migrations produisent **aujourd'hui** ;
2. personne n'a édité le fichier à la main ;
3. une migration ajoutée sans régénération est détectée avant d'atteindre l'interface.

La garde n'est probante que si l'on démontre qu'elle **peut échouer**. Le harnais de preuves
(`scripts/verify-types.sh`) le démontre de deux façons, en agissant sur le monde réel plutôt qu'en
l'affirmant :

- **par le fichier** : une ligne modifiée dans le fichier versionné doit faire échouer
  `types:check`, puis l'état initial est restauré ;
- **par le schéma** : une table créée temporairement dans la base doit apparaître dans la sortie du
  générateur et faire échouer `types:check` ; la table retirée, la sortie doit **redevenir
  identique** au fichier versionné. C'est cette seconde preuve qui établit que le générateur lit
  bien la base vivante, et non un cache ou un artefact.

## 7. Ce que les types n'expriment pas

Nommer ces limites fait partie du contrat : un type qui promet plus qu'il ne tient est un piège.

- **Les contraintes `CHECK` ne survivent pas.** `workspace_members.role` est un `text` contraint à
  `('admin', 'business_developer', 'viewer')` par un `CHECK` (`docs/SCHEMA.md` §1) ; le type généré
  dit `string`. Idem pour `track_members.access` et `channel_members.access`. Le vocabulaire des
  rôles est porté par `docs/SPEC-permissions-rls.md` §2, et **par la base**, qui refuse toute autre
  valeur. La conséquence pour `CRM-007` : le compilateur ne protège pas d'une chaîne de rôle
  erronée, seule la base le fait. PostgreSQL n'expose pas de type énuméré ici, et en fabriquer un à
  la main dans un fichier voisin créerait une seconde source de vérité, donc une dérive de plus à
  surveiller.
- **RLS n'apparaît nulle part.** Le type décrit ce que le schéma contient, pas ce que l'appelant a
  le droit de lire. Une table en refus par défaut se type exactement comme une table ouverte : elle
  rend simplement zéro ligne à l'exécution (`docs/SPEC-permissions-rls.md` §7). L'interface ne peut
  donc **jamais** déduire un droit d'un type.
- **Les clés étrangères absentes ne sont pas inventées.** `track_members.track_id` et
  `channel_members.channel_id` ne portent aucune clé étrangère tant que `tracks` et `channels`
  n'existent pas (INC-010) : leurs `Relationships` sont donc incomplètes, et le resteront jusqu'à
  `CRM-020` et `CRM-021`.
- **`Functions` est vide**, et c'est exact : aucune fonction n'est exposée par PostgREST à ce jour,
  celles de `CRM-010` vivant dans le schéma `app`. Les RPC métier (`move_card`, …) apparaîtront
  quand elles seront livrées dans `public`.

## 8. Preuves exigées

| Preuve | Moyen |
|---|---|
| Le fichier correspond au schéma migré | `npm run types:check` sur une base fraîchement migrée |
| Le générateur lit la base vivante | table temporaire créée, détectée, retirée, sortie redevenue identique |
| La garde n'est pas complaisante | fichier altéré → échec ; altération annulée → succès |
| Les types compilent en mode strict | `tsc --noEmit`, `strict: true` |
| Le contrat de type est celui attendu | assertions de type dédiées, vérifiées à la compilation |
| Les assertions ne sont pas complaisantes | une assertion volontairement fausse doit faire échouer `tsc` |
| Aucune régression | les sept harnais des unités précédentes rejoués |

## 9. Limites connues de l'unité

- **Le build de la webapp ne peut pas être vert** : il n'y a pas de webapp (`CRM-007`). La
  Definition of Done de `CRM-006` l'exige ; cette preuve est **bloquée par une dépendance** et sera
  acquise par `CRM-007`. Ce qui la remplace ici est un `tsc --noEmit` en mode strict, qui compile
  réellement les types livrés — c'est moins que le build, et c'est nommé comme tel.
- **Aucun test E2E, aucune vérification visuelle** : l'unité ne livre ni écran ni parcours.
- **`tsconfig.json` vit à la racine** et ne couvre que les types générés et leurs assertions.
  `CRM-007` livrera la configuration de la webapp ; la racine cessera alors d'être le seul point de
  compilation.
- **La génération exige la pile de développement démarrée.** Aucun chemin hors ligne n'est fourni :
  il supposerait de rejouer les migrations dans une base éphémère, ce qui revient au même prérequis.
