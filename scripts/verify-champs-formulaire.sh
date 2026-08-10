#!/usr/bin/env bash
# @verifies CRM-035 (docs/BACKLOG.md) — Definition of Done des champs de formulaire
# @verifies docs/SPEC-form-composer.md §2.2 (modèle), §2.4 (options exigées), §2.5 (clé et
#           archivage), §2.6 (ordre), §2.7 (autorisations), §2.8 (contrat d'API), §2.9 (seed),
#           §2.10 (ce qui n'est pas livré), §3.3 (garanties structurelles), §7.1 (preuves)
# @verifies docs/SPEC-permissions-rls.md §4 (écriture `admin`), §7 (preuves de refus)
# @verifies docs/SPEC-seed.md §2.10 (champs et règles du seed)
# @verifies docs/INCONSISTENCY_REPORT.md INC-025 (colonnes communes), INC-033 (liaison CRM-018),
#           INC-037 (close : la copie emporte les champs), INC-043 (`CRM-034` sans cible)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-035` :
#
#   1. la suite pgTAP `supabase/tests/0010_champs_formulaire.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier les tables, les contraintes ni les politiques ;
#   3. elle est **convergente** : une contrainte retirée à la main est rétablie par un rejeu, et une
#      contrainte **affaiblie** est réparée — et non laissée telle quelle (décisions 57 et 78) ;
#   4. les refus tiennent contre l'API, avec le jeton réel de l'administrateur et celui du
#      business developer, chaque refus **relisant la ligne** pour la constater inchangée ;
#   5. le seed est conforme au contrat du §2.9 et **convergent** ;
#   6. INC-037 est **refermée** : source et copie portent sept champs, avec identifiants remappés ;
#   7. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve rien d'une interface. La grille champ × étape que la Definition of Done nomme
# suppose un écran d'administration authentifié, et la webapp reste un appelant **anonyme** faute
# d'écran de connexion (INC-021). Il n'y a donc ni test E2E d'interface ni capture à produire pour
# cette unité — non par renoncement, mais parce qu'il n'existe rien à regarder. Les règles sont
# livrées et prouvées **en base et par l'API**, ce que `CLAUDE.md` §10 exige de toute façon.
#
# Il ne prouve rien non plus d'une **obligation** : `visibility = 'required'` est une déclaration
# sans garde tant que `move_card` n'existe pas (`CRM-034`, INC-043).
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-champs-formulaire.sh
#   scripts/verify-champs-formulaire.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0010_champs_formulaire.test.sql
MIGRATION_FILE=supabase/migrations/0009_champs_formulaire.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
WF_GLOBAL=5eed0000-0000-4000-8000-000000000051
ETAPE_PROSPECTION=5eed0000-0000-4000-8000-000000000061
CHAMP_BUDGET=5eed0000-0000-4000-8000-000000000081
CHAMP_SOURCE=5eed0000-0000-4000-8000-000000000082
CHAMP_ARCHIVE=5eed0000-0000-4000-8000-000000000087
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

CORPS=/tmp/p2enjoy-champs-body
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

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser un champ de
# preuve derrière elle. Les règles partent par cascade avec leurs champs.
menage() {
	psql_db -c "delete from public.form_fields where key like 'tst-crm035-%';" >/dev/null 2>&1 || true
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
			select 'con:' || c.conname || ':' || md5(pg_get_constraintdef(c.oid)) as x
			  from pg_constraint c
			 where c.conrelid in ('public.form_fields'::regclass,
			                      'public.form_field_rules'::regclass)
			union all
			select 'pol:' || p.polname || ':' || p.polrelid::regclass::text
			  from pg_policy p
			 where p.polrelid in ('public.form_fields'::regclass,
			                      'public.form_field_rules'::regclass)
			union all
			select 'trg:' || t.tgname
			  from pg_trigger t
			 where t.tgrelid = 'public.form_fields'::regclass and not t.tgisinternal
			union all
			select 'fn:' || md5(pg_get_functiondef(p.oid))
			  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'app' and p.proname = 'form_fields_attribuer_position'
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
[ "$avant" = "$apres" ] \
	&& ok "le rejeu ne modifie ni les contraintes, ni les politiques, ni le trigger" \
	|| fail "le rejeu a modifié quelque chose : l'empreinte diffère"

# Convergence, et non simple idempotence : une contrainte **retirée** est rétablie (décision 57).
psql_db -c "alter table public.form_fields drop constraint form_fields_type_check;" >/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
[ "$(psql_db -c "select count(*) from pg_constraint
                  where conrelid = 'public.form_fields'::regclass
                    and conname = 'form_fields_type_check';")" = "1" ] \
	&& ok "une contrainte retirée à la main est **rétablie** par un rejeu : la migration répare" \
	|| fail "la contrainte retirée n'est pas rétablie"

# Convergence de la forme la plus difficile (décision 78) : une clé étrangère composite dégradée en
# clé **simple** portant le même nom. Tester la présence du nom la laisserait passer.
psql_db -c "
	alter table public.form_field_rules
		drop constraint form_field_rules_field_id_workflow_id_fkey;
	alter table public.form_field_rules
		add constraint form_field_rules_field_id_workflow_id_fkey
		foreign key (field_id) references public.form_fields (id) on delete cascade;
" >/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
definition=$(psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
                          where conname = 'form_field_rules_field_id_workflow_id_fkey';")
case "$definition" in
	*'(field_id, workflow_id)'*)
		ok "une clé composite **dégradée en clé simple** sous le même nom est réparée par un rejeu "\
"(décision 78) : la définition réelle est comparée, pas le nom" ;;
	*) fail "la clé dégradée n'a pas été réparée : « $definition »" ;;
esac

titre "3. Ce que la base refuse, mesuré contre l'API avec le jeton réel"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_BIZDEV=$(jeton_de "$MAIL_BIZDEV")
[ -n "$T_ADMIN" ] && [ -n "$T_BIZDEV" ] \
	&& ok "jetons de l'administratrice et du business developer obtenus par la vraie route" \
	|| fail "connexion d'un compte seedé impossible"

poster() {
	http POST "$API/rest/v1/$1" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $2" \
		-H 'Content-Type: application/json' -d "$3"
}

champ_json() {
	local options=${3:-'{}'}
	jq -nc --arg wf "$WF_GLOBAL" --arg ws "$WS_SEED" --arg cle "$1" --arg type "$2" \
	       --argjson options "$options" \
	 '{workflow_id: $wf, workspace_id: $ws, key: $cle, label: "Champ de preuve", type: $type,
	   options: $options}'
}

# LE DÉFAUT DE LA DÉCISION 98, ÉPROUVÉ PAR L'API ET NON SEULEMENT EN pgTAP. L'absence pure de
# `choices` est le cas que la première écriture de la contrainte laissait passer, `NULL` n'étant ni
# vrai ni faux — et un `CHECK` qui rend `NULL` accepte la ligne.
code=$(poster form_fields "$T_ADMIN" "$(champ_json 'tst-crm035-select' 'select')")
[ "$code" = "400" ] && [ "$(jq -r '.code' < "$CORPS")" = "23514" ] \
	&& ok "un \`select\` **sans** \`choices\` est refusé en 23514 — le cas que la contrainte "\
"laissait passer avant la décision 102" \
	|| fail "select sans choices : code $code, \`$(jq -r '.code // empty' < "$CORPS")\`"

code=$(poster form_fields "$T_ADMIN" "$(champ_json 'tst-crm035-select2' 'select' '{"choices":[]}')")
[ "$code" = "400" ] && ok "un \`select\` dont \`choices\` est **vide** est refusé lui aussi" \
	|| fail "select à choices vide : code $code"

code=$(poster form_fields "$T_ADMIN" "$(champ_json 'tst-crm035-money' 'money')")
[ "$code" = "400" ] && [ "$(jq -r '.code' < "$CORPS")" = "23514" ] \
	&& ok "un \`money\` **sans** \`currency\` est refusé en 23514" \
	|| fail "money sans currency : code $code"

code=$(poster form_fields "$T_ADMIN" "$(champ_json 'tst-crm035-type' 'siret')")
[ "$code" = "400" ] && ok "un \`type\` hors des quinze valeurs est refusé" \
	|| fail "type inconnu : code $code"

cle_archivee=$(psql_db -c "select key from public.form_fields where id = '$CHAMP_ARCHIVE';")
code=$(poster form_fields "$T_ADMIN" "$(champ_json "$cle_archivee" 'number')")
[ "$code" = "409" ] && [ "$(jq -r '.code' < "$CORPS")" = "23505" ] \
	&& ok "la clé d'un champ **archivé** reste réservée : la réutiliser est refusé (décision 96)" \
	|| fail "clé d'un champ archivé : code $code"

# Le croisement de deux workflows, mesuré par l'API. L'étape visée appartient à la copie du seed.
ETAPE_COPIE=$(psql_db -c "select s.id from public.workflow_steps s
                            join public.workflows w on w.id = s.workflow_id
                           where w.derived_from_workflow_id = '$WF_GLOBAL'
                             and w.name = 'Cycle commercial — Conseil IA'
                           order by s.position limit 1;")
code=$(poster form_field_rules "$T_ADMIN" \
	"$(jq -nc --arg f "$CHAMP_BUDGET" --arg s "$ETAPE_COPIE" --arg wf "$WF_GLOBAL" \
	          --arg ws "$WS_SEED" \
	 '{field_id: $f, step_id: $s, workflow_id: $wf, workspace_id: $ws, visibility: "required"}')")
[ "$code" = "409" ] && [ "$(jq -r '.code' < "$CORPS")" = "23503" ] \
	&& ok "une règle croisant deux workflows est refusée par une clé composite (décision 95)" \
	|| fail "règle croisée : code $code, \`$(jq -r '.code // empty' < "$CORPS")\`"

titre "4. Les autorisations, et le piège du refus silencieux"

code=$(poster form_fields "$T_BIZDEV" "$(champ_json 'tst-crm035-bizdev' 'text')")
restant=$(psql_db -c "select count(*) from public.form_fields where key = 'tst-crm035-bizdev';")
[ "$code" = "403" ] && [ "$restant" = "0" ] \
	&& ok "un \`business_developer\` ne crée aucun champ : 403, **et aucune ligne**" \
	|| fail "création par un bizdev : code $code, lignes restantes $restant"

# Le piège de la décision 70 : un refus par `USING` ne lève **aucune** erreur. Sans la relecture, ce
# contrôle serait vert que la politique existe ou non.
avant_label=$(psql_db -c "select label from public.form_fields where id = '$CHAMP_SOURCE';")
code=$(http PATCH "$API/rest/v1/form_fields?id=eq.$CHAMP_SOURCE" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_BIZDEV" -H 'Content-Type: application/json' \
	-d '{"label":"Renommé par un bizdev"}')
apres_label=$(psql_db -c "select label from public.form_fields where id = '$CHAMP_SOURCE';")
[ "$code" = "204" ] && [ "$avant_label" = "$apres_label" ] \
	&& ok "un \`business_developer\` obtient 204 et **ne modifie rien** : le refus est silencieux, "\
"et c'est la relecture qui le prouve (décision 70)" \
	|| fail "mise à jour par un bizdev : code $code, libellé « $avant_label » → « $apres_label »"

# DÉCISION 96 : le refus de suppression est **double** — aucune politique, aucun privilège.
code=$(http DELETE "$API/rest/v1/form_fields?id=eq.$CHAMP_SOURCE" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN")
restant=$(psql_db -c "select count(*) from public.form_fields where id = '$CHAMP_SOURCE';")
[ "$code" = "403" ] && [ "$restant" = "1" ] \
	&& ok "même un \`admin\` ne supprime pas un champ : 403 par le **privilège**, et la ligne reste" \
	|| fail "suppression par un admin : code $code, lignes restantes $restant"

code=$(http GET "$API/rest/v1/form_fields" -H "apikey: $ANON_KEY")
lignes=$(jq -r 'length' < "$CORPS")
[ "$code" = "200" ] && [ "$lignes" = "0" ] \
	&& ok "un anonyme obtient 200 et **zéro ligne** : le refus n'est jamais une erreur de privilège" \
	|| fail "lecture anonyme : code $code, $lignes lignes"

titre "5. Le seed est conforme au §2.9, et convergent"

champs=$(psql_db -c "select count(*) from public.form_fields where workflow_id = '$WF_GLOBAL';")
archives=$(psql_db -c "select count(*) from public.form_fields
                        where workflow_id = '$WF_GLOBAL' and archived_at is not null;")
types=$(psql_db -c "select count(distinct type) from public.form_fields
                     where workflow_id = '$WF_GLOBAL';")
regles=$(psql_db -c "select count(*) from public.form_field_rules where workflow_id = '$WF_GLOBAL';")
visibilites=$(psql_db -c "select count(distinct visibility) from public.form_field_rules
                           where workflow_id = '$WF_GLOBAL';")

[ "$champs" = "7" ] && ok "sept champs sur le workflow par défaut" \
	|| fail "champs : $champs, attendu 7"
[ "$archives" = "1" ] && ok "dont **un archivé** : l'état est démontrable et non seulement documenté" \
	|| fail "champs archivés : $archives, attendu 1"
[ "$types" = "7" ] && ok "sept types distincts, dont les deux qui exigent des options" \
	|| fail "types distincts : $types, attendu 7"
[ "$regles" = "15" ] && ok "quinze règles de visibilité" || fail "règles : $regles, attendu 15"
[ "$visibilites" = "3" ] \
	&& ok "les **trois** visibilités sont exercées par des données réelles, \`visible\` comprise" \
	|| fail "visibilités distinctes : $visibilites, attendu 3"

sans_regle=$(psql_db -c "
	select count(*) from public.form_fields f
	 cross join public.workflow_steps s
	  left join public.form_field_rules r on r.field_id = f.id and r.step_id = s.id
	 where f.workflow_id = '$WF_GLOBAL' and s.workflow_id = '$WF_GLOBAL'
	   and f.archived_at is null and r.field_id is null;")
[ "$sans_regle" = "27" ] \
	&& ok "vingt-sept couples champ × étape restent **sans règle** : la valeur par défaut \`visible\` "\
"est démontrée, non seulement écrite" \
	|| fail "couples sans règle : $sans_regle, attendu 27"

# Convergence : une valeur faussée à la main est **ramenée** au contrat par un rejeu du seed, elle
# n'est pas seulement laissée telle quelle (décision 34, et INC-041 pour la forme qui manquait).
psql_db -c "update public.form_fields set label = 'Faussé à la main', options = '{}'::jsonb
             where id = '$CHAMP_SOURCE';" >/dev/null 2>&1 || true
if supabase/seed/apply-seed.sh >/dev/null 2>&1; then
	libelle=$(psql_db -c "select label from public.form_fields where id = '$CHAMP_SOURCE';")
	choix=$(psql_db -c "select jsonb_array_length(options -> 'choices') from public.form_fields
	                     where id = '$CHAMP_SOURCE';")
	[ "$libelle" = "Origine du contact" ] && [ "$choix" = "4" ] \
		&& ok "un champ faussé à la main est **ramené** au contrat par un rejeu du seed, options "\
"comprises : le seed converge, il ne se contente pas de ne pas échouer" \
		|| fail "après rejeu : libellé « $libelle », $choix choix — attendu « Origine du contact » et 4"
else
	fail "le rejeu du seed a échoué"
fi

titre "6. CRM-018 : le formulaire est réellement copié"

champs_source=$(psql_db -c "select count(*) from public.form_fields where workflow_id = '$WF_GLOBAL';")
champs_copie=$(psql_db -c "
	select count(*) from public.form_fields f
	  join public.workflows w on w.id = f.workflow_id
	 where w.derived_from_workflow_id = '$WF_GLOBAL'
	   and w.name = 'Cycle commercial — Conseil IA';")
[ "$champs_source" = "7" ] && [ "$champs_copie" = "7" ] \
	&& ok "la source et sa copie portent chacune 7 champs, avec des identifiants remappés" \
	|| fail "source $champs_source, copie $champs_copie — attendu 7 et 7"

# RÉVISÉ À `CRM-036`, NON RETIRÉ — mécanisme de la décision 51. Ce contrôle constatait le vide, et
# nommait son motif : aucune garde ne lisait la colonne. `move_card` la lit désormais, et le seed
# pose une exigence sur « Démarrer la réalisation » — la seule donnée qui exerce le second membre
# de l'union de docs/SPEC-form-composer.md §3.5. Le contrôle **compte** au lieu de constater.
# CRM-018 rend le compte déterministe par construction : une liaison globale et une dérivée.
exigeantes=$(psql_db -c "select count(*) from public.workflow_transition_required_fields trf
                          join public.workflow_transitions t on t.id = trf.transition_id
                         where t.workflow_id = '$WF_GLOBAL';")
[ "$exigeantes" = "1" ] \
	&& ok "CRM-018 : UNE liaison de champ exigé sur le workflow GLOBAL" \
	|| fail "liaisons du workflow global : $exigeantes, attendu 1"

heritees=$(psql_db -c "select count(*) from public.workflow_transition_required_fields trf
                         join public.workflow_transitions t on t.id = trf.transition_id
                         join public.workflows w on w.id = t.workflow_id
	                        where w.derived_from_workflow_id = '$WF_GLOBAL'
	                          and w.name = 'Cycle commercial — Conseil IA';")
[ "$heritees" = "1" ] \
	&& ok "CRM-018 / INC-056 : la copie porte UNE exigence fonctionnelle remappée" \
	|| fail "liaisons sur le workflow dérivé : $heritees, attendu 1"

titre "7. Le harnais est non complaisant : trois dégradations réelles"

# Dégradation 1 — la contrainte des choix retirée. Un `select` sans choix doit alors passer.
psql_db -c "alter table public.form_fields drop constraint form_fields_choices_check;" >/dev/null
code=$(poster form_fields "$T_ADMIN" "$(champ_json 'tst-crm035-degrade1' 'select')")
[ "$code" = "201" ] \
	&& ok "DÉGRADATION 1 : sans \`form_fields_choices_check\`, un \`select\` sans choix **passe** — "\
"la contrainte porte réellement quelque chose" \
	|| fail "DÉGRADATION 1 : le refus subsiste ($code) — le contrôle mesurait autre chose"
psql_db -c "delete from public.form_fields where key = 'tst-crm035-degrade1';" >/dev/null

# Dégradation 2 — la clé composite des règles remplacée par une clé simple. Le croisement passe.
psql_db -c "
	alter table public.form_field_rules
		drop constraint form_field_rules_step_id_workflow_id_fkey;
	alter table public.form_field_rules
		add constraint form_field_rules_step_id_workflow_id_fkey
		foreign key (step_id) references public.workflow_steps (id) on delete cascade;
" >/dev/null
code=$(poster form_field_rules "$T_ADMIN" \
	"$(jq -nc --arg f "$CHAMP_BUDGET" --arg s "$ETAPE_COPIE" --arg wf "$WF_GLOBAL" \
	          --arg ws "$WS_SEED" \
	 '{field_id: $f, step_id: $s, workflow_id: $wf, workspace_id: $ws, visibility: "hidden"}')")
[ "$code" = "201" ] \
	&& ok "DÉGRADATION 2 : avec une clé **simple**, une règle croisant deux workflows **passe** — "\
"c'est bien la composition de la clé qui l'interdit, non son existence" \
	|| fail "DÉGRADATION 2 : le refus subsiste ($code)"
psql_db -c "delete from public.form_field_rules
             where field_id = '$CHAMP_BUDGET' and step_id = '$ETAPE_COPIE';" >/dev/null

# Dégradation 3 — le privilège `DELETE` accordé. La suppression d'un champ passe alors la première
# barrière, et c'est l'absence de politique qui doit encore la refuser. Cette dégradation prouve que
# le refus est **double**, et non porté par un seul mécanisme.
psql_db -c "grant delete on public.form_fields to authenticated;" >/dev/null
code=$(http DELETE "$API/rest/v1/form_fields?id=eq.$CHAMP_SOURCE" -H "apikey: $ANON_KEY" \
	-H "Authorization: Bearer $T_ADMIN")
restant=$(psql_db -c "select count(*) from public.form_fields where id = '$CHAMP_SOURCE';")
[ "$code" = "204" ] && [ "$restant" = "1" ] \
	&& ok "DÉGRADATION 3 : le privilège accordé, le refus passe de 403 à un 204 **sans effet** — "\
"l'absence de politique tient la seconde barrière, le refus est bien double (décision 96)" \
	|| fail "DÉGRADATION 3 : code $code, lignes restantes $restant"

titre "8. Restauration constatée, et non supposée"

psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true

restaure=$(psql_db -c "
	select (select count(*) from pg_constraint
	         where conname = 'form_fields_choices_check')::text
	    || '/' ||
	       (select case when pg_get_constraintdef(oid) like '%(step_id, workflow_id)%'
	                    then 'composite' else 'simple' end
	          from pg_constraint where conname = 'form_field_rules_step_id_workflow_id_fkey')
	    || '/' ||
	       (select has_table_privilege('authenticated', 'public.form_fields', 'DELETE')::text);
")
[ "$restaure" = "1/composite/false" ] \
	&& ok "restauration constatée : la contrainte des choix est revenue, la clé est de nouveau "\
"composite, et le privilège \`DELETE\` a été retiré" \
	|| fail "restauration incomplète : « $restaure », attendu « 1/composite/false »"

code=$(poster form_fields "$T_ADMIN" "$(champ_json 'tst-crm035-apres' 'select')")
[ "$code" = "400" ] && ok "et le refus est de nouveau opposé au \`select\` sans choix" \
	|| fail "après restauration, le select sans choix rend encore $code"

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
