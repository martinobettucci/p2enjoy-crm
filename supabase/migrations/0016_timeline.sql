-- @spec CRM-044 (docs/BACKLOG.md) — timeline unifiée, `card_events` alimentée par triggers
-- @spec docs/SPEC-cards.md §14.2 (modèle), §14.3 (`clock_timestamp()`), §14.4 (les huit types),
--       §14.5 (les triggers et leur `SECURITY DEFINER`), §14.6 (payloads), §14.7 (autorisations),
--       §14.8 (immuabilité)
-- @spec docs/SCHEMA.md §5 (`card_events`), §10 (index), « Conventions générales »
-- @spec docs/SPEC-permissions-rls.md §3.6 (`app.can_read_card`), §4 (politiques par famille),
--       §7 (preuve de refus n° 8, désormais satisfaisable pour moitié)
-- @spec docs/DAT.md §3.2 (triggers d'audit et de timeline), §4.2 (déplacement d'une card)
-- @spec CRM-045 (docs/BACKLOG.md) — section 1 seulement : l'autorité sur le vocabulaire passe
--       à la dernière migration qui l'étend (docs/JOURNAL.md décision 219, INC-074)
-- @spec docs/PROD_MIGRATIONS.md §3 (migrations en attente)
-- @spec docs/JOURNAL.md décisions 203 (triggers sur les tables, non dans les RPC), 204
--       (`clock_timestamp()`), 205 (le seed ne peut pas forger un événement), 206 (une trace ne
--       fait jamais échouer l'acte qu'elle trace), 207 (aucun trigger de suppression), 208 (la clé
--       `from` absente), 209 (fil unifié à la lecture)
-- @spec docs/INCONSISTENCY_REPORT.md INC-014 (fermée depuis par CRM-022), INC-025 (colonnes communes),
--       INC-048 (le motif d'une transition, dont la destination existe désormais deux fois)
--
-- Le produit sait ranger des affaires, poser des questions, recevoir des réponses et en parler.
-- Il ne sait pas se souvenir. Cette migration livre la mémoire d'une affaire : ce qui lui est
-- arrivé, dans l'ordre où c'est arrivé, écrit par la base au moment où ça arrive, et que personne
-- ne peut ni forger ni corriger.
--
-- ---------------------------------------------------------------------------------------------
-- Ce que cette migration livre, et ce qu'elle ne livre pas.
-- ---------------------------------------------------------------------------------------------
-- Livré : `public.card_events`, son `CHECK` de vocabulaire, sa clé étrangère composite, son index,
-- sa politique unique de lecture, ses privilèges — **aucune écriture, pour aucun rôle** —, le
-- trigger d'immuabilité, et les **cinq** triggers d'alimentation.
--
-- Non livré, et nommé — chaque manque est **figé par une assertion** de
-- `supabase/tests/0018_timeline.test.sql` :
--
--   * `mail_received` et `mail_sent` : le `CHECK` les REFUSE. `mail_messages` est livrée par
--     `CRM-054`, l'envoi par `CRM-058`, et une valeur autorisée que rien ne produit laisse croire
--     à une capacité inexistante (docs/SPEC-cards.md §14.4) ;
--
--   * aucun événement pour un commentaire. Le fil est unifié À LA LECTURE (décision 209) :
--     dupliquer produirait deux représentations d'un même fait, dont l'une survivrait à l'autre ;
--
--   * `card_activities` — appels, réunions, visios — que docs/SCHEMA.md §5 décrit et qu'aucune
--     unité du chunk 3 ne porte ;
--
--   * le MOTIF d'une transition. `move_card` reçoit un `comment` et ne le conserve nulle part
--     (INC-048). Un trigger sur `cards` ne voit pas les arguments de la fonction qui a fait
--     l'`UPDATE`. La destination existe désormais DEUX fois — `card_comments` depuis `CRM-043`,
--     `card_events.payload` depuis ici — et l'arbitrage porte sur laquelle ;
--
--   * aucune publication au temps réel. `card_comments` reste la seule table publiée : le fil se
--     relit à l'ouverture de la card (docs/SPEC-cards.md §14.1) ;
--
--   * `public.move_card` n'est PAS rouverte. Elle appartient à `CRM-034`, et le trigger de la
--     section 5.2 capte son effet sans y toucher (décision 203).
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence et convergence.
-- ---------------------------------------------------------------------------------------------
-- Tout est rejouable et **convergent** au sens d'INC-035 : une contrainte remplacée à la main par
-- une contrainte plus faible portant le même nom est réparée par le rejeu. Mécanisme de la
-- décision 78, repris des migrations 11, 13 et 15.
--
-- AUCUNE DÉPENDANCE D'ORDRE NOUVELLE. Elle exige `cards` (11), son unicité `(id, workspace_id)`
-- posée par la migration 15, `card_field_values` (13) et `app.can_read_card` (11).

-- =============================================================================================
-- 0. Convergence des contraintes nommées
-- =============================================================================================
-- Même fonction que les migrations 11, 13 et 15, sous un nom propre à celle-ci : les quatre sont
-- retirées en fin de fichier, et un nom partagé rendrait l'ordre de suppression significatif.

create or replace function app.migration_0016_converger_contrainte(
	nom_table text, nom_contrainte text, definition_attendue text
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
	definition_reelle text;
begin
	select pg_get_constraintdef(c.oid) into definition_reelle
	  from pg_constraint c
	 where c.conrelid = nom_table::regclass
	   and c.conname  = nom_contrainte;

	if definition_reelle is null then
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	elsif definition_reelle <> definition_attendue then
		execute format('alter table %s drop constraint %I', nom_table, nom_contrainte);
		execute format('alter table %s add constraint %I %s',
		               nom_table, nom_contrainte, definition_attendue);
	end if;
end;
$$;

-- =============================================================================================
-- 1. `public.card_events`
-- =============================================================================================
-- docs/SPEC-cards.md §14.2, docs/SCHEMA.md §5.
--
-- `updated_at` N'EST PAS AJOUTÉE, et pour la première fois ce n'est pas un écart aux « Conventions
-- générales » mais leur CONSÉQUENCE (sixième mention d'INC-025) : une ligne qu'aucun rôle ne peut
-- modifier — section 6.2 — n'a pas de date de dernière modification. La poser serait écrire une
-- colonne dont la valeur est, par construction, toujours égale à `created_at`.

create table if not exists public.card_events (
	id           uuid        primary key default gen_random_uuid(),
	card_id      uuid        not null,
	-- DÉRIVÉE de la card par les triggers, jamais décidée par un appelant — puisqu'aucun appelant
	-- n'écrit — et tenue en outre par la clé composite de la section 3.
	workspace_id uuid        not null,
	type         text        not null,
	-- Nul si l'auteur est un service (docs/SCHEMA.md §5). Renseignée par une SOUS-REQUÊTE sur
	-- `profiles` en section 4, jamais par une affectation directe : décision 206.
	actor_id     uuid        references public.profiles (id) on delete set null,
	payload      jsonb       not null default '{}'::jsonb,
	-- `clock_timestamp()` ET NON `now()` : décision 204, MESURÉE. `now()` rend l'heure de début de
	-- transaction, et trois événements nés d'un seul `UPDATE` porteraient le même horodatage —
	-- l'ordre du fil deviendrait celui, aléatoire, de leurs `uuid`.
	created_at   timestamptz not null default clock_timestamp()
);

-- --- 1.1 Le vocabulaire, tenu par la base — docs/SPEC-cards.md §14.4 --------------------------
-- HUIT valeurs, et aucune autre. `mail_received` et `mail_sent`, que docs/SCHEMA.md §5 nomme, sont
-- REFUSÉS : le jour où `CRM-054` les écrira, elle devra étendre cette énumération dans la même
-- migration que son trigger, et la base le lui rappellera par un `23514`.
--
-- `unarchived` et `restored` s'ajoutent à la liste du §5 : le §4 de docs/SPEC-cards.md pose que
-- l'archivage et la corbeille sont RÉVERSIBLES, et un cycle de vie dont la moitié des transitions
-- ne laisse aucune trace n'est pas une mémoire.

-- CETTE CONTRAINTE EST CRÉÉE SI ELLE MANQUE, ET JAMAIS RAMENÉE EN ARRIÈRE — CORRIGÉ PAR `CRM-045`,
-- décision 219, après un DÉFAUT RÉEL constaté par le balayage de non-régression.
--
-- Elle employait `app.migration_0016_converger_contrainte`, comme les autres contraintes de cette
-- migration. Le mécanisme de convergence d'INC-035 REMPLACE la contrainte lorsque sa définition
-- diffère de celle que le fichier déclare — ce qui est exactement ce qu'il faut, tant qu'UN SEUL
-- fichier fait autorité sur l'objet.
--
-- `CRM-045` étend l'énumération à NEUF valeurs dans la migration 17. Le `migrations-runner` ne
-- tient aucun registre et rejoue TOUT le répertoire à chaque démarrage (décision 20) : au rejeu, ce
-- fichier-ci ramenait donc la contrainte à huit valeurs AVANT que la 17 ne la rétablisse. Sur une
-- base neuve cela passait inaperçu ; sur une base portant des `channel_changed`, PostgreSQL refuse
-- une contrainte que les lignes présentes violent, et le runner sortait en **code 3**. MESURÉ :
--
--   ERROR: check constraint "card_events_type_check" of relation "card_events"
--          is violated by some row
--
-- La pile ne redémarrait plus. CE QUI EST CHANGÉ EST DONC L'AUTORITÉ, ET NON LA VALEUR : ce
-- fichier POSE le vocabulaire initial, la dernière migration qui l'étend en devient responsable et
-- continue de le CONVERGER — un rétrécissement manuel est toujours réparé, par la migration 17
-- désormais. Rien n'est perdu ; la garantie a changé de porteur.
--
-- La limite structurelle du mécanisme est consignée en `docs/INCONSISTENCY_REPORT.md`, INC-074 :
-- la convergence d'INC-035 ne sait pas exprimer « une contrainte dont la définition canonique
-- avance avec les migrations ».
do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname  = 'card_events_type_check'
	) and not exists (
		-- INC-144 — la garde ci-dessus ne pose le vocabulaire initial que si la contrainte est
		-- absente, ce qui est correct sur une base neuve mais insuffisant sur une base peuplée
		-- dont la contrainte a été déposée : les lignes y emploient déjà `channel_changed`,
		-- `mail_received`, `snoozed` ou `woken`, et les huit valeurs de CRM-044 sont alors
		-- refusées par « is violated by some row ». On ne pose donc le vocabulaire initial que
		-- s'il est compatible avec les lignes présentes ; sinon les migrations 17, 20, 25, 30 et
		-- 44 restent seules responsables de l'installer, dans leur propre ordre.
		select 1 from public.card_events
		 where type <> all (array['created', 'moved', 'assigned', 'archived', 'unarchived',
		                          'trashed', 'restored', 'field_changed'])
	) then
		alter table public.card_events add constraint card_events_type_check
			check (type = any (array['created', 'moved', 'assigned', 'archived', 'unarchived',
			                         'trashed', 'restored', 'field_changed']));
	end if;
end;
$$;

comment on table public.card_events is
	'CRM-044 — docs/SPEC-cards.md §14. Mémoire d''une affaire, APPEND-ONLY. Alimentée par CINQ '
	'triggers `SECURITY DEFINER` et par eux seuls : aucun rôle ne détient le moindre privilège '
	'd''écriture, `service_role` COMPRIS — le seed lui-même ne peut pas forger un événement '
	'(décision 205). Modifier est refusé à tous par trigger ; supprimer n''est possible que par '
	'cascade depuis `cards`, geste d''exploitation (décision 207).';

comment on column public.card_events.workspace_id is
	'CRM-044 — docs/SPEC-cards.md §14.2. Dénormalisation DÉRIVÉE de la card par les triggers, et '
	'tenue par la clé composite vers `cards (id, workspace_id)`.';

comment on column public.card_events.type is
	'CRM-044 — docs/SPEC-cards.md §14.4. HUIT valeurs livrées. `mail_received` et `mail_sent`, que '
	'docs/SCHEMA.md §5 nomme, sont REFUSÉS tant que `CRM-054` et `CRM-058` ne les écrivent pas.';

comment on column public.card_events.actor_id is
	'CRM-044 — docs/SPEC-cards.md §14.5, décision 206. `auth.uid()` filtré par une SOUS-REQUÊTE sur '
	'`profiles` : sans profil, la valeur est nulle. Une trace ne doit jamais faire échouer l''acte '
	'qu''elle trace. Nul aussi pour la clé de service, qui ne porte aucune revendication `sub`.';

comment on column public.card_events.payload is
	'CRM-044 — docs/SPEC-cards.md §14.6. Avant/après, et AUCUN LIBELLÉ : ni nom d''étape, ni clé de '
	'champ. Une trace qui les recopierait dirait demain ce qui était vrai hier. Pour '
	'`field_changed`, la clé `from` est ABSENTE à l''insertion et TOUJOURS présente à la mise à '
	'jour — seul moyen de distinguer « il n''y avait rien » de « il y avait le vide » (décision 208).';

comment on column public.card_events.created_at is
	'CRM-044 — docs/SPEC-cards.md §14.3, décision 204. `clock_timestamp()` et non `now()` : MESURÉ, '
	'trois événements nés d''un seul `UPDATE` portent sinon le même horodatage, et l''ordre du fil '
	'devient celui de leurs `uuid`.';

-- =============================================================================================
-- 2. Clé étrangère composite — docs/SPEC-cards.md §14.2
-- =============================================================================================
-- Elle s'appuie sur l'unicité `cards (id, workspace_id)` posée par la migration 15 : aucune
-- unicité nouvelle n'est nécessaire ici.
--
-- `ON DELETE CASCADE`, comme pour `card_comments` (§13.3) — et c'est ce qui interdit un trigger de
-- refus sur la suppression (décision 207, section 6.2). La conséquence est écrite sans détour :
-- une card physiquement supprimée EMPORTE SA MÉMOIRE. Point ouvert n° 2 du §14.13.

select app.migration_0016_converger_contrainte(
	'public.card_events', 'card_events_card_id_workspace_id_fkey',
	'FOREIGN KEY (card_id, workspace_id) REFERENCES public.cards(id, workspace_id) ON DELETE CASCADE');

-- =============================================================================================
-- 3. Index — docs/SCHEMA.md §10
-- =============================================================================================
-- `(card_id, created_at DESC)` est ce que docs/SCHEMA.md §10 annonce, et il est posé tel quel,
-- terminé par `id` pour la raison mesurée par `CRM-042` : un ordre non total parcouru page par
-- page perd des lignes.
--
-- CE QU'IL FAIT RÉELLEMENT, MESURÉ. Le fil est servi en ordre CROISSANT (§14.10), et un index
-- btree se parcourt dans les deux sens — mais sur 3 600 lignes le planificateur choisit un
-- `Bitmap Index Scan` suivi d'un `Sort` : l'index sert le FILTRE `card_id`, pas le tri. C'est
-- écrit au §14.13 plutôt que laissé à supposer.

create index if not exists card_events_card_id_created_at_idx
	on public.card_events (card_id, created_at desc, id desc);

-- =============================================================================================
-- 4. La fonction d'écriture, commune aux cinq triggers
-- =============================================================================================
-- docs/SPEC-cards.md §14.5. `SECURITY DEFINER` n'est pas une facilité : c'est le mécanisme même de
-- la table. MESURÉ, le même corps en `SECURITY INVOKER` rend
-- « permission denied for table card_events » et FAIT ÉCHOUER l'écriture métier qui l'a déclenché.
--
-- MESURÉ aussi, et cela n'allait pas de soi : `auth.uid()` rend l'identifiant réel de l'appelant à
-- l'intérieur d'une fonction `SECURITY DEFINER`. La revendication JWT est portée par un paramètre
-- de session (`request.jwt.claims`), non par le rôle courant, et le changement de droits ne
-- l'efface pas.
--
-- LA SOUS-REQUÊTE SUR `profiles` EST LA DÉCISION 206, et non une précaution décorative : sans elle,
-- un appelant dont `auth.uid()` ne désignerait aucun profil ferait échouer la création de sa propre
-- card sur une violation de clé étrangère levée par la TRACE, non par l'ACTE.

create or replace function app.card_event_ecrire(
	p_card_id uuid, p_workspace_id uuid, p_type text, p_payload jsonb
) returns void
language sql
security definer
set search_path = ''
as $$
	insert into public.card_events (card_id, workspace_id, type, actor_id, payload)
	values (
		p_card_id,
		p_workspace_id,
		p_type,
		(select p.id from public.profiles p where p.id = auth.uid()),
		coalesce(p_payload, '{}'::jsonb)
	);
$$;

comment on function app.card_event_ecrire(uuid, uuid, text, jsonb) is
	'CRM-044 — docs/SPEC-cards.md §14.5. Seule voie d''écriture de `card_events`. `SECURITY '
	'DEFINER` parce qu''aucun rôle client ne détient `INSERT` — MESURÉ : le même corps en `INVOKER` '
	'refuse, et fait échouer l''écriture métier. `auth.uid()` filtré par `profiles` (décision 206).';

-- =============================================================================================
-- 5. Les cinq triggers d'alimentation — docs/SPEC-cards.md §14.4, §14.5
-- =============================================================================================
-- Ils sont sur les TABLES et non dans les RPC (décision 203). `current_step_id` ne s'écrit que par
-- `move_card` depuis `CRM-034`, mais `owner_id`, `archived_at` et `deleted_at` s'écrivent par un
-- `PATCH` direct que rien ne médie : une trace placée dans les RPC laisserait sans mémoire
-- l'archivage, la corbeille et le changement de responsable.
--
-- Ils sont tous `AFTER` et rendent `null` : ils n'influencent jamais la ligne écrite. Un trigger
-- d'audit qui pourrait modifier ce qu'il observe ne serait plus un audit.

-- --- 5.1 Naissance d'une card -----------------------------------------------------------------

create or replace function app.card_events_apres_insertion_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	perform app.card_event_ecrire(new.id, new.workspace_id, 'created',
		jsonb_build_object(
			'title',      new.title,
			'channel_id', new.channel_id,
			'step_id',    new.current_step_id));
	return null;
end;
$$;

comment on function app.card_events_apres_insertion_card() is
	'CRM-044 — docs/SPEC-cards.md §14.4. Écrit `created`. Le `payload` porte l''état de NAISSANCE, '
	'tel qu''il était : titre, channel et étape d''origine.';

drop trigger if exists card_events_apres_insertion on public.cards;
create trigger card_events_apres_insertion
	after insert on public.cards
	for each row execute function app.card_events_apres_insertion_card();

-- --- 5.2 Vie d'une card : quatre colonnes surveillées ------------------------------------------
-- Un seul trigger, quatre gardes. Chacune compare `is distinct from` : MESURÉ,
-- `update public.cards set title = title || ''` produit ZÉRO événement. C'est ce qui rend le seed
-- convergent — le rejeu n'allonge pas l'histoire.
--
-- L'ordre des quatre gardes est celui du §14.4, et il est signifiant : `clock_timestamp()` étant
-- réévaluée à chaque insertion, plusieurs événements nés du même `UPDATE` sont rangés dans cet
-- ordre-là (décision 204).

create or replace function app.card_events_apres_maj_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.current_step_id is distinct from old.current_step_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'moved',
			jsonb_build_object('from_step_id', old.current_step_id,
			                   'to_step_id',   new.current_step_id));
	end if;

	-- Y COMPRIS VERS `NULL` : une affaire dont on retire le responsable change d'état, et
	-- docs/SPEC-permissions-rls.md §8.1 retient la conservation plutôt que la réaffectation forcée.
	if new.owner_id is distinct from old.owner_id then
		perform app.card_event_ecrire(new.id, new.workspace_id, 'assigned',
			jsonb_build_object('from_owner_id', old.owner_id,
			                   'to_owner_id',   new.owner_id));
	end if;

	if new.archived_at is distinct from old.archived_at then
		perform app.card_event_ecrire(new.id, new.workspace_id,
			case when new.archived_at is null then 'unarchived' else 'archived' end,
			'{}'::jsonb);
	end if;

	if new.deleted_at is distinct from old.deleted_at then
		perform app.card_event_ecrire(new.id, new.workspace_id,
			case when new.deleted_at is null then 'restored' else 'trashed' end,
			'{}'::jsonb);
	end if;

	return null;
end;
$$;

comment on function app.card_events_apres_maj_card() is
	'CRM-044 — docs/SPEC-cards.md §14.4, décision 203. Quatre colonnes surveillées : '
	'`current_step_id`, `owner_id`, `archived_at`, `deleted_at`. Chaque garde compare `is distinct '
	'from` — MESURÉ, une écriture qui ne change rien ne produit AUCUN événement, ce qui rend le '
	'seed convergent. Le trigger est sur la TABLE, non dans `move_card` : `owner_id` et les deux '
	'horodatages s''écrivent par un `PATCH` direct qu''aucune RPC ne médie.';

drop trigger if exists card_events_apres_maj on public.cards;
create trigger card_events_apres_maj
	after update on public.cards
	for each row execute function app.card_events_apres_maj_card();

-- --- 5.3 Valeurs de formulaire ----------------------------------------------------------------
-- Décision 208 : la clé `from` est ABSENTE à l'insertion, TOUJOURS présente à la mise à jour.
-- MESURÉ — `docs/SPEC-form-composer.md` §6.9 posant que vider un champ c'est écrire
-- `'null'::jsonb`, une valeur SQL `NULL` et une valeur JSON `null` rendent toutes deux
-- `"from": null` et sont indistinguables. « La clé n'est pas là » signifie « il n'y avait rien » ;
-- « la clé vaut `null` » signifie « il y avait le vide ».

create or replace function app.card_events_apres_ecriture_valeur()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_payload jsonb;
begin
	if tg_op = 'UPDATE' then
		if new.value is not distinct from old.value then
			return null;
		end if;
		v_payload := jsonb_build_object('field_id', new.field_id,
		                                'from',     old.value,
		                                'to',       new.value);
	else
		v_payload := jsonb_build_object('field_id', new.field_id,
		                                'to',       new.value);
	end if;

	perform app.card_event_ecrire(new.card_id, new.workspace_id, 'field_changed', v_payload);
	return null;
end;
$$;

comment on function app.card_events_apres_ecriture_valeur() is
	'CRM-044 — docs/SPEC-cards.md §14.6, décision 208. Écrit `field_changed`. La clé `from` est '
	'ABSENTE à l''insertion et toujours présente à la mise à jour : seul moyen de distinguer « il '
	'n''y avait rien » de « il y avait le vide », que le JSON confond sinon. Une valeur réécrite à '
	'l''identique ne produit AUCUN événement — MESURÉ.';

drop trigger if exists card_events_apres_ecriture_valeur on public.card_field_values;
create trigger card_events_apres_ecriture_valeur
	after insert or update on public.card_field_values
	for each row execute function app.card_events_apres_ecriture_valeur();

-- =============================================================================================
-- 6. Immuabilité — docs/SPEC-cards.md §14.8
-- =============================================================================================

-- --- 6.1 Aucune mise à jour, pour personne ----------------------------------------------------
-- `SECURITY INVOKER` : le trigger ne fait que lever, il n'a besoin d'aucun droit. Il vaut pour
-- TOUS les rôles, `service_role` et propriétaire compris — le refus de privilège de la section 7
-- suffirait aux clients, ce bloc ferme la porte qu'un accès d'exploitation laisserait ouverte.
-- C'est le refus DOUBLE de la migration 15 §4.2, appliqué à la table entière.

create or replace function app.card_events_refuser_maj()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
	raise exception 'card_event_immutable'
		using errcode = 'P0001',
		      detail  = 'Un événement de timeline est définitif : il ne peut être ni modifié ni corrigé.';
end;
$$;

comment on function app.card_events_refuser_maj() is
	'CRM-044 — docs/SPEC-cards.md §14.8. Refuse TOUTE mise à jour d''un événement, pour tous les '
	'rôles y compris le propriétaire. Un journal que l''on peut réécrire n''est pas un journal.';

drop trigger if exists card_events_refuser_maj on public.card_events;
create trigger card_events_refuser_maj
	before update on public.card_events
	for each row execute function app.card_events_refuser_maj();

-- --- 6.2 Aucun trigger sur la suppression, et le motif est mesuré ------------------------------
-- Décision 207. La clé composite de la section 2 porte `ON DELETE CASCADE` : un trigger
-- `BEFORE DELETE` de refus rendrait IMPOSSIBLE `delete from public.cards`, geste d'exploitation
-- que la migration 15 avait délibérément préservé pour `card_comments`. MESURÉ : la cascade
-- réussit et emporte les événements.
--
-- Le refus reste DOUBLE pour les clients — aucun privilège en section 7, aucune politique en
-- section 8 —, et la suppression physique n'appartient qu'au propriétaire de la base.
--
-- CONSÉQUENCE, ÉCRITE SANS DÉTOUR : une card physiquement supprimée emporte sa mémoire. Les deux
-- issues sont au §14.13 de docs/SPEC-cards.md, et aucune n'est prise ici : c'est une décision de
-- rétention, donc de conformité.

-- =============================================================================================
-- 7. Privilèges — docs/SPEC-cards.md §14.7
-- =============================================================================================
-- LA SEULE TABLE DU PRODUIT DONT `service_role` N'A PAS L'ÉCRITURE, et c'est la propriété que
-- l'unité cherchait (décision 205) : `CLAUDE.md` §8 interdit de fabriquer des traces censées
-- représenter un processus réel. Toutes les unités précédentes l'ont respecté par CONVENTION ;
-- ici, le seed ne le PEUT pas.
--
-- Le `revoke all` est écrit avant les `grant` pour deux raisons héritées : la décision 134 —
-- l'image Supabase pose un `ALTER DEFAULT PRIVILEGES IN SCHEMA public` qui accorde tout à `anon`
-- et `authenticated` sur toute table nouvelle — et la décision 57 : un rejeu RÉPARE un privilège
-- relâché à la main.

revoke all on public.card_events from anon, authenticated, service_role;

grant select on public.card_events to anon, authenticated, service_role;

-- =============================================================================================
-- 8. Refus par défaut, puis politique unique — docs/SPEC-cards.md §14.7
-- =============================================================================================

alter table public.card_events enable row level security;

-- `card_events` est le TROISIÈME appelant réel d'`app.can_read_card`, après `card_field_values` et
-- `card_comments` (docs/SPEC-permissions-rls.md §3.6). Le défaut de la décision 107 ne s'y
-- reproduit pas : la fonction lit `cards`, une AUTRE table.
--
-- Lire la mémoire n'exige que de LIRE la card — à la différence d'écrire un commentaire, qui exige
-- le droit d'écriture (INC-071). Un `viewer` voit donc l'histoire des affaires qu'il consulte.

drop policy if exists card_events_lecture on public.card_events;
create policy card_events_lecture
	on public.card_events
	for select
	to anon, authenticated
	using (app.can_read_card(card_id));

comment on policy card_events_lecture on public.card_events is
	'CRM-044 — docs/SPEC-cards.md §14.7. Lecture par droit effectif sur la card, droits fins '
	'appliqués. Accordée à `anon` pour que le refus soit ZÉRO LIGNE et non une erreur de privilège '
	'(docs/SPEC-permissions-rls.md §3.2). AUCUNE autre politique : écrire n''est ouvert à personne.';

-- =============================================================================================
-- 9. Retrait de l'échafaudage
-- =============================================================================================

drop function if exists app.migration_0016_converger_contrainte(text, text, text);

notify pgrst, 'reload schema';
