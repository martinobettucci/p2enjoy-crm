-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T5.1 : la rentabilité par rattachement × devise
-- @verifies docs/SPEC-rattachements.md §6 (une ligne par rattachement × devise, `shared`, l'état du rattachement, les
--           sommes de l'affaire rappelées sans être multipliées ; décision 643) ; docs/SPEC-recettes.md §5 ;
--           docs/SCHEMA.md « Migration `0153` »
--
-- Sur le seed migré, sous le rôle réel de l'administratrice : l'affaire …0c4 de `refonte` est rattachée en plus à
-- `grands-comptes`. Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

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

\set admin    '5eed0000-0000-4000-8000-000000000011'
\set bizdev   '5eed0000-0000-4000-8000-000000000012'
\set c4 '5eed0000-0000-4000-8000-0000000000c4'
\set grands_comptes '5eed0000-0000-4000-8000-000000000032'
\set refonte        '5eed0000-0000-4000-8000-000000000034'

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select ok(pg_get_function_result('public.rentabilite_affaires(date, date, uuid)'::regprocedure)
            like '%minutes_non_valorisees bigint, shared boolean)',
	'`rentabilite_affaires` rend `shared` en dernière colonne');
select ok(has_function_privilege('authenticated', 'public.rentabilite_affaires(date, date, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.rentabilite_affaires(date, date, uuid)', 'execute')
          and not (select prosecdef from pg_proc where oid = 'public.rentabilite_affaires(date, date, uuid)'::regprocedure),
	'recréée, elle reste `security invoker`, exécutable par `authenticated`, jamais par `anon`');

-- =============================================================================================
-- 2. Une affaire à un rattachement : une ligne par devise, non partagée
-- =============================================================================================

-- Les tables de relevé naissent sous le propriétaire, et se remplissent sous l'administratrice.
create temp table t_avant (workspace_id uuid, track_id uuid, channel_id uuid, card_id uuid, node_kind text, archivee boolean, currency text,
	recettes_prevues numeric, recettes_reelles numeric, lignes_recette integer, lignes_recette_sans_reel integer, couts_prevus numeric,
	couts_reels numeric, lignes_cout integer, lignes_cout_sans_reel integer, personnel numeric, minutes bigint,
	minutes_non_valorisees bigint, shared boolean);
create temp table t_apres (like t_avant);
grant all on t_avant, t_apres to authenticated;

select pg_temp.endosser(:'admin');
insert into t_avant select * from public.rentabilite_affaires(null, null, :'c4');
select is((select count(distinct channel_id)::int from t_avant), 1,
	'…0c4, rattachée à `refonte` seule, rend ses lignes sous un seul channel');
select ok((select bool_and(not shared) from t_avant), '… non partagées');

-- =============================================================================================
-- 3. Rattachée à deux channels : une ligne par rattachement, les sommes rappelées, jamais multipliées
-- =============================================================================================

select id as attache from public.attach_card(:'c4', :'grands_comptes') \gset
insert into t_apres select * from public.rentabilite_affaires(null, null, :'c4');

select is((select array_agg(distinct channel_id::text order by channel_id::text) from t_apres),
          (select array_agg(x order by x) from unnest(array[:'grands_comptes'::text, :'refonte'::text]) x),
	'rattachée à `grands-comptes`, …0c4 rend une ligne sous CHACUN de ses deux channels');
select ok((select bool_and(shared) from t_apres), '… toutes marquées `shared`');
select is((select count(*)::int from t_apres),
          (select count(*)::int * 2 from t_avant),
	'… autant de lignes par channel qu''elle en avait seule : une par devise');
select ok(not exists (
	select 1 from t_apres p join t_avant a on a.currency = p.currency
	 where p.recettes_prevues is distinct from a.recettes_prevues
	    or p.couts_prevus is distinct from a.couts_prevus
	    or p.personnel is distinct from a.personnel
	    or p.minutes is distinct from a.minutes),
	'les recettes, les coûts, le personnel et le temps de l''affaire sont RAPPELÉS sur chaque ligne, jamais multipliés');
select is((select array_agg(p.node_kind order by p.channel_id) from (select distinct channel_id, node_kind from t_apres) p),
          (select array_agg(n.kind order by pl.channel_id)
             from public.card_placements pl
             join public.workflow_steps s on s.id = pl.current_step_id
             join public.workflow_nodes_catalog n on n.id = s.node_id
            where pl.card_id = :'c4'),
	'chaque ligne porte l''état de SON rattachement');

-- =============================================================================================
-- 4. La garde ne change pas
-- =============================================================================================

select pg_temp.endosser(:'bizdev');
select throws_ok(format('select * from public.rentabilite_affaires(null, null, %L)', :'c4'), '42501', 'rentabilite_reservee',
	'le business developer, qui lit l''affaire sans administrer l''espace, reste refusé');

select * from finish();
rollback;
