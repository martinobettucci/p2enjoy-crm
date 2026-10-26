-- @spec CRM-057 (docs/BACKLOG.md) — tranche 2 : lu / non lu dans l'inbox
-- @spec docs/SPEC-mail-subsystem.md §18 bis.2 (les choix validés : état personnel, courrier reçu seul, fil marqué lu à
--       l'ouverture, arborescence qui garde son total), §18 bis.3 (le modèle) ; docs/SCHEMA.md `mail_message_reads` ;
--       docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 707, 708, 715 et 716 ; docs/DAT.md §12 bis (les noms)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION AJOUTE.
-- ---------------------------------------------------------------------------------------------
--
-- Une table de lectures PERSONNELLES — une ligne par message lu par une personne —, deux fonctions qui en sont les
-- seules portes d'écriture, une colonne calculée `is_read` sur `mail_messages`, et une colonne `unread_count` dans
-- l'arborescence de l'inbox. AUCUNE LECTURE N'EST FABRIQUÉE : les messages déjà reçus naissent non lus pour tous, la
-- migration ne pouvant pas juger qui les a déjà vus (§18 bis.2 point 5, CLAUDE.md §8).
--
-- Rejouable : `create … if not exists`, `create or replace`, politiques retirées avant d'être reposées ; l'arborescence
-- est retirée puis recréée, son type rendu changeant.

-- =============================================================================================
-- 1. La table — §18 bis.3
-- =============================================================================================

create table if not exists public.mail_message_reads (
	message_id uuid        not null references public.mail_messages (id) on delete cascade,
	user_id    uuid        not null references public.profiles (id) on delete cascade,
	read_at    timestamptz not null default now(),
	primary key (message_id, user_id)
);

comment on table public.mail_message_reads is
	'CRM-057 tranche 2 §18 bis.3 — les messages REÇUS qu''une personne a lus dans l''inbox. Une ligne par message et par '
	'personne : l''état est personnel. Écrite par `mark_messages_read` et `mark_message_unread` seulement.';

-- Index du compte des non lus d'UNE personne : la clé primaire commence par le message, et l'arborescence cherche les
-- lectures de l'appelant.
create index if not exists mail_message_reads_user_idx on public.mail_message_reads (user_id, message_id);

alter table public.mail_message_reads enable row level security;

-- LECTURE DE SES LIGNES SEULES. Une ligne ne dit que « j'ai lu ce message » : la lire n'apprend rien d'un message
-- invisible, et la lecture d'autrui n'est l'affaire de personne.
drop policy if exists mail_message_reads_lecture on public.mail_message_reads;
create policy mail_message_reads_lecture
	on public.mail_message_reads
	for select
	to authenticated
	using (user_id = (select auth.uid()));

-- AUCUNE ÉCRITURE DIRECTE : les deux fonctions ci-dessous sont les seules portes, et elles portent la garde de
-- visibilité. Une insertion directe contournerait `app.peut_voir_message`.
revoke all on public.mail_message_reads from public, anon, authenticated;
grant select on public.mail_message_reads to authenticated;
grant all on public.mail_message_reads to service_role;

-- =============================================================================================
-- 2. Marquer lu — §18 bis.3
-- =============================================================================================
--
-- UN IDENTIFIANT INVISIBLE, INCONNU OU ENVOYÉ EST IGNORÉ SANS ERREUR : c'est la règle de discrétion
-- (docs/SPEC-permissions-rls.md §7), un refus ne se distinguant pas d'une absence. La valeur rendue est le nombre de
-- messages visibles et reçus de la liste qui sont désormais lus par l'appelant — idempotente.

create or replace function public.mark_messages_read(p_message_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_lus      integer;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	if coalesce(cardinality(p_message_ids), 0) > 200 then
		raise exception 'too_many_messages'
			using errcode = '22023',
			      detail = 'At most 200 message ids per call.';
	end if;

	with cibles as (
		select m.id
		  from public.mail_messages m
		 where m.id = any (coalesce(p_message_ids, '{}'))
		   and m.direction = 'inbound'
		   and app.peut_voir_message(m.id)
	), poses as (
		insert into public.mail_message_reads (message_id, user_id)
		select id, v_appelant from cibles
		on conflict (message_id, user_id) do nothing
	)
	select count(*) into v_lus from cibles;

	return v_lus;
end;
$$;

comment on function public.mark_messages_read(uuid[]) is
	'CRM-057 tranche 2 §18 bis.3 — marque lus, pour l''appelant, les messages REÇUS qu''il voit parmi ceux donnés (200 au '
	'plus : `too_many_messages`). Un message invisible, inconnu ou envoyé est ignoré sans erreur. Rend le nombre de '
	'messages de la liste désormais lus. Idempotente.';

alter function public.mark_messages_read(uuid[]) owner to postgres;
revoke all on function public.mark_messages_read(uuid[]) from public, anon;
grant execute on function public.mark_messages_read(uuid[]) to authenticated, service_role;

-- =============================================================================================
-- 3. Marquer non lu — §18 bis.3
-- =============================================================================================

create or replace function public.mark_message_unread(p_message_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
volatile
as $$
declare
	v_appelant uuid := (select auth.uid());
	v_retirees integer;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	-- La garde de visibilité vaut aussi ici : un message qu'on ne voit plus n'a pas d'état à changer.
	if not app.peut_voir_message(p_message_id) then
		return false;
	end if;

	delete from public.mail_message_reads
	 where message_id = p_message_id
	   and user_id = v_appelant;
	get diagnostics v_retirees = row_count;
	return v_retirees > 0;
end;
$$;

comment on function public.mark_message_unread(uuid) is
	'CRM-057 tranche 2 §18 bis.3 — remet non lu, pour l''appelant, un message qu''il voit. Rend vrai si une lecture a été '
	'retirée ; faux pour un message invisible, inconnu ou déjà non lu.';

alter function public.mark_message_unread(uuid) owner to postgres;
revoke all on function public.mark_message_unread(uuid) from public, anon;
grant execute on function public.mark_message_unread(uuid) to authenticated, service_role;

-- =============================================================================================
-- 4. La colonne calculée `is_read` — §18 bis.3
-- =============================================================================================
--
-- `SECURITY INVOKER` : elle lit `mail_message_reads` sous sa politique, donc les seules lectures de l'appelant. Un
-- message ENVOYÉ est toujours lu (§18 bis.2 point 2), sans ligne en base.

create or replace function public.is_read(public.mail_messages)
returns boolean
language sql
security invoker
set search_path = ''
stable
as $$
	select $1.direction = 'outbound'
	    or exists (
		select 1
		  from public.mail_message_reads r
		 where r.message_id = $1.id
		   and r.user_id = (select auth.uid())
	);
$$;

comment on function public.is_read(public.mail_messages) is
	'CRM-057 tranche 2 §18 bis.3 — colonne calculée : vrai si l''appelant a lu ce message, ou s''il a été envoyé.';

revoke all on function public.is_read(public.mail_messages) from public, anon;
grant execute on function public.is_read(public.mail_messages) to authenticated, service_role;

-- =============================================================================================
-- 5. L'arborescence de l'inbox gagne `unread_count` — §18 bis.2 point 6, décision 716
-- =============================================================================================
--
-- LE TOTAL RESTE (`nombre`), LES NON LUS S'Y AJOUTENT : variante du responsable. Le type rendu change, donc la fonction
-- est retirée puis recréée ; son seul appelant, `webapp/src/lib/inbox.ts`, est livré dans le même changement.
-- `SECURITY INVOKER`, comme en migration 28 : les deux compteurs suivent la RLS de l'appelant.

drop function if exists public.inbox_arborescence();

create function public.inbox_arborescence()
returns table (
	track_id     uuid,
	track_name   text,
	channel_id   uuid,
	channel_name text,
	card_id      uuid,
	card_title   text,
	nombre       bigint,
	unread_count bigint
)
language sql
security invoker
set search_path = ''
stable
as $$
	-- La ligne des NON CLASSÉS vient toujours en premier, et existe même à zéro (§18.3).
	select null::uuid, null::text, null::uuid, null::text, null::uuid, null::text, count(*),
	       count(*) filter (where not public.is_read(m))
	  from public.mail_messages m
	 where m.card_id is null
	union all
	select t.id, t.name, ch.id, ch.name, c.id, c.title, count(*),
	       count(*) filter (where not public.is_read(m))
	  from public.mail_messages m
	  join public.cards c on c.id = m.card_id
	  join public.channels ch on ch.id = c.channel_id
	  join public.tracks t on t.id = ch.track_id
	 group by t.id, t.name, ch.id, ch.name, c.id, c.title
	 order by 2 nulls first, 4, 6;
$$;

comment on function public.inbox_arborescence() is
	'CRM-057 §18.3 et tranche 2 §18 bis — les dossiers de l''inbox, leur nombre de messages VISIBLES par l''appelant '
	'(`nombre`) et, parmi eux, ceux qu''il n''a pas lus (`unread_count`). `SECURITY INVOKER` : les compteurs suivent la '
	'RLS. La ligne des non classés porte des identifiants nuls et vient toujours en tête, même à zéro.';

revoke all on function public.inbox_arborescence() from public, anon;
grant execute on function public.inbox_arborescence() to authenticated, service_role;

notify pgrst, 'reload schema';
