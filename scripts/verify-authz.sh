#!/usr/bin/env bash
# @verifies CRM-010 (docs/BACKLOG.md) — Definition of Done des fonctions d'autorisation
# @verifies docs/SPEC-permissions-rls.md §2 (rôles et droits fins), §3 (fonctions), §7 (preuves)
# @verifies docs/SCHEMA.md §9 (fonctions et RPC)
# @verifies docs/PROD_MIGRATIONS.md §3 (migrations en attente)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-010` :
#
#   1. la suite pgTAP `supabase/tests/0002_fonctions_autorisation.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier la définition des fonctions, et le `migrations-runner` rejoue le répertoire
#      complet en se terminant avec le code 0 ;
#   3. les fonctions se comportent comme spécifié **hors interface**, sous PostgREST, avec les
#      jetons réels de trois profils distincts obtenus par la véritable route de connexion ;
#   4. le harnais est **non complaisant** : chaque affaiblissement volontaire le fait échouer.
#
# ---------------------------------------------------------------------------------------------
# Instrumentation de l'étape 3, et pourquoi elle est nécessaire.
# ---------------------------------------------------------------------------------------------
# Le schéma `app` n'est pas exposé par PostgREST : ces fonctions ne sont appelables ni en RPC ni
# par aucune route. Et `CRM-010` ne livre volontairement aucune politique — c'est l'objet de
# `CRM-012`. Sans instrumentation, leur comportement réel sous un vrai jeton ne serait donc
# observable par aucun chemin, et la preuve se réduirait à ce que pgTAP mesure déjà en base.
#
# Le script pose donc **temporairement** deux politiques sur `public.workspaces`, adossées aux
# fonctions livrées, interroge l'API avec de vrais jetons, puis les retire et **vérifie qu'il n'en
# reste aucune**. C'est le « chemin déterministe » prévu par `CLAUDE.md` §15 pour un comportement
# non directement observable, et non un contournement : ce sont bien les fonctions livrées, sous
# PostgREST, avec des jetons émis par GoTrue.
#
# Ces politiques sont nommées `tst_crm010_*`, retirées par un `trap` même en cas d'interruption,
# et n'existent dans aucune migration. Le script refuse de se terminer proprement s'il en reste.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`). Les comptes créés à l'étape 3 sont supprimés en sortant.
#
# Usage :
#   scripts/verify-authz.sh

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE=supabase/tests/0002_fonctions_autorisation.test.sql
MIGRATION_FILE=supabase/migrations/0002_fonctions_autorisation.sql
DB_CONTAINER=p2enjoy-db

WS_UN=00000000-0000-4000-9000-000000000a01
WS_DEUX=00000000-0000-4000-9000-000000000a02
MAIL_ANNE=crm-010-anne@exemple.test
MAIL_CHLOE=crm-010-chloe@exemple.test
MAIL_DAVID=crm-010-david@exemple.test

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
SERVICE_ROLE_KEY=$(require_env SERVICE_ROLE_KEY)
API="http://127.0.0.1:${KONG_HTTP_PORT}"

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

http() {
	local method=$1 url=$2
	shift 2
	curl -s -o /tmp/p2enjoy-authz-body -w '%{http_code}' -X "$method" "$url" "$@"
}
http_body() { cat /tmp/p2enjoy-authz-body; }

supprimer_compte_par_email() {
	local mail=$1 id
	id=$(curl -s "$API/auth/v1/admin/users?page=1&per_page=200" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		| jq -r --arg m "$mail" '.users[]? | select(.email == $m) | .id' | head -n 1)
	if [ -n "$id" ]; then
		curl -s -o /dev/null -X DELETE "$API/auth/v1/admin/users/$id" \
			-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" || true
	fi
}

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser une politique
# instrumentée ni un workspace de preuve derrière elle.
menage() {
	psql_db -c "
		drop policy if exists tst_crm010_ws_select on public.workspaces;
		drop policy if exists tst_crm010_ws_update on public.workspaces;
		delete from public.workspaces where id in ('$WS_UN', '$WS_DEUX');
	" >/dev/null 2>&1 || true
	supprimer_compte_par_email "$MAIL_ANNE"
	supprimer_compte_par_email "$MAIL_CHLOE"
	supprimer_compte_par_email "$MAIL_DAVID"
}
trap menage EXIT

echo
echo "Preuves de CRM-010 — fonctions d'autorisation"
echo

if ! docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

# --- 1. Suite pgTAP ----------------------------------------------------------------------------

echo "1. Suite pgTAP"

tap_output=$(psql_db -v ON_ERROR_STOP=1 -f - < "$TEST_FILE" 2>&1 || true)
tap_ok=$(printf '%s\n' "$tap_output" | grep -cE '^ok ' || true)
tap_ko=$(printf '%s\n' "$tap_output" | grep -cE '^not ok ' || true)
tap_plan=$(printf '%s\n' "$tap_output" | grep -cE '^# Looks like you planned' || true)

if [ "$tap_ko" -eq 0 ] && [ "$tap_ok" -gt 0 ] && [ "$tap_plan" -eq 0 ]; then
	ok "$TEST_FILE : $tap_ok assertions, aucune anomalie"
else
	fail "$TEST_FILE : $tap_ok réussies, $tap_ko échouées, écart de plan=$tap_plan"
	printf '%s\n' "$tap_output" | grep -E '^(not ok|# )' | sed 's/^/        /'
fi

# --- 2. Rejouabilité de la migration -----------------------------------------------------------

echo
echo "2. Rejouabilité de la migration"

empreinte_fonctions() {
	psql_db -c "
		select string_agg(d, e'\n' order by d) from (
			select pg_get_functiondef(p.oid) || '|' || p.prosecdef::text
			       || '|' || p.provolatile::text
			       || '|' || coalesce(array_to_string(p.proconfig, ','), '')
			       || '|' || coalesce(array_to_string(p.proacl, ','), '') as d
			  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'app'
		) s;"
}

avant=$(empreinte_fonctions)

if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres --no-psqlrc --quiet \
	--set ON_ERROR_STOP=1 --single-transaction -f - < "$MIGRATION_FILE" \
	>/tmp/p2enjoy-authz-replay.log 2>&1
then
	ok "la migration se réapplique sans erreur sur une base déjà migrée"
else
	fail "la migration échoue à la réapplication (voir /tmp/p2enjoy-authz-replay.log)"
	tail -5 /tmp/p2enjoy-authz-replay.log | sed 's/^/        /'
fi

apres=$(empreinte_fonctions)
if [ "$avant" = "$apres" ]; then
	ok "la réapplication ne modifie ni la définition, ni la volatilité, ni les droits des fonctions"
else
	fail "la définition ou les droits des fonctions ont changé après réapplication"
fi

docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d migrations-runner \
	>/tmp/p2enjoy-authz-runner.log 2>&1 || true
runner_code=$(docker inspect -f '{{.State.ExitCode}}' p2enjoy-migrations 2>/dev/null || echo -1)
if [ "$runner_code" = 0 ]; then
	ok "le conteneur migrations-runner rejoue les deux migrations et se termine avec le code 0"
else
	fail "migrations-runner s'est terminé avec le code $runner_code"
	docker logs p2enjoy-migrations 2>&1 | tail -10 | sed 's/^/        /'
fi

# --- 3. Comportement réel sous PostgREST, avec des jetons réels ---------------------------------

echo
echo "3. Sous PostgREST, avec les jetons réels de trois profils"

menage

creer_compte() {
	local mail=$1 nom=$2 code
	code=$(http POST "$API/auth/v1/admin/users" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
		-H 'Content-Type: application/json' \
		-d "{\"email\":\"$mail\",\"password\":\"$MOT_DE_PASSE\",\"email_confirm\":true,
		     \"user_metadata\":{\"full_name\":\"$nom\"}}")
	if [ "$code" != 200 ]; then
		echo "ERREUR : création du compte $mail refusée (HTTP $code) : $(http_body | head -c 200)" >&2
		exit 1
	fi
	http_body | jq -r '.id'
}

jeton_de() {
	local mail=$1 code
	code=$(http POST "$API/auth/v1/token?grant_type=password" \
		-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
		-d "{\"email\":\"$mail\",\"password\":\"$MOT_DE_PASSE\"}")
	if [ "$code" != 200 ]; then
		echo "ERREUR : connexion de $mail refusée (HTTP $code)" >&2
		exit 1
	fi
	http_body | jq -r '.access_token'
}

MOT_DE_PASSE="preuve-crm010-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"

ID_ANNE=$(creer_compte "$MAIL_ANNE"  'Anne Admin CRM-010')
ID_CHLOE=$(creer_compte "$MAIL_CHLOE" 'Chloé Viewer CRM-010')
ID_DAVID=$(creer_compte "$MAIL_DAVID" 'David Autre CRM-010')
ok "trois comptes créés par l'API d'administration GoTrue, profils créés par le trigger de CRM-003"

# Les workspaces et les appartenances sont posés en SQL : aucune politique n'autorise encore leur
# création par l'API, c'est précisément l'objet de `CRM-012`. Le fait est nommé, pas masqué.
psql_db -v ON_ERROR_STOP=1 -c "
	insert into public.workspaces (id, name, slug) values
		('$WS_UN',   'Preuve CRM-010 — un',   'crm010-un'),
		('$WS_DEUX', 'Preuve CRM-010 — deux', 'crm010-deux');
	insert into public.workspace_members (workspace_id, user_id, role) values
		('$WS_UN',   '$ID_ANNE',  'admin'),
		('$WS_UN',   '$ID_CHLOE', 'viewer'),
		('$WS_DEUX', '$ID_DAVID', 'admin');
" >/dev/null

JETON_ANNE=$(jeton_de "$MAIL_ANNE")
JETON_CHLOE=$(jeton_de "$MAIL_CHLOE")
JETON_DAVID=$(jeton_de "$MAIL_DAVID")
ok "trois jetons d'accès obtenus par la véritable route de connexion"

# 3.1 Avant toute politique : le refus par défaut de `CRM-003` est intact, y compris pour un
#     administrateur. Les fonctions seules n'ouvrent rien.
code=$(http GET "$API/rest/v1/workspaces?select=slug" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON_ANNE")
if [ "$code" = 200 ] && [ "$(http_body)" = "[]" ]; then
	ok "sans politique, l'administratrice ne voit rien : CRM-010 n'ouvre aucun accès par lui-même"
else
	fail "lecture inattendue avant instrumentation (HTTP $code) : $(http_body | head -c 120)"
fi

# 3.2 Politiques instrumentées, adossées aux fonctions livrées.
psql_db -v ON_ERROR_STOP=1 -c "
	create policy tst_crm010_ws_select on public.workspaces
		for select to authenticated using (app.is_workspace_member(id));
	create policy tst_crm010_ws_update on public.workspaces
		for update to authenticated
		using (app.is_workspace_admin(id)) with check (app.is_workspace_admin(id));
" >/dev/null
ok "politiques d'instrumentation posées : lecture par is_workspace_member, écriture par is_workspace_admin"

lecture_slugs() {
	http GET "$API/rest/v1/workspaces?select=slug&order=slug" \
		-H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" >/dev/null
	http_body | jq -rc '[.[].slug]'
}

for couple in "Anne:$JETON_ANNE:[\"crm010-un\"]" \
              "Chloé:$JETON_CHLOE:[\"crm010-un\"]" \
              "David:$JETON_DAVID:[\"crm010-deux\"]"; do
	nom=${couple%%:*}
	reste=${couple#*:}
	jeton=${reste%%:*}
	attendu=${reste#*:}
	obtenu=$(lecture_slugs "$jeton")
	if [ "$obtenu" = "$attendu" ]; then
		ok "$nom ne voit que son workspace : $obtenu"
	else
		fail "$nom voit $obtenu au lieu de $attendu"
	fi
done

# Preuve n° 11 de docs/SPEC-permissions-rls.md §7 : l'anonyme n'obtient pas une erreur, mais zéro
# ligne — même une fois la politique posée, puisque `auth.uid()` est nul.
code=$(http GET "$API/rest/v1/workspaces?select=slug" -H "apikey: $ANON_KEY")
if [ "$code" = 200 ] && [ "$(http_body)" = "[]" ]; then
	ok "anonyme : HTTP 200 et zéro ligne, pas une erreur de privilège (preuve n° 11)"
else
	fail "anonyme : HTTP $code, corps $(http_body | head -c 120)"
fi

# 3.3 Écriture : `is_workspace_admin` distingue réellement les profils.
code=$(http PATCH "$API/rest/v1/workspaces?id=eq.$WS_UN" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON_ANNE" \
	-H 'Content-Type: application/json' -H 'Prefer: return=representation' \
	-d '{"name":"Renommé par l'\''administratrice"}')
if [ "$code" = 200 ] && [ "$(http_body | jq 'length')" = 1 ]; then
	ok "Anne, administratrice, modifie son workspace (HTTP $code, 1 ligne)"
else
	fail "modification par l'administratrice refusée (HTTP $code) : $(http_body | head -c 160)"
fi

code=$(http PATCH "$API/rest/v1/workspaces?id=eq.$WS_UN" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON_CHLOE" \
	-H 'Content-Type: application/json' -H 'Prefer: return=representation' \
	-d '{"name":"Tentative viewer"}')
if [ "$(http_body)" = "[]" ] || [ "$code" -ge 400 ]; then
	ok "Chloé, viewer, ne peut pas modifier le workspace (HTTP $code, aucune ligne touchée)"
else
	fail "un viewer a modifié le workspace (HTTP $code) : $(http_body | head -c 160)"
fi

nom_reel=$(psql_db -c "select name from public.workspaces where id = '$WS_UN';")
if [ "$nom_reel" = "Renommé par l'administratrice" ]; then
	ok "la base porte bien la valeur écrite par l'administratrice, pas celle du viewer"
else
	fail "valeur inattendue en base : « $nom_reel »"
fi

# Preuve n° 3 de §7, au niveau du workspace : administrateur ailleurs n'est administrateur de rien
# ici. La cible est un workspace que David ne voit même pas en lecture.
code=$(http PATCH "$API/rest/v1/workspaces?id=eq.$WS_UN" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON_DAVID" \
	-H 'Content-Type: application/json' -H 'Prefer: return=representation' \
	-d '{"name":"Tentative transverse"}')
if [ "$(http_body)" = "[]" ] || [ "$code" -ge 400 ]; then
	ok "David, administrateur du workspace 2, ne modifie pas le workspace 1 (preuve n° 3)"
else
	fail "un administrateur d'un autre workspace a écrit ici (HTTP $code)"
fi

# 3.4 Révocation immédiate : le jeton de Chloé reste valide, son appartenance disparaît.
psql_db -v ON_ERROR_STOP=1 -c "
	delete from public.workspace_members
	 where workspace_id = '$WS_UN' and user_id = '$ID_CHLOE';" >/dev/null

obtenu=$(lecture_slugs "$JETON_CHLOE")
if [ "$obtenu" = "[]" ]; then
	ok "appartenance retirée : le même jeton, non expiré, ne donne plus aucun accès"
else
	fail "après révocation, Chloé voit encore $obtenu"
fi

# 3.5 Retrait de l'instrumentation, et vérification qu'il n'en reste rien.
psql_db -v ON_ERROR_STOP=1 -c "
	drop policy tst_crm010_ws_select on public.workspaces;
	drop policy tst_crm010_ws_update on public.workspaces;" >/dev/null

# RÉVISÉ À `CRM-012`, non retiré. Ce contrôle portait sur cinq tables et exigeait zéro politique.
# `CRM-012` en a légitimement posé quatre sur `track_members` et quatre sur `channel_members`
# (docs/SPEC-permissions-rls.md §4.1) : il est devenu rouge, comme la décision 51 l'attendait.
# Il est restreint aux trois tables d'**identité**, les seules dont le refus par défaut de
# `CRM-003` soit encore la règle — INC-014 restant ouverte. Ce qu'il prouve est inchangé :
# l'instrumentation posée par ce harnais ne laisse aucune trace.
restantes=$(psql_db -c "
	select count(*) from pg_policies
	 where schemaname = 'public'
	   and tablename in ('profiles','workspaces','workspace_members');")
if [ "$restantes" = 0 ]; then
	ok "aucune politique d'instrumentation ne subsiste sur les tables d'identité : la base retrouve exactement l'état livré par CRM-003"
else
	fail "$restantes politique(s) subsistent après le retrait de l'instrumentation"
fi

obtenu=$(lecture_slugs "$JETON_ANNE")
if [ "$obtenu" = "[]" ]; then
	ok "refus par défaut restauré : l'administratrice ne voit de nouveau rien"
else
	fail "l'instrumentation a laissé un accès ouvert : Anne voit $obtenu"
fi

# --- 4. Non-complaisance du harnais ------------------------------------------------------------
# Chaque affaiblissement est injecté **dans la transaction de la suite pgTAP**, qui se termine par
# un `rollback` : la base n'en conserve rien.

echo
echo "4. Non-complaisance : chaque affaiblissement doit faire échouer la suite"

suite_mutee() {
	local mutation=$1
	{
		printf 'begin;\n%s\n' "$mutation"
		awk 'f { print } /^begin;$/ { f = 1 }' "$TEST_FILE"
	} | psql_db -f - 2>&1 || true
}

verifier_mutation() {
	local libelle=$1 mutation=$2 sortie ko erreurs

	if ! printf 'begin;\n%s\nrollback;\n' "$mutation" \
		| psql_db -v ON_ERROR_STOP=1 -f - >/tmp/p2enjoy-authz-mutation.log 2>&1
	then
		fail "$libelle : la mutation elle-même ne s'applique pas — contrôle non concluant"
		tail -3 /tmp/p2enjoy-authz-mutation.log | sed 's/^/        /'
		return
	fi

	sortie=$(suite_mutee "$mutation")
	ko=$(printf '%s\n' "$sortie" | grep -cE '^not ok ' || true)
	erreurs=$(printf '%s\n' "$sortie" | grep -cE '^psql:.*ERROR' || true)

	if [ "$ko" -gt 0 ]; then
		ok "$libelle : $ko assertion(s) en échec, comme attendu"
	elif [ "$erreurs" -gt 0 ]; then
		ok "$libelle : la suite s'interrompt sur erreur ($erreurs), comme attendu"
	else
		fail "$libelle : la suite reste verte — elle ne prouve donc rien"
	fi
}

verifier_mutation "is_workspace_member repassée en SECURITY INVOKER" \
	"alter function app.is_workspace_member(uuid) security invoker;"

verifier_mutation "search_path relâché sur is_workspace_admin" \
	"alter function app.is_workspace_admin(uuid) reset search_path;"

verifier_mutation "resolve_access autorise tout" \
	"create or replace function app.resolve_access(ws_role text, track_access text,
	   channel_access text) returns text language sql immutable security invoker
	   set search_path = '' as 'select ''write''';"

verifier_mutation "un administrateur devient restreignable par un droit fin" \
	"create or replace function app.resolve_access(ws_role text, track_access text,
	   channel_access text) returns text language sql immutable security invoker
	   set search_path = '' as \$fn\$
	     select case
	       when ws_role is null then 'none'
	       when coalesce(channel_access, track_access) is not null then
	         case coalesce(channel_access, track_access)
	           when 'member' then 'write' when 'viewer' then 'read' else 'none' end
	       when ws_role in ('admin','business_developer') then 'write'
	       when ws_role = 'viewer' then 'read'
	       else 'none' end;
	   \$fn\$;"

verifier_mutation "EXECUTE retiré à anon sur is_workspace_member" \
	"revoke execute on function app.is_workspace_member(uuid) from anon;"

verifier_mutation "politique permissive ajoutée sur workspaces" \
	"create policy tst_permissive on public.workspaces for select to authenticated using (true);"

# RÉVISÉ À `CRM-012`. Cette garde créait `app.can_read_track` pour vérifier que la suite `0002`
# refuserait une des quatre fonctions différées apparue sans que ses preuves soient étendues. Les
# trois fonctions de track et de channel sont livrées depuis `CRM-012` : la mutation ne s'applique
# plus, la fonction existant déjà. Elle est **reportée sur la seule qui reste différée**,
# `app.can_read_card`, dont la suite `0002` constate toujours l'absence (INC-013). L'intention est
# identique, la cible a suivi le produit.
verifier_mutation "can_read_card créée sans étendre les preuves (garde INC-013)" \
	"create function app.can_read_card(card uuid) returns boolean language sql stable
	   security definer set search_path = '' as 'select true';"

# --- Bilan -------------------------------------------------------------------------------------

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
	exit 0
fi

printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
exit 1
