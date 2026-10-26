-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T2.3, étape 0 : la fondation des écritures par rattachement. La timeline
--           d'un rattachement est écrite par `card_placements`, un miroir inverse tient l'affaire égale, et un client
--           écrit les sept colonnes ouvertes du rattachement s'il écrit son channel
-- @verifies docs/SPEC-rattachements.md §4 (écrire un rattachement), §5 (timeline), §14 ; docs/SCHEMA.md « Migration
--           `0110` » ; docs/JOURNAL.md décisions 661, 670, 705
--
-- CE QUE CETTE SUITE PROUVE, sur le seed migré :
--   1. la FORME : déclencheurs, politique, privilèges, et la disparition des déclencheurs d'événements de `cards` ;
--   2. les DEUX CHEMINS écrivent UN événement, et un seul : une écriture de `cards` (chemin des gestes actuels) et une
--      écriture directe du rattachement ; l'affaire et son rattachement restent égaux ;
--   3. la RLS d'écriture sous les rôles réels : la lectrice et le business developer `viewer` ne modifient rien ;
--      les colonnes fermées restent fermées.
--
-- Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.divergences()
returns bigint language sql stable as $$
	select count(*)
	  from public.cards c
	  join public.card_placements p on p.card_id = c.id
	 where (c.channel_id, c.workflow_id, c.current_step_id, c.position, c.owner_id, c.amount, c.probability_override,
	        c.next_action, c.next_action_at, c.entered_step_at, c.health_score, c.snoozed_until, c.archived_at)
	       is distinct from
	       (p.channel_id, p.workflow_id, p.current_step_id, p.position, p.owner_id, p.amount, p.probability_override,
	        p.next_action, p.next_action_at, p.entered_step_at, p.health_score, p.snoozed_until, p.archived_at);
$$;

create temp table t_debut as select clock_timestamp() as t;
grant select on t_debut to authenticated;

-- Les événements écrits depuis le début de la transaction, pour une affaire.
create or replace function pg_temp.evenements(p_card uuid)
returns table (type text, placement_id uuid) language sql stable as $$
	select e.type, e.placement_id from public.card_events e
	 where e.card_id = p_card and e.created_at >= (select t from t_debut)
	 order by e.created_at, e.id;
$$;

-- …0c4 : `refonte` (…034), que l'administratrice et le business developer écrivent.
-- …0c5 : `maintenance` (…035), où le business developer n'est que `viewer`.

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select is(
	(select array_agg(tgname::text order by tgname) from pg_trigger
	  where tgrelid = 'public.card_placements'::regclass and not tgisinternal),
	array['card_placements_mirror_to_card', 'card_placements_set_updated_at', 'card_placements_write_events'],
	'trois déclencheurs sur le rattachement : la timeline, le miroir inverse, l''horodatage');
select hasnt_trigger('public', 'cards', 'card_events_apres_maj_sommeil',
	'le déclencheur de sommeil de `cards` est retiré : le rattachement écrit `snoozed` et `woken`');
select has_trigger('public', 'cards', 'card_events_apres_maj',
	'`cards` garde son déclencheur pour les événements de l''AFFAIRE : la corbeille');
select policies_are('public', 'card_placements', array['card_placements_select', 'card_placements_update'],
	'deux politiques : lecture et mise à jour ; ni insertion ni suppression');
select is(
	(select array_agg(column_name::text order by column_name::text) from information_schema.column_privileges
	  where table_schema = 'public' and table_name = 'card_placements'
	    and grantee = 'authenticated' and privilege_type = 'UPDATE'),
	array['amount', 'archived_at', 'next_action', 'next_action_at', 'owner_id', 'position', 'probability_override'],
	'les sept colonnes qu''un client écrit sur l''affaire s''écrivent sur le rattachement, et elles seules');
select ok(not has_table_privilege('authenticated', 'public.card_placements', 'INSERT')
          and not has_table_privilege('authenticated', 'public.card_placements', 'DELETE'),
	'rattacher et retirer restent des fonctions (T3)');

-- =============================================================================================
-- 2. Les deux chemins : un événement, un seul, et les deux côtés égaux
-- =============================================================================================

-- 2.1 Le chemin de `cards`, que gardent le propriétaire et la clé de service (le seed) depuis T2.3.2. Le rattachement
--     suit (T2.1), et c'est LUI qui écrit l'événement. L'acteur est alors le service, et l'écriture se fait en propriétaire.
update public.cards set owner_id = '5eed0000-0000-4000-8000-000000000011'
 where id = '5eed0000-0000-4000-8000-0000000000c4';
select pg_temp.proprietaire();
select results_eq(
	$$select * from pg_temp.evenements('5eed0000-0000-4000-8000-0000000000c4')$$,
	$$values ('assigned'::text, app.card_first_placement('5eed0000-0000-4000-8000-0000000000c4'))$$,
	'par `cards` : UN événement `assigned`, qui désigne le rattachement');
select is(pg_temp.divergences(), 0::bigint, '…et l''affaire et son rattachement sont égaux');

-- 2.2 Le chemin nouveau : le rattachement, écrit directement. L'affaire suit par le miroir inverse.
truncate t_debut; insert into t_debut values (clock_timestamp());
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
update public.card_placements set archived_at = now(), next_action = 'Clore le dossier'
 where card_id = '5eed0000-0000-4000-8000-0000000000c4';
select pg_temp.proprietaire();
select results_eq(
	$$select * from pg_temp.evenements('5eed0000-0000-4000-8000-0000000000c4')$$,
	$$values ('archived'::text, app.card_first_placement('5eed0000-0000-4000-8000-0000000000c4'))$$,
	'par le rattachement : UN événement `archived` — le miroir inverse n''en écrit pas un second');
select is(pg_temp.divergences(), 0::bigint, '…et l''affaire a suivi : archivage et prochaine action');
select is((select next_action from public.cards where id = '5eed0000-0000-4000-8000-0000000000c4'), 'Clore le dossier',
	'(témoin) la colonne de l''affaire porte bien la valeur écrite sur le rattachement');

truncate t_debut; insert into t_debut values (clock_timestamp());
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
update public.card_placements set archived_at = null where card_id = '5eed0000-0000-4000-8000-0000000000c4';
select pg_temp.proprietaire();
select results_eq(
	$$select type from pg_temp.evenements('5eed0000-0000-4000-8000-0000000000c4')$$,
	$$values ('unarchived'::text)$$,
	'désarchiver le rattachement : UN événement `unarchived`');

-- 2.3 Les gestes par fonction, inchangés : `snooze_card` écrit `cards`, le rattachement écrit `snoozed`.
truncate t_debut; insert into t_debut values (clock_timestamp());
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.snooze_card(app.card_first_placement('5eed0000-0000-4000-8000-0000000000c4'), now() + interval '2 days');
select pg_temp.proprietaire();
select results_eq(
	$$select type from pg_temp.evenements('5eed0000-0000-4000-8000-0000000000c4')$$,
	$$values ('snoozed'::text)$$,
	'`snooze_card` : UN événement `snoozed`, comme avant');
truncate t_debut; insert into t_debut values (clock_timestamp());
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.wake_card(app.card_first_placement('5eed0000-0000-4000-8000-0000000000c4'));
select pg_temp.proprietaire();
select results_eq(
	$$select type from pg_temp.evenements('5eed0000-0000-4000-8000-0000000000c4')$$,
	$$values ('woken'::text)$$,
	'`wake_card` : UN événement `woken`');

truncate t_debut; insert into t_debut values (clock_timestamp());
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select public.move_card(app.card_first_placement('5eed0000-0000-4000-8000-0000000000c2'), '5eed0000-0000-4000-8000-000000000063');
select pg_temp.proprietaire();
select results_eq(
	$$select type from pg_temp.evenements('5eed0000-0000-4000-8000-0000000000c2')$$,
	$$values ('moved'::text)$$,
	'`move_card` : UN événement `moved`');
select is(pg_temp.divergences(), 0::bigint, 'après les gestes, l''affaire et son rattachement restent égaux');

-- 2.4 La corbeille reste un événement de l'AFFAIRE, sans rattachement.
truncate t_debut; insert into t_debut values (clock_timestamp());
update public.cards set deleted_at = now() where id = '5eed0000-0000-4000-8000-0000000000c4';
select results_eq(
	$$select * from pg_temp.evenements('5eed0000-0000-4000-8000-0000000000c4')$$,
	$$values ('trashed'::text, null::uuid)$$,
	'mettre à la corbeille : `trashed`, écrit par `cards`, sans rattachement');
update public.cards set deleted_at = null where id = '5eed0000-0000-4000-8000-0000000000c4';

-- 2.5 Une mise à jour sans changement n'écrit rien.
truncate t_debut; insert into t_debut values (clock_timestamp());
update public.card_placements set next_action = next_action where card_id = '5eed0000-0000-4000-8000-0000000000c4';
select is((select count(*)::int from pg_temp.evenements('5eed0000-0000-4000-8000-0000000000c4')), 0,
	'réécrire une valeur à l''identique n''écrit aucun événement');

-- =============================================================================================
-- 3. La RLS d'écriture, sous les rôles réels
-- =============================================================================================

-- Le business developer est `viewer` sur Maintenance (…035) : il lit `…0c5`, il ne l'écrit pas.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
update public.card_placements set next_action = 'interdit' where card_id = '5eed0000-0000-4000-8000-0000000000c5';
select pg_temp.proprietaire();
select isnt((select next_action from public.card_placements where card_id = '5eed0000-0000-4000-8000-0000000000c5'),
	'interdit', 'un `viewer` du channel ne modifie pas le rattachement : le `USING` filtre, aucune ligne touchée');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is((select p.ecriture_permise from public.card_placements p
            where p.card_id = '5eed0000-0000-4000-8000-0000000000c5'), false,
	'`ecriture_permise` du rattachement est fausse pour lui');
select is((select p.ecriture_permise from public.card_placements p
            where p.card_id = '5eed0000-0000-4000-8000-0000000000c4'), true,
	'…et vraie sur un rattachement de `refonte`, qu''il écrit');
update public.card_placements set next_action = 'Rappeler mardi' where card_id = '5eed0000-0000-4000-8000-0000000000c4';
select pg_temp.proprietaire();
select is((select next_action from public.cards where id = '5eed0000-0000-4000-8000-0000000000c4'), 'Rappeler mardi',
	'il écrit le rattachement d''un channel qu''il écrit, et l''affaire suit');

-- La lectrice n'écrit rien.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
update public.card_placements set next_action = 'interdit' where card_id = '5eed0000-0000-4000-8000-0000000000c4';
select pg_temp.proprietaire();
select isnt((select next_action from public.card_placements where card_id = '5eed0000-0000-4000-8000-0000000000c4'),
	'interdit', 'la lectrice ne modifie aucun rattachement');

-- Les colonnes fermées restent fermées : l'étape, le channel et le sommeil passent par les fonctions.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok($$update public.card_placements set current_step_id = current_step_id
                   where card_id = '5eed0000-0000-4000-8000-0000000000c4'$$,
	'42501', null, 'l''étape d''un rattachement ne s''écrit pas directement : `move_card`');
select throws_ok($$update public.card_placements set snoozed_until = now()
                   where card_id = '5eed0000-0000-4000-8000-0000000000c4'$$,
	'42501', null, 'son sommeil non plus : `snooze_card`');
select throws_ok($$delete from public.card_placements where card_id = '5eed0000-0000-4000-8000-0000000000c4'$$,
	'42501', null, 'retirer un rattachement n''est pas une suppression directe');
select pg_temp.proprietaire();
set local role anon;
select throws_ok($$update public.card_placements set next_action = 'x'$$, '42501', null,
	'`anon` n''écrit rien');
reset role;

select * from finish();
rollback;
