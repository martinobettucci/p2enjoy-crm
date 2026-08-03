-- @spec CRM-001 (docs/BACKLOG.md) — initialisation de la pile Supabase self-hosted
-- @spec docs/DAT.md §3.2 (base de données), §15 (dépendances structurantes)
-- Schéma interne du pooler Supavisor.
-- Repris de la pile self-hosted officielle Supabase (docker/volumes/db/), versions épinglées.

\set pguser `echo "$POSTGRES_USER"`

\c _supabase
create schema if not exists _supavisor;
alter schema _supavisor owner to :pguser;
\c postgres
