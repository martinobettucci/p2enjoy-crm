#!/usr/bin/env bash
# @verifies CRM-003 (docs/BACKLOG.md) — Definition of Done des migrations d'amorçage
# @verifies CRM-022 (docs/BACKLOG.md) — retour du contrat d'identité après l'amorçage
# @verifies docs/SCHEMA.md §1 (identité et cloisonnement)
# @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 3 et 11)
# @verifies docs/PROD_MIGRATIONS.md §3 (migrations en attente)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-003` :
#
#   1. la suite pgTAP `supabase/tests/0001_identite_et_cloisonnement.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      erreur ni effet de bord — exigence du `migrations-runner`, qui ne tient aucun registre ;
#   3. le trigger de création de profil fonctionne par le **véritable** chemin applicatif :
#      compte créé par l'API d'administration GoTrue, profil constaté par PostgREST ;
#   4. le refus anonyme reste réel et le contrat CRM-022 est mesuré **hors interface** avec un vrai
#      jeton : profil propre lisible, nom normalisé, locale protégée, workspace non créable et
#      schéma `app` injoignable par l'API ;
#   5. le harnais est **non complaisant** : chaque mutation volontaire de la structure le fait
#      échouer.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`). Toutes les mutations de l'étape 5 vivent dans une transaction annulée ; le
# compte de démonstration créé à l'étape 3 est supprimé en fin de parcours.
#
# Usage :
#   scripts/verify-migrations.sh

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE=supabase/tests/0001_identite_et_cloisonnement.test.sql
MIGRATION_FILE=supabase/migrations/0001_identite_et_cloisonnement.sql
DB_CONTAINER=p2enjoy-db
PREUVE_EMAIL="crm-003-preuve@exemple.test"

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

# `curl` sans `--fail` : le code de statut fait partie de ce qui est mesuré. Le corps et le code
# sont séparés par un marqueur, afin de ne dépendre d'aucun formatage de sortie.
http() {
	local method=$1 url=$2
	shift 2
	curl -s -o /tmp/p2enjoy-http-body -w '%{http_code}' -X "$method" "$url" "$@"
}
http_body() { cat /tmp/p2enjoy-http-body; }

decoder_jwt() {
	local charge
	charge=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+')
	case $(( ${#charge} % 4 )) in
		2) charge="${charge}==" ;;
		3) charge="${charge}=" ;;
	esac
	printf '%s' "$charge" | base64 -d 2>/dev/null
}

echo
echo "Preuves de CRM-003 — migrations d'amorçage"
echo

# --- 1. Suite pgTAP ----------------------------------------------------------------------------

echo "1. Suite pgTAP"

if ! docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

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
# Le `migrations-runner` livré par `CRM-001` rejoue tout le répertoire à chaque démarrage : une
# migration non rejouable bloquerait PostgREST, qui attend sa terminaison réussie.

echo
echo "2. Rejouabilité de la migration"

empreinte_schema() {
	psql_db -c "
		select string_agg(t, e'\n' order by t) from (
			select c.relname || ':' || a.attname || ':' || format_type(a.atttypid, a.atttypmod)
			       || ':' || a.attnotnull as t
			  from pg_class c
			  join pg_namespace n on n.oid = c.relnamespace
			  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
			 where n.nspname = 'public'
			   and c.relname in ('profiles','workspaces','workspace_members',
			                     'track_members','channel_members')
		) s;"
}

avant=$(empreinte_schema)

if docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres --no-psqlrc --quiet \
	--set ON_ERROR_STOP=1 --single-transaction -f - < "$MIGRATION_FILE" >/tmp/p2enjoy-replay.log 2>&1
then
	ok "la migration se réapplique sans erreur sur une base déjà migrée"
else
	fail "la migration échoue à la réapplication (voir /tmp/p2enjoy-replay.log)"
	tail -5 /tmp/p2enjoy-replay.log | sed 's/^/        /'
fi

apres=$(empreinte_schema)
if [ "$avant" = "$apres" ]; then
	ok "la réapplication ne modifie pas la structure des cinq tables"
else
	fail "la structure a changé après réapplication de la migration"
fi

# Le conteneur d'application des migrations doit lui aussi se terminer avec le code 0.
#
# CORRIGÉ À CRM-022 : `up -d` rend la main au DÉMARRAGE, et l'inspection immédiate relisait le
# code de l'exécution précédente. Les appels API ci-dessous partaient alors pendant le rejeu :
# entre 0001 et 0021, `authenticated` retrouvait temporairement UPDATE sur tout `profiles`, et le
# harnais a réellement modifié `locale` en HTTP 204. `run --rm` attend l'exécution qu'il lance et
# relaie son propre code ; aucune mesure ne commence sur une base intermédiaire.
if docker compose -f docker-compose.yml -f docker-compose.dev.yml \
	run --rm migrations-runner >/tmp/p2enjoy-runner.log 2>&1
then
	ok "le migrations-runner rejoue tout le répertoire et se termine avec le code 0"
else
	fail "migrations-runner s'est terminé avec un code non nul"
	tail -10 /tmp/p2enjoy-runner.log | sed 's/^/        /'
fi

# --- 3. Le trigger par le véritable chemin applicatif ------------------------------------------
# Aucune insertion directe dans `auth.users` ici : le compte est créé par l'API d'administration
# GoTrue, c'est-à-dire par le mécanisme que le produit utilisera réellement (`CLAUDE.md` §8).

echo
echo "3. Création de profil par l'API d'administration GoTrue"

# Ménage préalable : un compte de preuve resté d'une exécution interrompue est supprimé.
ancien=$(curl -s "$API/auth/v1/admin/users?page=1&per_page=200" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
	| jq -r --arg m "$PREUVE_EMAIL" '.users[]? | select(.email == $m) | .id' | head -n 1)
if [ -n "$ancien" ]; then
	curl -s -o /dev/null -X DELETE "$API/auth/v1/admin/users/$ancien" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
fi

MOT_DE_PASSE="preuve-crm003-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"

code=$(http POST "$API/auth/v1/admin/users" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
	-H 'Content-Type: application/json' \
	-d "{\"email\":\"$PREUVE_EMAIL\",\"password\":\"$MOT_DE_PASSE\",\"email_confirm\":true,
	     \"user_metadata\":{\"full_name\":\"Preuve CRM-003\",\"locale\":\"fr\"}}")
USER_ID=$(http_body | jq -r '.id // empty')

if [ "$code" = 200 ] && [ -n "$USER_ID" ]; then
	ok "compte créé par GoTrue (HTTP $code), identifiant $USER_ID"
else
	fail "création du compte refusée par GoTrue (HTTP $code) : $(http_body | head -c 200)"
fi

nettoyer() {
	[ -n "${USER_ID:-}" ] || return 0
	curl -s -o /dev/null -X DELETE "$API/auth/v1/admin/users/$USER_ID" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" || true
}
trap nettoyer EXIT

code=$(http GET "$API/rest/v1/profiles?id=eq.$USER_ID&select=id,full_name,locale" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
nom=$(http_body | jq -r '.[0].full_name // empty')
langue=$(http_body | jq -r '.[0].locale // empty')

if [ "$code" = 200 ] && [ "$nom" = "Preuve CRM-003" ] && [ "$langue" = "fr" ]; then
	ok "le profil correspondant existe, avec le nom et la langue des métadonnées"
else
	fail "profil introuvable ou incorrect (HTTP $code) : $(http_body | head -c 200)"
fi

# --- 4. Contrats d'identité, mesurés hors interface --------------------------------------------
# `docs/SPEC-permissions-rls.md` §7 : le refus anonyme reste zéro ligne. CRM-022 rend en revanche
# le profil propre lisible et ses seules colonnes éditables modifiables.

echo
echo "4. Refus anonyme et profil propre (contrat CRM-022)"

# 4.1 Anonyme — preuve de refus n° 11
for table in profiles workspaces workspace_members track_members channel_members; do
	code=$(http GET "$API/rest/v1/$table?select=*" -H "apikey: $ANON_KEY")
	corps=$(http_body)
	if [ "$code" = 200 ] && [ "$corps" = "[]" ]; then
		ok "anonyme sur $table : HTTP 200 et zéro ligne, pas une erreur"
	else
		fail "anonyme sur $table : HTTP $code, corps $(printf '%s' "$corps" | head -c 120)"
	fi
done

# 4.2 Compte authentifié réel — le jeton est obtenu par la véritable route de connexion.
code=$(http POST "$API/auth/v1/token?grant_type=password" \
	-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
	-d "{\"email\":\"$PREUVE_EMAIL\",\"password\":\"$MOT_DE_PASSE\"}")
JETON=$(http_body | jq -r '.access_token // empty')

if [ "$code" = 200 ] && [ -n "$JETON" ]; then
	role_jeton=$(decoder_jwt "$JETON" | jq -r '.role // empty')
	if [ "$role_jeton" = authenticated ]; then
		ok "connexion du compte de preuve : jeton d'accès authenticated obtenu"
	else
		fail "connexion obtenue avec un rôle JWT inattendu : « $role_jeton »"
	fi
else
	fail "connexion refusée (HTTP $code) : $(http_body | head -c 200)"
fi

if [ -n "${JETON:-}" ]; then
	code=$(http GET "$API/rest/v1/profiles?select=id,full_name,locale&id=eq.$USER_ID" \
		-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON")
	corps=$(http_body)
	if [ "$code" = 200 ] && [ "$(printf '%s' "$corps" | jq -r '.[0].full_name // empty')" = "Preuve CRM-003" ]; then
		ok "compte authentifié : son propre profil est lisible, exactement comme CRM-022 le consent"
	else
		fail "profil propre illisible ou incorrect : HTTP $code, corps $(printf '%s' "$corps" | head -c 120)"
	fi

	code=$(http POST "$API/rest/v1/workspaces" \
		-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON" \
		-H 'Content-Type: application/json' -H 'Prefer: return=representation' \
		-d '{"name":"Tentative","slug":"tentative-crm003"}')
	if [ "$code" != 201 ] && [ "$code" != 200 ]; then
		ok "compte authentifié : création de workspace refusée (HTTP $code)"
	else
		fail "une écriture a été acceptée alors qu'aucune politique ne l'autorise (HTTP $code)"
	fi

	code=$(http PATCH "$API/rest/v1/profiles?id=eq.$USER_ID" \
		-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON" \
		-H 'Content-Type: application/json' -H 'Prefer: return=representation' \
		-d '{"full_name":"  Profil édité  "}')
	corps=$(http_body)
	if [ "$code" = 200 ] && [ "$(printf '%s' "$corps" | jq -r '.[0].full_name // empty')" = "Profil édité" ]; then
		ok "compte authentifié : son nom est modifié et normalisé par la base"
	else
		fail "modification du profil propre refusée ou non normalisée (HTTP $code) : $(printf '%s' "$corps" | head -c 120)"
	fi

	code=$(http PATCH "$API/rest/v1/profiles?id=eq.$USER_ID" \
		-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON" \
		-H 'Content-Type: application/json' \
		-d '{"locale":"en"}')
	code_lecture_locale=$(http GET "$API/rest/v1/profiles?id=eq.$USER_ID&select=locale" \
		-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
	locale_reelle=$(http_body | jq -r '.[0].locale // empty')
	if [ "$code" = 403 ] && [ "$code_lecture_locale" = 200 ] && [ "$locale_reelle" = fr ]; then
		ok "compte authentifié : locale reste protégée par le privilège de colonne (HTTP 403)"
	else
		fail "PATCH locale HTTP $code ; valeur réellement relue « $locale_reelle » (attendu : refus 403 et fr)"
	fi
fi

# 4.3 Le schéma `app` n'est pas exposé par PostgREST.
code=$(http POST "$API/rest/v1/rpc/handle_new_user" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
	-H 'Content-Type: application/json' -d '{}')
if [ "$code" -ge 400 ]; then
	ok 'le schéma app n'\''est pas joignable par l'\''API REST (HTTP '"$code"')'
else
	fail 'une fonction du schéma app est exposée par PostgREST (HTTP '"$code"')'
fi

# 4.4 Suppression du compte : la session ouverte par cette preuve est d'abord fermée par la vraie
# route. Supprimer simultanément l'utilisateur et sa session peut mettre GoTrue en deadlock ; ce
# n'est ni un parcours utilisateur cohérent, ni une propriété de cascade à mesurer ici.
code=$(http POST "$API/auth/v1/logout" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $JETON")
if [ "$code" = 204 ]; then
	ok "la session de preuve est fermée avant suppression du compte"
else
	fail "déconnexion de la session de preuve refusée (HTTP $code)"
fi

code_suppression=$(http DELETE "$API/auth/v1/admin/users/$USER_ID" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
code=$(http GET "$API/rest/v1/profiles?id=eq.$USER_ID&select=id" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY")
if [ "$code_suppression" = 200 ] && [ "$code" = 200 ] && [ "$(http_body)" = "[]" ]; then
	ok "la suppression du compte par GoTrue supprime le profil (HTTP $code_suppression)"
else
	fail "suppression GoTrue HTTP $code_suppression ; profil relu HTTP $code : $(http_body | head -c 120)"
fi
USER_ID=""

# --- 5. Non-complaisance du harnais ------------------------------------------------------------
# Chaque mutation est injectée **dans la transaction de la suite pgTAP**, qui se termine par un
# `rollback` : la base n'en conserve rien. Le fichier de test est réutilisé tel quel, sa première
# ligne `begin;` étant remplacée par `begin;` suivi de la mutation.

echo
echo "5. Non-complaisance : chaque mutation doit faire échouer la suite"

suite_mutee() {
	local mutation=$1
	{
		printf 'begin;\n%s\n' "$mutation"
		awk 'f { print } /^begin;$/ { f = 1 }' "$TEST_FILE"
	} | psql_db -f - 2>&1 || true
}

verifier_mutation() {
	local libelle=$1 mutation=$2 sortie ko erreurs

	# La mutation est d'abord appliquée seule, dans une transaction annulée, avec arrêt à la
	# première erreur : une mutation qui ne s'applique pas ferait échouer la suite pour la
	# mauvaise raison, et la non-complaisance serait constatée à tort.
	if ! printf 'begin;\n%s\nrollback;\n' "$mutation" \
		| psql_db -v ON_ERROR_STOP=1 -f - >/tmp/p2enjoy-mutation.log 2>&1
	then
		fail "$libelle : la mutation elle-même ne s'applique pas — contrôle non concluant"
		tail -3 /tmp/p2enjoy-mutation.log | sed 's/^/        /'
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

verifier_mutation "trigger de création de profil retiré" \
	"drop trigger on_auth_user_created on auth.users;"

verifier_mutation "RLS désactivée sur profiles" \
	"alter table public.profiles disable row level security;"

verifier_mutation "politique permissive ajoutée sur workspaces" \
	"create policy tst_permissive on public.workspaces for select to authenticated using (true);"

verifier_mutation "SELECT retiré à anon sur profiles" \
	"revoke select on public.profiles from anon;"

verifier_mutation "contrainte de rôle relâchée" \
	"alter table public.workspace_members drop constraint workspace_members_role_check;"

verifier_mutation "cascade de suppression du profil retirée" \
	"alter table public.profiles drop constraint profiles_id_fkey;
	 alter table public.profiles add constraint profiles_id_fkey
	   foreign key (id) references auth.users (id);"

# --- Bilan -------------------------------------------------------------------------------------

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
	exit 0
fi

printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
exit 1
