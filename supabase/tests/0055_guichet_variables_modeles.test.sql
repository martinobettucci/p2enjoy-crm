-- @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 2, sous-tranche 2b : L'ÉCRAN
-- @verifies docs/SPEC-modeles-emails.md §9.3 (le guichet public, et la MESURE qui l'impose), §9.9
--           (contrat d'API du guichet), §3 (la liste est écrite une seule fois)
-- @verifies docs/SPEC-modeles-emails.md §2.4 (les douze variables et leur source mesurée)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET POURQUOI CHAQUE ASSERTION EXISTE.
--
-- 1. La FORME du guichet dans le catalogue : volatilité et `security invoker`. Un guichet livré
--    `security definer` par accident emprunterait un privilège que personne n'a besoin d'emprunter,
--    et le rendrait exécutable par des chemins que le §9.3 n'a pas prévus.
--
-- 2. LES PRIVILÈGES, RÔLE PAR RÔLE, `anon` EXCLU. L'assertion négative est ici aussi importante
--    que les positives : c'est elle qui fige le `401` de la ligne 1 du §9.9.
--
-- 3. L'ÉGALITÉ DES DEUX FONCTIONS, et jamais l'égalité de leurs seuls CARDINAUX. C'est
--    l'assertion qui rend la délégation vérifiable : sans elle, un guichet qui aurait cessé de
--    déléguer — par exemple en recopiant une liste figée — resterait vert tant qu'il rendrait
--    douze noms, fussent-ils les mauvais. Elle est comparée dans les DEUX SENS, parce que
--    `@>` seul serait vrai d'un guichet qui rendrait la liste PLUS un intrus.
--
-- 4. LA COMPARAISON AU §2.4, nom à nom. Le §3 de la spécification exige que la liste soit
--    comparée à sa source écrite et non à son cardinal, et cette suite tient cette exigence pour
--    le guichet comme `0053` la tient pour la fonction déléguée.
--
-- La suite ne pose AUCUNE fixture et n'écrit RIEN : le guichet ne lit aucune table. Le `rollback`
-- final est conservé par discipline, pour que la suite reste rejouable telle quelle.

begin;

create extension if not exists pgtap with schema extensions;

select plan(11);

-- =============================================================================================
-- 1. La forme du guichet dans le catalogue — §9.3
-- =============================================================================================

select has_function('public', 'mail_template_variables', array[]::text[],
	'CRM-063 §9.3 — public.mail_template_variables() existe : le schéma app n''est pas exposé');

select is(
	(select provolatile::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mail_template_variables'),
	'i',
	'CRM-063 §9.3 — le guichet est IMMUTABLE, comme la fonction qu''il appelle');

select is(
	(select prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mail_template_variables'),
	false,
	'CRM-063 §9.3 — SECURITY INVOKER : aucun privilège n''est emprunté');

select is(
	(select pg_get_function_result(p.oid) from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'mail_template_variables'),
	'text[]',
	'CRM-063 §9.3 — le guichet rend un text[], la forme que la palette de l''écran consomme');

-- =============================================================================================
-- 2. Les privilèges, rôle par rôle — §9.3, §9.9
-- =============================================================================================
-- Ce sont ceux de `public.rendre_modele_email` (§8.7), repris sans changement : un appelant
-- anonyme n'écrit aucun modèle, et la palette ne sert qu'à en écrire un.

select ok(
	has_function_privilege('authenticated', 'public.mail_template_variables()', 'execute'),
	'CRM-063 §9.3 — authenticated exécute le guichet');

select ok(
	has_function_privilege('service_role', 'public.mail_template_variables()', 'execute'),
	'CRM-063 §9.3 — service_role exécute le guichet');

select ok(
	not has_function_privilege('anon', 'public.mail_template_variables()', 'execute'),
	'CRM-063 §9.3 — anon N''EXÉCUTE PAS le guichet : son refus est un 401 de PRIVILÈGE');

-- =============================================================================================
-- 3. L'ÉGALITÉ AVEC LA SOURCE — l'assertion qui rend la délégation vérifiable
-- =============================================================================================
-- §9.3. Comparée dans les DEUX SENS : `@>` seul serait vrai d'un guichet qui rendrait la liste
-- déléguée PLUS un intrus, et `<@` seul serait vrai d'un guichet qui en aurait perdu un.

select is(
	public.mail_template_variables(),
	app.mail_template_variables(),
	'CRM-063 §9.3 — le guichet rend EXACTEMENT la liste de app.mail_template_variables() : il '
	'DÉLÈGUE, il ne recopie pas');

select ok(
	public.mail_template_variables() @> app.mail_template_variables()
		and public.mail_template_variables() <@ app.mail_template_variables(),
	'CRM-063 §9.3 — inclusion dans les DEUX SENS : ni intrus ajouté, ni nom perdu');

-- =============================================================================================
-- 4. La comparaison au §2.4, nom à nom — jamais par le cardinal
-- =============================================================================================
-- C'est l'exigence du §3, tenue par `0053` pour la fonction déléguée et reprise ici pour le
-- guichet : une suite qui n'assertait que « douze noms » resterait verte sur douze mauvais noms.

select is(
	public.mail_template_variables(),
	array[
		'card.amount', 'card.channel', 'card.currency', 'card.next_action',
		'card.next_action_at', 'card.step', 'card.title',
		'contact.email', 'contact.full_name', 'contact.organization',
		'identity.from_address', 'identity.from_name'
	]::text[],
	'CRM-063 §2.4 — les DOUZE noms du chapitre, un à un et dans l''ordre trié');

select is(
	array_length(public.mail_template_variables(), 1),
	12,
	'CRM-063 §2.4 — douze variables, et pas une de plus');

select * from finish();
rollback;
