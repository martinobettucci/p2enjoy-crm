#!/usr/bin/env bash
# @spec CRM-002 (docs/BACKLOG.md) — script de lancement de l'assemblage de production
# @spec CRM-087 (docs/BACKLOG.md) — fenêtre de migration ouverte par --migrate
# @spec CRM-090 (docs/BACKLOG.md) — cellule Spark : --spark et --premier-deploiement
# @spec CRM-092 (docs/BACKLOG.md), docs/SPEC-session-sso.md §2 — tranche T6 : GoTrue retiré du premier
#       déploiement
# @spec docs/SPEC-deploiement-spark.md §3.1 (assemblage), §4.1 (variables injectées), §5.2
# @spec docs/JOURNAL.md décision 567 (la cellule et son premier déploiement)
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
#   ./runProd.sh --spark [...]          cellule Spark : l'environnement est fusionné depuis
#                                       /etc/spark/env et /run/spark/secrets, posés par le plan de
#                                       contrôle, et la pile emploie docker-compose.spark.yml. Se
#                                       combine avec chacune des options ci-dessus.
#   ./runProd.sh [--spark] --migrate --premier-deploiement
#                                       premier déploiement : démarre les seuls services dont le
#                                       runner dépend, migre SANS confirmation d'instantané si et
#                                       seulement si la base est MESURÉE vierge — aucune table dans
#                                       le schéma public —, puis démarre la pile entière. Refuse
#                                       une base peuplée.
#   ./runProd.sh --help

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/scripts/lib/env.sh"

MODE=start
INSTANTANE_VERIFIE=0
SPARK=0
PREMIER_DEPLOIEMENT=0

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--stop)                MODE=stop ;;
		--migrate)             MODE=migrate ;;
		--instantane-verifie)  INSTANTANE_VERIFIE=1 ;;
		--spark)               SPARK=1 ;;
		--premier-deploiement) PREMIER_DEPLOIEMENT=1 ;;
		--help|-h)             usage; exit 0 ;;
		*)                     die "option inconnue « $1 ». Voir ./runProd.sh --help." ;;
	esac
	shift
done

# --- Gardes ------------------------------------------------------------------------------------

if [ "$PREMIER_DEPLOIEMENT" = 1 ] && [ "$MODE" != migrate ]; then
	die "--premier-deploiement n'a de sens qu'avec --migrate : il remplace la confirmation
        d'instantané par la MESURE d'une base vierge, et rien d'autre (docs/SPEC-deploiement-spark.md §5.2)."
fi

# Cellule Spark : aucun `.env` sur l'hôte. L'environnement est reconstruit depuis les fichiers que
# le plan de contrôle pose, puis soumis aux mêmes gardes que tout fichier de production
# (docs/SPEC-deploiement-spark.md §4.1).
OPTION_SPARK=""
if [ "$SPARK" = 1 ]; then
	ENV_FILE=$(spark_env_merge)
	PROD_COMPOSE=("${SPARK_COMPOSE[@]}")
	OPTION_SPARK=" --spark"
fi

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

# --- Confirmation d'instantané — checkée AVANT Docker ----------------------------------------
#
# @spec CRM-087 (docs/BACKLOG.md), docs/JOURNAL.md décision 489
#
# La confirmation d'instantané est la garde la plus forte de la fenêtre de migration : sans
# instantané, aucun retour arrière n'existe (docs/PROD_MIGRATIONS.md §6). Elle est refusée AVANT
# `require_docker` et AVANT tout appel à Compose, pour deux raisons : (1) le harnais
# `scripts/verify-scripts.sh` peut la prouver sans démon Docker ; (2) une fenêtre de migration
# annoncée qui échouerait faute d'instantané ne doit rien engager sur la pile.

if [ "$MODE" = migrate ] && [ "$PREMIER_DEPLOIEMENT" != 1 ]; then
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
	# @spec CRM-090 (docs/BACKLOG.md), docs/SPEC-deploiement-spark.md §5.2
	# Sur une base vierge, il n'y a rien à protéger, mais AFFIRMER l'instantané serait faux : la
	# confirmation est remplacée par une mesure, et la mesure refuse tout ce qui n'est pas vierge.
	#
	# MESURÉ le 2026-09-23 (décision 570) : sur une base vierge, la pile ENTIÈRE ne peut pas
	# démarrer — PostgREST ne charge pas son cache de schéma tant que `app` n'existe pas, et
	# `mail-sync` dépend de lui. Le premier déploiement ne démarre donc que les services dont le
	# runner dépend, mesure, migre, puis démarre tout. Depuis `CRM-092` T6, GoTrue n'en fait plus
	# partie : il a quitté la pile (docs/SPEC-session-sso.md §2, décision 589).
	if [ "$PREMIER_DEPLOIEMENT" = 1 ]; then
		require_free_ports compose_prod
		say "Premier déploiement : services dont le runner dépend"
		compose_prod up -d --wait db storage
		tables=$(docker exec -i p2enjoy-db psql -U postgres -d "$(env_get "$ENV_FILE" POSTGRES_DB)" -qtA \
			-c "select count(*) from pg_tables where schemaname = 'public'") \
			|| die "premier déploiement : la base n'a pas pu être interrogée."
		if [ "$tables" != 0 ]; then
			die "premier déploiement refusé : la base porte $tables table(s) dans le schéma public.
        Elle n'est pas vierge, et une migration sans instantané y serait sans retour arrière.
        Prendre l'instantané, puis ./runProd.sh${OPTION_SPARK} --migrate --instantane-verifie."
		fi
		info "Base mesurée vierge : aucune table dans le schéma public. Aucun instantané n'est exigé."
	fi

	say "Fenêtre de migration de production"
	info "Le fichier $ENV_FILE ne sera PAS modifié."
	info "APPLY_MIGRATIONS=true est surchargé pour cette seule invocation."

	# Recréation forcée : `migrations-runner` est un conteneur à usage unique. Compose ne le
	# relancerait pas sans cette option, et sa configuration est inchangée entre deux passages.
	APPLY_MIGRATIONS=true compose_prod up -d --no-deps --force-recreate migrations-runner

	# Attendre la fin du conteneur — la sortie propage son code. `docker wait` renvoie l'entier
	# rendu par le processus init du conteneur ; le runner s'arrête à la première erreur, laisse
	# donc un code non nul et n'annonce aucun succès (le message final n'est pas écrit).
	if code=$(docker wait p2enjoy-migrations); then
		if [ "$code" = 0 ]; then
			say "Migrations appliquées avec succès — cache de schéma rechargé par le runner."
			if [ "$PREMIER_DEPLOIEMENT" = 1 ]; then
				# MESURÉ (décision 570) : PostgREST, démarré sans schéma, reste dans une boucle de
				# reconnexion à intervalle croissant et n'entend pas le `notify` du runner ; Compose
				# refuse aussitôt une dépendance déjà marquée malsaine. Le recréer rend le démarrage
				# déterministe, sans attente arbitraire.
				say "Premier déploiement : PostgREST recréé sur le schéma migré, puis la pile entière"
				compose_prod up -d --wait --no-deps --force-recreate rest
				compose_prod up -d --wait
			fi
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
if [ "$SPARK" = 1 ]; then
	info "http://<cellule>:$(env_get "$ENV_FILE" SPARK_HTTP_PORT)   webapp et API en clair ; la Forge termine TLS"
	info "https://${APP_DOMAIN}          une fois la route posée par le propriétaire du Spark"
else
	info "https://${APP_DOMAIN}          webapp et API, TLS terminé par Caddy"
	info "http://${APP_DOMAIN}           redirigé vers https"
fi
info "Aucun autre port n'est publié : ni Kong, ni PostgREST, ni PostgreSQL, ni MinIO."

echo
say "Après démarrage"
info "Ouvrir la fenêtre de migration : ./runProd.sh${OPTION_SPARK} --migrate (docs/PROD_MIGRATIONS.md §3.1)."
info "Dérouler les vérifications de déploiement : docs/PROD_MIGRATIONS.md §5."
