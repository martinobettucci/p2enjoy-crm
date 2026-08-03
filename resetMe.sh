#!/usr/bin/env bash
# @spec CRM-002 (docs/BACKLOG.md) — réinitialisation des données de développement
# @spec docs/JOURNAL.md décision 16 (gardes de profil et confirmation explicite)
# @spec CLAUDE.md §9 (opérations destructives) ; docs/DAT.md §11 (données de développement)
# @spec README.md §5 (commandes principales)
#
# Détruit la base locale et les volumes de la pile de développement, puis la redémarre : les
# migrations de `supabase/migrations/` sont rejouées à blanc par le conteneur
# `migrations-runner`, et le seed est appliqué s'il existe.
#
# OPÉRATION DESTRUCTIVE. Elle est bornée par deux gardes :
#   * elle refuse tout fichier d'environnement de profil autre que `dev` ;
#   * elle exige une confirmation, explicite (`--yes`) hors terminal interactif.
#
# Usage :
#   ./resetMe.sh          demande confirmation, puis réinitialise
#   ./resetMe.sh --yes    réinitialise sans demander (scripts, intégration continue)
#   ./resetMe.sh --help

set -euo pipefail

# shellcheck source=scripts/lib/env.sh
source "$(dirname "${BASH_SOURCE[0]}")/scripts/lib/env.sh"

ASSUME_YES=false

usage() { print_header_help "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
	case "$1" in
		--yes|-y)  ASSUME_YES=true ;;
		--help|-h) usage; exit 0 ;;
		*)         die "option inconnue « $1 ». Voir ./resetMe.sh --help." ;;
	esac
	shift
done

# --- Gardes ------------------------------------------------------------------------------------

[ -f "$ENV_FILE" ] || die "fichier d'environnement $ENV_FILE absent : rien à réinitialiser. Lancez ./runDev.sh."

env_validate
# Garde principale : jamais sur un environnement qui n'est pas de développement.
env_require_profile dev

DB_DATA="$REPO_ROOT/supabase/docker/volumes/db/data"

say "Réinitialisation de l'environnement de développement"
info "Seront détruits :"
info "  · le cluster PostgreSQL local ($DB_DATA)"
info "  · les volumes Docker de la pile, dont les objets déposés dans MinIO"
info "Seront conservés : le dépôt, $(basename "$ENV_FILE"), et les migrations versionnées."

if [ "$ASSUME_YES" != true ]; then
	if [ ! -t 0 ]; then
		die "confirmation impossible hors terminal interactif. Relancez avec --yes si c'est bien
        l'effacement des données de développement qui est voulu."
	fi
	printf '\nTaper « oui » pour confirmer : '
	read -r answer
	[ "$answer" = "oui" ] || die "réinitialisation abandonnée. Rien n'a été détruit."
fi

require_docker

# --- Destruction -------------------------------------------------------------------------------

say "Arrêt de la pile et destruction des volumes"
compose_dev down -v --remove-orphans

if [ -d "$DB_DATA" ]; then
	info "Suppression de $DB_DATA"
	rm -rf "$DB_DATA"
fi

# --- Reconstruction ----------------------------------------------------------------------------

say "Redémarrage à froid"
compose_dev up -d --wait
info "Migrations rejouées par le conteneur migrations-runner (APPLY_MIGRATIONS=$(env_get "$ENV_FILE" APPLY_MIGRATIONS))."

# --- Seed --------------------------------------------------------------------------------------

SEED_DIR="$REPO_ROOT/supabase/seed"
if [ -x "$SEED_DIR/apply-seed.sh" ]; then
	say "Application du seed"
	P2ENJOY_ENV_FILE="$ENV_FILE" "$SEED_DIR/apply-seed.sh"
else
	echo
	warn "Seed non appliqué : $SEED_DIR/apply-seed.sh n'existe pas encore."
	warn "Le seed est l'objet de l'unité CRM-005 (docs/BACKLOG.md). La base repart donc vide,"
	warn "avec le seul schéma produit par les migrations."
fi

echo
say "Environnement réinitialisé"
info "Vérifier la pile : scripts/verify-stack.sh"
