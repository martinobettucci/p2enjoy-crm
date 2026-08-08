#!/usr/bin/env bash
# @verifies CRM-017 (docs/BACKLOG.md) — ordonnancement durable par PostgreSQL
# @verifies docs/SPEC-scheduler.md §3 (job), §4 (sécurité), §5 (convergence), §6 (preuves)
# @verifies docs/DAT.md §3.3, §12 ; docs/PROD_MIGRATIONS.md §3
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée,
# exécute la preuve pgTAP, dégrade réellement le job, rejoue la migration puis attend le passage
# asynchrone qui prouve sa restauration. Aucun état dégradé ne subsiste, même en cas d'échec.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION_FILE=supabase/migrations/0018_pg_cron.sql
TEST_FILE=supabase/tests/0020_pg_cron.test.sql
JOB_NAME=p2enjoy-scheduler-heartbeat

failures=0
checks=0
WORK=$(mktemp -d)
restore_needed=false

cleanup() {
	local status=$?
	trap - EXIT
	set +e
	if [ "$restore_needed" = true ]; then
		if ! psql_db -f - < "$MIGRATION_FILE" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours du job pg_cron a échoué.\n' >&2
			status=1
		fi
	fi
	rm -rf -- "$WORK"
	exit "$status"
}
trap cleanup EXIT

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

psql_admin() {
	docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

rejouer_migration() {
	psql_admin -f - < "$MIGRATION_FILE" >"$WORK/migration.log" 2>&1
}

job_field() {
	local field=$1
	psql_db -c "select ${field} from cron.job where jobname = '${JOB_NAME}';"
}

attendre_passage() {
	local avant=$1 limite=$((SECONDS + 20)) etat
	while [ "$SECONDS" -lt "$limite" ]; do
		etat=$(psql_db -F '|' -c "
			select h.run_count, j.schedule,
			       exists (select 1 from cron.job_run_details d
			                where d.jobid = j.jobid and d.status = 'succeeded')
			  from app.scheduler_heartbeat h
			  join cron.job j on j.jobname = '${JOB_NAME}'
			 where h.name = 'scheduler';")
		if [ "${etat%%|*}" -gt "$avant" ] 2>/dev/null \
			&& printf '%s' "$etat" | grep -q '|7 \* \* \* \*|t$'; then
			return 0
		fi
		sleep 1
	done
	return 1
}

attendre_arret_job() {
	local job_id=$1 limite=$((SECONDS + 15)) etat
	while [ "$SECONDS" -lt "$limite" ]; do
		psql_db -c "select cron.alter_job(${job_id}, active => false);" >/dev/null
		etat=$(psql_db -F '|' -c "select active,
			(select count(*) from cron.job_run_details
			  where jobid=${job_id} and status='running')
			from cron.job where jobid=${job_id};")
		if [ "$etat" = 'f|0' ]; then
			return 0
		fi
		sleep 1
	done
	return 1
}

echo
echo "Preuves de CRM-017 — ordonnancement pg_cron"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

echo "1. Contrat pgTAP et passage réel"
if scripts/run-sql-tests.sh "$TEST_FILE" >"$WORK/tap.log" 2>&1 \
	&& grep -q '1 fichiers, 48 assertions, aucune anomalie' "$WORK/tap.log"; then
	ok "48 assertions pgTAP, exécution cron réelle comprise"
else
	fail "suite pgTAP CRM-017 en échec ou compte inattendu"
	sed 's/^/        /' "$WORK/tap.log" | tail -n 30
fi

job_id_before=$(job_field jobid)
run_count_before=$(psql_db -c "select run_count from app.scheduler_heartbeat where name='scheduler';")
if [[ "$job_id_before" =~ ^[0-9]+$ ]] && [[ "$run_count_before" =~ ^[0-9]+$ ]] \
	&& [ "$run_count_before" -gt 0 ]; then
	ok "job $job_id_before actif et heartbeat déjà exécuté ($run_count_before passage(s))"
else
	fail "job ou heartbeat initial absent : job='$job_id_before', compteur='$run_count_before'"
fi

echo
echo "2. Non-complaisance et convergence"

# Dégradation réelle : mauvaise base, fausse commande, fréquence bruyante et job inactif. Le job
# ne peut donc pas s'exécuter dans cet état ; le seul chemin de restauration est la migration.
restore_needed=true
if attendre_arret_job "$job_id_before"; then
	ok "job désactivé et aucun worker antérieur encore en cours"
else
	fail "le job ne devient pas quiescent avant la contre-épreuve"
fi
if psql_db -c "select cron.alter_job(
	${job_id_before}, schedule => '1 second', command => 'select 0',
	database => 'template1', active => false);" >/dev/null; then
	ok "commande, base, cadence et activation réellement dégradées"
else
	fail "impossible de poser la contre-épreuve sur le job"
fi

# La seconde dégradation reproduit le défaut trouvé pendant l'écriture : les ACL initiales de
# l'extension appartiennent à `supabase_admin`, et un REVOKE lancé par `postgres` ne les retire pas.
if psql_admin -c "grant usage on schema cron to anon;
	grant execute on function cron.schedule(text,text,text) to anon;" >/dev/null; then
	restore_needed=true
	ok "USAGE et EXECUTE réellement rouverts à anon sous le propriétaire pg_cron"
else
	fail "impossible de poser la contre-épreuve sur les ACL cron"
fi

degrade=$(psql_db -F '|' -c "select schedule,command,database,active from cron.job
	where jobid=${job_id_before};")
if [ "$degrade" = '1 second|select 0|template1|f' ]; then
	ok "la dégradation est effective, pas seulement demandée"
else
	fail "état dégradé inattendu : '$degrade'"
fi
if [ "$(psql_db -F '|' -c "select has_schema_privilege('anon','cron','usage'),
	has_function_privilege('anon','cron.schedule(text,text,text)','execute');")" = 't|t' ]; then
	ok "la réouverture des ACL est effective, pas seulement demandée"
else
	fail "les ACL de contre-épreuve ne sont pas réellement ouvertes"
fi

if rejouer_migration; then
	restore_needed=false
	if grep -Eqi 'warning|error|fatal' "$WORK/migration.log"; then
		fail "la migration converge mais écrit un warning ou une erreur"
		sed 's/^/        /' "$WORK/migration.log" | tail -n 25
	else
		ok "migration rejouée sans warning ni erreur"
	fi
else
	fail "la migration n'est pas rejouable"
	sed 's/^/        /' "$WORK/migration.log" | tail -n 25
fi

job_id_after=$(job_field jobid)
if [ "$job_id_after" = "$job_id_before" ]; then
	ok "le job nommé conserve le même jobid ($job_id_after)"
else
	fail "jobid remplacé : avant=$job_id_before après=$job_id_after"
fi

if attendre_passage "$run_count_before"; then
	ok "le job réparé s'exécute puis revient à la cadence horaire"
else
	fail "aucun nouveau heartbeat réussi dans les 20 secondes"
fi

contrat=$(psql_db -F '|' -c "select schedule,command,database,username,active from cron.job
	where jobname='${JOB_NAME}';")
if [ "$contrat" = '7 * * * *|select app.scheduler_heartbeat_tick();|postgres|postgres|t' ]; then
	ok "cadence, commande, base, rôle et activation restaurés exactement"
else
	fail "contrat final du job inattendu : '$contrat'"
fi

if [ "$(psql_db -c "select count(*) from cron.job where jobname='${JOB_NAME}';")" = 1 ] \
	&& [ "$(psql_db -c 'select count(*) from app.scheduler_heartbeat;')" = 1 ]; then
	ok "aucun doublon de job ni de heartbeat"
else
	fail "un rejeu a créé un doublon"
fi

if [ "$(psql_db -c "select count(*) from cron.job_run_details d join cron.job j using(jobid)
	where j.jobname='${JOB_NAME}' and d.status='failed';")" = 0 ]; then
	ok "aucune exécution du heartbeat n'est en échec"
else
	fail "cron.job_run_details contient une exécution échouée"
fi

if [ "$(psql_db -F '|' -c "select has_schema_privilege('anon','cron','usage'),
	has_function_privilege('anon','cron.schedule(text,text,text)','execute');")" = 'f|f' ]; then
	ok "la migration referme les ACL de l'extension sous leur propriétaire réel"
else
	fail "les ACL cron dégradées ne sont pas restaurées"
fi

echo
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1
