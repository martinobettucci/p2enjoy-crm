-- @verifies CRM-149 (docs/BACKLOG.md) — tranche T1 : les prompts du connecteur — la table et ses contraintes, les cinq
--           défauts pour l'espace du seed et pour un espace créé, la RLS sous les trois profils du seed (lecture par tout
--           membre ; écriture, modification et suppression par l'administrateur seul), l'espace non modifiable, l'auteur
--           posé par la base
-- @verifies docs/SPEC-mcp.md §17.2 à §17.4 ; docs/SCHEMA.md « Migration de `CRM-149` » ; docs/JOURNAL.md décision 930 ;
--           CLAUDE.md §10 (la règle prouvée par la base, sous les vrais rôles)
--
-- LA SONDE, posée sous la clé de propriétaire et défaite par le `rollback` final : un second espace, dont aucun profil du
-- seed n'est membre.

begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- Le nombre de lignes qu'une écriture a réellement touchées, sous le rôle courant.
create or replace function pg_temp.touchees(p_sql text) returns integer language plpgsql as $$
declare
	v integer;
begin
	execute p_sql;
	get diagnostics v = row_count;
	return v;
end;
$$;

\set espace '5eed0000-0000-4000-8000-000000000001'
\set admin '5eed0000-0000-4000-8000-000000000011'
\set driss '5eed0000-0000-4000-8000-000000000012'
\set lectrice '5eed0000-0000-4000-8000-000000000013'
\set autre '01730000-0000-4000-8000-0000000000e1'

-- 1–3. La table et les défauts.
select has_table('public', 'mcp_prompts', '1 — la table des prompts existe');
select set_has(
	$$select key from public.mcp_prompts where workspace_id = '5eed0000-0000-4000-8000-000000000001'$$,
	$$values ('creer-une-affaire'), ('faire-le-point'), ('faire-avancer'), ('retrouver-une-affaire'),
	         ('enregistrer-une-recette-reelle')$$,
	'2 — les cinq défauts de l''espace du seed sont présents');

insert into public.workspaces (id, name, slug) values (:'autre', 'Sonde 0173', 'sonde-0173');
select is((select count(*)::int from public.mcp_prompts where workspace_id = :'autre'), 5,
	'3 — un espace créé reçoit ses cinq défauts');

-- 4–5. Le texte est celui de la spécification : de vraies fins de ligne, aucun « \n » littéral.
select ok(
	(select position(E'\n2. Avant toute création' in body) > 0 and position('\n' in body) = 0
	   from public.mcp_prompts where workspace_id = :'autre' and key = 'creer-une-affaire'),
	'4 — le texte d''un défaut porte de vraies fins de ligne');
select is(
	(select title from public.mcp_prompts where workspace_id = :'autre' and key = 'enregistrer-une-recette-reelle'),
	'Enregistrer une recette réelle',
	'5 — le titre d''un défaut est celui du §17.4');

-- 6–9. Les contraintes.
select throws_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values (%L, 'Pas-Bon', 'T', 'D', 'B')$$, :'autre'), '23514', null, '6 — un identifiant hors forme est refusé');
select throws_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values (%L, 'faire-le-point', 'T', 'D', 'B')$$, :'autre'), '23505', null, '7 — l''identifiant est unique dans l''espace');
select throws_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values (%L, 'titre-blanc', ' T ', 'D', 'B')$$, :'autre'), '23514', null, '8 — un titre non resserré est refusé');
select throws_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values (%L, 'texte-vide', 'T', 'D', E' \n ')$$, :'autre'), '23514', null, '9 — un texte vide est refusé');

-- 10. L'anonyme ne lit rien.
set local role anon;
select is((select count(*)::int from public.mcp_prompts), 0, '10 — l''anonyme ne lit aucun prompt');
reset role;

-- 11–15. La lectrice : elle lit ceux de son espace, rien d'un autre ; elle n'écrit rien.
select pg_temp.endosser(:'lectrice');
select is((select count(*)::int from public.mcp_prompts where workspace_id = :'espace'), 5,
	'11 — la lectrice lit les prompts de son espace');
select is((select count(*)::int from public.mcp_prompts where workspace_id = :'autre'), 0,
	'12 — elle ne lit rien d''un espace dont elle n''est pas membre');
select throws_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values (%L, 'de-la-lectrice', 'T', 'D', 'B')$$, :'espace'), '42501', null, '13 — la lectrice ne peut pas ajouter');
select is(pg_temp.touchees(format($$update public.mcp_prompts set title = 'Changé' where workspace_id = %L$$, :'espace')), 0,
	'14 — sa modification ne touche aucune ligne');
select is(pg_temp.touchees(format($$delete from public.mcp_prompts where workspace_id = %L$$, :'espace')), 0,
	'15 — sa suppression ne touche aucune ligne');
reset role;

-- 16–18. Le business developer : il lit, il n'écrit rien non plus.
select pg_temp.endosser(:'driss');
select throws_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values (%L, 'du-business-developer', 'T', 'D', 'B')$$, :'espace'), '42501', null, '16 — le business developer ne peut pas ajouter');
select is(pg_temp.touchees(format($$update public.mcp_prompts set title = 'Changé' where workspace_id = %L$$, :'espace')), 0,
	'17 — sa modification ne touche aucune ligne');
select is(pg_temp.touchees(format($$delete from public.mcp_prompts where workspace_id = %L$$, :'espace')), 0,
	'18 — sa suppression ne touche aucune ligne');
reset role;

-- 19–26. L'administratrice : elle ajoute, modifie et supprime dans son espace, jamais ailleurs.
select pg_temp.endosser(:'admin');
select lives_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values (%L, 'sonde-0173', 'Sonde', 'Une sonde.', 'Texte de la sonde.')$$, :'espace'), '19 — l''administratrice ajoute un prompt');
select is((select created_by from public.mcp_prompts where workspace_id = :'espace' and key = 'sonde-0173'), :'admin'::uuid,
	'20 — son auteur est posé par la base');
select is(pg_temp.touchees(format($$update public.mcp_prompts set title = 'Sonde modifiée'
	where workspace_id = %L and key = 'sonde-0173'$$, :'espace')), 1, '21 — elle le modifie');
select is((select updated_by from public.mcp_prompts where workspace_id = :'espace' and key = 'sonde-0173'), :'admin'::uuid,
	'22 — le dernier modificateur est posé par la base');
select throws_ok(format($$update public.mcp_prompts set workspace_id = %L where key = 'sonde-0173'$$, :'autre'),
	'42501', null, '23 — l''espace d''un prompt ne se change pas');
select throws_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body, created_by)
	values (%L, 'auteur-force', 'T', 'D', 'B', %L)$$, :'espace', :'driss'), '42501', null, '24 — l''auteur ne s''écrit pas');
select throws_ok(format($$insert into public.mcp_prompts (workspace_id, key, title, description, body)
	values (%L, 'ailleurs', 'T', 'D', 'B')$$, :'autre'), '42501', null, '25 — elle n''ajoute rien dans un autre espace');
select is(pg_temp.touchees(format($$delete from public.mcp_prompts where workspace_id = %L and key = 'sonde-0173'$$, :'espace')), 1,
	'26 — elle le supprime');
reset role;

select * from finish();
rollback;
