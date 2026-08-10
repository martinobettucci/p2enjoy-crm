-- @spec CRM-056 (docs/BACKLOG.md) — renommage propagé d'un track, d'un channel ou d'une card
-- @spec docs/SPEC-mail-subsystem.md §4.5 (« un renommage RENOMME le dossier correspondant plutôt
--       que d'en créer un nouveau »), §17.1 (le RENAME emporte les enfants — mesuré)
-- @spec docs/JOURNAL.md décisions 323 et 324
--
-- CE QUE CETTE MIGRATION CORRIGE, ET POURQUOI LA PRÉCÉDENTE NE SUFFISAIT PAS.
--
-- La migration 26 ne mémorisait que le dossier d'une **card**, et ne savait renommer que lui.
-- Renommer un TRACK produisait donc ceci : la card était déplacée sous un nouveau chemin, et
-- l'ancien `CRM/Ancien track/Channel` restait derrière, vide. Le §4.5 demande l'inverse — renommer
-- le dossier correspondant, non en créer un nouveau —, et la mesure du §17.1 montre que le
-- `RENAME` d'un parent **emporte ses enfants**. Renommer au niveau qui a réellement changé est donc
-- à la fois plus juste et moins coûteux.
--
-- LA BASE NE PARLE TOUJOURS PAS IMAP : elle dit ce qui a divergé, et à quelle profondeur ; le
-- service renomme, puis rapporte ce que le serveur a retenu.

-- =============================================================================================
-- 1. Le chemin souhaité d'une entité, quel que soit son niveau
-- =============================================================================================

create or replace function public.chemin_dossier_entite(p_type text, p_id uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
	select case p_type
		when 'track' then (
			select 'CRM/' || app.assainir_segment_dossier(t.name)
			  from public.tracks t where t.id = p_id
		)
		when 'channel' then (
			select 'CRM/' || app.assainir_segment_dossier(t.name)
			       || '/' || app.assainir_segment_dossier(ch.name)
			  from public.channels ch
			  join public.tracks t on t.id = ch.track_id
			 where ch.id = p_id
		)
		when 'card' then public.chemin_dossier_card(p_id)
	end;
$$;

comment on function public.chemin_dossier_entite(text, uuid) is
	'CRM-056 §4.5 — le chemin souhaité d''un track, d''un channel ou d''une card. Le chemin d''une '
	'card reste dérivé par `chemin_dossier_card`, qui demeure la seule définition de la forme '
	'complète : deux définitions divergeraient.';

-- =============================================================================================
-- 2. Ce qui a divergé, et à quelle PROFONDEUR
-- =============================================================================================
--
-- LA PROFONDEUR N'EST PAS DÉCORATIVE : elle donne l'ordre dans lequel renommer. Renommer un track
-- AVANT ses cards emporte les enfants d'un seul geste ; l'inverse déplacerait chaque card une à
-- une, puis laisserait un track vide derrière.

-- `CREATE OR REPLACE` NE PEUT PAS CHANGER UN TYPE DE RETOUR — mesuré : la migration 26 déclarait
-- quatre colonnes, celle-ci en déclare six, et PostgreSQL refuse net. La fonction est donc retirée
-- avant d'être reposée. Le `drop` est explicite plutôt qu'implicite : une signature qui change est
-- un fait, pas un détail d'écriture.
drop function if exists public.dossiers_a_renommer(uuid);

create or replace function public.dossiers_a_renommer(p_account_id uuid)
returns table (
	entity_type    text,
	entity_id      uuid,
	profondeur     integer,
	actual_path    text,
	requested_path text,
	nouveau_chemin text
)
language sql
security definer
set search_path = ''
stable
as $$
	select m.entity_type,
	       m.entity_id,
	       case m.entity_type when 'track' then 1 when 'channel' then 2 else 3 end,
	       m.actual_path,
	       m.requested_path,
	       public.chemin_dossier_entite(m.entity_type, m.entity_id)
	  from public.mail_folder_map m
	 where m.account_id = p_account_id
	   and public.chemin_dossier_entite(m.entity_type, m.entity_id) is not null
	   and public.chemin_dossier_entite(m.entity_type, m.entity_id) <> m.requested_path
	 order by 3 asc, m.requested_path asc;
$$;

comment on function public.dossiers_a_renommer(uuid) is
	'CRM-056 §4.5 — les dossiers dont le chemin souhaité a changé, du plus HAUT au plus bas. '
	'Renommer un track avant ses cards emporte les enfants d''un seul geste (§17.1) ; l''inverse '
	'déplacerait chaque card une à une et laisserait un dossier vide derrière.';

-- =============================================================================================
-- 3. Rattacher les descendants après un renommage
-- =============================================================================================
--
-- LE SERVEUR A DÉJÀ DÉPLACÉ LES ENFANTS ; c'est la BASE qui l'ignore encore. Sans ce
-- rattachement, la correspondance d'une card pointerait vers un chemin que le serveur ne connaît
-- plus, et la relève suivante croirait devoir la renommer une seconde fois.

create or replace function public.mail_folder_map_reparenter(
	p_account_id       uuid,
	p_ancien_prefixe   text,
	p_nouveau_prefixe  text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_touchees integer;
begin
	update public.mail_folder_map m
	   set actual_path = p_nouveau_prefixe || substr(m.actual_path, length(p_ancien_prefixe) + 1),
	       requested_path = public.chemin_dossier_entite(m.entity_type, m.entity_id)
	 where m.account_id = p_account_id
	   and m.actual_path like p_ancien_prefixe || '/%';

	get diagnostics v_touchees = row_count;
	return v_touchees;
end;
$$;

comment on function public.mail_folder_map_reparenter is
	'CRM-056 §4.5 — après le renommage d''un parent, les descendants suivent EN BASE comme ils ont '
	'suivi sur le serveur. Sans cela, la relève suivante croirait devoir les renommer encore.';

revoke all on function public.chemin_dossier_entite(text, uuid) from public, anon, authenticated;
grant execute on function public.chemin_dossier_entite(text, uuid) to service_role;

revoke all on function public.dossiers_a_renommer(uuid) from public, anon, authenticated;
grant execute on function public.dossiers_a_renommer(uuid) to service_role;

revoke all on function public.mail_folder_map_reparenter(uuid, text, text)
	from public, anon, authenticated;
grant execute on function public.mail_folder_map_reparenter(uuid, text, text) to service_role;
