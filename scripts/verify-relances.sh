#!/usr/bin/env bash
# @verifies CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHE 1
# @verifies docs/SPEC-relances.md §2.2 (seuil effectif), §2.3 (les nœuds terminaux ne sont pas
#           nommés), §2.4 (les trois exclusions), §2.5 (la borne), §3.2 (forme de la fonction),
#           §3.3 (ACL, et `anon` révoqué NOMMÉMENT), §3.4 (l'ordre), §5 (le seed), §6 (les preuves)
# @verifies docs/SCHEMA.md §9 bis.9 ; docs/PROD_MIGRATIONS.md §3 (migration 53)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de l'unité, puis DÉGRADE RÉELLEMENT la fonction — une dégradation
# par règle qu'elle porte — et exige que la preuve concernée rougisse. Aucun état dégradé ne
# subsiste, même en cas d'échec : la migration est rejouée par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien
# tant qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et
# vérifie que la suite pgTAP la dénonce ; une dégradation qui laisserait la suite verte est un trou
# dans la preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0053_cards_figees.sql
SUITE_SQL=supabase/tests/0051_cards_figees.test.sql
SPEC=docs/SPEC-relances.md
MODULE_TS=webapp/src/lib/carte-figee.ts
SUITE_TS=webapp/src/lib/carte-figee.test.ts
SUITE_API=e2e/api/relances.spec.ts
CARD_FIGEE=5eed0000-0000-4000-8000-0000000000c3

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_due" = true ]; then
		if ! psql_db -f - < "$MIGRATION" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours de la migration 53 a échoué.\n' >&2
			statut=1
		fi
	fi
	rm -rf -- "$TRAVAIL"
	exit "$statut"
}
trap nettoyer EXIT

ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

# La suite pgTAP de l'unité, rendue vraie ou fausse. Les dégradations s'en servent : une règle
# retirée DOIT la faire rougir.
suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

# Remplace le corps de la fonction dans une copie de la migration, puis l'applique. Le motif est
# comparé AVANT et APRÈS : une substitution qui ne substituerait rien laisserait la suite verte et
# le harnais conclurait à tort à la complaisance — c'est le défaut trouvé à `CRM-061` (décision 503),
# et il ne se refait pas.
degrader() {
	local avant=$1 apres=$2 nom=$3
	python3 - "$MIGRATION" "$TRAVAIL/degrade.sql" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	if ! cmp -s "$MIGRATION" "$TRAVAIL/degrade.sql"; then
		restauration_due=true
		psql_db -f - < "$TRAVAIL/degrade.sql" >/dev/null 2>&1
		return 0
	fi
	fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
	return 1
}

restaurer() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
	restauration_due=false
}

# Une dégradation complète : substituer, exiger le rouge, restaurer, exiger le vert.
eprouver_degradation() {
	local nom=$1 avant=$2 apres=$3
	degrader "$avant" "$apres" "$nom" || return 0
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer
}

echo
echo "Preuves de CRM-062 tranche 1 — les affaires figées"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

# =================================================================================================
echo "1. Traçabilité : aucun fichier de l'unité n'est orphelin de sa spécification"
# =================================================================================================
# `CLAUDE.md` §5 : chaque fichier porte ses commentaires `@spec` / `@verifies` vers l'unité de
# backlog ET les chapitres. Le contrôle est mécanique, sur les six fichiers de la tranche.

for fichier in "$MIGRATION" "$MODULE_TS"; do
	if head -n 12 "$fichier" | grep -q '@spec CRM-062' \
		&& head -n 12 "$fichier" | grep -q 'docs/SPEC-relances.md'; then
		ok "traçabilité : $fichier cite CRM-062 et sa spécification"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @spec complet"
	fi
done

for fichier in "$SUITE_SQL" "$SUITE_TS" "$SUITE_API"; do
	if head -n 14 "$fichier" | grep -q '@verifies CRM-062' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-relances.md'; then
		ok "traçabilité : $fichier cite CRM-062 et sa spécification en @verifies"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @verifies complet"
	fi
done

if [ -f "$SPEC" ] && grep -q '^### 2.4 Les trois exclusions' "$SPEC" \
	&& grep -q '^## 4. Contrat d' "$SPEC" \
	&& grep -q '^### 3.3 Autorisations' "$SPEC"; then
	ok "la spécification existe et porte les chapitres que les fichiers citent"
else
	fail "docs/SPEC-relances.md absent ou amputé d'un chapitre cité"
fi

# =================================================================================================
echo
echo "2. Forme de la fonction dans le catalogue, et son ACL — mesurées, pas relues dans le SQL"
# =================================================================================================
# `security invoker` est le DÉFAUT et ne s'écrit donc pas : lire le fichier ne dirait rien. Seul le
# catalogue le dit.

forme=$(psql_db -F '|' -c "select p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '')
	from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'cards_figees';")
if [ "$forme" = 'f|s|search_path=""' ]; then
	ok "public.cards_figees() : SECURITY INVOKER, STABLE, search_path vide"
else
	fail "forme inattendue de public.cards_figees() : '$forme' au lieu de 'f|s|search_path=\"\"'"
fi

acl=$(psql_db -F '|' -c "select has_function_privilege('anon','public.cards_figees()','execute'),
	has_function_privilege('authenticated','public.cards_figees()','execute'),
	has_function_privilege('service_role','public.cards_figees()','execute');")
if [ "$acl" = 'f|t|t' ]; then
	ok "ACL : anon SANS execute, authenticated et service_role avec"
else
	fail "ACL inattendue : '$acl' au lieu de 'f|t|t' — pg_default_acl accorde anon à la création"
fi

if [ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'cards_figees';")" = 1 ]; then
	ok "une seule surcharge de public.cards_figees() : un rejeu n'en crée pas de seconde"
else
	fail "plusieurs surcharges de public.cards_figees() — un rejeu a divergé"
fi

# =================================================================================================
echo
echo "3. Le contrat du seed, mesuré EN BASE avec les prédicats exacts de la fonction"
# =================================================================================================
# `docs/SPEC-relances.md` §5. La mesure passe par la fonction elle-même sous `service_role`, qui
# traverse la RLS : ce que le harnais vérifie ici, c'est la RÈGLE, pas le cloisonnement — celui-ci
# est mesuré par la suite pgTAP et par la preuve d'API sous les trois jetons réels.

contrat=$(psql_db -F '|' -c "select count(*), min(f.card_id::text), min(f.seuil_jours), min(f.jours_dans_etape) >= 30
	from public.cards_figees() f;")
if [ "$contrat" = "1|$CARD_FIGEE|14|t" ]; then
	ok "seed : exactement une affaire figée, « Audit sécurité applicative », seuil 14, ≥ 30 jours"
else
	fail "contrat du seed inattendu : '$contrat'"
fi

if [ "$(psql_db -c "select count(*) from public.cards_figees() f
	join public.cards c on c.id = f.card_id
	where c.archived_at is not null or c.deleted_at is not null;")" = 0 ]; then
	ok "aucune affaire archivée ni en corbeille n'est rendue"
else
	fail "une affaire rangée est rendue comme figée"
fi

if [ "$(psql_db -c "select count(*) from public.cards_figees() f
	join public.cards c on c.id = f.card_id
	where c.snoozed_until > now();")" = 0 ]; then
	ok "aucune affaire encore endormie n'est rendue"
else
	fail "une affaire en sommeil est rendue comme figée"
fi

if [ "$(psql_db -c "select count(*) from public.cards_figees() f where f.retard_jours < 0;")" = 0 ]; then
	ok "retard_jours n'est jamais négatif"
else
	fail "une ligne porte un retard négatif : la borne ne s'applique pas"
fi

# LE CONTRASTE EST MESURÉ, PAS SUPPOSÉ : sans au moins une affaire EN DEÇÀ de son seuil, « exactement
# une au-delà » serait vrai sur un pipeline entièrement frais comme sur un seuil mal choisi.
if [ "$(psql_db -c "select count(*) from public.cards c
	join public.workflow_steps ws on ws.id = c.current_step_id
	join public.workflow_nodes_catalog n on n.id = ws.node_id
	where c.archived_at is null and c.deleted_at is null
	  and coalesce(ws.stale_after_days, n.default_stale_after_days) is not null
	  and floor(extract(epoch from (now() - c.entered_step_at)) / 86400.0)
	      < coalesce(ws.stale_after_days, n.default_stale_after_days);")" -ge 1 ]; then
	ok "le contraste existe : au moins une affaire porte un seuil et reste en deçà"
else
	fail "aucune affaire en deçà de son seuil : « au-delà » ne contraste avec rien"
fi

# =================================================================================================
echo
echo "4. La règle n'a qu'UNE déclaration côté TypeScript"
# =================================================================================================
# `docs/SPEC-relances.md` §2.1. Si `board.ts` recalculait le seuil ou la borne pour son compte, les
# deux moitiés du produit pourraient diverger sans que rien ne le dise.

if grep -q "from './carte-figee'" webapp/src/lib/board.ts; then
	ok "board.ts importe la règle plutôt que de la redéclarer"
else
	fail "board.ts ne passe plus par carte-figee.ts : la règle a deux déclarations"
fi

if ! grep -qE 'jours >= seuilJours|stale_after_days \?\? .*default_stale_after_days' webapp/src/lib/board.ts; then
	ok "board.ts ne porte plus ni la borne ni la résolution du seuil en propre"
else
	fail "board.ts a repris la borne ou la résolution du seuil : la règle a divergé"
fi

if grep -q "webapp/src/lib/carte-figee" "$SUITE_API"; then
	ok "la preuve d'API importe la règle du produit, elle ne la recopie pas"
else
	fail "la preuve d'API ne lit plus carte-figee.ts : sa cohérence ne prouve plus rien"
fi

if grep -qE "^import .* from '\./" "$MODULE_TS"; then
	fail "carte-figee.ts a gagné une importation : il redevient inatteignable depuis e2e/"
else
	ok "carte-figee.ts n'importe rien — la condition de son atteignabilité des deux côtés"
fi

# =================================================================================================
echo
echo "5. Les quatre suites de preuves de l'unité"
# =================================================================================================

if suite_sql_verte && grep -q '1 fichiers, 24 assertions, aucune anomalie' "$TRAVAIL/tap.log"; then
	ok "pgTAP : 24 assertions, aucune anomalie"
else
	fail "suite pgTAP en échec ou compte inattendu"
	sed 's/^/        /' "$TRAVAIL/tap.log" | tail -n 25
fi

# LES DEUX SUITES NODE PASSENT PAR `scripts/lib/node.sh`, comme les trente et un harnais qui en
# dépendent : sans Node 24, elles refuseraient de s'exécuter à leur première ligne.
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

if npm run --silent test:unit -- "$SUITE_TS" >"$TRAVAIL/unit.log" 2>&1 \
	&& grep -qE 'Tests +12 passed' "$TRAVAIL/unit.log"; then
	ok "unitaire : 12 assertions sur la règle extraite"
else
	fail "suite unitaire de carte-figee.ts en échec ou compte inattendu"
	sed 's/^/        /' "$TRAVAIL/unit.log" | tail -n 20
fi

if npm run --silent e2e:api -- "$SUITE_API" >"$TRAVAIL/api.log" 2>&1 \
	&& grep -qE '13 passed' "$TRAVAIL/api.log"; then
	ok "API : 13 scénarios verts, les dix lignes du contrat et les deux cohérences"
else
	fail "suite d'API en échec ou compte inattendu"
	sed 's/^/        /' "$TRAVAIL/api.log" | tail -n 25
fi

if npm run --silent typecheck >"$TRAVAIL/tsc.log" 2>&1; then
	ok "npm run typecheck vert sur les quatre projets"
else
	fail "npm run typecheck échoue"
	sed 's/^/        /' "$TRAVAIL/tsc.log" | tail -n 20
fi

# =================================================================================================
echo
echo "6. Non-complaisance : sept dégradations réelles, une par règle portée"
# =================================================================================================
# Chacune retire UNE règle du produit et exige que la suite pgTAP la dénonce. La restauration est
# CONSTATÉE en fin de section, jamais supposée.

eprouver_degradation "exclusion des archivées" \
	"	 where c.archived_at is null
	   and c.deleted_at is null" \
	"	 where c.deleted_at is null"

eprouver_degradation "exclusion de la corbeille" \
	"	   and c.deleted_at is null
" \
	"	   and true
"

eprouver_degradation "exclusion du sommeil" \
	"	   and (c.snoozed_until is null or c.snoozed_until <= now())" \
	"	   and true"

eprouver_degradation "le sommeil ÉCHU protégerait encore" \
	"	   and (c.snoozed_until is null or c.snoozed_until <= now())" \
	"	   and c.snoozed_until is null"

eprouver_degradation "borne stricte au lieu de large" \
	"	       >= coalesce(ws.stale_after_days, n.default_stale_after_days)" \
	"	       > coalesce(ws.stale_after_days, n.default_stale_after_days)"

eprouver_degradation "seuil du nœud passant AVANT celui de l'étape" \
	"	       coalesce(ws.stale_after_days, n.default_stale_after_days),
	       -- JOURS RÉVOLUS" \
	"	       coalesce(n.default_stale_after_days, ws.stale_after_days),
	       -- JOURS RÉVOLUS"

eprouver_degradation "ordre par titre seul, le retard perdu" \
	"	 order by 10 desc, c.title;" \
	"	 order by c.title;"

# LA DÉGRADATION DE L'ACL EST À PART : elle ne passe pas par le corps de la fonction, et c'est
# précisément le défaut que la première écriture de la migration portait.
psql_db -c "grant execute on function public.cards_figees() to anon;" >/dev/null 2>&1
restauration_due=true
if [ "$(psql_db -c "select has_function_privilege('anon','public.cards_figees()','execute');")" = t ]; then
	ok "dégradation « execute rendu à anon » : elle est effective, pas seulement demandée"
else
	fail "impossible de rouvrir execute à anon pour la contre-épreuve"
fi
if suite_sql_verte; then
	fail "COMPLAISANT — execute rendu à anon, la suite pgTAP reste VERTE"
else
	ok "dégradation « execute rendu à anon » : la suite pgTAP rougit, comme elle doit"
fi
restaurer

# =================================================================================================
echo
echo "7. Restauration CONSTATÉE, jamais supposée"
# =================================================================================================

forme_finale=$(psql_db -F '|' -c "select p.prosecdef, p.provolatile,
	has_function_privilege('anon','public.cards_figees()','execute'),
	has_function_privilege('authenticated','public.cards_figees()','execute')
	from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'cards_figees';")
if [ "$forme_finale" = 'f|s|f|t' ]; then
	ok "la fonction est restaurée : INVOKER, STABLE, anon refusé, authenticated admis"
else
	fail "la fonction n'est pas restaurée : '$forme_finale'"
fi

contrat_final=$(psql_db -F '|' -c "select count(*), min(f.card_id::text), min(f.seuil_jours)
	from public.cards_figees() f;")
if [ "$contrat_final" = "1|$CARD_FIGEE|14" ]; then
	ok "le seed est rendu intact : une affaire figée, la même, au même seuil"
else
	fail "le seed ne retrouve pas son état : '$contrat_final'"
fi

if suite_sql_verte; then
	ok "la suite pgTAP redevient verte après restauration"
else
	fail "la suite pgTAP reste rouge après restauration"
	sed 's/^/        /' "$TRAVAIL/tap.log" | tail -n 25
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
