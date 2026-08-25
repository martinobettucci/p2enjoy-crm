-- @spec CRM-060 (docs/BACKLOG.md) — contacts et organisations, TRANCHE 5 : le fil de l'affaire
--       apprend les rattachements
-- @spec docs/SPEC-contacts.md §19 (le chapitre), §19.2 (un trigger de TABLE, et pourquoi pas les
--       écrans), §19.3 (les trois types et leur payload), §19.4 (la migration et ses DEUX gardes),
--       §19.6 (aucune autorisation ajoutée), §19.7 (contrat de comportement)
-- @spec docs/SPEC-cards.md §14.4 (vocabulaire de `card_events`), §14.5 (`app.card_event_ecrire`,
--       seule voie d'écriture), §14.6 (le payload ne porte aucun libellé), §14.7 (aucun privilège
--       d'écriture sur `card_events`)
-- @spec docs/ARBITRAGES.md §5 décision 517 (l'arbitrage qui ouvre cette tranche)
-- @spec docs/SCHEMA.md §5 (`card_events`), §6 (`card_contacts`)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE, ET CE QU'ELLE NE LIVRE PAS.
-- ---------------------------------------------------------------------------------------------
-- Le §12.8 nommait l'écart depuis la sous-tranche 4c : « le fil unifié n'apprend rien de ce geste.
-- `card_contacts` n'écrit aucun `card_event` ». La décision 517 tranche : un rattachement est un
-- fait de la vie de l'affaire au même titre qu'un déplacement, et la timeline est l'endroit où le
-- produit répond à « que s'est-il passé ? ».
--
-- Livré ici : trois valeurs de vocabulaire, une fonction de trigger, trois triggers.
--
-- Non livré, et nommé (§19.1) : aucune trace côté CONTACT — sa fiche n'a pas de fil —, et aucun
-- filtre nouveau ; la barre du §5.11 reste à cinq bascules.
--
-- IDEMPOTENTE ET CONVERGENTE au sens d'INC-035 : la fonction est recréée, les triggers sont
-- déposés puis reposés, et la contrainte de vocabulaire est convergée sous DEUX gardes.

-- =============================================================================================
-- 1. Le vocabulaire passe de quinze à DIX-HUIT valeurs — docs/SPEC-contacts.md §19.3
-- =============================================================================================
-- LES DEUX GARDES D'INC-144, ET LA SECONDE N'EST PAS DÉCORATIVE. La migration 44 ne portait que la
-- première ; le jour où la 54 a posé une quinzième valeur, `stalled`, le rejeu du répertoire s'est
-- arrêté en `23514` sur la 44 et les migrations suivantes ne s'appliquaient plus du tout — INC-210,
-- mesurée le 2026-08-25, corrigée le même jour. La leçon est appliquée ici plutôt que redécouverte :
--
--   1. la première garde regarde la CONTRAINTE : ne converger que si `contact_linked` en est absent,
--      ce qui répare un rétrécissement manuel au lieu de le constater ;
--   2. la seconde regarde les LIGNES : ne pas converger si l'une porte un type que CETTE migration
--      ne connaît pas — une valeur posée par une migration POSTÉRIEURE. Sans elle, cette migration
--      deviendrait à son tour bloquante le jour d'une dix-neuvième valeur.
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname  = 'card_events_type_check'
		   and pg_get_constraintdef(oid) like '%contact_linked%'
	) and not exists (
		select 1 from public.card_events
		 where type <> all (array[
			'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
			'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
			'mail_received', 'mail_sent', 'snoozed', 'woken', 'stalled',
			'contact_linked', 'contact_unlinked', 'contact_role_changed'])
	) then
		alter table public.card_events drop constraint if exists card_events_type_check;
		alter table public.card_events add constraint card_events_type_check
			check (type = any (array[
				'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
				'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
				'mail_received', 'mail_sent', 'snoozed', 'woken', 'stalled',
				'contact_linked', 'contact_unlinked', 'contact_role_changed'
			]));
	end if;
end;
$$;

comment on column public.card_events.type is
	'CRM-044, CRM-081, CRM-062, CRM-060 — docs/SPEC-cards.md §14.4 et §16.5, '
	'docs/SPEC-relances.md §9.8, docs/SPEC-contacts.md §19.3. DIX-HUIT valeurs livrées. '
	'`contact_linked`, `contact_unlinked` et `contact_role_changed` sont écrits par '
	'`app.card_events_apres_maj_contacts()`, trigger de TABLE : un rattachement posé par la clé de '
	'service — un import, le seed — laisse lui aussi sa trace.';

-- =============================================================================================
-- 2. La trace, sur la TABLE et non dans les écrans — docs/SPEC-contacts.md §19.2
-- =============================================================================================
-- TROIS SURFACES ÉCRIVENT DÉJÀ DANS `card_contacts` — la fiche d'affaire (4c), la fiche de contact
-- (4h, 4i) et la modification du rôle (4j) —, et rien n'interdit qu'une quatrième arrive. Une trace
-- écrite par chaque écran serait trois fois la même règle, donc trois occasions de diverger, et une
-- quatrième surface l'oublierait en silence. Le trigger suit la DONNÉE, pas le geste.
--
-- `security definer`, propriétaire `postgres` : `public.card_events` n'accorde aucun privilège
-- d'écriture, `service_role` compris (§14.7), et l'écriture passe donc par `app.card_event_ecrire`,
-- seule voie existante depuis `CRM-044`.
--
-- LE PAYLOAD NE PORTE AUCUN LIBELLÉ (§14.6, §19.3) : ni le nom du contact, ni celui de son
-- organisation. Un nom recopié dans un événement IMMUABLE devient faux le jour où le contact est
-- renommé, et le fil se mettrait à mentir sur son propre passé. L'écran résout le nom à la lecture.
create or replace function app.card_events_apres_maj_contacts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_op = 'INSERT' then
		perform app.card_event_ecrire(new.card_id, new.workspace_id, 'contact_linked',
			jsonb_build_object('contact_id', new.contact_id, 'role', new.role));
	elsif tg_op = 'DELETE' then
		-- LA CARD PEUT AVOIR DISPARU AVANT SES RATTACHEMENTS, ET C'EST UNE PREUVE EXISTANTE QUI
		-- L'A ÉTABLI. `card_contacts` référence `cards` en `on delete cascade` : supprimer une
		-- affaire retire ses rattachements, et le trigger tentait alors d'écrire « contact
		-- détaché » dans le fil d'une affaire qui n'existe plus. MESURÉ le 2026-08-25 par
		-- `supabase/tests/0049_card_costs.test.sql` :
		--
		--   ERROR: insert or update on table "card_events" violates foreign key constraint
		--          "card_events_card_id_workspace_id_fkey"
		--
		-- La suppression de l'affaire ÉCHOUAIT donc entièrement — un défaut du produit, non de la
		-- preuve. La trace n'est écrite que si l'affaire est encore là : un fil appartient à sa
		-- card, et l'histoire d'une affaire supprimée n'a nulle part où s'écrire. Le détachement
		-- individuel, lui, garde sa trace — c'est le cas b du §19.7, et il est prouvé.
		if exists (select 1 from public.cards c where c.id = old.card_id) then
			perform app.card_event_ecrire(old.card_id, old.workspace_id, 'contact_unlinked',
				jsonb_build_object('contact_id', old.contact_id, 'role', old.role));
		end if;
	-- `is distinct from` comme les cinq gardes de `CRM-044` : une écriture qui ne déplace pas la
	-- valeur n'allonge pas l'histoire, ce qui rend un rejeu convergent. Deux nulls sont « la même
	-- valeur » pour cet opérateur, ce qui est exactement le comportement voulu.
	elsif new.role is distinct from old.role then
		perform app.card_event_ecrire(new.card_id, new.workspace_id, 'contact_role_changed',
			jsonb_build_object('contact_id', new.contact_id, 'from', old.role, 'to', new.role));
	end if;

	-- `after` et rend `null` : le trigger n'influence jamais la ligne écrite.
	return null;
end;
$$;

alter function app.card_events_apres_maj_contacts() owner to postgres;

comment on function app.card_events_apres_maj_contacts() is
	'CRM-060 tranche 5 — docs/SPEC-contacts.md §19.2 et §19.3. Écrit `contact_linked`, '
	'`contact_unlinked` et `contact_role_changed`. Trigger de TABLE : la trace suit la donnée, non '
	'le geste, de sorte qu''une quatrième surface ne puisse pas l''oublier. Le payload ne porte '
	'aucun libellé (§14.6) : un nom recopié deviendrait faux au premier renommage.';

drop trigger if exists card_events_apres_ajout_contact on public.card_contacts;
create trigger card_events_apres_ajout_contact
	after insert on public.card_contacts
	for each row execute function app.card_events_apres_maj_contacts();

drop trigger if exists card_events_apres_retrait_contact on public.card_contacts;
create trigger card_events_apres_retrait_contact
	after delete on public.card_contacts
	for each row execute function app.card_events_apres_maj_contacts();

-- `of role` : une écriture qui ne touche pas le rôle ne réveille même pas le trigger.
drop trigger if exists card_events_apres_role_contact on public.card_contacts;
create trigger card_events_apres_role_contact
	after update of role on public.card_contacts
	for each row execute function app.card_events_apres_maj_contacts();

-- =============================================================================================
-- 3. Aucune autorisation n'est ajoutée, et c'est un point de contrôle — §19.6
-- =============================================================================================
-- Aucune politique n'est créée, aucune n'est modifiée, aucun privilège n'est accordé. La lecture
-- d'un événement suit celle de son affaire : un profil qui ne lit pas l'affaire ne lit pas ses
-- rattachements, et la RLS de `card_events` décide seule.
