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

-- LE `drop` A LE MÊME MOTIF QUE DANS LA MIGRATION 23, et il est MESURÉ (`CRM-063` tranche 3) : la
-- migration 58 renomme `p_signature_html` en `p_signature_text`, et `create or replace function`
-- REFUSE de changer le nom d'un paramètre d'entrée. Sans ce retrait, le rejeu intégral du
-- répertoire s'arrêterait ici dès le deuxième démarrage suivant la 58.
drop function if exists public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
);

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
	p_signature_text text default null,
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
			-- DEUX PANNES DISTINCTES, ET LA SECONDE EST LA PLUS TRAÎTRESSE.
			--
			-- 1. Le secret existe mais n'est plus DÉCHIFFRABLE : `update_secret` lève
			--    `invalid ciphertext`, et le seed s'arrêtait net (INC-140).
			-- 2. Le secret n'existe PLUS DU TOUT, alors que la ligne du compte garde son
			--    identifiant : `update_secret` ne lève alors RIEN — elle met à jour zéro ligne et
			--    rend la main. MESURÉ le 2026-08-14 : après une purge de `vault.secrets`, le seed
			--    se déclarait réussi tandis que les trois comptes portaient un `secret_id`
			--    pendant, et la relève aurait échoué en `credentials_missing` sans que rien
			--    n'explique pourquoi. Un succès silencieux est pire qu'une erreur.
			--
			-- LE SEUL GESTE UTILE EST LE MÊME DANS LES DEUX CAS : recréer. Ce n'est pas masquer
			-- une erreur — le secret n'est pas récupérable, et le produit sait exactement quoi
			-- remettre à sa place, le mot de passe que l'appelant vient de fournir. La ligne
			-- orpheline est retirée pour libérer le nom, l'index de `vault.secrets` étant unique.
			begin
				perform vault.update_secret(v_secret_id, p_password);
			exception when others then
				v_secret_id := null;
			end;

			-- LA VÉRIFICATION EST POSITIVE, et c'est elle qui attrape la panne n° 2 : on ne se fie
			-- pas à l'absence d'exception, on constate que le secret EXISTE.
			if v_secret_id is not null
				and not exists (select 1 from vault.secrets s where s.id = v_secret_id) then
				v_secret_id := null;
			end if;

			if v_secret_id is null then
				delete from vault.secrets s where s.name = v_nom_secret;
				v_secret_id := vault.create_secret(
					p_password,
					v_nom_secret,
					'CRM-053 — secret recréé : l''ancien était illisible ou absent (INC-140)'
				);
			end if;
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
			secret_id, from_address, from_name, signature_text, is_default, daily_quota
		)
		values (
			p_workspace_id, p_owner_id, btrim(p_label), btrim(p_smtp_host), p_smtp_port,
			p_smtp_security, btrim(p_smtp_username), v_secret_id, btrim(p_from_address),
			-- SEULE LIGNE CHANGÉE : `p_daily_quota`, sans `coalesce` — « rien de précisé » reste
			-- `NULL` (aucun plafond), comme la migration 0030 l'a établi.
			p_from_name, p_signature_text, coalesce(p_is_default, true), p_daily_quota
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
		       signature_text = coalesce(p_signature_text, i.signature_text),
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
