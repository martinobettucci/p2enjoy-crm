#!/usr/bin/env bash
# @verifies CRM-005 (docs/BACKLOG.md) — Definition of Done du seed socle
# @verifies docs/SPEC-seed.md §2 (contrat), §3 (mécanismes), §4 (identifiants stables),
#           §5 (gardes), §7 (les douze preuves exigées)
# @verifies docs/SPEC-permissions-rls.md §2.1 (rôles), §7 (refus par défaut, preuve n° 11)
# @verifies docs/SCHEMA.md §1 (`profiles`, `workspaces`, `workspace_members`)
# @verifies docs/INCONSISTENCY_REPORT.md INC-018 (politique de mot de passe non appliquée)
#
# Rejoue les douze preuves de `docs/SPEC-seed.md` §7, **toutes hors interface**, contre l'API
# réellement exposée par la passerelle. Elles portent sur quatre questions :
#
#   1. le seed a-t-il produit **exactement** le contrat du §2, identifiants fixes compris ;
#   2. les comptes qu'il pose **fonctionnent-ils réellement** — connexion, jeton, `sub` conforme ;
#   3. le seed **converge-t-il** — rejoué sans doublon, et rattrapant une dérive réellement
#      provoquée ;
#   4. le seed n'a-t-il **rien ouvert** au passage : le refus par défaut de `CRM-003` doit tenir.
#
# ---------------------------------------------------------------------------------------------
# Non-complaisance : la sévérité est éprouvée en faussant réellement le seed.
# ---------------------------------------------------------------------------------------------
# Un harnais qui ne sait pas échouer ne prouve rien. La section 6 casse tour à tour le rôle d'un
# membre, le nom d'un profil et l'existence d'un compte, exige que les contrôles concernés
# échouent, puis rejoue le seed et exige qu'ils repassent. Ce n'est pas une simulation : la base
# est réellement modifiée, et réellement rétablie.
#
# Le script ne démarre ni n'arrête la pile : elle doit déjà tourner (`./runDev.sh`). Il laisse la
# base dans l'état du seed, qu'il applique lui-même en entrant.
#
# Usage :
#   scripts/verify-seed.sh

set -euo pipefail

cd "$(dirname "$0")/.."

AUTH_CONTAINER=p2enjoy-auth
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
SEED_PASSWORD='SeedDev2026Local'

ADMIN_ID='5eed0000-0000-4000-8000-000000000011'
BIZDEV_ID='5eed0000-0000-4000-8000-000000000012'
VIEWER_ID='5eed0000-0000-4000-8000-000000000013'

COMPTES=(
	"$ADMIN_ID|admin@p2enjoy.test|Camille Aubert|admin"
	"$BIZDEV_ID|bizdev@p2enjoy.test|Driss Lemoine|business_developer"
	"$VIEWER_ID|viewer@p2enjoy.test|Farida Nowak|viewer"
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

if ! docker inspect -f '{{.State.Status}}' "$AUTH_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $AUTH_CONTAINER absent. Lancez ./runDev.sh." >&2
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

utilisateurs=$(curl -s "$API/auth/v1/admin/users?page=1&per_page=200" "${SR[@]}")

for ligne in "${COMPTES[@]}"; do
	IFS='|' read -r id email nom role <<< "$ligne"

	obtenu=$(jq -r --arg m "$email" '.users[]? | select(.email == $m) | .id' <<< "$utilisateurs")
	if [ "$obtenu" = "$id" ]; then
		ok "n° 2 — $email porte l'identifiant fixe $id"
	else
		fail "n° 2 — $email : identifiant attendu $id, observé « ${obtenu:-aucun compte} »"
	fi

	profil=$(rest "profiles?id=eq.$id&select=full_name,locale")
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
done

# --- 4. Appartenances et rôles (preuve n° 4) ---------------------------------------------------

echo
echo "3. Appartenances et rôles — docs/SPEC-permissions-rls.md §2.1"

membres=$(rest "workspace_members?workspace_id=eq.$WS_ID&select=user_id,role")

for ligne in "${COMPTES[@]}"; do
	IFS='|' read -r id email nom role <<< "$ligne"
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
	IFS='|' read -r id email nom role <<< "$ligne"

	code=$(http POST "$API/auth/v1/token?grant_type=password" \
		-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
		-d "$(jq -nc --arg e "$email" --arg p "$SEED_PASSWORD" '{email: $e, password: $p}')")

	if [ "$code" = "200" ]; then
		ok "n° 5 — $email se connecte avec le mot de passe publié"
	else
		fail "n° 5 — $email : connexion refusée, code $code $(head -c 160 "$CORPS")"
		continue
	fi

	jeton=$(jq -r '.access_token' "$CORPS")
	sub=$(jwt_payload "$jeton" | jq -r '.sub')
	if [ "$sub" = "$id" ]; then
		ok "n° 6 — le jeton de $email porte sub = $id"
	else
		fail "n° 6 — le jeton de $email porte sub = « $sub », attendu $id"
	fi
done

# --- 7. Le mot de passe respecte la politique (preuve n° 7) ------------------------------------
# Prouvé et non supposé : l'API d'administration employée par le seed **n'applique pas** cette
# politique (INC-018). Sans ce contrôle, un mot de passe trop court passerait sans bruit.

echo
echo "5. Politique de mot de passe — INC-018"

min=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$AUTH_CONTAINER" \
	| sed -n 's/^GOTRUE_PASSWORD_MIN_LENGTH=//p' | head -n 1)
if [ -n "$min" ] && [ "${#SEED_PASSWORD}" -ge "$min" ]; then
	ok "n° 7 — le mot de passe du seed fait ${#SEED_PASSWORD} caractères, minimum appliqué au conteneur : $min"
else
	fail "n° 7 — mot de passe du seed : ${#SEED_PASSWORD} caractères, minimum « ${min:-inconnu} »"
fi

# Rappel mesuré du motif d'INC-018 : la même API accepte huit caractères. Le contrôle vaut par ce
# qu'il documente autant que par ce qu'il vérifie — il échouera le jour où GoTrue durcira ce
# chemin, et il faudra alors clore INC-018.
code=$(http POST "$API/auth/v1/admin/users" "${SR[@]}" -H 'Content-Type: application/json' \
	-d '{"email":"crm-005-faible@p2enjoy.test","password":"court123","email_confirm":true}')
if [ "$code" = "200" ] || [ "$code" = "201" ]; then
	ok "n° 7 — INC-018 toujours d'actualité : l'API d'administration accepte 8 caractères"
	faible=$(jq -r '.id' "$CORPS")
	[ -n "$faible" ] && [ "$faible" != null ] && \
		curl -s -o /dev/null -X DELETE "$API/auth/v1/admin/users/$faible" "${SR[@]}"
else
	fail "n° 7 — l'API d'administration refuse désormais 8 caractères (code $code) : INC-018 est à clore"
fi

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

# --- 10 et 11. Le seed n'ouvre rien (preuves n° 10 et n° 11) -----------------------------------
# Peupler la base ne la rend pas lisible, et ne doit pas la rendre lisible. C'est le refus par
# défaut de CRM-003 qui doit tenir, seed ou pas.

echo
echo "8. Le refus par défaut tient toujours — docs/SPEC-permissions-rls.md §7"

for table in profiles workspaces workspace_members track_members channel_members; do
	code=$(http GET "$API/rest/v1/$table?select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY")
	n=$(jq 'length' "$CORPS" 2>/dev/null || echo -1)
	if [ "$code" = "200" ] && [ "$n" = "0" ]; then
		ok "n° 10 — anonyme sur $table : 200 et zéro ligne (et non une erreur)"
	else
		fail "n° 10 — anonyme sur $table : code $code, $n ligne(s)"
	fi
done

code=$(http POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "$(jq -nc --arg p "$SEED_PASSWORD" '{email: "admin@p2enjoy.test", password: $p}')")
jeton_admin=$(jq -r '.access_token' "$CORPS")

for table in profiles workspaces workspace_members; do
	code=$(http GET "$API/rest/v1/$table?select=*" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $jeton_admin")
	n=$(jq 'length' "$CORPS" 2>/dev/null || echo -1)
	if [ "$code" = "200" ] && [ "$n" = "0" ]; then
		ok "n° 11 — l'administrateur seedé ne voit rien de plus sur $table : 200 et zéro ligne"
	else
		fail "n° 11 — l'administrateur seedé voit $n ligne(s) sur $table (code $code) : une politique existe-t-elle ?"
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

# Un compte supprimé doit faire échouer les preuves n° 2, 3, 5 et 6.
curl -s -o /dev/null -X DELETE "$API/auth/v1/admin/users/$BIZDEV_ID" "${SR[@]}"
reste=$(curl -s "$API/auth/v1/admin/users?page=1&per_page=200" "${SR[@]}" \
	| jq -r '[.users[]? | select(.email == "bizdev@p2enjoy.test")] | length')
if [ "$reste" = "0" ]; then
	ok "mutation appliquée : le compte bizdev@p2enjoy.test est réellement supprimé"
else
	fail "mutation non appliquée : le compte est toujours présent, la suite ne prouverait rien"
fi

code=$(http POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "$(jq -nc --arg p "$SEED_PASSWORD" '{email: "bizdev@p2enjoy.test", password: $p}')")
if [ "$code" != "200" ]; then
	ok "le compte supprimé ne se connecte plus (code $code) : la preuve n° 5 sait échouer"
else
	fail "le compte supprimé se connecte encore : la preuve n° 5 est complaisante"
fi

profil_orphelin=$(rest "profiles?id=eq.$BIZDEV_ID&select=id" | jq 'length')
if [ "$profil_orphelin" -eq 0 ]; then
	ok "la cascade de CRM-003 a bien supprimé le profil du compte détruit"
else
	fail "un profil orphelin subsiste pour le compte détruit"
fi

# Rétablissement par le seed lui-même : c'est aussi une preuve de convergence après perte.
supabase/seed/apply-seed.sh >/dev/null 2>&1 || true

retabli=$(curl -s "$API/auth/v1/admin/users?page=1&per_page=200" "${SR[@]}" \
	| jq -r '.users[]? | select(.email == "bizdev@p2enjoy.test") | .id')
if [ "$retabli" = "$BIZDEV_ID" ]; then
	ok "le seed recrée le compte détruit avec le MÊME identifiant fixe"
else
	fail "compte recréé avec l'identifiant « ${retabli:-aucun} », attendu $BIZDEV_ID"
fi

role_retabli=$(rest "workspace_members?user_id=eq.$BIZDEV_ID&select=role" | jq -r '.[0].role // ""')
if [ "$role_retabli" = "business_developer" ]; then
	ok "le seed rétablit aussi l'appartenance et le rôle du compte recréé"
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
