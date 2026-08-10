-- @spec CRM-054 (docs/BACKLOG.md) — ingestion des messages
-- @spec docs/SPEC-mail-subsystem.md §4.2 (dédoublonnage et occurrences), §4.3 (pièces jointes),
--       §15.3 (l'empreinte de repli), §15.5 (l'ordre dépôt → analyse, le bucket privé)
-- @spec docs/SCHEMA.md §12 (`mail_messages`, `mail_message_occurrences`, `mail_attachments`)
-- @spec docs/SPEC-permissions-rls.md §7 (preuve de refus n° 9)
-- @spec docs/JOURNAL.md décision 320
--
-- CE QUE CETTE MIGRATION OUVRE, ET CE QU'ELLE REFUSE D'OUVRIR.
--
-- Elle crée les trois tables de l'ingestion et le bucket de Storage. Elle n'ouvre **aucun chemin de
-- téléchargement** : le bucket est PRIVÉ et ne porte aucune politique de lecture. Livrer ici une
-- politique ouvrirait le téléchargement d'une pièce `infected`, exactement ce que la preuve de
-- refus n° 9 interdit. Le téléchargement conditionné au statut `clean` appartient à `CRM-057`.
--
-- Aucune écriture n'est ouverte au client non plus : c'est `mail-sync`, avec la clé de service, qui
-- écrit. Un message est un FAIT reçu, pas une déclaration.

-- =============================================================================================
-- 1. Le message canonique
-- =============================================================================================

create table if not exists public.mail_messages (
	id                 uuid primary key default gen_random_uuid(),
	workspace_id       uuid not null references public.workspaces (id) on delete cascade,
	-- IDENTIFIANT DE DÉDOUBLONNAGE. Soit le `Message-ID` de l'expéditeur, soit l'empreinte de
	-- repli du §15.3, préfixée `fallback-sha256:` — le préfixe interdit qu'un expéditeur forge un
	-- `Message-ID` entrant en collision avec l'empreinte d'un autre message.
	rfc822_message_id  text not null,
	card_id            uuid references public.cards (id) on delete set null,
	-- `CRM-055` écrira `auto` ou `manual` ; jusque-là, tout message ingéré est NON CLASSÉ.
	classification     text not null default 'unclassified',
	from_address       text not null,
	from_name          text,
	to_addresses       text[] not null default '{}',
	cc_addresses       text[] not null default '{}',
	subject            text,
	body_text          text,
	body_html          text,
	sent_at            timestamptz,
	received_at        timestamptz not null default now(),
	created_at         timestamptz not null default now(),
	constraint mail_messages_dedoublonnage unique (workspace_id, rfc822_message_id),
	constraint mail_messages_classification
		check (classification in ('unclassified', 'auto', 'manual')),
	-- Un message classé porte une card, un message non classé n'en porte pas. L'invariant est
	-- écrit ici pour que `CRM-055` ne puisse pas le rompre par inadvertance.
	constraint mail_messages_classement_coherent
		check ((classification = 'unclassified') = (card_id is null))
);

comment on table public.mail_messages is
	'CRM-054 — message canonique, dédoublonné sur (workspace_id, rfc822_message_id). Un message '
	'est un FAIT reçu : aucun client ne l''écrit. Le classement appartient à CRM-055.';

comment on column public.mail_messages.rfc822_message_id is
	'Message-ID de l''expéditeur, ou empreinte de repli préfixée `fallback-sha256:` (§15.3). Le '
	'préfixe interdit la collision avec un Message-ID forgé.';

-- =============================================================================================
-- 2. Les occurrences — un même message vu dans plusieurs boîtes
-- =============================================================================================
--
-- « Un même message arrive fréquemment deux fois : dans la boîte système et dans la boîte
-- personnelle mirroir » (§4.2). Le message n'est pas dupliqué ; une occurrence est ajoutée.

create table if not exists public.mail_message_occurrences (
	message_id uuid not null references public.mail_messages (id) on delete cascade,
	account_id uuid not null references public.mail_inbound_accounts (id) on delete cascade,
	folder     text not null,
	uid        bigint not null,
	flags      text[] not null default '{}',
	seen_at    timestamptz not null default now(),
	primary key (message_id, account_id, folder)
);

comment on table public.mail_message_occurrences is
	'CRM-054 — où un message a été VU : compte, dossier, UID. C''est ce qui permet à un message '
	'd''exister à la fois dans l''inbox globale et dans une card (docs/SPEC-mail-subsystem.md §4.2).';

-- =============================================================================================
-- 3. Les pièces jointes
-- =============================================================================================

create table if not exists public.mail_attachments (
	id             uuid primary key default gen_random_uuid(),
	message_id     uuid not null references public.mail_messages (id) on delete cascade,
	card_id        uuid references public.cards (id) on delete set null,
	-- LE NOM D'ORIGINE EST CONSERVÉ À CÔTÉ DU NOM ASSAINI : le perdre priverait l'utilisateur de
	-- ce que l'expéditeur a voulu transmettre, et n'assainirait rien de plus (§15.5).
	filename       text not null,
	original_name  text,
	mime_type      text not null,
	size_bytes     bigint not null,
	-- `<workspace_id>/<message_id>/<sha256>` — AUCUN nom de fichier : un nom d'origine dans un
	-- chemin de stockage est une traversée de répertoire qui attend son heure.
	storage_path   text not null,
	sha256         text not null,
	av_status      text not null default 'pending',
	av_checked_at  timestamptz,
	created_at     timestamptz not null default now(),
	constraint mail_attachments_av_statut
		check (av_status in ('pending', 'clean', 'infected', 'skipped')),
	constraint mail_attachments_sha256_forme
		check (sha256 ~ '^[0-9a-f]{64}$'),
	constraint mail_attachments_taille_positive check (size_bytes >= 0),
	constraint mail_attachments_nom_borne
		check (char_length(filename) between 1 and 255),
	-- Le chemin ne contient JAMAIS de nom de fichier : trois segments, et le dernier est une
	-- empreinte hexadécimale.
	constraint mail_attachments_chemin_sans_nom
		check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{64}$')
);

comment on table public.mail_attachments is
	'CRM-054 — pièces jointes déposées dans Storage puis analysées. Une pièce n''est '
	'téléchargeable qu''en statut clean, et CRM-057 livrera ce chemin : cette migration n''ouvre '
	'AUCUNE lecture du bucket (preuve de refus n° 9).';

comment on column public.mail_attachments.av_status is
	'pending à la création — donc non téléchargeable —, puis clean, infected ou skipped. Le dépôt '
	'PRÉCÈDE l''analyse : une pièce infectée est conservée pour investigation (§4.3, §15.5).';

create index if not exists mail_messages_workspace_idx
	on public.mail_messages (workspace_id, received_at desc);
create index if not exists mail_messages_card_idx
	on public.mail_messages (card_id) where card_id is not null;
create index if not exists mail_attachments_message_idx
	on public.mail_attachments (message_id);
create index if not exists mail_occurrences_compte_idx
	on public.mail_message_occurrences (account_id, folder, uid);

-- =============================================================================================
-- 4. Le bucket, PRIVÉ et sans politique de lecture
-- =============================================================================================
--
-- MESURÉ avant cette unité : `storage.buckets` est VIDE, ce que la preuve de refus n° 9 avait
-- figé. Le bucket naît ici, et il naît fermé.

insert into storage.buckets (id, name, public)
values ('mail-attachments', 'mail-attachments', false)
on conflict (id) do update set public = false;

comment on table public.mail_message_occurrences is
	'CRM-054 — où un message a été VU : compte, dossier, UID (docs/SPEC-mail-subsystem.md §4.2).';

-- =============================================================================================
-- 5. RLS et privilèges
-- =============================================================================================
--
-- LA LECTURE SUIT LA CARD, ET RIEN D'AUTRE. Un message classé se lit si l'on peut lire sa card ;
-- un message NON CLASSÉ n'est lisible par personne à travers PostgREST, faute d'un porteur de
-- droit — l'inbox globale, qui décidera qui voit les non classés, appartient à `CRM-057`. Le dire
-- vaut mieux qu'inventer ici une règle que l'unité suivante devrait défaire.

alter table public.mail_messages enable row level security;
alter table public.mail_message_occurrences enable row level security;
alter table public.mail_attachments enable row level security;

drop policy if exists mail_messages_lecture on public.mail_messages;
create policy mail_messages_lecture
	on public.mail_messages
	for select
	to authenticated
	using (card_id is not null and app.can_read_card(card_id));

drop policy if exists mail_attachments_lecture on public.mail_attachments;
create policy mail_attachments_lecture
	on public.mail_attachments
	for select
	to authenticated
	using (card_id is not null and app.can_read_card(card_id));

-- Les occurrences disent OÙ un message a été vu, donc dans quelle boîte : c'est une information
-- d'exploitation, et elle suit le compte, non la card.
drop policy if exists mail_occurrences_lecture on public.mail_message_occurrences;
create policy mail_occurrences_lecture
	on public.mail_message_occurrences
	for select
	to authenticated
	using (
		exists (
			select 1
			  from public.mail_inbound_accounts a
			 where a.id = account_id
			   and (a.owner_id = (select auth.uid()) or app.is_workspace_admin(a.workspace_id))
		)
	);

revoke all on public.mail_messages from anon, authenticated;
revoke all on public.mail_message_occurrences from anon, authenticated;
revoke all on public.mail_attachments from anon, authenticated;

grant select on public.mail_messages to authenticated;
grant select on public.mail_message_occurrences to authenticated;
grant select on public.mail_attachments to authenticated;

grant all privileges on public.mail_messages to service_role;
grant all privileges on public.mail_message_occurrences to service_role;
grant all privileges on public.mail_attachments to service_role;
