#!/usr/bin/env bash
# @verifies INC-177 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-177 ») — le verrou de campagne : deux commandes
#           gardées lancées de front, la seconde refusée avec le détenteur nommé ; l'ouverture en une commande ; le jeton qui
#           traverse ; le verrou mort repris ; l'attente ; la sortie de secours ; le verrou hors de l'arbre ; les gardes
#           posées aux cinq sites
# @verifies docs/SPEC-test-harness.md §3.9 ; docs/INCONSISTENCY_REPORT.md INC-177 ; docs/JOURNAL.md décision 990
#
# Éprouve `scripts/lib/campagne.sh` sans pile : le verrou de CE harnais vit dans un répertoire jetable
# (`CAMPAGNE_REPERTOIRE`), jamais dans celui d'une vraie campagne qu'il ne doit pas gêner. Les commandes réelles gardées
# (`run-sql-tests.sh`, `apply-seed.sh`, Playwright) sont lancées SOUS un verrou tenu : elles refusent avant de toucher à
# quoi que ce soit.
#
# Usage : scripts/verify-campagne.sh

set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"
CAMPAGNE="$REPO_ROOT/scripts/lib/campagne.sh"

TRAVAIL=$(mktemp -d)
export CAMPAGNE_REPERTOIRE="$TRAVAIL/verrous"
unset CAMPAGNE_JETON CAMPAGNE_FORCER CAMPAGNE_ATTENDRE
cleanup() { jobs -p | xargs -r kill 2>/dev/null; rm -rf "$TRAVAIL"; }
trap cleanup EXIT

checks=0
failures=0
ok() { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n%s\n' "$1"; }

attendre_verrou() { # attend (≤ 10 s) qu'un verrou VIVANT existe (« statut » rend 1)
	local i
	for i in $(seq 1 50); do
		"$CAMPAGNE" statut >/dev/null 2>&1
		[ "$?" = 1 ] && return 0
		sleep 0.2
	done
	return 1
}

echo
echo "Preuves du verrou de campagne — INC-177"

titre "1. Le mécanisme existe"
[ -x "$CAMPAGNE" ] && ok "scripts/lib/campagne.sh existe et s'exécute" \
	|| { fail "scripts/lib/campagne.sh est absent ou non exécutable"; printf '\n  Bilan : %s contrôles, %s anomalie(s)\n' "$checks" "$failures"; exit 1; }

titre "2. Libre, puis l'ouverture en une commande"
"$CAMPAGNE" statut >/dev/null 2>&1 && ok "sans verrou, « statut » dit libre (code 0)" || fail "« statut » ne dit pas libre"

"$CAMPAGNE" ouvrir --nom campagne-A -- sleep 25 &
POSEUR=$!
if attendre_verrou; then ok "« ouvrir » prend le verrou avant d'exécuter sa commande"; else fail "le verrou n'a pas été posé"; fi

sortie=$("$CAMPAGNE" statut 2>&1); code=$?
[ "$code" = 1 ] && printf '%s' "$sortie" | grep -q 'campagne-A' && printf '%s' "$sortie" | grep -q 'sleep 25' \
	&& ok "« statut » nomme le détenteur et sa commande (code 1)" || fail "« statut » ne nomme pas le détenteur : « $sortie »"

titre "3. DEUX COMMANDES GARDÉES DE FRONT : la seconde est refusée, avec le détenteur nommé"
sortie=$("$CAMPAGNE" garde campagne-B 2>&1); code=$?
[ "$code" = 75 ] && ok "une commande gardée sans jeton rend 75 tant qu'un verrou vivant existe" || fail "code $code au lieu de 75"
printf '%s' "$sortie" | grep -q 'campagne-A' && printf '%s' "$sortie" | grep -q 'sleep 25' \
	&& ok "le refus nomme le détenteur et sa commande" || fail "le refus ne nomme pas le détenteur : « $sortie »"
printf '%s' "$sortie" | grep -q 'CAMPAGNE_ATTENDRE' && printf '%s' "$sortie" | grep -q 'CAMPAGNE_FORCER' \
	&& ok "le refus dit les deux sorties de secours" || fail "le refus ne dit pas les sorties de secours"

for commande in "scripts/run-sql-tests.sh" "supabase/seed/apply-seed.sh"; do
	# Jamais lancée sans sa garde : sans elle, la commande s'exécuterait pour de bon sur la pile partagée.
	if ! grep -q 'campagne_garde' "$REPO_ROOT/$commande"; then
		fail "$commande n'appelle pas la garde — non lancée, pour ne rien exécuter sur la pile partagée"
		continue
	fi
	sortie=$("$REPO_ROOT/$commande" 2>&1); code=$?
	[ "$code" = 75 ] && printf '%s' "$sortie" | grep -q 'campagne-A' \
		&& ok "$commande refuse sous un verrou tenu (75, détenteur nommé), avant de toucher à la base" \
		|| fail "$commande : code $code, sortie « $(printf '%s' "$sortie" | head -2 | tr '\n' ' ') »"
done

sortie=$("$REPO_ROOT/scripts/run-sql-tests.sh" --help 2>&1); code=$?
[ "$code" = 0 ] && ok "« run-sql-tests.sh --help » n'est jamais gardé (une aide ne mesure rien)" || fail "l'aide est gardée (code $code)"

if grep -q 'campagne_garde' scripts/lib/reconstruction.sh; then
	sortie=$(bash -c 'source scripts/lib/reconstruction.sh; reconstruire_base_dev' 2>&1); code=$?
	[ "$code" = 75 ] && printf '%s' "$sortie" | grep -q 'campagne-A' \
		&& ok "reconstruire_base_dev refuse sous un verrou tenu (75), avant d'arrêter quoi que ce soit" \
		|| fail "reconstruire_base_dev : code $code — « $(printf '%s' "$sortie" | head -2 | tr '\n' ' ') »"
else
	fail "scripts/lib/reconstruction.sh n'appelle pas la garde — reconstruire_base_dev non lancée"
fi

if grep -q 'campagne.sh' e2e/playwright.config.ts; then
	sortie=$(E2E_PROJETS=api npx --no-install playwright test --config e2e/playwright.config.ts --project=api --list 2>&1); code=$?
	[ "$code" != 0 ] && printf '%s' "$sortie" | grep -q 'campagne-A' \
		&& ok "Playwright refuse de charger sa configuration sous un verrou tenu, et nomme le détenteur" \
		|| fail "Playwright n'est pas gardé (code $code) : « $(printf '%s' "$sortie" | head -2 | tr '\n' ' ') »"
else
	fail "e2e/playwright.config.ts n'appelle pas la garde — Playwright non lancé"
fi

sortie=$(CAMPAGNE_PORT_APERCU=1 "$CAMPAGNE" garde-build 2>&1); code=$?
[ "$code" = 0 ] && ok "un build n'est pas gardé tant que le port d'aperçu n'écoute pas" || fail "garde-build refuse sans port d'aperçu (code $code)"

titre "4. Le jeton traverse"
sortie=$(CAMPAGNE_REPERTOIRE="$CAMPAGNE_REPERTOIRE" "$CAMPAGNE" ouvrir --nom imbrique -- true 2>&1); code=$?
[ "$code" = 75 ] && ok "une seconde ouverture sans jeton est refusée comme n'importe quelle commande" || fail "une seconde ouverture a pris le verrou (code $code)"

wait "$POSEUR" 2>/dev/null
"$CAMPAGNE" statut >/dev/null 2>&1 && ok "à la fin de sa commande, l'ouvreur libère le verrou" || fail "le verrou n'est pas libéré après la commande"

"$CAMPAGNE" ouvrir --nom campagne-C -- bash -c '
	"'"$CAMPAGNE"'" garde enfant >/dev/null 2>&1 || exit 21
	"'"$CAMPAGNE"'" ouvrir --nom petit-enfant -- true || exit 22
	"'"$REPO_ROOT"'/scripts/run-sql-tests.sh" --help >/dev/null 2>&1 || exit 23
'
code=$?
[ "$code" = 0 ] && ok "un enfant qui présente le jeton traverse les gardes, et une ouverture imbriquée n'est pas refusée" \
	|| fail "un enfant avec jeton est refusé (code $code)"

"$CAMPAGNE" ouvrir --nom campagne-D -- bash -c 'exit 7'
[ "$?" = 7 ] && ok "« ouvrir » rend le code de sortie de la commande" || fail "« ouvrir » ne rend pas le code de sortie"
"$CAMPAGNE" statut >/dev/null 2>&1 && ok "…et libère le verrou même quand la commande échoue" || fail "le verrou reste après un échec"

titre "5. Un verrou mort est repris"
bash -c 'source "'"$CAMPAGNE"'"; campagne_garde mort >/dev/null 2>&1; kill -9 $$' 2>/dev/null
sortie=$("$CAMPAGNE" statut 2>&1); code=$?
printf '%s' "$sortie" | grep -qi 'mort' && ok "« statut » dit qu'un verrou dont le processus est mort est mort" || fail "« statut » ne reconnaît pas le verrou mort : « $sortie » (code $code)"
sortie=$("$CAMPAGNE" garde reprise 2>&1); code=$?
[ "$code" = 0 ] && printf '%s' "$sortie" | grep -qi 'repris' && ok "une commande gardée reprend un verrou mort, et le dit" || fail "le verrou mort n'est pas repris (code $code) : « $sortie »"
"$CAMPAGNE" liberer >/dev/null 2>&1

# Un script qui a déjà son trap de sortie le garde, et rend aussi le verrou (le cas de run-sql-tests.sh).
bash -c 'trap "echo trap-du-script >\"'"$TRAVAIL"'/trap\"" EXIT; source "'"$CAMPAGNE"'"; campagne_garde avec-trap >/dev/null 2>&1; true'
sortie=$("$CAMPAGNE" statut 2>&1)
[ "$sortie" = libre ] && grep -q trap-du-script "$TRAVAIL/trap" 2>/dev/null \
	&& ok "un script qui a déjà un trap de sortie le garde ET rend le verrou à sa fin" \
	|| fail "le trap de sortie du script est perdu ou le verrou reste : « $sortie »"

titre "6. L'attente, la sortie de secours, la libération"
"$CAMPAGNE" ouvrir --nom court -- sleep 4 &
POSEUR=$!
attendre_verrou
debut=$(date +%s)
CAMPAGNE_ATTENDRE=20 "$CAMPAGNE" garde patient >/dev/null 2>&1; code=$?
duree=$(( $(date +%s) - debut ))
[ "$code" = 0 ] && [ "$duree" -ge 2 ] && ok "CAMPAGNE_ATTENDRE attend la libération puis passe (${duree} s)" || fail "l'attente a rendu $code après ${duree} s"
wait "$POSEUR" 2>/dev/null

"$CAMPAGNE" ouvrir --nom long -- sleep 10 &
POSEUR=$!
attendre_verrou
sortie=$(CAMPAGNE_FORCER=1 "$CAMPAGNE" garde force 2>&1); code=$?
[ "$code" = 0 ] && printf '%s' "$sortie" | grep -qi 'forc' && ok "CAMPAGNE_FORCER=1 passe outre, et l'écrit" || fail "la sortie de secours ne marche pas (code $code)"
"$CAMPAGNE" liberer >/dev/null 2>&1; [ "$?" != 0 ] && ok "« liberer » refuse de retirer le verrou d'un processus vivant" || fail "« liberer » a retiré un verrou vivant"
"$CAMPAGNE" liberer --forcer >/dev/null 2>&1
"$CAMPAGNE" statut >/dev/null 2>&1 && ok "« liberer --forcer » retire le verrou vivant" || fail "« --forcer » ne libère pas"
kill "$POSEUR" 2>/dev/null; wait "$POSEUR" 2>/dev/null

titre "7. Le verrou vit hors de l'arbre de travail"
avant=$(git status --porcelain | md5sum)
env -u CAMPAGNE_REPERTOIRE XDG_RUNTIME_DIR="$TRAVAIL/xdg" "$CAMPAGNE" ouvrir --nom arbre -- true
apres=$(git status --porcelain | md5sum)
[ "$avant" = "$apres" ] && ok "l'état de git est identique avant et après une ouverture au répertoire par défaut" || fail "une ouverture modifie l'arbre de travail"
chemin=$(env -u CAMPAGNE_REPERTOIRE XDG_RUNTIME_DIR="$TRAVAIL/xdg" "$CAMPAGNE" chemin 2>/dev/null)
case "$chemin" in
	"$REPO_ROOT"/*) fail "le répertoire par défaut est dans l'arbre : $chemin" ;;
	"$TRAVAIL"/xdg/p2enjoy-crm-campagne/*) ok "le répertoire par défaut est hors de l'arbre, sous le répertoire d'exécution de la session" ;;
	*) fail "« chemin » rend « $chemin »" ;;
esac

titre "8. Les gardes sont posées aux cinq sites"
grep -q 'campagne_garde' scripts/run-sql-tests.sh && ok "scripts/run-sql-tests.sh appelle la garde" || fail "scripts/run-sql-tests.sh n'appelle pas la garde"
grep -q 'campagne_garde' supabase/seed/apply-seed.sh && ok "supabase/seed/apply-seed.sh appelle la garde" || fail "supabase/seed/apply-seed.sh n'appelle pas la garde"
grep -q 'campagne_garde' scripts/lib/reconstruction.sh && ok "scripts/lib/reconstruction.sh appelle la garde" || fail "scripts/lib/reconstruction.sh n'appelle pas la garde"
grep -q 'campagne.sh' e2e/playwright.config.ts && ok "e2e/playwright.config.ts appelle la garde" || fail "e2e/playwright.config.ts n'appelle pas la garde"
grep -q '"prebuild": *"[^"]*campagne.sh garde-build' package.json && ok "package.json garde « npm run build » (prebuild)" || fail "package.json ne garde pas « npm run build »"
grep -q 'verify-campagne' docs/SPEC-test-harness.md && ok "docs/SPEC-test-harness.md §3.9 nomme ce harnais" || fail "§3.9 ne nomme pas ce harnais"

printf '\n  Bilan : %s contrôles, %s anomalie(s)\n\n' "$checks" "$failures"
[ "$failures" -eq 0 ]
