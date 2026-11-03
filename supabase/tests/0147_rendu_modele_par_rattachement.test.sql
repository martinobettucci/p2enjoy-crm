-- @verifies CRM-111 (docs/BACKLOG.md) — tranche T6.2 : le rendu d'un modèle par rattachement
-- @verifies docs/SPEC-modeles-emails.md §15.2 (le rattachement désigné, le plus ancien lisible à défaut, zéro ligne pour
--           un rattachement d'une autre affaire ou masqué, la forme à quatre paramètres supprimée, privilèges), §15.3 (la
--           relance rend avec le rattachement de son inscription) ; docs/SPEC-rattachements.md §7 (décisions 657 et
--           821) ; docs/SCHEMA.md « Migration `0158` »
--
-- Sur le seed migré ; tout se joue dans une transaction annulée. …0c4 (« Refonte de site », étape « Négociation ») est
-- rattachée en plus à `grands-comptes` (track « Conseil & IA », fermé à la lectrice) par `attach_card`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

\set w '5eed0000-0000-4000-8000-000000000001'
\set admin '5eed0000-0000-4000-8000-000000000011'
\set lectrice '5eed0000-0000-4000-8000-000000000013'
\set c1 '5eed0000-0000-4000-8000-0000000000c1'
\set c4 '5eed0000-0000-4000-8000-0000000000c4'
\set grands_comptes '5eed0000-0000-4000-8000-000000000032'
\set modele 'd0000000-0000-4000-8000-0000000147a1'
\set sequence 'd0000000-0000-4000-8000-0000000147b1'

-- Le modèle dit d'où il vient : son objet est le channel, son corps l'étape, le montant et la prochaine action.
insert into public.mail_templates (id, workspace_id, name, subject, body_text)
values (:'modele', :'w', 'Modèle d''essai de la suite 0147', '{{card.channel}}',
        '{{card.step}} / {{card.amount}} / {{card.next_action}} / {{card.title}}');

-- =============================================================================================
-- 1. La signature
-- =============================================================================================

select has_function('public', 'rendre_modele_email', array['uuid', 'uuid', 'uuid', 'uuid', 'uuid'],
	'`rendre_modele_email` reçoit le rattachement en cinquième paramètre');
select hasnt_function('public', 'rendre_modele_email', array['uuid', 'uuid', 'uuid', 'uuid'],
	'la forme à quatre paramètres est supprimée, non surchargée : aucun appel ambigu');
select ok(not has_function_privilege('anon', 'public.rendre_modele_email(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE')
          and has_function_privilege('authenticated', 'public.rendre_modele_email(uuid,uuid,uuid,uuid,uuid)', 'EXECUTE'),
	'privilèges de la 0056 : `authenticated` exécute, `anon` jamais');

-- =============================================================================================
-- 2. Le rattachement désigné, et le plus ancien à défaut
-- =============================================================================================

select pg_temp.endosser(:'admin');
select lives_ok(format('select public.attach_card(%L, %L)', :'c4', :'grands_comptes'),
	'…0c4 est rattachée en plus à `grands-comptes`');
select pg_temp.proprietaire();

update public.card_placements
   set amount = 4321, next_action = 'Appeler le grand compte'
 where card_id = :'c4' and channel_id = :'grands_comptes';
select set_config('tests.second', (select id::text from public.card_placements
                                    where card_id = :'c4' and channel_id = :'grands_comptes'), true);
select set_config('tests.premier', app.card_first_placement(:'c4')::text, true);

select pg_temp.endosser(:'admin');
select is((select subject from public.rendre_modele_email(:'modele', :'c4')),
          'Refonte de site',
	'sans rattachement désigné : le plus ancien, comme la 0109');
select is((select subject || ' | ' || body_text
             from public.rendre_modele_email(:'modele', :'c4', null, null, current_setting('tests.second')::uuid)),
          'Grands comptes | Prospection / 4321.00 / Appeler le grand compte / '
          || (select title from public.cards where id = :'c4'),
	'rattachement désigné : SON channel, SON étape, SON montant, SA prochaine action ; le titre reste celui de l''affaire');
select is((select subject from public.rendre_modele_email(:'modele', :'c4', null, null,
                                                          current_setting('tests.premier')::uuid)),
          'Refonte de site',
	'le plus ancien, désigné, rend ce que rend l''absence de désignation');
select is((select count(*)::int from public.rendre_modele_email(:'modele', :'c1', null, null,
                                                               current_setting('tests.second')::uuid)),
          0,
	'un rattachement d''une AUTRE affaire rend zéro ligne, jamais l''affaire sur un channel qui n''est pas le sien');
select is((select count(*)::int from public.rendre_modele_email(:'modele', :'c4', null, null,
                                                               '00000000-0000-4000-8000-000000000000')),
          0,
	'un rattachement inconnu rend zéro ligne');
select pg_temp.proprietaire();

-- =============================================================================================
-- 3. La lectrice, fermée à « Conseil & IA »
-- =============================================================================================

select pg_temp.endosser(:'lectrice');
select is((select subject from public.rendre_modele_email(:'modele', :'c4')),
          'Refonte de site',
	'la lectrice lit …0c4 par son rattachement de « Studio web »');
select is((select count(*)::int from public.rendre_modele_email(:'modele', :'c4', null, null,
                                                               current_setting('tests.second')::uuid)),
          0,
	'… et un rattachement d''un track qui lui est fermé rend zéro ligne, comme un inconnu : rien n''est divulgué');
select pg_temp.proprietaire();

-- =============================================================================================
-- 4. La relance rend avec le rattachement de son inscription
-- =============================================================================================
-- Une cadence d'un palier à un jour (le délai est borné, `mail_sequence_steps_delai_borne`), armée sur le SECOND
-- rattachement, figé pour l'occasion (le figement est la condition (f) de l'armement) ; l'armement est antidaté de deux
-- jours, et le job fait partir le palier au premier passage.

insert into public.mail_sequences (id, workspace_id, name)
values (:'sequence', :'w', 'Séquence d''essai de la suite 0147');
insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
values (:'w', :'sequence', 1, 1, :'modele');
update public.card_placements set entered_step_at = now() - interval '90 days'
 where id = current_setting('tests.second')::uuid;

select pg_temp.endosser(:'admin');
select lives_ok(format('select public.armer_sequence_relance(%L, %L, %L)',
                       current_setting('tests.second'), :'sequence',
                       (select id from public.mail_outbound_identities where from_address = 'admin@p2enjoy.test')),
	'la cadence est armée sur le rattachement de « Grands comptes »');
select pg_temp.proprietaire();

update public.card_sequence_enrollments set armed_at = now() - interval '2 days'
 where placement_id = current_setting('tests.second')::uuid and status = 'active';
select app.executer_sequences_relance();
select is((select subject || ' | ' || split_part(body_text, ' / ', 1)
             from public.mail_outbox
            where card_id = :'c4' and created_by is null and body_text like '%Appeler le grand compte%'),
          'Grands comptes | Prospection',
	'le palier parti porte le channel et l''étape du rattachement INSCRIT, jamais ceux du plus ancien');

select * from finish();
rollback;
