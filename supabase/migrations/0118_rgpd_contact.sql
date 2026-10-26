-- @spec CRM-072 (docs/BACKLOG.md) — tranche T3 : le volet RGPD d'un contact, export et anonymisation
-- @spec docs/SPEC-audit.md §7 (réservé aux administrateurs ; §7.1 l'export versionné ; §7.2 l'anonymisation confirmée par
--       le nom, messages intacts — R1 option A ; le contact anonymisé ne se modifie plus ; §7.3 le journal sans nom),
--       §4.3 et §4.5 (les deux gestes journalisés) ; docs/SCHEMA.md « Migration `0118` » ; docs/PROD_MIGRATIONS.md §3 ;
--       docs/JOURNAL.md décisions 725, 726 et 732
--
-- DEUX FONCTIONS `SECURITY DEFINER`, GARDÉES À LA MAIN : un contact invisible à l'appelant — inconnu, ou d'un autre
-- espace — rend `P0002 contact_not_found`, sans dire qu'il existe ; un membre qui n'administre pas l'espace du contact
-- rend `42501 reserved_to_admins`. Ordinaire, rejouable.

alter table public.contacts add column if not exists anonymized_at timestamptz;

comment on column public.contacts.anonymized_at is
	'CRM-072 T3 — docs/SPEC-audit.md §7.2. Posée par anonymize_contact ; un contact anonymisé ne se modifie plus.';

-- =============================================================================================
-- 1. Un contact anonymisé ne se modifie plus — §7.2
-- =============================================================================================
-- Une exception, une seule : l'action `ON DELETE SET NULL (organization_id)` de la clé vers `organizations`, sans quoi
-- supprimer une organisation serait refusé dès qu'un de ses contacts est anonymisé. Le déclencheur s'exécute AVANT
-- `contacts_set_updated_at` (ordre alphabétique) : il compare la ligne telle que l'appelant l'écrit.

create or replace function app.contacts_refuse_after_anonymization()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if old.anonymized_at is null then
		return new;
	end if;
	if old.organization_id is not null and new.organization_id is null
	   and (pg_catalog.to_jsonb(new) - 'organization_id') = (pg_catalog.to_jsonb(old) - 'organization_id') then
		return new;
	end if;
	raise exception 'contact_anonymized'
		using errcode = 'P0001', detail = 'Un contact anonymisé ne se modifie plus : il reste supprimable.';
end;
$$;

alter function app.contacts_refuse_after_anonymization() owner to postgres;
revoke all on function app.contacts_refuse_after_anonymization() from public, anon, authenticated, service_role;

drop trigger if exists contacts_refuse_after_anonymization on public.contacts;
create trigger contacts_refuse_after_anonymization before update on public.contacts
	for each row execute function app.contacts_refuse_after_anonymization();

-- =============================================================================================
-- 2. La garde commune
-- =============================================================================================

create or replace function app.contact_rgpd_guard(p_contact uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	espace uuid;
begin
	select c.workspace_id into espace from public.contacts c where c.id = p_contact;
	if espace is null or not app.is_workspace_member(espace) then
		raise exception 'contact_not_found' using errcode = 'P0002';
	end if;
	if not app.is_workspace_admin(espace) then
		raise exception 'reserved_to_admins' using errcode = '42501';
	end if;
	return espace;
end;
$$;

alter function app.contact_rgpd_guard(uuid) owner to postgres;
revoke all on function app.contact_rgpd_guard(uuid) from public, anon, authenticated, service_role;

-- Une adresse de message désigne le contact : comparaison sans casse, adresse nue ou « Nom <adresse> ».
create or replace function app.address_matches(p_address text, p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
	select p_email is not null and p_address is not null
	   and (pg_catalog.lower(pg_catalog.btrim(p_address)) = pg_catalog.lower(p_email)
	        or pg_catalog.lower(p_address) like '%<' || pg_catalog.lower(p_email) || '>%')
$$;

alter function app.address_matches(text, text) owner to postgres;
revoke all on function app.address_matches(text, text) from public, anon, authenticated, service_role;

-- =============================================================================================
-- 3. L'export — §7.1
-- =============================================================================================

create or replace function public.export_contact(p_contact uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	espace uuid := app.contact_rgpd_guard(p_contact);
	c      public.contacts;
	resultat jsonb;
begin
	select * into c from public.contacts where id = p_contact;

	resultat := pg_catalog.jsonb_build_object(
		'format', 'p2enjoy-crm/contact-export/1',
		'exported_at', pg_catalog.now(),
		'workspace', (select pg_catalog.jsonb_build_object('id', w.id, 'name', w.name) from public.workspaces w where w.id = espace),
		'contact', pg_catalog.jsonb_build_object(
			'id', c.id, 'full_name', c.full_name, 'email', c.email, 'phone', c.phone, 'role_title', c.role_title,
			'source', c.source, 'created_at', c.created_at, 'updated_at', c.updated_at, 'anonymized_at', c.anonymized_at),
		'organization', (select pg_catalog.jsonb_build_object('id', o.id, 'name', o.name)
		                   from public.organizations o where o.id = c.organization_id),
		'cards', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
				'id', k.id, 'title', k.title, 'role', cc.role, 'linked_at', cc.created_at) order by cc.created_at)
			  from public.card_contacts cc join public.cards k on k.id = cc.card_id
			 where cc.contact_id = c.id), '[]'::jsonb),
		'activities', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
				'id', a.id, 'card_id', a.card_id, 'type', a.type, 'occurred_at', a.occurred_at,
				'subject', a.subject, 'body', a.body) order by a.occurred_at)
			  from public.card_activity_participants p join public.card_activities a on a.id = p.activity_id
			 where p.contact_id = c.id and a.deleted_at is null), '[]'::jsonb),
		'messages', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
				'id', m.id, 'card_id', m.card_id, 'direction', m.direction, 'sent_at', m.sent_at,
				'received_at', m.received_at, 'from_address', m.from_address, 'subject', m.subject,
				'body_text', m.body_text) order by coalesce(m.sent_at, m.received_at, m.created_at))
			  from public.mail_messages m
			 where m.workspace_id = espace and c.email is not null
			   and (app.address_matches(m.from_address, c.email)
			        or exists (select 1 from pg_catalog.unnest(
			                     coalesce(m.to_addresses, '{}') || coalesce(m.cc_addresses, '{}') || coalesce(m.bcc_addresses, '{}')) a
			                    where app.address_matches(a, c.email)))), '[]'::jsonb),
		'field_values', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('card_id', v.card_id, 'field_label', f.label)
			                            order by f.label)
			  from public.card_field_values v join public.form_fields f on f.id = v.field_id
			 where v.workspace_id = espace and f.type = 'contact' and (v.value #>> '{}') = c.id::text), '[]'::jsonb)
	);

	perform app.audit_record(espace, 'exported', 'contact', c.id, null, '{}'::jsonb);
	return resultat;
end;
$$;

-- =============================================================================================
-- 4. L'anonymisation — §7.2 (R1 option A : les messages ne sont pas touchés)
-- =============================================================================================

create or replace function public.anonymize_contact(p_contact uuid, p_confirmation text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	espace uuid := app.contact_rgpd_guard(p_contact);
	c      public.contacts;
begin
	select * into c from public.contacts where id = p_contact for update;
	if c.anonymized_at is not null then
		raise exception 'contact_anonymized' using errcode = 'P0001';
	end if;
	if p_confirmation is distinct from c.full_name then
		raise exception 'confirmation_mismatch' using errcode = '22023';
	end if;

	update public.contacts
	   set full_name = 'Contact anonymisé', email = null, phone = null, role_title = null, anonymized_at = pg_catalog.now()
	 where id = p_contact;

	perform app.audit_record(espace, 'anonymized', 'contact', p_contact, null, '{}'::jsonb);
end;
$$;

alter function public.export_contact(uuid) owner to postgres;
alter function public.anonymize_contact(uuid, text) owner to postgres;
revoke all on function public.export_contact(uuid) from public, anon, authenticated, service_role;
revoke all on function public.anonymize_contact(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.export_contact(uuid) to authenticated;
grant execute on function public.anonymize_contact(uuid, text) to authenticated;

notify pgrst, 'reload schema';
