-- @spec CRM-066 (docs/BACKLOG.md) — tranche 4 : les deux scores de santé d'une affaire (CRM-P02)
-- @spec docs/SPEC-analytique.md §13.2 (la dynamique), §13.3 (la santé commerciale), §13.4 (ce qui n'est pas noté),
--       §13.5 (le modèle) ; docs/SCHEMA.md « Migration `0113` » ; docs/PROD_MIGRATIONS.md §3 ;
--       docs/JOURNAL.md décisions 708, 723 et 724 ; docs/DAT.md §12 bis (les noms)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION AJOUTE : deux colonnes calculées sur `cards`, et trois fonctions d'appui.
-- ---------------------------------------------------------------------------------------------
--
-- CALCUL À LA LECTURE (décision 708, option A) : aucune colonne n'est écrite, aucun ordonnanceur ne tourne, le score est
-- toujours juste. `cards.health_score` reste inemployée (§13.5).
--
-- `SECURITY INVOKER` PARTOUT : le dernier contact se lit dans les activités et le courrier SOUS LA RLS DE L'APPELANT, qui
-- lit déjà l'affaire. Une fonction `DEFINER` dévoilerait la date d'un courrier que l'appelant ne voit pas.
--
-- PARAMÈTRE ANONYME : le patron de `is_read` (migration 105) — le générateur de types range alors la colonne dans la
-- ligne de `cards`, et l'écran la demande avec ses colonnes, sans conversion forcée.
--
-- `CRM-111` : tant que `cards` reste le seul écrivain (décision 705), ces fonctions lisent `cards`. La tranche T2.4, qui
-- retire de `cards` les colonnes d'un rattachement, les transporte vers `card_placements` (§13.5).
--
-- Rejouable : `create or replace`.

-- =============================================================================================
-- 1. Les fonctions d'appui
-- =============================================================================================

-- LE PALIER, COMMUN AUX DEUX SCORES (décision 708) : sain à 70 et plus, à surveiller de 40 à 69, en danger sous 40.
create or replace function app.health_tier(p_score integer)
returns text
language sql
immutable
set search_path = ''
as $$
	select case when p_score >= 70 then 'healthy' when p_score >= 40 then 'watch' else 'danger' end;
$$;

comment on function app.health_tier(integer) is
	'CRM-066 tranche 4 §13.5 — le palier d''un score de santé : healthy (≥ 70), watch (40 à 69), danger (< 40).';

-- LE DERNIER CONTACT : la plus récente des deux traces qu'un contact laisse — une activité non retirée, un courrier
-- classé dans l'affaire, reçu ou envoyé (§13.1). `greatest` ignore une trace absente ; aucune trace rend `null`.
create or replace function app.health_last_contact(p_card_id uuid)
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
	select greatest(
		(select max(a.occurred_at) from public.card_activities a where a.card_id = p_card_id and a.deleted_at is null),
		(select max(m.received_at) from public.mail_messages m where m.card_id = p_card_id)
	);
$$;

comment on function app.health_last_contact(uuid) is
	'CRM-066 tranche 4 §13.1 — le dernier contact d''une affaire : la plus récente activité non retirée ou le plus récent '
	'courrier classé, sous la RLS de l''appelant. `null` si aucun.';

-- LE CONTEXTE D'UNE AFFAIRE OUVERTE, ou rien. Une affaire décidée, archivée ou à la corbeille n'a pas de score (§13.4) :
-- la fonction ne rend alors aucune ligne, et chaque score rend `null`.
-- `RETURNS TABLE`, ET NON DES PARAMÈTRES `OUT` : une fonction SQL à paramètres `OUT` rend une ligne de NULL quand sa
-- requête ne trouve rien — `found` serait vrai, et une affaire décidée recevrait un score. Mesuré par la suite pgTAP 0110.
drop function if exists app.health_context(public.cards);

create or replace function app.health_context(p_card public.cards)
returns table (
	seuil_jours integer,
	jours_dans_etape integer,
	jours_sans_contact integer,
	probabilite numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
	select coalesce(ws.stale_after_days, n.default_stale_after_days),
	       floor(extract(epoch from (now() - p_card.entered_step_at)) / 86400.0)::integer,
	       -- UNE AFFAIRE JAMAIS CONTACTÉE COMPTE DEPUIS SA CRÉATION (§13.2) : créée hier, elle n'est pas « sans contact
	       -- depuis 30 jours ».
	       floor(extract(epoch from (now() - coalesce(app.health_last_contact(p_card.id), p_card.created_at)))
	             / 86400.0)::integer,
	       coalesce(p_card.probability_override, ws.probability_override, n.default_probability)
	  from public.workflow_steps ws
	  join public.workflow_nodes_catalog n on n.id = ws.node_id
	 where ws.id = p_card.current_step_id
	   and n.kind = 'open'
	   and p_card.archived_at is null
	   and p_card.deleted_at is null;
$$;

comment on function app.health_context(public.cards) is
	'CRM-066 tranche 4 §13.1, §13.4 — ce que les deux scores lisent d''une affaire OUVERTE, non archivée, hors corbeille : '
	'seuil de l''étape, jours dans l''étape, jours sans contact, probabilité effective. Aucune ligne sinon.';

revoke all on function app.health_last_contact(uuid) from public, anon;
revoke all on function app.health_context(public.cards) from public, anon;
grant execute on function app.health_tier(integer) to authenticated, service_role;
grant execute on function app.health_last_contact(uuid) to authenticated, service_role;
grant execute on function app.health_context(public.cards) to authenticated, service_role;

-- =============================================================================================
-- 2. Le score de dynamique — « quoi faire » (§13.2)
-- =============================================================================================

create or replace function public.health_momentum(public.cards)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_carte     public.cards := $1;
	v_ctx       record;
	v_penalites jsonb := '[]'::jsonb;
	v_points    integer := 0;
	v_retard    integer;
	v_score     integer;
begin
	select * into v_ctx from app.health_context(v_carte);
	if not found then
		return null;
	end if;

	if v_ctx.seuil_jours is not null and v_ctx.jours_dans_etape >= v_ctx.seuil_jours then
		v_penalites := v_penalites || jsonb_build_object('code', 'stale_step', 'points', 30,
			'days', v_ctx.jours_dans_etape, 'threshold', v_ctx.seuil_jours);
		v_points := v_points + 30;
	end if;

	-- UNE ACTION EN RETARD EXISTE : les deux pénalités de la prochaine action s'excluent (§13.2).
	if v_carte.next_action_at is not null and v_carte.next_action_at < now() then
		v_retard := floor(extract(epoch from (now() - v_carte.next_action_at)) / 86400.0)::integer;
		v_penalites := v_penalites || jsonb_build_object('code', 'next_action_overdue', 'points', 25, 'days', v_retard);
		v_points := v_points + 25;
	elsif nullif(btrim(coalesce(v_carte.next_action, '')), '') is null and v_carte.next_action_at is null then
		v_penalites := v_penalites || jsonb_build_object('code', 'next_action_missing', 'points', 15);
		v_points := v_points + 15;
	end if;

	if v_ctx.jours_sans_contact > 30 then
		v_penalites := v_penalites || jsonb_build_object('code', 'no_contact_30', 'points', 30,
			'days', v_ctx.jours_sans_contact);
		v_points := v_points + 30;
	elsif v_ctx.jours_sans_contact > 14 then
		v_penalites := v_penalites || jsonb_build_object('code', 'no_contact_14', 'points', 20,
			'days', v_ctx.jours_sans_contact);
		v_points := v_points + 20;
	end if;

	v_score := greatest(0, least(100, 100 - v_points));
	return jsonb_build_object('score', v_score, 'tier', app.health_tier(v_score), 'penalties', v_penalites);
end;
$$;

comment on function public.health_momentum(public.cards) is
	'CRM-066 tranche 4 §13.2 — colonne calculée : le score de dynamique d''une affaire ouverte, 100 moins des pénalités '
	'rendues une à une ({score, tier, penalties}). `null` pour une affaire décidée, archivée ou à la corbeille.';

-- =============================================================================================
-- 3. La santé commerciale — « les chances de gagner » (§13.3)
-- =============================================================================================

create or replace function public.health_commercial(public.cards)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
	v_carte     public.cards := $1;
	v_ctx       record;
	v_fraicheur integer;
	v_ponctuel  integer;
	v_age       integer;
	v_proba     integer;
	v_signaux   jsonb;
	v_somme     numeric := 0;
	v_poids     numeric := 0;
	v_score     integer;
	v_signal    jsonb;
begin
	select * into v_ctx from app.health_context(v_carte);
	if not found then
		return null;
	end if;

	v_proba := round(v_ctx.probabilite)::integer;

	-- 100 jusqu'à 7 jours sans contact, puis linéaire jusqu'à 0 à 30 jours.
	v_fraicheur := case
		when v_ctx.jours_sans_contact <= 7 then 100
		when v_ctx.jours_sans_contact >= 30 then 0
		else round(100.0 * (30 - v_ctx.jours_sans_contact) / 23.0)::integer
	end;

	-- 100 une échéance future, 60 une action sans échéance, 30 aucune action, 0 une échéance passée.
	v_ponctuel := case
		when v_carte.next_action_at is not null and v_carte.next_action_at < now() then 0
		when v_carte.next_action_at is not null then 100
		when nullif(btrim(coalesce(v_carte.next_action, '')), '') is not null then 60
		else 30
	end;

	-- 100 jusqu'à la moitié du seuil, puis linéaire jusqu'à 0 à une fois et demie le seuil ; sans seuil, inconnu.
	v_age := case
		when v_ctx.seuil_jours is null or v_ctx.seuil_jours <= 0 then null
		when v_ctx.jours_dans_etape <= 0.5 * v_ctx.seuil_jours then 100
		when v_ctx.jours_dans_etape >= 1.5 * v_ctx.seuil_jours then 0
		else round(100.0 * (1.5 * v_ctx.seuil_jours - v_ctx.jours_dans_etape) / v_ctx.seuil_jours)::integer
	end;

	v_signaux := jsonb_build_array(
		jsonb_build_object('code', 'probability', 'weight', 40, 'value', v_proba),
		jsonb_build_object('code', 'contact_freshness', 'weight', 25, 'value', v_fraicheur,
			'days', v_ctx.jours_sans_contact),
		jsonb_build_object('code', 'next_action_timeliness', 'weight', 20, 'value', v_ponctuel),
		jsonb_build_object('code', 'step_age', 'weight', 15, 'value', v_age,
			'days', v_ctx.jours_dans_etape, 'threshold', v_ctx.seuil_jours)
	);

	-- UN SIGNAL INCONNU NE COMPTE PAS POUR ZÉRO (§13.3) : il est marqué `unknown`, et son poids est réparti sur les
	-- signaux connus — la moyenne se fait sur les seuls poids connus.
	for v_signal in select * from jsonb_array_elements(v_signaux) loop
		if v_signal -> 'value' <> 'null'::jsonb then
			v_somme := v_somme + (v_signal ->> 'weight')::numeric * (v_signal ->> 'value')::numeric;
			v_poids := v_poids + (v_signal ->> 'weight')::numeric;
		end if;
	end loop;
	select coalesce(jsonb_agg(case when s -> 'value' = 'null'::jsonb then s || '{"status": "unknown"}' else s end), '[]')
	  into v_signaux
	  from jsonb_array_elements(v_signaux) s;

	v_score := round(v_somme / v_poids)::integer;
	return jsonb_build_object('score', v_score, 'tier', app.health_tier(v_score), 'signals', v_signaux);
end;
$$;

comment on function public.health_commercial(public.cards) is
	'CRM-066 tranche 4 §13.3 — colonne calculée : la santé commerciale d''une affaire ouverte, moyenne pondérée de quatre '
	'signaux ({score, tier, signals}) ; un signal inconnu voit son poids réparti. `null` pour une affaire décidée, '
	'archivée ou à la corbeille.';

revoke all on function public.health_momentum(public.cards) from public, anon;
revoke all on function public.health_commercial(public.cards) from public, anon;
grant execute on function public.health_momentum(public.cards) to authenticated, service_role;
grant execute on function public.health_commercial(public.cards) to authenticated, service_role;

notify pgrst, 'reload schema';
