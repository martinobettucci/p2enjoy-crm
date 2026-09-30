-- @spec CRM-096 (docs/BACKLOG.md) — tranche T1 : le registre des migrations
-- @spec docs/DAT.md §3.2 bis (le registre, le passage du runner, l'adoption) ; docs/SCHEMA.md §8
--       (`app.migrations_appliquees`) ; docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décision 616 — arbitrage du responsable : un registre avec empreinte (INC-264)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- La TABLE du registre, et rien d'autre : c'est le `migrations-runner` qui y inscrit les fichiers
-- (tranche T2). Tant qu'elle n'existe pas, ou qu'elle est vide, le passage est une ADOPTION : le runner
-- rejoue tout le répertoire, comme depuis la décision 20, puis inscrit d'un seul geste tous les fichiers
-- rejoués (mode `adoption`). Les passages suivants n'appliquent plus que les fichiers absents du
-- registre (mode `application`).
--
-- UNE MIGRATION, ET NON UNE TABLE CRÉÉE PAR LE RUNNER : tout changement de schéma est une migration
-- versionnée (CLAUDE.md §24), et une table née hors du dépôt échapperait à ses preuves.
--
-- FERMÉE À L'API : RLS activée SANS politique, et aucun privilège pour `anon`, `authenticated` ni
-- `service_role`. Le schéma `app` n'est pas exposé par PostgREST ; le registre dit quelles migrations
-- porte la base, ce qui ne regarde aucun client. Seuls écrivent le propriétaire, `postgres` — rôle par
-- défaut du runner —, et `supabase_admin`, superutilisateur sous lequel certaines migrations
-- s'appliquent : l'inscription se fait dans la transaction du fichier, sous son rôle.
--
-- IDEMPOTENTE, comme toutes les migrations du dépôt : l'adoption la rejoue avec les autres.
-- Le runner applique chaque fichier dans sa propre transaction : aucun `begin` ici.

create table if not exists app.migrations_appliquees (
	fichier text primary key
		constraint migrations_appliquees_fichier_check check (fichier ~ '^[0-9]{4}_[a-z0-9_]+\.sql$'),
	empreinte text not null
		constraint migrations_appliquees_empreinte_check check (empreinte ~ '^[0-9a-f]{64}$'),
	mode text not null
		constraint migrations_appliquees_mode_check check (mode in ('application', 'adoption')),
	inscrite_le timestamptz not null default now()
);

comment on table app.migrations_appliquees is
	'Registre du migrations-runner : un fichier de supabase/migrations par ligne, avec l''empreinte '
	'SHA-256 de son contenu au moment de son application (docs/DAT.md §3.2 bis, décision 616).';

alter table app.migrations_appliquees enable row level security;

revoke all on table app.migrations_appliquees from public, anon, authenticated, service_role;
