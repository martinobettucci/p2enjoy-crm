#!/usr/bin/env bash
# @verifies CRM-077 (docs/BACKLOG.md) — Definition of Done de la corbeille et de la restauration
# @verifies docs/SPEC-corbeille.md §5 (preuves attendues), §5 bis (contrat de CE harnais),
#           §3.5 (l'énumération), §4.2 (les trois lectures de l'écran), §4.5 (les trois issues de
#           la restauration), §4 ter.3 (les trois issues du geste d'une affaire)
# @verifies docs/SPEC-test-harness.md §1 (un harnais qui rend vert sans rien exercer est pire
#           qu'une commande absente), §7.1 (chaîne Node Linux), §7.2 point 9 (restauration
#           constatée octet à octet, jamais comparée à HEAD)
# @verifies CLAUDE.md §16 (vérification visuelle), §17 (Definition of Done)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les douze fichiers de l'unité portent leur traçabilité ;
#   2. les captures des quatre paliers, l'état vide et les deux états dédiés du geste ;
#   3. pgTAP : les deux suites de l'unité, fichiers ET assertions figés (décision 279) ;
#   4. Vitest : le modèle et l'écran de corbeille, fichiers ET tests figés ;
#   5. Vitest : le geste sur la route de détail d'une affaire ;
#   6. l'API : les trois profils, jetons réels, hors interface ;
#   7. l'UI : les gestes au clavier et à la souris, console stricte ;
#   8. le harnais est NON COMPLAISANT : quatre dégradations réelles de webapp/src/lib/corbeille.ts
#      doivent faire rougir la suite unitaire, et la restauration est CONSTATÉE octet à octet.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit (docs/SPEC-corbeille.md §5 bis.3).
# ---------------------------------------------------------------------------------------------
# AUCUNE RÈGLE D'AUTORISATION N'EST RÉÉCRITE ICI : les politiques de `cards`, `tracks` et `channels`
# appartiennent à CRM-040, CRM-020 et CRM-021 et sont prouvées par leurs harnais. Ce que CRM-077
# ajoute — les trois refus `42501` sur `deleted_by`, la garde `parent_en_corbeille` — est porté par
# les deux suites pgTAP rejouées au contrôle 3.
# AUCUN EFFACEMENT DÉFINITIF, AUCUNE RÉTENTION : le §6 de la spécification n'est pas arbitré, et un
# harnais ne tranche pas ce qu'une spécification laisse ouvert.
# AUCUNE CONVERGENCE DU SEED : elle appartient à scripts/verify-seed-demo.sh.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-corbeille.sh
#   scripts/verify-corbeille.sh --rapide   n'exécute pas Playwright

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION_MODELE=supabase/migrations/0037_corbeille.sql
MIGRATION_GARDE=supabase/migrations/0038_corbeille_restauration.sql
LIB=webapp/src/lib/corbeille.ts
ECRAN=webapp/src/app/Corbeille.tsx
ROUTE_CARD=webapp/src/app/RouteCard.tsx
TEST_SQL_MODELE=supabase/tests/0035_corbeille.test.sql
TEST_SQL_GARDE=supabase/tests/0036_corbeille_restauration.test.sql
TEST_LIB=webapp/src/lib/corbeille.test.ts
TEST_ECRAN=webapp/src/app/Corbeille.test.tsx
TEST_ROUTE_CARD=webapp/src/app/RouteCard.test.tsx
SPEC_API=e2e/api/corbeille.spec.ts
SPEC_UI=e2e/ui/corbeille.spec.ts
CAPTURES=docs/captures/CRM-077

# Les comptes figés du §5 bis.1. Ils se mettent à jour DANS LE MÊME CHANGEMENT que la preuve
# ajoutée : un compte qui monte est un écart au même titre qu'un compte qui descend.
SQL_FICHIERS_ATTENDUS=2
SQL_ASSERTIONS_ATTENDUES=20
VITEST_CORBEILLE_FICHIERS=2
VITEST_CORBEILLE_TESTS=39
VITEST_ROUTE_CARD_FICHIERS=1
VITEST_ROUTE_CARD_TESTS=7
API_SCENARIOS_ATTENDUS=22
UI_SCENARIOS_ATTENDUS=24

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,40p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0; checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

TRAVAIL=$(mktemp -d)
RAPPORTS=e2e/output/verify-corbeille
mkdir -p "$RAPPORTS"
fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}

# L'instantané est pris AVANT toute dégradation, et la restauration s'y compare octet à octet. La
# comparaison à `HEAD` est interdite : ce harnais doit fonctionner dans un arbre portant une
# évolution légitime non encore committée, et ne doit ni la déclarer résiduelle ni la remplacer
# (docs/SPEC-test-harness.md §7.2 point 9).
SAUVEGARDES="$TRAVAIL/sauvegardes"; mkdir -p "$SAUVEGARDES"
empreinte() { printf '%s' "$1" | tr '/' '@'; }
sauvegarder() { cp "$1" "$SAUVEGARDES/$(empreinte "$1")"; }
rendre() { cp "$SAUVEGARDES/$(empreinte "$1")" "$1"; }
restaurer() {
	for fichier in "$SAUVEGARDES"/*; do
		[ -e "$fichier" ] || continue
		cp "$fichier" "$(basename "$fichier" | tr '@' '/')"
	done
	rm -rf "$TRAVAIL"
}
trap restaurer EXIT

printf '\033[1mPreuves de CRM-077 — corbeille et restauration\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

FICHIERS_CODE=("$MIGRATION_MODELE" "$MIGRATION_GARDE" "$LIB" "$ECRAN" "$ROUTE_CARD")
FICHIERS_PREUVE=("$TEST_SQL_MODELE" "$TEST_SQL_GARDE" "$TEST_LIB" "$TEST_ECRAN" "$TEST_ROUTE_CARD" \
	"$SPEC_API" "$SPEC_UI")

for fichier in "${FICHIERS_CODE[@]}" "${FICHIERS_PREUVE[@]}"; do
	if [ ! -f "$fichier" ]; then fail "$fichier est ABSENT"; fi
done

# Le chemin ENTIER est affiché, jamais le seul nom de base : `e2e/api/corbeille.spec.ts` et
# `e2e/ui/corbeille.spec.ts` le partagent, et deux lignes identiques ne diraient pas laquelle des
# deux a été contrôlée.
#
# `entete` rend l'en-tête COMPLET d'un fichier — ses lignes de commentaire et ses lignes vides,
# jusqu'à la première ligne de code — et non ses trois premières lignes. Le contrôle employait
# `head -3`, fenêtre qui suffisait quand un fichier ne servait qu'une unité, et qui a cessé de
# suffire : `webapp/src/app/RouteCard.tsx` est le point d'ancrage de la fiche d'affaire et cumule
# DIX commentaires `@spec` — CRM-037, CRM-040, CRM-060, CRM-085, CRM-043, CRM-077, CRM-041,
# CRM-081, CRM-036 —, si bien que `@spec CRM-077`, cité ligne 11 comme il doit l'être, tombait
# hors de la fenêtre et rendait le contrôle ROUGE sur un fichier CONFORME. C'est INC-192, mesurée
# le 2026-08-20 et corrigée ici, sous l'unité que ce harnais éprouve. La règle que le contrôle
# tient est inchangée — la citation vit dans l'EN-TÊTE, jamais au milieu du code —, seule sa
# fenêtre de lecture cesse d'être arbitraire. Le contrôle reste donc non complaisant : une
# citation posée après la première ligne de code n'est toujours pas vue.
entete() {
	awk '{
		ligne = $0
		sub(/^[ \t]+/, "", ligne)
		if (ligne == "" || ligne ~ /^(\/\/|--|\*|\/\*)/) { print; next }
		exit
	}' "$1"
}

for fichier in "${FICHIERS_CODE[@]}"; do
	if [ -f "$fichier" ] && entete "$fichier" | grep -q '@spec CRM-077'; then
		ok "$fichier porte son commentaire @spec"
	else
		fail "$fichier ne cite pas CRM-077 en tête de fichier"
	fi
done
for fichier in "${FICHIERS_PREUVE[@]}"; do
	if [ -f "$fichier" ] && entete "$fichier" | grep -q '@verifies CRM-077'; then
		ok "$fichier porte son commentaire @verifies"
	else
		fail "$fichier ne cite pas CRM-077"
	fi
done

titre "2. Captures observées (CLAUDE.md §16)"

# Les quatre paliers de l'écran, ceux des deux confirmations, puis les trois états qui n'existent
# qu'une fois : l'état VIDE — cas normal d'une corbeille saine (§4.6) — et les deux états dédiés
# que le geste d'une affaire rend sur sa route de détail (§4 ter.3, §4 ter.5).
for palier in xl-1440 lg-1152 md-900 sm-390; do
	for prefixe in corbeille corbeille-geste-confirmation card-geste-confirmation; do
		if [ -f "$CAPTURES/$prefixe-$palier.jpg" ]; then
			ok "capture $prefixe $palier livrée"
		else
			fail "capture $prefixe $palier ABSENTE : la Definition of Done exige les quatre paliers"
		fi
	done
done
for capture in corbeille-etat-vide card-affaire-retiree card-geste-sans-effet; do
	if [ -f "$CAPTURES/$capture.jpg" ]; then
		ok "capture $capture livrée"
	else
		fail "capture $capture ABSENTE"
	fi
done

titre "3. pgTAP — le modèle et la garde de restauration"

if npm run test:sql -- "$TEST_SQL_MODELE" "$TEST_SQL_GARDE" >"$TRAVAIL/sql.log" 2>&1; then
	resume=$(grep -oE '[0-9]+ fichiers?, [0-9]+ assertions' "$TRAVAIL/sql.log" | tail -1)
	fichiers=$(printf '%s' "$resume" | grep -oE '^[0-9]+')
	assertions=$(printf '%s' "$resume" | grep -oE '[0-9]+ assertions' | grep -oE '^[0-9]+')
	if [ "${fichiers:-0}" -eq "$SQL_FICHIERS_ATTENDUS" ] \
		&& [ "${assertions:-0}" -eq "$SQL_ASSERTIONS_ATTENDUES" ]; then
		ok "pgTAP : $resume, conformes aux comptes figés du §5 bis.1"
	else
		fail "pgTAP vert mais les comptes ont changé : « $resume » au lieu de $SQL_FICHIERS_ATTENDUS fichiers / $SQL_ASSERTIONS_ATTENDUES assertions — mettez le §5 bis.1 à jour dans le même changement"
	fi
else
	fail_journal "les suites pgTAP de la corbeille ÉCHOUENT" "$TRAVAIL/sql.log"
fi

# Compte les fichiers et les tests d'une exécution Vitest, et les compare aux valeurs figées.
vitest_fige() {
	local filtre=$1 fichiers_attendus=$2 tests_attendus=$3 libelle=$4 journal=$5
	if ! npm run test:unit -- --run "$filtre" >"$journal" 2>&1; then
		fail_journal "vitest « $filtre » ($libelle) ÉCHOUE" "$journal"
		return
	fi
	local fichiers tests
	fichiers=$(grep -oE 'Test Files +[0-9]+ passed' "$journal" | tail -1 | grep -oE '[0-9]+' | tail -1)
	tests=$(grep -oE 'Tests +[0-9]+ passed' "$journal" | tail -1 | grep -oE '[0-9]+' | tail -1)
	if [ "${fichiers:-0}" -eq "$fichiers_attendus" ] && [ "${tests:-0}" -eq "$tests_attendus" ]; then
		local mot=fichiers
		[ "$fichiers" -eq 1 ] && mot=fichier
		ok "vitest « $filtre » : ${fichiers} ${mot}, ${tests} tests ($libelle)"
	else
		fail "vitest « $filtre » vert mais les comptes ont changé : ${fichiers:-?} fichiers / ${tests:-?} tests au lieu de $fichiers_attendus / $tests_attendus — mettez le §5 bis.1 à jour dans le même changement"
	fi
}

titre "4. Vitest — le modèle de la corbeille et son écran"
vitest_fige corbeille "$VITEST_CORBEILLE_FICHIERS" "$VITEST_CORBEILLE_TESTS" \
	"$TEST_LIB + $TEST_ECRAN" "$TRAVAIL/vitest-corbeille.log"

titre "5. Vitest — le geste sur la route de détail d'une affaire"
vitest_fige RouteCard "$VITEST_ROUTE_CARD_FICHIERS" "$VITEST_ROUTE_CARD_TESTS" \
	"$TEST_ROUTE_CARD" "$TRAVAIL/vitest-routecard.log"

if [ "$RAPIDE" = true ]; then
	titre "6. Preuves longues"
	ok "--rapide : Playwright n'est pas exécuté (annoncé, non masqué)"
else
	titre "6. API — les trois profils, jetons réels, hors interface"

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		scenarios=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '^[0-9]+')
		if [ "${scenarios:-0}" -eq "$API_SCENARIOS_ATTENDUS" ]; then
			ok "e2e api ($SPEC_API) : $scenarios scénarios, jetons réels des trois profils"
		else
			fail "e2e api vert mais le compte a changé : ${scenarios:-?} au lieu de $API_SCENARIOS_ATTENDUS — mettez le §5 bis.1 à jour dans le même changement"
		fi
	else
		fail_journal "les scénarios d'API de la corbeille ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	titre "7. UI — les gestes au clavier et à la souris, console stricte"

	if E2E_PROJETS=ui npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		scenarios=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1 | grep -oE '^[0-9]+')
		if [ "${scenarios:-0}" -eq "$UI_SCENARIOS_ATTENDUS" ]; then
			ok "e2e ui ($SPEC_UI) : $scenarios scénarios, console VIERGE"
		else
			fail "e2e ui vert mais le compte a changé : ${scenarios:-?} au lieu de $UI_SCENARIOS_ATTENDUS — mettez le §5 bis.1 à jour dans le même changement"
		fi
	else
		fail_journal "le parcours d'interface de la corbeille ÉCHOUE" "$TRAVAIL/ui.log"
	fi
fi

titre "8. Non-complaisance — quatre dégradations réelles (§5 bis.2)"

if npm run test:unit -- --run corbeille >"$TRAVAIL/temoin.log" 2>&1; then
	ok "témoin : la suite du modèle est VERTE avant toute dégradation"
else
	fail_journal "témoin ROUGE : la suite ne mesure plus rien" "$TRAVAIL/temoin.log"
fi

# Une dégradation NON VUE est un échec du harnais : elle dit que la preuve censée tenir la règle ne
# la tient pas. Le remède est alors d'écrire la preuve manquante, jamais de retirer la dégradation.
degrader() {
	local libelle=$1 motif=$2 remplacement=$3
	sauvegarder "$LIB"
	if ! sed -i "s|$motif|$remplacement|" "$LIB" || ! grep -qF "$remplacement" "$LIB"; then
		fail "dégradation INAPPLICABLE : $libelle"
		rendre "$LIB"
		return
	fi
	if npm run test:unit -- --run corbeille >"$TRAVAIL/degrade.log" 2>&1; then
		fail "dégradation NON VUE : $libelle"
	else
		ok "dégradation vue : $libelle"
	fi
	rendre "$LIB"
}

# LE FILTRE DE LA CORBEILLE (§4.2) : sans lui, l'écran listerait les objets VIVANTS à côté des
# retirés, et proposerait de « restaurer » ce qui n'a jamais été retiré.
degrader "le filtre deleted_at=not.is.null disparaît — la corbeille montrerait les objets vivants" \
	"\.not('deleted_at', 'is', null)" ""

# L'OMISSION DES LIGNES NULLES (§3.5) : sans elle, la confirmation afficherait « 0 channel », que
# le §3.5 exclut — deux lectures pour comprendre qu'il n'y a rien.
degrader "les lignes à compte nul cessent d'être omises — « 0 channel » réapparaîtrait" \
	"if (enumeration.channels > 0)" "if (enumeration.channels >= 0)"

# LE REFUS NOMMÉ (§4.5) : sans sa reconnaissance, la garde de 0038 retomberait en « unknown » et
# l'écran ne dirait plus QUOI restaurer d'abord.
degrader "parent_en_corbeille n'est plus reconnu — le refus ne dirait plus quoi restaurer d'abord" \
	"code === 'P0001' \&\& detail.includes(NOM_REFUS_PARENT)" "false"

# LA TROISIÈME ISSUE (§4 ter.3, décision 70) : sans elle, un retrait filtré par la clause `USING`
# — `200` et `[]` — serait annoncé comme FAIT.
degrader "la branche « sans effet » du geste disparaît — un retrait sans effet serait annoncé fait" \
	"if (reponse.data !== null \&\& reponse.data.length === 0) return { statut: 'sans-effet' }" \
	"if (false) return { statut: 'sans-effet' }"

titre "9. Restauration CONSTATÉE, pas supposée"

residuel=0
for fichier in "$SAUVEGARDES"/*; do
	[ -e "$fichier" ] || continue
	cible=$(basename "$fichier" | tr '@' '/')
	if cmp -s "$fichier" "$cible"; then
		ok "$cible est identique OCTET À OCTET à l'instantané pris avant dégradation"
	else
		fail "$cible DIFFÈRE de l'instantané : une dégradation n'a pas été rendue"
		residuel=1
	fi
done
[ "$residuel" -eq 0 ] || printf '        (comparaison à l’instantané, jamais à HEAD)\n'

if npm run test:unit -- --run corbeille >"$TRAVAIL/restaure.log" 2>&1; then
	ok "les preuves redeviennent vertes après restauration"
else
	fail_journal "les preuves restent ROUGES après restauration" "$TRAVAIL/restaure.log"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
