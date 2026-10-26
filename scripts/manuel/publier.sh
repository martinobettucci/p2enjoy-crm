#!/usr/bin/env bash
# @spec CRM-117 (docs/BACKLOG.md) — tranche T2 : la publication du manuel dans le bucket `manual`
# @spec docs/SPEC-manual.md §14.1 (le bucket), §15 (la publication, en miroir) ; docs/DAT.md §3.7 quater ;
#       docs/PROD_MIGRATIONS.md ; docs/JOURNAL.md décision 751
#
# Recopie le manuel construit (docs/manuel/construit/) et ses images (docs/manuel/images/*/*.jpg) dans le bucket
# privé `manual`, avec la clé de service, puis retire du bucket tout objet que la source ne porte plus : le bucket est
# un MIROIR. Rejouable : un second passage dépose les mêmes octets et ne retire rien.
#
# Le manuel construit doit être à jour (`npm run manuel:verifier`) : la publication le vérifie quand Node est disponible,
# refuse en production, signale en développement (voir plus bas). Dans la cellule de production, Node est absent : la
# livraison vérifie depuis le poste qui livre.
#
# Usage :
#   scripts/manuel/publier.sh            pile de développement (Kong, KONG_HTTP_PORT)
#   scripts/manuel/publier.sh --spark    cellule de production (Caddy, SPARK_HTTP_PORT), sur instruction du responsable
#   P2ENJOY_MANUEL_API=<url> …           une autre adresse d'API, pour un harnais

set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/scripts/lib/env.sh"

usage() { print_header_help "${BASH_SOURCE[0]}"; }

SPARK=0
while [ $# -gt 0 ]; do
	case "$1" in
		--help|-h) usage; exit 0 ;;
		--spark)   SPARK=1 ;;
		*)         die "option inconnue « $1 ». Voir scripts/manuel/publier.sh --help." ;;
	esac
	shift
done

command -v curl >/dev/null 2>&1 || die "curl est introuvable : la publication passe par l'API de stockage."
command -v jq   >/dev/null 2>&1 || die "jq est introuvable : la publication lit des réponses JSON."

if [ "$SPARK" = 1 ]; then
	API="${P2ENJOY_MANUEL_API:-http://127.0.0.1:$(env_get "$ENV_FILE" SPARK_HTTP_PORT)}"
else
	API="${P2ENJOY_MANUEL_API:-http://127.0.0.1:$(env_get "$ENV_FILE" KONG_HTTP_PORT)}"
fi
SERVICE=$(env_get "$ENV_FILE" SERVICE_ROLE_KEY)
[ -n "$SERVICE" ] || die "SERVICE_ROLE_KEY est absente de $ENV_FILE."

CONSTRUIT="$REPO_ROOT/docs/manuel/construit"
IMAGES="$REPO_ROOT/docs/manuel/images"
BUCKET=manual
[ -f "$CONSTRUIT/contents.json" ] || die "le manuel construit est absent : npm run manuel:construire."

# UN MANUEL CONSTRUIT PÉRIMÉ est refusé en production, et seulement signalé en développement : le seed publie le manuel
# à chaque passage, et toute unité qui modifie `docs/manual.md` sans le reconstruire ferait sinon échouer le seed de
# toutes les sessions. La preuve du manuel (`scripts/verify-manual.sh`) tient la règle, elle, sans exception.
if command -v node >/dev/null 2>&1 && ! node "$REPO_ROOT/scripts/manuel/construire.mjs" --verifier >/dev/null 2>&1; then
	[ "$SPARK" = 1 ] && die "le manuel construit ne correspond plus à sa source : npm run manuel:construire, puis relancer."
	warn "le manuel construit ne correspond plus à docs/manual.md — publié tel quel ; npm run manuel:construire."
fi

REPONSE=$(mktemp)
trap 'rm -f "$REPONSE"' EXIT

# Ce que la source porte : chemin dans le bucket → fichier local.
declare -A SOURCE=()
SOURCE["contents.json"]="$CONSTRUIT/contents.json"
for fichier in "$CONSTRUIT"/chapters/*.json; do
	SOURCE["chapters/$(basename "$fichier")"]="$fichier"
done
if [ -d "$IMAGES" ]; then
	while IFS= read -r -d '' fichier; do
		SOURCE["images/${fichier#"$IMAGES"/}"]="$fichier"
	done < <(find "$IMAGES" -mindepth 2 -maxdepth 2 -name '*.jpg' -print0)
fi

# 1. DÉPOSER, en remplacement : chaque fichier de la source, avec son type.
deposes=0
for chemin in "${!SOURCE[@]}"; do
	case "$chemin" in
		*.json) type='application/json' ;;
		*.jpg)  type='image/jpeg' ;;
	esac
	code=$(curl -sS -o "$REPONSE" -w '%{http_code}' -X POST "$API/storage/v1/object/$BUCKET/$chemin" \
		-H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
		-H "Content-Type: $type" -H 'x-upsert: true' \
		--data-binary "@${SOURCE[$chemin]}")
	[ "$code" = 200 ] || die "dépôt de $chemin refusé ($code) : $(head -c 300 "$REPONSE")"
	deposes=$((deposes + 1))
done

# 2. LISTER le bucket, dossier par dossier : l'API rend un niveau à la fois, un dossier y paraît sans identifiant.
lister() {
	local prefixe=$1 code
	code=$(curl -sS -o "$REPONSE" -w '%{http_code}' -X POST "$API/storage/v1/object/list/$BUCKET" \
		-H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' \
		--data "$(jq -nc --arg p "$prefixe" '{prefix: $p, limit: 1000, offset: 0}')")
	[ "$code" = 200 ] || die "liste du bucket refusée ($code) sur « $prefixe » : $(head -c 300 "$REPONSE")"
	# « D » pour un dossier, « F » pour un objet : un identifiant vide en tête de ligne serait mangé par `read` (une
	# tabulation est un blanc pour IFS), et le dossier passerait pour un objet sans nom.
	local entrees genre nom
	entrees=$(jq -r '.[] | (if .id == null then "D" else "F" end) + " " + .name' "$REPONSE")
	while read -r genre nom; do
		[ -n "$nom" ] || continue
		if [ "$genre" = D ]; then lister "$prefixe$nom/"; else printf '%s\n' "$prefixe$nom"; fi
	done <<< "$entrees"
}
mapfile -t PRESENTS < <(lister '')

# 3. RETIRER ce que la source ne porte plus : le bucket est un miroir.
superflus=()
for chemin in "${PRESENTS[@]}"; do
	[ -n "${SOURCE[$chemin]+x}" ] || superflus+=("$chemin")
done
if [ "${#superflus[@]}" -gt 0 ]; then
	code=$(curl -sS -o "$REPONSE" -w '%{http_code}' -X DELETE "$API/storage/v1/object/$BUCKET" \
		-H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: application/json' \
		--data "$(printf '%s\n' "${superflus[@]}" | jq -R . | jq -sc '{prefixes: .}')")
	[ "$code" = 200 ] || die "retrait de ${#superflus[@]} objet(s) refusé ($code) : $(head -c 300 "$REPONSE")"
fi

info "Manuel publié : $deposes fichier(s) déposé(s), ${#superflus[@]} objet(s) retiré(s) du bucket « $BUCKET »."
