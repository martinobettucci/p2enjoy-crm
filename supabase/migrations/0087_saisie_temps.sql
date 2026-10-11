-- @spec CRM-098 (docs/BACKLOG.md) — tranche T1 : la saisie de temps et le coût du personnel, en base
-- @spec docs/SPEC-temps.md §2 (unités : minutes, quart de 105, plafond de 420), §3.1 (`couts_personnel`, versions
--       immuables, non rétroactives sauf la première, supprimables avant leur effet), §3.2 (`saisies_temps`, une ligne
--       par personne × jour × cible, plafond sérialisé), §4 (valorisation à la lecture), §5 (autorisations), §6.2
--       (`public.temps_valorise`) ; docs/SCHEMA.md §9 quater « Migration `0087` » ; docs/SPEC-permissions-rls.md §2.2
--       (résolution des droits fins), §3 ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décision 621
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- 1. `public.couts_personnel` : le coût d'un quart de journée d'une personne, une version par date d'effet.
-- 2. `public.saisies_temps` : le temps passé, en minutes, sur un track, un channel ou une affaire.
-- 3. Les règles que l'interface ne fait que refléter : immuabilité et non-rétroactivité des versions, plafond
--    journalier sérialisé, qui saisit pour qui et sur quelle cible.
-- 4. `public.temps_valorise` : le temps et son coût sur une période, sous la RLS de l'appelant.
--
-- LA VALORISATION N'EST JAMAIS STOCKÉE (§4) : une version ne se modifie pas et ne prend pas effet dans le passé, donc le
-- coût d'un jour ancien ne bouge plus ; le calculer à la lecture suffit, et une saisie faite d'avance prend la bonne
-- version sans qu'aucune écriture n'ait à la suivre.
--
-- AUCUNE CLÉ `RESTRICT` (INC-268, décision 619) : la personne d'une saisie ou d'une version est tenue par `NO ACTION`,
-- qui refuse pareil une suppression directe et laisse la suppression d'un espace entier aboutir.
--
-- IDEMPOTENTE ET CONVERGENTE, comme les migrations précédentes, bien que le registre (`CRM-096`) ne la rejoue pas.

-- =============================================================================================
-- 1. `public.couts_personnel`
-- =============================================================================================

create table if not exists public.couts_personnel (
	id           uuid          primary key default gen_random_uuid(),
	workspace_id uuid          not null references public.workspaces (id) on delete cascade,
	profile_id   uuid          not null references public.profiles (id),
	date_effet   date          not null,
	cout_quart   numeric(10,2) not null,
	devise       text          not null default 'EUR',
	created_by   uuid          references public.profiles (id) on delete set null,
	created_at   timestamptz   not null default now()
);

alter table public.couts_personnel drop constraint if exists couts_personnel_cout_quart_check;
alter table public.couts_personnel add  constraint couts_personnel_cout_quart_check check (cout_quart >= 0);
alter table public.couts_personnel drop constraint if exists couts_personnel_devise_check;
alter table public.couts_personnel add  constraint couts_personnel_devise_check check (devise ~ '^[A-Z]{3}$');
alter table public.couts_personnel drop constraint if exists couts_personnel_version_key;
alter table public.couts_personnel add  constraint couts_personnel_version_key unique (workspace_id, profile_id, date_effet);

comment on table public.couts_personnel is
	'CRM-098 — docs/SPEC-temps.md §3.1. Coût d''un quart de journée (105 minutes) d''une personne dans un espace, '
	'versionné par date d''effet. Immuable ; non rétroactif sauf la première version ; supprimable avant son effet.';

-- =============================================================================================
-- 2. `public.saisies_temps`
-- =============================================================================================

create table if not exists public.saisies_temps (
	id           uuid        primary key default gen_random_uuid(),
	workspace_id uuid        not null references public.workspaces (id) on delete cascade,
	profile_id   uuid        not null references public.profiles (id),
	jour         date        not null,
	minutes      integer     not null,
	track_id     uuid,
	channel_id   uuid,
	card_id      uuid,
	created_by   uuid        references public.profiles (id) on delete set null,
	updated_by   uuid        references public.profiles (id) on delete set null,
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	-- La cible appartient à l'espace de la saisie : les clés composées le garantissent sans trigger.
	constraint saisies_temps_track_fkey   foreign key (track_id, workspace_id)
		references public.tracks (id, workspace_id) on delete cascade,
	constraint saisies_temps_channel_fkey foreign key (channel_id, workspace_id)
		references public.channels (id, workspace_id) on delete cascade,
	constraint saisies_temps_card_fkey    foreign key (card_id, workspace_id)
		references public.cards (id, workspace_id) on delete cascade
);

-- §2 : au quart d'heure, jamais nulle (une cellule à zéro est une ligne absente), jamais plus d'une journée.
alter table public.saisies_temps drop constraint if exists saisies_temps_minutes_check;
alter table public.saisies_temps add  constraint saisies_temps_minutes_check
	check (minutes > 0 and minutes <= 420 and minutes % 15 = 0);
-- Décision 621, point 1 : un track, un channel OU une affaire — exactement un.
alter table public.saisies_temps drop constraint if exists saisies_temps_cible_check;
alter table public.saisies_temps add  constraint saisies_temps_cible_check
	check (num_nonnulls(track_id, channel_id, card_id) = 1);

-- §3.2 : la cellule de la matrice EST la ligne — une seule par personne, jour et cible.
create unique index if not exists saisies_temps_track_key
	on public.saisies_temps (profile_id, jour, track_id) where track_id is not null;
create unique index if not exists saisies_temps_channel_key
	on public.saisies_temps (profile_id, jour, channel_id) where channel_id is not null;
create unique index if not exists saisies_temps_card_key
	on public.saisies_temps (profile_id, jour, card_id) where card_id is not null;
create index if not exists saisies_temps_espace_jour_idx
	on public.saisies_temps (workspace_id, jour);

comment on table public.saisies_temps is
	'CRM-098 — docs/SPEC-temps.md §3.2. Temps passé par une personne un jour donné sur un track, un channel ou une '
	'affaire, en minutes (quart = 105, journée = 420). Plafond de 420 minutes par personne, espace et jour.';

drop trigger if exists saisies_temps_set_updated_at on public.saisies_temps;
create trigger saisies_temps_set_updated_at
	before update on public.saisies_temps
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 3. Les règles des versions de coût
-- =============================================================================================

-- À la création : l'auteur est l'appelant ; la personne est membre de l'espace OU y a déjà saisi du temps — un
-- administrateur du domaine (`0079`) n'a pas de ligne d'appartenance et doit pourtant pouvoir être valorisé ; la date
-- d'effet n'est pas passée, sauf pour la première version de la personne dans l'espace (§3.1).
create or replace function app.couts_personnel_avant_insertion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	new.created_by := coalesce((select auth.uid()), new.created_by);
	if not exists (select 1 from public.workspace_members m
	                where m.workspace_id = new.workspace_id and m.user_id = new.profile_id)
	   and not exists (select 1 from public.saisies_temps s
	                    where s.workspace_id = new.workspace_id and s.profile_id = new.profile_id) then
		raise exception 'personne hors de l''espace' using errcode = 'P0001';
	end if;
	if new.date_effet < current_date
	   and exists (select 1 from public.couts_personnel v
	                where v.workspace_id = new.workspace_id and v.profile_id = new.profile_id) then
		raise exception 'version retroactive' using errcode = 'P0001';
	end if;
	return new;
end;
$$;

-- Augmenter quelqu'un, c'est créer une version : aucune ne se modifie.
create or replace function app.couts_personnel_immuable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	raise exception 'version de cout immuable' using errcode = 'P0001';
end;
$$;

-- Une version en vigueur reste à jamais ; une version programmée se retire. La suppression d'un espace entier
-- emporte toutes ses versions : la cascade est reconnue à ce que l'espace n'existe déjà plus.
create or replace function app.couts_personnel_avant_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if old.date_effet <= current_date
	   and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
		raise exception 'version en vigueur' using errcode = 'P0001';
	end if;
	return old;
end;
$$;

revoke all on function app.couts_personnel_avant_insertion()   from public;
revoke all on function app.couts_personnel_immuable()          from public;
revoke all on function app.couts_personnel_avant_suppression() from public;

drop trigger if exists couts_personnel_avant_insertion on public.couts_personnel;
create trigger couts_personnel_avant_insertion
	before insert on public.couts_personnel
	for each row execute function app.couts_personnel_avant_insertion();
drop trigger if exists couts_personnel_immuable on public.couts_personnel;
create trigger couts_personnel_immuable
	before update on public.couts_personnel
	for each row execute function app.couts_personnel_immuable();
drop trigger if exists couts_personnel_avant_suppression on public.couts_personnel;
create trigger couts_personnel_avant_suppression
	before delete on public.couts_personnel
	for each row execute function app.couts_personnel_avant_suppression();

-- =============================================================================================
-- 4. Les règles des saisies
-- =============================================================================================

-- Une mise à jour ne change que `minutes` (§3.2) ; l'auteur de chaque écriture est retenu (décision 621, point 7).
create or replace function app.saisies_temps_auteur()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		new.created_by := coalesce((select auth.uid()), new.created_by);
		new.updated_by := new.created_by;
	else
		if (new.workspace_id, new.profile_id, new.jour, new.track_id, new.channel_id, new.card_id, new.created_by,
		    new.created_at)
		   is distinct from
		   (old.workspace_id, old.profile_id, old.jour, old.track_id, old.channel_id, old.card_id, old.created_by,
		    old.created_at) then
			raise exception 'seules les minutes d''une saisie changent' using errcode = 'P0001';
		end if;
		new.updated_by := coalesce((select auth.uid()), new.updated_by);
	end if;
	return new;
end;
$$;

-- LE PLAFOND (§2) : 420 minutes par personne, espace et jour. Le verrou consultatif de transaction sérialise les
-- écritures d'une même personne sur une même date — deux onglets ne dépassent pas la journée ensemble — et la somme
-- est relue APRÈS l'avoir obtenu, dans un instantané qui voit ce que l'autre transaction a validé. `security definer` :
-- la somme porte sur toutes les saisies de la personne, que l'appelant les lise ou non (un administrateur qui saisit
-- pour autrui ne lit pas forcément tout, un membre lit tout ce qui est à lui).
-- Le plafond est compté PAR ESPACE : un refus calculé sur un autre espace trahirait ce qui s'y trouve.
create or replace function app.saisies_temps_plafond()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	deja integer;
begin
	-- Une valeur hors de la forme du §2 est laissée à la contrainte `saisies_temps_minutes_check`, plus précise.
	if new.minutes is null or new.minutes <= 0 or new.minutes > 420 or new.minutes % 15 <> 0 then
		return new;
	end if;
	perform pg_advisory_xact_lock(
		hashtextextended('saisies_temps:' || new.workspace_id::text || ':' || new.profile_id::text || ':' || new.jour::text, 0));
	select coalesce(sum(s.minutes), 0) into deja
	  from public.saisies_temps s
	 where s.workspace_id = new.workspace_id
	   and s.profile_id = new.profile_id
	   and s.jour = new.jour
	   and s.id <> new.id;
	if deja + new.minutes > 420 then
		raise exception 'plafond journalier' using errcode = 'P0001',
			detail = format('%s minutes déjà saisies ce jour, %s demandées, 420 au plus', deja, new.minutes);
	end if;
	return new;
end;
$$;

revoke all on function app.saisies_temps_auteur()  from public;
revoke all on function app.saisies_temps_plafond() from public;

drop trigger if exists saisies_temps_auteur on public.saisies_temps;
create trigger saisies_temps_auteur
	before insert or update on public.saisies_temps
	for each row execute function app.saisies_temps_auteur();
drop trigger if exists saisies_temps_plafond on public.saisies_temps;
create trigger saisies_temps_plafond
	before insert or update of minutes on public.saisies_temps
	for each row execute function app.saisies_temps_plafond();

-- QUI SAISIT POUR QUI, ET SUR QUOI (§5.2). La personne de la saisie a un rôle dans l'espace — l'appelant lui-même, y
-- compris administrateur du domaine (`app.workspace_role_pour` le reconnaît pour lui seul), ou un membre que
-- l'administrateur désigne — ; l'appelant est cette personne ou un administrateur ; et LA PERSONNE lit la cible.
-- Le rôle de workspace et les droits fins se résolvent par `app.resolve_access`, l'unique écriture de la règle.
create or replace function app.saisie_temps_permise(
	p_workspace uuid, p_profile uuid, p_track uuid, p_channel uuid, p_card uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select (p_profile = (select auth.uid()) or app.is_workspace_admin(p_workspace))
	   and app.workspace_role_pour(p_workspace, p_profile) is not null
	   and case
		when p_track is not null then coalesce(
			(select app.resolve_access(
			            app.workspace_role_pour(t.workspace_id, p_profile),
			            (select tm.access from public.track_members tm where tm.track_id = t.id and tm.user_id = p_profile),
			            null) <> 'none'
			   from public.tracks t where t.id = p_track and t.workspace_id = p_workspace),
			false)
		when p_channel is not null then coalesce(
			(select app.can_read_channel_pour(c.id, p_profile)
			   from public.channels c where c.id = p_channel and c.workspace_id = p_workspace),
			false)
		when p_card is not null then coalesce(
			(select app.can_read_card_pour(c.id, p_profile)
			   from public.cards c where c.id = p_card and c.workspace_id = p_workspace),
			false)
		else false
	   end;
$$;

alter function app.saisie_temps_permise(uuid, uuid, uuid, uuid, uuid) owner to postgres;

comment on function app.saisie_temps_permise(uuid, uuid, uuid, uuid, uuid) is
	'CRM-098 — docs/SPEC-temps.md §5.2. L''appelant peut-il écrire cette saisie : la sienne, ou celle d''un membre s''il '
	'est administrateur, sur une cible que LA PERSONNE de la saisie lit.';

revoke all on function app.saisie_temps_permise(uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function app.saisie_temps_permise(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;

-- =============================================================================================
-- 5. RLS et privilèges
-- =============================================================================================

alter table public.couts_personnel enable row level security;
alter table public.saisies_temps   enable row level security;

-- Décision 621, point 3 : chacun lit son propre coût, les administrateurs tous.
drop policy if exists couts_personnel_lecture on public.couts_personnel;
create policy couts_personnel_lecture on public.couts_personnel
	for select
	using (profile_id = (select auth.uid()) or app.is_workspace_admin(workspace_id));
drop policy if exists couts_personnel_insertion_admin on public.couts_personnel;
create policy couts_personnel_insertion_admin on public.couts_personnel
	for insert to authenticated
	with check (app.is_workspace_admin(workspace_id));
drop policy if exists couts_personnel_suppression_admin on public.couts_personnel;
create policy couts_personnel_suppression_admin on public.couts_personnel
	for delete to authenticated
	using (app.is_workspace_admin(workspace_id));

-- §5.1 : le temps d'une personne n'est lu que par elle et par les administrateurs.
drop policy if exists saisies_temps_lecture on public.saisies_temps;
create policy saisies_temps_lecture on public.saisies_temps
	for select
	using (profile_id = (select auth.uid()) or app.is_workspace_admin(workspace_id));
drop policy if exists saisies_temps_insertion on public.saisies_temps;
create policy saisies_temps_insertion on public.saisies_temps
	for insert to authenticated
	with check (app.saisie_temps_permise(workspace_id, profile_id, track_id, channel_id, card_id));
drop policy if exists saisies_temps_maj on public.saisies_temps;
create policy saisies_temps_maj on public.saisies_temps
	for update to authenticated
	using (profile_id = (select auth.uid()) or app.is_workspace_admin(workspace_id))
	with check (app.saisie_temps_permise(workspace_id, profile_id, track_id, channel_id, card_id));
-- Retirer son temps reste possible même si la cible a cessé d'être lisible.
drop policy if exists saisies_temps_suppression on public.saisies_temps;
create policy saisies_temps_suppression on public.saisies_temps
	for delete to authenticated
	using ((profile_id = (select auth.uid()) and app.is_workspace_member(workspace_id))
	       or app.is_workspace_admin(workspace_id));

revoke all on public.couts_personnel from anon, authenticated;
grant select                 on public.couts_personnel to authenticated;
grant insert, delete         on public.couts_personnel to authenticated;
grant all privileges         on public.couts_personnel to service_role;

revoke all on public.saisies_temps from anon, authenticated;
grant select                 on public.saisies_temps to authenticated;
grant insert, delete         on public.saisies_temps to authenticated;
-- Seule `minutes` se met à jour (§3.2) : le privilège le dit avant même le trigger.
grant update (minutes)       on public.saisies_temps to authenticated;
grant all privileges         on public.saisies_temps to service_role;

-- =============================================================================================
-- 6. `public.temps_valorise` — le temps et son coût sur une période (§6.2)
-- =============================================================================================
-- `security invoker` : l'appelant ne reçoit que les saisies qu'il lit, et un montant n'est calculé que sur une version
-- qu'il lit — un montant qu'il ne pourrait pas lire est `null`, comme celui d'une saisie sans version (§4). Le chemin
-- d'une saisie sur une affaire remonte à son channel et à son track ; une affaire que l'appelant ne lit plus le laisse
-- sans chemin, jamais avec un chemin deviné.
-- Une ligne par personne × cible × devise : les devises ne s'additionnent pas, et une saisie non valorisée (devise
-- `null`) reste séparée de celles qui le sont.

create or replace function public.temps_valorise(
	p_debut   date,
	p_fin     date,
	p_profile uuid default null,
	p_track   uuid default null,
	p_card    uuid default null)
returns table (
	profile_id uuid,
	track_id   uuid,
	channel_id uuid,
	card_id    uuid,
	minutes    bigint,
	montant    numeric,
	devise     text)
language sql
stable
security invoker
set search_path = ''
as $$
	with saisies as (
		select s.workspace_id, s.profile_id, s.jour, s.minutes, s.card_id,
		       coalesce(s.channel_id, ca.channel_id)         as channel_id,
		       coalesce(s.track_id, ch.track_id)             as track_id
		  from public.saisies_temps s
		  left join public.cards ca    on ca.id = s.card_id
		  left join public.channels ch on ch.id = coalesce(s.channel_id, ca.channel_id)
		 where s.jour between p_debut and p_fin
		   and (p_profile is null or s.profile_id = p_profile)
		   and (p_card is null or s.card_id = p_card)
	)
	select sa.profile_id, sa.track_id, sa.channel_id, sa.card_id,
	       sum(sa.minutes)::bigint,
	       sum(round(sa.minutes * v.cout_quart / 105, 2)),
	       v.devise
	  from saisies sa
	  left join lateral (
		select cp.cout_quart, cp.devise
		  from public.couts_personnel cp
		 where cp.workspace_id = sa.workspace_id
		   and cp.profile_id = sa.profile_id
		   and cp.date_effet <= sa.jour
		 order by cp.date_effet desc
		 limit 1) v on true
	 where p_track is null or sa.track_id = p_track
	 group by sa.profile_id, sa.track_id, sa.channel_id, sa.card_id, v.devise
	 order by sa.profile_id, sa.track_id, sa.channel_id nulls first, sa.card_id nulls first, v.devise;
$$;

comment on function public.temps_valorise(date, date, uuid, uuid, uuid) is
	'CRM-098 — docs/SPEC-temps.md §6.2. Temps (minutes) et coût valorisé par la version en vigueur le jour travaillé, '
	'par personne × cible × devise, sous la RLS de l''appelant ; montant null sans version lisible.';

revoke all on function public.temps_valorise(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.temps_valorise(date, date, uuid, uuid, uuid) to authenticated, service_role;
