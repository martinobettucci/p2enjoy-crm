-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3.1 : le sommeil d'un rattachement (décision 705). docs/SPEC-rattachements.md
--       §5 (« Sommeil, réveil : `snooze_card(p_placement, until)`, `wake_card(p_placement)` — signatures remplacées »),
--       §14 ; docs/SPEC-cards.md §16.3 (les quatre refus, dans l'ordre), §16.4 (l'idempotence du réveil), §16.8 (contrat
--       d'API) ; docs/JOURNAL.md décisions 661, 705
-- @spec docs/SCHEMA.md « Migration `0111` », §9 (fonctions et RPC) ; docs/PROD_MIGRATIONS.md §3
--
-- LES SIGNATURES SONT REMPLACÉES, NON SURCHARGÉES (décision 661). Les deux fonctions désignent désormais le RATTACHEMENT
-- et le rendent ; les formes par affaire sont SUPPRIMÉES — elles ont les mêmes types d'arguments, et PostgREST choisit
-- une surcharge par le nom de ses arguments : une ancienne forme oubliée continuerait de répondre. Les gardes, leur
-- ordre et leurs messages sont ceux de `CRM-081` : `card_not_found` (le rattachement est invisible, archivé, ou son
-- affaire à la corbeille), `forbidden`, `snooze_date_required`, `snooze_date_in_past`. La trace `snoozed` / `woken` est
-- écrite par la table du rattachement (T2.3.0), et le miroir inverse tient `cards` égale.
--
-- IDEMPOTENCE : `drop function if exists` des deux formes, puis `create`.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : supprimer les deux fonctions, réappliquer celles de la migration 0042 —
-- et avec elles les appelants d'avant, webapp et connecteur.

drop function if exists public.snooze_card(uuid, timestamptz);
drop function if exists public.wake_card(uuid);

create function public.snooze_card(p_placement uuid, until timestamptz)
returns public.card_placements
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_until     timestamptz := until;
	v_placement public.card_placements%rowtype;
begin
	-- 1 Le rattachement existe, est ACTIF, son affaire n'est pas à la corbeille, et son channel est lisible. Un
	--   rattachement invisible est ABSENT, jamais « interdit » (docs/SPEC-permissions-rls.md §4.3).
	select p.* into v_placement
	  from public.card_placements p
	  join public.cards c on c.id = p.card_id
	 where p.id = p_placement
	   and p.archived_at is null
	   and c.deleted_at  is null
	   and app.can_read_channel(p.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	-- 2 L'appelant ÉCRIT le channel du rattachement.
	if not app.can_write_channel(v_placement.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- 3 L'échéance est fournie : un sommeil sans échéance serait un archivage.
	if v_until is null then
		raise exception 'snooze_date_required';
	end if;

	-- 4 L'échéance est future : sinon l'écriture serait acceptée et sans effet observable (CLAUDE.md §18).
	if v_until <= now() then
		raise exception 'snooze_date_in_past';
	end if;

	update public.card_placements p
	   set snoozed_until = v_until
	 where p.id = p_placement
	returning p.* into v_placement;

	return v_placement;
end;
$$;

create function public.wake_card(p_placement uuid)
returns public.card_placements
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_placement public.card_placements%rowtype;
begin
	-- Mêmes gardes n° 1 et n° 2, dans le même ordre, et aucun refus propre (docs/SPEC-cards.md §16.4).
	select p.* into v_placement
	  from public.card_placements p
	  join public.cards c on c.id = p.card_id
	 where p.id = p_placement
	   and p.archived_at is null
	   and c.deleted_at  is null
	   and app.can_read_channel(p.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	if not app.can_write_channel(v_placement.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- IDEMPOTENCE : sur un rattachement qui ne dort pas, rien ne change et aucun événement n'est écrit — le déclencheur
	-- de la timeline ne se lance que si `snoozed_until` change.
	update public.card_placements p
	   set snoozed_until = null
	 where p.id = p_placement
	returning p.* into v_placement;

	return v_placement;
end;
$$;

revoke all on function public.snooze_card(uuid, timestamptz) from public, anon;
revoke all on function public.wake_card(uuid) from public, anon;
grant execute on function public.snooze_card(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.wake_card(uuid) to authenticated, service_role;
