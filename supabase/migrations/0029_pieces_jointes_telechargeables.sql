-- @spec CRM-057 (docs/BACKLOG.md) — la pièce jointe saine devient téléchargeable
-- @spec docs/SPEC-mail-subsystem.md §18.5 (l'intersection ouverte, et la mesure qui impose la
--       forme de cette migration), §4.3 (les statuts antivirus)
-- @spec docs/SPEC-permissions-rls.md §5 (Storage), §7.2 preuve de refus n° 9
-- @spec docs/SCHEMA.md §7 ; docs/JOURNAL.md décision 327
-- @migration-role: supabase_admin
--
-- POURQUOI CE FICHIER EXISTE SÉPARÉMENT, ET POURQUOI IL S'EXÉCUTE SOUS UN AUTRE RÔLE.
--
-- MESURÉ le 2026-08-11 sur la pile de développement : `storage.objects` appartient à
-- `supabase_storage_admin`, dont `postgres` n'est PAS membre. `postgres` ne peut donc pas y créer
-- de politique. Seul `supabase_admin`, superutilisateur, le peut — d'où l'en-tête ci-dessus, déjà
-- employé par `0018_pg_cron`.
--
-- ET C'EST PRÉCISÉMENT POURQUOI RIEN D'AUTRE N'EST CRÉÉ ICI : une fonction `SECURITY DEFINER`
-- créée sous un superutilisateur s'exécuterait avec ses droits. Le prédicat
-- `app.piece_jointe_telechargeable` est donc créé par la migration 28, sous `postgres`, et cette
-- migration se contente de l'appeler.
--
-- CE QUE LA MESURE REND DANGEREUX : `anon` et `authenticated` détiennent DÉJÀ tous les privilèges
-- de table sur `storage.objects` — défaut de Supabase —, et seule l'ABSENCE de politique les
-- refuse. Une politique trop large n'ouvrirait donc pas les pièces jointes : elle ouvrirait TOUT
-- le stockage. La restriction au bucket est portée par la politique elle-même, jamais supposée.

do $$
begin
	if current_user <> 'supabase_admin' then
		raise exception 'migration_role_inattendu: % (supabase_admin requis)', current_user;
	end if;
end;
$$;

-- =============================================================================================
-- La lecture d'une pièce jointe saine — et rien d'autre
-- =============================================================================================
--
-- TROIS CONDITIONS, TOUTES NÉCESSAIRES :
--   1. le bucket `mail-attachments`, et lui seul ;
--   2. la pièce en statut `clean` — `pending`, `skipped` et `infected` restent refusés à tous ;
--   3. le droit de voir le MESSAGE porteur, qui suit sa card ou sa boîte (§18.1).
--
-- AUCUNE ÉCRITURE N'EST OUVERTE : le dépôt reste le fait de `service_role`, qui contourne la RLS.
-- Ajouter ici une politique `INSERT` laisserait un client déposer un objet dans un bucket dont il
-- ne peut lire que les pièces analysées — une porte d'entrée sans analyse.

drop policy if exists mail_attachments_objets_lecture on storage.objects;
create policy mail_attachments_objets_lecture
	on storage.objects
	for select
	to authenticated
	using (
		bucket_id = 'mail-attachments'
		and app.piece_jointe_telechargeable(name)
	);

comment on policy mail_attachments_objets_lecture on storage.objects is
	'CRM-057 §18.5 — seule politique de ce bucket : intersection du bucket, du statut `clean` et '
	'de la visibilité du message. La preuve de refus n° 9 est RÉVISÉE, non retirée : `infected`, '
	'`pending` et `skipped` restent refusés à tous, et l''anonyme reste refusé sur les trois.';
