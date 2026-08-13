#!/usr/bin/env bash
# @spec CRM-002 (docs/BACKLOG.md) — script de lancement de l'assemblage de production
# @spec docs/JOURNAL.md décision 16 (gardes de profil et de migrations)
# @spec docs/JOURNAL.md décision 99 (contrôle des ports avant démarrage : 80 et 443)
# @spec docs/PROD_MIGRATIONS.md §2.1 (prérequis d'infrastructure), §4 (services à redéployer)
# @spec docs/DAT.md §3.8 (contraintes d'exécution de l'hôte), §9 (déploiement), §13 (commandes)
# @spec README.md §5 (commandes principales), §11 (limites connues)
#
# Démarre l'assemblage de production : Caddy termine TLS, aucun outillage de développement, ni
# Kong ni PostgreSQL publiés.
#
# Ce script n'amorce **jamais** de fichier d'environnement et n'invente **aucun** secret : les
# valeurs de production sont produites par un humain (docs/PROD_MIGRATIONS.md §2.3). Il refuse de
# démarrer si le fichier décrit un environnement de développement, ou s'il autorise l'application
# automatique des migrations.
#
# Usage :
#   ./runProd.sh          démarre l'assemblage de production
#   ./runProd.sh --stop   arrêt propre, volumes conservés
#   ./runProd.sh --help

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/scripts/lib/env.sh"

MODE=start

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--stop)    MODE=stop ;;
		--help|-h) usage; exit 0 ;;
		*)         die "option inconnue « $1 ». Voir ./runProd.sh --help." ;;
	esac
	shift
done

# --- Gardes ------------------------------------------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
	die "fichier d'environnement $ENV_FILE absent.
        La production ne s'amorce pas toute seule : produisez ses valeurs à la main
        (docs/PROD_MIGRATIONS.md §2.3), à partir de .env.example."
fi

env_validate
env_require_profile prod

APPLY_MIGRATIONS=$(env_get "$ENV_FILE" APPLY_MIGRATIONS)
if [ "$APPLY_MIGRATIONS" != "false" ]; then
	die "APPLY_MIGRATIONS vaut « ${APPLY_MIGRATIONS:-<vide>} », or la production exige « false ».
        Aucune migration n'est appliquée automatiquement en production : le contrat de
        déploiement docs/PROD_MIGRATIONS.md fait foi."
fi

require_docker

# --- Arrêt -------------------------------------------------------------------------------------

if [ "$MODE" = stop ]; then
	say "Arrêt de l'assemblage de production"
	compose_prod down
	info "Volumes conservés : les données et les certificats sont préservés."
	exit 0
fi

# --- Démarrage ---------------------------------------------------------------------------------

if [ ! -d "$REPO_ROOT/webapp/dist" ]; then
	warn "webapp/dist absent : Caddy ne servira que l'API et répondra 404 sur /."
	warn "Produire le build avec « npm run build » (unité CRM-007)."
	mkdir -p "$REPO_ROOT/webapp/dist"
fi

APP_DOMAIN=$(env_get "$ENV_FILE" APP_DOMAIN)

require_free_ports compose_prod

say "Démarrage de l'assemblage de production — domaine $APP_DOMAIN"
compose_prod up -d --wait

echo
say "Services publiés"
info "https://${APP_DOMAIN}          webapp et API, TLS terminé par Caddy"
info "http://${APP_DOMAIN}           redirigé vers https"
info "Aucun autre port n'est publié : ni Kong, ni PostgreSQL."

echo
say "Après démarrage"
info "Appliquer les migrations en attente à la main : docs/PROD_MIGRATIONS.md §3."
info "Dérouler les vérifications de déploiement : docs/PROD_MIGRATIONS.md §5."
