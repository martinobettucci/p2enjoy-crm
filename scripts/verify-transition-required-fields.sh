#!/usr/bin/env bash
# @verifies CRM-018 (docs/BACKLOG.md) — table de liaison des champs exigés par une transition
# @verifies docs/SPEC-transition-required-fields.md §2 à §6
# @verifies docs/PROD_MIGRATIONS.md §3 — mise à niveau et rejeu convergent
#
# Ce harnais ne démarre ni n'arrête la pile. Il dégrade réellement contraintes, trigger, politique,
# `move_card` et seed, exige que pgTAP morde, puis restaure par les chemins livrés. Toute sortie
# anticipée rejoue la migration et le seed afin de ne jamais laisser la base affaiblie.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0019_transition_required_fields.sql
TEST=supabase/tests/0021_transition_required_fields.test.sql
SEED=supabase/seed/apply-seed.sh
TRANSITION_SOURCE=5eed0000-0000-4000-8000-000000000074
CHAMP_SOURCE=5eed0000-0000-4000-8000-000000000086
WORKSPACE_CROISE=18000000-0000-4000-8000-000000000020
WORKFLOW_CROISE=18000000-0000-4000-8000-000000000021
CHAMP_CROISE=18000000-0000-4000-8000-000000000022
CHAMP_CONCURRENT=18000000-0000-4000-8000-000000000023
WORKFLOW_DERIVE=''
TRANSITION_DERIVEE=''
CHAMP_DERIVE=''
LIBELLE_CHAMP_DERIVE='Lien vers la proposition'
LIAISONS_HORS_FIXTURE=0

checks=0
failures=0
restore_needed=false
WORK=$(mktemp -d)

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

appliquer_migration() {
	psql_db --single-transaction -f - < "$MIGRATION"
}

restaurer_liaison_copie() {
	psql_db -c "insert into public.workflow_transition_required_fields (transition_id, field_id)
		values ('$TRANSITION_DERIVEE', '$CHAMP_DERIVE') on conflict do nothing;" >/dev/null 2>&1
}

restaurer() {
	set +e
	# La fixture inter-workspace n'appartient jamais au produit et doit disparaître avant que la
	# migration de secours ne relise l'ancien tableau.
	psql_db -c "delete from public.workspaces where id='$WORKSPACE_CROISE';" >/dev/null 2>&1
	psql_db -c "delete from public.workflow_transition_required_fields
		              where field_id='$CHAMP_CONCURRENT';
		            delete from public.form_fields where id='$CHAMP_CONCURRENT';
		            update public.form_fields set label='$LIBELLE_CHAMP_DERIVE'
		             where id='$CHAMP_DERIVE';" >/dev/null 2>&1
	# Si la contre-épreuve de l'ancien tableau est restée en place, elle est ramenée à une valeur
	# migrable avant le rejeu de secours. Le SQL dynamique évite de référencer une colonne absente.
	psql_db -c "do \$\$
	begin
		if exists (select 1 from pg_attribute
		            where attrelid='public.workflow_transitions'::regclass
		              and attname='require_fields' and attnum > 0 and not attisdropped) then
			execute 'update public.workflow_transitions set require_fields = ''{}''::uuid[]';
			execute 'update public.workflow_transitions set require_fields = array[''$CHAMP_SOURCE''::uuid]
			         where id = ''$TRANSITION_SOURCE''';
		end if;
	end
	\$\$;" >/dev/null 2>&1
	appliquer_migration >/dev/null 2>&1
	restaurer_liaison_copie
	"$SEED" >/dev/null 2>&1
	set -e
}

cleanup() {
	local status=$?
	trap - EXIT
	if [ "$restore_needed" = true ]; then
		restaurer || status=1
	fi
	rm -rf -- "$WORK"
	exit "$status"
}
trap cleanup EXIT

suite_verte() {
	scripts/run-sql-tests.sh "$TEST" > "$WORK/tap.log" 2>&1 \
		&& grep -q '1 fichiers, 88 assertions, aucune anomalie' "$WORK/tap.log"
}

suite_rouge() {
	if scripts/run-sql-tests.sh "$TEST" > "$WORK/tap-red.log" 2>&1; then
		return 1
	fi
	grep -Eq 'ECHEC|not ok|psql a échoué' "$WORK/tap-red.log"
}

empreinte() {
	psql_db -c "select md5(string_agg(element, '|' order by element)) from (
		select 'col:' || a.attname || ':' || a.atttypid::regtype::text || ':' || a.attnotnull as element
		  from pg_attribute a
		 where a.attrelid='public.workflow_transition_required_fields'::regclass
		   and a.attnum > 0 and not a.attisdropped
		union all
		select 'con:' || c.conname || ':' || pg_get_constraintdef(c.oid)
		  from pg_constraint c
		 where c.conrelid='public.workflow_transition_required_fields'::regclass
		union all
		select 'idx:' || i.indexname || ':' || i.indexdef
		  from pg_indexes i
		 where i.schemaname='public' and i.tablename='workflow_transition_required_fields'
		union all
		select 'pol:' || p.policyname || ':' || p.cmd || ':' || coalesce(p.qual,'-') || ':' || coalesce(p.with_check,'-')
		  from pg_policies p
		 where p.schemaname='public' and p.tablename='workflow_transition_required_fields'
		union all
		select 'trg:' || t.tgname || ':' || pg_get_triggerdef(t.oid)
		  from pg_trigger t
		 where not t.tgisinternal
		   and (t.tgrelid='public.workflow_transition_required_fields'::regclass
		        or t.tgname in ('workflow_transitions_verifier_required_fields',
		                        'form_fields_verifier_required_fields'))
		union all
		select 'fn:' || n.nspname || '.' || p.proname || ':' || pg_get_functiondef(p.oid)
		  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
		 where (n.nspname='app' and p.proname in
		       ('workflow_transition_required_fields_verifier_workflow',
		        'workflow_transition_required_fields_verifier_parent',
		        'workflow_composition_fingerprint'))
		    or (n.nspname='public' and p.proname in ('move_card','copy_workflow_to_track'))
		union all
		select 'workflow-col:' || a.attname || ':' || a.atttypid::regtype::text || ':' || a.attnotnull
		  from pg_attribute a
		 where a.attrelid='public.workflows'::regclass
		   and a.attname='source_composition_fingerprint'
		   and a.attnum > 0 and not a.attisdropped
		union all
		select 'workflow-con:' || c.conname || ':' || pg_get_constraintdef(c.oid)
		  from pg_constraint c
		 where c.conrelid='public.workflows'::regclass
		   and c.conname='workflows_source_composition_fingerprint_check'
		union all
		select 'view:workflow_derivations:' ||
		       pg_get_viewdef('public.workflow_derivations'::regclass, true)
	) inventaire;"
}

identites_structurelles() {
	psql_db -c "select string_agg(type || ':' || nom || ':' || oid::text, '|' order by type, nom)
		from (
			select 'contrainte' as type, c.conname as nom, c.oid
			  from pg_constraint c
			 where c.conrelid='public.workflow_transition_required_fields'::regclass
			   and c.conname in ('workflow_transition_required_fields_pkey',
			                     'workflow_transition_required_fields_transition_id_fkey',
			                     'workflow_transition_required_fields_field_id_fkey')
			union all
			select 'index', c.relname, c.oid
			  from pg_class c join pg_namespace n on n.oid=c.relnamespace
			 where n.nspname='public'
			   and c.relname='workflow_transition_required_fields_field_idx'
		) objets;"
}

echo
echo "Preuves de CRM-018 — champs exigés par une transition"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

WORKFLOW_DERIVE=$(psql_db -c "select id from public.workflows
	where derived_from_workflow_id='5eed0000-0000-4000-8000-000000000051'
	  and name='Cycle commercial — Conseil IA';")
TRANSITION_DERIVEE=$(psql_db -c "select id from public.workflow_transitions
	where workflow_id='$WORKFLOW_DERIVE' and label='Démarrer la réalisation' limit 1;")
CHAMP_DERIVE=$(psql_db -c "select id from public.form_fields
	where workflow_id='$WORKFLOW_DERIVE' and key='lien-proposition';")
if [ -z "$WORKFLOW_DERIVE" ] || [ -z "$TRANSITION_DERIVEE" ] || [ -z "$CHAMP_DERIVE" ]; then
	echo "ERREUR : la copie seedée, sa transition ou son champ remappé est absent." >&2
	exit 1
fi
LIAISONS_HORS_FIXTURE=$(psql_db -c "select count(*)
	from public.workflow_transition_required_fields
	where transition_id not in ('$TRANSITION_SOURCE', '$TRANSITION_DERIVEE');")

echo "1. Contrat final et rejeu"
if suite_verte; then
		ok "suite ciblée verte — 88 assertions"
else
	fail "suite pgTAP CRM-018 en échec ou compte inattendu"
	tail -n 25 "$WORK/tap.log" | sed 's/^/        /'
fi

avant=$(empreinte)
identites_avant=$(identites_structurelles)
restore_needed=true
if appliquer_migration > "$WORK/replay.log" 2>&1; then
	if grep -Eqi 'warning|error|fatal' "$WORK/replay.log"; then
		fail "le rejeu écrit un warning ou une erreur"
	else
		ok "migration rejouée sans warning ni erreur"
	fi
else
	fail "la migration échoue sur un état déjà migré"
	tail -n 25 "$WORK/replay.log" | sed 's/^/        /'
fi
apres=$(empreinte)
if [ "$avant" = "$apres" ]; then
	ok "le rejeu conserve exactement schéma, politiques, trigger et fonctions"
else
	fail "l'empreinte change après rejeu"
fi
identites_apres=$(identites_structurelles)
if [ "$identites_avant" = "$identites_apres" ]; then
	ok "le rejeu ne reconstruit ni les trois contraintes exactes ni leur index inverse"
else
	fail "le rejeu remplace encore un objet structurel déjà conforme"
fi

echo
echo "2. Vraie mise à niveau depuis l'ancien tableau"
psql_db -c "delete from public.workflow_transition_required_fields
	where transition_id in ('$TRANSITION_SOURCE', '$TRANSITION_DERIVEE');
	alter table public.workflow_transitions add column require_fields uuid[] not null default '{}';
	update public.workflow_transitions set require_fields=array['$CHAMP_SOURCE'::uuid]
	 where id in ('$TRANSITION_SOURCE','$TRANSITION_DERIVEE');" >/dev/null

if appliquer_migration > "$WORK/upgrade.log" 2>&1; then
	ok "un tableau ancien peuplé est migré dans une transaction"
else
	fail "la mise à niveau de l'ancien tableau échoue"
	tail -n 25 "$WORK/upgrade.log" | sed 's/^/        /'
fi
if grep -q 'ancienne(s) exigence(s) dérivée(s) inerte(s) écartée(s)' "$WORK/upgrade.log"; then
	ok "l'artefact dérivé du même workspace est recensé avant d'être écarté"
else
	fail "la mise à niveau n'a pas recensé l'artefact dérivé écarté"
fi

etat_upgrade=$(psql_db -F '|' -c "select
	to_regclass('public.workflow_transition_required_fields') is not null,
	not exists (select 1 from pg_attribute where attrelid='public.workflow_transitions'::regclass
	            and attname='require_fields' and attnum > 0 and not attisdropped),
	(select count(*) from public.workflow_transition_required_fields trf
	  join public.workflow_transitions t on t.id=trf.transition_id
	 where t.workflow_id='5eed0000-0000-4000-8000-000000000051'),
	(select count(*) from public.workflow_transition_required_fields trf
	  join public.workflow_transitions t on t.id=trf.transition_id
	 where t.workflow_id='$WORKFLOW_DERIVE');")
if [ "$etat_upgrade" = 't|t|1|0' ]; then
	ok "colonne retirée après copie exacte de la source et exclusion de l'artefact dérivé"
else
	fail "état après mise à niveau inattendu : $etat_upgrade"
fi

echo
echo "3. Une donnée morte arrête la migration sans effet partiel"
psql_db -c "alter table public.workflow_transitions add column require_fields uuid[] not null default '{}';
	update public.workflow_transitions
	   set require_fields=array['5eed0000-0000-4000-8000-0000000000ff'::uuid]
	 where id='$TRANSITION_SOURCE';" >/dev/null
if appliquer_migration > "$WORK/dead.log" 2>&1; then
	fail "un identifiant mort passe la migration"
elif grep -q 'require_fields_dead_identifiers' "$WORK/dead.log"; then
	ok "un identifiant mort fait échouer explicitement la transaction"
else
	fail "la migration échoue, mais pas sur le diagnostic d'identifiant mort attendu"
fi
apres_echec=$(psql_db -F '|' -c "select
	exists (select 1 from pg_attribute where attrelid='public.workflow_transitions'::regclass
	        and attname='require_fields' and attnum > 0 and not attisdropped),
	(select count(*) from public.workflow_transition_required_fields);")
liaisons_apres_upgrade=$((LIAISONS_HORS_FIXTURE + 1))
if [ "$apres_echec" = "t|$liaisons_apres_upgrade" ]; then
	ok "l'échec atomique conserve colonne ancienne et liaison déjà valide"
else
	fail "la migration en échec a laissé un effet partiel : $apres_echec"
fi
psql_db -c "update public.workflow_transitions set require_fields='{}'::uuid[];
	update public.workflow_transitions set require_fields=array['$CHAMP_SOURCE'::uuid]
	 where id='$TRANSITION_SOURCE';" >/dev/null
appliquer_migration >/dev/null 2>&1

echo
echo "4. Un croisement de workspace arrête lui aussi la migration"
psql_db -c "insert into public.workspaces (id, name, slug)
	values ('$WORKSPACE_CROISE', 'Workspace croisé CRM-018', 'tst-crm018-croise');
	insert into public.workflows (id, workspace_id, name)
	values ('$WORKFLOW_CROISE', '$WORKSPACE_CROISE', 'Workflow croisé CRM-018');
	insert into public.form_fields
		(id, workflow_id, workspace_id, key, label, type, options, position)
	values ('$CHAMP_CROISE', '$WORKFLOW_CROISE', '$WORKSPACE_CROISE',
	        'croisement-workspace-crm-018', 'Croisement workspace CRM-018', 'text', '{}', 1);
	alter table public.workflow_transitions add column require_fields uuid[] not null default '{}';
	update public.workflow_transitions set require_fields=array['$CHAMP_CROISE'::uuid]
	 where id='$TRANSITION_SOURCE';" >/dev/null
if appliquer_migration > "$WORK/cross-workspace.log" 2>&1; then
	fail "un identifiant d'un autre workspace passe la migration"
elif grep -q 'require_fields_workspace_mismatch' "$WORK/cross-workspace.log"; then
	ok "le croisement de workspace est refusé par son diagnostic propre"
else
	fail "la migration échoue, mais pas sur le diagnostic inter-workspace attendu"
fi
apres_croisement=$(psql_db -F '|' -c "select
	exists (select 1 from pg_attribute where attrelid='public.workflow_transitions'::regclass
	        and attname='require_fields' and attnum > 0 and not attisdropped),
	(select count(*) from public.workflow_transition_required_fields);")
if [ "$apres_croisement" = "t|$liaisons_apres_upgrade" ]; then
	ok "l'échec inter-workspace conserve lui aussi colonne ancienne et liaison valide"
else
	fail "l'échec inter-workspace a laissé un effet partiel : $apres_croisement"
fi
psql_db -c "update public.workflow_transitions set require_fields='{}'::uuid[];
	update public.workflow_transitions set require_fields=array['$CHAMP_SOURCE'::uuid]
	 where id='$TRANSITION_SOURCE';" >/dev/null
appliquer_migration >/dev/null 2>&1
psql_db -c "delete from public.workspaces where id='$WORKSPACE_CROISE';" >/dev/null

# La mise à niveau historique écarte volontairement l'ancien identifiant de champ SOURCE porté par
# la copie : il n'existait aucun champ cible dans l'ancien produit. Ici la sonde emploie une copie
# moderne déjà complète ; le harnais remet donc exactement sa liaison cible avant de mesurer les
# dégradations suivantes. Aucune autre copie, notamment utilisateur, n'est touchée.
restaurer_liaison_copie
if suite_verte; then
	ok "la fixture moderne est restaurée avant les contre-épreuves, sans toucher aux autres copies"
else
	fail "l'état de référence n'est pas vert avant les contre-épreuves"
fi

echo
echo "5. La cohérence résiste à deux écritures concurrentes"

psql_db -c "delete from public.workflow_transition_required_fields
	where field_id='$CHAMP_CONCURRENT';
	delete from public.form_fields where id='$CHAMP_CONCURRENT';
	insert into public.form_fields
		(id, workflow_id, workspace_id, key, label, type, options, position)
	values ('$CHAMP_CONCURRENT', '5eed0000-0000-4000-8000-000000000051',
	        '5eed0000-0000-4000-8000-000000000001', 'concurrence-crm-018',
	        'Concurrence CRM-018', 'text', '{}', 999);" >/dev/null

psql_db -c "begin;
	insert into public.workflow_transition_required_fields (transition_id, field_id)
	values ('5eed0000-0000-4000-8000-000000000075', '$CHAMP_CONCURRENT');
	select pg_sleep(8);
	commit;" > "$WORK/concurrence-a.log" 2>&1 &
pid_concurrence=$!

concurrence_observee=false
tentative=0
while [ "$tentative" -lt 40 ]; do
	if [ "$(psql_db -c "select count(*) from pg_stat_activity
		where wait_event='PgSleep' and query like '%$CHAMP_CONCURRENT%';")" -gt 0 ]; then
		concurrence_observee=true
		break
	fi
	tentative=$((tentative + 1))
	sleep 0.1
done

if [ "$concurrence_observee" = true ]; then
	if psql_db -c "set lock_timeout='500ms';
		update public.form_fields set workflow_id='$WORKFLOW_DERIVE'
		 where id='$CHAMP_CONCURRENT';" > "$WORK/concurrence-b.log" 2>&1; then
		fail "le déplacement concurrent du champ passe pendant la création de sa liaison"
	elif grep -q 'canceling statement due to lock timeout' "$WORK/concurrence-b.log"; then
		ok "la liaison verrouille son champ parent jusqu'au commit"
	else
		fail "le déplacement concurrent échoue, mais pas sur le verrou parent attendu"
	fi
else
	fail "la transaction concurrente n'a pas atteint sa fenêtre de preuve"
fi

if ! wait "$pid_concurrence"; then
	fail "la transaction créant la liaison concurrente n'a pas abouti"
fi
etat_concurrent=$(psql_db -F '|' -c "select
	(select workflow_id from public.form_fields where id='$CHAMP_CONCURRENT'),
	(select count(*) from public.workflow_transition_required_fields
	  where transition_id='5eed0000-0000-4000-8000-000000000075'
	    and field_id='$CHAMP_CONCURRENT');")
if [ "$etat_concurrent" = '5eed0000-0000-4000-8000-000000000051|1' ]; then
	ok "après les deux transactions, le parent et la liaison sont cohérents"
else
	fail "les deux transactions laissent un état incohérent : $etat_concurrent"
fi
psql_db -c "delete from public.workflow_transition_required_fields where field_id='$CHAMP_CONCURRENT';
	delete from public.form_fields where id='$CHAMP_CONCURRENT';" >/dev/null

echo
echo "6. Non-complaisance : contraintes, triggers, politique, fonction et seed"

psql_db -c "alter table public.workflow_transition_required_fields
	drop constraint workflow_transition_required_fields_field_id_fkey;
	alter table public.workflow_transition_required_fields
	add constraint workflow_transition_required_fields_field_id_fkey
	foreign key(field_id) references public.form_fields(id) on delete restrict;" >/dev/null
if suite_rouge; then ok "affaiblir la cascade rend pgTAP rouge"; else fail "la cascade affaiblie passe pgTAP"; fi
appliquer_migration >/dev/null 2>&1

psql_db -c "drop trigger workflow_transition_required_fields_verifier_workflow
	on public.workflow_transition_required_fields;" >/dev/null
if suite_rouge; then ok "retirer le trigger de cohérence rend pgTAP rouge"; else fail "le trigger absent passe pgTAP"; fi
appliquer_migration >/dev/null 2>&1

psql_db -c "drop policy workflow_transition_required_fields_lecture_membre
	on public.workflow_transition_required_fields;
	create policy workflow_transition_required_fields_lecture_membre
	on public.workflow_transition_required_fields for select to anon, authenticated using (true);" >/dev/null
if suite_rouge; then ok "ouvrir la lecture anonyme rend pgTAP rouge"; else fail "la politique permissive passe pgTAP"; fi
appliquer_migration >/dev/null 2>&1

psql_db -c "create or replace function public.move_card(
	card_id uuid, to_step_id uuid, comment text default null
) returns public.cards
language plpgsql
security definer
set search_path = ''
as \$\$
declare
	v_card_id uuid := card_id;
	v_card    public.cards%rowtype;
begin
	select c.* into v_card from public.cards c where c.id = v_card_id;
	return v_card;
end;
\$\$;" >/dev/null
if suite_rouge; then
	ok "retirer la sixième garde de move_card rend pgTAP rouge"
else
	fail "un move_card sans aucune garde passe pgTAP"
fi
appliquer_migration >/dev/null 2>&1

# Une dérive sémantique à compte constant est précisément l'angle mort de la décision 303. Le seed
# doit la refuser sans la maquiller, puis réussir après restauration explicite de la fixture.
psql_db -c "update public.form_fields set label='Altération silencieuse CRM-018'
	where id='$CHAMP_DERIVE';" >/dev/null
if "$SEED" > "$WORK/seed-target-divergence.log" 2>&1; then
	fail "une copie moderne altérée à compte constant passe le seed"
elif grep -q 'composition métier de la copie.*diverge' "$WORK/seed-target-divergence.log"; then
	ok "le seed refuse explicitement une divergence sémantique de sa copie moderne"
else
	fail "la copie moderne altérée est refusée, mais sans le diagnostic attendu"
fi
libelle_apres_refus=$(psql_db -c "select label from public.form_fields where id='$CHAMP_DERIVE';")
if [ "$libelle_apres_refus" = 'Altération silencieuse CRM-018' ]; then
	ok "le refus n'écrase pas l'adaptation détectée dans la copie"
else
	fail "le seed a réécrit la copie malgré son refus : $libelle_apres_refus"
fi
psql_db -c "update public.form_fields set label='$LIBELLE_CHAMP_DERIVE'
	where id='$CHAMP_DERIVE';" >/dev/null
if "$SEED" > "$WORK/seed-target-restored.log" 2>&1; then
	ok "la copie explicitement restaurée permet de rejouer le seed"
else
	fail "le seed reste rouge après restauration explicite de sa copie"
	tail -n 25 "$WORK/seed-target-restored.log" | sed 's/^/        /'
fi

psql_db -c "delete from public.workflow_transition_required_fields
	where transition_id='$TRANSITION_SOURCE' and field_id='$CHAMP_SOURCE';" >/dev/null
if suite_rouge; then ok "retirer la donnée seedée rend pgTAP rouge"; else fail "un seed sans exigence passe pgTAP"; fi
if "$SEED" > "$WORK/seed.log" 2>&1; then
	ok "le véritable seed restaure sa liaison source sans altérer la liaison dérivée remappée"
else
	fail "le seed ne restaure pas son contrat"
	tail -n 25 "$WORK/seed.log" | sed 's/^/        /'
fi

if suite_verte; then
		ok "après toutes les contre-épreuves, les 88 assertions redeviennent vertes"
	restore_needed=false
else
	fail "la restauration finale n'est pas complète"
fi

echo
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1
