-- @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, TRANCHE 4, SOUS-TRANCHE 4a : la
--           séquence de relance et ses paliers
-- @verifies docs/SPEC-modeles-emails.md §11.2 (à qui une séquence appartient), §11.3 (colonnes de
--           `mail_sequences`), §11.4 (le palier, le délai relatif, le `on delete restrict`),
--           §11.5 (les seize refus, ligne à ligne), §11.6 (la position est `deferrable`, et une
--           mesure l'impose), §11.7 (autorisations)
-- @verifies docs/SPEC-modeles-emails.md §2.2 (la contrainte annoncée quatre tranches à l'avance)
-- @verifies docs/SCHEMA.md §7 (`mail_sequences`, `mail_sequence_steps`)
-- @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §7 (le refus est zéro ligne)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La FORME des deux tables et l'activation de la RLS. Une table livrée sans RLS serait ouverte
--    à tout porteur de jeton, et le reste de la suite mesurerait des refus imaginaires.
--
-- 2. LES DÉCISIONS DE FORME, figées par des assertions plutôt que laissées au commentaire :
--    aucune colonne `description`, `is_active` ni `archived_at` (§11.3) ; aucune identité sortante
--    (§11.2). Les voir rougir un jour signalerait qu'une colonne a été ajoutée sans réviser le §11.
--
-- 3. LE CARACTÈRE `DEFERRABLE` DE LA CONTRAINTE DE POSITION, lu dans `pg_constraint.condeferrable`
--    ET éprouvé par le geste qu'il existe pour permettre : l'ÉCHANGE ATOMIQUE de deux positions.
--    Lire le seul catalogue laisserait ouverte la question de savoir si le report suffit ; jouer le
--    seul échange ne dirait pas POURQUOI il passe. Les deux assertions ensemble le disent.
--
-- 4. LES SEIZE LIGNES DU §11.5, **chaque refus précédé de son témoin**. Un refus vert sur une
--    contrainte qui refuserait tout ne prouve rien ; c'est la règle du dépôt depuis la décision 70.
--
-- 5. LES HUIT POLITIQUES — quatre par table —, jouées avec les TROIS PROFILS RÉELS du seed :
--      * Camille (admin) et Driss (business_developer) lisent ET écrivent ;
--      * Farida (viewer) LIT et n'écrit rien — son refus de mise à jour est **zéro ligne**,
--        jamais une erreur (`docs/SPEC-permissions-rls.md` §7) ;
--      * l'anonyme lit ZÉRO ligne, les tables n'étant pas fermées à sa lecture mais filtrées.
--
-- 6. LE CLOISONNEMENT PAR WORKSPACE, sur les deux cas qui le prouvent : un nom déjà pris chez l'un
--    reste libre chez l'autre, et un palier ne peut PAS emprunter le modèle du voisin — refus par
--    une clé étrangère composite, jamais par une politique.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(67);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create or replace function pg_temp.anonyme()
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
	execute 'set local role anon';
end;
$$;

create or replace function pg_temp.redevenir_proprietaire()
returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '', true);
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures, posées en propriétaire — donc hors RLS.
-- ---------------------------------------------------------------------------------------------
-- LE NOM DES FIXTURES PORTE CELUI DU FICHIER, et cette précaution a un motif MESURÉ : la suite
-- 0047 est morte une fois à sa première insertion parce que sa fixture portait un nom que le seed
-- a pris ensuite. L'unicité par workspace du §11.3 ferait exactement la même chose ici.

insert into public.mail_templates (id, workspace_id, name, subject, body_text)
values
	('c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000001',
	 'Modèle d''essai de la suite 0057', 'Objet fixe', 'Un corps sans variable.'),
	-- Ce second modèle n'est employé par AUCUN palier : c'est le témoin du point l du §11.5, sans
	-- lequel le refus du `restrict` ne prouverait pas qu'il ne protège QUE ce qui est employé.
	('c0000000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-000000000001',
	 'Modèle libre de la suite 0057', 'Objet fixe', 'Employé par aucun palier.');

insert into public.mail_sequences (id, workspace_id, name, created_by)
values ('c0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000001',
        'Séquence d''essai de la suite 0057', '5eed0000-0000-4000-8000-000000000011');

insert into public.mail_sequence_steps (id, workspace_id, sequence_id, position, delai_jours, template_id)
values
	('c0000000-0000-4000-8000-0000000000c1', '5eed0000-0000-4000-8000-000000000001',
	 'c0000000-0000-4000-8000-0000000000b1', 1, 3, 'c0000000-0000-4000-8000-0000000000a1'),
	('c0000000-0000-4000-8000-0000000000c2', '5eed0000-0000-4000-8000-000000000001',
	 'c0000000-0000-4000-8000-0000000000b1', 2, 7, 'c0000000-0000-4000-8000-0000000000a1');

-- Le SECOND workspace, dont aucun profil du seed n'est membre : c'est le seul montage qui prouve
-- le cloisonnement, et il est fabriqué puis rendu par le `rollback` plutôt que d'étendre un seed
-- qui appartient à `CRM-005` et `CRM-046`.
insert into public.workspaces (id, name, slug)
values ('c0000000-0000-4000-8000-0000000000f1', 'Workspace étranger 0057', 'etranger-0057');

insert into public.mail_templates (id, workspace_id, name, subject, body_text)
values ('c0000000-0000-4000-8000-0000000000a9', 'c0000000-0000-4000-8000-0000000000f1',
        'Modèle du voisin 0057', 'Objet fixe', 'Le modèle d''un AUTRE workspace.');

-- =============================================================================================
-- 1. Forme des deux tables et RLS
-- =============================================================================================

select has_table('public', 'mail_sequences',
	'CRM-063 §11.3 — public.mail_sequences existe');
select has_table('public', 'mail_sequence_steps',
	'CRM-063 §11.4 — public.mail_sequence_steps existe');

select has_column('public', 'mail_sequences', 'workspace_id',
	'CRM-063 §11.2 — la séquence appartient à un workspace');
select has_column('public', 'mail_sequences', 'name',       'CRM-063 §11.3 — name');
select has_column('public', 'mail_sequences', 'created_by',
	'CRM-063 §11.3 — created_by, trace et jamais un droit');
select col_not_null('public', 'mail_sequences', 'name', 'CRM-063 §11.3 — name non nul');

select has_column('public', 'mail_sequence_steps', 'sequence_id', 'CRM-063 §11.4 — sequence_id');
select has_column('public', 'mail_sequence_steps', 'position',    'CRM-063 §11.4 — position');
select has_column('public', 'mail_sequence_steps', 'delai_jours', 'CRM-063 §11.4 — delai_jours');
select has_column('public', 'mail_sequence_steps', 'template_id', 'CRM-063 §11.4 — template_id');
select col_not_null('public', 'mail_sequence_steps', 'position',
	'CRM-063 §11.4 — position non nulle');
select col_not_null('public', 'mail_sequence_steps', 'delai_jours',
	'CRM-063 §11.4 — delai_jours non nul');
select col_not_null('public', 'mail_sequence_steps', 'template_id',
	'CRM-063 §11.4 — un palier SANS modèle n''enverrait rien : la colonne est non nulle');

-- --- Les décisions de forme, FIGÉES par des assertions (§11.2, §11.3) -------------------------
--
-- « AUCUNE COLONNE SANS LECTEUR » est la leçon d'INC-215, que la tranche 3 vient de payer. Ces
-- quatre assertions la rendent opposable : les voir rougir signalerait qu'une colonne a été
-- ajoutée sans réviser le §11.

select hasnt_column('public', 'mail_sequences', 'description',
	'CRM-063 §11.3 — aucune description : personne ne la lirait (leçon INC-215)');
select hasnt_column('public', 'mail_sequences', 'is_active',
	'CRM-063 §11.3 — aucun is_active : l''état armé appartient au lien, donc à 4b');
select hasnt_column('public', 'mail_sequences', 'archived_at',
	'CRM-063 §11.3 — aucun archivage : une séquence se supprime réellement');
select hasnt_column('public', 'mail_sequences', 'identity_id',
	'CRM-063 §11.2 — aucune identité sortante : quelle identité expédie est une question d''armement');

-- AUCUN SEUIL DE DÉCLENCHEMENT (§11.2) : « figée » a UNE définition en base depuis CRM-062, et une
-- seconde vivant ici est exactement ce que docs/SPEC-relances.md §2.1 existe pour empêcher.
select hasnt_column('public', 'mail_sequences', 'stale_after_days',
	'CRM-063 §11.2 — aucun seuil : cards_figees() est la seule définition de « figée »');

select is(
	(select relrowsecurity from pg_class where oid = 'public.mail_sequences'::regclass),
	true, 'CRM-063 §11.7 — la RLS est ACTIVÉE sur mail_sequences');
select is(
	(select relrowsecurity from pg_class where oid = 'public.mail_sequence_steps'::regclass),
	true, 'CRM-063 §11.7 — la RLS est ACTIVÉE sur mail_sequence_steps');

select is(
	(select count(*)::int from pg_policies where schemaname='public' and tablename='mail_sequences'),
	4, 'CRM-063 §11.7 — quatre politiques sur mail_sequences, une par action');
select is(
	(select count(*)::int from pg_policies where schemaname='public' and tablename='mail_sequence_steps'),
	4, 'CRM-063 §11.7 — quatre politiques sur mail_sequence_steps : la cadence vit dans les paliers');

-- =============================================================================================
-- 2. La contrainte de position est DEFERRABLE — le catalogue ET le geste
-- =============================================================================================
-- §11.6. Les deux assertions sont nécessaires et aucune ne remplace l'autre : le catalogue dit ce
-- que la contrainte EST, l'échange dit ce qu'elle PERMET.

select is(
	(select condeferrable from pg_constraint
	  where conrelid = 'public.mail_sequence_steps'::regclass
	    and conname  = 'mail_sequence_steps_sequence_position_key'),
	true, 'CRM-063 §11.6 — la contrainte de position est DEFERRABLE');

select is(
	(select condeferred from pg_constraint
	  where conrelid = 'public.mail_sequence_steps'::regclass
	    and conname  = 'mail_sequence_steps_sequence_position_key'),
	false, 'CRM-063 §11.6 — elle reste INITIALLY IMMEDIATE : un doublon est refusé par l''instruction qui le crée');

-- L'ÉCHANGE ATOMIQUE. MESURÉ le 2026-08-25 : avec une contrainte unique SIMPLE, ce même update rend
-- 23505, PostgreSQL vérifiant l'index ligne à ligne. C'est l'assertion qui justifie le `deferrable`.
select lives_ok($$
	update public.mail_sequence_steps
	   set position = 3 - position
	 where sequence_id = 'c0000000-0000-4000-8000-0000000000b1'
$$, 'CRM-063 §11.5 point h — l''échange de deux positions en UN SEUL update est accepté');

select is(
	(select position from public.mail_sequence_steps
	  where id = 'c0000000-0000-4000-8000-0000000000c1'),
	2, 'CRM-063 §11.6 — l''échange a réellement eu lieu, et n''est pas un no-op vert');

-- Remise en place, pour que la suite des assertions parte de l'état des fixtures.
update public.mail_sequence_steps
   set position = 3 - position
 where sequence_id = 'c0000000-0000-4000-8000-0000000000b1';

-- =============================================================================================
-- 3. Les seize refus du §11.5, chaque refus précédé de son témoin
-- =============================================================================================

-- --- a et b : la borne du nom -----------------------------------------------------------------
select lives_ok($$
	insert into public.mail_sequences (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', 'Témoin de borne 0057')
$$, 'CRM-063 §11.5 — TÉMOIN : un nom de longueur légitime est accepté');

select throws_ok($$
	insert into public.mail_sequences (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', '   ')
$$, '23514', null, 'CRM-063 §11.5 point a — un nom fait de blancs est refusé');

select throws_ok($$
	insert into public.mail_sequences (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', repeat('x', 121))
$$, '23514', null, 'CRM-063 §11.5 point b — un nom de 121 caractères est refusé');

-- --- c et d : l'unicité est PAR WORKSPACE -----------------------------------------------------
select throws_ok($$
	insert into public.mail_sequences (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', '  Séquence d''essai de la suite 0057  ')
$$, '23505', null, 'CRM-063 §11.5 point c — un nom déjà pris, aux blancs près, est refusé');

select lives_ok($$
	insert into public.mail_sequences (workspace_id, name)
	values ('c0000000-0000-4000-8000-0000000000f1', 'Séquence d''essai de la suite 0057')
$$, 'CRM-063 §11.5 point d — le MÊME nom dans un AUTRE workspace est accepté');

-- --- e : la borne de position -----------------------------------------------------------------
select lives_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b1',
	        50, 3, 'c0000000-0000-4000-8000-0000000000a1')
$$, 'CRM-063 §11.5 — TÉMOIN : la position 50, borne haute, est acceptée');

select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b1',
	        0, 3, 'c0000000-0000-4000-8000-0000000000a1')
$$, '23514', null, 'CRM-063 §11.5 point e — la position 0 est refusée');

select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b1',
	        51, 3, 'c0000000-0000-4000-8000-0000000000a1')
$$, '23514', null, 'CRM-063 §11.5 point e — la position 51 est refusée');

-- --- f et g : l'unicité de position est PAR SÉQUENCE -------------------------------------------
select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b1',
	        1, 9, 'c0000000-0000-4000-8000-0000000000a1')
$$, '23505', null, 'CRM-063 §11.5 point f — la position 1 est déjà prise dans cette séquence');

insert into public.mail_sequences (id, workspace_id, name)
values ('c0000000-0000-4000-8000-0000000000b2', '5eed0000-0000-4000-8000-000000000001',
        'Seconde séquence de la suite 0057');

select lives_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b2',
	        1, 9, 'c0000000-0000-4000-8000-0000000000a1')
$$, 'CRM-063 §11.5 point g — la MÊME position dans une AUTRE séquence est acceptée');

-- --- i : la borne du délai ---------------------------------------------------------------------
-- LA BORNE BASSE EST 1 ET NON 0 (§11.4) : un palier de délai nul partirait en même temps que celui
-- qui le précède. Les deux témoins encadrent la borne au lieu de la supposer.
select lives_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b2',
	        2, 1, 'c0000000-0000-4000-8000-0000000000a1')
$$, 'CRM-063 §11.5 — TÉMOIN : le délai 1, borne basse, est accepté');

select lives_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b2',
	        3, 365, 'c0000000-0000-4000-8000-0000000000a1')
$$, 'CRM-063 §11.5 — TÉMOIN : le délai 365, borne haute, est accepté');

select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b2',
	        4, 0, 'c0000000-0000-4000-8000-0000000000a1')
$$, '23514', null, 'CRM-063 §11.5 point i — le délai 0 est refusé : ce serait un doublon, pas une cadence');

select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b2',
	        5, 366, 'c0000000-0000-4000-8000-0000000000a1')
$$, '23514', null, 'CRM-063 §11.5 point i — le délai 366 est refusé');

-- --- j : un modèle inexistant -----------------------------------------------------------------
select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b2',
	        6, 3, 'c0000000-0000-4000-8000-00000000dead')
$$, '23503', null, 'CRM-063 §11.5 point j — un template_id inexistant est refusé');

-- --- k et l : le `on delete restrict` annoncé par le §2.2 --------------------------------------
-- LE TÉMOIN EST ICI INDISPENSABLE : un `restrict` qui refuserait TOUTE suppression de modèle
-- passerait le point k et serait pourtant une panne. Le point l le distingue.
select lives_ok($$
	delete from public.mail_templates where id = 'c0000000-0000-4000-8000-0000000000a2'
$$, 'CRM-063 §11.5 point l — un modèle employé par AUCUN palier se supprime');

select throws_ok($$
	delete from public.mail_templates where id = 'c0000000-0000-4000-8000-0000000000a1'
$$, '23503', null, 'CRM-063 §11.5 point k — un modèle EMPLOYÉ par un palier ne se supprime plus (§2.2)');

-- --- m : la séquence emporte ses paliers -------------------------------------------------------
select is(
	(select count(*)::int from public.mail_sequence_steps
	  where sequence_id = 'c0000000-0000-4000-8000-0000000000b2'),
	3, 'CRM-063 §11.5 — TÉMOIN : la seconde séquence porte bien trois paliers avant sa suppression');

select lives_ok($$
	delete from public.mail_sequences where id = 'c0000000-0000-4000-8000-0000000000b2'
$$, 'CRM-063 §11.5 point m — une séquence portant des paliers se supprime');

select is(
	(select count(*)::int from public.mail_sequence_steps
	  where sequence_id = 'c0000000-0000-4000-8000-0000000000b2'),
	0, 'CRM-063 §11.5 point m — ses paliers sont partis avec elle (on delete cascade)');

-- --- n et o : les deux clés composites ---------------------------------------------------------
-- LE REFUS EST UN 23503, DONC UNE CLÉ ÉTRANGÈRE — jamais une politique, jamais un trigger. C'est
-- ce que le §11.5 exige, et l'assertion le prouve en propriétaire, hors de toute RLS.
select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b1',
	        7, 3, 'c0000000-0000-4000-8000-0000000000a9')
$$, '23503', null, 'CRM-063 §11.5 point n — un palier ne peut PAS emprunter le modèle d''un autre workspace');

select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('c0000000-0000-4000-8000-0000000000f1', 'c0000000-0000-4000-8000-0000000000b1',
	        8, 3, 'c0000000-0000-4000-8000-0000000000a1')
$$, '23503', null, 'CRM-063 §11.5 point o — un palier dont le workspace diverge de sa séquence est refusé');

-- =============================================================================================
-- 4. Les huit politiques, jouées avec les trois profils réels du seed
-- =============================================================================================
-- Camille Aubert = admin, Driss Lemoine = business_developer, Farida Nowak = viewer.

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select is((select count(*)::int from public.mail_sequences
            where id = 'c0000000-0000-4000-8000-0000000000b1'),
          1, 'CRM-063 §11.7 — l''admin LIT la séquence de son workspace');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select is((select count(*)::int from public.mail_sequence_steps
            where sequence_id = 'c0000000-0000-4000-8000-0000000000b1'),
          3, 'CRM-063 §11.7 — le business_developer LIT les paliers');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select is((select count(*)::int from public.mail_sequences
            where id = 'c0000000-0000-4000-8000-0000000000b1'),
          1, 'CRM-063 §11.7 — la viewer LIT la séquence');

-- LE CLOISONNEMENT : la séquence du voisin n'est lue par personne, et le refus est un FILTRAGE.
select is((select count(*)::int from public.mail_sequences
            where workspace_id = 'c0000000-0000-4000-8000-0000000000f1'),
          0, 'CRM-063 §11.7 — la séquence d''un workspace étranger n''est pas lue');

select pg_temp.anonyme();
select is((select count(*)::int from public.mail_sequences), 0,
	'CRM-063 §11.7 — l''anonyme lit ZÉRO ligne : un filtrage, jamais une erreur');
select is((select count(*)::int from public.mail_sequence_steps), 0,
	'CRM-063 §11.7 — l''anonyme ne lit AUCUN palier');

-- --- Les écritures ------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select lives_ok($$
	insert into public.mail_sequences (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', 'Séquence écrite par Driss 0057')
$$, 'CRM-063 §11.7 — le business_developer INSÈRE une séquence');

select lives_ok($$
	update public.mail_sequence_steps set delai_jours = 5
	 where id = 'c0000000-0000-4000-8000-0000000000c1'
$$, 'CRM-063 §11.7 — le business_developer MODIFIE un palier');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b1',
	        9, 21, 'c0000000-0000-4000-8000-0000000000a1')
$$, 'CRM-063 §11.7 — l''admin INSÈRE un palier');

-- LA VIEWER LIT ET N'ÉCRIT RIEN. Son refus d'insertion est une ERREUR de politique ; son refus de
-- mise à jour et de suppression est ZÉRO LIGNE (docs/SPEC-permissions-rls.md §7). La distinction
-- n'est pas cosmétique : une politique `update` absente rendrait aussi zéro ligne, et seule la
-- relecture de la ligne INCHANGÉE prouve qu'elle est bien là.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok($$
	insert into public.mail_sequences (workspace_id, name)
	values ('5eed0000-0000-4000-8000-000000000001', 'Séquence interdite à Farida 0057')
$$, '42501', null, 'CRM-063 §11.7 — la viewer n''INSÈRE pas de séquence');

select throws_ok($$
	insert into public.mail_sequence_steps (workspace_id, sequence_id, position, delai_jours, template_id)
	values ('5eed0000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000b1',
	        10, 3, 'c0000000-0000-4000-8000-0000000000a1')
$$, '42501', null, 'CRM-063 §11.7 — la viewer n''INSÈRE pas de palier');

update public.mail_sequence_steps set delai_jours = 99
 where id = 'c0000000-0000-4000-8000-0000000000c1';
select is((select count(*)::int from public.mail_sequence_steps
            where id = 'c0000000-0000-4000-8000-0000000000c1' and delai_jours = 99),
          0, 'CRM-063 §11.7 — la mise à jour par la viewer touche ZÉRO ligne, sans erreur');

delete from public.mail_sequences where id = 'c0000000-0000-4000-8000-0000000000b1';
select pg_temp.redevenir_proprietaire();
select is((select count(*)::int from public.mail_sequences
            where id = 'c0000000-0000-4000-8000-0000000000b1'),
          1, 'CRM-063 §11.7 — la séquence est TOUJOURS LÀ : la suppression par la viewer n''a rien emporté');

-- =============================================================================================
-- 5. Privilèges de table, mesurés rôle par rôle
-- =============================================================================================
-- Le privilège précède la politique : `anon` conserve `select` et n'obtient rien, la RLS le
-- filtrant ; ses écritures sont refusées AVANT toute politique, par le privilège lui-même.

select is(has_table_privilege('anon', 'public.mail_sequences', 'select'), true,
	'CRM-063 §11.7 — anon conserve SELECT sur mail_sequences : le refus est un filtrage');
select is(has_table_privilege('anon', 'public.mail_sequences', 'insert'), false,
	'CRM-063 §11.7 — anon n''INSÈRE pas dans mail_sequences');
select is(has_table_privilege('anon', 'public.mail_sequence_steps', 'insert'), false,
	'CRM-063 §11.7 — anon n''INSÈRE pas de palier');
select is(has_table_privilege('anon', 'public.mail_sequence_steps', 'delete'), false,
	'CRM-063 §11.7 — anon ne SUPPRIME pas de palier');
select is(has_table_privilege('authenticated', 'public.mail_sequences', 'insert'), true,
	'CRM-063 §11.7 — authenticated INSÈRE, la politique décidant ensuite');
select is(has_table_privilege('authenticated', 'public.mail_sequence_steps', 'update'), true,
	'CRM-063 §11.7 — authenticated MODIFIE un palier, la politique décidant ensuite');

-- =============================================================================================
-- 6. Le seed est rendu intact
-- =============================================================================================
-- Toutes les écritures de cette suite vivent dans la transaction, que le `rollback` défait.

select * from finish();

rollback;
