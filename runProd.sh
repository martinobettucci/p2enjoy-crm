#!/usr/bin/env bash
# @spec CRM-002 (docs/BACKLOG.md) — script de lancement de l'assemblage de production
# @spec CRM-087 (docs/BACKLOG.md) — fenêtre de migration ouverte par --migrate
# @spec docs/JOURNAL.md décision 16 (gardes de profil et de migrations)
# @spec docs/JOURNAL.md décision 99 (contrôle des ports avant démarrage : 80 et 443)
# @spec docs/JOURNAL.md décision 489 (--migrate, confirmation d'instantané, recréation forcée)
# @spec docs/PROD_MIGRATIONS.md §2.1 (prérequis d'infrastructure), §3.1 (fenêtre de maintenance),
#       §4 (services à redéployer), §6 (retour arrière par instantané)
# @spec docs/DAT.md §3.2 (base de données), §3.8 (contraintes d'exécution de l'hôte),
#       §9 (déploiement), §13 (commandes)
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
#   ./runProd.sh                        démarre l'assemblage de production
#   ./runProd.sh --stop                 arrêt propre, volumes conservés
#   ./runProd.sh --migrate              ouvre la fenêtre de migration (§3.1) — surcharge
#                                       APPLY_MIGRATIONS pour cette seule invocation, force la
#                                       recréation du migrations-runner. Refuse de migrer sans
#                                       confirmation que l'instantané de VM est pris : « oui »
#                                       demandé au terminal, ou --instantane-verifie hors terminal.
#   ./runProd.sh --migrate --instantane-verifie
#                                       même chose, confirmation d'instantané fournie par le drapeau.
#   ./runProd.sh --help

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/scripts/lib/env.sh"

MODE=start
INSTANTANE_VERIFIE=0

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--stop)                MODE=stop ;;
		--migrate)             MODE=migrate ;;
		--instantane-verifie)  INSTANTANE_VERIFIE=1 ;;
		--help|-h)             usage; exit 0 ;;
		*)                     die "option inconnue « $1 ». Voir ./runProd.sh --help." ;;
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
        Aucune migration n'est appliquée automatiquement en production : la fenêtre de migration
        s'ouvre par ./runProd.sh --migrate, décision 489 / CRM-087. Le fichier d'environnement
        n'est jamais réécrit par ce script."
fi

require_docker

# --- Arrêt -------------------------------------------------------------------------------------

if [ "$MODE" = stop ]; then
	say "Arrêt de l'assemblage de production"
	compose_prod down
	info "Volumes conservés : les données et les certificats sont préservés."
	exit 0
fi

# --- Fenêtre de migration ---------------------------------------------------------------------
#
# @spec CRM-087 (docs/BACKLOG.md), docs/JOURNAL.md décision 489
#
# `--migrate` ouvre la fenêtre de maintenance décrite au §3.1 de docs/PROD_MIGRATIONS.md :
# la surcharge de APPLY_MIGRATIONS ne vit que dans l'environnement passé à Compose pour CETTE
# invocation, et le fichier .env conserve `false`. La recréation forcée du conteneur est
# obligatoire : `migrations-runner` a la politique `restart: "no"` et se termine en 0 après un
# passage réussi ; sans `--force-recreate`, Compose le juge « à jour » et ne le relance pas.

if [ "$MODE" = migrate ]; then
	say "Fenêtre de migration de production"
	info "Le fichier $ENV_FILE ne sera PAS modifié."
	info "APPLY_MIGRATIONS=true est surchargé pour cette seule invocation."

	# Confirmation d'instantané — condition sine qua non. L'instantané de VM est le seul filet
	# de la fenêtre (décision 489). Un drapeau accepté sans preuve serait un filet imaginaire ;
	# hors terminal, seul --instantane-verifie autorise le geste, et l'exploitant en porte la
	# responsabilité écrite ; au terminal, la saisie « oui » est demandée explicitement.
	if [ "$INSTANTANE_VERIFIE" != 1 ]; then
		if [ -t 0 ]; then
			warn "L'instantané de VM est le SEUL filet de la fenêtre — décision 489."
			warn "Restaurer l'instantané détruit tout ce qui a été écrit depuis sa prise."
			printf 'Un instantané complet de la VM a-t-il été pris ? Tapez « oui » pour confirmer : '
			read -r reponse || reponse=""
			if [ "$reponse" != "oui" ]; then
				die "confirmation d'instantané refusée : migration non appliquée.
        Reprendre l'instantané, puis relancer ./runProd.sh --migrate."
			fi
		else
			die "confirmation d'instantané exigée hors terminal interactif.
        Passer --instantane-verifie APRÈS avoir pris l'instantané de VM.
        La restauration de l'instantané est le seul retour arrière (docs/PROD_MIGRATIONS.md §6)."
		fi
	fi

	# Recréation forcée : `migrations-runner` est un conteneur à usage unique. Compose ne le
	# relancerait pas sans cette option, et sa configuration est inchangée entre deux passages.
	APPLY_MIGRATIONS=true compose_prod up -d --no-deps --force-recreate migrations-runner

	# Attendre la fin du conteneur — la sortie propage son code. `docker wait` renvoie l'entier
	# rendu par le processus init du conteneur ; le runner s'arrête à la première erreur, laisse
	# donc un code non nul et n'annonce aucun succès (le message final n'est pas écrit).
	if code=$(docker wait p2enjoy-migrations); then
		if [ "$code" = 0 ]; then
			say "Migrations appliquées avec succès — cache de schéma rechargé par le runner."
			info "Dérouler les vérifications de docs/PROD_MIGRATIONS.md §5 avant de rouvrir l'accès."
			info "En cas de reprise : docs/PROD_MIGRATIONS.md §6 (instantané de VM)."
			exit 0
		else
			warn "Le migrations-runner s'est arrêté avec le code $code."
			warn "Les journaux du conteneur :"
			compose_prod logs --no-color migrations-runner | tail -n 40 >&2 || true
			die "migration de production ÉCHOUÉE.
        La transaction fautive a été annulée par ON_ERROR_STOP=1 ; les migrations précédentes
        de ce passage sont, elles, appliquées. Consulter les journaux ci-dessus, puis :
          — soit corriger et relancer ./runProd.sh --migrate ;
          — soit restaurer l'instantané de VM (docs/PROD_MIGRATIONS.md §6)."
		fi
	else
		die "impossible d'attendre la sortie du conteneur p2enjoy-migrations.
        Vérifier son état avec « docker ps -a | grep p2enjoy-migrations »."
	fi
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
info "Ouvrir la fenêtre de migration : ./runProd.sh --migrate (docs/PROD_MIGRATIONS.md §3.1)."
info "Dérouler les vérifications de déploiement : docs/PROD_MIGRATIONS.md §5."
