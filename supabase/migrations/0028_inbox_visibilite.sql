-- @spec CRM-057 (docs/BACKLOG.md) — inbox globale : qui voit un message non classé
-- @spec docs/SPEC-mail-subsystem.md §18.1 (la visibilité suit la boîte), §18.2 (classer exige les
--       deux droits), §18.3 (l'arborescence ne montre que ce qui porte du courrier)
-- @spec docs/SPEC-permissions-rls.md §4 (politiques par famille), §3.5 (une politique ne relit
--       jamais sa propre table) ; docs/SCHEMA.md §7, §9
-- @spec docs/JOURNAL.md décision 327
--
-- CE QUE CETTE MIGRATION TRANCHE, ET QU'AUCUNE AUTRE NE POUVAIT TRANCHER.
--
-- `CRM-054` a laissé la question dans sa propre migration : « un message NON CLASSÉ n'est lisible
-- par personne à travers PostgREST, faute d'un porteur de droit ». La réponse n'invente rien : un
-- message non classé n'existe que par ses OCCURRENCES, et la politique des occurrences existe déjà
-- — propriétaire du compte, ou administrateur du workspace. La visibilité d'un non classé est donc
-- celle de la BOÎTE où il a été vu, et pas une notion nouvelle.
--
-- CONSÉQUENCE NOMMÉE : un membre ordinaire ne voit AUCUN message non classé. Ouvrir le tri à tous
-- exposerait du courrier dont personne n'a établi qu'il concerne le workspace. Une assertion fige
-- cette absence ; elle devra être RÉVISÉE, non retirée, le jour où un rôle de tri existera.

-- =============================================================================================
-- 1. La boîte d'un message, sans jamais relire `mail_messages`
-- =============================================================================================
--
-- LA SIGNATURE OBÉIT AU §3.5 DE `docs/SPEC-permissions-rls.md` : cette fonction est appelée par la
-- politique de `mail_messages`, et une politique dont le prédicat relit sa propre table refuse le
-- `RETURNING` d'une écriture — défaut mesuré, décision 107. Elle ne lit donc QUE les occurrences et
-- les comptes, et reçoit l'identifiant de la ligne évaluée.

create or replace function app.boite_du_message_lisible(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
	select exists (
		select 1
		  from public.mail_message_occurrences o
		  join public.mail_inbound_accounts a on a.id = o.account_id
		 where o.message_id = p_message_id
		   and (a.owner_id = (select auth.uid()) or app.is_workspace_admin(a.workspace_id))
	);
$$;

comment on function app.boite_du_message_lisible(uuid) is
	'CRM-057 §18.1 — vrai si l''appelant peut voir la BOÎTE où ce message a été vu : propriétaire '
	'du compte, ou administrateur du workspace. Ne lit PAS `mail_messages` : elle est appelée par '
	'la politique de cette table (docs/SPEC-permissions-rls.md §3.5).';

alter function app.boite_du_message_lisible(uuid) owner to postgres;

-- =============================================================================================
-- 2. Voir un message : sa card s'il est classé, sa boîte dans tous les cas
-- =============================================================================================
--
-- ELLE RELIT `mail_messages`, ET C'EST PERMIS : aucune politique de `mail_messages` ne l'appelle.
-- Elle sert aux tables FILLES — pièces jointes, objets de stockage — et à la garde de classement.
--
-- L'UNION N'EST PAS UN ÉLARGISSEMENT DISCUTABLE : le propriétaire d'une boîte a vu ce message
-- arriver chez lui. Le lui retirer parce qu'un collègue l'a classé dans une card qu'il ne lit pas
-- ferait disparaître de sa vue un courrier qui lui était adressé.

create or replace function app.peut_voir_message(p_message_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
	select exists (
		select 1
		  from public.mail_messages m
		 where m.id = p_message_id
		   and m.card_id is not null
		   and app.can_read_card(m.card_id)
	) or app.boite_du_message_lisible(p_message_id);
$$;

comment on function app.peut_voir_message(uuid) is
	'CRM-057 §18.1 — visibilité d''un message : sa card s''il est classé, sa boîte dans tous les '
	'cas. Employée par les politiques des tables FILLES et par la garde de `classify_message`, '
	'jamais par la politique de `mail_messages` elle-même.';

alter function app.peut_voir_message(uuid) owner to postgres;

revoke all on function app.boite_du_message_lisible(uuid) from public, anon;
revoke all on function app.peut_voir_message(uuid) from public, anon;
grant execute on function app.boite_du_message_lisible(uuid) to authenticated, service_role;
grant execute on function app.peut_voir_message(uuid) to authenticated, service_role;

-- =============================================================================================
-- 3. Les politiques révisées
-- =============================================================================================

drop policy if exists mail_messages_lecture on public.mail_messages;
create policy mail_messages_lecture
	on public.mail_messages
	for select
	to authenticated
	using (
		(card_id is not null and app.can_read_card(card_id))
		or app.boite_du_message_lisible(id)
	);

-- La pièce suit son MESSAGE, non sa card : une pièce de message non classé n'a pas de card, et la
-- politique de `CRM-054` la rendait donc invisible à tous — y compris à qui devait la trier.
drop policy if exists mail_attachments_lecture on public.mail_attachments;
create policy mail_attachments_lecture
	on public.mail_attachments
	for select
	to authenticated
	using (app.peut_voir_message(message_id));

-- =============================================================================================
-- 4. Classer exige les DEUX droits — le défaut du §18.2
-- =============================================================================================
--
-- CE QUE LA VERSION PRÉCÉDENTE PERMETTAIT, ET QUI N'ÉTAIT PAS THÉORIQUE : `classify_message` ne
-- vérifiait que le droit d'ÉCRITURE sur la card cible. Tant qu'aucun message non classé n'était
-- lisible, cela ne se voyait pas. Dès qu'un écran expose des identifiants de messages, un membre
-- disposant du droit d'écriture sur UNE seule card peut désigner un message qu'il n'a pas le droit
-- de voir, le classer CHEZ LUI, puis le lire en toute légitimité : le contrôle d'accès contourné
-- par l'écriture. On ne déplace que ce qu'on a le droit de prendre.

create or replace function public.classify_message(p_message_id uuid, p_card_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message public.mail_messages%rowtype;
	v_appelant uuid := (select auth.uid());
begin
	if v_appelant is null then
		raise exception 'not_authenticated' using errcode = '42501';
	end if;

	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		raise exception 'message_not_found' using errcode = 'P0002';
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
		   and c.archived_at is null
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
$$;

comment on function public.classify_message(uuid, uuid) is
	'CRM-055 §16.3, révisée par CRM-057 §18.2 — classement manuel. Exige LES DEUX droits : voir le '
	'message et écrire dans la card. Journalise son auteur, écrit un card_event `mail_received`, '
	'et reste idempotent.';

revoke all on function public.classify_message(uuid, uuid) from public, anon;
grant execute on function public.classify_message(uuid, uuid) to authenticated, service_role;

-- =============================================================================================
-- 5. L'arborescence de l'inbox — §18.3
-- =============================================================================================
--
-- `SECURITY INVOKER`, ET C'EST LE POINT : les compteurs sont ceux des messages que l'APPELANT
-- voit, non ceux qui existent. Deux utilisateurs voient deux nombres différents, et c'est la
-- conséquence directe du §18.1. Une fonction `DEFINER` aurait annoncé du courrier introuvable.
--
-- ELLE EXISTE POUR NE PAS TOUT CHARGER : sans elle, l'écran devrait lire chaque message pour
-- compter ses dossiers. Le résultat est borné par le nombre de cards portant du courrier, non par
-- le nombre de messages, qui croît sans limite (CLAUDE.md §21).

create or replace function public.inbox_arborescence()
returns table (
	track_id     uuid,
	track_name   text,
	channel_id   uuid,
	channel_name text,
	card_id      uuid,
	card_title   text,
	nombre       bigint
)
language sql
security invoker
set search_path = ''
stable
as $$
	-- La ligne des NON CLASSÉS vient toujours en premier, et existe même à zéro : c'est l'entrée
	-- du travail de tri, et sa disparition ferait croire à une panne (§18.3).
	select null::uuid, null::text, null::uuid, null::text, null::uuid, null::text, count(*)
	  from public.mail_messages m
	 where m.card_id is null
	union all
	select t.id, t.name, ch.id, ch.name, c.id, c.title, count(*)
	  from public.mail_messages m
	  join public.cards c on c.id = m.card_id
	  join public.channels ch on ch.id = c.channel_id
	  join public.tracks t on t.id = ch.track_id
	 group by t.id, t.name, ch.id, ch.name, c.id, c.title
	 order by 2 nulls first, 4, 6;
$$;

comment on function public.inbox_arborescence() is
	'CRM-057 §18.3 — les dossiers de l''inbox et leur nombre de messages VISIBLES par l''appelant. '
	'`SECURITY INVOKER` : les compteurs suivent la RLS. La ligne des non classés porte des '
	'identifiants nuls et vient toujours en tête, même à zéro.';

revoke all on function public.inbox_arborescence() from public, anon;
grant execute on function public.inbox_arborescence() to authenticated, service_role;

-- =============================================================================================
-- 6. Le prédicat de téléchargement d'une pièce jointe — §18.5
-- =============================================================================================
--
-- IL VIT ICI, ET NON DANS LA MIGRATION QUI POSE LA POLITIQUE, POUR UNE RAISON DE SÉCURITÉ. La
-- politique de `storage.objects` doit être créée par `supabase_admin`, seul rôle habilité sur une
-- table qui appartient à `supabase_storage_admin` (mesuré, §18.5). Or `supabase_admin` est
-- SUPERUTILISATEUR : une fonction `SECURITY DEFINER` créée sous ce rôle s'exécuterait avec les
-- droits d'un superutilisateur. Le prédicat est donc créé ici, sous `postgres`, et la migration 30
-- ne fait que l'appeler.

create or replace function app.piece_jointe_telechargeable(p_chemin text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
	select exists (
		select 1
		  from public.mail_attachments a
		 where a.storage_path = p_chemin
		   -- LES TROIS AUTRES STATUTS RESTENT REFUSÉS : `pending` n'a pas encore été analysé,
		   -- `skipped` n'a pas pu l'être, `infected` l'a été et a échoué. Un fichier non analysé
		   -- n'est pas un fichier sain (docs/SPEC-mail-subsystem.md §4.3).
		   and a.av_status = 'clean'
		   and app.peut_voir_message(a.message_id)
	);
$$;

comment on function app.piece_jointe_telechargeable(text) is
	'CRM-057 §18.5 — vrai si l''objet de stockage désigné par ce chemin est une pièce jointe '
	'`clean` dont le message est visible par l''appelant. Créée sous `postgres` à dessein : la '
	'politique qui l''appelle est posée par `supabase_admin`, qui est superutilisateur.';

alter function app.piece_jointe_telechargeable(text) owner to postgres;

revoke all on function app.piece_jointe_telechargeable(text) from public, anon;
grant execute on function app.piece_jointe_telechargeable(text) to authenticated, service_role;
