#!/usr/bin/env bash
# @spec CRM-127 (docs/BACKLOG.md) — tranche T2 : rejouer `scripts/verify-mail-inbound.sh` en entier, pytest compris
# @spec docs/SPEC-mail-subsystem.md §12.6 (la preuve Python de mail-sync), §23.7 (pytest) ; README §7 (le `.venv`) ;
#       docs/JOURNAL.md décision 847 ; CLAUDE.md §18 (aucune simulation de succès)
#
# Joue `pytest mail-sync/tests` là où il peut l'être, dans cet ordre :
#   1. le `.venv` de la racine, que le README §7 documente ;
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

pytest_mail_sync() {
	local racine image
	racine=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
	if [ -x "$racine/.venv/bin/python" ]; then
		"$racine/.venv/bin/python" -m pytest "$racine/mail-sync/tests" "$@"
		return
	fi
	if python3 -c 'import pytest' >/dev/null 2>&1; then
		python3 -m pytest "$racine/mail-sync/tests" "$@"
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
			exec python -m pytest tests -p no:cacheprovider "$@"' pytest_mail_sync "$@"
}
