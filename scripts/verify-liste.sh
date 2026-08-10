#!/usr/bin/env bash
# @verifies CRM-042 (docs/BACKLOG.md) — Definition of Done de la vue liste
# @verifies docs/SPEC-cards.md §12.2 (l'adresse porte tout), §12.3 (les deux lectures et le total
#           exact), §12.4 (le tri TOTAL et `nullslast`), §12.5 (les filtres côté serveur),
#           §12.6 (pagination et `416`), §12.7 (tableau et densité), §12.7 bis (état vide),
#           §12.8 (accessibilité), §12.9 (états), §12.11 (points ouverts), §12.12 (preuves)
# @verifies docs/DESIGN_SYSTEM.md §5.9 (tableau de données), §7 (paliers), §8 (accessibilité),
#           §11 (classes réellement engendrées), §12.6 (débordement signalé)
# @verifies docs/INCONSISTENCY_REPORT.md INC-021 (webapp anonyme), INC-067 (représentation de
#           `cards.amount`) ; CRM-022 ferme INC-014 par une identité embarquée
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-042` :
#
#   1. les tests unitaires de la composition et du composant réel sont verts ;
#   2. la preuve d'API confronte les **deux lectures de la liste** à la pile réelle, avec le jeton
#      de l'administratrice, et constate le refus opposé à l'anonyme ;
#   3. les scénarios d'interface s'exécutent contre le **build de production** servi, les captures
#      des quatre paliers sont produites, et celles des **données longues** avec elles ;
#   4. le build est vert et chaque classe citée par la liste existe dans le CSS produit ;
#   5. le seed porte ce que la liste démontre : quatre cards actives sur trois étapes, sept étapes,
#      une card sans montant, une devise autre qu'`EUR`, une archivée et une en corbeille ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire le fait échouer, et
#      la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucun tri, aucun filtre et aucune pagination par un utilisateur connecté** : la
# webapp est un appelant anonyme faute d'écran de connexion (INC-021), et la liste ne s'affiche
# jamais en conditions réelles. Les états chargés sont prouvés en substituant la réponse réseau,
# procédé endossé par docs/DESIGN_SYSTEM.md §12.5 — et le contrat de lecture, lui, est prouvé hors
# interface par `e2e/api/liste-cards.spec.ts` avec le jeton réel de l'administratrice.
#
# Il ne prouve **aucun comportement au-delà de 25 lignes contre la base réelle** : le seed ne porte
# pas de channel de plus de quatre cards actives. La seconde page est prouvée contre une réponse
# substituée, et par la mesure directe de l'`offset` sur la pile. Le manque appartient à `CRM-046`.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-liste.sh
#   scripts/verify-liste.sh --rapide   n'exécute ni Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MODULE=webapp/src/lib/liste-cards.ts
COLONNES=webapp/src/lib/colonnes-liste.ts
COMPOSANT=webapp/src/app/ListeCards.tsx
ROUTE=webapp/src/app/RouteTrack.tsx
TEST_UNITAIRE=webapp/src/lib/liste-cards.test.ts
TEST_COMPOSANT=webapp/src/app/ListeCards.test.tsx
SPEC_API=e2e/api/liste-cards.spec.ts
SPEC_UI=e2e/ui/liste-cards.spec.ts
CAPTURES=docs/captures/CRM-042
DB_CONTAINER=p2enjoy-db

WORKFLOW_GLOBAL=5eed0000-0000-4000-8000-000000000051
CHANNEL_GRANDS_COMPTES=5eed0000-0000-4000-8000-000000000032
CHANNEL_INTER_ENTREPRISES=5eed0000-0000-4000-8000-000000000036

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,44p' "$0"; exit 0 ;;
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

# Toute dégradation est restaurée, y compris si le script échoue en cours de route : un harnais qui
# laisse le produit dégradé derrière lui est pire que pas de harnais du tout (décisions 143, 157).
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

# État des fichiers dégradables **à l'entrée du harnais**, et non l'état de `HEAD` : un contrôle qui
# comparerait au dernier commit ne pourrait pas être vert pendant qu'on travaille (décision 166).
DEPART=$(mktemp -d)
empreinte_depart() { cp "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')"; }
est_rendu_intact() { diff -q "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')" >/dev/null 2>&1; }

for fichier in "$MODULE" "$COLONNES" "$COMPOSANT" "$ROUTE"; do
	[ -f "$fichier" ] && empreinte_depart "$fichier"
done

# --- 1. Les fichiers livrés et leur traçabilité --------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MODULE" "$COLONNES" "$COMPOSANT" "$ROUTE" "$TEST_UNITAIRE" "$TEST_COMPOSANT" \
	"$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MODULE" "$COLONNES" "$COMPOSANT" "$ROUTE"; do
	if head -3 "$fichier" | grep -q '@spec CRM-04[12]'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_UNITAIRE" "$TEST_COMPOSANT" "$SPEC_API" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-042'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# Le module de colonnes n'importe rien : c'est la condition pour que la preuve d'API, qui vit dans
# un autre projet TypeScript, puisse l'atteindre sans traîner les types du DOM (décision 177).
if ! grep -qE "^import " "$COLONNES"; then
	ok "$(basename "$COLONNES") n'importe rien : la preuve d'API peut l'atteindre"
else
	fail "$(basename "$COLONNES") importe quelque chose : la preuve d'API ne compilera plus"
fi

# Les deux preuves importent les colonnes et le pas du produit plutôt que de les redéclarer.
for preuve in "$SPEC_API" "$SPEC_UI"; do
	if grep -q "webapp/src/lib/colonnes-liste" "$preuve"; then
		ok "$(basename "$preuve") importe les déclarations du produit"
	else
		fail "$(basename "$preuve") redéclare ce qu'elle éprouve : elle n'éprouve plus le produit"
	fi
done

# La lecture des étapes est celle du board, importée et non réécrite (décision 188).
if grep -q "from './board'" "$MODULE"; then
	ok "la liste importe la lecture des étapes du board (décision 188)"
else
	fail "la liste réécrit la lecture des étapes : les deux lectures divergeront"
fi

# --- 2. Le seed porte ce que la liste démontre ---------------------------------------------------

titre "2. Le seed porte les données que la liste démontre"

actives=$(psql_db -c "select count(*) from public.cards where channel_id='$CHANNEL_GRANDS_COMPTES' and archived_at is null and deleted_at is null")
if [ "${actives:-0}" -eq 4 ]; then
	ok "quatre cards actives dans « Grands comptes » : le tableau a de quoi être non vide"
else
	fail "$actives cards actives au lieu de 4 : les preuves de la liste ne tiennent plus"
fi

rangees=$(psql_db -c "select count(*) from public.cards where channel_id='$CHANNEL_GRANDS_COMPTES' and (archived_at is not null or deleted_at is not null)")
if [ "${rangees:-0}" -eq 2 ]; then
	ok "deux cards rangées : la contre-épreuve d'exclusion du §5 est démontrable"
else
	fail "$rangees cards rangées au lieu de 2 : la contre-épreuve d'exclusion n'a plus de matière"
fi

etapes=$(psql_db -c "select count(*) from public.workflow_steps where workflow_id='$WORKFLOW_GLOBAL'")
if [ "${etapes:-0}" -eq 7 ]; then
	ok "sept étapes au workflow : le filtre par étape a sept choix"
else
	fail "$etapes étapes au lieu de 7 : les choix du filtre changent"
fi

# Une card sans montant : c'est ce qui rend `nullslast` démontrable par une donnée permanente, et
# non par un cas fabriqué (§12.4).
sans_montant=$(psql_db -c "select count(*) from public.cards where channel_id='$CHANNEL_INTER_ENTREPRISES' and amount is null and archived_at is null and deleted_at is null")
if [ "${sans_montant:-0}" -eq 1 ]; then
	ok "une card sans montant : nullslast est démontré par une donnée, pas par un cas fabriqué"
else
	fail "$sans_montant card sans montant au lieu de 1 : nullslast n'est plus démontré"
fi

# Le seed ne porte AUCUNE donnée longue : le fait est mesuré et figé, plutôt que supposé (§12.11).
plus_long=$(psql_db -c "select coalesce(max(length(title)), 0) from public.cards")
if [ "${plus_long:-0}" -lt 40 ]; then
	ok "le titre le plus long du seed fait $plus_long caractères : les données longues sont servies (§12.11)"
else
	fail "le seed porte désormais un titre de $plus_long caractères : le §12.11 doit être revu"
fi

# Aucun channel de plus de 25 cards : la seconde page est prouvée contre une réponse substituée.
plus_gros=$(psql_db -c "select coalesce(max(n), 0) from (select count(*) n from public.cards where archived_at is null and deleted_at is null group by channel_id) c")
if [ "${plus_gros:-0}" -le 25 ]; then
	ok "aucun channel ne dépasse une page ($plus_gros cards au plus) : le §12.11 dit vrai"
else
	fail "un channel porte $plus_gros cards : la seconde page est désormais démontrable en réel"
fi

# --- 3. Ce que la liste NE fait PAS -------------------------------------------------------------

titre "3. Ce que la liste ne fait pas, et qui doit le rester"

# La liste LIT. Aucun chemin d'écriture n'y est ouvert : le déplacement est le geste du board,
# gardé par `move_card` (§12.1).
for interdit in '.insert(' '.update(' '.delete(' '.upsert(' '.rpc('; do
	if ! grep -qF "$interdit" "$MODULE" "$COMPOSANT"; then
		ok "la liste n'ouvre aucun chemin d'écriture ($interdit)"
	else
		fail "la liste ouvre un chemin d'écriture ($interdit) : c'est le geste du board"
	fi
done

# CRM-022 ferme INC-014 : la liste demande l'identifiant de relation et le profil embarqué, sans
# lecture supplémentaire par ligne. Le contrôle porte sur la déclaration réellement envoyée.
colonnes_demandees=$(grep -A2 "^export const COLONNES_CARD_LISTE" "$COLONNES" | tr -d '\n')
for presente in owner_id 'responsable:profiles!cards_owner_id_fkey'; do
	if printf '%s' "$colonnes_demandees" | grep -qF "$presente"; then
		ok "$presente est demandée pour nommer le responsable (§12.3, CRM-022)"
	else
		fail "$presente manque : la liste ne peut pas nommer le responsable"
	fi
done
for absente in position description health_score; do
	if ! printf '%s' "$colonnes_demandees" | grep -q "$absente"; then
		ok "$absente n'est pas demandée par la page (§12.3)"
	else
		fail "$absente est demandée alors que rien ne l'affiche (§12.3)"
	fi
done

# Aucune persistance côté client n'est introduite : l'état vit dans l'adresse (CLAUDE.md §11).
if ! grep -qE "localStorage|sessionStorage|document\.cookie" "$MODULE" "$COMPOSANT"; then
	ok "aucun stockage côté client n'est introduit (CLAUDE.md §11, décision 184)"
else
	fail "un stockage côté client est introduit : l'état de la liste doit vivre dans l'adresse"
fi

# --- 4. Les tests -------------------------------------------------------------------------------

titre "4. Tests unitaires, preuve d'API et preuve d'interface"

if npm run test:unit --silent > "$TRAVAIL/unit.log" 2>&1; then
	ok "npm run test:unit : vert"
else
	fail "npm run test:unit : ROUGE — voir $TRAVAIL/unit.log"
fi

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m preuves Playwright et build (--rapide)\n'
else
	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		> "$TRAVAIL/api.log" 2>&1; then
		ok "e2e/api/liste-cards.spec.ts : vert contre la pile réelle"
	else
		fail "e2e/api/liste-cards.spec.ts : ROUGE — voir $TRAVAIL/api.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		> "$TRAVAIL/ui.log" 2>&1; then
		ok "e2e/ui/liste-cards.spec.ts : vert contre le build de production"
	else
		fail "e2e/ui/liste-cards.spec.ts : ROUGE — voir $TRAVAIL/ui.log"
	fi

	if npm run build > "$TRAVAIL/build.log" 2>&1; then
		ok "npm run build : vert"
	else
		fail "npm run build : ROUGE — voir $TRAVAIL/build.log"
	fi

	# Une classe dont le jeton n'est pas déclaré n'est pas engendrée, et en silence (§11).
	if node scripts/lib/classes-css.mjs webapp/src webapp/dist > "$TRAVAIL/classes.log" 2>&1; then
		ok "chaque classe citée par la liste existe dans le CSS produit"
	else
		fail "une classe citée n'existe pas dans le CSS produit — voir $TRAVAIL/classes.log"
	fi
fi

# --- 5. Les captures ----------------------------------------------------------------------------

titre "5. Captures produites et observées"

for capture in liste-anonyme-1440 liste-chargee-1440 liste-tri-montant-1440 \
	liste-filtre-sans-resultat-1440 liste-pagination-1440 liste-page-inexistante-1440 \
	liste-donnees-longues-1440 liste-donnees-longues-390 \
	liste-xl-1440 liste-lg-1152 liste-md-900 liste-sm-390; do
	if [ -s "$CAPTURES/$capture.jpg" ]; then
		ok "$capture.jpg est produite"
	else
		fail "$capture.jpg est ABSENTE : la Definition of Done exige les quatre paliers et les données longues"
	fi
done

# --- 6. Dégradations : le harnais est-il complaisant ? -------------------------------------------

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
	# D1 — l'ordre cesse d'être TOTAL : le départage par `id` disparaît. C'est LE défaut de
	# l'unité, celui que la sonde `sonde_l2` a mesuré — 20 lignes rendues, 17 distinctes.
	degradation "l'ordre n'est plus total (§12.4 nié)" "$MODULE" \
		"	return [principal, ...departage]" \
		"	return [principal]" unit

	# D2 — `nullslast` tombe : une affaire SANS montant remonterait en tête d'un tri descendant.
	degradation "les valeurs absentes remontent en tête (§12.4 nié)" "$MODULE" \
		"	const principal: OrdreColonne = { colonne: tri, ascendant: sens === 'asc', nullsFirst: false }" \
		"	const principal = { colonne: tri, ascendant: sens === 'asc', nullsFirst: true } as unknown as OrdreColonne" unit

	# D3 — la clôture des tris tombe : `?tri=couleur_préférée` deviendrait un `order=` envoyé à
	# l'API, et un appelant sonderait l'existence d'une colonne par la différence 200 / 400.
	degradation "un tri inconnu part vers l'API (§12.2 nié)" "$MODULE" \
		"	const tri = connu?.cle ?? TRI_PAR_DEFAUT" \
		"	const tri = (triDemande ?? TRI_PAR_DEFAUT) as CleTri" unit

	# D4 — la forme de l'étape n'est plus vérifiée avant d'entrer dans un `eq.`.
	degradation "une étape mal formée part vers l'API (§12.2 nié)" "$MODULE" \
		"		etape: etapeDemandee !== null && FORME_UUID.test(etapeDemandee) ? etapeDemandee : null," \
		"		etape: etapeDemandee," unit

	# D5 — le total redevient estimé. MESURÉ : `count=planned` rend 1 là où la table en porte 3.
	degradation "le total redevient estimé (§12.3 nié)" "$MODULE" \
		"			.select(COLONNES_CARD_LISTE, { count: 'exact' })" \
		"			.select(COLONNES_CARD_LISTE, { count: 'planned' })" unit

	# D6 — le `416` est absorbé comme une erreur ordinaire : l'écran afficherait « Chargement
	# impossible » à qui a seulement gardé son onglet ouvert (§12.6, règle 2).
	degradation "le 416 redevient une erreur muette (§12.6 nié)" "$MODULE" \
		"		if (reponse.erreur.code === CODE_PAGE_INEXISTANTE) return pret({ nature: 'page_inexistante' })" \
		"		if (false) return pret({ nature: 'page_inexistante' })" unit

	# D7 — un total manquant devient zéro. C'est la valeur par défaut trompeuse du §18 : l'écran
	# annoncerait « aucune affaire » parce qu'il n'a pas su compter.
	degradation "un total manquant devient zéro (CLAUDE.md §18 nié)" "$MODULE" \
		"	if (reponse.donnees === null || reponse.total === null) {" \
		"	if (false) {" unit

	# D8 — le bornage du rang de page disparaît : `page=99` part chercher une page que la première
	# réponse suffisait à écarter, et rend le `416` (§12.6, règle 1).
	degradation "le rang de page n'est plus borné (§12.6 nié)" "$MODULE" \
		"	return Math.min(entier, nombreDePages(total))" \
		"	return entier" unit

	# D9 — les filtres d'exclusion tombent : les cards archivées et en corbeille reviennent dans
	# la liste. C'est la définition d'« active » du §5, la même qu'emploie `move_card`.
	degradation "les cards rangées reviennent dans la liste (§5 nié)" "$MODULE" \
		"			.is('archived_at', null)" \
		"			.is('workspace_id', null) // dégradation" unit

	# D10 — la recherche repasse en `ilike`, qui ne peut pas employer l'index GIN de `search_tsv`.
	degradation "la recherche quitte search_tsv (§12.5 nié)" "$MODULE" \
		"			requete = requete.textSearch('search_tsv', parametres.recherche, {" \
		"			requete = requete.ilike('title', \`%\${parametres.recherche}%\`); void ((x: unknown) => x)({" unit

	# D11 — l'état vide cesse de remplacer le tableau : la carcasse d'en-têtes revient, et c'est
	# exactement ce que la capture a dénoncé (§12.7 bis, décision 190).
	degradation "la carcasse de tableau revient sous l'état vide (§12.7 bis nié)" "$COMPOSANT" \
		"	const vide = total === 0 && etatVide !== undefined" \
		"	const vide = false" unit

	# D12 — `aria-sort` est posé sur toutes les colonnes triables : un lecteur d'écran ne saurait
	# plus laquelle porte le tri (§12.8).
	degradation "aria-sort ment sur la colonne triée (§12.8 nié)" "$COMPOSANT" \
		"			aria-sort={actif ? (sens === 'asc' ? 'ascending' : 'descending') : 'none'}" \
		"			aria-sort={sens === 'asc' ? 'ascending' : 'descending'}" unit
fi

# --- 7. L'état rendu derrière le harnais ---------------------------------------------------------

titre "7. Ce que le harnais laisse derrière lui"

for fichier in "$MODULE" "$COLONNES" "$COMPOSANT" "$ROUTE"; do
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
