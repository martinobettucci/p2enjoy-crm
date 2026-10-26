-- @spec CRM-058 (docs/BACKLOG.md) — tranche 2 : les politiques de stockage des pièces à envoyer
-- @spec docs/SPEC-mail-subsystem.md §19 bis.2 point 5, §19 bis.3 ; docs/SPEC-permissions-rls.md §5 (Storage) ;
--       docs/SCHEMA.md « Migration `0107` » ; docs/JOURNAL.md décisions 719 et 720
-- @migration-role: supabase_admin
--
-- POURQUOI CE FICHIER EST À PART, ET SOUS UN AUTRE RÔLE : le patron exact de la migration 29. `storage.objects`
-- appartient à `supabase_storage_admin`, dont `postgres` n'est pas membre ; seul `supabase_admin` y crée une politique.
-- Rien d'autre n'est créé ici : les prédicats `app.piece_envoi_deposable` et `app.piece_envoi_retirable` sont nés sous
-- `postgres` dans la migration 106, et ces politiques se contentent de les appeler.
--
-- CE QUE LA MESURE REND DANGEREUX (migration 29) : `authenticated` détient tous les privilèges de table sur
-- `storage.objects`, et seule l'ABSENCE de politique le refuse. Chaque politique ci-dessous porte donc elle-même la
-- restriction au bucket.

do $$
begin
	if current_user <> 'supabase_admin' then
		raise exception 'migration_role_inattendu: % (supabase_admin requis)', current_user;
	end if;
end;
$$;

-- DÉPOSER, DANS SON PROPRE DOSSIER D'UN ESPACE DONT ON EST MEMBRE.
drop policy if exists mail_outbound_attachments_depot on storage.objects;
create policy mail_outbound_attachments_depot
	on storage.objects
	for insert
	to authenticated
	with check (
		bucket_id = 'mail-outbound-attachments'
		and app.piece_envoi_deposable(name)
	);

-- RELIRE SES PROPRES DÉPÔTS — et eux seuls. L'API de stockage relit l'objet avant de le retirer : sans cette lecture,
-- le retrait d'un fichier joint par erreur serait impossible.
drop policy if exists mail_outbound_attachments_lecture on storage.objects;
create policy mail_outbound_attachments_lecture
	on storage.objects
	for select
	to authenticated
	using (
		bucket_id = 'mail-outbound-attachments'
		and owner = (select auth.uid())
		and app.piece_envoi_deposable(name)
	);

-- RETIRER SON DÉPÔT TANT QU'IL N'EST PAS EN FILE.
drop policy if exists mail_outbound_attachments_retrait on storage.objects;
create policy mail_outbound_attachments_retrait
	on storage.objects
	for delete
	to authenticated
	using (
		bucket_id = 'mail-outbound-attachments'
		and owner = (select auth.uid())
		and app.piece_envoi_retirable(name)
	);

comment on policy mail_outbound_attachments_depot on storage.objects is
	'CRM-058 tranche 2 §19 bis.2 point 5 — déposer une pièce à envoyer dans `<espace>/<soi>/<uuid>/<nom>`, espace dont on '
	'est membre. Aucune mise à jour : un fichier se retire et se redépose.';
comment on policy mail_outbound_attachments_lecture on storage.objects is
	'CRM-058 tranche 2 §19 bis.3 — relire ses propres dépôts, et eux seuls.';
comment on policy mail_outbound_attachments_retrait on storage.objects is
	'CRM-058 tranche 2 §19 bis.3 — retirer son dépôt tant qu''aucune ligne de la file ne le cite.';
