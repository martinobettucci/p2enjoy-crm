-- @spec CRM-095 (docs/BACKLOG.md) — tranche T1 : créer une affaire depuis le board
-- @spec docs/SPEC-cards.md §18.2 (le geste serveur, ses refus, l'étape initiale) ; docs/SCHEMA.md §9
--       (fonctions et RPC) ; docs/SPEC-permissions-rls.md §4 (`cards_insertion`) ;
--       docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décision 609 — arbitrages du responsable : sur le board, le titre seul
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE.
-- ---------------------------------------------------------------------------------------------
-- Relevé en production le 2026-09-28 : aucune surface ne créait d'affaire — le seed était le seul
-- chemin (INC-256). Cette migration livre le geste serveur, `public.creer_affaire`, que l'écran du board
-- appelle avec le seul titre.
--
-- POURQUOI UNE FONCTION, et non une insertion directe par PostgREST : la règle « une affaire entre par
-- l'étape INITIALE de son workflow » (manuel §5 bis.2) n'était tenue par rien, et le client n'a pas à
-- la décider. La fonction résout, sous la RLS de l'appelant, le workflow du channel et son étape
-- initiale, et nomme ses refus.
--
-- SECURITY INVOKER, ET C'EST LE CHOIX DE FOND, comme pour `creer_workflow_de_depart` (0080) : la
-- fonction n'ouvre aucun droit. L'insertion reste soumise à `cards_insertion`
-- (`app.can_write_channel`) ; position, adresse et événement « créée » viennent des triggers existants.
--
-- PURE ADDITION : aucune table, aucune politique, aucun privilège de table ne change. Le runner
-- applique chaque fichier dans sa propre transaction : aucun `begin` ici.

create or replace function public.creer_affaire(p_channel uuid, p_titre text)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	appelant   uuid := auth.uid();
	le_channel record;
	l_etape    uuid;
	l_affaire  uuid;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if appelant is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. Le channel, lu sous la RLS de l'appelant : illisible et inexistant se confondent, et rien de
	--    ce que l'appelant ne voit pas n'est divulgué par la forme du refus.
	select c.id, c.workspace_id, c.workflow_id, c.archived_at, c.deleted_at
	  into le_channel
	  from public.channels c
	 where c.id = p_channel;
	if not found then
		raise exception 'channel introuvable'
			using errcode = 'P0002';
	end if;

	-- 3. Un channel archivé ou à la corbeille ne reçoit plus d'affaire.
	if le_channel.archived_at is not null or le_channel.deleted_at is not null then
		raise exception 'channel ferme'
			using errcode = 'P0001',
			      detail  = 'le channel est archive ou a la corbeille';
	end if;

	-- 4. L'étape d'entrée est l'étape INITIALE du workflow du channel.
	select s.id into l_etape
	  from public.workflow_steps s
	 where s.workflow_id = le_channel.workflow_id
	   and s.is_initial
	 order by s.position
	 limit 1;
	if l_etape is null then
		raise exception 'aucune etape initiale'
			using errcode = 'P0001',
			      detail  = 'designer l''etape initiale du workflow dans l''editeur';
	end if;

	-- 5. Une seule écriture. Un titre blanc est refusé par la contrainte existante (`23514`) ; un
	--    channel que l'appelant ne peut pas écrire, par `cards_insertion` (`42501`).
	insert into public.cards (workspace_id, channel_id, workflow_id, current_step_id, title, created_by)
	values (le_channel.workspace_id, le_channel.id, le_channel.workflow_id, l_etape, btrim(p_titre), appelant)
	returning id into l_affaire;

	return l_affaire;
end;
$$;

comment on function public.creer_affaire(uuid, text) is
	'Crée une affaire dans un channel vivant, à l''étape INITIALE de son workflow, avec le seul titre. '
	'SECURITY INVOKER : la RLS de `cards` fait foi. Refus : channel introuvable (P0002), fermé ou sans étape '
	'initiale (P0001), titre blanc (23514), écriture refusée (42501). CRM-095, docs/SPEC-cards.md §18.2.';

revoke all on function public.creer_affaire(uuid, text) from public, anon;
grant execute on function public.creer_affaire(uuid, text) to authenticated;

notify pgrst, 'reload schema';
