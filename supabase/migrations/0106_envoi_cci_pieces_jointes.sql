-- @spec CRM-058 (docs/BACKLOG.md) — tranche 2 : copie cachée et pièces jointes à l'envoi
-- @spec docs/SPEC-mail-subsystem.md §19 bis.2 (les choix validés), §19 bis.3 (le modèle), §19 bis.4 (le worker) ;
--       docs/SCHEMA.md « Migration `0106` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 707, 708, 719 et 720 ;
--       docs/DAT.md §12 bis (les noms)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION AJOUTE, SOUS `postgres`.
-- ---------------------------------------------------------------------------------------------
--
-- La colonne de copie cachée de la file et du message archivé ; le bucket privé des pièces à envoyer ; les deux
-- prédicats que les politiques de stockage de la migration 107 appellent ; `queue_outbound_email` recréée avec `p_bcc`
-- et `p_attachments` et trois refus de plus ; `reserver_envois` et `marquer_envoi_reussi` recréées pour porter la copie
-- cachée et les pièces jusqu'à l'archive ; la liste des dépôts abandonnés, que la veille de `mail-sync` efface par l'API
-- de stockage.
--
-- POURQUOI LES POLITIQUES NE SONT PAS ICI : `storage.objects` appartient à `supabase_storage_admin`, dont `postgres`
-- n'est pas membre (mesuré, migration 29). Elles vivent donc dans la migration 107, sous `supabase_admin`, et n'y font
-- qu'appeler les prédicats créés ici — une fonction `SECURITY DEFINER` créée sous un superutilisateur s'exécuterait avec
-- ses droits.
--
-- Rejouable : `add column if not exists`, `on conflict`, fonctions retirées puis recréées.

-- =============================================================================================
-- 1. La copie cachée — §19 bis.2 points 1 et 2
-- =============================================================================================

alter table public.mail_outbox add column if not exists bcc_addrs text[] not null default '{}';
comment on column public.mail_outbox.bcc_addrs is
	'CRM-058 tranche 2 §19 bis.2 — la copie cachée : écrite dans l''ENVELOPPE SMTP seulement, jamais dans un en-tête.';

alter table public.mail_messages add column if not exists bcc_addresses text[] not null default '{}';
comment on column public.mail_messages.bcc_addresses is
	'CRM-058 tranche 2 §19 bis.2 point 2 — la copie cachée d''un message ENVOYÉ, lisible dans l''affaire : cachée aux '
	'destinataires, pas à l''équipe. Toujours vide pour un message reçu.';

-- =============================================================================================
-- 2. Le bucket des pièces à envoyer — §19 bis.2 point 5
-- =============================================================================================
--
-- PRIVÉ, ET PLAFONNÉ À 10 Mo PAR OBJET : la base refuse aussi le total (point 4), mais un objet plus gros que le total
-- permis n'a aucune raison d'être déposé.

insert into storage.buckets (id, name, public, file_size_limit)
values ('mail-outbound-attachments', 'mail-outbound-attachments', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;

-- =============================================================================================
-- 3. Les prédicats des politiques de stockage — appelés par la migration 107
-- =============================================================================================
--
-- LE CHEMIN EST `<espace>/<personne>/<uuid>/<nom>` : le premier segment est un espace dont l'appelant est MEMBRE, le
-- second est l'appelant LUI-MÊME. Déposer ailleurs, c'est déposer au nom d'autrui.

create or replace function app.piece_envoi_deposable(p_nom text)
returns boolean
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
	v_espace uuid;
begin
	if (select auth.uid()) is null then
		return false;
	end if;
	if split_part(p_nom, '/', 2) <> (select auth.uid())::text or split_part(p_nom, '/', 4) = '' then
		return false;
	end if;
	begin
		v_espace := split_part(p_nom, '/', 1)::uuid;
	exception when invalid_text_representation then
		return false;
	end;
	return app.is_workspace_member(v_espace);
end;
$$;

comment on function app.piece_envoi_deposable(text) is
	'CRM-058 tranche 2 §19 bis.2 point 5 — vrai si l''appelant peut déposer cet objet dans `mail-outbound-attachments` : '
	'chemin `<espace dont il est membre>/<lui-même>/<uuid>/<nom>`.';

alter function app.piece_envoi_deposable(text) owner to postgres;

-- RETIRER SON PROPRE DÉPÔT, TANT QU'IL N'EST PAS EN FILE : une fois cité par la file, l'objet appartient à l'envoi, et
-- le retirer ferait partir un message amputé — ou échouer en `attachment_missing`.
create or replace function app.piece_envoi_retirable(p_nom text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
	select app.piece_envoi_deposable(p_nom)
	   and not exists (
		select 1
		  from public.mail_outbox o, jsonb_array_elements(o.attachments) p
		 where p ->> 'path' = p_nom
	);
$$;

comment on function app.piece_envoi_retirable(text) is
	'CRM-058 tranche 2 §19 bis.3 — vrai si l''appelant peut retirer ce dépôt : le sien, et pas encore cité par la file.';

alter function app.piece_envoi_retirable(text) owner to postgres;

revoke all on function app.piece_envoi_deposable(text) from public, anon;
revoke all on function app.piece_envoi_retirable(text) from public, anon;
grant execute on function app.piece_envoi_deposable(text) to authenticated, service_role;
grant execute on function app.piece_envoi_retirable(text) to authenticated, service_role;

-- =============================================================================================
-- 4. `public.queue_outbound_email` — sa signature change, ses sept refus restent, trois s'ajoutent
-- =============================================================================================

drop function if exists public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid);

create function public.queue_outbound_email(
	p_card_id     uuid,
	p_identity_id uuid,
	p_to          text[],
	p_subject     text default null,
	p_body_text   text default '',
	p_cc          text[] default '{}',
	p_in_reply_to_message_id uuid default null,
	p_bcc         text[] default '{}',
	p_attachments jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant  uuid := (select auth.uid());
	v_identite  public.mail_outbound_identities%rowtype;
	v_card      public.cards%rowtype;
	v_adresse   text;
	v_chemins   text[];
	v_pieces    jsonb;
	v_trouvees  integer;
	v_total     bigint;
	v_file      uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- ENVOYER AU NOM D'UNE AFFAIRE, C'EST Y AJOUTER DU CONTENU (§19.4).
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and (
	     i.owner_id = v_appelant
	     or (i.owner_id is null and app.is_workspace_admin(i.workspace_id))
	   );
	if v_identite.id is null then
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	select * into v_card
	  from public.cards c
	 where c.id = p_card_id
	   and c.workspace_id = v_identite.workspace_id
	   and c.archived_at is null
	   and c.deleted_at is null;
	if v_card.id is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	select c.email_local_part || '@' || w.inbound_domain into v_adresse
	  from public.cards c join public.workspaces w on w.id = c.workspace_id
	 where c.id = p_card_id and c.email_local_part is not null;
	if v_adresse is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	if coalesce(array_length(p_to, 1), 0) = 0 then
		raise exception 'recipient_required' using errcode = '23514';
	end if;

	if coalesce(char_length(p_body_text), 0) < 1 then
		raise exception 'body_required' using errcode = '23514';
	end if;

	-- LES PIÈCES JOINTES — §19 bis.2 points 4 et 5. Le client ne donne que des CHEMINS ; nom de fichier, taille et type
	-- sont relus dans `storage.objects`, jamais crus.
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
		   and split_part(o.name, '/', 1) = v_identite.workspace_id::text
		   and split_part(o.name, '/', 2) = v_appelant::text;
		-- UN SEUL REFUS POUR QUATRE CAUSES — absent, autre bucket, autre propriétaire, autre espace : les distinguer
		-- dirait à l'appelant qu'un objet d'autrui existe à ce chemin.
		if v_trouvees <> array_length(v_chemins, 1) then
			raise exception 'attachment_not_available' using errcode = '23514';
		end if;
		if v_total > 10485760 then
			raise exception 'attachments_too_large' using errcode = '23514', detail = 'At most 10 MB of attachments per message.';
		end if;
	end if;

	if v_identite.daily_quota is not null
		and app.envois_du_jour(p_identity_id) >= v_identite.daily_quota then
		raise exception 'quota_exceeded' using errcode = '23505';
	end if;

	v_file := app.mail_outbox_inserer(
		v_identite.workspace_id, p_identity_id, p_card_id, p_in_reply_to_message_id,
		p_to, p_cc, p_subject, p_body_text, v_identite.signature_text, v_appelant);

	-- LA COPIE CACHÉE ET LES PIÈCES complètent la ligne que la porte extraite vient d'écrire, dans la même transaction :
	-- `app.mail_outbox_inserer` reste la seule insertion, et les séquences de relance, qui n'ont ni l'une ni les autres,
	-- n'en voient aucun changement.
	update public.mail_outbox
	   set bcc_addrs = coalesce(p_bcc, '{}'),
	       attachments = coalesce(v_pieces, '[]'::jsonb)
	 where id = v_file;

	return v_file;
end;
$$;

comment on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid, text[], jsonb) is
	'CRM-058 §19.4, révisée par CRM-063 §10.3 et §12.8, puis par CRM-058 tranche 2 §19 bis.3 — seule porte HUMAINE de la '
	'file d''envoi. DIX refus : not_authenticated, forbidden, identity_not_available, card_not_available, '
	'recipient_required, body_required, attachment_not_available, too_many_attachments, attachments_too_large, '
	'quota_exceeded. `p_attachments` porte des CHEMINS du bucket `mail-outbound-attachments` ; nom, taille et type sont '
	'relus dans `storage.objects`.';

revoke all on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid, text[], jsonb)
	from public, anon;
grant execute on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid, text[], jsonb)
	to authenticated, service_role;

-- =============================================================================================
-- 5. `public.reserver_envois` — rend la copie cachée et les pièces au worker
-- =============================================================================================
--
-- REPRISE DE LA MIGRATION 30 À L'IDENTIQUE, deux colonnes rendues en plus : son type rendu change, d'où le retrait.

drop function if exists public.reserver_envois(integer);

create function public.reserver_envois(p_limite integer default 10)
returns table (
	outbox_id      uuid,
	card_id        uuid,
	identity_id    uuid,
	from_address   text,
	reply_to       text,
	to_addrs       text[],
	cc_addrs       text[],
	subject        text,
	body_text      text,
	in_reply_to    text,
	references_ids text[],
	smtp_host      text,
	smtp_port      integer,
	smtp_security  text,
	smtp_username  text,
	attempts       integer,
	bcc_addrs      text[],
	attachments    jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
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
			update public.mail_outbox
			   set status = 'failed', last_error = 'quota_exceeded', attempts = attempts + 1
			 where id = v_ligne.id;
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
		       c.email_local_part || '@' || w.inbound_domain,
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
		  join public.cards c on c.id = v_ligne.card_id
		  join public.workspaces w on w.id = c.workspace_id
		  left join public.mail_messages parent on parent.id = v_ligne.in_reply_to_message_id
		 where i.id = v_ligne.identity_id;
	end loop;
end;
$$;

comment on function public.reserver_envois(integer) is
	'CRM-058 §19.5, révisée par CRM-058 tranche 2 §19 bis.4 — réserve les envois dus pour le worker et rend tout ce qu''il '
	'compose, copie cachée et pièces comprises. Réservée à `service_role`.';

revoke all on function public.reserver_envois(integer) from public, anon, authenticated;
grant execute on function public.reserver_envois(integer) to service_role;

-- =============================================================================================
-- 6. `public.marquer_envoi_reussi` — archive la copie cachée et les pièces — §19 bis.2 point 7
-- =============================================================================================
--
-- `p_pieces` : ce que le worker a réellement envoyé puis déposé dans `mail-attachments` —
-- `[{filename, mime_type, size_bytes, storage_path, sha256, av_status}]`. Le statut est celui de l'analyse :
-- `clean` après l'antivirus, `skipped` sans lui — la règle de la réception (§4.3).

drop function if exists public.marquer_envoi_reussi(uuid, text, text[]);

create function public.marquer_envoi_reussi(
	p_outbox_id         uuid,
	p_rfc822_message_id text,
	p_references        text[] default '{}',
	p_pieces            jsonb default '[]'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_envoi   public.mail_outbox%rowtype;
	v_message uuid;
begin
	select * into v_envoi from public.mail_outbox o where o.id = p_outbox_id;
	if v_envoi.id is null then
		raise exception 'outbox_not_found' using errcode = 'P0002';
	end if;
	if v_envoi.status = 'sent' then
		return v_envoi.sent_message_id;
	end if;

	insert into public.mail_messages (
		workspace_id, rfc822_message_id, card_id, classification, direction,
		from_address, to_addresses, cc_addresses, bcc_addresses, subject, body_text, references_ids, sent_at
	)
	values (
		v_envoi.workspace_id, p_rfc822_message_id, v_envoi.card_id, 'outbound', 'outbound',
		(select i.from_address from public.mail_outbound_identities i where i.id = v_envoi.identity_id),
		v_envoi.to_addrs, v_envoi.cc_addrs, v_envoi.bcc_addrs, v_envoi.subject, v_envoi.body_text,
		coalesce(p_references, array[]::text[]), now()
	)
	on conflict (workspace_id, rfc822_message_id) do update set subject = excluded.subject
	returning id into v_message;

	insert into public.mail_attachments (message_id, card_id, filename, mime_type, size_bytes, storage_path, sha256, av_status)
	select v_message, v_envoi.card_id, p ->> 'filename', p ->> 'mime_type', (p ->> 'size_bytes')::bigint,
	       p ->> 'storage_path', p ->> 'sha256', p ->> 'av_status'
	  from jsonb_array_elements(coalesce(p_pieces, '[]'::jsonb)) p
	 where not exists (
		select 1 from public.mail_attachments a
		 where a.message_id = v_message and a.storage_path = p ->> 'storage_path'
	);

	update public.mail_outbox
	   set status = 'sent',
	       sent_at = now(),
	       rfc822_message_id = p_rfc822_message_id,
	       sent_message_id = v_message,
	       last_error = null
	 where id = p_outbox_id;

	perform app.card_event_ecrire(
		v_envoi.card_id,
		v_envoi.workspace_id,
		'mail_sent',
		jsonb_build_object('message_id', v_message, 'outbox_id', p_outbox_id)
	);

	return v_message;
end;
$$;

comment on function public.marquer_envoi_reussi(uuid, text, text[], jsonb) is
	'CRM-058 §19.5, révisée par CRM-058 tranche 2 §19 bis.2 point 7 — les effets d''un envoi réussi, solidaires : file '
	'marquée, message archivé en `outbound` avec sa copie cachée, pièces archivées dans `mail_attachments`, timeline '
	'écrite. Idempotent.';

revoke all on function public.marquer_envoi_reussi(uuid, text, text[], jsonb) from public, anon, authenticated;
grant execute on function public.marquer_envoi_reussi(uuid, text, text[], jsonb) to service_role;

-- =============================================================================================
-- 7. Les dépôts abandonnés — §19 bis.2 point 8
-- =============================================================================================
--
-- LA BASE DIT QUOI EFFACER, L'API DE STOCKAGE EFFACE : un `delete` sur `storage.objects` retirerait la ligne et
-- laisserait le fichier dans MinIO ou S3. La veille de `mail-sync` appelle cette fonction une fois par jour et retire
-- chaque objet par l'API, sous la clé de service.

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
	 order by o.created_at;
$$;

comment on function public.depots_envoi_abandonnes(interval) is
	'CRM-058 tranche 2 §19 bis.2 point 8 — les objets de `mail-outbound-attachments` plus vieux que `p_age` qu''aucun '
	'envoi EN COURS ne cite : jamais mis en file, ou déjà envoyés et archivés dans `mail-attachments`. Réservée à '
	'`service_role` ; l''effacement passe par l''API de stockage.';

revoke all on function public.depots_envoi_abandonnes(interval) from public, anon, authenticated;
grant execute on function public.depots_envoi_abandonnes(interval) to service_role;

notify pgrst, 'reload schema';
