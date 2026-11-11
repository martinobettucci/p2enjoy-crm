-- @spec CRM-141 (docs/BACKLOG.md) — tranche T1 : les pastilles d'un mail — la liste de l'espace et ses défauts, les
--       pastilles d'un message où la main prime, la file d'évaluation, et les gestes d'une personne et de la passe
-- @spec docs/SPEC-mail-subsystem.md §31.2 (le modèle), §31.3 (qui lit, qui écrit), §31.4 (set_message_label,
--       request_label_evaluation), §31.5 (la file, claim_label_evaluations, record_label_evaluation, l'espacement des
--       échecs), §31.6 (les défauts) ; docs/SCHEMA.md « Migration — les pastilles d'un mail » ; docs/DAT.md §12 bis
--       (noms anglais, décision 658) ; docs/JOURNAL.md décisions 883, 923, 924 et 926 ; CLAUDE.md §10 (la règle tenue en
--       base, jamais par l'écran)
--
-- LA MAIN PRIME, ET C'EST UNE LIGNE, PAS UNE MÉMOIRE À CÔTÉ. Une ligne `source = 'manual'` de `mail_message_labels` est un
-- choix qu'aucune évaluation ne touche : posé (`applied`) ou retiré (`not applied`). `record_label_evaluation` ne
-- remplace que les lignes `llm`, et n'en pose aucune là où une ligne `manual` existe.
--
-- CE QUE CETTE MIGRATION NE FAIT PAS : appeler le modèle. La route de la fonction `ia`, le secret et la cadence `pg_cron`
-- viennent avec T2 (docs/SPEC-mail-subsystem.md §31.11). D'ici là, la file se remplit et attend.

-- =============================================================================================
-- 1. Les pastilles de l'espace
-- =============================================================================================

create table public.mail_labels (
	id           uuid primary key default gen_random_uuid(),
	workspace_id uuid not null references public.workspaces (id) on delete cascade,
	name         text not null
		constraint mail_labels_name_check check (name = btrim(name) and char_length(name) between 1 and 40),
	color        text not null default 'neutral'
		constraint mail_labels_color_check check (color in ('brand', 'success', 'accent', 'danger', 'neutral')),
	description  text not null
		constraint mail_labels_description_check check (char_length(btrim(description)) between 1 and 500),
	archived_at  timestamptz,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	created_by   uuid references public.profiles (id) on delete set null
);
comment on table public.mail_labels is
	'CRM-141 : les pastilles des mails d''un espace — un nom, une couleur, et un descriptif que le modèle lit pour décider. '
	'Jamais détruites par l''API : archivées (décision 926). docs/SPEC-mail-subsystem.md §31.2.';

-- Unique ARCHIVÉES COMPRISES : une pastille archivée garde son nom (docs/DESIGN_SYSTEM.md §5.29 bis).
create unique index mail_labels_nom_unique on public.mail_labels (workspace_id, lower(name));

create trigger mail_labels_updated_at
	before update on public.mail_labels
	for each row execute function app.set_updated_at();

-- L'auteur est posé par le serveur, jamais lu de la requête.
create or replace function app.mail_labels_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.created_by := (select p.id from public.profiles p where p.id = auth.uid());
	return new;
end;
$$;
create trigger mail_labels_created_by
	before insert on public.mail_labels
	for each row execute function app.mail_labels_created_by();

alter table public.mail_labels enable row level security;

create policy mail_labels_lecture on public.mail_labels
	for select to anon, authenticated
	using (app.is_workspace_member(workspace_id));
create policy mail_labels_insertion on public.mail_labels
	for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));
create policy mail_labels_maj on public.mail_labels
	for update to authenticated
	using (app.is_workspace_admin(workspace_id))
	with check (app.is_workspace_admin(workspace_id));

-- `anon` lit pour rendre zéro ligne plutôt qu'une erreur de privilège (docs/SPEC-permissions-rls.md §7). L'espace d'une
-- pastille ne se change pas : il est absent des colonnes écrivables. Aucun `DELETE`.
revoke all on public.mail_labels from anon, authenticated;
grant select on public.mail_labels to anon, authenticated;
grant insert (workspace_id, name, color, description) on public.mail_labels to authenticated;
grant update (name, color, description, archived_at) on public.mail_labels to authenticated;

-- =============================================================================================
-- 2. Les pastilles d'un message
-- =============================================================================================

create table public.mail_message_labels (
	message_id   uuid not null references public.mail_messages (id) on delete cascade,
	label_id     uuid not null references public.mail_labels (id) on delete cascade,
	workspace_id uuid not null references public.workspaces (id) on delete cascade,
	source       text not null
		constraint mail_message_labels_source_check check (source in ('llm', 'manual')),
	applied      boolean not null default true,
	set_by       uuid references public.profiles (id) on delete set null,
	set_at       timestamptz not null default now(),
	primary key (message_id, label_id),
	-- Seule la main retire : une ligne `llm` est toujours une pose.
	constraint mail_message_labels_retrait_manuel check (applied or source = 'manual')
);
comment on table public.mail_message_labels is
	'CRM-141 : les pastilles d''un message. Une ligne `manual` — posée ou retirée — est un choix qu''aucune évaluation ne '
	'touche. Écrite par les fonctions seules. docs/SPEC-mail-subsystem.md §31.2.';

create index mail_message_labels_filtre_idx on public.mail_message_labels (label_id, message_id) where applied;

alter table public.mail_message_labels enable row level security;
create policy mail_message_labels_lecture on public.mail_message_labels
	for select to anon, authenticated
	using (app.peut_voir_message(message_id));

revoke all on public.mail_message_labels from anon, authenticated;
grant select on public.mail_message_labels to anon, authenticated;

-- =============================================================================================
-- 3. L'état d'évaluation d'un message, et la file
-- =============================================================================================

create table public.mail_label_evaluations (
	message_id      uuid primary key references public.mail_messages (id) on delete cascade,
	workspace_id    uuid not null references public.workspaces (id) on delete cascade,
	state           text not null default 'pending'
		constraint mail_label_evaluations_state_check check (state in ('pending', 'done', 'failed')),
	-- 0 : un mail neuf ou une demande ; 1 : le rattrapage. Un mail neuf passe toujours devant le rattrapage.
	priority        smallint not null default 0
		constraint mail_label_evaluations_priority_check check (priority in (0, 1)),
	requested_at    timestamptz not null default now(),
	attempts        smallint not null default 0,
	next_attempt_at timestamptz not null default now(),
	leased_until    timestamptz,
	-- Quand la passe en cours l'a pris : une demande arrivée APRÈS ne se perd pas à la clôture (§31.5).
	claimed_at      timestamptz,
	last_error      text
		constraint mail_label_evaluations_last_error_check
		check (last_error in ('delai_depasse', 'serveur_injoignable', 'cle_refusee', 'reponse_invalide')),
	evaluated_at    timestamptz
);
comment on table public.mail_label_evaluations is
	'CRM-141 : l''état d''évaluation des pastilles d''un message reçu, et la file de la passe. Écrite par les fonctions '
	'seules. docs/SPEC-mail-subsystem.md §31.2, §31.5.';

create index mail_label_evaluations_dues_idx on public.mail_label_evaluations (priority, requested_at)
	where state = 'pending';

alter table public.mail_label_evaluations enable row level security;
create policy mail_label_evaluations_lecture on public.mail_label_evaluations
	for select to anon, authenticated
	using (app.peut_voir_message(message_id));

revoke all on public.mail_label_evaluations from anon, authenticated;
grant select on public.mail_label_evaluations to anon, authenticated;

-- =============================================================================================
-- 4. Les gestes d'une personne — qui voit le message ET édite l'espace (décision 926)
-- =============================================================================================

-- La garde commune : le message existe, il est vu, et l'appelant édite son espace. Rend l'espace du message.
create or replace function app.label_gesture_guard(p_message_id uuid)
returns public.mail_messages
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	select * into v_message from public.mail_messages m where m.id = p_message_id and m.deleted_at is null;
	-- Inconnu, en corbeille ou illisible : indiscernables (docs/SPEC-permissions-rls.md §7).
	if v_message.id is null or not app.peut_voir_message(p_message_id) then
		perform app.raise_http_error(404, 'message_not_found');
	end if;
	if not coalesce(app.workspace_role(v_message.workspace_id) in ('admin', 'business_developer'), false) then
		raise exception 'forbidden' using errcode = '42501';
	end if;
	return v_message;
end;
$$;
revoke all on function app.label_gesture_guard(uuid) from public;

create or replace function public.set_message_label(p_message_id uuid, p_label_id uuid, p_applied boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
	v_label   public.mail_labels%rowtype;
begin
	if p_label_id is null or p_applied is null then
		raise exception 'invalid_argument' using errcode = '22023';
	end if;
	v_message := app.label_gesture_guard(p_message_id);
	select * into v_label from public.mail_labels l where l.id = p_label_id and l.workspace_id = v_message.workspace_id;
	if v_label.id is null then
		perform app.raise_http_error(404, 'label_not_found');
	end if;
	-- Une archivée ne se POSE plus ; la retirer reste permis, pour qu'un mail s'en débarrasse.
	if p_applied and v_label.archived_at is not null then
		raise exception 'label_archived' using errcode = '22023';
	end if;
	insert into public.mail_message_labels (message_id, label_id, workspace_id, source, applied, set_by, set_at)
	values (p_message_id, p_label_id, v_message.workspace_id, 'manual', p_applied,
	        (select p.id from public.profiles p where p.id = auth.uid()), now())
	on conflict (message_id, label_id) do update
		set source = 'manual', applied = excluded.applied, set_by = excluded.set_by, set_at = now();
end;
$$;
comment on function public.set_message_label(uuid, uuid, boolean) is
	'CRM-141 — docs/SPEC-mail-subsystem.md §31.4. Pose ou retire une pastille, TOUJOURS comme un choix manuel, que la '
	'réévaluation ne touche jamais. Pour qui voit le message et édite son espace. Refus : message_not_found, forbidden, '
	'label_not_found, label_archived.';
revoke all on function public.set_message_label(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_message_label(uuid, uuid, boolean) to authenticated;

create or replace function public.request_label_evaluation(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
begin
	v_message := app.label_gesture_guard(p_message_id);
	if v_message.direction <> 'inbound' then
		raise exception 'outbound_message' using errcode = '22023';
	end if;
	-- Une demande remonte le message en tête, sans le dupliquer. La réservation d'une passe en cours est GARDÉE : deux
	-- passes ne prennent jamais le même message ; `claimed_at` fera reprendre la demande après la clôture (§31.5).
	insert into public.mail_label_evaluations (message_id, workspace_id, state, priority, requested_at, attempts,
	                                           next_attempt_at)
	values (p_message_id, v_message.workspace_id, 'pending', 0, now(), 0, now())
	on conflict (message_id) do update
		set state = 'pending', priority = 0, requested_at = now(), attempts = 0, next_attempt_at = now(),
		    last_error = null;
end;
$$;
comment on function public.request_label_evaluation(uuid) is
	'CRM-141 — docs/SPEC-mail-subsystem.md §31.4. Le bouton « Réévaluer les pastilles » : le message repasse en attente, '
	'en tête de file. Pour qui voit le message et édite son espace. Refus : message_not_found, forbidden, outbound_message.';
revoke all on function public.request_label_evaluation(uuid) from public, anon;
grant execute on function public.request_label_evaluation(uuid) to authenticated;

-- =============================================================================================
-- 5. La passe — la clé de service seule
-- =============================================================================================

-- Prend jusqu'à `p_limit` évaluations dues (une par défaut), sans jamais prendre celle d'une autre passe. Rend ce que le
-- modèle peut recevoir (docs/SPEC-ia.md §15.1) — la fonction tronque — et les pastilles ACTIVES de l'espace.
create or replace function public.claim_label_evaluations(p_limit integer default 1)
returns table (
	message_id   uuid,
	workspace_id uuid,
	subject      text,
	from_address text,
	from_name    text,
	body_text    text,
	body_html    text,
	labels       jsonb
)
language sql
security definer
set search_path = ''
as $$
	with dues as (
		select e.message_id
		  from public.mail_label_evaluations e
		 where e.state = 'pending'
		   and e.next_attempt_at <= now()
		   and (e.leased_until is null or e.leased_until < now())
		   and exists (select 1 from public.mail_messages m where m.id = e.message_id and m.deleted_at is null)
		 -- Les neufs dans l'ordre d'arrivée ; le rattrapage, les plus récents d'abord (décision 923).
		 order by e.priority,
		          case when e.priority = 0 then e.requested_at end asc,
		          case when e.priority = 1 then e.requested_at end desc
		 limit greatest(1, least(coalesce(p_limit, 1), 20))
		 for update skip locked
	), prises as (
		update public.mail_label_evaluations e
		   set leased_until = now() + interval '5 minutes',
		       claimed_at = now(),
		       attempts = e.attempts + 1
		  from dues
		 where e.message_id = dues.message_id
		returning e.message_id, e.workspace_id
	)
	select m.id, m.workspace_id, m.subject, m.from_address, m.from_name,
	       left(m.body_text, 20000), left(m.body_html, 60000),
	       coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'description', l.description)
	                                  order by lower(l.name))
	                   from public.mail_labels l
	                  where l.workspace_id = m.workspace_id and l.archived_at is null), '[]'::jsonb)
	  from prises
	  join public.mail_messages m on m.id = prises.message_id;
$$;
comment on function public.claim_label_evaluations(integer) is
	'CRM-141 — docs/SPEC-mail-subsystem.md §31.5. Réserve des évaluations dues pour cinq minutes (skip locked), compte '
	'l''essai, et rend le message et les pastilles actives de son espace. service_role seul.';
revoke all on function public.claim_label_evaluations(integer) from public, anon, authenticated;
grant execute on function public.claim_label_evaluations(integer) to service_role;

create or replace function public.record_label_evaluation(p_message_id uuid, p_label_ids uuid[], p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_eval public.mail_label_evaluations%rowtype;
begin
	select * into v_eval from public.mail_label_evaluations e where e.message_id = p_message_id for update;
	if v_eval.message_id is null then
		perform app.raise_http_error(404, 'evaluation_not_found');
	end if;
	if p_error is null then
		-- Les lignes `llm` sont REMPLACÉES ; une ligne `manual` n'est jamais touchée, et bloque la pose du modèle.
		delete from public.mail_message_labels x where x.message_id = p_message_id and x.source = 'llm';
		insert into public.mail_message_labels (message_id, label_id, workspace_id, source, applied, set_by, set_at)
		select p_message_id, l.id, l.workspace_id, 'llm', true, null, now()
		  from public.mail_labels l
		 where l.id = any (coalesce(p_label_ids, '{}'::uuid[]))
		   and l.workspace_id = v_eval.workspace_id
		   and l.archived_at is null
		on conflict (message_id, label_id) do nothing;
		update public.mail_label_evaluations e
		   set evaluated_at = now(), leased_until = null, last_error = null, attempts = 0,
		       -- Une demande arrivée pendant la passe reste en attente : elle sera reprise.
		       state = case when e.requested_at > coalesce(e.claimed_at, '-infinity') then 'pending' else 'done' end
		 where e.message_id = p_message_id;
	else
		if p_error not in ('delai_depasse', 'serveur_injoignable', 'cle_refusee', 'reponse_invalide') then
			raise exception 'invalid_error' using errcode = '22023';
		end if;
		update public.mail_label_evaluations e
		   set last_error = p_error,
		       leased_until = null,
		       state = case when e.attempts >= 5 then 'failed' else 'pending' end,
		       next_attempt_at = now() + case e.attempts
		                                     when 1 then interval '1 minute'
		                                     when 2 then interval '5 minutes'
		                                     when 3 then interval '30 minutes'
		                                     else interval '2 hours'
		                                 end
		 where e.message_id = p_message_id;
	end if;
end;
$$;
comment on function public.record_label_evaluation(uuid, uuid[], text) is
	'CRM-141 — docs/SPEC-mail-subsystem.md §31.5. Clôt une évaluation : remplace les pastilles `llm` par celles rendues, '
	'restreintes aux actives de l''espace et sans toucher une ligne manuelle ; ou compte l''échec et espace le suivant '
	'(1 min, 5 min, 30 min, 2 h ; failed au cinquième). service_role seul.';
revoke all on function public.record_label_evaluation(uuid, uuid[], text) from public, anon, authenticated;
grant execute on function public.record_label_evaluation(uuid, uuid[], text) to service_role;

-- =============================================================================================
-- 6. Les défauts, et l'entrée dans la file
-- =============================================================================================

create or replace function app.seed_default_mail_labels(p_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
	insert into public.mail_labels (workspace_id, name, color, description)
	values
		(p_workspace_id, 'Spam', 'danger',
		 'Courrier indésirable : publicité non sollicitée, arnaque, hameçonnage, message sans rapport avec l''activité.'),
		(p_workspace_id, 'Lead', 'success',
		 'Un prospect qui s''intéresse à nos services : demande d''information, de rendez-vous ou de premier échange.'),
		(p_workspace_id, 'Devis / commande', 'brand',
		 'Une demande de devis, l''acceptation d''un devis, un bon de commande ou la confirmation d''une commande.'),
		(p_workspace_id, 'Facture / paiement', 'accent',
		 'Une facture reçue ou à émettre, une relance de paiement, un avis de virement ou une question de règlement.'),
		(p_workspace_id, 'Support client', 'brand',
		 'Un client existant qui signale un problème, pose une question d''usage ou demande une assistance.'),
		(p_workspace_id, 'Partenariat', 'success',
		 'Une proposition de partenariat, de collaboration, de sponsoring ou de co-production.'),
		(p_workspace_id, 'Recrutement', 'neutral',
		 'Une candidature, une offre d''emploi, une demande de stage ou un échange avec un cabinet de recrutement.'),
		(p_workspace_id, 'Newsletter', 'neutral',
		 'Une lettre d''information, une publication périodique ou un envoi groupé auquel on est abonné.'),
		(p_workspace_id, 'Administratif', 'neutral',
		 'Une démarche administrative, juridique, fiscale ou sociale : impôts, banque, assurance, organismes publics.')
	on conflict (workspace_id, lower(name)) do nothing;
$$;
revoke all on function app.seed_default_mail_labels(uuid) from public;

create or replace function app.workspaces_default_mail_labels()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform app.seed_default_mail_labels(new.id);
	return new;
end;
$$;
create trigger workspaces_default_mail_labels
	after insert on public.workspaces
	for each row execute function app.workspaces_default_mail_labels();

-- Chaque message REÇU entre dans la file, en tête ; un message envoyé n'est pas évalué (décision 926).
create or replace function app.mail_messages_enqueue_label_evaluation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.direction = 'inbound' then
		insert into public.mail_label_evaluations (message_id, workspace_id, state, priority, requested_at, next_attempt_at)
		values (new.id, new.workspace_id, 'pending', 0, now(), now())
		on conflict (message_id) do nothing;
	end if;
	return new;
end;
$$;
create trigger mail_messages_enqueue_label_evaluation
	after insert on public.mail_messages
	for each row execute function app.mail_messages_enqueue_label_evaluation();

-- Les espaces existants reçoivent leurs défauts ; tous les messages reçus existants, hors corbeille, entrent dans le
-- rattrapage (décision 923), datés de leur réception pour que les plus récents passent d'abord.
select app.seed_default_mail_labels(w.id) from public.workspaces w;

insert into public.mail_label_evaluations (message_id, workspace_id, state, priority, requested_at, next_attempt_at)
select m.id, m.workspace_id, 'pending', 1, m.received_at, now()
  from public.mail_messages m
 where m.direction = 'inbound' and m.deleted_at is null
on conflict (message_id) do nothing;
