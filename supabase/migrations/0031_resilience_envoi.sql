-- @spec CRM-059 (docs/BACKLOG.md) — reprise d'un envoi, orphelins, état visible
-- @spec docs/SPEC-mail-subsystem.md §20.3 (le backoff et sa borne), §20.4 (l'envoi orphelin),
--       §20.7 (l'état affiché est conforme à la réalité), §7 (la file ne perd pas)
-- @spec docs/SCHEMA.md §7 ; docs/JOURNAL.md décision 331
--
-- CE QUE CETTE MIGRATION CORRIGE. `CRM-058` marquait un envoi échoué `failed` DÈS LA PREMIÈRE
-- tentative — honnête, et insuffisant : un serveur d'envoi momentanément indisponible perdait le
-- message. Les colonnes du backoff existaient déjà ; il leur manquait un consommateur.
--
-- LA DÉCISION DE REJOUER N'EST PAS PRISE ICI : elle appartient au service, qui connaît le code de
-- la panne (`mail_sync.backoff`), et qui l'éprouve **sans serveur**. La base exécute ce qu'on lui
-- demande — reprogrammer ou clore — et refuse tout ce qui n'est pas cohérent.

-- =============================================================================================
-- 1. Reprogrammer un envoi — §20.3
-- =============================================================================================

create or replace function public.reprogrammer_envoi(
	p_outbox_id      uuid,
	p_code           text,
	p_delai_secondes integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
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
		raise exception 'outbox_not_reschedulable' using errcode = 'P0002';
	end if;
	return v_tentatives;
end;
$$;

comment on function public.reprogrammer_envoi(uuid, text, integer) is
	'CRM-059 §20.3 — remet un envoi en file après une PANNE, avec son délai et sa tentative '
	'comptée. La décision de rejouer appartient au service : une panne se rejoue, un refus non.';

-- =============================================================================================
-- 1 bis. QUAND un envoi a été réservé — et pourquoi `updated_at` ne pouvait pas servir
-- =============================================================================================
--
-- MESURÉ EN ÉCRIVANT LA PREUVE : `mail_outbox` porte un trigger `BEFORE UPDATE` qui remet
-- `updated_at` à `now()` à chaque écriture. Juger l'âge d'une réservation sur cette colonne était
-- donc juste en production — réserver EST une écriture — mais rendait le fait **inobservable** :
-- toute tentative de vieillir la ligne la rajeunissait.
--
-- La colonne dédiée dit ce qu'elle mesure : l'instant de la RÉSERVATION, que rien d'autre ne
-- touche. Un fait qu'on ne peut pas observer n'est pas un fait prouvé.

alter table public.mail_outbox add column if not exists reserved_at timestamptz;

comment on column public.mail_outbox.reserved_at is
	'CRM-059 §20.4 — instant de la réservation par un worker. Distincte de `updated_at`, que le '
	'trigger remet à `now()` à chaque écriture : l''âge d''une réservation ne se lit pas sur une '
	'colonne que toute écriture rajeunit.';

-- =============================================================================================
-- 2. Les envois orphelins — §20.4
-- =============================================================================================
--
-- `reserver_envois` marque `sending` AVANT de soumettre. Si le worker meurt entre les deux, la
-- ligne reste `sending` pour toujours : aucune passe ne la reprend, et `CRM-058` le disait déjà —
-- « `reserved` peut dépasser `sent + failed` ».
--
-- LE SEUIL EST GÉNÉREUX À DESSEIN : un envoi lent n'est pas un envoi mort, et reprendre trop tôt
-- enverrait le message DEUX FOIS. Dix minutes valent mieux qu'un doublon chez le destinataire.

create or replace function public.reprendre_envois_orphelins(p_seuil_minutes integer default 10)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_reprises integer;
begin
	update public.mail_outbox
	   set status = 'queued',
	       attempts = attempts + 1,
	       next_attempt_at = now(),
	       last_error = 'worker_interrompu'
	 where status = 'sending'
	   and coalesce(reserved_at, updated_at) < now() - make_interval(mins => greatest(p_seuil_minutes, 1));

	get diagnostics v_reprises = row_count;
	return v_reprises;
end;
$$;

comment on function public.reprendre_envois_orphelins(integer) is
	'CRM-059 §20.4 — un envoi `sending` abandonné par un worker mort repasse `queued`. Le seuil '
	'est généreux : reprendre trop tôt enverrait le message deux fois.';

-- =============================================================================================
-- 3. L'état de la messagerie — §20.7
-- =============================================================================================
--
-- `SECURITY INVOKER` : l'état est celui que l'APPELANT a le droit de voir, et rien de plus. Une
-- fonction `DEFINER` aurait annoncé l'incident d'une boîte qu'il n'administre pas.
--
-- CE QUI EST MONTRÉ EST LU, JAMAIS SUPPOSÉ. La Definition of Done l'exige en ces termes : « état
-- affiché conforme à la réalité ».

create or replace function public.etat_messagerie()
returns table (
	account_id     uuid,
	label          text,
	status         text,
	last_error     text,
	last_sync_at   timestamptz,
	en_attente     bigint,
	en_echec       bigint
)
language sql
security invoker
set search_path = ''
stable
as $$
	select a.id,
	       a.label,
	       a.status,
	       a.last_error,
	       a.last_sync_at,
	       -- LES COMPTEURS SUIVENT LE WORKSPACE, NON LE COMPTE : la file d'envoi porte une
	       -- identité sortante, pas une boîte entrante. Les rattacher au compte serait inventer un
	       -- lien que le modèle n'a pas.
	       (select count(*) from public.mail_outbox o
	         where o.workspace_id = a.workspace_id and o.status in ('queued', 'sending')),
	       (select count(*) from public.mail_outbox o
	         where o.workspace_id = a.workspace_id and o.status = 'failed')
	  from public.mail_inbound_accounts a
	 order by a.label;
$$;

comment on function public.etat_messagerie() is
	'CRM-059 §20.7 — l''état réel de chaque boîte et de la file, tel que l''APPELANT a le droit de '
	'le voir. `SECURITY INVOKER` : la RLS fait le tri, l''écran ne devine rien.';

revoke all on function public.reprogrammer_envoi(uuid, text, integer)
	from public, anon, authenticated;
grant execute on function public.reprogrammer_envoi(uuid, text, integer) to service_role;

revoke all on function public.reprendre_envois_orphelins(integer) from public, anon, authenticated;
grant execute on function public.reprendre_envois_orphelins(integer) to service_role;

revoke all on function public.etat_messagerie() from public, anon;
grant execute on function public.etat_messagerie() to authenticated, service_role;
