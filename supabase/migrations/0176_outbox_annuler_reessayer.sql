-- @spec CRM-144 (docs/BACKLOG.md) — tranche T1 : l'outbox — annuler un envoi en file, réessayer un échec, l'adresse
--       d'expédition gardée sur l'envoi, l'événement `mail_cancelled`, la purge qui épargne un échec ; et INC-354, la
--       branche du quota de `reserver_envois` qualifiée (docs/INCONSISTENCY_REPORT.md)
-- @spec docs/SPEC-mail-subsystem.md §28.2 à §28.5, §28.9 ; docs/SCHEMA.md « Migration `0176` » ; docs/JOURNAL.md
--       décisions 898 et 906
--
-- LA COURSE CONTRE LA PASSE D'ENVOI EST TENUE ICI, ET NULLE PART AILLEURS (§28.5). `reserver_envois` choisit ses lignes
-- `for update of o skip locked` sur `status = 'queued'` ; l'annulation est une mise à jour CONDITIONNELLE sur ce même état,
-- qui prend le même verrou de ligne. Une seule des deux transitions — `queued` → `cancelled`, `queued` → `sending` — peut
-- réussir. Aucune fonction de `mail-sync` n'est modifiée.

-- =============================================================================================
-- 1. L'adresse d'expédition, gardée sur l'envoi (§28.2)
-- =============================================================================================
--
-- La RLS de `mail_outbound_identities` ne rend une identité qu'à son propriétaire et aux administrateurs : une collègue ne
-- lirait pas l'adresse sous laquelle un envoi part. L'envoi la porte donc, telle qu'elle était à la mise en file.

alter table public.mail_outbox add column if not exists from_address text;

comment on column public.mail_outbox.from_address is
	'CRM-144 : l''adresse d''expédition au moment de la mise en file, posée par le déclencheur '
	'`mail_outbox_adresse_expedition` depuis `mail_outbound_identities`. docs/SPEC-mail-subsystem.md §28.2.';

create or replace function app.mail_outbox_adresse_expedition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.from_address is null then
		select i.from_address into new.from_address
		  from public.mail_outbound_identities i
		 where i.id = new.identity_id;
	end if;
	return new;
end;
$$;

comment on function app.mail_outbox_adresse_expedition() is
	'CRM-144 : pose `mail_outbox.from_address` depuis l''identité d''expédition. docs/SPEC-mail-subsystem.md §28.2.';

drop trigger if exists mail_outbox_adresse_expedition on public.mail_outbox;
create trigger mail_outbox_adresse_expedition
	before insert on public.mail_outbox
	for each row execute function app.mail_outbox_adresse_expedition();

-- LA REPRISE des lignes existantes : l'adresse actuelle de leur identité, la seule connue.
update public.mail_outbox o
   set from_address = i.from_address
  from public.mail_outbound_identities i
 where i.id = o.identity_id
   and o.from_address is null;

-- =============================================================================================
-- 2. L'annulation, datée et signée (§28.3)
-- =============================================================================================

alter table public.mail_outbox add column if not exists cancelled_at timestamptz;
alter table public.mail_outbox add column if not exists cancelled_by uuid references public.profiles (id) on delete set null;

comment on column public.mail_outbox.cancelled_at is
	'CRM-144 : l''instant de l''annulation, posé par `cancel_outbound_email`. docs/SPEC-mail-subsystem.md §28.3.';
comment on column public.mail_outbox.cancelled_by is
	'CRM-144 : qui a annulé ; `on delete set null`. docs/SPEC-mail-subsystem.md §28.3.';

-- =============================================================================================
-- 3. Le type d'événement `mail_cancelled` (décision 906, Q2)
-- =============================================================================================
--
-- Reprise de la contrainte de `0148` à l'identique, plus `mail_cancelled`. Hors rattachement, comme `mail_sent` : la
-- contrainte `card_events_placement_by_type` ne le nomme pas, et elle n'est pas touchée.

alter table public.card_events drop constraint if exists card_events_type_check;
alter table public.card_events add constraint card_events_type_check
	check (type = any (array[
		'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived', 'trashed',
		'restored', 'field_changed', 'mail_received', 'mail_sent', 'mail_unclassified', 'snoozed', 'woken', 'stalled',
		'contact_linked', 'contact_unlinked', 'contact_role_changed', 'checklist_checked', 'checklist_unchecked',
		'label_added', 'label_removed', 'attached', 'detached', 'mail_cancelled'
	]));

-- =============================================================================================
-- 4. Qui exerce les gestes — `app.outbox_gestes_permis` (décision 906, Q1)
-- =============================================================================================

create or replace function app.outbox_gestes_permis(p_envoi public.mail_outbox)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select (select auth.uid()) is not null
	   and p_envoi.card_id is not null
	   and (p_envoi.created_by = (select auth.uid()) or app.is_workspace_admin(p_envoi.workspace_id))
	   and app.can_write_card(p_envoi.card_id);
$$;

comment on function app.outbox_gestes_permis(public.mail_outbox) is
	'CRM-144 : vrai si l''appelant peut annuler ou réessayer cet envoi — son auteur ou un administrateur de l''espace, '
	'qui écrit l''affaire (décision 906, Q1). docs/SPEC-mail-subsystem.md §28.3, §28.6.';

-- LA COLONNE CALCULÉE DE L'ÉCRAN ET DU CONNECTEUR : PostgREST l'expose comme `outbox_gestes_permis` sur `mail_outbox`.
create or replace function public.outbox_gestes_permis(p_envoi public.mail_outbox)
returns boolean
language sql
stable
set search_path = ''
as $$
	select app.outbox_gestes_permis(p_envoi);
$$;

comment on function public.outbox_gestes_permis(public.mail_outbox) is
	'CRM-144 : colonne calculée de `mail_outbox` — l''appelant peut-il annuler ou réessayer cet envoi. Une aide d''écran : '
	'les deux fonctions refusent de toute façon. docs/SPEC-mail-subsystem.md §28.6.';

revoke all on function app.outbox_gestes_permis(public.mail_outbox) from public, anon;
grant execute on function app.outbox_gestes_permis(public.mail_outbox) to authenticated;
revoke all on function public.outbox_gestes_permis(public.mail_outbox) from public, anon;
grant execute on function public.outbox_gestes_permis(public.mail_outbox) to authenticated;

-- =============================================================================================
-- 5. Le refus d'un état, nommé (§28.3, §28.4)
-- =============================================================================================

create or replace function app.outbox_refuser_etat(p_status text, p_last_error text)
returns void
language plpgsql
set search_path = ''
as $$
begin
	if p_status = 'queued' and p_last_error = 'worker_interrompu' then
		perform app.raise_http_error(409, 'outbox_uncertain');
	end if;
	perform app.raise_http_error(409, 'outbox_' || p_status);
end;
$$;

comment on function app.outbox_refuser_etat(text, text) is
	'CRM-144 : lève le refus 409 qui nomme l''état d''un envoi — `outbox_queued`, `outbox_sending`, `outbox_sent`, '
	'`outbox_failed`, `outbox_cancelled`, ou `outbox_uncertain`. docs/SPEC-mail-subsystem.md §28.3, §28.4.';

-- =============================================================================================
-- 6. Annuler — `public.cancel_outbound_email` (§28.3)
-- =============================================================================================

create or replace function public.cancel_outbound_email(p_outbox_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_envoi    public.mail_outbox%rowtype;
	v_date     timestamptz;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_envoi from public.mail_outbox o where o.id = p_outbox_id;
	-- L'ABSENCE ET L'INTERDIT NE SE DISTINGUENT PAS : un envoi d'une affaire illisible, ou le récapitulatif quotidien.
	if v_envoi.id is null or v_envoi.card_id is null or not app.can_read_card(v_envoi.card_id) then
		perform app.raise_http_error(404, 'outbox_not_found');
	end if;
	if not app.outbox_gestes_permis(v_envoi) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- LA TRANSITION CONDITIONNELLE, sous le verrou de ligne : `reserver_envois` ne peut pas l'avoir prise entre-temps
	-- (§28.5). Un envoi à l'issue incertaine n'est jamais annulé (décision 906, Q3).
	update public.mail_outbox o
	   set status = 'cancelled', cancelled_at = now(), cancelled_by = v_appelant
	 where o.id = p_outbox_id
	   and o.status = 'queued'
	   and o.last_error is distinct from 'worker_interrompu'
	returning o.cancelled_at into v_date;

	if v_date is null then
		select * into v_envoi from public.mail_outbox o where o.id = p_outbox_id;
		perform app.outbox_refuser_etat(v_envoi.status, v_envoi.last_error);
	end if;

	perform app.card_event_ecrire(
		v_envoi.card_id,
		v_envoi.workspace_id,
		'mail_cancelled',
		jsonb_build_object('outbox_id', p_outbox_id, 'subject', v_envoi.subject)
	);
	return v_date;
end;
$$;

comment on function public.cancel_outbound_email(uuid) is
	'CRM-144 : annule un envoi en file — l''auteur ou un administrateur qui écrit l''affaire. Refus : not_authenticated, '
	'outbox_not_found (404), forbidden, outbox_sending, outbox_sent, outbox_failed, outbox_cancelled, outbox_uncertain '
	'(409). Écrit `mail_cancelled` au fil. docs/SPEC-mail-subsystem.md §28.3, §28.5.';

revoke all on function public.cancel_outbound_email(uuid) from public, anon;
grant execute on function public.cancel_outbound_email(uuid) to authenticated;

-- =============================================================================================
-- 7. Réessayer — `public.retry_outbound_email` (§28.4)
-- =============================================================================================

create or replace function public.retry_outbound_email(p_outbox_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_envoi    public.mail_outbox%rowtype;
	v_quota    integer;
	v_retour   uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_envoi from public.mail_outbox o where o.id = p_outbox_id;
	if v_envoi.id is null or v_envoi.card_id is null or not app.can_read_card(v_envoi.card_id) then
		perform app.raise_http_error(404, 'outbox_not_found');
	end if;
	if not app.outbox_gestes_permis(v_envoi) then
		raise exception 'forbidden' using errcode = '42501';
	end if;
	if v_envoi.status <> 'failed' then
		perform app.outbox_refuser_etat(v_envoi.status, null);
	end if;

	-- LES GARDES DE LA MISE EN FILE (§19.4), relues pour l'affaire et l'identité de l'envoi.
	if not exists (
		select 1
		  from public.cards c
		  join public.workspaces w on w.id = c.workspace_id
		 where c.id = v_envoi.card_id
		   and c.deleted_at is null
		   and c.email_local_part is not null
		   and app.card_has_active_placement(c.id)
	) then
		raise exception 'card_not_available' using errcode = '23514';
	end if;
	select i.daily_quota into v_quota from public.mail_outbound_identities i where i.id = v_envoi.identity_id;
	if v_quota is not null and app.envois_du_jour(v_envoi.identity_id) >= v_quota then
		raise exception 'quota_exceeded' using errcode = '23505';
	end if;

	update public.mail_outbox o
	   set status = 'queued', next_attempt_at = now(), last_error = null, reserved_at = null
	 where o.id = p_outbox_id
	   and o.status = 'failed'
	returning o.id into v_retour;

	if v_retour is null then
		select * into v_envoi from public.mail_outbox o where o.id = p_outbox_id;
		perform app.outbox_refuser_etat(v_envoi.status, null);
	end if;
	return v_retour;
end;
$$;

comment on function public.retry_outbound_email(uuid) is
	'CRM-144 : remet en file un envoi en échec, sous la même identité — l''auteur ou un administrateur qui écrit '
	'l''affaire. Refus : not_authenticated, outbox_not_found (404), forbidden, outbox_queued, outbox_sending, outbox_sent, '
	'outbox_cancelled (409), card_not_available, quota_exceeded. docs/SPEC-mail-subsystem.md §28.4.';

revoke all on function public.retry_outbound_email(uuid) from public, anon;
grant execute on function public.retry_outbound_email(uuid) to authenticated;

-- =============================================================================================
-- 8. La purge épargne les pièces d'un échec (§28.4)
-- =============================================================================================
--
-- Reprise de la `0173` à l'identique, avec un ajout : un envoi `failed` garde ses objets, sans quoi un nouvel essai après
-- vingt-quatre heures échouerait en `attachment_missing`. Ceux d'un envoi `cancelled` redeviennent purgeables.

create or replace function public.depots_envoi_abandonnes(p_age interval default interval '24 hours')
returns table (name text)
language sql
security definer
set search_path = ''
stable
as $$
	select o.name
	  from storage.objects o
	 where o.bucket_id = 'mail-outbound-attachments'
	   and o.created_at < now() - p_age
	   and not exists (
		select 1
		  from public.mail_outbox b, jsonb_array_elements(b.attachments) p
		 where p ->> 'path' = o.name
		   and b.status in ('queued', 'sending', 'failed')
	)
	   and not exists (
		select 1
		  from public.mail_drafts d, jsonb_array_elements(d.attachments) p
		 where p ->> 'path' = o.name
		   and d.status = 'pending'
	)
	 order by o.created_at;
$$;

-- =============================================================================================
-- 9. INC-354 — la branche du quota de `reserver_envois`, qualifiée
-- =============================================================================================
--
-- Reprise de la `0133` à l'identique, la seule mise à jour du quota qualifiée : depuis que la fonction rend `attempts`, la
-- référence nue était ambiguë, et un envoi échu sur une identité au quota atteint faisait échouer la passe ENTIÈRE — plus
-- aucun envoi de l'espace ne partait (docs/INCONSISTENCY_REPORT.md INC-354 ; docs/SPEC-mail-subsystem.md §19.4).

create or replace function public.reserver_envois(p_limite integer DEFAULT 10)
 RETURNS TABLE(outbox_id uuid, card_id uuid, identity_id uuid, from_address text, reply_to text, to_addrs text[], cc_addrs text[], subject text, body_text text, in_reply_to text, references_ids text[], smtp_host text, smtp_port integer, smtp_security text, smtp_username text, attempts integer, bcc_addrs text[], attachments jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_ligne record;
begin
	for v_ligne in
		select o.*, i.daily_quota
		  from public.mail_outbox o
		  join public.mail_outbound_identities i on i.id = o.identity_id
		 where o.status = 'queued'
		   and o.next_attempt_at <= now()
		 order by o.created_at
		 limit greatest(p_limite, 0)
		 for update of o skip locked
	loop
		if v_ligne.daily_quota is not null
			and app.envois_du_jour(v_ligne.identity_id) > v_ligne.daily_quota then
			-- INC-354 : `attempts` désigne aussi la colonne rendue par la fonction (`0133`) ; qualifiée, la mise à jour
			-- n'est plus ambiguë, et un quota dépassé ne fait plus échouer la passe entière.
			update public.mail_outbox o
			   set status = 'failed', last_error = 'quota_exceeded', attempts = o.attempts + 1
			 where o.id = v_ligne.id;
			continue;
		end if;

		update public.mail_outbox
		   set status = 'sending', reserved_at = now()
		 where id = v_ligne.id;

		return query
		select v_ligne.id,
		       v_ligne.card_id,
		       v_ligne.identity_id,
		       i.from_address,
		       -- `CRM-069` : un digest n'a pas d'affaire, donc pas de `Reply-To`.
		       case when c.id is null then null else c.email_local_part || '@' || w.inbound_domain end,
		       v_ligne.to_addrs,
		       v_ligne.cc_addrs,
		       v_ligne.subject,
		       v_ligne.body_text,
		       parent.rfc822_message_id,
		       -- LA CHAÎNE COMPLÈTE, DANS L'ORDRE : les références du parent PUIS son propre identifiant (§19.3).
		       coalesce(parent.references_ids, array[]::text[])
		         || coalesce(array[parent.rfc822_message_id], array[]::text[]),
		       i.smtp_host,
		       i.smtp_port,
		       i.smtp_security,
		       i.smtp_username,
		       v_ligne.attempts,
		       v_ligne.bcc_addrs,
		       v_ligne.attachments
		  from public.mail_outbound_identities i
		  left join public.cards c on c.id = v_ligne.card_id
		  left join public.workspaces w on w.id = c.workspace_id
		  left join public.mail_messages parent on parent.id = v_ligne.in_reply_to_message_id
		 where i.id = v_ligne.identity_id;
	end loop;
end;
$function$;

notify pgrst, 'reload schema';
