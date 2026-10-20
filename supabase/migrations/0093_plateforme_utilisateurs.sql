-- @spec CRM-101 (docs/BACKLOG.md) — tranche T6 : l'onglet « Utilisateurs » de la plateforme, sa lecture
-- @spec docs/SPEC-plateforme.md §6.5 (`plateforme_utilisateurs`), §7.2 (qui est un utilisateur) ; docs/SCHEMA.md §1 bis ;
--       docs/PROD_MIGRATIONS.md §2.13 ; docs/JOURNAL.md décision 627 (arbitrage A6)
--
-- CE QUE CETTE MIGRATION FAIT, ET RIEN D'AUTRE : une fonction de LECTURE, `public.plateforme_utilisateurs`. Elle suit
-- exactement la forme des fonctions de `0089` : `SECURITY DEFINER`, `search_path` vide, gardée EN PREMIER par
-- `app.exiger_superadmin()` — un superadministrateur en base n'est membre d'aucun espace, et la RLS des profils et des
-- appartenances lui refuserait ce qu'elle doit lire —, exécutable par `authenticated` seul, révoquée nommément à
-- `public` et `anon`. Elle lit `mcp_comptes` (`0090`) pour la dernière activité au connecteur.
--
-- Un utilisateur est un PROFIL (arbitrage A6) : un compte venu seulement au connecteur n'en a pas, et paraît dans
-- l'onglet du connecteur (`CRM-103`). La recherche est celle de `plateforme_profils` : par nom, sans accent,
-- métacaractères échappés. Bornée à 200 lignes, sans pagination : le volume se mesure avant de paginer (CLAUDE.md §21).
-- Une lecture n'est pas journalisée.
--
-- Ordinaire, idempotente. Aucune donnée n'est modifiée. Retrait : `drop function public.plateforme_utilisateurs(text,
-- integer)` (docs/PROD_MIGRATIONS.md §3.2).

create or replace function public.plateforme_utilisateurs(p_recherche text default null, p_limite integer default 200)
returns table (
	id                          uuid,
	nom                         text,
	cree_le                     timestamptz,
	superadmin                  boolean,
	espaces                     jsonb,
	connecteur_derniere_activite timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	motif  text := pg_catalog.btrim(coalesce(p_recherche, ''));
	limite integer := least(greatest(coalesce(p_limite, 200), 1), 200);
begin
	perform app.exiger_superadmin();
	return query
	select p.id, p.full_name, p.created_at,
	       exists (select 1 from public.superadmins s where s.sub = p.id),
	       -- Les appartenances, dans l'ordre des noms d'espace : chaque entrée mène à la fiche de l'espace (§5.56).
	       coalesce((
	         select pg_catalog.jsonb_agg(
	                  pg_catalog.jsonb_build_object('slug', w.slug, 'nom', w.name, 'role', m.role)
	                  order by w.name, w.slug)
	           from public.workspace_members m
	           join public.workspaces w on w.id = m.workspace_id
	          where m.user_id = p.id
	       ), '[]'::jsonb),
	       (select c.derniere_activite from public.mcp_comptes c where c.sub = p.id)
	  from public.profiles p
	 -- `unaccent` à deux arguments, dictionnaire qualifié, comme `plateforme_profils` : sous `search_path` vide, la forme
	 -- à un argument ne trouve pas son dictionnaire. Les métacaractères de `ilike` saisis sont échappés.
	 where motif = ''
	    or extensions.unaccent('extensions.unaccent'::regdictionary, p.full_name) ilike
	       '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(
	                 extensions.unaccent('extensions.unaccent'::regdictionary, motif),
	                 '\', '\\'), '%', '\%'), '_', '\_') || '%'
	 order by p.full_name, p.id
	 limit limite;
end;
$$;

alter function public.plateforme_utilisateurs(text, integer) owner to postgres;
revoke all on function public.plateforme_utilisateurs(text, integer) from public, anon, authenticated;
grant execute on function public.plateforme_utilisateurs(text, integer) to authenticated;
