-- @spec CRM-097 (docs/BACKLOG.md) — tranche T2.a : le contrôle des propositions en base, et l'acceptation
-- @spec docs/SPEC-ia.md §12.1 (la base, seule juge des défauts : la forme, les vingt-neuf codes, `{code, chemin,
--       valeurs}`), §12.2 (une correction refusée pendant une génération), §12.3 (l'acceptation : sept refus,
--       sept effets, en une transaction) ; §2 (rien dans la configuration avant « Accepter »)
-- @spec docs/SCHEMA.md §9 ter (migration `0084`) ; docs/PROD_MIGRATIONS.md §3 (migrations en attente) ;
--       docs/JOURNAL.md décision 618
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- Trois objets, aucune table. (1) `app.defauts_proposition_ia`, le seul contrôle d'une proposition
-- `version: 1` : la fonction `ia`, l'écran et l'acceptation s'en remettent à lui, là où trois copies des mêmes
-- règles auraient divergé (décision 618). (2) Le trigger de création d'une révision, révisé : il écrit les
-- défauts de TOUTE révision et refuse une correction pendant une génération ; le client ne fournit plus
-- `defauts`. (3) `public.accepter_suggestion_ia`, le geste qui crée le workflow.
--
-- IDEMPOTENTE ET CONVERGENTE : fonctions remplacées, privilèges retirés puis reposés. Le runner applique le
-- fichier dans sa transaction ; une adoption rejoue `0083` puis celui-ci, qui reprend la main.

-- ---------------------------------------------------------------------------------------------
-- 1. La forme d'une proposition (docs/SPEC-ia.md §12.1)
-- ---------------------------------------------------------------------------------------------
-- Une forme invalide n'est pas un défaut : c'est une révision qu'aucun chemin du produit ne produit, et elle
-- est refusée. Les contrôles s'enchaînent dans l'ordre où ils sont sûrs : un `jsonb_array_elements` sur ce
-- qui n'est pas un tableau lèverait une erreur au lieu de répondre.
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
		from jsonb_array_elements(p -> 'exigences') e), true);
end;
$$;

-- La clé d'un choix, dérivée de son libellé (docs/SPEC-ia.md §12.3) : accents retirés, minuscules, tout autre
-- caractère en tiret — la forme `^[a-z0-9]+(-[a-z0-9]+)*$` du produit. Une clé vide est un défaut, jamais une
-- valeur de repli.
create or replace function app.cle_de_libelle_ia(libelle text)
returns text
language sql
stable
set search_path = ''
as $$
	select btrim(regexp_replace(lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(libelle, ''))),
	                            '[^a-z0-9]+', '-', 'g'), '-')
$$;

-- ---------------------------------------------------------------------------------------------
-- 2. Les défauts (docs/SPEC-ia.md §12.1 — l'ordre des codes est celui du tableau de la spécification)
-- ---------------------------------------------------------------------------------------------
-- SECURITY INVOKER : le catalogue est lu sous les droits de celui qui écrit. Un administrateur, la clé de
-- service et le propriétaire du geste d'acceptation le lisent en entier ; personne d'autre n'écrit de révision.
create or replace function app.defauts_proposition_ia(p_workspace uuid, p_proposition jsonb)
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
		if btrim(e.v ->> 'libelle') = '' then
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

	return defauts;
end;
$$;

revoke all on function app.proposition_ia_bien_formee(jsonb) from public;
revoke all on function app.cle_de_libelle_ia(text) from public;
revoke all on function app.defauts_proposition_ia(uuid, jsonb) from public;
grant execute on function app.proposition_ia_bien_formee(jsonb) to authenticated, service_role;
grant execute on function app.cle_de_libelle_ia(text) to authenticated, service_role;
grant execute on function app.defauts_proposition_ia(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3. La révision : défauts écrits par la base, correction refusée pendant une génération (§12.1, §12.2)
-- ---------------------------------------------------------------------------------------------
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
	new.defauts := app.defauts_proposition_ia(la_suggestion.workspace_id, new.proposition);
	new.numero := coalesce(
		(select max(r.numero) from public.suggestions_ia_revisions r where r.suggestion_id = new.suggestion_id), 0) + 1;
	return new;
end;
$$;

revoke all on function app.suggestions_ia_revisions_avant_creation() from public;

-- LE GEL LAISSE PASSER L'EFFACEMENT D'UN LIEN — défaut de `0083` trouvé le 2026-10-02 par le retrait des sondes de
-- l'API, rejoué en pgTAP avant correction (`0078`, 69 à 74). Les clés `on delete set null` — workflow créé, version
-- de retour, auteur, décideur — METTENT À JOUR une suggestion décidée quand ce qu'elle désigne disparaît ; le gel les
-- refusait, si bien qu'un workflow créé par une acceptation, un profil, ou l'espace entier ne se supprimaient plus.
-- Seul passe un changement qui ne fait QU'effacer un ou plusieurs de ces quatre liens : poser un lien, ou toucher
-- toute autre colonne, reste refusé. Le reste de la fonction est celui de `0083`, inchangé.
create or replace function app.suggestions_ia_avant_maj()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
	liens constant text[] := array['workflow_cree_id', 'version_retour_id', 'created_by', 'decided_by'];
begin
	if old.statut <> 'en_revue' then
		if (to_jsonb(new) - liens) = (to_jsonb(old) - liens)
		   and (new.workflow_cree_id is null or new.workflow_cree_id = old.workflow_cree_id)
		   and (new.version_retour_id is null or new.version_retour_id = old.version_retour_id)
		   and (new.created_by is null or new.created_by = old.created_by)
		   and (new.decided_by is null or new.decided_by = old.decided_by) then
			return new;
		end if;
		raise exception 'suggestion figee' using errcode = 'P0001';
	end if;
	if new.statut = 'acceptee' and current_user = 'authenticated' then
		raise exception 'acceptation reservee au geste d''acceptation' using errcode = '42501';
	end if;
	if new.statut <> 'en_revue' then
		new.decided_at := now();
		new.decided_by := coalesce(new.decided_by, auth.uid());
		new.generation_depuis := null;
	end if;
	return new;
end;
$$;

revoke all on function app.suggestions_ia_avant_maj() from public;

-- Le même défaut, sur les révisions : `created_by on delete set null` met à jour une révision immuable. Seul passe
-- l'effacement de l'auteur ; toute autre modification reste refusée.
create or replace function app.suggestions_ia_revisions_refuser_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') and new.created_by is null then
		return new;
	end if;
	raise exception 'revision immuable' using errcode = 'P0001';
end;
$$;

revoke all on function app.suggestions_ia_revisions_refuser_mutation() from public;

-- Le client ne fournit plus `defauts`. Retirer le privilège de table retire aussi ceux de colonne ; les quatre
-- colonnes qu'un client écrit sont reposées, nommées.
revoke insert on public.suggestions_ia_revisions from authenticated;
grant insert (suggestion_id, origine, consigne, proposition) on public.suggestions_ia_revisions to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. Accepter (docs/SPEC-ia.md §12.3)
-- ---------------------------------------------------------------------------------------------
-- SECURITY DEFINER : l'état `acceptee` est refusé à `authenticated` par le trigger de `0083`, si bien qu'un geste
-- `invoker` ne pourrait jamais conclure. Le propriétaire traverse la RLS : les sept vérifications sont donc
-- écrites ici, à la main, et tout ce qui est écrit l'est dans l'espace de la suggestion. Les contraintes des
-- tables restent en vigueur : une violation imprévue annule la transaction entière.
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
	if la_suggestion.portee <> 'workflow' or la_suggestion.workflow_id is not null then
		raise exception 'portee non livree' using errcode = 'P0001',
			detail = 'seule la creation d''un workflow est acceptee (CRM-097 T2)';
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
	defauts := app.defauts_proposition_ia(espace, proposition);
	if jsonb_array_length(defauts) > 0 then
		raise exception 'proposition non conforme' using errcode = 'P0001',
			detail = format('%s defaut(s)', jsonb_array_length(defauts));
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
	'Accepte une suggestion de l''assistant IA : recontrôle sa dernière révision, puis crée en une transaction '
	'le workflow, ses nœuds, étapes, transitions, champs, règles et exigences. SECURITY DEFINER, sept refus '
	'écrits à la main. CRM-097 T2, docs/SPEC-ia.md §12.3.';

revoke all on function public.accepter_suggestion_ia(uuid) from public, anon;
grant execute on function public.accepter_suggestion_ia(uuid) to authenticated;

notify pgrst, 'reload schema';
