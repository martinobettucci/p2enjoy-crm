-- @spec CRM-111 (docs/BACKLOG.md) — tranche T1 : mesures, sans code livré
-- @spec docs/SPEC-rattachements.md §2 bis (mesures de T1), §4 (autorisations), §14 (tranches)
--
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE JETABLE (crm111_mesure), jamais sur la base de développement : ce script
-- ajoute des objets et, pour les mesures, travaille dans une transaction annulée. Mode opératoire :
-- docs/SPEC-rattachements.md §2 bis.5.
--
-- Retire de cards les treize colonnes qui la quittent (§3.2), dans une transaction annulée, puis rend
-- les fonctions de public et app que plpgsql_check (plpgsql) ou leur recréation (sql) déclarent cassées.
\set ON_ERROR_STOP off
create extension if not exists plpgsql_check;
begin;
set client_min_messages = notice;
-- 1. Dépendances déclarées (vues, index, contraintes, politiques, colonne générée) : ce que CASCADE emporte.
alter table public.cards
  drop column channel_id cascade, drop column workflow_id cascade, drop column current_step_id cascade,
  drop column position cascade, drop column owner_id cascade, drop column amount cascade,
  drop column probability_override cascade, drop column next_action cascade, drop column next_action_at cascade,
  drop column entered_step_at cascade, drop column health_score cascade, drop column snoozed_until cascade,
  drop column archived_at cascade;
-- 2. Fonctions plpgsql : plpgsql_check sur chacune (y compris fonctions de déclencheur, avec leur table).
create temp table resultat (fonction text, langage text, erreur text);
do $$
declare f record; r record; rel regclass;
begin
  for f in select p.oid, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as nom, l.lanname, p.prorettype
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
           where n.nspname in ('public','app') and p.prokind='f' and l.lanname='plpgsql'
             and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop
    rel := null;
    if f.prorettype = 'trigger'::regtype then
      select t.tgrelid::regclass into rel from pg_trigger t where t.tgfoid=f.oid limit 1;
      if rel is null then continue; end if;
    end if;
    begin
      for r in select * from plpgsql_check_function_tb(f.oid, coalesce(rel, 0), fatal_errors => false) where level='error' loop
        insert into resultat values (f.nom, 'plpgsql', r.message);
      end loop;
    exception when others then insert into resultat values (f.nom, 'plpgsql', 'check: '||sqlerrm);
    end;
  end loop;
end $$;
-- 3. Fonctions SQL : les recréer telles quelles révèle une référence morte.
do $$
declare f record;
begin
  for f in select p.oid, n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as nom
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
           where n.nspname in ('public','app') and p.prokind='f' and l.lanname='sql'
             and not exists (select 1 from pg_depend d where d.objid=p.oid and d.deptype='e')
  loop
    begin
      execute pg_get_functiondef(f.oid);
    exception when others then insert into resultat values (f.nom, 'sql', sqlerrm);
    end;
  end loop;
end $$;
\pset format unaligned
\pset fieldsep ' | '
select fonction, langage, string_agg(distinct erreur, ' ; ') from resultat group by 1,2 order by 2,1;
select 'TOTAL', count(distinct fonction) from resultat;
rollback;
