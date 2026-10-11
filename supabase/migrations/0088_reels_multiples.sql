-- @spec CRM-099 (docs/BACKLOG.md) — tranche T1 : plusieurs coûts réels par ligne de coût, jusqu'à ce qu'on la solde
-- @spec docs/SPEC-costs.md §2.3 bis (`card_cost_actuals`, `settled_at` / `settled_by`, `actual_cost` dérivé, ligne soldée
--       figée, budget clos qui accepte encore des réels, reprise des réels existants), §2.3 (la frontière de la clôture),
--       §3 (lecture et écriture : celles de la ligne) ; docs/SCHEMA.md §9 quater « Migration `0088` » ;
--       docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décision 622
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- 1. `public.card_cost_actuals` : les réels d'une ligne de coût — montant, date de la dépense, libellé facultatif.
-- 2. `card_costs.settled_at`, `settled_by` : la ligne soldée, d'une case à cocher.
-- 3. `card_costs.actual_cost` DEVIENT DÉRIVÉ : somme des réels s'il y en a, `0` si la ligne est soldée sans réel, nul
--    sinon. La base le tient ; une écriture du client qui le contredit est refusée. Tous les écrans qui le lisent gardent
--    leur lecture, et « nul n'est pas zéro » tient sans changement.
-- 4. Une ligne soldée est FIGÉE : aucun réel ne s'y ajoute, ne s'y modifie ni ne s'en retire.
-- 5. La reprise : chaque ligne dont le réel est connu reçoit un premier réel de ce montant et RESTE OUVERTE (décision
--    622, point 3) — elle revient dans l'onglet « À saisir » jusqu'à ce qu'on la solde.
-- 6. L'index de l'onglet « À saisir » suit sa nouvelle population : les lignes non soldées.
--
-- CE QUI NE CHANGE PAS : la clôture d'un budget ne ferme pas ses lignes. Sur une ligne d'un budget ou d'une occurrence
-- clos, on ajoute encore des réels et on solde — « on clôt une campagne PUIS les factures arrivent » (§2.3). La politique
-- de mise à jour de `card_costs` ne demande déjà pas le budget ouvert ; celles des réels non plus.
--
-- IDEMPOTENTE ET CONVERGENTE, bien que le registre (`CRM-096`) ne la rejoue pas.

-- =============================================================================================
-- 1. La ligne soldée
-- =============================================================================================

alter table public.card_costs add column if not exists settled_at timestamptz;
alter table public.card_costs add column if not exists settled_by uuid references public.profiles (id) on delete set null;

comment on column public.card_costs.settled_at is
	'CRM-099 — docs/SPEC-costs.md §2.3 bis. Nul tant que la ligne est ouverte ; posé quand on coche « Soldé ». Une ligne '
	'soldée est figée : aucun réel ne s''y ajoute, ne s''y modifie ni ne s''en retire.';

-- =============================================================================================
-- 2. `public.card_cost_actuals`
-- =============================================================================================

create table if not exists public.card_cost_actuals (
	id           uuid          primary key default gen_random_uuid(),
	card_cost_id uuid          not null references public.card_costs (id) on delete cascade,
	amount       numeric(14,2) not null,
	spent_on     date          not null default current_date,
	label        text,
	created_by   uuid          references public.profiles (id) on delete set null,
	created_at   timestamptz   not null default now(),
	updated_at   timestamptz   not null default now()
);

-- Aucune contrainte de signe sur `amount` : un avoir est un réel négatif légitime, et `0` est admis (§2.1, §2.3 bis).
alter table public.card_cost_actuals drop constraint if exists card_cost_actuals_label_check;
alter table public.card_cost_actuals add  constraint card_cost_actuals_label_check
	check (label is null or btrim(label) <> '');

create index if not exists card_cost_actuals_ligne_idx
	on public.card_cost_actuals (card_cost_id, spent_on, created_at);

comment on table public.card_cost_actuals is
	'CRM-099 — docs/SPEC-costs.md §2.3 bis. Les réels d''une ligne de coût ; leur somme est `card_costs.actual_cost`.';

drop trigger if exists card_cost_actuals_set_updated_at on public.card_cost_actuals;
create trigger card_cost_actuals_set_updated_at
	before update on public.card_cost_actuals
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 3. Le réel dérivé
-- =============================================================================================

-- Le réel d'une ligne : la somme de ses réels s'il y en a, `0` si elle est soldée sans réel, nul sinon. `security
-- definer` : la somme porte sur tous les réels de la ligne, que la RLS des réels — la même que celle de la ligne — les
-- montre ou non à l'appelant d'un déclencheur.
create or replace function app.card_cost_reel_derive(p_ligne uuid, p_soldee boolean)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select sum(a.amount) from public.card_cost_actuals a where a.card_cost_id = p_ligne),
		case when p_soldee then 0::numeric end);
$$;

-- Sur la ligne : `actual_cost` est recalculé à chaque écriture ; une valeur envoyée qui le contredit est refusée,
-- jamais corrigée en silence. Cocher « Soldé » pose l'horodatage et son auteur — la valeur envoyée par le client n'est
-- qu'un drapeau — ; décocher les efface.
create or replace function app.card_costs_reel_derive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	derive numeric;
begin
	if tg_op = 'INSERT' then
		if new.settled_at is not null then
			new.settled_at := now();
			new.settled_by := (select auth.uid());
		else
			new.settled_by := null;
		end if;
	elsif new.settled_at is distinct from old.settled_at then
		if new.settled_at is null then
			new.settled_by := null;
		elsif old.settled_at is null then
			new.settled_at := now();
			new.settled_by := (select auth.uid());
		else
			new.settled_at := old.settled_at;
			new.settled_by := old.settled_by;
		end if;
	else
		new.settled_by := old.settled_by;
	end if;

	derive := app.card_cost_reel_derive(new.id, new.settled_at is not null);
	-- À l'insertion, seul un réel FOURNI (non nul) est une écriture directe : un upsert (`ON CONFLICT DO UPDATE`)
	-- propose d'abord une ligne au réel nul, alors que les réels de la ligne existante sont déjà là — mesuré par le
	-- rejeu du seed. À la mise à jour, toute valeur changée qui contredit la somme est refusée.
	if new.actual_cost is distinct from derive
	   and ((tg_op = 'INSERT' and new.actual_cost is not null)
	        or (tg_op = 'UPDATE' and new.actual_cost is distinct from old.actual_cost)) then
		raise exception 'reel derive' using errcode = '23514',
			detail = 'Le réel d''une ligne est la somme de ses réels (card_cost_actuals) : il ne s''écrit pas directement.';
	end if;
	new.actual_cost := derive;
	return new;
end;
$$;

revoke all on function app.card_cost_reel_derive(uuid, boolean) from public;
revoke all on function app.card_costs_reel_derive()             from public;

drop trigger if exists card_costs_reel_derive on public.card_costs;
create trigger card_costs_reel_derive
	before insert or update on public.card_costs
	for each row execute function app.card_costs_reel_derive();

-- =============================================================================================
-- 4. Les règles des réels
-- =============================================================================================

-- Avant toute écriture d'un réel : la ligne n'est pas soldée ; un réel ne change pas de ligne ; l'auteur est l'appelant.
-- Une ligne déjà supprimée (cascade de la ligne, d'une affaire ou d'un espace) laisse partir ses réels.
create or replace function app.card_cost_actuals_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ligne uuid := case when tg_op = 'DELETE' then old.card_cost_id else new.card_cost_id end;
	soldee timestamptz;
	existe boolean;
begin
	if tg_op = 'UPDATE' and new.card_cost_id is distinct from old.card_cost_id then
		raise exception 'un reel ne change pas de ligne' using errcode = 'P0001';
	end if;
	select true, c.settled_at into existe, soldee from public.card_costs c where c.id = ligne;
	if existe and soldee is not null then
		raise exception 'ligne soldee' using errcode = 'P0001',
			detail = 'Décochez « Soldé » pour ajouter, modifier ou retirer un réel de cette ligne.';
	end if;
	if tg_op = 'INSERT' then
		new.created_by := coalesce((select auth.uid()), new.created_by);
	elsif tg_op = 'UPDATE' then
		new.created_by := old.created_by;
		new.created_at := old.created_at;
	end if;
	return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Après toute écriture d'un réel : le réel de la ligne est recalculé. La mise à jour passe le contrôle de la ligne
-- parce qu'elle écrit exactement la valeur dérivée.
create or replace function app.card_cost_actuals_apres()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ligne uuid := case when tg_op = 'DELETE' then old.card_cost_id else new.card_cost_id end;
begin
	update public.card_costs c
	   set actual_cost = app.card_cost_reel_derive(c.id, c.settled_at is not null)
	 where c.id = ligne;
	return null;
end;
$$;

revoke all on function app.card_cost_actuals_avant() from public;
revoke all on function app.card_cost_actuals_apres() from public;

drop trigger if exists card_cost_actuals_avant on public.card_cost_actuals;
create trigger card_cost_actuals_avant
	before insert or update or delete on public.card_cost_actuals
	for each row execute function app.card_cost_actuals_avant();
drop trigger if exists card_cost_actuals_apres on public.card_cost_actuals;
create trigger card_cost_actuals_apres
	after insert or update or delete on public.card_cost_actuals
	for each row execute function app.card_cost_actuals_apres();

-- =============================================================================================
-- 5. RLS et privilèges — celles de la ligne (§3)
-- =============================================================================================

-- Lire un réel, c'est lire sa ligne : l'affaire ET le budget (§3.1). L'écrire, c'est pouvoir mettre à jour sa ligne :
-- écrire l'affaire et lire le budget — sans exiger le budget ouvert (§2.3). Les deux fonctions lisent `card_costs` hors
-- RLS pour qu'aucune politique ne relise une table sous politique (docs/SPEC-permissions-rls.md §3.5).
create or replace function app.card_cost_lisible(p_ligne uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.can_read_card(c.card_id) and app.can_read_budget(c.budget_id)
		   from public.card_costs c where c.id = p_ligne),
		false);
$$;

create or replace function app.card_cost_ecrivable(p_ligne uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.can_write_card(c.card_id) and app.can_read_budget(c.budget_id)
		   from public.card_costs c where c.id = p_ligne),
		false);
$$;

alter function app.card_cost_lisible(uuid)   owner to postgres;
alter function app.card_cost_ecrivable(uuid) owner to postgres;
revoke all on function app.card_cost_lisible(uuid)   from public;
revoke all on function app.card_cost_ecrivable(uuid) from public;
grant execute on function app.card_cost_lisible(uuid)   to anon, authenticated, service_role;
grant execute on function app.card_cost_ecrivable(uuid) to authenticated, service_role;

alter table public.card_cost_actuals enable row level security;

drop policy if exists card_cost_actuals_lecture on public.card_cost_actuals;
create policy card_cost_actuals_lecture on public.card_cost_actuals
	for select to anon, authenticated
	using (app.card_cost_lisible(card_cost_id));
drop policy if exists card_cost_actuals_insertion on public.card_cost_actuals;
create policy card_cost_actuals_insertion on public.card_cost_actuals
	for insert to authenticated
	with check (app.card_cost_ecrivable(card_cost_id));
drop policy if exists card_cost_actuals_maj on public.card_cost_actuals;
create policy card_cost_actuals_maj on public.card_cost_actuals
	for update to authenticated
	using (app.card_cost_ecrivable(card_cost_id))
	with check (app.card_cost_ecrivable(card_cost_id));
drop policy if exists card_cost_actuals_suppression on public.card_cost_actuals;
create policy card_cost_actuals_suppression on public.card_cost_actuals
	for delete to authenticated
	using (app.card_cost_ecrivable(card_cost_id));

revoke all on public.card_cost_actuals from anon, authenticated;
grant select                 on public.card_cost_actuals to anon, authenticated;
grant insert, update, delete on public.card_cost_actuals to authenticated;
grant all privileges         on public.card_cost_actuals to service_role;

-- =============================================================================================
-- 6. L'index de l'onglet « À saisir »
-- =============================================================================================

drop index if exists public.card_costs_sans_reel_idx;
create index if not exists card_costs_non_soldees_idx
	on public.card_costs (created_at, id)
	where settled_at is null;

-- =============================================================================================
-- 7. La reprise (décision 622, point 3)
-- =============================================================================================
-- Un réel par ligne dont le réel est connu, du montant saisi, daté du jour de la dernière modification de la ligne, sans
-- libellé, au nom de l'auteur de la ligne ; la ligne reste ouverte. Une ligne qui porte déjà des réels ou qui est soldée
-- n'est pas reprise : un nouveau passage ne double rien.
insert into public.card_cost_actuals (card_cost_id, amount, spent_on, created_by)
select c.id, c.actual_cost, c.updated_at::date, c.created_by
  from public.card_costs c
 where c.actual_cost is not null
   and c.settled_at is null
   and not exists (select 1 from public.card_cost_actuals a where a.card_cost_id = c.id);
