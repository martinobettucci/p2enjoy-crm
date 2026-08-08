# Spécification — ordonnancement PostgreSQL

Contrat exécutable de `CRM-017`, issu de l'arbitrage du responsable qui renverse la décision 8
(`docs/JOURNAL.md`, décision 261 ; INC-012).

- Unité de backlog : `CRM-017` (`docs/BACKLOG.md`).
- Architecture : `docs/DAT.md` §3.3, §12 et §15.
- Schéma : `docs/SCHEMA.md` §8 et §9.
- Déploiement : `docs/PROD_MIGRATIONS.md` §3 à §6.
- État : contrat spécifié ; mise en œuvre en cours.

---

## 1. Périmètre et frontière honnête

`CRM-017` livre **l'ordonnanceur durable et sa première tâche opérationnelle**, pas les règles
métier dont les données n'existent pas encore. Les cadences de relance arrivent avec `CRM-063`, le
digest avec `CRM-069`, et les tables de messagerie portant une rétention avec le chunk 4. Chacune
de ces unités enregistrera son propre job `pg_cron` par migration, au lieu de réintroduire un
`scheduler` Python.

La première tâche est un **heartbeat d'exploitation** : elle prouve qu'un job enregistré se
connecte à la base, exécute sa commande et laisse un état contrôlable. Elle ne simule ni relance,
ni email, ni purge RGPD et ne fabrique aucune donnée métier.

## 2. Extension et objets privés

La migration `supabase/migrations/0018_pg_cron.sql` installe explicitement `pg_cron` 1.6.4, déjà
présent et préchargé dans l'image PostgreSQL épinglée. Elle crée dans le schéma privé `app` :

| Objet | Contrat |
|---|---|
| `app.scheduler_heartbeat` | table `UNLOGGED` à une ligne, clé `scheduler`, compteur non négatif et date du dernier passage |
| `app.scheduler_heartbeat_tick()` | fonction sans argument qui incrémente le compteur, pose `clock_timestamp()` et ramène le job à sa cadence nominale |

La table est `UNLOGGED` parce que le heartbeat n'est ni une donnée métier ni une sauvegarde : après
un crash PostgreSQL, sa perte est attendue et le prochain passage la recrée. Écrire son historique
dans le WAL ou le seed contredirait ce rôle. `cron.job_run_details` reste la preuve indépendante
que le moteur a réellement lancé la commande.

## 3. Job nommé et démarrage observable

Le job porte exactement ces propriétés :

| Propriété | Valeur |
|---|---|
| Nom | `p2enjoy-scheduler-heartbeat` |
| Base / rôle | `postgres` / `postgres` |
| Commande | `select app.scheduler_heartbeat_tick();` |
| Cadence d'amorçage | `5 seconds` |
| Cadence nominale | `7 * * * *` — à la minute 7 de chaque heure |
| État | actif |

La cadence de cinq secondes est **transitoire**. `cron.schedule(job_name, …)` converge sur le même
`jobid` lorsqu'un nom existe déjà ; chaque application de la migration remet donc le job à cinq
secondes. Son premier passage incrémente le heartbeat puis appelle `cron.alter_job` dans la même
transaction pour revenir à la cadence horaire. Si cette promotion échoue, le passage entier
échoue et `cron.job_run_details` le dit ; aucun faux heartbeat n'est conservé.

Ce démarrage observable évite deux mauvaises solutions : une tâche permanente toutes les cinq
secondes, qui produirait du WAL et des journaux sans valeur, et une preuve froide susceptible
d'attendre jusqu'à une heure. À l'état stable, le journal représente au plus vingt-quatre passages
par jour pour ce job.

## 4. Sécurité

Le moteur de migrations et le job s'exécutent sous `postgres`. Aucun client du produit ne doit
pouvoir programmer du SQL :

- `public`, `anon`, `authenticated` et `service_role` n'ont aucun privilège sur le schéma `cron`,
  ses tables ou ses fonctions ;
- les mêmes rôles n'ont aucun privilège sur `app.scheduler_heartbeat` ni droit d'exécution sur
  `app.scheduler_heartbeat_tick()` ;
- la fonction fixe `search_path` à la chaîne vide et qualifie tous ses objets ;
- rien n'est exposé par PostgREST, Kong ou l'interface.

Le heartbeat ne contient ni secret, ni identifiant utilisateur, ni donnée personnelle. Les futures
fonctions planifiées suivent la même règle : objets privés, privilège minimal, commande nommée et
migration versionnée.

## 5. Rejouabilité et convergence

La migration peut être rejouée sur chaque démarrage, comme toutes celles de ce dépôt :

1. `create extension if not exists` conserve l'installation ;
2. table, contrainte, fonction, commentaires et privilèges sont remis au contrat ;
3. `cron.schedule` avec le nom stable conserve un unique `jobid` et répare commande, base, rôle,
   activation et cadence d'amorçage ;
4. le premier passage ramène ensuite la cadence nominale.

Une migration ultérieure qui change un job réemploie son nom stable. Aucun script applicatif ni
seed ne programme de tâche : le catalogue `cron.job` est une configuration de base versionnée.

## 6. Preuves

`supabase/tests/0020_pg_cron.test.sql` prouve par pgTAP : version et préchargement, forme privée des
objets, privilèges refusés aux quatre rôles, unicité et contrat exact du job, passage réel du
compteur, cadence nominale après promotion et ligne `succeeded` dans `cron.job_run_details`. Sur
une base venant d'être migrée, la suite attend au plus quinze secondes le premier passage ; sur
une base chaude, elle ne dort pas.

`scripts/verify-scheduler.sh` rejoue cette suite, dégrade réellement la commande et la cadence,
réapplique la migration, puis constate le **même jobid**, le passage réel et le retour à la cadence
nominale. Il vérifie enfin que la base ne conserve aucune seconde ligne de heartbeat et aucun job
homonyme. Le harnais SQL global fige ses nouveaux comptes ; aucune UI ni capture n'est due, car
aucune action interactive n'est ajoutée.

## 7. Déploiement et retour arrière

La production doit appliquer la migration 18 sous le propriétaire PostgreSQL et conserver
`pg_cron` dans `shared_preload_libraries`. Le contrôle post-déploiement attend un `last_run_at`
récent, un `run_count` positif, le job à `7 * * * *` et un passage `succeeded`.

Le retour arrière désordonnance `p2enjoy-scheduler-heartbeat`, supprime la fonction puis la table.
Il ne désinstalle pas `pg_cron` : des unités ultérieures peuvent déjà y avoir enregistré leurs
propres tâches. Aucune donnée métier n'est perdue ; seul l'état de supervision disparaît.
