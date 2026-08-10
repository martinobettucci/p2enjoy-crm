#!/usr/bin/env bash
# @verifies CRM-043 (docs/BACKLOG.md) — Definition of Done des commentaires
# @verifies CRM-022 (docs/BACKLOG.md) — auteur embarqué et parole conservée après suppression
# @verifies docs/SPEC-cards.md §13.2 (modèle), §13.3 (unicité et dérivation), §13.4 (la pierre
#           tombale), §13.5 (`edited_at`), §13.6 (autorisations), §13.7 (colonnes protégées),
#           §13.8 (contrat d'API), §13.9 (temps réel), §13.11 (seed), §13.14 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §3.6, §3.7 (les deux fonctions d'appui), §7 (refus n° 4)
# @verifies docs/SPEC-seed.md §2.14 (commentaires du seed, convergence par présence et par état)
# @verifies docs/DESIGN_SYSTEM.md §5.10 (panneau de commentaires), §7 (paliers), §12.5 (réponses
#           substituées) ; CLAUDE.md §16 (vérification visuelle)
# @verifies docs/INCONSISTENCY_REPORT.md INC-071, INC-072, INC-048, INC-061 (jeu d'essai nettoyé),
#           INC-021 (close par CRM-009 : les deux gestes de l'auteur en dépendaient) ;
#           CRM-022 ferme INC-014
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-043`, POUR CE QUI EST LIVRÉ :
#
#   1. les fichiers livrés portent leur traçabilité `@spec` / `@verifies` ;
#   2. la suite pgTAP dédiée est verte, et la suite globale avec elle ;
#   3. la preuve d'API dédiée est verte — le refus opposé au `viewer` compris — et elle NETTOIE
#      derrière elle, ce qui est constaté et non supposé ;
#   4. le schéma réellement en base porte ce que la spécification annonce : les trois politiques,
#      les deux colonnes ouvertes en mise à jour et deux seulement, l'absence de privilège
#      `DELETE`, l'appartenance à la publication de temps réel ;
#   5. le seed porte ses cinq commentaires, dont un modifié et un supprimé au corps VIDE, et il
#      converge — le rejeu ne change rien et ne lève aucun refus ;
#   6. le panneau est livré : ses tests unitaires, sa preuve d'interface contre le BUILD DE
#      PRODUCTION, ses captures aux quatre paliers, et le build lui-même ;
#   7. le harnais est NON COMPLAISANT : chaque affaiblissement volontaire le fait réellement
#      échouer, et la restauration est constatée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve depuis que la session existe.
# ---------------------------------------------------------------------------------------------
# La phrase qui tenait ici — « il ne prouve aucune publication par un utilisateur connecté », la
# webapp étant un appelant anonyme faute d'écran de connexion — n'a plus d'objet : INC-021 est
# close par `CRM-009`. `e2e/ui/commentaires-gestes.spec.ts` ouvre une session réelle, ÉCRIT dans
# `card_comments` par l'écran et relit l'effet par l'API avec la clé de service ; les cinq
# scénarios rendent le seed intact.
#
# `e2e/ui/commentaires.spec.ts` conserve ses substitutions de réponse, et c'est délibéré : elles
# isolent des états rares — fil vide, `403`, commentaire de 10 000 caractères — que la pile réelle
# ne produit pas à la demande. Le procédé est endossé par docs/DESIGN_SYSTEM.md §12.5, et il est
# désormais ENCADRÉ par des preuves qui ne substituent rien.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-commentaires.sh
#   scripts/verify-commentaires.sh --rapide   n'exécute ni Playwright ni les suites globales

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

MIGRATION=supabase/migrations/0015_commentaires.sql
MIGRATION_IDENTITES=supabase/migrations/0021_identites_et_memberships_surs.sql
TEST_SQL=supabase/tests/0017_commentaires.test.sql
TEST_IDENTITES=supabase/tests/0023_identites_et_memberships_surs.test.sql
SPEC_API=e2e/api/commentaires.spec.ts
MODULE=webapp/src/lib/commentaires.ts
COMPOSANT=webapp/src/app/PanneauTimeline.tsx
TEST_UNITAIRE=webapp/src/lib/commentaires.test.ts
TEST_COMPOSANT=webapp/src/app/PanneauTimeline.test.tsx
SPEC_UI=e2e/ui/commentaires.spec.ts
# Les deux gestes de l'auteur ont leur propre fichier, et pour une raison : ils ÉCRIVENT dans la
# vraie base avec une session réelle, là où `commentaires.spec.ts` substitue des réponses pour
# isoler des états rares. Mélanger les deux postures dans un fichier rendrait illisible ce qui est
# mesuré et ce qui est fabriqué.
SPEC_UI_GESTES=e2e/ui/commentaires-gestes.spec.ts
CAPTURES=docs/captures/CRM-043
SEED=supabase/seed/apply-seed.sh
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,50p' "$0"; exit 0 ;;
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

# UN JOURNAL D'ÉCHEC DOIT SURVIVRE AU HARNAIS. Les messages d'échec renvoyaient vers
# `$TRAVAIL/…log`, que le `trap` efface à la seconde suivante : la piste de diagnostic n'existait
# donc que dans la phrase qui la promettait. Les journaux utiles sont recopiés sous `e2e/output/`,
# que le dépôt ignore, et c'est CE chemin qui est nommé.
RAPPORTS=e2e/output/verify-commentaires
mkdir -p "$RAPPORTS"

# Échoue en NOMMANT un journal conservé, et en montrant ses dernières lignes : un échec que l'on
# ne peut pas lire ne vaut pas mieux qu'un échec tu (CLAUDE.md §18).
fail_journal() {
	local message=$1 journal=$2
	cp "$journal" "$RAPPORTS/$(basename "$journal")" 2>/dev/null || true
	fail "$message — voir $RAPPORTS/$(basename "$journal")"
	tail -n 25 "$journal" | sed 's/^/        /'
}

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

# État des fichiers dégradables **à l'entrée du harnais**, et non l'état de `HEAD` : un contrôle
# qui comparerait au dernier commit ne pourrait pas être vert pendant qu'on travaille (décision
# 166).
DEPART=$(mktemp -d)
empreinte_depart() { cp "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')"; }
est_rendu_intact() { diff -q "$1" "$DEPART/$(printf '%s' "$1" | tr '/' '@')" >/dev/null 2>&1; }

for fichier in "$MIGRATION" "$TEST_SQL"; do
	[ -f "$fichier" ] && empreinte_depart "$fichier"
done

# --- 1. Fichiers livrés et traçabilité ----------------------------------------------------------

titre "1. Fichiers livrés et traçabilité"

for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API" "$MODULE" "$COMPOSANT" "$TEST_UNITAIRE" \
	"$TEST_COMPOSANT" "$SPEC_UI" "$SPEC_UI_GESTES"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION" "$MODULE" "$COMPOSANT"; do
	if head -3 "$fichier" | grep -q '@spec CRM-043'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_SQL" "$SPEC_API" "$TEST_UNITAIRE" "$TEST_COMPOSANT" "$SPEC_UI" \
	"$SPEC_UI_GESTES"; do
	if head -3 "$fichier" | grep -q '@verifies CRM-043'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# --- 2. Le schéma RÉELLEMENT en base ------------------------------------------------------------
# Ce que le fichier de migration dit ne prouve rien : ce qui compte est ce que la base porte après
# l'avoir rejoué. Chaque contrôle interroge le catalogue, jamais le fichier.

titre "2. Le schéma réellement en base"

if [ "$(psql_db -c "select to_regclass('public.card_comments') is not null")" = t ]; then
	ok "public.card_comments existe"
else
	fail "public.card_comments est ABSENTE"
fi

politiques=$(psql_db -c "select string_agg(policyname, ',' order by policyname) from pg_policies where schemaname='public' and tablename='card_comments'")
if [ "$politiques" = 'card_comments_insertion,card_comments_lecture,card_comments_maj' ]; then
	ok "trois politiques, et trois seulement : aucune « for delete » (§13.4)"
else
	fail "politiques inattendues sur card_comments : « $politiques »"
fi

if [ "$(psql_db -c "select relrowsecurity from pg_class where oid='public.card_comments'::regclass")" = t ]; then
	ok "la RLS est activée — sans elle, l'inventaire des politiques serait rassurant sur une table ouverte"
else
	fail "la RLS n'est PAS activée sur card_comments"
fi

colonnes_maj=$(psql_db -c "
	select string_agg(a.attname, ',' order by a.attname)
	  from pg_attribute a
	 where a.attrelid = 'public.card_comments'::regclass and a.attnum > 0 and not a.attisdropped
	   and has_column_privilege('authenticated', a.attrelid, a.attname, 'UPDATE')")
if [ "$colonnes_maj" = 'body,deleted_at' ]; then
	ok "DEUX colonnes ouvertes en mise à jour, et deux seulement : body et deleted_at (§13.7)"
else
	fail "colonnes ouvertes en mise à jour inattendues : « $colonnes_maj »"
fi

for role in anon authenticated; do
	if [ "$(psql_db -c "select has_table_privilege('$role','public.card_comments','DELETE')")" = f ]; then
		ok "$role n'a AUCUN privilège DELETE — première des deux barrières"
	else
		fail "$role détient le privilège DELETE sur card_comments"
	fi
done

if [ "$(psql_db -c "select has_table_privilege('anon','public.card_comments','SELECT')")" = t ]; then
	ok "anon a SELECT : le refus doit être ZÉRO LIGNE, non une erreur de privilège"
else
	fail "anon n'a pas SELECT : un appelant sans jeton recevrait une erreur de privilège"
fi

if [ "$(psql_db -c "select count(*) from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='card_comments'")" = 1 ]; then
	ok "card_comments est publiée sur supabase_realtime — première table du produit à l'être"
else
	fail "card_comments n'est PAS publiée : aucun abonnement ne recevra jamais rien"
fi

if [ "$(psql_db -c "select count(*) from pg_constraint where conrelid='public.cards'::regclass and conname='cards_id_workspace_id_key'")" = 1 ]; then
	ok "cards porte l'unicité (id, workspace_id) — condition de la clé composite (§13.3)"
else
	fail "l'unicité (id, workspace_id) manque à cards : la clé composite serait inexprimable"
fi

for trigger in card_comments_avant_insertion card_comments_avant_maj; do
	if [ "$(psql_db -c "select count(*) from pg_trigger where tgrelid='public.card_comments'::regclass and tgname='$trigger'")" = 1 ]; then
		ok "le trigger $trigger est posé"
	else
		fail "le trigger $trigger est ABSENT"
	fi
done

# --- 3. Le seed, et sa convergence --------------------------------------------------------------

titre "3. Le seed"

if [ "$(psql_db -c "select count(*) from public.card_comments where id::text like '5eed%'")" = 5 ]; then
	ok "cinq commentaires seedés (docs/SPEC-seed.md §2.14)"
else
	fail "le seed ne porte pas cinq commentaires — la démonstration du fil n'est plus reproductible"
fi

if [ "$(psql_db -c "select count(distinct card_id) from public.card_comments where id::text like '5eed%'")" = 3 ]; then
	ok "…sur trois cards : un fil isolé ne démontrerait pas un fil"
else
	fail "les commentaires seedés ne couvrent plus trois cards"
fi

if [ "$(psql_db -c "select count(distinct author_id) from public.card_comments where id::text like '5eed%'")" = 3 ]; then
	ok "…par les trois comptes, dont le viewer — témoin de la preuve de lecture"
else
	fail "les commentaires seedés ne couvrent plus les trois comptes"
fi

if [ "$(psql_db -c "select edited_at is not null from public.card_comments where id='5eed0000-0000-4000-8000-0000000000d3'")" = t ]; then
	ok "d3 est MODIFIÉ, et la marque a été posée par le trigger"
else
	fail "d3 n'est plus modifié : l'état « modifié » n'est plus démontré par une donnée"
fi

# `||` coerce le booléen en texte : la valeur attendue est « true: », non « t: » — MESURÉ, et
# écrit ici parce qu'un contrôle qui compare à la mauvaise chaîne échoue en accusant le produit.
etat_d4=$(psql_db -c "select (deleted_at is not null) || ':' || body from public.card_comments where id='5eed0000-0000-4000-8000-0000000000d4'")
if [ "$etat_d4" = 'true:' ]; then
	ok "d4 est SUPPRIMÉ et son corps est VIDE : la pierre tombale est une donnée, pas une prose"
else
	fail "d4 n'est plus une pierre tombale au corps vide : « $etat_d4 »"
fi

if [ "$RAPIDE" = false ]; then
	if "$SEED" >"$TRAVAIL/seed.log" 2>&1; then
		ok "le seed se rejoue sans erreur — convergence par PRÉSENCE et par ÉTAT (§2.14)"
	else
		fail_journal "le rejeu du seed ÉCHOUE" "$TRAVAIL/seed.log"
	fi
	if [ "$(psql_db -c "select count(*) from public.card_comments where id::text like '5eed%'")" = 5 ]; then
		ok "…et le rejeu n'a créé aucun doublon"
	else
		fail "le rejeu du seed a changé le nombre de commentaires"
	fi
fi

# --- 4. Les suites de preuves -------------------------------------------------------------------

titre "4. Suites de preuves"

if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/pgtap.log" 2>&1; then
	assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap.log" | head -1 | grep -oE '[0-9]+')
	if [ "${assertions:-0}" -eq 84 ]; then
		ok "supabase/tests/0017_commentaires.test.sql — 84 assertions, aucune anomalie"
	else
		fail "suite pgTAP verte mais ${assertions:-0} assertions au lieu de 84"
	fi
else
	fail_journal "supabase/tests/0017_commentaires.test.sql ÉCHOUE" "$TRAVAIL/pgtap.log"
fi

if [ "$RAPIDE" = false ]; then
	# Le compte GLOBAL d'assertions grandit à chaque unité qui ajoute une suite : l'exiger à
	# l'identique ferait rougir ce harnais pour une raison qui ne le regarde pas — mesuré, il
	# réclamait encore 1250 alors que la campagne en porte 1698. Ce qui doit rester vrai ici, c'est
	# que la campagne complète est verte et qu'elle n'a rien PERDU. Le compte propre à l'unité,
	# lui, reste exigé à l'exactitude, quelques lignes plus haut.
	PGTAP_PLANCHER=1250
	if npm run test:sql >"$TRAVAIL/pgtap-global.log" 2>&1; then
		assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap-global.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${assertions:-0}" -ge "$PGTAP_PLANCHER" ]; then
			ok "npm run test:sql — ${assertions} assertions, au moins les $PGTAP_PLANCHER de CRM-043"
		else
			fail "npm run test:sql vert mais ${assertions:-0} assertions, sous le plancher $PGTAP_PLANCHER"
		fi
	else
		fail_journal "npm run test:sql ÉCHOUE" "$TRAVAIL/pgtap-global.log"
	fi

	if PLAYWRIGHT_CHROMIUM_PATH=${PLAYWRIGHT_CHROMIUM_PATH:-} \
		npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 17 ]; then
			ok "e2e/api/commentaires.spec.ts — 17 scénarios, dont le refus opposé au viewer et le temps réel"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 17"
		fi
	else
		fail_journal "e2e/api/commentaires.spec.ts ÉCHOUE" "$TRAVAIL/api.log"
	fi

	# INC-061, prise au sérieux dans l'autre sens : la preuve d'API ÉCRIT, et doit ne rien laisser.
	if [ "$(psql_db -c "select count(*) from public.card_comments where id::text like 'f00d%'")" = 0 ]; then
		ok "la preuve d'API n'a laissé AUCUNE ligne d'essai en base — leçon d'INC-061"
	else
		fail "des lignes d'essai « f00d… » subsistent : les preuves des autres unités vont tomber"
	fi
fi

# --- 4 bis. Le panneau ---------------------------------------------------------------------------

titre "4 bis. Le panneau de commentaires"

# LE COMPOSANT NE PORTE AUCUNE RÈGLE. Ces deux contrôles figent la séparation : l'ordre du fil et
# la classification des refus vivent dans le module, vérifiables sans navigateur.
if grep -qE "sort\(|classerRefus" "$COMPOSANT"; then
	fail "le composant recompose ou reclasse : la règle doit vivre dans $MODULE"
else
	ok "le composant ne trie ni ne classe : il rend (§13.10)"
fi

# CRM-022 : le composant rend le profil embarqué, et garde une pierre tombale d'identité lorsque
# la FK a été détachée. Le UUID n'est jamais injecté dans le texte rendu.
if grep -qF '<Avatar' "$COMPOSANT" \
	&& grep -qF 'commentaire.auteur' "$COMPOSANT" \
	&& grep -qF "comments.author.deleted" "$COMPOSANT"; then
	ok "auteur nommé par profil embarqué, avec repli compte supprimé (CRM-022, §13.10)"
else
	fail "le panneau ne rend pas complètement l'identité consentie de l'auteur"
fi

# LES DEUX GESTES DE L'AUTEUR N'ENVOIENT NI `edited_at`, NI `author_id`. Les deux colonnes sont
# tenues par la base — l'une par le trigger du §13.5, l'autre par le défaut du §13.3 — et les
# envoyer rendrait `403` : le privilège d'écriture est REFUSÉ au client sur `edited_at`. Le
# contrôle vise la charge réellement construite, pas les commentaires qui l'expliquent.
if grep -nE "(^|[^a-z_'\"])(edited_at|author_id)[[:space:]]*:" "$MODULE" | grep -qv "readonly"; then
	fail "une charge d'écriture cite edited_at ou author_id — le §13.5 les réserve à la base"
else
	ok "aucune charge n'envoie edited_at ni author_id : la base seule les écrit (§13.3, §13.5)"
fi

# LE `200` À ZÉRO LIGNE DOIT RESTER DISTINGUABLE. Sans le `select()` final, PostgREST ne rend aucun
# corps, et le filtrage silencieux du `USING` deviendrait indiscernable d'une modification réussie
# (§13.8, ligne *j*).
if grep -qF "sans-effet" "$MODULE" && grep -qE "\.select\('id'\)" "$MODULE"; then
	ok "le refus silencieux du USING est nommé, et le select() qui le rend visible est là (§13.8)"
else
	fail "le 200 à zéro ligne n'est plus distingué d'un succès — §13.8, ligne j"
fi

# CLAUDE.md §11 : aucune persistance côté client n'est introduite, brouillon compris. Le contrôle
# vise un APPEL de stockage, pas les commentaires qui documentent expressément son absence.
if grep -qE "(localStorage|sessionStorage)\.(getItem|setItem|removeItem|clear)|document\.cookie[[:space:]]*=" \
	"$MODULE" "$COMPOSANT"; then
	fail "une persistance côté client est apparue — CLAUDE.md §11"
else
	ok "aucune persistance côté client : ni brouillon, ni préférence (CLAUDE.md §11)"
fi

if [ "$RAPIDE" = false ]; then
	# Même raison que le plancher pgTAP ci-dessus, et même mesure : le compte GLOBAL de tests
	# unitaires grandit à chaque unité, et l'exiger à l'identique faisait rougir ce harnais pour
	# une raison qui ne le regarde pas — il réclamait 564 quand la campagne en portait 585. Le
	# compte propre aux commentaires est exigé à l'exactitude par les deux fichiers de test
	# eux-mêmes ; ici, ce qui doit rester vrai est que rien n'a été PERDU.
	UNIT_PLANCHER=585
	if npm run test:unit >"$TRAVAIL/unit.log" 2>&1; then
		tests=$(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/unit.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${tests:-0}" -ge "$UNIT_PLANCHER" ]; then
			ok "npm run test:unit — ${tests} tests, au moins les $UNIT_PLANCHER de CRM-043"
		else
			fail "tests unitaires verts mais ${tests:-0} tests, sous le plancher $UNIT_PLANCHER"
		fi
	else
		fail_journal "npm run test:unit ÉCHOUE" "$TRAVAIL/unit.log"
	fi

	if PLAYWRIGHT_CHROMIUM_PATH=${PLAYWRIGHT_CHROMIUM_PATH:-} \
		npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" "$SPEC_UI_GESTES" \
		>"$TRAVAIL/ui.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 19 ]; then
			ok "preuves d'interface — 19 scénarios contre le build de production, dont 5 gestes réels"
		else
			fail "preuve d'interface verte mais ${passes:-0} scénarios au lieu de 19"
		fi
	else
		fail_journal "les preuves d'interface ÉCHOUENT" "$TRAVAIL/ui.log"
	fi

	for capture in fil-charge-1440 fil-vide-1440 refus-ecriture-1440 commentaire-long-390 \
		panneau-xl-1440 panneau-lg-1152 panneau-md-900 panneau-sm-390 \
		commentaire-actions-focus-1440 commentaire-edition-1440 commentaire-modifie-1440 \
		commentaire-confirmation-1440 commentaire-supprime-1440; do
		if [ -s "$CAPTURES/$capture.jpg" ]; then
			ok "capture $capture.jpg produite"
		else
			fail "capture $capture.jpg ABSENTE — CLAUDE.md §16"
		fi
	done

	if npm run build >"$TRAVAIL/build.log" 2>&1; then
		ok "npm run build est vert"
	else
		fail_journal "npm run build ÉCHOUE" "$TRAVAIL/build.log"
	fi
fi

# --- 5. Non-complaisance -------------------------------------------------------------------------
# Un harnais qui ne peut pas échouer ne prouve rien. Chaque dégradation ci-dessous porte sur une
# règle que la spécification énonce, et le contrôle qui devrait la voir est rejoué.

titre "5. Non-complaisance — chaque dégradation doit faire ÉCHOUER une preuve"

degrader_et_verifier() {
	local libelle=$1 sql=$2 restauration=$3
	psql_db -c "$sql" >/dev/null 2>&1 || true
	if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/degradation.log" 2>&1; then
		fail "DÉGRADATION NON VUE : $libelle"
	else
		ok "dégradation vue : $libelle"
	fi
	psql_db -c "$restauration" >/dev/null 2>&1 || true
}

degrader_et_verifier \
	"le privilège DELETE rendu à authenticated — la politique seule ne suffirait plus à le dire" \
	"grant delete on public.card_comments to authenticated" \
	"revoke delete on public.card_comments from authenticated"

degrader_et_verifier \
	"edited_at rouverte au client — la colonne cesserait d'être tenue par le seul produit" \
	"grant update (edited_at) on public.card_comments to authenticated" \
	"revoke update (edited_at) on public.card_comments from authenticated"

degrader_et_verifier \
	"la table retirée de la publication — aucun abonné ne recevrait plus rien" \
	"alter publication supabase_realtime drop table public.card_comments" \
	"alter publication supabase_realtime add table public.card_comments"

degrader_et_verifier \
	"la politique d'insertion ramenée au droit de LECTURE — INC-071 rouverte en silence" \
	"drop policy card_comments_insertion on public.card_comments;
	 create policy card_comments_insertion on public.card_comments for insert to authenticated
	   with check (app.can_read_card(card_id) and author_id = auth.uid())" \
	"drop policy card_comments_insertion on public.card_comments;
	 create policy card_comments_insertion on public.card_comments for insert to authenticated
	   with check (app.can_write_card(card_id) and author_id = auth.uid())"

degrader_et_verifier \
	"la clause d'auteur retirée de la mise à jour — chacun pourrait réécrire la parole d'autrui" \
	"drop policy card_comments_maj on public.card_comments;
	 create policy card_comments_maj on public.card_comments for update to authenticated
	   using (app.can_write_card(card_id)) with check (app.can_write_card(card_id))" \
	"drop policy card_comments_maj on public.card_comments;
	 create policy card_comments_maj on public.card_comments for update to authenticated
	   using (author_id = auth.uid() and app.can_write_card(card_id))
	   with check (author_id = auth.uid() and app.can_write_card(card_id))"

degrader_et_verifier \
	"le trigger de mise à jour retiré — la pierre tombale garderait son corps" \
	"drop trigger card_comments_avant_maj on public.card_comments" \
	"create trigger card_comments_avant_maj before update on public.card_comments
	   for each row execute function app.card_comments_avant_maj()"

# La restauration est CONSTATÉE, pas supposée. Rejouer 0015 seule réinstallerait sa version
# historique de `app.card_comments_avant_maj()` et retirerait l'exception étroite au SET NULL de
# CRM-022. Le suffixe 0021 est donc rejoué immédiatement, puis les DEUX suites sont exigées.
titre "6. Restauration"

if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
	-f - <"$MIGRATION" >"$TRAVAIL/rejeu.log" 2>&1 \
	&& docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
		-f - <"$MIGRATION_IDENTITES" >>"$TRAVAIL/rejeu.log" 2>&1; then
	ok "les migrations CRM-043 puis CRM-022 se rejouent dans l'ordre livré"
else
	fail "le rejeu ordonné des migrations ÉCHOUE : voir $TRAVAIL/rejeu.log"
fi

for fichier in "$MIGRATION" "$TEST_SQL"; do
	if est_rendu_intact "$fichier"; then
		ok "$(basename "$fichier") est rendu INTACT"
	else
		fail "$(basename "$fichier") a été modifié par le harnais"
	fi
done

if npm run test:sql -- "$TEST_SQL" "$TEST_IDENTITES" >"$TRAVAIL/apres.log" 2>&1; then
	ok "les suites commentaires et identités redeviennent vertes après restauration"
else
	fail "une suite commentaires/identités reste rouge après restauration : voir $TRAVAIL/apres.log"
fi

# --- Bilan ---------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
