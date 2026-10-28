-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.4.5 : le retrait en base — les colonnes de rattachement quittent `cards`
--       (décisions 705, 738, 746, 768, 770). docs/SPEC-rattachements.md §3.1 (l'invariant), §3.2 (ce qui quitte
--       l'affaire), §4 (les politiques de `cards` sous la forme optimisée), §5 (`creer_affaire`), §10 (migration) ;
--       docs/SPEC-analytique.md §13.5 (les scores de santé, par rattachement) ; docs/SPEC-corbeille.md §9.1 (la dépense
--       bloquante, définie par ce que la purge détruit)
-- @spec docs/SCHEMA.md « Migration `0134` », §5 (cards, card_placements) ; docs/PROD_MIGRATIONS.md §3
--
-- LA BASCULE S'ACHÈVE. Depuis T2.1, `card_placements` porte une copie des treize colonnes de rattachement de `cards`,
-- tenue par deux miroirs ; depuis T2.4.1 à T2.4.4, plus aucun appelant ne les lit sur `cards`. Cette migration retire les
-- miroirs, réécrit ce qui les lisait encore, puis retire les colonnes. Chaque affaire garde son unique rattachement :
-- aucun changement visible.
--
-- CE QUI EST RÉÉCRIT, la définition de chaque fonction reprise de la base au 2026-10-27 et seules les lignes concernées
-- changées : `creer_affaire` (le premier rattachement par `app.poser_premier_rattachement`, décision 768) ; la purge et
-- les deux fonctions de la dépense bloquante de `CRM-077` (un prédicat partagé) ; la vérification de restauration ; les
-- scores de santé, qui passent sur le rattachement ; le rang, désormais attribué au rattachement ; l'événement `created`,
-- qui naît avec le premier rattachement (décision 770).
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : possible tant que chaque affaire n'a qu'un rattachement — rajouter les
-- colonnes, les recopier depuis le rattachement, puis rejouer les définitions d'avant. Une sauvegarde est exigée avant
-- application en production.

-- =============================================================================================
-- 1. Les miroirs
-- =============================================================================================

drop trigger card_placements_mirror_insert on public.cards;
drop trigger card_placements_mirror_update on public.cards;
drop trigger card_placements_mirror_to_card on public.card_placements;
drop function app.card_placements_mirror_insert();
drop function app.card_placements_mirror_update();
drop function app.card_placements_mirror_to_card();

-- =============================================================================================
-- 2. Le rang, attribué au rattachement (règle d'`app.cards_attribuer_position`, transportée)
-- =============================================================================================

create function app.card_placements_attribuer_position()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(p.position), 0) + 1
			  from public.card_placements p
			 where p.channel_id      = new.channel_id
			   and p.current_step_id = new.current_step_id
		);
	end if;
	return new;
end;
$fn$;
revoke all on function app.card_placements_attribuer_position() from public, anon, authenticated;

create trigger card_placements_attribuer_position
	before insert on public.card_placements
	for each row execute function app.card_placements_attribuer_position();

drop trigger cards_attribuer_position on public.cards;
drop function app.cards_attribuer_position();

-- =============================================================================================
-- 3. L'événement `created`, né avec le premier rattachement (décision 770)
-- =============================================================================================

create function app.card_placements_evenement_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
	if not exists (select 1 from public.card_placements p where p.card_id = new.card_id and p.id <> new.id) then
		perform app.card_event_ecrire(new.card_id, new.workspace_id, 'created',
			jsonb_build_object(
				'title',      (select c.title from public.cards c where c.id = new.card_id),
				'channel_id', new.channel_id,
				'step_id',    new.current_step_id));
	end if;
	return null;
end;
$fn$;
revoke all on function app.card_placements_evenement_creation() from public, anon, authenticated;

create trigger card_placements_evenement_creation
	after insert on public.card_placements
	for each row execute function app.card_placements_evenement_creation();

drop trigger card_events_apres_insertion on public.cards;
drop function app.card_events_apres_insertion_card();

-- =============================================================================================
-- 4. L'invariant : toute affaire a au moins un rattachement (§3.1 ; la clé de service exemptée, décision 770)
-- =============================================================================================

create function app.cards_verifier_rattachement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
	-- Lu par `to_jsonb` : PL/pgSQL résout `old.card_id` sur le type de la table déclenchante, même dans la branche
	-- non prise, et `cards` n'a pas de `card_id`.
	v_card uuid := case when tg_table_name = 'cards' then (pg_catalog.to_jsonb(new)->>'id')::uuid
	                    else (pg_catalog.to_jsonb(old)->>'card_id')::uuid end;
begin
	-- Le rôle de la SESSION, et non `current_user`, qui vaut le propriétaire dans une fonction `security definer` :
	-- PostgREST pose `service_role` ou `authenticated` ; une session d'administration (migrations, seed SQL) n'en pose
	-- aucun (`none`).
	if pg_catalog.current_setting('role', true) in ('service_role', 'none') then
		return null;
	end if;
	if exists (select 1 from public.cards c where c.id = v_card)
	   and not exists (select 1 from public.card_placements p where p.card_id = v_card) then
		raise exception 'card_without_placement'
			using errcode = '23514',
			      detail  = 'une affaire a au moins un rattachement';
	end if;
	return null;
end;
$fn$;
revoke all on function app.cards_verifier_rattachement() from public, anon, authenticated;

create constraint trigger cards_au_moins_un_rattachement
	after insert on public.cards
	deferrable initially deferred
	for each row
	-- La clause écarte d'emblée les sessions exemptées : rien n'est mis en attente pour elles (décision 770).
	when (pg_catalog.current_setting('role', true) not in ('service_role', 'none'))
	execute function app.cards_verifier_rattachement();
create constraint trigger card_placements_au_moins_un_rattachement
	after delete on public.card_placements
	deferrable initially deferred
	for each row
	-- La clause écarte d'emblée les sessions exemptées : rien n'est mis en attente pour elles (décision 770).
	when (pg_catalog.current_setting('role', true) not in ('service_role', 'none'))
	execute function app.cards_verifier_rattachement();

-- =============================================================================================
-- 5. Le premier rattachement, posé par la création (décision 768)
-- =============================================================================================

create function app.poser_premier_rattachement(p_card uuid, p_channel uuid, p_step uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
	v_channel  record;
	v_id       uuid;
begin
	if not app.can_write_channel(p_channel) then
		raise exception 'permission denied for table card_placements'
			using errcode = '42501';
	end if;
	select c.id, c.workspace_id, c.workflow_id into v_channel from public.channels c where c.id = p_channel;
	if exists (select 1 from public.card_placements p where p.card_id = p_card) then
		raise exception 'card_already_placed' using errcode = 'P0001';
	end if;
	if not exists (select 1 from public.workflow_steps s
	                where s.id = p_step and s.workflow_id = v_channel.workflow_id and s.is_initial) then
		raise exception 'step_not_initial' using errcode = '22023';
	end if;
	insert into public.card_placements (workspace_id, card_id, channel_id, workflow_id, current_step_id, created_by)
	values (v_channel.workspace_id, p_card, p_channel, v_channel.workflow_id, p_step,
	        (select pr.id from public.profiles pr where pr.id = auth.uid()))
	returning id into v_id;
	return v_id;
end;
$fn$;
revoke all on function app.poser_premier_rattachement(uuid, uuid, uuid) from public, anon;
grant execute on function app.poser_premier_rattachement(uuid, uuid, uuid) to authenticated;

-- =============================================================================================
-- 6. Le prédicat partagé de la purge et de la dépense bloquante (`CRM-077`, décision 768)
-- =============================================================================================

-- Une affaire est détruite avec un ensemble de channels lorsque TOUS ses rattachements y sont. Pendant la bascule, une
-- affaire n'a qu'un rattachement, et la règle rend exactement celle d'avant ; le cas d'une affaire rattachée aussi
-- ailleurs est posé au responsable avant T3, et ne changera que ce prédicat.
create function app.cartes_detruites_avec_channels(p_channels uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $fn$
	select coalesce(pg_catalog.array_agg(distinct p.card_id), '{}')
	  from public.card_placements p
	 where p.channel_id = any (p_channels)
	   and not exists (select 1 from public.card_placements q
	                    where q.card_id = p.card_id and not (q.channel_id = any (p_channels)));
$fn$;
revoke all on function app.cartes_detruites_avec_channels(uuid[]) from public, anon, authenticated;

create function app.affaire_detruite_avec_track(p_card uuid, p_track uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
	select p_card = any (app.cartes_detruites_avec_channels(
		(select coalesce(pg_catalog.array_agg(c.id), '{}') from public.channels c where c.track_id = p_track)));
$fn$;
revoke all on function app.affaire_detruite_avec_track(uuid, uuid) from public, anon, authenticated;

-- =============================================================================================
-- 7. Les fonctions réécrites, reprises de la base (seules les lignes concernées changent)
-- =============================================================================================

-- ### purge
CREATE OR REPLACE FUNCTION app.purge_trash()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
		cartes := app.cartes_detruites_avec_channels(canaux);
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
		cartes := app.cartes_detruites_avec_channels(array[o.id]);
		begin
			-- Le report est dans le bloc : un channel que la base refuse de détruire garde ses saisies.
			report := app.trash_move_time_entries(cartes, array[o.id], null, o.track_id);
			compte := app.trash_enumerate_cards(cartes)
			       || pg_catalog.jsonb_build_object('channels', 1, 'time_entries_moved', report, 'time_entries_deleted', 0);
			perform app.audit_record(o.workspace_id, 'purged', 'channel', o.id, o.name,
				pg_catalog.jsonb_build_object('deleted_at', o.deleted_at, 'deleted_by', o.deleted_by, 'enumerated', compte));
			-- `CRM-111` T2.4.5 : les affaires ne partent plus par la clé `cards → channels`, retirée ; celles que le
			-- channel emporte sont détruites ici, avant lui (décision 768).
			delete from public.cards k where k.id = any (cartes);
			delete from public.channels c where c.id = o.id;
			total := total + 1;
		exception when foreign_key_violation or restrict_violation then
			raise warning 'purge de la corbeille : le channel % reste en corbeille (%)', o.id, sqlerrm;
		end;
	end loop;

	-- 3. Les AFFAIRES : leurs saisies sont reportées sur leur channel (Q1, option B).
	for o in select k.id, k.workspace_id, k.title, (select p.channel_id from public.card_placements p where p.id = app.card_first_placement(k.id)) as channel_id, k.deleted_at,
	                k.deleted_by from public.cards k
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
$function$;

-- ### bloquantes
CREATE OR REPLACE FUNCTION public.trash_blocking_costs(p_track uuid)
 RETURNS TABLE(cost_id uuid, label text, estimated_cost numeric, actual_cost numeric, settled boolean, card_id uuid, card_title text, budget_id uuid, budget_name text, budget_closed boolean, currency text, occurrence_id uuid, occurrence_label text, occurrence_closed boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	perform app.trash_track_guard(p_track);
	return query
	select l.id, l.label, l.estimated_cost, l.actual_cost, l.settled_at is not null,
	       k.id, k.title,
	       b.id, b.name, b.closed_at is not null, b.currency,
	       o.id, o.label, o.closed_at is not null
	  from public.card_costs l
	  join public.budgets b on b.id = l.budget_id
	  join public.tracks t on t.id = b.track_id
	  join public.cards k on k.id = l.card_id
	  left join public.budget_occurrences o on o.id = l.occurrence_id
	 where t.id = p_track
	   and t.deleted_at is not null
	   and not app.affaire_detruite_avec_track(k.id, t.id)
	 order by k.title, l.label, l.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reassign_trashed_track_cost(p_cost uuid, p_budget uuid, p_occurrence uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	espace        uuid;
	piste         uuid;
	piste_morte   boolean;
	carte         uuid;
	devise        text;
	cible_piste   uuid;
	cible_espace  uuid;
	cible_morte   boolean;
	cible_devise  text;
begin
	-- 1. La ligne existe, dans l'espace de l'appelant.
	select k.workspace_id, b.track_id, t.deleted_at is not null, k.id, b.currency
	  into espace, piste, piste_morte, carte, devise
	  from public.card_costs l
	  join public.cards k on k.id = l.card_id
	  join public.budgets b on b.id = l.budget_id
	  join public.tracks t on t.id = b.track_id
	 where l.id = p_cost;
	if espace is null or not app.is_workspace_member(espace) then
		raise exception 'cost_not_found' using errcode = 'P0002';
	end if;
	-- 2. L'appelant administre l'espace.
	if not app.is_workspace_admin(espace) then
		raise exception 'reserved_to_admins' using errcode = '42501';
	end if;
	-- 3. La ligne bloque l'effacement d'un track en corbeille.
	if not piste_morte or app.affaire_detruite_avec_track(carte, piste) then
		raise exception 'cost_not_blocking' using errcode = 'P0001';
	end if;
	-- 4. Le budget cible existe dans l'espace, hors du track en corbeille et de tout track en corbeille.
	select b.track_id, t.workspace_id, t.deleted_at is not null, b.currency
	  into cible_piste, cible_espace, cible_morte, cible_devise
	  from public.budgets b
	  join public.tracks t on t.id = b.track_id
	 where b.id = p_budget;
	if cible_espace is distinct from espace then
		raise exception 'budget_not_found' using errcode = 'P0002';
	end if;
	if cible_piste = piste then
		raise exception 'same_track' using errcode = '22023';
	end if;
	if cible_morte then
		raise exception 'target_in_trash' using errcode = '22023';
	end if;
	-- 4 bis. La même devise : une ligne de coût prend celle de son budget, et ne se convertit pas.
	if cible_devise is distinct from devise then
		raise exception 'currency_mismatch' using errcode = '22023';
	end if;
	-- 5. Les règles d'une ligne de coût, entières (`app.card_costs_verifier_rattachement`) : budget et occurrence ouverts,
	--    occurrence exigée si et seulement si le budget est récurrent, appartenant au budget ; et le point (d), qui
	--    refuse de quitter un budget ou une occurrence clôturés (décision 743).
	update public.card_costs l set budget_id = p_budget, occurrence_id = p_occurrence where l.id = p_cost;
end;
$function$;

-- ### sante
CREATE OR REPLACE FUNCTION app.health_context(p_card public.card_placements)
 RETURNS TABLE(seuil_jours integer, jours_dans_etape integer, jours_sans_contact integer, probabilite numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	select coalesce(ws.stale_after_days, n.default_stale_after_days),
	       floor(extract(epoch from (now() - p_card.entered_step_at)) / 86400.0)::integer,
	       -- UNE AFFAIRE JAMAIS CONTACTÉE COMPTE DEPUIS SA CRÉATION (§13.2) : créée hier, elle n'est pas « sans contact
	       -- depuis 30 jours ».
	       floor(extract(epoch from (now() - coalesce(app.health_last_contact(p_card.card_id), a.created_at)))
	             / 86400.0)::integer,
	       coalesce(p_card.probability_override, ws.probability_override, n.default_probability)
	  from public.workflow_steps ws
	  join public.cards a on a.id = p_card.card_id
	  join public.workflow_nodes_catalog n on n.id = ws.node_id
	 where ws.id = p_card.current_step_id
	   and n.kind = 'open'
	   and p_card.archived_at is null
	   and a.deleted_at is null;
$function$;

CREATE OR REPLACE FUNCTION public.health_momentum(public.card_placements)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	v_carte     public.card_placements := $1;
	v_ctx       record;
	v_penalites jsonb := '[]'::jsonb;
	v_points    integer := 0;
	v_retard    integer;
	v_score     integer;
begin
	select * into v_ctx from app.health_context(v_carte);
	if not found then
		return null;
	end if;

	if v_ctx.seuil_jours is not null and v_ctx.jours_dans_etape >= v_ctx.seuil_jours then
		v_penalites := v_penalites || jsonb_build_object('code', 'stale_step', 'points', 30,
			'days', v_ctx.jours_dans_etape, 'threshold', v_ctx.seuil_jours);
		v_points := v_points + 30;
	end if;

	-- UNE ACTION EN RETARD EXISTE : les deux pénalités de la prochaine action s'excluent (§13.2).
	if v_carte.next_action_at is not null and v_carte.next_action_at < now() then
		v_retard := floor(extract(epoch from (now() - v_carte.next_action_at)) / 86400.0)::integer;
		v_penalites := v_penalites || jsonb_build_object('code', 'next_action_overdue', 'points', 25, 'days', v_retard);
		v_points := v_points + 25;
	elsif nullif(btrim(coalesce(v_carte.next_action, '')), '') is null and v_carte.next_action_at is null then
		v_penalites := v_penalites || jsonb_build_object('code', 'next_action_missing', 'points', 15);
		v_points := v_points + 15;
	end if;

	if v_ctx.jours_sans_contact > 30 then
		v_penalites := v_penalites || jsonb_build_object('code', 'no_contact_30', 'points', 30,
			'days', v_ctx.jours_sans_contact);
		v_points := v_points + 30;
	elsif v_ctx.jours_sans_contact > 14 then
		v_penalites := v_penalites || jsonb_build_object('code', 'no_contact_14', 'points', 20,
			'days', v_ctx.jours_sans_contact);
		v_points := v_points + 20;
	end if;

	v_score := greatest(0, least(100, 100 - v_points));
	return jsonb_build_object('score', v_score, 'tier', app.health_tier(v_score), 'penalties', v_penalites);
end;
$function$;

CREATE OR REPLACE FUNCTION public.health_commercial(public.card_placements)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	v_carte     public.card_placements := $1;
	v_ctx       record;
	v_fraicheur integer;
	v_ponctuel  integer;
	v_age       integer;
	v_proba     integer;
	v_signaux   jsonb;
	v_somme     numeric := 0;
	v_poids     numeric := 0;
	v_score     integer;
	v_signal    jsonb;
begin
	select * into v_ctx from app.health_context(v_carte);
	if not found then
		return null;
	end if;

	v_proba := round(v_ctx.probabilite)::integer;

	-- 100 jusqu'à 7 jours sans contact, puis linéaire jusqu'à 0 à 30 jours.
	v_fraicheur := case
		when v_ctx.jours_sans_contact <= 7 then 100
		when v_ctx.jours_sans_contact >= 30 then 0
		else round(100.0 * (30 - v_ctx.jours_sans_contact) / 23.0)::integer
	end;

	-- 100 une échéance future, 60 une action sans échéance, 30 aucune action, 0 une échéance passée.
	v_ponctuel := case
		when v_carte.next_action_at is not null and v_carte.next_action_at < now() then 0
		when v_carte.next_action_at is not null then 100
		when nullif(btrim(coalesce(v_carte.next_action, '')), '') is not null then 60
		else 30
	end;

	-- 100 jusqu'à la moitié du seuil, puis linéaire jusqu'à 0 à une fois et demie le seuil ; sans seuil, inconnu.
	v_age := case
		when v_ctx.seuil_jours is null or v_ctx.seuil_jours <= 0 then null
		when v_ctx.jours_dans_etape <= 0.5 * v_ctx.seuil_jours then 100
		when v_ctx.jours_dans_etape >= 1.5 * v_ctx.seuil_jours then 0
		else round(100.0 * (1.5 * v_ctx.seuil_jours - v_ctx.jours_dans_etape) / v_ctx.seuil_jours)::integer
	end;

	v_signaux := jsonb_build_array(
		jsonb_build_object('code', 'probability', 'weight', 40, 'value', v_proba),
		jsonb_build_object('code', 'contact_freshness', 'weight', 25, 'value', v_fraicheur,
			'days', v_ctx.jours_sans_contact),
		jsonb_build_object('code', 'next_action_timeliness', 'weight', 20, 'value', v_ponctuel),
		jsonb_build_object('code', 'step_age', 'weight', 15, 'value', v_age,
			'days', v_ctx.jours_dans_etape, 'threshold', v_ctx.seuil_jours)
	);

	-- UN SIGNAL INCONNU NE COMPTE PAS POUR ZÉRO (§13.3) : il est marqué `unknown`, et son poids est réparti sur les
	-- signaux connus — la moyenne se fait sur les seuls poids connus.
	for v_signal in select * from jsonb_array_elements(v_signaux) loop
		if v_signal -> 'value' <> 'null'::jsonb then
			v_somme := v_somme + (v_signal ->> 'weight')::numeric * (v_signal ->> 'value')::numeric;
			v_poids := v_poids + (v_signal ->> 'weight')::numeric;
		end if;
	end loop;
	select coalesce(jsonb_agg(case when s -> 'value' = 'null'::jsonb then s || '{"status": "unknown"}' else s end), '[]')
	  into v_signaux
	  from jsonb_array_elements(v_signaux) s;

	v_score := round(v_somme / v_poids)::integer;
	return jsonb_build_object('score', v_score, 'tier', app.health_tier(v_score), 'signals', v_signaux);
end;
$function$;

-- ### restauration
CREATE OR REPLACE FUNCTION app.cards_restauration_verifier_parent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
	if old.deleted_at is null or new.deleted_at is not null then
		return new;
	end if;

	if exists (
		select 1
		  from public.card_placements p
		  join public.channels c on c.id = p.channel_id
		  left join public.tracks t on t.id = c.track_id
		 where p.card_id = new.id
		   and (c.deleted_at is not null or t.deleted_at is not null)
	) then
		raise exception 'parent_en_corbeille'
			using errcode = 'P0001',
			      detail  = 'Le channel de cette affaire, ou son track, est en corbeille : restaurez-le d''abord.';
	end if;

	return new;
end;
$function$;

-- ### creer_affaire
CREATE OR REPLACE FUNCTION public.creer_affaire(p_channel uuid, p_titre text, p_template uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	appelant   uuid := auth.uid();
	le_channel record;
	l_etape    uuid;
	l_affaire  uuid;
	le_modele  public.card_templates%rowtype;
	le_rattachement uuid;
	v_cle      text;
	v_valeur   jsonb;
	v_rang     integer := 0;
	v_point    jsonb;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if appelant is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. Le channel, lu sous la RLS de l'appelant : illisible et inexistant se confondent.
	select c.id, c.workspace_id, c.workflow_id, c.archived_at, c.deleted_at
	  into le_channel
	  from public.channels c
	 where c.id = p_channel;
	if not found then
		raise exception 'channel introuvable'
			using errcode = 'P0002';
	end if;

	-- 3. Un channel archivé ou à la corbeille ne reçoit plus d'affaire.
	if le_channel.archived_at is not null or le_channel.deleted_at is not null then
		raise exception 'channel ferme'
			using errcode = 'P0001',
			      detail  = 'le channel est archive ou a la corbeille';
	end if;

	-- 3 bis. `CRM-068` T4a — le modèle, lu sous la RLS : un modèle illisible, archivé ou inexistant se confondent ; un
	--        modèle d'un autre workflow que celui du channel est refusé (§3.6).
	if p_template is not null then
		select t.* into le_modele
		  from public.card_templates t
		 where t.id = p_template and t.archived_at is null;
		if not found then
			raise exception 'template_not_found'
				using errcode = 'P0002';
		end if;
		if le_modele.workflow_id <> le_channel.workflow_id then
			raise exception 'template_workflow_mismatch'
				using errcode = '22023';
		end if;
	end if;

	-- 4. L'étape d'entrée est l'étape INITIALE du workflow du channel.
	select s.id into l_etape
	  from public.workflow_steps s
	 where s.workflow_id = le_channel.workflow_id
	   and s.is_initial
	 order by s.position
	 limit 1;
	if l_etape is null then
		raise exception 'aucune etape initiale'
			using errcode = 'P0001',
			      detail  = 'designer l''etape initiale du workflow dans l''editeur';
	end if;

	-- 5. L'affaire, puis son premier rattachement (`CRM-111` T2.4.5, décision 768). Un titre blanc est refusé par la
	--    contrainte existante (`23514`) ; un channel que l'appelant ne peut pas écrire, par
	--    `app.poser_premier_rattachement` (`42501`), le refus que donnait `cards_insertion`.
	--    L'identifiant est tiré AVANT l'insertion : un `returning` relirait l'affaire sous la politique de lecture, qui ne
	--    la rend qu'une fois son rattachement posé.
	l_affaire := gen_random_uuid();
	insert into public.cards (id, workspace_id, title, created_by)
	values (l_affaire, le_channel.workspace_id, btrim(p_titre), appelant);
	le_rattachement := app.poser_premier_rattachement(l_affaire, le_channel.id, l_etape);

	-- 6. `CRM-068` T4a — LE MODÈLE EST APPLIQUÉ DANS LA MÊME TRANSACTION, PAR LES MÊMES ÉCRITURES QU'À L'ÉCRAN, sous la RLS
	--    de l'appelant : description et devise sur l'affaire, montant sur son rattachement, valeurs de champ sur le
	--    rattachement (le déclencheur de `card_field_values` les valide encore), points libres sur l'affaire. Une question
	--    archivée depuis l'écriture du modèle est ignorée : elle ne serait demandée nulle part.
	if p_template is not null then
		update public.cards
		   set description = coalesce(le_modele.description, description),
		       currency    = le_modele.currency
		 where id = l_affaire;

		if le_modele.amount is not null then
			update public.card_placements set amount = le_modele.amount where id = le_rattachement;
		end if;

		for v_cle, v_valeur in select key, value from jsonb_each(le_modele.field_values) loop
			insert into public.card_field_values (card_id, placement_id, field_id, workflow_id, workspace_id, value)
			select l_affaire, le_rattachement, f.id, f.workflow_id, f.workspace_id, v_valeur
			  from public.form_fields f
			 where f.workflow_id = le_channel.workflow_id and f.key = v_cle and f.archived_at is null;
		end loop;

		for v_point in select value from jsonb_array_elements(le_modele.checklist) loop
			v_rang := v_rang + 1;
			insert into public.card_checklist_items (workspace_id, card_id, label, position)
			values (le_channel.workspace_id, l_affaire, v_point #>> '{}', v_rang);
		end loop;
	end if;

	return l_affaire;
end;
$function$;

-- ### la clé composite channel/workflow n'est plus que celle du rattachement : `set constraints` ne la nomme plus sur `cards`
CREATE OR REPLACE FUNCTION public.change_channel_workflow(channel_id uuid, workflow_id uuid, step_mapping jsonb, discard_field_values boolean DEFAULT false)
 RETURNS SETOF card_placements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	-- Les arguments portent des noms de colonnes : ils sont copiés avant toute requête afin que
	-- chaque référence SQL reste non ambiguë.
	v_channel_id uuid    := channel_id;
	v_workflow_id uuid   := workflow_id;
	v_mapping jsonb      := step_mapping;
	v_discard boolean    := coalesce(discard_field_values, false);
	v_channel public.channels%rowtype;
	v_target public.workflows%rowtype;
	v_sources_occupees uuid[];
	v_sources_mapping uuid[];
	v_reponses bigint;
begin
	-- 3.1 Le channel est visible. Un objet caché ou d'un autre workspace ne devient pas un oracle.
	select ch.* into v_channel
	  from public.channels ch
	 where ch.id = v_channel_id
	   and app.can_read_channel(ch.id)
	 for update;

	if not found then
		raise exception 'channel_not_found';
	end if;

	-- 3.2 Changer le contenant est une administration du workspace, pas un droit fin `write`.
	if not app.is_workspace_admin(v_channel.workspace_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- 3.3 Le workflow cible est actif, du même workspace et verrouillé jusqu'au commit.
	select w.* into v_target
	  from public.workflows w
	 where w.id = v_workflow_id
	   and w.workspace_id = v_channel.workspace_id
	   and w.archived_at is null
	 for share;

	if not found then
		raise exception 'workflow_not_found';
	end if;

	if v_target.scope = 'track' and v_target.track_id is distinct from v_channel.track_id then
		raise exception 'workflow_not_compatible' using errcode = '23514';
	end if;

	if v_target.id = v_channel.workflow_id then
		raise exception 'same_workflow';
	end if;

	-- Les étapes des deux graphes ne peuvent pas être déplacées pendant la validation.
	perform s.id
	  from public.workflow_steps s
	 where s.workflow_id in (v_channel.workflow_id, v_target.id)
	 order by s.id
	 for share;

	-- Les cards, puis leurs réponses, sont verrouillées AVANT de calculer l'ensemble occupé. La
	-- clé étrangère vers le channel fait également attendre toute insertion concurrente.
	perform c.id
	  from public.card_placements c
	 where c.channel_id = v_channel.id
	 order by c.id
	 for update;

	perform fv.placement_id, fv.field_id
	  from public.card_field_values fv
	  join public.card_placements c on c.id = fv.placement_id
	 where c.channel_id = v_channel.id
	 order by fv.placement_id, fv.field_id
	 for update of fv;

	-- 3.4 Forme exacte : tableau d'objets, deux clés seulement, valeurs chaîne UUID.
	if v_mapping is null or pg_catalog.jsonb_typeof(v_mapping) <> 'array' then
		raise exception 'invalid_step_mapping';
	end if;

	if exists (
		select 1
		  from pg_catalog.jsonb_array_elements(v_mapping) as item(value)
		 where pg_catalog.jsonb_typeof(item.value) <> 'object'
		    or not (item.value ? 'from_step_id' and item.value ? 'to_step_id')
		    or (select count(*) from pg_catalog.jsonb_object_keys(item.value)) <> 2
		    or pg_catalog.jsonb_typeof(item.value -> 'from_step_id') <> 'string'
		    or pg_catalog.jsonb_typeof(item.value -> 'to_step_id') <> 'string'
		    or not pg_catalog.pg_input_is_valid(
		        item.value ->> 'from_step_id', 'uuid')
		    or not pg_catalog.pg_input_is_valid(
		        item.value ->> 'to_step_id', 'uuid')
	) then
		raise exception 'invalid_step_mapping';
	end if;

	-- 3.5 Un doublon de SOURCE est refusé. Plusieurs sources vers la même cible restent licites.
	if exists (
		select 1
		  from pg_catalog.jsonb_array_elements(v_mapping) as item(value)
		 group by (item.value ->> 'from_step_id')::uuid
		having count(*) > 1
	) then
		raise exception 'step_mapping_duplicate';
	end if;

	select coalesce(array_agg(distinct c.current_step_id order by c.current_step_id),
	                array[]::uuid[])
	  into v_sources_occupees
	  from public.card_placements c
	 where c.channel_id = v_channel.id;

	select coalesce(array_agg((item.value ->> 'from_step_id')::uuid
	                          order by (item.value ->> 'from_step_id')::uuid),
	                array[]::uuid[])
	  into v_sources_mapping
	  from pg_catalog.jsonb_array_elements(v_mapping) as item(value);

	-- Égalité stricte : une source absente ET une source supplémentaire sont le même mapping non
	-- exhaustif. Pour un channel vide, seule la liste vide passe.
	if v_sources_mapping is distinct from v_sources_occupees then
		raise exception 'step_mapping_incomplete';
	end if;

	-- 3.6 Chaque cible appartient au nouveau workflow. Aucun nœud ou rang n'est deviné.
	if exists (
		select 1
		  from pg_catalog.jsonb_array_elements(v_mapping) as item(value)
		  left join public.workflow_steps s
		    on s.id = (item.value ->> 'to_step_id')::uuid
		   and s.workflow_id = v_target.id
		 where s.id is null
	) then
		raise exception 'step_not_in_workflow';
	end if;

	-- 3.7 Les réponses de formulaire appartiennent à l'ancien graphe. Elles ne sont jamais
	-- remappées ; leur destruction est un consentement séparé et false par défaut.
	select count(*) into v_reponses
	  from public.card_field_values fv
	  join public.card_placements c on c.id = fv.placement_id
	 where c.channel_id = v_channel.id;

	if v_reponses > 0 and not v_discard then
		raise exception 'field_values_would_be_lost'
			using detail = format('%s réponse(s) de formulaire seraient perdues.', v_reponses);
	end if;

	if v_reponses > 0 then
		delete from public.card_field_values fv
		 using public.card_placements c
		 where c.id = fv.placement_id
		   and c.channel_id = v_channel.id;
	end if;

	-- 3.8 Écriture atomique. L'ancien rang des étapes, puis la position et l'id des cards,
	-- déterminent l'ordre quand plusieurs sources convergent vers une cible.
	-- `CRM-111` T2.3.7 : le rattachement porte le couple (channel, workflow) ; sa clé est différée comme celle de `cards`,
	-- que le miroir de la bascule écrit dans la même transaction.
	set constraints public.card_placements_channel_workflow_fk deferred;

	update public.channels ch
	   set workflow_id = v_target.id
	 where ch.id = v_channel.id;

	with mapping as (
		select (item.value ->> 'from_step_id')::uuid as from_step_id,
		       (item.value ->> 'to_step_id')::uuid   as to_step_id
		  from pg_catalog.jsonb_array_elements(v_mapping) as item(value)
	), ordonnees as (
		select c.id,
		       m.to_step_id,
		       row_number() over (
			   partition by m.to_step_id
			   order by source.position, c.position, c.id
		       )::numeric as nouvelle_position
		  from public.card_placements c
		  join mapping m on m.from_step_id = c.current_step_id
		  join public.workflow_steps source on source.id = c.current_step_id
		 where c.channel_id = v_channel.id
	)
	update public.card_placements c
	   set workflow_id     = v_target.id,
	       current_step_id = o.to_step_id,
	       entered_step_at = now(),
	       position        = o.nouvelle_position
	  from ordonnees o
	 where c.id = o.id;

	-- Le contrôle a réellement lieu avant que l'appelant ne reçoive le succès. La contrainte ne
	-- reste pas différée dans une transaction SQL plus longue que l'appel PostgREST ordinaire.
	set constraints public.card_placements_channel_workflow_fk immediate;

	return query
	select c.*
	  from public.card_placements c
	 where c.channel_id = v_channel.id
	 order by c.current_step_id, c.position, c.id;
end;
$function$;


-- Les scores de santé passent sur le rattachement (décision 768, point 6) : les versions de l'affaire tombent.
drop function public.health_momentum(public.cards);
drop function public.health_commercial(public.cards);
drop function app.health_context(public.cards);
revoke all on function app.health_context(public.card_placements) from public, anon;
grant execute on function app.health_context(public.card_placements) to authenticated, service_role;
revoke all on function public.health_momentum(public.card_placements) from public, anon;
revoke all on function public.health_commercial(public.card_placements) from public, anon;
grant execute on function public.health_momentum(public.card_placements) to authenticated, service_role;
grant execute on function public.health_commercial(public.card_placements) to authenticated, service_role;

-- =============================================================================================
-- 8. Les politiques de `cards` (§4, forme optimisée ; décision 768, point 7)
-- =============================================================================================

drop policy cards_lecture on public.cards;
drop policy cards_maj on public.cards;
drop policy cards_insertion on public.cards;

-- L'affaire se lit si l'un de ses rattachements se lit (archivés compris) ; la corbeille, comme avant.
create policy cards_lecture on public.cards
	for select to authenticated
	using (
		id in (select p.card_id from public.card_placements p
		        where p.channel_id in (select unnest(app.readable_channel_ids())))
		and (deleted_at is null
		     or app.is_workspace_admin(workspace_id)
		     or deleted_by = (select auth.uid()))
	);

-- La partie commune s'écrit si l'un des rattachements s'écrit (§4).
create policy cards_maj on public.cards
	for update to authenticated
	using (app.can_write_card(id))
	with check (app.can_write_card(id));

-- L'insertion ne se juge plus sur un channel, que l'affaire ne porte plus : un membre de l'espace insère, et
-- l'invariant du §3.1 refuse toute affaire sans rattachement ; le rattachement, lui, exige le droit d'écrire son
-- channel (`app.poser_premier_rattachement`).
create policy cards_insertion on public.cards
	for insert to authenticated
	with check (app.is_workspace_member(workspace_id));

-- =============================================================================================
-- 9. Le retrait des colonnes (§3.2) ; leurs index et contraintes tombent avec elles
-- =============================================================================================

alter table public.cards
	drop column channel_id,
	drop column workflow_id,
	drop column current_step_id,
	drop column position,
	drop column owner_id,
	drop column amount,
	drop column probability_override,
	drop column next_action,
	drop column next_action_at,
	drop column entered_step_at,
	drop column health_score,
	drop column snoozed_until,
	drop column archived_at;
