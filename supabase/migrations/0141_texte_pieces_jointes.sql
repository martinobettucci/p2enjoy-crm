-- @spec CRM-074 (docs/BACKLOG.md) — tranche T1 : le texte extrait des pièces jointes, en base — colonnes sur
--       `mail_attachments`, éligibilité, déclencheur, reprise de l'existant, prise et résultat réservés à la clé de service
-- @spec docs/SPEC-pieces-jointes.md §3 (en base), §4.3 (trois essais), §7 (sécurité) ; docs/SCHEMA.md « Migration
--       `0141` » ; docs/PROD_MIGRATIONS.md §3 ; docs/JOURNAL.md décisions 788 et 789
--
-- LE TEXTE VIT SUR LA LIGNE DE LA PIÈCE, SOUS SA RLS (§3) : aucune table, aucune politique nouvelle. Qui lit la pièce lit son
-- texte ; `authenticated` reste sans écriture. Seule une pièce `clean` et d'un type retenu passe `pending` ; la boucle de
-- `mail-sync` (T2) la prend par `claim_attachment_texts` et rend le résultat par `record_attachment_text`.
--
-- IDEMPOTENCE : `add column if not exists`, contraintes retirées puis reposées, `create or replace`, déclencheur retiré
-- puis recréé ; la reprise de l'existant ne touche que les pièces encore sans statut.

-- =============================================================================================
-- 1. Les colonnes — §3
-- =============================================================================================

alter table public.mail_attachments
	add column if not exists text_status     text,
	add column if not exists extracted_text  text,
	add column if not exists text_truncated  boolean not null default false,
	add column if not exists text_attempts   smallint not null default 0,
	add column if not exists text_claimed_at timestamptz;

alter table public.mail_attachments drop constraint if exists mail_attachments_text_status_check;
alter table public.mail_attachments add constraint mail_attachments_text_status_check
	check (text_status in ('pending', 'extracted', 'empty', 'unsupported', 'failed'));
-- Le texte existe si et seulement si l'extraction l'a rendu.
alter table public.mail_attachments drop constraint if exists mail_attachments_text_present;
alter table public.mail_attachments add constraint mail_attachments_text_present
	check (case when text_status = 'extracted' then extracted_text is not null else extracted_text is null end);
alter table public.mail_attachments drop constraint if exists mail_attachments_text_bound;
alter table public.mail_attachments add constraint mail_attachments_text_bound
	check (extracted_text is null or char_length(extracted_text) <= 200000);
alter table public.mail_attachments drop constraint if exists mail_attachments_text_truncated_extracted;
alter table public.mail_attachments add constraint mail_attachments_text_truncated_extracted
	check (not text_truncated or text_status = 'extracted');
-- Une pièce non saine n'a jamais de texte : ni extrait, ni à extraire.
alter table public.mail_attachments drop constraint if exists mail_attachments_text_clean_only;
alter table public.mail_attachments add constraint mail_attachments_text_clean_only
	check (text_status is null or av_status = 'clean');

comment on column public.mail_attachments.text_status is
	'CRM-074 — null : pièce non concernée (type non retenu ou pièce non saine) ; pending : à extraire ; extracted ; empty '
	'(aucun texte lisible) ; unsupported (le contenu n''est pas ce que le type annonce) ; failed (docs/SPEC-pieces-jointes.md §3).';
comment on column public.mail_attachments.extracted_text is
	'CRM-074 — le texte extrait, seulement en extracted ; 200 000 caractères au plus. Lu sous la RLS de la pièce.';

create index if not exists mail_attachments_texte_a_extraire_idx
	on public.mail_attachments (created_at) where text_status = 'pending';

-- =============================================================================================
-- 2. L'éligibilité — §3
-- =============================================================================================

-- Le PDF, Word et Excel (Office Open XML), OpenDocument texte et classeur ; pour un type générique, l'extension du nom.
-- L'extracteur vérifie le contenu de toute façon (§4.2) : un faux `.docx` rend `unsupported`.
create or replace function app.attachment_text_eligible(p_mime_type text, p_filename text)
returns boolean
language sql
immutable
set search_path = ''
as $$
	select pg_catalog.btrim(pg_catalog.split_part(pg_catalog.lower(coalesce(p_mime_type, '')), ';', 1)) in (
	           'application/pdf',
	           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
	           'application/vnd.oasis.opendocument.text',
	           'application/vnd.oasis.opendocument.spreadsheet')
	    or (pg_catalog.btrim(pg_catalog.split_part(pg_catalog.lower(coalesce(p_mime_type, '')), ';', 1)) in (
	           'application/zip', 'application/x-zip-compressed', 'application/octet-stream')
	        and pg_catalog.lower(coalesce(p_filename, '')) operator(pg_catalog.~) '\.(pdf|docx|xlsx|odt|ods)$')
$$;

-- =============================================================================================
-- 3. Le déclencheur — une pièce qui devient saine et éligible passe `pending`
-- =============================================================================================

create or replace function app.mail_attachments_text_pending()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	if new.av_status = 'clean' then
		if new.text_status is null and app.attachment_text_eligible(new.mime_type, new.filename) then
			new.text_status := 'pending';
		end if;
	else
		-- Une pièce qui cesse d'être saine perd tout texte : la contrainte `mail_attachments_text_clean_only` l'exige.
		new.text_status := null;
		new.extracted_text := null;
		new.text_truncated := false;
		new.text_claimed_at := null;
	end if;
	return new;
end;
$$;

drop trigger if exists mail_attachments_text_pending on public.mail_attachments;
create trigger mail_attachments_text_pending
	before insert or update of av_status on public.mail_attachments
	for each row execute function app.mail_attachments_text_pending();

-- =============================================================================================
-- 4. La reprise de l'existant — §3, décision 789 (point 3)
-- =============================================================================================

update public.mail_attachments a
   set text_status = 'pending'
 where a.text_status is null
   and a.av_status = 'clean'
   and app.attachment_text_eligible(a.mime_type, a.filename);

-- =============================================================================================
-- 5. La prise et le résultat — §3, §4.3 — à la clé de service seule
-- =============================================================================================

-- Prend au plus `p_limit` pièces à extraire (50 au plus), compte l'essai et pose un bail de 15 minutes : une pièce prise par
-- une boucle interrompue redevient prenable après le bail. Une pièce dont le troisième essai n'a jamais rendu de résultat
-- passe d'abord `failed`, sans être reprise.
create or replace function public.claim_attachment_texts(p_limit integer default 10)
returns table (attachment_id uuid, storage_path text, mime_type text, filename text, attempt integer)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
	update public.mail_attachments a
	   set text_status = 'failed', text_claimed_at = null
	 where a.text_status = 'pending' and a.text_attempts >= 3 and a.text_claimed_at < now() - interval '15 minutes';

	return query
	with dues as (
		select a.id
		  from public.mail_attachments a
		 where a.text_status = 'pending'
		   and (a.text_claimed_at is null or a.text_claimed_at < now() - interval '15 minutes')
		 order by a.created_at, a.id
		 limit greatest(1, least(coalesce(p_limit, 10), 50))
		   for update skip locked
	), prises as (
		update public.mail_attachments a
		   set text_attempts = a.text_attempts + 1, text_claimed_at = now()
		  from dues
		 where a.id = dues.id
		returning a.id, a.storage_path, a.mime_type, a.filename, a.text_attempts
	)
	select p.id, p.storage_path, p.mime_type, p.filename, p.text_attempts::integer from prises p;
end;
$$;

-- Inscrit le résultat d'une extraction prise. `p_status` : `extracted` (avec le texte), `empty`, `unsupported`, `failed`
-- (définitif : bornes dépassées, §4.3) ou `retry` (erreur passagère : la pièce redevient `pending` après le bail, et le
-- troisième essai la clôt en `failed`). Un texte vide vaut `empty` ; un texte trop long est coupé et marqué. Rend l'état.
create or replace function public.record_attachment_text(
	p_attachment uuid,
	p_status     text,
	p_text       text default null,
	p_truncated  boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	a       public.mail_attachments;
	v_etat  text;
	v_texte text;
begin
	if p_status is null or p_status not in ('extracted', 'empty', 'unsupported', 'failed', 'retry') then
		raise exception 'invalid_text_status' using errcode = '22023';
	end if;
	select * into a from public.mail_attachments x where x.id = p_attachment and x.text_status = 'pending' for update;
	if not found then
		raise exception 'attachment_not_found' using errcode = 'P0002';
	end if;
	v_texte := nullif(pg_catalog.btrim(coalesce(p_text, '')), '');
	v_etat := case
		when p_status = 'extracted' and v_texte is null then 'empty'
		when p_status = 'retry' then case when a.text_attempts >= 3 then 'failed' else 'pending' end
		else p_status
	end;
	update public.mail_attachments x
	   set text_status = v_etat,
	       extracted_text = case when v_etat = 'extracted' then pg_catalog.left(v_texte, 200000) end,
	       text_truncated = (v_etat = 'extracted' and (coalesce(p_truncated, false) or pg_catalog.char_length(v_texte) > 200000)),
	       -- Une pièce rendue à `pending` garde son bail : l'essai suivant attend 15 minutes.
	       text_claimed_at = case when v_etat = 'pending' then now() end
	 where x.id = p_attachment;
	return v_etat;
end;
$$;

-- =============================================================================================
-- 6. Privilèges — §7
-- =============================================================================================

revoke all on function app.mail_attachments_text_pending() from public, anon, authenticated;
revoke all on function app.attachment_text_eligible(text, text) from public, anon;
grant execute on function app.attachment_text_eligible(text, text) to authenticated, service_role;
revoke all on function public.claim_attachment_texts(integer) from public, anon, authenticated;
grant execute on function public.claim_attachment_texts(integer) to service_role;
revoke all on function public.record_attachment_text(uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_attachment_text(uuid, text, text, boolean) to service_role;
