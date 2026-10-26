-- @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : le bucket du manuel
-- @spec docs/SPEC-manual.md §14.1 (le bucket `manual`), §15 (la publication) ; docs/SCHEMA.md §9 septies ;
--       docs/DAT.md §3.7 quater ; docs/PROD_MIGRATIONS.md ; docs/JOURNAL.md décisions 736, 750 et 751 ;
--       docs/DAT.md §12 bis (le nom, en anglais)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION AJOUTE, SOUS `postgres` : le bucket privé `manual`, et rien d'autre.
-- ---------------------------------------------------------------------------------------------
--
-- Le manuel utilisateur n'est lu que par les membres connectés (décision 736). Il n'est donc ni dans le paquet de la
-- webapp, ni servi en fichier statique : il vit dans ce bucket, que la publication (`scripts/manuel/publier.sh`) tient
-- en miroir de `docs/manuel/construit/` et de `docs/manuel/images/`, avec la clé de service.
--
-- PRIVÉ : sans politique, le stockage refuse tout. La politique de lecture vit dans la migration 127, sous
-- `supabase_admin` — `storage.objects` appartient à `supabase_storage_admin`, dont `postgres` n'est pas membre
-- (mesuré, migration 29 ; patron des migrations 106 et 107).
--
-- AUCUN `begin` NI `commit` : le runner applique le fichier et son inscription au registre dans une seule transaction
-- (INC-318).
--
-- Retour arrière : vider le bucket par l'API de stockage, puis `delete from storage.buckets where id = 'manual';`.
-- Rejouable : `on conflict`.

insert into storage.buckets (id, name, public)
values ('manual', 'manual', false)
on conflict (id) do update set public = false;
