-- @spec CRM-102 (docs/BACKLOG.md) — tranche T1 : le registre du connecteur MCP, en base
-- @spec docs/SPEC-mcp.md §6.1 (familles et actions), §6.3 (`public.mcp_autorise`), §7 (tables, inscription et amorçage,
--       RPC du service) ; docs/SCHEMA.md §9 quinquies ; docs/SPEC-plateforme.md §3 (amorçage), §5.3
--       (`app.est_superadmin`, `app.est_superadmin_pour`) ; docs/PROD_MIGRATIONS.md §2.14
-- @spec docs/JOURNAL.md décision 627 (A2 : la matrice RESTREINT le CRM ; D5 : appliquée à la visibilité et à chaque
--       appel ; D6 : sept familles, quatre actions)
--
-- CE QUE CETTE MIGRATION FAIT, ET RIEN D'AUTRE.
--   1. Trois tables FERMÉES à l'API — RLS sans politique, privilèges retirés nommément : `mcp_comptes` (les comptes
--      vérifiés qui se sont connectés), `mcp_droits` (la matrice), `mcp_journal` (un appel d'outil par ligne, sans
--      argument).
--   2. `public.mcp_autorise(ws, famille, action)`, appelée PAR LA PERSONNE ELLE-MÊME sous son jeton interne : le
--      superadministrateur franchit la matrice, tout autre compte doit y porter la case. Elle ne lit PAS
--      l'appartenance au CRM : la RLS fait l'intersection au moment de l'accès (A2), et la recopier ici en ferait une
--      seconde définition.
--   3. Trois RPC réservées à la clé de service — inscription (avec l'amorçage de la plateforme), état d'un compte
--      (drapeau et matrice) pour la visibilité des outils, journal d'un appel.
--
-- Les RPC de l'ADMINISTRATION de la matrice (`CRM-103`) viennent dans une migration à elles.
-- Ordinaire, idempotente. Aucune donnée existante n'est modifiée.

-- =============================================================================================
-- 1. Les trois tables
-- =============================================================================================

create table if not exists public.mcp_comptes (
	sub                uuid        primary key,
	email              text        not null,
	nom                text        not null,
	premiere_connexion timestamptz not null default pg_catalog.now(),
	derniere_activite  timestamptz not null default pg_catalog.now(),
	constraint mcp_comptes_email_forme check (email = pg_catalog.lower(pg_catalog.btrim(email)) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
	constraint mcp_comptes_nom_borne check (pg_catalog.char_length(nom) between 1 and 120)
);

create table if not exists public.mcp_droits (
	sub          uuid        not null references public.mcp_comptes (sub) on delete cascade,
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	famille      text        not null,
	action       text        not null,
	accorde_par  uuid        references public.profiles (id) on delete set null,
	accorde_le   timestamptz not null default pg_catalog.now(),
	primary key (sub, workspace_id, famille, action),
	constraint mcp_droits_famille check (famille in ('structure', 'affaires', 'contacts', 'budgets', 'temps', 'objectifs', 'messagerie')),
	constraint mcp_droits_action check (action in ('consulter', 'ajouter', 'modifier', 'supprimer'))
);

create index if not exists mcp_droits_par_espace on public.mcp_droits (workspace_id);

create table if not exists public.mcp_journal (
	id           bigint      generated always as identity primary key,
	sub          uuid        not null,
	outil        text        not null,
	workspace_id uuid,
	issue        text        not null,
	duree_ms     integer     not null,
	cree_le      timestamptz not null default pg_catalog.now(),
	constraint mcp_journal_issue check (issue in ('ok', 'refus_matrice', 'refus_crm', 'erreur', 'trop_volumineux')),
	constraint mcp_journal_duree check (duree_ms >= 0),
	constraint mcp_journal_outil check (pg_catalog.char_length(outil) between 1 and 100)
);

create index if not exists mcp_journal_recents on public.mcp_journal (id desc);
create index if not exists mcp_journal_par_compte on public.mcp_journal (sub, id desc);

alter table public.mcp_comptes enable row level security;
alter table public.mcp_droits enable row level security;
alter table public.mcp_journal enable row level security;

revoke all on public.mcp_comptes from public, anon, authenticated;
revoke all on public.mcp_droits from public, anon, authenticated;
revoke all on public.mcp_journal from public, anon, authenticated;
grant all on public.mcp_comptes to service_role;
grant all on public.mcp_droits to service_role;
grant all on public.mcp_journal to service_role;

comment on table public.mcp_comptes is
	'CRM-102 — docs/SPEC-mcp.md §7.1. Comptes vérifiés connectés au connecteur ; aucune lecture par l''API.';
comment on table public.mcp_droits is
	'CRM-102 — docs/SPEC-mcp.md §6, §7.1. La matrice compte × espace × famille × action : une RESTRICTION en plus du CRM.';
comment on table public.mcp_journal is
	'CRM-102 — docs/SPEC-mcp.md §7.1, §11. Un appel d''outil par ligne ; jamais d''argument, de contenu ni de jeton.';

-- =============================================================================================
-- 2. La matrice, appelée par la personne elle-même
-- =============================================================================================

-- Une famille ou une action hors liste lève `22023` et ne rend jamais `false` : une erreur de déclaration d'un outil se
-- voit, au lieu de se confondre avec un refus (§6.3).
create or replace function public.mcp_autorise(p_ws uuid, p_famille text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_famille is null or p_famille not in ('structure', 'affaires', 'contacts', 'budgets', 'temps', 'objectifs', 'messagerie') then
		raise exception 'famille_inconnue' using errcode = '22023';
	end if;
	if p_action is null or p_action not in ('consulter', 'ajouter', 'modifier', 'supprimer') then
		raise exception 'action_inconnue' using errcode = '22023';
	end if;
	return app.est_superadmin()
	    or exists (
		select 1 from public.mcp_droits d
		 where d.sub = (select auth.uid())
		   and d.workspace_id = p_ws
		   and d.famille = p_famille
		   and d.action = p_action
	);
end;
$$;

-- =============================================================================================
-- 3. Les RPC du service
-- =============================================================================================

-- L'INSCRIPTION (§7.2). Le service ne l'appelle qu'après avoir vérifié le jeton LeLabs, l'adresse (`email_verified`) et
-- le rôle `verified` ; la fonction ne voit pas le jeton. Elle inscrit le compte ou relève son adresse et son nom, puis
-- applique l'amorçage de la plateforme — le même que la fonction `session` —, et rend ce que le service doit savoir.
create or replace function public.mcp_inscrire_compte(
	p_sub uuid, p_email text, p_nom text, p_superadmins_initiaux text[] default '{}', p_admin_lelabs boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	adresse text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
	nom     text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_nom, ''), '[[:space:]]+', ' ', 'g'));
begin
	if p_sub is null then
		raise exception 'sub_requis' using errcode = '22023';
	end if;
	if adresse !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
		raise exception 'adresse_invalide' using errcode = '22023';
	end if;
	if nom = '' then
		nom := pg_catalog.split_part(adresse, '@', 1);
	end if;
	nom := pg_catalog.btrim(pg_catalog.left(nom, 120));
	if nom = '' then
		nom := 'Utilisateur ' || pg_catalog.left(p_sub::text, 8);
	end if;

	insert into public.mcp_comptes (sub, email, nom)
	values (p_sub, adresse, nom)
	on conflict (sub) do update
	   set email = excluded.email, nom = excluded.nom, derniere_activite = pg_catalog.now();

	perform app.amorcer_superadmin(p_sub, adresse, nom, p_superadmins_initiaux);

	return pg_catalog.jsonb_build_object(
		'superadmin', app.est_superadmin_pour(p_sub, p_admin_lelabs),
		'droits', (select pg_catalog.count(*) from public.mcp_droits d where d.sub = p_sub)
	);
end;
$$;

-- L'ÉTAT d'un compte — son drapeau et sa matrice, en un appel —, pour la VISIBILITÉ des outils (§6.2, point 1) et
-- l'admission au retour du SSO : relu à chaque `tools/list`. Le drapeau LeLabs est celui du jeton que le service vient de
-- vérifier : la base ne le lit pas, elle ne voit pas le jeton.
create or replace function public.mcp_etat_compte(p_sub uuid, p_admin_lelabs boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select pg_catalog.jsonb_build_object(
		'superadmin', app.est_superadmin_pour(p_sub, p_admin_lelabs),
		'droits', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('workspace_id', d.workspace_id, 'famille', d.famille, 'action', d.action)
			                            order by d.workspace_id, d.famille, d.action)
			  from public.mcp_droits d where d.sub = p_sub), '[]'::jsonb));
$$;

create or replace function public.mcp_journaliser(p_sub uuid, p_outil text, p_ws uuid, p_issue text, p_duree_ms integer)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
	insert into public.mcp_journal (sub, outil, workspace_id, issue, duree_ms)
	values (p_sub, p_outil, p_ws, p_issue, greatest(coalesce(p_duree_ms, 0), 0));
$$;

-- =============================================================================================
-- 4. Propriétaires et privilèges
-- =============================================================================================
-- Fermées nommément, puis rouvertes au strict nécessaire (docs/SCHEMA.md §9).

do $$
declare
	f text;
begin
	foreach f in array array[
		'public.mcp_autorise(uuid, text, text)',
		'public.mcp_inscrire_compte(uuid, text, text, text[], boolean)',
		'public.mcp_etat_compte(uuid, boolean)',
		'public.mcp_journaliser(uuid, text, uuid, text, integer)'
	] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated, service_role', f);
	end loop;
end;
$$;

grant execute on function public.mcp_autorise(uuid, text, text) to authenticated;
grant execute on function public.mcp_inscrire_compte(uuid, text, text, text[], boolean) to service_role;
grant execute on function public.mcp_etat_compte(uuid, boolean) to service_role;
grant execute on function public.mcp_journaliser(uuid, text, uuid, text, integer) to service_role;

comment on function public.mcp_autorise(uuid, text, text) is
	'CRM-102 — docs/SPEC-mcp.md §6.3. Sous le jeton de la personne : superadministrateur, ou case de la matrice. N''ouvre rien que la RLS ferme.';
comment on function public.mcp_inscrire_compte(uuid, text, text, text[], boolean) is
	'CRM-102 — docs/SPEC-mcp.md §7.2. Inscription d''un compte vérifié, amorçage de la plateforme ; clé de service seule.';
comment on function public.mcp_etat_compte(uuid, boolean) is
	'CRM-102 — docs/SPEC-mcp.md §7.3. Drapeau et matrice d''un compte, pour la visibilité des outils ; clé de service seule.';
comment on function public.mcp_journaliser(uuid, text, uuid, text, integer) is
	'CRM-102 — docs/SPEC-mcp.md §7.1, §7.3. Une ligne du journal des appels, sans argument ; clé de service seule.';
