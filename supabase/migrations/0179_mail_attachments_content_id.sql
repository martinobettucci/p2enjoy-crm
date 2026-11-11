-- @spec CRM-140 (docs/BACKLOG.md) — tranche T1 : le `Content-ID` d'une pièce jointe, que le corps HTML d'un message désigne
--       par `cid:` (docs/SPEC-mail-subsystem.md §30.6 ; docs/SCHEMA.md « Migration `0179` » ; docs/JOURNAL.md
--       décisions 881 et 918)
--
-- AUCUNE POLITIQUE NOUVELLE. La colonne se lit sous la RLS de la pièce (`CRM-054`, §18.1), son fichier sous la politique de
-- stockage de la `0029` (pièce saine, message lisible). Seul `mail-sync`, sous la clé de service, l'écrit : `authenticated`
-- n'a aucun droit d'écriture sur `mail_attachments`, et la migration ne lui en donne aucun.
--
-- RETOUR ARRIÈRE : `alter table public.mail_attachments drop column content_id;` — une webapp et un `mail-sync` antérieurs
-- l'ignorent, et un `mail-sync` de cette unité ne l'envoie que pour une pièce qui en porte un.

alter table public.mail_attachments
	add column content_id text null;

alter table public.mail_attachments
	add constraint mail_attachments_content_id_borne
	check (content_id is null or char_length(content_id) between 1 and 255);

comment on column public.mail_attachments.content_id is
	'CRM-140 (docs/SPEC-mail-subsystem.md §30.6) : le Content-ID de la partie MIME, sans ses chevrons — ce qu''une image cid: du corps HTML désigne. Null pour une pièce qui n''en porte pas, et pour toute pièce relevée avant la migration.';
