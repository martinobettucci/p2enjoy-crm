#!/usr/bin/env bash
# @spec CRM-090 (docs/BACKLOG.md) — propositions de variables, de secrets et de route à la cellule
# @spec docs/SPEC-deploiement-spark.md §4.3 (répartition), §4.4 (proposer, sans jamais appliquer)
# @spec docs/JOURNAL.md décisions 567 et 576 (mode de la route : `tls`, jamais `clair`)
# @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §12 — client CONFIDENTIEL : son secret est
#       une demande laissée vide, que seul l'administrateur du realm saisit (décision 586)
# @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §2, §12 (point 2) — tranche T6 : plus de
#       SMTP ni de GoTrue ; `--demandes-seules` repose les demandes à une cellule en service
#       (docs/JOURNAL.md décisions 589 et 590)
#
# S'exécute DANS la cellule, sous le compte `spark-docker`, depuis le dépôt livré (/srv/crm).
#
# Dans la cellule, une variable, un secret ou une route n'entrent que par la console du plan de
# contrôle. Ce script ne pose donc RIEN : il écrit des PROPOSITIONS sous le bloc posé par le plan de
# contrôle dans les fichiers `.?` voisins, que le propriétaire du Spark relit ligne par ligne.
#
# Les secrets sont tirés ICI, par openssl, et ne sortent de la cellule que par la console. Ils ne
# traversent ni le dépôt, ni le poste qui livre, ni la sortie de ce script, qui n'affiche que des
# noms. Une valeur que la cellule ne peut pas connaître — le secret du client confidentiel chez
# LeLabs — est laissée VIDE : c'est une DEMANDE, selon la grammaire des fichiers `.?`.
# Le secret du client n'est jamais tiré ici : LeLabs l'émet, l'affiche une seule fois à
# l'administrateur du realm, et c'est lui qui le saisit (`CRM-092`, décision 586).
#
# Usage :
#   scripts/spark/proposer.sh [--domaine crm.lelabs.tech] [--port 8080] [--client-sso lelabs-crm-serveur]
#   scripts/spark/proposer.sh --route-seule [--domaine crm.lelabs.tech] [--port 8080]
#   scripts/spark/proposer.sh --demandes-seules [--client-sso lelabs-crm-serveur]
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
# `--demandes-seules` (décision 590) repose les demandes à une cellule EN SERVICE, sans tirer aucun
# secret : l'émetteur et l'identifiant du client serveur si la cellule ne les a pas à la valeur
# attendue, et le secret du client en demande vide s'il manque ou est vide — un secret posé n'est
# jamais redemandé. Des fichiers réels, il ne lit que la PRÉSENCE d'un nom, jamais une valeur secrète.
# Il nomme les variables retirées de la pile par `CRM-092` que la cellule porte encore : un import
# ne retire jamais rien, elles restent inertes, et le propriétaire les retire à la console s'il veut.
#
# Plus aucune option SMTP depuis `CRM-092` T6 : les courriels transactionnels étaient ceux de GoTrue,
# retiré de la pile (décision 589).
#
# Refus :
#   - /run/spark/secrets porte déjà JWT_SECRET, hors `--route-seule` et `--demandes-seules` :
#     proposer d'autres secrets à une pile qui tourne invaliderait ses jetons et sa base. Une
#     rotation est une autre opération ;
#   - un fichier `.?` porte déjà une proposition non tranchée : l'écraser ne serait pas proposer.

set -euo pipefail

# shellcheck source=../lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/env.sh"

DOMAINE=crm.lelabs.tech
PORT=8080
CLIENT_SSO=lelabs-crm-serveur
EMETTEUR_SSO=https://oauth.lelabs.tech/realms/lelabs
ROUTE_SEULE=0
DEMANDES_SEULES=0

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--domaine)    DOMAINE=${2:?--domaine exige une valeur}; shift ;;
		--port)       PORT=${2:?--port exige une valeur}; shift ;;
		--client-sso) CLIENT_SSO=${2:?--client-sso exige une valeur}; shift ;;
		--route-seule) ROUTE_SEULE=1 ;;
		--demandes-seules) DEMANDES_SEULES=1 ;;
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
[ "$ROUTE_SEULE" = 0 ] || [ "$DEMANDES_SEULES" = 0 ] || die "--route-seule et --demandes-seules s'excluent."

PROPOSITION_ENV="${SPARK_ENV_PROPOSAL:-${SPARK_ENV_FILE}.?}"
PROPOSITION_SECRETS="${SPARK_SECRETS_PROPOSAL:-${SPARK_SECRETS_FILE}.?}"
PROPOSITION_ROUTES="${SPARK_ROUTES_PROPOSAL:-/etc/spark/routes.?}"
MARQUE="# --- fin du bloc posé par sparkd, écrivez ci-dessous ---"

# --- Gardes --------------------------------------------------------------------------------------

if [ "$ROUTE_SEULE" = 0 ] && [ "$DEMANDES_SEULES" = 0 ] && [ -f "$SPARK_SECRETS_FILE" ] \
	&& grep -q '^JWT_SECRET=' "$SPARK_SECRETS_FILE"; then
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
[ "$DEMANDES_SEULES" = 0 ] || FICHIERS=("$PROPOSITION_ENV" "$PROPOSITION_SECRETS")
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

# Une étiquette `#` juste au-dessus d'une déclaration s'affiche à côté d'elle dans la console :
# une ligne, 120 caractères au plus (docs/PROD-SERVER.md §5).
ligne() { printf '# %s\n%s=%s\n' "$2" "$1" "$3"; }

# --- Les demandes seules, pour une cellule en service (décision 590) ---------------------------
#
# Rien n'est tiré. La valeur d'une variable PUBLIQUE est comparée à l'attendue ; pour le secret, seule
# sa PRÉSENCE non vide est constatée — `grep -q` sur le nom suivi d'au moins un caractère —, et la
# valeur n'est jamais lue dans une variable du shell, ni affichée.

if [ "$DEMANDES_SEULES" = 1 ]; then
	proposees=""
	valeur_publique() { [ -f "$SPARK_ENV_FILE" ] && sed -n "s/^$1=//p" "$SPARK_ENV_FILE" | tail -n 1; }
	{
		for paire in "SSO_OIDC_ISSUER|$EMETTEUR_SSO|Émetteur OIDC du SSO lelabs (docs/SSO.md)." \
			"SSO_OIDC_CLIENT_ID|$CLIENT_SSO|Client OIDC serveur RÉELLEMENT créé par le realm (CRM-092)."; do
			nom=${paire%%|*}; reste=${paire#*|}; attendu=${reste%%|*}; etiquette=${reste#*|}
			if [ "$(valeur_publique "$nom")" != "$attendu" ]; then
				printf '\n'; ligne "$nom" "$etiquette" "$attendu"
				proposees="$proposees $nom"
			fi
		done
	} >> "$PROPOSITION_ENV"
	if ! { [ -f "$SPARK_SECRETS_FILE" ] && grep -q '^SSO_OIDC_CLIENT_SECRET=.' "$SPARK_SECRETS_FILE"; }; then
		{
			printf '\n'
			ligne SSO_OIDC_CLIENT_SECRET "Secret du client confidentiel chez LeLabs : l'administrateur du realm le saisit." ""
		} >> "$PROPOSITION_SECRETS"
		proposees="$proposees SSO_OIDC_CLIENT_SECRET"
	fi

	inertes=""
	for nom in ADDITIONAL_REDIRECT_URLS DISABLE_SIGNUP SMTP_HOST SMTP_PORT SMTP_ADMIN_EMAIL SMTP_SENDER_NAME \
		SMTP_USER SMTP_PASS; do
		for fichier in "$SPARK_ENV_FILE" "$SPARK_SECRETS_FILE"; do
			if [ -f "$fichier" ] && grep -q "^$nom=" "$fichier"; then inertes="$inertes $nom"; break; fi
		done
	done

	if [ -z "$proposees" ]; then
		say "Rien à demander — la cellule porte déjà le client serveur et son secret"
	else
		say "Demandes déposées — rien n'est appliqué"
		info "Proposées :$proposees"
		info "Variables : $PROPOSITION_ENV · Secrets : $PROPOSITION_SECRETS"
		info "Le propriétaire du Spark les relit et les importe depuis la console ; le secret, l'administrateur du realm le saisit."
	fi
	[ -z "$inertes" ] || info "Retirées de la pile par CRM-092, encore présentes et inertes :$inertes — à retirer à la console si souhaité."
	exit 0
fi

# --- Secrets tirés dans la cellule ---------------------------------------------------------------
# Longueurs de `env_bootstrap_dev`, imposées par les composants : 64, 16 et 32 caractères pour
# SECRET_KEY_BASE, REALTIME_DB_ENC_KEY et MAIL_SYNC_INTERNAL_TOKEN.

jwt_secret=$(gen_hex 32)
URL="https://$DOMAINE"

{
	printf '\n'
	ligne P2ENJOY_ENV_PROFILE "Profil de la pile : production. Garde de ./runProd.sh (CRM-090)." prod
	ligne APPLY_MIGRATIONS "Doit rester false : les migrations passent par ./runProd.sh --spark --migrate." false
	ligne APP_DOMAIN "Domaine public du CRM, porté par la route de la Forge." "$DOMAINE"
	ligne API_EXTERNAL_URL "URL publique de l'API, telle que le navigateur la joint." "$URL"
	ligne SUPABASE_PUBLIC_URL "URL publique du stockage, identique à celle de l'API." "$URL"
	ligne SITE_URL "Origine de la webapp ; la connexion LeLabs y revient par /auth/retour." "$URL"
	ligne SPARK_HTTP_PORT "Port de la cellule servi en clair par Caddy ; égal au port de la route." "$PORT"
	ligne ANON_KEY "Clé anonyme Supabase, publique par construction, dérivée du JWT_SECRET proposé." "$(jwt_hs256 "$jwt_secret" anon)"
	ligne SSO_OIDC_ISSUER "Émetteur OIDC du SSO lelabs (docs/SSO.md)." "$EMETTEUR_SSO"
	ligne SSO_OIDC_CLIENT_ID "Client OIDC RÉELLEMENT créé par le realm ; corriger si la déclaration a été renommée." "$CLIENT_SSO"
} >> "$PROPOSITION_ENV"

{
	printf '\n'
	ligne POSTGRES_PASSWORD "Mot de passe PostgreSQL de la pile, tiré dans la cellule." "$(gen_hex 24)"
	ligne JWT_SECRET "Signature des jetons de PostgREST, Realtime et de l'échangeur de session, tirée ici." "$jwt_secret"
	ligne SERVICE_ROLE_KEY "Clé de service Supabase, dérivée de JWT_SECRET. Ne quitte jamais la pile." "$(jwt_hs256 "$jwt_secret" service_role)"
	ligne SECRET_KEY_BASE "Secret de session de Realtime, 64 caractères." "$(gen_hex 32)"
	ligne REALTIME_DB_ENC_KEY "Chiffrement interne de Realtime, 16 caractères." "$(gen_hex 8)"
	ligne MAIL_SYNC_INTERNAL_TOKEN "Jeton de l'API interne de mail-sync, distinct de toute clé Supabase." "$(gen_hex 32)"
	ligne MINIO_ROOT_USER "Identifiant du stockage objet interne (MinIO), sans port publié." "crm$(gen_hex 8)"
	ligne MINIO_ROOT_PASSWORD "Mot de passe du stockage objet interne (MinIO)." "$(gen_hex 20)"
	ligne S3_PROTOCOL_ACCESS_KEY_ID "Accès au protocole S3 exposé par Supabase Storage." "$(gen_hex 16)"
	ligne S3_PROTOCOL_ACCESS_KEY_SECRET "Secret du protocole S3 exposé par Supabase Storage." "$(gen_hex 32)"
	ligne SSO_OIDC_CLIENT_SECRET "Secret du client confidentiel chez LeLabs : l'administrateur du realm le saisit." ""
} >> "$PROPOSITION_SECRETS"

proposer_route

say "Propositions déposées — rien n'est appliqué"
info "Variables : $PROPOSITION_ENV"
info "Secrets   : $PROPOSITION_SECRETS (tirés ici ; aucune valeur n'est affichée)"
info "Route     : $PROPOSITION_ROUTES — $DOMAINE $PORT tls"
info "Demande laissée vide : SSO_OIDC_CLIENT_SECRET."
warn "$PROPOSITION_SECRETS vit dans un tmpfs : un redémarrage de la cellule l'efface sans qu'il ait été lu."
info "Le propriétaire du Spark les relit et les importe depuis la console. Suite :"
info "docs/SPEC-deploiement-spark.md §5 et docs/PROD_MIGRATIONS.md."
