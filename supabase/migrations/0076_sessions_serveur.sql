-- @spec CRM-092 (docs/BACKLOG.md) — sessions du client confidentiel : le jeton LeLabs reste au serveur
-- @spec docs/SPEC-session-sso.md §5.3 (prolonger, fermer), §5.6 (poignée), §5.7 (chiffrement), §7.4
-- @spec docs/SCHEMA.md §1 ; docs/SPEC-permissions-rls.md §3.2 (convention des privilèges)
-- @spec docs/JOURNAL.md décision 586 (arbitrage du responsable : client serveur)
--
-- Depuis la décision 586, le CRM est un client CONFIDENTIEL de LeLabs : l'échangeur échange le code
-- avec son secret et garde le jeton de rafraîchissement LeLabs CÔTÉ SERVEUR. Cette migration en porte
-- le stockage :
--
--   1. `public.sessions_sso` — une ligne par session de navigateur. Le jeton de rafraîchissement y est
--      CHIFFRÉ par l'échangeur avant d'arriver ici (AES-GCM, §5.7) ; la poignée du navigateur n'y est
--      jamais : seule son empreinte SHA-256 est gardée ;
--   2. quatre fonctions `SECURITY DEFINER`, exécutables par la seule clé de service, qui sont le SEUL
--      chemin vers la table : ni `anon` ni `authenticated` ne la lisent, par privilège ET par RLS.
--
-- Aucune ligne existante n'est modifiée.

-- =============================================================================================
-- 1. `public.sessions_sso`
-- =============================================================================================

create table if not exists public.sessions_sso (
	id                uuid        primary key default gen_random_uuid(),
	sub               uuid        not null references public.profiles (id) on delete cascade,
	poignee_empreinte bytea       not null,
	rafraichissement  text        not null,
	expire_le         timestamptz not null,
	cree_le           timestamptz not null default now(),
	renouvele_le      timestamptz not null default now(),
	constraint sessions_sso_poignee_empreinte_key unique (poignee_empreinte),
	constraint sessions_sso_empreinte_check check (pg_catalog.octet_length(poignee_empreinte) = 32),
	constraint sessions_sso_rafraichissement_check check (pg_catalog.char_length(rafraichissement) > 0)
);

create index if not exists sessions_sso_sub_idx on public.sessions_sso (sub);
create index if not exists sessions_sso_expire_le_idx on public.sessions_sso (expire_le);

comment on table public.sessions_sso is
	'CRM-092 — docs/SPEC-session-sso.md §7.4. Sessions du client confidentiel ; lues par les seules fonctions de session.';
comment on column public.sessions_sso.poignee_empreinte is
	'SHA-256 de la poignée du cookie httpOnly ; la poignée elle-même n''est jamais gardée.';
comment on column public.sessions_sso.rafraichissement is
	'Jeton de rafraîchissement LeLabs CHIFFRÉ par l''échangeur (AES-GCM, clé dérivée de JWT_SECRET) ; jamais en clair.';
comment on column public.sessions_sso.expire_le is
	'Échéance d''inactivité rendue par LeLabs avec le jeton ; au-delà, la session n''est plus lue.';

-- Personne ne lit cette table par l'API : RLS activée SANS AUCUNE POLITIQUE, et aucun privilège pour
-- les rôles de l'API. La clé de service contourne la RLS, mais ne passe que par les fonctions
-- ci-dessous dans le produit.
alter table public.sessions_sso enable row level security;
revoke all on public.sessions_sso from public, anon, authenticated;
grant all privileges on public.sessions_sso to service_role;

-- =============================================================================================
-- 2. Les quatre fonctions de session
-- =============================================================================================

-- Ouvrir : l'admission de `ouvrir_session_sso` (§6.2), puis, si la personne est admise, la session.
create or replace function public.ouvrir_session_serveur(
	p_sub uuid, p_email text, p_nom text,
	p_empreinte bytea, p_rafraichissement text, p_expire_le timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	admission jsonb;
begin
	admission := public.ouvrir_session_sso(p_sub, p_email, p_nom);
	if (admission ->> 'admis')::boolean then
		insert into public.sessions_sso (sub, poignee_empreinte, rafraichissement, expire_le)
		values (p_sub, p_empreinte, p_rafraichissement, p_expire_le);
	end if;
	return admission;
end;
$$;

-- Lire : la session non échue d'une empreinte. Purge au passage les sessions échues depuis plus
-- d'un jour : une table de sessions ne grandit pas sans fin, et aucun job n'est ajouté pour cela.
create or replace function public.lire_session_serveur(p_empreinte bytea)
returns table (sub uuid, rafraichissement text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	delete from public.sessions_sso s where s.expire_le < pg_catalog.now() - interval '1 day';
	return query
		select s.sub, s.rafraichissement
		  from public.sessions_sso s
		 where s.poignee_empreinte = p_empreinte
		   and s.expire_le > pg_catalog.now();
end;
$$;

-- Renouveler : l'admission est rejouée EN ENTIER. Admise, la session reçoit le nouveau jeton et sa
-- nouvelle échéance ; sinon elle est supprimée — un `verified` retiré ou une appartenance retirée
-- ferment l'accès au prochain rafraîchissement.
create or replace function public.renouveler_session_serveur(
	p_empreinte bytea, p_sub uuid, p_email text, p_nom text,
	p_rafraichissement text, p_expire_le timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	admission jsonb;
begin
	if not exists (
		select 1 from public.sessions_sso s
		 where s.poignee_empreinte = p_empreinte and s.sub = p_sub
	) then
		return pg_catalog.jsonb_build_object('admis', false, 'session', false);
	end if;

	admission := public.ouvrir_session_sso(p_sub, p_email, p_nom);
	if (admission ->> 'admis')::boolean then
		update public.sessions_sso s
		   set rafraichissement = p_rafraichissement,
		       expire_le = p_expire_le,
		       renouvele_le = pg_catalog.now()
		 where s.poignee_empreinte = p_empreinte;
	else
		delete from public.sessions_sso s where s.poignee_empreinte = p_empreinte;
	end if;
	return admission || pg_catalog.jsonb_build_object('session', true);
end;
$$;

-- Fermer : supprime la session ; sans effet si elle n'existe pas.
create or replace function public.fermer_session_serveur(p_empreinte bytea)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
	delete from public.sessions_sso s where s.poignee_empreinte = p_empreinte;
$$;

alter function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz) owner to postgres;
alter function public.lire_session_serveur(bytea) owner to postgres;
alter function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz) owner to postgres;
alter function public.fermer_session_serveur(bytea) owner to postgres;

revoke all on function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz) from public, anon, authenticated;
revoke all on function public.lire_session_serveur(bytea) from public, anon, authenticated;
revoke all on function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.fermer_session_serveur(bytea) from public, anon, authenticated;

grant execute on function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz) to service_role;
grant execute on function public.lire_session_serveur(bytea) to service_role;
grant execute on function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.fermer_session_serveur(bytea) to service_role;

comment on function public.ouvrir_session_serveur(uuid, text, text, bytea, text, timestamptz) is
	'CRM-092 — docs/SPEC-session-sso.md §7.4. Admission, puis session serveur si la personne est admise.';
comment on function public.lire_session_serveur(bytea) is
	'CRM-092 — docs/SPEC-session-sso.md §7.4. Session non échue d''une empreinte ; purge les échues.';
comment on function public.renouveler_session_serveur(bytea, uuid, text, text, text, timestamptz) is
	'CRM-092 — docs/SPEC-session-sso.md §7.4. Admission rejouée ; admise, jeton remplacé ; sinon session supprimée.';
comment on function public.fermer_session_serveur(bytea) is
	'CRM-092 — docs/SPEC-session-sso.md §7.4. Supprime la session ; sans effet si elle n''existe pas.';
