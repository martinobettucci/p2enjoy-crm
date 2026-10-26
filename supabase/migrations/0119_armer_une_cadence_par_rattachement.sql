-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.3.5 : armer une cadence sur un rattachement (décision 705).
--       docs/SPEC-rattachements.md §5 (« Armer une cadence : `armer_sequence_relance(p_placement, p_sequence_id,
--       p_identity_id)` — signature remplacée ; l'inscription désigne le rattachement »), §7 (« une affaire peut avoir une
--       cadence par rattachement »), §14 ; docs/SPEC-relances.md §12.2 et §12.4 (les huit refus et leur ordre) ;
--       docs/JOURNAL.md décisions 657 (arbitrage 2), 661, 705
-- @spec docs/SCHEMA.md « Migration `0119` », §9 (fonctions et RPC) ; docs/PROD_MIGRATIONS.md §3
--
-- LA SIGNATURE EST REMPLACÉE, NON SURCHARGÉE (décision 661) : `armer_sequence_relance(p_placement, …)` désigne le
-- rattachement ; la forme par affaire est supprimée. Les huit refus de `CRM-063` (migration 0060), leur ordre, leurs
-- codes et leurs messages sont repris au mot près ; ceux qui portaient sur l'affaire portent sur le rattachement :
-- l'écriture (b) sur son channel, le figement (f) sur SA ligne de `cards_figees()` (une ligne par rattachement, T2.2),
-- l'unicité (h) sur lui. L'adresse (g) reste celle de l'AFFAIRE : elle est unique pour l'affaire (§7). L'inscription
-- porte le rattachement en clair, sans s'en remettre au déclencheur de remplissage de T2.2.
--
-- L'EXÉCUTEUR FERME LA CADENCE D'UN RATTACHEMENT QUI N'EST PLUS FIGÉ : `app.executer_sequences_relance` jugeait
-- l'inéligibilité par l'affaire ; il la juge par le rattachement inscrit. Sa définition est reprise de la base, ce seul
-- prédicat changé.
--
-- UNE CADENCE ACTIVE PAR RATTACHEMENT (§7) : l'index partiel `card_sequence_enrollments_active_unique` garde son nom et
-- passe de `card_id` à `placement_id`. Tant qu'une affaire n'a qu'un rattachement (index de la 0108), c'est la même
-- règle.
--
-- HORS DE CETTE MIGRATION, ET DIT : « le rattachement donne son responsable comme expéditeur par défaut » (§7, décision
-- 657) n'a pas de forme arrêtée — l'identité reste un paramètre exigé (§5) ; consigné par INC-315.
--
-- IDEMPOTENCE : `drop function if exists` de la forme par affaire, `create or replace`, index recréé s'il diffère.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : supprimer la fonction, réappliquer celle de la migration 0060 et son index
-- sur `card_id`, avec la webapp d'avant.

drop function if exists public.armer_sequence_relance(uuid, uuid, uuid);

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
	select * into v_identite
	  from public.mail_outbound_identities i
	 where i.id = p_identity_id
	   and (
	     i.owner_id = v_appelant
	     or (i.owner_id is null and app.is_workspace_admin(i.workspace_id))
	   );
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

revoke all on function public.armer_sequence_relance(uuid, uuid, uuid) from public, anon;
grant execute on function public.armer_sequence_relance(uuid, uuid, uuid) to authenticated, service_role;

-- Une cadence active par RATTACHEMENT (§7). Recréé seulement s'il porte encore sur `card_id` : un rejeu ne fait rien.
do $$
begin
	if exists (
		select 1 from pg_index x
		  join pg_attribute a on a.attrelid = x.indrelid and a.attnum = x.indkey[0]
		 where x.indexrelid = 'public.card_sequence_enrollments_active_unique'::regclass
		   and a.attname = 'card_id'
	) then
		drop index public.card_sequence_enrollments_active_unique;
		create unique index card_sequence_enrollments_active_unique
			on public.card_sequence_enrollments (placement_id)
			where status = 'active';
	end if;
end;
$$;

comment on index public.card_sequence_enrollments_active_unique is
	'CRM-063 §12.2, CRM-111 T2.3.5 — UNE seule inscription active par RATTACHEMENT (docs/SPEC-rattachements.md §7). '
	'Partiel : l''histoire d''un rattachement peut compter autant d''inscriptions fermées qu''il a connu de cadences.';

-- --- L'exécuteur des cadences : l'inéligibilité par rattachement -----------------------------------------------------
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

		select * into v_identite
		  from public.mail_outbound_identities i
		 where i.id = v_inscription.identity_id;

		-- LE CORPS EST COMPOSÉ PAR `public.rendre_modele_email`, JAMAIS RECOPIÉ. Elle est
		-- `SECURITY INVOKER` (mesuré, `prosecdef=false`) et `postgres` porte `rolbypassrls` : sous
		-- le job elle rend donc l'ensemble global, exactement comme `cards_figees()`. Le
		-- `p_identity_id` passé est celui de l'INSCRIPTION, de sorte que les variables
		-- d'expéditeur du §8.5 soient celles de l'adresse qui expédie réellement.
		select r.subject, r.body_text into v_rendu
		  from public.rendre_modele_email(
		         v_palier.template_id, v_inscription.card_id, null, v_inscription.identity_id) r;

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
