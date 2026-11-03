-- @spec CRM-111 (docs/BACKLOG.md) — tranche T6.2 : le rendu d'un modèle par rattachement (décisions 657, arbitrage 3, et
--       821). docs/SPEC-modeles-emails.md §15.2 (contrat révisé de `rendre_modele_email`), §15.3 (la relance rend avec
--       le rattachement de son inscription), §8.3 et §8.7 (zéro ligne, privilèges) ; docs/SPEC-rattachements.md §7
-- @spec docs/SCHEMA.md « Migration `0158` », §9 (fonctions et RPC) ; docs/PROD_MIGRATIONS.md §3 (migration 158)
--
-- AUCUNE TABLE, AUCUNE COLONNE. Deux fonctions changent :
-- - `public.rendre_modele_email` reçoit `p_placement_id` (défaut nul : le plus ancien rattachement lisible, le
--   comportement de la 0109). LA FORME À QUATRE PARAMÈTRES EST SUPPRIMÉE, NON SURCHARGÉE (patron de la décision 661) :
--   deux formes dont l'une prolonge l'autre par un défaut rendraient tout appel à quatre arguments ambigu. Le corps est
--   repris de la 0109, la seule jointure du rattachement changée ;
-- - `app.executer_sequences_relance` passe le rattachement de l'inscription. Sa définition est reprise de la base
--   (identique à la 0119, vérifié par `pg_get_functiondef`), ce seul appel changé.
--
-- IDEMPOTENCE : `drop function if exists` de la forme à quatre paramètres, `create or replace`, `revoke` / `grant`
-- nominatifs.
--
-- RETOUR ARRIÈRE (docs/PROD_MIGRATIONS.md) : supprimer la forme à cinq paramètres, réappliquer `rendre_modele_email`
-- de la 0109 avec ses privilèges de la 0056, et `app.executer_sequences_relance` de la 0119 ; la webapp d'avant.

drop function if exists public.rendre_modele_email(uuid, uuid, uuid, uuid);

-- --- 1 Le rendu par rattachement -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rendre_modele_email(p_template_id uuid, p_card_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_identity_id uuid DEFAULT NULL::uuid, p_placement_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(subject text, body_text text, variables_nulles text[])
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
	with modele as (
		select m.subject, m.body_text
		  from public.mail_templates m
		 where m.id = p_template_id
	),
	affaire as (
		-- LES JOINTURES SONT INTERNES POUR LE CHANNEL ET L'ÉTAPE, ET EXTERNES POUR LE RESTE. Le
		-- channel et l'étape d'une card sont `not null` en base, et une card lisible dont le
		-- channel ne le serait pas rendrait un rendu amputé sans le dire. La RLS des deux tables
		-- dérive du même droit de lecture que celle de `cards`, si bien qu'une jointure interne
		-- ne retranche rien en pratique — et là où elle retrancherait, l'absence de ligne est
		-- préférable à un rendu partiel silencieux.
		select c.title,
		       pl.amount,
		       c.currency,
		       pl.next_action,
		       pl.next_action_at,
		       coalesce(ws.label_override, cat.label) as etape,
		       ch.name                                as channel
		  from public.cards c
		-- `CRM-111` T6.2 (§15.2) : le rattachement DÉSIGNÉ, s'il appartient à l'affaire et que l'appelant
		-- le lit ; à défaut de désignation, le plus ancien lisible. Un rattachement d'une autre affaire,
		-- inconnu ou masqué ne trouve aucune ligne : la jointure interne rend ZÉRO LIGNE, comme une
		-- affaire illisible (§8.3).
		  join lateral (select pl.channel_id, pl.current_step_id, pl.amount, pl.next_action, pl.next_action_at
		                  from public.card_placements pl
		                 where pl.card_id = c.id
		                   and (p_placement_id is null or pl.id = p_placement_id)
		                 order by pl.created_at, pl.id
		                 limit 1) pl on true
		  join public.channels             ch  on ch.id  = pl.channel_id
		  join public.workflow_steps       ws  on ws.id  = pl.current_step_id
		  join public.workflow_nodes_catalog cat on cat.id = ws.node_id
		 where c.id = p_card_id
	),
	personne as (
		select ct.full_name, ct.email, o.name as organisation
		  from public.contacts ct
		  left join public.organizations o on o.id = ct.organization_id
		 where ct.id = p_contact_id
	),
	expediteur as (
		select i.from_name, i.from_address
		  from public.mail_outbound_identities i
		 where i.id = p_identity_id
	),
	-- LA CARTE DES VALEURS EST LA SOURCE UNIQUE DES DEUX RÉSULTATS : la substitution la lit, et
	-- l'inventaire des trous nuls la lit aussi. En construire deux garantirait qu'un jour l'une
	-- dise « vide » là où l'autre dit « rempli ».
	--
	-- `jsonb_build_object` conserve les valeurs NULLES, que `->>` rend alors nulles : c'est ce qui
	-- permet de distinguer « la variable existe et vaut null » de « la variable n'existe pas », et
	-- les DEUX rendent la chaîne vide à la substitution (§8.4).
	valeurs as (
		select jsonb_build_object(
			'card.title',           a.title,
			'card.amount',          to_char(a.amount, 'FM999999999990.00'),
			'card.currency',        a.currency,
			'card.next_action',     a.next_action,
			'card.next_action_at',  to_char(a.next_action_at at time zone 'UTC', 'DD/MM/YYYY HH24:MI'),
			'card.step',            a.etape,
			'card.channel',         a.channel,
			'contact.full_name',    p.full_name,
			'contact.email',        p.email,
			'contact.organization', p.organisation,
			'identity.from_name',   e.from_name,
			'identity.from_address', e.from_address
		) as carte
		  from affaire a
		  left join personne   p on true
		  left join expediteur e on true
	)
	select
		app.mail_template_substituer(m.subject,   v.carte) as subject,
		app.mail_template_substituer(m.body_text, v.carte) as body_text,
		-- L'INVENTAIRE DES TROUS NULS — trié, dédoublonné, et BORNÉ AUX VARIABLES QUE LE MODÈLE
		-- EMPLOIE RÉELLEMENT (§8.4). Une variable que le modèle n'emploie pas n'est pas un trou :
		-- l'y faire figurer donnerait à lire une liste d'absences sans objet, et la sous-tranche 2b
		-- afficherait un avertissement pour un texte qui n'en porte pas la trace.
		--
		-- Les trous du modèle sont relus par le MÊME motif que la substitution : un nom qui ne
		-- serait pas découpé pareillement ici ferait mentir l'inventaire sur le texte rendu.
		coalesce(
			(
				select array_agg(distinct nom order by nom)
				  from (
					select btrim(trou[1]) as nom
					  from regexp_matches(m.subject || ' ' || m.body_text,
					                      '\{\{([^{}]*)\}\}', 'g') as trou
				  ) as trous
				 where v.carte ->> nom is null
			),
			array[]::text[]
		) as variables_nulles
	  from modele m
	 cross join valeurs v;
$function$;

alter function public.rendre_modele_email(uuid, uuid, uuid, uuid, uuid) owner to postgres;

comment on function public.rendre_modele_email(uuid, uuid, uuid, uuid, uuid) is
	'CRM-063, CRM-111 T6.2 — docs/SPEC-modeles-emails.md §8.3, §15.2. Rend l''objet et le corps d''un modèle appliqués '
	'à une affaire et à l''un de ses rattachements (le plus ancien lisible à défaut), avec l''inventaire des trous dont '
	'la source est nulle. SECURITY INVOKER : un objet non lisible rend ZÉRO LIGNE, jamais une erreur.';

-- Privilèges de la 0056 (§8.7) : `authenticated` et `service_role`, jamais `anon`.
revoke all on function public.rendre_modele_email(uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.rendre_modele_email(uuid, uuid, uuid, uuid, uuid) to authenticated, service_role;

-- --- 2 La relance rend avec le rattachement de son inscription --------------------------------------------------------
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
