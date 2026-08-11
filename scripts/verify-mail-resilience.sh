#!/usr/bin/env bash
# @verifies CRM-059 (docs/BACKLOG.md) — Definition of Done du backfill, de la résilience et de la
#           supervision
# @verifies docs/SPEC-mail-subsystem.md §20.3 (le backoff), §20.4 (l'envoi orphelin), §20.5 (la
#           reprise d'un rangement manqué), §20.6 et §20.6 bis (le backfill par lots), §20.7 (l'état
#           affiché), §20.8 (preuves exigées), §20.10 (la boucle de veille), §20.11 (l'écran d'état)
# @verifies docs/JOURNAL.md décision 331, décision 341, décision 342, décision 346, décision 347
# @verifies CLAUDE.md §16 (vérification visuelle)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité ;
#   2. ce que la base garantit RÉELLEMENT — fonctions, migrations, et le correctif de la
#      décision 347 (`daily_quota` n'est plus réinstallé à `0` par le chemin d'écriture) ;
#   3. pytest sur le backoff, le backfill et la boucle de veille — SANS SERVEUR ;
#   4. pgTAP sur la reprise d'un orphelin, le seuil de dix minutes, la reprise d'un rangement
#      manqué et le correctif de la décision 347 ;
#   5. l'API de lecture d'un compte, réservée à son propriétaire et à un administrateur
#      (`CRM-052`, réutilisée telle quelle — cette unité n'invente aucune règle) ;
#   6. une coupure SMTP RÉELLE, reprogrammée puis reprise (`e2e/mail`) ;
#   7. l'écran d'état, au clavier et à la souris, incident compris (`e2e/ui`) ;
#   8. captures aux quatre paliers, observées ;
#   9. le harnais est NON COMPLAISANT, témoin compris.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUNE VEILLE PAR IDLE (§20.9) : la scrutation reste déclarée, observable et rejouable.
# AUCUNE ALERTE SORTANTE : un compte en erreur est visible, il n'envoie ni courriel ni notification.
# AUCUNE ACTION DEPUIS L'ÉCRAN D'ÉTAT (§20.11.7) : il lit, il n'agit pas.
#
# Usage :
#   scripts/verify-mail-resilience.sh
#   scripts/verify-mail-resilience.sh --rapide   n'exécute ni Playwright ni pytest

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RACINE=$PWD

MIGRATION_RESILIENCE=supabase/migrations/0031_resilience_envoi.sql
MIGRATION_RANGEMENT=supabase/migrations/0032_reprise_rangement.sql
MIGRATION_QUOTA=supabase/migrations/0033_quota_par_defaut.sql
TEST_SQL_RESILIENCE=supabase/tests/0031_resilience_envoi.test.sql
TEST_SQL_RANGEMENT=supabase/tests/0032_reprise_rangement.test.sql
TEST_SQL_QUOTA=supabase/tests/0033_quota_par_defaut.test.sql
SPEC_API=e2e/api/comptes-entrants.spec.ts
SPEC_MAIL=e2e/mail/resilience.spec.ts
SPEC_UI=e2e/ui/etat-messagerie.spec.ts
MODULE_BACKOFF=mail-sync/src/mail_sync/backoff.py
TEST_MODULE_BACKOFF=mail-sync/tests/test_backoff.py
MODULE_BACKFILL=mail-sync/src/mail_sync/backfill.py
MODULE_VEILLE=mail-sync/src/mail_sync/veille.py
MODULE_INGESTION=mail-sync/src/mail_sync/ingestion.py
LIB_ETAT=webapp/src/lib/mail-etat.ts
TEST_LIB_ETAT=webapp/src/lib/mail-etat.test.ts
ECRAN_ETAT=webapp/src/app/EtatMessagerie.tsx
CAPTURES=docs/captures/CRM-059
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,35p' "$0"; exit 0 ;;
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
RAPPORTS=e2e/output/verify-mail-resilience
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

if [ -x "$RACINE/.venv/bin/python" ]; then PYTHON=$RACINE/.venv/bin/python; else PYTHON=python3; fi

printf '\033[1mPreuves de CRM-059 — backfill, résilience, supervision\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION_RESILIENCE" "$MIGRATION_RANGEMENT" "$MIGRATION_QUOTA" \
	"$TEST_SQL_RESILIENCE" "$TEST_SQL_RANGEMENT" "$TEST_SQL_QUOTA" \
	"$SPEC_API" "$SPEC_MAIL" "$SPEC_UI" \
	"$MODULE_BACKOFF" "$TEST_MODULE_BACKOFF" "$MODULE_BACKFILL" "$MODULE_VEILLE" \
	"$MODULE_INGESTION" "$LIB_ETAT" "$TEST_LIB_ETAT" "$ECRAN_ETAT"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION_RESILIENCE" "$MIGRATION_RANGEMENT" "$MODULE_BACKOFF" "$MODULE_BACKFILL" \
	"$MODULE_VEILLE" "$LIB_ETAT" "$ECRAN_ETAT"; do
	if head -3 "$fichier" | grep -q 'CRM-059'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité en tête de fichier"
	fi
done
# `ingestion.py` sert d'abord `CRM-054`/`CRM-055` : sa reprise porte son propre `@spec` plus
# proche (`CLAUDE.md` §5), et non un en-tête de fichier réécrit pour une seule fonction.
if grep -q 'CRM-059' "$MODULE_INGESTION"; then
	ok "$(basename "$MODULE_INGESTION") cite CRM-059 au plus près de sa reprise de rangement"
else
	fail "$(basename "$MODULE_INGESTION") ne cite plus CRM-059 nulle part"
fi
# `daily_quota` appartient au chemin d'écriture de `CRM-053`/`CRM-058` ; la migration 0033 le
# corrige et le dit, sans revendiquer l'unité pour elle-même (décision 347).
if head -6 "$MIGRATION_QUOTA" | grep -q 'CRM-053'; then
	ok "$(basename "$MIGRATION_QUOTA") cite l'unité qu'elle corrige"
else
	fail "$(basename "$MIGRATION_QUOTA") ne cite plus l'unité qu'elle corrige"
fi
for fichier in "$TEST_SQL_RESILIENCE" "$TEST_SQL_RANGEMENT" "$SPEC_MAIL" "$SPEC_UI" \
	"$TEST_MODULE_BACKOFF" "$TEST_LIB_ETAT"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-059'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done
# `0033_quota_par_defaut.test.sql` fixe un correctif de `CRM-053`/`CRM-058`, trouvé en vérifiant
# CETTE unité mais n'appartenant pas à son numéro (décision 347) : sa traçabilité les cite, pas
# `CRM-059`.
if head -3 "$TEST_SQL_QUOTA" | grep -q '@verifies CRM-053'; then
	ok "$(basename "$TEST_SQL_QUOTA") porte son commentaire @verifies (CRM-053/CRM-058)"
else
	fail "$(basename "$TEST_SQL_QUOTA") ne cite pas l'unité qu'il corrige"
fi

titre "2. Ce qui est RÉELLEMENT en base"

for fonction in messages_a_ranger marquer_message_range; do
	if [ "$(psql_db -c "select count(*) from pg_proc where pronamespace='public'::regnamespace
		and proname='$fonction'")" = 1 ]; then
		ok "public.$fonction est livrée"
	else
		fail "public.$fonction est ABSENTE ou dupliquée"
	fi
done

# LE CORRECTIF DE LA DÉCISION 347 : la branche d'insertion ne réinstalle plus `daily_quota = 0`
# quand l'appelant ne précise rien. Signature de bug recherchée LITTÉRALEMENT : sa présence dirait
# que la migration 0033 n'a pas convergé sur cette base.
if psql_db -c "select prosrc from pg_proc where proname='upsert_mail_outbound_identity'" \
	| grep -q 'coalesce(p_daily_quota, 0)'; then
	fail "upsert_mail_outbound_identity RÉINSTALLE encore daily_quota=0 à l'insertion — décision 347
        non appliquée sur cette base, tout envoi sera bloqué au prochain seed"
else
	ok "upsert_mail_outbound_identity n'insère plus daily_quota=0 par défaut (décision 347)"
fi

# TÉMOIN, mesuré comme la décision 347 l'a été : le seed doit avoir posé un quota NULL, pas 0.
if [ "$(psql_db -c "select count(*) from public.mail_outbound_identities where daily_quota = 0")" = 0 ]; then
	ok "témoin : aucune identité sortante du seed ne porte daily_quota=0"
else
	fail "au moins une identité sortante porte encore daily_quota=0 : le seed a été appliqué avant
        la migration 0033, ou le correctif a régressé. Rejouez supabase/seed/apply-seed.sh"
fi

titre "3. Captures observées aux quatre paliers"

for palier in xl-1440 lg-1152 md-900 sm-390; do
	if [ -f "$CAPTURES/etat-messagerie-$palier.jpg" ]; then
		ok "capture $palier livrée"
	else
		fail "capture $palier ABSENTE : la Definition of Done exige les quatre paliers"
	fi
done

titre "4. pgTAP"

for entree in "$TEST_SQL_RESILIENCE" "$TEST_SQL_RANGEMENT" "$TEST_SQL_QUOTA"; do
	log="$TRAVAIL/pgtap-$(basename "$entree" .test.sql).log"
	if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -f - < "$entree" \
		>"$log" 2>&1 && ! grep -q '^ *not ok' "$log"; then
		ok "pgTAP $entree : $(grep -c ' ok [0-9]' "$log") assertions vertes"
	else
		fail_journal "pgTAP $entree ÉCHOUE" "$log"
	fi
done

if [ "$RAPIDE" = true ]; then
	titre "5. Preuves longues"
	ok "--rapide : Playwright et pytest ne sont pas exécutés (annoncé, non masqué)"
else
	titre "5. pytest — SANS SERVEUR"

	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests" -q >"$TRAVAIL/pytest.log" 2>&1; then
		ok "pytest mail-sync/tests : $(tail -1 "$TRAVAIL/pytest.log")"
	else
		fail_journal "pytest ÉCHOUE" "$TRAVAIL/pytest.log"
	fi

	titre "6. Vitest, API, mail et écran"

	if npm run test:unit -- --run mail-etat >"$TRAVAIL/vitest.log" 2>&1; then
		ok "vitest $TEST_LIB_ETAT : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/vitest.log" | tail -1)"
	else
		fail_journal "vitest ÉCHOUE" "$TRAVAIL/vitest.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		ok "e2e api ($SPEC_API, réutilisé de CRM-052) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1)"
	else
		fail_journal "les preuves d'API ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=mail "$SPEC_MAIL" \
		>"$TRAVAIL/mail.log" 2>&1; then
		ok "e2e mail (coupure SMTP réelle) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/mail.log" | tail -1)"
	else
		fail_journal "la coupure SMTP réelle ÉCHOUE" "$TRAVAIL/mail.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		ok "e2e ui (écran d'état) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1) au clavier et à la souris"
	else
		fail_journal "le parcours de l'écran d'état ÉCHOUE" "$TRAVAIL/ui.log"
	fi

	titre "7. Non-complaisance"

	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests/test_backoff.py" -q >"$TRAVAIL/temoin-py.log" 2>&1
	then
		ok "témoin : le backoff est VERT avant toute dégradation"
	else
		fail_journal "témoin ROUGE : la suite du backoff ne mesure plus rien" "$TRAVAIL/temoin-py.log"
	fi
	if npm run test:unit -- --run mail-etat >"$TRAVAIL/temoin-ts.log" 2>&1; then
		ok "témoin : l'écran d'état est VERT avant toute dégradation"
	else
		fail_journal "témoin ROUGE : les preuves de l'écran ne mesurent plus rien" "$TRAVAIL/temoin-ts.log"
	fi

	degrader_py() {
		local libelle=$1 fichier=$2 motif=$3 remplacement=$4 module_pytest=$5
		sauvegarder "$fichier"
		if ! sed -i "s|$motif|$remplacement|" "$fichier" || ! grep -qF "$remplacement" "$fichier"; then
			fail "dégradation INAPPLICABLE : $libelle"
			rendre "$fichier"
			return
		fi
		if "$PYTHON" -m pytest "$RACINE/$module_pytest" -q >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		rendre "$fichier"
	}

	degrader_ts() {
		local libelle=$1 motif=$2 remplacement=$3
		sauvegarder "$LIB_ETAT"
		if ! sed -i "s|$motif|$remplacement|" "$LIB_ETAT" || ! grep -qF "$remplacement" "$LIB_ETAT"; then
			fail "dégradation INAPPLICABLE : $libelle"
			rendre "$LIB_ETAT"
			return
		fi
		if npm run test:unit -- --run mail-etat >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		rendre "$LIB_ETAT"
	}

	# LE COEUR DU BACKOFF : sans progression géométrique, un serveur en panne serait harcelé à
	# intervalle fixe — exactement ce que la décision 331 refuse.
	degrader_py "le backoff cesse de progresser — un serveur en panne serait harcelé" \
		"$MODULE_BACKOFF" '^FACTEUR = 4$' 'FACTEUR = 1' "$TEST_MODULE_BACKOFF"

	# SANS BORNE, un message adressé à un domaine disparu resterait en file pour toujours.
	degrader_py "la borne des tentatives disparaît — un message resterait en file pour toujours" \
		"$MODULE_BACKOFF" '^TENTATIVES_MAX = 5$' 'TENTATIVES_MAX = 999' "$TEST_MODULE_BACKOFF"

	# LE FILTRE DE LA FILE SORTANTE : sans lui, un compte en échec définitif compterait comme « en
	# attente », ce que l'écran d'état montrerait faussement (§20.7).
	degrader_ts "le filtre « en attente » perd « sending » — un envoi en cours disparaîtrait du compte" \
		"\['queued', 'sending'\]" "['queued']"

	titre "8. Restauration"
	if "$PYTHON" -m pytest "$RACINE/mail-sync/tests/test_backoff.py" -q >"$TRAVAIL/restaure-py.log" 2>&1
	then
		ok "les preuves du backoff redeviennent vertes après restauration"
	else
		fail_journal "les preuves du backoff restent ROUGES après restauration" "$TRAVAIL/restaure-py.log"
	fi
	if npm run test:unit -- --run mail-etat >"$TRAVAIL/restaure-ts.log" 2>&1; then
		ok "les preuves de l'écran d'état redeviennent vertes après restauration"
	else
		fail_journal "les preuves de l'écran restent ROUGES après restauration" "$TRAVAIL/restaure-ts.log"
	fi
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
