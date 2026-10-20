#!/usr/bin/env bash
# @verifies CRM-101 (docs/BACKLOG.md) — tranche T4 : le harnais de la plateforme
# @verifies docs/SPEC-plateforme.md §2 à §9 ; docs/SCHEMA.md §1 bis ; docs/DESIGN_SYSTEM.md §5.56 ;
#           docs/SPEC-seed.md §19 ; CLAUDE.md §10 (refus prouvés hors interface), §15, §18 (preuves non complaisantes)
#
# Rejoue les preuves de la plateforme sur la pile de développement, puis DÉGRADE réellement la base et exige que les
# preuves rougissent, avant de la restaurer et de CONSTATER la restauration par une empreinte du catalogue.
#
#   1. traçabilité : chaque fichier de l'unité porte son `@spec` ou son `@verifies` ;
#   2. le catalogue, MESURÉ : tables fermées, fonctions `SECURITY DEFINER` à `search_path` vide, `anon` exclu ;
#   3. le seed : Sabine Plateforme, seule superadministratrice, sans appartenance ;
#   4. les suites : pgTAP (0003, 0070, 0084), unitaires (webapp et fonction `session`), API, interface ;
#   5. trois dégradations réelles de la migration — garde, amorçage unique, dernier superadministrateur —, chacune
#      rouge, puis la restauration constatée.
#
# Le script ne démarre ni n'arrête rien : la pile doit tourner (`./runDev.sh`) et le seed être appliqué.
#
# Usage :
#   scripts/verify-plateforme.sh             tout
#   scripts/verify-plateforme.sh --rapide    sans les preuves Playwright (API et interface), et le dit
#   scripts/verify-plateforme.sh --help

set -euo pipefail
cd "$(dirname "$0")/.."

RAPIDE=false
for argument in "$@"; do
	case "$argument" in
		--rapide) RAPIDE=true ;;
		--help | -h)
			sed -n '/^# Usage :/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'
			exit 0
			;;
		*)
			echo "option inconnue : $argument" >&2
			exit 2
			;;
	esac
done

checks=0
failures=0
ok() { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

MIGRATION=supabase/migrations/0089_plateforme.sql
SUITE=supabase/tests/0084_plateforme.test.sql
psql_base() { docker exec -i p2enjoy-db psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
appliquer() { psql_base -q <"$1" >/dev/null 2>&1; }
suite_verte() { scripts/run-sql-tests.sh "$SUITE" >/dev/null 2>&1; }
empreinte() {
	# Les définitions, et le droit d'EXÉCUTION de chaque rôle — non le texte des ACL. MESURÉ le 2026-10-20 : après le
	# runner, `app.est_superadmin()` porte `postgres, authenticated, service_role` ; après une réapplication par `psql`,
	# `postgres, service_role, authenticated`. Même ensemble de droits, ordre différent : une empreinte sur le texte
	# déclarait une restauration fausse là où le catalogue était équivalent.
	psql_base -c "select md5(string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid)
	                || (select string_agg(r || ':' || has_function_privilege(r, p.oid, 'execute')::text, ',' order by r)
	                      from unnest(array['anon', 'authenticated', 'service_role']) r), '|' order by p.oid::regprocedure::text))
	                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	               where (n.nspname = 'public' and (p.proname like 'plateforme\_%' or p.proname in ('est_superadmin', 'ouvrir_session_sso', 'ouvrir_session_serveur', 'renouveler_session_serveur')))
	                  or (n.nspname = 'app' and (p.proname like '%superadmin%' or p.proname like 'plateforme\_%'))"
}

printf '\033[1mPreuves de CRM-101 — la plateforme et son superadministrateur\033[0m\n'

titre '1. Traçabilité'
for fichier in "$MIGRATION" "$SUITE" webapp/src/lib/plateforme.ts webapp/src/lib/plateforme.test.ts \
	webapp/src/app/Plateforme.tsx webapp/src/app/PlateformeEspaces.tsx webapp/src/app/PlateformeEspace.tsx \
	webapp/src/app/PlateformeSuperadmins.tsx webapp/src/app/PlateformeJournal.tsx webapp/src/app/RecherchePersonne.tsx \
	webapp/src/app/presentation-plateforme.ts webapp/src/app/Plateforme.test.tsx e2e/api/plateforme.spec.ts \
	e2e/ui/plateforme.spec.ts; do
	if head -6 "$fichier" | grep -Eq '@(spec|verifies) CRM-101'; then ok "$fichier cite CRM-101"; else fail "$fichier ne cite pas CRM-101"; fi
done

titre '2. Le catalogue, mesuré'
[ "$(psql_base -c "select count(*) from pg_class where oid in ('public.superadmins'::regclass, 'public.plateforme_journal'::regclass) and relrowsecurity")" = 2 ] \
	&& ok 'RLS activée sur superadmins et plateforme_journal' || fail 'RLS absente d’une des deux tables'
[ "$(psql_base -c "select count(*) from pg_policies where tablename in ('superadmins', 'plateforme_journal')")" = 0 ] \
	&& ok 'aucune politique : aucune lecture ni écriture par l’API' || fail 'une politique ouvre une table fermée'
[ "$(psql_base -c "select bool_or(has_table_privilege(r, t, 'select') or has_table_privilege(r, t, 'insert'))::text from unnest(array['anon','authenticated']) r, unnest(array['public.superadmins','public.plateforme_journal']) t")" = false ] \
	&& ok 'aucun privilège client sur les deux tables' || fail 'un rôle client garde un privilège'
[ "$(psql_base -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'plateforme\_%' and p.prosecdef and p.proconfig @> array['search_path=\"\"'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')")" = 14 ] \
	&& ok 'quatorze fonctions plateforme_* : SECURITY DEFINER, search_path vide, authenticated seul' \
	|| fail 'une fonction plateforme_* s’écarte de sa forme'

titre '3. Le seed'
[ "$(psql_base -c "select string_agg(sub::text, ',') from superadmins")" = '5eed0000-0000-4000-8000-000000000018' ] \
	&& ok 'Sabine Plateforme est la seule superadministratrice' || fail 'le drapeau du seed n’est pas celui attendu (seed appliqué ?)'
[ "$(psql_base -c "select count(*) from workspace_members where user_id = '5eed0000-0000-4000-8000-000000000018'")" = 0 ] \
	&& ok 'elle n’a aucune appartenance' || fail 'la superadministratrice du seed a une appartenance'
[ "$(psql_base -c "select count(*) from workspaces")" = 1 ] \
	&& ok 'le seed garde son unique espace (CRM-005)' || fail 'le seed porte plus d’un espace'

titre '4. Les suites'
if scripts/run-sql-tests.sh supabase/tests/0003_seed_socle.test.sql supabase/tests/0070_sessions_serveur.test.sql "$SUITE" >/dev/null 2>&1; then
	ok 'pgTAP : 0003, 0070 et 0084 vertes'
else
	fail 'pgTAP : une des suites 0003, 0070, 0084 est rouge'
fi
if npm run test:unit -- webapp/src/lib/plateforme.test.ts webapp/src/app/Plateforme.test.tsx supabase/functions/session supabase/functions/main >/dev/null 2>&1; then
	ok 'unitaires : la plateforme, la fonction session et l’environnement des fonctions'
else
	fail 'unitaires : une preuve est rouge'
fi
if [ "$RAPIDE" = true ]; then
	printf '  \033[33mOMIS\033[0m  preuves Playwright (API et interface) : --rapide\n'
else
	npm run e2e:api -- e2e/api/plateforme.spec.ts >/dev/null 2>&1 && ok 'API : e2e/api/plateforme.spec.ts' || fail 'API : e2e/api/plateforme.spec.ts rouge'
	npm run e2e:ui -- e2e/ui/plateforme.spec.ts >/dev/null 2>&1 && ok 'interface : e2e/ui/plateforme.spec.ts' || fail 'interface : e2e/ui/plateforme.spec.ts rouge'
fi

titre '5. Dégradations réelles, puis restauration constatée'
AVANT=$(empreinte)
TRAVAIL=$(mktemp -d)
trap 'appliquer "$MIGRATION"; rm -rf "$TRAVAIL"' EXIT

degrader() {
	local nom=$1 avant=$2 apres=$3
	python3 - "$MIGRATION" "$TRAVAIL/degradee.sql" "$avant" "$apres" <<'PY'
import sys
source, cible, avant, apres = sys.argv[1:5]
texte = open(source, encoding='utf-8').read()
if texte.count(avant) != 1:
    sys.exit(f"motif introuvable ou ambigu : {avant[:60]}")
open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
PY
	appliquer "$TRAVAIL/degradee.sql"
	if suite_verte; then fail "$nom : la suite reste verte — elle ne mord pas"; else ok "$nom : la suite rougit"; fi
	appliquer "$MIGRATION"
}

degrader 'garde levée sur plateforme_espaces' $'begin\n\tperform app.exiger_superadmin();\n\treturn query\n\tselect w.id, w.name' $'begin\n\treturn query\n\tselect w.id, w.name'
degrader 'amorçage sans contrôle de table vide' $'\tif exists (select 1 from public.superadmins) then\n\t\treturn false;\n\tend if;\n' ''
degrader 'dernier superadministrateur retirable' $'\t\tif (select pg_catalog.count(*) from public.superadmins) <= 1 then' $'\t\tif false then'

APRES=$(empreinte)
[ "$AVANT" = "$APRES" ] && ok "restauration constatée : empreinte du catalogue identique ($APRES)" || fail 'la restauration n’a pas rendu le catalogue d’avant'
suite_verte && ok 'la suite 0084 est verte après restauration' || fail 'la suite 0084 reste rouge après restauration'

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
