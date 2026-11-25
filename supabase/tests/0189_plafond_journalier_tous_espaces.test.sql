-- @verifies CRM-161 (docs/BACKLOG.md) — tranche T3.d : le plafond journalier de 420 minutes compte tous les espaces de la
--           personne — la saisie d'un second espace refusée quand la journée est pleine dans le premier, permise quand elle
--           reste sous 420 ; le verrou ne porte plus l'espace ; le refus garde son message et ne dit ni minutes ni espace ;
--           un autre jour ou une autre personne n'y comptent pas ; un seul espace, inchangé ; le drapeau du déplacement d'un
--           track est respecté ; l'administrateur qui saisit pour un collègue le subit aussi
-- @verifies docs/SPEC-espace-courant.md §16.9.3 ; docs/SPEC-temps.md §2 ; docs/SCHEMA.md « Migration `0203` » ;
--           docs/SPEC-permissions-rls.md §7 ; décisions 981 et 989 ; CLAUDE.md §10
--
-- Tout vit dans une transaction annulée. Un second espace jetable (…a089…001) et son track sont posés ; Driss (…012), business
-- developer, est membre des deux espaces ; Camille (…011) les administre. Le temps du seed de Driss est mis de côté (triggers
-- suspendus) pour que les comptes soient ceux que la suite pose. Les assertions de l'ancien comportement (le plafond par
-- espace) sont révisées dans `0082`.

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

create or replace function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

-- Le second espace, son track, et les appartenances : Camille administre les deux, Driss est business developer des deux.
insert into public.workspaces (id, name, slug) values ('a0890000-0000-4000-8000-000000000001', 'Espace de la suite 0189', 'suite-0189');
insert into public.tracks (id, workspace_id, name, slug)
values ('a0890000-0000-4000-8000-000000000002', 'a0890000-0000-4000-8000-000000000001', 'Track 0189', 'track-0189');
insert into public.workspace_members (workspace_id, user_id, role)
values ('a0890000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000011', 'admin');
insert into public.workspace_members (workspace_id, user_id, role)
values ('a0890000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', 'business_developer');

-- Le temps du seed de Driss est retiré, comme la suite 0082 : les comptes sont ceux de cette suite, et le `rollback` le rend.
set local session_replication_role = replica;
delete from public.saisies_temps where profile_id = '5eed0000-0000-4000-8000-000000000012';
set local session_replication_role = origin;

-- ------------------------------------------------------------------------------------------------------------------
-- La forme
-- ------------------------------------------------------------------------------------------------------------------
select is((select prosecdef from pg_proc where oid = 'app.saisies_temps_plafond()'::regprocedure), true,
	'1 — le déclencheur reste SECURITY DEFINER : la somme voit les saisies d''un espace que l''auteur ne lit pas');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.saisies_temps'::regclass and tgname = 'saisies_temps_plafond'),
	1, '2 — un seul déclencheur du plafond, toujours posé sur les saisies');
select ok(pg_get_functiondef('app.saisies_temps_plafond()'::regprocedure) not like '%s.workspace_id = new.workspace_id%',
	'3 — la somme ne filtre plus sur l''espace de la saisie');

-- ------------------------------------------------------------------------------------------------------------------
-- Le plafond, tous espaces — Driss, sous son propre jeton, le jour J-40
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 40, 300,
	          '5eed0000-0000-4000-8000-000000000022')$$,
	'4 — 300 minutes dans le premier espace : permis');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('a0890000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 40, 135,
	          'a0890000-0000-4000-8000-000000000002')$$,
	'P0001', 'plafond journalier',
	'5 — 135 minutes de plus dans le second espace, le même jour : 435 au total, refusé');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('a0890000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 40, 120,
	          'a0890000-0000-4000-8000-000000000002')$$,
	'6 — 120 minutes dans le second espace : 420 au total, la journée est pleine, et permise');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 40, 15,
	          '5eed0000-0000-4000-8000-000000000034')$$,
	'P0001', 'plafond journalier',
	'7 — un quart d''heure de plus dans le premier espace, la journée pleine par les deux : refusé');
select throws_ok(
	$$update public.saisies_temps set minutes = 150
	   where profile_id = '5eed0000-0000-4000-8000-000000000012' and jour = current_date - 40
	     and workspace_id = 'a0890000-0000-4000-8000-000000000001'$$,
	'P0001', 'plafond journalier',
	'8 — augmenter la saisie du second espace au-delà du total de la journée est refusé aussi');
select lives_ok(
	$$update public.saisies_temps set minutes = 105
	   where profile_id = '5eed0000-0000-4000-8000-000000000012' and jour = current_date - 40
	     and workspace_id = 'a0890000-0000-4000-8000-000000000001'$$,
	'9 — la réduire reste permis : elle libère des minutes pour le total de la personne');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 40, 15,
	          '5eed0000-0000-4000-8000-000000000034')$$,
	'10 — et ces minutes libérées servent à une saisie du premier espace');

-- Un autre jour, une autre personne : la journée de J-39 de Driss est vide.
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('a0890000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 39, 420,
	          'a0890000-0000-4000-8000-000000000002')$$,
	'11 — un autre jour ne compte pas : 420 minutes dans le second espace, la veille étant pleine');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- Le refus ne dit ni minutes ni espace
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
do $$
declare detail text;
begin
	begin
		insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
		values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 39, 15,
		        '5eed0000-0000-4000-8000-000000000022');
	exception when sqlstate 'P0001' then
		get stacked diagnostics detail = pg_exception_detail;
	end;
	perform set_config('pgtap.detail', coalesce(detail, ''), true);
end $$;
reset role;
select is(current_setting('pgtap.detail'), 'la journée de cette personne dépasserait 420 minutes',
	'12 — le détail du refus ne dit ni les minutes déjà saisies ni l''espace');

-- ------------------------------------------------------------------------------------------------------------------
-- Un administrateur qui saisit pour un collègue le subit aussi (Camille pour Driss, le jour J-40, journée pleine)
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 40, 15,
	          '5eed0000-0000-4000-8000-000000000022')$$,
	'P0001', 'plafond journalier',
	'13 — l''administratrice qui saisit pour Driss dans le premier espace, sa journée pleine par les deux : refusé');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- Une autre personne : la journée de Camille, le même jour, n'est pas celle de Driss
-- ------------------------------------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000011', current_date - 40, 420,
	          '5eed0000-0000-4000-8000-000000000022')$$,
	'14 — une autre personne, le même jour : sa journée est la sienne');
reset role;

-- ------------------------------------------------------------------------------------------------------------------
-- Le drapeau du déplacement d'un track laisse passer (décision 969) ; un seul espace reste inchangé
-- ------------------------------------------------------------------------------------------------------------------
select set_config('app.track_move', 'on', true);
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 38, 420,
	          '5eed0000-0000-4000-8000-000000000022');
	  insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 38, 15,
	          '5eed0000-0000-4000-8000-000000000034')$$,
	'15 — sous le drapeau du déplacement d''un track, la garde laisse passer, comme avant');
select set_config('app.track_move', 'off', true);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select lives_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, track_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 37, 210,
	          '5eed0000-0000-4000-8000-000000000022');
	  insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, channel_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 37, 210,
	          '5eed0000-0000-4000-8000-000000000034')$$,
	'16 — un seul espace : 420 minutes sur deux cibles, comme avant');
select throws_ok(
	$$insert into public.saisies_temps (workspace_id, profile_id, jour, minutes, card_id)
	  values ('5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000012', current_date - 37, 15,
	          '5eed0000-0000-4000-8000-0000000000c3')$$,
	'P0001', 'plafond journalier', '17 — et le quart d''heure suivant, dans le même espace, est refusé comme avant');
reset role;

select * from finish();
rollback;
