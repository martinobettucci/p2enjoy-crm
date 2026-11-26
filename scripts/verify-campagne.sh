#!/usr/bin/env bash
# @verifies INC-177 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-177 ») — le verrou de campagne : deux commandes
#           gardées lancées de front, la seconde refusée avec le détenteur nommé ; l'ouverture en une commande ; le jeton qui
#           traverse ; le verrou mort repris ; l'attente ; la sortie de secours ; le verrou hors de l'arbre ; les gardes
#           posées aux cinq sites
# @verifies docs/SPEC-test-harness.md §3.9 ; docs/INCONSISTENCY_REPORT.md INC-177 ; docs/JOURNAL.md décision 990
# @verifies INC-367 (docs/BACKLOG.md « Correctif — INC-367 ») — le verrou a une durée maximale (a) et `borner` nomme un dépassement (b) :
#           docs/SPEC-test-harness.md §3.16 ; docs/INCONSISTENCY_REPORT.md INC-367
# @verifies INC-372 (docs/BACKLOG.md « Correctif — INC-372 ») — la garde du build est une affaire du poste : le script `prebuild` passe dans `node:24-alpine` (sans bash)
#           et refuse toujours un build sur le poste pendant qu'un aperçu est servi sous campagne : docs/SPEC-test-harness.md §3.19 ; docs/INCONSISTENCY_REPORT.md INC-372
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
	sortie=$(E2E_PROJETS=api npx --no-install playwright test --config e2e/playwright.config.ts --project=api --grep '^aucun-test-inexistant$' 2>&1); code=$?
	[ "$code" != 0 ] && printf '%s' "$sortie" | grep -q 'campagne-A' \
		&& ok "Playwright refuse de charger sa configuration sous un verrou tenu, et nomme le détenteur" \
		|| fail "Playwright n'est pas gardé (code $code) : « $(printf '%s' "$sortie" | head -2 | tr '\n' ' ') »"
else
	fail "e2e/playwright.config.ts n'appelle pas la garde — Playwright non lancé"
fi

sortie=$(CAMPAGNE_PORT_APERCU=1 "$CAMPAGNE" garde-build 2>&1); code=$?
[ "$code" = 0 ] && ok "un build n'est pas gardé tant que le port d'aperçu n'écoute pas" || fail "garde-build refuse sans port d'aperçu (code $code)"

# INC-372 (docs/SPEC-test-harness.md §3.19) : la garde du build est une affaire du POSTE. Sur le poste, un aperçu servi sous un verrou vivant fait refuser
# `npm run build` (script `prebuild`) ; dans l'image de la livraison (`node:24-alpine`, sans bash), le même script passe sans garde.
python3 -c "import socket,time; s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', 0)); s.listen(); print(s.getsockname()[1], flush=True); time.sleep(20)" > "$TRAVAIL/ecouteur.port" &
ECOUTEUR=$!
for _ in $(seq 1 25); do [ -s "$TRAVAIL/ecouteur.port" ] && break; sleep 0.2; done
PORT_ECOUTE=$(cat "$TRAVAIL/ecouteur.port" 2>/dev/null)
sortie=$(CAMPAGNE_PORT_APERCU="$PORT_ECOUTE" npm run --silent prebuild 2>&1); code=$?
[ "$code" != 0 ] && printf '%s' "$sortie" | grep -q 'campagne-A' \
	&& ok "sur le poste, le script prebuild refuse un build pendant qu'un aperçu est servi sous campagne, et nomme le détenteur" \
	|| fail "le script prebuild ne garde plus le build sur le poste (code $code) : « $(printf '%s' "$sortie" | head -2 | tr '\n' ' ') »"
kill "$ECOUTEUR" 2>/dev/null; wait "$ECOUTEUR" 2>/dev/null
if docker image inspect node:24-alpine >/dev/null 2>&1; then
	sortie=$(docker run --rm -v "$PWD":/src:ro -w /src node:24-alpine sh -c 'npm run --silent prebuild' 2>&1); code=$?
	[ "$code" = 0 ] && ok "dans node:24-alpine (l'image de la livraison, sans bash), le script prebuild passe : la garde est une affaire du poste" \
		|| fail "le script prebuild casse le build dans node:24-alpine (code $code) : « $(printf '%s' "$sortie" | head -2 | tr '\n' ' ') »"
else
	fail "l'image node:24-alpine est absente : docker pull node:24-alpine, puis rejouer (la preuve INC-372 ne peut pas être jouée)"
fi

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

titre "9. Aucun harnais sans borne de temps — INC-367"
# a) la durée maximale du verrou : une commande qui ne finit pas est arrêtée, nommée, et le verrou est libéré.
debut=$(date +%s)
sortie=$("$CAMPAGNE" ouvrir --nom bornee --duree-max 2 -- bash -c 'sleep 60 & wait' 2>&1); code=$?
duree=$(( $(date +%s) - debut ))
[ "$code" = 124 ] && [ "$duree" -lt 20 ] && ok "une commande qui dépasse la durée maximale est arrêtée (code 124, ${duree} s)" \
	|| fail "la durée maximale n'arrête pas la commande (code $code, ${duree} s)"
printf '%s' "$sortie" | grep -q 'durée maximale dépassée' && printf '%s' "$sortie" | grep -q 'bornee' \
	&& ok "…et le dit, en nommant la campagne" || fail "le dépassement n'est pas nommé : « $sortie »"
"$CAMPAGNE" statut >/dev/null 2>&1 && ok "…et libère le verrou" || fail "le verrou reste après un dépassement"
sleep 1
pgrep -f 'sleep 60' >/dev/null && fail "un descendant de la commande est resté vivant" || ok "…et aucun descendant de la commande ne reste vivant"
"$CAMPAGNE" ouvrir --nom rapide --duree-max 30 -- bash -c 'exit 5'
[ "$?" = 5 ] && ok "sous la borne, le code de sortie de la commande est rendu tel quel" || fail "la borne altère le code de sortie"
CAMPAGNE_DUREE_MAX=2 "$CAMPAGNE" ouvrir --nom par-variable -- sleep 30 >/dev/null 2>&1
[ "$?" = 124 ] && ok "CAMPAGNE_DUREE_MAX règle la même borne" || fail "CAMPAGNE_DUREE_MAX n'est pas lue"
refus_attendus=1
for invalide in 0 -3 abc ''; do
	"$CAMPAGNE" ouvrir --duree-max "$invalide" -- true >/dev/null 2>&1
	[ "$?" = 64 ] || { fail "une durée maximale « $invalide » n'est pas refusée"; refus_attendus=0; }
done
[ "$refus_attendus" = 1 ] && ok "une durée maximale nulle, négative, vide ou non numérique est refusée (code 64)"

# a bis) une commande qui finit AVANT la durée maximale (en échec ou non) garde son code et son silence : le veilleur arrêté avec elle ne déclare
#        jamais un dépassement (défaut relevé par la session de livraison : « durée maximale dépassée » et 124 pour une commande en échec).
anomalies_veilleur=0
for i in $(seq 1 40); do
	sortie=$("$CAMPAGNE" ouvrir --nom courte -- bash -c 'sleep 0.2; exit 7' 2>&1); code=$?
	[ "$code" = 7 ] && [ -z "$sortie" ] || { anomalies_veilleur=$((anomalies_veilleur + 1)); dernier="code $code, « $sortie »"; }
done
[ "$anomalies_veilleur" = 0 ] && ok "40 commandes en échec avant la borne : code 7 rendu, aucun message de dépassement" \
	|| fail "$anomalies_veilleur commande(s) sur 40 rapportent un dépassement ou un autre code : $dernier"
sortie=$("$CAMPAGNE" ouvrir --nom courte-ok -- bash -c 'sleep 0.2' 2>&1); code=$?
[ "$code" = 0 ] && [ -z "$sortie" ] && ok "une commande réussie avant la borne rend 0, sans message" || fail "commande réussie : code $code, « $sortie »"

# b) `borner` : la borne d'une commande qui peut bloquer, l'échec nommé.
source "$REPO_ROOT/scripts/lib/borne.sh" 2>/dev/null || fail "scripts/lib/borne.sh est absent"
if declare -F borner >/dev/null; then
	debut=$(date +%s)
	sortie=$(borner 2 sleep 60 2>&1); code=$?
	duree=$(( $(date +%s) - debut ))
	[ "$code" = 124 ] && [ "$duree" -lt 15 ] && ok "borner arrête une commande qui bloque (code 124, ${duree} s)" || fail "borner n'arrête pas la commande (code $code, ${duree} s)"
	printf '%s' "$sortie" | grep -q 'DÉLAI DÉPASSÉ' && printf '%s' "$sortie" | grep -q 'sleep 60' \
		&& ok "…et nomme le délai et la commande" || fail "borner ne nomme pas le dépassement : « $sortie »"
	borner 30 bash -c 'exit 3'; [ "$?" = 3 ] && ok "borner rend le code de la commande quand elle finit à temps" || fail "borner altère le code"
	sortie=$(borner 30 printf 'a b') ; [ "$sortie" = 'a b' ] && ok "borner transmet la sortie de la commande" || fail "borner altère la sortie"
else
	fail "borner n'existe pas"
fi

printf '\n  Bilan : %s contrôles, %s anomalie(s)\n\n' "$checks" "$failures"
[ "$failures" -eq 0 ]
