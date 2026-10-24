-- @spec CRM-111 (docs/BACKLOG.md) — tranche T1 : mesures, sans code livré
-- @spec docs/SPEC-rattachements.md §2 bis.3 bis (fraîcheur des droits), §4 (autorisations)
--
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE JETABLE (crm111_mesure), dans une transaction annulée ; mode opératoire :
-- docs/SPEC-rattachements.md §2 bis.5.
--
-- Contre-preuve : la même fonction déclarée IMMUTABLE est figée dans le plan préparé et continue de rendre
-- des affaires à qui a perdu le droit. Ce script DOIT montrer optimisée=27 aux étapes 2, 5 et 6.
\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep ' | '
begin;
set local plan_cache_mode = force_generic_plan;
create function app.readable_channel_ids() returns uuid[] language sql immutable security definer set search_path = ''
  as $f$ select coalesce(array_agg(ch.id), '{}') from public.channels ch where app.can_read_channel(ch.id) $f$;
grant execute on function app.readable_channel_ids() to authenticated;
create temp table journal_preuve (etape text, politique text, lignes bigint);
grant all on journal_preuve to authenticated;

-- Driss (business_developer) a aujourd'hui « viewer » sur Maintenance (channel 35) : il le lit.
create function pg_temp.etape(p_etape text) returns void language plpgsql as $f$
declare n_livree bigint; n_opt bigint;
begin
  perform set_config('request.jwt.claims', '{"sub":"5eed0000-0000-4000-8000-000000000012","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);
  execute 'execute lire_livree' into n_livree;
  execute 'execute lire_opt' into n_opt;
  perform set_config('role', 'none', true);
  insert into journal_preuve values (p_etape, 'livrée', n_livree), (p_etape, 'optimisée', n_opt);
end $f$;

-- Deux requêtes préparées AVANT tout changement de droits, l'une par politique.
-- Isoler chaque forme : la politique livrée est remplacée par « vrai », seul le prédicat de chaque requête décide.
drop policy cards_lecture on public.cards;
create policy cards_lecture on public.cards for select to authenticated using (true);
prepare lire_livree as select count(*) from public.cards c
  where c.channel_id = '5eed0000-0000-4000-8000-000000000035' and app.can_read_channel(c.channel_id);
prepare lire_opt as select count(*) from public.cards c
  where c.channel_id = '5eed0000-0000-4000-8000-000000000035' and c.channel_id in (select unnest(app.readable_channel_ids()));

select pg_temp.etape('1. droit initial : viewer');
update public.channel_members set access = 'none'
  where user_id = '5eed0000-0000-4000-8000-000000000012' and channel_id = '5eed0000-0000-4000-8000-000000000035';
select pg_temp.etape('2. droit retiré : none');
update public.channel_members set access = 'member'
  where user_id = '5eed0000-0000-4000-8000-000000000012' and channel_id = '5eed0000-0000-4000-8000-000000000035';
select pg_temp.etape('3. droit rendu : member');
delete from public.channel_members
  where user_id = '5eed0000-0000-4000-8000-000000000012' and channel_id = '5eed0000-0000-4000-8000-000000000035';
select pg_temp.etape('4. surcharge retirée : droit du track');
update public.workspace_members set role = 'viewer' where user_id = '5eed0000-0000-4000-8000-000000000012';
insert into public.channel_members (user_id, channel_id, access) values ('5eed0000-0000-4000-8000-000000000012','5eed0000-0000-4000-8000-000000000035','none');
select pg_temp.etape('5. rôle d''espace changé puis channel fermé');
delete from public.workspace_members where user_id = '5eed0000-0000-4000-8000-000000000012';
delete from public.channel_members where user_id = '5eed0000-0000-4000-8000-000000000012';
select pg_temp.etape('6. retiré de l''espace');
select etape, string_agg(politique||'='||lignes, '  ' order by politique) from journal_preuve group by 1 order by 1;
select 'plans génériques', count(*) filter (where generic_plans > 0) from pg_prepared_statements where name in ('lire_livree','lire_opt');
rollback;
