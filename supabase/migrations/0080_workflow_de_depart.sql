-- @spec CRM-094 (docs/BACKLOG.md) — tranche T1 : le workflow de départ d'un espace neuf
-- @spec docs/SPEC-workflow-engine.md §7 quater (le geste, ses quatre refus, le modèle, l'atomicité)
-- @spec docs/SPEC-onboarding.md §10.3 (le geste depuis l'étape « Workflow » du guide)
-- @spec docs/SCHEMA.md §9 (fonctions et RPC) ; docs/SPEC-permissions-rls.md §4 (écritures réservées
--       aux administrateurs) ; docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décision 606
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- Mesuré en production le 2026-09-28 : un espace neuf n'a ni workflow ni nœud de catalogue — le
-- workflow par défaut ne venait que du seed —, si bien qu'aucun channel n'y peut naître. Cette
-- migration livre un geste, `public.creer_workflow_de_depart`, qui pose en une transaction le cycle
-- commercial du seed : sept nœuds, un workflow, sept étapes, onze transitions.
--
-- SECURITY INVOKER, ET C'EST LE CHOIX DE FOND. La fonction n'ouvre aucun droit : elle enchaîne des
-- insertions que les politiques existantes réservent déjà aux administrateurs (catalogue, workflows,
-- étapes, transitions). Un appelant qui ne pourrait pas les écrire une à une ne les écrit pas
-- davantage ensemble. Les vérifications explicites ne sont là que pour rendre un refus LISIBLE avant
-- que la RLS ne le rende en 42501 anonyme.
--
-- PURE ADDITION : aucune table, aucune politique, aucun privilège de table ne change. Le runner
-- applique chaque fichier dans sa propre transaction (comme `0079`) : aucun `begin` ici.

create or replace function public.creer_workflow_de_depart(p_workspace uuid)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	appelant     uuid := auth.uid();
	le_workflow  uuid;
	un_defaut    boolean;
	modele       record;
	le_noeud     uuid;
	etapes       jsonb := '{}'::jsonb;
	archive      text;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if appelant is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. Réservé aux administrateurs de l'espace — revendication du domaine comprise (CRM-092 T8).
	--    Il précède le 3 : un non-administrateur n'apprend rien du contenu de l'espace.
	if not app.is_workspace_admin(p_workspace) then
		raise exception 'reserve aux administrateurs'
			using errcode = '42501',
			      detail  = 'le role requis est admin sur cet espace';
	end if;

	-- 3. Aucun workflow vivant : un double clic ne crée pas deux workflows.
	if exists (
		select 1 from public.workflows w
		 where w.workspace_id = p_workspace and w.archived_at is null
	) then
		raise exception 'workflow existant'
			using errcode = 'P0001',
			      detail  = 'cet espace a deja un workflow ; le composer depuis l''editeur';
	end if;

	-- 4. Aucune clé du modèle ne désigne un nœud ARCHIVÉ : le réactiver sans le dire changerait
	--    l'objet que l'administrateur a retiré.
	select n.key into archive
	  from public.workflow_nodes_catalog n
	 where n.workspace_id = p_workspace
	   and n.archived_at is not null
	   and n.key in ('prospection', 'relance', 'negociation', 'signature', 'realisation', 'livre', 'perdu')
	 order by n.key
	 limit 1;
	if archive is not null then
		raise exception 'noeud archive : %', archive
			using errcode = 'P0001',
			      detail  = 'restaurer ce noeud du catalogue, ou composer le workflow depuis l''editeur';
	end if;

	-- Le premier workflow d'un espace est son défaut — sauf si l'espace en porte déjà un, fût-il
	-- archivé : l'index `workflows_workspace_default_uk` le compte (§7 quater.2).
	un_defaut := not exists (
		select 1 from public.workflows w where w.workspace_id = p_workspace and w.is_default
	);

	insert into public.workflows (workspace_id, name, scope, is_default)
	values (p_workspace, 'Cycle commercial', 'global', un_defaut)
	returning id into le_workflow;

	-- Nœuds et étapes, dans l'ordre du modèle. Une clé vivante est réutilisée telle quelle : son
	-- libellé et ses réglages sont ceux de l'administrateur.
	for modele in
		select * from (values
			(1, 'prospection', 'Prospection', 'open', 'neutral', 10::numeric, 14,   true),
			(2, 'relance',     'Relance',     'open', 'accent',  20::numeric, 7,    false),
			(3, 'negociation', 'Négociation', 'open', 'brand',   50::numeric, 10,   false),
			(4, 'signature',   'Signature',   'open', 'brand',   90::numeric, 7,    false),
			(5, 'realisation', 'Réalisation', 'open', 'success', 100::numeric, 30,  false),
			(6, 'livre',       'Livré',       'won',  'success', 100::numeric, null, false),
			(7, 'perdu',       'Perdu',       'lost', 'danger',  0::numeric,  null, false)
		) as m(position, cle, libelle, genre, couleur, probabilite, seuil, initiale)
		order by m.position
	loop
		select n.id into le_noeud
		  from public.workflow_nodes_catalog n
		 where n.workspace_id = p_workspace and n.key = modele.cle;

		if le_noeud is null then
			insert into public.workflow_nodes_catalog (
				workspace_id, key, label, kind, color, default_probability, default_stale_after_days
			)
			values (
				p_workspace, modele.cle, modele.libelle, modele.genre, modele.couleur,
				modele.probabilite, modele.seuil
			)
			returning id into le_noeud;
		end if;

		insert into public.workflow_steps (workflow_id, workspace_id, node_id, position, is_initial)
		values (le_workflow, p_workspace, le_noeud, modele.position, modele.initiale)
		returning jsonb_build_object(modele.cle, id) || etapes into etapes;
	end loop;

	-- Onze transitions ; « Marquer perdu » exige un commentaire.
	insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id, label, require_comment)
	select le_workflow, p_workspace, (etapes ->> t.de)::uuid, (etapes ->> t.vers)::uuid, t.libelle, t.commentaire
	  from (values
		('prospection', 'relance',     'Relancer',                false),
		('relance',     'negociation', 'Engager la négociation',  false),
		('negociation', 'relance',     'Revenir en relance',      false),
		('negociation', 'signature',   'Passer en signature',     false),
		('signature',   'realisation', 'Démarrer la réalisation', false),
		('realisation', 'livre',       'Marquer comme livré',     false),
		('prospection', 'perdu',       'Marquer perdu',           true),
		('relance',     'perdu',       'Marquer perdu',           true),
		('negociation', 'perdu',       'Marquer perdu',           true),
		('signature',   'perdu',       'Marquer perdu',           true),
		('realisation', 'perdu',       'Marquer perdu',           true)
	  ) as t(de, vers, libelle, commentaire);

	return le_workflow;
end;
$$;

comment on function public.creer_workflow_de_depart(uuid) is
	'Pose, en une transaction, le workflow de départ d''un espace sans workflow : le cycle commercial '
	'du seed (sept nœuds réutilisés ou créés, sept étapes, onze transitions). SECURITY INVOKER : la RLS '
	'des tables écrites fait foi. Quatre refus. CRM-094, docs/SPEC-workflow-engine.md §7 quater.';

revoke all on function public.creer_workflow_de_depart(uuid) from public, anon;
grant execute on function public.creer_workflow_de_depart(uuid) to authenticated;

notify pgrst, 'reload schema';
