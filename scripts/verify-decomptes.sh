#!/usr/bin/env bash
# @verifies INC-297 (docs/INCONSISTENCY_REPORT.md) — les comptes de `verify-session-sso.sh` sont DÉRIVÉS (énumérés, puis confrontés à l'exécution), jamais figés
# @verifies docs/SPEC-test-harness.md §3.14, §7.2 ; docs/BACKLOG.md « Correctif — INC-297 »
#
# Sans pile : il ne joue que des tests unitaires et des listes. Il dépose un fichier de test jetable dans `supabase/functions/session` — le test qui AJOUTE un
# test, c'est-à-dire la dérive même d'INC-297 — et le retire dans un `trap`.
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1
# shellcheck source=scripts/lib/decomptes.sh
source scripts/lib/decomptes.sh

REPERTOIRE=supabase/functions/session
JETABLE=$REPERTOIRE/zz-decompte-297.test.ts
TRAVAIL=$(mktemp -d)
controles=0
anomalies=0
ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

nettoyer() {
	local statut=$?
	trap - EXIT
	rm -f -- "$JETABLE"
	scripts/lib/campagne.sh liberer >/dev/null 2>&1 || true
	rm -rf -- "$TRAVAIL"
	exit "$statut"
}
trap nettoyer EXIT

executes() {
	npm run --silent test:unit -- "../$REPERTOIRE" 2>&1 | sed -n 's/^ *Tests  *\([0-9][0-9]*\) passed.*/\1/p'
}

echo
echo "Preuves d'INC-297 — des comptes dérivés, jamais figés"
echo

echo "1. Les tests unitaires de $REPERTOIRE"
enumeres=$(decompte_unites "../$REPERTOIRE") || enumeres=''
rapportes=$(executes)
if [ -n "$enumeres" ] && [ "$enumeres" = "$rapportes" ]; then
	ok "le compte énuméré ($enumeres) est celui que l'exécution rapporte"
else
	fail "énumérés : '${enumeres:-rien}' ; rapportés par l'exécution : '${rapportes:-rien}'"
fi

cat > "$JETABLE" <<'TS'
// Fichier JETABLE de `scripts/verify-decomptes.sh` (INC-297) : un test de plus, comme `CRM-114` T3 en avait ajouté un fichier entier.
import { expect, it } from 'vitest'
it('un test de plus', () => expect(1).toBe(1))
TS
enumeres_plus=$(decompte_unites "../$REPERTOIRE") || enumeres_plus=''
rapportes_plus=$(executes)
rm -f -- "$JETABLE"
if [ -n "$enumeres" ] && [ "$enumeres_plus" = "$((enumeres + 1))" ] && [ "$rapportes_plus" = "$enumeres_plus" ]; then
	ok "un test ajouté ($enumeres → $enumeres_plus) : le compte suit, un compte figé aurait rougi"
else
	fail "après l'ajout d'un test : énumérés '${enumeres_plus:-rien}', rapportés '${rapportes_plus:-rien}', attendus '$((enumeres + 1))'"
fi

if decompte_unites ../supabase/functions/inexistant >/dev/null 2>&1; then
	fail "un répertoire sans test rend un compte au lieu d'échouer"
else
	ok "un répertoire sans test échoue : un compte vide n'est pas un « 0 passed »"
fi

echo
echo "2. Les scénarios de e2e/api/session.spec.ts"
scenarios=$(decompte_scenarios api e2e/api/session.spec.ts) || scenarios=''
if [ -n "$scenarios" ] && [ "$scenarios" -gt 0 ]; then
	ok "$scenarios scénarios énumérés par --list"
else
	fail "le décompte des scénarios n'a pas pu être énuméré"
fi
if decompte_scenarios api e2e/api/inexistant.spec.ts >/dev/null 2>&1; then
	fail "un fichier de scénarios inexistant rend un compte"
else
	ok "un fichier de scénarios inexistant échoue"
fi

# Une campagne vivante tient le verrou : l'énumération — qui n'exécute rien — ne doit pas en être refusée (INC-177, INC-297).
CAMPAGNE_ATTENDRE=0 scripts/lib/campagne.sh ouvrir --nom essai-decomptes -- sleep 30 >"$TRAVAIL/campagne.log" 2>&1 &
campagne=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
	scripts/lib/campagne.sh statut >/dev/null 2>&1 || break
	sleep 0.5
done
sous_verrou=$(decompte_scenarios api e2e/api/session.spec.ts) || sous_verrou=''
kill "$campagne" 2>/dev/null || true
wait "$campagne" 2>/dev/null || true
if [ -n "$sous_verrou" ] && [ "$sous_verrou" = "$scenarios" ]; then
	ok "l'énumération passe sous le verrou d'une campagne vivante (--list n'exécute rien)"
else
	fail "sous un verrou vivant, l'énumération rend '${sous_verrou:-rien}' au lieu de '$scenarios'"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
