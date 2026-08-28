#!/usr/bin/env bash
# @verifies CRM-083 (docs/BACKLOG.md) — Definition of Done du canevas d'objectifs : l'ÉCRAN,
#           ses gestes, ses états et son accessibilité
# @verifies docs/SPEC-goals.md §1 (aucun calcul : le remplissage est saisi, jamais dérivé),
#           §3 (les gestes de l'utilisateur), §5.1 (liste des tableaux), §5.2 (canevas et jauge),
#           §5.3 (flèches tracées entre les bords), §5.4 (les cinq états, dont le bloc masqué),
#           §5.5 (le canevas est entièrement utilisable au clavier, et l'équivalent textuel)
# @verifies docs/DESIGN_SYSTEM.md §1 (les couleurs sont des JETONS, jamais un hexadécimal),
#           §5.13 (liste administrable), §5.29 (bloc, jauge, flèche), §7 (les quatre paliers)
# @verifies CLAUDE.md §16 (vérification visuelle), §18 (aucune temporisation), §22 (clavier)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers de l'écran sont livrés et portent leur traçabilité `@spec` / `@verifies` ;
#   2. les captures des quatre paliers et des états que la DoD exige sont livrées ;
#   3. les règles de l'écran que le CODE porte, et qu'aucune suite ne pourrait rendre rouge :
#      aucune couleur hexadécimale, aucune temporisation, aucune couleur de jugement sur la
#      jauge, aucun total de blocs stocké en base ;
#   4. Vitest — la lecture, l'écriture et l'écran ;
#   5. la preuve d'API de l'unité, qui mesure les refus HORS interface ;
#   6. la preuve d'interface de l'unité, sur la pile seedée, au clavier ET à la souris ;
#   7. le harnais est NON COMPLAISANT : sept dégradations réelles, portant chacune sur une règle
#      que `docs/SPEC-goals.md` énonce, doivent faire ÉCHOUER une preuve — et la restauration est
#      constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# LE MODÈLE, LA RLS ET LES POLITIQUES NE SONT PAS REJOUÉS ICI : ils appartiennent à `CRM-082` et
# `scripts/verify-objectifs.sh` les prouve déjà — schéma réellement en base, douze politiques,
# fonctions `SECURITY DEFINER`, suite pgTAP et dégradations de politiques. Les rejouer ici les
# dupliquerait sans les renforcer. Ce harnais-ci ne regarde la base que sur les DEUX points dont
# l'écran dépend directement : que le seed porte encore de quoi rendre ses états, et qu'aucun
# total de blocs n'y soit stocké.
#
# LE DÉSARCHIVAGE D'UN TABLEAU N'EST PAS ATTENDU, et son absence n'est donc pas comptée en échec :
# `docs/SPEC-goals.md` §5.1 ne décrit qu'une liste des tableaux NON archivés, et le backlog nomme
# cette limite. Un contrôle qui l'exigerait ici rendrait rouge une unité correctement livrée.
#
# L'ÉTAT LECTURE SEULE EST DÉSORMAIS CONTRÔLÉ — révision du 2026-08-28, tranche 3. Le texte
# d'origine disait ce point « bloqué par l'arbitrage INC-170 » ; l'arbitrage est RENDU (décision
# 546, `docs/SPEC-goals.md` §5.7) et la tranche 3 l'a livré. Le contrôle porte sur ce que le §5.7.4
# rend vérifiable hors d'une suite : que l'écran lise la CAPACITÉ que la base consent et non un
# rôle, et que la migration qui la rend soit `security invoker`. Ce que l'écran FAIT de cette
# capacité est mesuré par les preuves, unitaires et d'interface, que ce harnais rejoue.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-objectifs-canevas.sh
#   scripts/verify-objectifs-canevas.sh --rapide   n'exécute ni Playwright ni les dégradations

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

LECTURE=webapp/src/lib/objectifs.ts
TEST_LECTURE=webapp/src/lib/objectifs.test.ts
ECRITURE=webapp/src/lib/objectifs-ecriture.ts
TEST_ECRITURE=webapp/src/lib/objectifs-ecriture.test.ts
ECRAN=webapp/src/app/Objectifs.tsx
TEST_ECRAN=webapp/src/app/Objectifs.test.tsx
SPEC_API=e2e/api/objectifs.spec.ts
SPEC_UI=e2e/ui/objectifs.spec.ts
# La migration de la TRANCHE 3 : elle n'ajoute qu'une fonction, et la propriété qui compte est
# `security invoker` (`docs/SCHEMA.md` §9 bis.8 bis).
MIGRATION_CAPACITE=supabase/migrations/0071_objectifs_ecriture_permise.sql
TEST_CAPACITE=supabase/tests/0067_objectifs_ecriture_permise.test.sql
CAPTURES=docs/captures/CRM-083
DB_CONTAINER=p2enjoy-db

# Identifiants du seed, stables par contrat (`docs/SPEC-seed.md`).
TABLEAU_SEED='5eed0000-0000-4000-8000-0000000000e1'

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,52p' "$0"; exit 0 ;;
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
RAPPORTS=e2e/output/verify-objectifs-canevas
mkdir -p "$RAPPORTS"

fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}

# Les dégradations du §7 modifient de VRAIS fichiers du dépôt. La sauvegarde est prise avant, et
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

printf '\033[1mPreuves de CRM-083 — le canevas d’objectifs\033[0m\n'

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$LECTURE" "$TEST_LECTURE" "$ECRITURE" "$TEST_ECRITURE" "$ECRAN" "$TEST_ECRAN" \
	"$SPEC_API" "$SPEC_UI" "$MIGRATION_CAPACITE" "$TEST_CAPACITE"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

# La migration et sa suite pgTAP appartiennent à la TRANCHE 3, et leur traçabilité est contrôlée
# comme celle des huit autres fichiers : sans elle, la colonne calculée ne mènerait plus à l'unité
# de l'écran qui la consomme.
if head -3 "$MIGRATION_CAPACITE" | grep -q '@spec CRM-083'; then
	ok "$(basename "$MIGRATION_CAPACITE") porte son commentaire @spec"
else
	fail "$(basename "$MIGRATION_CAPACITE") ne cite pas son unité de backlog en tête de fichier"
fi
if head -3 "$TEST_CAPACITE" | grep -q '@verifies CRM-083'; then
	ok "$(basename "$TEST_CAPACITE") porte son commentaire @verifies"
else
	fail "$(basename "$TEST_CAPACITE") ne cite pas son unité de backlog"
fi

for fichier in "$LECTURE" "$ECRITURE" "$ECRAN"; do
	if head -3 "$fichier" | grep -q '@spec CRM-083'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog en tête de fichier"
	fi
done

for fichier in "$TEST_LECTURE" "$TEST_ECRITURE" "$TEST_ECRAN" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-083'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# La preuve d'API est partagée avec `CRM-082`, qui l'a créée : elle doit citer les DEUX unités,
# sans quoi la trace du refus mesuré hors interface, exigé par la DoD de `CRM-083`, ne mène plus
# à cette unité.
if head -5 "$SPEC_API" | grep -q 'CRM-083'; then
	ok "$(basename "$SPEC_API") cite CRM-083 — le refus hors interface qu'exige sa DoD y est tracé"
else
	fail "$(basename "$SPEC_API") ne cite pas CRM-083 : le refus hors interface n'est plus tracé vers cette unité"
fi

# --- 2. Captures observées ----------------------------------------------------------------------
# La DoD exige « captures aux quatre paliers », et « état vide, état lien perdu et état lecture
# seule capturés ». Le harnais ne peut pas OBSERVER une capture — c'est l'humain qui le fait
# (`CLAUDE.md` §16) —, mais il peut refuser qu'une DoD prétende à des captures absentes.

titre "2. Captures des quatre paliers et des états"

for palier in xl-1440 lg-1152 md-900 sm-390; do
	if [ -f "$CAPTURES/canevas-$palier.jpg" ]; then
		ok "capture du palier $palier livrée"
	else
		fail "capture du palier $palier ABSENTE : la DoD exige les quatre paliers"
	fi
done

# `canevas-lectrice-bloc-masque` EST la capture de l'état le plus important du §5.4 : elle rend le
# tableau tel que la lectrice le voit, sans le bloc que la RLS lui masque.
# `lecture-seule-canevas-1440` et `lecture-seule-fiche-1440` sont les captures de la tranche 3 —
# celles où l'observation a trouvé DEUX défauts qu'aucune assertion n'attrapait : la poignée de
# redimensionnement encore dessinée, et la fiche qui ne disait pas pourquoi ses champs étaient gris.
for etat in canevas-lectrice-bloc-masque canevas-focus-clavier refus-lectrice-1440 \
	lecture-seule-canevas-1440 lecture-seule-fiche-1440 lecture-seule-sm-390; do
	if [ -f "$CAPTURES/$etat.jpg" ]; then
		ok "capture de l'état « $etat » livrée"
	else
		fail "capture « $etat » ABSENTE"
	fi
done

# Une capture vide ou tronquée passerait le contrôle d'existence. Le poids ne prouve pas le
# contenu, mais il élimine le fichier de zéro octet qu'un Playwright interrompu laisse derrière lui.
vides=$(find "$CAPTURES" -name '*.jpg' -size -4k | wc -l | tr -d ' ')
if [ "$vides" = '0' ]; then
	ok "aucune capture tronquée sous $CAPTURES"
else
	fail "« $vides » capture(s) de moins de 4 ko sous $CAPTURES : une exécution interrompue en laisse"
fi

# --- 3. Les règles de l'écran que le CODE porte -------------------------------------------------
# Ces quatre règles ne se prouvent NI par une suite, NI par une capture : elles portent sur ce que
# le code s'interdit d'écrire. Une suite verte et une capture correcte coexisteraient parfaitement
# avec chacune de leurs violations.

titre "3. Les règles que le code porte, et qu'aucune suite ne rendrait rouge"

# `docs/DESIGN_SYSTEM.md` §1 et `docs/SPEC-goals.md` §2.2 : la couleur d'un bloc est un NOM DE
# JETON, jamais un hexadécimal. Un hexadécimal posé dans l'écran échapperait au thème et aux
# contrastes vérifiés.
hexa=$(grep -nE '#[0-9a-fA-F]{3,8}\b' "$ECRAN" "$LECTURE" "$ECRITURE" || true)
if [ -z "$hexa" ]; then
	ok "aucune couleur hexadécimale dans l'écran ni dans ses modules — les couleurs sont des jetons (§1)"
else
	fail "couleur hexadécimale trouvée : $(printf '%s' "$hexa" | head -3 | tr '\n' ' ')"
fi

# `docs/SPEC-goals.md` §5.5 : « l'écriture part au RELÂCHEMENT de la touche […]. Aucune
# temporisation n'est employée pour l'obtenir ». C'est aussi `CLAUDE.md` §18. Une temporisation
# rendrait les preuves d'interface intermittentes sans jamais les rendre rouges.
tempo=$(grep -nE '\b(setTimeout|setInterval)\b' "$ECRAN" "$LECTURE" "$ECRITURE" || true)
if [ -z "$tempo" ]; then
	ok "aucune temporisation dans l'écran ni dans ses modules (§5.5, CLAUDE.md §18)"
else
	fail "temporisation trouvée : $(printf '%s' "$tempo" | head -3 | tr '\n' ' ')"
fi

# `docs/SPEC-goals.md` §5.2 : « la jauge NE CHANGE PAS DE COULEUR AVEC LA VALEUR ». Le vert et le
# rouge y introduiraient un jugement que le produit n'a pas à porter. La forme sous laquelle ce
# jugement s'introduirait est une couleur de succès ou de danger choisie d'après le remplissage.
jugement=$(grep -nE 'fill_percent|remplissage' "$ECRAN" | grep -E 'success|danger' || true)
if [ -z "$jugement" ]; then
	ok "la jauge ne porte aucune couleur de jugement — ni vert ni rouge selon la valeur (§5.2)"
else
	fail "la jauge semble juger la valeur : $(printf '%s' "$jugement" | head -3 | tr '\n' ' ')"
fi

# `docs/SPEC-goals.md` §5.7 : L'ÉCRAN NE DÉDUIT AUCUN DROIT D'UN RÔLE. C'est le cœur de l'arbitrage
# d'INC-170, et c'est la règle qu'aucune suite ne rendrait rouge : un écran qui lirait le rôle du
# workspace et en tirerait la même extinction passerait TOUTES les preuves de la tranche 3, la
# lectrice du seed étant précisément un `viewer`. La forme sous laquelle ce défaut arriverait est
# une lecture de `workspace_members.role`, de `workspace_role` ou une comparaison à la chaîne
# « viewer » dans l'écran ou ses modules.
role=$(grep -nE "workspace_role|workspace_members|'viewer'|\"viewer\"" "$ECRAN" "$LECTURE" "$ECRITURE" || true)
if [ -z "$role" ]; then
	ok "l'écran ne lit AUCUN rôle : l'état de lecture seule vient de la capacité que la base consent (§5.7)"
else
	fail "l'écran semble déduire un droit d'un RÔLE : $(printf '%s' "$role" | head -3 | tr '\n' ' ')"
fi

# `docs/SPEC-goals.md` §5.7.4, ligne c : le repli FERME. La comparaison est STRICTE à `true`, et un
# `!!` ou un `!== false` l'ouvrirait — `Boolean('true')` comme `Boolean('false')` valent `true`. Le
# scénario unitaire le tient, mais il est ici doublé parce que le SENS de ce repli est la seule
# décision de la tranche qu'une réécriture de confort peut inverser sans en avoir l'air.
if grep -qE "ecriture_permise === true" "$LECTURE"; then
	ok "la capacité se lit par une comparaison STRICTE à « true » — l'absence FERME (§5.7.4, ligne c)"
else
	fail "« ecritureConsentie » ne compare plus strictement à « true » : une colonne absente ouvrirait l'écriture"
fi

# `docs/SCHEMA.md` §9 bis.8 bis : la colonne calculée est `security invoker`. En `definer`, elle
# répondrait pour son propriétaire — qui traverse la RLS — et rendrait « true » à TOUT LE MONDE :
# l'état de lecture seule ne paraîtrait jamais, et toutes les preuves de l'écran resteraient vertes
# côté administratrice. La suite pgTAP le tient en base ; ce contrôle-ci tient le FICHIER, de sorte
# qu'une migration réécrite se voie avant d'être appliquée.
if grep -qE "security[[:space:]]+definer" "$MIGRATION_CAPACITE"; then
	fail "$(basename "$MIGRATION_CAPACITE") déclare « security definer » : la colonne rendrait « true » à tout appelant"
else
	ok "la migration de la capacité n'est pas « security definer » — l'état de lecture seule peut paraître"
fi

# `docs/SPEC-goals.md` §5.1 : le nombre de blocs de la liste est celui que le BACKEND consent à
# l'appelant. Un total stocké le rendrait faux pour la lectrice, à qui la RLS en masque un — et
# l'écran afficherait six là où elle en voit cinq. La forme sous laquelle ce total arriverait est
# une colonne de comptage sur `goal_boards`.
if docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
	compteurs=$(psql_db -c "select string_agg(column_name, ',' order by column_name)
		from information_schema.columns
		where table_schema='public' and table_name='goal_boards'
		  and (column_name like '%count%' or column_name like '%_total%' or column_name like 'nb_%')")
	if [ -z "$compteurs" ]; then
		ok "goal_boards ne porte AUCUNE colonne de comptage — le nombre de blocs vient du backend, par appelant (§5.1)"
	else
		fail "goal_boards porte « $compteurs » : un total stocké mentirait à qui la RLS masque un bloc"
	fi

	# Le seed doit porter de quoi rendre les états du §5.4 : sans ses six blocs et ses quatre
	# flèches, les preuves d'interface mesureraient un tableau vide et resteraient vertes.
	blocs=$(psql_db -c "select count(*) from public.goal_blocks where board_id='$TABLEAU_SEED'")
	fleches=$(psql_db -c "select count(*) from public.goal_links where board_id='$TABLEAU_SEED'")
	if [ "$blocs" = '6' ] && [ "$fleches" = '4' ]; then
		ok "le seed porte SIX blocs et QUATRE flèches — le canevas a de quoi se rendre"
	else
		fail "le seed porte « $blocs » bloc(s) et « $fleches » flèche(s), six et quatre attendus — appliquez supabase/seed/apply-seed.sh"
	fi
else
	fail "le conteneur $DB_CONTAINER ne répond pas : la pile doit tourner (./runDev.sh)"
fi

# --- 4. Vitest — la lecture, l'écriture et l'écran ----------------------------------------------

titre "4. Vitest — la lecture, l'écriture et l'écran"

vitest_ou_echoue() {
	local libelle=$1 motif=$2 journal=$3
	if npm run test:unit -- --run "$motif" >"$journal" 2>&1; then
		ok "$libelle : $(grep -oE 'Tests +[0-9]+ passed' "$journal" | tail -1)"
	else
		fail_journal "$libelle ÉCHOUE" "$journal"
	fi
}

vitest_ou_echoue "vitest $TEST_LECTURE"  'lib/objectifs.test'          "$TRAVAIL/vitest-lecture.log"
vitest_ou_echoue "vitest $TEST_ECRITURE" 'lib/objectifs-ecriture.test' "$TRAVAIL/vitest-ecriture.log"
vitest_ou_echoue "vitest $TEST_ECRAN"    'app/Objectifs.test'          "$TRAVAIL/vitest-ecran.log"

# --- 5, 6. Les preuves longues ------------------------------------------------------------------

if [ "$RAPIDE" = true ]; then
	titre "5. Preuves longues"
	ok "--rapide : ni Playwright ni les dégradations ne sont exécutés (annoncé, non masqué)"
else
	titre "5. API — le refus du viewer, mesuré HORS interface"

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		ok "e2e api ($SPEC_API) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1)"
	else
		fail_journal "les refus d'API ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	titre "6. UI — le canevas sur la pile seedée, au clavier et à la souris"

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		ok "e2e ui ($SPEC_UI) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1) au clavier et à la souris"
	else
		fail_journal "le parcours du canevas d'objectifs ÉCHOUE" "$TRAVAIL/ui.log"
	fi

	# LES PREUVES D'ÉCRITURE REMETTENT LE SEED EN ÉTAT, et c'est constaté plutôt que supposé : une
	# fixture survivante ferait dériver les comptes des scénarios de lecture à l'exécution
	# suivante, et les captures avec eux.
	if docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
		restes=$(psql_db -c "select count(*) from public.goal_blocks where board_id='$TABLEAU_SEED'")
		if [ "$restes" = '6' ]; then
			ok "les preuves d'interface RENDENT le seed intact — toujours six blocs"
		else
			fail "« $restes » bloc(s) après les preuves d'interface, six attendus : une fixture survit et le seed dérive"
		fi
	fi

	# --- 7. Non-complaisance --------------------------------------------------------------------
	# Un harnais qui ne peut pas échouer ne prouve rien. Chaque dégradation porte sur une règle que
	# `docs/SPEC-goals.md` ÉNONCE, et la suite qui devrait la voir est rejouée.

	titre "7. Non-complaisance — chaque dégradation doit faire ÉCHOUER une preuve"

	if npm run test:unit -- --run 'lib/objectifs' >"$TRAVAIL/temoin.log" 2>&1; then
		ok "témoin : les deux modules sont VERTS avant toute dégradation"
	else
		fail_journal "témoin ROUGE : les suites ne mesurent plus rien" "$TRAVAIL/temoin.log"
	fi

	degrader() {
		local libelle=$1 fichier=$2 motif=$3 remplacement=$4 suite=$5
		sauvegarder "$fichier"
		if ! grep -qF "$motif" "$fichier"; then
			fail "dégradation INAPPLICABLE, motif introuvable : $libelle"
			return
		fi
		python3 - "$fichier" "$motif" "$remplacement" <<-'PY'
			import sys
			chemin, motif, remplacement = sys.argv[1], sys.argv[2], sys.argv[3]
			source = open(chemin, encoding='utf-8').read()
			open(chemin, 'w', encoding='utf-8').write(source.replace(motif, remplacement, 1))
		PY
		if ! grep -qF "$remplacement" "$fichier"; then
			fail "dégradation NON APPLIQUÉE : $libelle"
			rendre "$fichier"
			return
		fi
		if npm run test:unit -- --run "$suite" >"$TRAVAIL/degrade.log" 2>&1; then
			fail "dégradation NON VUE : $libelle"
		else
			ok "dégradation vue : $libelle"
		fi
		rendre "$fichier"
	}

	# LA DÉGRADATION LA PLUS IMPORTANTE DE CET ÉCRAN (§5.4, §4.1) : le moignon tracé vers le vide
	# porterait son libellé. Le libellé d'une flèche parle de ses deux extrémités — l'afficher
	# NOMMERAIT ce que la RLS masque, et l'écran ne nomme jamais ce qu'il cache.
	degrader "le moignon vers le vide porte son libellé — l'écran nommerait ce que la RLS masque (§5.4)" \
		"$LECTURE" "libelle: orpheline ? null : fleche.label" "libelle: fleche.label" \
		'lib/objectifs.test'

	# La même règle, du côté de l'équivalent textuel (§5.5) : un lecteur d'écran ne doit pas
	# apprendre par le texte ce que le dessin s'interdit de montrer.
	degrader "l'équivalent textuel NOMME l'extrémité masquée — le texte dirait ce que le dessin cache (§5.5)" \
		"$LECTURE" "const source = titres.get(fleche.source_block_id) ?? ''" \
		"const source = titres.get(fleche.source_block_id) ?? 'bloc masqué'" \
		'lib/objectifs.test'

	# §5.3 : « tracées entre les BORDS des blocs ». Le maximum au lieu du minimum place le point
	# HORS du rectangle : le trait partirait du vide, et le dessin cesserait d'être lisible.
	degrader "le point de bord sort du bloc — les flèches ne partiraient plus de leur bord (§5.3)" \
		"$LECTURE" "const facteur = Math.min(facteurX, facteurY)" \
		"const facteur = Math.max(facteurX, facteurY)" \
		'lib/objectifs.test'

	# §5.5 : « tabulation entre les blocs dans l'ordre de leur POSITION ». Sans le tri vertical,
	# l'ordre du clavier redeviendrait celui du serveur — le canevas resterait « utilisable » au
	# clavier, dans un ordre qui ne veut rien dire.
	degrader "l'ordre de tabulation abandonne la position verticale — le clavier suivrait le serveur (§5.5)" \
		"$LECTURE" "if (gauche.pos_y !== droite.pos_y) return gauche.pos_y - droite.pos_y" \
		"if (false) return 0" \
		'lib/objectifs.test'

	# §1 et §2.2 : `fill_percent` est un ENTIER saisi à la main. Une décimale suggérerait un
	# calcul, et la base refuserait la valeur — l'écran perdrait la saisie sans rien dire.
	degrader "le remplissage cesse d'être un entier — la décimale suggère un calcul (§1, §2.2)" \
		"$ECRITURE" "Math.round(nombre)" "nombre" \
		'lib/objectifs-ecriture.test'

	# §2.3 : « changer la direction d'une flèche existante est une MODIFICATION, pas un ajout ».
	# Classer le statut HTTP avant le code PostgreSQL ferait dire « indisponible, réessayez » là où
	# le geste à faire est d'aller corriger la flèche déjà tracée.
	degrader "le statut HTTP est classé avant le code PostgreSQL — le doublon deviendrait un refus générique (§2.3)" \
		"$ECRITURE" "	if (code === CODE_DOUBLON) return { nature: 'doublon', detail }" \
		"	if (statutHttp === 401 || statutHttp === 403) return { nature: 'interdit', detail }
	if (code === CODE_DOUBLON) return { nature: 'doublon', detail }" \
		'lib/objectifs-ecriture.test'

	# §5.5 et INC-165 : un DÉPLACEMENT n'envoie que la position. Renvoyer la taille à chaque
	# écriture écraserait le redimensionnement d'un collègue avec la valeur chargée — le défaut
	# que la tranche 2a a trouvé par la preuve, et qu'une régression réintroduirait sans bruit.
	degrader "un déplacement réécrit la TAILLE — il écraserait le redimensionnement d'un collègue (§3)" \
		"$ECRITURE" "	if (geometrie.largeur !== undefined) {" \
		"	if (true) {" \
		'lib/objectifs-ecriture.test'

	# TRANCHE 3, §5.7.4 ligne c : le repli de la capacité FERME. `!== false` l'ouvrirait dès que la
	# colonne est absente — cache de schéma PostgREST périmé, migration non appliquée —, et l'écran
	# rendrait alors des commandes dont chaque envoi serait refusé : l'état exact que cette tranche
	# supprime. C'est la décision de la tranche la plus facile à inverser par une réécriture de
	# confort, et la dégradation est ce qui l'empêche.
	degrader "l'absence de la capacité OUVRE l'écriture — la commande promettrait un envoi refusé (§5.7.4, ligne c)" \
		"$LECTURE" "return tableau?.ecriture_permise === true" \
		"return tableau?.ecriture_permise !== false" \
		'lib/objectifs.test'

	titre "8. Restauration"

	if npm run test:unit -- --run 'lib/objectifs' >"$TRAVAIL/restaure.log" 2>&1; then
		ok "les deux modules redeviennent VERTS après restauration"
	else
		fail_journal "les suites restent ROUGES après restauration : le dépôt n'est pas rendu intact" "$TRAVAIL/restaure.log"
	fi
fi

# --- Bilan --------------------------------------------------------------------------------------

titre "Bilan"

if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%s contrôles, aucune anomalie.\033[0m\n\n' "$checks"
	exit 0
fi

printf '  \033[31m%s contrôles, %s en échec.\033[0m\n\n' "$checks" "$failures"
exit 1
