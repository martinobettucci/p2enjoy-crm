-- @spec CRM-146 (docs/BACKLOG.md) — tranche T1 : le prévisionnel et le réel d'une organisation, par devise, sous les
--       droits de l'appelant
-- @spec docs/SPEC-recettes.md §12.1 (les affaires qui comptent), §12.2 (les grandeurs), §12.3 (le contrat de la
--       fonction) ; docs/SCHEMA.md « Migration `0177` » ; docs/JOURNAL.md décisions 900, 903 et 908 ; CLAUDE.md §10
--
-- UNE FONCTION, AUCUNE TABLE, AUCUNE COLONNE, AUCUNE DONNÉE, AUCUNE POLITIQUE. Ce n'est pas une règle d'accès :
-- `security invoker` somme ce que la RLS rend à l'appelant, et rien d'autre (§12.3).
--
-- RÉ-EXÉCUTABLE : retirée si elle existe, puis posée.
--
-- Retour arrière : `drop function public.organization_revenue_totals(uuid);`. Aucune donnée n'en dépend.

drop function if exists public.organization_revenue_totals(uuid);

-- Une affaire compte pour une organisation par ses contacts rattachés (décision 903) : une fois par organisation, quel
-- que soit le nombre de ses contacts qui en font partie, et pour chacune de leurs organisations. Hors corbeille : la RLS
-- de `cards` laisse lire une affaire à la corbeille à un administrateur et à son auteur, le filtre est donc ici (§12.1).
-- Archivée, et quel que soit son état, elle compte.
--
-- `shared_cards` : l'affaire compte aussi pour une AUTRE organisation, lue sous la même RLS — le contact et le
-- rattachement de l'autre organisation sont lus par l'appelant, ou ne comptent pas.
--
-- Le réel : la somme des `actual_amount` connus ; `sum` ignore les nuls et rend nul s'il n'y en a aucun — « nul n'est
-- pas zéro » (§2.3). Une ligne soldée sans réel vaut `0`, la base le tient déjà dans `actual_amount`.
create function public.organization_revenue_totals(p_organization_id uuid default null)
returns table (
	organization_id uuid,
	currency text,
	estimated_total numeric,
	actual_total numeric,
	cards integer,
	shared_cards integer,
	revenue_lines integer,
	lines_without_actual integer
)
language sql
stable
security invoker
set search_path = ''
as $$
	with liens as (
		select distinct ct.organization_id, c.id as card_id, c.currency
		  from public.contacts ct
		  join public.card_contacts cc on cc.contact_id = ct.id
		  join public.cards c on c.id = cc.card_id
		 where ct.organization_id is not null
		   and c.deleted_at is null
		   and (p_organization_id is null or ct.organization_id = p_organization_id)
	),
	affaires as (
		select l.organization_id, l.card_id, l.currency,
		       exists (
		           select 1
		             from public.card_contacts autre_cc
		             join public.contacts autre on autre.id = autre_cc.contact_id
		            where autre_cc.card_id = l.card_id
		              and autre.organization_id is not null
		              and autre.organization_id <> l.organization_id
		       ) as partagee
		  from liens l
	)
	select a.organization_id,
	       a.currency,
	       round(sum(r.estimated_amount), 2),
	       round(sum(r.actual_amount), 2),
	       count(distinct a.card_id)::integer,
	       count(distinct a.card_id) filter (where a.partagee)::integer,
	       count(r.id)::integer,
	       count(r.id) filter (where r.settled_at is null and r.actual_amount is null)::integer
	  from affaires a
	  join public.card_revenues r on r.card_id = a.card_id
	 group by a.organization_id, a.currency
	 order by a.organization_id, a.currency
$$;

comment on function public.organization_revenue_totals(uuid) is
	'CRM-146 : le prévu et le réel des recettes d''une organisation, par devise, sous les droits de l''appelant '
	'(docs/SPEC-recettes.md §12.3).';

revoke all on function public.organization_revenue_totals(uuid) from public, anon;
grant execute on function public.organization_revenue_totals(uuid) to authenticated, service_role;
