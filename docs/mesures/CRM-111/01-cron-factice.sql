-- @spec CRM-111 (docs/BACKLOG.md) — tranche T1 : mesures, sans code livré
-- @spec docs/SPEC-rattachements.md §2 bis (mesures de T1), §4 (autorisations), §14 (tranches)
--
-- À EXÉCUTER UNIQUEMENT SUR UNE BASE JETABLE (crm111_mesure), jamais sur la base de développement : ce script
-- ajoute des objets et, pour les mesures, travaille dans une transaction annulée. Mode opératoire :
-- docs/SPEC-rattachements.md §2 bis.5.
--
-- Schéma cron factice : la copie n'a pas pg_cron (il ne s'installe que dans la base postgres), et
-- plpgsql_check s'arrêterait sur cron.job au lieu de voir les colonnes de cards.
create schema if not exists cron;
create table if not exists cron.job (jobid bigint, jobname text, schedule text, command text, active boolean, database text, username text);
create table if not exists cron.job_run_details (jobid bigint, runid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz, command text);
create or replace function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void language sql as 'select';
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as 'select 0::bigint';
create or replace function cron.unschedule(job_name text) returns boolean language sql as 'select true';
