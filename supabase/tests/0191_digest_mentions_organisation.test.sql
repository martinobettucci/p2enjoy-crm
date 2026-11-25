-- @verifies INC-361 (docs/INCONSISTENCY_REPORT.md ; lot F du backlog, décisions 992 et 1000) — le digest quotidien cite aussi
--           les mentions non lues du fil d'une organisation, avec le lien de sa fiche
-- @verifies docs/SPEC-etiquettes-digest.md §5.2 bis (la rubrique « On vous a mentionné » mêle les mentions d'affaires et
--           d'organisations dans l'ordre de leur création ; le compteur de l'objet les compte ; « rien à dire » aussi ; la
--           ligne `- {nom} (organisation)` puis `{site}/contacts/organisations/{id}#commentaire-{id}` ; seulement non lues,
--           de l'espace du digest, que la personne peut lire) ; docs/SPEC-notifications.md §51 ; docs/SCHEMA.md « Migration
--           `0206` » ; CLAUDE.md §10 (le droit de lecture est appliqué en base, `app.can_read_organization_for`)
--
-- ROUGE SUR LA DÉFINITION DE LA `0133` (la jointure par `subject_card_id` écarte toute mention d'organisation), vert avec la
-- `0206`. Joué sous le propriétaire — `app.digest_corps` est la fonction du job, fermée aux clients ; le `rollback` final rend
-- la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

\set ws '\'5eed0000-0000-4000-8000-000000000001\''
\set ws2 '\'5eed0000-0000-4000-8000-0000000e9101\''
\set driss '\'5eed0000-0000-4000-8000-000000000012\''
\set camille '\'5eed0000-0000-4000-8000-000000000011\''
\set carte '\'5eed0000-0000-4000-8000-0000000000c1\''

create temp table pg_temp.instants as select ((current_date + time '07:15') at time zone 'Europe/Paris') as sept;

-- Une base propre pour Driss : le jeu lui donne des notifications (docs/SPEC-seed.md §31), la preuve compte les siennes.
delete from public.notifications where recipient_id = :driss;

create temp table pg_temp.duval as
select id from public.organizations where workspace_id = :ws and name = 'Imprimerie Duval';
select ok((select count(*) = 1 from pg_temp.duval), '0 — le jeu porte « Imprimerie Duval » dans l''espace du seed');

-- 1. Une mention d'affaire, puis une d'organisation : l'ordre de création, les deux dans la rubrique.
insert into public.notifications (workspace_id, recipient_id, type, subject_card_id, created_at)
values (:ws, :driss, 'mention', :carte, now() - interval '2 hours');
insert into public.notifications (workspace_id, recipient_id, type, subject_organization_id, payload, created_at)
select :ws, :driss, 'mention', d.id,
       jsonb_build_object('comment_id', '5eed0000-0000-4000-8000-0000000e9102', 'author_id', :camille::uuid), now() - interval '1 hour'
  from pg_temp.duval d;

create temp table pg_temp.digest as
select * from app.digest_corps(:driss, :ws, (select sept from pg_temp.instants));

select is((select count(*)::int from pg_temp.digest), 1, '1 — un digest est produit');
select ok((select corps like '%On vous a mentionné%- Imprimerie Duval (organisation)%' from pg_temp.digest),
	'2 — la mention d''organisation est citée dans « On vous a mentionné », avec son nom et la mention « (organisation) »');
select ok((select position('{site}/contacts/organisations/' || d.id || '#commentaire-5eed0000-0000-4000-8000-0000000e9102' in g.corps) > 0
             from pg_temp.digest g, pg_temp.duval d),
	'3 — son lien est la fiche de l''organisation, à l''ancre du commentaire, au jeton {site}');
select ok((select position('Imprimerie Duval' in corps) > position('{site}/tracks/' in corps) from pg_temp.digest),
	'4 — dans l''ordre de création : l''affaire, d''il y a deux heures, précède l''organisation, d''il y a une heure');
select ok((select sujet like '%2 mention(s)' from pg_temp.digest), '5 — l''objet compte les deux mentions');

-- 2. Lue : elle sort du digest, et seule l'affaire reste.
update public.notifications set read_at = now() where recipient_id = :driss and subject_organization_id is not null;
select ok((select corps not like '%Imprimerie Duval%' and sujet like '%1 mention(s)' from app.digest_corps(:driss, :ws, (select sept from pg_temp.instants))),
	'6 — une mention d''organisation lue n''y figure plus, et le compteur suit');

-- 3. Une charge utile sans commentaire : la ligne et le lien de la fiche.
delete from public.notifications where recipient_id = :driss;
insert into public.notifications (workspace_id, recipient_id, type, subject_organization_id, payload)
select :ws, :driss, 'mention', d.id, '{}'::jsonb from pg_temp.duval d;
select is((select count(*)::int from app.digest_corps(:driss, :ws, (select sept from pg_temp.instants)) where corps like '%Imprimerie Duval (organisation)%'), 1,
	'7 — une mention d''organisation sans commentaire cité est citée quand même');
select ok((select position('{site}/contacts/organisations/' || d.id in g.corps) > 0 and g.corps not like '%#commentaire-%'
             from app.digest_corps(:driss, :ws, (select sept from pg_temp.instants)) g, pg_temp.duval d),
	'8 — sans identifiant de commentaire dans la charge utile, le lien est celui de la fiche seule');

-- 4. Une organisation d'un autre espace.
insert into public.workspaces (id, name, slug) values (:ws2, 'ZZ Autre espace', 'zz-autre-espace');
insert into public.workspace_members (workspace_id, user_id, role) values (:ws2, :camille, 'admin');
insert into public.organizations (id, workspace_id, name) values ('5eed0000-0000-4000-8000-0000000e9103', :ws2, 'Organisation ZZ');
delete from public.notifications where recipient_id = :driss;
-- Driss n'est pas membre de l'autre espace : une notification (posée de force, la RLS ne s'applique pas au propriétaire) ne
-- lui fait pas lire l'organisation — le droit est celui de la base, au moment du digest.
insert into public.notifications (workspace_id, recipient_id, type, subject_organization_id, payload)
values (:ws2, :driss, 'mention', '5eed0000-0000-4000-8000-0000000e9103', '{}'::jsonb);
select is((select count(*)::int from app.digest_corps(:driss, :ws2, (select sept from pg_temp.instants))), 0,
	'9 — une organisation que la personne ne peut pas lire n''est pas citée, et rien d''autre à dire : aucun digest');

-- Membre de l'autre espace : sa mention y figure — dans le digest DE CET ESPACE, et pas dans celui du premier.
insert into public.workspace_members (workspace_id, user_id, role) values (:ws2, :driss, 'business_developer');
select is((select count(*)::int from app.digest_corps(:driss, :ws, (select sept from pg_temp.instants)) where corps like '%Organisation ZZ%'), 0,
	'10 — la mention d''un autre espace n''entre pas dans le digest du premier');
select is((select count(*)::int from app.digest_corps(:driss, :ws2, (select sept from pg_temp.instants))
            where corps like '%- Organisation ZZ (organisation)%' and sujet like '%1 mention(s)'), 1,
	'11 — elle entre dans le digest de son espace, dont elle est la seule nouveauté : un digest est produit (rien à dire, aucun email, ne la compte plus pour rien)');

-- 5. Le droit retiré la veille retire la ligne (§5.2).
delete from public.workspace_members where workspace_id = :ws2 and user_id = :driss;
select is((select count(*)::int from app.digest_corps(:driss, :ws2, (select sept from pg_temp.instants))), 0,
	'12 — un membre sorti de l''espace n''a plus la ligne : le droit est lu au moment du digest');

-- 6. Rien n'est changé pour les affaires, et une mention d'un autre type sans sujet est sans effet.
delete from public.notifications where recipient_id = :driss;
insert into public.notifications (workspace_id, recipient_id, type, subject_card_id)
values (:ws, :driss, 'mention', :carte);
select ok((select corps like '%{site}/tracks/%' and corps not like '%(organisation)%' and sujet like '%1 mention(s)'
             from app.digest_corps(:driss, :ws, (select sept from pg_temp.instants))),
	'13 — une mention d''affaire seule : le digest des affaires est celui d''avant');
insert into public.notifications (workspace_id, recipient_id, type, subject_organization_id, payload)
select :ws, :driss, 'mention', d.id, '{}'::jsonb from pg_temp.duval d;
select ok((select count(*) = 0 from app.digest_corps(:camille, :ws, (select sept from pg_temp.instants))
             where corps like '%Imprimerie Duval%'),
	'14 — la mention d''organisation de Driss ne figure pas dans le digest d''une autre personne (la sienne, sur Vertigo Conseil, y reste)');

select * from finish();
rollback;
