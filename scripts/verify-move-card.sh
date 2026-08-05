#!/usr/bin/env bash
# @verifies CRM-034 (docs/BACKLOG.md) — Definition of Done de `move_card`
# @verifies docs/SPEC-workflow-engine.md §5.2 (signature), §5.3 (les six vérifications),
#           §5.4 (effets), §5.5 (protection de colonne), §5.6 (privilèges),
#           §5.7 (la n° 6 non livrable), §5.8 (contrat d'API), §5.9 (seed), §5.10 (preuves)
# @verifies docs/SPEC-permissions-rls.md §7 (preuves de refus n° 1 et n° 5)
# @verifies docs/SPEC-cards.md §2.6 (portée de `position`), §2.9 (`entered_step_at`), §5 (« active »)
# @verifies docs/INCONSISTENCY_REPORT.md INC-021 (aucun écran), INC-026 (le `hint` de PostgREST),
#           INC-047, INC-048, INC-049, INC-050, INC-051, INC-052
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-034` :
#
#   1. la suite pgTAP `supabase/tests/0013_move_card.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      changer la fonction ni les privilèges ;
#   3. elle est **convergente** : un `grant update on public.cards to authenticated` relâché à la
#      main — la porte que cette unité ferme — est **réparé** par un rejeu (décisions 57, 78) ;
#   4. les cinq vérifications livrées tiennent contre l'API, avec les jetons réels des trois
#      profils seedés, chaque refus **relisant la ligne** pour la constater inchangée ;
#   5. la garde n'est pas contournable : le `PATCH` direct de `current_step_id` est refusé, et les
#      colonnes ouvertes le restent ;
#   6. le seed est **inchangé** par cette unité et reste convergent ;
#   7. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **rien d'une interface**. Le board est `CRM-041`, et la webapp reste un appelant
# anonyme faute d'écran de connexion (INC-021) : il n'existe ni écran ni capture à produire pour
# cette unité. Les règles sont livrées et prouvées **en base et par l'API**, ce que `CLAUDE.md` §10
# exige de toute façon.
#
# Il ne prouve **pas la vérification n° 6** — champs requis renseignés — parce qu'elle n'est pas
# écrite : `card_field_values` est due par `CRM-036`. L'écart est **figé par des assertions** de la
# suite pgTAP et du scénario d'API, qui deviendront rouges à cette unité (INC-047).
#
# Il ne prouve **pas la conservation du commentaire** : `card_comments` est due par `CRM-043`, et le
# motif fourni est perdu (INC-048).
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-move-card.sh
#   scripts/verify-move-card.sh --rapide   n'exécute pas les suites Playwright

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE=supabase/tests/0013_move_card.test.sql
MIGRATION_FILE=supabase/migrations/0012_move_card.sql
# LA MIGRATION 13 SUIT TOUJOURS LA 12, ET CE N'EST PAS UNE PRÉCAUTION DE STYLE. Depuis `CRM-036`,
# la migration 13 REDÉFINIT `public.move_card` pour y ajouter sa sixième vérification. Rejouer la 12
# seule ramène donc la fonction à sa version à CINQ vérifications et **laisse le produit dégradé**,
# sans aucun signal — c'est exactement la faute que la décision 108 avait relevée sur
# `verify-tracks.sh`, qui réappliquait `0003` seule et ramenait la politique à sa version sans
# droits fins. `rejouer_migration` rejoue donc les deux, dans l'ordre.
MIGRATION_SUIVANTE=supabase/migrations/0013_valeurs_champs.sql

rejouer_migration() {
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || return 1
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_SUIVANTE" >/dev/null 2>&1 || return 1
}
DB_CONTAINER=p2enjoy-db

WF_GLOBAL=5eed0000-0000-4000-8000-000000000051
ETAPE_PROSPECT=5eed0000-0000-4000-8000-000000000061
ETAPE_RELANCE=5eed0000-0000-4000-8000-000000000062
ETAPE_NEGOCIATION=5eed0000-0000-4000-8000-000000000063
ETAPE_REALISATION=5eed0000-0000-4000-8000-000000000065
ETAPE_PERDU=5eed0000-0000-4000-8000-000000000067

CARD_C1=5eed0000-0000-4000-8000-0000000000c1  # grands-comptes, étape 62
CARD_C2=5eed0000-0000-4000-8000-0000000000c2  # grands-comptes, étape 62
CARD_C3=5eed0000-0000-4000-8000-0000000000c3  # grands-comptes, étape 61
CARD_C5=5eed0000-0000-4000-8000-0000000000c5  # maintenance : bizdev rétrogradé en lecture
CARD_C6=5eed0000-0000-4000-8000-0000000000c6  # inter-entreprises, étape 61
CARD_ARCHIVEE=5eed0000-0000-4000-8000-0000000000c8
CARD_CORBEILLE=5eed0000-0000-4000-8000-0000000000c9
CARD_INCONNUE=5eed0000-0000-4000-8000-0000000000ff
ETAPE_INCONNUE=5eed0000-0000-4000-8000-0000000000ee

MAIL_ADMIN=admin@p2enjoy.test
MAIL_BIZDEV=bizdev@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

# La liste des colonnes que `CRM-034` laisse ouvertes. Elle est écrite **une seule fois**, et sert
# à la fois à la restauration après dégradation et au contrôle de convergence : deux copies
# divergeraient tôt ou tard, et la restauration silencieusement fausse serait pire que l'absence
# de contrôle.
COLONNES_OUVERTES="title, description, position, owner_id, amount, currency,
	probability_override, next_action, next_action_at, snoozed_until,
	archived_at, deleted_at, email_local_part"

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,46p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 »." >&2; exit 1 ;;
	esac
	shift
done

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example." >&2
	exit 1
fi

env_value() {
	sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 \
		| sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

require_env() {
	local value
	value=$(env_value "$1")
	if [ -z "$value" ]; then
		echo "ERREUR : variable '$1' absente ou vide dans .env." >&2
		exit 1
	fi
	printf '%s' "$value"
}

KONG_HTTP_PORT=$(require_env KONG_HTTP_PORT)
ANON_KEY=$(require_env ANON_KEY)
SERVICE_ROLE_KEY=$(require_env SERVICE_ROLE_KEY)
API="http://127.0.0.1:${KONG_HTTP_PORT}"

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

CORPS=/tmp/p2enjoy-move-card-body
http() {
	local method=$1 url=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$url" "$@"
}

jeton_de() {
	curl -s -X POST "$API/auth/v1/token?grant_type=password" \
		-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
		-d "$(jq -nc --arg m "$1" --arg p "$MDP_SEED" '{email: $m, password: $p}')" \
		| jq -r '.access_token // empty'
}

# Appelle `move_card`. Un jeton vide signifie « appelant anonyme ».
deplacer() {
	local jeton=$1 card=$2 etape=$3 commentaire=${4:-}
	local charge
	if [ -n "$commentaire" ]; then
		charge=$(jq -nc --arg c "$card" --arg s "$etape" --arg m "$commentaire" \
			'{card_id: $c, to_step_id: $s, comment: $m}')
	else
		charge=$(jq -nc --arg c "$card" --arg s "$etape" '{card_id: $c, to_step_id: $s}')
	fi
	if [ -z "$jeton" ]; then
		http POST "$API/rest/v1/rpc/move_card" \
			-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' -d "$charge"
	else
		http POST "$API/rest/v1/rpc/move_card" \
			-H "apikey: $ANON_KEY" -H "Authorization: Bearer $jeton" \
			-H 'Content-Type: application/json' -d "$charge"
	fi
}

etape_de()    { psql_db -c "select current_step_id from public.cards where id = '$1';"; }
position_de() { psql_db -c "select position from public.cards where id = '$1';"; }
instant_de()  { psql_db -c "select entered_step_at from public.cards where id = '$1';"; }

# Remet une card où elle était. Passe par psql, donc par le propriétaire : les privilèges de colonne
# posés par cette unité ne s'appliquent pas à lui, et c'est exactement pourquoi la restauration est
# possible alors que le `PATCH` du client ne l'est pas.
remettre() {
	psql_db -c "update public.cards set current_step_id = '$2', position = $3 where id = '$1';" >/dev/null
}

# Vérifie qu'un refus n'a RIEN écrit. C'est la moitié de chaque preuve : un code d'erreur seul
# serait vert sur une garde qui écrirait d'abord et refuserait ensuite.
constater_inchangee() {
	local card=$1 etape=$2 position=$3 instant=$4 libelle=$5
	if [ "$(etape_de "$card")" = "$etape" ] \
	   && [ "$(position_de "$card")" = "$position" ] \
	   && [ "$(instant_de "$card")" = "$instant" ]; then
		ok "$libelle"
	else
		fail "$libelle — la ligne a CHANGÉ malgré le refus"
	fi
}

# Un refus attendu : code HTTP et message du corps.
attendre_refus() {
	local code_obtenu=$1 code_attendu=$2 message_attendu=$3 libelle=$4
	local message
	message=$(jq -r '.message // empty' "$CORPS" 2>/dev/null || printf '')
	if [ "$code_obtenu" = "$code_attendu" ] && [ "$message" = "$message_attendu" ]; then
		ok "$libelle"
	else
		fail "$libelle — attendu $code_attendu/$message_attendu, obtenu $code_obtenu/${message:-<vide>}"
	fi
}

for outil in docker curl jq; do
	command -v "$outil" >/dev/null 2>&1 || { echo "ERREUR : « $outil » est requis." >&2; exit 1; }
done

docker exec "$DB_CONTAINER" true >/dev/null 2>&1 \
	|| { echo "ERREUR : le conteneur $DB_CONTAINER ne répond pas. Lancez ./runDev.sh." >&2; exit 1; }

# La restauration des privilèges est posée AVANT toute dégradation : une interruption ne doit jamais
# laisser la base avec la porte ouverte que cette unité a fermée.
restaurer_privileges() {
	psql_db -c "revoke update on public.cards from authenticated;
	            grant update ($COLONNES_OUVERTES) on public.cards to authenticated;
	            revoke all on function public.move_card(uuid, uuid, text) from public, anon;
	            grant execute on function public.move_card(uuid, uuid, text) to authenticated, service_role;" \
		>/dev/null 2>&1 || true
	# La dégradation « vérification n° 4 retirée » réécrit la FONCTION : les privilèges seuls ne la
	# restaurent pas. La migration 13 est rejouée, et c'est elle — non la 12 — qui porte la
	# définition à SIX vérifications depuis `CRM-036`. La rejouer ici garantit qu'une interruption
	# ne laisse jamais le produit avec une garde amputée.
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_SUIVANTE" >/dev/null 2>&1 || true
}
trap 'restaurer_privileges; rm -f "$CORPS"' EXIT

printf '\033[1mPreuves de CRM-034 — move_card, garde centrale\033[0m\n'

# =============================================================================================
titre '1. La suite pgTAP'
# =============================================================================================

sortie_tap=$(psql_db -v ON_ERROR_STOP=1 -f - < "$TEST_FILE" 2>&1) || true
echecs_tap=$(printf '%s\n' "$sortie_tap" | grep -c '^not ok' || true)
verts_tap=$(printf '%s\n' "$sortie_tap" | grep -c '^ok ' || true)

if [ "$echecs_tap" = "0" ] && [ "$verts_tap" -gt 0 ]; then
	ok "$TEST_FILE — $verts_tap assertions, aucune anomalie"
else
	fail "$TEST_FILE — $echecs_tap assertion(s) en échec sur $((verts_tap + echecs_tap))"
	printf '%s\n' "$sortie_tap" | grep '^not ok' | head -10 | sed 's/^/        /'
fi

# =============================================================================================
titre '2. La forme de la fonction et ses privilèges'
# =============================================================================================

[ "$(psql_db -c "select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'move_card';")" = "t" ] \
	&& ok 'la fonction est SECURITY DEFINER — c’est le mécanisme même de la garde (§5.5)' \
	|| fail 'la fonction n’est PAS SECURITY DEFINER'

[ "$(psql_db -c "select proconfig::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'move_card';")" = '{"search_path=\"\""}' ] \
	&& ok 'son search_path est vidé' \
	|| fail 'son search_path n’est pas vidé'

[ "$(psql_db -c "select has_function_privilege('anon', 'public.move_card(uuid, uuid, text)', 'execute');")" = "f" ] \
	&& ok 'anon n’a PAS EXECUTE — un revoke visant public seul ne suffisait pas (§5.6)' \
	|| fail 'anon a EXECUTE : le revoke ne vise pas anon nommément'

[ "$(psql_db -c "select has_function_privilege('authenticated', 'public.move_card(uuid, uuid, text)', 'execute');")" = "t" ] \
	&& ok 'authenticated a EXECUTE' \
	|| fail 'authenticated n’a pas EXECUTE'

# =============================================================================================
titre '3. La protection de colonne — preuve de refus n° 5'
# =============================================================================================

[ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update');")" = "f" ] \
	&& ok 'current_step_id est FERMÉE à authenticated — la garde n’est pas contournable' \
	|| fail 'current_step_id reste ouverte : la garde est facultative'

[ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'entered_step_at', 'update');")" = "f" ] \
	&& ok 'entered_step_at est fermée : docs/SPEC-cards.md §2.9 la réserve à move_card' \
	|| fail 'entered_step_at reste ouverte'

[ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'title', 'update');")" = "t" ] \
	&& ok 'title reste ouverte : le revoke n’a pas été trop large' \
	|| fail 'title est fermée — le revoke a cassé l’écriture ordinaire'

# INC-050 : la contradiction du §5.5 est consignée, non résolue. Le comportement reste inchangé.
[ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'email_local_part', 'update');")" = "t" ] \
	&& ok 'INC-050 : email_local_part reste ouverte, comme depuis CRM-040 — elle reste à CRM-013' \
	|| fail 'INC-050 : email_local_part a été fermée, ce qui livre la moitié de CRM-013 en silence'

[ "$(psql_db -c "select has_table_privilege('service_role', 'public.cards', 'update');")" = "t" ] \
	&& ok 'service_role conserve son UPDATE : le seed est inchangé (§5.9)' \
	|| fail 'service_role a perdu son UPDATE : le seed ne peut plus s’appliquer'

# =============================================================================================
titre '4. Le contrat d’API du §5.8, avec les jetons réels'
# =============================================================================================

JETON_ADMIN=$(jeton_de "$MAIL_ADMIN")
JETON_BIZDEV=$(jeton_de "$MAIL_BIZDEV")
JETON_VIEWER=$(jeton_de "$MAIL_VIEWER")

for couple in "admin:$JETON_ADMIN" "bizdev:$JETON_BIZDEV" "viewer:$JETON_VIEWER"; do
	if [ -z "${couple#*:}" ]; then
		fail "jeton du profil « ${couple%%:*} » non obtenu — le seed est-il appliqué ?"
		printf '\n\033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
		exit 1
	fi
done
ok 'les trois jetons sont obtenus par la véritable route de connexion'

# --- ligne a : l'anonyme ----------------------------------------------------------------------
etape_avant=$(etape_de "$CARD_C3"); position_avant=$(position_de "$CARD_C3"); instant_avant=$(instant_de "$CARD_C3")
code=$(deplacer "" "$CARD_C3" "$ETAPE_RELANCE")
[ "$code" = "401" ] \
	&& ok 'ligne a — anonyme → 401, refus de PRIVILÈGE (et non 403 : §5.6, MESURÉ)' \
	|| fail "ligne a — anonyme → attendu 401, obtenu $code"
constater_inchangee "$CARD_C3" "$etape_avant" "$position_avant" "$instant_avant" \
	'ligne a — et rien n’a été écrit'

# --- lignes b, c, d : le succès et ses effets --------------------------------------------------
# L'état de départ est constaté : la colonne d'arrivée contient DÉJÀ deux cards. Sur une colonne
# vide, « en fin » et « au début » donneraient tous deux 1.
rang_max=$(psql_db -c "select coalesce(max(position), 0) from public.cards where channel_id = (select channel_id from public.cards where id = '$CARD_C3') and current_step_id = '$ETAPE_RELANCE';")
[ "$rang_max" = "2" ] \
	&& ok 'état de départ constaté — la colonne d’arrivée porte déjà deux cards' \
	|| fail "état de départ inattendu — rang max $rang_max au lieu de 2 ; le seed est-il à jour ?"

code=$(deplacer "$JETON_ADMIN" "$CARD_C3" "$ETAPE_RELANCE")
if [ "$code" = "200" ]; then
	ok 'ligne b — admin, transition déclarée → 200'
else
	fail "ligne b — attendu 200, obtenu $code"
fi

# §5.2 : un type composite est rendu comme un OBJET JSON unique, non comme un tableau.
[ "$(jq -r 'type' "$CORPS")" = "object" ] \
	&& ok 'ligne b — la réponse est un OBJET, non un tableau : le client n’a pas à relire (§5.2)' \
	|| fail 'ligne b — la réponse n’est pas un objet JSON unique'

[ "$(jq -r '.current_step_id' "$CORPS")" = "$ETAPE_RELANCE" ] \
	&& ok 'ligne b — la valeur rendue porte l’étape d’ARRIVÉE' \
	|| fail 'ligne b — la valeur rendue ne porte pas l’étape d’arrivée'

instant_apres=$(instant_de "$CARD_C3")
[ "$instant_apres" != "$instant_avant" ] \
	&& ok 'ligne c — entered_step_at a AVANCÉ (docs/SPEC-cards.md §2.9)' \
	|| fail 'ligne c — entered_step_at n’a pas bougé'

[ "$(position_de "$CARD_C3")" = "3" ] \
	&& ok 'ligne d — position ← FIN de la colonne d’arrivée, soit 3 (§5.4)' \
	|| fail "ligne d — position attendue 3, obtenue $(position_de "$CARD_C3")"

remettre "$CARD_C3" "$etape_avant" "$position_avant"

# --- lignes e, f, g : la vérification n° 1 -----------------------------------------------------
code=$(deplacer "$JETON_ADMIN" "$CARD_INCONNUE" "$ETAPE_RELANCE")
attendre_refus "$code" 400 card_not_found 'ligne e — card inconnue → 400 card_not_found'

etape_avant=$(etape_de "$CARD_ARCHIVEE"); position_avant=$(position_de "$CARD_ARCHIVEE"); instant_avant=$(instant_de "$CARD_ARCHIVEE")
code=$(deplacer "$JETON_ADMIN" "$CARD_ARCHIVEE" "$ETAPE_RELANCE")
attendre_refus "$code" 400 card_not_found 'ligne f — card ARCHIVÉE traitée comme absente (§5, « active »)'
constater_inchangee "$CARD_ARCHIVEE" "$etape_avant" "$position_avant" "$instant_avant" \
	'ligne f — et rien n’a été écrit'

etape_avant=$(etape_de "$CARD_CORBEILLE"); position_avant=$(position_de "$CARD_CORBEILLE"); instant_avant=$(instant_de "$CARD_CORBEILLE")
code=$(deplacer "$JETON_ADMIN" "$CARD_CORBEILLE" "$ETAPE_RELANCE")
attendre_refus "$code" 400 card_not_found 'ligne g — card en CORBEILLE de même'
constater_inchangee "$CARD_CORBEILLE" "$etape_avant" "$position_avant" "$instant_avant" \
	'ligne g — et rien n’a été écrit'

# --- lignes h, i : la vérification n° 2 et la DISCRÉTION, par le MÊME profil --------------------
# INC-051 : la ligne i du §5.8 nomme le `bizdev`. MESURÉ, il LIT les neuf cards du seed et l'appel
# rend 200 ; le profil qui exerce réellement ce refus est le `viewer`. Consigné, non résolu en
# silence, et le seed n'est pas modifié pour faire coller la spécification (§5.9).
etape_avant=$(etape_de "$CARD_C6"); position_avant=$(position_de "$CARD_C6"); instant_avant=$(instant_de "$CARD_C6")
code=$(deplacer "$JETON_VIEWER" "$CARD_C6" "$ETAPE_RELANCE")
attendre_refus "$code" 403 forbidden 'ligne h — viewer, card qu’il VOIT → 403 (preuve de refus n° 1)'
constater_inchangee "$CARD_C6" "$etape_avant" "$position_avant" "$instant_avant" \
	'ligne h — et rien n’a été écrit'

etape_avant=$(etape_de "$CARD_C1"); position_avant=$(position_de "$CARD_C1"); instant_avant=$(instant_de "$CARD_C1")
code=$(deplacer "$JETON_VIEWER" "$CARD_C1" "$ETAPE_NEGOCIATION")
attendre_refus "$code" 400 card_not_found \
	'ligne i — LE MÊME viewer, card d’un channel fermé → card_not_found (discrétion, INC-051)'
constater_inchangee "$CARD_C1" "$etape_avant" "$position_avant" "$instant_avant" \
	'ligne i — et rien n’a été écrit'

etape_avant=$(etape_de "$CARD_C5"); position_avant=$(position_de "$CARD_C5"); instant_avant=$(instant_de "$CARD_C5")
code=$(deplacer "$JETON_BIZDEV" "$CARD_C5" "$ETAPE_RELANCE")
attendre_refus "$code" 403 forbidden 'bizdev rétrogradé par un droit fin de CHANNEL → 403 forbidden'
constater_inchangee "$CARD_C5" "$etape_avant" "$position_avant" "$instant_avant" \
	'et rien n’a été écrit'

# --- lignes j, k, l : les vérifications n° 3, 4, 5 ---------------------------------------------
etape_ailleurs=$(psql_db -c "select id from public.workflow_steps where workflow_id <> '$WF_GLOBAL' limit 1;")
etape_avant=$(etape_de "$CARD_C2"); position_avant=$(position_de "$CARD_C2"); instant_avant=$(instant_de "$CARD_C2")

if [ -n "$etape_ailleurs" ]; then
	code=$(deplacer "$JETON_ADMIN" "$CARD_C2" "$etape_ailleurs")
	attendre_refus "$code" 400 step_not_in_workflow \
		'ligne j — étape d’un AUTRE workflow → step_not_in_workflow (message de produit)'
else
	fail 'ligne j — le seed ne porte aucune copie de workflow ; CRM-032 est-elle appliquée ?'
fi

code=$(deplacer "$JETON_ADMIN" "$CARD_C2" "$ETAPE_INCONNUE")
attendre_refus "$code" 400 step_not_in_workflow 'ligne j — étape INEXISTANTE → le même message'

# L'ORDRE des n° 3 et n° 4 est prouvé ici : l'étape 65 appartient bien au workflow de la card, et
# aucune arête ne l'atteint depuis 62. Si la n° 3 passait après la n° 4, ce cas rendrait
# `step_not_in_workflow` et enverrait le client chercher un workflow là où il manque une arête.
code=$(deplacer "$JETON_ADMIN" "$CARD_C2" "$ETAPE_REALISATION")
attendre_refus "$code" 400 transition_not_allowed \
	'ligne k — étape du BON workflow, non reliée → transition_not_allowed (l’ORDRE est prouvé)'
constater_inchangee "$CARD_C2" "$etape_avant" "$position_avant" "$instant_avant" \
	'lignes j et k — et rien n’a été écrit'

etape_avant=$(etape_de "$CARD_C6"); position_avant=$(position_de "$CARD_C6"); instant_avant=$(instant_de "$CARD_C6")
code=$(deplacer "$JETON_ADMIN" "$CARD_C6" "$ETAPE_PERDU")
attendre_refus "$code" 400 comment_required 'ligne l — transition à commentaire, sans commentaire'

code=$(deplacer "$JETON_ADMIN" "$CARD_C6" "$ETAPE_PERDU" '   ')
attendre_refus "$code" 400 comment_required 'ligne l — un commentaire d’ESPACES vaut l’absence'
constater_inchangee "$CARD_C6" "$etape_avant" "$position_avant" "$instant_avant" \
	'ligne l — et rien n’a été écrit'

code=$(deplacer "$JETON_ADMIN" "$CARD_C6" "$ETAPE_PERDU" 'Budget reporté en 2027')
[ "$code" = "200" ] \
	&& ok 'ligne l — la MÊME transition passe avec un commentaire réel (sens du SUCCÈS)' \
	|| fail "ligne l — attendu 200 avec commentaire, obtenu $code"
remettre "$CARD_C6" "$etape_avant" "$position_avant"

# --- ligne m : la garde n'est pas contournable -------------------------------------------------
etape_avant=$(etape_de "$CARD_C3"); position_avant=$(position_de "$CARD_C3"); instant_avant=$(instant_de "$CARD_C3")
code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_C3" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON_ADMIN" \
	-H 'Content-Type: application/json' \
	-d "$(jq -nc --arg s "$ETAPE_PERDU" '{current_step_id: $s}')")
if [ "$code" = "403" ] && [ "$(jq -r '.code' "$CORPS")" = "42501" ]; then
	ok 'ligne m — PATCH direct de current_step_id → 403/42501 (PREUVE DE REFUS N° 5)'
else
	fail "ligne m — attendu 403/42501, obtenu $code/$(jq -r '.code // empty' "$CORPS")"
fi
constater_inchangee "$CARD_C3" "$etape_avant" "$position_avant" "$instant_avant" \
	'ligne m — et rien n’a été écrit'

# INC-026, quatrième occurrence : le `hint` divulgue la commande GRANT à exécuter. Comportement de
# PostgREST et non du produit — constaté, non masqué, pour que sa disparition soit remarquée.
jq -r '.hint // empty' "$CORPS" | grep -q 'GRANT UPDATE ON public.cards' \
	&& ok 'INC-026 — le hint de PostgREST divulgue la commande GRANT : constaté, non masqué' \
	|| fail 'INC-026 — le hint attendu a changé ; l’entrée doit être révisée'

code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_C3" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON_ADMIN" \
	-H 'Content-Type: application/json' -d '{"description":"sonde verify-move-card"}')
[ "$code" = "204" ] \
	&& ok 'ligne m — les colonnes OUVERTES le restent : un revoke trop large aurait tout cassé' \
	|| fail "ligne m — l’écriture d’une colonne ouverte a échoué ($code)"
psql_db -c "update public.cards set description = 'Premier appel de qualification' where id = '$CARD_C3';" >/dev/null

# =============================================================================================
titre '5. La migration est rejouable et CONVERGENTE'
# =============================================================================================

if rejouer_migration; then
	ok 'la migration se rejoue sans erreur sur une base déjà migrée'
else
	fail 'la migration échoue au rejeu'
fi

[ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update');")" = "f" ] \
	&& ok 'le rejeu laisse current_step_id fermée' \
	|| fail 'le rejeu a rouvert current_step_id'

# CONVERGENCE — le contrôle qui compte. La porte que cette unité ferme est précisément celle qu'un
# `grant update on public.cards to authenticated` rouvre d'un seul geste. Une migration seulement
# idempotente la laisserait ouverte ; celle-ci doit la REFERMER.
psql_db -c "grant update on public.cards to authenticated;" >/dev/null
[ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update');")" = "t" ] \
	&& ok 'dégradation posée : le privilège de table est rendu, la garde redevient contournable' \
	|| fail 'la dégradation n’a pas pris effet — le contrôle qui suit ne prouverait rien'

rejouer_migration || true
if [ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'current_step_id', 'update');")" = "f" ]; then
	ok 'CONVERGENCE : le rejeu REFERME la porte rouverte à la main (décision 57)'
else
	fail 'CONVERGENCE : le rejeu laisse la porte ouverte — la migration n’est qu’idempotente'
fi

# =============================================================================================
titre '6. Non-complaisance : trois dégradations réelles'
# =============================================================================================
# Un harnais qui ne casse jamais ne prouve rien. Chaque dégradation ci-dessous fait passer une
# opération qui doit être refusée, et la RESTAURATION est constatée, non supposée.

rejouer_tap() {
	local sortie
	sortie=$(psql_db -f - < "$TEST_FILE" 2>&1) || true
	printf '%s\n' "$sortie" | grep -c '^not ok' || true
}

# --- dégradation a : le privilège de colonne est rendu ----------------------------------------
psql_db -c "grant update on public.cards to authenticated;" >/dev/null
echecs=$(rejouer_tap)
[ "$echecs" -gt 0 ] \
	&& ok "dégradation a (privilège de colonne rendu) — la suite pgTAP échoue : $echecs assertion(s)" \
	|| fail 'dégradation a — la suite reste VERTE : elle ne prouve pas la protection de colonne'
restaurer_privileges
[ "$(rejouer_tap)" = "0" ] \
	&& ok 'dégradation a — restauration CONSTATÉE, la suite redevient verte' \
	|| fail 'dégradation a — la restauration n’a pas rétabli l’état initial'

# --- dégradation b : anon retrouve EXECUTE ------------------------------------------------------
psql_db -c "grant execute on function public.move_card(uuid, uuid, text) to anon;" >/dev/null
echecs=$(rejouer_tap)
[ "$echecs" -gt 0 ] \
	&& ok "dégradation b (anon retrouve EXECUTE) — la suite pgTAP échoue : $echecs assertion(s)" \
	|| fail 'dégradation b — la suite reste VERTE : elle ne prouve pas le privilège de la fonction'
restaurer_privileges
[ "$(rejouer_tap)" = "0" ] \
	&& ok 'dégradation b — restauration CONSTATÉE' \
	|| fail 'dégradation b — la restauration n’a pas rétabli l’état initial'

# --- dégradation c : la vérification n° 4 est retirée -------------------------------------------
# La plus importante des trois : c'est l'objet même de l'unité. Sans elle, une card franchit une
# arête que personne n'a déclarée, et la garde n'oppose plus le graphe.
psql_db -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
create or replace function public.move_card(card_id uuid, to_step_id uuid, comment text default null)
returns public.cards language plpgsql security definer set search_path = '' as $degrade$
declare v_card_id uuid := card_id; v_cible uuid := to_step_id; v_card public.cards%rowtype;
begin
	select c.* into v_card from public.cards c
	 where c.id = v_card_id and c.archived_at is null and c.deleted_at is null
	   and app.can_read_channel(c.channel_id);
	if not found then raise exception 'card_not_found'; end if;
	if not app.can_write_channel(v_card.channel_id) then
		raise exception 'forbidden' using errcode = '42501'; end if;
	if not exists (select 1 from public.workflow_steps s
	                where s.id = v_cible and s.workflow_id = v_card.workflow_id) then
		raise exception 'step_not_in_workflow'; end if;
	update public.cards c set current_step_id = v_cible, entered_step_at = now(),
	       position = (select coalesce(max(a.position), 0) + 1 from public.cards a
	                    where a.channel_id = v_card.channel_id and a.current_step_id = v_cible)
	 where c.id = v_card_id returning c.* into v_card;
	return v_card;
end; $degrade$;
SQL
echecs=$(rejouer_tap)
[ "$echecs" -gt 0 ] \
	&& ok "dégradation c (vérification n° 4 retirée) — la suite pgTAP échoue : $echecs assertion(s)" \
	|| fail 'dégradation c — la suite reste VERTE alors que le graphe n’est plus opposable'

rejouer_migration || true
[ "$(rejouer_tap)" = "0" ] \
	&& ok 'dégradation c — restauration CONSTATÉE par le rejeu de la migration' \
	|| fail 'dégradation c — la restauration n’a pas rétabli l’état initial'

# =============================================================================================
titre '7. Le seed est inchangé par cette unité'
# =============================================================================================
# §5.9 : le graphe seedé fournit déjà tout ce dont la garde a besoin, et le seed n'est pas modifié.

# Le compte est porté sur le workflow GLOBAL, et non sur la table entière : la copie de portée
# track livrée par `CRM-032` reproduit fidèlement les dix arêtes, dont les quatre à commentaire —
# MESURÉ, quatre de chaque côté, huit au total. Compter globalement ferait échouer ce contrôle
# pour une raison qui n'a rien à voir avec la garde.
[ "$(psql_db -c "select count(*) from public.workflow_transitions where require_comment and workflow_id = '$WF_GLOBAL';")" = "4" ] \
	&& ok 'les quatre transitions « Marquer perdu » à commentaire sont là — la donnée qui exerce la n° 5' \
	|| fail 'le graphe seedé a changé : les quatre transitions à commentaire ne sont plus quatre'

[ "$(psql_db -c "select count(*) from public.cards where id::text like '5eed%';")" = "9" ] \
	&& ok 'les neuf cards du seed sont là, aux étapes déclarées' \
	|| fail 'le nombre de cards seedées a changé'

[ "$(psql_db -c "select count(*) from public.workflow_transitions where from_step_id = '$ETAPE_RELANCE' and to_step_id = '$ETAPE_REALISATION' and workflow_id = '$WF_GLOBAL';")" = "0" ] \
	&& ok '62 → 65 reste NON déclarée : la paire non reliée qui exerce la n° 4' \
	|| fail 'une arête 62 → 65 est apparue : le scénario de la ligne k perd son objet'

# =============================================================================================
titre '8. Les suites complètes'
# =============================================================================================

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m Playwright (--rapide)\n'
else
	if npm run e2e:api --silent >/tmp/p2enjoy-move-card-e2e.log 2>&1; then
		ok "npm run e2e:api — $(grep -oE '[0-9]+ passed' /tmp/p2enjoy-move-card-e2e.log | tail -1)"
	else
		fail 'npm run e2e:api — voir /tmp/p2enjoy-move-card-e2e.log'
		tail -20 /tmp/p2enjoy-move-card-e2e.log | sed 's/^/        /'
	fi
fi

# =============================================================================================
if [ "$failures" -eq 0 ]; then
	printf '\n\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
	exit 0
fi
printf '\n\033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
exit 1
