-- @verifies CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHE 2 : la
--           relance automatique
-- @verifies docs/SPEC-relances.md §9.2 (le job APPELLE `public.cards_figees()`), §9.3 (forme et
--           ACL de `app.relancer_cards_figees`), §9.4 (idempotence ancrée sur l'entrée dans
--           l'étape, et réarmement), §9.5 (l'acteur est nul, et il est OBTENU), §9.6 (le payload :
--           deux nombres et aucun libellé), §9.7 (le job et sa cadence NOMINALE après promotion),
--           §9.8 (la quinzième valeur du vocabulaire), §9.9 (ce que le seed démontre)
-- @verifies docs/SPEC-scheduler.md §3 (démarrage observable), §4 (aucun client ne programme)
-- @verifies docs/SPEC-cards.md §14.4 (le vocabulaire), §14.5 (seule voie d'écriture, acteur nul
--           pour un service), §14.6 (aucun libellé dans un payload)
-- @verifies docs/SCHEMA.md §9 bis.10 ; docs/PROD_MIGRATIONS.md §3 (migration 54)
-- @verifies CLAUDE.md §10 (une règle de produit se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE REPROUVE PAS.
--
-- Elle ne reprouve PAS le prédicat « figée » : `0051_cards_figees.test.sql` le tient, exclusion par
-- exclusion et des deux côtés de la borne. La tranche 2 APPELLE cette fonction au lieu d'en
-- recopier le `where` (§9.2), et ce fichier mesure donc l'héritage plutôt que la règle.
--
-- Ce qu'elle prouve, et que rien d'autre ne prouve :
--
-- 1. L'IDEMPOTENCE, ET SON ANCRE. Une card figée depuis six semaines ne doit pas recevoir
--    quarante-deux événements. L'ancre est l'ENTRÉE DANS L'ÉTAPE, non la journée : un second appel
--    n'écrit rien, mais une entrée POSTÉRIEURE au dernier `stalled` réarme la relance.
--
-- 2. QUE L'ACTEUR EST NUL PARCE QU'IL EST OBTENU, NON AFFECTÉ (§9.5). `app.card_event_ecrire()`
--    pose `auth.uid()` filtré par `profiles` ; hors requête PostgREST, cette revendication n'existe
--    pas. L'assertion fige le fait, de sorte qu'une future écriture qui inventerait un acteur —
--    l'assignataire, le dernier acteur — la fasse rougir.
--
-- 3. QUE LE PAYLOAD NE PORTE AUCUN LIBELLÉ (§14.6, §9.6). L'assertion compare l'ENSEMBLE DES CLÉS,
--    non leur présence : ajouter `step_label` demain ferait rougir la suite, ce qu'une assertion
--    « contient seuil_jours » ne ferait pas.
--
-- 4. QUE LE JOB EST PROMU À SA CADENCE NOMINALE. La cadence d'amorçage de dix secondes est
--    TRANSITOIRE (§9.7) : un job resté à dix secondes écrirait, à l'échelle d'une journée, huit
--    mille six cents passages là où un seul est dû. L'assertion lit `cron.job`, et une seconde lit
--    `cron.job_run_details` pour constater que le moteur a RÉELLEMENT lancé la commande.
--
-- 5. QU'AUCUN CLIENT NE PEUT DÉCLENCHER UNE RELANCE. Les quatre rôles sont figés sans `execute`, et
--    aucune fonction homonyme n'existe dans `public` — donc aucune route `rpc/`.
--
-- POURQUOI LE RÉARMEMENT EST ÉPROUVÉ PAR UNE FIXTURE ANTIDATÉE, ET NON PAR UN DÉPLACEMENT RÉEL.
-- MESURÉ le 2026-08-24 : la contrainte `workflow_steps_stale_check` exige `stale_after_days > 0`,
-- et `card_events` est immuable — `update` rend `card_event_immutable`. Dans une seule transaction,
-- une card ne peut donc pas être à la fois entrée dans son étape APRÈS son dernier `stalled` et y
-- séjourner depuis au moins un jour : les deux conditions se contredisent tant que l'horloge ne
-- tourne pas. La fixture pose donc l'histoire telle qu'elle serait — un `stalled` d'un séjour
-- PRÉCÉDENT, antérieur à l'entrée courante — et mesure ce que la fonction en fait.
--
-- La suite modifie des lignes du seed et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

-- Les identifiants du seed, stables (docs/SPEC-seed.md §4).
create or replace function pg_temp.card_figee() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c3'::uuid $$;
create or replace function pg_temp.card_rearmement() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c2'::uuid $$;
create or replace function pg_temp.card_archivage() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c7'::uuid $$;
create or replace function pg_temp.card_corbeille() returns uuid language sql immutable as
	$$ select '5eed0000-0000-4000-8000-0000000000c6'::uuid $$;

create or replace function pg_temp.stalled_de(carte uuid) returns bigint language sql stable as $$
	select count(*) from public.card_events e where e.card_id = carte and e.type = 'stalled';
$$;

-- ---------------------------------------------------------------------------------------------
-- 1 et 2. La quinzième valeur du vocabulaire — docs/SPEC-relances.md §9.8
-- ---------------------------------------------------------------------------------------------
-- Elle est ajoutée par la MÊME migration que la fonction qui l'écrit (docs/SPEC-cards.md §14.4).
-- MESURÉ avant la migration 54 : la base refusait `stalled` en `23514`. La première assertion fige
-- l'extension, la seconde constate qu'elle est RÉELLEMENT utilisable — une contrainte réécrite qui
-- laisserait la valeur inatteignable pour une autre raison ne serait pas vue par la première.

select matches(
	(select pg_get_constraintdef(oid) from pg_constraint
	  where conrelid = 'public.card_events'::regclass and conname = 'card_events_type_check'),
	'stalled',
	'card_events_type_check porte la QUINZIÈME valeur, `stalled` — la seule qu''aucun geste humain '
	'ne produit');

select lives_ok(
	$$ select app.card_event_ecrire(
	          '5eed0000-0000-4000-8000-0000000000c3'::uuid,
	          (select workspace_id from public.cards where id = '5eed0000-0000-4000-8000-0000000000c3'),
	          'stalled', '{}'::jsonb) $$,
	'`stalled` est réellement écrivable par la seule voie d''écriture de la table');

-- La sonde ci-dessus a ajouté un événement : il est retiré avant les assertions du seed, qui
-- comptent. Le retrait est possible ici parce que la suite s'exécute sous le PROPRIÉTAIRE ; aucun
-- rôle client n'a ce pouvoir, et l'immuabilité en UPDATE reste entière (`card_event_immutable`).
delete from public.card_events
 where card_id = pg_temp.card_figee() and type = 'stalled' and payload = '{}'::jsonb;

-- ---------------------------------------------------------------------------------------------
-- 3 à 8. La forme de `app.relancer_cards_figees()` et son ACL — §9.3
-- ---------------------------------------------------------------------------------------------

select has_function('app', 'relancer_cards_figees', array[]::text[],
	'app.relancer_cards_figees() existe, sans argument');

select is(
	(select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'relancer_cards_figees'),
	true,
	'app.relancer_cards_figees() est SECURITY DEFINER : aucun rôle ne détient INSERT sur '
	'card_events, et un INVOKER serait refusé — même raison qu''aux six triggers de la timeline');

select is(
	(select p.provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'relancer_cards_figees'),
	'v',
	'app.relancer_cards_figees() est VOLATILE : elle écrit');

select is(
	(select p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'relancer_cards_figees'),
	array['search_path=""'],
	'app.relancer_cards_figees() fixe son search_path à la chaîne vide');

select is(
	(select r.rolname::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	   join pg_roles r on r.oid = p.proowner
	  where n.nspname = 'app' and p.proname = 'relancer_cards_figees'),
	'postgres',
	'app.relancer_cards_figees() appartient à postgres — le DEFINER doit être le rôle qui écrit '
	'la timeline, jamais un rôle client');

select results_eq(
	$$ select r.rolname::text,
	          has_function_privilege(r.rolname, 'app.relancer_cards_figees()', 'execute')
	     from (values ('anon'), ('authenticated'), ('postgres'), ('service_role')) as r(rolname)
	    order by 1 $$,
	$$ values ('anon', false), ('authenticated', false), ('postgres', true), ('service_role', false) $$,
	'AUCUN client ne déclenche une relance : les quatre rôles sont sans execute, seul le rôle '
	'd''exploitation exécute. La relance est un fait de l''horloge, pas un geste d''utilisateur');

-- ---------------------------------------------------------------------------------------------
-- 9 à 12. Le job quotidien, et son démarrage observable — §9.7
-- ---------------------------------------------------------------------------------------------

select is(
	(select count(*) from cron.job where jobname = 'p2enjoy-relances-cards-figees'),
	1::bigint,
	'un seul job porte le nom stable p2enjoy-relances-cards-figees — cron.schedule converge sur '
	'le même jobid au lieu d''empiler des homonymes');

select results_eq(
	$$ select schedule, command, database, username, active
	     from cron.job where jobname = 'p2enjoy-relances-cards-figees' $$,
	$$ values ('23 3 * * *', 'select app.relancer_cards_figees();', 'postgres', 'postgres', true) $$,
	'le job est à sa cadence NOMINALE : l''amorçage à dix secondes est transitoire, et un job resté '
	'à dix secondes ferait huit mille six cents passages par jour là où un seul est dû');

-- ASSERTION RÉVISÉE le 2026-08-25 — INC-217, et le motif est écrit ici plutôt que dans un journal.
--
-- Elle exigeait un passage `succeeded` pour CE job. Le job est planifié à `23 3 * * *` : une pile
-- montée après 03 h 23 n'en porte aucun avant le lendemain, `cron.job_run_details` étant vidée avec
-- le volume. MESURÉ : la même suite rendait rouge puis verte sur la MÊME pile, selon qu'un autre
-- harnais avait entre-temps rejoué la migration 54 — qui réarme le job sur un amorçage de dix
-- secondes (docs/SPEC-relances.md §9.7) — ou l'avait promue. Une preuve verte parce qu'une AUTRE
-- preuve a tourné avant elle ne prouve pas ce qu'elle annonce.
--
-- Elle n'est ni retirée, ni relâchée en `>= 0` : elle est REMPLACÉE par la propriété que ce fichier
-- peut tenir seul — AUCUN passage de ce job n'a jamais échoué. Sur une pile qui n'en porte aucun,
-- l'assertion est vraie sans rien affirmer de faux ; sur une pile qui en porte, elle est plus
-- stricte que l'ancienne, qui se contentait d'un `succeeded` et fermait les yeux sur un `failed`
-- voisin.
--
-- LA PREUVE QUE LE MOTEUR EXÉCUTE RÉELLEMENT LA COMMANDE VIT DÉSORMAIS DANS
-- `scripts/verify-relances.sh`, section « 7 quater », et elle y est PLUS FORTE : le harnais arme
-- lui-même un job JETABLE portant la commande du produit, attend son passage et le désordonnance.
-- Un fichier pgTAP ne peut pas le faire — il s'exécute dans UNE transaction, et le moteur `pg_cron`
-- ne voit que ce qui est committé : un job planifié ici ne tournerait jamais.
select is_empty(
	$$ select 1 from cron.job_run_details d
	     join cron.job j on j.jobid = d.jobid
	    where j.jobname = 'p2enjoy-relances-cards-figees' and d.status <> 'succeeded' $$,
	'aucun passage du job de relance n''a jamais ÉCHOUÉ — propriété que ce fichier tient seul, là '
	'où exiger un passage dépendait de l''heure de démarrage de la pile et de l''ordre des harnais');

select is(
	(select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'relancer_cards_figees'),
	0::bigint,
	'aucune fonction homonyme dans public : la relance n''est exposée par AUCUNE route rpc/, le '
	'schéma app n''étant pas exposé par PostgREST');

-- ---------------------------------------------------------------------------------------------
-- 13 à 16. Ce que le seed démontre, écrit par le VRAI mécanisme — §9.9
-- ---------------------------------------------------------------------------------------------
-- RÉVISÉ LE 2026-08-24 — `CRM-062` tranche 3a, docs/SPEC-relances.md §10.2.3.
--
-- Ces quatre assertions lisaient « l'événement stalled », au singulier, parce que le jeu n'en
-- portait qu'un. Il en porte QUATRE, un par affaire figée du §10.2.1, et elles sont révisées et non
-- retirées : le compte devient quatre, la liste est assérée ENTIÈRE et dans l'ordre, et les deux
-- assertions de forme portent désormais sur les quatre à la fois — un `payload` correct sur une
-- affaire et amputé sur une autre serait vert si l'assertion n'en lisait qu'une.

select results_eq(
	$$ select card_id from public.card_events where type = 'stalled' order by card_id $$,
	$$ values ('5eed0000-0000-4000-8000-0000000000c3'::uuid),
	          ('5eed0000-0000-4000-8000-0000000000c4'::uuid),
	          ('5eed0000-0000-4000-8000-0000000000cf'::uuid),
	          ('5eed0000-0000-4000-8000-00000000d007'::uuid) $$,
	'exactement QUATRE événements stalled dans toute la base après le seed, un par affaire figée '
	'du jeu et aucun ailleurs');

select is(
	(select count(*) from public.card_events where type = 'stalled' and actor_id is not null),
	0::bigint,
	'l''acteur est NUL sur les QUATRE : auth.uid() rend NULL hors d''une requête PostgREST, et la '
	'nullité est donc OBTENUE par app.card_event_ecrire — jamais affectée, jamais remplacée par '
	'l''assignataire');

-- LE COMPTE PORTE SUR LES QUATRE, ET C'EST LE POINT. Écrite `jsonb_object_keys(payload)` sur un
-- seul événement, l'assertion serait verte alors qu'une seconde relance porterait trois clés.
select is(
	(select count(*) from public.card_events
	  where type = 'stalled'
	    and (select array_agg(k order by k) from jsonb_object_keys(payload) k)
	        <> array['retard_jours', 'seuil_jours']),
	0::bigint,
	'les QUATRE payloads portent EXACTEMENT deux clés : un libellé recopié dirait demain ce qui '
	'était vrai aujourd''hui (docs/SPEC-cards.md §14.6), et le step_id serait un doublon de '
	'l''ordre du fil');

-- Les quatre couples (seuil, retard) sont ceux du §10.2.1, et ils DIFFÈRENT tous : une assertion
-- qui n'en lirait qu'un ne distinguerait pas un payload calculé d'un payload constant.
select results_eq(
	$$ select (payload->>'seuil_jours')::int, (payload->>'retard_jours')::int
	     from public.card_events where type = 'stalled' order by 2 desc $$,
	$$ values (5, 35), (7, 18), (14, 16), (5, 7) $$,
	'les deux nombres de chaque relance sont ceux que public.cards_figees() rend : le seuil de '
	'l''étape et le retard à l''instant de l''inscription, seul nombre non recalculable après coup');

-- ---------------------------------------------------------------------------------------------
-- 17 et 18. L'idempotence — §9.4
-- ---------------------------------------------------------------------------------------------

select is(
	app.relancer_cards_figees(),
	0,
	'un second passage n''inscrit RIEN : une card figée depuis six semaines ne reçoit pas '
	'quarante-deux événements');

select is(
	pg_temp.stalled_de(pg_temp.card_figee()),
	1::bigint,
	'et la card ne porte toujours qu''un seul stalled — le compte, pas seulement la valeur rendue');

-- ---------------------------------------------------------------------------------------------
-- 19 à 22. Le réarmement, et ce que le passage COURANT écrit — §9.4, §9.5, §9.6
-- ---------------------------------------------------------------------------------------------
-- L'histoire posée : un `stalled` écrit il y a soixante jours, lors d'un séjour PRÉCÉDENT, puis une
-- entrée dans l'étape il y a trente jours — ce que fait `move_card`, qui repose `entered_step_at`.
-- Le prédicat doit relancer, sinon une affaire déplacée puis rendormie ne serait plus jamais
-- signalée.

insert into public.card_events (card_id, workspace_id, type, actor_id, payload, created_at)
select id, workspace_id, 'stalled', null,
       jsonb_build_object('seuil_jours', 7, 'retard_jours', 1), now() - interval '60 days'
  from public.cards where id = pg_temp.card_rearmement();

update public.cards set entered_step_at = now() - interval '30 days'
 where id = pg_temp.card_rearmement();

select is(
	app.relancer_cards_figees(),
	1,
	'RÉARMEMENT : une entrée dans l''étape postérieure au dernier stalled relance l''inscription — '
	'tout move_card réarme donc la relance sans qu''aucune ligne ne le prévoie');

select is(
	pg_temp.stalled_de(pg_temp.card_rearmement()),
	2::bigint,
	'la card porte alors DEUX stalled : un par séjour dans l''étape, et l''histoire des deux '
	'séjours est conservée');

-- LES DEUX ASSERTIONS SUIVANTES PORTENT SUR L'ÉVÉNEMENT QUE CETTE SUITE VIENT DE FAIRE ÉCRIRE, et
-- non sur celui du seed. La distinction n'est pas cosmétique : elle a été TROUVÉE PAR LE HARNAIS.
-- `scripts/verify-relances.sh` a dégradé la fonction — un libellé ajouté au payload, un acteur
-- inventé par `set_config` — et la suite est restée VERTE, parce que les assertions 14 et 15 lisent
-- l'événement du seed, écrit AVANT la dégradation et que rien ne réécrit. Une preuve qui ne relit
-- que le passé ne mesure pas le produit courant.

select is(
	(select e.actor_id from public.card_events e
	  where e.card_id = pg_temp.card_rearmement() and e.type = 'stalled'
	  order by e.created_at desc limit 1),
	null::uuid,
	'l''acteur de l''événement QUE CE PASSAGE VIENT D''ÉCRIRE est nul : la nullité est obtenue à '
	'chaque inscription, et non héritée d''une ligne ancienne');

select results_eq(
	$$ select jsonb_object_keys(payload) from public.card_events
	    where card_id = '5eed0000-0000-4000-8000-0000000000c2' and type = 'stalled'
	      and created_at >= now() - interval '1 day'
	    order by 1 $$,
	$$ values ('retard_jours'), ('seuil_jours') $$,
	'le payload QUE CE PASSAGE VIENT D''ÉCRIRE porte exactement deux clés : un libellé ajouté au '
	'code serait vu ici, là où l''assertion sur l''événement du seed ne le verrait jamais');

-- ---------------------------------------------------------------------------------------------
-- 23 à 25. Les exclusions sont HÉRITÉES, dans les deux sens — §9.2
-- ---------------------------------------------------------------------------------------------
-- La fonction n'a aucune garde propre : elle relance ce que `public.cards_figees()` lui rend. Ces
-- assertions le prouvent par le comportement plutôt que par la lecture du corps — une garde
-- recopiée ici, et qui divergerait un jour, ne serait pas vue autrement.

update public.cards set entered_step_at = now() - interval '30 days', archived_at = now()
 where id = pg_temp.card_archivage();

select is(
	app.relancer_cards_figees(),
	0,
	'une card ARCHIVÉE, même largement au-delà de son seuil, ne reçoit aucune relance : '
	'l''exclusion est héritée de public.cards_figees(), pas recopiée ici');

update public.cards set archived_at = null where id = pg_temp.card_archivage();

select is(
	app.relancer_cards_figees(),
	1,
	'DÉSARCHIVÉE, la même card est relancée — l''exclusion mord dans les deux sens, et l''absence '
	'de relance ne venait pas d''un défaut de la fonction');

update public.cards set entered_step_at = now() - interval '30 days', deleted_at = now()
 where id = pg_temp.card_corbeille();

select is(
	app.relancer_cards_figees(),
	0,
	'une card EN CORBEILLE ne reçoit aucune relance : relancer une affaire supprimée serait la '
	'ressortir de la corbeille par la timeline');

select * from finish();

rollback;
