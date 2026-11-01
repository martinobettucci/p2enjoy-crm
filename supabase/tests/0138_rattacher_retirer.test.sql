-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T3 : rattacher et retirer
-- @verifies docs/SPEC-rattachements.md §3.1 (plusieurs rattachements, un par channel), §4 (« Rattacher », « Retirer », un
--           rattachement illisible masqué, la partie commune écrite par un channel), §5 (`attach_card`, `detach_card`,
--           `attached`, `detached`) ; docs/SPEC-corbeille.md §9.1 et docs/JOURNAL.md décision 802 (une affaire rattachée
--           hors d'un ensemble de channels survit à leur purge) ; docs/SCHEMA.md « Migration `0148` »
--
-- CE QUE CETTE SUITE PROUVE, sur le seed migré, sous les rôles réels :
--   1. la FORME : l'index d'un rattachement par affaire est retiré, les deux fonctions sont `security definer` à
--      `search_path` vidé, exécutables par `authenticated` et pas par `anon` ;
--   2. RATTACHER : l'étape initiale, l'événement `attached`, les refus dans leur ordre, le désarchivage tel quel ;
--   3. LIRE ET ÉCRIRE à deux rattachements : la lectrice ne voit pas le rattachement d'un channel qui lui est fermé, le
--      business developer écrit la partie commune par le channel qu'il écrit, et pas le bloc de l'autre ;
--   4. LA PURGE (décision 802) : une affaire rattachée hors des channels purgés n'est pas détruite ;
--   5. RETIRER : réservé à l'administratrice, la perte des valeurs exigée, l'événement `detached`, jamais le dernier.
--
-- Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(31);

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

-- Les profils du seed : l'administratrice, le business developer (lecture seule sur `maintenance`), la lectrice (fermée
-- au track « Conseil & IA », qui porte `grands-comptes`).
\set admin    '5eed0000-0000-4000-8000-000000000011'
\set bizdev   '5eed0000-0000-4000-8000-000000000012'
\set lectrice '5eed0000-0000-4000-8000-000000000013'
-- …0c4 dans `refonte` (…034) ; …0c7 dans `inter-entreprises` (…036), avec trois valeurs de bloc ; …0c3 dans
-- `grands-comptes` (…032), fermé à la lectrice.
\set c4 '5eed0000-0000-4000-8000-0000000000c4'
\set c7 '5eed0000-0000-4000-8000-0000000000c7'
\set c3 '5eed0000-0000-4000-8000-0000000000c3'
\set grands_comptes '5eed0000-0000-4000-8000-000000000032'
\set appels_offres  '5eed0000-0000-4000-8000-000000000033'
\set refonte        '5eed0000-0000-4000-8000-000000000034'
\set maintenance    '5eed0000-0000-4000-8000-000000000035'
\set inter          '5eed0000-0000-4000-8000-000000000036'
\set annexes        '5eed0000-0000-4000-8000-000000000038'

-- Le nombre de lignes qu'une écriture atteint sous le rôle courant : un refus de POLITIQUE en écrit zéro, sans erreur.
create or replace function pg_temp.lignes_ecrites(instruction text)
returns integer language plpgsql as $$
declare
	n integer;
begin
	execute instruction;
	get diagnostics n = row_count;
	return n;
end;
$$;

create temp table t_debut as select clock_timestamp() as t;
grant select on t_debut to authenticated;

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select ok(to_regclass('public.card_placements_one_per_card_idx') is null,
	'l''index d''un rattachement par affaire, qui tenait la transition, est retiré : plusieurs rattachements sont licites');
select col_is_unique('public', 'card_placements', array['card_id', 'channel_id'],
	'un seul rattachement par channel et par affaire, toujours');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""'])
             from pg_proc p where p.oid in ('public.attach_card(uuid, uuid)'::regprocedure,
                                            'public.detach_card(uuid, boolean)'::regprocedure)),
	'les deux gestes sont `security definer`, à `search_path` vidé');
select ok(has_function_privilege('authenticated', 'public.attach_card(uuid, uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.detach_card(uuid, boolean)', 'execute'),
	'`authenticated` exécute les deux gestes');
select ok(not has_function_privilege('anon', 'public.attach_card(uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.detach_card(uuid, boolean)', 'execute'),
	'`anon` n''exécute ni l''un ni l''autre');

-- =============================================================================================
-- 2. Rattacher
-- =============================================================================================

select pg_temp.endosser(:'lectrice');
select throws_ok(format('select public.attach_card(%L, %L)', :'c3', :'refonte'), 'P0001', 'card_not_found',
	'la lectrice ne rattache pas une affaire qu''elle ne lit pas : introuvable, jamais interdite');

select pg_temp.endosser(:'bizdev');
select throws_ok(format('select public.attach_card(%L, %L)', :'c4', :'maintenance'), '42501', 'forbidden',
	'le business developer, qui écrit l''affaire, ne la rattache pas à `maintenance`, qu''il lit sans l''écrire');

select pg_temp.endosser(:'admin');
select throws_ok(format('select public.attach_card(%L, %L)', :'c4', '5eed0000-0000-4000-8000-0000000000ff'),
	'P0001', 'channel_not_found', 'un channel inexistant : introuvable');
select throws_ok(format('select public.attach_card(%L, %L)', :'c4', :'appels_offres'), 'P0001', 'channel_closed',
	'un channel ARCHIVÉ ne reçoit plus d''affaire, comme à la création');
select throws_ok(format('select public.attach_card(%L, %L)', :'c4', :'annexes'), 'P0001', 'channel_closed',
	'un channel à la CORBEILLE non plus');
select throws_ok(format('select public.attach_card(%L, %L)', :'c4', :'refonte'), 'P0001', 'already_attached',
	'l''affaire déjà rattachée, active, au channel : refusé');

select id as attache, current_step_id as etape_attache from public.attach_card(:'c4', :'grands_comptes') \gset
select is((select count(*)::int from public.card_placements where card_id = :'c4'), 2,
	'l''administratrice rattache …0c4 à `grands-comptes` : l''affaire a DEUX rattachements');
select is(:'etape_attache'::uuid,
          (select s.id from public.workflow_steps s join public.channels ch on ch.workflow_id = s.workflow_id
            where ch.id = :'grands_comptes' and s.is_initial),
	'le rattachement naît à l''ÉTAPE INITIALE du workflow du channel (décision 643)');
select is((select count(*)::int from public.card_field_values where placement_id = :'attache'), 0,
	'… et son bloc est vide');
select is((select count(*)::int from public.card_events
            where card_id = :'c4' and type = 'attached' and placement_id = :'attache'
              and created_at >= (select t from t_debut)), 1,
	'le fil de l''affaire porte `attached`, qui désigne le nouveau rattachement');

-- =============================================================================================
-- 3. Lire et écrire à deux rattachements
-- =============================================================================================

select pg_temp.endosser(:'lectrice');
select is((select count(*)::int from public.cards where id = :'c4'), 1,
	'la lectrice lit …0c4 par `refonte`, qu''elle lit');
select is((select array_agg(channel_id::text) from public.card_placements where card_id = :'c4'),
          array[:'refonte'::text],
	'… et ne voit QUE son rattachement à `refonte` : celui de `grands-comptes`, fermé, est masqué, existence comprise');

select pg_temp.endosser(:'admin');
select lives_ok(format('select public.attach_card(%L, %L)', :'c4', :'maintenance'),
	'l''administratrice rattache aussi …0c4 à `maintenance`');
select pg_temp.endosser(:'bizdev');
select is(pg_temp.lignes_ecrites(format('update public.cards set description = %L where id = %L', 'Sonde T3', :'c4')), 1,
	'le business developer écrit la PARTIE COMMUNE de …0c4 par `refonte`, qu''il écrit (§4)');
select is(pg_temp.lignes_ecrites(format('update public.card_placements set amount = 1 where card_id = %L and channel_id = %L',
                                        :'c4', :'maintenance')), 0,
	'… mais pas le BLOC du rattachement à `maintenance`, qu''il ne fait que lire : zéro ligne, sans erreur');

-- =============================================================================================
-- 4. La purge — décision 802
-- =============================================================================================

select pg_temp.endosser(:'admin');
select lives_ok(format('select public.attach_card(%L, %L)', :'c7', :'refonte'),
	'l''administratrice rattache …0c7, de `inter-entreprises`, à `refonte`');
select pg_temp.proprietaire();
select ok(not (:'c7'::uuid = any (app.cartes_detruites_avec_channels(array[:'inter'::uuid])))
          and ('5eed0000-0000-4000-8000-0000000000c6'::uuid = any (app.cartes_detruites_avec_channels(array[:'inter'::uuid]))),
	'DÉCISION 802 : purger `inter-entreprises` détruirait …0c6, qui n''est que là, mais pas …0c7, rattachée aussi ailleurs');

-- =============================================================================================
-- 5. Retirer
-- =============================================================================================

select pg_temp.endosser(:'bizdev');
select throws_ok(format('select public.detach_card(%L)', (select id from public.card_placements
                                                           where card_id = :'c7' and channel_id = :'inter')),
	'42501', 'forbidden', 'le business developer ne retire pas un rattachement : réservé à l''administrateur');

select pg_temp.endosser(:'admin');
select throws_ok(format('select public.detach_card(%L)', (select id from public.card_placements
                                                           where card_id = :'c7' and channel_id = :'inter')),
	'P0001', 'field_values_would_be_lost', 'ses trois valeurs de bloc ne se perdent pas sans `discard_field_values`');

select id as retire from public.card_placements where card_id = :'c7' and channel_id = :'inter' \gset
select lives_ok(format('select public.detach_card(%L, true)', :'retire'),
	'avec `discard_field_values`, l''administratrice retire le rattachement de …0c7 à `inter-entreprises`');
select pg_temp.proprietaire();
select is((select count(*)::int from public.card_field_values where placement_id = :'retire'), 0,
	'ses valeurs sont parties avec lui');
select is((select count(*)::int from public.card_events
            where card_id = :'c7' and type = 'detached' and placement_id = :'retire'
              and created_at >= (select t from t_debut)), 1,
	'le fil porte `detached`, qui désigne le rattachement retiré');

select pg_temp.endosser(:'admin');
select throws_ok(format('select public.detach_card(%L)', (select id from public.card_placements where card_id = :'c7')),
	'P0001', 'last_placement', 'le DERNIER rattachement d''une affaire ne se retire pas (décision 643)');

-- Le désarchivage tel quel : le rattachement de …0c4 à `grands-comptes` est archivé, puis rattaché de nouveau.
update public.card_placements set archived_at = now() where id = :'attache';
select is((select id from public.attach_card(:'c4', :'grands_comptes')), :'attache'::uuid,
	'rattacher à un channel dont le rattachement est ARCHIVÉ le désarchive tel quel : le même rattachement');
select pg_temp.proprietaire();
select ok((select archived_at from public.card_placements where id = :'attache') is null,
	'… et il n''est plus archivé');

-- L'anonyme est refusé par le privilège.
set local role anon;
select throws_ok(format('select public.attach_card(%L, %L)', :'c4', :'refonte'), '42501', null,
	'l''anonyme n''exécute pas `attach_card`');

select * from finish();
rollback;
