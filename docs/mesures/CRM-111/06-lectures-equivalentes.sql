-- @spec CRM-111 (docs/BACKLOG.md) — tranche T2.2 : MESURE, jamais une migration. Les fonctions de lecture réécrites
--       rendent-elles exactement ce qu'elles rendaient ? docs/SPEC-rattachements.md §2 bis.1, §14 ; docs/JOURNAL.md
--       (entrée « CRM-111 T2.2 »)
--
-- Mode opératoire : sur une copie JETABLE de la base de développement (§2 bis.5), jouer ce script AVANT la migration
-- 0109, puis APRÈS, et comparer les deux sorties ligne à ligne : elles doivent être identiques. Chaque ligne donne une
-- fonction, un rôle du seed et l'empreinte md5 de son résultat complet, trié. Rien n'est écrit : tout se joue dans une
-- transaction annulée, et les fonctions mesurées ne sont que des lectures.
--
-- Rôles : l'administratrice (…011), le business developer (…012), la lectrice (…013), sous `authenticated` et leur
-- jeton, comme PostgREST. Les fonctions qui écrivent (classement, file d'envoi, déclencheur du catalogue) ne sont pas
-- mesurées ici : la suite pgTAP les exerce.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
begin;

create temp table mesure (fonction text, role text, empreinte text);
grant all on mesure to authenticated;

create function pg_temp.endosser(utilisateur uuid) returns void language plpgsql as $$
begin
	perform set_config('request.jwt.claims', json_build_object('sub', utilisateur::text, 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end $$;

create function pg_temp.empreinte(requete text) returns text language plpgsql as $$
declare r text;
begin
	execute format('select md5(coalesce(string_agg(x::text, ''|'' order by x::text), ''∅'')) from (%s) x', requete) into r;
	return r;
end $$;

do $$
declare
	u record;
	requetes text[][] := array[
		['can_write_card',        'select c.id, app.can_write_card(c.id) from public.cards c'],
		['ecriture_permise',      'select c.id, c.ecriture_permise from public.cards c'],
		['occupation_du_workflow','select w.id, public.occupation_du_workflow(w.id) from public.workflows w'],
		['cards_figees',          'select * from public.cards_figees()'],
		['entonnoir_conversion',  'select * from public.entonnoir_conversion()'],
		['recherche_refonte',     'select * from public.recherche_globale(''refonte'', 50)'],
		['recherche_relancer',    'select * from public.recherche_globale(''relancer'', 50)'],
		['recherche_audit',       'select * from public.recherche_globale(''audit'', 50)'],
		['inbox_arborescence',    'select * from public.inbox_arborescence()'],
		['rendre_modele_email',   'select t.id, c.id, public.rendre_modele_email(t.id, c.id, null, null) from public.mail_templates t cross join public.cards c'],
		['previsualiser_exigence','select f.id, s.id, public.previsualiser_exigence(f.id, s.id, null) from public.form_fields f join public.workflow_steps s on s.workflow_id = f.workflow_id'],
		['plan_card_remapping',   'select v.id, public.plan_card_remapping(v.id, ''[]''::jsonb, 500) from public.workflow_versions v'],
		['rentabilite_affaires',  'select * from public.rentabilite_affaires()'],
		['temps_valorise',        'select * from public.temps_valorise(''2000-01-01'', ''2100-01-01'')']
	];
	i int;
	e text;
begin
	for u in select * from (values ('admin', '5eed0000-0000-4000-8000-000000000011'::uuid),
	                               ('bizdev', '5eed0000-0000-4000-8000-000000000012'::uuid),
	                               ('viewer', '5eed0000-0000-4000-8000-000000000013'::uuid)) as v(role, id) loop
		for i in 1 .. array_length(requetes, 1) loop
			perform pg_temp.endosser(u.id);
			begin
				e := pg_temp.empreinte(requetes[i][2]);
			exception when others then
				-- Un refus est un résultat : il doit être le MÊME avant et après.
				e := 'refus ' || sqlstate;
			end;
			execute 'reset role';
			insert into mesure values (requetes[i][1], u.role, e);
		end loop;
	end loop;
end $$;

-- Hors rôle : les deux fonctions internes, pour chaque affaire et chaque personne du seed, et l'adresse de chaque affaire.
insert into mesure
select 'can_read_card_pour', 'postgres',
       pg_temp.empreinte('select c.id, p.id, app.can_read_card_pour(c.id, p.id) from public.cards c cross join public.profiles p');
-- `chemin_dossier_card` n'est exécutable que par la clé de service (`mail-sync`) : elle est mesurée hors rôle.
insert into mesure
select 'chemin_dossier_card', 'postgres',
       pg_temp.empreinte('select c.id, public.chemin_dossier_card(c.id) from public.cards c');
insert into mesure
select 'card_par_adresse', 'postgres',
       pg_temp.empreinte($q$select c.id, app.card_par_adresse(c.workspace_id, array[c.email_local_part || '@' || w.inbound_domain])
                            from public.cards c join public.workspaces w on w.id = c.workspace_id$q$);

select fonction || ' | ' || role || ' | ' || empreinte from mesure order by fonction, role;
rollback;
