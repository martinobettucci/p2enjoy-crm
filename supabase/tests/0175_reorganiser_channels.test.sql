-- @verifies CRM-154 (docs/BACKLOG.md) — tranche T2 : `public.reorder_channels`
-- @verifies docs/SPEC-administration-arborescence.md §15.2 (un ordre, pas des positions ; les channels ACTIFS du track ;
--           `security invoker` ; les refus (a) à (d) ; une instruction ; privilèges) ; docs/SCHEMA.md « Migration `0187` »
-- @verifies docs/SPEC-channels.md §3 (`position`, portée du track) ; docs/JOURNAL.md décisions 935 et 938
--
-- CE QUE CETTE SUITE PROUVE :
-- 1. la forme de la fonction dans le catalogue — volatile, `security invoker`, `search_path` vide, `anon` exclu ;
-- 2. le témoin : l'administratrice réordonne, la fonction rend 3, les positions RELUES sont 1, 2, 3 dans l'ordre envoyé,
--    et le channel archivé et celui de la corbeille gardent la leur ;
-- 3. les refus `23514`, chacun sur une liste qui ne diffère du témoin que par la condition testée ;
-- 4. le refus `42501` du business developer et de la lectrice, POSITIONS RELUES INCHANGÉES — l'assertion qui verrait
--    la fonction basculer en `security definer`, ou rendre `0` au lieu de lever.

begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- L'ordre des channels ACTIFS d'un track, en une chaîne qui nomme le fautif : `a1,a2,a3`. Lue en propriétaire.
create or replace function pg_temp.ordre(track uuid)
returns text language sql stable as $$
	select string_agg(right(c.id::text, 2), ',' order by c.position, c.name)
	  from public.channels c
	 where c.track_id = track and c.archived_at is null and c.deleted_at is null;
$$;

create or replace function pg_temp.position_de(channel uuid)
returns numeric language sql stable as $$
	select c.position from public.channels c where c.id = channel;
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures, posées en propriétaire : un track de la suite, trois channels actifs, un archivé, un à la corbeille ; un
-- second track et son channel, corps étranger du refus (c). Les noms portent celui du fichier (précaution de la 0047).
-- ---------------------------------------------------------------------------------------------

insert into public.tracks (id, workspace_id, name, slug, position)
values ('d1750000-0000-4000-8000-0000000000f1', '5eed0000-0000-4000-8000-000000000001', 'Track de la suite 0175',
        'track-suite-0175', 900),
       ('d1750000-0000-4000-8000-0000000000f2', '5eed0000-0000-4000-8000-000000000001', 'Track voisin de la suite 0175',
        'track-voisin-0175', 901);

insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id, position, archived_at)
values
	('d1750000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000001',
	 'd1750000-0000-4000-8000-0000000000f1', 'Channel A 0175', 'channel-a-0175',
	 '5eed0000-0000-4000-8000-000000000051', 10, null),
	('d1750000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-000000000001',
	 'd1750000-0000-4000-8000-0000000000f1', 'Channel B 0175', 'channel-b-0175',
	 '5eed0000-0000-4000-8000-000000000051', 20, null),
	('d1750000-0000-4000-8000-0000000000a3', '5eed0000-0000-4000-8000-000000000001',
	 'd1750000-0000-4000-8000-0000000000f1', 'Channel C 0175', 'channel-c-0175',
	 '5eed0000-0000-4000-8000-000000000051', 30, null),
	('d1750000-0000-4000-8000-0000000000a4', '5eed0000-0000-4000-8000-000000000001',
	 'd1750000-0000-4000-8000-0000000000f1', 'Channel archivé 0175', 'channel-archive-0175',
	 '5eed0000-0000-4000-8000-000000000051', 40, now()),
	('d1750000-0000-4000-8000-0000000000a5', '5eed0000-0000-4000-8000-000000000001',
	 'd1750000-0000-4000-8000-0000000000f1', 'Channel à la corbeille 0175', 'channel-corbeille-0175',
	 '5eed0000-0000-4000-8000-000000000051', 50, null),
	('d1750000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000001',
	 'd1750000-0000-4000-8000-0000000000f2', 'Channel voisin 0175', 'channel-voisin-0175',
	 '5eed0000-0000-4000-8000-000000000051', 1, null);

update public.channels
   set deleted_at = now(), deleted_by = '5eed0000-0000-4000-8000-000000000011'
 where id = 'd1750000-0000-4000-8000-0000000000a5';

-- =============================================================================================
-- 1. La forme de la fonction dans le catalogue
-- =============================================================================================

select has_function('public', 'reorder_channels', array['uuid', 'uuid[]'],
	'1. `public.reorder_channels(uuid, uuid[])` existe');

select is((select p.provolatile from pg_proc p where p.oid = 'public.reorder_channels(uuid, uuid[])'::regprocedure),
	'v'::"char", '2. Elle est VOLATILE — elle écrit');

select is((select p.prosecdef from pg_proc p where p.oid = 'public.reorder_channels(uuid, uuid[])'::regprocedure),
	false, '3. Elle est `security INVOKER` — la politique `channels_maj_admin` décide (§15.2)');

select is((select p.proconfig from pg_proc p where p.oid = 'public.reorder_channels(uuid, uuid[])'::regprocedure),
	array['search_path=""'], '4. Son `search_path` est VIDE');

select is(has_function_privilege('anon', 'public.reorder_channels(uuid, uuid[])', 'EXECUTE'),
	false, '5. `anon` NE L''EXÉCUTE PAS');

select is(has_function_privilege('authenticated', 'public.reorder_channels(uuid, uuid[])', 'EXECUTE'),
	true, '6. `authenticated` l''exécute — la politique, ensuite, décide');

select is(has_function_privilege('service_role', 'public.reorder_channels(uuid, uuid[])', 'EXECUTE'),
	true, '7. `service_role` l''exécute');

-- =============================================================================================
-- 2. Le témoin : l'administratrice réordonne
-- =============================================================================================

select is(pg_temp.ordre('d1750000-0000-4000-8000-0000000000f1'), 'a1,a2,a3',
	'8. Avant : l''ordre des fixtures est a1, a2, a3');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select is(public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[
		'd1750000-0000-4000-8000-0000000000a3', 'd1750000-0000-4000-8000-0000000000a1',
		'd1750000-0000-4000-8000-0000000000a2']::uuid[]),
	3, '9. L''administratrice réordonne : la fonction rend 3');

select pg_temp.redevenir_proprietaire();

select is(pg_temp.ordre('d1750000-0000-4000-8000-0000000000f1'), 'a3,a1,a2',
	'10. L''ordre RELU est celui envoyé : a3, a1, a2');

select is(array[pg_temp.position_de('d1750000-0000-4000-8000-0000000000a3'),
                pg_temp.position_de('d1750000-0000-4000-8000-0000000000a1'),
                pg_temp.position_de('d1750000-0000-4000-8000-0000000000a2')],
	array[1, 2, 3]::numeric[], '11. Les positions sont 1, 2, 3 — l''index fractionnaire n''est plus employé');

select is(array[pg_temp.position_de('d1750000-0000-4000-8000-0000000000a4'),
                pg_temp.position_de('d1750000-0000-4000-8000-0000000000a5')],
	array[40, 50]::numeric[], '12. Le channel archivé et celui de la corbeille GARDENT leur position');

-- =============================================================================================
-- 3. Les refus `23514` — chaque liste ne diffère du témoin que par la condition testée
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[]::uuid[]) $$,
	'23514', 'channel_order_required', '13. (a) Une liste VIDE est refusée');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', null) $$,
	'23514', 'channel_order_required', '14. (a) Une liste NULLE est refusée');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[
		'd1750000-0000-4000-8000-0000000000a3', 'd1750000-0000-4000-8000-0000000000a3',
		'd1750000-0000-4000-8000-0000000000a2']::uuid[]) $$,
	'23514', 'channel_order_duplicated', '15. (b) Un DOUBLON est refusé');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[
		'd1750000-0000-4000-8000-0000000000a3', 'd1750000-0000-4000-8000-0000000000a1']::uuid[]) $$,
	'23514', 'channel_order_incomplete', '16. (c) Un channel actif MANQUANT est refusé');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[
		'd1750000-0000-4000-8000-0000000000a3', 'd1750000-0000-4000-8000-0000000000a1',
		'd1750000-0000-4000-8000-0000000000a2', 'd1750000-0000-4000-8000-0000000000a4']::uuid[]) $$,
	'23514', 'channel_order_incomplete', '17. (c) Un channel ARCHIVÉ en plus est refusé');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[
		'd1750000-0000-4000-8000-0000000000a3', 'd1750000-0000-4000-8000-0000000000a1',
		'd1750000-0000-4000-8000-0000000000a2', 'd1750000-0000-4000-8000-0000000000a5']::uuid[]) $$,
	'23514', 'channel_order_incomplete', '18. (c) Un channel À LA CORBEILLE en plus est refusé');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[
		'd1750000-0000-4000-8000-0000000000a3', 'd1750000-0000-4000-8000-0000000000a1',
		'd1750000-0000-4000-8000-0000000000b1']::uuid[]) $$,
	'23514', 'channel_order_incomplete', '19. (c) Le channel d''un AUTRE track est refusé');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000ff', array[
		'd1750000-0000-4000-8000-0000000000a3']::uuid[]) $$,
	'23514', 'channel_order_incomplete', '20. (c) Un track INCONNU donne le même refus — rien n''est révélé');

select pg_temp.redevenir_proprietaire();

select is(pg_temp.ordre('d1750000-0000-4000-8000-0000000000f1'), 'a3,a1,a2',
	'21. Après les refus, l''ordre est INCHANGÉ');

-- =============================================================================================
-- 4. Le refus `42501` : business developer et lectrice, positions relues inchangées
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[
		'd1750000-0000-4000-8000-0000000000a1', 'd1750000-0000-4000-8000-0000000000a2',
		'd1750000-0000-4000-8000-0000000000a3']::uuid[]) $$,
	'42501', 'channel_reorder_forbidden', '22. (d) Le BUSINESS DEVELOPER est refusé : `42501`, pas un zéro');

select pg_temp.redevenir_proprietaire();

select is(pg_temp.ordre('d1750000-0000-4000-8000-0000000000f1'), 'a3,a1,a2',
	'23. …et l''ordre est INCHANGÉ');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select throws_ok($$ select public.reorder_channels('d1750000-0000-4000-8000-0000000000f1', array[
		'd1750000-0000-4000-8000-0000000000a1', 'd1750000-0000-4000-8000-0000000000a2',
		'd1750000-0000-4000-8000-0000000000a3']::uuid[]) $$,
	'42501', 'channel_reorder_forbidden', '24. (d) La LECTRICE est refusée : `42501`');

select pg_temp.redevenir_proprietaire();

select is(pg_temp.ordre('d1750000-0000-4000-8000-0000000000f1'), 'a3,a1,a2',
	'25. …et l''ordre est INCHANGÉ');

select * from finish();

rollback;
