-- @spec CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--       TRANCHE 3 : LA SIGNATURE
-- @spec docs/SPEC-modeles-emails.md §10.2 (le nom et le type de la colonne, et sa borne),
--       §10.3 (la position dans le corps expédié, et pourquoi la composition vit EN BASE),
--       §10.4 (l'effacement, et le `drop` qu'un renommage de paramètre impose),
--       §10.5 (une signature appartient à l'IDENTITÉ)
-- @spec docs/SPEC-mail-subsystem.md §14.2 (le modèle des identités sortantes), §19.4 (la garde
--       `queue_outbound_email`, seule porte de la file), §22.1 (pourquoi le champ était refusé)
-- @spec docs/SCHEMA.md §7 (messagerie) ; docs/PROD_MIGRATIONS.md §3 (migration 58)
-- @spec docs/INCONSISTENCY_REPORT.md INC-215 (la colonne morte et mal nommée — CLOSE ICI)
--
-- CETTE MIGRATION REND EFFECTIVE UNE COLONNE QUE PERSONNE NE LISAIT, ET COMMENCE PAR LA NOMMER
-- CORRECTEMENT.
--
-- `mail_outbound_identities.signature_html` existe depuis `CRM-053` et n'a jamais eu de lecteur :
-- ni `mail-sync` à l'envoi, ni l'écran des identités de `CRM-089`. Son nom annonçait du HTML là où
-- tout le sous-système expédie du `text/plain` — MESURÉ jusqu'à la sortie de
-- `EmailMessage.set_content`, qui rend `Content-Type: text/plain`.
--
-- ---------------------------------------------------------------------------------------------
-- POURQUOI LE RENOMMAGE EST POSSIBLE MAINTENANT, ET NE LE SERA PLUS APRÈS — mesuré le 2026-08-25.
-- ---------------------------------------------------------------------------------------------
-- La colonne est `text` NULLABLE, aucune des douze contraintes de la table ne la cite, aucune vue
-- n'en dépend, et elle est `NULL` sur les DEUX identités du seed. La renommer ne perd donc aucune
-- donnée et ne casse aucun appelant. Le premier lecteur qu'elle recevra est celui de cette
-- migration : lui faire lire un nom faux installerait durablement la divergence qu'INC-215 dénonce.
--
-- ---------------------------------------------------------------------------------------------
-- LE PRIX DU RENOMMAGE, MESURÉ ET PAYÉ DANS CE MÊME CHANGEMENT.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` ne tient aucun registre et rejoue TOUT le répertoire à chaque démarrage
-- (`docs/DAT.md` §3.2). Deux écritures antérieures s'en trouvaient condamnées, et les deux sont
-- corrigées à leur source plutôt que contournées ici :
--
--   1. le `grant select (…)` de la migration 23 NOMMAIT la colonne. MESURÉ :
--      `ERROR: column "signature_html" of relation "mail_outbound_identities" does not exist`
--      dès le rejeu suivant le renommage. La 23 ne nomme donc plus cette colonne, et le privilège
--      est reposé ICI, sous le nom que cette migration possède ;
--   2. les migrations 23 et 33 posaient la fonction d'écriture par `create or replace`, et
--      PostgreSQL REFUSE de changer ainsi le NOM d'un paramètre d'entrée. Les deux la retirent
--      désormais explicitement avant de la reposer — le geste de la migration 30 pour
--      `reserver_envois`.
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le renommage est gardé par l'existence de l'ancienne colonne, la contrainte converge, la
-- fonction d'écriture est retirée puis reposée, et les `revoke` / `grant` sont nominatifs. Rejouée
-- dix fois de suite, cette migration laisse le même état.

-- =============================================================================================
-- 1. La colonne — `signature_html` devient `signature_text` (§10.2)
-- =============================================================================================

do $$
begin
	if exists (
		select 1 from information_schema.columns
		 where table_schema = 'public' and table_name = 'mail_outbound_identities'
		   and column_name = 'signature_html'
	) and not exists (
		select 1 from information_schema.columns
		 where table_schema = 'public' and table_name = 'mail_outbound_identities'
		   and column_name = 'signature_text'
	) then
		alter table public.mail_outbound_identities rename column signature_html to signature_text;
	end if;
end;
$$;

comment on column public.mail_outbound_identities.signature_text is
	'CRM-063 §10.2 — signature de cette identité, en TEXTE BRUT. Ajoutée à la fin de chaque corps '
	'mis en file par public.queue_outbound_email, précédée d''une ligne vide et du séparateur '
	'« -- » de la RFC 3676 §4.3. NULL = aucune signature. Renommée depuis signature_html : le '
	'sous-système expédie du text/plain, et le HTML entrant est proscrit (SPEC-mail-subsystem §18.4).';

-- --- 1.1 La borne, qui protège la borne d'en face --------------------------------------------
--
-- MESURÉ : `mail_outbox_corps` exige `char_length(body_text) between 1 and 100000`. La signature
-- va désormais être CONCATÉNÉE à chaque corps mis en file ; sans borne, une signature de cent
-- mille caractères rendrait tout envoi impossible depuis cette identité, et le refus parlerait du
-- corps là où la faute serait dans la signature. Deux mille caractères, soit 2 % de la place.
--
-- La convergence est écrite à la main plutôt que par un outil partagé : la migration 23 avait le
-- sien, qu'elle retire à la fin de son propre fichier.

do $$
declare
	v_definition_attendue constant text :=
		'CHECK ((char_length(signature_text) <= 2000))';
	v_definition_reelle text;
begin
	select pg_catalog.pg_get_constraintdef(c.oid) into v_definition_reelle
	  from pg_catalog.pg_constraint c
	 where c.conrelid = 'public.mail_outbound_identities'::regclass
	   and c.conname  = 'mail_outbound_identities_signature_borne';

	if v_definition_reelle is null then
		alter table public.mail_outbound_identities
			add constraint mail_outbound_identities_signature_borne
			check (char_length(signature_text) <= 2000);
	elsif v_definition_reelle <> v_definition_attendue then
		alter table public.mail_outbound_identities
			drop constraint mail_outbound_identities_signature_borne;
		alter table public.mail_outbound_identities
			add constraint mail_outbound_identities_signature_borne
			check (char_length(signature_text) <= 2000);
	end if;
end;
$$;

-- --- 1.2 Le privilège de lecture de la colonne ------------------------------------------------
--
-- Il appartient à cette migration depuis qu'elle possède le nom de la colonne (voir l'en-tête).
-- `service_role` a déjà `all privileges` sur la table par la migration 23 : rien à reposer pour
-- lui. `anon` n'a aucun privilège sur cette table, et n'en reçoit pas ici.

grant select (signature_text) on public.mail_outbound_identities to authenticated;

-- =============================================================================================
-- 2. `app.mail_corps_signe(text, text)` — la règle de composition, écrite UNE SEULE FOIS (§10.3)
-- =============================================================================================
--
-- ELLE VIT EN BASE, ET CE N'EST PAS UNE COMMODITÉ. L'autre issue était d'ajouter la signature au
-- moment de l'ENVOI, dans le worker : `mail_outbox.body_text` serait alors DIFFÉRENT de ce que le
-- destinataire a reçu. Or c'est cette colonne que le CRM conserve, que la RLS ouvre à qui lit
-- l'affaire, et que les preuves relisent. Un archivage qui diffère de l'envoi est un archivage qui
-- ment, et le mensonge ne se verrait qu'en comparant deux systèmes.
--
-- ELLE EST ISOLÉE DE LA GARDE, et c'est ce qui la rend éprouvable caractère à caractère sans
-- mettre le moindre message en file — le montage de `app.mail_template_substituer` (§8.2).
--
-- `immutable` : la même paire rend toujours le même texte, sans lire ni la base ni l'horloge.

create or replace function app.mail_corps_signe(p_corps text, p_signature text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
	-- QUATRE RÈGLES, ET CHACUNE A SON ASSERTION (§10.3) :
	--
	--   1. signature absente          -> le corps est rendu INCHANGÉ, sans ligne vide ajoutée ;
	--   2. signature blanche          -> traitée comme absente. La fonction d'écriture ramène déjà
	--                                    le vide à NULL, mais une donnée posée par une autre voie
	--                                    ne doit pas produire un séparateur suivi de rien ;
	--   3. les blancs de FIN du corps sont retirés avant la ligne vide — un corps terminé par
	--      trois retours à la ligne produirait sinon quatre lignes vides devant le séparateur,
	--      invisibles à l'écran et visibles chez le destinataire ;
	--   4. le séparateur est celui de la RFC 3676 §4.3 : deux tirets et UNE ESPACE. C'est ce que
	--      les clients de messagerie reconnaissent pour replier une signature. L'espace de fin est
	--      écrite en échappement Unicode — `E' '` — parce qu'une espace en fin de littéral est
	--      indistinguable d'une faute de frappe à la relecture, et qu'un éditeur qui rogne les fins
	--      de ligne la ferait disparaître sans qu'aucune preuve ne dise pourquoi.
	--
	-- LA SIGNATURE N'EST PAS RECADRÉE : ses blancs internes et ses retours à la ligne sont
	-- conservés tels quels. Une signature EST une mise en forme ; seul son test de VACUITÉ passe
	-- par `app.btrim_blancs`, jamais la valeur écrite.
	select case
	         when p_signature is null then p_corps
	         when app.btrim_blancs(p_signature) = '' then p_corps
	         else app.btrim_blancs(p_corps) || E'\n\n--' || E' ' || E'\n' || p_signature
	       end;
$$;

comment on function app.mail_corps_signe(text, text) is
	'CRM-063 §10.3 — le corps tel qu''il sera EXPÉDIÉ : le corps écrit, puis une ligne vide, puis '
	'le séparateur « -- » de la RFC 3676 §4.3, puis la signature. Une signature nulle ou blanche '
	'rend le corps INCHANGÉ. Seule définition de la règle : queue_outbound_email l''appelle.';

revoke all on function app.mail_corps_signe(text, text) from public, anon;
grant execute on function app.mail_corps_signe(text, text) to authenticated, service_role;

-- =============================================================================================
-- 3. `public.upsert_mail_outbound_identity` — l'effacement réparé (§10.4)
-- =============================================================================================
--
-- CE QUI CHANGE PAR RAPPORT À LA MIGRATION 33, ET RIEN D'AUTRE :
--
--   * `p_signature_html` devient `p_signature_text` — d'où le `drop` ci-dessous ;
--   * les deux branches NORMALISENT le vide en `NULL`.
--
-- POURQUOI LA NORMALISATION EXISTE. La branche `UPDATE` appliquait
-- `signature = coalesce(p_signature, i.signature)` : omettre CONSERVE — ce qui est voulu — mais
-- RIEN ne pouvait ramener la colonne à `NULL`. Le §22.1 de `docs/SPEC-mail-subsystem.md` en avait
-- tiré la seule conclusion honnête à l'époque : ne pas ouvrir un champ qu'on ne saurait pas vider.
-- La tranche 3 ouvre le champ, elle répare donc d'abord l'effacement.
--
-- TROIS ÉTATS, ET NON DEUX : omis conserve, vide EFFACE, rempli écrit. C'est exactement la règle
-- mesurée de `p_from_name` (§22.5), et l'inverse de celle de `p_daily_quota`, dont le §22.1 dit
-- pourquoi elle reste ineffaçable.
--
-- TOUT LE RESTE — droits, secret, adresse par défaut, remise à `pending` — est repris À
-- L'IDENTIQUE de la migration 33. Aucune autre règle de `CRM-053` n'est touchée.

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

comment on function public.upsert_mail_outbound_identity is
	'CRM-053 §14.2, révisée par CRM-063 §10.4 — seul chemin d''écriture des identités sortantes. '
	'p_signature_text remplace p_signature_html (INC-215) et connaît TROIS états : omis conserve, '
	'vide EFFACE, rempli écrit. p_daily_quota reste ineffaçable, et le §22.1 dit pourquoi.';

revoke all on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
) from public, anon;
grant execute on function public.upsert_mail_outbound_identity(
	uuid, text, text, integer, text, text, text, text, uuid, text, text, boolean, integer
) to authenticated, service_role;

-- =============================================================================================
-- 4. `public.queue_outbound_email` — la signature entre dans le corps mis en file (§10.3)
-- =============================================================================================
--
-- CE QUI CHANGE PAR RAPPORT À LA MIGRATION 30, ET RIEN D'AUTRE :
--
--   * un SEPTIÈME refus, `body_required`, posé AVANT toute composition ;
--   * le corps inséré est `app.mail_corps_signe(p_body_text, v_identite.signature_text)`.
--
-- POURQUOI `body_required` EXISTE, ET POURQUOI IL EST ANTÉRIEUR À LA COMPOSITION. MESURÉ :
-- `mail_outbox_corps` exige `char_length(body_text) >= 1`, si bien qu'un corps vide est refusé
-- aujourd'hui en `23514`. Sans garde explicite, une signature le rendrait NON VIDE et un message
-- ne portant QUE la signature partirait chez le destinataire. Le refus conserve le `SQLSTATE`
-- `23514` : `webapp/src/lib/envoi.ts` classe par code et non par message, et rend donc le même
-- `invalide` qu'avant, sans qu'aucune phrase du serveur n'atteigne l'écran.
--
-- LA BORNE HAUTE S'APPLIQUE AU CORPS COMPOSÉ, et c'est voulu : ce qui est stocké est ce qui part,
-- donc c'est bien le tout qui doit tenir dans les cent mille caractères. La borne de deux mille
-- caractères de la signature (§1.1) garantit que l'écart ne dépasse jamais 2 % de la place.
--
-- LES SIX REFUS DE `CRM-058` SONT REPRIS À L'IDENTIQUE, dans le même ordre, avec les mêmes codes.

create or replace function public.queue_outbound_email(
	p_card_id     uuid,
	p_identity_id uuid,
	p_to          text[],
	p_subject     text default null,
	p_body_text   text default '',
	p_cc          text[] default '{}',
	p_in_reply_to_message_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_appelant  uuid := (select auth.uid());
	v_identite  public.mail_outbound_identities%rowtype;
	v_card      public.cards%rowtype;
	v_adresse   text;
	v_file      uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- ENVOYER AU NOM D'UNE AFFAIRE, C'EST Y AJOUTER DU CONTENU : le droit d'ÉCRITURE est exigé,
	-- comme pour un commentaire ou un classement.
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and (
	     i.owner_id = v_appelant
	     -- L'identité de SERVICE — sans propriétaire — appartient au workspace : seuls ses
	     -- administrateurs l'empruntent.
	     or (i.owner_id is null and app.is_workspace_admin(i.workspace_id))
	   );
	if v_identite.id is null then
		-- `42501` ET NON `P0002`, ET C'EST MESURÉ : PostgREST traduit `P0002` en **500**, et un
		-- refus d'autorisation qui se présente comme une panne de serveur enverrait l'exploitant
		-- chercher un incident là où le produit a simplement dit non.
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	select * into v_card
	  from public.cards c
	 where c.id = p_card_id
	   and c.workspace_id = v_identite.workspace_id
	   and c.archived_at is null
	   and c.deleted_at is null;
	if v_card.id is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- LA CARD DOIT AVOIR UNE ADRESSE, et le motif est mesuré (§19.1) : le serveur transmet le
	-- `Reply-To` sans le vérifier. Un envoi dont la réponse ne reviendrait nulle part est pire
	-- qu'un envoi refusé.
	select c.email_local_part || '@' || w.inbound_domain into v_adresse
	  from public.cards c join public.workspaces w on w.id = c.workspace_id
	 where c.id = p_card_id and c.email_local_part is not null;
	if v_adresse is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	if coalesce(array_length(p_to, 1), 0) = 0 then
		raise exception 'recipient_required' using errcode = '23514';
	end if;

	-- LE SEPTIÈME REFUS — CRM-063 §10.3. Il porte sur ce que l'UTILISATEUR a écrit, jamais sur le
	-- corps composé : une signature ne rattrape pas un message vide.
	if coalesce(char_length(p_body_text), 0) < 1 then
		raise exception 'body_required' using errcode = '23514';
	end if;

	-- LE QUOTA, PAR POLITESSE : la règle est celle du worker, qui dépense réellement (§19.4).
	-- Ce contrôle-ci rend le refus immédiat et visible par celui qui écrit.
	if v_identite.daily_quota is not null
		and app.envois_du_jour(p_identity_id) >= v_identite.daily_quota then
		raise exception 'quota_exceeded' using errcode = '23505';
	end if;

	insert into public.mail_outbox (
		workspace_id, identity_id, card_id, in_reply_to_message_id,
		to_addrs, cc_addrs, subject, body_text, created_by
	)
	values (
		v_identite.workspace_id, p_identity_id, p_card_id, p_in_reply_to_message_id,
		p_to, coalesce(p_cc, '{}'), p_subject,
		-- CE QUI EST STOCKÉ EST CE QUI PART (§10.3).
		app.mail_corps_signe(p_body_text, v_identite.signature_text),
		v_appelant
	)
	returning id into v_file;

	return v_file;
end;
$$;

comment on function public.queue_outbound_email is
	'CRM-058 §19.4, révisée par CRM-063 §10.3 — seule porte de la file d''envoi. SEPT refus : '
	'not_authenticated, forbidden, identity_not_available, card_not_available, '
	'recipient_required, body_required, quota_exceeded. Le corps stocké est le corps SIGNÉ : ce '
	'que la file porte est ce que le destinataire reçoit.';

revoke all on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid)
	from public, anon;
grant execute on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid)
	to authenticated, service_role;
