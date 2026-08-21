#!/usr/bin/env bash
# @verifies CRM-009 (docs/BACKLOG.md) — gabarits français et contenu des emails réellement reçus
# @verifies CRM-011 (docs/BACKLOG.md) — Definition of Done du mécanisme GoTrue
# @verifies docs/SPEC-auth.md §2 (configuration imposée), §3 (cycle de vie d'un compte),
#           §4 (politique de mot de passe), §5 (gabarits et emails), §7 (preuves exigées)
# @verifies docs/DAT.md §4.1 (flux d'authentification), §7 (authentification et autorisation)
# @verifies docs/SCHEMA.md §1 (`profiles` et son trigger de création)
#
# Rejoue les vingt preuves exigées par `docs/SPEC-auth.md` §7, **toutes hors interface**, contre
# l'API réellement exposée par la passerelle :
#
#   1. la configuration de GoTrue est celle du `.env`, et non un défaut de l'image ;
#   2. l'inscription libre est refusée, et le privilège ne contourne pas ce refus ;
#   3. l'invitation exige la clé de service, crée le compte et son profil, et l'email
#      **part réellement** — il est relu dans Inbucket ;
#   4. le cycle de vie complet est exercé : acceptation par le lien de l'email, définition du mot
#      de passe, connexion, rafraîchissement, déconnexion, réinitialisation, suppression ;
#   5. les refus sont vérifiés un par un, y compris ceux qui doivent rester **muets** sur
#      l'existence d'un compte ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire le fait échouer.
#
# ---------------------------------------------------------------------------------------------
# Comment la non-complaisance est éprouvée, et pourquoi ainsi.
# ---------------------------------------------------------------------------------------------
# Affaiblir la configuration revient à changer une variable d'environnement du service `auth`,
# donc à le redémarrer. Redémarrer le service de la pile en cours l'exposerait, le temps du
# contrôle, dans un état volontairement dégradé — et le laisserait ainsi si le script était
# interrompu.
#
# Le script démarre donc un GoTrue **jetable**, à la même version épinglée, sur le même réseau et
# la même base, portant le réglage affaibli. Il vérifie que ce GoTrue-là accepte ce que la pile
# refuse : la preuve porte alors sur le réglage lui-même, et non sur une simulation. Le conteneur
# jetable est détruit par un `trap`, y compris en cas d'interruption.
#
# Le script ne démarre ni n'arrête la pile : elle doit déjà tourner (`./runDev.sh`). Les comptes
# et les boîtes aux lettres qu'il crée sont supprimés en sortant.
#
# Usage :
#   scripts/verify-auth.sh

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
AUTH_CONTAINER=p2enjoy-auth
GOTRUE_IMAGE=supabase/gotrue:v2.189.0
JETABLE=p2enjoy-auth-jetable

MAIL_INVITEE=crm-011-invitee@exemple.test
MAIL_INCONNU=crm-011-inconnu@exemple.test
MAIL_JETABLE=crm-011-jetable@exemple.test

URL_GABARIT_INVITATION=http://auth-templates:8080/invite.html
URL_GABARIT_CONFIRMATION=http://auth-templates:8080/confirmation.html
URL_GABARIT_RECOVERY=http://auth-templates:8080/recovery.html
URL_GABARIT_EMAIL_CHANGE=http://auth-templates:8080/email-change.html
SUJET_INVITATION='Invitation à P2Enjoy CRM'
SUJET_CONFIRMATION='Confirmez votre adresse — P2Enjoy CRM'
SUJET_RECOVERY='Réinitialisez votre mot de passe — P2Enjoy CRM'
SUJET_EMAIL_CHANGE='Confirmez votre nouvelle adresse — P2Enjoy CRM'

MDP_INITIAL="MotDePasseInitial2026"
MDP_NOUVEAU="MotDePasseRenouvele2026"

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
INBUCKET_WEB_PORT=$(require_env INBUCKET_WEB_PORT)
JWT_EXPIRY=$(require_env JWT_EXPIRY)
JWT_SECRET=$(require_env JWT_SECRET)
POSTGRES_PASSWORD=$(require_env POSTGRES_PASSWORD)
PASSWORD_MIN_LENGTH=$(require_env PASSWORD_MIN_LENGTH)
DISABLE_SIGNUP=$(require_env DISABLE_SIGNUP)
SITE_URL=$(require_env SITE_URL)

API="http://127.0.0.1:${KONG_HTTP_PORT}"
INBUCKET="http://127.0.0.1:${INBUCKET_WEB_PORT}"

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

CORPS=/tmp/p2enjoy-auth-body

# Rend le code HTTP sur la sortie standard ; le corps de la réponse est dans $CORPS.
http() {
	local method=$1 url=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$url" "$@"
}
corps() { cat "$CORPS"; }

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

compte_id() {
	curl -s "$API/auth/v1/admin/users?page=1&per_page=200" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		| jq -r --arg m "$1" '.users[]? | select(.email == $m) | .id' | head -n 1
}

supprimer_compte() {
	local id
	id=$(compte_id "$1")
	if [ -n "$id" ] && [ "$id" != "null" ]; then
		curl -s -o /dev/null -X DELETE "$API/auth/v1/admin/users/$id" \
			-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" || true
	fi
}

vider_boite() { curl -s -o /dev/null -X DELETE "$INBUCKET/api/v1/mailbox/$1" || true; }

# Attend qu'un message arrive réellement dans une boîte. La borne est une **condition d'arrêt**,
# pas une temporisation de confort : dépassée, le contrôle échoue au lieu d'être passé sous
# silence.
attendre_message() {
	local boite=$1 sujet_attendu=${2:-} i n
	for i in $(seq 1 40); do
		n=$(curl -s "$INBUCKET/api/v1/mailbox/$boite" | jq -r --arg s "$sujet_attendu" \
			'[.[] | select($s == "" or (.subject | test($s)))] | length')
		[ "${n:-0}" -gt 0 ] && return 0
		sleep 0.25
	done
	return 1
}

dernier_message() {
	curl -s "$INBUCKET/api/v1/mailbox/$1" | jq -r --arg s "${2:-}" \
		'[.[] | select($s == "" or (.subject | test($s)))] | last | .id'
}

message_json() {
	curl -s "$INBUCKET/api/v1/mailbox/$1/$2"
}

invitation_est_francaise() {
	local message=$1 html
	html=$(printf '%s' "$message" | jq -r '.body.html')
	[ "$(printf '%s' "$message" | jq -r '.subject')" = "$SUJET_INVITATION" ] \
		&& printf '%s' "$html" | grep -Fq 'Vous avez été invité(e) à rejoindre P2Enjoy CRM.' \
		&& printf '%s' "$html" | grep -Fq 'Accepter l’invitation' \
		&& ! printf '%s' "$html" | grep -Fq 'You have been invited'
}

recovery_est_francais() {
	local message=$1 html
	html=$(printf '%s' "$message" | jq -r '.body.html')
	[ "$(printf '%s' "$message" | jq -r '.subject')" = "$SUJET_RECOVERY" ] \
		&& printf '%s' "$html" | grep -Fq 'Une demande de réinitialisation de votre mot de passe P2Enjoy CRM a été reçue.' \
		&& printf '%s' "$html" | grep -Fq 'Choisir un nouveau mot de passe' \
		&& ! printf '%s' "$html" | grep -Fq 'Reset password'
}

menage() {
	docker rm -f "$JETABLE" >/dev/null 2>&1 || true
	supprimer_compte "$MAIL_INVITEE"
	supprimer_compte "$MAIL_JETABLE"
	# MAIL_INCONNU ne doit jamais exister ; il existe pourtant si la configuration a été
	# affaiblie pendant l'exécution. Le ménage ne suppose donc pas que le refus a bien eu lieu.
	supprimer_compte "$MAIL_INCONNU"
	vider_boite "$MAIL_INVITEE"
	vider_boite "$MAIL_INCONNU"
	vider_boite "$MAIL_JETABLE"
	rm -f "$CORPS"
}
trap menage EXIT

echo
echo "Preuves de CRM-009 et CRM-011 — interface, gabarits et mécanisme GoTrue"
echo

for c in "$DB_CONTAINER" "$AUTH_CONTAINER"; do
	if ! docker inspect -f '{{.State.Status}}' "$c" >/dev/null 2>&1; then
		echo "ERREUR : conteneur $c absent. Lancez ./runDev.sh." >&2
		exit 1
	fi
done

menage

# --- 1. La configuration appliquée est bien celle du .env --------------------------------------
# Un réglage écrit dans `.env` mais non câblé dans le service serait invisible : les contrôles
# suivants passeraient en mesurant les défauts de l'image.

echo "1. Configuration effectivement appliquée au service auth"

gotrue_env() {
	docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$AUTH_CONTAINER" \
		| sed -n "s/^$1=//p" | head -n 1
}

verifier_reglage() {
	local variable=$1 attendu=$2 observe
	observe=$(gotrue_env "$variable")
	if [ "$observe" = "$attendu" ]; then
		ok "$variable = $attendu"
	else
		fail "$variable : attendu '$attendu', observé '$observe'"
	fi
}

verifier_reglage GOTRUE_DISABLE_SIGNUP "$DISABLE_SIGNUP"
verifier_reglage GOTRUE_PASSWORD_MIN_LENGTH "$PASSWORD_MIN_LENGTH"
verifier_reglage GOTRUE_MAILER_AUTOCONFIRM "$(env_value ENABLE_EMAIL_AUTOCONFIRM)"
verifier_reglage GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED "$(env_value ENABLE_ANONYMOUS_USERS)"
verifier_reglage GOTRUE_JWT_DEFAULT_GROUP_NAME authenticated
verifier_reglage GOTRUE_JWT_EXP "$JWT_EXPIRY"
verifier_reglage GOTRUE_MAILER_TEMPLATES_INVITE "$URL_GABARIT_INVITATION"
verifier_reglage GOTRUE_MAILER_TEMPLATES_CONFIRMATION "$URL_GABARIT_CONFIRMATION"
verifier_reglage GOTRUE_MAILER_TEMPLATES_RECOVERY "$URL_GABARIT_RECOVERY"
verifier_reglage GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE "$URL_GABARIT_EMAIL_CHANGE"
verifier_reglage GOTRUE_MAILER_SUBJECTS_INVITE "$SUJET_INVITATION"
verifier_reglage GOTRUE_MAILER_SUBJECTS_CONFIRMATION "$SUJET_CONFIRMATION"
verifier_reglage GOTRUE_MAILER_SUBJECTS_RECOVERY "$SUJET_RECOVERY"
verifier_reglage GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE "$SUJET_EMAIL_CHANGE"

if [ "$(docker inspect -f '{{.State.Health.Status}}' p2enjoy-auth-templates 2>/dev/null || true)" = "healthy" ]; then
	ok "service auth-templates sain avant l'émission d'un email"
else
	fail "service auth-templates absent ou non sain"
fi

verifier_gabarit_http() {
	local url=$1 marqueur=$2 contenu
	contenu=$(docker exec -i "$AUTH_CONTAINER" wget -qO- "$url" 2>/dev/null || true)
	if printf '%s' "$contenu" | grep -Fq "$marqueur" \
		&& printf '%s' "$contenu" | grep -Fq '{{ .ConfirmationURL }}' \
		&& printf '%s' "$contenu" | grep -Fq '{{ .Token }}'; then
		ok "$url servi à GoTrue avec son marqueur et ses deux données d'action"
	else
		fail "$url absent, injoignable depuis GoTrue ou incomplet"
	fi
}

verifier_gabarit_http "$URL_GABARIT_INVITATION" 'Vous avez été invité(e) à rejoindre P2Enjoy CRM.'
verifier_gabarit_http "$URL_GABARIT_CONFIRMATION" 'Confirmez votre adresse email pour accéder à P2Enjoy CRM.'
verifier_gabarit_http "$URL_GABARIT_RECOVERY" 'Une demande de réinitialisation de votre mot de passe P2Enjoy CRM a été reçue.'
verifier_gabarit_http "$URL_GABARIT_EMAIL_CHANGE" 'Confirmez le changement de votre adresse email P2Enjoy CRM'

if [ "$DISABLE_SIGNUP" = "true" ]; then
	ok "DISABLE_SIGNUP vaut true dans .env (docs/SPEC-auth.md §2 : jamais false)"
else
	fail "DISABLE_SIGNUP vaut '$DISABLE_SIGNUP' : l'inscription libre serait ouverte"
fi

# --- 2. Inscription libre refusée (preuves n° 1 et 2) ------------------------------------------

echo
echo "2. Inscription libre"

code=$(http POST "$API/auth/v1/signup" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INCONNU\",\"password\":\"$MDP_INITIAL\"}")
if [ "$code" = "422" ] && [ "$(corps | jq -r '.error_code')" = "signup_disabled" ]; then
	ok "n° 1 — POST /signup avec la clé anonyme : 422 signup_disabled"
else
	fail "n° 1 — POST /signup avec la clé anonyme : $code $(corps | head -c 160)"
fi

code=$(http POST "$API/auth/v1/signup" -H "apikey: $SERVICE_ROLE_KEY" \
	-H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INCONNU\",\"password\":\"$MDP_INITIAL\"}")
if [ "$code" = "422" ] && [ "$(corps | jq -r '.error_code')" = "signup_disabled" ]; then
	ok "n° 2 — POST /signup avec la clé de service : refusé à l'identique, le privilège ne contourne pas"
else
	fail "n° 2 — POST /signup avec la clé de service : $code $(corps | head -c 160)"
fi

if [ -z "$(compte_id "$MAIL_INCONNU")" ]; then
	ok "aucun compte n'a été créé par les deux tentatives d'inscription"
else
	fail "un compte existe pour $MAIL_INCONNU malgré le refus"
fi

# --- 3. Invitation (preuves n° 3 à 6) ----------------------------------------------------------

echo
echo "3. Invitation"

code=$(http POST "$API/auth/v1/invite" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INVITEE\"}")
if [ "$code" = "403" ] && [ "$(corps | jq -r '.error_code')" = "not_admin" ]; then
	ok "n° 3 — POST /invite avec la clé anonyme : 403 not_admin"
else
	fail "n° 3 — POST /invite avec la clé anonyme : $code $(corps | head -c 160)"
fi

code=$(http POST "$API/auth/v1/invite" -H "apikey: $SERVICE_ROLE_KEY" \
	-H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INVITEE\",\"data\":{\"full_name\":\"Camille Invitée\"}}")
if [ "$code" = "200" ]; then
	ok "n° 4 — POST /invite avec la clé de service : 200"
else
	fail "n° 4 — POST /invite avec la clé de service : $code $(corps | head -c 160)"
fi

etat=$(psql_db -c "select
	(invited_at is not null)::text || '|' ||
	(encrypted_password is null or encrypted_password = '')::text || '|' ||
	(email_confirmed_at is null)::text
	from auth.users where email = '$MAIL_INVITEE';")
if [ "$etat" = "true|true|true" ]; then
	ok "n° 4 — compte créé : invited_at renseigné, sans mot de passe, adresse non confirmée"
else
	fail "n° 4 — état du compte invité inattendu : '$etat'"
fi

profil=$(psql_db -c "select p.full_name || '|' || p.locale
	from public.profiles p join auth.users u on u.id = p.id where u.email = '$MAIL_INVITEE';")
if [ "$profil" = "Camille Invitée|fr" ]; then
	ok "n° 5 — profil créé par le trigger, nom des métadonnées et langue par défaut"
else
	fail "n° 5 — profil inattendu : '$profil'"
fi

if attendre_message "$MAIL_INVITEE"; then
	ok "n° 6 — email d'invitation réellement présent dans Inbucket"
else
	fail "n° 6 — aucun email d'invitation reçu dans Inbucket"
fi

msg_id=$(dernier_message "$MAIL_INVITEE")
message_invite=$(message_json "$MAIL_INVITEE" "$msg_id")
corps_invite=$(printf '%s' "$message_invite" | jq -r '.body.text')
if invitation_est_francaise "$message_invite"; then
	ok "n° 6 — sujet et corps d'invitation français : le gabarit configuré a été employé"
else
	fail "n° 6 — sujet ou contenu de l'invitation inattendu : repli anglais possible"
fi

if printf '%s' "$corps_invite" | grep -Eq '(^|[^0-9])[0-9]{6}([^0-9]|$)'; then
	ok "n° 6 — l'email porte un code à six chiffres"
else
	fail "n° 6 — aucun code à six chiffres trouvé dans l'email"
fi

if printf '%s' "$message_invite" | jq -e '.header["Content-Type"] | index("text/html; charset=UTF-8") != null' >/dev/null; then
	ok "n° 6 — MIME observé : corps text/html d'origine, conformément à la limite GoTrue 2.189.0"
else
	fail "n° 6 — Content-Type d'origine inattendu"
fi

lien=$(printf '%s' "$corps_invite" \
	| grep -oE 'https?://[^ )]*/auth/v1/verify\?token=[^ )]*type=invite[^ )]*' | head -n 1)
if [ -n "$lien" ]; then
	ok "n° 6 — l'email porte un lien de vérification exploitable"
else
	fail "n° 6 — aucun lien de vérification trouvé dans l'email"
fi

# --- 4. Un compte invité non accepté n'est pas joignable (preuve n° 7) -------------------------

echo
echo "4. Compte invité, invitation non acceptée"

code=$(http POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INVITEE\",\"password\":\"$MDP_INITIAL\"}")
if [ "$code" = "400" ] && [ "$(corps | jq -r '.error_code')" = "invalid_credentials" ]; then
	ok "n° 7 — connexion d'un compte invité non accepté : 400 invalid_credentials"
else
	fail "n° 7 — connexion d'un compte invité non accepté : $code $(corps | head -c 160)"
fi

# --- 5. Acceptation par le lien de l'email (preuve n° 8) ---------------------------------------
# Le lien est suivi tel qu'un destinataire le suivrait : GoTrue redirige vers SITE_URL en portant
# les jetons dans le fragment.

echo
echo "5. Acceptation de l'invitation"

redirection=$(curl -s -o /dev/null -w '%{redirect_url}' "$lien")
jeton=$(printf '%s' "$redirection" | sed -n 's/.*[#&]access_token=\([^&]*\).*/\1/p')

if [ -n "$jeton" ] && printf '%s' "$redirection" | grep -q "^${SITE_URL}"; then
	ok "n° 8 — le lien redirige vers SITE_URL en portant une session"
else
	fail "n° 8 — redirection inattendue : $(printf '%s' "$redirection" | head -c 120)"
fi

confirme=$(psql_db -c "select (email_confirmed_at is not null)::text from auth.users
	where email = '$MAIL_INVITEE';")
if [ "$confirme" = "true" ]; then
	ok "n° 8 — l'adresse est confirmée après acceptation"
else
	fail "n° 8 — l'adresse n'est pas confirmée après acceptation"
fi

# --- 6. Politique de mot de passe (preuve n° 13) -----------------------------------------------
# Prouvée dans les deux sens : un caractère de moins refusé, la longueur exacte acceptée. Vérifier
# seulement le refus laisserait passer une configuration qui refuserait tout.

echo
echo "6. Politique de mot de passe"

court=$(head -c 200 /dev/zero | tr '\0' 'a' | cut -c "1-$((PASSWORD_MIN_LENGTH - 1))")
code=$(http PUT "$API/auth/v1/user" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $jeton" \
	-H 'Content-Type: application/json' -d "{\"password\":\"$court\"}")
if [ "$code" = "422" ] && [ "$(corps | jq -r '.error_code')" = "weak_password" ]; then
	ok "n° 13 — mot de passe de $((PASSWORD_MIN_LENGTH - 1)) caractères : 422 weak_password"
else
	fail "n° 13 — mot de passe trop court accepté ou refusé autrement : $code $(corps | head -c 160)"
fi

code=$(http PUT "$API/auth/v1/user" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $jeton" \
	-H 'Content-Type: application/json' -d "{\"password\":\"$MDP_INITIAL\"}")
if [ "$code" = "200" ]; then
	ok "n° 9 — mot de passe conforme accepté (${#MDP_INITIAL} caractères)"
else
	fail "n° 9 — définition du mot de passe refusée : $code $(corps | head -c 160)"
fi

# --- 7. Connexion et refus (preuves n° 9 à 12) -------------------------------------------------

echo
echo "7. Connexion"

code=$(http POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INVITEE\",\"password\":\"$MDP_INITIAL\"}")
acces=$(corps | jq -r '.access_token // empty')
rafraichissement=$(corps | jq -r '.refresh_token // empty')
if [ "$code" = "200" ] && [ -n "$acces" ] && [ -n "$rafraichissement" ]; then
	ok "n° 9 — connexion : 200, jeton d'accès et jeton de rafraîchissement émis"
else
	fail "n° 9 — connexion : $code $(corps | head -c 160)"
fi

code=$(http POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INVITEE\",\"password\":\"MotDePasseErrone2026\"}")
message_mauvais_mdp=$(corps | jq -r '.msg')
if [ "$code" = "400" ] && [ "$(corps | jq -r '.error_code')" = "invalid_credentials" ]; then
	ok "n° 10 — mot de passe erroné : 400 invalid_credentials"
else
	fail "n° 10 — mot de passe erroné : $code $(corps | head -c 160)"
fi

code=$(http POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INCONNU\",\"password\":\"$MDP_INITIAL\"}")
message_inconnu=$(corps | jq -r '.msg')
if [ "$code" = "400" ] && [ "$message_inconnu" = "$message_mauvais_mdp" ]; then
	ok "n° 11 — adresse inconnue : même code et même message qu'un mot de passe erroné"
else
	fail "n° 11 — adresse inconnue distinguable : $code '$message_inconnu' vs '$message_mauvais_mdp'"
fi

code=$(http POST "$API/auth/v1/token?grant_type=password" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INVITEE\",\"password\":\"$MDP_INITIAL\"}")
if [ "$code" = "401" ]; then
	ok "n° 12 — requête sans clé apikey : 401, refusée par la passerelle"
else
	fail "n° 12 — requête sans clé apikey : $code $(corps | head -c 160)"
fi

# --- 8. Contenu du jeton (preuve n° 14) --------------------------------------------------------

echo
echo "8. Contenu du jeton d'accès"

charge=$(jwt_payload "$acces")
sub=$(printf '%s' "$charge" | jq -r '.sub')
role=$(printf '%s' "$charge" | jq -r '.role')
aud=$(printf '%s' "$charge" | jq -r '.aud')
duree=$(printf '%s' "$charge" | jq -r '.exp - .iat')
id_attendu=$(psql_db -c "select id from auth.users where email = '$MAIL_INVITEE';")

if [ "$sub" = "$id_attendu" ]; then
	ok "n° 14 — sub porte l'identifiant réel de l'utilisateur"
else
	fail "n° 14 — sub = '$sub', attendu '$id_attendu'"
fi

if [ "$role" = "authenticated" ] && [ "$aud" = "authenticated" ]; then
	ok "n° 14 — role et aud valent authenticated"
else
	fail "n° 14 — role='$role', aud='$aud'"
fi

if [ "$duree" = "$JWT_EXPIRY" ]; then
	ok "n° 14 — durée de vie du jeton = JWT_EXPIRY ($JWT_EXPIRY s)"
else
	fail "n° 14 — durée de vie du jeton = $duree s, attendu $JWT_EXPIRY"
fi

# ASSERTION RETOURNÉE, JAMAIS RETIRÉE — mécanisme de la décision 51, onzième occurrence,
# 2026-08-21 (décision 499). Elle figeait une ABSENCE qu'une unité ultérieure a comblée, exactement
# la famille d'INC-191.
#
# Elle exigeait « 200 et zéro ligne », et son commentaire disait pourquoi : « sans politique, la
# lecture rend zéro ligne ». `public.profiles` PORTE désormais une politique — `profiles_lecture_
# equipe`, livrée par `CRM-022` : un appelant lit son PROPRE profil, plus ceux des membres des
# workspaces auxquels il appartient. Le compte jetable de ce harnais n'appartient à aucun
# workspace : il voit donc exactement UNE ligne, la sienne. MESURÉ le 2026-08-21 — le harnais
# rendait « 200 [{"id":"a90c96fe-…"}] », l'identifiant du compte qu'il venait lui-même de créer.
#
# L'assertion cesse donc de mesurer une absence et se met à mesurer ce que la politique GARANTIT,
# ce qui est plus fort : le jeton est accepté, il positionne la bonne identité, et il n'ouvre RIEN
# de plus — une ligne, et c'est `sub`. Une politique relâchée sur `profiles` la rendrait rouge, là
# où l'ancienne rédaction ne pouvait plus rien dire du produit.
code=$(http GET "$API/rest/v1/profiles?select=id" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $acces")
lignes=$(corps | jq -r 'length')
vu=$(corps | jq -r '.[0].id // empty')
if [ "$code" = "200" ] && [ "$lignes" = "1" ] && [ "$vu" = "$sub" ]; then
	ok "n° 14 — le jeton est accepté par PostgREST, et n'ouvre QUE le profil de son porteur (CRM-022)"
else
	fail "n° 14 — lecture PostgREST avec le jeton : $code, $lignes ligne(s), vue='$vu' attendu '$sub'"
fi

# --- 9. Rafraîchissement et déconnexion (preuves n° 15 et 16) ----------------------------------

echo
echo "9. Session"

code=$(http POST "$API/auth/v1/token?grant_type=refresh_token" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"refresh_token\":\"$rafraichissement\"}")
nouveau_rafraichissement=$(corps | jq -r '.refresh_token // empty')
nouvel_acces=$(corps | jq -r '.access_token // empty')
if [ "$code" = "200" ] && [ -n "$nouveau_rafraichissement" ] \
	&& [ "$nouveau_rafraichissement" != "$rafraichissement" ]; then
	ok "n° 15 — rafraîchissement : le jeton de rafraîchissement a bien tourné"
else
	fail "n° 15 — rafraîchissement : $code, rotation non constatée"
fi

code=$(http POST "$API/auth/v1/logout" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $nouvel_acces")
if [ "$code" = "204" ]; then
	ok "n° 16 — déconnexion : 204"
else
	fail "n° 16 — déconnexion : $code $(corps | head -c 160)"
fi

code=$(http POST "$API/auth/v1/token?grant_type=refresh_token" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"refresh_token\":\"$nouveau_rafraichissement\"}")
if [ "$code" = "400" ] && [ "$(corps | jq -r '.error_code')" = "refresh_token_not_found" ]; then
	ok "n° 16 — après déconnexion, le jeton de rafraîchissement est refusé"
else
	fail "n° 16 — le jeton de rafraîchissement survit à la déconnexion : $code $(corps | head -c 160)"
fi

# --- 10. Réinitialisation de mot de passe (preuves n° 17 à 19) ---------------------------------

echo
echo "10. Réinitialisation de mot de passe"

vider_boite "$MAIL_INCONNU"
code=$(http POST "$API/auth/v1/recover" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' -d "{\"email\":\"$MAIL_INCONNU\"}")
sleep 2
restant=$(curl -s "$INBUCKET/api/v1/mailbox/$MAIL_INCONNU" | jq -r 'length')
if [ "$code" = "200" ] && [ "${restant:-0}" -eq 0 ]; then
	ok "n° 17 — recover sur une adresse inconnue : 200 et aucun email émis"
else
	fail "n° 17 — recover sur une adresse inconnue : $code, $restant email(s) dans la boîte"
fi

vider_boite "$MAIL_INVITEE"
code=$(http POST "$API/auth/v1/recover" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' -d "{\"email\":\"$MAIL_INVITEE\"}")
if [ "$code" = "200" ] && attendre_message "$MAIL_INVITEE"; then
	ok "n° 18 — recover sur un compte existant : email réellement présent dans Inbucket"
else
	fail "n° 18 — recover sur un compte existant : $code, aucun email reçu"
fi

msg_id=$(dernier_message "$MAIL_INVITEE")
message_recovery=$(message_json "$MAIL_INVITEE" "$msg_id")
corps_recovery=$(printf '%s' "$message_recovery" | jq -r '.body.text')
if recovery_est_francais "$message_recovery"; then
	ok "n° 18 — sujet et corps de réinitialisation français : le gabarit configuré a été employé"
else
	fail "n° 18 — sujet ou contenu de réinitialisation inattendu : repli anglais possible"
fi

if printf '%s' "$corps_recovery" | grep -Eq '(^|[^0-9])[0-9]{6}([^0-9]|$)'; then
	ok "n° 18 — l'email de réinitialisation porte un code à six chiffres"
else
	fail "n° 18 — aucun code à six chiffres trouvé dans l'email de réinitialisation"
fi

lien_recovery=$(printf '%s' "$corps_recovery" \
	| grep -oE 'https?://[^ )]*/auth/v1/verify\?token=[^ )]*type=recovery[^ )]*' | head -n 1)
if [ -n "$lien_recovery" ]; then
	ok "n° 18 — l'email de réinitialisation porte un lien de type recovery"
else
	fail "n° 18 — aucun lien de réinitialisation trouvé dans l'email"
fi

redirection=$(curl -s -o /dev/null -w '%{redirect_url}' "$lien_recovery")
jeton_recovery=$(printf '%s' "$redirection" | sed -n 's/.*[#&]access_token=\([^&]*\).*/\1/p')
if [ -n "$jeton_recovery" ]; then
	ok "n° 19 — le lien de réinitialisation ouvre une session"
else
	fail "n° 19 — le lien de réinitialisation n'ouvre aucune session"
fi

code=$(http PUT "$API/auth/v1/user" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $jeton_recovery" -H 'Content-Type: application/json' \
	-d "{\"password\":\"$MDP_NOUVEAU\"}")
if [ "$code" = "200" ]; then
	ok "n° 19 — nouveau mot de passe défini"
else
	fail "n° 19 — définition du nouveau mot de passe : $code $(corps | head -c 160)"
fi

code=$(http POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INVITEE\",\"password\":\"$MDP_NOUVEAU\"}")
if [ "$code" = "200" ]; then
	ok "n° 19 — connexion avec le nouveau mot de passe : 200"
else
	fail "n° 19 — connexion avec le nouveau mot de passe : $code $(corps | head -c 160)"
fi

code=$(http POST "$API/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$MAIL_INVITEE\",\"password\":\"$MDP_INITIAL\"}")
if [ "$code" = "400" ]; then
	ok "n° 19 — l'ancien mot de passe est refusé"
else
	fail "n° 19 — l'ancien mot de passe fonctionne encore : $code"
fi

# --- 11. Suppression du compte (preuve n° 20) --------------------------------------------------

echo
echo "11. Suppression du compte"

supprimer_compte "$MAIL_INVITEE"
reste=$(psql_db -c "select count(*) from auth.users where email = '$MAIL_INVITEE';")
profils=$(psql_db -c "select count(*) from public.profiles p
	where not exists (select 1 from auth.users u where u.id = p.id);")
if [ "$reste" = "0" ] && [ "$profils" = "0" ]; then
	ok "n° 20 — compte supprimé, aucun profil orphelin (cascade)"
else
	fail "n° 20 — comptes restants=$reste, profils orphelins=$profils"
fi

# --- 12. Non-complaisance ----------------------------------------------------------------------
# Un GoTrue jetable, même version et même base, porte le réglage affaibli. Le contrôle est réussi
# lorsque ce GoTrue-là **accepte** ce que la pile refuse : la preuve porte alors sur le réglage.

echo
echo "12. Non-complaisance"

demarrer_jetable() {
	docker rm -f "$JETABLE" >/dev/null 2>&1 || true
	docker run -d --rm --name "$JETABLE" --network p2enjoy-crm_default \
		-e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
		-e API_EXTERNAL_URL="$(env_value API_EXTERNAL_URL)" \
		-e GOTRUE_DB_DRIVER=postgres \
		-e "GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:${POSTGRES_PASSWORD}@$(env_value POSTGRES_HOST):$(env_value POSTGRES_PORT)/$(env_value POSTGRES_DB)" \
		-e GOTRUE_SITE_URL="$SITE_URL" \
		-e GOTRUE_JWT_AUD=authenticated -e GOTRUE_JWT_SECRET="$JWT_SECRET" \
		-e GOTRUE_JWT_ADMIN_ROLES=service_role \
		-e GOTRUE_SMTP_HOST="$(env_value SMTP_HOST)" -e GOTRUE_SMTP_PORT="$(env_value SMTP_PORT)" \
		-e GOTRUE_SMTP_ADMIN_EMAIL="$(env_value SMTP_ADMIN_EMAIL)" \
		-e GOTRUE_MAILER_AUTOCONFIRM=false \
		"$@" "$GOTRUE_IMAGE" >/dev/null

	local i
	for i in $(seq 1 40); do
		if docker run --rm --network p2enjoy-crm_default curlimages/curl:latest \
			-s -o /dev/null "http://$JETABLE:9999/health" 2>/dev/null; then
			return 0
		fi
		sleep 0.5
	done
	return 1
}

appel_jetable() {
	docker run --rm --network p2enjoy-crm_default curlimages/curl:latest \
		-s -o /dev/null -w '%{http_code}' "$@" 2>/dev/null
}

if demarrer_jetable -e GOTRUE_DISABLE_SIGNUP=false; then
	code=$(appel_jetable -X POST "http://$JETABLE:9999/signup" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$MAIL_JETABLE\",\"password\":\"$MDP_INITIAL\"}")
	if [ "$code" = "200" ]; then
		ok "DISABLE_SIGNUP=false : l'inscription libre passe — le contrôle n° 1 serait mis en échec"
	else
		fail "DISABLE_SIGNUP=false : inscription toujours refusée ($code), le contrôle n° 1 ne prouve rien"
	fi
	supprimer_compte "$MAIL_JETABLE"
else
	fail "GoTrue jetable (DISABLE_SIGNUP=false) n'a pas démarré : non-complaisance non éprouvée"
fi

if demarrer_jetable -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_PASSWORD_MIN_LENGTH=6; then
	code=$(appel_jetable -X POST "http://$JETABLE:9999/signup" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$MAIL_JETABLE\",\"password\":\"abc123\"}")
	if [ "$code" = "200" ]; then
		ok "PASSWORD_MIN_LENGTH=6 : un mot de passe de 6 caractères passe — le contrôle n° 13 serait mis en échec"
	else
		fail "PASSWORD_MIN_LENGTH=6 : mot de passe court refusé ($code), le contrôle n° 13 ne prouve rien"
	fi
	supprimer_compte "$MAIL_JETABLE"
else
	fail "GoTrue jetable (PASSWORD_MIN_LENGTH=6) n'a pas démarré : non-complaisance non éprouvée"
fi

vider_boite "$MAIL_JETABLE"
if demarrer_jetable -e GOTRUE_DISABLE_SIGNUP=true -e GOTRUE_JWT_ADMIN_ROLES=anon \
	-e GOTRUE_MAILER_TEMPLATES_INVITE=http://auth-templates-absent:8080/invite.html \
	-e "GOTRUE_MAILER_SUBJECTS_INVITE=$SUJET_INVITATION"; then
	code=$(appel_jetable -X POST "http://$JETABLE:9999/invite" \
		-H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
		-d "{\"email\":\"$MAIL_JETABLE\"}")
	if [ "$code" = "200" ]; then
		ok "rôle anon admis comme administrateur : l'invitation s'ouvre — le contrôle n° 3 serait mis en échec"
	else
		fail "rôle anon admis comme administrateur : invitation toujours refusée ($code)"
	fi
	if attendre_message "$MAIL_JETABLE"; then
		msg_jetable=$(dernier_message "$MAIL_JETABLE")
		message_jetable=$(message_json "$MAIL_JETABLE" "$msg_jetable")
		if [ "$(printf '%s' "$message_jetable" | jq -r '.subject')" = 'You have been invited' ] \
			&& printf '%s' "$message_jetable" | jq -r '.body.html' | grep -Fq 'You have been invited' \
			&& ! invitation_est_francaise "$message_jetable"; then
			ok "gabarit HTTP absent : GoTrue replie réellement sujet et corps en anglais, et le contrôle le refuse"
		else
			sujet_observe=$(printf '%s' "$message_jetable" | jq -r '.subject')
			anglais_observe=$(printf '%s' "$message_jetable" | jq -r '.body.html' | grep -Fc 'You have been invited' || true)
			francais_observe=$(printf '%s' "$message_jetable" | jq -r '.body.html' | grep -Fc 'Vous avez été invité(e)' || true)
			fail "gabarit HTTP absent : sujet='$sujet_observe', marqueurs anglais=$anglais_observe, français=$francais_observe"
		fi
	else
		fail "gabarit HTTP absent : aucun email de repli reçu, non-complaisance non éprouvée"
	fi
	supprimer_compte "$MAIL_JETABLE"
else
	fail "GoTrue jetable (JWT_ADMIN_ROLES=anon) n'a pas démarré : non-complaisance non éprouvée"
fi

docker rm -f "$JETABLE" >/dev/null 2>&1 || true

# --- Bilan -------------------------------------------------------------------------------------

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
	exit 0
fi

printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
exit 1
