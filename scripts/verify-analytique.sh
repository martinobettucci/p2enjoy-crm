#!/usr/bin/env bash
# @verifies CRM-066 (docs/BACKLOG.md) — analytique de conversion et prévisionnel pondéré,
#           TRANCHES 2 a et 2 b
# @verifies docs/SPEC-analytique.md §3 (probabilité effective à trois niveaux, absence assumée),
#           §4 (les deux exclusions, et l'inclusion du sommeil), §5.1 (signature, grain, libellé du
#           catalogue), §5.3 (`security invoker` obligatoire), §5.4 (`anon` révoqué nommément),
#           §6 (contrat d'API), §7 (les deux grandeurs dérivées), §12 (preuves attendues)
# @verifies docs/SCHEMA.md §9 bis.11 ; docs/PROD_MIGRATIONS.md §3 (migration 73)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves des deux tranches, puis DÉGRADE RÉELLEMENT le produit — une
# dégradation par règle qu'il porte — et exige que la preuve concernée rougisse. Aucun état dégradé
# ne subsiste, même en cas d'échec : la migration et le module sont restaurés par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien tant
# qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et vérifie que
# la preuve concernée la dénonce ; une dégradation qui laisserait la preuve verte est un trou dans la
# preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.
#
# LA PREMIÈRE DÉGRADATION EST LA PLUS IMPORTANTE DU FICHIER. En `security definer`, la fonction
# rendrait à chaque appelant le portefeuille de tout le monde : la lectrice lirait 39 affaires au
# lieu de 35, et un prévisionnel incluant des affaires interdites les divulguerait par soustraction.
# Une suite qui n'éprouverait qu'un seul profil resterait verte sur cette régression.

set -euo pipefail

cd "$(dirname "$0")/.."

# LES TROIS SUITES NODE PASSENT PAR `scripts/lib/node.sh`, comme les harnais qui en dépendent : sans
# elle, la chaîne retombe silencieusement sur le Node du système, que le dépôt n'exige pas.
# shellcheck source=lib/node.sh
source scripts/lib/node.sh

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0073_entonnoir_conversion.sql
SUITE_SQL=supabase/tests/0068_entonnoir_conversion.test.sql
SUITE_API=e2e/api/analytique.spec.ts
MODULE_TS=webapp/src/lib/analytique.ts
SUITE_TS=webapp/src/lib/analytique.test.ts
SPEC=docs/SPEC-analytique.md

node_toolchain_prepare "$PWD/.nvmrc" || exit 1

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false
module_sauve=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_due" = true ]; then
		if ! psql_db -f - < "$MIGRATION" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$MIGRATION" >&2
			statut=1
		fi
	fi
	if [ "$module_sauve" = true ] && [ -f "$TRAVAIL/module.orig" ]; then
		if ! cp "$TRAVAIL/module.orig" "$MODULE_TS"; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$MODULE_TS" >&2
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

suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_SQL" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

suite_api_verte() {
	npm run --silent e2e:api -- "$SUITE_API" >"$TRAVAIL/api.log" 2>&1
}

suite_unitaire_verte() {
	npx vitest run --config webapp/vitest.config.ts "$SUITE_TS" >"$TRAVAIL/unit.log" 2>&1
}

# Remplace un motif dans une copie de la migration, puis l'applique. Le motif est comparé AVANT et
# APRÈS : une substitution qui ne substituerait rien laisserait la preuve verte et le harnais
# conclurait à tort à la complaisance — défaut trouvé à `CRM-061` (décision 503), il ne se refait pas.
degrader_sql() {
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

restaurer_sql() {
	psql_db -f - < "$MIGRATION" >/dev/null 2>&1
	restauration_due=false
}

eprouver_degradation_sql() {
	local nom=$1 avant=$2 apres=$3
	degrader_sql "$avant" "$apres" "$nom" || return 0
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer_sql
}

eprouver_degradation_module() {
	local nom=$1 avant=$2 apres=$3
	cp "$MODULE_TS" "$TRAVAIL/module.orig"
	module_sauve=true
	python3 - "$MODULE_TS" "$avant" "$apres" <<-'PY'
		import io, sys
		chemin, avant, apres = sys.argv[1:4]
		texte = io.open(chemin, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(chemin, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	if cmp -s "$MODULE_TS" "$TRAVAIL/module.orig"; then
		fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
	elif suite_unitaire_verte; then
		fail "COMPLAISANT — « $nom » appliquée, la suite unitaire reste VERTE"
	else
		ok "dégradation « $nom » : la suite unitaire rougit, comme elle doit"
	fi
	cp "$TRAVAIL/module.orig" "$MODULE_TS"
	module_sauve=false
}

echo
echo "Preuves de CRM-066 — l'entonnoir de conversion (tranche 2 a) et son module (tranche 2 b)"
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
# backlog ET les chapitres.

for fichier in "$MIGRATION" "$MODULE_TS"; do
	if head -n 14 "$fichier" | grep -q '@spec CRM-066' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-analytique.md'; then
		ok "traçabilité : $fichier cite CRM-066 et sa spécification"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @spec complet"
	fi
done

for fichier in "$SUITE_SQL" "$SUITE_TS" "$SUITE_API"; do
	if head -n 14 "$fichier" | grep -q '@verifies CRM-066' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-analytique.md'; then
		ok "traçabilité : $fichier cite CRM-066 et sa spécification en @verifies"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @verifies complet"
	fi
done

if [ -f "$SPEC" ] \
	&& grep -q '^## 3. La probabilité effective' "$SPEC" \
	&& grep -q '^## 6. Contrat d' "$SPEC" \
	&& grep -q '^### 5.3 ' "$SPEC"; then
	ok "la spécification existe et porte les chapitres que les fichiers citent"
else
	fail "docs/SPEC-analytique.md absent ou amputé d'un chapitre cité"
fi

# =================================================================================================
echo
echo "2. Forme de la fonction dans le catalogue, et son ACL — mesurées, pas relues dans le SQL"
# =================================================================================================
# `security invoker` est le DÉFAUT et ne s'écrit donc pas : lire le fichier ne dirait rien. Seul le
# catalogue le dit.

forme=$(psql_db -F '|' -c "select p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '')
	from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'entonnoir_conversion';")
if [ "$forme" = 'f|s|search_path=""' ]; then
	ok "public.entonnoir_conversion() : SECURITY INVOKER, STABLE, search_path vide"
else
	fail "forme inattendue : '$forme' au lieu de 'f|s|search_path=\"\"'"
fi

acl=$(psql_db -F '|' -c "select has_function_privilege('anon', 'public.entonnoir_conversion()', 'execute'),
	has_function_privilege('authenticated', 'public.entonnoir_conversion()', 'execute'),
	has_function_privilege('service_role', 'public.entonnoir_conversion()', 'execute');")
if [ "$acl" = 'f|t|t' ]; then
	ok "ACL : anon REFUSÉ nommément, authenticated et service_role autorisés"
else
	fail "ACL inattendue : '$acl' au lieu de 'f|t|t'"
fi

# =================================================================================================
echo
echo "3. Le module ne redéclare AUCUNE règle que la base porte"
# =================================================================================================
# `docs/SPEC-analytique.md` §5.2 et le préambule du module : la probabilité effective, les exclusions
# et le montant pondéré vivent en base. Un module qui les recalculerait créerait une SECONDE
# définition à maintenir — le mode de défaillance qu'INC-138, INC-241 et la décision 560 ont coûté au
# dépôt. Le contrôle porte sur le CODE, commentaires exclus : la règle y est nommée à dessein.

code_module=$(grep -v '^\s*\(//\|\*\|/\*\)' "$MODULE_TS" || true)
regle_recopiee=false
for motif in 'probability_override' 'archived_at' 'deleted_at' 'default_probability'; do
	if printf '%s' "$code_module" | grep -q "$motif"; then
		fail "le module recopie la règle de la base : « $motif » apparaît dans son code"
		regle_recopiee=true
	fi
done
if [ "$regle_recopiee" = false ]; then
	ok "le module n'emploie aucune colonne de la règle : il replie ce que la base a agrégé"
fi

# =================================================================================================
echo
echo "4. Les trois preuves de l'unité sont vertes"
# =================================================================================================

if suite_sql_verte; then
	ok "suite pgTAP : $(grep -o '[0-9]* assertions' "$TRAVAIL/tap.log" | head -1), aucune anomalie"
else
	fail "suite pgTAP ROUGE — voir $TRAVAIL/tap.log"
fi

if suite_unitaire_verte; then
	ok "suite unitaire du module : verte"
else
	fail "suite unitaire ROUGE — voir $TRAVAIL/unit.log"
fi

if suite_api_verte; then
	ok "contrat d'API : $(grep -o '[0-9]* passed' "$TRAVAIL/api.log" | tail -1)"
else
	fail "contrat d'API ROUGE — voir $TRAVAIL/api.log"
fi

# =================================================================================================
echo
echo "5. Dégradations réelles de la fonction — la suite doit rougir sur chacune"
# =================================================================================================

# D-A — LA PLUS IMPORTANTE. En `definer`, la fonction répond pour `postgres` et rend à chacun le
# portefeuille de tout le monde : la lectrice lirait 39 affaires au lieu de 35.
# Le motif porte deux apostrophes SQL : `$'...'` (guillemets ANSI-C) est la seule écriture bash qui
# les conserve — `'…''''…'` les fait DISPARAÎTRE par concaténation de chaînes vides, et le motif
# devient introuvable. Défaut mesuré à la première exécution de ce harnais, le 2026-08-30.
eprouver_degradation_sql "security definer au lieu d'invoker" \
	$'set search_path to \'\'\nas $$' \
	$'security definer\nset search_path to \'\'\nas $$'

# D-B — le `coalesce` de la probabilité réordonné : le nœud l'emporterait sur l'affaire, c'est-à-dire
# l'inverse de « le plus spécifique gagne » (§3).
# LE MOTIF PORTE SUR L'ARITHMÉTIQUE, ET NON SUR LE `filter`. Réordonner le `coalesce` du `filter`
# serait un NO-OP : `coalesce(a,b,c) is not null` a la même valeur quel que soit l'ordre, et la
# suite resterait verte à juste titre. Le harnais aurait alors crié « COMPLAISANT » contre une
# preuve qui ne l'est pas. Défaut mesuré à la première exécution de ce harnais, le 2026-08-30.
eprouver_degradation_sql "coalesce de la probabilité réordonné" \
	'	           c.amount * coalesce(c.probability_override,
	                               s.probability_override,
	                               n.default_probability) / 100.0' \
	'	           c.amount * coalesce(n.default_probability,
	                               s.probability_override,
	                               c.probability_override) / 100.0'

# D-C — l'exclusion des affaires archivées retirée : le total passerait de 39 à 40 (§4).
eprouver_degradation_sql "exclusion des affaires archivées retirée" \
	'	 where c.archived_at is null
	   and c.deleted_at is null' \
	'	 where c.deleted_at is null'

# D-D — le compteur des affaires sans montant éteint. L'écran ne pourrait plus écrire la mention que
# le §7.3 lui impose, et un prévisionnel bas se lirait comme un portefeuille pauvre.
eprouver_degradation_sql "compteur des affaires sans montant éteint" \
	'	       count(*) filter (where c.amount is null)::integer,' \
	'	       0::integer,'

# =================================================================================================
echo
echo "6. Dégradations réelles du module — la suite unitaire doit rougir sur chacune"
# =================================================================================================

# D-E — le taux inconnu devient zéro. « Tout a été perdu » et « rien n'a été décidé » cesseraient
# d'être distinguables (§7.1).
eprouver_degradation_module "taux inconnu remplacé par zéro" \
	'taux: decidees === 0 ? null : gagnees / decidees' \
	'taux: decidees === 0 ? 0 : gagnees / decidees'

# D-F — le prévisionnel cesse d'exclure les nœuds terminaux : une affaire gagnée redeviendrait une
# prévision, et le total EUR passerait de 333 715,00 à 644 715,00 (§7.2).
eprouver_degradation_module "nœuds terminaux réintégrés au prévisionnel" \
	"		if (genreDe(ligne.node_kind) !== 'open') continue" \
	'		if (false) continue'

# D-G — le repli fusionne les devises. Deux monnaies s'additionneraient sans taux de change (§11.2).
eprouver_degradation_module "repli fusionnant les deux devises" \
	'		const clef = `${ligne.node_id} ${ligne.currency}`' \
	'		const clef = `${ligne.node_id}`'

# =================================================================================================
echo
echo "7. Le produit est RESTAURÉ, et le harnais le constate en sortant"
# =================================================================================================

forme=$(psql_db -F '|' -c "select p.prosecdef, p.provolatile from pg_proc p
	join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'entonnoir_conversion';")
if [ "$forme" = 'f|s' ]; then
	ok "la fonction est restaurée : SECURITY INVOKER, STABLE"
else
	fail "la fonction n'a PAS été restaurée : '$forme'"
fi

if git diff --quiet -- "$MODULE_TS"; then
	ok "le module est restauré : aucun écart avec l'arbre de travail"
else
	fail "le module n'a PAS été restauré : $MODULE_TS diffère"
fi

if suite_sql_verte; then
	ok "la suite pgTAP est de nouveau verte après toutes les dégradations"
else
	fail "la suite pgTAP reste ROUGE après restauration"
fi

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
