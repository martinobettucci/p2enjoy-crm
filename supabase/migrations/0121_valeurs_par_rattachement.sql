-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3.6 : les valeurs de bloc appartiennent au rattachement (décision 705).
--       docs/SPEC-rattachements.md §3.3 (la clé `(placement_id, field_id)`, la charnière `(placement_id, workflow_id) →
--       card_placements`, `card_id` dénormalisé et garanti par `(placement_id, card_id)`), §4 (lire et écrire un bloc :
--       le channel du rattachement ; la lecture sous la forme optimisée), §14 ; docs/JOURNAL.md décisions 642, 667, 705
-- @spec docs/SCHEMA.md « Migration `0121` », §4 (`card_field_values`) ; docs/PROD_MIGRATIONS.md §3
--
-- CE QUI CHANGE. (1) `placement_id` devient `NOT NULL` — la contrainte `card_field_values_placement_present` de la `0109`
-- le tenait en attendant ses appelants. (2) La clé primaire passe de `(card_id, field_id)` à `(placement_id, field_id)` :
-- une affaire rattachée à deux channels aura une valeur par bloc. (3) La charnière du workflow passe de
-- `(card_id, workflow_id) → cards` à `(placement_id, workflow_id) → card_placements` : une valeur ne répond qu'à une
-- question du workflow de SON rattachement. (4) Les trois politiques jugent le rattachement : lecture sous la forme
-- optimisée (`app.readable_channel_ids()`, décision 667), écriture sur le channel du rattachement. (5) La prévisualisation
-- de l'exigence lit les valeurs du rattachement.
--
-- CE QUI NE CHANGE PAS. `card_id` reste, dénormalisé, garanti par `card_field_values_placement_card_fk` ; le déclencheur
-- de remplissage de la `0109` reste le filet d'un écrivain qui ne nomme pas le rattachement — il pose le PREMIER, ce qui
-- suffit tant qu'une affaire n'en a qu'un. Un index sur `card_id` remplace celui que la clé primaire offrait : les
-- lectures par affaire (fiche, connecteur, recherche) en dépendent jusqu'aux écrans de T5.
--
-- IDEMPOTENCE : chaque changement de structure est gardé par l'état qu'il produit.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : rendre la clé `(card_id, field_id)` et la clé `(card_id, workflow_id) →
-- cards`, les politiques par `app.can_read_card` / `app.can_write_card`, `placement_id` nullable sous sa contrainte, et la
-- prévisualisation de la `0109`, avec la webapp et l'image `mcp` d'avant.

alter table public.card_field_values alter column placement_id set not null;
alter table public.card_field_values drop constraint if exists card_field_values_placement_present;

do $$
begin
	if (select array_agg(a.attname::text order by k.ord)
	      from pg_constraint c
	      cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
	      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
	     where c.conname = 'card_field_values_pkey') = array['card_id', 'field_id'] then
		alter table public.card_field_values drop constraint card_field_values_pkey;
		alter table public.card_field_values add constraint card_field_values_pkey primary key (placement_id, field_id);
	end if;
	if not exists (select 1 from pg_constraint where conname = 'card_field_values_placement_workflow_fk') then
		alter table public.card_field_values
			add constraint card_field_values_placement_workflow_fk
			foreign key (placement_id, workflow_id) references public.card_placements (id, workflow_id) on delete cascade;
	end if;
end;
$$;

alter table public.card_field_values drop constraint if exists card_field_values_card_id_workflow_id_fkey;

create index if not exists card_field_values_card_idx on public.card_field_values (card_id);

drop policy if exists card_field_values_lecture on public.card_field_values;
create policy card_field_values_lecture on public.card_field_values
	for select to anon, authenticated
	using (placement_id in (select p.id from public.card_placements p
	                        where p.channel_id in (select unnest(app.readable_channel_ids()))));

drop policy if exists card_field_values_insertion on public.card_field_values;
create policy card_field_values_insertion on public.card_field_values
	for insert to authenticated
	with check (app.can_write_channel((select p.channel_id from public.card_placements p where p.id = placement_id)));

drop policy if exists card_field_values_maj on public.card_field_values;
create policy card_field_values_maj on public.card_field_values
	for update to authenticated
	using (app.can_write_channel((select p.channel_id from public.card_placements p where p.id = placement_id)))
	with check (app.can_write_channel((select p.channel_id from public.card_placements p where p.id = placement_id)));

-- --- La prévisualisation de l'exigence lit les valeurs du rattachement (sa définition reprise de la base) ----------
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
			        where v.placement_id = c.id
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
			        where v.placement_id = c.id
			          and v.field_id = p_field_id
			          and not app.valeur_de_champ_est_vide(v.value)
			   )
		), 0)::bigint;
end;
$function$;
