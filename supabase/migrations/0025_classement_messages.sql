-- @spec CRM-055 (docs/BACKLOG.md) — classement assisté des messages
-- @spec docs/SPEC-mail-subsystem.md §4.4 (les quatre règles), §16.2 (la chaîne), §16.3 (le
--       classement manuel et son événement)
-- @spec docs/SPEC-cards.md §14 (timeline) ; docs/SCHEMA.md §12
-- @spec docs/JOURNAL.md décision 321 (l'ingestion, dont celle-ci hérite)
--
-- CETTE MIGRATION AJOUTE UN ONZIÈME TYPE D'ÉVÉNEMENT, ET C'EST UN CHOIX.
--
-- La timeline est la mémoire d'une card : un message qui y entre est un fait, et le taire
-- laisserait un trou entre deux commentaires. Les dix types existants sont conservés tels quels.

-- =============================================================================================
-- 1. Qui a classé, et quand
-- =============================================================================================

alter table public.mail_messages
	add column if not exists classified_by uuid references public.profiles (id) on delete set null;

alter table public.mail_messages
	add column if not exists classified_at timestamptz;

comment on column public.mail_messages.classified_by is
	'CRM-055 — qui a classé le message À LA MAIN. Nul pour un classement automatique : la règle 1 '
	'ou 2 n''a pas d''auteur, et prétendre le contraire attribuerait un geste à quelqu''un.';

-- =============================================================================================
-- 2. L'événement `mail_received` — onzième type
-- =============================================================================================

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname = 'card_events_type_check'
		   and pg_get_constraintdef(oid) like '%mail_received%'
	) and not exists (
		-- INC-144 — la garde ci-dessus regarde la contrainte ; celle-ci regarde les lignes. Sur
		-- une base peuplée dont la contrainte a été déposée, `snoozed` et `woken` sont déjà écrits
		-- et ces onze valeurs seraient refusées. La migration 44 reste alors seule responsable
		-- d'installer le vocabulaire complet.
		select 1 from public.card_events
		 where type <> all (array[
			'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
			'archived', 'unarchived', 'trashed', 'restored', 'field_changed', 'mail_received'])
	) then
		alter table public.card_events drop constraint if exists card_events_type_check;
		alter table public.card_events add constraint card_events_type_check
			check (type = any (array[
				'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
				'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
				'mail_received'
			]));
	end if;
end;
$$;

-- =============================================================================================
-- 3. La reconnaissance d'une adresse de card — règle 1
-- =============================================================================================
--
-- UNE ADRESSE SE RECONNAÎT À SA FORME **ET** À SON DOMAINE (§16.2). La forme seule laisserait un
-- correspondant écrire à `c-abcd1234@son-domaine.tld` sans que cela désigne quoi que ce soit ; le
-- domaine seul laisserait passer `contact@crm.p2enjoy.test`.
--
-- UNE CARD ARCHIVÉE OU EN CORBEILLE NE REÇOIT PAS : classer dans une card qu'on a rangée
-- ramènerait du courrier dans un dossier que l'utilisateur a fermé.

create or replace function app.card_par_adresse(p_workspace_id uuid, p_adresses text[])
returns uuid
language sql
security definer
set search_path = ''
stable
as $$
	select c.id
	  from public.cards c
	  join public.workspaces w on w.id = c.workspace_id
	 where c.workspace_id = p_workspace_id
	   and c.archived_at is null
	   and c.deleted_at is null
	   and lower(c.email_local_part || '@' || w.inbound_domain) = any (
	         select lower(btrim(adresse)) from unnest(p_adresses) as adresse
	       )
	 limit 1;
$$;

comment on function app.card_par_adresse(uuid, text[]) is
	'CRM-055 règle 1 : la card dont l''adresse figure parmi celles du message. Forme ET domaine, '
	'et jamais une card archivée ou en corbeille. docs/SPEC-mail-subsystem.md §16.2.';

-- =============================================================================================
-- 4. Le classement automatique — règles 1, 2 et 4
-- =============================================================================================
--
-- L'ORDRE EST CELUI DU §4.4, ET IL S'ARRÊTE À LA PREMIÈRE RÈGLE SATISFAITE. Ce n'est pas une
-- optimisation : c'est ce qui rend le classement déterministe. La règle 3 n'apparaît pas — elle
-- suppose des contacts, qu'aucune table ne porte (`CRM-060`), et une suggestion fondée sur rien
-- serait pire qu'aucune suggestion.

create or replace function public.classer_message_automatiquement(
	p_message_id uuid,
	p_in_reply_to text default null,
	p_references text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
	v_card    uuid;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		raise exception 'message_not_found' using errcode = 'P0002';
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
			 where c.id = v_card and c.archived_at is null and c.deleted_at is null
		) then
			v_card := null;
		end if;
	end if;

	-- RÈGLE 4 — rien ne s'applique, et le message reste non classé. Ce n'est pas une erreur.
	if v_card is null then
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

comment on function public.classer_message_automatiquement is
	'CRM-055 — règles 1, 2 et 4 du §4.4, arrêtées à la première satisfaite. La règle 3 est '
	'désactivée faute de contacts (CRM-060). Réservée à service_role : le classement automatique '
	'est un constat de la relève.';

-- =============================================================================================
-- 5. Le classement manuel
-- =============================================================================================

create or replace function public.classify_message(p_message_id uuid, p_card_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
	v_appelant uuid := (select auth.uid());
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		raise exception 'message_not_found' using errcode = 'P0002';
	end if;

	-- CLASSER UN MESSAGE Y AJOUTE DU CONTENU : le droit d'ÉCRITURE est exigé, non celui de
	-- lecture. C'est la même règle que pour un commentaire (docs/SPEC-cards.md §13.6).
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	if not exists (
		select 1 from public.cards c
		 where c.id = p_card_id
		   and c.workspace_id = v_message.workspace_id
		   and c.archived_at is null
		   and c.deleted_at is null
	) then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- IDEMPOTENT : reclasser dans la MÊME card ne produit pas un second événement. Un utilisateur
	-- qui clique deux fois ne raconte pas deux histoires.
	if v_message.card_id = p_card_id then
		return p_card_id;
	end if;

	update public.mail_messages m
	   set card_id = p_card_id,
	       classification = 'manual',
	       classified_by = v_appelant,
	       classified_at = now()
	 where m.id = p_message_id;

	perform app.card_event_ecrire(
		p_card_id,
		v_message.workspace_id,
		'mail_received',
		jsonb_build_object('message_id', p_message_id, 'rule', 'manual')
	);

	update public.mail_attachments a set card_id = p_card_id where a.message_id = p_message_id;

	return p_card_id;
end;
$$;

comment on function public.classify_message(uuid, uuid) is
	'CRM-055 §16.3 — classement manuel. Exige le droit d''ÉCRITURE sur la card, journalise son '
	'auteur, écrit un card_event `mail_received`, et reste idempotent.';

revoke all on function public.classer_message_automatiquement(uuid, text, text[])
	from public, anon, authenticated;
grant execute on function public.classer_message_automatiquement(uuid, text, text[]) to service_role;

revoke all on function public.classify_message(uuid, uuid) from public, anon;
grant execute on function public.classify_message(uuid, uuid) to authenticated, service_role;

revoke all on function app.card_par_adresse(uuid, text[]) from public, anon, authenticated;
grant execute on function app.card_par_adresse(uuid, text[]) to service_role;
