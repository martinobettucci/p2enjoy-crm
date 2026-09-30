-- @verifies CRM-096 (docs/BACKLOG.md) — tranche T1 : la table du registre des migrations
-- @verifies docs/SCHEMA.md §8 (`app.migrations_appliquees` : colonnes, contraintes, fermeture à l'API) ;
--           docs/DAT.md §3.2 bis ; docs/JOURNAL.md décision 616
--
-- Ce fichier tient la FORME du registre et sa FERMETURE : aucun rôle de l'API ne le lit ni ne l'écrit,
-- et une ligne mal formée — un chemin au lieu d'un nom, une empreinte qui n'est pas un SHA-256, un mode
-- inconnu — est refusée par la base elle-même, quel que soit l'écrivain. Le comportement du runner est
-- éprouvé ailleurs (`scripts/verify-scripts.sh`, tranche T2). Tout se joue dans une transaction annulée.

begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

-- Une empreinte bien formée, et une autre : 64 chiffres hexadécimaux en minuscules.
create temporary table empreintes (nom text primary key, valeur text not null) on commit drop;
insert into empreintes values
	('A', repeat('a1', 32)),
	('B', repeat('0f', 32));
grant select on empreintes to authenticated, service_role, anon;

-- 1 à 8 — la forme.
select has_table('app', 'migrations_appliquees', '1 — la table du registre existe dans le schéma app');
select columns_are('app', 'migrations_appliquees', array['fichier', 'empreinte', 'mode', 'inscrite_le'],
	'2 — quatre colonnes, et seulement elles');
select col_is_pk('app', 'migrations_appliquees', 'fichier', '3 — le nom du fichier est la clé');
select col_type_is('app', 'migrations_appliquees', 'empreinte', 'text', '4 — l''empreinte est un texte');
select col_not_null('app', 'migrations_appliquees', 'empreinte', '5 — l''empreinte est exigée');
select col_not_null('app', 'migrations_appliquees', 'mode', '6 — le mode est exigé');
select col_type_is('app', 'migrations_appliquees', 'inscrite_le', 'timestamp with time zone',
	'7 — la date d''inscription est un timestamptz');
select col_default_is('app', 'migrations_appliquees', 'inscrite_le', 'now()',
	'8 — la date d''inscription vaut now() par défaut');

-- 9 à 12 — la fermeture : RLS sans politique, aucun privilège pour les rôles de l'API.
select is(
	(select relrowsecurity from pg_class where oid = 'app.migrations_appliquees'::regclass),
	true,
	'9 — RLS est activée');
select is(
	(select count(*)::int from pg_policies where schemaname = 'app' and tablename = 'migrations_appliquees'),
	0,
	'10 — aucune politique : rien n''est ouvert, même par erreur');
select table_privs_are('app', 'migrations_appliquees', 'authenticated', array[]::text[],
	'11 — authenticated n''a aucun privilège');
select ok(
	not has_table_privilege('anon', 'app.migrations_appliquees', 'select')
	and not has_table_privilege('service_role', 'app.migrations_appliquees', 'select')
	and not has_table_privilege('service_role', 'app.migrations_appliquees', 'insert'),
	'12 — ni anon ni service_role ne lisent ni n''écrivent');

-- 13 à 17 — les contraintes, éprouvées par le propriétaire : la base refuse une ligne mal formée
-- quel que soit l'écrivain.
select lives_ok(
	$$insert into app.migrations_appliquees (fichier, empreinte, mode)
	  values ('9990_sonde_registre.sql', (select valeur from empreintes where nom = 'A'), 'application')$$,
	'13 — une ligne bien formée est inscrite');
select throws_ok(
	$$insert into app.migrations_appliquees (fichier, empreinte, mode)
	  values ('../9991_sonde.sql', (select valeur from empreintes where nom = 'A'), 'application')$$,
	'23514', null,
	'14 — un chemin n''est pas un nom de fichier');
select throws_ok(
	$$insert into app.migrations_appliquees (fichier, empreinte, mode)
	  values ('9992_sonde.sql', upper((select valeur from empreintes where nom = 'A')), 'application')$$,
	'23514', null,
	'15 — une empreinte en majuscules n''est pas celle que sha256sum écrit');
select throws_ok(
	$$insert into app.migrations_appliquees (fichier, empreinte, mode)
	  values ('9993_sonde.sql', left((select valeur from empreintes where nom = 'A'), 40), 'application')$$,
	'23514', null,
	'16 — une empreinte de 40 caractères n''est pas un SHA-256');
select throws_ok(
	$$insert into app.migrations_appliquees (fichier, empreinte, mode)
	  values ('9994_sonde.sql', (select valeur from empreintes where nom = 'A'), 'manuel')$$,
	'23514', null,
	'17 — un mode inconnu est refusé');

-- 18 — un fichier ne s'inscrit qu'une fois.
select throws_ok(
	$$insert into app.migrations_appliquees (fichier, empreinte, mode)
	  values ('9990_sonde_registre.sql', (select valeur from empreintes where nom = 'B'), 'adoption')$$,
	'23505', null,
	'18 — un fichier déjà inscrit ne l''est pas une seconde fois');

-- 19 à 22 — les refus, sous les rôles réels de l'API.
set local role authenticated;
select throws_ok(
	$$select count(*) from app.migrations_appliquees$$,
	'42501', null,
	'19 — authenticated ne lit pas le registre');
select throws_ok(
	$$insert into app.migrations_appliquees (fichier, empreinte, mode)
	  values ('9995_sonde.sql', (select valeur from empreintes where nom = 'A'), 'application')$$,
	'42501', null,
	'20 — authenticated n''inscrit rien');
reset role;

set local role service_role;
select throws_ok(
	$$delete from app.migrations_appliquees$$,
	'42501', null,
	'21 — service_role n''efface pas le registre');
reset role;

select is(
	(select count(*)::int from app.migrations_appliquees where fichier like '999%'),
	1,
	'22 — seule la ligne bien formée du propriétaire a été écrite');

select * from finish();
rollback;
