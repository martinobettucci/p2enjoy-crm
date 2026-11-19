-- @spec CRM-157 (docs/BACKLOG.md) — tranche T1 : un refus nommé quand l'espace n'a pas de domaine d'adresses d'affaire,
--       et une relance due qui arrête sa séquence au lieu de partir sans destinataire
-- @spec docs/SPEC-mail-subsystem.md §33.2 (le refus `workspace_reply_domain_missing`, l'ordre des contrôles), §33.2 bis (la
--       relance due, décision 955) ; docs/SPEC-modeles-emails.md §12.7 (une sixième fin) ; docs/SCHEMA.md « Migration
--       `0192` » ; docs/JOURNAL.md décisions 951, 953 et 955
--
-- LE DÉFAUT (constaté en production le 2026-11-19, décision 951) : sans domaine entrant, l'adresse de réponse d'une affaire
-- ne se compose pas, et `queue_outbound_email` refusait par `card_not_available` — l'écran disait « affaire indisponible ».
-- `app.executer_sequences_relance`, lui, ne contrôlait rien : `array[null]` passe `mail_outbox_destinataire`.
--
-- CE QUI CHANGE, ET RIEN D'AUTRE :
--   1. `card_sequence_enrollments_motif_borne` admet `workspace_reply_domain_missing` ;
--   2. `queue_outbound_email` — donc `send_email_draft`, qui l'appelle — et `armer_sequence_relance` refusent un espace
--      sans domaine par ce nom, à la place de `card_not_available`, au même rang des contrôles ;
--   3. `app.executer_sequences_relance` ferme l'inscription due d'un espace sans domaine, sans rien mettre en file.
-- Les corps sont repris À L'IDENTIQUE de leur définition en vigueur (`0106`, `0149`, `0158`) hors ces lignes, marquées
-- `CRM-157`. `create or replace` conserve l'ACL ; elle est redite pour qu'une base où la fonction manquerait la reçoive.
--
-- IDEMPOTENCE : la contrainte n'est élargie que si elle ne l'est pas ; `create or replace` pour les trois fonctions.
-- RETOUR ARRIÈRE : rejouer les trois définitions d'avant (celles de `0106`, `0149` et `0158`) ; resserrer la contrainte
-- exige qu'aucune inscription ne porte `workspace_reply_domain_missing` (les réarmer, ou les passer à `manual`).

-- =============================================================================================
-- 1. Le motif de fermeture — docs/SPEC-modeles-emails.md §12.7
-- =============================================================================================

do $$
begin
	if not exists (
		select 1 from pg_constraint c
		 where c.conrelid = 'public.card_sequence_enrollments'::regclass
		   and c.conname = 'card_sequence_enrollments_motif_borne'
		   and pg_get_constraintdef(c.oid) like '%workspace_reply_domain_missing%'
	) then
		alter table public.card_sequence_enrollments drop constraint if exists card_sequence_enrollments_motif_borne;
		alter table public.card_sequence_enrollments add constraint card_sequence_enrollments_motif_borne
			check (closed_reason is null
			       or closed_reason in ('reply', 'card_ineligible', 'manual', 'exhausted', 'identity_withdrawn',
			                            'workspace_reply_domain_missing'));
	end if;
end;
$$;

-- =============================================================================================
-- 2. L'envoi d'une personne — docs/SPEC-mail-subsystem.md §33.2
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.queue_outbound_email(p_card_id uuid, p_identity_id uuid, p_to text[], p_subject text DEFAULT NULL::text, p_body_text text DEFAULT ''::text, p_cc text[] DEFAULT '{}'::text[], p_in_reply_to_message_id uuid DEFAULT NULL::uuid, p_bcc text[] DEFAULT '{}'::text[], p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_appelant  uuid := (select auth.uid());
	v_identite  public.mail_outbound_identities%rowtype;
	v_card      public.cards%rowtype;
	v_adresse   text;
	v_chemins   text[];
	v_pieces    jsonb;
	v_trouvees  integer;
	v_total     bigint;
	v_file      uuid;
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- ENVOYER AU NOM D'UNE AFFAIRE, C'EST Y AJOUTER DU CONTENU (§19.4).
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- LA SIENNE, ET ELLE SEULE (décision 805, INC-335) : l'identité de service ne sert qu'aux envois automatiques, et
	-- aucun appelant ne l'emprunte, administrateur compris.
	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and i.owner_id = v_appelant;
	if v_identite.id is null then
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	select * into v_card
	  from public.cards c
	 where c.id = p_card_id
	   and c.workspace_id = v_identite.workspace_id
	   and app.card_has_active_placement(c.id)
	   and c.deleted_at is null;
	if v_card.id is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- `CRM-157` (docs/SPEC-mail-subsystem.md §33.2) : L'ESPACE SANS DOMAINE A SON REFUS NOMMÉ. Il était rangé sous
	-- `card_not_available`, que l'écran disait « affaire indisponible » — faux et inutile (décision 951). L'affaire est
	-- disponible : c'est l'adresse de réponse qui ne se compose pas, et seul un super-administrateur y peut quelque chose.
	if (select w.inbound_domain from public.workspaces w where w.id = v_card.workspace_id) is null then
		raise exception 'workspace_reply_domain_missing' using errcode = '23514';
	end if;

	select c.email_local_part || '@' || w.inbound_domain into v_adresse
	  from public.cards c join public.workspaces w on w.id = c.workspace_id
	 where c.id = p_card_id and c.email_local_part is not null;
	if v_adresse is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	if coalesce(array_length(p_to, 1), 0) = 0 then
		raise exception 'recipient_required' using errcode = '23514';
	end if;

	if coalesce(char_length(p_body_text), 0) < 1 then
		raise exception 'body_required' using errcode = '23514';
	end if;

	-- LES PIÈCES JOINTES — §19 bis.2 points 4 et 5. Le client ne donne que des CHEMINS ; nom de fichier, taille et type
	-- sont relus dans `storage.objects`, jamais crus.
	if jsonb_typeof(coalesce(p_attachments, '[]'::jsonb)) <> 'array' then
		raise exception 'attachment_not_available' using errcode = '23514';
	end if;
	select coalesce(array_agg(distinct e), '{}')
	  into v_chemins
	  from jsonb_array_elements_text(coalesce(p_attachments, '[]'::jsonb)) e;
	if coalesce(array_length(v_chemins, 1), 0) > 10 then
		raise exception 'too_many_attachments' using errcode = '23514', detail = 'At most 10 attachments per message.';
	end if;
	if coalesce(array_length(v_chemins, 1), 0) > 0 then
		select count(*),
		       coalesce(sum((o.metadata ->> 'size')::bigint), 0),
		       coalesce(jsonb_agg(jsonb_build_object(
		           'path', o.name,
		           'filename', split_part(o.name, '/', 4),
		           'mime_type', coalesce(o.metadata ->> 'mimetype', 'application/octet-stream'),
		           'size_bytes', (o.metadata ->> 'size')::bigint
		       ) order by o.name), '[]'::jsonb)
		  into v_trouvees, v_total, v_pieces
		  from storage.objects o
		 where o.bucket_id = 'mail-outbound-attachments'
		   and o.name = any (v_chemins)
		   and o.owner = v_appelant
		   and split_part(o.name, '/', 1) = v_identite.workspace_id::text
		   and split_part(o.name, '/', 2) = v_appelant::text;
		-- UN SEUL REFUS POUR QUATRE CAUSES — absent, autre bucket, autre propriétaire, autre espace : les distinguer
		-- dirait à l'appelant qu'un objet d'autrui existe à ce chemin.
		if v_trouvees <> array_length(v_chemins, 1) then
			raise exception 'attachment_not_available' using errcode = '23514';
		end if;
		if v_total > 10485760 then
			raise exception 'attachments_too_large' using errcode = '23514', detail = 'At most 10 MB of attachments per message.';
		end if;
	end if;

	if v_identite.daily_quota is not null
		and app.envois_du_jour(p_identity_id) >= v_identite.daily_quota then
		raise exception 'quota_exceeded' using errcode = '23505';
	end if;

	v_file := app.mail_outbox_inserer(
		v_identite.workspace_id, p_identity_id, p_card_id, p_in_reply_to_message_id,
		p_to, p_cc, p_subject, p_body_text, v_identite.signature_text, v_appelant);

	-- LA COPIE CACHÉE ET LES PIÈCES complètent la ligne que la porte extraite vient d'écrire, dans la même transaction :
	-- `app.mail_outbox_inserer` reste la seule insertion, et les séquences de relance, qui n'ont ni l'une ni les autres,
	-- n'en voient aucun changement.
	update public.mail_outbox
	   set bcc_addrs = coalesce(p_bcc, '{}'),
	       attachments = coalesce(v_pieces, '[]'::jsonb)
	 where id = v_file;

	return v_file;
end;
$function$;

revoke all on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid, text[], jsonb)
	from public, anon;
grant execute on function public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid, text[], jsonb)
	to authenticated, service_role;

-- =============================================================================================
-- 3. L'armement d'une relance — docs/SPEC-mail-subsystem.md §33.2
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.armer_sequence_relance(p_placement uuid, p_sequence_id uuid, p_identity_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_appelant    uuid := (select auth.uid());
	v_placement   public.card_placements%rowtype;
	v_sequence    public.mail_sequences%rowtype;
	v_identite    public.mail_outbound_identities%rowtype;
	v_paliers     integer;
	v_figee       boolean;
	v_adresse     text;
	v_inscription uuid;
begin
	-- (a) Le geste est HUMAIN par construction (§12.2).
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	-- (b) Relancer au nom d'une affaire, c'est y ajouter du contenu : l'appelant écrit le channel du RATTACHEMENT.
	-- Un rattachement inconnu rend le même refus, comme `app.can_write_card` le rendait pour une affaire inconnue.
	select p.* into v_placement from public.card_placements p where p.id = p_placement;
	if v_placement.id is null or not app.can_write_channel(v_placement.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- (e) L'identité doit être empruntable — règle de `queue_outbound_email`, évaluée avant la séquence : elle fixe le
	-- workspace de référence.
	-- LA SIENNE, ET ELLE SEULE (décision 805, INC-335) : l'identité de service ne sert qu'aux envois automatiques, et
	-- aucun appelant ne l'emprunte, administrateur compris.
	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and i.owner_id = v_appelant;
	if v_identite.id is null then
		raise exception 'identity_not_available' using errcode = '42501';
	end if;

	-- (c) La séquence existe DANS LE WORKSPACE de l'identité.
	select * into v_sequence
	  from public.mail_sequences s
	 where s.id = p_sequence_id
	   and s.workspace_id = v_identite.workspace_id;
	if v_sequence.id is null then
		raise exception 'sequence_not_available' using errcode = '23514';
	end if;

	-- (d) Une cadence VIDE n'enverrait jamais rien.
	select count(*)::integer into v_paliers
	  from public.mail_sequence_steps st
	 where st.sequence_id = p_sequence_id;
	if v_paliers = 0 then
		raise exception 'sequence_empty' using errcode = '23514';
	end if;

	-- (f) LE RATTACHEMENT DOIT ÊTRE FIGÉ, au sens de `public.cards_figees()` et d'aucun autre : sa ligne est celle de
	-- l'affaire DANS SON channel (§6, un rattachement peut être figé pendant que l'autre avance).
	select exists (
		select 1 from public.cards_figees() f
		 where f.card_id = v_placement.card_id and f.channel_id = v_placement.channel_id
	) into v_figee;
	if not v_figee then
		raise exception 'card_not_stalled' using errcode = '23514';
	end if;

	-- (g bis) `CRM-157` (docs/SPEC-mail-subsystem.md §33.2) : L'ESPACE SANS DOMAINE A SON REFUS NOMMÉ, avant celui de
	-- l'adresse. Une affaire d'un autre espace que l'identité ne passe pas ici : elle reste `card_not_available` en (g).
	if exists (
		select 1
		  from public.cards c join public.workspaces w on w.id = c.workspace_id
		 where c.id = v_placement.card_id
		   and c.workspace_id = v_identite.workspace_id
		   and w.inbound_domain is null
	) then
		raise exception 'workspace_reply_domain_missing' using errcode = '23514';
	end if;

	-- (g) L'AFFAIRE DOIT AVOIR UNE ADRESSE — celle de l'affaire, unique quels que soient ses rattachements (§7).
	select c.email_local_part || '@' || w.inbound_domain into v_adresse
	  from public.cards c join public.workspaces w on w.id = c.workspace_id
	 where c.id = v_placement.card_id
	   and c.workspace_id = v_identite.workspace_id
	   and c.email_local_part is not null;
	if v_adresse is null then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- (h) UNE SEULE INSCRIPTION ACTIVE PAR RATTACHEMENT ; l'index partiel l'impose, ce contrôle donne au refus un nom.
	if exists (
		select 1 from public.card_sequence_enrollments e
		 where e.placement_id = p_placement and e.status = 'active'
	) then
		raise exception 'enrollment_exists' using errcode = '23505';
	end if;

	insert into public.card_sequence_enrollments (
		workspace_id, card_id, placement_id, sequence_id, identity_id, armed_by
	)
	values (
		v_identite.workspace_id, v_placement.card_id, p_placement, p_sequence_id, p_identity_id,
		-- TRACE, JAMAIS UN DROIT (§2.2) : le profil est relu, jamais recopié depuis la revendication.
		(select p.id from public.profiles p where p.id = v_appelant)
	)
	returning id into v_inscription;

	return v_inscription;
end;
$function$;

revoke all on function public.armer_sequence_relance(uuid, uuid, uuid) from public, anon;
grant execute on function public.armer_sequence_relance(uuid, uuid, uuid) to authenticated, service_role;

-- =============================================================================================
-- 4. L'exécution des relances — docs/SPEC-mail-subsystem.md §33.2 bis
-- =============================================================================================

CREATE OR REPLACE FUNCTION app.executer_sequences_relance()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_inscription record;
	v_palier      record;
	v_rendu       record;
	v_identite    public.mail_outbound_identities%rowtype;
	v_mises       integer := 0;
	v_dernier     integer;
	v_job_id      bigint;
begin
	-- --- 1 Fermer ce que l'affaire a rendu inéligible — motif `card_ineligible` ---------------
	-- UN SEUL PRÉDICAT COUVRE QUATRE INTERRUPTIONS (§12.7), et aucun n'est réécrit ici : le
	-- déplacement d'étape repose `entered_step_at` (migration 12), et le sommeil, l'archivage et
	-- la corbeille sont les trois exclusions du §2.4 de `docs/SPEC-relances.md`.
	--
	-- La fonction est APPELÉE, jamais recopiée (§9.2). MESURÉ le 2026-08-24 pour `CRM-062` :
	-- `postgres` porte `rolbypassrls`, donc `cards_figees()` — `SECURITY INVOKER` — lui rend
	-- l'ensemble GLOBAL, là où elle rend à chaque client ses seules affaires.
	--
	-- `CRM-111` T2.3.5 : le figement se juge sur le RATTACHEMENT inscrit, sa ligne de `cards_figees()` — une par
	-- rattachement (docs/SPEC-rattachements.md §6, §7). Un rattachement qui avance ferme sa cadence, même si un autre
	-- rattachement de la même affaire reste figé.
	update public.card_sequence_enrollments e
	   set status        = 'closed',
	       closed_reason = 'card_ineligible',
	       closed_at     = now()
	 where e.status = 'active'
	   and not exists (select 1 from public.cards_figees() f
	                     join public.card_placements pl on pl.id = e.placement_id
	                    where f.card_id = pl.card_id and f.channel_id = pl.channel_id);

	-- --- 2 Fermer ce qu'une réponse a terminé — motif `reply` ----------------------------------
	-- L'ANCRE EST `created_at` ET NON `sent_at`, ET C'EST UNE MESURE QUI L'IMPOSE (§12.1) :
	-- `sent_at` est NULLE sur les quatre messages du seed. C'est la date que l'en-tête DÉCLARE, et
	-- rien n'oblige un correspondant à la renseigner ni à la renseigner juste. `created_at` est
	-- l'instant où le produit a VU le message.
	--
	-- LA BORNE EST `armed_at` ET NON `last_sent_at` (§12.6) : un message arrivé entre l'armement et
	-- le premier palier est une réponse à la conversation, même si aucune relance n'est encore
	-- partie. Prendre `last_sent_at` laisserait partir un premier palier chez quelqu'un qui avait
	-- déjà répondu.
	--
	-- AUCUN TRIGGER SUR `mail_messages` : la détection est LUE au passage, comme l'idempotence de
	-- `CRM-062` est lue et non stockée. Un trigger ferait de l'ingestion IMAP — chemin chaud tenu
	-- par `mail-sync` — le porteur d'une règle de relance.
	update public.card_sequence_enrollments e
	   set status        = 'closed',
	       closed_reason = 'reply',
	       closed_at     = now()
	 where e.status = 'active'
	   and exists (
	       select 1
	         from public.mail_messages m
	        where m.card_id    = e.card_id
	          and m.direction  = 'inbound'
	          and m.created_at > e.armed_at
	   );

	-- --- 3 Mettre en file le palier dû, UN SEUL par passage — §12.5 ----------------------------
	for v_inscription in
		select e.*
		  from public.card_sequence_enrollments e
		 where e.status = 'active'
		 order by e.armed_at
	loop
		-- LE PALIER DÛ : celui qui suit immédiatement le dernier expédié, et dont le délai — compté
		-- DEPUIS LE PALIER PRÉCÉDENT, ou depuis l'armement pour le premier (§11.4) — est écoulé.
		--
		-- L'unité est `interval '1 day'` et non le `floor` sur 86 400 secondes du §2.5 de
		-- `docs/SPEC-relances.md` : là-bas il s'agit de compter des jours RÉVOLUS pour les comparer
		-- à un seuil affiché ; ici, d'AJOUTER un délai à un instant. `interval` respecte les
		-- changements d'heure, ce qu'une arithmétique en secondes ne fait pas.
		select st.* into v_palier
		  from public.mail_sequence_steps st
		 where st.sequence_id = v_inscription.sequence_id
		   and st.position    = coalesce(v_inscription.last_position, 0) + 1
		   and now() >= coalesce(v_inscription.last_sent_at, v_inscription.armed_at)
		               + (st.delai_jours * interval '1 day');

		-- UN SEUL PALIER PAR PASSAGE (§12.5) : un job resté arrêté trois jours ne doit pas déverser
		-- trois messages d'un coup chez le destinataire. La cadence GLISSE — le palier suivant se
		-- compte depuis l'envoi RÉEL —, conséquence directe du délai relatif.
		continue when v_palier.id is null;

		-- `CRM-157` (docs/SPEC-mail-subsystem.md §33.2 bis, décision 955) : UN ESPACE SANS DOMAINE FERME L'INSCRIPTION.
		-- L'adresse de l'affaire ne se compose pas : `array[null]` a une longueur de 1, `mail_outbox_destinataire` le
		-- laissait passer, et la relance partait avec un destinataire nul. Rien n'est mis en file ; la fiche dit pourquoi.
		if (select w.inbound_domain
		      from public.cards c join public.workspaces w on w.id = c.workspace_id
		     where c.id = v_inscription.card_id) is null then
			update public.card_sequence_enrollments
			   set status        = 'closed',
			       closed_reason = 'workspace_reply_domain_missing',
			       closed_at     = now()
			 where id = v_inscription.id;
			continue;
		end if;

		select * into v_identite
		  from public.mail_outbound_identities i
		 where i.id = v_inscription.identity_id;

		-- LE CORPS EST COMPOSÉ PAR `public.rendre_modele_email`, JAMAIS RECOPIÉ. Elle est
		-- `SECURITY INVOKER` (mesuré, `prosecdef=false`) et `postgres` porte `rolbypassrls` : sous
		-- le job elle rend donc l'ensemble global, exactement comme `cards_figees()`. Le
		-- `p_identity_id` passé est celui de l'INSCRIPTION, de sorte que les variables
		-- d'expéditeur du §8.5 soient celles de l'adresse qui expédie réellement.
		--
		-- `CRM-111` T6.2 : les variables d'affaire sont celles du RATTACHEMENT INSCRIT (§15.3 de
		-- `docs/SPEC-modeles-emails.md`) — son étape, son channel, son montant, sa prochaine action.
		select r.subject, r.body_text into v_rendu
		  from public.rendre_modele_email(
		         v_palier.template_id, v_inscription.card_id, null, v_inscription.identity_id,
		         v_inscription.placement_id) r;

		-- LE DESTINATAIRE EST L'ADRESSE DE L'AFFAIRE. Le sous-système la garantit non nulle : le
		-- refus (g) de l'armement l'a exigée, et `queue_outbound_email` l'exige aussi. Si elle a
		-- disparu depuis, le passage ÉCHOUE plutôt que d'expédier dans le vide — aucun `try/catch`
		-- vide, aucune valeur par défaut trompeuse (`CLAUDE.md` §18).
		perform app.mail_outbox_inserer(
			v_inscription.workspace_id,
			v_inscription.identity_id,
			v_inscription.card_id,
			null,
			array[(select c.email_local_part || '@' || w.inbound_domain
			         from public.cards c join public.workspaces w on w.id = c.workspace_id
			        where c.id = v_inscription.card_id)],
			'{}'::text[],
			v_rendu.subject,
			v_rendu.body_text,
			v_identite.signature_text,
			-- L'ACTEUR EST NUL (§9.5) : une relance automatique n'a pas d'auteur humain.
			null);

		update public.card_sequence_enrollments
		   set last_position = v_palier.position,
		       last_sent_at  = now()
		 where id = v_inscription.id;

		v_mises := v_mises + 1;

		-- --- 4 Fermer si le palier expédié était le dernier — motif `exhausted` -----------------
		select max(st.position) into v_dernier
		  from public.mail_sequence_steps st
		 where st.sequence_id = v_inscription.sequence_id;

		if v_palier.position >= v_dernier then
			update public.card_sequence_enrollments
			   set status        = 'closed',
			       closed_reason = 'exhausted',
			       closed_at     = now()
			 where id = v_inscription.id;
		end if;
	end loop;

	-- --- 5 Promotion de la cadence d'amorçage vers la cadence nominale -------------------------
	-- Démarrage observable du §3 de `docs/SPEC-scheduler.md`, repris tel quel. Un job QUOTIDIEN
	-- serait autrement invérifiable : une preuve froide attendrait jusqu'à vingt-quatre heures.
	--
	-- Mises en file et promotion sont dans la MÊME transaction : si `cron.alter_job` échoue, les
	-- messages de ce passage sont annulés et `cron.job_run_details` le dit.
	select jobid
	  into v_job_id
	  from cron.job
	 where jobname = 'p2enjoy-sequences-relance'
	   and username = 'postgres';

	if v_job_id is null then
		raise exception 'sequences_job_absent';
	end if;

	perform cron.alter_job(v_job_id, schedule => '41 3 * * *', database => 'postgres', active => true);

	return v_mises;
end;
$function$;

revoke all on function app.executer_sequences_relance() from public, anon, authenticated, service_role;
