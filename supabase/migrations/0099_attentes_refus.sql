-- @spec CRM-109 (docs/BACKLOG.md) — tranche T3 : la plateforme lit, avec chaque attente, la trace de son dernier refus
-- @spec docs/SPEC-refus-admission.md §3 (lecture par le superadministrateur, par la fonction de la plateforme qui rend
--       déjà les attentes), §5 (ce qu'on en voit) ; docs/SPEC-plateforme.md §6.4 ; docs/SCHEMA.md §9 bis.8 sexies ;
--       docs/JOURNAL.md décisions 640 et 644 ; docs/PROD_MIGRATIONS.md §3 (migration 99)
--
-- `plateforme_attentes` gagne quatre colonnes : le motif, le premier et le dernier refus, et leur nombre — `NULL` pour
-- une attente sans trace, ou dont la trace a plus de 90 jours (la même borne que la politique de lecture de
-- `admission_refus`). Le type de retour change : la fonction est retirée puis recréée, avec la même garde
-- (`app.exiger_superadmin`), le même `search_path` vide et les mêmes privilèges qu'à la migration 89 — `execute` à
-- `authenticated` et `service_role`, révoqué à `public` et `anon`. Ordinaire, rejouable.

drop function if exists public.plateforme_attentes(uuid);

create function public.plateforme_attentes(p_ws uuid)
returns table (
	email         text,
	role          text,
	invite_par    text,
	depuis        timestamptz,
	refus_motif   text,
	refus_premier timestamptz,
	refus_dernier timestamptz,
	refus_nombre  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_ws);
	return query
	select i.email, i.role, p.full_name, i.created_at, r.motif, r.premier_refus, r.dernier_refus, r.refus
	  from public.workspace_invitations i
	  left join public.profiles p on p.id = i.invited_by
	  left join public.admission_refus r
	    on r.workspace_id = i.workspace_id
	   and r.email = i.email
	   and r.dernier_refus > now() - interval '90 days'
	 where i.workspace_id = p_ws
	 order by i.email;
end;
$$;

alter function public.plateforme_attentes(uuid) owner to postgres;

comment on function public.plateforme_attentes(uuid) is
	'CRM-101 — docs/SPEC-plateforme.md §6.4 ; CRM-109 — docs/SPEC-refus-admission.md §3. Les attentes d''un espace, '
	'avec la trace de leur dernier refus d''admission (90 jours au plus). Réservée au superadministrateur.';

revoke all on function public.plateforme_attentes(uuid) from public, anon;
grant execute on function public.plateforme_attentes(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
