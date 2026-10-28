-- @verifies CRM-077 (docs/BACKLOG.md) — dixième tranche : la rétention, l'effacement définitif et la corbeille personnelle
-- @verifies docs/SPEC-corbeille.md §8.1 (la date posée par le serveur, figée), §8.2 (la rétention en un seul endroit, lue
--           par `authenticated`), §8.3 (la purge ne prend que plus de 30 jours, tracks puis channels puis affaires,
--           énumère, journalise `purged` puis `destroyed`, traverse une ligne de coût soldée, reporte les saisies de
--           temps — Q1, option B — et n'efface que celles d'un track), §8.4 (une ligne en corbeille lisible par
--           l'administratrice et l'auteur du retrait, refusée aux autres), §8.8 ; docs/SPEC-audit.md §4.6 ;
--           docs/JOURNAL.md décisions 707, 734 et 735 ; INC-316 (un track dont un budget porte la dépense d'une affaire
--           d'un autre track reste en corbeille, sans rien journaliser ni effacer, et la purge continue)
--
-- LES GESTES SONT JOUÉS SOUS LE RÔLE `authenticated` de Camille (administratrice), Driss (business developer) et Farida
-- (lectrice). Les fixtures sont propres à la preuve ; pour éprouver la purge, la date de corbeille est RECULÉE le temps
-- d'une instruction, déclencheur désactivé (§8.6) — c'est la seule façon de fabriquer trente jours, et le `rollback`
-- final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;
create or replace function pg_temp.redevenir_proprietaire() returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;
-- Reculer la date de corbeille d'une ligne, déclencheur désactivé le temps de l'instruction (§8.6).
create or replace function pg_temp.reculer(p_table text, p_id uuid, p_jours integer) returns void language plpgsql as $$
begin
	execute format('alter table public.%I disable trigger %I', p_table, p_table || '_corbeille');
	execute format('update public.%I set deleted_at = now() - make_interval(days => %s) where id = %L',
		p_table, p_jours, p_id);
	execute format('alter table public.%I enable trigger %I', p_table, p_table || '_corbeille');
end;
$$;

\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''
\set wf '\'5eed0000-0000-4000-8000-000000000051\''
\set etape '\'5eed0000-0000-4000-8000-000000000061\''
-- Le track vivant, ses deux channels, ses trois affaires.
\set ta '\'b7a50000-0000-4000-8000-0000000000a1\''
\set ca1 '\'b7a50000-0000-4000-8000-0000000000b1\''
\set ca2 '\'b7a50000-0000-4000-8000-0000000000b2\''
\set k1 '\'b7a50000-0000-4000-8000-0000000000c1\''
\set k2 '\'b7a50000-0000-4000-8000-0000000000c2\''
\set k3 '\'b7a50000-0000-4000-8000-0000000000c3\''
-- Le track mis en corbeille, son channel et son affaire.
\set tb '\'b7a50000-0000-4000-8000-0000000000a2\''
\set cb '\'b7a50000-0000-4000-8000-0000000000b3\''
\set k4 '\'b7a50000-0000-4000-8000-0000000000c4\''

insert into public.tracks (id, workspace_id, name, slug, position) values
	(:ta, :ws, 'Rétention — track vivant', 'retention-vivant', 950),
	(:tb, :ws, 'Rétention — track effacé', 'retention-efface', 951);
insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id, position) values
	(:ca1, :ws, :ta, 'Rétention — channel vivant', 'retention-ca1', :wf, 950),
	(:ca2, :ws, :ta, 'Rétention — channel effacé', 'retention-ca2', :wf, 951),
	(:cb, :ws, :tb, 'Rétention — channel du track effacé', 'retention-cb', :wf, 952);
-- `CRM-111` T2.4.5 : l'affaire, puis son rattachement, en une instruction (les colonnes de rattachement ont quitté `cards`).
with __source as (select gen_random_uuid() as __id, * from (select * from (values
	(:k1, :ws, :ca1, :wf, :etape, 'Rétention — affaire de 31 jours', 950),
	(:k2, :ws, :ca1, :wf, :etape, 'Rétention — affaire de 29 jours', 951),
	(:k3, :ws, :ca2, :wf, :etape, 'Rétention — affaire sous channel effacé', 952),
	(:k4, :ws, :cb, :wf, :etape, 'Rétention — affaire du track effacé', 953)) as v(id, workspace_id, channel_id, workflow_id, current_step_id, title, position)) as s),
     __affaires as (insert into public.cards (id, workspace_id, title) select id::uuid, workspace_id::uuid, title from __source)
insert into public.card_placements (card_id, workspace_id, channel_id, workflow_id, current_step_id, position)
select id::uuid, workspace_id::uuid, channel_id::uuid, workflow_id::uuid, current_step_id::uuid, position::numeric from __source;
-- Driss écrit sur le track vivant, Farida le lit.
insert into public.track_members (track_id, user_id, access) values (:ta, :driss, 'member'), (:ta, :farida, 'viewer')
	on conflict (track_id, user_id) do update set access = excluded.access;

-- Les saisies de temps de Driss, sur des jours que le seed n'occupe pas.
insert into public.saisies_temps (workspace_id, profile_id, jour, card_id, minutes, created_by) values
	(:ws, :driss, '2020-03-02', :k1, 60, :driss),
	(:ws, :driss, '2020-03-03', :k1, 45, :driss),
	(:ws, :driss, '2020-03-04', :k3, 15, :driss),
	(:ws, :driss, '2020-03-05', :k4, 30, :driss);
insert into public.saisies_temps (workspace_id, profile_id, jour, channel_id, minutes, created_by) values
	(:ws, :driss, '2020-03-02', :ca1, 30, :driss),
	(:ws, :driss, '2020-03-04', :ca2, 15, :driss);

-- Une ligne de coût SOLDÉE portant un réel, sur l'affaire de 31 jours, et une autre sur l'affaire du track effacé, dont
-- le budget part avec son track.
insert into public.budgets (id, track_id, name, position) values
	('b7a50000-0000-4000-8000-0000000000d1', :ta, 'Rétention — budget vivant', 950),
	('b7a50000-0000-4000-8000-0000000000d2', :tb, 'Rétention — budget effacé', 951);
insert into public.card_costs (id, card_id, budget_id, label, estimated_cost) values
	('b7a50000-0000-4000-8000-0000000000e1', :k1, 'b7a50000-0000-4000-8000-0000000000d1', 'Licence', 100),
	('b7a50000-0000-4000-8000-0000000000e2', :k4, 'b7a50000-0000-4000-8000-0000000000d2', 'Sous-traitance', 200);
insert into public.card_cost_actuals (card_cost_id, amount) values ('b7a50000-0000-4000-8000-0000000000e1', 90);
update public.card_costs set settled_at = now() where id = 'b7a50000-0000-4000-8000-0000000000e1';

-- INC-316 : un troisième track en corbeille, dont le budget porte la dépense d'une affaire VIVANTE du track vivant.
insert into public.tracks (id, workspace_id, name, slug, position)
values ('b7a50000-0000-4000-8000-0000000000a3', :ws, 'Rétention — track au budget partagé', 'retention-partage', 952);
insert into public.budgets (id, track_id, name, position)
values ('b7a50000-0000-4000-8000-0000000000d3', 'b7a50000-0000-4000-8000-0000000000a3', 'Rétention — budget partagé', 952);
-- `CRM-111` T2.4.5 : l'affaire, puis son rattachement, en une instruction (les colonnes de rattachement ont quitté `cards`).
with __source as (select gen_random_uuid() as __id, * from (select * from (values ('b7a50000-0000-4000-8000-0000000000c5', :ws, :ca1, :wf, :etape, 'Rétention — affaire au budget d''ailleurs', 954)) as v(id, workspace_id, channel_id, workflow_id, current_step_id, title, position)) as s),
     __affaires as (insert into public.cards (id, workspace_id, title) select id::uuid, workspace_id::uuid, title from __source)
insert into public.card_placements (card_id, workspace_id, channel_id, workflow_id, current_step_id, position)
select id::uuid, workspace_id::uuid, channel_id::uuid, workflow_id::uuid, current_step_id::uuid, position::numeric from __source;
insert into public.card_costs (id, card_id, budget_id, label, estimated_cost)
values ('b7a50000-0000-4000-8000-0000000000e3', 'b7a50000-0000-4000-8000-0000000000c5',
        'b7a50000-0000-4000-8000-0000000000d3', 'Salon', 300);
update public.tracks set deleted_at = now() where id = 'b7a50000-0000-4000-8000-0000000000a3';

-- =============================================================================================
-- 1. La rétention en un seul endroit — §8.2
-- =============================================================================================

select is(app.trash_retention(), interval '30 days', '1 — app.trash_retention() rend 30 jours');
select ok(has_function_privilege('authenticated', 'public.trash_retention_days()', 'execute')
	and not has_function_privilege('anon', 'public.trash_retention_days()', 'execute'),
	'2 — trash_retention_days : authenticated, jamais l''anonyme');
select pg_temp.endosser(:farida);
select is(public.trash_retention_days(), 30, '3 — la lectrice lit 30 jours');
select pg_temp.redevenir_proprietaire();
select ok(not has_function_privilege('authenticated', 'app.purge_trash()', 'execute'),
	'4 — la purge n''est appelable par aucun client');

-- =============================================================================================
-- 2. La date de corbeille est celle du serveur, et elle est figée — §8.1
-- =============================================================================================

select pg_temp.endosser(:driss);
update public.cards set deleted_at = '2020-01-01T00:00:00Z' where id in (:k1, :k2);
select pg_temp.redevenir_proprietaire();
select is((select deleted_at from public.cards where id = :k1), now(),
	'5 — un geste antidaté prend la date du serveur');
select is((select deleted_by from public.cards where id = :k1), :driss::uuid, '6 — et son auteur');

select pg_temp.endosser(:camille);
update public.cards set deleted_at = '2020-01-01T00:00:00Z' where id = :k1;
select pg_temp.redevenir_proprietaire();
select is((select deleted_at from public.cards where id = :k1), now(),
	'7 — une fois en corbeille, la date ne se réécrit pas, même par l''administratrice');

-- `CRM-111` T2.4.5 : l'affaire, puis son rattachement, en une instruction (les colonnes de rattachement ont quitté `cards`).
with __source as (select gen_random_uuid() as __id, * from (select * from (values ('b7a50000-0000-4000-8000-0000000000c9', :ws, :ca1, :wf, :etape, 'Rétention — née en corbeille', 959, '2020-01-01')) as v(id, workspace_id, channel_id, workflow_id, current_step_id, title, position, deleted_at)) as s),
     __affaires as (insert into public.cards (id, workspace_id, title, deleted_at) select id::uuid, workspace_id::uuid, title, deleted_at::timestamptz from __source)
insert into public.card_placements (card_id, workspace_id, channel_id, workflow_id, current_step_id, position)
select id::uuid, workspace_id::uuid, channel_id::uuid, workflow_id::uuid, current_step_id::uuid, position::numeric from __source;
select is((select deleted_at from public.cards where id = 'b7a50000-0000-4000-8000-0000000000c9'), now(),
	'8 — une ligne qui naît en corbeille prend aussi la date du serveur');
delete from public.cards where id = 'b7a50000-0000-4000-8000-0000000000c9';

-- =============================================================================================
-- 3. La corbeille personnelle — §8.4
-- =============================================================================================

select pg_temp.endosser(:camille);
select is((select count(*)::int from public.cards where id in (:k1, :k2)), 2,
	'9 — l''administratrice lit les affaires en corbeille d''autrui');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:driss);
select is((select count(*)::int from public.cards where id in (:k1, :k2)), 2,
	'10 — l''auteur du retrait lit ce qu''il a mis à la corbeille');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:farida);
select is((select count(*)::int from public.cards where id = :k3), 1,
	'11 — témoin : la lectrice lit une affaire vivante du même track');
select is((select count(*)::int from public.cards where id in (:k1, :k2)), 0,
	'12 — elle ne lit pas les affaires qu''un autre a mises à la corbeille');
select pg_temp.redevenir_proprietaire();

-- Le channel et le track, par l'administratrice.
select pg_temp.endosser(:camille);
update public.channels set deleted_at = now() where id = :ca2;
update public.tracks set deleted_at = now() where id = :tb;
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:farida);
select is((select count(*)::int from public.channels where id in (:ca1, :ca2)), 1,
	'13 — la lectrice lit le channel vivant, pas celui que l''administratrice a retiré');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:driss);
select is((select count(*)::int from public.channels where id = :ca2), 0,
	'14 — un membre qui n''est pas l''auteur du retrait ne le lit pas non plus');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:camille);
select is((select count(*)::int from public.tracks where id = :tb), 1, '15 — l''administratrice lit le track en corbeille');
-- Restaurer rend la règle commune : le channel redevient lisible par la lectrice.
update public.channels set deleted_at = null where id = :ca2;
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:farida);
select is((select count(*)::int from public.channels where id = :ca2), 1, '16 — restauré, il redevient lisible par tous');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser(:camille);
update public.channels set deleted_at = now() where id = :ca2;
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 4. L'effacement définitif — §8.3
-- =============================================================================================

-- LA PREUVE S'ISOLE DE CE QUI EST DÉJÀ EN CORBEILLE. Une base mise en corbeille avant la `0120` porte des dates du
-- client, parfois anciennes (celle du seed d'avant était fixe) : la purge les prendrait aussi. Dans cette transaction
-- annulée, tout ce qui est déjà en corbeille prend la date du jour ; seules les fixtures sont ensuite reculées.
do $$
declare
	t text;
begin
	foreach t in array array['tracks', 'channels', 'cards'] loop
		execute format('alter table public.%I disable trigger %I', t, t || '_corbeille');
		execute format('update public.%I set deleted_at = now() where deleted_at is not null', t);
		execute format('alter table public.%I enable trigger %I', t, t || '_corbeille');
	end loop;
end;
$$;
select pg_temp.reculer('cards', :k1, 31);
select pg_temp.reculer('cards', :k2, 29);
select pg_temp.reculer('channels', :ca2, 40);
select pg_temp.reculer('tracks', :tb, 40);
select pg_temp.reculer('tracks', 'b7a50000-0000-4000-8000-0000000000a3', 45);

create temp table pg_temp.repere as select coalesce(max(id), 0) as id from public.audit_log;

select is(app.purge_trash(), 3, '17 — la purge efface trois objets : un track, un channel, une affaire');

select ok(not exists (select 1 from public.tracks where id = :tb)
	and not exists (select 1 from public.channels where id in (:ca2, :cb))
	and not exists (select 1 from public.cards where id in (:k1, :k3, :k4)),
	'18 — le track, le channel et l''affaire de plus de 30 jours sont détruits, avec ce qu''ils contiennent');
select ok(exists (select 1 from public.cards where id = :k2 and deleted_at is not null),
	'19 — l''affaire de 29 jours reste dans la corbeille');
select ok(exists (select 1 from public.tracks where id = :ta) and exists (select 1 from public.channels where id = :ca1),
	'20 — les parents vivants restent');

-- Le journal : `purged` dans l'ordre track, channel, affaire.
select results_eq(
	$$ select entity_type, entity_id from public.audit_log
	    where id > (select id from pg_temp.repere) and action = 'purged' order by id $$,
	$$ values ('track'::text, 'b7a50000-0000-4000-8000-0000000000a2'::uuid),
	          ('channel', 'b7a50000-0000-4000-8000-0000000000b2'),
	          ('card', 'b7a50000-0000-4000-8000-0000000000c1') $$,
	'21 — trois entrées `purged`, les tracks d''abord, puis les channels, puis les affaires');
select is((select family from public.audit_log where id > (select id from pg_temp.repere) and action = 'purged' limit 1),
	'retention', '22 — famille `retention`');
select is((select actor_id from public.audit_log where id > (select id from pg_temp.repere) and action = 'purged'
	and entity_type = 'card'), null, '23 — sans auteur : c''est le produit qui efface');
select is((select details -> 'deleted_by' from public.audit_log where id > (select id from pg_temp.repere)
	and action = 'purged' and entity_type = 'card'), to_jsonb(:driss::text), '24 — le détail garde l''auteur du retrait');
select is((select entity_label from public.audit_log where id > (select id from pg_temp.repere)
	and action = 'purged' and entity_type = 'card'), 'Rétention — affaire de 31 jours', '25 — et le libellé de l''objet');
select is((select details -> 'enumerated' from public.audit_log where id > (select id from pg_temp.repere)
	and action = 'purged' and entity_type = 'track'),
	'{"cards": 1, "budgets": 1, "channels": 1, "comments": 0, "activities": 0, "cost_lines": 1, "field_values": 0, "revenue_lines": 0,
	  "messages_unlinked": 0, "time_entries_moved": 0, "time_entries_deleted": 1}'::jsonb,
	'26 — le track énumère ce qu''il emporte, dont une saisie de temps effacée');
select is((select details -> 'enumerated' ->> 'time_entries_moved' from public.audit_log
	where id > (select id from pg_temp.repere) and action = 'purged' and entity_type = 'channel'), '2',
	'27 — le channel énumère deux saisies reportées');
select is((select details -> 'enumerated' ->> 'cost_lines' from public.audit_log
	where id > (select id from pg_temp.repere) and action = 'purged' and entity_type = 'card'), '1',
	'28 — l''affaire énumère sa ligne de coût soldée, détruite sans refus');
select ok((select count(*) from public.audit_log where id > (select id from pg_temp.repere) and action = 'destroyed'
	and entity_id in (:tb, :cb, :ca2, :k1, :k3, :k4)) = 6,
	'29 — chaque objet détruit, en cascade compris, porte son entrée `destroyed`');

-- Les saisies de temps : reportées, jamais perdues avec leur affaire (Q1, option B).
select is((select minutes from public.saisies_temps where profile_id = :driss and jour = '2020-03-02' and channel_id = :ca1),
	90, '30 — la saisie de l''affaire s''ajoute à celle de son channel, le même jour');
select is((select count(*)::int from public.saisies_temps where profile_id = :driss and jour = '2020-03-03'
	and channel_id = :ca1 and minutes = 45), 1, '31 — sans saisie sur le channel ce jour-là, elle change de cible');
select is((select minutes from public.saisies_temps where profile_id = :driss and jour = '2020-03-04' and track_id = :ta),
	30, '32 — celles du channel effacé et de son affaire rejoignent le track, additionnées');
select is((select count(*)::int from public.saisies_temps where profile_id = :driss and jour = '2020-03-05'), 0,
	'33 — seule la saisie sous un track effacé disparaît');

-- La règle commune des saisies est intacte hors de la purge.
select throws_ok(
	$$ update public.saisies_temps set track_id = 'b7a50000-0000-4000-8000-0000000000a1', channel_id = null
	    where profile_id = '5eed0000-0000-4000-8000-000000000012' and jour = '2020-03-03' $$,
	'P0001', 'seules les minutes d''une saisie changent',
	'34 — hors de la purge, une saisie ne change toujours pas de cible');

select ok(exists (select 1 from public.tracks where id = 'b7a50000-0000-4000-8000-0000000000a3' and deleted_at is not null),
	'35 — INC-316 : le track dont le budget porte la dépense d''une autre affaire reste en corbeille');
select ok(not exists (select 1 from public.audit_log where id > (select id from pg_temp.repere)
	and entity_id = 'b7a50000-0000-4000-8000-0000000000a3'),
	'36 — rien de lui n''est journalisé : son entrée `purged` est annulée avec sa destruction');
select ok(exists (select 1 from public.card_costs where id = 'b7a50000-0000-4000-8000-0000000000e3'),
	'37 — et la ligne de coût de l''affaire vivante est intacte');

select * from finish();
rollback;
