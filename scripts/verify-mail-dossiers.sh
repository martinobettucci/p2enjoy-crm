#!/usr/bin/env bash
# @verifies CRM-056 (docs/BACKLOG.md) — Definition of Done des dossiers IMAP imbriqués
# @verifies docs/SPEC-mail-subsystem.md §4.5 (dossiers, renommage, copie et non déplacement),
#           §17.1 (mesures), §17.2 (ce que l'unité livre)
# @verifies docs/JOURNAL.md décisions 323, 324, 325 ; CLAUDE.md §16 (vérification visuelle)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité ;
#   2. la table, l'assainissement et les chemins dérivés sont en base, avec leurs droits ;
#   3. l'assainissement mord réellement : délimiteur, contrôle, nom vide ;
#   4. les preuves dédiées sont vertes — pgTAP, arborescence lue par un CLIENT IMAP TIERS, et
#      l'observation VISUELLE dans Roundcube que la Definition of Done exige ;
#   5. `pytest` couvre la souscription, la copie, le renommage et les serveurs à labels ;
#   6. le harnais est NON COMPLAISANT, témoin compris.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUN ÉCRAN DU PRODUIT ne montre l'arborescence : Roundcube est le seul moyen de vérification
# visuelle tant que `CRM-057` n'existe pas (§11.5).
#
# LA REPRISE D'UN RANGEMENT MANQUÉ N'EST PAS LIVRÉE : le rangement est tenté à la PREMIÈRE vue
# d'un message, et un refus est journalisé sans être rejoué. La reprise appartient à `CRM-059`.
#
# Usage :
#   scripts/verify-mail-dossiers.sh
#   scripts/verify-mail-dossiers.sh --rapide   n'exécute ni Playwright ni pytest

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RACINE=$PWD
MIGRATION=supabase/migrations/0026_dossiers_imap.sql
MIGRATION_RENOM=supabase/migrations/0027_dossiers_renommage.sql
TEST_SQL=supabase/tests/0028_dossiers_imap.test.sql
SPEC_MAIL=e2e/mail/dossiers.spec.ts
SPEC_ROUNDCUBE=e2e/mail/roundcube-dossiers.spec.ts
MODULE=mail-sync/src/mail_sync/dossiers.py
TEST_MODULE=mail-sync/tests/test_dossiers.py
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,30p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0; checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

TRAVAIL=$(mktemp -d)
RAPPORTS=e2e/output/verify-mail-dossiers
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

printf '\033[1mPreuves de CRM-056 — dossiers IMAP imbriqués\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$MIGRATION_RENOM" "$TEST_SQL" "$SPEC_MAIL" "$SPEC_ROUNDCUBE" \
	"$MODULE" "$TEST_MODULE"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
for fichier in "$MIGRATION" "$MIGRATION_RENOM" "$MODULE"; do
	if head -3 "$fichier" | grep -q '@spec CRM-056'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done
for fichier in "$TEST_SQL" "$SPEC_MAIL" "$SPEC_ROUNDCUBE" "$TEST_MODULE"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-056'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done

titre "2. Le schéma réellement en base"

if [ "$(psql_db -c "select to_regclass('public.mail_folder_map') is not null")" = t ]; then
	ok "la table de correspondance existe"
else
	fail "mail_folder_map est ABSENTE"
fi

for fonction in chemin_dossier_card chemin_dossier_entite dossiers_a_renommer \
	mail_folder_map_reparenter; do
	if [ "$(psql_db -c "select count(*) from pg_proc where pronamespace='public'::regnamespace
		and proname='$fonction'")" = 1 ]; then
		ok "$fonction est livrée"
	else
		fail "$fonction est ABSENTE ou dupliquée"
	fi
done

# LES QUATRE FONCTIONS SONT RÉSERVÉES AU SERVICE : un client n'a rien à faire du chemin d'un
# dossier IMAP, et le lui offrir publierait l'arborescence d'une boîte qu'il ne lit pas.
for fonction in "chemin_dossier_card(uuid)" "chemin_dossier_entite(text, uuid)" \
	"dossiers_a_renommer(uuid)" "mail_folder_map_reparenter(uuid, text, text)"; do
	if [ "$(psql_db -c "select has_function_privilege('authenticated','public.$fonction','execute')")" = f ]; then
		ok "${fonction%%(*} : refusée à authenticated"
	else
		fail "${fonction%%(*} est offerte au client"
	fi
done

titre "3. L'assainissement mord"

verifier_assainissement() {
	local entree=$1 attendu=$2 libelle=$3
	local obtenu
	obtenu=$(psql_db -c "select app.assainir_segment_dossier(\$\$$entree\$\$)")
	if [ "$obtenu" = "$attendu" ]; then
		ok "$libelle"
	else
		fail "$libelle — obtenu « $obtenu », attendu « $attendu »"
	fi
}

verifier_assainissement 'A/B' 'A B' "le délimiteur est REMPLACÉ par une espace, non retiré : « A/B » reste lisible"
verifier_assainissement '   ' 'sans-nom' "un nom vide devient « sans-nom » plutôt qu'un segment vide"
verifier_assainissement 'Conseil & IA' 'Conseil & IA' "une esperluette est conservée : le fil l'encode, le produit non"

if [ "$RAPIDE" = false ]; then
	titre "4. Preuves exécutables"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
		assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap.log" | head -1 | grep -oE '[0-9]+')
		if [ "${assertions:-0}" -eq 18 ]; then
			ok "suite pgTAP dédiée — 18 assertions"
		else
			fail "suite pgTAP verte mais ${assertions:-0} assertions au lieu de 18"
		fi
	else
		fail_journal "la suite pgTAP ÉCHOUE" "$TRAVAIL/pgtap.log"
	fi

	if E2E_PROJETS=mail npx playwright test --config e2e/playwright.config.ts --project=mail \
		"$SPEC_MAIL" >"$TRAVAIL/mail.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/mail.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 2 ]; then
			ok "arborescence lue par un CLIENT IMAP TIERS — 2 scénarios"
		else
			fail "preuve mail verte mais ${passes:-0} scénarios au lieu de 2"
		fi
	else
		fail_journal "la preuve d'arborescence ÉCHOUE" "$TRAVAIL/mail.log"
	fi

	if E2E_PROJETS=mail npx playwright test --config e2e/playwright.config.ts --project=mail \
		"$SPEC_ROUNDCUBE" >"$TRAVAIL/roundcube.log" 2>&1; then
		ok "observation VISUELLE dans Roundcube — l'arborescence et le message s'y voient"
	else
		fail_journal "l'observation visuelle ÉCHOUE" "$TRAVAIL/roundcube.log"
	fi

	for capture in roundcube-arborescence-cards-1440 roundcube-message-dans-la-card-1440; do
		if [ -s "docs/captures/CRM-056/$capture.jpg" ]; then
			ok "capture $capture.jpg produite"
		else
			fail "capture $capture.jpg ABSENTE — CLAUDE.md §16"
		fi
	done

	if [ -x "$RACINE/.venv/bin/python" ]; then PYTHON=$RACINE/.venv/bin/python; else PYTHON=python3; fi
	if "$PYTHON" -m pytest "$RACINE/$TEST_MODULE" -q >"$TRAVAIL/pytest.log" 2>&1; then
		ok "pytest $TEST_MODULE : $(tail -1 "$TRAVAIL/pytest.log")"
	else
		fail_journal "pytest ÉCHOUE" "$TRAVAIL/pytest.log"
	fi

	titre "5. Non-complaisance"

	if "$PYTHON" -m pytest "$RACINE/$TEST_MODULE" -q >"$TRAVAIL/temoin.log" 2>&1; then
		ok "témoin : les preuves du module sont VERTES avant toute dégradation"
	else
		fail_journal "témoin ROUGE" "$TRAVAIL/temoin.log"
	fi

	degrader_module() {
		local libelle=$1 motif=$2 remplacement=$3
		sauvegarder "$MODULE"
		sed -i "s|$motif|$remplacement|" "$MODULE"
		if "$PYTHON" -m pytest "$RACINE/$TEST_MODULE" -q >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		rendre "$MODULE"
	}

	# LA SOUSCRIPTION EST CE QUI REND L'ARBORESCENCE VISIBLE : sans elle, les dossiers existent et
	# aucun client de messagerie ne les montre. Défaut trouvé par l'observation visuelle.
	degrader_module "la souscription retirée — l'arborescence redeviendrait invisible" \
		"imap.subscribe_folder(niveau)" "pass  # dégradation"

	degrader_module "la copie devenue un déplacement — le message quitterait la boîte" \
		"imap.copy(\[uid\], dossier_cible)" "imap.move([uid], dossier_cible)"

	degrader_module "les serveurs à labels traités comme des serveurs à dossiers" \
		"return CAPACITE_GMAIL not in capacites" "return True"

	titre "6. Restauration"
	if "$PYTHON" -m pytest "$RACINE/$TEST_MODULE" -q >"$TRAVAIL/restaure.log" 2>&1; then
		ok "les preuves du module redeviennent vertes après restauration"
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
