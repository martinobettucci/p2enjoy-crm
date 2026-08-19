#!/usr/bin/env bash
# @verifies CRM-084 (docs/BACKLOG.md) — Definition of Done des budgets : le modèle livré par la
#           tranche 1, et l'ÉCRAN d'administration livré par la tranche 2
# @verifies docs/SPEC-costs.md §2.1 (nom, devise, enveloppe facultative, unicité limitée aux
#           budgets ouverts), §2.2 (aucune génération automatique, une occurrence se clôture
#           indépendamment de son budget), §3.2 (seul un administrateur écrit), §4.1 (la table,
#           l'interrupteur des clôturés, la clôture qui avertit sans empêcher), §4.7 (les états)
# @verifies docs/SCHEMA.md §9 bis.4, §9 bis.5 (les deux tables), §9 bis.7 (les politiques)
# @verifies docs/DESIGN_SYSTEM.md §1 (les couleurs sont des JETONS), §5.9 (le patron de tableau),
#           §5.13 (la surface qui accueille le bloc), §7 (les quatre paliers)
# @verifies CLAUDE.md §16 (vérification visuelle), §18 (aucune temporisation), §22 (clavier)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers des deux tranches sont livrés et portent leur traçabilité `@spec` /
#      `@verifies` ;
#   2. les captures des quatre paliers et des deux surfaces d'écriture sont livrées ;
#   3. les règles que le CODE porte, et qu'aucune suite ni aucune capture ne rendrait rouges ;
#   4. le modèle est réellement EN BASE : les deux tables, l'index d'unicité PARTIEL, les huit
#      politiques, et le seed dans l'état que les preuves attendent ;
#   5. Vitest — le module client de l'écran ;
#   6. la suite pgTAP de l'unité ;
#   7. la preuve d'API, qui mesure les refus HORS interface ;
#   8. la preuve d'interface, sur la pile seedée, au clavier ET à la souris ;
#   9. le harnais est NON COMPLAISANT : trois dégradations réelles, portant chacune sur une règle
#      que `docs/SPEC-costs.md` énonce, doivent faire ÉCHOUER une preuve — et la restauration est
#      constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# LE DÉCOMPTE DES LIGNES SANS COÛT RÉEL DE LA CONFIRMATION DE CLÔTURE (§4.1) N'EST PAS ATTENDU,
# et son absence n'est donc pas comptée en échec : il se lit dans `card_costs`, table que
# `CRM-085` livrera. Un contrôle qui l'exigerait ici rendrait rouge une tranche correctement
# livrée. Ce que le harnais EXIGE en revanche, c'est que la confirmation dise quelque chose de ce
# décompte : un blanc s'y lirait comme un zéro, ce que la spécification refuse expressément.
#
# AUCUNE SURFACE DE GESTION DES OCCURRENCES N'EST ATTENDUE : le §4.1 décrit une COLONNE qui les
# compte, et aucun chapitre de `docs/SPEC-costs.md` ne spécifie d'écran pour les ouvrir ou les
# clôturer. C'est un manque du produit, consigné au registre — pas un défaut de cette unité, et
# le trancher ici reviendrait à inventer une spécification.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-budgets.sh
#   scripts/verify-budgets.sh --rapide   n'exécute ni Playwright ni les dégradations

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION=supabase/migrations/0050_budgets.sql
TEST_SQL=supabase/tests/0048_budgets.test.sql
MODULE=webapp/src/lib/budgets.ts
TEST_MODULE=webapp/src/lib/budgets.test.ts
ECRAN=webapp/src/app/BlocBudgetsTrack.tsx
HOTE=webapp/src/app/AdministrationArborescence.tsx
SPEC_API=e2e/api/budgets.spec.ts
SPEC_UI=e2e/ui/budgets.spec.ts
CAPTURES=docs/captures/CRM-084
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,48p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 ». Voir --help." >&2; exit 1 ;;
	esac
	shift
done

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

TRAVAIL=$(mktemp -d)
RAPPORTS=e2e/output/verify-budgets
mkdir -p "$RAPPORTS"

fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}

# Les dégradations du §9 modifient de VRAIS fichiers du dépôt. La sauvegarde est prise avant, et
# rendue par le `trap` : une session interrompue au milieu d'une dégradation ne doit pas laisser le
# dépôt affaibli, ce qui serait pire que l'absence de harnais.
SAUVEGARDES="$TRAVAIL/sauvegardes"
mkdir -p "$SAUVEGARDES"
sauvegarder() { cp "$1" "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')"; }
rendre() { cp "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')" "$1"; }
restaurer() {
	for fichier in "$SAUVEGARDES"/*; do
		[ -e "$fichier" ] || continue
		cp "$fichier" "$(basename "$fichier" | tr '@' '/')"
	done
	rm -rf "$TRAVAIL"
}
trap restaurer EXIT

printf '\033[1mPreuves de CRM-084 — budgets, occurrences et clôture\033[0m\n'

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$MODULE" "$TEST_MODULE" "$ECRAN" "$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION" "$MODULE" "$ECRAN"; do
	if head -3 "$fichier" | grep -q 'CRM-084'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog en tête de fichier"
	fi
done

for fichier in "$TEST_SQL" "$TEST_MODULE" "$SPEC_API" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-084'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# L'écran d'administration de l'arborescence ACCUEILLE le bloc des budgets : sans cette trace, rien
# ne mènerait de la surface hôte à l'unité qui y a ajouté une section.
if head -8 "$HOTE" | grep -q 'CRM-084'; then
	ok "$(basename "$HOTE") cite CRM-084 — la surface hôte trace le bloc qu'elle accueille"
else
	fail "$(basename "$HOTE") ne cite pas CRM-084 : le bloc des budgets n'est plus tracé depuis son hôte"
fi

# --- 2. Captures observées ----------------------------------------------------------------------
# La DoD exige « E2E de l'écran d'administration, captures ». Le harnais ne peut pas OBSERVER une
# capture — c'est l'humain qui le fait (`CLAUDE.md` §16) —, mais il peut refuser qu'une DoD
# prétende à des captures absentes.

titre "2. Captures des quatre paliers et des surfaces d'écriture"

for palier in xl-1440 lg-1152 md-900 sm-390; do
	if [ -f "$CAPTURES/budgets-$palier.jpg" ]; then
		ok "capture du palier $palier livrée"
	else
		fail "capture du palier $palier ABSENTE : la DoD exige les quatre paliers"
	fi
done

# Les deux surfaces d'écriture du §4.1 : le formulaire, et la confirmation de clôture — celle-ci
# étant la seule que la spécification décrit dans son détail.
for etat in budgets-formulaire-creation budgets-confirmation-cloture; do
	if [ -f "$CAPTURES/$etat.jpg" ]; then
		ok "capture de l'état « $etat » livrée"
	else
		fail "capture « $etat » ABSENTE"
	fi
done

vides=$(find "$CAPTURES" -name '*.jpg' -size -4k | wc -l | tr -d ' ')
if [ "$vides" = '0' ]; then
	ok "aucune capture tronquée sous $CAPTURES"
else
	fail "« $vides » capture(s) de moins de 4 ko sous $CAPTURES : une exécution interrompue en laisse"
fi

# --- 3. Les règles que le code porte ------------------------------------------------------------
# Ces règles ne se prouvent NI par une suite, NI par une capture : elles portent sur ce que le code
# s'interdit d'écrire, ou sur une phrase dont l'absence laisserait un blanc mentir.

titre "3. Les règles que le code porte, et qu'aucune suite ne rendrait rouge"

hexa=$(grep -nE '#[0-9a-fA-F]{3,8}\b' "$ECRAN" "$MODULE" || true)
if [ -z "$hexa" ]; then
	ok "aucune couleur hexadécimale dans l'écran ni dans son module — les couleurs sont des jetons (§1)"
else
	fail "couleur hexadécimale trouvée : $(printf '%s' "$hexa" | head -3 | tr '\n' ' ')"
fi

tempo=$(grep -nE '\b(setTimeout|setInterval)\b' "$ECRAN" "$MODULE" || true)
if [ -z "$tempo" ]; then
	ok "aucune temporisation dans l'écran ni dans son module (CLAUDE.md §18)"
else
	fail "temporisation trouvée : $(printf '%s' "$tempo" | head -3 | tr '\n' ' ')"
fi

# `docs/SPEC-costs.md` §4.1 : « la clôture n'est PAS empêchée — c'est une décision de gestion ».
# La forme sous laquelle l'inverse s'introduirait est un `disabled` calculé sur autre chose que
# l'écriture en cours. Le contrôle regarde la confirmation : son bouton ne s'éteint que pendant
# l'écriture.
if grep -q 'disabled={enCours}' "$ECRAN"; then
	ok "le bouton de clôture ne s'éteint QUE pendant l'écriture — la clôture n'est pas empêchée (§4.1)"
else
	fail "le bouton de clôture ne porte plus « disabled={enCours} » : vérifiez qu'aucune garde ne l'empêche"
fi

# `docs/SPEC-costs.md` §4.1 : la clôture « n'est pas silencieuse », et elle COMPTE. Ce contrôle a
# été RÉVISÉ par `CRM-085` tranche 2 : il exigeait seulement que la confirmation parle du décompte,
# `card_costs` n'existant pas encore. La table existe désormais, le décompte est mesuré, et le
# contrôle exige donc la MESURE — un texte qui parlerait du décompte sans jamais l'interroger
# satisferait l'ancienne version tout en mentant à l'utilisateur.
if grep -q 'cloture-sans-reel' "$ECRAN" && grep -q 'compterLignesSansReel' "$ECRAN"; then
	ok "la confirmation MESURE les lignes sans coût réel dans card_costs (§4.1)"
else
	fail "la confirmation de clôture ne compte plus les lignes sans coût réel : un blanc s'y lirait comme un zéro"
fi

# Les QUATRE états du décompte. Les fondre en un seul texte ferait dire « aucune ligne n'attend »
# quand la lecture a échoué — le mensonge tranquille de `CLAUDE.md` §18.
manquants=''
for cle in loading none some failed; do
	grep -q "admin.budgets.close.pending.$cle" "$ECRAN" || manquants="$manquants $cle"
done
if [ -z "$manquants" ]; then
	ok "les quatre états du décompte sont distingués — en cours, zéro, non nul, non mesurable"
else
	fail "états du décompte absents de la confirmation :$manquants"
fi

# Le fragment de message sur lequel `classerRefusBudget` sépare le trigger de récurrence des
# `CHECK` de forme est la SEULE inspection de texte du module. Une dérive entre les deux fichiers
# rangerait silencieusement le refus du trigger sous « vérifiez le nom et la devise ».
fragment=$(grep -oP "(?<=FRAGMENT_RECURRENCE_OCCUPEE = ')[^']+" "$MODULE" || true)
if [ -n "$fragment" ] && grep -qF "$fragment" "$MIGRATION"; then
	ok "le fragment « $fragment » est bien celui que la migration lève"
else
	fail "le fragment de récurrence du module ne se trouve plus dans $MIGRATION : le refus du trigger serait mal classé"
fi

# --- 4. Le modèle est réellement en base --------------------------------------------------------

titre "4. Le modèle en base, et le seed que les preuves attendent"

if docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
	for table in budgets budget_occurrences; do
		presente=$(psql_db -c "select count(*) from information_schema.tables
			where table_schema='public' and table_name='$table'")
		if [ "$presente" = '1' ]; then
			ok "public.$table est en base"
		else
			fail "public.$table est ABSENTE : appliquez les migrations"
		fi
	done

	# L'UNICITÉ DU NOM EST UN INDEX **PARTIEL**, et c'est l'écart exact avec `goal_boards`
	# (§2.1) : clôturer « Salon 2025 » puis en ouvrir un nouveau est un geste normal. Un index
	# total l'interdirait sans qu'aucune suite d'interface ne le voie.
	partiel=$(psql_db -c "select count(*) from pg_indexes
		where schemaname='public' and indexname='budgets_track_name_ouvert_key'
		  and indexdef ilike '%where (closed_at is null)%'")
	if [ "$partiel" = '1' ]; then
		ok "l'unicité du nom est un index PARTIEL sur les budgets ouverts (§2.1)"
	else
		fail "budgets_track_name_ouvert_key n'est pas partiel : la clôture ne libérerait plus le nom"
	fi

	politiques=$(psql_db -c "select count(*) from pg_policies
		where schemaname='public' and tablename in ('budgets','budget_occurrences')")
	if [ "$politiques" = '8' ]; then
		ok "les HUIT politiques des deux tables sont posées (docs/SCHEMA.md §9 bis.7)"
	else
		fail "« $politiques » politique(s) sur budgets et budget_occurrences, huit attendues"
	fi

	# Le seed doit porter les quatre budgets exigés par la DoD : sans eux, la preuve d'interface
	# mesurerait une table vide et resterait verte.
	budgets=$(psql_db -c "select count(*) from public.budgets")
	clos=$(psql_db -c "select count(*) from public.budgets where closed_at is not null")
	if [ "$budgets" = '4' ] && [ "$clos" = '1' ]; then
		ok "le seed porte QUATRE budgets, dont UN clôturé — la table a de quoi se rendre"
	else
		fail "le seed porte « $budgets » budget(s) dont « $clos » clôturé(s), 4 et 1 attendus — appliquez supabase/seed/apply-seed.sh"
	fi

	# LES DEUX CLÔTURES SONT INDÉPENDANTES (§2.2) : « Publicité 2026 » est OUVERT et porte deux
	# occurrences dont UNE clôturée. C'est ce jeu précis qui rend la colonne « occurrences
	# ouvertes » démontrable — avec deux occurrences ouvertes, un filtre absent passerait inaperçu.
	ouvertes=$(psql_db -c "select count(*) from public.budget_occurrences o
		join public.budgets b on b.id = o.budget_id
		where b.name = 'Publicité 2026' and o.closed_at is null")
	toutes=$(psql_db -c "select count(*) from public.budget_occurrences o
		join public.budgets b on b.id = o.budget_id where b.name = 'Publicité 2026'")
	if [ "$ouvertes" = '1' ] && [ "$toutes" = '2' ]; then
		ok "« Publicité 2026 » porte DEUX occurrences dont UNE ouverte — le filtre de la colonne est démontrable"
	else
		fail "« Publicité 2026 » porte « $toutes » occurrence(s) dont « $ouvertes » ouverte(s), 2 et 1 attendues"
	fi

	# `docs/SPEC-costs.md` §5 et l'en-tête de la migration : AUCUNE GÉNÉRATION AUTOMATIQUE
	# d'occurrences, jamais. La forme sous laquelle elle s'introduirait est un trigger d'insertion
	# sur `budgets` qui écrirait dans `budget_occurrences`.
	generation=$(psql_db -c "select count(*) from pg_trigger t
		join pg_class c on c.oid = t.tgrelid
		join pg_proc p on p.oid = t.tgfoid
		where c.relname = 'budgets' and not t.tgisinternal
		  and pg_get_functiondef(p.oid) ilike '%insert into public.budget_occurrences%'")
	if [ "$generation" = '0' ]; then
		ok "aucun trigger de budgets n'insère d'occurrence — aucune génération automatique (§2.2)"
	else
		fail "un trigger de budgets insère des occurrences : la spécification l'interdit expressément (§2.2)"
	fi
else
	fail "le conteneur $DB_CONTAINER ne répond pas : la pile doit tourner (./runDev.sh)"
fi

# --- 5. Vitest — le module client ---------------------------------------------------------------

titre "5. Vitest — le module client de l'écran"

if npm run test:unit -- --run 'lib/budgets.test' >"$TRAVAIL/vitest.log" 2>&1; then
	ok "vitest $TEST_MODULE : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/vitest.log" | tail -1)"
else
	fail_journal "vitest $TEST_MODULE ÉCHOUE" "$TRAVAIL/vitest.log"
fi

# --- 6, 7, 8. Les preuves longues ---------------------------------------------------------------

if [ "$RAPIDE" = true ]; then
	titre "6. Preuves longues"
	ok "--rapide : ni pgTAP, ni Playwright, ni les dégradations ne sont exécutés (annoncé, non masqué)"
else
	titre "6. pgTAP — la forme des fonctions et les codes SQL"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
		ok "pgTAP ($TEST_SQL) : $(grep -oE '[0-9]+ (assertions?|tests?)' "$TRAVAIL/pgtap.log" | tail -1)"
	else
		fail_journal "la suite pgTAP des budgets ÉCHOUE" "$TRAVAIL/pgtap.log"
	fi

	titre "7. API — les deux formes du refus, mesurées HORS interface"

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		ok "e2e api ($SPEC_API) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1)"
	else
		fail_journal "les refus d'API ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	titre "8. UI — la table des budgets sur la pile seedée, au clavier et à la souris"

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		ok "e2e ui ($SPEC_UI) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1) au clavier et à la souris"
	else
		fail_journal "le parcours d'administration des budgets ÉCHOUE" "$TRAVAIL/ui.log"
	fi

	# LES PREUVES D'ÉCRITURE REMETTENT LE SEED EN ÉTAT, et c'est constaté plutôt que supposé : un
	# budget de fixture survivant ferait dériver les comptes des scénarios de lecture à l'exécution
	# suivante, et les captures avec eux.
	if docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
		residus=$(psql_db -c "select count(*) from public.budgets where name like 'E2E Budget%'")
		if [ "$residus" = '0' ]; then
			ok "les preuves d'interface ont RENDU le seed intact — aucun budget de fixture ne subsiste"
		else
			fail "« $residus » budget(s) « E2E Budget… » subsistent : l'épilogue des preuves n'a pas purgé"
		fi
	fi

	# --- 9. Le harnais est non complaisant ------------------------------------------------------
	# Trois dégradations RÉELLES, portant chacune sur une règle que la spécification énonce. Si
	# l'une d'elles ne rend rien rouge, c'est la preuve correspondante qui ne prouve rien.

	titre "9. Dégradations — chacune DOIT faire échouer une preuve"

	degradation() {
		local libelle=$1 fichier=$2 avant=$3 apres=$4 motif=$5
		sauvegarder "$fichier"
		if ! grep -qF "$avant" "$fichier"; then
			fail "dégradation « $libelle » inapplicable : « $avant » est introuvable dans $fichier"
			return
		fi
		perl -0pi -e "s/\Q$avant\E/$apres/" "$fichier"
		if npm run test:unit -- --run "$motif" >"$TRAVAIL/degradation.log" 2>&1; then
			fail "dégradation « $libelle » : la preuve reste VERTE — elle ne prouve donc rien"
		else
			ok "dégradation « $libelle » : la preuve devient rouge, comme elle le doit"
		fi
		rendre "$fichier"
	}

	# 1. Le filtre des budgets clôturés retiré : l'interrupteur du §4.1 n'aurait plus d'effet.
	degradation "le filtre des budgets clôturés est retiré (§4.1)" \
		"$MODULE" "inclureClotures ? base : base.is('closed_at', null)" "base" \
		'lib\/budgets.test'

	# 2. Le compte des occurrences cesse de filtrer sur la clôture : la colonne compterait les
	#    occurrences closes, alors que le §2.2 les distingue.
	degradation "le compte des occurrences ne filtre plus la clôture (§2.2)" \
		"$MODULE" ".is('closed_at', null)" "" \
		'lib\/budgets.test'

	# 3. Une enveloppe vide devient zéro : c'est la valeur par défaut trompeuse de CLAUDE.md §18,
	#    et elle transformerait « pas décidée » en « zéro décidé ».
	degradation "un champ d'enveloppe vide devient zéro (§2.1, CLAUDE.md §18)" \
		"$MODULE" "if (nettoyee === '') return { statut: 'absente' }" \
		"if (nettoyee === '') return { statut: 'lue', montant: 0 }" \
		'lib\/budgets.test'

	# La restauration est CONSTATÉE, pas supposée : un `perl -pi` interrompu laisserait le module
	# affaibli, ce qui serait pire que l'absence de harnais.
	if npm run test:unit -- --run 'lib/budgets.test' >"$TRAVAIL/restauration.log" 2>&1; then
		ok "le module est RESTAURÉ : la preuve redevient verte après les dégradations"
	else
		fail_journal "le module n'a PAS été restauré — le dépôt est affaibli, rendez $MODULE" \
			"$TRAVAIL/restauration.log"
	fi
fi

# --- Bilan --------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec\033[0m\n' "$checks" "$failures"
fi
exit $((failures > 0 ? 1 : 0))
