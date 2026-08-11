-- @spec CRM-058 (docs/BACKLOG.md) — composition, réponse et file d'envoi
-- @spec docs/SPEC-mail-subsystem.md §5 (envoi), §19.3 (les deux colonnes manquantes), §19.4 (la
--       file et ses six refus), §19.5 (ce que le worker compose)
-- @spec docs/SCHEMA.md §7 (`mail_outbox`) ; docs/SPEC-permissions-rls.md §4
-- @spec docs/JOURNAL.md décision 330
--
-- CE QUE LA MESURE A IMPOSÉ À CETTE MIGRATION (§19.1).
--
-- Le serveur ne réécrit PAS le `Message-ID` : celui que le produit choisit est celui que le
-- destinataire citera dans sa réponse. Il est donc mémorisé, et devient la charnière du fil.
--
-- Le `Reply-To` passe tel quel, même vers l'adresse d'une card qui n'existe pas : sa justesse est
-- une responsabilité entière du produit. La garde refuse donc AVANT la file une card sans adresse,
-- plutôt que de laisser partir un message dont la réponse ne reviendrait nulle part.

-- =============================================================================================
-- 1. Deux colonnes que `mail_messages` n'avait pas — §19.3
-- =============================================================================================

alter table public.mail_messages
	add column if not exists direction text not null default 'inbound';

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.mail_messages'::regclass
		   and conname = 'mail_messages_direction'
	) then
		alter table public.mail_messages add constraint mail_messages_direction
			check (direction in ('inbound', 'outbound'));
	end if;
end;
$$;

alter table public.mail_messages
	add column if not exists references_ids text[] not null default '{}';

comment on column public.mail_messages.direction is
	'CRM-058 §19.3 — `inbound` reçu, `outbound` écrit par le produit. Sans cette colonne, un '
	'message que nous avons écrit s''afficherait comme reçu, et la règle 2 du §4.4 pourrait '
	'rattacher une réponse à notre PROPRE envoi comme s''il venait du correspondant.';

comment on column public.mail_messages.references_ids is
	'CRM-058 §19.3 — la chaîne `References` du message, dans l''ordre. Sans elle, une réponse ne '
	'citerait que son parent, et un client de messagerie couperait le fil au deuxième aller-retour.';

-- =============================================================================================
-- 2. Le douzième type d'événement — `mail_sent`
-- =============================================================================================
--
-- CONDITIONNÉ, comme l'onzième : le `migrations-runner` rejoue TOUT le répertoire à chaque
-- démarrage, et une contrainte qui se re-rétrécirait empêcherait la pile de redémarrer
-- (docs/JOURNAL.md décision 325).

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname = 'card_events_type_check'
		   and pg_get_constraintdef(oid) like '%mail_sent%'
	) then
		alter table public.card_events drop constraint if exists card_events_type_check;
		alter table public.card_events add constraint card_events_type_check
			check (type = any (array[
				'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
				'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
				'mail_received', 'mail_sent'
			]));
	end if;
end;
$$;

-- =============================================================================================
-- 3. La file d'envoi — docs/SCHEMA.md §7
-- =============================================================================================

create table if not exists public.mail_outbox (
	id            uuid primary key default gen_random_uuid(),
	workspace_id  uuid not null references public.workspaces (id) on delete cascade,
	identity_id   uuid not null references public.mail_outbound_identities (id) on delete cascade,
	-- LA CARD N'EST PAS FACULTATIVE : c'est elle qui porte le `Reply-To`, donc le retour des
	-- réponses dans le CRM. Un envoi sans card serait un envoi sans retour.
	card_id       uuid not null references public.cards (id) on delete cascade,
	in_reply_to_message_id uuid references public.mail_messages (id) on delete set null,
	to_addrs      text[] not null,
	cc_addrs      text[] not null default '{}',
	subject       text,
	body_text     text not null,
	-- La colonne existe, rien ne l'alimente : les pièces jointes à l'envoi ne sont PAS livrées, et
	-- l'absence est figée par une assertion plutôt que commentée (§19.8).
	attachments   jsonb not null default '[]'::jsonb,
	status        text not null default 'queued',
	attempts      integer not null default 0,
	next_attempt_at timestamptz not null default now(),
	last_error    text,
	-- Le `Message-ID` CHOISI PAR LE PRODUIT, mémorisé avant l'envoi : le serveur ne le réécrit pas
	-- (§19.1), et c'est lui que le destinataire citera dans sa réponse.
	rfc822_message_id text,
	sent_message_id uuid references public.mail_messages (id) on delete set null,
	created_by    uuid references public.profiles (id) on delete set null,
	created_at    timestamptz not null default now(),
	updated_at    timestamptz not null default now(),
	sent_at       timestamptz,
	constraint mail_outbox_statut
		check (status in ('queued', 'sending', 'sent', 'failed', 'cancelled')),
	constraint mail_outbox_destinataire
		check (coalesce(array_length(to_addrs, 1), 0) >= 1),
	constraint mail_outbox_corps
		check (char_length(body_text) between 1 and 100000),
	constraint mail_outbox_tentatives check (attempts >= 0),
	-- Un `Message-ID` ne se réutilise pas : deux messages qui le partageraient seraient dédoublonnés
	-- l'un par l'autre à la relève suivante.
	constraint mail_outbox_identifiant_unique unique (rfc822_message_id)
);

comment on table public.mail_outbox is
	'CRM-058 §19.4 — file d''envoi persistante. Aucune écriture directe par un client : '
	'`queue_outbound_email` est la seule porte, et elle vérifie six choses avant d''ouvrir.';

create index if not exists mail_outbox_a_envoyer_idx
	on public.mail_outbox (status, next_attempt_at)
	where status = 'queued';

create index if not exists mail_outbox_card_idx on public.mail_outbox (card_id);

drop trigger if exists mail_outbox_updated_at on public.mail_outbox;
create trigger mail_outbox_updated_at
	before update on public.mail_outbox
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 4. Le quota journalier — §19.4
-- =============================================================================================
--
-- IL SE COMPTE SUR LES LIGNES EN VOL AUTANT QUE PARTIES. Compter les seuls envois réussis
-- laisserait mettre mille messages en file, qui partiraient tous : le quota protège le SERVEUR
-- D'ENVOI, pas la statistique.
--
-- LA JOURNÉE EST CELLE D'UTC, et c'est un choix explicite : la base ne connaît pas le fuseau de
-- l'utilisateur, et un quota qui se réinitialiserait à une heure différente selon qui regarde
-- serait impossible à expliquer.

create or replace function app.envois_du_jour(p_identity_id uuid)
returns integer
language sql
security definer
set search_path = ''
stable
as $$
	select count(*)::integer
	  from public.mail_outbox o
	 where o.identity_id = p_identity_id
	   and o.status in ('queued', 'sending', 'sent')
	   and o.created_at >= date_trunc('day', now() at time zone 'UTC');
$$;

comment on function app.envois_du_jour(uuid) is
	'CRM-058 §19.4 — envois de la journée UTC pour une identité, EN VOL compris. Compter les '
	'seuls `sent` laisserait mettre en file mille messages qui partiraient tous.';

-- =============================================================================================
-- 5. La garde — six refus, dans cet ordre — §19.4
-- =============================================================================================

create or replace function public.queue_outbound_email(
	p_card_id     uuid,
	p_identity_id uuid,
	p_to          text[],
	p_subject     text default null,
	p_body_text   text default '',
	p_cc          text[] default '{}',
	p_in_reply_to_message_id uuid default null
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
	v_file      uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- ENVOYER AU NOM D'UNE AFFAIRE, C'EST Y AJOUTER DU CONTENU : le droit d'ÉCRITURE est exigé,
	-- comme pour un commentaire ou un classement.
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and (
	     i.owner_id = v_appelant
	     -- L'identité de SERVICE — sans propriétaire — appartient au workspace : seuls ses
	     -- administrateurs l'empruntent.
	     or (i.owner_id is null and app.is_workspace_admin(i.workspace_id))
	   );
	if v_identite.id is null then
		raise exception 'identity_not_available' using errcode = 'P0002';
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

	-- LA CARD DOIT AVOIR UNE ADRESSE, et le motif est mesuré (§19.1) : le serveur transmet le
	-- `Reply-To` sans le vérifier. Un envoi dont la réponse ne reviendrait nulle part est pire
	-- qu'un envoi refusé.
	select c.email_local_part || '@' || w.inbound_domain into v_adresse
	  from public.cards c join public.workspaces w on w.id = c.workspace_id
	 where c.id = p_card_id and c.email_local_part is not null;
	if v_adresse is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	if coalesce(array_length(p_to, 1), 0) = 0 then
		raise exception 'recipient_required' using errcode = '23514';
	end if;

	-- LE QUOTA, PAR POLITESSE : la règle est celle du worker, qui dépense réellement (§19.4).
	-- Ce contrôle-ci rend le refus immédiat et visible par celui qui écrit.
	if v_identite.daily_quota is not null
		and app.envois_du_jour(p_identity_id) >= v_identite.daily_quota then
		raise exception 'quota_exceeded' using errcode = '23505';
	end if;

	insert into public.mail_outbox (
		workspace_id, identity_id, card_id, in_reply_to_message_id,
		to_addrs, cc_addrs, subject, body_text, created_by
	)
	values (
		v_identite.workspace_id, p_identity_id, p_card_id, p_in_reply_to_message_id,
		p_to, coalesce(p_cc, '{}'), p_subject, p_body_text, v_appelant
	)
	returning id into v_file;

	return v_file;
end;
$$;

comment on function public.queue_outbound_email is
	'CRM-058 §19.4 — seule porte de la file d''envoi. Six refus : not_authenticated, forbidden, '
	'identity_not_available, card_not_available (card fermée OU sans adresse), recipient_required, '
	'quota_exceeded. L''interface n''ouvre JAMAIS de connexion SMTP.';

-- =============================================================================================
-- 6. RLS et privilèges
-- =============================================================================================
--
-- LA LECTURE SUIT LA CARD : un envoi appartient à l'affaire au nom de laquelle il part. AUCUNE
-- écriture n'est ouverte au client — ni insertion, ni mise à jour, ni suppression : la file se
-- remplit par la garde et se vide par le worker.

alter table public.mail_outbox enable row level security;

drop policy if exists mail_outbox_lecture on public.mail_outbox;
create policy mail_outbox_lecture
	on public.mail_outbox
	for select
	to authenticated
	using (app.can_read_card(card_id));

revoke all on public.mail_outbox from anon, authenticated;
grant select on public.mail_outbox to authenticated;
grant all privileges on public.mail_outbox to service_role;

revoke all on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid)
	from public, anon;
grant execute on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid)
	to authenticated, service_role;

revoke all on function app.envois_du_jour(uuid) from public, anon;
grant execute on function app.envois_du_jour(uuid) to authenticated, service_role;

-- =============================================================================================
-- 7. Ce que le worker appelle — §19.5
-- =============================================================================================
--
-- LE WORKER N'ÉCRIT PAS DIRECTEMENT, ET CE N'EST PAS UN DÉTOUR. Un envoi réussi produit TROIS
-- effets — la file marquée, le message archivé, la timeline écrite — qui doivent être solidaires :
-- trois écritures séparées laisseraient, à la première coupure, un message envoyé dont la card ne
-- garde aucune trace. Et `card_events` n'accorde d'écriture à personne, `service_role` compris
-- (`CRM-044`) : seule une fonction du produit peut y inscrire un fait.

-- Un message SORTANT est né dans sa card : il n'a été classé par aucune règle. La valeur le dit,
-- plutôt que d'emprunter `auto` — qui signifierait qu'une règle du §4.4 s'est appliquée.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.mail_messages'::regclass
		   and conname = 'mail_messages_classification'
		   and pg_get_constraintdef(oid) like '%outbound%'
	) then
		alter table public.mail_messages drop constraint if exists mail_messages_classification;
		alter table public.mail_messages add constraint mail_messages_classification
			check (classification in ('unclassified', 'auto', 'manual', 'outbound'));
	end if;
end;
$$;

-- Les envois à traiter, RÉSERVÉS en même temps qu'ils sont rendus.
--
-- LE QUOTA EST VÉRIFIÉ ICI, ET C'EST L'AUTORITÉ (§19.4) : plusieurs messages peuvent avoir été
-- acceptés en file avant que le premier ne parte. Un envoi au-delà du quota passe `failed` avec son
-- motif, il n'est pas silencieusement laissé en attente — une file qui ne bouge plus sans rien dire
-- est pire qu'un refus.
create or replace function public.reserver_envois(p_limite integer default 10)
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
	smtp_username  text
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

		update public.mail_outbox set status = 'sending' where id = v_ligne.id;

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
		       -- LA CHAÎNE COMPLÈTE, DANS L'ORDRE : les références du parent PUIS son propre
		       -- identifiant. Le parent seul couperait le fil au deuxième aller-retour (§19.3).
		       coalesce(parent.references_ids, array[]::text[])
		         || coalesce(array[parent.rfc822_message_id], array[]::text[]),
		       i.smtp_host,
		       i.smtp_port,
		       i.smtp_security,
		       i.smtp_username
		  from public.mail_outbound_identities i
		  join public.cards c on c.id = v_ligne.card_id
		  join public.workspaces w on w.id = c.workspace_id
		  left join public.mail_messages parent on parent.id = v_ligne.in_reply_to_message_id
		 where i.id = v_ligne.identity_id;
	end loop;
end;
$$;

comment on function public.reserver_envois(integer) is
	'CRM-058 §19.5 — les envois à traiter, réservés (`sending`) au moment où ils sont rendus. '
	'`skip locked` : deux workers ne se disputent pas la même ligne. Le quota est vérifié ICI, '
	'car c''est l''envoi qui le dépense.';

-- L'envoi a réussi : les trois effets, dans une seule transaction.
create or replace function public.marquer_envoi_reussi(
	p_outbox_id         uuid,
	p_rfc822_message_id text,
	p_references        text[] default '{}'
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
	-- IDEMPOTENT : un worker qui rejoue après une coupure ne doit pas archiver deux fois.
	if v_envoi.status = 'sent' then
		return v_envoi.sent_message_id;
	end if;

	insert into public.mail_messages (
		workspace_id, rfc822_message_id, card_id, classification, direction,
		from_address, to_addresses, cc_addresses, subject, body_text, references_ids, sent_at
	)
	values (
		v_envoi.workspace_id, p_rfc822_message_id, v_envoi.card_id, 'outbound', 'outbound',
		(select i.from_address from public.mail_outbound_identities i where i.id = v_envoi.identity_id),
		v_envoi.to_addrs, v_envoi.cc_addrs, v_envoi.subject, v_envoi.body_text,
		coalesce(p_references, array[]::text[]), now()
	)
	on conflict (workspace_id, rfc822_message_id) do update set subject = excluded.subject
	returning id into v_message;

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

comment on function public.marquer_envoi_reussi(uuid, text, text[]) is
	'CRM-058 §19.5 — les trois effets d''un envoi réussi, solidaires : file marquée, message '
	'archivé en `outbound`, timeline écrite. Idempotent : rejouer après une coupure n''archive '
	'pas deux fois.';

-- L'envoi a échoué : on le DIT. Aucun backoff ici — il appartient à `CRM-059` (§19.2), et les
-- colonnes qui le porteront existent déjà. Feindre un succès, ou laisser la ligne en `queued`
-- sans rien dire, serait exactement la valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.
create or replace function public.marquer_envoi_echoue(p_outbox_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	update public.mail_outbox
	   set status = 'failed',
	       attempts = attempts + 1,
	       -- UN CODE, JAMAIS LE TEXTE DU SERVEUR (§13.7) : un message d'erreur brut expose la
	       -- version, l'hôte, parfois l'adresse. La forme est contrainte ici même.
	       last_error = left(regexp_replace(coalesce(p_code, 'unknown'), '[^a-z_]', '', 'g'), 64)
	 where id = p_outbox_id;
end;
$$;

comment on function public.marquer_envoi_echoue(uuid, text) is
	'CRM-058 §19.5 — un échec est nommé par un CODE assaini, jamais par le texte du serveur.';

revoke all on function public.reserver_envois(integer) from public, anon, authenticated;
grant execute on function public.reserver_envois(integer) to service_role;

revoke all on function public.marquer_envoi_reussi(uuid, text, text[])
	from public, anon, authenticated;
grant execute on function public.marquer_envoi_reussi(uuid, text, text[]) to service_role;

revoke all on function public.marquer_envoi_echoue(uuid, text) from public, anon, authenticated;
grant execute on function public.marquer_envoi_echoue(uuid, text) to service_role;

-- =============================================================================================
-- 8. `daily_quota` cesse de valoir zéro par défaut — et le motif est un défaut évité
-- =============================================================================================
--
-- `CRM-053` l'avait créée « SANS CONSOMMATEUR », avec `not null default 0`, et l'écrivait :
-- « aucun quota n'est appliqué aujourd'hui ». Le jour où un consommateur existe — celui-ci —, ce
-- zéro cesse d'être neutre : lu littéralement, il interdit TOUT envoi à TOUTES les identités
-- existantes, y compris celles du seed. Mesuré : le premier appel de `queue_outbound_email` a
-- rendu `quota_exceeded`.
--
-- LA VALEUR « NON CONFIGURÉ » DEVIENT DONC `NULL`, distincte du zéro explicite, qui garde son sens
-- littéral : « cette identité n'envoie pas ». Les zéros existants sont convertis, et c'est fidèle —
-- ils n'ont jamais été configurés par personne, puisque rien ne les lisait.

alter table public.mail_outbound_identities alter column daily_quota drop not null;
alter table public.mail_outbound_identities alter column daily_quota set default null;

update public.mail_outbound_identities set daily_quota = null where daily_quota = 0;

comment on column public.mail_outbound_identities.daily_quota is
	'CRM-053, révisée par CRM-058 : `NULL` = aucun plafond, un entier = le plafond du jour UTC, '
	'`0` = cette identité n''envoie pas. Le défaut `0` d''origine interdisait tout envoi dès qu''un '
	'consommateur existait ; les valeurs jamais configurées ont été converties en `NULL`.';
