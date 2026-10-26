-- @spec CRM-072 (docs/BACKLOG.md) — tranche T1 : le journal d'audit en base
-- @spec docs/SPEC-audit.md §3 (la table, qui lit, qui écrit, l'ajout seul tenu en base), §4 (les gestes journalisés),
--       §5 (ce que `details` contient), §6 (la rétention d'un an, journalisée) ; docs/SCHEMA.md « Migration `0115` » ;
--       docs/SPEC-permissions-rls.md §4 (ligne `audit_log`, refus n° 8) ; docs/PROD_MIGRATIONS.md §3 (migration 115) ;
--       docs/JOURNAL.md décisions 708 (point 5), 725 et 726
--
-- PERSONNE N'ÉCRIT LE JOURNAL, SAUF LA BASE. Les rôles applicatifs n'ont que `SELECT` ; l'unique écrivain,
-- `app.audit_record`, est `SECURITY DEFINER` et fermé à tous. Il est appelé par des déclencheurs posés sur les tables
-- sensibles : un geste fait à l'écran, par l'API ou par le connecteur MCP est journalisé de la même façon.
--
-- L'AJOUT SEUL EST TENU PAR DÉCLENCHEUR, sur les trois journaux (`audit_log`, `plateforme_journal`, `mcp_journal`), clé
-- de service et propriétaire compris, avec deux exceptions seulement : l'acteur mis à `null` par la suppression de son
-- profil, et la purge des entrées de plus d'un an (§3.4).
--
-- Ordinaire, rejouable : `create … if not exists`, `create or replace`, déclencheurs et contrainte reposés.

-- =============================================================================================
-- 1. La table
-- =============================================================================================

create table if not exists public.audit_log (
	id           bigint      generated always as identity primary key,
	workspace_id uuid        not null,
	actor_id     uuid        references public.profiles (id) on delete set null,
	family       text        not null,
	action       text        not null,
	entity_type  text        not null,
	entity_id    uuid,
	entity_label text,
	details      jsonb       not null default '{}'::jsonb,
	occurred_at  timestamptz not null default now(),
	constraint audit_log_family_check
		check (family in ('access', 'configuration', 'sign_in', 'export', 'deletion', 'retention')),
	constraint audit_log_action_check
		check (action in ('added', 'role_changed', 'removed', 'created', 'granted', 'revoked', 'updated', 'archived',
		                  'deleted', 'published', 'trashed', 'restored', 'destroyed', 'anonymized', 'signed_in',
		                  'exported', 'purged')),
	constraint audit_log_entity_type_check
		check (entity_type in ('member', 'invitation', 'track_access', 'channel_access', 'workspace', 'track', 'channel',
		                       'workflow', 'workflow_step', 'workflow_transition', 'workflow_node', 'form_field',
		                       'form_field_rule', 'mail_account', 'mail_identity', 'card', 'comment', 'activity',
		                       'contact', 'organization', 'session', 'audit_log')),
	-- §7.3 : le journal ne garde jamais le nom d'un contact.
	constraint audit_log_contact_sans_libelle check (entity_type <> 'contact' or entity_label is null)
);

create index if not exists audit_log_workspace_recents on public.audit_log (workspace_id, id desc);
create index if not exists audit_log_occurred_at on public.audit_log (occurred_at);

comment on table public.audit_log is
	'CRM-072 — docs/SPEC-audit.md §3. Gestes sensibles d''un espace, en ajout seul, conservés un an. Lus par les '
	'administrateurs de l''espace ; écrits par app.audit_record seul.';

-- =============================================================================================
-- 2. Qui lit — §3.2
-- =============================================================================================

alter table public.audit_log enable row level security;

drop policy if exists audit_log_select_admin on public.audit_log;
create policy audit_log_select_admin on public.audit_log
	for select to authenticated
	using (app.is_workspace_admin(workspace_id));

-- `docs/SCHEMA.md` §9 : un `revoke … from public` ne suffit pas, les privilèges par défaut de l'image les accordent
-- NOMMÉMENT. `service_role` garde la lecture (la RLS ne la borne pas), jamais l'écriture.
revoke all on table public.audit_log from public, anon, authenticated, service_role;
grant select on table public.audit_log to authenticated, service_role;

-- =============================================================================================
-- 3. L'ajout seul, sur les trois journaux — §3.4
-- =============================================================================================
-- Arguments : TG_ARGV[0] la colonne de date, TG_ARGV[1] la colonne d'acteur (chaîne vide s'il n'y en a pas).

create or replace function app.journal_refuse_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if tg_op = 'TRUNCATE' then
		raise exception 'audit_log_immutable'
			using errcode = 'P0001', detail = 'Un journal ne se vide pas : il est purgé entrée par entrée, après un an.';
	end if;

	if tg_op = 'UPDATE' then
		-- Exception 1 : l'action `ON DELETE SET NULL` de la clé étrangère vers `profiles`, et elle seule.
		if tg_argv[1] <> ''
		   and (pg_catalog.to_jsonb(old) ->> tg_argv[1]) is not null
		   and (pg_catalog.to_jsonb(new) ->> tg_argv[1]) is null
		   and (pg_catalog.to_jsonb(new) - tg_argv[1]) = (pg_catalog.to_jsonb(old) - tg_argv[1]) then
			return new;
		end if;
		raise exception 'audit_log_immutable'
			using errcode = 'P0001', detail = 'Une entrée de journal est définitive : elle ne se modifie pas.';
	end if;

	-- Exception 2 : la purge, qui pose `app.audit_purge`, et seulement pour une entrée de plus d'un an.
	if coalesce(pg_catalog.current_setting('app.audit_purge', true), '') = 'on'
	   and (pg_catalog.to_jsonb(old) ->> tg_argv[0])::timestamptz < pg_catalog.now() - interval '1 year' then
		return old;
	end if;
	raise exception 'audit_log_immutable'
		using errcode = 'P0001', detail = 'Une entrée de journal ne se supprime pas avant un an, et seulement par la purge.';
end;
$$;

alter function app.journal_refuse_change() owner to postgres;
revoke all on function app.journal_refuse_change() from public, anon, authenticated, service_role;

drop trigger if exists audit_log_refuse_change on public.audit_log;
create trigger audit_log_refuse_change before update or delete on public.audit_log
	for each row execute function app.journal_refuse_change('occurred_at', 'actor_id');
drop trigger if exists audit_log_refuse_truncate on public.audit_log;
create trigger audit_log_refuse_truncate before truncate on public.audit_log
	for each statement execute function app.journal_refuse_change('occurred_at', 'actor_id');

drop trigger if exists plateforme_journal_refuse_change on public.plateforme_journal;
create trigger plateforme_journal_refuse_change before update or delete on public.plateforme_journal
	for each row execute function app.journal_refuse_change('cree_le', 'acteur');
drop trigger if exists plateforme_journal_refuse_truncate on public.plateforme_journal;
create trigger plateforme_journal_refuse_truncate before truncate on public.plateforme_journal
	for each statement execute function app.journal_refuse_change('cree_le', 'acteur');

drop trigger if exists mcp_journal_refuse_change on public.mcp_journal;
create trigger mcp_journal_refuse_change before update or delete on public.mcp_journal
	for each row execute function app.journal_refuse_change('cree_le', '');
drop trigger if exists mcp_journal_refuse_truncate on public.mcp_journal;
create trigger mcp_journal_refuse_truncate before truncate on public.mcp_journal
	for each statement execute function app.journal_refuse_change('cree_le', '');

-- §6.2 : le geste nouveau de la plateforme, en anglais (décision 658) ; l'existant reste recensé par INC-286.
alter table public.plateforme_journal drop constraint if exists plateforme_journal_geste_check;
alter table public.plateforme_journal add constraint plateforme_journal_geste_check
	check (geste in ('superadmin_amorce', 'superadmin_accorde', 'superadmin_retire', 'espace_cree', 'espace_modifie',
	                 'espace_supprime', 'membre_pose', 'membre_retire', 'attente_inscrite', 'attente_retiree',
	                 'mcp_droits_poses', 'logs_purged'));

-- =============================================================================================
-- 4. L'écrivain — §3.3
-- =============================================================================================

-- La famille se déduit de l'action et de l'objet (§4) : elle n'est jamais choisie par l'appelant.
create or replace function app.audit_family(p_entity_type text, p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
	select case
		when p_action = 'signed_in' then 'sign_in'
		when p_action = 'exported' then 'export'
		when p_action = 'purged' then 'retention'
		when p_entity_type in ('member', 'invitation', 'track_access', 'channel_access') then 'access'
		when p_action in ('trashed', 'restored', 'destroyed', 'anonymized') then 'deletion'
		when p_entity_type in ('comment', 'activity', 'contact', 'organization') and p_action = 'deleted' then 'deletion'
		else 'configuration'
	end
$$;

create or replace function app.audit_record(
	p_workspace uuid, p_action text, p_entity_type text, p_entity_id uuid, p_entity_label text,
	p_details jsonb default '{}'::jsonb, p_actor uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	acteur uuid;
begin
	-- §6.3 : rien pour un espace qui n'existe plus — une suppression d'espace en cascade n'écrit rien.
	if p_workspace is null or not exists (select 1 from public.workspaces w where w.id = p_workspace) then
		return;
	end if;
	-- Un acteur sans profil (clé de service, jeton d'un compte technique) est le système : la clé étrangère ne doit
	-- jamais faire échouer le geste qu'on journalise.
	select p.id into acteur from public.profiles p where p.id = coalesce(p_actor, auth.uid());
	insert into public.audit_log (workspace_id, actor_id, family, action, entity_type, entity_id, entity_label, details)
	values (p_workspace, acteur, app.audit_family(p_entity_type, p_action), p_action, p_entity_type, p_entity_id,
	        case when p_entity_type = 'contact' then null else p_entity_label end,
	        coalesce(p_details, '{}'::jsonb));
end;
$$;

alter function app.audit_family(text, text) owner to postgres;
alter function app.audit_record(uuid, text, text, uuid, text, jsonb, uuid) owner to postgres;
revoke all on function app.audit_family(text, text) from public, anon, authenticated, service_role;
revoke all on function app.audit_record(uuid, text, text, uuid, text, jsonb, uuid)
	from public, anon, authenticated, service_role;

-- Le nom d'une personne, pour `entity_label`.
create or replace function app.audit_profile_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select p.full_name from public.profiles p where p.id = p_user
$$;
alter function app.audit_profile_name(uuid) owner to postgres;
revoke all on function app.audit_profile_name(uuid) from public, anon, authenticated, service_role;

-- =============================================================================================
-- 5. Droits et appartenances — §4.1
-- =============================================================================================

create or replace function app.audit_workspace_members()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		perform app.audit_record(new.workspace_id, 'added', 'member', new.user_id, app.audit_profile_name(new.user_id),
			pg_catalog.jsonb_build_object('user_id', new.user_id, 'role', new.role));
	elsif tg_op = 'UPDATE' then
		if new.role is distinct from old.role then
			perform app.audit_record(new.workspace_id, 'role_changed', 'member', new.user_id,
				app.audit_profile_name(new.user_id),
				pg_catalog.jsonb_build_object('user_id', new.user_id, 'before', old.role, 'after', new.role));
		end if;
	else
		perform app.audit_record(old.workspace_id, 'removed', 'member', old.user_id, app.audit_profile_name(old.user_id),
			pg_catalog.jsonb_build_object('user_id', old.user_id, 'role', old.role));
	end if;
	return null;
end;
$$;

create or replace function app.audit_workspace_invitations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		perform app.audit_record(new.workspace_id, 'created', 'invitation', null, new.email,
			pg_catalog.jsonb_build_object('email', new.email, 'role', new.role));
	elsif tg_op = 'UPDATE' then
		-- Un remplacement (même adresse, nouveau rôle ou nouvelle inscription) est une invitation posée.
		if new.role is distinct from old.role or new.created_at is distinct from old.created_at then
			perform app.audit_record(new.workspace_id, 'created', 'invitation', null, new.email,
				pg_catalog.jsonb_build_object('email', new.email, 'role', new.role));
		end if;
	else
		perform app.audit_record(old.workspace_id, 'removed', 'invitation', null, old.email,
			pg_catalog.jsonb_build_object('email', old.email, 'role', old.role));
	end if;
	return null;
end;
$$;

-- `track_members` et `channel_members` n'ont pas de `workspace_id` : il est lu sur le parent. Quand le parent est
-- détruit, la cascade retire les accès après lui, la lecture ne trouve rien, et rien n'est écrit — la destruction du
-- parent est, elle, journalisée (§4.3). TG_ARGV[0] : 'track' ou 'channel'.
create or replace function app.audit_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ligne     jsonb := pg_catalog.to_jsonb(case when tg_op = 'DELETE' then old else new end);
	avant     jsonb := case when tg_op = 'INSERT' then null else pg_catalog.to_jsonb(old) end;
	cle       text  := tg_argv[0] || '_id';
	parent    uuid  := (ligne ->> cle)::uuid;
	personne  uuid  := (ligne ->> 'user_id')::uuid;
	espace    uuid;
	objet     text  := tg_argv[0] || '_access';
begin
	if tg_argv[0] = 'track' then
		select t.workspace_id into espace from public.tracks t where t.id = parent;
	else
		select c.workspace_id into espace from public.channels c where c.id = parent;
	end if;

	if tg_op = 'DELETE' then
		perform app.audit_record(espace, 'revoked', objet, personne, app.audit_profile_name(personne),
			pg_catalog.jsonb_build_object('user_id', personne, cle, parent, 'access', ligne ->> 'access'));
	elsif tg_op = 'INSERT' or (avant ->> 'access') is distinct from (ligne ->> 'access') then
		perform app.audit_record(espace, 'granted', objet, personne, app.audit_profile_name(personne),
			pg_catalog.jsonb_build_object('user_id', personne, cle, parent,
				'before', avant ->> 'access', 'after', ligne ->> 'access'));
	end if;
	return null;
end;
$$;

drop trigger if exists workspace_members_audit on public.workspace_members;
create trigger workspace_members_audit after insert or update or delete on public.workspace_members
	for each row execute function app.audit_workspace_members();
drop trigger if exists workspace_invitations_audit on public.workspace_invitations;
create trigger workspace_invitations_audit after insert or update or delete on public.workspace_invitations
	for each row execute function app.audit_workspace_invitations();
drop trigger if exists track_members_audit on public.track_members;
create trigger track_members_audit after insert or update or delete on public.track_members
	for each row execute function app.audit_access('track');
drop trigger if exists channel_members_audit on public.channel_members;
create trigger channel_members_audit after insert or update or delete on public.channel_members
	for each row execute function app.audit_access('channel');

-- =============================================================================================
-- 6. Configuration — §4.2, §5
-- =============================================================================================
-- Arguments : TG_ARGV[0] l'objet (`entity_type`), TG_ARGV[1] la colonne du libellé, TG_ARGV[2…] les colonnes de
-- configuration surveillées. Une mise à jour qui ne change aucune d'elles (`position`, `updated_at`, l'état d'une
-- synchronisation) n'écrit rien.

create or replace function app.audit_configuration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ligne    jsonb := pg_catalog.to_jsonb(case when tg_op = 'DELETE' then old else new end);
	avant    jsonb := case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) else null end;
	objet    text  := tg_argv[0];
	espace   uuid  := (case when objet = 'workspace' then ligne ->> 'id' else ligne ->> 'workspace_id' end)::uuid;
	libelle  text  := ligne ->> tg_argv[1];
	changees text[] := '{}';
	valeurs_avant jsonb := '{}'::jsonb;
	valeurs_apres jsonb := '{}'::jsonb;
	details  jsonb := '{}'::jsonb;
	geste    text;
	colonne  text;
	i        integer;
	-- §5 : les seules valeurs recopiées, courtes et sans secret. Les autres colonnes changées ne sont que nommées.
	courtes  constant text[] := array['name', 'slug', 'label', 'label_override', 'key', 'kind', 'type', 'workflow_id',
		'inbound_domain', 'visibility', 'require_comment', 'probability_override', 'stale_after_days',
		'default_probability', 'default_stale_after_days', 'is_initial', 'from_step_id', 'to_step_id', 'node_id',
		'color', 'is_default', 'daily_quota', 'imap_host', 'imap_port', 'imap_security', 'smtp_host', 'smtp_port',
		'smtp_security', 'from_address'];
begin
	if objet = 'workflow_step' and libelle is null then
		select n.label into libelle from public.workflow_nodes_catalog n where n.id = (ligne ->> 'node_id')::uuid;
	end if;

	if tg_op = 'INSERT' then
		geste := 'created';
	elsif tg_op = 'DELETE' then
		geste := 'deleted';
	else
		for i in 2 .. tg_nargs - 1 loop
			colonne := tg_argv[i];
			if (avant -> colonne) is distinct from (ligne -> colonne) then
				changees := changees || colonne;
				if colonne = any (courtes) then
					valeurs_avant := valeurs_avant || pg_catalog.jsonb_build_object(colonne, avant -> colonne);
					valeurs_apres := valeurs_apres || pg_catalog.jsonb_build_object(colonne, ligne -> colonne);
				end if;
			end if;
		end loop;
		if pg_catalog.cardinality(changees) = 0 then
			return null;
		end if;
		geste := case
			when 'archived_at' = any (changees) and (ligne ->> 'archived_at') is not null
			     and objet in ('workflow', 'form_field', 'workflow_node') then 'archived'
			else 'updated'
		end;
		details := pg_catalog.jsonb_build_object('changed',
			(select pg_catalog.jsonb_agg(c order by c) from pg_catalog.unnest(changees) c));
		if valeurs_avant <> '{}'::jsonb then
			details := details || pg_catalog.jsonb_build_object('before', valeurs_avant, 'after', valeurs_apres);
		end if;
		-- `settings` : les CLÉS changées, jamais leurs valeurs (§5).
		if 'settings' = any (changees) then
			details := details || pg_catalog.jsonb_build_object('settings_keys', (
				select coalesce(pg_catalog.jsonb_agg(k order by k), '[]'::jsonb)
				  from (
					select k from pg_catalog.jsonb_object_keys(coalesce(avant -> 'settings', '{}'::jsonb)) k
					union
					select k from pg_catalog.jsonb_object_keys(coalesce(ligne -> 'settings', '{}'::jsonb)) k
				  ) toutes
				 where (avant -> 'settings' -> k) is distinct from (ligne -> 'settings' -> k)));
		end if;
	end if;

	perform app.audit_record(espace, geste, objet, (ligne ->> 'id')::uuid, libelle, details);
	return null;
end;
$$;

-- `form_field_rules` n'a pas d'`id` : l'objet est le champ, désigné par `field_id`.
create or replace function app.audit_form_field_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	r       record;
	libelle text;
	geste   text;
begin
	if tg_op = 'DELETE' then r := old; geste := 'deleted';
	elsif tg_op = 'INSERT' then r := new; geste := 'created';
	else
		if new.visibility is not distinct from old.visibility then
			return null;
		end if;
		r := new; geste := 'updated';
	end if;
	select f.label into libelle from public.form_fields f where f.id = r.field_id;
	perform app.audit_record(r.workspace_id, geste, 'form_field_rule', r.field_id, libelle,
		pg_catalog.jsonb_build_object('field_id', r.field_id, 'step_id', r.step_id, 'visibility',
			case when tg_op = 'DELETE' then null else r.visibility end));
	return null;
end;
$$;

-- Une exigence de transition ajoutée ou retirée modifie la transition. Sans `workspace_id`, il est lu sur la
-- transition ; détruite avec elle en cascade, rien n'est écrit.
create or replace function app.audit_transition_required_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	r       record;
	espace  uuid;
	libelle text;
begin
	r := case when tg_op = 'DELETE' then old else new end;
	select t.workspace_id, t.label into espace, libelle from public.workflow_transitions t where t.id = r.transition_id;
	perform app.audit_record(espace, 'updated', 'workflow_transition', r.transition_id, libelle,
		pg_catalog.jsonb_build_object(
			case when tg_op = 'DELETE' then 'required_field_removed' else 'required_field_added' end, r.field_id));
	return null;
end;
$$;

-- La publication d'une version de workflow (CRM-078).
create or replace function app.audit_workflow_versions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	libelle text;
begin
	select w.name into libelle from public.workflows w where w.id = new.workflow_id;
	perform app.audit_record(new.workspace_id, 'published', 'workflow', new.workflow_id, libelle,
		pg_catalog.jsonb_build_object('version_number', new.version_number));
	return null;
end;
$$;

drop trigger if exists workspaces_audit on public.workspaces;
create trigger workspaces_audit after update on public.workspaces
	for each row execute function app.audit_configuration('workspace', 'name', 'name', 'inbound_domain', 'settings');
drop trigger if exists tracks_audit_configuration on public.tracks;
create trigger tracks_audit_configuration after insert or update on public.tracks
	for each row execute function app.audit_configuration('track', 'name', 'name', 'slug');
drop trigger if exists channels_audit_configuration on public.channels;
create trigger channels_audit_configuration after insert or update on public.channels
	for each row execute function app.audit_configuration('channel', 'name', 'name', 'slug', 'workflow_id');
drop trigger if exists workflows_audit on public.workflows;
create trigger workflows_audit after insert or update or delete on public.workflows
	for each row execute function app.audit_configuration('workflow', 'name', 'name', 'archived_at');
drop trigger if exists workflow_versions_audit on public.workflow_versions;
create trigger workflow_versions_audit after insert on public.workflow_versions
	for each row execute function app.audit_workflow_versions();
drop trigger if exists workflow_steps_audit on public.workflow_steps;
create trigger workflow_steps_audit after insert or update or delete on public.workflow_steps
	for each row execute function app.audit_configuration('workflow_step', 'label_override',
		'node_id', 'label_override', 'probability_override', 'stale_after_days', 'is_initial');
drop trigger if exists workflow_transitions_audit on public.workflow_transitions;
create trigger workflow_transitions_audit after insert or update or delete on public.workflow_transitions
	for each row execute function app.audit_configuration('workflow_transition', 'label',
		'from_step_id', 'to_step_id', 'label', 'require_comment');
drop trigger if exists workflow_transition_required_fields_audit on public.workflow_transition_required_fields;
create trigger workflow_transition_required_fields_audit after insert or delete
	on public.workflow_transition_required_fields
	for each row execute function app.audit_transition_required_fields();
drop trigger if exists workflow_nodes_catalog_audit on public.workflow_nodes_catalog;
create trigger workflow_nodes_catalog_audit after insert or update or delete on public.workflow_nodes_catalog
	for each row execute function app.audit_configuration('workflow_node', 'label',
		'key', 'label', 'kind', 'color', 'default_probability', 'default_stale_after_days', 'archived_at');
drop trigger if exists form_fields_audit on public.form_fields;
create trigger form_fields_audit after insert or update or delete on public.form_fields
	for each row execute function app.audit_configuration('form_field', 'label',
		'key', 'label', 'type', 'options', 'help_text', 'archived_at');
drop trigger if exists form_field_rules_audit on public.form_field_rules;
create trigger form_field_rules_audit after insert or update or delete on public.form_field_rules
	for each row execute function app.audit_form_field_rules();
drop trigger if exists mail_inbound_accounts_audit on public.mail_inbound_accounts;
create trigger mail_inbound_accounts_audit after insert or update or delete on public.mail_inbound_accounts
	for each row execute function app.audit_configuration('mail_account', 'label',
		'label', 'imap_host', 'imap_port', 'imap_security', 'imap_username', 'secret_id', 'watch_folders',
		'folder_style', 'backfill_months');
drop trigger if exists mail_outbound_identities_audit on public.mail_outbound_identities;
create trigger mail_outbound_identities_audit after insert or update or delete on public.mail_outbound_identities
	for each row execute function app.audit_configuration('mail_identity', 'label',
		'label', 'smtp_host', 'smtp_port', 'smtp_security', 'smtp_username', 'secret_id', 'from_address', 'from_name',
		'signature_text', 'is_default', 'daily_quota');

-- =============================================================================================
-- 7. Effacements et corbeille — §4.3
-- =============================================================================================
-- Arguments : TG_ARGV[0] l'objet, TG_ARGV[1] la colonne du libellé (chaîne vide : aucun libellé, un contenu ou une
-- personne extérieure).

create or replace function app.audit_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ligne   jsonb := pg_catalog.to_jsonb(case when tg_op = 'DELETE' then old else new end);
	objet   text  := tg_argv[0];
	libelle text  := case when tg_argv[1] = '' then null else ligne ->> tg_argv[1] end;
	details jsonb := case when ligne ? 'card_id' then pg_catalog.jsonb_build_object('card_id', ligne -> 'card_id')
	                      else '{}'::jsonb end;
	geste   text;
begin
	if tg_op = 'DELETE' then
		geste := case when objet in ('card', 'track', 'channel') then 'destroyed' else 'deleted' end;
	elsif (old.deleted_at is null) and (new.deleted_at is not null) then
		geste := case when objet in ('comment', 'activity') then 'deleted' else 'trashed' end;
	elsif (old.deleted_at is not null) and (new.deleted_at is null) and objet in ('card', 'track', 'channel') then
		geste := 'restored';
	else
		return null;
	end if;
	perform app.audit_record((ligne ->> 'workspace_id')::uuid, geste, objet, (ligne ->> 'id')::uuid, libelle, details);
	return null;
end;
$$;

drop trigger if exists cards_audit_deletion on public.cards;
create trigger cards_audit_deletion after update of deleted_at or delete on public.cards
	for each row execute function app.audit_deletion('card', 'title');
drop trigger if exists tracks_audit_deletion on public.tracks;
create trigger tracks_audit_deletion after update of deleted_at or delete on public.tracks
	for each row execute function app.audit_deletion('track', 'name');
drop trigger if exists channels_audit_deletion on public.channels;
create trigger channels_audit_deletion after update of deleted_at or delete on public.channels
	for each row execute function app.audit_deletion('channel', 'name');
drop trigger if exists card_comments_audit_deletion on public.card_comments;
create trigger card_comments_audit_deletion after update of deleted_at on public.card_comments
	for each row execute function app.audit_deletion('comment', '');
drop trigger if exists card_activities_audit_deletion on public.card_activities;
create trigger card_activities_audit_deletion after update of deleted_at on public.card_activities
	for each row execute function app.audit_deletion('activity', '');
drop trigger if exists contacts_audit_deletion on public.contacts;
create trigger contacts_audit_deletion after delete on public.contacts
	for each row execute function app.audit_deletion('contact', '');
drop trigger if exists organizations_audit_deletion on public.organizations;
create trigger organizations_audit_deletion after delete on public.organizations
	for each row execute function app.audit_deletion('organization', 'name');

-- =============================================================================================
-- 8. Connexions — §4.4
-- =============================================================================================
-- Une connexion admise est inscrite dans chaque espace dont la personne est membre ; l'acteur est la personne, pas
-- l'échangeur qui appelle avec la clé de service.

create or replace function app.audit_sessions_sso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	espace uuid;
	nom    text := app.audit_profile_name(new.sub);
begin
	for espace in select m.workspace_id from public.workspace_members m where m.user_id = new.sub loop
		perform app.audit_record(espace, 'signed_in', 'session', new.id, nom, '{}'::jsonb, new.sub);
	end loop;
	return null;
end;
$$;

drop trigger if exists sessions_sso_audit on public.sessions_sso;
create trigger sessions_sso_audit after insert on public.sessions_sso
	for each row execute function app.audit_sessions_sso();

do $$
declare
	f text;
begin
	foreach f in array array['app.audit_workspace_members()', 'app.audit_workspace_invitations()', 'app.audit_access()',
		'app.audit_configuration()', 'app.audit_form_field_rules()', 'app.audit_transition_required_fields()',
		'app.audit_workflow_versions()', 'app.audit_deletion()', 'app.audit_sessions_sso()'] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated, service_role', f);
	end loop;
end;
$$;

-- =============================================================================================
-- 9. La rétention — §6
-- =============================================================================================

create or replace function app.purge_audit_logs()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	avant      timestamptz := pg_catalog.now() - interval '1 year';
	total      integer := 0;
	plateforme integer;
	connecteur integer;
	r          record;
begin
	perform pg_catalog.set_config('app.audit_purge', 'on', true);

	for r in
		with purgees as (
			delete from public.audit_log l where l.occurred_at < avant returning l.workspace_id
		)
		select p.workspace_id, pg_catalog.count(*)::integer as nombre from purgees p group by p.workspace_id
	loop
		perform app.audit_record(r.workspace_id, 'purged', 'audit_log', null, null,
			pg_catalog.jsonb_build_object('count', r.nombre, 'before', avant));
		total := total + r.nombre;
	end loop;

	with purgees as (delete from public.plateforme_journal j where j.cree_le < avant returning 1)
	select pg_catalog.count(*)::integer into plateforme from purgees;
	with purgees as (delete from public.mcp_journal j where j.cree_le < avant returning 1)
	select pg_catalog.count(*)::integer into connecteur from purgees;
	if plateforme + connecteur > 0 then
		insert into public.plateforme_journal (acteur, geste, cible)
		values (null, 'logs_purged',
		        pg_catalog.jsonb_build_object('platform', plateforme, 'connector', connecteur, 'before', avant));
	end if;

	perform pg_catalog.set_config('app.audit_purge', 'off', true);
	return total + plateforme + connecteur;
end;
$$;

alter function app.purge_audit_logs() owner to postgres;
revoke all on function app.purge_audit_logs() from public, anon, authenticated, service_role;

comment on function app.purge_audit_logs() is
	'CRM-072 — docs/SPEC-audit.md §6. Efface les entrées de plus d''un an des trois journaux et journalise l''effacement ; '
	'rend le nombre d''entrées effacées. Appelée chaque jour par pg_cron (p2enjoy-purge-journaux).';

-- Minute 17 de 3 h : aucune tâche ne la dispute — 7 (heartbeat), 23 (relances), 41 (séquences), 53 (refus d'admission) ;
-- `verify-armement-sequences.sh` exige des minutes distinctes. Un nom stable fait converger `cron.schedule`.
do $$
declare
	job_id bigint;
begin
	select cron.schedule('p2enjoy-purge-journaux', '17 3 * * *', 'select app.purge_audit_logs();') into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

notify pgrst, 'reload schema';
