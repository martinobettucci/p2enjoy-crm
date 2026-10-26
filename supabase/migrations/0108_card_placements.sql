-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.1 : la table des rattachements et la reprise (décision 705, option B).
--       docs/SPEC-rattachements.md §3.1 (la table), §2 bis.3 et §2 bis.3 bis (la forme optimisée et ses trois gardes),
--       §4 (lecture d'un rattachement), §10 (la reprise), §14 (le découpage de la bascule) ; docs/JOURNAL.md décisions
--       642, 661, 667, 705
-- @spec docs/SCHEMA.md « Migration `0108` », §5 (cards, card_placements) ; docs/PROD_MIGRATIONS.md §3
--
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS. Elle crée `card_placements` et y reprend UN rattachement par
-- affaire, qui porte exactement les treize colonnes de rattachement de `cards`. `cards` reste le SEUL chemin d'écriture :
-- un déclencheur reporte chaque insertion et chaque modification de ces colonnes dans le rattachement unique de
-- l'affaire, et la suppression suit par la clé étrangère. Aucun appelant ne change, aucune colonne ne quitte `cards`,
-- aucune politique de `cards` n'est touchée : ce sont les étapes T2.2 à T2.4.
--
-- LE MIROIR EST À SENS UNIQUE, ET C'EST CE QUI LE REND SÛR. Personne n'écrit `card_placements` directement pendant
-- T2.1 : `authenticated` et `service_role` n'ont que `SELECT` ; seul le déclencheur, propriétaire de la table, y écrit.
-- Un rattachement ne peut donc pas diverger de son affaire. T2.3 inversera le sens, geste par geste.
--
-- IDEMPOTENCE (docs/SCHEMA.md, « Conventions générales »). Toutes les créations sont conditionnelles ; la reprise
-- n'insère que les affaires qui n'ont pas encore de rattachement.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md). Sans perte : `cards` porte toujours toutes les valeurs. Supprimer le
-- déclencheur, ses fonctions, puis la table (`drop table public.card_placements`) ; `app.readable_channel_ids` peut rester.

-- ===========================================================================================================
-- 1. La table des rattachements (docs/SPEC-rattachements.md §3.1)
-- ===========================================================================================================

create table if not exists public.card_placements (
	id                   uuid        primary key default gen_random_uuid(),
	workspace_id         uuid        not null,
	card_id              uuid        not null,
	channel_id           uuid        not null,
	workflow_id          uuid        not null,
	current_step_id      uuid        not null,
	position             numeric     not null,
	owner_id             uuid        references public.profiles (id) on delete set null,
	amount               numeric(14,2),
	probability_override numeric(5,2),
	next_action          text,
	next_action_at       timestamptz,
	entered_step_at      timestamptz not null default now(),
	health_score         integer,
	snoozed_until        timestamptz,
	archived_at          timestamptz,
	created_by           uuid        references public.profiles (id) on delete set null,
	created_at           timestamptz not null default now(),
	updated_at           timestamptz not null default now(),
	constraint card_placements_card_fk
		foreign key (card_id, workspace_id) references public.cards (id, workspace_id) on delete cascade,
	constraint card_placements_channel_fk
		foreign key (channel_id, workspace_id) references public.channels (id, workspace_id) on delete cascade,
	-- Le workflow d'un rattachement est celui de son channel. INITIALLY DEFERRED pendant la transition, et c'est une
	-- nécessité : `change_channel_workflow` change le workflow du channel AVANT celui des affaires, en ne différant que
	-- `cards_channel_id_workflow_id_fkey`, qu'il nomme ; une clé immédiate ici refuserait ce changement. Le rattachement
	-- est corrigé dans la même instruction que l'affaire, et la clé est vérifiée au plus tard en fin de transaction.
	-- T2.3 la rend immédiate quand `change_channel_workflow` écrira les rattachements lui-même.
	constraint card_placements_channel_workflow_fk
		foreign key (channel_id, workflow_id) references public.channels (id, workflow_id)
		deferrable initially deferred,
	constraint card_placements_step_fk
		foreign key (current_step_id, workflow_id) references public.workflow_steps (id, workflow_id),
	constraint card_placements_card_channel_key unique (card_id, channel_id),
	-- Charnières des clés composites que T2.2 posera sur `card_field_values` et `card_sequence_enrollments`.
	constraint card_placements_id_workflow_key  unique (id, workflow_id),
	constraint card_placements_id_card_key      unique (id, card_id),
	constraint card_placements_probability_override_check
		check (probability_override is null or probability_override between 0 and 100)
);

alter table public.card_placements enable row level security;

-- UN rattachement par affaire tant que la transition dure : c'est ce qui permet au miroir de désigner « le »
-- rattachement d'une affaire sans choisir. `CRM-111` T3, qui livre `attach_card`, retire cet index.
create unique index if not exists card_placements_one_per_card_idx on public.card_placements (card_id);

create index if not exists card_placements_channel_step_position_idx
	on public.card_placements (channel_id, current_step_id, position);
create index if not exists card_placements_workspace_next_action_idx
	on public.card_placements (workspace_id, next_action_at);
create index if not exists card_placements_owner_idx on public.card_placements (owner_id);

drop trigger if exists card_placements_set_updated_at on public.card_placements;
create trigger card_placements_set_updated_at
	before update on public.card_placements
	for each row execute function app.set_updated_at();

-- ===========================================================================================================
-- 2. La reprise : un rattachement par affaire existante (docs/SPEC-rattachements.md §10, point 1)
-- ===========================================================================================================

-- L'identifiant est neuf : le rattachement est un objet distinct de l'affaire, et lui donner l'identifiant de l'affaire
-- ferait croire qu'ils sont interchangeables. Les affaires à la corbeille sont reprises aussi : leur restauration doit
-- retrouver leur rattachement.
insert into public.card_placements (
	workspace_id, card_id, channel_id, workflow_id, current_step_id, position, owner_id, amount,
	probability_override, next_action, next_action_at, entered_step_at, health_score, snoozed_until,
	archived_at, created_by, created_at, updated_at)
select c.workspace_id, c.id, c.channel_id, c.workflow_id, c.current_step_id, c.position, c.owner_id, c.amount,
       c.probability_override, c.next_action, c.next_action_at, c.entered_step_at, c.health_score, c.snoozed_until,
       c.archived_at, c.created_by, c.created_at, c.updated_at
  from public.cards c
 where not exists (select 1 from public.card_placements p where p.card_id = c.id);

-- ===========================================================================================================
-- 3. Le miroir : `cards` écrit, son rattachement suit
-- ===========================================================================================================

-- 3.1 Une affaire créée reçoit son rattachement. AFTER : la position et l'ancienneté sont alors celles que les
--     déclencheurs BEFORE de `cards` ont posées. SECURITY DEFINER : l'appelant n'a pas `INSERT` sur la table.
create or replace function app.card_placements_mirror_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	insert into public.card_placements (
		workspace_id, card_id, channel_id, workflow_id, current_step_id, position, owner_id, amount,
		probability_override, next_action, next_action_at, entered_step_at, health_score, snoozed_until,
		archived_at, created_by, created_at)
	values (
		new.workspace_id, new.id, new.channel_id, new.workflow_id, new.current_step_id, new.position, new.owner_id,
		new.amount, new.probability_override, new.next_action, new.next_action_at, new.entered_step_at,
		new.health_score, new.snoozed_until, new.archived_at, new.created_by, new.created_at);
	return null;
end;
$$;

-- 3.2 Une modification des colonnes de rattachement est reportée telle quelle. Le `when` du déclencheur ne la lance
--     que si l'une d'elles change : renommer une affaire ne touche pas son rattachement.
create or replace function app.card_placements_mirror_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	update public.card_placements p
	   set channel_id           = new.channel_id,
	       workflow_id          = new.workflow_id,
	       current_step_id      = new.current_step_id,
	       position             = new.position,
	       owner_id             = new.owner_id,
	       amount               = new.amount,
	       probability_override = new.probability_override,
	       next_action          = new.next_action,
	       next_action_at       = new.next_action_at,
	       entered_step_at      = new.entered_step_at,
	       health_score         = new.health_score,
	       snoozed_until        = new.snoozed_until,
	       archived_at          = new.archived_at
	 where p.card_id = new.id;
	-- Le miroir ne se rattrape pas en silence : une affaire sans rattachement est une reprise manquée.
	if not found then
		raise exception 'card_placement_missing'
			using errcode = 'P0001',
			      detail  = format('L''affaire %s n''a pas de rattachement à mettre à jour.', new.id);
	end if;
	return null;
end;
$$;

-- Les fonctions de déclencheur ne s'appellent pas : aucun rôle client ne les exécute.
revoke all on function app.card_placements_mirror_insert() from public, anon, authenticated;
revoke all on function app.card_placements_mirror_update() from public, anon, authenticated;

drop trigger if exists card_placements_mirror_insert on public.cards;
create trigger card_placements_mirror_insert
	after insert on public.cards
	for each row execute function app.card_placements_mirror_insert();

drop trigger if exists card_placements_mirror_update on public.cards;
create trigger card_placements_mirror_update
	after update on public.cards
	for each row
	when ((old.channel_id, old.workflow_id, old.current_step_id, old.position, old.owner_id, old.amount,
	       old.probability_override, old.next_action, old.next_action_at, old.entered_step_at, old.health_score,
	       old.snoozed_until, old.archived_at)
	      is distinct from
	      (new.channel_id, new.workflow_id, new.current_step_id, new.position, new.owner_id, new.amount,
	       new.probability_override, new.next_action, new.next_action_at, new.entered_step_at, new.health_score,
	       new.snoozed_until, new.archived_at))
	execute function app.card_placements_mirror_update();

-- ===========================================================================================================
-- 4. La lecture, sous la forme optimisée (décision 667, docs/SPEC-rattachements.md §2 bis.3 et §2 bis.3 bis)
-- ===========================================================================================================

-- 4.1 La liste des channels lisibles par l'appelant, calculée UNE FOIS par requête. Ses trois gardes :
--     - STABLE, JAMAIS IMMUTABLE : déclarée IMMUTABLE, elle serait figée dans un plan préparé générique et laisserait
--       lire une personne qui a perdu le droit — mesuré, §2 bis.3 bis ; la suite 0097 vérifie la volatilité au catalogue ;
--     - aucun cache hors de la requête ;
--     - la fraîcheur est prouvée en requêtes préparées par la suite 0097.
--     La règle est celle d'`app.can_read_channel`, appliquée à chaque channel : la sémantique est identique.
create or replace function app.readable_channel_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(array_agg(ch.id), '{}'::uuid[])
	  from public.channels ch
	 where app.can_read_channel(ch.id);
$$;
-- `anon` l'exécute, comme `app.can_read_channel` : un refus est ZÉRO LIGNE, jamais une erreur de privilège.
revoke all on function app.readable_channel_ids() from public;
grant execute on function app.readable_channel_ids() to anon, authenticated, service_role;

-- 4.2 Un rattachement est lisible si son channel l'est. Un rattachement à un channel illisible est masqué, existence
--     comprise (décision 642). Aucune politique d'écriture : en T2.1, aucun client n'écrit la table.
drop policy if exists card_placements_select on public.card_placements;
create policy card_placements_select on public.card_placements
	for select to authenticated
	using (channel_id in (select unnest(app.readable_channel_ids())));

-- 4.3 Les privilèges. `anon` a `SELECT`, comme sur `cards` : sans lui, un refus serait une erreur de privilège et non
--     ZÉRO LIGNE ; aucune politique ne le vise, la RLS lui rend zéro ligne. `service_role` LIT seulement : le miroir
--     doit rester le seul écrivain tant que `cards` est le chemin d'écriture.
revoke all on public.card_placements from public, anon, authenticated, service_role;
grant select on public.card_placements to anon, authenticated, service_role;

comment on table public.card_placements is
	'CRM-111 — docs/SPEC-rattachements.md §3.1. Le rattachement d''une affaire à un channel. Pendant la transition (T2.1, décision 705), un par affaire, miroir des colonnes de rattachement de cards écrit par les déclencheurs card_placements_mirror_* ; aucun client ne l''écrit. Lecture sous la forme optimisée (app.readable_channel_ids, décision 667).';
