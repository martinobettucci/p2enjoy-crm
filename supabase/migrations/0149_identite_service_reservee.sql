-- @spec INC-335 (docs/BACKLOG.md, « Correctif arbitré le 2026-11-01 — INC-335 (décision 805) », tranche T1) — l'identité
--       de service ne s'emprunte plus, ni pour un envoi, ni pour une cadence
-- @spec docs/SPEC-mail-subsystem.md §14.2 (ce que « par défaut » veut dire), §19.4 (`identity_not_available`) ;
--       docs/SPEC-modeles-emails.md §12.4 (refus e), §12.7 (la cinquième fin, `identity_withdrawn`) ;
--       docs/SCHEMA.md (« Migration `0149` », `card_sequence_enrollments.closed_reason`) ; docs/JOURNAL.md décision 805 ;
--       docs/PROD_MIGRATIONS.md
--
-- L'IDENTITÉ DE SERVICE NE SERT QU'AUX ENVOIS AUTOMATIQUES (décision 805). Le digest quotidien la prend par
-- `app.envoyer_digests`, qui insère sans passer par la règle d'emprunt : il n'est pas touché. La règle d'emprunt des deux
-- portes humaines, `queue_outbound_email` et `armer_sequence_relance`, devient « la sienne, et elle seule » ;
-- l'identité de service y rend `identity_not_available` (42501), administrateur compris.
--
-- LES DÉFINITIONS CI-DESSOUS SONT CELLES EN VIGUEUR (`queue_outbound_email` de la 0109, `armer_sequence_relance` de la
-- 0119), reprises à l'identique : seul le prédicat d'emprunt change. `create or replace` garde propriétaire et
-- privilèges.
--
-- LES CADENCES DÉJÀ ARMÉES AVEC L'IDENTITÉ DE SERVICE SONT FERMÉES, sous un cinquième motif, `identity_withdrawn`. Pas
-- `manual` : il affirmerait un geste humain qui n'a pas eu lieu (CLAUDE.md §8). Rien d'autre n'écrit ce motif.
--
-- IDEMPOTENCE : `create or replace` ; la contrainte n'est recréée que si elle ignore le motif ; la fermeture ne touche
-- que des inscriptions actives, si bien qu'un rejeu n'écrit rien.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : réappliquer les deux fonctions de la 0109 et de la 0119. Les inscriptions
-- fermées ne sont pas rouvertes (une inscription fermée ne l'est jamais, docs/SPEC-modeles-emails.md §12.7) : on les
-- réarme. La contrainte élargie peut rester ; la resserrer exige qu'aucune ligne ne porte `identity_withdrawn`.

-- =============================================================================================
-- 1. Le motif de fermeture — docs/SPEC-modeles-emails.md §12.7
-- =============================================================================================

do $$
begin
	if not exists (
		select 1 from pg_constraint c
		 where c.conrelid = 'public.card_sequence_enrollments'::regclass
		   and c.conname = 'card_sequence_enrollments_motif_borne'
		   and pg_get_constraintdef(c.oid) like '%identity_withdrawn%'
	) then
		alter table public.card_sequence_enrollments drop constraint if exists card_sequence_enrollments_motif_borne;
		alter table public.card_sequence_enrollments add constraint card_sequence_enrollments_motif_borne
			check (closed_reason is null
			       or closed_reason in ('reply', 'card_ineligible', 'manual', 'exhausted', 'identity_withdrawn'));
	end if;
end;
$$;

-- =============================================================================================
-- 2. L'envoi — docs/SPEC-mail-subsystem.md §19.4
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

-- =============================================================================================
-- 3. L'armement d'une cadence — docs/SPEC-modeles-emails.md §12.4, refus (e)
-- =============================================================================================

create or replace function public.armer_sequence_relance(
	p_placement   uuid,
	p_sequence_id uuid,
	p_identity_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

-- =============================================================================================
-- 4. Les cadences déjà armées avec l'identité de service — décision 805
-- =============================================================================================

update public.card_sequence_enrollments e
   set status        = 'closed',
       closed_reason = 'identity_withdrawn',
       closed_at     = now()
  from public.mail_outbound_identities i
 where i.id = e.identity_id
   and i.owner_id is null
   and e.status = 'active';
