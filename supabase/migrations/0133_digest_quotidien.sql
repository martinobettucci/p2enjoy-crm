-- @spec CRM-069 (docs/BACKLOG.md) — tranche T4 : le digest quotidien en base et à l'envoi
-- @spec docs/SPEC-etiquettes-digest.md §5.1 (le consentement : une ligne vaut consentement, privée à la personne), §5.2 (le
--       contenu : ses actions, ses mentions non lues, ses affaires figées, chaque ligne filtrée par son droit de lecture ;
--       rien à dire, aucun email), §5.3 (une branche de la file sans affaire, l'identité de service, sans `Reply-To`), §5.4
--       (le job horaire, idempotent, à 7 h de Paris) ; docs/SCHEMA.md « Migration `0133` » ; docs/PROD_MIGRATIONS.md §3 ;
--       docs/JOURNAL.md décisions 769, 771, 772 et 773 (l'adresse : `profiles.email`, posée à chaque connexion)
--
-- TOUT LE DIGEST EST EN BASE (`CLAUDE.md` §10) : qui consent, ce qui est dit, à qui, une fois par jour. `mail-sync` ne fait
-- qu'expédier ce que la file porte, comme pour tout envoi.

-- =============================================================================================
-- 0. L'adresse d'un membre — décision 773
-- =============================================================================================
-- Le CRM ne gardait aucune adresse : les identités vivent dans le SSO. La base pose désormais sur le profil l'adresse
-- vérifiée que l'échangeur reçoit du SSO, à chaque ouverture et à chaque renouvellement de session. Aucun client ne l'écrit
-- (aucun privilège de colonne). `profiles` étant lisible par l'équipe, l'adresse l'est aussi : conséquence acceptée par le
-- responsable.

alter table public.profiles add column if not exists email text;
comment on column public.profiles.email is
	'CRM-069 — décision 773. L''adresse vérifiée reçue du SSO à la dernière ouverture ou au dernier renouvellement de '
	'session ; nulle pour qui ne s''est jamais connecté. Posée par la base, jamais par un client. Le digest y part.';

create or replace function public.ouvrir_session_serveur(p_sub uuid, p_email text, p_nom text, p_empreinte bytea,
                                                         p_rafraichissement text, p_expire_le timestamptz,
                                                         p_admin_lelabs boolean default false,
                                                         p_superadmins_initiaux text[] default '{}'::text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	admission jsonb;
begin
	perform app.amorcer_superadmin(p_sub, p_email, p_nom, p_superadmins_initiaux);
	admission := public.ouvrir_session_sso(p_sub, p_email, p_nom, p_admin_lelabs);
	if (admission ->> 'admis')::boolean then
		insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
		values (p_sub, p_empreinte, p_rafraichissement, p_expire_le);
		-- `CRM-069`, décision 773 : l'adresse vérifiée du SSO, retenue pour le digest.
		update public.profiles p set email = pg_catalog.lower(pg_catalog.btrim(p_email))
		 where p.id = p_sub and p_email is not null and p.email is distinct from pg_catalog.lower(pg_catalog.btrim(p_email));
	end if;
	return admission;
end;
$$;

create or replace function public.renouveler_session_serveur(p_empreinte bytea, p_sub uuid, p_email text, p_nom text,
                                                             p_rafraichissement text, p_expire_le timestamptz,
                                                             p_admin_lelabs boolean default false,
                                                             p_superadmins_initiaux text[] default '{}'::text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	admission jsonb;
begin
	if not exists (
		select 1 from public.sessions_sso s
		 where s.poignee_empreinte = p_empreinte and s.sub = p_sub
	) then
		return pg_catalog.jsonb_build_object('admis', false, 'session', false);
	end if;

	perform app.amorcer_superadmin(p_sub, p_email, p_nom, p_superadmins_initiaux);
	admission := public.ouvrir_session_sso(p_sub, p_email, p_nom, p_admin_lelabs);
	if (admission ->> 'admis')::boolean then
		update public.sessions_sso s
		   set rafraichissement = p_rafraichissement,
		       expire_le = p_expire_le,
		       renouvele_le = pg_catalog.now()
		 where s.poignee_empreinte = p_empreinte;
		-- `CRM-069`, décision 773 : l'adresse vérifiée du SSO, retenue pour le digest.
		update public.profiles p set email = pg_catalog.lower(pg_catalog.btrim(p_email))
		 where p.id = p_sub and p_email is not null and p.email is distinct from pg_catalog.lower(pg_catalog.btrim(p_email));
	else
		delete from public.sessions_sso s where s.poignee_empreinte = p_empreinte;
	end if;
	return admission || pg_catalog.jsonb_build_object('session', true);
end;
$$;

-- =============================================================================================
-- 1. Le consentement — §5.1
-- =============================================================================================

create table if not exists public.digest_subscriptions (
	profile_id    uuid        not null default auth.uid() references public.profiles (id) on delete cascade,
	workspace_id  uuid        not null references public.workspaces (id) on delete cascade,
	subscribed_at timestamptz not null default now(),
	constraint digest_subscriptions_pkey primary key (profile_id, workspace_id)
);

comment on table public.digest_subscriptions is
	'CRM-069 — docs/SPEC-etiquettes-digest.md §5.1. Une ligne vaut consentement au digest quotidien d''un espace ; aucune '
	'ligne, aucun email. Table séparée de `profiles`, lisible de la seule personne : une décision personnelle ne se publie '
	'pas à l''équipe (docs/SPEC-notifications.md §43.1).';

-- La personne qui consent est l'appelant, toujours : un consentement ne se donne pas pour autrui (`CLAUDE.md` §10, §11).
create or replace function app.digest_subscriptions_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if (select auth.uid()) is not null then
		new.profile_id := (select auth.uid());
	end if;
	new.subscribed_at := now();
	return new;
end;
$$;

drop trigger if exists digest_subscriptions_avant on public.digest_subscriptions;
create trigger digest_subscriptions_avant
	before insert on public.digest_subscriptions
	for each row execute function app.digest_subscriptions_avant();

alter table public.digest_subscriptions enable row level security;
drop policy if exists digest_subscriptions_lecture on public.digest_subscriptions;
create policy digest_subscriptions_lecture on public.digest_subscriptions
	for select to authenticated using (profile_id = (select auth.uid()));
drop policy if exists digest_subscriptions_consentement on public.digest_subscriptions;
create policy digest_subscriptions_consentement on public.digest_subscriptions
	for insert to authenticated
	with check (profile_id = (select auth.uid()) and app.is_workspace_member(workspace_id));
drop policy if exists digest_subscriptions_retrait on public.digest_subscriptions;
create policy digest_subscriptions_retrait on public.digest_subscriptions
	for delete to authenticated using (profile_id = (select auth.uid()));

revoke all on public.digest_subscriptions from anon, authenticated;
grant select, delete on public.digest_subscriptions to authenticated;
grant insert (workspace_id) on public.digest_subscriptions to authenticated;
grant all on public.digest_subscriptions to service_role;

-- =============================================================================================
-- 2. Le journal des digests — §5.4 : un par personne, par espace et par jour
-- =============================================================================================

create table if not exists public.digest_runs (
	profile_id   uuid        not null references public.profiles (id) on delete cascade,
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	day          date        not null,
	status       text        not null,
	outbox_id    uuid        references public.mail_outbox (id) on delete set null,
	created_at   timestamptz not null default now(),
	constraint digest_runs_pkey primary key (profile_id, workspace_id, day),
	constraint digest_runs_status_check check (status in ('queued', 'empty', 'no_service_identity', 'no_address'))
);

-- Reposée explicitement : sur une base où la table existe déjà, `create table if not exists` ne la change pas.
alter table public.digest_runs drop constraint if exists digest_runs_status_check;
alter table public.digest_runs add constraint digest_runs_status_check
	check (status in ('queued', 'empty', 'no_service_identity', 'no_address'));

comment on table public.digest_runs is
	'CRM-069 — docs/SPEC-etiquettes-digest.md §5.4. L''issue du digest d''une personne, pour un espace et un jour : '
	'mis en file, vide (rien à dire), ou sans identité de service. Rend le job idempotent. Fermée aux clients.';

alter table public.digest_runs enable row level security;
revoke all on public.digest_runs from anon, authenticated;
grant all on public.digest_runs to service_role;

-- =============================================================================================
-- 3. Une branche de la file sans affaire — §5.3
-- =============================================================================================

alter table public.mail_outbox add column if not exists kind text not null default 'card';
alter table public.mail_outbox drop constraint if exists mail_outbox_kind_check;
alter table public.mail_outbox add constraint mail_outbox_kind_check check (kind in ('card', 'digest'));
alter table public.mail_outbox alter column card_id drop not null;
-- L'affaire reste obligatoire pour un envoi d'affaire : c'est elle qui porte le `Reply-To` (migration 0030). Un digest n'en a
-- aucune.
alter table public.mail_outbox drop constraint if exists mail_outbox_card_par_kind;
alter table public.mail_outbox add constraint mail_outbox_card_par_kind check ((kind = 'card') = (card_id is not null));

comment on column public.mail_outbox.kind is
	'CRM-069 — `card` : un envoi au nom d''une affaire, son `Reply-To` ramène les réponses dans le CRM ; `digest` : le '
	'récapitulatif quotidien, sans affaire ni `Reply-To`, par l''identité de service (docs/SPEC-etiquettes-digest.md §5.3).';

-- La réservation rend un digest comme un envoi : sans affaire, son `Reply-To` est nul, et `mail-sync` n'écrit pas l'en-tête.
create or replace function public.reserver_envois(p_limite integer default 10)
returns table(outbox_id uuid, card_id uuid, identity_id uuid, from_address text, reply_to text, to_addrs text[],
              cc_addrs text[], subject text, body_text text, in_reply_to text, references_ids text[], smtp_host text,
              smtp_port integer, smtp_security text, smtp_username text, attempts integer, bcc_addrs text[],
              attachments jsonb)
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
$$;

-- Le succès d'un digest ne range rien dans le courrier d'une affaire : il n'en a pas. Seule sa ligne de file est close.
create or replace function public.marquer_envoi_reussi(p_outbox_id uuid, p_rfc822_message_id text,
                                                       p_references text[] default '{}'::text[],
                                                       p_pieces jsonb default '[]'::jsonb)
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

	if v_envoi.kind = 'digest' then
		update public.mail_outbox
		   set status = 'sent', sent_at = now(), rfc822_message_id = p_rfc822_message_id, last_error = null
		 where id = p_outbox_id;
		return null;
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

-- =============================================================================================
-- 4. Le contenu et le job — §5.2, §5.4
-- =============================================================================================

-- Le corps d'un digest, ou `null` s'il n'y a rien à dire. Chaque ligne est filtrée par le droit de lecture de la personne
-- (`app.can_read_card_pour`) : un droit retiré la veille retire l'affaire du digest. Les liens commencent par le jeton
-- `{site}`, que `mail-sync` remplace par son `SITE_URL` (décision 772) : la base ne connaît pas l'adresse publique.
create or replace function app.digest_corps(p_profile uuid, p_workspace uuid, p_maintenant timestamptz)
returns table (sujet text, corps text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_jour      date := (p_maintenant at time zone 'Europe/Paris')::date;
	v_debut     timestamptz := (v_jour::timestamp at time zone 'Europe/Paris');
	v_fin       timestamptz := ((v_jour + 1)::timestamp at time zone 'Europe/Paris');
	v_espace    text;
	v_retard    text[];
	v_jourdhui  text[];
	v_mentions  text[];
	v_figees    text[];
	v_actions   integer;
	v_n_mention integer;
	v_lignes    text[] := array[]::text[];
begin
	select w.name into v_espace from public.workspaces w where w.id = p_workspace;

	with actions as (
		select c.id, c.title, p.next_action, p.next_action_at, t.slug as track, ch.slug as channel
		  from public.card_placements p
		  join public.cards c on c.id = p.card_id
		  join public.channels ch on ch.id = p.channel_id
		  join public.tracks t on t.id = ch.track_id
		 where c.workspace_id = p_workspace
		   and p.owner_id = p_profile
		   and p.archived_at is null and c.deleted_at is null
		   and (p.snoozed_until is null or p.snoozed_until <= p_maintenant)
		   and p.next_action_at is not null and p.next_action_at < v_fin
		   and app.can_read_card_pour(c.id, p_profile)
	)
	select array_agg(format('- %s — %s%s{site}/tracks/%s/%s/cards/%s', a.title,
	                        coalesce(a.next_action || ' — ', ''), E'\n  ', a.track, a.channel, a.id)
	                 order by a.next_action_at) filter (where a.next_action_at < v_debut),
	       array_agg(format('- %s — %s%s{site}/tracks/%s/%s/cards/%s', a.title,
	                        coalesce(a.next_action || ' — ', ''), E'\n  ', a.track, a.channel, a.id)
	                 order by a.next_action_at) filter (where a.next_action_at >= v_debut),
	       count(*)
	  into v_retard, v_jourdhui, v_actions
	  from actions a;

	select array_agg(format('- %s%s{site}/tracks/%s/%s/cards/%s', c.title, E'\n  ', t.slug, ch.slug, c.id)
	                 order by n.created_at),
	       count(*)
	  into v_mentions, v_n_mention
	  from public.notifications n
	  join public.cards c on c.id = n.subject_card_id
	  join lateral (select p.channel_id from public.card_placements p where p.card_id = c.id
	                 order by p.created_at, p.id limit 1) r on true
	  join public.channels ch on ch.id = r.channel_id
	  join public.tracks t on t.id = ch.track_id
	 where n.recipient_id = p_profile and n.workspace_id = p_workspace and n.read_at is null
	   and c.deleted_at is null
	   and app.can_read_card_pour(c.id, p_profile);

	select array_agg(format('- %s — %s jours dans l''étape, seuil %s%s{site}/tracks/%s/%s/cards/%s', f.title,
	                        f.jours_dans_etape, f.seuil_jours, E'\n  ', t.slug, ch.slug, f.card_id)
	                 order by f.retard_jours desc)
	  into v_figees
	  from public.cards_figees() f
	  join public.channels ch on ch.id = f.channel_id
	  join public.tracks t on t.id = ch.track_id
	 where f.workspace_id = p_workspace and f.owner_id = p_profile
	   and app.can_read_card_pour(f.card_id, p_profile);

	if coalesce(v_actions, 0) = 0 and coalesce(v_n_mention, 0) = 0 and v_figees is null then
		return;
	end if;

	v_lignes := v_lignes || format('Bonjour,%sVoici ce qui vous attend aujourd''hui dans %s.', E'\n\n', v_espace);
	if v_retard is not null then
		v_lignes := v_lignes || (E'\nEn retard\n' || array_to_string(v_retard, E'\n'));
	end if;
	if v_jourdhui is not null then
		v_lignes := v_lignes || (E'\nAujourd''hui\n' || array_to_string(v_jourdhui, E'\n'));
	end if;
	if v_mentions is not null then
		v_lignes := v_lignes || (E'\nOn vous a mentionné\n' || array_to_string(v_mentions, E'\n'));
	end if;
	if v_figees is not null then
		v_lignes := v_lignes || (E'\nAffaires figées\n' || array_to_string(v_figees, E'\n'));
	end if;
	-- `::text` : sans lui, un littéral concaténé à un `text[]` est lu comme un littéral de tableau (mesuré : `22P02`).
	v_lignes := v_lignes || (E'\nVous recevez ce récapitulatif parce que vous l''avez demandé dans Réglages ▸ Notifications. '
	                         'Décochez la case pour ne plus le recevoir.')::text;

	sujet := format('Votre journée dans %s — %s action(s), %s mention(s)', v_espace, coalesce(v_actions, 0),
	                coalesce(v_n_mention, 0));
	corps := array_to_string(v_lignes, E'\n');
	return next;
end;
$$;

-- Le job. Il n'agit qu'à 7 h, heure de Paris : appelé chaque heure, il tient le passage à l'heure d'été sans deux
-- planifications. Idempotent par `digest_runs`. `p_maintenant` rend l'instant prouvable sans attendre 7 h.
create or replace function app.envoyer_digests(p_maintenant timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_jour     date := (p_maintenant at time zone 'Europe/Paris')::date;
	v_abonne   record;
	v_identite uuid;
	v_adresse  text;
	v_contenu  record;
	v_outbox   uuid;
	v_files    integer := 0;
begin
	if extract(hour from (p_maintenant at time zone 'Europe/Paris')) <> 7 then
		return 0;
	end if;

	for v_abonne in
		select s.profile_id, s.workspace_id
		  from public.digest_subscriptions s
		 where exists (select 1 from public.workspace_members m
		                where m.workspace_id = s.workspace_id and m.user_id = s.profile_id)
		   and not exists (select 1 from public.digest_runs r
		                    where r.profile_id = s.profile_id and r.workspace_id = s.workspace_id and r.day = v_jour)
	loop
		select i.id into v_identite
		  from public.mail_outbound_identities i
		 where i.workspace_id = v_abonne.workspace_id and i.owner_id is null
		 order by i.is_default desc, i.created_at
		 limit 1;
		if v_identite is null then
			insert into public.digest_runs (profile_id, workspace_id, day, status)
			values (v_abonne.profile_id, v_abonne.workspace_id, v_jour, 'no_service_identity');
			continue;
		end if;

		select * into v_contenu from app.digest_corps(v_abonne.profile_id, v_abonne.workspace_id, p_maintenant);
		if v_contenu.corps is null then
			insert into public.digest_runs (profile_id, workspace_id, day, status)
			values (v_abonne.profile_id, v_abonne.workspace_id, v_jour, 'empty');
			continue;
		end if;

		select p.email into v_adresse from public.profiles p where p.id = v_abonne.profile_id;
		-- SANS ADRESSE CONNUE, RIEN NE PART, ET LE JOURNAL LE DIT : une ligne de file adressée à `null` passerait la
		-- contrainte de destinataire (un tableau d'un élément nul a une longueur), et l'envoi échouerait plus loin, en
		-- silence. Une personne qui ne s'est jamais connectée n'a pas d'adresse (décision 773).
		if v_adresse is null or btrim(v_adresse) = '' then
			insert into public.digest_runs (profile_id, workspace_id, day, status)
			values (v_abonne.profile_id, v_abonne.workspace_id, v_jour, 'no_address');
			continue;
		end if;
		insert into public.mail_outbox (workspace_id, identity_id, card_id, kind, to_addrs, subject, body_text)
		values (v_abonne.workspace_id, v_identite, null, 'digest', array[v_adresse], v_contenu.sujet, v_contenu.corps)
		returning id into v_outbox;
		insert into public.digest_runs (profile_id, workspace_id, day, status, outbox_id)
		values (v_abonne.profile_id, v_abonne.workspace_id, v_jour, 'queued', v_outbox);
		v_files := v_files + 1;
	end loop;
	return v_files;
end;
$$;

do $$
declare
	f text;
begin
	foreach f in array array['app.digest_subscriptions_avant()', 'app.digest_corps(uuid, uuid, timestamptz)',
		'app.envoyer_digests(timestamptz)'] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated, service_role', f);
	end loop;
end;
$$;

-- Chaque heure, à la minute 2 : la fonction n'agit qu'à 7 h de Paris (§5.4). Minute 2, que nulle autre tâche ne prend
-- (`cron.job` relevé le 2026-10-28 : 7 pour le battement horaire, et 17, 23, 29, 41, 53 pour les tâches de 3 h). Un nom stable met à jour le job
-- sans changer son identifiant (migration 0018).
do $$
declare
	job_id bigint;
begin
	select cron.schedule('p2enjoy-digest-quotidien', '2 * * * *', 'select app.envoyer_digests();') into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

notify pgrst, 'reload schema';
