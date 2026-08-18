#!/usr/bin/env bash
# @verifies CRM-033 (docs/BACKLOG.md) — Definition of Done de la cohérence workflow ↔ channel
# @verifies docs/SPEC-workflow-engine.md §4.12.1 (les quatre portes), §4.12.2 (la règle),
#           §4.12.3 (trigger sur channels), §4.12.4 (trigger sur workflows), §4.12.5 (NOT NULL),
#           §4.12.6 (contrat d'API), §4.12.7 (seed), §4.12.8 (preuves attendues)
# @verifies docs/SPEC-channels.md §2.5 (INC-029 soldée), §8 (seed)
# @verifies docs/INCONSISTENCY_REPORT.md INC-029 (soldée), INC-040 (portes 3 et 4),
#           INC-041 (convergence du seed, corrigée ici)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-033` :
#
#   1. la suite pgTAP `supabase/tests/0009_coherence_workflow_channel.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier les triggers, la nullabilité ni la définition des fonctions ;
#   3. les triggers sont **convergents** : un trigger retiré à la main est rétabli par un rejeu ;
#   4. les quatre portes d'INC-040 sont **fermées**, mesurées une à une contre l'API avec le jeton
#      réel de l'administrateur, et les cas acceptés le sont restés ;
#   5. le seed est **convergent**, y compris pour le défaut d'INC-041 : une copie déplacée ne fait
#      plus naître une seconde copie ;
#   6. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée ;
#   7. les deux preuves d'interface du §4.12.9 sont vertes, et leurs trois captures existent.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais prouve de l'interface, depuis le 2026-08-18.
# ---------------------------------------------------------------------------------------------
# ~~Il ne prouve rien d'une interface : affecter un workflow à un channel exige un écran
# d'administration authentifié, et la webapp reste un appelant anonyme faute d'écran de connexion
# (INC-021).~~ **CE MOTIF EST CADUC.** INC-021 est close depuis le 2026-08-07, `CRM-009` a livré
# l'écran de connexion, et l'écran d'affectation existe depuis `CRM-075`.
#
# Le contrôle 8 bis rejoue donc les deux preuves d'interface de l'unité
# (`e2e/ui/coherence-workflow.spec.ts`, `docs/SPEC-workflow-engine.md` §4.12.9) et constate les
# trois captures qu'elles produisent. La règle reste tenue **en base**, ce que `CLAUDE.md` §10 exige
# de toute façon, et les sections 4 à 7 le mesurent ; l'interface n'en est que le second témoin.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-coherence-workflow.sh
#   scripts/verify-coherence-workflow.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0009_coherence_workflow_channel.test.sql
MIGRATION_FILE=supabase/migrations/0008_coherence_workflow_channel.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
WF_GLOBAL=5eed0000-0000-4000-8000-000000000051
NOM_COPIE_SEED='Cycle commercial — Conseil IA'
TRACK_CONSEIL=5eed0000-0000-4000-8000-000000000021
TRACK_STUDIO=5eed0000-0000-4000-8000-000000000022
CH_PROSPECTION=5eed0000-0000-4000-8000-000000000031
CH_REFONTE=5eed0000-0000-4000-8000-000000000034
CH_ACCEPTATION=c0330000-0000-4000-8000-00000000ff02
MAIL_ADMIN=admin@p2enjoy.test
MDP_SEED=SeedDev2026Local

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,38p' "$0"; exit 0 ;;
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

CORPS=/tmp/p2enjoy-coherence-body
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

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser un channel de
# preuve derrière elle. L'ordre suit celui qu'INC-039 impose — les channels et les workflows avant
# leur workspace.
menage() {
	psql_db -c "
		delete from public.channels   where slug like 'tst-crm033-%';
		delete from public.workflows  where name like 'tst-crm033-%';
		delete from public.workspaces where slug like 'tst-crm033-%';
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
			select 'trg:' || t.tgname || ':' || t.tgrelid::regclass::text as x
			  from pg_trigger t
			 where t.tgname in ('channels_verifier_workflow', 'workflows_verifier_portee_occupee')
			union all
			select 'fn:' || p.proname || ':' || md5(pg_get_functiondef(p.oid))
			  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'app'
			   and p.proname in ('channels_verifier_workflow', 'workflows_verifier_portee_occupee')
			union all
			select 'nn:' || a.attnotnull::text
			  from pg_attribute a
			 where a.attrelid = 'public.channels'::regclass and a.attname = 'workflow_id'
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
	ok "le rejeu ne modifie ni les triggers, ni les fonctions, ni la nullabilité"
else
	fail "le rejeu a modifié quelque chose : l'empreinte diffère"
fi

# Convergence, et non simple idempotence : un trigger retiré à la main doit être **rétabli** par un
# rejeu (décision 57).
psql_db -c "drop trigger channels_verifier_workflow on public.channels;" >/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
if [ "$(psql_db -c "select count(*) from pg_trigger
                     where tgname = 'channels_verifier_workflow'
                       and tgrelid = 'public.channels'::regclass;")" = "1" ]; then
	ok "un trigger retiré à la main est **rétabli** par un rejeu : la migration répare"
else
	fail "le trigger retiré n'est pas rétabli : la migration est idempotente sans réparer"
fi

titre "3. INC-029 est soldée"

notnull=$(psql_db -c "select attnotnull from pg_attribute
                       where attrelid = 'public.channels'::regclass and attname = 'workflow_id';")
[ "$notnull" = "t" ] \
	&& ok "\`channels.workflow_id\` est **non nulle** : docs/SCHEMA.md §2 est enfin tenu à la lettre" \
	|| fail "\`channels.workflow_id\` est encore nullable : INC-029 n'est pas soldée"

defaut=$(psql_db -c "select count(*) from pg_attrdef d
                      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                     where d.adrelid = 'public.channels'::regclass and a.attname = 'workflow_id';")
[ "$defaut" = "0" ] \
	&& ok "et **aucun défaut de colonne** ne l'adoucit : une omission reste une omission (décision 91)" \
	|| fail "un défaut de colonne a été posé sur \`workflow_id\` : la décision 91 est contredite"

titre "4. Les quatre portes d'INC-040, mesurées contre l'API"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
[ -n "$T_ADMIN" ] && ok "jeton de l'administrateur obtenu par la vraie route de connexion" \
	|| fail "connexion de l'administrateur impossible"

COPIE=$(psql_db -c "select id from public.workflows
                     where derived_from_workflow_id = '$WF_GLOBAL'
                       and name = '$NOM_COPIE_SEED';")
[ -n "$COPIE" ] && ok "la copie de portée \`track\` du seed est présente : les refus qui suivent "\
"portent sur un objet réel" || fail "aucune copie de portée track dans le seed"
COPIES_INITIALES=$(psql_db -c "select count(*) from public.workflows
                                where derived_from_workflow_id = '$WF_GLOBAL';")

patch() {
	http PATCH "$API/rest/v1/$1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" \
		-H 'Content-Type: application/json' -d "$2"
}

# Porte 1 — un workflow `track` sur un channel d'un autre track.
code=$(patch "channels?id=eq.$CH_REFONTE" "{\"workflow_id\":\"$COPIE\"}")
message=$(jq -r '.message // empty' < "$CORPS")
apres=$(psql_db -c "select workflow_id from public.channels where id = '$CH_REFONTE';")
if [ "$code" = "400" ] && [ "$message" = "workflow_hors_track" ] && [ "$apres" = "$WF_GLOBAL" ]; then
	ok "PORTE 1 fermée — un workflow \`track\` étranger est refusé en 400 / \`workflow_hors_track\`, "\
"et la ligne est **relue inchangée**"
else
	fail "PORTE 1 — code $code, message « $message », workflow après « $apres »"
fi

# Porte 2 — le déplacement d'un channel, qui ne mentionne pas `workflow_id`.
psql_db -c "update public.channels set workflow_id = '$COPIE' where id = '$CH_PROSPECTION';" >/dev/null
code=$(patch "channels?id=eq.$CH_PROSPECTION" "{\"track_id\":\"$TRACK_STUDIO\"}")
message=$(jq -r '.message // empty' < "$CORPS")
apres=$(psql_db -c "select track_id from public.channels where id = '$CH_PROSPECTION';")
if [ "$code" = "400" ] && [ "$message" = "workflow_hors_track" ] && [ "$apres" = "$TRACK_CONSEIL" ]; then
	ok "PORTE 2 fermée — déplacer un channel qui suit un workflow \`track\` est refusé, bien que "\
"l'écriture ne mentionne pas \`workflow_id\`"
else
	fail "PORTE 2 — code $code, message « $message », track après « $apres »"
fi

# Porte 3 — le workflow déplacé sous ses channels.
code=$(patch "workflows?id=eq.$COPIE" "{\"track_id\":\"$TRACK_STUDIO\"}")
message=$(jq -r '.message // empty' < "$CORPS")
apres=$(psql_db -c "select track_id from public.workflows where id = '$COPIE';")
if [ "$code" = "400" ] && [ "$message" = "workflow_portee_occupee" ] \
	&& [ "$apres" = "$TRACK_CONSEIL" ]; then
	ok "PORTE 3 fermée — déplacer un workflow \`track\` **occupé** est refusé : aucune écriture sur "\
"\`channels\` n'aurait pu voir celle-ci"
else
	fail "PORTE 3 — code $code, message « $message », track après « $apres »"
fi

# Porte 4 — la bascule de portée du workflow par défaut, la plus dommageable des quatre.
code=$(patch "workflows?id=eq.$WF_GLOBAL" \
	"{\"scope\":\"track\",\"track_id\":\"$TRACK_CONSEIL\"}")
message=$(jq -r '.message // empty' < "$CORPS")
apres=$(psql_db -c "select scope from public.workflows where id = '$WF_GLOBAL';")
if [ "$code" = "400" ] && [ "$message" = "workflow_portee_occupee" ] && [ "$apres" = "global" ]; then
	ok "PORTE 4 fermée — faire basculer de \`global\` à \`track\` un workflow occupé est refusé : "\
"elle aurait invalidé d'un seul UPDATE tous les channels qui le suivent"
else
	fail "PORTE 4 — code $code, message « $message », portée après « $apres »"
fi

titre "5. Ce que la règle accepte, et doit continuer d'accepter"

# Depuis CRM-046, `prospection` porte des cards : sa clé composite doit interdire tout changement
# de workflow (INC-046). Les deux cas acceptés de la règle sont donc exercés sur un channel vide
# jetable, réellement rattaché à la copie avant de basculer vers le global puis de revenir.
psql_db -c "insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id,
                                         position)
            values ('$CH_ACCEPTATION', '$WS_SEED', '$TRACK_CONSEIL', 'Acceptation CRM-033',
                    'tst-crm033-acceptation', '$COPIE', 99);" >/dev/null
code=$(patch "channels?id=eq.$CH_ACCEPTATION" "{\"workflow_id\":\"$WF_GLOBAL\"}")
[ "$code" = "204" ] && ok "un workflow **global** est accepté sur n'importe quel channel du workspace" \
	|| fail "un workflow global est refusé ($code) : la règle est trop stricte"

code=$(patch "channels?id=eq.$CH_ACCEPTATION" "{\"workflow_id\":\"$COPIE\"}")
[ "$code" = "204" ] && ok "un workflow \`track\` est accepté sur un channel de **son** track" \
	|| fail "un workflow track est refusé sur son propre track ($code)"
psql_db -c "delete from public.channels where id = '$CH_ACCEPTATION';" >/dev/null

code=$(patch "channels?id=eq.$CH_REFONTE" "{\"track_id\":\"$TRACK_CONSEIL\"}")
[ "$code" = "204" ] && ok "déplacer un channel qui suit un workflow **global** reste accepté" \
	|| fail "le déplacement d'un channel à workflow global est refusé ($code)"
psql_db -c "update public.channels set track_id = '$TRACK_STUDIO' where id = '$CH_REFONTE';" >/dev/null

# Un workflow `track` **libre** change de track : la règle protège des rattachements, pas des
# workflows. La preuve exige un workflow réellement libre, donc créé pour elle.
psql_db -c "
	insert into public.workflows (id, workspace_id, name, scope, track_id)
	values ('c0330000-0000-4000-8000-00000000ff01', '$WS_SEED', 'tst-crm033-libre', 'track',
	        '$TRACK_CONSEIL');
" >/dev/null
code=$(patch "workflows?id=eq.c0330000-0000-4000-8000-00000000ff01" \
	"{\"track_id\":\"$TRACK_STUDIO\"}")
[ "$code" = "204" ] && ok "un workflow \`track\` **libre** change de track : la règle protège des "\
"rattachements, pas des workflows" || fail "un workflow track libre est refusé ($code)"
psql_db -c "delete from public.workflows where name like 'tst-crm033-%';" >/dev/null

code=$(http POST "$API/rest/v1/channels" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"track_id\":\"$TRACK_STUDIO\",\"name\":\"Sans wf\",
	     \"slug\":\"tst-crm033-sans-wf\"}")
if [ "$code" = "400" ] && [ "$(jq -r '.code' < "$CORPS")" = "23502" ]; then
	ok "créer un channel **sans workflow** est refusé en 23502 : le contrat de création a changé"
else
	fail "création sans workflow : code $code, \`$(jq -r '.code // empty' < "$CORPS")\`"
fi

titre "6. Le seed est conforme, et convergent — INC-041"

./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué"

sans_wf=$(psql_db -c "select count(*) from public.channels
                       where workspace_id = '$WS_SEED' and workflow_id is null;")
[ "$sans_wf" = "0" ] && ok "aucun channel du seed n'est sans workflow" \
	|| fail "$sans_wf channel(s) du seed sans workflow"

sur_track=$(psql_db -c "select count(*) from public.channels c
                          join public.workflows w on w.id = c.workflow_id
                         where c.workspace_id = '$WS_SEED' and w.scope = 'track';")
[ "$sur_track" = "1" ] \
	&& ok "**un seul** channel suit un workflow de portée \`track\` — le cas accepté le plus "\
"intéressant de la règle, rendu démontrable" \
	|| fail "channels sur un workflow track : $sur_track, attendu 1"

incoherents=$(psql_db -c "
	select count(*) from public.channels c join public.workflows w on w.id = c.workflow_id
	 where c.workspace_id = '$WS_SEED'
	   and not (w.scope = 'global' or (w.scope = 'track' and w.track_id = c.track_id));")
[ "$incoherents" = "0" ] \
	&& ok "tous les rattachements du seed satisfont la règle : le seed traverse la garde, il ne la "\
"contourne pas" || fail "$incoherents rattachement(s) du seed violent la règle"

# INC-041, révisée par la décision 300 : une copie utilisateur supplémentaire ne doit ni faire
# naître une troisième fixture, ni être supprimée au nom du compte global historique.
COPIE=$(psql_db -c "select id from public.workflows
                     where derived_from_workflow_id = '$WF_GLOBAL'
                       and name = '$NOM_COPIE_SEED';")
code=$(http POST "$API/rest/v1/rpc/copy_workflow_to_track" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" \
	-H 'Content-Type: application/json' \
	-d "$(jq -nc --arg wf "$WF_GLOBAL" --arg tr "$TRACK_CONSEIL" \
	              '{workflow_id: $wf, track_id: $tr, new_name: "tst-crm033-copie-utilisateur"}')")
if [ "$code" = "200" ]; then
	COPIE_UTILISATEUR=$(jq -r '.' < "$CORPS")
	# La copie utilisateur est volontairement rendue plus ancienne que la fixture. Avant la
	# décision 300, la section des channels prenait la première dérivation par `created_at` : ce
	# témoin fait donc échouer le harnais si cette sélection destructive réapparaît.
	psql_db -c "update public.workflows
	                set created_at = (select created_at - interval '1 day'
	                                    from public.workflows where id = '$COPIE')
	              where id = '$COPIE_UTILISATEUR';" >/dev/null
else
	COPIE_UTILISATEUR=''
	fail "la copie utilisateur de contre-épreuve n'a pas pu être créée (HTTP $code)"
fi
./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué après dégradation"
copies=$(psql_db -c "select count(*) from public.workflows
                      where derived_from_workflow_id = '$WF_GLOBAL';")
copies_attendues=$((COPIES_INITIALES + 1))
copies_preservees=$(psql_db -F '|' -c "select
	(select count(*) from public.workflows where id = '$COPIE'),
	(select count(*) from public.workflows where id = nullif('$COPIE_UTILISATEUR', '')::uuid);")
if [ "$copies" = "$copies_attendues" ] && [ "$copies_preservees" = "1|1" ]; then
	ok "INC-041 / décision 300 — même plus ancienne, la copie utilisateur est préservée et la "\
"fixture reste la seule cible du seed"
else
	fail "INC-041 — état après rejeu : $copies copie(s), attendu $copies_attendues ; présence seed/utilisateur « $copies_preservees »"
fi
psql_db -c "delete from public.workflows where id = nullif('$COPIE_UTILISATEUR', '')::uuid;" >/dev/null

titre "7. Non-complaisance : le harnais échoue-t-il quand le produit se dégrade ?"

# a. Le trigger de `channels` retiré : la porte 1 doit se rouvrir.
#
# RÉVISÉ À `CRM-040`. Cette dégradation visait `CH_REFONTE`, channel du seed. `CRM-040` y a posé une
# card, et sa clé étrangère composite `cards (channel_id, workflow_id)` refuse désormais tout
# changement de workflow d'un channel occupé — MESURÉ, `409` / `23503`, INC-046. La dégradation ne
# mesurait donc plus le trigger, mais cette clé : elle rendait le harnais **faussement rouge** sur
# une garantie qui tient toujours.
#
# Elle porte désormais sur un channel JETABLE, créé pour elle dans un autre track et détruit
# aussitôt. C'est plus juste que de viser un channel du seed : la dégradation n'a jamais eu besoin
# d'une donnée de démonstration, seulement d'un channel dont le track diffère de celui de la copie.
CH_JETABLE=aaaa0000-0000-4000-8000-0000000000d1
psql_db -c "insert into public.channels (id, workspace_id, track_id, name, slug, workflow_id,
                                         position)
            values ('$CH_JETABLE', '$WS_SEED', '$TRACK_STUDIO', 'Dégradation a',
                    'tst-crm033-degradation-a', '$WF_GLOBAL', 99)
            on conflict (id) do nothing;" >/dev/null
psql_db -c "drop trigger channels_verifier_workflow on public.channels;" >/dev/null
COPIE=$(psql_db -c "select id from public.workflows
                     where derived_from_workflow_id = '$WF_GLOBAL'
                       and name = '$NOM_COPIE_SEED';")
code=$(patch "channels?id=eq.$CH_JETABLE" "{\"workflow_id\":\"$COPIE\"}")
if [ "$code" = "204" ]; then
	ok "dégradation a : trigger retiré, un workflow \`track\` étranger passe — le contrôle de la "\
"porte 1 aurait échoué"
	psql_db -c "delete from public.channels where id = '$CH_JETABLE';" >/dev/null
else
	psql_db -c "delete from public.channels where id = '$CH_JETABLE';" >/dev/null
	fail "dégradation a : le refus est encore opposé sans le trigger ($code) — la garantie vient "\
"d'ailleurs"
fi

# b. Le trigger de `workflows` retiré : les portes 3 et 4 doivent se rouvrir. C'est la dégradation
#    qui compte le plus : aucune Definition of Done ne demandait ce trigger, et sans ce contrôle
#    personne ne saurait qu'il porte réellement quelque chose.
psql_db -c "drop trigger workflows_verifier_portee_occupee on public.workflows;" >/dev/null
psql_db -c "update public.channels set workflow_id = '$COPIE' where id = '$CH_PROSPECTION';" >/dev/null
code=$(patch "workflows?id=eq.$COPIE" "{\"track_id\":\"$TRACK_STUDIO\"}")
if [ "$code" = "204" ]; then
	ok "dégradation b : trigger de \`workflows\` retiré, un workflow occupé se déplace sous ses "\
"channels — les portes 3 et 4 étaient donc réellement fermées par lui"
else
	fail "dégradation b : le refus est encore opposé sans le trigger ($code)"
fi

# c. La contrainte `NOT NULL` retirée : la création sans workflow doit repasser.
psql_db -c "alter table public.channels alter column workflow_id drop not null;" >/dev/null
code=$(http POST "$API/rest/v1/channels" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN" -H 'Content-Type: application/json' \
	-d "{\"workspace_id\":\"$WS_SEED\",\"track_id\":\"$TRACK_STUDIO\",\"name\":\"Sans wf\",
	     \"slug\":\"tst-crm033-degrade\"}")
if [ "$code" = "201" ]; then
	ok "dégradation c : \`NOT NULL\` retirée, un channel sans workflow est créé — le contrôle de la "\
"section 5 aurait échoué"
	psql_db -c "delete from public.channels where slug = 'tst-crm033-degrade';" >/dev/null
else
	fail "dégradation c : la création sans workflow est encore refusée ($code)"
fi

# d. Restauration **constatée**, et non supposée.
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 \
	|| fail "la migration a échoué à la restauration"
psql_db -c "
	update public.workflows set track_id = '$TRACK_CONSEIL'
	 where id = '$COPIE';
" >/dev/null
./supabase/seed/apply-seed.sh >/dev/null 2>&1 || fail "le seed a échoué à la restauration"

restaure=$(psql_db -c "
	select (select count(*) from pg_trigger
	         where tgname = 'channels_verifier_workflow'
	           and tgrelid = 'public.channels'::regclass)::text
	    || '/' ||
	       (select count(*) from pg_trigger
	         where tgname = 'workflows_verifier_portee_occupee'
	           and tgrelid = 'public.workflows'::regclass)::text
	    || '/' ||
	       (select attnotnull::text from pg_attribute
	         where attrelid = 'public.channels'::regclass and attname = 'workflow_id')
	    || '/' ||
	       (select count(*) from public.workflows
	         where derived_from_workflow_id = '$WF_GLOBAL')::text;
")
restaure_attendu="1/1/true/$COPIES_INITIALES"
if [ "$restaure" = "$restaure_attendu" ]; then
	ok "restauration constatée : les deux triggers sont revenus, \`NOT NULL\` est revenue, et une "\
"copie utilisateur préexistante éventuelle est restée intacte"
else
	fail "restauration incomplète : « $restaure », attendu « $restaure_attendu »"
fi

COPIE=$(psql_db -c "select id from public.workflows
                     where derived_from_workflow_id = '$WF_GLOBAL'
                       and name = '$NOM_COPIE_SEED';")
code=$(patch "channels?id=eq.$CH_REFONTE" "{\"workflow_id\":\"$COPIE\"}")
[ "$code" = "400" ] && ok "et le refus est de nouveau opposé sur la porte 1" \
	|| fail "après restauration, la porte 1 rend encore $code"

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

titre "8 bis. Les deux preuves d'interface de l'unité (§4.12.9)"

# Elles sont DÉJÀ comprises dans `npm run e2e:ui` ci-dessus. Elles sont rejouées ici SEULES pour que
# le verdict de cette unité nomme SES scénarios : une campagne d'interface rouge ne dit pas lequel
# des 370 scénarios a cédé, et un harnais d'unité doit pouvoir répondre sans qu'on relise un journal.
if [ "$RAPIDE" = true ]; then
	printf '  (ignorés : --rapide)\n'
else
	if E2E_PROJETS=ui npx playwright test --config e2e/playwright.config.ts --project=ui \
		e2e/ui/coherence-workflow.spec.ts >/dev/null 2>&1; then
		ok "e2e/ui/coherence-workflow.spec.ts — sélecteur filtré et refus hors écran"
	else
		fail "e2e/ui/coherence-workflow.spec.ts est rouge"
	fi
fi

# Les captures sont un livrable de `CLAUDE.md` §16, pas un effet de bord : leur absence est une
# anomalie même quand les scénarios passent.
for capture in selecteur-workflow-track-porteur selecteur-workflow-track-voisin refus-workflow-hors-track; do
	if [ -s "docs/captures/CRM-033/$capture.jpg" ]; then
		ok "capture docs/captures/CRM-033/$capture.jpg"
	else
		fail "capture docs/captures/CRM-033/$capture.jpg absente ou vide"
	fi
done

titre "Résultat"
if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%d contrôles, aucune anomalie.\033[0m\n\n' "$checks"
else
	printf '  \033[31m%d contrôles, %d en échec.\033[0m\n\n' "$checks" "$failures"
	exit 1
fi
