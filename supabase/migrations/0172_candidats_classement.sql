-- @spec CRM-137 (docs/BACKLOG.md) — classer un mail : les affaires candidates d'un message, l'expéditeur connu d'abord,
--       cherchables par le titre et le chemin, sous les droits de l'appelant
-- @spec docs/SPEC-mail-subsystem.md §26.2 (le contrat) ; docs/SCHEMA.md « Migration `0172` — les affaires
--       candidates au classement d'un message » ; docs/JOURNAL.md décisions 877, 891 et 893 ; CLAUDE.md §10
--
-- UNE FONCTION, AUCUNE TABLE, AUCUNE COLONNE, AUCUNE DONNÉE. Elle est `security invoker` : chaque lecture passe par les
-- politiques de l'appelant (message, affaires, rattachements, channels, tracks, contacts et leurs liens), si bien
-- qu'aucun droit n'est calculé ici. Retour arrière : `drop function public.classification_candidates(uuid, boolean, text,
-- integer);`.

create or replace function public.classification_candidates(
	p_message_id   uuid,
	p_known_sender boolean default true,
	p_search       text    default null,
	p_limit        integer default 50
)
returns table (card_id uuid, title text, path text, known_sender boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_expediteur text;
	v_terme      text := nullif(btrim(coalesce(p_search, '')), '');
	v_limite     integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
	-- Le message doit être LISIBLE par l'appelant (`mail_messages_lecture`) : illisible et inexistant ne se distinguent
	-- pas (la convention de `CRM-120`).
	select lower(btrim(m.from_address)) into v_expediteur
	  from public.mail_messages m
	 where m.id = p_message_id;
	if not found then
		perform app.raise_http_error(404, 'message_not_found');
	end if;

	return query
	with candidates as (
		-- Une candidate : hors corbeille, avec au moins un rattachement non archivé LISIBLE. Le chemin est celui du plus
		-- ancien d'entre eux (la règle de `lireCardsClassables`, `CRM-111` T2.4.1).
		select c.id, c.title,
		       (select coalesce(t.name || ' › ' || ch.name, '')
		          from public.card_placements p
		          left join public.channels ch on ch.id = p.channel_id
		          left join public.tracks t on t.id = ch.track_id
		         where p.card_id = c.id and p.archived_at is null
		         order by p.created_at, p.id
		         limit 1) as chemin
		  from public.cards c
		 where c.deleted_at is null
		   and exists (select 1 from public.card_placements p where p.card_id = c.id and p.archived_at is null)
	),
	qualifiees as (
		select k.id, k.title, coalesce(k.chemin, '') as chemin,
		       -- « Connu » : un contact LISIBLE rattaché porte l'adresse exacte de l'expéditeur, sans casse — la
		       -- comparaison de la règle 3 (`0046`).
		       exists (
		         select 1
		           from public.card_contacts cc
		           join public.contacts ct on ct.id = cc.contact_id and ct.workspace_id = cc.workspace_id
		          where cc.card_id = k.id
		            and v_expediteur is not null
		            and lower(ct.email) = v_expediteur
		       ) as connu
		  from candidates k
	)
	select q.id, q.title, q.chemin, q.connu
	  from qualifiees q
	 where (not coalesce(p_known_sender, true) or q.connu)
	   and (v_terme is null
	        or extensions.unaccent(lower(q.title)) like '%' || extensions.unaccent(lower(v_terme)) || '%'
	        or extensions.unaccent(lower(q.chemin)) like '%' || extensions.unaccent(lower(v_terme)) || '%')
	 order by q.connu desc, q.title, q.id
	 limit v_limite;
end;
$$;

comment on function public.classification_candidates(uuid, boolean, text, integer) is
	'CRM-137 — les affaires où classer un message, sous les droits de l''appelant : connues de l''expéditeur d''abord, '
	'cherchables sans casse ni accents par le titre et le chemin. docs/SPEC-mail-subsystem.md §26.2.';

revoke all on function public.classification_candidates(uuid, boolean, text, integer) from public, anon;
grant execute on function public.classification_candidates(uuid, boolean, text, integer) to authenticated;
