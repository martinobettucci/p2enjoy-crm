-- @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : la lecture du manuel, réservée aux membres connectés
-- @spec docs/SPEC-manual.md §14.1 (une seule politique, de lecture) ; docs/SPEC-permissions-rls.md §5 (Storage) ;
--       docs/SCHEMA.md §9 septies ; docs/DAT.md §3.7 quater ; docs/JOURNAL.md décisions 736 et 751
-- @migration-role: supabase_admin
--
-- POURQUOI CE FICHIER EST À PART, ET SOUS UN AUTRE RÔLE : le patron exact des migrations 29 et 107. `storage.objects`
-- appartient à `supabase_storage_admin`, dont `postgres` n'est pas membre ; seul `supabase_admin` y crée une politique.
--
-- UNE SEULE POLITIQUE, DE LECTURE, POUR `authenticated`, BORNÉE AU BUCKET. `storage.objects` accorde tous les
-- privilèges de table à `anon` et `authenticated` (mesuré, migration 29) : seule l'absence de politique refuse. Aucune
-- politique d'écriture n'est donc posée — seule la clé de service, qui contourne la RLS, publie le manuel — et la
-- politique porte elle-même la restriction au bucket : sans elle, elle ouvrirait tout le stockage. Une session suffit :
-- ni l'espace, ni le rôle n'interviennent (docs/SPEC-manual.md §14.1).
--
-- AUCUN `begin` NI `commit` (INC-318).
--
-- Retour arrière : `drop policy manual_select on storage.objects;` sous `supabase_admin`.

do $$
begin
	if current_user <> 'supabase_admin' then
		raise exception 'migration_role_inattendu: % (supabase_admin requis)', current_user;
	end if;
end;
$$;

drop policy if exists manual_select on storage.objects;
create policy manual_select
	on storage.objects
	for select
	to authenticated
	using (bucket_id = 'manual');

comment on policy manual_select on storage.objects is
	'CRM-117 — lire le manuel : toute session, aucun espace ni rôle ; aucune écriture hors de la clé de service '
	'(docs/SPEC-manual.md §14.1).';
