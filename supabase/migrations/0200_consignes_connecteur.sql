-- @spec CRM-165 (docs/BACKLOG.md) — tranche T1 : les consignes de la plateforme — un texte unique, réglé par le
--       super-administrateur, que le service `mcp` ajoute au socle de ses consignes à chaque connexion ; le socle, publié
--       en base par le service
-- @spec docs/SPEC-mcp.md §18.2, §18.3 ; docs/SCHEMA.md « Migration `0200` » ; décisions 980 et 983 ; CLAUDE.md §10 (la règle
--       d'écriture appliquée en base)
--
-- AUCUN ACCÈS DIRECT : la table n'a ni politique ni privilège client. Le super-administrateur lit et écrit par deux
-- fonctions gardées ; le service `mcp`, sous la clé de service, lit le texte et publie le socle par deux autres.
--
-- IDEMPOTENCE : la table et sa ligne ne sont créées que si elles manquent ; `create or replace` ; la contrainte est reposée.

-- =============================================================================================
-- 1. La ligne des consignes
-- =============================================================================================

create table if not exists public.connector_instructions (
	id                boolean primary key default true check (id),
	body              text not null default '' check (pg_catalog.char_length(body) <= 4000),
	updated_at        timestamptz,
	updated_by        uuid references public.profiles (id) on delete set null,
	base              text,
	base_published_at timestamptz
);
comment on table public.connector_instructions is
	'CRM-165 — docs/SPEC-mcp.md §18.2. Une ligne : le texte de plateforme (body), ajouté au socle des consignes du connecteur, '
	'et le socle publié par le service mcp (base). Aucun accès direct : les fonctions du §18.3.';
alter table public.connector_instructions enable row level security;
revoke all on table public.connector_instructions from public, anon, authenticated;
insert into public.connector_instructions (id) values (true) on conflict (id) do nothing;

-- =============================================================================================
-- 2. Le geste du journal de la plateforme
-- =============================================================================================

alter table public.plateforme_journal drop constraint if exists plateforme_journal_geste_check;
alter table public.plateforme_journal add constraint plateforme_journal_geste_check CHECK ((geste = ANY (ARRAY[
	'superadmin_amorce'::text, 'superadmin_accorde'::text, 'superadmin_retire'::text, 'espace_cree'::text,
	'espace_modifie'::text, 'espace_supprime'::text, 'membre_pose'::text, 'membre_retire'::text, 'attente_inscrite'::text,
	'attente_retiree'::text, 'mcp_droits_poses'::text, 'logs_purged'::text, 'card_addresses_regenerated'::text,
	'track_moved'::text, 'connector_instructions_set'::text])));

-- =============================================================================================
-- 3. Le super-administrateur lit et écrit
-- =============================================================================================

create or replace function public.platform_connector_instructions()
returns table (body text, updated_at timestamptz, updated_by_name text, base text, base_published_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	return query
	select c.body, c.updated_at, p.full_name, c.base, c.base_published_at
	  from public.connector_instructions c
	  left join public.profiles p on p.id = c.updated_by
	 where c.id;
end;
$$;
comment on function public.platform_connector_instructions() is
	'CRM-165 — docs/SPEC-mcp.md §18.3. Les consignes de la plateforme, leur auteur, et le socle publié. Super-administrateur seul.';
revoke all on function public.platform_connector_instructions() from public, anon;
grant execute on function public.platform_connector_instructions() to authenticated;

create or replace function public.platform_set_connector_instructions(p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_texte  text;
	v_avant  text;
begin
	perform app.exiger_superadmin();
	if p_body is null then
		raise exception 'connector_instructions_invalid' using errcode = '22023';
	end if;
	-- Les fins de ligne `CRLF` deviennent `LF` ; les blancs et fins de ligne des bords sont retirés.
	v_texte := pg_catalog.regexp_replace(pg_catalog.replace(p_body, E'\r\n', E'\n'), E'^\\s+|\\s+$', '', 'g');
	if pg_catalog.char_length(v_texte) > 4000 then
		raise exception 'connector_instructions_too_long' using errcode = '22023';
	end if;
	select c.body into v_avant from public.connector_instructions c where c.id for update;
	if v_avant = v_texte then
		return;
	end if;
	update public.connector_instructions c
	   set body = v_texte, updated_at = now(), updated_by = auth.uid()
	 where c.id;
	-- Le journal dit le geste et les longueurs, jamais le texte.
	insert into public.plateforme_journal (acteur, geste, workspace_id, cible)
	values (auth.uid(), 'connector_instructions_set', null,
	        pg_catalog.jsonb_build_object('length_before', pg_catalog.char_length(v_avant), 'length_after',
	                                      pg_catalog.char_length(v_texte)));
end;
$$;
comment on function public.platform_set_connector_instructions(text) is
	'CRM-165 — docs/SPEC-mcp.md §18.3. Écrit les consignes de la plateforme (normalisées, 4 000 caractères au plus) et le '
	'journalise sans le texte. Super-administrateur seul.';
revoke all on function public.platform_set_connector_instructions(text) from public, anon;
grant execute on function public.platform_set_connector_instructions(text) to authenticated;

-- =============================================================================================
-- 4. Le service `mcp` lit le texte et publie le socle
-- =============================================================================================

create or replace function public.connector_instructions_text()
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select c.body from public.connector_instructions c where c.id;
$$;
comment on function public.connector_instructions_text() is
	'CRM-165 — docs/SPEC-mcp.md §18.4. Le texte de plateforme, lu par le service mcp à chaque initialisation. service_role seul.';
revoke all on function public.connector_instructions_text() from public, anon, authenticated;
grant execute on function public.connector_instructions_text() to service_role;

create or replace function public.connector_instructions_publish_base(p_base text)
returns void
language sql
security definer
set search_path = ''
as $$
	update public.connector_instructions c
	   set base = p_base, base_published_at = now()
	 where c.id;
$$;
comment on function public.connector_instructions_publish_base(text) is
	'CRM-165 — docs/SPEC-mcp.md §18.4. Le service mcp publie le socle de ses consignes. service_role seul.';
revoke all on function public.connector_instructions_publish_base(text) from public, anon, authenticated;
grant execute on function public.connector_instructions_publish_base(text) to service_role;
