-- @spec CRM-092 (docs/BACKLOG.md) — identité par le seul SSO : profils nés d'un `sub`, attentes d'espace
-- @spec docs/SPEC-session-sso.md §6 (admission), §6.2 (ouverture de session), §6.3 (attentes),
--       §7.2 (modèle), §7.3 (aucune ligne modifiée)
-- @spec docs/SCHEMA.md §1 ; docs/SPEC-permissions-rls.md §3.2 (convention des privilèges)
-- @spec docs/SPEC-identite.md §4 (bornes du nom), §5 (dernier administrateur)
-- @spec docs/JOURNAL.md décisions 578, 579 et 581
--
-- Le SSO devient la seule source d'identité (décision 578). Cette migration :
--
--   1. détache `profiles.id` de `auth.users` : un profil naît désormais d'un `sub` LeLabs, qui n'a
--      aucune ligne dans `auth.users` ;
--   2. crée `workspace_invitations`, les ATTENTES d'un espace : une adresse et un rôle, inscrits
--      par un administrateur, que seule une connexion LeLabs vérifiée pourra honorer ;
--   3. crée `public.ouvrir_session_sso`, la moitié base de l'échangeur de session : elle consomme
--      les attentes d'une adresse, crée le profil s'il le faut, et dit si la personne est admise.
--
-- Elle ne modifie AUCUNE ligne existante (§7.3). Le trigger `on_auth_user_created` reste jusqu'au
-- retrait de GoTrue (tranche T6, migration 0076) : tant que GoTrue tourne, il ne gêne rien.

-- =============================================================================================
-- 1. `profiles.id` ne référence plus `auth.users`
-- =============================================================================================
-- Toute clé étrangère de `profiles` vers `auth.users` est retirée, quel que soit son nom : la
-- migration converge même si une base porte une contrainte renommée.

do $$
declare
	contrainte record;
begin
	for contrainte in
		select c.conname
		  from pg_catalog.pg_constraint c
		 where c.conrelid = 'public.profiles'::regclass
		   and c.contype = 'f'
		   and c.confrelid = 'auth.users'::regclass
	loop
		execute pg_catalog.format(
			'alter table public.profiles drop constraint %I', contrainte.conname);
	end loop;
end;
$$;

comment on table public.profiles is
	'CRM-003, CRM-092 — docs/SCHEMA.md §1. Personne du CRM ; son identifiant est le sub du SSO.';
comment on column public.profiles.id is
	'sub du SSO LeLabs (docs/SPEC-session-sso.md §1). Aucune identité ne naît dans le CRM.';

-- =============================================================================================
-- 2. `public.workspace_invitations` — les attentes d'un espace
-- =============================================================================================
-- Une attente n'est pas un compte : c'est une adresse et un rôle. Elle est consommée à la première
-- connexion admise de la personne, et changée en appartenance (§6.1).

create table if not exists public.workspace_invitations (
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	email        text        not null,
	role         text        not null,
	invited_by   uuid        default auth.uid() references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	constraint workspace_invitations_pkey primary key (workspace_id, email),
	constraint workspace_invitations_email_check check (
		email = pg_catalog.lower(pg_catalog.btrim(email))
		and pg_catalog.char_length(email) between 3 and 320
		and email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
	),
	constraint workspace_invitations_role_check check (
		role in ('admin', 'business_developer', 'viewer')
	)
);

-- La question posée à chaque échange : « quelles attentes portent cette adresse ? ».
create index if not exists workspace_invitations_email_idx
	on public.workspace_invitations (email);

comment on table public.workspace_invitations is
	'CRM-092 — docs/SPEC-session-sso.md §6.3, §7.2. Attentes d''un espace : adresse et rôle.';
comment on column public.workspace_invitations.email is
	'Adresse attendue, en minuscules et sans espace de bord ; comparée à l''adresse vérifiée du SSO.';
comment on column public.workspace_invitations.role is
	'Rôle de l''appartenance créée à la première connexion admise ; même liste que workspace_members.';
comment on column public.workspace_invitations.invited_by is
	'Administrateur qui a inscrit l''attente ; null si inscrite par la clé de service.';

-- =============================================================================================
-- 3. Privilèges et RLS : un administrateur de l'espace, et lui seul
-- =============================================================================================
-- Convention du projet (docs/SPEC-permissions-rls.md §3.2) : ce que `anon` peut lire rend zéro
-- ligne, jamais une erreur de privilège. Aucune mise à jour n'est ouverte : changer le rôle d'une
-- attente, c'est la retirer puis la réinscrire, comme pour une appartenance.

alter table public.workspace_invitations enable row level security;

revoke all on public.workspace_invitations from anon, authenticated;
grant select on public.workspace_invitations to anon, authenticated;
grant insert (workspace_id, email, role, invited_by) on public.workspace_invitations to authenticated;
grant delete on public.workspace_invitations to authenticated;
grant all privileges on public.workspace_invitations to service_role;

drop policy if exists workspace_invitations_lecture_admin on public.workspace_invitations;
create policy workspace_invitations_lecture_admin
	on public.workspace_invitations
	as permissive for select to anon, authenticated
	using (app.is_workspace_admin(workspace_id));

drop policy if exists workspace_invitations_insertion_admin on public.workspace_invitations;
create policy workspace_invitations_insertion_admin
	on public.workspace_invitations
	as permissive for insert to authenticated
	with check (
		app.is_workspace_admin(workspace_id)
		and invited_by = (select auth.uid())
	);

drop policy if exists workspace_invitations_suppression_admin on public.workspace_invitations;
create policy workspace_invitations_suppression_admin
	on public.workspace_invitations
	as permissive for delete to authenticated
	using (app.is_workspace_admin(workspace_id));

comment on policy workspace_invitations_lecture_admin on public.workspace_invitations is
	'CRM-092 — seul un administrateur de l''espace lit ses attentes.';
comment on policy workspace_invitations_insertion_admin on public.workspace_invitations is
	'CRM-092 — seul un administrateur inscrit une attente, et en son propre nom.';
comment on policy workspace_invitations_suppression_admin on public.workspace_invitations is
	'CRM-092 — seul un administrateur retire une attente.';

-- =============================================================================================
-- 4. `public.ouvrir_session_sso` — la moitié base de l'échangeur (§6.2)
-- =============================================================================================
-- Appelée par la seule fonction edge `session`, avec la clé de service, APRÈS qu'elle a vérifié le
-- jeton LeLabs, l'adresse vérifiée et le rôle `verified` (§5.2). La fonction ne voit pas le jeton
-- et ne revérifie rien de ce qui en dépend.
--
-- Deux ouvertures concurrentes convergent : la seconde attend les verrous de la première sur les
-- attentes, n'en trouve plus, puis lit l'appartenance validée. La fonction n'insère que : la garde
-- du dernier administrateur (docs/SPEC-identite.md §5) n'est jamais sollicitée.

create or replace function public.ouvrir_session_sso(p_sub uuid, p_email text, p_nom text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	adresse       text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
	nom           text;
	espaces_lies  uuid[];
	roles_lies    text[];
	rattachees    integer;
	espaces       integer;
	nom_profil    text;
begin
	if p_sub is null then
		raise exception 'sub_requis' using errcode = '22023';
	end if;
	if adresse !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
		raise exception 'adresse_invalide' using errcode = '22023';
	end if;

	-- 1. Consommer les attentes de cette adresse.
	with consommees as (
		delete from public.workspace_invitations i
		 where i.email = adresse
		returning i.workspace_id, i.role
	)
	select coalesce(pg_catalog.array_agg(c.workspace_id order by c.workspace_id), '{}'),
	       coalesce(pg_catalog.array_agg(c.role order by c.workspace_id), '{}')
	  into espaces_lies, roles_lies
	  from consommees c;
	rattachees := pg_catalog.cardinality(espaces_lies);

	-- 2. Créer le profil s'il manque, et seulement pour une personne attendue. Un profil existant
	--    n'est jamais réécrit : son nom est éditable par la personne (docs/SPEC-identite.md §4).
	if rattachees > 0 then
		nom := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_nom, ''), '[[:space:]]+', ' ', 'g'));
		if nom = '' then
			nom := pg_catalog.split_part(adresse, '@', 1);
		end if;
		nom := pg_catalog.btrim(pg_catalog.left(nom, 120));
		if nom = '' then
			nom := 'Utilisateur ' || pg_catalog.left(p_sub::text, 8);
		end if;

		insert into public.profiles (id, full_name)
		values (p_sub, nom)
		on conflict (id) do nothing;

		-- 3. Une appartenance par attente ; une appartenance existante garde son rôle.
		insert into public.workspace_members (workspace_id, user_id, role)
		select lie.workspace_id, p_sub, lie.role
		  from rows from (pg_catalog.unnest(espaces_lies), pg_catalog.unnest(roles_lies))
		       as lie (workspace_id, role)
		on conflict (workspace_id, user_id) do nothing;
	end if;

	select pg_catalog.count(*)::integer
	  into espaces
	  from public.workspace_members m
	 where m.user_id = p_sub;

	select p.full_name into nom_profil from public.profiles p where p.id = p_sub;

	return pg_catalog.jsonb_build_object(
		'admis', espaces > 0,
		'espaces', espaces,
		'rattachees', rattachees,
		'nom', nom_profil
	);
end;
$$;

alter function public.ouvrir_session_sso(uuid, text, text) owner to postgres;

revoke all on function public.ouvrir_session_sso(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ouvrir_session_sso(uuid, text, text) to service_role;

comment on function public.ouvrir_session_sso(uuid, text, text) is
	'CRM-092 — docs/SPEC-session-sso.md §6.2. Consomme les attentes, crée le profil, dit l''admission.';
