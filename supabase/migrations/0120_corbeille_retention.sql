-- @spec CRM-077 (docs/BACKLOG.md) — dixième tranche : la rétention, l'effacement définitif et la corbeille personnelle
-- @spec docs/SPEC-corbeille.md §8.1 (la date de corbeille posée par le serveur, figée), §8.2 (la rétention en un seul
--       endroit), §8.3 (la purge nocturne : énumérer, journaliser, détruire ; les saisies de temps reportées — Q1, option
--       B), §8.4 (une ligne en corbeille réservée à l'administrateur et à l'auteur du retrait) ; docs/SPEC-audit.md §4.6 ;
--       docs/SCHEMA.md « Migration `0120` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 707, 734 et 735
--
-- LA CORBEILLE NE SUPPRIMAIT JAMAIS PHYSIQUEMENT (§2.3). Elle le fait désormais, une fois, au bout de la rétention, et
-- seulement par `app.purge_trash()` : énumérer d'abord, journaliser ensuite, détruire enfin. Ordinaire, rejouable.

-- =============================================================================================
-- 1. La rétention — §8.2
-- =============================================================================================

create or replace function app.trash_retention()
returns interval
language sql
immutable
set search_path = ''
as $$
	select interval '30 days'
$$;

comment on function app.trash_retention() is
	'CRM-077 — docs/SPEC-corbeille.md §8.2. La durée de rétention de la corbeille : l''unique endroit où elle est écrite.';

create or replace function public.trash_retention_days()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
	select extract(day from app.trash_retention())::integer
$$;

alter function app.trash_retention() owner to postgres;
alter function public.trash_retention_days() owner to postgres;
revoke all on function app.trash_retention() from public, anon, authenticated, service_role;
grant execute on function app.trash_retention() to authenticated, service_role;
revoke all on function public.trash_retention_days() from public, anon, authenticated, service_role;
grant execute on function public.trash_retention_days() to authenticated, service_role;

-- =============================================================================================
-- 2. La date de corbeille est celle du serveur, et elle est figée — §8.1
-- =============================================================================================
-- Révise `0037` : la fonction pose désormais AUSSI `deleted_at`. La porte étroite de l'action référentielle (INC-076)
-- et le gel de l'auteur sont repris sans changement.

create or replace function app.corbeille_avant_ecriture()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
	v_appelant uuid := (select auth.uid());
begin
	-- PORTE ÉTROITE POUR L'ACTION RÉFÉRENTIELLE (INC-076), inchangée depuis `0037`.
	if pg_catalog.pg_trigger_depth() > 1
	   and tg_op = 'UPDATE'
	   and old.deleted_by is not null
	   and new.deleted_by is null
	   and new.deleted_at is not distinct from old.deleted_at then
		return new;
	end if;

	if new.deleted_at is null then
		-- RESTAURATION, ou ligne vivante : l'audit part avec l'état qu'il documentait (`0037`).
		new.deleted_by := null;
		return new;
	end if;

	if tg_op = 'INSERT' or old.deleted_at is null then
		-- MISE EN CORBEILLE : l'auteur est celui du geste courant, et la DATE est celle du serveur (§8.1) — la
		-- rétention en dépend, et un geste antidaté ferait effacer l'objet à la nuit suivante.
		new.deleted_by := v_appelant;
		new.deleted_at := pg_catalog.now();
	else
		-- DÉJÀ EN CORBEILLE : l'auteur ET la date sont figés.
		new.deleted_by := old.deleted_by;
		new.deleted_at := old.deleted_at;
	end if;

	return new;
end;
$$;

-- =============================================================================================
-- 3. Une saisie de temps peut changer de cible — pour la purge seulement (Q1, option B)
-- =============================================================================================
-- Révise `saisies_temps_auteur` (`CRM-098`) : « seules les minutes d'une saisie changent » reste la règle de tous les
-- appelants. Une seule exception : la purge, qui pose `app.trash_purge = on` dans sa transaction, peut REPORTER une
-- saisie sur la cible parente — la cible change, et rien d'autre.

create or replace function app.saisies_temps_auteur()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
	if tg_op = 'INSERT' then
		new.created_by := coalesce((select auth.uid()), new.created_by);
		new.updated_by := new.created_by;
	else
		if coalesce(pg_catalog.current_setting('app.trash_purge', true), '') = 'on'
		   and (new.workspace_id, new.profile_id, new.jour, new.minutes, new.created_by, new.created_at)
		       is not distinct from
		       (old.workspace_id, old.profile_id, old.jour, old.minutes, old.created_by, old.created_at) then
			return new;
		end if;
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

-- Reporter les saisies d'une cible sur sa cible parente. Une saisie de la même personne, le même jour, existe peut-être
-- déjà sur le parent (l'unicité porte sur personne, jour et cible) : les minutes s'y AJOUTENT alors, après le retrait de
-- la saisie reportée — le total du jour ne change pas, et le plafond de 420 reste tenu. Rend le nombre de saisies
-- reportées.
create or replace function app.trash_move_time_entries(
	p_cards uuid[], p_channels uuid[], p_to_channel uuid, p_to_track uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	s        public.saisies_temps;
	cible    uuid;
	nombre   integer := 0;
begin
	for s in
		select * from public.saisies_temps t
		 where t.card_id = any (coalesce(p_cards, '{}')) or t.channel_id = any (coalesce(p_channels, '{}'))
		 for update
	loop
		if p_to_channel is not null then
			select t.id into cible from public.saisies_temps t
			 where t.profile_id = s.profile_id and t.jour = s.jour and t.channel_id = p_to_channel and t.id <> s.id;
		else
			select t.id into cible from public.saisies_temps t
			 where t.profile_id = s.profile_id and t.jour = s.jour and t.track_id = p_to_track and t.id <> s.id;
		end if;
		if cible is not null then
			delete from public.saisies_temps t where t.id = s.id;
			update public.saisies_temps t set minutes = t.minutes + s.minutes where t.id = cible;
		else
			update public.saisies_temps t
			   set card_id = null,
			       channel_id = p_to_channel,
			       track_id = case when p_to_channel is null then p_to_track else null end
			 where t.id = s.id;
		end if;
		nombre := nombre + 1;
		cible := null;
	end loop;
	return nombre;
end;
$$;

-- =============================================================================================
-- 4. L'effacement définitif — §8.3
-- =============================================================================================

-- Ce que la destruction d'un ensemble d'affaires emporte, compté par table (§2.3 : énumérer avant d'agir).
create or replace function app.trash_enumerate_cards(p_cards uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select pg_catalog.jsonb_build_object(
		'cards', pg_catalog.cardinality(p_cards),
		'comments', (select pg_catalog.count(*) from public.card_comments x where x.card_id = any (p_cards)),
		'activities', (select pg_catalog.count(*) from public.card_activities x where x.card_id = any (p_cards)),
		'field_values', (select pg_catalog.count(*) from public.card_field_values x where x.card_id = any (p_cards)),
		'cost_lines', (select pg_catalog.count(*) from public.card_costs x where x.card_id = any (p_cards)),
		'revenue_lines', (select pg_catalog.count(*) from public.card_revenues x where x.card_id = any (p_cards)),
		'messages_unlinked', (select pg_catalog.count(*) from public.mail_messages x where x.card_id = any (p_cards))
	)
$$;

create or replace function app.purge_trash()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	avant   timestamptz := pg_catalog.now() - app.trash_retention();
	total   integer := 0;
	o       record;
	cartes  uuid[];
	canaux  uuid[];
	compte  jsonb;
	report  integer;
	perdues integer;
begin
	perform pg_catalog.set_config('app.trash_purge', 'on', true);

	-- 1. Les TRACKS d'abord : leurs channels et leurs affaires partent avec eux, et ne sont plus là ensuite.
	for o in select t.id, t.workspace_id, t.name, t.deleted_at, t.deleted_by from public.tracks t
	          where t.deleted_at < avant order by t.deleted_at
	loop
		select coalesce(pg_catalog.array_agg(c.id), '{}') into canaux from public.channels c where c.track_id = o.id;
		select coalesce(pg_catalog.array_agg(k.id), '{}') into cartes from public.cards k where k.channel_id = any (canaux);
		select pg_catalog.count(*)::integer into perdues from public.saisies_temps s
		 where s.track_id = o.id or s.channel_id = any (canaux) or s.card_id = any (cartes);
		compte := app.trash_enumerate_cards(cartes)
		       || pg_catalog.jsonb_build_object('channels', pg_catalog.cardinality(canaux),
		                                        'budgets', (select pg_catalog.count(*) from public.budgets b
		                                                     where b.track_id = o.id),
		                                        'time_entries_moved', 0, 'time_entries_deleted', perdues);
		-- CHAQUE OBJET EST ATOMIQUE. Un objet que la base refuse de détruire — un budget du track qui porte la dépense
		-- d'une affaire d'un AUTRE track, `card_costs_budget_id_fkey` étant en `restrict` (INC-312) — reste dans la
		-- corbeille, rien de lui n'est journalisé ni effacé, et la purge continue avec les suivants.
		begin
			perform app.audit_record(o.workspace_id, 'purged', 'track', o.id, o.name,
				pg_catalog.jsonb_build_object('deleted_at', o.deleted_at, 'deleted_by', o.deleted_by, 'enumerated', compte));
			-- Les affaires d'abord : leurs lignes de coût partent avec elles, avant que la cascade n'atteigne les budgets
			-- du track, que `restrict` refuserait de détruire sous une ligne encore présente.
			delete from public.cards k where k.id = any (cartes);
			delete from public.tracks t where t.id = o.id;
			total := total + 1;
		exception when foreign_key_violation or restrict_violation then
			raise warning 'purge de la corbeille : le track % reste en corbeille (%)', o.id, sqlerrm;
		end;
	end loop;

	-- 2. Les CHANNELS : leurs saisies, et celles de leurs affaires, sont reportées sur le track (Q1, option B).
	for o in select c.id, c.workspace_id, c.name, c.track_id, c.deleted_at, c.deleted_by from public.channels c
	          where c.deleted_at < avant order by c.deleted_at
	loop
		select coalesce(pg_catalog.array_agg(k.id), '{}') into cartes from public.cards k where k.channel_id = o.id;
		begin
			-- Le report est dans le bloc : un channel que la base refuse de détruire garde ses saisies.
			report := app.trash_move_time_entries(cartes, array[o.id], null, o.track_id);
			compte := app.trash_enumerate_cards(cartes)
			       || pg_catalog.jsonb_build_object('channels', 1, 'time_entries_moved', report, 'time_entries_deleted', 0);
			perform app.audit_record(o.workspace_id, 'purged', 'channel', o.id, o.name,
				pg_catalog.jsonb_build_object('deleted_at', o.deleted_at, 'deleted_by', o.deleted_by, 'enumerated', compte));
			delete from public.channels c where c.id = o.id;
			total := total + 1;
		exception when foreign_key_violation or restrict_violation then
			raise warning 'purge de la corbeille : le channel % reste en corbeille (%)', o.id, sqlerrm;
		end;
	end loop;

	-- 3. Les AFFAIRES : leurs saisies sont reportées sur leur channel (Q1, option B).
	for o in select k.id, k.workspace_id, k.title, k.channel_id, k.deleted_at, k.deleted_by from public.cards k
	          where k.deleted_at < avant order by k.deleted_at
	loop
		begin
			report := app.trash_move_time_entries(array[o.id], null, o.channel_id, null);
			compte := app.trash_enumerate_cards(array[o.id])
			       || pg_catalog.jsonb_build_object('time_entries_moved', report, 'time_entries_deleted', 0);
			perform app.audit_record(o.workspace_id, 'purged', 'card', o.id, o.title,
				pg_catalog.jsonb_build_object('deleted_at', o.deleted_at, 'deleted_by', o.deleted_by, 'enumerated', compte));
			delete from public.cards k where k.id = o.id;
			total := total + 1;
		exception when foreign_key_violation or restrict_violation then
			raise warning 'purge de la corbeille : l''affaire % reste en corbeille (%)', o.id, sqlerrm;
		end;
	end loop;

	perform pg_catalog.set_config('app.trash_purge', 'off', true);
	return total;
end;
$$;

do $$
declare
	f text;
begin
	foreach f in array array['app.trash_move_time_entries(uuid[], uuid[], uuid, uuid)',
		'app.trash_enumerate_cards(uuid[])', 'app.purge_trash()'] loop
		execute pg_catalog.format('alter function %s owner to postgres', f);
		execute pg_catalog.format('revoke all on function %s from public, anon, authenticated, service_role', f);
	end loop;
end;
$$;

comment on function app.purge_trash() is
	'CRM-077 — docs/SPEC-corbeille.md §8.3. Efface définitivement ce qui est en corbeille depuis plus que la rétention : '
	'énumère, journalise (purged), reporte les saisies de temps, détruit. Appelée chaque jour par pg_cron '
	'(p2enjoy-purge-corbeille).';

-- Minute 29 de 3 h : nulle autre tâche ne la prend — 7, 17, 23, 41, 53 (`verify-armement-sequences.sh`).
do $$
declare
	job_id bigint;
begin
	select cron.schedule('p2enjoy-purge-corbeille', '29 3 * * *', 'select app.purge_trash();') into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;

-- =============================================================================================
-- 5. La corbeille personnelle d'un membre — §8.4
-- =============================================================================================
-- Une ligne VIVANTE garde exactement sa règle. Une ligne EN CORBEILLE n'est lisible que par un administrateur de
-- l'espace, ou par celui qui l'y a mise.

drop policy if exists cards_lecture on public.cards;
create policy cards_lecture on public.cards
	for select to anon, authenticated
	using (app.can_read_channel(channel_id)
	       and (deleted_at is null or app.is_workspace_admin(workspace_id) or deleted_by = (select auth.uid())));

drop policy if exists channels_lecture_membre on public.channels;
create policy channels_lecture_membre on public.channels
	for select to anon, authenticated
	using (app.resolve_channel_access(workspace_id, track_id, id) <> 'none'
	       and (deleted_at is null or app.is_workspace_admin(workspace_id) or deleted_by = (select auth.uid())));

drop policy if exists tracks_lecture_membre on public.tracks;
create policy tracks_lecture_membre on public.tracks
	for select to anon, authenticated
	using ((app.resolve_track_access(workspace_id, id) <> 'none' or app.track_has_readable_channel(id))
	       and (deleted_at is null or app.is_workspace_admin(workspace_id) or deleted_by = (select auth.uid())));

notify pgrst, 'reload schema';
