#!/usr/bin/env bash
# @verifies CRM-089 (docs/BACKLOG.md) — Definition of Done de l'écran de configuration des
#           identités sortantes SMTP
# @verifies docs/SPEC-mail-subsystem.md §22.2 (l'adresse et sa place dans l'index), §22.3 (ce que
#           l'écran lit, et ce qu'il ne demande jamais), §22.5 (les deux règles opposées du nom
#           d'expéditeur et du mot de passe), §22.7 (le contrat mesuré), §22.8 (dictionnaire fermé
#           des refus), §22.12 et §22.12 bis (preuves exigées, contrat de ce harnais)
# @verifies docs/DESIGN_SYSTEM.md §5.35 (la surface) ; docs/SPEC-permissions-rls.md §7 (refus n° 6)
# @verifies docs/INCONSISTENCY_REPORT.md INC-193 (le corps d'un refus divulgue `secret_id`)
# @verifies CLAUDE.md §16 (vérification visuelle)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les six fichiers livrés existent et portent leur traçabilité ;
#   2. la surface est CÂBLÉE : chemin déclaré, écran monté hors de la table `ROUTES`, et son
#      entrée d'index placée APRÈS « Comptes entrants » et AVANT « État de la messagerie » —
#      l'ordre des TROIS entrées est lu dans la source ;
#   3. le contrat de base que l'écran suppose est TOUJOURS celui du §22.7, relu en base : les six
#      noms de contrainte sur lesquels le dictionnaire fermé classe ses refus, la révocation de
#      `secret_id` à `authenticated`, et le refus de la fonction d'écriture à `anon` ;
#   4. les preuves dédiées sont vertes — deux suites unitaires, l'API, l'interface, les captures ;
#   5. le harnais est NON COMPLAISANT, témoin compris : QUATRE dégradations réelles du module
#      livré, dont deux sont propres à cette unité et n'ont pas d'équivalent chez sa jumelle ;
#   6. la restauration est CONSTATÉE, octet à octet.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# AUCUN TEST DE CONNEXION n'existe depuis l'écran (§22.1) : la route qui l'exécute est interne à
# `mail-sync` et protégée par le jeton d'API du service. L'état affiché est celui que le service a
# écrit, et rien ici ne l'éprouve.
#
# LA DIVULGATION D'`INC-193` N'EST PAS CORRIGÉE : ce harnais constate que l'ÉCRAN ne l'affiche
# pas ; il ne constate pas que le serveur a cessé de la produire.
#
# Usage :
#   scripts/verify-mail-identites.sh
#   scripts/verify-mail-identites.sh --rapide   n'exécute pas Playwright (ni API, ni interface)

set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MODULE=webapp/src/lib/mail-identites.ts
COMPOSANT=webapp/src/app/ReglagesIdentitesMail.tsx
TEST_MODULE=webapp/src/lib/mail-identites.test.ts
TEST_COMPOSANT=webapp/src/app/ReglagesIdentitesMail.test.tsx
SPEC_API=e2e/api/identites-sortantes.spec.ts
SPEC_UI=e2e/ui/reglages-identites-mail.spec.ts
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
RAPPORTS=e2e/output/verify-mail-identites
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

printf '\033[1mPreuves de CRM-089 — configuration des identités sortantes SMTP\033[0m\n'

# ---------------------------------------------------------------------------------------------
titre "1. Fichiers livrés et traçabilité"
# ---------------------------------------------------------------------------------------------

for fichier in "$MODULE" "$COMPOSANT" "$TEST_MODULE" "$TEST_COMPOSANT" "$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

# L'EN-TÊTE EST LU EN ENTIER, jamais par une fenêtre de trois lignes — défaut qu'`INC-192` mesure
# sur `verify-corbeille.sh`, et que la jumelle de cette unité évite déjà. La lecture s'arrête à la
# première ligne qui n'est plus un commentaire, donc avant tout code.
entete() {
	awk '/^[[:space:]]*(\/\/|#|\/\*|\*)/ { print; next } /^[[:space:]]*$/ { next } { exit }' "$1"
}
for fichier in "$MODULE" "$COMPOSANT"; do
	if entete "$fichier" | grep -q '@spec CRM-089'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité dans son en-tête"
	fi
done
for fichier in "$TEST_MODULE" "$TEST_COMPOSANT" "$SPEC_UI"; do
	if entete "$fichier" | grep -q '@verifies CRM-089'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité dans son en-tête"
	fi
done
# `identites-sortantes.spec.ts` appartient à `CRM-053` et cite CRM-089 EN PLUS : la citation est
# donc cherchée partout dans le fichier, pas seulement dans son en-tête.
if grep -q 'CRM-089' "$SPEC_API"; then
	ok "$(basename "$SPEC_API") cite CRM-089 à côté de son unité d'origine"
else
	fail "$(basename "$SPEC_API") ne cite pas CRM-089"
fi

# ---------------------------------------------------------------------------------------------
titre "2. La surface est câblée — §22.2"
# ---------------------------------------------------------------------------------------------

if grep -q "^export const CHEMIN_ADMIN_IDENTITES_MAIL = '/reglages/identites-mail'" "$CHEMINS"; then
	ok "l'adresse /reglages/identites-mail est déclarée dans chemins.ts"
else
	fail "l'adresse n'est pas déclarée, ou elle a changé sans que la spécification suive"
fi

if grep -q 'path={CHEMIN_ADMIN_IDENTITES_MAIL}' "$APP"; then
	ok "l'écran est monté par App"
else
	fail "l'écran n'est monté par aucune route"
fi

# HORS de la table `ROUTES` : cette table porte la navigation principale, et une surface de
# réglages qui s'y glisserait apparaîtrait dans la barre latérale (§22.2). La table est isolée par
# son ouverture et sa fermeture, la constante étant légitimement citée ailleurs dans le fichier.
debut_routes=$(grep -n 'export const ROUTES' "$ROUTES" | head -1 | cut -d: -f1)
if [ -n "${debut_routes:-}" ]; then
	corps_routes=$(awk -v debut="$debut_routes" 'NR >= debut { print; if (/^\]/) exit }' "$ROUTES")
	if printf '%s' "$corps_routes" | grep -q 'CHEMIN_ADMIN_IDENTITES_MAIL'; then
		fail "l'écran figure dans la table ROUTES : il apparaîtrait dans la navigation principale"
	else
		ok "l'écran est HORS de la table ROUTES, comme les six autres surfaces de réglages"
	fi
else
	fail "la table ROUTES est introuvable dans $ROUTES"
fi

# L'ORDRE DES TROIS ENTRÉES PORTE UN SENS : on reçoit avant d'expédier, et on configure avant de
# superviser (§22.2). Il est lu dans la source sur les `to={…}` de l'index, jamais sur la première
# occurrence du fichier, qui est celle du bloc d'export.
ligne_comptes=$(grep -n 'to={CHEMIN_ADMIN_COMPTES_MAIL}' "$ROUTES" | head -1 | cut -d: -f1)
ligne_identites=$(grep -n 'to={CHEMIN_ADMIN_IDENTITES_MAIL}' "$ROUTES" | head -1 | cut -d: -f1)
ligne_etat=$(grep -n 'to={CHEMIN_ETAT_MESSAGERIE}' "$ROUTES" | head -1 | cut -d: -f1)
if [ -n "${ligne_comptes:-}" ] && [ -n "${ligne_identites:-}" ] && [ -n "${ligne_etat:-}" ]; then
	if [ "$ligne_comptes" -lt "$ligne_identites" ] && [ "$ligne_identites" -lt "$ligne_etat" ]; then
		ok "l'index range « Comptes entrants », « Identités d'expédition », puis « État »"
	else
		fail "l'ordre des trois entrées de la famille « messagerie » est rompu — §22.2"
	fi
else
	fail "l'une des trois entrées de l'index est absente"
fi

# ---------------------------------------------------------------------------------------------
titre "3. Le contrat de base que l'écran suppose — relu EN BASE, §22.7"
# ---------------------------------------------------------------------------------------------

CONTRAINTES="mail_outbound_identities_label_borne mail_outbound_identities_host_borne
mail_outbound_identities_port_borne mail_outbound_identities_securite
mail_outbound_identities_username_borne mail_outbound_identities_from_address"

if ! docker inspect "$DB_CONTAINER" >/dev/null 2>&1; then
	fail "le conteneur $DB_CONTAINER est absent : démarrez la pile (./runDev.sh)"
else
	# LES NOMS DE CONTRAINTE SONT LE DICTIONNAIRE. `classerEnregistrementIdentite` les cherche
	# dans le message de PostgreSQL ; un renommage en migration ferait retomber l'écran sur son
	# repli « refus inconnu », SILENCIEUSEMENT — aucune preuve unitaire ne le verrait, toutes
	# simulant la réponse du serveur.
	for contrainte in $CONTRAINTES; do
		if [ "$(psql_db -c "select count(*) from pg_constraint
			where conrelid = 'public.mail_outbound_identities'::regclass
			  and conname = '$contrainte'")" = 1 ]; then
			ok "la contrainte $contrainte porte toujours le nom sur lequel l'écran classe"
		else
			fail "$contrainte est ABSENTE ou renommée : le dictionnaire fermé du §22.8 est caduc"
		fi
	done

	# Chaque nom cité en base doit l'être aussi par le module, et réciproquement.
	for contrainte in $CONTRAINTES; do
		if grep -q "$contrainte" "$MODULE"; then
			ok "le module classe bien sur $contrainte"
		else
			fail "le module ne cite pas $contrainte : ce refus retomberait sur « inconnu »"
		fi
	done

	# LE MODULE NE DOIT PAS CITER LES CONTRAINTES DE LA TABLE ENTRANTE. Les deux jeux ont des
	# bornes DIFFÉRENTES — 120 caractères ici contre 200 là-bas —, et un module qui classerait sur
	# les deux afficherait la mauvaise borne sans qu'aucune preuve ne rougisse.
	if grep -q 'mail_inbound_accounts' "$MODULE"; then
		fail "le module cite une contrainte des comptes ENTRANTS : les bornes diffèrent (§22.5)"
	else
		ok "le module ne classe que sur les contraintes de sa propre table"
	fi

	# LES TREIZE COLONNES LUES EXISTENT. Une seule manquante ferait échouer la lecture ENTIÈRE de
	# l'écran, pour tous les profils, avec un message que le §22.8 ne sait pas classer.
	manquantes=0
	for colonne in id label owner_id smtp_host smtp_port smtp_security smtp_username \
		from_address from_name is_default status last_error last_checked_at; do
		if [ "$(psql_db -c "select count(*) from information_schema.columns
			where table_schema = 'public' and table_name = 'mail_outbound_identities'
			  and column_name = '$colonne'")" != 1 ]; then
			manquantes=$((manquantes + 1))
			printf '        colonne manquante : %s\n' "$colonne"
		fi
	done
	if [ "$manquantes" -eq 0 ]; then
		ok "les treize colonnes demandées par l'écran existent (§22.3)"
	else
		fail "$manquantes colonne(s) demandée(s) par l'écran n'existe(nt) pas"
	fi

	# `secret_id` RESTE RÉVOQUÉE : c'est la raison pour laquelle l'écran ne la demande pas
	# (§22.3, preuve de refus n° 6). MESURÉ : la citer rend 403 même à l'administratrice.
	if [ "$(psql_db -c "select has_column_privilege('authenticated',
		'public.mail_outbound_identities', 'secret_id', 'select')")" = f ]; then
		ok "secret_id reste REFUSÉE à authenticated — la cause du §22.3 tient toujours"
	else
		fail "secret_id est devenue lisible par authenticated : le §22.3 doit être révisé"
	fi

	# L'ÉCRIT RESTE REFUSÉ À `anon` : le classement `session-expiree` sur `401` en dépend (§22.7).
	#
	# LA SIGNATURE EST RÉSOLUE EN BASE, jamais recopiée ici : figer une liste d'arguments ferait
	# rendre à `has_function_privilege` une ERREUR le jour où la fonction gagne un paramètre —
	# erreur qu'un contrôle naïf lirait comme « le droit est ouvert ». C'est le défaut que la
	# décision 495 a corrigé dans la jumelle, et qui n'est pas reproduit ici.
	signature=$(psql_db -c "select p.oid::regprocedure from pg_proc p
		join pg_namespace n on n.oid = p.pronamespace
		where n.nspname = 'public' and p.proname = 'upsert_mail_outbound_identity'")
	if [ -z "${signature:-}" ]; then
		fail "upsert_mail_outbound_identity est ABSENTE : l'écran n'a plus de chemin d'écriture"
	elif [ "$(printf '%s\n' "$signature" | wc -l)" -ne 1 ]; then
		fail "upsert_mail_outbound_identity est SURCHARGÉE : PostgREST ne saurait laquelle appeler"
	elif [ "$(psql_db -c "select has_function_privilege('anon', '$signature', 'execute')")" = f ]; then
		ok "upsert_mail_outbound_identity reste refusée à anon (§22.7)"
	else
		fail "la fonction d'écriture est offerte à anon : une session n'est plus exigée"
	fi

	# LE `coalesce` DU NOM D'EXPÉDITEUR EST LA CAUSE MESURÉE de la règle « toujours envoyé »
	# (§22.5). S'il disparaissait de la fonction, la règle perdrait sa raison d'être et le module
	# devrait être révisé — ce contrôle est là pour qu'on le sache, plutôt que de le découvrir.
	if psql_db -c "select pg_get_functiondef('$signature'::regprocedure)" 2>/dev/null \
		| grep -q 'coalesce(p_from_name'; then
		ok "la fonction applique toujours coalesce(p_from_name, …) — la cause du §22.5 tient"
	else
		fail "coalesce(p_from_name, …) a disparu : la règle « toujours envoyé » doit être révisée"
	fi

	# LE SEED A DE QUOI MONTRER LES TROIS LECTURES (§22.11). Sans les deux identités, l'état vide
	# de la lectrice ne prouverait rien : il serait celui d'une table vide.
	identites=$(psql_db -c "select count(*) from public.mail_outbound_identities")
	if [ "${identites:-0}" -ge 2 ]; then
		ok "le seed pose $identites identités : les trois lectures du §22.11 ont un sujet"
	else
		fail "seulement ${identites:-0} identité(s) en base — appliquez supabase/seed/apply-seed.sh"
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
	if [ "${passes:-0}" -ge 62 ]; then
		ok "suites unitaires du module et de l'écran — ${passes} tests"
	else
		fail "suites unitaires vertes mais ${passes:-0} tests au lieu de 62 au moins"
	fi
else
	fail_journal "les suites unitaires ÉCHOUENT" "$TRAVAIL/unit.log"
fi

if [ "$RAPIDE" = false ]; then
	if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_API" >"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 10 ]; then
			ok "preuve d'API sur la pile réelle — 10 scénarios, jetons réels du seed"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 10"
		fi
	else
		fail_journal "la preuve d'API ÉCHOUE" "$TRAVAIL/api.log"
	fi

	# LE PORT 4173 EST LIBÉRÉ, ET LE MOTIF EST PROTÉGÉ PAR LA CLASSE `[v]` : écrit `pkill -f vite`,
	# le motif se retrouve dans la ligne de commande du shell qui l'exécute, et `pkill` tue son
	# propre appelant (mesuré, `docs/CloudWorker.md` §2.1 ter).
	pkill -f "[v]ite" 2>/dev/null || true
	if E2E_PROJETS=ui npx playwright test --config e2e/playwright.config.ts --project=ui \
		"$SPEC_UI" >"$TRAVAIL/ui.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 9 ]; then
			ok "preuve d'interface — 9 scénarios, console vierge"
		else
			fail "preuve d'interface verte mais ${passes:-0} scénarios au lieu de 9"
		fi
	else
		fail_journal "la preuve d'interface ÉCHOUE" "$TRAVAIL/ui.log"
	fi
fi

for capture in identites-mail-xl-1440 identites-mail-lg-1152 identites-mail-md-900 \
	identites-mail-sm-390 identites-mail-liste-1440 identites-mail-formulaire-1440 \
	identites-mail-refus-1440 identites-mail-vide-1440; do
	if [ -s "docs/captures/CRM-089/$capture.jpg" ]; then
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

# LE MOT DE PASSE VIDE ÉCRASERAIT LE SECRET ENREGISTRÉ. C'est la règle du §22.6, et elle est la
# seule chose qui sépare « modifier un libellé » de « perdre son adresse d'expédition ».
degrader_module "un mot de passe vide serait ENVOYÉ, écrasant le secret enregistré (§22.6)" \
	"if (saisie.motDePasse !== '') arguments_['p_password'] = saisie.motDePasse" \
	"arguments_['p_password'] = saisie.motDePasse"

# LA RÈGLE OPPOSÉE, ET ELLE EST PROPRE À CETTE UNITÉ. `p_from_name` est sous `coalesce` : l'omettre
# quand il est vide rendrait un nom d'expéditeur INEFFAÇABLE, et rien à l'écran ne le dirait —
# l'utilisateur effacerait le champ, enregistrerait, et retrouverait son nom (§22.5).
degrader_module "p_from_name OMIS quand il est vide — un nom deviendrait ineffaçable (§22.5)" \
	"		p_from_name: saisie.nomExpediteur," \
	"		...(saisie.nomExpediteur === '' ? {} : { p_from_name: saisie.nomExpediteur })," \

# LE QUOTA APPARTIENT À `CRM-058`, QUI LE CONSOMME. L'envoyer depuis cet écran l'écraserait, et
# `coalesce` interdit tout retour à `NULL` : la valeur serait perdue sans recours (§22.1).
degrader_module "p_daily_quota ENVOYÉ — le quota que CRM-058 consomme serait écrasé (§22.1)" \
	"		p_is_default: saisie.parDefaut," \
	"		p_is_default: saisie.parDefaut,
		p_daily_quota: 0,"

# `secret_id` DEMANDÉE FERAIT ÉCHOUER LA LECTURE ENTIÈRE, y compris pour l'administratrice —
# mesuré (§22.3, §22.7), et c'est plus dur encore que pour les comptes entrants.
degrader_module "secret_id ajoutée aux colonnes lues — la lecture deviendrait 403 (§22.3)" \
	"const COLONNES_ETAT = 'status, last_error, last_checked_at' as const" \
	"const COLONNES_ETAT = 'status, last_error, last_checked_at, secret_id' as const"

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
