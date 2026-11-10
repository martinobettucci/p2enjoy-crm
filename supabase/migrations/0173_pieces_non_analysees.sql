-- @spec CRM-143 (docs/BACKLOG.md) — tranche T1 : le repli confirmé d'une pièce non analysée, sa reprise, les pièces d'un
--       mail préparé
-- @spec docs/SPEC-pieces-jointes.md §17.3 (la confirmation persistée, la règle du téléchargement), §17.5 (la reprise),
--       §17.6 (les pièces d'un mail préparé), §17.7 ; docs/SPEC-mail-subsystem.md §4.3 (révisé) ; docs/SCHEMA.md
--       « Migration `0173` » ; docs/JOURNAL.md décisions 889 et 892 ; CLAUDE.md §10 (la base décide)

-- =============================================================================================
-- 1. Pourquoi une pièce est `skipped` (§17.3)
-- =============================================================================================

alter table public.mail_attachments add column if not exists av_skip_reason text;

-- LES LIGNES EXISTANTES REÇOIVENT LEUR RAISON avant la contrainte : une pièce dont l'objet est déposé n'a pu être analysée
-- faute d'antivirus ; une pièce sans objet a dépassé la borne et n'a jamais été déposée (§4.3 du sous-système).
update public.mail_attachments a
   set av_skip_reason = case
		when exists (select 1 from storage.objects o where o.bucket_id = 'mail-attachments' and o.name = a.storage_path)
		then 'scanner_unavailable'
		else 'too_large'
	end
 where a.av_status = 'skipped'
   and a.av_skip_reason is null;

-- UNE ÉCRITURE QUI NE DIT PAS LA RAISON LA REÇOIT CONSTATÉE, par la règle de la reprise ci-dessus. C'est le cas de l'image
-- `mail-sync` d'avant `CRM-143`, le temps d'une livraison : sans ce déclencheur, la contrainte stricte refuserait ses pièces
-- `skipped`, et les pièces d'un message déjà inséré seraient perdues. Hors de `skipped`, la raison est effacée.
create or replace function app.mail_attachments_av_skip_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.av_status = 'skipped' then
		if new.av_skip_reason is null then
			new.av_skip_reason := case
				when exists (select 1 from storage.objects o
				              where o.bucket_id = 'mail-attachments' and o.name = new.storage_path)
				then 'scanner_unavailable'
				else 'too_large'
			end;
		end if;
	else
		new.av_skip_reason := null;
	end if;
	return new;
end;
$$;

drop trigger if exists mail_attachments_av_skip_reason on public.mail_attachments;
create trigger mail_attachments_av_skip_reason
	before insert or update of av_status, av_skip_reason on public.mail_attachments
	for each row execute function app.mail_attachments_av_skip_reason();

alter table public.mail_attachments drop constraint if exists mail_attachments_av_skip_reason;
alter table public.mail_attachments add constraint mail_attachments_av_skip_reason
	check (
		case when av_status = 'skipped'
		     then av_skip_reason is not null and av_skip_reason in ('scanner_unavailable', 'too_large')
		     else av_skip_reason is null
		end
	);

comment on column public.mail_attachments.av_skip_reason is
	'CRM-143 : pourquoi la pièce est `skipped` — `scanner_unavailable` (antivirus muet, objet déposé, reprise possible) '
	'ou `too_large` (au-delà de MAIL_MAX_ATTACHMENT_MB, jamais déposée). Nulle hors de `skipped`. '
	'docs/SPEC-pieces-jointes.md §17.3.';

-- =============================================================================================
-- 2. « Non analysée » : une seule définition, réemployée partout (§17.3)
-- =============================================================================================
--
-- `skipped` faute d'antivirus, ou `pending` depuis plus de QUINZE MINUTES. Un `pending` plus jeune est une analyse en cours.

create or replace function app.piece_non_analysee(p_av_status text, p_av_skip_reason text, p_created_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
	select (p_av_status = 'skipped' and p_av_skip_reason = 'scanner_unavailable')
	    or (p_av_status = 'pending' and p_created_at < pg_catalog.now() - interval '15 minutes');
$$;

comment on function app.piece_non_analysee(text, text, timestamptz) is
	'CRM-143 : vrai pour une pièce non analysée — `skipped` faute d''antivirus, ou `pending` depuis plus de quinze minutes. '
	'docs/SPEC-pieces-jointes.md §17.3.';

revoke all on function app.piece_non_analysee(text, text, timestamptz) from public, anon;
grant execute on function app.piece_non_analysee(text, text, timestamptz) to authenticated, service_role;

-- =============================================================================================
-- 3. La confirmation, une ligne par personne et par pièce (§17.3)
-- =============================================================================================

create table if not exists public.mail_attachment_risk_acknowledgments (
	attachment_id   uuid not null references public.mail_attachments (id) on delete cascade,
	user_id         uuid not null references public.profiles (id) on delete cascade,
	acknowledged_at timestamptz not null default now(),
	primary key (attachment_id, user_id)
);

comment on table public.mail_attachment_risk_acknowledgments is
	'CRM-143 : la confirmation qu''une personne télécharge une pièce non analysée, en connaissance du risque. Posée par '
	'`acknowledge_unscanned_attachment`, lue par `app.piece_jointe_telechargeable`. docs/SPEC-pieces-jointes.md §17.3.';

alter table public.mail_attachment_risk_acknowledgments enable row level security;

-- LE `revoke` AVANT LES `grant` (décision 134) : les privilèges par défaut de la pile ouvrent toute table neuve.
revoke all on public.mail_attachment_risk_acknowledgments from public, anon, authenticated;
grant select on public.mail_attachment_risk_acknowledgments to authenticated;
grant all on public.mail_attachment_risk_acknowledgments to service_role;

drop policy if exists mail_attachment_risk_acknowledgments_lecture on public.mail_attachment_risk_acknowledgments;
create policy mail_attachment_risk_acknowledgments_lecture
	on public.mail_attachment_risk_acknowledgments
	for select
	to authenticated
	using (user_id = (select auth.uid()));

create or replace function public.acknowledge_unscanned_attachment(p_attachment_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_piece    record;
	v_date     timestamptz;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select a.id, a.message_id, a.av_status, a.av_skip_reason, a.created_at
	  into v_piece
	  from public.mail_attachments a
	 where a.id = p_attachment_id;

	-- L'ABSENCE ET L'INTERDIT NE SE DISTINGUENT PAS : la pièce d'un message invisible n'existe pas pour l'appelant.
	if v_piece.id is null or not app.peut_voir_message(v_piece.message_id) then
		perform app.raise_http_error(404, 'attachment_not_found');
	end if;

	if v_piece.av_status = 'infected' then
		raise exception 'attachment_infected' using errcode = '42501';
	end if;
	if v_piece.av_status = 'clean' then
		raise exception 'attachment_clean' using errcode = '22023';
	end if;
	if v_piece.av_status = 'skipped' and v_piece.av_skip_reason = 'too_large' then
		raise exception 'attachment_not_stored' using errcode = '55000';
	end if;
	if not app.piece_non_analysee(v_piece.av_status, v_piece.av_skip_reason, v_piece.created_at) then
		-- Reste : `pending` depuis moins de quinze minutes.
		raise exception 'attachment_scanning' using errcode = '55000';
	end if;

	insert into public.mail_attachment_risk_acknowledgments (attachment_id, user_id)
	values (p_attachment_id, v_appelant)
	on conflict (attachment_id, user_id) do nothing;

	select k.acknowledged_at into v_date
	  from public.mail_attachment_risk_acknowledgments k
	 where k.attachment_id = p_attachment_id and k.user_id = v_appelant;
	return v_date;
end;
$$;

comment on function public.acknowledge_unscanned_attachment(uuid) is
	'CRM-143 : pose la confirmation de l''appelant pour une pièce non analysée, et en rend la date (idempotente). Refus : '
	'not_authenticated, attachment_not_found (404), attachment_infected, attachment_clean, attachment_not_stored, '
	'attachment_scanning. docs/SPEC-pieces-jointes.md §17.3.';

revoke all on function public.acknowledge_unscanned_attachment(uuid) from public, anon;
grant execute on function public.acknowledge_unscanned_attachment(uuid) to authenticated;

-- =============================================================================================
-- 4. La règle du téléchargement, reprise (§17.3)
-- =============================================================================================
--
-- Reprise de la 0028 à l'identique, avec un seul ajout : une pièce non analysée se lit quand l'APPELANT l'a confirmée.
-- `infected` reste refusée à tous ; l'anonyme n'exécute pas la fonction. Le propriétaire reste `postgres` : la politique qui
-- l'appelle (0029) ne change pas.

create or replace function app.piece_jointe_telechargeable(p_chemin text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
	select exists (
		select 1
		  from public.mail_attachments a
		 where a.storage_path = p_chemin
		   and app.peut_voir_message(a.message_id)
		   and (
			a.av_status = 'clean'
			or (
				app.piece_non_analysee(a.av_status, a.av_skip_reason, a.created_at)
				and exists (
					select 1
					  from public.mail_attachment_risk_acknowledgments k
					 where k.attachment_id = a.id
					   and k.user_id = (select auth.uid())
				)
			)
		   )
	);
$$;

comment on function app.piece_jointe_telechargeable(text) is
	'CRM-057 §18.5, CRM-143 §17.3 — vrai si l''objet désigné est une pièce dont le message est visible par l''appelant, '
	'et qui est `clean`, ou non analysée et confirmée par l''appelant. `infected` jamais.';

alter function app.piece_jointe_telechargeable(text) owner to postgres;
revoke all on function app.piece_jointe_telechargeable(text) from public, anon;
grant execute on function app.piece_jointe_telechargeable(text) to authenticated, service_role;

-- =============================================================================================
-- 5. La reprise, réservée au service (§17.5)
-- =============================================================================================

create or replace function public.mail_attachments_to_rescan(p_limit integer default 20)
returns table (id uuid, storage_path text, mime_type text)
language sql
security definer
set search_path = ''
stable
as $$
	select a.id, a.storage_path, a.mime_type
	  from public.mail_attachments a
	 where app.piece_non_analysee(a.av_status, a.av_skip_reason, a.created_at)
	 order by a.created_at, a.id
	 limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

comment on function public.mail_attachments_to_rescan(integer) is
	'CRM-143 : les pièces non analysées, les plus anciennes d''abord, pour la reprise de mail-sync. Réservée à service_role. '
	'docs/SPEC-pieces-jointes.md §17.5.';

revoke all on function public.mail_attachments_to_rescan(integer) from public, anon, authenticated;
grant execute on function public.mail_attachments_to_rescan(integer) to service_role;

create or replace function public.mail_attachment_record_scan(p_attachment_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if p_status not in ('clean', 'infected') then
		raise exception 'invalid_status' using errcode = '22023';
	end if;

	-- UNE PIÈCE DÉJÀ JUGÉE N'EST PAS RÉÉCRITE : seule une pièce non analysée reçoit un verdict.
	update public.mail_attachments a
	   set av_status      = p_status,
	       av_skip_reason = null,
	       av_checked_at  = now()
	 where a.id = p_attachment_id
	   and app.piece_non_analysee(a.av_status, a.av_skip_reason, a.created_at);
end;
$$;

comment on function public.mail_attachment_record_scan(uuid, text) is
	'CRM-143 : écrit le verdict de la reprise (`clean` ou `infected`) sur une pièce non analysée, et sur elle seule. Le '
	'déclencheur de 0141 pose alors l''extraction d''une pièce devenue saine. Réservée à service_role. '
	'docs/SPEC-pieces-jointes.md §17.5.';

revoke all on function public.mail_attachment_record_scan(uuid, text) from public, anon, authenticated;
grant execute on function public.mail_attachment_record_scan(uuid, text) to service_role;

-- =============================================================================================
-- 6. Les pièces d'un mail préparé (§17.6)
-- =============================================================================================

alter table public.mail_drafts add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.mail_drafts drop constraint if exists mail_drafts_attachments_forme;
alter table public.mail_drafts add constraint mail_drafts_attachments_forme
	check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10);

comment on column public.mail_drafts.attachments is
	'CRM-143 : les pièces du mail préparé, la forme de `mail_outbox.attachments` — `[{path, filename, mime_type, '
	'size_bytes}]`, relues dans `storage.objects` par `prepare_email`. docs/SPEC-pieces-jointes.md §17.6.';

-- L'ANCIENNE SIGNATURE EST RETIRÉE : PostgREST ne départage pas deux surcharges de même nom.
drop function if exists public.prepare_email(uuid, text[], text, text, uuid, text[], text[], uuid);

create or replace function public.prepare_email(
	p_card_id                uuid,
	p_to                     text[],
	p_body_text              text,
	p_subject                text default '',
	p_identity_id            uuid default null,
	p_cc                     text[] default '{}',
	p_bcc                    text[] default '{}',
	p_in_reply_to_message_id uuid default null,
	p_attachments            jsonb default '[]'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant  uuid := (select auth.uid());
	v_espace    uuid;
	v_brouillon uuid;
	v_chemins   text[];
	v_trouvees  integer;
	v_total     bigint;
	v_pieces    jsonb := '[]'::jsonb;
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

	-- LA SIENNE, ET ELLE SEULE (décision 805).
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

	-- LES PIÈCES — `CRM-143` §17.6, les règles de `queue_outbound_email` (§19 bis.2 points 4 et 5) : le client ne donne que
	-- des CHEMINS ; nom, taille et type sont relus dans `storage.objects`, jamais crus.
	if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
		raise exception 'attachment_not_available' using errcode = '23514';
	end if;
	select coalesce(array_agg(distinct e), '{}')
	  into v_chemins
	  from jsonb_array_elements_text(coalesce(p_attachments, '[]'::jsonb)) e;
	if coalesce(array_length(v_chemins, 1), 0) > 10 then
		raise exception 'too_many_attachments' using errcode = '23514', detail = 'At most 10 attachments per message.';
	end if;
	if coalesce(array_length(v_chemins, 1), 0) > 0 then
		select count(*),
		       coalesce(sum((o.metadata ->> 'size')::bigint), 0),
		       coalesce(jsonb_agg(jsonb_build_object(
		           'path', o.name,
		           'filename', split_part(o.name, '/', 4),
		           'mime_type', coalesce(o.metadata ->> 'mimetype', 'application/octet-stream'),
		           'size_bytes', (o.metadata ->> 'size')::bigint
		       ) order by o.name), '[]'::jsonb)
		  into v_trouvees, v_total, v_pieces
		  from storage.objects o
		 where o.bucket_id = 'mail-outbound-attachments'
		   and o.name = any (v_chemins)
		   and o.owner = v_appelant
		   and split_part(o.name, '/', 1) = v_espace::text
		   and split_part(o.name, '/', 2) = v_appelant::text;
		-- UN SEUL REFUS POUR QUATRE CAUSES : les distinguer dirait qu'un objet d'autrui existe à ce chemin.
		if v_trouvees <> array_length(v_chemins, 1) then
			raise exception 'attachment_not_available' using errcode = '23514';
		end if;
		if v_total > 10485760 then
			raise exception 'attachments_too_large' using errcode = '23514', detail = 'At most 10 MB of attachments per message.';
		end if;
	end if;

	-- UN ASSISTANT EN BOUCLE NE REMPLIT PAS LA FILE SANS FIN (§3.3, point 7).
	if (select count(*) from public.mail_drafts d
	     where d.created_by = v_appelant and d.workspace_id = v_espace and d.status = 'pending') >= 200 then
		raise exception 'draft_limit_reached' using errcode = '23514', detail = 'At most 200 pending prepared messages.';
	end if;

	insert into public.mail_drafts (
		workspace_id, card_id, identity_id, in_reply_to_message_id,
		to_addrs, cc_addrs, bcc_addrs, subject, body_text, origin, created_by, attachments
	)
	values (
		v_espace, p_card_id, p_identity_id, p_in_reply_to_message_id,
		p_to, coalesce(p_cc, '{}'), coalesce(p_bcc, '{}'), coalesce(p_subject, ''), p_body_text,
		case when app.via_connector() then 'mcp' else 'web' end, v_appelant, v_pieces
	)
	returning id into v_brouillon;

	return v_brouillon;
end;
$$;

comment on function public.prepare_email(uuid, text[], text, text, uuid, text[], text[], uuid, jsonb) is
	'CRM-128, CRM-143 : prépare un email sans l''envoyer, avec ses pièces (chemins de `mail-outbound-attachments` déposés '
	'par l''appelant, au plus 10 et 10 Mo). docs/SPEC-mails-prepares.md §3, docs/SPEC-pieces-jointes.md §17.6.';

revoke all on function public.prepare_email(uuid, text[], text, text, uuid, text[], text[], uuid, jsonb) from public, anon;
grant execute on function public.prepare_email(uuid, text[], text, text, uuid, text[], text[], uuid, jsonb)
	to authenticated, service_role;

-- LES DÉPÔTS D'UN MAIL PRÉPARÉ EN ATTENTE NE SONT PAS ABANDONNÉS — reprise de la 0106, avec ce seul ajout.
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
		   and b.status in ('queued', 'sending')
	)
	   and not exists (
		select 1
		  from public.mail_drafts d, jsonb_array_elements(d.attachments) p
		 where p ->> 'path' = o.name
		   and d.status = 'pending'
	)
	 order by o.created_at;
$$;

comment on function public.depots_envoi_abandonnes(interval) is
	'CRM-058 tranche 2 §19 bis.2 point 8, CRM-143 §17.6 — les objets de `mail-outbound-attachments` plus vieux que `p_age` '
	'qu''aucun envoi EN COURS ni aucun mail préparé EN ATTENTE ne cite. Réservée à `service_role`.';

revoke all on function public.depots_envoi_abandonnes(interval) from public, anon, authenticated;
grant execute on function public.depots_envoi_abandonnes(interval) to service_role;

notify pgrst, 'reload schema';
