-- @verifies CRM-146 (docs/BACKLOG.md) — tranche T1 : `organization_revenue_totals` — une affaire compte pour une
--           organisation par ses contacts rattachés, une fois, pour chacune de leurs organisations ; deux devises jamais
--           additionnées ; le réel inconnu nul, la ligne soldée sans réel à zéro ; corbeille exclue, archivée comptée ;
--           une affaire illisible ne compte ni dans les sommes ni dans les comptes ; l'anonyme n'exécute pas
-- @verifies docs/SPEC-recettes.md §12.1, §12.2, §12.3, §12.10 ; docs/SCHEMA.md « Migration `0177` » ;
--           docs/JOURNAL.md décisions 900, 903 et 908 ; CLAUDE.md §10
--
-- LA SONDE, posée sous la clé de propriétaire et défaite par le `rollback` final, sur des affaires du seed qui ne portent
-- ni recette ni contact (leurs sommes ne dépendent donc que d'elle) :
-- - quatre organisations : Alpha, Beta, Gamma (une ligne sans réel), Delta (une affaire sans recette) ;
-- - A `…00c1` (EUR) : deux contacts d'Alpha et un de Beta ; lignes 1 000 → 400 et 500 sans réel ;
-- - B `…d011` (CHF) : un contact d'Alpha ; ligne 2 000 → 2 500 (au-delà du prévu) ;
-- - C `…00c3` (EUR), À LA CORBEILLE : un contact d'Alpha ; ligne 9 999 ;
-- - D `…00cf` (EUR), dans « Dossiers 2023 », FERMÉ À DRISS : un contact d'Alpha et un de Beta ; ligne 300 → 300 ;
-- - E `…00c8` (EUR), ARCHIVÉE : un contact de Beta ; ligne 700 soldée sans réel ;
-- - G `…00ca` (EUR) : un contact de Gamma ; ligne 100 sans réel ;
-- - H `…00cb` : un contact de Delta ; aucune ligne.

begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

\set espace '5eed0000-0000-4000-8000-000000000001'
\set admin '5eed0000-0000-4000-8000-000000000011'
\set driss '5eed0000-0000-4000-8000-000000000012'
\set alpha '01660000-0000-4000-8000-0000000000a1'
\set beta '01660000-0000-4000-8000-0000000000b1'
\set gamma '01660000-0000-4000-8000-0000000000c1'
\set delta '01660000-0000-4000-8000-0000000000d1'

insert into public.organizations (id, workspace_id, name) values
	(:'alpha', :'espace', 'Sonde 146 Alpha'),
	(:'beta', :'espace', 'Sonde 146 Beta'),
	(:'gamma', :'espace', 'Sonde 146 Gamma'),
	(:'delta', :'espace', 'Sonde 146 Delta');

insert into public.contacts (id, workspace_id, full_name, organization_id) values
	('01660000-0000-4000-8000-0000000001a1', :'espace', 'Sonde Alpha Un', :'alpha'),
	('01660000-0000-4000-8000-0000000001a2', :'espace', 'Sonde Alpha Deux', :'alpha'),
	('01660000-0000-4000-8000-0000000001b1', :'espace', 'Sonde Beta', :'beta'),
	('01660000-0000-4000-8000-0000000001c1', :'espace', 'Sonde Gamma', :'gamma'),
	('01660000-0000-4000-8000-0000000001d1', :'espace', 'Sonde Delta', :'delta'),
	('01660000-0000-4000-8000-0000000001e1', :'espace', 'Sonde sans organisation', null);

insert into public.card_contacts (workspace_id, card_id, contact_id) values
	(:'espace', '5eed0000-0000-4000-8000-0000000000c1', '01660000-0000-4000-8000-0000000001a1'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000c1', '01660000-0000-4000-8000-0000000001a2'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000c1', '01660000-0000-4000-8000-0000000001b1'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000c1', '01660000-0000-4000-8000-0000000001e1'),
	(:'espace', '5eed0000-0000-4000-8000-00000000d011', '01660000-0000-4000-8000-0000000001a1'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000c3', '01660000-0000-4000-8000-0000000001a1'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000cf', '01660000-0000-4000-8000-0000000001a1'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000cf', '01660000-0000-4000-8000-0000000001b1'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000c8', '01660000-0000-4000-8000-0000000001b1'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000ca', '01660000-0000-4000-8000-0000000001c1'),
	(:'espace', '5eed0000-0000-4000-8000-0000000000cb', '01660000-0000-4000-8000-0000000001d1');

insert into public.card_revenues (id, card_id, label, estimated_amount) values
	('01660000-0000-4000-8000-0000000002a1', '5eed0000-0000-4000-8000-0000000000c1', 'Lot 1', 1000),
	('01660000-0000-4000-8000-0000000002a2', '5eed0000-0000-4000-8000-0000000000c1', 'Lot 2', 500),
	('01660000-0000-4000-8000-0000000002b1', '5eed0000-0000-4000-8000-00000000d011', 'Convention', 2000),
	('01660000-0000-4000-8000-0000000002c1', '5eed0000-0000-4000-8000-0000000000c3', 'À la corbeille', 9999),
	('01660000-0000-4000-8000-0000000002d1', '5eed0000-0000-4000-8000-0000000000cf', 'Fermée à Driss', 300),
	('01660000-0000-4000-8000-0000000002e1', '5eed0000-0000-4000-8000-0000000000c8', 'Archivée', 700),
	('01660000-0000-4000-8000-0000000002f1', '5eed0000-0000-4000-8000-0000000000ca', 'Sans réel', 100);

insert into public.card_revenue_actuals (card_revenue_id, amount) values
	('01660000-0000-4000-8000-0000000002a1', 400),
	('01660000-0000-4000-8000-0000000002b1', 2500),
	('01660000-0000-4000-8000-0000000002d1', 300);
update public.card_revenues set settled_at = now() where id = '01660000-0000-4000-8000-0000000002e1';

update public.cards set deleted_at = now() where id = '5eed0000-0000-4000-8000-0000000000c3';
update public.card_placements set archived_at = now() where card_id = '5eed0000-0000-4000-8000-0000000000c8';
-- « Dossiers 2023 » fermé à Driss, la seule place de D (docs/SPEC-permissions-rls.md, `channel_members.access`).
insert into public.channel_members (channel_id, user_id, access)
values ('5eed0000-0000-4000-8000-000000000037', :'driss', 'none');

-- 1–2. La forme.
select is((select provolatile::text || prosecdef::text from pg_proc
            where oid = 'public.organization_revenue_totals(uuid)'::regprocedure),
	'sfalse', '1 — `organization_revenue_totals` est `stable` et `security invoker`');
select ok(not has_function_privilege('anon', 'public.organization_revenue_totals(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.organization_revenue_totals(uuid)', 'execute'),
	'2 — l''anonyme n''exécute pas ; `authenticated` exécute');

select pg_temp.endosser(:'admin');
create temp table tout_admin as
select * from public.organization_revenue_totals() where organization_id in (:'alpha', :'beta', :'gamma', :'delta');

-- 3–9. L'administratrice, qui lit tout, y compris l'affaire à la corbeille.
select ok((select count(*) = 1 from public.cards where id = '5eed0000-0000-4000-8000-0000000000c3'),
	'3 — témoin : l''administratrice LIT l''affaire à la corbeille, que la fonction doit donc exclure elle-même');
select results_eq(
	$$select currency, estimated_total, actual_total, cards, shared_cards, revenue_lines, lines_without_actual
	    from tout_admin where organization_id = '01660000-0000-4000-8000-0000000000a1' order by currency$$,
	$$values ('CHF'::text, 2000.00::numeric, 2500.00::numeric, 1, 0, 1, 0),
	         ('EUR'::text, 1800.00::numeric, 700.00::numeric, 2, 2, 3, 1)$$,
	'4 — Alpha : deux devises jamais additionnées ; A comptée UNE fois malgré deux contacts ; C à la corbeille exclue ; '
	'le réel au-delà du prévu rendu tel quel');
select results_eq(
	$$select currency, estimated_total, actual_total, cards, shared_cards, revenue_lines, lines_without_actual
	    from tout_admin where organization_id = '01660000-0000-4000-8000-0000000000b1'$$,
	$$values ('EUR'::text, 2500.00::numeric, 700.00::numeric, 3, 2, 4, 1)$$,
	'5 — Beta : A et D comptent pour Alpha ET Beta (partagées) ; E archivée comptée, soldée sans réel pour 0');
select results_eq(
	$$select estimated_total, actual_total, lines_without_actual from tout_admin
	   where organization_id = '01660000-0000-4000-8000-0000000000c1'$$,
	$$values (100.00::numeric, null::numeric, 1)$$,
	'6 — Gamma : aucun réel connu, le réel est NUL et non zéro');
select is((select count(*)::int from tout_admin where organization_id = :'delta'), 0,
	'7 — Delta : une affaire sans ligne de recette ne rend aucune ligne, ni zéro');
select set_eq(
	$$select currency, estimated_total from public.organization_revenue_totals('01660000-0000-4000-8000-0000000000a1')$$,
	$$select currency, estimated_total from tout_admin where organization_id = '01660000-0000-4000-8000-0000000000a1'$$,
	'8 — `p_organization_id` restreint à une organisation, mêmes sommes');
select is((select count(*)::int from public.organization_revenue_totals('01660000-0000-4000-8000-0000000000ff')), 0,
	'9 — une organisation inconnue : zéro ligne, aucune erreur');

-- 10–15. Driss, à qui D est illisible.
reset role;
select pg_temp.endosser(:'driss');

select ok((select count(*) = 0 from public.cards where id = '5eed0000-0000-4000-8000-0000000000cf'),
	'10 — témoin : Driss ne lit pas D');
select results_eq(
	$$select currency, estimated_total, actual_total, cards, shared_cards, revenue_lines, lines_without_actual
	    from public.organization_revenue_totals('01660000-0000-4000-8000-0000000000a1') where currency = 'EUR'$$,
	$$values ('EUR'::text, 1500.00::numeric, 400.00::numeric, 1, 1, 2, 1)$$,
	'11 — Alpha sous Driss : D ne compte ni dans les sommes, ni dans `cards`, ni dans `shared_cards`, ni dans les lignes');
select results_eq(
	$$select estimated_total, actual_total, cards, shared_cards, revenue_lines
	    from public.organization_revenue_totals('01660000-0000-4000-8000-0000000000b1')$$,
	$$values (2200.00::numeric, 400.00::numeric, 2, 1, 3)$$,
	'12 — Beta sous Driss : D absente, E archivée présente');
-- RÉVISÉ par `CRM-146` T3 : la mesure portait sur TOUTES les organisations, et supposait que le seed n'en dotait aucune de
-- recettes ; le §41 de docs/SPEC-seed.md en dote Vertigo Conseil (210 000 EUR). Elle porte sur les quatre de la sonde, et
-- reste décisive : si C comptait, Alpha dépasserait 9 999.
select ok((select bool_and(estimated_total < 9999) from public.organization_revenue_totals()
            where organization_id in ('01660000-0000-4000-8000-0000000000a1', '01660000-0000-4000-8000-0000000000b1',
                                      '01660000-0000-4000-8000-0000000000c1', '01660000-0000-4000-8000-0000000000d1')),
	'13 — sous Driss non plus, l''affaire à la corbeille ne compte nulle part');

-- 14. Ce que la fonction rend est un sous-ensemble de ce que Driss lit : l'oracle par les tables, sous son jeton.
select set_eq(
	$$select currency, estimated_total from public.organization_revenue_totals('01660000-0000-4000-8000-0000000000a1')$$,
	$$select c.currency, sum(r.estimated_amount)
	    from public.cards c join public.card_revenues r on r.card_id = c.id
	   where c.deleted_at is null and c.id in (
	         select cc.card_id from public.card_contacts cc join public.contacts ct on ct.id = cc.contact_id
	          where ct.organization_id = '01660000-0000-4000-8000-0000000000a1')
	   group by c.currency$$,
	'14 — Alpha sous Driss : égal à l''oracle calculé sur les tables qu''il lit');

-- 15. Le rattachement d'une autre organisation n'est compté que s'il est lu : D fermée, ses liens ne font partager rien.
select is((select shared_cards from public.organization_revenue_totals('01660000-0000-4000-8000-0000000000b1')), 1,
	'15 — sous Driss, seule A est partagée pour Beta : les liens de D, qu''il ne lit pas, ne transparaissent pas');

reset role;

-- 16–17. La lectrice : aucune réserve aux administrateurs, mais ses sommes sont celles de SES affaires. MESURÉ à l'écriture
-- du test : elle ne lit, parmi les affaires de la sonde, que D — l'égalité avec l'administratrice était fausse.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select set_eq(
	$$select organization_id, currency, estimated_total from public.organization_revenue_totals()
	   where organization_id in ('01660000-0000-4000-8000-0000000000a1', '01660000-0000-4000-8000-0000000000b1',
	                             '01660000-0000-4000-8000-0000000000c1', '01660000-0000-4000-8000-0000000000d1')$$,
	$$select ct.organization_id, c.currency, sum(r.estimated_amount)
	    from (select distinct ct.organization_id, cc.card_id
	            from public.card_contacts cc join public.contacts ct on ct.id = cc.contact_id
	           where ct.organization_id in ('01660000-0000-4000-8000-0000000000a1', '01660000-0000-4000-8000-0000000000b1',
	                                        '01660000-0000-4000-8000-0000000000c1', '01660000-0000-4000-8000-0000000000d1')) ct
	    join public.cards c on c.id = ct.card_id and c.deleted_at is null
	    join public.card_revenues r on r.card_id = c.id
	   group by ct.organization_id, c.currency$$,
	'16 — la lectrice : ses sommes, égales à l''oracle sur les tables qu''elle lit, sans refus réservé aux administrateurs');
select ok((select count(*) > 0 from public.organization_revenue_totals()
            where organization_id in ('01660000-0000-4000-8000-0000000000a1', '01660000-0000-4000-8000-0000000000b1')),
	'17 — témoin : la lectrice reçoit des lignes (D), l''égalité du 16 n''est pas celle de deux vides');
reset role;
select is((select pg_get_function_identity_arguments('public.organization_revenue_totals'::regproc)),
	'p_organization_id uuid', '18 — la signature : un seul paramètre, facultatif');

select * from finish();
rollback;
