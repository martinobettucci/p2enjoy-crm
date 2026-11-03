-- @spec CRM-128 (docs/BACKLOG.md) — tranche T2 : les mails préparés en base — la table `mail_drafts`, ses politiques,
--       `prepare_email`, `send_email_draft`, `discard_email_draft`, et le refus de tout envoi direct sous le jeton du
--       connecteur MCP
-- @spec docs/SPEC-mails-prepares.md §3 (modèle et fonctions), §4 (aucun détournement) ; docs/SCHEMA.md
--       « Migration `0162` » ; docs/JOURNAL.md décisions 821, 827 et 829 ; INC-341 ; docs/PROD_MIGRATIONS.md
--
-- LE CONNECTEUR PRÉPARE, IL N'ENVOIE JAMAIS (décision 829). Un mail préparé vit dans `mail_drafts`, que seule la personne
-- au nom de laquelle il a été préparé lit ; il ne part que par `send_email_draft`, appelée depuis l'interface web, qui
-- passe par `queue_outbound_email` avec le contenu relu.
--
-- AUCUN DÉTOURNEMENT : LA GARDE EST UN DÉCLENCHEUR, PAS UNE LISTE DE FONCTIONS. Toute insertion dans `mail_outbox` ou
-- `card_sequence_enrollments` sous le jeton du connecteur est refusée (`review_required`), quelle que soit la fonction
-- qui l'écrit — y compris une fonction à venir. Les relances automatiques et le digest tournent sous `pg_cron`, sans
-- jeton : la garde ne les voit pas (§4.3). `send_email_draft` refuse en outre le connecteur avant toute lecture.
--
-- IDEMPOTENCE : `create table if not exists`, `create or replace`, déclencheurs et politiques retirés puis recréés.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : retirer les deux déclencheurs de garde, les trois fonctions publiques,
-- `app.via_connector`, puis la table. Les mails préparés en attente sont perdus : les lister avant.

-- =============================================================================================
-- 1. Reconnaître le jeton du connecteur — §4.1
-- =============================================================================================

-- LA SEULE DÉFINITION. Le connecteur frappe `iss = p2enjoy-crm/mcp` et `canal = mcp` (docs/SPEC-mcp.md §5) ; l'une ou
-- l'autre suffit. Sans jeton (`pg_cron`, clé de service sans revendication), elle rend faux.
create or replace function app.via_connector()
returns boolean
language sql
stable
set search_path = ''
as $$
	select coalesce((select auth.jwt()) ->> 'canal' = 'mcp', false)
	    or coalesce((select auth.jwt()) ->> 'iss' = 'p2enjoy-crm/mcp', false);
$$;

revoke all on function app.via_connector() from public;
grant execute on function app.via_connector() to authenticated, service_role;

-- =============================================================================================
-- 2. La garde des deux files d'envoi — §4.2
-- =============================================================================================

create or replace function app.refuser_envoi_connecteur()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if app.via_connector() then
		raise exception 'review_required' using errcode = '42501',
			detail = 'A message prepared through the connector is sent from the CRM, after review.';
	end if;
	return new;
end;
$$;

revoke all on function app.refuser_envoi_connecteur() from public;

drop trigger if exists mail_outbox_refuser_connecteur on public.mail_outbox;
create trigger mail_outbox_refuser_connecteur
	before insert on public.mail_outbox
	for each row execute function app.refuser_envoi_connecteur();

drop trigger if exists card_sequence_enrollments_refuser_connecteur on public.card_sequence_enrollments;
create trigger card_sequence_enrollments_refuser_connecteur
	before insert on public.card_sequence_enrollments
	for each row execute function app.refuser_envoi_connecteur();

-- =============================================================================================
-- 3. La table — §3.1
-- =============================================================================================

create table if not exists public.mail_drafts (
	id                     uuid primary key default gen_random_uuid(),
	workspace_id           uuid not null references public.workspaces (id) on delete cascade,
	card_id                uuid not null references public.cards (id) on delete cascade,
	identity_id            uuid references public.mail_outbound_identities (id) on delete set null,
	in_reply_to_message_id uuid references public.mail_messages (id) on delete set null,
	to_addrs               text[] not null,
	cc_addrs               text[] not null default '{}',
	bcc_addrs              text[] not null default '{}',
	subject                text not null default '',
	body_text              text not null,
	origin                 text not null,
	status                 text not null default 'pending',
	outbox_id              uuid references public.mail_outbox (id) on delete set null,
	created_by             uuid not null references public.profiles (id) on delete cascade,
	created_at             timestamptz not null default now(),
	updated_at             timestamptz not null default now(),
	sent_at                timestamptz,
	discarded_at           timestamptz,
	constraint mail_drafts_to_bornes check (coalesce(array_length(to_addrs, 1), 0) between 1 and 50),
	constraint mail_drafts_cc_bornes check (coalesce(array_length(cc_addrs, 1), 0) <= 50),
	constraint mail_drafts_bcc_bornes check (coalesce(array_length(bcc_addrs, 1), 0) <= 50),
	constraint mail_drafts_subject_bornes check (char_length(subject) <= 998),
	constraint mail_drafts_body_bornes check (char_length(body_text) between 1 and 100000),
	constraint mail_drafts_origin_check check (origin in ('mcp', 'web')),
	constraint mail_drafts_status_check check (status in ('pending', 'sent', 'discarded')),
	-- L'envoi n'est attesté que par sa ligne de file ; une ligne de file purgée laisse `sent_at` comme trace.
	constraint mail_drafts_sent_coherent check ((status = 'sent') = (sent_at is not null)),
	constraint mail_drafts_discarded_coherent check ((status = 'discarded') = (discarded_at is not null))
);

create index if not exists mail_drafts_file_personne
	on public.mail_drafts (created_by, workspace_id, status, created_at);
create index if not exists mail_drafts_affaire
	on public.mail_drafts (card_id, status);

drop trigger if exists mail_drafts_set_updated_at on public.mail_drafts;
create trigger mail_drafts_set_updated_at
	before update on public.mail_drafts
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 4. Les droits — §3.2
-- =============================================================================================

alter table public.mail_drafts enable row level security;

-- LA PERSONNE SEULE (décision 829, question 3) : un administrateur ne lit pas le mail préparé d'autrui.
drop policy if exists mail_drafts_lecture_personne on public.mail_drafts;
create policy mail_drafts_lecture_personne
	on public.mail_drafts for select to authenticated
	using (created_by = (select auth.uid()) and app.can_read_card(card_id));

revoke all on public.mail_drafts from anon, authenticated;
grant select on public.mail_drafts to authenticated;
grant all privileges on public.mail_drafts to service_role;

-- =============================================================================================
-- 5. Préparer — §3.3
-- =============================================================================================

create or replace function public.prepare_email(
	p_card_id                uuid,
	p_to                     text[],
	p_body_text              text,
	p_subject                text default '',
	p_identity_id            uuid default null,
	p_cc                     text[] default '{}',
	p_bcc                    text[] default '{}',
	p_in_reply_to_message_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_espace   uuid;
	v_brouillon uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- PRÉPARER AU NOM D'UNE AFFAIRE, C'EST DÉJÀ Y ÉCRIRE : le droit est celui de l'envoi.
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- L'AFFAIRE VIVANTE ET DOTÉE D'UNE ADRESSE — la règle de `queue_outbound_email`.
	select c.workspace_id into v_espace
	  from public.cards c
	 where c.id = p_card_id
	   and c.deleted_at is null
	   and c.email_local_part is not null
	   and app.card_has_active_placement(c.id);
	if v_espace is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- LA SIENNE, ET ELLE SEULE (décision 805) — vérifiée dès la préparation pour que l'assistant l'apprenne tout de suite ;
	-- l'envoi la vérifie de nouveau.
	if p_identity_id is not null and not exists (
		select 1 from public.mail_outbound_identities i
		 where i.id = p_identity_id and i.owner_id = v_appelant and i.workspace_id = v_espace
	) then
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	if p_in_reply_to_message_id is not null and not exists (
		select 1 from public.mail_messages m
		 where m.id = p_in_reply_to_message_id and m.card_id = p_card_id
	) then
		raise exception 'reply_outside_card' using errcode = '23514';
	end if;

	if coalesce(array_length(p_to, 1), 0) = 0 then
		raise exception 'recipient_required' using errcode = '23514';
	end if;
	if coalesce(char_length(p_body_text), 0) < 1 then
		raise exception 'body_required' using errcode = '23514';
	end if;

	-- UN ASSISTANT EN BOUCLE NE REMPLIT PAS LA FILE SANS FIN (§3.3, point 7).
	if (select count(*) from public.mail_drafts d
	     where d.created_by = v_appelant and d.workspace_id = v_espace and d.status = 'pending') >= 200 then
		raise exception 'draft_limit_reached' using errcode = '23514', detail = 'At most 200 pending prepared messages.';
	end if;

	insert into public.mail_drafts (
		workspace_id, card_id, identity_id, in_reply_to_message_id,
		to_addrs, cc_addrs, bcc_addrs, subject, body_text, origin, created_by
	)
	values (
		v_espace, p_card_id, p_identity_id, p_in_reply_to_message_id,
		p_to, coalesce(p_cc, '{}'), coalesce(p_bcc, '{}'), coalesce(p_subject, ''), p_body_text,
		case when app.via_connector() then 'mcp' else 'web' end, v_appelant
	)
	returning id into v_brouillon;

	return v_brouillon;
end;
$$;

revoke all on function public.prepare_email(uuid, text[], text, text, uuid, text[], text[], uuid) from public, anon;
grant execute on function public.prepare_email(uuid, text[], text, text, uuid, text[], text[], uuid)
	to authenticated, service_role;

-- =============================================================================================
-- 6. Envoyer, depuis l'interface — §3.4
-- =============================================================================================

create or replace function public.send_email_draft(
	p_draft_id    uuid,
	p_identity_id uuid,
	p_to          text[],
	p_body_text   text,
	p_subject     text default '',
	p_cc          text[] default '{}',
	p_bcc         text[] default '{}',
	p_attachments jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_brouillon public.mail_drafts%rowtype;
	v_file      uuid;
begin
	-- AVANT TOUTE LECTURE : rien n'apprend au connecteur qu'un mail préparé existe ou non.
	if app.via_connector() then
		raise exception 'review_required' using errcode = '42501',
			detail = 'A message prepared through the connector is sent from the CRM, after review.';
	end if;
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_brouillon
	  from public.mail_drafts d
	 where d.id = p_draft_id and d.created_by = (select auth.uid())
	   for update;
	-- ABSENT OU À AUTRUI : la même réponse.
	if v_brouillon.id is null then
		perform app.raise_http_error(404, 'draft_not_found');
	end if;
	if v_brouillon.status <> 'pending' then
		raise exception 'draft_not_pending' using errcode = '23514';
	end if;

	-- CE QUI PART EST CE QUE LA PERSONNE A RELU : le contenu vient du formulaire ; l'affaire et la réponse, du mail
	-- préparé. Tous les contrôles de l'envoi depuis l'écran s'appliquent, et leur refus remonte tel quel.
	v_file := public.queue_outbound_email(
		v_brouillon.card_id, p_identity_id, p_to, p_subject, p_body_text, p_cc,
		v_brouillon.in_reply_to_message_id, p_bcc, p_attachments);

	update public.mail_drafts
	   set status = 'sent', outbox_id = v_file, sent_at = now()
	 where id = v_brouillon.id;

	return v_file;
end;
$$;

revoke all on function public.send_email_draft(uuid, uuid, text[], text, text, text[], text[], jsonb) from public, anon;
grant execute on function public.send_email_draft(uuid, uuid, text[], text, text, text[], text[], jsonb)
	to authenticated;

-- =============================================================================================
-- 7. Écarter — §3.5
-- =============================================================================================

create or replace function public.discard_email_draft(p_draft_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_brouillon public.mail_drafts%rowtype;
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_brouillon
	  from public.mail_drafts d
	 where d.id = p_draft_id and d.created_by = (select auth.uid())
	   for update;
	if v_brouillon.id is null then
		perform app.raise_http_error(404, 'draft_not_found');
	end if;
	if v_brouillon.status <> 'pending' then
		raise exception 'draft_not_pending' using errcode = '23514';
	end if;

	update public.mail_drafts
	   set status = 'discarded', discarded_at = now()
	 where id = v_brouillon.id;
end;
$$;

revoke all on function public.discard_email_draft(uuid) from public, anon;
grant execute on function public.discard_email_draft(uuid) to authenticated;
