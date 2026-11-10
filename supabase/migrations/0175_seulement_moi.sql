-- @spec CRM-139 (docs/BACKLOG.md) — « Seulement moi » : le courrier qui concerne l'appelant, et les compteurs de l'inbox
--       qui suivent la case
-- @spec docs/SPEC-mail-subsystem.md §27.2 (le contrat de `concerns_me`), §27.3 (la liste et les compteurs) ;
--       docs/SCHEMA.md « Migration `0175` » ; docs/JOURNAL.md décisions 879 et 902 ; CLAUDE.md §10
--
-- DEUX FONCTIONS, AUCUNE TABLE, AUCUNE COLONNE, AUCUNE DONNÉE, AUCUNE POLITIQUE. Ce n'est pas une règle d'accès : la RLS
-- des messages ne change pas, et `concerns_me` ne restreint que ce que l'appelant DEMANDE à voir (§27.1).
--
-- RÉ-EXÉCUTABLE : la migration se joue d'abord à la main en développement, hors du registre, tant que l'unité n'est pas
-- `[P]` (règle de la session de livraison du 2026-11-10), puis par le runner. Chaque objet est donc retiré s'il existe
-- avant d'être posé.
--
-- Retour arrière : `drop function public.concerns_me(public.mail_messages)`, `drop function
-- public.inbox_arborescence(boolean)`, puis reposer `public.inbox_arborescence()` de la `0154`.

-- `concerns_me` — vraie quand une adresse du message est celle d'une identité PERSONNELLE de l'appelant (§27.2).
-- `security invoker` : les identités sont lues sous la RLS, et le filtre `owner_id = auth.uid()` écarte celles qu'un
-- administrateur lit pour les autres. L'identité de service (`owner_id` nul) n'est l'adresse de personne. Les adresses
-- du message sont stockées nues et en minuscules par `mail-sync` ; l'identité peut porter des majuscules.
-- LE PARAMÈTRE N'A PAS DE NOM, et ce n'est pas un oubli : c'est ce qui fait de la fonction une COLONNE CALCULÉE pour
-- PostgREST et pour le générateur de types, comme `is_read` (§18 bis.3). Nommée, elle n'entrait pas dans `Row`, et la liste
-- ne pouvait ni la lire ni la filtrer par son nom. Retirée d'abord : un nom de paramètre ne se change pas par `replace`.
drop function if exists public.concerns_me(public.mail_messages);
create function public.concerns_me(public.mail_messages)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
	select exists (
		select 1
		  from public.mail_outbound_identities i
		 where i.owner_id = (select auth.uid())
		   and lower(btrim(i.from_address)) in (
			select lower(btrim(a))
			  from unnest(
				coalesce($1.to_addresses, '{}'::text[])
				|| coalesce($1.cc_addresses, '{}'::text[])
				|| coalesce($1.bcc_addresses, '{}'::text[])
				|| array[$1.from_address]
			  ) as a
			 where a is not null
		   )
	);
$$;

comment on function public.concerns_me(public.mail_messages) is
	'CRM-139 : vrai quand le message est adressé à (À, Cc, Cci) ou expédié par une identité sortante personnelle de l''appelant. Restriction d''affichage, pas règle d''accès.';

revoke all on function public.concerns_me(public.mail_messages) from public, anon;
grant execute on function public.concerns_me(public.mail_messages) to authenticated, service_role;

-- `inbox_arborescence` — la `0154`, avec un argument : cochée, la case ne compte que le courrier qui concerne l'appelant
-- (§27.3). Retirée puis reposée, et non surchargée : deux fonctions de même nom rendraient ambigu l'appel sans argument.
drop function if exists public.inbox_arborescence();
drop function if exists public.inbox_arborescence(boolean);

create function public.inbox_arborescence(p_only_me boolean default false)
returns table (track_id uuid, track_name text, channel_id uuid, channel_name text, card_id uuid, card_title text,
               nombre bigint, unread_count bigint)
language sql
stable
set search_path = ''
as $$
	-- `CRM-111` T6.1 (décision 657) : les affaires ne se rangent plus sous leurs channels — une affaire partagée n'a
	-- qu'un dossier. Le type de retour est gardé : le track et le channel d'une ligne d'affaire sont nuls. La ligne des
	-- NON CLASSÉS vient toujours en premier, et existe même à zéro (§18.3) ; les affaires suivent par titre, puis par
	-- identifiant. `CRM-139` : `p_only_me` ne compte que les messages qui concernent l'appelant (§27.3) ; une affaire
	-- dont aucun message ne le concerne n'a pas de ligne, comme une affaire sans message.
	select x.track_id, x.track_name, x.channel_id, x.channel_name, x.card_id, x.card_title, x.nombre, x.unread_count
	  from (
		select null::uuid as track_id, null::text as track_name, null::uuid as channel_id, null::text as channel_name,
		       null::uuid as card_id, null::text as card_title, count(*) as nombre,
		       count(*) filter (where not public.is_read(m)) as unread_count
		  from public.mail_messages m
		 where m.card_id is null
		   and (not coalesce(p_only_me, false) or public.concerns_me(m))
		union all
		select null::uuid, null::text, null::uuid, null::text, c.id, c.title, count(*),
		       count(*) filter (where not public.is_read(m))
		  from public.mail_messages m
		  join public.cards c on c.id = m.card_id
		 where (not coalesce(p_only_me, false) or public.concerns_me(m))
		 group by c.id, c.title
	  ) x
	 order by x.card_id is not null, x.card_title collate "fr-FR-x-icu", x.card_id;
$$;

revoke all on function public.inbox_arborescence(boolean) from public, anon;
grant execute on function public.inbox_arborescence(boolean) to authenticated, service_role;
