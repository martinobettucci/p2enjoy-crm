#!/usr/bin/env bash
# @verifies CRM-005 (docs/BACKLOG.md) — Definition of Done du seed socle
# @verifies docs/SPEC-seed.md §2 (contrat), §3 (mécanismes), §4 (identifiants stables),
#           §5 (gardes), §7 (les douze preuves exigées, dont la n° 7 retirée par `CRM-092` T4)
# @verifies docs/SPEC-permissions-rls.md §2.1 (rôles), §7 (refus par défaut, preuve n° 11)
# @verifies docs/SCHEMA.md §1 (`profiles`, `workspaces`, `workspace_members`)
# @verifies docs/INCONSISTENCY_REPORT.md INC-018 (politique de mot de passe non appliquée) — sans objet
#           depuis `CRM-092` T4 : le CRM ne connaît plus aucun mot de passe
# @verifies CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §10, §11 — tranche T4 : comptes du
#           Keycloak de développement, attentes consommées par la vraie connexion, jetons internes
#
# Rejoue les preuves de `docs/SPEC-seed.md` §7 — onze depuis `CRM-092` T4 —, **toutes hors interface**, contre l'API
# réellement exposée par la passerelle. Elles portent sur quatre questions :
#
#   1. le seed a-t-il produit **exactement** le contrat du §2, identifiants fixes compris ;
#   2. les comptes qu'il pose **fonctionnent-ils réellement** — connexion, jeton, `sub` conforme ;
#   3. le seed **converge-t-il** — rejoué sans doublon, et rattrapant une dérive réellement
#      provoquée ;
#   4. les accès anonymes restent-ils fermés, tandis que les identités consenties par `CRM-022`
#      sont réellement lisibles avec un JWT membre.
#
# ---------------------------------------------------------------------------------------------
# Non-complaisance : la sévérité est éprouvée en faussant réellement le seed.
# ---------------------------------------------------------------------------------------------
# Un harnais qui ne sait pas échouer ne prouve rien. La section 6 casse tour à tour le rôle d'un
# membre, le nom d'un profil et le mot de passe d'un compte, exige que les contrôles concernés
# échouent, puis rejoue le seed et exige qu'ils repassent. Un compte seedé n'est plus supprimé :
# depuis CRM-022, ce geste détache légitimement l'auteur de ses paroles historiques.
#
# Le script ne démarre ni n'arrête la pile : elle doit déjà tourner (`./runDev.sh`). Il laisse la
# base dans l'état du seed, qu'il applique lui-même en entrant.
#
# Usage :
#   scripts/verify-seed.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/sso.sh
source scripts/lib/sso.sh
sso_env_charger .env

FUNCTIONS_CONTAINER=p2enjoy-functions
DB_CONTAINER=p2enjoy-db

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example." >&2
	exit 1
fi

env_value() {
	sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 \
		| sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

KONG_HTTP_PORT=$(env_value KONG_HTTP_PORT)
ANON_KEY=$(env_value ANON_KEY)
SERVICE_ROLE_KEY=$(env_value SERVICE_ROLE_KEY)

API="http://127.0.0.1:${KONG_HTTP_PORT}"

# Contrat attendu — docs/SPEC-seed.md §2. Répété ici volontairement : si le harnais lisait ces
# valeurs dans le script de seed, il ne vérifierait plus que le seed est conforme au contrat, mais
# seulement qu'il est conforme à lui-même.
WS_ID='5eed0000-0000-4000-8000-000000000001'
WS_NAME='P2Enjoy SAS'
WS_SLUG='p2enjoy'
WS_DOMAIN='crm.p2enjoy.test'

ADMIN_ID='5eed0000-0000-4000-8000-000000000011'
BIZDEV_ID='5eed0000-0000-4000-8000-000000000012'
VIEWER_ID='5eed0000-0000-4000-8000-000000000013'

COMPTES=(
	"$ADMIN_ID|admin@p2enjoy.test|Camille Aubert|/avatars/camille-aubert.svg|admin"
	"$BIZDEV_ID|bizdev@p2enjoy.test|Driss Lemoine|/avatars/driss-lemoine.svg|business_developer"
	"$VIEWER_ID|viewer@p2enjoy.test|Farida Nowak|/avatars/farida-nowak.svg|viewer"
)

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

CORPS=$(mktemp)
trap 'rm -f "$CORPS"' EXIT

SR=(-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")

rest() { curl -s "$API/rest/v1/$1" "${SR[@]}"; }

http() {
	local method=$1 url=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$url" "$@"
}

# Charge utile d'un JWT, décodée. Le base64url doit être recomplété avant décodage.
jwt_payload() {
	local p
	p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+')
	case $(( ${#p} % 4 )) in
		2) p="${p}==" ;;
		3) p="${p}=" ;;
	esac
	printf '%s' "$p" | base64 -d 2>/dev/null
}

echo
echo "Preuves de CRM-005 — seed socle"

# `CRM-092` T4 : les comptes se connectent par l'échangeur de session, et non plus par GoTrue.
if ! docker inspect -f '{{.State.Status}}' "$FUNCTIONS_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $FUNCTIONS_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

# Le harnais applique lui-même le seed : il doit prouver le résultat du script, pas celui d'un
# état laissé par une exécution antérieure dont il ignore tout.
echo
echo "0. Application du seed"
if supabase/seed/apply-seed.sh >/dev/null 2>&1; then
	ok "supabase/seed/apply-seed.sh s'exécute sans erreur"
else
	fail "supabase/seed/apply-seed.sh a échoué — les contrôles suivants n'ont plus de sens"
	echo
	echo "Résultat : $failures anomalie(s) sur $checks contrôle(s)." >&2
	exit 1
fi

# --- 0 bis. Suite pgTAP — le contrat vu au niveau SQL -------------------------------------------
# Un cran sous l'API : ni PostgREST, ni Kong, ni GoTrue. Une divergence entre cette vue et les
# contrôles suivants signalerait un cache de schéma périmé ou un privilège manquant.

echo
echo "0 bis. Suite pgTAP — supabase/tests/0003_seed_socle.test.sql"

SORTIE_PGTAP=$(mktemp)
if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 \
	-f /dev/stdin < supabase/tests/0003_seed_socle.test.sql > "$SORTIE_PGTAP" 2>&1; then
	:
fi

nb_ko=$(grep -c '^not ok' "$SORTIE_PGTAP" || true)
nb_ok=$(grep -c '^ok' "$SORTIE_PGTAP" || true)
if [ "$nb_ko" -eq 0 ] && [ "$nb_ok" -gt 0 ] && ! grep -q 'Looks like' "$SORTIE_PGTAP"; then
	ok "suite pgTAP : $nb_ok assertions, aucune anomalie"
else
	fail "suite pgTAP : $nb_ko anomalie(s) sur $nb_ok assertions"
	grep -E '^not ok|^# Looks like' "$SORTIE_PGTAP" | head -20
fi
rm -f "$SORTIE_PGTAP"

# --- 1. L'espace de travail (preuve n° 1) ------------------------------------------------------

echo
echo "1. Espace de travail — docs/SPEC-seed.md §2.1"

ws=$(rest "workspaces?id=eq.$WS_ID&select=id,name,slug,inbound_domain")
if [ "$(jq 'length' <<< "$ws")" -eq 1 ]; then
	ok "n° 1 — le workspace existe à l'identifiant fixe $WS_ID"
else
	fail "n° 1 — aucun workspace à l'identifiant $WS_ID"
fi

for champ in name:"$WS_NAME" slug:"$WS_SLUG" inbound_domain:"$WS_DOMAIN"; do
	cle=${champ%%:*}; attendu=${champ#*:}
	observe=$(jq -r --arg c "$cle" '.[0][$c] // ""' <<< "$ws")
	if [ "$observe" = "$attendu" ]; then
		ok "n° 1 — workspaces.$cle = « $attendu »"
	else
		fail "n° 1 — workspaces.$cle : attendu « $attendu », observé « $observe »"
	fi
done

total_ws=$(rest "workspaces?select=id" | jq 'length')
if [ "$total_ws" -eq 1 ]; then
	ok "n° 1 — un seul workspace en base, conformément à CRM-005"
else
	fail "n° 1 — $total_ws workspaces en base, or le seed socle n'en pose qu'un"
fi

# --- 2 et 3. Comptes et profils (preuves n° 2 et n° 3) -----------------------------------------

echo
echo "2. Comptes et profils — docs/SPEC-seed.md §2.2"

# RÉVISÉE par `CRM-092` T4 : le compte est celui du Keycloak de DÉVELOPPEMENT, dont le `sub` est
# l'identifiant fixe du contrat ; le seed n'en crée plus aucun (docs/SPEC-session-sso.md §10, §11).
for ligne in "${COMPTES[@]}"; do
	IFS='|' read -r id email nom avatar role <<< "$ligne"

	obtenu=$(sso_compte_id "$email" 2>/dev/null || true)
	if [ "$obtenu" = "$id" ]; then
		ok "n° 2 — le compte LeLabs de développement de $email porte le sub fixe $id"
	else
		fail "n° 2 — $email : sub attendu $id, observé « ${obtenu:-aucun compte} »"
	fi

	profil=$(rest "profiles?id=eq.$id&select=full_name,locale,avatar_url")
	if [ "$(jq -r '.[0].full_name // ""' <<< "$profil")" = "$nom" ]; then
		ok "n° 3 — profil de $email : full_name = « $nom »"
	else
		fail "n° 3 — profil de $email : full_name attendu « $nom », observé « $(jq -r '.[0].full_name // "aucun profil"' <<< "$profil") »"
	fi
	if [ "$(jq -r '.[0].locale // ""' <<< "$profil")" = "fr" ]; then
		ok "n° 3 — profil de $email : locale = « fr »"
	else
		fail "n° 3 — profil de $email : locale attendue « fr », observée « $(jq -r '.[0].locale // "-"' <<< "$profil") »"
	fi
	if [ "$(jq -r '.[0].avatar_url // ""' <<< "$profil")" = "$avatar" ]; then
		ok "n° 3 — profil de $email : avatar_url = « $avatar »"
	else
		fail "n° 3 — profil de $email : avatar attendu « $avatar », observé « $(jq -r '.[0].avatar_url // "-"' <<< "$profil") »"
	fi
done

# `CRM-092` T4 (§11) : l'attente d'`attendu@`, non vérifié par LeLabs, demeure ; `inconnu@`, attendu par
# personne, ne laisse aucune trace. Remplace la convergence de la métadonnée GoTrue, sans objet.
attente=$(rest "workspace_invitations?workspace_id=eq.$WS_ID&email=eq.attendu@p2enjoy.test&select=role")
if [ "$(jq -r '.[0].role // ""' <<< "$attente")" = viewer ]; then
	ok "n° 3 — l'attente d'attendu@p2enjoy.test est en place, non consommée"
else
	fail "n° 3 — attente d'attendu@p2enjoy.test absente ou altérée : $attente"
fi
if [ "$(rest "profiles?id=eq.5eed0000-0000-4000-8000-000000000014&select=id" | jq 'length')" = 0 ]; then
	ok "n° 3 — inconnu@p2enjoy.test n'a laissé aucun profil"
else
	fail "n° 3 — inconnu@p2enjoy.test a un profil, alors qu'aucun espace ne l'attend"
fi

# --- 4. Appartenances et rôles (preuve n° 4) ---------------------------------------------------

echo
echo "3. Appartenances et rôles — docs/SPEC-permissions-rls.md §2.1"

membres=$(rest "workspace_members?workspace_id=eq.$WS_ID&select=user_id,role")

for ligne in "${COMPTES[@]}"; do
	IFS='|' read -r id email nom avatar role <<< "$ligne"
	observe=$(jq -r --arg u "$id" '.[] | select(.user_id == $u) | .role' <<< "$membres")
	if [ "$observe" = "$role" ]; then
		ok "n° 4 — $email est « $role » dans le workspace"
	else
		fail "n° 4 — $email : rôle attendu « $role », observé « ${observe:-aucune appartenance} »"
	fi
done

nb_membres=$(jq 'length' <<< "$membres")
if [ "$nb_membres" -eq 3 ]; then
	ok "n° 4 — exactement 3 appartenances, aucune de plus"
else
	fail "n° 4 — $nb_membres appartenances, or le contrat en pose 3"
fi

roles_distincts=$(jq -r '[.[].role] | unique | length' <<< "$membres")
if [ "$roles_distincts" -eq 3 ]; then
	ok "n° 4 — les trois rôles de workspace sont représentés"
else
	fail "n° 4 — $roles_distincts rôle(s) distinct(s), or les trois doivent l'être"
fi

# --- 5 et 6. Les comptes fonctionnent réellement (preuves n° 5 et n° 6) -------------------------
# C'est ici que le seed cesse d'être une affirmation. Un compte présent en base mais incapable de
# se connecter ne sert ni aux tests ni aux captures.

echo
echo "4. Connexion réelle et contenu du jeton"

for ligne in "${COMPTES[@]}"; do
	IFS='|' read -r id email nom avatar role <<< "$ligne"

	# RÉVISÉE par `CRM-092` T4 : la vraie connexion LeLabs, puis l'échangeur de session.
	jeton=$(sso_jeton_interne "$API" "$ANON_KEY" "$email" 2>"$CORPS" || true)
	if [ -n "$jeton" ]; then
		ok "n° 5 — $email se connecte par LeLabs avec le mot de passe publié du realm de développement"
	else
		fail "n° 5 — $email : connexion refusée — $(head -c 160 "$CORPS")"
		continue
	fi

	sub=$(jwt_payload "$jeton" | jq -r '.sub')
	if [ "$sub" = "$id" ]; then
		ok "n° 6 — le jeton de $email porte sub = $id"
	else
		fail "n° 6 — le jeton de $email porte sub = « $sub », attendu $id"
	fi
done

# --- 7. Politique de mot de passe (preuve n° 7) — RETIRÉE avec son objet par `CRM-092` T4 --------
# Elle prouvait que le mot de passe du seed respectait le minimum de GoTrue, et que son API
# d'administration n'appliquait pas ce minimum (INC-018). Le CRM ne connaît plus aucun mot de passe :
# le mot de passe publié est celui du Keycloak de DÉVELOPPEMENT, que la politique du realm réel ne
# concerne pas, et le seed ne crée plus de compte (décision 587, docs/SPEC-session-sso.md §11).

# --- 8. Rejouabilité (preuve n° 8) -------------------------------------------------------------

echo
echo "6. Rejouabilité — le seed converge, il ne duplique pas"

avant=$(rest "workspace_members?select=user_id,role&order=user_id" | jq -c .)
ws_avant=$(rest "workspaces?select=id&order=id" | jq -c .)

if supabase/seed/apply-seed.sh >/dev/null 2>&1; then
	ok "n° 8 — second passage du seed sans erreur"
else
	fail "n° 8 — le second passage du seed échoue"
fi

apres=$(rest "workspace_members?select=user_id,role&order=user_id" | jq -c .)
ws_apres=$(rest "workspaces?select=id&order=id" | jq -c .)

if [ "$avant" = "$apres" ] && [ "$ws_avant" = "$ws_apres" ]; then
	ok "n° 8 — état identique après rejeu : aucune ligne dupliquée, aucun identifiant changé"
else
	fail "n° 8 — l'état a changé au second passage"
fi

# --- 9. Rattrapage d'une dérive (preuve n° 9) --------------------------------------------------
# La base est RÉELLEMENT faussée, puis rétablie. C'est ce qui distingue une convergence prouvée
# d'une convergence affirmée.

echo
echo "7. Rattrapage d'une dérive réellement provoquée"

curl -s -o /dev/null -X PATCH "$API/rest/v1/profiles?id=eq.$ADMIN_ID" "${SR[@]}" \
	-H 'Content-Type: application/json' -d '{"full_name":"Nom Derive"}'
curl -s -o /dev/null -X PATCH "$API/rest/v1/workspace_members?user_id=eq.$VIEWER_ID" "${SR[@]}" \
	-H 'Content-Type: application/json' -d '{"role":"admin"}'

nom_derive=$(rest "profiles?id=eq.$ADMIN_ID&select=full_name" | jq -r '.[0].full_name')
role_derive=$(rest "workspace_members?user_id=eq.$VIEWER_ID&select=role" | jq -r '.[0].role')
if [ "$nom_derive" = "Nom Derive" ] && [ "$role_derive" = "admin" ]; then
	ok "n° 9 — dérive réellement introduite (profil renommé, viewer promu admin)"
else
	fail "n° 9 — la dérive n'a pas pu être introduite : le contrôle suivant ne prouverait rien"
fi

supabase/seed/apply-seed.sh >/dev/null 2>&1 || true

nom_retabli=$(rest "profiles?id=eq.$ADMIN_ID&select=full_name" | jq -r '.[0].full_name')
role_retabli=$(rest "workspace_members?user_id=eq.$VIEWER_ID&select=role" | jq -r '.[0].role')
if [ "$nom_retabli" = "Camille Aubert" ]; then
	ok "n° 9 — le nom du profil est rétabli par le seed"
else
	fail "n° 9 — nom du profil non rétabli : « $nom_retabli »"
fi
if [ "$role_retabli" = "viewer" ]; then
	ok "n° 9 — le rôle dérivé est rétabli par le seed"
else
	fail "n° 9 — rôle non rétabli : « $role_retabli »"
fi

# --- 10 et 11. Anonyme fermé, équipe lisible (preuves n° 10 et n° 11) ---------------------------

echo
echo "8. Anonyme fermé, identités d'équipe lisibles — CRM-022"

for table in profiles workspaces workspace_members track_members channel_members; do
	code=$(http GET "$API/rest/v1/$table?select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
	n=$(jq 'length' "$CORPS" 2>/dev/null || echo -1)
	if [ "$code" = "200" ] && [ "$n" = "0" ]; then
		ok "n° 10 — anonyme sur $table : 200 et zéro ligne (et non une erreur)"
	else
		fail "n° 10 — anonyme sur $table : code $code, $n ligne(s)"
	fi
done

jeton_admin=$(sso_jeton_interne "$API" "$ANON_KEY" admin@p2enjoy.test 2>/dev/null || true)

for contrat in profiles:3 workspaces:1 workspace_members:3; do
	table=${contrat%%:*}
	attendu=${contrat#*:}
	code=$(http GET "$API/rest/v1/$table?select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $jeton_admin")
	n=$(jq 'length' "$CORPS" 2>/dev/null || echo -1)
	if [ "$code" = "200" ] && [ "$n" = "$attendu" ]; then
		ok "n° 11 — l'administratrice lit exactement $attendu ligne(s) consentie(s) sur $table"
	else
		fail "n° 11 — $table : attendu $attendu ligne(s), observé $n (code $code)"
	fi
done

# --- 12. La garde de profil (preuve n° 12) -----------------------------------------------------

echo
echo "9. Garde de profil d'environnement — docs/SPEC-seed.md §5"

FAUX_ENV=$(mktemp)
sed 's/^P2ENJOY_ENV_PROFILE=.*/P2ENJOY_ENV_PROFILE=prod/' .env > "$FAUX_ENV"

if P2ENJOY_ENV_FILE="$FAUX_ENV" supabase/seed/apply-seed.sh >/dev/null 2>&1; then
	fail "n° 12 — le seed s'est appliqué sur un profil « prod » : la garde ne protège rien"
else
	ok "n° 12 — le seed refuse un profil autre que « dev » (code de sortie non nul)"
fi

# La garde doit refuser AVANT d'écrire : on le vérifie, plutôt que de le supposer.
nb_ws=$(rest "workspaces?select=id" | jq 'length')
if [ "$nb_ws" -eq 1 ]; then
	ok "n° 12 — aucune écriture n'a eu lieu pendant le refus"
else
	fail "n° 12 — $nb_ws workspaces après le refus : la garde a laissé passer une écriture"
fi
rm -f "$FAUX_ENV"

# --- 10. Non-complaisance ----------------------------------------------------------------------
# Les contrôles ci-dessus n'ont de valeur que s'ils savent échouer. On casse réellement, on exige
# l'échec, on rétablit, on exige le retour à la normale.

echo
echo "10. Non-complaisance — le harnais échoue-t-il quand le seed est faux ?"

# RÉVISÉE par `CRM-092` T4. La dérive n'est plus un mot de passe GoTrue — le CRM n'en a plus — mais
# l'APPARTENANCE : retirée, la personne n'est plus ni membre ni attendue, et sa connexion doit être
# refusée ; la preuve n° 5 doit donc savoir échouer. Le seed doit ensuite la réinscrire comme
# ATTENTE, que la vraie connexion consomme, sans toucher à son identité ni à ses paroles.
commentaires_biz_avant=$(rest "card_comments?author_id=eq.$BIZDEV_ID&select=id" | jq 'length')
code=$(http DELETE "$API/rest/v1/workspace_members?workspace_id=eq.$WS_ID&user_id=eq.$BIZDEV_ID" "${SR[@]}")
if [ "$code" = "204" ] && [ "$(rest "workspace_members?user_id=eq.$BIZDEV_ID&select=role" | jq 'length')" = 0 ]; then
	ok "mutation appliquée : l'appartenance du compte bizdev est réellement retirée"
else
	fail "mutation non appliquée : l'appartenance de bizdev n'a pas pu être retirée (code $code)"
fi

if [ -z "$(sso_jeton_interne "$API" "$ANON_KEY" bizdev@p2enjoy.test 2>/dev/null || true)" ]; then
	ok "la connexion est refusée pendant la dérive : la preuve n° 5 sait échouer"
else
	fail "la connexion aboutit sans appartenance ni attente : la preuve n° 5 est complaisante"
fi

profil_conserve=$(rest "profiles?id=eq.$BIZDEV_ID&select=id" | jq 'length')
commentaires_biz_derives=$(rest "card_comments?author_id=eq.$BIZDEV_ID&select=id" | jq 'length')
if [ "$profil_conserve" -eq 1 ] && [ "$commentaires_biz_derives" -eq "$commentaires_biz_avant" ]; then
	ok "la dérive conserve le profil et ses auteurs historiques"
else
	fail "la dérive a touché l'identité ou ses paroles : profil=$profil_conserve, commentaires=$commentaires_biz_derives/$commentaires_biz_avant"
fi

# Rétablissement par le seed lui-même : attente réinscrite, consommée par la vraie connexion.
supabase/seed/apply-seed.sh >/dev/null 2>&1 || true

jeton_retabli=$(sso_jeton_interne "$API" "$ANON_KEY" bizdev@p2enjoy.test 2>/dev/null || true)
sub_retabli=$( [ -n "$jeton_retabli" ] && jwt_payload "$jeton_retabli" | jq -r '.sub' || true )
if [ -n "$jeton_retabli" ] && [ "$sub_retabli" = "$BIZDEV_ID" ]; then
	ok "le seed rétablit l'accès par une attente consommée, sous le même identifiant fixe"
else
	fail "connexion non rétablie (sub « ${sub_retabli:-absent} »)"
fi

role_retabli=$(rest "workspace_members?user_id=eq.$BIZDEV_ID&select=role" | jq -r '.[0].role // ""')
if [ "$role_retabli" = "business_developer" ]; then
	ok "le seed rétablit l'appartenance au rôle contractuel"
else
	fail "appartenance non rétablie : rôle « ${role_retabli:-aucun} »"
fi

# --- Résultat ----------------------------------------------------------------------------------

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s anomalie(s) sur %s contrôles.\033[0m\n' "$failures" "$checks"
	exit 1
fi
