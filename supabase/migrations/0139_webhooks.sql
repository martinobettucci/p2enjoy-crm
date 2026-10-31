-- @spec CRM-073 (docs/BACKLOG.md) — tranche T1 : les webhooks sortants en base — points de sortie, remises, secret dans
--       Vault, inscription par déclencheurs, filtre de channel, prise et résultat des remises, renvoi, purge, journal
-- @spec docs/SPEC-webhooks.md §2 (la base décide), §3 (les neuf événements, le filtre de channel), §4 (tables, fonctions,
--       journal), §5.2 (essais et délais), §5.3 (renvoi), §6 (secret) ; docs/SCHEMA.md « Migration `0139` » ;
--       docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 779 et 784
--
-- LA BASE DÉCIDE, LA FONCTION EDGE REMET (§2). Chaque événement retenu devient, dans la transaction même du changement, une
-- ligne de `webhook_deliveries` par webhook concerné : un changement annulé n'en laisse aucune, une remise inscrite ne se
-- perd pas. La fonction edge `webhooks` (T2) prend les remises dues par `claim_webhook_deliveries` et rend chaque résultat
-- par `record_webhook_attempt` ; elle ne choisit ni le destinataire ni le contenu.
--
-- IDEMPOTENCE : `if not exists`, `create or replace`, `drop … if exists` puis recréation ; la tâche `pg_cron` est
-- reprogrammée sous son nom.

-- =============================================================================================
-- 1. Les événements — §3
-- =============================================================================================

-- La liste fermée, sans doublon ni valeur nulle, et jamais vide.
create or replace function app.webhook_events_valid(p_events text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
	select coalesce(pg_catalog.cardinality(p_events), 0) > 0
	   and pg_catalog.array_position(p_events, null) is null
	   and p_events operator(pg_catalog.<@) array['card.created', 'card.step_changed', 'card.owner_changed',
	                                             'card.archived', 'card.trashed', 'card.restored', 'contact.created',
	                                             'contact.updated', 'contact.deleted']::text[]
	   and pg_catalog.cardinality(p_events) = (select pg_catalog.count(distinct e) from pg_catalog.unnest(p_events) e)
$$;

-- =============================================================================================
-- 2. Les webhooks d'un espace — §4.1
-- =============================================================================================

create table if not exists public.webhook_endpoints (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	name         text        not null,
	url          text        not null,
	events       text[]      not null,
	channel_id   uuid,
	secret_id    uuid        not null,
	enabled      boolean     not null default true,
	created_by   uuid        default auth.uid() references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint webhook_endpoints_name_check check (pg_catalog.btrim(name) <> '' and pg_catalog.char_length(name) <= 80),
	constraint webhook_endpoints_url_check check (url ~ '^https://[^[:space:]]+$' and pg_catalog.char_length(url) <= 2048),
	constraint webhook_endpoints_events_check check (app.webhook_events_valid(events)),
	-- §3 : les contacts n'ont pas de channel ; un webhook limité à un channel ne les reçoit pas (décision 784, point 2).
	constraint webhook_endpoints_channel_sans_contacts check (
		channel_id is null
		or not (events operator(pg_catalog.&&) array['contact.created', 'contact.updated', 'contact.deleted']::text[])),
	-- Un channel du même espace ; sa destruction emporte le webhook qui s'y limitait — l'ouvrir à tout l'espace
	-- élargirait en silence ce que le tiers reçoit.
	constraint webhook_endpoints_channel_fk
		foreign key (channel_id, workspace_id) references public.channels (id, workspace_id) on delete cascade,
	constraint webhook_endpoints_id_workspace_key unique (id, workspace_id)
);

create index if not exists webhook_endpoints_espace on public.webhook_endpoints (workspace_id) where enabled;

drop trigger if exists webhook_endpoints_set_updated_at on public.webhook_endpoints;
create trigger webhook_endpoints_set_updated_at
	before update on public.webhook_endpoints
	for each row execute function app.set_updated_at();

-- §4.3 : créer, modifier, supprimer et régénérer le secret s'inscrivent au journal. L'adresse et le secret ne sont que
-- NOMMÉS parmi les colonnes changées (`app.audit_configuration` ne recopie que ses valeurs courtes) : une adresse peut
-- porter un jeton.
drop trigger if exists webhook_endpoints_audit on public.webhook_endpoints;
create trigger webhook_endpoints_audit
	after insert or update or delete on public.webhook_endpoints
	for each row execute function app.audit_configuration('webhook', 'name', 'name', 'url', 'events', 'channel_id',
	                                                      'enabled', 'secret_id');

-- Le secret quitte Vault avec son webhook.
create or replace function app.webhook_endpoints_retirer_secret()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	delete from vault.secrets s where s.id = old.secret_id;
	return null;
end;
$$;

drop trigger if exists webhook_endpoints_retirer_secret on public.webhook_endpoints;
create trigger webhook_endpoints_retirer_secret
	after delete on public.webhook_endpoints
	for each row execute function app.webhook_endpoints_retirer_secret();

-- =============================================================================================
-- 3. Les remises — §4.2
-- =============================================================================================

create table if not exists public.webhook_deliveries (
	id               uuid        primary key default gen_random_uuid(),
	workspace_id     uuid        not null,
	endpoint_id      uuid        not null,
	event            text        not null,
	event_id         uuid        not null,
	payload          jsonb       not null,
	status           text        not null default 'pending',
	attempts         integer     not null default 0,
	next_attempt_at  timestamptz,
	last_status_code integer,
	last_error       text,
	last_attempt_at  timestamptz,
	redelivery_of    uuid        references public.webhook_deliveries (id) on delete set null,
	created_at       timestamptz not null default now(),
	constraint webhook_deliveries_endpoint_fk
		foreign key (endpoint_id, workspace_id) references public.webhook_endpoints (id, workspace_id) on delete cascade,
	constraint webhook_deliveries_event_check check (app.webhook_events_valid(array[event])),
	constraint webhook_deliveries_status_check check (status in ('pending', 'delivered', 'failed')),
	constraint webhook_deliveries_attempts_check check (attempts between 0 and 5),
	-- Une remise en attente a toujours un prochain essai ; une remise close n'en a plus.
	constraint webhook_deliveries_prochain_essai check ((status = 'pending') = (next_attempt_at is not null)),
	constraint webhook_deliveries_last_error_check check (
		last_error is null
		or last_error in ('timeout', 'connection_refused', 'address_forbidden', 'tls_error', 'dns_error', 'network_error'))
);

create index if not exists webhook_deliveries_dues on public.webhook_deliveries (next_attempt_at)
	where status = 'pending';
create index if not exists webhook_deliveries_historique on public.webhook_deliveries (endpoint_id, created_at desc);
create index if not exists webhook_deliveries_purge on public.webhook_deliveries (created_at) where status <> 'pending';

-- =============================================================================================
-- 4. L'inscription des remises — §3, §5.1
-- =============================================================================================

-- Le contenu `data` d'un événement d'affaire : les identifiants et les champs qui disent le changement (décision 784,
-- point 1). Sans rattachement désigné (corbeille, restauration), l'affaire seule.
create or replace function app.webhook_card_data(p_card uuid, p_placement uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	donnees jsonb;
	r       record;
begin
	select c.id, c.title, c.currency into r from public.cards c where c.id = p_card;
	donnees := pg_catalog.jsonb_build_object('card_id', r.id, 'title', r.title, 'currency', r.currency);
	if p_placement is null then
		return donnees;
	end if;
	select p.id, p.channel_id, ch.name as channel_name, p.current_step_id,
	       coalesce(s.label_override, n.label) as step_label, p.owner_id, pr.full_name as owner_name, p.amount
	  into r
	  from public.card_placements p
	  join public.channels ch on ch.id = p.channel_id
	  join public.workflow_steps s on s.id = p.current_step_id
	  join public.workflow_nodes_catalog n on n.id = s.node_id
	  left join public.profiles pr on pr.id = p.owner_id
	 where p.id = p_placement;
	if not found then
		return donnees;
	end if;
	return donnees || pg_catalog.jsonb_build_object(
		'placement_id', r.id,
		'channel_id', r.channel_id,
		'channel_name', r.channel_name,
		'step', pg_catalog.jsonb_build_object('id', r.current_step_id, 'label', r.step_label),
		'owner', case when r.owner_id is null then null
		              else pg_catalog.jsonb_build_object('id', r.owner_id, 'full_name', r.owner_name) end,
		'amount', r.amount);
end;
$$;

-- L'étape ou la personne d'avant, sous la même forme que l'actuelle.
create or replace function app.webhook_step_ref(p_step uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select case when p_step is null then null else (
		select pg_catalog.jsonb_build_object('id', s.id, 'label', coalesce(s.label_override, n.label))
		  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
		 where s.id = p_step) end
$$;

create or replace function app.webhook_person_ref(p_profile uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select case when p_profile is null then null else (
		select pg_catalog.jsonb_build_object('id', pr.id, 'full_name', pr.full_name)
		  from public.profiles pr where pr.id = p_profile) end
$$;

create or replace function app.webhook_instant(p_instant timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
	select pg_catalog.to_char(p_instant at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- Les événements d'affaire suivent `card_events`, le journal immuable du fil (§3) : le webhook dit ce que le fil dit.
create or replace function app.webhooks_on_card_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_event     text;
	v_placement uuid := new.placement_id;
	v_channel   uuid;
	v_data      jsonb;
begin
	v_event := case new.type
		when 'created' then 'card.created'
		when 'moved' then 'card.step_changed'
		when 'assigned' then 'card.owner_changed'
		when 'archived' then 'card.archived'
		when 'trashed' then 'card.trashed'
		when 'restored' then 'card.restored'
	end;
	if v_event is null or not exists (
		select 1 from public.webhook_endpoints e
		 where e.workspace_id = new.workspace_id and e.enabled and v_event = any (e.events)) then
		return null;
	end if;

	if v_event in ('card.trashed', 'card.restored') then
		-- La corbeille et la restauration portent sur l'affaire, et non sur un rattachement.
		v_placement := null;
	elsif v_placement is null and v_event = 'card.created' then
		-- La naissance s'écrit à la validation, avant que l'événement ne sache son rattachement (décision 768) : celui
		-- du channel qu'il nomme, sinon le plus ancien.
		select p.id into v_placement
		  from public.card_placements p
		 where p.card_id = new.card_id
		 order by (p.channel_id::text = new.payload ->> 'channel_id') desc, p.created_at, p.id
		 limit 1;
	end if;
	select p.channel_id into v_channel from public.card_placements p where p.id = v_placement;

	v_data := app.webhook_card_data(new.card_id, v_placement);
	if v_event = 'card.step_changed' then
		v_data := v_data || pg_catalog.jsonb_build_object(
			'from_step', app.webhook_step_ref(nullif(new.payload ->> 'from_step_id', '')::uuid));
	elsif v_event = 'card.owner_changed' then
		v_data := v_data || pg_catalog.jsonb_build_object(
			'from_owner', app.webhook_person_ref(nullif(new.payload ->> 'from_owner_id', '')::uuid));
	end if;
	if new.payload ? 'source' then
		v_data := v_data || pg_catalog.jsonb_build_object('source', new.payload -> 'source');
	end if;

	insert into public.webhook_deliveries (workspace_id, endpoint_id, event, event_id, payload, next_attempt_at)
	select e.workspace_id, e.id, v_event, new.id,
	       pg_catalog.jsonb_build_object('id', new.id, 'event', v_event, 'occurred_at', app.webhook_instant(new.created_at),
	                                     'workspace_id', new.workspace_id, 'data', v_data),
	       now()
	  from public.webhook_endpoints e
	 where e.workspace_id = new.workspace_id
	   and e.enabled
	   and v_event = any (e.events)
	   and (e.channel_id is null
	        or (v_placement is not null and e.channel_id = v_channel)
	        or (v_placement is null and exists (
	              select 1 from public.card_placements p where p.card_id = new.card_id and p.channel_id = e.channel_id)));
	return null;
end;
$$;

drop trigger if exists card_events_webhooks on public.card_events;
create trigger card_events_webhooks
	after insert on public.card_events
	for each row execute function app.webhooks_on_card_event();

-- Les événements de contact suivent les écritures sur `contacts`. L'anonymisation vaut suppression pour le tiers
-- (décision 784, point 3) ; la suppression d'un contact déjà anonymisé n'émet rien de plus. `contact.updated` nomme
-- dans `changed` les champs changés, sans recopier ceux que la charge utile ne porte pas (téléphone, fonction).
create or replace function app.webhooks_on_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_event   text;
	v_ligne   public.contacts;
	v_changes text[] := '{}';
	v_data    jsonb;
	v_id      uuid := gen_random_uuid();
begin
	if tg_op = 'INSERT' then
		v_event := 'contact.created';
		v_ligne := new;
	elsif tg_op = 'UPDATE' then
		v_ligne := new;
		if old.anonymized_at is null and new.anonymized_at is not null then
			v_event := 'contact.deleted';
		elsif new.anonymized_at is null then
			if old.full_name is distinct from new.full_name then v_changes := v_changes || 'full_name'::text; end if;
			if old.email is distinct from new.email then v_changes := v_changes || 'email'::text; end if;
			if old.phone is distinct from new.phone then v_changes := v_changes || 'phone'::text; end if;
			if old.role_title is distinct from new.role_title then v_changes := v_changes || 'role_title'::text; end if;
			if old.organization_id is distinct from new.organization_id then
				v_changes := v_changes || 'organization_id'::text;
			end if;
			if pg_catalog.cardinality(v_changes) > 0 then
				v_event := 'contact.updated';
			end if;
		end if;
	else
		v_ligne := old;
		if old.anonymized_at is null then
			v_event := 'contact.deleted';
		end if;
	end if;
	if v_event is null or not exists (
		select 1 from public.webhook_endpoints e
		 where e.workspace_id = v_ligne.workspace_id and e.enabled and v_event = any (e.events)) then
		return null;
	end if;

	if v_event = 'contact.deleted' then
		v_data := pg_catalog.jsonb_build_object('contact_id', v_ligne.id);
	else
		v_data := pg_catalog.jsonb_build_object('contact_id', v_ligne.id, 'full_name', v_ligne.full_name,
		                                        'email', v_ligne.email, 'organization_id', v_ligne.organization_id);
		if v_event = 'contact.updated' then
			v_data := v_data || pg_catalog.jsonb_build_object('changed', pg_catalog.to_jsonb(v_changes));
		end if;
	end if;

	insert into public.webhook_deliveries (workspace_id, endpoint_id, event, event_id, payload, next_attempt_at)
	select e.workspace_id, e.id, v_event, v_id,
	       pg_catalog.jsonb_build_object('id', v_id, 'event', v_event, 'occurred_at', app.webhook_instant(clock_timestamp()),
	                                     'workspace_id', v_ligne.workspace_id, 'data', v_data),
	       now()
	  from public.webhook_endpoints e
	 where e.workspace_id = v_ligne.workspace_id
	   and e.enabled
	   and e.channel_id is null
	   and v_event = any (e.events);
	return null;
end;
$$;

drop trigger if exists contacts_webhooks on public.contacts;
create trigger contacts_webhooks
	after insert or update or delete on public.contacts
	for each row execute function app.webhooks_on_contact();

-- =============================================================================================
-- 5. Les gestes de l'administrateur — §4.1, §5.3
-- =============================================================================================

-- Un secret neuf : 32 octets aléatoires en hexadécimal, préfixe `whsec_`, rangé dans Vault sous un nom unique.
create or replace function app.webhook_nouveau_secret(p_endpoint uuid, out secret text, out secret_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
	secret := 'whsec_' || pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
	secret_id := vault.create_secret(secret, 'webhook:' || p_endpoint || ':' || gen_random_uuid(),
	                                 'Secret de signature d''un webhook sortant (CRM-073)');
end;
$$;

-- Crée un webhook et rend son secret, UNE SEULE FOIS (§4.1). Les règles de forme sont celles de la table.
create or replace function public.create_webhook_endpoint(
	p_workspace uuid,
	p_name text,
	p_url text,
	p_events text[],
	p_channel uuid default null,
	p_enabled boolean default true)
returns table (id uuid, secret text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
	v_id     uuid := gen_random_uuid();
	v_secret record;
begin
	if auth.uid() is null then
		raise exception 'authentication_required' using errcode = '42501';
	end if;
	if not app.is_workspace_admin(p_workspace) then
		raise exception 'forbidden' using errcode = '42501';
	end if;
	select * into v_secret from app.webhook_nouveau_secret(v_id);
	insert into public.webhook_endpoints (id, workspace_id, name, url, events, channel_id, secret_id, enabled, created_by)
	values (v_id, p_workspace, pg_catalog.btrim(p_name), pg_catalog.btrim(p_url), p_events, p_channel,
	        v_secret.secret_id, coalesce(p_enabled, true), auth.uid());
	return query select v_id, v_secret.secret;
end;
$$;

-- Régénère le secret : un nouveau secret dans Vault, l'ancien retiré aussitôt — il cesse de signer (§4.1). Un webhook
-- qu'on ne lit pas est introuvable.
create or replace function public.rotate_webhook_secret(p_endpoint uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_espace uuid;
	v_ancien uuid;
	v_secret record;
begin
	select e.workspace_id, e.secret_id into v_espace, v_ancien
	  from public.webhook_endpoints e where e.id = p_endpoint for update;
	if not found or not app.is_workspace_admin(v_espace) then
		raise exception 'webhook_not_found' using errcode = 'P0002';
	end if;
	select * into v_secret from app.webhook_nouveau_secret(p_endpoint);
	update public.webhook_endpoints e set secret_id = v_secret.secret_id where e.id = p_endpoint;
	delete from vault.secrets s where s.id = v_ancien;
	return v_secret.secret;
end;
$$;

-- Renvoie une remise close : une NOUVELLE remise du même corps et du même événement, cinq essais à nouveau (§5.3). Une
-- remise encore en attente sera réessayée d'elle-même ; un webhook désactivé n'inscrit plus de remise (§4.1).
create or replace function public.redeliver_webhook(p_delivery uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	d       public.webhook_deliveries;
	v_actif boolean;
	v_id    uuid;
begin
	select * into d from public.webhook_deliveries x where x.id = p_delivery;
	if not found or not app.is_workspace_admin(d.workspace_id) then
		raise exception 'delivery_not_found' using errcode = 'P0002';
	end if;
	if d.status = 'pending' then
		raise exception 'delivery_pending' using errcode = 'P0001';
	end if;
	select e.enabled into v_actif from public.webhook_endpoints e where e.id = d.endpoint_id;
	if not v_actif then
		raise exception 'webhook_disabled' using errcode = 'P0001';
	end if;
	insert into public.webhook_deliveries (workspace_id, endpoint_id, event, event_id, payload, redelivery_of,
	                                       next_attempt_at)
	values (d.workspace_id, d.endpoint_id, d.event, d.event_id, d.payload, d.id, now())
	returning id into v_id;
	return v_id;
end;
$$;

-- =============================================================================================
-- 6. La prise et le résultat des remises, pour la fonction edge — §5.2, §6
-- =============================================================================================

-- Prend au plus `p_limit` remises dues d'un webhook actif, verrouillées (`skip locked`) : deux passages ne prennent
-- jamais la même. L'essai est COMPTÉ à la prise, et la remise est réservée quinze minutes : une fonction qui tomberait
-- en cours de passage ne la perd pas, elle la retrouve à l'échéance. Le secret est lu dans Vault ici, et seulement ici.
create or replace function public.claim_webhook_deliveries(p_limit integer default 50)
returns table (delivery_id uuid, url text, event text, payload jsonb, secret text, attempt integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
	return query
	with dues as (
		select d.id
		  from public.webhook_deliveries d
		  join public.webhook_endpoints e on e.id = d.endpoint_id
		 where d.status = 'pending' and d.next_attempt_at <= now() and e.enabled
		 order by d.next_attempt_at, d.created_at
		 limit greatest(1, least(coalesce(p_limit, 50), 200))
		   for update of d skip locked
	), prises as (
		update public.webhook_deliveries d
		   set attempts = d.attempts + 1, last_attempt_at = now(), next_attempt_at = now() + interval '15 minutes'
		  from dues
		 where d.id = dues.id
		returning d.id, d.endpoint_id, d.event, d.payload, d.attempts
	)
	select p.id, e.url, p.event, p.payload, s.decrypted_secret, p.attempts
	  from prises p
	  join public.webhook_endpoints e on e.id = p.endpoint_id
	  join vault.decrypted_secrets s on s.id = e.secret_id;
end;
$$;

-- Inscrit le résultat d'un essai : un code 2xx clôt la remise ; sinon le prochain essai suit les délais du §5.2 — 1 min,
-- 5 min, 30 min, 2 h après l'essai —, et le cinquième échec la clôt en `failed`. Rend le nouvel état.
create or replace function public.record_webhook_attempt(p_delivery uuid, p_status_code integer, p_error text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	d       public.webhook_deliveries;
	delais  constant interval[] := array[interval '1 minute', interval '5 minutes', interval '30 minutes',
	                                     interval '2 hours'];
	v_etat  text;
begin
	select * into d from public.webhook_deliveries x where x.id = p_delivery and x.status = 'pending' for update;
	if not found then
		raise exception 'delivery_not_found' using errcode = 'P0002';
	end if;
	if p_status_code between 200 and 299 then
		v_etat := 'delivered';
	elsif d.attempts >= 5 then
		v_etat := 'failed';
	else
		v_etat := 'pending';
	end if;
	update public.webhook_deliveries x
	   set status = v_etat,
	       last_status_code = p_status_code,
	       last_error = case when p_status_code is null then coalesce(p_error, 'network_error') end,
	       next_attempt_at = case when v_etat = 'pending'
	                              then coalesce(d.last_attempt_at, now()) + delais[greatest(d.attempts, 1)] end
	 where x.id = p_delivery;
	return v_etat;
end;
$$;

-- =============================================================================================
-- 7. La purge — §4.2 (décision 784, point 5)
-- =============================================================================================

create or replace function app.purge_webhook_deliveries()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	n integer;
begin
	delete from public.webhook_deliveries d
	 where d.status <> 'pending' and d.created_at < now() - interval '30 days';
	get diagnostics n = row_count;
	return n;
end;
$$;

do $$
declare
	job_id bigint;
begin
	select cron.schedule('p2enjoy-webhooks-purge', '41 3 * * *', 'select app.purge_webhook_deliveries();')
	  into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

-- =============================================================================================
-- 8. Le journal — §4.3 : le type d'entité `webhook`
-- =============================================================================================

alter table public.audit_log drop constraint if exists audit_log_entity_type_check;
alter table public.audit_log add constraint audit_log_entity_type_check
	check (entity_type in ('member', 'invitation', 'track_access', 'channel_access', 'workspace', 'track', 'channel',
	                       'workflow', 'workflow_step', 'workflow_transition', 'workflow_node', 'form_field',
	                       'form_field_rule', 'mail_account', 'mail_identity', 'card', 'comment', 'activity', 'contact',
	                       'organization', 'session', 'audit_log', 'card_list', 'contact_list', 'webhook'));

-- =============================================================================================
-- 9. RLS et privilèges — §4.1, §4.2, §6
-- =============================================================================================

alter table public.webhook_endpoints enable row level security;
alter table public.webhook_deliveries enable row level security;

-- L'administrateur de l'espace seul, en lecture comme en écriture ; la création passe par `create_webhook_endpoint`.
drop policy if exists webhook_endpoints_admin on public.webhook_endpoints;
create policy webhook_endpoints_admin on public.webhook_endpoints
	for all to authenticated
	using (app.is_workspace_admin(workspace_id)) with check (app.is_workspace_admin(workspace_id));
drop policy if exists webhook_deliveries_lecture on public.webhook_deliveries;
create policy webhook_deliveries_lecture on public.webhook_deliveries
	for select to authenticated using (app.is_workspace_admin(workspace_id));

revoke all on public.webhook_endpoints, public.webhook_deliveries from anon, authenticated;
grant select, delete on public.webhook_endpoints to authenticated;
grant update (name, url, events, channel_id, enabled) on public.webhook_endpoints to authenticated;
grant select on public.webhook_deliveries to authenticated;
grant all on public.webhook_endpoints, public.webhook_deliveries to service_role;

do $$
declare
	f text;
begin
	foreach f in array array[
		'app.webhook_endpoints_retirer_secret()', 'app.webhook_card_data(uuid, uuid)', 'app.webhook_step_ref(uuid)',
		'app.webhook_person_ref(uuid)', 'app.webhooks_on_card_event()', 'app.webhooks_on_contact()',
		'app.webhook_nouveau_secret(uuid)', 'app.purge_webhook_deliveries()',
		'public.claim_webhook_deliveries(integer)', 'public.record_webhook_attempt(uuid, integer, text)'
	] loop
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated', f);
	end loop;
end;
$$;
revoke all on function app.webhook_events_valid(text[]) from public, anon;
grant execute on function app.webhook_events_valid(text[]) to authenticated, service_role;
revoke all on function app.webhook_instant(timestamptz) from public, anon;
grant execute on function app.webhook_instant(timestamptz) to authenticated, service_role;
revoke all on function public.create_webhook_endpoint(uuid, text, text, text[], uuid, boolean) from public, anon;
grant execute on function public.create_webhook_endpoint(uuid, text, text, text[], uuid, boolean) to authenticated;
revoke all on function public.rotate_webhook_secret(uuid) from public, anon;
grant execute on function public.rotate_webhook_secret(uuid) to authenticated;
revoke all on function public.redeliver_webhook(uuid) from public, anon;
grant execute on function public.redeliver_webhook(uuid) to authenticated;
-- La prise et le résultat sont à la fonction edge seule, par la clé de service.
grant execute on function public.claim_webhook_deliveries(integer) to service_role;
grant execute on function public.record_webhook_attempt(uuid, integer, text) to service_role;

notify pgrst, 'reload schema';
