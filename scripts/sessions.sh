#!/usr/bin/env bash
# @spec CRM-115 (docs/BACKLOG.md) — tranche T3 : lire et libérer le registre des sessions
# @spec docs/SPEC-pile-par-session.md §4.5 (`scripts/sessions.sh liste` avec l'état mesuré de chaque entrée,
#       `scripts/sessions.sh liberer N` pour un emplacement périmé), §4.4 (périmée), §8 (VM recyclée)
#
# Usage :
#   scripts/sessions.sh liste               le registre : emplacement, état, session, projet, checkout
#   scripts/sessions.sh liberer N           libère un emplacement périmé ou d'une VM recyclée
#   scripts/sessions.sh liberer N --force   libère même un emplacement vivant (à n'utiliser que pour une session morte)
#
# Le registre est `P2ENJOY_REGISTRE_SESSIONS`, `/var/tmp/p2enjoy-crm/sessions` par défaut. Libérer n'arrête aucune pile :
# `./runDev.sh --stop` arrête la sienne et retire son entrée.

set -euo pipefail
# shellcheck source=scripts/lib/emplacement.sh
source "$(dirname "$0")/lib/emplacement.sh"

case "${1:-}" in
	liste)
		printf 'EMPLACEMENT\tÉTAT\tSESSION\tPROJET\tCHECKOUT\n'
		emplacement_lister
		;;
	liberer)
		[[ "${2:-}" =~ ^[0-9]+$ ]] || { echo "usage : scripts/sessions.sh liberer N [--force]" >&2; exit 2; }
		emplacement_liberer "$2" "${3:-}"
		echo "emplacement $2 libéré."
		;;
	*)
		sed -n '/^# Usage :/,/^$/p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'
		[ "${1:-}" = --help ] || [ "${1:-}" = -h ] || exit 2
		;;
esac
