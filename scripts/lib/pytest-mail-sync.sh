#!/usr/bin/env bash
# @spec CRM-127 (docs/BACKLOG.md) — tranche T2 : rejouer `scripts/verify-mail-inbound.sh` en entier, pytest compris
# @spec CRM-132 (docs/BACKLOG.md) — les six autres harnais de la messagerie l'emploient : une cible (un fichier de tests),
#       et le jugement d'une dégradation sur le seul code 1 (INC-345, décision 867)
# @spec docs/SPEC-mail-subsystem.md §12.6 (la preuve Python de mail-sync), §23.7 (pytest) ; README §7 (la preuve Python) ;
#       docs/JOURNAL.md décisions 847 et 867 ; CLAUDE.md §18 (aucune simulation de succès)
#
# Joue `pytest` sur `mail-sync/tests`, ou sur une cible de ce dossier, là où il peut l'être, dans cet ordre :
#   1. le `.venv` de la racine ;
#   2. un `python3` de l'hôte muni de pytest ;
#   3. sinon un conteneur JETABLE, tiré de l'image de base de `mail-sync/Dockerfile`, qui installe
#      `mail-sync/requirements-dev.txt` puis joue la suite sur l'arbre monté en lecture seule. Un hôte sans `pip` ni
#      `venv` (mesuré le 2026-11-05 : Python 3.14 sans `ensurepip`) faisait échouer pytest par « No module named
#      pytest », et une DÉGRADATION se déclarait alors « vue » sans qu'aucun test ne l'ait vue.
#
# Le code de sortie est celui de pytest : 0 vert, 1 des tests ÉCHOUENT, 2 à 5 la suite n'a pas tourné normalement.
# Une installation impossible dans le conteneur rend 125, jamais 1 : qui veut constater qu'une dégradation fait
# échouer des tests exige le code 1, et seulement lui.
#
# Chargée par les harnais ; elle n'exécute rien à l'inclusion.

# pytest_mail_sync [arguments pytest…] — toute la suite `mail-sync/tests`.
pytest_mail_sync() {
	pytest_mail_sync_cible tests "$@"
}

# pytest_mail_sync_cible <cible> [arguments pytest…] — la cible est relative à `mail-sync/` : `tests`, ou un fichier
# comme `tests/test_backoff.py`. Un harnais qui la tient d'une variable écrite depuis la racine (`mail-sync/tests/…`) la
# passe telle quelle : le préfixe `mail-sync/` est retiré.
pytest_mail_sync_cible() {
	local racine image cible=${1#mail-sync/}
	shift
	racine=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
	if [ ! -e "$racine/mail-sync/$cible" ]; then
		echo "pytest_mail_sync : cible introuvable, mail-sync/$cible." >&2
		return 4
	fi
	if [ -x "$racine/.venv/bin/python" ]; then
		"$racine/.venv/bin/python" -m pytest "$racine/mail-sync/$cible" "$@"
		return
	fi
	if python3 -c 'import pytest' >/dev/null 2>&1; then
		python3 -m pytest "$racine/mail-sync/$cible" "$@"
		return
	fi
	image=$(sed -n 's/^FROM[[:space:]]\{1,\}\([^[:space:]]*\).*/\1/p' "$racine/mail-sync/Dockerfile" | head -n 1)
	if [ -z "$image" ]; then
		echo "pytest_mail_sync : aucune image de base lisible dans mail-sync/Dockerfile." >&2
		return 125
	fi
	docker run --rm -v "$racine/mail-sync:/src:ro" -w /src \
		-e PYTHONDONTWRITEBYTECODE=1 -e PYTHONPATH=/src/src -e PIP_DISABLE_PIP_VERSION_CHECK=1 \
		"$image" sh -c '
			pip install -q --root-user-action=ignore -r requirements-dev.txt >/tmp/pip.log 2>&1 \
				|| { echo "pytest_mail_sync : installation de requirements-dev.txt impossible" >&2; tail -n 5 /tmp/pip.log >&2; exit 125; }
			cible=$1; shift
			exec python -m pytest "$cible" -p no:cacheprovider "$@"' pytest_mail_sync "$cible" "$@"
}

# juger_degradation_py <journal> <cible> [arguments pytest…] — joue la cible sur un code DÉGRADÉ et rend :
#   0 « vue » : des tests ont échoué (code 1 de pytest, et lui seul) ;
#   1 « non vue » : la suite est verte malgré la dégradation ;
#   2 « non prouvée » : pytest n'a pas tourné normalement (2 à 5, 125…), le journal dit pourquoi.
# Le harnais traduit ces trois issues en ses propres `ok` et `fail` : seule la première est un succès.
juger_degradation_py() {
	local journal=$1 code=0
	shift
	pytest_mail_sync_cible "$@" >"$journal" 2>&1 || code=$?
	case $code in
		1) return 0 ;;
		0) return 1 ;;
		*) echo "pytest n'a pas tourné normalement (code $code)" >>"$journal"; return 2 ;;
	esac
}
