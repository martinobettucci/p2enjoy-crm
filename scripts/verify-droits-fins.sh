#!/usr/bin/env bash
# @verifies CRM-012 (docs/BACKLOG.md) — Definition of Done des droits fins par track et channel
# @verifies docs/SPEC-permissions-rls.md §2.2 (matrice), §3.3 (fonctions can_*), §3.4 (appui),
#           §3.5 (une politique ne relit pas sa table), §4.1 (politiques), §4.2 (contrat d'API),
#           §7 (preuves de refus n° 3, 4 et 11)
# @verifies docs/SPEC-seed.md §2.11 (droits fins seedés)
# @verifies docs/SCHEMA.md §1, §9 ; docs/PROD_MIGRATIONS.md §3
# @verifies docs/JOURNAL.md décisions 103 à 108
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-012` :
#
#   1. la suite pgTAP `supabase/tests/0011_droits_fins.test.sql` est verte ;
#   2. la migration est **rejouable et convergente** : réappliquée sur une base déjà migrée, elle
#      réussit sans rien modifier ; une fonction faussée ou une politique retirée sont réparées ;
#   3. le seed est convergent : rejoué, il laisse exactement quatre droits fins ;
#   4. la matrice est mesurée **contre l'API**, avec les jetons réels des trois profils seedés ;
#   5. les scénarios d'API, d'interface, les tests unitaires et le build sont verts ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est **constatée**, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve rien d'un écran : la webapp n'a aucun parcours de connexion (INC-021), son client
# est anonyme, et aucune donnée métier ne peut lui apparaître. Un droit fin est par nature invisible
# à un appelant anonyme — il n'a déjà aucun accès. C'est une limite du **produit**, nommée dans
# `docs/BACKLOG.md` plutôt que masquée par une preuve qui n'en serait pas une.
#
# Il ne prouve pas non plus `app.can_read_card` : `cards` arrive à `CRM-040` (INC-013).
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-droits-fins.sh
#   scripts/verify-droits-fins.sh --rapide   n'exécute ni Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0011_droits_fins.test.sql
MIGRATION_FILE=supabase/migrations/0010_droits_fins.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
TRACK_CONSEIL=5eed0000-0000-4000-8000-000000000021
TRACK_STUDIO=5eed0000-0000-4000-8000-000000000022
CH_PROSPECTION=5eed0000-0000-4000-8000-000000000031
CH_GRANDS_COMPTES=5eed0000-0000-4000-8000-000000000032

U_ADMIN=5eed0000-0000-4000-8000-000000000011
U_BIZDEV=5eed0000-0000-4000-8000-000000000012
U_VIEWER=5eed0000-0000-4000-8000-000000000013

MAIL_ADMIN=admin@p2enjoy.test
MAIL_BIZDEV=bizdev@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,36p' "$0"; exit 0 ;;
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
SERVICE_ROLE_KEY=$(require_env SERVICE_ROLE_KEY)
API="http://127.0.0.1:${KONG_HTTP_PORT}"

failures=0
checks=0

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

CORPS=/tmp/p2enjoy-droits-fins-body
http() {
	local method=$1 url=$2
	shift 2
	curl -s -o "$CORPS" -w '%{http_code}' -X "$method" "$url" "$@"
}

lire() {
	# $1 = chemin REST, $2 = jeton (vide pour l'anonyme)
	if [ -n "${2:-}" ]; then
		http GET "$API/rest/v1/$1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $2" >/dev/null
	else
		http GET "$API/rest/v1/$1" -H "apikey: $ANON_KEY" >/dev/null
	fi
	jq -r 'length' < "$CORPS"
}

jeton_de() {
	curl -s -X POST "$API/auth/v1/token?grant_type=password" \
		-H "apikey: $ANON_KEY" -H 'Content-Type: application/json' \
		-d "$(jq -nc --arg m "$1" --arg p "$MDP_SEED" '{email: $m, password: $p}')" \
		| jq -r '.access_token // empty'
}

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser un droit fin de
# preuve derrière elle. Il ne touche **que** les lignes du harnais — celles du seed portent des
# identifiants stables et distincts, et les détruire fausserait le contrat (décision 108).
menage() {
	psql_db -c "delete from public.track_members
	             where track_id = '$TRACK_STUDIO' and user_id = '$U_BIZDEV';" >/dev/null 2>&1 || true
	psql_db -c "delete from public.channel_members
	             where channel_id = '$CH_GRANDS_COMPTES' and user_id = '$U_BIZDEV';" >/dev/null 2>&1 || true
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

empreinte() {
	psql_db -c "
		select string_agg(x, '|' order by x) from (
			select 'fn:' || p.proname || ':' || md5(pg_get_functiondef(p.oid)) as x
			  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'app'
			   and p.proname in ('can_read_track', 'can_read_channel', 'can_write_channel',
			                     'track_workspace', 'channel_workspace',
			                     'resolve_track_access', 'resolve_channel_access')
			union all
			select 'pol:' || p.polname || ':' || md5(pg_get_expr(p.polqual, p.polrelid))
			  from pg_policy p
			 where p.polrelid in ('public.track_members'::regclass,
			                      'public.channel_members'::regclass,
			                      'public.tracks'::regclass,
			                      'public.channels'::regclass)
			   and p.polqual is not null
		) t;
	"
}

# Le retour à l'état courant appelle le `migrations-runner` sur TOUT le répertoire, et jamais une
# réapplication isolée de la migration 10 : c'est le §3.5 de `docs/SPEC-test-harness.md`, et c'est
# la restauration que `verify-copie-workflow.sh` et `verify-transition-required-fields.sh`
# emploient depuis INC-195 et INC-199. `--force-recreate` est nécessaire — le runner est un
# conteneur à usage unique —, et l'appel porte `--env-file` et les DEUX fichiers de composition
# (`docs/CloudWorker.md` §2.2 bis, décisions 471 et 497) : un appel nu recréerait `storage` et `db`
# sans les surcharges `dev`.
restaurer_etat_courant() {
	docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml \
		up --force-recreate migrations-runner
}

# Rend le NOM des éléments d'empreinte qui diffèrent entre deux relevés. Comparer deux sommes
# globales dit qu'il y a eu dérive ; nommer l'élément dit LAQUELLE, et c'est ce qui empêche une
# dérive inattendue de se cacher derrière une dérive attendue.
elements_derives() {
	comm -3 <(printf '%s' "$1" | tr '|' '\n' | sort) <(printf '%s' "$2" | tr '|' '\n' | sort) \
		| sed 's/^[[:space:]]*//' | cut -d: -f1-2 | sort -u | paste -sd, -
}

avant=$(empreinte)
if psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1; then
	ok "la migration se réapplique sans erreur sur une base déjà migrée"
else
	fail "la migration échoue au rejeu — l'idempotence n'est pas acquise"
fi

# CE CONTRÔLE COMPTAIT UNE IDENTITÉ ; IL MESURE DÉSORMAIS L'INVARIANT QUI COMPTE — INC-213,
# mesurée le 2026-08-25, sixième occurrence de la famille d'INC-142 après INC-153, INC-154,
# INC-195, INC-199 et INC-200.
#
# `0010_droits_fins.sql` n'est plus la dernière autorité sur `tracks_lecture_membre` :
# `0034_lecture_track_transitive.sql` a ajouté `app.track_has_readable_channel(id)` au prédicat,
# sans quoi un channel rouvert par un droit fin serait joignable dans un track invisible. Rejouer
# la 10 SEULE ramène donc réellement le prédicat d'avant la 34, et l'effet est USAGER, pas
# cosmétique — MESURÉ sur le seed avec le rôle réel : la lectrice, à qui `conseil-ia` est fermé au
# niveau du track et dont le seul channel `prospection` est rouvert, lit **4** tracks sur 5 après
# le rejeu isolé, et **5** dans l'état que le runner produit. L'assertion accusait le produit d'une
# dérive que le harnais venait de provoquer.
#
# Elle se mesure maintenant en deux temps, et le premier NOMME l'élément qui dérive : un rejeu
# isolé qui ferait dériver autre chose que `pol:tracks_lecture_membre` serait un fait neuf, et le
# contrôle le dirait au lieu de le confondre avec la dérive attendue.
apres_rejeu_isole=$(empreinte)
derives=$(elements_derives "$avant" "$apres_rejeu_isole")
if [ "$derives" = "pol:tracks_lecture_membre" ]; then
	ok "le rejeu ISOLÉ fait dériver le SEUL prédicat dont la migration 34 est devenue l'autorité"
elif [ -z "$derives" ]; then
	fail "le rejeu isolé ne fait plus rien dériver : la 10 serait redevenue la dernière autorité sur tracks_lecture_membre — relire ce harnais"
else
	fail "le rejeu isolé fait dériver autre chose que le prédicat attendu : « $derives »"
fi

# Convergence, et non simple idempotence (décision 57) : une politique **retirée** est rétablie.
psql_db -c "drop policy track_members_suppression_admin on public.track_members;" >/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
[ "$(psql_db -c "select count(*) from pg_policies
                  where tablename = 'track_members'
                    and policyname = 'track_members_suppression_admin';")" = "1" ] \
	&& ok "une politique retirée à la main est **rétablie** par un rejeu : la migration répare" \
	|| fail "la politique retirée n'est pas rétablie"

# Second temps de la mesure : le rejeu COMPLET du répertoire doit rendre l'empreinte à l'octet
# près. Sans ce retour, tout ce qui s'exécute derrière ce harnais — les sections suivantes
# comprises, et les harnais suivants d'une série — mesurerait un produit dont la lecture
# transitive d'un track est amputée.
restaurer_etat_courant >/dev/null 2>&1
apres=$(empreinte)
[ "$avant" = "$apres" ] \
	&& ok "le rejeu COMPLET du répertoire rend l'empreinte à l'octet près : sept fonctions et quatre politiques" \
	|| fail "l'empreinte reste dérivée APRÈS rejeu complet du répertoire : « $(elements_derives "$avant" "$apres") »"

titre "3. Le seed est convergent, et pose exactement quatre droits fins"

compte_droits() {
	psql_db -c "select (select count(*) from public.track_members)::text || '/' ||
	                   (select count(*) from public.channel_members)::text;"
}
avant_seed=$(compte_droits)
supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed échoue"
apres_seed=$(compte_droits)
[ "$avant_seed" = "$apres_seed" ] && [ "$apres_seed" = "2/2" ] \
	&& ok "le seed est convergent : 2 droits de track, 2 de channel, avant comme après (§2.11)" \
	|| fail "droits fins avant « $avant_seed », après « $apres_seed », attendu « 2/2 »"

# Convergence de la valeur, et non seulement du nombre : un `access` faussé doit être corrigé.
psql_db -c "update public.track_members set access = 'member'
             where track_id = '$TRACK_CONSEIL' and user_id = '$U_VIEWER';" >/dev/null
supabase/seed/apply-seed.sh >/dev/null 2>&1 || true
[ "$(psql_db -c "select access from public.track_members
                  where track_id = '$TRACK_CONSEIL' and user_id = '$U_VIEWER';")" = "none" ] \
	&& ok "un \`access\` faussé à la main est **corrigé** par un rejeu du seed, pas seulement laissé" \
	|| fail "l'\`access\` faussé n'a pas été corrigé"

titre "4. La matrice mesurée contre l'API, avec les jetons réels"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_BIZDEV=$(jeton_de "$MAIL_BIZDEV")
T_VIEWER=$(jeton_de "$MAIL_VIEWER")
[ -n "$T_ADMIN" ] && [ -n "$T_BIZDEV" ] && [ -n "$T_VIEWER" ] \
	&& ok "jetons des trois profils obtenus par la véritable route de connexion" \
	|| fail "connexion d'un compte seedé impossible — le seed est-il appliqué ?"

# CONDITION DE VALIDITÉ DE TOUT CE QUI SUIT (décision 50) : les lignes existent. Sans elle,
# « zéro ligne » serait vrai que la politique refuse ou que la table soit vide.
n_service=$(http GET "$API/rest/v1/tracks?select=id&workspace_id=eq.$WS_SEED" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" >/dev/null; \
	jq -r 'length' < "$CORPS")
# RÉVISÉ PAR `CRM-077` : cinq tracks depuis que le seed en pose un en corbeille
# (docs/SPEC-seed.md §10). La corbeille ne restreint PAS la lecture (docs/SPEC-corbeille.md §2.2) :
# tous les profils la voient, comme ils voient l'archivé.
[ "$n_service" = "5" ] \
	&& ok "les cinq tracks du seed existent, vus par la clé de service" \
	|| fail "la clé de service ne voit que $n_service tracks : le seed est-il appliqué ?"

# RÉVISÉ PAR `CRM-077` : « 3 sur 4 » devient « 4 sur 5 ». Le track en corbeille est visible du
# `viewer` comme de tous — la corbeille ne restreint pas la lecture (docs/SPEC-corbeille.md §2.2) —,
# et le seul track qui lui reste masqué est toujours `conseil-ia`.
#
# CE COMPTE VAUT DANS LE CONTEXTE DE CE HARNAIS, ET C'EST À NOTER — INC-113. Le §3 ci-dessus rejoue
# `0010_droits_fins.sql` SEULE, ce qui ramène la politique de `tracks` à sa version `CRM-012` et
# retire la transitivité livrée par `0034_lecture_track_transitive.sql` (décision 333). Sur une base
# à jour, ce même `viewer` voit les CINQ tracks, `prospection` lui rouvrant `conseil-ia`. Ce harnais
# mesure donc un produit d'une arbitration en arrière, et ses comptes ne sont pas comparables à ceux
# de `e2e/api/tracks.spec.ts`, qui en attend cinq.
[ "$(lire "tracks?select=id&workspace_id=eq.$WS_SEED" "$T_VIEWER")" = "4" ] \
	&& ok "PREUVE N° 4 — le \`viewer\` ne voit que 4 des 5 tracks : son droit fin en masque un" \
	|| fail "le viewer voit $(lire "tracks?select=id&workspace_id=eq.$WS_SEED" "$T_VIEWER") tracks, attendu 4"

[ "$(lire "tracks?select=id&workspace_id=eq.$WS_SEED" "$T_ADMIN")" = "5" ] \
	&& ok "RÈGLE 2 — l'administratrice porte le **même** droit fin et voit les 5 : jamais restreinte" \
	|| fail "l'administratrice est restreinte par un droit fin, ce que le §2.2 interdit"

[ "$(lire "channels?select=id&id=eq.$CH_GRANDS_COMPTES" "$T_VIEWER")" = "0" ] \
	&& ok "le droit fin de **track** masque aussi ses channels, sans ligne \`channel_members\`" \
	|| fail "un channel du track fermé reste visible au viewer"

[ "$(lire "channels?select=id&id=eq.$CH_PROSPECTION" "$T_VIEWER")" = "1" ] \
	&& ok "et un \`channel_members = 'member'\` **rouvre** ce channel-là : le plus spécifique gagne" \
	|| fail "le channel rouvert par un droit fin n'est pas visible"

[ "$(lire 'track_members?select=user_id' '')" = "0" ] \
	&& ok "PREUVE N° 11 — l'anonyme ne lit aucun droit fin, et reçoit 200, non une erreur" \
	|| fail "l'anonyme lit des droits fins"

[ "$(lire 'track_members?select=user_id' "$T_VIEWER")" = "1" ] \
	&& ok "le \`viewer\` ne lit que **sa** ligne : un droit fin n'est pas une donnée d'équipe" \
	|| fail "le viewer lit des lignes qui ne le concernent pas"

[ "$(lire 'track_members?select=user_id' "$T_ADMIN")" = "2" ] \
	&& ok "l'administratrice lit les deux lignes de son workspace" \
	|| fail "l'administratrice ne lit pas toutes les lignes de droits fins"

titre "5. Ce que la base refuse, mesuré contre l'API"

code=$(http POST "$API/rest/v1/track_members" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-d "$(jq -nc --arg t "$TRACK_STUDIO" --arg u "$U_BIZDEV" \
	   '{track_id: $t, user_id: $u, access: "none"}')")
[ "$code" = "403" ] && [ "$(jq -r '.code' < "$CORPS")" = "42501" ] \
	&& ok "un \`business_developer\` ne pose aucun droit fin : 403, code 42501" \
	|| fail "pose d'un droit fin par un business_developer : code $code"

# DÉCISION 106 — LE CONTRÔLE LE PLUS FACILE À RATER DE CE HARNAIS.
# Un `USING` de politique `for delete` **filtre** : la commande réussit, rien n'est supprimé,
# aucune erreur n'est levée. Le refus se prouve en **relisant la ligne**, jamais par un code.
code=$(http DELETE "$API/rest/v1/track_members?track_id=eq.$TRACK_CONSEIL&user_id=eq.$U_VIEWER" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_VIEWER")
survivante=$(psql_db -c "select count(*) from public.track_members
                          where track_id = '$TRACK_CONSEIL' and user_id = '$U_VIEWER';")
[ "$survivante" = "1" ] \
	&& ok "le \`viewer\` ne lève pas sa propre restriction — la commande rend $code **sans erreur**, "\
"et la ligne est intacte : c'est la relecture qui le prouve (décision 106)" \
	|| fail "la restriction du viewer a été supprimée par lui-même"

# DÉCISION 107 — la régression qui a réellement eu lieu : `insert … returning` doit passer.
http DELETE "$API/rest/v1/tracks?slug=eq.tst-crm012-retour" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" >/dev/null
code=$(http POST "$API/rest/v1/tracks" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-H 'Prefer: return=representation' \
	-d "$(jq -nc --arg ws "$WS_SEED" '{workspace_id: $ws, name: "Retour", slug: "tst-crm012-retour"}')")
[ "$code" = "201" ] \
	&& ok "DÉCISION 107 — \`insert … returning\` sur \`tracks\` rend 201 : la politique n'évalue "\
"que les colonnes de la ligne, jamais une relecture de la table" \
	|| fail "insert … returning sur tracks rend $code : la politique relit-elle sa table ?"
http DELETE "$API/rest/v1/tracks?slug=eq.tst-crm012-retour" \
	-H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" >/dev/null

titre "6. Le harnais est non complaisant — trois dégradations réelles"

# --- Dégradation 1 : la politique de `tracks` revient à ignorer les droits fins ----------------
psql_db -c "
	drop policy tracks_lecture_membre on public.tracks;
	create policy tracks_lecture_membre on public.tracks for select to anon, authenticated
		using (app.is_workspace_member(workspace_id));
" >/dev/null
# RÉVISÉ PAR `CRM-077` : quatre devient cinq. La dégradation DISCRIMINE toujours — le `viewer` en
# voit 4 sous la politique des droits fins et 5 sous `is_workspace_member` —, et ce contrôle prouve
# donc bien que celui du §4 aurait échoué.
[ "$(lire "tracks?select=id&workspace_id=eq.$WS_SEED" "$T_VIEWER")" = "5" ] \
	&& ok "DÉGRADATION 1 — la politique revenue à \`is_workspace_member\` rouvre le track masqué : "\
"le contrôle du §4 aurait donc bien échoué" \
	|| fail "la dégradation 1 n'a rien changé : le contrôle du §4 ne prouve pas ce qu'il annonce"

# La politique des tracks est rétablie avant la dégradation suivante : sans cela, la dégradation 2
# porterait sur une fonction que la politique n'appelle plus, et le contrôle serait vert **sans
# rien prouver**. Mesuré : c'est exactement ce qui s'est produit à la première écriture de ce
# harnais.
psql_db -c "
	drop policy tracks_lecture_membre on public.tracks;
	create policy tracks_lecture_membre on public.tracks for select to anon, authenticated
		using (app.resolve_track_access(workspace_id, id) <> 'none');
" >/dev/null

# --- Dégradation 2 : `resolve_track_access` en jointure interne (décision 104) -----------------
# La faute la plus vraisemblable : un `left join` transformé en jointure interne, ou la condition
# déplacée dans le `where`. Le produit se ferme alors par défaut, silencieusement.
psql_db -c "
	create or replace function app.resolve_track_access(ws uuid, track uuid)
	returns text language sql stable security definer set search_path = '' as \$\$
		select app.resolve_access(app.workspace_role(ws), tm.access, null)
		  from public.track_members tm
		 where tm.track_id = track and tm.user_id = (select auth.uid());
	\$\$;
" >/dev/null
[ "$(lire "tracks?select=id&workspace_id=eq.$WS_SEED" "$T_BIZDEV")" = "0" ] \
	&& ok "DÉGRADATION 2 — la jointure interne **ferme tout** au \`business_developer\`, qui ne "\
"porte aucun droit fin : la décision 104 décrit un défaut réel, pas une précaution" \
	|| fail "la dégradation 2 n'a rien changé : la distinction NULL / 'none' n'est pas prouvée"

# --- Dégradation 3 : la politique de lecture des droits fins ouverte à tout membre -------------
psql_db -c "
	drop policy track_members_lecture on public.track_members;
	create policy track_members_lecture on public.track_members for select to anon, authenticated
		using (app.is_workspace_member(app.track_workspace(track_id)));
" >/dev/null
[ "$(lire 'track_members?select=user_id' "$T_VIEWER")" = "2" ] \
	&& ok "DÉGRADATION 3 — la lecture ouverte à tout membre montre au \`viewer\` la ligne de sa "\
"collègue : la règle de la décision 105 est bien celle qui l'en empêche" \
	|| fail "la dégradation 3 n'a rien changé : la restriction de lecture n'est pas prouvée"

titre "7. Restauration constatée, et non supposée"

# LA RESTAURATION PASSE PAR LE RUNNER, PLUS PAR UN REJEU ISOLÉ DE LA MIGRATION 10 — INC-213.
# Rejouer la 10 seule laissait `tracks_lecture_membre` amputée de la lecture transitive de la
# migration 34, et cette section CERTIFIAIT cet état : son contrôle de prédicat cherche
# `resolve_track_access`, présent des deux côtés, et son contrôle de compte attendait le nombre
# que SEUL l'état amputé produit. Une restauration qui se déclare réussie sur l'état qu'elle a
# elle-même dégradé n'est pas une restauration ; c'est le faux vert que `CLAUDE.md` §17 proscrit.
restaurer_etat_courant >/dev/null 2>&1

restaure=$(psql_db -c "
	select (select case when pg_get_expr(polqual, polrelid) like '%resolve_track_access%'
	                    then 'fine' else 'large' end
	          from pg_policy where polname = 'tracks_lecture_membre')
	    || '/' ||
	       (select case when pg_get_functiondef(p.oid) like '%left join%'
	                     or pg_get_functiondef(p.oid) like '%select tm.access from%'
	                    then 'externe' else 'interne' end
	          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
	         where n.nspname = 'app' and p.proname = 'resolve_track_access')
	    || '/' ||
	       (select case when pg_get_expr(polqual, polrelid) like '%is_workspace_admin%'
	                    then 'admin' else 'membre' end
	          from pg_policy where polname = 'track_members_lecture');
")
[ "$restaure" = "fine/externe/admin" ] \
	&& ok "restauration constatée : la politique des tracks applique de nouveau le droit fin, la "\
"résolution est de nouveau tolérante à l'absence de ligne, et la lecture est de nouveau réservée" \
	|| fail "restauration incomplète : « $restaure », attendu « fine/externe/admin »"

# CE COMPTE EST RÉVISÉ, JAMAIS RELÂCHÉ — mécanisme de la décision 51, et son motif est MESURÉ.
# Il attendait « 4 tracks sur 5 » pour la lectrice, et ce nombre était celui de l'état AMPUTÉ que
# la restauration isolée laissait derrière elle. Dans l'état que le runner produit, la lectrice en
# lit **cinq** : le seed lui ferme `conseil-ia` au niveau du track, puis lui ROUVRE le channel
# `prospection`, et la migration 34 rend alors le track visible — sans quoi un channel joignable
# vivrait dans un track invisible.
[ "$(lire "tracks?select=id&workspace_id=eq.$WS_SEED" "$T_VIEWER")" = "5" ] \
	&& ok "et la lectrice lit de nouveau les cinq tracks : son channel rouvert rend son track visible (migration 34)" \
	|| fail "après restauration, la lectrice ne retrouve pas la lecture transitive de son track"

# LE REFUS N'EST PAS PERDU AU PASSAGE, IL EST MESURÉ LÀ OÙ IL TIENT ENCORE — et il y est plus
# strict. Le droit fin de la lectrice ne masque plus le track, mais il masque toujours les DEUX
# autres channels de `conseil-ia`, `grands-comptes` et `appels-offres` : elle lit six channels sur
# huit. Sans cette ligne, réviser le compte au-dessus aurait retiré une preuve de refus au lieu de
# la déplacer, ce que `CLAUDE.md` §18 interdit.
[ "$(lire "channels?select=id" "$T_VIEWER")" = "6" ] \
	&& ok "et le refus reste opposé à la lectrice là où il tient : 6 channels sur 8, \`grands-comptes\` et \`appels-offres\` masqués" \
	|| fail "après restauration, le droit fin de la lectrice ne masque plus ses deux channels"

[ "$(lire "tracks?select=id&workspace_id=eq.$WS_SEED" "$T_BIZDEV")" = "5" ] \
	&& ok "et le \`business_developer\`, qu'aucun droit fin ne ferme, voit de nouveau les cinq" \
	|| fail "après restauration, le business_developer reste fermé"

titre "8. Non-régression des unités précédentes"

for harnais in verify-stack verify-migrations verify-authz verify-seed verify-tracks \
               verify-channels verify-catalogue verify-workflows verify-copie-workflow \
               verify-coherence-workflow verify-champs-formulaire; do
	if [ "$RAPIDE" = true ]; then
		scripts/$harnais.sh --rapide >/dev/null 2>&1 \
			&& ok "$harnais.sh --rapide" || fail "$harnais.sh --rapide"
	else
		scripts/$harnais.sh --rapide >/dev/null 2>&1 \
			&& ok "$harnais.sh --rapide" || fail "$harnais.sh --rapide"
	fi
done

titre "9. Suites, tests unitaires et build"

if [ "$RAPIDE" = true ]; then
	printf '  (ignorés : --rapide)\n'
else
	npm run test:sql   >/dev/null 2>&1 && ok "npm run test:sql"   || fail "npm run test:sql"
	npm run test:unit  >/dev/null 2>&1 && ok "npm run test:unit"  || fail "npm run test:unit"
	npm run typecheck  >/dev/null 2>&1 && ok "npm run typecheck"  || fail "npm run typecheck"
	npm run types:check >/dev/null 2>&1 && ok "npm run types:check" || fail "npm run types:check"
	npm run build      >/dev/null 2>&1 && ok "npm run build"      || fail "npm run build"
	npm run e2e:api    >/dev/null 2>&1 && ok "npm run e2e:api"    || fail "npm run e2e:api"
	npm run e2e:ui     >/dev/null 2>&1 && ok "npm run e2e:ui"     || fail "npm run e2e:ui"
fi

titre "Résultat"
if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%d contrôles, aucune anomalie.\033[0m\n\n' "$checks"
else
	printf '  \033[31m%d contrôles, %d en échec.\033[0m\n\n' "$checks" "$failures"
	exit 1
fi
