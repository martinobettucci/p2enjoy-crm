-- @spec CRM-112 (docs/BACKLOG.md) — tranche T3.d : une valeur commune changée écrit `field_changed` au fil de l'affaire,
--       `scope: "common"`, sans rattachement
-- @spec docs/SPEC-champs-communs.md §7 (« Timeline », précision T3.d) ; docs/SPEC-rattachements.md §5 (un événement de la
--       partie commune n'a pas de rattachement) ; docs/DESIGN_SYSTEM.md §5.89 ; docs/SCHEMA.md « Migration `0163` »
--
-- La contrainte `card_events_placement_by_type` est redéfinie avec une seule exception (ci-dessous).
-- `app.card_events_fill_placement` EST REPRISE À L'IDENTIQUE DE SA DÉFINITION EN BASE (`pg_get_functiondef`), avec un seul
-- ajout : un `field_changed` de la partie commune garde son rattachement nul. La fonction du déclencheur est neuve ; elle
-- suit la règle de `app.card_events_apres_ecriture_valeur` (champs de workflow) : rien quand la valeur ne change pas.

-- LA CONTRAINTE QUI LIE LE TYPE AU RATTACHEMENT (0109, 0125, 0148) reçoit l'exception dans le même changement : un
-- `field_changed` de la partie commune est un événement de l'AFFAIRE, sans rattachement ; tout autre `field_changed` en
-- garde un. *Trouvé par la preuve pgTAP `0152`* : sans cette révision, la première valeur commune était refusée.
-- `is not distinct from` et non `=` — *trouvé par la même preuve* : un `field_changed` de workflow n'a pas de `scope`,
-- `null = 'common'` rend NUL, et le `not (… and nul)` rendait nul à son tour — le remplissage sautait et le `CHECK`, nul,
-- passait : l'événement perdait son rattachement sans qu'aucune garde ne le dise.
alter table public.card_events drop constraint if exists card_events_placement_by_type;
alter table public.card_events add constraint card_events_placement_by_type
	check ((type in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived', 'snoozed',
	                 'woken', 'stalled', 'field_changed', 'attached', 'detached')
	        and not (type = 'field_changed' and payload ->> 'scope' is not distinct from 'common')) = (placement_id is not null));

CREATE OR REPLACE FUNCTION app.card_events_fill_placement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	if new.placement_id is null
	   and new.type in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	                    'snoozed', 'woken', 'stalled', 'field_changed')
	   -- `CRM-112` T3.d : une valeur COMMUNE appartient à l'affaire, pas à l'un de ses rattachements.
	   and not (new.type = 'field_changed' and new.payload ->> 'scope' is not distinct from 'common') then
		new.placement_id := app.card_first_placement(new.card_id);
		if new.placement_id is null then
			raise exception 'card_placement_missing'
				using errcode = 'P0001',
				      detail  = format('L''affaire %s n''a pas de rattachement.', new.card_id);
		end if;
	end if;
	return new;
end;
$function$;

create or replace function app.card_events_apres_ecriture_valeur_commune()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_payload jsonb;
begin
	if tg_op = 'UPDATE' then
		if new.value is not distinct from old.value then
			return null;
		end if;
		v_payload := jsonb_build_object('field_id', new.field_id, 'scope', 'common', 'from', old.value, 'to', new.value);
	else
		v_payload := jsonb_build_object('field_id', new.field_id, 'scope', 'common', 'to', new.value);
	end if;

	perform app.card_event_ecrire(new.card_id, new.workspace_id, 'field_changed', v_payload);
	return null;
end;
$$;
alter function app.card_events_apres_ecriture_valeur_commune() owner to postgres;
revoke all on function app.card_events_apres_ecriture_valeur_commune() from public;

comment on function app.card_events_apres_ecriture_valeur_commune() is
	'CRM-112 T3.d — docs/SPEC-champs-communs.md §7 : une valeur commune insérée ou changée écrit field_changed, '
	'scope common, sans rattachement ; rien quand la valeur ne change pas.';

drop trigger if exists card_events_apres_ecriture_valeur_commune on public.card_common_field_values;
create trigger card_events_apres_ecriture_valeur_commune
	after insert or update of value on public.card_common_field_values
	for each row execute function app.card_events_apres_ecriture_valeur_commune();
