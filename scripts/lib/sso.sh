#!/usr/bin/env bash
# @spec CRM-092 (docs/BACKLOG.md) — connexion SSO réelle pour les harnais et le seed, sans navigateur
# @spec docs/SPEC-session-sso.md §4 (parcours), §10 (Keycloak de développement), §13 (preuves)
# @spec docs/JOURNAL.md décisions 578 (K2 : cookies `Secure` que curl ne garde pas), 580 (K15),
#       586 (le client du CRM est confidentiel : son secret accompagne l'échange du code)
# @spec CLAUDE.md §8 (données créées par les vrais mécanismes), §10 (preuves hors interface)
#
# Bibliothèque partagée. Elle n'exécute rien à l'inclusion : elle ne définit que des fonctions.
#
# `sso_connexion_pkce ADRESSE [MOT_DE_PASSE] [CLIENT]` mène le code d'autorisation EXACTEMENT comme
# la webapp le mène dans un navigateur — découverte, défi PKCE `S256`, page de connexion du realm,
# formulaire, retour à l'URL déclarée, échange du code — et écrit sur la sortie standard la réponse
# JSON du point de jeton de Keycloak. Aucun jeton n'est fabriqué : c'est le realm qui émet.
#
# Le Keycloak de développement pose ses cookies `Secure; SameSite=None` même en `http` : un
# navigateur les garde sur `*.localhost`, curl non (K2). Ils sont donc lus dans les en-têtes et
# reportés à la main ; c'est la seule différence avec un navigateur.
#
# Variables lues, avec leur défaut : `SSO_OIDC_ISSUER`, `SSO_OIDC_CLIENT_ID`, `SITE_URL` (l'URL de
# retour est `SITE_URL/auth/retour`, déclarée au realm), `SSO_MOT_DE_PASSE` (`SeedDev2026Local`, le
# mot de passe publié du realm de développement, docs/SPEC-session-sso.md §10), et
# `SSO_OIDC_CLIENT_SECRET`, le secret de DÉVELOPPEMENT du client confidentiel, tiré par `./runDev.sh` :
# il accompagne l'échange quand le client est celui du CRM, et lui seul (décision 586).
#
# `sso_code_pkce ADRESSE [MOT_DE_PASSE] [CLIENT]` s'arrête au code : elle écrit « code vérificateur
# url_de_retour » sur la sortie standard, ce que la webapp remet à l'échangeur de session.
#
# Ne sert qu'au Keycloak de DÉVELOPPEMENT : le realm réel refuse les comptes de ce dépôt, et aucun
# script ne se connecte en production à la place d'une personne.

SSO_MOT_DE_PASSE_DEFAUT=SeedDev2026Local

_sso_b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }

# Rend 0 et « code vérificateur url_de_retour » sur la sortie standard, ou 1 et un diagnostic sur stderr.
sso_code_pkce() {
	local adresse=$1
	local mot_de_passe=${2:-${SSO_MOT_DE_PASSE:-$SSO_MOT_DE_PASSE_DEFAUT}}
	local client=${3:-${SSO_OIDC_CLIENT_ID:?SSO_OIDC_CLIENT_ID absente}}
	local emetteur=${SSO_OIDC_ISSUER:?SSO_OIDC_ISSUER absente}
	local retour="${SITE_URL:?SITE_URL absente}/auth/retour"
	local decouverte autorisation verificateur defi entetes page cookies action location code

	decouverte=$(curl -sf --max-time 10 "$emetteur/.well-known/openid-configuration") \
		|| { echo "sso : découverte injoignable ($emetteur)" >&2; return 1; }
	[ "$(jq -r .issuer <<<"$decouverte")" = "$emetteur" ] \
		|| { echo "sso : la découverte annonce un autre émetteur" >&2; return 1; }
	autorisation=$(jq -r .authorization_endpoint <<<"$decouverte")

	verificateur=$(head -c 32 /dev/urandom | _sso_b64url)
	defi=$(printf '%s' "$verificateur" | openssl dgst -sha256 -binary | _sso_b64url)

	entetes=$(mktemp)
	page=$(curl -s --max-time 10 -D "$entetes" -G "$autorisation" \
		--data-urlencode "client_id=$client" \
		--data-urlencode response_type=code \
		--data-urlencode "scope=openid email profile" \
		--data-urlencode "redirect_uri=$retour" \
		--data-urlencode "state=$(head -c 16 /dev/urandom | _sso_b64url)" \
		--data-urlencode "code_challenge=$defi" \
		--data-urlencode code_challenge_method=S256)
	cookies=$(sed -n 's/^[Ss]et-[Cc]ookie: \([^;]*\).*/\1/p' "$entetes" | paste -sd ';' - | sed 's/;/; /g')
	rm -f "$entetes"
	action=$(grep -o 'action="[^"]*"' <<<"$page" | head -n 1 | sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
	[ -n "$action" ] || { echo "sso : formulaire de connexion introuvable pour $adresse" >&2; return 1; }

	location=$(curl -s --max-time 10 -o /dev/null -w '%{redirect_url}' -H "Cookie: $cookies" \
		--data-urlencode "username=$adresse" --data-urlencode "password=$mot_de_passe" "$action")
	case $location in
		"$retour?"*) ;;
		*) echo "sso : pas de retour vers l'application pour $adresse (identifiants refusés ?)" >&2; return 1 ;;
	esac
	code=$(sed -n 's/.*[?&]code=\([^&]*\).*/\1/p' <<<"$location")
	[ -n "$code" ] || { echo "sso : retour sans code pour $adresse" >&2; return 1; }
	printf '%s %s %s\n' "$code" "$verificateur" "$retour"
}

# Rend 0 et le JSON du point de jeton sur la sortie standard, ou 1 et un diagnostic sur stderr. Réservée
# aux preuves qui lisent un jeton LeLabs brut : le produit, lui, ne remet que le code à l'échangeur.
sso_connexion_pkce() {
	local adresse=$1 client=${3:-${SSO_OIDC_CLIENT_ID:?SSO_OIDC_CLIENT_ID absente}}
	local emetteur=${SSO_OIDC_ISSUER:?SSO_OIDC_ISSUER absente}
	local obtenu code verificateur retour secret=()
	obtenu=$(sso_code_pkce "$@") || return 1
	read -r code verificateur retour <<<"$obtenu"
	if [ "$client" = "${SSO_OIDC_CLIENT_ID:-}" ]; then
		secret=(--data-urlencode "client_secret=${SSO_OIDC_CLIENT_SECRET:?SSO_OIDC_CLIENT_SECRET absente}")
	fi
	curl -sf --max-time 10 "$emetteur/protocol/openid-connect/token" \
		--data-urlencode grant_type=authorization_code \
		--data-urlencode "client_id=$client" \
		"${secret[@]}" \
		--data-urlencode "code=$code" \
		--data-urlencode "redirect_uri=$retour" \
		--data-urlencode "code_verifier=$verificateur" \
		|| { echo "sso : échange du code refusé pour $adresse" >&2; return 1; }
}

# Revendications d'un JWT (charge utile décodée, sans vérification : pour LIRE ce qu'un jeton porte).
sso_revendications() {
	local charge
	charge=$(cut -d. -f2 <<<"$1" | tr '_-' '/+')
	case $(( ${#charge} % 4 )) in
		2) charge="$charge==" ;;
		3) charge="$charge=" ;;
	esac
	base64 -d <<<"$charge" 2>/dev/null
}
