#!/usr/bin/env bash
# @verifies CRM-043 (docs/BACKLOG.md) — Definition of Done des commentaires
# @verifies docs/SPEC-cards.md §13.2 (modèle), §13.3 (unicité et dérivation), §13.4 (la pierre
#           tombale), §13.5 (`edited_at`), §13.6 (autorisations), §13.7 (colonnes protégées),
#           §13.8 (contrat d'API), §13.9 (temps réel), §13.11 (seed), §13.14 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §3.6, §3.7 (les deux fonctions d'appui), §7 (refus n° 4)
# @verifies docs/SPEC-seed.md §2.14 (commentaires du seed, convergence par présence et par état)
# @verifies docs/DESIGN_SYSTEM.md §5.10 (panneau de commentaires), §7 (paliers), §12.5 (réponses
#           substituées) ; CLAUDE.md §16 (vérification visuelle)
# @verifies docs/INCONSISTENCY_REPORT.md INC-071, INC-072, INC-048, INC-061 (jeu d'essai nettoyé),
#           INC-021 (webapp anonyme), INC-014 (profils illisibles)
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
# Ce que ce harnais NE prouve PAS, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve **aucune publication par un utilisateur connecté** : la webapp est un appelant
# anonyme faute d'écran de connexion (INC-021), et le fil ne se remplit jamais en conditions
# réelles. Les états chargés sont prouvés en substituant la réponse réseau, procédé endossé par
# docs/DESIGN_SYSTEM.md §12.5 — et le contrat d'écriture, lui, est prouvé hors interface par
# `e2e/api/commentaires.spec.ts` avec les jetons réels des trois comptes. `CRM-043` reste `[~]`
# pour cette raison.
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
TEST_SQL=supabase/tests/0017_commentaires.test.sql
SPEC_API=e2e/api/commentaires.spec.ts
MODULE=webapp/src/lib/commentaires.ts
COMPOSANT=webapp/src/app/PanneauCommentaires.tsx
TEST_UNITAIRE=webapp/src/lib/commentaires.test.ts
TEST_COMPOSANT=webapp/src/app/PanneauCommentaires.test.tsx
SPEC_UI=e2e/ui/commentaires.spec.ts
CAPTURES=docs/captures/CRM-043
SEED=supabase/seed/apply-seed.sh
DB_CONTAINER=p2enjoy-db

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,37p' "$0"; exit 0 ;;
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
	"$TEST_COMPOSANT" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done

for fichier in "$MIGRATION" "$MODULE" "$COMPOSANT"; do
	if head -3 "$fichier" | grep -q '@spec CRM-043'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

for fichier in "$TEST_SQL" "$SPEC_API" "$TEST_UNITAIRE" "$TEST_COMPOSANT" "$SPEC_UI"; do
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
		fail "le rejeu du seed ÉCHOUE : voir $TRAVAIL/seed.log"
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
	fail "supabase/tests/0017_commentaires.test.sql ÉCHOUE : voir $TRAVAIL/pgtap.log"
fi

if [ "$RAPIDE" = false ]; then
	if npm run test:sql >"$TRAVAIL/pgtap-global.log" 2>&1; then
		assertions=$(grep -oE '[0-9]+ assertions' "$TRAVAIL/pgtap-global.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${assertions:-0}" -eq 1250 ]; then
			ok "npm run test:sql — 1250 assertions (1164 + 84, et deux assertions révisées)"
		else
			fail "npm run test:sql vert mais ${assertions:-0} assertions au lieu de 1250"
		fi
	else
		fail "npm run test:sql ÉCHOUE : voir $TRAVAIL/pgtap-global.log"
	fi

	if PLAYWRIGHT_CHROMIUM_PATH=${PLAYWRIGHT_CHROMIUM_PATH:-/opt/pw-browsers/chromium} \
		npx playwright test --config e2e/playwright.config.ts --project=api "$SPEC_API" \
		>"$TRAVAIL/api.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/api.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 17 ]; then
			ok "e2e/api/commentaires.spec.ts — 17 scénarios, dont le refus opposé au viewer et le temps réel"
		else
			fail "preuve d'API verte mais ${passes:-0} scénarios au lieu de 17"
		fi
	else
		fail "e2e/api/commentaires.spec.ts ÉCHOUE : voir $TRAVAIL/api.log"
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

# INC-014 : aucun nom d'auteur n'est affiché, et la règle est figée ici comme dans les tests.
if grep -qE "auteurId|author_id" "$COMPOSANT"; then
	fail "le composant affiche ou manipule l'identité de l'auteur — INC-014, §13.10"
else
	ok "aucune identité d'auteur n'atteint le rendu — INC-014, règle du §12.5"
fi

# CLAUDE.md §11 : aucune persistance côté client n'est introduite, brouillon compris.
if grep -qE "localStorage|sessionStorage|document\.cookie" "$MODULE" "$COMPOSANT"; then
	fail "une persistance côté client est apparue — CLAUDE.md §11"
else
	ok "aucune persistance côté client : ni brouillon, ni préférence (CLAUDE.md §11)"
fi

if [ "$RAPIDE" = false ]; then
	if npm run test:unit >"$TRAVAIL/unit.log" 2>&1; then
		tests=$(grep -oE 'Tests +[0-9]+ passed' "$TRAVAIL/unit.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${tests:-0}" -eq 438 ]; then
			ok "npm run test:unit — 438 tests, dont 33 dédiés à cette unité"
		else
			fail "tests unitaires verts mais ${tests:-0} tests au lieu de 438"
		fi
	else
		fail "npm run test:unit ÉCHOUE : voir $TRAVAIL/unit.log"
	fi

	if PLAYWRIGHT_CHROMIUM_PATH=${PLAYWRIGHT_CHROMIUM_PATH:-/opt/pw-browsers/chromium} \
		npx playwright test --config e2e/playwright.config.ts --project=ui "$SPEC_UI" \
		>"$TRAVAIL/ui.log" 2>&1; then
		passes=$(grep -oE '[0-9]+ passed' "$TRAVAIL/ui.log" | tail -1 | grep -oE '[0-9]+')
		if [ "${passes:-0}" -eq 14 ]; then
			ok "e2e/ui/commentaires.spec.ts — 14 scénarios contre le build de production"
		else
			fail "preuve d'interface verte mais ${passes:-0} scénarios au lieu de 14"
		fi
	else
		fail "e2e/ui/commentaires.spec.ts ÉCHOUE : voir $TRAVAIL/ui.log"
	fi

	for capture in fil-charge-1440 fil-vide-1440 refus-ecriture-1440 commentaire-long-390 \
		panneau-xl-1440 panneau-lg-1152 panneau-md-900 panneau-sm-390; do
		if [ -s "$CAPTURES/$capture.jpg" ]; then
			ok "capture $capture.jpg produite"
		else
			fail "capture $capture.jpg ABSENTE — CLAUDE.md §16"
		fi
	done

	if npm run build >"$TRAVAIL/build.log" 2>&1; then
		ok "npm run build est vert"
	else
		fail "npm run build ÉCHOUE : voir $TRAVAIL/build.log"
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

# La restauration est CONSTATÉE, pas supposée : la migration est rejouée, puis le schéma relu.
titre "6. Restauration"

if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
	-f - <"$MIGRATION" >"$TRAVAIL/rejeu.log" 2>&1; then
	ok "la migration se rejoue sans erreur — idempotence et convergence (INC-035)"
else
	fail "le rejeu de la migration ÉCHOUE : voir $TRAVAIL/rejeu.log"
fi

for fichier in "$MIGRATION" "$TEST_SQL"; do
	if est_rendu_intact "$fichier"; then
		ok "$(basename "$fichier") est rendu INTACT"
	else
		fail "$(basename "$fichier") a été modifié par le harnais"
	fi
done

if npm run test:sql -- "$TEST_SQL" >"$TRAVAIL/apres.log" 2>&1; then
	ok "la suite pgTAP redevient verte après restauration"
else
	fail "la suite pgTAP reste rouge après restauration : voir $TRAVAIL/apres.log"
fi

# --- Bilan ---------------------------------------------------------------------------------------

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
