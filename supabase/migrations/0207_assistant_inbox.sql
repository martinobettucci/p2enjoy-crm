-- @spec CRM-166 (docs/BACKLOG.md) — tranche T1 : la base de l'assistant de l'inbox — trois fonctions de LECTURE : les fils d'une
--       portée, le message le plus récent de chaque fil, le contexte de l'espace que le modèle reçoit
-- @spec docs/SPEC-ia.md §17.3 (ce qui part au modèle), §17.6 (les fonctions de lecture) ; docs/SPEC-mail-subsystem.md §32.2 (la portée),
--       §36 ; docs/SCHEMA.md « Migration `0207` » ; docs/JOURNAL.md décisions 994 et 997 ; CLAUDE.md §10 (la règle tenue en base)
--
-- AUCUNE TABLE, AUCUNE COLONNE, AUCUNE ÉCRITURE : le plan n'est conservé nulle part (docs/SPEC-ia.md §17.8). Les deux premières
-- fonctions passent par `app.inbox_scope_messages` — la portée des actions groupées, qui valide la description et ne rend que les
-- messages que l'appelant VOIT (`app.peut_voir_message`) : la fonction `ia` les appelle avec le jeton de la personne, jamais avec la
-- clé de service. La troisième est `SECURITY INVOKER` : la RLS décide ce que la personne lit de l'espace.
--
-- IDEMPOTENCE : `create or replace` partout.

-- =============================================================================================
-- 1. Les fils d'une portée — « tout sélectionner » sous un filtre (§17.6)
-- =============================================================================================

create or replace function public.inbox_assistant_threads(p_scope jsonb)
returns table (workspace_id uuid, thread_key text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	-- 51 AU PLUS : de quoi dire « plus de 50 » sans lire tout le filtre.
	return query
	select s.workspace_id, s.thread_key
	  from app.inbox_scope_messages(p_scope) s
	  join public.mail_messages m on m.id = s.message_id
	 group by s.workspace_id, s.thread_key
	 order by pg_catalog.max(m.received_at) desc, s.thread_key
	 limit 51;
end;
$$;

comment on function public.inbox_assistant_threads(jsonb) is
	'CRM-166 §17.6 — les clés des fils d''une portée, du plus récent au plus ancien, 51 au plus. Mêmes refus que inbox_bulk_apply.';

revoke all on function public.inbox_assistant_threads(jsonb) from public, anon;
grant execute on function public.inbox_assistant_threads(jsonb) to authenticated;

-- =============================================================================================
-- 2. Le message de chaque fil — ce que le modèle lit (§17.3)
-- =============================================================================================

create or replace function public.inbox_assistant_messages(p_scope jsonb)
returns table (
	workspace_id uuid,
	thread_key   text,
	message_id   uuid,
	subject      text,
	from_name    text,
	from_address text,
	received_at  timestamptz,
	body_text    text,
	body_html    text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	-- 50 FILS AU PLUS : la borne de la demande (§17.2). Au-delà, l'appel est refusé, jamais tronqué en silence.
	if (select pg_catalog.count(distinct (s.workspace_id, s.thread_key)) from app.inbox_scope_messages(p_scope) s) > 50 then
		raise exception 'too_many_threads' using errcode = '22023';
	end if;
	-- Par fil : le message REÇU le plus récent ; à défaut, le plus récent. Aucune pièce jointe, aucun destinataire.
	return query
	select distinct on (s.workspace_id, s.thread_key)
	       s.workspace_id, s.thread_key, m.id, m.subject, m.from_name, m.from_address, m.received_at, m.body_text, m.body_html
	  from app.inbox_scope_messages(p_scope) s
	  join public.mail_messages m on m.id = s.message_id
	 order by s.workspace_id, s.thread_key, (s.direction = 'inbound') desc, m.received_at desc, m.id desc;
end;
$$;

comment on function public.inbox_assistant_messages(jsonb) is
	'CRM-166 §17.3 — par fil de la portée, le message reçu le plus récent : objet, expéditeur, date, texte. 50 fils au plus (too_many_threads).';

revoke all on function public.inbox_assistant_messages(jsonb) from public, anon;
grant execute on function public.inbox_assistant_messages(jsonb) to authenticated;

-- =============================================================================================
-- 3. Le contexte de l'espace — pastilles, affaires classables, membres (§17.3)
-- =============================================================================================

create or replace function public.inbox_assistant_context(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
	if (select auth.uid()) is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;
	if not app.is_workspace_member(p_workspace_id) then
		raise exception 'workspace_not_member' using errcode = '42501';
	end if;
	return pg_catalog.jsonb_build_object(
		-- Les pastilles ACTIVES de l'espace, comme la passe des pastilles (§15.1).
		'labels', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', l.id, 'name', l.name, 'description', l.description) order by l.name)
			  from public.mail_labels l
			 where l.workspace_id = p_workspace_id and l.archived_at is null), '[]'::jsonb),
		-- Les 100 affaires les plus récemment modifiées de l'espace, hors corbeille, que la RLS laisse lire à la personne.
		'cards', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'title', c.title) order by c.updated_at desc, c.id)
			  from (select c2.id, c2.title, c2.updated_at
			          from public.cards c2
			         where c2.workspace_id = p_workspace_id and c2.deleted_at is null
			         order by c2.updated_at desc, c2.id
			         limit 100) c), '[]'::jsonb),
		-- Les membres à qui l'on peut transférer : l'espace entier, hors la personne.
		'members', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.id, 'full_name', p.full_name) order by p.full_name, p.id)
			  from public.workspace_members wm
			  join public.profiles p on p.id = wm.user_id
			 where wm.workspace_id = p_workspace_id and wm.user_id <> (select auth.uid())), '[]'::jsonb)
	);
end;
$$;

comment on function public.inbox_assistant_context(uuid) is
	'CRM-166 §17.3 — ce que le modèle reçoit de l''espace : pastilles actives, 100 affaires récentes lisibles, membres hors l''appelant. Sous la RLS.';

revoke all on function public.inbox_assistant_context(uuid) from public, anon;
grant execute on function public.inbox_assistant_context(uuid) to authenticated;
