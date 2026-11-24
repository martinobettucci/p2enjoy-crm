-- @spec CRM-161 (docs/BACKLOG.md) — tranche T3.c : `temps_valorise` rend l'espace de chaque ligne, pour la provenance et
--       le filtre « Espace » de Temps ▸ Rapport, qui lit déjà tous les espaces
-- @spec docs/SPEC-espace-courant.md §16.8.2 ; docs/SPEC-temps.md §6.2 ; docs/SPEC-rattachements.md §6 ; docs/SCHEMA.md
--       « Migration `0202` » ; décisions 963 et 965
--
-- LE TYPE DE RETOUR CHANGE (`workspace_id` en dernière colonne) : la fonction est supprimée puis recréée, ses droits avec
-- elle, comme la `0150` l'a fait. `rentabilite_affaires` l'appelle depuis un corps plpgsql, qui ne crée aucune dépendance
-- et lit ses colonnes par leur nom : elle n'est pas réécrite. Le connecteur (`crm_time_report`) ne recopie que les
-- colonnes qu'il nomme.
--
-- LE REGROUPEMENT GAGNE L'ESPACE SANS RIEN SCINDER : une saisie porte l'espace de sa cible, et un déplacement de track
-- (`0197`) réécrit celui de toutes ses saisies.
--
-- Retour arrière : supprimer la fonction, puis rejouer la section 2 de la `0150` (définition, commentaire, droits).

drop function if exists public.temps_valorise(date, date, uuid, uuid, uuid);

CREATE FUNCTION public.temps_valorise(p_debut date, p_fin date, p_profile uuid DEFAULT NULL::uuid, p_track uuid DEFAULT NULL::uuid, p_card uuid DEFAULT NULL::uuid)
 RETURNS TABLE(profile_id uuid, track_id uuid, channel_id uuid, card_id uuid, minutes bigint, montant numeric, devise text, shared boolean, workspace_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with saisies as (
		select s.workspace_id, s.profile_id, s.jour, s.minutes, s.card_id,
		       coalesce(s.channel_id, ca.channel_id)         as channel_id,
		       coalesce(s.track_id, ch.track_id)             as track_id,
		       coalesce(ca.partagee, false)                  as shared
		  from public.saisies_temps s
		  -- `CRM-111` T4.1 (décision 814) : une saisie posée sur l'affaire paraît sous CHAQUE channel rattaché lisible —
		  -- une saisie n'a qu'une cible (`saisies_temps_cible_check`), et seule une saisie d'affaire en a plusieurs —, et
		  -- `shared` le dit quand il y en a plus d'un ; la RLS de `card_placements` ne rend que les lisibles.
		  left join lateral (select pl.channel_id, count(*) over () > 1 as partagee
		                       from public.card_placements pl where pl.card_id = s.card_id) ca on true
		  left join public.channels ch on ch.id = coalesce(s.channel_id, ca.channel_id)
		 where s.jour between p_debut and p_fin
		   and (p_profile is null or s.profile_id = p_profile)
		   and (p_card is null or s.card_id = p_card)
	)
	select sa.profile_id, sa.track_id, sa.channel_id, sa.card_id,
	       sum(sa.minutes)::bigint,
	       sum(round(sa.minutes * v.cout_quart / 105, 2)),
	       v.devise,
	       sa.shared,
	       sa.workspace_id
	  from saisies sa
	  left join lateral (
		select cp.cout_quart, cp.devise
		  from public.couts_personnel cp
		 where cp.workspace_id = sa.workspace_id
		   and cp.profile_id = sa.profile_id
		   and cp.date_effet <= sa.jour
		 order by cp.date_effet desc
		 limit 1) v on true
	 where p_track is null or sa.track_id = p_track
	 group by sa.profile_id, sa.track_id, sa.channel_id, sa.card_id, v.devise, sa.shared, sa.workspace_id
	 order by sa.profile_id, sa.track_id, sa.channel_id nulls first, sa.card_id nulls first, v.devise;
$function$;

comment on function public.temps_valorise(date, date, uuid, uuid, uuid) is
	'CRM-098 et CRM-111 T4.1 — docs/SPEC-temps.md §6.2, docs/SPEC-rattachements.md §6 ; CRM-161 T3.c — '
	'docs/SPEC-espace-courant.md §16.8.2. Temps (minutes) et coût valorisé par la version en vigueur le jour travaillé, '
	'par personne × cible × devise, sous la RLS de l''appelant ; montant null sans version lisible. Une saisie d''affaire '
	'paraît sous chaque channel rattaché lisible, `shared` vrai s''il y en a plusieurs : un total la compte une fois. '
	'workspace_id : l''espace de la saisie.';

revoke all on function public.temps_valorise(date, date, uuid, uuid, uuid) from public, anon;
grant execute on function public.temps_valorise(date, date, uuid, uuid, uuid) to authenticated, service_role;
