-- @spec CRM-114 (docs/BACKLOG.md) — tranche T1 : la neuvième famille du connecteur MCP, `organizations`, dans les quatre
--       listes fermées (docs/SPEC-organisations.md §5 ; docs/SPEC-mcp.md §6.1, §6.3, §8.2 ; docs/JOURNAL.md décisions 659,
--       660 et 663 ; nom anglais, décision 658 règle 8)
--
-- La liste des familles est fermée à quatre endroits — la contrainte `mcp_droits_famille`, `public.mcp_autorise`,
-- `public.mcp_compte` et `public.mcp_poser_droits` — que `0095` a étendus pour `recettes`. `organizations` vient après
-- `contacts` : l'ordre des tableaux est celui de la matrice de l'onglet « Connecteur MCP ». Les quatre définitions sont
-- reprises de `0095` À L'IDENTIQUE, la liste seule changeant ; `create or replace` garde les privilèges et les commentaires.
-- Aucune table, aucune politique, aucune donnée ne change : la table `organizations` et ses politiques existent depuis `0045`.
--
-- Retour arrière : réappliquer la section 8 de `0095` (les quatre listes sans `organizations`), après avoir retiré les
-- droits de cette famille : `delete from public.mcp_droits where famille = 'organizations'`.

alter table public.mcp_droits drop constraint if exists mcp_droits_famille;
alter table public.mcp_droits add  constraint mcp_droits_famille
	check (famille in ('structure', 'affaires', 'contacts', 'organizations', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie'));

create or replace function public.mcp_autorise(p_ws uuid, p_famille text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_famille is null or p_famille not in ('structure', 'affaires', 'contacts', 'organizations', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie') then
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

create or replace function public.mcp_compte(p_sub uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	familles constant text[] := array['structure', 'affaires', 'contacts', 'organizations', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie'];
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

create or replace function public.mcp_poser_droits(p_sub uuid, p_ws uuid, p_droits jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	familles constant text[] := array['structure', 'affaires', 'contacts', 'organizations', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie'];
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
