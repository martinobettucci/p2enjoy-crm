#!/usr/bin/env bash
# @verifies CRM-041 (docs/BACKLOG.md) — Definition of Done du board kanban
# @verifies docs/SPEC-workflow-engine.md §7.2 (les quatre lectures), §7.3 (composition des
#           colonnes), §7.4 (carte de card), §7.5 (transitions atteignables), §7.6 (glisser-
#           déposer), §7.7 (clavier), §7.8 (motif exigé), §7.9 (optimisme et retour arrière),
#           §7.10 (les sept refus), §7.11 (états et responsive), §7.14 (preuves attendues)
# @verifies docs/SPEC-channels.md §5 (la lecture partagée porte `workflow_id`)
# @verifies docs/DESIGN_SYSTEM.md §5.1 (carte de card), §5.2 (colonne), §7 (paliers),
#           §8 (accessibilité), §11 (classes réellement engendrées), §12.6 (débordement signalé)
# @verifies docs/INCONSISTENCY_REPORT.md INC-021 (webapp anonyme), INC-048 (le motif n'est
#           conservé nulle part), INC-066 (aucun éditeur de workflow) ; CRM-022 ferme INC-014
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-041` :
#
#   1. les tests unitaires de la composition et du composant réel sont verts ;
#   2. la preuve d'API confronte les **quatre lectures du board** à la pile réelle, avec le jeton
#      de l'administratrice, et constate le refus opposé à l'anonyme ;
#   3. les scénarios d'interface s'exécutent contre le **build de production** servi, les captures
#      des quatre paliers sont produites, et la **vidéo `.webm` du glisser-déposer** avec elles ;
#   4. le build est vert et chaque classe citée par le board existe dans le CSS produit — une
#      classe dont le jeton n'est pas déclaré n'est pas engendrée, et en silence (§11) ;
#   5. le seed porte ce que le board démontre : sept étapes, onze transitions dont cinq à motif,
#      deux étapes sans transition sortante, quatre cards actives sur trois étapes, une archivée et
#      une en corbeille ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire le fait échouer, et
#      la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucun déplacement réel par un utilisateur connecté** : la webapp est un appelant
# anonyme faute d'écran de connexion (INC-021), et le board ne s'affiche jamais en conditions
# réelles. Les états chargés sont prouvés en substituant la réponse réseau, procédé endossé par
# docs/DESIGN_SYSTEM.md §12.5 — et le contrat d'écriture de `move_card`, lui, est prouvé hors
# interface par `e2e/api/move-card.spec.ts` (`CRM-034`).
#
# Il ne prouve **aucun éditeur de workflow** : la cinquième règle du §7 d'origine n'est portée par
# aucune unité du backlog (INC-066), et `CRM-041` ne la livre pas.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-board.sh
#   scripts/verify-board.sh --rapide   n'exécute ni Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MODULE=webapp/src/lib/board.ts
COMPOSANT=webapp/src/app/Board.tsx
ROUTE=webapp/src/app/RouteTrack.tsx
CHANNELS=webapp/src/lib/channels.ts
TEST_UNITAIRE=webapp/src/lib/board.test.ts
TEST_COMPOSANT=webapp/src/app/Board.test.tsx
SPEC_API=e2e/api/board.spec.ts
SPEC_UI=e2e/ui/board.spec.ts
CAPTURES=docs/captures/CRM-041
DB_CONTAINER=p2enjoy-db

WORKFLOW_GLOBAL=5eed0000-0000-4000-8000-000000000051
CHANNEL_GRANDS_COMPTES=5eed0000-0000-4000-8000-000000000032

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,45p' "$0"; exit 0 ;;
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

# État des fichiers dégradables **à l'entrée du harnais**, et non l'état de `HEAD` : un contrôle
# qui comparerait au dernier commit ne pourrait pas être vert pendant qu'on travaille, et finirait
# par être ignoré (décision 166).
DEPART=$(mktemp -d)
empreinte_depart() { cp "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')"; }
est_rendu_intact() { diff -q "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')" >/dev/null 2>&1; }

for fichier in "$MODULE" "$COMPOSANT" "$ROUTE" "$CHANNELS"; do
	[ -f "$fichier" ] && empreinte_depart "$fichier"
done

# --- 1. Les fichiers livrés et leur traçabilité --------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MODULE" "$COMPOSANT" "$ROUTE" "$TEST_UNITAIRE" "$TEST_COMPOSANT" \
	"$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MODULE" "$COMPOSANT" "$ROUTE"; do
	if head -3 "$fichier" | grep -q '@spec CRM-041'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_UNITAIRE" "$TEST_COMPOSANT" "$SPEC_API" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-041'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# La règle du §5.4 de docs/SPEC-channels.md, rendue exécutable : une seule lecture des channels.
# Deux définitions de « channel non archivé » finiraient par diverger (décisions 167 et 169).
if [ "$(grep -rl "from('channels')" webapp/src | wc -l)" -eq 1 ]; then
	ok "les channels ne sont lus qu'à un seul endroit (docs/SPEC-channels.md §5.4)"
else
	fail "les channels sont lus à plusieurs endroits : les lectures divergeront"
fi

# `workflow_id` est lue dans la lecture PARTAGÉE, et non par une seconde requête (décision 169).
if grep -q "workflow_id" "$CHANNELS"; then
	ok "la lecture partagée des channels rapporte workflow_id"
else
	fail "workflow_id a quitté la lecture partagée : le board devra relire les mêmes lignes"
fi

# La preuve d'API importe les colonnes du produit plutôt que de les redéclarer : sinon elle
# prouverait qu'une requête quelconque fonctionne, pas que celle du produit fonctionne.
if grep -q "webapp/src/lib/colonnes-board" "$SPEC_API"; then
	ok "la preuve d'API importe les colonnes du produit, elle ne les recopie pas"
else
	fail "la preuve d'API redéclare ses colonnes : elle n'éprouve plus la requête du produit"
fi

# --- 2. Le seed porte ce que le board démontre ---------------------------------------------------

titre "2. Le seed porte les données que le board démontre"

etapes=$(psql_db -c "select count(*) from public.workflow_steps where workflow_id='$WORKFLOW_GLOBAL'")
if [ "${etapes:-0}" -eq 7 ]; then
	ok "le workflow standard porte ses sept étapes : sept colonnes"
else
	fail "le workflow standard porte $etapes étapes au lieu de 7"
fi

transitions=$(psql_db -c "select count(*) from public.workflow_transitions where workflow_id='$WORKFLOW_GLOBAL'")
if [ "${transitions:-0}" -eq 11 ]; then
	ok "il porte ses onze transitions : le menu du §7.5 a de quoi être non vide"
else
	fail "il porte $transitions transitions au lieu de 11"
fi

a_motif=$(psql_db -c "select count(*) from public.workflow_transitions where workflow_id='$WORKFLOW_GLOBAL' and require_comment")
if [ "${a_motif:-0}" -eq 5 ]; then
	ok "cinq transitions exigent un motif : le §7.8 est démontrable en permanence"
else
	fail "$a_motif transitions exigent un motif au lieu de 5 : le §7.8 n'est plus démontré"
fi

# Deux étapes sans transition sortante : c'est ce qui rend le bouton désactivé et lisible du §7.7
# démontrable par une donnée, et non par un cas fabriqué.
sans_sortie=$(psql_db -c "
	select count(*) from public.workflow_steps s
	where s.workflow_id='$WORKFLOW_GLOBAL'
	  and not exists (select 1 from public.workflow_transitions t where t.from_step_id = s.id)")
if [ "${sans_sortie:-0}" -eq 2 ]; then
	ok "deux étapes n'ont aucune transition sortante : l'état désactivé est démontré"
else
	fail "$sans_sortie étapes sans transition sortante au lieu de 2"
fi

actives=$(psql_db -c "select count(*) from public.cards where channel_id='$CHANNEL_GRANDS_COMPTES' and archived_at is null and deleted_at is null")
if [ "${actives:-0}" -eq 4 ]; then
	ok "grands-comptes porte quatre cards actives"
else
	fail "grands-comptes porte $actives cards actives au lieu de 4"
fi

rangees=$(psql_db -c "select count(*) from public.cards where channel_id='$CHANNEL_GRANDS_COMPTES' and (archived_at is not null or deleted_at is not null)")
if [ "${rangees:-0}" -eq 2 ]; then
	ok "et deux cards rangées — archivée et corbeille — que le board doit exclure"
else
	fail "$rangees cards rangées au lieu de 2 : l'exclusion du §7.3 n'est plus démontrée"
fi

# Cinq colonnes vides sur sept sont la situation NORMALE, et c'est ce qui distingue une
# composition partant des étapes d'un groupement des cards (§7.3).
occupees=$(psql_db -c "
	select count(distinct current_step_id) from public.cards
	where channel_id='$CHANNEL_GRANDS_COMPTES' and archived_at is null and deleted_at is null")
if [ "${occupees:-0}" -eq 3 ]; then
	ok "elles n'occupent que trois étapes sur sept : quatre colonnes vides sont démontrées"
else
	fail "les cards occupent $occupees étapes au lieu de 3"
fi

# Le seed ne démontre PAS la bascule de la pastille d'ancienneté, et ce fait est FIGÉ ici plutôt
# que découvert en regardant une capture (§7.4). Il appartient à `CRM-046`.
au_dela=$(psql_db -c "
	select count(*) from public.cards c
	join public.workflow_steps s on s.id = c.current_step_id
	join public.workflow_nodes_catalog n on n.id = s.node_id
	where c.archived_at is null and c.deleted_at is null
	  and coalesce(s.stale_after_days, n.default_stale_after_days) is not null
	  and now() - c.entered_step_at > make_interval(days => coalesce(s.stale_after_days, n.default_stale_after_days))")
if [ "${au_dela:-0}" -eq 0 ]; then
	ok "aucune card du seed n'atteint son seuil : l'écart du §7.4 est constaté, pas oublié"
else
	fail "$au_dela cards dépassent leur seuil : l'écart du §7.4 doit être révisé (CRM-046)"
fi

# --- 3. Tests unitaires --------------------------------------------------------------------------

titre "3. Tests unitaires"

if npm run test:unit --silent > "$TRAVAIL/unit.log" 2>&1; then
	ok "npm run test:unit vert"
else
	fail "npm run test:unit en échec — voir $TRAVAIL/unit.log"
	tail -20 "$TRAVAIL/unit.log" || true
fi

if npm run typecheck --silent > "$TRAVAIL/tsc.log" 2>&1; then
	ok "npm run typecheck vert sur les quatre projets"
else
	fail "npm run typecheck en échec — voir $TRAVAIL/tsc.log"
fi

# --- 4. Preuve d'API : les quatre lectures, contre la pile réelle ---------------------------------

titre "4. Preuve d'API — les quatre lectures du §7.2, hors interface"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m preuve d'\''API (--rapide)\n'
else
	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		> "$TRAVAIL/api.log" 2>&1; then
		ok "e2e/api/board.spec.ts vert avec les jetons réels"
	else
		fail "e2e/api/board.spec.ts en échec — voir $TRAVAIL/api.log"
		tail -30 "$TRAVAIL/api.log" || true
	fi
fi

# --- 5. Preuve d'interface, captures et vidéo ----------------------------------------------------

titre "5. Preuve d'interface, captures et vidéo"

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m preuve d'\''interface et build (--rapide)\n'
else
	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		> "$TRAVAIL/ui.log" 2>&1; then
		ok "e2e/ui/board.spec.ts vert contre le build de production"
	else
		fail "e2e/ui/board.spec.ts en échec — voir $TRAVAIL/ui.log"
		tail -30 "$TRAVAIL/ui.log" || true
	fi

	for capture in board-anonyme-1440 board-charge-1440 board-menu-ouvert-1440 \
		board-apres-depot-1440 board-refus-1440 board-champs-manquants-1440 \
		board-motif-exige-1440 board-xl-1440 board-lg-1152 board-md-900 board-sm-390; do
		if [ -s "$CAPTURES/$capture.jpg" ]; then
			ok "capture $capture.jpg produite"
		else
			fail "capture $capture.jpg ABSENTE : la vérification visuelle n'a pas eu lieu"
		fi
	done

	# La vidéo que la Definition of Done exige nommément. Elle est enregistrée délibérément par le
	# scénario dédié, et non récupérée d'un échec : la configuration conserve les vidéos
	# `retain-on-failure`, ce qui n'en produit aucune quand tout va bien.
	if [ -s "$CAPTURES/glisser-deposer.webm" ]; then
		ok "vidéo glisser-deposer.webm produite (Definition of Done de CRM-041)"
	else
		fail "vidéo glisser-deposer.webm ABSENTE : la Definition of Done l'exige nommément"
	fi

	if npm run build --silent > "$TRAVAIL/build.log" 2>&1; then
		ok "npm run build vert"
		if node scripts/lib/classes-css.mjs webapp/src webapp/dist > "$TRAVAIL/classes.log" 2>&1; then
			ok "chaque classe citée par le board existe dans le CSS produit"
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
	# D1 — la composition part des cards au lieu des étapes : les colonnes vides disparaissent.
	# C'est le défaut que le §7.3 interdit nommément, et il serait invisible sur un board où
	# toutes les étapes sont occupées.
	degradation "les colonnes vides disparaissent (§7.3 nié)" "$MODULE" \
		'	const colonnes = ordonnees.map((etape) => {' \
		'	const colonnes = ordonnees
		.filter((etape) => cards.some((card) => card.current_step_id === etape.id))
		.map((etape) => {' unit

	# D2 — l'ordre du menu revient à l'ordre de réception. MESURÉ : `workflow_transitions` ne
	# porte aucune colonne `position` ; sans tri par position de l'étape cible, « Marquer perdu »
	# passerait avant « Relancer » selon l'ordre que PostgREST rend (§7.5).
	degradation "le menu perd son ordre (§7.5 nié)" "$MODULE" \
		'		liste.sort((gauche, droite) => gauche.versEtape.position - droite.versEtape.position)' \
		'		liste.reverse()' unit

	# D3 — le cumul additionne deux devises. Le seed ne mêle jamais deux devises dans une même
	# colonne : cette règle n'est tenue par aucune donnée permanente, seulement par le test.
	degradation "deux devises s'additionnent (§7.3 nié)" "$MODULE" \
		"	if (avecMontant.some((card) => card.currency !== devise)) return null" \
		"	if (false) return null" unit

	# D4 — un refus inconnu est absorbé dans un jeton connu. C'est exactement la valeur par défaut
	# trompeuse que CLAUDE.md §18 proscrit : l'écran annoncerait une raison fausse.
	degradation "un refus inconnu est absorbé (CLAUDE.md §18 nié)" "$MODULE" \
		"	return { cle: null, champsManquants: [], brut: message }" \
		"	return { cle: 'forbidden', champsManquants: [], brut: message }" unit

	# D5 — le déplacement optimiste n'est plus annulé après un refus : la card resterait dans la
	# colonne d'arrivée alors que la base ne l'y a jamais mise (§7.9, docs/DESIGN_SYSTEM.md §6).
	degradation "le retour arrière disparaît après un refus (§7.9 nié)" "$COMPOSANT" \
		'			onCards(avant)
			setRefus(resultat.refus)' \
		'			setRefus(resultat.refus)' unit

	# D6 — une transition à motif redevient optimiste et appelle sans demander le motif. Le §7.8
	# l'interdit, et le contrat de la garde le refuserait de toute façon : l'utilisateur verrait
	# la card partir puis revenir pour rien.
	degradation "une transition à motif appelle sans le demander (§7.8 nié)" "$COMPOSANT" \
		'			if (transition.requiertCommentaire) {' \
		'			if (false) {' unit

	# D7 — toute colonne devient une cible de dépôt. La troisième règle d'origine du §7 tombe :
	# un dépôt sur une colonne non atteignable émettrait un appel que le client savait perdu.
	# Seule la preuve d'INTERFACE peut l'attraper — le refus est celui du navigateur.
	degradation "toute colonne devient une cible de dépôt (§7.6 nié)" "$COMPOSANT" \
		'				if (!atteignable) return
				evenement.preventDefault()
				evenement.dataTransfer.dropEffect = '\''move'\''' \
		'				evenement.preventDefault()
				evenement.dataTransfer.dropEffect = '\''move'\''' ui

	# D8 — le board cesse d'exclure les cards rangées côté serveur. La définition d'« active » de
	# docs/SPEC-cards.md §5 tombe, et le board afficherait des affaires archivées ou en corbeille
	# que `move_card` refuserait de déplacer.
	degradation "les cards rangées reviennent sur le board (§7.3 nié)" "$MODULE" \
		"			.is('archived_at', null)
			.is('deleted_at', null)" \
		"			.order('position')" unit
fi

# --- 7. L'état rendu derrière le harnais ---------------------------------------------------------

titre "7. Ce que le harnais laisse derrière lui"

for fichier in "$MODULE" "$COMPOSANT" "$ROUTE" "$CHANNELS"; do
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
