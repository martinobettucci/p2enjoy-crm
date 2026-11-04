-- @verifies CRM-112 (docs/BACKLOG.md) — tranche T5 : les champs de l'affaire dans les modèles d'email — le déclencheur qui
--           accepte `card.field.<clé>` d'un champ actif et garde la forme du refus, la valeur rendue par type, l'aperçu
--           `[libellé]`, le guichet de la palette, l'archivage qui nomme les modèles
-- @verifies docs/SPEC-champs-communs.md §9 (précision T5), §6 ; docs/SCHEMA.md « Migration `0167` » ; docs/JOURNAL.md décision 842
--
-- Les champs de sonde portent le préfixe `tst-t5-`, les modèles le nom `tst-t5` ; l'affaire `…00c2` reçoit les valeurs.
-- Le `rollback` final rend la base intacte.

begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

create temp table pg_temp.champs as
with f as (
	insert into public.card_common_fields (workspace_id, key, label, type, options) values
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-siret', 'SIRET', 'text', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-ca', 'Chiffre d''affaires', 'money', '{"currency": "EUR"}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-echeance', 'Échéance', 'date', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-secteur', 'Secteur', 'select', '{"choices": [{"key": "btp", "label": "BTP"}]}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-tags', 'Tags', 'multiselect', '{"choices": [{"key": "a", "label": "Alpha"}, {"key": "b", "label": "Bêta"}]}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-signe', 'Signé', 'checkbox', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-referent', 'Référent', 'user', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-vide', 'Vide', 'text', '{}'),
		('5eed0000-0000-4000-8000-000000000001', 'tst-t5-ancien', 'Ancien', 'text', '{}')
	returning id, key
)
select id, key from f;
create or replace function pg_temp.champ(p_cle text) returns uuid language sql as $$ select id from pg_temp.champs where key = p_cle $$;
update public.card_common_fields set archived_at = now() where id = pg_temp.champ('tst-t5-ancien');

-- --- Le contrôle à l'écriture ---------------------------------------------------------------------------------
select lives_ok(
	$$insert into public.mail_templates (id, workspace_id, name, subject, body_text)
	  values ('e1120000-0000-4000-8000-0000000005a1', '5eed0000-0000-4000-8000-000000000001', 'tst-t5 modèle',
	          'Affaire {{card.title}} — {{card.field.tst-t5-siret}}',
	          'CA {{card.field.tst-t5-ca}} ; échéance {{card.field.tst-t5-echeance}} ; secteur {{card.field.tst-t5-secteur}} ; tags {{card.field.tst-t5-tags}} ; signé {{card.field.tst-t5-signe}} ; référent {{card.field.tst-t5-referent}} ; vide [{{card.field.tst-t5-vide}}]')$$,
	'1 — les variables natives et celles des champs actifs de l''espace sont acceptées');
select throws_ok(
	$$insert into public.mail_templates (workspace_id, name, subject, body_text)
	  values ('5eed0000-0000-4000-8000-000000000001', 'tst-t5 inconnu', 'Objet {{card.field.inconnu}}', 'Corps')$$,
	'23514', 'new row for relation "mail_templates" violates check constraint "mail_templates_subject_variables"',
	'2 — une variable de champ inconnue dans l''objet : le refus garde sa forme et son nom');
select throws_ok(
	$$insert into public.mail_templates (workspace_id, name, subject, body_text)
	  values ('5eed0000-0000-4000-8000-000000000001', 'tst-t5 archivé', 'Objet', 'Corps {{card.field.tst-t5-ancien}}')$$,
	'23514', 'new row for relation "mail_templates" violates check constraint "mail_templates_body_variables"',
	'3 — un champ archivé n''est plus une variable : refus du corps, sous son nom');
select throws_ok(
	$$insert into public.mail_templates (workspace_id, name, subject, body_text)
	  values ('5eed0000-0000-4000-8000-000000000001', 'tst-t5 natif', 'Objet {{card.inconnue}}', 'Corps')$$,
	'23514', null, '4 — une variable native inconnue reste refusée');
select is((select count(*)::int from pg_constraint where conrelid = 'public.mail_templates'::regclass
            and conname in ('mail_templates_subject_variables', 'mail_templates_body_variables')), 0,
	'5 — les deux CHECK sont remplacés par le déclencheur');
-- Le contrôle porte aussi sur une mise à jour.
select throws_ok(
	$$update public.mail_templates set body_text = 'Corps {{card.field.inconnu}}' where id = 'e1120000-0000-4000-8000-0000000005a1'$$,
	'23514', null, '6 — une mise à jour est contrôlée de même');

-- --- Le rendu ---------------------------------------------------------------------------------------------------
insert into public.card_common_field_values (card_id, field_id, workspace_id, value)
select '5eed0000-0000-4000-8000-0000000000c2', pg_temp.champ(v.cle), '5eed0000-0000-4000-8000-000000000001', v.valeur::jsonb
  from (values ('tst-t5-siret', '"123 456 789"'), ('tst-t5-ca', '12500'), ('tst-t5-echeance', '"2026-03-31"'),
               ('tst-t5-secteur', '"btp"'), ('tst-t5-tags', '["a", "b"]'), ('tst-t5-signe', 'true'),
               ('tst-t5-referent', '"5eed0000-0000-4000-8000-000000000012"')) as v(cle, valeur);

create temp table pg_temp.rendu as
select * from public.rendre_modele_email('e1120000-0000-4000-8000-0000000005a1', '5eed0000-0000-4000-8000-0000000000c2');

select is((select subject from pg_temp.rendu), 'Affaire Migration ERP Sogexia — 123 456 789', '7 — un texte, tel quel, dans l''objet');
select matches((select body_text from pg_temp.rendu), 'CA 12500\.00 ;', '8 — un montant, comme card.amount');
select matches((select body_text from pg_temp.rendu), 'échéance 31/03/2026 ;', '9 — une date en JJ/MM/AAAA');
select matches((select body_text from pg_temp.rendu), 'secteur BTP ; tags Alpha, Bêta ;', '10 — un choix et des choix par leur libellé');
select matches((select body_text from pg_temp.rendu), 'signé Oui ; référent Driss Lemoine ;', '11 — une case par « Oui », une personne par son nom');
select matches((select body_text from pg_temp.rendu), 'vide \[\]$', '12 — un champ vide rend une chaîne vide');
select is((select variables_nulles from pg_temp.rendu), array['card.field.tst-t5-vide'], '13 — et le rendu le nomme parmi les variables nulles');

-- --- L'aperçu, le guichet, l'archivage -----------------------------------------------------------------------------
select is((select subject from public.render_mail_template_sample('e1120000-0000-4000-8000-0000000005a1')),
	'Affaire Projet exemple — [SIRET]', '14 — l''aperçu rend un champ par son libellé entre crochets');
select is((select label from public.mail_template_variables_espace('5eed0000-0000-4000-8000-000000000001') where name = 'card.field.tst-t5-siret'),
	'SIRET', '15 — le guichet de la palette donne la variable d''un champ et son libellé');
select is((select count(*)::int from public.mail_template_variables_espace('5eed0000-0000-4000-8000-000000000001') where name = 'card.field.tst-t5-ancien'),
	0, '16 — un champ archivé n''y paraît pas');
select throws_like(
	$$update public.card_common_fields set archived_at = now() where id = pg_temp.champ('tst-t5-siret')$$,
	'common_field_in_use', '17 — archiver un champ cité par un modèle est refusé');

select * from finish();
rollback;
