-- @verifies CRM-108 (docs/BACKLOG.md) — tranche T2 : les recettes d'une affaire, la rentabilité et la famille `recettes`
-- @verifies docs/SPEC-recettes.md §2 (lignes, réels, réel dérivé dans ses trois états, ligne soldée figée, devise
--           verrouillée), §3 (lecture et écriture : celles de l'affaire ; rentabilité réservée aux administrateurs), §4.5
--           (la période filtre les réels), §4.6 (corbeille exclue, archivée présente), §5 (`rentabilite_affaires`),
--           §6.4 (`recette_saisissable`), §7 (famille `recettes`) ; docs/SCHEMA.md §9 sexies ; docs/SPEC-mcp.md §6.3,
--           §8.2 ; CLAUDE.md §10
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La forme : les deux tables et leur RLS.
-- 2. Le réel dérivé, ses trois états, son refus d'être écrit directement ; la ligne soldée figée, rouverte.
-- 3. La devise verrouillée par les recettes, libre sans elles ; la ligne qui ne change pas d'affaire.
-- 4. Les droits avec les profils réels : la lectrice lit sans écrire, le commercial écrit, `recette_saisissable`.
-- 5. `rentabilite_affaires` : refusée au commercial et à la lectrice, rendue à l'administratrice ; sommes recoupées
--    par des lectures indépendantes ; période ; devise CHF ; corbeille et archive ; temps non valorisé.
-- 6. La famille `recettes` du connecteur.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(48);

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
	select actual_amount from public.card_revenues where id = ligne
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures, en propriétaire, sur des objets du seed (docs/SPEC-seed.md) :
--   * …0c4 « Refonte intranet Ville de Lyon » (EUR) — Farida la LIT, Driss l'ÉCRIT, Camille administre l'espace ;
--     elle porte déjà des lignes de coût et du temps de Driss ;
--   * …0c7 « Formation Data & IA — promo 2026 » (CHF) ;
--   * …0cd « Socle analytique — Vertuo », gagnée, que la suite archive ;
--   * …0cb « Assistant IA support — Nordis », que le temps non valorisé de Farida fait paraître ;
--   * …0cc « Portail adhérents — MGEN Loire », mise à la corbeille dans la suite.
-- Les identifiants de la suite commencent par `c0870000`.
--
-- LES RECETTES DU SEED (§21) SONT RETIRÉES DANS LA TRANSACTION, que le `rollback` final rend intactes : les sommes
-- prouvées ici sont celles des fixtures de la suite, et ne dépendent pas du jeu de démonstration (trouvé par la série
-- complète, une fois le seed §21 joué).
-- ---------------------------------------------------------------------------------------------
delete from public.card_revenues
 where card_id in ('5eed0000-0000-4000-8000-0000000000c4', '5eed0000-0000-4000-8000-0000000000c7',
                   '5eed0000-0000-4000-8000-0000000000cd', '5eed0000-0000-4000-8000-0000000000cc');

insert into public.card_revenues (id, card_id, label, estimated_amount)
values
	('c0870000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c4', 'Lot 1 0087', 20000),
	('c0870000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000c4', 'Frais 0087', 1500),
	('c0870000-0000-4000-8000-0000000000a3', '5eed0000-0000-4000-8000-0000000000c7', 'Convention 0087', 28000),
	('c0870000-0000-4000-8000-0000000000a4', '5eed0000-0000-4000-8000-0000000000cd', 'Acompte 0087', 63000),
	('c0870000-0000-4000-8000-0000000000a5', '5eed0000-0000-4000-8000-0000000000cc', 'Corbeille 0087', 1000);

-- =============================================================================================
-- 1. La forme
-- =============================================================================================
select has_table('public', 'card_revenues', '1 — la table des lignes de recette existe');
select has_table('public', 'card_revenue_actuals', '2 — la table des recettes réelles existe');
select is(
	(select bool_and(relrowsecurity) from pg_class
	  where oid in ('public.card_revenues'::regclass, 'public.card_revenue_actuals'::regclass)),
	true, '3 — leur RLS est active');
select is(
	(select position from public.card_revenues where id = 'c0870000-0000-4000-8000-0000000000a2')
	- (select position from public.card_revenues where id = 'c0870000-0000-4000-8000-0000000000a1'),
	1::numeric, '4 — la position omise est la suivante dans l’affaire');

-- =============================================================================================
-- 2. Le réel dérivé et la ligne soldée
-- =============================================================================================
select is(pg_temp.reel('c0870000-0000-4000-8000-0000000000a1'), null::numeric, '5 — ouverte et sans réel : la recette réelle est inconnue');
select throws_ok(
	$$insert into public.card_revenues (card_id, label, estimated_amount, actual_amount)
	  values ('5eed0000-0000-4000-8000-0000000000c4', 'Réel écrit 0087', 10, 8)$$,
	'23514', 'reel derive', '6 — une ligne ne naît pas avec une recette réelle écrite à la main');
select lives_ok(
	$$insert into public.card_revenue_actuals (card_revenue_id, amount, received_on, label) values
	  ('c0870000-0000-4000-8000-0000000000a1', 3000, '2026-01-15', 'Facture janvier'),
	  ('c0870000-0000-4000-8000-0000000000a1', 1500, '2026-03-15', 'Facture mars'),
	  ('c0870000-0000-4000-8000-0000000000a1', -500, '2026-03-20', 'Avoir')$$,
	'7 — trois réels : deux factures et un avoir négatif, sans contrainte de signe');
select is(pg_temp.reel('c0870000-0000-4000-8000-0000000000a1'), 4000.00::numeric, '8 — la recette réelle est leur somme');
select lives_ok(
	$$insert into public.card_revenue_actuals (card_revenue_id, amount) values ('c0870000-0000-4000-8000-0000000000a3', 14000)$$,
	'9 — un réel sans date ni libellé');
select is(
	(select received_on from public.card_revenue_actuals where card_revenue_id = 'c0870000-0000-4000-8000-0000000000a3'),
	current_date, '10 — sa date est celle du jour par défaut');
select throws_ok(
	$$insert into public.card_revenue_actuals (card_revenue_id, amount, label) values ('c0870000-0000-4000-8000-0000000000a1', 1, '  ')$$,
	'23514', null, '11 — un libellé blanc est refusé');
select throws_ok(
	$$update public.card_revenues set actual_amount = 999 where id = 'c0870000-0000-4000-8000-0000000000a1'$$,
	'23514', 'reel derive', '12 — la recette réelle ne s’écrit pas directement');
select throws_ok(
	$$update public.card_revenue_actuals set card_revenue_id = 'c0870000-0000-4000-8000-0000000000a2' where label = 'Avoir'$$,
	'P0001', 'un reel ne change pas de ligne', '13 — un réel ne change pas de ligne');
select throws_ok(
	$$insert into public.card_revenues (card_id, label, estimated_amount) values ('5eed0000-0000-4000-8000-0000000000c4', '   ', 1)$$,
	'23514', null, '14 — une nature blanche est refusée');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(pg_temp.lignes_touchees(
	$$update public.card_revenues set settled_at = '2000-01-01' where id = 'c0870000-0000-4000-8000-0000000000a2'$$),
	1::bigint, '15 — le commercial solde une ligne sans réel');
select pg_temp.redevenir_proprietaire();
select is(
	(select settled_by::text || ':' || (settled_at > now() - interval '1 minute')::text from public.card_revenues
	  where id = 'c0870000-0000-4000-8000-0000000000a2'),
	'5eed0000-0000-4000-8000-000000000012:true', '16 — horodatage de la base, auteur du jeton');
select is(pg_temp.reel('c0870000-0000-4000-8000-0000000000a2'), 0::numeric, '17 — soldée sans réel : « finalement rien encaissé », zéro');
select throws_ok(
	$$insert into public.card_revenue_actuals (card_revenue_id, amount) values ('c0870000-0000-4000-8000-0000000000a2', 1)$$,
	'P0001', 'ligne soldee', '18 — une ligne soldée ne reçoit plus de réel');
select lives_ok(
	$$update public.card_revenues set settled_at = null where id = 'c0870000-0000-4000-8000-0000000000a2'$$,
	'19 — décocher rouvre la ligne');
select is(pg_temp.reel('c0870000-0000-4000-8000-0000000000a2'), null::numeric, '20 — rouverte sans réel, elle redevient inconnue');
update public.card_revenues set settled_at = now() where id = 'c0870000-0000-4000-8000-0000000000a2';

-- =============================================================================================
-- 3. La devise verrouillée, l'affaire immuable
-- =============================================================================================
select throws_ok(
	$$update public.cards set currency = 'USD' where id = '5eed0000-0000-4000-8000-0000000000c4'$$,
	'23514', 'devise verrouillee par les recettes', '21 — une affaire qui porte des recettes ne change pas de devise');
select lives_ok(
	$$update public.cards set amount = amount + 1 where id = '5eed0000-0000-4000-8000-0000000000c4'$$,
	'22 — son montant, lui, reste libre');
select lives_ok(
	$$update public.cards set currency = 'USD' where id = '5eed0000-0000-4000-8000-0000000000cb'$$,
	'23 — une affaire sans recette change de devise');
update public.cards set currency = 'EUR' where id = '5eed0000-0000-4000-8000-0000000000cb';
select throws_ok(
	$$update public.card_revenues set card_id = '5eed0000-0000-4000-8000-0000000000cb' where id = 'c0870000-0000-4000-8000-0000000000a1'$$,
	'23514', null, '24 — une ligne ne change pas d’affaire');

-- =============================================================================================
-- 4. Les droits, avec les profils réels
-- =============================================================================================
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is(
	(select count(*)::int from public.card_revenue_actuals where card_revenue_id = 'c0870000-0000-4000-8000-0000000000a1'),
	3, '25 — la lectrice lit les réels d’une affaire qu’elle lit');
select throws_ok(
	$$insert into public.card_revenues (card_id, label, estimated_amount) values ('5eed0000-0000-4000-8000-0000000000c4', 'Lectrice', 1)$$,
	'42501', null, '26 — mais n’ajoute pas de ligne : elle n’écrit pas l’affaire');
select throws_ok(
	$$insert into public.card_revenue_actuals (card_revenue_id, amount) values ('c0870000-0000-4000-8000-0000000000a1', 1)$$,
	'42501', null, '27 — ni de réel');
select is(
	(select public.recette_saisissable(r) from public.card_revenues r where r.id = 'c0870000-0000-4000-8000-0000000000a1'),
	false, '28 — et la base lui dit la ligne non saisissable');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is(
	(select public.recette_saisissable(r) from public.card_revenues r where r.id = 'c0870000-0000-4000-8000-0000000000a1'),
	true, '29 — au commercial qui écrit l’affaire, elle la dit saisissable');
select lives_ok(
	$$insert into public.card_revenue_actuals (card_revenue_id, amount, received_on) values ('c0870000-0000-4000-8000-0000000000a1', 0, '2026-04-01')$$,
	'30 — et il y saisit un réel');
select throws_ok(
	$$select * from public.rentabilite_affaires()$$,
	'42501', 'rentabilite_reservee', '31 — la rentabilité lui est refusée : il n’administre pas l’espace');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok(
	$$select * from public.rentabilite_affaires(p_card => '5eed0000-0000-4000-8000-0000000000c4')$$,
	'42501', 'rentabilite_reservee', '32 — à la lectrice aussi, même sur une affaire qu’elle lit');
select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. `rentabilite_affaires`, sous le jeton de l'administratrice
-- =============================================================================================
update public.cards set deleted_at = now() where id = '5eed0000-0000-4000-8000-0000000000cc';
-- …0cd est l'affaire gagnée ACTIVE du seed : la suite l'archive elle-même, dans sa transaction.
update public.cards set archived_at = now() where id = '5eed0000-0000-4000-8000-0000000000cd';

create temporary table rentab_tout (
	workspace_id uuid, track_id uuid, channel_id uuid, card_id uuid, node_kind text, archivee boolean, currency text,
	recettes_prevues numeric, recettes_reelles numeric, lignes_recette integer, lignes_recette_sans_reel integer,
	couts_prevus numeric, couts_reels numeric, lignes_cout integer, lignes_cout_sans_reel integer,
	personnel numeric, minutes bigint, minutes_non_valorisees bigint) on commit drop;
create temporary table rentab_mars (like rentab_tout) on commit drop;
create temporary table attendu_c4 (couts_prevus numeric, couts_sans_reel integer, personnel numeric) on commit drop;
grant all on rentab_tout, rentab_mars, attendu_c4 to authenticated;

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
insert into rentab_tout select * from public.rentabilite_affaires();
insert into rentab_mars select * from public.rentabilite_affaires('2026-03-01', '2026-03-31');
insert into attendu_c4
	select
		(select sum(estimated_cost) from public.card_costs k join public.budgets b on b.id = k.budget_id
		  where k.card_id = '5eed0000-0000-4000-8000-0000000000c4' and b.currency = 'EUR'),
		(select count(*)::int from public.card_costs k join public.budgets b on b.id = k.budget_id
		  where k.card_id = '5eed0000-0000-4000-8000-0000000000c4' and b.currency = 'EUR'
		    and k.settled_at is null and k.actual_cost is null),
		(select sum(montant) from public.temps_valorise('-infinity', 'infinity', null, null, '5eed0000-0000-4000-8000-0000000000c4')
		  where devise = 'EUR');
select pg_temp.redevenir_proprietaire();

select ok(
	(select count(*) from rentab_tout) > 0, '33 — l’administratrice reçoit la rentabilité');
select is(
	(select recettes_prevues || '/' || recettes_reelles || '/' || lignes_recette || '/' || lignes_recette_sans_reel
	   from rentab_tout where card_id = '5eed0000-0000-4000-8000-0000000000c4' and currency = 'EUR'),
	'21500.00/4000.00/2/0',
	'34 — …0c4, recettes : prévu 20 000 + 1 500, réel 4 000 (le 0 du commercial compris), la ligne soldée à zéro n’est pas « sans réel »');
select is(
	(select couts_prevus from rentab_tout where card_id = '5eed0000-0000-4000-8000-0000000000c4' and currency = 'EUR'),
	(select round(couts_prevus, 2) from attendu_c4), '35 — coûts prévus : la somme des lignes de coût EUR de l’affaire');
select is(
	(select lignes_cout_sans_reel from rentab_tout where card_id = '5eed0000-0000-4000-8000-0000000000c4' and currency = 'EUR'),
	(select couts_sans_reel from attendu_c4), '36 — et ses lignes de coût ouvertes sans réel');
select is(
	(select personnel from rentab_tout where card_id = '5eed0000-0000-4000-8000-0000000000c4' and currency = 'EUR'),
	(select round(personnel, 2) from attendu_c4), '37 — personnel : le temps valorisé de l’affaire');
select is(
	(select recettes_reelles from rentab_mars where card_id = '5eed0000-0000-4000-8000-0000000000c4' and currency = 'EUR'),
	1000.00::numeric, '38 — sur mars : la facture de mars et l’avoir, sans janvier ni avril');
select is(
	(select recettes_prevues from rentab_mars where card_id = '5eed0000-0000-4000-8000-0000000000c4' and currency = 'EUR'),
	21500.00::numeric, '39 — les prévus portent sur toute l’affaire, période ou non');
select is(
	(select recettes_prevues || '/' || recettes_reelles from rentab_tout
	  where card_id = '5eed0000-0000-4000-8000-0000000000c7' and currency = 'CHF'),
	'28000.00/14000.00', '40 — …0c7 rend ses recettes sur sa ligne CHF, sans les mêler à une autre devise');
select is(
	(select archivee from rentab_tout where card_id = '5eed0000-0000-4000-8000-0000000000cd' limit 1),
	true, '41 — une affaire archivée paraît, et se dit archivée');
select is(
	(select count(*)::int from rentab_tout where card_id = '5eed0000-0000-4000-8000-0000000000cc'),
	0, '42 — une affaire à la corbeille ne paraît pas');
select ok(
	(select minutes_non_valorisees from rentab_tout
	  where card_id = '5eed0000-0000-4000-8000-0000000000cb' and currency = 'EUR' and personnel is null) > 0,
	'43 — …0cb paraît par le temps non valorisé de Farida, sous la devise de l’affaire, sans montant');

-- =============================================================================================
-- 6. La famille `recettes` du connecteur
-- =============================================================================================
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok(
	$$select public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'recettes', 'consulter')$$,
	'44 — `mcp_autorise` connaît la famille `recettes`');
select throws_ok(
	$$select public.mcp_autorise('5eed0000-0000-4000-8000-000000000001', 'factures', 'consulter')$$,
	'22023', 'famille_inconnue', '45 — une famille inconnue lève toujours 22023');
select pg_temp.redevenir_proprietaire();
select lives_ok(
	$$insert into public.mcp_droits (sub, workspace_id, famille, action)
	  values ('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001', 'recettes', 'modifier')$$,
	'46 — la contrainte de la matrice accepte `recettes`');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000018');
select lives_ok(
	$$select public.mcp_poser_droits('5eed0000-0000-4000-8000-000000000012', '5eed0000-0000-4000-8000-000000000001',
	  '[["temps", "consulter"], ["recettes", "consulter"], ["budgets", "consulter"]]')$$,
	'47 — la superadministratrice pose une matrice qui ouvre `recettes`');
select is(
	(select e.value -> 'droits' from pg_catalog.jsonb_array_elements(public.mcp_compte('5eed0000-0000-4000-8000-000000000012') -> 'espaces') e
	  where e.value ->> 'slug' = 'p2enjoy'),
	'[["budgets", "consulter"], ["recettes", "consulter"], ["temps", "consulter"]]'::jsonb,
	'48 — la matrice se lit avec `recettes` entre `budgets` et `temps`');
select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;
