-- @verifies CRM-063 (docs/BACKLOG.md) — modèles d'emails, signatures, séquences de relance,
--           TRANCHE 4, SOUS-TRANCHE 4b : l'armement et l'exécution
-- @verifies docs/SPEC-modeles-emails.md §12.2 (qui arme, et l'unicité de l'inscription active),
--           §12.3 (`card_sequence_enrollments` — colonnes, contraintes, clés étrangères),
--           §12.4 (les huit refus de l'armement), §12.4 bis (ce qui fait tomber le refus g),
--           §12.5 (quand un palier est dû), §12.6 (ce qu'une réponse produit et son ancre),
--           §12.7 (les quatre fins), §12.8 (`app.mail_outbox_inserer`), §12.9 (le job),
--           §12.10 (autorisations)
-- @verifies docs/SPEC-relances.md §2.4 (les trois exclusions de `cards_figees`), §9.5 (l'acteur nul)
-- @verifies docs/SCHEMA.md §7 (`card_sequence_enrollments`)
--
-- CE QUE CETTE SUITE PROUVE, ET DANS QUEL ORDRE.
--
-- 1. La FORME de la table et l'activation de la RLS. Une table livrée sans RLS serait ouverte à
--    tout porteur de jeton, et le reste de la suite mesurerait des refus imaginaires.
--
-- 2. LES DÉCISIONS DE FORME, figées par des assertions plutôt que laissées au commentaire : aucune
--    colonne `next_due_at` (§12.3), et `status` borné à DEUX valeurs (§12.7). Les voir rougir un
--    jour signalerait qu'une colonne a été ajoutée sans réviser le §12.
--
-- 3. LES HUIT REFUS DE L'ARMEMENT, chacun PRÉCÉDÉ DE SON TÉMOIN. Un refus vert sur une absence ne
--    prouve rien : le témoin établit que le même geste passe quand la seule condition testée est
--    levée.
--
-- 4. LES QUATRE FINS DU §12.7, chacune PRODUITE et non simulée — une réponse réellement insérée,
--    un déplacement d'étape réellement joué, le geste réellement posé, la cadence réellement
--    épuisée. Écrire `closed_reason` à la main aurait prouvé la contrainte, pas le comportement.
--
-- 5. LE DÉLAI RELATIF DU §12.5, éprouvé sur des inscriptions ANTIDATÉES : un palier dû part, un
--    palier non échu ne part pas, et un seul palier part par passage.
--
-- 6. QUE `app.mail_outbox_inserer` EST LA SEULE LIGNE D'INSERTION (§12.8) : les deux chemins —
--    la porte humaine et le job — mettent en file le MÊME corps signé. C'est l'assertion qui
--    verrait la règle du §10.3 diverger le jour où quelqu'un réécrirait un second `insert`.
--
-- L'ACTEUR EST NUL POUR LE JOB (§9.5 de `docs/SPEC-relances.md`) : `mail_outbox.created_by` est
-- nulle sur ce que le job met en file, et non nulle sur ce que la porte humaine y met. Les deux
-- assertions sont posées ensemble ; l'une sans l'autre ne dirait pas que la nullité est OBTENUE.

begin;

create extension if not exists pgtap with schema extensions;

select plan(47);

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
-- LE NOM DES FIXTURES PORTE CELUI DU FICHIER, précaution MESURÉE par la suite 0047 : une fixture
-- portant un nom que le seed prendrait ensuite tuerait la suite à sa première insertion, l'unicité
-- par workspace du §11.3 s'y opposant.

insert into public.mail_templates (id, workspace_id, name, subject, body_text)
values ('d0000000-0000-4000-8000-0000000000a1', '5eed0000-0000-4000-8000-000000000001',
        'Modèle d''essai de la suite 0058', 'Objet 0058', 'Un corps sans variable.');

-- Une cadence à DEUX paliers : le premier à 3 jours, le second à 7 jours DEPUIS LE PREMIER. Deux
-- suffisent ici — l'épuisement se prouve en atteignant le dernier, quel que soit son rang.
insert into public.mail_sequences (id, workspace_id, name)
values ('d0000000-0000-4000-8000-0000000000b1', '5eed0000-0000-4000-8000-000000000001',
        'Séquence d''essai de la suite 0058');

insert into public.mail_sequence_steps (id, workspace_id, sequence_id, position, delai_jours, template_id)
values
	('d0000000-0000-4000-8000-0000000000c1', '5eed0000-0000-4000-8000-000000000001',
	 'd0000000-0000-4000-8000-0000000000b1', 1, 3, 'd0000000-0000-4000-8000-0000000000a1'),
	('d0000000-0000-4000-8000-0000000000c2', '5eed0000-0000-4000-8000-000000000001',
	 'd0000000-0000-4000-8000-0000000000b1', 2, 7, 'd0000000-0000-4000-8000-0000000000a1');

-- Une cadence VIDE : témoin inverse du refus (d) du §12.4.
insert into public.mail_sequences (id, workspace_id, name)
values ('d0000000-0000-4000-8000-0000000000b2', '5eed0000-0000-4000-8000-000000000001',
        'Cadence vide de la suite 0058');

-- =============================================================================================
-- 1. La forme de la table, la RLS, et les décisions de forme — §12.3, §12.7, §12.10
-- =============================================================================================

select has_table('public', 'card_sequence_enrollments',
	'1. `public.card_sequence_enrollments` existe — docs/SCHEMA.md §7 l''annonçait depuis CRM-000');

select is(
	(select relrowsecurity from pg_class where oid = 'public.card_sequence_enrollments'::regclass),
	true,
	'2. La RLS est ACTIVÉE — sans elle, tous les refus de cette suite seraient imaginaires');

select has_column('public', 'card_sequence_enrollments', 'armed_at',
	'3. `armed_at` — ancre du premier palier ET borne de la détection de réponse (§12.6)');

select has_column('public', 'card_sequence_enrollments', 'identity_id',
	'4. `identity_id` — la séquence n''en porte aucune, l''armement la choisit (§11.2, §12.2)');

-- DÉCISION DE FORME FIGÉE : l'échéance se DÉRIVE, elle ne se stocke pas. Une colonne recopiée
-- serait la seconde source de vérité que le §9.4 de docs/SPEC-relances.md a déjà refusée.
select hasnt_column('public', 'card_sequence_enrollments', 'next_due_at',
	'5. AUCUNE colonne `next_due_at` — l''échéance se dérive de `last_sent_at` et du délai (§12.3)');

select has_index('public', 'card_sequence_enrollments', 'card_sequence_enrollments_active_unique',
	'6. L''index unique PARTIEL existe — UNE seule inscription active par affaire (§12.2)');

select is(
	(select indpred is not null from pg_index
	  where indexrelid = 'public.card_sequence_enrollments_active_unique'::regclass),
	true,
	'7. Il est bien PARTIEL — l''histoire d''une affaire peut compter plusieurs inscriptions fermées');

-- =============================================================================================
-- 2. Les privilèges — l'écriture directe est fermée à TOUT LE MONDE — §12.10
-- =============================================================================================
-- C'est la fermeture de `mail_outbox`, et pour la même raison : une file d'envoi que le client
-- écrirait lui-même n'aurait plus aucun refus.

select ok(
	has_table_privilege('authenticated', 'public.card_sequence_enrollments', 'SELECT'),
	'8. `authenticated` LIT — la politique décide ensuite quelles lignes');

select ok(
	not has_table_privilege('authenticated', 'public.card_sequence_enrollments', 'INSERT'),
	'9. `authenticated` n''INSÈRE pas — `armer_sequence_relance` est la seule porte (§12.10)');

select ok(
	not has_table_privilege('authenticated', 'public.card_sequence_enrollments', 'UPDATE'),
	'10. `authenticated` ne MET PAS À JOUR — le geste et le job sont les seules voies');

select ok(
	not has_table_privilege('authenticated', 'public.card_sequence_enrollments', 'DELETE'),
	'11. `authenticated` ne SUPPRIME pas — une inscription est une trace, on la ferme');

select ok(
	not has_function_privilege('authenticated', 'app.executer_sequences_relance()', 'EXECUTE'),
	'12. Aucun client ne déclenche le job — la relance est un fait de l''horloge (§12.9)');

select ok(
	not has_function_privilege('service_role',
		'app.mail_outbox_inserer(uuid,uuid,uuid,uuid,text[],text[],text,text,text,uuid)', 'EXECUTE'),
	'13. La porte extraite est fermée aux QUATRE rôles — elle vit dans `app` (§12.8)');

select ok(
	has_function_privilege('authenticated', 'public.armer_sequence_relance(uuid,uuid,uuid)', 'EXECUTE'),
	'14. `armer_sequence_relance` est exécutable par un porteur de jeton');

-- =============================================================================================
-- 3. Les huit refus de l'armement, CHACUN PRÉCÉDÉ DE SON TÉMOIN — §12.4
-- =============================================================================================
-- Le montage : une affaire figée du seed, vue par l'administratrice, et l'identité de SERVICE
-- qu'elle seule peut emprunter.
--
-- « Refonte intranet Ville de Lyon » est figée depuis trente-cinq jours dans le seed. La suite ne
-- la vieillit pas : elle CONSTATE d'abord qu'elle l'est, sans quoi tous les refus suivants
-- pourraient tomber pour la mauvaise raison.

select ok(
	exists (select 1 from public.cards_figees() f
	         where f.card_id = '5eed0000-0000-4000-8000-0000000000c4'),
	'15. TÉMOIN DE MONTAGE : l''affaire d''essai est bien figée au sens de `cards_figees()`');

-- L'IDENTITÉ DE SERVICE N'A PAS D'IDENTIFIANT STABLE DANS LE SEED : elle est capturée ici, en
-- propriétaire, dans un GUC de session. MESURÉ : lue depuis `anon`, la sous-requête meurt en
-- « permission denied for table mail_outbound_identities » AVANT d'atteindre la fonction, et
-- l'assertion (a) mesurerait alors le privilège de table au lieu du premier refus.
select set_config('tests.identite_service',
	(select id::text from public.mail_outbound_identities where owner_id is null), false);

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- (a) `not_authenticated` — le geste est HUMAIN par construction. DEUX chemins mènent au refus, et
-- ils sont mesurés SÉPARÉMENT parce qu'ils ne tombent pas au même endroit :
--
--   * `anon` est arrêté par le PRIVILÈGE, avant d'entrer dans la fonction. C'est le `revoke … from
--     public, anon` de la migration, patron de `queue_outbound_email` ;
--   * `service_role`, lui, DÉTIENT le privilège — c'est la clé de service, et le sous-système
--     l'emprunte légitimement. C'est là, et là seulement, que le premier refus travaille.
--
-- Écrire une seule assertion aurait laissé croire que le refus (a) protège le chemin `anon` : il ne
-- le protège pas, le privilège l'ayant déjà fermé. Les deux rendent `42501`, et un client ne voit
-- donc aucune différence — mais le dépôt, lui, doit savoir laquelle des deux gardes tient.
select pg_temp.anonyme();
select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c4'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     current_setting('tests.identite_service')::uuid) $$,
	'42501',
	'permission denied for function armer_sequence_relance',
	'16. REFUS (a), chemin `anon` — arrêté par le PRIVILÈGE, avant même d''entrer dans la fonction');

select pg_temp.redevenir_proprietaire();
set local role service_role;
select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c4'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     current_setting('tests.identite_service')::uuid) $$,
	'42501',
	'not_authenticated',
	'17. REFUS (a), chemin `service_role` — le privilège passe, le PREMIER REFUS travaille (§12.4)');
select pg_temp.redevenir_proprietaire();

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

-- (e) `identity_not_available` — l'identité doit être empruntable
select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c4'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     '00000000-0000-4000-8000-000000000000'::uuid) $$,
	'42501',
	'identity_not_available',
	'18. REFUS (e) — une identité inconnue est refusée');

-- (c) `sequence_not_available` — la séquence doit exister dans le workspace de l'identité
select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c4'::uuid,
	     '00000000-0000-4000-8000-000000000000'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'23514',
	'sequence_not_available',
	'19. REFUS (c) — une séquence inconnue est refusée');

-- (d) `sequence_empty` — une cadence sans palier n'enverrait jamais rien
select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c4'::uuid,
	     'd0000000-0000-4000-8000-0000000000b2'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'23514',
	'sequence_empty',
	'20. REFUS (d) — une cadence VIDE est refusée : l''inscription serait un objet mort');

-- TÉMOIN de (d) : le MÊME geste, avec la MÊME affaire, passe dès que la cadence porte un palier.
-- C'est ce témoin qui établit que le refus 19 tient à la cadence et non à autre chose.
select lives_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c4'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'21. TÉMOIN de (d) — la MÊME affaire, avec une cadence GARNIE : l''armement passe');

-- (h) `enrollment_exists` — UNE seule inscription active par affaire
select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c4'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'23505',
	'enrollment_exists',
	'22. REFUS (h) — une SECONDE inscription active sur la même affaire est refusée (§12.2)');

-- TÉMOIN de (h) : une AUTRE affaire figée s'arme sans difficulté — l'unicité est PAR AFFAIRE,
-- jamais globale.
select lives_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000cf'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'23. TÉMOIN de (h) — une AUTRE affaire figée s''arme : l''unicité est par affaire');

select pg_temp.redevenir_proprietaire();

-- (f) `card_not_stalled` — l'affaire doit être figée, et le TÉMOIN est la MÊME affaire vieillie.
-- `entered_step_at` est fermée en écriture à `authenticated` : le vieillissement se fait ici, en
-- propriétaire, ce qui est aussi une mesure du produit.
select ok(
	not exists (select 1 from public.cards_figees() f
	             where f.card_id = '5eed0000-0000-4000-8000-00000000d010'),
	'24. TÉMOIN DE MONTAGE : l''affaire du refus (f) n''est PAS figée avant vieillissement');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-00000000d010'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'23514',
	'card_not_stalled',
	'25. REFUS (f) — une affaire NON figée est refusée (§12.2)');

select pg_temp.redevenir_proprietaire();
update public.cards set entered_step_at = now() - interval '90 days'
 where id = '5eed0000-0000-4000-8000-00000000d010';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-00000000d010'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'26. TÉMOIN de (f) — la MÊME affaire, vieillie de 90 jours, s''arme : le refus tenait au gel');

-- (g) `card_not_available` — et ce qui le fait tomber est MESURÉ au §12.4 bis : ce n'est PAS
-- `email_local_part`, qui porte une contrainte `not null`, mais `inbound_domain`, qui est nullable
-- et fait rendre NULL à la concaténation. INC-220 porte la moitié morte de la condition.
select pg_temp.redevenir_proprietaire();
update public.workspaces set inbound_domain = null
 where id = '5eed0000-0000-4000-8000-000000000001';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c3'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'23514',
	'card_not_available',
	'27. REFUS (g) — l''adresse de réponse ne se compose pas : `inbound_domain` nul (§12.4 bis)');

select pg_temp.redevenir_proprietaire();
update public.workspaces set inbound_domain = 'exemple.test'
 where id = '5eed0000-0000-4000-8000-000000000001';
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c3'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'28. TÉMOIN de (g) — le domaine rétabli, la MÊME affaire s''arme');

-- (b) `forbidden` — le droit d'ÉCRITURE sur l'affaire est exigé. Le `viewer` du seed est fermé sur
-- le track « Grands comptes », et « Refonte intranet Ville de Lyon » y vit.
select pg_temp.endosser('5eed0000-0000-4000-8000-000000000013');

select throws_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000c4'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'42501',
	'forbidden',
	'29. REFUS (b) — sans droit d''écriture sur l''affaire, l''armement est refusé');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 4. `interrompre_sequence_relance` — le geste, son refus, et son IDEMPOTENCE — §12.4
-- =============================================================================================

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok(
	$$ select public.interrompre_sequence_relance(
	     (select id from public.card_sequence_enrollments
	       where card_id = '5eed0000-0000-4000-8000-0000000000cf' and status = 'active')) $$,
	'30. Le geste explicite ferme une inscription active');

-- LA TABLE N'EST PAS VIERGE, ET C'EST VOULU. `e2e/api/armement-sequences.spec.ts` laisse derrière
-- lui les inscriptions qu'il a FERMÉES : une inscription est une TRACE, on la ferme, on ne l'efface
-- pas (§12.10), et aucune suppression n'est exposée à personne. Les lectures qui suivent visent donc
-- LA PLUS RÉCENTE ligne de l'affaire — la sienne —, jamais « la ligne de cette affaire ».
--
-- MESURÉ : écrite sans cette précaution, l'assertion meurt en « more than one row returned by a
-- subquery » dès qu'un contrat d'API a tourné avant elle. Ce n'était pas un défaut du produit, mais
-- une suite qui supposait une table vide.
select is(
	(select status || '/' || closed_reason from public.card_sequence_enrollments
	  where card_id = '5eed0000-0000-4000-8000-0000000000cf'
	  order by created_at desc limit 1),
	'closed/manual',
	'31. FIN 3 sur 4 — `manual` : l''inscription est fermée et le motif la nomme (§12.7)');

-- IDEMPOTENTE : un geste que l'on peut poser deux fois sans le savoir — deux onglets, un double
-- clic. Ce n'est PAS un `try/catch` vide : rien n'est masqué, la ligne est déjà dans l'état demandé.
select lives_ok(
	$$ select public.interrompre_sequence_relance(
	     (select id from public.card_sequence_enrollments
	       where card_id = '5eed0000-0000-4000-8000-0000000000cf'
	       order by created_at desc limit 1)) $$,
	'32. IDEMPOTENTE — fermer une inscription déjà fermée ne lève RIEN');

select is(
	(select closed_reason from public.card_sequence_enrollments
	  where card_id = '5eed0000-0000-4000-8000-0000000000cf'
	  order by created_at desc limit 1),
	'manual',
	'33. Et la ligne est INCHANGÉE — le second geste n''a rien réécrit');

-- UNE INSCRIPTION FERMÉE N'EST JAMAIS ROUVERTE : réarmer, c'est armer DE NOUVEAU (§12.7).
select lives_ok(
	$$ select public.armer_sequence_relance(
	     '5eed0000-0000-4000-8000-0000000000cf'::uuid,
	     'd0000000-0000-4000-8000-0000000000b1'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null)) $$,
	'34. Après fermeture, la MÊME affaire se réarme — une NOUVELLE inscription, jamais la même');

-- Introuvable et interdite rendent le MÊME refus : les distinguer dirait à qui n'a pas le droit de
-- lire qu'une ligne existe.
select throws_ok(
	$$ select public.interrompre_sequence_relance('00000000-0000-4000-8000-000000000000'::uuid) $$,
	'42501',
	'forbidden',
	'35. Une inscription INTROUVABLE rend le MÊME refus qu''une inscription interdite');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- 5. Le job — les fins `reply` et `card_ineligible`, PRODUITES et non simulées — §12.6, §12.7
-- =============================================================================================
-- L'ORDRE DU PASSAGE EST FERMER D'ABORD, ENVOYER ENSUITE. Les deux inscriptions ci-dessous sont
-- antidatées de dix jours : leur palier 1, dû à trois jours, PARTIRAIT si la fermeture ne le
-- devançait pas. C'est précisément ce que ces assertions mesurent.

update public.card_sequence_enrollments set armed_at = now() - interval '10 days'
 where status = 'active';

-- Une RÉPONSE, réellement insérée : un message entrant postérieur à l'armement. L'ancre est
-- `created_at` et NON `sent_at` (§12.6), et la mesure du §12.1 l'impose — `sent_at` est nulle sur
-- les quatre messages du seed.
insert into public.mail_messages (
	workspace_id, rfc822_message_id, direction, card_id, classification,
	from_address, to_addresses, subject, body_text)
values ('5eed0000-0000-4000-8000-000000000001', 'suite-0058-reponse@exemple.test', 'inbound',
        '5eed0000-0000-4000-8000-0000000000c3', 'manual',
        'client@exemple.test', array['nous@exemple.test'], 'Re: votre message', 'Je reviens vers vous.');

-- UNE INÉLIGIBILITÉ, réellement produite : l'affaire est déplacée d'étape, donc `entered_step_at`
-- retombe à `now()` et elle sort de `cards_figees()`. Aucun prédicat n'est réécrit ici (§12.7).
update public.cards set entered_step_at = now()
 where id = '5eed0000-0000-4000-8000-00000000d010';

select ok(
	not exists (select 1 from public.cards_figees() f
	             where f.card_id = '5eed0000-0000-4000-8000-00000000d010'),
	'36. TÉMOIN — l''affaire déplacée est SORTIE de `cards_figees()` : un prédicat, quatre fins');

select lives_ok(
	$$ select app.executer_sequences_relance() $$,
	'37. Le job passe');

select is(
	(select status || '/' || closed_reason from public.card_sequence_enrollments
	  where card_id = '5eed0000-0000-4000-8000-0000000000c3' and status = 'closed'
	  order by created_at desc limit 1),
	'closed/reply',
	'38. FIN 1 sur 4 — `reply` : une réponse TERMINE l''inscription (§12.6)');

select is(
	(select last_position from public.card_sequence_enrollments
	  where card_id = '5eed0000-0000-4000-8000-0000000000c3'
	  order by created_at desc limit 1),
	null,
	'39. Et AUCUN palier n''est parti — fermer précède envoyer, sinon on relance qui a répondu');

select is(
	(select status || '/' || closed_reason from public.card_sequence_enrollments
	  where card_id = '5eed0000-0000-4000-8000-00000000d010' and status = 'closed'
	  order by created_at desc limit 1),
	'closed/card_ineligible',
	'40. FIN 2 sur 4 — `card_ineligible` : sortir de `cards_figees()` termine l''inscription');

-- =============================================================================================
-- 6. Le délai relatif, et l'épuisement — §12.5, §12.7
-- =============================================================================================
-- L'inscription de « Refonte intranet Ville de Lyon », armée il y a dix jours, a reçu son palier 1
-- au passage précédent : trois jours étaient écoulés.

select is(
	(select last_position from public.card_sequence_enrollments
	  where card_id = '5eed0000-0000-4000-8000-0000000000c4' and status = 'active'
	  order by created_at desc limit 1),
	1,
	'41. Le palier 1 est parti — trois jours écoulés depuis l''armement (§12.5)');

-- UN SEUL PALIER PAR PASSAGE : le palier 2 exige SEPT jours depuis le palier 1, qui vient de
-- partir. Un second passage IMMÉDIAT ne doit donc rien envoyer.
select is(
	(select app.executer_sequences_relance()),
	0,
	'42. Un passage IMMÉDIAT n''envoie RIEN — le palier 2 n''est pas dû (§12.5)');

-- Le délai se compte DEPUIS LE PALIER PRÉCÉDENT (§11.4) : on antidate `last_sent_at` de huit jours.
update public.card_sequence_enrollments set last_sent_at = now() - interval '8 days'
 where card_id = '5eed0000-0000-4000-8000-0000000000c4' and status = 'active';

select is(
	(select app.executer_sequences_relance()),
	1,
	'43. Le palier 2 part — sept jours écoulés DEPUIS LE PALIER 1, jamais depuis l''armement');

select is(
	(select status || '/' || closed_reason from public.card_sequence_enrollments
	  where card_id = '5eed0000-0000-4000-8000-0000000000c4' and status = 'closed'
	  order by created_at desc limit 1),
	'closed/exhausted',
	'44. FIN 4 sur 4 — `exhausted` : le DERNIER palier expédié ferme l''inscription (§12.7)');

-- =============================================================================================
-- 7. `app.mail_outbox_inserer` est la SEULE ligne d'insertion — §12.8, §9.5
-- =============================================================================================
-- L'ACTEUR EST NUL POUR LE JOB, ET IL EST OBTENU PLUTÔT QU'AFFECTÉ. Les deux assertions vont
-- ENSEMBLE : la première seule ne dirait pas que la colonne sait porter autre chose que `null`.

-- LA RÈGLE EST « AUCUN message du job ne porte d'auteur », et elle est écrite ainsi plutôt qu'en
-- comptant les messages : un compte figé rougirait le jour où la suite ferait partir un palier de
-- plus, sans que la règle ait bougé d'un iota.
select is(
	(select count(*)::integer from public.mail_outbox
	  where created_by is not null and created_at >= (select min(armed_at) from public.card_sequence_enrollments)),
	0,
	'45. AUCUN message mis en file par le job ne porte d''auteur — l''acteur est obtenu (§9.5)');

select pg_temp.endosser('5eed0000-0000-4000-8000-000000000011');

select lives_ok(
	$$ select public.queue_outbound_email(
	     '5eed0000-0000-4000-8000-0000000000cf'::uuid,
	     (select id from public.mail_outbound_identities where owner_id is null),
	     array['destinataire@exemple.test'], 'Objet humain', 'Corps humain.') $$,
	'46. La porte HUMAINE met toujours en file — ses sept refus sont intacts après extraction');

select is(
	(select created_by from public.mail_outbox where subject = 'Objet humain'),
	'5eed0000-0000-4000-8000-000000000011'::uuid,
	'47. Et SON message porte l''appelant — la nullité du job n''est donc pas un défaut de colonne');

select pg_temp.redevenir_proprietaire();

-- =============================================================================================
-- Toutes les écritures de cette suite vivent dans la transaction, que le `rollback` défait.

select * from finish();

rollback;
