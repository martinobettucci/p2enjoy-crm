-- @spec CRM-001 (docs/BACKLOG.md) — initialisation de la pile Supabase self-hosted
-- @spec docs/DAT.md §3.2 (base de données), §15 (dépendances structurantes)
-- Schéma interne de Realtime : prérequis du service d'abonnements (docs/DAT.md §3.1).
-- Repris de la pile self-hosted officielle Supabase (docker/volumes/db/), versions épinglées.

\set pguser `echo "$POSTGRES_USER"`

create schema if not exists _realtime;
alter schema _realtime owner to :pguser;
