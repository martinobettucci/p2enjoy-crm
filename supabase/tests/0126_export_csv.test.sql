-- @verifies CRM-071 (docs/BACKLOG.md) — tranche T4 : l'export CSV en base — les lignes sous la RLS de la personne, les
--           filtres d'une vue, l'ordre, le journal, le plafond et les refus nommés
-- @verifies docs/SPEC-vues-import-export.md §5.1, §5.2 ; docs/SPEC-audit.md §4.5 (la famille `export`) ; CLAUDE.md §10
--
-- Joué sous le rôle `authenticated` de Driss (business developer) et de Farida (lectrice, fermée sur « Conseil & IA »). Le
-- `rollback` final rend la base intacte, le journal compris.

begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

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

\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set refonte '\'5eed0000-0000-4000-8000-000000000034\''
\set grands '\'5eed0000-0000-4000-8000-000000000032\''
\set negociation '\'5eed0000-0000-4000-8000-000000000063\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set farida '\'5eed0000-0000-4000-8000-000000000013\''

-- =============================================================================================
-- 1. Le contrat
-- =============================================================================================

select ok(
	has_function_privilege('authenticated', 'public.export_cards(uuid, jsonb)', 'EXECUTE')
	and has_function_privilege('authenticated', 'public.export_contacts(uuid)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.export_cards(uuid, jsonb)', 'EXECUTE')
	and not has_function_privilege('anon', 'public.export_contacts(uuid)', 'EXECUTE'),
	'1 — les deux exports sont aux membres connectés, jamais à l''anonyme');
select ok((select prosecdef = false from pg_proc where oid = 'public.export_cards(uuid, jsonb)'::regprocedure)
          and (select prosecdef = false from pg_proc where oid = 'public.export_contacts(uuid)'::regprocedure)
          and (select prosecdef from pg_proc where oid = 'app.audit_export(uuid, text, integer, jsonb)'::regprocedure),
	'2 — les exports lisent sous la RLS de l''appelant ; seul le journal est un définisseur');

-- =============================================================================================
-- 2. La vue liste d'un channel
-- =============================================================================================

-- Ce que la base retient, lu par le propriétaire, pour comparer : les rattachements actifs et éveillés de « Refonte ».
create temp table pg_temp.attendu as
select a.id from public.card_placements p join public.cards a on a.id = p.card_id
 where p.channel_id = :refonte and p.archived_at is null and a.deleted_at is null
   and (p.snoozed_until is null or p.snoozed_until <= now());
grant select on pg_temp.attendu to authenticated;

select pg_temp.endosser(:driss);
select set_eq($$ select card_id from public.export_cards('5eed0000-0000-4000-8000-000000000034') $$,
	$$ select id from pg_temp.attendu $$, '3 — sans filtre : toutes les affaires éveillées du channel, toutes pages confondues');
select ok((select bool_and(step_label = 'Négociation') and count(*) > 0
             from public.export_cards('5eed0000-0000-4000-8000-000000000034', '{"step_id": "5eed0000-0000-4000-8000-000000000063"}')),
	'4 — le filtre d''étape de la vue s''applique');
select is((select array_agg(amount order by ordre) = array_agg(amount order by amount desc nulls last)
             from (select amount, row_number() over () as ordre
                     from public.export_cards('5eed0000-0000-4000-8000-000000000034', '{"sort": "amount"}')) x),
	true, '5 — le tri par montant, décroissant par défaut, nuls en dernier');
select is((select labels from public.export_cards('5eed0000-0000-4000-8000-000000000034')
            where title = 'Refonte intranet Ville de Lyon'),
	'Partenaire, Prioritaire, Salon 2025, Secteur public', '6 — les étiquettes d''une affaire, par nom, en une cellule');
select is((select count(*)::int from public.export_cards('5eed0000-0000-4000-8000-000000000034', '{"search": "lyon"}')),
	1, '7 — la recherche plein texte, sans casse ni accent, comme la vue liste');
select throws_ok($$ select * from public.export_cards('5eed0000-0000-4000-8000-000000000034', '{"page": 2}') $$,
	'22023', 'invalid_filters', '8 — des filtres hors des six clés sont refusés');
select pg_temp.redevenir_proprietaire();

select is((select details ->> 'count' from public.audit_log
            where entity_type = 'card_list' and actor_id = :driss order by id desc limit 1),
	'1', '9 — chaque export est journalisé avec son compte (le dernier : la recherche « lyon »)');
select is((select family || '|' || action || '|' || (details -> 'filters' ->> 'search') from public.audit_log
            where entity_type = 'card_list' and actor_id = :driss order by id desc limit 1),
	'export|exported|lyon', '10 — dans la famille `export`, avec ses filtres, jamais une ligne exportée');

select pg_temp.endosser(:farida);
select throws_ok($$ select * from public.export_cards('5eed0000-0000-4000-8000-000000000032') $$,
	'P0002', 'channel_not_found', '11 — la lectrice fermée sur « Conseil & IA » : le channel est introuvable pour elle');
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.audit_log where entity_type = 'card_list' and actor_id = :farida), 0,
	'12 — et rien n''est journalisé pour un export refusé');

-- =============================================================================================
-- 3. Le carnet
-- =============================================================================================

select pg_temp.endosser(:driss);
select is((select count(*)::int from public.export_contacts(:ws)),
	(select count(*)::int from public.contacts where workspace_id = :ws), '13 — le carnet entier de l''espace');
select throws_ok($$ select * from public.export_contacts('5eed0000-0000-4000-8000-0000000e7299') $$,
	'P0002', 'workspace_not_found', '14 — un espace dont on n''est pas membre n''existe pas');
select pg_temp.redevenir_proprietaire();
select is((select (details ->> 'count')::int from public.audit_log where entity_type = 'contact_list' and actor_id = :driss
            order by id desc limit 1),
	(select count(*)::int from public.contacts where workspace_id = :ws), '15 — l''export du carnet est journalisé avec son compte');

-- =============================================================================================
-- 4. Le plafond — 5 000 lignes
-- =============================================================================================

-- 5 001 affaires jetables rattachées à « Refonte », dans la transaction : le plafond est refusé avant tout journal.
insert into public.cards (id, workspace_id, title)
select gen_random_uuid(), :ws, 'ZZ 071 export ' || g from generate_series(1, 5001) g;
insert into public.card_placements (card_id, workspace_id, channel_id, workflow_id, current_step_id)
select c.id, c.workspace_id, :refonte, ch.workflow_id, (select s.id from public.workflow_steps s
        where s.workflow_id = ch.workflow_id order by s.position limit 1)
  from public.cards c cross join public.channels ch
 where c.title like 'ZZ 071 export %' and ch.id = :refonte;
select pg_temp.endosser(:driss);
select throws_ok($$ select * from public.export_cards('5eed0000-0000-4000-8000-000000000034') $$,
	'22023', 'export_too_large', '16 — au-delà de 5 000 lignes, l''export est refusé');
select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;
