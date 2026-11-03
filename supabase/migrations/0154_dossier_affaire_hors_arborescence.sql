-- @spec CRM-111 (docs/BACKLOG.md) — tranche T6.1 : le dossier d'une affaire hors de l'arborescence
-- @spec docs/SPEC-rattachements.md §7 (décisions 657, 818 et 820) ; docs/SPEC-mail-subsystem.md §4.5, §18 ;
--       docs/SCHEMA.md « Migration `0154` » ; docs/PROD_MIGRATIONS.md §3
--
-- DEUX FONCTIONS, réécrites depuis leur dernière autorité (la `0109`). Leur signature ne change pas. Le registre des
-- dossiers (`mail_folder_map`, `dossiers_a_renommer` de la `0027`) voit chaque dossier d'affaire diverger de son nouveau
-- chemin : `mail-sync` le renomme à sa relève suivante, sans autre changement de la base.

CREATE OR REPLACE FUNCTION public.chemin_dossier_card(p_card_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
	-- `CRM-111` T6.1 (décisions 657 et 818) : le dossier d'une affaire sort de l'arborescence des tracks et des channels,
	-- et se nomme de son titre assaini suivi des 8 DERNIERS caractères de son identifiant (décision 820 : les 8 premiers
	-- sont `5eed0000` pour tout le seed) — deux affaires de même titre ont deux dossiers, et le nom ne change qu'avec le
	-- titre.
	select 'CRM/Affaires/'
	       || app.assainir_segment_dossier(c.title)
	       || ' (' || pg_catalog.right(c.id::text, 8) || ')'
	  from public.cards c
	 where c.id = p_card_id;
$function$;

CREATE OR REPLACE FUNCTION public.inbox_arborescence()
 RETURNS TABLE(track_id uuid, track_name text, channel_id uuid, channel_name text, card_id uuid, card_title text, nombre bigint, unread_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	-- `CRM-111` T6.1 (décision 657) : les affaires ne se rangent plus sous leurs channels — une affaire partagée n'a
	-- qu'un dossier. Le type de retour est gardé : le track et le channel d'une ligne d'affaire sont nuls. La ligne des
	-- NON CLASSÉS vient toujours en premier, et existe même à zéro (§18.3) ; les affaires suivent par titre, puis par
	-- identifiant.
	select x.track_id, x.track_name, x.channel_id, x.channel_name, x.card_id, x.card_title, x.nombre, x.unread_count
	  from (
		select null::uuid as track_id, null::text as track_name, null::uuid as channel_id, null::text as channel_name,
		       null::uuid as card_id, null::text as card_title, count(*) as nombre,
		       count(*) filter (where not public.is_read(m)) as unread_count
		  from public.mail_messages m
		 where m.card_id is null
		union all
		select null::uuid, null::text, null::uuid, null::text, c.id, c.title, count(*),
		       count(*) filter (where not public.is_read(m))
		  from public.mail_messages m
		  join public.cards c on c.id = m.card_id
		 group by c.id, c.title
	  ) x
	 order by x.card_id is not null, x.card_title collate "fr-FR-x-icu", x.card_id;
$function$;
