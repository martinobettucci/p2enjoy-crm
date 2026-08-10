#!/usr/bin/env bash
# @verifies CRM-007 (docs/BACKLOG.md) — Definition of Done du squelette de la webapp
# @verifies docs/SPEC-webapp.md §4 (jetons), §6 (données), §7 (états), §12.3 (chunks), §14
# @verifies docs/DESIGN_SYSTEM.md §1 (palette), §5.8 (états), §7 (paliers), §10, §11
# @verifies docs/INCONSISTENCY_REPORT.md INC-020 (build dû par CRM-007)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-007` :
#
#   1. le build de production réussit, et il consomme réellement les types générés par
#      `CRM-006` — reprise explicite de la preuve dont INC-020 attendait le transfert ;
#   2. les quatre projets TypeScript compilent en mode strict ;
#   3. les jetons du design system sont ceux de docs/DESIGN_SYSTEM.md §1, déclarés **une seule
#      fois**, et aucune couleur hexadécimale n'existe hors du fichier de jetons ;
#   4. toute classe utilitaire citée par un composant est réellement engendrée ;
#   5. aucun texte visible n'est écrit en dur dans un composant ;
#   6. les tests unitaires passent ;
#   7. **hors interface**, la requête que la coquille adresse à PostgREST est rejouée avec la
#      clé anonyme puis avec le **jeton réel** d'un compte seedé, et comparée à l'état de la
#      base : c'est ce qui établit que l'état vide affiché est le refus du backend ;
#   8. les scénarios E2E passent contre le build servi, et les captures sont produites ;
#   9. le harnais est **non complaisant** : chaque dégradation réelle du produit le fait
#      échouer.
#
# Le script ne démarre ni n'arrête la pile : elle doit tourner (`./runDev.sh`), et le seed doit
# être appliqué (`supabase/seed/apply-seed.sh`). Tout ce qu'il altère est restauré par un
# `trap`, y compris en cas d'interruption, et l'état final est vérifié avant de conclure.
#
# Usage :
#   scripts/verify-webapp.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

DB_CONTAINER=p2enjoy-db
FICHIER_JETONS=webapp/src/styles/tokens.css
COMPTE_SEED=admin@p2enjoy.test
MOT_DE_PASSE_SEED=SeedDev2026Local
WORKSPACE_SEED=5eed0000-0000-4000-8000-000000000001

TRAVAIL=$(mktemp -d)
failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

# Les fichiers altérés par les contrôles de non-complaisance sont sauvegardés avant la première
# altération, et restaurés quoi qu'il arrive.
A_RESTAURER=(webapp/src/app/TabBar.tsx webapp/src/lib/workspaces.ts)

menage() {
	for fichier in "${A_RESTAURER[@]}"; do
		sauvegarde="$TRAVAIL/$(echo "$fichier" | tr '/' '_')"
		[ -f "$sauvegarde" ] && cp "$sauvegarde" "$fichier"
	done
	rm -rf "$TRAVAIL"
}
trap menage EXIT

echo
echo "Preuves de CRM-007 — squelette de la webapp"
echo

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example." >&2
	exit 1
fi
if [ ! -d node_modules ]; then
	echo "ERREUR : dépendances absentes. Lancez npm install." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || echo absent)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER non démarré. Lancez ./runDev.sh." >&2
	exit 1
fi

for fichier in "${A_RESTAURER[@]}"; do
	cp "$fichier" "$TRAVAIL/$(echo "$fichier" | tr '/' '_')"
done

ANON_KEY=$(sed -n 's/^ANON_KEY=//p' .env)
KONG_PORT=$(sed -n 's/^KONG_HTTP_PORT=//p' .env)
BASE_API="http://127.0.0.1:${KONG_PORT}"
export VITE_SUPABASE_URL="$BASE_API"
export VITE_SUPABASE_ANON_KEY="$ANON_KEY"

# --- 1. Build de production --------------------------------------------------------------------

echo "1. Build de production (reprise de la preuve due par INC-020)"

rm -rf webapp/dist
if npm run --silent build >"$TRAVAIL/build.log" 2>&1; then
	ok "npm run build : build de production vert"
else
	fail "npm run build échoue"
	sed 's/^/        /' "$TRAVAIL/build.log" | head -n 20
fi

if [ -f webapp/dist/index.html ]; then
	ok "webapp/dist/index.html produit"
else
	fail "webapp/dist/index.html absent"
fi

nb_js=$(find webapp/dist/assets -name '*.js' 2>/dev/null | wc -l)
nb_css=$(find webapp/dist/assets -name '*.css' 2>/dev/null | wc -l)
if [ "$nb_js" -ge 3 ] && [ "$nb_css" -ge 1 ]; then
	ok "actifs produits : $nb_js script(s), $nb_css feuille(s) de style"
else
	fail "découpage ou actifs manquants : $nb_js script(s), $nb_css feuille(s) ; au moins 3 scripts attendus"
fi

if grep -q 'Some chunks are larger than' "$TRAVAIL/build.log"; then
	fail "Vite signale encore un chunk supérieur à sa limite de 500 kB"
else
	ok "Vite ne signale aucun chunk supérieur à 500 kB, seuil par défaut inchangé"
fi

# La configuration de build est réellement injectée : sans elle, l'application afficherait son
# état de configuration incomplète au lieu d'interroger quoi que ce soit.
if grep -qF "$BASE_API" webapp/dist/assets/*.js; then
	ok "l'URL de l'API est injectée au build"
else
	fail "l'URL de l'API n'apparaît pas dans le bundle : la configuration n'a pas été injectée"
fi

# --- 2. Types générés réellement consommés ------------------------------------------------------

echo
echo "2. Types générés (CRM-006) réellement consommés par la webapp"

if grep -q "from './database.types'" webapp/src/lib/supabase.ts webapp/src/lib/workspaces.ts; then
	ok "le client et la couche d'accès importent les types générés"
else
	fail "les types générés ne sont importés par aucun module d'accès aux données"
fi

if npm run --silent typecheck >"$TRAVAIL/tsc.log" 2>&1; then
	ok "npm run typecheck : quatre projets compilés en mode strict"
else
	fail "npm run typecheck échoue"
	sed 's/^/        /' "$TRAVAIL/tsc.log" | head -n 20
fi

# Non-complaisance : les types doivent réellement contraindre les requêtes. Une colonne qui
# n'existe pas au schéma doit faire échouer la compilation.
sed -i "s/select('id, name, slug')/select('id, nom_inexistant, slug')/" webapp/src/lib/workspaces.ts
if npm run --silent typecheck >/dev/null 2>&1; then
	fail "une colonne inexistante compile : les types générés ne contraignent pas les requêtes"
else
	ok "une colonne inexistante fait échouer la compilation : le schéma contraint bien le code"
fi
cp "$TRAVAIL/webapp_src_lib_workspaces.ts" webapp/src/lib/workspaces.ts

# --- 3. Jetons du design system -----------------------------------------------------------------

echo
echo "3. Jetons du design system (docs/DESIGN_SYSTEM.md §1, §11)"

feuille=$(find webapp/dist/assets -name '*.css' | head -n 1)

# Chaque couleur de la charte n'existe qu'en **déclaration de jeton**. Le contrôle vise la
# déclaration, et non l'occurrence brute : Tailwind émet un repli statique pour les jetons
# calculés en `color-mix`, et ce repli fait légitimement réapparaître la valeur — ce n'est ni
# un hexadécimal de composant, ni une seconde déclaration.
for couleur in '#23468c' '#238c33' '#d9cf4a' '#f24141' '#0d0d0d' '#f7f8fa' '#e5e7eb'; do
	declarations=$(grep -o -- "--color-[a-z0-9-]*:${couleur}\b" "$feuille" | wc -l)
	if [ "$declarations" -eq 1 ]; then
		ok "$couleur : une seule déclaration de jeton dans le CSS produit"
	else
		fail "$couleur : $declarations déclarations de jeton — un jeton se déclare une seule fois"
	fi
done

# Et surtout : aucune couleur **de la charte** dans le corps d'une règle de classe. C'est là
# que se logerait un hexadécimal de composant, et c'est ce que docs/DESIGN_SYSTEM.md §11
# interdit. Le contrôle vise les couleurs de la charte, et non tout hexadécimal : Tailwind
# compile `transparent` en `#0000` et inline la couleur d'ombre du jeton `--shadow-card` — deux
# artefacts de transparence, sans rapport avec la palette.
hex_dans_utilitaires=$(python3 - "$feuille" <<'PY'
import re, sys
CHARTE = ('23468c', '1b3670', '238c33', 'd9cf4a', 'f24141', '0d0d0d', 'f7f8fa', 'e5e7eb',
          '374151', '4b5563', '6b7280', 'f3f4f6')
css = open(sys.argv[1], encoding='utf-8').read()
motif = re.compile('#(' + '|'.join(CHARTE) + ')', re.IGNORECASE)
fautifs = [
    regle for regle in re.findall(r'\.[^{}@]{1,200}\{[^{}]*\}', css)
    if motif.search(regle)
]
print(' | '.join(fautifs[:3]))
PY
)
if [ -z "$hex_dans_utilitaires" ]; then
	ok "aucune couleur littérale dans le corps d'une règle de classe"
else
	fail "couleur littérale dans une règle de classe : $hex_dans_utilitaires"
fi

if grep -q -- '--color-brand:#23468c' "$feuille"; then
	ok "les jetons sont émis en variables CSS"
else
	fail "les jetons ne sont pas émis en variables CSS"
fi

if grep -q -- '\.bg-brand{background-color:var(--color-brand)}' "$feuille"; then
	ok "les utilitaires référencent les jetons au lieu de recopier leur valeur"
else
	fail "les utilitaires ne référencent pas les jetons"
fi

# La palette par défaut de Tailwind est remise à zéro : aucune couleur hors design system ne
# doit pouvoir être écrite.
if grep -q -- '--color-red-500\|--color-slate-500\|--color-blue-500' "$feuille"; then
	fail "la palette par défaut de Tailwind subsiste : des couleurs hors charte sont écrivables"
else
	ok "la palette par défaut de Tailwind est absente : seules les couleurs de la charte existent"
fi

hex_hors_jetons=$(grep -rIl --include='*.ts' --include='*.tsx' --include='*.css' -E '#[0-9a-fA-F]{3,8}\b' webapp/src | grep -v "^${FICHIER_JETONS}$" || true)
if [ -z "$hex_hors_jetons" ]; then
	ok "aucune couleur hexadécimale hors de $FICHIER_JETONS"
else
	fail "couleur hexadécimale hors des jetons : $hex_hors_jetons"
fi

# --- 4. Classes utilitaires réellement engendrées ------------------------------------------------

echo
echo "4. Classes utilitaires engendrées (garde des espaces de noms remis à zéro)"

if node scripts/lib/classes-css.mjs webapp/src webapp/dist/assets >"$TRAVAIL/classes.log" 2>&1; then
	ok "$(tail -n 2 "$TRAVAIL/classes.log" | head -n 1) — aucune classe manquante"
else
	fail "des classes citées ne sont pas engendrées"
	sed 's/^/        /' "$TRAVAIL/classes.log" | head -n 5
fi

# Non-complaisance : un espacement hors de l'échelle fermée n'existe pas, et doit être vu.
#
# La cible de ces dégradations est la barre d'onglets, dont `CRM-021` a réécrit la classe. Les
# motifs ci-dessous ont donc été **révisés dans le même changement** que le composant : une
# substitution qui ne s'applique plus dégrade zéro ligne, le contrôle de non-complaisance passe
# alors sans rien mesurer, et le harnais devient complaisant en silence. Il a réellement échoué
# à la livraison de `CRM-021`, ce qui est le comportement voulu.
sed -i 's/gap-2 px-4 bg-bg/gap-2 px-7 bg-bg/' webapp/src/app/TabBar.tsx
if node scripts/lib/classes-css.mjs webapp/src webapp/dist/assets >/dev/null 2>&1; then
	fail "un espacement hors échelle passe inaperçu"
else
	ok "un espacement hors échelle (px-7) fait échouer le contrôle"
fi
cp "$TRAVAIL/webapp_src_app_TabBar.tsx" webapp/src/app/TabBar.tsx

# --- 5. Aucun texte visible en dur ---------------------------------------------------------------

echo
echo "5. Internationalisation (docs/DESIGN_SYSTEM.md §10)"

# Contrôle indépendant du test unitaire : il vise les attributs visibles, que le dictionnaire
# doit alimenter comme le reste.
attributs_durs=$(grep -rn --include='*.tsx' -E '(title|aria-label|placeholder|alt)="[^"]*[[:alpha:]]{2,}[^"]*"' webapp/src \
	| grep -v '\.test\.tsx' | grep -vE '(aria-hidden|="true"|="false"|="polite"|="page"|="status")' || true)
if [ -z "$attributs_durs" ]; then
	ok "aucun attribut visible écrit en dur"
else
	fail "attribut visible écrit en dur :"
	echo "$attributs_durs" | sed 's/^/        /' | head -n 5
fi

# Non-complaisance, éprouvée en dégradant réellement le produit puis en le rebuildant :
# une couleur écrite dans un composant doit être vue à la source **et** dans le CSS produit,
# et un texte visible en dur doit faire échouer les tests unitaires.
sed -i 's|bg-bg border-b border-border overflow-x-auto|bg-[#23468c] border-b border-border overflow-x-auto|' webapp/src/app/TabBar.tsx
sed -i 's|{t('"'"'tabs.empty'"'"')}|Aucun channel pour le moment|' webapp/src/app/TabBar.tsx
npm run --silent build >/dev/null 2>&1 || true

if grep -rIl --include='*.tsx' -E '#[0-9a-fA-F]{3,8}\b' webapp/src >/dev/null 2>&1; then
	ok "une couleur écrite dans un composant est vue à la source"
else
	fail "une couleur écrite dans un composant passe inaperçue à la source"
fi

feuille_degradee=$(find webapp/dist/assets -name '*.css' | head -n 1)
if python3 -c "
import re, sys
css = open('$feuille_degradee', encoding='utf-8').read()
sys.exit(0 if re.search(r'\.[^{}@]{1,200}\{[^{}]*#23468c', css) else 1)
"; then
	ok "une couleur écrite dans un composant est vue dans le CSS produit"
else
	fail "une couleur écrite dans un composant n'apparaît pas dans le CSS produit"
fi

if npm run --silent test:unit >/dev/null 2>&1; then
	fail "un texte visible en dur ne fait pas échouer les tests unitaires"
else
	ok "un texte visible en dur fait échouer les tests unitaires"
fi

cp "$TRAVAIL/webapp_src_app_TabBar.tsx" webapp/src/app/TabBar.tsx
npm run --silent build >/dev/null 2>&1

nb_cles=$(grep -c "^	'" webapp/src/i18n/fr.ts || true)
if [ "$nb_cles" -ge 30 ]; then
	ok "dictionnaire français : $nb_cles clés"
else
	fail "dictionnaire suspicieusement court : $nb_cles clés"
fi

# --- 6. Tests unitaires ---------------------------------------------------------------------------

echo
echo "6. Tests unitaires"

if npm run --silent test:unit >"$TRAVAIL/unit.log" 2>&1; then
	ok "npm run test:unit : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/unit.log" | tail -n 1)"
else
	fail "npm run test:unit échoue"
	sed 's/^/        /' "$TRAVAIL/unit.log" | tail -n 20
fi

# --- 7. Preuve d'intégration hors interface --------------------------------------------------------

echo
echo "7. Intégration hors interface : ce que le backend consent réellement"

reponse_anon=$(curl -s -o "$TRAVAIL/anon.json" -w '%{http_code}' \
	"$BASE_API/rest/v1/workspaces?select=id,name,slug&order=name.asc" -H "apikey: $ANON_KEY")
corps_anon=$(cat "$TRAVAIL/anon.json")
if [ "$reponse_anon" = "200" ] && [ "$corps_anon" = "[]" ]; then
	ok "clé anonyme : 200 et [] — le refus par défaut est un état vide, pas une erreur"
else
	fail "clé anonyme : attendu 200 et [], obtenu $reponse_anon et $corps_anon"
fi

jeton=$(curl -s -X POST "$BASE_API/auth/v1/token?grant_type=password" \
	-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
	-d "{\"email\":\"$COMPTE_SEED\",\"password\":\"$MOT_DE_PASSE_SEED\"}" \
	| python3 -c 'import sys, json; print(json.load(sys.stdin).get("access_token", ""))')
if [ -n "$jeton" ]; then
	ok "jeton réel obtenu par la véritable route de connexion pour $COMPTE_SEED"
else
	fail "connexion impossible pour $COMPTE_SEED : le seed est-il appliqué ?"
fi

reponse_auth=$(curl -s -o "$TRAVAIL/auth.json" -w '%{http_code}' \
	"$BASE_API/rest/v1/workspaces?select=id,name,slug&order=name.asc" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $jeton")
corps_auth=$(cat "$TRAVAIL/auth.json")
lignes_en_base=$(docker exec "$DB_CONTAINER" psql -U postgres -qtA -c 'select count(*) from public.workspaces;')

# CRM-022 a volontairement changé ce contrat : l'anonyme reste fermé, tandis qu'un membre lit son
# workspace et lui seul. Zéro ligne serait désormais un sur-refus ; plus d'une, une fuite.
if [ "$reponse_auth" = "200" ] \
	&& jq -e --arg id "$WORKSPACE_SEED" \
		'length == 1 and .[0] == {id: $id, name: "P2Enjoy SAS", slug: "p2enjoy"}' \
		"$TRAVAIL/auth.json" >/dev/null \
	&& [ "$lignes_en_base" -ge 1 ]; then
	ok "jeton réel : un seul workspace, celui de la session — contrat CRM-022 exact"
else
	fail "jeton réel : attendu le seul workspace seedé ; obtenu $reponse_auth, $corps_auth, $lignes_en_base ligne(s) en base"
fi

# --- 8. Scénarios E2E et captures ------------------------------------------------------------------

echo
echo "8. Scénarios E2E contre le build servi, et captures"

if npm run --silent e2e:ui >"$TRAVAIL/e2e.log" 2>&1; then
	ok "npm run e2e:ui : $(grep -oE '[0-9]+ passed' "$TRAVAIL/e2e.log" | tail -n 1)"
else
	fail "npm run e2e:ui échoue"
	sed 's/^/        /' "$TRAVAIL/e2e.log" | tail -n 25
fi

for capture in palier-xl-1440 palier-lg-1152 palier-md-900 palier-sm-390 \
	etat-chargement-1440 etat-erreur-1440 etat-refus-1440 tiroir-ouvert-900 barre-repliee-1440; do
	if [ -s "e2e/output/${capture}.jpg" ] && [ -s "docs/captures/CRM-007/${capture}.jpg" ]; then
		ok "capture ${capture}.jpg produite et versionnée"
	else
		fail "capture ${capture}.jpg manquante"
	fi
done

# --- 9. État final --------------------------------------------------------------------------------

echo
echo "9. Le harnais a tout restauré"

# DÉFAUT CORRIGÉ APRÈS COUP. Cette vérification employait `git diff`, c'est-à-dire une comparaison
# avec le **dernier commit** — et non avec l'état d'avant dégradation. Elle échouait donc dès que
# l'un de ces fichiers portait une modification légitime non encore committée, ce qui est
# précisément le cas d'usage principal du harnais : on le rejoue **juste avant** de committer.
# Toute unité qui touche `TabBar.tsx` ou `workspaces.ts` — `CRM-021` l'a fait — voyait ce contrôle
# passer au rouge alors que le harnais avait parfaitement restauré ce qu'il avait altéré.
#
# La comparaison porte désormais sur les sauvegardes prises avant la première altération. Ce qu'un
# contrôle de restauration doit prouver est « le harnais rend ce qu'il a pris », jamais « l'arbre de
# travail est propre », qui n'est pas son affaire. `scripts/verify-tracks.sh` avait déjà dû faire ce
# raisonnement pour son fichier de jetons ; il est généralisé ici.
restes=""
for fichier in "${A_RESTAURER[@]}"; do
	sauvegarde="$TRAVAIL/$(echo "$fichier" | tr '/' '_')"
	if [ -f "$sauvegarde" ] && ! cmp -s "$sauvegarde" "$fichier"; then
		restes="$restes $fichier"
	fi
done

if [ -z "$restes" ]; then
	ok "les fichiers altérés par les contrôles de non-complaisance sont restaurés"
else
	fail "des altérations subsistent :$restes"
fi

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n\n' "$checks"
	exit 0
fi
printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n\n' "$checks" "$failures"
exit 1
