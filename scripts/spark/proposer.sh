#!/usr/bin/env bash
# @spec CRM-090 (docs/BACKLOG.md) — propositions de variables, de secrets et de route à la cellule
# @spec docs/SPEC-deploiement-spark.md §4.3 (répartition), §4.4 (proposer, sans jamais appliquer)
# @spec docs/JOURNAL.md décisions 567 et 576 (mode de la route : `tls`, jamais `clair`)
#
# S'exécute DANS la cellule, sous le compte `spark-docker`, depuis le dépôt livré (/srv/crm).
#
# Dans la cellule, une variable, un secret ou une route n'entrent que par la console du plan de
# contrôle. Ce script ne pose donc RIEN : il écrit des PROPOSITIONS sous le bloc posé par le plan de
# contrôle dans les fichiers `.?` voisins, que le propriétaire du Spark relit ligne par ligne.
#
# Les secrets sont tirés ICI, par openssl, et ne sortent de la cellule que par la console. Ils ne
# traversent ni le dépôt, ni le poste qui livre, ni la sortie de ce script, qui n'affiche que des
# noms. Une valeur que la cellule ne peut pas connaître — identifiants SMTP — est laissée VIDE :
# c'est une DEMANDE, selon la grammaire des fichiers `.?`.
#
# Usage :
#   scripts/spark/proposer.sh [--domaine crm.lelabs.tech] [--port 8080] [--client-sso lelabs-crm]
#                             [--smtp-hote <hôte>] [--smtp-port <port>] [--smtp-expediteur <adresse>]
#   scripts/spark/proposer.sh --route-seule [--domaine crm.lelabs.tech] [--port 8080]
#   scripts/spark/proposer.sh --help
#
# La route se propose en `tls` : c'est ce que la FORGE expose au public, et non ce que la pile sert.
# Mesuré (décision 576) : une route `clair` est publiée en `http://` seul, la poignée de main TLS y
# est refusée, et le SSO n'accepte aucune URL de retour hors `https://`. Dans les deux modes, la
# Forge fait suivre en clair vers Caddy.
#
# `--route-seule` ne propose QUE la route, sans toucher aux fichiers de variables ni de secrets :
# c'est la seule proposition qui reste possible quand des secrets sont déjà en service.
#
# Les trois options SMTP proposent un relais que le poste connaît ; absentes, les valeurs restent des
# DEMANDES vides. Les identifiants du relais (SMTP_USER, SMTP_PASS) restent toujours des demandes :
# aucun script ne peut les connaître. Sans eux, la pile démarre, et seuls les courriels
# transactionnels échouent — la connexion par le SSO n'en dépend pas.
#
# Refus :
#   - /run/spark/secrets porte déjà JWT_SECRET : proposer d'autres secrets à une pile qui tourne
#     invaliderait ses jetons et sa base. Une rotation est une autre opération ;
#   - un fichier `.?` porte déjà une proposition non tranchée : l'écraser ne serait pas proposer.

set -euo pipefail

# shellcheck source=../lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/env.sh"

DOMAINE=crm.lelabs.tech
PORT=8080
CLIENT_SSO=lelabs-crm
SMTP_HOTE=""
SMTP_PORT=""
SMTP_EXPEDITEUR=""
ROUTE_SEULE=0

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--domaine)    DOMAINE=${2:?--domaine exige une valeur}; shift ;;
		--port)       PORT=${2:?--port exige une valeur}; shift ;;
		--client-sso) CLIENT_SSO=${2:?--client-sso exige une valeur}; shift ;;
		--smtp-hote)  SMTP_HOTE=${2:?--smtp-hote exige une valeur}; shift ;;
		--smtp-port)  SMTP_PORT=${2:?--smtp-port exige une valeur}; shift ;;
		--smtp-expediteur) SMTP_EXPEDITEUR=${2:?--smtp-expediteur exige une valeur}; shift ;;
		--route-seule) ROUTE_SEULE=1 ;;
		--help|-h)    usage; exit 0 ;;
		*)            die "option inconnue « $1 ». Voir scripts/spark/proposer.sh --help." ;;
	esac
	shift
done

case "$DOMAINE" in
	*[!a-z0-9.-]* | "" | .* | *. ) die "domaine « $DOMAINE » hors forme : lettres minuscules, chiffres, points et tirets." ;;
esac
case "$PORT" in
	*[!0-9]* | "") die "port « $PORT » : un entier est attendu." ;;
esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "port $PORT : la cellule ne publie aucun port sous 1024."
case "$CLIENT_SSO" in
	*[!A-Za-z0-9_.-]* | "") die "identifiant de client « $CLIENT_SSO » hors forme." ;;
esac
case "$SMTP_HOTE" in *[!a-z0-9.-]*) die "hôte SMTP « $SMTP_HOTE » hors forme." ;; esac
case "$SMTP_PORT" in
	"") ;;
	*[!0-9]*) die "port SMTP « $SMTP_PORT » : un entier est attendu." ;;
	25|465|587) die "port SMTP $SMTP_PORT : la Forge le ferme en sortie ; proposer un port de repli." ;;
esac
case "$SMTP_EXPEDITEUR" in "" | *@*.*) ;; *) die "expéditeur « $SMTP_EXPEDITEUR » hors forme." ;; esac

PROPOSITION_ENV="${SPARK_ENV_PROPOSAL:-${SPARK_ENV_FILE}.?}"
PROPOSITION_SECRETS="${SPARK_SECRETS_PROPOSAL:-${SPARK_SECRETS_FILE}.?}"
PROPOSITION_ROUTES="${SPARK_ROUTES_PROPOSAL:-/etc/spark/routes.?}"
MARQUE="# --- fin du bloc posé par sparkd, écrivez ci-dessous ---"

# --- Gardes --------------------------------------------------------------------------------------

if [ "$ROUTE_SEULE" = 0 ] && [ -f "$SPARK_SECRETS_FILE" ] && grep -q '^JWT_SECRET=' "$SPARK_SECRETS_FILE"; then
	die "$SPARK_SECRETS_FILE porte déjà JWT_SECRET : des secrets sont en service.
        Proposer d'autres secrets invaliderait les jetons émis et le mot de passe de la base.
        Une rotation est une opération distincte, qui n'est pas celle-ci."
fi

# Le bloc que le plan de contrôle pose en tête de chaque fichier `.?` n'est fait que de lignes `#` :
# toute ligne non vide et non commentée, où qu'elle soit, est donc une proposition non tranchée.
proposition_pendante() {
	awk '/^[[:space:]]*$/ || /^#/ { next } { trouve = 1 } END { exit trouve ? 0 : 1 }' "$1"
}

FICHIERS=("$PROPOSITION_ENV" "$PROPOSITION_SECRETS" "$PROPOSITION_ROUTES")
[ "$ROUTE_SEULE" = 0 ] || FICHIERS=("$PROPOSITION_ROUTES")
for fichier in "${FICHIERS[@]}"; do
	[ -e "$fichier" ] || die "$fichier absent : ce script s'exécute dans la cellule, où le plan de contrôle le pose."
	[ -w "$fichier" ] || die "$fichier non inscriptible par le compte $(id -un)."
	if proposition_pendante "$fichier"; then
		die "$fichier porte déjà une proposition que personne n'a tranchée.
        L'écraser ne serait pas proposer. Attendre la décision du propriétaire (le fichier
        redevient vide), ou retirer la proposition à la main en connaissance de cause."
	fi
done

# --- La route ------------------------------------------------------------------------------------

proposer_route() {
	{
		printf '\n# Route publique du CRM : la Forge termine TLS et fait suivre vers Caddy, en clair (CRM-090).\n'
		printf '%s %s tls\n' "$DOMAINE" "$PORT"
	} >> "$PROPOSITION_ROUTES"
}

if [ "$ROUTE_SEULE" = 1 ]; then
	proposer_route
	say "Route proposée — rien n'est appliqué"
	info "Route : $PROPOSITION_ROUTES — $DOMAINE $PORT tls"
	info "Le propriétaire du Spark la relit et l'accepte depuis la console ; elle REMPLACE l'entrée du même domaine."
	exit 0
fi

# --- Secrets tirés dans la cellule ---------------------------------------------------------------
# Longueurs de `env_bootstrap_dev`, imposées par les composants : 64, 16 et 32 caractères pour
# SECRET_KEY_BASE, REALTIME_DB_ENC_KEY et MAIL_SYNC_INTERNAL_TOKEN.

jwt_secret=$(gen_hex 32)
URL="https://$DOMAINE"

# Une étiquette `#` juste au-dessus d'une déclaration s'affiche à côté d'elle dans la console :
# une ligne, 120 caractères au plus (docs/PROD-SERVER.md §5).
ligne() { printf '# %s\n%s=%s\n' "$2" "$1" "$3"; }

{
	printf '\n'
	ligne P2ENJOY_ENV_PROFILE "Profil de la pile : production. Garde de ./runProd.sh (CRM-090)." prod
	ligne APPLY_MIGRATIONS "Doit rester false : les migrations passent par ./runProd.sh --spark --migrate." false
	ligne APP_DOMAIN "Domaine public du CRM, porté par la route de la Forge." "$DOMAINE"
	ligne API_EXTERNAL_URL "URL publique de l'API, telle que le navigateur la joint." "$URL"
	ligne SUPABASE_PUBLIC_URL "URL publique du stockage, identique à celle de l'API." "$URL"
	ligne SITE_URL "Origine de la webapp, base des liens envoyés par courriel." "$URL"
	ligne ADDITIONAL_REDIRECT_URLS "Redirections autorisées par GoTrue : l'origine de la webapp." "$URL"
	ligne SPARK_HTTP_PORT "Port de la cellule servi en clair par Caddy ; égal au port de la route." "$PORT"
	ligne ANON_KEY "Clé anonyme Supabase, publique par construction, dérivée du JWT_SECRET proposé." "$(jwt_hs256 "$jwt_secret" anon)"
	ligne SSO_OIDC_ISSUER "Émetteur OIDC du SSO lelabs (docs/SSO.md)." "https://oauth.lelabs.tech/realms/lelabs"
	ligne SSO_OIDC_CLIENT_ID "Client OIDC RÉELLEMENT créé par le realm ; corriger si la déclaration a été renommée." "$CLIENT_SSO"
	ligne SMTP_HOST "Relais d'envoi. La Forge ferme 25, 465 et 587 en sortie : port de repli exigé." "$SMTP_HOTE"
	ligne SMTP_PORT "Port de repli du relais, en STARTTLS (2587 chez Scaleway TEM)." "$SMTP_PORT"
	ligne SMTP_ADMIN_EMAIL "Expéditeur des courriels du CRM, sur un domaine vérifié chez le relais." "$SMTP_EXPEDITEUR"
} >> "$PROPOSITION_ENV"

{
	printf '\n'
	ligne POSTGRES_PASSWORD "Mot de passe PostgreSQL de la pile, tiré dans la cellule." "$(gen_hex 24)"
	ligne JWT_SECRET "Signature des jetons de GoTrue, PostgREST et Realtime, tirée dans la cellule." "$jwt_secret"
	ligne SERVICE_ROLE_KEY "Clé de service Supabase, dérivée de JWT_SECRET. Ne quitte jamais la pile." "$(jwt_hs256 "$jwt_secret" service_role)"
	ligne SECRET_KEY_BASE "Secret de session de Realtime, 64 caractères." "$(gen_hex 32)"
	ligne REALTIME_DB_ENC_KEY "Chiffrement interne de Realtime, 16 caractères." "$(gen_hex 8)"
	ligne MAIL_SYNC_INTERNAL_TOKEN "Jeton de l'API interne de mail-sync, distinct de toute clé Supabase." "$(gen_hex 32)"
	ligne MINIO_ROOT_USER "Identifiant du stockage objet interne (MinIO), sans port publié." "crm$(gen_hex 8)"
	ligne MINIO_ROOT_PASSWORD "Mot de passe du stockage objet interne (MinIO)." "$(gen_hex 20)"
	ligne S3_PROTOCOL_ACCESS_KEY_ID "Accès au protocole S3 exposé par Supabase Storage." "$(gen_hex 16)"
	ligne S3_PROTOCOL_ACCESS_KEY_SECRET "Secret du protocole S3 exposé par Supabase Storage." "$(gen_hex 32)"
	ligne SMTP_USER "Identifiant du relais d'envoi. Inconnu de la cellule : à saisir." ""
	ligne SMTP_PASS "Mot de passe ou clé du relais d'envoi. Inconnu de la cellule : à saisir." ""
} >> "$PROPOSITION_SECRETS"

proposer_route

say "Propositions déposées — rien n'est appliqué"
info "Variables : $PROPOSITION_ENV"
info "Secrets   : $PROPOSITION_SECRETS (tirés ici ; aucune valeur n'est affichée)"
info "Route     : $PROPOSITION_ROUTES — $DOMAINE $PORT tls"
demandes="SMTP_USER, SMTP_PASS"
[ -n "$SMTP_HOTE" ] || demandes="SMTP_HOST, $demandes"
[ -n "$SMTP_PORT" ] || demandes="SMTP_PORT, $demandes"
[ -n "$SMTP_EXPEDITEUR" ] || demandes="SMTP_ADMIN_EMAIL, $demandes"
info "Demandes laissées vides : $demandes."
warn "$PROPOSITION_SECRETS vit dans un tmpfs : un redémarrage de la cellule l'efface sans qu'il ait été lu."
info "Le propriétaire du Spark les relit et les importe depuis la console. Suite :"
info "docs/SPEC-deploiement-spark.md §5 et docs/PROD_MIGRATIONS.md."
