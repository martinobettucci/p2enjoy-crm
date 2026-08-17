-- @spec CRM-019 (docs/BACKLOG.md) — changement atomique du workflow d'un channel entier
-- @spec docs/SPEC-change-channel-workflow.md §1 à §9
-- @spec docs/SCHEMA.md §5 (dix types de timeline), §9 (RPC)
-- @spec docs/SPEC-cards.md §2.4 (clés composites), §14.4 et §14.6 (événement)
-- @spec docs/JOURNAL.md décisions 263, 295 et 306
-- @spec docs/INCONSISTENCY_REPORT.md INC-046 et INC-073
--
-- Cette migration ne modifie aucune donnée métier à son application. Elle rend différable, mais
-- TOUJOURS initialement immédiate, la clé qui lie les cards au workflow de leur channel ; seule la
-- RPC la diffère, puis la force avant son retour. Le mapping est un tableau JSON afin qu'un doublon
-- de source reste visible et puisse être refusé.

-- =============================================================================================
-- 0. Convergence de la clé composite
-- =============================================================================================

create or replace function app.migration_0020_converger_contrainte(
	nom_table text, nom_contrainte text, definition_attendue text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	definition_reelle text;
begin
	select pg_get_constraintdef(c.oid) into definition_reelle
	  from pg_constraint c
	 where c.conrelid = nom_table::regclass
	   and c.conname = nom_contrainte;

	if definition_reelle is null then
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	elsif definition_reelle <> definition_attendue then
		execute format('alter table %s drop constraint %I', nom_table, nom_contrainte);
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	end if;
end;
$$;

select app.migration_0020_converger_contrainte(
	'public.cards', 'cards_channel_id_workflow_id_fkey',
	'FOREIGN KEY (channel_id, workflow_id) REFERENCES public.channels(id, workflow_id) '
	'DEFERRABLE');

comment on constraint cards_channel_id_workflow_id_fkey on public.cards is
	'CRM-019 — docs/SPEC-change-channel-workflow.md §4. Différable pour que '
	'`change_channel_workflow` remplace channel + cards dans UNE transaction, mais INITIALLY '
	'IMMEDIATE : toute écriture ordinaire incohérente reste refusée à la fin de son instruction.';

-- =============================================================================================
-- 1. Le vocabulaire passe de neuf à DIX valeurs
-- =============================================================================================

-- LE VOCABULAIRE NE SE RÉTRÉCIT JAMAIS À LA RÉAPPLICATION, ET C'EST UN CORRECTIF MESURÉ.
-- Le `migrations-runner` rejoue TOUT le répertoire à chaque démarrage (`CRM-001`). Écrite sans
-- garde, cette convergence remettait la liste dans son état d'origine — et faisait échouer le
-- rejeu en `23514` dès qu'une unité ultérieure produisait un type qu'elle ne connaît pas :
-- `mail_received`, livré par `CRM-055`, a réellement bloqué le runner. Un démarrage de pile
-- s'arrêtait alors avant PostgREST.
--
-- La convergence ne s'applique donc que si le type que CETTE migration introduit est absent.
-- Elle garde ainsi son rôle — poser son propre ajout sur une base qui ne l'a pas — sans jamais
-- défaire celui d'une migration postérieure.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname = 'card_events_type_check'
		   and pg_get_constraintdef(oid) like '%workflow_changed%'
	) and not exists (
		-- INC-144 — deuxième garde, symétrique de celle de la migration 17. La première ne regarde
		-- que la contrainte et ne voit rien lorsqu'elle est absente ; les lignes, elles, peuvent
		-- déjà employer `mail_received`, `mail_sent`, `snoozed` ou `woken`. On ne converge que si
		-- elles sont compatibles avec les dix valeurs que CETTE migration pose.
		select 1 from public.card_events
		 where type <> all (array['created', 'moved', 'assigned', 'channel_changed',
		                          'workflow_changed', 'archived', 'unarchived', 'trashed',
		                          'restored', 'field_changed'])
	) then
		perform app.migration_0020_converger_contrainte(
			'public.card_events', 'card_events_type_check',
			'CHECK ((type = ANY (ARRAY[''created''::text, ''moved''::text, ''assigned''::text, '
			'''channel_changed''::text, ''workflow_changed''::text, ''archived''::text, '
			'''unarchived''::text, ''trashed''::text, ''restored''::text, ''field_changed''::text])))');
	end if;
end;
$$;

comment on column public.card_events.type is
	'CRM-019 — docs/SPEC-cards.md §14.4. DIX valeurs livrées : `workflow_changed` s''ajoute aux '
	'neuf précédentes. `mail_received` et `mail_sent` restent refusés tant que leurs unités ne les '
	'produisent pas.';

-- =============================================================================================
-- 2. Le trigger de timeline rend les trois gestes de contexte exclusifs
-- =============================================================================================

create or replace function app.card_events_apres_maj_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- Un changement de channel prévaut, même s'il change aussi le workflow et l'étape : c'est le
	-- geste unitaire de CRM-045, et son payload porte déjà tout le contexte.
	if new.channel_id is distinct from old.channel_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'channel_changed',
			jsonb_build_object('from_channel_id',  old.channel_id,
			                   'to_channel_id',    new.channel_id,
			                   'from_workflow_id', old.workflow_id,
			                   'to_workflow_id',   new.workflow_id,
			                   'from_step_id',     old.current_step_id,
			                   'to_step_id',       new.current_step_id));

	-- À channel constant, un changement de workflow est un remappage entre deux graphes : il ne
	-- franchit aucune arête et ne doit donc jamais écrire `moved`.
	elsif new.workflow_id is distinct from old.workflow_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'workflow_changed',
			jsonb_build_object('channel_id',       new.channel_id,
			                   'from_workflow_id', old.workflow_id,
			                   'to_workflow_id',   new.workflow_id,
			                   'from_step_id',     old.current_step_id,
			                   'to_step_id',       new.current_step_id));

	elsif new.current_step_id is distinct from old.current_step_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'moved',
			jsonb_build_object('from_step_id', old.current_step_id,
			                   'to_step_id',   new.current_step_id));
	end if;

	if new.owner_id is distinct from old.owner_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'assigned',
			jsonb_build_object('from_owner_id', old.owner_id,
			                   'to_owner_id',   new.owner_id));
	end if;

	if new.archived_at is distinct from old.archived_at then
		perform app.card_event_ecrire(new.id, new.workspace_id,
			case when new.archived_at is null then 'unarchived' else 'archived' end,
			'{}'::jsonb);
	end if;

	if new.deleted_at is distinct from old.deleted_at then
		perform app.card_event_ecrire(new.id, new.workspace_id,
			case when new.deleted_at is null then 'restored' else 'trashed' end,
			'{}'::jsonb);
	end if;

	return null;
end;
$$;

alter function app.card_events_apres_maj_card() owner to postgres;

comment on function app.card_events_apres_maj_card() is
	'CRM-019 — docs/SPEC-cards.md §14.4 et docs/SPEC-change-channel-workflow.md §6. SIX colonnes '
	'surveillées : current_step_id, channel_id, workflow_id, owner_id, archived_at, deleted_at. '
	'Les gestes de contexte sont exclusifs dans cet ordre : channel_changed, workflow_changed, '
	'moved. Le trigger reste sur la table et couvre donc aussi un UPDATE propriétaire.';

do $$
declare
	definition_reelle text;
begin
	select pg_get_triggerdef(t.oid) into definition_reelle
	  from pg_trigger t
	 where t.tgrelid = 'public.cards'::regclass
	   and t.tgname = 'card_events_apres_maj'
	   and not t.tgisinternal;

	if definition_reelle is distinct from
	   'CREATE TRIGGER card_events_apres_maj AFTER UPDATE ON public.cards FOR EACH ROW '
	   'EXECUTE FUNCTION app.card_events_apres_maj_card()' then
		if definition_reelle is not null then
			drop trigger card_events_apres_maj on public.cards;
		end if;
		create trigger card_events_apres_maj
			after update on public.cards
			for each row execute function app.card_events_apres_maj_card();
	end if;
end;
$$;

-- =============================================================================================
-- 3. `public.change_channel_workflow`
-- =============================================================================================

create or replace function public.change_channel_workflow(
	channel_id           uuid,
	workflow_id          uuid,
	step_mapping         jsonb,
	discard_field_values boolean default false
) returns setof public.cards
language plpgsql
security definer
set search_path = ''
as $$
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
	  from public.cards c
	 where c.channel_id = v_channel.id
	 order by c.id
	 for update;

	perform fv.card_id, fv.field_id
	  from public.card_field_values fv
	  join public.cards c on c.id = fv.card_id
	 where c.channel_id = v_channel.id
	 order by fv.card_id, fv.field_id
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
	  from public.cards c
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
	  join public.cards c on c.id = fv.card_id
	 where c.channel_id = v_channel.id;

	if v_reponses > 0 and not v_discard then
		raise exception 'field_values_would_be_lost'
			using detail = format('%s réponse(s) de formulaire seraient perdues.', v_reponses);
	end if;

	if v_reponses > 0 then
		delete from public.card_field_values fv
		 using public.cards c
		 where c.id = fv.card_id
		   and c.channel_id = v_channel.id;
	end if;

	-- 3.8 Écriture atomique. L'ancien rang des étapes, puis la position et l'id des cards,
	-- déterminent l'ordre quand plusieurs sources convergent vers une cible.
	set constraints public.cards_channel_id_workflow_id_fkey deferred;

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
		  from public.cards c
		  join mapping m on m.from_step_id = c.current_step_id
		  join public.workflow_steps source on source.id = c.current_step_id
		 where c.channel_id = v_channel.id
	)
	update public.cards c
	   set workflow_id     = v_target.id,
	       current_step_id = o.to_step_id,
	       entered_step_at = now(),
	       position        = o.nouvelle_position
	  from ordonnees o
	 where c.id = o.id;

	-- Le contrôle a réellement lieu avant que l'appelant ne reçoive le succès. La contrainte ne
	-- reste pas différée dans une transaction SQL plus longue que l'appel PostgREST ordinaire.
	set constraints public.cards_channel_id_workflow_id_fkey immediate;

	return query
	select c.*
	  from public.cards c
	 where c.channel_id = v_channel.id
	 order by c.current_step_id, c.position, c.id;
end;
$$;

alter function public.change_channel_workflow(uuid, uuid, jsonb, boolean) owner to postgres;

comment on function public.change_channel_workflow(uuid, uuid, jsonb, boolean) is
	'CRM-019 — docs/SPEC-change-channel-workflow.md. Change le workflow d''un channel et remappe '
	'TOUTES ses cards dans une transaction. Le tableau JSON couvre exactement chaque étape source '
	'occupée ; les doublons de source et les cibles étrangères refusent tout le lot. Plusieurs '
	'sources peuvent converger. Réponses détruites seulement avec discard_field_values=true. '
	'Écrit workflow_changed par le trigger de cards et rend SETOF public.cards.';

revoke all on function public.change_channel_workflow(uuid, uuid, jsonb, boolean)
	from public, anon;
grant execute on function public.change_channel_workflow(uuid, uuid, jsonb, boolean)
	to authenticated, service_role;

-- =============================================================================================
-- 4. Retrait de l'échafaudage
-- =============================================================================================

drop function if exists app.migration_0020_converger_contrainte(text, text, text);

notify pgrst, 'reload schema';
