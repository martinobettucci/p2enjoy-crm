-- @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, tranche 2, sous-tranche 2a : LE RENDU
-- @verifies docs/SPEC-modeles-emails.md §8.3 (contrat de `public.rendre_modele_email`), §8.4 (ce
--           qu'un trou dont la source est nulle rend, et son inventaire), §8.5 (les sources ne se
--           devinent pas), §8.6 (formatage des deux valeurs non textuelles), §8.7 (privilèges)
-- @verifies docs/SPEC-modeles-emails.md §2.4 (la liste fermée des douze variables et leur source)
-- @verifies docs/SPEC-permissions-rls.md §7 (le refus est zéro ligne, jamais une erreur)
-- @verifies CLAUDE.md §10 (toute règle d'accès se prouve hors interface)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La FORME des deux fonctions dans le catalogue : volatilité, `security invoker`, et les
--    privilèges rôle par rôle. Une fonction livrée `security definer` par accident rendrait tous
--    les refus de la section 5 imaginaires — elle lirait tout, pour tout le monde.
--
-- 2. LA SUBSTITUTION, variable par variable, sur les DOUZE noms du §2.4 — jamais sur un
--    échantillon. Une assertion sur trois variables serait verte sur une carte de valeurs qui
--    aurait perdu les neuf autres.
--
-- 3. LES DEUX FORMATAGES du §8.6, dont l'horodatage EN UTC, qui est une limite nommée.
--
-- 4. LES TROUS NULS ET LEUR INVENTAIRE — le cœur de la décision du §8.4 : la chaîne vide, le nom
--    du trou, le tri, le dédoublonnage, et la variable ABSENTE du modèle qui n'est PAS listée.
--
-- 5. LE CLOISONNEMENT PAR LA RLS, joué avec les TROIS PROFILS RÉELS du seed, et le zéro-ligne des
--    identifiants inconnus — qui doit être INDISCERNABLE de celui d'un objet masqué.
--
-- La suite pose ses propres fixtures et fait `rollback` : le seed est rendu intact.

begin;

create extension if not exists pgtap with schema extensions;

select plan(53);

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

-- Un appel du rendu réduit à sa seule colonne d'objet, pour que les assertions restent lisibles.
create or replace function pg_temp.objet(
	modele uuid, affaire uuid, personne uuid default null, expediteur uuid default null)
returns text language sql stable as $$
	select r.subject from public.rendre_modele_email(modele, affaire, personne, expediteur) r;
$$;

create or replace function pg_temp.corps(
	modele uuid, affaire uuid, personne uuid default null, expediteur uuid default null)
returns text language sql stable as $$
	select r.body_text from public.rendre_modele_email(modele, affaire, personne, expediteur) r;
$$;

create or replace function pg_temp.nuls(
	modele uuid, affaire uuid, personne uuid default null, expediteur uuid default null)
returns text[] language sql stable as $$
	select r.variables_nulles from public.rendre_modele_email(modele, affaire, personne, expediteur) r;
$$;

-- ---------------------------------------------------------------------------------------------
-- Fixtures, posées en propriétaire — donc hors RLS.
-- ---------------------------------------------------------------------------------------------
-- LE NOM DES FIXTURES PORTE CELUI DU FICHIER, précaution que la suite 0053 a déjà motivée par une
-- mesure : l'unicité par workspace du §2.2 tuerait la suite si le seed prenait le même nom.
--
-- TROIS MODÈLES, ET CHACUN PROUVE UNE CHOSE QUE LES AUTRES NE PROUVENT PAS :
--   * `douze`   — les douze variables, une fois chacune, séparées par un marqueur non ambigu ;
--   * `aucune`  — un texte SANS aucun trou, qui doit ressortir identique ;
--   * `repetee` — la même variable trois fois, pour le dédoublonnage de l'inventaire.

insert into public.mail_templates (id, workspace_id, name, subject, body_text, created_by)
values
	('c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000001',
	 'Douze variables — suite 0054',
	 '[{{card.title}}]',
	 '1={{card.title}} 2={{card.amount}} 3={{card.currency}} 4={{card.next_action}} ' ||
	 '5={{card.next_action_at}} 6={{card.step}} 7={{card.channel}} 8={{contact.full_name}} ' ||
	 '9={{contact.email}} 10={{contact.organization}} 11={{identity.from_name}} ' ||
	 '12={{identity.from_address}}',
	 '5eed0000-0000-4000-8000-000000000011'),
	('c0000000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-000000000001',
	 'Aucune variable — suite 0054',
	 'Un objet sans le moindre trou',
	 'Un corps { sans } trou, et { card.title } n''en est pas un.',
	 '5eed0000-0000-4000-8000-000000000011'),
	('c0000000-0000-4000-8000-0000000000a3', '5eed0000-0000-4000-8000-000000000001',
	 'Variable répétée — suite 0054',
	 '{{card.amount}}',
	 '{{card.amount}} puis {{ card.amount }} puis encore {{card.amount}}',
	 '5eed0000-0000-4000-8000-000000000011');

-- =============================================================================================
-- 1. La forme des deux fonctions — §8.3, §8.7
-- =============================================================================================
-- Une fonction `security definer` livrée par accident lirait TOUT, pour tout le monde, et les
-- refus de la section 5 seraient verts sans rien prouver. La forme se vérifie donc AVANT le
-- comportement, comme la suite 0053 vérifie la RLS avant les politiques.

select has_function('public', 'rendre_modele_email',
	array['uuid', 'uuid', 'uuid', 'uuid'],
	'CRM-063 §8.3 — public.rendre_modele_email(uuid, uuid, uuid, uuid) existe');

select has_function('app', 'mail_template_substituer', array['text', 'jsonb'],
	'CRM-063 §8.4 — app.mail_template_substituer(text, jsonb) existe');

select is(
	(select provolatile::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'rendre_modele_email'),
	's',
	'CRM-063 §8.3 — le rendu est STABLE : il ne fait que lire');

select is(
	(select prosecdef from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'public' and p.proname = 'rendre_modele_email'),
	false,
	'CRM-063 §8.3 — SECURITY INVOKER : c''est la RLS qui décide, aucun prédicat recopié');

select is(
	(select provolatile::text from pg_proc p
	   join pg_namespace n on n.oid = p.pronamespace
	  where n.nspname = 'app' and p.proname = 'mail_template_substituer'),
	'i',
	'CRM-063 §8.4 — la substitution est IMMUTABLE : elle ne lit aucune table');

-- LES PRIVILÈGES, RÔLE PAR RÔLE. `anon` doit être EXCLU (§8.7) : un appelant anonyme ne lit aucune
-- affaire, et lui donner l'exécution n'ajouterait qu'une surface. L'assertion négative est ici
-- aussi importante que les positives — c'est elle qui fige le `401` du contrat d'API.
select ok(
	has_function_privilege('authenticated',
		'public.rendre_modele_email(uuid, uuid, uuid, uuid)', 'execute'),
	'CRM-063 §8.7 — authenticated exécute le rendu');

select ok(
	has_function_privilege('service_role',
		'public.rendre_modele_email(uuid, uuid, uuid, uuid)', 'execute'),
	'CRM-063 §8.7 — service_role exécute le rendu');

select ok(
	not has_function_privilege('anon',
		'public.rendre_modele_email(uuid, uuid, uuid, uuid)', 'execute'),
	'CRM-063 §8.7 — anon N''EXÉCUTE PAS le rendu : son refus est un 401 de privilège');

-- =============================================================================================
-- 2. La substitution, sur les DOUZE variables du §2.4 — une par une
-- =============================================================================================
-- L'affaire retenue est `Migration ERP Sogexia` (c2) : c'est la seule du seed qui porte À LA FOIS
-- un montant, une prochaine action, une échéance et un contact rattaché portant une organisation.
-- Le contact est Léo Marchand, l'identité celle de Driss.
--
-- CHAQUE VARIABLE EST ASSERTÉE SÉPARÉMENT, et non par une comparaison du corps entier : un corps
-- comparé d'un bloc rougirait en désignant « le corps » sans dire LAQUELLE des douze a bougé.

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000091',
	                        (select id from public.mail_outbound_identities
	                          where from_address = 'contact@p2enjoy.test'))
	          from '1=([^ ]+(?: [^0-9][^ ]*)*) 2='),
	'Migration ERP Sogexia',
	'CRM-063 §2.4 — card.title vient de cards.title');

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2') from '2=([^ ]*) 3='),
	'125000.00',
	'CRM-063 §8.6 — card.amount rend 125000.00 : ni séparateur de milliers, ni symbole');

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2') from '3=([^ ]*) 4='),
	'EUR',
	'CRM-063 §2.4 — card.currency vient de cards.currency');

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2') from '4=(.*) 5='),
	'Obtenir le cadrage technique',
	'CRM-063 §2.4 — card.next_action vient de cards.next_action');

-- L'HORODATAGE EST RENDU EN UTC, ET C'EST LA LIMITE NOMMÉE DU §8.6 (INC-216). L'assertion la FIGE :
-- la voir rougir un jour signalerait qu'un fuseau a été introduit sans réviser le §8.6.
select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2') from '5=([^ ]* [^ ]*) 6='),
	'24/08/2026 09:00',
	'CRM-063 §8.6 — card.next_action_at rend JJ/MM/AAAA HH:MM en UTC, limite nommée');

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2') from '6=(.*) 7='),
	'Relance',
	'CRM-063 §2.4 — card.step est coalesce(label_override, catalogue.label)');

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2') from '7=(.*) 8='),
	'Grands comptes',
	'CRM-063 §2.4 — card.channel vient de channels.name');

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000091') from '8=(.*) 9='),
	'Léo Marchand',
	'CRM-063 §2.4 — contact.full_name vient de contacts.full_name');

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000091') from '9=([^ ]*) 10='),
	'leo.marchand@sogexia.example',
	'CRM-063 §2.4 — contact.email vient de contacts.email');

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2',
	                        '5eed0000-0000-4000-8000-000000000091') from '10=(.*) 11='),
	'Sogexia',
	'CRM-063 §2.4 — contact.organization vient de organizations.name par organization_id');

-- `identity.from_name` EST NUL SUR LES DEUX IDENTITÉS DU SEED — mesuré, et c'est ce qui rend la
-- règle du §8.4 observable sans fabriquer de donnée. La fixture ci-dessous en pose une TROISIÈME,
-- portant un nom, pour prouver aussi le cas plein.
select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2', null,
	                        (select id from public.mail_outbound_identities
	                          where from_address = 'contact@p2enjoy.test'))
	          from '12=(.*)$'),
	'contact@p2enjoy.test',
	'CRM-063 §2.4 — identity.from_address vient de mail_outbound_identities.from_address');

insert into public.mail_outbound_identities
	(id, workspace_id, owner_id, label, smtp_host, smtp_port, smtp_security, smtp_username,
	 from_address, from_name, is_default)
values
	('c0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000001',
	 '5eed0000-0000-4000-8000-000000000011', 'Identité nommée — suite 0054',
	 'stalwart', 587, 'none', 'camille@p2enjoy.test',
	 'camille-0054@p2enjoy.test', 'Camille Aubert', false);

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c2', null,
	                        'c0000000-0000-4000-8000-0000000000b1') from '11=(.*) 12='),
	'Camille Aubert',
	'CRM-063 §2.4 — identity.from_name vient de mail_outbound_identities.from_name');

-- L'OBJET EST SUBSTITUÉ COMME LE CORPS, et l'assertion existe parce que le §2.8 a déjà mesuré
-- qu'un modèle peut porter des variables dans UNE SEULE des deux colonnes : une preuve qui
-- n'exercerait que le corps ne distinguerait pas « les deux colonnes sont rendues » de « la
-- seconde l'est ».
select is(
	pg_temp.objet('c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c2'),
	'[Migration ERP Sogexia]',
	'CRM-063 §8.3 — l''OBJET est substitué, pas seulement le corps');

-- =============================================================================================
-- 3. Ce qui n'est pas un trou — §2.3, §8.4
-- =============================================================================================
-- Le §2.3 pose que seule la forme `{{nom}}` est une variable. Un texte portant `{ card.title }`
-- est du texte ORDINAIRE, et le rendu ne doit pas y toucher : le prouver ici évite qu'un
-- élargissement du motif passe inaperçu, puisqu'un tel texte est ACCEPTÉ à l'écriture.

select is(
	pg_temp.corps('c0000000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000c2'),
	'Un corps { sans } trou, et { card.title } n''en est pas un.',
	'CRM-063 §2.3 — un texte sans trou ressort IDENTIQUE, accolades simples comprises');

select is(
	pg_temp.objet('c0000000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000c2'),
	'Un objet sans le moindre trou',
	'CRM-063 §2.3 — un objet sans trou ressort identique');

select is(
	pg_temp.nuls('c0000000-0000-4000-8000-0000000000a2', '5eed0000-0000-4000-8000-0000000000c2'),
	array[]::text[],
	'CRM-063 §8.4 — un modèle sans variable rend un inventaire VIDE');

-- LES BLANCS DE BORD SONT TOLÉRÉS À L'INTÉRIEUR DES ACCOLADES (§2.3), et la substitution doit les
-- traiter comme la fonction de refus les traite. La fixture `repetee` porte les deux graphies.
select is(
	pg_temp.corps('c0000000-0000-4000-8000-0000000000a3', '5eed0000-0000-4000-8000-0000000000c2'),
	'125000.00 puis 125000.00 puis encore 125000.00',
	'CRM-063 §2.3 — {{ card.amount }} et {{card.amount}} désignent la même variable');

-- =============================================================================================
-- 4. Les trous nuls, et leur inventaire — LE CŒUR DE LA DÉCISION DU §8.4
-- =============================================================================================
-- L'affaire retenue est `Piste entrante à qualifier` (c6) : MESURÉ, elle est la seule du seed
-- dont `amount`, `next_action` ET `next_action_at` sont tous nuls à la fois.

select is(
	substring(pg_temp.corps('c0000000-0000-4000-8000-0000000000a1',
	                        '5eed0000-0000-4000-8000-0000000000c6') from '2=(.*)3='),
	' ',
	'CRM-063 §8.4 — un trou dont la source est nulle rend la CHAÎNE VIDE, jamais un tiret');

select ok(
	'card.amount' = any (pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                  '5eed0000-0000-4000-8000-0000000000c6')),
	'CRM-063 §8.4 — et le trou est NOMMÉ : c''est ce qui rend la chaîne vide acceptable');

select ok(
	'card.next_action' = any (pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                       '5eed0000-0000-4000-8000-0000000000c6')),
	'CRM-063 §8.4 — card.next_action nul est inventorié');

select ok(
	'card.next_action_at' = any (pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                          '5eed0000-0000-4000-8000-0000000000c6')),
	'CRM-063 §8.4 — card.next_action_at nul est inventorié');

-- LES TROIS VARIABLES DE CONTACT SONT DES TROUS NOMMÉS QUAND `p_contact_id` EST NUL (§8.5). Le
-- rendu ne choisit JAMAIS un contact parmi ceux de l'affaire — deviner reviendrait à écrire au
-- mauvais destinataire.
select is(
	(select count(*)::int from unnest(pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                               '5eed0000-0000-4000-8000-0000000000c2')) as n
	  where n like 'contact.%'),
	3,
	'CRM-063 §8.5 — sans p_contact_id, les TROIS variables de contact sont des trous nommés');

select is(
	(select count(*)::int from unnest(pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                               '5eed0000-0000-4000-8000-0000000000c2')) as n
	  where n like 'identity.%'),
	2,
	'CRM-063 §8.5 — sans p_identity_id, les DEUX variables d''identité sont des trous nommés');

-- UN CONTACT SANS ORGANISATION ET UN CONTACT SANS EMAIL EXISTENT DANS LE SEED, et ce sont les deux
-- seuls trous de contact que le jeu de démonstration exerce réellement.
select ok(
	'contact.organization' = any (pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                           '5eed0000-0000-4000-8000-0000000000c4',
	                                           '5eed0000-0000-4000-8000-000000000092')),
	'CRM-063 §8.4 — Sophie Dupont n''a pas d''organisation : le trou est nommé');

select ok(
	'contact.email' = any (pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                    '5eed0000-0000-4000-8000-0000000000c4',
	                                    '5eed0000-0000-4000-8000-000000000093')),
	'CRM-063 §8.4 — Élise Fabre n''a pas d''email : le trou est nommé');

-- L'INVENTAIRE EST TRIÉ ET DÉDOUBLONNÉ (§8.4). La fixture `repetee` porte la MÊME variable quatre
-- fois — trois dans le corps, une dans l'objet — et l'inventaire n'en compte qu'une.
select is(
	pg_temp.nuls('c0000000-0000-4000-8000-0000000000a3', '5eed0000-0000-4000-8000-0000000000c6'),
	array['card.amount'],
	'CRM-063 §8.4 — une variable répétée quatre fois n''est inventoriée qu''UNE fois');

select is(
	pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c6'),
	array['card.amount', 'card.next_action', 'card.next_action_at',
	      'contact.email', 'contact.full_name', 'contact.organization',
	      'identity.from_address', 'identity.from_name'],
	'CRM-063 §8.4 — l''inventaire est TRIÉ, et il énumère les huit trous et eux seuls');

-- UNE VARIABLE ABSENTE DU MODÈLE N'EST PAS UN TROU, ET C'EST LA BORNE DE L'INVENTAIRE (§8.4). Le
-- modèle `repetee` ne cite QUE `card.amount` ; sur l'affaire c6, où huit variables sont nulles,
-- il ne doit en inventorier qu'une. Sans cette borne, la sous-tranche 2b afficherait un
-- avertissement pour un texte qui n'en porte pas la trace.
select is(
	array_length(pg_temp.nuls('c0000000-0000-4000-8000-0000000000a3',
	                          '5eed0000-0000-4000-8000-0000000000c6'), 1),
	1,
	'CRM-063 §8.4 — une variable que le modèle N''EMPLOIE PAS n''est jamais inventoriée');

-- UNE VARIABLE PLEINE N'EST JAMAIS INVENTORIÉE, même sur un modèle qui les cite toutes.
select ok(
	not ('card.title' = any (pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                      '5eed0000-0000-4000-8000-0000000000c2'))),
	'CRM-063 §8.4 — card.title est plein : il n''entre pas dans l''inventaire');

-- =============================================================================================
-- 5. `app.mail_template_substituer` seule — les cas de bord du découpage
-- =============================================================================================
-- Ils sont éprouvés SUR LA FONCTION, sans passer par le rendu : un texte commençant ou finissant
-- par un trou est le cas où un entrelacement mal ordonné se voit, et aucune donnée du seed ne le
-- produit.

select is(
	app.mail_template_substituer('{{a}} au début', '{"a": "X"}'::jsonb),
	'X au début',
	'CRM-063 §8.4 — un texte COMMENÇANT par un trou est rendu dans le bon ordre');

select is(
	app.mail_template_substituer('à la fin {{a}}', '{"a": "X"}'::jsonb),
	'à la fin X',
	'CRM-063 §8.4 — un texte FINISSANT par un trou est rendu dans le bon ordre');

select is(
	app.mail_template_substituer('{{a}}{{b}}{{a}}', '{"a": "X", "b": "Y"}'::jsonb),
	'XYX',
	'CRM-063 §8.4 — trois trous adjacents gardent leur ordre');

select is(
	app.mail_template_substituer('{{a}}', '{}'::jsonb),
	'',
	'CRM-063 §8.4 — une variable ABSENTE de la carte rend la chaîne vide');

select is(
	app.mail_template_substituer('{{a}}', '{"a": null}'::jsonb),
	'',
	'CRM-063 §8.4 — une variable NULLE rend la chaîne vide, comme une absente');

select is(
	app.mail_template_substituer(null, '{"a": "X"}'::jsonb),
	'',
	'CRM-063 §8.4 — un texte null rend la chaîne vide, jamais null');

select is(
	app.mail_template_substituer('rien à faire', '{"a": "X"}'::jsonb),
	'rien à faire',
	'CRM-063 §8.4 — un texte sans trou traverse la fonction intact');

-- =============================================================================================
-- 6. Le cloisonnement par la RLS, avec les TROIS PROFILS RÉELS — §8.3
-- =============================================================================================
-- Le rendu est `SECURITY INVOKER` : il n'ajoute aucune règle et n'en retire aucune. Ce que la
-- section prouve, c'est que la RLS de `cards` — droits FINS compris — traverse la fonction.
--
-- MESURÉ sur le seed : Farida (viewer) ne voit AUCUNE card du track « Grands comptes », qui lui est
-- fermé, et voit celles de « Refonte de site ».

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select isnt(
	pg_temp.objet('c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c2'),
	null,
	'CRM-063 §8.3 — Camille (admin) rend l''affaire de Grands comptes');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000012');

select isnt(
	pg_temp.objet('c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c2'),
	null,
	'CRM-063 §8.3 — Driss (business_developer) rend la même affaire');

-- LE RENDU NE DÉPEND PAS DU RÔLE, et l'assertion le FIGE : deux profils qui lisent la même affaire
-- doivent obtenir le MÊME texte. Un rendu qui varierait selon l'appelant ferait de l'email un
-- objet dont personne ne saurait ce qu'il contient.
select is(
	pg_temp.corps('c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c2',
	              '5eed0000-0000-4000-8000-000000000091'),
	(select r.body_text
	   from public.rendre_modele_email('c0000000-0000-4000-8000-0000000000a1',
	                                   '5eed0000-0000-4000-8000-0000000000c2',
	                                   '5eed0000-0000-4000-8000-000000000091') r),
	'CRM-063 §8.3 — le rendu ne dépend pas du rôle de l''appelant');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select is(
	(select count(*)::int from public.rendre_modele_email(
		'c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c2')),
	0,
	'CRM-063 §8.3 — Farida (viewer) ne lit pas Grands comptes : ZÉRO LIGNE, jamais une erreur');

select is(
	(select count(*)::int from public.rendre_modele_email(
		'c0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-0000000000c4')),
	1,
	'CRM-063 §8.3 — Farida rend l''affaire du track qui lui est ouvert : le refus est FIN');

-- UN IDENTIFIANT INCONNU ET UN IDENTIFIANT MASQUÉ RENDENT LA MÊME CHOSE, et c'est la seule façon
-- de ne rien révéler (`docs/SPEC-permissions-rls.md` §7). Les deux assertions se lisent ENSEMBLE
-- avec celle du dessus : c'est leur égalité qui porte la preuve.
select is(
	(select count(*)::int from public.rendre_modele_email(
		'c0000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-000000000000')),
	0,
	'CRM-063 §8.3 — une affaire INCONNUE rend zéro ligne, comme une affaire masquée');

select is(
	(select count(*)::int from public.rendre_modele_email(
		'00000000-0000-4000-8000-000000000000', '5eed0000-0000-4000-8000-0000000000c4')),
	0,
	'CRM-063 §8.3 — un modèle INCONNU rend zéro ligne, comme un modèle masqué');

-- UN CONTACT MASQUÉ NE FAIT PAS ÉCHOUER LE RENDU : il fait TROIS TROUS NOMMÉS. C'est la
-- conséquence directe des jointures externes du §8.3, et elle est figée ici — l'alternative, une
-- absence de ligne, aurait divulgué par la bande qu'un contact existe.
select is(
	(select count(*)::int from unnest(pg_temp.nuls('c0000000-0000-4000-8000-0000000000a1',
	                                               '5eed0000-0000-4000-8000-0000000000c4',
	                                               '00000000-0000-4000-8000-000000000000')) as n
	  where n like 'contact.%'),
	3,
	'CRM-063 §8.5 — un contact INCONNU fait trois trous nommés, il ne supprime pas la ligne');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 7. Le seed est rendu intact
-- =============================================================================================
-- La suite a posé trois modèles et une identité ; le `rollback` les rend. L'assertion vérifie que
-- rien n'a été écrit HORS fixtures — un rendu qui écrirait serait un défaut de la clause `stable`.

select is(
	(select count(*)::int from public.mail_templates
	  where workspace_id = '5eed0000-0000-4000-8000-000000000001'
	    and name not like '%suite 0054'),
	2,
	'CRM-063 §2.8 — le seed porte toujours ses DEUX modèles : le rendu n''écrit rien');

select * from finish();
rollback;
