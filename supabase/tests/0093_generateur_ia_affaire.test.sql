-- @verifies CRM-113 (docs/BACKLOG.md) — tranche T1 : le générateur de workflow connaît les champs natifs de l'affaire et
--           réutilise le catalogue sous un libellé surchargé — la base
-- @verifies docs/SPEC-ia.md §14.3 (la forme de `libelle` et `probabilite` d'une étape, `step_probability_invalid`, la
--           règle d'écriture des surcharges à la création et à la modification), §14.4 (la composition vivante rend
--           les noms effectifs), §14.5 (`native_field` par la clé et par le libellé normalisé, comparaison exacte, un
--           champ vivant conservé épargné ; `app.reserved_native_fields()`) ; docs/SCHEMA.md « Migration `0102` » ;
--           docs/JOURNAL.md décisions 646 et 677
-- @verifies CLAUDE.md §10 (la règle d'écriture n'est pas exposée aux clients ; la liste réservée ne l'est pas à `anon`)
--
-- Tout se joue dans une transaction annulée, sur un espace créé ici : la création, puis une modification du
-- workflow créé, sans aucune affaire.

begin;

create extension if not exists pgtap with schema extensions;

select plan(32);

create or replace function pg_temp.endosser(utilisateur uuid)
returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims',
		jsonb_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end;
$$;

create temporary table ids (nom text primary key, valeur uuid not null) on commit drop;
insert into ids values
	('W',   '0c113000-0000-4000-8000-0000000000e1'),
	('ADM', '0c113000-0000-4000-8000-000000000011');
grant select on ids to authenticated, service_role;
create or replace function pg_temp.id(nom text) returns uuid
language sql stable as $$ select valeur from ids where ids.nom = $1 $$;

create temporary table mesures (cle text primary key, valeur text) on commit drop;
grant all on mesures to authenticated, service_role;
create or replace function pg_temp.m(cle text) returns uuid
language sql stable as $$ select valeur::uuid from mesures where mesures.cle = $1 $$;

insert into public.workspaces (id, name, slug) values (pg_temp.id('W'), 'Espace 0093', 'espace-0093');
insert into public.profiles (id, full_name) values (pg_temp.id('ADM'), 'Administratrice 0093');
insert into public.workspace_members (workspace_id, user_id, role) values (pg_temp.id('W'), pg_temp.id('ADM'), 'admin');

-- Le catalogue de l'espace : trois nœuds vivants, avec leur probabilité par défaut.
insert into public.workflow_nodes_catalog (workspace_id, key, label, kind, color, default_probability) values
	(pg_temp.id('W'), 'prospection', 'Prospection', 'open', 'brand', 30),
	(pg_temp.id('W'), 'gagne', 'Gagné', 'won', 'success', 100),
	(pg_temp.id('W'), 'relance', 'Relance', 'open', 'brand', 20);

-- Une création : une étape du catalogue renommée, une étape du catalogue sous son propre nom (espaces de bord
-- compris), une étape d'un nœud proposé dont le libellé ne diffère que par la casse.
create or replace function pg_temp.base() returns jsonb language sql immutable as $$
	select '{"version": 1, "workflow": {"nom": "Ventes 0093"},
	  "noeuds": [{"cle": "perdu-x", "libelle": "Perdu", "nature": "lost", "probabilite": 0}],
	  "etapes": [{"noeud": "prospection", "initiale": true, "libelle": "Qualification", "probabilite": 40},
	             {"noeud": "gagne", "initiale": false, "libelle": "  Gagné  ", "probabilite": 100},
	             {"noeud": "perdu-x", "initiale": false, "libelle": "perdu"}],
	  "transitions": [{"de": "prospection", "vers": "gagne", "libelle": "Gagner", "commentaire_requis": false},
	                  {"de": "prospection", "vers": "perdu-x", "libelle": "Perdre", "commentaire_requis": true}],
	  "champs": [{"cle": "canal", "libelle": "Canal", "type": "text", "choix": null, "devise": null, "aide": null}],
	  "regles": [], "exigences": []}'::jsonb
$$;
create or replace function pg_temp.codes(p jsonb, workflow uuid default null) returns text language sql as $$
	select coalesce(string_agg(d ->> 'code', ',' order by o), '')
	  from jsonb_array_elements(app.defauts_proposition_ia(pg_temp.id('W'), p, workflow)) with ordinality as x(d, o)
$$;
create or replace function pg_temp.plus(p jsonb, liste text, element jsonb) returns jsonb language sql immutable as $$
	select jsonb_set(p, array[liste], (p -> liste) || jsonb_build_array(element))
$$;
-- Les surcharges d'une étape du workflow, lues par la clé de son nœud.
create or replace function pg_temp.surcharges(workflow uuid, cle text) returns text language sql as $$
	select coalesce(s.label_override, '∅') || '|' || coalesce(s.probability_override::int::text, '∅')
	  from public.workflow_steps s join public.workflow_nodes_catalog n on n.id = s.node_id
	 where s.workflow_id = workflow and n.key = cle
$$;

-- =============================================================================================
-- 1. La liste réservée, en un seul endroit
-- =============================================================================================

select is(
	(select count(*)::text || '|' || count(distinct native_field)::text from app.reserved_native_fields()),
	'35|10', '1 — la liste réservée : trente-cinq clés pour dix informations natives (§14.5)');
select is(
	(select string_agg(key || '>' || native_field, ',' order by key) from app.reserved_native_fields()
	  where key in ('montant', 'societe', 'echeance', 'interlocuteur', 'nom')),
	'echeance>next_action_at,interlocuteur>contacts,montant>amount,nom>title,societe>organization',
	'2 — chaque clé nomme l''information native qu''elle doublonne');
select ok(
	(select provolatile = 'i' from pg_proc where oid = 'app.reserved_native_fields()'::regprocedure)
	and has_function_privilege('authenticated', 'app.reserved_native_fields()', 'EXECUTE')
	and not has_function_privilege('anon', 'app.reserved_native_fields()', 'EXECUTE'),
	'3 — une donnée statique (`immutable`), lisible des membres authentifiés, fermée à `anon`');
select ok(
	not has_function_privilege('authenticated', 'app.ai_step_overrides(uuid, jsonb, text, numeric, boolean)', 'EXECUTE')
	and not has_function_privilege('anon', 'app.ai_step_overrides(uuid, jsonb, text, numeric, boolean)', 'EXECUTE'),
	'4 — la règle d''écriture des surcharges n''est appelable que par les gestes d''acceptation');

-- =============================================================================================
-- 2. La forme : `libelle` et `probabilite` d'une étape, facultatifs
-- =============================================================================================

select is(pg_temp.codes(pg_temp.base()), '', '5 — la proposition de base, qui porte les deux clés, ne porte aucun défaut');
select is(
	pg_temp.codes(jsonb_set(pg_temp.base(), '{etapes}', (select jsonb_agg(e - 'libelle' - 'probabilite' order by o)
		from jsonb_array_elements(pg_temp.base() -> 'etapes') with ordinality x(e, o)))),
	'', '6 — une révision `version: 1` antérieure, sans les deux clés, reste valide');
select is(
	pg_temp.codes(jsonb_set(jsonb_set(pg_temp.base(), '{etapes,0,libelle}', 'null'), '{etapes,0,probabilite}', 'null')),
	'', '7 — `null` est admis pour les deux clés');
select throws_ok($$select app.defauts_proposition_ia(pg_temp.id('W'), jsonb_set(pg_temp.base(), '{etapes,0,libelle}', '12'))$$,
	'22023', 'proposition mal formee', '8 — un libellé d''étape qui n''est pas un texte est une forme invalide');
select throws_ok($$select app.defauts_proposition_ia(pg_temp.id('W'), jsonb_set(pg_temp.base(), '{etapes,0,probabilite}', '"40"'))$$,
	'22023', 'proposition mal formee', '9 — une probabilité d''étape qui n''est pas un nombre est une forme invalide');

-- =============================================================================================
-- 3. `step_probability_invalid`
-- =============================================================================================

select is(app.defauts_proposition_ia(pg_temp.id('W'), jsonb_set(pg_temp.base(), '{etapes,0,probabilite}', '140')),
	'[{"code": "step_probability_invalid", "chemin": "etapes[0].probabilite", "valeurs": {"cle": "prospection"}}]'::jsonb,
	'10 — step_probability_invalid : son chemin et la clé de l''étape');
select is(pg_temp.codes(jsonb_set(pg_temp.base(), '{etapes,2,probabilite}', '-1')), 'step_probability_invalid',
	'11 — step_probability_invalid, sous zéro');
select is(pg_temp.codes(jsonb_set(jsonb_set(pg_temp.base(), '{etapes,1,initiale}', 'true'), '{etapes,0,probabilite}', '101')),
	'etape_initiale,step_probability_invalid', '12 — rendu APRÈS etape_initiale');

-- =============================================================================================
-- 4. `native_field`
-- =============================================================================================

select is(app.defauts_proposition_ia(pg_temp.id('W'), pg_temp.plus(pg_temp.base(), 'champs',
		'{"cle": "montant", "libelle": "Montant", "type": "money", "choix": null, "devise": "EUR", "aide": null}')),
	'[{"code": "native_field", "chemin": "champs[1]", "valeurs": {"cle": "montant", "native": "amount"}}]'::jsonb,
	'13 — native_field par la clé : son chemin, la clé et l''information native');
select is(app.defauts_proposition_ia(pg_temp.id('W'), pg_temp.plus(pg_temp.base(), 'champs',
		'{"cle": "client-final", "libelle": "  Société ", "type": "text", "choix": null, "devise": null, "aide": null}')),
	'[{"code": "native_field", "chemin": "champs[1]", "valeurs": {"cle": "client-final", "native": "organization"}}]'::jsonb,
	'14 — native_field par le libellé mis à la forme des clés (« Société » → societe)');
select is(pg_temp.codes(pg_temp.plus(pg_temp.plus(pg_temp.base(), 'champs',
		'{"cle": "montant-ht", "libelle": "Montant HT", "type": "number", "choix": null, "devise": null, "aide": null}'), 'champs',
		'{"cle": "valeur-a-vie", "libelle": "Valeur à vie", "type": "number", "choix": null, "devise": null, "aide": null}')),
	'', '15 — la comparaison est EXACTE : montant-ht et valeur-a-vie passent');
select is(pg_temp.codes(pg_temp.plus(pg_temp.plus(pg_temp.base(), 'champs',
		'{"cle": "devise", "libelle": "Devise", "type": "text", "choix": null, "devise": null, "aide": null}'), 'champs',
		'{"cle": "devise", "libelle": "Monnaie", "type": "text", "choix": null, "devise": null, "aide": null}')),
	'native_field,champ_en_double,native_field', '16 — rendu APRÈS champ_en_double, pour chaque champ');

-- =============================================================================================
-- 5. Accepter une création : les surcharges posées, l'égalité qui rend `null`
-- =============================================================================================

select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (insert into public.suggestions_ia (workspace_id, portee, demande) values (pg_temp.id('W'), 'workflow', 'Création 0093') returning id)
insert into mesures select 'SC', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SC'), 'correction', pg_temp.base());
insert into mesures select 'WF', public.accepter_suggestion_ia(pg_temp.m('SC'))::text;
reset role;

select is(pg_temp.surcharges(pg_temp.m('WF'), 'prospection'), 'Qualification|40',
	'17 — une étape du catalogue renommée : son nom et sa probabilité en surcharge');
select is(pg_temp.surcharges(pg_temp.m('WF'), 'gagne'), '∅|∅',
	'18 — le libellé et la probabilité du nœud, espaces de bord retirés : aucune surcharge');
select is(pg_temp.surcharges(pg_temp.m('WF'), 'perdu-x'), 'perdu|∅',
	'19 — un libellé qui ne diffère que par la casse surcharge ; une probabilité absente ne surcharge rien');

-- =============================================================================================
-- 6. La composition vivante rend les noms effectifs
-- =============================================================================================

select is(
	(select jsonb_agg(jsonb_build_object('noeud', e ->> 'noeud', 'libelle', e ->> 'libelle', 'probabilite', (e ->> 'probabilite')::numeric::int) order by o)
	   from jsonb_array_elements(public.proposition_du_workflow(pg_temp.m('WF')) -> 'etapes') with ordinality x(e, o)),
	'[{"noeud": "prospection", "libelle": "Qualification", "probabilite": 40},
	  {"noeud": "gagne", "libelle": "Gagné", "probabilite": 100},
	  {"noeud": "perdu-x", "libelle": "perdu", "probabilite": 0}]'::jsonb,
	'20 — chaque étape porte son nom et sa probabilité effectifs, surcharge sinon nœud');
select is(pg_temp.codes(public.proposition_du_workflow(pg_temp.m('WF')), pg_temp.m('WF')), '',
	'21 — la composition vivante, relue comme une cible, ne porte aucun défaut');

-- Un champ vivant qui doublonne une information native — posé à la main, comme un workflow existant peut en porter.
insert into public.form_fields (workflow_id, workspace_id, key, label, type, options, position)
values (pg_temp.m('WF'), pg_temp.id('W'), 'montant', 'Montant', 'number', '{}', 2);

select is(pg_temp.codes(public.proposition_du_workflow(pg_temp.m('WF')), pg_temp.m('WF')), '',
	'22 — un champ vivant conservé n''est jamais relevé, même s''il doublonne une information native');
select is(pg_temp.codes(pg_temp.plus(public.proposition_du_workflow(pg_temp.m('WF')), 'champs',
		'{"cle": "responsable", "libelle": "Responsable", "type": "user", "choix": null, "devise": null, "aide": null}'), pg_temp.m('WF')),
	'native_field', '23 — dans la même modification, un champ NOUVEAU qui doublonne est relevé');
select is(pg_temp.codes(public.proposition_du_workflow(pg_temp.m('WF')), null), 'native_field',
	'24 — le même champ, dans une création, est relevé : il y serait nouveau');

-- =============================================================================================
-- 7. Accepter une modification : la clé absente garde, la valeur différente pose, l'égalité retire
-- =============================================================================================

create temporary table cible as select public.proposition_du_workflow(pg_temp.m('WF')) as p;
update cible set p = jsonb_set(p, '{etapes,0}', (p -> 'etapes' -> 0) - 'libelle' || '{"probabilite": null}');
update cible set p = jsonb_set(jsonb_set(p, '{etapes,1,libelle}', '"Victoire"'), '{etapes,1,probabilite}', '90');
update cible set p = jsonb_set(p, '{etapes,2,libelle}', '"Perdu"');
update cible set p = jsonb_set(p, '{etapes}', (p -> 'etapes') || '[{"noeud": "relance", "initiale": false}]');
update cible set p = jsonb_set(p, '{transitions}', (p -> 'transitions')
	|| '[{"de": "prospection", "vers": "relance", "libelle": "Relancer", "commentaire_requis": false}]');
grant select on cible to authenticated;

select is(pg_temp.codes((select p from cible), pg_temp.m('WF')), '', '25 — la cible de la modification est conforme');

select pg_temp.endosser(pg_temp.id('ADM'));
with cree as (insert into public.suggestions_ia (workspace_id, workflow_id, portee, demande)
              values (pg_temp.id('W'), pg_temp.m('WF'), 'etapes', 'Modification 0093') returning id)
insert into mesures select 'SM', id::text from cree;
insert into public.suggestions_ia_revisions (suggestion_id, origine, proposition) values (pg_temp.m('SM'), 'correction', (select p from cible));
select is(public.accepter_suggestion_ia(pg_temp.m('SM')), pg_temp.m('WF'), '26 — l''administratrice accepte la modification');
reset role;

select is(pg_temp.surcharges(pg_temp.m('WF'), 'prospection'), 'Qualification|40',
	'27 — une étape conservée dont la cible ne dit rien (clé absente, `null`) garde ses surcharges');
select is(pg_temp.surcharges(pg_temp.m('WF'), 'gagne'), 'Victoire|90',
	'28 — une étape conservée dont la cible diffère du nœud reçoit la surcharge');
select is(pg_temp.surcharges(pg_temp.m('WF'), 'perdu-x'), '∅|∅',
	'29 — le libellé du nœud proposé retire la surcharge');
select is(pg_temp.surcharges(pg_temp.m('WF'), 'relance'), '∅|∅',
	'30 — une étape nouvelle sans libellé ni probabilité ne surcharge rien');
select is(
	(select string_agg(e ->> 'libelle', ',' order by o)
	   from jsonb_array_elements(public.proposition_du_workflow(pg_temp.m('WF')) -> 'etapes') with ordinality x(e, o)),
	'Qualification,Victoire,Perdu,Relance', '31 — relue, la composition nomme les étapes comme l''écran les montrera');
select is(
	(select key || ':' || (archived_at is null)::text from public.form_fields where workflow_id = pg_temp.m('WF') and key = 'montant'),
	'montant:true', '32 — le champ vivant qui doublonnait est conservé, actif : l''unité n''y touche pas (§14.9)');

select * from finish();
rollback;
