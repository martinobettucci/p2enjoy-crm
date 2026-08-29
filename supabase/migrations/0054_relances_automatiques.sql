-- @spec CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHE 2 : le geste
--       qui manquait, une inscription quotidienne dans la mémoire de l'affaire
-- @spec docs/SPEC-relances.md §9 (contrat exécutable de la tranche 2), §9.2 (le job appelle
--       `public.cards_figees()` et ne recopie aucun prédicat), §9.3 (contrat de la fonction),
--       §9.4 (idempotence ancrée sur `entered_step_at`), §9.5 (acteur nul), §9.6 (payload),
--       §9.7 (le job `pg_cron`), §9.8 (la quinzième valeur), §9.11 (retour arrière)
-- @spec docs/SPEC-scheduler.md §1 (chaque unité enregistre son job par migration), §3 (démarrage
--       observable), §4 (fermeture des privilèges), §5 (convergence)
-- @spec docs/SPEC-cards.md §14.4 (le vocabulaire du fil), §14.5 (seule voie d'écriture, acteur
--       nul pour un service), §14.6 (aucun libellé dans un payload)
-- @spec docs/SCHEMA.md §9 bis.10 ; docs/PROD_MIGRATIONS.md migration 54
--
-- CETTE MIGRATION N'AJOUTE AUCUNE TABLE ET AUCUNE COLONNE.
--
-- La tranche 1 a rendu la notion de card figée LISIBLE en base. Elle ne la rend pas AGISSANTE :
-- personne n'est prévenu tant que personne n'appelle `public.cards_figees()`. Cette migration
-- livre le geste manquant — une inscription, quotidienne et automatique, dans la timeline.
--
-- ---------------------------------------------------------------------------------------------
-- CE QU'ELLE N'EST PAS.
-- ---------------------------------------------------------------------------------------------
-- 1. CE N'EST PAS UN EMAIL. Une relance de `CRM-062` est un FAIT INSCRIT dans le produit, que
--    l'utilisateur rencontre en ouvrant la timeline de son affaire. Faire partir un email suppose
--    un modèle, un expéditeur et une cadence : les trois objets de `CRM-063`, qu'aucune table ne
--    tient aujourd'hui (docs/SPEC-relances.md §1 et §9.1).
--
-- 2. CE N'EST PAS UNE SECONDE DÉFINITION DE « FIGÉE ». Le job APPELLE `public.cards_figees()`.
--    MESURÉ le 2026-08-24 : `postgres` porte `rolbypassrls = t`, donc la fonction — `SECURITY
--    INVOKER` — lui rend l'ensemble GLOBAL, là où elle rend à chaque client ses seules affaires.
--    Recopier son `where` ici aurait créé la duplication que le §2.1 combat (§9.2).
--
-- 3. CE N'EST PAS UNE ÉLÉVATION DE PRIVILÈGE. Aucun rôle client ne gagne quoi que ce soit :
--    `app.relancer_cards_figees()` vit dans le schéma privé `app`, que PostgREST n'expose pas, et
--    ses privilèges d'exécution sont révoqués des quatre rôles nommément (§9.3).
--
-- 4. AUCUNE COLONNE D'ÉTAT N'EST INVENTÉE. L'idempotence s'ancre sur la timeline elle-même, table
--    déjà immuable, et non sur une colonne `last_stalled_at` qui aurait créé une seconde source de
--    vérité à tenir en cohérence avec la première (§9.4).
--
-- ---------------------------------------------------------------------------------------------
-- Idempotence : exigence d'exécution.
-- ---------------------------------------------------------------------------------------------
-- Le `migrations-runner` de `CRM-001` ne tient aucun registre et rejoue l'intégralité du
-- répertoire à chaque démarrage de la pile (`docs/DAT.md` §3.2). Le remplacement conditionnel de
-- la contrainte, `create or replace function`, les `revoke`/`grant` nominatifs et `cron.schedule`
-- sur un nom stable sont tous rejouables sans effet de bord.

-- =============================================================================================
-- 1. Le vocabulaire du fil passe de quatorze à quinze valeurs — docs/SPEC-relances.md §9.8
-- =============================================================================================
-- La contrainte est REMPLACÉE dès qu'elle ne porte pas déjà `stalled` — forme des migrations 30 et
-- 44, qui répare un rétrécissement manuel au lieu de le constater.
--
-- La quinzième valeur est ajoutée par la MÊME migration que la fonction qui l'écrit : c'est la
-- règle du §14.4 de `docs/SPEC-cards.md`, et le mécanisme tient encore. MESURÉ le 2026-08-24,
-- avant cette migration : `app.card_event_ecrire(…, 'stalled', …)` est refusé en `23514`. Une
-- valeur autorisée que rien n'écrit serait une promesse que personne ne tient ; l'inverse — un
-- écrivain sans valeur autorisée — est refusé par la base, et c'est ce qu'on vient de constater.

do $$
begin
	if not exists (
		select 1 from pg_constraint
		 where conrelid = 'public.card_events'::regclass
		   and conname  = 'card_events_type_check'
		   and pg_get_constraintdef(oid) like '%stalled%'
	) and not exists (
		-- INC-144 — SECONDE GARDE, celle des migrations 16, 17, 20, 25, 30, 44, 61 et 70,
		-- qui manquait ici. La première ne regarde que la contrainte et ne voit rien lorsqu'elle
		-- a été déposée ou réduite ; les lignes, elles, peuvent déjà porter un type qu'une
		-- migration POSTÉRIEURE a livré.
		--
		-- CETTE MIGRATION EN AVAIT ÉTÉ DISPENSÉE, ET LE MOTIF ÉCRIT ÉTAIT QU'ELLE POSAIT « LE
		-- VOCABULAIRE LE PLUS LARGE DU DÉPÔT ». Il l'était le 2026-08-25 ; la migration 70
		-- (`CRM-085`) l'a porté à DIX-NEUF valeurs, et la dispense est devenue le défaut
		-- d'INC-210 un cran plus loin dans le répertoire. MESURÉ le 2026-08-29, INC-239 : sur une
		-- base dont la contrainte est ramenée à un vocabulaire d'avant `stalled` — ce que produit
		-- tout harnais qui la dégrade puis la restaure en rejouant une migration antérieure —,
		-- cette migration RÉTRÉCISSAIT aux quinze valeurs de son époque, les lignes portant
		-- `mail_unclassified` ou `contact_linked` violaient la contrainte, le `migrations-runner`
		-- sortait en 3 sur `is violated by some row`, et les migrations 55 à 70 ne s'appliquaient
		-- plus du tout. `./runDev.sh` ne réparait pas ; seul `./resetMe.sh` le faisait.
		--
		-- *Être la plus large* est un état DATÉ, que la migration suivante défait : la seconde
		-- garde n'est donc jamais dispensable. Règle générale au §9.8.1 de
		-- `docs/SPEC-relances.md`, contrôle de répertoire dans `scripts/verify-migrations.sh`.
		--
		-- On ne converge donc que si les lignes sont compatibles avec les quinze valeurs que CETTE
		-- migration pose. Sinon la 70 reste seule responsable du vocabulaire complet, ce qu'elle
		-- sait faire : elle porte ses deux gardes et connaît les dix-neuf valeurs.
		select 1 from public.card_events
		 where type <> all (array[
			'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
			'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
			'mail_received', 'mail_sent', 'snoozed', 'woken', 'stalled'])
	) then
		alter table public.card_events drop constraint if exists card_events_type_check;
		alter table public.card_events add constraint card_events_type_check
			check (type = any (array[
				'created', 'moved', 'assigned', 'channel_changed', 'workflow_changed',
				'archived', 'unarchived', 'trashed', 'restored', 'field_changed',
				'mail_received', 'mail_sent', 'snoozed', 'woken', 'stalled'
			]));
	end if;
end;
$$;

comment on column public.card_events.type is
	'CRM-044, CRM-081, CRM-062 — docs/SPEC-cards.md §14.4 et §16.5, docs/SPEC-relances.md §9.8. '
	'QUINZE valeurs livrées. `stalled` est écrit par `app.relancer_cards_figees()`, appelée par le '
	'job quotidien `p2enjoy-relances-cards-figees` : c''est la SEULE valeur qu''aucun geste humain '
	'ne produit — elle est un fait de l''horloge.';

-- =============================================================================================
-- 2. `app.relancer_cards_figees()` — l'inscription — docs/SPEC-relances.md §9.3 à §9.6
-- =============================================================================================
-- `SECURITY DEFINER`, propriétaire `postgres` : aucun rôle ne détient `INSERT` sur `card_events`
-- (docs/SPEC-cards.md §14.7), et l'écriture passe donc par `app.card_event_ecrire()`, seule voie
-- d'écriture de la table depuis `CRM-044`.
--
-- L'ACTEUR EST NUL, ET IL N'EST PAS AFFECTÉ — IL EST OBTENU (§9.5). `app.card_event_ecrire()`
-- pose `(select p.id from public.profiles p where p.id = auth.uid())`. MESURÉ le 2026-08-24 dans
-- une session `psql` sous `postgres`, exactement le contexte du job : `auth.uid()` rend `NULL`,
-- aucune revendication JWT n'existant hors d'une requête PostgREST. Une relance automatique n'a
-- pas d'auteur humain, et lui en inventer un — l'assignataire, le dernier acteur — serait la
-- valeur par défaut trompeuse que `CLAUDE.md` §18 proscrit.

create or replace function app.relancer_cards_figees()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_figee   record;
	v_ecrites integer := 0;
	v_job_id  bigint;
begin
	-- --- 1 Les affaires à relancer -------------------------------------------------------------
	-- `public.cards_figees()` est appelée, jamais recopiée (§9.2). Les trois exclusions du §2.4 —
	-- archivée, en corbeille, en sommeil — et l'absence de seuil sont donc héritées telles quelles :
	-- une card que la fonction ne rend pas ne reçoit rien, et il n'y a aucune garde à maintenir ici.
	--
	-- L'IDEMPOTENCE EST ANCRÉE SUR L'ENTRÉE DANS L'ÉTAPE (§9.4) : au plus un `stalled` par entrée.
	-- La borne est LARGE et ne dépend d'aucune donnée recopiée — `created_at` est posé par
	-- `clock_timestamp()` (docs/SPEC-cards.md §14.3), donc toujours postérieur à l'entrée qui l'a
	-- rendu possible. Deux conséquences voulues : le rejeu du même jour n'écrit rien, et tout
	-- `move_card` réarme la relance sans qu'aucune ligne ici ne le prévoie, puisqu'il repose
	-- `entered_step_at` à l'instant du déplacement.
	for v_figee in
		select f.card_id, f.workspace_id, f.seuil_jours, f.retard_jours
		  from public.cards_figees() f
		 where not exists (
			select 1
			  from public.card_events e
			 where e.card_id    = f.card_id
			   and e.type       = 'stalled'
			   and e.created_at >= f.entered_step_at
		 )
	loop
		-- LE PAYLOAD PORTE DEUX NOMBRES ET AUCUN LIBELLÉ (§9.6, docs/SPEC-cards.md §14.6). Le
		-- retard est conservé parce qu'il n'est PAS recalculable après coup : il dépend de `now()`
		-- au moment du passage, et une lecture faite trois semaines plus tard rendrait un autre
		-- nombre. Le seuil l'accompagne parce qu'un retard sans son seuil ne se lit pas.
		perform app.card_event_ecrire(
			v_figee.card_id,
			v_figee.workspace_id,
			'stalled',
			jsonb_build_object(
				'seuil_jours',  v_figee.seuil_jours,
				'retard_jours', v_figee.retard_jours));
		v_ecrites := v_ecrites + 1;
	end loop;

	-- --- 2 Promotion de la cadence d'amorçage vers la cadence nominale -------------------------
	-- Démarrage observable du §3 de `docs/SPEC-scheduler.md`, repris tel quel (§9.7). Un job
	-- QUOTIDIEN serait autrement invérifiable : une preuve froide attendrait jusqu'à vingt-quatre
	-- heures son premier passage.
	--
	-- Inscription et promotion sont dans la MÊME transaction : si `cron.alter_job` échoue, les
	-- relances de ce passage sont annulées et `cron.job_run_details` le dit. Aucune relance à demi
	-- écrite ne subsiste, et aucun faux passage n'est conservé.
	--
	-- La fonction est aussi appelée hors du job — par le seed (§9.9) et par les preuves. Le job
	-- existe alors nécessairement, la section 3 de cette migration l'ayant enregistré ; son
	-- absence est donc une incohérence de la base, et elle est levée plutôt que tue.
	select jobid
	  into v_job_id
	  from cron.job
	 where jobname = 'p2enjoy-relances-cards-figees'
	   and username = 'postgres';

	if v_job_id is null then
		raise exception 'relances_job_absent';
	end if;

	perform cron.alter_job(v_job_id, schedule => '23 3 * * *', database => 'postgres', active => true);

	return v_ecrites;
end;
$$;

alter function app.relancer_cards_figees() owner to postgres;

-- AUCUN CLIENT NE DÉCLENCHE UNE RELANCE, et c'est la fermeture du §4 de `docs/SPEC-scheduler.md`.
-- Les quatre rôles sont nommés : `revoke … from public` ne retire rien à un rôle NOMMÉ, point de
-- sûreté que la migration 53 a payé pour apprendre (docs/SPEC-relances.md §3.3).
--
-- La relance est un fait de l'horloge, pas un geste d'utilisateur : il n'y a pas de bouton, et le
-- schéma `app` n'est de toute façon pas exposé par PostgREST.
revoke all on function app.relancer_cards_figees()
	from public, anon, authenticated, service_role;

comment on function app.relancer_cards_figees() is
	'CRM-062 tranche 2 — docs/SPEC-relances.md §9.3. Inscrit un événement `stalled` par ENTRÉE '
	'DANS L''ÉTAPE pour chaque affaire que `public.cards_figees()` rend au rôle d''exploitation, '
	'puis ramène le job de son amorçage vers sa cadence quotidienne. Rend le nombre d''événements '
	'réellement inscrits. L''acteur est NUL parce qu''`auth.uid()` rend `NULL` hors PostgREST — '
	'obtenu, jamais affecté. Aucun libellé dans le payload : deux nombres, le seuil et le retard.';

-- =============================================================================================
-- 3. Le job quotidien — docs/SPEC-relances.md §9.7, docs/SPEC-scheduler.md §1 et §3
-- =============================================================================================
-- UNE FOIS PAR JOUR, ET NON PAR HEURE : le retard se compte en jours révolus (§2.5), et un passage
-- horaire produirait vingt-quatre évaluations pour une frontière qui ne bouge qu'une fois. L'heure
-- creuse évite de disputer les ressources aux passages interactifs ; la minute 23 la partage avec
-- le heartbeat de `CRM-017`, qui occupe la minute 7.
--
-- `cron.schedule` portant un nom stable converge sur le même `jobid` et répare commande, base,
-- rôle, activation et cadence. La cadence d'amorçage de dix secondes est TRANSITOIRE : le premier
-- passage la promeut lui-même (section 2).

do $$
declare
	job_id bigint;
begin
	select cron.schedule(
		'p2enjoy-relances-cards-figees',
		'10 seconds',
		'select app.relancer_cards_figees();'
	) into job_id;
	perform cron.alter_job(job_id, database => 'postgres', active => true);
end;
$$;
