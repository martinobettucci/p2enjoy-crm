-- @spec CRM-108 (docs/BACKLOG.md) — tranche T2 : les recettes d'une affaire, la rentabilité, la famille `recettes` du
--       connecteur
-- @spec docs/SPEC-recettes.md §2 (`card_revenues`, `card_revenue_actuals`, réel dérivé, ligne soldée, devise verrouillée),
--       §3 (lecture et écriture : celles de l'affaire ; rentabilité réservée aux administrateurs), §4 (les grandeurs que la
--       fonction somme), §5 (`public.rentabilite_affaires`), §6.4 (`public.recette_saisissable`), §7 (famille `recettes`) ;
--       docs/SCHEMA.md §9 sexies « Migration `0095` » ; docs/SPEC-mcp.md §6.1, §6.3, §8.2 ; docs/PROD_MIGRATIONS.md §2.16 ;
--       docs/JOURNAL.md décision 632
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- 1. `public.card_revenues` : les lignes de recette d'une affaire — nature, prévu, réel dérivé, soldée.
-- 2. `public.card_revenue_actuals` : les recettes réelles d'une ligne — montant, date, libellé facultatif.
-- 3. Le réel dérivé et la ligne soldée figée : la règle EXACTE de `card_costs` (migration 0088), reprise ici et non
--    partagée, les deux tables restant indépendantes.
-- 4. La devise verrouillée : la devise d'une ligne est celle de son affaire, qui ne change plus tant qu'elle en porte.
-- 5. La lecture et l'écriture : celles de l'affaire (`app.can_read_card`, `app.can_write_card`).
-- 6. `public.recette_saisissable` : le droit d'écrire une ligne, rendu par la base à l'onglet « À saisir ».
-- 7. `public.rentabilite_affaires` : recettes, coûts et personnel par affaire et par devise, sous la RLS de l'appelant,
--    réservée aux administrateurs de l'espace.
-- 8. La huitième famille du connecteur, `recettes`, dans les quatre listes fermées.
--
-- IDEMPOTENTE ET CONVERGENTE, bien que le registre (`CRM-096`) ne la rejoue pas.

-- =============================================================================================
-- 1. `public.card_revenues`
-- =============================================================================================

create table if not exists public.card_revenues (
	id               uuid          primary key default gen_random_uuid(),
	card_id          uuid          not null references public.cards (id) on delete cascade,
	label            text          not null,
	-- Aucune contrainte de signe : un avoir est une recette négative légitime (§2.1).
	estimated_amount numeric(14,2) not null,
	-- DÉRIVÉ (§2.3) : nul tant que la recette réelle est inconnue, et nul n'est pas zéro.
	actual_amount    numeric(14,2),
	settled_at       timestamptz,
	settled_by       uuid          references public.profiles (id) on delete set null,
	position         numeric       not null,
	created_by       uuid          references public.profiles (id) on delete set null,
	created_at       timestamptz   not null default now(),
	updated_at       timestamptz   not null default now()
);

alter table public.card_revenues drop constraint if exists card_revenues_label_check;
alter table public.card_revenues add  constraint card_revenues_label_check
	check (app.btrim_blancs(label) <> '');

create index if not exists card_revenues_card_idx
	on public.card_revenues (card_id, position);

-- L'onglet « À saisir » (§6.4) liste les lignes non soldées, de la plus ancienne à la plus récente.
create index if not exists card_revenues_non_soldees_idx
	on public.card_revenues (created_at, id)
	where settled_at is null;

comment on table public.card_revenues is
	'CRM-108 — docs/SPEC-recettes.md §2.1. Ligne de recette d''une affaire ; sa devise est celle de l''affaire.';
comment on column public.card_revenues.actual_amount is
	'Dérivé (docs/SPEC-recettes.md §2.3) : somme des réels, 0 si soldée sans réel, nul sinon. Jamais écrit par le client.';

drop trigger if exists card_revenues_set_updated_at on public.card_revenues;
create trigger card_revenues_set_updated_at
	before update on public.card_revenues
	for each row execute function app.set_updated_at();

-- La position suivante dans l'affaire, quand elle est omise — le patron de `app.budgets_attribuer_position`.
-- `security definer` : la position se calcule sur toutes les lignes de l'affaire, pas sur les seules visibles.
create or replace function app.card_revenues_attribuer_position()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.position is null then
		new.position := (
			select coalesce(max(r.position), 0) + 1
			  from public.card_revenues r
			 where r.card_id = new.card_id);
	end if;
	return new;
end;
$$;

alter function app.card_revenues_attribuer_position() owner to postgres;
revoke all on function app.card_revenues_attribuer_position() from public;

drop trigger if exists card_revenues_attribuer_position on public.card_revenues;
create trigger card_revenues_attribuer_position
	before insert on public.card_revenues
	for each row execute function app.card_revenues_attribuer_position();

-- Une ligne ne change pas d'affaire : sa devise est celle de son affaire, et la déplacer changerait le sens de ses
-- montants. Déplacer une recette, c'est la retirer et la saisir ailleurs.
create or replace function app.card_revenues_affaire_immuable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.card_id is distinct from old.card_id then
		raise exception 'une ligne de recette ne change pas d''affaire' using errcode = '23514';
	end if;
	return new;
end;
$$;

revoke all on function app.card_revenues_affaire_immuable() from public;

drop trigger if exists card_revenues_affaire_immuable on public.card_revenues;
create trigger card_revenues_affaire_immuable
	before update of card_id on public.card_revenues
	for each row execute function app.card_revenues_affaire_immuable();

-- =============================================================================================
-- 2. `public.card_revenue_actuals`
-- =============================================================================================

create table if not exists public.card_revenue_actuals (
	id              uuid          primary key default gen_random_uuid(),
	card_revenue_id uuid          not null references public.card_revenues (id) on delete cascade,
	-- Aucune contrainte de signe, et `0` admis (§2.2).
	amount          numeric(14,2) not null,
	received_on     date          not null default current_date,
	label           text,
	created_by      uuid          references public.profiles (id) on delete set null,
	created_at      timestamptz   not null default now(),
	updated_at      timestamptz   not null default now()
);

alter table public.card_revenue_actuals drop constraint if exists card_revenue_actuals_label_check;
alter table public.card_revenue_actuals add  constraint card_revenue_actuals_label_check
	check (label is null or btrim(label) <> '');

create index if not exists card_revenue_actuals_ligne_idx
	on public.card_revenue_actuals (card_revenue_id, received_on, created_at);

comment on table public.card_revenue_actuals is
	'CRM-108 — docs/SPEC-recettes.md §2.2. Les recettes réelles d''une ligne ; leur somme est `card_revenues.actual_amount`.';

drop trigger if exists card_revenue_actuals_set_updated_at on public.card_revenue_actuals;
create trigger card_revenue_actuals_set_updated_at
	before update on public.card_revenue_actuals
	for each row execute function app.set_updated_at();

-- =============================================================================================
-- 3. Le réel dérivé et la ligne soldée — la règle de `card_costs` (migration 0088), mot pour mot
-- =============================================================================================

create or replace function app.card_revenue_reel_derive(p_ligne uuid, p_soldee boolean)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select sum(a.amount) from public.card_revenue_actuals a where a.card_revenue_id = p_ligne),
		case when p_soldee then 0::numeric end);
$$;

-- Sur la ligne : le réel est recalculé à chaque écriture ; une valeur envoyée qui le contredit est refusée, jamais
-- corrigée en silence. Cocher « Soldé » pose l'horodatage et son auteur ; décocher les efface.
create or replace function app.card_revenues_reel_derive()
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
		new.created_by := coalesce((select auth.uid()), new.created_by);
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

	derive := app.card_revenue_reel_derive(new.id, new.settled_at is not null);
	-- À l'insertion, seul un réel FOURNI est une écriture directe : un upsert propose d'abord une ligne au réel nul
	-- (leçon du rejeu du seed, migration 0088).
	if new.actual_amount is distinct from derive
	   and ((tg_op = 'INSERT' and new.actual_amount is not null)
	        or (tg_op = 'UPDATE' and new.actual_amount is distinct from old.actual_amount)) then
		raise exception 'reel derive' using errcode = '23514',
			detail = 'La recette réelle d''une ligne est la somme de ses réels (card_revenue_actuals) : elle ne s''écrit pas directement.';
	end if;
	new.actual_amount := derive;
	return new;
end;
$$;

revoke all on function app.card_revenue_reel_derive(uuid, boolean) from public;
revoke all on function app.card_revenues_reel_derive()             from public;

drop trigger if exists card_revenues_reel_derive on public.card_revenues;
create trigger card_revenues_reel_derive
	before insert or update on public.card_revenues
	for each row execute function app.card_revenues_reel_derive();

-- Avant toute écriture d'un réel : la ligne n'est pas soldée ; un réel ne change pas de ligne ; l'auteur est l'appelant.
-- Une ligne déjà supprimée (cascade de la ligne, d'une affaire ou d'un espace) laisse partir ses réels.
create or replace function app.card_revenue_actuals_avant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ligne uuid := case when tg_op = 'DELETE' then old.card_revenue_id else new.card_revenue_id end;
	soldee timestamptz;
	existe boolean;
begin
	if tg_op = 'UPDATE' and new.card_revenue_id is distinct from old.card_revenue_id then
		raise exception 'un reel ne change pas de ligne' using errcode = 'P0001';
	end if;
	select true, r.settled_at into existe, soldee from public.card_revenues r where r.id = ligne;
	if existe and soldee is not null then
		raise exception 'ligne soldee' using errcode = 'P0001',
			detail = 'Décochez « Soldé » pour ajouter, modifier ou retirer une recette réelle de cette ligne.';
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

-- Après toute écriture d'un réel : le réel de la ligne est recalculé. La mise à jour passe le contrôle de la ligne parce
-- qu'elle écrit exactement la valeur dérivée.
create or replace function app.card_revenue_actuals_apres()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	ligne uuid := case when tg_op = 'DELETE' then old.card_revenue_id else new.card_revenue_id end;
begin
	update public.card_revenues r
	   set actual_amount = app.card_revenue_reel_derive(r.id, r.settled_at is not null)
	 where r.id = ligne;
	return null;
end;
$$;

revoke all on function app.card_revenue_actuals_avant() from public;
revoke all on function app.card_revenue_actuals_apres() from public;

drop trigger if exists card_revenue_actuals_avant on public.card_revenue_actuals;
create trigger card_revenue_actuals_avant
	before insert or update or delete on public.card_revenue_actuals
	for each row execute function app.card_revenue_actuals_avant();
drop trigger if exists card_revenue_actuals_apres on public.card_revenue_actuals;
create trigger card_revenue_actuals_apres
	after insert or update or delete on public.card_revenue_actuals
	for each row execute function app.card_revenue_actuals_apres();

-- =============================================================================================
-- 4. La devise d'une affaire est verrouillée par ses recettes (§2.4)
-- =============================================================================================
-- Sinon 28 000 CHF deviendraient 28 000 EUR sans que personne ne l'ait décidé. `security definer` : le compte porte sur
-- toutes les lignes de l'affaire, que l'appelant les lise ou non.

create or replace function app.cards_devise_verrouillee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.currency is distinct from old.currency
	   and exists (select 1 from public.card_revenues r where r.card_id = new.id) then
		raise exception 'devise verrouillee par les recettes' using errcode = '23514',
			detail = 'Cette affaire porte des lignes de recette dans sa devise : retirez-les avant de changer de devise.';
	end if;
	return new;
end;
$$;

alter function app.cards_devise_verrouillee() owner to postgres;
revoke all on function app.cards_devise_verrouillee() from public;

drop trigger if exists cards_devise_verrouillee on public.cards;
create trigger cards_devise_verrouillee
	before update of currency on public.cards
	for each row execute function app.cards_devise_verrouillee();

-- =============================================================================================
-- 5. RLS et privilèges — ceux de l'affaire (§3)
-- =============================================================================================

alter table public.card_revenues enable row level security;

drop policy if exists card_revenues_lecture on public.card_revenues;
create policy card_revenues_lecture on public.card_revenues
	for select to anon, authenticated
	using (app.can_read_card(card_id));
drop policy if exists card_revenues_insertion on public.card_revenues;
create policy card_revenues_insertion on public.card_revenues
	for insert to authenticated
	with check (app.can_write_card(card_id));
drop policy if exists card_revenues_maj on public.card_revenues;
create policy card_revenues_maj on public.card_revenues
	for update to authenticated
	using (app.can_write_card(card_id))
	with check (app.can_write_card(card_id));
drop policy if exists card_revenues_suppression on public.card_revenues;
create policy card_revenues_suppression on public.card_revenues
	for delete to authenticated
	using (app.can_write_card(card_id));

revoke all on public.card_revenues from anon, authenticated;
grant select                 on public.card_revenues to anon, authenticated;
grant insert, update, delete on public.card_revenues to authenticated;
grant all privileges         on public.card_revenues to service_role;

-- Lire un réel, c'est lire l'affaire de sa ligne ; l'écrire, c'est écrire l'affaire. Les deux fonctions lisent
-- `card_revenues` hors RLS pour qu'aucune politique ne relise une table sous politique
-- (docs/SPEC-permissions-rls.md §3.5) — la forme de `app.card_cost_lisible` (migration 0088).
create or replace function app.card_revenue_lisible(p_ligne uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.can_read_card(r.card_id) from public.card_revenues r where r.id = p_ligne),
		false);
$$;

create or replace function app.card_revenue_ecrivable(p_ligne uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(
		(select app.can_write_card(r.card_id) from public.card_revenues r where r.id = p_ligne),
		false);
$$;

alter function app.card_revenue_lisible(uuid)   owner to postgres;
alter function app.card_revenue_ecrivable(uuid) owner to postgres;
revoke all on function app.card_revenue_lisible(uuid)   from public;
revoke all on function app.card_revenue_ecrivable(uuid) from public;
grant execute on function app.card_revenue_lisible(uuid)   to anon, authenticated, service_role;
grant execute on function app.card_revenue_ecrivable(uuid) to authenticated, service_role;

alter table public.card_revenue_actuals enable row level security;

drop policy if exists card_revenue_actuals_lecture on public.card_revenue_actuals;
create policy card_revenue_actuals_lecture on public.card_revenue_actuals
	for select to anon, authenticated
	using (app.card_revenue_lisible(card_revenue_id));
drop policy if exists card_revenue_actuals_insertion on public.card_revenue_actuals;
create policy card_revenue_actuals_insertion on public.card_revenue_actuals
	for insert to authenticated
	with check (app.card_revenue_ecrivable(card_revenue_id));
drop policy if exists card_revenue_actuals_maj on public.card_revenue_actuals;
create policy card_revenue_actuals_maj on public.card_revenue_actuals
	for update to authenticated
	using (app.card_revenue_ecrivable(card_revenue_id))
	with check (app.card_revenue_ecrivable(card_revenue_id));
drop policy if exists card_revenue_actuals_suppression on public.card_revenue_actuals;
create policy card_revenue_actuals_suppression on public.card_revenue_actuals
	for delete to authenticated
	using (app.card_revenue_ecrivable(card_revenue_id));

revoke all on public.card_revenue_actuals from anon, authenticated;
grant select                 on public.card_revenue_actuals to anon, authenticated;
grant insert, update, delete on public.card_revenue_actuals to authenticated;
grant all privileges         on public.card_revenue_actuals to service_role;

-- =============================================================================================
-- 6. `public.recette_saisissable` — le droit d'écrire une ligne, lu par l'onglet « À saisir » (§6.4)
-- =============================================================================================
-- La forme de `public.reel_saisissable` (migration 52) : une colonne calculée, jamais `security definer`, évaluée sous
-- l'identité de l'appelant. Le droit reste une règle de la base que l'écran LIT.

create or replace function public.recette_saisissable(ligne public.card_revenues)
returns boolean
language sql
stable
set search_path = ''
as $$
	select app.can_write_card(ligne.card_id);
$$;

comment on function public.recette_saisissable(public.card_revenues) is
	'CRM-108 — docs/SPEC-recettes.md §6.4. Colonne calculée : l''appelant peut-il écrire cette ligne de recette ?';

revoke all on function public.recette_saisissable(public.card_revenues) from public;
grant execute on function public.recette_saisissable(public.card_revenues) to anon, authenticated, service_role;

-- =============================================================================================
-- 7. `public.rentabilite_affaires` — recettes, coûts et personnel par affaire et par devise (§5)
-- =============================================================================================
-- `security invoker`, ET C'EST LE POINT MÊME DE LA FONCTION : elle somme ce que la RLS rend à l'appelant — `card_costs`
-- sous sa double condition, le temps et son coût sous la règle du temps —, jamais davantage. Elle n'ajoute qu'une
-- garde : seules les affaires d'un espace qu'il ADMINISTRE, parce que la marge soustrait le coût de toute l'équipe, que
-- seul un administrateur lit (§3). La marge, le taux et le caractère partiel ne sont pas calculés ici (§5) : la base
-- rend des sommes et des comptes.
--
-- La période filtre les RÉELS par leur date et le temps par son jour ; les prévus portent sur toute l'affaire (§4.5).
-- Une ligne soldée sans réel compte pour 0 quelle que soit la période : sa recette réelle est connue, et nulle.

create or replace function public.rentabilite_affaires(
	p_debut date default null,
	p_fin   date default null,
	p_card  uuid default null)
returns table (
	workspace_id             uuid,
	track_id                 uuid,
	channel_id               uuid,
	card_id                  uuid,
	node_kind                text,
	archivee                 boolean,
	currency                 text,
	recettes_prevues         numeric,
	recettes_reelles         numeric,
	lignes_recette           integer,
	lignes_recette_sans_reel integer,
	couts_prevus             numeric,
	couts_reels              numeric,
	lignes_cout              integer,
	lignes_cout_sans_reel    integer,
	personnel                numeric,
	minutes                  bigint,
	minutes_non_valorisees   bigint)
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
	with affaires as (
		select c.id, c.workspace_id, ch.track_id, c.channel_id, n.kind, c.archived_at is not null as archivee, c.currency
		  from public.cards c
		  join public.channels ch on ch.id = c.channel_id
		  join public.workflow_steps s on s.id = c.current_step_id
		  join public.workflow_nodes_catalog n on n.id = s.node_id
		 where c.deleted_at is null
		   and app.is_workspace_admin(c.workspace_id)
		   and (p_card is null or c.id = p_card)
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
		  join affaires a on a.id = r.card_id
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
		  join affaires a on a.id = k.card_id
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
		  from public.temps_valorise(coalesce(p_debut, '-infinity'::date), coalesce(p_fin, 'infinity'::date),
		                             null, null, p_card) t
		  join affaires a on a.id = t.card_id
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
	       coalesce(t.non_valorisees, 0)::bigint
	  from cles k
	  join affaires a on a.id = k.card_id
	  left join recettes r on r.card_id = k.card_id and r.currency is not distinct from k.currency
	  left join couts c    on c.card_id = k.card_id and c.currency is not distinct from k.currency
	  left join temps t    on t.card_id = k.card_id and t.currency is not distinct from k.currency
	 order by a.track_id, a.channel_id, a.id, k.currency nulls last;
end;
$$;

comment on function public.rentabilite_affaires(date, date, uuid) is
	'CRM-108 — docs/SPEC-recettes.md §5. Recettes, coûts et personnel par affaire × devise, sous la RLS de l''appelant ; '
	'réservée aux administrateurs de l''espace (42501 rentabilite_reservee).';

revoke all on function public.rentabilite_affaires(date, date, uuid) from public, anon;
grant execute on function public.rentabilite_affaires(date, date, uuid) to authenticated, service_role;

-- =============================================================================================
-- 8. La famille `recettes` du connecteur (docs/SPEC-mcp.md §6.1, §6.3, §8.2)
-- =============================================================================================
-- La liste des familles est fermée à quatre endroits ; `recettes` vient après `budgets`, l'ordre des tableaux étant celui
-- de la matrice. `create or replace` garde les droits d'exécution posés par 0090 et 0094 : ils ne sont pas repris.

alter table public.mcp_droits drop constraint if exists mcp_droits_famille;
alter table public.mcp_droits add  constraint mcp_droits_famille
	check (famille in ('structure', 'affaires', 'contacts', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie'));

create or replace function public.mcp_autorise(p_ws uuid, p_famille text, p_action text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_famille is null or p_famille not in ('structure', 'affaires', 'contacts', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie') then
		raise exception 'famille_inconnue' using errcode = '22023';
	end if;
	if p_action is null or p_action not in ('consulter', 'ajouter', 'modifier', 'supprimer') then
		raise exception 'action_inconnue' using errcode = '22023';
	end if;
	return app.est_superadmin()
	    or exists (
		select 1 from public.mcp_droits d
		 where d.sub = (select auth.uid())
		   and d.workspace_id = p_ws
		   and d.famille = p_famille
		   and d.action = p_action
	);
end;
$$;

create or replace function public.mcp_compte(p_sub uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	familles constant text[] := array['structure', 'affaires', 'contacts', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie'];
	actions  constant text[] := array['consulter', 'ajouter', 'modifier', 'supprimer'];
	profil   public.profiles%rowtype;
	compte   public.mcp_comptes%rowtype;
begin
	perform app.exiger_superadmin();
	select * into profil from public.profiles p where p.id = p_sub;
	select * into compte from public.mcp_comptes c where c.sub = p_sub;
	if profil.id is null and compte.sub is null then
		raise exception 'profil_introuvable' using errcode = 'P0002';
	end if;
	return pg_catalog.jsonb_build_object(
		'sub', p_sub,
		'nom', coalesce(profil.full_name, compte.nom),
		'email', compte.email,
		'avec_profil', profil.id is not null,
		'connecte', compte.sub is not null,
		'premiere_connexion', compte.premiere_connexion,
		'derniere_activite', compte.derniere_activite,
		'superadmin', exists (select 1 from public.superadmins s where s.sub = p_sub),
		'espaces', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
			         'workspace_id', w.id,
			         'slug', w.slug,
			         'nom', w.name,
			         'role', (select m.role from public.workspace_members m where m.workspace_id = w.id and m.user_id = p_sub),
			         'droits', coalesce((
			           select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(d.famille, d.action)
			                    order by pg_catalog.array_position(familles, d.famille),
			                             pg_catalog.array_position(actions, d.action))
			             from public.mcp_droits d
			            where d.sub = p_sub and d.workspace_id = w.id), '[]'::jsonb))
			       order by w.name, w.slug)
			  from public.workspaces w), '[]'::jsonb));
end;
$$;

create or replace function public.mcp_poser_droits(p_sub uuid, p_ws uuid, p_droits jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	familles constant text[] := array['structure', 'affaires', 'contacts', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie'];
	actions  constant text[] := array['consulter', 'ajouter', 'modifier', 'supprimer'];
	couple   jsonb;
	avant    jsonb;
	apres    jsonb;
begin
	perform app.exiger_superadmin();
	if p_sub is null or not exists (select 1 from public.profiles p where p.id = p_sub) then
		raise exception 'profil_introuvable' using errcode = 'P0002';
	end if;
	perform app.plateforme_espace_existe(p_ws);
	if p_droits is null or pg_catalog.jsonb_typeof(p_droits) <> 'array' then
		raise exception 'droit_invalide' using errcode = '22023';
	end if;
	for couple in select e.value from pg_catalog.jsonb_array_elements(p_droits) e loop
		if pg_catalog.jsonb_typeof(couple) <> 'array' or pg_catalog.jsonb_array_length(couple) <> 2
		   or pg_catalog.jsonb_typeof(couple -> 0) <> 'string' or pg_catalog.jsonb_typeof(couple -> 1) <> 'string'
		   or not ((couple ->> 0) = any (familles)) or not ((couple ->> 1) = any (actions)) then
			raise exception 'droit_invalide' using errcode = '22023';
		end if;
	end loop;

	select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(d.famille, d.action)
	                  order by pg_catalog.array_position(familles, d.famille), pg_catalog.array_position(actions, d.action)),
	                '[]'::jsonb)
	  into avant
	  from public.mcp_droits d where d.sub = p_sub and d.workspace_id = p_ws;
	select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x.famille, x.action)
	                  order by pg_catalog.array_position(familles, x.famille), pg_catalog.array_position(actions, x.action)),
	                '[]'::jsonb)
	  into apres
	  from (select distinct e.value ->> 0 as famille, e.value ->> 1 as action
	          from pg_catalog.jsonb_array_elements(p_droits) e) x;
	if avant = apres then
		return;
	end if;

	delete from public.mcp_droits d
	 where d.sub = p_sub and d.workspace_id = p_ws
	   and not exists (select 1 from pg_catalog.jsonb_array_elements(p_droits) e
	                    where e.value ->> 0 = d.famille and e.value ->> 1 = d.action);
	insert into public.mcp_droits (sub, workspace_id, famille, action, accorde_par)
	select distinct p_sub, p_ws, e.value ->> 0, e.value ->> 1, (select auth.uid())
	  from pg_catalog.jsonb_array_elements(p_droits) e
	on conflict (sub, workspace_id, famille, action) do nothing;

	perform app.journaliser_plateforme('mcp_droits_poses', p_ws, pg_catalog.jsonb_build_object(
		'nom', app.plateforme_nom_profil(p_sub),
		'espace', app.plateforme_nom_espace(p_ws),
		'avant', avant,
		'apres', apres));
end;
$$;
