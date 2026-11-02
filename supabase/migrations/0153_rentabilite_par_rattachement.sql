-- @spec CRM-111 (docs/BACKLOG.md) — tranche T5.1 : la rentabilité par rattachement × devise
-- @spec docs/SPEC-rattachements.md §6 (une ligne par rattachement × devise, `shared`, l'état du rattachement, le total
--       compté une fois ; décision 643) ; docs/SPEC-recettes.md §5 ; docs/SCHEMA.md « Migration `0153` » ;
--       docs/PROD_MIGRATIONS.md §3
--
-- `rentabilite_affaires`, réécrite depuis sa dernière autorité (la `0150`), gagne `shared` : elle est SUPPRIMÉE puis
-- RECRÉÉE, ses droits reposés. Aucune fonction n'en dépend (la webapp et le connecteur l'appellent par PostgREST).

drop function if exists public.rentabilite_affaires(date, date, uuid);

CREATE FUNCTION public.rentabilite_affaires(p_debut date DEFAULT NULL::date, p_fin date DEFAULT NULL::date, p_card uuid DEFAULT NULL::uuid)
 RETURNS TABLE(workspace_id uuid, track_id uuid, channel_id uuid, card_id uuid, node_kind text, archivee boolean, currency text, recettes_prevues numeric, recettes_reelles numeric, lignes_recette integer, lignes_recette_sans_reel integer, couts_prevus numeric, couts_reels numeric, lignes_cout integer, lignes_cout_sans_reel integer, personnel numeric, minutes bigint, minutes_non_valorisees bigint, shared boolean)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
	espace_carte uuid;
begin
	if not exists (select 1 from public.workspaces w where app.is_workspace_admin(w.id)) then
		raise exception 'rentabilite_reservee' using errcode = '42501',
			detail = 'La rentabilité soustrait le coût de toute l''équipe : elle est réservée aux administrateurs de l''espace.';
	end if;
	if p_card is not null then
		select c.workspace_id into espace_carte
		  from public.cards c where c.id = p_card and c.deleted_at is null;
		-- Une affaire qu'il ne lit pas rend zéro ligne ; une affaire qu'il lit sans administrer son espace est refusée.
		if espace_carte is not null and not app.is_workspace_admin(espace_carte) then
			raise exception 'rentabilite_reservee' using errcode = '42501',
				detail = 'La rentabilité soustrait le coût de toute l''équipe : elle est réservée aux administrateurs de l''espace.';
		end if;
	end if;

	return query
	-- `CRM-111` T5.1 (docs/SPEC-rattachements.md §6, décision 643) : une ligne par RATTACHEMENT lisible — son chemin, son
	-- état, son archivage —, `shared` vrai quand l'affaire en a plusieurs. Les sommes de l'affaire se calculent une fois,
	-- sur `cartes`, puis se rappellent sur chacune de ses lignes : la jointure par rattachement ne les multiplie jamais.
	with affaires as (
		select c.id, c.workspace_id, ch.track_id, pl.channel_id, n.kind, pl.archived_at is not null as archivee, c.currency,
		       count(*) over (partition by c.id) > 1 as partagee
		  from public.cards c
		  join public.card_placements pl on pl.card_id = c.id
		  join public.channels ch on ch.id = pl.channel_id
		  join public.workflow_steps s on s.id = pl.current_step_id
		  join public.workflow_nodes_catalog n on n.id = s.node_id
		 where c.deleted_at is null
		   and app.is_workspace_admin(c.workspace_id)
		   and (p_card is null or c.id = p_card)
	),
	cartes as (
		select distinct a.id, a.currency from affaires a
	),
	recettes as (
		select r.card_id, a.currency,
		       sum(r.estimated_amount) as prevu,
		       count(*)::integer as lignes,
		       count(*) filter (where r.settled_at is null and r.actual_amount is null)::integer as sans_reel,
		       bool_or(r.settled_at is not null
		               and not exists (select 1 from public.card_revenue_actuals x where x.card_revenue_id = r.id)) as soldee_a_zero,
		       sum((select sum(x.amount) from public.card_revenue_actuals x
		             where x.card_revenue_id = r.id
		               and (p_debut is null or x.received_on >= p_debut)
		               and (p_fin is null or x.received_on <= p_fin))) as reel_periode
		  from public.card_revenues r
		  join cartes a on a.id = r.card_id
		 group by r.card_id, a.currency
	),
	couts as (
		select k.card_id, b.currency,
		       sum(k.estimated_cost) as prevu,
		       count(*)::integer as lignes,
		       count(*) filter (where k.settled_at is null and k.actual_cost is null)::integer as sans_reel,
		       bool_or(k.settled_at is not null
		               and not exists (select 1 from public.card_cost_actuals x where x.card_cost_id = k.id)) as soldee_a_zero,
		       sum((select sum(x.amount) from public.card_cost_actuals x
		             where x.card_cost_id = k.id
		               and (p_debut is null or x.spent_on >= p_debut)
		               and (p_fin is null or x.spent_on <= p_fin))) as reel_periode
		  from public.card_costs k
		  join cartes a on a.id = k.card_id
		  join public.budgets b on b.id = k.budget_id
		 group by k.card_id, b.currency
	),
	-- Le temps NON VALORISÉ (devise nulle) se range sous la devise de l'affaire : il n'a pas de montant, seulement des
	-- minutes, et une ligne de devise nulle laisserait l'écran sans tableau où ranger l'affaire (§5, précision de T2).
	temps as (
		select t.card_id, coalesce(t.devise, a.currency) as currency,
		       sum(t.montant) as montant,
		       sum(t.minutes)::bigint as minutes,
		       coalesce(sum(t.minutes) filter (where t.montant is null), 0)::bigint as non_valorisees
		  -- `CRM-111` T4.1 : une saisie partagée paraît sous chaque rattachement lisible ; l'affaire n'en compte qu'UNE ligne
		  -- par personne et devise (§6 : le temps de l'affaire est compté une fois). La ventilation par rattachement est T5.
		  from (select distinct on (tv.profile_id, tv.card_id, tv.devise) tv.*
		          from public.temps_valorise(coalesce(p_debut, '-infinity'::date), coalesce(p_fin, 'infinity'::date),
		                                     null, null, p_card) tv
		         order by tv.profile_id, tv.card_id, tv.devise, tv.channel_id) t
		  join cartes a on a.id = t.card_id
		 group by t.card_id, coalesce(t.devise, a.currency)
	),
	cles as (
		select x.card_id, x.currency from recettes x
		union select x.card_id, x.currency from couts x
		union select x.card_id, x.currency from temps x
	)
	select a.workspace_id, a.track_id, a.channel_id, a.id, a.kind, a.archivee, k.currency,
	       round(r.prevu, 2),
	       round(case when r.reel_periode is not null or r.soldee_a_zero then coalesce(r.reel_periode, 0) end, 2),
	       coalesce(r.lignes, 0),
	       coalesce(r.sans_reel, 0),
	       round(c.prevu, 2),
	       round(case when c.reel_periode is not null or c.soldee_a_zero then coalesce(c.reel_periode, 0) end, 2),
	       coalesce(c.lignes, 0),
	       coalesce(c.sans_reel, 0),
	       round(t.montant, 2),
	       coalesce(t.minutes, 0)::bigint,
	       coalesce(t.non_valorisees, 0)::bigint,
	       a.partagee
	  from cles k
	  join affaires a on a.id = k.card_id
	  left join recettes r on r.card_id = k.card_id and r.currency is not distinct from k.currency
	  left join couts c    on c.card_id = k.card_id and c.currency is not distinct from k.currency
	  left join temps t    on t.card_id = k.card_id and t.currency is not distinct from k.currency
	 order by a.track_id, a.channel_id, a.id, k.currency nulls last;
end;
$function$;

comment on function public.rentabilite_affaires(date, date, uuid) is
	'CRM-108 et CRM-111 T5.1 — docs/SPEC-recettes.md §5, docs/SPEC-rattachements.md §6. Une ligne par rattachement lisible × '
	'devise des affaires des espaces que l''appelant administre ; recettes, coûts et personnel de l''affaire rappelés sur '
	'chaque ligne, `shared` vrai quand elle a plusieurs rattachements lisibles : un total les compte une fois. Réservée '
	'aux administrateurs de l''espace (42501 rentabilite_reservee).';

revoke all on function public.rentabilite_affaires(date, date, uuid) from public, anon;
grant execute on function public.rentabilite_affaires(date, date, uuid) to authenticated, service_role;
