#!/usr/bin/env bash
# @verifies CRM-014 (docs/BACKLOG.md) — Definition of Done du harnais des douze preuves de refus
# @verifies CRM-018 (docs/BACKLOG.md) — la preuve n° 11 couvre les quinze tables métier peuplées
# @verifies docs/SPEC-permissions-rls.md §7 (les douze preuves), §7.2 (contrat mesuré),
#           §7.3 (absences figées), §7.4 (non-complaisance : la politique retirée)
# @verifies docs/SPEC-test-harness.md §4.6 (fichier consolidé du projet `api`), §7 (preuves)
# @verifies docs/INCONSISTENCY_REPORT.md INC-055 (un harnais ne rejoue pas un préfixe de
#           migrations), INC-057 (le `@verifies` de `cards.spec.ts`) ; CRM-022 ferme INC-014
# @verifies docs/JOURNAL.md décisions 146 à 150
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-014` :
#
#   1. la suite pgTAP `supabase/tests/0016_preuves_refus.test.sql` est verte — 55 assertions ;
#   2. le fichier consolidé `e2e/api/preuves-refus.spec.ts` est vert — 40 scénarios, avec les
#      jetons réels des trois profils seedés ;
#   3. l'inventaire des politiques est relevé **avant** toute dégradation, table par table et nom
#      par nom, pour que la restauration soit constatée et non supposée ;
#   4. le harnais est **NON COMPLAISANT**, éprouvé en dégradant réellement le produit :
#      - `cards_lecture` **retirée** doit faire échouer la suite pgTAP nominale ; les scénarios de
#        refus restent nécessairement verts quand le produit sur-refuse, et le harnais le constate
#        explicitement au lieu d'inventer une détection impossible ;
#      - une politique **permissive** posée sur `cards` pour `anon` doit faire échouer la preuve
#        n° 11 — c'est la preuve que le fichier détecte une régression d'autorisation, et non
#        qu'il constate une base vide ;
#   5. la restauration est **constatée** : inventaire relu et comparé à celui du point 3 ;
#   6. les suites complètes et le build restent verts — aucune régression sur les unités
#      précédentes.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais NE rejoue PAS, et pourquoi (décision 150).
# ---------------------------------------------------------------------------------------------
# Aucune migration. Quatre harnais ont laissé la base dégradée en rejouant une migration sans
# celles qui la suivent (décisions 143 et 145, INC-055). Ici les dégradations sont des
# `drop policy` et des `create policy` ciblés, et la restauration recrée **exactement** la
# politique relevée, dont la définition est lue en base avant d'être retirée — jamais réécrite de
# mémoire. Un harnais qui n'a pas besoin de rejouer un préfixe de l'historique ne peut pas laisser
# derrière lui l'état intermédiaire qu'INC-055 décrit.
#
# Il ne prouve rien d'un écran : les refus de ce contrat sont portés par PostgREST et les RPC ;
# les gestes utilisateur authentifiés sont prouvés dans leurs suites UI propres.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-preuves-refus.sh
#   scripts/verify-preuves-refus.sh --rapide   n'exécute ni les suites complètes ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0016_preuves_refus.test.sql
SPEC_FILE=e2e/api/preuves-refus.spec.ts
# La preuve n° 9 ne vit plus dans le fichier consolidé : `CRM-054` ayant livré `mail_attachments`
# et son bucket, l'assertion qui figeait l'absence a été RETOURNÉE en un refus mesuré. Le harnais
# l'y vérifie plutôt que de la déclarer manquante — une preuve déplacée n'est pas une preuve
# perdue, mais elle doit rester EXERCÉE.
#
# CIBLE CORRIGÉE le 2026-08-18 (INC-147). Le harnais visait `e2e/api/ingestion.spec.ts`, dont le
# scénario ne DÉPOSE aucun objet avant de le demander et accepte `404` : il mesurait une absence,
# pas un refus, et ne pouvait pas échouer. La preuve SAINE est celle de `CRM-057` — elle dépose les
# objets avec la clé de service, vérifie que la pièce `clean` se télécharge en `200` avec le bon
# contenu (le témoin positif), puis mesure le refus des pièces `infected`, `pending` et `skipped`
# pour l'administratrice, un `viewer` et l'anonyme.
SPEC_PREUVE_9=e2e/api/inbox.spec.ts
DB_CONTAINER=p2enjoy-db

ASSERTIONS_ATTENDUES=55
SCENARIOS_ATTENDUS=40

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,44p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 »." >&2; exit 1 ;;
	esac
	shift
done

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example." >&2
	exit 1
fi

failures=0
checks=0

ok()    { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail()  { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

if ! docker exec "$DB_CONTAINER" true >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER injoignable. Lancez ./runDev.sh." >&2
	exit 1
fi

# ---------------------------------------------------------------------------------------------
# Inventaire de référence et restauration
# ---------------------------------------------------------------------------------------------
# L'inventaire est une signature textuelle de TOUTES les politiques de `public` : nom, table,
# commande, caractère permissif, rôles, `USING` et `WITH CHECK`. Comparer deux signatures est plus
# probant que compter deux nombres — une politique remplacée par une autre du même nom passerait
# un compte, pas une signature.

INVENTAIRE_SQL="
select tablename || '|' || policyname || '|' || cmd || '|' || permissive || '|' ||
       roles::text || '|' || coalesce(qual, '-') || '|' || coalesce(with_check, '-')
from pg_policies where schemaname = 'public'
order by tablename, policyname;"

inventaire() { psql_db -c "$INVENTAIRE_SQL"; }

REFERENCE=$(inventaire)
DEFINITION_CARDS_LECTURE=$(psql_db -c "
	select 'create policy cards_lecture on public.cards for select to ' ||
	       (select string_agg(quote_ident(rolname), ', ') from pg_roles where oid = any(polroles)) ||
	       ' using (' || pg_get_expr(polqual, polrelid) || ');'
	from pg_policy where polrelid = 'public.cards'::regclass and polname = 'cards_lecture';")

if [ -z "$DEFINITION_CARDS_LECTURE" ]; then
	echo "ERREUR : la politique cards_lecture est absente AVANT toute dégradation." >&2
	echo "La base n'est pas dans l'état attendu : rejouez ./runDev.sh." >&2
	exit 1
fi

DEGRADEE=""
restaurer() {
	case "$DEGRADEE" in
		retrait)
			psql_db -v ON_ERROR_STOP=1 -c "$DEFINITION_CARDS_LECTURE" >/dev/null ;;
		permissive)
			psql_db -v ON_ERROR_STOP=1 -c \
				"drop policy if exists tst_crm014_permissive on public.cards;" >/dev/null ;;
	esac
	DEGRADEE=""
}
# Toute sortie — succès, échec ou interruption — repasse par la restauration. Un harnais qui
# laisse le produit dégradé est pire qu'un harnais absent (INC-055).
trap 'restaurer' EXIT INT TERM

executer_pgtap() {
	psql_db -v ON_ERROR_STOP=1 -f - < "$TEST_FILE" 2>&1 || true
}

pgtap_vert() {
	local sortie=$1
	! printf '%s\n' "$sortie" | grep -qE '^ *not ok|^psql:.*ERROR|# Looks like'
}

executer_scenarios() {
	# `E2E_PROJETS=api` est un contrat interne avec `e2e/playwright.config.ts` : le filtre
	# `--project` n'est pas visible des workers (décision 49).
	E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_FILE" 2>&1 || true
}

# =============================================================================================
titre "1. Suite pgTAP dédiée — $TEST_FILE"
# =============================================================================================

sortie_tap=$(executer_pgtap)
if pgtap_vert "$sortie_tap"; then
	ok "la suite pgTAP de CRM-014 est verte"
else
	fail "la suite pgTAP de CRM-014 échoue"
	printf '%s\n' "$sortie_tap" | grep -E '^ *not ok|^psql:.*ERROR|# Looks like' | head -10
fi

plan=$(printf '%s\n' "$sortie_tap" | grep -oE '1\.\.[0-9]+' | head -1 | cut -d. -f3)
if [ "${plan:-0}" = "$ASSERTIONS_ATTENDUES" ]; then
	ok "le plan annonce $ASSERTIONS_ATTENDUES assertions"
else
	fail "plan attendu $ASSERTIONS_ATTENDUES, obtenu « ${plan:-aucun} »"
fi

# =============================================================================================
titre "2. Fichier consolidé des douze preuves — $SPEC_FILE"
# =============================================================================================

sortie_e2e=$(executer_scenarios)
if printf '%s\n' "$sortie_e2e" | grep -qE "^ *${SCENARIOS_ATTENDUS} passed"; then
	ok "les $SCENARIOS_ATTENDUS scénarios du fichier consolidé sont verts"
else
	fail "les scénarios du fichier consolidé ne sont pas tous verts"
	printf '%s\n' "$sortie_e2e" | tail -8
fi

# Les douze preuves doivent être NOMMÉES parmi les scénarios RÉELLEMENT EXÉCUTÉS. Le contrôle
# porte sur la sortie de Playwright, non sur le texte du fichier : cinq titres sont construits par
# une boucle, et une recherche dans les sources ne les y trouverait pas — mesuré à l'écriture. Un
# renumérotage silencieux, ou une preuve qui cesserait d'être exercée, sont ainsi dénoncés.
manquantes=""
for n in 1 2 3 4 5 6 7 8 10 11 12; do
	printf '%s\n' "$sortie_e2e" | grep -qE "PREUVE N° $n( |\b)" || manquantes="$manquantes $n"
done
if [ -z "$manquantes" ]; then
	ok "les onze preuves du §7 encore consolidées sont nommées une à une dans le fichier"
else
	fail "preuves absentes du fichier :$manquantes"
fi

# La douzième — la n° 9 — est exercée dans le fichier d'ingestion sous le titre `REFUS N° 9`. Le
# contrôle EXÉCUTE ce fichier au lieu d'y lire le titre : une preuve peut être écrite et ne jamais
# tourner, et c'est précisément ce que ce harnais existe pour dénoncer.
# PORTÉE RESSERRÉE le 2026-08-18, ET C'EST UNE CORRECTION DE MA PROPRE CORRECTION. Ce contrôle
# exécutait le fichier ENTIER — neuf scénarios — et échouait si l'un d'eux tombait. Un échec sans
# rapport avec les pièces jointes aurait donc été rendu « la preuve n° 9 n'est pas exercée » :
# l'accusation fausse que ce harnais reproche ailleurs (INC-145, contrôle des ports). Le filtre
# `-g` restreint l'exécution au SEUL scénario qui porte la preuve, si bien que le verdict ne peut
# plus parler que de lui.
sortie_preuve_9=$(E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts \
	--project=api "$SPEC_PREUVE_9" -g 'se télécharge' 2>&1 || true)
if printf '%s\n' "$sortie_preuve_9" | grep -qE "clean.*se télécharge" &&
	! printf '%s\n' "$sortie_preuve_9" | grep -qE "^ *[1-9][0-9]* failed"; then
	# LE LIBELLÉ CITAIT UNE VARIABLE DISPARUE, ET LE HARNAIS MOURAIT SUR SON PROPRE SUCCÈS.
	# La correction d'INC-147 a renommé la cible en `SPEC_PREUVE_9` sans reprendre ce message,
	# resté sur l'ancien `SPEC_INGESTION` : sous `set -u`, la branche VERTE s'interrompait sur
	# « unbound variable » tandis que la branche rouge, qui cite la bonne variable, fonctionnait.
	# Le défaut n'était visible qu'en exécutant, et le poste Docker était tombé le jour même.
	# Le libellé décrit désormais ce que le contrôle mesure RÉELLEMENT depuis INC-147 : la preuve
	# saine de `CRM-057`, celle qui dépose les objets et porte son témoin positif.
	ok "la preuve n° 9 est exercée dans $SPEC_PREUVE_9, témoin positif compris (INC-147)"
else
	fail "la preuve n° 9 n'est pas exercée dans $SPEC_PREUVE_9"
	printf '%s\n' "$sortie_preuve_9" | tail -6
fi

# =============================================================================================
titre "3. Inventaire de référence des politiques"
# =============================================================================================

# `pg_get_expr` peut rendre une expression sur plusieurs lignes : compter les lignes de la
# signature textuelle surestimait alors le nombre de politiques (54 lignes pour 48 objets après
# CRM-018). Le nombre vient du catalogue ; `REFERENCE` reste la signature exacte de restauration.
nb_politiques=$(psql_db -c "select count(*) from pg_policies where schemaname='public';")
if [ "$nb_politiques" = "66" ]; then
	ok "66 politiques relevées dans le schéma public, boîte de réception et envoi compris"
else
	fail "66 politiques attendues, $nb_politiques relevées"
fi

if printf '%s\n' "$REFERENCE" | grep -q '^cards|cards_lecture|SELECT|'; then
	ok "la politique cards_lecture est présente et sa définition a été capturée"
else
	fail "cards_lecture introuvable dans l'inventaire"
fi

# `cards` est la table choisie pour la dégradation : trois des sept preuves acquises en dépendent
# (décision 149). Le contrôle le constate plutôt que de le supposer.
dependantes=0
for n in 3 4 11; do
	printf '%s\n' "$sortie_e2e" | grep -qE "PREUVE N° $n( |\b)" && dependantes=$((dependantes + 1))
done
if [ "$dependantes" = "3" ]; then
	ok "trois preuves — n° 3, n° 4, n° 11 — reposent sur la table cards, dégradée ci-dessous"
else
	fail "les trois preuves attendues sur cards ne sont pas toutes présentes"
fi

# =============================================================================================
titre "4. NON-COMPLAISANCE — la politique de lecture des cards est réellement retirée"
# =============================================================================================

DEGRADEE=retrait
psql_db -v ON_ERROR_STOP=1 -c "drop policy cards_lecture on public.cards;" >/dev/null

absente=$(psql_db -c "select count(*) from pg_policies
	where schemaname='public' and tablename='cards' and policyname='cards_lecture';")
if [ "$absente" = "0" ]; then
	ok "la dégradation est RÉELLE : cards_lecture n'existe plus en base"
else
	fail "la dégradation n'a pas eu lieu — le reste de cette section ne prouverait rien"
fi

sortie_tap_degrade=$(executer_pgtap)
if pgtap_vert "$sortie_tap_degrade"; then
	fail "la suite pgTAP reste VERTE alors qu'une politique a été retirée — elle est complaisante"
else
	ok "la suite pgTAP échoue quand une politique est retirée"
fi

# CE QUI SUIT EST UN FAIT MESURÉ, ET IL CONTREDIT CE QU'ON ATTENDRAIT (décision 151).
#
# Le fichier de scénarios reste ENTIÈREMENT VERT sans `cards_lecture`. Ce n'est pas un défaut du
# fichier : c'est une propriété structurelle de toute suite composée de preuves de refus. Retirer
# une politique de lecture fait refuser DAVANTAGE ; or chaque assertion attend soit zéro ligne,
# soit une erreur. Un produit devenu plus strict les satisfait toutes.
#
# La preuve n° 1 elle-même reste verte, et pour une raison mesurée : `move_card` est
# `SECURITY DEFINER` et n'interroge pas la politique — elle appelle `app.can_write_channel`.
#
# L'assertion fige donc l'état RÉEL au lieu d'annoncer un échec qui n'arrive pas. C'est la
# suite pgTAP qui porte la détection du sur-refus, par son inventaire — et c'est à cela qu'elle
# sert. Le harnais, lui, échoue bien : le contrôle précédent vient de le rendre rouge.
sortie_e2e_degrade=$(executer_scenarios)
if printf '%s\n' "$sortie_e2e_degrade" | grep -qE "^ *${SCENARIOS_ATTENDUS} passed"; then
	ok "MESURÉ : le fichier de scénarios reste vert — une suite de refus est aveugle au SUR-refus, et c'est l'inventaire pgTAP qui le détecte (décision 151)"
else
	fail "le fichier de scénarios ne se comporte plus comme mesuré : réviser la décision 151"
fi

restaurer

presente=$(psql_db -c "select count(*) from pg_policies
	where schemaname='public' and tablename='cards' and policyname='cards_lecture';")
if [ "$presente" = "1" ]; then
	ok "cards_lecture est restaurée"
else
	fail "cards_lecture n'a PAS été restaurée"
fi

# =============================================================================================
titre "5. NON-COMPLAISANCE — une politique permissive est réellement posée"
# =============================================================================================
# Le sens inverse du précédent. Une politique retirée fait refuser trop ; une politique permissive
# fait accepter trop. Un harnais qui ne détecterait que le premier cas laisserait passer
# exactement la régression qui compte : une donnée métier rendue à un appelant anonyme.

DEGRADEE=permissive
psql_db -v ON_ERROR_STOP=1 -c \
	"create policy tst_crm014_permissive on public.cards for select to anon using (true);" >/dev/null

fuite=$(psql_db -c "select count(*) from pg_policies
	where schemaname='public' and tablename='cards' and policyname='tst_crm014_permissive';")
if [ "$fuite" = "1" ]; then
	ok "la dégradation est RÉELLE : une politique permissive existe sur cards pour anon"
else
	fail "la politique permissive n'a pas été posée"
fi

sortie_e2e_permissive=$(executer_scenarios)
if printf '%s\n' "$sortie_e2e_permissive" | grep -qE '^ *1 failed'; then
	ok "le fichier consolidé échoue quand une donnée métier fuit vers l'anonyme"
else
	fail "le fichier consolidé reste VERT alors que les cards fuient — il constate une base vide"
fi

# Ce n'est pas « un scénario quelconque » qui doit tomber, mais celui qui surveille la fuite. La
# ligne d'échec est isolée par son numéro : chercher « PREUVE N° 11 » dans toute la sortie
# matcherait aussi les scénarios VERTS portant ce nom — faux positif mesuré à l'écriture.
if printf '%s\n' "$sortie_e2e_permissive" | grep -E '^ +1\) ' | grep -q 'PREUVE N° 11'; then
	ok "l'unique scénario en échec est la preuve n° 11 sur les cards, comme attendu"
else
	fail "la fuite n'a pas été détectée par la preuve n° 11 : elle ne porte pas où elle devrait"
	printf '%s\n' "$sortie_e2e_permissive" | grep -E '^ +[0-9]+\) ' | head -5
fi

sortie_tap_permissive=$(executer_pgtap)
if pgtap_vert "$sortie_tap_permissive"; then
	fail "la suite pgTAP reste VERTE avec une politique de plus — le compte de 55 ne sert à rien"
else
	ok "la suite pgTAP échoue quand une politique est AJOUTÉE, pas seulement retirée"
fi

restaurer

# =============================================================================================
titre "6. Restauration CONSTATÉE, non supposée"
# =============================================================================================

APRES=$(inventaire)
if [ "$APRES" = "$REFERENCE" ]; then
	ok "l'inventaire des politiques est identique à celui relevé avant dégradation"
else
	fail "l'inventaire des politiques a DÉRIVÉ — le produit n'est pas revenu à son état"
	diff <(printf '%s\n' "$REFERENCE") <(printf '%s\n' "$APRES") | head -10 || true
fi

sortie_tap_final=$(executer_pgtap)
if pgtap_vert "$sortie_tap_final"; then
	ok "la suite pgTAP est de nouveau verte après restauration"
else
	fail "la suite pgTAP reste rouge après restauration"
fi

sortie_e2e_final=$(executer_scenarios)
if printf '%s\n' "$sortie_e2e_final" | grep -qE "^ *${SCENARIOS_ATTENDUS} passed"; then
	ok "les $SCENARIOS_ATTENDUS scénarios sont de nouveau verts après restauration"
else
	fail "les scénarios ne sont pas revenus au vert"
fi

# Le seed doit être intact : les scénarios de la preuve n° 3 créent un second workspace et le
# détruisent. Un ménage défaillant laisserait une donnée qui fausserait toutes les preuves
# suivantes — et le compte de la preuve n° 11 le premier.
residus=$(psql_db -c "select count(*) from public.workspaces where slug like 'tst-crm014%';")
if [ "$residus" = "0" ]; then
	ok "aucun résidu du second workspace : le ménage de la preuve n° 3 a bien eu lieu"
else
	fail "$residus workspace(s) de test subsistent — le ménage de la preuve n° 3 a échoué"
fi

cards_seed=$(psql_db -c "select count(*) from public.cards where id::text like '5eed%';")
# Compteur porté de 14 à 41 : `CRM-046` a livré le seed de démonstration complet, et les unités
# de courrier et de sommeil l'ont étendu depuis. `docs/manual.md` annexe A annonce le même nombre.
if [ "$cards_seed" = "41" ]; then
	ok "les quarante et une cards du seed sont intactes"
else
	fail "41 cards attendues dans le seed, $cards_seed trouvées"
fi

ws_seed=$(psql_db -c "select count(*) from public.workspaces
	where id='5eed0000-0000-4000-8000-000000000001';")
if [ "$ws_seed" = "1" ]; then
	ok "le workspace stable du seed est toujours présent"
else
	fail "le workspace stable du seed a disparu"
fi

# =============================================================================================
titre "7. Aucune régression — suites complètes et build"
# =============================================================================================

if [ "$RAPIDE" = true ]; then
	printf '  \033[33mIGNORE\033[0m --rapide : suites complètes et build non exécutés\n'
else
	if npm run test:sql >/tmp/p2enjoy-crm014-sql.log 2>&1; then
		total=$(grep -oE '[0-9]+ assertions' /tmp/p2enjoy-crm014-sql.log | tail -1)
		ok "npm run test:sql est vert — $total"
	else
		fail "npm run test:sql échoue (voir /tmp/p2enjoy-crm014-sql.log)"
	fi

	if npm run e2e:api >/tmp/p2enjoy-crm014-api.log 2>&1; then
		total=$(grep -oE '[0-9]+ passed' /tmp/p2enjoy-crm014-api.log | tail -1)
		ok "npm run e2e:api est vert — $total"
	else
		fail "npm run e2e:api échoue (voir /tmp/p2enjoy-crm014-api.log)"
	fi

	if npm run test:unit >/tmp/p2enjoy-crm014-unit.log 2>&1; then
		ok "npm run test:unit est vert"
	else
		fail "npm run test:unit échoue (voir /tmp/p2enjoy-crm014-unit.log)"
	fi

	if npm run typecheck >/tmp/p2enjoy-crm014-tsc.log 2>&1; then
		ok "npm run typecheck est vert — le fichier consolidé est couvert par tsconfig.tools.json"
	else
		fail "npm run typecheck échoue (voir /tmp/p2enjoy-crm014-tsc.log)"
	fi

	if npm run build >/tmp/p2enjoy-crm014-build.log 2>&1; then
		ok "npm run build est vert"
	else
		fail "npm run build échoue (voir /tmp/p2enjoy-crm014-build.log)"
	fi
fi

# =============================================================================================
printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
	exit 0
fi
printf '\033[31m%d contrôles, %d anomalie(s).\033[0m\n' "$checks" "$failures"
exit 1
