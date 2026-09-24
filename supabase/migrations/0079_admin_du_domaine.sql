-- @spec CRM-092 (docs/BACKLOG.md) — tranche T8 : la règle du domaine sur `admin`
-- @spec docs/SPEC-session-sso.md §6.1 bis (la règle et ses huit points), §7.7 (cette migration),
--       §5.4 (la revendication `lelabs_admin` du jeton interne) ; docs/SSO.md « Les deux règles du
--       domaine » ; docs/SPEC-permissions-rls.md §3 (fonctions d'appartenance) ; docs/SCHEMA.md §1
-- @spec docs/JOURNAL.md décision 597 (arbitrage : porté par le jeton, tous les espaces)
--
-- LA RÈGLE DU DOMAINE `lelabs.tech` : qui porte le rôle de realm `admin` reçoit D'OFFICE les droits
-- d'administration de l'application, et les perd dès que le rôle lui est retiré. Le CRM l'ignorait
-- délibérément (décision 579, A3) ; la règle ne laisse pas le choix, et la décision 597 la met en
-- œuvre SANS RIEN ÉCRIRE EN BASE : l'échangeur de session pose `lelabs_admin: true` dans le jeton
-- interne, qui vit 300 s au plus, et les fonctions d'appartenance le consultent. Le retrait du rôle
-- agit donc à la prolongation suivante, et il n'y a aucune ligne à défaire.
--
-- Ce que cette migration fait, et rien d'autre :
--   1. `app.est_admin_lelabs()` lit la revendication ;
--   2. `app.is_workspace_member`, `app.is_workspace_admin`, `app.workspace_role` et
--      `app.workspace_role_pour` — pour l'appelant seulement — la consultent : le porteur est membre
--      et administrateur de TOUT espace existant, droits fins de lecture compris ;
--   3. `public.ouvrir_session_sso` admet le porteur sans appartenance ni attente, et crée son profil ;
--      les deux fonctions de session serveur transmettent le drapeau ;
--   4. `public.mon_role_espace(ws)` rend à l'interface le rôle que la base applique.
--
-- LES ANCIENNES SIGNATURES SONT RETIRÉES ICI, ET LE RUNNER LES RECRÉE À CHAQUE PASSAGE : `0075`, `0076`
-- et `0078` les redéfinissent avant que cette migration ne les retire de nouveau. L'état final d'un
-- passage est donc toujours celui-ci. Le nouveau paramètre porte `default false` : un appel à
-- l'ancienne arité — les suites existantes, l'échangeur d'avant T8 — se résout sur la nouvelle
-- fonction, au comportement inchangé pour qui n'est pas `admin`. Aucune donnée n'est modifiée.

-- =============================================================================================
-- 1. La revendication
-- =============================================================================================

-- VRAI SI ET SEULEMENT SI la revendication vaut exactement le booléen JSON `true`. Une valeur mal
-- formée — une chaîne, un nombre — ne lève pas : elle rend faux. Seul l'échangeur signe le jeton
-- interne (`JWT_SECRET`), et la clé anonyme ne porte pas cette revendication.
create or replace function app.est_admin_lelabs()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce((select auth.jwt()) -> 'lelabs_admin' = 'true'::jsonb, false);
$$;

-- =============================================================================================
-- 2. Les trois fonctions d'appartenance
-- =============================================================================================

create or replace function app.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.workspace_members m
		 where m.workspace_id = ws
		   and m.user_id = (select auth.uid())
	)
	or (
		(select app.est_admin_lelabs())
		and exists (select 1 from public.workspaces w where w.id = ws)
	);
$$;

create or replace function app.is_workspace_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		  from public.workspace_members m
		 where m.workspace_id = ws
		   and m.user_id = (select auth.uid())
		   and m.role = 'admin'
	)
	or (
		(select app.est_admin_lelabs())
		and exists (select 1 from public.workspaces w where w.id = ws)
	);
$$;

-- LE RÔLE D'UNE PERSONNE DANS UN ESPACE. La revendication ne dit rien que de l'APPELANT : elle ne
-- s'applique que si `p_user` est lui, et un tiers reste jugé sur ses seules appartenances
-- (§6.1 bis, point 6). Pour l'appelant, elle l'emporte sur une appartenance moindre : un lecteur qui
-- porte `admin` chez LeLabs est administrateur.
--
-- MESURÉ avant d'écrire ce paragraphe : les droits fins de lecture d'un channel et d'une affaire
-- passent par `app.resolve_channel_access_pour(…, auth.uid())`, donc par cette fonction et non par
-- `app.workspace_role` ; laissée intacte, l'exploitante lisait l'espace et ses tracks, et chaque
-- fiche d'affaire lui rendait « Card introuvable ». `0063` en est l'auteur ; elle est redéfinie ici.
create or replace function app.workspace_role_pour(ws uuid, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select case
		when p_user = (select auth.uid())
		     and (select app.est_admin_lelabs())
		     and exists (select 1 from public.workspaces w where w.id = ws)
		then 'admin'
		else (
			select m.role
			  from public.workspace_members m
			 where m.workspace_id = ws
			   and m.user_id = p_user
		)
	end;
$$;

create or replace function app.workspace_role(ws uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select app.workspace_role_pour(ws, (select auth.uid()));
$$;

-- =============================================================================================
-- 3. L'admission du porteur
-- =============================================================================================

drop function if exists public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz);
drop function if exists public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz);
drop function if exists public.ouvrir_session_sso(uuid, text, text);

-- Le corps est celui de `0078`, à deux différences près, et elles sont toutes deux le §6.1 bis :
-- le porteur est ADMIS sans appartenance ni attente, et son profil est créé — il signe ce qu'il
-- écrit. `espaces` compte alors les espaces qu'il administre : tous. L'objet rendu garde ses clés.
create or replace function public.ouvrir_session_sso(
	p_sub uuid, p_email text, p_nom text, p_admin_lelabs boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	adresse       text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
	porteur_admin boolean := coalesce(p_admin_lelabs, false);
	nom           text;
	espaces_lies  uuid[];
	roles_lies    text[];
	rattachees    integer;
	espaces       integer;
	suspendues    integer;
	nom_profil    text;
begin
	if p_sub is null then
		raise exception 'sub_requis' using errcode = '22023';
	end if;
	if adresse !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
		raise exception 'adresse_invalide' using errcode = '22023';
	end if;

	-- 1. Consommer les attentes, sauf celles en suspens faute d'administrateur (décision 593).
	with consommees as (
		delete from public.workspace_invitations i
		 where i.email = adresse
		   and (
		        i.role = 'admin'
		     or exists (select 1 from public.workspace_members m
		                 where m.workspace_id = i.workspace_id and m.role = 'admin')
		     or exists (select 1 from public.workspace_members m
		                 where m.workspace_id = i.workspace_id and m.user_id = p_sub)
		   )
		returning i.workspace_id, i.role
	)
	select coalesce(pg_catalog.array_agg(c.workspace_id order by c.workspace_id), '{}'),
	       coalesce(pg_catalog.array_agg(c.role order by c.workspace_id), '{}')
	  into espaces_lies, roles_lies
	  from consommees c;
	rattachees := pg_catalog.cardinality(espaces_lies);

	select pg_catalog.count(*)::integer
	  into suspendues
	  from public.workspace_invitations i
	 where i.email = adresse;

	-- 2. Le profil : pour une personne rattachée, ET pour le porteur d'`admin` (§6.1 bis, point 3).
	if rattachees > 0 or porteur_admin then
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
	end if;

	-- 3. Une appartenance par attente consommée ; une appartenance existante garde son rôle.
	if rattachees > 0 then
		insert into public.workspace_members (workspace_id, user_id, role)
		select lie.workspace_id, p_sub, lie.role
		  from rows from (pg_catalog.unnest(espaces_lies), pg_catalog.unnest(roles_lies))
		       as lie (workspace_id, role)
		on conflict (workspace_id, user_id) do nothing;
	end if;

	if porteur_admin then
		select pg_catalog.count(*)::integer into espaces from public.workspaces w;
	else
		select pg_catalog.count(*)::integer
		  into espaces
		  from public.workspace_members m
		 where m.user_id = p_sub;
	end if;

	select p.full_name into nom_profil from public.profiles p where p.id = p_sub;

	return pg_catalog.jsonb_build_object(
		'admis', porteur_admin or espaces > 0,
		'espaces', espaces,
		'rattachees', rattachees,
		'en_suspens', suspendues,
		'nom', nom_profil
	);
end;
$$;

-- Les deux fonctions de session serveur de `0076`, au drapeau près, qu'elles transmettent.
create or replace function public.ouvrir_session_serveur(
	p_sub uuid, p_email text, p_nom text,
	p_empreinte bytea, p_rafraichissement text, p_expire_le timestamptz,
	p_admin_lelabs boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	admission jsonb;
begin
	admission := public.ouvrir_session_sso(p_sub, p_email, p_nom, p_admin_lelabs);
	if (admission ->> 'admis')::boolean then
		insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
		values (p_sub, p_empreinte, p_rafraichissement, p_expire_le);
	end if;
	return admission;
end;
$$;

-- L'admission est rejouée EN ENTIER, drapeau compris : un `admin` retiré chez LeLabs n'admet plus
-- par le rôle au renouvellement suivant, et la personne reste admise par ses appartenances ou perd
-- sa session (§6.1 bis, point 5).
create or replace function public.renouveler_session_serveur(
	p_empreinte bytea, p_sub uuid, p_email text, p_nom text,
	p_rafraichissement text, p_expire_le timestamptz,
	p_admin_lelabs boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	admission jsonb;
begin
	if not exists (
		select 1 from public.sessions_sso s
		 where s.poignee_empreinte = p_empreinte and s.sub = p_sub
	) then
		return pg_catalog.jsonb_build_object('admis', false, 'session', false);
	end if;

	admission := public.ouvrir_session_sso(p_sub, p_email, p_nom, p_admin_lelabs);
	if (admission ->> 'admis')::boolean then
		update public.sessions_sso s
		   set rafraichissement = p_rafraichissement,
		       expire_le = p_expire_le,
		       renouvele_le = pg_catalog.now()
		 where s.poignee_empreinte = p_empreinte;
	else
		delete from public.sessions_sso s where s.poignee_empreinte = p_empreinte;
	end if;
	return admission || pg_catalog.jsonb_build_object('session', true);
end;
$$;

-- =============================================================================================
-- 4. Le rôle que l'interface lit
-- =============================================================================================

-- `SECURITY INVOKER` : elle ne rend que ce que `app.workspace_role` rend à l'appelant. Sans elle,
-- `webapp/src/lib/roles.ts` lisait `workspace_members`, où le porteur d'`admin` n'a aucune ligne, et
-- les aides d'écran de l'administrateur lui manquaient alors que la base les lui accorde.
create or replace function public.mon_role_espace(ws uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
	select app.workspace_role(ws);
$$;

-- =============================================================================================
-- 5. Propriétaires et privilèges
-- =============================================================================================

alter function app.est_admin_lelabs() owner to postgres;
alter function public.ouvrir_session_sso(uuid, text, text, boolean) owner to postgres;
alter function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean) owner to postgres;
alter function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean) owner to postgres;
alter function public.mon_role_espace(uuid) owner to postgres;

revoke all on function app.est_admin_lelabs() from public;
grant execute on function app.est_admin_lelabs() to anon, authenticated, service_role;

revoke all on function public.ouvrir_session_sso(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.ouvrir_session_sso(uuid, text, text, boolean) to service_role;
grant execute on function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean) to service_role;
grant execute on function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean) to service_role;

revoke all on function public.mon_role_espace(uuid) from public, anon;
grant execute on function public.mon_role_espace(uuid) to authenticated;

comment on function app.est_admin_lelabs() is
	'CRM-092 T8 — docs/SPEC-session-sso.md §6.1 bis. Vrai si le jeton interne porte lelabs_admin: true (rôle de realm admin, décision 597).';
comment on function public.ouvrir_session_sso(uuid, text, text, boolean) is
	'CRM-092 — docs/SPEC-session-sso.md §6.2, §6.1 bis. Consomme les attentes (sauf en suspens), crée le profil, dit l''admission ; le porteur d''admin du realm est admis d''office.';
comment on function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz, boolean) is
	'CRM-092 — docs/SPEC-session-sso.md §7.4, §7.7. Admission, puis session serveur si la personne est admise.';
comment on function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz, boolean) is
	'CRM-092 — docs/SPEC-session-sso.md §7.4, §7.7. Admission rejouée, drapeau admin compris ; admise, jeton remplacé ; sinon session supprimée.';
comment on function public.mon_role_espace(uuid) is
	'CRM-092 T8 — docs/SPEC-session-sso.md §6.1 bis, point 7. Le rôle que la base applique à l''appelant dans l''espace.';

notify pgrst, 'reload schema';
