#!/usr/bin/env bash
# @verifies CRM-123 (docs/BACKLOG.md) — tranches T2 et T3 : le harnais du préfixe des adresses d'affaire
# @verifies docs/SPEC-cards.md §3.6 (points 1 à 11) ; docs/SPEC-plateforme.md §6.1, §6.2 ; docs/SCHEMA.md « Migration
#           `0144` » ; docs/DESIGN_SYSTEM.md §5.56 ; CLAUDE.md §10 (refus prouvés hors interface), §18 (preuves non
#           complaisantes)
#
# Rejoue les preuves de l'unité sur la pile de développement, puis DÉGRADE réellement la base et exige que la suite
# pgTAP rougisse, avant de la restaurer et de CONSTATER la restauration par une empreinte du catalogue.
#
#   1. traçabilité : chaque fichier de l'unité porte son `@spec` ou son `@verifies` ;
#   2. le catalogue, MESURÉ : la colonne et sa contrainte, la contrainte de la card, les fonctions et leurs droits ;
#   3. le seed : l'espace seedé garde « c- », et toutes ses adresses sont à cette forme ;
#   4. les suites : pgTAP 0134, unitaires, API et interface ;
#   5. trois dégradations réelles de `0144` — garde levée, préfixe ignoré à la génération, régénération qui réécrit
#      aussi les adresses conformes —, chacune rouge, puis la restauration constatée.
#
# Le script ne démarre ni n'arrête rien : la pile doit tourner (`./runDev.sh`) et le seed être appliqué.
#
# Usage :
#   scripts/verify-prefixe-adresses.sh             tout
#   scripts/verify-prefixe-adresses.sh --rapide    sans les preuves Playwright (API et interface), et le dit
#   scripts/verify-prefixe-adresses.sh --help

set -euo pipefail
cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/conteneur.sh
source scripts/lib/conteneur.sh
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

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

MIGRATION=supabase/migrations/0144_prefixe_adresses_affaires.sql
SUITE=supabase/tests/0134_prefixe_adresses_affaires.test.sql
psql_base() { docker exec -i "$(conteneur db)" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
suite_verte() { scripts/run-sql-tests.sh "$SUITE" >/dev/null 2>&1; }
empreinte() {
	psql_base -c "select md5(string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid)
	                || (select string_agg(r || ':' || has_function_privilege(r, p.oid, 'execute')::text, ',' order by r)
	                      from unnest(array['anon', 'authenticated', 'service_role']) r), '|' order by p.oid::regprocedure::text))
	                from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	               where (n.nspname = 'public' and p.proname in ('plateforme_espaces', 'plateforme_modifier_espace', 'platform_regenerate_card_addresses'))
	                  or (n.nspname = 'app' and (p.proname like 'card\_address\_%' or p.proname = 'cards_generer_email_local_part'))"
}

printf '\033[1mPreuves de CRM-123 — le préfixe des adresses d’affaire\033[0m\n'

titre '1. Traçabilité'
for fichier in "$MIGRATION" "$SUITE" e2e/api/prefixe-adresses.spec.ts e2e/ui/prefixe-adresses.spec.ts; do
	if head -3 "$fichier" | grep -Eq '@(spec|verifies) CRM-123'; then ok "$fichier cite CRM-123"; else fail "$fichier ne cite pas CRM-123"; fi
done
for fichier in webapp/src/lib/plateforme.ts webapp/src/lib/plateforme.test.ts webapp/src/app/PlateformeEspace.tsx \
	webapp/src/app/presentation-plateforme.ts webapp/src/app/Plateforme.test.tsx e2e/mail/ingestion.spec.ts \
	supabase/seed/apply-seed.sh scripts/verify-plateforme.sh; do
	if head -20 "$fichier" | grep -Eq '@(spec|verifies) CRM-123'; then ok "$fichier cite CRM-123"; else fail "$fichier ne cite pas CRM-123"; fi
done

titre '2. Le catalogue, mesuré'
[ "$(psql_base -c "select column_default || '|' || is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'workspaces' and column_name = 'card_address_prefix'")" = "'c-'::text|NO" ] \
	&& ok 'workspaces.card_address_prefix : non nulle, « c- » par défaut' || fail 'la colonne du préfixe s’écarte de sa forme'
[ "$(psql_base -c "select count(*) from pg_constraint where conname = 'workspaces_card_address_prefix_check'")" = 1 ] \
	&& ok 'la contrainte de forme du préfixe est posée' || fail 'la contrainte de forme du préfixe manque'
[ "$(psql_base -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'cards_email_local_part_check'")" = "CHECK ((email_local_part ~ '^[a-z0-9][a-z0-9._+-]{0,23}[0-9abcdefghjkmnpqrstvwxyz]{8}\$'::text))" ] \
	&& ok 'la contrainte de la card admet tout préfixe conforme, suivi du jeton' || fail 'la contrainte de la card n’est pas celle de 0144'
[ "$(psql_base -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('plateforme_espaces', 'plateforme_modifier_espace', 'platform_regenerate_card_addresses') and p.prosecdef and p.proconfig @> array['search_path=\"\"'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')")" = 3 ] \
	&& ok 'trois fonctions : SECURITY DEFINER, search_path vide, authenticated sans anon' || fail 'une des trois fonctions s’écarte de sa forme'
[ "$(psql_base -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'plateforme_modifier_espace'")" = 1 ] \
	&& ok 'une seule signature de plateforme_modifier_espace : l’ancienne est retirée' || fail 'deux signatures de plateforme_modifier_espace coexistent'
[ "$(psql_base -c "select bool_or(has_column_privilege(r, 'public.workspaces', 'card_address_prefix', 'update'))::text from unnest(array['anon','authenticated']) r")" = false ] \
	&& ok 'aucun rôle client n’écrit la colonne' || fail 'un rôle client écrit la colonne du préfixe'

titre '3. Le seed'
[ "$(psql_base -c "select card_address_prefix from workspaces where id = '5eed0000-0000-4000-8000-000000000001'")" = 'c-' ] \
	&& ok 'l’espace seedé garde « c- »' || fail 'l’espace seedé n’a pas le préfixe « c- » (seed appliqué ?)'
[ "$(psql_base -c "select count(*) from cards where workspace_id = '5eed0000-0000-4000-8000-000000000001' and email_local_part !~ '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}\$'")" = 0 ] \
	&& ok 'toutes les adresses seedées sont à la forme « c- »' || fail 'une adresse seedée s’écarte de la forme « c- »'

titre '4. Les suites'
suite_verte && ok "pgTAP : $SUITE verte" || fail "pgTAP : $SUITE rouge"
if npm run test:unit -- webapp/src/lib/plateforme.test.ts webapp/src/app/Plateforme.test.tsx webapp/src/i18n/i18n.test.ts >/dev/null 2>&1; then
	ok 'unitaires : la plateforme et la traduction'
else
	fail 'unitaires : une preuve est rouge'
fi
if [ "$RAPIDE" = true ]; then
	printf '  \033[33mOMIS\033[0m  preuves Playwright (API et interface) : --rapide\n'
else
	npm run e2e:api -- e2e/api/prefixe-adresses.spec.ts >/dev/null 2>&1 && ok 'API : e2e/api/prefixe-adresses.spec.ts' || fail 'API : e2e/api/prefixe-adresses.spec.ts rouge'
	npm run e2e:ui -- e2e/ui/prefixe-adresses.spec.ts >/dev/null 2>&1 && ok 'interface : e2e/ui/prefixe-adresses.spec.ts' || fail 'interface : e2e/ui/prefixe-adresses.spec.ts rouge'
fi

titre '5. Dégradations réelles, puis restauration constatée'
AVANT=$(empreinte)
TRAVAIL=$(mktemp -d)
appliquer_strict() { psql_base -q -v ON_ERROR_STOP=1 --single-transaction <"$1" >/dev/null 2>&1; }
# Le seul bloc `create or replace function` de `0144` qui porte le motif : jamais la migration entière, dont le rejeu
# retirerait et recréerait `plateforme_espaces` (docs/SPEC-test-harness.md §3.6).
bloc_de_fonction() {
	python3 - "$MIGRATION" "$1" "$2" <<'PY'
import sys
source, motif, cible = sys.argv[1:4]
texte = open(source, encoding='utf-8').read()
if texte.count(motif) != 1:
    sys.exit(f"motif introuvable ou ambigu : {motif[:60]}")
position = texte.index(motif)
debut = texte.rfind('create or replace function', 0, position)
fin = texte.index('\n$$;\n', position) + len('\n$$;\n')
open(cible, 'w', encoding='utf-8').write(texte[debut:fin])
PY
}
BLOCS_ORIGINE=()
restaurer_blocs() { local bloc; for bloc in "${BLOCS_ORIGINE[@]}"; do appliquer_strict "$bloc"; done; }
trap 'restaurer_blocs; rm -rf "$TRAVAIL"' EXIT

degrader() {
	local nom=$1 avant=$2 apres=$3 origine="$TRAVAIL/origine-$((${#BLOCS_ORIGINE[@]} + 1)).sql"
	if ! bloc_de_fonction "$avant" "$origine"; then
		fail "$nom : le motif ne désigne pas un seul bloc de fonction — contrôle non concluant"
		return
	fi
	BLOCS_ORIGINE+=("$origine")
	python3 - "$origine" "$TRAVAIL/degradee.sql" "$avant" "$apres" <<'PY'
import sys
source, cible, avant, apres = sys.argv[1:5]
texte = open(source, encoding='utf-8').read()
open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
PY
	if ! appliquer_strict "$TRAVAIL/degradee.sql"; then
		fail "$nom : la dégradation ne s'applique pas — contrôle non concluant"
		return
	fi
	if suite_verte; then fail "$nom : la suite reste verte — elle ne mord pas"; else ok "$nom : la suite rougit"; fi
	appliquer_strict "$origine" || fail "$nom : le bloc d'origine ne se réapplique pas"
}

degrader 'garde levée sur la régénération' \
	$'begin\n\tperform app.exiger_superadmin();\n\tperform app.plateforme_espace_existe(p_workspace_id);' \
	$'begin\n\tperform app.plateforme_espace_existe(p_workspace_id);'
degrader 'préfixe de l’espace ignoré à la génération' \
	'(select w.card_address_prefix from public.workspaces w where w.id = new.workspace_id)' \
	'null::text'
degrader 'régénération qui réécrit aussi les adresses conformes' \
	$'\t\t   and not app.card_address_has_prefix(c.email_local_part, prefixe)\n' \
	''

APRES=$(empreinte)
[ "$AVANT" = "$APRES" ] && ok "restauration constatée : empreinte du catalogue identique ($APRES)" || fail 'la restauration n’a pas rendu le catalogue d’avant'
suite_verte && ok "la suite $SUITE est verte après restauration" || fail "la suite $SUITE reste rouge après restauration"

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
