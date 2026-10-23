-- @spec CRM-070 (docs/BACKLOG.md) — tranche T1 : l'accès effectif d'un membre, lu par l'administrateur de son espace
-- @spec docs/SPEC-membres.md §3.3 (les droits fins et l'accès qui en résulte), §5 point 1 (la fonction de lecture,
--       réservée à l'administrateur) ; docs/SPEC-permissions-rls.md §2.2 (« le plus spécifique gagne »), §3.3 bis (le
--       track lisible par l'un de ses channels) ; docs/SCHEMA.md §9 bis.8 quater ; docs/JOURNAL.md décisions 634 et 635 ;
--       docs/PROD_MIGRATIONS.md §3 (migration 96)
--
-- UNE FONCTION DE LECTURE, ET AUCUNE RÈGLE NOUVELLE. Pour chaque track et chaque channel vivants de l'espace, elle rend
-- le droit POSÉ pour la personne (`track_members`, `channel_members`, ou rien : hérité) et l'accès EFFECTIF qui en
-- résulte, calculé par les fonctions mêmes de la RLS : `app.resolve_access` sur le rôle de la personne
-- (`app.workspace_role_pour`) pour un track, `app.resolve_channel_access_pour` pour un channel. Pour un track, elle dit
-- aussi s'il est LISIBLE PAR L'UN DE SES CHANNELS — l'élargissement de la politique de lecture de `tracks`
-- (migration 34) —, de sorte que l'écran n'a rien à recalculer.
--
-- RÉSERVÉE À L'ADMINISTRATEUR DE L'ESPACE. `SECURITY DEFINER` est nécessaire : la RLS de `track_members` et de
-- `channel_members` ne rend à l'administrateur que les lignes de son espace, mais les fonctions `_pour` lisent pour
-- une AUTRE personne. La garde `app.is_workspace_admin(p_ws)` vient en premier et refuse tout autre appelant
-- (`42501`, `reserve_aux_administrateurs`) ; `search_path` vide ; `execute` à `authenticated` seul. Elle ne lit que
-- l'espace demandé, et une personne qui n'en est pas membre y reçoit `none` partout (« il n'existe pas de rôle
-- implicite »). Ordinaire, idempotente.

create or replace function public.acces_effectif_membre(p_ws uuid, p_user uuid)
returns table (
	objet text,
	id uuid,
	track_id uuid,
	nom text,
	archive boolean,
	acces_pose text,
	acces_effectif text,
	lisible_par_un_channel boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not app.is_workspace_admin(p_ws) then
		raise exception 'reserve_aux_administrateurs' using errcode = '42501';
	end if;

	return query
	select 'track'::text,
	       t.id,
	       t.id,
	       t.name,
	       t.archived_at is not null,
	       tm.access,
	       app.resolve_access(app.workspace_role_pour(p_ws, p_user), tm.access, null),
	       exists (
	           select 1
	             from public.channels c2
	            where c2.track_id = t.id
	              and c2.deleted_at is null
	              and app.resolve_channel_access_pour(p_ws, t.id, c2.id, p_user) <> 'none'
	       )
	  from public.tracks t
	  left join public.track_members tm on tm.track_id = t.id and tm.user_id = p_user
	 where t.workspace_id = p_ws
	   and t.deleted_at is null
	union all
	select 'channel'::text,
	       c.id,
	       c.track_id,
	       c.name,
	       c.archived_at is not null,
	       cm.access,
	       app.resolve_channel_access_pour(p_ws, c.track_id, c.id, p_user),
	       null::boolean
	  from public.channels c
	  left join public.channel_members cm on cm.channel_id = c.id and cm.user_id = p_user
	 where c.workspace_id = p_ws
	   and c.deleted_at is null;
end;
$$;

alter function public.acces_effectif_membre(uuid, uuid) owner to postgres;

comment on function public.acces_effectif_membre(uuid, uuid) is
	'CRM-070 — docs/SPEC-membres.md §3.3, §5 point 1. Pour chaque track et channel vivants de l''espace : le droit '
	'posé pour la personne et l''accès effectif (none, read, write) par les fonctions de la RLS ; pour un track, sa '
	'lisibilité par l''un de ses channels. Réservée à l''administrateur de l''espace (42501 sinon).';

revoke all on function public.acces_effectif_membre(uuid, uuid) from public, anon;
grant execute on function public.acces_effectif_membre(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
