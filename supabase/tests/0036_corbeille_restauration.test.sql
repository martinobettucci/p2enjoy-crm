-- @verifies CRM-077 (docs/BACKLOG.md) — corbeille et restauration, deuxième tranche : la garde
-- @verifies docs/SPEC-corbeille.md §3.4 (la restauration refuse plutôt que de deviner),
--            §3.3 (la mise en corbeille d'un parent ne descend pas)
-- @verifies CLAUDE.md §10 (une règle d'accès ou de cohérence se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE.
--
-- Que le refus est DANS LA BASE et non dans l'écran : il tombe sur un `update` direct, avec le rôle
-- `authenticated`, sans qu'aucune interface ne soit impliquée. C'est la seule façon de savoir qu'il
-- tiendra aussi pour un appel d'API, un script, ou une intégration.
--
-- ET CE QU'ELLE PROUVE AUSSI, ce qui compte autant : que la garde NE se déclenche PAS quand elle ne
-- doit pas. Une garde qui refuserait trop serait aussi fautive qu'une garde absente, et c'est
-- l'erreur la plus facile à commettre en écrivant un trigger sur `update`.
--
-- La suite crée ses propres fixtures par la clé de service, joue les refus avec un rôle réel, et
-- fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

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

-- Fixtures PROPRES à la preuve : un track, son channel, et une card — tous trois en corbeille.
-- Elles sont créées par le propriétaire, comme le seed le ferait, puis les gestes sont joués par
-- l'administratrice réelle.
insert into public.tracks (id, workspace_id, name, slug, position)
values ('a0000000-0000-4000-8000-000000000001',
        '5eed0000-0000-4000-8000-000000000001', 'Corbeille — track de preuve', 'preuve-corbeille', 900);

insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id, position)
values ('a0000000-0000-4000-8000-000000000002',
        '5eed0000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001',
        'Corbeille — channel de preuve', 'preuve-corbeille',
        '5eed0000-0000-4000-8000-000000000051', 900);

-- Un SECOND channel sous le même track, celui-là JAMAIS mis à la corbeille : c'est lui qui permet
-- d'isoler le second niveau de la garde — une affaire sous un channel vivant dont le TRACK est
-- supprimé. Sans lui, il faudrait restaurer le premier channel pour l'atteindre, ce que la garde
-- refuse à juste titre.
insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id, position)
values ('a0000000-0000-4000-8000-000000000004',
        '5eed0000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000001',
        'Corbeille — channel vivant', 'preuve-corbeille-vivant',
        '5eed0000-0000-4000-8000-000000000051', 901);

insert into public.cards (id, workspace_id, channel_id, workflow_id, current_step_id, title, position)
values ('a0000000-0000-4000-8000-000000000003',
        '5eed0000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000002',
        '5eed0000-0000-4000-8000-000000000051',
        '5eed0000-0000-4000-8000-000000000061',
        'Corbeille — affaire de preuve', 900),
       ('a0000000-0000-4000-8000-000000000005',
        '5eed0000-0000-4000-8000-000000000001',
        'a0000000-0000-4000-8000-000000000004',
        '5eed0000-0000-4000-8000-000000000051',
        '5eed0000-0000-4000-8000-000000000061',
        'Corbeille — affaire sous channel vivant', 901);

-- Les trois sont mis à la corbeille. LE PARENT NE DESCEND PAS (§3.3) : chacun est horodaté
-- explicitement, ce qui est exactement l'état que l'écran produira.
update public.tracks   set deleted_at = now() where id = 'a0000000-0000-4000-8000-000000000001';
update public.channels set deleted_at = now() where id = 'a0000000-0000-4000-8000-000000000002';
update public.cards    set deleted_at = now()
 where id in ('a0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000005');

-- 1. LE PARENT N'A PAS DESCENDU, et c'est la prémisse de tout le reste : si mettre le track à la
--    corbeille avait horodaté ses enfants, la garde n'aurait aucun cas d'usage.
select is(
	(select count(*)::int from public.channels
	  where track_id = 'a0000000-0000-4000-8000-000000000001' and deleted_at is not null),
	1,
	'1 — le channel est en corbeille parce qu''on l''y a mis, non parce que son track y est');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011'::uuid);

-- 2 et 3. LES DEUX REFUS, sur un `update` DIRECT et avec un rôle réel : aucune interface n'est
--    impliquée, donc ce qui refuse ici refusera aussi une intégration ou un script.
select throws_ok(
	$$update public.channels set deleted_at = null
	   where id = 'a0000000-0000-4000-8000-000000000002'$$,
	'P0001',
	'parent_en_corbeille',
	'2 — un channel ne se restaure pas sous un track en corbeille');

select throws_ok(
	$$update public.cards set deleted_at = null
	   where id = 'a0000000-0000-4000-8000-000000000003'$$,
	'P0001',
	'parent_en_corbeille',
	'3 — une affaire ne se restaure pas sous un channel en corbeille');

-- 4. LE DEUXIÈME NIVEAU EST BIEN VÉRIFIÉ, et il fallait une fixture pour l'isoler : cette affaire
--    pend à un channel qui n'a JAMAIS été mis à la corbeille. Seul son track l'est. Sans ce second
--    niveau, elle aurait été rendue à un endroit tout aussi introuvable, d'un cran plus haut.
select throws_ok(
	$$update public.cards set deleted_at = null
	   where id = 'a0000000-0000-4000-8000-000000000005'$$,
	'P0001',
	'parent_en_corbeille',
	'4 — ni sous un channel VIVANT dont le track est en corbeille : les deux niveaux comptent');

-- 5 à 7. LA GARDE NE REFUSE PAS CE QU'ELLE NE DOIT PAS REFUSER. C'est la moitié de la preuve : un
--    trigger sur `update` qui interrogerait le parent à chaque écriture bloquerait des gestes
--    parfaitement légitimes.
select lives_ok(
	$$update public.cards set title = title || ' (renommée)'
	   where id = 'a0000000-0000-4000-8000-000000000003'$$,
	'5 — modifier une affaire EN corbeille reste possible : la garde ne vise que la restauration');

select lives_ok(
	$$update public.cards set deleted_at = now()
	   where id = 'a0000000-0000-4000-8000-000000000003'$$,
	'6 — la remettre à la corbeille alors qu''elle y est déjà ne déclenche rien');

-- L'ORDRE IMPOSÉ PAR LA GARDE EST JOUÉ TEL QUEL : le track d'abord, puis le channel, puis
-- l'affaire. C'est exactement ce que le refus demandait, et c'est la preuve qu'il DÉSIGNE un chemin
-- au lieu d'interdire.
update public.tracks   set deleted_at = null where id = 'a0000000-0000-4000-8000-000000000001';
update public.channels set deleted_at = null where id = 'a0000000-0000-4000-8000-000000000002';

select lives_ok(
	$$update public.cards set deleted_at = null
	   where id = 'a0000000-0000-4000-8000-000000000003'$$,
	'7 — les deux parents rendus DANS CET ORDRE, l''affaire se restaure : la garde désigne un chemin, elle n''interdit pas');

-- 8. ET ELLE EST RÉELLEMENT RESTAURÉE en base, ce que l'absence d'exception seule ne prouverait pas.
select is(
	(select deleted_at from public.cards where id = 'a0000000-0000-4000-8000-000000000003'),
	null::timestamptz,
	'8 — la restauration a bien eu lieu, et pas seulement « sans erreur »');

select pg_temp.redevenir_proprietaire();

select * from finish();
rollback;
