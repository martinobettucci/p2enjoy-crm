-- @verifies CRM-099 (docs/BACKLOG.md) — tranche T1 : plusieurs coûts réels par ligne de coût, jusqu'à ce qu'on la solde
-- @verifies docs/SPEC-costs.md §2.3 bis (les réels ; `actual_cost` dérivé : somme, zéro soldée, nul ouverte ; la ligne
--           soldée figée ; la clôture d'un budget qui ne ferme pas ses lignes ; la reprise des réels existants), §2.3,
--           §3 (lecture et écriture : celles de la ligne) ; docs/SCHEMA.md §9 quater « Migration `0088` » ; CLAUDE.md §10
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La forme : la table des réels, sa RLS, les deux colonnes de la ligne soldée.
-- 2. La reprise : chaque ligne du seed dont le réel était connu porte un réel de ce montant, et reste ouverte.
-- 3. Le réel dérivé, sur ses trois états, et son refus d'être écrit directement.
-- 4. La ligne soldée : figée pour ses réels, rouverte en décochant ; soldée sans réel, elle vaut zéro.
-- 5. La frontière de la clôture : un budget clos accepte encore des réels et le soldé.
-- 6. Les droits, avec les profils réels : la lectrice lit et n'écrit pas, le commercial écrit, et une ligne illisible
--    garde ses réels illisibles.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(35);

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

create or replace function pg_temp.lignes_touchees(requete text)
returns bigint language plpgsql as $$
declare
	touchees bigint;
begin
	execute requete;
	get diagnostics touchees = row_count;
	return touchees;
end;
$$;

create or replace function pg_temp.reel(ligne uuid) returns numeric language sql as $$
	select actual_cost from public.card_costs where id = ligne
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures, en propriétaire. Les mêmes objets du seed que la suite `0049`, mesurés sur la pile :
--   * « Studio web » (…022) — lu par les trois ; « Conseil & IA » (…021) — invisible à Farida ;
--   * l'affaire « Refonte intranet Ville de Lyon » (…0c4), que Farida LIT et que Driss ÉCRIT.
-- ---------------------------------------------------------------------------------------------
insert into public.budgets (id, track_id, name, currency, planned_amount, is_recurrent, closed_at, position, created_by)
values
	('c0830000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000022', 'Budget de la suite 0083', 'EUR',
	 5000, false, null, 300, '5eed0000-0000-4000-8000-000000000011'),
	('c0830000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000022', 'Budget à clôturer 0083', 'EUR',
	 5000, false, null, 301, '5eed0000-0000-4000-8000-000000000011'),
	('c0830000-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000021', 'Budget fermé à Farida 0083', 'EUR',
	 5000, false, null, 302, '5eed0000-0000-4000-8000-000000000011');

insert into public.card_costs (id, card_id, budget_id, label, estimated_cost, created_by)
values
	('c0830000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c4', 'c0830000-0000-4000-8000-000000000001',
	 'Publicité 0083', 100, '5eed0000-0000-4000-8000-000000000012'),
	('c0830000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000c4', 'c0830000-0000-4000-8000-000000000001',
	 'Rien dépensé 0083', 50, '5eed0000-0000-4000-8000-000000000012'),
	('c0830000-0000-4000-8000-0000000000a3', '5eed0000-0000-4000-8000-0000000000c4', 'c0830000-0000-4000-8000-000000000002',
	 'Salon 0083', 300, '5eed0000-0000-4000-8000-000000000012'),
	('c0830000-0000-4000-8000-0000000000a4', '5eed0000-0000-4000-8000-0000000000c4', 'c0830000-0000-4000-8000-000000000003',
	 'Illisible 0083', 10, '5eed0000-0000-4000-8000-000000000012');

-- =============================================================================================
-- 1. La forme
-- =============================================================================================
select has_table('public', 'card_cost_actuals', '1 — la table des réels existe');
select is((select relrowsecurity from pg_class where oid = 'public.card_cost_actuals'::regclass), true, '2 — sa RLS est active');
select has_column('public', 'card_costs', 'settled_at', '3 — la ligne porte sa date de solde');
select has_column('public', 'card_costs', 'settled_by', '4 — et qui l’a soldée');

-- =============================================================================================
-- 2. La reprise (décision 622, point 3)
-- =============================================================================================
select is(
	(select count(*)::int from public.card_costs c
	  where c.id::text not like 'c0830000%'
	    and c.actual_cost is not null
	    and c.actual_cost is distinct from (select sum(a.amount) from public.card_cost_actuals a where a.card_cost_id = c.id)),
	0, '5 — chaque réel connu du seed est la somme de ses réels repris');
select ok(
	(select count(*) from public.card_cost_actuals a join public.card_costs c on c.id = a.card_cost_id
	  where c.id::text not like 'c0830000%') > 0
	and not exists (select 1 from public.card_costs c
	                 where c.id::text not like 'c0830000%' and c.actual_cost is null
	                   and exists (select 1 from public.card_cost_actuals a where a.card_cost_id = c.id)),
	'6 — la reprise a posé des réels, et aucune ligne au réel inconnu n’en porte (le seed solde une ligne depuis '
	'CRM-099 : l’état « rouvert » de la reprise se lit dans la migration, qui ne pose aucun settled_at)');

-- =============================================================================================
-- 3. Le réel dérivé
-- =============================================================================================
select is(pg_temp.reel('c0830000-0000-4000-8000-0000000000a1'), null::numeric, '7 — ouverte et sans réel : le réel est inconnu, nul');
select throws_ok(
	$$insert into public.card_costs (card_id, budget_id, label, estimated_cost, actual_cost)
	  values ('5eed0000-0000-4000-8000-0000000000c4', 'c0830000-0000-4000-8000-000000000001', 'Réel écrit 0083', 10, 8)$$,
	'23514', 'reel derive', '8 — une ligne ne naît pas avec un réel écrit à la main');
select lives_ok(
	$$insert into public.card_cost_actuals (card_cost_id, amount, label) values
	  ('c0830000-0000-4000-8000-0000000000a1', 40, 'Facture 1'),
	  ('c0830000-0000-4000-8000-0000000000a1', -5, 'Avoir'),
	  ('c0830000-0000-4000-8000-0000000000a1', 0, null)$$,
	'9 — trois réels : une facture, un avoir négatif, un zéro, sans contrainte de signe');
select is(pg_temp.reel('c0830000-0000-4000-8000-0000000000a1'), 35.00::numeric, '10 — le réel de la ligne est leur somme');
select is(
	(select spent_on from public.card_cost_actuals where label = 'Facture 1'), current_date,
	'11 — la date de la dépense est celle du jour par défaut');
select throws_ok(
	$$insert into public.card_cost_actuals (card_cost_id, amount, label) values ('c0830000-0000-4000-8000-0000000000a1', 1, '   ')$$,
	'23514', null, '12 — un libellé blanc est refusé ; absent, il est permis');
select lives_ok(
	$$update public.card_cost_actuals set amount = 60 where label = 'Facture 1'$$, '13 — un réel se corrige');
select is(pg_temp.reel('c0830000-0000-4000-8000-0000000000a1'), 55.00::numeric, '14 — et la somme suit');
select lives_ok($$delete from public.card_cost_actuals where label = 'Avoir'$$, '15 — un réel se retire');
select is(pg_temp.reel('c0830000-0000-4000-8000-0000000000a1'), 60.00::numeric, '16 — et la somme suit encore');
select throws_ok(
	$$update public.card_costs set actual_cost = 999 where id = 'c0830000-0000-4000-8000-0000000000a1'$$,
	'23514', 'reel derive', '17 — le réel ne s’écrit pas directement');
select lives_ok(
	$$insert into public.card_costs (id, card_id, budget_id, label, estimated_cost)
	  values ('c0830000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c4',
	          'c0830000-0000-4000-8000-000000000001', 'Publicité 0083', 100)
	  on conflict (id) do update set estimated_cost = excluded.estimated_cost$$,
	'17 bis — l’upsert d’une ligne qui porte déjà des réels passe : la ligne proposée n’écrit aucun réel');
select lives_ok(
	$$update public.card_costs set label = 'Publicité 0083 renommée' where id = 'c0830000-0000-4000-8000-0000000000a1'$$,
	'18 — le reste de la ligne s’écrit comme avant');
select throws_ok(
	$$update public.card_cost_actuals set card_cost_id = 'c0830000-0000-4000-8000-0000000000a2' where label = 'Facture 1'$$,
	'P0001', 'un reel ne change pas de ligne', '19 — un réel ne change pas de ligne');

-- =============================================================================================
-- 4. La ligne soldée — gestes du commercial, qui écrit l'affaire
-- =============================================================================================
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.lignes_touchees(
	$$update public.card_costs set settled_at = '2000-01-01' where id = 'c0830000-0000-4000-8000-0000000000a1'$$),
	1::bigint, '20 — le commercial solde la ligne');
select pg_temp.redevenir_proprietaire();
select is(
	(select settled_by::text || ':' || (settled_at > now() - interval '1 minute')::text from public.card_costs
	  where id = 'c0830000-0000-4000-8000-0000000000a1'),
	'5eed0000-0000-4000-8000-000000000012:true',
	'21 — l’horodatage est celui de la base, et l’auteur celui du jeton — la valeur envoyée n’est qu’un drapeau');
select is(pg_temp.reel('c0830000-0000-4000-8000-0000000000a1'), 60.00::numeric, '22 — soldée avec des réels : leur somme');
select throws_ok(
	$$insert into public.card_cost_actuals (card_cost_id, amount) values ('c0830000-0000-4000-8000-0000000000a1', 1)$$,
	'P0001', 'ligne soldee', '23 — une ligne soldée ne reçoit plus de réel');
select throws_ok($$update public.card_cost_actuals set amount = 1 where label = 'Facture 1'$$,
	'P0001', 'ligne soldee', '24 — ni ne laisse corriger les siens');
select throws_ok($$delete from public.card_cost_actuals where label = 'Facture 1'$$,
	'P0001', 'ligne soldee', '25 — ni retirer');
select lives_ok(
	$$update public.card_costs set settled_at = null where id = 'c0830000-0000-4000-8000-0000000000a1';
	  insert into public.card_cost_actuals (card_cost_id, amount) values ('c0830000-0000-4000-8000-0000000000a1', 1)$$,
	'26 — décocher rouvre la ligne, qui reçoit de nouveau des réels');
select is(
	(select coalesce(settled_by::text, 'nul') from public.card_costs where id = 'c0830000-0000-4000-8000-0000000000a1'),
	'nul', '27 — rouverte, elle n’a plus d’auteur de solde');
select lives_ok(
	$$update public.card_costs set settled_at = now() where id = 'c0830000-0000-4000-8000-0000000000a2'$$,
	'28 — une ligne sans réel se solde');
select is(pg_temp.reel('c0830000-0000-4000-8000-0000000000a2'), 0::numeric, '29 — soldée sans réel, elle vaut zéro : « finalement rien dépensé »');

-- =============================================================================================
-- 5. La frontière de la clôture (§2.3)
-- =============================================================================================
update public.budgets set closed_at = now() where id = 'c0830000-0000-4000-8000-000000000002';
select lives_ok(
	$$insert into public.card_cost_actuals (card_cost_id, amount, label) values ('c0830000-0000-4000-8000-0000000000a3', 320, 'Facture tardive');
	  update public.card_costs set settled_at = now() where id = 'c0830000-0000-4000-8000-0000000000a3'$$,
	'30 — sur un budget clos, la facture arrivée après la clôture se saisit, et la ligne se solde');

-- =============================================================================================
-- 6. Les droits, avec les profils réels
-- =============================================================================================
insert into public.card_cost_actuals (card_cost_id, amount) values ('c0830000-0000-4000-8000-0000000000a4', 7);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(
	(select count(*)::int from public.card_cost_actuals where card_cost_id = 'c0830000-0000-4000-8000-0000000000a1'),
	3, '31 — la lectrice lit les réels d’une ligne qu’elle lit (la facture, le zéro, et celui saisi après réouverture)');
select throws_ok(
	$$insert into public.card_cost_actuals (card_cost_id, amount) values ('c0830000-0000-4000-8000-0000000000a1', 1)$$,
	'42501', null, '32 — mais n’en saisit pas : elle n’écrit pas l’affaire');
select is(
	(select count(*)::int from public.card_cost_actuals where card_cost_id = 'c0830000-0000-4000-8000-0000000000a4'),
	0, '33 — et ne lit rien d’une ligne dont le budget lui est fermé');
select pg_temp.redevenir_proprietaire();

select lives_ok(
	$$update public.card_costs set settled_at = now() where id = 'c0830000-0000-4000-8000-0000000000a1';
	  delete from public.card_costs where id = 'c0830000-0000-4000-8000-0000000000a1'$$,
	'34 — une ligne SOLDÉE se supprime avec ses réels : la cascade n’est pas un retrait de réel');

select * from finish();

rollback;
