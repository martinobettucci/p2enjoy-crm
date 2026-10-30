-- @spec CRM-071 (docs/BACKLOG.md) — tranche T5 : l'import CSV des contacts et des organisations
-- @spec docs/SPEC-vues-import-export.md §6.1 (simulation puis confirmation), §6.2 (doublons ignorés, organisation retrouvée
--       par domaine puis par nom, sinon créée, `source = import`), §6.2 bis (codes d'issue, organisation seule, journal,
--       bornes), §6.4, §6.5 ; docs/SPEC-audit.md §3 (la famille nouvelle `import`) ; docs/SCHEMA.md « Migration `0137` » ;
--       docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 774 à 776
--
-- CHAQUE LIGNE EST JUGÉE PAR LA BASE, SOUS LA RLS DE LA PERSONNE (`SECURITY INVOKER`), DANS SA PROPRE SOUS-TRANSACTION : une
-- ligne refusée ne crée rien, pas même son organisation. La simulation joue la même boucle puis annule tout : les mêmes
-- contraintes jugent, et rien ne reste. Les issues vivent dans une variable, que les annulations n'emportent pas.

-- =============================================================================================
-- 1. Le journal : la famille `import`
-- =============================================================================================

alter table public.audit_log drop constraint if exists audit_log_family_check;
alter table public.audit_log add constraint audit_log_family_check
	check (family in ('access', 'configuration', 'sign_in', 'export', 'deletion', 'retention', 'import'));
alter table public.audit_log drop constraint if exists audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
	check (action in ('added', 'role_changed', 'removed', 'created', 'granted', 'revoked', 'updated', 'archived', 'deleted',
	                  'published', 'trashed', 'restored', 'destroyed', 'anonymized', 'signed_in', 'exported', 'purged',
	                  'imported'));

create or replace function app.audit_family(p_entity_type text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
	select case
		when p_action = 'signed_in' then 'sign_in'
		when p_action = 'exported' then 'export'
		when p_action = 'imported' then 'import'
		when p_action = 'purged' then 'retention'
		when p_entity_type in ('member', 'invitation', 'track_access', 'channel_access') then 'access'
		when p_action in ('trashed', 'restored', 'destroyed', 'anonymized') then 'deletion'
		when p_entity_type in ('comment', 'activity', 'contact', 'organization') and p_action = 'deleted' then 'deletion'
		else 'configuration'
	end
$$;

create or replace function app.audit_import(p_workspace uuid, p_entity_type text, p_details jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if p_entity_type not in ('contact', 'card') then
		raise exception 'import_entity_unknown' using errcode = '22023';
	end if;
	if not app.is_workspace_member(p_workspace) then
		raise exception 'workspace_not_found' using errcode = 'P0002';
	end if;
	perform app.audit_record(p_workspace, 'imported', p_entity_type, null, null, coalesce(p_details, '{}'::jsonb));
end;
$$;

alter function app.audit_import(uuid, text, jsonb) owner to postgres;
revoke all on function app.audit_import(uuid, text, jsonb) from public, anon;
grant execute on function app.audit_import(uuid, text, jsonb) to authenticated, service_role;

-- =============================================================================================
-- 2. L'import des contacts et des organisations — §6.2, §6.2 bis, §6.5
-- =============================================================================================

create or replace function public.import_contacts(p_workspace uuid, p_rows jsonb, p_dry_run boolean default true)
returns table (
	line integer, outcome text, code text, contact_id uuid, organization_id uuid, organization_created boolean
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	v_issues     jsonb := '[]'::jsonb;
	v_ligne      jsonb;
	v_rang       integer := 0;
	v_nom        text;
	v_email      text;
	v_telephone  text;
	v_fonction   text;
	v_org_nom    text;
	v_org_dom    text;
	v_org_site   text;
	v_org        uuid;
	v_org_cree   boolean;
	v_contact    uuid;
	v_issue      text;
	v_code       text;
	v_contrainte text;
	v_crees      integer := 0;
	v_ignores    integer := 0;
	v_refuses    integer := 0;
	v_orgs       integer := 0;
begin
	if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
		raise exception 'invalid_rows' using errcode = '22023';
	end if;
	if pg_catalog.jsonb_array_length(p_rows) > 1000 then
		raise exception 'import_too_large' using errcode = '22023';
	end if;
	-- L'espace, lu sous la RLS de la personne : un espace dont elle n'est pas membre n'existe pas pour elle.
	if not exists (select 1 from public.workspaces w where w.id = p_workspace) then
		raise exception 'workspace_not_found' using errcode = 'P0002';
	end if;

	begin
		for v_ligne in select e.value from pg_catalog.jsonb_array_elements(p_rows) e loop
			v_rang := v_rang + 1;
			v_nom := nullif(pg_catalog.btrim(v_ligne ->> 'full_name'), '');
			v_email := nullif(pg_catalog.lower(pg_catalog.btrim(v_ligne ->> 'email')), '');
			v_telephone := nullif(pg_catalog.btrim(v_ligne ->> 'phone'), '');
			v_fonction := nullif(pg_catalog.btrim(v_ligne ->> 'role_title'), '');
			v_org_nom := nullif(pg_catalog.btrim(v_ligne ->> 'organization_name'), '');
			v_org_dom := nullif(pg_catalog.lower(pg_catalog.btrim(v_ligne ->> 'organization_domain')), '');
			v_org_site := nullif(pg_catalog.btrim(v_ligne ->> 'organization_website'), '');
			v_org := null;
			v_org_cree := false;
			v_contact := null;
			v_issue := 'created';
			v_code := null;
			begin
				if v_nom is null and v_org_nom is null then
					v_issue := 'refused';
					v_code := 'name_required';
				elsif v_nom is not null and v_email is not null and exists (
				      select 1 from public.contacts c where c.workspace_id = p_workspace and pg_catalog.lower(c.email) = v_email) then
					v_issue := 'skipped';
					v_code := 'duplicate_email';
				else
					-- L'organisation : par son domaine, puis par son nom sans casse ni blancs superflus, sinon créée.
					if v_org_dom is not null then
						select o.id into v_org from public.organizations o
						 where o.workspace_id = p_workspace and pg_catalog.lower(o.domain) = v_org_dom limit 1;
					end if;
					if v_org is null and v_org_nom is not null then
						select o.id into v_org from public.organizations o
						 where o.workspace_id = p_workspace
						   and pg_catalog.lower(pg_catalog.btrim(o.name)) = pg_catalog.lower(v_org_nom)
						 order by o.created_at, o.id limit 1;
					end if;
					if v_org is not null and v_nom is null then
						v_issue := 'skipped';
						v_code := 'duplicate_organization';
					else
						if v_org is null and v_org_nom is not null then
							insert into public.organizations (workspace_id, name, domain, website)
							values (p_workspace, v_org_nom, v_org_dom, v_org_site)
							returning id into v_org;
							v_org_cree := true;
						end if;
						if v_nom is not null then
							insert into public.contacts (workspace_id, organization_id, full_name, email, phone, role_title, source)
							values (p_workspace, v_org, v_nom, v_email, v_telephone, v_fonction, 'import')
							returning id into v_contact;
						end if;
					end if;
				end if;
			exception
				when check_violation or unique_violation then
					get stacked diagnostics v_contrainte = constraint_name;
					v_issue := case when v_contrainte like '%_key' then 'skipped' else 'refused' end;
					v_code := case
						when v_contrainte = 'contacts_email_check' then 'invalid_email'
						when v_contrainte = 'organizations_domain_check' then 'invalid_domain'
						when v_contrainte = 'organizations_website_check' then 'invalid_website'
						when v_contrainte = 'contacts_workspace_email_key' then 'duplicate_email'
						when v_contrainte = 'organizations_workspace_domain_key' then 'duplicate_organization'
						else 'unknown'
					end;
					v_org := null;
					v_org_cree := false;
					v_contact := null;
				when insufficient_privilege then
					v_issue := 'refused';
					v_code := 'forbidden';
					v_org := null;
					v_org_cree := false;
					v_contact := null;
				when others then
					v_issue := 'refused';
					v_code := 'unknown';
					v_org := null;
					v_org_cree := false;
					v_contact := null;
			end;
			if v_issue = 'created' then
				v_crees := v_crees + 1;
			elsif v_issue = 'skipped' then
				v_ignores := v_ignores + 1;
			else
				v_refuses := v_refuses + 1;
			end if;
			if v_org_cree then
				v_orgs := v_orgs + 1;
			end if;
			v_issues := v_issues || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
				'line', v_rang, 'outcome', v_issue, 'code', v_code, 'contact_id', v_contact, 'organization_id', v_org,
				'organization_created', v_org_cree));
		end loop;
		-- La simulation annule tout ce que la boucle a écrit ; ses issues restent dans la variable.
		if p_dry_run then
			raise exception 'dry_run' using errcode = 'ZZ071';
		end if;
	exception
		when sqlstate 'ZZ071' then
			null;
	end;

	if not p_dry_run then
		perform app.audit_import(p_workspace, 'contact', pg_catalog.jsonb_build_object(
			'created', v_crees, 'skipped', v_ignores, 'refused', v_refuses, 'organizations_created', v_orgs));
	end if;

	return query
	select r.line, r.outcome, r.code, r.contact_id, r.organization_id, r.organization_created
	  from pg_catalog.jsonb_to_recordset(v_issues) as r(
	       line integer, outcome text, code text, contact_id uuid, organization_id uuid, organization_created boolean)
	 order by r.line;
end;
$$;

revoke all on function public.import_contacts(uuid, jsonb, boolean) from public, anon;
grant execute on function public.import_contacts(uuid, jsonb, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
