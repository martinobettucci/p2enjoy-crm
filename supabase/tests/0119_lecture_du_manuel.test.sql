-- @verifies CRM-117 (docs/BACKLOG.md) — tranche T2 : le manuel lu par les seuls membres connectés, migrations 126 et 127
-- @verifies docs/SPEC-manual.md §14.1 (le bucket privé, une seule politique, de lecture, bornée au bucket) et §16 (preuve
--           de base) ; docs/SCHEMA.md §9 septies ; docs/SPEC-permissions-rls.md §5 (Storage)
--
-- Ce que cette suite prouve, et pourquoi chaque preuve est là.
--   1. Le bucket `manual` existe et est PRIVÉ : un bucket public servirait ses objets sans session, politique ou non.
--   2. Une seule politique nomme ce bucket, en LECTURE, pour `authenticated`. `storage.objects` accorde tous les
--      privilèges à `anon` et `authenticated` (migration 29) : c'est l'absence de politique qui refuse, et une seconde
--      politique — une écriture, ou une lecture pour `anon` — ouvrirait ce que la règle ferme.
--   3. Sous les vrais rôles : une session lit un objet du bucket ; une session ne lit pas un objet d'un autre bucket par
--      cette politique ; `anon` ne lit rien ; une session n'écrit pas.
--
-- Exécution : `npm run test:sql -- supabase/tests/0119_lecture_du_manuel.test.sql`. Tout se joue dans une transaction
-- annulée : les objets posés ici ne survivent pas.

begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

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

-- Un chapitre du manuel, posé comme la publication le pose : par le propriétaire, sans `owner`.
insert into storage.objects (bucket_id, name, metadata) values
	('manual', 'chapters/sonde-0118.json', '{"size": 2, "mimetype": "application/json"}');

-- =============================================================================================
-- 1. Le bucket
-- =============================================================================================

select is((select count(*)::int from storage.buckets where id = 'manual'), 1, '1 — le bucket `manual` existe');
select is((select public from storage.buckets where id = 'manual'), false,
	'2 — il est PRIVÉ : rien ne s''y lit sans politique, et une seule politique l''ouvre');

-- =============================================================================================
-- 2. Une seule politique, de lecture, pour `authenticated`, bornée au bucket
-- =============================================================================================

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'storage' and tablename = 'objects'
	    and (coalesce(qual, '') || coalesce(with_check, '')) like '%''manual''%'),
	1,
	'3 — EXACTEMENT une politique d''objet nomme le bucket du manuel'
);
select is(
	(select cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'manual_select'),
	'SELECT',
	'4 — elle est de LECTURE : seule la clé de service publie'
);
select is(
	(select roles::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'manual_select'),
	'{authenticated}',
	'5 — elle est pour `authenticated` seul : sans session, aucune politique ne s''applique'
);
select ok(
	(select qual from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'manual_select')
		like '%bucket_id = ''manual''%',
	'6 — elle est bornée au bucket du manuel, jamais au stockage entier'
);

-- =============================================================================================
-- 3. Sous les vrais rôles
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');  -- la lectrice : une session suffit
select is(
	(select count(*)::int from storage.objects where bucket_id = 'manual' and name = 'chapters/sonde-0118.json'),
	1,
	'7 — une session lit un chapitre du manuel, quel que soit son rôle'
);
select throws_ok(
	$$insert into storage.objects (bucket_id, name) values ('manual', 'chapters/forge.json')$$,
	'42501',
	null,
	'8 — une session ne dépose rien dans le bucket du manuel'
);
select pg_temp.redevenir_proprietaire();

-- Une session ne remplace pas un chapitre : sans politique de mise à jour, la mise à jour ne voit aucune ligne. (Le
-- retrait n'est pas exerçable ici : `storage.protect_delete()` refuse toute suppression directe, à tous, et seule l'API
-- de stockage retire — sous la même règle d'absence de politique, prouvée par requête directe, `e2e/api/manuel.spec.ts`.)
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');  -- l'administratrice
with remplace as (
	update storage.objects set metadata = '{"size": 0}' where bucket_id = 'manual' and name = 'chapters/sonde-0118.json'
	returning 1
)
select is((select count(*)::int from remplace), 0, '9 — même l''administratrice d''un espace ne remplace rien du manuel');
select pg_temp.redevenir_proprietaire();

set local role anon;
select is(
	(select count(*)::int from storage.objects where bucket_id = 'manual'),
	0,
	'10 — sans session, aucun objet du manuel ne se lit'
);
reset role;

select * from finish();

rollback;
