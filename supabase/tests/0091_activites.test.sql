-- @verifies CRM-067 (docs/BACKLOG.md) — tranche T1 : les activités réalisées d'une affaire et leurs participants
-- @verifies docs/SPEC-activites.md §2 (type fermé, date jamais future, bornes), §3 (deux tables, pierre tombale,
--           participants, politiques d'un commentaire, modération bornée) ; docs/SCHEMA.md §9 bis.8 septies ;
--           CLAUDE.md §10 (chaque refus prouvé avec l'identité réelle d'un profil du seed)
--
-- LE SEED : Camille (…011) administratrice ; Driss (…012) business developer, restreint en lecture sur « Maintenance »
-- (…035) ; Farida (…013) lectrice, rouverte en écriture sur « Prospection » (…031). Affaires : `…ca` (Prospection),
-- `…c4` (Refonte de site, contact `…092` lié), `…d005` (Maintenance).
--
-- `rollback` : rien ne reste.

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

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

-- Consigne une activité sous l'identité courante ; rend son identifiant.
create or replace function pg_temp.consigner(p_card uuid, p_sujet text, p_quand timestamptz default now() - interval '1 hour')
returns uuid language sql as $$
	insert into public.card_activities (card_id, type, occurred_at, duration_minutes, subject)
	values (p_card, 'call', p_quand, 30, p_sujet)
	returning id
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. La forme
-- ---------------------------------------------------------------------------------------------

select has_table('public', 'card_activities', 'la table des activités existe');
select has_table('public', 'card_activity_participants', 'la table des participants existe');
select ok((select bool_and(relrowsecurity) from pg_class
            where oid in ('public.card_activities'::regclass, 'public.card_activity_participants'::regclass)),
          'RLS activée sur les deux tables');
select ok(not has_table_privilege('anon', 'public.card_activities', 'select'), 'anon ne lit pas');
select ok(not has_column_privilege('authenticated', 'public.card_activities', 'author_id', 'update')
          and not has_column_privilege('authenticated', 'public.card_activities', 'card_id', 'update'),
          'ni l''auteur ni l''affaire d''une activité ne s''écrivent');
select ok(not has_table_privilege('authenticated', 'public.card_activities', 'delete'),
          'aucune suppression physique : retirer pose la pierre tombale');

-- ---------------------------------------------------------------------------------------------
-- 2. Consigner
-- ---------------------------------------------------------------------------------------------

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select lives_ok($$ select pg_temp.consigner('5eed0000-0000-4000-8000-0000000000ca', 'Appel de découverte') $$,
                'la lectrice consigne sur « Prospection », qui lui est rouvert en écriture');
select is((select author_id from public.card_activities where subject = 'Appel de découverte'),
          '5eed0000-0000-4000-8000-000000000013'::uuid, 'l''auteur est posé par la base');
select is((select workspace_id from public.card_activities where subject = 'Appel de découverte'),
          '5eed0000-0000-4000-8000-000000000001'::uuid, 'l''espace est dérivé de l''affaire');
select throws_ok($$ select pg_temp.consigner('5eed0000-0000-4000-8000-0000000000c4', 'Refusé') $$,
                 '42501', null, 'la lectrice ne consigne pas sur une affaire qu''elle ne peut que lire');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok($$ select pg_temp.consigner('5eed0000-0000-4000-8000-00000000d005', 'Refusé') $$,
                 '42501', null, 'le business developer ne consigne pas sur « Maintenance », restreint en lecture');
select throws_ok($$ select pg_temp.consigner('5eed0000-0000-4000-8000-0000000000c4', 'Futur', now() + interval '1 day') $$,
                 '23514', 'activity_in_future', 'une activité future est refusée');
select lives_ok($$ select pg_temp.consigner('5eed0000-0000-4000-8000-0000000000c4', 'Horloge', now() + interval '2 minutes') $$,
                'cinq minutes d''avance sont tolérées pour l''horloge du poste');
select throws_ok($$ insert into public.card_activities (card_id, type, occurred_at, subject)
                    values ('5eed0000-0000-4000-8000-0000000000c4', 'letter', now(), 'x') $$,
                 '23514', null, 'un type hors des trois est refusé');
select throws_ok($$ insert into public.card_activities (card_id, type, occurred_at, duration_minutes, subject)
                    values ('5eed0000-0000-4000-8000-0000000000c4', 'visio', now(), 0, 'x') $$,
                 '23514', null, 'une durée nulle est refusée');
select throws_ok($$ insert into public.card_activities (card_id, type, occurred_at, subject)
                    values ('5eed0000-0000-4000-8000-0000000000c4', 'visio', now(), '   ') $$,
                 '23514', null, 'un subject vide est refusé');

-- Les participants : le contact lié à l'affaire et un membre, oui ; un contact non lié, non.
select lives_ok($$ insert into public.card_activity_participants (activity_id, contact_id)
                   select id, '5eed0000-0000-4000-8000-000000000092' from public.card_activities where subject = 'Horloge' $$,
                'un contact lié à l''affaire participe');
select lives_ok($$ insert into public.card_activity_participants (activity_id, profile_id)
                   select id, '5eed0000-0000-4000-8000-000000000011' from public.card_activities where subject = 'Horloge' $$,
                'un membre de l''espace participe');
select throws_ok($$ insert into public.card_activity_participants (activity_id, contact_id)
                    select id, '5eed0000-0000-4000-8000-000000000091' from public.card_activities where subject = 'Horloge' $$,
                 '23514', 'participant_outside_card', 'un contact non lié à l''affaire est refusé');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 3. Corriger, retirer, modérer
-- ---------------------------------------------------------------------------------------------

-- Farida, non-auteur, ne corrige pas l'activité de Driss (zéro ligne : la politique filtre).
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is((select count(*) from (select 1 from public.card_activities where subject = 'Horloge') l), 1::bigint,
          'la lectrice LIT l''activité de Driss sur une affaire qu''elle lit');
update public.card_activities set subject = 'Réécrit' where subject = 'Horloge';
select pg_temp.redevenir_proprietaire();
select is((select count(*) from public.card_activities where subject = 'Réécrit'), 0::bigint,
          'un non-auteur ne corrige rien');

-- L'auteur corrige : `edited_at` posé.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
update public.card_activities set body = 'Compte rendu ajouté' where subject = 'Horloge';
select pg_temp.redevenir_proprietaire();
select isnt((select edited_at from public.card_activities where subject = 'Horloge'), null, 'l''auteur corrige, et la date de correction est posée');

-- L'administratrice ne réécrit pas, elle retire.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select throws_ok($$ update public.card_activities set subject = 'Modéré' where subject = 'Horloge' $$,
                 'P0001', 'activity_moderation_limited', 'l''administratrice ne réécrit pas l''activité d''autrui');
update public.card_activities set deleted_at = now() where subject = 'Horloge';
select pg_temp.redevenir_proprietaire();

select is((select subject || '|' || coalesce(body, 'null') || '|' || (deleted_by::text)
             from public.card_activities where deleted_at is not null and card_id = '5eed0000-0000-4000-8000-0000000000c4'),
          '|null|5eed0000-0000-4000-8000-000000000011', 'le retrait vide l''activité et nomme qui l''a retirée');
select is((select count(*) from public.card_activity_participants p join public.card_activities a on a.id = p.activity_id
            where a.deleted_at is not null and a.card_id = '5eed0000-0000-4000-8000-0000000000c4'), 0::bigint,
          'les participants partent avec le contenu');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select throws_ok($$ update public.card_activities set subject = 'Rétabli'
                     where deleted_at is not null and card_id = '5eed0000-0000-4000-8000-0000000000c4' $$,
                 'P0001', 'activity_deleted', 'une activité retirée ne se corrige plus');
select throws_ok($$ delete from public.card_activities where subject = 'Appel de découverte' $$,
                 '42501', null, 'aucune suppression physique, même pour qui écrit');
select pg_temp.redevenir_proprietaire();

-- ---------------------------------------------------------------------------------------------
-- 4. L'anonyme
-- ---------------------------------------------------------------------------------------------

set local role anon;
select throws_ok($$ select count(*) from public.card_activities $$, '42501', null, 'l''anonyme ne lit pas');
reset role;

select is((select count(*) from public.card_activities where subject = 'Appel de découverte'), 1::bigint,
          'l''activité de la lectrice est intacte');

select * from finish();

rollback;
