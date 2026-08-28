-- @spec CRM-055 (docs/BACKLOG.md) — classement assisté, tranche 2 : le DÉCLASSEMENT d'un message,
--       c'est-à-dire retirer un message de l'affaire où il avait été classé
-- @spec docs/SPEC-mail-subsystem.md §16.5 (les trois mesures, le contrat opposable de cinq lignes,
--       l'historique conservé et le départ écrit, ce que la tranche ne fait pas)
-- @spec docs/SPEC-mail-subsystem.md §16.3 (le classement manuel, dont ceci est l'exact inverse)
-- @spec docs/SPEC-permissions-rls.md §7 (un refus se prouve hors interface, avec le jeton réel)
-- @spec docs/SPEC-cards.md §14.4 (vocabulaire de la timeline) ; docs/SCHEMA.md §7, §9
-- @spec docs/JOURNAL.md décision 536
--
-- CE QUE CETTE MIGRATION TRANCHE, ET QUE PERSONNE N'AVAIT TRANCHÉ.
--
-- Le §16.3 écrivait « Déclasser n'est pas prévu », et renvoyait la question — ce que devient
-- l'événement de timeline déjà écrit — « à l'unité qui livrera l'écran ». Cette unité, `CRM-057`,
-- est livrée depuis le 2026-08-11 et n'a pas tranché : l'écart n'était imputable à personne.
--
-- LA MESURE QUI DÉCIDE LES DROITS, relevée avant d'écrire une règle (§16.5.1, mesure 2). Sur le
-- message classé du seed, le `bizdev` ÉCRIT la card et voit le message PAR ELLE SEULE — il ne voit
-- pas la boîte d'arrivée. Le `card_id` remis à nul, `app.peut_voir_message` devient faux pour lui :
-- il ne peut plus ni relire ni reclasser. Deux issues étaient raisonnables, et l'écartée est dite :
-- exiger EN PLUS de voir la boîte aurait mis le message à l'abri, au prix d'interdire au `bizdev`
-- de DÉFAIRE SON PROPRE GESTE. Un geste qu'on ne peut pas défaire est pire que le geste lui-même.
-- Les droits exigés sont donc EXACTEMENT ceux du classement : voir le message, écrire la card.
-- On ne retire que ce qu'on aurait pu poser.

-- =============================================================================================
-- 1. Le vocabulaire de la timeline passe à DIX-NEUF — docs/SPEC-mail-subsystem.md §16.5.3
-- =============================================================================================
--
-- POURQUOI UN TYPE NEUF PLUTÔT QUE L'EFFACEMENT DE L'ANCIEN. Le `mail_received` déjà écrit est
-- CONSERVÉ : le courrier EST arrivé dans cette card, et réécrire une histoire vraie n'est pas une
-- correction. `card_events` n'accorde d'ailleurs aucune écriture de correction, `service_role`
-- compris (`CRM-044`, mesuré par `CRM-055`). Mais ne rien écrire du départ laisserait la timeline
-- dire « courrier reçu » en désignant un message qui n'y est plus : une PERTE SILENCIEUSE. Le
-- produit porte déjà le précédent exact — `contact_linked` a son `contact_unlinked` depuis la
-- migration `0061`.
--
-- LA GARDE REPREND CELLE DE LA MIGRATION `0061`, MOT POUR MOT DANS SON INTENTION : la contrainte
-- n'est remplacée que si elle ne connaît pas encore la valeur neuve ET qu'aucune ligne ne porte un
-- type que cette migration ignorerait — une valeur posée par une migration POSTÉRIEURE. Sans elle,
-- celle-ci deviendrait bloquante le jour d'une vingtième valeur.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname  = 'card_events_type_check'
		   and pg_get_constraintdef(oid) like '%mail_unclassified%'
	) and not exists (
		select 1 from public.card_events
		 where type <> all (array[
			'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
			'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
			'mail_received', 'mail_sent', 'mail_unclassified', 'snoozed', 'woken', 'stalled',
			'contact_linked', 'contact_unlinked', 'contact_role_changed'])
	) then
		alter table public.card_events drop constraint if exists card_events_type_check;
		alter table public.card_events add constraint card_events_type_check
			check (type = any (array[
				'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
				'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
				'mail_received', 'mail_sent', 'mail_unclassified', 'snoozed', 'woken', 'stalled',
				'contact_linked', 'contact_unlinked', 'contact_role_changed'
			]));
	end if;
end;
$$;

comment on column public.card_events.type is
	'CRM-044, CRM-081, CRM-062, CRM-060, CRM-055 — docs/SPEC-cards.md §14.4 et §16.5, '
	'docs/SPEC-relances.md §9.8, docs/SPEC-contacts.md §19.3, docs/SPEC-mail-subsystem.md §16.5.3. '
	'DIX-NEUF valeurs livrées. `mail_unclassified` est écrit par `public.unclassify_message` sur la '
	'card QUITTÉE : le `mail_received` d''origine est conservé, l''historique ne se réécrit pas, et '
	'sans cette trace la timeline désignerait un message qui n''y est plus.';

-- =============================================================================================
-- 2. `unclassify_message` — le contrat opposable du §16.5.2
-- =============================================================================================
--
-- ELLE REND LA CARD QUITTÉE, ET C'EST UTILE : l'appelant peut perdre la visibilité du message dans
-- le même geste (mesure 2), si bien qu'une relecture derrière l'appel ne lui apprendrait plus rien.
-- La valeur de retour est la seule trace qu'il conserve du geste qu'il vient d'accomplir.
--
-- LES CINQ LIGNES DU CONTRAT, dans l'ordre où elles sont évaluées :
--   a. appelant anonyme                                       => not_authenticated, 42501
--   b. message inconnu                                        => message_not_found, P0002
--   c. l'appelant ne VOIT pas le message                      => forbidden, 42501
--   d. l'appelant ne peut pas ÉCRIRE la card où il est classé => forbidden, 42501
--   e. le message n'est pas classé                            => aucun refus, rend null, n'écrit rien
--
-- L'ORDRE N'EST PAS INDIFFÉRENT. La ligne c précède la d : demander « pouvez-vous écrire la card
-- de ce message ? » à qui n'a pas le droit de savoir dans quelle card il est lui apprendrait déjà
-- quelque chose. Et la ligne e vient APRÈS les deux gardes : un message non classé rend `null`
-- sans rien divulguer, mais seulement à qui avait le droit de poser la question.

create or replace function public.unclassify_message(p_message_id uuid)
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

	-- LE PREMIER DES DEUX DROITS — voir le message, exactement comme au classement (§18.2). Il est
	-- évalué AVANT que le `card_id` ne bouge : après l'écriture, il pourrait être devenu faux.
	if not app.peut_voir_message(p_message_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- LIGNE e — idempotence. Un message déjà non classé n'a pas de card à quitter : aucun
	-- événement, aucune écriture. Un utilisateur qui clique deux fois ne raconte pas deux
	-- histoires, et c'est la règle que le §16.3 pose déjà pour le classement.
	if v_message.card_id is null then
		return null;
	end if;

	-- LE SECOND — déclasser RETIRE du contenu de la card : le droit d'ÉCRITURE est exigé, le même
	-- qu'au classement. La symétrie est le contrat : on ne retire que ce qu'on aurait pu poser.
	if not app.can_write_card(v_message.card_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- L'EXACT INVERSE DE `classify_message`, et rien de plus. `suggested_card_id` n'est PAS
	-- recalculé (§16.5.4) : la règle 3 du §4.4 est un constat de la RELÈVE, jamais d'un geste
	-- humain, et la rejouer ici ferait réapparaître une proposition automatique derrière une
	-- décision explicite de l'utilisateur.
	update public.mail_messages m
	   set card_id = null,
	       classification = 'unclassified',
	       classified_by = null,
	       classified_at = null
	 where m.id = p_message_id;

	update public.mail_attachments a set card_id = null where a.message_id = p_message_id;

	-- LE DÉPART S'ÉCRIT SUR LA CARD QUITTÉE (§16.5.3). Le `subject` accompagne le `message_id`
	-- parce que la timeline doit rester lisible à qui ne peut PLUS ouvrir le message : sans lui,
	-- la ligne ne porterait qu'un identifiant que personne ne peut résoudre.
	perform app.card_event_ecrire(
		v_message.card_id,
		v_message.workspace_id,
		'mail_unclassified',
		jsonb_build_object('message_id', p_message_id, 'subject', v_message.subject)
	);

	return v_message.card_id;
end;
$$;

comment on function public.unclassify_message(uuid) is
	'CRM-055 §16.5 — déclassement d''un message. Exige LES DEUX MÊMES droits que `classify_message` '
	'— voir le message et écrire la card —, évalués AVANT le geste. Remet `card_id`, '
	'`classified_by` et `classified_at` à nul, `classification` à `unclassified`, et détache les '
	'pièces. Conserve le `mail_received` d''origine et écrit un `mail_unclassified` sur la card '
	'quittée. Idempotente : un message non classé rend `null` sans rien écrire. Rend la card '
	'quittée, seule trace qui reste à un appelant que le geste prive de la visibilité du message.';

revoke all on function public.unclassify_message(uuid) from public, anon;
grant execute on function public.unclassify_message(uuid) to authenticated, service_role;
