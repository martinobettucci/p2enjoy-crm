#!/usr/bin/env bash
# @spec INC-367 (docs/BACKLOG.md « Correctif — INC-367 ») — aucun harnais sans borne de temps
# @spec docs/SPEC-test-harness.md §3.16 ; docs/INCONSISTENCY_REPORT.md INC-367 ; docs/DAT.md §13 (commandes de développement)
#
# `borner <secondes> <commande…>` : exécute la commande, et l'arrête si elle dépasse la borne — `TERM`, puis `KILL` 15 s plus tard.
# Un dépassement est NOMMÉ sur la sortie d'erreur (« DÉLAI DÉPASSÉ après N s : <commande> ») et rend 124 ; sinon, le code et la sortie
# de la commande passent tels quels. À employer pour toute commande d'un harnais qui dépend du réseau ou d'un démon et peut bloquer
# sans fin (`docker build`, `docker pull`) : mesuré le 2026-11-25, une construction a tenu 48 245 s et gardé le verrou de campagne.
#
# `timeout` sans `--foreground` signale tout le groupe de processus : `docker-buildx`, fils du client Docker, est arrêté avec lui.
#
#   source scripts/lib/borne.sh
#   borner "${VERIFY_BUILD_DELAI:-1200}" docker compose … build webapp

borner() { # <secondes> <commande…>
	local secondes=${1:-} code
	case "$secondes" in
		'' | *[!0-9]* | 0) printf 'borner : une borne en secondes (entier positif) est exigée, reçu « %s »\n' "$secondes" >&2; return 64 ;;
	esac
	shift
	[ $# -gt 0 ] || { printf 'usage : borner <secondes> <commande…>\n' >&2; return 64; }
	timeout --kill-after=15 "$secondes" "$@"
	code=$?
	if [ "$code" = 124 ] || [ "$code" = 137 ]; then
		printf 'DÉLAI DÉPASSÉ après %s s : %s\n' "$secondes" "$*" >&2
		return 124
	fi
	return "$code"
}
