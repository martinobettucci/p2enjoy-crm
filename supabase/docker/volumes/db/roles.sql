-- @spec CRM-001 (docs/BACKLOG.md) — initialisation de la pile Supabase self-hosted
-- @spec docs/DAT.md §3.2 (base de données), §15 (dépendances structurantes)
-- Mots de passe des rôles techniques de la pile, alignés sur POSTGRES_PASSWORD.
-- Repris de la pile self-hosted officielle Supabase (docker/volumes/db/), versions épinglées.

-- NOTE: change to your own passwords for production environments
\set pgpass `echo "$POSTGRES_PASSWORD"`

-- `pgbouncer` N'EST PAS ICI, et c'est délibéré (docs/JOURNAL.md décision 366). Le rôle existe dans
-- l'image `supabase/postgres` et y reste ; seul son mot de passe disparaît. Il ne servait qu'à
-- l'`auth_query` du pooler Supavisor, retiré de la pile : lui laisser `POSTGRES_PASSWORD` serait
-- garder un compte de connexion sans aucun client.
ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';
