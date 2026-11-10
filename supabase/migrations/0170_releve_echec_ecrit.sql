-- @spec CRM-135 (docs/BACKLOG.md) — la relève écrit son échec et son succès sur la boîte, jamais sur une ligne `disabled`
-- @spec docs/SPEC-mail-subsystem.md §24.3 (les deux fonctions, ce qu'elles écrivent et n'écrivent pas), §13.7 (le code,
--       jamais le texte du serveur), §23.2 (la datation de la relève, reprise) ; docs/SCHEMA.md « Migration `0170` » ;
--       docs/PROD_MIGRATIONS.md ; docs/JOURNAL.md décisions 873 et 874 ; INC-349
--
-- Deux fonctions, aucune table ni colonne nouvelle. `status` et `last_error` existent depuis la 0022 ; jusqu'ici, seul le
-- test de connexion les écrivait (`mail_inbound_account_record_check`), et une relève en échec ne laissait aucune trace
-- sur la ligne (INC-349).

-- =============================================================================================
-- 1. Une relève qui échoue sur la boîte l'écrit (§24.3)
-- =============================================================================================
--
-- `last_checked_at` N'EST PAS ÉCRITE : c'est la date du dernier TEST, sur laquelle se lit la garde de 30 s de
-- `authorize_mail_connection_test` (0151). Une relève qui l'écrirait, toutes les minutes, refuserait le bouton
-- « Tester la connexion » une fois sur deux. `last_sync_at` non plus : elle reste la date de la dernière relève RÉUSSIE.
--
-- Un code hors des six est refusé par la contrainte `mail_inbound_accounts_erreur_code` (0022), pas ici : une seule
-- règle, au même endroit pour les deux écritures.

create or replace function public.mail_inbound_account_record_poll_failure(p_account_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not exists (select 1 from public.mail_inbound_accounts a where a.id = p_account_id) then
		perform app.raise_http_error(404, 'account_not_found');
	end if;

	-- `disabled` est une décision d'exploitation (§13.2) : un constat de relève ne l'écrase pas.
	update public.mail_inbound_accounts a
	   set status     = 'error',
	       last_error = p_error
	 where a.id = p_account_id
	   and a.status <> 'disabled';
end;
$$;

comment on function public.mail_inbound_account_record_poll_failure(uuid, text) is
	'CRM-135 : écrit status = error et last_error (un des six codes) après une relève en échec sur la boîte. Ne touche '
	'ni last_checked_at ni last_sync_at, laisse une ligne disabled intacte. Réservée à service_role. '
	'docs/SPEC-mail-subsystem.md §24.3, INC-349.';

revoke all on function public.mail_inbound_account_record_poll_failure(uuid, text) from public, anon, authenticated;
grant execute on function public.mail_inbound_account_record_poll_failure(uuid, text) to service_role;

-- =============================================================================================
-- 2. Une relève allée au bout se date ET rend la boîte `ok` (§24.3, §23.2)
-- =============================================================================================
--
-- Reprise de la 0151 à l'identique, avec un seul ajout : `status = 'ok'` et `last_error = null`, sauf sur une ligne
-- `disabled`, que la relève date sans en changer l'état — une relève par `/poll` a pu avoir lieu, et sa date est un constat.

create or replace function public.mail_inbound_account_record_sync(p_account_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_maintenant timestamptz := now();
begin
	update public.mail_inbound_accounts a
	   set last_sync_at = v_maintenant,
	       status       = case when a.status = 'disabled' then a.status else 'ok' end,
	       last_error   = case when a.status = 'disabled' then a.last_error else null end
	 where a.id = p_account_id;

	if not found then
		perform app.raise_http_error(404, 'account_not_found');
	end if;

	return v_maintenant;
end;
$$;

comment on function public.mail_inbound_account_record_sync(uuid) is
	'CRM-127, CRM-135 : écrit last_sync_at après une relève allée au bout, et rend la boîte ok (last_error effacée), sauf '
	'une ligne disabled. Réservée à service_role — la date de relève est un constat du serveur. '
	'docs/SPEC-mail-subsystem.md §23.2, §24.3.';

revoke all on function public.mail_inbound_account_record_sync(uuid) from public, anon, authenticated;
grant execute on function public.mail_inbound_account_record_sync(uuid) to service_role;
