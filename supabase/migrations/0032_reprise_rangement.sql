-- @spec CRM-059 (docs/BACKLOG.md) — la reprise d'un rangement manqué, dette de `CRM-056`
-- @spec docs/SPEC-mail-subsystem.md §20.5 (la dette), §4.5 (dossiers IMAP, copie et non déplacement)
-- @spec docs/SCHEMA.md §12 (`mail_messages`, `mail_message_occurrences`)
-- @spec docs/JOURNAL.md décision 342
--
-- `CRM-056` tentait le rangement à la PREMIÈRE vue d'un message et journalisait un refus sans le
-- rejouer : un dossier introuvable au moment du classement, ou une copie IMAP refusée, laissait le
-- message classé en base et absent de son dossier pour toujours — jusqu'à recevoir un nouveau
-- message qui, lui, déclencherait un rangement neuf sans jamais reprendre l'ancien.
--
-- LA BASE PORTE LE FAIT, LE SERVICE PORTE LA REPRISE. `filed_at` dit QUAND un message a réellement
-- été copié dans le dossier de sa card — jamais SUPPOSÉ à la classification, puisque la copie peut
-- échouer après coup. `messages_a_ranger` est la sélection que la relève rejoue à chaque tour ;
-- `marquer_message_range` est l'unique écriture qui referme le fait.

-- =============================================================================================
-- 1. `filed_at` — quand le message a été COPIÉ, jamais quand il a été classé
-- =============================================================================================

alter table public.mail_messages add column if not exists filed_at timestamptz;

comment on column public.mail_messages.filed_at is
	'CRM-059 §20.5 — instant où le message a été COPIÉ dans le dossier IMAP de sa card. Nul pour un '
	'message non classé, ou classé mais dont le rangement a échoué : c''est ce second cas que la '
	'relève suivante reprend, sans attendre un nouveau message pour le déclencher.';

-- =============================================================================================
-- 2. La sélection — un message classé, jamais rangé, avec de quoi le copier
-- =============================================================================================
--
-- UNE SEULE OCCURRENCE PAR MESSAGE, LA PLUS ANCIENNE (`seen_at`) : ranger exige un dossier SOURCE
-- et un UID, et n'importe laquelle des occurrences de ce compte convient — le message est le même
-- partout où il apparaît. Prendre la première vue est déterministe et ne dépend pas de l'ordre de
-- retour du serveur.

create or replace function public.messages_a_ranger(p_account_id uuid)
returns table (message_id uuid, card_id uuid, folder text, uid bigint)
language sql
security definer
set search_path = ''
stable
as $$
	select distinct on (m.id)
	       m.id, m.card_id, o.folder, o.uid
	  from public.mail_messages m
	  join public.mail_message_occurrences o
	    on o.message_id = m.id and o.account_id = p_account_id
	 where m.card_id is not null
	   and m.filed_at is null
	 order by m.id, o.seen_at asc;
$$;

comment on function public.messages_a_ranger(uuid) is
	'CRM-059 §20.5 — les messages classés dont AUCUNE occurrence n''est rangée dans le dossier de '
	'leur card, pour ce compte. La relève les reprend à chaque tour, sans nouveau message.';

-- =============================================================================================
-- 3. La fermeture du fait — un `UPDATE`, rien de plus
-- =============================================================================================

create or replace function public.marquer_message_range(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
	update public.mail_messages set filed_at = now() where id = p_message_id;
$$;

comment on function public.marquer_message_range(uuid) is
	'CRM-059 §20.5 — ferme le fait qu''un message a été COPIÉ dans le dossier de sa card. Appelée '
	'uniquement après une copie IMAP réussie, jamais à la classification.';

revoke all on function public.messages_a_ranger(uuid) from public, anon, authenticated;
grant execute on function public.messages_a_ranger(uuid) to service_role;

revoke all on function public.marquer_message_range(uuid) from public, anon, authenticated;
grant execute on function public.marquer_message_range(uuid) to service_role;
