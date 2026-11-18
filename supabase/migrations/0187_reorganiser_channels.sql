-- @spec CRM-154 (docs/BACKLOG.md) — tranche T2 : réorganiser les channels d'un track, une fonction atomique
-- @spec docs/SPEC-administration-arborescence.md §15.2 (un ordre, pas des positions ; les channels actifs du track ;
--       `security invoker` ; les quatre refus ; une instruction ; privilèges), §15.3 (l'arborescence l'emploie aussi)
-- @spec docs/SCHEMA.md « Migration `0187` » ; docs/JOURNAL.md décisions 935 et 938
-- @spec docs/SPEC-channels.md §3 (`position`, portée du track, égalité départagée par le nom)
--
-- CETTE MIGRATION CRÉE UNE SEULE FONCTION, ET NE TOUCHE À RIEN D'AUTRE : aucune table, colonne, contrainte, politique
-- ni déclencheur. Elle rend exprimable en UN appel un geste que PostgREST ne sait écrire qu'en n `PATCH` non atomiques :
-- poser l'ordre entier des onglets d'un track.
--
-- LE PATRON EST CELUI DE `public.reordonner_paliers_sequence` (migration 0062), à une différence près, écrite au point
-- (d) : un refus de la politique d'écriture LÈVE, au lieu de rendre `0`.
--
-- Idempotence : le `migrations-runner` rejoue tout le répertoire à chaque démarrage ; `create or replace`, `revoke` et
-- `grant` sont convergents.

-- =============================================================================================
-- 1. `public.reorder_channels` — l'ordre voulu, transcrit en positions 1..n
-- =============================================================================================
--
-- ELLE PREND UN ORDRE, PAS DES POSITIONS (§15.2) : l'écran envoie la liste qu'il affiche, la base la transcrit. Une
-- fonction qui prendrait « ce channel monte d'un cran » devrait relire l'état courant, et deux appels concurrents
-- liraient le même.
--
-- LA LISTE EST CELLE DES CHANNELS ACTIFS DU TRACK — ni archivés, ni à la corbeille. Les autres gardent leur position.

create or replace function public.reorder_channels(
	p_track_id    uuid,
	p_channel_ids uuid[]
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
	v_attendus integer;
	v_communs  integer;
	v_nommes   integer;
	v_reposes  integer;
begin
	-- (a) Un ordre vide ne réordonne rien ; le laisser passer rendrait 0, indiscernable d'un échec.
	if p_channel_ids is null or cardinality(p_channel_ids) = 0 then
		raise exception 'channel_order_required' using errcode = '23514';
	end if;

	-- (b) Un doublon laisserait un rang inoccupé et un channel non repositionné, sans qu'aucune contrainte ne le voie.
	if cardinality(p_channel_ids) <> (select count(distinct u.id) from unnest(p_channel_ids) as u(id)) then
		raise exception 'channel_order_duplicated' using errcode = '23514';
	end if;

	-- (c) L'ordre doit être EXACTEMENT l'ensemble des channels actifs du track, LUS SOUS LA RLS DE L'APPELANT : un track
	--     inconnu ou illisible donne 0 attendu, et le même refus — rien n'est révélé de ce qui existe.
	select count(*) into v_attendus
	  from public.channels c
	 where c.track_id = p_track_id
	   and c.archived_at is null
	   and c.deleted_at is null;

	select count(*) into v_communs
	  from public.channels c
	 where c.track_id = p_track_id
	   and c.archived_at is null
	   and c.deleted_at is null
	   and c.id = any (p_channel_ids);

	v_nommes := cardinality(p_channel_ids);

	if v_attendus <> v_nommes or v_communs <> v_nommes then
		raise exception 'channel_order_incomplete' using errcode = '23514';
	end if;

	-- UNE SEULE INSTRUCTION. `with ordinality` numérote le tableau dans l'ordre reçu, à partir de 1. La garde du track et
	-- de l'état actif est REPOSÉE dans le `where` : elle vit dans la même instruction que l'écriture. `position` n'a pas
	-- de contrainte d'unicité : aucun `set constraints` n'a lieu d'être.
	update public.channels c
	   set position = o.rang
	  from (
	         select u.id, u.ord::integer as rang
	           from unnest(p_channel_ids) with ordinality as u(id, ord)
	       ) o
	 where c.id = o.id
	   and c.track_id = p_track_id
	   and c.archived_at is null
	   and c.deleted_at is null;

	get diagnostics v_reposes = row_count;

	-- (d) MOINS DE LIGNES ÉCRITES QUE NOMMÉES : la politique `channels_maj_admin` en a écarté. LA FONCTION LÈVE, ET
	--     L'APPEL ENTIER EST ANNULÉ — aucune position n'a changé. Écart à la migration 0062, qui rend `0` : ici, un ordre
	--     partiellement appliqué serait pire qu'un refus, et l'écran lit un refus nommé (`403`) plutôt qu'un zéro.
	if v_reposes <> v_nommes then
		raise exception 'channel_reorder_forbidden' using errcode = '42501';
	end if;

	return v_reposes;
end;
$$;

alter function public.reorder_channels(uuid, uuid[]) owner to postgres;

comment on function public.reorder_channels(uuid, uuid[]) is
	'CRM-154 §15.2 — pose les positions 1..n des channels actifs d''un track dans l''ordre du tableau reçu, en UNE '
	'instruction. `security invoker` : la politique channels_maj_admin décide. Refus : channel_order_required, '
	'channel_order_duplicated, channel_order_incomplete (23514) ; channel_reorder_forbidden (42501), qui annule tout.';

-- =============================================================================================
-- 2. Privilèges — §15.2
-- =============================================================================================
-- `anon` est révoqué NOMMÉMENT : la plateforme porte des `alter default privileges … to anon`, et un `revoke … from
-- public` ne retire rien à un rôle nommé (le point de sûreté des migrations 48 à 62).

revoke all on function public.reorder_channels(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_channels(uuid, uuid[]) to authenticated, service_role;

notify pgrst, 'reload schema';
