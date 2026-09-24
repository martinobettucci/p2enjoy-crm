-- @spec CRM-092 (docs/BACKLOG.md) — correctif INC-249 : l'admission patiente
-- @spec docs/SPEC-session-sso.md §6.2 (points 2 et 5), §7.6 (cette migration), §5.5 (`attente_administrateur`)
-- @spec docs/SPEC-identite.md §5 (la garde du dernier administrateur) ; docs/SCHEMA.md §1
-- @spec docs/JOURNAL.md décision 593 (arbitrage du responsable : patienter à la connexion)
-- @spec docs/INCONSISTENCY_REPORT.md INC-249
--
-- MESURÉ (INC-249, `CRM-092` T4) : la première appartenance d'un espace doit être administratrice, et la
-- garde `app.workspace_members_garder_admin` refuse toute autre. Or `ouvrir_session_sso` convertissait
-- TOUTES les attentes d'une adresse dans une seule transaction : une personne attendue comme lectrice
-- dans un espace encore vide faisait échouer toute sa connexion — autres espaces compris — en
-- `service_indisponible`.
--
-- ARBITRÉ (décision 593) : patienter. Une attente qui ferait de la personne le premier membre non
-- administrateur d'un espace sans administrateur reste EN SUSPENS, en place ; elle se consommera à une
-- connexion suivante, une fois un administrateur entré. Toutes les autres se consomment comme avant.
-- La garde n'est plus jamais sollicitée, et l'ordre d'arrivée des personnes ne compte plus. L'objet
-- rendu porte `en_suspens`, dont l'échangeur tire le motif `attente_administrateur`.
--
-- Signature, propriétaire, `search_path` et privilèges inchangés : les fonctions de session de `0076`,
-- qui l'appellent et rendent son objet tel quel, ne changent pas. Aucune donnée n'est modifiée.

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
	suspendues    integer;
	nom_profil    text;
begin
	if p_sub is null then
		raise exception 'sub_requis' using errcode = '22023';
	end if;
	if adresse !~ '^[^@[:space:]]+@[^@[:space:]]+$' then
		raise exception 'adresse_invalide' using errcode = '22023';
	end if;

	-- 1. Consommer les attentes de cette adresse, SAUF celles qui feraient de la personne le premier
	--    membre non administrateur d'un espace sans administrateur (décision 593). Un espace qui existe
	--    a toujours un administrateur (garde du dernier administrateur) : « sans administrateur »
	--    équivaut donc à « sans membre ». Une attente `admin`, ou dans un espace dont la personne est
	--    déjà membre, se consomme toujours.
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

	-- Ce qui reste à cette adresse est, par construction, en suspens.
	select pg_catalog.count(*)::integer
	  into suspendues
	  from public.workspace_invitations i
	 where i.email = adresse;

	-- 2. Créer le profil s'il manque, et seulement pour une personne rattachée. Un profil existant
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

		-- 3. Une appartenance par attente consommée ; une appartenance existante garde son rôle.
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
		'en_suspens', suspendues,
		'nom', nom_profil
	);
end;
$$;

alter function public.ouvrir_session_sso(uuid, text, text) owner to postgres;

revoke all on function public.ouvrir_session_sso(uuid, text, text) from public, anon, authenticated;
grant execute on function public.ouvrir_session_sso(uuid, text, text) to service_role;

comment on function public.ouvrir_session_sso(uuid, text, text) is
	'CRM-092 — docs/SPEC-session-sso.md §6.2. Consomme les attentes, sauf celles en suspens faute '
	'd''administrateur (INC-249, décision 593), crée le profil, dit l''admission.';
