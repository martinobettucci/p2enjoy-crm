-- @spec CRM-112 (docs/BACKLOG.md) — tranche T7 : le générateur ne doublonne pas un champ de l'affaire — le défaut bloquant
--       `common_field` (`key`, `common_key`, `common_label`) relevé par `app.defauts_proposition_ia` sur un champ nouveau
--       qui reprend un champ de l'affaire actif de l'espace
-- @spec docs/SPEC-ia.md §14.11 (décision 851), §14.5 (`native_field`, dont il suit le chemin), §12.1 et §12.3 (contrôle 7 :
--       tout défaut bloque l'acceptation) ; docs/SPEC-champs-communs.md §12 ; docs/SCHEMA.md « Migration `0169` »
--
-- LA FONCTION EST REPRISE À L'IDENTIQUE DE SA DÉFINITION EN BASE (`pg_get_functiondef`, celle de la migration `0160`),
-- avec un seul ajout : la variable `commun` et le bloc `common_field`, juste après `native_field`. Un espace sans champ
-- de l'affaire, ou dont les champs ne répondent à aucun champ proposé, rend les mêmes défauts qu'avant. Les révisions
-- déjà enregistrées gardent leurs défauts écrits.
--
-- IDEMPOTENCE : `create or replace`, privilèges conservés.
-- RETOUR ARRIÈRE : rejouer la définition de `app.defauts_proposition_ia` de la migration `0160`.

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
	-- `CRM-112` T7 (docs/SPEC-ia.md §14.11, décision 851) : le champ de l'affaire que doublonne un champ nouveau.
	commun     record;
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
			-- `CRM-112` T7 (docs/SPEC-ia.md §14.11, décision 851) : un champ NOUVEAU qui doublonne un champ de l'affaire
			-- NON archivé de l'espace — par les clés, ou par les libellés mis à la forme des clés ; égalités EXACTES. Le
			-- premier dans l'ordre `position`, puis `key`, est nommé.
			select f.key, f.label into commun
			  from public.card_common_fields f
			 where f.workspace_id = p_workspace and f.archived_at is null
			   and (f.key in (cle, app.cle_de_libelle_ia(e.v ->> 'libelle'))
			        or app.cle_de_libelle_ia(f.label) in (cle, app.cle_de_libelle_ia(e.v ->> 'libelle')))
			 order by f.position, f.key
			 limit 1;
			if found then
				defauts := defauts || jsonb_build_object('code', 'common_field', 'chemin', format('champs[%s]', e.i),
					'valeurs', jsonb_build_object('key', cle, 'common_key', commun.key, 'common_label', commun.label));
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
