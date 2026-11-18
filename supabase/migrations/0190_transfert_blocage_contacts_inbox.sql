-- @spec CRM-156 (docs/BACKLOG.md) — tranche T2 : la base des ajouts de la décision 945 — transférer un mail à un membre
--       (la lecture ouverte, « Seulement moi », la notification), bloquer un expéditeur (les reçus et les prochains en
--       corbeille), les expéditeurs inconnus d'une sélection et la source des contacts créés depuis l'inbox
-- @spec docs/SPEC-mail-subsystem.md §32.7 (transférer), §32.8 (bloquer), §32.10 (créer des contacts) ; docs/SCHEMA.md
--       « Migration `0190` » ; docs/SPEC-notifications.md (le type `mail_transfer`) ; docs/JOURNAL.md décisions 945 et
--       947 ; CLAUDE.md §10 (la règle tenue en base)
--
-- IDEMPOTENCE : `create ... if not exists`, `create or replace`, politiques et contraintes supprimées puis recréées.

-- =============================================================================================
-- 1. Le transfert — §32.7
-- =============================================================================================

create table if not exists public.mail_message_transfers (
	message_id     uuid not null references public.mail_messages (id) on delete cascade,
	recipient_id   uuid not null references public.profiles (id) on delete cascade,
	workspace_id   uuid not null references public.workspaces (id) on delete cascade,
	transferred_by uuid references public.profiles (id) on delete set null,
	created_at     timestamptz not null default now(),
	primary key (message_id, recipient_id)
);
create index if not exists mail_message_transfers_recipient_idx on public.mail_message_transfers (recipient_id);

comment on table public.mail_message_transfers is
	'CRM-156 §32.7 — un mail transféré à un membre : aucun envoi, la lecture du message ouverte au destinataire, qui le '
	'voit dans « Seulement moi ». Écrit et retiré par les fonctions seules.';

alter table public.mail_message_transfers enable row level security;
revoke all on public.mail_message_transfers from anon, authenticated;
grant select on public.mail_message_transfers to authenticated;

-- Le transfert d'un message vers l'appelant. `SECURITY DEFINER` : la politique de lecture des messages l'appelle, et
-- lire la table sous la RLS de l'appelant, dont la politique lit à son tour les messages, bouclerait.
create or replace function app.message_transfere_a_moi(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.mail_message_transfers t
		 where t.message_id = p_message_id and t.recipient_id = (select auth.uid())
	);
$$;
revoke all on function app.message_transfere_a_moi(uuid) from public, anon;
grant execute on function app.message_transfere_a_moi(uuid) to authenticated;

-- LA TROISIÈME VOIE DE LECTURE (décision 947) : l'affaire lisible, la boîte lisible, et désormais le transfert. Un message
-- en corbeille reste invisible par les trois.
create or replace function app.peut_voir_message(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	-- CRM-138 : un message en corbeille n'est vu par aucune voie ; la corbeille se lit par `trashed_messages`.
	-- CRM-156 T2 : un message transféré à l'appelant est vu par lui (§32.7).
	select exists (
		select 1
		  from public.mail_messages m
		 where m.id = p_message_id
		   and m.deleted_at is null
		   and ((m.card_id is not null and app.can_read_card(m.card_id))
		        or app.boite_du_message_lisible(m.id)
		        or app.message_transfere_a_moi(m.id))
	);
$$;

drop policy if exists mail_messages_lecture on public.mail_messages;
create policy mail_messages_lecture on public.mail_messages
	for select to authenticated
	using (
		deleted_at is null
		and ((card_id is not null and app.can_read_card(card_id))
		     or app.boite_du_message_lisible(id)
		     or app.message_transfere_a_moi(id))
	);

drop policy if exists mail_message_transfers_lecture on public.mail_message_transfers;
create policy mail_message_transfers_lecture on public.mail_message_transfers
	for select to authenticated
	using (app.peut_voir_message(message_id));

-- « Seulement moi » retient aussi un message transféré à l'appelant (§32.7, §27.2).
create or replace function public.concerns_me(public.mail_messages)
returns boolean
language sql
stable
set search_path = ''
as $$
	select exists (
		select 1
		  from public.mail_outbound_identities i
		 where i.owner_id = (select auth.uid())
		   and lower(btrim(i.from_address)) in (
			select lower(btrim(a))
			  from unnest(
				coalesce($1.to_addresses, '{}'::text[])
				|| coalesce($1.cc_addresses, '{}'::text[])
				|| coalesce($1.bcc_addresses, '{}'::text[])
				|| array[$1.from_address]
			  ) as a
			 where a is not null
		   )
	)
	or app.message_transfere_a_moi($1.id);
$$;

-- La notification : le type `mail_transfer` entre dans les deux listes fermées.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in ('mention', 'mail_transfer'));
alter table public.notification_preferences drop constraint if exists notification_preferences_type_check;
alter table public.notification_preferences add constraint notification_preferences_type_check
	check (type in ('mention', 'mail_transfer'));

-- Écrit la notification d'un transfert : le nombre de mails, l'auteur, le premier message et son objet. Aucun sujet
-- d'affaire ni d'organisation. La préférence du destinataire s'applique à la lecture (`app.notification_consentie`).
create or replace function app.notifier_transfert(p_message_id uuid, p_destinataire uuid, p_nombre integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	insert into public.notifications (workspace_id, recipient_id, type, payload)
	values (v_message.workspace_id, p_destinataire, 'mail_transfer', pg_catalog.jsonb_build_object(
		'count', p_nombre, 'author_id', (select auth.uid()), 'message_id', p_message_id, 'subject', v_message.subject));
end;
$$;
revoke all on function app.notifier_transfert(uuid, uuid, integer) from public, anon, authenticated;

-- Le corps commun du transfert. Rend vrai quand le transfert est NEUF ; faux quand il existait déjà.
create or replace function app.transferer_message(p_message_id uuid, p_recipient_id uuid, p_notifier boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_message  public.mail_messages%rowtype;
	v_neuf     integer;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	select * into v_message from public.mail_messages m where m.id = p_message_id and m.deleted_at is null;
	-- Inconnu, en corbeille ou non vu : indiscernables (docs/SPEC-permissions-rls.md §7).
	if v_message.id is null or not app.peut_voir_message(p_message_id) then
		perform app.raise_http_error(404, 'message_not_found');
	end if;
	-- Ceux qui éditent l'espace transfèrent (décision 947).
	if not coalesce(app.workspace_role(v_message.workspace_id) in ('admin', 'business_developer'), false) then
		raise exception 'forbidden' using errcode = '42501';
	end if;
	if p_recipient_id is null or not exists (
		select 1 from public.workspace_members wm
		 where wm.workspace_id = v_message.workspace_id and wm.user_id = p_recipient_id
	) then
		raise exception 'recipient_not_member' using errcode = '22023';
	end if;
	if p_recipient_id = v_appelant then
		raise exception 'self_transfer' using errcode = '22023';
	end if;
	insert into public.mail_message_transfers (message_id, recipient_id, workspace_id, transferred_by)
	values (p_message_id, p_recipient_id, v_message.workspace_id, v_appelant)
	on conflict (message_id, recipient_id) do nothing;
	get diagnostics v_neuf = row_count;
	if v_neuf > 0 and p_notifier then
		perform app.notifier_transfert(p_message_id, p_recipient_id, 1);
	end if;
	return v_neuf > 0;
end;
$$;
revoke all on function app.transferer_message(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function public.transfer_message(p_message_id uuid, p_recipient_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
	select app.transferer_message(p_message_id, p_recipient_id, true);
$$;
comment on function public.transfer_message(uuid, uuid) is
	'CRM-156 §32.7 — transfère un mail à un membre : aucun envoi ; la lecture lui est ouverte et une notification écrite. '
	'Rend faux, sans seconde notification, quand le transfert existait.';
revoke all on function public.transfer_message(uuid, uuid) from public, anon;
grant execute on function public.transfer_message(uuid, uuid) to authenticated;

create or replace function public.remove_message_transfer(p_message_id uuid, p_recipient_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_ligne    public.mail_message_transfers%rowtype;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	select * into v_ligne from public.mail_message_transfers t
	 where t.message_id = p_message_id and t.recipient_id = p_recipient_id;
	if v_ligne.message_id is null or not app.peut_voir_message(p_message_id) then
		perform app.raise_http_error(404, 'transfer_not_found');
	end if;
	-- L'auteur du transfert et son destinataire, et eux seuls.
	if v_appelant is distinct from v_ligne.transferred_by and v_appelant <> v_ligne.recipient_id then
		raise exception 'forbidden' using errcode = '42501';
	end if;
	delete from public.mail_message_transfers t
	 where t.message_id = p_message_id and t.recipient_id = p_recipient_id;
	return true;
end;
$$;
comment on function public.remove_message_transfer(uuid, uuid) is
	'CRM-156 §32.7 — retire un transfert ; permis à son auteur et à son destinataire. Referme la seule voie de lecture '
	'qu''il ouvrait.';
revoke all on function public.remove_message_transfer(uuid, uuid) from public, anon;
grant execute on function public.remove_message_transfer(uuid, uuid) to authenticated;

-- =============================================================================================
-- 2. Le blocage d'un expéditeur — §32.8
-- =============================================================================================

create table if not exists public.mail_blocked_senders (
	workspace_id uuid not null references public.workspaces (id) on delete cascade,
	address      text not null,
	blocked_by   uuid references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	primary key (workspace_id, address),
	constraint mail_blocked_senders_address_check
		check (address = lower(btrim(address)) and address ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);

comment on table public.mail_blocked_senders is
	'CRM-156 §32.8 — les expéditeurs bloqués d''un espace : leurs mails reçus et à venir vont à la corbeille de l''inbox. '
	'Écrit par un administrateur, par les fonctions seules.';

alter table public.mail_blocked_senders enable row level security;
revoke all on public.mail_blocked_senders from anon, authenticated;
grant select on public.mail_blocked_senders to authenticated;
drop policy if exists mail_blocked_senders_lecture on public.mail_blocked_senders;
create policy mail_blocked_senders_lecture on public.mail_blocked_senders
	for select to authenticated
	using (app.is_workspace_member(workspace_id));

-- L'adresse ramenée à sa forme stockée, ou le refus `invalid_address`.
create or replace function app.adresse_bloquable(p_address text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
	v text := lower(btrim(p_address));
begin
	if v is null or v !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
		raise exception 'invalid_address' using errcode = '22023';
	end if;
	return v;
end;
$$;
revoke all on function app.adresse_bloquable(text) from public, anon, authenticated;

-- La garde commune : connecté, administrateur de l'espace.
create or replace function app.garde_blocage(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	if p_workspace_id is null or not app.is_workspace_admin(p_workspace_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;
end;
$$;
revoke all on function app.garde_blocage(uuid) from public, anon, authenticated;

create or replace function public.blocked_sender_impact(p_workspace_id uuid, p_address text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_adresse text;
begin
	perform app.garde_blocage(p_workspace_id);
	v_adresse := app.adresse_bloquable(p_address);
	return (select count(*)::integer from public.mail_messages m
	         where m.workspace_id = p_workspace_id and m.direction = 'inbound' and m.deleted_at is null
	           and lower(btrim(m.from_address)) = v_adresse);
end;
$$;
comment on function public.blocked_sender_impact(uuid, text) is
	'CRM-156 §32.8 — le nombre de mails reçus de l''adresse, hors corbeille, dans l''espace : celui que la double '
	'confirmation annonce. Administrateur seulement.';
revoke all on function public.blocked_sender_impact(uuid, text) from public, anon;
grant execute on function public.blocked_sender_impact(uuid, text) to authenticated;

create or replace function public.block_sender(p_workspace_id uuid, p_address text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_adresse text;
	v_faits   integer := 0;
	v_refus   jsonb := '{}'::jsonb;
	v_ligne   record;
	v_etat    text;
	v_msg     text;
	v_code    text;
begin
	perform app.garde_blocage(p_workspace_id);
	v_adresse := app.adresse_bloquable(p_address);
	insert into public.mail_blocked_senders (workspace_id, address, blocked_by)
	values (p_workspace_id, v_adresse, (select auth.uid()))
	on conflict (workspace_id, address) do nothing;
	-- Les reçus encore hors corbeille, dans TOUT l'espace (décision 947), par le corps de `delete_message`, sans
	-- déplacement IMAP : la corbeille de l'inbox seulement. L'événement `mail_deleted` est écrit pour un classé.
	for v_ligne in
		select m.id from public.mail_messages m
		 where m.workspace_id = p_workspace_id and m.direction = 'inbound' and m.deleted_at is null
		   and lower(btrim(m.from_address)) = v_adresse
		 order by m.id
	loop
		begin
			perform public.delete_message(v_ligne.id, false);
			v_faits := v_faits + 1;
		exception when sqlstate '42501' or sqlstate '22023' or sqlstate 'PGRST' then
			get stacked diagnostics v_etat = returned_sqlstate, v_msg = message_text;
			v_code := app.code_refus_unitaire(v_etat, v_msg);
			if v_code is null then raise; end if;
			v_refus := pg_catalog.jsonb_set(v_refus, array[v_code],
				pg_catalog.to_jsonb(coalesce((v_refus ->> v_code)::integer, 0) + 1));
		end;
	end loop;
	return pg_catalog.jsonb_build_object('address', v_adresse, 'trashed', v_faits, 'refused', v_refus);
end;
$$;
comment on function public.block_sender(uuid, text) is
	'CRM-156 §32.8 — bloque une adresse pour tout l''espace (administrateur) : ses mails reçus vont à la corbeille de '
	'l''inbox, et les prochains y arrivent directement. Rend le nombre mis à la corbeille.';
revoke all on function public.block_sender(uuid, text) from public, anon;
grant execute on function public.block_sender(uuid, text) to authenticated;

create or replace function public.unblock_sender(p_workspace_id uuid, p_address text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_retirees integer;
begin
	perform app.garde_blocage(p_workspace_id);
	delete from public.mail_blocked_senders b
	 where b.workspace_id = p_workspace_id and b.address = app.adresse_bloquable(p_address);
	get diagnostics v_retirees = row_count;
	-- Les mails déjà mis à la corbeille y restent : ils se restaurent comme les autres (§32.8).
	return v_retirees > 0;
end;
$$;
comment on function public.unblock_sender(uuid, text) is
	'CRM-156 §32.8 — débloque une adresse (administrateur). Les mails déjà en corbeille y restent.';
revoke all on function public.unblock_sender(uuid, text) from public, anon;
grant execute on function public.unblock_sender(uuid, text) to authenticated;

-- À LA RÉCEPTION : un mail reçu d'une adresse bloquée naît en corbeille. Le déclencheur `BEFORE UPDATE` de la corbeille
-- (`mail_messages_corbeille_avant_ecriture`) ne joue pas à l'insertion : `deleted_by` est l'administrateur qui a bloqué.
create or replace function app.mail_messages_expediteur_bloque()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_bloque_par uuid;
	v_trouve     boolean;
begin
	if new.direction = 'inbound' and new.deleted_at is null and new.from_address is not null then
		select true, b.blocked_by into v_trouve, v_bloque_par
		  from public.mail_blocked_senders b
		 where b.workspace_id = new.workspace_id and b.address = lower(btrim(new.from_address));
		if v_trouve then
			new.deleted_at := now();
			new.deleted_by := v_bloque_par;
		end if;
	end if;
	return new;
end;
$$;
revoke all on function app.mail_messages_expediteur_bloque() from public, anon, authenticated;

drop trigger if exists mail_messages_expediteur_bloque on public.mail_messages;
create trigger mail_messages_expediteur_bloque before insert on public.mail_messages
	for each row execute function app.mail_messages_expediteur_bloque();

-- Le classement automatique écarte un message en corbeille (la reprise de la définition en vigueur, un seul ajout).
create or replace function public.classer_message_automatiquement(p_message_id uuid, p_in_reply_to text DEFAULT NULL::text, p_references text[] DEFAULT NULL::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
	v_message         public.mail_messages%rowtype;
	v_card            uuid;
	v_cards_suggerees uuid[];
	v_suggestion      uuid;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		perform app.raise_http_error(404, 'message_not_found');
	end if;

	-- `CRM-156` T2 (§32.8) : un message EN CORBEILLE n'est pas classé — c'est le cas d'un mail d'un expéditeur bloqué, posé
	-- directement en corbeille par `app.mail_messages_expediteur_bloque`. Ni classement, ni suggestion, ni événement.
	if v_message.deleted_at is not null then
		return null;
	end if;

	-- Un message DÉJÀ classé n'est pas reclassé : la règle 1 a parlé une fois, et un second
	-- passage de la relève ne doit pas déplacer du courrier.
	if v_message.classification <> 'unclassified' then
		return v_message.card_id;
	end if;

	-- RÈGLE 1 — une adresse de card figure parmi les destinataires.
	v_card := app.card_par_adresse(
		v_message.workspace_id,
		v_message.to_addresses || v_message.cc_addresses
	);

	-- RÈGLE 2 — la filiation, et seulement si la règle 1 n'a rien dit.
	if v_card is null and (p_in_reply_to is not null or p_references is not null) then
		select m.card_id into v_card
		  from public.mail_messages m
		 where m.workspace_id = v_message.workspace_id
		   and m.card_id is not null
		   and m.rfc822_message_id = any (
		         coalesce(p_references, array[]::text[]) ||
		         case when p_in_reply_to is null then array[]::text[] else array[p_in_reply_to] end
		       )
		 order by m.received_at desc
		 limit 1;

		-- La card du parent peut avoir été archivée depuis : la règle 2 hérite alors du refus de
		-- la règle 1, faute de quoi la filiation contournerait la règle du §16.2.
		if v_card is not null and not exists (
			select 1 from public.cards c
			 where c.id = v_card and app.card_has_active_placement(c.id) and c.deleted_at is null
		) then
			v_card := null;
		end if;
	end if;

	-- RÈGLE 3 — l'expéditeur est un contact rattaché à EXACTEMENT UNE card active : on SUGGÈRE, on
	-- ne classe pas. Atteinte seulement quand les règles 1 et 2 sont muettes. L'unicité partielle
	-- (workspace_id, lower(email)) de `contacts` garantit AU PLUS un contact par email ; l'ambiguïté
	-- à trancher est donc du côté des CARDS. Une card archivée ou en corbeille ne compte pas, comme
	-- la règle 1 refuse de classer dans une card rangée (§16.2, docs/SPEC-contacts.md §8.2).
	if v_card is null then
		select array_agg(distinct cc.card_id)
		  into v_cards_suggerees
		  from public.contacts ct
		  join public.card_contacts cc
		    on cc.contact_id = ct.id and cc.workspace_id = ct.workspace_id
		  join public.cards c
		    on c.id = cc.card_id and c.workspace_id = cc.workspace_id
		 where ct.workspace_id = v_message.workspace_id
		   and ct.email is not null
		   and lower(ct.email) = lower(btrim(v_message.from_address))
		   and app.card_has_active_placement(c.id)
		   and c.deleted_at is null;

		-- EXACTEMENT une : zéro n'invente rien, deux ou plus se tait plutôt que de choisir au
		-- hasard. On écrit la suggestion calculée — ou on l'efface —, de sorte qu'un second passage
		-- de la relève rende un résultat déterministe (docs/SPEC-contacts.md §8.3).
		if v_cards_suggerees is not null and array_length(v_cards_suggerees, 1) = 1 then
			v_suggestion := v_cards_suggerees[1];
		else
			v_suggestion := null;
		end if;

		update public.mail_messages m
		   set suggested_card_id = v_suggestion,
		       suggested_at = case when v_suggestion is null then null else now() end
		 where m.id = p_message_id;

		-- RÈGLE 4 — la règle 3 ne classe pas : le message reste non classé. Ce n'est pas une erreur.
		return null;
	end if;

	update public.mail_messages m
	   set card_id = v_card,
	       classification = 'auto',
	       classified_at = now()
	 where m.id = p_message_id;

	perform app.card_event_ecrire(
		v_card,
		v_message.workspace_id,
		'mail_received',
		jsonb_build_object('message_id', p_message_id, 'rule', 'auto')
	);

	-- Les pièces jointes suivent leur message : `card_id` y est recopié pour un accès direct
	-- depuis la card (docs/SCHEMA.md §12).
	update public.mail_attachments a set card_id = v_card where a.message_id = p_message_id;

	return v_card;
end;
$$;

-- =============================================================================================
-- 3. Les expéditeurs inconnus d'une sélection, et la source des contacts — §32.10
-- =============================================================================================

create or replace function public.inbox_bulk_unknown_senders(p_scope jsonb)
returns table (workspace_id uuid, address text, suggested_name text, suggested_organization_id uuid,
               suggested_organization_name text, message_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	return query
	with recus as (
		select p.workspace_id, lower(btrim(m.from_address)) as adresse, m.from_name, m.received_at
		  from app.inbox_scope_messages(p_scope) p
		  join public.mail_messages m on m.id = p.message_id
		 where p.direction = 'inbound' and m.from_address is not null
	), adresses as (
		select r.workspace_id, r.adresse, count(*)::integer as nombre,
		       (array_agg(nullif(btrim(r.from_name), '') order by r.received_at desc)
		          filter (where nullif(btrim(r.from_name), '') is not null))[1] as nom
		  from recus r
		 group by r.workspace_id, r.adresse
	)
	select a.workspace_id, a.adresse, coalesce(a.nom, split_part(a.adresse, '@', 1)), o.id, o.name, a.nombre
	  from adresses a
	  left join lateral (
		select o.id, o.name from public.organizations o
		 where o.workspace_id = a.workspace_id
		   and lower(o.domain) = split_part(a.adresse, '@', 2)
		   and app.can_read_organization(o.id)
		 order by o.created_at, o.id limit 1
	  ) o on true
	 where not exists (
		select 1 from public.contacts c where c.workspace_id = a.workspace_id and lower(c.email) = a.adresse)
	 order by a.workspace_id, a.adresse;
end;
$$;
comment on function public.inbox_bulk_unknown_senders(jsonb) is
	'CRM-156 §32.10 — les expéditeurs des mails reçus de la portée sans contact de même adresse dans leur espace, avec le '
	'nom et l''organisation proposés.';
revoke all on function public.inbox_bulk_unknown_senders(jsonb) from public, anon;
grant execute on function public.inbox_bulk_unknown_senders(jsonb) to authenticated;

-- `import_contacts` gagne `p_source` : l'ancienne signature est remplacée, ses droits rendus.
drop function if exists public.import_contacts(uuid, jsonb, boolean);
create or replace function public.import_contacts(p_workspace uuid, p_rows jsonb, p_dry_run boolean default true,
                                                  p_source text default 'import')
 RETURNS TABLE(line integer, outcome text, code text, contact_id uuid, organization_id uuid, organization_created boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $$
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
	-- `CRM-156` T2 (§32.10) : la source du contact créé — `import` par défaut, `email` pour la création depuis les expéditeurs
	-- de l'inbox. Les deux valeurs que `contacts_source_check` admet hors `manual`.
	if p_source is null or p_source not in ('import', 'email') then
		raise exception 'invalid_source' using errcode = '22023';
	end if;
	if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
		raise exception 'invalid_rows' using errcode = '22023';
	end if;
	if pg_catalog.jsonb_array_length(p_rows) > 1000 then
		raise exception 'import_too_large' using errcode = '22023';
	end if;
	-- L'espace, lu sous la RLS de la personne : un espace dont elle n'est pas membre n'existe pas pour elle.
	if not exists (select 1 from public.workspaces w where w.id = p_workspace) then
		perform app.raise_http_error(404, 'workspace_not_found');
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
							values (p_workspace, v_org, v_nom, v_email, v_telephone, v_fonction, p_source)
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
revoke all on function public.import_contacts(uuid, jsonb, boolean, text) from public, anon;
grant execute on function public.import_contacts(uuid, jsonb, boolean, text) to authenticated, service_role;

-- =============================================================================================
-- 4. L'action groupée `transfer` — §32.5, §32.7
-- =============================================================================================

create or replace function app.code_refus_unitaire(p_sqlstate text, p_message text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
	v_code text := p_message;
begin
	if p_sqlstate = 'PGRST' then
		begin
			v_code := p_message::jsonb ->> 'message';
		exception when others then
			return null;
		end;
	end if;
	-- LA LISTE FERMÉE des refus que les fonctions unitaires nomment (§32.5). Un code hors de cette liste est une panne :
	-- l'appel entier échoue, et rien n'est écrit.
	if v_code in ('forbidden', 'message_not_found', 'card_not_available', 'no_writable_mailbox', 'label_not_found',
	              'label_archived', 'outbound_message', 'thread_not_found', 'snooze_date_in_past',
	              'snooze_date_required', 'recipient_not_member', 'self_transfer') then
		return v_code;
	end if;
	return null;
end;
$$;

revoke all on function app.code_refus_unitaire(text, text) from public, anon, authenticated;

create or replace function public.inbox_bulk_apply(p_scope jsonb, p_action text, p_argument jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	c_paquet   constant integer := 2000;
	v_dossier  text;
	v_card     uuid;
	v_jusqua   timestamptz;
	v_pastille uuid;
	v_posee    boolean;
	v_boite    boolean;
	v_apres_m  uuid;
	v_apres_w  uuid;
	v_apres_f  text;
	v_suivant  jsonb;
	v_fils     integer := 0;
	v_nombre   integer := 0;
	v_faits    integer := 0;
	v_refus    jsonb := '{}'::jsonb;
	v_code     text;
	v_etat     text;
	v_msg      text;
	v_ligne    record;
	v_lot      uuid[];
	v_par_fil  boolean;
	v_dest     uuid;
	v_nouveaux integer := 0;
	v_premier  uuid;
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	v_dossier := p_scope ->> 'folder';

	-- --- L'action et son argument, avant toute lecture --------------------------------------------------------------
	if p_action is null or p_action not in ('classify', 'unclassify', 'delete', 'restore', 'mark_read', 'mark_unread',
	                                        'snooze', 'wake', 'set_label', 'request_label_evaluation', 'transfer') then
		raise exception 'invalid_action' using errcode = '22023';
	end if;
	v_par_fil := p_action in ('snooze', 'wake');
	begin
		if p_action = 'classify' then
			v_card := (p_argument ->> 'card_id')::uuid;
			if v_card is null then raise exception 'invalid_action' using errcode = '22023'; end if;
		elsif p_action = 'snooze' then
			v_jusqua := (p_argument ->> 'until')::timestamptz;
			if v_jusqua is null then raise exception 'invalid_action' using errcode = '22023'; end if;
		elsif p_action = 'set_label' then
			v_pastille := (p_argument ->> 'label_id')::uuid;
			v_posee := (p_argument ->> 'applied')::boolean;
			if v_pastille is null or v_posee is null then raise exception 'invalid_action' using errcode = '22023'; end if;
		elsif p_action = 'delete' then
			v_boite := coalesce((p_argument ->> 'also_mailbox')::boolean, false);
		elsif p_action = 'transfer' then
			v_dest := (p_argument ->> 'recipient_id')::uuid;
			if v_dest is null then raise exception 'invalid_action' using errcode = '22023'; end if;
		end if;
	exception when data_exception then
		raise exception 'invalid_action' using errcode = '22023';
	end;

	-- --- Le curseur : un identifiant de message, ou, pour le sommeil, le couple [workspace_id, thread_key] -------------
	begin
		if pg_catalog.jsonb_typeof(p_scope -> 'after') is not null and pg_catalog.jsonb_typeof(p_scope -> 'after') <> 'null' then
			if v_par_fil then
				if pg_catalog.jsonb_typeof(p_scope -> 'after') <> 'array' or pg_catalog.jsonb_array_length(p_scope -> 'after') <> 2
				   or (p_scope -> 'after' ->> 1) is null then
					raise exception 'invalid_scope' using errcode = '22023';
				end if;
				v_apres_w := (p_scope -> 'after' ->> 0)::uuid;
				v_apres_f := p_scope -> 'after' ->> 1;
			else
				if pg_catalog.jsonb_typeof(p_scope -> 'after') <> 'string' then
					raise exception 'invalid_scope' using errcode = '22023';
				end if;
				v_apres_m := (p_scope ->> 'after')::uuid;
			end if;
		end if;
	exception when data_exception then
		raise exception 'invalid_scope' using errcode = '22023';
	end;

	-- --- La portée (ses refus : invalid_scope, filter_required) -------------------------------------------------------
	-- Les tables de travail vivent le temps de la transaction ; un second appel dans la même transaction les vide.
	if pg_catalog.to_regclass('pg_temp.inbox_bulk_portee') is null then
		create temp table inbox_bulk_portee (message_id uuid, workspace_id uuid, thread_key text, direction text)
			on commit drop;
		create temp table inbox_bulk_paquet (message_id uuid, workspace_id uuid, thread_key text, direction text)
			on commit drop;
		create temp table inbox_bulk_fils (workspace_id uuid, thread_key text) on commit drop;
	end if;
	truncate pg_temp.inbox_bulk_portee, pg_temp.inbox_bulk_paquet, pg_temp.inbox_bulk_fils;
	insert into pg_temp.inbox_bulk_portee select * from app.inbox_scope_messages(p_scope);

	-- §32.5 point 4 — ce qui se fait où : restaurer dans la corbeille seulement, et rien d'autre dans la corbeille ;
	-- déclasser dans une affaire seulement.
	if (p_action = 'restore') <> (v_dossier = 'trash')
	   or (p_action = 'unclassify' and v_dossier <> 'card') then
		raise exception 'action_not_allowed_here' using errcode = '22023';
	end if;

	-- --- Le paquet, et le curseur du suivant ------------------------------------------------------------------------
	if v_par_fil then
		insert into pg_temp.inbox_bulk_fils
		select distinct p.workspace_id, p.thread_key
		  from pg_temp.inbox_bulk_portee p
		 where v_apres_w is null or (p.workspace_id, p.thread_key) > (v_apres_w, v_apres_f)
		 order by 1, 2
		 limit c_paquet + 1;
		if (select pg_catalog.count(*) from pg_temp.inbox_bulk_fils) > c_paquet then
			delete from pg_temp.inbox_bulk_fils f
			 where (f.workspace_id, f.thread_key) = (select g.workspace_id, g.thread_key from pg_temp.inbox_bulk_fils g
			                                          order by g.workspace_id desc, g.thread_key desc limit 1);
			select pg_catalog.jsonb_build_array(f.workspace_id, f.thread_key) into v_suivant
			  from pg_temp.inbox_bulk_fils f order by f.workspace_id desc, f.thread_key desc limit 1;
		end if;
		insert into pg_temp.inbox_bulk_paquet
		select p.* from pg_temp.inbox_bulk_portee p
		  join pg_temp.inbox_bulk_fils f on f.workspace_id = p.workspace_id and f.thread_key = p.thread_key;
	else
		insert into pg_temp.inbox_bulk_paquet
		select p.* from pg_temp.inbox_bulk_portee p
		 where v_apres_m is null or p.message_id > v_apres_m
		 order by p.message_id
		 limit c_paquet + 1;
		if (select pg_catalog.count(*) from pg_temp.inbox_bulk_paquet) > c_paquet then
			delete from pg_temp.inbox_bulk_paquet q
			 where q.message_id = (select r.message_id from pg_temp.inbox_bulk_paquet r order by r.message_id desc limit 1);
			select pg_catalog.to_jsonb(q.message_id::text) into v_suivant
			  from pg_temp.inbox_bulk_paquet q order by q.message_id desc limit 1;
		end if;
	end if;

	select pg_catalog.count(distinct (p.workspace_id, p.thread_key))::integer, pg_catalog.count(*)::integer
	  into v_fils, v_nombre
	  from pg_temp.inbox_bulk_paquet p;

	-- --- Le sommeil porte sur des FILS --------------------------------------------------------------------------------
	if v_par_fil then
		for v_ligne in select f.workspace_id, f.thread_key from pg_temp.inbox_bulk_fils f order by 1, 2 loop
			begin
				if p_action = 'snooze' then
					perform public.snooze_thread(v_ligne.workspace_id, v_ligne.thread_key, v_jusqua);
				else
					perform public.wake_thread(v_ligne.workspace_id, v_ligne.thread_key);
				end if;
				v_faits := v_faits + 1;
			exception when sqlstate '42501' or sqlstate '22023' or sqlstate '23514' or sqlstate 'P0001'
			               or sqlstate 'PGRST' then
				get stacked diagnostics v_etat = returned_sqlstate, v_msg = message_text;
				v_code := app.code_refus_unitaire(v_etat, v_msg);
				if v_code is null then raise; end if;
				v_refus := pg_catalog.jsonb_set(v_refus, array[v_code],
					pg_catalog.to_jsonb(coalesce((v_refus ->> v_code)::integer, 0) + 1));
			end;
		end loop;

	-- --- Lu : par lots de 200, la borne de `mark_messages_read` ------------------------------------------------------
	-- Un message envoyé n'a pas d'état de lecture : il n'est ni fait, ni refusé (§32.5).
	elsif p_action = 'mark_read' then
		for v_lot in
			select pg_catalog.array_agg(q.message_id)
			  from (select p.message_id, (pg_catalog.row_number() over (order by p.message_id) - 1) / 200 as rang
			          from pg_temp.inbox_bulk_paquet p where p.direction = 'inbound') q
			 group by q.rang
		loop
			v_faits := v_faits + public.mark_messages_read(v_lot);
		end loop;

	-- --- Les autres : message par message, par la fonction unitaire ---------------------------------------------------
	else
		for v_ligne in select p.message_id, p.direction from pg_temp.inbox_bulk_paquet p order by p.message_id loop
			if p_action = 'mark_unread' and v_ligne.direction <> 'inbound' then
				continue;
			end if;
			begin
				case p_action
					when 'classify' then perform public.classify_message(v_ligne.message_id, v_card);
					when 'unclassify' then perform public.unclassify_message(v_ligne.message_id);
					when 'delete' then perform public.delete_message(v_ligne.message_id, v_boite);
					when 'restore' then perform public.restore_message(v_ligne.message_id);
					when 'mark_unread' then perform public.mark_message_unread(v_ligne.message_id);
					when 'set_label' then perform public.set_message_label(v_ligne.message_id, v_pastille, v_posee);
					when 'request_label_evaluation' then perform public.request_label_evaluation(v_ligne.message_id);
					-- `CRM-156` T2 (§32.7) : le transfert, sans notification par message ; une seule pour l'appel, plus bas.
					when 'transfer' then
						if app.transferer_message(v_ligne.message_id, v_dest, false) then
							v_nouveaux := v_nouveaux + 1;
							v_premier := coalesce(v_premier, v_ligne.message_id);
						end if;
				end case;
				v_faits := v_faits + 1;
			exception when sqlstate '42501' or sqlstate '22023' or sqlstate '23514' or sqlstate 'P0001'
			               or sqlstate 'PGRST' then
				get stacked diagnostics v_etat = returned_sqlstate, v_msg = message_text;
				v_code := app.code_refus_unitaire(v_etat, v_msg);
				if v_code is null then raise; end if;
				v_refus := pg_catalog.jsonb_set(v_refus, array[v_code],
					pg_catalog.to_jsonb(coalesce((v_refus ->> v_code)::integer, 0) + 1));
			end;
		end loop;
	end if;

	-- §32.7 — UNE notification pour le paquet, et seulement si un transfert au moins a été écrit.
	if p_action = 'transfer' and v_nouveaux > 0 then
		perform app.notifier_transfert(v_premier, v_dest, v_nouveaux);
	end if;

	return pg_catalog.jsonb_build_object('threads', v_fils, 'messages', v_nombre, 'done', v_faits, 'refused', v_refus,
	                                     'next', v_suivant);
end;
$$;

comment on function public.inbox_bulk_apply(jsonb, text, jsonb) is
	'CRM-156 §32.5, §32.5 bis — une action groupée, un paquet de 2 000 messages (2 000 fils pour le sommeil) après le '
	'curseur `after` : chaque élément passé par la fonction unitaire dans un bloc qui capte ses refus nommés ; une panne '
	'défait le paquet. Rend threads, messages, done, refused (code -> nombre) et next (le curseur suivant, nul après le '
	'dernier).';

revoke all on function public.inbox_bulk_apply(jsonb, text, jsonb) from public, anon;
grant execute on function public.inbox_bulk_apply(jsonb, text, jsonb) to authenticated;
