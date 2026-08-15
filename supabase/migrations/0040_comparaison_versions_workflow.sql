-- @spec CRM-078 (docs/BACKLOG.md) — versionnement des workflows, deuxième tranche : comparaison
--       de deux versions
-- @spec docs/SPEC-workflow-engine.md §7 ter.11 (la comparaison), §7 ter.11.2 (l'identité est un
--       identifiant, jamais une ressemblance), §7 ter.11.3 (le geste et ses quatre refus),
--       §7 ter.11.4 (ce que la fonction rend), §7 ter.11.5 (un seul algorithme, appelé six fois),
--       §7 ter.11.6 (contrat d'API), §7 ter.11.7 (ce qui n'est pas livré)
-- @spec docs/SPEC-workflow-engine.md §7 ter.2 (document canonique comparé)
-- @spec docs/SCHEMA.md §9 (fonctions et RPC)
-- @spec docs/SPEC-permissions-rls.md §7 (preuve de refus n° 3)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE, ET CE QU'ELLE NE LIVRE PAS.
-- ---------------------------------------------------------------------------------------------
-- La première tranche CONSERVE des documents ; elle ne les LIT pas. Deux versions d'un même
-- workflow sont deux blocs `jsonb` de plusieurs milliers de caractères, et dire ce qui a changé
-- entre les deux suppose de les parcourir à l'œil.
--
-- Livré ici : `public.compare_workflow_versions` rend quelles étapes, arêtes, questions, règles et
-- exigences ont été ajoutées, retirées ou modifiées, et pour chaque modification quel attribut a
-- changé, de quelle valeur à quelle valeur.
--
-- Non livré, et nommé (docs/SPEC-workflow-engine.md §7 ter.11.7) : le plan de remappage des cards,
-- son application transactionnelle, son retour arrière, tout écran, la comparaison d'une version
-- avec la structure VIVANTE, et tout seed. La fonction est `stable` : elle n'écrit RIEN.
--
-- ---------------------------------------------------------------------------------------------
-- LA RÈGLE DE FOND : L'IDENTITÉ EST UN IDENTIFIANT, JAMAIS UNE RESSEMBLANCE.
-- ---------------------------------------------------------------------------------------------
-- La Definition of Done de CRM-078 exige qu'AUCUNE ÉTAPE NE SOIT DEVINÉE. Cette exigence se tranche
-- ICI : c'est la comparaison qui décide si « Négociation » renommée en « Négociation commerciale »
-- est UNE étape modifiée, ou DEUX étapes — l'une retirée, l'autre ajoutée.
--
-- Deux éléments sont le même élément SI ET SEULEMENT SI leur identité est égale, l'identité étant
-- faite d'identifiants réels et d'eux seuls. Aucun libellé, aucune position, aucune distance de
-- chaîne, aucune proximité de clé n'entre dans ce calcul. Le document canonique du §7 ter.2 porte
-- les identifiants réels des objets vivants : c'est ce qui rend la règle applicable.
--
-- Conséquence assumée : une étape supprimée puis recréée à l'identique rend UN RETRAIT ET UN AJOUT,
-- jamais un inchangé. C'est la vérité de la base — la seconde ligne n'est pas la première — et
-- toute autre réponse serait une supposition. Une assertion pgTAP la fige.
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
-- 1. L'algorithme de différence, qui ne connaît RIEN aux workflows
-- ---------------------------------------------------------------------------------------------
-- Écrire cinq comparaisons spécialisées aurait produit cinq occasions de diverger — c'est le défaut
-- qu'a corrigé l'extraction du document canonique en migration 39, et il n'est pas réintroduit ici.
-- Cette fonction reçoit deux tableaux d'objets et la liste des clés qui font l'identité ; elle est
-- appelée SIX fois par la RPC.
--
-- `immutable` : la valeur rendue ne dépend que des arguments, aucune lecture de table. `search_path`
-- vide et qualification complète de chaque objet, convention du projet pour toute fonction du
-- schéma `app`.

create or replace function app.composition_collection_diff(
	base_collection   jsonb,
	target_collection jsonb,
	identity_keys     text[]
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	with base_elements as (
		select
			(
				select pg_catalog.jsonb_object_agg(k, e.value -> k)
				  from pg_catalog.unnest(identity_keys) as k
			) as identity,
			e.value as element
		  from pg_catalog.jsonb_array_elements(
		       coalesce(base_collection, '[]'::jsonb)
		  ) as e(value)
	),
	target_elements as (
		select
			(
				select pg_catalog.jsonb_object_agg(k, e.value -> k)
				  from pg_catalog.unnest(identity_keys) as k
			) as identity,
			e.value as element
		  from pg_catalog.jsonb_array_elements(
		       coalesce(target_collection, '[]'::jsonb)
		  ) as e(value)
	),
	-- AJOUTÉ = présent dans la cible, absent de la base. L'orientation est celle des arguments, et
	-- la fonction ne la corrige pas (§7 ter.11.3).
	added as (
		select t.identity, t.element
		  from target_elements t
		 where not exists (
		       select 1 from base_elements b where b.identity = t.identity
		 )
	),
	removed as (
		select b.identity, b.element
		  from base_elements b
		 where not exists (
		       select 1 from target_elements t where t.identity = b.identity
		 )
	),
	-- APPARIÉS ET DIFFÉRENTS. `is distinct from` et non `<>` : un élément nul ne doit pas rendre la
	-- comparaison nulle et faire disparaître silencieusement une modification.
	paired as (
		select b.identity, b.element as avant, t.element as apres
		  from base_elements b
		  join target_elements t on t.identity = b.identity
		 where b.element is distinct from t.element
	),
	-- Seuls les attributs RÉELLEMENT différents figurent dans la liste. L'union des clés des deux
	-- côtés, et non les seules clés de la base : un attribut APPARU serait autrement invisible. Un
	-- attribut apparu ou disparu figure avec `null` du côté où il manque, ce que `->` rend déjà.
	modified as (
		select
			p.identity,
			(
				select pg_catalog.jsonb_agg(
					pg_catalog.jsonb_build_object(
						'name',   ks.k,
						'before', p.avant -> ks.k,
						'after',  p.apres -> ks.k
					) order by ks.k
				)
				  from (
				       select pg_catalog.jsonb_object_keys(p.avant) as k
				       union
				       select pg_catalog.jsonb_object_keys(p.apres) as k
				  ) as ks
				 where (p.avant -> ks.k) is distinct from (p.apres -> ks.k)
			) as attributes
		  from paired p
	)
	-- TOUS LES TABLEAUX SONT ORDONNÉS, par identité puis par nom d'attribut (ci-dessus). Une
	-- fonction `stable` qui rendrait deux ordres différents pour la même paire rendrait toute
	-- assertion instable et toute comparaison d'écran clignotante (§7 ter.11.4).
	select pg_catalog.jsonb_build_object(
		'added', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object('identity', a.identity, 'element', a.element)
				order by a.identity::text
			) from added a
		), '[]'::jsonb),
		'removed', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object('identity', r.identity, 'element', r.element)
				order by r.identity::text
			) from removed r
		), '[]'::jsonb),
		'modified', coalesce((
			select pg_catalog.jsonb_agg(
				pg_catalog.jsonb_build_object('identity', m.identity, 'attributes', m.attributes)
				order by m.identity::text
			) from modified m
		), '[]'::jsonb)
	);
$$;

comment on function app.composition_collection_diff(jsonb, jsonb, text[]) is
	'Différence entre deux tableaux d''objets jsonb appariés par une identité donnée : added, '
	'removed, modified avec le détail attribut par attribut. Ne connaît rien aux workflows — un '
	'seul algorithme, appelé six fois. CRM-078, docs/SPEC-workflow-engine.md §7 ter.11.5.';

revoke all on function app.composition_collection_diff(jsonb, jsonb, text[]) from public;
grant execute on function app.composition_collection_diff(jsonb, jsonb, text[])
	to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Le geste : comparer deux versions
-- ---------------------------------------------------------------------------------------------
-- `security invoker` — donc SANS `security definer`, à la différence de `publish_workflow_version`.
-- Le choix est délibéré : la politique de lecture de `public.workflow_versions` EST déjà la règle
-- d'autorisation exacte de ce geste. Une fonction `definer` devrait la réécrire dans son corps, et
-- deux formulations de la même règle finissent toujours par diverger. Précédent du dépôt :
-- `public.previsualiser_exigence` (§7 bis.13.3).
--
-- Conséquence directe, et c'est une garantie et non un oubli : AUCUN contrôle de workspace n'est
-- écrit à la main ci-dessous. Une version d'un autre workspace n'est pas donnée à lire par la RLS,
-- `not found` s'ensuit, et le refus rendu est le MÊME que pour un identifiant inexistant — la
-- fonction n'est donc pas un oracle d'existence (§4.3).

create or replace function public.compare_workflow_versions(
	base_version_id   uuid,
	target_version_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
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
		)
	);

	-- `summary` compte les ÉLÉMENTS, non les attributs : une étape dont trois attributs changent
	-- compte pour UN `modified` (§7 ter.11.4).
	foreach collection in array array['workflow', 'steps', 'transitions', 'fields', 'rules', 'required_fields']
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
		-- empreintes égales imposent six collections vides, et deux empreintes différentes
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
$$;

comment on function public.compare_workflow_versions(uuid, uuid) is
	'Compare deux versions d''un même workflow : base, target, identical, summary et changes sur '
	'les six collections. Aucune correspondance n''est devinée — l''identité est faite '
	'd''identifiants réels et d''eux seuls. SECURITY INVOKER : la politique de lecture de '
	'workflow_versions est déjà la règle d''autorisation. Quatre refus. CRM-078, '
	'docs/SPEC-workflow-engine.md §7 ter.11.';

-- La révocation nommée d'`anon` est obligatoire : le `grant execute` par défaut de l'image porte
-- sur `anon` aussi (décision 80). Sans elle, l'anonyme obtiendrait 403 au lieu de 401, et le
-- contrôle 1 serait le seul rempart.
revoke all on function public.compare_workflow_versions(uuid, uuid) from public, anon;
grant execute on function public.compare_workflow_versions(uuid, uuid) to authenticated, service_role;

commit;
