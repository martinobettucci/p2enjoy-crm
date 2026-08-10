-- @spec CRM-001 (docs/BACKLOG.md) — initialisation de la pile Supabase self-hosted
-- @spec docs/DAT.md §3.2 (base de données), §15 (dépendances structurantes)
-- Base interne `_supabase`, requise par le pooler Supavisor (README.md §2).
-- Repris de la pile self-hosted officielle Supabase (docker/volumes/db/), versions épinglées.

\set pguser `echo "$POSTGRES_USER"`

CREATE DATABASE _supabase WITH OWNER :pguser;
