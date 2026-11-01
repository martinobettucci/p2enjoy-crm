-- @spec CRM-055 (docs/BACKLOG.md) — tranche INC-326 : une pièce jointe hérite de l'affaire de son message — déclencheur
--       avant insertion et rattrapage de l'existant
-- @spec docs/SCHEMA.md « Migration `0142` » ; docs/JOURNAL.md décision 795 ; docs/INCONSISTENCY_REPORT.md INC-326
--
-- `mail_attachments.card_id` recopie l'affaire du message pour un accès direct. Les classements (0070, 0109) réécrivent
-- les pièces PRÉSENTES au moment du geste ; or la relève classe le message avant d'en inscrire les pièces, qui naissaient
-- donc sans affaire. L'invariant se place à l'insertion de la pièce, en base, où vivent les règles de classement.
-- Aucune politique ni aucun privilège ne change : la lecture d'une pièce suit toujours son message (0024, 0029).
--
-- IDEMPOTENCE : `create or replace`, déclencheur retiré puis recréé ; le rattrapage ne touche que les pièces sans affaire
-- d'un message classé.

create or replace function app.mail_attachments_card_from_message()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	-- Une affaire posée par l'appelant est gardée : l'archive d'un envoi (0106) l'écrit elle-même.
	if new.card_id is null then
		select m.card_id into new.card_id from public.mail_messages m where m.id = new.message_id;
	end if;
	return new;
end;
$$;

comment on function app.mail_attachments_card_from_message() is
	'INC-326 (0142) : une pièce insérée sans affaire prend celle de son message.';

drop trigger if exists mail_attachments_card_from_message on public.mail_attachments;
create trigger mail_attachments_card_from_message
	before insert on public.mail_attachments
	for each row execute function app.mail_attachments_card_from_message();

-- Le rattrapage : les pièces d'un message classé, restées sans affaire.
update public.mail_attachments a
   set card_id = m.card_id
  from public.mail_messages m
 where m.id = a.message_id
   and a.card_id is null
   and m.card_id is not null;
