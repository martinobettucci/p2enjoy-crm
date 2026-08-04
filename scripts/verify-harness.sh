#!/usr/bin/env bash
# @verifies CRM-008 (docs/BACKLOG.md) — Definition of Done du harnais de tests
# @verifies docs/SPEC-test-harness.md §3 (exécuteur pgTAP), §4 (projets Playwright),
#           §5 (rapport), §7 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 11)
# @verifies docs/JOURNAL.md décisions 48 à 51
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-008` :
#
#   1. les prérequis sont réunis, et le script le dit plutôt que de mesurer autre chose ;
#   2. `npm run test:sql` exécute les trois suites pgTAP et rend le compte attendu ;
#   3. `npm run e2e:api` est vert sur ses treize scénarios, hors interface ;
#   4. `npm run e2e:api` ne construit **ni ne sert** la webapp — mesuré en supprimant le build
#      avant l'exécution et en constatant qu'il n'a pas été recréé ;
#   5. `npm run e2e:ui` reste vert : le renommage du projet n'a rien cassé ;
#   6. `npm run test:unit` reste vert ;
#   7. `npm run typecheck` reste vert, les fichiers `e2e/` étant couverts par tsconfig.tools.json ;
#   8. `npm run e2e:report` sert réellement le dernier rapport — interrogé en HTTP, pas supposé ;
#   9. le harnais est **non complaisant** : six dégradations réelles doivent le faire échouer ;
#  10. tout ce qui a été altéré est restauré, et l'état final est **constaté**.
#
# Le script ne démarre ni n'arrête la pile : elle doit tourner (`./runDev.sh`), et le seed doit
# être appliqué (`supabase/seed/apply-seed.sh`). Tout ce qu'il altère est restauré par un `trap`,
# y compris en cas d'interruption.
#
# Usage :
#   scripts/verify-harness.sh

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
SUITE_MUTABLE=supabase/tests/0003_seed_socle.test.sql
TEST_FAUX=webapp/src/lib/non-complaisance.tmp.test.ts
POLITIQUE=preuve_non_complaisance_crm_008
PORT_RAPPORT=9323

# Comptes attendus, révisés à chaque unité qui ajoute des preuves. Ils sont **figés** et non
# déduits : un exécuteur qui se contenterait de « le vert est vert » resterait vert si une suite
# entière cessait d'être découverte (docs/SPEC-test-harness.md §3). Le prix est cette révision
# explicite ; c'est exactement ce qu'on lui demande.
#
# Historique : 227 / 13 / 13 à `CRM-008` ; 306 / 30 / 22 puis 23 à `CRM-020` ; 374 / 50 / 37
# depuis `CRM-021`.
#
# Les trois compteurs ont **réellement échoué** à la livraison de `CRM-021`, comme prévu, et sont
# révisés ici dans le même changement que les preuves qu'ils comptent. C'est le seul mode de
# fonctionnement acceptable : les déduire de l'exécution reviendrait à supprimer le contrôle.
ASSERTIONS_ATTENDUES=374
SCENARIOS_API=50
# 37 depuis `CRM-021` : 13 scénarios de la route d'un track et de sa barre d'onglets
# (`e2e/ui/channels.spec.ts`).
SCENARIOS_UI=37

TRAVAIL=$(mktemp -d)
failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

# Tout ce que les contrôles de non-complaisance altèrent est restauré quoi qu'il arrive : la
# suite pgTAP mutée, le test unitaire faux, la politique RLS posée, et le serveur de rapport.
menage() {
	[ -f "$TRAVAIL/suite.sql" ] && cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"
	rm -f "$TEST_FAUX"
	psql_db -c "drop policy if exists \"$POLITIQUE\" on public.workspaces;" >/dev/null 2>&1 || true
	[ -n "${PID_RAPPORT:-}" ] && kill "$PID_RAPPORT" 2>/dev/null || true
	rm -rf "$TRAVAIL"
}
trap menage EXIT

echo
echo "Preuves de CRM-008 — harnais de tests"
echo

# --- 1. Prérequis ------------------------------------------------------------------------------

echo "1. Prérequis"

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh." >&2
	exit 1
fi
if ! docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

comptes_seed=$(psql_db -c "select count(*) from public.profiles where id::text like '5eed%';")
if [ "$comptes_seed" -ge 3 ]; then
	ok "pile démarrée et seed appliqué ($comptes_seed profils seedés)"
else
	echo "ERREUR : seed non appliqué. Lancez supabase/seed/apply-seed.sh." >&2
	exit 1
fi

cp "$SUITE_MUTABLE" "$TRAVAIL/suite.sql"

# --- 2. npm run test:sql -----------------------------------------------------------------------

echo
echo "2. npm run test:sql — suites pgTAP"

if npm run --silent test:sql >"$TRAVAIL/sql.log" 2>&1; then
	assertions=$(grep -oE '[0-9]+ assertions, aucune anomalie' "$TRAVAIL/sql.log" | grep -oE '^[0-9]+' || echo 0)
	if [ "${assertions:-0}" -eq "$ASSERTIONS_ATTENDUES" ]; then
		ok "npm run test:sql : 3 fichiers, $assertions assertions, aucune anomalie"
	else
		fail "npm run test:sql vert mais $assertions assertions au lieu de $ASSERTIONS_ATTENDUES"
	fi
else
	fail "npm run test:sql échoue"
	sed 's/^/        /' "$TRAVAIL/sql.log" | tail -n 20
fi

# --- 3. npm run e2e:api ------------------------------------------------------------------------

echo
echo "3. npm run e2e:api — contrats et refus, hors interface"

if npm run --silent e2e:api >"$TRAVAIL/api.log" 2>&1; then
	passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -n 1 | grep -oE '^[0-9]+' || echo 0)
	if [ "${passes:-0}" -eq "$SCENARIOS_API" ]; then
		ok "npm run e2e:api : $passes scénarios verts (A1 à A6, preuve de refus n° 11 comprise)"
	else
		fail "npm run e2e:api vert mais $passes scénarios au lieu de $SCENARIOS_API"
	fi
else
	fail "npm run e2e:api échoue"
	sed 's/^/        /' "$TRAVAIL/api.log" | tail -n 25
fi

# --- 4. Le projet `api` ne construit ni ne sert la webapp --------------------------------------
# Mesuré, et non déduit de l'absence de `webServer` dans la configuration : le build est
# supprimé avant l'exécution. S'il réapparaît, c'est que `npm run build && npm run preview` a
# tourné — ce que la décision 49 vise précisément à éviter.

echo
echo "4. Le projet api ne démarre aucun serveur web"

rm -rf webapp/dist
npm run --silent e2e:api >/dev/null 2>&1 || true
if [ ! -e webapp/dist ]; then
	ok "webapp/dist n'a pas été recréé : aucun build, aucun serveur de prévisualisation"
else
	fail "webapp/dist a été recréé : le webServer a démarré pour le projet api"
fi

# --- 5. npm run e2e:ui -------------------------------------------------------------------------

echo
echo "5. npm run e2e:ui — projet d'interface de CRM-007, non régressé"

if npm run --silent e2e:ui >"$TRAVAIL/ui.log" 2>&1; then
	passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -n 1 | grep -oE '^[0-9]+' || echo 0)
	if [ "${passes:-0}" -eq "$SCENARIOS_UI" ]; then
		ok "npm run e2e:ui : $passes scénarios verts contre le build servi"
	else
		fail "npm run e2e:ui vert mais $passes scénarios au lieu de $SCENARIOS_UI"
	fi
else
	fail "npm run e2e:ui échoue"
	sed 's/^/        /' "$TRAVAIL/ui.log" | tail -n 25
fi

if [ -s webapp/dist/index.html ]; then
	ok "webapp/dist reconstruit par le projet ui : l'état d'avant le contrôle 4 est rétabli"
else
	fail "webapp/dist absent après le projet ui"
fi

# --- 6. npm run test:unit et 7. npm run typecheck ----------------------------------------------

echo
echo "6. npm run test:unit et npm run typecheck"

if npm run --silent test:unit >"$TRAVAIL/unit.log" 2>&1; then
	ok "npm run test:unit : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/unit.log" | tail -n 1)"
else
	fail "npm run test:unit échoue"
	sed 's/^/        /' "$TRAVAIL/unit.log" | tail -n 20
fi

if npm run --silent typecheck >"$TRAVAIL/tsc.log" 2>&1; then
	ok "npm run typecheck : quatre projets compilés, e2e/ compris"
else
	fail "npm run typecheck échoue"
	sed 's/^/        /' "$TRAVAIL/tsc.log" | tail -n 20
fi

# --- 8. npm run e2e:report ---------------------------------------------------------------------

echo
echo "8. npm run e2e:report — le dernier rapport est réellement servi"

if [ -s e2e/report/index.html ]; then
	ok "rapport HTML produit par la dernière exécution E2E"
else
	fail "aucun rapport HTML dans e2e/report/"
fi

PLAYWRIGHT_HTML_HOST=127.0.0.1 PLAYWRIGHT_HTML_PORT="$PORT_RAPPORT" \
	npm run --silent e2e:report >"$TRAVAIL/rapport.log" 2>&1 &
PID_RAPPORT=$!

code_rapport=000
for _ in $(seq 1 20); do
	code_rapport=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_RAPPORT/" || echo 000)
	[ "$code_rapport" = "200" ] && break
	sleep 1
done

if [ "$code_rapport" = "200" ]; then
	ok "npm run e2e:report sert le rapport sur le port $PORT_RAPPORT (HTTP 200 constaté)"
else
	fail "npm run e2e:report ne sert rien : dernier code obtenu $code_rapport"
	sed 's/^/        /' "$TRAVAIL/rapport.log" | tail -n 10
fi

kill "$PID_RAPPORT" 2>/dev/null || true
wait "$PID_RAPPORT" 2>/dev/null || true
PID_RAPPORT=

# --- 9. Non-complaisance -----------------------------------------------------------------------
# Chaque contrôle dégrade réellement le monde, exige l'échec, puis restaure. Un harnais qui
# n'échoue jamais ne prouve rien de ce qu'il affirme.

echo
echo "9. Non-complaisance : six dégradations réelles doivent faire échouer le harnais"

# 9.1 — une assertion volontairement fausse dans une suite pgTAP réelle.
sed -i "s/'P2Enjoy SAS',/'P2Enjoy SARL',/" "$SUITE_MUTABLE"
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "une assertion fausse ne fait pas échouer npm run test:sql"
else
	ok "une assertion fausse fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.2 — plan non tenu ET `finish()` retiré : pgTAP n'émet alors AUCUN diagnostic (décision 48).
# C'est le contrôle qui prouve que le verdict est calculé, et non emprunté à pgTAP.
sed -i 's/^select plan(30);$/select plan(31);/' "$SUITE_MUTABLE"
sed -i 's/^select \* from finish();$//' "$SUITE_MUTABLE"
sortie_tronquee=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA \
	-v ON_ERROR_STOP=1 -f - < "$SUITE_MUTABLE" 2>&1 || true)
if printf '%s' "$sortie_tronquee" | grep -q 'Looks like you planned'; then
	fail "pgTAP diagnostique le plan tronqué : le contrôle ne prouve pas ce qu'il prétend"
else
	ok "pgTAP n'émet aucun diagnostic sans finish() — le verdict ne peut pas lui être emprunté"
fi
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "un plan non tenu sans finish() ne fait pas échouer npm run test:sql"
else
	ok "un plan non tenu sans finish() fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.3 — erreur SQL : `psql` sort en 3, l'exécuteur doit la relayer.
sed -i 's/^select plan(30);$/select plan(30);\nselect fonction_inexistante_crm_008();/' "$SUITE_MUTABLE"
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "une erreur SQL ne fait pas échouer npm run test:sql"
else
	ok "une erreur SQL fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.4 — politique RLS permissive réellement posée : le projet `api` doit la voir.
# C'est le contrôle décisif du projet `api` : sans lui, ses scénarios pourraient se contenter
# de constater une base vide au lieu de mesurer un refus.
psql_db -c "create policy \"$POLITIQUE\" on public.workspaces for select to anon using (true);" >/dev/null
lignes_anon=$(curl -s "http://127.0.0.1:$(sed -n 's/^KONG_HTTP_PORT=//p' .env | tail -1)/rest/v1/workspaces?select=id" \
	-H "apikey: $(sed -n 's/^ANON_KEY=//p' .env | tail -1)" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
if [ "$lignes_anon" -ge 1 ]; then
	ok "la politique permissive est réellement effective : l'anonyme voit $lignes_anon ligne(s)"
else
	fail "la politique posée n'a aucun effet : le contrôle suivant ne prouverait rien"
fi
if npm run --silent e2e:api >/dev/null 2>&1; then
	fail "une politique RLS permissive ne fait pas échouer npm run e2e:api"
else
	ok "une politique RLS permissive fait échouer npm run e2e:api"
fi
psql_db -c "drop policy \"$POLITIQUE\" on public.workspaces;" >/dev/null

# 9.5 — un test unitaire volontairement faux.
cat > "$TEST_FAUX" <<'FAUX'
// Fichier temporaire créé par scripts/verify-harness.sh, supprimé par son trap.
import { expect, test } from 'vitest'
test('assertion volontairement fausse', () => { expect(1).toBe(2) })
FAUX
if npm run --silent test:unit >/dev/null 2>&1; then
	fail "un test unitaire faux ne fait pas échouer npm run test:unit"
else
	ok "un test unitaire faux fait échouer npm run test:unit"
fi
rm -f "$TEST_FAUX"

# --- 10. État final ----------------------------------------------------------------------------

echo
echo "10. Le harnais a tout restauré, et le constate"

if git diff --quiet -- "$SUITE_MUTABLE"; then
	ok "la suite pgTAP mutée est identique à sa version versionnée"
else
	fail "la suite pgTAP reste altérée : $(git diff --stat -- "$SUITE_MUTABLE" | tail -1)"
fi

if [ ! -e "$TEST_FAUX" ]; then
	ok "le test unitaire faux est supprimé"
else
	fail "le test unitaire faux subsiste : $TEST_FAUX"
fi

politiques=$(psql_db -c "select count(*) from pg_policies where schemaname='public' and tablename='workspaces';")
if [ "$politiques" -eq 0 ]; then
	ok "aucune politique résiduelle sur public.workspaces : le refus par défaut est intact"
else
	fail "$politiques politique(s) subsistent sur public.workspaces"
fi

if npm run --silent test:sql >/dev/null 2>&1; then
	ok "npm run test:sql redevient vert après restauration"
else
	fail "npm run test:sql reste rouge après restauration"
fi

if npm run --silent e2e:api >/dev/null 2>&1; then
	ok "npm run e2e:api redevient vert après restauration"
else
	fail "npm run e2e:api reste rouge après restauration"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n\n' "$checks" "$failures"
exit 1
