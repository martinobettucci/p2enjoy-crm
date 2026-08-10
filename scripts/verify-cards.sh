#!/usr/bin/env bash
# @verifies CRM-040 (docs/BACKLOG.md) — Definition of Done des cards
# @verifies docs/SPEC-cards.md §2 (modèle et clés composites), §3 (adresse générée),
#           §4 (archivage et corbeille), §5 (« active »), §6 (autorisations), §7 (garde
#           d'archivage d'un nœud occupé), §8 (contrat d'API), §9 (seed), §10 (points ouverts),
#           §11 (preuves attendues)
# @verifies docs/SPEC-permissions-rls.md §3 (fonctions), §4 (politiques), §7 (preuves n° 3, 4, 11)
# @verifies docs/SPEC-workflow-engine.md §2.6 (archivage d'un nœud occupé), §5 (`move_card`)
# @verifies docs/INCONSISTENCY_REPORT.md INC-013 (close), INC-021 (aucun écran),
#           INC-031 (close par la garde), INC-046 (le workflow d'un channel occupé)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-040` :
#
#   1. la suite pgTAP `supabase/tests/0012_cards.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier la table, ses contraintes, ses politiques ni ses triggers ;
#   3. elle est **convergente** : une contrainte retirée à la main est rétablie par un rejeu, et
#      une clé composite **dégradée en clé simple** sous le même nom est réparée (décisions 57, 78) ;
#   4. l'adresse de la card est réellement générée, unique, et la valeur du client ignorée ;
#   5. les refus tiennent contre l'API, avec les jetons réels des trois profils seedés, chaque
#      refus de mise à jour **relisant la ligne** pour la constater inchangée ;
#   6. la garde d'archivage d'un nœud occupé refuse ce qu'elle doit refuser, et laisse passer ce
#      qu'elle doit laisser passer — INC-031 ;
#   7. le seed est conforme au contrat du §9 et **convergent** ;
#   8. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve rien d'une interface. La webapp reste un appelant **anonyme** faute d'écran de
# connexion (INC-021), et une card est par construction invisible à un anonyme : il n'existe ni
# écran ni capture à produire pour cette unité. Les règles sont livrées et prouvées **en base et
# par l'API**, ce que `CLAUDE.md` §10 exige de toute façon.
#
# Il ne prouve rien non plus de `move_card` (`CRM-034`) ni de la protection de colonne de
# `CRM-013` : ni l'une ni l'autre n'est livrée, et l'écart est **figé par des assertions** de la
# suite pgTAP plutôt que couvert ici.
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-cards.sh
#   scripts/verify-cards.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0012_cards.test.sql
# RESTAURER, C'EST RAMENER LA BASE À L'ÉTAT QUE LE RUNNER PRODUIT — et le runner rejoue TOUT le
# répertoire, dans l'ordre (docs/JOURNAL.md décision 20). Rejouer `0011` SEUL rend à
# `authenticated` le `grant update on public.cards` de sa section 7, ce que `0012` retire
# précisément pour rendre `move_card` incontournable, et ce que `0013` complète.
#
# DÉFAUT RÉEL, MESURÉ LE 2026-08-05 — INC-055 : ce harnais laissait la base dans un état que le
# runner ne produit JAMAIS. MESURÉ, avant et après son passage sur une base saine :
# `has_table_privilege('authenticated', 'public.cards', 'update')` passait de `false` à `true`, et
# `npm run test:sql` de « aucune anomalie » à **huit assertions en échec** réparties sur
# `0012_cards.test.sql` et `0013_move_card.test.sql`. La garde centrale de `CRM-034` était donc
# désactivée pour tout ce qui s'exécutait ensuite, sans qu'aucun message ne le signale.
# La 14 s'y ajoute depuis `CRM-013` : elle referme `cards.email_local_part`, que la section 2 de
# la 12 rend au contraire OUVERTE. Rejouer 11 → 12 → 13 sans elle rouvrirait cette colonne — même
# mode de défaillance, un cran plus loin (décisions 143 et 145).
#
# DÉFAUT RÉEL, MESURÉ LE 2026-08-09 — décision 309, INC-080 : même une liste manuelle des
# migrations suivantes devient fausse. Elle omettait la 20, qui rend la FK card/channel/workflow
# différable ; SQL et API devenaient rouges après le harnais. Le vrai runner est la seule liste
# exhaustive et le seul ordre autorisés. `run --rm` attend son code avant toute mesure suivante.
TRAVAIL=$(mktemp -d)
RUNNER_LOG="$TRAVAIL/migrations-runner.log"

# Rejoue le véritable runner complet et attend sa terminaison.
rejouer_migrations() {
	docker compose -f docker-compose.yml -f docker-compose.dev.yml \
		run --rm migrations-runner >"$RUNNER_LOG" 2>&1
}
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
WF_GLOBAL=5eed0000-0000-4000-8000-000000000051
ETAPE_PROSPECTION=5eed0000-0000-4000-8000-000000000061
CH_GRANDS_COMPTES=5eed0000-0000-4000-8000-000000000032
CH_MAINTENANCE=5eed0000-0000-4000-8000-000000000035
CARD_MAINTENANCE=5eed0000-0000-4000-8000-0000000000c5
NOEUD_LIBRE=c0400000-0000-4000-8000-00000000ff01
ETAPE_LIBRE=c0400000-0000-4000-8000-00000000ff02
MAIL_ADMIN=admin@p2enjoy.test
MAIL_BIZDEV=bizdev@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,45p' "$0"; exit 0 ;;
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

CORPS=/tmp/p2enjoy-cards-body
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

poster() {
	local jeton=$1 charge=$2
	http POST "$API/rest/v1/cards" \
		-H "apikey: $ANON_KEY" -H "Authorization: Bearer $jeton" \
		-H 'Content-Type: application/json' -H 'Prefer: return=representation' \
		-d "$charge"
}

carte_json() {
	local titre=$1 channel=${2:-$CH_GRANDS_COMPTES} etape=${3:-$ETAPE_PROSPECTION}
	jq -nc --arg t "$titre" --arg ws "$WS_SEED" --arg ch "$channel" --arg wf "$WF_GLOBAL" \
	       --arg st "$etape" \
	  '{title: $t, workspace_id: $ws, channel_id: $ch, workflow_id: $wf, current_step_id: $st}'
}

# Le ménage est posé avant toute création : une interruption ne doit jamais laisser une card de
# preuve derrière elle. Il filtre sur le préfixe de titre, jamais sur un prédicat métier — un
# `delete` par prédicat amputerait le seed (décision 108).
menage() {
	psql_db -c "delete from public.cards where title like 'tst-crm040-%';
	              delete from public.workflow_steps where id = '$ETAPE_LIBRE';
	              delete from public.workflow_nodes_catalog where id = '$NOEUD_LIBRE';" \
		>/dev/null 2>&1 || true
}
trap 'menage; rm -f "$CORPS"; rm -rf -- "$TRAVAIL"' EXIT
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
			 where c.conrelid in ('public.cards'::regclass, 'public.channels'::regclass)
			union all
			select 'pol:' || p.polname
			  from pg_policy p where p.polrelid = 'public.cards'::regclass
			union all
			select 'trg:' || t.tgname
			  from pg_trigger t
			 where t.tgrelid in ('public.cards'::regclass,
			                     'public.workflow_nodes_catalog'::regclass)
			   and not t.tgisinternal
			union all
			select 'idx:' || i.indexrelid::regclass::text
			  from pg_index i where i.indrelid = 'public.cards'::regclass
			union all
			select 'fn:' || md5(pg_get_functiondef(p.oid))
			  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where n.nspname = 'app'
			   and p.proname in ('can_read_card', 'cards_attribuer_position',
			                     'cards_generer_email_local_part',
			                     'catalogue_refuser_archivage_noeud_occupe')
		) t;
	"
}

avant=$(empreinte)
if rejouer_migrations; then
	ok "la migration se réapplique sans erreur sur une base déjà migrée"
else
	fail "la migration échoue au rejeu — l'idempotence n'est pas acquise"
fi
apres=$(empreinte)
[ "$avant" = "$apres" ] \
	&& ok "le rejeu ne modifie ni les contraintes, ni les politiques, ni les triggers, ni les index" \
	|| fail "le rejeu a modifié quelque chose : l'empreinte diffère"

# L'outil de convergence est retiré en fin de migration : le laisser dans le schéma `app` en
# ferait une surface publique capable de reconstruire n'importe quelle contrainte.
[ "$(psql_db -c "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'app'
                    and p.proname = 'migration_0011_converger_contrainte';")" = "0" ] \
	&& ok "l'outil de convergence est retiré en fin de migration, comme à \`CRM-031\`" \
	|| fail "\`app.migration_0011_converger_contrainte\` subsiste dans le schéma"

# Convergence, et non simple idempotence : une contrainte **retirée** est rétablie (décision 57).
psql_db -c "alter table public.cards drop constraint cards_currency_check;" >/dev/null
rejouer_migrations || true
[ "$(psql_db -c "select count(*) from pg_constraint
                  where conrelid = 'public.cards'::regclass
                    and conname = 'cards_currency_check';")" = "1" ] \
	&& ok "une contrainte retirée à la main est **rétablie** par un rejeu : la migration répare" \
	|| fail "la contrainte retirée n'est pas rétablie"

# Convergence de la forme la plus difficile (décision 78) : une clé composite dégradée en clé
# **simple** portant le même nom. Tester la présence du nom la laisserait passer.
psql_db -c "
	alter table public.cards drop constraint cards_channel_id_workflow_id_fkey;
	alter table public.cards
		add constraint cards_channel_id_workflow_id_fkey
		foreign key (channel_id) references public.channels (id);
" >/dev/null
rejouer_migrations || true
definition=$(psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
                          where conname = 'cards_channel_id_workflow_id_fkey';")
case "$definition" in
	*'(channel_id, workflow_id)'*)
		ok "une clé composite **dégradée en clé simple** sous le même nom est réparée par un rejeu "\
"(décision 78) : la définition réelle est comparée, pas le nom" ;;
	*) fail "la clé dégradée n'a pas été réparée : « $definition »" ;;
esac

titre "3. L'adresse de la card — §3, décision 112"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_BIZDEV=$(jeton_de "$MAIL_BIZDEV")
T_VIEWER=$(jeton_de "$MAIL_VIEWER")
[ -n "$T_ADMIN" ] && ok "jeton de l'administratrice obtenu par la vraie route de connexion" \
	|| fail "connexion de l'administratrice impossible"
[ -n "$T_BIZDEV" ] && ok "jeton du business developer obtenu par la vraie route de connexion" \
	|| fail "connexion du business developer impossible"
[ -n "$T_VIEWER" ] && ok "jeton du viewer obtenu par la vraie route de connexion" \
	|| fail "connexion du viewer impossible"

code=$(poster "$T_ADMIN" "$(carte_json 'tst-crm040-une')")
adresse_une=$(jq -r '.[0].email_local_part // empty' "$CORPS")
[ "$code" = "201" ] && ok "l'administratrice crée une card (ligne a du §8.1)" \
	|| fail "création refusée : $code"
printf '%s' "$adresse_une" | grep -Eq '^c-[0-9abcdefghjkmnpqrstvwxyz]{8}$' \
	&& ok "l'adresse générée a la forme \`c-<8 base32 Crockford>\` : « $adresse_une »" \
	|| fail "adresse hors forme : « $adresse_une »"

code=$(poster "$T_ADMIN" "$(carte_json 'tst-crm040-deux')")
adresse_deux=$(jq -r '.[0].email_local_part // empty' "$CORPS")
[ "$adresse_une" != "$adresse_deux" ] \
	&& ok "deux cards portent deux adresses différentes (ligne b)" \
	|| fail "deux cards partagent la même adresse : « $adresse_une »"

charge=$(carte_json 'tst-crm040-imposee' | jq -c '. + {email_local_part: "c-00000000"}')
code=$(poster "$T_ADMIN" "$charge")
adresse_imposee=$(jq -r '.[0].email_local_part // empty' "$CORPS")
[ "$code" = "201" ] && [ "$adresse_imposee" != "c-00000000" ] \
	&& ok "une adresse fournie par le client est **ignorée et remplacée** (ligne c, §3.4)" \
	|| fail "l'adresse du client a été retenue : $code / « $adresse_imposee »"

# Ce qui garantit l'unicité est l'INDEX, non la boucle du trigger (décision 112). La preuve passe
# par une MISE À JOUR, et non par une insertion : le trigger de génération est `BEFORE INSERT`, il
# remplace toute valeur fournie, et une insertion en double n'atteindrait donc jamais l'index —
# MESURÉ, elle est acceptée avec une adresse neuve. La mise à jour, elle, ne réveille aucun trigger
# et met l'index en face de ses responsabilités. Elle exerce au passage le manque nommé au §3.4,
# que `CRM-013` doit combler.
conflit=$(psql_db -c "do \$\$ begin
	update public.cards set email_local_part = '$adresse_une' where title = 'tst-crm040-deux';
	raise notice 'ACCEPTE';
exception when unique_violation then raise notice 'REFUSE';
end \$\$;" 2>&1 | grep -o 'REFUSE\|ACCEPTE' | head -1)
[ "$conflit" = "REFUSE" ] \
	&& ok "l'index unique refuse une adresse déjà prise, même écrite directement : c'est LUI qui "\
"garantit, la boucle du trigger ne fait que rendre l'erreur improbable (décision 112)" \
	|| fail "une adresse en double a été acceptée : « $conflit »"

titre "4. Cohérence structurelle — §2.4, décision 109"

etape_etrangere=$(psql_db -c "select id from public.workflow_steps
                               where workflow_id <> '$WF_GLOBAL' limit 1;")
charge=$(carte_json 'tst-crm040-etape-etrangere' \
         | jq -c --arg s "$etape_etrangere" '. + {current_step_id: $s}')
code=$(poster "$T_ADMIN" "$charge")
sqlstate=$(jq -r '.code // empty' "$CORPS")
[ "$code" = "409" ] && [ "$sqlstate" = "23503" ] \
	&& ok "une étape d'un AUTRE workflow est refusée en 409 / 23503 (ligne e) — vérification n° 3 "\
"des six de \`move_card\`, acquise structurellement" \
	|| fail "étape étrangère : $code / $sqlstate, attendu 409 / 23503"

wf_etranger=$(psql_db -c "select id from public.workflows where id <> '$WF_GLOBAL' limit 1;")
charge=$(carte_json 'tst-crm040-wf-etranger' | jq -c --arg w "$wf_etranger" '. + {workflow_id: $w}')
code=$(poster "$T_ADMIN" "$charge")
[ "$code" = "409" ] \
	&& ok "un \`workflow_id\` autre que celui du channel est refusé (ligne f) — « suit le channel »" \
	|| fail "workflow étranger : $code, attendu 409"

# INC-046 : la conséquence émergente, constatée là où elle se produit.
occupe=$(psql_db -c "do \$\$ begin
	update public.channels set workflow_id = '$wf_etranger' where id = '$CH_GRANDS_COMPTES';
	raise notice 'ACCEPTE';
exception when foreign_key_violation then raise notice 'REFUSE';
end \$\$;" 2>&1 | grep -o 'REFUSE\|ACCEPTE' | head -1)
[ "$occupe" = "REFUSE" ] \
	&& ok "INC-046 : changer le workflow d'un channel OCCUPÉ est refusé — règle défendable que "\
"nulle spécification n'énonce, arbitrage attendu" \
	|| fail "le workflow d'un channel occupé a pu changer : « $occupe »"

titre "5. Autorisations, avec les jetons réels (§8.1, lignes k à s)"

code=$(poster "$T_BIZDEV" "$(carte_json 'tst-crm040-bizdev')")
[ "$code" = "201" ] && ok "le business developer crée une card là où rien ne le restreint (ligne k)" \
	|| fail "création par le business developer : $code, attendu 201"

code=$(poster "$T_BIZDEV" "$(carte_json 'tst-crm040-bizdev-maint' "$CH_MAINTENANCE")")
[ "$code" = "403" ] \
	&& ok "…et il est refusé dans \`maintenance\`, où un droit fin le met en lecture seule (ligne l)" \
	|| fail "création dans maintenance par le business developer : $code, attendu 403"

code=$(poster "$T_VIEWER" "$(carte_json 'tst-crm040-viewer')")
[ "$code" = "403" ] && ok "le \`viewer\` est refusé : créer exige le droit d'ÉCRITURE (ligne m)" \
	|| fail "création par le viewer : $code, attendu 403"

# Preuve n° 4 sur les cards : la table N'EST PAS VIDE, constaté d'abord avec la base.
reelles=$(psql_db -c "select count(*) from public.cards where channel_id = '$CH_GRANDS_COMPTES';")
vues=$(http GET "$API/rest/v1/cards?channel_id=eq.$CH_GRANDS_COMPTES&select=id" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_VIEWER" >/dev/null; jq 'length' "$CORPS")
[ "$reelles" -gt 0 ] && [ "$vues" = "0" ] \
	&& ok "PREUVE N° 4 : $reelles cards existent dans \`grands-comptes\`, le \`viewer\` en voit 0 — "\
"zéro ligne, jamais une erreur" \
	|| fail "lecture par le viewer : $reelles réelles, $vues vues"

# Preuve n° 11 : l'anonyme.
http GET "$API/rest/v1/cards?select=id" -H "apikey: $ANON_KEY" >/dev/null
[ "$(jq 'length' "$CORPS")" = "0" ] \
	&& ok "PREUVE N° 11 : un anonyme lit zéro ligne, sans erreur (ligne q)" \
	|| fail "l'anonyme a lu des cards"

# LE REFUS DU `USING` NE LÈVE AUCUNE ERREUR : il se prouve en relisant la ligne (décision 106).
titre_avant=$(psql_db -c "select title from public.cards where id = '$CARD_MAINTENANCE';")
http PATCH "$API/rest/v1/cards?id=eq.$CARD_MAINTENANCE" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_BIZDEV" \
	-H 'Content-Type: application/json' -d '{"title":"tst-crm040-usurpe"}' >/dev/null
titre_apres=$(psql_db -c "select title from public.cards where id = '$CARD_MAINTENANCE';")
[ "$titre_avant" = "$titre_apres" ] \
	&& ok "ligne r — le \`USING\` FILTRE : aucune erreur, aucune ligne touchée, la card est relue "\
"inchangée (décision 106)" \
	|| fail "la card de maintenance a été modifiée : « $titre_avant » → « $titre_apres »"

titre "6. La garde d'archivage d'un nœud occupé — INC-031, décision 111"

noeud_occupe=$(psql_db -c "select id from public.workflow_nodes_catalog
                            where workspace_id = '$WS_SEED' and key = 'relance';")
code=$(http PATCH "$API/rest/v1/workflow_nodes_catalog?id=eq.$noeud_occupe" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" \
        -H 'Content-Type: application/json' -d '{"archived_at":"2026-05-01T10:00:00Z"}')
message=$(jq -r '.message // empty' "$CORPS")
[ "$code" = "403" ] && printf '%s' "$message" | grep -q 'node_occupied' \
	&& ok "ligne w — archiver un nœud qu'une card ACTIVE occupe rend 403 / node_occupied" \
	|| fail "archivage d'un nœud occupé : $code / « $message »"

[ "$(psql_db -c "select count(*) from public.workflow_nodes_catalog
                  where id = '$noeud_occupe' and archived_at is null;")" = "1" ] \
	&& ok "et le nœud est relu ACTIF : le refus n'a rien laissé passer" \
	|| fail "le nœud a été archivé malgré le refus"

# « Active » a une définition, et elle compte. Depuis CRM-046, chaque étape officielle porte une
# card active, `livre` comprise : la contre-épreuve utilise donc un nœud, une étape et une card
# ARCHIVÉE jetables, sans altérer les données de démonstration ni supposer l'absence de données
# utilisateur sur un nœud officiel.
psql_db -c "insert into public.workflow_nodes_catalog
	              (id, workspace_id, key, label, kind, color, position)
	            values ('$NOEUD_LIBRE', '$WS_SEED', 'tst-crm040-libre', 'Libre CRM-040',
	                    'open', 'neutral', 999);
	            insert into public.workflow_steps
	              (id, workflow_id, workspace_id, node_id, position, is_initial)
	            values ('$ETAPE_LIBRE', '$WF_GLOBAL', '$WS_SEED', '$NOEUD_LIBRE', 999, false);
	            insert into public.cards
	              (workspace_id, channel_id, workflow_id, current_step_id, title, position,
	               archived_at)
	            values ('$WS_SEED', '$CH_GRANDS_COMPTES', '$WF_GLOBAL', '$ETAPE_LIBRE',
	                    'tst-crm040-noeud-libre', 999, '2026-05-01T09:00:00Z');" >/dev/null
code=$(http PATCH "$API/rest/v1/workflow_nodes_catalog?id=eq.$NOEUD_LIBRE" \
	        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" \
	        -H 'Content-Type: application/json' -d '{"archived_at":"2026-05-01T10:00:00Z"}')
[ "$code" = "204" ] \
	&& ok "ligne x — un nœud dont les seules cards sont ARCHIVÉES reste archivable : « active » a "\
"une définition (§5)" \
	|| fail "archivage d'un nœud libre : $code, attendu 204"
psql_db -c "delete from public.cards where title = 'tst-crm040-noeud-libre';
	            delete from public.workflow_steps where id = '$ETAPE_LIBRE';
	            delete from public.workflow_nodes_catalog where id = '$NOEUD_LIBRE';" >/dev/null

titre "7. Cycle de vie et absence de suppression — §4"

code=$(poster "$T_ADMIN" "$(carte_json 'tst-crm040-cycle')")
carte_cycle=$(jq -r '.[0].id // empty' "$CORPS")
code=$(http PATCH "$API/rest/v1/cards?id=eq.$carte_cycle" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" \
        -H 'Content-Type: application/json' -d '{"archived_at":"2026-05-01T10:00:00Z"}')
[ "$code" = "204" ] && ok "ligne t — l'archivage d'une card est accepté" \
	|| fail "archivage d'une card : $code"

code=$(http DELETE "$API/rest/v1/cards?id=eq.$carte_cycle" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN")
[ "$code" = "403" ] && ok "ligne v — \`DELETE\` est refusé : aucun privilège, aucune suppression "\
"physique, même pour une administratrice" \
	|| fail "DELETE sur une card : $code, attendu 403"

titre "8. Le seed est conforme et convergent — §9"

etat=$(psql_db -c "select count(*) || '/' ||
                          count(*) filter (where archived_at is not null) || '/' ||
                          count(*) filter (where deleted_at is not null) || '/' ||
                          count(distinct email_local_part)
                     from public.cards
                    where id::text like '5eed0000-0000-4000-8000-0000000000c%';")
[ "$etat" = "14/1/1/14" ] \
	&& ok "quatorze cards, une archivée, une en corbeille, quatorze adresses distinctes" \
	|| fail "état du seed : « $etat », attendu « 14/1/1/14 »"

[ "$(psql_db -c "select count(*) from public.cards c
	                  join public.workflows w on w.id = c.workflow_id
	                 where c.id in ('5eed0000-0000-4000-8000-0000000000ca',
	                                '5eed0000-0000-4000-8000-0000000000cb')
	                   and c.channel_id = '5eed0000-0000-4000-8000-000000000031'
	                   and w.derived_from_workflow_id = '5eed0000-0000-4000-8000-000000000051';")" = "2" ] \
	&& ok "deux cards dans \`prospection\`, toutes deux sur le workflow dérivé" \
	|| fail "\`prospection\` ne porte pas exactement ses deux fixtures dérivées"

adresses_avant=$(psql_db -c "select string_agg(email_local_part, ',' order by id)
                               from public.cards
                              where id::text like '5eed0000-0000-4000-8000-0000000000c%';")
./supabase/seed/apply-seed.sh >/dev/null 2>&1 \
	&& ok "le seed se rejoue sans erreur sur une base déjà peuplée de cards" \
	|| fail "le seed échoue au rejeu : la convergence n'est pas acquise"
adresses_apres=$(psql_db -c "select string_agg(email_local_part, ',' order by id)
                               from public.cards
                              where id::text like '5eed0000-0000-4000-8000-0000000000c%';")
[ "$adresses_avant" = "$adresses_apres" ] \
	&& ok "et les adresses des cards seedées sont **stables** d'un rejeu à l'autre : le seed ne les "\
"envoie jamais, la branche de mise à jour ne les touche donc pas" \
	|| fail "les adresses ont changé au rejeu du seed"

titre "9. Non-complaisance : le harnais échoue-t-il quand le produit se dégrade ?"

# a. La politique de lecture ramenée au cloisonnement par workspace : les droits fins cessent de
#    s'appliquer, et le `viewer` voit ce qu'il ne doit pas voir.
psql_db -c "
	drop policy cards_lecture on public.cards;
	create policy cards_lecture on public.cards for select to anon, authenticated
		using (app.is_workspace_member(workspace_id));" >/dev/null
http GET "$API/rest/v1/cards?channel_id=eq.$CH_GRANDS_COMPTES&select=id" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_VIEWER" >/dev/null
[ "$(jq 'length' "$CORPS")" -gt 0 ] \
	&& ok "dégradation a : politique ramenée à \`is_workspace_member\`, le \`viewer\` voit les cards "\
"de \`grands-comptes\` — le contrôle de la section 5 aurait échoué" \
	|| fail "dégradation a : le viewer ne voit toujours rien, la preuve n° 4 ne prouve pas la RLS"

# b. Le `WITH CHECK` de la mise à jour rendu PERMISSIF : une card peut alors être déplacée VERS un
#    channel interdit.
#
#    La dégradation ne peut pas se contenter de RETIRER la clause. MESURÉ sur la pile :
#    `pg_get_expr(polwithcheck, …)` d'une politique `for update` écrite sans `with check` rend
#    `NULL`, et PostgreSQL **réutilise alors le `USING`** pour juger la nouvelle ligne. Retirer la
#    clause ne dégrade donc rien — c'est ce qui a fait échouer cette dégradation à sa première
#    écriture, et ce qui a corrigé le §6.1 de la spécification.
psql_db -c "
	drop policy cards_maj on public.cards;
	create policy cards_maj on public.cards for update to authenticated
		using (app.can_write_channel(channel_id)) with check (true);" >/dev/null
#
#    RÉVISÉE LE 2026-08-05, ET LA RÉVISION CORRIGE UN CONTRÔLE QUI PASSAIT POUR UNE MAUVAISE RAISON
#    — INC-055, second effet. `channel_id` est fermée au niveau COLONNE depuis `CRM-034`
#    (`0012_move_card.sql` §2.3), qui ne rend nommément que treize colonnes à `authenticated`. Un
#    `PATCH` sur `channel_id` est donc refusé par le PRIVILÈGE, avant que la moindre politique ne
#    soit consultée : cette dégradation ne prouvait plus rien du `WITH CHECK`. Elle ne l'exerçait
#    que parce que ce harnais rejouait `0011` SEUL et rouvrait la table entière — l'état qu'INC-055
#    décrit, et que le runner ne produit jamais.
#
#    Le contrôle est donc écrit EN DEUX TEMPS, ce qui le rend plus fort et non plus faible :
#    d'abord le refus tenu par le seul privilège, ensuite le `WITH CHECK` réellement exercé une
#    fois ce privilège rendu. Le refus est DOUBLE, et chaque barrière est mesurée séparément.
CARD_SONDE=$(psql_db -c "select id from public.cards where title = 'tst-crm040-une';")

code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_SONDE" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_BIZDEV" \
        -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg c "$CH_MAINTENANCE" '{channel_id: $c}')")
[ "$code" = "403" ] \
	&& ok "dégradation b, premier temps : le \`WITH CHECK\` rendu permissif ne suffit PAS — le "\
"privilège de colonne de \`CRM-034\` refuse encore le déplacement. Le refus est double" \
	|| fail "dégradation b : le privilège de colonne ne refuse plus le PATCH de channel_id ($code)"

psql_db -c "grant update (channel_id) on public.cards to authenticated;" >/dev/null
code=$(http PATCH "$API/rest/v1/cards?id=eq.$CARD_SONDE" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_BIZDEV" \
        -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg c "$CH_MAINTENANCE" '{channel_id: $c}')")
[ "$code" != "403" ] \
	&& ok "dégradation b, second temps : les DEUX barrières tombées, la card se déplace vers un "\
"channel interdit ($code) — le contrôle de la ligne s du §8.1 aurait échoué" \
	|| fail "dégradation b : le refus tient avec un \`WITH CHECK\` permissif ET le privilège rendu"
psql_db -c "update public.cards set channel_id = '$CH_GRANDS_COMPTES'
             where id = '$CARD_SONDE';" >/dev/null 2>&1 || true

# c. La garde d'archivage retirée : un nœud occupé devient archivable.
psql_db -c "drop trigger workflow_nodes_catalog_refuser_archivage_occupe
              on public.workflow_nodes_catalog;" >/dev/null
code=$(http PATCH "$API/rest/v1/workflow_nodes_catalog?id=eq.$noeud_occupe" \
        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN" \
        -H 'Content-Type: application/json' -d '{"archived_at":"2026-05-01T10:00:00Z"}')
[ "$code" = "204" ] \
	&& ok "dégradation c : garde retirée, un nœud OCCUPÉ s'archive — le contrôle de la section 6 "\
"aurait échoué" \
	|| fail "dégradation c : l'archivage est encore refusé sans la garde ($code)"
psql_db -c "update public.workflow_nodes_catalog set archived_at = null where id = '$noeud_occupe';" \
	>/dev/null

# Restauration par la migration elle-même, puis CONSTAT — jamais supposé.
rejouer_migrations || true
restaure=$(psql_db -c "select
	(select count(*) from pg_policy where polrelid = 'public.cards'::regclass
	   and polname = 'cards_maj' and polwithcheck is not null)::text || '/' ||
	(select count(*) from pg_trigger where tgrelid = 'public.workflow_nodes_catalog'::regclass
	   and tgname = 'workflow_nodes_catalog_refuser_archivage_occupe')::text;")
[ "$restaure" = "1/1" ] \
	&& ok "restauration constatée : le \`WITH CHECK\` est revenu et la garde d'archivage aussi" \
	|| fail "restauration incomplète : « $restaure », attendu « 1/1 »"

http GET "$API/rest/v1/cards?channel_id=eq.$CH_GRANDS_COMPTES&select=id" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_VIEWER" >/dev/null
[ "$(jq 'length' "$CORPS")" = "0" ] \
	&& ok "et le \`viewer\` ne voit de nouveau aucune card de \`grands-comptes\`" \
	|| fail "après restauration, le viewer voit encore des cards interdites"

# INC-061, décision 296 : une suite globale ne mesure jamais une base qui porte encore le jeu
# d'essai du harnais. Le trap reste la sécurité d'interruption ; ce ménage explicite est une étape
# de preuve, placée AVANT SQL/API/UI. Le seed est nommément exclu par le préfixe réservé.
menage
residus=$(psql_db -c "select
	(select count(*) from public.cards where title like 'tst-crm040-%') +
	(select count(*) from public.workflow_steps where id = '$ETAPE_LIBRE') +
	(select count(*) from public.workflow_nodes_catalog where id = '$NOEUD_LIBRE');")
[ "${residus:-1}" = "0" ] \
	&& ok "INC-061 : le jeu d'essai est retiré AVANT les suites globales" \
	|| fail "INC-061 : $residus résidu(s) de preuve subsistent avant les suites globales"

titre "10. Suites, tests unitaires et build"

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
