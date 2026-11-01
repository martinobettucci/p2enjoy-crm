#!/usr/bin/env bash
# @verifies CRM-121 (docs/BACKLOG.md) — tranche T1 : Dependabot surveille npm et les dépendances Python
# @verifies docs/JOURNAL.md décision 763 ; docs/DAT.md (dépendances) ; README.md (harnais)
#
# Rejoue les preuves de `CRM-121` qui ne demandent ni GitHub ni Docker :
#
#   1. `.github/dependabot.yml` déclare exactement npm à la racine, pip pour `mcp/` et pour `mail-sync/`, chacun avec
#      une cadence ;
#   2. chaque répertoire déclaré porte les manifestes que Dependabot lit, et les verrous Python sont épinglés (`==`) ;
#   3. plus aucune référence vivante aux anciens noms `requirements*.lock` : ni fichier, ni `Dockerfile`, ni script ;
#   4. non-complaisance : une configuration amputée de `mail-sync`, et un `Dockerfile` qui revient à l'ancien nom, sont
#      dénoncés.
#
# L'image `mcp` reconstruite à l'identique (même `pip freeze`) et le graphe de dépendances de GitHub sont des preuves
# ponctuelles de la tranche, consignées au backlog : elles demandent Docker et le dépôt distant.
#
# Usage :
#   scripts/verify-dependabot.sh

set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO_ROOT"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

failures=0
checks=0
ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

# La configuration lue comme Dependabot la lit : la liste des couples (écosystème, répertoire), avec ou sans cadence.
#   couples <fichier>
couples() {
	python3 - "$1" <<'PY'
import sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
if d.get("version") != 2:
    print("version", d.get("version"))
for u in d.get("updates", []):
    cadence = (u.get("schedule") or {}).get("interval") or "sans-cadence"
    print(u.get("package-ecosystem"), u.get("directory"), cadence)
PY
}
ATTENDU=$'npm / weekly\npip /mcp weekly\npip /mail-sync weekly'

# Les références vivantes aux anciens noms : fichiers, recettes et scripts, jamais l'historique documentaire.
#   references_anciennes <racine>
references_anciennes() {
	local racine=$1
	find "$racine/mcp" "$racine/mail-sync" -maxdepth 1 -name 'requirements*.lock' -printf 'fichier %P\n' 2>/dev/null
	grep -n 'requirements[-a-z]*\.lock' "$racine"/mcp/Dockerfile "$racine"/mail-sync/Dockerfile "$racine"/scripts/*.sh \
		"$racine"/docker-compose*.yml 2>/dev/null | grep -v '^.*verify-dependabot\.sh:'
}

echo "1. La configuration"
if [ -f .github/dependabot.yml ] && sortie=$(couples .github/dependabot.yml 2>&1); then
	[ "$sortie" = "$ATTENDU" ] && ok "npm à la racine, pip pour mcp/ et mail-sync/, chacun chaque semaine" \
		|| fail "couples déclarés : $(printf '%s' "$sortie" | tr '\n' ';')"
else
	fail ".github/dependabot.yml absent ou illisible : ${sortie:-}"
fi

echo
echo "2. Les manifestes"
[ -f package.json ] && [ -f package-lock.json ] && ok "npm : package.json et package-lock.json à la racine" \
	|| fail "npm : manifeste ou verrou absent à la racine"
for dir in mcp mail-sync; do
	if [ -f "$dir/requirements.txt" ] && [ -f "$dir/requirements-dev.txt" ]; then
		non_epinglees=$(grep -hvE '^\s*(#|$|-r )' "$dir/requirements.txt" "$dir/requirements-dev.txt" | grep -v '==' || true)
		[ -z "$non_epinglees" ] && ok "$dir : requirements.txt et requirements-dev.txt, toutes les lignes épinglées" \
			|| fail "$dir : lignes non épinglées — $(printf '%s' "$non_epinglees" | head -n 3 | tr '\n' ';')"
	else
		fail "$dir : requirements.txt ou requirements-dev.txt absent"
	fi
done

echo
echo "3. Les anciens noms"
restes=$(references_anciennes "$REPO_ROOT")
[ -z "$restes" ] && ok "aucun requirements*.lock, ni fichier ni référence dans les recettes et les scripts" \
	|| fail "références restantes : $(printf '%s' "$restes" | head -n 3 | tr '\n' ';')"

echo
echo "4. Non-complaisance"
python3 - .github/dependabot.yml "$WORK/amputee.yml" <<'PY'
import sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
d["updates"] = [u for u in d["updates"] if u.get("directory") != "/mail-sync"]
yaml.safe_dump(d, open(sys.argv[2], "w"))
PY
[ "$(couples "$WORK/amputee.yml" 2>/dev/null)" != "$ATTENDU" ] && ok "dénoncée : une configuration sans mail-sync" \
	|| fail "non dénoncée : une configuration sans mail-sync"
mkdir -p "$WORK/racine/mcp" "$WORK/racine/mail-sync" "$WORK/racine/scripts"
sed 's/requirements\.txt/requirements.lock/' mcp/Dockerfile > "$WORK/racine/mcp/Dockerfile"
[ -n "$(references_anciennes "$WORK/racine")" ] && ok "dénoncé : un Dockerfile qui revient à requirements.lock" \
	|| fail "non dénoncé : un Dockerfile qui revient à requirements.lock"

echo
if [ "$failures" -eq 0 ]; then
	echo "Bilan : $checks vérifications, aucune anomalie."
	exit 0
fi
echo "Bilan : $checks vérifications, $failures anomalie(s)." >&2
exit 1
