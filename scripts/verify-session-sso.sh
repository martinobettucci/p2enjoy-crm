#!/usr/bin/env bash
# @verifies CRM-092 (docs/BACKLOG.md) — le SSO, seule source d'identité : harnais de l'unité
# @verifies docs/SPEC-session-sso.md §7.1 (fonctions auth.*), §7.2 (modèle), §10 (realm préchargé),
#           §13 (preuves), §14 (T1, T2, T6), §7.5 (migration 0077), §2 (ce qui est retiré)
# @verifies docs/JOURNAL.md décisions 580 (K11, K12), 581 (migration élevée, harnais de l'unité),
#           586 (client serveur, T3 bis), 587 (aucune session : `204`), 589 (retrait de GoTrue, T6),
#           593 (INC-249 : l'admission patiente, migration 0078)
# @verifies CLAUDE.md §15 (tests non complaisants), §18 (un défaut se reproduit avant sa correction)
#
# Harnais de `CRM-092`, qui grandit à chaque tranche (décision 581). Tranche T1 :
#
#   1. BASE NEUVE, SANS GoTrue : un cluster `supabase/postgres` jetable, sans réseau. Le témoin
#      reproduit K11 — `auth.uid()` rend NULL sous `request.jwt.claims` — AVANT la migration 0074 ;
#      après elle, rejouée deux fois, il rend le `sub`, et le propriétaire reste celui de GoTrue ;
#   2. BASE DE DÉVELOPPEMENT : 0074 puis 0075 rejouées deux fois chacune, sous leur rôle ;
#   3. la suite pgTAP de l'unité, verte à son nombre exact d'assertions ;
#   4. NON-COMPLAISANCE : quatre dégradations, chacune doit rendre la suite rouge. Le `trap`
#      réapplique toujours les deux migrations, qui restaurent tout ce qui a été dégradé.
#
# Tranche T2 — le Keycloak de développement préchargé (§10), éprouvé par de VRAIES connexions PKCE
# (`scripts/lib/sso.sh`) et non par la lecture du JSON importé :
#
#   5. chaque compte : `sub` stable, rôles par défaut du realm réel, `verified` et `admin` là où le §10
#      les place, jeton d'accès `RS256` émis pour `lelabs-crm` ; l'adresse non prouvée n'entre pas ;
#   6. ce que le realm refuse comme le réel : une demande sans PKCE, l'octroi direct par mot de passe,
#      l'ancien mot de passe de `CRM-091` ;
#   7. NON-COMPLAISANCE : `verified` retiré à `bizdev` par l'API d'administration de développement
#      doit être vu ; le rôle est rendu par le `trap` quoi qu'il arrive.
#
# Tranche T3 — l'échangeur de session (§5), fonction edge `session` :
#
#   8. ses tests unitaires, à leur nombre exact ;
#   9. ses preuves d'API contre la pile réelle, à leur nombre exact ;
#  10. NON-COMPLAISANCE PAR MUTATION : des défauts introduits un à un dans le code — algorithme
#      symétrique accepté, `azp` ignoré, `verified` non exigé, durée non bornée par le jeton LeLabs,
#      `JWT_SECRET` remis à une autre fonction — doivent chacun rougir les tests unitaires. Le fichier
#      muté est restauré depuis sa copie par le `trap`, quoi qu'il arrive.
#
# Tranche T3 bis — le client CONFIDENTIEL (décision 586) :
#
#   2–4. la migration 0076 des sessions serveur rejouée deux fois, sa suite pgTAP `0070` verte à son
#      nombre exact, et deux dégradations de plus — table lisible par `authenticated`, lecture d'une
#      session exécutable par `authenticated` — qui doivent la rendre rouge ;
#   6. le realm refuse l'échange d'un code SANS le secret du client, et l'octroi direct même AVEC lui ;
#   8–9. les tests unitaires et les preuves d'API révisés : trois gestes, poignée en cookie `httpOnly`,
#      jeton de rafraîchissement chiffré côté serveur, admission rejouée à la prolongation ;
#  10. trois mutations de plus : le secret omis de l'échange, `HttpOnly` retiré du cookie, le jeton de
#      rafraîchissement gardé en clair.
#
# Tranche T6 — GoTrue retiré (§2, §7.5, décision 589) :
#
#   2–4. la migration 0077 rejouée deux fois SOUS `postgres` — elle n'est pas élevée —, sa suite
#      `0071` verte à son nombre exact, et une dégradation de plus : un trigger reposé sur `auth.users` ;
#  11. la pile sans GoTrue : `/auth/v1/*` et `/.well-known/oauth-authorization-server` en 404 par
#      Kong ; aucun service ni conteneur `auth`, `auth-templates`, `inbucket` ; aucune ligne de
#      configuration ne nomme plus GoTrue — recherche éprouvée par une copie dégradée, qui doit rougir.
#
# Correctif INC-249 (décision 593) — l'admission patiente :
#
#   2–4. la migration 0078 rejouée deux fois sous `postgres`, sa suite `0072` verte à son nombre exact,
#      et une dégradation — l'admission de `0075`, qui consommait tout et laissait la garde refuser —
#      qui doit la rendre rouge ; 8–9. le motif `attente_administrateur`, unitaire et d'API.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1
# shellcheck source=scripts/lib/env.sh
source scripts/lib/env.sh
# shellcheck source=scripts/lib/sso.sh
source scripts/lib/sso.sh
SSO_OIDC_ISSUER=$(env_get "$ENV_FILE" SSO_OIDC_ISSUER)
SSO_OIDC_CLIENT_ID=$(env_get "$ENV_FILE" SSO_OIDC_CLIENT_ID)
SSO_OIDC_CLIENT_SECRET=$(env_get "$ENV_FILE" SSO_OIDC_CLIENT_SECRET)
SITE_URL=$(env_get "$ENV_FILE" SITE_URL)
SSO_DEV_ADMIN_PASSWORD=$(env_get "$ENV_FILE" SSO_DEV_ADMIN_PASSWORD)
DOMAINE=$(env_get "$ENV_FILE" MAIL_DEV_PERSONAL_DOMAIN)
export SSO_OIDC_ISSUER SSO_OIDC_CLIENT_ID SSO_OIDC_CLIENT_SECRET SITE_URL
KEYCLOAK_BASE=${SSO_OIDC_ISSUER%/realms/lelabs}

DB_CONTAINER=p2enjoy-db
IMAGE_DB=$(sed -n 's/^[[:space:]]*image: \(supabase\/postgres:[^[:space:]]*\)$/\1/p' docker-compose.yml | head -n 1)
MIGRATION_CLAIMS=supabase/migrations/0074_revendications_du_jeton.sql
MIGRATION_MODELE=supabase/migrations/0075_identite_sso.sql
MIGRATION_SESSIONS=supabase/migrations/0076_sessions_serveur.sql
MIGRATION_RETRAIT=supabase/migrations/0077_retrait_gotrue.sql
MIGRATION_ADMISSION=supabase/migrations/0078_admission_patiente.sql
TEST_SQL=supabase/tests/0069_identite_sso.test.sql
TEST_SQL_SESSIONS=supabase/tests/0070_sessions_serveur.test.sql
TEST_SQL_RETRAIT=supabase/tests/0071_retrait_gotrue.test.sql
TEST_SQL_ADMISSION=supabase/tests/0072_admission_patiente.test.sql
ASSERTIONS_T1=58
ASSERTIONS_T3BIS=40
ASSERTIONS_T6=8
ASSERTIONS_INC249=16
ASSERTIONS_UNITE=$((ASSERTIONS_T1 + ASSERTIONS_T3BIS + ASSERTIONS_T6 + ASSERTIONS_INC249))
BASE_NEUVE=verify-session-sso-base-neuve
SUB_PREUVE=0c920000-0000-4000-8000-0000000000bb

checks=0
failures=0
restore_needed=false
WORK=$(mktemp -d)

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_dev()   { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"; }
psql_admin() { docker exec -i "$DB_CONTAINER" psql -U supabase_admin -d postgres -qtA -v ON_ERROR_STOP=1 "$@"; }

appliquer_migrations_dev() {
	psql_admin --single-transaction -f - < "$MIGRATION_CLAIMS" >/dev/null 2>&1 \
		&& psql_dev --single-transaction -f - < "$MIGRATION_MODELE" >/dev/null 2>&1 \
		&& psql_dev --single-transaction -f - < "$MIGRATION_SESSIONS" >/dev/null 2>&1 \
		&& psql_dev --single-transaction -f - < "$MIGRATION_RETRAIT" >/dev/null 2>&1 \
		&& psql_dev --single-transaction -f - < "$MIGRATION_ADMISSION" >/dev/null 2>&1
}

role_a_rendre=false
fichier_mute=''
UNITES_SESSION=122
SCENARIOS_SESSION=22

cleanup() {
	local status=$?
	trap - EXIT
	if [ -n "$fichier_mute" ] && [ -f "$WORK/original" ]; then
		cp "$WORK/original" "$fichier_mute" || { echo "RESTAURATION IMPOSSIBLE : $fichier_mute" >&2; status=1; }
	fi
	if [ "$role_a_rendre" = true ]; then
		attribuer_verified bizdev || { echo "RESTAURATION IMPOSSIBLE : rendre « verified » à bizdev@$DOMAINE" >&2; status=1; }
	fi
	if [ "$restore_needed" = true ]; then
		appliquer_migrations_dev || { echo "RESTAURATION IMPOSSIBLE : rejouer $MIGRATION_CLAIMS et $MIGRATION_MODELE" >&2; status=1; }
	fi
	docker rm -f "$BASE_NEUVE" >/dev/null 2>&1 || true
	rm -rf -- "$WORK"
	exit "$status"
}
trap cleanup EXIT

jeton_admin_keycloak() {
	curl -sf --max-time 10 "$KEYCLOAK_BASE/realms/master/protocol/openid-connect/token" \
		--data-urlencode client_id=admin-cli --data-urlencode username=admin \
		--data-urlencode "password=$SSO_DEV_ADMIN_PASSWORD" --data-urlencode grant_type=password \
		| jq -r .access_token
}

# Ajoute ou retire le rôle de realm `verified` du compte LOCAL@DOMAINE, par l'API d'administration du
# Keycloak de DÉVELOPPEMENT (docs/SPEC-session-sso.md §10 : réservée aux harnais).
_role_verified() {
	local methode=$1 local_part=$2 jeton id role
	jeton=$(jeton_admin_keycloak) || return 1
	id=$(curl -sf -H "Authorization: Bearer $jeton" \
		"$KEYCLOAK_BASE/admin/realms/lelabs/users?exact=true&email=$local_part@$DOMAINE" | jq -r '.[0].id')
	role=$(curl -sf -H "Authorization: Bearer $jeton" "$KEYCLOAK_BASE/admin/realms/lelabs/roles/verified")
	[ -n "$id" ] && [ "$id" != null ] && [ -n "$role" ] || return 1
	curl -sf -o /dev/null -X "$methode" -H "Authorization: Bearer $jeton" -H 'Content-Type: application/json' \
		-d "[$role]" "$KEYCLOAK_BASE/admin/realms/lelabs/users/$id/role-mappings/realm"
}
attribuer_verified() { _role_verified POST "$1"; }
retirer_verified()   { _role_verified DELETE "$1"; }

# Une tentative de connexion d'une adresse non prouvée, realm exigeant la vérification, ajoute au
# compte l'action requise `VERIFY_EMAIL`, qui PERSISTE (mesuré) : le harnais efface ce qu'il cause.
effacer_actions_requises() {
	local local_part=$1 jeton id
	jeton=$(jeton_admin_keycloak) || return 1
	id=$(curl -sf -H "Authorization: Bearer $jeton" \
		"$KEYCLOAK_BASE/admin/realms/lelabs/users?exact=true&email=$local_part@$DOMAINE" | jq -r '.[0].id')
	[ -n "$id" ] && [ "$id" != null ] || return 1
	curl -sf -o /dev/null -X PUT -H "Authorization: Bearer $jeton" -H 'Content-Type: application/json' \
		-d '{"requiredActions":[]}' "$KEYCLOAK_BASE/admin/realms/lelabs/users/$id"
}

suite_verte() {
	scripts/run-sql-tests.sh "$TEST_SQL" "$TEST_SQL_SESSIONS" "$TEST_SQL_RETRAIT" "$TEST_SQL_ADMISSION" > "$WORK/tap.log" 2>&1 \
		&& grep -q "4 fichiers, $ASSERTIONS_UNITE assertions, aucune anomalie" "$WORK/tap.log"
}

suite_rouge() {
	if scripts/run-sql-tests.sh "$TEST_SQL" "$TEST_SQL_SESSIONS" "$TEST_SQL_RETRAIT" "$TEST_SQL_ADMISSION" > "$WORK/tap-rouge.log" 2>&1; then
		return 1
	fi
	grep -Eq 'ECHEC|not ok|psql a échoué' "$WORK/tap-rouge.log"
}

echo
echo "CRM-092 — le SSO, seule source d'identité (docs/SPEC-session-sso.md)"
echo

# =================================================================================================
# 1. Base neuve, sans GoTrue — K11 reproduite, puis levée par 0074
# =================================================================================================
echo "1. Base neuve sans GoTrue ($IMAGE_DB)"

[ -n "$IMAGE_DB" ] || { fail "image de la base introuvable dans docker-compose.yml"; exit 1; }
docker rm -f "$BASE_NEUVE" >/dev/null 2>&1 || true
docker run -d --rm --name "$BASE_NEUVE" --network none \
	-e POSTGRES_PASSWORD="preuve-jetable-$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')" \
	-e JWT_SECRET="preuve-jetable-secret-de-trente-deux-caracteres" \
	"$IMAGE_DB" >/dev/null
pret=false
for _ in $(seq 1 90); do
	if docker exec "$BASE_NEUVE" psql -U supabase_admin -d postgres -tAc 'select 1' >/dev/null 2>&1 \
		&& [ "$(docker exec "$BASE_NEUVE" psql -U supabase_admin -d postgres -tAc \
			"select count(*) from pg_proc where pronamespace = 'auth'::regnamespace and proname = 'uid'" 2>/dev/null)" = 1 ]; then
		pret=true
		break
	fi
	sleep 1
done
# L'image redémarre le serveur après ses scripts d'initialisation : on attend la stabilité.
sleep 3
for _ in $(seq 1 30); do
	docker exec "$BASE_NEUVE" pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
	sleep 1
done
[ "$pret" = true ] || { fail "la base jetable n'a pas démarré"; exit 1; }

uid_neuve() {
	docker exec -i "$BASE_NEUVE" psql -U supabase_admin -d postgres -qtA -v ON_ERROR_STOP=1 <<SQL
begin;
select set_config('request.jwt.claims', '{"sub":"$SUB_PREUVE","role":"authenticated"}', true) is null;
select coalesce(auth.uid()::text, 'NULL');
rollback;
SQL
}

avant=$(uid_neuve | tail -n 1)
if [ "$avant" = NULL ]; then
	ok "témoin : sans GoTrue ni 0074, auth.uid() rend NULL sous request.jwt.claims (K11 reproduite)"
else
	fail "témoin : auth.uid() rend « $avant » avant 0074 — K11 n'est plus reproduite, la preuve ne vaut rien"
fi

for passage in premier second; do
	if docker exec -i "$BASE_NEUVE" psql -U supabase_admin -d postgres -qtA -v ON_ERROR_STOP=1 \
		--single-transaction -f - < "$MIGRATION_CLAIMS" >"$WORK/neuve-$passage.log" 2>&1; then
		ok "0074 appliquée sur la base neuve ($passage passage)"
	else
		fail "0074 refusée sur la base neuve ($passage passage) : $(tail -n 2 "$WORK/neuve-$passage.log")"
	fi
done

apres=$(uid_neuve | tail -n 1)
if [ "$apres" = "$SUB_PREUVE" ]; then
	ok "après 0074, auth.uid() rend le sub de request.jwt.claims (K11 levée)"
else
	fail "après 0074, auth.uid() rend « $apres » au lieu du sub"
fi

proprietaires=$(docker exec "$BASE_NEUVE" psql -U supabase_admin -d postgres -tAc \
	"select string_agg(proname || ':' || pg_get_userbyid(proowner), ' ' order by proname)
	   from pg_proc where pronamespace = 'auth'::regnamespace and proname in ('uid','role','email','jwt')")
if [ "$proprietaires" = "email:supabase_auth_admin jwt:supabase_auth_admin role:supabase_auth_admin uid:supabase_auth_admin" ]; then
	ok "les quatre fonctions existent et appartiennent à supabase_auth_admin, comme sous GoTrue"
else
	fail "fonctions auth.* inattendues sur la base neuve : $proprietaires"
fi
docker rm -f "$BASE_NEUVE" >/dev/null 2>&1 || true

# =================================================================================================
# 2. Base de développement — rejeu convergent sous le rôle de chaque migration
# =================================================================================================
echo
echo "2. Base de développement : rejeu des migrations 0074 à 0078"

for passage in premier second; do
	if psql_admin --single-transaction -f - < "$MIGRATION_CLAIMS" >"$WORK/dev-claims-$passage.log" 2>&1; then
		ok "0074 rejouée sous supabase_admin ($passage passage)"
	else
		fail "0074 refusée ($passage passage) : $(tail -n 2 "$WORK/dev-claims-$passage.log")"
	fi
	if psql_dev --single-transaction -f - < "$MIGRATION_MODELE" >"$WORK/dev-modele-$passage.log" 2>&1; then
		ok "0075 rejouée sous postgres ($passage passage)"
	else
		fail "0075 refusée ($passage passage) : $(tail -n 2 "$WORK/dev-modele-$passage.log")"
	fi
	if psql_dev --single-transaction -f - < "$MIGRATION_SESSIONS" >"$WORK/dev-sessions-$passage.log" 2>&1; then
		ok "0076 rejouée sous postgres ($passage passage)"
	else
		fail "0076 refusée ($passage passage) : $(tail -n 2 "$WORK/dev-sessions-$passage.log")"
	fi
	# T6 : sous `postgres`, SANS élévation — mesuré, `postgres` retire le trigger d'`auth.users`
	# (décision 589, correction). Rejouée, elle ne trouve plus rien et ne fait rien.
	if psql_dev --single-transaction -f - < "$MIGRATION_RETRAIT" >"$WORK/dev-retrait-$passage.log" 2>&1; then
		ok "0077 rejouée sous postgres, sans élévation ($passage passage)"
	else
		fail "0077 refusée ($passage passage) : $(tail -n 2 "$WORK/dev-retrait-$passage.log")"
	fi
	if psql_dev --single-transaction -f - < "$MIGRATION_ADMISSION" >"$WORK/dev-admission-$passage.log" 2>&1; then
		ok "0078 rejouée sous postgres ($passage passage)"
	else
		fail "0078 refusée ($passage passage) : $(tail -n 2 "$WORK/dev-admission-$passage.log")"
	fi
done

if psql_dev --single-transaction -f - < "$MIGRATION_CLAIMS" >"$WORK/dev-claims-postgres.log" 2>&1; then
	fail "0074 acceptée sous postgres : sa garde de rôle ne refuse plus rien"
elif grep -q 'migration_role_inattendu' "$WORK/dev-claims-postgres.log"; then
	ok "0074 refusée sous postgres par sa garde de rôle, avant toute écriture"
else
	fail "0074 refusée sous postgres, mais pas par sa garde : $(tail -n 1 "$WORK/dev-claims-postgres.log")"
fi

# =================================================================================================
# 3. Suite pgTAP de l'unité
# =================================================================================================
echo
echo "3. pgTAP : $TEST_SQL, $TEST_SQL_SESSIONS, $TEST_SQL_RETRAIT et $TEST_SQL_ADMISSION"

if suite_verte; then
	ok "quatre suites vertes, $ASSERTIONS_T1 + $ASSERTIONS_T3BIS + $ASSERTIONS_T6 + $ASSERTIONS_INC249 = $ASSERTIONS_UNITE assertions"
else
	fail "suites non vertes ou nombre d'assertions différent de $ASSERTIONS_UNITE : $(tail -n 3 "$WORK/tap.log")"
fi

# =================================================================================================
# 4. Non-complaisance : chaque dégradation doit rendre la suite rouge
# =================================================================================================
echo
echo "4. Non-complaisance (chaque dégradation est restaurée par le rejeu des migrations)"

degrader() {
	local libelle=$1 role=$2 sql=$3
	restore_needed=true
	if [ "$role" = supabase_admin ]; then
		printf '%s\n' "$sql" | psql_admin >/dev/null
	else
		printf '%s\n' "$sql" | psql_dev >/dev/null
	fi
	if suite_rouge; then
		ok "dégradation détectée : $libelle"
	else
		fail "dégradation NON détectée : $libelle"
	fi
	appliquer_migrations_dev || { fail "restauration impossible après : $libelle"; exit 1; }
	restore_needed=false
}

degrader "auth.uid() revenue à la forme de l'image, qui ignore request.jwt.claims (K11)" supabase_admin \
	"create or replace function auth.uid() returns uuid language sql stable as
	 \$\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$\$;"

degrader "inscription d'une attente permise au nom d'un autre administrateur" postgres \
	"alter policy workspace_invitations_insertion_admin on public.workspace_invitations
	 with check (app.is_workspace_admin(workspace_id));"

degrader "ouverture de session exécutable par authenticated" postgres \
	"grant execute on function public.ouvrir_session_sso(uuid, text, text) to authenticated;"

# `not valid` : un profil né d'un `sub` LeLabs n'a pas de ligne dans `auth.users`, et la contrainte
# ne doit pas échouer sur lui — c'est sa PRÉSENCE que la suite doit voir, pas les lignes existantes.
degrader "profiles.id rattaché de nouveau à auth.users" postgres \
	"alter table public.profiles add constraint profiles_id_fkey
	 foreign key (id) references auth.users (id) on delete cascade not valid;"

# T3 bis : la table des sessions et ses fonctions ne s'ouvrent à personne d'autre que la clé de service.
degrader "table des sessions serveur lisible par authenticated" postgres \
	"grant select on public.sessions_sso to authenticated;"

degrader "lecture d'une session serveur exécutable par authenticated" postgres \
	"grant execute on function public.lire_session_serveur(bytea) to authenticated;"

# T6 : un trigger reposé sur `auth.users` doit rougir `0071` ; le rejeu de `0077` le retire.
degrader "trigger de création de profil reposé sur auth.users" postgres \
	"create trigger on_auth_user_created after insert on auth.users
	 for each row execute function app.set_updated_at();"

# INC-249 (décision 593) : l'admission de `0075`, qui consommait TOUTES les attentes et laissait la garde
# du dernier administrateur faire échouer la connexion, doit rougir `0072` ; le rejeu de `0078` la rétablit.
degrader "admission impatiente de 0075 : l'attente d'un espace sans administrateur consommée" postgres \
	"$(cat "$MIGRATION_MODELE")"

if suite_verte; then
	ok "après restauration, la suite est de nouveau verte"
else
	fail "après restauration, la suite n'est pas verte : $(tail -n 3 "$WORK/tap.log")"
fi

# =================================================================================================
# 5. Le realm de développement préchargé — par de vraies connexions PKCE
# =================================================================================================
echo
echo "5. Keycloak de développement préchargé ($SSO_OIDC_ISSUER)"

# local|sub attendu|verified attendu|admin du realm attendu
COMPTES_REALM=(
	'admin|5eed0000-0000-4000-8000-000000000011|oui|non'
	'bizdev|5eed0000-0000-4000-8000-000000000012|oui|non'
	'viewer|5eed0000-0000-4000-8000-000000000013|oui|oui'
	'inconnu|5eed0000-0000-4000-8000-000000000014|oui|non'
	'attendu|5eed0000-0000-4000-8000-000000000015|non|non'
)

# Juge le jeton d'accès d'un compte ; rend 0 si tout ce que le §10 promet est vrai.
juger_compte() {
	local local_part=$1 sub_attendu=$2 verified_attendu=$3 admin_attendu=$4 reponse jeton entete charge
	reponse=$(sso_connexion_pkce "$local_part@$DOMAINE" 2>"$WORK/sso-$local_part.err") || return 1
	jeton=$(jq -r .access_token <<<"$reponse")
	# `sso_revendications` décode le DEUXIÈME segment : l'en-tête y est placé.
	entete=$(sso_revendications "x.$(cut -d. -f1 <<<"$jeton")")
	charge=$(sso_revendications "$jeton")
	jq -e --arg sub "$sub_attendu" --arg client "$SSO_OIDC_CLIENT_ID" --arg v "$verified_attendu" --arg a "$admin_attendu" '
		.sub == $sub and .azp == $client and .typ == "Bearer" and .email_verified == true
		and (.realm_access.roles | index("default-roles-lelabs") != null)
		and (.realm_access.roles | index("offline_access") != null)
		and (.realm_access.roles | index("uma_authorization") != null)
		and ((.realm_access.roles | index("verified") != null) == ($v == "oui"))
		and ((.realm_access.roles | index("admin") != null) == ($a == "oui"))
	' <<<"$charge" >/dev/null && jq -e '.alg == "RS256"' <<<"$entete" >/dev/null
}

for ligne in "${COMPTES_REALM[@]}"; do
	IFS='|' read -r local_part sub_attendu verified_attendu admin_attendu <<<"$ligne"
	if juger_compte "$local_part" "$sub_attendu" "$verified_attendu" "$admin_attendu"; then
		ok "$local_part@ : sub ${sub_attendu: -4}, rôles par défaut, verified=$verified_attendu, admin=$admin_attendu, RS256"
	else
		fail "$local_part@ : jeton non conforme au §10 ($(cat "$WORK/sso-$local_part.err" 2>/dev/null))"
	fi
done

if sso_connexion_pkce "adresse-non-verifiee@$DOMAINE" >/dev/null 2>"$WORK/sso-nv.err"; then
	fail "adresse-non-verifiee@ entre sans avoir prouvé son adresse"
else
	ok "adresse-non-verifiee@ n'entre pas : le realm exige la vérification d'adresse, comme le réel"
fi
if effacer_actions_requises adresse-non-verifiee; then
	ok "l'action requise que cette tentative a posée sur le compte est effacée : le realm est rendu intact"
else
	fail "l'action requise VERIFY_EMAIL n'a pas pu être effacée d'adresse-non-verifiee@"
fi

# =================================================================================================
# 6. Ce que le realm refuse, comme le réel
# =================================================================================================
echo
echo "6. Refus du realm"

sans_pkce=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -G "$SSO_OIDC_ISSUER/protocol/openid-connect/auth" \
	--data-urlencode "client_id=$SSO_OIDC_CLIENT_ID" --data-urlencode response_type=code \
	--data-urlencode scope=openid --data-urlencode "redirect_uri=$SITE_URL/auth/retour")
case $sans_pkce in
	"302 $SITE_URL/auth/retour?"*"Missing+parameter%3A+code_challenge_method"*)
		ok "une demande sans PKCE est renvoyée avec « Missing parameter: code_challenge_method »" ;;
	*) fail "une demande sans PKCE n'est pas refusée comme par le realm réel : $sans_pkce" ;;
esac

# Avec le secret : le client est bien authentifié, et c'est l'octroi lui-même qui est refusé.
direct=$(curl -s -o "$WORK/direct.json" -w '%{http_code}' "$SSO_OIDC_ISSUER/protocol/openid-connect/token" \
	--data-urlencode grant_type=password --data-urlencode "client_id=$SSO_OIDC_CLIENT_ID" \
	--data-urlencode "client_secret=$SSO_OIDC_CLIENT_SECRET" \
	--data-urlencode "username=admin@$DOMAINE" --data-urlencode "password=$SSO_MOT_DE_PASSE_DEFAUT")
if [ "$direct" != 200 ] && [ "$(jq -r .error "$WORK/direct.json")" = unauthorized_client ] \
	&& jq -r .error_description "$WORK/direct.json" | grep -qi 'direct access grants'; then
	ok "l'octroi direct par mot de passe est refusé au client authentifié ($direct unauthorized_client)"
else
	fail "l'octroi direct par mot de passe n'est pas refusé : $direct $(head -c 120 "$WORK/direct.json")"
fi

# Le client du CRM est confidentiel (décision 586) : un code n'est échangé qu'avec son secret.
if obtenu=$(sso_code_pkce "admin@$DOMAINE" 2>"$WORK/code.err"); then
	read -r code verificateur retour <<<"$obtenu"
	sans_secret=$(curl -s -o "$WORK/sans-secret.json" -w '%{http_code}' "$SSO_OIDC_ISSUER/protocol/openid-connect/token" \
		--data-urlencode grant_type=authorization_code --data-urlencode "client_id=$SSO_OIDC_CLIENT_ID" \
		--data-urlencode "code=$code" --data-urlencode "redirect_uri=$retour" --data-urlencode "code_verifier=$verificateur")
	if [ "$sans_secret" = 401 ] && [ "$(jq -r .error "$WORK/sans-secret.json")" = unauthorized_client ]; then
		ok "un code présenté sans le secret du client n'est pas échangé ($sans_secret unauthorized_client) : le client est confidentiel"
	else
		fail "un code est échangé sans le secret du client : $sans_secret $(head -c 120 "$WORK/sans-secret.json")"
	fi
else
	fail "aucun code obtenu pour admin@ : $(cat "$WORK/code.err")"
fi

if sso_connexion_pkce "admin@$DOMAINE" SsoDev2026Local >/dev/null 2>&1; then
	fail "l'ancien mot de passe de CRM-091 ouvre encore une session"
else
	ok "l'ancien mot de passe de CRM-091 est refusé : un seul mot de passe, celui du seed"
fi

# =================================================================================================
# 7. Non-complaisance du contrôle du realm
# =================================================================================================
echo
echo "7. Non-complaisance (le rôle est rendu par le trap quoi qu'il arrive)"

role_a_rendre=true
if retirer_verified bizdev; then
	if juger_compte bizdev 5eed0000-0000-4000-8000-000000000012 oui non; then
		fail "verified retiré à bizdev@, et le contrôle ne l'a PAS vu"
	else
		ok "verified retiré à bizdev@ : le contrôle le voit"
	fi
else
	fail "impossible de retirer verified à bizdev@ par l'API d'administration de développement"
fi
if attribuer_verified bizdev && juger_compte bizdev 5eed0000-0000-4000-8000-000000000012 oui non; then
	role_a_rendre=false
	ok "verified rendu à bizdev@ : le contrôle est de nouveau vert"
else
	fail "verified n'a pas pu être rendu à bizdev@"
fi

# =================================================================================================
# 8. Tests unitaires de l'échangeur
# =================================================================================================
echo
echo "8. Tests unitaires de supabase/functions/session"

unites_session() {
	npm run --silent test:unit -- ../supabase/functions/session >"$WORK/unites.log" 2>&1
}
if unites_session && grep -qE "Tests +$UNITES_SESSION passed" "$WORK/unites.log"; then
	ok "$UNITES_SESSION tests unitaires verts"
else
	fail "tests unitaires en échec ou compte différent de $UNITES_SESSION : $(grep -E 'Tests' "$WORK/unites.log" | tail -n 1)"
fi

# =================================================================================================
# 9. Preuves d'API de l'échangeur, contre la pile réelle
# =================================================================================================
echo
echo "9. Preuves d'API : e2e/api/session.spec.ts"

if E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
	e2e/api/session.spec.ts --workers=1 >"$WORK/session-api.log" 2>&1 \
	&& grep -qE "$SCENARIOS_SESSION passed" "$WORK/session-api.log"; then
	ok "$SCENARIOS_SESSION scénarios verts : trois gestes, cookie, sessions chiffrées, attentes, refus, rattachement, Realtime, Storage, rotation"
else
	fail "preuves d'API en échec ou compte différent de $SCENARIOS_SESSION : $(grep -E 'passed|failed' "$WORK/session-api.log" | tail -n 2 | tr '\n' ' ')"
fi

# =================================================================================================
# 10. Non-complaisance par mutation
# =================================================================================================
echo
echo "10. Non-complaisance par mutation (chaque fichier muté est restauré depuis sa copie)"

muter() {
	local libelle=$1 fichier=$2 motif=$3 remplacement=$4 cible=$5
	cp "$fichier" "$WORK/original"
	fichier_mute=$fichier
	if ! MOTIF="$motif" REMPLACEMENT="$remplacement" python3 - "$fichier" <<'PY'
import os, sys
chemin = sys.argv[1]
texte = open(chemin, encoding='utf-8').read()
motif = os.environ['MOTIF']
if texte.count(motif) != 1:
    sys.exit(1)
open(chemin, 'w', encoding='utf-8').write(texte.replace(motif, os.environ['REMPLACEMENT']))
PY
	then
		fail "mutation impossible, motif introuvable ou ambigu : $libelle"
	elif npm run --silent test:unit -- "$cible" >"$WORK/mutant.log" 2>&1; then
		fail "mutation NON détectée : $libelle"
	else
		ok "mutation détectée : $libelle"
	fi
	cp "$WORK/original" "$fichier"
	fichier_mute=''
}

muter "un algorithme symétrique ou « none » accepté" supabase/functions/session/verification.ts \
	"if (!algorithmeAccepte(alg)) throw new Refus('jeton_refuse')" \
	"if (alg === undefined) throw new Refus('jeton_refuse')" ../supabase/functions/session
muter "azp ignoré : le jeton d'une autre application accepté" supabase/functions/session/verification.ts \
	"if (r.azp !== c.clientId) throw new Refus('jeton_refuse')" \
	"" ../supabase/functions/session
muter "verified non exigé" supabase/functions/session/verification.ts \
	"if (!Array.isArray(roles) || !roles.includes(ROLE_REQUIS)) throw new Refus('attente_verification', adresse)" \
	"" ../supabase/functions/session
muter "jeton interne non borné par l'échéance du jeton LeLabs" supabase/functions/session/handler.ts \
	"Math.min(identite.exp, maintenant + DUREE_MAX_JETON_INTERNE)" \
	"maintenant + DUREE_MAX_JETON_INTERNE" ../supabase/functions/session
muter "JWT_SECRET remis à la fonction d'exemple" supabase/functions/main/environnement.ts \
	"session: ['JWT_SECRET', 'SSO_OIDC_ISSUER', 'SSO_OIDC_CLIENT_ID', 'SSO_OIDC_CLIENT_SECRET']," \
	"session: ['JWT_SECRET', 'SSO_OIDC_ISSUER', 'SSO_OIDC_CLIENT_ID', 'SSO_OIDC_CLIENT_SECRET'], example: ['JWT_SECRET']," ../supabase/functions/main
muter "le secret du client omis de l'échange du code" supabase/functions/session/handler.ts \
	$'\t\t\tclient_secret: c.clientSecret,\n' \
	"" ../supabase/functions/session
muter "HttpOnly retiré du cookie de la poignée" supabase/functions/session/cookie.ts \
	"; HttpOnly; SameSite=Strict" \
	"; SameSite=Strict" ../supabase/functions/session
muter "le jeton de rafraîchissement gardé en clair à l'ouverture" supabase/functions/session/handler.ts \
	$'p_empreinte: await empreinteDe(poignee),\n\t\t\t\tp_rafraichissement: await chiffrer(jetons.rafraichissement, cle),' \
	$'p_empreinte: await empreinteDe(poignee),\n\t\t\t\tp_rafraichissement: jetons.rafraichissement,' ../supabase/functions/session

if unites_session && grep -qE "Tests +$UNITES_SESSION passed" "$WORK/unites.log"; then
	ok "après restauration, les tests unitaires sont de nouveau verts"
else
	fail "après restauration, les tests unitaires ne sont pas verts"
fi

# =================================================================================================
# 11. La pile sans GoTrue — tranche T6 (docs/SPEC-session-sso.md §2, §13, §16 ; décision 589)
# =================================================================================================
echo
echo "11. La pile sans GoTrue"

API_KONG="http://127.0.0.1:$(env_get "$ENV_FILE" KONG_HTTP_PORT)"
ANON_KEY=$(env_get "$ENV_FILE" ANON_KEY)
for chemin in /auth/v1/health /auth/v1/token /.well-known/oauth-authorization-server; do
	code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON_KEY" "$API_KONG$chemin" || echo 000)
	[ "$code" = 404 ] && ok "$chemin rend 404 par la passerelle : aucune route vers GoTrue" \
		|| fail "$chemin rend $code par la passerelle, 404 attendu"
done

services_dev=$(docker compose --env-file "$ENV_FILE" -f docker-compose.yml -f docker-compose.dev.yml config --services 2>/dev/null)
services_prod=$(docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.prod.yml config --services 2>/dev/null)
if [ -n "$services_dev" ] && [ -n "$services_prod" ] \
	&& ! printf '%s\n%s\n' "$services_dev" "$services_prod" | grep -qxE 'auth|auth-templates|inbucket'; then
	ok "aucun service auth, auth-templates ni inbucket, en développement comme en production"
else
	fail "un service retiré est encore déclaré, ou un assemblage ne se résout pas"
fi
conteneurs=$(docker ps -a --format '{{.Names}}' | grep -xE 'p2enjoy-auth|p2enjoy-auth-templates|p2enjoy-inbucket' || true)
[ -z "$conteneurs" ] && ok "aucun conteneur de GoTrue, de ses gabarits ni d'Inbucket sur le poste" \
	|| fail "conteneurs retirés encore présents : $(printf '%s' "$conteneurs" | tr '\n' ' ')"

# La recherche du §16 : aucune LIGNE ACTIVE de configuration ne nomme plus GoTrue. Les commentaires
# qui racontent le retrait sont permis ; une valeur, un service, une route ou une variable, non.
MOTIF_GOTRUE='gotrue|GOTRUE_|auth-templates|inbucket|INBUCKET_|auth:9999|DISABLE_SIGNUP|ENABLE_EMAIL_|ENABLE_PHONE_|ENABLE_ANONYMOUS_USERS|PASSWORD_MIN_LENGTH|ADDITIONAL_REDIRECT_URLS|MAILER_|^[[:space:]]*SMTP_(HOST|PORT|USER|PASS|ADMIN_EMAIL|SENDER_NAME)='
CONFIGURATIONS=(docker-compose.yml docker-compose.dev.yml docker-compose.prod.yml docker-compose.spark.yml
	supabase/docker/volumes/api/kong.yml .env.example)
lignes_gotrue() { grep -hvE '^[[:space:]]*#' "$@" | grep -E "$MOTIF_GOTRUE" || true; }
restes=$(lignes_gotrue "${CONFIGURATIONS[@]}")
[ -z "$restes" ] && ok "aucune ligne active de configuration ne nomme GoTrue, ses gabarits, Inbucket ni leurs variables" \
	|| fail "configuration qui nomme encore GoTrue : $(printf '%s' "$restes" | head -n 3 | tr '\n' ' ')"
# Non-complaisance : la même recherche sur une copie où le service est reposé doit le trouver.
cp docker-compose.yml "$WORK/compose-degrade.yml"
printf '  auth:\n    image: supabase/gotrue:v2.189.0\n' >> "$WORK/compose-degrade.yml"
[ -n "$(lignes_gotrue "$WORK/compose-degrade.yml")" ] && ok "dégradation détectée : service GoTrue reposé dans une copie de l'assemblage" \
	|| fail "dégradation NON détectée : la recherche ne voit pas un service GoTrue reposé"

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d vérifications, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d vérifications, %d anomalie(s).\033[0m\n' "$checks" "$failures"
	exit 1
fi
