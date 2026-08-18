-- @verifies CRM-060 tranche 3 (docs/BACKLOG.md) — résolution des champs `contact` et `user`
-- @verifies docs/SPEC-contacts.md §9 (la règle, la portée, les cas a à j du §9.5, la limite §9.4)
-- @verifies docs/SPEC-form-composer.md §6.4 (le trigger), §6.5 (ce que chaque type accepte)
-- @verifies docs/JOURNAL.md décision 295 (l'arbitrage), INC-053 (close)
-- @verifies CLAUDE.md §10 (une règle d'appartenance se prouve hors interface), §15
--
-- CE QUE CETTE SUITE PROUVE.
--
-- 1. Un champ `contact` n'accepte qu'un contact EXISTANT du workspace de la valeur : un identifiant
--    bien formé mais inexistant est refusé, et un contact d'un AUTRE workspace aussi — c'est le
--    cloisonnement, raison d'être de la règle.
-- 2. Un champ `user` n'accepte qu'un MEMBRE du workspace : un profil qui existe mais n'est pas
--    membre est refusé. C'est la règle d'appartenance que la décision 295 énonce, et que nul
--    document n'énonçait avant elle.
-- 3. Les refus de FORME sont inchangés : une chaîne qui n'est pas un uuid, un nombre, un booléen.
-- 4. « Vidé explicitement » reste accepté pour les deux types : la sortie anticipée du §6.6 précède
--    le `case`, et vider un champ `contact` ne doit pas exiger un contact.
-- 5. LA LIMITE EST PROUVÉE, PAS SEULEMENT ÉCRITE (§9.4) : supprimer le contact d'une valeur déjà
--    posée LAISSE la valeur en place. `value` est un `jsonb`, aucune clé étrangère n'y est
--    possible ; la tranche supprime la création d'une référence morte, pas la possibilité qu'une
--    référence meure ensuite. Une suite qui tairait ce point laisserait croire à une intégrité
--    référentielle qui n'existe pas.
-- 6. Le refus porte toujours le jeton stable `invalid_field_value`, comparable par égalité.
--
-- La suite s'exécute en transaction et fait `rollback` ; chaque cas mutant est isolé par un
-- savepoint. Le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- Constantes du seed, mesurées le 2026-08-18 (docs/SPEC-contacts.md §9.5).
--   WS   = 5eed…0001  : le workspace P2Enjoy SAS
--   WF   = 5eed…0051  : le workflow source
--   C1   = 5eed…00c1  : la card « Refonte du site vitrine »
--   LEO  = 5eed…0091  : le contact Léo Marchand
--   BIZ  = 5eed…0012  : Driss Lemoine, business developer, MEMBRE du workspace

-- Deux champs sondes, un par type. Ils sont créés dans la transaction : la suite ne dépend donc
-- pas des champs que le seed pose, et elle prouve la règle même si le seed venait à changer.
insert into public.form_fields (id, workflow_id, workspace_id, key, label, type, options, position)
values ('a5000000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000051',
        '5eed0000-0000-4000-8000-000000000001', 'sonde-contact-0045', 'Sonde contact', 'contact',
        '{}', 900),
       ('a5000000-0000-4000-8000-000000000002', '5eed0000-0000-4000-8000-000000000051',
        '5eed0000-0000-4000-8000-000000000001', 'sonde-user-0045', 'Sonde user', 'user',
        '{}', 901);

-- Le geste éprouvé, écrit une fois : poser une valeur sur la card `c1`. L'`upsert` reproduit ce
-- que fait le produit (docs/SPEC-form-composer.md §4 bis) plutôt qu'un `insert` que le second
-- passage ferait échouer pour une raison étrangère à la règle.
create or replace function pg_temp.poser(champ uuid, v jsonb) returns void
language sql as $$
	insert into public.card_field_values (card_id, field_id, workflow_id, workspace_id, value)
	values ('5eed0000-0000-4000-8000-0000000000c1', champ,
	        '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001', v)
	on conflict (card_id, field_id) do update set value = excluded.value;
$$;

-- =============================================================================================
-- 1. Le champ `contact` — cas a à f du §9.5
-- =============================================================================================

select lives_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000001',
	                        '"5eed0000-0000-4000-8000-000000000091"'::jsonb) $$,
	'1 — CAS a : un contact EXISTANT du workspace est accepté (Léo Marchand)');

select throws_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000001',
	                        '"00000000-0000-4000-8000-000000000000"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'2 — CAS b : un uuid bien formé ne désignant AUCUN contact est refusé. C''est le défaut que '
	'la décision 295 nomme « dette de données impossible à distinguer d''une référence valide », '
	'et qui était ACCEPTÉ avant la migration 0047');

-- Le DETAIL nomme la clé du champ et la raison, comme tous les refus du §6.5. Un jeton stable
-- sans DETAIL exploitable obligerait l'interface à deviner ce qui a été refusé.
select throws_like(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000001',
	                        '"00000000-0000-4000-8000-000000000000"'::jsonb) $$,
	'%invalid_field_value%',
	'3 — le refus porte le jeton stable `invalid_field_value`, comparable par égalité');

select throws_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000001', '"martin"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'4 — CAS d : une chaîne qui n''est pas un uuid reste refusée (forme, inchangé)');

select throws_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000001', '42'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'5 — CAS f : un nombre reste refusé (forme, inchangé)');

select throws_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000001', 'true'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'6 — un booléen est refusé : la forme est éprouvée dans les deux sens, pas seulement sur le '
	'cas qui arrange');

select lives_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000001', 'null'::jsonb) $$,
	'7 — CAS e : « vidé explicitement » reste accepté. La sortie anticipée du §6.6 précède le '
	'`case` : vider un champ `contact` ne doit pas exiger un contact (décision 133)');

select lives_ok(
	$$ insert into public.card_field_values
	          (card_id, field_id, workflow_id, workspace_id, value)
	   values ('5eed0000-0000-4000-8000-0000000000c3', 'a5000000-0000-4000-8000-000000000001',
	           '5eed0000-0000-4000-8000-000000000051', '5eed0000-0000-4000-8000-000000000001',
	           null)
	   on conflict (card_id, field_id) do update set value = excluded.value $$,
	'8 — le SQL NULL, seule forme de vide que PostgREST sache produire, est accepté lui aussi');

-- =============================================================================================
-- 2. Le champ `user` — cas g à i du §9.5
-- =============================================================================================

select lives_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000002',
	                        '"5eed0000-0000-4000-8000-000000000012"'::jsonb) $$,
	'9 — CAS g : un MEMBRE du workspace est accepté (Driss Lemoine, business developer)');

select lives_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000002',
	                        '"5eed0000-0000-4000-8000-000000000013"'::jsonb) $$,
	'10 — un membre `viewer` est accepté lui aussi : la règle est l''APPARTENANCE, pas le rôle. '
	'Un lecteur peut être le responsable désigné d''une affaire sans pouvoir l''écrire');

select throws_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000002',
	                        '"00000000-0000-4000-8000-000000000000"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'11 — CAS i : un uuid bien formé ne désignant aucun profil est refusé');

select throws_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000002', '"driss"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'12 — une chaîne qui n''est pas un uuid reste refusée (forme, inchangé)');

select lives_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000002', 'null'::jsonb) $$,
	'13 — « vidé explicitement » est accepté pour `user` aussi : les deux types partagent la '
	'sortie anticipée du §6.6');

-- --- CAS h : un profil qui EXISTE mais n'est PAS membre du workspace --------------------------
-- MESURÉ le 2026-08-18 : insérer dans `auth.users` crée le profil par le trigger
-- `app.handle_new_user()`. C'est le SEUL chemin — `public.profiles.id` référence `auth.users(id)`,
-- et une insertion directe est refusée en 23503. La suite emprunte donc le vrai mécanisme
-- d'inscription plutôt que de fabriquer une trace (CLAUDE.md §8).
savepoint profil_etranger;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('a5000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'etranger-0045@p2enjoy.test', 'x',
        now(), now(), now());

select is(
	(select count(*)::int from public.profiles
	  where id = 'a5000000-0000-4000-8000-0000000000e1'::uuid),
	1,
	'14 — témoin du cas h : le profil étranger EXISTE bien. Sans ce témoin, le refus qui suit '
	'serait vert sur un profil absent, et ne prouverait rien de l''appartenance');

select is(
	(select count(*)::int from public.workspace_members
	  where user_id = 'a5000000-0000-4000-8000-0000000000e1'::uuid
	    and workspace_id = '5eed0000-0000-4000-8000-000000000001'::uuid),
	0,
	'15 — et il n''est PAS membre du workspace : les deux moitiés du cas h sont établies');

select throws_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000002',
	                        '"a5000000-0000-4000-8000-0000000000e1"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'16 — CAS h : un profil EXISTANT mais NON MEMBRE du workspace est refusé. C''est exactement '
	'la règle d''appartenance de la décision 295, et c''est elle qui manquait à INC-053');

rollback to profil_etranger;

-- =============================================================================================
-- 3. Le cloisonnement — cas c du §9.5
-- =============================================================================================
-- Un contact d'un AUTRE workspace ne se pose pas sur une valeur de celui-ci. Le second workspace
-- est créé dans la transaction, comme le fait `0043` pour les clés composites.

savepoint autre_workspace;

insert into public.workspaces (id, name, slug)
values ('a5000000-0000-4000-8000-0000000000b1', 'Workspace B 0045', 'workspace-b-0045');

insert into public.contacts (id, workspace_id, full_name)
values ('a5000000-0000-4000-8000-0000000000b2', 'a5000000-0000-4000-8000-0000000000b1',
        'Contact du workspace B');

select is(
	(select count(*)::int from public.contacts
	  where id = 'a5000000-0000-4000-8000-0000000000b2'::uuid),
	1,
	'17 — témoin du cas c : le contact étranger EXISTE. Le refus qui suit porte donc sur son '
	'WORKSPACE, non sur son absence');

select throws_ok(
	$$ select pg_temp.poser('a5000000-0000-4000-8000-000000000001',
	                        '"a5000000-0000-4000-8000-0000000000b2"'::jsonb) $$,
	'P0001', 'invalid_field_value',
	'18 — CAS c : un contact d''un AUTRE workspace est refusé. Le cloisonnement est la raison '
	'd''être de la règle : sans lui, la résolution ne ferait qu''exiger une existence quelconque');

rollback to autre_workspace;

-- =============================================================================================
-- 4. La limite du §9.4, PROUVÉE et non seulement écrite
-- =============================================================================================
-- Une valeur acceptée survit à la suppression de son contact. Ce n'est pas un défaut caché : c'est
-- la propriété du `jsonb`, où aucune clé étrangère n'est possible (INC-033), et la vérification a
-- lieu à l'ÉCRITURE. L'écrire dans la spécification sans l'éprouver laisserait un lecteur croire à
-- une intégrité référentielle que le produit ne tient pas.

-- Ce dernier bloc n'est PAS enfermé dans un savepoint, à la différence des trois précédents, et
-- c'est une nécessité MESURÉE de pgTAP : un `rollback to savepoint` annule l'avancement du
-- compteur de tests, si bien qu'une suite dont la dernière assertion vit dans un savepoint annulé
-- rend « planned 19 tests but ran 13 » alors que les dix-neuf sont vertes. Les blocs précédents
-- ont besoin de leur savepoint pour ne pas polluer ceux qui les suivent ; celui-ci n'a rien
-- derrière lui, et le `rollback` final de la transaction rend le seed intact de toute façon.

insert into public.contacts (id, workspace_id, full_name)
values ('a5000000-0000-4000-8000-0000000000c9', '5eed0000-0000-4000-8000-000000000001',
        'Contact éphémère 0045');

select pg_temp.poser('a5000000-0000-4000-8000-000000000001',
                     '"a5000000-0000-4000-8000-0000000000c9"'::jsonb);

delete from public.contacts where id = 'a5000000-0000-4000-8000-0000000000c9'::uuid;

select is(
	(select value #>> '{}' from public.card_field_values
	  where card_id  = '5eed0000-0000-4000-8000-0000000000c1'::uuid
	    and field_id = 'a5000000-0000-4000-8000-000000000001'::uuid),
	'a5000000-0000-4000-8000-0000000000c9',
	'19 — CAS j, LIMITE NOMMÉE (§9.4) : supprimer le contact LAISSE la valeur en place. La '
	'tranche 3 supprime la création d''une référence morte, pas la possibilité qu''une référence '
	'meure ensuite — arbitrage nommé au §6 point 4 de docs/SPEC-contacts.md');

select * from finish();
rollback;
