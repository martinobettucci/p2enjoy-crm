-- @spec CRM-053 (docs/BACKLOG.md), CRM-058 (docs/BACKLOG.md) — chemin d'écriture de
--       `mail_outbound_identities.daily_quota`
-- @spec docs/SPEC-mail-subsystem.md §14.2 (modèle), §19.4 (le quota, ses deux lectures)
-- @spec docs/JOURNAL.md décision 330 (§8 : `NULL` = aucun plafond, `0` = interdiction explicite),
--       décision 347 (ce correctif, sa cause, sa portée)
--
-- LA MIGRATION `0030` A CORRIGÉ LA COLONNE ET SES DEUX LECTEURS, JAMAIS SON UNIQUE ÉCRIVAIN.
--
-- Elle a posé `daily_quota` nullable, son défaut `NULL`, et converti les zéros existants — mais la
-- branche `INSERT` de `public.upsert_mail_outbound_identity`, écrite par la migration `0023` et
-- jamais retouchée depuis, portait encore `coalesce(p_daily_quota, 0)` : un appelant qui ne précise
-- rien recevait un `0` explicite, l'exact contraire du défaut que la `0030` avait établi. MESURÉ en
-- tentant de rejouer `e2e/mail/resilience.spec.ts` pour `CRM-059` : chaque réapplication du seed
-- réinstalle silencieusement `daily_quota = 0` sur les deux identités sortantes, et bloque TOUT
-- envoi — `quota_exceeded` dès le premier message (décision 347).
--
-- Seule la ligne d'insertion change. La branche `UPDATE` était déjà correcte
-- (`coalesce(p_daily_quota, i.daily_quota)`, qui préserve la valeur existante), et tout le reste de
-- la fonction — droits, secret, adresse par défaut — est recopié à l'identique de la `0023`.

create or replace function public.upsert_mail_outbound_identity(
	p_workspace_id   uuid,
	p_label          text,
	p_smtp_host      text,
	p_smtp_port      integer,
	p_smtp_security  text,
	p_smtp_username  text,
	p_from_address   text,
	p_password       text default null,
	p_owner_id       uuid default null,
	p_from_name      text default null,
	p_signature_html text default null,
	p_is_default     boolean default true,
	p_daily_quota    integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant   uuid := (select auth.uid());
	v_est_admin  boolean;
	v_existant   public.mail_outbound_identities%rowtype;
	v_secret_id  uuid;
	v_nom_secret text;
	v_id         uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	v_est_admin := app.is_workspace_admin(p_workspace_id);

	if p_owner_id is null then
		if not v_est_admin then
			raise exception 'forbidden' using errcode = '42501';
		end if;
	elsif not v_est_admin and p_owner_id <> v_appelant then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select * into v_existant
	  from public.mail_outbound_identities i
	 where i.workspace_id = p_workspace_id
	   and i.owner_id is not distinct from p_owner_id
	   and i.from_address = btrim(p_from_address);

	if p_password is not null and btrim(p_password) <> '' then
		v_nom_secret := 'mail_outbound:' || p_workspace_id::text || ':'
		                || coalesce(p_owner_id::text, 'service') || ':' || btrim(p_from_address);
		v_secret_id := v_existant.secret_id;

		if v_secret_id is null then
			select s.id into v_secret_id from vault.secrets s where s.name = v_nom_secret;
		end if;

		if v_secret_id is null then
			v_secret_id := vault.create_secret(
				p_password, v_nom_secret,
				'CRM-053 — mot de passe SMTP d''une identité sortante'
			);
		else
			perform vault.update_secret(v_secret_id, p_password);
		end if;
	else
		v_secret_id := v_existant.secret_id;
	end if;

	if v_existant.id is null then
		if v_secret_id is null then
			raise exception 'password_required' using errcode = '23514';
		end if;

		insert into public.mail_outbound_identities (
			workspace_id, owner_id, label, smtp_host, smtp_port, smtp_security, smtp_username,
			secret_id, from_address, from_name, signature_html, is_default, daily_quota
		)
		values (
			p_workspace_id, p_owner_id, btrim(p_label), btrim(p_smtp_host), p_smtp_port,
			p_smtp_security, btrim(p_smtp_username), v_secret_id, btrim(p_from_address),
			-- SEULE LIGNE CHANGÉE : `p_daily_quota`, sans `coalesce` — « rien de précisé » reste
			-- `NULL` (aucun plafond), comme la migration 0030 l'a établi.
			p_from_name, p_signature_html, coalesce(p_is_default, true), p_daily_quota
		)
		returning id into v_id;
	else
		update public.mail_outbound_identities i
		   set label          = btrim(p_label),
		       smtp_host      = btrim(p_smtp_host),
		       smtp_port      = p_smtp_port,
		       smtp_security  = p_smtp_security,
		       smtp_username  = btrim(p_smtp_username),
		       secret_id      = v_secret_id,
		       from_name      = coalesce(p_from_name, i.from_name),
		       signature_html = coalesce(p_signature_html, i.signature_html),
		       is_default     = coalesce(p_is_default, i.is_default),
		       daily_quota    = coalesce(p_daily_quota, i.daily_quota),
		       status         = case
		                          when i.smtp_host <> btrim(p_smtp_host)
		                            or i.smtp_port <> p_smtp_port
		                            or i.smtp_security <> p_smtp_security
		                            or i.smtp_username <> btrim(p_smtp_username)
		                            or (p_password is not null and btrim(p_password) <> '')
		                          then 'pending'
		                          else i.status
		                        end,
		       last_error     = case
		                          when i.smtp_host <> btrim(p_smtp_host)
		                            or i.smtp_port <> p_smtp_port
		                            or i.smtp_security <> p_smtp_security
		                            or i.smtp_username <> btrim(p_smtp_username)
		                            or (p_password is not null and btrim(p_password) <> '')
		                          then null
		                          else i.last_error
		                        end
		 where i.id = v_existant.id
		returning i.id into v_id;
	end if;

	return v_id;
end;
$$;

comment on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
) is
	'CRM-053, corrigée par la migration 0033 (décision 347) : `p_daily_quota` omis laisse `NULL` '
	'(aucun plafond) plutôt que de réinstaller `0` (interdiction totale) à chaque appel.';

revoke all on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
) from public, anon;
grant execute on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
) to authenticated, service_role;
