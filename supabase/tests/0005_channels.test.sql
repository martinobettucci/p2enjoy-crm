-- @verifies CRM-021 (docs/BACKLOG.md) — channels : structure, cloisonnement, ordre, politiques
-- @verifies docs/SPEC-channels.md §2 (modèle), §3 (ordre), §4 (archivage), §6 (autorisations)
-- @verifies docs/SCHEMA.md §2 (organisation), « Conventions générales »
-- @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 3 et n° 11)
-- @verifies docs/INCONSISTENCY_REPORT.md INC-010 (clé étrangère rétablie), INC-025 (horodatages),
--           INC-029 (`workflow_id` différée), INC-030 (droits fins non appliqués)
--
-- Suite pgTAP de l'unité `CRM-021`. Elle prouve six choses :
--
--   1. la **structure** : colonnes, types, contraintes, index, unicité du slug **par track** ;
--   2. le **cloisonnement**, garanti par une clé étrangère composite : un channel ne peut pas
--      déclarer un `workspace_id` différent de celui de son track. C'est la preuve décisive de
--      cette unité — sans elle, une donnée dénormalisée fausse ferait mentir la RLS ;
--   3. l'**ordre** : `position` attribuée par le trigger dans la portée du **track** ;
--   4. l'**archivage** : réversible, et sans suppression physique exposée ;
--   5. les **autorisations**, éprouvées contre des comptes réels avec les revendications JWT
--      simulées exactement comme PostgREST les pose ;
--   6. les **écarts, figés par des assertions** : `workflow_id` nullable et sans clé étrangère
--      tant que `workflows` n'existe pas (INC-029), et un `channel_members` restrictif qui ne
--      masquait rien (INC-030). Ces deux assertions sont **devenues rouges** à `CRM-033` et à
--      `CRM-012`, et ont été retournées dans le changement qui les a rendues fausses — jamais
--      retirées, jamais laissées survivre à leur cause.
--
-- Exécution : `npm run test:sql`, `scripts/verify-channels.sh`, ou directement
--   docker exec -i p2enjoy-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0005_channels.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier : ni l'extension `pgtap`, ni les
-- comptes, ni les workspaces de test ne subsistent.

begin;

create extension if not exists pgtap with schema extensions;

select plan(68);

-- =============================================================================================
-- 1. Structure — docs/SCHEMA.md §2, docs/SPEC-channels.md §2.1
-- =============================================================================================

select has_table('public', 'channels', 'la table `public.channels` existe');

-- PREUVE RÉVISÉE PAR `CRM-077`, NON AFFAIBLIE (décision 398, docs/SPEC-corbeille.md §3.2). La
-- RÈGLE a changé : la corbeille couvre désormais les channels, qui n'avaient jusque-là que
-- l'archivage. `deleted_at` et `deleted_by` s'ajoutent donc à la table, et `docs/SPEC-channels.md`
-- §2.1 les porte dans le MÊME changement. Ce que l'assertion prouve est inchangé : la table porte
-- EXACTEMENT les colonnes de sa spécification, ni plus ni moins.
select columns_are(
	'public', 'channels',
	array['id', 'workspace_id', 'track_id', 'name', 'slug', 'description', 'workflow_id',
	      'position', 'archived_at', 'created_at', 'updated_at', 'deleted_at', 'deleted_by'],
	'`channels` porte exactement les colonnes de docs/SPEC-channels.md §2.1'
);

select col_is_pk('public', 'channels', 'id', '`channels.id` est la clé primaire');
select col_type_is('public', 'channels', 'position', 'numeric',
	'`position` est `numeric` : un index fractionnaire, comme `tracks.position`');

select col_not_null('public', 'channels', 'workspace_id', '`workspace_id` est non nul');
select col_not_null('public', 'channels', 'track_id',     '`track_id` est non nul');
select col_not_null('public', 'channels', 'name',         '`name` est non nul');
select col_not_null('public', 'channels', 'slug',         '`slug` est non nul');
select col_not_null('public', 'channels', 'position',
	'`position` est non nul — le trigger la renseigne, elle n''est jamais absente');
select col_not_null('public', 'channels', 'created_at', 'INC-025 : `created_at` est non nul');
select col_not_null('public', 'channels', 'updated_at', 'INC-025 : `updated_at` est non nul');

-- INC-025, SECONDE MOITIÉ. `docs/SCHEMA.md` §2 n'énumérait ces colonnes ni pour `tracks` ni pour
-- `channels`, alors que ses conventions générales les exigent de toute table. `CRM-020` a traité
-- la première, en laissant explicitement la seconde à cette unité.
select has_column('public', 'channels', 'created_at',
	'INC-025 : `created_at` est livrée, comme les conventions générales l''exigent');
select has_column('public', 'channels', 'updated_at',
	'INC-025 : `updated_at` est livrée, comme les conventions générales l''exigent');

-- L'index sert la seule question que la barre d'onglets pose : « les channels non archivés de ce
-- track, dans l'ordre ». Partiel, il ne porte que les lignes réellement listées.
select has_index('public', 'channels', 'channels_track_position_idx',
	'index partiel sur `(track_id, position, name)` pour les channels actifs');

select has_trigger('public', 'channels', 'channels_set_updated_at',
	'`updated_at` est maintenue par un trigger');
select has_trigger('public', 'channels', 'channels_attribuer_position',
	'`position` est attribuée par un trigger');

select has_function('app', 'channels_attribuer_position',
	'la fonction du trigger d''ordre existe');

-- =============================================================================================
-- 2. INC-029 — `workflow_id` : l'écart, revu par `CRM-031`
-- =============================================================================================
-- `docs/SCHEMA.md` §2 exige `workflow_id` **non nulle et référencée** vers `workflows`. Au moment
-- de `CRM-021`, la table n'existait pas et trois assertions figeaient cet état pour devenir rouges
-- à `CRM-031`. **Elles l'ont fait**, et sont ici révisées avec le code : le mécanisme de la
-- décision 51 a fonctionné une quatrième fois.
--
-- Ce qui a changé : la clé étrangère existe, et elle est **composite** — le workflow d'un channel
-- appartient au même workspace, garanti par la base. Ce qui n'a pas changé : la colonne reste
-- **nullable**, la contrainte `NOT NULL` revenant à `CRM-033` avec le contrat de création d'un
-- channel qu'elle modifie. INC-029 reste donc ouverte, et l'assertion suivante deviendra rouge à
-- son tour ce jour-là.

select has_column('public', 'channels', 'workflow_id',
	'INC-029 : la colonne `workflow_id` est livrée');

-- INC-029 EST SOLDÉE. Cette assertion a été **révisée**, non supprimée : elle constatait que
-- `workflow_id` restait nullable et devait devenir rouge le jour où `CRM-033` poserait la
-- contrainte. Ce jour est venu, elle est devenue rouge, et elle dit désormais l'état réel — c'est
-- exactement le mécanisme de la décision 51, à sa sixième occurrence.
select col_not_null('public', 'channels', 'workflow_id',
	'INC-029 SOLDÉE : `workflow_id` est **obligatoire** depuis `CRM-033`, comme docs/SCHEMA.md §2 '
	'l''exige depuis l''origine. Créer un channel exige désormais de désigner un workflow');

select ok(
	exists (select 1 from pg_constraint
	         where conname = 'channels_workflow_id_workspace_id_fkey'
	           and conrelid = 'public.channels'::regclass
	           and contype = 'f'),
	'INC-029, levée pour la clé étrangère par `CRM-031` : `workflow_id` est référencée, et de '
	'façon **composite** avec `workspace_id`');

select isnt(
	(select to_regclass('public.workflows')::text),
	null,
	'INC-029 : `public.workflows` existe depuis `CRM-031` — la cause de l''écart a disparu, la '
	'moitié qui restait est nommée ci-dessus');

-- =============================================================================================
-- 3. INC-010 — la seconde clé étrangère différée par `CRM-003` est rétablie
-- =============================================================================================
-- `CRM-020` avait posé celle de `track_members`. Celle-ci pose la seconde, et referme la partie
-- technique d'INC-010.

select fk_ok('public', 'channel_members', 'channel_id', 'public', 'channels', 'id',
	'INC-010 : `channel_members.channel_id` référence désormais `channels.id`');

select is(
	(select c.confdeltype from pg_constraint c
	  where c.conname = 'channel_members_channel_id_fkey'
	    and c.conrelid = 'public.channel_members'::regclass),
	'c'::"char",
	'la clé étrangère est en `ON DELETE CASCADE` : un droit fin n''a pas de sens sans son channel'
);

-- =============================================================================================
-- 4. Le cloisonnement, garanti par la clé composite — docs/SPEC-channels.md §2.4
-- =============================================================================================
-- La preuve décisive de cette unité. `channels.workspace_id` est **dénormalisé** : la politique
-- RLS l'interroge directement. S'il pouvait différer du workspace de son track, la politique
-- cloisonnerait sur une valeur fausse, et aucune règle RLS ne le rattraperait — elle fait
-- confiance à la donnée.

select is(
	(select count(*)::int from pg_constraint
	  where conname = 'tracks_id_workspace_id_key'
	    and conrelid = 'public.tracks'::regclass and contype = 'u'),
	1,
	'`tracks (id, workspace_id)` est unique : c''est la **condition** de la clé composite, '
	'mesurée — sans elle, PostgreSQL refuse la clé étrangère');

select is(
	(select count(*)::int from pg_constraint
	  where conname = 'channels_track_id_workspace_id_fkey'
	    and conrelid = 'public.channels'::regclass and contype = 'f'),
	1,
	'la clé étrangère de `channels` porte sur le **couple** `(track_id, workspace_id)`');

-- Aucune clé simple `track_id → tracks(id)` : la composite la contient, et en ajouter une seconde
-- coûterait une vérification par écriture sans rien garantir de plus.
select is(
	(select count(*)::int from pg_constraint
	  where conrelid = 'public.channels'::regclass and contype = 'f'
	    and conkey = array[(select attnum from pg_attribute
	                         where attrelid = 'public.channels'::regclass and attname = 'track_id')]),
	0,
	'aucune clé étrangère **simple** sur `track_id` : la composite la contient');

create temporary table zz_ch (id uuid) on commit drop;

insert into public.workspaces (id, name, slug) values
	('33330000-0000-4000-8000-000000000001', 'Atelier CH A', 'atelier-ch-a'),
	('33330000-0000-4000-8000-000000000002', 'Atelier CH B', 'atelier-ch-b');

insert into public.tracks (id, workspace_id, name, slug, position) values
	('33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-000000000001',
	 'Track A1', 'track-a1', 1),
	('33330000-0000-4000-8000-0000000000a2', '33330000-0000-4000-8000-000000000001',
	 'Track A2', 'track-a2', 2),
	('33330000-0000-4000-8000-0000000000b1', '33330000-0000-4000-8000-000000000002',
	 'Track B1', 'track-b1', 1);

-- Un workflow **global** par workspace. `CRM-033` rend `channels.workflow_id` obligatoire : les
-- fixtures de channels doivent désigner un workflow, et un workflow global convient à tout channel
-- de son workspace (docs/SPEC-workflow-engine.md §4.12.2). Chaque insertion désigne celui du
-- workspace qu'elle **déclare**, y compris lorsqu'elle ment sur ce workspace : sans cela, le refus
-- viendrait de la clé étrangère du workflow et non de celle du track, et l'assertion prouverait
-- autre chose que ce qu'elle annonce.
insert into public.workflows (id, workspace_id, name, scope) values
	('33330000-0000-4000-8000-0000000000f1', '33330000-0000-4000-8000-000000000001',
	 'Workflow CH A', 'global'),
	('33330000-0000-4000-8000-0000000000f2', '33330000-0000-4000-8000-000000000002',
	 'Workflow CH B', 'global');

select lives_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f1',
	          'Cohérent', 'coherent', 10)$$,
	'un channel dont le `workspace_id` est celui de son track est accepté');

-- LE REFUS QUI COMPTE. Le workspace déclaré est réel, le track est réel, l'appelant est
-- `postgres` — donc au-dessus de toute RLS. Seule la clé composite peut refuser cette ligne.
select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000002', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f2',
	          'Menteur', 'menteur', 11)$$,
	'23503', null,
	'un channel ne peut pas déclarer un `workspace_id` différent de celui de son track : la '
	'dénormalisation ne peut pas mentir à la RLS');

select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-00000000dead', '33330000-0000-4000-8000-0000000000f1',
	          'Orphelin', 'orphelin', 12)$$,
	'23503', null,
	'un channel ne peut pas désigner un track inexistant');

-- La même contrainte protège la **mise à jour**, et pas seulement l'insertion : sans quoi il
-- suffirait de créer une ligne cohérente puis de la corrompre.
select throws_ok(
	$$update public.channels set workspace_id = '33330000-0000-4000-8000-000000000002'
	   where slug = 'coherent'$$,
	'23503', null,
	'la cohérence est vérifiée aussi à la mise à jour, non seulement à l''insertion');

-- La cascade suit le track : un channel n'a aucun sens hors du sien.
savepoint avant_cascade;
delete from public.tracks where id = '33330000-0000-4000-8000-0000000000a1';
select is(
	(select count(*)::int from public.channels where slug = 'coherent'),
	0,
	'la suppression d''un track emporte ses channels (`ON DELETE CASCADE`)');
rollback to savepoint avant_cascade;

-- =============================================================================================
-- 5. Contraintes de valeur et unicité par track — docs/SPEC-channels.md §2.1
-- =============================================================================================

select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f1',
	          'Majuscules', 'Prospection', 20)$$,
	'23514', null, 'un slug en majuscules est refusé');

select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f1',
	          'Tirets', 'grands--comptes', 21)$$,
	'23514', null, 'un slug à tirets doublés est refusé');

select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f1',
	          '   ', 'nom-blanc', 22)$$,
	'23514', null,
	'un nom réduit à des blancs est refusé : `not null` seul ne l''aurait pas attrapé');

-- UNICITÉ **PAR TRACK**, et non par workspace. C'est la différence avec `tracks`, dont le slug est
-- unique par workspace, et elle est vérifiée dans les deux sens.
select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f1',
	          'Doublon', 'coherent', 23)$$,
	'23505', null, 'le même slug deux fois dans le **même** track est refusé');

select lives_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a2', '33330000-0000-4000-8000-0000000000f1',
	          'Homonyme', 'coherent', 24)$$,
	'le même slug dans un **autre track du même workspace** est accepté : l''unicité est par '
	'track, pas par workspace');

select lives_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000002', '33330000-0000-4000-8000-0000000000b1', '33330000-0000-4000-8000-0000000000f2',
	          'Homonyme B', 'coherent', 25)$$,
	'le même slug dans un autre workspace est accepté');

-- =============================================================================================
-- 6. Ordre — docs/SPEC-channels.md §3
-- =============================================================================================
-- La portée du compteur est le **track**, non le workspace : les onglets d'un track forment une
-- barre à eux seuls (décision 61). Mesuré avant écriture sur une table sonde ; réaffirmé ici sur
-- la table réelle.

insert into public.channels (workspace_id, track_id, workflow_id, name, slug)
	values ('33330000-0000-4000-8000-000000000002', '33330000-0000-4000-8000-0000000000b1', '33330000-0000-4000-8000-0000000000f2',
	        'Ordre un', 'ordre-un');
insert into public.channels (workspace_id, track_id, workflow_id, name, slug)
	values ('33330000-0000-4000-8000-000000000002', '33330000-0000-4000-8000-0000000000b1', '33330000-0000-4000-8000-0000000000f2',
	        'Ordre deux', 'ordre-deux');

select is(
	(select c.position from public.channels c where c.slug = 'ordre-un'),
	26::numeric,
	'la première insertion sans `position` prend la place suivante de son track');
select is(
	(select c.position from public.channels c where c.slug = 'ordre-deux'),
	27::numeric,
	'la deuxième suit la première');

-- Le compteur redémarre à chaque track : un track vide commence à 1, quelle que soit l'activité
-- des autres tracks du même workspace.
insert into public.channels (workspace_id, track_id, workflow_id, name, slug)
	values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a2', '33330000-0000-4000-8000-0000000000f1',
	        'Suite A2', 'suite-a2');
select is(
	(select c.position from public.channels c where c.slug = 'suite-a2'),
	25::numeric,
	'le compteur de `position` est propre au **track**, il n''est ni global ni par workspace');

-- Propriété héritée de `CRM-020` et vérifiée ici plutôt que supposée : un trigger `BEFORE INSERT`
-- ne distingue pas une `position` omise d'une `position` écrite `null`.
insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a2', '33330000-0000-4000-8000-0000000000f1',
	        'Nulle', 'ordre-nul', null);
select is(
	(select c.position from public.channels c where c.slug = 'ordre-nul'),
	26::numeric,
	'un `null` explicite à l''insertion est traité comme une omission : le trigger ne peut pas '
	'les distinguer');

select throws_ok(
	$$update public.channels set position = null where slug = 'ordre-nul'$$,
	'23502', null,
	'une mise à jour vers `null` est refusée : le trigger ne couvre que l''insertion');

-- Une `position` fournie n'est jamais écrasée par le trigger.
insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a2', '33330000-0000-4000-8000-0000000000f1',
	        'Intercalé', 'intercale', 25.5);
select is(
	(select c.position from public.channels c where c.slug = 'intercale'),
	25.5::numeric,
	'une `position` fractionnaire fournie est conservée : c''est ce qui permettra d''insérer un '
	'onglet entre deux autres sans renuméroter la barre');

-- =============================================================================================
-- 7. Archivage — docs/SPEC-channels.md §4
-- =============================================================================================

update public.channels set archived_at = now() where slug = 'ordre-un';
select is(
	(select count(*)::int from public.channels c
	  where c.track_id = '33330000-0000-4000-8000-0000000000b1' and c.archived_at is null),
	2,
	'un channel archivé sort de la barre d''onglets');

update public.channels set archived_at = null where slug = 'ordre-un';
select is(
	(select count(*)::int from public.channels c
	  where c.track_id = '33330000-0000-4000-8000-0000000000b1' and c.archived_at is null),
	3,
	'l''archivage est réversible : c''est une suppression douce, pas une suppression');

-- `updated_at` est tenue par le serveur, pas par l'appelant. Même procédé qu'à `CRM-020` : à
-- l'intérieur d'une transaction, `now()` est constante, et ce qui se prouve est que le trigger
-- **écrase** la valeur écrite par le client.
update public.channels set updated_at = '2000-01-01T00:00:00Z' where slug = 'ordre-un';
select ok(
	(select c.updated_at from public.channels c where c.slug = 'ordre-un')
		> '2020-01-01'::timestamptz,
	'`app.set_updated_at()` écrase la valeur fournie par le client');

-- =============================================================================================
-- 8. Refus par défaut et politiques — docs/SPEC-permissions-rls.md §4
-- =============================================================================================

select is(
	(select c.relrowsecurity from pg_class c
	  join pg_namespace n on n.oid = c.relnamespace
	 where n.nspname = 'public' and c.relname = 'channels'),
	true,
	'RLS est activée sur `channels`');

select policies_are('public', 'channels',
	array['channels_lecture_membre', 'channels_insertion_admin', 'channels_maj_admin'],
	'exactement trois politiques : lecture, insertion, mise à jour');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'channels' and cmd = 'DELETE'),
	0,
	'aucune politique de suppression : la suppression du produit est l''archivage');

select isnt(
	(select p.with_check from pg_policies p
	  where p.schemaname = 'public' and p.tablename = 'channels'
	    and p.policyname = 'channels_maj_admin'),
	null,
	'la politique de mise à jour porte un `WITH CHECK`, sans quoi un channel pourrait changer '
	'de workspace');

select table_privs_are('public', 'channels', 'anon', array['SELECT'],
	'`anon` n''a que `SELECT` : un refus de lecture est zéro ligne, pas une erreur de privilège');
-- PREUVE RÉVISÉE PAR `CRM-077`, NON AFFAIBLIE (décision 398, docs/SPEC-corbeille.md §3.2).
-- La RÈGLE a changé : `UPDATE` n'est plus accordé au niveau TABLE mais COLONNE PAR COLONNE, afin de
-- fermer `deleted_by` au client — un audit qu'un client peut écrire n'est pas un audit. C'est le
-- patron que `CRM-013` avait déjà posé sur `cards`, étendu ici pour que les trois tables de la
-- corbeille se comportent identiquement.
-- CE QUE CETTE ASSERTION PROUVE EST INCHANGÉ : aucune suppression physique n'est exposée. Le droit
-- de mise à jour, lui, est désormais vérifié colonne par colonne par l'assertion qui suit — plus
-- précise que la précédente, et non plus permissive.
select table_privs_are('public', 'channels', 'authenticated', array['SELECT', 'INSERT'],
	'`authenticated` n''a ni `DELETE` ni `TRUNCATE` : la suppression physique n''est pas exposée');

-- `UPDATE` EST ACCORDÉ COLONNE PAR COLONNE, ET `deleted_by` EN EST EXCLUE. Sans cette assertion, la
-- révision ci-dessus aurait desserré un contrôle au lieu de le déplacer.
select is(
	(select count(*)::int from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'channels'
	    and grantee = 'authenticated' and privilege_type = 'UPDATE'
	    and column_name = 'deleted_by'),
	0,
	'`channels.deleted_by` n''est PAS modifiable par le client : l''audit de la corbeille est fermé au privilège');


-- =============================================================================================
-- 9. Autorisations éprouvées contre des comptes réels
-- =============================================================================================
-- Revendications JWT simulées **exactement** comme PostgREST les pose : `request.jwt.claims` en
-- réglage local, rôle applicatif endossé par `set local role`. Même procédé que les suites `0002`
-- et `0004`.

insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data) values
	('44440000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'ch-admin-a@exemple.test', '{"full_name": "Admin CH A"}'),
	('44440000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'ch-viewer-a@exemple.test', '{"full_name": "Viewer CH A"}'),
	('44440000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'ch-bizdev-a@exemple.test', '{"full_name": "Bizdev CH A"}'),
	('44440000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000',
	 'authenticated', 'authenticated', 'ch-admin-b@exemple.test', '{"full_name": "Admin CH B"}');

insert into public.workspace_members (workspace_id, user_id, role) values
	('33330000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-00000000000a', 'admin'),
	('33330000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-00000000000b', 'viewer'),
	('33330000-0000-4000-8000-000000000001', '44440000-0000-4000-8000-00000000000c',
	 'business_developer'),
	('33330000-0000-4000-8000-000000000002', '44440000-0000-4000-8000-00000000000d', 'admin');

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', '', true);
	execute 'set local role anon';
end;
$$;

-- --- 9.1 Lecture ------------------------------------------------------------------------------

savepoint avant_roles;
select pg_temp.endosser('44440000-0000-4000-8000-00000000000a');
select ok(
	(select count(*) from public.channels
	  where workspace_id = '33330000-0000-4000-8000-000000000001') > 0,
	'un administrateur du workspace A lit les channels de A');
select is(
	(select count(*)::int from public.channels c
	  where c.workspace_id = '33330000-0000-4000-8000-000000000002'),
	0,
	'PREUVE DE REFUS N° 3 : le membre du workspace A ne voit aucun channel du workspace B');
reset role;
rollback to savepoint avant_roles;

savepoint avant_viewer;
select pg_temp.endosser('44440000-0000-4000-8000-00000000000b');
select ok(
	(select count(*) from public.channels
	  where workspace_id = '33330000-0000-4000-8000-000000000001') > 0,
	'un `viewer` lit les channels de son workspace : lire n''exige pas d''écrire');
reset role;
rollback to savepoint avant_viewer;

savepoint avant_anon;
select pg_temp.anonyme();
select is(
	(select count(*)::int from public.channels),
	0,
	'PREUVE DE REFUS N° 11 : un appelant anonyme ne lit aucun channel, alors que la table en '
	'contient — et il obtient zéro ligne, pas une erreur');
reset role;
rollback to savepoint avant_anon;

-- --- 9.2 Écriture -----------------------------------------------------------------------------

savepoint avant_viewer_ecrit;
select pg_temp.endosser('44440000-0000-4000-8000-00000000000b');
select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f1',
	          'Par un viewer', 'par-viewer', 40)$$,
	'42501', null,
	'un `viewer` ne crée aucun channel');
reset role;
rollback to savepoint avant_viewer_ecrit;

savepoint avant_bizdev;
select pg_temp.endosser('44440000-0000-4000-8000-00000000000c');
select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f1',
	          'Par un bizdev', 'par-bizdev', 41)$$,
	'42501', null,
	'un `business_developer` non plus : l''organisation est une prérogative d''administration. Il '
	'travaille dans la structure, il ne la définit pas');
reset role;
rollback to savepoint avant_bizdev;

savepoint avant_admin;
select pg_temp.endosser('44440000-0000-4000-8000-00000000000a');
select lives_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000001', '33330000-0000-4000-8000-0000000000a1', '33330000-0000-4000-8000-0000000000f1',
	          'Par un admin', 'par-admin', 42)$$,
	'un administrateur crée un channel dans son workspace');
select throws_ok(
	$$insert into public.channels (workspace_id, track_id, workflow_id, name, slug, position)
	  values ('33330000-0000-4000-8000-000000000002', '33330000-0000-4000-8000-0000000000b1', '33330000-0000-4000-8000-0000000000f2',
	          'Intrusion', 'intrusion', 43)$$,
	'42501', null,
	'un administrateur du workspace A ne crée aucun channel dans le workspace B');
select throws_ok(
	$$update public.channels
	     set workspace_id = '33330000-0000-4000-8000-000000000002',
	         track_id     = '33330000-0000-4000-8000-0000000000b1'
	   where slug = 'par-admin'$$,
	'42501', null,
	'le `WITH CHECK` interdit de **déplacer** un channel vers un workspace où l''appelant n''est '
	'pas administrateur');
select lives_ok(
	$$update public.channels set archived_at = now() where slug = 'par-admin'$$,
	'un administrateur archive son propre channel');
select throws_ok(
	$$delete from public.channels where slug = 'par-admin'$$,
	'42501', null,
	'la suppression physique est refusée même à un administrateur : le privilège n''est accordé '
	'à personne');
reset role;
rollback to savepoint avant_admin;

-- --- 9.3 Les droits ne sont pas portés par le jeton -------------------------------------------

savepoint avant_revocation;
delete from public.workspace_members
 where user_id = '44440000-0000-4000-8000-00000000000b';
select pg_temp.endosser('44440000-0000-4000-8000-00000000000b');
select is(
	(select count(*)::int from public.channels),
	0,
	'l''appartenance retirée, le même appelant ne lit plus aucun channel — les droits ne sont pas '
	'portés par le jeton');
reset role;
rollback to savepoint avant_revocation;

-- =============================================================================================
-- 10. INC-030 — l'écart de droit fin a été soldé, et l'assertion qui le figeait a été révisée
-- =============================================================================================
-- Jusqu'à `CRM-012`, la politique de lecture s'arrêtait au rôle de workspace : elle cloisonnait,
-- elle ne restreignait pas. L'assertion qui suit **constatait** cet écart ; elle est devenue rouge
-- au passage de `CRM-012`, comme la décision 51 l'attendait, et elle est **retournée** plutôt que
-- retirée — elle prouve désormais que le droit fin masque bien le channel.

-- Le droit fin vise **un** channel précis, désigné par son track : `coherent` existe aussi dans
-- `track-a2` et dans le workspace B, l'unicité du slug étant par track. Compter sur le seul slug
-- ferait porter l'assertion sur trois lignes, dont deux que le droit fin ne vise pas — elle
-- passerait ou échouerait pour la mauvaise raison.
insert into public.channel_members (channel_id, user_id, access)
select c.id, '44440000-0000-4000-8000-00000000000b', 'none'
  from public.channels c
 where c.slug = 'coherent' and c.track_id = '33330000-0000-4000-8000-0000000000a1';

savepoint avant_droit_fin;
select pg_temp.endosser('44440000-0000-4000-8000-00000000000b');
select is(
	(select count(*)::int from public.channels c
	  where c.slug = 'coherent' and c.track_id = '33330000-0000-4000-8000-0000000000a1'),
	0,
	'INC-030 CLOSE : un `channel_members.access = ''none''` **masque** désormais le channel — la '
	'politique de CRM-012 s''appuie sur `app.can_read_channel`. Assertion retournée, non retirée');
reset role;
rollback to savepoint avant_droit_fin;

-- =============================================================================================
-- 11. Les quatre fonctions différées restent absentes
-- =============================================================================================
-- La suite `0002` de `CRM-010` le constate déjà ; on le redit ici pour les deux fonctions qui
-- concernent directement cette table, afin qu'aucune ne puisse apparaître au détour d'une unité
-- sans que les preuves des channels soient étendues.

select has_function('app', 'can_read_channel',
	'INC-013 éteinte pour elle : `app.can_read_channel` est livrée par CRM-012');
select has_function('app', 'can_write_channel',
	'INC-013 éteinte pour elle : `app.can_write_channel` est livrée par CRM-012');

select * from finish();
rollback;
