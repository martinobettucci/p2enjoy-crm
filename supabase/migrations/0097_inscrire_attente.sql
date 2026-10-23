-- @spec CRM-070 (docs/BACKLOG.md) — tranche T3 : inscrire une attente, ou remplacer celle de la même adresse, en une
--       seule transaction, sous les politiques existantes
-- @spec docs/SPEC-membres.md §3.2 (inscrire, remplacer, retirer ; en attente, en suspens), §5 point 3 (une fonction si
--       les deux écritures ne peuvent pas être atomiques depuis l'écran — mesuré en T1 : elles ne le peuvent pas) ;
--       docs/SCHEMA.md §9 bis.8 quinquies ; docs/JOURNAL.md décision 635 ; docs/PROD_MIGRATIONS.md §3 (migration 97)
--
-- POURQUOI UNE FONCTION. `workspace_invitations` n'a pas de politique UPDATE et sa clé est `(workspace_id, email)` :
-- changer le rôle d'une attente demande de la retirer puis de la réinscrire. Depuis l'écran, ce seraient deux requêtes,
-- et un échec entre les deux PERDRAIT l'attente. La fonction les tient dans une transaction.
--
-- SECURITY INVOKER, ET C'EST TOUTE LA SÉCURITÉ. La fonction n'élève aucun droit : la suppression et l'insertion passent
-- par les politiques `workspace_invitations_suppression_admin` et `workspace_invitations_insertion_admin`, exactement
-- comme deux requêtes REST. La garde `app.is_workspace_admin(p_ws)` en tête ne décide rien de plus que ces politiques ;
-- elle rend un refus NOMMÉ (`42501`, `reserve_aux_administrateurs`) au lieu de l'erreur d'une politique, et évite qu'un
-- non-administrateur ne voie sa suppression filtrée en silence. `invited_by` reste posé par sa valeur par défaut,
-- `auth.uid()`, que la politique d'insertion exige.
--
-- L'adresse est normalisée comme la contrainte l'exige (minuscules, sans espaces autour) ; une adresse ou un rôle que
-- les contraintes refusent devient `adresse_invalide` ou `role_invalide` (`22023`). La fonction rend le rôle remplacé,
-- `null` pour une inscription neuve. Ordinaire, idempotente.

create or replace function public.inscrire_attente(p_ws uuid, p_email text, p_role text)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
	adresse    text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_email, '')));
	role_avant text;
begin
	if not app.is_workspace_admin(p_ws) then
		raise exception 'reserve_aux_administrateurs' using errcode = '42501';
	end if;
	if p_role is null or p_role not in ('admin', 'business_developer', 'viewer') then
		raise exception 'role_invalide' using errcode = '22023';
	end if;

	delete from public.workspace_invitations i
	 where i.workspace_id = p_ws and i.email = adresse
	returning i.role into role_avant;

	begin
		insert into public.workspace_invitations (workspace_id, email, role)
		values (p_ws, adresse, p_role);
	exception when check_violation or not_null_violation then
		raise exception 'adresse_invalide' using errcode = '22023';
	end;

	return role_avant;
end;
$$;

comment on function public.inscrire_attente(uuid, text, text) is
	'CRM-070 — docs/SPEC-membres.md §3.2, §5 point 3. Inscrit une attente, ou remplace celle de la même adresse, en une '
	'transaction. SECURITY INVOKER : les politiques de workspace_invitations décident ; refus nommé 42501 pour qui '
	'n''administre pas l''espace, 22023 pour une adresse ou un rôle invalide. Rend le rôle remplacé, ou null.';

revoke all on function public.inscrire_attente(uuid, text, text) from public, anon;
grant execute on function public.inscrire_attente(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
