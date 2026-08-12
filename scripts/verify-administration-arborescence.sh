#!/usr/bin/env bash
# @verifies CRM-075 (docs/BACKLOG.md) — Definition of Done de l'administration des tracks et des
#           channels
# @verifies docs/SPEC-administration-arborescence.md §12 (preuves attendues), §1 (aucune règle
#           nouvelle : le CRUD est celui de CRM-020 et CRM-021, déjà prouvé par verify-tracks.sh et
#           verify-channels.sh, non rejoué ici)
# @verifies docs/DESIGN_SYSTEM.md §5.13 (cette surface), §12.6 (débordement horizontal signalé)
# @verifies CLAUDE.md §16 (vérification visuelle)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité ;
#   2. captures aux quatre paliers, observées ;
#   3. Vitest — la couche d'accès aux données et l'écran ;
#   4. l'API : refus du viewer et du business_developer, hors interface, jetons réels ;
#   5. l'UI : les cinq gestes, track puis channel, au clavier ET à la souris ;
#   6. le harnais est NON COMPLAISANT : trois dégradations réelles font rougir la suite, avant
#      restauration.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUNE RÈGLE D'AUTORISATION N'EST REJOUÉE ICI : l'écriture réservée à l'administrateur, l'absence
# de DELETE et le cloisonnement par workspace sont ceux de CRM-020 et CRM-021, déjà prouvés par
# scripts/verify-tracks.sh et scripts/verify-channels.sh. Les rejouer ici les dupliquerait sans
# les renforcer (docs/SPEC-administration-arborescence.md §1).
# AUCUNE SUPPRESSION : archiver n'est pas une corbeille, et ce harnais ne prétend pas le contraire.
#
# Usage :
#   scripts/verify-administration-arborescence.sh
#   scripts/verify-administration-arborescence.sh --rapide   n'exécute pas Playwright

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RACINE=$PWD

LIB=webapp/src/lib/administration-arborescence.ts
TEST_LIB=webapp/src/lib/administration-arborescence.test.ts
ECRAN=webapp/src/app/AdministrationArborescence.tsx
TEST_ECRAN=webapp/src/app/AdministrationArborescence.test.tsx
SPEC_API=e2e/api/administration-arborescence.spec.ts
SPEC_UI=e2e/ui/administration-arborescence.spec.ts
SPEC_MANUEL=e2e/ui/manuel.spec.ts
SPEC_COQUILLE=e2e/ui/coquille.spec.ts
CAPTURES=docs/captures/CRM-075

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,29p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0; checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

TRAVAIL=$(mktemp -d)
RAPPORTS=e2e/output/verify-administration-arborescence
mkdir -p "$RAPPORTS"
fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}
SAUVEGARDES="$TRAVAIL/sauvegardes"; mkdir -p "$SAUVEGARDES"
sauvegarder() { cp "$1" "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')"; }
rendre() { cp "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')" "$1"; }
restaurer() {
	for fichier in "$SAUVEGARDES"/*; do
		[ -e "$fichier" ] || continue
		cp "$fichier" "$(basename "$fichier" | tr '@' '/')"
	done
	rm -rf "$TRAVAIL"
}
trap restaurer EXIT

printf '\033[1mPreuves de CRM-075 — administration des tracks et des channels\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

for fichier in "$LIB" "$TEST_LIB" "$ECRAN" "$TEST_ECRAN" "$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$LIB" "$ECRAN"; do
	if head -3 "$fichier" | grep -q 'CRM-075'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité en tête de fichier"
	fi
done
for fichier in "$TEST_LIB" "$TEST_ECRAN" "$SPEC_API" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-075'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done

titre "2. Captures observées aux quatre paliers"

for palier in xl-1440 lg-1152 md-900 sm-390; do
	if [ -f "$CAPTURES/arborescence-$palier.jpg" ]; then
		ok "capture $palier livrée"
	else
		fail "capture $palier ABSENTE : la Definition of Done exige les quatre paliers"
	fi
done

titre "3. Vitest — la couche d'accès aux données et l'écran"

if npm run test:unit -- --run administration-arborescence >"$TRAVAIL/vitest-lib.log" 2>&1; then
	ok "vitest $TEST_LIB : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/vitest-lib.log" | tail -1)"
else
	fail_journal "vitest $TEST_LIB ÉCHOUE" "$TRAVAIL/vitest-lib.log"
fi

if npm run test:unit -- --run AdministrationArborescence >"$TRAVAIL/vitest-ecran.log" 2>&1; then
	ok "vitest $TEST_ECRAN : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/vitest-ecran.log" | tail -1)"
else
	fail_journal "vitest $TEST_ECRAN ÉCHOUE" "$TRAVAIL/vitest-ecran.log"
fi

if [ "$RAPIDE" = true ]; then
	titre "4. Preuves longues"
	ok "--rapide : Playwright n'est pas exécuté (annoncé, non masqué)"
else
	titre "4. API — refus hors interface, jetons réels"

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		ok "e2e api ($SPEC_API) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1)"
	else
		fail_journal "les refus d'API ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	titre "5. UI — les cinq gestes, track puis channel, clavier et souris"

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		ok "e2e ui ($SPEC_UI) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1) au clavier et à la souris"
	else
		fail_journal "le parcours de l'administration de l'arborescence ÉCHOUE" "$TRAVAIL/ui.log"
	fi

	# `/reglages` a cessé d'être un état vide le jour où cette unité lui a donné une première
	# section : les deux preuves transverses qui citaient l'ancien état sont rejouées ici pour
	# que leur correction (docs/JOURNAL.md décision 349) reste couverte par CE harnais, plutôt
	# que de dériver silencieusement à la prochaine modification de l'index.
	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_COQUILLE" \
		>"$TRAVAIL/coquille.log" 2>&1; then
		ok "e2e ui ($SPEC_COQUILLE, /reglages devenu un index) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/coquille.log" | tail -1)"
	else
		fail_journal "la coquille (routes et /reglages) ÉCHOUE" "$TRAVAIL/coquille.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_MANUEL" \
		>"$TRAVAIL/manuel.log" 2>&1; then
		ok "e2e ui ($SPEC_MANUEL, /reglages devenu un index) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/manuel.log" | tail -1)"
	else
		fail_journal "le manuel (accord des libellés) ÉCHOUE" "$TRAVAIL/manuel.log"
	fi

	titre "6. Non-complaisance"

	if npm run test:unit -- --run administration-arborescence >"$TRAVAIL/temoin.log" 2>&1; then
		ok "témoin : la couche d'accès est VERTE avant toute dégradation"
	else
		fail_journal "témoin ROUGE : la suite ne mesure plus rien" "$TRAVAIL/temoin.log"
	fi

	degrader() {
		local libelle=$1 motif=$2 remplacement=$3
		sauvegarder "$LIB"
		if ! sed -i "s|$motif|$remplacement|" "$LIB" || ! grep -qF "$remplacement" "$LIB"; then
			fail "dégradation INAPPLICABLE : $libelle"
			rendre "$LIB"
			return
		fi
		if npm run test:unit -- --run administration-arborescence >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		rendre "$LIB"
	}

	# LA GARDE DU MILIEU STRICT (§6.2, limite 2) : sans elle, deux voisines de même position
	# écriraient une valeur qui NE CHANGE RIEN à l'ordre affiché — l'illusion d'un effet.
	degrader "la garde du milieu strict disparaît — un déplacement sans effet serait accepté" \
		"!(milieu > avant \&\& milieu < apres)" "false"

	# LE FILTRE DES ARCHIVÉS (§6.4) : sans lui, la case « Afficher les archivés » n'aurait plus
	# aucun effet observable — tout serait toujours montré.
	degrader "le filtre des archivés disparaît — la case à cocher perdrait son effet" \
		"base.is('archived_at', null)" "base"

	# L'ORDRE DE CLASSEMENT DES REFUS (§9) : le code PostgreSQL doit primer sur le code HTTP,
	# sans quoi un `403` accompagné d'un `23505` serait classé « forbidden » au lieu de
	# « slug-pris » — le mauvais message serait affiché au mauvais champ.
	degrader "le code HTTP est classé avant le code PostgreSQL — le mauvais refus serait montré" \
		"if (code === '23505') return { nature: 'slug-pris', detail }" \
		"if (statutHttp === 403) return { nature: 'forbidden', detail }; if (code === '23505') return { nature: 'slug-pris', detail }"

	titre "7. Restauration"
	if npm run test:unit -- --run administration-arborescence >"$TRAVAIL/restaure.log" 2>&1; then
		ok "les preuves redeviennent vertes après restauration"
	else
		fail_journal "les preuves restent ROUGES après restauration" "$TRAVAIL/restaure.log"
	fi
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
