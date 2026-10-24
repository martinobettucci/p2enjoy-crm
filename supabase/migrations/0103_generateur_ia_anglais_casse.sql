-- @spec CRM-113 (docs/BACKLOG.md) — tranche T5 : révision de la décision 679 (arbitrages du responsable du 2026-10-24),
--       avant toute livraison — clés anglaises de l'étape et de l'enveloppe des deux codes nouveaux, libellés comparés
--       sans la casse
-- @spec docs/SPEC-ia.md §14.3 (l'étape porte `label` et `probability` ; la règle d'écriture des surcharges, casse
--       ignorée ; `step_probability_invalid` et son enveloppe `{key}`), §14.4 (la composition vivante rend `label` et
--       `probability`), §14.5 (`native_field` et son enveloppe `{key, native}`) ; docs/SCHEMA.md « Migration `0103` » ;
--       docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décision 679 ; docs/DAT.md §3.2 bis (une migration appliquée
--       n'est jamais modifiée : sa correction est une migration nouvelle)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION CHANGE, ET RIEN D'AUTRE.
-- ---------------------------------------------------------------------------------------------
-- `0102` (CRM-113 T1) n'est pas livrée en production, mais elle est appliquée aux bases de développement : le registre
-- des migrations la refuse modifiée (docs/DAT.md §3.2 bis). Les quatre fonctions que la décision 679 touche sont donc
-- reprises ici de `0102` À L'IDENTIQUE, aux seuls changements suivants près :
--
-- 1. `app.ai_step_overrides` lit `label` et `probability` sur l'étape, et compare les libellés SANS LA CASSE : égal au
--    nœud à la casse près, rien ne surcharge ; face à une étape conservée dont la surcharge vivante n'en diffère que
--    par la casse, la surcharge vivante est gardée telle quelle.
-- 2. `app.proposition_ia_bien_formee` admet `label` et `probability` sur une étape, facultatifs.
-- 3. `app.defauts_proposition_ia` lit `probability` pour `step_probability_invalid` (chemin `etapes[i].probability`) ;
--    l'enveloppe des deux codes nouveaux devient `{key}` et `{key, native}`. Les trente-quatre codes existants gardent
--    `cle` : ils existaient avant l'unité et se migreront avec INC-286.
-- 4. `public.proposition_du_workflow` rend `label` et `probability` pour chaque étape.
--
-- `app.document_cible_ia` et `public.accepter_suggestion_ia` ne lisent pas ces clés : elles passent l'étape à
-- `app.ai_step_overrides` et ne changent pas. `create or replace` garde privilèges et commentaires. Aucune table ne
-- change, aucune donnée n'est réécrite : aucune révision `version: 1` portant les clés françaises de l'étape n'a été
-- livrée en production.
--
-- IDEMPOTENTE. Retour arrière : réappliquer les sections 2, 3, 4 et 5 de `0102`.

-- ---------------------------------------------------------------------------------------------
-- 2. La règle d'écriture des surcharges d'une étape (docs/SPEC-ia.md §14.3)
-- ---------------------------------------------------------------------------------------------
-- Rend `{label_override, probability_override}` pour une étape de la proposition, contre le nœud qu'elle vise :
--   - une valeur DIFFÉRENTE de celle du nœud devient la surcharge ;
--   - une valeur ÉGALE à celle du nœud ne surcharge rien (`null`) — c'est le seul moyen de retirer une surcharge ;
--   - clé absente, `null` ou texte blanc : rien pour une étape nouvelle, la surcharge vivante pour une étape conservée.
-- Les textes sont comparés sans leurs espaces de bord et SANS LA CASSE ; les nombres, en valeur. Une différence de casse
-- seule n'est jamais un changement (décision 679) : égale au nœud à la casse près, rien ne surcharge ; face à une étape
-- conservée dont la surcharge vivante n'en diffère que par la casse, la surcharge vivante est gardée telle quelle.
create or replace function app.ai_step_overrides(
	p_node uuid, p_step jsonb, p_label text, p_probability numeric, p_conserved boolean)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	libelle_noeud    text;
	probabilite_noeud numeric;
	libelle          text := nullif(btrim(case when jsonb_typeof(p_step -> 'label') = 'string' then p_step ->> 'label' end), '');
	probabilite      numeric := case when jsonb_typeof(p_step -> 'probability') = 'number' then (p_step ->> 'probability')::numeric end;
	surcharge_libelle text;
	surcharge_proba  numeric;
begin
	select btrim(n.label), n.default_probability into libelle_noeud, probabilite_noeud
	  from public.workflow_nodes_catalog n where n.id = p_node;

	if libelle is null then
		surcharge_libelle := case when p_conserved then p_label end;
	elsif lower(libelle) = lower(libelle_noeud) then
		surcharge_libelle := null;
	elsif p_conserved and lower(libelle) = lower(btrim(p_label)) then
		surcharge_libelle := p_label;
	else
		surcharge_libelle := libelle;
	end if;

	if probabilite is null then
		surcharge_proba := case when p_conserved then p_probability end;
	elsif probabilite is distinct from probabilite_noeud then
		surcharge_proba := probabilite;
	end if;

	return jsonb_build_object('label_override', surcharge_libelle, 'probability_override', surcharge_proba);
end;
$$;

revoke all on function app.ai_step_overrides(uuid, jsonb, text, numeric, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. La forme
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
		and jsonb_typeof(e -> 'vers') is not distinct from texte)
		from jsonb_array_elements(coalesce(p -> 'remappages', '[]'::jsonb)) e), true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Les défauts : `step_probability_invalid` et `native_field`
-- ---------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------
-- 5. La composition vivante rend les noms effectifs (docs/SPEC-ia.md §14.4)
-- ---------------------------------------------------------------------------------------------
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
	  from public.workflows w
	 where w.id = p_workflow
$$;

