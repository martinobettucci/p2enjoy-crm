-- @spec CRM-161 (docs/BACKLOG.md) — tranche T2.a : les slugs réservés — un espace ne prend pas pour slug un premier segment
--       d'une route globale de la webapp
-- @spec docs/SPEC-espace-courant.md §15.1 ; docs/SCHEMA.md « Migration `0196` » ; docs/JOURNAL.md décision 967
--
-- POURQUOI : l'espace est désormais EN TÊTE DU CHEMIN des pages d'un espace (`/:slugEspace/inbox`, …). Un espace dont le slug
-- serait `contacts` rendrait `/contacts/inbox` ambigu entre la fiche d'un contact et l'inbox de cet espace. La liste est celle
-- des premiers segments des routes globales, plus les anciens premiers segments (`inbox`, `tracks`, `reglages`), qui servent
-- la redirection des anciennes adresses.
--
-- CONSTATÉ AVANT LA MIGRATION : en développement, un espace (`p2enjoy`) ; en production, un espace (`crm`, lu par la session
-- de livraison le 2026-11-21, en lecture seule). Aucun n'est réservé : la contrainte s'ajoute sans `not valid`.
--
-- LE REFUS DIT EN CLAIR : `plateforme_creer_espace` (`0089`) est redéfinie pour lever `identifiant_reserve` (23514) quand la
-- contrainte refuse, au lieu du message brut de PostgreSQL, que l'écran ne nomme pas (dictionnaire fermé, §5.56). Le reste
-- de son corps est celui de `0089`, à l'identique.
--
-- IDEMPOTENCE : `drop constraint if exists` puis `add constraint` ; `create or replace`.
-- RETOUR ARRIÈRE : `alter table public.workspaces drop constraint workspaces_slug_not_reserved;`, puis rejouer
-- `plateforme_creer_espace` de `0089`.

alter table public.workspaces drop constraint if exists workspaces_slug_not_reserved;
alter table public.workspaces add constraint workspaces_slug_not_reserved check (slug <> all (array[
	'aide', 'plateforme', 'contacts', 'objectifs', 'couts', 'pilotage', 'temps', 'rentabilite', 'ma-journee',
	'affaires-figees', 'demarrage', 'connexion', 'auth', 'inbox', 'tracks', 'reglages'
]::text[]));

comment on constraint workspaces_slug_not_reserved on public.workspaces is
	'CRM-161 §15.1 — un slug d''espace n''est jamais un premier segment d''une route globale de la webapp : l''espace est en '
	'tête du chemin des pages d''un espace.';

create or replace function public.plateforme_creer_espace(p_nom text, p_slug text, p_domaine_entrant text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
	nom        text;
	slug       text := pg_catalog.btrim(coalesce(p_slug, ''));
	domaine    text;
	cree       uuid;
	contrainte text;
begin
	perform app.exiger_superadmin();
	nom := app.plateforme_nom(p_nom);
	if pg_catalog.char_length(slug) not between 2 and 63 or slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
		raise exception 'identifiant_invalide' using errcode = '22023';
	end if;
	domaine := app.plateforme_domaine(p_domaine_entrant);

	begin
		insert into public.workspaces (name, slug, inbound_domain, settings)
		values (nom, slug, domaine, '{}'::jsonb)
		returning id into cree;
	exception
		when unique_violation then
			raise exception 'identifiant_pris' using errcode = '23505';
		when check_violation then
			-- `CRM-161` (§15.1) : le slug d'une route globale, nommé ; toute autre contrainte garde son refus d'origine.
			get stacked diagnostics contrainte = constraint_name;
			if contrainte = 'workspaces_slug_not_reserved' then
				raise exception 'identifiant_reserve' using errcode = '23514';
			end if;
			raise;
	end;

	perform app.journaliser_plateforme('espace_cree', cree,
		pg_catalog.jsonb_build_object('nom', nom, 'slug', slug, 'domaine_entrant', domaine));
	return cree;
end;
$function$;
