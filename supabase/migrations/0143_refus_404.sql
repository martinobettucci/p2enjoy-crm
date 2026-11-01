-- @spec CRM-120 (docs/BACKLOG.md) — tranche T2 : les refus « introuvable » rendent HTTP 404 — la fonction qui lève, et les
--       vingt-huit fonctions qui levaient `P0002`, réécrites à l'identique hormis leur levée
-- @spec docs/SPEC-refus-404.md §2 (la forme), §3 (l'inventaire), §4 ; docs/JOURNAL.md décisions 762 et 797
--
-- PostgREST rend 500 pour `P0002`. La forme `PGRST` rend le statut voulu en laissant le corps inchangé : code `P0002` et
-- message, que la webapp et le connecteur lisent (mesuré sur PostgREST 14.12, docs/SPEC-refus-404.md §2).
--
-- LES DÉFINITIONS CI-DESSOUS SONT CELLES EN VIGUEUR, relues dans `pg_proc` (`pg_get_functiondef`) : seule chaque
-- `raise exception '<message>' using errcode = 'P0002'` y devient `perform app.raise_http_error(<statut>, '<message>')`,
-- 404 partout, 409 pour `outbox_not_reschedulable` (décision 797). `create or replace` garde propriétaire et privilèges.
--
-- IDEMPOTENCE : `create or replace` partout.

-- =============================================================================================
-- 1. La fonction qui lève — §2
-- =============================================================================================

create or replace function app.raise_http_error(p_status integer, p_message text)
returns void
language plpgsql
set search_path = ''
as $$
begin
	raise sqlstate 'PGRST'
		using message = pg_catalog.jsonb_build_object('code', 'P0002', 'message', p_message)::text,
		      detail = pg_catalog.jsonb_build_object('status', p_status, 'headers', '{}'::jsonb)::text;
end;
$$;

comment on function app.raise_http_error(integer, text) is
	'CRM-120 (0143) : lève un refus que PostgREST rend avec ce statut, le corps gardant le code P0002 et le message.';

-- Sept fonctions de l'inventaire s'exécutent avec les droits de l'appelant : `authenticated` doit pouvoir lever.
revoke all on function app.raise_http_error(integer, text) from public;
grant execute on function app.raise_http_error(integer, text) to authenticated, service_role;

-- =============================================================================================
-- 2. Les vingt-huit fonctions — §3
-- =============================================================================================

CREATE OR REPLACE FUNCTION app.audit_export(p_workspace uuid, p_entity_type text, p_count integer, p_details jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	if p_entity_type not in ('card_list', 'contact_list') then
		raise exception 'export_entity_unknown' using errcode = '22023';
	end if;
	-- Un appelant ne journalise que dans un espace dont il est membre : le journal reste celui de ses propres gestes.
	if not app.is_workspace_member(p_workspace) then
		perform app.raise_http_error(404, 'workspace_not_found');
	end if;
	perform app.audit_record(p_workspace, 'exported', p_entity_type, null, null,
	                         coalesce(p_details, '{}'::jsonb) || pg_catalog.jsonb_build_object('count', p_count));
end;
$function$
;
CREATE OR REPLACE FUNCTION app.audit_import(p_workspace uuid, p_entity_type text, p_details jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	if p_entity_type not in ('contact', 'card') then
		raise exception 'import_entity_unknown' using errcode = '22023';
	end if;
	if not app.is_workspace_member(p_workspace) then
		perform app.raise_http_error(404, 'workspace_not_found');
	end if;
	perform app.audit_record(p_workspace, 'imported', p_entity_type, null, null, coalesce(p_details, '{}'::jsonb));
end;
$function$
;
CREATE OR REPLACE FUNCTION app.contact_rgpd_guard(p_contact uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	espace uuid;
begin
	select c.workspace_id into espace from public.contacts c where c.id = p_contact;
	if espace is null or not app.is_workspace_member(espace) then
		perform app.raise_http_error(404, 'contact_not_found');
	end if;
	if not app.is_workspace_admin(espace) then
		raise exception 'reserved_to_admins' using errcode = '42501';
	end if;
	return espace;
end;
$function$
;
CREATE OR REPLACE FUNCTION app.plateforme_espace_existe(p_ws uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	if p_ws is null or not exists (select 1 from public.workspaces w where w.id = p_ws) then
		perform app.raise_http_error(404, 'espace_introuvable');
	end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION app.trash_track_guard(p_track uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	espace uuid;
begin
	select t.workspace_id into espace from public.tracks t where t.id = p_track;
	if espace is null or not app.is_workspace_member(espace) then
		perform app.raise_http_error(404, 'track_not_found');
	end if;
	if not app.is_workspace_admin(espace) then
		raise exception 'reserved_to_admins' using errcode = '42501';
	end if;
	return espace;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.classer_message_automatiquement(p_message_id uuid, p_in_reply_to text DEFAULT NULL::text, p_references text[] DEFAULT NULL::text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_message         public.mail_messages%rowtype;
	v_card            uuid;
	v_cards_suggerees uuid[];
	v_suggestion      uuid;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		perform app.raise_http_error(404, 'message_not_found');
	end if;

	-- Un message DÉJÀ classé n'est pas reclassé : la règle 1 a parlé une fois, et un second
	-- passage de la relève ne doit pas déplacer du courrier.
	if v_message.classification <> 'unclassified' then
		return v_message.card_id;
	end if;

	-- RÈGLE 1 — une adresse de card figure parmi les destinataires.
	v_card := app.card_par_adresse(
		v_message.workspace_id,
		v_message.to_addresses || v_message.cc_addresses
	);

	-- RÈGLE 2 — la filiation, et seulement si la règle 1 n'a rien dit.
	if v_card is null and (p_in_reply_to is not null or p_references is not null) then
		select m.card_id into v_card
		  from public.mail_messages m
		 where m.workspace_id = v_message.workspace_id
		   and m.card_id is not null
		   and m.rfc822_message_id = any (
		         coalesce(p_references, array[]::text[]) ||
		         case when p_in_reply_to is null then array[]::text[] else array[p_in_reply_to] end
		       )
		 order by m.received_at desc
		 limit 1;

		-- La card du parent peut avoir été archivée depuis : la règle 2 hérite alors du refus de
		-- la règle 1, faute de quoi la filiation contournerait la règle du §16.2.
		if v_card is not null and not exists (
			select 1 from public.cards c
			 where c.id = v_card and app.card_has_active_placement(c.id) and c.deleted_at is null
		) then
			v_card := null;
		end if;
	end if;

	-- RÈGLE 3 — l'expéditeur est un contact rattaché à EXACTEMENT UNE card active : on SUGGÈRE, on
	-- ne classe pas. Atteinte seulement quand les règles 1 et 2 sont muettes. L'unicité partielle
	-- (workspace_id, lower(email)) de `contacts` garantit AU PLUS un contact par email ; l'ambiguïté
	-- à trancher est donc du côté des CARDS. Une card archivée ou en corbeille ne compte pas, comme
	-- la règle 1 refuse de classer dans une card rangée (§16.2, docs/SPEC-contacts.md §8.2).
	if v_card is null then
		select array_agg(distinct cc.card_id)
		  into v_cards_suggerees
		  from public.contacts ct
		  join public.card_contacts cc
		    on cc.contact_id = ct.id and cc.workspace_id = ct.workspace_id
		  join public.cards c
		    on c.id = cc.card_id and c.workspace_id = cc.workspace_id
		 where ct.workspace_id = v_message.workspace_id
		   and ct.email is not null
		   and lower(ct.email) = lower(btrim(v_message.from_address))
		   and app.card_has_active_placement(c.id)
		   and c.deleted_at is null;

		-- EXACTEMENT une : zéro n'invente rien, deux ou plus se tait plutôt que de choisir au
		-- hasard. On écrit la suggestion calculée — ou on l'efface —, de sorte qu'un second passage
		-- de la relève rende un résultat déterministe (docs/SPEC-contacts.md §8.3).
		if v_cards_suggerees is not null and array_length(v_cards_suggerees, 1) = 1 then
			v_suggestion := v_cards_suggerees[1];
		else
			v_suggestion := null;
		end if;

		update public.mail_messages m
		   set suggested_card_id = v_suggestion,
		       suggested_at = case when v_suggestion is null then null else now() end
		 where m.id = p_message_id;

		-- RÈGLE 4 — la règle 3 ne classe pas : le message reste non classé. Ce n'est pas une erreur.
		return null;
	end if;

	update public.mail_messages m
	   set card_id = v_card,
	       classification = 'auto',
	       classified_at = now()
	 where m.id = p_message_id;

	perform app.card_event_ecrire(
		v_card,
		v_message.workspace_id,
		'mail_received',
		jsonb_build_object('message_id', p_message_id, 'rule', 'auto')
	);

	-- Les pièces jointes suivent leur message : `card_id` y est recopié pour un accès direct
	-- depuis la card (docs/SCHEMA.md §12).
	update public.mail_attachments a set card_id = v_card where a.message_id = p_message_id;

	return v_card;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.classify_message(p_message_id uuid, p_card_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_message public.mail_messages%rowtype;
	v_appelant uuid := (select auth.uid());
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		perform app.raise_http_error(404, 'message_not_found');
	end if;

	-- LE PREMIER DES DEUX DROITS — voir le message (CRM-057 §18.2).
	if not app.peut_voir_message(p_message_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- LE SECOND — classer un message ajoute du contenu à la card : le droit d'ÉCRITURE est exigé,
	-- non celui de lecture. C'est la même règle que pour un commentaire (docs/SPEC-cards.md §13.6).
	if not app.can_write_card(p_card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	if not exists (
		select 1 from public.cards c
		 where c.id = p_card_id
		   and c.workspace_id = v_message.workspace_id
		   and app.card_has_active_placement(c.id)
		   and c.deleted_at is null
	) then
		raise exception 'card_not_available' using errcode = '23514';
	end if;

	-- IDEMPOTENT : reclasser dans la MÊME card ne produit pas un second événement. Un utilisateur
	-- qui clique deux fois ne raconte pas deux histoires.
	if v_message.card_id = p_card_id then
		return p_card_id;
	end if;

	update public.mail_messages m
	   set card_id = p_card_id,
	       classification = 'manual',
	       classified_by = v_appelant,
	       classified_at = now()
	 where m.id = p_message_id;

	perform app.card_event_ecrire(
		p_card_id,
		v_message.workspace_id,
		'mail_received',
		jsonb_build_object('message_id', p_message_id, 'rule', 'manual')
	);

	update public.mail_attachments a set card_id = p_card_id where a.message_id = p_message_id;

	return p_card_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.creer_affaire(p_channel uuid, p_titre text, p_template uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	appelant   uuid := auth.uid();
	le_channel record;
	l_etape    uuid;
	l_affaire  uuid;
	le_modele  public.card_templates%rowtype;
	le_rattachement uuid;
	v_cle      text;
	v_valeur   jsonb;
	v_rang     integer := 0;
	v_point    jsonb;
begin
	-- 1. Appelant authentifié. L'anonyme est déjà refusé par le privilège (401) ; ce contrôle tient
	--    les appels qui ne passeraient pas par PostgREST.
	if appelant is null then
		raise exception 'authentification requise'
			using errcode = '42501';
	end if;

	-- 2. Le channel, lu sous la RLS de l'appelant : illisible et inexistant se confondent.
	select c.id, c.workspace_id, c.workflow_id, c.archived_at, c.deleted_at
	  into le_channel
	  from public.channels c
	 where c.id = p_channel;
	if not found then
		perform app.raise_http_error(404, 'channel introuvable');
	end if;

	-- 3. Un channel archivé ou à la corbeille ne reçoit plus d'affaire.
	if le_channel.archived_at is not null or le_channel.deleted_at is not null then
		raise exception 'channel ferme'
			using errcode = 'P0001',
			      detail  = 'le channel est archive ou a la corbeille';
	end if;

	-- 3 bis. `CRM-068` T4a — le modèle, lu sous la RLS : un modèle illisible, archivé ou inexistant se confondent ; un
	--        modèle d'un autre workflow que celui du channel est refusé (§3.6).
	if p_template is not null then
		select t.* into le_modele
		  from public.card_templates t
		 where t.id = p_template and t.archived_at is null;
		if not found then
			perform app.raise_http_error(404, 'template_not_found');
		end if;
		if le_modele.workflow_id <> le_channel.workflow_id then
			raise exception 'template_workflow_mismatch'
				using errcode = '22023';
		end if;
	end if;

	-- 4. L'étape d'entrée est l'étape INITIALE du workflow du channel.
	select s.id into l_etape
	  from public.workflow_steps s
	 where s.workflow_id = le_channel.workflow_id
	   and s.is_initial
	 order by s.position
	 limit 1;
	if l_etape is null then
		raise exception 'aucune etape initiale'
			using errcode = 'P0001',
			      detail  = 'designer l''etape initiale du workflow dans l''editeur';
	end if;

	-- 5. L'affaire, puis son premier rattachement (`CRM-111` T2.4.5, décision 768). Un titre blanc est refusé par la
	--    contrainte existante (`23514`) ; un channel que l'appelant ne peut pas écrire, par
	--    `app.poser_premier_rattachement` (`42501`), le refus que donnait `cards_insertion`.
	--    L'identifiant est tiré AVANT l'insertion : un `returning` relirait l'affaire sous la politique de lecture, qui ne
	--    la rend qu'une fois son rattachement posé.
	l_affaire := gen_random_uuid();
	insert into public.cards (id, workspace_id, title, created_by)
	values (l_affaire, le_channel.workspace_id, btrim(p_titre), appelant);
	le_rattachement := app.poser_premier_rattachement(l_affaire, le_channel.id, l_etape);

	-- 6. `CRM-068` T4a — LE MODÈLE EST APPLIQUÉ DANS LA MÊME TRANSACTION, PAR LES MÊMES ÉCRITURES QU'À L'ÉCRAN, sous la RLS
	--    de l'appelant : description et devise sur l'affaire, montant sur son rattachement, valeurs de champ sur le
	--    rattachement (le déclencheur de `card_field_values` les valide encore), points libres sur l'affaire. Une question
	--    archivée depuis l'écriture du modèle est ignorée : elle ne serait demandée nulle part.
	if p_template is not null then
		update public.cards
		   set description = coalesce(le_modele.description, description),
		       currency    = le_modele.currency
		 where id = l_affaire;

		if le_modele.amount is not null then
			update public.card_placements set amount = le_modele.amount where id = le_rattachement;
		end if;

		for v_cle, v_valeur in select key, value from jsonb_each(le_modele.field_values) loop
			insert into public.card_field_values (card_id, placement_id, field_id, workflow_id, workspace_id, value)
			select l_affaire, le_rattachement, f.id, f.workflow_id, f.workspace_id, v_valeur
			  from public.form_fields f
			 where f.workflow_id = le_channel.workflow_id and f.key = v_cle and f.archived_at is null;
		end loop;

		for v_point in select value from jsonb_array_elements(le_modele.checklist) loop
			v_rang := v_rang + 1;
			insert into public.card_checklist_items (workspace_id, card_id, label, position)
			values (le_channel.workspace_id, l_affaire, v_point #>> '{}', v_rang);
		end loop;
	end if;

	return l_affaire;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.export_cards(p_channel uuid, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(card_id uuid, title text, labels text, owner_name text, step_label text, amount numeric, currency text, next_action text, next_action_at timestamp with time zone, track_slug text, channel_slug text)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	v_espace   uuid;
	v_filtres  jsonb := coalesce(p_filters, '{}'::jsonb);
	v_tri      text;
	v_sens     text;
	v_lignes   jsonb;
	v_nombre   integer;
begin
	if not app.saved_view_filters_valid(v_filtres) then
		raise exception 'invalid_filters' using errcode = '22023';
	end if;
	-- Le channel, lu sous la RLS de la personne : illisible et inexistant se confondent.
	select c.workspace_id into v_espace from public.channels c where c.id = p_channel and c.deleted_at is null;
	if v_espace is null then
		perform app.raise_http_error(404, 'channel_not_found');
	end if;
	v_tri := coalesce(v_filtres ->> 'sort', 'title');
	v_sens := coalesce(v_filtres ->> 'direction',
	                   case v_tri when 'amount' then 'desc' when 'created_at' then 'desc' else 'asc' end);

	-- Les lignes, dans l'ordre de la vue liste, rassemblées une fois : le plafond se compte avant tout journal.
	select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) - 'rang' order by x.rang), '[]'::jsonb)
	  into v_lignes
	  from (
	select a.id as card_id, a.title,
	       (select pg_catalog.string_agg(l.name, ', ' order by pg_catalog.lower(l.name), l.id)
	          from public.card_labels cl join public.labels l on l.id = cl.label_id
	         where cl.card_id = a.id) as labels,
	       pr.full_name as owner_name, n.label as step_label, p.amount, a.currency, p.next_action, p.next_action_at,
	       t.slug as track_slug, ch.slug as channel_slug,
	       pg_catalog.row_number() over (
	           order by
	               case when v_tri = 'title' and v_sens = 'asc' then a.title end asc nulls last,
	               case when v_tri = 'title' and v_sens = 'desc' then a.title end desc nulls last,
	               case when v_tri = 'amount' and v_sens = 'asc' then p.amount end asc nulls last,
	               case when v_tri = 'amount' and v_sens = 'desc' then p.amount end desc nulls last,
	               case when v_tri = 'next_action_at' and v_sens = 'asc' then p.next_action_at end asc nulls last,
	               case when v_tri = 'next_action_at' and v_sens = 'desc' then p.next_action_at end desc nulls last,
	               case when v_tri = 'created_at' and v_sens = 'asc' then a.created_at end asc nulls last,
	               case when v_tri = 'created_at' and v_sens = 'desc' then a.created_at end desc nulls last,
	               a.title asc, a.id asc) as rang
	  from public.card_placements p
	  join public.cards a on a.id = p.card_id
	  join public.channels ch on ch.id = p.channel_id
	  join public.tracks t on t.id = ch.track_id
	  left join public.workflow_steps s on s.id = p.current_step_id
	  left join public.workflow_nodes_catalog n on n.id = s.node_id
	  left join public.profiles pr on pr.id = p.owner_id
	 where p.channel_id = p_channel
	   and p.archived_at is null
	   and a.deleted_at is null
	   and (v_filtres ->> 'step_id' is null or p.current_step_id = (v_filtres ->> 'step_id')::uuid)
	   and (v_filtres ->> 'label_id' is null or exists (
	        select 1 from public.card_labels cl where cl.card_id = a.id and cl.label_id = (v_filtres ->> 'label_id')::uuid))
	   and (v_filtres ->> 'search' is null
	        or a.search_tsv @@ pg_catalog.plainto_tsquery('app.francais_sans_accent'::regconfig, v_filtres ->> 'search'))
	   and (v_filtres ->> 'snoozed' = 'shown' or p.snoozed_until is null or p.snoozed_until <= pg_catalog.now())
	  ) x;

	v_nombre := pg_catalog.jsonb_array_length(v_lignes);
	if v_nombre > 5000 then
		raise exception 'export_too_large' using errcode = '22023';
	end if;
	perform app.audit_export(v_espace, 'card_list', v_nombre,
	                         pg_catalog.jsonb_build_object('channel_id', p_channel, 'filters', v_filtres));

	return query
	select r.card_id, r.title, r.labels, r.owner_name, r.step_label, r.amount, r.currency, r.next_action, r.next_action_at,
	       r.track_slug, r.channel_slug
	  from rows from (pg_catalog.jsonb_to_recordset(v_lignes) as (
	       card_id uuid, title text, labels text, owner_name text, step_label text, amount numeric, currency text,
	       next_action text, next_action_at timestamptz, track_slug text, channel_slug text))
	       with ordinality as r(card_id, title, labels, owner_name, step_label, amount, currency, next_action,
	                            next_action_at, track_slug, channel_slug, ordre)
	 order by r.ordre;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.export_contacts(p_workspace uuid)
 RETURNS TABLE(contact_id uuid, full_name text, email text, phone text, role_title text, organization_name text, organization_domain text, created_at timestamp with time zone, anonymized_at timestamp with time zone)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	v_nombre integer;
begin
	-- L'espace, lu sous la RLS de la personne : un espace dont elle n'est pas membre n'existe pas pour elle.
	if not exists (select 1 from public.workspaces w where w.id = p_workspace) then
		perform app.raise_http_error(404, 'workspace_not_found');
	end if;
	select pg_catalog.count(*)::integer into v_nombre from public.contacts c where c.workspace_id = p_workspace;
	if v_nombre > 5000 then
		raise exception 'export_too_large' using errcode = '22023';
	end if;
	perform app.audit_export(p_workspace, 'contact_list', v_nombre, '{}'::jsonb);
	return query
	select c.id, c.full_name, c.email, c.phone, c.role_title, o.name, o.domain, c.created_at, c.anonymized_at
	  from public.contacts c
	  left join public.organizations o on o.id = c.organization_id
	 where c.workspace_id = p_workspace
	 order by pg_catalog.lower(c.full_name), c.id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.import_cards(p_channel uuid, p_rows jsonb, p_dry_run boolean DEFAULT true)
 RETURNS TABLE(line integer, outcome text, code text, card_id uuid)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	v_channel     record;
	v_initiale    uuid;
	v_issues      jsonb := '[]'::jsonb;
	v_ligne       jsonb;
	v_rang        integer := 0;
	v_titre       text;
	v_etape_nom   text;
	v_etape       uuid;
	v_resp_brut   text;
	v_resp        uuid;
	v_montant_brut text;
	v_montant     numeric;
	v_devise      text;
	v_proba_brut  text;
	v_proba       numeric;
	v_action      text;
	v_echeance_brut text;
	v_echeance    timestamptz;
	v_contact_brut text;
	v_contact     uuid;
	v_affaire     uuid;
	v_issue       text;
	v_code        text;
	v_crees       integer := 0;
	v_ignores     integer := 0;
	v_refuses     integer := 0;
begin
	if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
		raise exception 'invalid_rows' using errcode = '22023';
	end if;
	if pg_catalog.jsonb_array_length(p_rows) > 1000 then
		raise exception 'import_too_large' using errcode = '22023';
	end if;
	-- Le channel, lu sous la RLS de la personne : illisible et inexistant se confondent.
	select c.id, c.workspace_id, c.workflow_id, c.archived_at, c.deleted_at into v_channel
	  from public.channels c where c.id = p_channel;
	if not found then
		perform app.raise_http_error(404, 'channel_not_found');
	end if;
	if v_channel.archived_at is not null or v_channel.deleted_at is not null then
		raise exception 'channel_closed' using errcode = 'P0001';
	end if;
	select s.id into v_initiale from public.workflow_steps s
	 where s.workflow_id = v_channel.workflow_id and s.is_initial order by s.position limit 1;

	perform pg_catalog.set_config('app.card_creation_source', 'import', true);
	begin
		for v_ligne in select e.value from pg_catalog.jsonb_array_elements(p_rows) e loop
			v_rang := v_rang + 1;
			v_titre := nullif(pg_catalog.btrim(v_ligne ->> 'title'), '');
			v_etape_nom := nullif(pg_catalog.lower(pg_catalog.btrim(v_ligne ->> 'step')), '');
			v_resp_brut := nullif(pg_catalog.btrim(v_ligne ->> 'owner'), '');
			v_montant_brut := nullif(pg_catalog.btrim(v_ligne ->> 'amount'), '');
			v_devise := nullif(pg_catalog.upper(pg_catalog.btrim(v_ligne ->> 'currency')), '');
			v_proba_brut := nullif(pg_catalog.btrim(v_ligne ->> 'probability'), '');
			v_action := nullif(pg_catalog.btrim(v_ligne ->> 'next_action'), '');
			v_echeance_brut := nullif(pg_catalog.btrim(v_ligne ->> 'next_action_at'), '');
			v_contact_brut := nullif(pg_catalog.lower(pg_catalog.btrim(v_ligne ->> 'contact_email')), '');
			v_etape := v_initiale;
			v_resp := null;
			v_montant := app.import_numeric(v_montant_brut);
			v_proba := app.import_numeric(v_proba_brut);
			v_echeance := app.import_timestamp(v_echeance_brut);
			v_contact := null;
			v_affaire := null;
			v_issue := 'refused';
			v_code := null;
			if v_etape_nom is not null then
				select s.id into v_etape
				  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
				 where s.workflow_id = v_channel.workflow_id
				   and v_etape_nom in (pg_catalog.lower(pg_catalog.btrim(coalesce(s.label_override, n.label))),
				                       pg_catalog.lower(pg_catalog.btrim(n.label)))
				 order by s.position limit 1;
			end if;
			if v_resp_brut is not null then
				v_resp := app.workspace_member_by_contact(v_channel.workspace_id, v_resp_brut);
			end if;
			if v_contact_brut is not null then
				select c.id into v_contact from public.contacts c
				 where c.workspace_id = v_channel.workspace_id and pg_catalog.lower(c.email) = v_contact_brut limit 1;
			end if;

			-- Les refus se nomment dans l'ordre des colonnes de l'écran ; le doublon ne se juge que sur une ligne recevable.
			if v_titre is null then
				v_code := 'title_required';
			elsif v_etape is null then
				v_code := 'unknown_step';
			elsif v_resp_brut is not null and v_resp is null then
				v_code := 'not_a_member';
			elsif v_montant_brut is not null and v_montant is null then
				v_code := 'invalid_amount';
			elsif v_devise is not null and v_devise !~ '^[A-Z]{3}$' then
				v_code := 'invalid_currency';
			elsif v_proba_brut is not null and (v_proba is null or v_proba < 0 or v_proba > 100) then
				v_code := 'invalid_probability';
			elsif v_echeance_brut is not null and v_echeance is null then
				v_code := 'invalid_date';
			elsif v_contact_brut is not null and v_contact is null then
				v_code := 'unknown_contact';
			elsif exists (
			      select 1 from public.card_placements p join public.cards a on a.id = p.card_id
			       where p.channel_id = p_channel and a.deleted_at is null
			         and pg_catalog.lower(pg_catalog.btrim(a.title)) = pg_catalog.lower(v_titre)) then
				v_issue := 'skipped';
				v_code := 'duplicate_title';
			else
				begin
					-- L'identifiant est tiré avant l'insertion, comme dans `creer_affaire` : un `returning` relirait l'affaire
					-- sous la politique de lecture, qui ne la rend qu'une fois son rattachement posé.
					v_affaire := pg_catalog.gen_random_uuid();
					insert into public.cards (id, workspace_id, title, currency, created_by)
					values (v_affaire, v_channel.workspace_id, v_titre, coalesce(v_devise, 'EUR'), auth.uid());
					perform app.place_imported_card(v_affaire, p_channel, v_etape, v_resp, v_montant, v_proba, v_action,
					                                v_echeance);
					if v_contact is not null then
						insert into public.card_contacts (workspace_id, card_id, contact_id)
						values (v_channel.workspace_id, v_affaire, v_contact);
					end if;
					v_issue := 'created';
				exception
					when insufficient_privilege then
						v_code := 'forbidden';
						v_affaire := null;
					when others then
						v_code := 'unknown';
						v_affaire := null;
				end;
			end if;
			if v_issue = 'created' then
				v_crees := v_crees + 1;
			elsif v_issue = 'skipped' then
				v_ignores := v_ignores + 1;
			else
				v_refuses := v_refuses + 1;
			end if;
			v_issues := v_issues || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
				'line', v_rang, 'outcome', v_issue, 'code', v_code, 'card_id', v_affaire));
		end loop;
		if p_dry_run then
			raise exception 'dry_run' using errcode = 'ZZ071';
		end if;
	exception
		when sqlstate 'ZZ071' then
			null;
	end;
	perform pg_catalog.set_config('app.card_creation_source', '', true);

	if not p_dry_run then
		perform app.audit_import(v_channel.workspace_id, 'card', pg_catalog.jsonb_build_object(
			'created', v_crees, 'skipped', v_ignores, 'refused', v_refuses, 'channel_id', p_channel));
	end if;

	return query
	select r.line, r.outcome, r.code, r.card_id
	  from pg_catalog.jsonb_to_recordset(v_issues) as r(line integer, outcome text, code text, card_id uuid)
	 order by r.line;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.import_contacts(p_workspace uuid, p_rows jsonb, p_dry_run boolean DEFAULT true)
 RETURNS TABLE(line integer, outcome text, code text, contact_id uuid, organization_id uuid, organization_created boolean)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	v_issues     jsonb := '[]'::jsonb;
	v_ligne      jsonb;
	v_rang       integer := 0;
	v_nom        text;
	v_email      text;
	v_telephone  text;
	v_fonction   text;
	v_org_nom    text;
	v_org_dom    text;
	v_org_site   text;
	v_org        uuid;
	v_org_cree   boolean;
	v_contact    uuid;
	v_issue      text;
	v_code       text;
	v_contrainte text;
	v_crees      integer := 0;
	v_ignores    integer := 0;
	v_refuses    integer := 0;
	v_orgs       integer := 0;
begin
	if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
		raise exception 'invalid_rows' using errcode = '22023';
	end if;
	if pg_catalog.jsonb_array_length(p_rows) > 1000 then
		raise exception 'import_too_large' using errcode = '22023';
	end if;
	-- L'espace, lu sous la RLS de la personne : un espace dont elle n'est pas membre n'existe pas pour elle.
	if not exists (select 1 from public.workspaces w where w.id = p_workspace) then
		perform app.raise_http_error(404, 'workspace_not_found');
	end if;

	begin
		for v_ligne in select e.value from pg_catalog.jsonb_array_elements(p_rows) e loop
			v_rang := v_rang + 1;
			v_nom := nullif(pg_catalog.btrim(v_ligne ->> 'full_name'), '');
			v_email := nullif(pg_catalog.lower(pg_catalog.btrim(v_ligne ->> 'email')), '');
			v_telephone := nullif(pg_catalog.btrim(v_ligne ->> 'phone'), '');
			v_fonction := nullif(pg_catalog.btrim(v_ligne ->> 'role_title'), '');
			v_org_nom := nullif(pg_catalog.btrim(v_ligne ->> 'organization_name'), '');
			v_org_dom := nullif(pg_catalog.lower(pg_catalog.btrim(v_ligne ->> 'organization_domain')), '');
			v_org_site := nullif(pg_catalog.btrim(v_ligne ->> 'organization_website'), '');
			v_org := null;
			v_org_cree := false;
			v_contact := null;
			v_issue := 'created';
			v_code := null;
			begin
				if v_nom is null and v_org_nom is null then
					v_issue := 'refused';
					v_code := 'name_required';
				elsif v_nom is not null and v_email is not null and exists (
				      select 1 from public.contacts c where c.workspace_id = p_workspace and pg_catalog.lower(c.email) = v_email) then
					v_issue := 'skipped';
					v_code := 'duplicate_email';
				else
					-- L'organisation : par son domaine, puis par son nom sans casse ni blancs superflus, sinon créée.
					if v_org_dom is not null then
						select o.id into v_org from public.organizations o
						 where o.workspace_id = p_workspace and pg_catalog.lower(o.domain) = v_org_dom limit 1;
					end if;
					if v_org is null and v_org_nom is not null then
						select o.id into v_org from public.organizations o
						 where o.workspace_id = p_workspace
						   and pg_catalog.lower(pg_catalog.btrim(o.name)) = pg_catalog.lower(v_org_nom)
						 order by o.created_at, o.id limit 1;
					end if;
					if v_org is not null and v_nom is null then
						v_issue := 'skipped';
						v_code := 'duplicate_organization';
					else
						if v_org is null and v_org_nom is not null then
							insert into public.organizations (workspace_id, name, domain, website)
							values (p_workspace, v_org_nom, v_org_dom, v_org_site)
							returning id into v_org;
							v_org_cree := true;
						end if;
						if v_nom is not null then
							insert into public.contacts (workspace_id, organization_id, full_name, email, phone, role_title, source)
							values (p_workspace, v_org, v_nom, v_email, v_telephone, v_fonction, 'import')
							returning id into v_contact;
						end if;
					end if;
				end if;
			exception
				when check_violation or unique_violation then
					get stacked diagnostics v_contrainte = constraint_name;
					v_issue := case when v_contrainte like '%_key' then 'skipped' else 'refused' end;
					v_code := case
						when v_contrainte = 'contacts_email_check' then 'invalid_email'
						when v_contrainte = 'organizations_domain_check' then 'invalid_domain'
						when v_contrainte = 'organizations_website_check' then 'invalid_website'
						when v_contrainte = 'contacts_workspace_email_key' then 'duplicate_email'
						when v_contrainte = 'organizations_workspace_domain_key' then 'duplicate_organization'
						else 'unknown'
					end;
					v_org := null;
					v_org_cree := false;
					v_contact := null;
				when insufficient_privilege then
					v_issue := 'refused';
					v_code := 'forbidden';
					v_org := null;
					v_org_cree := false;
					v_contact := null;
				when others then
					v_issue := 'refused';
					v_code := 'unknown';
					v_org := null;
					v_org_cree := false;
					v_contact := null;
			end;
			if v_issue = 'created' then
				v_crees := v_crees + 1;
			elsif v_issue = 'skipped' then
				v_ignores := v_ignores + 1;
			else
				v_refuses := v_refuses + 1;
			end if;
			if v_org_cree then
				v_orgs := v_orgs + 1;
			end if;
			v_issues := v_issues || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
				'line', v_rang, 'outcome', v_issue, 'code', v_code, 'contact_id', v_contact, 'organization_id', v_org,
				'organization_created', v_org_cree));
		end loop;
		-- La simulation annule tout ce que la boucle a écrit ; ses issues restent dans la variable.
		if p_dry_run then
			raise exception 'dry_run' using errcode = 'ZZ071';
		end if;
	exception
		when sqlstate 'ZZ071' then
			null;
	end;

	if not p_dry_run then
		perform app.audit_import(p_workspace, 'contact', pg_catalog.jsonb_build_object(
			'created', v_crees, 'skipped', v_ignores, 'refused', v_refuses, 'organizations_created', v_orgs));
	end if;

	return query
	select r.line, r.outcome, r.code, r.contact_id, r.organization_id, r.organization_created
	  from pg_catalog.jsonb_to_recordset(v_issues) as r(
	       line integer, outcome text, code text, contact_id uuid, organization_id uuid, organization_created boolean)
	 order by r.line;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mail_inbound_account_record_check(p_account_id uuid, p_status text, p_error text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_maintenant timestamptz := now();
begin
	update public.mail_inbound_accounts a
	   set status          = p_status,
	       last_error      = p_error,
	       last_checked_at = v_maintenant
	 where a.id = p_account_id;

	if not found then
		perform app.raise_http_error(404, 'account_not_found');
	end if;

	return v_maintenant;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mail_outbound_identity_record_check(p_identity_id uuid, p_status text, p_error text DEFAULT NULL::text)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_maintenant timestamptz := now();
begin
	update public.mail_outbound_identities i
	   set status          = p_status,
	       last_error      = p_error,
	       last_checked_at = v_maintenant
	 where i.id = p_identity_id;

	if not found then
		perform app.raise_http_error(404, 'identity_not_found');
	end if;

	return v_maintenant;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.marquer_envoi_reussi(p_outbox_id uuid, p_rfc822_message_id text, p_references text[] DEFAULT '{}'::text[], p_pieces jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_envoi   public.mail_outbox%rowtype;
	v_message uuid;
begin
	select * into v_envoi from public.mail_outbox o where o.id = p_outbox_id;
	if v_envoi.id is null then
		perform app.raise_http_error(404, 'outbox_not_found');
	end if;
	if v_envoi.status = 'sent' then
		return v_envoi.sent_message_id;
	end if;

	if v_envoi.kind = 'digest' then
		update public.mail_outbox
		   set status = 'sent', sent_at = now(), rfc822_message_id = p_rfc822_message_id, last_error = null
		 where id = p_outbox_id;
		return null;
	end if;

	insert into public.mail_messages (
		workspace_id, rfc822_message_id, card_id, classification, direction,
		from_address, to_addresses, cc_addresses, bcc_addresses, subject, body_text, references_ids, sent_at
	)
	values (
		v_envoi.workspace_id, p_rfc822_message_id, v_envoi.card_id, 'outbound', 'outbound',
		(select i.from_address from public.mail_outbound_identities i where i.id = v_envoi.identity_id),
		v_envoi.to_addrs, v_envoi.cc_addrs, v_envoi.bcc_addrs, v_envoi.subject, v_envoi.body_text,
		coalesce(p_references, array[]::text[]), now()
	)
	on conflict (workspace_id, rfc822_message_id) do update set subject = excluded.subject
	returning id into v_message;

	insert into public.mail_attachments (message_id, card_id, filename, mime_type, size_bytes, storage_path, sha256, av_status)
	select v_message, v_envoi.card_id, p ->> 'filename', p ->> 'mime_type', (p ->> 'size_bytes')::bigint,
	       p ->> 'storage_path', p ->> 'sha256', p ->> 'av_status'
	  from jsonb_array_elements(coalesce(p_pieces, '[]'::jsonb)) p
	 where not exists (
		select 1 from public.mail_attachments a
		 where a.message_id = v_message and a.storage_path = p ->> 'storage_path'
	);

	update public.mail_outbox
	   set status = 'sent',
	       sent_at = now(),
	       rfc822_message_id = p_rfc822_message_id,
	       sent_message_id = v_message,
	       last_error = null
	 where id = p_outbox_id;

	perform app.card_event_ecrire(
		v_envoi.card_id,
		v_envoi.workspace_id,
		'mail_sent',
		jsonb_build_object('message_id', v_message, 'outbox_id', p_outbox_id)
	);

	return v_message;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mcp_compte(p_sub uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	familles constant text[] := array['structure', 'workflows', 'affaires', 'contacts', 'organizations', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie'];
	actions  constant text[] := array['consulter', 'ajouter', 'modifier', 'supprimer'];
	profil   public.profiles%rowtype;
	compte   public.mcp_comptes%rowtype;
begin
	perform app.exiger_superadmin();
	select * into profil from public.profiles p where p.id = p_sub;
	select * into compte from public.mcp_comptes c where c.sub = p_sub;
	if profil.id is null and compte.sub is null then
		perform app.raise_http_error(404, 'profil_introuvable');
	end if;
	return pg_catalog.jsonb_build_object(
		'sub', p_sub,
		'nom', coalesce(profil.full_name, compte.nom),
		'email', compte.email,
		'avec_profil', profil.id is not null,
		'connecte', compte.sub is not null,
		'premiere_connexion', compte.premiere_connexion,
		'derniere_activite', compte.derniere_activite,
		'superadmin', exists (select 1 from public.superadmins s where s.sub = p_sub),
		'espaces', coalesce((
			select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
			         'workspace_id', w.id,
			         'slug', w.slug,
			         'nom', w.name,
			         'role', (select m.role from public.workspace_members m where m.workspace_id = w.id and m.user_id = p_sub),
			         'droits', coalesce((
			           select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(d.famille, d.action)
			                    order by pg_catalog.array_position(familles, d.famille),
			                             pg_catalog.array_position(actions, d.action))
			             from public.mcp_droits d
			            where d.sub = p_sub and d.workspace_id = w.id), '[]'::jsonb))
			       order by w.name, w.slug)
			  from public.workspaces w), '[]'::jsonb));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.mcp_poser_droits(p_sub uuid, p_ws uuid, p_droits jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	familles constant text[] := array['structure', 'workflows', 'affaires', 'contacts', 'organizations', 'budgets', 'recettes', 'temps', 'objectifs', 'messagerie'];
	actions  constant text[] := array['consulter', 'ajouter', 'modifier', 'supprimer'];
	couple   jsonb;
	avant    jsonb;
	apres    jsonb;
begin
	perform app.exiger_superadmin();
	if p_sub is null or not exists (select 1 from public.profiles p where p.id = p_sub) then
		perform app.raise_http_error(404, 'profil_introuvable');
	end if;
	perform app.plateforme_espace_existe(p_ws);
	if p_droits is null or pg_catalog.jsonb_typeof(p_droits) <> 'array' then
		raise exception 'droit_invalide' using errcode = '22023';
	end if;
	for couple in select e.value from pg_catalog.jsonb_array_elements(p_droits) e loop
		if pg_catalog.jsonb_typeof(couple) <> 'array' or pg_catalog.jsonb_array_length(couple) <> 2
		   or pg_catalog.jsonb_typeof(couple -> 0) <> 'string' or pg_catalog.jsonb_typeof(couple -> 1) <> 'string'
		   or not ((couple ->> 0) = any (familles)) or not ((couple ->> 1) = any (actions)) then
			raise exception 'droit_invalide' using errcode = '22023';
		end if;
	end loop;

	select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(d.famille, d.action)
	                  order by pg_catalog.array_position(familles, d.famille), pg_catalog.array_position(actions, d.action)),
	                '[]'::jsonb)
	  into avant
	  from public.mcp_droits d where d.sub = p_sub and d.workspace_id = p_ws;
	select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(x.famille, x.action)
	                  order by pg_catalog.array_position(familles, x.famille), pg_catalog.array_position(actions, x.action)),
	                '[]'::jsonb)
	  into apres
	  from (select distinct e.value ->> 0 as famille, e.value ->> 1 as action
	          from pg_catalog.jsonb_array_elements(p_droits) e) x;
	if avant = apres then
		return;
	end if;

	delete from public.mcp_droits d
	 where d.sub = p_sub and d.workspace_id = p_ws
	   and not exists (select 1 from pg_catalog.jsonb_array_elements(p_droits) e
	                    where e.value ->> 0 = d.famille and e.value ->> 1 = d.action);
	insert into public.mcp_droits (sub, workspace_id, famille, action, accorde_par)
	select distinct p_sub, p_ws, e.value ->> 0, e.value ->> 1, (select auth.uid())
	  from pg_catalog.jsonb_array_elements(p_droits) e
	on conflict (sub, workspace_id, famille, action) do nothing;

	perform app.journaliser_plateforme('mcp_droits_poses', p_ws, pg_catalog.jsonb_build_object(
		'nom', app.plateforme_nom_profil(p_sub),
		'espace', app.plateforme_nom_espace(p_ws),
		'avant', avant,
		'apres', apres));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.plateforme_poser_membre(p_ws uuid, p_user uuid, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	role_voulu  text;
	role_avant  text;
begin
	perform app.exiger_superadmin();
	perform app.plateforme_espace_existe(p_ws);
	role_voulu := app.plateforme_role(p_role);
	if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
		perform app.raise_http_error(404, 'profil_introuvable');
	end if;

	select m.role into role_avant
	  from public.workspace_members m
	 where m.workspace_id = p_ws and m.user_id = p_user
	   for update;

	if role_avant is null then
		insert into public.workspace_members (workspace_id, user_id, role) values (p_ws, p_user, role_voulu);
	elsif role_avant is distinct from role_voulu then
		update public.workspace_members m set role = role_voulu
		 where m.workspace_id = p_ws and m.user_id = p_user;
	else
		return;
	end if;

	perform app.journaliser_plateforme('membre_pose', p_ws, pg_catalog.jsonb_build_object(
		'user_id', p_user, 'nom', app.plateforme_nom_profil(p_user), 'espace', app.plateforme_nom_espace(p_ws),
		'avant', role_avant, 'apres', role_voulu));
end;
$function$
;
CREATE OR REPLACE FUNCTION public.plateforme_poser_superadmin(p_user uuid, p_actif boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
	perform app.exiger_superadmin();
	if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user) then
		perform app.raise_http_error(404, 'profil_introuvable');
	end if;
	perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('p2enjoy-crm/superadmins'));

	if coalesce(p_actif, false) then
		insert into public.superadmins (sub, accorde_par) values (p_user, (select auth.uid()))
		on conflict (sub) do nothing;
		if found then
			perform app.journaliser_plateforme('superadmin_accorde', null,
				pg_catalog.jsonb_build_object('sub', p_user, 'nom', app.plateforme_nom_profil(p_user)));
		end if;
	else
		if not exists (select 1 from public.superadmins s where s.sub = p_user) then
			return;
		end if;
		if (select pg_catalog.count(*) from public.superadmins) <= 1 then
			raise exception 'dernier_superadministrateur' using errcode = 'P0001';
		end if;
		delete from public.superadmins s where s.sub = p_user;
		perform app.journaliser_plateforme('superadmin_retire', null,
			pg_catalog.jsonb_build_object('sub', p_user, 'nom', app.plateforme_nom_profil(p_user)));
	end if;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reassign_trashed_track_cost(p_cost uuid, p_budget uuid, p_occurrence uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	espace        uuid;
	piste         uuid;
	piste_morte   boolean;
	carte         uuid;
	devise        text;
	cible_piste   uuid;
	cible_espace  uuid;
	cible_morte   boolean;
	cible_devise  text;
begin
	-- 1. La ligne existe, dans l'espace de l'appelant.
	select k.workspace_id, b.track_id, t.deleted_at is not null, k.id, b.currency
	  into espace, piste, piste_morte, carte, devise
	  from public.card_costs l
	  join public.cards k on k.id = l.card_id
	  join public.budgets b on b.id = l.budget_id
	  join public.tracks t on t.id = b.track_id
	 where l.id = p_cost;
	if espace is null or not app.is_workspace_member(espace) then
		perform app.raise_http_error(404, 'cost_not_found');
	end if;
	-- 2. L'appelant administre l'espace.
	if not app.is_workspace_admin(espace) then
		raise exception 'reserved_to_admins' using errcode = '42501';
	end if;
	-- 3. La ligne bloque l'effacement d'un track en corbeille.
	if not piste_morte or app.affaire_detruite_avec_track(carte, piste) then
		raise exception 'cost_not_blocking' using errcode = 'P0001';
	end if;
	-- 4. Le budget cible existe dans l'espace, hors du track en corbeille et de tout track en corbeille.
	select b.track_id, t.workspace_id, t.deleted_at is not null, b.currency
	  into cible_piste, cible_espace, cible_morte, cible_devise
	  from public.budgets b
	  join public.tracks t on t.id = b.track_id
	 where b.id = p_budget;
	if cible_espace is distinct from espace then
		perform app.raise_http_error(404, 'budget_not_found');
	end if;
	if cible_piste = piste then
		raise exception 'same_track' using errcode = '22023';
	end if;
	if cible_morte then
		raise exception 'target_in_trash' using errcode = '22023';
	end if;
	-- 4 bis. La même devise : une ligne de coût prend celle de son budget, et ne se convertit pas.
	if cible_devise is distinct from devise then
		raise exception 'currency_mismatch' using errcode = '22023';
	end if;
	-- 5. Les règles d'une ligne de coût, entières (`app.card_costs_verifier_rattachement`) : budget et occurrence ouverts,
	--    occurrence exigée si et seulement si le budget est récurrent, appartenant au budget ; et le point (d), qui
	--    refuse de quitter un budget ou une occurrence clôturés (décision 743).
	update public.card_costs l set budget_id = p_budget, occurrence_id = p_occurrence where l.id = p_cost;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_attachment_text(p_attachment uuid, p_status text, p_text text DEFAULT NULL::text, p_truncated boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	a       public.mail_attachments;
	v_etat  text;
	v_texte text;
begin
	if p_status is null or p_status not in ('extracted', 'empty', 'unsupported', 'failed', 'retry') then
		raise exception 'invalid_text_status' using errcode = '22023';
	end if;
	select * into a from public.mail_attachments x where x.id = p_attachment and x.text_status = 'pending' for update;
	if not found then
		perform app.raise_http_error(404, 'attachment_not_found');
	end if;
	v_texte := nullif(pg_catalog.btrim(coalesce(p_text, '')), '');
	v_etat := case
		when p_status = 'extracted' and v_texte is null then 'empty'
		when p_status = 'retry' then case when a.text_attempts >= 3 then 'failed' else 'pending' end
		else p_status
	end;
	update public.mail_attachments x
	   set text_status = v_etat,
	       extracted_text = case when v_etat = 'extracted' then pg_catalog.left(v_texte, 200000) end,
	       text_truncated = (v_etat = 'extracted' and (coalesce(p_truncated, false) or pg_catalog.char_length(v_texte) > 200000)),
	       -- Une pièce rendue à `pending` garde son bail : l'essai suivant attend 15 minutes.
	       text_claimed_at = case when v_etat = 'pending' then now() end
	 where x.id = p_attachment;
	return v_etat;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.record_webhook_attempt(p_delivery uuid, p_status_code integer, p_error text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	d       public.webhook_deliveries;
	delais  constant interval[] := array[interval '1 minute', interval '5 minutes', interval '30 minutes',
	                                     interval '2 hours'];
	v_etat  text;
begin
	select * into d from public.webhook_deliveries x where x.id = p_delivery and x.status = 'pending' for update;
	if not found then
		perform app.raise_http_error(404, 'delivery_not_found');
	end if;
	if p_status_code between 200 and 299 then
		v_etat := 'delivered';
	elsif d.attempts >= 5 then
		v_etat := 'failed';
	else
		v_etat := 'pending';
	end if;
	update public.webhook_deliveries x
	   set status = v_etat,
	       last_status_code = p_status_code,
	       last_error = case when p_status_code is null then coalesce(p_error, 'network_error') end,
	       next_attempt_at = case when v_etat = 'pending'
	                              then coalesce(d.last_attempt_at, now()) + delais[greatest(d.attempts, 1)] end
	 where x.id = p_delivery;
	return v_etat;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.redeliver_webhook(p_delivery uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	d       public.webhook_deliveries;
	v_actif boolean;
	v_id    uuid;
begin
	select * into d from public.webhook_deliveries x where x.id = p_delivery;
	if not found or not app.is_workspace_admin(d.workspace_id) then
		perform app.raise_http_error(404, 'delivery_not_found');
	end if;
	if d.status = 'pending' then
		raise exception 'delivery_pending' using errcode = 'P0001';
	end if;
	select e.enabled into v_actif from public.webhook_endpoints e where e.id = d.endpoint_id;
	if not v_actif then
		raise exception 'webhook_disabled' using errcode = 'P0001';
	end if;
	insert into public.webhook_deliveries (workspace_id, endpoint_id, event, event_id, payload, redelivery_of,
	                                       next_attempt_at)
	values (d.workspace_id, d.endpoint_id, d.event, d.event_id, d.payload, d.id, now())
	returning id into v_id;
	return v_id;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.reprogrammer_envoi(p_outbox_id uuid, p_code text, p_delai_secondes integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_tentatives integer;
begin
	if p_delai_secondes is null or p_delai_secondes <= 0 then
		-- UN DÉLAI NUL N'EST PAS UNE REPROGRAMMATION : ce serait une boucle de scrutation déguisée,
		-- qui harcèlerait le serveur en panne au lieu de lui laisser le temps de revenir.
		raise exception 'delai_invalide' using errcode = '23514';
	end if;

	update public.mail_outbox
	   set status = 'queued',
	       attempts = attempts + 1,
	       next_attempt_at = now() + make_interval(secs => p_delai_secondes),
	       -- LE CODE, JAMAIS LE TEXTE DU SERVEUR (§13.7), et il est conservé même en cas de succès
	       -- ultérieur : l'exploitant doit pouvoir lire qu'un envoi a d'abord échoué.
	       last_error = left(regexp_replace(coalesce(p_code, 'unknown'), '[^a-z_]', '', 'g'), 64)
	 where id = p_outbox_id
	   -- SEUL UN ENVOI EN COURS SE REPROGRAMME : reprogrammer un `sent` le renverrait.
	   and status in ('queued', 'sending')
	returning attempts into v_tentatives;

	if v_tentatives is null then
		perform app.raise_http_error(409, 'outbox_not_reschedulable');
	end if;
	return v_tentatives;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.rotate_webhook_secret(p_endpoint uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_espace uuid;
	v_ancien uuid;
	v_secret record;
begin
	select e.workspace_id, e.secret_id into v_espace, v_ancien
	  from public.webhook_endpoints e where e.id = p_endpoint for update;
	if not found or not app.is_workspace_admin(v_espace) then
		perform app.raise_http_error(404, 'webhook_not_found');
	end if;
	select * into v_secret from app.webhook_nouveau_secret(p_endpoint);
	update public.webhook_endpoints e set secret_id = v_secret.secret_id where e.id = p_endpoint;
	delete from vault.secrets s where s.id = v_ancien;
	return v_secret.secret;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.save_card_as_template(p_placement uuid, p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	le_rattachement public.card_placements%rowtype;
	l_affaire       public.cards%rowtype;
	v_valeurs       jsonb;
	v_points        jsonb;
	le_modele       uuid;
begin
	select p.* into le_rattachement from public.card_placements p where p.id = p_placement;
	if not found then
		perform app.raise_http_error(404, 'placement_not_found');
	end if;
	if not app.is_workspace_admin(le_rattachement.workspace_id) then
		raise exception 'reserved_to_admins' using errcode = '42501';
	end if;
	select c.* into l_affaire from public.cards c where c.id = le_rattachement.card_id;

	-- Les valeurs du rattachement, sur ses questions NON archivées, renseignées.
	select coalesce(jsonb_object_agg(f.key, v.value), '{}'::jsonb)
	  into v_valeurs
	  from public.card_field_values v
	  join public.form_fields f on f.id = v.field_id
	 where v.placement_id = p_placement
	   and f.archived_at is null
	   and not app.valeur_de_champ_est_vide(v.value);

	-- Les libellés de TOUS ses points — d'étape et libres —, devenus libres dans le modèle ; les cochages ne sont pas repris.
	select coalesce(jsonb_agg(i.label order by i.placement_id nulls last, i.position, i.created_at), '[]'::jsonb)
	  into v_points
	  from public.card_checklist_items i
	 where i.card_id = l_affaire.id
	   and (i.placement_id is null or i.placement_id = p_placement);

	insert into public.card_templates
		(workspace_id, workflow_id, name, title, description, amount, currency, field_values, checklist)
	values
		(le_rattachement.workspace_id, le_rattachement.workflow_id, app.btrim_blancs(p_name), l_affaire.title,
		 l_affaire.description, le_rattachement.amount, l_affaire.currency, v_valeurs, v_points)
	returning id into le_modele;
	return le_modele;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.set_default_workflow(p_workflow uuid)
 RETURNS workflows
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
	le_workflow public.workflows%rowtype;
begin
	if (select auth.uid()) is null then
		raise exception 'authentification requise' using errcode = '42501';
	end if;
	select * into le_workflow from public.workflows w where w.id = p_workflow;
	if le_workflow.id is null then
		perform app.raise_http_error(404, 'workflow introuvable');
	end if;
	if not app.is_workspace_admin(le_workflow.workspace_id) then
		raise exception 'reserve aux administrateurs' using errcode = '42501';
	end if;
	if le_workflow.archived_at is not null then
		raise exception 'workflow archive' using errcode = 'P0001';
	end if;
	if le_workflow.scope <> 'global' then
		raise exception 'workflow non global' using errcode = 'P0001';
	end if;
	if le_workflow.is_default then
		return le_workflow;
	end if;

	update public.workflows w set is_default = false
	 where w.workspace_id = le_workflow.workspace_id and w.is_default and w.id <> p_workflow;
	update public.workflows w set is_default = true where w.id = p_workflow
	returning * into le_workflow;
	return le_workflow;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.unclassify_message(p_message_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_message public.mail_messages%rowtype;
	v_appelant uuid := (select auth.uid());
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		perform app.raise_http_error(404, 'message_not_found');
	end if;

	-- LE PREMIER DES DEUX DROITS — voir le message, exactement comme au classement (§18.2). Il est
	-- évalué AVANT que le `card_id` ne bouge : après l'écriture, il pourrait être devenu faux.
	if not app.peut_voir_message(p_message_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- LIGNE e — idempotence. Un message déjà non classé n'a pas de card à quitter : aucun
	-- événement, aucune écriture. Un utilisateur qui clique deux fois ne raconte pas deux
	-- histoires, et c'est la règle que le §16.3 pose déjà pour le classement.
	if v_message.card_id is null then
		return null;
	end if;

	-- LE SECOND — déclasser RETIRE du contenu de la card : le droit d'ÉCRITURE est exigé, le même
	-- qu'au classement. La symétrie est le contrat : on ne retire que ce qu'on aurait pu poser.
	if not app.can_write_card(v_message.card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- L'EXACT INVERSE DE `classify_message`, et rien de plus. `suggested_card_id` n'est PAS
	-- recalculé (§16.5.4) : la règle 3 du §4.4 est un constat de la RELÈVE, jamais d'un geste
	-- humain, et la rejouer ici ferait réapparaître une proposition automatique derrière une
	-- décision explicite de l'utilisateur.
	update public.mail_messages m
	   set card_id = null,
	       classification = 'unclassified',
	       classified_by = null,
	       classified_at = null
	 where m.id = p_message_id;

	update public.mail_attachments a set card_id = null where a.message_id = p_message_id;

	-- LE DÉPART S'ÉCRIT SUR LA CARD QUITTÉE (§16.5.3). Le `subject` accompagne le `message_id`
	-- parce que la timeline doit rester lisible à qui ne peut PLUS ouvrir le message : sans lui,
	-- la ligne ne porterait qu'un identifiant que personne ne peut résoudre.
	perform app.card_event_ecrire(
		v_message.card_id,
		v_message.workspace_id,
		'mail_unclassified',
		jsonb_build_object('message_id', p_message_id, 'subject', v_message.subject)
	);

	return v_message.card_id;
end;
$function$
;
