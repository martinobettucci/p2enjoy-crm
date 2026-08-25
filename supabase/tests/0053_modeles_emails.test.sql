-- @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 1 : le modèle d'email
-- @verifies docs/SPEC-modeles-emails.md §2.2 (colonnes et bornes), §2.3 (la validation est en
--           base), §2.4 (la liste fermée des douze variables), §2.5 (les treize refus, ligne à
--           ligne), §2.6 (autorisations), §3 (`app.mail_template_variables`),
--           §4 (`app.mail_template_variables_inconnues`)
-- @verifies docs/SCHEMA.md §7 (`mail_templates`)
-- @verifies docs/SPEC-permissions-rls.md §2.1 (un viewer n'écrit rien), §7 (le refus est zéro ligne)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La FORME de la table et l'activation de la RLS. Une table livrée sans RLS serait ouverte à
--    tout porteur de jeton, et le reste de la suite mesurerait des refus imaginaires.
--
-- 2. LA LISTE DES VARIABLES, comparée nom à nom au §2.4. Une assertion sur le seul CARDINAL serait
--    verte sur une liste qui aurait perdu `card.title` et gagné `card.titel`.
--
-- 3. LA FONCTION DE REFUS, sur les neuf cas du §4 et du §2.5 — dont les trois que personne
--    n'écrirait spontanément : le trou VIDE, la triple accolade, et le texte `null`.
--
-- 4. LES TREIZE LIGNES DU §2.5, **chaque refus précédé de son témoin**. Un refus vert sur une
--    contrainte qui refuserait tout ne prouve rien ; c'est la règle du dépôt depuis la décision 70,
--    et elle est appliquée ici sans exception.
--
-- 5. LES QUATRE POLITIQUES, jouées avec les TROIS PROFILS RÉELS du seed :
--      * Camille (admin) et Driss (business_developer) lisent ET écrivent ;
--      * Farida (viewer) LIT et n'écrit rien — et son refus de mise à jour est **zéro ligne**,
--        jamais une erreur (`docs/SPEC-permissions-rls.md` §7) ;
--      * l'anonyme lit ZÉRO ligne, la table n'étant pas fermée à sa lecture mais filtrée.
--
-- 6. LE CLOISONNEMENT PAR WORKSPACE, sur le seul cas qui le prouve : un SECOND workspace, dont
--    aucun des trois profils n'est membre. Un nom déjà pris chez l'un reste libre chez l'autre, et
--    la ligne de l'autre n'est lue par personne.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(55);

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
-- a pris ensuite. L'unicité par workspace du §2.2 ferait exactement la même chose ici.

insert into public.mail_templates (id, workspace_id, name, subject, body_text, created_by)
values
	('b0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000001',
	 'Modèle d''essai de la suite 0053',
	 'Où en est {{card.title}} ?',
	 'Bonjour {{contact.full_name}},' || chr(10) ||
	 'où en est {{card.title}} ({{card.amount}} {{card.currency}}) ?',
	 '5eed0000-0000-4000-8000-000000000011');

-- Le SECOND workspace, dont aucun profil du seed n'est membre : c'est le seul montage qui prouve
-- le cloisonnement, et il est fabriqué puis rendu par le `rollback` plutôt que d'étendre un seed
-- qui appartient à `CRM-005` et `CRM-046` (`docs/SPEC-seed.md` §8, même choix qu'à `CRM-014`).
insert into public.workspaces (id, name, slug)
values ('b0000000-0000-4000-8000-0000000000f1', 'Workspace étranger 0053', 'etranger-0053');

insert into public.mail_templates (id, workspace_id, name, subject, body_text)
values
	('b0000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000f1',
	 'Modèle d''essai de la suite 0053',
	 'Le MÊME nom que chez le voisin, et c''est légitime',
	 'L''unicité est par workspace (§2.5 point j).');

-- =============================================================================================
-- 1. Forme de la table et RLS
-- =============================================================================================

select has_table('public', 'mail_templates',
	'CRM-063 §2.2 — public.mail_templates existe');

select has_column('public', 'mail_templates', 'workspace_id',
	'CRM-063 §2.2 — le modèle appartient à un workspace');
select has_column('public', 'mail_templates', 'name',      'CRM-063 §2.2 — name');
select has_column('public', 'mail_templates', 'subject',   'CRM-063 §2.2 — subject');
select has_column('public', 'mail_templates', 'body_text', 'CRM-063 §2.2 — body_text');
select has_column('public', 'mail_templates', 'created_by',
	'CRM-063 §2.2 — created_by, trace et jamais un droit');

select col_not_null('public', 'mail_templates', 'name',      'CRM-063 §2.2 — name non nul');
select col_not_null('public', 'mail_templates', 'subject',   'CRM-063 §2.2 — subject non nul');
select col_not_null('public', 'mail_templates', 'body_text', 'CRM-063 §2.2 — body_text non nul');

-- AUCUNE colonne `archived_at` : le §2.2 tranche que le modèle se SUPPRIME. L'assertion fige la
-- décision — la voir rougir un jour signalerait qu'un archivage a été ajouté sans réviser le §2.2.
select hasnt_column('public', 'mail_templates', 'archived_at',
	'CRM-063 §2.2 — aucun archivage : un modèle se supprime réellement');

select is(
	(select relrowsecurity from pg_class where oid = 'public.mail_templates'::regclass),
	true,
	'CRM-063 §2.6 — la RLS est ACTIVÉE sur mail_templates');

select is(
	(select count(*)::int from pg_policies
	  where schemaname = 'public' and tablename = 'mail_templates'),
	4,
	'CRM-063 §2.6 — quatre politiques, une par action');

-- =============================================================================================
-- 2. La liste des variables — nom à nom, et non par son cardinal
-- =============================================================================================

select is(
	app.mail_template_variables(),
	array[
		'card.amount', 'card.channel', 'card.currency', 'card.next_action', 'card.next_action_at',
		'card.step', 'card.title',
		'contact.email', 'contact.full_name', 'contact.organization',
		'identity.from_address', 'identity.from_name'
	]::text[],
	'CRM-063 §2.4 — les douze variables, dans l''ordre et à la lettre');

-- `immutable` n'est pas un ornement : c'est la CONDITION d'existence des deux contraintes, une
-- contrainte de vérification n'acceptant qu'une expression immuable (§3).
select is(
	(select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'mail_template_variables'),
	'i'::"char",
	'CRM-063 §3 — app.mail_template_variables est IMMUTABLE');

select is(
	(select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'mail_template_variables_inconnues'),
	'i'::"char",
	'CRM-063 §4 — app.mail_template_variables_inconnues est IMMUTABLE');

-- =============================================================================================
-- 3. La fonction de refus, sur les neuf cas du §4 et du §2.5
-- =============================================================================================

select is(app.mail_template_variables_inconnues('Bonjour, aucune variable ici'), array[]::text[],
	'CRM-063 §2.5 a — un texte sans variable ne porte aucun inconnu');

select is(app.mail_template_variables_inconnues('{{card.title}} puis encore {{card.title}}'),
	array[]::text[],
	'CRM-063 §2.5 b — une variable connue, même répétée, est acceptée');

select is(app.mail_template_variables_inconnues('{{  card.title  }}'), array[]::text[],
	'CRM-063 §2.5 c — les blancs de bord dans les accolades sont tolérés');

select is(app.mail_template_variables_inconnues('{{card.titel}}'), array['card.titel']::text[],
	'CRM-063 §2.5 d — une faute de frappe est dénoncée, et nommée');

select is(app.mail_template_variables_inconnues('{{}}'), array['']::text[],
	'CRM-063 §2.5 f — le trou VIDE est un inconnu : la chaîne vide n''est pas au §2.4');

select is(app.mail_template_variables_inconnues('{{CARD.TITLE}}'), array['CARD.TITLE']::text[],
	'CRM-063 §2.5 g — les noms sont SENSIBLES À LA CASSE, une seule graphie par variable');

-- La triple accolade : `{{{x}}` ne correspond pas au motif, `{{x}}` correspond, et `x` est donc
-- inconnu. Le comportement est VOULU (§4) — une accolade en trop est une faute de frappe.
select is(app.mail_template_variables_inconnues('{{{x}}}'), array['x']::text[],
	'CRM-063 §4 — une accolade en trop rend le texte refusable, et c''est voulu');

select is(app.mail_template_variables_inconnues(null), array[]::text[],
	'CRM-063 §4 — un texte nul ne refuse rien : une contrainte ne refuse jamais sur null');

-- Trié ET dédoublonné : sans le tri, le message de refus de l'écran varierait d'un appel à
-- l'autre ; sans la déduplication, il répéterait la même faute autant de fois qu'elle est écrite.
select is(app.mail_template_variables_inconnues('{{zebre}} {{alpha}} {{zebre}}'),
	array['alpha', 'zebre']::text[],
	'CRM-063 §4 — les inconnus sont TRIÉS et DÉDOUBLONNÉS');

-- =============================================================================================
-- 4. Les treize lignes du §2.5 — chaque refus précédé de son TÉMOIN
-- =============================================================================================
-- Le témoin est la moitié qui manque presque toujours : une contrainte qui refuserait TOUT rendrait
-- verte une suite qui ne mesurerait que des refus.

-- --- Témoin : l'écriture nominale passe (points a, b, c, j) -----------------------------------
select lives_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Témoin 0053 nominal',
	        'Objet fixe sans variable',
	        'Bonjour {{ contact.full_name }}, {{card.title}} et encore {{card.title}}.')
$$, 'CRM-063 §2.5 a/b/c — TÉMOIN : un modèle valide s''écrit');

-- --- Point d : variable inconnue dans l'objet -------------------------------------------------
select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Refus objet 0053',
	        'Où en est {{card.titel}} ?', 'Corps sans variable')
$$, '23514', null,
	'CRM-063 §2.5 d — une variable inconnue dans l''objet est refusée');

-- --- Point e : variable inconnue dans le corps ------------------------------------------------
select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Refus corps 0053',
	        'Objet sans variable', 'Bonjour {{contact.fullname}}')
$$, '23514', null,
	'CRM-063 §2.5 e — une variable inconnue dans le corps est refusée');

-- LE REFUS NOMME LA COLONNE, et ce n'est pas cosmétique : sans cela, l'écran de la tranche 2
-- devrait deviner près de quel champ poser son message.
select is(
	(select conname::text from pg_constraint
	  where conrelid = 'public.mail_templates'::regclass
	    and conname = 'mail_templates_subject_variables'),
	'mail_templates_subject_variables',
	'CRM-063 §2.5 — la contrainte de l''objet est NOMMÉE par sa colonne');
select is(
	(select conname::text from pg_constraint
	  where conrelid = 'public.mail_templates'::regclass
	    and conname = 'mail_templates_body_variables'),
	'mail_templates_body_variables',
	'CRM-063 §2.5 — la contrainte du corps est NOMMÉE par sa colonne');

-- --- Point f : le trou vide --------------------------------------------------------------------
select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Refus trou vide 0053',
	        'Objet {{}}', 'Corps sans variable')
$$, '23514', null,
	'CRM-063 §2.5 f — le trou vide est refusé à l''écriture');

-- --- Point g : la casse ------------------------------------------------------------------------
select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Refus casse 0053',
	        'Objet {{Card.Title}}', 'Corps sans variable')
$$, '23514', null,
	'CRM-063 §2.5 g — une graphie de casse différente est refusée');

-- --- Point h : le nom vide, et son témoin -------------------------------------------------------
-- Le nom est fait de blancs UNICODE invisibles : `app.btrim_blancs` les retire, un `btrim` nu ne
-- les retirerait pas. C'est la règle de `CRM-035`, et l'assertion la remesure ici.
select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', E'   ',
	        'Objet valide', 'Corps valide')
$$, '23514', null,
	'CRM-063 §2.5 h — un nom fait de blancs Unicode invisibles est refusé');

-- --- Points k et l : les bornes, chacune contre son témoin --------------------------------------
select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Refus objet vide 0053', '   ', 'Corps valide')
$$, '23514', null,
	'CRM-063 §2.5 k — un objet vide est refusé');

select lives_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Témoin borne haute 0053',
	        repeat('o', 300), repeat('c', 20000))
$$, 'CRM-063 §2.5 l — TÉMOIN : les bornes EXACTES, 300 et 20 000, sont acceptées');

select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Refus objet long 0053',
	        repeat('o', 301), 'Corps valide')
$$, '23514', null,
	'CRM-063 §2.5 l — un objet de 301 caractères est refusé');

select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Refus corps long 0053',
	        'Objet valide', repeat('c', 20001))
$$, '23514', null,
	'CRM-063 §2.5 l — un corps de 20 001 caractères est refusé');

-- --- Point i : l'unicité, aux blancs de bord près -----------------------------------------------
select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', '  Modèle d''essai de la suite 0053  ',
	        'Objet valide', 'Corps valide')
$$, '23505', null,
	'CRM-063 §2.5 i — un nom déjà pris, aux blancs près, est refusé');

-- --- Point j : le même nom dans un AUTRE workspace, déjà posé en fixture -------------------------
select is(
	(select count(*)::int from public.mail_templates
	  where app.btrim_blancs(name) = 'Modèle d''essai de la suite 0053'),
	2,
	'CRM-063 §2.5 j — le même nom coexiste dans deux workspaces : l''unicité est PAR workspace');

-- =============================================================================================
-- 5. Les quatre politiques, avec les trois profils réels du seed
-- =============================================================================================

-- --- Lecture ------------------------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select isnt_empty($$
	select id from public.mail_templates
	 where id = 'b0000000-0000-4000-8000-0000000000a1'
$$, 'CRM-063 §2.6 — Camille (admin) lit le modèle de son workspace');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select isnt_empty($$
	select id from public.mail_templates
	 where id = 'b0000000-0000-4000-8000-0000000000a1'
$$, 'CRM-063 §2.6 — Driss (business_developer) lit le même modèle');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select isnt_empty($$
	select id from public.mail_templates
	 where id = 'b0000000-0000-4000-8000-0000000000a1'
$$, 'CRM-063 §2.6 — Farida (viewer) LIT les modèles : elle n''en est pas privée');

-- LE CLOISONNEMENT : la ligne du workspace étranger n'est lue par personne. Sans cette assertion,
-- « la lectrice lit » ne dirait pas si elle lit CE workspace ou tous.
select is_empty($$
	select id from public.mail_templates
	 where id = 'b0000000-0000-4000-8000-0000000000a2'
$$, 'CRM-063 §2.6 — le modèle d''un workspace étranger n''est PAS lu');

select pg_temp.anonyme();
select is_empty($$
	select id from public.mail_templates
$$, 'CRM-063 §2.6 — l''anonyme lit ZÉRO ligne : un filtrage, jamais une erreur');

-- --- Écriture : le témoin d'abord ----------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');
select lives_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Écrit par Driss 0053',
	        'Objet valide', 'Corps {{card.title}}')
$$, 'CRM-063 §2.6 — TÉMOIN : le business developer INSÈRE');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');
select lives_ok($$
	update public.mail_templates
	   set subject = 'Objet réécrit par Camille'
	 where id = 'b0000000-0000-4000-8000-0000000000a1'
$$, 'CRM-063 §2.6 — TÉMOIN : l''administratrice MODIFIE');

-- --- Écriture : la lectrice ---------------------------------------------------------------------
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');
select throws_ok($$
	insert into public.mail_templates (workspace_id, name, subject, body_text)
	values ('5eed0000-0000-4000-8000-000000000001', 'Refusé à Farida 0053',
	        'Objet valide', 'Corps valide')
$$, '42501', null,
	'CRM-063 §2.6 — la lectrice ne CRÉE pas : la politique refuse');

-- LE REFUS DE MISE À JOUR EST ZÉRO LIGNE, jamais une erreur : c'est `docs/SPEC-permissions-rls.md`
-- §7, et la distinction est ce qui empêche l'écran de croire à une panne.
--
-- LES DEUX GESTES PASSENT PAR UNE FONCTION, ET C'EST PostgreSQL QUI L'IMPOSE : une clause `with`
-- portant un ordre d'écriture doit être au premier niveau de la requête, si bien qu'elle ne peut
-- pas être le sous-select d'un `is()`. MESURÉ — « WITH clause containing a data-modifying
-- statement must be at the top level ». Le compte est donc rendu par `plpgsql`, qui expose
-- `row_count` sans rien changer au geste ni au rôle qui l'exécute.

create or replace function pg_temp.lignes_modifiees()
returns integer language plpgsql as $$
declare compte integer;
begin
	update public.mail_templates set subject = 'Pirate'
	 where id = 'b0000000-0000-4000-8000-0000000000a1';
	get diagnostics compte = row_count;
	return compte;
end;
$$;

create or replace function pg_temp.lignes_supprimees()
returns integer language plpgsql as $$
declare compte integer;
begin
	delete from public.mail_templates
	 where id = 'b0000000-0000-4000-8000-0000000000a1';
	get diagnostics compte = row_count;
	return compte;
end;
$$;

select is(pg_temp.lignes_modifiees(), 0,
	'CRM-063 §2.6 — la mise à jour par la lectrice touche ZÉRO ligne, sans erreur');

select is(pg_temp.lignes_supprimees(), 0,
	'CRM-063 §2.6 — la suppression par la lectrice touche ZÉRO ligne, sans erreur');

-- Et la ligne est TOUJOURS LÀ : le refus ne doit pas être un succès silencieux.
select isnt_empty($$
	select id from public.mail_templates
	 where id = 'b0000000-0000-4000-8000-0000000000a1'
$$, 'CRM-063 §2.6 — après les deux refus, la ligne visée est INTACTE');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 6. Privilèges — la porte que les `alter default privileges` laissent ouverte
-- =============================================================================================
-- Le point de sûreté des migrations 48 à 54 : sans `revoke` NOMINATIF, `anon` conserverait
-- `all privileges` sur une table neuve de `public`, et la RLS serait le seul rempart.

select is(has_table_privilege('anon', 'public.mail_templates', 'insert'), false,
	'CRM-063 §2.6 — anon n''INSÈRE pas : le privilège est refermé nominativement');
select is(has_table_privilege('anon', 'public.mail_templates', 'update'), false,
	'CRM-063 §2.6 — anon ne MODIFIE pas');
select is(has_table_privilege('anon', 'public.mail_templates', 'delete'), false,
	'CRM-063 §2.6 — anon ne SUPPRIME pas');
select is(has_table_privilege('anon', 'public.mail_templates', 'select'), true,
	'CRM-063 §2.6 — anon conserve SELECT : le refus est un filtrage de la RLS');
select is(has_table_privilege('authenticated', 'public.mail_templates', 'insert'), true,
	'CRM-063 §2.6 — authenticated INSÈRE, la politique décidant ensuite');

select is(has_function_privilege('anon', 'app.mail_template_variables()', 'execute'), true,
	'CRM-063 §2.1 — la liste des variables est exécutable par anon : elle ne divulgue rien');

-- =============================================================================================
-- 7. Le seed est rendu intact
-- =============================================================================================
-- Toutes les écritures de cette suite vivent dans la transaction, que le `rollback` défait.

select * from finish();

rollback;
