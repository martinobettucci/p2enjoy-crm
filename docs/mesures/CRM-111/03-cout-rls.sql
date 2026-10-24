-- @spec CRM-111 (docs/BACKLOG.md) — tranche T1 : mesures, sans code livré
-- @spec docs/SPEC-rattachements.md §2 bis (mesures de T1), §4 (autorisations), §14 (tranches)
--
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE JETABLE (crm111_mesure), jamais sur la base de développement : ce script
-- ajoute des objets et, pour les mesures, travaille dans une transaction annulée. Mode opératoire :
-- docs/SPEC-rattachements.md §2 bis.5.
--
-- Coût de la RLS : volume synthétique (-v vol=N), quatre variantes de politiques, requêtes du board, de
-- la liste, de la fiche et de la recherche, médiane de -v reps=N exécutions sous trois profils du seed.
\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep ' | '
begin;
select set_config('t1.reps', :'reps', true);
-- 1. Volume synthétique, sans déclencheurs : :vol affaires de plus dans Maintenance, :vol sur les autres channels.
set local session_replication_role = replica;
insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title, position, currency, email_local_part, entered_step_at)
select c.workspace_id, c.channel_id, c.workflow_id, c.current_step_id, 'Synthétique '||g, 1000+g, 'EUR',
       'c-'||substr(translate(md5(g::text||'a'),'ilou','0123'),1,8), now() - (g||' minutes')::interval
from generate_series(1, :vol) g,
     lateral (select * from public.cards where channel_id='5eed0000-0000-4000-8000-000000000035' limit 1) c;
insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title, position, currency, email_local_part, entered_step_at)
select c.workspace_id, c.channel_id, c.workflow_id, c.current_step_id, 'Synthétique autre '||g, 1000+g, 'EUR',
       'c-'||substr(translate(md5(g::text||'b'),'ilou','0123'),1,8), now()
from generate_series(1, :vol) g,
     lateral (select * from public.cards where channel_id <> '5eed0000-0000-4000-8000-000000000035' and archived_at is null
              order by md5(g::text||id::text) limit 1) c;
set local session_replication_role = origin;
analyze public.cards;
select 'volume', count(*) filter (where channel_id='5eed0000-0000-4000-8000-000000000035'), count(*) from public.cards;

-- 2. Outillage de chronométrage : médiane de 9 exécutions, sous le rôle et les claims de chaque profil.
create temp table mesures (scenario text, profil text, requete text, ms numeric(10,2), lignes bigint);
create function pg_temp.mesurer(p_scenario text, p_sql jsonb) returns void language plpgsql as $f$
declare u record; q record; t0 timestamptz; d numeric[]; n bigint; i int;
begin
  for u in select * from (values ('admin','5eed0000-0000-4000-8000-000000000011'),
                                 ('bizdev','5eed0000-0000-4000-8000-000000000012'),
                                 ('lectrice','5eed0000-0000-4000-8000-000000000013')) v(nom, id) loop
    perform set_config('request.jwt.claims', json_build_object('sub', u.id, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    for q in select key, value #>> '{}' as sql from jsonb_each(p_sql) loop
      d := '{}';
      for i in 1..current_setting('t1.reps')::int loop
        t0 := clock_timestamp();
        execute 'select count(*) from (' || q.sql || ') s' into n;
        d := d || (extract(epoch from clock_timestamp() - t0) * 1000)::numeric;
      end loop;
      perform set_config('role', 'none', true);
      insert into mesures values (p_scenario, u.nom, q.key,
        (select percentile_cont(0.5) within group (order by x) from unnest(d) x), n);
      perform set_config('role', 'authenticated', true);
    end loop;
    perform set_config('role', 'none', true);
  end loop;
end $f$;


-- Liste des channels lisibles par l'appelant : la MÊME règle (app.can_read_channel), évaluée une fois par requête.
create function app.readable_channel_ids() returns uuid[] language sql stable security definer set search_path = ''
  as $f$ select coalesce(array_agg(ch.id), '{}') from public.channels ch where app.can_read_channel(ch.id) $f$;
grant execute on function app.readable_channel_ids() to authenticated;

-- 3. AVANT : les requêtes du produit (webapp/src/lib/colonnes-board.ts, liste-cards.ts), politiques livrées.
select pg_temp.mesurer('avant', jsonb_build_object(
  'board', $q$select c.id, c.title, c.description, c.position, c.amount, c.currency, c.next_action, c.current_step_id,
              c.entered_step_at, c.email_local_part, c.owner_id, c.snoozed_until, pr.full_name
              from public.cards c left join public.profiles pr on pr.id = c.owner_id
              where c.channel_id = '5eed0000-0000-4000-8000-000000000035' and c.archived_at is null and c.deleted_at is null
              order by c.position, c.title$q$,
  'liste', $q$select count(*) over () as total, c.id, c.title, pr.full_name
              from public.cards c left join public.profiles pr on pr.id = c.owner_id
              where c.channel_id = '5eed0000-0000-4000-8000-000000000035' and c.archived_at is null and c.deleted_at is null
              order by c.title limit 50$q$,
  'fiche', $q$select c.* from public.cards c where c.title = 'Synthétique 777'$q$,
  'recherche', $q$select c.id from public.cards c where c.search_tsv @@ plainto_tsquery('simple', 'synthétique')$q$));

drop policy cards_lecture on public.cards;
create policy cards_lecture on public.cards for select to authenticated using (channel_id in (select unnest(app.readable_channel_ids())));
select pg_temp.mesurer('avant_opt', jsonb_build_object(
  'board', $q$select c.id, c.title, c.description, c.position, c.amount, c.currency, c.next_action, c.current_step_id,
              c.entered_step_at, c.email_local_part, c.owner_id, c.snoozed_until, pr.full_name
              from public.cards c left join public.profiles pr on pr.id = c.owner_id
              where c.channel_id = '5eed0000-0000-4000-8000-000000000035' and c.archived_at is null and c.deleted_at is null
              order by c.position, c.title$q$,
  'liste', $q$select count(*) over () as total, c.id, c.title, pr.full_name
              from public.cards c left join public.profiles pr on pr.id = c.owner_id
              where c.channel_id = '5eed0000-0000-4000-8000-000000000035' and c.archived_at is null and c.deleted_at is null
              order by c.title limit 50$q$,
  'fiche', $q$select c.* from public.cards c where c.title = 'Synthétique 777'$q$,
  'recherche', $q$select c.id from public.cards c where c.search_tsv @@ plainto_tsquery('simple', 'synthétique')$q$));

drop policy cards_lecture on public.cards;
create policy cards_lecture on public.cards for select to authenticated using (app.can_read_channel(channel_id));

-- 4. Prototype : card_placements, reprise, index, RLS, helper security definer, politique de cards réécrite.
set local session_replication_role = replica;
create table public.card_placements as
  select gen_random_uuid() as id, workspace_id, id as card_id, channel_id, workflow_id, current_step_id, position,
         owner_id, amount, probability_override, next_action, next_action_at, entered_step_at, health_score,
         snoozed_until, archived_at from public.cards;
set local session_replication_role = origin;
alter table public.card_placements add primary key (id);
create unique index on public.card_placements (card_id, channel_id);
create index on public.card_placements (channel_id, position);
analyze public.card_placements;
alter table public.card_placements enable row level security;
create policy card_placements_select on public.card_placements for select to authenticated using (app.can_read_channel(channel_id));
grant select on public.card_placements to authenticated;
create function app.can_read_card_proto(p_card uuid) returns boolean language sql stable security definer set search_path = ''
  as $f$ select exists (select 1 from public.card_placements p where p.card_id = p_card and app.can_read_channel(p.channel_id)) $f$;
grant execute on function app.can_read_card_proto(uuid) to authenticated;
drop policy cards_lecture on public.cards;
create policy cards_lecture on public.cards for select to authenticated using (app.can_read_card_proto(id));

-- 5. APRÈS : mêmes écrans, lus par le rattachement.
select pg_temp.mesurer('apres', jsonb_build_object(
  'board', $q$select p.id, c.title, c.description, p.position, p.amount, c.currency, p.next_action, p.current_step_id,
              p.entered_step_at, c.email_local_part, p.owner_id, p.snoozed_until, pr.full_name
              from public.card_placements p join public.cards c on c.id = p.card_id
              left join public.profiles pr on pr.id = p.owner_id
              where p.channel_id = '5eed0000-0000-4000-8000-000000000035' and p.archived_at is null and c.deleted_at is null
              order by p.position, c.title$q$,
  'liste', $q$select count(*) over () as total, p.id, c.title, pr.full_name
              from public.card_placements p join public.cards c on c.id = p.card_id
              left join public.profiles pr on pr.id = p.owner_id
              where p.channel_id = '5eed0000-0000-4000-8000-000000000035' and p.archived_at is null and c.deleted_at is null
              order by c.title limit 50$q$,
  'fiche', $q$select c.* from public.cards c where c.title = 'Synthétique 777'$q$,
  'recherche', $q$select c.id from public.cards c where c.search_tsv @@ plainto_tsquery('simple', 'synthétique')$q$));

drop policy card_placements_select on public.card_placements;
create policy card_placements_select on public.card_placements for select to authenticated using (channel_id in (select unnest(app.readable_channel_ids())));
drop policy cards_lecture on public.cards;
create policy cards_lecture on public.cards for select to authenticated
  using (id in (select p.card_id from public.card_placements p where p.channel_id in (select unnest(app.readable_channel_ids()))));
select pg_temp.mesurer('apres_opt', jsonb_build_object(
  'board', $q$select p.id, c.title, c.description, p.position, p.amount, c.currency, p.next_action, p.current_step_id,
              p.entered_step_at, c.email_local_part, p.owner_id, p.snoozed_until, pr.full_name
              from public.card_placements p join public.cards c on c.id = p.card_id
              left join public.profiles pr on pr.id = p.owner_id
              where p.channel_id = '5eed0000-0000-4000-8000-000000000035' and p.archived_at is null and c.deleted_at is null
              order by p.position, c.title$q$,
  'liste', $q$select count(*) over () as total, p.id, c.title, pr.full_name
              from public.card_placements p join public.cards c on c.id = p.card_id
              left join public.profiles pr on pr.id = p.owner_id
              where p.channel_id = '5eed0000-0000-4000-8000-000000000035' and p.archived_at is null and c.deleted_at is null
              order by c.title limit 50$q$,
  'fiche', $q$select c.* from public.cards c where c.title = 'Synthétique 777'$q$,
  'recherche', $q$select c.id from public.cards c where c.search_tsv @@ plainto_tsquery('simple', 'synthétique')$q$));


select requete, profil,
  max(ms) filter (where scenario='avant') as livree, max(ms) filter (where scenario='avant_opt') as livree_opt,
  max(ms) filter (where scenario='apres') as ratt, max(ms) filter (where scenario='apres_opt') as ratt_opt,
  string_agg(distinct lignes::text, ',') as lignes
from mesures group by 1,2 order by 1,2;
rollback;
