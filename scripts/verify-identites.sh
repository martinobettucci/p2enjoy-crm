#!/usr/bin/env bash
# @verifies CRM-022 (docs/BACKLOG.md) — identités lisibles et memberships sûrs
# @verifies docs/SPEC-identite.md §4 à §10
# @verifies docs/SCHEMA.md §1 et §5
#
# Reproduit l'état legacy concerné sur la base seedée, applique la vraie migration, vérifie que les
# données n'ont pas bougé et que son rejeu conserve les OID. Il exerce ensuite pgTAP, les vrais JWT
# et le parcours UI, puis affaiblit successivement chaque famille de politique, un privilège de
# colonne, la garde du dernier admin, la FK de parole historique et une borne de profil. Chaque
# affaiblissement doit rendre la suite ciblée rouge ; le trap réapplique toujours la migration.

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

DB_CONTAINER=p2enjoy-db
MIGRATION=supabase/migrations/0021_identites_et_memberships_surs.sql
MIGRATION_COMMENTAIRES=supabase/migrations/0015_commentaires.sql
TEST_SQL=supabase/tests/0023_identites_et_memberships_surs.test.sql
SPEC_API=e2e/api/identites.spec.ts
SPEC_REFUS=e2e/api/preuves-refus.spec.ts
SPEC_UI=e2e/ui/identites.spec.ts

checks=0
failures=0
restore_needed=false
WORK=$(mktemp -d)

ok()   { checks=$((checks + 1)); printf '  \033[32mOK\033[0m    %s\n' "$1"; }
fail() { checks=$((checks + 1)); failures=$((failures + 1)); printf '  \033[31mECHEC\033[0m %s\n' "$1"; }

psql_db() {
	docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -qtA -v ON_ERROR_STOP=1 "$@"
}

appliquer_migration() {
	psql_db -f - < "$MIGRATION"
}

restaurer() {
	set +e
	appliquer_migration >/dev/null 2>&1
	set -e
}

cleanup() {
	local status=$?
	trap - EXIT
	if [ "$restore_needed" = true ]; then
		restaurer || status=1
	fi
	rm -rf -- "$WORK"
	exit "$status"
}
trap cleanup EXIT

suite_verte() {
	scripts/run-sql-tests.sh "$TEST_SQL" > "$WORK/tap.log" 2>&1 \
		&& grep -q '1 fichiers, 84 assertions, aucune anomalie' "$WORK/tap.log"
}

suite_rouge() {
	if scripts/run-sql-tests.sh "$TEST_SQL" > "$WORK/tap-red.log" 2>&1; then
		return 1
	fi
	grep -Eq 'ECHEC|not ok|psql a échoué' "$WORK/tap-red.log"
}

api_verte() {
	E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_API" --workers=1 > "$WORK/api.log" 2>&1 \
		&& grep -q '5 passed' "$WORK/api.log"
}

dernier_admin_api_vert() {
	E2E_PROJETS=api npx playwright test --config e2e/playwright.config.ts --project=api \
		"$SPEC_REFUS" --grep 'PREUVE N° 10' --workers=1 > "$WORK/api-admin.log" 2>&1 \
		&& grep -q '2 passed' "$WORK/api-admin.log"
}

ui_verte() {
	E2E_PROJETS=ui npx playwright test --config e2e/playwright.config.ts --project=ui \
		"$SPEC_UI" --workers=1 > "$WORK/ui.log" 2>&1 \
		&& grep -q '1 passed' "$WORK/ui.log"
}

empreinte_metier() {
	psql_db -c "select md5(coalesce(string_agg(ligne, E'\\n' order by ligne), ''))
		from (
			select 'profile:' || row_to_json(p)::text as ligne from public.profiles p
			union all select 'workspace:' || row_to_json(w)::text from public.workspaces w
			union all select 'membership:' || row_to_json(wm)::text from public.workspace_members wm
			union all select 'comment:' || row_to_json(cc)::text from public.card_comments cc
		) donnees;"
}

identites_objets() {
	psql_db -c "select string_agg(type || ':' || nom || ':' || oid::text, '|' order by type, nom)
		from (
			select 'constraint' as type, conname as nom, oid from pg_constraint
			 where (conrelid='public.profiles'::regclass
			        and conname in ('profiles_full_name_check','profiles_avatar_url_check'))
			    or (conrelid='public.card_comments'::regclass
			        and conname='card_comments_author_id_fkey')
			union all
			select 'trigger', tgname, oid from pg_trigger
			 where not tgisinternal and (
				(tgrelid='public.profiles'::regclass and tgname='profiles_normaliser_nom')
				or (tgrelid='public.workspace_members'::regclass
				    and tgname='workspace_members_garder_admin'))
			union all
			select 'policy', polname, oid from pg_policy
			 where polrelid in ('public.profiles'::regclass, 'public.workspaces'::regclass,
			                    'public.workspace_members'::regclass)
			union all
			select 'function', p.proname, p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
			 where n.nspname='app' and p.proname in
			 ('profile_normaliser_nom','handle_new_user','card_comments_avant_maj',
			  'workspace_members_garder_admin','migration_0021_converger_politique')
		) objets;"
}

degrader_et_verifier() {
	local libelle=$1
	local degradation=$2
	psql_db -c "$degradation" >/dev/null
	if suite_rouge; then
		ok "dégradation vue : $libelle"
	else
		fail "DÉGRADATION NON VUE : $libelle"
	fi
	appliquer_migration >/dev/null 2>&1
}

echo
echo "Preuves de CRM-022 — identités et memberships sûrs"
echo

echo "1. Prérequis et traçabilité"
if [ ! -f .env ] || ! grep -q '^P2ENJOY_ENV_PROFILE=dev$' .env; then
	echo "ERREUR : ce harnais exige le profil local dev dans .env." >&2
	exit 1
fi
if [ "$(docker inspect -f '{{.State.Status}}' "$DB_CONTAINER" 2>/dev/null || true)" != running ]; then
	echo "ERREUR : conteneur $DB_CONTAINER absent ou arrêté. Lancez ./runDev.sh." >&2
	exit 1
fi
for fichier in "$MIGRATION" "$TEST_SQL" "$SPEC_API" "$SPEC_UI"; do
	if [ -f "$fichier" ]; then ok "$fichier est livré"; else fail "$fichier est absent"; fi
done
if head -3 "$MIGRATION" | grep -q '@spec CRM-022' \
	&& head -3 "$TEST_SQL" | grep -q '@verifies CRM-022' \
	&& head -3 "$SPEC_API" | grep -q '@verifies CRM-022' \
	&& head -3 "$SPEC_UI" | grep -q '@verifies CRM-022'; then
	ok "migration, SQL, API et UI citent tous CRM-022"
else
	fail "la traçabilité CRM-022 manque dans un livrable"
fi

restore_needed=true

echo
echo "2. Mise à niveau d'un état legacy seedé"
avant_metier=$(empreinte_metier)

# État de CRM-043 : auteur obligatoire, FK sans SET NULL et trigger qui gèle tout author_id.
psql_db -c "
	drop policy if exists profiles_lecture_equipe on public.profiles;
	drop policy if exists profiles_maj_propre on public.profiles;
	drop policy if exists workspaces_lecture_membre on public.workspaces;
	drop policy if exists workspace_members_lecture_membre on public.workspace_members;
	drop policy if exists workspace_members_insertion_admin on public.workspace_members;
	drop policy if exists workspace_members_maj_admin on public.workspace_members;
	drop policy if exists workspace_members_suppression_admin on public.workspace_members;
	drop trigger if exists profiles_normaliser_nom on public.profiles;
	drop trigger if exists workspace_members_garder_admin on public.workspace_members;
	drop function if exists app.profile_normaliser_nom();
	drop function if exists app.workspace_members_garder_admin();
	alter table public.profiles drop constraint if exists profiles_full_name_check;
	alter table public.profiles drop constraint if exists profiles_avatar_url_check;
	alter table public.card_comments drop constraint if exists card_comments_author_id_fkey;
	alter table public.card_comments alter column author_id set not null;
	alter table public.card_comments add constraint card_comments_author_id_fkey
		foreign key (author_id) references public.profiles(id);
	revoke all on public.profiles from anon, authenticated;
	grant select on public.profiles to anon, authenticated;
	grant update on public.profiles to authenticated;
	revoke all on public.workspaces from anon, authenticated;
	grant select on public.workspaces to anon, authenticated;
	grant insert, update, delete on public.workspaces to authenticated;
	revoke all on public.workspace_members from anon, authenticated;
	grant select, insert, update, delete on public.workspace_members to authenticated;
" >/dev/null
psql_db -f - < "$MIGRATION_COMMENTAIRES" >/dev/null 2>&1

if appliquer_migration > "$WORK/legacy.log" 2>&1; then
	ok "la vraie migration met à niveau l'état legacy sans erreur"
else
	fail "la migration échoue sur l'état legacy seedé"
	tail -n 20 "$WORK/legacy.log" | sed 's/^/        /'
fi
if [ "$avant_metier" = "$(empreinte_metier)" ]; then
	ok "la mise à niveau ne modifie aucune donnée d'identité ni parole seedée"
else
	fail "une donnée métier a changé pendant la mise à niveau"
fi

echo
echo "3. Convergence et stabilité des objets conformes"
objets_avant=$(identites_objets)
if appliquer_migration > "$WORK/replay.log" 2>&1; then
	if grep -Eqi 'warning|error|fatal' "$WORK/replay.log"; then
		fail "le rejeu émet un warning ou une erreur"
	else
		ok "la migration se rejoue sans warning ni erreur"
	fi
else
	fail "la migration échoue sur son propre état final"
fi
objets_apres=$(identites_objets)
if [ "$objets_avant" = "$objets_apres" ]; then
	ok "le rejeu conserve les OID des contraintes, fonctions, triggers et sept politiques"
else
	fail "le rejeu reconstruit encore un objet conforme"
fi
if [ "$avant_metier" = "$(empreinte_metier)" ]; then
	ok "le rejeu conserve lui aussi l'empreinte métier"
else
	fail "le rejeu a modifié une donnée métier"
fi

echo
echo "4. Contrats SQL, API et parcours utilisateur"
if suite_verte; then
	ok "suite pgTAP ciblée verte — 84 assertions"
else
	fail "suite pgTAP CRM-022 en échec ou compte inattendu"
	tail -n 30 "$WORK/tap.log" | sed 's/^/        /'
fi
if api_verte; then
	ok "preuve API ciblée verte — 5 scénarios avec vrais JWT et second workspace"
else
	fail "preuve API CRM-022 en échec"
	tail -n 30 "$WORK/api.log" | sed 's/^/        /'
fi
if dernier_admin_api_vert; then
	ok "le dernier admin est refusé par l'API — 2 scénarios 23514"
else
	fail "la preuve API du dernier administrateur échoue"
	tail -n 30 "$WORK/api-admin.log" | sed 's/^/        /'
fi
if ui_verte; then
	ok "parcours UI réel vert — souris/clavier, captures 1440/390 et console silencieuse"
else
	fail "le parcours UI CRM-022 échoue"
	tail -n 40 "$WORK/ui.log" | sed 's/^/        /'
fi

echo
echo "5. Non-complaisance : sept protections réellement nécessaires"
degrader_et_verifier \
	"politique de profils retirée — l'équipe ne verrait plus ses identités" \
	"drop policy profiles_lecture_equipe on public.profiles"
degrader_et_verifier \
	"politique de workspace retirée — le contexte courant disparaîtrait" \
	"drop policy workspaces_lecture_membre on public.workspaces"
degrader_et_verifier \
	"politique de membership retirée — les rôles d'équipe deviendraient illisibles" \
	"drop policy workspace_members_lecture_membre on public.workspace_members"
degrader_et_verifier \
	"locale rendue modifiable — une colonne hors contrat serait exposée" \
	"grant update (locale) on public.profiles to authenticated"
degrader_et_verifier \
	"garde du dernier admin retirée — un workspace pourrait perdre toute administration" \
	"drop trigger workspace_members_garder_admin on public.workspace_members"
degrader_et_verifier \
	"FK auteur remise en cascade — supprimer un compte effacerait sa parole" \
	"alter table public.card_comments drop constraint card_comments_author_id_fkey;
	 alter table public.card_comments add constraint card_comments_author_id_fkey
	 foreign key (author_id) references public.profiles(id) on delete cascade"
degrader_et_verifier \
	"borne d'avatar retirée — une source non sûre entrerait sans garde durable" \
	"alter table public.profiles drop constraint profiles_avatar_url_check"

echo
echo "6. Restauration constatée"
if suite_verte; then
	ok "pgTAP redevient vert après les sept restaurations — 84 assertions"
else
	fail "pgTAP reste rouge après restauration"
	tail -n 30 "$WORK/tap.log" | sed 's/^/        /'
fi
if api_verte && dernier_admin_api_vert; then
	ok "les 7 scénarios API redeviennent verts et nettoient leur second workspace"
else
	fail "l'API ciblée reste rouge après restauration"
fi

printf '\n'
if [ "$failures" -eq 0 ]; then
	printf '\033[32m%d contrôles, aucune anomalie.\033[0m\n' "$checks"
else
	printf '\033[31m%d contrôles, %d en échec.\033[0m\n' "$checks" "$failures"
	exit 1
fi
