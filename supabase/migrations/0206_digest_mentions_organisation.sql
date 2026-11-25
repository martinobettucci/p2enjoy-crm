-- @spec INC-361 (docs/INCONSISTENCY_REPORT.md ; lot F du backlog, décisions 992 et 1000) : le digest quotidien cite aussi les
--       mentions non lues du fil d'une organisation, avec le lien de sa fiche
-- @spec docs/SPEC-etiquettes-digest.md §5.2 bis ; docs/SPEC-notifications.md §51 ; docs/SPEC-organisations.md §9.2 ;
--       docs/SCHEMA.md « Migration `0206` » ; docs/PROD_MIGRATIONS.md §2.85 ; docs/JOURNAL.md décision 1000
--
-- POURQUOI : `app.digest_corps` (migration `0133`) joignait `notifications` à `cards` par `subject_card_id` ; une mention dans le
-- fil d'une organisation (`CRM-153`, migration `0188`) porte `subject_organization_id` et un `subject_card_id` nul : la jointure
-- l'écartait, et le digest ne la comptait ni ne la citait. Le responsable a tranché (décision 992) : il la cite.
--
-- CE QUI CHANGE : le bloc des mentions seul — une union des mentions d'affaires et d'organisations, par ordre de création, que
-- la personne peut lire (`app.can_read_card_pour`, `app.can_read_organization_for`). Le compteur de l'objet et la règle « rien à
-- dire, aucun email » suivent, puisqu'ils lisent `v_n_mention`.
--
-- CE QUI NE CHANGE PAS : la signature, les droits (`grant`/`revoke` de la `0133`), les rubriques « En retard »,
-- « Aujourd'hui » et « Affaires figées », l'envoi, l'idempotence, l'heure de Paris. Aucune table, aucune colonne.
--
-- sans effet de types : une fonction interne du schéma `app` (le job du digest), hors de l'API exposée ; aucune table, colonne ni
-- fonction de `public`, donc rien dans `webapp/src/lib/database.types.ts`.
--
-- Retour arrière : rejouer la définition de la `0133` (`create or replace function app.digest_corps`).

create or replace function app.digest_corps(p_profile uuid, p_workspace uuid, p_maintenant timestamptz)
returns table (sujet text, corps text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_jour      date := (p_maintenant at time zone 'Europe/Paris')::date;
	v_debut     timestamptz := (v_jour::timestamp at time zone 'Europe/Paris');
	v_fin       timestamptz := ((v_jour + 1)::timestamp at time zone 'Europe/Paris');
	v_espace    text;
	v_retard    text[];
	v_jourdhui  text[];
	v_mentions  text[];
	v_figees    text[];
	v_actions   integer;
	v_n_mention integer;
	v_lignes    text[] := array[]::text[];
begin
	select w.name into v_espace from public.workspaces w where w.id = p_workspace;

	with actions as (
		select c.id, c.title, p.next_action, p.next_action_at, t.slug as track, ch.slug as channel
		  from public.card_placements p
		  join public.cards c on c.id = p.card_id
		  join public.channels ch on ch.id = p.channel_id
		  join public.tracks t on t.id = ch.track_id
		 where c.workspace_id = p_workspace
		   and p.owner_id = p_profile
		   and p.archived_at is null and c.deleted_at is null
		   and (p.snoozed_until is null or p.snoozed_until <= p_maintenant)
		   and p.next_action_at is not null and p.next_action_at < v_fin
		   and app.can_read_card_pour(c.id, p_profile)
	)
	select array_agg(format('- %s — %s%s{site}/tracks/%s/%s/cards/%s', a.title,
	                        coalesce(a.next_action || ' — ', ''), E'\n  ', a.track, a.channel, a.id)
	                 order by a.next_action_at) filter (where a.next_action_at < v_debut),
	       array_agg(format('- %s — %s%s{site}/tracks/%s/%s/cards/%s', a.title,
	                        coalesce(a.next_action || ' — ', ''), E'\n  ', a.track, a.channel, a.id)
	                 order by a.next_action_at) filter (where a.next_action_at >= v_debut),
	       count(*)
	  into v_retard, v_jourdhui, v_actions
	  from actions a;

	-- `INC-361` (décision 1000) : les mentions d'AFFAIRES (par `subject_card_id`) et celles du fil d'une ORGANISATION (par
	-- `subject_organization_id`, jamais posé avec l'autre), mêlées dans l'ordre de leur création. Chaque ligne est filtrée par le
	-- droit de lecture de la personne, lu ici, à l'instant du digest.
	with mentions as (
		select n.created_at,
		       format('- %s%s{site}/tracks/%s/%s/cards/%s', c.title, E'\n  ', t.slug, ch.slug, c.id) as ligne
		  from public.notifications n
		  join public.cards c on c.id = n.subject_card_id
		  join lateral (select p.channel_id from public.card_placements p where p.card_id = c.id
		                 order by p.created_at, p.id limit 1) r on true
		  join public.channels ch on ch.id = r.channel_id
		  join public.tracks t on t.id = ch.track_id
		 where n.recipient_id = p_profile and n.workspace_id = p_workspace and n.read_at is null
		   and c.deleted_at is null
		   and app.can_read_card_pour(c.id, p_profile)
		union all
		-- La fiche de l'organisation est une page globale : son adresse n'a pas de slug d'espace (`CRM-161`). L'ancre du
		-- commentaire est celle de la cloche ; sans identifiant de commentaire dans la charge utile, la fiche seule.
		select n.created_at,
		       format('- %s (organisation)%s{site}/contacts/organisations/%s%s', o.name, E'\n  ', o.id,
		              case when n.payload ->> 'comment_id' is not null then '#commentaire-' || (n.payload ->> 'comment_id') else '' end)
		  from public.notifications n
		  join public.organizations o on o.id = n.subject_organization_id
		 where n.recipient_id = p_profile and n.workspace_id = p_workspace and n.read_at is null
		   and app.can_read_organization_for(o.id, p_profile)
	)
	select array_agg(m.ligne order by m.created_at), count(*)
	  into v_mentions, v_n_mention
	  from mentions m;

	select array_agg(format('- %s — %s jours dans l''étape, seuil %s%s{site}/tracks/%s/%s/cards/%s', f.title,
	                        f.jours_dans_etape, f.seuil_jours, E'\n  ', t.slug, ch.slug, f.card_id)
	                 order by f.retard_jours desc)
	  into v_figees
	  from public.cards_figees() f
	  join public.channels ch on ch.id = f.channel_id
	  join public.tracks t on t.id = ch.track_id
	 where f.workspace_id = p_workspace and f.owner_id = p_profile
	   and app.can_read_card_pour(f.card_id, p_profile);

	if coalesce(v_actions, 0) = 0 and coalesce(v_n_mention, 0) = 0 and v_figees is null then
		return;
	end if;

	v_lignes := v_lignes || format('Bonjour,%sVoici ce qui vous attend aujourd''hui dans %s.', E'\n\n', v_espace);
	if v_retard is not null then
		v_lignes := v_lignes || (E'\nEn retard\n' || array_to_string(v_retard, E'\n'));
	end if;
	if v_jourdhui is not null then
		v_lignes := v_lignes || (E'\nAujourd''hui\n' || array_to_string(v_jourdhui, E'\n'));
	end if;
	if v_mentions is not null then
		v_lignes := v_lignes || (E'\nOn vous a mentionné\n' || array_to_string(v_mentions, E'\n'));
	end if;
	if v_figees is not null then
		v_lignes := v_lignes || (E'\nAffaires figées\n' || array_to_string(v_figees, E'\n'));
	end if;
	-- `::text` : sans lui, un littéral concaténé à un `text[]` est lu comme un littéral de tableau (mesuré : `22P02`).
	v_lignes := v_lignes || (E'\nVous recevez ce récapitulatif parce que vous l''avez demandé dans Réglages ▸ Notifications. '
	                         'Décochez la case pour ne plus le recevoir.')::text;

	sujet := format('Votre journée dans %s — %s action(s), %s mention(s)', v_espace, coalesce(v_actions, 0),
	                coalesce(v_n_mention, 0));
	corps := array_to_string(v_lignes, E'\n');
	return next;
end;
$$;
