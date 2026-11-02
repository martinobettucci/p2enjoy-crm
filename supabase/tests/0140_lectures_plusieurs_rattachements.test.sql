-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T4.1 : les lectures à plusieurs rattachements
-- @verifies docs/SPEC-rattachements.md §5 (le `stalled` désigne SON rattachement), §6 (le temps valorisé sous chaque
--           channel rattaché lisible, `shared`, la saisie comptée une fois), §9 (la recherche nomme les rattachements
--           lisibles, dans l'ordre des tracks puis des channels) ; docs/SPEC-temps.md §6.2 ; docs/SPEC-relances.md §9.4 ;
--           docs/JOURNAL.md décision 814 ; docs/SCHEMA.md « Migration `0150` »
--
-- CE QUE CETTE SUITE PROUVE, sur le seed migré, sous les rôles réels, l'affaire …0c4 rattachée à `refonte` (track
-- « Studio web », position 2) puis à `grands-comptes` (track « Conseil & IA », position 1, fermé à la lectrice) :
--   1. la FORME : `temps_valorise` rend `shared`, les deux lectures restent `security invoker`, leurs droits tiennent ;
--   2. la RECHERCHE nomme les deux channels dans l'ordre des tracks, cherche dans les deux prochaines actions, et ne
--      montre à la lectrice ni le channel fermé ni sa prochaine action ;
--   3. le TEMPS VALORISÉ rend la saisie sous chaque channel lisible, marquée `shared`, avec le même temps et le même
--      montant ; filtré par track, il ne rend que celui-là ; la lectrice n'en voit qu'un, non partagé ;
--   4. la RENTABILITÉ compte la saisie partagée une fois ;
--   5. l'ENTONNOIR, les AFFAIRES FIGÉES et MA JOURNÉE lisent chaque rattachement ;
--   6. la RELANCE inscrit son `stalled` sur le rattachement figé, une fois par entrée dans l'étape.
--
-- Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

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
\set lectrice '5eed0000-0000-4000-8000-000000000013'
\set c4 '5eed0000-0000-4000-8000-0000000000c4'
\set conseil        '5eed0000-0000-4000-8000-000000000021'
\set grands_comptes '5eed0000-0000-4000-8000-000000000032'
\set refonte        '5eed0000-0000-4000-8000-000000000034'

create temp table t_debut as select clock_timestamp() as t;
grant select on t_debut to authenticated;

select workspace_id as espace, title as titre from public.cards where id = :'c4' \gset
select id as rattachement_refonte from public.card_placements where card_id = :'c4' and channel_id = :'refonte' \gset

-- Deux jours où ni l'administratrice ni la lectrice n'ont rien saisi : le plafond journalier ne s'en mêle pas.
select max(d)::date as jour_admin
  from generate_series(current_date - 1, current_date - 60, '-1 day') d
 where not exists (select 1 from public.saisies_temps s where s.profile_id = :'admin' and s.jour = d::date) \gset
select max(d)::date as jour_lectrice
  from generate_series(current_date - 1, current_date - 60, '-1 day') d
 where not exists (select 1 from public.saisies_temps s where s.profile_id = :'lectrice' and s.jour = d::date) \gset

-- =============================================================================================
-- 1. La forme
-- =============================================================================================

select ok(pg_get_function_result('public.temps_valorise(date, date, uuid, uuid, uuid)'::regprocedure)
            like '%devise text, shared boolean)',
	'`temps_valorise` rend `shared` après `devise`');
select ok(not (select bool_or(p.prosecdef) from pg_proc p
                where p.oid in ('public.temps_valorise(date, date, uuid, uuid, uuid)'::regprocedure,
                                'public.recherche_globale(text, integer)'::regprocedure)),
	'les deux lectures restent `security invoker` : la RLS de l''appelant décide de ce qu''elles rendent');
select ok(has_function_privilege('authenticated', 'public.temps_valorise(date, date, uuid, uuid, uuid)', 'execute')
          and has_function_privilege('service_role', 'public.temps_valorise(date, date, uuid, uuid, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.temps_valorise(date, date, uuid, uuid, uuid)', 'execute'),
	'`temps_valorise`, recréée, retrouve ses droits : `authenticated` et `service_role`, jamais `anon`');

-- =============================================================================================
-- 2. La recherche — §9
-- =============================================================================================

-- Les entonnoirs d'avant, sous l'administratrice : l'affaire comptera ensuite dans les deux channels.
select pg_temp.endosser(:'admin');
select coalesce(sum(affaires), 0) as entonnoir_gc_avant from public.entonnoir_conversion() where channel_id = :'grands_comptes' \gset
select coalesce(sum(affaires), 0) as entonnoir_refonte_avant from public.entonnoir_conversion() where channel_id = :'refonte' \gset

select id as attache from public.attach_card(:'c4', :'grands_comptes') \gset
update public.card_placements
   set next_action = 'Sonder le comité zéphyrin', next_action_at = now() + interval '1 hour'
 where id = :'attache';
update public.card_placements set next_action_at = now() + interval '2 hours' where id = :'rattachement_refonte';

select is((select r.sous_titre from public.recherche_globale(:'titre', 50) r where r.id = :'c4'),
          'Grands comptes, Refonte de site',
	'l''administratrice trouve …0c4 nommée par SES DEUX channels, « Conseil & IA » (position 1) avant « Studio web »');
select is((select count(*)::int from public.recherche_globale(:'titre', 50) r where r.id = :'c4'), 1,
	'… sur UNE ligne : la recherche rend une ligne par affaire');
select is((select count(*)::int from public.recherche_globale('zéphyrin', 50) r where r.id = :'c4'), 1,
	'elle la trouve aussi par la prochaine action du SECOND rattachement');

select pg_temp.endosser(:'lectrice');
select is((select r.sous_titre from public.recherche_globale(:'titre', 50) r where r.id = :'c4'), 'Refonte de site',
	'la lectrice ne lit que le channel qui lui est ouvert : `grands-comptes` n''est pas nommé');
select is((select count(*)::int from public.recherche_globale('zéphyrin', 50) r where r.id = :'c4'), 0,
	'… et la prochaine action du rattachement masqué ne la lui fait pas trouver');

-- =============================================================================================
-- 3. Le temps valorisé — §6
-- =============================================================================================

select pg_temp.proprietaire();
insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, card_id)
values (:'espace', :'admin', :'jour_admin', 60, :'c4'), (:'espace', :'lectrice', :'jour_lectrice', 30, :'c4');

select pg_temp.endosser(:'admin');
select is((select array_agg(t.channel_id::text order by t.channel_id)
             from public.temps_valorise(:'jour_admin', :'jour_admin', :'admin', null, :'c4') t),
          (select array_agg(x order by x) from unnest(array[:'grands_comptes'::text, :'refonte'::text]) x),
	'la saisie de l''administratrice sur …0c4 paraît sous CHACUN des deux channels rattachés');
select ok((select bool_and(t.shared) and count(*) = 2
             from public.temps_valorise(:'jour_admin', :'jour_admin', :'admin', null, :'c4') t),
	'… les deux lignes marquées `shared`');
select ok((select count(distinct (t.minutes, t.montant, t.devise)) = 1 and min(t.minutes) = 60
             from public.temps_valorise(:'jour_admin', :'jour_admin', :'admin', null, :'c4') t),
	'… avec le MÊME temps, le même montant et la même devise : c''est la même saisie');
select is((select array_agg(t.channel_id::text || ':' || t.shared::text)
             from public.temps_valorise(:'jour_admin', :'jour_admin', :'admin', :'conseil', :'c4') t),
          array[:'grands_comptes' || ':true'],
	'filtrée sur le track « Conseil & IA », elle ne rend que `grands-comptes`, toujours marquée partagée');

select pg_temp.endosser(:'lectrice');
select is((select array_agg(t.channel_id::text || ':' || t.shared::text)
             from public.temps_valorise(:'jour_lectrice', :'jour_lectrice', null, null, :'c4') t),
          array[:'refonte' || ':false'],
	'la lectrice voit sa saisie sous le seul channel qu''elle lit, NON partagée : le rattachement masqué ne se devine pas');

-- =============================================================================================
-- 4. La rentabilité — la saisie partagée comptée une fois
-- =============================================================================================

-- Ce que les saisies du jour portent sur …0c4, chacune une fois — la lectrice a pu saisir le même jour.
select pg_temp.proprietaire();
select sum(minutes)::int as minutes_du_jour from public.saisies_temps where card_id = :'c4' and jour = :'jour_admin' \gset
select pg_temp.endosser(:'admin');
-- `CRM-111` T5.1 : une ligne par rattachement, les sommes rappelées ; sous UN channel, la saisie compte une fois.
select is((select sum(r.minutes)::int from public.rentabilite_affaires(:'jour_admin', :'jour_admin', :'c4') r
            where r.channel_id = :'refonte'),
          :'minutes_du_jour'::int,
	'la rentabilité de …0c4 compte chaque saisie UNE fois, non une fois par rattachement');

-- =============================================================================================
-- 5. Entonnoir, affaires figées, Ma journée — chaque rattachement
-- =============================================================================================

select is((select coalesce(sum(affaires), 0) from public.entonnoir_conversion() where channel_id = :'grands_comptes'),
          :'entonnoir_gc_avant'::bigint + 1,
	'l''entonnoir compte …0c4 dans `grands-comptes`, où elle vient d''être rattachée');
select is((select coalesce(sum(affaires), 0) from public.entonnoir_conversion() where channel_id = :'refonte'),
          :'entonnoir_refonte_avant'::bigint,
	'… sans la retirer de `refonte`');

select is((select count(*)::int from public.card_placements
            where card_id = :'c4' and next_action_at is not null and archived_at is null), 2,
	'Ma journée : l''administratrice lit les DEUX prochaines actions de …0c4, une par rattachement');
select pg_temp.endosser(:'lectrice');
select is((select array_agg(channel_id::text) from public.card_placements
            where card_id = :'c4' and next_action_at is not null and archived_at is null),
          array[:'refonte'::text],
	'… la lectrice, la seule du channel qu''elle lit');

-- Le rattachement à `grands-comptes` est figé : entré dans son étape il y a un an, à une étape dont le seuil est posé.
select pg_temp.proprietaire();
select current_step_id as etape_attache from public.card_placements where id = :'attache' \gset
update public.workflow_steps set stale_after_days = 3 where id = :'etape_attache' and stale_after_days is null;
update public.card_placements set entered_step_at = now() - interval '365 days' where id = :'attache';

select pg_temp.endosser(:'admin');
select is((select count(*)::int from public.cards_figees() f where f.card_id = :'c4' and f.channel_id = :'grands_comptes'), 1,
	'les affaires figées rendent …0c4 au titre de `grands-comptes`, le rattachement figé');

-- =============================================================================================
-- 6. La relance — §5, SPEC-relances §9.4
-- =============================================================================================

select pg_temp.proprietaire();
select cmp_ok(app.relancer_cards_figees(), '>=', 1, 'la relance inscrit au moins un `stalled`');
select is((select count(*)::int from public.card_events
            where card_id = :'c4' and type = 'stalled' and placement_id = :'attache'
              and created_at >= (select t from t_debut)), 1,
	'le `stalled` de …0c4 désigne le rattachement FIGÉ, `grands-comptes` — non le plus ancien');
select is((select (payload ->> 'seuil_jours')::int from public.card_events
            where card_id = :'c4' and type = 'stalled' and placement_id = :'attache'
              and created_at >= (select t from t_debut)),
          (select coalesce(ws.stale_after_days, n.default_stale_after_days) from public.workflow_steps ws
             join public.workflow_nodes_catalog n on n.id = ws.node_id where ws.id = :'etape_attache'),
	'… et porte le seuil de l''étape de CE rattachement');
select is(app.relancer_cards_figees(), 0, 'rejouée, la relance n''inscrit rien : au plus un `stalled` par entrée');

select * from finish();
rollback;
