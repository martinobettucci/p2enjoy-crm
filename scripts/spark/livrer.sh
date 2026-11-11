#!/usr/bin/env bash
# @spec CRM-090 (docs/BACKLOG.md) — livraison d'une révision poussée dans la cellule Spark
# @spec docs/SPEC-deploiement-spark.md §5.1 (livrer), §5.2 (premier déploiement), §7 (vérifications)
# @spec docs/JOURNAL.md décision 567 (build sur le poste, archive par-dessus /srv/crm)
# @spec docs/JOURNAL.md décision 603 — la cellule est jointe par ses IP, jamais par un alias
# @spec CRM-147 (docs/BACKLOG.md) — livrer un condensé CHOISI, récupéré par git dans la cellule, la webapp bâtie dans la
#       cellule (docs/SPEC-deploiement-spark.md §5.1 bis ; docs/JOURNAL.md décisions 905, 909, 911, 912 et 915)
#
# S'exécute sur le POSTE qui livre. Depuis `CRM-147`, il ne livre plus l'arbre ni le HEAD du poste : la session de
# livraison CHOISIT un condensé (`--revision`, obligatoire), la cellule le récupère elle-même par git, et tout ce qui part
# en vient (§5.1 bis).
#
# Étapes, dans cet ordre :
#   1. résout le condensé et refuse s'il n'est pas contenu dans origin/main ;
#   2. relit dans la cellule les variables PUBLIQUES du build (/etc/spark/env) et refuse s'il en
#      manque une ;
#   3. dans la cellule, sous spark-docker : vérifie l'épinglage de la clé d'hôte de GitHub, fait de /srv/crm le clone
#      la première fois, récupère origin, contrôle que le condensé ne suit aucun chemin de données, puis se place sur
#      le condensé (`checkout --detach`, sans `--force` une fois converti : un fichier suivi modifié fait refuser) ;
#   4. bâtit la webapp DANS LA CELLULE, depuis le condensé, dans un conteneur jetable et borné, et remplace le
#      CONTENU de webapp/dist (Caddy en monte le répertoire) ; écrit REVISION ;
#   5. construit les images Realtime et MinIO dérivées DEPUIS LE CONDENSÉ (`git archive` dans un répertoire jetable du
#      poste, jamais un worktree) et charge chacune dans la cellule si son contenu y diffère (décisions 571, INC-329) ;
#   6. lance `./runProd.sh --spark` dans la cellule, avec les options passées après `--`.
#
# Jamais dans la cellule : `git clean`, `git reset --hard`, `git stash` — un dépôt de travail y côtoie les données.
#
# La cellule est jointe par ses adresses IP, JAMAIS par un alias (décision 603) : elles sont passées
# par l'environnement, lues dans la ligne `ssh -J` du §1 du dossier de cellule — aucune n'entre au
# dépôt.
#
# Usage :
#   scripts/spark/livrer.sh --revision <condensé>             livre ce condensé et démarre la pile
#   scripts/spark/livrer.sh --revision <condensé> -- --migrate --premier-deploiement
#                                                             premier déploiement (§5.2)
#   scripts/spark/livrer.sh --revision <condensé> --sans-lancer
#                                                             livre sans rien démarrer
#   scripts/spark/livrer.sh --archive-seule                   dépose l'archive de HEAD et REVISION, sans
#                                                             build ni lancement : amorçage d'une
#                                                             cellule dont les variables ne sont pas
#                                                             encore importées (§4.4 — proposer.sh
#                                                             s'exécute depuis ce dépôt, dans la
#                                                             cellule)
#   scripts/spark/livrer.sh --help
#
# Variables :
#   SPARK_SSH_HOTE         IP de la cellule — obligatoire, un nom d'hôte est refusé
#   SPARK_SSH_REBOND       `utilisateur@IP` du rebond, passé à `ssh -J` — facultatif
#   SPARK_SSH_UTILISATEUR  compte qui porte la pile, défaut `spark-docker`
#   SPARK_REPERTOIRE       répertoire de l'application, défaut `/srv/crm` — le clone de la cellule
#   SPARK_DEPOT            dépôt que la cellule clone, défaut git@github.com:martinobettucci/p2enjoy-crm.git
#   SPARK_HOTES_CONNUS     fichier des clés d'hôte de spark-docker, défaut ~/.ssh/known_hosts (dans la cellule)
#   SPARK_IMAGE_BUILD      image du build de la webapp, défaut node:24-alpine (celle de webapp/Dockerfile)

set -euo pipefail

# shellcheck source=../lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/env.sh"
# shellcheck source=../lib/spark-ssh.sh
source "$(dirname "${BASH_SOURCE[0]}")/../lib/spark-ssh.sh"

SPARK_REPERTOIRE="${SPARK_REPERTOIRE:-/srv/crm}"
SPARK_DEPOT="${SPARK_DEPOT:-git@github.com:martinobettucci/p2enjoy-crm.git}"
SPARK_HOTES_CONNUS="${SPARK_HOTES_CONNUS:-}"
SPARK_IMAGE_BUILD="${SPARK_IMAGE_BUILD:-node:24-alpine}"
LANCER=1
ARCHIVE_SEULE=0
DEMANDE=""
OPTIONS_PROD=()

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--revision)      [ $# -ge 2 ] || die "--revision attend un condensé."; DEMANDE=$2; shift ;;
		--revision=*)    DEMANDE=${1#--revision=} ;;
		--sans-lancer)   LANCER=0 ;;
		--archive-seule) ARCHIVE_SEULE=1; LANCER=0 ;;
		--help|-h)       usage; exit 0 ;;
		--)              shift; OPTIONS_PROD=("$@"); break ;;
		*)               die "option inconnue « $1 ». Voir scripts/spark/livrer.sh --help." ;;
	esac
	shift
done

# CRM-147 (décision 915) : le condensé est OBLIGATOIRE — une livraison n'emporte plus jamais tout `main` par défaut.
# Refusé avant tout geste, ssh compris.
if [ "$ARCHIVE_SEULE" = 0 ] && [ -z "$DEMANDE" ]; then
	die "le condensé est obligatoire : scripts/spark/livrer.sh --revision <condensé>.
        La session de livraison choisit le dernier commit d'un lot stable (docs/SPEC-deploiement-spark.md §5.1 bis)."
fi
case "$DEMANDE" in
	*[!0-9a-fA-F]*) die "--revision « $DEMANDE » : un condensé hexadécimal est attendu, jamais un nom de branche." ;;
esac

spark_ssh_preparer
cible="$SPARK_SSH_CIBLE"
distant() { ssh "${SPARK_SSH_OPTIONS[@]}" "$cible" "$@"; }

# Une valeur passée à un shell distant est citée entre apostrophes ; le répertoire en contient
# rarement, mais une livraison ne se joue pas sur « rarement ».
for valeur in "$SPARK_REPERTOIRE" "$SPARK_DEPOT" "$SPARK_HOTES_CONNUS" "$SPARK_IMAGE_BUILD"; do
	case "$valeur" in
		*\'*) die "SPARK_REPERTOIRE, SPARK_DEPOT, SPARK_HOTES_CONNUS et SPARK_IMAGE_BUILD ne peuvent pas contenir d'apostrophe." ;;
	esac
done

# --- 1. Le condensé, poussé -----------------------------------------------------------------------

git -C "$REPO_ROOT" fetch -q origin main
if [ "$ARCHIVE_SEULE" = 1 ]; then
	# L'amorçage d'une cellule (§4.4) livre encore l'archive de HEAD, comme avant `CRM-147`.
	git -C "$REPO_ROOT" diff --quiet && git -C "$REPO_ROOT" diff --cached --quiet \
		|| die "l'arbre de travail porte des modifications : la cellule n'exécute que du code poussé."
	git -C "$REPO_ROOT" merge-base --is-ancestor HEAD origin/main \
		|| die "HEAD n'est pas dans origin/main : pousser avant de livrer."
	REVISION=$(git -C "$REPO_ROOT" rev-parse HEAD)
else
	REVISION=$(git -C "$REPO_ROOT" rev-parse -q --verify "$DEMANDE^{commit}") \
		|| die "condensé « $DEMANDE » inconnu de ce clone : récupérer l'historique, ou vérifier le condensé."
	git -C "$REPO_ROOT" merge-base --is-ancestor "$REVISION" origin/main \
		|| die "le condensé $REVISION n'est pas dans origin/main : seule une révision poussée se livre."
fi
say "Livraison de $REVISION vers $cible:$SPARK_REPERTOIRE"

# --- 2. Cellule joignable et préparée --------------------------------------------------------------

distant "test -d '$SPARK_REPERTOIRE' && test -w '$SPARK_REPERTOIRE'" \
	|| die "$SPARK_REPERTOIRE absent ou non inscriptible pour $SPARK_SSH_UTILISATEUR dans la cellule.
        Geste de root, une seule fois : install -d -o spark-docker -g spark-docker $SPARK_REPERTOIRE
        (docs/SPEC-deploiement-spark.md §6)."

variables=$(mktemp)
source_images=""
trap 'rm -f "$variables"; [ -z "$source_images" ] || rm -rf "$source_images"' EXIT
if [ "$ARCHIVE_SEULE" = 0 ]; then
	distant "cat /etc/spark/env" > "$variables" || die "/etc/spark/env illisible dans la cellule."
	for nom in API_EXTERNAL_URL ANON_KEY SSO_OIDC_ISSUER SSO_OIDC_CLIENT_ID; do
		[ -n "$(env_get "$variables" "$nom")" ] || die "$nom absente de /etc/spark/env : la variable n'a pas
        été importée en console. Le build de la webapp ne peut pas la deviner
        (docs/SPEC-deploiement-spark.md §4.3)."
	done
fi

if [ "$ARCHIVE_SEULE" = 1 ]; then
	# --- Amorçage : l'archive de HEAD par-dessus un répertoire qui n'est pas encore un clone ----------
	distant "test ! -d '$SPARK_REPERTOIRE/.git'" \
		|| die "$SPARK_REPERTOIRE est déjà un clone : --archive-seule n'amorce qu'une cellule neuve ; livrer par --revision."
	say "Transfert de l'archive de HEAD"
	git -C "$REPO_ROOT" archive --format=tar HEAD | distant "tar -x -C '$SPARK_REPERTOIRE'"
	printf '%s\n' "$REVISION" | distant "cat > '$SPARK_REPERTOIRE/REVISION'"
	info "REVISION = $REVISION"
	info "Archive seule : ni build, ni webapp, ni démarrage. Suite, dans la cellule :"
	info "  cd $SPARK_REPERTOIRE && scripts/spark/proposer.sh"
	exit 0
fi

# --- 3. Le clone de la cellule, placé sur le condensé ----------------------------------------------
#
# Sous spark-docker, jamais root (décision 909). La clé de clonage (~/.ssh/id_ed25519, décision 912) n'est ni lue ni
# affichée : seules des commandes git la mettent en œuvre. La clé d'hôte de GitHub doit être ÉPINGLÉE : le script le
# vérifie, il ne l'écrit jamais (geste préalable, docs/PROD_MIGRATIONS.md).
#
# LES DONNÉES NE SONT JAMAIS AU DÉPÔT : un `checkout` ne touche aucun fichier NON SUIVI. Le contrôle porte donc sur le
# condensé lui-même — il ne doit SUIVRE aucun chemin de données (`git ls-tree`) ; le `.gitignore` du disque, celui de
# l'ancienne révision, ne prouverait rien à la première conversion.
say "Clone de la cellule : récupération et placement sur $REVISION"
distant "set -euo pipefail
cd '$SPARK_REPERTOIRE'
refuser() { printf 'REFUS : %s\n' \"\$*\" >&2; exit 3; }
connus='$SPARK_HOTES_CONNUS'
[ -n \"\$connus\" ] || connus=\"\$HOME/.ssh/known_hosts\"
ssh-keygen -F github.com -f \"\$connus\" >/dev/null 2>&1 \
	|| refuser \"la clé d'hôte de GitHub n'est pas épinglée dans \$connus : geste préalable (docs/PROD_MIGRATIONS.md) ; la livraison ne contourne jamais la vérification d'hôte.\"
export GIT_SSH_COMMAND=\"ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=\$connus\"
if [ -d .git ]; then premiere=0; git remote set-url origin '$SPARK_DEPOT'
else premiere=1; git init -q; git remote add origin '$SPARK_DEPOT'; fi
git fetch -q origin main || refuser \"git fetch refusé depuis la cellule : la clé de spark-docker a-t-elle accès au dépôt ?\"
git cat-file -e '$REVISION^{commit}' 2>/dev/null || refuser \"le condensé $REVISION est absent du dépôt récupéré par la cellule.\"
git merge-base --is-ancestor '$REVISION' origin/main || refuser \"le condensé $REVISION n'est pas dans origin/main vu de la cellule.\"
suivis=\$(git ls-tree -r --name-only '$REVISION' -- supabase/docker/volumes/db/data supabase/docker/volumes/storage webapp/dist REVISION)
[ -z \"\$suivis\" ] || refuser \"le condensé SUIT des chemins de données : \$suivis\"
if [ \"\$premiere\" = 1 ]; then
	ancienne=\$(cat REVISION 2>/dev/null || true)
	if [ -n \"\$ancienne\" ] && git cat-file -e \"\$ancienne^{commit}\" 2>/dev/null; then
		git diff -z --diff-filter=D --name-only \"\$ancienne\" '$REVISION' | xargs -0 -r rm -f --
	fi
	git checkout -q --detach --force '$REVISION'
	echo 'Première conversion : le répertoire est désormais le clone.'
else
	sales=\$(git status --porcelain --untracked-files=no)
	[ -z \"\$sales\" ] || refuser \"des fichiers suivis sont modifiés dans la cellule, la livraison ne les écrase pas :
\$sales\"
	git checkout -q --detach '$REVISION'
fi" || die "le clone de la cellule n'a pas pu être placé sur $REVISION (motif ci-dessus)."

# --- 4. La webapp, bâtie DANS LA CELLULE, depuis le condensé --------------------------------------
#
# Décision 909 : un conteneur jetable de l'image du build, borné, sur une extraction du condensé ; le résultat remplace
# le CONTENU de webapp/dist (Caddy en monte le répertoire : le remplacer par un autre laisserait Caddy sur l'ancien).
say "Build de la webapp dans la cellule, pour $(env_get "$variables" API_EXTERNAL_URL)"
vite=""
for paire in VITE_SUPABASE_URL=API_EXTERNAL_URL VITE_SUPABASE_ANON_KEY=ANON_KEY VITE_SSO_ISSUER=SSO_OIDC_ISSUER \
	VITE_SSO_CLIENT_ID=SSO_OIDC_CLIENT_ID; do
	vite+=" -e $(printf '%q' "${paire%%=*}=$(env_get "$variables" "${paire#*=}")")"
done
distant "set -euo pipefail
cd '$SPARK_REPERTOIRE'
build=\$(mktemp -d)
trap 'rm -rf \"\$build\"' EXIT
git archive '$REVISION' | tar -x -C \"\$build\"
docker run --rm --memory 2g --cpus 2$vite -v \"\$build\":/src -w /src '$SPARK_IMAGE_BUILD' \
	sh -c 'npm ci --no-audit --no-fund && npm run build'
test -f \"\$build/webapp/dist/index.html\" || { echo 'REFUS : build sans webapp/dist/index.html' >&2; exit 3; }
mkdir -p webapp/dist && find webapp/dist -mindepth 1 -delete && cp -a \"\$build/webapp/dist/.\" webapp/dist/" \
	|| die "build de la webapp dans la cellule en échec : livraison interrompue, REVISION inchangée."
printf '%s\n' "$REVISION" | distant "cat > '$SPARK_REPERTOIRE/REVISION'"
info "REVISION = $REVISION"

# --- 5. Images dérivées, depuis le condensé ------------------------------------------------------------
#
# @spec docs/SPEC-deploiement-spark.md §3.5, docs/JOURNAL.md décisions 571, 577 et 794 (INC-329)
# Les étiquettes sont celles que `docker-compose.spark.yml` déclare avec `pull_policy: never` ;
# `scripts/verify-spark.sh` prouve que les deux ne divergent pas.
#
# CRM-147 : le contexte de construction vient du CONDENSÉ (`git archive` dans un répertoire jetable du poste), jamais de
# l'arbre de travail ni d'un worktree (`CLAUDE.md` §13).
#
# La comparaison porte sur le CONTENU — couches et configuration d'exécution —, jamais sur
# l'identifiant : mesuré, deux constructions au contenu égal rendent deux identifiants différents,
# les métadonnées de construction y entrant (décision 577). Le contenu, lui, survit à `docker load`.

IMAGE_REALTIME_SPARK=p2enjoy/realtime-spark:v2.102.3
IMAGE_MINIO_SPARK=p2enjoy/minio-spark:RELEASE.2026-10-23T20-06-51Z
CONTENU_IMAGE='{{json .RootFS.Layers}} {{json .Config}}'
#   image_derivee <libellé> <étiquette> <contexte de construction>
image_derivee() {
	local libelle=$1 etiquette=$2 contexte=$3 id_local contenu_local contenu_cellule
	say "Image $libelle dérivée"
	docker build -q -t "$etiquette" "$contexte" >/dev/null
	id_local=$(docker image inspect --format '{{.Id}}' "$etiquette")
	contenu_local=$(docker image inspect --format "$CONTENU_IMAGE" "$etiquette")
	contenu_cellule=$(distant "docker image inspect --format '$CONTENU_IMAGE' '$etiquette' 2>/dev/null" || true)
	if [ "$contenu_local" = "$contenu_cellule" ]; then
		info "déjà présente dans la cellule, contenu identique."
	else
		info "transfert de $etiquette ($id_local)"
		docker save "$etiquette" | gzip -1 | distant "gunzip | docker load >/dev/null"
	fi
}
source_images=$(mktemp -d)
git -C "$REPO_ROOT" archive "$REVISION" supabase/docker/realtime-spark supabase/docker/minio-spark | tar -x -C "$source_images"
image_derivee Realtime "$IMAGE_REALTIME_SPARK" "$source_images/supabase/docker/realtime-spark"
image_derivee MinIO "$IMAGE_MINIO_SPARK" "$source_images/supabase/docker/minio-spark"

# --- 6. Lancement ----------------------------------------------------------------------------------------

if [ "$LANCER" = 0 ]; then
	info "Livré sans démarrage (--sans-lancer)."
	exit 0
fi

say "Lancement dans la cellule : ./runProd.sh --spark ${OPTIONS_PROD[*]:-}"
# `-t` donne un terminal au script distant : la confirmation d'instantané de --migrate le demande.
options=$(printf " %q" "${OPTIONS_PROD[@]}")
ssh -t "${SPARK_SSH_OPTIONS[@]}" "$cible" "cd '$SPARK_REPERTOIRE' && ./runProd.sh --spark${OPTIONS_PROD[0]+$options}"
