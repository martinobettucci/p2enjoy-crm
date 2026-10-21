-- @spec CRM-103 (docs/BACKLOG.md) — tranche T1 : l'administration du connecteur MCP, en base
-- @spec docs/SPEC-mcp.md §8.2 (contrat exact des quatre RPC, précisé avant le code), §6.1 (familles et actions), §7.1
--       (registre) ; docs/SCHEMA.md §10 ; docs/SPEC-plateforme.md §6 (forme des fonctions, garde), §6.1 (dictionnaire des
--       refus) ; docs/PROD_MIGRATIONS.md §2.14 ; docs/JOURNAL.md décision 627 (A3, A5, D9 et la précision de T1)
--
-- CE QUE CETTE MIGRATION FAIT, ET DANS QUEL ORDRE.
--   1. D9 — LE DROIT VISE LE PROFIL. Les droits d'un `sub` sans profil sont retirés, et leur nombre écrit par
--      `raise notice` ; puis la clé `mcp_droits_sub_fkey` passe de `mcp_comptes` à `profiles`, en cascade. Un droit se
--      pose ainsi avant la première connexion au connecteur (A5), et un droit sans profil, qui serait sans effet sous la
--      RLS (A2), n'existe plus. `mcp_etat_compte` et `mcp_autorise` ne changent pas : elles lisent `mcp_droits` par `sub`.
--   2. Les quatre fonctions d'administration, toutes de la forme de `0089` : `SECURITY DEFINER`, `search_path` vide,
--      gardées EN PREMIER par `app.exiger_superadmin()`, exécutables par `authenticated` seul, révoquées nommément à
--      `public` et `anon`. Seule `mcp_poser_droits` écrit, et elle journalise `mcp_droits_poses` à `plateforme_journal`
--      (geste déjà admis par la contrainte de `0089`).
--
-- Ordinaire, idempotente. Retrait (docs/PROD_MIGRATIONS.md §3.2) : `drop function` des quatre fonctions, puis la clé
-- reposée vers `mcp_comptes (sub)` après le retrait des droits d'un profil jamais venu au connecteur.

-- =============================================================================================
-- 1. La bascule de la clé (D9)
-- =============================================================================================

do $$
declare
	retires integer;
begin
	delete from public.mcp_droits d where not exists (select 1 from public.profiles p where p.id = d.sub);
	get diagnostics retires = row_count;
	raise notice 'mcp_droits : % droit(s) d''un compte sans profil retiré(s) avant la bascule de la clé (D9)', retires;
end;
$$;

alter table public.mcp_droits drop constraint if exists mcp_droits_sub_fkey;
alter table public.mcp_droits
	add constraint mcp_droits_sub_fkey foreign key (sub) references public.profiles (id) on delete cascade;

-- =============================================================================================
-- 2. Les fonctions d'administration
-- =============================================================================================

-- Les comptes VENUS au connecteur, la dernière activité d'abord. Le drapeau est celui EN BASE : le rôle `admin` LeLabs ne
-- se lit que dans un jeton.
create or replace function public.mcp_comptes_liste(p_limite integer default 200)
returns table (
	sub                uuid,
	nom                text,
	email              text,
	premiere_connexion timestamptz,
	derniere_activite  timestamptz,
	espaces_ouverts    integer,
	superadmin         boolean,
	avec_profil        boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	return query
	select c.sub, coalesce(p.full_name, c.nom), c.email, c.premiere_connexion, c.derniere_activite,
	       (select pg_catalog.count(distinct d.workspace_id)::integer from public.mcp_droits d where d.sub = c.sub),
	       exists (select 1 from public.superadmins s where s.sub = c.sub),
	       p.id is not null
	  from public.mcp_comptes c
	  left join public.profiles p on p.id = c.sub
	 order by c.derniere_activite desc, c.sub
	 limit least(greatest(coalesce(p_limite, 200), 1), 200);
end;
$$;

-- La fiche d'un utilisateur, venu ou non au connecteur (A5) : tous les espaces, le rôle d'appartenance ou `null`, et la
-- matrice de chacun dans l'ordre des familles puis des actions du §6.1.
create or replace function public.mcp_compte(p_sub uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	familles constant text[] := array['structure', 'affaires', 'contacts', 'budgets', 'temps', 'objectifs', 'messagerie'];
	actions  constant text[] := array['consulter', 'ajouter', 'modifier', 'supprimer'];
	profil   public.profiles%rowtype;
	compte   public.mcp_comptes%rowtype;
begin
	perform app.exiger_superadmin();
	select * into profil from public.profiles p where p.id = p_sub;
	select * into compte from public.mcp_comptes c where c.sub = p_sub;
	if profil.id is null and compte.sub is null then
		raise exception 'profil_introuvable' using errcode = 'P0002';
	end if;
	return pg_catalog.jsonb_build_object(
		'sub', p_sub,
		'nom', coalesce(profil.full_name, compte.nom),
		'email', compte.email,
		'avec_profil', profil.id is not null,
		'connecte', compte.sub is not null,
		'premiere_connexion', compte.premiere_connexion,
		'derniere_activite', compte.derniere_activite,
		'superadmin', exists (select 1 from public.superadmins s where s.sub = p_sub),
		'espaces', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
			         'workspace_id', w.id,
			         'slug', w.slug,
			         'nom', w.name,
			         'role', (select m.role from public.workspace_members m where m.workspace_id = w.id and m.user_id = p_sub),
			         'droits', coalesce((
			           select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(d.famille, d.action)
			                    order by pg_catalog.array_position(familles, d.famille),
			                             pg_catalog.array_position(actions, d.action))
			             from public.mcp_droits d
			            where d.sub = p_sub and d.workspace_id = w.id), '[]'::jsonb))
			       order by w.name, w.slug)
			  from public.workspaces w), '[]'::jsonb));
end;
$$;

-- REMPLACE la matrice d'un espace. Un profil est exigé (D9). Les couples inchangés gardent leur auteur et leur date ; un
-- remplacement à l'identique n'écrit et ne journalise rien.
create or replace function public.mcp_poser_droits(p_sub uuid, p_ws uuid, p_droits jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	familles constant text[] := array['structure', 'affaires', 'contacts', 'budgets', 'temps', 'objectifs', 'messagerie'];
	actions  constant text[] := array['consulter', 'ajouter', 'modifier', 'supprimer'];
	couple   jsonb;
	avant    jsonb;
	apres    jsonb;
begin
	perform app.exiger_superadmin();
	if p_sub is null or not exists (select 1 from public.profiles p where p.id = p_sub) then
		raise exception 'profil_introuvable' using errcode = 'P0002';
	end if;
	perform app.plateforme_espace_existe(p_ws);
	if p_droits is null or pg_catalog.jsonb_typeof(p_droits) <> 'array' then
		raise exception 'droit_invalide' using errcode = '22023';
	end if;
	for couple in select e.value from pg_catalog.jsonb_array_elements(p_droits) e loop
		if pg_catalog.jsonb_typeof(couple) <> 'array' or pg_catalog.jsonb_array_length(couple) <> 2
		   or pg_catalog.jsonb_typeof(couple -> 0) <> 'string' or pg_catalog.jsonb_typeof(couple -> 1) <> 'string'
		   or not ((couple ->> 0) = any (familles)) or not ((couple ->> 1) = any (actions)) then
			raise exception 'droit_invalide' using errcode = '22023';
		end if;
	end loop;

	select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(d.famille, d.action)
	                  order by pg_catalog.array_position(familles, d.famille), pg_catalog.array_position(actions, d.action)),
	                '[]'::jsonb)
	  into avant
	  from public.mcp_droits d where d.sub = p_sub and d.workspace_id = p_ws;
	select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x.famille, x.action)
	                  order by pg_catalog.array_position(familles, x.famille), pg_catalog.array_position(actions, x.action)),
	                '[]'::jsonb)
	  into apres
	  from (select distinct e.value ->> 0 as famille, e.value ->> 1 as action
	          from pg_catalog.jsonb_array_elements(p_droits) e) x;
	if avant = apres then
		return;
	end if;

	delete from public.mcp_droits d
	 where d.sub = p_sub and d.workspace_id = p_ws
	   and not exists (select 1 from pg_catalog.jsonb_array_elements(p_droits) e
	                    where e.value ->> 0 = d.famille and e.value ->> 1 = d.action);
	insert into public.mcp_droits (sub, workspace_id, famille, action, accorde_par)
	select distinct p_sub, p_ws, e.value ->> 0, e.value ->> 1, (select auth.uid())
	  from pg_catalog.jsonb_array_elements(p_droits) e
	on conflict (sub, workspace_id, famille, action) do nothing;

	perform app.journaliser_plateforme('mcp_droits_poses', p_ws, pg_catalog.jsonb_build_object(
		'nom', app.plateforme_nom_profil(p_sub),
		'espace', app.plateforme_nom_espace(p_ws),
		'avant', avant,
		'apres', apres));
end;
$$;

-- Le journal des appels, le plus récent d'abord, curseur exclusif. Une issue inconnue est refusée : une liste vide se
-- lirait comme « aucun appel ».
create or replace function public.mcp_journal_liste(
	p_sub uuid default null, p_issue text default null, p_avant bigint default null, p_limite integer default 50
)
returns table (
	id           bigint,
	sub          uuid,
	nom          text,
	outil        text,
	workspace_id uuid,
	espace_nom   text,
	issue        text,
	duree_ms     integer,
	cree_le      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	if p_issue is not null and p_issue not in ('ok', 'refus_matrice', 'refus_crm', 'erreur', 'trop_volumineux') then
		raise exception 'issue_invalide' using errcode = '22023';
	end if;
	return query
	select j.id, j.sub, coalesce(p.full_name, c.nom), j.outil, j.workspace_id, w.name, j.issue, j.duree_ms, j.cree_le
	  from public.mcp_journal j
	  left join public.profiles p on p.id = j.sub
	  left join public.mcp_comptes c on c.sub = j.sub
	  left join public.workspaces w on w.id = j.workspace_id
	 where (p_sub is null or j.sub = p_sub)
	   and (p_issue is null or j.issue = p_issue)
	   and (p_avant is null or j.id < p_avant)
	 order by j.id desc
	 limit least(greatest(coalesce(p_limite, 50), 1), 200);
end;
$$;

do $$
declare
	f text;
begin
	foreach f in array array[
		'public.mcp_comptes_liste(integer)',
		'public.mcp_compte(uuid)',
		'public.mcp_poser_droits(uuid, uuid, jsonb)',
		'public.mcp_journal_liste(uuid, text, bigint, integer)'
	] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', f);
		execute pg_catalog.format('grant execute on function %s to authenticated', f);
	end loop;
end;
$$;
