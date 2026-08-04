#!/usr/bin/env bash
# @verifies CRM-032 (docs/BACKLOG.md) — Definition of Done de la copie d'un workflow vers un track
# @verifies docs/SPEC-workflow-engine.md §4.2 (signature), §4.3 (refus), §4.4 (codes HTTP mesurés),
#           §4.5 (ce qui est copié), §4.6 (divergence), §4.7 (privilèges), §4.9 (contrat d'API),
#           §4.10 (seed), §4.11 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §4 (écriture réservée aux administrateurs), §7 (refus n° 2, n° 11)
# @verifies docs/INCONSISTENCY_REPORT.md INC-037 (`form_fields` absente), INC-038 (angle mort),
#           INC-039 (ordre de suppression d'un workspace), INC-021 (aucun écran)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-032` :
#
#   1. la suite pgTAP `supabase/tests/0008_copie_workflow.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier la définition de la fonction, celle de la vue, ni leurs privilèges ;
#   3. elle est **convergente** : un privilège relâché à la main est rétabli par un rejeu, et non
#      laissé en l'état (décision 57) ;
#   4. le contrat d'API du §4.9 est rejoué avec les jetons réels des trois profils seedés, y compris
#      les codes HTTP mesurés du §4.4 ;
#   5. le seed est **convergent** : rejoué, il laisse **une** copie, ni zéro ni deux, portant sept
#      étapes et dix transitions ;
#   6. INC-037 et INC-038 sont **constatées** : `form_fields` n'existe toujours pas, et une
#      suppression dans la source reste invisible du signal de divergence ;
#   7. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve rien d'une interface. La mention de divergence exigée par la Definition of Done —
# « ce workflow dérive de X, modifié depuis le jj/mm/aaaa » — suppose un écran d'administration
# authentifié, et la webapp reste un appelant **anonyme** faute d'écran de connexion
# (`docs/INCONSISTENCY_REPORT.md`, INC-021). Ce qui est livré, c'est la **donnée** qui porterait
# cette phrase, prouvée par l'API. Il n'y a donc ni test E2E d'interface, ni capture d'application à
# produire pour cette unité — non par renoncement, mais parce qu'il n'existe rien à regarder.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-copie-workflow.sh
#   scripts/verify-copie-workflow.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE=supabase/tests/0008_copie_workflow.test.sql
MIGRATION_FILE=supabase/migrations/0007_copie_workflow.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
WF_SEED=5eed0000-0000-4000-8000-000000000051
TRACK_CONSEIL=5eed0000-0000-4000-8000-000000000021
TRACK_STUDIO=5eed0000-0000-4000-8000-000000000022
TRACK_ARCHIVE=5eed0000-0000-4000-8000-000000000024
MAIL_ADMIN=admin@p2enjoy.test
MAIL_BIZDEV=bizdev@p2enjoy.test
MDP_SEED=SeedDev2026Local

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,42p' "$0"; exit 0 ;;
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

CORPS=/tmp/p2enjoy-copie-body
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

# Le ménage retire les copies d'essai — celles posées sur un autre track que « Conseil & IA », qui
# est celui du seed. L'ordre importe : INC-039, une suppression de workspace échoue tant que des
# étapes instancient des nœuds. Ici, supprimer le workflow suffit, ses étapes tombant en cascade.
menage() {
	psql_db -c "
		delete from public.workflows
		 where derived_from_workflow_id = '$WF_SEED' and track_id <> '$TRACK_CONSEIL';
		delete from public.workflows where name like 'tst-crm032-%';
	" >/dev/null 2>&1 || true
}
trap 'menage; rm -f "$CORPS"' EXIT
menage

titre "1. Suite pgTAP"

sortie=$(psql_db -v ON_ERROR_STOP=1 -f - < "$TEST_FILE" 2>&1 || true)
if printf '%s' "$sortie" | grep -q '^not ok'; then
	fail "la suite pgTAP signale au moins une anomalie"
	printf '%s\n' "$sortie" | grep '^not ok' | head -5
elif printf '%s' "$sortie" | grep -q '# Looks like you planned'; then
	fail "pgTAP dénonce son propre plan : la suite ne se termine pas hors savepoint"
else
	assertions=$(printf '%s' "$sortie" | grep -c '^ok ' || true)
	ok "suite pgTAP verte — $assertions assertions"
fi

titre "2. La migration est rejouable, et convergente"

empreinte() {
	psql_db -c "
		select string_agg(x, '|' order by x) from (
			select 'fn:' || p.proname || ':' || pg_get_function_identity_arguments(p.oid)
			       || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '-') as x
			  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'public' and p.proname = 'copy_workflow_to_track'
			union all
			select 'fnpriv:' || grantee || ':' || privilege_type
			  from information_schema.role_routine_grants
			 where routine_schema = 'public' and routine_name = 'copy_workflow_to_track'
			   and grantee in ('anon', 'authenticated', 'service_role')
			union all
			select 'view:' || a.attname || ':' || a.atttypid::regtype::text
			  from pg_attribute a
			 where a.attrelid = 'public.workflow_derivations'::regclass
			   and a.attnum > 0 and not a.attisdropped
			union all
			select 'viewopt:' || coalesce(c.reloptions::text, '-') from pg_class c
			 where c.oid = 'public.workflow_derivations'::regclass
			union all
			select 'viewpriv:' || grantee || ':' || privilege_type
			  from information_schema.role_table_grants
			 where table_schema = 'public' and table_name = 'workflow_derivations'
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
	ok "le rejeu ne modifie ni la fonction, ni la vue, ni leurs privilèges"
else
	fail "le rejeu a modifié quelque chose : l'empreinte diffère"
fi

# Convergence, et non simple idempotence. Le privilège rendu à `anon` est **exactement** le défaut
# d'origine de l'image (décision 80) : si la migration ne le retirait pas à chaque passage, une base
# où quelqu'un l'aurait rendu resterait durablement ouverte.
psql_db -c "grant execute on function public.copy_workflow_to_track(uuid, uuid, text) to anon;" \
	>/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
if [ "$(psql_db -c "select has_function_privilege('anon',
                     'public.copy_workflow_to_track(uuid, uuid, text)', 'EXECUTE');")" = "f" ]; then
	ok "un privilège rendu à \`anon\` est **retiré** par un rejeu : la migration répare"
else
	fail "le privilège rendu à \`anon\` survit au rejeu : la migration est idempotente sans réparer"
fi

titre "3. Ce que la base garantit, mesuré et non supposé"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_BIZDEV=$(jeton_de "$MAIL_BIZDEV")
[ -n "$T_ADMIN" ] && ok "jeton de l'administrateur obtenu par la vraie route de connexion" \
	|| fail "connexion de l'administrateur impossible"

# 3.a — la copie, faite par l'API, avec le jeton réel.
code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"track_id\":\"$TRACK_STUDIO\",\"new_name\":\"tst-crm032-copie\"}")
COPIE=$(jq -r 'if type == "string" then . else empty end' < "$CORPS")
if [ "$code" = "200" ] && [ -n "$COPIE" ]; then
	ok "ligne a — l'administrateur copie le workflow, et la fonction rend l'identifiant de la copie"
else
	fail "ligne a — code $code, corps « $(head -c 120 "$COPIE" 2>/dev/null || head -c 120 "$CORPS") »"
fi

mesure=$(psql_db -c "
	select (select count(*) from public.workflow_steps where workflow_id = '$COPIE')::text
	    || '/' || (select count(*) from public.workflow_transitions where workflow_id = '$COPIE')::text
	    || '/' || (select count(*) from public.workflow_steps
	                where workflow_id = '$COPIE' and is_initial)::text
	    || '/' || (select string_agg(position::text, ',' order by position)
	                 from public.workflow_steps where workflow_id = '$COPIE')
	    || '/' || (select is_default::text from public.workflows where id = '$COPIE')
	    || '/' || (select scope from public.workflows where id = '$COPIE');")
[ "$mesure" = "7/10/1/1,2,3,4,5,6,7/false/track" ] \
	&& ok "sept étapes, dix arêtes, une initiale, positions conservées, \`is_default\` forcé, portée \`track\`" \
	|| fail "contenu de la copie : « $mesure », attendu « 7/10/1/1,2,3,4,5,6,7/false/track »"

# 3.b — LE POINT CENTRAL : aucune arête ne sort de la copie.
hors=$(psql_db -c "
	select count(*) from public.workflow_transitions t
	 where t.workflow_id = '$COPIE'
	   and (t.from_step_id not in (select id from public.workflow_steps where workflow_id = '$COPIE')
	     or t.to_step_id   not in (select id from public.workflow_steps where workflow_id = '$COPIE'));")
[ "$hors" = "0" ] \
	&& ok "aucune arête de la copie ne pointe vers une étape de la source : le remappage est exact" \
	|| fail "$hors arête(s) de la copie pointent hors d'elle"

# 3.c — le graphe est bien le même, nœud pour nœud, et non seulement du même cardinal.
graphe=$(psql_db -c "
	with arcs as (
		select t.workflow_id,
		       nd.key || '>' || na.key as arc
		  from public.workflow_transitions t
		  join public.workflow_steps d on d.id = t.from_step_id
		  join public.workflow_steps a on a.id = t.to_step_id
		  join public.workflow_nodes_catalog nd on nd.id = d.node_id
		  join public.workflow_nodes_catalog na on na.id = a.node_id
		 where t.workflow_id in ('$WF_SEED', '$COPIE')
	)
	select (select string_agg(arc, ',' order by arc) from arcs where workflow_id = '$WF_SEED')
	     = (select string_agg(arc, ',' order by arc) from arcs where workflow_id = '$COPIE');")
[ "$graphe" = "t" ] \
	&& ok "le graphe de la copie est **identique** à celui de la source, nœud pour nœud" \
	|| fail "le graphe de la copie diffère de celui de la source"

# 3.d — les quatre refus, par l'API, avec les codes mesurés du §4.4.
code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"track_id\":\"$TRACK_STUDIO\"}")
message=$(jq -r '.message // empty' < "$CORPS")
reste=$(psql_db -c "select count(*) from public.workflows
                     where derived_from_workflow_id = '$WF_SEED' and track_id = '$TRACK_STUDIO';")
if [ "$code" = "403" ] && [ "$message" = "forbidden" ] && [ "$reste" = "1" ]; then
	ok "ligne c — PREUVE DE REFUS N° 2 : le business developer est refusé en 403 « forbidden », et "\
"aucune ligne de plus n'existe"
else
	fail "ligne c — code $code, message « $message », $reste copie(s) sur ce track"
fi

code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"track_id\":\"$TRACK_STUDIO\"}")
[ "$code" = "401" ] \
	&& ok "ligne e — l'anonyme est refusé en **401** par le privilège, avant tout contrôle (§4.4)" \
	|| fail "ligne e — code $code, attendu 401"

code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$COPIE\",\"track_id\":\"$TRACK_STUDIO\"}")
message=$(jq -r '.message // empty' < "$CORPS")
[ "$code" = "400" ] && [ "$message" = "workflow_not_global" ] \
	&& ok "ligne i — une copie ne se copie pas : 400 « workflow_not_global » (décision 85)" \
	|| fail "ligne i — code $code, message « $message »"

code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"track_id\":\"$TRACK_ARCHIVE\"}")
message=$(jq -r '.message // empty' < "$CORPS")
[ "$code" = "400" ] && [ "$message" = "track_not_found" ] \
	&& ok "ligne k — un track archivé est introuvable : 400 « track_not_found »" \
	|| fail "ligne k — code $code, message « $message »"

# 3.e — la règle de discrétion, éprouvée sur une ligne d'abord constatée présente.
psql_db -c "
	insert into public.workspaces (id, name, slug)
	values ('c0b1f000-0000-4000-8000-000000000001', 'Preuve CRM-032', 'tst-crm032-ws')
	on conflict (id) do nothing;
	insert into public.workflows (id, workspace_id, name)
	values ('c0b1f000-0000-4000-8000-000000000002', 'c0b1f000-0000-4000-8000-000000000001',
	        'tst-crm032-chez-b')
	on conflict (id) do nothing;" >/dev/null
presente=$(psql_db -c "select count(*) from public.workflows
                        where id = 'c0b1f000-0000-4000-8000-000000000002';")
code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"c0b1f000-0000-4000-8000-000000000002\",\"track_id\":\"$TRACK_STUDIO\"}")
message=$(jq -r '.message // empty' < "$CORPS")
if [ "$presente" = "1" ] && [ "$code" = "400" ] && [ "$message" = "workflow_not_found" ]; then
	ok "ligne f — RÈGLE DE DISCRÉTION : le workflow d'un autre workspace, **constaté présent**, "\
"rend « introuvable » et non « interdit » (décision 82)"
else
	fail "ligne f — présente=$presente, code $code, message « $message »"
fi
psql_db -c "delete from public.workflows where id = 'c0b1f000-0000-4000-8000-000000000002';
            delete from public.workspaces where id = 'c0b1f000-0000-4000-8000-000000000001';" \
	>/dev/null

titre "4. Le signalement de divergence"

vue=$(psql_db -c "select source_modified_since_copy from public.workflow_derivations
                   where workflow_id = '$COPIE';")
[ "$vue" = "f" ] \
	&& ok "la copie qui vient d'être faite n'affiche aucune divergence" \
	|| fail "divergence immédiate : « $vue », attendu « f »"

psql_db -c "update public.workflow_steps set label_override = 'tst-crm032-modifie'
             where workflow_id = '$WF_SEED' and position = 1;" >/dev/null
vue=$(psql_db -c "select source_modified_since_copy from public.workflow_derivations
                   where workflow_id = '$COPIE';")
[ "$vue" = "t" ] \
	&& ok "une **étape** de la source modifiée allume le signal — ce qu'un \`workflows.updated_at\` "\
"seul aurait manqué" \
	|| fail "le signal reste éteint après modification d'une étape : « $vue »"
psql_db -c "update public.workflow_steps set label_override = null
             where workflow_id = '$WF_SEED' and position = 1;" >/dev/null

titre "5. Le seed est convergent"

./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué"

copies=$(psql_db -c "select count(*) from public.workflows
                      where derived_from_workflow_id = '$WF_SEED' and track_id = '$TRACK_CONSEIL';")
[ "$copies" = "1" ] \
	&& ok "**une** copie sur le track « Conseil & IA », ni zéro ni deux : un second passage du seed "\
"ne recrée rien" \
	|| fail "copies sur le track du seed : $copies, attendu 1"

contenu=$(psql_db -c "
	select (select count(*) from public.workflow_steps s
	         where s.workflow_id = (select id from public.workflows
	                                 where derived_from_workflow_id = '$WF_SEED'
	                                   and track_id = '$TRACK_CONSEIL'))::text
	    || '/' || (select count(*) from public.workflow_transitions t
	                where t.workflow_id = (select id from public.workflows
	                                        where derived_from_workflow_id = '$WF_SEED'
	                                          and track_id = '$TRACK_CONSEIL'))::text
	    || '/' || (select name from public.workflows
	                where derived_from_workflow_id = '$WF_SEED' and track_id = '$TRACK_CONSEIL');")
[ "$contenu" = "7/10/Cycle commercial — Conseil IA" ] \
	&& ok "la copie du seed porte sept étapes, dix transitions, et le nom du §4.10" \
	|| fail "copie du seed : « $contenu »"

defauts=$(psql_db -c "select count(*) from public.workflows
                       where workspace_id = '$WS_SEED' and is_default;")
[ "$defauts" = "1" ] \
	&& ok "le workspace n'a toujours qu'**un** workflow par défaut, la copie n'en étant pas un" \
	|| fail "workflows par défaut : $defauts, attendu 1"

titre "6. INC-037 et INC-038 : deux absences, vérifiées comme le reste"

# Ces deux contrôles sont l'inverse de contrôles ordinaires : ils constatent que quelque chose
# **manque** toujours. Le jour où `CRM-035` livrera `form_fields`, le premier tombera — et c'est ce
# qu'on lui demande.
champs=$(psql_db -c "select coalesce(to_regclass('public.form_fields')::text, 'NULL');")
[ "$champs" = "NULL" ] \
	&& ok "INC-037 : \`form_fields\` n'existe toujours pas — la copie des champs reste due par \`CRM-035\`" \
	|| fail "INC-037 : \`form_fields\` existe désormais — la copie des champs doit être écrite"

# INC-038 : une suppression dans la source n'allume pas le signal. Éprouvé sur une arête d'essai
# ajoutée puis retirée, pour ne pas toucher au graphe du seed.
psql_db -c "
	update public.workflows set derived_at = now() where id = (select id from public.workflows
		where derived_from_workflow_id = '$WF_SEED' and track_id = '$TRACK_CONSEIL');
	insert into public.workflow_transitions (id, workflow_id, workspace_id, from_step_id, to_step_id, label)
	values ('c0b1f000-0000-4000-8000-00000000000f', '$WF_SEED', '$WS_SEED',
	        '5eed0000-0000-4000-8000-000000000066', '5eed0000-0000-4000-8000-000000000067',
	        'tst-crm032-arete');
	update public.workflows set derived_at = now() where id = (select id from public.workflows
		where derived_from_workflow_id = '$WF_SEED' and track_id = '$TRACK_CONSEIL');
	delete from public.workflow_transitions where id = 'c0b1f000-0000-4000-8000-00000000000f';
" >/dev/null
angle=$(psql_db -c "select source_modified_since_copy from public.workflow_derivations
                     where source_workflow_id = '$WF_SEED' and track_id = '$TRACK_CONSEIL';")
[ "$angle" = "f" ] \
	&& ok "INC-038 : une **suppression** dans la source laisse le signal éteint — angle mort mesuré, "\
"figé ici, et non confié à la mémoire" \
	|| fail "INC-038 : le signal détecte désormais une suppression — l'entrée doit être close"

titre "7. Non-complaisance : le harnais échoue-t-il quand le produit se dégrade ?"

# a. Le contrôle du rôle retiré de la fonction : le refus n° 2 doit cesser d'être opposé.
psql_db -c "
	create or replace function public.copy_workflow_to_track(
		workflow_id uuid, track_id uuid, new_name text default null
	) returns uuid language plpgsql security definer set search_path = '' as \$\$
	declare
		v_source uuid := workflow_id;
		v_track  uuid := track_id;
		v_copie  uuid;
	begin
		insert into public.workflows (workspace_id, name, scope, track_id,
		                              derived_from_workflow_id, derived_at, is_default)
		select w.workspace_id, 'tst-crm032-degrade', 'track', v_track, w.id, now(), false
		  from public.workflows w where w.id = v_source
		returning id into v_copie;
		return v_copie;
	end; \$\$;
	notify pgrst, 'reload schema';" >/dev/null
sleep 1
code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"track_id\":\"$TRACK_STUDIO\"}")
if [ "$code" = "200" ]; then
	ok "dégradation a : contrôle du rôle retiré, le business developer copie — le contrôle « ligne "\
"c » de la section 3 aurait échoué"
	psql_db -c "delete from public.workflows where name = 'tst-crm032-degrade';" >/dev/null
else
	fail "dégradation a : la fonction sans contrôle refuse encore ($code) — la garantie vient d'ailleurs"
fi

# b. Le privilège rendu à `anon` : le refus 401 doit disparaître.
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
psql_db -c "grant execute on function public.copy_workflow_to_track(uuid, uuid, text) to anon;
            notify pgrst, 'reload schema';" >/dev/null
sleep 1
code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"track_id\":\"$TRACK_STUDIO\"}")
if [ "$code" != "401" ]; then
	ok "dégradation b : privilège rendu à \`anon\`, le 401 disparaît (code $code) — le contrôle "\
"« ligne e » aurait échoué. C'est **exactement** le défaut d'origine de l'image (décision 80)"
else
	fail "dégradation b : l'anonyme obtient encore 401 malgré le privilège — le refus vient d'ailleurs"
fi

# c. La vue rendue `security_definer` : la RLS cesserait de s'appliquer à l'appelant.
psql_db -c "alter view public.workflow_derivations set (security_invoker = false);
            notify pgrst, 'reload schema';" >/dev/null
sleep 1
http GET "$API/rest/v1/workflow_derivations?select=workflow_id" -H "apikey: $ANON_KEY" >/dev/null
lignes=$(jq -r 'if type == "array" then length else -1 end' < "$CORPS")
if [ "$lignes" != "0" ]; then
	ok "dégradation c : vue en \`security_definer\`, l'anonyme voit $lignes ligne(s) — le contrôle "\
"« ligne n » aurait échoué, et la vue serait une porte dérobée"
else
	fail "dégradation c : l'anonyme ne voit toujours rien — le cloisonnement vient d'ailleurs"
fi

# d. Restauration **constatée**, et non supposée.
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué à la restauration"
sleep 1

restaure=$(psql_db -c "
	select has_function_privilege('anon', 'public.copy_workflow_to_track(uuid, uuid, text)',
	                              'EXECUTE')::text
	    || '/' || (select coalesce(c.reloptions::text, '-') from pg_class c
	                where c.oid = 'public.workflow_derivations'::regclass)
	    || '/' || (select count(*) from public.workflows
	                where derived_from_workflow_id = '$WF_SEED' and track_id = '$TRACK_CONSEIL')::text
	    || '/' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	                where n.nspname = 'public' and p.proname = 'copy_workflow_to_track'
	                  and pg_get_functiondef(p.oid) like '%is_workspace_admin%')::text;")
if [ "${restaure%%/*}" = "false" ] \
	&& printf '%s' "$restaure" | grep -q 'security_invoker=true' \
	&& [ "$(printf '%s' "$restaure" | rev | cut -d/ -f2 | rev)" = "1" ] \
	&& [ "${restaure##*/}" = "1" ]; then
	ok "restauration constatée : privilège de \`anon\` retiré, vue revenue à \`security_invoker\`, "\
"une seule copie du seed, et le contrôle du rôle **revenu dans la fonction**"
else
	fail "restauration incomplète : « $restaure »"
fi

code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"track_id\":\"$TRACK_STUDIO\"}")
[ "$code" = "403" ] && ok "et le refus est de nouveau opposé au business developer" \
	|| fail "après restauration, le business developer obtient encore $code"

titre "8. Suites, tests unitaires et build"

# Les copies d'essai sont retirées **avant** les suites : `e2e/api/copie-workflow.spec.ts` compte
# les lignes de `workflow_derivations`, et une copie laissée par la section 3 les fausserait. Le
# trap de sortie fait le même ménage, mais trop tard pour ces suites.
menage

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
