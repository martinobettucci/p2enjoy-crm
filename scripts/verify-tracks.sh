#!/usr/bin/env bash
# @verifies CRM-020 (docs/BACKLOG.md) — Definition of Done des tracks
# @verifies docs/SPEC-tracks.md §2 (modèle), §3 (ordre), §4 (archivage), §5 (autorisations),
#           §6 (contrat d'API mesuré), §8 (seed), §9 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 3 et n° 11)
# @verifies docs/SCHEMA.md §2 (organisation) ; docs/PROD_MIGRATIONS.md §3
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-020` :
#
#   1. la suite pgTAP `supabase/tests/0004_tracks.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier la structure de la table, ses politiques ni ses privilèges ;
#   3. le seed est **convergent** : rejoué, il laisse exactement quatre tracks, dont un archivé ;
#   4. les scénarios d'API et d'interface sont verts (`npm run e2e:api`, `npm run e2e:ui`), ainsi
#      que les tests unitaires et le build ;
#   5. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve pas qu'un track s'affiche à un utilisateur connecté : la webapp n'a aucun parcours
# de connexion (`docs/INCONSISTENCY_REPORT.md`, INC-021), son client est anonyme, et la politique
# de lecture ne lui consent aucune ligne. C'est une limite du **produit**, pas du harnais, et elle
# est nommée dans `docs/BACKLOG.md` plutôt que masquée par une preuve qui n'en serait pas une.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-tracks.sh
#   scripts/verify-tracks.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0004_tracks.test.sql
MIGRATION_FILE=supabase/migrations/0003_tracks.sql
# `0010` redéfinit `tracks_lecture_membre` : toute réapplication de `0003` doit être suivie de la
# sienne, comme le fait le `migrations-runner` (docs/PROD_MIGRATIONS.md §3, dépendance de 0010).
MIGRATION_DROITS_FINS=supabase/migrations/0010_droits_fins.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
TRACK_CONSEIL=5eed0000-0000-4000-8000-000000000021
MAIL_ADMIN=admin@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,32p' "$0"; exit 0 ;;
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

psql_db() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA "$@"; }

CORPS=/tmp/p2enjoy-tracks-body
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

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser un workspace
# de preuve ni un track de preuve derrière elle.
menage() {
	psql_db -c "
		delete from public.tracks where slug like 'tst-crm020-%';
		delete from public.workspaces where slug like 'tst-crm020-%';
	" >/dev/null 2>&1 || true
	rm -f "$CORPS"
}
trap menage EXIT

echo
echo "Preuves de CRM-020 — tracks"
echo

if ! docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" >/dev/null 2>&1; then
	echo "ERREUR : conteneur $DB_CONTAINER absent. Lancez ./runDev.sh." >&2
	exit 1
fi

# --- 1. Suite pgTAP ----------------------------------------------------------------------------

echo "1. Suite pgTAP"

lire_tap() {
	local fichier=$1 sortie tap_ok tap_ko tap_plan
	sortie=$(psql_db -v ON_ERROR_STOP=1 -f - < "$fichier" 2>&1 || true)
	tap_ok=$(printf '%s\n' "$sortie" | grep -cE '^ok ' || true)
	tap_ko=$(printf '%s\n' "$sortie" | grep -cE '^not ok ' || true)
	tap_plan=$(printf '%s\n' "$sortie" | grep -cE '^# Looks like you planned' || true)
	if [ "$tap_ko" -eq 0 ] && [ "$tap_ok" -gt 0 ] && [ "$tap_plan" -eq 0 ]; then
		ok "$fichier : $tap_ok assertions, aucune anomalie"
	else
		fail "$fichier : $tap_ok réussies, $tap_ko échouées, écart de plan=$tap_plan"
		printf '%s\n' "$sortie" | grep -E '^(not ok|# )' | sed 's/^/        /'
	fi
}

lire_tap "$TEST_FILE"

# La suite de `CRM-003` porte l'assertion sur la clé étrangère qu'INC-010 avait différée et que
# cette unité rétablit : la rejouer ici prouve que la révision est cohérente, et non contournée.
lire_tap supabase/tests/0001_identite_et_cloisonnement.test.sql

# --- 2. Rejouabilité de la migration -----------------------------------------------------------

echo
echo "2. Rejouabilité de la migration"

empreinte_tracks() {
	psql_db -c "
		select
			(select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod)
			                   || ':' || a.attnotnull::text, ',' order by a.attnum)
			   from pg_attribute a
			  where a.attrelid = 'public.tracks'::regclass and a.attnum > 0 and not a.attisdropped)
			|| '||' ||
			(select coalesce(string_agg(pg_get_constraintdef(c.oid), ',' order by c.conname), '')
			   from pg_constraint c where c.conrelid = 'public.tracks'::regclass)
			|| '||' ||
			(select coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '-')
			                            || ':' || coalesce(p.with_check, '-'), ',' order by p.policyname), '')
			   from pg_policies p where p.schemaname = 'public' and p.tablename = 'tracks')
			|| '||' ||
			(select coalesce(array_to_string(c.relacl, ','), '')
			   from pg_class c where c.oid = 'public.tracks'::regclass);"
}

# RÉVISÉ À `CRM-012`, et le motif est une **dépendance d'ordre**, non un défaut.
#
# `0003_tracks.sql` définit la politique `tracks_lecture_membre` ; `0010_droits_fins.sql` la
# **redéfinit** pour y appliquer les droits fins. Le `migrations-runner` rejoue tout le répertoire
# dans l'ordre, si bien que l'état final est toujours celui de `0010`. Mais ce harnais rejouait
# `0003` **seule** : il ramenait donc la base à l'état de `CRM-020`, faisait échouer sa propre
# empreinte, et laissait le produit dégradé derrière lui.
#
# La correction n'est pas de retirer la politique de `0003` — ce serait rouvrir un livrable de
# `CRM-020` (`CLAUDE.md` §13) — mais de rejouer la **paire**, comme le fait le runner. La
# dépendance est inscrite dans `docs/PROD_MIGRATIONS.md` §3.

avant=$(empreinte_tracks)
if psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 	&& psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_DROITS_FINS" >/dev/null 2>&1; then
	ok "la migration se réapplique sans erreur sur une base déjà migrée, suivie de 0010 comme le "\
"fait le migrations-runner"
else
	fail "la migration échoue au second passage : elle n'est pas idempotente"
fi
apres=$(empreinte_tracks)
if [ "$avant" = "$apres" ]; then
	ok "structure, contraintes, politiques et privilèges inchangés après rejeu"
else
	fail "le rejeu a modifié la table"
	diff <(printf '%s\n' "$avant") <(printf '%s\n' "$apres") | sed 's/^/        /' || true
fi

# Le `migrations-runner` rejoue **tout** le répertoire à chaque démarrage : c'est lui, et non
# `psql`, qui décide si la pile démarre.
if docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml \
		run --rm migrations-runner >/dev/null 2>&1; then
	ok "le migrations-runner rejoue le répertoire complet et se termine en 0"
else
	fail "le migrations-runner échoue : la pile ne redémarrerait pas"
fi

# --- 3. Convergence du seed --------------------------------------------------------------------

echo
echo "3. Convergence du seed (docs/SPEC-tracks.md §8)"

if supabase/seed/apply-seed.sh >/dev/null 2>&1; then
	ok "le seed se rejoue sans erreur"
else
	fail "le seed échoue au rejeu"
fi

total=$(psql_db -c "select count(*) from public.tracks where workspace_id = '$WS_SEED';")
archives=$(psql_db -c "select count(*) from public.tracks where workspace_id = '$WS_SEED' and archived_at is not null;")
ordre=$(psql_db -c "select string_agg(slug, ',' order by position) from public.tracks
                     where workspace_id = '$WS_SEED' and archived_at is null;")

[ "$total" = "4" ] && ok "quatre tracks après rejeu, sans doublon" \
	|| fail "après rejeu du seed : $total tracks au lieu de 4"
[ "$archives" = "1" ] && ok "l'état « archivé » est réellement représenté" \
	|| fail "tracks archivés : $archives au lieu de 1"
[ "$ordre" = "conseil-ia,studio-web,formation" ] && ok "l'ordre des tracks actifs est celui du contrat" \
	|| fail "ordre inattendu : $ordre"

# --- 4. Contrat d'API, avec les jetons réels ---------------------------------------------------

echo
echo "4. Contrat d'API — docs/SPEC-tracks.md §6"

JETON_ADMIN=$(jeton_de "$MAIL_ADMIN")
JETON_VIEWER=$(jeton_de "$MAIL_VIEWER")
if [ -n "$JETON_ADMIN" ] && [ -n "$JETON_VIEWER" ]; then
	ok "jetons obtenus par la véritable route de connexion, pour deux profils"
else
	fail "connexion impossible : le seed est-il appliqué ?"
fi

code=$(http GET "$API/rest/v1/tracks?select=id" -H "apikey: $ANON_KEY")
corps=$(cat "$CORPS")
if [ "$code" = "200" ] && [ "$corps" = "[]" ]; then
	ok "ligne b — preuve de refus n° 11 : l'anonyme obtient 200 et zéro ligne"
else
	fail "ligne b — l'anonyme obtient $code / $corps"
fi

# RÉVISÉ À `CRM-012`. Ce contrôle vérifiait que le `viewer` voit les **quatre** tracks — « lire
# n'exige pas d'écrire ». Depuis `CRM-012`, le seed pose un `track_members.access = 'none'` sur
# Farida Nowak (docs/SPEC-seed.md §2.11) : elle n'en voit plus que trois, et c'est le comportement
# voulu. Le contrôle est **retourné**, et son intention d'origine — un rôle en lecture seule lit
# tout ce qu'un administrateur lit — est reportée sur le `business_developer`, qu'aucun droit fin
# ne vise.
code=$(http GET "$API/rest/v1/tracks?select=id" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $JETON_VIEWER")
nb=$(jq 'length' "$CORPS" 2>/dev/null || echo 0)
if [ "$code" = "200" ] && [ "$nb" = "3" ]; then
	ok "ligne d — le viewer lit trois tracks sur quatre : son droit fin en masque un (CRM-012)"
else
	fail "ligne d — le viewer obtient $code et $nb ligne(s), attendu 3"
fi

code=$(http POST "$API/rest/v1/tracks" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $JETON_VIEWER" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"name\":\"Interdit\",\"slug\":\"tst-crm020-refus\"}")
if [ "$code" = "403" ] && [ "$(jq -r '.code' "$CORPS")" = "42501" ]; then
	ok "ligne e — un viewer ne crée aucun track : 403, code 42501"
else
	fail "ligne e — le viewer obtient $code / $(head -c 120 "$CORPS")"
fi

code=$(http DELETE "$API/rest/v1/tracks?id=eq.$TRACK_CONSEIL" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $JETON_ADMIN")
if [ "$code" = "403" ] && [ "$(jq -r '.code' "$CORPS")" = "42501" ]; then
	ok "ligne i — la suppression physique est refusée même à un administrateur"
else
	fail "ligne i — l'administrateur obtient $code / $(head -c 120 "$CORPS")"
fi

reste=$(psql_db -c "select count(*) from public.tracks where id = '$TRACK_CONSEIL';")
[ "$reste" = "1" ] && ok "le refus de suppression n'a rien supprimé à moitié" \
	|| fail "le track visé par la suppression a disparu"

# --- 5. Suites automatisées --------------------------------------------------------------------

echo
echo "5. Suites automatisées"

lancer() {
	local libelle=$1
	shift
	if "$@" >/tmp/p2enjoy-tracks-suite.log 2>&1; then
		ok "$libelle"
	else
		fail "$libelle"
		tail -n 12 /tmp/p2enjoy-tracks-suite.log | sed 's/^/        /'
	fi
}

lancer "npm run test:unit" npm run --silent test:unit
lancer "npm run typecheck" npm run --silent typecheck
lancer "npm run types:check — le fichier généré suit le schéma" npm run --silent types:check

if [ "$RAPIDE" = false ]; then
	lancer "npm run build" npm run --silent build
	lancer "npm run e2e:api" npm run --silent e2e:api
	lancer "npm run e2e:ui" npm run --silent e2e:ui
else
	echo "  (--rapide : build et Playwright non exécutés)"
fi

# --- 6. Captures attendues ---------------------------------------------------------------------

echo
echo "6. Captures observées (CLAUDE.md §16)"

for capture in tracks-vides-1440 tracks-charges-1440 tracks-chargement-1440 tracks-refus-1440 \
               tracks-palier-xl-1440 tracks-palier-lg-1152 tracks-palier-md-900 tracks-palier-sm-390; do
	if [ -s "docs/captures/CRM-020/$capture.jpg" ]; then
		ok "capture $capture.jpg présente"
	else
		fail "capture $capture.jpg manquante"
	fi
done

TRAVAIL_JETONS=$(mktemp)

# --- 7. Non-complaisance -----------------------------------------------------------------------
# Le harnais doit **échouer** quand le produit est affaibli. Sans cette section, rien ne
# distinguerait un harnais qui mesure d'un harnais qui acquiesce.
#
# Chaque dégradation est réellement appliquée à la base, la preuve correspondante est rejouée, et
# l'état d'origine est restauré puis **constaté**.

echo
echo "7. Non-complaisance — le harnais échoue-t-il quand le produit est affaibli ?"

sonde_pgtap() {
	local sortie
	sortie=$(psql_db -v ON_ERROR_STOP=1 -f - < "$TEST_FILE" 2>&1 || true)
	printf '%s\n' "$sortie" | grep -cE '^not ok ' || true
}

verifier_mutation() {
	local libelle=$1 mutation=$2
	psql_db -v ON_ERROR_STOP=1 -c "$mutation" >/dev/null 2>&1 || {
		fail "dégradation « $libelle » non applicable : le contrôle n'a pas pu être mené"
		return
	}
	local echecs
	echecs=$(sonde_pgtap)
	if [ "$echecs" -gt 0 ]; then
		ok "dégradation « $libelle » : la suite pgTAP échoue bien ($echecs assertion(s))"
	else
		fail "dégradation « $libelle » : la suite reste verte — le harnais est complaisant"
	fi
	# Restauration par réapplication des migrations : ce sont les fichiers versionnés qui font
	# autorité, pas une commande inverse écrite à la main qui pourrait diverger.
	#
	# **La paire, et dans l'ordre du runner** : `0010_droits_fins.sql` redéfinit
	# `tracks_lecture_membre` pour y appliquer les droits fins. Restaurer `0003` seule ramènerait
	# la politique à l'état de `CRM-020` et laisserait le produit dégradé — mesuré à `CRM-012`.
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_DROITS_FINS" >/dev/null 2>&1 || true
}

verifier_mutation "l'écriture est ouverte à tout membre du workspace" \
	"drop policy tracks_insertion_admin on public.tracks;
	 create policy tracks_insertion_admin on public.tracks for insert to authenticated
	   with check (app.is_workspace_member(workspace_id));"

verifier_mutation "le WITH CHECK de la mise à jour est retiré" \
	"drop policy tracks_maj_admin on public.tracks;
	 create policy tracks_maj_admin on public.tracks for update to authenticated
	   using (app.is_workspace_admin(workspace_id));"

verifier_mutation "la contrainte de couleur est retirée" \
	"alter table public.tracks drop constraint tracks_color_check;"

verifier_mutation "la suppression physique est ouverte à authenticated" \
	"grant delete on public.tracks to authenticated;"

verifier_mutation "le trigger d'attribution de position est retiré" \
	"drop trigger tracks_attribuer_position on public.tracks;"

verifier_mutation "la lecture est ouverte à tout le monde" \
	"drop policy tracks_lecture_membre on public.tracks;
	 create policy tracks_lecture_membre on public.tracks for select to anon, authenticated
	   using (true);"

# Une dégradation du **seed**, et non du schéma : elle doit faire échouer les assertions du §9 de
# la suite, celles qui tiennent le contrat du seed.
psql_db -c "update public.tracks set archived_at = null where workspace_id = '$WS_SEED';" >/dev/null 2>&1
echecs=$(sonde_pgtap)
if [ "$echecs" -gt 0 ]; then
	ok "dégradation « le seed n'a plus de track archivé » : la suite échoue bien ($echecs)"
else
	fail "dégradation « le seed n'a plus de track archivé » : la suite reste verte"
fi
supabase/seed/apply-seed.sh >/dev/null 2>&1 || true

# Dégradation du **jeton de contraste**, et non de la base : elle éprouve la preuve ajoutée à
# `e2e/ui/tracks.spec.ts`, celle qui mesure le contraste sur le rendu réel. Sans elle, rien ne
# distinguerait « la conformité AA est mesurée » de « la conformité AA est déclarée » — et c'est
# précisément cette confusion qui avait laissé passer `success` à 3,82:1.
#
# La restauration est garantie par un `trap` : un échec en cours de route ne doit pas laisser le
# dépôt modifié.
JETONS_CSS=webapp/src/styles/tokens.css
cp "$JETONS_CSS" "$TRAVAIL_JETONS"
trap 'cp "$TRAVAIL_JETONS" "$JETONS_CSS" 2>/dev/null; rm -f "$TRAVAIL_JETONS"' EXIT
EMPREINTE_JETONS=$(sha256sum "$JETONS_CSS" | cut -d' ' -f1)

sed -i 's|^\t--color-success-on-soft: .*$|\t--color-success-on-soft: var(--color-success);|' "$JETONS_CSS"
if grep -q -- '--color-success-on-soft: var(--color-success);' "$JETONS_CSS"; then
	ok "dégradation « texte du jeton success ramené à la couleur pleine » : réellement appliquée"
else
	fail "la dégradation du jeton n'a pas été appliquée — le contrôle suivant serait sans valeur"
fi

if npm run --silent e2e:ui >/dev/null 2>&1; then
	fail "dégradation « contraste du jeton success » : le projet « ui » reste vert — le harnais est complaisant"
else
	ok "dégradation « contraste du jeton success » : le projet « ui » échoue bien"
fi

cp "$TRAVAIL_JETONS" "$JETONS_CSS"
trap - EXIT
rm -f "$TRAVAIL_JETONS"

# --- 8. Restauration constatée, pas supposée ---------------------------------------------------

echo
echo "8. Le harnais a-t-il tout restauré ?"

politiques=$(psql_db -c "select string_agg(policyname, ',' order by policyname)
                           from pg_policies where schemaname='public' and tablename='tracks';")
if [ "$politiques" = "tracks_insertion_admin,tracks_lecture_membre,tracks_maj_admin" ]; then
	ok "les trois politiques d'origine sont en place, et elles seules"
else
	fail "politiques après restauration : $politiques"
fi

delete_acc=$(psql_db -c "select has_table_privilege('authenticated', 'public.tracks', 'DELETE');")
[ "$delete_acc" = "f" ] && ok "authenticated n'a toujours pas le privilège DELETE" \
	|| fail "le privilège DELETE est resté accordé à authenticated"

archives=$(psql_db -c "select count(*) from public.tracks where workspace_id = '$WS_SEED' and archived_at is not null;")
[ "$archives" = "1" ] && ok "le seed est revenu à son contrat : un track archivé" \
	|| fail "après restauration, tracks archivés : $archives"

# L'empreinte est comparée à celle relevée AVANT la dégradation, et non à la version committée :
# ce harnais est rejoué sur un arbre de travail modifié — c'est même son cas d'usage principal,
# juste avant le commit.
if [ "$(sha256sum "$JETONS_CSS" | cut -d' ' -f1)" = "$EMPREINTE_JETONS" ]; then
	ok "le fichier de jetons est rendu octet pour octet identique à son état d'avant dégradation"
else
	fail "$JETONS_CSS diffère de son état d'avant dégradation"
fi

lire_tap "$TEST_FILE"

# --- Bilan -------------------------------------------------------------------------------------

echo
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%s contrôles, aucune anomalie.\033[0m\n' "$checks"
	exit 0
fi

printf '\033[31m%s contrôles, %s anomalie(s).\033[0m\n' "$checks" "$failures"
exit 1
