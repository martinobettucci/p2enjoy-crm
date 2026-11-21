-- @spec CRM-162 (docs/BACKLOG.md) — tranche T2 : ce que l'écran de la plateforme lit et ce qu'il affiche — les tracks d'un
--       espace pour le super-administrateur, qui n'en est pas membre (`plateforme_tracks`) ; les noms des deux espaces
--       écrits dans le journal et dans l'événement `track_moved` (`move_track` reprise de `0197`, seule l'écriture des noms
--       ajoutée)
-- @spec docs/SPEC-deplacement-track.md §10, §13 ; docs/SCHEMA.md « Migration `0198` » ; docs/DESIGN_SYSTEM.md §5.112
--
-- IDEMPOTENCE : `create or replace`.

-- =============================================================================================
-- 1. Les tracks d'un espace, pour le super-administrateur — §13
-- =============================================================================================

-- `SECURITY DEFINER` : le super-administrateur n'est pas membre de tous les espaces, et la RLS de `tracks` ne lui montrerait
-- rien. Le patron de `plateforme_membres` : la garde d'abord, puis la lecture.
create or replace function public.plateforme_tracks(p_ws uuid)
returns table (id uuid, name text, slug text, channels integer, cards integer, trashed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	perform app.exiger_superadmin();
	return query
	select t.id, t.name, t.slug,
	       (select count(*)::integer from public.channels c where c.track_id = t.id and c.deleted_at is null),
	       (select count(distinct pl.card_id)::integer
	          from public.card_placements pl join public.channels c on c.id = pl.channel_id
	         where c.track_id = t.id),
	       t.deleted_at is not null
	  from public.tracks t
	 where t.workspace_id = p_ws
	 order by t.deleted_at is not null, t.position, t.name, t.id;
end;
$$;

comment on function public.plateforme_tracks(uuid) is
	'CRM-162 §13 — les tracks d''un espace, leurs channels et leurs affaires, pour le bloc « Tracks » de la fiche d''un '
	'espace. Super-administrateur seul.';

revoke all on function public.plateforme_tracks(uuid) from public, anon;
grant execute on function public.plateforme_tracks(uuid) to authenticated;

-- =============================================================================================
-- 2. Le déplacement, les noms des espaces écrits — §10 (reprise de `0197`)
-- =============================================================================================

create or replace function public.move_track(p_track_id uuid, p_target_workspace_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_track  public.tracks%rowtype;
	v_from   uuid;
	v        record;
	v_refus  jsonb;
	r        record;
	v_new    uuid;
	v_cle    text;
	v_bilan  jsonb;
	v_acteur uuid;
	v_claims text;
	v_noms   jsonb;
begin
	perform app.exiger_superadmin();
	v_acteur := auth.uid();
	select * into v_track from public.tracks t where t.id = p_track_id for update;
	if v_track.id is null then
		perform app.raise_http_error(404, 'track_not_found');
	end if;
	if not exists (select 1 from public.workspaces w where w.id = p_target_workspace_id) then
		perform app.raise_http_error(404, 'workspace_not_found');
	end if;
	if app.btrim_blancs(coalesce(p_confirm_name, '')) is distinct from app.btrim_blancs(v_track.name) then
		raise exception 'confirmation_mismatch' using errcode = '22023';
	end if;
	v_from := v_track.workspace_id;
	select * into v from app.track_move_scope(p_track_id);

	-- Les verrous : rien ne se crée entre l'aperçu et l'écriture que l'aperçu n'a pas vu.
	perform 1 from public.channels c where c.id = any (v.channel_ids) order by c.id for update;
	perform 1 from public.cards c where c.id = any (v.card_ids) order by c.id for update;

	v_refus := app.track_move_refusals(p_track_id, p_target_workspace_id);
	if jsonb_array_length(v_refus) > 0 then
		raise exception 'track_move_refused' using errcode = '22023', detail = v_refus::text;
	end if;

	-- Le drapeau de la transaction (décision 969), et les clés composites différées. LES LIGNES DÉPLACÉES S'ÉCRIVENT SANS
	-- IDENTITÉ DE REQUÊTE : un déclencheur qui pose son auteur (`updated_by := v_acteur`) les attribuerait sinon au
	-- super-administrateur, qui deviendrait une « personne citée » et bloquerait le retour (relevé au premier essai). L'acteur
	-- est gardé, et le journal le nomme.
	v_claims := pg_catalog.current_setting('request.jwt.claims', true);
	perform pg_catalog.set_config('request.jwt.claims', '', true);
	perform pg_catalog.set_config('app.track_move', 'on', true);
	set constraints all deferred;

	-- Les tables de travail de la transaction ; un second déplacement dans la même transaction les recrée.
	drop table if exists pg_temp.tm_map;
	drop table if exists pg_temp.tm_matches;
	create temporary table tm_map (family text, source_id uuid, target_id uuid, primary key (family, source_id)) on commit drop;
	create temporary table tm_matches on commit drop as
	select * from app.track_move_matches(p_track_id, p_target_workspace_id);
	insert into pg_temp.tm_map
	select m.family, m.source_id, m.target_id from pg_temp.tm_matches m where m.action = 'reuse' and m.family <> 'workflow';

	-- Les référentiels créés, dans l'ordre de leurs dépendances (§7).
	for r in select * from pg_temp.tm_matches m where m.family = 'node' and m.action = 'create' loop
		insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color, default_probability,
		                                           default_stale_after_days, position, description)
		select p_target_workspace_id, n.key, n.label, n.kind, n.color, n.default_probability, n.default_stale_after_days,
		       n.position, n.description
		  from public.workflow_nodes_catalog n where n.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('node', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'common_field' and m.action = 'create' loop
		select f.key into v_cle from public.card_common_fields f where f.id = r.source_id;
		if exists (select 1 from public.card_common_fields t where t.workspace_id = p_target_workspace_id and t.key = v_cle) then
			v_cle := v_cle || '-' || substr(md5(r.source_id::text), 1, 4);
		end if;
		insert into public.card_common_fields (workspace_id, key, label, type, options, help_text, is_listed, position)
		select p_target_workspace_id, v_cle, f.label, f.type, f.options, f.help_text, f.is_listed, f.position
		  from public.card_common_fields f where f.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('common_field', r.source_id, v_new);
	end loop;
	-- Un champ de liste réutilisé reçoit les choix absents (§7.1) : une valeur déplacée y reste valide.
	update public.card_common_fields t
	   set options = jsonb_set(t.options, '{choices}',
	         coalesce(t.options -> 'choices', '[]'::jsonb) || coalesce((
	           select jsonb_agg(c) from jsonb_array_elements(f.options -> 'choices') c
	            where not exists (select 1 from jsonb_array_elements(t.options -> 'choices') d where d ->> 'key' = c ->> 'key')),
	           '[]'::jsonb))
	  from pg_temp.tm_matches m
	  join public.card_common_fields f on f.id = m.source_id
	 where m.family = 'common_field' and m.action = 'reuse' and t.id = m.target_id
	   and jsonb_typeof(f.options -> 'choices') = 'array';

	for r in select * from pg_temp.tm_matches m where m.family = 'label' and m.action = 'create' loop
		insert into public.labels (workspace_id, name, color, created_by)
		select p_target_workspace_id, l.name, l.color, v_acteur from public.labels l where l.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('label', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'organization' and m.action = 'create' loop
		insert into public.organizations (workspace_id, name, domain, website)
		select p_target_workspace_id, o.name, o.domain, o.website from public.organizations o where o.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('organization', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'contact' and m.action = 'create' loop
		insert into public.contacts (workspace_id, organization_id, full_name, email, phone, role_title, source)
		select p_target_workspace_id,
		       (select x.target_id from pg_temp.tm_map x where x.family = 'organization' and x.source_id = c.organization_id),
		       c.full_name, c.email, c.phone, c.role_title, c.source
		  from public.contacts c where c.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('contact', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'mail_label' and m.action = 'create' loop
		insert into public.mail_labels (workspace_id, name, color, description, hidden, archived_at, created_by)
		select p_target_workspace_id, l.name, l.color, l.description, l.hidden, l.archived_at, v_acteur
		  from public.mail_labels l where l.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('mail_label', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'template' and m.action = 'create' loop
		insert into public.mail_templates (workspace_id, name, subject, body_text, created_by)
		select p_target_workspace_id, t.name, t.subject, t.body_text, v_acteur from public.mail_templates t where t.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('template', r.source_id, v_new);
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'sequence' and m.action = 'create' loop
		insert into public.mail_sequences (workspace_id, name, created_by)
		select p_target_workspace_id, s.name, v_acteur from public.mail_sequences s where s.id = r.source_id
		returning id into v_new;
		insert into pg_temp.tm_map values ('sequence', r.source_id, v_new);
		insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
		select p_target_workspace_id, v_new, st.position, st.delai_jours,
		       coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'template' and x.source_id = st.template_id),
		                st.template_id)
		  from public.mail_sequence_steps st where st.sequence_id = r.source_id;
	end loop;

	for r in select * from pg_temp.tm_matches m where m.family = 'workflow' loop
		if r.action = 'reuse' then
			perform app.track_move_map_workflow(r.source_id, r.target_id);
		else
			perform app.track_move_copy_workflow(r.source_id, p_target_workspace_id, r.target_name);
		end if;
	end loop;

	-- Les lignes déplacées (§3.1), des parents aux enfants ; les clés composites se contrôlent à la fin.
	update public.tracks set workspace_id = p_target_workspace_id where id = p_track_id;
	update public.channels c
	   set workspace_id = p_target_workspace_id,
	       workflow_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'workflow' and x.source_id = c.workflow_id),
	                              c.workflow_id)
	 where c.id = any (v.channel_ids);

	update public.workflows set workspace_id = p_target_workspace_id where id = any (v.workflow_ids);
	update public.workflow_steps s
	   set workspace_id = p_target_workspace_id,
	       node_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'node' and x.source_id = s.node_id), s.node_id)
	 where s.workflow_id = any (v.workflow_ids);
	update public.workflow_transitions set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.workflow_versions set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.form_fields set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.form_field_rules set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.workflow_step_checklist_items set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.workflow_transition_required_common_fields q
	   set workspace_id = p_target_workspace_id,
	       common_field_id = coalesce((select x.target_id from pg_temp.tm_map x
	                                    where x.family = 'common_field' and x.source_id = q.common_field_id), q.common_field_id)
	 where q.transition_id in (select t.id from public.workflow_transitions t where t.workflow_id = any (v.workflow_ids));
	update public.card_templates set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);
	update public.suggestions_ia_revisions set workspace_id = p_target_workspace_id
	 where suggestion_id in (select s.id from public.suggestions_ia s where s.workflow_id = any (v.workflow_ids));
	update public.suggestions_ia set workspace_id = p_target_workspace_id where workflow_id = any (v.workflow_ids);

	update public.cards set workspace_id = p_target_workspace_id where id = any (v.card_ids);
	update public.card_placements p
	   set workspace_id = p_target_workspace_id,
	       workflow_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'workflow' and x.source_id = p.workflow_id),
	                              p.workflow_id),
	       current_step_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'step' and x.source_id = p.current_step_id),
	                                  p.current_step_id)
	 where p.card_id = any (v.card_ids);
	update public.card_field_values f
	   set workspace_id = p_target_workspace_id,
	       workflow_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'workflow' and x.source_id = f.workflow_id),
	                              f.workflow_id),
	       field_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'field' and x.source_id = f.field_id),
	                           f.field_id)
	 where f.card_id = any (v.card_ids);
	update public.card_checklist_items i
	   set workspace_id = p_target_workspace_id,
	       step_item_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'step_item' and x.source_id = i.step_item_id),
	                               i.step_item_id)
	 where i.card_id = any (v.card_ids);
	update public.card_common_field_values f
	   set workspace_id = p_target_workspace_id,
	       field_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'common_field' and x.source_id = f.field_id),
	                           f.field_id)
	 where f.card_id = any (v.card_ids);
	update public.card_labels l
	   set workspace_id = p_target_workspace_id,
	       label_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'label' and x.source_id = l.label_id), l.label_id)
	 where l.card_id = any (v.card_ids);
	update public.card_contacts c
	   set workspace_id = p_target_workspace_id,
	       contact_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'contact' and x.source_id = c.contact_id),
	                             c.contact_id)
	 where c.card_id = any (v.card_ids);
	update public.card_comment_mentions m set workspace_id = p_target_workspace_id
	 where m.comment_id in (select c.id from public.card_comments c where c.card_id = any (v.card_ids));
	update public.card_comments set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.card_activity_participants p
	   set contact_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'contact' and x.source_id = p.contact_id),
	                             p.contact_id)
	 where p.activity_id in (select a.id from public.card_activities a where a.card_id = any (v.card_ids)) and p.contact_id is not null;
	update public.card_activities set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.card_events set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.card_sequence_enrollments e
	   set workspace_id = p_target_workspace_id,
	       sequence_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'sequence' and x.source_id = e.sequence_id),
	                              e.sequence_id)
	 where e.card_id = any (v.card_ids);
	update public.saisies_temps set workspace_id = p_target_workspace_id
	 where track_id = p_track_id or channel_id = any (v.channel_ids) or card_id = any (v.card_ids);
	update public.saved_views set workspace_id = p_target_workspace_id where channel_id = any (v.channel_ids);
	update public.webhook_deliveries set workspace_id = p_target_workspace_id
	 where endpoint_id in (select w.id from public.webhook_endpoints w where w.channel_id = any (v.channel_ids));
	update public.webhook_endpoints set workspace_id = p_target_workspace_id where channel_id = any (v.channel_ids);

	-- Les mails déjà présents à l'arrivée (décision 972) : l'exemplaire d'arrivée est gardé, classé dans l'affaire s'il ne
	-- l'est nulle part ; les envois qui citent l'exemplaire de départ le citent désormais, puis il est retiré.
	for r in select m.id as depart, t.id as arrivee, t.card_id as carte_arrivee, m.card_id, m.classification, m.classified_at
	           from public.mail_messages m
	           join public.mail_messages t on t.workspace_id = p_target_workspace_id and t.rfc822_message_id = m.rfc822_message_id
	          where m.id = any (v.message_ids) loop
		if r.carte_arrivee is null then
			update public.mail_messages set card_id = r.card_id, classification = r.classification,
			       classified_at = coalesce(r.classified_at, now())
			 where id = r.arrivee;
		end if;
		update public.mail_outbox set sent_message_id = r.arrivee where sent_message_id = r.depart;
		update public.mail_outbox set in_reply_to_message_id = r.arrivee where in_reply_to_message_id = r.depart;
		update public.mail_drafts set in_reply_to_message_id = r.arrivee where in_reply_to_message_id = r.depart;
		delete from public.mail_messages where id = r.depart;
	end loop;

	update public.mail_thread_snoozes z set workspace_id = p_target_workspace_id
	 where z.workspace_id = v_from
	   and z.thread_key in (select app.cle_fil(m.references_ids, m.rfc822_message_id) from public.mail_messages m
	                         where m.id = any (v.message_ids))
	   and not exists (select 1 from public.mail_thread_snoozes y where y.workspace_id = p_target_workspace_id and y.thread_key = z.thread_key);
	update public.mail_message_labels l
	   set workspace_id = p_target_workspace_id,
	       label_id = coalesce((select x.target_id from pg_temp.tm_map x where x.family = 'mail_label' and x.source_id = l.label_id),
	                           l.label_id)
	 where l.message_id = any (v.message_ids);
	update public.mail_label_evaluations set workspace_id = p_target_workspace_id where message_id = any (v.message_ids);
	update public.mail_message_transfers set workspace_id = p_target_workspace_id where message_id = any (v.message_ids);
	update public.mail_trash_moves set workspace_id = p_target_workspace_id where message_id = any (v.message_ids);
	update public.mail_messages set workspace_id = p_target_workspace_id where id = any (v.message_ids);
	update public.mail_outbox set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.mail_drafts set workspace_id = p_target_workspace_id where card_id = any (v.card_ids);
	update public.notifications set workspace_id = p_target_workspace_id where subject_card_id = any (v.card_ids);

	-- Les adresses (§8) : l'ancienne aboutit par l'alias de l'espace quitté ; revenir dans un espace retire son alias.
	delete from public.card_address_aliases a where a.workspace_id = p_target_workspace_id and a.card_id = any (v.card_ids);
	insert into public.card_address_aliases (workspace_id, email_local_part, card_id)
	select v_from, c.email_local_part, c.id from public.cards c where c.id = any (v.card_ids) and c.email_local_part is not null
	on conflict (workspace_id, email_local_part) do update set card_id = excluded.card_id;

	-- Les clés différées se contrôlent ici, pour un refus lisible plutôt qu'un échec au commit.
	set constraints all immediate;
	perform pg_catalog.set_config('app.track_move', 'off', true);
	perform pg_catalog.set_config('request.jwt.claims', coalesce(v_claims, ''), true);

	-- Le journal (§10). `CRM-162` T2 (migration 0198) : les NOMS des deux espaces y sont écrits, pour que le journal de la
	-- plateforme et l'historique d'une affaire les disent sans relire un espace qui a pu changer de nom depuis.
	select jsonb_build_object('from_name', (select w.name from public.workspaces w where w.id = v_from),
	                          'to_name', (select w.name from public.workspaces w where w.id = p_target_workspace_id))
	  into v_noms;
	v_bilan := jsonb_build_object(
		'channels', pg_catalog.cardinality(v.channel_ids),
		'cards', pg_catalog.cardinality(v.card_ids),
		'messages', pg_catalog.cardinality(v.message_ids),
		'reused', (select count(*) from pg_temp.tm_matches m where m.action = 'reuse'),
		'created', (select count(*) from pg_temp.tm_matches m where m.action = 'create'));
	insert into public.track_moves (track_id, track_slug, from_workspace_id, to_workspace_id, moved_by)
	values (p_track_id, v_track.slug, v_from, p_target_workspace_id, v_acteur);
	insert into public.plateforme_journal (acteur, geste, workspace_id, cible)
	values (v_acteur, 'track_moved', p_target_workspace_id,
	        jsonb_build_object('track_id', p_track_id, 'track_name', v_track.name, 'from', v_from, 'to', p_target_workspace_id)
	        || v_noms || v_bilan);
	insert into public.card_events (card_id, workspace_id, type, actor_id, payload)
	select c.id, p_target_workspace_id, 'track_moved', v_acteur,
	       jsonb_build_object('track', v_track.name, 'from', v_from, 'to', p_target_workspace_id) || v_noms
	  from public.cards c where c.id = any (v.card_ids);

	return v_bilan || jsonb_build_object('track_id', p_track_id, 'from', v_from, 'to', p_target_workspace_id);
end;
$$;

comment on function public.move_track(uuid, uuid, text) is
	'CRM-162 §6 — déplace un track entier vers un espace, en une transaction : refus recalculés, référentiels retrouvés '
	'ou créés, lignes déplacées, alias d''adresses, journal. Super-administrateur seul ; la saisie du nom confirme.';

revoke all on function public.move_track(uuid, uuid, text) from public, anon;
grant execute on function public.move_track(uuid, uuid, text) to authenticated;
