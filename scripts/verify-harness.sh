#!/usr/bin/env bash
# @verifies CRM-008 (docs/BACKLOG.md) — Definition of Done du harnais de tests
# @verifies docs/SPEC-test-harness.md §3 (exécuteur pgTAP), §4 (projets Playwright),
#           §5 (rapport), §7 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §7 (preuve de refus n° 11)
# @verifies docs/JOURNAL.md décisions 48 à 51, décision 79 (faux vert du plan pgTAP)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-008` :
#
#   1. les prérequis sont réunis, et le script le dit plutôt que de mesurer autre chose ;
#   2. `npm run test:sql` exécute les trois suites pgTAP et rend le compte attendu ;
#   3. `npm run e2e:api` est vert sur ses treize scénarios, hors interface ;
#   4. `npm run e2e:api` ne construit **ni ne sert** la webapp — mesuré en supprimant le build
#      avant l'exécution et en constatant qu'il n'a pas été recréé ;
#   5. `npm run e2e:ui` reste vert : le renommage du projet n'a rien cassé ;
#   6. `npm run test:unit` reste vert ;
#   7. `npm run typecheck` reste vert, les fichiers `e2e/` étant couverts par tsconfig.tools.json ;
#   8. `npm run e2e:report` sert réellement le dernier rapport — interrogé en HTTP, pas supposé ;
#   9. le harnais est **non complaisant** : sept dégradations réelles doivent le faire échouer,
#      dont la régression d'un faux vert **réel** de l'exécuteur (décision 79) ;
#  10. tout ce qui a été altéré est restauré, et l'état final est **constaté**.
#
# Le script ne démarre ni n'arrête la pile : elle doit tourner (`./runDev.sh`), et le seed doit
# être appliqué (`supabase/seed/apply-seed.sh`). Tout ce qu'il altère est restauré par un `trap`,
# y compris en cas d'interruption.
#
# Usage :
#   scripts/verify-harness.sh

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
SUITE_MUTABLE=supabase/tests/0003_seed_socle.test.sql
TEST_FAUX=webapp/src/lib/non-complaisance.tmp.test.ts
# Suite jetable de la dégradation 9.6 : un plan tenu ligne pour ligne, mais des dernières
# assertions prises dans un savepoint annulé (docs/JOURNAL.md, décision 79).
SUITE_FAUX_VERT=supabase/tests/9999_non_complaisance_plan.tmp.test.sql
POLITIQUE=preuve_non_complaisance_crm_008
PORT_RAPPORT=9323

# Comptes attendus, révisés à chaque unité qui ajoute des preuves. Ils sont **figés** et non
# déduits : un exécuteur qui se contenterait de « le vert est vert » resterait vert si une suite
# entière cessait d'être découverte (docs/SPEC-test-harness.md §3). Le prix est cette révision
# explicite ; c'est exactement ce qu'on lui demande.
#
# Historique : 227 / 13 / 13 à `CRM-008` ; 306 / 30 / 22 puis 23 à `CRM-020` ; 374 / 50 / 37 à
# `CRM-021` ; 454 / 75 / 37 à `CRM-030` ; 559 / 96 / 37 à `CRM-031` ; 622 / 110 / 37 à `CRM-032` ;
# 653 / 125 / 37 à `CRM-033` ; 717 / 150 / 37 à `CRM-035` ; 1051 / 242 / 37 à `CRM-036` ;
# 1093 / 254 / 37 à `CRM-013` ; 1139 / 291 / 37 à `CRM-014` ;
# **1164 / 291 / 37 depuis la reprise de `CRM-010`**.
#
# LES COMPTEURS ÉTAIENT RESTÉS À LEUR VALEUR DE `CRM-035`, ET LE FAIT EST NOMMÉ PLUTÔT QUE CORRIGÉ
# EN SILENCE. Trois unités livrées entre-temps — `CRM-012`, `CRM-040` et `CRM-034` — ont ajouté des
# assertions et des scénarios sans réviser ces deux valeurs : ce harnais rendait donc « vert mais N
# au lieu de 717 » à chaque exécution depuis. C'est exactement le comportement voulu — le contrôle
# a bien dénoncé l'écart — mais la révision, elle, avait été omise. `CRM-036` la fait, et pour les
# quatre unités à la fois : les valeurs ci-dessous sont MESURÉES le 2026-08-05, non déduites.
#
# Les compteurs ont **réellement échoué** à chaque livraison qui les dépassait, comme prévu, et
# sont révisés dans le même changement que les preuves qu'ils comptent. C'est le seul mode de
# fonctionnement acceptable : les déduire de l'exécution reviendrait à supprimer le contrôle.
# RÉVISÉS À `CRM-013`, DANS LE MÊME CHANGEMENT QUE LES PREUVES QU'ILS COMPTENT — et cette fois
# sans retard, à la différence de `CRM-036` qui rattrapait quatre unités. L'unité ajoute
# `supabase/tests/0015_colonnes_protegees.test.sql` (41 assertions), une assertion à
# `supabase/tests/0007_workflows.test.sql` (INC-056) et `e2e/api/colonnes-protegees.spec.ts`
# (12 scénarios) : 1051 + 42 = 1093, et 242 + 12 = 254. Les deux valeurs sont MESURÉES.
#
# RÉVISÉS DE NOUVEAU À `CRM-014`, dans le même changement, et sans retard non plus. L'unité ajoute
# `supabase/tests/0016_preuves_refus.test.sql` (46 assertions) et
# `e2e/api/preuves-refus.spec.ts` (37 scénarios) : 1093 + 46 = 1139, et 254 + 37 = 291. Les deux
# valeurs sont MESURÉES le 2026-08-05, non déduites.
#
# RÉVISÉS UNE TROISIÈME FOIS, LE 2026-08-05, PAR LA REPRISE DE `CRM-010` — et le contrôle a bien
# échoué avant d'être révisé, « vert mais 1164 au lieu de 1139 ». L'unité n'ajoute aucun fichier :
# elle **étend** `supabase/tests/0002_fonctions_autorisation.test.sql` de 128 à 153 assertions, ses
# quatre fonctions `can_*` n'ayant jamais eu de preuve portée par leur propre unité (INC-013, close).
# 1139 + 25 = 1164. Ni le projet `api` ni le projet `ui` ne changent : l'unité ne livre ni route ni
# écran. Valeur MESURÉE, non déduite.
# RÉVISÉS UNE QUATRIÈME FOIS, LE 2026-08-05, PAR `CRM-037` — et les deux compteurs de scénarios ont
# bien échoué avant d'être révisés. L'unité livre le rendu du formulaire conditionnel et son écran
# hôte : **15 scénarios d'API** (`e2e/api/rendu-formulaire.spec.ts`, le tableau de cas partagé du
# §4.3 jugé par la base) et **10 scénarios d'interface** (`e2e/ui/formulaire.spec.ts`).
# 291 + 15 = 306 ; 37 + 10 = 47. `ASSERTIONS_ATTENDUES` est inchangée : l'unité n'ajoute aucune
# assertion pgTAP, ses preuves de base passant par la vraie route et non par une suite SQL.
# Valeurs MESURÉES, non déduites.
#
# RÉVISÉS UNE CINQUIÈME FOIS, LE 2026-08-05, PAR LA REPRISE DE `CRM-037` — le §4.6 bis de
# `docs/SPEC-form-composer.md`, qui donne enfin ses onglets à la route d'une card. L'unité ajoute
# **3 scénarios d'interface** à `e2e/ui/formulaire.spec.ts` : le track de l'adresse réellement
# demandé par un anonyme, la requête de channels filtrée sur `track_id`, et l'onglet courant seul à
# porter `aria-current="page"`. 47 + 3 = 50. Valeur MESURÉE, non déduite.
#
# **ET `SCENARIOS_API` ÉTAIT RESTÉ EN ARRIÈRE, D'UNE RÉVISION QUI N'AVAIT PAS ÉTÉ FAITE.** MESURÉ le
# 2026-08-05 : `npm run e2e:api` rend **308** scénarios, pas 306. La correction du prédicat
# « renseigné » (décision 165) avait ajouté **deux cas** au tableau de cas partagé du §4.3 —
# `"\t"` et `"\n"` —, donc deux scénarios à `e2e/api/rendu-formulaire.spec.ts`, qui passe de 15 à
# **17**, sans que ce compteur ne soit révisé dans le même changement. Le contrôle a fait
# exactement ce qu'on lui demande — il aurait rendu « vert mais 308 au lieu de 306 » — mais la
# révision, elle, avait été omise, comme à `CRM-036` pour quatre unités à la fois. Elle est faite
# ici. `ASSERTIONS_ATTENDUES` reste à 1164 : aucune assertion pgTAP n'est ajoutée par l'une ni par
# l'autre de ces deux reprises.
#
# RÉVISÉS UNE SIXIÈME FOIS, LE 2026-08-05, PAR `CRM-041` — le board kanban. L'unité livre
# **24 scénarios d'API** (`e2e/api/board.spec.ts`, les quatre lectures du §7.2 confrontées à la
# pile réelle avec le jeton de l'administratrice, et le refus opposé à l'anonyme) et
# **21 scénarios d'interface** (`e2e/ui/board.spec.ts`, dont la vidéo du glisser-déposer et les
# quatre paliers). 308 + 24 = 332 ; 50 + 21 = 71. `ASSERTIONS_ATTENDUES` est inchangée : l'unité ne
# livre ni table, ni fonction, ni politique — son objet est un écran, et la garde qu'il exerce est
# déjà couverte par la suite pgTAP de `CRM-034`. Valeurs MESURÉES, non déduites.
#
# RÉVISÉS UNE SEPTIÈME FOIS, LE 2026-08-05, PAR `CRM-042` — la vue liste. L'unité livre
# **26 scénarios d'API** (`e2e/api/liste-cards.spec.ts` : les deux lectures du §12.3, les quatre
# tris, `nullslast` et sa contre-épreuve, la marche paginée sans doublon, les deux filtres, la
# frontière du `416` à un rang près, le `count=planned` faux, et le refus opposé à l'anonyme) et
# **27 scénarios d'interface** (`e2e/ui/liste-cards.spec.ts` : tableau, tri, filtres, pagination,
# `416`, bascule board ↔ liste, données longues et quatre paliers). 332 + 26 = 358 ;
# 72 + 27 = 99. `ASSERTIONS_ATTENDUES` est de nouveau inchangée : l'unité ne livre ni table, ni
# fonction, ni politique. Valeurs MESURÉES, non déduites.
# RÉVISÉS UNE HUITIÈME FOIS, LE 2026-08-05, PAR `CRM-043` — les commentaires. L'unité livre une
# TABLE, ce que les deux précédentes ne faisaient pas : `ASSERTIONS_ATTENDUES` bouge donc enfin.
# `supabase/tests/0017_commentaires.test.sql` compte **84 assertions** (forme, unicité ajoutée à
# `cards`, dérivation du workspace, `CHECK` conditionnel, pierre tombale, `edited_at`, colonnes
# gelées, trois politiques, privilèges de colonne, publication de temps réel, conformité du seed).
# DEUX assertions antérieures ont en outre été RÉVISÉES sans changer le total — celles qui
# constataient l'absence de `card_comments` dans `0012_cards` et `0013_move_card` —, et deux
# assertions s'y sont ajoutées : 1164 + 84 + 2 = 1250. `e2e/api/commentaires.spec.ts` livre
# **17 scénarios** (les seize lignes du contrat du §13.8, plus le temps réel avec son témoin) :
# 358 + 17 = 375. `SCENARIOS_UI` est inchangé — le panneau de commentaires n'est pas livré à cette
# étape, et l'unité reste `[~]`. Valeurs MESURÉES, non déduites.
ASSERTIONS_ATTENDUES=1250
SCENARIOS_API=375
# 37 depuis `CRM-021` : 13 scénarios de la route d'un track et de sa barre d'onglets
# (`e2e/ui/channels.spec.ts`). Inchangé à `CRM-030`, `CRM-031`, `CRM-032`, `CRM-033` puis
# `CRM-035`, qui ne livrent aucune interface — ni le catalogue de nœuds, ni les workflows, ni la
# mention de divergence, ni l'affectation d'un workflow à un channel, ni la grille champ × étape
# n'ont d'écran. **`CRM-037` est la première unité du chunk 3 à en livrer un** : la route de détail
# d'une card, qui reste un écran d'appelant anonyme tant qu'INC-021 n'est pas tranchée.
# **50 depuis la reprise de `CRM-037`** : trois scénarios de plus pour la coquille de cet écran.
# **71 depuis `CRM-041`** : vingt et un scénarios de board — colonnes, menu de transitions, dépôt
# autorisé, dépôt refusé sans appel émis, retour arrière, saisie du motif exigé, quatre paliers et
# la vidéo du glisser-déposer.
# **72 après la correction de l'écart au §7.5** (décision 180) : un scénario de plus pour le repli
# du libellé d'une transition sans nom, que les dix transitions du seed ne peuvent pas exercer et
# qu'aucune preuve n'atteignait.
# **99 depuis `CRM-042`** : vingt-sept scénarios de vue liste — le tableau et ses cinq colonnes, le
# tri et son `aria-sort`, la clôture des clés de tri, les deux filtres, la pagination et son `416`,
# la bascule entre les deux vues, les données longues à deux paliers, et les quatre paliers.
# Valeur MESURÉE, non déduite.
SCENARIOS_UI=99

TRAVAIL=$(mktemp -d)
failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

# Tout ce que les contrôles de non-complaisance altèrent est restauré quoi qu'il arrive : la
# suite pgTAP mutée, le test unitaire faux, la politique RLS posée, et le serveur de rapport.
menage() {
	[ -f "$TRAVAIL/suite.sql" ] && cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"
	rm -f "$TEST_FAUX" "$SUITE_FAUX_VERT"
	psql_db -c "drop policy if exists \"$POLITIQUE\" on public.workspaces;" >/dev/null 2>&1 || true
	[ -n "${PID_RAPPORT:-}" ] && kill "$PID_RAPPORT" 2>/dev/null || true
	rm -rf "$TRAVAIL"
}
trap menage EXIT

echo
echo "Preuves de CRM-008 — harnais de tests"
echo

# --- 1. Prérequis ------------------------------------------------------------------------------

echo "1. Prérequis"

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh." >&2
	exit 1
fi
if ! docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

comptes_seed=$(psql_db -c "select count(*) from public.profiles where id::text like '5eed%';")
if [ "$comptes_seed" -ge 3 ]; then
	ok "pile démarrée et seed appliqué ($comptes_seed profils seedés)"
else
	echo "ERREUR : seed non appliqué. Lancez supabase/seed/apply-seed.sh." >&2
	exit 1
fi

cp "$SUITE_MUTABLE" "$TRAVAIL/suite.sql"

# --- 2. npm run test:sql -----------------------------------------------------------------------

echo
echo "2. npm run test:sql — suites pgTAP"

if npm run --silent test:sql >"$TRAVAIL/sql.log" 2>&1; then
	assertions=$(grep -oE '[0-9]+ assertions, aucune anomalie' "$TRAVAIL/sql.log" | grep -oE '^[0-9]+' || echo 0)
	if [ "${assertions:-0}" -eq "$ASSERTIONS_ATTENDUES" ]; then
		ok "npm run test:sql : 3 fichiers, $assertions assertions, aucune anomalie"
	else
		fail "npm run test:sql vert mais $assertions assertions au lieu de $ASSERTIONS_ATTENDUES"
	fi
else
	fail "npm run test:sql échoue"
	sed 's/^/        /' "$TRAVAIL/sql.log" | tail -n 20
fi

# --- 3. npm run e2e:api ------------------------------------------------------------------------

echo
echo "3. npm run e2e:api — contrats et refus, hors interface"

if npm run --silent e2e:api >"$TRAVAIL/api.log" 2>&1; then
	passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -n 1 | grep -oE '^[0-9]+' || echo 0)
	if [ "${passes:-0}" -eq "$SCENARIOS_API" ]; then
		ok "npm run e2e:api : $passes scénarios verts (A1 à A6, preuve de refus n° 11 comprise)"
	else
		fail "npm run e2e:api vert mais $passes scénarios au lieu de $SCENARIOS_API"
	fi
else
	fail "npm run e2e:api échoue"
	sed 's/^/        /' "$TRAVAIL/api.log" | tail -n 25
fi

# --- 4. Le projet `api` ne construit ni ne sert la webapp --------------------------------------
# Mesuré, et non déduit de l'absence de `webServer` dans la configuration : le build est
# supprimé avant l'exécution. S'il réapparaît, c'est que `npm run build && npm run preview` a
# tourné — ce que la décision 49 vise précisément à éviter.

echo
echo "4. Le projet api ne démarre aucun serveur web"

rm -rf webapp/dist
npm run --silent e2e:api >/dev/null 2>&1 || true
if [ ! -e webapp/dist ]; then
	ok "webapp/dist n'a pas été recréé : aucun build, aucun serveur de prévisualisation"
else
	fail "webapp/dist a été recréé : le webServer a démarré pour le projet api"
fi

# --- 5. npm run e2e:ui -------------------------------------------------------------------------

echo
echo "5. npm run e2e:ui — projet d'interface de CRM-007, non régressé"

if npm run --silent e2e:ui >"$TRAVAIL/ui.log" 2>&1; then
	passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -n 1 | grep -oE '^[0-9]+' || echo 0)
	if [ "${passes:-0}" -eq "$SCENARIOS_UI" ]; then
		ok "npm run e2e:ui : $passes scénarios verts contre le build servi"
	else
		fail "npm run e2e:ui vert mais $passes scénarios au lieu de $SCENARIOS_UI"
	fi
else
	fail "npm run e2e:ui échoue"
	sed 's/^/        /' "$TRAVAIL/ui.log" | tail -n 25
fi

if [ -s webapp/dist/index.html ]; then
	ok "webapp/dist reconstruit par le projet ui : l'état d'avant le contrôle 4 est rétabli"
else
	fail "webapp/dist absent après le projet ui"
fi

# --- 6. npm run test:unit et 7. npm run typecheck ----------------------------------------------

echo
echo "6. npm run test:unit et npm run typecheck"

if npm run --silent test:unit >"$TRAVAIL/unit.log" 2>&1; then
	ok "npm run test:unit : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/unit.log" | tail -n 1)"
else
	fail "npm run test:unit échoue"
	sed 's/^/        /' "$TRAVAIL/unit.log" | tail -n 20
fi

if npm run --silent typecheck >"$TRAVAIL/tsc.log" 2>&1; then
	ok "npm run typecheck : quatre projets compilés, e2e/ compris"
else
	fail "npm run typecheck échoue"
	sed 's/^/        /' "$TRAVAIL/tsc.log" | tail -n 20
fi

# --- 8. npm run e2e:report ---------------------------------------------------------------------

echo
echo "8. npm run e2e:report — le dernier rapport est réellement servi"

if [ -s e2e/report/index.html ]; then
	ok "rapport HTML produit par la dernière exécution E2E"
else
	fail "aucun rapport HTML dans e2e/report/"
fi

PLAYWRIGHT_HTML_HOST=127.0.0.1 PLAYWRIGHT_HTML_PORT="$PORT_RAPPORT" \
	npm run --silent e2e:report >"$TRAVAIL/rapport.log" 2>&1 &
PID_RAPPORT=$!

code_rapport=000
for _ in $(seq 1 20); do
	code_rapport=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_RAPPORT/" || echo 000)
	[ "$code_rapport" = "200" ] && break
	sleep 1
done

if [ "$code_rapport" = "200" ]; then
	ok "npm run e2e:report sert le rapport sur le port $PORT_RAPPORT (HTTP 200 constaté)"
else
	fail "npm run e2e:report ne sert rien : dernier code obtenu $code_rapport"
	sed 's/^/        /' "$TRAVAIL/rapport.log" | tail -n 10
fi

kill "$PID_RAPPORT" 2>/dev/null || true
wait "$PID_RAPPORT" 2>/dev/null || true
PID_RAPPORT=

# --- 9. Non-complaisance -----------------------------------------------------------------------
# Chaque contrôle dégrade réellement le monde, exige l'échec, puis restaure. Un harnais qui
# n'échoue jamais ne prouve rien de ce qu'il affirme.

echo
echo "9. Non-complaisance : sept dégradations réelles doivent faire échouer le harnais"

# 9.1 — une assertion volontairement fausse dans une suite pgTAP réelle.
sed -i "s/'P2Enjoy SAS',/'P2Enjoy SARL',/" "$SUITE_MUTABLE"
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "une assertion fausse ne fait pas échouer npm run test:sql"
else
	ok "une assertion fausse fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.2 — plan non tenu ET `finish()` retiré : pgTAP n'émet alors AUCUN diagnostic (décision 48).
# C'est le contrôle qui prouve que le verdict est calculé, et non emprunté à pgTAP.
sed -i 's/^select plan(30);$/select plan(31);/' "$SUITE_MUTABLE"
sed -i 's/^select \* from finish();$//' "$SUITE_MUTABLE"
sortie_tronquee=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA \
	-v ON_ERROR_STOP=1 -f - < "$SUITE_MUTABLE" 2>&1 || true)
if printf '%s' "$sortie_tronquee" | grep -q 'Looks like you planned'; then
	fail "pgTAP diagnostique le plan tronqué : le contrôle ne prouve pas ce qu'il prétend"
else
	ok "pgTAP n'émet aucun diagnostic sans finish() — le verdict ne peut pas lui être emprunté"
fi
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "un plan non tenu sans finish() ne fait pas échouer npm run test:sql"
else
	ok "un plan non tenu sans finish() fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.3 — erreur SQL : `psql` sort en 3, l'exécuteur doit la relayer.
sed -i 's/^select plan(30);$/select plan(30);\nselect fonction_inexistante_crm_008();/' "$SUITE_MUTABLE"
if npm run --silent test:sql >/dev/null 2>&1; then
	fail "une erreur SQL ne fait pas échouer npm run test:sql"
else
	ok "une erreur SQL fait échouer npm run test:sql"
fi
cp "$TRAVAIL/suite.sql" "$SUITE_MUTABLE"

# 9.4 — politique RLS permissive réellement posée : le projet `api` doit la voir.
# C'est le contrôle décisif du projet `api` : sans lui, ses scénarios pourraient se contenter
# de constater une base vide au lieu de mesurer un refus.
psql_db -c "create policy \"$POLITIQUE\" on public.workspaces for select to anon using (true);" >/dev/null
lignes_anon=$(curl -s "http://127.0.0.1:$(sed -n 's/^KONG_HTTP_PORT=//p' .env | tail -1)/rest/v1/workspaces?select=id" \
	-H "apikey: $(sed -n 's/^ANON_KEY=//p' .env | tail -1)" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')
if [ "$lignes_anon" -ge 1 ]; then
	ok "la politique permissive est réellement effective : l'anonyme voit $lignes_anon ligne(s)"
else
	fail "la politique posée n'a aucun effet : le contrôle suivant ne prouverait rien"
fi
if npm run --silent e2e:api >/dev/null 2>&1; then
	fail "une politique RLS permissive ne fait pas échouer npm run e2e:api"
else
	ok "une politique RLS permissive fait échouer npm run e2e:api"
fi
psql_db -c "drop policy \"$POLITIQUE\" on public.workspaces;" >/dev/null

# 9.5 — un test unitaire volontairement faux.
cat > "$TEST_FAUX" <<'FAUX'
// Fichier temporaire créé par scripts/verify-harness.sh, supprimé par son trap.
import { expect, test } from 'vitest'
test('assertion volontairement fausse', () => { expect(1).toBe(2) })
FAUX
if npm run --silent test:unit >/dev/null 2>&1; then
	fail "un test unitaire faux ne fait pas échouer npm run test:unit"
else
	ok "un test unitaire faux fait échouer npm run test:unit"
fi
rm -f "$TEST_FAUX"

# 9.6 — plan tenu ligne pour ligne, mais dernières assertions dans un savepoint annulé.
# C'EST LA RÉGRESSION D'UN FAUX VERT RÉEL DE CET EXÉCUTEUR (docs/JOURNAL.md, décision 79). pgTAP
# tient deux comptes : la numérotation, portée par une séquence que rien n'annule, et le compte relu
# par `finish()`, porté par une table qu'un `rollback to savepoint` annule. Avant le cinquième
# contrôle du §3.2, l'exécuteur comparait `3` à `3`, ne trouvait aucun `not ok`, et rendait `0` sur
# une suite que pgTAP déclarait tronquée.
#
# Le contrôle est écrit en deux temps, et le premier compte autant que le second : il faut d'abord
# constater que la suite **émet bien** autant de lignes que son plan en annonce, sans quoi c'est le
# quatrième contrôle qui la refuserait et le cinquième ne prouverait rien.
cat > "$SUITE_FAUX_VERT" <<'FAUXVERT'
-- Fichier temporaire créé par scripts/verify-harness.sh, supprimé par son trap.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);
select ok(true, 'assertion hors savepoint');
savepoint s1;
select ok(true, 'assertion dans un savepoint annule');
select ok(true, 'derniere assertion, dans le meme savepoint');
rollback to s1;
select * from finish();
rollback;
FAUXVERT

sortie_faux_vert=$(docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA \
	-v ON_ERROR_STOP=1 -f - < "$SUITE_FAUX_VERT" 2>&1 || true)
emises_faux_vert=$(printf '%s\n' "$sortie_faux_vert" | grep -cE '^(not )?ok ' || true)
if [ "$emises_faux_vert" = "3" ] \
	&& printf '%s' "$sortie_faux_vert" | grep -q 'Looks like you planned 3 tests but ran 1'; then
	ok "la suite piégée émet bien ses 3 lignes tout en étant tronquée pour pgTAP : le quatrième contrôle ne la verrait pas"
else
	fail "la suite piégée n'a pas le comportement attendu ($emises_faux_vert ligne(s)) : le contrôle suivant ne prouverait rien"
fi

if npm run --silent test:sql >/dev/null 2>&1; then
	fail "un plan dénoncé par pgTAP ne fait pas échouer npm run test:sql — le faux vert de la décision 79 est de retour"
else
	ok "un plan dénoncé par pgTAP fait échouer npm run test:sql"
fi
rm -f "$SUITE_FAUX_VERT"

# --- 10. État final ----------------------------------------------------------------------------

echo
echo "10. Le harnais a tout restauré, et le constate"

if git diff --quiet -- "$SUITE_MUTABLE"; then
	ok "la suite pgTAP mutée est identique à sa version versionnée"
else
	fail "la suite pgTAP reste altérée : $(git diff --stat -- "$SUITE_MUTABLE" | tail -1)"
fi

if [ ! -e "$TEST_FAUX" ]; then
	ok "le test unitaire faux est supprimé"
else
	fail "le test unitaire faux subsiste : $TEST_FAUX"
fi

if [ ! -e "$SUITE_FAUX_VERT" ]; then
	ok "la suite pgTAP piégée est supprimée : supabase/tests/ ne contient que les sept suites livrées"
else
	fail "la suite pgTAP piégée subsiste : $SUITE_FAUX_VERT"
fi

politiques=$(psql_db -c "select count(*) from pg_policies where schemaname='public' and tablename='workspaces';")
if [ "$politiques" -eq 0 ]; then
	ok "aucune politique résiduelle sur public.workspaces : le refus par défaut est intact"
else
	fail "$politiques politique(s) subsistent sur public.workspaces"
fi

if npm run --silent test:sql >/dev/null 2>&1; then
	ok "npm run test:sql redevient vert après restauration"
else
	fail "npm run test:sql reste rouge après restauration"
fi

if npm run --silent e2e:api >/dev/null 2>&1; then
	ok "npm run e2e:api redevient vert après restauration"
else
	fail "npm run e2e:api reste rouge après restauration"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n\n' "$checks" "$failures"
exit 1
