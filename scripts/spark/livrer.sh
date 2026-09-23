#!/usr/bin/env bash
# @spec CRM-090 (docs/BACKLOG.md) — livraison d'une révision poussée dans la cellule Spark
# @spec docs/SPEC-deploiement-spark.md §5.1 (livrer), §5.2 (premier déploiement), §7 (vérifications)
# @spec docs/JOURNAL.md décision 567 (build sur le poste, archive par-dessus /srv/crm)
#
# S'exécute sur le POSTE qui livre, jamais dans la cellule : celle-ci n'a pas Node, et un build
# Vite y consommerait la mémoire de la pile.
#
# Étapes, dans cet ordre :
#   1. refuse un arbre de travail modifié et un HEAD absent d'origin/main : la cellule exécute du
#      code POUSSÉ, jamais un état local ;
#   2. relit dans la cellule les variables PUBLIQUES du build (/etc/spark/env) et refuse s'il en
#      manque une ;
#   3. retire dans la cellule les fichiers que Git a supprimés depuis la révision déployée — une
#      extraction par-dessus ne les retirerait pas ;
#   4. construit la webapp sur le poste avec ces variables ;
#   5. extrait `git archive HEAD` par-dessus /srv/crm, remplace le CONTENU de webapp/dist (Caddy
#      en monte le répertoire : le remplacer par un autre laisserait Caddy sur l'ancien), et écrit
#      REVISION ;
#   6. construit l'image Realtime dérivée et la charge dans la cellule si son identifiant y diffère
#      (décision 571 : l'image d'origine n'y est pas extractible) ;
#   7. lance `./runProd.sh --spark` dans la cellule, avec les options passées après `--`.
#
# La cellule est jointe par un ALIAS ssh — aucune adresse n'entre au dépôt. Le poste le définit
# selon le fragment `ssh_config` du dossier de cellule (rebond compris).
#
# Usage :
#   scripts/spark/livrer.sh                                   livre HEAD et démarre la pile
#   scripts/spark/livrer.sh -- --migrate --premier-deploiement
#                                                             premier déploiement (§5.2)
#   scripts/spark/livrer.sh --sans-lancer                     livre sans rien démarrer
#   scripts/spark/livrer.sh --archive-seule                   dépose l'archive et REVISION, sans
#                                                             build ni lancement : amorçage d'une
#                                                             cellule dont les variables ne sont pas
#                                                             encore importées (§4.4 — proposer.sh
#                                                             s'exécute depuis ce dépôt, dans la
#                                                             cellule)
#   scripts/spark/livrer.sh --help
#
# Variables :
#   SPARK_SSH_HOTE         alias ssh de la cellule, défaut `crm`
#   SPARK_SSH_UTILISATEUR  compte qui porte la pile, défaut `spark-docker`
#   SPARK_REPERTOIRE       répertoire de l'application, défaut `/srv/crm`

set -euo pipefail

# shellcheck source=../lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/env.sh"

SPARK_SSH_HOTE="${SPARK_SSH_HOTE:-crm}"
SPARK_SSH_UTILISATEUR="${SPARK_SSH_UTILISATEUR:-spark-docker}"
SPARK_REPERTOIRE="${SPARK_REPERTOIRE:-/srv/crm}"
LANCER=1
ARCHIVE_SEULE=0
OPTIONS_PROD=()

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--sans-lancer)   LANCER=0 ;;
		--archive-seule) ARCHIVE_SEULE=1; LANCER=0 ;;
		--help|-h)       usage; exit 0 ;;
		--)              shift; OPTIONS_PROD=("$@"); break ;;
		*)               die "option inconnue « $1 ». Voir scripts/spark/livrer.sh --help." ;;
	esac
	shift
done

cible="$SPARK_SSH_UTILISATEUR@$SPARK_SSH_HOTE"
distant() { ssh -o BatchMode=yes "$cible" "$@"; }

# Une valeur passée à un shell distant est citée entre apostrophes ; le répertoire en contient
# rarement, mais une livraison ne se joue pas sur « rarement ».
case "$SPARK_REPERTOIRE" in
	*\'*) die "SPARK_REPERTOIRE ne peut pas contenir d'apostrophe." ;;
esac

# --- 1. Révision poussée ---------------------------------------------------------------------------

git -C "$REPO_ROOT" diff --quiet && git -C "$REPO_ROOT" diff --cached --quiet \
	|| die "l'arbre de travail porte des modifications : la cellule n'exécute que du code poussé."
[ -z "$(git -C "$REPO_ROOT" ls-files --others --exclude-standard)" ] \
	|| die "l'arbre de travail porte des fichiers non suivis : committer ou retirer avant de livrer."
git -C "$REPO_ROOT" fetch -q origin main
git -C "$REPO_ROOT" merge-base --is-ancestor HEAD origin/main \
	|| die "HEAD n'est pas dans origin/main : pousser avant de livrer."
REVISION=$(git -C "$REPO_ROOT" rev-parse HEAD)
say "Livraison de $REVISION vers $cible:$SPARK_REPERTOIRE"

# --- 2. Cellule joignable et préparée --------------------------------------------------------------

distant "test -d '$SPARK_REPERTOIRE' && test -w '$SPARK_REPERTOIRE'" \
	|| die "$SPARK_REPERTOIRE absent ou non inscriptible pour $SPARK_SSH_UTILISATEUR dans la cellule.
        Geste de root, une seule fois : install -d -o spark-docker -g spark-docker $SPARK_REPERTOIRE
        (docs/SPEC-deploiement-spark.md §6)."

variables=$(mktemp)
trap 'rm -f "$variables"' EXIT
if [ "$ARCHIVE_SEULE" = 0 ]; then
	distant "cat /etc/spark/env" > "$variables" || die "/etc/spark/env illisible dans la cellule."
	for nom in API_EXTERNAL_URL ANON_KEY SSO_OIDC_ISSUER SSO_OIDC_CLIENT_ID; do
		[ -n "$(env_get "$variables" "$nom")" ] || die "$nom absente de /etc/spark/env : la variable n'a pas
        été importée en console. Le build de la webapp ne peut pas la deviner
        (docs/SPEC-deploiement-spark.md §4.3)."
	done
fi

# --- 3. Fichiers supprimés depuis la révision déployée ---------------------------------------------

deployee=$(distant "cat '$SPARK_REPERTOIRE/REVISION' 2>/dev/null" || true)
if [ -n "$deployee" ]; then
	git -C "$REPO_ROOT" cat-file -e "$deployee^{commit}" 2>/dev/null \
		|| die "révision déployée $deployee inconnue de ce clone : récupérer l'historique avant de livrer."
	supprimes=$(git -C "$REPO_ROOT" diff --diff-filter=D --name-only "$deployee" HEAD)
	if [ -n "$supprimes" ]; then
		info "Fichiers supprimés depuis $deployee, retirés dans la cellule :"
		printf '%s\n' "$supprimes" | sed 's/^/    /'
		git -C "$REPO_ROOT" diff -z --diff-filter=D --name-only "$deployee" HEAD \
			| distant "cd '$SPARK_REPERTOIRE' && xargs -0 -r rm -f --"
	fi
else
	info "Aucune révision déployée : première livraison."
fi

# --- 4. Build de la webapp, sur le poste -------------------------------------------------------------
#
# Les variables d'environnement présentes à l'exécution de Vite l'emportent sur tout fichier `.env`
# de la webapp : le build vise donc la cellule, quel que soit le poste.

if [ "$ARCHIVE_SEULE" = 0 ]; then
	say "Build de la webapp pour $(env_get "$variables" API_EXTERNAL_URL)"
	(
		cd "$REPO_ROOT"
		VITE_SUPABASE_URL=$(env_get "$variables" API_EXTERNAL_URL) \
		VITE_SUPABASE_ANON_KEY=$(env_get "$variables" ANON_KEY) \
		VITE_SSO_ISSUER=$(env_get "$variables" SSO_OIDC_ISSUER) \
		VITE_SSO_CLIENT_ID=$(env_get "$variables" SSO_OIDC_CLIENT_ID) \
			npm run build
	)
	[ -f "$REPO_ROOT/webapp/dist/index.html" ] || die "build sans webapp/dist/index.html : livraison interrompue."
fi

# --- 5. Transfert --------------------------------------------------------------------------------------

say "Transfert de l'archive et de la webapp"
git -C "$REPO_ROOT" archive --format=tar HEAD | distant "tar -x -C '$SPARK_REPERTOIRE'"
[ "$ARCHIVE_SEULE" = 1 ] || tar -C "$REPO_ROOT/webapp" -cf - dist | distant "set -e
	cd '$SPARK_REPERTOIRE/webapp'
	rm -rf dist.livraison && mkdir dist.livraison && tar -x -C dist.livraison -f -
	mkdir -p dist && find dist -mindepth 1 -delete && cp -a dist.livraison/dist/. dist/
	rm -rf dist.livraison"
printf '%s\n' "$REVISION" | distant "cat > '$SPARK_REPERTOIRE/REVISION'"
info "REVISION = $REVISION"

# --- 6. Image Realtime dérivée ------------------------------------------------------------------------
#
# @spec docs/SPEC-deploiement-spark.md §3.5, docs/JOURNAL.md décision 571
# L'étiquette est celle que `docker-compose.spark.yml` déclare avec `pull_policy: never` ;
# `scripts/verify-spark.sh` prouve que les deux ne divergent pas.

IMAGE_REALTIME_SPARK=p2enjoy/realtime-spark:v2.102.3
if [ "$ARCHIVE_SEULE" = 0 ]; then
	say "Image Realtime dérivée"
	docker build -q -t "$IMAGE_REALTIME_SPARK" "$REPO_ROOT/supabase/docker/realtime-spark" >/dev/null
	id_local=$(docker image inspect --format '{{.Id}}' "$IMAGE_REALTIME_SPARK")
	id_cellule=$(distant "docker image inspect --format '{{.Id}}' '$IMAGE_REALTIME_SPARK' 2>/dev/null" || true)
	if [ "$id_local" = "$id_cellule" ]; then
		info "déjà présente dans la cellule ($id_local)."
	else
		info "transfert de $IMAGE_REALTIME_SPARK ($id_local)"
		docker save "$IMAGE_REALTIME_SPARK" | gzip -1 | distant "gunzip | docker load >/dev/null"
	fi
fi

# --- 7. Lancement ----------------------------------------------------------------------------------------

if [ "$ARCHIVE_SEULE" = 1 ]; then
	info "Archive seule : ni build, ni webapp, ni démarrage. Suite, dans la cellule :"
	info "  cd $SPARK_REPERTOIRE && scripts/spark/proposer.sh"
	exit 0
fi
if [ "$LANCER" = 0 ]; then
	info "Livré sans démarrage (--sans-lancer)."
	exit 0
fi

say "Lancement dans la cellule : ./runProd.sh --spark ${OPTIONS_PROD[*]:-}"
# `-t` donne un terminal au script distant : la confirmation d'instantané de --migrate le demande.
options=$(printf " %q" "${OPTIONS_PROD[@]}")
ssh -t -o BatchMode=yes "$cible" "cd '$SPARK_REPERTOIRE' && ./runProd.sh --spark${OPTIONS_PROD[0]+$options}"
