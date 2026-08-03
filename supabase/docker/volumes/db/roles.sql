-- @spec CRM-001 (docs/BACKLOG.md) — initialisation de la pile Supabase self-hosted
-- @spec docs/DAT.md §3.2 (base de données), §15 (dépendances structurantes)
-- Mots de passe des rôles techniques de la pile, alignés sur POSTGRES_PASSWORD.
-- Repris de la pile self-hosted officielle Supabase (docker/volumes/db/), versions épinglées.

-- NOTE: change to your own passwords for production environments
\set pgpass `echo "$POSTGRES_PASSWORD"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
