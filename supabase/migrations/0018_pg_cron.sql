-- @spec CRM-017 (docs/BACKLOG.md) — ordonnancement durable par PostgreSQL
-- @spec docs/SPEC-scheduler.md §2 (objets), §3 (job), §4 (sécurité), §5 (convergence)
-- @spec docs/DAT.md §3.3, §12 ; docs/SCHEMA.md §8, §9 ; docs/PROD_MIGRATIONS.md §3
-- @migration-role: supabase_admin
--
-- Cette migration livre le PORTEUR et son heartbeat, jamais un faux métier. Les relances,
-- digests et purges enregistreront leurs jobs quand leurs propres tables existeront (§1).

do $$
begin
	if current_user <> 'supabase_admin' then
		raise exception 'migration_role_inattendu: % (supabase_admin requis)', current_user;
	end if;
end;
$$;

create extension if not exists pg_cron;

-- L'image est épinglée, mais une configuration incompatible doit arrêter le runner plutôt que
-- laisser la pile démarrer avec un job qui ne pourra jamais s'exécuter.
do $$
declare
	version_cron text;
begin
	select extversion into version_cron from pg_extension where extname = 'pg_cron';
	if version_cron is distinct from '1.6.4' then
		raise exception 'pg_cron_version_inattendue: %', coalesce(version_cron, 'absente');
	end if;
	if position('pg_cron' in current_setting('shared_preload_libraries')) = 0 then
		raise exception 'pg_cron_non_precharge';
	end if;
	if current_setting('cron.database_name') <> 'postgres' then
		raise exception 'pg_cron_database_inattendue: %', current_setting('cron.database_name');
	end if;
	if current_setting('cron.log_run') <> 'on' then
		raise exception 'pg_cron_log_run_desactive';
	end if;
end;
$$;

-- L'extension laisse plusieurs fonctions exécutables par `public`, même si son schéma n'accorde
-- pas USAGE à ce rôle dans l'image actuelle. Les deux portes sont fermées, en nommant aussi les
-- trois rôles API : aucune évolution d'ACL par défaut ne doit rendre la programmation joignable.
revoke all on schema cron from public, anon, authenticated, service_role;
revoke all on all tables in schema cron from public, anon, authenticated, service_role;
revoke execute on all functions in schema cron from public, anon, authenticated, service_role;

-- L'extension appartient à `supabase_admin`, seul rôle capable de retirer ses ACL d'origine.
-- Tout le contrat applicatif et le job sont ensuite créés sous `postgres`, rôle du runner usuel.
set role postgres;

-- État de SUPERVISION, pas donnée métier : UNLOGGED évite de prétendre qu'il doit être sauvegardé.
create unlogged table if not exists app.scheduler_heartbeat (
	name        text        primary key,
	run_count   bigint      not null default 0,
	last_run_at timestamptz
);

alter table app.scheduler_heartbeat set unlogged;
alter table app.scheduler_heartbeat alter column name set not null;
alter table app.scheduler_heartbeat alter column run_count set not null;
alter table app.scheduler_heartbeat alter column run_count set default 0;

do $$
begin
	if exists (
		select 1 from pg_constraint
		 where conrelid = 'app.scheduler_heartbeat'::regclass
		   and conname = 'scheduler_heartbeat_name_check'
	) then
		alter table app.scheduler_heartbeat drop constraint scheduler_heartbeat_name_check;
	end if;
end;
$$;
alter table app.scheduler_heartbeat add constraint scheduler_heartbeat_name_check
	check (name = 'scheduler');
do $$
begin
	if exists (
		select 1 from pg_constraint
		 where conrelid = 'app.scheduler_heartbeat'::regclass
		   and conname = 'scheduler_heartbeat_run_count_check'
	) then
		alter table app.scheduler_heartbeat drop constraint scheduler_heartbeat_run_count_check;
	end if;
end;
$$;
alter table app.scheduler_heartbeat add constraint scheduler_heartbeat_run_count_check
	check (run_count >= 0);

insert into app.scheduler_heartbeat (name, run_count, last_run_at)
values ('scheduler', 0, null)
on conflict (name) do nothing;

revoke all on table app.scheduler_heartbeat from public, anon, authenticated, service_role;

comment on table app.scheduler_heartbeat is
	'CRM-017 — docs/SPEC-scheduler.md §2. Heartbeat UNLOGGED privé : état de supervision '
	'de pg_cron, jamais une donnée métier ni une donnée à sauvegarder.';
comment on column app.scheduler_heartbeat.run_count is
	'Nombre de passages réussis du job p2enjoy-scheduler-heartbeat.';
comment on column app.scheduler_heartbeat.last_run_at is
	'Date réelle du dernier passage réussi, posée avec clock_timestamp().';

-- Le job existe au moment de l'appel. Incrément et promotion sont dans la MÊME transaction : si
-- `cron.alter_job` échoue, le heartbeat est annulé et pg_cron journalise l'échec (§3).
create or replace function app.scheduler_heartbeat_tick()
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	job_id bigint;
begin
	select jobid
	  into job_id
	  from cron.job
	 where jobname = 'p2enjoy-scheduler-heartbeat'
	   and username = 'postgres';

	if job_id is null then
		raise exception 'scheduler_heartbeat_job_absent';
	end if;

	insert into app.scheduler_heartbeat as heartbeat (name, run_count, last_run_at)
	values ('scheduler', 1, clock_timestamp())
	on conflict (name) do update
	set run_count = heartbeat.run_count + 1,
	    last_run_at = excluded.last_run_at;

	perform cron.alter_job(job_id, schedule => '7 * * * *', database => 'postgres', active => true);
end;
$$;

alter function app.scheduler_heartbeat_tick() owner to postgres;
revoke all on function app.scheduler_heartbeat_tick()
	from public, anon, authenticated, service_role;

comment on function app.scheduler_heartbeat_tick() is
	'CRM-017 — docs/SPEC-scheduler.md §3. Incrémente le heartbeat puis ramène le job de son '
	'amorçage à cinq secondes vers sa cadence nominale horaire.';

-- `cron.schedule` portant un nom stable met à jour le job de `postgres` sans changer son jobid.
-- Le complément `alter_job` répare aussi la base et l'activation ; le propriétaire reste celui
-- qui applique la migration, nécessairement `postgres` dans le runner de cette pile.
do $$
declare
	job_id bigint;
begin
	select cron.schedule(
		'p2enjoy-scheduler-heartbeat',
		'5 seconds',
		'select app.scheduler_heartbeat_tick();'
	) into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

reset role;
