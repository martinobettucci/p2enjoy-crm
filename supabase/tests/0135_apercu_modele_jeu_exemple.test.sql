-- @verifies CRM-125 (docs/BACKLOG.md) T2 — `public.render_mail_template_sample`, l'aperçu d'un modèle sur un jeu
--           d'exemple
-- @verifies docs/SPEC-modeles-emails.md §14.2 (forme, zéro ligne, privilèges), §14.3 (les douze valeurs du jeu),
--           §14.4 (l'identité de la personne : défaut, unique, plusieurs sans défaut, aucune ; jamais l'identité de
--           service ; `from_name` nul remplacé), §10.8 (la signature rendue telle quelle, variables comprises)
-- @verifies docs/SPEC-permissions-rls.md §7 (le refus est zéro ligne) ; CLAUDE.md §10 (règle prouvée hors interface)
--
-- La suite pose ses fixtures — un modèle, des identités de la lectrice `…013`, qui n'en a aucune au seed — et fait
-- `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

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

create or replace function pg_temp.apercu(modele uuid)
returns table (subject text, body_text text, signature_text text, identity_is_sample boolean)
language sql stable as $$
	select * from public.render_mail_template_sample(modele);
$$;

-- Une identité de fixture pour la lectrice, posée en propriétaire.
create or replace function pg_temp.identite(id uuid, adresse text, nom text, signature text, defaut boolean)
returns void language sql as $$
	insert into public.mail_outbound_identities (id, workspace_id, owner_id, label, smtp_host, smtp_port, smtp_security,
	                                             smtp_username, from_address, from_name, signature_text, is_default)
	values (id, '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000013', 'Fixture ' || adresse,
	        'smtp.fixture.example', 587, 'starttls', adresse, adresse, nom, signature, defaut);
$$;

insert into public.mail_templates (id, workspace_id, name, subject, body_text, created_by)
values ('c0000000-0000-4000-8000-0000000001a1', '5eed0000-0000-4000-8000-000000000001',
        'Douze variables — suite aperçu CRM-125',
        '[{{card.title}}]',
        '1={{card.title}} 2={{card.amount}} 3={{card.currency}} 4={{card.next_action}} ' ||
        '5={{card.next_action_at}} 6={{card.step}} 7={{card.channel}} 8={{contact.full_name}} ' ||
        '9={{contact.email}} 10={{contact.organization}} 11={{identity.from_name}} ' ||
        '12={{identity.from_address}}',
        '5eed0000-0000-4000-8000-000000000011');

-- =============================================================================================
-- 1. La forme — §14.2
-- =============================================================================================
select has_function('public', 'render_mail_template_sample', array['uuid'],
	'CRM-125 §14.2 — public.render_mail_template_sample(uuid) existe');
select is((select provolatile::text from pg_proc where oid = 'public.render_mail_template_sample(uuid)'::regprocedure),
	's', 'CRM-125 §14.2 — STABLE');
select is((select prosecdef from pg_proc where oid = 'public.render_mail_template_sample(uuid)'::regprocedure),
	false, 'CRM-125 §14.2 — SECURITY INVOKER : la RLS décide de tout');
select ok(not has_function_privilege('anon', 'public.render_mail_template_sample(uuid)', 'execute'),
	'CRM-125 §14.2 — anon n''exécute pas la fonction');
select ok(has_function_privilege('authenticated', 'public.render_mail_template_sample(uuid)', 'execute'),
	'CRM-125 §14.2 — authenticated exécute la fonction');

-- =============================================================================================
-- 2. Le jeu d'exemple et l'identité absente — §14.3, §14.4
-- =============================================================================================
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is((select subject from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	'[Projet exemple]', 'CRM-125 §14.3 — l''objet est substitué');
select is((select body_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	'1=Projet exemple 2=12500.00 3=EUR 4=Rappeler pour validation 5=15/01/2027 10:00 ' ||
	'6=Proposition envoyée 7=Prospection 8=M. Dupont 9=m.dupont@entreprise.example 10=ENTREPRISE INC ' ||
	'11=Votre nom 12=vous@entreprise.example',
	'CRM-125 §14.3 — les douze variables reçoivent leur valeur d''exemple, aucune ne reste vide');
select is((select identity_is_sample from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	true, 'CRM-125 §14.4 — sans identité, l''expéditeur est fictif et le dit');
select is((select signature_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	null, 'CRM-125 §14.4 — sans identité, aucune signature');

-- =============================================================================================
-- 3. L'unique identité, puis plusieurs sans défaut, puis le défaut — §14.4
-- =============================================================================================
select pg_temp.redevenir_proprietaire();
select pg_temp.identite('c0000000-0000-4000-8000-0000000001b1', 'lectrice-a@fixture.example', 'Lectrice A',
	'Lectrice A — {{contact.full_name}}', false);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is((select identity_is_sample from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	false, 'CRM-125 §14.4 — une unique identité, même sans défaut, est la sienne');
select ok((select body_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1'))
	like '%11=Lectrice A 12=lectrice-a@fixture.example',
	'CRM-125 §14.4 — identity.* vient de l''unique identité');
select is((select signature_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	'Lectrice A — {{contact.full_name}}',
	'CRM-125 §10.8 — la signature est rendue telle quelle : une variable n''y est pas substituée');

select pg_temp.redevenir_proprietaire();
select pg_temp.identite('c0000000-0000-4000-8000-0000000001b2', 'lectrice-b@fixture.example', null, null, false);
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is((select identity_is_sample from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	true, 'CRM-125 §14.4 — plusieurs identités sans défaut : aucune n''est choisie');
select ok((select body_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1'))
	like '%11=Votre nom 12=vous@entreprise.example',
	'CRM-125 §14.4 — plusieurs sans défaut : les valeurs d''exemple');

select pg_temp.redevenir_proprietaire();
update public.mail_outbound_identities set is_default = true where id = 'c0000000-0000-4000-8000-0000000001b2';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is((select identity_is_sample from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	false, 'CRM-125 §14.4 — le défaut de la personne est choisi');
select ok((select body_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1'))
	like '%12=lectrice-b@fixture.example',
	'CRM-125 §14.4 — identity.from_address vient du défaut, pas de l''autre identité');
select ok((select body_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1'))
	like '%11=Votre nom %',
	'CRM-125 §14.4 — un from_name nul reçoit la seule valeur d''exemple de ce champ');
select is((select signature_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	null, 'CRM-125 §14.4 — le défaut sans signature rend une signature nulle');

-- =============================================================================================
-- 4. L'identité de service n'est jamais prise — §14.4, décision 805
-- =============================================================================================
-- L'administratrice LIT l'identité de service ; elle ne doit pourtant jamais en devenir l'expéditeur.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is(
	(select count(*)::int from public.mail_outbound_identities i
	   join pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1') a on a.body_text like '%12=' || i.from_address
	  where i.owner_id is null),
	0, 'CRM-125 §14.4 — l''identité de service n''est jamais l''expéditeur de l''aperçu');

-- Driss a une identité au seed, avec sa signature : elle est la sienne.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is((select identity_is_sample from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	false, 'CRM-125 §14.4 — Driss voit sa propre identité du seed');
select ok((select signature_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')) like 'Driss Lemoine%',
	'CRM-125 §14.4 — et sa propre signature');

-- Les identités de la lectrice ne fuient chez personne d'autre.
select ok((select body_text from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')) not like '%lectrice-%',
	'CRM-125 §14.4 — l''identité d''une autre personne n''est jamais prise');

-- =============================================================================================
-- 5. Zéro ligne — §14.2, SPEC-permissions-rls §7
-- =============================================================================================
select is((select count(*)::int from pg_temp.apercu('c0000000-0000-4000-8000-00000000ffff')),
	0, 'CRM-125 §14.2 — un modèle inconnu rend zéro ligne, jamais une erreur');
select is((select count(*)::int from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	1, 'CRM-125 §14.2 — un modèle lisible rend exactement une ligne');

-- Un utilisateur qui n'est membre d'aucun espace ne lit pas le modèle : zéro ligne, indiscernable de l'inconnu.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000014');
select is((select count(*)::int from pg_temp.apercu('c0000000-0000-4000-8000-0000000001a1')),
	0, 'CRM-125 §14.2 — un modèle illisible rend zéro ligne');

select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.mail_templates where name not like '%suite aperçu CRM-125'
	and workspace_id = '5eed0000-0000-4000-8000-000000000001'),
	(select count(*)::int from public.mail_templates where workspace_id = '5eed0000-0000-4000-8000-000000000001') - 1,
	'CRM-125 — la fonction n''écrit rien : seule la fixture s''ajoute aux modèles');

select * from finish();
rollback;
