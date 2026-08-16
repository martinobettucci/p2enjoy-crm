#!/usr/bin/env bash
# @verifies CRM-079 (docs/BACKLOG.md) — Definition of Done du guide de démarrage
# @verifies docs/SPEC-onboarding.md §8 (preuves attendues), §8 bis (contrat de CE harnais),
#           §3 (les cinq étapes et leurs filtres), §3.2 (cinq comptages indépendants),
#           §4.4 (aucune mesure sans session), §6.2 (les trois états d'une étape)
# @verifies docs/SPEC-test-harness.md §1 (un harnais qui rend vert sans rien exercer est pire
#           qu'une commande absente), §7.1 (chaîne Node Linux), §7.2 point 9 (restauration
#           constatée octet à octet, jamais comparée à HEAD)
# @verifies CLAUDE.md §16 (vérification visuelle), §17 (Definition of Done)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les sept fichiers de l'unité portent leur traçabilité ;
#   2. les neuf captures : les quatre paliers, plus les cinq états qui n'existent qu'une fois ;
#   3. Vitest : le module de mesure et l'écran, fichiers ET tests figés (décision 279) ;
#   4. l'API : les trois faits du §3.1 hors interface, jetons réels des trois profils ;
#   5. l'UI : clavier seul, mobile, masquage et reprise, console stricte ;
#   6. le harnais est NON COMPLAISANT : cinq dégradations réelles des deux fichiers de l'unité
#      doivent faire rougir la suite unitaire, et la restauration est CONSTATÉE octet à octet.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit (docs/SPEC-onboarding.md §8 bis.3).
# ---------------------------------------------------------------------------------------------
# AUCUN COMPTE pgTAP N'EST FIGÉ, et c'est une propriété de l'unité : `CRM-079` n'ajoute AUCUNE
# migration et n'ouvre AUCUNE politique. Ses cinq lectures sont régies par les politiques de
# CRM-020, CRM-021, CRM-040, CRM-022 et CRM-052, prouvées par leurs propres suites. Les rejouer
# ici mesurerait le travail d'autres unités.
# AUCUNE CONVERGENCE DU SEED : elle appartient à scripts/verify-seed-demo.sh. Les écarts du
# `viewer` (§3.1) sont le fait du BACKEND, et le contrôle 4 les constate sans les corriger.
# AUCUNE OBSERVATION VISUELLE : le contrôle 2 constate que les captures EXISTENT. Les regarder
# reste un geste humain (CLAUDE.md §16), qu'aucun script ne remplace.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
# Le projet `ui` exige un navigateur : `PLAYWRIGHT_CHROMIUM_PATH` doit désigner celui de l'hôte
# lorsque la version épinglée n'y est pas installée (INC-123, docs/INCONSISTENCY_REPORT.md).
#
# Usage :
#   scripts/verify-onboarding.sh
#   scripts/verify-onboarding.sh --rapide   n'exécute pas Playwright

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

LIB=webapp/src/lib/demarrage.ts
ECRAN=webapp/src/app/GuideDemarrage.tsx
TEST_LIB=webapp/src/lib/demarrage.test.ts
TEST_ECRAN=webapp/src/app/GuideDemarrage.test.tsx
SPEC_API=e2e/api/demarrage.spec.ts
SPEC_UI=e2e/ui/demarrage.spec.ts
CAPTURES=docs/captures/CRM-079

# Les comptes figés du §8 bis.1, mesurés le 2026-08-16. Ils se mettent à jour DANS LE MÊME
# CHANGEMENT que la preuve ajoutée : un compte qui monte est un écart au même titre qu'un compte
# qui descend. Les FICHIERS sont figés autant que les tests — vérifier les seuls tests ne détecte
# pas la disparition d'une suite entière (décision 279).
VITEST_FICHIERS_ATTENDUS=2
VITEST_TESTS_ATTENDUS=43
API_SCENARIOS_ATTENDUS=6
UI_SCENARIOS_ATTENDUS=10

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,41p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0; checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

TRAVAIL=$(mktemp -d)
RAPPORTS=e2e/output/verify-onboarding
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
# (docs/SPEC-test-harness.md §7.2 point 9, docs/SPEC-onboarding.md §8 bis.4).
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

printf '\033[1mPreuves de CRM-079 — guide de démarrage\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

FICHIERS_CODE=("$LIB" "$ECRAN")
FICHIERS_PREUVE=("$TEST_LIB" "$TEST_ECRAN" "$SPEC_API" "$SPEC_UI")

for fichier in "${FICHIERS_CODE[@]}" "${FICHIERS_PREUVE[@]}"; do
	if [ ! -f "$fichier" ]; then fail "$fichier est ABSENT"; fi
done

# Le chemin ENTIER est affiché, jamais le seul nom de base : `e2e/api/demarrage.spec.ts` et
# `e2e/ui/demarrage.spec.ts` le partagent, et deux lignes identiques ne diraient pas laquelle des
# deux a été contrôlée.
for fichier in "${FICHIERS_CODE[@]}"; do
	if [ -f "$fichier" ] && head -3 "$fichier" | grep -q '@spec CRM-079'; then
		ok "$fichier porte son commentaire @spec"
	else
		fail "$fichier ne cite pas CRM-079 en tête de fichier"
	fi
done
for fichier in "${FICHIERS_PREUVE[@]}"; do
	if [ -f "$fichier" ] && head -3 "$fichier" | grep -q '@verifies CRM-079'; then
		ok "$fichier porte son commentaire @verifies"
	else
		fail "$fichier ne cite pas CRM-079"
	fi
done

titre "2. Captures observées (CLAUDE.md §16)"

# Les quatre paliers du §7 du design system, puis les cinq états qui n'existent qu'une fois :
# l'accueil portant le guide, l'accueil une fois le guide masqué, le guide intégralement accompli,
# le guide vu par la LECTRICE — seul compte que le seed laisse avec une étape à faire (§3.1,
# fait 2) — et l'étape non mesurable du §6.2.
for palier in xl-1440 lg-1152 md-900 sm-390; do
	if [ -f "$CAPTURES/guide-$palier.jpg" ]; then
		ok "capture guide $palier livrée"
	else
		fail "capture guide $palier ABSENTE : la Definition of Done exige les quatre paliers"
	fi
done
for capture in accueil-guide-1440 accueil-masque-1440 guide-accompli-1440 guide-viewer-1440 \
	guide-non-mesurable-1440; do
	if [ -f "$CAPTURES/$capture.jpg" ]; then
		ok "capture $capture livrée"
	else
		fail "capture $capture ABSENTE"
	fi
done

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
		fail "vitest « $filtre » vert mais les comptes ont changé : ${fichiers:-?} fichiers / ${tests:-?} tests au lieu de $fichiers_attendus / $tests_attendus — mettez le §8 bis.1 à jour dans le même changement"
	fi
}

titre "3. Vitest — le module de mesure et l'écran"
vitest_fige demarrage "$VITEST_FICHIERS_ATTENDUS" "$VITEST_TESTS_ATTENDUS" \
	"$TEST_LIB + $TEST_ECRAN" "$TRAVAIL/vitest-demarrage.log"

if [ "$RAPIDE" = true ]; then
	titre "4. Preuves longues"
	ok "--rapide : Playwright n'est pas exécuté (annoncé, non masqué)"
else
	titre "4. API — les trois faits du §3.1, hors interface, jetons réels"

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		scenarios=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '^[0-9]+')
		if [ "${scenarios:-0}" -eq "$API_SCENARIOS_ATTENDUS" ]; then
			ok "e2e api ($SPEC_API) : $scenarios scénarios — un comptage est ce que l'appelant VOIT"
		else
			fail "e2e api vert mais le compte a changé : ${scenarios:-?} au lieu de $API_SCENARIOS_ATTENDUS — mettez le §8 bis.1 à jour dans le même changement"
		fi
	else
		fail_journal "les scénarios d'API du guide ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	titre "5. UI — clavier seul, mobile, masquage et reprise, console stricte"

	if E2E_PROJETS=ui npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		scenarios=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1 | grep -oE '^[0-9]+')
		if [ "${scenarios:-0}" -eq "$UI_SCENARIOS_ATTENDUS" ]; then
			ok "e2e ui ($SPEC_UI) : $scenarios scénarios, console VIERGE"
		else
			fail "e2e ui vert mais le compte a changé : ${scenarios:-?} au lieu de $UI_SCENARIOS_ATTENDUS — mettez le §8 bis.1 à jour dans le même changement"
		fi
	else
		fail_journal "le parcours d'interface du guide ÉCHOUE" "$TRAVAIL/ui.log"
	fi
fi

titre "6. Non-complaisance — cinq dégradations réelles (§8 bis.2)"

if npm run test:unit -- --run demarrage >"$TRAVAIL/temoin.log" 2>&1; then
	ok "témoin : les deux suites de l'unité sont VERTES avant toute dégradation"
else
	fail_journal "témoin ROUGE : les suites ne mesurent plus rien" "$TRAVAIL/temoin.log"
fi

# Une dégradation NON VUE est un échec du harnais : elle dit que la preuve censée tenir la règle ne
# la tient pas. Le remède est alors d'écrire la preuve manquante, jamais de retirer la dégradation.
degrader() {
	local fichier=$1 libelle=$2 motif=$3 remplacement=$4
	sauvegarder "$fichier"
	if ! sed -i "s|$motif|$remplacement|" "$fichier" || ! grep -qF "$remplacement" "$fichier"; then
		fail "dégradation INAPPLICABLE : $libelle"
		rendre "$fichier"
		return
	fi
	if npm run test:unit -- --run demarrage >"$TRAVAIL/degrade.log" 2>&1; then
		fail "dégradation NON VUE : $libelle"
	else
		ok "dégradation vue : $libelle"
	fi
	rendre "$fichier"
}

# LE FILTRE DE LA CORBEILLE (§3) : sans lui, l'étape « track » se dirait accomplie par un objet
# que la barre latérale ne montre nulle part, et le guide renverrait vers un écran vide.
degrader "$LIB" \
	"le filtre deleted_at des tracks disparaît — un track en corbeille accomplirait l'étape" \
	"nuls: \['archived_at', 'deleted_at'\] }," \
	"nuls: ['archived_at'] },"

# LE CONTRAT ROMPU (§3.2) : une réponse aboutie SANS `count` rendue comme un zéro afficherait
# « à faire » sur une étape peut-être accomplie — la valeur par défaut trompeuse de CLAUDE.md §18.
degrader "$LIB" \
	"un count absent cesse d'être une erreur — une étape peut-être accomplie serait dite à faire" \
	"if (reponse.count === null) {" \
	"if (false) {"

# LE SEUIL D'ACCOMPLISSEMENT (§6.2) : une étape est accomplie dès la PREMIÈRE ligne visible, et un
# seuil à zéro déclarerait les cinq étapes faites sur un espace vide.
degrader "$LIB" \
	"le seuil d'accomplissement tombe à zéro — un espace vide se dirait intégralement démarré" \
	"etat.donnees.compte >= 1" \
	"etat.donnees.compte >= 0"

# LE NON MESURABLE MAINTIENT LE GUIDE (§6.2) : sans cette branche, une mesure refusée retirerait le
# guide de l'accueil, c'est-à-dire affirmerait un accomplissement que rien n'a constaté.
#
# La dégradation n'emploie AUCUN `&` : `sed` le remplace par le motif entier, et le contrôle
# `grep -qF` qui suit chercherait alors une chaîne que `sed` n'a jamais écrite. Une dégradation
# annoncée INAPPLICABLE ne prouve rien — mesuré à l'écriture de ce harnais, le 2026-08-16.
degrader "$LIB" \
	"une étape non mesurable cesse de maintenir le guide — un accomplissement serait supposé" \
	"progression.etapes.some((etat) => !estAccomplie(etat))" \
	"progression.etapes.some((etat) => (etat.statut === 'pret' ? !estAccomplie(etat) : false))"

# LA GARDE DE SESSION (§4.4) : c'est le défaut RÉEL qu'une campagne a mesuré — un visiteur sans
# session déclenchait les cinq comptages, et `mail_inbound_accounts` répondait `401` dans la
# console de l'écran d'arrivée du produit.
degrader "$ECRAN" \
	"la garde de session saute — l'accueil mesurerait sans session et salirait la console" \
	"useDemarrage(ouverte ? client : null)" \
	"useDemarrage(client)"

titre "7. Restauration CONSTATÉE, pas supposée"

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

if npm run test:unit -- --run demarrage >"$TRAVAIL/restaure.log" 2>&1; then
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
