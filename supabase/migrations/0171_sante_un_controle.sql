-- @spec CRM-142 (docs/BACKLOG.md) — la santé d'un rattachement sous un seul contrôle de droits : `app.health_context`
--       relit le rattachement, contrôle `app.can_read_channel` une fois, puis lit sans RLS (INC-352)
-- @spec docs/SPEC-analytique.md §13.10 (révise §13.5 pour `app.health_context` seule ; précision de la décision 890) ;
--       docs/SCHEMA.md « Migration `0171` » ; docs/JOURNAL.md décisions 887, 888 et 890
--
-- LE DÉFAUT MESURÉ (INC-352) : en production, le board d'un channel de 53 rattachements met 8,59 s, dont 98 % dans
-- `health_momentum` et `health_commercial`. Toutes deux appellent `app.health_context`, qui était `SECURITY INVOKER` :
-- l'affaire, ses activités et ses courriers y étaient relus sous la RLS de l'appelant, les politiques réévaluées à chaque
-- appel, et `app.can_read_card` à chaque activité et à chaque courrier.
--
-- LA FORME (décision 888) : la fonction garde sa signature et son résultat. Elle devient `SECURITY DEFINER`, à
-- `search_path` vide, et commence par UN SEUL contrôle : le rattachement relu en base par son identifiant — jamais les
-- valeurs passées par l'appelant —, lisible si `app.can_read_channel(channel_id)`, la règle exacte de
-- `card_placements_select`. Sans lui, elle ne rend rien, avant toute autre lecture. Le contrôle passé, l'étape, le nœud,
-- l'affaire et le dernier contact se lisent sous les droits du propriétaire : l'appelant qui lit le rattachement lit déjà
-- toute l'affaire, ses activités et ses courriers (`app.can_read_card`), et l'espace (il en est membre). Mêmes lignes,
-- même résultat ; seul l'appel direct sur un rattachement illisible, d'une affaire lisible par un autre channel, devient
-- vide. `health_momentum`, `health_commercial` et `app.health_last_contact` restent `SECURITY INVOKER`, inchangées.
--
-- QUI EST L'APPELANT (décision 890) : `app.can_read_channel` lit `auth.uid()`, l'identité du jeton, que `SECURITY DEFINER`
-- ne change pas. Un appelant qui CONTOURNAIT la RLS — la clé de service, le propriétaire en session directe — lisait la
-- santé de tout rattachement ; il la lit encore : son rôle, `current_setting('role')` (que `SECURITY DEFINER` ne change
-- pas non plus), ou `session_user` hors `SET ROLE`, porte `rolbypassrls` ou `rolsuper`. Un jeton d'utilisateur ne peut pas
-- changer ce rôle. Un rattachement illisible et un identifiant inconnu rendent le même ensemble vide.

CREATE OR REPLACE FUNCTION app.health_context(p_card public.card_placements)
 RETURNS TABLE(seuil_jours integer, jours_dans_etape integer, jours_sans_contact integer, probabilite numeric)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
	v_rattachement public.card_placements;
begin
	-- LE CONTRÔLE, AVANT TOUTE AUTRE LECTURE : la ligne en base, et le droit de la lire.
	select * into v_rattachement from public.card_placements where id = p_card.id;
	if not found then
		return;
	end if;
	if not app.can_read_channel(v_rattachement.channel_id)
	   and not exists (
		select 1 from pg_catalog.pg_roles r
		 where r.rolname = coalesce(nullif(pg_catalog.current_setting('role'), 'none'), session_user::text)
		   and (r.rolbypassrls or r.rolsuper)) then
		return;
	end if;

	return query
	select coalesce(ws.stale_after_days, n.default_stale_after_days),
	       floor(extract(epoch from (now() - v_rattachement.entered_step_at)) / 86400.0)::integer,
	       -- UNE AFFAIRE JAMAIS CONTACTÉE COMPTE DEPUIS SA CRÉATION (§13.2) : créée hier, elle n'est pas « sans contact
	       -- depuis 30 jours ».
	       floor(extract(epoch from (now() - coalesce(app.health_last_contact(v_rattachement.card_id), a.created_at)))
	             / 86400.0)::integer,
	       coalesce(v_rattachement.probability_override, ws.probability_override, n.default_probability)
	  from public.workflow_steps ws
	  join public.cards a on a.id = v_rattachement.card_id
	  join public.workflow_nodes_catalog n on n.id = ws.node_id
	 where ws.id = v_rattachement.current_step_id
	   and n.kind = 'open'
	   and v_rattachement.archived_at is null
	   and a.deleted_at is null;
end;
$function$;

comment on function app.health_context(public.card_placements) is
	'CRM-142 (docs/SPEC-analytique.md §13.10) : le contexte des deux scores de santé, sous un seul contrôle — le rattachement relu par son identifiant, lisible par app.can_read_channel ; vide sinon. SECURITY DEFINER.';

revoke all on function app.health_context(public.card_placements) from public, anon;
grant execute on function app.health_context(public.card_placements) to authenticated, service_role;
