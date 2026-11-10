-- @spec CRM-136 (docs/BACKLOG.md) — tranche T1 : le quota journalier d'une identité réglable à l'écran, retour à « aucun
--       plafond » compris — `upsert_mail_outbound_identity` gagne `p_daily_quota_set` (docs/SPEC-mail-subsystem.md §25.6 ;
--       docs/SCHEMA.md « Migration `0178` » ; docs/JOURNAL.md décisions 875, 884 et 885)
--
-- LA FONCTION EST RECRÉÉE, PAS REMPLACÉE : un paramètre de plus change sa signature, et laisser l'ancienne vivre à côté
-- ferait deux surcharges que PostgREST ne saurait départager. Le corps est celui de la `0058` à l'identique, la ligne du
-- quota exceptée ; les droits et le commentaire sont reposés.

drop function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
);

create function public.upsert_mail_outbound_identity(
	p_workspace_id uuid, p_label text, p_smtp_host text, p_smtp_port integer, p_smtp_security text, p_smtp_username text,
	p_from_address text, p_password text default null, p_owner_id uuid default null, p_from_name text default null,
	p_signature_text text default null, p_is_default boolean default true, p_daily_quota integer default null,
	p_daily_quota_set boolean default false
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_appelant   uuid := (select auth.uid());
	v_est_admin  boolean;
	v_existant   public.mail_outbound_identities%rowtype;
	v_secret_id  uuid;
	v_nom_secret text;
	v_id         uuid;
	-- LA NORMALISATION EST CALCULÉE UNE FOIS, ET LES DEUX BRANCHES LA PARTAGENT : l'écrire deux
	-- fois serait garantir qu'elles divergent le jour où l'une sera corrigée.
	v_signature  text := case
	                       when p_signature_text is null then null
	                       when app.btrim_blancs(p_signature_text) = '' then null
	                       else p_signature_text
	                     end;
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
			-- LE VIDE EST RAMENÉ À `NULL` DÈS LA DÉCLARATION (§10.4) : une chaîne vide écrite ici
			-- ferait deux états — absent et vide — là où le produit n'en connaît qu'un.
			p_from_name, v_signature, coalesce(p_is_default, true), p_daily_quota
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
		       -- L'EFFACEMENT VIT ICI, ET C'EST LE SEUL CHANGEMENT DE COMPORTEMENT DE CETTE
		       -- FONCTION (§10.4). TROIS ÉTATS : `p_signature_text` OMIS conserve la valeur
		       -- enregistrée, VIDE l'efface, REMPLI l'écrit. Le `coalesce` que cette ligne
		       -- remplaçait n'avait que DEUX états et rendait la colonne ineffaçable — motif
		       -- exact pour lequel le §22.1 refusait d'ouvrir le champ à l'écran.
		       signature_text = case
		                          when p_signature_text is null then i.signature_text
		                          else v_signature
		                        end,
		       is_default     = coalesce(p_is_default, i.is_default),
		       -- `CRM-136` (§25.6) : LE QUOTA DEVIENT EFFAÇABLE, et c'est le seul changement de cette fonction. À
		       -- `p_daily_quota_set` faux (le défaut), rien ne change : omis, le quota est conservé. À vrai, la valeur est
		       -- écrite TELLE QUELLE, `NULL` compris — le retour à « aucun plafond ». Un drapeau explicite plutôt qu'une
		       -- sentinelle (`-1`) que personne ne lirait sans la documentation.
		       daily_quota    = case
		                          when p_daily_quota_set then p_daily_quota
		                          else coalesce(p_daily_quota, i.daily_quota)
		                        end,
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
$function$;

comment on function public.upsert_mail_outbound_identity is
	'CRM-053 §14.2, révisée par CRM-063 §10.4 et CRM-136 §25.6 — seul chemin d''écriture des identités sortantes. '
	'p_signature_text connaît TROIS états : omis conserve, vide EFFACE, rempli écrit. p_daily_quota est conservé quand '
	'p_daily_quota_set est faux (le défaut), écrit tel quel, NULL compris, quand il est vrai.';

revoke all on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer, boolean
) from public, anon;
grant execute on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer, boolean
) to authenticated, service_role;

notify pgrst, 'reload schema';
