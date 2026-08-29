#!/usr/bin/env bash
# @verifies CRM-062 (docs/BACKLOG.md) — relances automatiques des cards figées, TRANCHES 1 ET 2
# @verifies docs/SPEC-relances.md §2.2 (seuil effectif), §2.3 (les nœuds terminaux ne sont pas
#           nommés), §2.4 (les trois exclusions), §2.5 (la borne), §3.2 (forme de la fonction),
#           §3.3 (ACL, et `anon` révoqué NOMMÉMENT), §3.4 (l'ordre), §5 (le seed), §6 (les preuves)
# @verifies docs/SPEC-relances.md §9.3 (forme et ACL de la relance), §9.4 (idempotence et son
#           ancre), §9.6 (le payload sans libellé), §9.7 (le job et sa cadence nominale),
#           §9.9 (le seed écrit par le VRAI mécanisme), §9.10 (les preuves de la tranche 2)
# @verifies docs/SCHEMA.md §9 bis.9 et §9 bis.10 ; docs/PROD_MIGRATIONS.md §3 (migrations 53 et 54)
# @verifies docs/SPEC-test-harness.md §7.2 (un harnais dégrade réellement et constate la restauration)
#
# Le script ne démarre ni n'arrête la pile. Il exige la base locale de développement migrée et
# seedée. Il rejoue les preuves de l'unité, puis DÉGRADE RÉELLEMENT la fonction — une dégradation
# par règle qu'elle porte — et exige que la preuve concernée rougisse. Aucun état dégradé ne
# subsiste, même en cas d'échec : la migration est rejouée par un `trap`.
#
# CE QU'UNE DÉGRADATION PROUVE, ET CE QU'ELLE NE PROUVE PAS. Qu'une suite soit verte ne dit rien
# tant qu'on n'a pas vu qu'elle sait rougir. Chaque dégradation retire UNE règle du produit et
# vérifie que la suite pgTAP la dénonce ; une dégradation qui laisserait la suite verte est un trou
# dans la preuve, et le harnais la nomme « COMPLAISANT » plutôt que de la passer sous silence.

set -euo pipefail

cd "$(dirname "$0")/.."

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0053_cards_figees.sql
SUITE_SQL=supabase/tests/0051_cards_figees.test.sql
MIGRATION_2=supabase/migrations/0054_relances_automatiques.sql
SUITE_SQL_2=supabase/tests/0052_relances_automatiques.test.sql
JOB_RELANCES=p2enjoy-relances-cards-figees
# La tranche courante : les dégradations et la suite pgGTAP qu'elles doivent faire rougir. Les
# sections 1 à 7 travaillent sur la tranche 1 ; la section 8 bascule sur la tranche 2.
MIGRATION_COURANTE="$MIGRATION"
SUITE_COURANTE="$SUITE_SQL"
SPEC=docs/SPEC-relances.md
MODULE_TS=webapp/src/lib/carte-figee.ts
SUITE_TS=webapp/src/lib/carte-figee.test.ts
SUITE_API=e2e/api/relances.spec.ts
CARD_FIGEE=5eed0000-0000-4000-8000-0000000000c3

# --- Tranche 3 : la surface (docs/SPEC-relances.md §10) ------------------------------------------
MODULE_FIGEES=webapp/src/lib/affaires-figees.ts
COLONNES_FIGEES=webapp/src/lib/colonnes-affaires-figees.ts
COMPOSANT_FIGEES=webapp/src/app/AffairesFigees.tsx
SUITE_FIGEES=webapp/src/lib/affaires-figees.test.ts
SUITE_COMPOSANT=webapp/src/app/AffairesFigees.test.tsx
SUITE_UI=e2e/ui/affaires-figees.spec.ts
MODULE_TIMELINE=webapp/src/lib/timeline.ts
TRADUCTIONS=webapp/src/i18n/fr.ts
# Les quatre retards du §10.2.1, deux à deux distincts : l'ordre est donc TOTAL sur ce jeu.
SUITE_ATTENDUE='35,18,16,7'
PROFIL_ADMIN=5eed0000-0000-4000-8000-000000000011
PROFIL_BIZDEV=5eed0000-0000-4000-8000-000000000012
PROFIL_VIEWER=5eed0000-0000-4000-8000-000000000013

controles=0
anomalies=0
TRAVAIL=$(mktemp -d)
restauration_due=false

nettoyer() {
	local statut=$?
	trap - EXIT
	set +e
	if [ "$restauration_due" = true ]; then
		if ! psql_db -f - < "$MIGRATION_COURANTE" >/dev/null 2>&1; then
			printf 'ERREUR : la restauration de secours de %s a échoué.\n' "$MIGRATION_COURANTE" >&2
			statut=1
		fi
		promouvoir_job >/dev/null 2>&1
	fi
	rm -rf -- "$TRAVAIL"
	exit "$statut"
}
trap nettoyer EXIT

ok()   { controles=$((controles + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { controles=$((controles + 1)); anomalies=$((anomalies + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

# La suite pgTAP de l'unité, rendue vraie ou fausse. Les dégradations s'en servent : une règle
# retirée DOIT la faire rougir.
suite_sql_verte() {
	scripts/run-sql-tests.sh "$SUITE_COURANTE" >"$TRAVAIL/tap.log" 2>&1 \
		&& grep -q 'aucune anomalie' "$TRAVAIL/tap.log"
}

# Remplace le corps de la fonction dans une copie de la migration, puis l'applique. Le motif est
# comparé AVANT et APRÈS : une substitution qui ne substituerait rien laisserait la suite verte et
# le harnais conclurait à tort à la complaisance — c'est le défaut trouvé à `CRM-061` (décision 503),
# et il ne se refait pas.
# Après tout rejeu de la migration 54, `cron.schedule` a remis le job à son amorçage de dix
# secondes (§9.7). Un appel direct le promeut immédiatement, au lieu d'attendre que le moteur
# tire : la fonction est idempotente, donc cet appel n'écrit rien de plus.
promouvoir_job() {
	[ "$MIGRATION_COURANTE" = "$MIGRATION_2" ] || return 0
	psql_db -c "select app.relancer_cards_figees();" >/dev/null 2>&1
}

degrader() {
	local avant=$1 apres=$2 nom=$3
	python3 - "$MIGRATION_COURANTE" "$TRAVAIL/degrade.sql" "$avant" "$apres" <<-'PY'
		import io, sys
		source, cible, avant, apres = sys.argv[1:5]
		texte = io.open(source, encoding='utf-8').read()
		if texte.count(avant) != 1:
		    sys.exit(f"motif absent ou ambigu ({texte.count(avant)} occurrence(s))")
		io.open(cible, 'w', encoding='utf-8').write(texte.replace(avant, apres))
	PY
	if ! cmp -s "$MIGRATION_COURANTE" "$TRAVAIL/degrade.sql"; then
		restauration_due=true
		# L'AMORÇAGE EST NEUTRALISÉ DANS LA COPIE DÉGRADÉE, ET C'EST INDISPENSABLE : appliquée
		# telle quelle, la migration 54 remet le job à dix secondes, et un passage tiré au milieu
		# d'une dégradation de l'idempotence écrirait un DOUBLON dans le seed, hors transaction et
		# donc définitif. La copie part directement à la cadence nominale ; la dégradation reste
		# entière, seule la fenêtre de tir disparaît.
		if [ "$MIGRATION_COURANTE" = "$MIGRATION_2" ]; then
			python3 - "$TRAVAIL/degrade.sql" <<-'PY'
				import io, sys
				chemin = sys.argv[1]
				texte = io.open(chemin, encoding='utf-8').read()
				if texte.count("'10 seconds',") != 1:
				    sys.exit("amorçage introuvable dans la copie dégradée")
				io.open(chemin, 'w', encoding='utf-8').write(
				    texte.replace("'10 seconds',", "'23 3 * * *',"))
			PY
		fi
		psql_db -f - < "$TRAVAIL/degrade.sql" >/dev/null 2>&1
		return 0
	fi
	fail "dégradation « $nom » IMPOSSIBLE : la substitution n'a rien changé"
	return 1
}

restaurer() {
	psql_db -f - < "$MIGRATION_COURANTE" >/dev/null 2>&1
	promouvoir_job
	restauration_due=false
}

# Une dégradation complète : substituer, exiger le rouge, restaurer, exiger le vert.
eprouver_degradation() {
	local nom=$1 avant=$2 apres=$3
	degrader "$avant" "$apres" "$nom" || return 0
	if suite_sql_verte; then
		fail "COMPLAISANT — « $nom » retirée, la suite pgTAP reste VERTE"
	else
		ok "dégradation « $nom » : la suite pgTAP rougit, comme elle doit"
	fi
	restaurer
}

echo
echo "Preuves de CRM-062 — les affaires figées (tranche 1) et leur relance (tranche 2)"
echo

if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi

# =================================================================================================
echo "1. Traçabilité : aucun fichier de l'unité n'est orphelin de sa spécification"
# =================================================================================================
# `CLAUDE.md` §5 : chaque fichier porte ses commentaires `@spec` / `@verifies` vers l'unité de
# backlog ET les chapitres. Le contrôle est mécanique, sur les six fichiers de la tranche.

for fichier in "$MIGRATION" "$MODULE_TS"; do
	if head -n 12 "$fichier" | grep -q '@spec CRM-062' \
		&& head -n 12 "$fichier" | grep -q 'docs/SPEC-relances.md'; then
		ok "traçabilité : $fichier cite CRM-062 et sa spécification"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @spec complet"
	fi
done

for fichier in "$SUITE_SQL" "$SUITE_TS" "$SUITE_API"; do
	if head -n 14 "$fichier" | grep -q '@verifies CRM-062' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-relances.md'; then
		ok "traçabilité : $fichier cite CRM-062 et sa spécification en @verifies"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @verifies complet"
	fi
done

if [ -f "$SPEC" ] && grep -q '^### 2.4 Les trois exclusions' "$SPEC" \
	&& grep -q '^## 4. Contrat d' "$SPEC" \
	&& grep -q '^### 3.3 Autorisations' "$SPEC"; then
	ok "la spécification existe et porte les chapitres que les fichiers citent"
else
	fail "docs/SPEC-relances.md absent ou amputé d'un chapitre cité"
fi

# =================================================================================================
echo
echo "2. Forme de la fonction dans le catalogue, et son ACL — mesurées, pas relues dans le SQL"
# =================================================================================================
# `security invoker` est le DÉFAUT et ne s'écrit donc pas : lire le fichier ne dirait rien. Seul le
# catalogue le dit.

forme=$(psql_db -F '|' -c "select p.prosecdef, p.provolatile, coalesce(array_to_string(p.proconfig, ','), '')
	from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'cards_figees';")
if [ "$forme" = 'f|s|search_path=""' ]; then
	ok "public.cards_figees() : SECURITY INVOKER, STABLE, search_path vide"
else
	fail "forme inattendue de public.cards_figees() : '$forme' au lieu de 'f|s|search_path=\"\"'"
fi

acl=$(psql_db -F '|' -c "select has_function_privilege('anon','public.cards_figees()','execute'),
	has_function_privilege('authenticated','public.cards_figees()','execute'),
	has_function_privilege('service_role','public.cards_figees()','execute');")
if [ "$acl" = 'f|t|t' ]; then
	ok "ACL : anon SANS execute, authenticated et service_role avec"
else
	fail "ACL inattendue : '$acl' au lieu de 'f|t|t' — pg_default_acl accorde anon à la création"
fi

if [ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'cards_figees';")" = 1 ]; then
	ok "une seule surcharge de public.cards_figees() : un rejeu n'en crée pas de seconde"
else
	fail "plusieurs surcharges de public.cards_figees() — un rejeu a divergé"
fi

# =================================================================================================
echo
echo "3. Le contrat du seed, mesuré EN BASE avec les prédicats exacts de la fonction"
# =================================================================================================
# `docs/SPEC-relances.md` §5. La mesure passe par la fonction elle-même sous `service_role`, qui
# traverse la RLS : ce que le harnais vérifie ici, c'est la RÈGLE, pas le cloisonnement — celui-ci
# est mesuré par la suite pgTAP et par la preuve d'API sous les trois jetons réels.

# RÉVISÉ PAR LA TRANCHE 3a (§10.2) : le jeu porte QUATRE affaires figées. La mesure ne porte donc
# plus sur un `min()` agrégé — qui, sur quatre lignes, mêlerait le seuil de l'une au retard d'une
# autre et ne dirait plus rien — mais sur le COMPTE et sur la ligne de `…0c3`, lue nommément et
# inchangée depuis `CRM-046`.
contrat=$(psql_db -F '|' -c "select
	(select count(*) from public.cards_figees()),
	(select f.seuil_jours from public.cards_figees() f where f.card_id = '$CARD_FIGEE'),
	(select f.jours_dans_etape >= 30 from public.cards_figees() f where f.card_id = '$CARD_FIGEE');")
if [ "$contrat" = "4|14|t" ]; then
	ok "seed : quatre affaires figées, dont « Audit sécurité applicative » à seuil 14 et ≥ 30 jours"
else
	fail "contrat du seed inattendu : '$contrat' au lieu de '4|14|t' (§10.2.1)"
fi

if [ "$(psql_db -c "select count(*) from public.cards_figees() f
	join public.cards c on c.id = f.card_id
	where c.archived_at is not null or c.deleted_at is not null;")" = 0 ]; then
	ok "aucune affaire archivée ni en corbeille n'est rendue"
else
	fail "une affaire rangée est rendue comme figée"
fi

if [ "$(psql_db -c "select count(*) from public.cards_figees() f
	join public.cards c on c.id = f.card_id
	where c.snoozed_until > now();")" = 0 ]; then
	ok "aucune affaire encore endormie n'est rendue"
else
	fail "une affaire en sommeil est rendue comme figée"
fi

if [ "$(psql_db -c "select count(*) from public.cards_figees() f where f.retard_jours < 0;")" = 0 ]; then
	ok "retard_jours n'est jamais négatif"
else
	fail "une ligne porte un retard négatif : la borne ne s'applique pas"
fi

# LE CONTRASTE EST MESURÉ, PAS SUPPOSÉ : sans au moins une affaire EN DEÇÀ de son seuil, « exactement
# une au-delà » serait vrai sur un pipeline entièrement frais comme sur un seuil mal choisi.
if [ "$(psql_db -c "select count(*) from public.cards c
	join public.workflow_steps ws on ws.id = c.current_step_id
	join public.workflow_nodes_catalog n on n.id = ws.node_id
	where c.archived_at is null and c.deleted_at is null
	  and coalesce(ws.stale_after_days, n.default_stale_after_days) is not null
	  and floor(extract(epoch from (now() - c.entered_step_at)) / 86400.0)
	      < coalesce(ws.stale_after_days, n.default_stale_after_days);")" -ge 1 ]; then
	ok "le contraste existe : au moins une affaire porte un seuil et reste en deçà"
else
	fail "aucune affaire en deçà de son seuil : « au-delà » ne contraste avec rien"
fi

# =================================================================================================
echo
echo "4. La règle n'a qu'UNE déclaration côté TypeScript"
# =================================================================================================
# `docs/SPEC-relances.md` §2.1. Si `board.ts` recalculait le seuil ou la borne pour son compte, les
# deux moitiés du produit pourraient diverger sans que rien ne le dise.

if grep -q "from './carte-figee'" webapp/src/lib/board.ts; then
	ok "board.ts importe la règle plutôt que de la redéclarer"
else
	fail "board.ts ne passe plus par carte-figee.ts : la règle a deux déclarations"
fi

if ! grep -qE 'jours >= seuilJours|stale_after_days \?\? .*default_stale_after_days' webapp/src/lib/board.ts; then
	ok "board.ts ne porte plus ni la borne ni la résolution du seuil en propre"
else
	fail "board.ts a repris la borne ou la résolution du seuil : la règle a divergé"
fi

if grep -q "webapp/src/lib/carte-figee" "$SUITE_API"; then
	ok "la preuve d'API importe la règle du produit, elle ne la recopie pas"
else
	fail "la preuve d'API ne lit plus carte-figee.ts : sa cohérence ne prouve plus rien"
fi

if grep -qE "^import .* from '\./" "$MODULE_TS"; then
	fail "carte-figee.ts a gagné une importation : il redevient inatteignable depuis e2e/"
else
	ok "carte-figee.ts n'importe rien — la condition de son atteignabilité des deux côtés"
fi

# =================================================================================================
echo
echo "5. Les quatre suites de preuves de l'unité"
# =================================================================================================

# VINGT-SIX depuis la tranche 3a : la conformité du seed y assère la suite entière et les deux
# dimensions du regroupement, là où elle comptait une ligne (§10.2.2).
if suite_sql_verte && grep -q '1 fichiers, 26 assertions, aucune anomalie' "$TRAVAIL/tap.log"; then
	ok "pgTAP : 26 assertions, aucune anomalie"
else
	fail "suite pgTAP en échec ou compte inattendu"
	sed 's/^/        /' "$TRAVAIL/tap.log" | tail -n 25
fi

# LES DEUX SUITES NODE PASSENT PAR `scripts/lib/node.sh`, comme les trente et un harnais qui en
# dépendent : sans Node 24, elles refuseraient de s'exécuter à leur première ligne.
# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

if npm run --silent test:unit -- "$SUITE_TS" >"$TRAVAIL/unit.log" 2>&1 \
	&& grep -qE 'Tests +12 passed' "$TRAVAIL/unit.log"; then
	ok "unitaire : 12 assertions sur la règle extraite"
else
	fail "suite unitaire de carte-figee.ts en échec ou compte inattendu"
	sed 's/^/        /' "$TRAVAIL/unit.log" | tail -n 20
fi

if npm run --silent e2e:api -- "$SUITE_API" >"$TRAVAIL/api.log" 2>&1 \
	&& grep -qE '21 passed' "$TRAVAIL/api.log"; then
	ok "API : 21 scénarios verts — les dix lignes du contrat, les deux cohérences, et les huit de la tranche 2"
else
	fail "suite d'API en échec ou compte inattendu"
	sed 's/^/        /' "$TRAVAIL/api.log" | tail -n 25
fi

if npm run --silent typecheck >"$TRAVAIL/tsc.log" 2>&1; then
	ok "npm run typecheck vert sur les quatre projets"
else
	fail "npm run typecheck échoue"
	sed 's/^/        /' "$TRAVAIL/tsc.log" | tail -n 20
fi

# =================================================================================================
echo
echo "6. Non-complaisance : sept dégradations réelles, une par règle portée"
# =================================================================================================
# Chacune retire UNE règle du produit et exige que la suite pgTAP la dénonce. La restauration est
# CONSTATÉE en fin de section, jamais supposée.

eprouver_degradation "exclusion des archivées" \
	"	 where c.archived_at is null
	   and c.deleted_at is null" \
	"	 where c.deleted_at is null"

eprouver_degradation "exclusion de la corbeille" \
	"	   and c.deleted_at is null
" \
	"	   and true
"

eprouver_degradation "exclusion du sommeil" \
	"	   and (c.snoozed_until is null or c.snoozed_until <= now())" \
	"	   and true"

eprouver_degradation "le sommeil ÉCHU protégerait encore" \
	"	   and (c.snoozed_until is null or c.snoozed_until <= now())" \
	"	   and c.snoozed_until is null"

eprouver_degradation "borne stricte au lieu de large" \
	"	       >= coalesce(ws.stale_after_days, n.default_stale_after_days)" \
	"	       > coalesce(ws.stale_after_days, n.default_stale_after_days)"

eprouver_degradation "seuil du nœud passant AVANT celui de l'étape" \
	"	       coalesce(ws.stale_after_days, n.default_stale_after_days),
	       -- JOURS RÉVOLUS" \
	"	       coalesce(n.default_stale_after_days, ws.stale_after_days),
	       -- JOURS RÉVOLUS"

eprouver_degradation "ordre par titre seul, le retard perdu" \
	"	 order by 10 desc, c.title;" \
	"	 order by c.title;"

# LA DÉGRADATION DE L'ACL EST À PART : elle ne passe pas par le corps de la fonction, et c'est
# précisément le défaut que la première écriture de la migration portait.
psql_db -c "grant execute on function public.cards_figees() to anon;" >/dev/null 2>&1
restauration_due=true
if [ "$(psql_db -c "select has_function_privilege('anon','public.cards_figees()','execute');")" = t ]; then
	ok "dégradation « execute rendu à anon » : elle est effective, pas seulement demandée"
else
	fail "impossible de rouvrir execute à anon pour la contre-épreuve"
fi
if suite_sql_verte; then
	fail "COMPLAISANT — execute rendu à anon, la suite pgTAP reste VERTE"
else
	ok "dégradation « execute rendu à anon » : la suite pgTAP rougit, comme elle doit"
fi
restaurer

# =================================================================================================
echo
echo "7. Tranche 2 — la relance automatique, sa forme, son job et son idempotence"
# =================================================================================================
# docs/SPEC-relances.md §9. La tranche 2 n'a AUCUNE surface : tout ce qu'elle livre se mesure en
# base, et rien de ce qui suit ne peut être vu depuis un écran.

MIGRATION_COURANTE="$MIGRATION_2"
SUITE_COURANTE="$SUITE_SQL_2"

for fichier in "$MIGRATION_2" "$SUITE_SQL_2"; do
	if head -n 14 "$fichier" | grep -qE '@(spec|verifies) CRM-062' \
		&& head -n 14 "$fichier" | grep -q 'docs/SPEC-relances.md'; then
		ok "traçabilité : $fichier cite CRM-062 et sa spécification"
	else
		fail "traçabilité : $fichier n'a pas d'en-tête @spec/@verifies complet"
	fi
done

if grep -q '^### 9.4 Propriété 1' "$SPEC" && grep -q '^### 9.7 Le job' "$SPEC"; then
	ok "la spécification porte le chapitre 9 que la tranche 2 cite"
else
	fail "docs/SPEC-relances.md §9 absent ou amputé — la tranche 2 citerait un chapitre inexistant"
fi

# LA FORME EST LUE DANS LE CATALOGUE, PAS DANS LE FICHIER. `security definer` s'écrit, mais le
# PROPRIÉTAIRE ne s'écrit pas dans la même ligne : une fonction `definer` appartenant à un rôle
# faible n'écrirait rien du tout, et le SQL en aurait pourtant l'air correct.
forme_2=$(psql_db -F '|' -c "select p.prosecdef, p.provolatile,
	coalesce(array_to_string(p.proconfig, ','), ''), r.rolname
	from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	join pg_roles r on r.oid = p.proowner
	where n.nspname = 'app' and p.proname = 'relancer_cards_figees';")
if [ "$forme_2" = 't|v|search_path=""|postgres' ]; then
	ok "app.relancer_cards_figees() : DEFINER, VOLATILE, search_path vide, propriétaire postgres"
else
	fail "forme inattendue de app.relancer_cards_figees() : '$forme_2'"
fi

acl_2=$(psql_db -F '|' -c "select
	has_function_privilege('anon','app.relancer_cards_figees()','execute'),
	has_function_privilege('authenticated','app.relancer_cards_figees()','execute'),
	has_function_privilege('service_role','app.relancer_cards_figees()','execute');")
if [ "$acl_2" = 'f|f|f' ]; then
	ok "ACL : aucun rôle client ne déclenche une relance — c'est un fait de l'horloge"
else
	fail "ACL inattendue sur la relance : '$acl_2' au lieu de 'f|f|f'"
fi

if [ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'relancer_cards_figees';")" = 0 ]; then
	ok "aucune fonction homonyme dans public : la relance n'a AUCUNE route rpc/"
else
	fail "une fonction relancer_cards_figees existe dans public : elle serait appelable par rpc/"
fi

job=$(psql_db -F '|' -c "select count(*), min(schedule), min(command), min(database), min(username),
	bool_and(active) from cron.job where jobname = '$JOB_RELANCES';")
if [ "$job" = "1|23 3 * * *|select app.relancer_cards_figees();|postgres|postgres|t" ]; then
	ok "job : un seul, à sa cadence NOMINALE quotidienne, sous postgres, actif"
else
	fail "contrat du job inattendu : '$job'"
fi

if [ "$(psql_db -c "select count(*) from cron.job_run_details d join cron.job j on j.jobid = d.jobid
	where j.jobname = '$JOB_RELANCES' and d.status = 'succeeded';")" -ge 1 ]; then
	ok "le moteur a réellement lancé la commande : un passage succeeded est journalisé"
else
	fail "aucun passage succeeded pour $JOB_RELANCES — le job est enregistré mais jamais tiré"
fi

# LE SEED, ÉCRIT PAR LE VRAI MÉCANISME (§9.9). L'assertion porte sur l'ENSEMBLE DES CLÉS du payload :
# « contient seuil_jours » laisserait passer un libellé ajouté demain.
# RÉVISÉ PAR LA TRANCHE 3a (§10.2.3) : QUATRE relances, une par affaire figée. Le compte des cards
# DISTINCTES est celui qui compte — un compte global de quatre serait vert si une seule card en
# portait quatre, ce qui nierait l'idempotence du §9.4. Les deux prédicats de forme portent sur
# l'ENSEMBLE des lignes : un payload correct sur l'une et amputé sur l'autre passerait sinon.
relance_seed=$(psql_db -F '|' -c "select count(*), count(distinct card_id),
	bool_and(actor_id is null),
	bool_and((select string_agg(k, ',' order by k) from jsonb_object_keys(payload) k)
	         = 'retard_jours,seuil_jours')
	from public.card_events where type = 'stalled';")
if [ "$relance_seed" = "4|4|t|t" ]; then
	ok "seed : QUATRE stalled sur quatre cards distinctes, acteur nul, payload aux deux seules clés"
else
	fail "état de relance du seed inattendu : '$relance_seed' au lieu de '4|4|t|t'"
fi

# L'IDEMPOTENCE, MESURÉE HORS TRANSACTION : la suite pgTAP la prouve dans un `rollback`, mais un
# appel réel doit lui aussi ne rien écrire — c'est ce que fait le job chaque jour.
if [ "$(psql_db -c "select app.relancer_cards_figees();")" = 0 ]; then
	ok "idempotence hors transaction : un appel réel de plus n'inscrit rien"
else
	fail "un appel réel a inscrit des relances : l'ancrage sur l'entrée dans l'étape ne tient pas"
fi

if suite_sql_verte && grep -q '1 fichiers, 25 assertions, aucune anomalie' "$TRAVAIL/tap.log"; then
	ok "pgTAP tranche 2 : 25 assertions, aucune anomalie"
else
	fail "suite pgTAP de la tranche 2 en échec ou compte inattendu"
	sed 's/^/        /' "$TRAVAIL/tap.log" | tail -n 25
fi

# =================================================================================================
echo
echo "7 bis. Dégradations RÉELLES de la tranche 2 — la suite doit rougir"
# =================================================================================================

eprouver_degradation "idempotence entièrement retirée" \
	"		 where not exists (
			select 1
			  from public.card_events e
			 where e.card_id    = f.card_id
			   and e.type       = 'stalled'
			   and e.created_at >= f.entered_step_at
		 )" \
	"		 where true"

eprouver_degradation "ancre de l'idempotence retirée : un stalled à VIE au lieu d'un par entrée" \
	"			   and e.created_at >= f.entered_step_at" \
	"			   and true"

eprouver_degradation "un libellé recopié dans le payload" \
	"				'retard_jours', v_figee.retard_jours));" \
	"				'retard_jours', v_figee.retard_jours,
				'etape_libelle', 'Prospection'));"

eprouver_degradation "l'acteur inventé au lieu d'être obtenu" \
	"		perform app.card_event_ecrire(
			v_figee.card_id," \
	"		perform set_config('request.jwt.claims',
			json_build_object('sub', (select id::text from public.profiles limit 1),
			                  'role', 'authenticated')::text, true);
		perform app.card_event_ecrire(
			v_figee.card_id,"

# LA DÉGRADATION DE LA CADENCE EST À PART : la promotion ne s'observe qu'une fois la fonction
# APPELÉE, et un appel dans la transaction de la suite pgTAP serait annulé avec elle. Le harnais
# appelle donc la fonction hors transaction — sûr ici, l'idempotence étant intacte dans cette
# copie : l'appel n'écrit rien, il ne fait que promouvoir.
if degrader "schedule => '23 3 * * *'" "schedule => '7 * * * *'" "cadence nominale devenue horaire"; then
	psql_db -c "select app.relancer_cards_figees();" >/dev/null 2>&1
	if [ "$(psql_db -c "select schedule from cron.job where jobname = '$JOB_RELANCES';")" = '7 * * * *' ]; then
		ok "dégradation « cadence nominale devenue horaire » : elle est effective, pas demandée"
	else
		fail "impossible de dégrader la cadence du job pour la contre-épreuve"
	fi
	if suite_sql_verte; then
		fail "COMPLAISANT — cadence horaire au lieu de quotidienne, la suite pgTAP reste VERTE"
	else
		ok "dégradation « cadence nominale devenue horaire » : la suite pgTAP rougit"
	fi
	restaurer
fi

# La réouverture de l'ACL ne passe pas par le corps de la fonction : c'est le défaut que la
# migration 53 a payé pour apprendre, et il vaut pour toute fonction neuve.
psql_db -c "grant execute on function app.relancer_cards_figees() to authenticated;" >/dev/null 2>&1
restauration_due=true
if [ "$(psql_db -c "select has_function_privilege('authenticated','app.relancer_cards_figees()','execute');")" = t ]; then
	ok "dégradation « execute rendu à authenticated » : elle est effective, pas demandée"
else
	fail "impossible d'ouvrir execute à authenticated pour la contre-épreuve"
fi
if suite_sql_verte; then
	fail "COMPLAISANT — un client peut déclencher les relances, la suite pgTAP reste VERTE"
else
	ok "dégradation « execute rendu à authenticated » : la suite pgTAP rougit"
fi
restaurer

MIGRATION_COURANTE="$MIGRATION"
SUITE_COURANTE="$SUITE_SQL"

# =================================================================================================
echo
echo "7 ter. Le répertoire de migrations se rejoue sur une base qui porte « stalled » — INC-210"
# =================================================================================================
# POURQUOI CE CONTRÔLE EXISTE, ET POURQUOI IL APPARTIENT À CETTE UNITÉ.
#
# La quinzième valeur du vocabulaire de `card_events` est posée par la migration 54, celle de cette
# unité. Les migrations 20, 25 et 30 portent DEUX gardes de convergence (INC-144) : la première
# regarde la contrainte, la seconde regarde les LIGNES et interdit de converger si l'une d'elles
# porte un type que la migration ne connaît pas. La migration 44 n'avait que la première.
#
# MESURÉ le 2026-08-25, avant correction : le `migrations-runner` s'arrêtait en `23514` sur la 44
# — quatre lignes `stalled` violant ses quatorze valeurs —, code 3, et les migrations 45 à 54 ne
# s'appliquaient PLUS DU TOUT. La base restait avec le vocabulaire qu'elle avait, et toute écriture
# serveur de la trace échouait ensuite. Le défaut ne se voyait pas d'une pile fraîche : il fallait
# une contrainte déjà réduite, ce que tout harnais qui dégrade le vocabulaire produit. INC-210.
#
# Le contrôle reproduit exactement cette situation. Il n'est complaisant sous aucun angle : sans la
# seconde garde de la migration 44, il rougit ; et son témoin refuse de le déclarer vert sur une
# base qui ne porterait aucune ligne `stalled`, cas où le rejeu réussirait sans rien prouver.
# LE CODE DE RETOUR DE `docker compose up` NE DIT RIEN, ET C'EST MESURÉ le 2026-08-25 : la commande
# rend 0 alors que le conteneur, lui, est sorti en 3. Écrit naïvement, ce contrôle aurait été
# COMPLAISANT — il l'a été, et c'est la dégradation volontaire de la migration 44 qui l'a montré.
# Le verdict est donc lu sur l'ÉTAT du conteneur, seul endroit où le `psql` du runner l'écrit.
rejouer_repertoire() {
	docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml \
		up --force-recreate migrations-runner >"$TRAVAIL/runner.log" 2>&1
	[ "$(docker inspect p2enjoy-migrations --format '{{.State.ExitCode}}')" = '0' ]
}

# LA RÉFÉRENCE N'EST PLUS CODÉE EN DUR, ET C'EST UNE RÉVISION DU 2026-08-29 — INC-239, décision 558.
#
# Elle valait « les quinze valeurs de la migration 54 ». La migration 70 (`CRM-085`) a porté le
# vocabulaire à DIX-NEUF valeurs, et ce contrôle rougissait alors sur un rejeu PARFAITEMENT
# correct : la constante disait l'époque de son écriture, pas le produit. C'est la famille d'INC-191,
# d'INC-175 et d'INC-242 — un compteur figé que le produit dépasse.
#
# La preuve est RÉVISÉE et non retirée (`docs/CloudWorker.md` §3.1), et elle en ressort PLUS FORTE :
# la référence est désormais le vocabulaire que la base porte AVANT la dégradation. Le contrôle
# n'exige plus une liste datée, il exige que le rejeu RESTAURE EXACTEMENT ce qu'il a trouvé — ce qui
# est la propriété réellement en cause, et qui ne peut plus se périmer.
#
# Elle reste non complaisante : un témoin refuse de déclarer la référence probante si elle ne cite
# pas `stalled`, cas où la base serait déjà dégradée et où le contrôle comparerait deux états
# également faux.

# Le vocabulaire est LU dans la contrainte de la base, jamais dans le texte d'une migration : ce
# qui garde les écritures est ce que PostgreSQL porte, pas ce qu'un fichier prétend poser.
vocabulaire_courant() {
	psql_db -c "select string_agg(v, ',')
		from pg_constraint c,
		     regexp_split_to_table(
		       substring(pg_get_constraintdef(c.oid) from 'ARRAY\[(.*)\]'), ',') as x,
		     lateral (select trim(both '''' from split_part(btrim(x), '::', 1)) as v) w
		 where c.conrelid = 'public.card_events'::regclass
		   and c.conname  = 'card_events_type_check';"
}

lignes_stalled=$(psql_db -c "select count(*) from public.card_events where type = 'stalled';")
if [ "$lignes_stalled" -gt 0 ]; then
	ok "témoin : la base porte $lignes_stalled ligne(s) « stalled » — le rejeu a de quoi buter"
else
	fail "témoin ABSENT : aucune ligne « stalled », ce contrôle ne prouverait rien"
fi

VOCABULAIRE_ATTENDU=$(vocabulaire_courant)
if printf '%s' "$VOCABULAIRE_ATTENDU" | grep -q '\bstalled\b'; then
	ok "référence relevée AVANT dégradation : $(printf '%s' "$VOCABULAIRE_ATTENDU" | tr ',' '\n' | grep -c .) valeurs, « stalled » comprise"
else
	fail "référence NON PROBANTE : la base est déjà dégradée, la comparaison ne prouverait rien"
fi

# La réduction exacte que produit `scripts/verify-change-channel-workflow.sh` : les neuf valeurs
# d'avant la migration 20, en `not valid` — la contrainte ne peut pas être posée `valid` sur des
# lignes qui la violent déjà.
psql_db -c "alter table public.card_events drop constraint card_events_type_check;
	alter table public.card_events add constraint card_events_type_check
	check (type = any (array['created','moved','assigned','channel_changed','archived',
	'unarchived','trashed','restored','field_changed'])) not valid" >/dev/null
restauration_due=true

if rejouer_repertoire; then
	ok "le répertoire entier se rejoue sans erreur sur une base au vocabulaire réduit"
else
	fail "le rejeu du répertoire ÉCHOUE — les migrations suivantes ne s'appliquent plus"
	sed 's/^/        /' "$TRAVAIL/runner.log" | tail -n 12
fi

vocabulaire=$(vocabulaire_courant)
if [ "$vocabulaire" = "$VOCABULAIRE_ATTENDU" ]; then
	ok "le vocabulaire est rendu ENTIER par le rejeu, à la valeur près de la référence relevée"
else
	fail "vocabulaire non rendu — attendu « $VOCABULAIRE_ATTENDU », obtenu « $vocabulaire »"
fi

if [ "$(psql_db -c "select convalidated from pg_constraint
	where conrelid = 'public.card_events'::regclass
	  and conname  = 'card_events_type_check';")" = 't' ]; then
	ok "la contrainte redevient VALID : elle garde les écritures à venir, et non les seules futures"
else
	fail "la contrainte reste NOT VALID après le rejeu"
fi

# Le rejeu du répertoire remet le job de la 54 à son amorçage de dix secondes (§9.7) : la même
# promotion immédiate qu'après toute application de cette migration, sans quoi la section 8
# constaterait une cadence qui n'est pas celle du produit. L'appel est DIRECT et non `promouvoir_job`,
# qui ne fait rien tant que `MIGRATION_COURANTE` n'est pas la 54 — ici elle est revenue à la 53.
# La fonction est idempotente (§9.4) : elle n'écrit aucune relance de plus.
psql_db -c "select app.relancer_cards_figees();" >/dev/null
restauration_due=false

# =================================================================================================
echo
echo "7 quater. Le moteur pg_cron exécute RÉELLEMENT la commande — INC-217"
# =================================================================================================
# CETTE PREUVE VIENT DE `supabase/tests/0052_relances_automatiques.test.sql`, ET ELLE Y ÉTAIT
# INTENABLE. L'assertion exigeait un passage `succeeded` du job de relance ; celui-ci est planifié à
# `23 3 * * *`, si bien qu'une pile montée après 03 h 23 n'en porte aucun. Elle rendait donc vert ou
# rouge selon l'heure de démarrage — et, plus précisément, selon qu'un AUTRE harnais avait rejoué la
# migration 54 dans la vie de cette pile, ce qui réarme le job sur dix secondes (§9.7). Une preuve
# verte parce qu'une autre preuve a tourné avant elle ne prouve pas ce qu'elle annonce.
#
# Ici, le harnais ARME LUI-MÊME ce qu'il mesure : un job JETABLE, nommé de façon unique, portant la
# commande du produit — `select app.relancer_cards_figees();` —, à la cadence d'amorçage de dix
# secondes. Ce que la suite pgTAP ne peut pas faire : elle s'exécute dans UNE transaction, et
# `pg_cron` ne voit que ce qui est committé.
#
# La commande est celle du produit, et c'est le point : un job jetable qui exécuterait `select 1`
# prouverait que le moteur tourne, non qu'il sait exécuter CETTE fonction — dont l'ACL refuse
# `execute` aux quatre rôles clients (§9.3). La fonction est idempotente (§9.4) : ces passages
# n'écrivent aucune relance de plus.
JOB_JETABLE="p2enjoy-preuve-moteur-$$"
psql_db -c "select cron.schedule('$JOB_JETABLE', '10 seconds',
	'select app.relancer_cards_figees();');" >/dev/null
restauration_due=true

passage=''
for _tentative in $(seq 1 12); do
	passage=$(psql_db -c "select d.status from cron.job_run_details d
		join cron.job j on j.jobid = d.jobid
		 where j.jobname = '$JOB_JETABLE'
		 order by d.start_time desc limit 1;" | tr -d '[:space:]')
	[ -n "$passage" ] && break
	sleep 5
done

psql_db -c "select cron.unschedule('$JOB_JETABLE');" >/dev/null 2>&1 || true
restauration_due=false

if [ "$passage" = 'succeeded' ]; then
	ok "le moteur a RÉELLEMENT exécuté « select app.relancer_cards_figees(); » — passage succeeded"
elif [ -z "$passage" ]; then
	fail "aucun passage en 60 s : le moteur pg_cron ne tire pas, ou n'est pas armé"
else
	fail "le moteur a lancé la commande et elle a ÉCHOUÉ : passage « $passage »"
fi

# LE JOB JETABLE NE SURVIT PAS AU HARNAIS. Un job de dix secondes oublié écrirait, à l'échelle d'une
# journée, huit mille six cents passages — exactement ce que le §9.7 reproche à l'amorçage laissé en
# place. Le constat est relu, jamais supposé.
if [ "$(psql_db -c "select count(*) from cron.job where jobname = '$JOB_JETABLE';" | tr -d '[:space:]')" = 0 ]; then
	ok "le job jetable est désordonnancé : le harnais ne laisse aucun passage derrière lui"
else
	fail "le job jetable « $JOB_JETABLE » SURVIT au harnais"
fi

# Le job du PRODUIT n'a pas bougé pendant cette section : ni sa cadence, ni son unicité.
etat_job=$(psql_db -F '|' -c "select count(*), max(schedule) from cron.job
	where jobname = '$JOB_RELANCES';" | tr -d '[:space:]')
if [ "$etat_job" = '1|233***' ]; then
	ok "le job du produit reste unique et à sa cadence nominale — le jetable ne l'a pas touché"
else
	fail "le job du produit a changé pendant la preuve du moteur : « $etat_job »"
fi

# =================================================================================================
echo
echo "8. Restauration CONSTATÉE, jamais supposée"
# =================================================================================================

forme_finale=$(psql_db -F '|' -c "select p.prosecdef, p.provolatile,
	has_function_privilege('anon','public.cards_figees()','execute'),
	has_function_privilege('authenticated','public.cards_figees()','execute')
	from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	where n.nspname = 'public' and p.proname = 'cards_figees';")
if [ "$forme_finale" = 'f|s|f|t' ]; then
	ok "la fonction est restaurée : INVOKER, STABLE, anon refusé, authenticated admis"
else
	fail "la fonction n'est pas restaurée : '$forme_finale'"
fi

# RÉVISÉ PAR LA TRANCHE 3a : le constat porte sur la SUITE des quatre retards, et non plus sur un
# `min()` agrégé. Sur quatre lignes, un `min()` mêlerait le seuil de l'une au retard d'une autre et
# ne dirait plus rien ; la suite, elle, est ce que l'écran rend.
contrat_final=$(psql_db -c "select string_agg(retard_jours::text, ',' order by retard_jours desc)
	from public.cards_figees();")
if [ "$contrat_final" = "$SUITE_ATTENDUE" ]; then
	ok "le seed est rendu intact : les quatre affaires figées, dans leur ordre « $SUITE_ATTENDUE »"
else
	fail "le seed ne retrouve pas son état : '$contrat_final' au lieu de '$SUITE_ATTENDUE'"
fi

if suite_sql_verte; then
	ok "la suite pgTAP redevient verte après restauration"
else
	fail "la suite pgTAP reste rouge après restauration"
	sed 's/^/        /' "$TRAVAIL/tap.log" | tail -n 25
fi

# La tranche 2 est restaurée elle aussi, et le CONSTAT porte sur les trois choses que ses
# dégradations ont touchées : la fermeture de l'ACL, la cadence du job, et l'état du seed — un
# doublon de relance écrit hors transaction ne se rattraperait pas.
etat_2=$(psql_db -F '|' -c "select
	has_function_privilege('authenticated','app.relancer_cards_figees()','execute'),
	(select schedule from cron.job where jobname = '$JOB_RELANCES'),
	(select count(*) from public.card_events where type = 'stalled');")
# RÉVISÉ PAR LA TRANCHE 3a : le jeu porte QUATRE affaires figées, donc quatre relances (§10.2.3).
if [ "$etat_2" = 'f|23 3 * * *|4' ]; then
	ok "tranche 2 restaurée : ACL refermée, job quotidien, et QUATRE stalled dans le seed"
else
	fail "la tranche 2 n'est pas restaurée : '$etat_2' au lieu de 'f|23 3 * * *|4'"
fi

SUITE_COURANTE="$SUITE_SQL_2"
if suite_sql_verte; then
	ok "la suite pgTAP de la tranche 2 redevient verte après restauration"
else
	fail "la suite pgTAP de la tranche 2 reste rouge après restauration"
	sed 's/^/        /' "$TRAVAIL/tap.log" | tail -n 25
fi
SUITE_COURANTE="$SUITE_SQL"

# =================================================================================================
# TRANCHE 3 — la surface : le jeu de démonstration, la relance nommée, l'écran
# =================================================================================================
# @verifies docs/SPEC-relances.md §10.2 (le jeu de démonstration), §10.3 (la relance nommée dans le
#           fil), §10.5 (les deux lectures), §10.7 (regroupement et classement), §10.12 (preuves)

echo
echo "Tranche 3 — la surface"

# --- 3.1. Les fichiers livrés et leur traçabilité ------------------------------------------------

for fichier in "$MODULE_FIGEES" "$COLONNES_FIGEES" "$COMPOSANT_FIGEES"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
for fichier in "$SUITE_FIGEES" "$SUITE_COMPOSANT" "$SUITE_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est ABSENT"; fi
done
for fichier in "$MODULE_FIGEES" "$COLONNES_FIGEES" "$COMPOSANT_FIGEES"; do
	if head -4 "$fichier" 2>/dev/null | grep -q '@spec CRM-062'; then
		ok "$(basename "$fichier") porte son commentaire @spec"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done
for fichier in "$SUITE_FIGEES" "$SUITE_COMPOSANT" "$SUITE_UI"; do
	if head -4 "$fichier" 2>/dev/null | grep -q '@verifies CRM-062'; then
		ok "$(basename "$fichier") porte son commentaire @verifies"
	else
		fail "$(basename "$fichier") ne cite pas son unité de backlog"
	fi
done

# --- 3.2. Le jeu de démonstration, mesuré en base ------------------------------------------------
#
# LA SUITE ENTIÈRE, ET PAS SEULEMENT SON COMPTE (§10.2.1 point 1) : un compte de quatre serait vert
# même si les quatre étaient les mauvaises, et une liste d'identifiants le serait même si les
# retards étaient égaux — or c'est cet ordre-là que l'écran rend.
suite_figees=$(psql_db -c "select string_agg(retard_jours::text, ',' order by retard_jours desc)
                             from public.cards_figees()")
if [ "$suite_figees" = "$SUITE_ATTENDUE" ]; then
	ok "le jeu porte quatre affaires figées de retards « $SUITE_ATTENDUE » — deux à deux distincts,
   donc l'ordre du §3.4 est TOTAL sur ce jeu"
else
	fail "les retards du jeu sont « $suite_figees » au lieu de « $SUITE_ATTENDUE » (§10.2.1)"
fi

dimensions=$(psql_db -F '|' -c "select count(distinct f.channel_id), count(distinct ch.track_id)
                                  from public.cards_figees() f
                                  join public.channels ch on ch.id = f.channel_id")
if [ "$dimensions" = '4|3' ]; then
	ok "quatre dossiers pour trois tracks : un track en porte deux, seul cas qui prouve que le
   regroupement du §10.7 porte sur le channel et non sur le track"
else
	fail "$dimensions dossiers|tracks au lieu de '4|3' (§10.2.1 point 2)"
fi

# LES TROIS PROFILS, ET C'EST LA MESURE LA PLUS UTILE DU JEU (§10.2.1). La lectrice en voit TROIS :
# le refus se mesure comme un trou dans une liste peuplée, et non comme un écran vide qu'une
# fonction cassée aurait rendu tout aussi vert.
for couple in "$PROFIL_ADMIN:4" "$PROFIL_BIZDEV:4" "$PROFIL_VIEWER:3"; do
	profil=${couple%%:*}
	attendu=${couple##*:}
	lues=$(psql_db -c "set local role authenticated;
	  select set_config('request.jwt.claims', json_build_object('sub','$profil','role','authenticated')::text, true);
	  select count(*) from public.cards_figees();" | tail -1)
	if [ "$lues" = "$attendu" ]; then
		ok "le profil $profil lit $attendu affaires figées"
	else
		fail "le profil $profil lit $lues affaires figées au lieu de $attendu (§10.2.1)"
	fi
done

# --- 3.3. La relance NOMMÉE dans le fil — sous-tranche 3b, INC-207 -------------------------------
#
# LE TYPE EXISTAIT EN BASE SANS ÊTRE NOMMÉ À L'ÉCRAN, et le fil le rendait « Événement ». Ces trois
# contrôles figent les trois endroits où l'oubli vivait, afin qu'un quinzième type ne les refasse
# pas dormir.
if grep -q "^	'stalled'," "$MODULE_TIMELINE"; then
	ok "« stalled » est NOMMÉ dans TYPES_EVENEMENT (§10.3.1)"
else
	fail "« stalled » est absent de TYPES_EVENEMENT : le fil le rendrait « Événement » (INC-207)"
fi
if grep -q "^	stalled: 'cycle'," "$MODULE_TIMELINE"; then
	ok "« stalled » est RANGÉ dans la famille cycle, par une ligne écrite et non par le repli"
else
	fail "« stalled » n'est rangé nulle part : sa famille ne serait qu'un repli (§10.3.1)"
fi
if grep -q "'timeline.event.stalled'" "$TRADUCTIONS"; then
	ok "« stalled » a son libellé « Relance automatique » et ses trois formes de détail"
else
	fail "« stalled » n'a aucune traduction : le fil rendrait timeline.event.unknown"
fi

# --- 3.4. NON-COMPLAISANCE — les dégradations de la tranche 3 ------------------------------------
#
# Chaque affaiblissement volontaire DOIT faire rougir une preuve, et la restauration est CONSTATÉE.
# Sans elles, « la suite est verte » ne dirait rien de plus que « la suite s'exécute ».

# D-A — le regroupement porte sur le TRACK au lieu du dossier. Le jeu de 3a est construit pour que
# cette dégradation morde : `studio-web` porte deux dossiers figés, et un regroupement par track les
# fondrait en un bloc — trois groupes au lieu de quatre.
degrader_unitaire() {
	local nom=$1 fichier=$2 avant=$3 apres=$4
	cp "$fichier" "$TRAVAIL/$(basename "$fichier").sauf"
	if ! grep -qF "$avant" "$fichier"; then
		fail "dégradation « $nom » IMPOSSIBLE : le motif figé ne correspond plus à $fichier"
		return 0
	fi
	python3 - "$fichier" "$avant" "$apres" <<'PYEOF'
import sys
chemin, avant, apres = sys.argv[1], sys.argv[2], sys.argv[3]
texte = open(chemin, encoding='utf-8').read()
open(chemin, 'w', encoding='utf-8').write(texte.replace(avant, apres, 1))
PYEOF
	if npx vitest run --config webapp/vitest.config.ts "$5" >"$TRAVAIL/unit.log" 2>&1; then
		fail "COMPLAISANT — « $nom » et les tests unitaires restent VERTS"
	else
		ok "dégradation « $nom » : les tests unitaires rougissent, comme ils doivent"
	fi
	cp "$TRAVAIL/$(basename "$fichier").sauf" "$fichier"
	if diff -q "$TRAVAIL/$(basename "$fichier").sauf" "$fichier" >/dev/null; then
		ok "$(basename "$fichier") est RENDU intact — constaté, pas supposé"
	else
		fail "$(basename "$fichier") est laissé DÉGRADÉ"
	fi
}

degrader_unitaire "regroupement par track au lieu du dossier" "$MODULE_FIGEES" 	'const rang = rangs.get(affaire.idChannel)' 	'const rang = rangs.get(affaire.nomTrack ?? affaire.idChannel)' 	src/lib/affaires-figees.test.ts

# D-B — l'ordre des groupes devient alphabétique. Le dossier le plus en retard descendrait alors en
# bas d'écran, ce qui est exactement l'information que l'écran existe pour donner (§10.7).
degrader_unitaire "ordre des groupes par nom au lieu du retard" "$MODULE_FIGEES" 	'	return groupes' 	'	return [...groupes].sort((a, b) => (a.idChannel < b.idChannel ? -1 : 1))' 	src/lib/affaires-figees.test.ts

# D-C — une affaire absente de la seconde lecture est ÉCARTÉE au lieu d'être listée. Elle
# disparaîtrait alors de la liste qui existe pour montrer les affaires en retard (§10.5).
degrader_unitaire "une affaire sans libellés est écartée au lieu d'être listée" "$MODULE_FIGEES" 	'		return pret(figees.map((ligne) => apparier(ligne, cards)))' 	'		return pret(figees.filter((l) => cards.has(l.card_id)).map((ligne) => apparier(ligne, cards)))' 	src/lib/affaires-figees.test.ts

# D-D — le détail d'une relance est construit par CONCATÉNATION au lieu d'une clé de traduction.
# « 1 jours de retard » est faux, et c'est la faute que le §10 du design system nomme.
degrader_unitaire "détail de relance construit par concaténation" "$MODULE_TIMELINE" 	"	if (retard === 0) return t('timeline.stalled.onThreshold', { seuil: String(seuil) })" 	"	if (retard === 0) return \`\${retard} jours de retard\`" 	src/lib/timeline.test.ts

# D-E — `stalled` retiré de FAMILLE_PAR_TYPE. Sa famille resterait `cycle` PAR LE REPLI, et sans
# l'assertion propre du §10.3.1 la suite resterait verte : c'est elle qu'on éprouve ici.
degrader_unitaire "stalled retiré de FAMILLE_PAR_TYPE, le repli le rattraperait" "$MODULE_TIMELINE" 	"	stalled: 'cycle'," 	"" 	src/lib/timeline.test.ts

echo
if [ "$anomalies" -eq 0 ]; then
	echo "Bilan : $controles contrôles, aucune anomalie."
	exit 0
fi
echo "Bilan : $controles contrôles, $anomalies anomalie(s)." >&2
exit 1
