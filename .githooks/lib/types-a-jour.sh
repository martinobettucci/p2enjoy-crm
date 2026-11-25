#!/usr/bin/env bash
# @spec INC-165 (docs/INCONSISTENCY_REPORT.md), docs/JOURNAL.md décision 992 — une migration qui livre un objet sans régénérer
#       `webapp/src/lib/database.types.ts` casse le contrat de types (la tranche 2 c de `CRM-081` l'a fait, et rien ne l'a vu)
# @spec docs/SPEC-test-harness.md §3.10 ; docs/MASTER_PLAN.md §4 (Definition of Done : les types à jour)
#
# Fournit `exiger_types_a_jour`, utilisée par le crochet `pre-push`. Pour chaque commit poussé (hors fusions), si une migration
# de `supabase/migrations/` est AJOUTÉE ou MODIFIÉE, alors `webapp/src/lib/database.types.ts` l'est AUSSI dans le MÊME commit,
# sauf si chaque migration touchée par ce commit porte le marqueur « sans effet de types » (un commentaire de la migration,
# qui dit pourquoi : une fonction interne, une donnée, un index). C'est une heuristique SANS PILE — le contrôle exact reste
# `npm run types:check`, qui exige la base — : elle n'attrape pas une régénération oubliée dans un commit qui touche les types
# pour une autre raison, mais elle attrape le cas mesuré, celui de la migration poussée seule.
#
# Un commit qui ne fait que SUPPRIMER une migration n'est pas jugé (filtre A et M).

TYPES_FICHIER="webapp/src/lib/database.types.ts"
MARQUEUR_SANS_TYPES="sans effet de types"

exiger_types_a_jour() {
	local sha_local="$1" sha_distant="$2" zero commits commit migrations fichiers migration non_marquees refus=0
	zero=0000000000000000000000000000000000000000
	[ "$sha_local" != "$zero" ] || return 0
	if [ "$sha_distant" = "$zero" ]; then
		commits=$(git rev-list --no-merges "$sha_local" --not --remotes 2>/dev/null || true)
	else
		commits=$(git rev-list --no-merges "$sha_local" --not "$sha_distant" 2>/dev/null || true)
	fi
	for commit in $commits; do
		fichiers=$(git diff-tree --root -r --no-commit-id --name-only --diff-filter=AM "$commit")
		migrations=$(printf '%s\n' "$fichiers" | grep -E '^supabase/migrations/[^/]+\.sql$' || true)
		[ -n "$migrations" ] || continue
		printf '%s\n' "$fichiers" | grep -qxF "$TYPES_FICHIER" && continue
		non_marquees=""
		while IFS= read -r migration; do
			git show "$commit:$migration" | grep -qi "$MARQUEUR_SANS_TYPES" || non_marquees="$non_marquees $migration"
		done <<< "$migrations"
		[ -n "$non_marquees" ] || continue
		refus=1
		{
			echo "refus : le commit $(git rev-parse --short "$commit") modifie une migration sans modifier $TYPES_FICHIER :"
			for migration in $non_marquees; do echo "          $migration"; done
		} >&2
	done
	if [ "$refus" -eq 1 ]; then
		{
			echo "        INC-165, décision 992 : une migration qui livre un objet ne se pousse pas sans le contrat de types régénéré,"
			echo "        dans le MÊME commit (docs/MASTER_PLAN.md §4). Deux remèdes :"
			echo "          npm run types:generate   puis   git add $TYPES_FICHIER   et   git commit --amend"
			echo "          ou, si la migration n'a aucun effet sur les types (fonction interne, donnée, index), la dire dans la migration :"
			echo "          -- $MARQUEUR_SANS_TYPES : <motif>"
		} >&2
		return 1
	fi
	return 0
}
