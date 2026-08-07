#!/usr/bin/env bash
# @verifies CRM-008 (docs/BACKLOG.md) — sélection fiable de Node avant le harnais
# @verifies docs/SPEC-test-harness.md §7.1 ; docs/JOURNAL.md décisions 278 et 281 ; INC-083
#
# Éprouve le résolveur Node dans des environnements isolés et jetables. Aucune pile n'est requise.

set -uo pipefail

REPO_ROOT=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=scripts/lib/node.sh
source "$REPO_ROOT/scripts/lib/node.sh"

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

checks=0
failures=0
ok() { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

make_toolchain() {
	local bin_dir=$1 node_version=$2 npm_version=$3
	mkdir -p "$bin_dir"
	printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' "$node_version" > "$bin_dir/node"
	printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' "$npm_version" > "$bin_dir/npm"
	chmod +x "$bin_dir/node" "$bin_dir/npm"
}

echo
echo "Preuves de la chaîne Node — CRM-008"
echo

if node_toolchain_path_is_windows '/mnt/c/Program Files/nodejs/npm' \
	&& ! node_toolchain_path_is_windows '/usr/local/bin/npm'; then
	ok "un outil sous /mnt/<lecteur>/ est Windows ; un chemin Linux ne l'est pas"
else
	fail "la distinction entre les chemins Windows hérités par WSL et les chemins Linux est fausse"
fi

make_toolchain "$WORK/current/bin" v24.2.0 11.1.0
make_toolchain "$WORK/nvm-conforme/versions/node/v24.9.0/bin" v24.9.0 11.2.0
if (
	PATH="$WORK/current/bin:/usr/bin:/bin"
	NVM_DIR="$WORK/nvm-conforme"
	HOME="$WORK/home-conforme"
	export PATH NVM_DIR HOME
	node_toolchain_prepare "$REPO_ROOT/.nvmrc" \
		&& [ "$NODE_TOOLCHAIN_SOURCE" = path ] \
		&& [ "$(command -v node)" = "$WORK/current/bin/node" ]
); then
	ok "un couple déjà conforme dans le PATH est conservé"
else
	fail "le résolveur remplace ou refuse un couple déjà conforme"
fi

make_toolchain "$WORK/wrong/bin" v23.9.0 11.0.0
make_toolchain "$WORK/nvm-repli/versions/node/v24.9.0/bin" v24.9.0 10.9.0
make_toolchain "$WORK/nvm-repli/versions/node/v24.8.0/bin" v24.8.0 11.3.0
if (
	PATH="$WORK/wrong/bin:/usr/bin:/bin"
	NVM_DIR="$WORK/nvm-repli"
	HOME="$WORK/home-repli"
	export PATH NVM_DIR HOME
	node_toolchain_prepare "$REPO_ROOT/.nvmrc" \
		&& [ "$NODE_TOOLCHAIN_SOURCE" = nvm ] \
		&& [ "$(command -v node)" = "$WORK/nvm-repli/versions/node/v24.8.0/bin/node" ]
); then
	ok "le repli NVM écarte Node 23 et npm 10, puis sélectionne Node 24 / npm 11"
else
	fail "le repli NVM n'a pas sélectionné le premier couple réellement compatible"
fi

make_toolchain "$WORK/absent/bin" v23.0.0 10.0.0
if (
	PATH="$WORK/absent/bin:/usr/bin:/bin"
	NVM_DIR="$WORK/nvm-absent"
	HOME="$WORK/home-absent"
	export PATH NVM_DIR HOME
	! node_toolchain_prepare "$REPO_ROOT/.nvmrc" 2>"$WORK/absent.log"
) && grep -q 'nvm use' "$WORK/absent.log"; then
	ok "l'absence de couple compatible échoue avec l'action explicite « nvm use »"
else
	fail "l'absence de chaîne compatible n'est pas refusée clairement"
fi

harnais_node=0
harnais_non_proteges=()
while IFS= read -r script; do
	premier_appel=$(awk '
		/^[[:space:]]*(if[[:space:]]+)?(![[:space:]]+)?(npm|node)[[:space:]]/ {
			print NR
			exit
		}
	' "$script")
	[ -n "$premier_appel" ] || continue
	harnais_node=$((harnais_node + 1))
	source_node=$(grep -n -m1 '^source scripts/lib/node\.sh$' "$script" | cut -d: -f1 || true)
	preparation=$(grep -n -m1 -E '^(if )?node_toolchain_prepare "\$PWD/\.nvmrc"' "$script" | cut -d: -f1 || true)
	if [ -z "$source_node" ] || [ -z "$preparation" ] \
		|| [ "$source_node" -ge "$preparation" ] || [ "$preparation" -ge "$premier_appel" ]; then
		harnais_non_proteges+=("$script")
	fi
done < <(find "$REPO_ROOT/scripts" -maxdepth 1 -type f -name 'verify-*.sh' -print | sort)

if [ "$harnais_node" -gt 0 ] && [ "${#harnais_non_proteges[@]}" -eq 0 ]; then
	ok "les $harnais_node harnais qui invoquent Node ou npm préparent tous la chaîne Linux"
else
	fail "harnais Node/npm sans garde préalable : ${harnais_non_proteges[*]:-aucun harnais découvert}"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n\n' "$checks" "$failures"
exit 1
