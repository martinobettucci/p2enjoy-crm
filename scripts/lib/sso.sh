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

# --- Jeton interne, par la vraie connexion et l'échangeur (CRM-092 T4) --------------------------
#
# @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §5.2 (ouvrir), §5.3 (fermer), §11 (seed),
#       §13 — le jeton d'un script est le jeton INTERNE, comme celui de la webapp
#
# `sso_jeton_interne API CLE_ANONYME ADRESSE [MOT_DE_PASSE]` mène la connexion jusqu'au code, le remet
# à l'échangeur de session par la vraie passerelle, et écrit le jeton interne sur la sortie standard.
# La session serveur est aussitôt FERMÉE : le script n'emploie que le jeton interne, qui reste
# valable jusqu'à son échéance — 300 s au plus —, et la table des sessions ne garde rien d'un
# script. Un script qui dure plus longtemps redemande un jeton : il ne le prolonge pas.
sso_jeton_interne() {
	local api=$1 cle=$2 adresse=$3 mot_de_passe=${4:-}
	local obtenu code verificateur retour entetes corps jeton poignee
	obtenu=$(sso_code_pkce "$adresse" "$mot_de_passe") || return 1
	read -r code verificateur retour <<<"$obtenu"
	entetes=$(mktemp)
	corps=$(curl -s --max-time 15 -D "$entetes" -X POST "$api/functions/v1/session/ouvrir" \
		-H "apikey: $cle" -H 'content-type: application/json' \
		-d "$(jq -nc --arg c "$code" --arg v "$verificateur" --arg r "$retour" \
		     '{code: $c, verificateur: $v, redirect_uri: $r}')")
	poignee=$(sed -n 's/^[Ss]et-[Cc]ookie: p2enjoy_crm_session=\([^;]*\).*/\1/p' "$entetes" | tr -d '\r')
	rm -f "$entetes"
	if [ -n "$poignee" ]; then
		curl -s -o /dev/null --max-time 10 -X POST "$api/functions/v1/session/fermer" \
			-H "apikey: $cle" -H "Cookie: p2enjoy_crm_session=$poignee" || true
	fi
	jeton=$(jq -r '.jeton // empty' <<<"$corps" 2>/dev/null)
	[ -n "$jeton" ] || { echo "sso : ouverture refusée pour $adresse : $corps" >&2; return 1; }
	printf '%s\n' "$jeton"
}

# `sso_env_charger FICHIER` complète, depuis un fichier d'environnement, les variables que cette
# bibliothèque lit et que l'appelant n'a pas posées. Le fichier n'est jamais exécuté.
sso_env_charger() {
	local fichier=$1 nom valeur
	for nom in SSO_OIDC_ISSUER SSO_OIDC_CLIENT_ID SSO_OIDC_CLIENT_SECRET SITE_URL SSO_DEV_ADMIN_PASSWORD; do
		[ -n "${!nom:-}" ] && continue
		valeur=$(grep -m 1 "^$nom=" "$fichier" 2>/dev/null | cut -d= -f2-)
		valeur=${valeur%\"}; valeur=${valeur#\"}; valeur=${valeur%\'}; valeur=${valeur#\'}
		printf -v "$nom" '%s' "$valeur"
		export "${nom?}"
	done
}

# --- Comptes du Keycloak de DÉVELOPPEMENT, par son API d'administration --------------------------
#
# @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §10 (« l'API d'administration du Keycloak de
#       développement sert au seul harnais »), §13 (comptes jetables)
#
# Le produit ne l'appelle jamais (docs/SSO.md). Chaque geste a son inverse, que l'appelant rend.
_sso_admin_base() { printf '%s' "${SSO_OIDC_ISSUER%/realms/lelabs}"; }

sso_admin_jeton() {
	curl -sf --max-time 10 "$(_sso_admin_base)/realms/master/protocol/openid-connect/token" \
		--data-urlencode client_id=admin-cli --data-urlencode username=admin \
		--data-urlencode "password=${SSO_DEV_ADMIN_PASSWORD:?SSO_DEV_ADMIN_PASSWORD absente}" \
		--data-urlencode grant_type=password | jq -r '.access_token // empty'
}

# `sso_admin MÉTHODE CHEMIN [options curl…]` — sur `/admin/realms/lelabs`.
sso_admin() {
	local methode=$1 chemin=$2 jeton
	shift 2
	jeton=$(sso_admin_jeton) || return 1
	curl -s --max-time 15 -X "$methode" "$(_sso_admin_base)/admin/realms/lelabs$chemin" \
		-H "Authorization: Bearer $jeton" -H 'content-type: application/json' "$@"
}

# `sso_compte_id ADRESSE` écrit le `sub` du compte, ou rien.
sso_compte_id() {
	sso_admin GET "/users?exact=true&email=$(jq -rn --arg a "$1" '$a|@uri')" | jq -r '.[0].id // empty'
}

# `sso_compte_jetable_creer ADRESSE PRÉNOM NOM [oui|non]` crée un compte au mot de passe du realm,
# adresse vérifiée, rôles par défaut, et `verified` sauf si le quatrième argument vaut `non`. Écrit
# son `sub`.
sso_compte_jetable_creer() {
	local adresse=$1 prenom=$2 nom=$3 verifie=${4:-oui} entetes sub role roles='[]'
	entetes=$(mktemp)
	sso_admin POST /users -D "$entetes" -o /dev/null \
		-d "$(jq -nc --arg a "$adresse" --arg p "$prenom" --arg n "$nom" \
		              --arg m "${SSO_MOT_DE_PASSE:-$SSO_MOT_DE_PASSE_DEFAUT}" \
		     '{username: $a, email: $a, emailVerified: true, enabled: true, firstName: $p,
		       lastName: $n, credentials: [{type: "password", value: $m, temporary: false}]}')"
	sub=$(sed -n 's/^[Ll]ocation: .*\/users\/\([^[:space:]]*\).*/\1/p' "$entetes" | tr -d '\r')
	rm -f "$entetes"
	[ -n "$sub" ] || { echo "sso : création du compte jetable $adresse refusée" >&2; return 1; }
	for role in default-roles-lelabs verified; do
		[ "$role" = verified ] && [ "$verifie" != oui ] && continue
		roles=$(jq -c --argjson r "$(sso_admin GET "/roles/$role")" '. + [$r]' <<<"$roles")
	done
	sso_admin POST "/users/$sub/role-mappings/realm" -o /dev/null -d "$roles"
	printf '%s\n' "$sub"
}

# `sso_compte_supprimer SUB` — sans effet si le compte n'existe plus.
sso_compte_supprimer() {
	[ -n "${1:-}" ] || return 0
	sso_admin DELETE "/users/$1" -o /dev/null
}
