-- @spec CRM-032 (docs/BACKLOG.md) — copie d'un workflow vers un track, dernière tranche : la
--       comparaison copie ↔ source
-- @spec docs/SPEC-workflow-engine.md §4 ter (la comparaison), §4 ter.1 (pourquoi
--       `compare_workflow_versions` ne peut pas servir), §4 ter.2 (les clés naturelles et l'index
--       unique qui fonde chacune), §4 ter.3 (le document naturalisé), §4 ter.4 (le geste),
--       §4 ter.5 (les quatre refus), §4 ter.6 (ce que la fonction rend), §4 ter.7 (ce qu'elle ne
--       fait pas), §4 ter.8 (contrat d'API)
-- @spec docs/SPEC-workflow-engine.md §4.1 (« propose de comparer »), §4.5 (ce que la copie copie et
--       comment les arêtes sont remappées), §4.6 (la vue de divergence, qui dit QU'une source a
--       changé là où ce chapitre dit QUOI)
-- @spec docs/SPEC-workflow-engine.md §7 ter.2 (document canonique), §7 ter.11.5 (l'algorithme de
--       différence, réutilisé et non réécrit)
-- @spec docs/SCHEMA.md §9 (fonctions et RPC)
-- @spec docs/SPEC-permissions-rls.md §4 (l'écriture des workflows est réservée ; la LECTURE, qui
--       est tout ce que ce geste demande, suit la politique de `public.workflows`)
-- @spec docs/PROD_MIGRATIONS.md §3 (migration 43)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE, ET CE QU'ELLE NE LIVRE PAS.
-- ---------------------------------------------------------------------------------------------
-- Le §4 bis a livré la MENTION de divergence : l'écran dit QU'une source a changé depuis la copie.
-- Il ne dit pas QUOI. Le §4.1 promet pourtant que l'interface « propose de comparer », et le
-- §4 bis.7 nomme cette comparaison comme le seul reste de CRM-032.
--
-- Livré ici : `public.compare_workflow_with_source` rend quelles étapes, arêtes, questions, règles
-- et exigences distinguent une copie de sa source VIVANTE, et pour chaque modification quel attribut
-- a changé, de quelle valeur à quelle valeur.
--
-- Non livré, et nommé (§4 ter.7) : tout écran — la mention du §4 bis reste sans commande, comme le
-- §4 bis.6 l'exige —, toute resynchronisation, toute réapplication. Les deux fonctions sont
-- `stable` : elles n'écrivent RIEN, et le §4.1 l'impose en toutes lettres, « sans jamais
-- réappliquer automatiquement ».
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI UNE SECONDE COMPARAISON, ET NON UN APPEL À CELLE DE CRM-078.
-- ---------------------------------------------------------------------------------------------
-- `public.compare_workflow_versions` (migration 40) pose que l'identité est un identifiant, jamais
-- une ressemblance. La règle est juste entre deux versions d'un MÊME workflow, qui partagent leurs
-- identifiants. Entre une copie et sa source, elle est inapplicable, et c'est MESURÉ : zéro étape de
-- la copie du seed partage son identifiant avec une étape de la source. Appelée telle quelle, la
-- comparaison rendrait « sept étapes retirées, sept ajoutées » sur deux workflows rigoureusement
-- identiques — un document volumineux et faux.
--
-- La copie ne conserve AUCUN identifiant de composition de sa source ; c'est le §4.5 qui l'exige.
-- L'appariement se fait donc sur LES CLÉS NATURELLES QUI ONT SERVI AU REMAPPAGE, et sur elles
-- seules : `node_id` pour une étape, le couple de nœuds pour une arête, `key` pour un champ.
-- Comparer sur autre chose serait comparer sur une base dont la copie n'a jamais été construite.
--
-- L'ALGORITHME, LUI, N'EST PAS RÉÉCRIT : `app.composition_collection_diff` de la migration 40 est
-- appelé cinq fois. Écrire cinq comparaisons spécialisées produirait cinq occasions de diverger.
--
-- ---------------------------------------------------------------------------------------------
-- IDEMPOTENCE ET CONVERGENCE : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de CRM-001 ne tient aucun registre et rejoue tout le répertoire à chaque
-- démarrage de la pile (docs/JOURNAL.md, décision 20). Chaque fonction est donc posée en
-- `create or replace`, et ses privilèges sont RÉAFFIRMÉS à chaque passage, de sorte qu'un `grant`
-- retiré à la main soit RÉTABLI par un rejeu (décision 57) et non simplement laissé en l'état.

begin;

-- ---------------------------------------------------------------------------------------------
-- 1. Le document naturalisé
-- ---------------------------------------------------------------------------------------------
-- Deux règles la définissent, et le §4 ter.3 les écrit :
--
-- 1. TOUT IDENTIFIANT LOCAL DISPARAÎT. `id`, `workflow_id`, `from_step_id`, `to_step_id`,
--    `field_id`, `step_id`, `transition_id` n'ont aucun sens partagé entre deux workflows ; les
--    laisser ferait diverger deux compositions identiques.
--
-- 2. LES ATTRIBUTS QUE LA COPIE NE COPIE PAS SONT EXCLUS. Le §4.5 les nomme : `scope`, `track_id`,
--    `is_default`, le `name` du workflow et son `archived_at`. Les inclure ferait déclarer
--    divergente toute copie DÈS SA NAISSANCE — c'est-à-dire rendrait la fonction inutilisable sur
--    son cas d'emploi principal. La collection `workflow` est donc absente d'ici.
--
-- `node_key` figure comme ATTRIBUT et non comme identité : un nœud du catalogue renommé ne doit pas
-- transformer une étape en un retrait suivi d'un ajout.
--
-- `stable` et non `immutable` : elle lit des tables, par l'intermédiaire du document canonique.
-- `security invoker` par défaut — donc soumise aux politiques RLS de l'appelant, ce qui est
-- exactement ce qu'on lui demande.

create or replace function app.workflow_composition_naturel(target_workflow_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
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
		), '[]'::jsonb)
	)
	  from document d
	 where d.j is not null;
$$;

comment on function app.workflow_composition_naturel(uuid) is
	'Document canonique d''un workflow ré-exprimé en CLÉS NATURELLES — node_id pour une étape, le '
	'couple de nœuds pour une arête, key pour un champ. Aucun identifiant local, et aucun attribut '
	'que la copie ne copie pas. C''est la seule forme sous laquelle une copie et sa source sont '
	'comparables. CRM-032, docs/SPEC-workflow-engine.md §4 ter.3.';

revoke all on function app.workflow_composition_naturel(uuid) from public;
grant execute on function app.workflow_composition_naturel(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Le geste : comparer une copie à sa source vivante
-- ---------------------------------------------------------------------------------------------
-- `security invoker` — donc SANS `security definer`. Le motif est celui écrit pour
-- `compare_workflow_versions` : la politique de lecture de `public.workflows` EST déjà la règle
-- d'autorisation exacte de ce geste, et deux formulations d'une même règle finissent par diverger.
--
-- Conséquence directe, et c'est une garantie et non un oubli : AUCUN contrôle de workspace n'est
-- écrit à la main ci-dessous. Un workflow d'un autre workspace n'est pas donné à lire par la RLS,
-- `not found` s'ensuit, et le refus rendu est le MÊME que pour un identifiant inexistant — la
-- fonction n'est donc pas un oracle d'existence (§4.3, §4 ter.4).
--
-- UN SEUL ARGUMENT : la copie. La source n'est pas un paramètre, elle est lue dans
-- `derived_from_workflow_id`. Passer les deux permettrait de comparer deux workflows sans lien, ce
-- que le §4 ter ne spécifie pas et que rien ne demande.

create or replace function public.compare_workflow_with_source(workflow_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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
		)
	);

	-- `summary` compte les ÉLÉMENTS, non les attributs : une étape dont trois attributs changent
	-- compte pour UN `modified` (§4 ter.6).
	foreach collection in array array['steps', 'transitions', 'fields', 'rules', 'required_fields']
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
		-- pris sur les cinq collections, et sur elles seules.
		'identical', (nombre_ajouts = 0 and nombre_retraits = 0 and nombre_modifies = 0),
		'summary', pg_catalog.jsonb_build_object(
			'added',    nombre_ajouts,
			'removed',  nombre_retraits,
			'modified', nombre_modifies
		),
		'changes', changements
	);
end;
$$;

comment on function public.compare_workflow_with_source(uuid) is
	'Dit en quoi une COPIE s''écarte de sa source vivante : workflow, source, identical, summary et '
	'changes sur cinq collections. L''appariement se fait sur les clés naturelles du remappage — la '
	'copie ne partage aucun identifiant de composition avec sa source. SECURITY INVOKER : la '
	'politique de lecture de workflows est déjà la règle d''autorisation. Quatre refus. N''écrit '
	'rien. CRM-032, docs/SPEC-workflow-engine.md §4 ter.';

-- La révocation nommée d'`anon` est obligatoire : le `grant execute` par défaut de l'image porte
-- sur `anon` aussi (décision 80). Sans elle, l'anonyme obtiendrait 403 au lieu de 401, et le
-- contrôle 1 serait le seul rempart.
revoke all on function public.compare_workflow_with_source(uuid) from public, anon;
grant execute on function public.compare_workflow_with_source(uuid) to authenticated, service_role;

commit;
