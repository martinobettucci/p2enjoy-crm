-- @spec CRM-060 tranche 2 (docs/BACKLOG.md) — activation de la règle 3 du classement
-- @spec docs/SPEC-contacts.md §8 (la suggestion par expéditeur connu, colonnes et algorithme)
-- @spec docs/SPEC-mail-subsystem.md §4.4 (les quatre règles), §16.2 (la chaîne, la règle 3)
-- @spec docs/SCHEMA.md §12 (mail_messages) ; docs/SPEC-permissions-rls.md §7
--
-- CETTE MIGRATION LÈVE LA DÉSACTIVATION DE LA RÈGLE 3 (docs/SPEC-mail-subsystem.md §16.1).
--
-- La règle 3 SUGGÈRE, elle ne classe pas : classer automatiquement sur la seule foi d'un
-- expéditeur produirait des rattachements faux et difficiles à détecter (§4.4). La cible existe
-- depuis CRM-060 tranche 1 — `contacts` et `card_contacts` —, et le seed pose l'état exigé (Léo
-- Marchand sur exactement une card active). Il restait à écrire la règle dans le code de la relève.

-- =============================================================================================
-- 1. Où vit une suggestion — deux colonnes sur `mail_messages`
-- =============================================================================================
--
-- `suggested_card_id` est un INDICE, `card_id` un FAIT : le premier n'engage rien, le second est le
-- rattachement. L'invariant `mail_messages_classement_coherent` — `(classification='unclassified')
-- = (card_id is null)` — n'est PAS touché : une suggestion vit sur un message non classé, `card_id`
-- nul. `on delete set null` : supprimer la card suggérée efface l'indice sans emporter le message.

alter table public.mail_messages
	add column if not exists suggested_card_id uuid references public.cards (id) on delete set null;

alter table public.mail_messages
	add column if not exists suggested_at timestamptz;

comment on column public.mail_messages.suggested_card_id is
	'CRM-060 règle 3 (docs/SPEC-contacts.md §8) — card SUGGÉRÉE par expéditeur connu, calculée à la '
	'relève. Indice de tri pour l''inbox (CRM-057), jamais un classement : le message reste non '
	'classé. Nul quand aucun contact ne s''apparie, ou quand le contact n''a pas EXACTEMENT une '
	'card active.';

comment on column public.mail_messages.suggested_at is
	'CRM-060 règle 3 — horodate le calcul de la suggestion. Instantané de la relève, non recalculé '
	'si l''état des contacts change ensuite (docs/SPEC-contacts.md §8.3).';

-- =============================================================================================
-- 2. Le classement automatique — règles 1, 2, 3 et 4
-- =============================================================================================
--
-- L'ORDRE EST CELUI DU §4.4, ET IL S'ARRÊTE À LA PREMIÈRE RÈGLE QUI CLASSE. Les règles 1 et 2
-- classent ; la règle 3 ne classe pas, elle suggère, et n'est donc atteinte que lorsque les règles
-- 1 et 2 sont muettes. La chaîne rend toujours « non classé » (règle 4) après une suggestion.

create or replace function public.classer_message_automatiquement(
	p_message_id uuid,
	p_in_reply_to text default null,
	p_references text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_message         public.mail_messages%rowtype;
	v_card            uuid;
	v_cards_suggerees uuid[];
	v_suggestion      uuid;
begin
	select * into v_message from public.mail_messages m where m.id = p_message_id;
	if v_message.id is null then
		raise exception 'message_not_found' using errcode = 'P0002';
	end if;

	-- Un message DÉJÀ classé n'est pas reclassé : la règle 1 a parlé une fois, et un second
	-- passage de la relève ne doit pas déplacer du courrier.
	if v_message.classification <> 'unclassified' then
		return v_message.card_id;
	end if;

	-- RÈGLE 1 — une adresse de card figure parmi les destinataires.
	v_card := app.card_par_adresse(
		v_message.workspace_id,
		v_message.to_addresses || v_message.cc_addresses
	);

	-- RÈGLE 2 — la filiation, et seulement si la règle 1 n'a rien dit.
	if v_card is null and (p_in_reply_to is not null or p_references is not null) then
		select m.card_id into v_card
		  from public.mail_messages m
		 where m.workspace_id = v_message.workspace_id
		   and m.card_id is not null
		   and m.rfc822_message_id = any (
		         coalesce(p_references, array[]::text[]) ||
		         case when p_in_reply_to is null then array[]::text[] else array[p_in_reply_to] end
		       )
		 order by m.received_at desc
		 limit 1;

		-- La card du parent peut avoir été archivée depuis : la règle 2 hérite alors du refus de
		-- la règle 1, faute de quoi la filiation contournerait la règle du §16.2.
		if v_card is not null and not exists (
			select 1 from public.cards c
			 where c.id = v_card and c.archived_at is null and c.deleted_at is null
		) then
			v_card := null;
		end if;
	end if;

	-- RÈGLE 3 — l'expéditeur est un contact rattaché à EXACTEMENT UNE card active : on SUGGÈRE, on
	-- ne classe pas. Atteinte seulement quand les règles 1 et 2 sont muettes. L'unicité partielle
	-- (workspace_id, lower(email)) de `contacts` garantit AU PLUS un contact par email ; l'ambiguïté
	-- à trancher est donc du côté des CARDS. Une card archivée ou en corbeille ne compte pas, comme
	-- la règle 1 refuse de classer dans une card rangée (§16.2, docs/SPEC-contacts.md §8.2).
	if v_card is null then
		select array_agg(distinct cc.card_id)
		  into v_cards_suggerees
		  from public.contacts ct
		  join public.card_contacts cc
		    on cc.contact_id = ct.id and cc.workspace_id = ct.workspace_id
		  join public.cards c
		    on c.id = cc.card_id and c.workspace_id = cc.workspace_id
		 where ct.workspace_id = v_message.workspace_id
		   and ct.email is not null
		   and lower(ct.email) = lower(btrim(v_message.from_address))
		   and c.archived_at is null
		   and c.deleted_at is null;

		-- EXACTEMENT une : zéro n'invente rien, deux ou plus se tait plutôt que de choisir au
		-- hasard. On écrit la suggestion calculée — ou on l'efface —, de sorte qu'un second passage
		-- de la relève rende un résultat déterministe (docs/SPEC-contacts.md §8.3).
		if v_cards_suggerees is not null and array_length(v_cards_suggerees, 1) = 1 then
			v_suggestion := v_cards_suggerees[1];
		else
			v_suggestion := null;
		end if;

		update public.mail_messages m
		   set suggested_card_id = v_suggestion,
		       suggested_at = case when v_suggestion is null then null else now() end
		 where m.id = p_message_id;

		-- RÈGLE 4 — la règle 3 ne classe pas : le message reste non classé. Ce n'est pas une erreur.
		return null;
	end if;

	update public.mail_messages m
	   set card_id = v_card,
	       classification = 'auto',
	       classified_at = now()
	 where m.id = p_message_id;

	perform app.card_event_ecrire(
		v_card,
		v_message.workspace_id,
		'mail_received',
		jsonb_build_object('message_id', p_message_id, 'rule', 'auto')
	);

	-- Les pièces jointes suivent leur message : `card_id` y est recopié pour un accès direct
	-- depuis la card (docs/SCHEMA.md §12).
	update public.mail_attachments a set card_id = v_card where a.message_id = p_message_id;

	return v_card;
end;
$$;

comment on function public.classer_message_automatiquement is
	'CRM-055 + CRM-060 tranche 2 — règles 1, 2, 3 et 4 du §4.4. Les règles 1 et 2 classent ; la '
	'règle 3 SUGGÈRE (expéditeur contact rattaché à exactement une card active) sans classer ; la '
	'règle 4 laisse non classé. Réservée à service_role : le classement automatique est un constat '
	'de la relève.';

-- Les privilèges de la fonction sont inchangés (signature identique, ACL préservée par CREATE OR
-- REPLACE) ; ils sont ré-affirmés ici par prudence, comme sur toute fonction du projet.
revoke all on function public.classer_message_automatiquement(uuid, text, text[])
	from public, anon, authenticated;
grant execute on function public.classer_message_automatiquement(uuid, text, text[]) to service_role;
