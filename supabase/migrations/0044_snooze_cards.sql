-- @spec CRM-081 (docs/BACKLOG.md) — snooze des fils et des cards, TRANCHE 1 : la règle, sa garde
--       et sa trace
-- @spec docs/SPEC-cards.md §16 (le chapitre), §16.2 (ce que « en sommeil » signifie et pourquoi
--       aucun réveil planifié n'est écrit), §16.3 (`snooze_card` et ses quatre refus), §16.4
--       (`wake_card` et son idempotence), §16.5 (la trace est écrite par un trigger), §16.6 (qui
--       peut mettre en sommeil), §16.7 (la colonne se ferme), §16.8 (contrat d'API)
-- @spec docs/SPEC-cards.md §5 (ce que « active » signifie), §14.4 (vocabulaire de `card_events`),
--       §14.5 (`app.card_event_ecrire`, seule voie d'écriture), §14.6 (le payload ne porte aucun
--       libellé)
-- @spec docs/SPEC-permissions-rls.md §3.3 (`app.can_read_channel`), §4.3 (règle de discrétion),
--       §4.4 (une colonne constatée par le serveur n'est pas offerte au client), §7 (preuve de
--       refus n° 1)
-- @spec docs/SCHEMA.md §5 (`card_events`), §9 (fonctions et RPC)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
--
-- ---------------------------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION LIVRE, ET CE QU'ELLE NE LIVRE PAS.
-- ---------------------------------------------------------------------------------------------
-- `cards.snoozed_until` existe depuis la migration 11 et n'a jamais eu ni geste, ni règle, ni
-- lecteur : MESURÉ le 2026-08-16, les 41 cards du seed la portent nulle, et la migration 14
-- l'ouvre en écriture directe à `authenticated`. Une colonne qu'un client peut écrire librement et
-- que personne ne lit n'est pas une fonctionnalité ; c'est une place réservée.
--
-- Livré ici : les deux gestes gardés, la fermeture de la colonne, et les deux événements de fil.
--
-- Non livré, et nommé (§16.1) : tout écran, tout filtre de vue, tout seed, et le sommeil des fils
-- de messagerie — tranche 2.
--
-- IDEMPOTENTE ET CONVERGENTE au sens d'INC-035 : les fonctions sont recréées, la contrainte de
-- vocabulaire est CONVERGÉE — cette migration en devient la dernière autorité, comme la 30 l'était
-- (INC-074) —, et le `revoke` de colonne se rejoue sans erreur.

-- =============================================================================================
-- 1. Le vocabulaire du fil passe de douze à quatorze valeurs — docs/SPEC-cards.md §16.5
-- =============================================================================================
-- La contrainte n'est pas ajoutée « si elle n'existe pas » : elle est REMPLACÉE dès qu'elle ne
-- porte pas déjà `snoozed`. C'est la forme retenue par la migration 30, et c'est ce qui répare un
-- rétrécissement manuel au lieu de le constater.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname  = 'card_events_type_check'
		   and pg_get_constraintdef(oid) like '%snoozed%'
	) and not exists (
		-- INC-144 — DEUXIÈME GARDE, celle des migrations 20, 25 et 30, qui manquait ici. La
		-- première ne regarde que la contrainte et ne voit rien lorsqu'elle a été déposée ou
		-- réduite ; les lignes, elles, peuvent déjà porter un type qu'une migration POSTÉRIEURE a
		-- livré. Tant que ces quatorze valeurs étaient les plus larges du dépôt, l'omission était
		-- inerte. La migration 54 (`CRM-062`) en a posé une quinzième, `stalled`, et le seed en
		-- écrit quatre lignes : sans cette garde, la convergence tentait de reposer une contrainte
		-- que les données violent, le rejeu s'arrêtait ici en `23514`, et les migrations 45 à 54 ne
		-- s'appliquaient plus du tout — INC-210, MESURÉ le 2026-08-25.
		--
		-- On ne converge donc que si les lignes sont compatibles avec les quatorze valeurs que
		-- CETTE migration pose. Sinon la 54 reste seule responsable du vocabulaire complet, ce
		-- qu'elle sait faire : sa propre garde ne regarde que `stalled`.
		select 1 from public.card_events
		 where type <> all (array[
			'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
			'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
			'mail_received', 'mail_sent', 'snoozed', 'woken'])
	) then
		alter table public.card_events drop constraint if exists card_events_type_check;
		alter table public.card_events add constraint card_events_type_check
			check (type = any (array[
				'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
				'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
				'mail_received', 'mail_sent', 'snoozed', 'woken'
			]));
	end if;
end;
$$;

comment on column public.card_events.type is
	'CRM-044, CRM-081 — docs/SPEC-cards.md §14.4 et §16.5. QUATORZE valeurs livrées. `snoozed` et '
	'`woken` sont écrits par `app.card_events_apres_maj_sommeil()`, trigger de TABLE : une '
	'écriture de `snoozed_until` par la clé de service laisse elle aussi sa trace.';

-- =============================================================================================
-- 2. La trace, sur la TABLE et non dans les fonctions — docs/SPEC-cards.md §16.5
-- =============================================================================================
-- `public.card_events` n'accorde aucun privilège d'écriture, `service_role` compris (§14) : la
-- trace ne PEUT pas être écrite par `snooze_card`. Elle l'est par un trigger `AFTER UPDATE OF`,
-- qui appelle la seule voie d'écriture existante.
--
-- Un trigger SÉPARÉ, et non une garde de plus dans `app.card_events_apres_maj_card()` : redéfinir
-- cette fonction obligerait à recopier ses cinq gardes, dont la condition de `moved` posée par la
-- migration 17 — une recopie est une occasion de perdre une règle. L'ajout est donc additif.
--
-- `is distinct from` comme les cinq gardes de `CRM-044` : une écriture qui ne déplace pas la
-- valeur n'allonge pas l'histoire, ce qui rend un rejeu convergent.

create or replace function app.card_events_apres_maj_sommeil()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.snoozed_until is distinct from old.snoozed_until then
		if new.snoozed_until is null then
			perform app.card_event_ecrire(new.id, new.workspace_id, 'woken',
				jsonb_build_object('from', old.snoozed_until));
		else
			perform app.card_event_ecrire(new.id, new.workspace_id, 'snoozed',
				jsonb_build_object('until', new.snoozed_until));
		end if;
	end if;

	return null;
end;
$$;

alter function app.card_events_apres_maj_sommeil() owner to postgres;

comment on function app.card_events_apres_maj_sommeil() is
	'CRM-081 — docs/SPEC-cards.md §16.5. Écrit `snoozed` et `woken`. `AFTER` et rend `null` : il '
	'n''influence jamais la ligne écrite. Une échéance REPORTÉE — date vers autre date — écrit un '
	'second `snoozed` : c''est un geste, non une erreur (§16.3).';

drop trigger if exists card_events_apres_maj_sommeil on public.cards;
create trigger card_events_apres_maj_sommeil
	after update of snoozed_until on public.cards
	for each row execute function app.card_events_apres_maj_sommeil();

-- =============================================================================================
-- 3. La colonne se ferme en écriture directe — docs/SPEC-cards.md §16.7
-- =============================================================================================
-- MESURÉ avant ce changement : `has_column_privilege('authenticated', 'public.cards',
-- 'snoozed_until', 'update')` rend `t`. La migration 14 l'énumère parmi les douze ouvertes.
--
-- Elle en sort : sa valeur cesse d'être une saisie libre pour devenir le constat d'un geste gardé
-- (docs/SPEC-permissions-rls.md §4.4). Sans cette fermeture, les quatre refus du §16.3 seraient
-- contournables par un `PATCH`, et la garde ne garderait rien.
--
-- `service_role` conserve `all privileges` de la migration 11 : le seed et l'exploitation restent
-- capables d'écrire la colonne, et le trigger de la section 2 les trace.
--
-- Les ONZE autres colonnes ouvertes restent ouvertes : le `revoke` est nominatif.

revoke update (snoozed_until) on public.cards from authenticated;

comment on column public.cards.snoozed_until is
	'CRM-040, CRM-081 — docs/SPEC-cards.md §16.2. Échéance de mise en sommeil. Une card est en '
	'sommeil si cette valeur est non nulle ET strictement postérieure à `now()` : la sortie est '
	'IMPLICITE, aucun réveil planifié n''est écrit. NON MODIFIABLE par `authenticated` depuis '
	'CRM-081 : elle s''écrit par `public.snooze_card` et `public.wake_card`, et par elles seules.';

-- =============================================================================================
-- 4. `public.snooze_card` — docs/SPEC-cards.md §16.3
-- =============================================================================================
-- `SECURITY DEFINER` pour deux raisons distinctes, et les deux comptent : la colonne vient d'être
-- fermée, donc l'appelant ne peut plus l'écrire lui-même ; et les politiques RLS de `cards` ne
-- s'appliquent pas au propriétaire de la table, donc la fonction ne peut RIEN leur déléguer et
-- vérifie elle-même la lisibilité et le droit d'écriture.
--
-- `search_path` vidé, toute relation pleinement qualifiée — même règle qu'à `move_card`.

drop function if exists public.snooze_card(uuid, timestamptz);

create function public.snooze_card(
	card_id uuid,
	until   timestamptz
) returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
	-- Recopiés avant tout usage : `card_id` est aussi un nom de colonne des tables lues plus bas,
	-- et PL/pgSQL refuse une référence ambiguë (`42702`) plutôt que d'en choisir une.
	v_card_id uuid := card_id;
	v_until   timestamptz := until;
	v_card    public.cards%rowtype;
begin
	-- --- 1 La card existe, est ACTIVE, et son channel est lisible de l'appelant ----------------
	-- Même garde et même ordre qu'à `move_card` (§16.3) : une card invisible est ABSENTE, jamais
	-- « interdite ». Répondre « interdit » confirmerait son existence à qui n'a pas le droit de la
	-- connaître (docs/SPEC-permissions-rls.md §4.3).
	--
	-- `P0001` par défaut, donc `400`. `P0002` serait rendu `500` par PostgREST et lu comme une
	-- panne du produit.
	select c.* into v_card
	  from public.cards c
	 where c.id = v_card_id
	   and c.archived_at is null
	   and c.deleted_at  is null
	   and app.can_read_channel(c.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	-- --- 2 L'appelant a le droit d'ÉCRITURE sur le channel de la card -------------------------
	-- `42501` → `403`. La garde n° 1 ayant réussi, un refus ici désigne bien un lecteur : c'est la
	-- preuve de refus n° 1 de docs/SPEC-permissions-rls.md §7, exercée par un geste de plus.
	if not app.can_write_channel(v_card.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- --- 3 L'échéance est fournie -------------------------------------------------------------
	-- Une mise en sommeil sans échéance serait un archivage, geste qui existe déjà (§4).
	if v_until is null then
		raise exception 'snooze_date_required';
	end if;

	-- --- 4 L'échéance est future --------------------------------------------------------------
	-- Le prédicat du §16.2 rendrait la card immédiatement hors sommeil : l'écriture serait
	-- acceptée et sans effet observable, succès simulé que CLAUDE.md §18 proscrit.
	if v_until <= now() then
		raise exception 'snooze_date_in_past';
	end if;

	-- Une card DÉJÀ en sommeil est acceptée : reporter une échéance est un geste ordinaire, et le
	-- fil en porte un second `snoozed` (§16.3). `updated_at` est posée par le trigger de CRM-040.
	update public.cards c
	   set snoozed_until = v_until
	 where c.id = v_card_id
	returning c.* into v_card;

	return v_card;
end;
$$;

alter function public.snooze_card(uuid, timestamptz) owner to postgres;

comment on function public.snooze_card(uuid, timestamptz) is
	'CRM-081 — docs/SPEC-cards.md §16.3. Seul chemin par lequel une affaire entre en sommeil. '
	'Refus, dans l''ordre où la garde les oppose : card_not_found, forbidden, '
	'snooze_date_required, snooze_date_in_past. Rend la ligne mise à jour, la garde n° 1 ayant '
	'établi que l''appelant a le droit de la lire.';

-- =============================================================================================
-- 5. `public.wake_card` — docs/SPEC-cards.md §16.4
-- =============================================================================================

drop function if exists public.wake_card(uuid);

create function public.wake_card(
	card_id uuid
) returns public.cards
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_card_id uuid := card_id;
	v_card    public.cards%rowtype;
begin
	-- Mêmes gardes n° 1 et n° 2, dans le même ordre, et aucun refus propre (§16.4).
	select c.* into v_card
	  from public.cards c
	 where c.id = v_card_id
	   and c.archived_at is null
	   and c.deleted_at  is null
	   and app.can_read_channel(c.channel_id);

	if not found then
		raise exception 'card_not_found';
	end if;

	if not app.can_write_channel(v_card.channel_id) then
		raise exception 'forbidden' using errcode = '42501';
	end if;

	-- IDEMPOTENCE ASSUMÉE, et c'est une décision : sur une card qui ne dort pas, la fonction ne
	-- refuse pas et n'engendre AUCUN événement — le trigger de la section 2 compare
	-- `is distinct from`, et `null` vers `null` ne déplace rien. Deux onglets ouverts sur la même
	-- affaire ne doivent pas produire deux traces pour un seul réveil (§16.4).
	update public.cards c
	   set snoozed_until = null
	 where c.id = v_card_id
	returning c.* into v_card;

	return v_card;
end;
$$;

alter function public.wake_card(uuid) owner to postgres;

comment on function public.wake_card(uuid) is
	'CRM-081 — docs/SPEC-cards.md §16.4. Sortie explicite du sommeil. Mêmes gardes que '
	'`snooze_card`, aucun refus propre, et IDEMPOTENTE : une card qui ne dort pas est rendue telle '
	'quelle, sans événement de fil.';

-- =============================================================================================
-- 6. Privilèges d'appel — docs/SPEC-cards.md §16.6
-- =============================================================================================
-- Les deux fonctions sont ouvertes à `authenticated` : le droit réel est vérifié DANS la fonction,
-- en base (CLAUDE.md §10). `anon` n'en reçoit aucun — un appelant anonyme n'a ni card, ni channel.

-- `revoke ... from public` ne suffit PAS dans le schéma `public` : `anon` conserve un `EXECUTE`
-- propre, posé par les `ALTER DEFAULT PRIVILEGES` de la distribution. La règle est écrite depuis
-- la décision 80 (docs/SCHEMA.md §9) ; la suite pgTAP de cette unité l'a REMESURÉE en rendant
-- rouge son assertion sur `anon` avant que ce `revoke` nominatif soit écrit. Un refus
-- serait certes opposé plus loin, `auth.uid()` étant nulle pour un anonyme, mais une garde qui
-- s'en remet à une seconde garde n'en est pas une.
revoke all on function public.snooze_card(uuid, timestamptz) from public, anon;
revoke all on function public.wake_card(uuid) from public, anon;
grant execute on function public.snooze_card(uuid, timestamptz) to authenticated, service_role;
grant execute on function public.wake_card(uuid) to authenticated, service_role;
