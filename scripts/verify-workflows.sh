#!/usr/bin/env bash
# @verifies CRM-031 (docs/BACKLOG.md) — Definition of Done des workflows, étapes et transitions
# @verifies docs/SPEC-workflow-engine.md §3.2 (workflows), §3.3 (étapes), §3.4 (transitions),
#           §3.5 (étape initiale), §3.6 (ordre), §3.7 (autorisations), §3.8 (contrat d'API),
#           §3.9 (seed), §3.10 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §4 (politiques), §7 (preuves de refus n° 2, n° 3, n° 11)
# @verifies docs/SCHEMA.md §2 (channels.workflow_id), §3 (workflows) ; docs/PROD_MIGRATIONS.md §3
# @verifies docs/INCONSISTENCY_REPORT.md INC-029 (clé étrangère posée, NOT NULL différée),
#           INC-031 (garde d'archivage : moitié du chemin), INC-033 (`require_fields`)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-031` :
#
#   1. la suite pgTAP `supabase/tests/0007_workflows.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier la structure des trois tables, leurs politiques ni leurs privilèges ;
#   3. les contraintes sont **convergentes** : une contrainte retirée à la main est rétablie par un
#      rejeu, et non laissée manquante (décision 57) ;
#   4. les garanties structurelles sont mesurées en base : au plus une étape initiale, une
#      transition qui ne sort pas de son workflow, l'ordre attribué dans la portée du workflow ;
#   5. le seed est **convergent** : rejoué, il laisse un workflow, sept étapes, dix transitions
#      dont quatre exigeant un commentaire, et six channels rattachés ;
#   6. INC-031 est **constatée** : `cards` n'existe toujours pas, et aucun trigger ne prétend porter
#      la garde d'archivage ;
#   7. le contrat d'API du §3.8 est rejoué avec les jetons réels des trois profils seedés ;
#   8. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve rien d'une interface : l'éditeur de workflow exige un écran d'administration
# authentifié, et la webapp reste un appelant **anonyme** faute d'écran de connexion
# (`docs/INCONSISTENCY_REPORT.md`, INC-021). Il n'y a donc ni test E2E d'interface, ni capture
# d'application à produire pour cette unité — non par renoncement, mais parce qu'il n'existe rien à
# regarder. Le CRUD est livré et prouvé **par l'API**, ce que `CLAUDE.md` §10 exige de toute façon.
#
# Il ne prouve pas non plus le refus d'archivage d'un nœud occupé (INC-031) : `cards` n'existe pas.
# Ce que le harnais fait, c'est **vérifier que cette absence est toujours vraie** — le jour où elle
# cessera de l'être, le contrôle de la section 6 tombera.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-workflows.sh
#   scripts/verify-workflows.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

TEST_FILE=supabase/tests/0007_workflows.test.sql
MIGRATION_FILE=supabase/migrations/0006_workflows.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
WF_SEED=5eed0000-0000-4000-8000-000000000051
ETAPE_PROSPECTION=5eed0000-0000-4000-8000-000000000061
NOEUD_LIBRE=5eed0000-0000-4000-8000-000000000048
MAIL_ADMIN=admin@p2enjoy.test
MAIL_BIZDEV=bizdev@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

WS_PREUVE=a4440000-0000-4000-8000-000000000001

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,46p' "$0"; exit 0 ;;
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

CORPS=/tmp/p2enjoy-workflows-body
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

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser un workflow de
# preuve ni un workspace de preuve derrière elle.
menage() {
	psql_db -c "
		delete from public.workflows where name like 'tst-crm031-%';
		delete from public.workflow_transitions where label like 'tst-crm031-%';
		delete from public.workspaces where slug like 'tst-crm031-%';
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

empreinte() {
	psql_db -c "
		select string_agg(x, '|' order by x) from (
			select c.relname || ':' || a.attname || ':' || a.atttypid::regtype::text
			       || ':' || a.attnotnull::text as x
			  from pg_attribute a join pg_class c on c.oid = a.attrelid
			 where c.relname in ('workflows', 'workflow_steps', 'workflow_transitions')
			   and a.attnum > 0 and not a.attisdropped
			union all
			select 'pol:' || tablename || ':' || policyname || ':' || cmd from pg_policies
			 where schemaname = 'public'
			   and tablename in ('workflows', 'workflow_steps', 'workflow_transitions')
			union all
			select 'con:' || conname from pg_constraint
			 where conrelid in ('public.workflows'::regclass, 'public.workflow_steps'::regclass,
			                    'public.workflow_transitions'::regclass)
			union all
			select 'priv:' || table_name || ':' || grantee || ':' || privilege_type
			  from information_schema.role_table_grants
			 where table_schema = 'public'
			   and table_name in ('workflows', 'workflow_steps', 'workflow_transitions')
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
# par un rejeu (décision 57).
psql_db -c "alter table public.workflows drop constraint workflows_scope_track_check;" >/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
if [ "$(psql_db -c "select count(*) from pg_constraint
                     where conname = 'workflows_scope_track_check'
                       and conrelid = 'public.workflows'::regclass;")" = "1" ]; then
	ok "une contrainte retirée à la main est **rétablie** par un rejeu : la migration répare"
else
	fail "la contrainte retirée n'est pas rétablie : la migration est idempotente sans réparer"
fi

titre "3. Ce que la base garantit, mesuré et non supposé"

psql_db -c "
	insert into public.workspaces (id, name, slug)
	values ('$WS_PREUVE', 'Preuve CRM-031', 'tst-crm031-ws');
	insert into public.workflow_nodes_catalog (id, workspace_id, key, label, position)
	values ('a4440000-0000-4000-8000-0000000000b1', '$WS_PREUVE', 'un', 'Un', 1),
	       ('a4440000-0000-4000-8000-0000000000b2', '$WS_PREUVE', 'deux', 'Deux', 2);
	insert into public.workflows (id, workspace_id, name)
	values ('a4440000-0000-4000-8000-0000000000c1', '$WS_PREUVE', 'tst-crm031-wf-1'),
	       ('a4440000-0000-4000-8000-0000000000c2', '$WS_PREUVE', 'tst-crm031-wf-2');
" >/dev/null

# 3.a — l'ordre est attribué dans la portée du **workflow**, et redémarre à 1 dans le suivant.
psql_db -c "
	insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, is_initial)
	values ('a4440000-0000-4000-8000-0000000000d1', 'a4440000-0000-4000-8000-0000000000c1',
	        '$WS_PREUVE', 'a4440000-0000-4000-8000-0000000000b1', true);
	insert into public.workflow_steps (id, workflow_id, workspace_id, node_id)
	values ('a4440000-0000-4000-8000-0000000000d2', 'a4440000-0000-4000-8000-0000000000c1',
	        '$WS_PREUVE', 'a4440000-0000-4000-8000-0000000000b2');
	insert into public.workflow_steps (id, workflow_id, workspace_id, node_id)
	values ('a4440000-0000-4000-8000-0000000000d3', 'a4440000-0000-4000-8000-0000000000c2',
	        '$WS_PREUVE', 'a4440000-0000-4000-8000-0000000000b1');
" >/dev/null
ordre=$(psql_db -c "select string_agg(position::text, ',' order by workflow_id, position)
                      from public.workflow_steps where workspace_id = '$WS_PREUVE';")
if [ "$ordre" = "1,2,1" ]; then
	ok "\`position\` est attribuée dans la portée du **workflow**, et redémarre à 1 dans le suivant"
else
	fail "\`position\` attribuée vaut « $ordre », attendu « 1,2,1 »"
fi

# 3.b — au plus une étape initiale.
if psql_db -v ON_ERROR_STOP=1 -c "
	update public.workflow_steps set is_initial = true
	 where id = 'a4440000-0000-4000-8000-0000000000d2';" >/dev/null 2>&1; then
	fail "une seconde étape initiale est acceptée — l'index unique partiel ne joue pas"
else
	ok "une seconde étape initiale est refusée par la base"
fi

# 3.c — une transition ne sort pas de son workflow. C'est la garantie centrale de l'unité.
if psql_db -v ON_ERROR_STOP=1 -c "
	insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id)
	values ('a4440000-0000-4000-8000-0000000000c1', '$WS_PREUVE',
	        'a4440000-0000-4000-8000-0000000000d1', 'a4440000-0000-4000-8000-0000000000d3');" \
	>/dev/null 2>&1; then
	fail "une arête vers l'étape d'un autre workflow est acceptée — la clé composite ne joue pas"
else
	ok "une arête vers l'étape d'un **autre** workflow est refusée : la clé étrangère est composite"
fi

# 3.d — les cycles sont autorisés, et supprimer une étape emporte ses arêtes.
psql_db -c "
	insert into public.workflow_transitions (workflow_id, workspace_id, from_step_id, to_step_id)
	values ('a4440000-0000-4000-8000-0000000000c1', '$WS_PREUVE',
	        'a4440000-0000-4000-8000-0000000000d1', 'a4440000-0000-4000-8000-0000000000d2'),
	       ('a4440000-0000-4000-8000-0000000000c1', '$WS_PREUVE',
	        'a4440000-0000-4000-8000-0000000000d2', 'a4440000-0000-4000-8000-0000000000d1');
" >/dev/null
cycle=$(psql_db -c "select count(*) from public.workflow_transitions
                     where workspace_id = '$WS_PREUVE';")
[ "$cycle" = "2" ] && ok "le cycle A → B et B → A est accepté : un workflow n'est pas acyclique" \
	|| fail "le cycle rend $cycle arêtes, attendu 2"

psql_db -c "delete from public.workflow_steps where id = 'a4440000-0000-4000-8000-0000000000d2';" \
	>/dev/null
restantes=$(psql_db -c "select count(*) from public.workflow_transitions
                         where workspace_id = '$WS_PREUVE';")
[ "$restantes" = "0" ] && ok "supprimer une étape emporte ses arêtes : aucune arête cassée ne reste" \
	|| fail "après suppression de l'étape, $restantes arêtes subsistent"

# 3.e — un workflow sans étape initiale reste valide : c'est la décision 72, et elle se vérifie.
brouillon=$(psql_db -c "
	insert into public.workflows (workspace_id, name) values ('$WS_PREUVE', 'tst-crm031-brouillon')
	returning 'cree';" 2>&1 || true)
[ "$brouillon" = "cree" ] \
	&& ok "un workflow **sans étape** est accepté : « au moins une initiale » est une condition "\
"d'emploi, pas d'existence (décision 72)" \
	|| fail "un workflow sans étape est refusé : « $brouillon »"

# 3.f — le nœud d'une étape ne se supprime pas sous elle.
if psql_db -v ON_ERROR_STOP=1 -c "
	delete from public.workflow_nodes_catalog
	 where id = 'a4440000-0000-4000-8000-0000000000b1';" >/dev/null 2>&1; then
	fail "un nœud instancié par une étape a pu être supprimé — `on delete restrict` ne joue pas"
else
	ok "un nœud instancié par une étape ne peut pas être supprimé"
fi

menage

titre "4. Le seed est convergent"

./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué"

# RÉVISÉ PAR `CRM-032` (mécanisme de la décision 51) : le workspace porte désormais **deux**
# workflows — le global par défaut de cette unité, et la copie de portée `track` du §4.10. Le
# contrôle est **resserré** sur ce que `CRM-031` garantit réellement — un seul workflow `global` —
# plutôt que relâché sur un total qui changera à chaque copie livrée par le seed.
workflows=$(psql_db -c "select count(*) from public.workflows
                         where workspace_id = '$WS_SEED' and scope = 'global';")
etapes=$(psql_db -c "select count(*) from public.workflow_steps where workflow_id = '$WF_SEED';")
transitions=$(psql_db -c "select count(*) from public.workflow_transitions
                           where workflow_id = '$WF_SEED';")
avec_commentaire=$(psql_db -c "select count(*) from public.workflow_transitions
                                where workflow_id = '$WF_SEED' and require_comment;")
initiales=$(psql_db -c "select count(*) from public.workflow_steps
                         where workflow_id = '$WF_SEED' and is_initial;")
surcharges=$(psql_db -c "select count(*) from public.workflow_steps
                          where workflow_id = '$WF_SEED'
                            and (label_override is not null or stale_after_days is not null);")
channels_rattaches=$(psql_db -c "select count(*) from public.channels
                                  where workspace_id = '$WS_SEED' and workflow_id = '$WF_SEED';")
defaut=$(psql_db -c "select count(*) from public.workflows
                      where workspace_id = '$WS_SEED' and is_default;")
champs_vides=$(psql_db -c "select count(*) from public.workflow_transitions
                            where workflow_id = '$WF_SEED' and cardinality(require_fields) = 0;")

[ "$workflows" = "1" ] && ok "un workflow **global**, ni plus ni moins" \
	|| fail "workflows globaux : $workflows, attendu 1"
[ "$defaut" = "1" ] && ok "il est le workflow **par défaut** du workspace" \
	|| fail "workflows par défaut : $defaut, attendu 1"
[ "$etapes" = "7" ] && ok "sept étapes, une par nœud actif du catalogue" \
	|| fail "étapes : $etapes, attendu 7"
[ "$initiales" = "1" ] && ok "exactement une étape initiale : le seed fournit ce que la base ne "\
"peut pas exiger" || fail "étapes initiales : $initiales, attendu 1"
[ "$surcharges" = "2" ] && ok "deux surcharges, sur deux colonnes différentes : la faculté est "\
"démontrable et non seulement documentée" || fail "surcharges : $surcharges, attendu 2"
[ "$transitions" = "10" ] && ok "dix transitions, exactement celles du graphe du §3.9" \
	|| fail "transitions : $transitions, attendu 10"
[ "$avec_commentaire" = "4" ] \
	&& ok "quatre transitions exigent un commentaire — celles qui mènent à « Perdu »" \
	|| fail "transitions exigeant un commentaire : $avec_commentaire, attendu 4"
[ "$champs_vides" = "10" ] \
	&& ok "INC-033 : \`require_fields\` reste vide partout, \`form_fields\` n'existant pas" \
	|| fail "transitions à \`require_fields\` vide : $champs_vides, attendu 10"
# Révisé par `CRM-033` : `prospection` suit désormais la copie de portée `track` de son propre
# track (docs/SPEC-workflow-engine.md §4.12.7), et le compte tombe donc à cinq. Le contrôle est
# **resserré** plutôt que supprimé — il compte ce qui suit le workflow **par défaut**, et un second
# contrôle vérifie qu'aucun channel n'est resté sans board.
[ "$channels_rattaches" = "5" ] \
	&& ok "INC-029 : cinq channels du seed suivent le workflow par défaut — le sixième suit la "\
"copie de portée \`track\` livrée par \`CRM-032\` et rattachée par \`CRM-033\`" \
	|| fail "channels rattachés au workflow par défaut : $channels_rattaches, attendu 5"

sans_board=$(psql_db -c "select count(*) from public.channels
                          where workspace_id = '$WS_SEED' and workflow_id is null;")
[ "$sans_board" = "0" ] \
	&& ok "et **aucun** channel n'est sans board : \`CRM-033\` a soldé INC-029 par une contrainte "\
"\`NOT NULL\`, non par une convention" \
	|| fail "channels sans workflow : $sans_board, attendu 0"

# `Réalisation → Perdu` n'est **pas** déclarée : le point ouvert n° 1 de la spécification est une
# absence, et une absence se vérifie comme le reste.
realisation_perdu=$(psql_db -c "
	select count(*) from public.workflow_transitions t
	  join public.workflow_steps d on d.id = t.from_step_id
	  join public.workflow_steps a on a.id = t.to_step_id
	  join public.workflow_nodes_catalog nd on nd.id = d.node_id
	  join public.workflow_nodes_catalog na on na.id = a.node_id
	 where t.workflow_id = '$WF_SEED' and nd.key = 'realisation' and na.key = 'perdu';")
[ "$realisation_perdu" = "0" ] \
	&& ok "\`Réalisation → Perdu\` n'est pas déclarée : le point ouvert n° 1 est tenu" \
	|| fail "\`Réalisation → Perdu\` existe alors que la spécification ne la déclare pas"

titre "5. INC-029 : clé étrangère posée par CRM-031, contrainte NOT NULL posée par CRM-033"

fk=$(psql_db -c "select count(*) from pg_constraint
                  where conname = 'channels_workflow_id_workspace_id_fkey'
                    and conrelid = 'public.channels'::regclass;")
[ "$fk" = "1" ] && ok "\`channels.workflow_id\` porte enfin une clé étrangère, et **composite**" \
	|| fail "la clé étrangère de \`channels.workflow_id\` est absente"

notnull=$(psql_db -c "select attnotnull from pg_attribute
                       where attrelid = 'public.channels'::regclass and attname = 'workflow_id';")
# Révisé par `CRM-033`, qui a soldé INC-029. Le contrôle annonçait qu'il tomberait le jour où la
# contrainte serait posée ; il est tombé, et il dit désormais l'état réel (décision 51).
if [ "$notnull" = "t" ]; then
	ok "la contrainte \`NOT NULL\` est posée par \`CRM-033\` : INC-029 est **soldée**, et "\
"docs/SCHEMA.md §2 enfin tenu à la lettre"
else
	fail "la contrainte \`NOT NULL\` a disparu : INC-029 était soldée par \`CRM-033\`"
fi

titre "6. INC-031 : la garde d'archivage reste hors d'atteinte, et son absence est vérifiée"

# Ce contrôle est l'inverse d'un contrôle ordinaire : il constate que quelque chose **manque**
# toujours. Le jour où `CRM-040` livrera `cards`, il tombera — et c'est ce qu'on lui demande.
cards=$(psql_db -c "select coalesce(to_regclass('public.cards')::text, 'NULL');")
if [ "$cards" = "NULL" ]; then
	ok "INC-031 : \`cards\` n'existe toujours pas — la garde reste sans cible, \`CRM-040\` la doit"
else
	fail "INC-031 : \`cards\` existe désormais — la garde d'archivage doit être écrite"
fi

triggers=$(psql_db -c "select count(*) from pg_trigger
                        where tgrelid = 'public.workflow_nodes_catalog'::regclass
                          and not tgisinternal;")
[ "$triggers" = "2" ] \
	&& ok "toujours deux triggers sur le catalogue : aucun ne prétend porter la garde" \
	|| fail "triggers du catalogue : $triggers, attendu 2"

titre "7. Contrat d'API, avec les jetons réels (docs/SPEC-workflow-engine.md §3.8)"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_BIZDEV=$(jeton_de "$MAIL_BIZDEV")
T_VIEWER=$(jeton_de "$MAIL_VIEWER")
[ -n "$T_ADMIN" ] && ok "jeton de l'administrateur obtenu par la vraie route de connexion" \
	|| fail "connexion de l'administrateur impossible"
[ -n "$T_BIZDEV" ] && ok "jeton du business developer obtenu par la vraie route de connexion" \
	|| fail "connexion du business developer impossible"

code=$(http GET "$API/rest/v1/workflows?select=id" -H "apikey: $ANON_KEY")
if [ "$code" = "200" ] && [ "$(jq -r 'length' < "$CORPS")" = "0" ]; then
	ok "ligne b — l'anonyme obtient 200 et zéro ligne, pas une erreur (refus n° 11)"
else
	fail "ligne b — l'anonyme obtient $code et $(head -c 80 "$CORPS")"
fi

# RÉVISÉ PAR `CRM-032` : la copie du seed porte sept étapes de plus. Le filtre porte donc sur le
# workflow de **cette** unité — ce que la ligne a du contrat dit, et que « toutes les étapes
# visibles » disait par accident tant qu'il n'existait qu'un workflow.
http GET "$API/rest/v1/workflow_steps?select=id&workflow_id=eq.$WF_SEED" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_VIEWER" >/dev/null
[ "$(jq -r 'length' < "$CORPS")" = "7" ] \
	&& ok "ligne a — un viewer lit les sept étapes du workflow par défaut : lire n'exige pas d'écrire" \
	|| fail "ligne a — le viewer lit $(jq -r 'length' < "$CORPS") étapes, attendu 7"

code=$(http POST "$API/rest/v1/workflows" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"name\":\"tst-crm031-refus\"}")
reste=$(psql_db -c "select count(*) from public.workflows where name = 'tst-crm031-refus';")
if [ "$code" = "403" ] && [ "$reste" = "0" ]; then
	ok "lignes e — PREUVE DE REFUS N° 2 : le business developer est refusé en 403, et la ligne "\
"n'existe nulle part"
else
	fail "lignes e — le business developer obtient $code, et $reste ligne(s) subsistent"
fi

code=$(http PATCH "$API/rest/v1/workflows?id=eq.$WF_SEED" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-H 'Prefer: return=representation' -d '{"name":"tst-crm031-renomme"}')
nom=$(psql_db -c "select name from public.workflows where id = '$WF_SEED';")
if [ "$code" = "200" ] && [ "$nom" = "Cycle commercial standard" ]; then
	ok "ligne g — le renommage par un business developer rend 200 **sans rien modifier** : la "\
"ligne est relue inchangée"
else
	fail "ligne g — code $code, et le nom vaut « $nom »"
fi

code=$(http POST "$API/rest/v1/workflow_steps" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-H 'Prefer: return=representation' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"workspace_id\":\"$WS_SEED\",\"node_id\":\"$NOEUD_LIBRE\"}")
position=$(jq -r '.[0].position // empty' < "$CORPS")
if [ "$code" = "201" ] && [ "$position" = "8" ]; then
	ok "ligne i — l'administrateur ajoute une étape sans \`position\` : elle vaut 8, en fin de board"
else
	fail "ligne i — code $code, position « $position », attendu 201 et 8"
fi
psql_db -c "delete from public.workflow_steps
             where workflow_id = '$WF_SEED' and node_id = '$NOEUD_LIBRE';" >/dev/null

code=$(http POST "$API/rest/v1/workflow_transitions" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-d "{\"workflow_id\":\"$WF_SEED\",\"workspace_id\":\"$WS_SEED\",
	     \"from_step_id\":\"$ETAPE_PROSPECTION\",\"to_step_id\":\"$ETAPE_PROSPECTION\"}")
[ "$code" = "400" ] && ok "ligne m — une transition d'une étape vers elle-même est refusée en 400" \
	|| fail "ligne m — code $code, attendu 400"

code=$(http DELETE "$API/rest/v1/workflows?id=eq.$WF_SEED" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN")
existe=$(psql_db -c "select count(*) from public.workflows where id = '$WF_SEED';")
if [ "$code" = "403" ] && [ "$existe" = "1" ]; then
	ok "ligne p — même l'administrateur ne supprime pas un workflow : le refus vient du privilège"
else
	fail "ligne p — code $code, et $existe workflow(s) subsistent"
fi

titre "8. Non-complaisance : le harnais échoue-t-il quand le produit se dégrade ?"

# a. La politique d'écriture ouverte à tous : le refus n° 2 doit cesser d'être opposé.
psql_db -c "
	drop policy workflows_insertion_admin on public.workflows;
	create policy workflows_insertion_admin on public.workflows for insert to authenticated
		with check (app.is_workspace_member(workspace_id));
" >/dev/null
code=$(http POST "$API/rest/v1/workflows" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"name\":\"tst-crm031-degrade\"}")
if [ "$code" = "201" ]; then
	ok "dégradation a : politique relâchée, le business developer crée un workflow — le contrôle "\
"de la section 7 aurait échoué"
	psql_db -c "delete from public.workflows where name = 'tst-crm031-degrade';" >/dev/null
else
	fail "dégradation a : la politique relâchée refuse encore ($code) — la garantie vient d'ailleurs"
fi

# b. L'index de l'étape initiale retiré : une seconde initiale doit passer.
psql_db -c "drop index public.workflow_steps_workflow_initial_uk;" >/dev/null
if psql_db -v ON_ERROR_STOP=1 -c "
	insert into public.workflow_steps (workflow_id, workspace_id, node_id, is_initial)
	values ('$WF_SEED', '$WS_SEED', '$NOEUD_LIBRE', true);" >/dev/null 2>&1; then
	ok "dégradation b : index retiré, une seconde étape initiale passe — le contrôle 3.b aurait "\
"échoué"
	psql_db -c "delete from public.workflow_steps
	             where workflow_id = '$WF_SEED' and node_id = '$NOEUD_LIBRE';" >/dev/null
else
	fail "dégradation b : la seconde initiale est encore refusée sans l'index"
fi

# c. Le seed privé d'une transition : le contrôle du seed doit tomber.
psql_db -c "delete from public.workflow_transitions
             where id = '5eed0000-0000-4000-8000-00000000007a';" >/dev/null
restant=$(psql_db -c "select count(*) from public.workflow_transitions where workflow_id = '$WF_SEED';")
[ "$restant" = "9" ] \
	&& ok "dégradation c : une transition du seed retirée, le contrôle de la section 4 aurait échoué" \
	|| fail "dégradation c : $restant transitions, attendu 9"

# d. LA DÉGRADATION QUI A TROUVÉ UN DÉFAUT RÉEL (décision 78). La clé composite qui empêche une
#    transition de sortir de son workflow est remplacée par une clé **simple** portant le même nom.
#    Deux choses sont vérifiées à la suite : que le refus disparaît réellement — donc que la clé
#    composite porte bien la garantie —, puis, à la restauration, que la migration la **répare**.
#
#    C'est ce second point qui a échoué la première fois : la clé était posée en
#    `if not exists (… where conname = …)`, si bien que la version dégradée survivait à tous les
#    rejeux. La migration est convergente depuis ; ce contrôle est ce qui l'y oblige.
psql_db -c "
	alter table public.workflow_transitions drop constraint workflow_transitions_to_step_fkey;
	alter table public.workflow_transitions add constraint workflow_transitions_to_step_fkey
		foreign key (to_step_id) references public.workflow_steps (id) on delete cascade;
	insert into public.workflows (id, workspace_id, name)
	values ('a3313000-0000-4000-8000-000000000002', '$WS_SEED', 'tst-crm031-ailleurs');
	insert into public.workflow_steps (id, workflow_id, workspace_id, node_id, position)
	values ('a3314000-0000-4000-8000-000000000002', 'a3313000-0000-4000-8000-000000000002',
	        '$WS_SEED', '$NOEUD_LIBRE', 1);
" >/dev/null
if psql_db -v ON_ERROR_STOP=1 -c "
	insert into public.workflow_transitions (id, workflow_id, workspace_id, from_step_id, to_step_id)
	values ('a3315000-0000-4000-8000-000000000002', '$WF_SEED', '$WS_SEED',
	        '$ETAPE_PROSPECTION', 'a3314000-0000-4000-8000-000000000002');" >/dev/null 2>&1; then
	ok "dégradation d : clé composite remplacée par une clé simple, une transition sort de son "\
"workflow — la clé composite porte donc bien la garantie, elle n'est pas décorative"
else
	fail "dégradation d : la transition hors workflow est encore refusée, la garantie vient d'ailleurs"
fi
psql_db -c "
	delete from public.workflow_transitions where id = 'a3315000-0000-4000-8000-000000000002';
	delete from public.workflow_steps where id = 'a3314000-0000-4000-8000-000000000002';
	delete from public.workflows where id = 'a3313000-0000-4000-8000-000000000002';
" >/dev/null

# e. Restauration **constatée**, et non supposée.
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué à la restauration"
sleep 1

restaure=$(psql_db -c "
	select (select count(*) from pg_indexes
	         where indexname = 'workflow_steps_workflow_initial_uk')::text
	    || '/' ||
	       (select count(*) from public.workflow_transitions where workflow_id = '$WF_SEED')::text
	    || '/' ||
	       (select coalesce(with_check, '') from pg_policies
	         where tablename = 'workflows' and policyname = 'workflows_insertion_admin')
	    || '/' ||
	       (select pg_get_constraintdef(oid) from pg_constraint
	         where conname = 'workflow_transitions_to_step_fkey'
	           and conrelid = 'public.workflow_transitions'::regclass);
")
if [ "${restaure%%/*}" = "1" ] \
	&& [ "$(printf '%s' "$restaure" | cut -d/ -f2)" = "10" ] \
	&& printf '%s' "$restaure" | grep -q 'is_workspace_admin' \
	&& printf '%s' "$restaure" | grep -q 'FOREIGN KEY (to_step_id, workflow_id)'; then
	ok "restauration constatée : index revenu, dix transitions revenues, politique revenue à "\
"\`is_workspace_admin\`, et **clé composite réparée** — c'est ce dernier point qui avait échoué"
else
	fail "restauration incomplète : « $restaure »"
fi

code=$(http POST "$API/rest/v1/workflows" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"name\":\"tst-crm031-apres\"}")
[ "$code" = "403" ] && ok "et le refus est de nouveau opposé au business developer" \
	|| fail "après restauration, le business developer obtient encore $code"

titre "9. Suites, tests unitaires et build"

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
