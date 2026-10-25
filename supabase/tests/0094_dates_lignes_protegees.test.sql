-- @verifies CRM-013 (docs/BACKLOG.md) — colonnes protégées, tranche INC-238 : la date de naissance d'une ligne de coût
--           et d'une ligne de recette
-- @verifies docs/SPEC-permissions-rls.md §4.3 (colonnes ouvertes énumérées), §4.4.7 (portée, forme, contrat) ;
--           docs/SCHEMA.md « Migration `0104` » ; docs/INCONSISTENCY_REPORT.md INC-238 ; docs/SPEC-costs.md §2.1 bis
--
-- Suite pgTAP de la migration `0104`. Elle prouve quatre choses :
--
--   1. `authenticated` n'a plus `INSERT` ni `UPDATE` sur `created_at` et `updated_at` des deux tables, et garde la
--      lecture ;
--   2. toutes les autres colonnes restent ouvertes à l'écriture, ÉNUMÉRÉES une par une et COMPTÉES, de sorte qu'une
--      fermeture trop large — ou une colonne ajoutée sans être tranchée — fasse échouer la suite ;
--   3. le refus est opposable en base sous le rôle `authenticated` : `42501` à l'insertion comme à la mise à jour, et
--      une insertion sans ces colonnes reçoit la date de la base ;
--   4. `service_role` choisit encore la date : c'est le chemin du seed.
--
-- Exécution (conteneur désigné par son service, CRM-115 T2, docs/SPEC-pile-par-session.md §6) : `npm run test:sql`, `scripts/verify-colonnes-protegees.sh`, ou directement
--   docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml \
--     exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0094_dates_lignes_protegees.test.sql
--
-- Tout se joue dans une transaction annulée en fin de fichier, sans `rollback to savepoint` (décision 79) : les refus
-- sont pris par `throws_ok`, qui isole l'erreur sans annuler l'assertion.

begin;

create extension if not exists pgtap with schema extensions;

select plan(30);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- Les colonnes d'une table auxquelles `authenticated` peut écrire par `privilege`, triées : la liste que le §4.4.7
-- fixe, et rien d'autre.
create or replace function pg_temp.ouvertes(p_table text, p_privilege text)
returns text[] language sql as $$
	select array_agg(column_name::text order by column_name::text)
	  from information_schema.columns
	 where table_schema = 'public' and table_name = p_table
	   and has_column_privilege('authenticated', format('public.%I', p_table), column_name, p_privilege);
$$;

-- =============================================================================================
-- 1. Les colonnes fermées — §4.4.7
-- =============================================================================================

select ok(not has_column_privilege('authenticated', 'public.card_costs', 'created_at', 'insert'),
	'INC-238 : `authenticated` ne choisit plus la naissance d''une ligne de coût — l''ancienneté de « À saisir » et '
	'son seuil la lisent (docs/SPEC-costs.md §2.1 bis)');
select ok(not has_column_privilege('authenticated', 'public.card_costs', 'created_at', 'update'),
	'ni ne la réécrit ensuite');
select ok(not has_column_privilege('authenticated', 'public.card_costs', 'updated_at', 'insert'),
	'`card_costs.updated_at` : fermée à l''insertion');
select ok(not has_column_privilege('authenticated', 'public.card_costs', 'updated_at', 'update'),
	'`card_costs.updated_at` : fermée à la mise à jour, la base la tient');
select ok(not has_column_privilege('authenticated', 'public.card_revenues', 'created_at', 'insert'),
	'le même partout : `card_revenues.created_at` fermée à l''insertion — l''onglet « À saisir » des recettes lit '
	'la même ancienneté (docs/SPEC-recettes.md §6.4)');
select ok(not has_column_privilege('authenticated', 'public.card_revenues', 'created_at', 'update'),
	'`card_revenues.created_at` : fermée à la mise à jour');
select ok(not has_column_privilege('authenticated', 'public.card_revenues', 'updated_at', 'insert'),
	'`card_revenues.updated_at` : fermée à l''insertion');
select ok(not has_column_privilege('authenticated', 'public.card_revenues', 'updated_at', 'update'),
	'`card_revenues.updated_at` : fermée à la mise à jour');

select ok(has_column_privilege('authenticated', 'public.card_costs', 'created_at', 'select')
      and has_column_privilege('authenticated', 'public.card_revenues', 'created_at', 'select'),
	'la LECTURE reste ouverte : une date de création n''est pas un secret, et l''écran l''affiche');

-- =============================================================================================
-- 2. Ce qui reste ouvert, énuméré et compté
-- =============================================================================================

select is(pg_temp.ouvertes('card_costs', 'insert'),
	array['actual_cost', 'budget_id', 'card_id', 'created_by', 'estimated_cost', 'id', 'label', 'occurrence_id',
	      'settled_at', 'settled_by'],
	'`card_costs` : DIX colonnes ouvertes à l''insertion, exactement celles d''avant moins les deux dates');
select is(pg_temp.ouvertes('card_costs', 'update'),
	array['actual_cost', 'budget_id', 'card_id', 'created_by', 'estimated_cost', 'id', 'label', 'occurrence_id',
	      'settled_at', 'settled_by'],
	'`card_costs` : les mêmes DIX à la mise à jour');
select is(pg_temp.ouvertes('card_revenues', 'insert'),
	array['actual_amount', 'card_id', 'created_by', 'estimated_amount', 'id', 'label', 'position', 'settled_at',
	      'settled_by'],
	'`card_revenues` : NEUF colonnes ouvertes à l''insertion, `id` compris (l''upsert du seed le réécrit)');
select is(pg_temp.ouvertes('card_revenues', 'update'),
	array['actual_amount', 'card_id', 'created_by', 'estimated_amount', 'id', 'label', 'position', 'settled_at',
	      'settled_by'],
	'`card_revenues` : les mêmes NEUF à la mise à jour');

select ok(has_table_privilege('authenticated', 'public.card_costs', 'delete')
      and has_table_privilege('authenticated', 'public.card_revenues', 'delete'),
	'`DELETE` reste de table : la tranche ne touche que l''insertion et la mise à jour');
select ok(not has_table_privilege('anon', 'public.card_costs', 'insert')
      and not has_table_privilege('anon', 'public.card_revenues', 'insert'),
	'`anon` n''a toujours aucune écriture');

-- =============================================================================================
-- 3. Le refus en base, sous le rôle `authenticated` — contrat §4.4.7
-- =============================================================================================
-- L'administratrice du seed, sur une ligne et une affaire du seed : le refus ne doit rien à la RLS, que l'appelante
-- franchit — il tient au privilège, vérifié avant toute exécution.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, label, estimated_cost, created_at)
	  values ('5eed0000-0000-4000-8000-0000000000c7', '5eed0000-0000-4000-8000-0000000000c1', 'Sonde INC-238', 1,
	          '2026-05-01T09:00:00Z')$$,
	'42501', null,
	'(a) une ligne de coût qui choisit sa naissance est REFUSÉE (`42501`), là où elle était conservée telle quelle');

select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, label, estimated_cost, updated_at)
	  values ('5eed0000-0000-4000-8000-0000000000c7', '5eed0000-0000-4000-8000-0000000000c1', 'Sonde INC-238', 1,
	          now())$$,
	'42501', null,
	'(f) ni sa date de mise à jour');

select throws_ok(
	$$update public.card_costs set created_at = '2026-05-01T09:00:00Z'
	   where id = '5eed0000-0000-4000-8000-0000000000e1'$$,
	'42501', null,
	'(b) réécrire la naissance d''une ligne existante est refusé');

select throws_ok(
	$$update public.card_costs set updated_at = now() where id = '5eed0000-0000-4000-8000-0000000000e1'$$,
	'42501', null,
	'(f) réécrire sa date de mise à jour aussi');

select throws_ok(
	$$insert into public.card_revenues (card_id, label, estimated_amount, created_at)
	  values ('5eed0000-0000-4000-8000-0000000000c7', 'Sonde INC-238', 1, '2026-05-01T09:00:00Z')$$,
	'42501', null,
	'(c) une ligne de recette qui choisit sa naissance est refusée');

select throws_ok(
	$$update public.card_revenues set created_at = '2026-05-01T09:00:00Z'
	   where card_id = '5eed0000-0000-4000-8000-0000000000c7'$$,
	'42501', null,
	'une ligne de recette existante ne se rajeunit ni ne se vieillit');

-- (d) Sans ces colonnes, l'insertion passe et la base date la ligne.
select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, label, estimated_cost)
	  values ('0104c057-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-0000000000c7',
	          '5eed0000-0000-4000-8000-0000000000c1', 'Sonde INC-238', 1)$$,
	'(d) une ligne de coût sans date fournie se crée');
select ok(
	(select created_at > now() - interval '1 minute' from public.card_costs
	  where id = '0104c057-0000-4000-8000-000000000001'),
	'(d) et elle naît à l''heure de la base');

-- (e) Les colonnes ouvertes le restent, sous la même identité.
select lives_ok(
	$$update public.card_costs set label = 'Sonde INC-238 renommée'
	   where id = '0104c057-0000-4000-8000-000000000001'$$,
	'(e) le libellé se modifie toujours');
select is(
	(select label from public.card_costs where id = '0104c057-0000-4000-8000-000000000001'),
	'Sonde INC-238 renommée',
	'(e) et la modification est relue');

select lives_ok(
	$$insert into public.card_revenues (id, card_id, label, estimated_amount)
	  values ('0104c057-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-0000000000c7', 'Sonde INC-238', 1)$$,
	'une ligne de recette sans date fournie se crée');
select ok(
	(select created_at > now() - interval '1 minute' from public.card_revenues
	  where id = '0104c057-0000-4000-8000-000000000002'),
	'et elle naît à l''heure de la base');

-- =============================================================================================
-- 4. `service_role` choisit encore la date — le chemin du seed (§4.4.7)
-- =============================================================================================

reset role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;

select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, label, estimated_cost, created_at)
	  values ('0104c057-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-0000000000c7',
	          '5eed0000-0000-4000-8000-0000000000c1', 'Sonde INC-238 antidatée', 1, '2026-05-01T09:00:00Z')$$,
	'(h) `service_role` crée une ligne antidatée : le seed rend la variante de danger démontrable par ce chemin');
select is(
	(select created_at from public.card_costs where id = '0104c057-0000-4000-8000-000000000003'),
	'2026-05-01T09:00:00Z'::timestamptz,
	'(h) et la date choisie est conservée');

reset role;

select ok(has_column_privilege('service_role', 'public.card_revenues', 'created_at', 'insert'),
	'`service_role` garde aussi la date des recettes');

select finish();
rollback;
