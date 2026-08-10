-- @spec CRM-001 (docs/BACKLOG.md) — initialisation de la pile Supabase self-hosted
-- @spec docs/DAT.md §3.2 (base de données), §15 (dépendances structurantes)
-- Secret et durée de vie des JWT exposés à la base (docs/DAT.md §4.1).
-- Repris de la pile self-hosted officielle Supabase (docker/volumes/db/), versions épinglées.

\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
