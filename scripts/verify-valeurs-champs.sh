#!/usr/bin/env bash
# @verifies CRM-036 (docs/BACKLOG.md) — Definition of Done des valeurs de formulaire
# @verifies docs/SPEC-form-composer.md §6.2 (modèle), §6.3 (clés composites), §6.4 (la validation
#           est un trigger), §6.5 (types), §6.6 (« renseigné »), §6.7 (la sixième vérification),
#           §6.9 (autorisations), §6.10 (contrat d'API), §6.11 (seed), §7.2 (preuves)
# @verifies docs/SPEC-permissions-rls.md §3.7 (`app.can_write_card`), §4, §7 (refus n° 4, n° 11)
# @verifies docs/SPEC-workflow-engine.md §5.3, §5.7 (la sixième vérification)
# @verifies docs/SPEC-seed.md §2.13 (valeurs du seed)
# @verifies docs/INCONSISTENCY_REPORT.md INC-025, INC-033, INC-037 (aggravé), INC-047 (**close**),
#           INC-053 (`user` non résolu), INC-054 (`value` nullable)
#
# Rejoue les preuves exigées par la Definition of Done de `CRM-036` :
#
#   1. la suite pgTAP `supabase/tests/0014_valeurs_champs.test.sql` est verte ;
#   2. la migration est **rejouable** : réappliquée sur une base déjà migrée, elle réussit sans
#      modifier la table, ses contraintes, ses politiques ni la définition de `move_card` ;
#   3. elle est **convergente** : une contrainte retirée est rétablie, une clé composite dégradée en
#      clé simple sous le même nom est réparée, un privilège relâché est retiré (décisions 57, 78) ;
#   4. la validation par type tient contre l'API, avec le jeton réel de l'administratrice, chaque
#      refus **relisant la ligne** pour la constater inchangée ;
#   5. la **sixième vérification de `move_card`** refuse ce qu'elle doit refuser ET accepte ce
#      qu'elle doit accepter — sans le second, elle serait verte sur une garde qui refuse tout ;
#   6. le seed est conforme au contrat du §6.11 et **convergent** ;
#   7. le harnais est **non complaisant** : chaque affaiblissement volontaire du produit le fait
#      échouer, et la restauration est constatée, pas supposée.
#
# ---------------------------------------------------------------------------------------------
# Ce que ce harnais ne prouve pas, et le dit.
# ---------------------------------------------------------------------------------------------
# Il ne prouve rien d'une interface. Le rendu du formulaire, sa section repliée et la mention
# « requis pour passer à » sont `CRM-037` ; et la webapp reste un appelant **anonyme** faute d'écran
# de connexion (INC-021). Il n'y a donc ni test E2E d'interface ni capture à produire pour cette
# unité — non par renoncement, mais parce qu'il n'existe rien à regarder. Les règles sont livrées et
# prouvées **en base et par l'API**, ce que `CLAUDE.md` §10 exige de toute façon.
#
# Il ne prouve **aucune résolution** de `user`, `contact` ni `file` : la forme est validée, pas
# l'existence de la cible (INC-053).
#
# Le script ne démarre ni n'arrête rien : la pile de développement doit déjà tourner
# (`./runDev.sh`) et le seed être appliqué (`supabase/seed/apply-seed.sh`).
#
# Usage :
#   scripts/verify-valeurs-champs.sh
#   scripts/verify-valeurs-champs.sh --rapide   n'exécute pas les suites Playwright ni le build

set -euo pipefail

cd "$(dirname "$0")/.."

# shellcheck source=scripts/lib/node.sh
source scripts/lib/node.sh
node_toolchain_prepare "$PWD/.nvmrc" || exit 1

TEST_FILE=supabase/tests/0014_valeurs_champs.test.sql
MIGRATION_FILE=supabase/migrations/0013_valeurs_champs.sql
# LA 14 SUIT TOUJOURS UN REJEU DE LA 12, et c'est une dépendance MESURÉE, ajoutée par `CRM-013`.
# Ce harnais rejoue la migration 12 en TROIS endroits, pour éprouver l'ordre 12 → 13 et pour poser
# deux dégradations. Or la section 2 de la 12 réapplique les privilèges de colonne de `cards` avec
# `email_local_part` DANS la liste — état d'avant `CRM-013`. Sans la 14 derrière chaque rejeu, ce
# harnais sortait sur une base où l'adresse d'une card redevenait réécrivable, en annonçant
# « 33 contrôles, aucune anomalie ». MESURÉ le 2026-08-05 : `has_column_privilege(…)` passait de
# `false` à `true` après son passage. Quatrième occurrence des décisions 108, 135, 143 et 145.
MIGRATION_COLONNES=supabase/migrations/0014_colonnes_protegees.sql
# CRM-018 est la dernière autorité sur `move_card`. Tout chemin de restauration doit la rejouer
# après CRM-036 et CRM-013 pour rendre exactement l'état produit par le runner complet.
# ET LA 47 SUIT LA 13, QUATRIÈME OCCURRENCE DE LA MÊME CLASSE (décisions 108, 135, 143, 145,
# INC-153). MESURÉ le 2026-08-18 : la migration 13 définit `app.card_field_values_valider()` dans sa
# version qui valide la seule FORME d'un uuid ; la 47 la redéfinit avec la RÉSOLUTION des types
# `contact` et `user` (`CRM-060` tranche 3). Rejouer la 13 sans la 47 derrière retire donc la
# résolution EN SILENCE, et les harnais exécutés ensuite mesurent un produit amputé — exactement ce
# qu'INC-153 a coûté à la tranche 2. Mesure de la dégradation, puis de sa réparation :
#   après rejeu de la 13 seule : la fonction ne contient plus « ne désigne aucun contact » ;
#   après rejeu de la 47       : elle la contient de nouveau.
MIGRATION_RESOLUTION=supabase/migrations/0047_resolution_champs_contact_user.sql
MIGRATION_FINALE=supabase/migrations/0019_transition_required_fields.sql
# ET LA 35 SUIT LA 19, CINQUIÈME OCCURRENCE DE LA MÊME CLASSE — DÉFAUT ANTÉRIEUR, MESURÉ LE
# 2026-08-18 SUR LA LIGNE DE BASE. `MIGRATION_FINALE` nommait la 19 « dernière autorité sur
# `move_card` » ; elle ne l'est plus depuis le lot G (décision 374), qui redéfinit la fonction avec
# `app.btrim_blancs` et la conservation du commentaire de transition (INC-048, INC-052). Toute
# chaîne de restauration s'arrêtant à la 19 laissait donc `move_card` AMPUTÉE en sortant, et la
# suite pgTAP `0014` rendait `not ok 99` et `not ok 100` à l'exécution SUIVANTE de ce harnais.
# MESURÉ des deux côtés d'un `git stash` : rouge avant comme après mes changements, donc antérieur
# — consigné INC-154, et corrigé ici parce que le défaut vit dans les fichiers mêmes de cette
# session (même geste que la décision 447 pour INC-153).
MIGRATION_LOT_G=supabase/migrations/0035_commentaires_lot_g.sql
DB_CONTAINER=p2enjoy-db

WS_SEED=5eed0000-0000-4000-8000-000000000001
WF_GLOBAL=5eed0000-0000-4000-8000-000000000051
CHAMP_BUDGET=5eed0000-0000-4000-8000-000000000081
CHAMP_SOURCE=5eed0000-0000-4000-8000-000000000082
CHAMP_LIEN=5eed0000-0000-4000-8000-000000000086
CARD_C1=5eed0000-0000-4000-8000-0000000000c1
CARD_C2=5eed0000-0000-4000-8000-0000000000c2
CARD_C6=5eed0000-0000-4000-8000-0000000000c6
CARD_C7=5eed0000-0000-4000-8000-0000000000c7
ETAPE_RELANCE=5eed0000-0000-4000-8000-000000000062
ETAPE_NEGOCIATION=5eed0000-0000-4000-8000-000000000063
MAIL_ADMIN=admin@p2enjoy.test
MAIL_VIEWER=viewer@p2enjoy.test
MDP_SEED=SeedDev2026Local

RAPIDE=false
while [ $# -gt 0 ]; do
	case "$1" in
		--rapide) RAPIDE=true ;;
		--help|-h) sed -n '2,44p' "$0"; exit 0 ;;
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

rejouer_migrations() {
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || return 1
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_COLONNES" >/dev/null 2>&1 || return 1
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_RESOLUTION" >/dev/null 2>&1 || return 1
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FINALE" >/dev/null 2>&1 || return 1
	psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_LOT_G" >/dev/null 2>&1 || return 1
}

CORPS=/tmp/p2enjoy-valeurs-body
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

# Le ménage est posé AVANT toute création : une interruption ne doit jamais laisser une valeur de
# preuve derrière elle, ni une card déplacée. Le seed est un contrat maintenu.
menage() {
	psql_db -c "delete from public.card_field_values
	             where card_id = '$CARD_C6' and field_id in ('$CHAMP_LIEN', '$CHAMP_BUDGET');" \
		>/dev/null 2>&1 || true
	psql_db -c "update public.cards set current_step_id = '$ETAPE_RELANCE', position = 2
	             where id = '$CARD_C2' and current_step_id <> '$ETAPE_RELANCE';" >/dev/null 2>&1 || true
	# Une INTERRUPTION entre un rejeu de la 12 et sa 14 laisserait `email_local_part` ouverte. Le
	# ménage la referme donc, dans l'ordre 13 puis 14 puis 19 — la 19 rétablit la sixième garde
	# canonique adossée à la table de liaison.
	rejouer_migrations || true
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

# L'empreinte inclut la définition de `move_card` : cette migration la REDÉFINIT (section 9), et un
# rejeu qui la laisserait dans son état de la migration 12 rendrait la sixième vérification muette.
empreinte() {
	psql_db -c "
		select string_agg(x, '|' order by x) from (
			select 'con:' || c.conname || ':' || md5(pg_get_constraintdef(c.oid)) as x
			  from pg_constraint c
			 where c.conrelid = 'public.card_field_values'::regclass
			union all
			select 'pol:' || p.polname
			  from pg_policy p
			 where p.polrelid = 'public.card_field_values'::regclass
			union all
			select 'trg:' || t.tgname
			  from pg_trigger t
			 where t.tgrelid = 'public.card_field_values'::regclass and not t.tgisinternal
			union all
			select 'fn:' || p.proname || ':' || md5(pg_get_functiondef(p.oid))
			  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
			 where (n.nspname = 'app'    and p.proname in ('card_field_values_valider',
			                                               'valeur_de_champ_est_vide',
			                                               'can_write_card'))
			    or (n.nspname = 'public' and p.proname = 'move_card')
		) t;
	"
}

avant=$(empreinte)
if rejouer_migrations; then
	ok "la séquence 13 → 14 → 19 se réapplique sans erreur sur une base déjà migrée"
else
	fail "la migration échoue au rejeu — l'idempotence n'est pas acquise"
fi
apres=$(empreinte)
[ "$avant" = "$apres" ] \
	&& ok "le rejeu ne modifie ni les contraintes, ni les politiques, ni les triggers, ni "\
"\`move_card\` elle-même" \
	|| fail "le rejeu a modifié quelque chose : l'empreinte diffère"

# L'ORDRE DES MIGRATIONS EST UNE DÉPENDANCE, ET IL EST VÉRIFIÉ. La migration 12 pose `move_card` à
# CINQ vérifications ; la 13 la remplace par celle à six. Un `migrations-runner` qui les rejouerait
# dans l'autre sens laisserait le produit sans sa sixième vérification, sans aucun signal.
psql_db -v ON_ERROR_STOP=1 -f - < supabase/migrations/0012_move_card.sql >/dev/null 2>&1 || true
# La 14 referme aussitôt `email_local_part`, que le rejeu de la 12 vient de rendre. La
# dégradation visée porte sur `move_card`, pas sur cette colonne : la refermer ne l'affaiblit
# en rien, et sans elle le harnais laisserait le produit dégradé en sortant (CRM-013).
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_COLONNES" >/dev/null 2>&1 || true
sans_n6=$(psql_db -c "select pg_get_functiondef('public.move_card(uuid,uuid,text)'::regprocedure)
                        like '%missing_required_fields%';")
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
avec_n6=$(psql_db -c "select pg_get_functiondef('public.move_card(uuid,uuid,text)'::regprocedure)
                        like '%missing_required_fields%';")
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FINALE" >/dev/null 2>&1 || true
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_LOT_G" >/dev/null 2>&1 || true
# La 47 derrière la 13, ici aussi : ce bloc rejoue la 13 seule pour MESURER l'ordre 12 → 13, et
# repartirait sinon sur une base dont la résolution a disparu.
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_RESOLUTION" >/dev/null 2>&1 || true
[ "$sans_n6" = "f" ] && [ "$avec_n6" = "t" ] \
	&& ok "l'ORDRE 12 → 13 est ce qui livre la sixième vérification : rejouer la 12 seule la retire, "\
"rejouer la 13 la remet — mesuré dans les deux sens" \
	|| fail "dépendance d'ordre non vérifiée : après 12 « $sans_n6 », après 13 « $avec_n6 »"

# Convergence, et non simple idempotence : une contrainte **retirée** est rétablie (décision 57).
psql_db -c "alter table public.cards drop constraint cards_id_workflow_id_key cascade;" >/dev/null
rejouer_migrations || true
[ "$(psql_db -c "select count(*) from pg_constraint
                  where conrelid = 'public.cards'::regclass
                    and conname = 'cards_id_workflow_id_key';")" = "1" ] \
	&& ok "l'unicité retirée à la main sur \`cards\` est **rétablie** par un rejeu : la migration "\
"répare, elle ne constate pas" \
	|| fail "l'unicité retirée n'est pas rétablie"

# Convergence de la forme la plus difficile (décision 78) : une clé composite dégradée en clé
# **simple** portant le même nom. Tester la présence du nom la laisserait passer.
psql_db -c "
	alter table public.card_field_values
		drop constraint card_field_values_field_id_workflow_id_fkey;
	alter table public.card_field_values
		add constraint card_field_values_field_id_workflow_id_fkey
		foreign key (field_id) references public.form_fields (id) on delete cascade;
" >/dev/null
rejouer_migrations || true
definition=$(psql_db -c "select pg_get_constraintdef(oid) from pg_constraint
                          where conname = 'card_field_values_field_id_workflow_id_fkey';")
case "$definition" in
	*'(field_id, workflow_id)'*)
		ok "une clé composite **dégradée en clé simple** sous le même nom est réparée par un rejeu "\
"(décision 78) : la définition réelle est comparée, pas le nom" ;;
	*) fail "la clé dégradée n'a pas été réparée : « $definition »" ;;
esac

# LE DÉFAUT RÉEL DE LA DÉCISION 134, ÉPROUVÉ. L'image Supabase accorde TOUT à `anon` et
# `authenticated` sur toute table neuve : sans le `revoke all` de la section 8.5, le « refus double »
# annoncé au §6.9 n'existerait pas.
psql_db -c "grant delete on public.card_field_values to authenticated, anon;" >/dev/null
rejouer_migrations || true
[ "$(psql_db -c "select has_table_privilege('authenticated','public.card_field_values','DELETE')::text
                     || '/' ||
                        has_table_privilege('anon','public.card_field_values','INSERT')::text;")" \
	= "false/false" ] \
	&& ok "un privilège relâché à la main est **retiré** par un rejeu — décision 134, le défaut que "\
"la suite pgTAP de cette unité a trouvé" \
	|| fail "les privilèges relâchés n'ont pas été retirés"

titre "3. La validation par type, mesurée contre l'API avec le jeton réel"

T_ADMIN=$(jeton_de "$MAIL_ADMIN")
T_VIEWER=$(jeton_de "$MAIL_VIEWER")
[ -n "$T_ADMIN" ] && [ -n "$T_VIEWER" ] \
	&& ok "jetons de l'administratrice et du viewer obtenus par la vraie route" \
	|| fail "connexion d'un compte seedé impossible"

poster_valeur() {
	http POST "$API/rest/v1/card_field_values" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
		-H 'Content-Type: application/json' \
		-H 'Prefer: return=representation,resolution=merge-duplicates' \
		-d "$(jq -nc --arg c "$2" --arg f "$3" --arg wf "$WF_GLOBAL" --arg ws "$WS_SEED" \
		             --argjson v "$4" \
		 '{card_id: $c, field_id: $f, workflow_id: $wf, workspace_id: $ws, value: $v}')"
}

lignes_de() {
	psql_db -c "select count(*) from public.card_field_values
	             where card_id = '$1' and field_id = '$2';"
}

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_BUDGET" '"45000"')
[ "$code" = "400" ] && [ "$(jq -r '.message' < "$CORPS")" = "invalid_field_value" ] \
	&& [ "$(lignes_de "$CARD_C6" "$CHAMP_BUDGET")" = "0" ] \
	&& ok "un \`money\` recevant une **chaîne** est refusé — 400, message stable, et **aucune ligne**" \
	|| fail "money recevant une chaîne : code $code, message \`$(jq -r '.message // empty' < "$CORPS")\`"

detail=$(jq -r '.details // empty' < "$CORPS")
case "$detail" in
	*budget*) ok "et le \`DETAIL\` nomme la clé du champ — décision 126, PostgREST l'expose dans "\
"\`details\`" ;;
	*) fail "le DETAIL ne nomme pas le champ : « $detail »" ;;
esac

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SOURCE" '"linkedin"')
[ "$code" = "400" ] \
	&& ok "un \`select\` recevant une clé **absente de \`choices\`** est refusé : le point ouvert "\
"n° 4 du §8 est clos du côté des réponses (décision 131)" \
	|| fail "select hors choix : code $code"

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_LIEN" '"javascript:alert(1)"')
[ "$code" = "400" ] && [ "$(lignes_de "$CARD_C6" "$CHAMP_LIEN")" = "0" ] \
	&& ok "un \`url\` recevant \`javascript:\` est refusé, et aucune ligne n'est créée" \
	|| fail "url javascript: code $code"

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_LIEN" '"https://p2enjoy.fr/x"')
[ "$code" = "201" ] \
	&& ok "…et une adresse http(s) est **acceptée** : la validation discrimine, elle ne refuse "\
"pas tout" \
	|| fail "url conforme refusée : code $code"

# INC-054, mesuré : `null` JSON devient SQL NULL, et c'est la SEULE écriture d'API qui vide un champ.
# Le contrôle précédent a créé la ligne : l'upsert la MET À JOUR, et PostgREST rend alors 200 et non
# 201. Les deux codes sont acceptés ici parce que c'est le VIDAGE qui est mesuré, pas la création.
code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_LIEN" 'null')
vide=$(psql_db -c "select (value is null)::text from public.card_field_values
                    where card_id = '$CARD_C6' and field_id = '$CHAMP_LIEN';")
{ [ "$code" = "201" ] || [ "$code" = "200" ]; } && [ "$vide" = "true" ] \
	&& ok "INC-054 : \`null\` vide le champ — PostgREST le convertit en SQL NULL, et c'est la seule "\
"écriture d'API qui le permette (décision 133)" \
	|| fail "null : code $code, valeur vide « $vide »"

titre "3 bis. La RÉSOLUTION de `contact` et `user` — CRM-060 tranche 3, INC-053 close"

# Ce que ce bloc mesure, et pourquoi il ne peut pas se contenter du §3 : la validation par TYPE dit
# qu'un uuid est bien formé ; la RÉSOLUTION dit qu'il désigne quelque chose. Un harnais qui
# n'éprouverait que la forme resterait vert sur le défaut exact qu'INC-053 portait.
#
# Les deux champs sondes sont créés ici et RETIRÉS en fin de bloc, et ils le restent bien que le seed
# porte désormais `contact-principal` et `referent-technique` (docs/SPEC-contacts.md §13.6) : ce bloc
# doit pouvoir ÉCRIRE et REFUSER sans toucher aux deux champs seedés, dont les valeurs sont un
# contrat maintenu que la sous-tranche 4d éprouve à l'écran.

CHAMP_SONDE_CONTACT=a5200000-0000-4000-8000-000000000001
CHAMP_SONDE_USER=a5200000-0000-4000-8000-000000000002
CONTACT_LEO=5eed0000-0000-4000-8000-000000000091
MEMBRE_BIZDEV=5eed0000-0000-4000-8000-000000000012
UUID_MORT=00000000-0000-4000-8000-000000000000

psql_db -c "
	insert into public.form_fields (id, workflow_id, workspace_id, key, label, type, options, position)
	values ('$CHAMP_SONDE_CONTACT', '$WF_GLOBAL', '$WS_SEED', 'sonde-contact-harnais',
	        'Sonde contact', 'contact', '{}', 910),
	       ('$CHAMP_SONDE_USER', '$WF_GLOBAL', '$WS_SEED', 'sonde-user-harnais',
	        'Sonde user', 'user', '{}', 911)
	on conflict (id) do nothing;" >/dev/null

# TÉMOIN D'ABORD : sans lui, les refus qui suivent seraient verts sur une garde qui refuserait TOUT,
# y compris une cible légitime. C'est la même précaution que la section 7 prend pour les politiques.
code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_CONTACT" "\"$CONTACT_LEO\"")
[ "$code" = "201" ] \
	&& ok "témoin : un contact RÉEL du workspace est **accepté** sur un champ \`contact\` — la "\
"résolution discrimine, elle ne refuse pas tout" \
	|| fail "un contact réel du workspace est refusé : code $code"

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_CONTACT" "\"$UUID_MORT\"")
detail=$(jq -r '.details // empty' < "$CORPS")
[ "$code" = "400" ] && [ "$(jq -r '.message' < "$CORPS")" = "invalid_field_value" ] \
	&& case "$detail" in *"ne désigne aucun contact"*) true ;; *) false ;; esac \
	&& ok "un uuid bien formé ne désignant AUCUN contact est refusé — 400, jeton stable, et le "\
"DETAIL dit pourquoi. C'est le défaut qu'INC-053 portait, et il est fermé" \
	|| fail "uuid mort sur \`contact\` : code $code, détail « $detail »"

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_USER" "\"$MEMBRE_BIZDEV\"")
[ "$code" = "201" ] \
	&& ok "témoin : un MEMBRE du workspace est accepté sur un champ \`user\`" \
	|| fail "un membre réel est refusé sur \`user\` : code $code"

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_USER" "\"$UUID_MORT\"")
detail=$(jq -r '.details // empty' < "$CORPS")
[ "$code" = "400" ] \
	&& case "$detail" in *"ne désigne aucun membre"*) true ;; *) false ;; esac \
	&& ok "un uuid ne désignant aucun membre du workspace est refusé sur \`user\` — la règle "\
"d'appartenance de la décision 295 est opposable EN BASE" \
	|| fail "uuid mort sur \`user\` : code $code, détail « $detail »"

# Vider reste possible : sans ce contrôle, la résolution pourrait rendre un champ `contact`
# IMPOSSIBLE à vider — le défaut exact qu'INC-054 avait produit sur `money` (décision 133).
code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_CONTACT" 'null')
vide=$(psql_db -c "select (value is null)::text from public.card_field_values
                    where card_id = '$CARD_C6' and field_id = '$CHAMP_SONDE_CONTACT';")
{ [ "$code" = "201" ] || [ "$code" = "200" ]; } && [ "$vide" = "true" ] \
	&& ok "…et un champ \`contact\` reste **vidable** : la résolution n'a pas rendu obligatoire un "\
"champ facultatif (INC-054, décision 133)" \
	|| fail "vidage d'un champ contact : code $code, valeur vide « $vide »"

# LA DÉGRADATION EST ICI, au plus près de ce qu'elle éprouve : la migration 13 seule ramène le
# validateur d'AVANT la résolution. C'est la quatrième occurrence de la classe des décisions 108,
# 135, 143, 145 et d'INC-153 — et c'est aussi ce que ce harnais aurait fait sans le correctif du
# `rejouer_migrations` ci-dessus.
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FILE" >/dev/null 2>&1 || true
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_COLONNES" >/dev/null 2>&1 || true
code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_CONTACT" "\"$UUID_MORT\"")
[ "$code" != "400" ] \
	&& ok "dégradation constatée : la migration 13 rejouée SEULE retire la résolution, et l'uuid "\
"mort repasse (code $code) — les quatre contrôles ci-dessus mesurent bien la migration 47" \
	|| fail "dégradation sans effet : le refus tient alors que la 13 seule a été rejouée"
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_RESOLUTION" >/dev/null 2>&1 || true
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_FINALE" >/dev/null 2>&1 || true
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_LOT_G" >/dev/null 2>&1 || true

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_SONDE_CONTACT" "\"$UUID_MORT\"")
[ "$code" = "400" ] \
	&& ok "restauration constatée, non supposée : la 47 rejouée, l'uuid mort est de nouveau refusé" \
	|| fail "après restauration, l'uuid mort rend encore $code"

# Ménage : les valeurs partent avec les champs (cascade composite), le `delete` est néanmoins
# explicite — un ménage qui suppose une cascade ne dit pas ce qu'il nettoie.
psql_db -c "
	delete from public.card_field_values
	 where field_id in ('$CHAMP_SONDE_CONTACT', '$CHAMP_SONDE_USER');
	delete from public.form_fields
	 where id in ('$CHAMP_SONDE_CONTACT', '$CHAMP_SONDE_USER');" >/dev/null

titre "4. Les autorisations, et le piège du refus silencieux"

code=$(poster_valeur "$T_VIEWER" "$CARD_C6" "$CHAMP_LIEN" '"https://viewer.test/x"')
[ "$code" = "403" ] \
	&& ok "un \`viewer\` n'écrit aucune valeur, même sur une card qu'il VOIT : \`app.can_write_card\` "\
"exige le droit d'écriture sur le channel" \
	|| fail "écriture par un viewer : code $code"

# Le piège de la décision 70 : un refus par `USING` ne lève **aucune** erreur. Sans la relecture, ce
# contrôle serait vert que la politique existe ou non.
avant_valeur=$(psql_db -c "select value::text from public.card_field_values
                            where card_id = '$CARD_C6' and field_id = '$CHAMP_SOURCE';")
code=$(http PATCH "$API/rest/v1/card_field_values?card_id=eq.$CARD_C6&field_id=eq.$CHAMP_SOURCE" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_VIEWER" -H 'Content-Type: application/json' \
	-d '{"value":"salon"}')
apres_valeur=$(psql_db -c "select value::text from public.card_field_values
                            where card_id = '$CARD_C6' and field_id = '$CHAMP_SOURCE';")
[ "$code" = "204" ] && [ "$avant_valeur" = "$apres_valeur" ] \
	&& ok "un \`viewer\` obtient 204 et **ne modifie rien** : le refus est silencieux, et c'est la "\
"relecture qui le prouve (décision 70)" \
	|| fail "mise à jour par un viewer : code $code, valeur $avant_valeur → $apres_valeur"

code=$(http DELETE "$API/rest/v1/card_field_values?card_id=eq.$CARD_C6&field_id=eq.$CHAMP_SOURCE" \
	-H "apikey: $ANON_KEY" -H "Authorization: Bearer $T_ADMIN")
restant=$(lignes_de "$CARD_C6" "$CHAMP_SOURCE")
[ "$code" = "403" ] && [ "$restant" = "1" ] \
	&& ok "même un \`admin\` ne **supprime** pas une valeur : 403 par le privilège, et la ligne reste" \
	|| fail "suppression par un admin : code $code, lignes restantes $restant"

code=$(http GET "$API/rest/v1/card_field_values" -H "apikey: $ANON_KEY")
lignes=$(jq -r 'length' < "$CORPS")
[ "$code" = "200" ] && [ "$lignes" = "0" ] \
	&& ok "un anonyme obtient 200 et **zéro ligne** : le refus n'est jamais une erreur de privilège "\
"(preuve n° 11)" \
	|| fail "lecture anonyme : code $code, $lignes lignes"

titre "5. La sixième vérification de move_card — INC-047 close"

deplacer() {
	http POST "$API/rest/v1/rpc/move_card" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $1" \
		-H 'Content-Type: application/json' \
		-d "$(jq -nc --arg c "$2" --arg s "$3" '{card_id: $c, to_step_id: $s}')"
}

code=$(deplacer "$T_ADMIN" "$CARD_C1" "$ETAPE_NEGOCIATION")
message=$(jq -r '.message // empty' < "$CORPS")
detail=$(jq -r '.details // empty' < "$CORPS")
etape=$(psql_db -c "select current_step_id from public.cards where id = '$CARD_C1';")
[ "$code" = "400" ] && [ "$message" = "missing_required_fields" ] && [ "$detail" = "budget" ] \
	&& [ "$etape" = "$ETAPE_RELANCE" ] \
	&& ok "un champ \`required\` VIDE refuse la transition : 400, message stable, \`DETAIL\` portant "\
"la clé, et la card **n'a pas bougé**" \
	|| fail "refus n° 6 : code $code, message « $message », detail « $detail », étape $etape"

# LE CAS SYMÉTRIQUE. Sans lui, le contrôle précédent serait vert sur une garde qui refuse TOUT.
code=$(deplacer "$T_ADMIN" "$CARD_C2" "$ETAPE_NEGOCIATION")
etape=$(psql_db -c "select current_step_id from public.cards where id = '$CARD_C2';")
[ "$code" = "200" ] && [ "$etape" = "$ETAPE_NEGOCIATION" ] \
	&& ok "la MÊME transition, sur une card dont le champ est renseigné, **réussit** : la règle "\
"discrimine" \
	|| fail "acceptation n° 6 : code $code, étape $etape"
menage

# L'union du §3.5 : le second membre, porté par l'arête et non par l'étape.
code=$(deplacer "$T_ADMIN" "$CARD_C7" 5eed0000-0000-4000-8000-000000000065)
detail=$(jq -r '.details // empty' < "$CORPS")
[ "$code" = "400" ] && [ "$detail" = "lien-proposition" ] \
	&& ok "l'**UNION** étape + transition : l'étape \`réalisation\` n'exige rien, et le refus vient "\
"de la liaison de l'arête" \
	|| fail "union étape + transition : code $code, detail « $detail »"

titre "6. Le seed est conforme au §6.11, et convergent"

valeurs=$(psql_db -c "select count(*) from public.card_field_values;")
cards=$(psql_db -c "select count(distinct card_id) from public.card_field_values;")
vides=$(psql_db -c "select count(*) from public.card_field_values
                     where app.valeur_de_champ_est_vide(value);")
archive=$(psql_db -c "select count(*) from public.card_field_values v
                        join public.form_fields f on f.id = v.field_id
                       where f.archived_at is not null;")
exigeantes=$(psql_db -c "select count(*) from public.workflow_transition_required_fields trf
                          join public.workflow_transitions t on t.id = trf.transition_id
                         where t.workflow_id = '$WF_GLOBAL';")

[ "$valeurs" = "21" ] && ok "vingt et une valeurs" || fail "valeurs : $valeurs, attendu 21"
[ "$cards" = "11" ] && ok "sur **onze** cards" || fail "cards portant des valeurs : $cards, attendu 11"
[ "$vides" = "1" ] \
	&& ok "dont **une vidée explicitement** : une ligne présente n'est pas une valeur renseignée, "\
"et c'est démontré par une donnée permanente (§6.6)" \
	|| fail "valeurs vides : $vides, attendu 1"
[ "$archive" = "1" ] \
	&& ok "une valeur portée par un champ **archivé** : l'archivage retire le champ des formulaires, "\
"il n'efface pas les réponses (décision 129)" \
	|| fail "valeurs sur champ archivé : $archive, attendu 1"
[ "$exigeantes" = "1" ] \
	&& ok "une transition porte une liaison : le second membre de l'union a enfin une donnée "\
"qui l'exerce (docs/SPEC-workflow-engine.md §5.9)" \
	|| fail "liaisons de champ exigé : $exigeantes, attendu 1"

# Convergence : une valeur faussée à la main est **ramenée** au contrat par un rejeu du seed.
psql_db -c "update public.card_field_values set value = '999'::jsonb
             where card_id = '$CARD_C2' and field_id = '$CHAMP_BUDGET';" >/dev/null 2>&1 || true
if supabase/seed/apply-seed.sh >/dev/null 2>&1; then
	valeur=$(psql_db -c "select value::text from public.card_field_values
	                      where card_id = '$CARD_C2' and field_id = '$CHAMP_BUDGET';")
	[ "$valeur" = "45000" ] \
		&& ok "une valeur faussée à la main est **ramenée** au contrat par un rejeu du seed" \
		|| fail "après rejeu du seed, la valeur vaut « $valeur », attendu 45000"
else
	fail "le rejeu du seed a échoué"
fi

titre "7. Le harnais est-il complaisant ? Trois dégradations réelles"

# --- Dégradation 1 : la validation par type est neutralisée --------------------------------------
# Le trigger accepte tout. Si le contrôle du §3 restait vert, il ne mesurerait rien.
psql_db -c "alter table public.card_field_values disable trigger card_field_values_valider;" >/dev/null
code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_BUDGET" '"45000"')
[ "$code" != "400" ] \
	&& ok "dégradation 1 constatée : trigger désactivé, un \`money\` recevant une chaîne PASSE "\
"(code $code) — le contrôle du §3 mesure bien quelque chose" \
	|| fail "dégradation 1 sans effet : le refus tient alors que la validation est désactivée"
psql_db -c "delete from public.card_field_values
             where card_id = '$CARD_C6' and field_id = '$CHAMP_BUDGET';" >/dev/null 2>&1 || true
psql_db -c "alter table public.card_field_values enable trigger card_field_values_valider;" >/dev/null

# --- Dégradation 2 : la sixième vérification est retirée ------------------------------------------
# `move_card` est ramenée à sa version de la migration 12. Le produit redevient celui d'avant
# `CRM-036`, et le contrôle du §5 doit le voir.
psql_db -v ON_ERROR_STOP=1 -f - < supabase/migrations/0012_move_card.sql >/dev/null 2>&1 || true
# La 14 referme aussitôt `email_local_part`, que le rejeu de la 12 vient de rendre. La
# dégradation visée porte sur `move_card`, pas sur cette colonne : la refermer ne l'affaiblit
# en rien, et sans elle le harnais laisserait le produit dégradé en sortant (CRM-013).
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_COLONNES" >/dev/null 2>&1 || true
code=$(deplacer "$T_ADMIN" "$CARD_C1" "$ETAPE_NEGOCIATION")
[ "$code" = "200" ] \
	&& ok "dégradation 2 constatée : \`move_card\` ramenée à sa version de la migration 12, le "\
"déplacement vers une étape \`required\` PASSE de nouveau — c'est l'état exact d'avant \`CRM-036\`" \
	|| fail "dégradation 2 sans effet : code $code"
psql_db -c "update public.cards set current_step_id = '$ETAPE_RELANCE', position = 1
             where id = '$CARD_C1';" >/dev/null

# --- Dégradation 3 : la politique d'écriture est ouverte à tout membre ----------------------------
# `app.can_write_card` est remplacée par `app.can_read_card` : un `viewer` écrirait.
psql_db -c "
	drop policy card_field_values_insertion on public.card_field_values;
	create policy card_field_values_insertion on public.card_field_values
		for insert to authenticated with check (app.can_read_card(card_id));
" >/dev/null
psql_db -v ON_ERROR_STOP=1 -f - < supabase/migrations/0012_move_card.sql >/dev/null 2>&1 || true
# La 14 referme aussitôt `email_local_part`, que le rejeu de la 12 vient de rendre. La
# dégradation visée porte sur `move_card`, pas sur cette colonne : la refermer ne l'affaiblit
# en rien, et sans elle le harnais laisserait le produit dégradé en sortant (CRM-013).
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_COLONNES" >/dev/null 2>&1 || true
code=$(poster_valeur "$T_VIEWER" "$CARD_C6" "$CHAMP_LIEN" '"https://viewer.test/x"')
[ "$code" = "201" ] \
	&& ok "dégradation 3 constatée : politique d'insertion adossée à la LECTURE, le \`viewer\` écrit "\
"(code $code) — le contrôle du §4 mesure bien la règle et non un refus général" \
	|| fail "dégradation 3 sans effet : code $code"
psql_db -c "delete from public.card_field_values
             where card_id = '$CARD_C6' and field_id = '$CHAMP_LIEN';" >/dev/null 2>&1 || true

titre "8. Restauration, constatée et non supposée"

rejouer_migrations || true

restaure=$(psql_db -c "
	select (select pg_get_expr(polwithcheck, polrelid) like '%can_write_card%'
	          from pg_policy where polname = 'card_field_values_insertion')::text
	    || '/' ||
	       (select tgenabled = 'O' from pg_trigger
	         where tgname = 'card_field_values_valider'
	           and tgrelid = 'public.card_field_values'::regclass)::text
	    || '/' ||
	       (select pg_get_functiondef('public.move_card(uuid,uuid,text)'::regprocedure)
	          like '%missing_required_fields%')::text;
")
[ "$restaure" = "true/true/true" ] \
	&& ok "restauration constatée : la politique d'insertion est revenue à l'ÉCRITURE, le trigger de "\
"validation est actif, et \`move_card\` porte de nouveau sa sixième vérification" \
	|| fail "restauration incomplète : « $restaure », attendu « true/true/true »"

# ET LA COLONNE DE `CRM-013` EST REFERMÉE : sans ce contrôle, ce harnais sortirait de nouveau sur
# une base où l'adresse d'une card est réécrivable, en annonçant « aucune anomalie ».
psql_db -v ON_ERROR_STOP=1 -f - < "$MIGRATION_COLONNES" >/dev/null 2>&1 || true
[ "$(psql_db -c "select has_column_privilege('authenticated', 'public.cards', 'email_local_part', 'update');")" = "f" ] \
	&& ok "…et \`cards.email_local_part\` est refermée : le harnais ne laisse pas le produit dégradé" \
	|| fail "\`email_local_part\` est restée OUVERTE : un rejeu de la migration 12 n'a pas été suivi de la 14"

code=$(poster_valeur "$T_ADMIN" "$CARD_C6" "$CHAMP_BUDGET" '"45000"')
[ "$code" = "400" ] && ok "et le refus est de nouveau opposé au \`money\` recevant une chaîne" \
	|| fail "après restauration, le money recevant une chaîne rend encore $code"

code=$(deplacer "$T_ADMIN" "$CARD_C1" "$ETAPE_NEGOCIATION")
[ "$code" = "400" ] && ok "…et la sixième vérification refuse de nouveau la transition" \
	|| fail "après restauration, la transition rend encore $code"

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
fi

titre "Résultat"
if [ "$failures" -eq 0 ]; then
	printf '  \033[32m%d contrôles, aucune anomalie.\033[0m\n\n' "$checks"
else
	printf '  \033[31m%d contrôles, %d en échec.\033[0m\n\n' "$checks" "$failures"
	exit 1
fi
