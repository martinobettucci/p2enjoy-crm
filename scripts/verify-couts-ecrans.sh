#!/usr/bin/env bash
# @verifies CRM-086 (docs/BACKLOG.md) — Definition of Done des ÉCRANS DE COÛTS : l'histogramme du
#           §4.2, le détail d'un budget du §4.3, le cumul du workspace du §4.5 et l'onglet
#           « À saisir » du §4.8, avec son socle de données
# @verifies docs/SPEC-costs.md §4.0 (les trois adresses, l'onglet en chaîne de requête),
#           §4.2 (histogramme du track, un budget clôturé n'y figure pas), §4.3 (une paire de
#           barres par occurrence), §4.4 (« n lignes sans coût réel saisi »), §4.5 (cumul calculé
#           APRÈS la RLS, regroupement par devise), §4.7 (les états), §4.8 (l'onglet, ce qu'il
#           liste, sa saisie, sa lecture seule, son compteur), §4.8.1 (le droit rendu par la base,
#           l'ancienneté sur `created_at`, ce que la saisie envoie), §4.8.2 (la portée du badge)
# @verifies docs/SCHEMA.md §9 bis.8 (`public.reel_saisissable`)
# @verifies docs/DESIGN_SYSTEM.md §1 (les couleurs sont des JETONS), §5.30 (l'histogramme),
#           §5.31 (la table de saisie en série), §5.32 (l'écran d'un budget), §5.33 (le cumul),
#           §7 (les quatre paliers), §8 (clavier), §10 (aucun texte en dur)
# @verifies CLAUDE.md §16 (vérification visuelle), §18 (aucune temporisation), §22 (clavier)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers des six tranches sont livrés et portent leur traçabilité `@spec` /
#      `@verifies`, y compris depuis les surfaces qui ACCUEILLENT les entrées de navigation ;
#   2. les captures des quatre paliers, pour les QUATRE surfaces, et les états que la Definition
#      of Done nomme — la ligne enregistrée, la lecture seule, « tous les coûts réels sont
#      saisis » ;
#   3. les règles que le CODE porte, et qu'aucune suite ni aucune capture ne rendrait rouges ;
#   4. le socle est réellement EN BASE : la colonne calculée du §4.8.1, son mode d'évaluation, et
#      le seed dans l'état que les preuves attendent — dont la ligne sans réel sur un budget CLOS ;
#   5. Vitest — les deux modules et les quatre écrans ;
#   6. la suite pgTAP de l'onglet ;
#   7. les preuves d'interface des quatre surfaces, sur la pile seedée, au clavier ;
#   8. le harnais est NON COMPLAISANT : trois dégradations réelles, portant chacune sur une règle
#      que `docs/SPEC-costs.md` énonce, doivent faire ÉCHOUER une preuve — et la restauration est
#      constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# IL NE PROUVE PAS LE MODÈLE DES LIGNES DE COÛT NI CELUI DES BUDGETS : `scripts/verify-budgets.sh`
# et `scripts/verify-card-costs.sh` portent `CRM-084` et `CRM-085`. Les redoubler ici ferait deux
# sources pour une même règle, qui divergeraient au premier ajustement.
#
# IL NE PEUT PAS OBSERVER UNE CAPTURE — c'est l'humain qui le fait (`CLAUDE.md` §16). Il refuse en
# revanche qu'une Definition of Done prétende à des captures absentes ou tronquées.
#
# LE BADGE N'EST PAS EXIGÉ ÉGAL À LA MENTION DU §4.4, et c'est délibéré : l'égalité que le §4.8
# écrit est structurellement fausse — la clôture et la devise séparent les deux populations —, elle
# est consignée à INC-182 et n'est pas tranchée. Un contrôle qui l'exigerait rendrait rouge une
# livraison conforme au §4.8.2.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-couts-ecrans.sh
#   scripts/verify-couts-ecrans.sh --rapide   n'exécute ni Playwright ni les dégradations

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION=supabase/migrations/0052_couts_a_saisir.sql
TEST_SQL=supabase/tests/0050_couts_a_saisir.test.sql
MODULE_ECRANS=webapp/src/lib/couts-ecrans.ts
MODULE_SAISIR=webapp/src/lib/couts-a-saisir.ts
HISTOGRAMME=webapp/src/app/HistogrammeCouts.tsx
ECRAN_TRACK=webapp/src/app/CoutsTrack.tsx
ECRAN_BUDGET=webapp/src/app/CoutsBudget.tsx
ECRAN_WORKSPACE=webapp/src/app/CoutsWorkspace.tsx
ONGLETS=webapp/src/app/OngletsCouts.tsx
ECRAN_SAISIR=webapp/src/app/CoutsASaisir.tsx
BARRE_ONGLETS=webapp/src/app/TabBar.tsx
SPECS_UI="e2e/ui/couts-track.spec.ts e2e/ui/couts-budget.spec.ts e2e/ui/couts-workspace.spec.ts e2e/ui/couts-a-saisir.spec.ts"
CAPTURES=docs/captures/CRM-086
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,54p' "$0"; exit 0 ;;
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
RAPPORTS=e2e/output/verify-couts-ecrans
mkdir -p "$RAPPORTS"

fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}

# Les dégradations du §8 modifient de VRAIS fichiers du dépôt. La sauvegarde est prise avant, et
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

printf '\033[1mPreuves de CRM-086 — écrans de coûts et onglet « À saisir »\033[0m\n'

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

# shellcheck disable=SC2086
for fichier in "$MIGRATION" "$TEST_SQL" "$MODULE_ECRANS" "$MODULE_SAISIR" "$HISTOGRAMME" \
	"$ECRAN_TRACK" "$ECRAN_BUDGET" "$ECRAN_WORKSPACE" "$ONGLETS" "$ECRAN_SAISIR" $SPECS_UI; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MODULE_ECRANS" "$MODULE_SAISIR" "$HISTOGRAMME" "$ECRAN_TRACK" "$ECRAN_BUDGET" \
	"$ECRAN_WORKSPACE" "$ONGLETS" "$ECRAN_SAISIR"; do
	if head -3 "$fichier" | grep -q 'CRM-086'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog en tête de fichier"
	fi
done

# shellcheck disable=SC2086
for fichier in $SPECS_UI; do
	if head -3 "$fichier" | grep -q '@verifies CRM-086'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# La barre d'onglets d'un track ACCUEILLE l'entrée « Coûts » : sans cette trace, rien ne mènerait
# de la surface hôte à l'unité qui y a ajouté une entrée (§12.1 du design system).
if grep -q 'CRM-086' "$BARRE_ONGLETS"; then
	ok "$(basename "$BARRE_ONGLETS") cite CRM-086 — la barre trace l'entrée qu'elle accueille"
else
	fail "$(basename "$BARRE_ONGLETS") ne cite pas CRM-086 : l'entrée « Coûts » n'est plus tracée"
fi

# LES DEUX ÉCRANS À ONGLETS MONTENT RÉELLEMENT LA ZONE : un onglet spécifié mais non monté serait
# une adresse `?onglet=saisir` qui ouvrirait la vue d'ensemble sans rien dire (§4.0).
for ecran in "$ECRAN_TRACK" "$ECRAN_WORKSPACE"; do
	if grep -q '<ZoneCoutsAOnglets' "$ecran"; then
		ok "$(basename "$ecran") monte la zone à onglets du §4.8"
	else
		fail "aucun <ZoneCoutsAOnglets> dans $ecran : l'onglet « À saisir » n'est plus atteignable"
	fi
done

# --- 2. Captures ---------------------------------------------------------------------------------

titre "2. Captures des quatre paliers, pour les quatre surfaces"

for surface in couts-track couts-budget couts-workspace couts-a-saisir; do
	for palier in xl-1440 lg-1152 md-900 sm-390; do
		if [ -f "$CAPTURES/$surface-$palier.jpg" ]; then
			ok "capture $surface au palier $palier livrée"
		else
			fail "capture $surface au palier $palier ABSENTE : la DoD exige les quatre paliers"
		fi
	done
done

# Les trois états que la Definition of Done nomme explicitement pour l'onglet.
for etat in couts-a-saisir-enregistre-1440 couts-a-saisir-lecture-seule-1440 \
	couts-a-saisir-tout-saisi-1440; do
	if [ -f "$CAPTURES/$etat.jpg" ]; then
		ok "capture de l'état « $etat » livrée"
	else
		fail "capture « $etat » ABSENTE : la DoD la nomme"
	fi
done

vides=$(find "$CAPTURES" -name '*.jpg' -size -4k | wc -l | tr -d ' ')
if [ "$vides" = '0' ]; then
	ok "aucune capture tronquée sous $CAPTURES"
else
	fail "« $vides » capture(s) de moins de 4 ko sous $CAPTURES : une exécution interrompue en laisse"
fi

# --- 3. Les règles que le code porte ------------------------------------------------------------

titre "3. Les règles que le code porte, et qu'aucune suite ne rendrait rouge"

FICHIERS_UI="$HISTOGRAMME $ECRAN_TRACK $ECRAN_BUDGET $ECRAN_WORKSPACE $ONGLETS $ECRAN_SAISIR"

# shellcheck disable=SC2086
hexa=$(grep -nE '#[0-9a-fA-F]{3,8}\b' $FICHIERS_UI "$MODULE_ECRANS" "$MODULE_SAISIR" || true)
if [ -z "$hexa" ]; then
	ok "aucune couleur hexadécimale dans les écrans ni dans leurs modules — les couleurs sont des jetons (§1)"
else
	fail "couleur hexadécimale trouvée : $(printf '%s' "$hexa" | head -3 | tr '\n' ' ')"
fi

# shellcheck disable=SC2086
tempo=$(grep -nE '\b(setTimeout|setInterval)\b' $FICHIERS_UI "$MODULE_ECRANS" "$MODULE_SAISIR" || true)
if [ -z "$tempo" ]; then
	ok "aucune temporisation dans les écrans ni dans leurs modules (CLAUDE.md §18)"
else
	fail "temporisation trouvée : $(printf '%s' "$tempo" | head -3 | tr '\n' ' ')"
fi

# LE GRAPHIQUE EST `aria-hidden`, ET LE TABLEAU EST SA VERSION ACCESSIBLE (§5.30). Une cible
# interactive posée sur une barre serait perdue au clavier comme au lecteur d'écran.
if grep -q 'aria-hidden="true"' "$HISTOGRAMME"; then
	ok "le graphique est \`aria-hidden\` — le tableau équivalent porte la lecture (§5.30)"
else
	fail "le graphique n'est plus \`aria-hidden\` : un lecteur d'écran entendrait deux fois la même série"
fi

# LE REPLI D'UN DROIT SE FAIT VERS LE REFUS (§4.8.1). Un `!== false` rendrait saisissable une ligne
# dont la colonne calculée est ABSENTE de la réponse — cache de schéma PostgREST périmé —, et
# l'onglet offrirait des champs dont chaque envoi serait refusé.
if grep -q 'reel_saisissable === true' "$MODULE_SAISIR"; then
	ok "le droit d'écriture se replie vers le REFUS (§4.8.1)"
else
	fail "\`estSaisissable\` n'emploie plus \`=== true\` : le repli d'un droit ne va plus vers le refus"
fi

# LA LECTURE DE L'ONGLET NE POSE AUCUN FILTRE DE CLÔTURE (§4.8) — c'est sa raison d'être : « c'est
# précisément après la clôture que les factures arrivent ». Un `closed_at` ajouté par mimétisme des
# deux autres lectures viderait l'onglet en silence.
if grep -qE "\.is\('(budgets|budget_occurrences)\.closed_at'" "$MODULE_SAISIR"; then
	fail "un filtre de clôture est posé dans $MODULE_SAISIR : l'onglet perd les budgets clos (§4.8)"
else
	ok "la lecture de l'onglet ne pose AUCUN filtre de clôture (§4.8)"
fi

# LA SAISIE N'ENVOIE QU'`actual_cost` (§4.8.1) : tout autre attribut ferait dépendre l'écriture
# d'un rattachement que l'onglet n'a aucune raison de connaître.
if grep -q "update({ actual_cost: reel })" "$MODULE_SAISIR"; then
	ok "la saisie n'envoie QUE \`actual_cost\` (§4.8.1)"
else
	fail "l'envoi de \`enregistrerReel\` a changé de forme : la frontière du §2.3 n'est plus tenue"
fi

# L'ANCIENNETÉ SE MESURE SUR `created_at`, JAMAIS SUR `updated_at` (§4.8.1) : `updated_at` bougerait
# à chaque correction du libellé et ferait rajeunir une ligne qu'on vient de renommer.
#
# LE MOTIF PORTE SUR UN ACCÈS, PAS SUR LE MOT : `updated_at` est NOMMÉ dans le commentaire qui
# explique pourquoi il n'est pas employé, et un contrôle qui chercherait le mot seul rendrait rouge
# la documentation de sa propre règle — mesuré à la première exécution de ce harnais.
if grep -q 'ligne\.updated_at' "$MODULE_SAISIR"; then
	fail "\`ligne.updated_at\` est LU dans $MODULE_SAISIR : l'ancienneté ne se mesure plus sur la création"
elif grep -q 'Date.parse(ligne.created_at)' "$MODULE_SAISIR"; then
	ok "l'ancienneté se mesure sur \`created_at\`, jamais sur \`updated_at\` (§4.8.1)"
else
	fail "\`ancienneteEnJours\` ne lit plus \`created_at\` : la colonne « Ancienneté » ne dit plus depuis quand la ligne attend"
fi

# AUCUN TEXTE VISIBLE EN DUR (§10) : le contrôle exécutable vit dans `i18n.test.ts`, et ce harnais
# se borne à vérifier que les écrans passent bien par `t(...)`.
for fichier in "$ONGLETS" "$ECRAN_SAISIR"; do
	if grep -q "from '../i18n'" "$fichier"; then
		ok "$(basename "$fichier") passe par les clés de traduction (§10)"
	else
		fail "$(basename "$fichier") n'importe plus l'i18n : un texte visible y serait écrit en dur"
	fi
done

# --- 4. Le socle en base, et le seed ------------------------------------------------------------

titre "4. La colonne calculée du §4.8.1, et le seed dans l'état que les preuves attendent"

if docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
	securite=$(psql_db -c "select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reel_saisissable'")
	if [ "$securite" = 'f' ]; then
		ok "\`public.reel_saisissable\` existe et n'est PAS \`security definer\` (§4.8.1)"
	elif [ -z "$securite" ]; then
		fail "\`public.reel_saisissable\` est ABSENTE de la base : la migration 52 n'est pas appliquée"
	else
		fail "\`public.reel_saisissable\` est \`security definer\` : elle répondrait VRAI à tout appelant"
	fi

	volatilite=$(psql_db -c "select provolatile from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'reel_saisissable'")
	if [ "$volatilite" = 's' ]; then
		ok "\`public.reel_saisissable\` est \`stable\` — PostgREST peut l'exposer en colonne"
	else
		fail "\`public.reel_saisissable\` porte la volatilité « $volatilite », « s » attendue"
	fi

	# LA LIGNE QUE LA DoD RÉCLAME : « une ligne d'un budget clôturé est présente et saisissable ».
	# Sans elle dans le seed, ni la preuve d'interface ni la suite pgTAP ne porteraient sur rien.
	close=$(psql_db -c "select count(*) from public.card_costs c join public.budgets b on b.id = c.budget_id where c.actual_cost is null and b.closed_at is not null")
	if [ "$close" -ge 1 ]; then
		ok "le seed porte « $close » ligne(s) sans réel sur un budget CLÔTURÉ (DoD)"
	else
		fail "aucune ligne sans réel sur un budget clôturé : la DoD de l'onglet ne se prouve plus"
	fi

	attente=$(psql_db -c "select count(*) from public.card_costs where actual_cost is null")
	if [ "$attente" = '3' ]; then
		ok "le seed porte TROIS lignes en attente — le nombre que le badge rend à l'administrateur"
	else
		fail "« $attente » ligne(s) en attente dans le seed, 3 attendues : les preuves du badge dérivent"
	fi

	# LE RÉSIDU D'UNE PREUVE INTERROMPUE SE VOIT ICI. `couts-a-saisir.spec.ts` écrit le réel d'une
	# ligne seedée et le restaure ; une exécution tuée en cours laisserait la ligne renseignée, et
	# `scripts/verify-card-costs.sh` deviendrait rouge sans que sa cause soit lisible.
	residu=$(psql_db -c "select count(*) from public.card_costs where label = 'Impression plaquettes' and actual_cost is not null")
	if [ "$residu" = '0' ]; then
		ok "aucun résidu de saisie : « Impression plaquettes » est rendue sans réel"
	else
		fail "« Impression plaquettes » porte un réel : une preuve d'écriture n'a pas restauré le seed"
	fi
else
	fail "le conteneur $DB_CONTAINER ne répond pas : la pile doit tourner (./runDev.sh)"
fi

# --- 5. Vitest ----------------------------------------------------------------------------------

titre "5. Vitest — les deux modules et les quatre surfaces"

for motif in 'lib/couts-ecrans.test' 'lib/couts-a-saisir.test' 'app/HistogrammeCouts.test' \
	'app/CoutsTrack.test' 'app/CoutsBudget.test' 'app/CoutsWorkspace.test' 'app/CoutsASaisir.test'; do
	if npm run test:unit -- --run "$motif" >"$TRAVAIL/vitest.log" 2>&1; then
		ok "vitest $motif : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/vitest.log" | tail -1)"
	else
		fail_journal "vitest $motif ÉCHOUE" "$TRAVAIL/vitest.log"
	fi
done

# --- 6, 7, 8. Les preuves longues ---------------------------------------------------------------

if [ "$RAPIDE" = true ]; then
	titre "6. Preuves longues"
	ok "--rapide : ni pgTAP, ni Playwright, ni les dégradations ne sont exécutés (annoncé, non masqué)"
else
	titre "6. pgTAP — le signal du droit et la politique qui l'applique, confrontés"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
		ok "pgTAP ($TEST_SQL) : $(grep -oE '[0-9]+ (assertions?|tests?)' "$TRAVAIL/pgtap.log" | tail -1)"
	else
		fail_journal "la suite pgTAP de l'onglet ÉCHOUE" "$TRAVAIL/pgtap.log"
	fi

	titre "7. UI — les quatre surfaces sur la pile seedée, au clavier"

	# shellcheck disable=SC2086
	if npx playwright test --config e2e/playwright.config.ts --project=ui $SPECS_UI \
		>"$TRAVAIL/ui.log" 2>&1; then
		ok "e2e ui (quatre surfaces) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1)"
	else
		fail_journal "le parcours des écrans de coûts ÉCHOUE" "$TRAVAIL/ui.log"
	fi

	# --- 8. Le harnais est non complaisant ------------------------------------------------------

	titre "8. Dégradations — chacune DOIT faire échouer une preuve"

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

	# 1. Le repli du droit part vers l'AUTORISATION : une réponse amputée de la colonne calculée
	#    rendrait alors la ligne saisissable, et l'onglet offrirait des champs voués au refus
	#    (§4.8.1).
	degradation "le repli du droit part vers l'autorisation (§4.8.1)" \
		"$MODULE_SAISIR" "ligne.reel_saisissable === true" \
		"ligne.reel_saisissable !== false" \
		'lib\/couts-a-saisir.test'

	# 2. Le badge cesse de compter les lignes non écrivables : il écrirait « 0 » à une lectrice qui
	#    a pourtant des lignes sous les yeux, et divergerait du tableau (§4.8.2).
	degradation "le badge ne compte plus les lignes non écrivables (§4.8.2)" \
		"$MODULE_SAISIR" "(lignes: readonly LigneASaisir[]): number => lignes.length" \
		"(lignes: readonly LigneASaisir[]): number => lignes.filter(estSaisissable).length" \
		'lib\/couts-a-saisir.test'

	# 3. La pilule « clôturé » cesse de voir une OCCURRENCE close dans un budget ouvert : la ligne
	#    paraîtrait dans l'onglet sans que rien n'explique pourquoi (§4.8).
	degradation "une occurrence close ne porte plus la pilule (§4.8)" \
		"$MODULE_SAISIR" "(ligne.budget_occurrences?.closed_at ?? null) !== null" \
		"false" \
		'lib\/couts-a-saisir.test'

	# La restauration est CONSTATÉE, pas supposée : un `perl -pi` interrompu laisserait le module
	# affaibli, ce qui serait pire que l'absence de harnais.
	if npm run test:unit -- --run 'lib/couts-a-saisir.test' >"$TRAVAIL/restauration.log" 2>&1; then
		ok "le module est RESTAURÉ : la preuve redevient verte après les dégradations"
	else
		fail_journal "le module n'a PAS été restauré — le dépôt est affaibli, rendez $MODULE_SAISIR" \
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
