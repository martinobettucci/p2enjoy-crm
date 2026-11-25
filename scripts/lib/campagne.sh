#!/usr/bin/env bash
# @spec INC-177 (docs/BACKLOG.md « Correctif arbitré le 2026-11-25 — INC-177 ») — le verrou de campagne
# @spec docs/SPEC-test-harness.md §3.9 ; docs/INCONSISTENCY_REPORT.md INC-177 ; docs/JOURNAL.md décision 990
# @spec docs/DAT.md §13 (commandes de développement)
#
# Le verrou de campagne : `test:sql`, `e2e:*`, le seed, la reconstruction de la base et un build servi par l'aperçu partagent
# UNE pile. Lancés de front, ils rendent des verdicts qui ne disent rien du produit (INC-177, décision 476). Ce fichier est
# à la fois une bibliothèque (`source scripts/lib/campagne.sh` puis `campagne_garde <nom> || exit $?`) et une commande :
#
#   scripts/lib/campagne.sh ouvrir [--nom <nom>] [--duree-max <s>] -- <commande…>   ouvre le verrou, exécute, rend le code, libère
#   scripts/lib/campagne.sh statut                                 nomme le détenteur (code 1 s'il est vivant)
#   scripts/lib/campagne.sh liberer [--forcer]                     retire un verrou MORT (--forcer : même vivant)
#   scripts/lib/campagne.sh garde <nom> [--pid <pid>] [--commande <texte>]   la garde, pour un appelant qui n'est pas en bash
#   scripts/lib/campagne.sh garde-build                            la garde de `npm run build` (prebuild)
#   scripts/lib/campagne.sh chemin                                 le répertoire du verrou
#
# Le verrou vit HORS de l'arbre de travail : `${XDG_RUNTIME_DIR:-/tmp}/p2enjoy-crm-campagne/<empreinte du dépôt>/` ; jamais
# committé, jamais touché par `git clean`. Il porte un PID, l'instant de début du processus (un PID réutilisé n'est pas le
# détenteur), la commande, un nom et un jeton. Le jeton (`CAMPAGNE_JETON`) est hérité par tous les enfants de l'ouvreur : ils
# traversent le verrou. Une commande gardée SANS jeton refuse (code 75) tant qu'un verrou vivant existe ; un verrou mort est
# repris. Sorties de secours : `CAMPAGNE_ATTENDRE=<secondes>` attend ; `CAMPAGNE_FORCER=1` passe outre et l'écrit.
# DURÉE MAXIMALE (INC-367) : `ouvrir` arrête la commande et tous ses descendants au bout de `CAMPAGNE_DUREE_MAX` secondes (21 600, six
# heures, par défaut ; `--duree-max <s>` à l'ouverture), le dit (« durée maximale dépassée »), libère le verrou et rend 124 : un harnais
# qui pend ne gèle plus les autres sessions (mesuré : 13 h 24 dans une construction d'image). La borne se relève, ne s'ôte pas : seul un
# entier positif est accepté (sinon code 64).
# `CAMPAGNE_REPERTOIRE` déplace le verrou (le harnais `scripts/verify-campagne.sh` l'isole ainsi des vraies campagnes).

CAMPAGNE_RACINE=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)

campagne_repertoire() {
	if [ -n "${CAMPAGNE_REPERTOIRE:-}" ]; then
		printf '%s\n' "$CAMPAGNE_REPERTOIRE"
		return
	fi
	local empreinte
	empreinte=$(printf '%s' "$CAMPAGNE_RACINE" | sha1sum | cut -c1-12)
	printf '%s\n' "${XDG_RUNTIME_DIR:-/tmp}/p2enjoy-crm-campagne/$empreinte"
}

_campagne_dossier() { printf '%s/verrou.d\n' "$(campagne_repertoire)"; }

# L'instant de début d'un processus (champ 22 de /proc/<pid>/stat) : ce qui distingue le détenteur d'un PID réutilisé.
_campagne_debut_processus() {
	[ -r "/proc/$1/stat" ] || return 1
	sed 's/^.*) //' "/proc/$1/stat" | awk '{print $20}'
}

_campagne_lire() { # <clé>
	local fichier
	fichier="$(_campagne_dossier)/infos"
	[ -r "$fichier" ] || return 1
	grep -m1 "^$1=" "$fichier" | cut -d= -f2-
}

# 0 si un verrou existe ET que son détenteur est vivant ; 1 sinon (libre, mort, ou en cours de pose depuis plus de 3 s).
_campagne_vivant() {
	local dossier pid debut courant
	dossier=$(_campagne_dossier)
	[ -d "$dossier" ] || return 1
	if [ ! -r "$dossier/infos" ]; then
		# Posé mais pas encore décrit : vivant pendant 3 s, mort ensuite.
		local age
		age=$(( $(date +%s) - $(stat -c %Y "$dossier" 2>/dev/null || echo 0) ))
		[ "$age" -le 3 ]
		return
	fi
	pid=$(_campagne_lire PID) || return 1
	debut=$(_campagne_lire DEBUT_PROC) || return 1
	courant=$(_campagne_debut_processus "$pid") || return 1
	[ "$courant" = "$debut" ]
}

_campagne_decrire() { # une ligne lisible du détenteur
	local nom pid debut commande depuis
	nom=$(_campagne_lire NOM); pid=$(_campagne_lire PID); debut=$(_campagne_lire DEBUT); commande=$(_campagne_lire COMMANDE)
	depuis=$(( $(date +%s) - debut ))
	printf 'Détenteur : %s (pid %s), depuis %s (il y a %s min %s s)\n  Commande  : %s\n' \
		"$nom" "$pid" "$(date -d "@$debut" +%H:%M:%S)" "$((depuis / 60))" "$((depuis % 60))" "$commande"
}

_campagne_poser() { # <nom> <pid> <commande> — 0 si le verrou est posé
	local nom=$1 pid=$2 commande=$3 dossier jeton reprise=0
	dossier=$(_campagne_dossier)
	mkdir -p "$(campagne_repertoire)"
	if ! mkdir "$dossier" 2>/dev/null; then
		if _campagne_vivant; then return 1; fi
		reprise=1
		rm -rf "$dossier"
		mkdir "$dossier" 2>/dev/null || return 1
	fi
	jeton="$(date +%s%N)-$RANDOM-$pid"
	{
		printf 'JETON=%s\nPID=%s\nDEBUT_PROC=%s\nDEBUT=%s\nNOM=%s\nCOMMANDE=%s\n' \
			"$jeton" "$pid" "$(_campagne_debut_processus "$pid")" "$(date +%s)" "$nom" "$(printf '%s' "$commande" | tr '\n' ' ')"
	} >"$dossier/infos.tmp" && mv "$dossier/infos.tmp" "$dossier/infos"
	[ "$reprise" = 1 ] && printf 'campagne : un verrou mort a été repris.\n' >&2
	export CAMPAGNE_JETON="$jeton"
	CAMPAGNE_OUVERT_ICI=1
	return 0
}

_campagne_traverse() { # 0 si l'appelant présente le jeton du verrou vivant
	[ -n "${CAMPAGNE_JETON:-}" ] && _campagne_vivant && [ "$(_campagne_lire JETON)" = "$CAMPAGNE_JETON" ]
}

_campagne_liberer_jeton() { # <jeton> — retire le verrou s'il est celui du jeton
	[ -n "${1:-}" ] || return 0
	if [ "$(_campagne_lire JETON 2>/dev/null)" = "$1" ]; then
		rm -rf "$(_campagne_dossier)"
	fi
	return 0
}

_campagne_refuser() { # <nom de la commande refusée>
	{
		printf '\033[31mCAMPAGNE EN COURS — « %s » est refusée.\033[0m\n' "$1"
		printf '  %s\n' "$(_campagne_decrire)"
		printf '  Une commande qui mesure l'"'"'état partagé (base, webapp/dist, port 4173) ne se lance pas de front avec une\n'
		printf '  campagne : son verdict ne dirait rien du produit (INC-177, docs/SPEC-test-harness.md §3.9).\n'
		printf '  Attendre         : CAMPAGNE_ATTENDRE=600 <commande>\n'
		printf '  Ouvrir la sienne : scripts/lib/campagne.sh ouvrir -- <commande>\n'
		printf '  Passer outre     : CAMPAGNE_FORCER=1 <commande>  (invalide la mesure de l'"'"'autre)\n'
	} >&2
}

# La garde. Rend 0 (passe, ou a pris le verrou pour la durée de l'appelant) ou 75 (refusée).
campagne_garde() { # <nom> [pid]
	local nom=${CAMPAGNE_NOM:-$1} pid=${2:-$$} commande limite
	CAMPAGNE_OUVERT_ICI=0
	if [ "${CAMPAGNE_FORCER:-}" = 1 ]; then
		printf '\033[31mcampagne : CAMPAGNE_FORCER=1 — la garde « %s » est contournée ; une campagne en cours est peut-être invalidée.\033[0m\n' "$1" >&2
		return 0
	fi
	_campagne_traverse && return 0
	commande=${CAMPAGNE_COMMANDE:-$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null)}
	limite=$(( $(date +%s) + ${CAMPAGNE_ATTENDRE:-0} ))
	while :; do
		if _campagne_poser "$nom" "$pid" "${commande:-$1}"; then
			# Appelée depuis un script (et non en commande) : le verrou est rendu à la sortie du script, à la suite de son
			# éventuel trap de sortie (relu par `trap -p` et réinstallé, jamais écrasé).
			if [ "$pid" = "$$" ] && [ "${BASH_SOURCE[0]}" != "$0" ]; then
				local ancien=() declaration
				declaration=$(trap -p EXIT)
				[ -n "$declaration" ] && eval "ancien=($declaration)"
				# shellcheck disable=SC2064
				trap "${ancien[2]:+${ancien[2]}; }_campagne_liberer_jeton '$CAMPAGNE_JETON'" EXIT
			fi
			return 0
		fi
		[ "$(date +%s)" -ge "$limite" ] && break
		sleep 2
	done
	_campagne_refuser "$1"
	return 75
}

_campagne_apercu_ecoute() { (exec 3<>"/dev/tcp/127.0.0.1/${CAMPAGNE_PORT_APERCU:-4173}") 2>/dev/null; }

campagne_garde_build() {
	_campagne_apercu_ecoute || return 0
	if [ "${CAMPAGNE_FORCER:-}" = 1 ]; then
		printf '\033[31mcampagne : CAMPAGNE_FORCER=1 — un build écrase peut-être le webapp/dist servi.\033[0m\n' >&2
		return 0
	fi
	_campagne_traverse && return 0
	if _campagne_vivant; then
		_campagne_refuser "npm run build"
		printf '  (le build écraserait webapp/dist, que la campagne sert sur le port %s : INC-177, seconde forme du piège)\n' "${CAMPAGNE_PORT_APERCU:-4173}" >&2
		return 75
	fi
	printf 'campagne : un aperçu écoute sur le port %s sans verrou de campagne ; le build est lancé, mais il écrase son webapp/dist.\n' "${CAMPAGNE_PORT_APERCU:-4173}" >&2
	return 0
}

# Tue un processus et tous ses descendants (le plus profond d'abord, pour qu'aucun fils ne soit adopté par init avant d'être tué).
_campagne_tuer_arbre() { # <pid> [signal]
	local pid=$1 signal=${2:-TERM} fils
	for fils in $(pgrep -P "$pid" 2>/dev/null); do _campagne_tuer_arbre "$fils" "$signal"; done
	kill -"$signal" "$pid" 2>/dev/null
	return 0
}

campagne_ouvrir() { # [--nom N] [--duree-max S] -- commande…
	local nom=${CAMPAGNE_NOM:-} duree=${CAMPAGNE_DUREE_MAX:-21600} enfant code veilleur depassement
	while [ $# -gt 0 ]; do
		case "$1" in
			--nom) nom=$2; shift 2 ;;
			--duree-max) duree=${2-}; shift $(( $# > 1 ? 2 : 1 )) ;;
			--) shift; break ;;
			*) break ;;
		esac
	done
	case "$duree" in
		'' | *[!0-9]* | 0) printf 'campagne : la durée maximale doit être un entier positif de secondes, reçu « %s ».\n' "$duree" >&2; return 64 ;;
	esac
	[ $# -gt 0 ] || { printf 'usage : campagne.sh ouvrir [--nom <nom>] [--duree-max <s>] -- <commande…>\n' >&2; return 64; }
	if _campagne_traverse && [ "${CAMPAGNE_FORCER:-}" != 1 ]; then
		"$@"
		return $?
	fi
	if [ "${CAMPAGNE_FORCER:-}" = 1 ]; then
		campagne_garde ouvrir $$ || return $?
		"$@"
		return $?
	fi
	CAMPAGNE_COMMANDE="$*" campagne_garde "${nom:-ouvrir}" $$ || return $?
	local jeton=$CAMPAGNE_JETON
	depassement=$(mktemp)
	rm -f "$depassement"
	"$@" <&0 &
	enfant=$!
	# Le veilleur : à l'échéance, il pose un témoin, arrête l'arbre de la commande (TERM, puis KILL 15 s plus tard).
	( sleep "$duree"; : >"$depassement"; _campagne_tuer_arbre "$enfant" TERM; sleep 15; _campagne_tuer_arbre "$enfant" KILL ) &
	veilleur=$!
	trap 'kill -TERM "$enfant" 2>/dev/null' TERM INT
	code=0
	while kill -0 "$enfant" 2>/dev/null; do
		wait "$enfant"
		code=$?
	done
	trap - TERM INT
	pkill -P "$veilleur" 2>/dev/null
	kill "$veilleur" 2>/dev/null
	wait "$veilleur" 2>/dev/null
	if [ -e "$depassement" ]; then
		rm -f "$depassement"
		printf 'CAMPAGNE : durée maximale dépassée (%s s) — « %s » arrêtée par « %s », verrou libéré.\n' "$duree" "$nom" "$*" >&2
		code=124
	fi
	_campagne_liberer_jeton "$jeton"
	return "$code"
}

campagne_statut() {
	local dossier
	dossier=$(_campagne_dossier)
	if [ ! -d "$dossier" ]; then
		printf 'libre\n'
		return 0
	fi
	if _campagne_vivant; then
		printf 'EN COURS — %s\n' "$(_campagne_decrire)"
		return 1
	fi
	printf 'libre : un verrou mort (%s, pid %s) attend d'"'"'être repris\n' "$(_campagne_lire NOM 2>/dev/null)" "$(_campagne_lire PID 2>/dev/null)"
	return 0
}

campagne_liberer() {
	local dossier
	dossier=$(_campagne_dossier)
	[ -d "$dossier" ] || return 0
	if _campagne_vivant && [ "${1:-}" != --forcer ]; then
		printf 'campagne : le verrou est tenu par un processus vivant ; --forcer pour le retirer quand même.\n' >&2
		return 1
	fi
	rm -rf "$dossier"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
	set -uo pipefail
	commande=${1:-aide}
	[ $# -gt 0 ] && shift
	case "$commande" in
		ouvrir) campagne_ouvrir "$@"; exit $? ;;
		statut) campagne_statut; exit $? ;;
		liberer) campagne_liberer "$@"; exit $? ;;
		chemin) campagne_repertoire; exit 0 ;;
		garde-build) campagne_garde_build; exit $? ;;
		liberer-jeton) _campagne_liberer_jeton "${1:-}"; exit 0 ;;
		garde)
			nom=${1:-garde}; [ $# -gt 0 ] && shift
			pid=$$
			while [ $# -gt 0 ]; do
				case "$1" in
					--pid) pid=$2; shift 2 ;;
					--commande) CAMPAGNE_COMMANDE=$2; export CAMPAGNE_COMMANDE; shift 2 ;;
					*) shift ;;
				esac
			done
			campagne_garde "$nom" "$pid"
			code=$?
			[ "$code" = 0 ] && printf 'CAMPAGNE_JETON=%s\nCAMPAGNE_OUVERT=%s\n' "${CAMPAGNE_JETON:-}" "${CAMPAGNE_OUVERT_ICI:-0}"
			exit "$code"
			;;
		*)
			sed -n '/^# Le verrou de campagne/,/^CAMPAGNE_RACINE/p' "${BASH_SOURCE[0]}" | sed '$d;s/^# \{0,1\}//'
			exit 0
			;;
	esac
fi
