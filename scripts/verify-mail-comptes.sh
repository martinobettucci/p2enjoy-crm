#!/usr/bin/env bash
# @verifies CRM-088 (docs/BACKLOG.md) — Definition of Done de l'écran de configuration des
#           comptes entrants IMAP
# @verifies docs/SPEC-mail-subsystem.md §21.2 (l'adresse et sa place dans l'index), §21.3 (ce que
#           l'écran lit, et ce qu'il ne demande jamais), §21.5 (un mot de passe vide est OMIS),
#           §21.6 (le contrat mesuré), §21.7 (dictionnaire fermé des refus),
#           §21.11 et §21.11 bis (preuves exigées, contrat de ce harnais)
# @verifies docs/DESIGN_SYSTEM.md §5.34 (la surface) ; docs/SPEC-permissions-rls.md §7 (refus n° 6)
# @verifies docs/INCONSISTENCY_REPORT.md INC-193 (le corps d'un refus divulgue `secret_id`)
# @verifies CLAUDE.md §16 (vérification visuelle)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les six fichiers livrés existent et portent leur traçabilité ;
#   2. la surface est CÂBLÉE : chemin déclaré, écran monté hors de la table `ROUTES`, et son
#      entrée d'index placée AVANT « État de la messagerie » — l'ordre est lu dans la source ;
#   3. le contrat de base que l'écran suppose est TOUJOURS celui du §21.6, relu en base : les cinq
#      noms de contrainte sur lesquels le dictionnaire fermé classe ses refus, la révocation de
#      `secret_id` à `authenticated`, et le refus de la fonction d'écriture à `anon` ;
#   4. les preuves dédiées sont vertes — deux suites unitaires, l'API, l'interface, les captures ;
#   5. le harnais est NON COMPLAISANT, témoin compris : trois dégradations réelles du module
#      livré, chacune sur une règle qui porte la sécurité de l'écran ;
#   6. la restauration est CONSTATÉE, octet à octet.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUN TEST DE CONNEXION n'existe depuis l'écran (§21.1) : la route qui l'exécute est interne à
# `mail-sync` et protégée par le jeton d'API du service. L'état affiché est celui que le service a
# écrit, et rien ici ne l'éprouve.
#
# LA DIVULGATION D'`INC-193` N'EST PAS CORRIGÉE : elle est figée par une assertion d'API, dans
# `e2e/api/comptes-entrants.spec.ts`. Ce harnais constate que l'ÉCRAN ne l'affiche pas ; il ne
# constate pas que le serveur a cessé de la produire.
#
# Usage :
#   scripts/verify-mail-comptes.sh
#   scripts/verify-mail-comptes.sh --rapide   n'exécute pas Playwright (ni API, ni interface)

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MODULE=webapp/src/lib/mail-comptes.ts
COMPOSANT=webapp/src/app/ReglagesComptesMail.tsx
TEST_MODULE=webapp/src/lib/mail-comptes.test.ts
TEST_COMPOSANT=webapp/src/app/ReglagesComptesMail.test.tsx
SPEC_API=e2e/api/comptes-entrants.spec.ts
SPEC_UI=e2e/ui/reglages-comptes-mail.spec.ts
ROUTES=webapp/src/app/routes.tsx
CHEMINS=webapp/src/app/chemins.ts
APP=webapp/src/app/App.tsx
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,38p' "$0"; exit 0 ;;
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
RAPPORTS=e2e/output/verify-mail-comptes
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

printf '\033[1mPreuves de CRM-088 — configuration des comptes entrants IMAP\033[0m\n'

# ---------------------------------------------------------------------------------------------
titre "1. Fichiers livrés et traçabilité"
# ---------------------------------------------------------------------------------------------

for fichier in "$MODULE" "$COMPOSANT" "$TEST_MODULE" "$TEST_COMPOSANT" "$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
for fichier in "$MODULE" "$COMPOSANT"; do
	if head -3 "$fichier" | grep -q '@spec CRM-088'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done
for fichier in "$TEST_MODULE" "$TEST_COMPOSANT" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-088'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité"
	fi
done
# `comptes-entrants.spec.ts` appartient à `CRM-052` et cite CRM-088 EN PLUS, dans son préambule :
# la citation n'est donc pas cherchée sur les trois premières lignes.
if grep -q 'CRM-088' "$SPEC_API"; then
	ok "$(basename "$SPEC_API") cite CRM-088 à côté de son unité d'origine"
else
	fail "$(basename "$SPEC_API") ne cite pas CRM-088"
fi

# ---------------------------------------------------------------------------------------------
titre "2. La surface est câblée — §21.2"
# ---------------------------------------------------------------------------------------------

if grep -q "^export const CHEMIN_ADMIN_COMPTES_MAIL = '/reglages/comptes-mail'" "$CHEMINS"; then
	ok "l'adresse /reglages/comptes-mail est déclarée dans chemins.ts"
else
	fail "l'adresse n'est pas déclarée, ou elle a changé sans que la spécification suive"
fi

if grep -q 'path={CHEMIN_ADMIN_COMPTES_MAIL}' "$APP"; then
	ok "l'écran est monté par App"
else
	fail "l'écran n'est monté par aucune route"
fi

# HORS de la table `ROUTES` : cette table porte la navigation principale, et une surface de
# réglages qui s'y glisserait apparaîtrait dans la barre latérale (§21.2, patron de `CRM-075`).
# On isole la table par son ouverture et sa fermeture plutôt que de chercher dans tout le fichier,
# où la constante est légitimement citée par l'index et par le bloc d'export.
debut_routes=$(grep -n 'export const ROUTES' "$ROUTES" | head -1 | cut -d: -f1)
if [ -n "${debut_routes:-}" ]; then
	corps_routes=$(awk -v debut="$debut_routes" 'NR >= debut { print; if (/^\]/) exit }' "$ROUTES")
	if printf '%s' "$corps_routes" | grep -q 'CHEMIN_ADMIN_COMPTES_MAIL'; then
		fail "l'écran figure dans la table ROUTES : il apparaîtrait dans la navigation principale"
	else
		ok "l'écran est HORS de la table ROUTES, comme les cinq autres surfaces de réglages"
	fi
else
	fail "la table ROUTES est introuvable dans $ROUTES"
fi

# L'ORDRE DE L'INDEX PORTE UN SENS : on configure une boîte avant d'en superviser la relève
# (§21.2). Il est lu dans la source, non supposé — et la lecture se fait sur les `to={…}` de
# l'index, jamais sur la première occurrence du fichier, qui est celle du bloc d'export.
ligne_comptes=$(grep -n 'to={CHEMIN_ADMIN_COMPTES_MAIL}' "$ROUTES" | head -1 | cut -d: -f1)
ligne_etat=$(grep -n 'to={CHEMIN_ETAT_MESSAGERIE}' "$ROUTES" | head -1 | cut -d: -f1)
if [ -n "${ligne_comptes:-}" ] && [ -n "${ligne_etat:-}" ]; then
	if [ "$ligne_comptes" -lt "$ligne_etat" ]; then
		ok "l'index des réglages place « Comptes entrants » AVANT « État de la messagerie »"
	else
		fail "l'ordre de l'index est inversé — §21.2"
	fi
else
	fail "l'une des deux entrées de l'index est absente"
fi

# ---------------------------------------------------------------------------------------------
titre "3. Le contrat de base que l'écran suppose — relu EN BASE, §21.6"
# ---------------------------------------------------------------------------------------------

if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
	fail "le conteneur $DB_CONTAINER est absent : démarrez la pile (./runDev.sh)"
else
	# LES NOMS DE CONTRAINTE SONT LE DICTIONNAIRE. `classerEnregistrement` les cherche dans le
	# message de PostgreSQL ; un renommage en migration ferait retomber l'écran sur son repli
	# « refus inconnu », SILENCIEUSEMENT — aucune preuve unitaire ne le verrait, toutes simulant
	# la réponse. C'est exactement le contrôle qui manquait à l'unité.
	for contrainte in mail_inbound_accounts_label_borne mail_inbound_accounts_host_borne \
		mail_inbound_accounts_port_borne mail_inbound_accounts_securite \
		mail_inbound_accounts_username_borne; do
		if [ "$(psql_db -c "select count(*) from pg_constraint
			where conrelid = 'public.mail_inbound_accounts'::regclass
			  and conname = '$contrainte'")" = 1 ]; then
			ok "la contrainte $contrainte porte toujours le nom sur lequel l'écran classe"
		else
			fail "$contrainte est ABSENTE ou renommée : le dictionnaire fermé du §21.7 est caduc"
		fi
	done

	# Chaque nom cité en base doit l'être aussi par le module, et réciproquement : une contrainte
	# vérifiée ici mais absente du code ne prouverait rien de l'écran.
	for contrainte in mail_inbound_accounts_label_borne mail_inbound_accounts_host_borne \
		mail_inbound_accounts_port_borne mail_inbound_accounts_securite \
		mail_inbound_accounts_username_borne; do
		if grep -q "$contrainte" "$MODULE"; then
			ok "le module classe bien sur $contrainte"
		else
			fail "le module ne cite pas $contrainte : ce refus retomberait sur « inconnu »"
		fi
	done

	# LES DIX COLONNES LUES EXISTENT. Une seule manquante ferait échouer la lecture ENTIÈRE de
	# l'écran, pour tous les profils, avec un message que le §21.7 ne sait pas classer.
	manquantes=0
	for colonne in id label owner_id imap_host imap_port imap_security imap_username \
		status last_error last_checked_at; do
		if [ "$(psql_db -c "select count(*) from information_schema.columns
			where table_schema = 'public' and table_name = 'mail_inbound_accounts'
			  and column_name = '$colonne'")" != 1 ]; then
			manquantes=$((manquantes + 1))
			printf '        colonne manquante : %s\n' "$colonne"
		fi
	done
	if [ "$manquantes" -eq 0 ]; then
		ok "les dix colonnes demandées par l'écran existent (§21.3)"
	else
		fail "$manquantes colonne(s) demandée(s) par l'écran n'existe(nt) pas"
	fi

	# `secret_id` RESTE RÉVOQUÉE : c'est la raison pour laquelle l'écran ne la demande pas
	# (§21.3, preuve de refus n° 6). Si le droit était rendu, la règle « ne jamais la demander »
	# perdrait sa cause mesurée et deviendrait une convention de style.
	if [ "$(psql_db -c "select has_column_privilege('authenticated',
		'public.mail_inbound_accounts', 'secret_id', 'select')")" = f ]; then
		ok "secret_id reste REFUSÉE à authenticated — la cause du §21.3 tient toujours"
	else
		fail "secret_id est devenue lisible par authenticated : le §21.3 doit être révisé"
	fi

	# L'ÉCRIT RESTE REFUSÉ À `anon` : le classement `session-expiree` sur `401` en dépend (§21.6).
	if [ "$(psql_db -c "select has_function_privilege('anon',
		'public.upsert_mail_inbound_account(uuid, uuid, text, text, integer, text, text, text, text[], text, integer)',
		'execute')")" = f ]; then
		ok "upsert_mail_inbound_account reste refusée à anon (§21.6)"
	else
		fail "la fonction d'écriture est offerte à anon : une session n'est plus exigée"
	fi

	# LE SEED A DE QUOI MONTRER LES TROIS LECTURES (§21.10). Sans les trois comptes, l'état vide
	# de la lectrice ne prouverait rien : il serait celui d'une table vide.
	comptes=$(psql_db -c "select count(*) from public.mail_inbound_accounts")
	if [ "${comptes:-0}" -ge 3 ]; then
		ok "le seed pose $comptes comptes : les trois lectures du §21.10 ont un sujet"
	else
		fail "seulement ${comptes:-0} compte(s) en base — appliquez supabase/seed/apply-seed.sh"
	fi
fi

# ---------------------------------------------------------------------------------------------
titre "4. Preuves exécutables"
# ---------------------------------------------------------------------------------------------

# LES DEUX SUITES SONT COMPTÉES, PAS SEULEMENT VERTES. Un fichier vidé de ses cas rendrait vert
# sans rien exercer — le mode de défaillance que `docs/SPEC-test-harness.md` §7.2 nomme.
vitest_cible() {
	local sortie=$1; shift
	npx vitest run --config webapp/vitest.config.ts "$@" >"$sortie" 2>&1
}
compter_tests() {
	grep -oE 'Tests +[0-9]+ passed' "$1" | tail -1 | grep -oE '[0-9]+'
}

if vitest_cible "$TRAVAIL/unit.log" "$TEST_MODULE" "$TEST_COMPOSANT"; then
	passes=$(compter_tests "$TRAVAIL/unit.log")
	if [ "${passes:-0}" -ge 48 ]; then
		ok "suites unitaires du module et de l'écran — ${passes} tests"
	else
		fail "suites unitaires vertes mais ${passes:-0} tests au lieu de 48 au moins"
	fi
else
	fail_journal "les suites unitaires ÉCHOUENT" "$TRAVAIL/unit.log"
fi

if [ "$RAPIDE" = false ]; then
	if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_API" >"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 14 ]; then
			ok "preuve d'API sur la pile réelle — 14 scénarios, jetons réels du seed"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 14"
		fi
	else
		fail_journal "la preuve d'API ÉCHOUE" "$TRAVAIL/api.log"
	fi

	if E2E_PROJETS=ui npx playwright test --config e2e/playwright.config.ts --project=ui \
		"$SPEC_UI" >"$TRAVAIL/ui.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 8 ]; then
			ok "preuve d'interface — 8 scénarios, console vierge"
		else
			fail "preuve d'interface verte mais ${passes:-0} scénarios au lieu de 8"
		fi
	else
		fail_journal "la preuve d'interface ÉCHOUE" "$TRAVAIL/ui.log"
	fi
fi

for capture in comptes-mail-xl-1440 comptes-mail-lg-1152 comptes-mail-md-900 \
	comptes-mail-sm-390 comptes-mail-refus-1440 comptes-mail-vide-1440; do
	if [ -s "docs/captures/CRM-088/$capture.jpg" ]; then
		ok "capture $capture.jpg produite"
	else
		fail "capture $capture.jpg ABSENTE — CLAUDE.md §16"
	fi
done

# ---------------------------------------------------------------------------------------------
titre "5. Non-complaisance"
# ---------------------------------------------------------------------------------------------

if vitest_cible "$TRAVAIL/temoin.log" "$TEST_MODULE" "$TEST_COMPOSANT"; then
	ok "témoin : les suites sont VERTES avant toute dégradation"
else
	fail_journal "témoin ROUGE" "$TRAVAIL/temoin.log"
fi

degrader_module() {
	local libelle=$1 motif=$2 remplacement=$3
	sauvegarder "$MODULE"
	if ! grep -qF "$motif" "$MODULE"; then
		rendre "$MODULE"
		fail "dégradation INAPPLICABLE : « $motif » n'existe plus dans $(basename "$MODULE")"
		return
	fi
	python3 - "$MODULE" "$motif" "$remplacement" <<-'PY'
		import sys
		chemin, motif, remplacement = sys.argv[1], sys.argv[2], sys.argv[3]
		source = open(chemin, encoding='utf-8').read()
		open(chemin, 'w', encoding='utf-8').write(source.replace(motif, remplacement, 1))
	PY
	if vitest_cible "$TRAVAIL/degrade.log" "$TEST_MODULE" "$TEST_COMPOSANT"; then
		fail "dégradation NON VUE : $libelle"
	else
		ok "dégradation vue : $libelle"
	fi
	rendre "$MODULE"
}

# LE MOT DE PASSE VIDE ÉCRASERAIT LE SECRET ENREGISTRÉ. C'est la règle du §21.5, et elle est la
# seule chose qui sépare « modifier un libellé » de « perdre l'accès à une boîte ».
degrader_module "un mot de passe vide serait ENVOYÉ, écrasant le secret enregistré (§21.5)" \
	"if (saisie.motDePasse !== '') arguments_['p_password'] = saisie.motDePasse" \
	"arguments_['p_password'] = saisie.motDePasse"

# `secret_id` DEMANDÉE FERAIT ÉCHOUER LA LECTURE ENTIÈRE, pour tout le monde sauf le service :
# le §21.3 dit pourquoi, la preuve de refus n° 6 le mesure.
degrader_module "secret_id ajoutée aux colonnes lues — la lecture deviendrait 403 (§21.3)" \
	"const COLONNES_ETAT = 'status, last_error, last_checked_at' as const" \
	"const COLONNES_ETAT = 'status, last_error, last_checked_at, secret_id' as const"

# RECOPIER LE SERVEUR, C'EST PUBLIER `INC-193`. Le dictionnaire fermé n'est pas une commodité de
# traduction : il est ce qui empêche le champ `details` d'un refus d'atteindre un écran.
degrader_module "un refus de contrainte retomberait sur le repli, la cause n'étant plus reconnue" \
	"if (message.includes('mail_inbound_accounts_port_borne')) return 'port-invalide'" \
	"if (false) return 'port-invalide'"

# ---------------------------------------------------------------------------------------------
titre "6. Restauration"
# ---------------------------------------------------------------------------------------------

# OCTET À OCTET, et contre l'INSTANTANÉ pris avant la dégradation — jamais contre `HEAD` : le
# harnais doit fonctionner dans un arbre portant une évolution légitime non encore committée
# (`docs/SPEC-test-harness.md` §7.2, point 9).
if cmp -s "$MODULE" "$SAUVEGARDES/$(printf '%s' "$MODULE" | tr '/' '@')"; then
	ok "$(basename "$MODULE") est identique, octet à octet, à l'instantané d'avant dégradation"
else
	fail "$(basename "$MODULE") DIFFÈRE de l'instantané : une dégradation a survécu"
fi

if vitest_cible "$TRAVAIL/restaure.log" "$TEST_MODULE" "$TEST_COMPOSANT"; then
	ok "les suites redeviennent vertes après restauration"
else
	fail_journal "les suites restent ROUGES après restauration" "$TRAVAIL/restaure.log"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
