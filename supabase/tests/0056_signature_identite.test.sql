-- @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--           TRANCHE 3 : LA SIGNATURE
-- @verifies docs/SPEC-modeles-emails.md §10.2 (le nom et le type de la colonne, et sa borne),
--           §10.3 (les quatre règles de composition, le septième refus, la borne du corps
--           composé), §10.4 (les trois états de l'effacement), §10.5 (la signature appartient à
--           l'identité), §10.8 (aucune variable n'est substituée dans une signature)
-- @verifies docs/SPEC-mail-subsystem.md §14.2 (identités sortantes), §19.4 (la garde, seule porte
--           de la file), §22.1 (pourquoi le champ était refusé à l'écran)
-- @verifies docs/SCHEMA.md §7 (messagerie) ; docs/INCONSISTENCY_REPORT.md INC-215
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. LA COLONNE. `signature_text` existe, `signature_html` a DISPARU, et la borne refuse — son
--    témoin à deux mille caractères passant d'abord. Une borne dont le témoin n'est pas joué
--    pourrait refuser tout.
--
-- 2. LA COMPOSITION, CARACTÈRE À CARACTÈRE. Les quatre règles du §10.3 sont comparées à des
--    chaînes littérales, jamais à une longueur ni à un `like` : c'est la seule forme d'assertion
--    qui dénonce une ligne vide de trop ou une espace de séparateur perdue.
--
-- 3. LES TROIS ÉTATS DE L'EFFACEMENT, chacun PRÉCÉDÉ DE SON TÉMOIN (règle du dépôt, décision 70).
--    « Vide efface » ne prouve rien si l'on n'a pas d'abord constaté que la valeur était écrite.
--
-- 4. LA GARDE. Le corps mis en file est le corps SIGNÉ ; le corps vide est refusé AVANT toute
--    composition ; et un corps qui ne dépasse la borne QU'UNE FOIS SIGNÉ est refusé, son témoin
--    non signé passant d'abord.
--
-- 5. LES PRIVILÈGES, avec les rôles réels.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact. Les identités
-- du seed sont retrouvées par leur ADRESSE et non par un identifiant en dur : `apply-seed.sh` les
-- crée par la route REST, et leurs identifiants sont tirés au hasard à chaque application.

begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
	execute 'set local role anon';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Ce que la suite désigne, mesuré et non deviné.
-- ---------------------------------------------------------------------------------------------

create temporary table pg_temp_reperes (cle text primary key, valeur uuid);

-- LE `grant` EST INDISPENSABLE, et c'est MESURÉ : les repères sont relus SOUS le rôle
-- `authenticated`, que la suite endosse au §3 et au §4, et une table temporaire appartient au
-- propriétaire de la session. Sans lui : `ERROR: permission denied for table pg_temp_reperes`.
grant select on pg_temp_reperes to authenticated;

insert into pg_temp_reperes (cle, valeur)
select 'identite_driss', i.id
  from public.mail_outbound_identities i
 where i.from_address = 'contact@p2enjoy.test';

insert into pg_temp_reperes (cle, valeur)
select 'identite_service', i.id
  from public.mail_outbound_identities i
 where i.owner_id is null;

-- L'affaire est celle du seed dont `CRM-040` garantit que Driss l'écrit, et elle porte une adresse
-- — sans quoi la garde refuserait `card_not_available` avant d'atteindre ce que l'on mesure.
insert into pg_temp_reperes (cle, valeur)
values ('card', '5eed0000-0000-4000-8000-0000000000c1');

create or replace function pg_temp.repere(p_cle text)
returns uuid language sql stable as $$
	select valeur from pg_temp_reperes where cle = p_cle;
$$;

-- =============================================================================================
-- 1. La colonne, son absence d'avant, et sa borne — §10.2
-- =============================================================================================

select has_column('public', 'mail_outbound_identities', 'signature_text',
	'CRM-063 §10.2 — la colonne s''appelle signature_text');

select hasnt_column('public', 'mail_outbound_identities', 'signature_html',
	'CRM-063 §10.2 — signature_html a DISPARU : le nom annonçait du HTML là où tout le '
	'sous-système expédie du texte (INC-215)');

select col_type_is('public', 'mail_outbound_identities', 'signature_text', 'text',
	'CRM-063 §10.2 — du TEXTE, et le type ne change pas');

select col_is_null('public', 'mail_outbound_identities', 'signature_text',
	'CRM-063 §10.2 — NULL est l''absence de signature, et c''est l''état des deux identités du seed');

select has_check('public', 'mail_outbound_identities',
	'CRM-063 §10.2 — la table porte des contraintes de borne');

-- LE TÉMOIN AVANT LE REFUS. Deux mille caractères passent…
select lives_ok(
	$$ update public.mail_outbound_identities
	      set signature_text = repeat('s', 2000)
	    where from_address = 'contact@p2enjoy.test' $$,
	'CRM-063 §10.2 — TÉMOIN : deux mille caractères de signature sont acceptés');

-- … deux mille et un sont refusés, et la contrainte est nommée.
select throws_ok(
	$$ update public.mail_outbound_identities
	      set signature_text = repeat('s', 2001)
	    where from_address = 'contact@p2enjoy.test' $$,
	'23514',
	null,
	'CRM-063 §10.2 — 2001 caractères sont refusés : la borne protège celle de mail_outbox_corps');

-- =============================================================================================
-- 2. `app.mail_corps_signe` — les quatre règles, caractère à caractère — §10.3
-- =============================================================================================

select is(
	app.mail_corps_signe('Bonjour.', null),
	'Bonjour.',
	'CRM-063 §10.3 règle 1 — signature ABSENTE : le corps est rendu inchangé, sans ligne vide '
	'ajoutée et sans séparateur');

select is(
	app.mail_corps_signe('Bonjour.', '   ' || chr(10) || '  '),
	'Bonjour.',
	'CRM-063 §10.3 règle 2 — signature BLANCHE : traitée comme absente, jamais un séparateur '
	'suivi de rien');

select is(
	app.mail_corps_signe('Bonjour.', ''),
	'Bonjour.',
	'CRM-063 §10.3 règle 2 — la chaîne vide est traitée comme absente');

-- LA FORME EXACTE, ET C'EST L'ASSERTION QUI COMPTE LE PLUS DE LA SUITE : corps, ligne vide,
-- deux tirets, UNE ESPACE, retour à la ligne, signature. Une espace perdue rendrait la signature
-- non repliable par les clients de messagerie, et aucune autre assertion ne le verrait.
select is(
	app.mail_corps_signe('Bonjour,' || chr(10) || 'voici le devis.', 'Driss Lemoine'),
	'Bonjour,' || chr(10) || 'voici le devis.' || chr(10) || chr(10) || '--' || ' ' || chr(10)
		|| 'Driss Lemoine',
	'CRM-063 §10.3 règle 4 — le séparateur est celui de la RFC 3676 §4.3 : deux tirets et UNE '
	'espace, sur sa propre ligne');

select is(
	app.mail_corps_signe('Bonjour.' || chr(10) || chr(10) || chr(10) || '  ', 'Driss'),
	'Bonjour.' || chr(10) || chr(10) || '--' || ' ' || chr(10) || 'Driss',
	'CRM-063 §10.3 règle 3 — les blancs de FIN du corps sont retirés : trois retours à la ligne '
	'ne produisent pas quatre lignes vides devant le séparateur');

select is(
	app.mail_corps_signe('Corps.', 'Driss Lemoine' || chr(10) || '  P2Enjoy  ' || chr(10) || 'Tel'),
	'Corps.' || chr(10) || chr(10) || '--' || ' ' || chr(10) || 'Driss Lemoine' || chr(10)
		|| '  P2Enjoy  ' || chr(10) || 'Tel',
	'CRM-063 §10.3 — la signature n''est PAS recadrée : ses blancs internes et ses retours à la '
	'ligne sont conservés, une signature EST une mise en forme');

-- §10.8 — une variable écrite dans une signature part LITTÉRALEMENT. Le comportement est FIGÉ ici
-- plutôt que laissé à l'interprétation de la première personne qui l'essaiera.
select is(
	app.mail_corps_signe('Corps.', '{{contact.full_name}}'),
	'Corps.' || chr(10) || chr(10) || '--' || ' ' || chr(10) || '{{contact.full_name}}',
	'CRM-063 §10.8 — aucune variable n''est substituée dans une signature : la substitution du §8 '
	'appartient au corps d''un modèle');

select is(
	app.mail_corps_signe(null, 'Driss'),
	null,
	'CRM-063 §10.3 — un corps nul rend nul : la fonction ne fabrique pas un message à partir de '
	'rien, et c''est la garde qui refuse');

-- =============================================================================================
-- 3. Les TROIS états de l'effacement, chacun précédé de son témoin — §10.4
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

-- État 3 — REMPLI écrit. C'est aussi le témoin des deux suivants : sans lui, « vide efface »
-- serait vert sur une colonne qui n'a jamais rien porté.
select lives_ok(
	$$ select public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001', 'Envoi de Driss Lemoine', 'stalwart', 587,
	     'none', 'bizdev@p2enjoy.test', 'contact@p2enjoy.test', null,
	     '5eed0000-0000-4000-8000-000000000012', null,
	     'Driss Lemoine — P2Enjoy', true, null) $$,
	'CRM-063 §10.4 — TÉMOIN : une signature remplie est acceptée par le chemin d''écriture');

select is(
	(select signature_text from public.mail_outbound_identities
	  where from_address = 'contact@p2enjoy.test'),
	'Driss Lemoine — P2Enjoy',
	'CRM-063 §10.4 état « rempli » — la signature est ÉCRITE');

-- État 1 — OMIS conserve.
--
-- L'APPEL EST EN NOTATION NOMMÉE, ET UNE MESURE L'IMPOSE : écrit en positionnel, il ne pouvait
-- omettre `p_signature_text` sans omettre AUSSI `p_owner_id`, qui retombe alors sur son défaut
-- `null` — c'est-à-dire sur l'identité de SERVICE, réservée aux administrateurs. La suite mourait
-- sur un `forbidden` qui ne disait rien de la signature. Ce qu'on veut omettre, c'est la
-- signature, et elle seule.
select lives_ok(
	$$ select public.upsert_mail_outbound_identity(
	     p_workspace_id  => '5eed0000-0000-4000-8000-000000000001',
	     p_label         => 'Envoi de Driss Lemoine',
	     p_smtp_host     => 'stalwart',
	     p_smtp_port     => 587,
	     p_smtp_security => 'none',
	     p_smtp_username => 'bizdev@p2enjoy.test',
	     p_from_address  => 'contact@p2enjoy.test',
	     p_owner_id      => '5eed0000-0000-4000-8000-000000000012') $$,
	'CRM-063 §10.4 — un appel qui OMET la signature est accepté');

select is(
	(select signature_text from public.mail_outbound_identities
	  where from_address = 'contact@p2enjoy.test'),
	'Driss Lemoine — P2Enjoy',
	'CRM-063 §10.4 état « omis » — la signature enregistrée est CONSERVÉE');

-- État 2 — VIDE efface, et c'est la réparation que la tranche apporte : le `coalesce` d'avant
-- rendait la colonne ineffaçable, motif exact du refus du §22.1.
select lives_ok(
	$$ select public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001', 'Envoi de Driss Lemoine', 'stalwart', 587,
	     'none', 'bizdev@p2enjoy.test', 'contact@p2enjoy.test', null,
	     '5eed0000-0000-4000-8000-000000000012', null, '', true, null) $$,
	'CRM-063 §10.4 — un appel portant une signature VIDE est accepté');

select is(
	(select signature_text from public.mail_outbound_identities
	  where from_address = 'contact@p2enjoy.test'),
	null,
	'CRM-063 §10.4 état « vide » — la signature est EFFACÉE, et ramenée à NULL et non à la chaîne '
	'vide : le produit ne connaît qu''UN état d''absence');

-- Une signature entièrement blanche s'efface comme une signature vide : la normalisation passe par
-- `app.btrim_blancs`, et non par une comparaison à `''`.
select lives_ok(
	$$ select public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001', 'Envoi de Driss Lemoine', 'stalwart', 587,
	     'none', 'bizdev@p2enjoy.test', 'contact@p2enjoy.test', null,
	     '5eed0000-0000-4000-8000-000000000012', null, 'Signature témoin', true, null) $$,
	'CRM-063 §10.4 — TÉMOIN : la signature est réécrite avant le cas blanc');

select lives_ok(
	$$ select public.upsert_mail_outbound_identity(
	     '5eed0000-0000-4000-8000-000000000001', 'Envoi de Driss Lemoine', 'stalwart', 587,
	     'none', 'bizdev@p2enjoy.test', 'contact@p2enjoy.test', null,
	     '5eed0000-0000-4000-8000-000000000012', null, '   ', true, null) $$,
	'CRM-063 §10.4 — un appel portant une signature entièrement BLANCHE est accepté');

select is(
	(select signature_text from public.mail_outbound_identities
	  where from_address = 'contact@p2enjoy.test'),
	null,
	'CRM-063 §10.4 — une signature blanche EFFACE, comme une signature vide');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 4. La garde — le corps mis en file est le corps SIGNÉ — §10.3
-- =============================================================================================

-- La signature est posée en propriétaire : ce qui est mesuré ici est la GARDE, pas le chemin
-- d'écriture, déjà prouvé au §3 ci-dessus.
update public.mail_outbound_identities
   set signature_text = 'Driss Lemoine' || chr(10) || 'P2Enjoy SAS'
 where from_address = 'contact@p2enjoy.test';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select lives_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['client@example.test'],
	                                             'Objet de la suite 0056', 'Bonjour.') $$,
	       pg_temp.repere('card'), pg_temp.repere('identite_driss')),
	'CRM-063 §10.3 — la mise en file est acceptée depuis une identité qui porte une signature');

select is(
	(select o.body_text from public.mail_outbox o
	  where o.subject = 'Objet de la suite 0056'),
	'Bonjour.' || chr(10) || chr(10) || '--' || ' ' || chr(10) || 'Driss Lemoine' || chr(10)
		|| 'P2Enjoy SAS',
	'CRM-063 §10.3 — CE QUI EST STOCKÉ EST CE QUI PART : la file porte le corps SIGNÉ, et non le '
	'corps écrit');

-- LE SEPTIÈME REFUS, ET SON TÉMOIN EST L'ASSERTION PRÉCÉDENTE : le même appel avec un corps non
-- vide vient de passer.
select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['client@example.test'],
	                                             'Objet vide 0056', '') $$,
	       pg_temp.repere('card'), pg_temp.repere('identite_driss')),
	'23514',
	'body_required',
	'CRM-063 §10.3 — body_required : une signature ne rattrape pas un corps vide, et le refus est '
	'ANTÉRIEUR à la composition');

select is(
	(select count(*)::integer from public.mail_outbox o where o.subject = 'Objet vide 0056'),
	0,
	'CRM-063 §10.3 — le refus n''a rien mis en file');

-- LE `SQLSTATE` NE CHANGE PAS, et c'est ce qui laisse l'écran inchangé : `webapp/src/lib/envoi.ts`
-- classe par code et non par message, et rend donc le même « invalide » qu'avant.
select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array[]::text[],
	                                             'Objet sans destinataire 0056', 'Bonjour.') $$,
	       pg_temp.repere('card'), pg_temp.repere('identite_driss')),
	'23514',
	'recipient_required',
	'CRM-063 §10.3 — les six refus de CRM-058 sont repris à l''identique, codes compris');

-- LA BORNE HAUTE S'APPLIQUE AU CORPS COMPOSÉ (§10.3), et le montage ne fait varier QU'UNE chose :
-- la même affaire, la même identité, le même corps, la signature en moins puis en plus. Un témoin
-- joué sur une AUTRE identité prouverait moins — l'identité de service, réservée aux
-- administrateurs, refuserait d'ailleurs Driss avant d'atteindre la borne (mesuré).
select pg_temp.redevenir_proprietaire();

update public.mail_outbound_identities
   set signature_text = null
 where from_address = 'contact@p2enjoy.test';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select lives_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['client@example.test'],
	                'Objet long témoin 0056', %L) $$,
	       pg_temp.repere('card'), pg_temp.repere('identite_driss'), repeat('x', 99990)),
	'CRM-063 §10.3 — TÉMOIN : 99 990 caractères passent, la même identité ne signant pas');

select pg_temp.redevenir_proprietaire();

update public.mail_outbound_identities
   set signature_text = 'Driss Lemoine' || chr(10) || 'P2Enjoy SAS'
 where from_address = 'contact@p2enjoy.test';

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select throws_ok(
	format($$ select public.queue_outbound_email(%L::uuid, %L::uuid, array['client@example.test'],
	                'Objet long refusé 0056', %L) $$,
	       pg_temp.repere('card'), pg_temp.repere('identite_driss'), repeat('x', 99990)),
	'23514',
	null,
	'CRM-063 §10.3 — le MÊME corps est refusé dès que l''identité signe : la borne porte sur le '
	'corps COMPOSÉ, puisque c''est lui qui part');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. Privilèges — §10.2 et §10.6
-- =============================================================================================

select is(
	has_column_privilege('authenticated', 'public.mail_outbound_identities', 'signature_text',
	                     'select'),
	true,
	'CRM-063 §10.6 — un porteur de jeton LIT la signature : l''écran ne peut pas proposer de '
	'modifier ce qu''il ne montre pas');

select is(
	has_column_privilege('anon', 'public.mail_outbound_identities', 'signature_text', 'select'),
	false,
	'CRM-063 §10.2 — l''anonyme ne lit AUCUNE colonne de cette table, la signature comprise');

select is(
	has_function_privilege('anon', 'app.mail_corps_signe(text, text)', 'execute'),
	false,
	'CRM-063 §10.3 — la règle de composition est fermée à anon : un anonyme n''écrit aucun message');

select is(
	has_function_privilege('authenticated', 'app.mail_corps_signe(text, text)', 'execute'),
	true,
	'CRM-063 §10.3 — elle est ouverte à authenticated, sous qui la garde s''exécute');

select is(
	(select p.provolatile from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'mail_corps_signe'),
	'i'::"char",
	'CRM-063 §10.3 — la composition est IMMUTABLE : la même paire rend toujours le même texte, '
	'sans lire ni la base ni l''horloge');

select is(
	(select p.prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'mail_corps_signe'),
	false,
	'CRM-063 §10.3 — security INVOKER : la composition ne lit rien, elle n''a aucun droit à '
	'emprunter');

-- =============================================================================================
-- 6. La signature appartient à l'IDENTITÉ, pas à la personne — §10.5
-- =============================================================================================
-- L'assertion porte sur le MONTAGE, et c'est lui qui rend la décision opposable : l'identité de
-- SERVICE n'a aucun propriétaire, si bien qu'une signature portée par la personne la laisserait
-- sans signature possible.

select is(
	(select count(*)::integer from public.mail_outbound_identities where owner_id is null),
	1,
	'CRM-063 §10.5 — une identité du seed n''a AUCUN propriétaire : une signature portée par la '
	'personne la laisserait sans signature possible');

select lives_ok(
	$$ update public.mail_outbound_identities
	      set signature_text = 'P2Enjoy SAS — service client'
	    where owner_id is null $$,
	'CRM-063 §10.5 — l''identité de service porte sa propre signature');

select hasnt_column('public', 'profiles', 'signature_text',
	'CRM-063 §10.5 — aucune signature n''est portée par le PROFIL : la clé de la table des '
	'identités est un triplet, et deux adresses d''une même personne ne se signent pas pareil');

-- =============================================================================================
-- 7. Le seed est rendu intact
-- =============================================================================================
-- Toutes les écritures de cette suite vivent dans la transaction, que le `rollback` défait.

select * from finish();

rollback;
