-- @spec CRM-077 (docs/BACKLOG.md) — onzième tranche (INC-316) : réaffecter les dépenses qui bloquent l'effacement d'un track
-- @spec docs/SPEC-corbeille.md §9.1 (une dépense bloquante, définie par ce que la purge détruit), §9.2 (la réaffectation,
--       ses refus dans l'ordre, aucune exception au point (d) — décision 743), §9.4 ; docs/SPEC-costs.md §2.3 ;
--       docs/SCHEMA.md « Migration `0123` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 741 à 743
--
-- DEUX FONCTIONS, ET AUCUNE RÈGLE DES COÛTS N'EST TOUCHÉE. Le déclencheur `app.card_costs_verifier_rattachement` reste
-- entier : on ne quitte ni ne rejoint un budget ou une occurrence clôturés (décision 743). La réaffectation se contente de
-- n'offrir ce geste que là où il débloque un effacement, et de le réserver à l'administrateur de l'espace.

-- =============================================================================================
-- 1. La garde commune : un track en corbeille de l'espace de l'appelant, qu'il administre
-- =============================================================================================

create or replace function app.trash_track_guard(p_track uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	espace uuid;
begin
	select t.workspace_id into espace from public.tracks t where t.id = p_track;
	if espace is null or not app.is_workspace_member(espace) then
		raise exception 'track_not_found' using errcode = 'P0002';
	end if;
	if not app.is_workspace_admin(espace) then
		raise exception 'reserved_to_admins' using errcode = '42501';
	end if;
	return espace;
end;
$$;

alter function app.trash_track_guard(uuid) owner to postgres;
revoke all on function app.trash_track_guard(uuid) from public, anon, authenticated, service_role;

-- =============================================================================================
-- 2. Les dépenses bloquantes d'un track en corbeille — §9.1
-- =============================================================================================
-- Une ligne de coût dont le budget appartient au track, et dont l'affaire n'est PAS détruite avec lui : son channel
-- (`cards.channel_id`, celui que la purge suit) n'est pas un channel du track. Un track vivant n'a rien de bloquant.

create or replace function public.trash_blocking_costs(p_track uuid)
returns table (
	cost_id            uuid,
	label              text,
	estimated_cost     numeric,
	actual_cost        numeric,
	settled            boolean,
	card_id            uuid,
	card_title         text,
	budget_id          uuid,
	budget_name        text,
	budget_closed      boolean,
	currency           text,
	occurrence_id      uuid,
	occurrence_label   text,
	occurrence_closed  boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
	   and not exists (select 1 from public.channels c where c.id = k.channel_id and c.track_id = t.id)
	 order by k.title, l.label, l.id;
end;
$$;

alter function public.trash_blocking_costs(uuid) owner to postgres;
revoke all on function public.trash_blocking_costs(uuid) from public, anon, authenticated, service_role;
grant execute on function public.trash_blocking_costs(uuid) to authenticated;

comment on function public.trash_blocking_costs(uuid) is
	'CRM-077 — docs/SPEC-corbeille.md §9.1. Les dépenses d''autres affaires imputées aux budgets d''un track en corbeille, '
	'qui bloquent son effacement. Réservée à l''administrateur de l''espace.';

-- =============================================================================================
-- 3. Réaffecter une dépense bloquante — §9.2
-- =============================================================================================

create or replace function public.reassign_trashed_track_cost(p_cost uuid, p_budget uuid, p_occurrence uuid default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	espace        uuid;
	piste         uuid;
	piste_morte   boolean;
	canal         uuid;
	devise        text;
	cible_piste   uuid;
	cible_espace  uuid;
	cible_morte   boolean;
	cible_devise  text;
begin
	-- 1. La ligne existe, dans l'espace de l'appelant.
	select k.workspace_id, b.track_id, t.deleted_at is not null, k.channel_id, b.currency
	  into espace, piste, piste_morte, canal, devise
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
	if not piste_morte or exists (select 1 from public.channels c where c.id = canal and c.track_id = piste) then
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
$$;

alter function public.reassign_trashed_track_cost(uuid, uuid, uuid) owner to postgres;
revoke all on function public.reassign_trashed_track_cost(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.reassign_trashed_track_cost(uuid, uuid, uuid) to authenticated;

comment on function public.reassign_trashed_track_cost(uuid, uuid, uuid) is
	'CRM-077 — docs/SPEC-corbeille.md §9.2. Réaffecte à un autre budget ouvert, de la même devise, une dépense qui bloque '
	'l''effacement d''un track en corbeille. Réservée à l''administrateur de l''espace ; les règles des coûts restent '
	'entières.';

notify pgrst, 'reload schema';
