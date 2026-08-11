#!/usr/bin/env bash
# @verifies CRM-058 (docs/BACKLOG.md) — Definition of Done de la composition et de la réponse
# @verifies docs/SPEC-mail-subsystem.md §19.1 (ce que le serveur ne fait pas), §19.4 (les six
#           refus, le quota), §19.5 (ce que le worker compose), §19.8 (limites nommées)
# @verifies docs/SPEC-permissions-rls.md §7.2 preuve de refus n° 12 ACQUISE
# @verifies docs/JOURNAL.md décision 330 ; CLAUDE.md §16
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers livrés portent leur traçabilité ;
#   2. la file, la garde et les trois fonctions du worker sont RÉELLEMENT en base, avec leurs
#      droits — dont trois refusées au client ;
#   3. le quota est nullable, et son défaut n'interdit plus tout envoi ;
#   4. les preuves dédiées sont vertes — pgTAP, contrat d'API hors interface, ALLER-RETOUR réel,
#      parcours d'écran, composition éprouvée sans serveur ;
#   5. le harnais est NON COMPLAISANT, témoin compris : quatre dégradations réelles doivent le
#      faire échouer.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUN BACKOFF, AUCUNE REPRISE : un échec passe `failed` et le dit. `CRM-059` les revendique.
# AUCUNE PIÈCE JOINTE À L'ENVOI, aucune signature, aucune copie cachée — absences figées.
#
# Usage :
#   scripts/verify-mail-envoi.sh
#   scripts/verify-mail-envoi.sh --rapide   n'exécute ni Playwright ni pytest

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

RACINE=$PWD
MIGRATION=supabase/migrations/0030_envoi_sortant.sql
TEST_SQL=supabase/tests/0030_envoi_sortant.test.sql
SPEC_API=e2e/api/envoi.spec.ts
SPEC_MAIL=e2e/mail/envoi.spec.ts
SPEC_UI=e2e/ui/envoi.spec.ts
MODULE=mail-sync/src/mail_sync/composition.py
TEST_MODULE=mail-sync/tests/test_composition.py
WORKER=mail-sync/src/mail_sync/envoi.py
ECRAN=webapp/src/app/FormulaireEnvoi.tsx
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,28p' "$0"; exit 0 ;;
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
RAPPORTS=e2e/output/verify-mail-envoi
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

printf '\033[1mPreuves de CRM-058 — composition et réponse\033[0m\n'

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API" "$SPEC_MAIL" "$SPEC_UI" "$MODULE" \
	"$TEST_MODULE" "$WORKER" "$ECRAN"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
for fichier in "$MIGRATION" "$MODULE" "$WORKER" "$ECRAN"; do
	if head -3 "$fichier" | grep -q 'CRM-058'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done
for fichier in "$TEST_SQL" "$SPEC_API" "$SPEC_MAIL" "$SPEC_UI" "$TEST_MODULE"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-058'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done

titre "2. Ce qui est RÉELLEMENT en base"

if [ "$(psql_db -c "select to_regclass('public.mail_outbox') is not null")" = t ]; then
	ok "la file d'envoi existe"
else
	fail "mail_outbox est ABSENTE"
fi

for fonction in queue_outbound_email reserver_envois marquer_envoi_reussi marquer_envoi_echoue; do
	if [ "$(psql_db -c "select count(*) from pg_proc where pronamespace='public'::regnamespace
		and proname='$fonction'")" = 1 ]; then
		ok "$fonction est livrée"
	else
		fail "$fonction est ABSENTE ou dupliquée"
	fi
done

# LES TROIS FONCTIONS DU WORKER SONT LE FAIT DU SERVICE : les offrir au client laisserait déclarer
# qu'un message est parti alors qu'il ne l'est pas.
for signature in "reserver_envois(integer)" "marquer_envoi_reussi(uuid, text, text[])" \
	"marquer_envoi_echoue(uuid, text)"; do
	if [ "$(psql_db -c "select has_function_privilege('authenticated','public.$signature','execute')")" = f ]; then
		ok "${signature%%(*} : refusée au client"
	else
		fail "${signature%%(*} est offerte au client"
	fi
done

if [ "$(psql_db -c "select has_function_privilege('authenticated',
	'public.queue_outbound_email(uuid, uuid, text[], text, text, text[], uuid)','execute')")" = t ]; then
	ok "la garde, elle, est ouverte au client : c'est la seule porte"
else
	fail "la garde est fermée au client : personne ne pourrait plus écrire"
fi

# LE DÉFAUT DE `CRM-053`, CORRIGÉ : `daily_quota not null default 0` interdisait TOUT envoi dès
# qu'un consommateur existait.
if [ "$(psql_db -c "select attnotnull from pg_attribute
	where attrelid='public.mail_outbound_identities'::regclass and attname='daily_quota'")" = f ]; then
	ok "daily_quota est NULLABLE : une valeur nulle signifie « aucun plafond »"
else
	fail "daily_quota est encore non nulle : son défaut interdirait tout envoi"
fi

if [ "$(psql_db -c "select count(*) from public.mail_outbound_identities where daily_quota = 0")" = 0 ]; then
	ok "aucune identité seedée ne porte le zéro d'origine"
else
	fail "une identité porte encore `daily_quota = 0` : elle n'enverra jamais rien"
fi

if [ "$(psql_db -c "select count(*) from pg_policies where schemaname='public'
	and tablename='mail_outbox' and cmd <> 'SELECT'")" = 0 ]; then
	ok "aucune politique d'écriture sur la file"
else
	fail "la file accepte une écriture directe : la garde serait contournable"
fi

titre "3. Ce que le worker ne fait JAMAIS"

# LE CODE, JAMAIS LE TEXTE DU SERVEUR (§13.7 et §8) : un message d'erreur brut expose la version,
# l'hôte, parfois l'adresse.
if grep -q 'classer_panne_smtp' "$WORKER"; then
	ok "un échec d'envoi est nommé par un CODE, jamais par le texte du serveur"
else
	fail "le worker journalise autre chose qu'un code d'erreur"
fi

if grep -qE 'dire\("envoi_reussi", \{"outbox_id"' "$WORKER"; then
	ok "le journal ne porte ni corps, ni destinataire — identifiant et Message-ID suffisent"
else
	fail "le journal du worker a changé de forme : vérifier qu'il ne porte aucun contenu"
fi

titre "4. Les preuves dédiées"

if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -f - < "$TEST_SQL" \
	>"$TRAVAIL/pgtap.log" 2>&1 && ! grep -q '^ *not ok' "$TRAVAIL/pgtap.log"; then
	ok "pgTAP $TEST_SQL : $(grep -c ' ok [0-9]' "$TRAVAIL/pgtap.log") assertions vertes"
else
	fail_journal "pgTAP ÉCHOUE" "$TRAVAIL/pgtap.log"
fi

if [ -x "$RACINE/.venv/bin/python" ]; then PYTHON=$RACINE/.venv/bin/python; else PYTHON=python3; fi

if [ "$RAPIDE" = true ]; then
	titre "5. Preuves longues"
	ok "--rapide : Playwright et pytest ne sont pas exécutés (annoncé, non masqué)"
else
	titre "5. pytest, API, aller-retour et écran"

	if "$PYTHON" -m pytest "$RACINE/$TEST_MODULE" -q >"$TRAVAIL/pytest.log" 2>&1; then
		ok "pytest $TEST_MODULE : $(tail -1 "$TRAVAIL/pytest.log")"
	else
		fail_journal "pytest ÉCHOUE" "$TRAVAIL/pytest.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		ok "e2e api : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1) hors interface"
	else
		fail_journal "les preuves d'API ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	# L'ALLER-RETOUR RÉEL : c'est la preuve que la Definition of Done exige, et aucune autre ne la
	# remplace — le message part vraiment, revient vraiment, et se range vraiment.
	if npx playwright test --config e2e/playwright.config.ts --project=mail "$SPEC_MAIL" \
		>"$TRAVAIL/mail.log" 2>&1; then
		ok "e2e mail : l'aller-retour complet est vert"
	else
		fail_journal "L'ALLER-RETOUR ÉCHOUE" "$TRAVAIL/mail.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		ok "e2e ui : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1) au clavier et à la souris"
	else
		fail_journal "le parcours d'écran ÉCHOUE" "$TRAVAIL/ui.log"
	fi

	titre "6. Non-complaisance"

	if "$PYTHON" -m pytest "$RACINE/$TEST_MODULE" -q >"$TRAVAIL/temoin.log" 2>&1; then
		ok "témoin : les preuves de composition sont VERTES avant toute dégradation"
	else
		fail_journal "témoin ROUGE : la suite ne mesure plus rien" "$TRAVAIL/temoin.log"
	fi

	degrader() {
		local libelle=$1 motif=$2 remplacement=$3
		sauvegarder "$MODULE"
		if ! sed -i "s|$motif|$remplacement|" "$MODULE" || ! grep -qF "$remplacement" "$MODULE"; then
			fail "dégradation INAPPLICABLE : $libelle"
			rendre "$MODULE"
			return
		fi
		if "$PYTHON" -m pytest "$RACINE/$TEST_MODULE" -q >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		rendre "$MODULE"
	}

	# LE `Reply-To` EST CE QUI RAMÈNE LES RÉPONSES : sans lui, elles reviendraient à l'expéditeur
	# et le CRM ne les verrait jamais.
	degrader "le Reply-To remplacé par l'expéditeur — les réponses ne reviendraient plus" \
		'message\["Reply-To"\] = envoi.reply_to' 'message["Reply-To"] = envoi.from_address'

	degrader "la chaîne References réduite à son dernier maillon — le fil se couperait" \
		'for identifiant in (\*envoi.references_ids, envoi.in_reply_to):' \
		'for identifiant in (envoi.in_reply_to,):'

	degrader "l'objet de repli retiré — un message arriverait sans intitulé" \
		'message\["Subject"\] = envoi.subject if envoi.subject else OBJET_PAR_DEFAUT' \
		'message["Subject"] = envoi.subject'

	degrader "les copies retirées de l'enveloppe — elles ne seraient jamais remises" \
		'return (\*envoi.to_addrs, \*envoi.cc_addrs)' 'return tuple(envoi.to_addrs)'

	titre "7. Restauration"
	if "$PYTHON" -m pytest "$RACINE/$TEST_MODULE" -q >"$TRAVAIL/restaure.log" 2>&1; then
		ok "les preuves de composition redeviennent vertes après restauration"
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
