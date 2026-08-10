-- @spec CRM-018 (docs/BACKLOG.md) — champs exigés par une transition avec intégrité référentielle
-- @spec docs/SPEC-transition-required-fields.md §2 à §6
-- @spec docs/SPEC-workflow-engine.md §3.4, §4.5, §5.7
-- @spec docs/SPEC-form-composer.md §3.5, §6.7
-- @spec docs/SCHEMA.md §3, §4 ; docs/PROD_MIGRATIONS.md §3
--
-- L'ancien `workflow_transitions.require_fields uuid[]` ne pouvait porter aucune clé étrangère.
-- Cette migration déplie les exigences effectives, retire les copies inertes, puis fait de
-- l'existence des deux parents et de leur appartenance au même workflow des invariants de base.

-- =============================================================================================
-- 1. Table à deux colonnes et mise à niveau de l'ancien tableau
-- =============================================================================================

create table if not exists public.workflow_transition_required_fields (
	transition_id uuid,
	field_id      uuid
);

-- Un objet de ce nom portant une autre forme ne doit jamais être « réparé » en supprimant des
-- données inconnues. La migration s'arrête et demande une intervention explicite.
do $$
declare
	colonnes_inattendues text;
begin
	select string_agg(a.attname, ', ' order by a.attnum)
	  into colonnes_inattendues
	  from pg_attribute a
	 where a.attrelid = 'public.workflow_transition_required_fields'::regclass
	   and a.attnum > 0
	   and not a.attisdropped
	   and a.attname not in ('transition_id', 'field_id');

	if colonnes_inattendues is not null then
		raise exception 'workflow_transition_required_fields_colonnes_inattendues: %',
			colonnes_inattendues;
	end if;
end;
$$;

alter table public.workflow_transition_required_fields
	add column if not exists transition_id uuid,
	add column if not exists field_id uuid;

-- `add column if not exists` ne valide pas le type d'une colonne déjà présente. Convertir ici un
-- type inconnu serait une mutation de données implicite ; l'état non conforme est donc refusé.
do $$
declare
	types_inattendus text;
begin
	select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod), ', ' order by a.attnum)
	  into types_inattendus
	  from pg_attribute a
	 where a.attrelid = 'public.workflow_transition_required_fields'::regclass
	   and a.attnum > 0
	   and not a.attisdropped
	   and a.attname in ('transition_id', 'field_id')
	   and a.atttypid <> 'uuid'::regtype;

	if types_inattendus is not null then
		raise exception 'workflow_transition_required_fields_types_inattendus: %', types_inattendus;
	end if;
end;
$$;

alter table public.workflow_transition_required_fields
	alter column transition_id drop default,
	alter column field_id drop default;

-- L'état déjà migré est conservé, mais il est validé avant de reconstruire les contraintes : un
-- rejeu ne masque jamais une corruption produite pendant qu'une contrainte était dégradée.
do $$
declare
	parents_absents bigint;
	croisements     bigint;
begin
	select count(*) into parents_absents
	  from public.workflow_transition_required_fields trf
	  left join public.workflow_transitions t on t.id = trf.transition_id
	  left join public.form_fields f on f.id = trf.field_id
	 where trf.transition_id is null
	    or trf.field_id is null
	    or t.id is null
	    or f.id is null;

	if parents_absents > 0 then
		raise exception 'required_field_parent_missing: % liaison(s)', parents_absents
			using errcode = '23503';
	end if;

	select count(*) into croisements
	  from public.workflow_transition_required_fields trf
	  join public.workflow_transitions t on t.id = trf.transition_id
	  join public.form_fields f on f.id = trf.field_id
	 where t.workflow_id <> f.workflow_id;

	if croisements > 0 then
		raise exception 'required_field_workflow_mismatch: % liaison(s)', croisements
			using errcode = '23514';
	end if;
end;
$$;

-- Le nom de l'ancienne colonne est testé dans le catalogue ; son contenu est ensuite lu en SQL
-- dynamique, faute de quoi une base neuve échouerait dès l'analyse du bloc.
do $$
declare
	identifiants_morts bigint;
	croisements_ws     bigint;
	artefacts_copie    bigint;
begin
	if exists (
		select 1
		  from pg_attribute
		 where attrelid = 'public.workflow_transitions'::regclass
		   and attname = 'require_fields'
		   and attnum > 0
		   and not attisdropped
	) then
		execute $sql$
			select count(*)
			  from public.workflow_transitions t
			  cross join lateral unnest(coalesce(t.require_fields, '{}'::uuid[])) u(field_id)
			  left join public.form_fields f on f.id = u.field_id
			 where f.id is null
		$sql$ into identifiants_morts;

		if identifiants_morts > 0 then
			raise exception 'require_fields_dead_identifiers: % identifiant(s)', identifiants_morts
				using errcode = '23503';
		end if;

		execute $sql$
			select count(*)
			  from public.workflow_transitions t
			  cross join lateral unnest(coalesce(t.require_fields, '{}'::uuid[])) u(field_id)
			  join public.form_fields f on f.id = u.field_id
			 where f.workspace_id <> t.workspace_id
		$sql$ into croisements_ws;

		if croisements_ws > 0 then
			raise exception 'require_fields_workspace_mismatch: % identifiant(s)', croisements_ws
				using errcode = '23514';
		end if;

		execute $sql$
			select count(*)
			  from public.workflow_transitions t
			  cross join lateral unnest(coalesce(t.require_fields, '{}'::uuid[])) u(field_id)
			  join public.form_fields f on f.id = u.field_id
			 where f.workspace_id = t.workspace_id
			   and f.workflow_id <> t.workflow_id
		$sql$ into artefacts_copie;

		if artefacts_copie > 0 then
			raise notice 'CRM-018 : % ancienne(s) exigence(s) dérivée(s) inerte(s) écartée(s)',
			artefacts_copie;
		end if;

		execute $sql$
			insert into public.workflow_transition_required_fields (transition_id, field_id)
			select distinct t.id, u.field_id
			  from public.workflow_transitions t
			  cross join lateral unnest(coalesce(t.require_fields, '{}'::uuid[])) u(field_id)
			  join public.form_fields f on f.id = u.field_id
			 where f.workflow_id = t.workflow_id
			on conflict do nothing
		$sql$;

		execute 'alter table public.workflow_transitions drop column require_fields';
	end if;
end;
$$;

alter table public.workflow_transition_required_fields
	alter column transition_id set not null,
	alter column field_id set not null;

-- =============================================================================================
-- 2. Contraintes convergentes : unicité et deux cascades
-- =============================================================================================

-- Le runner rejoue chaque fichier. Remplacer une contrainte déjà exacte reconstruirait son index
-- et verrouillerait la table sans acheter de propriété. À l'inverse, `if not exists` laisserait
-- survivre une FK affaiblie sous le bon nom. La définition canonique est donc comparée avant agir.
create or replace function app.migration_0019_converger_contrainte(
	nom_table text, nom_contrainte text, definition_attendue text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	definition_reelle text;
	reelle_normalisee text;
	attendue_normalisee text;
begin
	select pg_get_constraintdef(c.oid) into definition_reelle
	  from pg_constraint c
	 where c.conrelid = nom_table::regclass
	   and c.conname = nom_contrainte;

	reelle_normalisee := btrim(regexp_replace(replace(coalesce(definition_reelle, ''),
		'public.', ''), '[[:space:]]+', ' ', 'g'));
	attendue_normalisee := btrim(regexp_replace(replace(definition_attendue, 'public.', ''),
		'[[:space:]]+', ' ', 'g'));

	if definition_reelle is null then
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	elsif reelle_normalisee <> attendue_normalisee then
		execute format('alter table %s drop constraint %I', nom_table, nom_contrainte);
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	end if;
end;
$$;

select app.migration_0019_converger_contrainte(
	'public.workflow_transition_required_fields',
	'workflow_transition_required_fields_pkey',
	'PRIMARY KEY (transition_id, field_id)');

select app.migration_0019_converger_contrainte(
	'public.workflow_transition_required_fields',
	'workflow_transition_required_fields_transition_id_fkey',
	'FOREIGN KEY (transition_id) REFERENCES public.workflow_transitions(id) ON DELETE CASCADE');

select app.migration_0019_converger_contrainte(
	'public.workflow_transition_required_fields',
	'workflow_transition_required_fields_field_id_fkey',
	'FOREIGN KEY (field_id) REFERENCES public.form_fields(id) ON DELETE CASCADE');

-- Même contrat pour l'index inverse : le garder s'il est exact, le réparer s'il ne l'est pas.
do $$
declare
	definition_reelle text;
	reelle_normalisee text;
	attendue_normalisee constant text :=
		'create index workflow_transition_required_fields_field_idx '
		'on workflow_transition_required_fields using btree (field_id)';
begin
	select pg_get_indexdef(c.oid) into definition_reelle
	  from pg_class c
	  join pg_namespace n on n.oid = c.relnamespace
	 where n.nspname = 'public'
	   and c.relname = 'workflow_transition_required_fields_field_idx'
	   and c.relkind = 'i';

	reelle_normalisee := lower(btrim(regexp_replace(replace(coalesce(definition_reelle, ''),
		'public.', ''), '[[:space:]]+', ' ', 'g')));

	if reelle_normalisee <> attendue_normalisee then
		drop index if exists public.workflow_transition_required_fields_field_idx;
		create index workflow_transition_required_fields_field_idx
			on public.workflow_transition_required_fields (field_id);
	end if;
end;
$$;

comment on table public.workflow_transition_required_fields is
	'CRM-018 — docs/SPEC-transition-required-fields.md. Champs exigés en plus des règles required '
	'de l''étape cible. Deux parents réels, suppression en cascade, même workflow garanti.';

-- =============================================================================================
-- 3. Même workflow, y compris pour service_role qui contourne RLS
-- =============================================================================================

create or replace function app.workflow_transition_required_fields_verifier_workflow()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	workflow_transition uuid;
	workflow_champ      uuid;
begin
	select t.workflow_id into workflow_transition
	  from public.workflow_transitions t
	 where t.id = new.transition_id
	 for share;

	select f.workflow_id into workflow_champ
	  from public.form_fields f
	 where f.id = new.field_id
	 for share;

	-- Un parent absent relève des clés étrangères et de leur diagnostic `23503`.
	if workflow_transition is null or workflow_champ is null then
		return new;
	end if;

	if workflow_transition <> workflow_champ then
		raise exception 'required_field_workflow_mismatch'
			using errcode = '23514';
	end if;

	return new;
end;
$$;

alter function app.workflow_transition_required_fields_verifier_workflow() owner to postgres;
revoke all on function app.workflow_transition_required_fields_verifier_workflow()
	from public, anon, authenticated, service_role;

drop trigger if exists workflow_transition_required_fields_verifier_workflow
	on public.workflow_transition_required_fields;
create trigger workflow_transition_required_fields_verifier_workflow
	before insert or update on public.workflow_transition_required_fields
	for each row execute function app.workflow_transition_required_fields_verifier_workflow();

-- Le couple doit rester cohérent lorsque l'un de ses parents est déplacé après coup. Le verrou de
-- ligne pris par l'UPDATE et les `FOR SHARE` ci-dessus sérialisent aussi ces deux gestes concurrents.
create or replace function app.workflow_transition_required_fields_verifier_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.workflow_id is not distinct from old.workflow_id then
		return new;
	end if;

	if tg_table_name = 'workflow_transitions' and exists (
		select 1
		  from public.workflow_transition_required_fields trf
		  join public.form_fields f on f.id = trf.field_id
		 where trf.transition_id = old.id
		   and f.workflow_id <> new.workflow_id
	) then
		raise exception 'required_field_workflow_mismatch' using errcode = '23514';
	elsif tg_table_name = 'form_fields' and exists (
		select 1
		  from public.workflow_transition_required_fields trf
		  join public.workflow_transitions t on t.id = trf.transition_id
		 where trf.field_id = old.id
		   and t.workflow_id <> new.workflow_id
	) then
		raise exception 'required_field_workflow_mismatch' using errcode = '23514';
	end if;

	return new;
end;
$$;

alter function app.workflow_transition_required_fields_verifier_parent() owner to postgres;
revoke all on function app.workflow_transition_required_fields_verifier_parent()
	from public, anon, authenticated, service_role;

drop trigger if exists workflow_transitions_verifier_required_fields
	on public.workflow_transitions;
create trigger workflow_transitions_verifier_required_fields
	before update of workflow_id on public.workflow_transitions
	for each row execute function app.workflow_transition_required_fields_verifier_parent();

drop trigger if exists form_fields_verifier_required_fields
	on public.form_fields;
create trigger form_fields_verifier_required_fields
	before update of workflow_id on public.form_fields
	for each row execute function app.workflow_transition_required_fields_verifier_parent();

-- =============================================================================================
-- 4. RLS et privilèges
-- =============================================================================================

alter table public.workflow_transition_required_fields enable row level security;

drop policy if exists workflow_transition_required_fields_lecture_membre
	on public.workflow_transition_required_fields;
create policy workflow_transition_required_fields_lecture_membre
	on public.workflow_transition_required_fields for select to anon, authenticated
	using (exists (
		select 1
		  from public.workflow_transitions t
		 where t.id = transition_id
		   and app.is_workspace_member(t.workspace_id)
	));

drop policy if exists workflow_transition_required_fields_insertion_admin
	on public.workflow_transition_required_fields;
create policy workflow_transition_required_fields_insertion_admin
	on public.workflow_transition_required_fields for insert to authenticated
	with check (exists (
		select 1
		  from public.workflow_transitions t
		 where t.id = transition_id
		   and app.is_workspace_admin(t.workspace_id)
	));

drop policy if exists workflow_transition_required_fields_suppression_admin
	on public.workflow_transition_required_fields;
create policy workflow_transition_required_fields_suppression_admin
	on public.workflow_transition_required_fields for delete to authenticated
	using (exists (
		select 1
		  from public.workflow_transitions t
		 where t.id = transition_id
		   and app.is_workspace_admin(t.workspace_id)
	));

revoke all on table public.workflow_transition_required_fields
	from public, anon, authenticated, service_role;
grant select on table public.workflow_transition_required_fields to anon, authenticated;
grant insert, delete on table public.workflow_transition_required_fields to authenticated;
grant all privileges on table public.workflow_transition_required_fields to service_role;

-- =============================================================================================
-- 5. Empreinte canonique de composition et vue de divergence exacte
-- =============================================================================================

alter table public.workflows
	add column if not exists source_composition_fingerprint text;

do $$
declare
	type_inattendu text;
begin
	select format_type(a.atttypid, a.atttypmod)
	  into type_inattendu
	  from pg_attribute a
	 where a.attrelid = 'public.workflows'::regclass
	   and a.attname = 'source_composition_fingerprint'
	   and a.attnum > 0
	   and not a.attisdropped
	   and a.atttypid <> 'text'::regtype;

	if type_inattendu is not null then
		raise exception 'source_composition_fingerprint_type_inattendu: %', type_inattendu;
	end if;
end;
$$;

-- La colonne décrit uniquement les dérivations modernes. Un défaut ou un `NOT NULL` résiduel
-- inventerait une empreinte aux workflows sources et empêcherait de représenter les copies legacy.
alter table public.workflows
	alter column source_composition_fingerprint drop default,
	alter column source_composition_fingerprint drop not null;

alter table public.workflows
	drop constraint if exists workflows_source_composition_fingerprint_check;
alter table public.workflows
	add constraint workflows_source_composition_fingerprint_check
	check (
		source_composition_fingerprint is null
		or source_composition_fingerprint ~ '^[0-9a-f]{64}$'
	);

comment on column public.workflows.source_composition_fingerprint is
	'CRM-018 — SHA-256 canonique de la source au moment de la copie. NULL hors dérivation ou pour '
	'une copie antérieure à la migration 19, signalée à vérifier plutôt que déclarée identique.';

create or replace function app.workflow_composition_fingerprint(target_workflow_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
	select pg_catalog.encode(
		extensions.digest(
			pg_catalog.convert_to(
				pg_catalog.jsonb_build_object(
					'workflow', pg_catalog.jsonb_build_object(
						'id', w.id,
						'name', w.name,
						'scope', w.scope,
						'track_id', w.track_id,
						'is_default', w.is_default,
						'archived_at', w.archived_at
					),
					'steps', coalesce((
						select pg_catalog.jsonb_agg(
							pg_catalog.jsonb_build_object(
								'id', s.id,
								'node_id', s.node_id,
								'node_key', n.key,
								'node_label', n.label,
								'node_kind', n.kind,
								'node_color', n.color,
								'node_default_probability', n.default_probability,
								'node_default_stale_after_days', n.default_stale_after_days,
								'node_archived_at', n.archived_at,
								'position', s.position,
								'label_override', s.label_override,
								'probability_override', s.probability_override,
								'stale_after_days', s.stale_after_days,
								'is_initial', s.is_initial
							) order by s.id
						)
						  from public.workflow_steps s
						  join public.workflow_nodes_catalog n on n.id = s.node_id
						 where s.workflow_id = w.id
					), '[]'::jsonb),
					'transitions', coalesce((
						select pg_catalog.jsonb_agg(
							pg_catalog.jsonb_build_object(
								'id', t.id,
								'from_step_id', t.from_step_id,
								'to_step_id', t.to_step_id,
								'label', t.label,
								'require_comment', t.require_comment
							) order by t.id
						)
						  from public.workflow_transitions t
						 where t.workflow_id = w.id
					), '[]'::jsonb),
					'fields', coalesce((
						select pg_catalog.jsonb_agg(
							pg_catalog.jsonb_build_object(
								'id', f.id,
								'key', f.key,
								'label', f.label,
								'type', f.type,
								'options', f.options,
								'help_text', f.help_text,
								'position', f.position,
								'archived_at', f.archived_at
							) order by f.id
						)
						  from public.form_fields f
						 where f.workflow_id = w.id
					), '[]'::jsonb),
					'rules', coalesce((
						select pg_catalog.jsonb_agg(
							pg_catalog.jsonb_build_object(
								'field_id', r.field_id,
								'step_id', r.step_id,
								'visibility', r.visibility
							) order by r.field_id, r.step_id
						)
						  from public.form_field_rules r
						 where r.workflow_id = w.id
					), '[]'::jsonb),
					'required_fields', coalesce((
						select pg_catalog.jsonb_agg(
							pg_catalog.jsonb_build_object(
								'transition_id', rf.transition_id,
								'field_id', rf.field_id
							) order by rf.transition_id, rf.field_id
						)
						  from public.workflow_transition_required_fields rf
						  join public.workflow_transitions t on t.id = rf.transition_id
						 where t.workflow_id = w.id
					), '[]'::jsonb)
				)::text,
				'UTF8'
			),
			'sha256'
		),
		'hex'
	)
	  from public.workflows w
	 where w.id = target_workflow_id;
$$;

alter function app.workflow_composition_fingerprint(uuid) owner to postgres;
comment on function app.workflow_composition_fingerprint(uuid) is
	'CRM-018 — docs/SPEC-transition-required-fields.md §5.2. SHA-256 canonique du workflow, de ses '
	'nœuds, étapes, transitions, champs, règles et exigences, hors horodatages techniques.';
revoke all on function app.workflow_composition_fingerprint(uuid)
	from public, anon, authenticated, service_role;
grant execute on function app.workflow_composition_fingerprint(uuid)
	to anon, authenticated, service_role;

drop view if exists public.workflow_derivations;
create view public.workflow_derivations with (security_invoker = true) as
select
	copie.id           as workflow_id,
	copie.workspace_id as workspace_id,
	copie.name         as name,
	copie.track_id     as track_id,
	copie.derived_at   as derived_at,
	source.id          as source_workflow_id,
	source.name        as source_name,
	source.archived_at as source_archived_at,
	greatest(
		source.updated_at,
		coalesce((select max(n.updated_at)
		                       from public.workflow_steps s
		                       join public.workflow_nodes_catalog n on n.id = s.node_id
		                      where s.workflow_id = source.id), source.updated_at),
		coalesce((select max(s.updated_at) from public.workflow_steps s
		                       where s.workflow_id = source.id), source.updated_at),
		coalesce((select max(t.updated_at) from public.workflow_transitions t
		                       where t.workflow_id = source.id), source.updated_at),
		coalesce((select max(f.updated_at) from public.form_fields f
		                       where f.workflow_id = source.id), source.updated_at),
		coalesce((select max(r.updated_at) from public.form_field_rules r
		                       where r.workflow_id = source.id), source.updated_at)
	) as source_modified_at,
	copie.source_composition_fingerprint,
	fingerprint.current_source_composition_fingerprint,
	copie.source_composition_fingerprint is distinct from
		fingerprint.current_source_composition_fingerprint as source_modified_since_copy
  from public.workflows copie
  join public.workflows source on source.id = copie.derived_from_workflow_id
  cross join lateral (
	select app.workflow_composition_fingerprint(source.id)
		as current_source_composition_fingerprint
  ) fingerprint;

comment on view public.workflow_derivations is
	'CRM-032, révisée par CRM-018 — divergence exacte par empreinte de composition ; une empreinte '
	'legacy NULL est signalée divergente. `security_invoker` conserve la RLS des sources.';

revoke all on table public.workflow_derivations from public, anon, authenticated, service_role;
grant select on table public.workflow_derivations to anon, authenticated, service_role;

-- =============================================================================================
-- 6. `copy_workflow_to_track` : composition complète, remappée et atomique
-- =============================================================================================

create or replace function public.copy_workflow_to_track(
	workflow_id uuid,
	track_id    uuid,
	new_name    text default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_source_id uuid := workflow_id;
	v_track_id  uuid := track_id;
	v_nom       text := new_name;
	v_source    public.workflows%rowtype;
	v_copie_id  uuid;
	v_fingerprint text;
	v_attendu     bigint;
	v_insere      bigint;
begin
	select w.* into v_source
	  from public.workflows w
	 where w.id = v_source_id
	   and w.archived_at is null
	   and app.is_workspace_member(w.workspace_id)
	 for share;

	if not found then
		raise exception 'workflow_not_found';
	end if;

	if not app.is_workspace_admin(v_source.workspace_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	if v_source.scope <> 'global' then
		raise exception 'workflow_not_global';
	end if;

	perform 1
	  from public.tracks t
	 where t.id = v_track_id
	   and t.workspace_id = v_source.workspace_id
	   and t.archived_at is null
	 for share;

	if not found then
		 raise exception 'track_not_found';
	end if;

	-- Le geste est rare et administratif. SHARE ROW EXCLUSIVE stabilise la composition et
	-- sérialise deux copies concurrentes : deux verrous SHARE suivis d'INSERT se bloqueraient
	-- mutuellement lors de leur promotion en ROW EXCLUSIVE.
	lock table public.workflow_nodes_catalog,
	           public.workflow_steps,
	           public.workflow_transitions,
	           public.form_fields,
	           public.form_field_rules,
	           public.workflow_transition_required_fields
		in share row exclusive mode;

	v_fingerprint := app.workflow_composition_fingerprint(v_source.id);
	if v_fingerprint is null then
		raise exception 'workflow_copy_fingerprint_failed';
	end if;

	insert into public.workflows (
		workspace_id, name, scope, track_id,
		derived_from_workflow_id, derived_at, source_composition_fingerprint, is_default
	)
	values (
		v_source.workspace_id, coalesce(v_nom, v_source.name), 'track', v_track_id,
		v_source.id, now(), v_fingerprint, false
	)
	returning id into v_copie_id;

	insert into public.workflow_steps (
		workflow_id, workspace_id, node_id, position,
		label_override, probability_override, stale_after_days, is_initial
	)
	select v_copie_id, s.workspace_id, s.node_id, s.position,
	       s.label_override, s.probability_override, s.stale_after_days, s.is_initial
	  from public.workflow_steps s
	 where s.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu from public.workflow_steps s where s.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: steps %/%', v_insere, v_attendu;
	end if;

	insert into public.workflow_transitions (
		workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment
	)
	select v_copie_id, t.workspace_id, copie_depuis.id, copie_vers.id,
	       t.label, t.require_comment
	  from public.workflow_transitions t
	  join public.workflow_steps source_depuis on source_depuis.id = t.from_step_id
	  join public.workflow_steps source_vers   on source_vers.id   = t.to_step_id
	  join public.workflow_steps copie_depuis
	    on copie_depuis.workflow_id = v_copie_id and copie_depuis.node_id = source_depuis.node_id
	  join public.workflow_steps copie_vers
	    on copie_vers.workflow_id = v_copie_id and copie_vers.node_id = source_vers.node_id
	 where t.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu
	  from public.workflow_transitions t where t.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: transitions %/%', v_insere, v_attendu;
	end if;

	insert into public.form_fields (
		workflow_id, workspace_id, key, label, type, options, help_text, position, archived_at
	)
	select v_copie_id, f.workspace_id, f.key, f.label, f.type, f.options, f.help_text,
	       f.position, f.archived_at
	  from public.form_fields f
	 where f.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu from public.form_fields f where f.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: fields %/%', v_insere, v_attendu;
	end if;

	insert into public.form_field_rules (
		field_id, step_id, workflow_id, workspace_id, visibility
	)
	select cible_champ.id, cible_etape.id, v_copie_id, r.workspace_id, r.visibility
	  from public.form_field_rules r
	  join public.form_fields source_champ on source_champ.id = r.field_id
	  join public.form_fields cible_champ
	    on cible_champ.workflow_id = v_copie_id and cible_champ.key = source_champ.key
	  join public.workflow_steps source_etape on source_etape.id = r.step_id
	  join public.workflow_steps cible_etape
	    on cible_etape.workflow_id = v_copie_id and cible_etape.node_id = source_etape.node_id
	 where r.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu
	  from public.form_field_rules r where r.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: rules %/%', v_insere, v_attendu;
	end if;

	insert into public.workflow_transition_required_fields (transition_id, field_id)
	select cible_transition.id, cible_champ.id
	  from public.workflow_transition_required_fields rf
	  join public.workflow_transitions source_transition on source_transition.id = rf.transition_id
	  join public.workflow_steps source_depart on source_depart.id = source_transition.from_step_id
	  join public.workflow_steps source_arrivee on source_arrivee.id = source_transition.to_step_id
	  join public.workflow_steps cible_depart
	    on cible_depart.workflow_id = v_copie_id and cible_depart.node_id = source_depart.node_id
	  join public.workflow_steps cible_arrivee
	    on cible_arrivee.workflow_id = v_copie_id and cible_arrivee.node_id = source_arrivee.node_id
	  join public.workflow_transitions cible_transition
	    on cible_transition.workflow_id = v_copie_id
	   and cible_transition.from_step_id = cible_depart.id
	   and cible_transition.to_step_id = cible_arrivee.id
	  join public.form_fields source_champ on source_champ.id = rf.field_id
	  join public.form_fields cible_champ
	    on cible_champ.workflow_id = v_copie_id and cible_champ.key = source_champ.key
	 where source_transition.workflow_id = v_source.id;
	get diagnostics v_insere = row_count;
	select count(*) into v_attendu
	  from public.workflow_transition_required_fields rf
	  join public.workflow_transitions t on t.id = rf.transition_id
	 where t.workflow_id = v_source.id;
	if v_insere <> v_attendu then
		raise exception 'workflow_copy_mapping_incomplete: required_fields %/%', v_insere, v_attendu;
	end if;

	return v_copie_id;
end;
$$;

alter function public.copy_workflow_to_track(uuid, uuid, text) owner to postgres;
comment on function public.copy_workflow_to_track(uuid, uuid, text) is
	'CRM-032, révisée par CRM-018 — copie atomiquement workflow, étapes, transitions, champs, '
	'règles et exigences remappées, avec empreinte de composition source.';
revoke all on function public.copy_workflow_to_track(uuid, uuid, text) from public, anon;
grant execute on function public.copy_workflow_to_track(uuid, uuid, text)
	to authenticated, service_role;

-- =============================================================================================
-- 7. `move_card` : sixième garde lue depuis la table de liaison
-- =============================================================================================

create or replace function public.move_card(
	card_id    uuid,
	to_step_id uuid,
	comment    text default null
) returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_card_id    uuid := card_id;
	v_cible      uuid := to_step_id;
	v_comment    text := nullif(btrim(comment), '');
	v_card       public.cards%rowtype;
	v_transition public.workflow_transitions%rowtype;
	v_manquants  text[];
begin
	select c.* into v_card
	  from public.cards c
	 where c.id = v_card_id
	   and c.archived_at is null
	   and c.deleted_at is null
	   and app.can_read_channel(c.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	if not app.can_write_channel(v_card.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	if not exists (
		select 1 from public.workflow_steps s
		 where s.id = v_cible and s.workflow_id = v_card.workflow_id
	) then
		raise exception 'step_not_in_workflow';
	end if;

	select t.* into v_transition
	  from public.workflow_transitions t
	 where t.workflow_id = v_card.workflow_id
	   and t.from_step_id = v_card.current_step_id
	   and t.to_step_id = v_cible;

	if not found then
		raise exception 'transition_not_allowed';
	end if;

	if v_transition.require_comment and v_comment is null then
		raise exception 'comment_required';
	end if;

	select array_agg(f.key order by f.position, f.key)
	  into v_manquants
	  from public.form_fields f
	 where f.workflow_id = v_card.workflow_id
	   and f.archived_at is null
	   and (
	       exists (
	           select 1
	             from public.form_field_rules r
	            where r.field_id = f.id
	              and r.step_id = v_cible
	              and r.visibility = 'required'
	       )
	       or exists (
	           select 1
	             from public.workflow_transition_required_fields trf
	            where trf.transition_id = v_transition.id
	              and trf.field_id = f.id
	       )
	   )
	   and not exists (
	       select 1
	         from public.card_field_values v
	        where v.card_id = v_card_id
	          and v.field_id = f.id
	          and not app.valeur_de_champ_est_vide(v.value)
	   );

	if v_manquants is not null and array_length(v_manquants, 1) > 0 then
		raise exception 'missing_required_fields'
			using detail = array_to_string(v_manquants, ', ');
	end if;

	update public.cards c
	   set current_step_id = v_cible,
	       entered_step_at = now(),
	       position = (
	           select coalesce(max(autre.position), 0) + 1
	             from public.cards autre
	            where autre.channel_id = v_card.channel_id
	              and autre.current_step_id = v_cible
	       )
	 where c.id = v_card_id
	returning c.* into v_card;

	return v_card;
end;
$$;

alter function public.move_card(uuid, uuid, text) owner to postgres;
comment on function public.move_card(uuid, uuid, text) is
	'CRM-034, étendue par CRM-036 et révisée par CRM-018 — seul chemin de changement d''étape, '
	'six gardes dont les champs liés par workflow_transition_required_fields.';
revoke all on function public.move_card(uuid, uuid, text) from public, anon;
grant execute on function public.move_card(uuid, uuid, text) to authenticated, service_role;

-- La définition canonique ci-dessus ne dépend plus de l'adaptateur de rejeu créé par CRM-036.
drop function if exists app.workflow_transition_required_field_ids(uuid);

-- Outil privé du fichier : aucune surface de migration générique ne reste dans le schéma.
drop function app.migration_0019_converger_contrainte(text, text, text);

notify pgrst, 'reload schema';
