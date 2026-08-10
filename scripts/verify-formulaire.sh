#!/usr/bin/env bash
# @verifies CRM-037 (docs/BACKLOG.md) — Definition of Done du rendu du formulaire conditionnel
# @verifies docs/SPEC-form-composer.md §4.1 (composition), §4.2 (trois destinations),
#           §4.3 (tableau de cas partagé), §4.4 (champ exigé), §4.5 (accessibilité),
#           §4.6 (écran hôte), §4.6 bis (la coquille autour du formulaire),
#           §4.7 (ce qui n'est pas livré), §7.3 (preuves attendues)
# @verifies docs/SPEC-channels.md §5 (ce que la barre d'onglets lit), §5.4 (toute route portant un
#           `slugTrack` l'alimente par le même chargeur)
# @verifies docs/DESIGN_SYSTEM.md §5.7 (champs de formulaire), §5.7 bis (case à cocher, données
#           techniques), §7 (paliers), §8 (accessibilité), §11 (classes réellement engendrées)
# @verifies docs/INCONSISTENCY_REPORT.md INC-021 (webapp anonyme), INC-062 (parcours de
#           transition), INC-065 (l'adresse d'une card n'est confrontée à rien)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-037` :
#
#   1. les tests unitaires de la composition et du composant réel sont verts ;
#   2. la preuve d'API confronte la lecture SQL de « renseigné » à la lecture TypeScript sur les
#      mêmes valeurs, écrites dans de vraies lignes par la vraie route ;
#   3. les scénarios d'interface s'exécutent contre le **build de production** servi, et les
#      captures sont réellement produites ;
#   4. le build est vert et **chaque classe citée par le rendu existe dans le CSS produit** — une
#      classe dont le jeton n'est pas déclaré n'est pas engendrée, et en silence
#      (docs/DESIGN_SYSTEM.md §11) ;
#   5. le seed porte bien les données que le rendu démontre — la card `c6` à `Prospection`, son
#      champ `hidden` porteur d'une valeur, son champ sans règle ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire du rendu le fait
#      échouer, et la restauration est constatée, pas supposée. La septième dégradation vise la
#      **coquille** : une route de card qui cesse d'alimenter sa barre d'onglets doit faire tomber
#      la preuve d'interface — c'est le défaut réel que la décision 167 corrige.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucun parcours de transition** — « transition bloquée → saisie → transition
# réussie » —, que la Definition of Done exige : il suppose une session (INC-021) et un contrôle de
# transition dû par `CRM-041`. C'est INC-062, arbitrage attendu.
#
# Il ne prouve **aucune écriture depuis l'interface** : le §4.7 pose qu'il n'y en a pas.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-formulaire.sh
#   scripts/verify-formulaire.sh --rapide   n'exécute ni Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MODULE=webapp/src/lib/formulaire.ts
PREDICAT=webapp/src/lib/valeur-renseignee.ts
COMPOSANT=webapp/src/app/FormulaireCard.tsx
ROUTE=webapp/src/app/RouteCard.tsx
TEST_UNITAIRE=webapp/src/lib/formulaire.test.ts
TEST_COMPOSANT=webapp/src/app/FormulaireCard.test.tsx
SPEC_API=e2e/api/rendu-formulaire.spec.ts
SPEC_UI=e2e/ui/formulaire.spec.ts
CAPTURES=docs/captures/CRM-037
DB_CONTAINER=p2enjoy-db

CARD_C6=5eed0000-0000-4000-8000-0000000000c6
ETAPE_PROSPECTION=5eed0000-0000-4000-8000-000000000061
CHAMP_MOTIF=5eed0000-0000-4000-8000-000000000084

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,38p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 »." >&2; exit 1 ;;
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
SAUVEGARDES="$TRAVAIL/sauvegardes"
mkdir -p "$SAUVEGARDES"

# Toute dégradation est restaurée, y compris si le script échoue en cours de route : un harnais
# qui laisse le produit dégradé derrière lui est pire que pas de harnais du tout (décisions 143,
# 145, 157).
restaurer() {
	for fichier in "$SAUVEGARDES"/*; do
		[ -e "$fichier" ] || continue
		local cible
		cible=$(basename "$fichier" | tr '@' '/')
		cp "$fichier" "$cible"
	done
	rm -rf "$TRAVAIL" "${DEPART:-}"
}
trap restaurer EXIT

sauvegarder() { cp "$1" "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')"; }
rendre() { cp "$SAUVEGARDES/$(printf '%s' "$1" | tr '/' '@')" "$1"; }

# État des fichiers dégradables **à l'entrée du harnais**, et non l'état de `HEAD`.
#
# C'est cette empreinte que la section 7 compare, et le motif est une mesure : la première
# rédaction y employait `git diff --quiet`, qui compare au dernier commit. Ce contrôle ne
# distingue donc pas « une dégradation n'a pas été restaurée » — ce qu'il cherche — de « le
# fichier porte un changement non encore committé » — ce qui est l'état normal de tout travail
# en cours. MESURÉ : le harnais rendait `46 contrôles, 1 en échec` sur une correction de
# `valeur-renseignee.ts` pourtant parfaitement restaurée, et il l'aurait rendu pour **toute**
# modification de ces trois fichiers avant son commit. Un contrôle qui ne peut pas être vert
# pendant qu'on travaille finit par être ignoré.
DEPART=$(mktemp -d)
empreinte_depart() { cp "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')"; }
est_rendu_intact() { diff -q "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')" >/dev/null 2>&1; }

# L'empreinte est prise AVANT tout contrôle, et le répertoire est détruit avec le reste.
for fichier in "$MODULE" "$PREDICAT" "$COMPOSANT" "$ROUTE"; do
	[ -f "$fichier" ] && empreinte_depart "$fichier"
done

# --- 1. Les fichiers livrés et leur traçabilité --------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MODULE" "$PREDICAT" "$COMPOSANT" "$ROUTE" "$TEST_UNITAIRE" "$TEST_COMPOSANT" \
	"$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MODULE" "$PREDICAT" "$COMPOSANT" "$ROUTE"; do
	if head -3 "$fichier" | grep -q '@spec CRM-037'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_UNITAIRE" "$TEST_COMPOSANT" "$SPEC_API" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-037'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# Le tableau de cas ne vaut que s'il n'existe qu'à un seul endroit : deux copies divergeraient, et
# l'égalité qu'elles servent à prouver ne vaudrait plus rien (§4.3).
if [ "$(grep -rl 'const CAS_RENSEIGNE' webapp/src e2e | wc -l)" -eq 1 ]; then
	ok "le tableau de cas partagé n'est déclaré qu'à un seul endroit"
else
	fail "le tableau de cas partagé est déclaré plusieurs fois : les copies divergeront"
fi

if grep -q "valeur-renseignee" "$SPEC_API"; then
	ok "la preuve d'API importe le tableau de cas de l'interface, elle ne le recopie pas"
else
	fail "la preuve d'API n'importe pas le tableau de cas : l'égalité du §4.3 n'est plus mesurée"
fi

# --- 2. Le seed porte ce que le rendu démontre ---------------------------------------------------

titre "2. Le seed porte les données que le rendu démontre"

etape=$(psql_db -c "select current_step_id from public.cards where id='$CARD_C6'")
if [ "$etape" = "$ETAPE_PROSPECTION" ]; then
	ok "la card c6 est à l'étape Prospection"
else
	fail "la card c6 n'est plus à Prospection : le cas de la section repliée n'est plus démontré"
fi

visibilite=$(psql_db -c "select visibility from public.form_field_rules where field_id='$CHAMP_MOTIF' and step_id='$ETAPE_PROSPECTION'")
if [ "$visibilite" = hidden ]; then
	ok "motif-perte est 'hidden' à Prospection"
else
	fail "motif-perte n'est plus 'hidden' à Prospection (lu : ${visibilite:-aucune règle})"
fi

valeur=$(psql_db -c "select value::text from public.card_field_values where card_id='$CARD_C6' and field_id='$CHAMP_MOTIF'")
if [ -n "$valeur" ] && [ "$valeur" != null ]; then
	ok "et la card c6 porte pourtant une valeur pour lui : la section repliée est démontrable"
else
	fail "la card c6 ne porte aucune valeur pour motif-perte : le §4.2 n'est plus démontré"
fi

# Le cas « un champ sans règle apparaît par le défaut visible » (§3.1) : il n'est exercé que si le
# seed comporte réellement un champ actif sans règle à cette étape.
sans_regle=$(psql_db -c "
	select count(*) from public.form_fields f
	where f.archived_at is null
	  and f.workflow_id = (select workflow_id from public.workflow_steps where id='$ETAPE_PROSPECTION')
	  and not exists (
		select 1 from public.form_field_rules r
		where r.field_id = f.id and r.step_id = '$ETAPE_PROSPECTION')")
if [ "${sans_regle:-0}" -ge 1 ]; then
	ok "au moins un champ actif n'a aucune règle à Prospection ($sans_regle) : le défaut est exercé"
else
	fail "tous les champs ont une règle : le défaut « visible » du §3.1 n'est plus démontré"
fi

# --- 3. Tests unitaires --------------------------------------------------------------------------

titre "3. Tests unitaires de la composition et du composant"

if npm run test:unit --silent > "$TRAVAIL/unit.log" 2>&1; then
	total=$(sed -n 's/.*Tests *\([0-9]\+\) passed.*/\1/p' "$TRAVAIL/unit.log" | tail -1)
	ok "npm run test:unit vert (${total:-?} tests)"
else
	fail "npm run test:unit en échec — voir $TRAVAIL/unit.log"
	cp "$TRAVAIL/unit.log" /tmp/p2enjoy-formulaire-unit.log 2>/dev/null || true
fi

# --- 4. Preuve d'API : les deux lectures de « renseigné » ----------------------------------------

titre "4. La base et l'interface lisent « renseigné » de la même façon"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m Playwright (--rapide)\n'
else
	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		> "$TRAVAIL/api.log" 2>&1; then
		passes=$(sed -n 's/.*[^0-9]\([0-9]\+\) passed.*/\1/p' "$TRAVAIL/api.log" | tail -1)
		if [ "${passes:-0}" -ge 15 ]; then
			ok "e2e/api/rendu-formulaire.spec.ts vert ($passes scénarios)"
		else
			fail "seulement ${passes:-0} scénarios d'API : le tableau de cas a-t-il été réduit ?"
		fi
	else
		fail "e2e/api/rendu-formulaire.spec.ts en échec — voir $TRAVAIL/api.log"
		tail -30 "$TRAVAIL/api.log" || true
	fi
fi

# --- 5. Interface, build et captures --------------------------------------------------------------

titre "5. Interface exercée sur le build de production, et captures produites"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m Playwright et build (--rapide)\n'
else
	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		> "$TRAVAIL/ui.log" 2>&1; then
		passes=$(sed -n 's/.*[^0-9]\([0-9]\+\) passed.*/\1/p' "$TRAVAIL/ui.log" | tail -1)
		ok "e2e/ui/formulaire.spec.ts vert (${passes:-?} scénarios)"
	else
		fail "e2e/ui/formulaire.spec.ts en échec — voir $TRAVAIL/ui.log"
		tail -30 "$TRAVAIL/ui.log" || true
	fi

	for capture in card-introuvable-1440 formulaire-charge-1440 formulaire-champ-requis-1440 \
		formulaire-autres-etapes-1440 coquille-onglets-1440 formulaire-xl-1440 formulaire-lg-1152 \
		formulaire-md-900 formulaire-sm-390; do
		if [ -s "$CAPTURES/$capture.jpg" ]; then
			ok "capture $capture.jpg produite"
		else
			fail "capture $capture.jpg ABSENTE : la vérification visuelle n'a pas eu lieu"
		fi
	done

	# Chaque classe citée par les composants existe dans le CSS produit. Une classe dont le jeton
	# n'est pas déclaré n'est pas engendrée, **en silence** (docs/DESIGN_SYSTEM.md §11).
	if npm run build --silent > "$TRAVAIL/build.log" 2>&1; then
		ok "npm run build vert"
		dist=$(ls -d webapp/dist 2>/dev/null || true)
		if [ -n "$dist" ] && node scripts/lib/classes-css.mjs webapp/src "$dist" > "$TRAVAIL/classes.log" 2>&1; then
			ok "chaque classe citée par le rendu existe dans le CSS produit"
		else
			fail "des classes citées n'existent pas dans le CSS produit — voir $TRAVAIL/classes.log"
			tail -10 "$TRAVAIL/classes.log" || true
		fi
	else
		fail "npm run build en échec — voir $TRAVAIL/build.log"
	fi
fi

# --- 6. Dégradations : le harnais est-il complaisant ? --------------------------------------------

titre "6. Dégradations volontaires — le harnais échoue-t-il vraiment ?"

degradation() {
	local libelle=$1 fichier=$2 avant=$3 apres=$4 cible=$5
	sauvegarder "$fichier"
	if ! grep -qF "$avant" "$fichier"; then
		fail "dégradation « $libelle » impossible : motif introuvable dans $fichier"
		return
	fi
	python3 - "$fichier" "$avant" "$apres" <<'PY'
import sys
chemin, avant, apres = sys.argv[1:4]
source = open(chemin, encoding='utf-8').read()
open(chemin, 'w', encoding='utf-8').write(source.replace(avant, apres, 1))
PY
	if [ "$cible" = unit ]; then
		if npm run test:unit --silent > "$TRAVAIL/degr.log" 2>&1; then
			fail "COMPLAISANT : « $libelle » et les tests unitaires restent verts"
		else
			ok "« $libelle » fait échouer les tests unitaires"
		fi
	elif [ "$cible" = ui ]; then
		# La preuve d'interface s'exécute contre le **build de production** : Playwright le
		# reconstruit à chaque exécution, la dégradation est donc bien celle qui est servie.
		if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
			> "$TRAVAIL/degr.log" 2>&1; then
			fail "COMPLAISANT : « $libelle » et la preuve d'interface reste verte"
		else
			ok "« $libelle » fait échouer la preuve d'interface"
		fi
	else
		if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
			> "$TRAVAIL/degr.log" 2>&1; then
			fail "COMPLAISANT : « $libelle » et la preuve d'API reste verte"
		else
			ok "« $libelle » fait échouer la preuve d'API"
		fi
	fi
	rendre "$fichier"
}

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m dégradations (--rapide)\n'
else
	# D1 — « renseigné » cesse de distinguer `false` d'une absence de réponse. C'est le défaut que
	# le §6.6 nomme comme le plus insidieux : une case décochée deviendrait impossible à satisfaire.
	degradation "faux compté comme vide" "$PREDICAT" \
		'	if (Array.isArray(valeur)) return valeur.length > 0' \
		'	if (Array.isArray(valeur)) return valeur.length > 0
	if (valeur === false) return false' unit

	# D2 — la même dégradation, jugée par la BASE cette fois : c'est l'égalité du §4.3 qui tombe,
	# et c'est elle qui compte. Sans ce contrôle, le prédicat pourrait diverger de la garde sans
	# qu'aucune preuve ne le voie.
	degradation "faux compté comme vide, confronté à la base" "$PREDICAT" \
		'	if (Array.isArray(valeur)) return valeur.length > 0' \
		'	if (Array.isArray(valeur)) return valeur.length > 0
	if (valeur === false) return false' api

	# D2 bis — le prédicat revient à `String.prototype.trim()`. Ce n'est pas une dégradation
	# théorique : c'est **l'état du code livré le 2026-08-05**, corrigé par la décision 165 après
	# mesure contre la base. `btrim` ne retire que l'espace U+0020, `trim()` retire toute l'espace
	# blanche : une valeur réduite à une tabulation est renseignée pour la garde et vide pour une
	# interface écrite avec `trim()`. Seule la confrontation à la BASE peut l'attraper.
	degradation "le prédicat revient à trim(), et diverge de btrim" "$PREDICAT" \
		"	if (typeof valeur === 'string') return retirerEspaces(valeur).length > 0" \
		"	if (typeof valeur === 'string') return valeur.trim().length > 0" api

	# D3 — la composition se met à lire les règles au lieu des champs : le champ sans règle
	# disparaît de l'écran, et c'est exactement le défaut que le §4.1 interdit.
	degradation "un champ sans règle disparaît (§3.1 nié)" "$MODULE" \
		'		const visibilite = visibilites.get(champ.id) ?? VISIBILITE_PAR_DEFAUT' \
		"		const visibilite = visibilites.get(champ.id) ?? 'hidden'" unit

	# D4 — un champ archivé porteur d'une valeur revient dans le formulaire : le §5 tombe, et une
	# donnée saisie devient de nouveau modifiable par un champ que l'archivage avait retiré.
	degradation "un champ archivé revient dans le formulaire (§5 nié)" "$MODULE" \
		'		const archive = champ.archived_at !== null' \
		'		const archive = false' unit

	# D5 — l'alerte perd son `role="alert"` : l'erreur reste visible mais n'est plus annoncée, ce
	# que le §4.5 et docs/DESIGN_SYSTEM.md §5.7 exigent tous les deux.
	degradation "l'alerte n'est plus annoncée (role=\"alert\" retiré)" "$COMPOSANT" \
		'					role="alert"' \
		'					data-role-retire="alert"' unit

	# D6 — la mention « requis pour passer à » disparaît : l'astérisque resterait seul, et
	# l'information reposerait sur un unique caractère (§4.4, docs/DESIGN_SYSTEM.md §8).
	degradation "la mention d'exigence disparaît (§4.4 nié)" "$COMPOSANT" \
		"			{visibilite === 'required' ? (
				<p data-testid={\`requis-\${champ.key}\`} className=\"text-sm text-text-3\">" \
		"			{false ? (
				<p data-testid={\`requis-\${champ.key}\`} className=\"text-sm text-text-3\">" unit

	# D7 — la route cesse d'alimenter la barre d'onglets, et retombe exactement dans l'état livré
	# le 2026-08-05 : `slugTrack` transmis sans les channels, donc « Aucun channel » sur toute
	# route de card (§4.6 bis, décision 167). Ce n'est pas une dégradation théorique — c'est le
	# défaut réel que cette reprise corrige, et rien ne l'attrapait.
	degradation "la barre d'onglets cesse d'être alimentée (§4.6 bis nié)" "$ROUTE" \
		'			etatChannels={projeterChannels(etatTrack)}' \
		'' ui
fi

# --- 7. L'état rendu derrière le harnais ---------------------------------------------------------

titre "7. Ce que le harnais laisse derrière lui"

for fichier in "$PREDICAT" "$MODULE" "$COMPOSANT" "$ROUTE"; do
	if est_rendu_intact "$fichier"; then
		ok "$(basename "$fichier") est rendu tel qu'il était à l'entrée du harnais"
	else
		fail "$(basename "$fichier") est laissé MODIFIÉ : une dégradation n'a pas été restaurée"
	fi
done

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m rejeu final (--rapide)\n'
else
	if npm run test:unit --silent > "$TRAVAIL/final.log" 2>&1; then
		ok "npm run test:unit rejoué après les dégradations : vert"
	else
		fail "npm run test:unit rouge APRÈS restauration : le harnais a laissé le produit dégradé"
	fi
fi

# --- Bilan ---------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%s contrôles, %s en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
