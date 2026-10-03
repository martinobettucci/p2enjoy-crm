-- @spec CRM-097 (docs/BACKLOG.md) — tranche T3.a : faire évoluer un workflow existant par une suggestion de l'IA
-- @spec docs/SPEC-ia.md §13.1 (la cible entière, identifiée par clés ; `remappages`), §13.2 (la composition vivante et
--       l'occupation), §13.3 (les cinq codes d'une modification), §13.4 (accepter par le cœur de la restauration) ;
--       docs/SPEC-workflow-engine.md §7 ter.13 (la restauration, dont le cœur est extrait SANS CHANGEMENT) ;
--       docs/SCHEMA.md « Migration `0086` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décision 620
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- 1. La forme d'une proposition admet `remappages`, facultative.
-- 2. `app.defauts_proposition_ia` reçoit le workflow ciblé et relève cinq codes de plus pour une modification ; le
--    trigger des révisions le lui passe.
-- 3. LE CŒUR DE LA RESTAURATION est extrait de `public.restore_workflow_version` (migration 42) en
--    `app.appliquer_composition`, mot pour mot ; la restauration l'appelle. Un seul algorithme applique un document
--    de composition, que ce document vienne d'une version ou d'une suggestion — les suites de `CRM-078` le prouvent.
-- 4. `public.proposition_du_workflow` et `public.occupation_du_workflow`, lectures sous la RLS.
-- 5. `app.document_cible_ia`, la cible traduite en document de composition.
-- 6. `public.accepter_suggestion_ia` accepte une modification.
--
-- IDEMPOTENTE ET CONVERGENTE. Une adoption rejoue `0084`, qui repose `app.defauts_proposition_ia(uuid, jsonb)` ; elle
-- est retirée ici, la version à trois arguments la remplaçant (deux surcharges rendraient l'appel ambigu).

-- ---------------------------------------------------------------------------------------------
-- 1. La forme
-- ---------------------------------------------------------------------------------------------
create or replace function app.proposition_ia_bien_formee(p jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
	liste text;
	texte constant text := 'string';
begin
	if jsonb_typeof(p) is distinct from 'object'
	   or p -> 'version' is distinct from '1'::jsonb
	   or jsonb_typeof(p -> 'workflow') is distinct from 'object'
	   or jsonb_typeof(p -> 'workflow' -> 'nom') is distinct from texte then
		return false;
	end if;
	foreach liste in array array['noeuds', 'etapes', 'transitions', 'champs', 'regles', 'exigences'] loop
		if jsonb_typeof(p -> liste) is distinct from 'array' then
			return false;
		end if;
	end loop;
	-- `remappages` est FACULTATIVE (docs/SPEC-ia.md §13.1, `CRM-097` T3) : absente, ou un tableau.
	if p ? 'remappages' and jsonb_typeof(p -> 'remappages') is distinct from 'array' then
		return false;
	end if;
	if jsonb_array_length(p -> 'noeuds') + jsonb_array_length(p -> 'etapes') + jsonb_array_length(p -> 'transitions')
	   + jsonb_array_length(p -> 'champs') + jsonb_array_length(p -> 'regles') + jsonb_array_length(p -> 'exigences') > 200 then
		return false;
	end if;

	return coalesce((select bool_and(
		jsonb_typeof(e) = 'object'
		and jsonb_typeof(e -> 'cle') is not distinct from texte
		and jsonb_typeof(e -> 'libelle') is not distinct from texte
		and jsonb_typeof(e -> 'nature') is not distinct from texte
		and coalesce(jsonb_typeof(e -> 'probabilite'), 'null') in ('number', 'null'))
		from jsonb_array_elements(p -> 'noeuds') e), true)
	and coalesce((select bool_and(
		jsonb_typeof(e) = 'object'
		and jsonb_typeof(e -> 'noeud') is not distinct from texte
		and jsonb_typeof(e -> 'initiale') is not distinct from 'boolean')
		from jsonb_array_elements(p -> 'etapes') e), true)
	and coalesce((select bool_and(
		jsonb_typeof(e) = 'object'
		and jsonb_typeof(e -> 'de') is not distinct from texte
		and jsonb_typeof(e -> 'vers') is not distinct from texte
		and jsonb_typeof(e -> 'libelle') is not distinct from texte
		and jsonb_typeof(e -> 'commentaire_requis') is not distinct from 'boolean')
		from jsonb_array_elements(p -> 'transitions') e), true)
	and coalesce((select bool_and(
		jsonb_typeof(e) = 'object'
		and jsonb_typeof(e -> 'cle') is not distinct from texte
		and jsonb_typeof(e -> 'libelle') is not distinct from texte
		and jsonb_typeof(e -> 'type') is not distinct from texte
		and coalesce(jsonb_typeof(e -> 'choix'), 'null') in ('array', 'null')
		and (jsonb_typeof(e -> 'choix') is distinct from 'array'
		     or not jsonb_path_exists(e -> 'choix', '$[*] ? (@.type() != "string")'))
		and coalesce(jsonb_typeof(e -> 'devise'), 'null') in ('string', 'null')
		and coalesce(jsonb_typeof(e -> 'aide'), 'null') in ('string', 'null'))
		from jsonb_array_elements(p -> 'champs') e), true)
	and coalesce((select bool_and(
		jsonb_typeof(e) = 'object'
		and jsonb_typeof(e -> 'champ') is not distinct from texte
		and jsonb_typeof(e -> 'etape') is not distinct from texte
		and jsonb_typeof(e -> 'visibilite') is not distinct from texte)
		from jsonb_array_elements(p -> 'regles') e), true)
	and coalesce((select bool_and(
		jsonb_typeof(e) = 'object'
		and jsonb_typeof(e -> 'de') is not distinct from texte
		and jsonb_typeof(e -> 'vers') is not distinct from texte
		and jsonb_typeof(e -> 'champ') is not distinct from texte)
		from jsonb_array_elements(p -> 'exigences') e), true)
	and coalesce((select bool_and(
		jsonb_typeof(e) = 'object'
		and jsonb_typeof(e -> 'de') is not distinct from texte
		and jsonb_typeof(e -> 'vers') is not distinct from texte)
		from jsonb_array_elements(coalesce(p -> 'remappages', '[]'::jsonb)) e), true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Les défauts d'une modification, et le trigger qui les écrit
-- ---------------------------------------------------------------------------------------------
drop function if exists app.defauts_proposition_ia(uuid, jsonb);

create or replace function app.defauts_proposition_ia(p_workspace uuid, p_proposition jsonb, p_workflow uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
	for e in select value as v, ordinality - 1 as i from jsonb_array_elements(p_proposition -> 'champs') with ordinality loop
		cle := e.v ->> 'cle';
		if cle !~ cle_forme then
			defauts := defauts || jsonb_build_object('code', 'cle_invalide', 'chemin', format('champs[%s].cle', e.i), 'valeurs', jsonb_build_object('cle', cle));
		end if;
		if cle = any (champs) then
			defauts := defauts || jsonb_build_object('code', 'champ_en_double', 'chemin', format('champs[%s]', e.i), 'valeurs', jsonb_build_object('cle', cle));
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
			       (select count(*) from public.cards carte where carte.current_step_id = s.id) as nombre
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
$$;


revoke all on function app.defauts_proposition_ia(uuid, jsonb, uuid) from public;
grant execute on function app.defauts_proposition_ia(uuid, jsonb, uuid) to authenticated, service_role;

create or replace function app.suggestions_ia_revisions_avant_creation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	la_suggestion public.suggestions_ia%rowtype;
begin
	select * into la_suggestion from public.suggestions_ia where id = new.suggestion_id for update;
	-- `PT404` et non `P0002` (que `0083` levait) : PostgREST rend HTTP 500 pour `P0002`, mesuré le 2026-10-02 ; un
	-- `PT<statut>` porte le statut voulu (convention de `0042`).
	if not found then
		raise exception 'suggestion introuvable' using errcode = 'PT404';
	end if;
	if la_suggestion.statut <> 'en_revue' then
		raise exception 'suggestion figee' using errcode = 'P0001';
	end if;
	if current_user = 'authenticated' and new.origine <> 'correction' then
		raise exception 'seule une correction s''ecrit par le client' using errcode = '42501';
	end if;
	-- Une correction écrite pendant une génération serait aussitôt recouverte par la révision du modèle,
	-- calculée sur la version précédente (docs/SPEC-ia.md §12.2). Le verrou périmé ne compte plus (§11.4).
	if new.origine = 'correction'
	   and la_suggestion.generation_depuis is not null
	   and la_suggestion.generation_depuis > now() - interval '180 seconds' then
		raise exception 'generation en cours' using errcode = 'P0001';
	end if;
	new.workspace_id := la_suggestion.workspace_id;
	-- LA BASE JUGE, QUOI QUE L'APPELANT ENVOIE (décision 618) ; une forme invalide lève 22023.
	new.defauts := app.defauts_proposition_ia(la_suggestion.workspace_id, new.proposition, la_suggestion.workflow_id);
	new.numero := coalesce(
		(select max(r.numero) from public.suggestions_ia_revisions r where r.suggestion_id = new.suggestion_id), 0) + 1;
	return new;
end;
$$;

revoke all on function app.suggestions_ia_revisions_avant_creation() from public;

-- ---------------------------------------------------------------------------------------------
-- 3. Le cœur de la restauration, extrait — et la restauration qui l'appelle
-- ---------------------------------------------------------------------------------------------
-- SECURITY INVOKER : appelé par deux gestes `security definer`, il s'exécute sous leur propriétaire. Aucun client ne
-- l'appelle : le privilège est retiré à tous (section 5).
create or replace function app.appliquer_composition(
	p_workflow_id  uuid,
	p_workspace_id uuid,
	p_doc          jsonb,
	p_overrides    jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	n_cards    bigint := 0;
	n_step_new bigint := 0;
	n_step_del bigint := 0;
	n_step_maj bigint := 0;
	n_tr_new   bigint := 0;
	n_tr_del   bigint := 0;
	n_tr_maj   bigint := 0;
	n_ch_new   bigint := 0;
	n_ch_des   bigint := 0;
	n_ch_arc   bigint := 0;
	n_ch_maj   bigint := 0;
	n_rg_new   bigint := 0;
	n_rg_del   bigint := 0;
	n_rg_maj   bigint := 0;
	n_rq_new   bigint := 0;
	n_rq_del   bigint := 0;
begin
	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 2 — LES AFFAIRES, avant toute suppression d'étape.
	--
	-- MESURÉ : `cards_current_step_id_workflow_id_fkey` est en `NO ACTION`. Supprimer une étape
	-- qui porte encore une affaire échoue en `23503`. C'est ce fait, et lui seul, qui rend le plan
	-- obligatoire.
	--
	-- Le plan a rendu `ready` : chaque affaire est donc soit sur une étape que la version conserve
	-- — elle ne bouge pas —, soit couverte par une instruction. Appliquer les instructions suffit,
	-- et ne réécrit PAS la règle de résolution.
	--
	-- Une affaire remappée ne franchit AUCUNE arête : `move_card` n'est pas appelée, et ses gardes
	-- ne s'appliquent pas. Le trigger `card_events_apres_maj` écrit l'événement `moved` — la
	-- fonction n'en fabrique aucun.
	-- ---------------------------------------------------------------------------------------
	with instructions as (
		select (e.value ->> 'from_step_id')::uuid as from_step_id,
		       (e.value ->> 'to_step_id')::uuid   as to_step_id
		  from pg_catalog.jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) as e(value)
	)
	update public.cards c
	   set current_step_id = i.to_step_id,
	       entered_step_at = pg_catalog.now()
	  from instructions i
	 where c.workflow_id = p_workflow_id
	   and c.current_step_id = i.from_step_id;

	get diagnostics n_cards = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 3 — L'ÉTAPE INITIALE EST D'ABORD DÉMISE.
	--
	-- MESURÉ : `workflow_steps_workflow_initial_uk` est un index unique PARTIEL sur
	-- `(workflow_id) where is_initial`. Rétablir l'étape initiale de la version avant d'avoir
	-- défait l'actuelle échoue en `23505`. L'ordre n'est donc pas commutatif.
	-- ---------------------------------------------------------------------------------------
	update public.workflow_steps s
	   set is_initial = false
	 where s.workflow_id = p_workflow_id
	   and s.is_initial
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = s.id
		   and (e.value ->> 'is_initial')::boolean
	 );

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 4 — LES ÉTAPES RETIRÉES, dont les affaires sont parties. Leur suppression emporte
	-- en cascade leurs arêtes et leurs règles, ce qui allège les écritures 6 et 8.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_steps s
	 where s.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = s.id
	 );

	get diagnostics n_step_del = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 5 — LES ÉTAPES RÉTABLIES, avec leur identifiant d'origine que le document conserve.
	-- Après la suppression : `workflow_steps_workflow_id_node_id_key` veut qu'un nœud n'apparaisse
	-- qu'une fois par workflow, et une étape rétablie peut réclamer le nœud d'une étape retirée.
	-- ---------------------------------------------------------------------------------------
	insert into public.workflow_steps (
		id, workflow_id, workspace_id, node_id, position,
		label_override, probability_override, stale_after_days, is_initial
	)
	select (e.value ->> 'id')::uuid,
	       p_workflow_id,
	       p_workspace_id,
	       (e.value ->> 'node_id')::uuid,
	       (e.value ->> 'position')::numeric,
	       e.value ->> 'label_override',
	       (e.value ->> 'probability_override')::numeric,
	       (e.value ->> 'stale_after_days')::integer,
	       (e.value ->> 'is_initial')::boolean
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_steps s where s.id = (e.value ->> 'id')::uuid
	 );

	get diagnostics n_step_new = row_count;

	-- Les étapes conservées reprennent leurs colonnes photographiées. `is distinct from` : ce qui
	-- ne doit rien faire ne subit rien, et `updated_at` n'est pas réécrit sans motif.
	update public.workflow_steps s
	   set position             = (e.value ->> 'position')::numeric,
	       label_override       = e.value ->> 'label_override',
	       probability_override = (e.value ->> 'probability_override')::numeric,
	       stale_after_days     = (e.value ->> 'stale_after_days')::integer,
	       is_initial           = (e.value ->> 'is_initial')::boolean
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'steps', '[]'::jsonb)) as e(value)
	 where s.id = (e.value ->> 'id')::uuid
	   and s.workflow_id = p_workflow_id
	   and (s.position, s.label_override, s.probability_override, s.stale_after_days, s.is_initial)
	       is distinct from
	       ((e.value ->> 'position')::numeric, e.value ->> 'label_override',
	        (e.value ->> 'probability_override')::numeric,
	        (e.value ->> 'stale_after_days')::integer, (e.value ->> 'is_initial')::boolean);

	get diagnostics n_step_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 6 — LES ARÊTES. Leurs deux extrémités doivent exister, donc après les étapes. Une
	-- arête ne porte AUCUNE donnée utilisateur : la supprimer ne détruit que de la structure.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_transitions t
	 where t.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(
		       coalesce(p_doc -> 'transitions', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = t.id
	 );

	get diagnostics n_tr_del = row_count;

	insert into public.workflow_transitions (
		id, workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment
	)
	select (e.value ->> 'id')::uuid,
	       p_workflow_id,
	       p_workspace_id,
	       (e.value ->> 'from_step_id')::uuid,
	       (e.value ->> 'to_step_id')::uuid,
	       e.value ->> 'label',
	       (e.value ->> 'require_comment')::boolean
	  from pg_catalog.jsonb_array_elements(
	       coalesce(p_doc -> 'transitions', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_transitions t where t.id = (e.value ->> 'id')::uuid
	 );

	get diagnostics n_tr_new = row_count;

	update public.workflow_transitions t
	   set label           = e.value ->> 'label',
	       require_comment = (e.value ->> 'require_comment')::boolean
	  from pg_catalog.jsonb_array_elements(
	       coalesce(p_doc -> 'transitions', '[]'::jsonb)) as e(value)
	 where t.id = (e.value ->> 'id')::uuid
	   and t.workflow_id = p_workflow_id
	   and (t.label, t.require_comment)
	       is distinct from (e.value ->> 'label', (e.value ->> 'require_comment')::boolean);

	get diagnostics n_tr_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 7 — LES CHAMPS, ET AUCUN N'EST SUPPRIMÉ.
	--
	-- `card_field_values` porte les SAISIES des utilisateurs, et le document canonique n'en
	-- conserve aucune. MESURÉ, et c'est ce qui retire toute discussion : `public.form_fields` ne
	-- porte AUCUNE politique `delete`, et `authenticated` n'a que `select`, `insert`, `update`.
	-- La suppression d'un champ n'existe pas dans ce produit.
	--
	-- Un champ surnuméraire est donc ARCHIVÉ ; un champ archivé que la version portait actif est
	-- DÉSARCHIVÉ. La conséquence est assumée et rendue : l'empreinte d'après peut différer de
	-- celle de la version, et `matches_version` le dit.
	-- ---------------------------------------------------------------------------------------
	insert into public.form_fields (
		id, workflow_id, workspace_id, key, label, type, options, help_text, position, archived_at
	)
	select (e.value ->> 'id')::uuid,
	       p_workflow_id,
	       p_workspace_id,
	       e.value ->> 'key',
	       e.value ->> 'label',
	       e.value ->> 'type',
	       coalesce(e.value -> 'options', '{}'::jsonb),
	       e.value ->> 'help_text',
	       (e.value ->> 'position')::numeric,
	       (e.value ->> 'archived_at')::timestamptz
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'fields', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.form_fields f where f.id = (e.value ->> 'id')::uuid
	 );

	get diagnostics n_ch_new = row_count;

	-- Désarchivage : compté à part de la mise à jour, parce que ce n'est pas le même fait pour un
	-- humain qui lit le compte rendu du geste.
	update public.form_fields f
	   set archived_at = null
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'fields', '[]'::jsonb)) as e(value)
	 where f.id = (e.value ->> 'id')::uuid
	   and f.workflow_id = p_workflow_id
	   and f.archived_at is not null
	   and (e.value ->> 'archived_at') is null;

	get diagnostics n_ch_des = row_count;

	update public.form_fields f
	   set key         = e.value ->> 'key',
	       label       = e.value ->> 'label',
	       type        = e.value ->> 'type',
	       options     = coalesce(e.value -> 'options', '{}'::jsonb),
	       help_text   = e.value ->> 'help_text',
	       position    = (e.value ->> 'position')::numeric,
	       archived_at = (e.value ->> 'archived_at')::timestamptz
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'fields', '[]'::jsonb)) as e(value)
	 where f.id = (e.value ->> 'id')::uuid
	   and f.workflow_id = p_workflow_id
	   and (f.key, f.label, f.type, f.options, f.help_text, f.position, f.archived_at)
	       is distinct from
	       (e.value ->> 'key', e.value ->> 'label', e.value ->> 'type',
	        coalesce(e.value -> 'options', '{}'::jsonb), e.value ->> 'help_text',
	        (e.value ->> 'position')::numeric, (e.value ->> 'archived_at')::timestamptz);

	get diagnostics n_ch_maj = row_count;

	-- Le champ surnuméraire : ARCHIVÉ, jamais supprimé. Ses valeurs saisies restent intactes.
	update public.form_fields f
	   set archived_at = pg_catalog.now()
	 where f.workflow_id = p_workflow_id
	   and f.archived_at is null
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'fields', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'id')::uuid = f.id
	 );

	get diagnostics n_ch_arc = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 8 — LES RÈGLES DE VISIBILITÉ. Elles lient un champ ET une étape, donc après les
	-- deux. Une partie a déjà disparu par la cascade des étapes supprimées ; le reste est traité
	-- ici, et le résultat ne dépend pas de savoir laquelle.
	-- ---------------------------------------------------------------------------------------
	delete from public.form_field_rules r
	 where r.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'rules', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'field_id')::uuid = r.field_id
		   and (e.value ->> 'step_id')::uuid  = r.step_id
	 );

	get diagnostics n_rg_del = row_count;

	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	select (e.value ->> 'field_id')::uuid,
	       (e.value ->> 'step_id')::uuid,
	       p_workflow_id,
	       p_workspace_id,
	       e.value ->> 'visibility'
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'rules', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.form_field_rules r
		 where r.field_id = (e.value ->> 'field_id')::uuid
		   and r.step_id  = (e.value ->> 'step_id')::uuid
	 );

	get diagnostics n_rg_new = row_count;

	update public.form_field_rules r
	   set visibility = e.value ->> 'visibility'
	  from pg_catalog.jsonb_array_elements(coalesce(p_doc -> 'rules', '[]'::jsonb)) as e(value)
	 where r.field_id = (e.value ->> 'field_id')::uuid
	   and r.step_id  = (e.value ->> 'step_id')::uuid
	   and r.visibility is distinct from (e.value ->> 'visibility');

	get diagnostics n_rg_maj = row_count;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 9 — LES CHAMPS REQUIS PAR TRANSITION. Ils lient une arête et un champ, donc après
	-- les deux. Table de liaison pure : elle n'a rien à mettre à jour, seulement à créer ou à
	-- supprimer.
	-- ---------------------------------------------------------------------------------------
	delete from public.workflow_transition_required_fields rf
	 using public.workflow_transitions t
	 where t.id = rf.transition_id
	   and t.workflow_id = p_workflow_id
	   and not exists (
		select 1
		  from pg_catalog.jsonb_array_elements(
		       coalesce(p_doc -> 'required_fields', '[]'::jsonb)) as e(value)
		 where (e.value ->> 'transition_id')::uuid = rf.transition_id
		   and (e.value ->> 'field_id')::uuid      = rf.field_id
	 );

	get diagnostics n_rq_del = row_count;

	insert into public.workflow_transition_required_fields (transition_id, field_id)
	select (e.value ->> 'transition_id')::uuid,
	       (e.value ->> 'field_id')::uuid
	  from pg_catalog.jsonb_array_elements(
	       coalesce(p_doc -> 'required_fields', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_transition_required_fields rf
		 where rf.transition_id = (e.value ->> 'transition_id')::uuid
		   and rf.field_id      = (e.value ->> 'field_id')::uuid
	 );

	get diagnostics n_rq_new = row_count;

	return pg_catalog.jsonb_build_object(
		'cards', n_cards,
		'steps_created', n_step_new, 'steps_deleted', n_step_del, 'steps_updated', n_step_maj,
		'transitions_created', n_tr_new, 'transitions_deleted', n_tr_del, 'transitions_updated', n_tr_maj,
		'fields_created', n_ch_new, 'fields_unarchived', n_ch_des, 'fields_archived', n_ch_arc, 'fields_updated', n_ch_maj,
		'rules_created', n_rg_new, 'rules_deleted', n_rg_del, 'rules_updated', n_rg_maj,
		'required_created', n_rq_new, 'required_deleted', n_rq_del
	);
end;
$$;

create or replace function public.restore_workflow_version(
	target_version_id         uuid,
	step_overrides            jsonb default null,
	expected_live_fingerprint text  default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	version_cible    public.workflow_versions;
	workflow_vivant  public.workflows;
	empreinte_avant  text;
	derniere         public.workflow_versions;
	point_retour     public.workflow_versions;
	point_publie     boolean := false;
	plan             jsonb;
	etapes_bloquees  text;
	noeud_absent     uuid;
	doc              jsonb;
	n_cards          bigint := 0;
	n_step_new       bigint := 0;
	n_step_del       bigint := 0;
	n_step_maj       bigint := 0;
	n_tr_new         bigint := 0;
	n_tr_del         bigint := 0;
	n_tr_maj         bigint := 0;
	n_ch_new         bigint := 0;
	n_ch_des         bigint := 0;
	n_ch_arc         bigint := 0;
	n_ch_maj         bigint := 0;
	n_rg_new         bigint := 0;
	n_rg_del         bigint := 0;
	n_rg_maj         bigint := 0;
	n_rq_new         bigint := 0;
	n_rq_del         bigint := 0;
	empreinte_apres  text;
	compteurs        jsonb;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if auth.uid() is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. La version existe ET l'appelant est membre de son workspace. Sous `security definer`, la
	--    RLS ne fait PAS ce travail : l'appartenance est donc écrite à la main, exactement comme
	--    dans `publish_workflow_version`. Ce contrôle PRÉCÈDE celui d'administration, faute de quoi
	--    le message d'administration révélerait l'existence d'une version d'autrui.
	select v.* into version_cible
	  from public.workflow_versions v
	 where v.id = target_version_id;

	if not found or not app.is_workspace_member(version_cible.workspace_id) then
		raise exception 'version introuvable'
			using errcode = 'P0001',
			      detail  = 'aucune version lisible ne porte cet identifiant';
	end if;

	-- 3. Administrateur du workspace. Restaurer écrit la structure de travail de tout un channel.
	if not app.is_workspace_admin(version_cible.workspace_id) then
		raise exception 'restauration reservee aux administrateurs'
			using errcode = '42501',
			      detail  = 'la restauration d''une version est une prerogative d''administration';
	end if;

	-- LE VERROU, avant toute lecture de composition. Sans lui, deux restaurations simultanées
	-- liraient la même structure vivante et la seconde écraserait la première sans le savoir.
	-- C'est le geste du §7 ter.5, pour le même motif.
	select w.* into workflow_vivant
	  from public.workflows w
	 where w.id = version_cible.workflow_id
	   for update;

	-- 4. Un workflow archivé est un workflow sorti du service. Planifier restait permis (§7
	--    ter.12.4) parce que planifier ne fait que lire ; restaurer écrit, et le refus est ici.
	if workflow_vivant.archived_at is not null then
		raise exception 'workflow archive'
			using errcode = 'P0001',
			      detail  = 'un workflow archive ne peut pas etre restaure';
	end if;

	empreinte_avant := app.workflow_composition_fingerprint(workflow_vivant.id);

	-- 5. Concurrence OPTIMISTE et facultative : l'appelant dit l'empreinte vivante telle qu'il l'a
	--    vue en demandant le plan. Une divergence n'est pas une erreur de l'appelant — c'est l'état
	--    du monde qui a changé sous lui —, d'où le `409` et non le `400`.
	--
	--    LE SQLSTATE EST `PT409`, ET C'EST LA MESURE QUI L'A IMPOSÉ. La première rédaction levait
	--    `P0001`, comme les sept autres refus. MESURÉ le 2026-08-15 par une sonde posée puis retirée
	--    sur la pile locale : PostgREST rend **HTTP 400** pour tout `P0001`, et **HTTP 409** pour un
	--    SQLSTATE de la forme `PT<statut>`. Les deux exigences du §7 ter.13.6 — « `P0001` » et
	--    « `409` » — étaient donc inconciliables, et le refus rendait `400` en pratique.
	--    Ce qui est ARGUMENTÉ dans la spécification est le code HTTP : « la demande était valide,
	--    c'est l'état du monde qui a changé sous elle ; un `400` laisserait croire à une erreur de
	--    l'appelant ». Le `P0001` n'y est argumenté nulle part — c'est la valeur par défaut de
	--    `raise exception`, écrite par symétrie. C'est donc lui qui cède, et la colonne SQLSTATE du
	--    §7 ter.13.6 a été révisée avec son motif plutôt que le `409` abandonné en silence.
	--    Le message et le `detail` sont inchangés : seul le véhicule du statut change.
	if expected_live_fingerprint is not null
	   and expected_live_fingerprint <> empreinte_avant then
		raise exception 'structure modifiee depuis le plan'
			using errcode = 'PT409',
			      detail  = 'la composition vivante a change depuis le calcul du plan',
			      hint    = 'redemandez le plan avant d''appliquer';
	end if;

	-- 6 et 7. LE PLAN EST REJOUÉ ICI. `card_limit` vaut 1 : seuls le verdict et les compteurs sont
	--    lus, et ceux-ci portent sur la TOTALITÉ des affaires (§7 ter.12.6). Les huit refus du plan
	--    remontent tels quels — c'est le seul endroit où la règle de remappage est écrite.
	plan := public.plan_card_remapping(target_version_id, step_overrides, 1);

	if not (plan ->> 'ready')::boolean then
		-- Le refus NOMME les étapes qui bloquent : un « plan non applicable » sec obligerait
		-- l'appelant à redemander le plan pour savoir quoi corriger.
		select pg_catalog.string_agg(e.value ->> 'label', ', ' order by e.value ->> 'label')
		  into etapes_bloquees
		  from pg_catalog.jsonb_array_elements(plan -> 'steps' -> 'removed') as e(value)
		 where (e.value ->> 'cards_unresolved')::bigint > 0;

		raise exception 'plan non applicable'
			using errcode = 'P0001',
			      detail  = (plan -> 'summary' ->> 'cards_unresolved')
			                || ' affaire(s) sans destination sur : '
			                || coalesce(etapes_bloquees, 'etape inconnue'),
			      hint    = 'fournissez une instruction step_overrides pour chacune de ces etapes';
	end if;

	doc := version_cible.composition;

	-- 8. Une étape rétablie porte un `node_id`, lié au catalogue par une clé `on delete restrict`.
	--    Le catalogue n'expose aucune suppression, donc le cas ne peut naître que d'une purge
	--    d'administration ; le contrôle explicite rend alors un refus lisible plutôt qu'un `23503`
	--    brut (CLAUDE.md §20).
	select (e.value ->> 'node_id')::uuid into noeud_absent
	  from pg_catalog.jsonb_array_elements(coalesce(doc -> 'steps', '[]'::jsonb)) as e(value)
	 where not exists (
		select 1 from public.workflow_steps s
		 where s.id = (e.value ->> 'id')::uuid and s.workflow_id = workflow_vivant.id
	 )
	   and not exists (
		select 1 from public.workflow_nodes_catalog n
		 where n.id = (e.value ->> 'node_id')::uuid
		   and n.workspace_id = workflow_vivant.workspace_id
	 )
	 limit 1;

	if noeud_absent is not null then
		raise exception 'noeud de catalogue introuvable'
			using errcode = 'P0001',
			      detail  = 'le noeud ' || noeud_absent::text
			                || ' a disparu du catalogue et une etape retablie l''instancie';
	end if;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURE 1 — LE POINT DE RETOUR, publié AVANT tout le reste puisqu'il photographie l'état
	-- d'avant. Publié si et seulement si la composition vivante diffère de la dernière version :
	-- lorsqu'elles sont égales, cette dernière EST déjà le point de retour, et en publier une
	-- seconde indiscernable est exactement ce que la vérification 5 du §7 ter.5 interdit.
	-- ---------------------------------------------------------------------------------------
	select v.* into derniere
	  from public.workflow_versions v
	 where v.workflow_id = workflow_vivant.id
	 order by v.version_number desc
	 limit 1;

	if derniere.composition_fingerprint is distinct from empreinte_avant then
		point_retour := public.publish_workflow_version(
			workflow_vivant.id,
			'Point de retour avant restauration de la version '
				|| version_cible.version_number::text
		);
		point_publie := true;
	else
		point_retour := derniere;
	end if;

	-- ---------------------------------------------------------------------------------------
	-- ÉCRITURES 2 À 7 — le CŒUR de la restauration, extrait le 2026-10-03 en `app.appliquer_composition` par
	-- `CRM-097` T3 (décision 620) : la restauration et l'acceptation d'une suggestion de l'IA appliquent un
	-- document de composition par le MÊME code. Le texte est celui de la migration 42, déplacé sans changement ;
	-- les suites de `CRM-078` le prouvent.
	-- ---------------------------------------------------------------------------------------
	compteurs := app.appliquer_composition(workflow_vivant.id, workflow_vivant.workspace_id, doc, step_overrides);
	n_cards    := (compteurs ->> 'cards')::bigint;
	n_step_new := (compteurs ->> 'steps_created')::bigint;
	n_step_del := (compteurs ->> 'steps_deleted')::bigint;
	n_step_maj := (compteurs ->> 'steps_updated')::bigint;
	n_tr_new   := (compteurs ->> 'transitions_created')::bigint;
	n_tr_del   := (compteurs ->> 'transitions_deleted')::bigint;
	n_tr_maj   := (compteurs ->> 'transitions_updated')::bigint;
	n_ch_new   := (compteurs ->> 'fields_created')::bigint;
	n_ch_des   := (compteurs ->> 'fields_unarchived')::bigint;
	n_ch_arc   := (compteurs ->> 'fields_archived')::bigint;
	n_ch_maj   := (compteurs ->> 'fields_updated')::bigint;
	n_rg_new   := (compteurs ->> 'rules_created')::bigint;
	n_rg_del   := (compteurs ->> 'rules_deleted')::bigint;
	n_rg_maj   := (compteurs ->> 'rules_updated')::bigint;
	n_rq_new   := (compteurs ->> 'required_created')::bigint;
	n_rq_del   := (compteurs ->> 'required_deleted')::bigint;

	-- L'empreinte est RECALCULÉE, jamais recopiée depuis la version. Elle peut différer sans
	-- qu'aucune erreur n'ait eu lieu : la clé `workflow` n'est pas restaurée (§7 ter.13.3), et un
	-- champ surnuméraire archivé reste dans le document avec son `archived_at`. Rendre le booléen
	-- plutôt que de prétendre à l'égalité est la seule réponse honnête.
	empreinte_apres := app.workflow_composition_fingerprint(workflow_vivant.id);

	return pg_catalog.jsonb_build_object(
		'version', pg_catalog.jsonb_build_object(
			'version_id',              version_cible.id,
			'version_number',          version_cible.version_number,
			'workflow_id',             version_cible.workflow_id,
			'composition_fingerprint', version_cible.composition_fingerprint
		),
		'rollback_version', pg_catalog.jsonb_build_object(
			'version_id',     point_retour.id,
			'version_number', point_retour.version_number,
			'published',      point_publie
		),
		'cards',           pg_catalog.jsonb_build_object('remapped', n_cards),
		'steps',           pg_catalog.jsonb_build_object(
			'created', n_step_new, 'deleted', n_step_del, 'updated', n_step_maj),
		'transitions',     pg_catalog.jsonb_build_object(
			'created', n_tr_new, 'deleted', n_tr_del, 'updated', n_tr_maj),
		'fields',          pg_catalog.jsonb_build_object(
			'created', n_ch_new, 'unarchived', n_ch_des,
			'archived', n_ch_arc, 'updated', n_ch_maj),
		'rules',           pg_catalog.jsonb_build_object(
			'created', n_rg_new, 'deleted', n_rg_del, 'updated', n_rg_maj),
		'required_fields', pg_catalog.jsonb_build_object('created', n_rq_new, 'deleted', n_rq_del),
		'fingerprint_after', empreinte_apres,
		'matches_version',   empreinte_apres = version_cible.composition_fingerprint
	);
end;
$$;

-- Propriétaire explicite : c'est lui qui prête ses droits sous `security definer`, et un
-- propriétaire implicite dépendrait du rôle qui a appliqué la migration.
alter function public.restore_workflow_version(uuid, jsonb, text) owner to postgres;

comment on function public.restore_workflow_version(uuid, jsonb, text) is
	'CRM-078 — docs/SPEC-workflow-engine.md §7 ter.13. Rend la composition vivante d''un workflow '
	'égale à celle qu''une version a photographiée, en une transaction ou pas du tout. Rejoue '
	'plan_card_remapping et exige ready ; ses huit refus remontent tels quels. Publie d''abord la '
	'composition vivante comme POINT DE RETOUR par la vraie RPC, sauf si la dernière version joue '
	'déjà ce rôle : le retour arrière est alors la restauration de ce point, donc le même code. '
	'Restaure steps, transitions, fields, rules et required_fields — jamais la clé workflow, qui '
	'est l''identité et le placement. UN CHAMP SURNUMÉRAIRE EST ARCHIVÉ, JAMAIS SUPPRIMÉ. '
	'SECURITY DEFINER parce que déplacer une affaire exige un privilège de colonne qu''aucun '
	'authenticated ne détient.';

-- La révocation nommée d'`anon` est obligatoire : le `grant execute` par défaut de l'image porte
-- sur `anon` aussi (décision 80). Sans elle, l'anonyme obtiendrait 403 au lieu de 401.
revoke all on function public.restore_workflow_version(uuid, jsonb, text) from public, anon;
grant execute on function public.restore_workflow_version(uuid, jsonb, text)
	to authenticated, service_role;


-- ---------------------------------------------------------------------------------------------
-- 4. La composition vivante au format de la proposition, et l'occupation (docs/SPEC-ia.md §13.2)
-- ---------------------------------------------------------------------------------------------
-- SECURITY INVOKER : la RLS dit ce que l'appelant lit. `null` si le workflow ne lui est pas lisible. Les champs
-- ARCHIVÉS n'y sont pas, ni leurs règles ni leurs exigences : la cible les garde tels quels (§13.1).
create or replace function public.proposition_du_workflow(p_workflow uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
	select jsonb_build_object(
		'version', 1,
		'workflow', jsonb_build_object('nom', w.name),
		'noeuds', '[]'::jsonb,
		'etapes', coalesce((
			select jsonb_agg(jsonb_build_object('noeud', n.key, 'initiale', s.is_initial) order by s.position, s.id)
			  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
			 where s.workflow_id = w.id), '[]'::jsonb),
		'transitions', coalesce((
			select jsonb_agg(jsonb_build_object('de', nd.key, 'vers', nv.key, 'libelle', coalesce(t.label, ''),
			                                    'commentaire_requis', t.require_comment)
			                 order by sd.position, sv.position, t.id)
			  from public.workflow_transitions t
			  join public.workflow_steps sd on sd.id = t.from_step_id
			  join public.workflow_nodes_catalog nd on nd.id = sd.node_id
			  join public.workflow_steps sv on sv.id = t.to_step_id
			  join public.workflow_nodes_catalog nv on nv.id = sv.node_id
			 where t.workflow_id = w.id), '[]'::jsonb),
		'champs', coalesce((
			select jsonb_agg(jsonb_build_object(
				'cle', f.key, 'libelle', f.label, 'type', f.type,
				'choix', case when jsonb_typeof(f.options -> 'choices') = 'array'
				              then (select coalesce(jsonb_agg(c.choix ->> 'label' order by c.rang), '[]'::jsonb)
				                      from jsonb_array_elements(f.options -> 'choices') with ordinality as c(choix, rang))
				              else null end,
				'devise', f.options ->> 'currency',
				'aide', f.help_text) order by f.position, f.id)
			  from public.form_fields f
			 where f.workflow_id = w.id and f.archived_at is null), '[]'::jsonb),
		'regles', coalesce((
			select jsonb_agg(jsonb_build_object('champ', f.key, 'etape', n.key, 'visibilite', r.visibility)
			                 order by f.position, s.position)
			  from public.form_field_rules r
			  join public.form_fields f on f.id = r.field_id and f.archived_at is null
			  join public.workflow_steps s on s.id = r.step_id
			  join public.workflow_nodes_catalog n on n.id = s.node_id
			 where r.workflow_id = w.id), '[]'::jsonb),
		'exigences', coalesce((
			select jsonb_agg(jsonb_build_object('de', nd.key, 'vers', nv.key, 'champ', f.key)
			                 order by sd.position, sv.position, f.position)
			  from public.workflow_transition_required_fields x
			  join public.workflow_transitions t on t.id = x.transition_id
			  join public.form_fields f on f.id = x.field_id and f.archived_at is null
			  join public.workflow_steps sd on sd.id = t.from_step_id
			  join public.workflow_nodes_catalog nd on nd.id = sd.node_id
			  join public.workflow_steps sv on sv.id = t.to_step_id
			  join public.workflow_nodes_catalog nv on nv.id = sv.node_id
			 where t.workflow_id = w.id), '[]'::jsonb)
	)
	  from public.workflows w
	 where w.id = p_workflow
$$;

-- Le nombre d'affaires par étape, archivées et en corbeille comprises. Exhaustif pour un administrateur (règle 2
-- d'`app.resolve_access`) ; partiel pour un autre membre, qui ne peut de toute façon pas accepter.
create or replace function public.occupation_du_workflow(p_workflow uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
	select coalesce(jsonb_object_agg(n.key, (select count(*) from public.cards c where c.current_step_id = s.id)), '{}'::jsonb)
	  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	 where s.workflow_id = p_workflow
$$;

revoke all on function public.proposition_du_workflow(uuid) from public, anon;
revoke all on function public.occupation_du_workflow(uuid) from public, anon;
grant execute on function public.proposition_du_workflow(uuid) to authenticated, service_role;
grant execute on function public.occupation_du_workflow(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5. La cible traduite en document de composition (docs/SPEC-ia.md §13.4, effet 3)
-- ---------------------------------------------------------------------------------------------
-- Un objet CONSERVÉ — même clé — garde son identifiant et ce que la proposition ne porte pas (surcharges d'étape,
-- options non nommées d'un champ, clés des choix dont le libellé est inchangé) ; un objet NOUVEAU reçoit un
-- identifiant ; les champs ARCHIVÉS, et leurs règles et exigences dont l'étape ou la transition demeure, sont
-- recopiés tels quels. Une étape NOUVELLE lit son nœud au catalogue par sa clé, unique dans l'espace : les nœuds que
-- l'acceptation vient d'y ajouter s'y trouvent déjà.
create or replace function app.document_cible_ia(p_workflow uuid, p_proposition jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	vivant      jsonb := app.workflow_composition_document(p_workflow);
	espace      uuid;
	etapes      jsonb := '{}'::jsonb;
	aretes      jsonb := '{}'::jsonb;
	champs      jsonb := '{}'::jsonb;
	l_etapes    jsonb := '[]'::jsonb;
	l_aretes    jsonb := '[]'::jsonb;
	l_champs    jsonb := '[]'::jsonb;
	l_regles    jsonb := '[]'::jsonb;
	l_exigences jsonb := '[]'::jsonb;
	e           record;
	existant    jsonb;
	identifiant uuid;
	options     jsonb;
begin
	select w.workspace_id into espace from public.workflows w where w.id = p_workflow;

	for e in select value as v, ordinality as rang from jsonb_array_elements(p_proposition -> 'etapes') with ordinality loop
		select x into existant from jsonb_array_elements(vivant -> 'steps') x where x ->> 'node_key' = e.v ->> 'noeud';
		if existant is not null then
			l_etapes := l_etapes || jsonb_build_array(jsonb_build_object(
				'id', existant -> 'id', 'node_id', existant -> 'node_id', 'position', e.rang,
				'label_override', existant -> 'label_override', 'probability_override', existant -> 'probability_override',
				'stale_after_days', existant -> 'stale_after_days', 'is_initial', e.v -> 'initiale'));
			etapes := etapes || jsonb_build_object(e.v ->> 'noeud', existant -> 'id');
		else
			identifiant := gen_random_uuid();
			l_etapes := l_etapes || jsonb_build_array(jsonb_build_object(
				'id', identifiant,
				'node_id', (select n.id from public.workflow_nodes_catalog n
				             where n.workspace_id = espace and n.key = e.v ->> 'noeud' and n.archived_at is null),
				'position', e.rang, 'label_override', null, 'probability_override', null, 'stale_after_days', null,
				'is_initial', e.v -> 'initiale'));
			etapes := etapes || jsonb_build_object(e.v ->> 'noeud', identifiant);
		end if;
		existant := null;
	end loop;

	for e in select value as v from jsonb_array_elements(p_proposition -> 'transitions') loop
		select x into existant from jsonb_array_elements(vivant -> 'transitions') x
		 where x ->> 'from_step_id' = etapes ->> (e.v ->> 'de') and x ->> 'to_step_id' = etapes ->> (e.v ->> 'vers');
		identifiant := coalesce((existant ->> 'id')::uuid, gen_random_uuid());
		l_aretes := l_aretes || jsonb_build_array(jsonb_build_object(
			'id', identifiant, 'from_step_id', etapes -> (e.v ->> 'de'), 'to_step_id', etapes -> (e.v ->> 'vers'),
			'label', nullif(btrim(e.v ->> 'libelle'), ''), 'require_comment', e.v -> 'commentaire_requis'));
		aretes := aretes || jsonb_build_object(format('%s>%s', e.v ->> 'de', e.v ->> 'vers'), identifiant);
		existant := null;
	end loop;

	for e in select value as v, ordinality as rang from jsonb_array_elements(p_proposition -> 'champs') with ordinality loop
		select x into existant from jsonb_array_elements(vivant -> 'fields') x
		 where x ->> 'key' = e.v ->> 'cle' and x -> 'archived_at' = 'null'::jsonb;
		identifiant := coalesce((existant ->> 'id')::uuid, gen_random_uuid());
		options := coalesce(existant -> 'options', '{}'::jsonb) - 'choices' - 'currency';
		if e.v ->> 'type' in ('select', 'multiselect') then
			-- Un choix dont le libellé est inchangé garde sa clé : les réponses déjà données la portent.
			options := options || jsonb_build_object('choices', (
				select coalesce(jsonb_agg(jsonb_build_object(
					'key', coalesce(
						(select a ->> 'key' from jsonb_array_elements(coalesce(existant -> 'options' -> 'choices', '[]'::jsonb)) a
						  where btrim(a ->> 'label') = btrim(c.libelle) limit 1),
						app.cle_de_libelle_ia(c.libelle)),
					'label', btrim(c.libelle)) order by c.rang), '[]'::jsonb)
				  from jsonb_array_elements_text(e.v -> 'choix') with ordinality as c(libelle, rang)));
		elsif e.v ->> 'type' = 'money' then
			options := options || jsonb_build_object('currency', e.v ->> 'devise');
		end if;
		l_champs := l_champs || jsonb_build_array(jsonb_build_object(
			'id', identifiant, 'key', e.v ->> 'cle', 'label', btrim(e.v ->> 'libelle'), 'type', e.v ->> 'type',
			'options', options, 'help_text', nullif(btrim(e.v ->> 'aide'), ''), 'position', e.rang, 'archived_at', null));
		champs := champs || jsonb_build_object(e.v ->> 'cle', identifiant);
		existant := null;
	end loop;
	-- Les champs déjà archivés restent tels quels.
	l_champs := l_champs || coalesce((select jsonb_agg(x) from jsonb_array_elements(vivant -> 'fields') x
	                                   where x -> 'archived_at' <> 'null'::jsonb), '[]'::jsonb);

	l_regles := coalesce((select jsonb_agg(jsonb_build_object(
			'field_id', champs -> (r ->> 'champ'), 'step_id', etapes -> (r ->> 'etape'), 'visibility', r ->> 'visibilite'))
		  from jsonb_array_elements(p_proposition -> 'regles') r), '[]'::jsonb)
		|| coalesce((select jsonb_agg(x) from jsonb_array_elements(vivant -> 'rules') x
		              where x ->> 'field_id' in (select f ->> 'id' from jsonb_array_elements(vivant -> 'fields') f
		                                          where f -> 'archived_at' <> 'null'::jsonb)
		                and x ->> 'step_id' in (select v #>> '{}' from jsonb_each(etapes) as t(k, v))), '[]'::jsonb);

	l_exigences := coalesce((select jsonb_agg(jsonb_build_object(
			'transition_id', aretes -> format('%s>%s', x ->> 'de', x ->> 'vers'), 'field_id', champs -> (x ->> 'champ')))
		  from jsonb_array_elements(p_proposition -> 'exigences') x), '[]'::jsonb)
		|| coalesce((select jsonb_agg(y) from jsonb_array_elements(vivant -> 'required_fields') y
		              where y ->> 'field_id' in (select f ->> 'id' from jsonb_array_elements(vivant -> 'fields') f
		                                          where f -> 'archived_at' <> 'null'::jsonb)
		                and y ->> 'transition_id' in (select v #>> '{}' from jsonb_each(aretes) as t(k, v))), '[]'::jsonb);

	return jsonb_build_object('workflow', vivant -> 'workflow', 'steps', l_etapes, 'transitions', l_aretes,
	                          'fields', l_champs, 'rules', l_regles, 'required_fields', l_exigences);
end;
$$;

revoke all on function app.appliquer_composition(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function app.document_cible_ia(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6. Accepter — une création (T2) ou une modification (T3)
-- ---------------------------------------------------------------------------------------------
create or replace function public.accepter_suggestion_ia(p_suggestion uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	appelant      uuid := auth.uid();
	la_suggestion public.suggestions_ia%rowtype;
	espace        uuid;
	proposition   jsonb;
	defauts       jsonb;
	le_workflow   uuid;
	noeuds        jsonb := '{}'::jsonb;
	etapes        jsonb := '{}'::jsonb;
	aretes        jsonb := '{}'::jsonb;
	champs        jsonb := '{}'::jsonb;
	e             record;
	identifiant   uuid;
	options       jsonb;
	le_vivant     public.workflows;
	derniere      public.workflow_versions;
	point_retour  public.workflow_versions;
	doc           jsonb;
	remappages    jsonb;
begin
	-- 1. Appelant authentifié.
	if appelant is null then
		raise exception 'authentification requise' using errcode = '42501';
	end if;

	-- 2. La suggestion existe ET l'appelant administre son espace — indiscernables. `PT404` : PostgREST rend HTTP
	--    500 pour `P0002`, MESURÉ le 2026-10-02 par l'API aux jetons du commercial et de la lectrice ; un refus qui
	--    se lirait comme une panne du serveur. `PT<statut>` porte le statut, convention de `0042` (`PT409`).
	select * into la_suggestion from public.suggestions_ia where id = p_suggestion for update;
	if not found or not app.is_workspace_admin(la_suggestion.workspace_id) then
		raise exception 'suggestion introuvable' using errcode = 'PT404';
	end if;
	espace := la_suggestion.workspace_id;

	-- 3. à 6.
	if la_suggestion.statut <> 'en_revue' then
		raise exception 'suggestion figee' using errcode = 'P0001';
	end if;
	-- 4 bis et 4 ter — une MODIFICATION (docs/SPEC-ia.md §13.4) : le workflow ciblé est vivant, et n'a pas bougé depuis
	-- la création de la suggestion. `PT409` : l'état du monde a changé sous la demande — une revue est nécessaire.
	if la_suggestion.workflow_id is not null then
		select w.* into le_vivant from public.workflows w where w.id = la_suggestion.workflow_id for update;
		if le_vivant.archived_at is not null then
			raise exception 'workflow archive' using errcode = 'P0001';
		end if;
		if app.workflow_composition_fingerprint(le_vivant.id) is distinct from la_suggestion.empreinte_initiale then
			raise exception 'workflow modifie' using errcode = 'PT409',
				detail = 'la composition du workflow a change depuis la creation de la suggestion';
		end if;
	end if;
	if la_suggestion.generation_depuis is not null and la_suggestion.generation_depuis > now() - interval '180 seconds' then
		raise exception 'generation en cours' using errcode = 'P0001';
	end if;
	select r.proposition into proposition
	  from public.suggestions_ia_revisions r
	 where r.suggestion_id = p_suggestion
	 order by r.numero desc
	 limit 1;
	if proposition is null then
		raise exception 'aucune revision' using errcode = 'P0001';
	end if;

	-- 7. Recontrôlée MAINTENANT : le catalogue a pu changer depuis la révision.
	defauts := app.defauts_proposition_ia(espace, proposition, la_suggestion.workflow_id);
	if jsonb_array_length(defauts) > 0 then
		raise exception 'proposition non conforme' using errcode = 'P0001',
			detail = format('%s defaut(s)', jsonb_array_length(defauts));
	end if;

	-- UNE MODIFICATION — docs/SPEC-ia.md §13.4 : le point de retour, les nœuds proposés, la cible traduite en document
	-- de composition, puis le CŒUR DE LA RESTAURATION (`app.appliquer_composition`), qui l'applique.
	if la_suggestion.workflow_id is not null then
		-- Effet 1 — le point de retour, par la règle exacte de la restauration (§7 ter.13.5 du moteur) : publié si la
		-- dernière version ne photographie pas déjà la composition vivante.
		select v.* into derniere from public.workflow_versions v
		 where v.workflow_id = le_vivant.id order by v.version_number desc limit 1;
		if derniere.composition_fingerprint is distinct from la_suggestion.empreinte_initiale then
			point_retour := public.publish_workflow_version(le_vivant.id, 'Point de retour avant une suggestion de l''IA');
		else
			point_retour := derniere;
		end if;

		-- Effet 2 — les nœuds proposés entrent au catalogue.
		for e in select value as v from jsonb_array_elements(proposition -> 'noeuds') loop
			insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color, default_probability)
			values (espace, e.v ->> 'cle', btrim(e.v ->> 'libelle'), e.v ->> 'nature',
			        case e.v ->> 'nature' when 'won' then 'success' when 'lost' then 'danger' else 'brand' end,
			        (e.v ->> 'probabilite')::numeric);
		end loop;

		-- Effet 3 — la cible en document, les remappages en `step_overrides`.
		doc := app.document_cible_ia(le_vivant.id, proposition);
		select coalesce(jsonb_agg(jsonb_build_object(
				'from_step_id', (select x ->> 'id' from jsonb_array_elements(app.workflow_composition_document(le_vivant.id) -> 'steps') x
				                  where x ->> 'node_key' = r ->> 'de'),
				'to_step_id', (select x ->> 'id' from jsonb_array_elements(doc -> 'steps') x
				                where x ->> 'node_id' = (select n.id::text from public.workflow_nodes_catalog n
				                                          where n.workspace_id = espace and n.key = r ->> 'vers' and n.archived_at is null)))), '[]'::jsonb)
		  into remappages
		  from jsonb_array_elements(coalesce(proposition -> 'remappages', '[]'::jsonb)) r;

		-- Une affaire peut aller vers une étape que la suggestion AJOUTE : le cœur déplace les affaires avant
		-- d'insérer les étapes. Les étapes nouvelles sont donc posées d'abord, jamais initiales — le cœur règle
		-- ensuite l'étape initiale, et trouve ces étapes existantes.
		insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position, is_initial)
		select (x ->> 'id')::uuid, le_vivant.id, espace, (x ->> 'node_id')::uuid, (x ->> 'position')::numeric, false
		  from jsonb_array_elements(doc -> 'steps') x
		 where not exists (select 1 from public.workflow_steps s where s.id = (x ->> 'id')::uuid);

		-- Effet 4 — le cœur de la restauration applique le document.
		perform app.appliquer_composition(le_vivant.id, espace, doc, remappages);
		if btrim(proposition -> 'workflow' ->> 'nom') <> le_vivant.name then
			update public.workflows set name = btrim(proposition -> 'workflow' ->> 'nom') where id = le_vivant.id;
		end if;

		-- Effet 5 — la décision, avec son point de retour.
		update public.suggestions_ia
		   set statut = 'acceptee', version_retour_id = point_retour.id
		 where id = p_suggestion;
		return le_vivant.id;
	end if;

	-- Effet 1 — le workflow ; le défaut de l'espace s'il n'en a aucun, archivé compris.
	insert into public.workflows (workspace_id, name, scope, is_default)
	values (espace, btrim(proposition -> 'workflow' ->> 'nom'), 'global',
	        not exists (select 1 from public.workflows w where w.workspace_id = espace and w.is_default))
	returning id into le_workflow;

	-- Effet 2 — les nœuds proposés ; la couleur suit la nature.
	for e in select value as v from jsonb_array_elements(proposition -> 'noeuds') loop
		insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color, default_probability)
		values (espace, e.v ->> 'cle', btrim(e.v ->> 'libelle'), e.v ->> 'nature',
		        case e.v ->> 'nature' when 'won' then 'success' when 'lost' then 'danger' else 'brand' end,
		        (e.v ->> 'probabilite')::numeric)
		returning id into identifiant;
		noeuds := noeuds || jsonb_build_object(e.v ->> 'cle', identifiant);
	end loop;

	-- Effet 3 — les étapes, dans l'ordre de la proposition.
	for e in select value as v, ordinality as rang from jsonb_array_elements(proposition -> 'etapes') with ordinality loop
		insert into public.workflow_steps (workflow_id, workspace_id, node_id, position, is_initial)
		values (le_workflow, espace,
		        coalesce((noeuds ->> (e.v ->> 'noeud'))::uuid,
		                 (select n.id from public.workflow_nodes_catalog n
		                   where n.workspace_id = espace and n.key = e.v ->> 'noeud' and n.archived_at is null)),
		        e.rang, (e.v -> 'initiale') = 'true'::jsonb)
		returning id into identifiant;
		etapes := etapes || jsonb_build_object(e.v ->> 'noeud', identifiant);
	end loop;

	-- Effet 4 — les transitions.
	for e in select value as v from jsonb_array_elements(proposition -> 'transitions') loop
		insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment)
		values (le_workflow, espace, (etapes ->> (e.v ->> 'de'))::uuid, (etapes ->> (e.v ->> 'vers'))::uuid,
		        btrim(e.v ->> 'libelle'), (e.v -> 'commentaire_requis') = 'true'::jsonb)
		returning id into identifiant;
		aretes := aretes || jsonb_build_object(format('%s>%s', e.v ->> 'de', e.v ->> 'vers'), identifiant);
	end loop;

	-- Effet 5 — les champs ; la clé d'un choix est dérivée de son libellé.
	for e in select value as v, ordinality as rang from jsonb_array_elements(proposition -> 'champs') with ordinality loop
		options := case
			when e.v ->> 'type' in ('select', 'multiselect') then jsonb_build_object('choices',
				(select jsonb_agg(jsonb_build_object('key', app.cle_de_libelle_ia(c.libelle), 'label', btrim(c.libelle)) order by c.rang)
				   from jsonb_array_elements_text(e.v -> 'choix') with ordinality as c(libelle, rang)))
			when e.v ->> 'type' = 'money' then jsonb_build_object('currency', e.v ->> 'devise')
			else '{}'::jsonb
		end;
		insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, help_text, position)
		values (le_workflow, espace, e.v ->> 'cle', btrim(e.v ->> 'libelle'), e.v ->> 'type', options,
		        nullif(btrim(e.v ->> 'aide'), ''), e.rang)
		returning id into identifiant;
		champs := champs || jsonb_build_object(e.v ->> 'cle', identifiant);
	end loop;

	-- Effet 6 — les règles, puis les exigences.
	insert into public.form_field_rules (field_id, step_id, workflow_id, workspace_id, visibility)
	select (champs ->> (r ->> 'champ'))::uuid, (etapes ->> (r ->> 'etape'))::uuid, le_workflow, espace, r ->> 'visibilite'
	  from jsonb_array_elements(proposition -> 'regles') r;

	insert into public.workflow_transition_required_fields (transition_id, field_id)
	select (aretes ->> format('%s>%s', x ->> 'de', x ->> 'vers'))::uuid, (champs ->> (x ->> 'champ'))::uuid
	  from jsonb_array_elements(proposition -> 'exigences') x;

	-- Effet 7 — la décision ; `decided_by` et `decided_at` sont posés par le trigger.
	update public.suggestions_ia
	   set statut = 'acceptee', workflow_cree_id = le_workflow
	 where id = p_suggestion;

	return le_workflow;
end;
$$;

comment on function public.accepter_suggestion_ia(uuid) is
	'Accepte une suggestion de l''assistant IA. Création : le workflow entier en une transaction (CRM-097 T2). '
	'Modification : point de retour publié, nœuds proposés, cible traduite en document, appliquée par le cœur de la '
	'restauration de CRM-078 (CRM-097 T3). SECURITY DEFINER, refus écrits à la main. docs/SPEC-ia.md §12.3, §13.4.';

revoke all on function public.accepter_suggestion_ia(uuid) from public, anon;
grant execute on function public.accepter_suggestion_ia(uuid) to authenticated;

notify pgrst, 'reload schema';
