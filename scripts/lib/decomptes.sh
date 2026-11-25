# shellcheck shell=bash
# @spec INC-297 (docs/INCONSISTENCY_REPORT.md) — un harnais ne fige pas un compte que le produit dépasse : il le LIT
# @spec docs/SPEC-test-harness.md §7.2 (les compteurs dérivés, INC-125 et INC-141), §3.14 (les décomptes de `verify-session-sso.sh`)
#
# POURQUOI. `verify-session-sso.sh` exigeait « Tests 134 passed », puis 141 : à chaque test ajouté à `supabase/functions/session`, le harnais rougissait sans
# qu'aucun défaut du produit n'existe (INC-297, famille d'INC-125, INC-141 et INC-191). Le compte attendu est désormais ÉNUMÉRÉ, sans rien exécuter — la liste
# des tests de vitest, le `--list` de Playwright — puis CONFRONTÉ à ce que l'exécution rapporte : un test retiré ou sauté n'y échappe pas, un test ajouté ne
# fait plus rougir.
#
# Rend le compte sur la sortie standard ; rend 1, sans rien écrire, si l'énumération échoue ou ne trouve rien — un compte vide serait le « 0 passed » qu'un
# `grep` laisserait passer.

# Le nombre de tests unitaires d'un répertoire, par la liste de vitest. $1 : le chemin tel que `npm run test:unit` le reçoit (« ../supabase/functions/session »).
decompte_unites() {
	local n
	n=$(npx vitest list --config webapp/vitest.config.ts "$1" 2>/dev/null | grep -c '\.test\.ts > ') || true
	[ "${n:-0}" -gt 0 ] || return 1
	printf '%s\n' "$n"
}

# Le nombre de scénarios d'un fichier Playwright, par `--list`. $1 : le projet (api, ui, mail) ; $2 : le fichier.
decompte_scenarios() {
	local n
	n=$(E2E_PROJETS="$1" npx playwright test --config e2e/playwright.config.ts --project="$1" --list "$2" 2>/dev/null \
		| sed -n 's/^Total: \([0-9][0-9]*\) tests\{0,1\} in .*/\1/p') || true
	[ "${n:-0}" -gt 0 ] || return 1
	printf '%s\n' "$n"
}
