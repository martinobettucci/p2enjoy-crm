-- @spec CRM-112 (docs/BACKLOG.md) — tranches T2.c.2 et T3.b : les champs communs exigés dans les deux comparaisons de
--       versions (INC-344), et l'aperçu des effets d'une exigence commune dans l'éditeur de workflows
-- @spec docs/SPEC-champs-communs.md §5 (précision T2.c.2) et §7 (précision T3.b) ; docs/SPEC-workflow-engine.md §7 bis.13
--       (l'aperçu des effets), §7 ter.11 et §4 ter (les comparaisons) ; docs/DESIGN_SYSTEM.md §5.87 ;
--       docs/SCHEMA.md « Migration `0161` »
--
-- LES TROIS FONCTIONS DE COMPARAISON SONT REPRISES À L'IDENTIQUE DE LEUR DÉFINITION EN BASE (`pg_get_functiondef`), chacune
-- avec un ajout : la collection `required_common_fields`. Une version ou un workflow qui n'exige aucun champ commun rend
-- une collection vide, et le reste du document ne change pas. La quatrième fonction est neuve.

CREATE OR REPLACE FUNCTION app.workflow_composition_naturel(target_workflow_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with document as (
		select app.workflow_composition_document(target_workflow_id) as j
	),
	-- Table de correspondance « identifiant local d'étape » -> « identifiant de nœud ». C'est elle
	-- qui rend les arêtes, les règles et les exigences comparables d'un workflow à l'autre.
	etapes as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'steps') as e(value)
	),
	etape_par_id as (
		select element ->> 'id' as id_local, element ->> 'node_id' as node_id
		  from etapes
	),
	champs as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'fields') as e(value)
	),
	champ_par_id as (
		select element ->> 'id' as id_local, element ->> 'key' as cle
		  from champs
	),
	arcs as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'transitions') as e(value)
	),
	-- L'identité d'une arête est le COUPLE de nœuds, garanti unique par
	-- `workflow_transitions_workflow_from_to_key` (§4 ter.2). Le libellé est un attribut : le
	-- changer est une modification, pas un retrait suivi d'un ajout.
	arc_par_id as (
		select
			a.element ->> 'id' as id_local,
			(select node_id from etape_par_id where id_local = a.element ->> 'from_step_id') as from_node_id,
			(select node_id from etape_par_id where id_local = a.element ->> 'to_step_id')   as to_node_id
		  from arcs a
	),
	regles as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'rules') as e(value)
	),
	exigences as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(d.j -> 'required_fields') as e(value)
	),
	-- `CRM-112` T2.c.2 : absente du document quand rien n'est exigé (`0157`) ; `coalesce` rend alors zéro ligne.
	exigences_communes as (
		select e.value as element
		  from document d, pg_catalog.jsonb_array_elements(coalesce(d.j -> 'required_common_fields', '[]'::jsonb)) as e(value)
	)
	select pg_catalog.jsonb_build_object(
		'steps', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'node_id',              element -> 'node_id',
					'node_key',             element -> 'node_key',
					'position',             element -> 'position',
					'is_initial',           element -> 'is_initial',
					'label_override',       element -> 'label_override',
					'probability_override', element -> 'probability_override',
					'stale_after_days',     element -> 'stale_after_days'
				) order by element ->> 'node_id'
			) from etapes
		), '[]'::jsonb),
		'transitions', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'from_node_id',    (select from_node_id from arc_par_id where id_local = a.element ->> 'id'),
					'to_node_id',      (select to_node_id   from arc_par_id where id_local = a.element ->> 'id'),
					'label',           a.element -> 'label',
					'require_comment', a.element -> 'require_comment'
				) order by
					(select from_node_id from arc_par_id where id_local = a.element ->> 'id'),
					(select to_node_id   from arc_par_id where id_local = a.element ->> 'id')
			) from arcs a
		), '[]'::jsonb),
		-- `fields.key` est le seul appariement qui repose sur une clé MÉTIER, et l'écart est assumé
		-- au §4 ter.2 : `key` est exactement ce que la copie remappe, et un champ n'a pas d'autre
		-- invariant partagé. Renommer un champ dans la copie est donc un retrait ET un ajout.
		'fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'key',         element -> 'key',
					'type',        element -> 'type',
					'label',       element -> 'label',
					'options',     element -> 'options',
					'position',    element -> 'position',
					'help_text',   element -> 'help_text',
					'archived_at', element -> 'archived_at'
				) order by element ->> 'key'
			) from champs
		), '[]'::jsonb),
		'rules', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'field_key',  (select cle     from champ_par_id where id_local = r.element ->> 'field_id'),
					'node_id',    (select node_id from etape_par_id where id_local = r.element ->> 'step_id'),
					'visibility', r.element -> 'visibility'
				) order by
					(select cle     from champ_par_id where id_local = r.element ->> 'field_id'),
					(select node_id from etape_par_id where id_local = r.element ->> 'step_id')
			) from regles r
		), '[]'::jsonb),
		-- Une exigence EST son identité : elle existe ou elle n'existe pas. Aucun attribut à
		-- comparer, donc aucun `modified` possible sur cette collection (§4 ter.3).
		'required_fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'from_node_id', (select from_node_id from arc_par_id  where id_local = x.element ->> 'transition_id'),
					'to_node_id',   (select to_node_id   from arc_par_id  where id_local = x.element ->> 'transition_id'),
					'field_key',    (select cle          from champ_par_id where id_local = x.element ->> 'field_id')
				) order by
					(select from_node_id from arc_par_id  where id_local = x.element ->> 'transition_id'),
					(select to_node_id   from arc_par_id  where id_local = x.element ->> 'transition_id'),
					(select cle          from champ_par_id where id_local = x.element ->> 'field_id')
			) from exigences x
		), '[]'::jsonb),
		-- `CRM-112` T2.c.2 : un champ commun se nomme par sa clé, que le document porte ; une exigence est son identité.
		'required_common_fields', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object(
					'from_node_id',     (select from_node_id from arc_par_id where id_local = c.element ->> 'transition_id'),
					'to_node_id',       (select to_node_id   from arc_par_id where id_local = c.element ->> 'transition_id'),
					'common_field_key', c.element -> 'key'
				) order by
					(select from_node_id from arc_par_id where id_local = c.element ->> 'transition_id'),
					(select to_node_id   from arc_par_id where id_local = c.element ->> 'transition_id'),
					c.element ->> 'key'
			) from exigences_communes c
		), '[]'::jsonb)
	)
	  from document d
	 where d.j is not null;
$function$;

CREATE OR REPLACE FUNCTION public.compare_workflow_versions(base_version_id uuid, target_version_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	version_base   public.workflow_versions;
	version_cible  public.workflow_versions;
	changements    jsonb;
	nombre_ajouts    integer := 0;
	nombre_retraits  integer := 0;
	nombre_modifies  integer := 0;
	collection     text;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if auth.uid() is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. La version de base existe ET est lisible par l'appelant. La RLS fait les deux.
	select v.* into version_base
	  from public.workflow_versions v
	 where v.id = base_version_id;

	if not found then
		raise exception 'version introuvable'
			using errcode = 'P0001',
			      detail  = 'aucune version lisible ne porte cet identifiant';
	end if;

	-- 3. La version cible, et le MÊME message : la fonction ne distingue pas ce qui n'existe pas de
	--    ce qui appartient à autrui.
	select v.* into version_cible
	  from public.workflow_versions v
	 where v.id = target_version_id;

	if not found then
		raise exception 'version introuvable'
			using errcode = 'P0001',
			      detail  = 'aucune version lisible ne porte cet identifiant';
	end if;

	-- 4. Deux versions de workflows distincts ne partagent AUCUN identifiant d'étape ni de champ :
	--    leur comparaison rendrait « tout retiré, tout ajouté », un document volumineux et vide de
	--    sens que l'appelant prendrait pour une réponse.
	if version_base.workflow_id <> version_cible.workflow_id then
		raise exception 'versions de workflows differents'
			using errcode = 'P0001',
			      detail  = 'une comparaison ne porte que sur deux versions du meme workflow';
	end if;

	-- La clé `workflow` du document n'est pas un tableau : elle est enveloppée dans un tableau d'un
	-- élément et passée au MÊME algorithme, avec `id` pour identité. Les deux versions portant le
	-- même workflow_id, l'objet est toujours apparié — d'où la seule clé `modified` conservée.
	changements := pg_catalog.jsonb_build_object(
		'workflow', pg_catalog.jsonb_build_object(
			'modified',
			app.composition_collection_diff(
				pg_catalog.jsonb_build_array(version_base.composition -> 'workflow'),
				pg_catalog.jsonb_build_array(version_cible.composition -> 'workflow'),
				array['id']
			) -> 'modified'
		),
		'steps', app.composition_collection_diff(
			version_base.composition -> 'steps',
			version_cible.composition -> 'steps',
			array['id']
		),
		'transitions', app.composition_collection_diff(
			version_base.composition -> 'transitions',
			version_cible.composition -> 'transitions',
			array['id']
		),
		'fields', app.composition_collection_diff(
			version_base.composition -> 'fields',
			version_cible.composition -> 'fields',
			array['id']
		),
		-- `rules` et `required_fields` n'ont PAS d'identifiant propre dans le document : leur
		-- identité est le couple qui les définit en base (§7 ter.11.2).
		'rules', app.composition_collection_diff(
			version_base.composition -> 'rules',
			version_cible.composition -> 'rules',
			array['field_id', 'step_id']
		),
		'required_fields', app.composition_collection_diff(
			version_base.composition -> 'required_fields',
			version_cible.composition -> 'required_fields',
			array['transition_id', 'field_id']
		),
		-- `CRM-112` T2.c.2 : les champs COMMUNS exigés, photographiés par la `0157` sous `required_common_fields`, et
		-- seulement quand le workflow en exige. Une version qui ne porte pas la clé n'en exigeait aucun : le diff lit
		-- alors un tableau vide. Sans cette collection, deux versions qui ne diffèrent que par elle avaient deux
		-- empreintes différentes et six collections vides — l'invariant ci-dessous était faux.
		'required_common_fields', app.composition_collection_diff(
			version_base.composition -> 'required_common_fields',
			version_cible.composition -> 'required_common_fields',
			array['transition_id', 'common_field_id']
		)
	);

	-- `summary` compte les ÉLÉMENTS, non les attributs : une étape dont trois attributs changent
	-- compte pour UN `modified` (§7 ter.11.4).
	foreach collection in array array['workflow', 'steps', 'transitions', 'fields', 'rules', 'required_fields', 'required_common_fields']
	loop
		nombre_ajouts := nombre_ajouts + coalesce(
			pg_catalog.jsonb_array_length(changements -> collection -> 'added'), 0);
		nombre_retraits := nombre_retraits + coalesce(
			pg_catalog.jsonb_array_length(changements -> collection -> 'removed'), 0);
		nombre_modifies := nombre_modifies + coalesce(
			pg_catalog.jsonb_array_length(changements -> collection -> 'modified'), 0);
	end loop;

	return pg_catalog.jsonb_build_object(
		'base', pg_catalog.jsonb_build_object(
			'version_id',              version_base.id,
			'version_number',          version_base.version_number,
			'published_at',            version_base.published_at,
			'composition_fingerprint', version_base.composition_fingerprint
		),
		'target', pg_catalog.jsonb_build_object(
			'version_id',              version_cible.id,
			'version_number',          version_cible.version_number,
			'published_at',            version_cible.published_at,
			'composition_fingerprint', version_cible.composition_fingerprint
		),
		-- INVARIANT, et non commodité : l'empreinte est le condensé du document, donc deux
		-- empreintes égales imposent sept collections vides, et deux empreintes différentes
		-- imposent au moins un écart. Les preuves l'éprouvent DANS LES DEUX SENS.
		'identical', version_base.composition_fingerprint = version_cible.composition_fingerprint,
		'summary', pg_catalog.jsonb_build_object(
			'added',    nombre_ajouts,
			'removed',  nombre_retraits,
			'modified', nombre_modifies
		),
		'changes', changements
	);
end;
$function$;

CREATE OR REPLACE FUNCTION public.compare_workflow_with_source(workflow_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
	copie          public.workflows;
	source         public.workflows;
	document_copie  jsonb;
	document_source jsonb;
	changements    jsonb;
	nombre_ajouts   integer := 0;
	nombre_retraits integer := 0;
	nombre_modifies integer := 0;
	collection     text;
begin
	-- Refus n° 1. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient les appels
	-- qui ne passeraient pas par PostgREST.
	if auth.uid() is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- Refus n° 2. La copie existe ET est lisible par l'appelant : la RLS fait les deux.
	select w.* into copie
	  from public.workflows w
	 where w.id = compare_workflow_with_source.workflow_id;

	if not found then
		raise exception 'workflow introuvable'
			using errcode = 'P0001',
			      detail  = 'aucun workflow lisible ne porte cet identifiant';
	end if;

	-- Refus n° 3. N'être la copie de personne est le cas NORMAL (§4 bis.5). C'est tout de même un
	-- refus et non une réponse vide : comparer un workflow à une source qui n'existe pas n'a pas de
	-- résultat, fût-il vide.
	if copie.derived_from_workflow_id is null then
		raise exception 'workflow non derive'
			using errcode = 'P0001',
			      detail  = 'ce workflow n''est la copie d''aucun autre';
	end if;

	-- Refus n° 4. Atteignable malgré `on delete set null` : la clé étrangère met `null` quand la
	-- source est SUPPRIMÉE, mais la source peut être devenue illisible sans avoir disparu. Les deux
	-- chemins mènent à un refus, jamais à un document trompeur.
	select w.* into source
	  from public.workflows w
	 where w.id = copie.derived_from_workflow_id;

	if not found then
		raise exception 'source introuvable'
			using errcode = 'P0001',
			      detail  = 'la source de cette copie n''est plus lisible';
	end if;

	document_source := app.workflow_composition_naturel(source.id);
	document_copie  := app.workflow_composition_naturel(copie.id);

	-- L'ORIENTATION EST FIXE ET ÉCRITE (§4 ter.6) : la source est la base, la copie est la cible.
	-- « Ajouté » signifie donc « présent dans la copie, absent de la source ». C'est le sens que
	-- l'utilisateur attend — il regarde sa copie et demande en quoi elle s'écarte de son origine.
	changements := pg_catalog.jsonb_build_object(
		'steps', app.composition_collection_diff(
			document_source -> 'steps',
			document_copie  -> 'steps',
			array['node_id']
		),
		'transitions', app.composition_collection_diff(
			document_source -> 'transitions',
			document_copie  -> 'transitions',
			array['from_node_id', 'to_node_id']
		),
		'fields', app.composition_collection_diff(
			document_source -> 'fields',
			document_copie  -> 'fields',
			array['key']
		),
		'rules', app.composition_collection_diff(
			document_source -> 'rules',
			document_copie  -> 'rules',
			array['field_key', 'node_id']
		),
		'required_fields', app.composition_collection_diff(
			document_source -> 'required_fields',
			document_copie  -> 'required_fields',
			array['from_node_id', 'to_node_id', 'field_key']
		),
		-- `CRM-112` T2.c.2 : une copie reste dans l'espace de sa source, et garde le MÊME champ commun ; son identité
		-- naturelle est le couple de nœuds et la clé du champ.
		'required_common_fields', app.composition_collection_diff(
			document_source -> 'required_common_fields',
			document_copie  -> 'required_common_fields',
			array['from_node_id', 'to_node_id', 'common_field_key']
		)
	);

	-- `summary` compte les ÉLÉMENTS, non les attributs : une étape dont trois attributs changent
	-- compte pour UN `modified` (§4 ter.6).
	foreach collection in array array['steps', 'transitions', 'fields', 'rules', 'required_fields', 'required_common_fields']
	loop
		nombre_ajouts := nombre_ajouts + coalesce(
			pg_catalog.jsonb_array_length(changements -> collection -> 'added'), 0);
		nombre_retraits := nombre_retraits + coalesce(
			pg_catalog.jsonb_array_length(changements -> collection -> 'removed'), 0);
		nombre_modifies := nombre_modifies + coalesce(
			pg_catalog.jsonb_array_length(changements -> collection -> 'modified'), 0);
	end loop;

	return pg_catalog.jsonb_build_object(
		'workflow', pg_catalog.jsonb_build_object(
			'workflow_id', copie.id,
			'name',        copie.name
		),
		'source', pg_catalog.jsonb_build_object(
			'workflow_id', source.id,
			'name',        source.name,
			'archived_at', source.archived_at
		),
		-- `identical` NE PEUT PAS être fondé sur les empreintes du §4.6, à la différence de
		-- `compare_workflow_versions` : l'empreinte condense le document canonique IDENTIFIANTS
		-- LOCAUX COMPRIS, et ceux de deux workflows distincts diffèrent toujours. Deux empreintes
		-- différentes ne disent donc rien ici, et s'y fier serait une fausse preuve. Le verdict est
		-- pris sur les six collections, et sur elles seules.
		'identical', (nombre_ajouts = 0 and nombre_retraits = 0 and nombre_modifies = 0),
		'summary', pg_catalog.jsonb_build_object(
			'added',    nombre_ajouts,
			'removed',  nombre_retraits,
			'modified', nombre_modifies
		),
		'changes', changements
	);
end;
$function$;


-- L'aperçu des effets d'une exigence de champ commun — la jumelle de `previsualiser_exigence` (0036, 0121) pour une
-- cible de transition. `security invoker` : la lecture de l'appelant fait foi, il ne compte que ce qu'il lit. Un champ
-- archivé ou inconnu rend 0 : l'exigence serait refusée ou sans effet, et annoncer un nombre promettrait une contrainte
-- que `move_card` n'appliquerait pas. Une transition inconnue rend 0 aussi : c'est une course entre la lecture de l'écran
-- et l'appel, que l'écriture suivante signalera elle-même.
create or replace function public.preview_common_field_requirement(p_common_field_id uuid, p_transition_id uuid)
returns table (at_entry bigint)
language plpgsql
stable
set search_path = ''
as $function$
begin
	if not exists (
		select 1 from public.card_common_fields f where f.id = p_common_field_id and f.archived_at is null
	) then
		return query select 0::bigint;
		return;
	end if;

	-- À L'ENTRÉE — les affaires dont un rattachement non archivé est à l'étape de départ, et dont la valeur commune est
	-- vide. La valeur est celle de l'AFFAIRE, partagée par ses rattachements : `count(distinct card_id)`, une affaire
	-- rattachée deux fois au départ ne compte qu'une fois.
	return query
	select count(distinct p.card_id)::bigint
	  from public.workflow_transitions t
	  join public.card_placements p on p.current_step_id = t.from_step_id and p.archived_at is null
	 where t.id = p_transition_id
	   and not exists (
	       select 1
	         from public.card_common_field_values v
	        where v.card_id = p.card_id
	          and v.field_id = p_common_field_id
	          and not app.valeur_de_champ_est_vide(v.value)
	   );
end;
$function$;

comment on function public.preview_common_field_requirement(uuid, uuid) is
	'CRM-112 T3.b — docs/SPEC-champs-communs.md §7 : le nombre d''affaires dont un rattachement est à l''étape de départ de '
	'la transition et dont la valeur commune est vide ; 0 pour un champ archivé ou inconnu.';

revoke all on function public.preview_common_field_requirement(uuid, uuid) from public;
grant execute on function public.preview_common_field_requirement(uuid, uuid) to authenticated, service_role;
