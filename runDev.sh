#!/usr/bin/env bash
# @spec CRM-002 (docs/BACKLOG.md) — script de lancement de l'environnement de développement
# @spec CRM-015 (docs/BACKLOG.md) — CA facultative validée avant le build de la webapp
# @spec docs/JOURNAL.md décision 16 (amorçage automatique des secrets, gardes de profil)
# @spec docs/JOURNAL.md décision 99 (contrôle des ports avant démarrage), décision 101 (points de
#       montage créés par l'hôte), décision 272 (origine webapp joignable depuis les emails)
# @spec docs/DAT.md §3.8 (contraintes d'exécution de l'hôte), §13 (commandes de lancement)
# @spec CRM-050 (docs/BACKLOG.md) — démarrage de la messagerie de développement,
#       docs/SPEC-mail-subsystem.md §11.8 (ports annoncés)
# @spec CRM-051 (docs/BACKLOG.md) — amorçage du jeton interne et journaux du service `mail-sync`,
#       docs/SPEC-mail-subsystem.md §12.1 (aucun port publié), §12.2 (configuration)
# @spec README.md §5 (commandes), §6 (développement), §11 (limites connues)
#
# Démarre la pile de développement, en amorçant `.env` au premier lancement.
#
# Usage :
#   ./runDev.sh                      amorce `.env` si absent, puis démarre la pile
#   ./runDev.sh --dev                idem, sans la webapp conteneurisée (Vite tourne dans l'IDE)
#   ./runDev.sh --withLog <composant>  démarre puis suit les journaux d'un composant
#   ./runDev.sh --bootstrap          amorce `.env` puis s'arrête, sans rien démarrer
#   ./runDev.sh --stop               arrêt propre, volumes conservés
#   ./runDev.sh --help
#
# Composants acceptés par `--withLog` : supabase, webapp, mail-sync, stalwart.
#
# Au démarrage, le script rappelle les **identifiants de développement** : comptes seedés, boîtes
# mail, et administration de chaque service. Ce sont des secrets locaux et jetables — le profil
# `dev` est exigé, les domaines sont sous des TLD réservés, et les ports restent sur la boucle
# locale. Le mot de passe des comptes est lu dans `supabase/seed/apply-seed.sh`, jamais recopié.

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/scripts/lib/env.sh"

MODE=start
WITH_WEBAPP=true
LOG_COMPONENT=""

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--dev)       WITH_WEBAPP=false ;;
		--withLog)   [ $# -ge 2 ] || die "--withLog attend un nom de composant."
		             LOG_COMPONENT=$2; shift ;;
		--bootstrap) MODE=bootstrap ;;
		--stop)      MODE=stop ;;
		--help|-h)   usage; exit 0 ;;
		*)           die "option inconnue « $1 ». Voir ./runDev.sh --help." ;;
	esac
	shift
done

# --- Amorçage ----------------------------------------------------------------------------------

git_hooks_ensure

if env_bootstrap_dev; then
	:
elif env_ensure_dev_completions; then
	info "$(basename "$ENV_FILE") existant : complété des variables introduites depuis son amorçage."
else
	info "$(basename "$ENV_FILE") existant : conservé tel quel."
fi

env_validate
env_require_profile dev
env_require_dev_npm_ca_file
env_require_dev_inbound_domain
env_require_dev_webapp_origin

if [ "$MODE" = bootstrap ]; then
	say "Environnement prêt. Rien n'a été démarré (--bootstrap)."
	exit 0
fi

require_docker

# --- Arrêt -------------------------------------------------------------------------------------

if [ "$MODE" = stop ]; then
	say "Arrêt de la pile de développement"
	compose_dev down
	info "Volumes conservés. Pour tout détruire et repartir à neuf : ./resetMe.sh"
	exit 0
fi

# --- Démarrage ---------------------------------------------------------------------------------

ensure_host_mountpoints

# `--dev` écarte la webapp conteneurisée : son port est donc laissé au Vite de l'IDE, et le
# contrôle de disponibilité ne doit pas le réclamer.
if [ "$WITH_WEBAPP" = true ]; then
	require_free_ports compose_dev
else
	require_free_ports compose_dev "$(env_get "$ENV_FILE" WEBAPP_DEV_PORT)"
fi

say "Démarrage de la pile de développement"
# `--dev` écarte la webapp conteneurisée : Vite tourne alors dans l'IDE, sur le même port.
# Les deux ne peuvent pas coexister, le port serait déjà pris.
if [ "$WITH_WEBAPP" = true ]; then
	compose_dev up -d --wait
else
	compose_dev up -d --wait --scale webapp=0
fi

KONG_HTTP_PORT=$(env_get "$ENV_FILE" KONG_HTTP_PORT)
STUDIO_PORT=$(env_get "$ENV_FILE" STUDIO_PORT)
INBUCKET_WEB_PORT=$(env_get "$ENV_FILE" INBUCKET_WEB_PORT)
MINIO_CONSOLE_PORT=$(env_get "$ENV_FILE" MINIO_CONSOLE_PORT)
POSTGRES_DIRECT_PORT=$(env_get "$ENV_FILE" POSTGRES_DIRECT_PORT)
WEBAPP_DEV_PORT=$(env_get "$ENV_FILE" WEBAPP_DEV_PORT)
# Messagerie de développement (CRM-050).
ROUNDCUBE_PORT=$(env_get "$ENV_FILE" ROUNDCUBE_PORT)
STALWART_IMAP_PORT=$(env_get "$ENV_FILE" STALWART_IMAP_PORT)
STALWART_SMTP_PORT=$(env_get "$ENV_FILE" STALWART_SMTP_PORT)
STALWART_SUBMISSION_PORT=$(env_get "$ENV_FILE" STALWART_SUBMISSION_PORT)
STALWART_ADMIN_PORT=$(env_get "$ENV_FILE" STALWART_ADMIN_PORT)
CLAMAV_PORT=$(env_get "$ENV_FILE" CLAMAV_PORT)
BIND=$(env_get "$ENV_FILE" DEV_BIND_ADDRESS)

echo
say "Services disponibles"
info "API Supabase (Kong)   http://${BIND}:${KONG_HTTP_PORT}"
if [ "$WITH_WEBAPP" = true ]; then
	info "Webapp (Vite)         http://${BIND}:${WEBAPP_DEV_PORT}"
else
	info "Webapp                écartée par --dev : lancez « npm run dev » sur l'hôte."
fi
info "Supabase Studio       http://${BIND}:${STUDIO_PORT}"
info "Inbucket              http://${BIND}:${INBUCKET_WEB_PORT}"
info "Console MinIO         http://${BIND}:${MINIO_CONSOLE_PORT}"
info "PostgreSQL direct     ${BIND}:${POSTGRES_DIRECT_PORT}"
info "Roundcube             http://${BIND}:${ROUNDCUBE_PORT}"
info "Stalwart IMAP         ${BIND}:${STALWART_IMAP_PORT}"
info "Stalwart SMTP         ${BIND}:${STALWART_SMTP_PORT} (remise) · ${BIND}:${STALWART_SUBMISSION_PORT} (soumission)"
info "Stalwart gestion      http://${BIND}:${STALWART_ADMIN_PORT}"
info "ClamAV (clamd)        ${BIND}:${CLAMAV_PORT}"
# `mail-sync` ne publie aucun port : son API n'est joignable que depuis le réseau Compose
# (docs/SPEC-mail-subsystem.md §12.1). Ses journaux restent la surface d'observation.
info "mail-sync             interne, sans port publié · ./runDev.sh --withLog mail-sync"

# Rappel des identifiants de développement : comptes seedés, boîtes et administration des
# services. Le rendu vit dans la bibliothèque d'environnement afin d'être prouvable sans
# démarrer la pile (scripts/verify-scripts.sh).
env_print_dev_credentials

echo
info "Preuves de la pile : scripts/verify-stack.sh"
info "Preuves des scripts : scripts/verify-scripts.sh"

# --- Journaux ----------------------------------------------------------------------------------

if [ -n "$LOG_COMPONENT" ]; then
	echo
	case "$LOG_COMPONENT" in
		supabase)
			say "Journaux de la pile Supabase (Ctrl-C pour rendre la main)"
			compose_dev logs -f
			;;
		webapp)
			say "Journaux de la webapp (Ctrl-C pour rendre la main)"
			compose_dev logs -f webapp
			;;
		mail-sync)
			say "Journaux de mail-sync (Ctrl-C pour rendre la main)"
			compose_dev logs -f mail-sync
			;;
		stalwart)
			say "Journaux de Stalwart (Ctrl-C pour rendre la main)"
			compose_dev logs -f stalwart
			;;
		*)
			die "composant « $LOG_COMPONENT » inconnu. Attendus : supabase, webapp, mail-sync, stalwart."
			;;
	esac
fi
