-- @verifies CRM-165 (docs/BACKLOG.md) — tranche T1 : les consignes de la plateforme, en base — une ligne fermée aux clients ;
--           le super-administrateur seul lit et écrit ; la normalisation, la borne de 4 000 caractères ; une écriture
--           identique sans ligne de journal ; le geste au journal sans le texte ; le service seul lit le texte et publie le
--           socle
-- @verifies docs/SPEC-mcp.md §18.2, §18.3 ; docs/SCHEMA.md « Migration `0200` » ; CLAUDE.md §10
--
-- Tout vit dans une transaction annulée. Sabine (…018) est la super-administratrice du seed ; Camille (…011) administre un
-- espace sans être super-administratrice ; Farida (…013) est lectrice.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated', 'iss', 'p2enjoy-crm/session')::text, true);
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

-- L'état de départ de la preuve : un texte vide, jamais écrit.
update public.connector_instructions set body = '', updated_at = null, updated_by = null;
create temporary table pg_temp.journal_avant as select coalesce(max(id), 0) as id from public.plateforme_journal;
grant select on pg_temp.journal_avant to authenticated;

-- 1. La forme.
select is((select count(*)::integer from public.connector_instructions), 1, '1 — une ligne unique');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.connector_instructions'::regclass)
          and not exists (select 1 from pg_catalog.pg_policies where tablename = 'connector_instructions'),
	'2 — RLS activée, aucune politique');
select ok(not has_table_privilege('authenticated', 'public.connector_instructions', 'select')
          and not has_table_privilege('anon', 'public.connector_instructions', 'select')
          and not has_table_privilege('authenticated', 'public.connector_instructions', 'update'),
	'3 — aucun privilège client sur la table');
select ok(not has_function_privilege('authenticated', 'public.connector_instructions_text()', 'execute')
          and not has_function_privilege('authenticated', 'public.connector_instructions_publish_base(text)', 'execute')
          and has_function_privilege('service_role', 'public.connector_instructions_text()', 'execute')
          and has_function_privilege('service_role', 'public.connector_instructions_publish_base(text)', 'execute'),
	'4 — lire le texte et publier le socle : la clé de service seule');
select ok(not has_function_privilege('anon', 'public.platform_set_connector_instructions(text)', 'execute')
          and not has_function_privilege('anon', 'public.platform_connector_instructions()', 'execute'),
	'5 — l''anonyme n''atteint aucune des deux fonctions de la plateforme');

-- 2. La garde : l'administratrice d'espace et la lectrice sont refusées, rien n'est écrit.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok($$select public.platform_set_connector_instructions('Pirate')$$, '42501', null,
	'6 — une administratrice d''espace n''écrit pas les consignes');
select throws_ok($$select * from public.platform_connector_instructions()$$, '42501', null,
	'7 — …ni ne les lit');
select pg_temp.redevenir_proprietaire();
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok($$select public.platform_set_connector_instructions('Pirate')$$, '42501', null,
	'8 — la lectrice non plus');
select pg_temp.redevenir_proprietaire();
select is((select body from public.connector_instructions), '', '9 — rien n''a été écrit');

-- 3. Le super-administrateur écrit : la normalisation, l'auteur, le journal.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000018');
select lives_ok($$select public.platform_set_connector_instructions(E'  \r\nCherchez avant de créer.\r\nDonnez la devise.  \n\n')$$,
	'10 — le super-administrateur écrit');
select is((select body from public.platform_connector_instructions()), E'Cherchez avant de créer.\nDonnez la devise.',
	'11 — normalisé : CRLF devenus LF, blancs des bords retirés');
select is((select updated_by_name from public.platform_connector_instructions()), 'Sabine Plateforme',
	'12 — l''auteur est nommé');
select pg_temp.redevenir_proprietaire();
select is((select geste || '|' || (cible ->> 'length_before') || '|' || (cible ->> 'length_after')
             from public.plateforme_journal where id > (select id from pg_temp.journal_avant) order by id desc limit 1),
	'connector_instructions_set|0|42', '13 — une ligne au journal : le geste et les longueurs');
select ok(not exists (select 1 from public.plateforme_journal where id > (select id from pg_temp.journal_avant)
                       and cible::text like '%Cherchez%'),
	'14 — le journal ne recopie jamais le texte');

-- 4. Identique : rien n'est écrit ; trop long : refusé ; vide : permis.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000018');
select public.platform_set_connector_instructions(E'Cherchez avant de créer.\nDonnez la devise.\n');
select pg_temp.redevenir_proprietaire();
select is((select count(*)::integer from public.plateforme_journal where id > (select id from pg_temp.journal_avant)), 1,
	'15 — une écriture identique (après normalisation) ne laisse aucune ligne de plus');
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000018');
select throws_ok(format('select public.platform_set_connector_instructions(%L)', repeat('a', 4001)), '22023',
	'connector_instructions_too_long', '16 — plus de 4 000 caractères : refusé');
select lives_ok(format('select public.platform_set_connector_instructions(%L)', '  ' || repeat('é', 4000) || '  '),
	'17 — 4 000 caractères exactement, une fois les bords retirés : permis');
select throws_ok($$select public.platform_set_connector_instructions(null)$$, '22023', 'connector_instructions_invalid',
	'18 — un texte nul : refusé');
select lives_ok($$select public.platform_set_connector_instructions(E' \n\t ')$$, '19 — des blancs seuls : le texte devient vide');
select is((select body from public.platform_connector_instructions()), '', '20 — …et il est vide');
select pg_temp.redevenir_proprietaire();

-- 5. Le service lit le texte et publie le socle.
set local role service_role;
select is(public.connector_instructions_text(), '', '21 — le service lit le texte');
select public.connector_instructions_publish_base('Socle de la preuve');
reset role;
select ok((select base = 'Socle de la preuve' and base_published_at = now() from public.connector_instructions),
	'22 — le service publie le socle, daté');

select * from finish();
rollback;
