-- @spec CRM-120 (docs/BACKLOG.md) — un refus « introuvable » passe par `app.raise_http_error` (docs/SPEC-refus-404.md §2)
-- @spec CRM-127 (docs/BACKLOG.md) — tranche T2 : la relève écrit `last_sync_at`, et le droit de tester une connexion
-- @spec docs/SPEC-mail-subsystem.md §23.2 (la relève réussie écrit `last_sync_at`, par une fonction réservée à
--       `service_role`), §23.3 (le droit de tester est celui d'écrire la ligne, `not_found` sans divulgation, `disabled`,
--       garde de 30 s) ; docs/SCHEMA.md « Migration `0151` » ; docs/PROD_MIGRATIONS.md ; docs/JOURNAL.md décision 816 ;
--       INC-340
--
-- Deux fonctions, aucune table ni colonne nouvelle. `last_sync_at` existe depuis la 0022 et n'était écrite par personne
-- (INC-340) ; `last_checked_at` existe sur les deux tables et reste écrite par les seuls `record_check` du service.

-- =============================================================================================
-- 1. La relève réussie écrit `last_sync_at` (§23.2)
-- =============================================================================================
--
-- Même forme que `mail_inbound_account_record_check` (0022) : l'horloge est celle de la base, la valeur posée est rendue,
-- un compte inconnu est refusé plutôt que passé sous silence — par `app.raise_http_error(404, …)`, jamais par l'`errcode`
-- `P0002` que `CRM-120` a banni (docs/SPEC-refus-404.md §2, migration 0143).

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
	   set last_sync_at = v_maintenant
	 where a.id = p_account_id;

	if not found then
		perform app.raise_http_error(404, 'account_not_found');
	end if;

	return v_maintenant;
end;
$$;

comment on function public.mail_inbound_account_record_sync(uuid) is
	'CRM-127 : écrit last_sync_at après une relève allée au bout. Réservée à service_role — la date de relève est un '
	'constat du serveur. docs/SPEC-mail-subsystem.md §23.2, INC-340.';

revoke all on function public.mail_inbound_account_record_sync(uuid) from public, anon, authenticated;
grant execute on function public.mail_inbound_account_record_sync(uuid) to service_role;

-- =============================================================================================
-- 2. Le droit de tester une connexion (§23.3)
-- =============================================================================================
--
-- LE DROIT EST CELUI D'ÉCRIRE LA LIGNE, relu sur la ligne elle-même : administrateur de son espace, ou son propriétaire.
-- C'est la règle d'`upsert_mail_inbound_account` (0022) et d'`upsert_mail_outbound_identity` (0058), et elle coïncide
-- avec la lecture (§13.4). Un refus de droit et une ligne absente rendent le MÊME `not_found` : la boîte d'un collègue
-- ne se devine pas (preuve de refus n° 7). Le refus passe par `app.raise_http_error(404, 'not_found')` (`CRM-120`) : PostgREST
-- rend 404, et le corps garde le code `P0002` et le message.
--
-- L'ordre des refus est délibéré : le droit d'abord, pour qu'un appelant sans droit n'apprenne ni l'état `disabled` ni
-- la date du dernier test d'une ligne qu'il ne voit pas.

create or replace function public.authorize_mail_connection_test(p_target text, p_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_appelant     uuid := (select auth.uid());
	v_workspace_id uuid;
	v_owner_id     uuid;
	v_status       text;
	v_dernier_test timestamptz;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	if p_target = 'inbound' then
		select a.workspace_id, a.owner_id, a.status, a.last_checked_at
		  into v_workspace_id, v_owner_id, v_status, v_dernier_test
		  from public.mail_inbound_accounts a
		 where a.id = p_id;
	elsif p_target = 'outbound' then
		select i.workspace_id, i.owner_id, i.status, i.last_checked_at
		  into v_workspace_id, v_owner_id, v_status, v_dernier_test
		  from public.mail_outbound_identities i
		 where i.id = p_id;
	else
		raise exception 'invalid_target' using errcode = '22023';
	end if;

	-- `v_owner_id is not null` n'est pas une précaution de style : sur une ligne sans propriétaire, `v_owner_id = v_appelant`
	-- vaut NULL, `not (false or NULL)` aussi, et un `if` sur NULL ne refuse pas. Écrit d'abord sans elle, un simple membre
	-- testait la boîte système : la suite pgTAP 0139 l'a trouvé (assertions 16 et 18).
	if v_workspace_id is null
	   or not (app.is_workspace_admin(v_workspace_id) or (v_owner_id is not null and v_owner_id = v_appelant)) then
		perform app.raise_http_error(404, 'not_found');
	end if;

	-- `disabled` est une décision d'exploitation (§13.2) : un test l'écraserait par `ok` ou `error`.
	if v_status = 'disabled' then
		raise exception 'disabled' using errcode = '55000';
	end if;

	-- Chaque test est une vraie authentification sur le serveur distant, qu'un fournisseur peut sanctionner.
	if v_dernier_test is not null and v_dernier_test > now() - interval '30 seconds' then
		raise exception 'too_soon' using errcode = 'P0001';
	end if;
end;
$$;

comment on function public.authorize_mail_connection_test(text, uuid) is
	'CRM-127 : décide si l''appelant peut tester la connexion d''un compte entrant (inbound) ou d''une identité '
	'sortante (outbound). Droit d''écriture de la ligne ; not_found sans divulgation ; disabled ; too_soon sous 30 s. '
	'Appelée par la fonction edge mail-connection-test avec le jeton de l''appelant. docs/SPEC-mail-subsystem.md §23.3.';

revoke all on function public.authorize_mail_connection_test(text, uuid) from public, anon;
grant execute on function public.authorize_mail_connection_test(text, uuid) to authenticated, service_role;
