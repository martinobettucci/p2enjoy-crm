-- @verifies CRM-017 (docs/BACKLOG.md) — ordonnancement durable par PostgreSQL
-- @verifies docs/SPEC-scheduler.md §2 (objets), §3 (job), §4 (sécurité), §6 (preuves)
-- @verifies docs/DAT.md §3.3, §12 ; docs/SCHEMA.md §8, §9
--
-- Le premier passage d'une base froide arrive au plus cinq secondes après le COMMIT de la
-- migration. L'attente n'a lieu que si aucun passage n'est encore visible ; elle précède la
-- transaction pgTAP afin que le job, dans une autre connexion, puisse être observé sans ambiguïté.

do $$
begin
	if to_regclass('app.scheduler_heartbeat') is not null
	   and (
		not exists (select 1 from app.scheduler_heartbeat where run_count > 0)
		or exists (select 1 from cron.job
		           where jobname = 'p2enjoy-scheduler-heartbeat' and schedule = '5 seconds')
	   ) then
		perform pg_sleep(11);
	end if;
end;
$$;

begin;

create extension if not exists pgtap with schema extensions;

select plan(48);

-- =============================================================================================
-- 1. Extension et réglages opposables
-- =============================================================================================

select is((select extversion from pg_extension where extname = 'pg_cron'), '1.6.4',
	'pg_cron 1.6.4 est installé, pas seulement disponible');
select ok(position('pg_cron' in current_setting('shared_preload_libraries')) > 0,
	'pg_cron est préchargé par le serveur');
select is(current_setting('cron.database_name'), 'postgres',
	'les jobs sont enregistrés dans la base postgres de la pile');
select is(current_setting('cron.log_run'), 'on',
	'le journal d’exécution nécessaire à la preuve reste actif');

-- =============================================================================================
-- 2. Heartbeat privé
-- =============================================================================================

select has_table('app', 'scheduler_heartbeat', 'le heartbeat privé existe dans app');
select columns_are('app', 'scheduler_heartbeat', array['name', 'run_count', 'last_run_at'],
	'le heartbeat ne porte que sa clé, son compteur et sa date');
select col_is_pk('app', 'scheduler_heartbeat', 'name', 'la clé du heartbeat est son nom stable');
select is((select relpersistence::text from pg_class where oid = 'app.scheduler_heartbeat'::regclass),
	'u', 'le heartbeat est UNLOGGED : ce n’est pas une donnée à sauvegarder');
select ok(exists (
	select 1 from pg_constraint
	 where conrelid = 'app.scheduler_heartbeat'::regclass
	   and conname = 'scheduler_heartbeat_name_check'
	   and pg_get_constraintdef(oid) ~ 'name = ''scheduler'''
), 'la table ne peut porter qu’une ligne nommée scheduler');
select ok(exists (
	select 1 from pg_constraint
	 where conrelid = 'app.scheduler_heartbeat'::regclass
	   and conname = 'scheduler_heartbeat_run_count_check'
	   and pg_get_constraintdef(oid) ~ 'run_count >= 0'
), 'le compteur ne peut jamais devenir négatif');
select is((select count(*)::int from app.scheduler_heartbeat), 1,
	'une seule ligne de heartbeat existe');
select is((select name from app.scheduler_heartbeat), 'scheduler',
	'la ligne unique porte la clé stable scheduler');
select ok((select run_count > 0 from app.scheduler_heartbeat),
	'le job a réellement incrémenté le compteur');
select ok((select last_run_at is not null from app.scheduler_heartbeat),
	'le job a posé la date réelle de son passage');
select ok((select last_run_at > clock_timestamp() - interval '70 minutes'
	from app.scheduler_heartbeat),
	'le heartbeat n’est pas plus ancien que sa cadence horaire');

-- =============================================================================================
-- 3. Fonction d’exécution
-- =============================================================================================

select has_function('app', 'scheduler_heartbeat_tick', array[]::text[],
	'la fonction privée du heartbeat existe sans argument');
select function_returns('app', 'scheduler_heartbeat_tick', array[]::text[], 'void',
	'la fonction ne rend aucune donnée');
select is((select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
	where p.oid = 'app.scheduler_heartbeat_tick()'::regprocedure), 'plpgsql',
	'la fonction est écrite en PL/pgSQL');
select is((select provolatile::text from pg_proc
	where oid = 'app.scheduler_heartbeat_tick()'::regprocedure), 'v',
	'la fonction est VOLATILE : elle écrit réellement');
select ok(not (select prosecdef from pg_proc
	where oid = 'app.scheduler_heartbeat_tick()'::regprocedure),
	'la fonction est SECURITY INVOKER, le job postgres n’emprunte aucun droit caché');
select ok((select coalesce(proconfig, array[]::text[]) @> array['search_path=""']
	from pg_proc where oid = 'app.scheduler_heartbeat_tick()'::regprocedure),
	'la fonction fixe search_path à la chaîne vide');
select is((select pg_get_userbyid(proowner) from pg_proc
	where oid = 'app.scheduler_heartbeat_tick()'::regprocedure), 'postgres',
	'la fonction appartient au rôle qui exécute le job');

-- =============================================================================================
-- 4. Aucun rôle API ne peut programmer ni déclencher
-- =============================================================================================

select ok(not exists (
	select 1 from pg_class c,
	lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
	where c.oid = 'app.scheduler_heartbeat'::regclass and a.grantee = 0
), 'PUBLIC n’a aucun privilège de table sur le heartbeat');
select ok(not has_table_privilege('anon', 'app.scheduler_heartbeat',
	'SELECT,INSERT,UPDATE,DELETE'), 'anon n’a aucun privilège sur le heartbeat');
select ok(not has_table_privilege('authenticated', 'app.scheduler_heartbeat',
	'SELECT,INSERT,UPDATE,DELETE'), 'authenticated n’a aucun privilège sur le heartbeat');
select ok(not has_table_privilege('service_role', 'app.scheduler_heartbeat',
	'SELECT,INSERT,UPDATE,DELETE'), 'service_role n’a aucun privilège sur le heartbeat');

select ok(not exists (
	select 1 from pg_proc p,
	lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
	where p.oid = 'app.scheduler_heartbeat_tick()'::regprocedure
	  and a.grantee = 0 and a.privilege_type = 'EXECUTE'
), 'PUBLIC ne peut pas exécuter le heartbeat');
select ok(not has_function_privilege('anon', 'app.scheduler_heartbeat_tick()', 'EXECUTE'),
	'anon ne peut pas exécuter le heartbeat');
select ok(not has_function_privilege('authenticated', 'app.scheduler_heartbeat_tick()', 'EXECUTE'),
	'authenticated ne peut pas exécuter le heartbeat');
select ok(not has_function_privilege('service_role', 'app.scheduler_heartbeat_tick()', 'EXECUTE'),
	'service_role ne peut pas exécuter le heartbeat');

select ok(not exists (
	select 1 from pg_namespace n,
	lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
	where n.nspname = 'cron' and a.grantee = 0 and a.privilege_type = 'USAGE'
), 'PUBLIC n’a pas USAGE sur le schéma cron');
select ok(not has_schema_privilege('anon', 'cron', 'USAGE'),
	'anon ne peut pas joindre le catalogue cron');
select ok(not has_schema_privilege('authenticated', 'cron', 'USAGE'),
	'authenticated ne peut pas joindre le catalogue cron');
select ok(not has_schema_privilege('service_role', 'cron', 'USAGE'),
	'service_role ne peut pas joindre le catalogue cron');

select ok(not exists (
	select 1 from pg_namespace n,
	lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
	where n.nspname = 'cron' and a.grantee = 0
), 'PUBLIC n’a réellement aucun privilège sur le schéma cron');
select ok(not exists (
	select 1 from pg_namespace n,
	lateral aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
	where n.nspname = 'cron'
	  and a.grantee in (select oid from pg_roles
	                    where rolname in ('anon', 'authenticated', 'service_role'))
), 'aucun rôle API ne conserve un privilège direct sur le schéma cron');
select ok(not exists (
	select 1 from pg_class c
	join pg_namespace n on n.oid = c.relnamespace,
	lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
	where n.nspname = 'cron' and c.relkind in ('r', 'p', 'v', 'm', 'f') and a.grantee = 0
), 'PUBLIC n’a réellement aucun privilège sur les relations cron');
select ok(not exists (
	select 1 from pg_class c
	join pg_namespace n on n.oid = c.relnamespace,
	lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
	where n.nspname = 'cron' and c.relkind in ('r', 'p', 'v', 'm', 'f')
	  and a.grantee in (select oid from pg_roles
	                    where rolname in ('anon', 'authenticated', 'service_role'))
), 'aucun rôle API ne conserve un privilège direct sur les relations cron');
select ok(not exists (
	select 1 from pg_proc p
	join pg_namespace n on n.oid = p.pronamespace,
	lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
	where n.nspname = 'cron' and a.grantee = 0
), 'PUBLIC ne conserve EXECUTE sur aucune fonction cron');
select ok(not exists (
	select 1 from pg_proc p
	join pg_namespace n on n.oid = p.pronamespace,
	lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
	where n.nspname = 'cron'
	  and a.grantee in (select oid from pg_roles
	                    where rolname in ('anon', 'authenticated', 'service_role'))
), 'aucun rôle API ne conserve EXECUTE sur une fonction cron');

-- =============================================================================================
-- 5. Job unique, convergé et réellement exécuté
-- =============================================================================================

select is((select count(*)::int from cron.job
	where jobname = 'p2enjoy-scheduler-heartbeat'), 1,
	'un unique job heartbeat existe, sans doublon de rejeu');
select is((select schedule from cron.job
	where jobname = 'p2enjoy-scheduler-heartbeat'), '7 * * * *',
	'le premier passage a ramené le job à sa cadence nominale horaire');
select is((select command from cron.job
	where jobname = 'p2enjoy-scheduler-heartbeat'),
	'select app.scheduler_heartbeat_tick();', 'la commande du job est exacte et qualifiée');
select is((select database from cron.job
	where jobname = 'p2enjoy-scheduler-heartbeat'), 'postgres',
	'le job cible la base postgres');
select is((select username from cron.job
	where jobname = 'p2enjoy-scheduler-heartbeat'), 'postgres',
	'le job s’exécute sous le propriétaire PostgreSQL');
select ok((select active from cron.job
	where jobname = 'p2enjoy-scheduler-heartbeat'), 'le job reste actif après sa promotion');
select ok(exists (
	select 1 from cron.job_run_details d join cron.job j using (jobid)
	 where j.jobname = 'p2enjoy-scheduler-heartbeat' and d.status = 'succeeded'
), 'cron.job_run_details porte un passage réellement réussi');
select ok(exists (
	select 1 from cron.job_run_details d join cron.job j using (jobid)
	 where j.jobname = 'p2enjoy-scheduler-heartbeat'
	   and d.status = 'succeeded'
	   and d.command = 'select app.scheduler_heartbeat_tick();'
), 'le passage réussi correspond à la commande du produit, pas à une sonde étrangère');

select * from finish();
rollback;
