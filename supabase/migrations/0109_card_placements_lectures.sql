-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.2 : les lectures (décision 705, option B). Les tables filles désignent le
--       rattachement, et les fonctions qui LISENT une colonne de rattachement lisent `card_placements`, signatures
--       inchangées. docs/SPEC-rattachements.md §2 bis.1 (les fonctions), §3.3 (valeurs par rattachement), §5 (timeline,
--       décision 670), §7 (messagerie), §10 (reprise), §14 ; docs/JOURNAL.md décisions 639, 642, 657, 670, 705
-- @spec docs/SCHEMA.md « Migration `0109` », §4 (card_field_values), §5 (card_events), §7 (card_sequence_enrollments) ;
--       docs/PROD_MIGRATIONS.md §3
--
-- CE QUE CETTE MIGRATION FAIT, ET CE QU'ELLE NE FAIT PAS. `card_field_values`, `card_events` et
-- `card_sequence_enrollments` reçoivent `placement_id`, repris pour l'existant et posé par déclencheur pour le neuf, à
-- partir du rattachement unique de l'affaire. Vingt fonctions qui lisaient une colonne de rattachement sur `cards` la
-- lisent sur `card_placements`, à résultat identique tant qu'une affaire n'a qu'un rattachement. `cards` reste le chemin
-- d'écriture, les gestes et leurs signatures ne changent pas (T2.3), aucune colonne ne quitte `cards` (T2.4).
--
-- IDEMPOTENCE. Les colonnes et contraintes sont conditionnelles, les reprises ne visent que les lignes sans
-- rattachement, et les fonctions sont des `create or replace`.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md). Sans perte : réappliquer les définitions des fonctions de la section 3
-- depuis leurs migrations d'origine, retirer les trois déclencheurs et leurs fonctions, puis les colonnes
-- `placement_id`. L'historique de `card_events` garde sinon une colonne de plus, qu'aucune lecture n'exige.

-- ===========================================================================================================
-- 1. Les deux auxiliaires
-- ===========================================================================================================

-- 1.1 Le rattachement d'une affaire, pour les tables filles qui le désignent. Le plus ancien : tant que la transition
--     dure, c'est le seul (index `card_placements_one_per_card_idx`, migration 0108).
create or replace function app.card_first_placement(card uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select p.id from public.card_placements p where p.card_id = card order by p.created_at, p.id limit 1;
$$;
revoke all on function app.card_first_placement(uuid) from public, anon;
grant execute on function app.card_first_placement(uuid) to authenticated, service_role;

-- 1.2 Une affaire est ACTIVE au sens du courrier et des relances si l'un de ses rattachements n'est pas archivé (§3.1).
--     La corbeille se juge à part, sur `cards.deleted_at`, comme avant.
create or replace function app.card_has_active_placement(card uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.card_placements p where p.card_id = card and p.archived_at is null);
$$;
revoke all on function app.card_has_active_placement(uuid) from public, anon;
grant execute on function app.card_has_active_placement(uuid) to authenticated, service_role;

-- ===========================================================================================================
-- 2. Les tables filles désignent le rattachement
-- ===========================================================================================================

-- 2.1 Le déclencheur commun : une ligne sans `placement_id` reçoit le rattachement de son affaire. Une affaire sans
--     rattachement est une reprise manquée, et le dire vaut mieux qu'une ligne orpheline.
create or replace function app.fill_placement_from_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.placement_id is null then
		new.placement_id := app.card_first_placement(new.card_id);
		if new.placement_id is null then
			raise exception 'card_placement_missing'
				using errcode = 'P0001',
				      detail  = format('L''affaire %s n''a pas de rattachement.', new.card_id);
		end if;
	end if;
	return new;
end;
$$;
revoke all on function app.fill_placement_from_card() from public, anon, authenticated;

-- 2.2 `card_field_values` : les valeurs appartiennent au rattachement (§3.3, décision 642, arbitrage 2). La présence est
--     tenue par une CONTRAINTE et non par `NOT NULL`, et c'est voulu : la webapp écrit encore ses valeurs par `upsert`
--     sans `placement_id`, et un `NOT NULL` le rendrait obligatoire dans les types générés. T2.3, qui passe ces écritures
--     au rattachement, pose le `NOT NULL` et la clé `(placement_id, field_id)`.
alter table public.card_field_values add column if not exists placement_id uuid;
update public.card_field_values v
   set placement_id = app.card_first_placement(v.card_id)
 where v.placement_id is null;
alter table public.card_field_values drop constraint if exists card_field_values_placement_present;
alter table public.card_field_values add constraint card_field_values_placement_present check (placement_id is not null);
alter table public.card_field_values drop constraint if exists card_field_values_placement_card_fk;
alter table public.card_field_values add constraint card_field_values_placement_card_fk
	foreign key (placement_id, card_id) references public.card_placements (id, card_id) on delete cascade;
create index if not exists card_field_values_placement_idx on public.card_field_values (placement_id);
drop trigger if exists card_field_values_fill_placement on public.card_field_values;
create trigger card_field_values_fill_placement
	before insert on public.card_field_values
	for each row execute function app.fill_placement_from_card();

-- 2.3 `card_sequence_enrollments` : une cadence s'inscrit à un rattachement (décision 657, arbitrage 2). Aucun client
--     n'écrit la table — `armer_sequence_relance` est le seul chemin —, le `NOT NULL` ne gêne donc aucun appelant.
alter table public.card_sequence_enrollments add column if not exists placement_id uuid;
update public.card_sequence_enrollments e
   set placement_id = app.card_first_placement(e.card_id)
 where e.placement_id is null;
alter table public.card_sequence_enrollments alter column placement_id set not null;
alter table public.card_sequence_enrollments drop constraint if exists card_sequence_enrollments_placement_fk;
alter table public.card_sequence_enrollments add constraint card_sequence_enrollments_placement_fk
	foreign key (placement_id, card_id) references public.card_placements (id, card_id) on delete cascade;
create index if not exists card_sequence_enrollments_placement_idx on public.card_sequence_enrollments (placement_id);
drop trigger if exists card_sequence_enrollments_fill_placement on public.card_sequence_enrollments;
create trigger card_sequence_enrollments_fill_placement
	before insert on public.card_sequence_enrollments
	for each row execute function app.fill_placement_from_card();

-- 2.4 `card_events` : le rattachement des seuls événements de rattachement (§5). Aucune clé étrangère, et c'est voulu :
--     un événement est immuable et survit à son rattachement — retirer un rattachement (T3) ne peut ni effacer ni
--     modifier l'historique.
alter table public.card_events add column if not exists placement_id uuid;
create index if not exists card_events_placement_idx on public.card_events (placement_id) where placement_id is not null;

create or replace function app.card_events_fill_placement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.placement_id is null
	   and new.type in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	                    'snoozed', 'woken', 'stalled', 'field_changed') then
		new.placement_id := app.card_first_placement(new.card_id);
		if new.placement_id is null then
			raise exception 'card_placement_missing'
				using errcode = 'P0001',
				      detail  = format('L''affaire %s n''a pas de rattachement.', new.card_id);
		end if;
	end if;
	return new;
end;
$$;
revoke all on function app.card_events_fill_placement() from public, anon, authenticated;

drop trigger if exists card_events_fill_placement on public.card_events;
create trigger card_events_fill_placement
	before insert on public.card_events
	for each row execute function app.card_events_fill_placement();

-- L'UNIQUE EXCEPTION À L'IMMUABILITÉ (décision 670, docs/SPEC-rattachements.md §5) : le déclencheur
-- `card_events_refuser_maj` est suspendu le temps d'une seule instruction, qui n'écrit que `placement_id` sur les
-- événements de rattachement qui n'en ont pas, puis réactivé. LA GARDE : l'empreinte de chaque événement, hors
-- `placement_id`, est prise avant et comparée après ; un seul écart annule la migration entière.
do $evenements$
declare
	v_avant_nombre    bigint;
	v_avant_empreinte text;
	v_apres_nombre    bigint;
	v_apres_empreinte text;
begin
	if not exists (select 1 from public.card_events e
	                where e.placement_id is null
	                  and e.type in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived',
	                                 'unarchived', 'snoozed', 'woken', 'stalled', 'field_changed')) then
		return;
	end if;

	select count(*), md5(string_agg(md5(row(e.id, e.card_id, e.workspace_id, e.type, e.actor_id, e.payload,
	                                        e.created_at)::text), '' order by e.id))
	  into v_avant_nombre, v_avant_empreinte
	  from public.card_events e;

	alter table public.card_events disable trigger card_events_refuser_maj;
	update public.card_events e
	   set placement_id = app.card_first_placement(e.card_id)
	 where e.placement_id is null
	   and e.type in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	                  'snoozed', 'woken', 'stalled', 'field_changed');
	alter table public.card_events enable trigger card_events_refuser_maj;

	select count(*), md5(string_agg(md5(row(e.id, e.card_id, e.workspace_id, e.type, e.actor_id, e.payload,
	                                        e.created_at)::text), '' order by e.id))
	  into v_apres_nombre, v_apres_empreinte
	  from public.card_events e;
	if v_apres_nombre <> v_avant_nombre or v_apres_empreinte is distinct from v_avant_empreinte then
		raise exception 'card_events_altered'
			using errcode = 'P0001',
			      detail  = 'Le remplissage de placement_id a modifié autre chose que placement_id : migration annulée.';
	end if;
end
$evenements$;

-- Le contrat de la timeline : un événement de rattachement désigne un rattachement, un événement de l'affaire n'en
-- désigne aucun.
alter table public.card_events drop constraint if exists card_events_placement_by_type;
alter table public.card_events add constraint card_events_placement_by_type check (
	(type in ('moved', 'assigned', 'channel_changed', 'workflow_changed', 'archived', 'unarchived',
	          'snoozed', 'woken', 'stalled', 'field_changed')) = (placement_id is not null));

-- ===========================================================================================================
-- 3. Les lectures : vingt fonctions lisent `card_placements` (docs/SPEC-rattachements.md §2 bis.1)
-- ===========================================================================================================
-- Chacune est reprise de sa définition en base, à l'identique hors des lignes qui lisaient une colonne de
-- rattachement sur `cards`. Signatures, sécurité et privilèges inchangés : `create or replace` les conserve.
-- Les lectures d'une affaire « dans son channel » prennent son PREMIER rattachement, le seul pendant la transition ;
-- les tranches T4 à T6 décident de leur forme à plusieurs rattachements.

-- app.can_read_card_pour — Lire une affaire, c'est lire AU MOINS UN de ses rattachements, archivés compris (décision 642, arbitrage 1).
CREATE OR REPLACE FUNCTION app.can_read_card_pour(card uuid, p_user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	select exists (
		select 1 from public.card_placements p
		 where p.card_id = card
		   and app.can_read_channel_pour(p.channel_id, p_user));
$function$;

-- app.can_write_card — Écrire la partie commune d'une affaire, c'est écrire AU MOINS UN de ses channels (décision 639, arbitrage 3).
CREATE OR REPLACE FUNCTION app.can_write_card(card uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	select exists (
		select 1 from public.card_placements p
		 where p.card_id = card
		   and app.can_write_channel(p.channel_id));
$function$;

-- public.ecriture_permise — La colonne calculée de l'interface (`CRM-093`) suit la même règle que la politique de mise à jour.
CREATE OR REPLACE FUNCTION public.ecriture_permise(c cards)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
	select app.can_write_card(c.id);
$function$;

-- app.catalogue_refuser_archivage_noeud_occupe — Un nœud est occupé si un RATTACHEMENT actif s'y trouve, d'une affaire hors de la corbeille.
CREATE OR REPLACE FUNCTION app.catalogue_refuser_archivage_noeud_occupe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	occupantes integer;
begin
	if old.archived_at is null and new.archived_at is not null then
		select count(*) into occupantes
		  from public.card_placements pl
		  join public.cards c on c.id = pl.card_id
		  join public.workflow_steps s on s.id = pl.current_step_id
		 where s.node_id      = new.id
		   and pl.archived_at is null
		   and c.deleted_at  is null;

		if occupantes > 0 then
			raise exception
				'node_occupied : % card(s) active(s) se trouvent encore sur ce nœud', occupantes
				using errcode = 'insufficient_privilege';
		end if;
	end if;

	return new;
end;
$function$;

-- app.defauts_proposition_ia — L'occupation d'une étape se compte en rattachements.
CREATE OR REPLACE FUNCTION app.defauts_proposition_ia(p_workspace uuid, p_proposition jsonb, p_workflow uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	defauts    jsonb := '[]'::jsonb;
	cle_forme  constant text := '^[a-z0-9]+(-[a-z0-9]+)*$';
	vivants    text[];
	archives   text[];
	proposes   text[] := '{}';
	vises      text[] := '{}';
	etapes     text[] := '{}';
	aretes     text[] := '{}';
	champs     text[] := '{}';
	couples    text[] := '{}';
	liaisons   text[] := '{}';
	e          record;
	c          record;
	cle        text;
	initiales  integer;
	vus        text[];
	-- `CRM-097` T3 (décision 620) : la composition vivante du workflow ciblé, pour une modification.
	vivantes   text[] := '{}';
	retirees   text[] := '{}';
	cibles     text[] := '{}';
	origines   text[] := '{}';
	r          record;
	-- `CRM-113` (docs/SPEC-ia.md §14.5) : les champs vivants du workflow ciblé, que le défaut `native_field` épargne.
	champs_vivants text[] := '{}';
	natif      text;
begin
	if not app.proposition_ia_bien_formee(p_proposition) then
		raise exception 'proposition mal formee' using errcode = '22023';
	end if;

	select coalesce(array_agg(n.key) filter (where n.archived_at is null), '{}'),
	       coalesce(array_agg(n.key) filter (where n.archived_at is not null), '{}')
	  into vivants, archives
	  from public.workflow_nodes_catalog n
	 where n.workspace_id = p_workspace;

	if btrim(p_proposition -> 'workflow' ->> 'nom') = '' then
		defauts := defauts || jsonb_build_object('code', 'nom_absent', 'chemin', 'workflow.nom', 'valeurs', '{}'::jsonb);
	end if;

	-- Les nœuds proposés.
	select coalesce(array_agg(x ->> 'noeud'), '{}') into vises from jsonb_array_elements(p_proposition -> 'etapes') x;
	for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'noeuds') with ordinality loop
		cle := e.v ->> 'cle';
		if cle !~ cle_forme then
			defauts := defauts || jsonb_build_object('code', 'cle_invalide', 'chemin', format('noeuds[%s].cle', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if cle = any (proposes) then
			defauts := defauts || jsonb_build_object('code', 'noeud_en_double', 'chemin', format('noeuds[%s]', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if cle = any (vivants) then
			defauts := defauts || jsonb_build_object('code', 'noeud_deja_au_catalogue', 'chemin', format('noeuds[%s]', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if cle = any (archives) then
			defauts := defauts || jsonb_build_object('code', 'noeud_archive', 'chemin', format('noeuds[%s]', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if btrim(e.v ->> 'libelle') = '' then
			defauts := defauts || jsonb_build_object('code', 'libelle_absent', 'chemin', format('noeuds[%s].libelle', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if (e.v ->> 'nature') not in ('open', 'won', 'lost') then
			defauts := defauts || jsonb_build_object('code', 'nature_invalide', 'chemin', format('noeuds[%s].nature', e.i), 'valeurs', jsonb_build_object('cle', cle, 'nature', e.v ->> 'nature'));
		end if;
		if jsonb_typeof(e.v -> 'probabilite') is distinct from 'number'
		   or (e.v ->> 'probabilite')::numeric not between 0 and 100 then
			defauts := defauts || jsonb_build_object('code', 'probabilite_invalide', 'chemin', format('noeuds[%s].probabilite', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if not (cle = any (vises)) then
			defauts := defauts || jsonb_build_object('code', 'noeud_inutilise', 'chemin', format('noeuds[%s]', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		proposes := proposes || cle;
	end loop;

	-- Les étapes : chacune vise un nœud connu et vivant, une seule fois ; exactement une est initiale.
	if jsonb_array_length(p_proposition -> 'etapes') = 0 then
		defauts := defauts || jsonb_build_object('code', 'aucune_etape', 'chemin', 'etapes', 'valeurs', '{}'::jsonb);
	end if;
	for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'etapes') with ordinality loop
		cle := e.v ->> 'noeud';
		if cle = any (etapes) then
			defauts := defauts || jsonb_build_object('code', 'etape_en_double', 'chemin', format('etapes[%s]', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if not (cle = any (proposes)) and cle = any (archives) then
			defauts := defauts || jsonb_build_object('code', 'noeud_archive', 'chemin', format('etapes[%s].noeud', e.i), 'valeurs', jsonb_build_object('cle', cle));
		elsif not (cle = any (proposes)) and not (cle = any (vivants)) then
			defauts := defauts || jsonb_build_object('code', 'noeud_inconnu', 'chemin', format('etapes[%s].noeud', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		etapes := etapes || cle;
	end loop;
	select count(*) into initiales from jsonb_array_elements(p_proposition -> 'etapes') x where (x -> 'initiale') = 'true'::jsonb;
	if jsonb_array_length(p_proposition -> 'etapes') > 0 and initiales <> 1 then
		defauts := defauts || jsonb_build_object('code', 'etape_initiale', 'chemin', 'etapes', 'valeurs', jsonb_build_object('nombre', initiales));
	end if;
	-- `CRM-113` (docs/SPEC-ia.md §14.3) : une probabilité d'étape NON NULLE hors de 0 à 100. Rendue après `etape_initiale`.
	for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'etapes') with ordinality loop
		if jsonb_typeof(e.v -> 'probability') = 'number' and (e.v ->> 'probability')::numeric not between 0 and 100 then
			defauts := defauts || jsonb_build_object('code', 'step_probability_invalid', 'chemin', format('etapes[%s].probability', e.i),
				'valeurs', jsonb_build_object('key', e.v ->> 'noeud'));
		end if;
	end loop;

	-- Les transitions : entre deux étapes de la proposition, distinctes, une fois chacune, nommées.
	for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'transitions') with ordinality loop
		if not ((e.v ->> 'de') = any (etapes)) or not ((e.v ->> 'vers') = any (etapes)) then
			defauts := defauts || jsonb_build_object('code', 'transition_etape_absente', 'chemin', format('transitions[%s]', e.i), 'valeurs', jsonb_build_object('de', e.v ->> 'de', 'vers', e.v ->> 'vers'));
		end if;
		if (e.v ->> 'de') = (e.v ->> 'vers') then
			defauts := defauts || jsonb_build_object('code', 'transition_boucle', 'chemin', format('transitions[%s]', e.i), 'valeurs', jsonb_build_object('cle', e.v ->> 'de'));
		end if;
		if format('%s>%s', e.v ->> 'de', e.v ->> 'vers') = any (aretes) then
			defauts := defauts || jsonb_build_object('code', 'transition_en_double', 'chemin', format('transitions[%s]', e.i), 'valeurs', jsonb_build_object('de', e.v ->> 'de', 'vers', e.v ->> 'vers'));
		end if;
		-- Pour une MODIFICATION, un libellé vide vaut l'absence de libellé propre — la transition prend celui de son
		-- étape d'arrivée, comme dans l'éditeur (docs/SPEC-ia.md §13.1). Pour une création, c'est un défaut.
		if p_workflow is null and btrim(e.v ->> 'libelle') = '' then
			defauts := defauts || jsonb_build_object('code', 'transition_sans_libelle', 'chemin', format('transitions[%s].libelle', e.i), 'valeurs', jsonb_build_object('de', e.v ->> 'de', 'vers', e.v ->> 'vers'));
		end if;
		aretes := aretes || format('%s>%s', e.v ->> 'de', e.v ->> 'vers');
	end loop;

	-- Les champs : une clé de la forme, unique, un libellé, un type connu, ses options.
	if p_workflow is not null then
		select coalesce(array_agg(f.key), '{}') into champs_vivants
		  from public.form_fields f
		 where f.workflow_id = p_workflow and f.archived_at is null;
	end if;
	for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'champs') with ordinality loop
		cle := e.v ->> 'cle';
		if cle !~ cle_forme then
			defauts := defauts || jsonb_build_object('code', 'cle_invalide', 'chemin', format('champs[%s].cle', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if cle = any (champs) then
			defauts := defauts || jsonb_build_object('code', 'champ_en_double', 'chemin', format('champs[%s]', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		-- `CRM-113` (docs/SPEC-ia.md §14.5) : un champ NOUVEAU qui doublonne une information native de l'affaire, par sa
		-- clé ou par son libellé mis à la forme des clés ; comparaison EXACTE. Un champ vivant conservé n'est jamais relevé.
		if not (cle = any (champs_vivants)) then
			select coalesce(
				(select n.native_field from app.reserved_native_fields() n where n.key = cle),
				(select n.native_field from app.reserved_native_fields() n where n.key = app.cle_de_libelle_ia(e.v ->> 'libelle')))
			  into natif;
			if natif is not null then
				defauts := defauts || jsonb_build_object('code', 'native_field', 'chemin', format('champs[%s]', e.i),
					'valeurs', jsonb_build_object('key', cle, 'native', natif));
			end if;
		end if;
		if btrim(e.v ->> 'libelle') = '' then
			defauts := defauts || jsonb_build_object('code', 'libelle_absent', 'chemin', format('champs[%s].libelle', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if (e.v ->> 'type') not in ('text', 'textarea', 'number', 'money', 'date', 'datetime', 'select', 'multiselect',
		                            'checkbox', 'url', 'email', 'phone', 'user', 'contact', 'file') then
			defauts := defauts || jsonb_build_object('code', 'type_inconnu', 'chemin', format('champs[%s].type', e.i), 'valeurs', jsonb_build_object('cle', cle, 'type', e.v ->> 'type'));
		end if;
		if (e.v ->> 'type') in ('select', 'multiselect') then
			if jsonb_typeof(e.v -> 'choix') is distinct from 'array' or jsonb_array_length(e.v -> 'choix') = 0 then
				defauts := defauts || jsonb_build_object('code', 'choix_requis', 'chemin', format('champs[%s].choix', e.i), 'valeurs', jsonb_build_object('cle', cle));
			else
				vus := '{}';
				for c in select value as libelle from jsonb_array_elements_text(e.v -> 'choix') loop
					if app.cle_de_libelle_ia(c.libelle) = '' or app.cle_de_libelle_ia(c.libelle) = any (vus) then
						defauts := defauts || jsonb_build_object('code', 'choix_invalide', 'chemin', format('champs[%s].choix', e.i), 'valeurs', jsonb_build_object('cle', cle, 'choix', c.libelle));
					end if;
					vus := vus || app.cle_de_libelle_ia(c.libelle);
				end loop;
			end if;
		end if;
		if (e.v ->> 'type') = 'money' and coalesce(e.v ->> 'devise', '') !~ '^[A-Z]{3}$' then
			defauts := defauts || jsonb_build_object('code', 'devise_requise', 'chemin', format('champs[%s].devise', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		champs := champs || cle;
	end loop;

	-- Les règles de visibilité.
	for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'regles') with ordinality loop
		if not ((e.v ->> 'champ') = any (champs)) then
			defauts := defauts || jsonb_build_object('code', 'regle_champ_absent', 'chemin', format('regles[%s].champ', e.i), 'valeurs', jsonb_build_object('cle', e.v ->> 'champ'));
		end if;
		if not ((e.v ->> 'etape') = any (etapes)) then
			defauts := defauts || jsonb_build_object('code', 'regle_etape_absente', 'chemin', format('regles[%s].etape', e.i), 'valeurs', jsonb_build_object('cle', e.v ->> 'etape'));
		end if;
		if format('%s@%s', e.v ->> 'champ', e.v ->> 'etape') = any (couples) then
			defauts := defauts || jsonb_build_object('code', 'regle_en_double', 'chemin', format('regles[%s]', e.i), 'valeurs', jsonb_build_object('champ', e.v ->> 'champ', 'etape', e.v ->> 'etape'));
		end if;
		if (e.v ->> 'visibilite') not in ('hidden', 'visible', 'required') then
			defauts := defauts || jsonb_build_object('code', 'visibilite_invalide', 'chemin', format('regles[%s].visibilite', e.i), 'valeurs', jsonb_build_object('visibilite', e.v ->> 'visibilite'));
		end if;
		couples := couples || format('%s@%s', e.v ->> 'champ', e.v ->> 'etape');
	end loop;

	-- Les exigences de transition.
	for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'exigences') with ordinality loop
		if not (format('%s>%s', e.v ->> 'de', e.v ->> 'vers') = any (aretes)) then
			defauts := defauts || jsonb_build_object('code', 'exigence_transition_absente', 'chemin', format('exigences[%s]', e.i), 'valeurs', jsonb_build_object('de', e.v ->> 'de', 'vers', e.v ->> 'vers'));
		end if;
		if not ((e.v ->> 'champ') = any (champs)) then
			defauts := defauts || jsonb_build_object('code', 'exigence_champ_absent', 'chemin', format('exigences[%s].champ', e.i), 'valeurs', jsonb_build_object('cle', e.v ->> 'champ'));
		end if;
		if format('%s>%s@%s', e.v ->> 'de', e.v ->> 'vers', e.v ->> 'champ') = any (liaisons) then
			defauts := defauts || jsonb_build_object('code', 'exigence_en_double', 'chemin', format('exigences[%s]', e.i), 'valeurs', jsonb_build_object('de', e.v ->> 'de', 'vers', e.v ->> 'vers', 'champ', e.v ->> 'champ'));
		end if;
		liaisons := liaisons || format('%s>%s@%s', e.v ->> 'de', e.v ->> 'vers', e.v ->> 'champ');
	end loop;

	-- Les cinq codes d'une MODIFICATION (docs/SPEC-ia.md §13.3), dans l'ordre de la spécification.
	if p_workflow is not null then
		for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'champs') with ordinality loop
			select f.type into cle
			  from public.form_fields f
			 where f.workflow_id = p_workflow and f.archived_at is null and f.key = e.v ->> 'cle';
			if found and cle <> (e.v ->> 'type') then
				defauts := defauts || jsonb_build_object('code', 'type_non_modifiable', 'chemin', format('champs[%s].type', e.i),
					'valeurs', jsonb_build_object('cle', e.v ->> 'cle', 'type', e.v ->> 'type'));
			end if;
		end loop;

		select coalesce(array_agg(n.key), '{}') into vivantes
		  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
		 where s.workflow_id = p_workflow;
		select coalesce(array_agg(v), '{}') into retirees from unnest(vivantes) v where not (v = any (etapes));
		select coalesce(array_agg(x ->> 'de'), '{}') into origines
		  from jsonb_array_elements(coalesce(p_proposition -> 'remappages', '[]'::jsonb)) x;

		-- Une étape retirée qui porte des affaires sans remappage : AUCUNE destination n'est devinée. Les affaires
		-- archivées et en corbeille comptent (règle du §7 ter.12.5 du moteur).
		for r in
			select n.key as cle, s.position,
			       (select count(*) from public.card_placements carte where carte.current_step_id = s.id) as nombre
			  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
			 where s.workflow_id = p_workflow and n.key = any (retirees)
			 order by s.position, s.id
		loop
			if r.nombre > 0 and not (r.cle = any (origines)) then
				defauts := defauts || jsonb_build_object('code', 'remappage_requis', 'chemin', 'remappages',
					'valeurs', jsonb_build_object('cle', r.cle, 'affaires', r.nombre));
			end if;
		end loop;
	end if;

	for e in select value as v, ordinality - 1 as i
	           from jsonb_array_elements(coalesce(p_proposition -> 'remappages', '[]'::jsonb)) with ordinality loop
		if not ((e.v ->> 'de') = any (retirees)) then
			defauts := defauts || jsonb_build_object('code', 'remappage_origine_inconnue', 'chemin', format('remappages[%s].de', e.i),
				'valeurs', jsonb_build_object('cle', e.v ->> 'de'));
		end if;
		if not ((e.v ->> 'vers') = any (etapes)) then
			defauts := defauts || jsonb_build_object('code', 'remappage_cible_absente', 'chemin', format('remappages[%s].vers', e.i),
				'valeurs', jsonb_build_object('de', e.v ->> 'de', 'vers', e.v ->> 'vers'));
		end if;
		if (e.v ->> 'de') = any (cibles) then
			defauts := defauts || jsonb_build_object('code', 'remappage_en_double', 'chemin', format('remappages[%s]', e.i),
				'valeurs', jsonb_build_object('cle', e.v ->> 'de'));
		end if;
		cibles := cibles || (e.v ->> 'de');
	end loop;

	return defauts;
end;
$function$;

-- public.previsualiser_exigence — Les affaires concernées par une exigence sont les rattachements actifs à l'étape ou sur le chemin.
CREATE OR REPLACE FUNCTION public.previsualiser_exigence(p_field_id uuid, p_step_id uuid DEFAULT NULL::uuid, p_transition_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(sur_place bigint, a_l_entree bigint)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	v_champ_actif boolean;
begin
	-- EXACTEMENT UNE CIBLE. Zéro compterait un ensemble que personne n'a demandé ; deux rendraient
	-- un nombre dont on ne saurait pas de quel geste il parle (§7 bis.13.3).
	if (p_step_id is null) = (p_transition_id is null) then
		raise exception 'previsualisation_cible'
			using errcode = 'P0001',
			      detail  = 'Fournir exactement une cible : une étape OU une transition, jamais les deux, jamais aucune.';
	end if;

	-- UN CHAMP ARCHIVÉ REND `0, 0`, et un champ inconnu aussi. La sixième garde filtre
	-- `f.archived_at is null` : l'exigence serait sans effet, et annoncer un nombre reviendrait à
	-- promettre une contrainte que `move_card` n'appliquerait jamais. Une cible inconnue ne lève
	-- PAS : c'est une course ordinaire entre la lecture de l'écran et l'appel, et l'écriture qui
	-- suit la signalera elle-même par son `23503`.
	select exists (
		select 1
		  from public.form_fields f
		 where f.id = p_field_id
		   and f.archived_at is null
	) into v_champ_actif;

	if not v_champ_actif then
		return query select 0::bigint, 0::bigint;
		return;
	end if;

	return query
	select
		-- SUR PLACE — les affaires DÉJÀ à l'étape visée. Elles ne sont jamais chassées (§5.7) :
		-- leur fiche signalera un manque. Toujours `0` pour une cible de transition, qui ne porte
		-- pas sur une étape mais sur un chemin.
		coalesce((
			select count(*)
			  from public.card_placements c
			 where p_step_id is not null
			   and c.current_step_id = p_step_id
			   and c.archived_at is null
			   and not exists (
			       select 1
			         from public.card_field_values v
			        where v.card_id = c.card_id
			          and v.field_id = p_field_id
			          and not app.valeur_de_champ_est_vide(v.value)
			   )
		), 0)::bigint,
		-- À L'ENTRÉE — les affaires qui, depuis leur étape courante, empruntent un chemin menant à
		-- la cible, et dont le champ est vide. `count(distinct c.id)` et non `count(*)` : cinq
		-- arêtes du seed mènent à `Perdu`, et une affaire qui en emprunte deux ne compte qu'une
		-- fois (§7 bis.13.3).
		coalesce((
			select count(distinct c.id)
			  from public.workflow_transitions t
			  join public.card_placements c
			    on c.current_step_id = t.from_step_id
			   and c.archived_at is null
			 where (
			       (p_step_id is not null and t.to_step_id = p_step_id)
			    or (p_transition_id is not null and t.id = p_transition_id)
			   )
			   and not exists (
			       select 1
			         from public.card_field_values v
			        where v.card_id = c.card_id
			          and v.field_id = p_field_id
			          and not app.valeur_de_champ_est_vide(v.value)
			   )
		), 0)::bigint;
end;
$function$;

-- public.occupation_du_workflow — L'occupation d'une étape se compte en rattachements.
CREATE OR REPLACE FUNCTION public.occupation_du_workflow(p_workflow uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	select coalesce(jsonb_object_agg(n.key, (select count(*) from public.card_placements c where c.current_step_id = s.id)), '{}'::jsonb)
	  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	 where s.workflow_id = p_workflow
$function$;

-- public.cards_figees — Une affaire figée l'est par son rattachement : étape, ancienneté, responsable, sommeil et archivage sont les siens.
CREATE OR REPLACE FUNCTION public.cards_figees()
 RETURNS TABLE(card_id uuid, workspace_id uuid, channel_id uuid, title text, owner_id uuid, step_id uuid, entered_step_at timestamp with time zone, seuil_jours integer, jours_dans_etape integer, retard_jours integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	select c.id,
	       c.workspace_id,
	       pl.channel_id,
	       c.title,
	       pl.owner_id,
	       ws.id,
	       pl.entered_step_at,
	       -- LE SEUIL EFFECTIF (§2.2) : celui de l'étape s'il est posé, sinon celui du nœud. Un
	       -- seuil absent n'est JAMAIS remplacé par un défaut — une étape sans seuil est une étape
	       -- dont personne n'a dit au bout de combien de temps elle est en retard. C'est la
	       -- résolution exacte de `resoudreEtape` dans `board.ts`.
	       coalesce(ws.stale_after_days, n.default_stale_after_days),
	       -- JOURS RÉVOLUS (§2.5), comme `Math.floor` sur des millisecondes dans `board.ts`.
	       floor(extract(epoch from (now() - pl.entered_step_at)) / 86400.0)::integer,
	       floor(extract(epoch from (now() - pl.entered_step_at)) / 86400.0)::integer
	         - coalesce(ws.stale_after_days, n.default_stale_after_days)
	  from public.cards c
	  join public.card_placements pl on pl.card_id = c.id
	  join public.workflow_steps ws on ws.id = pl.current_step_id
	  join public.workflow_nodes_catalog n on n.id = ws.node_id
	 -- LES TROIS EXCLUSIONS DU §2.4, et aucune quatrième.
	 --
	 -- Les nœuds terminaux (`kind` valant `won` ou `lost`) NE SONT PAS NOMMÉS ICI, et c'est une
	 -- décision écrite (§2.3) : ils ne portent aucun seuil au catalogue, donc la condition sur
	 -- `coalesce(...) is not null` les écarte déjà. Ajouter `kind not in ('won','lost')` créerait
	 -- une SECONDE définition de « terminal » à maintenir. La conséquence est assumée et figée par
	 -- une assertion : un administrateur qui poserait un seuil sur un nœud terminal rendrait ses
	 -- cards relançables — le §2.5 de `docs/SPEC-workflow-engine.md` lui en laisse le droit, et le
	 -- produit l'honore au lieu de le contredire en silence.
	 where pl.archived_at is null
	   and c.deleted_at is null
	   -- EN SOMMEIL : le prédicat d'`estEnSommeil` (`CRM-081` §16.2), au caractère près — non nul
	   -- ET STRICTEMENT postérieur. Une échéance ÉCHUE ne protège plus : la card est réveillée de
	   -- fait. Relancer une card encore endormie annulerait le seul geste que l'utilisateur a posé
	   -- contre les relances.
	   and (pl.snoozed_until is null or pl.snoozed_until <= now())
	   and coalesce(ws.stale_after_days, n.default_stale_after_days) is not null
	   and floor(extract(epoch from (now() - pl.entered_step_at)) / 86400.0)
	       >= coalesce(ws.stale_after_days, n.default_stale_after_days)
	 -- Le retard décroissant est le seul ordre que la donnée porte et que l'utilisateur attend ; le
	 -- titre départage, afin que deux appels successifs rendent la MÊME suite (§3.4).
	 order by 10 desc, c.title;
$function$;

-- public.entonnoir_conversion — L'entonnoir compte des rattachements : channel, étape, montant et probabilité sont les leurs.
CREATE OR REPLACE FUNCTION public.entonnoir_conversion()
 RETURNS TABLE(workspace_id uuid, track_id uuid, channel_id uuid, node_id uuid, node_key text, node_label text, node_kind text, node_position numeric, currency text, affaires integer, affaires_sans_montant integer, affaires_sans_probabilite integer, montant numeric, montant_pondere numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	select c.workspace_id,
	       ch.track_id,
	       pl.channel_id,
	       n.id,
	       n.key,
	       -- LE LIBELLÉ DU CATALOGUE, JAMAIS `workflow_steps.label_override` (§5.1). Une étape
	       -- renomme son nœud À L'INTÉRIEUR d'un workflow ; l'entonnoir compare des affaires À
	       -- TRAVERS les workflows — c'est la raison pour laquelle `docs/MASTER_PLAN.md` §2 pose que
	       -- cette unité exige le catalogue partagé de `CRM-030`. Rendre le libellé de l'étape ferait
	       -- porter deux noms à une même ligne dès que deux workflows renomment le même nœud.
	       n.label,
	       n.kind,
	       n."position",
	       c.currency,
	       count(*)::integer,
	       -- CE QUE LE TOTAL NE DIT PAS, ET QUE L'ÉCRAN DOIT DIRE (§7.3). Un montant absent n'est
	       -- pas zéro (`docs/SPEC-costs.md` §2.3) : l'affaire est comptée, et son absence l'est
	       -- séparément. Sans ces deux compteurs, un prévisionnel bas se lirait comme un
	       -- portefeuille pauvre au lieu d'un portefeuille mal renseigné.
	       count(*) filter (where pl.amount is null)::integer,
	       count(*) filter (
	           where coalesce(pl.probability_override,
	                          s.probability_override,
	                          n.default_probability) is null)::integer,
	       -- ARRONDI UNE SEULE FOIS, SUR LA SOMME (§5.1). `coalesce` enveloppe la somme et non
	       -- chaque terme : `sum` d'un ensemble entièrement nul rend NULL, et le contrat annonce un
	       -- nombre. Ce `coalesce`-ci ne remplace aucune valeur absente par un défaut — il nomme le
	       -- total d'un ensemble vide, qui est bien zéro.
	       round(coalesce(sum(pl.amount), 0), 2),
	       -- LE PONDÉRÉ N'EXISTE QUE SI LES DEUX EXISTENT (§3). Le `filter` porte sur les DEUX
	       -- conditions : un montant connu ET une probabilité effective connue. Écrire
	       -- `coalesce(probabilite, 0)` transformerait « personne n'a estimé cette affaire » en
	       -- « cette affaire ne vaut rien », et `coalesce(amount, 0)` ferait de même pour le montant.
	       -- La probabilité effective se résout à TROIS niveaux, le plus spécifique gagnant :
	       -- l'affaire, puis son étape, puis le nœud du catalogue. C'est la résolution exacte du
	       -- seuil d'ancienneté dans `public.cards_figees`, appliquée à une seconde colonne.
	       round(coalesce(sum(
	           pl.amount * coalesce(pl.probability_override,
	                               s.probability_override,
	                               n.default_probability) / 100.0
	       ) filter (
	           where pl.amount is not null
	             and coalesce(pl.probability_override,
	                          s.probability_override,
	                          n.default_probability) is not null
	       ), 0), 2)
	  from public.cards c
	  join public.card_placements pl on pl.card_id = c.id
	  join public.channels ch on ch.id = pl.channel_id
	  join public.workflow_steps s on s.id = pl.current_step_id
	  join public.workflow_nodes_catalog n on n.id = s.node_id
	 -- DEUX EXCLUSIONS, ET AUCUNE TROISIÈME (§4).
	 --
	 -- `snoozed_until` N'EST PAS NOMMÉE, et c'est une divergence VOULUE avec `public.cards_figees`,
	 -- qui exclut les cards encore endormies. Ici, rien n'est relancé : le sommeil dit « ne me
	 -- réveille pas », jamais « cette affaire n'est plus au portefeuille ». L'écarter ferait
	 -- disparaître un montant d'un total du seul fait qu'on a demandé le silence — la perte
	 -- silencieuse que `CLAUDE.md` §18 interdit. Figé par une assertion.
	 --
	 -- Les nœuds ARCHIVÉS du catalogue ne sont pas nommés non plus : `workflow_steps` les référence
	 -- en `ON DELETE RESTRICT` et `workflow_nodes_catalog_refuser_archivage_occupe` refuse
	 -- d'archiver un nœud occupé, si bien qu'un nœud archivé ne peut porter aucune affaire. Une
	 -- condition sur `archived_at` serait une condition sans objet.
	 where pl.archived_at is null
	   and c.deleted_at is null
	 group by c.workspace_id, ch.track_id, pl.channel_id,
	          n.id, n.key, n.label, n.kind, n."position", c.currency
	 -- L'ordre du catalogue est celui de l'entonnoir ; la devise et le channel départagent, afin que
	 -- deux appels successifs rendent la MÊME suite (§5.1).
	 order by n."position", c.currency, pl.channel_id;
$function$;

-- public.recherche_globale — Une affaire se trouve par son titre, sa description et la prochaine action de son premier rattachement.
CREATE OR REPLACE FUNCTION public.recherche_globale(p_terme text, p_limite integer DEFAULT 20)
 RETURNS TABLE(objet text, id uuid, workspace_id uuid, titre text, sous_titre text, extrait text, rang real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	v_mots    text;
	v_limite  integer;
	v_requete tsquery;
begin
	-- ------------------------------------------------------------------------------------
	-- 4.1 La borne — §6.6, et lignes *g* et *h* du §6.7
	-- ------------------------------------------------------------------------------------
	-- Bornée à 50 CÔTÉ SERVEUR, parce qu'un client peut demander ce qu'il veut. Une palette
	-- n'affiche pas cent lignes.
	v_limite := least(coalesce(p_limite, 0), 50);

	if v_limite <= 0 then
		return;
	end if;

	-- ------------------------------------------------------------------------------------
	-- 4.2 Le terme devient une requête — §6.2
	-- ------------------------------------------------------------------------------------
	-- Découpe sur toute suite de caractères NON alphanumériques. Les lettres accentuées sont
	-- alphanumériques dans la locale de la base et survivent au découpage — mesuré : « Audit
	-- Sécu!! » rend « audit », « sécu ».
	--
	-- L'ÉCHAPPEMENT EST STRUCTUREL, et ce n'est pas une précaution de style : après cette
	-- découpe, un fragment ne contient QUE des caractères alphanumériques. Aucun métacaractère
	-- de `tsquery` — & | ! ( ) : ' — ne peut donc atteindre `to_tsquery`, qui LÈVE UNE ERREUR
	-- sur une syntaxe invalide. Une erreur serveur à chaque frappe d'une palette serait un
	-- défaut visible.
	--
	-- Le suffixe `:*` fait la recherche par préfixe, sans laquelle une palette est inutile —
	-- « audi » doit trouver « Audit sécurité applicative » avant que l'utilisateur ait fini de
	-- taper. `to_tsquery` applique le dictionnaire — désaccentuation PUIS radicalisation —
	-- AVANT de poser le préfixe : mesuré, « societe:* » rend « 'societ':* » (§2 M7).
	--
	-- ` & ` et non ` | ` : CONJONCTION. Une palette qui rendrait l'union noierait la ligne
	-- cherchée dès le deuxième mot saisi.
	select coalesce(string_agg(mot || ':*', ' & '), '')
	  into v_mots
	  from unnest(regexp_split_to_array(lower(coalesce(p_terme, '')), '[^[:alnum:]]+')) as mot
	 where mot <> '';

	-- Lignes *d* et *e* du §6.7 : terme nul, vide, ou fait de blancs et de ponctuation.
	if v_mots = '' then
		return;
	end if;

	-- Ligne *f* du §6.7 : terme fait UNIQUEMENT de mots vides français (« le la de »).
	--
	-- Le contrôle passe par `to_tsvector` et NON par `to_tsquery`, et c'est mesuré (§2 M8) :
	-- `to_tsquery` émet un `NOTICE: text-search query contains only stop words` dès que sa
	-- requête ne porte aucun lexème. Ce n'est pas une erreur, mais ce serait une ligne de
	-- journal du serveur À CHAQUE FRAPPE d'une palette. `to_tsvector` emploie exactement les
	-- mêmes dictionnaires et n'émet rien.
	if to_tsvector('app.francais_sans_accent', p_terme) = ''::tsvector then
		return;
	end if;

	v_requete := to_tsquery('app.francais_sans_accent', v_mots);

	-- ------------------------------------------------------------------------------------
	-- 4.3 Les cinq familles — §4, §6.4
	-- ------------------------------------------------------------------------------------
	-- TOUTES LES JOINTURES DE CONTEXTE SONT EXTERNES, et le motif est celui de la décision 104
	-- de `CRM-012` : une jointure interne transformerait une politique de lecture absente sur la
	-- table de contexte en DISPARITION du résultat principal, c'est-à-dire un refus par
	-- accident. Le contexte manquant se dit par `null` ; la ligne, elle, reste.
	--
	-- `deleted_at is null` là où la colonne existe — ligne *i* du §6.7. Une affaire à la
	-- corbeille reste lisible par la RLS, c'est précisément ce qui permet de la restaurer
	-- (`CRM-077`) : l'exclure est une décision de la RECHERCHE, pas une conséquence de la
	-- sécurité. `contacts`, `organizations` et `mail_messages` ne portent pas la colonne.
	return query
	with resultats as (

		-- 4.3.1 `affaire`
		select
			'affaire'::text                                          as objet,
			c.id                                                     as id,
			c.workspace_id                                           as workspace_id,
			c.title                                                  as titre,
			ch.name                                                  as sous_titre,
			null::text                                               as extrait,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.title, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(pl.next_action, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.description, '')), 'C'),
				v_requete
			)                                                        as rang
		  from public.cards c
		  left join lateral (select pl.channel_id, pl.next_action from public.card_placements pl where pl.card_id = c.id order by pl.created_at, pl.id limit 1) pl on true
		  left join public.channels ch on ch.id = pl.channel_id
		 where c.deleted_at is null
		   and (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.title, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(pl.next_action, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(c.description, '')), 'C')
		   ) @@ v_requete

		union all

		-- 4.3.2 `contact`
		select
			'contact'::text,
			ct.id,
			ct.workspace_id,
			ct.full_name,
			coalesce(o.name, ct.email),
			null::text,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.full_name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.email, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.role_title, '')), 'C'),
				v_requete
			)
		  from public.contacts ct
		  left join public.organizations o on o.id = ct.organization_id
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.full_name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.email, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(ct.role_title, '')), 'C')
		   ) @@ v_requete

		union all

		-- 4.3.3 `organisation`
		select
			'organisation'::text,
			o.id,
			o.workspace_id,
			o.name,
			o.domain,
			null::text,
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.domain, '')), 'B'),
				v_requete
			)
		  from public.organizations o
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.name, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(o.domain, '')), 'B')
		   ) @@ v_requete

		union all

		-- 4.3.4 `commentaire`
		-- L'extrait est REPLIÉ sur une ligne : mesuré (§2 M11), `ts_headline` rend un corps
		-- court EN ENTIER, retours à la ligne compris, et une palette n'affiche qu'une ligne.
		-- `StartSel` et `StopSel` VIDES : la donnée rendue est du texte pur, sans balise à
		-- échapper côté client.
		select
			'commentaire'::text,
			cc.id,
			cc.workspace_id,
			c2.title,
			p.full_name,
			btrim(regexp_replace(
				ts_headline(
					'app.francais_sans_accent',
					coalesce(cc.body, ''),
					v_requete,
					'StartSel="", StopSel="", MaxWords=18, MinWords=6, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "'
				),
				'\s+', ' ', 'g'
			)),
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(cc.body, '')), 'C'),
				v_requete
			)
		  from public.card_comments cc
		  left join public.cards c2 on c2.id = cc.card_id
		  left join public.profiles p on p.id = cc.author_id
		 where cc.deleted_at is null
		   -- UN COMMENTAIRE D'AFFAIRE MISE À LA CORBEILLE SORT AUSSI (§6.7, ligne *i*), et le
		   -- besoin a été trouvé par une assertion de la suite pgTAP, pas supposé : `card_comments`
		   -- porte son propre `deleted_at`, que mettre l'affaire à la corbeille ne touche pas. Sans
		   -- cette clause, la palette de la tranche 2 offrirait une destination morte — ce que le
		   -- §5.10 du design system interdit.
		   --
		   -- `not exists` et non une condition sur la jointure externe : si l'affaire n'est PAS
		   -- lisible, la sous-requête ne la voit pas non plus et le commentaire reste — le contexte
		   -- manquant se dit par `null`, il ne fait pas disparaître la ligne (§6.4). En pratique le
		   -- cas ne se produit pas, `card_comments_lecture` exigeant déjà de lire l'affaire.
		   and not exists (
				select 1
				  from public.cards cx
				 where cx.id = cc.card_id
				   and cx.deleted_at is not null
		   )
		   and (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(cc.body, '')), 'C')
		   ) @@ v_requete

		union all

		-- 4.3.5 `message`
		select
			'message'::text,
			m.id,
			m.workspace_id,
			m.subject,
			coalesce(nullif(m.from_name, ''), m.from_address),
			btrim(regexp_replace(
				ts_headline(
					'app.francais_sans_accent',
					coalesce(m.body_text, ''),
					v_requete,
					'StartSel="", StopSel="", MaxWords=18, MinWords=6, ShortWord=2, MaxFragments=1, FragmentDelimiter=" … "'
				),
				'\s+', ' ', 'g'
			)),
			ts_rank_cd(
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.subject, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent',
					coalesce(m.from_name, '') || ' ' || coalesce(m.from_address, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.body_text, '')), 'C'),
				v_requete
			)
		  from public.mail_messages m
		 where (
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.subject, '')), 'A') ||
				setweight(to_tsvector('app.francais_sans_accent',
					coalesce(m.from_name, '') || ' ' || coalesce(m.from_address, '')), 'B') ||
				setweight(to_tsvector('app.francais_sans_accent', coalesce(m.body_text, '')), 'C')
		   ) @@ v_requete
	)
	select r.objet, r.id, r.workspace_id, r.titre, r.sous_titre, r.extrait, r.rang
	  from resultats r
	-- L'ORDRE PORTE TROIS CRITÈRES, ET LES DEUX DERNIERS NE SONT PAS DÉCORATIFS (§6.6) : sans
	-- eux, deux lignes de rang égal — cas courant d'un terme trouvé une seule fois dans deux
	-- titres — s'ordonneraient au gré du plan d'exécution, et la palette changerait d'ordre
	-- d'une frappe à l'autre. `collate "fr-FR-x-icu"` plutôt que l'ordre binaire : « Émile » se
	-- rangerait après « Emma » avec le second.
	 order by r.rang desc, r.titre collate "fr-FR-x-icu", r.id
	 limit v_limite;
end;
$function$;

-- public.rentabilite_affaires — La rentabilité se range sous le channel et l'étape du premier rattachement ; T5 la ventilera par rattachement.
CREATE OR REPLACE FUNCTION public.rentabilite_affaires(p_debut date DEFAULT NULL::date, p_fin date DEFAULT NULL::date, p_card uuid DEFAULT NULL::uuid)
 RETURNS TABLE(workspace_id uuid, track_id uuid, channel_id uuid, card_id uuid, node_kind text, archivee boolean, currency text, recettes_prevues numeric, recettes_reelles numeric, lignes_recette integer, lignes_recette_sans_reel integer, couts_prevus numeric, couts_reels numeric, lignes_cout integer, lignes_cout_sans_reel integer, personnel numeric, minutes bigint, minutes_non_valorisees bigint)
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
	with affaires as (
		select c.id, c.workspace_id, ch.track_id, pl.channel_id, n.kind, pl.archived_at is not null as archivee, c.currency
		  from public.cards c
		  join lateral (select pl.channel_id, pl.current_step_id, pl.archived_at from public.card_placements pl where pl.card_id = c.id order by pl.created_at, pl.id limit 1) pl on true
		  join public.channels ch on ch.id = pl.channel_id
		  join public.workflow_steps s on s.id = pl.current_step_id
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
$function$;

-- public.temps_valorise — Un temps saisi sur une affaire se range sous le channel de son premier rattachement.
CREATE OR REPLACE FUNCTION public.temps_valorise(p_debut date, p_fin date, p_profile uuid DEFAULT NULL::uuid, p_track uuid DEFAULT NULL::uuid, p_card uuid DEFAULT NULL::uuid)
 RETURNS TABLE(profile_id uuid, track_id uuid, channel_id uuid, card_id uuid, minutes bigint, montant numeric, devise text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with saisies as (
		select s.workspace_id, s.profile_id, s.jour, s.minutes, s.card_id,
		       coalesce(s.channel_id, ca.channel_id)         as channel_id,
		       coalesce(s.track_id, ch.track_id)             as track_id
		  from public.saisies_temps s
		  left join lateral (select pl.channel_id from public.card_placements pl where pl.card_id = s.card_id
		                      order by pl.created_at, pl.id limit 1) ca on true
		  left join public.channels ch on ch.id = coalesce(s.channel_id, ca.channel_id)
		 where s.jour between p_debut and p_fin
		   and (p_profile is null or s.profile_id = p_profile)
		   and (p_card is null or s.card_id = p_card)
	)
	select sa.profile_id, sa.track_id, sa.channel_id, sa.card_id,
	       sum(sa.minutes)::bigint,
	       sum(round(sa.minutes * v.cout_quart / 105, 2)),
	       v.devise
	  from saisies sa
	  left join lateral (
		select cp.cout_quart, cp.devise
		  from public.couts_personnel cp
		 where cp.workspace_id = sa.workspace_id
		   and cp.profile_id = sa.profile_id
		   and cp.date_effet <= sa.jour
		 order by cp.date_effet desc
		 limit 1) v on true
	 where p_track is null or sa.track_id = p_track
	 group by sa.profile_id, sa.track_id, sa.channel_id, sa.card_id, v.devise
	 order by sa.profile_id, sa.track_id, sa.channel_id nulls first, sa.card_id nulls first, v.devise;
$function$;

-- public.plan_card_remapping — Le plan se lit sur les rattachements du workflow restauré ; il rend toujours une ligne par affaire (T2.3 le passera aux rattachements).
CREATE OR REPLACE FUNCTION public.plan_card_remapping(target_version_id uuid, step_overrides jsonb DEFAULT NULL::jsonb, card_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	version_cible      public.workflow_versions;
	etapes_version     uuid[];
	etapes_vivantes    uuid[];
	etapes_retirees    uuid[];
	instructions       jsonb := '[]'::jsonb;
	origine_invalide   uuid;
	cible_invalide     uuid;
	resume             jsonb;
	etapes_rendues     jsonb;
	cards_rendues      jsonb;
	total_cards        bigint;
	rendues            bigint;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if auth.uid() is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. La version cible existe ET est lisible par l'appelant. La RLS fait les deux, et le refus
	--    est le MÊME pour une version d'autrui que pour un identifiant inexistant : la fonction
	--    n'est pas un oracle d'existence (§4.3). Ce contrôle PRÉCÈDE celui d'administration, faute
	--    de quoi le message d'administration révélerait l'existence d'une version d'autrui.
	select v.* into version_cible
	  from public.workflow_versions v
	 where v.id = target_version_id;

	if not found then
		raise exception 'version introuvable'
			using errcode = 'P0001',
			      detail  = 'aucune version lisible ne porte cet identifiant';
	end if;

	-- 3. Administrateur du workspace de la version. C'est ce contrôle qui rend le plan EXHAUSTIF
	--    sous `security invoker` — voir l'en-tête.
	if not app.is_workspace_admin(version_cible.workspace_id) then
		raise exception 'plan reserve aux administrateurs'
			using errcode = '42501',
			      detail  = 'le plan de remappage n''est complet que pour un administrateur';
	end if;

	-- 4. La liste des affaires est BORNÉE : lister n'est pas compter, et un workflow peut porter des
	--    milliers d'affaires (CLAUDE.md §21).
	if card_limit is null or card_limit < 1 or card_limit > 1000 then
		raise exception 'limite invalide'
			using errcode = 'P0001',
			      detail  = 'card_limit doit etre compris entre 1 et 1000';
	end if;

	-- Les étapes de la version, et celles qui vivent aujourd'hui. `V` et `L` du §7 ter.12.2.
	select coalesce(pg_catalog.array_agg((e.value ->> 'id')::uuid), array[]::uuid[])
	  into etapes_version
	  from pg_catalog.jsonb_array_elements(
	       coalesce(version_cible.composition -> 'steps', '[]'::jsonb)
	  ) as e(value);

	select coalesce(pg_catalog.array_agg(s.id), array[]::uuid[])
	  into etapes_vivantes
	  from public.workflow_steps s
	 where s.workflow_id = version_cible.workflow_id;

	-- ÉTAPES RETIRÉES = vivantes aujourd'hui, absentes de la version : elles disparaîtront, et ce
	-- sont les SEULES dont les affaires appellent une décision.
	select coalesce(pg_catalog.array_agg(v), array[]::uuid[])
	  into etapes_retirees
	  from pg_catalog.unnest(etapes_vivantes) as v
	 where not (v = any (etapes_version));

	-- 5. Les instructions sont VALIDÉES, jamais interprétées. Un tableau d'objets portant deux clés
	--    et deux `uuid` valides, et rien d'autre.
	--
	--    La FORME est celle de `change_channel_workflow.step_mapping` (CRM-019), et le contrôle est
	--    écrit avec le même idiome — `pg_input_is_valid` plutôt qu'un `cast` sous `exception`. Les
	--    deux gestes disent la même chose — « les affaires de cette étape vont là » — et deux
	--    formes différentes pour la même décision auraient obligé tout écran à les traduire l'une
	--    dans l'autre.
	if step_overrides is not null then
		if pg_catalog.jsonb_typeof(step_overrides) <> 'array' then
			raise exception 'remappage invalide'
				using errcode = 'P0001',
				      detail  = 'step_overrides doit etre un tableau d''objets '
				                '{from_step_id, to_step_id}';
		end if;

		if exists (
			select 1
			  from pg_catalog.jsonb_array_elements(step_overrides) as e(value)
			 where pg_catalog.jsonb_typeof(e.value) <> 'object'
			    or not (e.value ? 'from_step_id' and e.value ? 'to_step_id')
			    or (select pg_catalog.count(*)
			          from pg_catalog.jsonb_object_keys(e.value)) <> 2
			    or pg_catalog.jsonb_typeof(e.value -> 'from_step_id') <> 'string'
			    or pg_catalog.jsonb_typeof(e.value -> 'to_step_id') <> 'string'
			    or not pg_catalog.pg_input_is_valid(e.value ->> 'from_step_id', 'uuid')
			    or not pg_catalog.pg_input_is_valid(e.value ->> 'to_step_id', 'uuid')
		) then
			raise exception 'remappage invalide'
				using errcode = 'P0001',
				      detail  = 'chaque instruction porte exactement from_step_id et to_step_id, '
				                'deux identifiants';
		end if;

		instructions := step_overrides;
	end if;

	-- 6. Aucune `from_step_id` deux fois : deux destinations pour la même étape ne se départagent
	--    pas, et en choisir une serait deviner.
	if exists (
		select 1
		  from pg_catalog.jsonb_array_elements(instructions) as e(value)
		 group by e.value ->> 'from_step_id'
		having pg_catalog.count(*) > 1
	) then
		raise exception 'remappage ambigu'
			using errcode = 'P0001',
			      detail  = 'une meme etape d''origine porte deux instructions';
	end if;

	-- 7. Chaque origine est une étape RETIRÉE. Une instruction visant une étape qui survit est soit
	--    une erreur de l'appelant, soit un déplacement de masse déguisé : l'accepter en silence
	--    ferait du plan un geste d'écriture par procuration.
	select (e.value ->> 'from_step_id')::uuid into origine_invalide
	  from pg_catalog.jsonb_array_elements(instructions) as e(value)
	 where not ((e.value ->> 'from_step_id')::uuid = any (etapes_retirees))
	 limit 1;

	if origine_invalide is not null then
		raise exception 'origine de remappage inconnue'
			using errcode = 'P0001',
			      detail  = 'l''etape ' || origine_invalide::text
			                || ' n''est pas une etape retiree par cette version';
	end if;

	-- 8. Chaque cible existe DANS LA VERSION : remapper vers une étape qui n'existera pas après la
	--    restauration ne rendrait pas le plan applicable.
	select (e.value ->> 'to_step_id')::uuid into cible_invalide
	  from pg_catalog.jsonb_array_elements(instructions) as e(value)
	 where not ((e.value ->> 'to_step_id')::uuid = any (etapes_version))
	 limit 1;

	if cible_invalide is not null then
		raise exception 'cible de remappage absente de la version'
			using errcode = 'P0001',
			      detail  = 'l''etape ' || cible_invalide::text
			                || ' n''appartient pas a la composition de cette version';
	end if;

	-- ---------------------------------------------------------------------------------------
	-- La résolution, card par card, EN UNE SEULE REQUÊTE.
	--
	-- Une seule requête, et c'est délibéré : la règle de résolution n'est écrite QU'UNE FOIS. La
	-- compter d'un côté et la lister de l'autre aurait donné deux formulations de la même règle,
	-- et deux formulations finissent toujours par diverger — c'est exactement le défaut qu'a
	-- corrigé l'extraction du document canonique en migration 39.
	--
	-- AUCUNE TABLE TEMPORAIRE : la fonction est `stable`, et PostgREST autorise `GET` sur une
	-- fonction `stable`, donc une transaction en LECTURE SEULE. Un `create temporary table` y
	-- échouerait, et la RPC ne fonctionnerait que par le verbe qui a servi à l'éprouver.
	--
	-- TOUTES les cards du workflow entrent dans le plan, y compris les ARCHIVÉES et celles en
	-- CORBEILLE : ce ne sont pas des lignes disparues, elles portent un `current_step_id` réel et
	-- une clé étrangère opposable (docs/SPEC-cards.md §4). Les exclure rendrait un plan qui se dit
	-- complet et une restauration qui échoue en base sur une affaire que personne ne regardait
	-- plus.
	-- ---------------------------------------------------------------------------------------
	with instructions_par_etape as (
		select (e.value ->> 'from_step_id')::uuid as from_step_id,
		       (e.value ->> 'to_step_id')::uuid   as to_step_id
		  from pg_catalog.jsonb_array_elements(instructions) as e(value)
	),
	resolues as (
		select
			c.id                as card_id,
			c.title             as title,
			-- La corbeille l'emporte : une card supprimée puis archivée reste supprimée.
			case
				when c.deleted_at  is not null then 'deleted'
				when pl.archived_at is not null then 'archived'
				else                                'active'
			end                 as state,
			pl.channel_id       as channel_id,
			pl.current_step_id  as current_step_id,
			-- LA SEULE ISSUE AUTOMATIQUE EST `unchanged`, et elle l'est parce qu'elle ne suppose
			-- rien : l'étape existe des deux côtés, avec le même identifiant. Toute autre
			-- destination vient d'un humain, par `step_overrides`.
			case
				when pl.current_step_id = any (etapes_version) then pl.current_step_id
				else i.to_step_id
			end                 as target_step_id,
			case
				when pl.current_step_id = any (etapes_version) then 'unchanged'
				when i.to_step_id is not null                 then 'remapped'
				else                                               'unresolved'
			end                 as resolution,
			-- L'ORDRE PLACE LES BLOCAGES EN TÊTE. Si la liste est tronquée, ce qu'un humain doit
			-- voir en premier est exactement ce qui l'empêche d'appliquer (§7 ter.12.7).
			case
				when pl.current_step_id = any (etapes_version) then 2
				when i.to_step_id is not null                 then 1
				else                                               0
			end                 as rang
		  from public.cards c
		  join public.card_placements pl on pl.card_id = c.id
		  left join instructions_par_etape i on i.from_step_id = pl.current_step_id
		 where pl.workflow_id = version_cible.workflow_id
	),
	-- Les compteurs portent sur la TOTALITÉ des affaires, jamais sur la seule page rendue : un plan
	-- dont le verdict dépendrait de la taille de la page ne serait pas un verdict.
	comptes as (
		select
			pg_catalog.count(*)                                                  as total,
			pg_catalog.count(*) filter (where r.resolution = 'unchanged')        as inchangees,
			pg_catalog.count(*) filter (where r.resolution = 'remapped')         as remappees,
			pg_catalog.count(*) filter (where r.resolution = 'unresolved')       as non_resolues
		  from resolues r
	),
	page as (
		select r.* from resolues r
		 order by r.rang, r.current_step_id, r.card_id
		 limit card_limit
	),
	liste as (
		select
			coalesce(pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'card_id',         p.card_id,
					'title',           p.title,
					'state',           p.state,
					'channel_id',      p.channel_id,
					'current_step_id', p.current_step_id,
					'target_step_id',  p.target_step_id,
					'resolution',      p.resolution
				) order by p.rang, p.current_step_id, p.card_id
			), '[]'::jsonb) as document,
			pg_catalog.count(*) as rendues
		  from page p
	),
	-- Les étapes RETIRÉES portent le libellé lu sur la structure VIVANTE ; les étapes RÉTABLIES
	-- celui du DOCUMENT de la version, seul endroit où il subsiste. C'est précisément à cela que
	-- sert la conservation du document entier : un écran doit pouvoir nommer une étape que la base
	-- ne porte plus.
	retirees as (
		select coalesce(pg_catalog.jsonb_agg(
			pg_catalog.jsonb_build_object(
				'step_id',          s.id,
				'label',            coalesce(s.label_override, n.label),
				'cards_total',      k.total,
				'cards_unresolved', k.non_resolues,
				'target_step_id',   i.to_step_id
			) order by s.position, s.id
		), '[]'::jsonb) as document
		  from public.workflow_steps s
		  join public.workflow_nodes_catalog n on n.id = s.node_id
		  left join instructions_par_etape i on i.from_step_id = s.id
		  cross join lateral (
			select pg_catalog.count(*)                                            as total,
			       pg_catalog.count(*) filter (where r.resolution = 'unresolved') as non_resolues
			  from resolues r
			 where r.current_step_id = s.id
		  ) k
		 where s.id = any (etapes_retirees)
	),
	-- UNE ÉTAPE RÉTABLIE N'EST JAMAIS PROPOSÉE COMME DESTINATION. Elle est vide par construction,
	-- et il serait tentant d'y verser les affaires des étapes retirées « puisqu'elle revient » :
	-- ce serait une supposition sur l'intention. Elle est NOMMÉE ici, pour qu'un humain puisse la
	-- choisir ; elle n'est jamais choisie à sa place.
	retablies as (
		select coalesce(pg_catalog.jsonb_agg(
			pg_catalog.jsonb_build_object(
				'step_id', (e.value ->> 'id')::uuid,
				'label',   coalesce(e.value ->> 'label_override', e.value ->> 'node_label')
			) order by (e.value ->> 'position')::numeric, (e.value ->> 'id')
		), '[]'::jsonb) as document
		  from pg_catalog.jsonb_array_elements(
		       coalesce(version_cible.composition -> 'steps', '[]'::jsonb)
		  ) as e(value)
		 where not ((e.value ->> 'id')::uuid = any (etapes_vivantes))
	)
	select
		c.total,
		l.rendues,
		pg_catalog.jsonb_build_object(
			'cards_total',      c.total,
			'cards_unchanged',  c.inchangees,
			'cards_remapped',   c.remappees,
			'cards_unresolved', c.non_resolues,
			'steps_removed',    pg_catalog.cardinality(etapes_retirees),
			'steps_restored',   (
				select pg_catalog.count(*)
				  from pg_catalog.unnest(etapes_version) as v
				 where not (v = any (etapes_vivantes))
			)
		),
		pg_catalog.jsonb_build_object('removed', d.document, 'restored', b.document),
		l.document
	  into total_cards, rendues, resume, etapes_rendues, cards_rendues
	  from comptes c, liste l, retirees d, retablies b;

	return pg_catalog.jsonb_build_object(
		'version', pg_catalog.jsonb_build_object(
			'version_id',              version_cible.id,
			'version_number',          version_cible.version_number,
			'workflow_id',             version_cible.workflow_id,
			'published_at',            version_cible.published_at,
			'composition_fingerprint', version_cible.composition_fingerprint
		),
		-- `ready` ne dit PAS que la restauration réussira — la quatrième tranche a ses propres
		-- refus, et la structure vivante peut bouger entre le plan et son application. Il dit que
		-- plus aucune affaire n'attend une décision humaine.
		'ready',   (resume ->> 'cards_unresolved')::bigint = 0,
		'summary', resume,
		'steps',   etapes_rendues,
		'cards',   pg_catalog.jsonb_build_object(
			'total',     total_cards,
			'returned',  rendues,
			-- UNE TRONCATURE SILENCIEUSE SERAIT UN MENSONGE : elle ferait lire « voici les affaires
			-- concernées » là où il faut lire « en voici les deux cents premières ».
			'truncated', rendues < total_cards,
			'limit',     card_limit,
			'items',     cards_rendues
		)
	);
end;
$function$;

-- public.classer_message_automatiquement — Une affaire reçoit du courrier si l'un de ses rattachements est actif (`app.card_has_active_placement`).
CREATE OR REPLACE FUNCTION public.classer_message_automatiquement(p_message_id uuid, p_in_reply_to text DEFAULT NULL::text, p_references text[] DEFAULT NULL::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_message         public.mail_messages%rowtype;
	v_card            uuid;
	v_cards_suggerees uuid[];
	v_suggestion      uuid;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		raise exception 'message_not_found' using errcode = 'P0002';
	end if;

	-- Un message DÉJÀ classé n'est pas reclassé : la règle 1 a parlé une fois, et un second
	-- passage de la relève ne doit pas déplacer du courrier.
	if v_message.classification <> 'unclassified' then
		return v_message.card_id;
	end if;

	-- RÈGLE 1 — une adresse de card figure parmi les destinataires.
	v_card := app.card_par_adresse(
		v_message.workspace_id,
		v_message.to_addresses || v_message.cc_addresses
	);

	-- RÈGLE 2 — la filiation, et seulement si la règle 1 n'a rien dit.
	if v_card is null and (p_in_reply_to is not null or p_references is not null) then
		select m.card_id into v_card
		  from public.mail_messages m
		 where m.workspace_id = v_message.workspace_id
		   and m.card_id is not null
		   and m.rfc822_message_id = any (
		         coalesce(p_references, array[]::text[]) ||
		         case when p_in_reply_to is null then array[]::text[] else array[p_in_reply_to] end
		       )
		 order by m.received_at desc
		 limit 1;

		-- La card du parent peut avoir été archivée depuis : la règle 2 hérite alors du refus de
		-- la règle 1, faute de quoi la filiation contournerait la règle du §16.2.
		if v_card is not null and not exists (
			select 1 from public.cards c
			 where c.id = v_card and app.card_has_active_placement(c.id) and c.deleted_at is null
		) then
			v_card := null;
		end if;
	end if;

	-- RÈGLE 3 — l'expéditeur est un contact rattaché à EXACTEMENT UNE card active : on SUGGÈRE, on
	-- ne classe pas. Atteinte seulement quand les règles 1 et 2 sont muettes. L'unicité partielle
	-- (workspace_id, lower(email)) de `contacts` garantit AU PLUS un contact par email ; l'ambiguïté
	-- à trancher est donc du côté des CARDS. Une card archivée ou en corbeille ne compte pas, comme
	-- la règle 1 refuse de classer dans une card rangée (§16.2, docs/SPEC-contacts.md §8.2).
	if v_card is null then
		select array_agg(distinct cc.card_id)
		  into v_cards_suggerees
		  from public.contacts ct
		  join public.card_contacts cc
		    on cc.contact_id = ct.id and cc.workspace_id = ct.workspace_id
		  join public.cards c
		    on c.id = cc.card_id and c.workspace_id = cc.workspace_id
		 where ct.workspace_id = v_message.workspace_id
		   and ct.email is not null
		   and lower(ct.email) = lower(btrim(v_message.from_address))
		   and app.card_has_active_placement(c.id)
		   and c.deleted_at is null;

		-- EXACTEMENT une : zéro n'invente rien, deux ou plus se tait plutôt que de choisir au
		-- hasard. On écrit la suggestion calculée — ou on l'efface —, de sorte qu'un second passage
		-- de la relève rende un résultat déterministe (docs/SPEC-contacts.md §8.3).
		if v_cards_suggerees is not null and array_length(v_cards_suggerees, 1) = 1 then
			v_suggestion := v_cards_suggerees[1];
		else
			v_suggestion := null;
		end if;

		update public.mail_messages m
		   set suggested_card_id = v_suggestion,
		       suggested_at = case when v_suggestion is null then null else now() end
		 where m.id = p_message_id;

		-- RÈGLE 4 — la règle 3 ne classe pas : le message reste non classé. Ce n'est pas une erreur.
		return null;
	end if;

	update public.mail_messages m
	   set card_id = v_card,
	       classification = 'auto',
	       classified_at = now()
	 where m.id = p_message_id;

	perform app.card_event_ecrire(
		v_card,
		v_message.workspace_id,
		'mail_received',
		jsonb_build_object('message_id', p_message_id, 'rule', 'auto')
	);

	-- Les pièces jointes suivent leur message : `card_id` y est recopié pour un accès direct
	-- depuis la card (docs/SCHEMA.md §12).
	update public.mail_attachments a set card_id = v_card where a.message_id = p_message_id;

	return v_card;
end;
$function$;

-- public.classify_message — Une affaire reçoit du courrier si l'un de ses rattachements est actif.
CREATE OR REPLACE FUNCTION public.classify_message(p_message_id uuid, p_card_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_message public.mail_messages%rowtype;
	v_appelant uuid := (select auth.uid());
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		raise exception 'message_not_found' using errcode = 'P0002';
	end if;

	-- LE PREMIER DES DEUX DROITS — voir le message (CRM-057 §18.2).
	if not app.peut_voir_message(p_message_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- LE SECOND — classer un message ajoute du contenu à la card : le droit d'ÉCRITURE est exigé,
	-- non celui de lecture. C'est la même règle que pour un commentaire (docs/SPEC-cards.md §13.6).
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	if not exists (
		select 1 from public.cards c
		 where c.id = p_card_id
		   and c.workspace_id = v_message.workspace_id
		   and app.card_has_active_placement(c.id)
		   and c.deleted_at is null
	) then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- IDEMPOTENT : reclasser dans la MÊME card ne produit pas un second événement. Un utilisateur
	-- qui clique deux fois ne raconte pas deux histoires.
	if v_message.card_id = p_card_id then
		return p_card_id;
	end if;

	update public.mail_messages m
	   set card_id = p_card_id,
	       classification = 'manual',
	       classified_by = v_appelant,
	       classified_at = now()
	 where m.id = p_message_id;

	perform app.card_event_ecrire(
		p_card_id,
		v_message.workspace_id,
		'mail_received',
		jsonb_build_object('message_id', p_message_id, 'rule', 'manual')
	);

	update public.mail_attachments a set card_id = p_card_id where a.message_id = p_message_id;

	return p_card_id;
end;
$function$;

-- app.card_par_adresse — Une adresse d'affaire ne reçoit que si l'un de ses rattachements est actif.
CREATE OR REPLACE FUNCTION app.card_par_adresse(p_workspace_id uuid, p_adresses text[])
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	select c.id
	  from public.cards c
	  join public.workspaces w on w.id = c.workspace_id
	 where c.workspace_id = p_workspace_id
	   and app.card_has_active_placement(c.id)
	   and c.deleted_at is null
	   and lower(c.email_local_part || '@' || w.inbound_domain) = any (
	         select lower(btrim(adresse)) from unnest(p_adresses) as adresse
	       )
	 limit 1;
$function$;

-- public.queue_outbound_email — Une affaire n'envoie que si l'un de ses rattachements est actif.
CREATE OR REPLACE FUNCTION public.queue_outbound_email(p_card_id uuid, p_identity_id uuid, p_to text[], p_subject text DEFAULT NULL::text, p_body_text text DEFAULT ''::text, p_cc text[] DEFAULT '{}'::text[], p_in_reply_to_message_id uuid DEFAULT NULL::uuid, p_bcc text[] DEFAULT '{}'::text[], p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_appelant  uuid := (select auth.uid());
	v_identite  public.mail_outbound_identities%rowtype;
	v_card      public.cards%rowtype;
	v_adresse   text;
	v_chemins   text[];
	v_pieces    jsonb;
	v_trouvees  integer;
	v_total     bigint;
	v_file      uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- ENVOYER AU NOM D'UNE AFFAIRE, C'EST Y AJOUTER DU CONTENU (§19.4).
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and (
	     i.owner_id = v_appelant
	     or (i.owner_id is null and app.is_workspace_admin(i.workspace_id))
	   );
	if v_identite.id is null then
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	select * into v_card
	  from public.cards c
	 where c.id = p_card_id
	   and c.workspace_id = v_identite.workspace_id
	   and app.card_has_active_placement(c.id)
	   and c.deleted_at is null;
	if v_card.id is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	select c.email_local_part || '@' || w.inbound_domain into v_adresse
	  from public.cards c join public.workspaces w on w.id = c.workspace_id
	 where c.id = p_card_id and c.email_local_part is not null;
	if v_adresse is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	if coalesce(array_length(p_to, 1), 0) = 0 then
		raise exception 'recipient_required' using errcode = '23514';
	end if;

	if coalesce(char_length(p_body_text), 0) < 1 then
		raise exception 'body_required' using errcode = '23514';
	end if;

	-- LES PIÈCES JOINTES — §19 bis.2 points 4 et 5. Le client ne donne que des CHEMINS ; nom de fichier, taille et type
	-- sont relus dans `storage.objects`, jamais crus.
	if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
		raise exception 'attachment_not_available' using errcode = '23514';
	end if;
	select coalesce(array_agg(distinct e), '{}')
	  into v_chemins
	  from jsonb_array_elements_text(coalesce(p_attachments, '[]'::jsonb)) e;
	if coalesce(array_length(v_chemins, 1), 0) > 10 then
		raise exception 'too_many_attachments' using errcode = '23514', detail = 'At most 10 attachments per message.';
	end if;
	if coalesce(array_length(v_chemins, 1), 0) > 0 then
		select count(*),
		       coalesce(sum((o.metadata ->> 'size')::bigint), 0),
		       coalesce(jsonb_agg(jsonb_build_object(
		           'path', o.name,
		           'filename', split_part(o.name, '/', 4),
		           'mime_type', coalesce(o.metadata ->> 'mimetype', 'application/octet-stream'),
		           'size_bytes', (o.metadata ->> 'size')::bigint
		       ) order by o.name), '[]'::jsonb)
		  into v_trouvees, v_total, v_pieces
		  from storage.objects o
		 where o.bucket_id = 'mail-outbound-attachments'
		   and o.name = any (v_chemins)
		   and o.owner = v_appelant
		   and split_part(o.name, '/', 1) = v_identite.workspace_id::text
		   and split_part(o.name, '/', 2) = v_appelant::text;
		-- UN SEUL REFUS POUR QUATRE CAUSES — absent, autre bucket, autre propriétaire, autre espace : les distinguer
		-- dirait à l'appelant qu'un objet d'autrui existe à ce chemin.
		if v_trouvees <> array_length(v_chemins, 1) then
			raise exception 'attachment_not_available' using errcode = '23514';
		end if;
		if v_total > 10485760 then
			raise exception 'attachments_too_large' using errcode = '23514', detail = 'At most 10 MB of attachments per message.';
		end if;
	end if;

	if v_identite.daily_quota is not null
		and app.envois_du_jour(p_identity_id) >= v_identite.daily_quota then
		raise exception 'quota_exceeded' using errcode = '23505';
	end if;

	v_file := app.mail_outbox_inserer(
		v_identite.workspace_id, p_identity_id, p_card_id, p_in_reply_to_message_id,
		p_to, p_cc, p_subject, p_body_text, v_identite.signature_text, v_appelant);

	-- LA COPIE CACHÉE ET LES PIÈCES complètent la ligne que la porte extraite vient d'écrire, dans la même transaction :
	-- `app.mail_outbox_inserer` reste la seule insertion, et les séquences de relance, qui n'ont ni l'une ni les autres,
	-- n'en voient aucun changement.
	update public.mail_outbox
	   set bcc_addrs = coalesce(p_bcc, '{}'),
	       attachments = coalesce(v_pieces, '[]'::jsonb)
	 where id = v_file;

	return v_file;
end;
$function$;

-- public.chemin_dossier_card — Le dossier IMAP d'une affaire suit le channel de son premier rattachement ; T6 le passera à `CRM/Affaires/<affaire>`.
CREATE OR REPLACE FUNCTION public.chemin_dossier_card(p_card_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	select 'CRM/'
	       || app.assainir_segment_dossier(t.name) || '/'
	       || app.assainir_segment_dossier(ch.name) || '/'
	       || app.assainir_segment_dossier(c.title)
	  from public.cards c
	  join lateral (select pl.channel_id from public.card_placements pl where pl.card_id = c.id order by pl.created_at, pl.id limit 1) pl on true
	  join public.channels ch on ch.id = pl.channel_id
	  join public.tracks t on t.id = ch.track_id
	 where c.id = p_card_id;
$function$;

-- public.inbox_arborescence — L'arborescence de l'inbox range une affaire sous le channel de son premier rattachement (T6).
CREATE OR REPLACE FUNCTION public.inbox_arborescence()
 RETURNS TABLE(track_id uuid, track_name text, channel_id uuid, channel_name text, card_id uuid, card_title text, nombre bigint, unread_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	-- La ligne des NON CLASSÉS vient toujours en premier, et existe même à zéro (§18.3).
	select null::uuid, null::text, null::uuid, null::text, null::uuid, null::text, count(*),
	       count(*) filter (where not public.is_read(m))
	  from public.mail_messages m
	 where m.card_id is null
	union all
	select t.id, t.name, ch.id, ch.name, c.id, c.title, count(*),
	       count(*) filter (where not public.is_read(m))
	  from public.mail_messages m
	  join public.cards c on c.id = m.card_id
	  join lateral (select pl.channel_id from public.card_placements pl where pl.card_id = c.id order by pl.created_at, pl.id limit 1) pl on true
	  join public.channels ch on ch.id = pl.channel_id
	  join public.tracks t on t.id = ch.track_id
	 group by t.id, t.name, ch.id, ch.name, c.id, c.title
	 order by 2 nulls first, 4, 6;
$function$;

-- public.rendre_modele_email — Les variables d'affaire d'un modèle lisent son premier rattachement ; T6 les passera au rattachement de l'envoi (décision 657).
CREATE OR REPLACE FUNCTION public.rendre_modele_email(p_template_id uuid, p_card_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_identity_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(subject text, body_text text, variables_nulles text[])
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with modele as (
		select m.subject, m.body_text
		  from public.mail_templates m
		 where m.id = p_template_id
	),
	affaire as (
		-- LES JOINTURES SONT INTERNES POUR LE CHANNEL ET L'ÉTAPE, ET EXTERNES POUR LE RESTE. Le
		-- channel et l'étape d'une card sont `not null` en base, et une card lisible dont le
		-- channel ne le serait pas rendrait un rendu amputé sans le dire. La RLS des deux tables
		-- dérive du même droit de lecture que celle de `cards`, si bien qu'une jointure interne
		-- ne retranche rien en pratique — et là où elle retrancherait, l'absence de ligne est
		-- préférable à un rendu partiel silencieux.
		select c.title,
		       pl.amount,
		       c.currency,
		       pl.next_action,
		       pl.next_action_at,
		       coalesce(ws.label_override, cat.label) as etape,
		       ch.name                                as channel
		  from public.cards c
		  join lateral (select pl.channel_id, pl.current_step_id, pl.amount, pl.next_action, pl.next_action_at from public.card_placements pl where pl.card_id = c.id order by pl.created_at, pl.id limit 1) pl on true
		  join public.channels             ch  on ch.id  = pl.channel_id
		  join public.workflow_steps       ws  on ws.id  = pl.current_step_id
		  join public.workflow_nodes_catalog cat on cat.id = ws.node_id
		 where c.id = p_card_id
	),
	personne as (
		select ct.full_name, ct.email, o.name as organisation
		  from public.contacts ct
		  left join public.organizations o on o.id = ct.organization_id
		 where ct.id = p_contact_id
	),
	expediteur as (
		select i.from_name, i.from_address
		  from public.mail_outbound_identities i
		 where i.id = p_identity_id
	),
	-- LA CARTE DES VALEURS EST LA SOURCE UNIQUE DES DEUX RÉSULTATS : la substitution la lit, et
	-- l'inventaire des trous nuls la lit aussi. En construire deux garantirait qu'un jour l'une
	-- dise « vide » là où l'autre dit « rempli ».
	--
	-- `jsonb_build_object` conserve les valeurs NULLES, que `->>` rend alors nulles : c'est ce qui
	-- permet de distinguer « la variable existe et vaut null » de « la variable n'existe pas », et
	-- les DEUX rendent la chaîne vide à la substitution (§8.4).
	valeurs as (
		select jsonb_build_object(
			'card.title',           a.title,
			'card.amount',          to_char(a.amount, 'FM999999999990.00'),
			'card.currency',        a.currency,
			'card.next_action',     a.next_action,
			'card.next_action_at',  to_char(a.next_action_at at time zone 'UTC', 'DD/MM/YYYY HH24:MI'),
			'card.step',            a.etape,
			'card.channel',         a.channel,
			'contact.full_name',    p.full_name,
			'contact.email',        p.email,
			'contact.organization', p.organisation,
			'identity.from_name',   e.from_name,
			'identity.from_address', e.from_address
		) as carte
		  from affaire a
		  left join personne   p on true
		  left join expediteur e on true
	)
	select
		app.mail_template_substituer(m.subject,   v.carte) as subject,
		app.mail_template_substituer(m.body_text, v.carte) as body_text,
		-- L'INVENTAIRE DES TROUS NULS — trié, dédoublonné, et BORNÉ AUX VARIABLES QUE LE MODÈLE
		-- EMPLOIE RÉELLEMENT (§8.4). Une variable que le modèle n'emploie pas n'est pas un trou :
		-- l'y faire figurer donnerait à lire une liste d'absences sans objet, et la sous-tranche 2b
		-- afficherait un avertissement pour un texte qui n'en porte pas la trace.
		--
		-- Les trous du modèle sont relus par le MÊME motif que la substitution : un nom qui ne
		-- serait pas découpé pareillement ici ferait mentir l'inventaire sur le texte rendu.
		coalesce(
			(
				select array_agg(distinct nom order by nom)
				  from (
					select btrim(trou[1]) as nom
					  from regexp_matches(m.subject || ' ' || m.body_text,
					                      '\{\{([^{}]*)\}\}', 'g') as trou
				  ) as trous
				 where v.carte ->> nom is null
			),
			array[]::text[]
		) as variables_nulles
	  from modele m
	 cross join valeurs v;
$function$;
