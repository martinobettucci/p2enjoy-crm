#!/usr/bin/env bash
# @verifies CRM-085 (docs/BACKLOG.md) — Definition of Done des lignes de coût : le modèle livré par
#           la tranche 1, et la SECTION « Coûts » de la fiche d'affaire livrée par la tranche 2
# @verifies docs/SPEC-costs.md §2.3 (`actual_cost` nul n'est PAS zéro, aucune colonne de devise,
#           aucune unicité, un budget clôturé n'accepte aucune ligne neuve mais son réel reste
#           saisissable), §3.1 (la double condition de lecture), §3.2 (qui écrit une ligne),
#           §4.4 (« n lignes sans coût réel saisi »), §4.6 (la section), §4.7 (les états)
# @verifies docs/SCHEMA.md §9 bis.6 (card_costs), §9 bis.7 (les politiques)
# @verifies docs/DESIGN_SYSTEM.md §1 (les couleurs sont des JETONS), §5.3 (la colonne hôte),
#           §5.9 (le patron de tableau), §7 (les quatre paliers)
# @verifies CLAUDE.md §16 (vérification visuelle), §18 (aucune temporisation), §22 (clavier)
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve.
# ---------------------------------------------------------------------------------------------
#   1. les fichiers des deux tranches sont livrés et portent leur traçabilité `@spec` /
#      `@verifies`, y compris depuis la fiche qui ACCUEILLE la section ;
#   2. les captures des quatre paliers et des deux surfaces d'écriture sont livrées ;
#   3. les règles que le CODE porte, et qu'aucune suite ni aucune capture ne rendrait rouges ;
#   4. le modèle est réellement EN BASE : la table, ses index dont le PARTIEL des lignes sans
#      réel, les deux triggers, les quatre politiques, et le seed dans l'état que les preuves
#      attendent — dont le cas croisé qui motive la double condition de lecture ;
#   5. Vitest — le module client de la section ;
#   6. la suite pgTAP de l'unité ;
#   7. la preuve d'API, qui mesure les TROIS formes du refus hors interface ;
#   8. la preuve d'interface, sur la pile seedée, au clavier ET à la souris ;
#   9. le harnais est NON COMPLAISANT : trois dégradations réelles, portant chacune sur une règle
#      que `docs/SPEC-costs.md` énonce, doivent faire ÉCHOUER une preuve — et la restauration est
#      constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# LES ÉCRANS DE COÛTS ET L'ONGLET « À SAISIR » NE SONT PAS ATTENDUS ICI : les §4.2, §4.3, §4.5 et
# §4.8 sont portés par `CRM-086`. Un contrôle qui les exigerait rendrait rouge une unité
# correctement livrée.
#
# LE FILTRE PAR TRACK DU SÉLECTEUR EST UNE AIDE À LA SAISIE, PAS UNE RÈGLE D'AUTORISATION, et
# aucun contrôle de ce fichier ne le présente autrement. La base accepte le rattachement croisé —
# le §3.1 le nomme comme le cas que la double condition existe pour traiter, et le seed le pose.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-card-costs.sh
#   scripts/verify-card-costs.sh --rapide   n'exécute ni Playwright ni les dégradations

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION=supabase/migrations/0051_card_costs.sql
TEST_SQL=supabase/tests/0049_card_costs.test.sql
MODULE=webapp/src/lib/card-costs.ts
TEST_MODULE=webapp/src/lib/card-costs.test.ts
ECRAN=webapp/src/app/BlocCoutsCard.tsx
HOTE=webapp/src/app/RouteCard.tsx
SPEC_API=e2e/api/card-costs.spec.ts
SPEC_UI=e2e/ui/card-costs.spec.ts
CAPTURES=docs/captures/CRM-085
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,46p' "$0"; exit 0 ;;
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
RAPPORTS=e2e/output/verify-card-costs
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

printf '\033[1mPreuves de CRM-085 — lignes de coût des affaires\033[0m\n'

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$MODULE" "$TEST_MODULE" "$ECRAN" "$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION" "$MODULE" "$ECRAN"; do
	if head -3 "$fichier" | grep -q 'CRM-085'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog en tête de fichier"
	fi
done

for fichier in "$TEST_SQL" "$TEST_MODULE" "$SPEC_API" "$SPEC_UI"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-085'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# La fiche d'affaire ACCUEILLE la section : sans cette trace, rien ne mènerait de la surface hôte à
# l'unité qui y a ajouté un bloc.
if head -10 "$HOTE" | grep -q 'CRM-085'; then
	ok "$(basename "$HOTE") cite CRM-085 — la fiche trace la section qu'elle accueille"
else
	fail "$(basename "$HOTE") ne cite pas CRM-085 : la section des coûts n'est plus tracée depuis son hôte"
fi

if grep -q '<BlocCoutsCard' "$HOTE"; then
	ok "la section est réellement MONTÉE dans la fiche d'affaire (§4.6)"
else
	fail "aucun <BlocCoutsCard> dans $HOTE : la section n'est plus rendue par la fiche"
fi

# --- 2. Captures observées ----------------------------------------------------------------------
# La DoD exige « captures ». Le harnais ne peut pas OBSERVER une capture — c'est l'humain qui le
# fait (`CLAUDE.md` §16) —, mais il peut refuser qu'une DoD prétende à des captures absentes.

titre "2. Captures des quatre paliers et des surfaces d'écriture"

for palier in xl-1440 lg-1152 md-900 sm-390; do
	if [ -f "$CAPTURES/couts-$palier.jpg" ]; then
		ok "capture du palier $palier livrée"
	else
		fail "capture du palier $palier ABSENTE : la DoD exige les quatre paliers"
	fi
done

# Les deux surfaces d'écriture du §4.6 : le formulaire AVEC son second sélecteur — c'est la règle
# que la DoD nomme explicitement — et la confirmation de suppression.
for etat in couts-formulaire-occurrence couts-confirmation-suppression; do
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
# s'interdit d'écrire.

titre "3. Les règles que le code porte, et qu'aucune suite ne rendrait rouge"

hexa=$(grep -nE '#[0-9a-fA-F]{3,8}\b' "$ECRAN" "$MODULE" || true)
if [ -z "$hexa" ]; then
	ok "aucune couleur hexadécimale dans la section ni dans son module — les couleurs sont des jetons (§1)"
else
	fail "couleur hexadécimale trouvée : $(printf '%s' "$hexa" | head -3 | tr '\n' ' ')"
fi

tempo=$(grep -nE '\b(setTimeout|setInterval)\b' "$ECRAN" "$MODULE" || true)
if [ -z "$tempo" ]; then
	ok "aucune temporisation dans la section ni dans son module (CLAUDE.md §18)"
else
	fail "temporisation trouvée : $(printf '%s' "$tempo" | head -3 | tr '\n' ' ')"
fi

# `docs/SPEC-costs.md` §2.3 : « `actual_cost` nul n'est PAS zéro ». La forme sous laquelle
# l'inverse s'introduirait est une coercition — `?? 0`, `Number(x) || 0`, `coalesce` — sur le réel.
# C'est la principale façon dont cet écran mentirait, et aucune capture ne l'attraperait : un zéro
# affiché ressemble exactement à un zéro mesuré.
coercition=$(grep -nE 'actual_cost[^,;)]*\?\?[[:space:]]*0|reel[^,;)]*\?\?[[:space:]]*0' "$MODULE" "$ECRAN" || true)
if [ -z "$coercition" ]; then
	ok "aucune coercition du réel vers zéro — nul n'est pas zéro (§2.3)"
else
	fail "le réel est coercé vers zéro : $(printf '%s' "$coercition" | head -3 | tr '\n' ' ')"
fi

# `docs/SPEC-costs.md` §2.3 : la devise d'une ligne est celle de son BUDGET. Une lecture qui
# demanderait la devise de la card permettrait à un total d'additionner deux monnaies.
if grep -q 'budgets(id, name, currency' "$MODULE"; then
	ok "la devise est lue depuis le BUDGET embarqué, jamais depuis la card (§2.3)"
else
	fail "la devise du budget n'est plus demandée : un total pourrait mélanger deux monnaies"
fi

# `docs/SPEC-costs.md` §4.4 : la mention « n lignes sans coût réel saisi » est OBLIGATOIRE quand
# des réels manquent. Son absence laisserait un réel bas se lire comme une économie.
if grep -q 'couts-sans-reel' "$ECRAN" && grep -q "card.costs.pending" "$ECRAN"; then
	ok "la section porte la mention du réel inconnu (§4.4)"
else
	fail "la mention « n lignes sans coût réel saisi » a disparu de la section (§4.4)"
fi

# INC-065 : rien ne confronte l'adresse à la card qu'elle désigne. Le track du sélecteur doit donc
# venir de la CARD, jamais du `slugTrack` de l'URL — sans quoi une adresse forgée proposerait les
# budgets d'un track quelconque, et la base accepterait la ligne (§3.1).
if grep -q 'lireTrackDeLaCard' "$ECRAN" && ! grep -q 'slugTrack' "$ECRAN"; then
	ok "le track du sélecteur est lu de la CARD, jamais de l'adresse (INC-065)"
else
	fail "la section lit un slug d'adresse : le sélecteur proposerait les budgets d'un autre track"
fi

# Les fragments de message sur lesquels `classerRefusCout` sépare les refus du trigger des `CHECK`
# de forme sont la SEULE inspection de texte du module. Une dérive entre les deux fichiers rangerait
# silencieusement le refus du trigger sous « vérifiez la nature de la dépense ».
fragments=$(sed -n "/FRAGMENTS_REFUS_COUT/,/^]/p" "$MODULE" | grep -oP "^\t\['\K[^']+" || true)
if [ -z "$fragments" ]; then
	fail "aucun fragment lisible dans FRAGMENTS_REFUS_COUT : le classement des refus n'est plus vérifiable"
else
	absents=''
	compte=0
	while IFS= read -r fragment; do
		[ -n "$fragment" ] || continue
		compte=$((compte + 1))
		grep -qF "$fragment" "$MIGRATION" || absents="$absents « $fragment »"
	done <<< "$fragments"
	if [ -z "$absents" ]; then
		ok "les $compte fragments de refus du module se trouvent encore dans $(basename "$MIGRATION")"
	else
		fail "fragment(s) de refus introuvable(s) dans la migration :$absents"
	fi
fi

# --- 4. Le modèle est réellement en base --------------------------------------------------------

titre "4. Le modèle en base, et le seed que les preuves attendent"

if docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
	presente=$(psql_db -c "select count(*) from information_schema.tables
		where table_schema='public' and table_name='card_costs'")
	if [ "$presente" = '1' ]; then
		ok "public.card_costs est en base"
	else
		fail "public.card_costs est ABSENTE : appliquez les migrations"
	fi

	# AUCUNE COLONNE `currency` (§2.3) : la porter permettrait d'additionner deux devises dans un
	# même total. C'est une règle de MODÈLE, qu'aucune preuve d'interface ne verrait.
	devise=$(psql_db -c "select count(*) from information_schema.columns
		where table_schema='public' and table_name='card_costs' and column_name='currency'")
	if [ "$devise" = '0' ]; then
		ok "card_costs ne porte AUCUNE colonne de devise (§2.3)"
	else
		fail "card_costs porte une colonne currency : un total pourrait mélanger deux monnaies"
	fi

	# `actual_cost` DOIT rester nullable et SANS défaut : un défaut à zéro détruirait la seule
	# distinction que cette spécification défend.
	nullable=$(psql_db -c "select is_nullable || '/' || coalesce(column_default,'sans-defaut')
		from information_schema.columns
		where table_schema='public' and table_name='card_costs' and column_name='actual_cost'")
	if [ "$nullable" = 'YES/sans-defaut' ]; then
		ok "actual_cost est NULLABLE et sans défaut — nul n'est pas zéro (§2.3)"
	else
		fail "actual_cost est « $nullable », « YES/sans-defaut » attendu"
	fi

	# L'INDEX PARTIEL des lignes sans réel : c'est lui qui servira l'onglet « À saisir » du §4.8,
	# et un index total ne dirait rien de la règle.
	partiel=$(psql_db -c "select count(*) from pg_indexes
		where schemaname='public' and tablename='card_costs'
		  and indexdef ilike '%where (actual_cost is null)%'")
	if [ "$partiel" = '1' ]; then
		ok "l'index des lignes sans réel est PARTIEL (§4.8)"
	else
		fail "aucun index partiel « where actual_cost is null » : l'onglet à saisir n'aurait pas d'appui"
	fi

	politiques=$(psql_db -c "select count(*) from pg_policies
		where schemaname='public' and tablename='card_costs'")
	if [ "$politiques" = '4' ]; then
		ok "les QUATRE politiques de card_costs sont posées (docs/SCHEMA.md §9 bis.7)"
	else
		fail "« $politiques » politique(s) sur card_costs, quatre attendues"
	fi

	# LA DOUBLE CONDITION DE LECTURE EST DANS LA POLITIQUE ELLE-MÊME (§3.1). Retirer
	# `app.can_read_budget` rendrait la ligne au vu du seul droit sur la card, et divulguerait le
	# nom et le montant d'un budget interdit.
	double=$(psql_db -c "select count(*) from pg_policies
		where schemaname='public' and tablename='card_costs' and cmd='SELECT'
		  and qual ilike '%can_read_card%' and qual ilike '%can_read_budget%'")
	if [ "$double" = '1' ]; then
		ok "la politique de lecture exige la card ET le budget — la double condition du §3.1"
	else
		fail "la politique de lecture de card_costs n'exige plus les DEUX droits (§3.1)"
	fi

	# Les DEUX triggers : celui de la table, et celui posé sur `budgets` qui tient l'invariant de
	# récurrence depuis l'autre côté.
	trig_couts=$(psql_db -c "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid
		where c.relname='card_costs' and not t.tgisinternal")
	if [ "$trig_couts" -ge 1 ]; then
		ok "card_costs porte son trigger de cohérence du rattachement (§2.3)"
	else
		fail "aucun trigger sur card_costs : l'invariant d'occurrence ne serait plus tenu"
	fi

	trig_budgets=$(psql_db -c "select count(*) from pg_trigger t
		join pg_class c on c.oid = t.tgrelid
		join pg_proc p on p.oid = t.tgfoid
		where c.relname = 'budgets' and not t.tgisinternal
		  and pg_get_functiondef(p.oid) ilike '%card_costs%'")
	if [ "$trig_budgets" -ge 1 ]; then
		ok "budgets porte le trigger qui refuse de devenir récurrent en portant des lignes"
	else
		fail "aucun trigger de budgets ne regarde card_costs : la brèche de la décision 471 se rouvre"
	fi

	# Le seed doit porter les quatre lignes exigées par la DoD, dont DEUX sans réel : sans elles,
	# la mention du §4.4 ne serait pas démontrable et la preuve d'interface resterait verte sur
	# une table qui ne dit rien.
	lignes=$(psql_db -c "select count(*) from public.card_costs")
	sans_reel=$(psql_db -c "select count(*) from public.card_costs where actual_cost is null")
	if [ "$lignes" = '4' ] && [ "$sans_reel" = '2' ]; then
		ok "le seed porte QUATRE lignes dont DEUX sans réel — la mention du §4.4 est démontrable"
	else
		fail "le seed porte « $lignes » ligne(s) dont « $sans_reel » sans réel, 4 et 2 attendues — appliquez supabase/seed/apply-seed.sh"
	fi

	# LE CAS DU RESPONSABLE, MOT POUR MOT (§1) : une affaire à DEUX lignes de nature différente,
	# l'une sans réel. C'est ce jeu précis que la section rend, et sans lui la preuve d'interface
	# mesurerait une liste à une seule ligne.
	lyon=$(psql_db -c "select count(*) from public.card_costs cc
		join public.cards c on c.id = cc.card_id
		where c.title = 'Refonte intranet Ville de Lyon'")
	if [ "$lyon" = '2' ]; then
		ok "« Refonte intranet Ville de Lyon » porte DEUX lignes — le cas qui a motivé le modèle (§1)"
	else
		fail "« Refonte intranet Ville de Lyon » porte « $lyon » ligne(s), deux attendues"
	fi

	# LE CAS CROISÉ QUI MOTIVE LA DOUBLE CONDITION (§3.1) : une card lisible par la lectrice,
	# rattachée à un budget d'un track qu'elle ne lit PAS. Sans lui, la double condition serait
	# indistinguable d'une condition simple sur la card.
	croise=$(psql_db -c "select count(*) from public.card_costs cc
		join public.cards c on c.id = cc.card_id
		join public.channels ch on ch.id = c.channel_id
		join public.budgets b on b.id = cc.budget_id
		where b.track_id <> ch.track_id")
	if [ "$croise" -ge 1 ]; then
		ok "le seed pose le cas CROISÉ card/budget — la double condition est démontrable (§3.1)"
	else
		fail "aucune ligne dont la card et le budget vivent sur deux tracks : la double condition ne se prouve plus"
	fi
else
	fail "le conteneur $DB_CONTAINER ne répond pas : la pile doit tourner (./runDev.sh)"
fi

# --- 5. Vitest — le module client ---------------------------------------------------------------

titre "5. Vitest — le module client de la section"

if npm run test:unit -- --run 'lib/card-costs.test' >"$TRAVAIL/vitest.log" 2>&1; then
	ok "vitest $TEST_MODULE : $(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/vitest.log" | tail -1)"
else
	fail_journal "vitest $TEST_MODULE ÉCHOUE" "$TRAVAIL/vitest.log"
fi

# --- 6, 7, 8. Les preuves longues ---------------------------------------------------------------

if [ "$RAPIDE" = true ]; then
	titre "6. Preuves longues"
	ok "--rapide : ni pgTAP, ni Playwright, ni les dégradations ne sont exécutés (annoncé, non masqué)"
else
	titre "6. pgTAP — le modèle, les actions référentielles et les codes SQL"

	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
		ok "pgTAP ($TEST_SQL) : $(grep -oE '[0-9]+ (assertions?|tests?)' "$TRAVAIL/pgtap.log" | tail -1)"
	else
		fail_journal "la suite pgTAP des lignes de coût ÉCHOUE" "$TRAVAIL/pgtap.log"
	fi

	titre "7. API — les TROIS formes du refus, mesurées HORS interface"

	if npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		ok "e2e api ($SPEC_API) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1)"
	else
		fail_journal "les refus d'API ÉCHOUENT" "$TRAVAIL/api.log"
	fi

	titre "8. UI — la section sur la pile seedée, au clavier et à la souris"

	if npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		ok "e2e ui ($SPEC_UI) : $(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1) au clavier et à la souris"
	else
		fail_journal "le parcours de la section des coûts ÉCHOUE" "$TRAVAIL/ui.log"
	fi

	# LES PREUVES D'ÉCRITURE REMETTENT LE SEED EN ÉTAT, et c'est constaté plutôt que supposé : une
	# ligne de fixture survivante ferait dériver les comptes des scénarios de lecture à l'exécution
	# suivante, et les captures avec eux. C'est exactement le défaut mesuré à la décision 473.
	if docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
		residus=$(psql_db -c "select count(*) from public.card_costs where label like 'E2E Cout%'")
		if [ "$residus" = '0' ]; then
			ok "les preuves ont RENDU le seed intact — aucune ligne de fixture ne subsiste"
		else
			fail "« $residus » ligne(s) « E2E Cout… » subsistent : l'épilogue des preuves n'a pas purgé"
		fi

		# Le réel de « Production » est REMIS À SA VALEUR par le scénario qui le modifie : c'est le
		# seul scénario qui écrit sur une ligne du seed, et son retour est vérifié ici plutôt que
		# supposé.
		production=$(psql_db -c "select actual_cost from public.card_costs where label = 'Production'")
		if [ "$production" = '375.00' ]; then
			ok "le réel de « Production » est rendu à 375.00 — le seed est intact"
		else
			fail "« Production » porte un réel de « $production », 375.00 attendu"
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

	# 1. Le réel inconnu compté comme zéro : c'est la coercition que la migration refuse en tête de
	#    fichier, et elle transformerait un retard de saisie en économie (§2.3, §4.4).
	degradation "un réel inconnu compte comme zéro (§2.3)" \
		"$MODULE" "sansReel: courant.sansReel + (reel === null ? 1 : 0)," \
		"sansReel: courant.sansReel," \
		'lib\/card-costs.test'

	# 2. Les devises fondues en un total unique : le §4.5 pose qu'elles ne se mélangent pas, et le
	#    §2.3 explique pourquoi — aucun écran ne saurait rendre honnêtement une somme d'euros et de
	#    francs.
	degradation "les devises sont fondues en un total unique (§4.5)" \
		"$MODULE" "const devise = ligne.budgets?.currency ?? DEVISE_INCONNUE" \
		"const devise = DEVISE_INCONNUE" \
		'lib\/card-costs.test'

	# 3. Un budget récurrent SANS occurrence ouverte redevient proposable : le sélecteur offrirait
	#    alors un choix dont la seule issue est un refus du trigger (§4.7).
	degradation "un budget récurrent sans occurrence ouverte redevient proposable (§4.7)" \
		"$MODULE" "if (budget.is_recurrent && occurrences.length === 0) continue" \
		"if (false) continue" \
		'lib\/card-costs.test'

	# La restauration est CONSTATÉE, pas supposée : un `perl -pi` interrompu laisserait le module
	# affaibli, ce qui serait pire que l'absence de harnais.
	if npm run test:unit -- --run 'lib/card-costs.test' >"$TRAVAIL/restauration.log" 2>&1; then
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
