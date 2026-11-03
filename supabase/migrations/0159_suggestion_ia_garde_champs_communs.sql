-- @spec CRM-112 (docs/BACKLOG.md) — tranche T2.d.0 : l'acceptation d'une suggestion de l'assistant ne retire plus les
--       champs communs exigés — le document cible reprend les exigences vivantes des transitions gardées
-- @spec docs/SPEC-champs-communs.md §5 ; docs/SPEC-ia.md §14 ; docs/SCHEMA.md « Migration `0159` »
--
-- CORRIGE UN DÉFAUT INTRODUIT PAR LA `0157` (T2.c.1) avant toute livraison : `app.appliquer_composition` lit une clé
-- `required_common_fields` absente comme « aucune », et `app.document_cible_ia` ne la portait pas. La fonction est reprise
-- à l'identique de sa définition en base, avec ce seul ajout.

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
	    || coalesce((select jsonb_build_object('required_common_fields', jsonb_agg(y))
	                   from jsonb_array_elements(vivant -> 'required_common_fields') y
	                  where y ->> 'transition_id' in (select v #>> '{}' from jsonb_each(aretes) as t(k, v))
	                 having count(*) > 0), '{}'::jsonb);
end;
$function$;
