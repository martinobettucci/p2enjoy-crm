#!/usr/bin/env bash
# @verifies CRM-061 (docs/BACKLOG.md) — tranche 2 : le harnais de la vue « Ma journée »
# @verifies docs/SPEC-cards.md §17.1 (ce que la vue est et n'est pas), §17.2 (l'adresse porte la
#           portée, et la liste est CLOSE), §17.3 (la portée par défaut, choix nommé et réversible),
#           §17.4 (ce que la vue lit, en UNE requête), §17.5 (les trois sections, les deux bornes et
#           l'horizon de sept jours), §17.6 (ce que chaque ligne rend), §17.7 (contrat d'API),
#           §17.8 (les six états), §17.9 (accessibilité), §17.10 (ce qui n'est pas livré),
#           §17.11 (preuves attendues), §17.12 (ce que le seed doit démontrer)
# @verifies docs/SPEC-seed.md §13.5 (le contrat des échéances, lignes a à e, mesurable en base)
# @verifies docs/DESIGN_SYSTEM.md §5.36 (cette surface), §5.29 (pilule de channel), §5.8 (états),
#           §7 (les quatre paliers), §11 (classes réellement engendrées)
# @verifies docs/SPEC-test-harness.md §7.1 (chaîne Node Linux prouvée), §7.2 (non-complaisance)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-061` :
#
#   1. les fichiers de l'unité sont livrés et portent leur traçabilité ;
#   2. le seed tient le contrat du §13.5 **quel que soit le jour où il s'applique** : les trois
#      sections de l'administratrice sont peuplées, la portée élargie rend strictement plus, et une
#      affaire endormie porte une échéance dans l'horizon ;
#   3. la vue ne fait que LIRE : aucun chemin d'écriture, aucun stockage côté client, aucune lecture
#      qu'aucun pixel n'affiche ;
#   4. les tests unitaires, la preuve d'API sur la pile réelle, la preuve d'interface sur session
#      réelle, le build et le contrôle des classes CSS sont verts ;
#   5. les six captures des quatre paliers et des deux états vides existent ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire le fait réellement
#      échouer, et la restauration est **constatée**, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucune écriture**, et c'est le périmètre de l'unité (§17.10) : « Ma journée » lit,
# et le seul chemin d'écriture de `next_action` et `next_action_at` reste l'en-tête de la fiche
# (§15 bis), éprouvé par `scripts/verify-formulaire.sh`.
#
# Il ne prouve **aucune règle d'autorisation par lui-même** : ce que l'écran montre est ce que la
# RLS consent, et le refus est mesuré **hors interface** par `e2e/api/ma-journee.spec.ts` avec les
# jetons réels des trois profils seedés (`CLAUDE.md` §10). Ce harnais rejoue cette preuve, il ne la
# remplace pas.
#
# LA DÉGRADATION DE FUSEAU EXIGE UN HÔTE EN UTC OU NON, INDIFFÉREMMENT, ET C'EST MESURÉ. Les bornes
# du §17.5 se calculent dans le fuseau du **lecteur** ; sur un hôte réglé en UTC — le cas de
# l'environnement d'intégration —, `setHours` et `setUTCHours` rendent la MÊME valeur, et une
# dégradation qui échange les deux serait inerte. Le contrôle correspondant rejoue donc la suite
# unitaire sous `TZ=Pacific/Auckland`, où les deux écritures divergent de treize heures : la suite
# intacte y reste verte, la suite dégradée y devient rouge. Sans ce décalage, le contrôle ne dirait
# rien.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-ma-journee.sh
#   scripts/verify-ma-journee.sh --rapide   n'exécute ni Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

COLONNES=webapp/src/lib/colonnes-ma-journee.ts
MODULE=webapp/src/lib/ma-journee.ts
COMPOSANT=webapp/src/app/MaJournee.tsx
TEST_UNITAIRE=webapp/src/lib/ma-journee.test.ts
TEST_COMPOSANT=webapp/src/app/MaJournee.test.tsx
SPEC_API=e2e/api/ma-journee.spec.ts
SPEC_UI=e2e/ui/ma-journee.spec.ts
CAPTURES=docs/captures/CRM-061
DB_CONTAINER=p2enjoy-db

# `docs/SPEC-seed.md` §2.3 et §13.4 — les identifiants sont stables, et c'est leur raison d'être.
CAMILLE=5eed0000-0000-4000-8000-000000000011
CARD_ENDORMIE=5eed0000-0000-4000-8000-0000000000ca

# Le fuseau qui fait DIVERGER `setHours` de `setUTCHours` sur un hôte en UTC (voir l'en-tête).
FUSEAU_DECALE=Pacific/Auckland
# Les deux suites unitaires de l'unité, pour les rejeux bornés — filtres de chemin de Vitest.
SUITES_UNITE="ma-journee.test MaJournee.test"

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,52p' "$0"; exit 0 ;;
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

for fichier in "$COLONNES" "$MODULE" "$COMPOSANT"; do
	[ -f "$fichier" ] && empreinte_depart "$fichier"
done

# --- 1. Les fichiers livrés et leur traçabilité --------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$COLONNES" "$MODULE" "$COMPOSANT" "$TEST_UNITAIRE" "$TEST_COMPOSANT" \
	"$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$COLONNES" "$MODULE" "$COMPOSANT"; do
	if head -2 "$fichier" | grep -q '@spec CRM-061'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_UNITAIRE" "$TEST_COMPOSANT" "$SPEC_API" "$SPEC_UI"; do
	if head -2 "$fichier" | grep -q '@verifies CRM-061'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# Le module de colonnes n'importe QUE `filtre-sommeil`, et c'est la condition pour que la preuve
# d'API — qui vit dans `tsconfig.tools.json`, sans `vite/client` ni types du DOM — l'atteigne
# (décision 177). `filtre-sommeil.ts` n'importe rien lui-même, et `e2e/` l'atteint déjà.
imports_colonnes=$(grep -cE "^import " "$COLONNES" || true)
if [ "${imports_colonnes:-0}" -eq 0 ]; then
	ok "$(basename "$COLONNES") n'importe rien : la preuve d'API peut l'atteindre (décision 177)"
else
	fail "$(basename "$COLONNES") porte $imports_colonnes import(s) : la preuve d'API ne compilera plus"
fi

# La preuve d'API et la preuve unitaire importent les déclarations du produit plutôt que de les
# recopier : un horizon écrit à deux endroits finit par être écrit de deux façons (§17.5).
for preuve in "$SPEC_API" "$TEST_UNITAIRE"; do
	if grep -qE "from '.*(colonnes-)?ma-journee'" "$preuve"; then
		ok "$(basename "$preuve") importe les déclarations du produit"
	else
		fail "$(basename "$preuve") redéclare ce qu'elle éprouve : elle n'éprouve plus le produit"
	fi
done

# LA PREUVE D'INTERFACE, ELLE, TAPE L'ADRESSE PUBLIQUE, et c'est voulu : ce qu'un utilisateur écrit
# dans sa barre d'adresse est le contrat, et l'importer masquerait un renommage au lieu de le
# révéler. Le contrôle porte donc sur la CONCORDANCE : l'adresse littérale de la preuve doit être
# celle que le module déclare. Renommer la clé ou la valeur sans toucher la preuve fait mordre ici.
cle_portee=$(grep -oP "(?<=^export const CLE_URL_PORTEE = ')[^']+" "$COLONNES" || true)
valeur_portee=$(grep -oP "(?<=^export const VALEUR_URL_PORTEE_TOUS = ')[^']+" "$COLONNES" || true)
if [ -n "$cle_portee" ] && [ -n "$valeur_portee" ] &&
	grep -qF "/ma-journee?$cle_portee=$valeur_portee" "$SPEC_UI"; then
	ok "la preuve d'interface ouvre l'adresse que le module déclare (?$cle_portee=$valeur_portee)"
else
	fail "la preuve d'interface ouvre une adresse que le module ne déclare plus (?$cle_portee=$valeur_portee)"
fi

# Le défaut n'est JAMAIS écrit dans l'adresse (§17.2) : `?qui=moi` ne dirait rien de plus que
# l'adresse nue, et la vue par défaut doit rester l'adresse la plus courte.
if ! grep -qF "/ma-journee?$cle_portee=moi" "$SPEC_UI" "$COMPOSANT"; then
	ok "le défaut n'est jamais écrit dans l'adresse : la vue par défaut reste l'adresse la plus courte"
else
	fail "le défaut est écrit dans l'adresse, ce que le §17.2 interdit"
fi

# Le filtre d'exclusion du sommeil est RÉEMPLOYÉ, jamais réécrit (décision 167, §16.12.1).
if grep -q "from './filtre-sommeil'" "$MODULE"; then
	ok "la journée importe le filtre d'exclusion du sommeil (décision 167)"
else
	fail "la journée réécrit le filtre de sommeil : les deux lectures divergeront"
fi

# --- 2. Le seed porte ce que la journée démontre -------------------------------------------------

titre "2. Le contrat du seed, mesuré en base (docs/SPEC-seed.md §13.5)"

# Les prédicats ci-dessous sont ceux de l'écran, écrits une fois : « active » (§5), non endormie
# (§16.2), et les trois intervalles du §17.5 calculés depuis `date_trunc('day', now())`.
ACTIVE="archived_at is null and deleted_at is null and (snoozed_until is null or snoozed_until <= now())"
JOUR="date_trunc('day', now())"
HORIZON="date_trunc('day', now()) + interval '8 days'"

compte_journee() {
	psql_db -c "select count(*) from public.cards where next_action_at is not null and $ACTIVE and $1"
}

retard=$(compte_journee "owner_id = '$CAMILLE' and next_action_at < $JOUR")
if [ "${retard:-0}" -ge 1 ]; then
	ok "ligne a : $retard affaire(s) EN RETARD pour l'administratrice, quel que soit le jour"
else
	fail "ligne a : aucune affaire en retard pour l'administratrice — le seed a reperdu son décalage (§13.2)"
fi

aujourdhui=$(compte_journee "owner_id = '$CAMILLE' and next_action_at >= $JOUR and next_action_at < $JOUR + interval '1 day'")
if [ "${aujourdhui:-0}" -ge 1 ]; then
	ok "ligne b : $aujourdhui affaire(s) AUJOURD'HUI pour l'administratrice"
else
	fail "ligne b : aucune affaire dans le jour courant — la section « Aujourd'hui » ne se démontre plus"
fi

avenir=$(compte_journee "owner_id = '$CAMILLE' and next_action_at >= $JOUR + interval '1 day' and next_action_at < $HORIZON")
if [ "${avenir:-0}" -ge 1 ]; then
	ok "ligne c : $avenir affaire(s) À VENIR dans les sept jours pour l'administratrice"
else
	fail "ligne c : aucune affaire à venir dans l'horizon — la troisième section ne se démontre plus"
fi

tous=$(compte_journee "next_action_at < $HORIZON")
moi=$(compte_journee "owner_id = '$CAMILLE' and next_action_at < $HORIZON")
if [ "${tous:-0}" -gt "${moi:-0}" ]; then
	ok "ligne d : la portée élargie rend $tous lignes contre $moi — strictement plus, la bascule se démontre"
else
	fail "ligne d : la portée élargie rend $tous lignes contre $moi — la bascule ne démontre rien"
fi

endormies=$(psql_db -c "select count(*) from public.cards where next_action_at is not null and archived_at is null and deleted_at is null and snoozed_until > now() and next_action_at < $HORIZON")
if [ "${endormies:-0}" -eq 1 ]; then
	ok "ligne e : exactement une affaire ENDORMIE porte une échéance dans l'horizon"
else
	fail "ligne e : $endormies affaire(s) endormie(s) dans l'horizon au lieu d'une — l'exclusion du sommeil n'est plus démontrée par une donnée"
fi

endormie_nommee=$(psql_db -c "select count(*) from public.cards where id = '$CARD_ENDORMIE' and snoozed_until > now() and next_action_at < $HORIZON")
if [ "${endormie_nommee:-0}" -eq 1 ]; then
	ok "l'affaire endormie de l'horizon est bien « Cadrage data — Groupe Vallier » (§13.5 ligne e)"
else
	fail "l'affaire endormie de l'horizon n'est plus celle que le contrat nomme (§13.5 ligne e)"
fi

# Le décalage du §13.2 est CONVERGENT : il repart des littéraux du §9 à chaque passage. Un seed qui
# aurait été décalé deux fois porterait ses échéances un mois plus loin, et la journée serait vide.
# Le contrôle ci-dessus le mesure déjà par ses effets ; celui-ci le mesure par sa cause.
hors_horizon=$(psql_db -c "select count(*) from public.cards where next_action_at >= $HORIZON and $ACTIVE")
if [ "${hors_horizon:-0}" -ge 1 ]; then
	ok "$hors_horizon affaire(s) au-delà de l'horizon : la borne du §17.5 a de quoi retrancher"
else
	fail "aucune affaire au-delà de l'horizon : la borne de sept jours ne retranche plus rien"
fi

# --- 3. Ce que la vue NE fait PAS ----------------------------------------------------------------

titre "3. Ce que la vue ne fait pas, et qui doit le rester (§17.10)"

# LA VUE LIT (§17.1). Aucun chemin d'écriture n'y est ouvert : reporter une échéance ou marquer
# « fait » serait une seconde définition du geste de l'en-tête de la fiche (§15 bis).
for interdit in '.insert(' '.update(' '.delete(' '.upsert(' '.rpc('; do
	if ! grep -qF "$interdit" "$MODULE" "$COMPOSANT" "$COLONNES"; then
		ok "la journée n'ouvre aucun chemin d'écriture ($interdit)"
	else
		fail "la journée ouvre un chemin d'écriture ($interdit) : le seul chemin est l'en-tête de la fiche (§15 bis)"
	fi
done

# Aucune persistance côté client : la portée vit dans l'adresse (§17.2, CLAUDE.md §11).
if ! grep -qE "localStorage|sessionStorage|document\.cookie" "$MODULE" "$COMPOSANT" "$COLONNES"; then
	ok "aucun stockage côté client n'est introduit (CLAUDE.md §11, §17.2)"
else
	fail "un stockage côté client est introduit : la portée doit vivre dans l'adresse"
fi

# UNE REQUÊTE QUI NE SERT RIEN EST UNE REQUÊTE DE TROP (§17.4). Cette vue ne range pas par le
# graphe : elle n'a ni libellé d'étape à rendre, ni transition à proposer, ni total à paginer.
#
# Le contrôle porte sur la chaîne RÉELLEMENT ENVOYÉE, et non sur le fichier entier : le commentaire
# du module ÉNUMÈRE ce qu'il ne demande pas — « ni `amount`, ni `owner_id`, … ni `current_step_id` »
# —, et un `grep` du fichier prendrait cette prose pour la déclaration. Un contrôle qui mord sur un
# commentaire est un faux positif, et un faux positif apprend à ne plus lire le harnais.
colonnes_demandees=$(grep -A2 "^export const COLONNES_CARD_JOURNEE" "$COLONNES" | tr -d '\n')
for presente in id title next_action next_action_at 'channels!cards_channel_id_workspace_id_fkey' \
	'tracks(slug, name)'; do
	if printf '%s' "$colonnes_demandees" | grep -qF "$presente"; then
		ok "$presente est demandée : l'écran la rend (§17.4, §17.6)"
	else
		fail "$presente manque : l'écran ne peut plus rendre ce que le §17.6 exige"
	fi
done
for absente in amount owner_id current_step_id position description health_score; do
	if ! printf '%s' "$colonnes_demandees" | grep -qF "$absente"; then
		ok "$absente n'est pas demandée : cette vue range par le TEMPS (§17.4)"
	else
		fail "$absente est demandée alors que rien ne l'affiche (§17.4)"
	fi
done

# AUCUN `count=exact` (§17.4) : il n'y a pas de pagination, donc pas de nombre de pages à calculer,
# et le compte de chaque section est celui des lignes rendues. Demander un total que rien n'affiche
# serait un `count(*)` gratuit à chaque ouverture.
if ! grep -qE "count: '(exact|planned|estimated)'" "$MODULE"; then
	ok "aucun total n'est demandé : le compte d'une section est celui des lignes rendues (§17.4)"
else
	fail "un total est demandé alors que rien ne l'affiche : c'est un count(*) gratuit (§17.4)"
fi

# Aucune lecture des étapes, contrairement à la vue liste : cette vue n'a ni libellé d'étape à
# rendre, ni transition à proposer (§17.4).
if ! grep -qE "workflow_steps|from\('workflow" "$MODULE"; then
	ok "aucune lecture des étapes : une requête qui ne sert rien est une requête de trop (§17.4)"
else
	fail "la journée lit les étapes alors qu'elle ne range pas par le graphe (§17.4)"
fi

# UNE SEULE REQUÊTE (§17.4). Le module n'ouvre qu'un `from(`, et c'est ce qui autorise l'écran à
# n'attendre qu'une réponse.
lectures=$(grep -c "\.from(" "$MODULE" || true)
if [ "${lectures:-0}" -eq 1 ]; then
	ok "la journée lit en UNE seule requête (§17.4)"
else
	fail "la journée ouvre $lectures lectures au lieu d'une : le §17.4 n'en autorise qu'une"
fi

# La bascule de sommeil n'est PAS offerte ici, et c'est un écart NOMMÉ (§17.4, dernier paragraphe) :
# endormir une affaire est le geste qui dit « pas aujourd'hui », et lui donner une case pour
# reparaître dans la journée annulerait ce geste à l'endroit exact où il agit.
if ! grep -qE "sommeil|snooze" "$COMPOSANT"; then
	ok "aucune bascule de sommeil n'est offerte sur cet écran (§17.4)"
else
	fail "l'écran offre une bascule de sommeil : elle annulerait le geste à l'endroit où il agit"
fi

# --- 4. Les tests --------------------------------------------------------------------------------

titre "4. Tests unitaires, preuve d'API, preuve d'interface et build"

if npm run test:unit --silent > "$TRAVAIL/unit.log" 2>&1; then
	ok "npm run test:unit : vert"
else
	fail "npm run test:unit : ROUGE — voir $TRAVAIL/unit.log"
fi

# LES BORNES SUIVENT LE FUSEAU DU LECTEUR, ET C'EST ÉPROUVÉ AILLEURS QU'EN UTC. Sur un hôte réglé
# en UTC, une suite verte ne dirait pas si les bornes sont locales ou universelles : les deux
# écritures coïncident. Rejouée sous un fuseau décalé de treize heures, elle le dit.
#
# LE REJEU EST BORNÉ AUX DEUX SUITES DE CETTE UNITÉ, et le motif est mesuré le 2026-08-24 : sous ce
# fuseau, QUATRE tests étrangers à `CRM-061` échouent — `EnTeteCard.test.tsx` et `sommeil-card.test`
# de `CRM-081`, `timeline.test` de `CRM-044` —, qui figent une date rendue dans le fuseau de l'hôte.
# C'est INC-203 au registre. Rejouer la suite entière rendrait ici un rouge qui ne dirait rien des
# bornes de la journée, et pire, ferait passer la dégradation D9 pour détectée alors qu'elle ne
# l'aurait pas été.
if TZ="$FUSEAU_DECALE" npm run test:unit --silent -- $SUITES_UNITE > "$TRAVAIL/unit-fuseau.log" 2>&1; then
	ok "les suites de CRM-061 sous TZ=$FUSEAU_DECALE : vertes — les bornes suivent la montre du lecteur (§17.5)"
else
	fail "les suites de CRM-061 sous TZ=$FUSEAU_DECALE : ROUGES — voir $TRAVAIL/unit-fuseau.log"
fi

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m preuves Playwright et build (--rapide)\n'
else
	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		> "$TRAVAIL/api.log" 2>&1; then
		ok "e2e/api/ma-journee.spec.ts : vert contre la pile réelle, jetons des trois profils"
	else
		fail "e2e/api/ma-journee.spec.ts : ROUGE — voir $TRAVAIL/api.log"
	fi

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		> "$TRAVAIL/ui.log" 2>&1; then
		ok "e2e/ui/ma-journee.spec.ts : vert sur session réelle, contre le build de production"
	else
		fail "e2e/ui/ma-journee.spec.ts : ROUGE — voir $TRAVAIL/ui.log"
	fi

	if npm run typecheck > "$TRAVAIL/typecheck.log" 2>&1; then
		ok "npm run typecheck : vert"
	else
		fail "npm run typecheck : ROUGE — voir $TRAVAIL/typecheck.log"
	fi

	if npm run build > "$TRAVAIL/build.log" 2>&1; then
		ok "npm run build : vert"
	else
		fail "npm run build : ROUGE — voir $TRAVAIL/build.log"
	fi

	# Une classe dont le jeton n'est pas déclaré n'est pas engendrée, et en silence (§11).
	if node scripts/lib/classes-css.mjs webapp/src webapp/dist > "$TRAVAIL/classes.log" 2>&1; then
		ok "chaque classe citée par la journée existe dans le CSS produit"
	else
		fail "une classe citée n'existe pas dans le CSS produit — voir $TRAVAIL/classes.log"
	fi
fi

# --- 5. Les captures -----------------------------------------------------------------------------

titre "5. Captures produites et observées (CLAUDE.md §16)"

for capture in ma-journee-xl-1440 ma-journee-lg-1152 ma-journee-md-900 ma-journee-sm-390 \
	ma-journee-vide-moi-1440 ma-journee-vide-tous-1440; do
	if [ -s "$CAPTURES/$capture.jpg" ]; then
		ok "$capture.jpg est produite"
	else
		fail "$capture.jpg est ABSENTE : la Definition of Done exige les quatre paliers et les DEUX vides"
	fi
done

# --- 6. Dégradations : le harnais est-il complaisant ? --------------------------------------------

titre "6. Dégradations volontaires — le harnais échoue-t-il vraiment ?"

# `fuseau` est le seul argument optionnel : il n'existe que pour la dégradation des bornes, dont
# l'effet est nul sur un hôte en UTC (voir l'en-tête du fichier).
degradation() {
	local libelle=$1 fichier=$2 avant=$3 apres=$4 cible=$5 fuseau=${6:-}
	sauvegarder "$fichier"
	# LA SUBSTITUTION SE VÉRIFIE ELLE-MÊME, ET C'EST UNE LEÇON MESURÉE LE 2026-08-24.
	#
	# Ce garde-fou était écrit `grep -qF "$avant"`. Or `grep -F` traite un motif contenant un saut
	# de ligne comme PLUSIEURS motifs alternatifs, et la dernière ligne d'un motif qui se termine
	# par un saut est la chaîne VIDE — qui correspond à tout. Le garde-fou rendait donc vrai pour
	# n'importe quel motif multi-ligne, y compris un motif faux. MESURÉ : la dégradation D1 portait
	# quatre tabulations là où le fichier en porte trois ; le garde-fou a laissé passer, `replace`
	# n'a RIEN remplacé, la suite est restée verte, et le harnais a conclu « COMPLAISANT » sur une
	# dégradation qui n'avait jamais eu lieu. Un verdict faux dans un détecteur de complaisance est
	# exactement ce qu'il existe pour empêcher.
	#
	# Le remède est de faire trancher Python, qui compare le texte AVANT et APRÈS : une substitution
	# sans effet sort en erreur, et le contrôle dit « IMPOSSIBLE » au lieu de mentir dans un sens ou
	# dans l'autre.
	if ! python3 - "$fichier" "$avant" "$apres" <<'PY'
import sys
chemin, avant, apres = sys.argv[1:4]
source = open(chemin, encoding='utf-8').read()
neuf = source.replace(avant, apres, 1)
if neuf == source:
	sys.exit(1)
open(chemin, 'w', encoding='utf-8').write(neuf)
PY
	then
		fail "dégradation « $libelle » IMPOSSIBLE : le motif n'existe plus dans $fichier — ce contrôle ne dit RIEN"
		return
	fi
	if [ "$cible" = unit ]; then
		# Sous un fuseau décalé, le rejeu est borné aux deux suites de l'unité : quatre tests
		# étrangers y échouent (INC-203), et la suite entière ferait passer la dégradation pour
		# détectée alors qu'elle ne l'aurait pas été.
		if [ -n "$fuseau" ]; then
			verdict_degradation=$(TZ="$fuseau" npm run test:unit --silent -- $SUITES_UNITE > "$TRAVAIL/degr.log" 2>&1 && echo vert || echo rouge)
		else
			verdict_degradation=$(npm run test:unit --silent > "$TRAVAIL/degr.log" 2>&1 && echo vert || echo rouge)
		fi
		if [ "$verdict_degradation" = vert ]; then
			fail "COMPLAISANT : « $libelle » et les tests unitaires restent verts"
		else
			ok "« $libelle » fait échouer les tests unitaires"
		fi
	else
		# La preuve d'interface s'exécute contre le **build de production** : Playwright le
		# reconstruit à chaque exécution, la dégradation est donc bien celle qui est servie.
		if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
			> "$TRAVAIL/degr.log" 2>&1; then
			fail "COMPLAISANT : « $libelle » et la preuve d'interface reste verte"
		else
			ok "« $libelle » fait échouer la preuve d'interface"
		fi
	fi
	rendre "$fichier"
}

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORÉ\033[0m dégradations (--rapide)\n'
else
	# D1 — l'ordre cesse d'être TOTAL : le départage par identifiant disparaît. C'est la leçon
	# mesurée du §12.4, tenue au §17.4 — deux ouvertures de l'écran n'afficheraient plus la même
	# liste entre deux affaires de même échéance et de même titre.
	degradation "l'ordre n'est plus total (§17.4 nié)" "$MODULE" \
		"			.order('id', { ascending: true })
" "" unit

	# D2 — la borne d'horizon tombe : la vue cesse d'être une JOURNÉE et devient la vue liste triée
	# par échéance, qui existe déjà (§17.5). C'est aussi ce qui bornait la lecture, et donc ce qui
	# rendait la pagination inutile (§17.4).
	degradation "la borne d'horizon tombe (§17.5 nié)" "$MODULE" \
		"			.lt('next_action_at', bornes.horizon.toISOString())" \
		"			.not('next_action_at', 'is', null)" unit

	# D3 — le filtre de sommeil est RÉÉCRIT au lieu d'être réemployé : une affaire dont le sommeil
	# est expiré resterait masquée. C'est exactement la divergence que la décision 167 interdit.
	degradation "le filtre de sommeil est réécrit (§16.12.1 nié)" "$MODULE" \
		"			.or(filtreExclusionSommeil(maintenant))" \
		"			.or('snoozed_until.is.null')" unit

	# D4 — les affaires rangées reviennent dans la journée : c'est la définition d'« active » du §5,
	# la même qu'emploient le board et la vue liste.
	degradation "les affaires archivées reviennent (§5 nié)" "$MODULE" \
		"			.is('archived_at', null)" \
		"			.is('workspace_id', null) // dégradation" unit

	# D5 — le filtre par responsable part sous la portée « tous » : la bascule cesse de basculer, et
	# « tout l'espace de travail » ne rendrait plus que les affaires de l'appelant (§17.3).
	degradation "le filtre par responsable part sous « tous » (§17.3 nié)" "$MODULE" \
		"	const responsable = portee === 'moi' ? idUtilisateur : null" \
		"	const responsable = idUtilisateur" unit

	# D6 — une ligne SANS échéance reçoit une section par défaut au lieu d'être écartée : c'est la
	# valeur par défaut trompeuse que `CLAUDE.md` §18 interdit, et elle rangerait l'affaire « en
	# retard » depuis 1970.
	degradation "une échéance absente devient 1970 (CLAUDE.md §18 nié)" "$MODULE" \
		"	if (ligne.next_action_at === null) return null" \
		"	if (ligne.next_action_at === null)
		return {
			id: ligne.id,
			titre: ligne.title,
			prochaineAction: ligne.next_action,
			echeance: new Date(0),
			adresse: null,
			adresseChannel: null,
			nomTrack: null,
			nomChannel: null,
		}" unit

	# D7 — la clôture de la portée tombe : `?qui=n_importe_quoi` atteindrait la requête au lieu de
	# se replier sur le défaut (§17.2). Une adresse tapée à la main n'est pas une panne.
	degradation "une portée inconnue atteint la requête (§17.2 nié)" "$COLONNES" \
		"	return valeur === VALEUR_URL_PORTEE_TOUS ? 'tous' : PORTEE_PAR_DEFAUT" \
		"	return (valeur ?? PORTEE_PAR_DEFAUT) as Portee" unit

	# D8 — l'horizon quitte les sept jours du §17.5 : la vue montrerait les échéances du mois
	# prochain, et ne serait plus une journée.
	degradation "l'horizon passe à trente jours (§17.5 nié)" "$COLONNES" \
		"export const HORIZON_JOURS = 7" \
		"export const HORIZON_JOURS = 30" unit

	# D9 — LES BORNES QUITTENT LE FUSEAU DU LECTEUR pour l'UTC. Sur un hôte en UTC les deux
	# écritures coïncident : cette dégradation est donc rejouée sous un fuseau décalé de treize
	# heures, sans quoi elle ne dirait rien (§17.5, et l'en-tête de ce fichier).
	degradation "les bornes passent en UTC (§17.5 nié)" "$COLONNES" \
		"	debutJour.setHours(0, 0, 0, 0)" \
		"	debutJour.setUTCHours(0, 0, 0, 0)" unit "$FUSEAU_DECALE"

	# D10 — une section vide est rendue : trois titres surmontant trois vides diraient trois fois
	# « rien » là où leur absence le dit une fois (§17.8).
	degradation "une section vide est rendue (§17.8 nié)" "$COMPOSANT" \
		"					return affaires.length === 0 ? null : (" \
		"					return false ? null : (" unit

	# D11 — `aria-current` est posé sur les DEUX portées : un lecteur d'écran ne saurait plus
	# laquelle est ouverte. C'est précisément ce que `NavLink` aurait fait (§17.9).
	degradation "aria-current ment sur la portée ouverte (§17.9 nié)" "$COMPOSANT" \
		"							{...(portee === entree.portee ? { 'aria-current': 'page' as const } : {})}" \
		"							{...{ 'aria-current': 'page' as const }}" unit

	# D12 — la pilule « Track › Channel » cesse de mener au channel : elle porterait son icône de
	# sortie sans destination, ce qui est la commande morte que le §5.10 proscrit. C'est le défaut
	# trouvé en regardant une capture, et il ne doit pas pouvoir revenir en silence (§17.6).
	degradation "la pilule ne mène plus au channel (§17.6 nié)" "$COMPOSANT" \
		"												to={affaire.adresseChannel}" \
		"												to=\"/ma-journee\"" unit
fi

# --- 7. L'état rendu derrière le harnais ---------------------------------------------------------

titre "7. Ce que le harnais laisse derrière lui"

for fichier in "$COLONNES" "$MODULE" "$COMPOSANT"; do
	if est_rendu_intact "$fichier"; then
		ok "$(basename "$fichier") est rendu tel qu'il était à l'entrée du harnais"
	else
		fail "$(basename "$fichier") est laissé MODIFIÉ : une dégradation n'a pas été restaurée"
	fi
done

# LE SEED EST RELU APRÈS COUP, et non supposé intact : la preuve d'API de la ligne h déplace
# réellement une échéance du seed pour éprouver la borne dans les deux sens, et la restaure. C'est
# la leçon de la décision 501 — une preuve qui dégrade le produit doit le rendre —, et elle se
# constate ici plutôt qu'elle ne se croit.
retard_final=$(compte_journee "owner_id = '$CAMILLE' and next_action_at < $JOUR")
aujourdhui_final=$(compte_journee "owner_id = '$CAMILLE' and next_action_at >= $JOUR and next_action_at < $JOUR + interval '1 day'")
avenir_final=$(compte_journee "owner_id = '$CAMILLE' and next_action_at >= $JOUR + interval '1 day' and next_action_at < $HORIZON")
if [ "$retard_final" = "$retard" ] && [ "$aujourdhui_final" = "$aujourdhui" ] && [ "$avenir_final" = "$avenir" ]; then
	ok "le seed rend les mêmes trois sections qu'à l'entrée : $retard_final / $aujourdhui_final / $avenir_final"
else
	fail "le seed a CHANGÉ derrière les preuves : $retard/$aujourdhui/$avenir à l'entrée, $retard_final/$aujourdhui_final/$avenir_final à la sortie"
fi

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
