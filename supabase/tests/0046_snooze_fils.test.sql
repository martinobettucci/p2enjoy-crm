-- @verifies CRM-081 (docs/BACKLOG.md) — snooze des fils et des cards, TRANCHE 2 c : le sommeil
--           d'un FIL de messagerie
-- @verifies docs/SPEC-cards.md §16.14.2 (la clé d'un fil, et pourquoi aucune colonne n'est
--           ajoutée), §16.14.3 (l'état est une ligne, son absence est « éveillé »), §16.14.4
--           (`snooze_thread` et ses TROIS refus), §16.14.5 (`wake_thread` et son idempotence),
--           §16.14.6 (qui lit la ligne), §16.14.9 (preuves exigées)
-- @verifies docs/SPEC-cards.md §16.2 (ce que « en sommeil » signifie)
-- @verifies docs/SPEC-permissions-rls.md §4.3 (règle de discrétion), §4.4 (une colonne constatée
--           par le serveur n'est pas offerte au client)
-- @verifies docs/SCHEMA.md §7 (sous-système de messagerie), §9 (fonctions et RPC)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. `app.cle_fil` sur les DEUX cas de la mesure 2 — chaîne vide et chaîne peuplée. Le second cas
--    n'existe pas dans le seed : il est fabriqué en mémoire, puisque la fonction est `immutable`
--    et ne lit rien.
--
-- 2. La FORME de la table : ses colonnes, sa clé primaire composite, la non-nullité de
--    `snoozed_until`, et le refus d'une clé blanche. Une clé blanche désignerait tous les fils
--    sans racine à la fois.
--
-- 3. Les PRIVILÈGES, accordés ET refusés. La fermeture en écriture est ce qui fait des deux
--    fonctions le seul chemin : sans elle, les trois refus seraient contournables par un `POST`
--    direct sur la table.
--
-- 4. La FORME des trois fonctions — `security definer`, `search_path` vidé, propriétaire — et
--    `anon` nommément exclu des deux RPC. Une garde qu'un appelant anonyme pourrait invoquer ne
--    serait pas une garde.
--
-- 5. Les TROIS refus de `snooze_thread`, dans l'ordre où la garde les oppose, et chacun contre son
--    succès correspondant : une assertion qui ne prouverait que le refus serait verte sur une
--    fonction qui refuse tout.
--
-- 6. LA RÈGLE DE DISCRÉTION AVEC DEUX PROFILS QUI DIFFÈRENT PAR CE QU'ILS LISENT, et non par leur
--    rôle : le business developer lit le fil classé et pas l'autre. Le même appel réussit sur l'un
--    et rend `thread_not_found` sur l'autre — la distinction tient donc à la lisibilité du fil, et
--    à rien d'autre.
--
-- 7. Que le REPORT remplace l'échéance sans créer de seconde ligne, et que `snoozed_by` suit celui
--    qui a reporté.
--
-- 8. Que `wake_thread` est IDEMPOTENTE et le DIT : `true` puis `false`, sans refus.
--
-- La suite joue les gestes avec les comptes RÉELS du seed et fait `rollback` : le seed est rendu
-- intact, et aucune ligne de sommeil n'y survit.

begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- Les constantes du seed, nommées une fois. `docs/SPEC-seed.md` les fige.
create or replace function pg_temp.ws()      returns uuid as $$ select '5eed0000-0000-4000-8000-000000000001'::uuid $$ language sql immutable;
create or replace function pg_temp.admin()   returns uuid as $$ select '5eed0000-0000-4000-8000-000000000011'::uuid $$ language sql immutable;
create or replace function pg_temp.bizdev()  returns uuid as $$ select '5eed0000-0000-4000-8000-000000000012'::uuid $$ language sql immutable;
create or replace function pg_temp.viewer()  returns uuid as $$ select '5eed0000-0000-4000-8000-000000000013'::uuid $$ language sql immutable;
create or replace function pg_temp.classe()  returns text as $$ select '<seed-inbox-classe@p2enjoy.test>'::text $$ language sql immutable;
create or replace function pg_temp.nclasse() returns text as $$ select '<seed-inbox-non-classe@p2enjoy.test>'::text $$ language sql immutable;

-- =============================================================================================
-- 1. `app.cle_fil` — docs/SPEC-cards.md §16.14.2
-- =============================================================================================

select is(
	app.cle_fil('{}'::text[], '<seul@p2enjoy.test>'),
	'<seul@p2enjoy.test>',
	'cle_fil : une chaîne VIDE rend le Message-ID propre — cas courant, mesuré sur le seed'
);

select is(
	app.cle_fil(array['<racine@p2enjoy.test>', '<parent@p2enjoy.test>'], '<moi@p2enjoy.test>'),
	'<racine@p2enjoy.test>',
	'cle_fil : une chaîne peuplée rend son PREMIER élément, la racine RFC 5322 — jamais le parent'
);

select is(
	app.cle_fil(null, '<moi@p2enjoy.test>'),
	'<moi@p2enjoy.test>',
	'cle_fil : une chaîne NULLE se comporte comme une chaîne vide'
);

select ok(
	(select provolatile = 'i' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'cle_fil'),
	'cle_fil est IMMUTABLE — condition de l''index d''expression, non un ornement'
);

select has_index(
	'public', 'mail_messages', 'mail_messages_cle_fil_idx',
	'L''index d''expression existe : la garde ne balaie pas la table'
);

-- La mesure 1 du §16.14.1, FIGÉE : aucune colonne `thread` n'est ajoutée à `mail_messages`. Cette
-- assertion se retournera le jour où la tranche d'écran en posera une, et elle le dira.
select is(
	(select count(*)::int from information_schema.columns
	  where table_schema = 'public' and table_name = 'mail_messages' and column_name ilike '%thread%'),
	0,
	'AUCUNE colonne de fil sur mail_messages : le §16.14.2 a retenu l''index, pas la colonne générée'
);

-- =============================================================================================
-- 2. La forme de la table — docs/SPEC-cards.md §16.14.3
-- =============================================================================================

select has_table('public', 'mail_thread_snoozes', 'La table de sommeil des fils existe');

select col_is_pk(
	'public', 'mail_thread_snoozes', array['workspace_id', 'thread_key'],
	'La clé primaire est le COUPLE : la clé d''un fil n''est unique que dans son workspace (mesure 5)'
);

select col_not_null(
	'public', 'mail_thread_snoozes', 'snoozed_until',
	'snoozed_until est NON NULLE : une ligne sans échéance n''a pas de sens que son absence ne dise mieux'
);

select col_is_null(
	'public', 'mail_thread_snoozes', 'snoozed_by',
	'snoozed_by est nullable : la suppression d''un profil ne doit pas réveiller un fil'
);

select throws_ok(
	$$ insert into public.mail_thread_snoozes (workspace_id, thread_key, snoozed_until)
	   values ('5eed0000-0000-4000-8000-000000000001', '   ', now() + interval '1 day') $$,
	'23514',
	null,
	'Une clé BLANCHE est refusée : elle désignerait tous les fils sans racine à la fois'
);

select lives_ok(
	$$ insert into public.mail_thread_snoozes (workspace_id, thread_key, snoozed_until)
	   values ('5eed0000-0000-4000-8000-000000000001', '<temoin@p2enjoy.test>', now() + interval '1 day') $$,
	'TÉMOIN : une clé non blanche passe — le refus précédent n''est pas un refus de tout'
);

-- =============================================================================================
-- 3. Les privilèges — docs/SPEC-cards.md §16.14.6
-- =============================================================================================

select ok(
	has_table_privilege('authenticated', 'public.mail_thread_snoozes', 'select'),
	'authenticated LIT la ligne : l''écran devra montrer l''état'
);

select ok(
	not has_table_privilege('authenticated', 'public.mail_thread_snoozes', 'insert'),
	'authenticated n''INSÈRE pas : sans quoi les trois refus seraient contournables par un POST'
);

select ok(
	not has_table_privilege('authenticated', 'public.mail_thread_snoozes', 'update'),
	'authenticated ne MET PAS À JOUR : le report passe par la fonction, ou il ne passe pas'
);

select ok(
	not has_table_privilege('authenticated', 'public.mail_thread_snoozes', 'delete'),
	'authenticated ne SUPPRIME pas : le réveil passe par la fonction, ou il ne passe pas'
);

select ok(
	not has_table_privilege('anon', 'public.mail_thread_snoozes', 'select'),
	'anon ne lit rien : un état de sommeil n''est pas une donnée publique'
);

select ok(
	(select relrowsecurity from pg_class where oid = 'public.mail_thread_snoozes'::regclass),
	'La RLS est ACTIVE : le privilège de lecture ne suffit pas, la politique décide'
);

select policies_are(
	'public', 'mail_thread_snoozes', array['mail_thread_snoozes_lecture'],
	'UNE seule politique, et elle est de lecture : aucune écriture n''est ouverte par politique'
);

-- =============================================================================================
-- 4. La forme des trois fonctions — docs/SPEC-cards.md §16.14.4 et §16.14.5
-- =============================================================================================

select has_function('public', 'snooze_thread', array['uuid', 'text', 'timestamp with time zone'],
	'snooze_thread porte la signature du contrat d''API du §16.14.8');

select has_function('public', 'wake_thread', array['uuid', 'text'],
	'wake_thread porte la signature du contrat d''API du §16.14.8');

select is(
	(select array_agg(p.proname order by p.proname)::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where ((n.nspname = 'public' and p.proname in ('snooze_thread', 'wake_thread'))
	      or (n.nspname = 'app'    and p.proname = 'fil_lisible'))
	    and p.prosecdef
	    and p.proconfig @> array['search_path=""']
	    and p.proowner = 'postgres'::regrole),
	'{fil_lisible,snooze_thread,wake_thread}',
	'Les TROIS fonctions sont SECURITY DEFINER, search_path vidé, appartenant à postgres'
);

select ok(
	not has_function_privilege('anon', 'public.snooze_thread(uuid, text, timestamptz)', 'execute'),
	'anon n''exécute PAS snooze_thread : une garde qu''un anonyme invoque ne garde rien'
);

select ok(
	not has_function_privilege('anon', 'public.wake_thread(uuid, text)', 'execute'),
	'anon n''exécute PAS wake_thread, même raison'
);

-- La table témoin ne doit pas fausser les gestes qui suivent.
delete from public.mail_thread_snoozes where thread_key = '<temoin@p2enjoy.test>';

-- =============================================================================================
-- 5. Les trois refus, chacun contre son succès — docs/SPEC-cards.md §16.14.4
-- =============================================================================================

select pg_temp.endosser(pg_temp.admin());

select lives_ok(
	format($$ select public.snooze_thread(%L, %L, now() + interval '7 days') $$, pg_temp.ws(), pg_temp.classe()),
	'SUCCÈS de référence : l''administratrice lit le fil classé, donc elle l''endort'
);

select throws_ok(
	format($$ select public.snooze_thread(%L, %L, null) $$, pg_temp.ws(), pg_temp.classe()),
	'P0001', 'snooze_date_required',
	'Refus 2 : une échéance NULLE, sur un fil que l''appelante lit — la garde 1 est donc passée'
);

select throws_ok(
	format($$ select public.snooze_thread(%L, %L, now() - interval '1 day') $$, pg_temp.ws(), pg_temp.classe()),
	'P0001', 'snooze_date_in_past',
	'Refus 3 : une échéance PASSÉE rendrait le fil immédiatement éveillé — succès simulé'
);

select throws_ok(
	format($$ select public.snooze_thread(%L, %L, now() + interval '7 days') $$, pg_temp.ws(), '<inconnu@p2enjoy.test>'),
	'P0001', 'thread_not_found',
	'Refus 1 : un fil INEXISTANT est introuvable, et non « interdit »'
);

-- =============================================================================================
-- 6. La discrétion, mesurée par ce que le profil LIT — docs/SPEC-cards.md §16.14.4
-- =============================================================================================
-- LE MÊME PROFIL DANS LES DEUX CAS. Le business developer lit le fil classé et pas l'autre
-- (mesure 6) : le succès puis le refus établissent que la distinction tient à la LISIBILITÉ DU
-- FIL, non au rôle de l'appelant. Deux profils différents n'auraient rien prouvé de tel.

select pg_temp.endosser(pg_temp.bizdev());

select lives_ok(
	format($$ select public.snooze_thread(%L, %L, now() + interval '3 days') $$, pg_temp.ws(), pg_temp.classe()),
	'Le business developer endort le fil CLASSÉ, qu''il lit — aucun droit d''écriture n''est exigé'
);

select throws_ok(
	format($$ select public.snooze_thread(%L, %L, now() + interval '3 days') $$, pg_temp.ws(), pg_temp.nclasse()),
	'P0001', 'thread_not_found',
	'LE MÊME profil est refusé sur le fil NON CLASSÉ, qu''il ne lit pas : la discrétion tient au fil'
);

select pg_temp.endosser(pg_temp.viewer());

select throws_ok(
	format($$ select public.snooze_thread(%L, %L, now() + interval '3 days') $$, pg_temp.ws(), pg_temp.classe()),
	'P0001', 'thread_not_found',
	'La lectrice ne lit AUCUN message : les deux fils lui sont indistinctement introuvables'
);

-- =============================================================================================
-- 7. Le report, et 8. l'idempotence — docs/SPEC-cards.md §16.14.4 et §16.14.5
-- =============================================================================================

select pg_temp.endosser(pg_temp.admin());

select is(
	(select count(*)::int from public.mail_thread_snoozes where thread_key = pg_temp.classe()),
	1,
	'Après trois mises en sommeil du MÊME fil, UNE seule ligne : le report remplace, il n''empile pas'
);

select is(
	(select snoozed_by from public.mail_thread_snoozes where thread_key = pg_temp.classe()),
	pg_temp.bizdev(),
	'snoozed_by suit CELUI QUI A REPORTÉ, et non celui qui a endormi le premier'
);

select is(
	(select public.wake_thread(pg_temp.ws(), pg_temp.classe())),
	true,
	'wake_thread rend TRUE quand une ligne a réellement été retirée'
);

select is(
	(select count(*)::int from public.mail_thread_snoozes where thread_key = pg_temp.classe()),
	0,
	'Le réveil SUPPRIME la ligne : l''absence est la représentation honnête de « éveillé »'
);

select is(
	(select public.wake_thread(pg_temp.ws(), pg_temp.classe())),
	false,
	'IDEMPOTENTE : un réveil sans sommeil rend FALSE, et ne refuse pas — ce n''est pas une erreur du demandeur'
);

select throws_ok(
	format($$ select public.wake_thread(%L, %L) $$, pg_temp.ws(), '<inconnu@p2enjoy.test>'),
	'P0001', 'thread_not_found',
	'wake_thread garde le MÊME prédicat : réveiller un fil qu''on ne lit pas n''est pas plus permis'
);

select pg_temp.redevenir_proprietaire();

select * from finish();

rollback;
