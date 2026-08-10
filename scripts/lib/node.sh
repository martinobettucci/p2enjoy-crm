#!/usr/bin/env bash
# @spec CRM-008 (docs/BACKLOG.md) — chaîne Node commune du harnais de tests
# @spec docs/SPEC-test-harness.md §7.1 ; docs/JOURNAL.md décision 278
#
# Sélectionne, pour le seul processus appelant, un couple Node/npm Linux conforme à `.nvmrc`.
# Cette bibliothèque n'exécute rien à l'inclusion.

node_toolchain_path_is_windows() {
	case "$1" in
		/mnt/[A-Za-z] | /mnt/[A-Za-z]/* | *.exe | *.cmd | *.bat) return 0 ;;
		*) return 1 ;;
	esac
}

node_toolchain_expected_major() {
	local version_file=$1 version
	[ -r "$version_file" ] || {
		printf 'ERREUR : fichier de version Node illisible : %s\n' "$version_file" >&2
		return 1
	}
	version=$(sed -n '1{s/[[:space:]]//g;p;q;}' "$version_file")
	version=${version#v}
	version=${version%%.*}
	case "$version" in
		'' | *[!0-9]*)
			printf 'ERREUR : %s doit commencer par une version majeure numérique.\n' "$version_file" >&2
			return 1
			;;
	esac
	printf '%s' "$version"
}

node_toolchain_current_is_valid() {
	local expected_major=$1 node_path npm_path node_version npm_version node_major npm_major
	node_path=$(command -v node 2>/dev/null || true)
	npm_path=$(command -v npm 2>/dev/null || true)
	[ -n "$node_path" ] && [ -n "$npm_path" ] || return 1
	node_toolchain_path_is_windows "$node_path" && return 1
	node_toolchain_path_is_windows "$npm_path" && return 1

	node_version=$(node --version 2>/dev/null || true)
	npm_version=$(npm --version 2>/dev/null || true)
	node_major=${node_version#v}
	node_major=${node_major%%.*}
	npm_major=${npm_version%%.*}
	case "$node_major:$npm_major" in
		*[!0-9:]* | :* | *:) return 1 ;;
	esac
	[ "$node_major" -eq "$expected_major" ] && [ "$npm_major" -ge 11 ] || return 1

	NODE_TOOLCHAIN_NODE_PATH=$node_path
	NODE_TOOLCHAIN_NPM_PATH=$npm_path
	NODE_TOOLCHAIN_NODE_VERSION=$node_version
	NODE_TOOLCHAIN_NPM_VERSION=$npm_version
	return 0
}

node_toolchain_prepare() {
	local version_file=$1 expected_major original_path root candidate
	local -a roots=() candidates=()
	expected_major=$(node_toolchain_expected_major "$version_file") || return 1
	original_path=$PATH

	if node_toolchain_current_is_valid "$expected_major"; then
		NODE_TOOLCHAIN_SOURCE=path
		return 0
	fi

	[ -n "${NVM_DIR:-}" ] && roots+=("$NVM_DIR")
	if [ -n "${HOME:-}" ] && [ "${NVM_DIR:-}" != "$HOME/.nvm" ]; then
		roots+=("$HOME/.nvm")
	fi

	for root in "${roots[@]}"; do
		candidates=()
		shopt -s nullglob
		candidates+=("$root"/versions/node/v"$expected_major" "$root"/versions/node/v"$expected_major".*)
		shopt -u nullglob
		[ "${#candidates[@]}" -gt 0 ] || continue
		mapfile -t candidates < <(printf '%s\n' "${candidates[@]}" | sort -Vr)
		for candidate in "${candidates[@]}"; do
			[ -d "$candidate/bin" ] || continue
			PATH="$candidate/bin:$original_path"
			export PATH
			if node_toolchain_current_is_valid "$expected_major"; then
				NODE_TOOLCHAIN_SOURCE=nvm
				return 0
			fi
		done
	done

	PATH=$original_path
	export PATH
	printf 'ERREUR : aucun couple Node %s / npm 11+ Linux n’est utilisable. Exécutez « nvm use » puis relancez.\n' \
		"$expected_major" >&2
	return 1
}
