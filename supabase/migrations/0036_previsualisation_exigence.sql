-- @spec CRM-076 (docs/BACKLOG.md) — éditeur administrateur de workflows, sixième tranche :
--       la prévisualisation des effets, dernier point de comportement de sa Definition of Done
-- @spec docs/SPEC-workflow-engine.md §7 bis.13 (la tranche), §7 bis.13.1 (les DEUX effets),
--       §7 bis.13.2 (pourquoi le compte est fait par la base), §7 bis.13.3 (contrat et refus),
--       §5.3 (la sixième garde de `move_card`, dont ce compte est le miroir)
-- @spec docs/SPEC-form-composer.md §6.6 (« renseigné »), §3.1 (visibilité `required`)
-- @spec docs/SPEC-transition-required-fields.md §1 (l'union des deux origines)
-- @spec docs/SCHEMA.md §6 (fonctions exposées), « Conventions générales »
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décision 390
--
-- CETTE FONCTION EST UN MIROIR, PAS UNE SECONDE RÈGLE.
--
-- La sixième garde de `move_card` refuse un déplacement lorsqu'un champ exigé à l'étape d'arrivée
-- — par règle de visibilité OU par liaison de transition — n'est pas renseigné sur l'affaire. Elle
-- reste la seule autorité : rien ici ne garde quoi que ce soit, et l'écran ne doit jamais traiter
-- ce compte comme une permission.
--
-- Ce que la fonction ajoute est une question que la garde ne sait pas poser : « si je posais cette
-- exigence MAINTENANT, combien d'affaires en cours en souffriraient ? ». Elle est donc écrite
-- contre les MÊMES tables et avec le MÊME prédicat de vide, et sa preuve pgTAP vérifie que les
-- deux portent le même verdict sur la même affaire (§7 bis.13.6).
--
-- POURQUOI CE N'EST PAS L'ÉCRAN QUI COMPTE (§7 bis.13.2) :
--
--   1. « vide » est `app.valeur_de_champ_est_vide` — `null` SQL, `'null'` JSON, chaîne blanche,
--      tableau vide, et un `btrim` sur vingt-quatre points de code d'espaces (CRM-036). Réécrit en
--      TypeScript, ce prédicat aurait dérivé de celui de `move_card` sans que rien ne le signale.
--   2. La lecture serait non bornée : compter côté navigateur exige toutes les affaires du
--      workflow et toutes leurs valeurs de champ (CLAUDE.md §21).
--   3. Le compte doit être celui de ce que le lecteur a le droit de voir. D'où `security invoker`,
--      comme `etat_messagerie` et `inbox_arborescence` : un `security definer` aurait annoncé un
--      nombre d'affaires que son lecteur ne peut pas ouvrir.
--
-- ÉCRITE EN PL/pgSQL ET NON EN SQL, pour une raison de lisibilité du refus : `raise` appartient à
-- PL/pgSQL, et une fonction SQL aurait dû faire porter son refus par un appel auxiliaire glissé
-- dans une expression — une construction que la relecture suivante n'aurait pas comprise.
--
-- AUCUNE TABLE N'EST CRÉÉE NI MODIFIÉE. La migration n'ajoute qu'une fonction en lecture seule.

begin;

create or replace function public.previsualiser_exigence(
	p_field_id      uuid,
	p_step_id       uuid default null,
	p_transition_id uuid default null
)
returns table (sur_place bigint, a_l_entree bigint)
language plpgsql
stable
set search_path to ''
as $$
declare
	v_champ_actif boolean;
begin
	-- EXACTEMENT UNE CIBLE. Zéro compterait un ensemble que personne n'a demandé ; deux rendraient
	-- un nombre dont on ne saurait pas de quel geste il parle (§7 bis.13.3).
	if (p_step_id is null) = (p_transition_id is null) then
		raise exception 'previsualisation_cible'
			using errcode = 'P0001',
			      detail  = 'Fournir exactement une cible : une étape OU une transition, jamais les deux, jamais aucune.';
	end if;

	-- UN CHAMP ARCHIVÉ REND `0, 0`, et un champ inconnu aussi. La sixième garde filtre
	-- `f.archived_at is null` : l'exigence serait sans effet, et annoncer un nombre reviendrait à
	-- promettre une contrainte que `move_card` n'appliquerait jamais. Une cible inconnue ne lève
	-- PAS : c'est une course ordinaire entre la lecture de l'écran et l'appel, et l'écriture qui
	-- suit la signalera elle-même par son `23503`.
	select exists (
		select 1
		  from public.form_fields f
		 where f.id = p_field_id
		   and f.archived_at is null
	) into v_champ_actif;

	if not v_champ_actif then
		return query select 0::bigint, 0::bigint;
		return;
	end if;

	return query
	select
		-- SUR PLACE — les affaires DÉJÀ à l'étape visée. Elles ne sont jamais chassées (§5.7) :
		-- leur fiche signalera un manque. Toujours `0` pour une cible de transition, qui ne porte
		-- pas sur une étape mais sur un chemin.
		coalesce((
			select count(*)
			  from public.cards c
			 where p_step_id is not null
			   and c.current_step_id = p_step_id
			   and c.archived_at is null
			   and not exists (
			       select 1
			         from public.card_field_values v
			        where v.card_id = c.id
			          and v.field_id = p_field_id
			          and not app.valeur_de_champ_est_vide(v.value)
			   )
		), 0)::bigint,
		-- À L'ENTRÉE — les affaires qui, depuis leur étape courante, empruntent un chemin menant à
		-- la cible, et dont le champ est vide. `count(distinct c.id)` et non `count(*)` : cinq
		-- arêtes du seed mènent à `Perdu`, et une affaire qui en emprunte deux ne compte qu'une
		-- fois (§7 bis.13.3).
		coalesce((
			select count(distinct c.id)
			  from public.workflow_transitions t
			  join public.cards c
			    on c.current_step_id = t.from_step_id
			   and c.archived_at is null
			 where (
			       (p_step_id is not null and t.to_step_id = p_step_id)
			    or (p_transition_id is not null and t.id = p_transition_id)
			   )
			   and not exists (
			       select 1
			         from public.card_field_values v
			        where v.card_id = c.id
			          and v.field_id = p_field_id
			          and not app.valeur_de_champ_est_vide(v.value)
			   )
		), 0)::bigint;
end;
$$;

alter function public.previsualiser_exigence(uuid, uuid, uuid) owner to postgres;

comment on function public.previsualiser_exigence(uuid, uuid, uuid) is
	'CRM-076, sixième tranche (docs/SPEC-workflow-engine.md §7 bis.13) — combien d''affaires en '
	'cours une exigence ajouterait-elle de contrainte, si elle était posée maintenant. Miroir en '
	'lecture de la sixième garde de move_card, JAMAIS une garde : sur_place compte les affaires '
	'déjà à l''étape, a_l_entree celles qui ne pourraient plus y entrer. security invoker : le '
	'compte est celui de ce que l''appelant a le droit de lire.';

revoke all on function public.previsualiser_exigence(uuid, uuid, uuid) from public, anon;
grant execute on function public.previsualiser_exigence(uuid, uuid, uuid) to authenticated, service_role;

commit;
