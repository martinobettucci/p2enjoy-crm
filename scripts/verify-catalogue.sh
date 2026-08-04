#!/usr/bin/env bash
# @verifies CRM-030 (docs/BACKLOG.md) — Definition of Done du catalogue de nœuds
# @verifies docs/SPEC-workflow-engine.md §2.2 (modèle), §2.3 (clé stable), §2.4 (ordre),
#           §2.5 (bornes), §2.6 (archivage), §2.7 (autorisations), §2.8 (contrat d'API mesuré),
#           §2.9 (seed), §2.10 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 2, n° 3, n° 11)
# @verifies docs/SCHEMA.md §3 (workflows) ; docs/PROD_MIGRATIONS.md §3
# @verifies docs/INCONSISTENCY_REPORT.md INC-031 (garde d'archivage différée)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-030` :
#
#   1. la suite pgTAP `supabase/tests/0006_workflow_nodes_catalog.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier la structure de la table, ses politiques ni ses privilèges ;
#   3. les contraintes de valeur sont **convergentes** : une contrainte retirée à la main est
#      rétablie par un rejeu, et non laissée manquante (décision 57) ;
#   4. le seed est **convergent** : rejoué, il laisse exactement huit nœuds, dont un archivé, les
#      cinq jetons du design system exercés et les deux nœuds terminaux sans seuil de relance ;
#   5. INC-031 est **constatée** : `cards`, dont dépend la garde d'archivage, n'existe toujours pas
#      — `workflow_steps` a été livrée par `CRM-031` —, et aucun trigger ne prétend porter cette
#      garde ;
#   6. le contrat d'API est rejoué avec les jetons réels des trois profils seedés ;
#   7. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve rien d'une interface : le catalogue de nœuds n'a **aucun écran**, et n'en aura pas
# avant l'éditeur de workflow de `CRM-031`. Il n'y a donc ni test E2E d'interface, ni capture
# d'application à produire — non par renoncement, mais parce qu'il n'existe rien à regarder. La
# webapp, de surcroît, est un appelant anonyme faute d'écran de connexion
# (`docs/INCONSISTENCY_REPORT.md`, INC-021).
#
# Il ne prouve pas non plus le refus d'archivage d'un nœud occupé, exigé par la Definition of Done :
# `cards` n'existe pas (INC-031), et `workflow_steps` seule ne suffit pas à dire qu'un nœud est
# occupé. Ce que le harnais fait, c'est **vérifier que cette absence est toujours vraie** — le jour
# où elle cessera de l'être, le contrôle 5 tombera, comme il l'a fait à `CRM-031`.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-catalogue.sh
#   scripts/verify-catalogue.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE=supabase/tests/0006_workflow_nodes_catalog.test.sql
MIGRATION_FILE=supabase/migrations/0005_workflow_nodes_catalog.sql
DB_CONTAINER=p2enjoy-db
TABLE=public.workflow_nodes_catalog

WS_SEED=5eed0000-0000-4000-8000-000000000001
MAIL_ADMIN=admin@p2enjoy.test
MAIL_BIZDEV=bizdev@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,43p' "$0"; exit 0 ;;
		*) echo "option inconnue « $1 »." >&2; exit 1 ;;
	esac
	shift
done

if [ ! -f .env ]; then
	echo "ERREUR : fichier .env absent. Lancez ./runDev.sh, qui l'amorce depuis .env.example." >&2
	exit 1
fi

env_value() {
	sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 \
		| sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
}

require_env() {
	local value
	value=$(env_value "$1")
	if [ -z "$value" ]; then
		echo "ERREUR : variable '$1' absente ou vide dans .env." >&2
		exit 1
	fi
	printf '%s' "$value"
}

KONG_HTTP_PORT=$(require_env KONG_HTTP_PORT)
ANON_KEY=$(require_env ANON_KEY)
API="http://127.0.0.1:${KONG_HTTP_PORT}"

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

CORPS=/tmp/p2enjoy-catalogue-body
http() {
	local method=$1 url=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$url" "$@"
}

jeton_de() {
	curl -s -X POST "$API/auth/v1/token?grant_type=password" \
		-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
		-d "$(jq -nc --arg m "$1" --arg p "$MDP_SEED" '{email: $m, password: $p}')" \
		| jq -r '.access_token // empty'
}

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser un nœud de
# preuve ni un workspace de preuve derrière elle.
menage() {
	psql_db -c "
		delete from $TABLE where key like 'tst-crm030-%';
		delete from public.workspaces where slug like 'tst-crm030-%';
	" >/dev/null 2>&1 || true
}
trap 'menage; rm -f "$CORPS"' EXIT
menage

titre "1. Suite pgTAP"

sortie=$(psql_db -v ON_ERROR_STOP=1 -f - < "$TEST_FILE" 2>&1 || true)
if printf '%s' "$sortie" | grep -q '^not ok'; then
	fail "la suite pgTAP signale au moins une anomalie"
	printf '%s\n' "$sortie" | grep '^not ok' | head -5
else
	assertions=$(printf '%s' "$sortie" | grep -c '^ok ' || true)
	ok "suite pgTAP verte — $assertions assertions"
fi

titre "2. La migration est rejouable, et convergente"

# Empreinte de la structure, des politiques et des privilèges **avant** rejeu.
empreinte() {
	psql_db -c "
		select string_agg(x, '|' order by x) from (
			select attname || ':' || atttypid::regtype::text || ':' || attnotnull::text as x
			  from pg_attribute where attrelid = '$TABLE'::regclass and attnum > 0
			union all
			select 'pol:' || policyname || ':' || cmd from pg_policies
			 where schemaname = 'public' and tablename = 'workflow_nodes_catalog'
			union all
			select 'con:' || conname from pg_constraint
			 where conrelid = '$TABLE'::regclass
			union all
			select 'priv:' || grantee || ':' || privilege_type
			  from information_schema.role_table_grants
			 where table_schema = 'public' and table_name = 'workflow_nodes_catalog'
			   and grantee in ('anon', 'authenticated')
		) t;
	"
}

avant=$(empreinte)
if psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1; then
	ok "la migration se réapplique sans erreur sur une base déjà migrée"
else
	fail "la migration échoue au rejeu — l'idempotence n'est pas acquise"
fi
apres=$(empreinte)
if [ "$avant" = "$apres" ]; then
	ok "le rejeu ne modifie ni la structure, ni les politiques, ni les privilèges"
else
	fail "le rejeu a modifié quelque chose : l'empreinte diffère"
fi

# Convergence, et non simple idempotence : une contrainte retirée à la main doit être **rétablie**
# par un rejeu. C'est le défaut réel trouvé par le harnais de `CRM-020` (décision 57).
psql_db -c "alter table $TABLE drop constraint workflow_nodes_catalog_kind_check;" >/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
if [ "$(psql_db -c "select count(*) from pg_constraint
                     where conname = 'workflow_nodes_catalog_kind_check'
                       and conrelid = '$TABLE'::regclass;")" = "1" ]; then
	ok "une contrainte retirée à la main est **rétablie** par un rejeu : la migration répare"
else
	fail "la contrainte retirée n'est pas rétablie : la migration est idempotente sans réparer"
fi

titre "3. Ordre, bornes et archivage, mesurés en base"

psql_db -c "
	insert into public.workspaces (id, name, slug)
	values ('a3330000-0000-4000-8000-000000000001', 'Preuve CRM-030', 'tst-crm030-ws');
" >/dev/null

psql_db -c "
	insert into $TABLE (workspace_id, key, label)
	values ('a3330000-0000-4000-8000-000000000001', 'tst-crm030-un', 'Un');
	insert into $TABLE (workspace_id, key, label)
	values ('a3330000-0000-4000-8000-000000000001', 'tst-crm030-deux', 'Deux');
" >/dev/null
ordre=$(psql_db -c "select string_agg(position::text, ',' order by position) from $TABLE
                     where workspace_id = 'a3330000-0000-4000-8000-000000000001';")
if [ "$ordre" = "1,2" ]; then
	ok "\`position\` est attribuée dans la portée du workspace, et redémarre à 1"
else
	fail "\`position\` attribuée vaut « $ordre », attendu « 1,2 »"
fi

# La borne haute, et l'arrondi qui la précède : `99.999` est **accepté** parce que le type arrondit
# avant que la contrainte ne soit évaluée (décision 68).
arrondi=$(psql_db -c "
	insert into $TABLE (workspace_id, key, label, default_probability)
	values ('a3330000-0000-4000-8000-000000000001', 'tst-crm030-arrondi', 'A', 99.999)
	returning default_probability;" 2>&1)
if [ "$arrondi" = "100.00" ]; then
	ok "\`numeric(5,2)\` arrondit avant la contrainte : 99.999 est accepté et vaut 100.00"
else
	fail "99.999 rend « $arrondi », attendu « 100.00 »"
fi

if psql_db -v ON_ERROR_STOP=1 -c "
	insert into $TABLE (workspace_id, key, label, default_stale_after_days)
	values ('a3330000-0000-4000-8000-000000000001', 'tst-crm030-seuil', 'S', 0);" >/dev/null 2>&1; then
	fail "un seuil de relance de zéro jour est accepté — il devrait être refusé"
else
	ok "un seuil de relance de zéro jour est refusé en base"
fi

psql_db -c "update $TABLE set archived_at = now() where key = 'tst-crm030-un';" >/dev/null
actifs=$(psql_db -c "select count(*) from $TABLE
                      where workspace_id = 'a3330000-0000-4000-8000-000000000001'
                        and archived_at is null;")
psql_db -c "update $TABLE set archived_at = null where key = 'tst-crm030-un';" >/dev/null
apres_desarchivage=$(psql_db -c "select count(*) from $TABLE
                                  where workspace_id = 'a3330000-0000-4000-8000-000000000001'
                                    and archived_at is null;")
if [ "$actifs" = "2" ] && [ "$apres_desarchivage" = "3" ]; then
	ok "l'archivage masque puis rend le nœud : suppression douce et réversible"
else
	fail "archivage : $actifs actifs puis $apres_desarchivage, attendu 2 puis 3"
fi

menage

titre "4. Le seed est convergent"

./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué"
total=$(psql_db -c "select count(*) from $TABLE where workspace_id = '$WS_SEED';")
archives=$(psql_db -c "select count(*) from $TABLE
                        where workspace_id = '$WS_SEED' and archived_at is not null;")
jetons=$(psql_db -c "select count(distinct color) from $TABLE where workspace_id = '$WS_SEED';")
types=$(psql_db -c "select string_agg(distinct kind, ',' order by kind) from $TABLE
                     where workspace_id = '$WS_SEED';")
terminaux_sans_seuil=$(psql_db -c "select count(*) from $TABLE
                                    where workspace_id = '$WS_SEED' and kind <> 'open'
                                      and default_stale_after_days is null;")
ordre_seed=$(psql_db -c "select string_agg(key, ',' order by position) from $TABLE
                          where workspace_id = '$WS_SEED' and archived_at is null;")

[ "$total" = "8" ] && ok "huit nœuds, ni plus ni moins" || fail "nœuds : $total, attendu 8"
[ "$archives" = "1" ] && ok "un nœud archivé, pour rendre l'état démontrable" \
	|| fail "nœuds archivés : $archives, attendu 1"
[ "$jetons" = "5" ] && ok "les cinq jetons du design system sont exercés" \
	|| fail "couleurs distinctes : $jetons, attendu 5"
[ "$types" = "lost,open,won" ] \
	&& ok "les trois types sont représentés, \`won\` et \`lost\` compris" \
	|| fail "types : « $types », attendu « lost,open,won »"
[ "$terminaux_sans_seuil" = "2" ] \
	&& ok "les deux nœuds terminaux n'ont aucun seuil de relance : ils ne sont jamais en retard" \
	|| fail "terminaux sans seuil : $terminaux_sans_seuil, attendu 2"
[ "$ordre_seed" = "prospection,relance,negociation,signature,realisation,livre,perdu" ] \
	&& ok "l'ordre du catalogue est celui de la spécification §2.9" \
	|| fail "ordre du catalogue : « $ordre_seed »"

titre "5. INC-031 : la garde d'archivage est différée, et son absence est vérifiée"

# Ce contrôle est l'inverse d'un contrôle ordinaire : il constate que quelque chose **manque**
# toujours. Le jour où `CRM-031` ou `CRM-040` livrera ses tables, il tombera — et c'est ce qu'on
# lui demande (décision 51).
# MISE À JOUR PAR `CRM-031`, qui a livré `workflow_steps` : ce contrôle a **réellement échoué**,
# comme il avait été écrit pour le faire, et il est révisé avec le code. Il ne reste qu'une table
# manquante — `cards`, due par `CRM-040` —, et le contrôle tombera de nouveau ce jour-là.
tables=$(psql_db -c "select coalesce(to_regclass('public.workflow_steps')::text, 'NULL')
                       || '/' || coalesce(to_regclass('public.cards')::text, 'NULL');")
if [ "$tables" = "workflow_steps/NULL" ]; then
	ok "INC-031 : \`workflow_steps\` existe depuis \`CRM-031\`, \`cards\` non — la garde reste "\
"sans cible, et le rester est vérifié plutôt que supposé"
else
	fail "INC-031 : état des tables « $tables » — si \`cards\` existe, la garde d'archivage doit "\
"être écrite et l'entrée close"
fi

triggers=$(psql_db -c "select count(*) from pg_trigger
                        where tgrelid = '$TABLE'::regclass and not tgisinternal;")
if [ "$triggers" = "2" ]; then
	ok "exactement deux triggers — \`updated_at\` et \`position\`. Aucun ne prétend porter la garde"
else
	fail "triggers : $triggers, attendu 2"
fi

titre "6. Contrat d'API, avec les jetons réels (docs/SPEC-workflow-engine.md §2.8)"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_BIZDEV=$(jeton_de "$MAIL_BIZDEV")
T_VIEWER=$(jeton_de "$MAIL_VIEWER")
[ -n "$T_ADMIN" ] && ok "jeton de l'administrateur obtenu par la vraie route de connexion" \
	|| fail "connexion de l'administrateur impossible"
[ -n "$T_VIEWER" ] && ok "jeton du viewer obtenu par la vraie route de connexion" \
	|| fail "connexion du viewer impossible"

code=$(http GET "$API/rest/v1/workflow_nodes_catalog?select=id" -H "apikey: $ANON_KEY")
if [ "$code" = "200" ] && [ "$(jq -r 'length' < "$CORPS")" = "0" ]; then
	ok "ligne c — l'anonyme obtient 200 et zéro ligne, pas une erreur (refus n° 11)"
else
	fail "ligne c — l'anonyme obtient $code et $(head -c 80 "$CORPS")"
fi

http GET "$API/rest/v1/workflow_nodes_catalog?select=id" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" >/dev/null
[ "$(jq -r 'length' < "$CORPS")" = "8" ] \
	&& ok "ligne a — l'administrateur lit les huit nœuds de son workspace" \
	|| fail "ligne a — l'administrateur lit $(jq -r 'length' < "$CORPS") nœuds"

code=$(http POST "$API/rest/v1/workflow_nodes_catalog" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_VIEWER" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"key\":\"tst-crm030-v\",\"label\":\"X\"}")
if [ "$code" = "403" ] && [ "$(jq -r .code < "$CORPS")" = "42501" ]; then
	ok "ligne f — un viewer ne crée aucun nœud : 403, code 42501"
else
	fail "ligne f — le viewer obtient $code"
fi

# LA LIGNE H, celle qui ne ressemble pas à un refus. Une mise à jour refusée par le `USING` rend
# `200` et un tableau vide : ce qui prouve le refus est l'état de la ligne, relu ensuite.
code=$(http PATCH "$API/rest/v1/workflow_nodes_catalog?key=eq.prospection" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-H 'Prefer: return=representation' -d '{"label":"Renommé de force"}')
libelle=$(psql_db -c "select label from $TABLE where key = 'prospection' and workspace_id = '$WS_SEED';")
if [ "$code" = "200" ] && [ "$(jq -r 'length' < "$CORPS")" = "0" ] && [ "$libelle" = "Prospection" ]; then
	ok "ligne h — un business_developer obtient 200 et zéro ligne, et le libellé est **inchangé** "\
"(preuve de refus n° 2)"
else
	fail "ligne h — code $code, $(jq -r 'length' < "$CORPS") ligne(s), libellé « $libelle »"
fi

code=$(http DELETE "$API/rest/v1/workflow_nodes_catalog?key=eq.prospection" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN")
if [ "$code" = "403" ] && jq -e '.message | test("permission denied")' < "$CORPS" >/dev/null; then
	ok "ligne i — la suppression physique est refusée dès le privilège"
else
	fail "ligne i — la suppression rend $code"
fi

titre "7. Non-complaisance : le harnais échoue quand le produit est affaibli"

# a. Politique d'écriture relâchée : un viewer devrait alors créer un nœud.
psql_db -c "
	drop policy if exists catalogue_noeuds_insertion_admin on $TABLE;
	create policy catalogue_noeuds_insertion_admin on $TABLE for insert to authenticated
		with check (true);
	notify pgrst, 'reload schema';
" >/dev/null
sleep 1
code=$(http POST "$API/rest/v1/workflow_nodes_catalog" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_VIEWER" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"key\":\"tst-crm030-relache\",\"label\":\"X\"}")
if [ "$code" = "201" ]; then
	ok "politique relâchée : le refus disparaît réellement — le contrôle n'est pas décoratif"
else
	fail "politique relâchée : le viewer obtient encore $code, le contrôle ne mesure rien"
fi
psql_db -c "delete from $TABLE where key = 'tst-crm030-relache';" >/dev/null

# b. Politique de mise à jour ouverte : un business_developer devrait alors renommer un nœud, et la
#    ligne h devrait cesser de rendre un tableau vide. C'est le contrôle décisif de ce harnais :
#    sans lui, la ligne h passerait aussi bien sur un produit où **rien** n'est modifiable.
psql_db -c "
	drop policy if exists catalogue_noeuds_maj_admin on $TABLE;
	create policy catalogue_noeuds_maj_admin on $TABLE for update to authenticated
		using (true) with check (true);
	notify pgrst, 'reload schema';
" >/dev/null
sleep 1
http PATCH "$API/rest/v1/workflow_nodes_catalog?key=eq.prospection" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-H 'Prefer: return=representation' -d '{"label":"Renommé de force"}' >/dev/null
libelle=$(psql_db -c "select label from $TABLE where key = 'prospection' and workspace_id = '$WS_SEED';")
if [ "$libelle" = "Renommé de force" ]; then
	ok "politique de mise à jour ouverte : le renommage passe réellement — la ligne h mesure bien "\
"un refus, et non l'impossibilité générale d'écrire"
else
	fail "politique ouverte : le libellé reste « $libelle », le contrôle de la ligne h ne mesure rien"
fi

# c. Contrainte de couleur retirée : un hexadécimal devrait alors entrer en base.
psql_db -c "alter table $TABLE drop constraint workflow_nodes_catalog_color_check;" >/dev/null
if psql_db -v ON_ERROR_STOP=1 -c "
	insert into $TABLE (workspace_id, key, label, color, position)
	values ('$WS_SEED', 'tst-crm030-hex', 'H', '#ff0000', 99);" >/dev/null 2>&1; then
	ok "contrainte de couleur retirée : l'hexadécimal entre — la contrainte porte bien la garantie"
	psql_db -c "delete from $TABLE where key = 'tst-crm030-hex';" >/dev/null
else
	fail "contrainte retirée : l'hexadécimal est encore refusé, la garantie vient d'ailleurs"
fi

# d. Restauration **constatée**, et non supposée.
psql_db -c "update $TABLE set label = 'Prospection' where key = 'prospection';" >/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
sleep 1
restaure=$(psql_db -c "
	select (select count(*) from pg_constraint
	         where conname = 'workflow_nodes_catalog_color_check'
	           and conrelid = '$TABLE'::regclass)::text
	    || '/' ||
	       (select coalesce(with_check, '') from pg_policies
	         where tablename = 'workflow_nodes_catalog'
	           and policyname = 'catalogue_noeuds_insertion_admin')
	    || '/' ||
	       (select coalesce(qual, '') from pg_policies
	         where tablename = 'workflow_nodes_catalog'
	           and policyname = 'catalogue_noeuds_maj_admin');
")
if printf '%s' "$restaure" | grep -q '^1/' \
	&& [ "$(printf '%s' "$restaure" | grep -c 'is_workspace_admin')" -ge 1 ]; then
	ok "restauration constatée : la contrainte de couleur et les deux politiques sont revenues"
else
	fail "restauration incomplète : « $restaure »"
fi

code=$(http POST "$API/rest/v1/workflow_nodes_catalog" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_VIEWER" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"key\":\"tst-crm030-v2\",\"label\":\"X\"}")
[ "$code" = "403" ] && ok "et le refus est de nouveau opposé au viewer" \
	|| fail "après restauration, le viewer obtient encore $code"

libelle=$(psql_db -c "select label from $TABLE where key = 'prospection' and workspace_id = '$WS_SEED';")
[ "$libelle" = "Prospection" ] && ok "le seed est revenu à son contrat : « Prospection »" \
	|| fail "le libellé du seed reste « $libelle »"

titre "8. Suites, tests unitaires et build"

if [ "$RAPIDE" = true ]; then
	printf '  (ignorés : --rapide)\n'
else
	npm run test:sql >/dev/null 2>&1 && ok "npm run test:sql" || fail "npm run test:sql"
	npm run test:unit >/dev/null 2>&1 && ok "npm run test:unit" || fail "npm run test:unit"
	npm run typecheck >/dev/null 2>&1 && ok "npm run typecheck" || fail "npm run typecheck"
	npm run types:check >/dev/null 2>&1 && ok "npm run types:check" || fail "npm run types:check"
	npm run build >/dev/null 2>&1 && ok "npm run build" || fail "npm run build"
	npm run e2e:api >/dev/null 2>&1 && ok "npm run e2e:api" || fail "npm run e2e:api"
	npm run e2e:ui >/dev/null 2>&1 && ok "npm run e2e:ui" || fail "npm run e2e:ui"
fi

titre "Résultat"
if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%d contrôles, aucune anomalie.\033[0m\n\n' "$checks"
else
	printf '  \033[31m%d contrôles, %d en échec.\033[0m\n\n' "$checks" "$failures"
	exit 1
fi
