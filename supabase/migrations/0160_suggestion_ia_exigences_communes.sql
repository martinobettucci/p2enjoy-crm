-- @spec CRM-112 (docs/BACKLOG.md) — tranche T2.d.2 : la base connaît les exigences de champ commun d'une proposition de
--       l'assistant — leur forme, leurs trois défauts, leur rendu depuis le workflow vivant, et leur effet à l'acceptation,
--       à la création comme à la modification
-- @spec docs/SPEC-ia.md §6.1 et §12.1 (décision 825) ; docs/SPEC-champs-communs.md §5 ; docs/SCHEMA.md « Migration `0160` »
--
-- LES CINQ FONCTIONS SONT REPRISES À L'IDENTIQUE DE LEUR DÉFINITION EN BASE (`pg_get_functiondef`), chacune avec un
-- ajout. Une proposition sans `exigences_communes` est lue comme avant : sa forme, ses défauts et son rendu ne changent pas.

CREATE OR REPLACE FUNCTION app.proposition_ia_bien_formee(p jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
	-- `exigences_communes` est FACULTATIVE (`CRM-112` T2.d.2, décision 825) : absente, ou un tableau.
	if p ? 'exigences_communes' and jsonb_typeof(p -> 'exigences_communes') is distinct from 'array' then
		return false;
	end if;
	-- `remappages` est FACULTATIVE (docs/SPEC-ia.md §13.1, `CRM-097` T3) : absente, ou un tableau.
	if p ? 'remappages' and jsonb_typeof(p -> 'remappages') is distinct from 'array' then
		return false;
	end if;
	if jsonb_array_length(p -> 'noeuds') + jsonb_array_length(p -> 'etapes') + jsonb_array_length(p -> 'transitions')
	   + jsonb_array_length(p -> 'champs') + jsonb_array_length(p -> 'regles') + jsonb_array_length(p -> 'exigences')
	   + coalesce(jsonb_array_length(p -> 'exigences_communes'), 0) > 200 then
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
		and jsonb_typeof(e -> 'initiale') is not distinct from 'boolean'
		-- `CRM-113` (docs/SPEC-ia.md §14.3) : le nom affiché et la probabilité effective de l'étape, FACULTATIFS.
		and coalesce(jsonb_typeof(e -> 'label'), 'null') in ('string', 'null')
		and coalesce(jsonb_typeof(e -> 'probability'), 'null') in ('number', 'null'))
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
		and jsonb_typeof(e -> 'vers') is not distinct from texte
		and jsonb_typeof(e -> 'champ') is not distinct from texte)
		from jsonb_array_elements(coalesce(p -> 'exigences_communes', '[]'::jsonb)) e), true)
	and coalesce((select bool_and(
		jsonb_typeof(e) = 'object'
		and jsonb_typeof(e -> 'de') is not distinct from texte
		and jsonb_typeof(e -> 'vers') is not distinct from texte)
		from jsonb_array_elements(coalesce(p -> 'remappages', '[]'::jsonb)) e), true);
end;
$function$;

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

	-- `CRM-112` T2.d.2 (décision 825) : les exigences de champ COMMUN. Le champ est un champ commun NON archivé de
	-- l'espace, jamais un champ de la proposition ; la transition est l'une de la proposition.
	liaisons := '{}';
	for e in select value as v, ordinality - 1 as i
	           from jsonb_array_elements(coalesce(p_proposition -> 'exigences_communes', '[]'::jsonb)) with ordinality loop
		if not (format('%s>%s', e.v ->> 'de', e.v ->> 'vers') = any (aretes)) then
			defauts := defauts || jsonb_build_object('code', 'exigence_commune_transition_absente', 'chemin', format('exigences_communes[%s]', e.i), 'valeurs', jsonb_build_object('de', e.v ->> 'de', 'vers', e.v ->> 'vers'));
		end if;
		if not exists (select 1 from public.card_common_fields f
		                where f.workspace_id = p_workspace and f.key = e.v ->> 'champ' and f.archived_at is null) then
			defauts := defauts || jsonb_build_object('code', 'exigence_champ_commun_absent', 'chemin', format('exigences_communes[%s].champ', e.i), 'valeurs', jsonb_build_object('cle', e.v ->> 'champ'));
		end if;
		if format('%s>%s@%s', e.v ->> 'de', e.v ->> 'vers', e.v ->> 'champ') = any (liaisons) then
			defauts := defauts || jsonb_build_object('code', 'exigence_commune_en_double', 'chemin', format('exigences_communes[%s]', e.i), 'valeurs', jsonb_build_object('de', e.v ->> 'de', 'vers', e.v ->> 'vers', 'champ', e.v ->> 'champ'));
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

CREATE OR REPLACE FUNCTION public.proposition_du_workflow(p_workflow uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	select jsonb_build_object(
		'version', 1,
		'workflow', jsonb_build_object('nom', w.name),
		'noeuds', '[]'::jsonb,
		'etapes', coalesce((
			-- `CRM-113` (docs/SPEC-ia.md §14.4) : le nom et la probabilité EFFECTIFS de l'étape, tels que l'écran les montre.
			select jsonb_agg(jsonb_build_object('noeud', n.key, 'initiale', s.is_initial,
			                                    'label', coalesce(s.label_override, n.label),
			                                    'probability', coalesce(s.probability_override, n.default_probability))
			                 order by s.position, s.id)
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
	-- `CRM-112` T2.d.2 (décision 825) : les exigences de champ commun VIVANTES, par clés — seulement s'il y en a, pour que
	-- le rendu d'un workflow sans elles reste celui d'avant.
	|| coalesce((
		select jsonb_build_object('exigences_communes', jsonb_agg(jsonb_build_object('de', nd.key, 'vers', nv.key, 'champ', f.key)
		                                                          order by sd.position, sv.position, f.position))
		  from public.workflow_transition_required_common_fields x
		  join public.workflow_transitions t on t.id = x.transition_id
		  join public.card_common_fields f on f.id = x.common_field_id and f.archived_at is null
		  join public.workflow_steps sd on sd.id = t.from_step_id
		  join public.workflow_nodes_catalog nd on nd.id = sd.node_id
		  join public.workflow_steps sv on sv.id = t.to_step_id
		  join public.workflow_nodes_catalog nv on nv.id = sv.node_id
		 where t.workflow_id = w.id
		having count(*) > 0), '{}'::jsonb)
	  from public.workflows w
	 where w.id = p_workflow
$function$;

CREATE OR REPLACE FUNCTION app.document_cible_ia(p_workflow uuid, p_proposition jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
	surcharges  jsonb;
	le_noeud    uuid;
begin
	select w.workspace_id into espace from public.workflows w where w.id = p_workflow;

	for e in select value as v, ordinality as rang from jsonb_array_elements(p_proposition -> 'etapes') with ordinality loop
		select x into existant from jsonb_array_elements(vivant -> 'steps') x where x ->> 'node_key' = e.v ->> 'noeud';
		if existant is not null then
			-- `CRM-113` (docs/SPEC-ia.md §14.3) : la surcharge vivante n'est gardée que si la cible n'en dit rien.
			surcharges := app.ai_step_overrides((existant ->> 'node_id')::uuid, e.v,
				existant ->> 'label_override', (existant ->> 'probability_override')::numeric, true);
			l_etapes := l_etapes || jsonb_build_array(jsonb_build_object(
				'id', existant -> 'id', 'node_id', existant -> 'node_id', 'position', e.rang,
				'label_override', surcharges -> 'label_override', 'probability_override', surcharges -> 'probability_override',
				'stale_after_days', existant -> 'stale_after_days', 'is_initial', e.v -> 'initiale'));
			etapes := etapes || jsonb_build_object(e.v ->> 'noeud', existant -> 'id');
		else
			identifiant := gen_random_uuid();
			le_noeud := (select n.id from public.workflow_nodes_catalog n
			              where n.workspace_id = espace and n.key = e.v ->> 'noeud' and n.archived_at is null);
			surcharges := app.ai_step_overrides(le_noeud, e.v, null, null, false);
			l_etapes := l_etapes || jsonb_build_array(jsonb_build_object(
				'id', identifiant, 'node_id', le_noeud, 'position', e.rang,
				'label_override', surcharges -> 'label_override', 'probability_override', surcharges -> 'probability_override',
				'stale_after_days', null, 'is_initial', e.v -> 'initiale'));
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

	-- CRM-112 T2.d.0 : les champs communs exigés VIVANTS sont repris tels quels sur les transitions que la proposition
	-- garde. Sans cette reprise, `app.appliquer_composition` lirait leur absence comme « aucune exigence » et les
	-- retirerait à l'acceptation (docs/SPEC-champs-communs.md §5). L'assistant ne les propose ni ne les retire.
	return jsonb_build_object('workflow', vivant -> 'workflow', 'steps', l_etapes, 'transitions', l_aretes,
	                          'fields', l_champs, 'rules', l_regles, 'required_fields', l_exigences)
	    || case
	       -- `CRM-112` T2.d.2 (décision 825) : une proposition qui PORTE `exigences_communes` décide, même vide ; ses clés
	       -- sont résolues dans l'espace. Une proposition qui ne la porte pas (révision antérieure) garde les exigences
	       -- vivantes des transitions gardées, comme la `0159`.
	       when p_proposition ? 'exigences_communes' then
	           coalesce((select jsonb_build_object('required_common_fields', jsonb_agg(jsonb_build_object(
	                        'transition_id', aretes -> format('%s>%s', x ->> 'de', x ->> 'vers'),
	                        'common_field_id', f.id,
	                        'key', f.key)))
	                       from jsonb_array_elements(p_proposition -> 'exigences_communes') x
	                       join public.card_common_fields f
	                         on f.workspace_id = espace and f.key = x ->> 'champ' and f.archived_at is null
	                     having count(*) > 0), '{}'::jsonb)
	       else
	           coalesce((select jsonb_build_object('required_common_fields', jsonb_agg(y))
	                       from jsonb_array_elements(vivant -> 'required_common_fields') y
	                      where y ->> 'transition_id' in (select v #>> '{}' from jsonb_each(aretes) as t(k, v))
	                     having count(*) > 0), '{}'::jsonb)
	       end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.accepter_suggestion_ia(p_suggestion uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
	le_noeud      uuid;
	surcharges    jsonb;
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

		-- Effet 4 — le cœur de la restauration applique le document. Une affaire peut aller vers une étape que la
		-- suggestion AJOUTE : le cœur pose les étapes nouvelles avant de déplacer les affaires (INC-270).
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

	-- Effet 3 — les étapes, dans l'ordre de la proposition ; leur nom et leur probabilité en surcharge quand ils diffèrent
	-- de ceux de leur nœud (`CRM-113`, docs/SPEC-ia.md §14.3).
	for e in select value as v, ordinality as rang from jsonb_array_elements(proposition -> 'etapes') with ordinality loop
		le_noeud := coalesce((noeuds ->> (e.v ->> 'noeud'))::uuid,
		                     (select n.id from public.workflow_nodes_catalog n
		                       where n.workspace_id = espace and n.key = e.v ->> 'noeud' and n.archived_at is null));
		surcharges := app.ai_step_overrides(le_noeud, e.v, null, null, false);
		insert into public.workflow_steps (workflow_id, workspace_id, node_id, position, is_initial, label_override, probability_override)
		values (le_workflow, espace, le_noeud, e.rang, (e.v -> 'initiale') = 'true'::jsonb,
		        surcharges ->> 'label_override', (surcharges ->> 'probability_override')::numeric)
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

	-- `CRM-112` T2.d.2 (décision 825) : les exigences de champ commun, résolues par clé dans l'espace.
	insert into public.workflow_transition_required_common_fields (transition_id, common_field_id)
	select (aretes ->> format('%s>%s', x ->> 'de', x ->> 'vers'))::uuid, f.id
	  from jsonb_array_elements(coalesce(proposition -> 'exigences_communes', '[]'::jsonb)) x
	  join public.card_common_fields f on f.workspace_id = espace and f.key = x ->> 'champ' and f.archived_at is null;

	-- Effet 7 — la décision ; `decided_by` et `decided_at` sont posés par le trigger.
	update public.suggestions_ia
	   set statut = 'acceptee', workflow_cree_id = le_workflow
	 where id = p_suggestion;

	return le_workflow;
end;
$function$;
